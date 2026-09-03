# deploy/ — the three services and the backup, as files

Until 2026-09-03 the two Python services were systemd units that existed only
in `/etc/systemd/system/` on the box, the game server was a hand-started
`run-server.sh` loop that died on reboot, and `var/` — documented since the
directory existed as the one thing that cannot be rebuilt — was backed up by
nothing. Rebuilding the box meant reconstructing all of that from a prose
description in CLAUDE.md. Now it is `cp`.

| file | what |
|---|---|
| `algomancy-game.service` | the game server on :5000 (`node client/server/main.ts`) |
| `algomancy-web.service` | the rules bot's web app on :8000, **loopback only** — the game server proxies to it |
| `algomancy-bot.service` | the Discord bot |
| `algomancy-backup.service` + `.timer` | `backup-var.sh` once a day at 04:30, keeping 14 |
| `backup-var.sh` | tar `var/` into `~/algomancy-backups/`, and rsync it off the box when `ALGO_BACKUP_REMOTE` is set |

Every path in the units is absolute and assumes the repo at
`/home/bena/Documents/Algomancy` running as `bena`, which is the deploy box.
Change both if that changes.

## Install

```bash
sudo cp deploy/algomancy-*.service deploy/algomancy-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now algomancy-game algomancy-web algomancy-bot algomancy-backup.timer
```

If a `run-server.sh` loop is still running, kill **the loop** (its bash PID,
listed with `ps -eo pid,cmd | grep run-server`) and then the node child; the
unit takes the port from there. Never start any of these with `setsid nohup`
alongside the unit — systemd will start its own copy too, and two bots answer
every command twice.

## Secrets

None in the units. `EnvironmentFile=` points at the gitignored `.env` at the
repo root (`DISCORD_TOKEN`, `DEEPSEEK_API_KEY`, the `ALGO_*` integration
settings — see `.env.example`) and, for the game server, at
`client/server/tester.env` (see `tester.env.example`). `ALGO_BOT_TOKEN`
must be the same value in both files; a mismatch is not an error, every
`/api/bot/*` route just answers 404.

## Logs

`journalctl -u algomancy-game -f` (and `-web`, `-bot`). `var/gameserver.log`
is what the old loop wrote and is no longer appended to.

## Restore

```bash
tar -xzf ~/algomancy-backups/var-<stamp>.tar.gz -C /home/bena/Documents/Algomancy
```

with all three services stopped first.
