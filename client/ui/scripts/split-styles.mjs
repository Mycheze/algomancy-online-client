/* THE SPLIT: the old single `client/ui/style.css` → the pieces under `client/ui/styles/`.
 *
 * Design-system round, Phase 1a (client/docs/23-design-system.md). STRUCTURE
 * ONLY: every line of the input goes into exactly one piece, word for word,
 * and the pieces are listed in styles/index.css in the order that puts every
 * line back where it was. Nothing is reordered — style.css is a changelog of
 * overrides, and a rule moved above one it overrides changes the page — so a
 * page whose CSS sat in two runs between board sections is two pieces.
 *
 * RE-RUNNABLE. It cuts whatever style.css is handed to it, at the MARKERS in
 * PIECES below (a line that starts with the marker text — the section
 * banners, mostly), never at line numbers. So other branches that add lines to
 * style.css before the split lands just mean running it again:
 *
 *   node client/ui/scripts/split-styles.mjs --rev origin/master
 *       reads `git show origin/master:client/ui/style.css`
 *   node client/ui/scripts/split-styles.mjs path/to/style.css
 *       reads a file
 *   node client/ui/scripts/split-styles.mjs           (no input named)
 *       reads client/ui/style.css if it is still on disk
 *   …add --check to verify only and write nothing.
 *
 * IT FAILS LOUDLY, AND WRITES NOTHING, WHEN
 *   - a marker matches no line, or more than one, or they come out of order;
 *   - a section banner (a line opening `/* ──` or `/* ═══`) is neither a
 *     marker nor a known inner banner — a NEW section, which would otherwise
 *     ride silently into whichever piece precedes it. Add it to PIECES (its
 *     own piece) or INNER (it stays in the piece above), or pass
 *     --absorb-new-banners to accept where it lands;
 *   - any input line lands in no piece or in two;
 *   - the pieces, concatenated in index.css order, are not byte-identical to
 *     the input — checked in memory before writing, and again off the disk
 *     (through ui/scripts/styles.mjs, the code the build and the tests use)
 *     after.
 *
 * WHAT IT OWNS. It rewrites styles/ whole: every `.css` there is removed
 * before the pieces are written. That is right exactly until the split is
 * committed. After that styles/ is CANONICAL and hand-edited, and running
 * this would throw those edits away — so once the split has landed on
 * master, this script is history (delete it in Phase 1b).
 *
 * Piece names carry their place in the cascade as a two-digit prefix, given
 * here by position, so `ls styles/*\/` reads in order. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { REPO_ROOT, STYLES_DIR, STYLES_INDEX, UI_DIR } from '../../engine/scripts/paths.mjs';
import { concatStyles, parseOrder, stylesOnDisk } from './styles.mjs';

/* ── THE MARKER MAP ─────────────────────────────────────────────────────
 * [directory, name, marker, { optional }?]. A piece runs from the line its marker starts to
 * the line before the next piece's marker; the first runs from line 1. The
 * kind (board / pages / shared) is the census's (client/docs/23-ui-inventory/
 * 07-design-foundations.md §9a): board = the game table, pages = a screen
 * that is not the table, shared = used by both. An `optional` piece whose
 * marker matches no line is left out instead of failing. */
