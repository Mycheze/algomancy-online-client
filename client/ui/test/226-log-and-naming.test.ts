/* TWO PLACES THE CLIENT SAYS TOO MUCH AT ONCE.
 *
 *  [126] "In general, the game log is too detailed. It says things that almost
 *        seem more like the game is clarifying things to itself rather than
 *        being useful to the players."
 *  [125] "The Everywhere needs some work. 'Naming a card' can't just show a
 *        full list of all the cards in the game. Better is to show the current
 *        cards in play, but allow the player to search with a search box or
 *        use the lovely Scryfall like searching filters to search through all
 *        cards. And it needs to say somewhere on the unit what the last named
 *        card actually is."
 *
 * ── THE TRAP IN [126], WHICH IS WHY §1 IS SHAPED THE WAY IT IS
 *
 * Report [122], filed the day BEFORE, is the opposite complaint: the owner
 * tried to audit what Cosmic Reversal considered and the log would not tell
 * him. So "readable" is not "shorter", and a test that only counted lines
 * would happily accept the fix that trades one report for the other.
 *
 * Every assertion here is therefore about what SURVIVES:
 *   §1a nothing is deleted — the story view is a strict subset of the verbose
 *       one, and the verbose one is exactly what the log always printed;
 *   §1b the substantive lines of a REAL game survive the curtain, and the list
 *       of those is taken from the event stream rather than typed here;
 *   §1c the curtain fails OPEN — an unclassified line is never hidden, which
 *       is every line of the backlog a net client gets on join;
 *   §1d it is never silent about itself: what it folded away is counted on
 *       screen and one click from being back.
 *
 * ── AND [125] IS NOT A NARROWING
 *
 * The Everywhere's menu really is the whole pool, and correctly so — its best
 * line is naming a card that is not on the board yet. §2 asserts that every
 * option the engine offered is still takeable after the filter, which is the
 * same rule CT-34's split ticker and BL-18 already set.
 *
 * Seeds 22600-22699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { allCardNames, getCard } from '../../engine/src/cards/dsl.ts';
import { viewFor } from '../../server/view.ts';
import { client, closeLog, openLog } from './ui-driver.ts';
import { giveResources, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Decision, EngineEvent, GameState, Seat } from '../../engine/src/types.ts';

/** a battle position with a couple of units on it, and the seat looking at it */
function board(seed: number): { h: Harness; seat: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  spawn(h, A, 'Good Whale');
  spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 2);
  toNextBattle(h, A);
  return { h, seat: A };
}

/** a real game, played far enough to produce a log with every kind of line in
 * it, returned as the event stream the server would have pushed */
