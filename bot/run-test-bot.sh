#!/usr/bin/env bash
# The TEST Discord bot for the league rig (client/docs/20-league.md §10b).
# Run from the repo root (or the worktree root): bot/run-test-bot.sh
#
# ⚠ Why a wrapper and not `python bot/bot.py`: bot.py's load_dotenv() walks up
# from bot/ and finds the main tree's .env, which holds the PRODUCTION token.
# Two processes on one token answer every command twice and race the real
# bot. So this exports league-test.env first (load_dotenv never overrides a
# variable that is already set) and refuses outright if the token it would use
# is the production one.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f league-test.env ]; then
  echo "no league-test.env here — copy league-test.env.example and fill it in" >&2
  exit 1
fi
set -a
. ./league-test.env
set +a

if [ -z "${DISCORD_TOKEN:-}" ] || [ -z "${ALGO_BOT_TOKEN:-}" ]; then
  echo "league-test.env needs DISCORD_TOKEN (the TEST app's) and ALGO_BOT_TOKEN" >&2
  exit 1
fi
# refuse the production token, wherever the production .env is
for prod in .env ../../../.env; do
  if [ -f "$prod" ] && grep -q "^DISCORD_TOKEN=${DISCORD_TOKEN}\$" "$prod"; then
    echo "REFUSING: that DISCORD_TOKEN is the production bot's ($prod). Use the test application's token." >&2
    exit 1
  fi
done

PY=.venv/bin/python
[ -x "$PY" ] || PY=../../../.venv/bin/python
mkdir -p "$ALGO_VAR_DIR"
echo "test bot: guild $ALGO_DEV_GUILD, game server $ALGO_GAME_SERVER, every league DM to $ALGO_LEAGUE_DM_REDIRECT"
exec "$PY" -u bot/bot.py