const PIECES = [
  ['', 'tokens', null],   // the header comment and the first :root
  ['', 'base', '@font-face {'],   // the title face, box-sizing, body, the #app shell, the base button
  ['board', 'promptbar', '.promptbar {'],
  ['board', 'life-cards-battle-log', '/* ── the life meter'],
  ['pages', 'joinscreen', '/* ── network mode'],
  ['board', 'resources-presence', '/* ── resource cards'],
  ['pages', 'home', '/* ── the pre-game screens'],
  ['pages', 'lobby', '/* ── constructed deck picker + waiting lobby'],
  ['board', 'playtest-ux-fixes', '/* ── playtest UX fixes'],
  ['board', 'region-overhaul', '/* ── region-board overhaul'],
  ['shared', 'element-chips', '/* ── element chips'],
  ['board', 'hotfixes-help-judge-overlays', '/* ── hotfixes: bins-in-region'],
  ['board', 'playtest-round3', '/* ── playtest round 3'],
  ['board', 'playtest-round4-clocks-report', '/* ── playtest round 4'],
  ['board', 'light-and-dark', '/* ═══ Light & Dark'],
  ['board', 'anim-arrows', '/* ── the visual-clarification layer'],
  ['board', 'fills-window', '/* ── the board fills the window'],
  ['pages', 'accounts', '/* ── accounts: the home strip'],
  ['pages', 'draft-lobby', '/* ── the draft lobby'],
  ['pages', 'postgame', '/* ── the post-game screen'],
  ['board', 'stack', '/* ── the stack: a little window'],
  ['board', 'textbox', '/* ── the current text box'],
  ['board', 'scenario-strip', '/* ── CR D8.4: the scenario tester'],
  ['pages', 'decks', '/* ── the deck collection'],
  ['pages', 'tabletop', '/* ── THE TABLETOP'],
  ['pages', 'binder', '/* ── THE BINDER'],
  ['pages', 'deckstrip-curve-affinity', '/* ── TABLETOP: DECK STRIP'],
  ['pages', 'cards', '/* ── the card browser'],
  ['pages', 'metagame', '/* ── BL-34/35/36'],
  ['board', 'cost-toasts', '/* ═══ CR D7.4 / CT-142'],
  ['pages', 'queue', '/* ── BL-01: the matchmaking queue'],
  ['pages', 'admin', '/* ── BL-16: the admin dashboard'],
  ['pages', 'learn', '/* ── CR D8.1 Learn to Play (ui/lessonlayer.ts'],
  ['pages', 'single-card-duel', '/* ═══ CR D8.2 — Single Card Duel'],
  ['pages', 'cardstats', '/* ── CARD STATS'],
  ['pages', 'deck-modals', "/* ── the deck page's two modals"],
  ['board', 'replaybar', '/* ═══ BL-38 — the match replay transport'],
  ['shared', 'touch', '/* ── TOUCH ('],
  ['shared', 'drag', '/* ── DRAG TO PLAY'],
  ['board', 'regions', '/* ═══ THE REGIONS BOARD'],
  ['board', 'info-line-phase-icons', '/* ── THE INFO LINE'],
  ['board', 'regions-blocks', '/* ── the In Play block'],
  ['board', 'zoom-ressum-infotip', '/* ═══ THE CARD ZOOM'],
  ['board', 'toolbar', '/* ── BOARD ROUND 8: THE TOOLBAR'],
  ['pages', 'league', '/* ── the league page'],
  ['pages', 'crreview', '/* ── THE RULES REVIEW PAGE'],
  ['pages', 'challenge', '/* ── the weekly challenge'],
  // OPTIONAL: on the cc-* (competitive constructed) branches, not yet on master
  // when the split was written. Absent → no piece; present → its own piece.
  ['pages', 'competitive-match', '/* ── docs/22: a Competitive match', { optional: true }],
];

/* banners that stay inside the piece above them (sub-sections) */
const INNER = [
  '/* ── home screen',
  '/* ── recent updates',
  '/* ── live draft panel',
  '/* ── presence + share',
  '/* ── CR 112.13, 112.15: rot & debt',
  '/* ── CR D6.16: the cache',
  '/* ── {Modular}: mods riding',
  '/* ── log lines for the new events',
  '/* ── §log modal',
  '/* ── targeting arrows',
  '/* ── watching the opponent build a formation',
  '/* ── THE STACK HAS FOUR COLOURS',
  '/* ── an ABILITY on the stack',
  '/* ── the rail ──',
  '/* ── the open deck ──',
  '/* ── the card grid ──',
  '/* ── the curve ──',
  '/* ── the affinity table ──',
  '/* ═══ CR D7.2b, D6.6d',
  '/* ── CR D8.1 Learn to Play, round 2',
  '/* ── THE PHASE ICONS',
  '/* ── the Invaders rows',
  '/* ── the counterattack send box',
  '/* ── the battle block that holds the fight',
  '/* ── CHECKPOINT 4: invaders as a PILE',
  '/* ── card size: the fit pass',
  '/* ── the stack window sits over',
  '/* ── CT-191: "their hand, seen"',
  '/* ── ROUND 7 — THE FIGHT BLOCK GROWS',
  '/* ═══ THE RESOURCE WINDOW',
  '/* ═══ THE INFO TIP',
  '/* ── round 4 (owner, 2026-09-26)',
];

