#!/bin/bash
# Copy production's var/ (accounts, decks, saved games, everything) over
# staging's, with the staging server stopped so it cannot write over the copy
# from memory. Run by hand as bena whenever staging should look like today's
# production: `algomancy-staging-refresh-data` (a root-owned copy).
# Staging's own changes since the last copy are thrown away.
set -euo pipefail
PROD="${ALGO_PROD_DIR:-/home/bena/Documents/Algomancy}"
STAGE="${ALGO_STAGING_DIR:-/home/bena/Documents/Algomancy-staging}"
sudo systemctl stop algomancy-staging-game
mkdir -p "$STAGE/var"
# --delete: staging ends up exactly as production is. og-cache rebuilds itself.
rsync -a --delete --exclude 'og-cache/' "$PROD/var/" "$STAGE/var/"
sudo systemctl start algomancy-staging-game
echo "staging-refresh-data: production's var/ copied to staging ($(du -sh "$STAGE/var" | cut -f1))"
