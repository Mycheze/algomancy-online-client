/* 324 — THE REGIONS BOARD'S INFO BLOCK: resources you can read and activate
 * (owner, 2026-09-26).
 *
 * *"The resources are now hard to see and count … a clearer count. Plus maybe
 * a single tooltip on hover … What you usually care about is how much you have
 * of each and how much mana."* And, mid-review: *"It was also a pain to
 * activate resources after spawning them dormant … without having to thread
 * the needle with the mouse."*
 *
 * §1  resourceSummary: the window's numbers, and its affinity column is the
 *     engine's own E.affinity
 * §2  resSumHtml / resSumBox: what the window says, and that it sits beside
 *     the row and never on it
 * §3  the painted row: a run of two or more carries its count, a dormant
 *     resource you can activate now is a WAKE run that sorts first, and the
 *     grouped cards drop the native title (the window replaces it); each
 *     name keeps a slot for the initiative star
 * §4  zoomTarget leaves an info block's resources to the window
 *
 * The pin itself (name and life fixed to the outer edge) is CSS, and so is
 * the still frame round the board (a one-line top bar, an action bar that
 * does not shrink in a battle); §5 reads both off the stylesheet. A browser walk proved the hover wiring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { giveResources } from '../../engine/test/util.ts';
import type { ResourceKind } from '../../engine/src/types.ts';
import { resourceSummary } from '../resources.ts';
import { resSumBox, resSumHtml } from '../ressum.ts';
import { zoomTarget } from '../zoom.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const CSS = readFileSync(fileURLToPath(new URL('../style.css', import.meta.url)), 'utf8');
const store = (globalThis as { localStorage: Storage }).localStorage;

/** planning, seat 0 with a mixed row: 3 water open, 2 fire dormant, 1 dark
 * expended, 1 shard open; seat 1 with an opponent's face-down resource */
function game(): Harness {
  const h = new Harness(32401);
  assert.equal(h.state.phase, 'planning');
  h.state.players[0]!.resources = [];
  h.state.players[1]!.resources = [];
  giveResources(h, 0, 'water', 3);
  giveResources(h, 0, 'fire', 2, 'dormant');
  giveResources(h, 0, 'dark', 1, 'expended');
  giveResources(h, 0, 'shard', 1);
  giveResources(h, 1, 'metal', 2);
  // what the server sends of the other seat's dormant resource (server/view.ts)
  h.state.players[1]!.resources.push({ kind: 'hidden' as ResourceKind, state: 'dormant' });
  return h;
}

/* ── §1 the numbers ─────────────────────────────────────────────────── */
test('§1 the summary counts each kind by state, and its affinity is E.affinity', () => {
  const h = game();
  const e = new E(h.state);
  const s = resourceSummary(e, 0);
  assert.equal(s.mana, e.openMana(0));
  assert.equal(s.mana, 4, '3 water + the shard');
  assert.equal(s.activations, h.state.players[0]!.activationsLeft, 'planning: activations are shown');
  assert.deepEqual(s.rows.map(r => r.kind), ['fire', 'water', 'dark', 'shard'], 'the elements in rules order, then shard');
  const row = (k: string) => s.rows.find(r => r.kind === k)!;
  assert.deepEqual([row('water').open, row('water').expended, row('water').dormant], [3, 0, 0]);
  assert.deepEqual([row('fire').open, row('fire').dormant], [0, 2]);
  assert.equal(row('dark').expended, 1);
  for (const r of s.rows) {
    if (r.kind === 'shard') assert.equal(r.affinity, null, 'a shard grants no affinity');
    else assert.equal(r.affinity, e.affinity(0, r.kind), `${r.kind}: the engine's own answer`);
  }
  assert.equal(row('dark').affinity, 1, 'an expended resource still grants affinity');
  assert.equal(row('fire').affinity, 0, 'a dormant one does not');
  assert.ok(s.anyDormant);

  const o = resourceSummary(e, 1);
  const hidden = o.rows.find(r => r.kind === 'hidden')!;
  assert.equal(hidden.dormant, 1);
  assert.equal(hidden.affinity, null, 'a face-down resource has no knowable affinity');
  assert.equal(o.rows.at(-1)!.kind, 'hidden', 'what cannot be seen comes last');
});

test('§1 outside planning the activations are not shown', () => {
  const h = game();
  h.state.phase = 'deploy';
  assert.equal(resourceSummary(new E(h.state), 0).activations, null);
});

/* ── §2 the window ──────────────────────────────────────────────────── */
test('§2 the window says the mana, a line per kind, and what dormant means', () => {
  const h = game();
  const html = resSumHtml(resourceSummary(new E(h.state), 0));
  assert.match(html, /<b class="rsmana">4<\/b> mana open/);
  assert.match(html, /activations? left/);
  assert.match(html, /<tr class="rs-fire"><th>[^]*?Fire<\/th><td class="rsnil">–<\/td><td class="rsnil">–<\/td><td>2<\/td><td class="rsnil">–<\/td><\/tr>/,
    'fire: none open, none expended, two dormant, no affinity');
  assert.match(html, /<tr class="rs-shard"><th>Shard<\/th>/);
  assert.match(html, /Dormant: no mana or affinity/);
  assert.doesNotMatch(html, /data-/, 'nothing in the window can be found as an anchor or take a click');
  const bare = resSumHtml({ mana: 0, activations: null, rows: [], anyDormant: false });
  assert.match(bare, /<b class="rsmana">0<\/b> mana open/, 'zero mana is still said');
});

