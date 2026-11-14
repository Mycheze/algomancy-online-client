#!/usr/bin/env bash
# Exercise run-once.sh end to end with a STUB Claude and a STUB gate, in a
# scratch root — every branch of the runner in minutes instead of a night.
# Run on the home box (it needs the real clone's node_modules and the VPS alias):
#
#   ~/algomancy-steward/repo/steward/test-runner.sh            all scenarios
#   ~/algomancy-steward/repo/steward/test-runner.sh limit      one
#
# Always dry: the runner under test never touches master, a branch or the VPS
# (dry work goes to refs/steward-dry/test-*, deleted at the end).
#
# To test a runner change BEFORE it is on master, point the test clone at a
# scratch bare repo whose master is the change:
#   git clone -q --bare ~/algomancy-steward/repo ~/steward-test-origin.git     (once, on the box)
#   git push benshomeserver.local:steward-test-origin.git <branch>:master       (from the laptop)
#   STEWARD_TEST_REMOTE=~/steward-test-origin.git STEWARD_TEST_ROOT=~/steward-test-local steward/test-runner.sh
set -uo pipefail
# never Discord: run from inside a steward run (or a shell with the unit's env), these are the REAL
# bot's — 2026-11-14's retro ran two scenarios and opened a log thread in #steward with stub lines
unset STEWARD_DISCORD_TOKEN STEWARD_DISCORD_FORUM STEWARD_DISCORD_OWNER STEWARD_WEBHOOK
export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$PATH"   # the runner sets this itself; the harness's own node calls need it too
MAIN="$HOME/algomancy-steward/repo"
T="${STEWARD_TEST_ROOT:-$HOME/steward-test}"
pass=0; fail=0
ok()  { echo "  ✓ $*"; pass=$((pass + 1)); }
bad() { echo "  ✗ $*"; fail=$((fail + 1)); }

