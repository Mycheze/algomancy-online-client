#!/bin/bash
# The VPS's end of the steward's read-only fetch key: the ONE command that key can run.
#   ~/.ssh/authorized_keys:  command="/usr/local/bin/algomancy-steward-fetch",restrict ssh-ed25519 AAAA… steward-fetch
# It writes ONE runtime file to stdout — exactly the paths steward/vps-fetch.sh allows (the same
# test), resolved inside var/ and never through a link out of it. No shell, no other command, so
# never accounts.json or .env. The key runs a root-owned COPY (steward/README.md): no commit, the
# steward's or an approved one, changes what the key can read until the owner installs it again.
set -euo pipefail
ROOT=$(readlink -f "${1:-/home/bena/Documents/Algomancy}")   # $1 is the test seam: ssh cannot pass arguments to a forced command
p="${SSH_ORIGINAL_COMMAND:-}"
allowed() { [[ "$1" =~ ^var/(games/[A-Za-z0-9_-]+\.json|challenges/[A-Za-z0-9_./-]+\.json|report-runs\.jsonl|issues\.jsonl|verdicts\.jsonl|card-edits/index\.json|card-edits/ce-[0-9]{8}-[a-z0-9]+(-[a-z0-9]+)*-[0-9a-f]{4}(\.json|/(before|after)\.jpg))$ ]] && [[ "$1" != *..* ]]; }
allowed "$p" || { echo "steward-fetch: refusing '$p'" >&2; exit 2; }
# …and so is the file it names, once every link is followed
f=$(readlink -f "$ROOT/$p") && allowed "${f#"$ROOT"/}" && [ -f "$f" ] || { echo "steward-fetch: no such file $p" >&2; exit 1; }
exec cat -- "$f"
