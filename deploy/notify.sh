#!/usr/bin/env bash
# Post stdin, as one plain message, to the Discord webhook in ALGO_ALERT_WEBHOOK
# (from .env). Unset = alerts are off: say so and exit 0. Used by alert.sh and
# heartbeat.sh. The JSON is built by python3 (the system one), so journal text
# with quotes, backslashes and newlines cannot break it; mentions are disabled,
# so a log line saying @everyone pings nobody. The URL is a secret: it goes to
# curl in a config on a file descriptor, never on the command line.
set -euo pipefail
if [ -z "${ALGO_ALERT_WEBHOOK:-}" ]; then
  echo "notify: ALGO_ALERT_WEBHOOK is not set — not posting"; cat >/dev/null; exit 0
fi
/usr/bin/python3 -c 'import json, sys
text = sys.stdin.read()
if len(text) > 1990: text = text[:1900] + "\n…(cut)"
if text.count("```") % 2: text += "\n```"
print(json.dumps({"content": text, "allowed_mentions": {"parse": []}}))' \
| curl -fsS --max-time 20 -H 'Content-Type: application/json' --data-binary @- \
    --config <(printf 'url = "%s"\n' "$ALGO_ALERT_WEBHOOK") -o /dev/null
