# deploy/ — the box, the edge, the three services and the backup, as files

Until 2026-09-03 the two Python services were systemd units that existed only
in `/etc/systemd/system/` on the box, the game server was a hand-started
`run-server.sh` loop that died on reboot, and `var/` — documented since the
directory existed as the one thing that cannot be rebuilt — was backed up by
nothing. Since 2026-09-05 the box is a rented VPS behind a domain, and this
directory is everything it takes to make one from a blank Ubuntu image.

| file | what |
|---|---|
| `bootstrap-vps.sh` | root, once: the `bena` user, Node 22, Caddy, ufw (22/80/443), persistent journal |
| `Caddyfile` | the public edge: TLS, `https://algomancy.benslanguagelab.com` → :5000, robots/noindex, security headers |
| `algomancy-game.service` | the game server on :5000, **loopback only** (`node client/server/main.ts`) |
| `algomancy-web.service` | the rules bot's web app on :8000, **loopback only** — the game server proxies to it |
| `algomancy-bot.service` | the Discord bot |
| `algomancy-backup.service` + `.timer` | `backup-var.sh` once a day at 04:30, keeping 14 |
| `backup-var.sh` | tar `var/` into `~/algomancy-backups/`, and rsync it off the box when `ALGO_BACKUP_REMOTE` is set |

Every path in the units is absolute and assumes the repo at
`/home/bena/Documents/Algomancy` running as `bena`; `bootstrap-vps.sh` creates
exactly that. Change both if that changes. The box's hostname is
`algomancy-vps` and so is the ssh alias for it on the dev machine — that is
`DEPLOY_HOST` in `client/engine/scripts/paths.mjs`, which `npm --prefix
client run reports` uses to fetch the playtest reports and refuses to run
*on* (it would scp the only copy over itself).

## Install

**0. DNS first**, because Caddy cannot get a certificate until the name
resolves: an `A` record `algomancy` → the box's IPv4 at the domain's DNS
host (Squarespace: Domains → the domain → DNS settings → add record).

**1. As root, once:**

```bash
bash deploy/bootstrap-vps.sh 'ssh-ed25519 AAAA… you@laptop'
```

**2. As `bena`:**

```bash
git clone <origin> /home/bena/Documents/Algomancy      # clone, never rsync a laptop tree
cd /home/bena/Documents/Algomancy
npm --prefix client/engine ci && npm --prefix client/server ci   # ui and ledgers borrow engine's
npm --prefix client/ui run build                         # bundle.js is gitignored
python3 -m venv .venv && .venv/bin/pip install -r bot/requirements.txt
mkdir -p var
cp .env.example .env                                     # then fill in — see § Secrets
cp client/server/tester.env.example client/server/tester.env
```

**3. Units and the edge:**

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
sudo cp deploy/algomancy-*.service deploy/algomancy-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now algomancy-game algomancy-web algomancy-bot algomancy-backup.timer
```

⚠ **The Discord bot must run in exactly one place.** Stop and disable
`algomancy-bot` on any other box first — two processes on one token each hold
a gateway session and every command is answered twice. Never start any of
these with `setsid nohup` alongside the unit for the same reason.

## Secrets

None in the units. `EnvironmentFile=` points at the gitignored `.env` at the
repo root (`DISCORD_TOKEN`, `DEEPSEEK_API_KEY`, the `ALGO_*` integration
settings — see `.env.example`) and, for the game server, at
`client/server/tester.env` (see `tester.env.example`). Two values must agree
across the two files: `ALGO_BOT_TOKEN` (a mismatch is not an error, every
`/api/bot/*` route just answers 404) and `ALGO_PUBLIC_URL`
(`https://algomancy.benslanguagelab.com` — the origin the bot's links point
at, and the one Origin besides the request's own Host allowed to open a
WebSocket).

## Deploying a change

```bash
git -C /home/bena/Documents/Algomancy pull --ff-only
npm --prefix /home/bena/Documents/Algomancy/client/ui run build
```

A client-only change is live on the next page load; `serveFile` sends
`no-cache` and revalidates. An engine or server change also needs
`sudo systemctl restart algomancy-game` — the page reconnects and reloads
itself when it sees a new server boot id. A restart onto a changed engine
replays every live room onto it; a room whose log no longer replays is
**frozen** (CT-160) rather than silently rebuilt, and both players are told.
A bot change: `sudo systemctl restart algomancy-web algomancy-bot`.

## Logs

`journalctl -u algomancy-game -f` (and `-web`, `-bot`, `-u caddy`). The
journal is persistent (`bootstrap-vps.sh`), so the restore lines — the only
record of a fork — survive a reboot.

## Backups

`algomancy-backup.timer` runs `backup-var.sh` daily: a tarball of `var/` in
`~/algomancy-backups/`, fourteen kept. That is a second copy on the same
disk, not a backup, until it leaves the box. The home server cannot be pushed
to from the internet, so it **pulls**: on `benshomeserver.local`, as `bena`,

```
# crontab -e
15 5 * * * rsync -a algomancy-vps:algomancy-backups/ ~/algomancy-vps-backups/
```

(`Host algomancy-vps` in that box's `~/.ssh/config` too.) Do the restore
drill once before the data matters: `tar -xzf` one tarball into a scratch
directory and compare mtimes with the live tree — `history.ts` keys a game's
identity on its file mtime, so a copy that loses them re-imports every game.

## Restore

```bash
tar -xzf ~/algomancy-backups/var-<stamp>.tar.gz -C /home/bena/Documents/Algomancy
```

with all three services stopped first.
