#!/usr/bin/env bash
# deploy/staging-setup.sh — the staging copy, from nothing, ONCE.
# Run as bena on the VPS after the DNS record (deploy/README.md § Staging):
#
#   bash ~/Documents/Algomancy/deploy/staging-setup.sh
#
# The files it installs come from the checkout it is run FROM: production's
# once master has them, which is the normal case. Before then it can be run from
# a staging clone made by hand (§ Staging, "Before master has it").
#
# Safe to re-run: it keeps an existing checkout and staging.env, and copies
# production's data again only when asked (`--fresh-data`).
set -euo pipefail

PROD=/home/bena/Documents/Algomancy
STAGE=/home/bena/Documents/Algomancy-staging
DEPLOY="$(cd "$(dirname "$0")" && pwd)"
die() { echo "staging-setup: $*" >&2; exit 1; }

[ "$(id -un)" = bena ] || die "run as bena"
[ -d "$PROD/.git" ] || die "no production checkout at $PROD"
fresh=0; [ "${1:-}" = --fresh-data ] && fresh=1

# 1. the checkout: its own clone (the staging server's sandbox cannot see
#    production's tree, so it cannot borrow production's .git)
if [ ! -d "$STAGE/.git" ]; then
  git clone --quiet --reference "$PROD" --dissociate "$(git -C "$PROD" remote get-url origin)" "$STAGE"
  fresh=1
fi
git -C "$STAGE" fetch --quiet origin '+refs/heads/staging:refs/remotes/origin/staging' \
  || die "there is no staging branch on GitHub yet: push one first"
git -C "$STAGE" reset --hard --quiet refs/remotes/origin/staging
echo "staging-setup: checkout at $(git -C "$STAGE" log -1 --format='%h %s')"

# 2. its env: never production's
[ -f "$STAGE/staging.env" ] || cp "$DEPLOY/staging.env.example" "$STAGE/staging.env"

# 3. production's data
if [ "$fresh" = 1 ]; then
  mkdir -p "$STAGE/var"
  rsync -a --delete --exclude 'og-cache/' "$PROD/var/" "$STAGE/var/"
  echo "staging-setup: production's var/ copied ($(du -sh "$STAGE/var" | cut -f1))"
fi

# 4. the scripts the units run, root-owned copies of the ones beside this script:
#    a later push to staging can never change what runs outside the sandbox
for s in fetch build refresh-data; do
  sudo install -m 755 -o root -g root "$DEPLOY/staging-$s.sh" "/usr/local/bin/algomancy-staging-$s"
done

# 5. bena may stop, start and restart the staging server (refresh-data does) and nothing more
SUDOERS=/etc/sudoers.d/algomancy-staging
printf '%s\n' 'bena ALL=(root) NOPASSWD: /usr/bin/systemctl stop algomancy-staging-game, /usr/bin/systemctl start algomancy-staging-game, /usr/bin/systemctl restart algomancy-staging-game' \
  | sudo tee "$SUDOERS.new" >/dev/null
sudo chmod 440 "$SUDOERS.new"
sudo visudo -cqf "$SUDOERS.new" && sudo mv "$SUDOERS.new" "$SUDOERS" || { sudo rm -f "$SUDOERS.new"; die "sudoers line refused"; }

# 6. the units
sudo cp "$DEPLOY"/algomancy-staging-*.service "$DEPLOY"/algomancy-staging-*.timer \
  "$DEPLOY"/algomancy-staging-*.path /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now algomancy-staging-restart.path algomancy-staging-fetch.timer
sudo systemctl enable algomancy-staging-game
echo "staging-setup: building and starting (minutes the first time: npm ci on one CPU)…"
sudo systemctl restart algomancy-staging-game
systemctl is-active --quiet algomancy-staging-game || die "the staging server did not start: journalctl -u algomancy-staging-game -n 50"

# 7. the edge. The new Caddyfile only adds a glob import, but it is checked
#    before production's config is touched, and put back if it does not load.
sudo install -d -m 755 /etc/caddy/sites
sudo install -m 644 "$DEPLOY/staging.caddy" /etc/caddy/sites/staging.caddy
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-staging
sudo install -m 644 "$DEPLOY/Caddyfile" /etc/caddy/Caddyfile
if ! sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  sudo cp /etc/caddy/Caddyfile.before-staging /etc/caddy/Caddyfile
  sudo rm -f /etc/caddy/sites/staging.caddy
  die "Caddy refused the config; production's is back as it was. Check: sudo caddy validate --config /etc/caddy/Caddyfile"
fi
sudo systemctl reload caddy
# the first version gated the site with basic_auth, which the app's own sign-in
# (Authorization: Bearer) broke; the site is open now and nothing imports it
sudo rm -f /etc/caddy/staging-auth.caddy

echo
echo "staging-setup: done. https://staging.algomancy.online (a minute for its certificate)."
echo "  a push to the staging branch goes live within a minute: journalctl -u algomancy-staging-fetch -u algomancy-staging-game -f"
echo "  production's data again: algomancy-staging-refresh-data"
