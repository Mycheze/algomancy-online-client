/* R173 — guards that can actually reach the code path their report is about.
 *
 * WHY THIS FILE EXISTS
 *
 * `test/playtest-ledger.ts` holds the owner's own bug reports, and a `fixed`
 * entry has to name the tests that hold it down. `83-card-todo.test.ts` checks
 * those names EXIST. It cannot check that the named test could ever have
 * FAILED on the behaviour in the report, and an audit of all 295 guard
 * references found the same shape four times over:
 *
 *     a guard that unit-tests the LAST HOP with a hand-built input,
 *     for a report about the WHOLE CHAIN.
 *
 * `stackItemX(xItem({ event: dmgEvent(2) }))` proves the reader reads an event
 * that is already attached. The player's complaint was that nothing reached
 * them attached to anything. The SEAM between the two — the item the engine
 * really pushes, served through the view the responder really holds — was
 * asserted nowhere, and it is exactly where the reported symptom lives.
 *
 * Measured, not supposed. Each of the four was red-checked by mutating the
 * code its report is about and watching the CITED guards stay green:
 *
 *   #45/#43  a redaction of `x` / `event` from the public stack in
 *            server/view.ts — the responder's screen goes blank again while
 *            all 99 tests of 50-ui-inspect, all 37 of 56-ui-flash and the
 *            Awoken Tomb effect tests stay green.
 *   #18      `if (NET && !s.decision && !NET.legal.length)` disabled in
 *            ui/main.ts::promptHtml — the live Pass button comes back; both
 *            cited guards, and every other driver test, stay green.
 *   #53      `absorbBeats(events)` in the update path cut to `absorbBeats([])`
 *            — the whole damage step lands in one frame; all 37 combatStages
 *            tests stay green.
 *
 * So each test here drives the REAL producer: a real Harness read through
 * `viewFor` for the two X-on-the-stack reports, and the real ui/main.ts
 * (through test/ui-driver.ts) for the two presentation reports, whose fixes
 * live in markup that no pure-function test can see.
 *
 * Reports guarded here: #45, #43, #18, #53. Seeds 5920-5949.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { stackItemX, stackXMark } from '../../ui/inspect.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';
import { combatStages } from '../../ui/flash.ts';
import { client, closeLog, openLog } from '../../ui/test/ui-driver.ts';
import type { Action, EngineEvent, Seat } from '../src/types.ts';

/** the real client, driven — see test/ui-driver.ts */
const ui = await client();

/* ── #45 / #43: the X of a thing that is ON THE STACK ────────────────────
 *
 * VEAV: "Awoken Tomb's trigger, while on the stack, doesn't say what X is
 * equal to."  UZRG: "It's not possible to see the X value for an effect while
 * it's on the stack."
 *
 * One fixture answers both, because one action produces both: Channel Through
 * is cast for X (the mana X, `item.x`), it sits on the stack while the window
 * is open, and when it resolves it deals damage that fires the Tomb — whose
 * trigger then sits on the stack in its turn, carrying the event it fired on.
 *
 * The existing guards for both reports read `stackItemX` / `stackXMark` off
 * StackItems a helper built by hand. Those are the right tests for the reader
 * and the wrong ones for the report: they never ask whether an item the ENGINE
 * put on the stack carries the fields the reader needs.
 */

/** A cast for X, resolved into a damage trigger. Returns the harness parked
 * with the Tomb's trigger on the stack. */
function tombFixture(seed: number): { h: Harness; A: Seat; D: Seat; tomb: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const ally = spawn(h, D, 'Good Whale');
  const tomb = spawn(h, A, 'Awoken Tomb');   // 0/5: "create an X/X unit, X = the damage I am dealt"
  giveResources(h, D, 'earth', 2);
  giveResources(h, D, 'fire', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tomb]] });
  pass(h);                                   // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Channel Through') });
  pick(h, 1);                                // R35: X = 1, chosen and paid at cast
  pick(h, { player: A });                    // R83: slot 0, the opponent
  pick(h, { unit: ally });                   // the cast-time ally target
  return { h, A, D, tomb };
}

test('#43 a cast X reaches the REAL stack wearing its number', () => {
  const { h, A } = tombFixture(5921);
  // …and read out of the RESPONDER'S view, not the raw state. The player the
  // report is about is the one deciding whether to answer this; what they hold
  // is `viewFor`, and a field the server redacted on the way out would leave
  // every engine-side assertion green and the screen just as blank as before.
  const item = viewFor(h.state, A).stack.find(i => i.card === 'Channel Through');
  assert.ok(item, 'the spell is on the stack, with a window open over it — this is exactly the '
    + 'moment the report is about: the responder is deciding whether to answer it');
  assert.equal(item.x, 1, 'the engine wrote the chosen X onto the stack item…');
  assert.deepEqual(stackItemX(item).map(r => [r.kind, r.x]), [['cast', 1]],
    '…so the reader has something to read');
  assert.equal(stackXMark(item), 'X=1', 'and the card on the stack wears the tag');
});

