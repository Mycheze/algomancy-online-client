#!/usr/bin/env node
/* The steward's ship policy — may this diff go to master and the live server
 * without the owner looking at it?
 *
 *   node steward/policy.mjs <base> <head>     prints one JSON object
 *
 * The owner's rule (2026-11-03): "anything but UI flows" ships on a green gate. A flow is a
 * screen added, removed or rebuilt (2026-11-05) — a fix inside an existing screen ships.
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
// "Anything but UI flows" (2026-11-03) was first coded as "any file under client/ui/",
// which is the whole front end: on 2026-11-05 a one-sentence glossary fix, a stack-line
// grammar fix, dead-code removal and a deck-export fix all waited on the owner, ten
// threads in one morning, and he said "I don't want to manually approve all those
// things". A FLOW is a screen that appears, disappears or is rebuilt — not a fix inside
// one. So: a new or deleted UI file, or a big UI rewrite, waits; a fix ships.
const isUi = p => (p.startsWith('client/ui/') && !isUiData(p) && !isTest(p)) || p.startsWith('client/storybook/');
const uiNew = status.filter(s => /^[AD]/.test(s[0]) && isUi(s.at(-1))).map(s => s.at(-1));
if (uiNew.length) reasons.push(`adds or removes UI files (${uiNew.slice(0, 4).join(', ')}${uiNew.length > 4 ? ', …' : ''}) — a new or removed screen is a UI flow, the owner's call`);
const uiLines = rows.filter(r => isUi(r.path)).reduce((n, r) => n + r.add + r.del, 0);
if (uiLines > 250) reasons.push(`${uiLines} changed UI lines (over 250) — a rework of a screen, the owner's call`);

// ── 2. the steward may not change its own leash, the deploy, or the deps ───
const PROTECTED = [/^steward\//, /^\.claude\//, /^deploy\//, /^CLAUDE\.md$/, /(^|\/)package(-lock)?\.json$/,
  /^\.gitignore$/, /^\.env/, /requirements\.txt$/, /^LICENSE$/, /^data\/NOTICE\.md$/];
// …except the skill's own TEXT (2026-11-06). The owner asked for a daily retro that "does an
// update to it to improve weak points" by itself; the skill is instructions, and what actually
// holds the worker — its settings, this policy, the runner, the gate — stays protected above.
// A big rewrite of the instructions still waits for him. The text lives in steward/SKILL.md since
// 2026-11-08 (Claude Code write-protects .claude/ whatever the settings allow, so the agent could
// never edit it there); .claude/skills/steward/SKILL.md is a symlink to it and stays protected.
const SKILL = /^steward\/SKILL\.md$/;
const prot = rows.map(r => r.path).filter(p => PROTECTED.some(re => re.test(p)) && !SKILL.test(p));
if (prot.length) reasons.push(`touches protected files (${prot.join(', ')})`);
const skillLines = rows.filter(r => SKILL.test(r.path)).reduce((n, r) => n + r.add + r.del, 0);
if (skillLines > 150) reasons.push(`${skillLines} changed lines in the steward's own skill (over 150) — a rewrite of how it works, the owner's call`);

// ── 3. deleting a test is never routine ───────────────────────────────────
const delTests = deleted.filter(isTest);
if (delTests.length) reasons.push(`deletes tests (${delTests.join(', ')})`);

// ── 4. append-only contracts (CLAUDE.md) ──────────────────────────────────
for (const r of rows) {
  if (r.path === 'client/engine/src/cards/sets/index.ts' && r.del) reasons.push('removes lines from sets/index.ts (append-only: replays depend on its order)');
  if (r.path === 'data/comprehensive-rules/ledger.json' && r.del) reasons.push('removes lines from the CR number ledger (append-only)');
  // 2026-09-20: a corpus rebuilt without the gitignored rulings inputs dropped 76 rulings, exit 0
  // counted without the CR's own chunks (id "cr:…"): a redrafted rule re-splits them, and on
  // 2026-11-04 CT-428 was held for "shrinks by 1 line" that was one rule merged into its neighbour
  if (r.path === 'data/corpus/algomancy_corpus.jsonl' && r.del > r.add) {
    const nonCr = rev => { try { return git('show', `${rev}:${r.path}`).split('\n').filter(l => l && !l.startsWith('{"id": "cr:')).length; } catch { return 0; } };
    const lost = nonCr(base) - nonCr(head);
    if (lost > 0) reasons.push(`the bot corpus loses ${lost} non-rules rows (lost rulings?)`);
  }
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
