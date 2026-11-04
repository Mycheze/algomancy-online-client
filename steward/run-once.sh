#!/usr/bin/env bash
# The steward's runner — ONE tick of the night worker, on the home box.
#
# systemd (steward/systemd/algomancy-steward.timer) runs this a few minutes
# after the last run ended, forever. Each tick:
#
#   1. mechanics, any hour, no Claude:  a deploy that was waiting for a quiet
#      server; branches the owner approved (steward-approved/*) → rebase, gate,
#      master, deploy
#   2. inside the night window only:    fetch reports → build the queue → one
#      fresh `claude -p` running the steward skill on ONE item → read its
#      verdict → run the full gate HERE → apply steward/policy.mjs → ship
#      (master + deploy when no one is in a game) or stage (steward/<item>)
#
# The model proposes; this script disposes. Claude never pushes, deploys or
# restarts anything — it cannot (its ssh for git is a guard that refuses, and
# its settings deny ssh/scp/push), and it does not need to.
#
# Config: ~/.config/algomancy-steward/env (see steward/README.md).
# State:  ~/algomancy-steward/state  (journal, handoffs, answers, queue, flags)
#
# ⚠ systemd runs a COPY of this file (~/algomancy-steward/bin/run-once.sh,
# refreshed from the clone at the start of every tick), because a run resets the
# clone to origin/master and bash reads a script as it executes it.

set -uo pipefail

ROOT="${STEWARD_ROOT:-$HOME/algomancy-steward}"
REPO="$ROOT/repo"
STATE="$ROOT/state"
LOGS="$ROOT/logs"
BIN="$ROOT/bin"
CONF="${STEWARD_CONF:-$HOME/.config/algomancy-steward/env}"
mkdir -p "$STATE"/{handoffs,answers,redgate,outcomes,handoffs/done,answers/done} "$LOGS" "$BIN"

[ -f "$CONF" ] && { set -a; . "$CONF"; set +a; }
: "${STEWARD_TZ:=Europe/Prague}"
: "${STEWARD_WINDOW:=23-08}"          # local hours [start,end) in which Claude may run
: "${STEWARD_MODE:=dry}"              # dry = never touch master, a branch or the VPS (work goes to refs/steward-dry/*); live = for real
: "${STEWARD_MODEL:=opus}"
: "${STEWARD_RUN_HOURS:=4}"           # one item's hard cap
: "${STEWARD_GATE_MIN:=120}"
: "${STEWARD_IDLE_MIN:=10}"           # a game file touched this recently = someone is playing
# TEST SEAMS, and nothing else: steward/test-runner.sh swaps in a stub Claude and a stub gate
: "${STEWARD_CLAUDE_BIN:=claude}"
: "${STEWARD_GATE_CMD:=npm --prefix $REPO/client run check}"
: "${STEWARD_FETCH_CMD:=node $REPO/client/engine/scripts/fetch-reports.mjs}"
VPS=algomancy-vps
VREPO=/home/bena/Documents/Algomancy
SITE=https://algomancy.online
export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$PATH"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOGS/runner.log" >&2; }

# one JSON row per event, the agent's queue reads the last word per item
journal() { # journal item outcome [key=value …]   (values are strings; json= for raw JSON)
  local item="$1" outcome="$2"; shift 2
  local args=(--arg ts "$(date -u +%FT%TZ)" --arg item "$item" --arg outcome "$outcome")
  local expr='{ts:$ts,item:$item,outcome:$outcome}'
  for kv in "$@"; do
    local k="${kv%%=*}" v="${kv#*=}"
    if [[ "$k" == json_* ]]; then k="${k#json_}"; args+=(--argjson "$k" "$v"); else args+=(--arg "$k" "$v"); fi
    expr="$expr + {$k:\$$k}"
  done
  jq -cn "${args[@]}" "$expr" >> "$STATE/journal.jsonl"
}

# the owner hears through the #steward forum's night log (steward/discord.mjs); the webhook is the fallback
discord() { STEWARD_REPO="$REPO" STEWARD_STATE="$STATE" node "$BIN/discord.mjs" "$@"; }
notify() {
  discord log "🛠 $*" 2>>"$LOGS/runner.log" && return 0
  [ -n "${STEWARD_WEBHOOK:-}" ] || return 0
  jq -cn --arg c "🛠 steward: $*" '{content:$c[0:1900]}' \
    | curl -fsS -m 15 -H 'content-type: application/json' -d @- "$STEWARD_WEBHOOK" >/dev/null || true
}

slug() { echo "$1" | sed -E 's/^#/report-/; s/[^A-Za-z0-9._-]+/-/g; s/^-+|-+$//g' | cut -c1-60; }

