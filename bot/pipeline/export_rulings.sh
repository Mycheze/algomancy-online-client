#!/usr/bin/env bash
# Export the Algomancy rulings channels to data/rulings/exports/ as JSON (+ images).
# Prompts for your Discord user token silently so it never lands in shell
# history. The token is a full-account credential — do not paste it anywhere else.
#
# THIS FILE IS THE ONLY WRITTEN RECIPE for reproducing data/rulings/exports/, which
# build_rulings.py consumes and which docs/09-divergence-inventory.md cites as a
# source of record. It used to live in discord_extractor/, where the blanket
# `discord_extractor/` .gitignore rule meant it was never committed — one `rm -rf`
# from being gone. It lives here, tracked, for that reason.
#
# The exporter itself is a vendored 29 MB third-party binary and stays untracked;
# fetch it from https://github.com/Tyrrrz/DiscordChatExporter/releases and unpack
# it to discord_extractor/DiscordChatExporter.Cli.linux-x64/.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DCE="$HERE/../discord_extractor/DiscordChatExporter.Cli.linux-x64/DiscordChatExporter.Cli"
OUT="$HERE/../../data/rulings/exports"

[ -x "$DCE" ] || { echo "DiscordChatExporter not found at $DCE — see the header."; exit 1; }
mkdir -p "$OUT"

# rules-questions + rarely-asked-questions
CHANNELS=(1353820457886810152 1064279804741955646)

read -rsp "Paste Discord user token (input hidden): " TOKEN
echo
[ -n "$TOKEN" ] || { echo "No token given, aborting."; exit 1; }

for CID in "${CHANNELS[@]}"; do
  echo ">> Exporting channel $CID ..."
  "$DCE" export \
    -t "$TOKEN" \
    -c "$CID" \
    --include-threads all \
    -f Json \
    --media --reuse-media \
    -o "$OUT/"
done

echo "Done. JSON written to $OUT/"
ls -la "$OUT/"