test("#45 Awoken Tomb's trigger says what X is while it is ON the stack", () => {
  const { h, D } = tombFixture(5922);
  pass(h); pass(h);                          // Channel Through resolves → 2 to the Tomb

  // again the responder's view: D is the one who has to decide whether to
  // answer the trigger, and it is D's screen the report was written from
  const item = viewFor(h.state, D).stack.find(i => i.card === 'Awoken Tomb');
  assert.ok(item, 'the trigger is on the stack, where the report says it says nothing');
  assert.equal(item.kind, 'triggered');

  // THE FIELD THE BADGE RESTS ON. `E.queueTrigger` writes `event: ev`, and
  // `stackPendingTrigger` carries it onto the StackItem. Deleting it outright
  // does redden the Awoken Tomb EFFECT tests — `EffectCtx.event` is read off
  // the same field — but nothing anywhere asserted that the item a RESPONDER
  // is shown still has it. A refactor that fed the effect from the pending
  // trigger and dropped the field from the item would be green everywhere.
  assert.ok(item.event, 'the queued trigger carries the event that fired it');
  assert.equal(item.event.data?.['n'], 2, 'and the amount it carried');

  const rows = stackItemX(item);
  assert.equal(rows.length, 1, 'one X, off the event');
  assert.equal(rows[0]!.kind, 'event');
  assert.equal(rows[0]!.x, 2, 'X is the damage the Tomb itself took');
  assert.match(rows[0]!.from ?? '', /deals 2 to Awoken Tomb/, 'and it says where the number came from');
  assert.equal(stackXMark(item), 'X=2', 'so the card on the stack wears it');
});

/* ── #18: "it asks me to pass but I can't" ───────────────────────────────
 *
 * BRDM: "When a decision is pending for the other player, I get the window for
 * priority and it asks me to pass but I can't, since it's not actually my
 * priority."
 *
 * The fix is one branch in ui/main.ts::promptHtml, and the report is about
 * markup: a Pass button that was drawn and could not be used. The cited guards
 * assert `legalActions(state, D)` is `[]` (a rules fact, true before the fix
 * as well) and the WORDING of `waitingNote` (a string the branch happens to
 * call). Neither of them ever paints a bar. Deleting the branch restores the
 * button and leaves both green.
 *
 * WHAT THE CLIENT ACTUALLY HOLDS. `server/view.ts` nulls a decision that is
 * not yours, so the view says only "it is the battle phase and priority is
 * yours" — which is TRUE and is why the priority bar was drawn. The one thing
 * that says otherwise is the EMPTY legal list the server published, and the
 * fix is the client believing it. So the two halves are asserted together:
 * the state is a genuine priority window for this seat (the control below
 * really does draw the button), and the same window with the list the server
 * publishes while the opponent is being asked draws no button at all.
 *
 * The empty list is not invented: `s.decision && decisionBlocks(s, seat)`
 * empties `legalActions` for the seat that is NOT being asked, and the second
 * fixture here holds that fact next to the markup it produces.
 */

/** a real battle priority window, and the seat holding it */
function priorityWindow(seed: number): { h: Harness; seat: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (let g = 0; g < 40 && h.state.priority === null; g++) {
    const dec = h.state.decision;
    if (!dec) break;
    h.do({ type: 'decide', seat: dec.seat, choice: 0 });
  }
  assert.notEqual(h.state.priority, null, 'the fixture really opened a priority window');
  return { h, seat: h.state.priority! };
}

test('#18 a seat with nothing legal is never handed a Pass button', () => {
  const { h, seat } = priorityWindow(5930);
  const view = viewFor(h.state, seat);
  assert.equal(view.decision, null, 'nothing is being asked of this seat…');
  assert.equal(view.priority, seat, '…and the view says the window is theirs, which is why the '
    + 'client drew the priority bar in the first place');

  // the control FIRST, or "no Pass button" would be satisfied by a board that
  // never draws one at all
  const mine = legalActions(h.state, seat);
  assert.ok(mine.some(a => a.type === 'passPriority'), 'passing it is legal');
  ui.join(view, seat, mine);
  assert.ok(ui.has({ btn: 'pass' }), 'an ordinary window offers the button');

  // …and now the report: the SAME view, with the legal list the server
  // publishes while the opponent is being asked something.
  const html = ui.join(view, seat, []);
  assert.ok(!ui.has({ btn: 'pass' }),
    'the board offered a Pass button for a window the server publishes no actions for. That is '
    + 'the report exactly: the client fell through to the ordinary priority bar and drew a '
    + 'control that comes back "you do not have priority"');
  assert.match(html, /Waiting for /, 'it says who is being waited on instead');
});

