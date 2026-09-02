#!/usr/bin/env bash
# Keep the game server up: restart on crash (rooms replay-restore on startup,
# so a crash mid-game costs a refresh, not the game). Run detached:
#   setsid nohup ./run-server.sh > /dev/null 2>&1 < /dev/null &
cd "$(dirname "$0")"
export PATH="$HOME/node-v22/bin:$PATH"

# R216 — SECRETS AND DEPLOY-LOCAL SETTINGS COME FROM AN UNTRACKED FILE.
#
# `tester.env` (gitignored by the root `*.env` rule) is sourced if it exists.
# It is how ALGO_TESTER_TOKEN reaches the scenario tester: without that variable
# every /api/scenario/* and /api/verdict route 404s by design, so the tester is
# simply absent on a deploy that has not opted in — which is what we want on a
# PUBLIC box (backlog BL-28).
#
# ⚠ IT MUST BE SOURCED INSIDE THE LOOP, NOT ONCE AT STARTUP.
# The supervisor is a long-lived while-loop; `kill`ing the node PID restarts the
# child from the environment of THIS process, so a variable added after the loop
# started is invisible until the LOOP itself is restarted. Sourcing per-iteration
# means a token change needs only the usual `kill <node pid>`.
#
# ⚠ AND IT WAS OUTSIDE THE LOOP UNTIL 2026-09-02, one line above the `while`,
# with this comment already sitting above it saying it was not. Found while
# deploying the Discord integration: a freshly written tester.env was invisible
# to a loop that had been running since August, so every /api/bot/* route 404'd
# — which is indistinguishable from "no token configured", because that is
# exactly what the gate is designed to look like. The comment was right and the
# code was not.

PORT="${PORT:-5000}"
while true; do
  if [ -f tester.env ]; then set -a; . ./tester.env; set +a; fi
  echo "[run-server] starting on :$PORT at $(date -Is)" >> ../../var/gameserver.log
  PORT="$PORT" node main.ts >> ../../var/gameserver.log 2>&1
  echo "[run-server] server exited ($?) — restarting in 2s" >> ../../var/gameserver.log
  sleep 2
done
