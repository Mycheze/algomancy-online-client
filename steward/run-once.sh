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
: "${STEWARD_MODE:=dry}"              # dry = never push or deploy; live = for real
: "${STEWARD_MODEL:=opus}"
: "${STEWARD_RUN_HOURS:=4}"           # one item's hard cap
: "${STEWARD_GATE_MIN:=120}"
: "${STEWARD_IDLE_MIN:=10}"           # a game file touched this recently = someone is playing
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

notify() {
  [ -n "${STEWARD_WEBHOOK:-}" ] || return 0
  jq -cn --arg c "🛠 steward: $*" '{content:$c[0:1900]}' \
    | curl -fsS -m 15 -H 'content-type: application/json' -d @- "$STEWARD_WEBHOOK" >/dev/null || true
}

slug() { echo "$1" | sed -E 's/^#/report-/; s/[^A-Za-z0-9._-]+/-/g; s/^-+|-+$//g' | cut -c1-60; }

g() { git -C "$REPO" "$@"; }

in_window() {
  local h start end; h=$((10#$(TZ="$STEWARD_TZ" date +%H))); start=$((10#${STEWARD_WINDOW%-*})); end=$((10#${STEWARD_WINDOW#*-}))
  if [ "$start" -le "$end" ]; then [ "$h" -ge "$start" ] && [ "$h" -lt "$end" ]
  else [ "$h" -ge "$start" ] || [ "$h" -lt "$end" ]; fi
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
  timeout "$((STEWARD_GATE_MIN * 60))" npm --prefix "$REPO/client" run check >"$glog" 2>&1; rc=$?
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
  pol=$(node "$REPO/steward/policy.mjs" origin/master HEAD)
  if [ "$STEWARD_MODE" != live ]; then log "DRY: would push $(g rev-parse --short HEAD) to master"; echo "$pol"; return 0; fi
  g push -q origin HEAD:refs/heads/master || { log "$item: push to master refused"; return 2; }
  want_deploy "$(jq .deploy.restartGame <<<"$pol")" "$(jq .deploy.restartBot <<<"$pol")" "$item"
  echo "$pol"
}

stage_head() { # item → pushes steward/<slug>
  local b="steward/$(slug "$1")"
  if [ "$STEWARD_MODE" = live ]; then g push -q -f origin "HEAD:refs/heads/$b" || log "push of $b failed"
  else g update-ref "refs/steward/$(slug "$1")" HEAD; log "DRY: would push $b"; fi
  echo "$b"
}

# ── 1a. approved branches: the owner signed off; land them ────────────────
land_approved() {
  local ref item glog rc
  for ref in $(g for-each-ref --format='%(refname:short)' refs/remotes/origin/steward-approved/); do
    item="${ref#origin/steward-approved/}"
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

# ── 2. the night's item ──────────────────────────────────────────────────
work_one() {
  clean_tree origin/master
  deps
  npm --prefix "$REPO/client/ui" run build >/dev/null 2>&1

  # step 0 of every round: bring the reports down (writes the snapshots in the clone)
  node "$REPO/client/engine/scripts/fetch-reports.mjs" >>"$LOGS/reports.log" 2>&1 || log "report fetch failed (see reports.log)"
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
  local left; left=$(window_left); local cap=$((STEWARD_RUN_HOURS * 3600))
  [ "$left" -lt "$cap" ] && cap=$((left + 1800))
  local prompt
  prompt="You are the Algomancy steward, running unattended on the home box. Read .claude/skills/steward/SKILL.md in full and follow it exactly, for ONE item. Your state directory is $STATE (exported as STEWARD_STATE); tonight's queue is $STATE/queue.txt. Today is $(date -u +%F) UTC. You have about $((cap / 60)) minutes. Before you stop, make sure $STATE/outcome.json exists and your work is committed."
  log "claude: up to $((cap / 60)) min, model $STEWARD_MODEL"
  local rlog="$LOGS/run-$TS.jsonl" rc
  ( cd "$REPO" && GIT_SSH_COMMAND="$BIN/git-ssh-guard" STEWARD_STATE="$STATE" \
      timeout "$cap" claude -p "$prompt" --model "$STEWARD_MODEL" \
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
        pol=$(node "$REPO/steward/policy.mjs" origin/master HEAD); reasons=$(jq -r '.reasons|join("; ")' <<<"$pol")
        glog=$(gate "$(slug "$item")"); local grc=$?
        if [ $grc -ne 0 ]; then
          branch=$(stage_head "$item"); final=gate-red
          jq -cn --arg b "$branch" --arg i "$item" --arg l "$glog" '{branch:("origin/"+$b),item:$i,log:$l,tries:0}' > "$STATE/redgate/$(slug "$item").json"
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
        jq -cn --arg b "$branch" --arg i "$item" --arg l "$glog" '{branch:("origin/"+$b),item:$i,log:$l,tries:0}' > "$STATE/redgate/$(slug "$item").json"
      else final=staged; fi ;;
    needs-human|gave-up)
      [ "$ncommits" -gt 0 ] && branch=$(stage_head "$item") ;;
  esac

  # a repair that went red again is the owner's now
  local rg="$STATE/redgate/$(slug "$item").json"
  if [ "${first%% *}" = repair ] && [ "$final" = gate-red ] && [ -f "$rg" ]; then
    local tries; tries=$(jq .tries "$rg")
    if [ "$tries" -ge 1 ]; then rm -f "$rg"; final=gate-red-twice; else jq '.tries += 1' "$rg" > "$rg.t" && mv "$rg.t" "$rg"; fi
  elif [ "${first%% *}" = repair ] && [ "$final" != gate-red ]; then
    rm -f "$STATE/redgate/"*"$(slug "$item")"*.json 2>/dev/null
  fi
  # a resumed item has used its answer
  [ -f "$STATE/answers/$(slug "$item").md" ] && mv -f "$STATE/answers/$(slug "$item").md" "$STATE/answers/done/"

  journal "$(slug "$item")" "$final" title="$title" summary="$summary" branch="$branch" gate="$glog" policy="$reasons" \
    sha="$(g rev-parse --short HEAD)" run="$rlog" minutes="$(( ( $(date +%s) - START ) / 60 ))"
  notify "$item → $final: $title${branch:+ (branch $branch)}"
  clean_tree
}

main() {
  START=$(date +%s)
  exec 9>"$STATE/lock"; flock -n 9 || { log "another tick is running"; exit 0; }
  [ -d "$REPO/.git" ] || { log "no clone at $REPO"; exit 1; }
  g fetch -q --prune origin '+refs/heads/*:refs/remotes/origin/*' || { log "git fetch failed"; exit 0; }

  try_deploy
  [ -f "$STATE/paused" ] && { log "paused ($STATE/paused)"; exit 0; }
  land_approved
  try_deploy

  in_window || exit 0
  if [ -f "$STATE/backoff-until" ] && [ "$(date +%s)" -lt "$(cat "$STATE/backoff-until")" ]; then exit 0; fi
  # no new item in the last hour of the window: a cut-off run wastes the night
  [ "$(window_left)" -lt 3600 ] && exit 0
  work_one
  try_deploy
}

main "$@"
