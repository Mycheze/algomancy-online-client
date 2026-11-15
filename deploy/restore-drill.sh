#!/usr/bin/env bash
# deploy/restore-drill.sh [backup-dir] — run where the PRIVATE backup key is
# (the laptop, or the home box), never on the VPS. Takes the newest
# var-*.tar.gz[.gpg] in backup-dir (default ~/algomancy-vps-backups), unpacks it
# into a temp dir — decrypting it first if it is .gpg — and proves it usable:
# var/accounts/accounts.json parses (its account count is printed),
# every complete line of accounts.history.jsonl parses, and the backup is under
# 48 hours old. Prints ONE plain line, never any account data, and removes the
# temp dir. Exit 1 on any failure. Monthly cron line: deploy/README.md § Backups.
set -euo pipefail
DIR="${1:-$HOME/algomancy-vps-backups}"
newest="$(ls -1t "$DIR"/var-*.tar.gz* 2>/dev/null | head -n 1 || true)"
[ -n "$newest" ] || { echo "restore-drill: FAIL no var-*.tar.gz[.gpg] in $DIR"; exit 1; }
hours=$(( ($(date +%s) - $(stat -c %Y "$newest")) / 3600 ))

TMP="$(mktemp -d "${TMPDIR:-/tmp}/algomancy-drill.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP/x"
if ! case "$newest" in
  *.gpg) gpg --batch --quiet --decrypt "$newest" | tar -xzf - -C "$TMP/x" ;;
  *)     tar -xzf "$newest" -C "$TMP/x" ;;
esac 2>"$TMP/err"; then
  echo "restore-drill: FAIL $(basename "$newest"): could not unpack — $(grep -m1 . "$TMP/err")"; exit 1
fi

/usr/bin/python3 - "$TMP/x" "$(basename "$newest")" "$hours" <<'PY'
import json, os, sys
root, name, hours = sys.argv[1], sys.argv[2], int(sys.argv[3])
def fail(why): sys.exit(f"restore-drill: FAIL {name}: {why}")
try: accounts = len(json.load(open(f"{root}/var/accounts/accounts.json"))["accounts"])
except (OSError, ValueError, KeyError, TypeError) as e: fail(f"accounts.json does not load ({type(e).__name__})")
try: raw = open(f"{root}/var/accounts/accounts.history.jsonl", "rb").read()
except OSError: fail("no accounts.history.jsonl")
lines = raw[: raw.rfind(b"\n") + 1].splitlines()   # a torn last line is dropped, as the server does
for n, line in enumerate(lines, 1):
    try: json.loads(line)
    except ValueError: fail(f"history line {n} does not parse")
if hours > 48: fail(f"newest backup is {hours}h old")
env = "with .env" if os.path.exists(f"{root}/.env") else "no .env"
print(f"restore-drill: ok {name} ({hours}h old, {env}): {accounts} accounts, {len(lines)} history lines parse")
PY
