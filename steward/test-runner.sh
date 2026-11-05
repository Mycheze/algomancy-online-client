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
  (cd "$T/repo" && cat client/engine/package-lock.json client/server/package-lock.json bot/requirements.txt | sha1sum | cut -c1-12) > "$T/state/.deps"
  local h; h=$(( 10#$(TZ=Europe/Prague date +%H) ))
  cat > "$T/env" <<EOF
STEWARD_MODE=dry
STEWARD_TZ=Europe/Prague
STEWARD_WINDOW=$(printf %02d $h)-$(printf %02d $(( (h + 3) % 24 )))
STEWARD_CLAUDE_BIN=$T/bin/claude-stub
STEWARD_GATE_CMD=\${STUB_GATE:-true}
STEWARD_FETCH_CMD=\${STUB_FETCH:-true}
EOF
  cat > "$T/bin/claude-stub" <<'EOF'
#!/usr/bin/env bash
# a fake `claude -p` — does what $STUB_SCENARIO says, in the runner's cwd (the clone)
S="$STEWARD_STATE"; first=$(head -1 "$S/queue.txt")
# sweep: take the first item that is NOT triage (the fetched rows are not this item's)
[ "$STUB_SCENARIO" = sweep ] && first=$(grep -v '^triage' "$S/queue.txt" | head -1)
id=$(awk '{print ($1=="report"||$1=="repair"||$1=="resume"||$1=="inbox")?$2:$1}' <<<"$first")
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

tick() { # scenario [gate]
  local t0; t0=$(wc -l < "$T/state/journal.jsonl" 2>/dev/null || echo 0)
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
if run pause; then touch "$T/state/paused"; r=$(tick skip); [ -z "$r" ] && ok "paused → nothing runs" || bad "ran while paused: $r"; rm -f "$T/state/paused"; fi

# clean the dry refs this test left on origin
for r in $(git -C "$T/repo" ls-remote origin 'refs/steward-dry/*' | awk '{print $2}'); do
  git -C "$T/repo" push -q origin ":$r" 2>/dev/null; done
echo "$pass passed, $fail failed   (runner output: $T/logs/test.out, journal: $T/state/journal.jsonl)"
[ $fail -eq 0 ]
