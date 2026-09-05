/* CT-124 / report #131 — THE GAME LOG IS A MODAL, AND IT IS THE SAME LOG.
 *
 *   "I've decided that the game log would be better to hide by default.
 *    Instead of always being on screen, it should be accessible by the
 *    'generic' right click menu. 'View game log' will bring up a modal (which
 *    is easier to read anyway) that functions just the same as the current
 *    log."   — room PUCG, actionIndex 123
 *
 * ⚠ A MOVE, NOT A CUT, AND THAT IS THE WHOLE RISK. Report #125 had just landed
 * a story/everything curtain INSIDE the panel's heading, and the panel carried
 * four other interactive things besides. A "hide the log" that re-authored a
 * few rows inside an overlay would satisfy every word of the report and
 * silently drop:
 *
 *   · the story/everything toggle (#125, ratified in questions-round31 Q3),
 *   · the "+ n bookkeeping lines hidden" footer that lifts it,
 *   · the typed row classes that colour damage, life, rot and prophecy,
 *   · and the `data-prev` card spans — which are ONE attribute feeding THREE
 *     affordances (hover preview, long-hover text box, right-click inspect),
 *     so losing them is three regressions wearing one hat.
 *
 * So §3 does not check a list. It ENUMERATES what the modal emits and asserts
 * every one of those things is live, with the fixture's own richness as the
 * positive control — a sweep whose subject set is empty passes forever and
 * looks exactly like one that works.
 *
 * ⚠ AND THE WHOLE FILE IS THE RED-CHECK ON A LATENT CRASH. `restoreViewport`
 * did `document.getElementById('log')!` unguarded on every paint; it never
 * threw only because the panel was unconditionally on the board, and
 * `test/ui-driver.ts` could not have caught it because `'log'` was missing
 * from its ABSENT list, so the stub handed back an object for it. Both halves
 * are fixed, and the pair was MEASURED — three runs of this file:
 *
 *   guard + 'log' on ABSENT ............................ 7 pass
 *   `!` restored, 'log' on ABSENT ...................... 0 pass, 7 fail
 *   `!` restored, 'log' OFF ABSENT ..................... 7 pass  ← the old lie
 *
 * The third row is the whole point of the ABSENT entry: without it the suite
 * is green over code that throws in a real browser, and no assertion anywhere
 * can tell the difference.
 *
 * Seeds 23200-23299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { boardMenuEntries } from '../../ui/inspect.ts';
import { client, closeLog, elementFor, openLog } from '../../ui/test/ui-driver.ts';
import { spawn, toDeployment, toNextBattle } from './util.ts';
import type { Action, EngineEvent, GameState, Seat } from '../src/types.ts';

const CSS = readFileSync(new URL('../../ui/style.css', import.meta.url), 'utf8');

/** a real game, played far enough that its log has plumbing to fold, card
 * names to link and typed events to colour — the three things §3 sweeps. If
 * this stops producing them the positive controls in §3 say so out loud. */
function played(seed: number): { h: Harness; seat: Seat; events: EngineEvent[] } {
  const h = new Harness(seed, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const att = spawn(h, A, 'Ignis Sprite');
  const blk = spawn(h, D, 'Ignis Sprite');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[att]] });
  for (let g = 0; g < 12 && h.state.battle?.step !== 'blocks'; g++) {
    if (h.state.decision) { const d = h.state.decision; h.do({ type: 'decide', seat: d.seat, choice: 0 }); continue; }
    h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  const events: EngineEvent[] = [];
  for (let g = 0; g < 16 && !events.some(e => e.type === 'afterCombat'); g++) {
    if (h.state.decision) { const d = h.state.decision; h.do({ type: 'decide', seat: d.seat, choice: 0 }); continue; }
    events.push(...h.do({ type: 'passPriority', seat: h.state.priority! }));
  }
  return { h, seat: A, events };
}

/** the client, joined to that game and shown its whole log */
async function shown(seed: number): Promise<Awaited<ReturnType<typeof client>>> {
  const { h, seat, events } = played(seed);
  const ui = await client();
  const legal = legalActions(h.state, seat) as Action[];
  ui.join(viewFor(h.state, seat), seat, legal);
  ui.update(viewFor(h.state, seat), legal, { events });
  // R80 paces the tail and R150 throttles updates; run both out or the modal
  // is read half-told and the sweep below measures the beat queue instead
  for (let i = 0; i < 8; i++) { ui.tick(); if (ui.has({ btn: 'paceskip' })) ui.click({ btn: 'paceskip' }); }
  return ui;
}

