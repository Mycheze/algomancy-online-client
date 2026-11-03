/*
 * 1060 · THE BOARD READS ON THE PURPLE — five things the owner reported on
 * 2026-11-03, the night the Manual's palette went live (test/1030).
 *
 *   §1  the info tip holds its text. "Battle · round 2 · attack — responses ·
 *       Turn 2 · you have the initiative" ran out of the box past its right
 *       edge: the box is capped at 360px and its line was `nowrap`. A line
 *       wraps now, and the box is measured with the whole window to grow into
 *       (infotip.ts place), not squeezed where the last window stood.
 *   §2  the card text beside a zoom is ONE box. The panel (#cardzoom >
 *       .zoompanel) had its own frame and the text box (.textbox) inside it had
 *       another, inset ~16px; on the purple the two grounds told apart and it
 *       read as a box in a box. The panel keeps the frame, the text box gives
 *       its own up — and a changed card's orange edge moves to the panel.
 *   §3  the action bar: its grounds are the palette's, one per state, and it is
 *       ONE height ("the action bar should have a constant height so that, when
 *       it needs another row, it doesn't constantly move the whole UI up and
 *       down. Just give it the height it needs at all times."). Two rows of
 *       buttons, measured over 280 distinct bars from 60 random games; taller
 *       bars stand up out of the slot instead of pushing the board.
 *   §4  no faint words in the battle's empty slots ("blocker gone", "unblocked"
 *       — "Better to remove it and represent in other ways"): each empty half
 *       is a marked shape, named in its aria-label and title.
 *
 * (The fifth, a colour-blind mode, is BL-51 in ledgers/backlog.ts: not built.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { spawn, toDeployment, toNextBattle, withE } from '../../engine/test/util.ts';
import type { Seat } from '../../engine/src/types.ts';
import { client } from './ui-driver.ts';
import { readStyles } from './read-styles.ts';

const CSS = readStyles();
const read = (f: string): string => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8');
const MAIN = read('main.ts');
const INFOTIP = read('infotip.ts');

/** every rule whose selector list names `sel` exactly, as its declaration text */
function rules(sel: string): string[] {
  const out: string[] = [];
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[},/])\\s*((?:[^{}]*,\\s*)?${esc}(?:\\s*,[^{}]*)?)\\s*\\{([^}]*)\\}`, 'g');
  for (const m of CSS.matchAll(re)) {
    const selectors = m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').split(',').map(s => s.trim());
    if (selectors.includes(sel)) out.push(m[2]!);
  }
  return out;
}

test('§1 the info tip: capped in width, so no line of it is kept from wrapping', () => {
  const box = rules('#infotip');
  assert.ok(box.some(r => /max-width:\s*\d+px/.test(r)), 'the premise: the window has a width cap');
  for (const line of ['#infotip .tipline', '#infotip .tiphead', '#infotip .tipfoot']) {
    for (const r of rules(line)) {
      assert.doesNotMatch(r, /white-space:\s*nowrap/, `${line} must wrap at the cap, not run out of the box`);
    }
  }
  assert.ok(rules('#infotip .tipline').length, 'the phase caption\'s line has its rule');
  // the box is measured where it can grow: placed back at the window's origin
  // before its size is read, every time
  const place = INFOTIP.slice(INFOTIP.indexOf('function place('), INFOTIP.indexOf('export function tipAt'));
  const reset = place.indexOf(`host.style.left = '0px'`);
  assert.ok(reset > 0, 'place() puts the window at the origin before measuring it');
  assert.ok(reset < place.indexOf('host.offsetWidth'), '…before the first measure');
});

test('§2 the zoom\'s text panel is one box: the text box inside it draws no frame of its own', () => {
  const panel = rules('#cardzoom > .zoompanel').join(';');
  assert.match(panel, /border:\s*1px solid/, 'the premise: the panel is the box');
  const inner = rules('#cardzoom > .zoompanel > .textbox').join(';');
  assert.match(inner, /border:\s*0/, 'no second border');
  assert.match(inner, /background:\s*none/, 'no second ground');
  assert.match(inner, /border-radius:\s*0/, 'no second rounded corner');
  // what the inner frame said, the panel says now
  assert.match(CSS, /#cardzoom > \.zoompanel:has\(> \.textbox\.modified\) \{ border-color: var\(--accent\); \}/);
});

test('§3 the action bar: palette grounds, one per state, and one height whatever it holds', () => {
  const base = rules('.promptbar').join(';');
  const ground = (r: string): string => /background:\s*([^;]+)/.exec(r)?.[1]?.trim() ?? '';
  const grounds = {
    yours: ground(base),
    pending: ground(rules('.promptbar.pending').join(';')),
    waiting: ground(rules('.promptbar.waiting').join(';')),
    playbar: ground(rules('.promptbar.playbar').join(';')),
  };
  for (const [state, g] of Object.entries(grounds)) {
    assert.match(g, /^var\(--color-/, `${state}: the bar's ground is a palette role, not a literal (was the old olive/gold/slate)`);
  }
  assert.equal(new Set(Object.values(grounds)).size, 4, 'each state has its own ground');
  assert.match(base, /border-top:\s*2px solid var\(--accent\)/, 'a lit top edge, so the bar stands off the table');

  // ONE height: the row is a fixed value, never the content's
  const bar = rules('#app.board.v2 .actionbar').join(';');
  assert.match(bar, /(?:^|;|\s)height:\s*var\(--actionbar-h\)/, 'the bar is the constant height');
  assert.match(bar, /max-height:\s*none/);
  assert.match(bar, /overflow:\s*visible/, 'not a scroller: a taller bar stands out of the slot');
  assert.match(bar, /justify-content:\s*flex-end/, '…upward, over the table, so nothing under it moves');
  assert.match(CSS, /#app\.board\.v2 \{ --actionbar-h: \d+px; \}/, 'the mouse height');
  assert.match(CSS, /html\.touch #app\.board\.v2 \{ --actionbar-h: \d+px; \}/, 'the touch height (36px buttons)');
  assert.match(CSS, /#app\.board\.v2 \.actionbar > \.promptbar:last-child \{ flex: 1 0 auto; align-content: center; \}/,
    'the last bar fills the slot, so its box never changes size either');
});

