#!/usr/bin/env bash
# Keep the game server up: restart on crash (rooms replay-restore on startup,
# so a crash mid-game costs a refresh, not the game). Run detached:
#   setsid nohup ./run-server.sh > /dev/null 2>&1 < /dev/null &
cd "$(dirname "$0")"
export PATH="$HOME/node-v22/bin:$PATH"
PORT="${PORT:-5000}"
while true; do
  echo "[run-server] starting on :$PORT at $(date -Is)" >> gameserver.log
  PORT="$PORT" node main.ts >> gameserver.log 2>&1
  echo "[run-server] server exited ($?) — restarting in 2s" >> gameserver.log
  sleep 2
done
