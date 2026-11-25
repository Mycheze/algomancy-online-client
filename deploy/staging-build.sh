#!/bin/bash
# Build the staging checkout before its game server starts: ExecStartPre= of
# algomancy-staging-game.service, so it runs INSIDE that unit's sandbox (no
# sudo, no ssh key, production's tree unreadable). The branch's own npm scripts
# and build steps run here, and they may be anything anybody pushed.
# Installed root-owned as /usr/local/bin/algomancy-staging-build.
set -euo pipefail
STAGE="${ALGO_STAGING_DIR:-/home/bena/Documents/Algomancy-staging}"
cd "$STAGE"
export npm_config_cache="$STAGE/.npm-cache"
# a dependency install only when a lockfile changed: on one CPU it is minutes
locks=$(cat client/engine/package-lock.json client/server/package-lock.json | sha256sum | cut -d' ' -f1)
if [ "$locks" != "$(cat .staging-locks 2>/dev/null || true)" ]; then
  npm --prefix client/engine ci --no-audit --no-fund
  npm --prefix client/server ci --no-audit --no-fund
  echo "$locks" > .staging-locks
fi
# production's deploy order (deploy/README.md § Deploying a change)
node client/engine/scripts/cr/render.mjs --review-json >/dev/null
npm --prefix client/ui run build
echo "staging-build: $(git rev-parse --short HEAD) built"