g() { git -C "$REPO" "$@"; }

in_hours() { # start end → is the local hour in [start,end)?
  local h start=$1 end=$2; h=$((10#$(TZ="$STEWARD_TZ" date +%H)))
  if [ "$start" -le "$end" ]; then [ "$h" -ge "$start" ] && [ "$h" -lt "$end" ]
  else [ "$h" -ge "$start" ] || [ "$h" -lt "$end" ]; fi
}
in_window() { in_hours $((10#${STEWARD_WINDOW%-*})) $((10#${STEWARD_WINDOW#*-})); }
# the window plus the hour before it: master's own gate runs on the eve, so the
# night starts knowing whether master is green (no Claude is spent on the eve)
in_eve_or_window() { in_hours $(( (10#${STEWARD_WINDOW%-*} + 23) % 24 )) $((10#${STEWARD_WINDOW#*-})); }

# ── trusted copies ──────────────────────────────────────────────────────────
# The agent works in $REPO and may edit anything there, steward/ included. So
# the code that JUDGES its work never runs from the tree it just left: policy.mjs
# comes from origin/master, extracted before the agent starts. (run-once.sh
# itself is extracted from origin/master by the unit's ExecStartPre.)
trust() {
  g show origin/master:steward/policy.mjs > "$BIN/policy.mjs" || { log "cannot extract policy.mjs from origin/master"; exit 1; }
  # the owner's channel: it decides what an owner message means, so it is judged code too
  g show origin/master:steward/discord.mjs > "$BIN/discord.mjs" 2>/dev/null || rm -f "$BIN/discord.mjs"
}

# ── the owner's replies on Discord → the same actions as steward/review.sh ──
discord_sync() {
  [ -f "$BIN/discord.mjs" ] || return 0
  local acts verb item why approved=0
  acts=$(discord sync 2>>"$LOGS/runner.log") || log "discord sync failed (see the lines above)"
  [ -n "$acts" ] || return 0
  while read -r verb item why; do
    case "$verb" in
      approve)
        if [ "$STEWARD_MODE" = live ]; then
          g push -q origin "refs/remotes/origin/steward/$item:refs/heads/steward-approved/$item" ":refs/heads/steward/$item" && approved=1
        else log "DRY: would approve $item"; fi
        journal "$item" approved by=owner via=discord; log "approved on Discord: $item" ;;
      reject|retry)
        if [ "$STEWARD_MODE" = live ] && g rev-parse -q --verify "origin/steward/$item" >/dev/null; then
          g push -q origin "refs/remotes/origin/steward/$item:refs/archive/steward/$item" ":refs/heads/steward/$item"
        fi
        mv -f "$STATE/handoffs/$item.md" "$STATE/handoffs/done/" 2>/dev/null; rm -f "$STATE/redgate/$item.json"
        journal "$item" "$([ "$verb" = retry ] && echo rejected-retry || echo rejected)" note="$why" by=owner via=discord
        log "$verb on Discord: $item — $why" ;;
      pause)  touch "$STATE/paused"; log "paused from Discord" ;;
      resume) rm -f "$STATE/paused" "$STATE/backoff-until"; log "resumed from Discord" ;;
    esac
  done <<<"$acts"
  [ $approved = 1 ] && g fetch -q --prune origin '+refs/heads/*:refs/remotes/origin/*'
  return 0
}

# a staged branch the owner must look at always has a handoff — it is what the
# Discord post (and review.sh status) is made from
ensure_handoff() { # item needs [detail]
  local f="$STATE/handoffs/$(slug "$1").md"
  [ -f "$f" ] && return 0
  local title; title=$(jq -r '.title // empty' "$STATE/outcome.json" 2>/dev/null)
  printf '# %s — %s\n\n**Needs from you:** %s\n\n## What I found\n%s\n\n## What I changed\nBranch `steward/%s`.%s\n' \
    "$1" "${title:-staged branch}" "$2" "$(jq -r '.summary // "(no write-up — see the branch)"' "$STATE/outcome.json" 2>/dev/null)" "$(slug "$1")" "${3:+ $3}" > "$f"
}
policy() { (cd "$REPO" && node "$BIN/policy.mjs" "$@"); }

# ── master's own gate ───────────────────────────────────────────────────────
# $STATE/master-gate.json = {sha, rc, log, failures[]} for the last master sha
# gated. A red master turns every branch red, so the queue puts `fix-master`
# first and holds repairs until it is green (2026-11-03: one hand-written path
# in steward/ made every one of the night's six gates red).
MG="$STATE/master-gate.json"
mg_record() { # sha rc log
  local fails='[]'
  [ "$2" != 0 ] && [ -f "$3" ] && fails=$(grep -E '^not ok' "$3" | sed -E 's/^not ok [0-9]+ - //' | head -20 | jq -Rsc 'split("\n")|map(select(length>0))')
  jq -cn --arg s "$1" --argjson rc "$2" --arg l "$3" --argjson f "$fails" --arg ts "$(date -u +%FT%TZ)" \
    '{sha:$s,rc:$rc,log:$l,failures:$f,ts:$ts}' > "$MG"
}
mg_red_at() { [ -f "$MG" ] && [ "$(jq -r .sha "$MG")" = "$1" ] && [ "$(jq -r .rc "$MG")" != 0 ]; }
mg_green_at() { [ -f "$MG" ] && [ "$(jq -r .sha "$MG")" = "$1" ] && [ "$(jq -r .rc "$MG")" = 0 ]; }

master_gate() { # make $MG describe origin/master; 0 = green
  local sha glog rc; sha=$(g rev-parse origin/master)
  if [ -f "$MG" ] && [ "$(jq -r .sha "$MG")" = "$sha" ]; then mg_green_at "$sha"; return; fi
  clean_tree origin/master
  governor_on || return 1
  deps
  glog=$(gate master); rc=$?
  mg_record "$sha" "$rc" "$glog"
  if [ $rc -ne 0 ]; then
    log "master $(g rev-parse --short "$sha") is RED: $(jq -r '.failures|join(" | ")' "$MG" | cut -c1-300)"
    journal master master-red sha="$sha" gate="$glog"
    notify "master $(g rev-parse --short "$sha") is red on its own gate — fix-master goes first tonight: $(jq -r '.failures[0] // "see the log"' "$MG")"
    return 1
  fi
  log "master $(g rev-parse --short "$sha") is green"
  # a fix-master the owner (or a ship) resolved: the next red master may be offered again
  local last; last=$(jq -r 'select(.item=="fix-master")|.outcome' "$STATE/journal.jsonl" 2>/dev/null | tail -1)
  [ -n "$last" ] && [ "$last" != resolved ] && journal fix-master resolved sha="$sha"
  return 0
}

# ── the fetched report snapshot belongs to triage alone ─────────────────────
# fetch-reports writes the server's new rows into client/ledgers/*.snapshot.jsonl.
# Committed by any other item (the runner's own "uncommitted work" commit swept
# them in on 2026-11-03), they turn 70-playtest-ledger red on that branch.
restore_fetched() { # item start_sha
  [ "$1" = triage ] && return 0
  [ -s "$STATE/fetched.txt" ] || return 0
  local f changed=0
  while read -r f; do
    [ -n "$f" ] || continue
    if ! g diff --quiet "$2" -- "$f" 2>/dev/null; then g checkout -q "$2" -- "$f" && changed=1; fi
  done < "$STATE/fetched.txt"
  if [ $changed = 1 ] && ! g diff --cached --quiet; then
    g commit -qm "steward: the fetched report snapshot goes back to master's" \
      -m "Only a triage run ledgers new report rows; on any other branch they turn 70-playtest-ledger red."
  fi
}

# ── red only because master was: re-gate, no Claude ─────────────────────────
# A redgate entry with masterRed=true was gated while master's own gate was red.
# Once master is green it gets one mechanical rebase + gate; green → it goes
# where the agent meant it to (ship through the policy, or stage); still red →
# masterRed is cleared and the agent's repair line takes over.
regate_master_red() {
  local f item sha intent glog rc pol
  for f in "$STATE"/redgate/*.json; do
    [ -e "$f" ] || continue
    [ "$(jq -r '.masterRed // false' "$f")" = true ] || continue
    item=$(jq -r .item "$f"); sha=$(jq -r '.sha // empty' "$f"); intent=$(jq -r '.intent // "stage"' "$f")
    [ -n "$sha" ] || sha=$(g rev-parse -q --verify "$(jq -r .branch "$f")") || { jq '.masterRed=false' "$f" > "$f.t" && mv "$f.t" "$f"; continue; }
    governor_on || return 0
    log "re-gating $item (red while master was red) on green master"
    clean_tree "$sha"
    if ! g rebase -q origin/master >/dev/null 2>&1; then
      g rebase --abort; jq '.masterRed=false' "$f" > "$f.t" && mv "$f.t" "$f"; log "$item: rebase conflicts — left for a repair"; continue
    fi
    glog=$(gate "$(slug "$item")-regate"); rc=$?
    if [ $rc -ne 0 ]; then
      jq --arg l "$glog" --arg s "$(g rev-parse HEAD)" '.masterRed=false | .log=$l | .sha=$s' "$f" > "$f.t" && mv "$f.t" "$f"
      journal "$(slug "$item")" gate-red branch="$(jq -r .branch "$f")" gate="$glog" note="still red on a green master — a repair is queued"
      continue
    fi
    rm -f "$f"
    pol=$(policy origin/master HEAD)
    local final branch=""
    if [ "$intent" = ship ] && [ "$(jq -r .verdict <<<"$pol")" = ship ] && ship_head "$item" origin/master >/dev/null; then
      final=shipped
      [ "$STEWARD_MODE" = live ] && g push -q origin ":refs/heads/steward/$(slug "$item")" 2>/dev/null
      # it is on master: whatever its handoff asked of the owner is answered
      mv -f "$STATE/handoffs/$(slug "$item").md" "$STATE/handoffs/done/" 2>/dev/null
    else
      branch=$(stage_head "$item"); final=staged
      rm -f "$STATE/outcome.json"   # ensure_handoff must not borrow tonight's verdict for an older branch
      ensure_handoff "$item" "approve the branch (or reject it with a reason)" "Re-gated green once master was. $(jq -r '.reasons|join("; ")' <<<"$pol")"
    fi
    [ "$STEWARD_MODE" != live ] && final="dry-$final"
    journal "$(slug "$item")" "$final" branch="$branch" gate="$glog" policy="$(jq -r '.reasons|join("; ")' <<<"$pol")" sha="$(g rev-parse --short HEAD)" note="re-gated green once master was"
    notify "$item → $final (re-gated once master went green)${branch:+ (branch $branch)}"
  done
}

# seconds until the window closes (for the run's timeout)
window_left() {
  local end=$((10#${STEWARD_WINDOW#*-})) now endts
  now=$(date +%s)
  endts=$(TZ="$STEWARD_TZ" date -d "today $end:00" +%s)
  [ "$endts" -le "$now" ] && endts=$(TZ="$STEWARD_TZ" date -d "tomorrow $end:00" +%s)
  echo $((endts - now))
}

clean_tree() { # back to a pristine detached origin/master; ignored files (node_modules, .venv, var) survive
  g rebase --abort >/dev/null 2>&1; g merge --abort >/dev/null 2>&1
  g checkout -q --detach "${1:-origin/master}" && g reset -q --hard && g clean -fdq
}

# keep deps in step with the lockfiles
deps() {
  local h; h=$(cat "$REPO"/client/engine/package-lock.json "$REPO"/client/server/package-lock.json "$REPO"/bot/requirements.txt | sha1sum | cut -c1-12)
  [ "$(cat "$STATE/.deps" 2>/dev/null)" = "$h" ] && return 0
  log "deps changed → npm ci / pip install"
  npm --prefix "$REPO/client/engine" ci --no-audit --no-fund >>"$LOGS/deps.log" 2>&1 \
    && npm --prefix "$REPO/client/server" ci --no-audit --no-fund >>"$LOGS/deps.log" 2>&1 \
    && VIRTUAL_ENV="$REPO/.venv" uv pip install -q -r "$REPO/bot/requirements.txt" >>"$LOGS/deps.log" 2>&1 \
    && echo "$h" > "$STATE/.deps"
}

# the whole gate, here, once. echoes the log path; returns its exit status
gate() {
  local tag="$1" glog="$LOGS/gate-$TS-$1.log" rc
  log "gate ($tag) → $glog"
  npm --prefix "$REPO/client/ui" run build >/dev/null 2>&1
  timeout "$((STEWARD_GATE_MIN * 60))" bash -c "$STEWARD_GATE_CMD" >"$glog" 2>&1; rc=$?
  echo "EXIT $rc" >>"$glog"
  log "gate ($tag) EXIT $rc"
  echo "$glog"; return $rc
}

# ── deploy ─────────────────────────────────────────────────────────────────
vps() { ssh -o BatchMode=yes -o ConnectTimeout=15 "$VPS" "$@"; }

# merge a deploy request into state/pending-deploy (flags OR together)
want_deploy() { # restartGame restartBot why
  local cur='{"restartGame":false,"restartBot":false,"why":[]}'
  [ -f "$STATE/pending-deploy" ] && cur=$(cat "$STATE/pending-deploy")
  jq -c --argjson g "$1" --argjson b "$2" --arg w "$3" \
    '.restartGame = (.restartGame or $g) | .restartBot = (.restartBot or $b) | .why += [$w]' <<<"$cur" > "$STATE/pending-deploy"
}

try_deploy() {
  [ -f "$STATE/pending-deploy" ] || return 0
  local p rg rb why busy prev out
  p=$(cat "$STATE/pending-deploy"); rg=$(jq -r .restartGame <<<"$p"); rb=$(jq -r .restartBot <<<"$p"); why=$(jq -r '.why|join("; ")' <<<"$p")
  if [ "$STEWARD_MODE" != live ]; then log "DRY: would deploy (game=$rg bot=$rb): $why"; rm -f "$STATE/pending-deploy"; return 0; fi
  if [ "$rg" = true ] || [ "$rb" = true ]; then
    busy=$(vps "find $VREPO/var/games $VREPO/var/challenges -name '*.json' -mmin -$STEWARD_IDLE_MIN 2>/dev/null | wc -l") || { log "deploy: VPS unreachable, will retry"; return 0; }
    if [ "${busy:-1}" -gt 0 ]; then log "deploy waiting: $busy game file(s) touched in the last $STEWARD_IDLE_MIN min"; return 0; fi
  fi
  log "deploy (game=$rg bot=$rb): $why"
  out=$(vps "set -e; cd $VREPO
    test -z \"\$(git status --porcelain --untracked-files=no)\" || { echo DIRTY; exit 3; }
    test \"\$(git rev-parse --abbrev-ref HEAD)\" = master || { echo NOT-MASTER; exit 3; }
    prev=\$(git rev-parse HEAD)
    git pull -q --ff-only
    if ! git diff --quiet \$prev HEAD -- client/engine/package-lock.json client/server/package-lock.json; then
      npm --prefix client/engine ci --no-audit --no-fund >/dev/null && npm --prefix client/server ci --no-audit --no-fund >/dev/null; fi
    if ! git diff --quiet \$prev HEAD -- bot/requirements.txt; then .venv/bin/pip install -q -r bot/requirements.txt; fi
    npm --prefix client/ui run build >/dev/null 2>&1
    echo PREV \$prev NOW \$(git rev-parse HEAD)" 2>&1)
  if ! grep -q '^PREV ' <<<"$out"; then
    log "deploy REFUSED on the box: $out"; journal deploy deploy-refused detail="$out"
    notify "deploy refused on the VPS ($out) — the box checkout needs a human; steward paused"; touch "$STATE/paused"; return 1
  fi
  prev=$(awk '/^PREV/{print $2}' <<<"$out")
  local units=""; [ "$rg" = true ] && units="algomancy-game"; [ "$rb" = true ] && units="$units algomancy-web algomancy-bot"
  [ -n "$units" ] && vps "sudo systemctl restart $units"
  local ok=0
  for _ in $(seq 1 30); do
    if curl -fsS -m 10 -o /dev/null "$SITE/" && { [ -z "$units" ] || vps "systemctl is-active -q $units"; }; then ok=1; break; fi
    sleep 4
  done
  if [ $ok = 1 ]; then
    log "deployed $(awk '/^PREV/{print $4}' <<<"$out") (was $prev)"; journal deploy deployed sha="$(awk '/^PREV/{print $4}' <<<"$out")" units="$units" why="$why"
    rm -f "$STATE/pending-deploy"; notify "deployed: $why"
  else
    log "deploy FAILED health check → rolling back to $prev"
    vps "set -e; cd $VREPO; git reset -q --hard $prev; npm --prefix client/ui run build >/dev/null 2>&1; ${units:+sudo systemctl restart $units}" || true
    journal deploy deploy-rolled-back sha="$prev" why="$why"
    touch "$STATE/paused"; notify "⚠ deploy failed its health check and was ROLLED BACK to $prev; steward paused. Why: $why"
    return 1
  fi
}

# push HEAD to master (rebasing onto a moved master, re-gating if it moved); echo the policy json
ship_head() { # item base
  local item="$1" base="$2" pol
  g fetch -q origin master
  if [ "$(g rev-parse origin/master)" != "$(g rev-parse "$base")" ]; then
    if ! g rebase -q origin/master >/dev/null 2>&1; then g rebase --abort; log "$item: master moved and the rebase conflicts"; return 2; fi
    gate "$(slug "$item")-rebased" >/dev/null || return 3
  fi
  pol=$(policy origin/master HEAD)
  if [ "$STEWARD_MODE" != live ]; then
    g push -q -f origin "HEAD:refs/steward-dry/$(slug "$item")" || true
    log "DRY: would push $(g rev-parse --short HEAD) to master (kept at refs/steward-dry/$(slug "$item"))"; echo "$pol"; return 0
  fi
  g push -q origin HEAD:refs/heads/master || { log "$item: push to master refused"; return 2; }
  mg_record "$(g rev-parse HEAD)" 0 "(gated green as $item)"
  want_deploy "$(jq .deploy.restartGame <<<"$pol")" "$(jq .deploy.restartBot <<<"$pol")" "$item"
  echo "$pol"
}

stage_head() { # item → pushes steward/<slug>
  local b="steward/$(slug "$1")"
  if [ "$STEWARD_MODE" = live ]; then g push -q -f origin "HEAD:refs/heads/$b" || log "push of $b failed"
  else g push -q -f origin "HEAD:refs/steward-dry/$(slug "$1")" || true; log "DRY: would push $b (kept at refs/steward-dry/$(slug "$1"))"; fi
  echo "$b"
}

# ── 1a. approved branches: the owner signed off; land them ────────────────
land_approved() {
  local ref item glog rc
  for ref in $(g for-each-ref --format='%(refname:short)' refs/remotes/origin/steward-approved/); do
    item="${ref#origin/steward-approved/}"
    governor_on || return 0
    log "landing approved $item"
    clean_tree "$ref"
    if ! g rebase -q origin/master >/dev/null 2>&1; then
      g rebase --abort
      jq -cn --arg b "$ref" --arg i "$item" --arg l "rebase conflict onto master" '{branch:$b,item:$i,log:$l,tries:0}' > "$STATE/redgate/$item.json"
      journal "$item" approved-conflict branch="$ref"; continue
    fi
    glog=$(gate "approved-$item"); rc=$?
    if [ $rc -ne 0 ]; then
      jq -cn --arg b "$ref" --arg i "$item" --arg l "$glog" '{branch:$b,item:$i,log:$l,tries:0}' > "$STATE/redgate/$item.json"
      journal "$item" approved-gate-red branch="$ref" gate="$glog"; continue
    fi
    if ship_head "$item" origin/master >/dev/null; then
      if [ "$STEWARD_MODE" = live ]; then
        g push -q origin "$ref:refs/archive/steward/$item" ":refs/heads/steward-approved/$item" || true
      fi
      mv -f "$STATE/handoffs/$item.md" "$STATE/handoffs/done/" 2>/dev/null
      journal "$item" landed sha="$(g rev-parse HEAD)"; notify "landed (approved): $item"
    else
      journal "$item" approved-conflict branch="$ref"
    fi
  done
}

# a red branch → state/redgate/<item>.json; keep an existing entry's tries
redgate() { # branch item log intent base_sha
  local f="$STATE/redgate/$(slug "$2").json" tries=0 mr=false
  [ -f "$f" ] && tries=$(jq '.tries // 0' "$f")
  mg_red_at "$5" && mr=true
  jq -cn --arg b "origin/$1" --arg i "$2" --arg l "$3" --arg in "$4" --arg s "$(g rev-parse HEAD)" --argjson t "$tries" --argjson mr $mr \
    '{branch:$b,item:$i,log:$l,intent:$in,sha:$s,tries:$t,masterRed:$mr}' > "$f"
}

# ── 2. the night's item ──────────────────────────────────────────────────
work_one() {
  clean_tree origin/master
  governor_on || return 0
  deps
  npm --prefix "$REPO/client/ui" run build >/dev/null 2>&1

  # step 0 of every round: bring the reports down (writes the snapshots in the clone)
  (cd "$REPO" && bash -c "$STEWARD_FETCH_CMD") >>"$LOGS/reports.log" 2>&1 || log "report fetch failed (see reports.log)"
  g diff --name-only -- client/ledgers/ > "$STATE/fetched.txt"
  # any branch a repair line will name must exist locally
  STEWARD_STATE="$STATE" node "$REPO/steward/queue.mjs" --why > "$STATE/queue.txt" 2>"$STATE/queue.excluded"
  if [ ! -s "$STATE/queue.txt" ]; then log "queue empty — nothing to do"; journal idle idle; return 0; fi
  local first; first=$(head -1 "$STATE/queue.txt")
  log "queue: $(wc -l <"$STATE/queue.txt") items; first: $first"

  # the agent's leash: git over ssh refuses; ssh/scp/push denied in its settings
  cat > "$BIN/git-ssh-guard" <<'EOF'
#!/bin/sh
echo "steward: git network access is the runner's job, not yours (fetch/push refused)" >&2; exit 1
EOF
  chmod +x "$BIN/git-ssh-guard"
  cp "$REPO/steward/claude-settings.json" "$BIN/claude-settings.json"

  rm -f "$STATE/outcome.json"
  local start_sha; start_sha=$(g rev-parse HEAD)
  # a repair = an item that had a red branch before this run (whichever queue line the agent took)
  local pre_red; pre_red=" $(ls "$STATE/redgate" 2>/dev/null | tr '\n' ' ')"
  local left; left=$(window_left); local cap=$((STEWARD_RUN_HOURS * 3600))
  [ "$left" -lt "$cap" ] && cap=$((left + 1800))
  local prompt
  prompt="You are the Algomancy steward, running unattended on the home box. Read .claude/skills/steward/SKILL.md in full and follow it exactly, for ONE item. Your state directory is $STATE (exported as STEWARD_STATE); tonight's queue is $STATE/queue.txt. Today is $(date -u +%F) UTC. You have about $((cap / 60)) minutes. Before you stop, make sure $STATE/outcome.json exists and your work is committed."
  log "claude: up to $((cap / 60)) min, model $STEWARD_MODEL"
  local rlog="$LOGS/run-$TS.jsonl" rc
  ( cd "$REPO" && GIT_SSH_COMMAND="$BIN/git-ssh-guard" STEWARD_STATE="$STATE" \
      timeout "$cap" "$STEWARD_CLAUDE_BIN" -p "$prompt" --model "$STEWARD_MODEL" \
        --settings "$BIN/claude-settings.json" --permission-mode acceptEdits \
        --output-format stream-json --verbose ) >"$rlog" 2>"$LOGS/run-$TS.err"; rc=$?
  log "claude exited $rc"

  # usage limit → sleep until it resets, and do not count it against the item
  if tail -c 4000 "$rlog" "$LOGS/run-$TS.err" | grep -qiE 'usage limit|hit your limit|rate.?limit|limit reached|overloaded'; then
    local reset; reset=$(tail -c 4000 "$rlog" | grep -oE 'limit reached\|[0-9]{10}' | tail -1 | cut -d'|' -f2)
    [ -z "$reset" ] && reset=$(( $(date +%s) + 3600 ))
    echo "$reset" > "$STATE/backoff-until"
    log "usage limit — backing off until $(date -d @"$reset" -u +%FT%TZ)"; journal limit limited until="$reset"
    clean_tree; return 0
  fi

  # what did it do?
  local item outcome title summary
  if [ -s "$STATE/outcome.json" ] && jq -e . "$STATE/outcome.json" >/dev/null 2>&1; then
    item=$(jq -r '.item // empty' "$STATE/outcome.json"); outcome=$(jq -r '.outcome // empty' "$STATE/outcome.json")
    title=$(jq -r '.title // ""' "$STATE/outcome.json"); summary=$(jq -r '.summary // ""' "$STATE/outcome.json")
  fi
  if [ -z "${item:-}" ]; then
    item=$(awk '{print ($1=="report"||$1=="repair"||$1=="resume"||$1=="triage") ? $2 : $1}' <<<"$first")
    [ "${first%% *}" = triage ] && item=triage
    outcome=failed; title="(no verdict written)"; summary="claude exited $rc without an outcome.json (timeout=124)"
  fi
  cp "$STATE/outcome.json" "$STATE/outcomes/$TS-$(slug "$item").json" 2>/dev/null

  # the fetched snapshot is triage's; put it back on any other item (committed or not)
  restore_fetched "$item" "$start_sha"
  # uncommitted work is kept, never shipped
  if [ -n "$(g status --porcelain)" ]; then
    g add -A && g commit -qm "steward: uncommitted work at the end of the $item run" -m "Committed by the runner so nothing is lost; never shipped as-is."
    [ "$outcome" = ship ] && outcome=stage
  fi
  local ncommits; ncommits=$(g rev-list --count origin/master..HEAD)
  log "$item → $outcome ($ncommits commit(s)): $title"

  local final="$outcome" branch="" glog="" pol="" reasons=""
  case "$outcome" in
    ship|already-fixed|not-a-bug)
      if [ "$ncommits" -gt 0 ]; then
        pol=$(policy origin/master HEAD); reasons=$(jq -r '.reasons|join("; ")' <<<"$pol")
        glog=$(gate "$(slug "$item")"); local grc=$?
        if [ $grc -ne 0 ]; then
          branch=$(stage_head "$item"); final=gate-red
          redgate "$branch" "$item" "$glog" "$([ "$(jq -r .verdict <<<"$pol")" = ship ] && [ "$outcome" = ship ] && echo ship || echo stage)" "$start_sha"
        elif [ "$(jq -r .verdict <<<"$pol")" = ship ]; then
          if ship_head "$item" origin/master >/dev/null; then final=shipped; else branch=$(stage_head "$item"); final=staged; reasons="${reasons:+$reasons; }could not land on a moved master"; fi
        else
          branch=$(stage_head "$item"); final=staged
        fi
      fi ;;
    stage)
      glog=$(gate "$(slug "$item")"); local src=$?
      branch=$(stage_head "$item")
      if [ $src -ne 0 ]; then final=gate-red
        redgate "$branch" "$item" "$glog" stage "$start_sha"
      else final=staged; fi ;;
    needs-human|gave-up)
      [ "$ncommits" -gt 0 ] && branch=$(stage_head "$item") ;;
  esac

  # a repair that went red again is the owner's now
  local rg="$STATE/redgate/$(slug "$item").json"
  local was_repair=0; [[ "$pre_red" == *" $(slug "$item").json "* ]] && was_repair=1
  if [ $was_repair = 1 ] && [ "$final" = gate-red ] && [ -f "$rg" ]; then
    # red because master was red is not the agent's miss: it does not use up a try
    if [ "$(jq -r '.masterRed // false' "$rg")" != true ]; then
      local tries; tries=$(jq '.tries // 0' "$rg")
      if [ "$tries" -ge 1 ]; then rm -f "$rg"; final=gate-red-twice; else jq '.tries += 1' "$rg" > "$rg.t" && mv "$rg.t" "$rg"; fi
    fi
  elif [ $was_repair = 1 ] && [ "$final" != gate-red ]; then
    rm -f "$STATE/redgate/"*"$(slug "$item")"*.json 2>/dev/null
  fi
  # a resumed item has used its answer
  [ -f "$STATE/answers/$(slug "$item").md" ] && mv -f "$STATE/answers/$(slug "$item").md" "$STATE/answers/done/"

  case "$final" in
    staged) ensure_handoff "$item" "approve the branch (or reject it with a reason)" "${reasons:+Not shipped on its own because: $reasons.}" ;;
    gate-red-twice) ensure_handoff "$item" "the gate went red twice — look at the branch, or reject it" "Gate log: $glog" ;;
    needs-human) ensure_handoff "$item" "a decision (the summary below says which)" ;;
    shipped|already-fixed|not-a-bug) mv -f "$STATE/handoffs/$(slug "$item").md" "$STATE/handoffs/done/" 2>/dev/null ;;
  esac
  [ "$STEWARD_MODE" != live ] && final="dry-$final"
  journal "$(slug "$item")" "$final" title="$title" summary="$summary" branch="$branch" gate="$glog" policy="$reasons" \
    sha="$(g rev-parse --short HEAD)" run="$rlog" minutes="$(( ( $(date +%s) - START ) / 60 ))"
  notify "$item → $final: $title${branch:+ (branch $branch)}"
  clean_tree
}

# heavy work (deps, the gate, claude) only under the thermal governor
governor_on() {
  [ -n "${GOV_PID:-}" ] && return 0
  if ! STEWARD_ROOT="$ROOT" "$REPO/steward/thermal.sh" check 2>>"$LOGS/runner.log"; then
    log "thermal cap not installed — refusing heavy work (the box must stay silent)"; return 1
  fi
  STEWARD_ROOT="$ROOT" "$REPO/steward/thermal.sh" run 9>&- & GOV_PID=$!   # 9>&-: the governor must not hold the tick lock
  cp "$REPO/steward/thermal.sh" "$BIN/thermal.sh"
  trap 'kill $GOV_PID 2>/dev/null; "$BIN/thermal.sh" floor' EXIT
  sleep 1
}

main() {
  START=$(date +%s)
  exec 9>"$STATE/lock"; flock -n 9 || { log "another tick is running"; exit 0; }
  [ -d "$REPO/.git" ] || { log "no clone at $REPO"; exit 1; }
  g fetch -q --prune origin '+refs/heads/*:refs/remotes/origin/*' || { log "git fetch failed"; exit 0; }
  trust
  discord_sync

  try_deploy
  [ -f "$STATE/paused" ] && { log "paused ($STATE/paused)"; exit 0; }
  land_approved
  try_deploy

  # the eve and the night: know master's colour; re-gate what was red only because of it
  if in_eve_or_window; then
    master_gate && regate_master_red
    try_deploy
  fi
  if ! in_window; then
    # the morning summary, once a day, after the window closes (discord.mjs keeps the day)
    in_hours $((10#${STEWARD_WINDOW#*-})) $(( (10#${STEWARD_WINDOW%-*} + 23) % 24 )) && [ -f "$BIN/discord.mjs" ] && { discord summary 2>>"$LOGS/runner.log" || true; }
    discord_sync
    exit 0
  fi
  if [ -f "$STATE/backoff-until" ] && [ "$(date +%s)" -lt "$(cat "$STATE/backoff-until")" ]; then exit 0; fi
  # no new item in the last hour of the window: a cut-off run wastes the night
  [ "$(window_left)" -lt 3600 ] && exit 0
  work_one
  try_deploy
  discord_sync
}

main "$@"
