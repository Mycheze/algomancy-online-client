#!/usr/bin/env bash
# The owner's end of the steward — run on the LAPTOP, from the repo.
#
#   steward/review.sh                    = status
#   steward/review.sh status             what happened overnight, what is waiting on you
#   steward/review.sh show <item>        a handoff, its branch's commits and files
#   steward/review.sh diff <item>        the branch's full diff
#   steward/review.sh try <item>         check the branch out in a worktree and say how to run it
#   steward/review.sh approve <item>…    sign off (any number; --all = every staged branch)
#   steward/review.sh reject <item> "why" [--retry]
#                                        drop it; the reason goes in the journal the worker reads
#                                        (--retry: let it try again, differently)
#   steward/review.sh answer <item> "…"  answer a handoff's question; the worker resumes it
#   steward/review.sh hold <item> "why"  never pick this item (steward/hold.txt is the committed list;
#                                        this is the quick, box-local one)
#   steward/review.sh pause | resume     stop / restart the worker (a running item finishes)
#   steward/review.sh log [n]            the runner's log
#   steward/review.sh sync-rulings       push the gitignored rulings export to the worker's clone
#
# Approval is a rename on GitHub (steward/<item> → steward-approved/<item>); the
# worker lands it within minutes — rebase, full gate, master, deploy when no one
# is in a game — at any hour, since landing spends no Claude usage.
set -euo pipefail
HOST="${STEWARD_HOST:-benshomeserver.local}"
SROOT='~/algomancy-steward'
REPO="$(cd "$(dirname "$0")/.." && pwd)"
g() { git -C "$REPO" "$@"; }
box() { ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "$@"; }
slug() { echo "$1" | sed -E 's/^#/report-/; s/[^A-Za-z0-9._-]+/-/g; s/^-+|-+$//g' | cut -c1-60; }
jnote() { # item outcome [note]  → a journal row on the box
  local row; row=$(jq -cn --arg ts "$(date -u +%FT%TZ)" --arg i "$1" --arg o "$2" --arg n "${3:-}" '{ts:$ts,item:$i,outcome:$o,note:$n,by:"owner"}')
  box "cat >> $SROOT/state/journal.jsonl" <<<"$row"
}
fetch() { g fetch -q --prune origin '+refs/heads/steward/*:refs/remotes/origin/steward/*' '+refs/heads/steward-approved/*:refs/remotes/origin/steward-approved/*' '+refs/steward-dry/*:refs/remotes/origin/steward-dry/*' 2>/dev/null || true; }
# a staged branch, or (a dry night's) refs/steward-dry/<item>
ref_of() { local s="$1"; for r in "origin/steward/$s" "origin/steward-dry/$s"; do g rev-parse -q --verify "$r" >/dev/null && { echo "$r"; return; }; done; }

cmd="${1:-status}"; shift || true
case "$cmd" in
status)
  fetch
  box "bash -s" <<'EOF'
S=~/algomancy-steward/state
echo "── worker"
# a oneshot tick is "activating" for its whole run, never "active"
case "$(systemctl --user show -p ActiveState --value algomancy-steward.service)" in
  activating|active) echo "  running a tick now (since $(systemctl --user show -p ExecMainStartTimestamp --value algomancy-steward.service))"; tail -n 1 ~/algomancy-steward/logs/runner.log | sed 's/^/    /' ;;
  *) echo "  idle between ticks" ;;
