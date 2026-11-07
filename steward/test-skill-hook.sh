#!/usr/bin/env bash
# Exercise run-once.sh's skill-next.md hook in a scratch repo (its lines are cut from the real file). Offline, seconds.
#   steward/test-skill-hook.sh [path/to/run-once.sh]      (default: this clone's)
set -uo pipefail
RUNNER="${1:-$(dirname "$0")/run-once.sh}"
T=$(mktemp -d); REPO="$T/repo"; STATE="$T/state"; TS=TEST; LOGS="$T"
mkdir -p "$REPO/.claude/skills/steward" "$STATE/outcomes"
git -C "$REPO" init -q; git -C "$REPO" config user.name t; git -C "$REPO" config user.email t@t
printf 'line one\nline two\n' > "$REPO/.claude/skills/steward/SKILL.md"
git -C "$REPO" add -A; git -C "$REPO" commit -qm base
g() { git -C "$REPO" "$@"; }
log() { echo "LOG: $*"; }
hook=$(awk '/if \[ -s "\$STATE\/skill-next.md" \]; then/{p=1} p{print} p&&/^  fi$/{exit}' "$RUNNER")
[ -n "$hook" ] || { echo "FAIL: hook not found"; exit 1; }
f() { local item=retro-test title="it's a \"quoted\" title"; eval "$hook"; }
# 1. no file → no commit
f; [ "$(g rev-list --count HEAD)" = 1 ] && echo "ok 1 no file, no commit" || echo "FAIL 1"
# 2. changed text → one commit, file applied, moved to outcomes
printf 'line one\nline 2 changed\n' > "$STATE/skill-next.md"
f; [ "$(g rev-list --count HEAD)" = 2 ] && grep -q 'changed' "$REPO/.claude/skills/steward/SKILL.md" && [ ! -e "$STATE/skill-next.md" ] && [ -e "$STATE/outcomes/TEST-skill-next.md" ] \
  && [ -z "$(g status --porcelain)" ] && echo "ok 2 applied: $(g log -1 --format=%s)" || echo "FAIL 2"
# 3. identical text → no commit
cp "$REPO/.claude/skills/steward/SKILL.md" "$STATE/skill-next.md"
f; [ "$(g rev-list --count HEAD)" = 2 ] && echo "ok 3 unchanged, no commit" || echo "FAIL 3"
# 4. only that file is committed
printf 'stray\n' > "$REPO/other.txt"; printf 'x\n' > "$STATE/skill-next.md"
f; [ "$(g show --name-only --format= HEAD)" = ".claude/skills/steward/SKILL.md" ] && [ -n "$(g status --porcelain -- other.txt)" ] && echo "ok 4 only SKILL.md committed" || echo "FAIL 4"
rm -rf "$T"
