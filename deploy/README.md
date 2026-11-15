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
| `Caddyfile` | the public edge: TLS, `https://algomancy.online` → :5000, robots/noindex, security headers; `algomancyonline.com` and the old `algomancy.benslanguagelab.com` redirect to it |
| `algomancy-game.service` | the game server on :5000, **loopback only** (`node client/server/main.ts`) |
| `algomancy-web.service` | the rules bot's web app on :8000, **loopback only** — the game server proxies to it |
| `algomancy-bot.service` | the Discord bot |
| `algomancy-backup.service` + `.timer` | `backup-var.sh` once a day at 04:30, keeping 14 |
| `backup-var.sh` | tar `var/` into `~/algomancy-backups/` — gpg-encrypted, with the env files, when `ALGO_BACKUP_RECIPIENT` is set — and rsync it off the box when `ALGO_BACKUP_REMOTE` is set |
| `algomancy-alert@.service` + `alert.sh` + `notify.sh` | a unit that fails posts "X failed on <host>" + its last ten journal lines to `ALGO_ALERT_WEBHOOK` (§ Alerts) |
| `algomancy-heartbeat.service` + `.timer` + `heartbeat.sh` | 09:00 daily: backup age, disk, services, steward's last commit → the webhook; then pings `ALGO_HEARTBEAT_URL` |
| `restore-drill.sh` | NOT for the VPS: where the private backup key is, unpack the newest pulled backup and check the account store (§ Backups) |

Every path in the units is absolute and assumes the repo at
`/home/bena/Documents/Algomancy` running as `bena`; `bootstrap-vps.sh` creates
exactly that. Change both if that changes. The box's hostname is
`algomancy-vps` and so is the ssh alias for it on the dev machine — that is
`DEPLOY_HOST` in `client/engine/scripts/paths.mjs`, which `npm --prefix
client run reports` uses to fetch the playtest reports and refuses to run
*on* (it would scp the only copy over itself).

## Install