/** the substring of `html` from the opening tag at `from` to its own matching
 * close — the same `<div>` walk 146-report-guards uses on this panel */
function subtree(html: string, from: number): string {
  let i = from + 4, depth = 1;
  for (;;) {
    const open = html.indexOf('<div', i), close = html.indexOf('</div>', i);
    assert.ok(close >= 0, 'unbalanced markup');
    if (open >= 0 && open < close) { depth++; i = open + 4; continue; }
    depth--; i = close + 6;
    if (depth === 0) return html.slice(from, close);
  }
}

/** the whole log MODAL — the dialog box, not just the panel: the Close button
 * is part of what the modal has to offer and belongs in the sweep. */
function modalOf(html: string): string {
  const at = html.indexOf('<div class="overlaybox logbox">');
  assert.ok(at >= 0, 'the log modal is not open');
  return subtree(html, at);
}

/**
 * Every affordance the markup carries, DERIVED — `data-*` attribute name to
 * the set of values under it.
 *
 * `data-*` is not an arbitrary choice of key: it is the only thing ui/main.ts
 * hangs behaviour on. Its click delegator asks `closest('[data-btn]')` and
 * `closest('[data-act]')`; the focus viewer, the hover tip and the context
 * menu all ask `closest('[data-prev], [data-previd], [data-prevstack]')`. So
 * "what can be done in here" and "what data-attributes are in here" are the
 * same question, and this answers it by reading rather than by listing.
 */
function affordances(html: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of html.matchAll(/\sdata-([a-z]+)="([^"]*)"/g)) {
    const key = m[1]!;
    if (!out.has(key)) out.set(key, new Set());
    out.get(key)!.add(m[2]!);
  }
  return out;
}

/** every class token in the markup */
function classes(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/\sclass="([^"]*)"/g)) {
    for (const c of m[1]!.split(/\s+/)) if (c) out.add(c);
  }
  return out;
}

/* ── §1 the log is off the board ────────────────────────────────────────── */

test('§1 the board no longer carries the log, and the rail is still a rail', async () => {
  const ui = await shown(23200);
  const board = ui.html();
  assert.equal(board.includes('class="logpanel"'), false,
    'report #131: the log is hidden by default, not always on screen');
  assert.equal(board.includes('<h3>Game log'), false, 'heading and all');

  // POSITIVE CONTROL: "no log on the board" must mean the log moved, not that
  // the board failed to paint. The rail and its chrome are exactly what the
  // panel used to sit among, so they are what has to still be there.
  assert.ok(board.includes('<div class="side">'), 'the side rail is still drawn');
  assert.ok(board.includes('id="preview"'), 'and the focus viewer it shared the rail with');
  assert.ok(board.includes('data-btn="helpopen"'), 'and the rail chrome around it');
});

/* ── §2 the way in ──────────────────────────────────────────────────────── */

test('§2 the generic right-click menu opens it, and the menu decides that', async () => {
  const { h, seat } = played(23201);
  const ui = await client();
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat) as Action[]);

  // R241: WHERE the entry is declared is the point. `boardMenuEntries` is the
  // one place the table menu is decided, and 216-menu-scoping asserts the
  // card-back menu equals it exactly — an entry wired only into main.ts's
  // contextmenu handler would be a silent divergence between the two ways into
  // the same menu. So the claim is about inspect.ts, not about a label.
  const entries = boardMenuEntries(h.state as GameState, seat);
  const log = entries.filter(e => e.kind === 'log');
  assert.equal(log.length, 1, 'exactly one entry opens the log');
  assert.equal(log[0]!.confirm, false, 'reading the log asks nothing before it happens');

  const menu = ui.rightClick({ act: 'player', p: seat });
  assert.ok(menu.includes(log[0]!.label.slice(2)),
    `the bare-table menu really shows it: "${log[0]!.label}"`);
  assert.equal(menu.includes('class="logpanel"'), false, 'and the menu is not itself the log');

  const open = openLog(ui);
  assert.ok(open.includes('class="overlaybox logbox"'), 'clicking it raises a modal');
  assert.ok(open.includes('<h3>Game log'), 'with the log in it');
  closeLog(ui);
});

