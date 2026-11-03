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
set -uo pipefail
MAIN="$HOME/algomancy-steward/repo"
T="${STEWARD_TEST_ROOT:-$HOME/steward-test}"
pass=0; fail=0
ok()  { echo "  ✓ $*"; pass=$((pass + 1)); }
bad() { echo "  ✗ $*"; fail=$((fail + 1)); }

setup() {
  rm -rf "$T/state" "$T/logs" "$T/bin"; mkdir -p "$T"/{state,logs,bin}
  if [ ! -d "$T/repo/.git" ]; then
    git clone -q --reference "$MAIN" git@github-steward:Mycheze/algomancy-online-client.git "$T/repo"
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
EOF
  cat > "$T/bin/claude-stub" <<'EOF'
#!/usr/bin/env bash
# a fake `claude -p` — does what $STUB_SCENARIO says, in the runner's cwd (the clone)
S="$STEWARD_STATE"; first=$(head -1 "$S/queue.txt"); id=$(awk '{print ($1=="report"||$1=="repair"||$1=="resume")?$2:$1}' <<<"$first")
w() { printf '{"item":"%s","outcome":"%s","title":"stub %s","summary":"stub"}' "$id" "$1" "$1" > "$S/outcome.json"; }
case "$STUB_SCENARIO" in
  skip)        w skip ;;
  ship)        echo "<!-- steward test $(date +%s) -->" >> client/ledgers/README.md; git commit -qam "stub: ledger-only change"; w ship ;;
  ui)          echo "// steward test" >> client/ui/main.ts; git commit -qam "stub: a UI change"; w ship ;;
  stage)       echo "<!-- steward test -->" >> client/ledgers/README.md; git commit -qam "stub: staged"; w stage
               printf '# %s\n\n**Needs from you:** approve the branch\n' "$id" > "$S/handoffs/$id.md" ;;
  needs-human) w needs-human; printf '# %s\n\n**Needs from you:** answer Q1\n' "$id" > "$S/handoffs/$id.md" ;;
  dirty)       echo "<!-- uncommitted -->" >> client/ledgers/README.md; w ship ;;
  silent)      : ;;   # exits without a verdict
  limit)       echo '{"type":"result","is_error":true,"result":"Claude AI usage limit reached|'$(( $(date +%s) + 7200 ))'"}'; exit 1 ;;
  push)        git push origin HEAD:refs/heads/steward-escape 2>&1; w skip ;;
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
if run ui; then r=$(tick ui); [ "$(last_outcome "$r")" = dry-staged ] && ok "a UI change asked to ship is downgraded → dry-staged ($(jq -r .policy <<<"$r" | cut -c1-50))" || bad "ui → $r"; fi
if run red; then r=$(tick ship false); [ "$(last_outcome "$r")" = dry-gate-red ] && ls "$T/state/redgate/"*.json >/dev/null 2>&1 && ok "red gate → dry-gate-red + a repair entry" || bad "red → $r"
  head -1 "$T/state/queue.txt" | grep -q '^repair ' && ok "the next queue starts with the repair" || bad "no repair line queued: $(head -1 "$T/state/queue.txt")"
  rm -f "$T/state/redgate/"*.json; fi
if run stage; then r=$(tick stage); [ "$(last_outcome "$r")" = dry-staged ] && ok "stage → dry-staged, handoff written" || bad "stage → $r"; fi
if run needs-human; then r=$(tick needs-human); [ "$(last_outcome "$r")" = dry-needs-human ] && ok "needs-human → dry-needs-human" || bad "needs-human → $r"; fi
if run dirty; then r=$(tick dirty); [ "$(last_outcome "$r")" = dry-staged ] && ok "uncommitted work is committed and never shipped → dry-staged" || bad "dirty → $r"; fi
if run silent; then r=$(tick silent); [ "$(last_outcome "$r")" = dry-failed ] && ok "no verdict → dry-failed (cooled down)" || bad "silent → $r"; fi
if run limit; then r=$(tick limit); [ "$(last_outcome "$r")" = limited ] && [ -f "$T/state/backoff-until" ] && ok "usage limit → backs off, item not charged" || bad "limit → $r"
  r2=$(tick skip); [ -z "$r2" ] && ok "inside the back-off nothing runs" || bad "ran during back-off: $r2"; rm -f "$T/state/backoff-until"; fi
if run push; then tick push >/dev/null
  git -C "$T/repo" ls-remote origin refs/heads/steward-escape | grep -q . && bad "THE AGENT PUSHED (steward-escape exists)" || ok "the agent cannot push (git ssh guard)"; fi
if run pause; then touch "$T/state/paused"; r=$(tick skip); [ -z "$r" ] && ok "paused → nothing runs" || bad "ran while paused: $r"; rm -f "$T/state/paused"; fi

# clean the dry refs this test left on origin
for r in $(git -C "$T/repo" ls-remote origin 'refs/steward-dry/*' | awk '{print $2}'); do
  git -C "$T/repo" push -q origin ":$r" 2>/dev/null; done
echo "$pass passed, $fail failed   (runner output: $T/logs/test.out, journal: $T/state/journal.jsonl)"
[ $fail -eq 0 ]