function realGameEvents(seed: number): EngineEvent[] {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (let i = 0; i < 20 && h.state.phase === 'battle'; i++) {
    const b = h.state.battle!, dec = h.state.decision;
    if (dec) {
      h.do({ type: 'decide', seat: dec.seat,
        choice: dec.kind === 'orderTriggers' ? dec.options.map((_o, j) => j) : 0 });
    } else if (b.step === 'declare') h.do({ type: 'declareAttack', seat: b.attacker, columns: [] });
    else if (b.step === 'blocks') h.do({ type: 'declareBlocks', seat: b.defender, blocks: {} });
    else h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  // and on into deployment, where units spawn and cards are played — the
  // battle alone is mostly plumbing, which would make §1b vacuous
  for (let i = 0; i < 6 && h.state.phase !== 'battle' && h.state.phase !== 'gameover'; i++) {
    const dec = h.state.decision;
    if (dec) { h.do({ type: 'decide', seat: dec.seat, choice: 0 }); continue; }
    if (h.state.phase === 'deploy') { h.do({ type: 'doneDeploying', seat: h.state.deployPlayer ?? A }); continue; }
    break;
  }
  assert.ok(h.events.length > 8, 'the fixture produced a log worth filtering');
  void D;
  return h.events;
}

/** the log lines the client has on screen, in order.
 *
 * CT-124/#131 moved the panel off the board and into a modal opened from the
 * bare-table right-click menu, so the caller has to have run `openLog` first.
 * The ANCHOR is unchanged and deliberately so: the panel is the same panel
 * (same `.logpanel`, same `#log`, same rows, same toggle, same curtain footer)
 * and this file is about what it SAYS, not about where it hangs. If it were
 * re-authored inside the overlay instead of moved, this would be the guard
 * that noticed. */
function logLines(html: string): string[] {
  const from = html.indexOf('<div class="logpanel"');
  assert.ok(from >= 0,
    'the log panel is on screen — CT-124: it is a modal now, so open it with openLog() first');
  // ⚠ BOUNDED AT THE PANEL'S OWN CLOSING TAG. This used to slice to the end of
  // the document and got away with it only because whatever followed the panel
  // in the rail happened to start with another `<div>`, which terminated the
  // last row's text match. In the modal the next thing is the Close button, and
  // "Close" was landing on the end of the final log line — the tail line, the
  // one every one of these tests reads. The walk is the same one
  // 146-report-guards uses: `<div>` in, `</div>` out, stop at depth 0.
  let i = from + 4, depth = 1, end = html.length;
  for (;;) {
    const open = html.indexOf('<div', i), close = html.indexOf('</div>', i);
    assert.ok(close >= 0, 'unbalanced markup around the log panel');
    if (open >= 0 && open < close) { depth++; i = open + 4; continue; }
    depth--; i = close + 6;
    if (depth === 0) { end = close; break; }
  }
  const chunk = html.slice(from, end);
  return [...chunk.matchAll(/<div class="([^"]*)">((?:(?!<div)[\s\S])*)/g)]
    .map(m => `${m[1]}|${m[2]!.replace(/<[^>]*>/g, '').trim()}`)
    // the curtain footer is chrome ABOUT the log, not a line OF it
    .filter(l => l.split('|')[1] && !l.startsWith('logcurtain'));
}

/** just the text of each line */
const textOf = (lines: string[]): string[] => lines.map(l => l.slice(l.indexOf('|') + 1));

/** R80 holds the tail of the log until its narrative beats have played, and
 * R150 paces authoritative updates — both on timers. Run them out, or a test
 * reads a log the client has not finished telling and calls the curtain guilty
 * of what the beat queue was doing.
 *
 * (R258 note: the skip chip no longer needs a repaint to appear — it is a live
 * slot, patched at the arrival. This helper is unaffected: it is draining the
 * two timed queues, not waiting for the chip.) */
function settle(ui: { tick(): void; html(): string; has(w: Record<string, string | number>): boolean;
  click(w: Record<string, string | number>): string }): string {
  for (let i = 0; i < 8; i++) {
    ui.tick();
    // the ⏭ chip: the player's own way out of the pacing, and the only one
    // that does not depend on wall-clock time passing inside a test
    if (ui.has({ btn: 'paceskip' })) ui.click({ btn: 'paceskip' });
  }
  return ui.html();
}

/* ══ §1 — [126] the game talking to itself ═══════════════════════════════ */

test('§1a nothing is deleted — the story view is a strict subset of everything', async () => {
  const { h, seat } = board(22601);
  const events = realGameEvents(22601);
  const ui = await client();
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  openLog(ui);   // CT-124/#131: the log is a modal now — this is the only way in
  ui.update(viewFor(h.state, seat), legalActions(h.state, seat), { events });
  const story = textOf(logLines(settle(ui)));
  const all = textOf(logLines(ui.click({ btn: 'logmode' })));

  assert.ok(all.length > story.length, 'the curtain is actually doing something');
  for (const line of story) {
    assert.ok(all.includes(line), `"${line}" is in the story view but not in the full one`);
  }
  // and back again: the toggle is a toggle
  assert.deepEqual(textOf(logLines(ui.click({ btn: 'logmode' }))), story);
  closeLog(ui);
});

test('§1b the substantive lines of a real game all survive the curtain', async () => {
  /* The list is taken from the EVENT STREAM, not typed: every line the engine
   * emitted for something entering play, leaving it, taking damage, or moving
   * a life total is a thing that happened, and a "readable" log that dropped
   * one would be report [122] all over again. */
  const { h, seat } = board(22602);
  const events = realGameEvents(22602);
  const NEWS = new Set(['spawned', 'died', 'despawned', 'erased', 'spellPlayed', 'damage',
    'lifeLost', 'lifeGained', 'trashed', 'cached', 'prophesied', 'triggered', 'turn']);
  const news = events.filter(e => e.msg && NEWS.has(e.type)).map(e => e.msg);
  assert.ok(news.length >= 3, `the fixture really produced news (${news.length} lines)`);

  const ui = await client();
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  openLog(ui);   // CT-124/#131: the log is a modal now — this is the only way in
  ui.update(viewFor(h.state, seat), legalActions(h.state, seat), { events });
  const story = textOf(logLines(settle(ui)));
  const all = textOf(logLines(ui.click({ btn: 'logmode' })));
  ui.click({ btn: 'logmode' });                       // back to the story view
  // only what the panel is showing at all: it draws a window on the last 80
  // lines, and that truncation is older than this curtain and not its doing
  const inWindow = news.filter(line => all.includes(line.trim()));
  assert.ok(inWindow.length >= 3, `news lines are on screen (${inWindow.length})`);
  for (const line of inWindow) {
    assert.ok(story.some(l => l === line.trim()),
      `the story view dropped a line that is NEWS: "${line}"`);
  }
  closeLog(ui);
});

test('§1c the curtain fails open — a line the client cannot classify is always shown', async () => {
  /* Every line of the backlog a net client receives on join (or after an undo)
   * arrives with no type at all: `applyUpdate` fills `logTypes` with undefined
   * on a full resync. A curtain that hid what it could not identify would hide
   * the most on exactly the screens that have been through the most. */
  const { h, seat } = board(22603);
  const ui = await client();
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  openLog(ui);   // CT-124/#131: the log is a modal now — this is the only way in
  // a full resync: log lines, no types — and one of them is worded exactly
  // like the plumbing the story view folds away
  ui.push({
    t: 'update', view: viewFor(h.state, seat), legal: legalActions(h.state, seat),
    log: ['Wraith: put a -1/-1 counter on an ally → stack.', 'After-combat step.'],
  });
  const shown = textOf(logLines(settle(ui)));
  assert.ok(shown.includes('Wraith: put a -1/-1 counter on an ally → stack.'),
    'an untyped line is shown even when its wording looks like plumbing');
  assert.ok(shown.includes('After-combat step.'));
  closeLog(ui);
});

test('§1d the curtain says how much it is holding, and lifts on one click', async () => {
  const { h, seat } = board(22604);
  const events = realGameEvents(22604);
  const ui = await client();
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  openLog(ui);   // CT-124/#131: the log is a modal now — this is the only way in
  ui.update(viewFor(h.state, seat), legalActions(h.state, seat), { events });
  const story = settle(ui);
  const storyLines = textOf(logLines(story));
  const m = /\+ (\d+) bookkeeping line/.exec(story);
  assert.ok(m, 'the panel says how many lines it folded away');
  const all = textOf(logLines(ui.click({ btn: 'logmode' })));
  // the number it claims is exactly the number missing — a curtain nobody can
  // measure is indistinguishable from a deletion
  assert.equal(Number(m![1]), all.length - storyLines.length,
    'the count on screen is the real difference between the two views');
  closeLog(ui);
});

/* ══ §2 — [125] naming a card ════════════════════════════════════════════ */
/* ⚠ CT-124: `logOpen` is module state in ui/main.ts, so it outlives the
 * `client()` each test builds. §1 closes the modal behind itself for that
 * reason — several tests below read the WHOLE board markup (§2e asserts the
 * word "named" appears nowhere at all) and a log left standing would be in
 * every one of those strings. */

/** the menu The Everywhere really builds: the whole nameable pool, plus the
 * release option. Taken from the card, not retyped — `batch-light-a.ts` filters
 * DECK_LIST the same way and this must move with it. */
function namingOptions(): { label: string; value: string; card?: string }[] {
  const pool = allCardNames().filter(n => {
    const c = getCard(n);
    if (/\bResource\b/.test(c.type)) return false;
    return !/Token/.test(c.type) && (c.kind === 'unit' || c.kind === 'spell' || c.kind === 'spellUnit');
  }).sort();
  return [
    ...pool.map(n => ({ label: n, value: n, card: n })),
    { label: 'name no card (release my last naming)', value: '' },
  ];
}

/** that menu, standing open in front of `seat` */
function namingState(seed: number): { s: GameState; seat: Seat; options: ReturnType<typeof namingOptions> } {
  const { h, seat } = board(seed);
  const options = namingOptions();
  const s = structuredClone(h.state);
  s.decision = {
    seat, kind: 'payOrDecline', prompt: 'The Everywhere: name a card', options, id: 4242,
  } as unknown as Decision;
  return { s, seat, options };
}

test('§2a a 400-option naming menu is not 400 card scans', async () => {
  const { s, seat, options } = namingState(22610);
  assert.ok(options.length > 300, `the real menu is enormous (${options.length} options)`);
  const ui = await client();
  const html = ui.join(viewFor(s, seat), seat, legalActions(s, seat));
  assert.match(html, /id="dec-search"/, 'there is a search box');
  const scans = html.match(/data-btn="decide"[^>]*>\s*<img/g)?.length ?? 0;
  assert.ok(scans <= 24, `a readable number of scans, not the whole pool (got ${scans})`);
});

test('§2b the default is what is standing on the board', async () => {
  const { s, seat } = namingState(22611);
  const onBoard = Object.values(s.entities)
    .filter(e => e.kind === 'unit' && !e.absent).map(e => e.card);
  assert.ok(onBoard.includes('Good Whale'), 'the fixture has a nameable unit in play');
  const ui = await client();
  const html = ui.join(viewFor(s, seat), seat, legalActions(s, seat));
  const before = html.indexOf('<details class="decall"');
  assert.ok(before > 0, 'the full list is behind an expander');
  const shopfront = html.slice(0, before);
  assert.match(shopfront, /Good Whale/, 'a card in play is offered up front');
  // …and a card that is NOT in play is not, or the default is not a default
  const absent = allCardNames().find(n => !onBoard.includes(n) && !shopfront.includes(n));
  assert.ok(absent, 'the up-front list really is narrower than the pool');
});

test('§2c every option the engine offered is still takeable', async () => {
  // BL-18: the filter is an affordance over the menu, never a narrowing of it.
  const { s, seat, options } = namingState(22612);
  const ui = await client();
  const html = ui.join(viewFor(s, seat), seat, legalActions(s, seat));
  const takeable = new Set([...html.matchAll(/data-btn="decide" data-i="(\d+)"/g)].map(m => Number(m[1])));
  assert.equal(takeable.size, options.length,
    'every index in the menu has something clickable behind it');
  // and the click really answers the question with that index
  ui.sent();
  ui.click({ btn: 'decide', i: options.length - 1 });   // "name no card"
  const out = ui.actions();
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { type: 'decide', seat, choice: options.length - 1 });
});