test('#18 …and that empty list is what the server really publishes', () => {
  // the other half of the report, held next to the markup above: the seat that
  // is NOT being asked is the one with nothing legal, so the bar the client
  // draws off an empty list is drawn in the situation the player described.
  const h = new Harness(5931);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  spawn(h, D, 'Good Whale');
  giveResources(h, A, 'water', 12);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Leaping Lillik') });
  assert.equal(h.state.decision?.seat, A, 'A owes a target decision');
  assert.equal(viewFor(h.state, D).decision, null,
    'the server redacts it — D cannot see whose question it is, or even that there is one');
  assert.deepEqual(legalActions(h.state, D), [],
    'and D is published nothing at all: the empty list IS the whole signal');
});

/* ── #53: "damage and all effects happened instantly" ────────────────────
 *
 * UFAB: "Neither of us had anything to do during the end of that combat, but
 * damage and all effects happened instantly. We should have been able to see
 * it much slower."
 *
 * `combatStages` does the arithmetic and is well tested — on hand-written
 * event arrays. What the report is about is whether the client FEEDS it: R80's
 * fix is `absorbBeats(events)` in the update path plus `heldLines` drawing
 * fewer log lines. Cut either and every `combatStages` test stays green while
 * the whole batch lands in one frame again, which is the reported symptom
 * exactly.
 *
 * The board is deliberately NOT staged (docs/11: a beat explains, it never
 * gates). The LOG is. So the observable is the log: right after the batch, its
 * tail has not been told yet.
 */

