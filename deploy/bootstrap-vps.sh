#!/usr/bin/env bash
# deploy/bootstrap-vps.sh — a fresh Ubuntu 24.04 box to "ready for the units".
# Run ONCE, as root, on the new VPS:
#
#   bash bootstrap-vps.sh 'ssh-ed25519 AAAA… you@laptop'
#
# It creates the `bena` user the units run as, installs Node 22 (NodeSource,
# so /usr/bin/node is a stable absolute path for ExecStart=), Caddy, ufw with
# only 22/80/443 open, and a journal that survives reboot. Everything after
# it — the clone, the env files, the units — is done as `bena` and is in
# deploy/README.md. Idempotent enough to re-run.
set -euo pipefail

USER_NAME=bena
HOST_NAME=algomancy-vps            # = DEPLOY_HOST in client/engine/scripts/paths.mjs
PUBKEY="${1:?usage: bootstrap-vps.sh '<ssh public key line>'}"

[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }

hostnamectl set-hostname "$HOST_NAME"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ufw git curl rsync python3-venv python3-pip build-essential \
  unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https ca-certificates

# Node ≥ 22.18 is required: the server runs .ts directly via type-stripping.
# Ubuntu 24.04 ships 18, so: NodeSource.
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node --version

# Caddy from its own repo (caddyserver.com/docs/install)
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

# the user the units run as; same name and repo path as the old box so the
# unit files need no edit
if ! id -u "$USER_NAME" >/dev/null 2>&1; then
  adduser --disabled-password --gecos '' "$USER_NAME"
fi
usermod -aG sudo "$USER_NAME"
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.ssh"
echo "$PUBKEY" > "/home/$USER_NAME/.ssh/authorized_keys"
chmod 600 "/home/$USER_NAME/.ssh/authorized_keys"
chown "$USER_NAME:$USER_NAME" "/home/$USER_NAME/.ssh/authorized_keys"
# passwordless sudo for the deploy user: the laptop's key is the only way in,
# and it is what lets a deploy restart a unit unattended. Delete this file to
# require a password instead.
echo "$USER_NAME ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/$USER_NAME"
chmod 440 "/etc/sudoers.d/$USER_NAME"

# keys only
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?KbdInteractiveAuthentication .*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd || true

# firewall: the game server (5000), the bot's web app (8000) and its push
# listener (8765) are loopback-only behind Caddy; nothing else is reachable
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# the journal is the only log; a volatile one loses the restore lines that
# are the only record of a fork on every reboot
install -d /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=persistent\nSystemMaxUse=500M\n' > /etc/systemd/journald.conf.d/persistent.conf
systemctl restart systemd-journald

dpkg-reconfigure -f noninteractive unattended-upgrades

echo
echo "bootstrap done. Next, as $USER_NAME: see deploy/README.md § Install."