setup() {
  rm -rf "$T/state" "$T/logs" "$T/bin"; mkdir -p "$T"/{state,logs,bin}
  if [ ! -d "$T/repo/.git" ]; then
    git clone -q --reference "$MAIN" "${STEWARD_TEST_REMOTE:-git@github-steward:Mycheze/algomancy-online-client.git}" "$T/repo"
    git -C "$T/repo" config user.name "Steward Test"; git -C "$T/repo" config user.email steward-test@algomancy.online
    for d in client/engine/node_modules client/server/node_modules .venv; do ln -s "$MAIN/$d" "$T/repo/$d"; done
    for d in data/rulings/exports data/rulings/work data/rulings/needs_ocr.jsonl; do [ -e "$MAIN/$d" ] && ln -s "$MAIN/$d" "$T/repo/$d"; done
  fi
  # the runner resets its clone to origin/master every tick, so what is under test is
  # MASTER's steward/ — land a runner change first (it is inert until the timer is on)
  git -C "$T/repo" fetch -q origin && git -C "$T/repo" checkout -q --detach origin/master
  # deps(): pre-agree the lockfile hash so the test never npm-cis into the shared node_modules
  (cd "$T/repo" && cat client/engine/package-lock.json client/server/package-lock.json bot/requirements.txt bot/pipeline/requirements.txt | sha1sum | cut -c1-12) > "$T/state/.deps"
  local h; h=$(( 10#$(TZ=Europe/Prague date +%H) ))
  cat > "$T/env" <<EOF
STEWARD_MODE=dry
STEWARD_TZ=Europe/Prague
STEWARD_WINDOW=$(printf %02d $h)-$(printf %02d $(( (h + 3) % 24 )))
STEWARD_CLAUDE_BIN=$T/bin/claude-stub
STEWARD_GATE_CMD=\${STUB_GATE:-true}
STEWARD_FETCH_CMD=\${STUB_FETCH:-true}
STEWARD_SUMMARY_HOUR=24
EOF
  cat > "$T/bin/claude-stub" <<'EOF'
#!/usr/bin/env bash
# a fake `claude -p` — does what $STUB_SCENARIO says, in the runner's cwd (the clone)
S="$STEWARD_STATE"; first=$(head -1 "$S/queue.txt")
# sweep: take the first item that is NOT triage (the fetched rows are not this item's)
[ "$STUB_SCENARIO" = sweep ] && first=$(grep -v '^triage' "$S/queue.txt" | head -1)
id=$(awk '{print ($1=="report"||$1=="repair"||$1=="resume"||$1=="inbox"||$1=="retro")?$2:$1}' <<<"$first")
w() { printf '{"item":"%s","outcome":"%s","title":"stub %s","summary":"stub"}' "$id" "$1" "$1" > "$S/outcome.json"; }
case "$STUB_SCENARIO" in
  skip)        w skip ;;
  ship)        echo "<!-- steward test $(date +%s) -->" >> client/ledgers/README.md; git commit -qam "stub: ledger-only change"; w ship ;;
  ui)          echo "export {};" > client/ui/steward-test-screen.ts; git add -A; git commit -qm "stub: a new UI file (a flow)"; w ship ;;
  ui-fix)      echo "// steward test" >> client/ui/main.ts; git commit -qam "stub: a small UI fix"; w ship ;;
  stage)       echo "<!-- steward test -->" >> client/ledgers/README.md; git commit -qam "stub: staged"; w stage
               printf '# %s\n\n**Needs from you:** approve the branch\n' "$id" > "$S/handoffs/$id.md" ;;
  needs-human) w needs-human; printf '# %s\n\n**Needs from you:** answer Q1\n' "$id" > "$S/handoffs/$id.md" ;;
  dirty)       echo "<!-- uncommitted -->" >> client/ledgers/README.md; w ship ;;
  silent)      : ;;   # exits without a verdict
  limit)       echo '{"type":"result","is_error":true,"result":"Claude AI usage limit reached|'$(( $(date +%s) + 7200 ))'"}'; exit 1 ;;
  push)        git push origin HEAD:refs/heads/steward-escape 2>&1; w skip ;;
  sweep)       echo "<!-- steward test $(date +%s) -->" >> client/ledgers/README.md; git add -A; git commit -qm "stub: commits everything, fetched rows too"; w ship ;;
  tamper)      printf 'console.log(JSON.stringify({verdict:"ship",reasons:[],deploy:{needed:false,restartGame:false,restartBot:false}}))\n' > steward/policy.mjs
               echo "// steward test" >> client/ui/main.ts; git commit -qam "stub: a UI change and a policy that waves it through"; w ship ;;
esac
echo '{"type":"result","is_error":false,"result":"stub done"}'
EOF
  chmod +x "$T/bin/claude-stub"
}

# Every scenario works the queue's FIRST item, and every dry verdict takes that item off the
# queue, so the scenarios use up whatever master's ledgers offer. On 2026-11-08 that was 9 items:
# the last five scenarios ran on an empty queue and "failed" (the stub wrote a verdict for item "").
# When nothing but triage is left, forget this test's dry verdicts on LEDGER items (they sit below
# fix-master, inbox and retro in the queue, so no scenario that checks the order is disturbed).
refill() {
  [ -n "${NO_REFILL:-}" ] && return
  (cd "$T/repo" && STEWARD_STATE="$T/state" node steward/queue.mjs 2>/dev/null) | grep -v '^triage' | grep -q '[^[:space:]]' && return
  [ -f "$T/state/journal.jsonl" ] || return
  jq -c 'select((((.outcome // "") | startswith("dry-")) and ((.item // "") | test("^(BL-|CT-|report-|#)[0-9]|^tidy$"))) | not)' \
    "$T/state/journal.jsonl" > "$T/state/journal.refill" && mv "$T/state/journal.refill" "$T/state/journal.jsonl"
}

