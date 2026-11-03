#!/usr/bin/env node
/* The steward's ship policy — may this diff go to master and the live server
 * without the owner looking at it?
 *
 *   node steward/policy.mjs <base> <head>     prints one JSON object
 *
 * The owner's rule (2026-11-03): "anything but UI flows" ships on a green gate.
 * Everything else here is a tripwire for a mistake no test would catch — each
 * one names the incident or contract it comes from. The agent may always ask
 * for `stage`; this can only turn a `ship` into a `stage`, never the reverse.
 *
 * Output: { verdict: 'ship'|'stage', reasons: [...], deploy: {...}, files: n, lines: n }
 *   deploy.needed       false = nothing on the box changes (ledgers, tests, docs)
 *   deploy.restartGame  engine / server / data the game server reads
 *   deploy.restartBot   bot/ or the corpus and rules the bot reads (web + bot units)
 */
import { execFileSync } from 'node:child_process';

const [base, head] = process.argv.slice(2);
if (!base || !head) { console.error('usage: policy.mjs <base> <head>'); process.exit(2); }
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });

const rows = git('diff', '--numstat', '-M', `${base}...${head}`).trim().split('\n').filter(Boolean)
  .map(l => { const [add, del, path] = l.split('\t'); return { add: +add || 0, del: +del || 0, path: path.replace(/^.*=> /, '').replace(/[{}]/g, '') }; });
const status = git('diff', '--name-status', `${base}...${head}`).trim().split('\n').filter(Boolean)
  .map(l => l.split('\t'));
const deleted = status.filter(s => s[0] === 'D').map(s => s[1]);

const reasons = [];
const isTest = p => /(^|\/)test\/|\.test\.ts$|(^|\/)test_[^/]*\.py$|(^|\/)e2e\//.test(p);
const isUiData = p => p === 'client/ui/updates.ts' || p === 'client/ui/does-lines.json';

// ── 1. UI flows: the owner's own line ─────────────────────────────────────
const ui = rows.map(r => r.path).filter(p => (p.startsWith('client/ui/') && !isUiData(p) && !isTest(p))
  || p.startsWith('client/storybook/'));
if (ui.length) reasons.push(`touches the UI (${ui.slice(0, 4).join(', ')}${ui.length > 4 ? ', …' : ''}) — the owner reviews UI flows`);

// ── 2. the steward may not change its own leash, the deploy, or the deps ───
const PROTECTED = [/^steward\//, /^\.claude\//, /^deploy\//, /^CLAUDE\.md$/, /(^|\/)package(-lock)?\.json$/,
  /^\.gitignore$/, /^\.env/, /requirements\.txt$/, /^LICENSE$/, /^data\/NOTICE\.md$/];
const prot = rows.map(r => r.path).filter(p => PROTECTED.some(re => re.test(p)));
if (prot.length) reasons.push(`touches protected files (${prot.join(', ')})`);

// ── 3. deleting a test is never routine ───────────────────────────────────
const delTests = deleted.filter(isTest);
if (delTests.length) reasons.push(`deletes tests (${delTests.join(', ')})`);

// ── 4. append-only contracts (CLAUDE.md) ──────────────────────────────────
for (const r of rows) {
  if (r.path === 'client/engine/src/cards/sets/index.ts' && r.del) reasons.push('removes lines from sets/index.ts (append-only: replays depend on its order)');
  if (r.path === 'data/comprehensive-rules/ledger.json' && r.del) reasons.push('removes lines from the CR number ledger (append-only)');
  // 2026-09-20: a corpus rebuilt without the gitignored rulings inputs dropped 76 rulings, exit 0
  if (r.path === 'data/corpus/algomancy_corpus.jsonl' && r.del > r.add) reasons.push(`the bot corpus shrinks by ${r.del - r.add} lines (lost rulings?)`);
  if (/^client\/ledgers\/.*-closed\.ts$/.test(r.path) && r.del > r.add + 20) reasons.push(`${r.path} loses ${r.del - r.add} lines (closed entries are regression guards)`);
}

// ── 5. size: a big diff deserves eyes even when it is "just engine" ──────────
const lines = rows.filter(r => !isTest(r.path) && !/^client\/ledgers\//.test(r.path) && !/^data\/(comprehensive-rules|corpus)\//.test(r.path))
  .reduce((n, r) => n + r.add + r.del, 0);
if (lines > 600) reasons.push(`${lines} changed lines outside tests/ledgers/generated rules (over 600)`);

// ── what a deploy has to do ────────────────────────────────────────────────
const paths = rows.map(r => r.path);
const inert = p => isTest(p) || p.startsWith('client/ledgers/') || p.startsWith('client/docs/') || /\.md$/.test(p) && !p.startsWith('data/');
const restartGame = paths.some(p => !isTest(p) && (/^client\/(engine\/src|server)\//.test(p) || (p.startsWith('data/') && !p.startsWith('data/rulings/'))));
const restartBot = paths.some(p => !isTest(p) && (/^bot\//.test(p) && !/^bot\/pipeline\//.test(p) || /^data\/(corpus|comprehensive-rules|cards)\//.test(p)));
const deploy = { needed: paths.some(p => !inert(p)), restartGame, restartBot };

console.log(JSON.stringify({ verdict: reasons.length ? 'stage' : 'ship', reasons, deploy, files: rows.length, lines }, null, 1));
