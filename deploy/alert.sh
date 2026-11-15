#!/usr/bin/env bash
# deploy/alert.sh <unit> — "unit X failed on <host>" and its last ten journal
# lines, to the webhook. Run by algomancy-alert@.service, which every unit names
# in OnFailure=. Reading another unit's journal needs the systemd-journal group,
# which that unit grants; without it the message says the lines are missing.
set -euo pipefail
unit="${1:?usage: alert.sh <unit>}"
lines="$(journalctl -u "$unit" -n 10 --no-pager -o short-iso 2>&1 || true)"
[ -n "$lines" ] || lines="(no journal lines readable for $unit)"
printf '**%s failed on %s** at %s\n```\n%s\n```\n' \
  "$unit" "$(hostname)" "$(date '+%Y-%m-%d %H:%M %Z')" "${lines//\`\`\`/\'\'\'}" \
  | "$(dirname "$0")/notify.sh"