tick() { # scenario [gate]
  refill
  local t0; t0=$(wc -l 2>/dev/null < "$T/state/journal.jsonl" || echo 0)
  STUB_SCENARIO="$1" STUB_GATE="${2:-true}" STEWARD_ROOT="$T" STEWARD_CONF="$T/env" \
    bash "$T/repo/steward/run-once.sh" >>"$T/logs/test.out" 2>&1
  tail -n +"$((t0 + 1))" "$T/state/journal.jsonl" 2>/dev/null | grep -v '"outcome":"idle"' | tail -1
}
last_outcome() { jq -r .outcome <<<"$1"; }

setup
want="${1:-all}"
run() { [ "$want" = all ] || [ "$want" = "$1" ]; }

echo "runner scenarios (dry, stub claude, stub gate) — scratch root $T"
if run skip; then r=$(tick skip); [ "$(last_outcome "$r")" = dry-skip ] && ok "skip → dry-skip" || bad "skip → $r"; fi
if run skip; then # dry verdicts must not be picked again
  q1=$(head -1 "$T/state/queue.txt"); r=$(tick skip); q2=$(head -1 "$T/state/queue.txt")
  [ "$q1" != "$q2" ] && ok "the next tick moves on ($q2)" || bad "the next tick repeats the same item: $q2"; fi
if run ship; then r=$(tick ship); [ "$(last_outcome "$r")" = dry-shipped ] && ok "ledger-only ship, green gate → dry-shipped" || bad "ship → $r"; fi
if run ui; then r=$(tick ui-fix); [ "$(last_outcome "$r")" = dry-shipped ] && ok "a small fix inside an existing screen ships → dry-shipped" || bad "ui-fix → $r"; fi
if run ui; then r=$(tick ui); [ "$(last_outcome "$r")" = dry-staged ] && ok "a new UI file (a flow) asked to ship is downgraded → dry-staged ($(jq -r .policy <<<"$r" | cut -c1-50))" || bad "ui → $r"; fi
if run ui; then f="$T/state/handoffs/$(jq -r .item <<<"$r").md"; [ -f "$f" ] && grep -q '^## In short' "$f" && grep -q '^\*\*Needs from you:\*\* OK to put this live' "$f" && ok "…and a staged branch with no write-up gets a handoff (what the Discord post is made of)" || bad "no handoff at $f"; fi
if run red; then r=$(tick ship false); [ "$(last_outcome "$r")" = dry-gate-red ] && ls "$T/state/redgate/"*.json >/dev/null 2>&1 && ok "red gate → dry-gate-red + a repair entry" || bad "red → $r"
  # the NEXT queue (queue.txt is the one this tick started from, before the red)
  nq=$(cd "$T/repo" && STEWARD_STATE="$T/state" node steward/queue.mjs 2>/dev/null | head -1)
  grep -q '^repair ' <<<"$nq" && ok "the next queue starts with the repair" || bad "no repair line queued: $nq"
  rm -f "$T/state/redgate/"*.json; fi
if run stage; then r=$(tick stage); [ "$(last_outcome "$r")" = dry-staged ] && ok "stage → dry-staged, handoff written" || bad "stage → $r"; fi
if run needs-human; then r=$(tick needs-human); [ "$(last_outcome "$r")" = dry-needs-human ] && ok "needs-human → dry-needs-human" || bad "needs-human → $r"; fi
if run dirty; then r=$(tick dirty); [ "$(last_outcome "$r")" = dry-staged ] && ok "uncommitted work is committed and never shipped → dry-staged" || bad "dirty → $r"; fi
if run silent; then r=$(tick silent); [ "$(last_outcome "$r")" = dry-failed ] && ok "no verdict → dry-failed (cooled down)" || bad "silent → $r"; fi
if run limit; then r=$(tick limit); [ "$(last_outcome "$r")" = limited ] && [ -f "$T/state/backoff-until" ] && ok "usage limit → backs off, item not charged" || bad "limit → $r"
  r2=$(tick skip); [ -z "$r2" ] && ok "inside the back-off nothing runs" || bad "ran during back-off: $r2"; rm -f "$T/state/backoff-until"; fi
