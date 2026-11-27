#!/usr/bin/env bash
# BL-16 — grant or revoke the ADMIN flag (or the designer flag) on THIS box.
#
#   deploy/admin.sh mycheze                     make them an admin
#   deploy/admin.sh someone --revoke            take it away
#   deploy/admin.sh designer someone [--revoke] the card editor's flag instead
#
# The designer flag lets an account propose card edits and nothing else; an
# admin may edit cards without it. Admins also set it from the dashboard.
#
# The admin flag is NOT the judge badge — see deploy/badge.sh for that one.
# A judge is a trusted voice on rules; an admin can change other people's
# accounts. The owner settled that they are independent axes (BL-16), so a
# judge L3 with no operator access is a legitimate account and this script is
# the only thing that makes the first admin.
#
# ⚠ THIS IS THE BOOTSTRAP AND THE WAY BACK IN. Once one admin exists they
# grant the rest from the dashboard; this stays because there is no password
# reset on this deploy, so a forgotten password would otherwise mean a dead
# dashboard. `setAdmin` refuses to remove the LAST admin — grant somebody else
# first, or use this script, which is subject to the same guard.
#
# It talks to the game server over loopback with the tester token from
# client/server/tester.env — the same secret badge.sh uses, because an
# unconfigured deploy must not admit the route exists. Run it on the deploy
# box (or the LAN box), as the user that owns the repo.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO/client/server/tester.env"
[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE — this is not a box that runs the game server" >&2; exit 2; }
set -a; . "$ENV_FILE"; set +a
: "${ALGO_TESTER_TOKEN:?tester.env sets no ALGO_TESTER_TOKEN, so the admin route does not exist on this server}"

usage() { sed -n 2,6p "$0"; exit 2; }
[ $# -ge 1 ] || usage
# a leading `designer` followed by a name picks that flag; the admin flag of
# a player actually called designer is `deploy/admin.sh -- designer`
flag=admin
if [ "$1" = designer ] && [ $# -ge 2 ] && [ "${2#--}" = "$2" ]; then flag=designer; shift
elif [ "$1" = -- ]; then shift; fi
[ $# -ge 1 ] || usage
name="$1"; shift
want=true
while [ $# -gt 0 ]; do
  case "$1" in
    --revoke) want=false ;;
    --grant) want=true ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

curl -sS -X POST -H 'content-type: application/json' -H "x-algo-tester: $ALGO_TESTER_TOKEN" \
  --data "{\"name\":\"$name\",\"$flag\":$want}" \
  "http://127.0.0.1:${PORT:-5000}/api/admin/grant"
echo
