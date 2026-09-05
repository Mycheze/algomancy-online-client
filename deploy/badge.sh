#!/usr/bin/env bash
# Grant or clear an account's trust mark on THIS box (BL-17, first slice).
#
#   deploy/badge.sh mycheze --owner --judge 1     the owner, judge level 1
#   deploy/badge.sh someone --judge 2             a trusted community member
#   deploy/badge.sh someone --clear               back to an ordinary account
#
# It talks to the game server over loopback with the tester token from
# client/server/tester.env — the same secret that opens the scenario tester,
# because a badge is the owner's instrument and there is deliberately no way
# to hand one out from inside the client. Run it on the deploy box (or the
# LAN box), as the user that owns the repo.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO/client/server/tester.env"
[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE — this is not a box that runs the game server" >&2; exit 2; }
set -a; . "$ENV_FILE"; set +a
: "${ALGO_TESTER_TOKEN:?tester.env sets no ALGO_TESTER_TOKEN, so the badge route does not exist on this server}"

[ $# -ge 1 ] || { sed -n 2,7p "$0"; exit 2; }
name="$1"; shift
owner=false; judge=null
while [ $# -gt 0 ]; do
  case "$1" in
    --owner) owner=true ;;
    --judge) judge="$2"; shift ;;
    --clear) owner=false; judge=null ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

curl -sS -X POST -H 'content-type: application/json' -H "x-algo-tester: $ALGO_TESTER_TOKEN" \
  --data "{\"name\":\"$name\",\"owner\":$owner,\"judge\":$judge}" \
  "http://127.0.0.1:${PORT:-5000}/api/admin/badge"
echo