if run push && [ -n "${STEWARD_TEST_REMOTE:-}" ]; then echo "  - push guard not tested: a local STEWARD_TEST_REMOTE has no ssh for the guard to refuse"
elif run push; then tick push >/dev/null
  git -C "$T/repo" ls-remote origin refs/heads/steward-escape | grep -q . && bad "THE AGENT PUSHED (steward-escape exists)" || ok "the agent cannot push (git ssh guard)"; fi
if run answers; then tick skip >/dev/null; grep -q '^resume done' "$T/state/queue.txt" && bad "answers/done/ read as an item called done" || ok "answers/done/ is not an item"; fi
if run sweep; then
  r=$(STUB_FETCH='echo "{\"ts\":\"2099-01-01T00:00:00Z\",\"steward\":\"test\"}" >> client/ledgers/playtest-issues.snapshot.jsonl' tick sweep)
  ref="refs/steward-dry/$(jq -r .item <<<"$r")"; git -C "$T/repo" fetch -q origin "+$ref:$ref" 2>/dev/null
  if [ "$(last_outcome "$r")" = dry-shipped ] && ! git -C "$T/repo" diff --name-only origin/master "$ref" | grep -q snapshot; then
    ok "fetched report rows are put back on a non-triage item, and it still ships → dry-shipped"
  else bad "sweep → $r; files: $(git -C "$T/repo" diff --name-only origin/master "$ref" | tr '\n' ' ')"; fi
  git -C "$T/repo" checkout -q -- client/ledgers/ 2>/dev/null; fi
if run tamper; then r=$(tick tamper); [ "$(last_outcome "$r")" = dry-staged ] && ok "an agent-edited policy.mjs is not the one that judges → dry-staged" || bad "tamper → $r"; fi
if run master-red; then
  rm -f "$T/state/master-gate.json"; r=$(tick skip false)
  grep -q '"outcome":"master-red"' "$T/state/journal.jsonl" && ok "a red master gate is journalled (master-red)" || bad "no master-red row"
  head -1 "$T/state/queue.txt" | grep -q '^fix-master' && ok "…and fix-master is first in the queue" || bad "queue starts: $(head -1 "$T/state/queue.txt")"
  rm -f "$T/state/redgate/"*.json; fi
if run regate; then
  sha=$(git -C "$T/repo" rev-parse origin/master)
  jq -cn --arg s "$sha" '{sha:$s,rc:1,log:"(test)",failures:["a master-only failure"]}' > "$T/state/master-gate.json"
  tick ship false >/dev/null
  f=$(ls "$T/state/redgate/"*.json 2>/dev/null | head -1)
  [ -n "$f" ] && [ "$(jq -r .masterRed "$f")" = true ] && ok "a branch red while master was red is marked masterRed" || bad "redgate: $(cat $f 2>/dev/null)"
  jq -cn --arg s "$sha" '{sha:$s,rc:0,log:"(test)",failures:[]}' > "$T/state/master-gate.json"
  (cd "$T/repo" && STEWARD_STATE="$T/state" node steward/queue.mjs) | grep -q '^repair ' && bad "a masterRed branch was queued for a Claude repair" || ok "…and is not queued for a Claude repair, even on a green master"
  tick skip >/dev/null
  grep '"note":"re-gated green once master was"' "$T/state/journal.jsonl" | grep -q '"outcome":"dry-shipped"' && [ -z "$(ls "$T/state/redgate/" 2>/dev/null)" ] \
    && ok "once master is green it is re-gated without Claude → dry-shipped" || bad "no re-gate row: $(tail -3 "$T/state/journal.jsonl")"
  rm -f "$T/state/redgate/"*.json; fi