test('§2d the whole-pool toggle widens the shopfront without touching the menu', async () => {
  const { s, seat, options } = namingState(22613);
  const ui = await client();
  const narrow = ui.join(viewFor(s, seat), seat, legalActions(s, seat));
  const wide = ui.click({ btn: 'decsearchall' });
  const front = (html: string): number =>
    (html.slice(0, html.indexOf('<details class="decall"')).match(/data-btn="decide"/g)?.length ?? 0);
  assert.ok(front(wide) > front(narrow), 'more of the pool is on offer up front');
  const takeable = new Set([...wide.matchAll(/data-btn="decide" data-i="(\d+)"/g)].map(m => Number(m[1])));
  assert.equal(takeable.size, options.length, 'and the menu itself has not changed size');
});

test('§2e a unit that has named a card says which one', async () => {
  /* The second half of the report, and not polish: the card names a thing and
   * then goes on silencing every copy of it, and nothing on the board recorded
   * what it named. Derived from `Entity.named`, which IS the memory the static
   * matches on — no card is consulted. */
  const { h, seat } = board(22614);
  const id = spawn(h, seat, 'Good Whale');
  const ui = await client();
  const quiet = ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  assert.equal(/named/.test(quiet), false, 'a unit that has named nothing says nothing');

  const s = structuredClone(h.state);
  s.entities[id]!.named = 'Wraith';
  // the TOOLTIP, because `packBadgeLine` squeezes a long chip label to fit the
  // 74px strip — the chip says as much of the name as fits, the title says it all
  assert.match(ui.join(viewFor(s, seat), seat, legalActions(s, seat)),
    /its last named card is Wraith/, 'and one that HAS named says what');

  // "name no card" is a real answer — releasing a naming and never having made
  // one look identical otherwise
  const released = structuredClone(h.state);
  released.entities[id]!.named = '' as never;
  assert.match(ui.join(viewFor(released, seat), seat, legalActions(released, seat)),
    /its last naming was released/, 'a released naming is not the same as no naming');
});