const BANNER = /^\/\* (──|═══)/;

const INDEX_HEADER = `/* THE STYLESHEET'S ORDER — the cascade. CANONICAL; edit by hand.
 *
 * The browser gets one file, client/ui/bundle.css (generated, gitignored),
 * which \`npm --prefix client/ui run build\` writes as the pieces below
 * concatenated byte for byte in THIS order (ui/scripts/build-css.mjs). The
 * tests read the same concatenation (ui/test/read-styles.ts).
 *
 * The order is load-bearing. The stylesheet grew as a changelog — later
 * sections override earlier ones — so these pieces are in the order their
 * lines had in the old single style.css (split 2026-11-02 by
 * ui/scripts/split-styles.mjs, word for word). Moving a piece moves rules past
 * the rules they override. A new piece goes here exactly once, or the build
 * refuses it (ui/test/920 too).
 *
 * A url() inside a piece resolves from client/ui/, where bundle.css is served,
 * not from the piece's own folder.
 *
 * Only comments and @import lines may appear in this file.
 */
`;

/* ── input ─────────────────────────────────────────────────────────── */

function fail(msg) {
  console.error(`split-styles: ${msg}\nNothing was written.`);
  process.exit(1);
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const absorb = args.includes('--absorb-new-banners');
const revAt = args.indexOf('--rev');
const rev = revAt >= 0 ? args[revAt + 1] : null;
if (revAt >= 0 && (!rev || rev.startsWith('--'))) fail('--rev needs a revision, e.g. --rev origin/master');
const positional = args.filter((a, i) => !a.startsWith('--') && !(revAt >= 0 && i === revAt + 1));
if (positional.length > 1 || (positional.length && rev)) fail('name ONE input: --rev <rev>, or a path');

const OLD = join(UI_DIR, 'style.css');   // the pre-split file; this script is the last thing that names it
let input, from;
if (rev) {
  const spec = `${rev}:${relative(REPO_ROOT, OLD).split('\\').join('/')}`;
  try {
    input = execFileSync('git', ['show', spec], { cwd: REPO_ROOT, encoding: 'buffer', maxBuffer: 64 << 20 });
  } catch { fail(`git show ${spec} failed — is ${rev} a revision that still has style.css?`); }
  from = `git show ${spec}`;
} else {
  const p = positional[0] ?? OLD;
  if (!existsSync(p)) {
    fail(`${p} does not exist. style.css is gone once the split is applied; name its source:\n`
      + '  node client/ui/scripts/split-styles.mjs --rev origin/master   (or a path)');
  }
  input = readFileSync(p);
  from = p;
}
const text = input.toString('utf8');
if (!Buffer.from(text, 'utf8').equals(input)) fail(`${from} is not valid UTF-8 — byte identity could not hold`);
if (text.length === 0) fail(`${from} is empty`);

/* ── cut ───────────────────────────────────────────────────────────── */

/* lines WITH their terminators, so joining them is the input exactly */
const lines = text.match(/[^\n]*\n|[^\n]+$/g);
if (lines.join('') !== text) fail('internal: the line split does not rejoin to the input');

const starts = [0];
const problems = [];
const present = [PIECES[0]];
for (const [dir, name, marker, opt] of PIECES.slice(1)) {
  const hits = lines.flatMap((l, i) => (l.startsWith(marker) ? [i] : []));
  if (hits.length === 0 && opt?.optional) continue;
  present.push([dir, name, marker]);
  if (hits.length !== 1) {
    problems.push(`marker for ${dir}/${name} ${JSON.stringify(marker)} matches ${hits.length} lines`
      + (hits.length ? ` (${hits.map(i => i + 1).join(', ')})` : ''));
    starts.push(-1);
    continue;
  }
  if (hits[0] <= starts[starts.length - 1]) {
    problems.push(`marker for ${dir}/${name} (line ${hits[0] + 1}) comes before the piece above it`);
  }
  starts.push(hits[0]);
}
if (problems.length) fail(`the marker map does not fit this input:\n  ${problems.join('\n  ')}`);

const markerLines = new Set(starts.slice(1));
const unknown = [];
lines.forEach((l, i) => {
  if (!BANNER.test(l) || markerLines.has(i) || INNER.some(m => l.startsWith(m))) return;
  const owner = starts.filter(s => s <= i).length - 1;
  const [dir, name] = present[owner];
  unknown.push(`line ${i + 1}: ${l.trimEnd().slice(0, 90)}\n      (would land in ${dir ? dir + '/' : ''}${name})`);
});
if (unknown.length && !absorb) {
  fail(`section banners that are neither a cut nor a known inner banner — a new section?\n  ${unknown.join('\n  ')}\n`
    + 'Add each to PIECES (its own piece) or INNER (stays where it lands) in this script, '
    + 'or re-run with --absorb-new-banners.');
}
const unusedInner = INNER.filter(m => !lines.some(l => l.startsWith(m)));
if (unusedInner.length) console.warn(`split-styles: note — inner banners not found (renamed or removed?): ${unusedInner.join(' | ')}`);

const pieces = present.map(([dir, name], k) => {
  const file = dir === '' ? `${name}.css` : `${dir}/${String(k).padStart(2, '0')}-${name}.css`;
  const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
  return { file, from: starts[k], to: end };
});

/* every line in exactly one piece */
const owners = new Array(lines.length).fill(0);
for (const p of pieces) for (let i = p.from; i < p.to; i++) owners[i]++;
const orphan = owners.flatMap((n, i) => (n === 0 ? [i + 1] : []));
const doubled = owners.flatMap((n, i) => (n > 1 ? [i + 1] : []));
if (orphan.length || doubled.length) {
  fail(`line ownership is broken: in no piece ${orphan.slice(0, 10).join(', ') || '—'}; in two ${doubled.slice(0, 10).join(', ') || '—'}`);
}
const empty = pieces.filter(p => p.to <= p.from).map(p => p.file);
if (empty.length) fail(`empty pieces: ${empty.join(', ')}`);

const body = pieces.map(p => lines.slice(p.from, p.to).join(''));
const order = INDEX_HEADER + pieces.map(p => `@import "${p.file}";\n`).join('');
const reparsed = parseOrder(order);
if (reparsed.join('\n') !== pieces.map(p => p.file).join('\n')) fail('internal: index.css does not parse back to the piece list');
if (Buffer.compare(Buffer.from(body.join(''), 'utf8'), input) !== 0) fail('the pieces do not re-concatenate to the input (in memory)');

/* ── report, write, re-verify ──────────────────────────────────────── */

const w = Math.max(...pieces.map(p => p.file.length));
for (const p of pieces) console.log(`  ${p.file.padEnd(w)}  ${String(p.to - p.from).padStart(5)} lines  (${p.from + 1}–${p.to})`);
console.log(`split-styles: ${from}: ${lines.length} lines → ${pieces.length} pieces, byte-identical in memory`);
if (unknown.length) console.warn(`split-styles: ${unknown.length} new banner(s) absorbed:\n  ${unknown.join('\n  ')}`);
if (check) { console.log('split-styles: --check, nothing written'); process.exit(0); }

if (existsSync(STYLES_DIR)) {
  for (const p of stylesOnDisk()) rmSync(join(STYLES_DIR, p));
  const prune = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      prune(join(d, e.name));
      if (readdirSync(join(d, e.name)).length === 0) rmSync(join(d, e.name), { recursive: true });
    }
  };
  prune(STYLES_DIR);
}
pieces.forEach((p, k) => {
  const out = join(STYLES_DIR, p.file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, body[k]);
});
writeFileSync(STYLES_INDEX, order);

if (Buffer.compare(Buffer.from(concatStyles(), 'utf8'), input) !== 0) {
  console.error('split-styles: WRITTEN, BUT styles/ read back through styles.mjs is NOT the input. Do not commit this.');
  process.exit(1);
}
console.log(`split-styles: wrote ${pieces.length} pieces + index.css under ${relative(REPO_ROOT, STYLES_DIR)}/; read back byte-identical`);
console.log('next: npm --prefix client/ui run build   (bundle.css = the same bytes)');
