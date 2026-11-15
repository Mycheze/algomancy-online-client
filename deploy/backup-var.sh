#!/usr/bin/env bash
# Back up var/ — the only state in this project that cannot be rebuilt: the
# account store (password hashes, sessions, everybody's stats), every saved
# game, every playtest report, the owner's card verdicts, the bot's answer
# and feedback logs. CLAUDE.md has said "back it up" since the directory
# existed; this is the first thing that does.
#
# One tarball a day into $ALGO_BACKUP_DIR (default: ~/algomancy-backups),
# keeping the last 14, and — when ALGO_BACKUP_REMOTE is set to an rsync
# destination such as user@host:backups/algomancy/ — mirrored off the box.
# Run by algomancy-backup.timer; run by hand with no arguments to take one now.
#
# ENCRYPTED when ALGO_BACKUP_RECIPIENT (.env) names a gpg key whose PUBLIC half
# is in this box's keyring: then the tarball also holds .env and
# client/server/tester.env, is written only as var-<stamp>.tar.gz.gpg, and no
# plaintext copy is kept. The private key is never on this box, so a break-in
# here cannot read old backups (deploy/README.md § Backups). Unset, it is the
# plain var/ tarball, and a plain tarball NEVER holds the env files.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
VAR="$REPO/var"
DEST="${ALGO_BACKUP_DIR:-$HOME/algomancy-backups}"
KEEP="${ALGO_BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TO="${ALGO_BACKUP_RECIPIENT:-}"

[ -d "$VAR" ] || { echo "backup-var: no $VAR — nothing to back up"; exit 0; }
mkdir -p "$DEST"
what=(var)
if [ -n "$TO" ]; then
  for f in .env client/server/tester.env; do if [ -f "$REPO/$f" ]; then what+=("$f"); fi; done
fi
out="$DEST/var-$STAMP.tar.gz${TO:+.gpg}"
trap 'rm -f "$DEST/.partial-$STAMP"' EXIT
# --ignore-failed-read: a game file being renamed into place mid-tar is fine.
# --format=posix: the default (gnu) format stores mtimes as WHOLE SECONDS, and
# history.ts keys a game's identity on its file mtime to the millisecond — so a
# restore from a default tarball changed every game's timestamp and the next
# boot re-imported all of them. Found by the restore drill on the first VPS
# deploy (2026-09-05); pax keeps the nanoseconds and the drill diffs clean.
# Written under a dot-name and renamed, so a half-written file is never "newest".
tar --format=posix --ignore-failed-read -czf - -C "$REPO" "${what[@]}" \
  | if [ -n "$TO" ]; then gpg --batch --yes --trust-model always -r "$TO" --encrypt; else cat; fi \
  > "$DEST/.partial-$STAMP"
mv "$DEST/.partial-$STAMP" "$out"
echo "backup-var: $out ($(du -h "$out" | cut -f1))${TO:+, encrypted to $TO}"

# keep the newest $KEEP, either shape
ls -1t "$DEST"/var-*.tar.gz* 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f

if [ -n "${ALGO_BACKUP_REMOTE:-}" ]; then
  rsync -a --delete "$DEST/" "$ALGO_BACKUP_REMOTE"
  echo "backup-var: mirrored to $ALGO_BACKUP_REMOTE"
fi
