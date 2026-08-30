#!/usr/bin/env node
/* `npm run reports` — bring the owner's bug reports and card verdicts down off
 * the deploy box, and say what came with them.
 *
 * WHY THIS IS A SCRIPT AND NOT A LINE IN A README. It was a line in a README —
 * an scp in the header of 70-playtest-ledger.test.ts. The 2026-08-30 reorg
 * moved `issues.jsonl` from `client/server/` to `var/` and the line did not
 * move with it, so the command fetched nothing (scp says "No such file" and
 * exits, and nobody reads the output of a command they believe is bookkeeping).
 * The snapshot sat at 135 rows for three rounds while the server had 147.
 * Twelve owner reports, four of them engine-level, were invisible to a green
 * suite. R275.
 *
 * So: one word, a path that is derived rather than typed, and loud failure.
 * The one thing this script must never do is finish quietly having written
 * nothing — that is the exact failure it exists to end.
 *
 *   node scripts/fetch-reports.mjs            fetch both, report the delta
 *   node scripts/fetch-reports.mjs --dry-run  print what it would fetch
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  DEPLOY_HOST, ISSUES_JSONL, ISSUES_SNAPSHOT, VAR_DIR, VERDICTS_JSONL, remote,
} from './paths.mjs';

const DRY = process.argv.includes('--dry-run');

/** die with a message a human can act on; never exit 0 having done nothing */
function fail(what) {
  console.error(`\n✗ ${what}\n`);
  process.exit(1);
}

/* ── 0. never fetch a file onto itself ────────────────────────────────────
 * On the deploy box the local copy of these paths IS the live data, and the
 * only copy of it. scp-ing a file over itself truncates it. accounts.json,
 * issues.jsonl and verdicts.jsonl cannot be rebuilt from anything. */
if (hostname().startsWith('benshomeserver')) {
  fail(`this is ${hostname()} — the deploy box. ${ISSUES_JSONL} here IS the live file, `
    + 'and fetching it onto itself would truncate the only copy. Run this from the dev machine.');
}

/** count the JSON lines in a file, or null if it is not there */
function rowsOf(file) {
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).length;
}

const before = rowsOf(ISSUES_SNAPSHOT);

/**
 * Fetch one remote file to a scratch path first, check it, then move it.
 *
 * Straight into place would mean a half-copied or empty transfer overwrites a
 * good snapshot — losing reports to the very command whose job is not losing
 * reports.
 */
function fetch(src, dest, scratch) {
  const from = remote(src);
  if (DRY) { console.log(`  would fetch ${from}\n            -> ${dest}`); return null; }

  const tmp = join(scratch, 'fetched.jsonl');
  try {
    execFileSync('scp', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', from, tmp],
      { stdio: ['ignore', 'inherit', 'inherit'] });
  } catch (e) {
    fail(`scp ${from} failed (${e.code === 'ENOENT' ? 'no scp on this machine' : e.message}).\n`
      + `  Is ${DEPLOY_HOST} up and reachable, and is your key on it?\n`
      + `  Nothing was written; ${dest} is unchanged.`);
  }
  if (!existsSync(tmp) || statSync(tmp).size === 0) {
    fail(`scp reported success but ${from} arrived empty. ${dest} left alone.`);
  }
  const text = readFileSync(tmp, 'utf8');
  const lines = text.split('\n').filter(l => l.trim());
  lines.forEach((line, i) => {
    try { JSON.parse(line); }
    catch { fail(`${from} line ${i + 1} is not JSON — a partial transfer. ${dest} left alone.`); }
  });

  const had = rowsOf(dest);
  if (had !== null && lines.length < had) {
    fail(`${from} has ${lines.length} rows but ${dest} already has ${had}. That is a SHRINK — `
      + 'either the server file was truncated or this is the wrong file. Refusing to overwrite; '
      + `the fetched copy is at ${tmp} if you want to look at it.`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(tmp, dest);
  return lines.length;
}

const scratch = DRY ? '' : mkdtempSync(join(tmpdir(), 'algo-reports-'));
try {
  console.log(`fetching from ${DEPLOY_HOST}…`);
  const issues = fetch(ISSUES_JSONL, ISSUES_SNAPSHOT, scratch);
  // verdicts have no committed snapshot — the transcription in
  // ledgers/unreached.ts is read by a human, so the raw file lands in var/,
  // which is gitignored on this machine as it is on the server.
  const verdicts = fetch(VERDICTS_JSONL, join(VAR_DIR, 'verdicts.jsonl'), scratch);
  if (DRY) process.exit(0);

  const delta = issues - (before ?? 0);
  console.log(
    `\nissues:   snapshot ${before ?? 0} -> server ${issues}: `
    + (delta > 0
      ? `${delta} NEW REPORT${delta === 1 ? '' : 'S'}. `
        + 'Run the suite: 70-playtest-ledger.test.ts is now red until every one of them has a '
        + 'ledger entry in client/ledgers/playtest-ledger.ts.'
      : 'no new reports.'));
  console.log(`verdicts: ${verdicts} rows -> var/verdicts.jsonl`);
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