if run inbox; then
  printf '# Inbox — from the owner\n\nthe Debt chip is too small on iPad\n' > "$T/state/inbox/inbox-1.md"
  nq=$(cd "$T/repo" && STEWARD_STATE="$T/state" node steward/queue.mjs 2>/dev/null | head -1)
  grep -q '^inbox inbox-1 ' <<<"$nq" && ok "an inbox request is offered first" || bad "queue starts: $nq"
  r=$(tick ship); [ "$(jq -r .item <<<"$r")" = inbox-1 ] && [ "$(last_outcome "$r")" = dry-shipped ] && ok "…and is worked as an item (inbox-1 → dry-shipped)" || bad "inbox → $r"
  jq -cn '{ts:"2099-01-01T00:00:00Z",item:"inbox-1",outcome:"shipped"}' >> "$T/state/journal.jsonl"
  (cd "$T/repo" && STEWARD_STATE="$T/state" node steward/queue.mjs 2>/dev/null) | grep -q 'inbox-1' && bad "a finished request was offered again" || ok "…and once finished is never offered again"
  rm -f "$T/state/inbox/inbox-1.md"; fi
if run always; then
  sed -i 's/^STEWARD_WINDOW=.*/STEWARD_WINDOW=always/' "$T/env"; r=$(tick skip)
  [ "$(last_outcome "$r")" = dry-skip ] && ok "STEWARD_WINDOW=always works an item at any hour" || bad "always → $r"
  h=$(( 10#$(TZ=Europe/Prague date +%H) )); sed -i "s/^STEWARD_WINDOW=.*/STEWARD_WINDOW=$(printf %02d $(( (h + 2) % 24 )))-$(printf %02d $(( (h + 3) % 24 )))/" "$T/env"
  r=$(tick skip); [ -z "$r" ] && ok "…and a window that excludes now still runs nothing" || bad "ran outside its window: $r"
  sed -i "s/^STEWARD_WINDOW=.*/STEWARD_WINDOW=$(printf %02d $h)-$(printf %02d $(( (h + 3) % 24 )))/" "$T/env"; fi
if run landed-elsewhere; then # BL-68: an approved branch whose item already shipped is archived, never repaired
  it=steward-test-landed; git -C "$T/repo" push -q origin "origin/master:refs/heads/steward-approved/$it"
  jq -cn --arg i "$it" '{ts:"2099-01-01T00:00:00Z",item:$i,outcome:"shipped"}' >> "$T/state/journal.jsonl"
  jq -cn --arg i "$it" '{branch:("origin/steward-approved/"+$i),item:$i,log:"rebase conflict onto master",tries:0}' > "$T/state/redgate/$it.json"
  tick skip >/dev/null
  grep "\"item\":\"$it\"" "$T/state/journal.jsonl" | tail -1 | grep -q '"outcome":"dry-landed-elsewhere"' && [ ! -f "$T/state/redgate/$it.json" ] \
    && ok "an approved branch whose item already shipped is archived, and its repair entry goes" || bad "landed-elsewhere: $(grep "\"item\":\"$it\"" "$T/state/journal.jsonl" | tail -1)"
  head -1 "$T/state/queue.txt" | grep -q "^repair .*$it" && bad "…but its repair was queued: $(head -1 "$T/state/queue.txt")" || ok "…and its repair is never queued"
  git -C "$T/repo" push -q origin ":refs/heads/steward-approved/$it" 2>/dev/null; rm -f "$T/state/redgate/$it.json"; fi
if run retro; then # the daily retro: the digest is written once, offered once, and worked as an item
  # (STEWARD_SUMMARY_HOUR=24 keeps it out of every other scenario: it would put itself first)
  sed -i 's/^STEWARD_SUMMARY_HOUR=.*/STEWARD_SUMMARY_HOUR=0/' "$T/env"
  [ -s "$T/state/journal.jsonl" ] || tick skip >/dev/null          # at least one run to review
  day=$(TZ=Europe/Prague date +%F); rm -f "$T/state/retro/$day.md"
  r=$(tick ship)
  [ -f "$T/state/retro/$day.md" ] && grep -q '^## Runs, worst first' "$T/state/retro/$day.md" && ok "the runner writes the day's retro digest" || bad "no digest at $T/state/retro/$day.md"
  [ "$(jq -r .item <<<"$r")" = "retro-$day" ] && [ "$(last_outcome "$r")" = dry-shipped ] && ok "…offered as an item and worked (retro-$day → dry-shipped)" || bad "retro → $r"
  (cd "$T/repo" && STEWARD_STATE="$T/state" node steward/queue.mjs 2>/dev/null) | grep -q '^retro ' && bad "a done retro was offered again" || ok "…and once done is not offered again"
  sed -i 's/^STEWARD_SUMMARY_HOUR=.*/STEWARD_SUMMARY_HOUR=24/' "$T/env"; fi
if run moved && [ -z "${STEWARD_TEST_REMOTE:-}" ]; then echo "  - moved-master not tested: it pushes to master, so only against a scratch STEWARD_TEST_REMOTE"
elif run moved; then # master moves during the item's gate: ship_head must rebase, re-gate, and land on the NEW master
  # (until 2026-11-08 it compared origin/master with itself, and seven ships were refused and staged)
  [ -d "$T/mover" ] || { git clone -q "$STEWARD_TEST_REMOTE" "$T/mover"; git -C "$T/mover" config user.name t; git -C "$T/mover" config user.email t@t; }
  rm -f "$T/moved"
  cat > "$T/bin/move-master.sh" <<EOF
#!/bin/sh
# the gate stub: green, and the first time it gates the stub's own commit, someone else lands on master
if [ ! -e "$T/moved" ] && [ "\$(git -C "$T/repo" log -1 --format=%s)" = "stub: ledger-only change" ]; then
  touch "$T/moved"; git -C "$T/mover" fetch -q origin && git -C "$T/mover" checkout -q --detach origin/master \\
    && echo "moved \$(date +%s)" > "$T/mover/steward-test-moved.txt" && git -C "$T/mover" add steward-test-moved.txt \\
    && git -C "$T/mover" commit -qm "someone else landed during the gate" && git -C "$T/mover" push -q origin HEAD:refs/heads/master
fi
exit 0
EOF
  chmod +x "$T/bin/move-master.sh"
  r=$(tick ship "$T/bin/move-master.sh"); it=$(jq -r .item <<<"$r")
  newm=$(git -C "$T/mover" rev-parse HEAD); git -C "$T/repo" fetch -q origin "+refs/steward-dry/$(jq -r .item <<<"$r"):refs/steward-dry/t-moved" 2>/dev/null
  [ -e "$T/moved" ] && [ "$(last_outcome "$r")" = dry-shipped ] && grep -q "$it: master moved" "$T/logs/test.out" \
    && git -C "$T/repo" merge-base --is-ancestor "$newm" refs/steward-dry/t-moved \
    && ok "master moved during the gate → rebased, re-gated, and on top of the new master → dry-shipped" \
    || bad "moved → $r; moved=$([ -e "$T/moved" ] && echo yes || echo no); on top of the new master: $(git -C "$T/repo" merge-base --is-ancestor "$newm" refs/steward-dry/t-moved 2>/dev/null && echo yes || echo no)"
  git -C "$T/repo" update-ref -d refs/steward-dry/t-moved 2>/dev/null; fi
if run moved && [ -n "${STEWARD_TEST_REMOTE:-}" ]; then # …and the NEW master is red on its own: never staged for the owner
  # (2026-11-13: a human round broke master mid-gate; a fine triage was staged "could not land on a moved master")
  rm -f "$T/moved" "$T/state/redgate/"*.json
  cat > "$T/bin/move-master-red.sh" <<EOF
#!/bin/sh
# green on the old master; moves master once; red on anything that has the mover's file in it
if [ ! -e "$T/moved" ] && [ "\$(git -C "$T/repo" log -1 --format=%s)" = "stub: ledger-only change" ]; then
  touch "$T/moved"; git -C "$T/mover" fetch -q origin && git -C "$T/mover" checkout -q --detach origin/master \\
    && echo "moved red \$(date +%s)" > "$T/mover/steward-test-moved.txt" && git -C "$T/mover" add steward-test-moved.txt \\
    && git -C "$T/mover" commit -qm "someone else landed a red master during the gate" && git -C "$T/mover" push -q origin HEAD:refs/heads/master
  exit 0
fi
[ -e "$T/repo/steward-test-moved.txt" ] && grep -q 'moved red' "$T/repo/steward-test-moved.txt" && exit 1
exit 0
EOF
  chmod +x "$T/bin/move-master-red.sh"
  r=$(tick ship "$T/bin/move-master-red.sh"); f="$T/state/redgate/$(jq -r .item <<<"$r").json"
  [ -e "$T/moved" ] && [ "$(last_outcome "$r")" = dry-gate-red ] && [ "$(jq -r .masterRed "$f" 2>/dev/null)" = true ] \
    && grep -q '"outcome":"master-red"' "$T/state/journal.jsonl" \
    && ok "master moved to a RED master during the gate → gate-red, masterRed (re-gated once master is green), not staged" \
    || bad "moved-red → $r; redgate: $(cat "$f" 2>/dev/null)"
  rm -f "$T/state/redgate/"*.json "$T/state/master-gate.json"; fi
if run approved-land; then # a landed approved branch takes its stale red entry with it (2026-11-13, BL-63)
  it=steward-test-approved; git -C "$T/repo" push -q origin "origin/master:refs/heads/steward-approved/$it"
  mkdir -p "$T/state/redgate"; jq -cn --arg i "$it" '{branch:("origin/steward-approved/"+$i),item:$i,log:"(an earlier red gate)",tries:0}' > "$T/state/redgate/$it.json"
  [ -f "$T/state/redgate/$it.json" ] || bad "approved-land: could not write the red entry it starts from"
  tick skip >/dev/null
  grep "\"item\":\"$it\"" "$T/state/journal.jsonl" | tail -1 | grep -q '"outcome":"landed"' && [ ! -f "$T/state/redgate/$it.json" ] \
    && ok "an approved branch that lands takes its old repair entry with it" \
    || bad "approved-land: $(grep "\"item\":\"$it\"" "$T/state/journal.jsonl" | tail -1); redgate left: $(ls "$T/state/redgate/")"
  git -C "$T/repo" push -q origin ":refs/heads/steward-approved/$it" 2>/dev/null; rm -f "$T/state/redgate/$it.json"; fi
