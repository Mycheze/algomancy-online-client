#!/usr/bin/env bash
# Bring ONE runtime file down off the live server, read-only, into the same path
# in this clone — the steward's only way to look at a game for a report.
#
#   steward/vps-fetch.sh var/games/QJEY.json
#   steward/vps-fetch.sh var/report-runs.jsonl
#
# Only game, challenge-run and report files: never accounts.json (password
# hashes) or anything outside var/. Re-fetch before every replay: a stale copy
# replays clean and lies (playtest-report-loop, 2026-08-24).
set -euo pipefail
p="${1:?usage: steward/vps-fetch.sh var/games/<ROOM>.json}"
[[ "$p" =~ ^var/(games/[A-Za-z0-9_-]+\.json|challenges/[A-Za-z0-9_./-]+\.json|report-runs\.jsonl|issues\.jsonl|verdicts\.jsonl)$ ]] && [[ "$p" != *..* ]] \
  || { echo "vps-fetch: refusing '$p' (games, challenge runs and report journals only)" >&2; exit 2; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$REPO/$(dirname "$p")"
scp -q -o BatchMode=yes -o ConnectTimeout=15 "algomancy-vps:/home/bena/Documents/Algomancy/$p" "$REPO/$p"
echo "fetched $p ($(wc -c <"$REPO/$p") bytes)"