test('§2 it sits beside the row — below theirs, above yours — and never on it', () => {
  const view = { w: 1344, h: 768 };
  const box = { width: 240, height: 150 };
  const overlaps = (r: { left: number; top: number; width: number; height: number }, at: { left: number; top: number }): boolean =>
    at.left < r.left + r.width && at.left + box.width > r.left && at.top < r.top + r.height && at.top + box.height > r.top;
  const theirs = { left: 12, top: 40, width: 300, height: 34 };
  const t = resSumBox(theirs, box, view, 'below', 'left');
  assert.ok(t.top >= theirs.top + theirs.height, 'below the opponent\'s row');
  assert.equal(t.left, 12, 'lined up with the row\'s outer edge');
  const mine = { left: 900, top: 690, width: 400, height: 34 };
  const m = resSumBox(mine, box, view, 'above', 'right');
  assert.ok(m.top + box.height <= mine.top, 'above your row');
  assert.ok(m.left + box.width <= view.w - 8 + 0.01, 'inside the right edge');
  assert.equal(m.left + box.width, mine.left + mine.width, 'lined up with the row\'s outer edge');
  // no room on its side: the other side, still never on the row
  const low = { left: 12, top: 700, width: 300, height: 34 };
  const f = resSumBox(low, box, view, 'below', 'left');
  assert.ok(!overlaps(low, f) && f.top >= 8);
  for (const [r, at] of [[theirs, t], [mine, m], [low, f]] as const) assert.ok(!overlaps(r, at));
});

/* ── §3 the painted row ─────────────────────────────────────────────── */
test('§3 counts, the WAKE run first, and no native title on the grouped row', () => {
  const h = game();
  store.setItem('algoLayout', '2');
  ui.join(h.state, 0, legalActions(h.state, 0));
  const html = ui.update(h.state, legalActions(h.state, 0));
  const m = /<span class="resrow lresrow" data-animzone="res:0">([^]*?)<span class="resmana">/.exec(html);
  assert.ok(m, 'the regions board draws the grouped row');
  const row = m[1]!;
  const groups = [...row.matchAll(/<span class="resgroup([^"]*)">/g)].map(g => g[1]!.trim());
  assert.equal(groups[0], 'wake', 'the dormant resources you can activate come first');
  assert.equal(groups.filter(g => g === 'wake').length, 1, 'one run: the two fires');
  const wake = row.slice(0, row.indexOf('<span class="resgroup">'));
  assert.equal((wake.match(/class="rescard dormant fire canact/g) ?? []).length, 2, 'both fires, each a target');
  assert.match(row, /<span class="rescount">3<\/span>/, 'the three waters say three');
  assert.doesNotMatch(row, /<span class="rescount">1<\/span>/, 'a single card needs no count');
  assert.doesNotMatch(row, / title="/, 'the window replaces the per-card tooltip');
  assert.match(html, /<b class="resmananum">4<\/b> mana open/);
  // the initiative star keeps its slot on both names, so the life beside it never moves
  assert.equal((html.match(/<span class="linit(?: off)?"/g) ?? []).length, 2, 'a star slot on each name');
  assert.equal((html.match(/<span class="linit off"/g) ?? []).length, 1, 'one seat has the initiative');
  // classic keeps its titles and has none of this
  store.removeItem('algoLayout');
  const classic = ui.update(h.state, legalActions(h.state, 0));
  assert.match(classic, /class="rescard open water" title="water \(open\)"/);
  assert.doesNotMatch(classic, /rescount|resgroup wake|linit/);
});

test('§3 with no activation left the dormant run fans like any other', () => {
  const h = game();
  h.state.players[0]!.activationsLeft = 0;
  store.setItem('algoLayout', '2');
  const html = ui.update(h.state, legalActions(h.state, 0));
  store.removeItem('algoLayout');
  assert.doesNotMatch(html, /resgroup wake/);
  assert.match(html, /<span class="rescount">2<\/span>/, 'the two dormant fires, counted');
});

/* ── §4 the zoom stands aside ───────────────────────────────────────── */
test('§4 an info block\'s resource is not a zoom target; a card elsewhere still is', () => {
  const el = (inside: string[]): Element => {
    const card = {
      querySelector: (s: string) => (s === 'img' ? {} : null),
      closest: (s: string) => (inside.includes(s) ? card : null),
    };
    return { closest: (s: string) => (s.includes('.rescard') ? card : null) } as unknown as Element;
  };
  assert.equal(zoomTarget(el(['.linfo .lres'])), null);
  assert.notEqual(zoomTarget(el([])), null);
});

/* ── §5 the pin ─────────────────────────────────────────────────────── */
test('§5 the info grid packs against the outer edge, not the middle', () => {
  assert.match(CSS, /\.linfo > \.lin \{[^}]*align-content: start;/);
  assert.match(CSS, /\.linfo\.mine > \.lin \{ align-content: end; \}/);
  assert.doesNotMatch(CSS, /\.linfo > \.lin \{[^}]*align-content: center/);
  assert.match(CSS, /\.linfo\.mine \.lcache, \.linfo\.mine \.lbin \{ align-self: end; \}/);
});

test('§5 the frame round the board holds still: a one-line top bar, an action bar with a floor', () => {
  assert.match(CSS, /#app\.board\.v2 \.topbar \{ flex-wrap: nowrap;/);
  assert.match(CSS, /#app\.board\.v2 \.actionbar:has\(\.promptbar\) \{ min-height: \d+px;/);
});