test('§2b Escape and Close both put it away', async () => {
  const ui = await shown(23202);
  assert.ok(openLog(ui).includes('overlaybox logbox'));
  assert.equal(ui.click({ btn: 'logclose' }).includes('overlaybox logbox'), false,
    'the Close button closes it');
  // and the Escape ladder knows about it — main.ts is the only place that
  // ladder exists, and a modal missing from it is a modal you cannot dismiss
  // with the key every other dialog answers to
  const MAIN = readFileSync(new URL('../../ui/main.ts', import.meta.url), 'utf8');
  // since 2026-09-05 the dialog rungs live in closeTopOverlay(), which the
  // Escape branch calls as one rung (a click on a dialog's scrim takes the
  // same ladder) — so the rung is looked for there, and the call is looked
  // for in the branch
  const esc = MAIN.slice(MAIN.indexOf("if (e.key === 'Escape')"));
  assert.match(esc.slice(0, esc.indexOf('return;\n  }')), /closeTopOverlay\(\)/,
    'the Escape branch no longer walks the shared dialog ladder');
  const ladder = MAIN.slice(MAIN.indexOf('function closeTopOverlay(): boolean {'));
  assert.match(ladder.slice(0, ladder.indexOf('\n}')), /if \(logOpen\) \{ logOpen = false; return true;/,
    'Escape closes the log modal like every other overlay');
  assert.match(MAIN, /const overlayUp = [^;]*logOpen/,
    'and an open log counts as an overlay — otherwise S and Space still fire game '
    + 'actions at a board you are reading a log over');
});

/* ── §3 THE SWEEP: everything the panel carried is live in the modal ────── */

test('§3 every affordance the modal emits is a live one', async () => {
  const ui = await shown(23203);
  const html = openLog(ui);
  const modal = modalOf(html);
  const acts = affordances(modal);
  const cls = classes(modal);

  /* POSITIVE CONTROLS — the fixture really produced the things being swept.
   * Each of these is the vacuity guard for one branch below: with no card
   * names there is no data-prev to check, with no curtained lines there is no
   * footer, with no typed events there are no row classes to paint. */
  assert.ok((acts.get('prev')?.size ?? 0) >= 2,
    `the log names at least two cards (${[...acts.get('prev') ?? []].join(', ')})`);
  assert.ok((acts.get('btn')?.size ?? 0) >= 2,
    `the modal has at least two buttons (${[...acts.get('btn') ?? []].join(', ')})`);
  assert.ok([...cls].some(c => c.startsWith('ev-')),
    `the log has typed rows to colour (${[...cls].join(' ')})`);
  assert.ok(cls.has('logcurtain'), 'and the story curtain is holding something, so it has a footer');

  /* THE CLAIM, swept rather than listed: every button in there does
   * something, and every card span in there is what the context menu's own
   * selector looks for. Nothing below names an affordance — the names come
   * out of the markup. */
  for (const btn of acts.get('btn') ?? []) {
    openLog(ui);                                  // each one gets a fresh open modal
    const before = ui.html();
    const after = ui.click({ btn });
    assert.notEqual(after, before, `data-btn="${btn}" inside the log modal is inert`);
  }
  // …and put the reading preference back: `logmode` writes to localStorage,
  // which the driver keeps for the whole file, and §4 is about the DEFAULT
  const again = openLog(ui);
  if (!again.includes('▸ story')) ui.click({ btn: 'logmode' });
  const open = ui.html();
  const panel = subtree(open, open.indexOf('<div class="logpanel"'));
  for (const name of affordances(panel).get('prev') ?? []) {
    const at = panel.indexOf(`data-prev="${name}"`);
    const el = elementFor(panel, { prev: name });
    assert.ok(at >= 0);
    // the contextmenu handler's own test, run on the real modal markup: a log
    // card span has to BE the thing `closest()` finds, or right-click-inspect,
    // the hover preview and the long-hover box all stop at the same instant
    const closest = el['closest'] as (sel: string) => unknown;
    assert.equal(closest('[data-prev], [data-previd]'), el,
      `the log's span for "${name}" is not what the context menu would find`);
  }
  closeLog(ui);
});

test('§3b a card named only in the log is still right-clickable from inside the modal', async () => {
  /* The end-to-end half of §3. Built so the name exists NOWHERE else on
   * screen: the unit is gone from the view by the time the log talks about it,
   * so the only `data-prev` carrying it is the one in the modal — and the menu
   * that comes back therefore came back from the log. */
  const h = new Harness(23204, ['Ben', 'Rashi']);
  toDeployment(h);
  const seat = h.state.initiative;
  const id = spawn(h, seat, 'Good Whale');
  const ui = await client();
  const legal = legalActions(h.state, seat) as Action[];
  ui.join(viewFor(h.state, seat), seat, legal);          // the client has now SEEN it

  const gone = structuredClone(h.state) as GameState;
  delete gone.entities[id];
  ui.push({ t: 'update', view: viewFor(gone, seat), legal, log: ['Good Whale is erased.'] });
  const html = openLog(ui);
  assert.equal((html.match(/data-prev="Good Whale"/g) ?? []).length, 1,
    'the card is named in exactly one place on screen — the log');

  const menu = ui.rightClick({ prev: 'Good Whale' });
  const labels = [...menu.matchAll(/data-btn="menuitem" data-i="\d+">([\s\S]*?)<\/button>/g)]
    .map(m => m[1]!.replace(/<[^>]*>/g, '').trim());
  assert.ok(labels.some(l => /Good Whale — details/.test(l)),
    `right-clicking a card name in the log opens its inspector entry (got: ${labels.join(' | ')})`);
  closeLog(ui);
});

/* ── §4 the #125 curtain came with it ───────────────────────────────────── */

test('§4 the story toggle and its footer moved into the modal, both working', async () => {
  const ui = await shown(23205);
  const story = openLog(ui);
  // rows of LOG, not divs: the curtain footer is chrome ABOUT the log and is
  // only present in the story view, so counting it would make the two views
  // differ by one for a reason that is not the curtain
  const rows = (html: string): number =>
    (subtree(html, html.indexOf('<div class="logpanel"'))
      .match(/<div class="(?!logcurtain)/g) ?? []).length;

  assert.ok(story.includes('data-btn="logmode"'), 'the toggle is inside the modal');
  assert.match(story, /▸ story/, 'and story is still the default view');
  const m = /\+ (\d+) bookkeeping line/.exec(story);
  assert.ok(m, 'the curtain footer says how much it is holding');

  const all = ui.click({ btn: 'logmode' });
  assert.match(all, /▾ everything/, 'the toggle flips');
  assert.ok(all.includes('class="overlaybox logbox"'),
    'and it flips IN the modal — the toggle must not send the panel back to the board');
  assert.equal(rows(all) - rows(story), Number(m![1]),
    'the number the footer claimed is exactly the number the toggle reveals — the same '
    + 'measurement 226-log-and-naming makes, now made through the modal');
  ui.click({ btn: 'logmode' });
  closeLog(ui);
});

/* ── §5 what the rail does with the space, and what still paints it ─────── */

test('§5 the rail did not become dead space, and the modal is still painted', async () => {
  /* `#app.board .side` is `overflow: hidden` on purpose, so every child has to
   * manage its own height and exactly one of them has to absorb the slack. The
   * log used to be that child. Removing it without handing the job on is the
   * dead-space regression the R219 note in style.css records as already fixed
   * once — and no markup assertion can see it. */
  const board = CSS.slice(CSS.indexOf('#app.board {'));
  const fillers = [...board.matchAll(/^#app\.board (\.[a-z]+) \{[^}]*flex: 1 1 0/gm)].map(x => x[1]);
  assert.deepEqual(fillers, ['.preview'],
    'exactly one child of the board rail absorbs its slack, and with the log gone it is the '
    + 'focus viewer');

  // every class the modal emits still has a rule somewhere — DERIVED from the
  // markup, so a row class that survives the move but loses its colour is
  // caught here rather than by looking at the screen
  const ui = await shown(23206);
  const modal = modalOf(openLog(ui));
  const painted = [...classes(modal)].filter(c => c !== 'liveslot');
  assert.ok(painted.length >= 6, `the modal really wears classes (${painted.join(' ')})`);
  for (const c of painted) {
    assert.ok(CSS.includes(`.${c}`), `nothing in style.css paints .${c}`);
  }
  closeLog(ui);
});