test('§4 the battle\'s empty halves carry no words: each is a marked shape, named for a reader', async () => {
  // in the source: no ghost slot is written with a word inside it
  const worded = [...MAIN.matchAll(/class="slot ghost[^"]*"[^>]*>([^<]*)</g)].map(m => m[1]!).filter(t => /[A-Za-z]/.test(t));
  assert.deepEqual(worded, [], 'a ghost slot with text in it');
  for (const kind of ['through', 'blockgone', 'atkgone', 'noatk']) {
    assert.match(CSS, new RegExp(`\\.slot\\.ghost\\.${kind}\\b`), `${kind} is drawn`);
  }
  // on the board: two attacking columns, one blocked and its blocker recalled
  const h = new Harness(106001);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = [spawn(h, A, 'The Foretold'), spawn(h, A, 'The Foretold')];
  const blocker = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: atk.map(id => [id]) });
  for (let guard = 0; guard < 40 && h.state.battle?.step !== 'blocks'; guard++) {
    const dec = h.state.decision;
    if (dec) h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
    else h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  withE(h, e => e.recall(e.s.entities[blocker]!));
  const ui = await client();
  for (const seat of [A, D]) {
    const html = ui.join(h.state, seat, legalActions(h.state, seat));
    const ghosts = [...html.matchAll(/<div class="slot ghost ([a-z]+)"([^>]*)>([^<]*)<\/div>/g)];
    const kinds = ghosts.map(g => g[1]);
    assert.ok(kinds.includes('blockgone') && kinds.includes('through'), `seat ${seat}: both markers are drawn (${kinds.join(', ')})`);
    for (const g of ghosts) {
      assert.equal(g[3]!.trim(), '', `seat ${seat}: the ${g[1]} slot says nothing on the table`);
      assert.match(g[2]!, /aria-label="[^"]+"[^>]*title="[^"]+"/, `seat ${seat}: the ${g[1]} slot is named for a reader and on hover`);
    }
    assert.doesNotMatch(html.replace(/<[^>]+>/g, ' '), /\b(?:unblocked|blocker gone)\b/, `seat ${seat}: neither faint word is on the table`);
  }
});
