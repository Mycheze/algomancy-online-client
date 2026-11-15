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
if [ -n "${STEWARD_FETCH_KEY:-}" ]; then
  # the steward's own key (steward/README.md): the VPS answers it with deploy/steward-fetch.sh, one allowed
  # file and nothing else. Explicit everything: inside the fence there is no ~/.ssh/config and no agent.
  ssh -F /dev/null -i "$STEWARD_FETCH_KEY" -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o ConnectTimeout=15 \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$STEWARD_FETCH_KEY.known_hosts" "${STEWARD_FETCH_HOST:-bena@algomancy.online}" "$p" >"$REPO/$p.part" \
    && mv -f "$REPO/$p.part" "$REPO/$p" || { rm -f "$REPO/$p.part"; echo "vps-fetch: the VPS did not send $p" >&2; exit 1; }
else
  # the remote spelling comes from paths.mjs (test 255 §1: a hand-written host:path rots)
  SRC="$(node --input-type=module -e 'const m = await import(process.argv[1]); console.log(m.remote(process.argv[2]))' "$REPO/client/engine/scripts/paths.mjs" "$REPO/$p")"
  scp -q -o BatchMode=yes -o ConnectTimeout=15 "$SRC" "$REPO/$p"
fi
echo "fetched $p ($(wc -c <"$REPO/$p") bytes)"