if run spin; then # the loop breaker: 4 runs in a day, nothing landed, no word from the owner → left for a day
  refill; q=$(cd "$T/repo" && STEWARD_STATE="$T/state" node steward/queue.mjs 2>/dev/null | grep -v '^triage\|^tidy' | head -1)
  it=$(awk '{print ($1=="report"||$1=="repair"||$1=="resume"||$1=="inbox"||$1=="retro") ? $2 : $1}' <<<"$q")
  now=$(date -u +%s); rows() { for k in 4 3 2 1; do jq -cn --arg i "$1" --arg ts "$(date -u -d "@$((now - k * 600))" +%FT%TZ)" \
    '{ts:$ts,item:$i,outcome:"already-fixed",run:"steward-test-spin"}'; done >> "$T/state/journal.jsonl"; }
  rows "$it"
  sq=$(cd "$T/repo" && STEWARD_STATE="$T/state" node steward/queue.mjs --why 2>&1)
  ! grep -q "^$it " <<<"$sq" && grep -q "$it: spinning: 4 runs" <<<"$sq" && ok "an item worked 4 times in a day with nothing landed is left for a day ($it)" || bad "spin: $it still offered or no reason: $(grep "$it" <<<"$sq" | head -2)"
  jq -cn --arg i "$it" '{ts:(now|todate),item:$i,outcome:"answered",by:"owner"}' >> "$T/state/journal.jsonl"
  (cd "$T/repo" && STEWARD_STATE="$T/state" node steward/queue.mjs 2>/dev/null) | grep -q "^$it " && ok "…and a word from the owner lets it back in" || bad "spin: an owner answer did not let $it back in"
  mkdir -p "$T/state/redgate"
  jq -cn '{branch:"origin/steward/steward-test-spun",item:"steward-test-spun",log:"(test)",tries:0}' > "$T/state/redgate/steward-test-spun.json"; rows steward-test-spun
  sq=$(cd "$T/repo" && STEWARD_STATE="$T/state" node steward/queue.mjs --why 2>&1)
  ! grep -q '^repair .*steward-test-spun' <<<"$sq" && grep -q 'repair steward-test-spun: spinning' <<<"$sq" && ok "…and a repair line is held the same way" || bad "a spinning REPAIR was still queued: $(grep spun <<<"$sq" | head -1)"
  rm -f "$T/state/redgate/steward-test-spun.json"
  jq -c "select(.run != \"steward-test-spin\" and (.item != \"$it\" or .outcome != \"answered\"))" "$T/state/journal.jsonl" > "$T/state/journal.refill" && mv "$T/state/journal.refill" "$T/state/journal.jsonl"; fi
