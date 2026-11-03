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
 *   §5  no toast on the board ("the weird toast icon that pops up for actions
 *       that can't happen for no targets or something ... It's really not
 *       needed at all and should probably just be removed entirely and replaced
 *       with something else"). What it said — a cost that did nothing, a dark
 *       hand card's reason, the line closing ranks, a stuck bot — is a line in
 *       the action bar, waiting for the player's next action or the next prompt.
 *
 * (The fifth, a colour-blind mode, is BL-51 in ledgers/backlog.ts: not built.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { give, giveResources, pass, spawn, toDeployment, toNextBattle, withE } from '../../engine/test/util.ts';
import { viewFor } from '../../server/view.ts';
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

test('§5 no game notice draws a toast: each is a line inside the action bar, and it waits for the player', async () => {
  // in the source: neither corner toast is left on the board
  const TOAST = read('toast.ts');
  assert.doesNotMatch(MAIN, /class="toast"|showToast\(|toastMsg/, 'main.ts draws no board toast');
  assert.doesNotMatch(MAIN + TOAST, /costtoast/, 'the cost toast strip is gone');
  assert.doesNotMatch(CSS, /\.costtoasts? \{/, '…and its stylesheet');
  // on the board: D holds priority in a battle with 2 fire open and an Arc
  // Lightning (4) in hand — the dark card a click explains
  const h = new Harness(106002);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[D]!.resources = [];
  giveResources(h, D, 'fire', 2);
  while (h.state.priority !== D) pass(h);
  const i = give(h, D, 'Arc Lightning');
  const ui = await client();
  const view = viewFor(h.state, D), legal = legalActions(h.state, D);
  ui.join(view, D, legal);
  ui.sent();
  const bar = (html: string): string => {
    const at = html.indexOf('<div class="actionbar">');
    return at < 0 ? '' : html.slice(at, html.indexOf('class="side toolbar"', at));
  };
  ui.pointer('pointerdown', { act: 'hand', p: D, i }, { pointerType: 'mouse', pointerId: 2, isPrimary: true });
  const clicked = ui.click({ act: 'hand', p: D, i });
  assert.match(bar(clicked), /class="barnotice"[\s\S]*?Needs 4 mana; you have 2\./, 'the reason is a line IN the action bar');
  assert.doesNotMatch(clicked, /class="toast"|costtoast/, 'and nothing toasts');
  // a cost that did nothing arrives the same way
  const withLoss = ui.update(view, legal, { events: [{ type: 'info', msg: 'Luminous Arc: it has no legal target — nothing happens.', data: {} }] });
  assert.match(bar(ui.key('s') || withLoss), /class="barnotice"/, 'a cost notice is on the line too');
  // it waits: every timer run out, and a repaint under the same question, keep it…
  ui.tick();
  assert.match(bar(ui.update(view, legal)), /class="barnotice"/, 'no clock takes it away');
  // …and the player's next action puts it away
  ui.click({ btn: 'pass' });
  assert.ok(ui.actions().length > 0, 'the pass was sent');
  assert.doesNotMatch(bar(ui.update(view, legal)), /class="barnotice"/, 'gone with the player\'s next action');
});

test('§6 superfluous popup text stays gone, and the stack wears no "N deep" tag', () => {
  // owner 2026-11-03: "All the extra weirdly AI generated, superfluous text was
  // supposed to have been gotten rid of forever ago." — and "Same with the
  // little '4 deep' tag on the stack. Get rid of it please."
  for (const [gone, what] of [
    [/the mark\. When anything reaches the mark|Nobody may look at either/, 'the paragraph under the player summary'],
    [/server keeps the time/, 'the clocks\' footnote'],
    [/is cast on its own\./, 'the token corner\'s line for a non-burst token'],
    [/bring it to 0 to win/, 'the life total\'s tooltip'],
    [/title="hand: \$\{/, 'the mini hand\'s tooltip restating its count'],
    [/left the stack and will do nothing/, 'the stack viewer\'s gloss on "fizzled"'],
    [/\} deep ↢|class="stackdepth"/, 'the stack\'s "N deep" tag'],
  ] as const) assert.doesNotMatch(MAIN, gone, `${what} is back`);
  assert.doesNotMatch(CSS, /\.stackdepth\b/, 'and its stylesheet');
});

test('§7 a live count wears an X only where the card prints one, and the zoom never explains the card', async () => {
  const { allCardNames, getCard } = await import('../../engine/src/cards/dsl.ts');
  const { COUNT_TERMS, liveChip, liveLines, printsX } = await import('../livecount.ts');
  const LIVE = read('livecount.ts');
  // derived, not listed: every card with a live-count hook and no printed X
  // has its own terms in COUNT_TERMS, and nothing else is in there
  const hooked = allCardNames().filter(n => { const c = getCard(n) as unknown as Record<string, unknown>;
    return c['xPreview'] !== undefined || c['xPreviewRows'] !== undefined; });
  const counting = hooked.filter(n => !printsX(n)).sort();
  assert.ok(counting.includes('Mischievous Reclaimer') && hooked.some(n => printsX(n)), 'the premise: both kinds exist');
  assert.deepEqual(Object.keys(COUNT_TERMS).sort(), counting, 'COUNT_TERMS is exactly the hooked cards that print no X');
  const row = (x: number, label = 'a long sentence explaining how the card works') => ({ label, x });
  for (const n of counting) {
    for (const x of [0, 1, 3]) {
      const chip = liveChip(n, [row(x), row(x)]);
      assert.ok(chip === null || !/X/.test(chip), `${n}: no X on a card that prints none (${chip})`);
      for (const l of liveLines(n, [row(x), row(x)])) assert.equal(l, chip, `${n}: the zoom says at most the chip's count`);
    }
  }
  // the owner's card, and a real X card
  assert.equal(liveChip('Mischievous Reclaimer', [row(1)]), '1/2', '"the second ally dies": one of two');
  assert.equal(liveChip('Mischievous Reclaimer', [row(3)]), '2/2', 'it has fired; it does not count past its threshold');
  assert.equal(liveChip('Soul Siphon', [row(7)]), 'X=7', 'a card that prints X says X — and no "now"');
  assert.deepEqual(liveLines('Retribution Thing', [row(7, 'lost'), row(0, 'gained')]), ['X = 7 (lost)', 'X = 0 (gained)'],
    'a label survives only where it NAMES a row of several');
  assert.deepEqual(liveLines('Life Channel', [row(5, 'you (this spell\'s own +3 included)')]), ['X = 5'], 'never a sentence about the card');
  // and the board's renderers go through it
  assert.doesNotMatch(MAIN, /X=\$\{[^}]*\} now|right now\$\{|X right now/, 'no "now" padding on the live X');
  assert.match(LIVE, /export function liveChip/);
});