/** the log rows currently drawn, as text */
function logRows(html: string): string[] {
  // ⚠ the anchor is the HEADING, not the whole tag. It used to be the literal
  // `<h3>Game log</h3>`, and the day the panel grew a story/everything toggle
  // INSIDE that heading, this stopped matching and both #53 guards failed on
  // "the board has no log panel at all" — a test about PACING reporting a
  // missing panel. The `</h3>` carried no meaning here; the depth walk below
  // counts `<div>` and a heading has none.
  //
  // ⚠ AND IT BROKE A SECOND TIME, for the second time for a reason that has
  // nothing to do with #53: CT-124/#131 moved the panel off the board into a
  // modal. WHAT IS MEASURED HERE IS UNCHANGED and the anchor with it — the
  // depth walk still starts inside `<div class="logpanel">`, which is still
  // the h3's own parent, because the panel MOVED rather than being rebuilt.
  // The only new requirement is on the caller: open the modal first. The
  // message says so, so the next person does not re-learn it from a stack
  // trace about pacing.
  const at = html.indexOf('<h3>Game log');
  assert.ok(at >= 0,
    'the board has no log panel at all — CT-124: the log is a modal now, so a test that reads '
    + 'it has to openLog() first');
  let i = at, depth = 1, end = -1;   // depth 1: we are inside <div class="logpanel">
  for (;;) {
    const open = html.indexOf('<div', i), close = html.indexOf('</div>', i);
    assert.ok(close >= 0, 'unbalanced markup around the log panel');
    if (open >= 0 && open < close) { depth++; i = open + 4; continue; }
    depth--; i = close + 6;
    if (depth === 0) { end = close; break; }
  }
  return [...html.slice(at, end).matchAll(/<div class="[^"]*">([\s\S]*?)<\/div>/g)]
    .map(m => m[1]!.replace(/<[^>]*>/g, ''));
}

/** a real end-of-combat: two 1/1s trade, both die, both death triggers run */
function combatBatch(seed: number): { h: Harness; D: Seat; events: EngineEvent[] } {
  const h = new Harness(seed);
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
  let events: EngineEvent[] = [];
  for (let g = 0; g < 12 && !events.some(e => e.type === 'combatDamage'); g++) {
    if (h.state.decision) { const d = h.state.decision; h.do({ type: 'decide', seat: d.seat, choice: 0 }); continue; }
    events = h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  assert.ok(events.some(e => e.type === 'combatDamage'), 'the damage step really ran in one batch');
  assert.ok(events.some(e => e.type === 'afterCombat'), '…and the after-step came with it');
  return { h, D, events };
}

/**
 * ⚠ TWO CURTAINS NOW COVER THIS LOG, AND #53 IS ABOUT EXACTLY ONE OF THEM.
 *
 * R80's PACING curtain (ui/pace.ts, the beat queue) is what report #53 is: the
 * end of combat arrived in one frame and was over before it could be read. The
 * story curtain added in round 31 for report #125 is a different axis — it
 * folds lines that are *echoes*, whichever beat they arrived on, and it folds
 * `combatDamage` and `afterCombat` by name, which are the two lines these
 * guards measure the beat boundary with.
 *
 * Read through both, the assertion below stops meaning what it says: `rows`
 * would shrink for a reason that has nothing to do with pacing, and the exact
 * `head + stages[0].lines` equality — the join between combatStages and the
 * client that feeds it — would be comparing against the wrong denominator.
 * A test that can go red for two unrelated reasons names neither.
 *
 * So these two ask for the EVERYTHING view. That is not weakening the guard:
 * it is the same log the client has always printed, and the story curtain has
 * its own guards in 226-log-and-naming (`nothing is deleted`, `the curtain
 * fails open`). One curtain per test.
 */
const showEveryLine = (): void => { localStorage.setItem('algoLogVerbose', '1'); };

test('#53 a real combat batch reaches the client PACED, not all in one frame', () => {
  showEveryLine();
  const { h, D, events } = combatBatch(5940);
  const told = events.filter(e => e.msg);
  assert.ok(told.length >= 6, `a combat worth pacing (${told.length} lines)`);

  // The legal list is deliberately non-empty. R150's throttle (ui/pace.ts)
  // HOLDS an update the player cannot act on, and an update it is holding has
  // not reached `absorbBeats` at all — so an empty list would make this test
  // pass for the wrong reason, and pass or fail depending on how many updates
  // ran before it in the same process. A state the player can act on is never
  // held, which leaves the beat queue as the only thing pacing the log.
  const legal: Action[] = [{ type: 'passPriority', seat: D }];
  ui.join(viewFor(h.state, D), D, legal);
  openLog(ui);   // CT-124/#131: the log is a modal now — this is the only way in
  assert.deepEqual(logRows(ui.html()), [], 'the fixture starts with an empty log');

  const html = ui.update(viewFor(h.state, D), legal, { events });
  const rows = logRows(html);
  assert.ok(rows.length < told.length,
    `the whole batch landed at once (${rows.length} of ${told.length} lines drawn immediately). `
    + 'That is the report: nobody had anything to answer and the entire end of combat was over '
    + 'before it could be read');
  assert.ok(rows.some(r => r.includes('Combat damage')),
    'the first stage is told NOW — the board is already final under it, and making the player '
    + 'wait to be told about a move they can already see is the opposite of the ask');
  assert.ok(!rows.some(r => r.includes('After-combat step')),
    'the end of the story has not been told yet');

  // …and the curtain is EXACTLY this batch's staging, not some other number of
  // lines that happens to be smaller. The lines before the damage header are
  // never staged; from the header on, only the first stage has been told.
  const stages = combatStages(events);
  const head = told.findIndex(e => e.type === 'combatDamage');
  assert.ok(stages.length >= 2, `a batch with something to pace (${stages.length} stages)`);
  assert.equal(rows.length, head + stages[0]!.lines,
    'the log stops precisely at the end of the first beat — this is the join between '
    + 'combatStages (tested on its own) and the client that has to feed it');
  closeLog(ui);
});

test('#53 …and the held lines are a curtain, not an edit — the next update lifts it', () => {
  showEveryLine();
  const { h, D, events } = combatBatch(5941);
  const told = events.filter(e => e.msg);
  const legal: Action[] = [{ type: 'passPriority', seat: D }];
  ui.join(viewFor(h.state, D), D, legal);
  openLog(ui);   // CT-124/#131
  ui.update(viewFor(h.state, D), legal, { events });
  assert.ok(logRows(ui.html()).length < told.length, 'held, as above');

  // R80's own promise: `h.log` is never touched, so an undo, a resync or a bug
  // can only ever make the missing lines APPEAR — at worst MAX_LEAD_MS late.
  // A later batch REPLACES the beat queue rather than queueing behind it.
  //
  const after = logRows(ui.update(viewFor(h.state, D), legal));
  assert.equal(after.length, told.length, 'every line arrives — nothing was dropped');
  assert.ok(after.some(r => r.includes('After-combat step')), 'including the last one');
  closeLog(ui);   // `logOpen` is module state and outlives this test
});