if run empty; then # nothing to do = idle, and NO Claude run (2026-11-08: queue.mjs printed a bare newline for
  # "nothing", the runner's `-s` check read it as one item, and Claude was woken on an empty first line)
  (cd "$T/repo" && STEWARD_STATE="$T/state" node steward/queue.mjs 2>/dev/null) \
    | awk '{print ($1=="report"||$1=="repair"||$1=="resume"||$1=="inbox"||$1=="retro") ? $2 : $1}' \
    | while read -r it; do jq -cn --arg i "$it" '{ts:"2099-01-01T00:00:00Z",item:$i,outcome:"rejected",note:"steward-test-empty"}'; done >> "$T/state/journal.jsonl"
  n0=$(ls "$T/logs"/run-*.jsonl 2>/dev/null | wc -l); r=$(NO_REFILL=1 tick skip); n1=$(ls "$T/logs"/run-*.jsonl 2>/dev/null | wc -l)
  [ -z "$(jq -r '.run // empty' <<<"${r:-null}")" ] && [ "$n0" = "$n1" ] && grep -q 'queue empty' <(tail -5 "$T/logs/test.out") \
    && ok "an empty queue is idle: no Claude run" || bad "empty queue → ${r:-no row} ($((n1 - n0)) Claude run(s)); queue.txt: $(od -c "$T/state/queue.txt" | head -2 | tr '\n' ' ')"
  jq -c 'select(.note != "steward-test-empty")' "$T/state/journal.jsonl" > "$T/state/journal.refill" && mv "$T/state/journal.refill" "$T/state/journal.jsonl"; fi
if run pause; then touch "$T/state/paused"; r=$(tick skip); [ -z "$r" ] && ok "paused → nothing runs" || bad "ran while paused: $r"; rm -f "$T/state/paused"; fi

# clean the dry refs this test left on origin
for r in $(git -C "$T/repo" ls-remote origin 'refs/steward-dry/*' | awk '{print $2}'); do
  git -C "$T/repo" push -q origin ":$r" 2>/dev/null; done
echo "$pass passed, $fail failed   (runner output: $T/logs/test.out, journal: $T/state/journal.jsonl)"
[ $fail -eq 0 ]