esac
[ -f $S/master-gate.json ] && jq -r '"  master \(.sha[0:8]) gate: \(if .rc == 0 then "green" else "RED — \(.failures[0:3]|join(" | "))" end)  (\(.ts // "?"))"' $S/master-gate.json
[ -f $S/paused ] && echo "  ⏸  PAUSED  (steward/review.sh resume)"
[ -f $S/backoff-until ] && [ "$(date +%s)" -lt "$(cat $S/backoff-until)" ] && echo "  usage limit: backing off until $(date -d @$(cat $S/backoff-until))"
[ -f $S/pending-deploy ] && echo "  deploy waiting for a quiet server: $(jq -r '.why|join(", ")' $S/pending-deploy)"
grep -m1 . ~/.config/algomancy-steward/env >/dev/null 2>&1 && echo "  mode: $(. ~/.config/algomancy-steward/env; echo ${STEWARD_MODE:-dry})  window: $(. ~/.config/algomancy-steward/env; echo ${STEWARD_WINDOW:-23-08}) ${STEWARD_TZ:-Europe/Prague}"
echo "── last 24 h"
since=$(date -u -d '24 hours ago' +%FT%TZ)
jq -r --arg s "$since" 'select(.ts > $s and .outcome != "idle") | "  \(.ts[5:16])  \(.item|.[0:14])  \(.outcome)  \(.title // .why // .note // "")"' $S/journal.jsonl 2>/dev/null | tail -30
echo "── waiting on you"
for f in $S/handoffs/*.md; do [ -e "$f" ] || continue; i=$(basename "$f" .md); echo "  $i  — $(sed -n 's/^\*\*Needs from you:\*\* //p' "$f" | head -1)"; done
EOF
  echo "── staged branches"
  g for-each-ref --format='  %(refname:lstrip=3)  %(committerdate:relative)  %(contents:subject)' refs/remotes/origin/steward/ | head -40
  if [ -n "$(g for-each-ref refs/remotes/origin/steward-dry/)" ]; then
    echo "── dry-run work (refs/steward-dry/*: what it WOULD have shipped or staged)"
    g for-each-ref --format='  %(refname:lstrip=3)  %(committerdate:relative)  %(contents:subject)' refs/remotes/origin/steward-dry/ | head -40
  fi
  ;;
show)
  item="${1:?item}"; s=$(slug "$item"); fetch
  box "cat $SROOT/state/handoffs/$s.md $SROOT/state/handoffs/$item.md 2>/dev/null | head -400" || true
  r=$(ref_of "$s")
  if [ -n "$r" ]; then
    echo; echo "── $r"
    g log --format='  %h %s' "origin/master..$r"
    g diff --stat "origin/master...$r" | tail -25
    echo; node "$REPO/steward/policy.mjs" origin/master "$r" | jq -r '"policy: \(.verdict)  \(.reasons|join("; "))"'
  fi ;;
diff)
  s=$(slug "${1:?item}"); fetch; r=$(ref_of "$s"); [ -n "$r" ] || { echo "no branch for $s"; exit 1; }; g diff "origin/master...$r" ;;
try)
  s=$(slug "${1:?item}"); fetch
  wt="$REPO/.claude/worktrees/steward-$s"
  r=$(ref_of "$s"); [ -n "$r" ] || { echo "no branch for $s"; exit 1; }
  [ -d "$wt" ] || g worktree add -q --detach "$wt" "$r"
  for d in client/engine/node_modules client/server/node_modules .venv; do [ -e "$wt/$d" ] || ln -s "$REPO/$d" "$wt/$d"; done
  echo "worktree: $wt"
  echo "run it:   npm --prefix $wt/client run dev     → http://127.0.0.1:5177"
  echo "done:     git worktree remove --force $wt" ;;
approve)
  fetch
  items=("$@"); [ "${1:-}" = --all ] && mapfile -t items < <(g for-each-ref --format='%(refname:lstrip=3)' refs/remotes/origin/steward/)
  [ ${#items[@]} -gt 0 ] || { echo "approve what? (an item, or --all)"; exit 2; }
  for item in "${items[@]}"; do
    s=$(slug "$item")
    g rev-parse -q --verify "origin/steward/$s" >/dev/null || { echo "  no branch steward/$s"; continue; }
    g push -q --atomic origin "+refs/remotes/origin/steward/$s:refs/heads/steward-approved/$s" ":refs/heads/steward/$s" || { echo "  ✗ $s: the push was refused"; continue; }
    jnote "$s" approved; echo "  ✓ $s approved — the worker lands it on its next tick"
  done ;;
reject)
  item="${1:?item}"; why="${2:?say why — the worker reads it}"; s=$(slug "$item"); fetch
  if g rev-parse -q --verify "origin/steward/$s" >/dev/null; then
    g push -q origin "refs/remotes/origin/steward/$s:refs/archive/steward/$s" ":refs/heads/steward/$s"
  fi
  box "mkdir -p $SROOT/state/handoffs/done; mv -f $SROOT/state/handoffs/$s.md $SROOT/state/handoffs/done/ 2>/dev/null; rm -f $SROOT/state/redgate/$s.json" || true
  if [ "${3:-}" = --retry ]; then jnote "$s" rejected-retry "$why"; else jnote "$s" rejected "$why"; fi
  echo "  ✗ $s rejected${3:+ (it may try again)}" ;;
answer)
  item="${1:?item}"; text="${2:?the answer}"; s=$(slug "$item")
  printf '# Owner answer — %s (%s)\n\n%s\n' "$item" "$(date -u +%F)" "$text" | box "mkdir -p $SROOT/state/answers && cat > $SROOT/state/answers/$s.md"
  jnote "$s" answered "$text"; echo "  ✓ answered $s — the worker resumes it on its next night run" ;;
hold)
  item="${1:?item}"; why="${2:?why}"; jnote "$(slug "$item")" rejected "held: $why"; echo "  held $item (until review.sh reject … --retry)" ;;
pause)  box "touch $SROOT/state/paused" && echo "  paused (a running item finishes first)" ;;
resume) box "rm -f $SROOT/state/paused $SROOT/state/backoff-until" && echo "  resumed" ;;
log)    box "tail -n ${1:-60} $SROOT/logs/runner.log" ;;
sync-rulings)
  for p in data/rulings/exports/ data/rulings/work/ data/rulings/needs_ocr.jsonl; do
    rsync -a --delete "$REPO/$p" "$HOST:algomancy-steward/repo/$p"
  done; echo "  rulings inputs synced" ;;
*) sed -n 2,22p "$0"; exit 2 ;;
esac
