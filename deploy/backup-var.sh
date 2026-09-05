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
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
VAR="$REPO/var"
DEST="${ALGO_BACKUP_DIR:-$HOME/algomancy-backups}"
KEEP="${ALGO_BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

[ -d "$VAR" ] || { echo "backup-var: no $VAR — nothing to back up"; exit 0; }
mkdir -p "$DEST"
# --ignore-failed-read: a game file being renamed into place mid-tar is fine.
# --format=posix: the default (gnu) format stores mtimes as WHOLE SECONDS, and
# history.ts keys a game's identity on its file mtime to the millisecond — so a
# restore from a default tarball changed every game's timestamp and the next
# boot re-imported all of them. Found by the restore drill on the first VPS
# deploy (2026-09-05); pax keeps the nanoseconds and the drill diffs clean.
tar --format=posix --ignore-failed-read -czf "$DEST/var-$STAMP.tar.gz" -C "$REPO" var
echo "backup-var: $DEST/var-$STAMP.tar.gz ($(du -h "$DEST/var-$STAMP.tar.gz" | cut -f1))"

# keep the newest $KEEP
ls -1t "$DEST"/var-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f

if [ -n "${ALGO_BACKUP_REMOTE:-}" ]; then
  rsync -a --delete "$DEST/" "$ALGO_BACKUP_REMOTE"
  echo "backup-var: mirrored to $ALGO_BACKUP_REMOTE"
fi
