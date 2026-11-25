#!/bin/bash
# The staging checkout follows origin/staging (deploy/README.md § Staging).
# Run every minute by algomancy-staging-fetch.timer, as bena, from a ROOT-OWNED
# copy (/usr/local/bin/algomancy-staging-fetch) that staging-setup.sh installs
# from the production checkout. Never from the staging checkout itself: anybody
# allowed to push `staging` could then rewrite what runs here with bena's ssh key.
#
# It only moves files: no npm, no build, no code from the branch runs here. A
# new commit is reset into place and `.deployed` is touched, which
# algomancy-staging-restart.path turns into a restart of the game unit; the
# build happens inside that unit's sandbox (staging-build.sh).
set -euo pipefail
STAGE="${ALGO_STAGING_DIR:-/home/bena/Documents/Algomancy-staging}"
cd "$STAGE"
git fetch --quiet origin '+refs/heads/staging:refs/remotes/origin/staging'
new=$(git rev-parse refs/remotes/origin/staging)
old=$(git rev-parse HEAD)
[ "$new" = "$old" ] && exit 0
git reset --hard --quiet "$new"
echo "staging-fetch: ${old:0:9} → ${new:0:9} $(git log -1 --format=%s "$new")"
date -u +%FT%TZ > .deployed