**0. DNS first**, because Caddy cannot get a certificate until the name
resolves: an `A` record `@` → the box's IPv4, **Proxy status: DNS only (grey
cloud)**, at dash.cloudflare.com → `algomancy.online` → DNS → Records, and the
same at `algomancyonline.com`. Both domains were bought on Namecheap on
2026-09-14 and CONNECTED to Cloudflare (Namecheap → Nameservers → Custom DNS →
Cloudflare's pair), not transferred — Namecheap is still the registrar and
where they renew, and a record typed into Namecheap's DNS panel is never
served. Cloudflare imported Namecheap's email-forwarding MX/SPF records with
them; they are not the website's.

The old name, `algomancy.benslanguagelab.com` (the `algomancy` record in the
`benslanguagelab.com` zone), now only redirects; keep its record or the old
links die. ⚠ Squarespace is that domain's registrar but NOT its DNS host: the domain's
nameservers have been Cloudflare's since a 2025-09-05 tunnel experiment, so a
record typed into Squarespace's DNS panel is never served — that cost an hour
on the first deploy. The Cloudflare account is under the owner's personal
email (found by searching that inbox for mail from cloudflare.com); its
account id is `1afb4399862648b9594540848ab5d3d4`. Grey cloud, not orange:
Caddy answers the ACME challenge itself, and Cloudflare's proxy would put its
own idle timeout on the game's WebSockets.

**1. As root, once:**

```bash
bash deploy/bootstrap-vps.sh 'ssh-ed25519 AAAA… you@laptop'
```

**2. As `bena`:**

```bash
# the box holds a READ-ONLY deploy key (~/.ssh/id_ed25519, registered on GitHub as
# "algomancy-vps"); clone over ssh, never rsync a laptop tree
git clone git@github.com:Mycheze/algomancy-online-client.git /home/bena/Documents/Algomancy
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
repo root (`DISCORD_TOKEN`, `LLM_API_KEY` — or the older `DEEPSEEK_API_KEY`,
which every `LLM_*` setting still falls back to — the `ALGO_*` integration
settings — see `.env.example`) and, for the game server, at
`client/server/tester.env` (see `tester.env.example`). Two values must agree
across the two files: `ALGO_BOT_TOKEN` (a mismatch is not an error, every
`/api/bot/*` route just answers 404; the game server's journal says
`[bot] integration: on` at boot when its copy is set) and `ALGO_PUBLIC_URL`
(`https://algomancy.online` — the origin the bot's links point
at, and the one Origin besides the request's own Host allowed to open a
WebSocket).

### The brand font

The home page's titles are set in **Ethnocentric** (Typodermic), the face of
Caleb's site and the Manual's wordmark. The font is not ours to publish, and
the repo is public, so its file is gitignored (`client/ui/.gitignore`) and
lives only on the machines that serve the client:
`client/ui/fonts/Ethnocentric-Regular.woff2`. Without it the page falls back
to Krona One (committed, OFL) and nothing breaks. To put it on a server,
copy it from a machine that has it:

    scp client/ui/fonts/Ethnocentric-Regular.woff2 algomancy-vps:Algomancy/client/ui/fonts/

(It was made from the `.otf` Caleb's site serves, `ethnocentric-rg.otf`,
re-wrapped as woff2 with fontTools; the glyphs are unchanged.) No restart: the
next page load picks it up.

### Card errata

The bot used to diff algomancer.cc against our oracle every day and post
"Card changes upstream" (`cogs/cardwatch.py`). It was retired on 2026-11-06: our
oracle and scans are now ahead of that site, which is not Caleb's and is no
longer kept up, so every report was a list of cards where the site was wrong.
A card change now reaches the repo as a message in #steward with the new scan
(the steward skill's card-update recipe). `ALGO_CARDWATCH_CHANNEL` in an old
`.env` is ignored.

## Deploying a change

```bash
git -C /home/bena/Documents/Algomancy pull --ff-only
node /home/bena/Documents/Algomancy/client/engine/scripts/cr/render.mjs --review-json >/dev/null
npm --prefix /home/bena/Documents/Algomancy/client/ui run build
```

The middle line goes before any restart. The comprehensive rules are not
committed as a document: the game server renders them from the records for
`/comprehensive-rules` and every download, and that line is the same build.
If it fails, go back to the previous commit and restart nothing, or the
rules page answers 503 until the records are fixed.

Optional — only when the design-system components changed, and only on a box
an admin wants to look at Storybook on (the profile's 🎨 Design (Storybook)
button, admins only; `client/server/storybook.ts`):

```bash
npm --prefix /home/bena/Documents/Algomancy/client/storybook ci     # first time, and when its package-lock.json changes
npm --prefix /home/bena/Documents/Algomancy/client/storybook run build
```

Nothing else depends on it. With no build, `/storybook/` tells an admin
"Storybook isn't built on this server" and is a plain 404 to everybody else;
the game is untouched either way, and no restart is needed after a build. The
`ci` fetches ~75 MB of pinned packages from the npm registry, so the box needs
network for it (it has it: it reaches the registry for `client/engine` and
`client/server` too); Storybook 10 and Vite 7 need Node ≥ 20.19 (the box has
22). The box has one CPU and 2 GB of RAM: build while nobody is in a game, or
build on the laptop and `rsync -a --delete client/storybook/storybook-static/
algomancy-vps:/home/bena/Documents/Algomancy/client/storybook/storybook-static/`.
⚠ Storybook draws every story in an `<iframe>`, so the edge must allow
same-origin framing under `/storybook/*`: `deploy/Caddyfile` does since
2026-11-03, and a box whose `/etc/caddy/Caddyfile` predates that needs the
`sudo cp deploy/Caddyfile … && sudo systemctl reload caddy` from step 3 once,
or Storybook opens to an empty preview.

The bot token's routes (`/api/bot/*`, `/api/league/bot/*`, `/api/cr/editor`)
answer only a caller on the box talking to `127.0.0.1:5000` directly: the
server 404s anything that came through Caddy, and the Caddyfile 404s those
paths at the edge too. `ALGO_GAME_SERVER` must stay loopback. The tester
token's admin routes (`deploy/admin.sh`, `deploy/badge.sh`) take it in the
`x-algo-tester` header only.

A client-only change is live on the next page load; `serveFile` sends
`no-cache` and revalidates. An engine or server change also needs
`sudo systemctl restart algomancy-game` — the page reconnects and reloads
itself when it sees a new server boot id. A restart onto a changed engine
replays every live room onto it; a room whose log no longer replays is
**frozen** (CT-160) rather than silently rebuilt, and both players are told.
A bot change: `sudo systemctl restart algomancy-web algomancy-bot`.

⚠ **Once, with the 2026-10-11 model-layer change:** if `.env` still has
`DEEPSEEK_TIMEOUT=60` (the old `.env.example` shipped it), delete the line
before that restart. It still counts as `LLM_TIMEOUT`, now meaning seconds
*per attempt*, so one attempt eats the whole 55 s `LLM_DEADLINE` and nothing is
ever retried. The default (25 s, two attempts) is the one that fits inside the
game server's 60 s judge proxy. Check with `grep -n TIMEOUT .env`.

## Badges (who is who on the reports)

The Report button stamps every report with the account that filed it and any
trust mark on that account (`var/issues.jsonl` → `by`). The mark itself is
set by hand, on the box, and nowhere else:

```
deploy/badge.sh mycheze --owner --judge 1     # the owner
deploy/badge.sh someone --judge 2             # a trusted player
deploy/badge.sh someone --clear
```

It calls `POST /api/admin/badge` over loopback with the tester token from
`client/server/tester.env`; without that token the route does not exist. The
badge shows on the profile page, and `npm --prefix client run reports` prints
it beside each new report. BL-17 has the rest of the design.

Since 2026-09-16 an **admin** can also set a judge level from the dashboard
below, so this script is the bootstrap and the fallback rather than the only
way.

## The admin dashboard (BL-16)

`https://algomancy.online/?admin=1` — accounts, playtest reports, the whole
game history, and the rooms live in memory right now. Nothing in the client
links to it; you reach it by typing the query parameter.

**Admin is a flag on an account, and it is NOT the judge badge.** A judge is a
trusted voice on rules; an admin can change other people's accounts. Grant the
first one on the box:

```
deploy/admin.sh mycheze          # make them an admin
deploy/admin.sh someone --revoke
```

After that an admin grants the rest from the dashboard itself. Keep the script:
there is no password reset on this deploy, so it is the only way back in if the
last admin is locked out — and `setAdmin` refuses to revoke the **last** admin
for exactly that reason.

Every `/api/admin/*` route answers **404** to anyone who is not an admin —
signed out, signed in, or holding a stale token alike — so the page's existence
is not discoverable by poking at it. `server/e2e/test-admin.ts` asks all of them
four ways and fails if any answers anything else.

What the dashboard can change: a judge badge, the admin flag, and a report's
👍/👎 triage mark. What it **cannot** change is a report's implementation
status — that is the report's row in `client/ledgers/settled.jsonl`, which is committed
source, so it is read-only here and shows the status of the build this box is
running. The marks land in `var/report-marks.jsonl` (append-only) and come down
with `npm --prefix client run reports`.

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

(`Host algomancy-vps` in that box's `~/.ssh/config` too.) The laptop pulls
from the home box in turn — never `--delete`, so a copy wiped upstream is not
wiped here:

```
# laptop, crontab -e (or by hand when it is on)
0 12 * * * rsync -a benshomeserver.local:algomancy-vps-backups/ ~/algomancy-vps-backups/
```

Nothing prunes a pulled copy; on each box that holds one, add (rsync keeps the
mtimes, so this is the backup's age):
`30 5 * * * find ~/algomancy-vps-backups -name 'var-*.tar.gz*' -mtime +60 -delete`.
No credential for either box is ever put on the VPS: both copies are pulls.

### Encrypted backups (and `.env` in them)

Since 2026-11-15, with `ALGO_BACKUP_RECIPIENT` set in `.env`, each tarball also
holds `.env` and `client/server/tester.env` and is written only as
`var-<stamp>.tar.gz.gpg`, encrypted to a key whose **private half is never on
the VPS** — a break-in there cannot read old backups. Unset, it is the plain
`var/` tarball, which never holds the env files. Once, on the laptop:

```bash
gpg --quick-generate-key 'Algomancy backups <you@example>' default default never
gpg --list-keys 'Algomancy backups'                       # the 40-hex fingerprint
gpg --export-secret-keys --armor <fingerprint> > algomancy-backup-key.asc
#   → into the password manager (the file AND its passphrase), then shred the file.
#   Without it every encrypted backup is noise.
gpg --export --armor <fingerprint> | ssh algomancy-vps gpg --import
echo 'ALGO_BACKUP_RECIPIENT=<fingerprint>' | ssh algomancy-vps 'cat >> ~/Documents/Algomancy/.env'
ssh algomancy-vps sudo systemctl start algomancy-backup    # then: ls ~/algomancy-backups → a .gpg
```

**The drill**, where the private key is: `deploy/restore-drill.sh
[~/algomancy-vps-backups]` decrypts the newest backup into a temp dir, checks
`accounts.json` loads (prints the account count) and every line of
`accounts.history.jsonl` parses, fails if that backup is over 48 hours old,
prints one line and deletes the temp dir. Monthly, on the home box:

```
0 7 1 * * <checkout>/deploy/restore-drill.sh 2>&1 | logger -t algomancy-drill   # it needs only python3 and gpg
```

⚠ A cron job cannot type a passphrase, so that line needs the private key on
the home box without one — and until the steward's agent is fenced off from
`~` there, it could read that key. Until then run the drill by hand on the
laptop once a month (gpg asks for the passphrase) and keep the key off the
home box. Do it once before the data matters, too: `history.ts` keys a game's
identity on its file mtime, so also compare a few mtimes with the live tree.

## Restore

```bash
tar -xzf ~/algomancy-backups/var-<stamp>.tar.gz -C /home/bena/Documents/Algomancy
```

with all three services stopped first. An encrypted one is decrypted where the
key is and the result copied up: `gpg -d var-<stamp>.tar.gz.gpg | tar -xzf - -C
<dir> var` (leave off `var` to get `.env` back too).

The account store is two files in `var/accounts/`, restored together:
`accounts.json` (accounts and sessions) and `accounts.history.jsonl` (the
match history, one line per write of a game). To roll the game server back to
a build that kept the history inside `accounts.json`, stop it and run
`node client/server/export-legacy-store.ts` first: it writes the history back
in and moves the `.jsonl` aside, so rolling forward again migrates it.

## Sandbox (the three services)

Since 2026-11-15 the game, web and bot units run sandboxed: the whole disk is
read-only to them except `var/` (`ProtectSystem=strict` + `ProtectHome=read-only`
+ `ReadWritePaths=`), `~/.ssh` does not exist for them, and `NoNewPrivileges` means no sudo or setuid from inside.
⚠ `ProtectSystem=strict` alone does **not** cover `/home` — that is
`ProtectHome=`'s job — so without the `ProtectHome=read-only` line the repo and
`~` stay writable. Every runtime write was checked to be under `var/`
(`client/server/statepaths.ts`, `bot/paths.py`; the deck-picture drawer
`ui/site-icons.py` writes to `var/og-cache/`). Two things are expected and
harmless: Python cannot refresh `bot/__pycache__` after a pull (it recompiles in
memory at start), and `git rev-parse` (the engine version stamp) only reads. An
`ALGO_VAR_DIR`, or an `ALGO_*_FILE`/`_DIR` override pointing outside `var/`,
must be added to `ReadWritePaths=` too.

**Install** (when nobody is in a game): `sudo cp deploy/algomancy-{game,web,bot}.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl restart algomancy-game algomancy-web algomancy-bot`.
**Verify:** `systemctl is-active` on all three; `journalctl -u algomancy-game -u algomancy-web -u algomancy-bot --since -5min | grep -iE 'read-only|permission denied'` prints nothing; sign in, ask the judge, play two turns and see a file appear under `var/games/`. `systemd-analyze security algomancy-game` scores it.
**Undo:** delete the sandbox block from the copies in `/etc/systemd/system/`, `daemon-reload`, restart.

## Alerts

Every unit here names `OnFailure=algomancy-alert@%n.service`. When one fails —
a crash, even one `Restart=` recovers from; a backup that exits non-zero — the
alert posts the unit, the host and its last ten journal lines to the Discord
webhook in `ALGO_ALERT_WEBHOOK` (`.env`). Unset, nothing is posted and nothing
fails. The JSON is built by the system `python3`, so log text cannot break it,
and mentions are off. The alert runs as `bena` with the `systemd-journal` group
for the journal; a plain `systemctl restart` is not a failure and is silent.

**Install:** `echo 'ALGO_ALERT_WEBHOOK=<url>' >> .env`, then `sudo cp deploy/algomancy-*.service deploy/algomancy-*.timer /etc/systemd/system/ && sudo systemctl daemon-reload`.
**Verify:** `sudo systemctl start algomancy-alert@test.service` — a message arrives.
**Undo:** remove the `OnFailure=` lines (or just the variable from `.env`).

## Heartbeat

`heartbeat.sh`, daily at 09:00: one message with the newest local backup's age,
free disk on `/`, the three services, and the date of the steward's last commit
(`steward@algomancy.online`) on this checkout's `master` — so as of the last
deploy pull. When all is well it then GETs `ALGO_HEARTBEAT_URL` (healthchecks.io
or similar, period 1 day, grace 6 h), so a box too broken to run it is reported
by its silence. It exits 1 if a service is not active or the newest backup is
over 36 hours old, and its own `OnFailure=` alerts.

**Install:** `ALGO_HEARTBEAT_URL=<ping url>` in `.env`, the copy above, `sudo systemctl enable --now algomancy-heartbeat.timer`.
**Verify:** `sudo systemctl start algomancy-heartbeat` — a message, and the check turns green.
**Undo:** `sudo systemctl disable --now algomancy-heartbeat.timer`.
