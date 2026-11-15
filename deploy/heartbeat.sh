#!/usr/bin/env bash
# Once a day: one message to ALGO_ALERT_WEBHOOK saying the box is alive — the
# newest backup's age, free disk on /, the three services, and when the steward
# last landed a commit on this checkout's master (so as of the last pull). Then,
# only if all is well, GET ALGO_HEARTBEAT_URL: a dead-man switch, so a box too
# broken to run this is reported by its silence. Exits 1 when a service is down
# or the newest backup is over 36 hours old, so OnFailure= alerts as well.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BACKUPS="${ALGO_BACKUP_DIR:-$HOME/algomancy-backups}"
STEWARD='steward@algomancy.online'      # the steward's commit identity
bad=()

newest="$(ls -1t "$BACKUPS"/var-*.tar.gz* 2>/dev/null | head -n 1)"
if [ -n "$newest" ]; then
  hours=$(( ($(date +%s) - $(stat -c %Y "$newest")) / 3600 ))
  backup="${hours}h ago ($(basename "$newest"))"
  [ "$hours" -le 36 ] || bad+=("backup ${hours}h old")
else
  backup="none in $BACKUPS"; bad+=("no backup")
fi

disk="$(df -h --output=avail,pcent / | tail -n 1 | awk '{print $1 " free (" $2 " used)"}')"

svcs=""
for s in algomancy-game algomancy-web algomancy-bot; do
  st="$(systemctl is-active "$s" 2>/dev/null)"; svcs+=" ${s#algomancy-} $st"
  [ "$st" = active ] || bad+=("$s $st")
done

steward="$(git -C "$REPO" log -1 --author="$STEWARD" --format='%cs (%cr)' master 2>/dev/null)"

if [ ${#bad[@]} -eq 0 ]; then head="ok"; else head="⚠ $(IFS=,; echo "${bad[*]}")"; fi
printf '**%s heartbeat: %s**\nbackup: %s\ndisk /: %s\nservices:%s\nsteward last commit: %s\n' \
  "$(hostname)" "$head" "$backup" "$disk" "$svcs" "${steward:-none found}" \
  | "$(dirname "$0")/notify.sh"

[ ${#bad[@]} -eq 0 ] || { echo "heartbeat: $head" >&2; exit 1; }
if [ -n "${ALGO_HEARTBEAT_URL:-}" ]; then
  curl -fsS --max-time 20 --retry 3 -o /dev/null --config <(printf 'url = "%s"\n' "$ALGO_HEARTBEAT_URL")
fi
