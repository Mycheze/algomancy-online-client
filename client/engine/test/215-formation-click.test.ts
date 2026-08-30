/* REPORT #107 / CARD-TODO #94 — THE BATTLEFIELD ANSWERS THE PLACEMENT QUESTION.
 *
 * The owner, playtest report #107, 2026-08-27:
 *
 *   "Spawning something in formation does now work, but I should be able to
 *    click WHERE rather than using a button in the top bar. Clicking on the
 *    battlefield is better UX"
 *
 * ⚠ NOTE THE FIRST FOUR WORDS. The RULES half of BL-24 is fixed and he says
 * so. This is the AFFORDANCE, and nothing here may reach the engine.
 *
 * ── WHAT WAS MEASURED, AND WHAT IT COST ───────────────────────────────
 *
 * CT-94's evidence: the SBCM state at action [64] — a live `formationSlot`
 * question, "Hooba-Bot: where does Robot join the formation?" — driven through
 * `test/ui-driver.ts` yielded **2 decide-buttons, 0 pings, 0 `.candidate`
 * elements, 0 click targets.** The battlefield was completely inert, measured
 * rather than described. §3 below is that same measurement, and it is written
 * so that reverting the client change makes it read zero again.
 *
 * Two causes, and the first was paid off already:
 *
 *   (a) THE ENGINE SENT NOTHING TO POINT AT. Every option carried label prose
 *       and a bare slot INDEX, so a client could not draw a drop target even
 *       in principle. Fixed first: `DecisionOption.spot` now rides on every
 *       option at all three ask sites, and `108-formation-class` asserts it on
 *       every card in the class and scans for a fourth site.
 *   (b) THE CLIENT COULD NOT TAKE THE CLICK. `ui/main.ts`'s only
 *       board-click-to-decide route is gated on `dec.kind === 'targets'`
 *       (`decisionOptionIndex`), which a `formationSlot` is not. That is what
 *       this file is about.
 *
 * ── ⚠ THE ANSWER NAMESPACE IS UNCHANGED, AND §4 IS WHY THAT MATTERS ───
 *
 * A placement is still answered by the option's INTEGER INDEX. `spot` is a
 * second, redundant spelling carried so a client can POINT at an option, and
 * nothing may read it to resolve one. `server/rooms.ts` `referenceKey` keys
 * every saved game's `decide` on kind + option count + chosen label, and the
 * R200 forensic stack replays off the same. Re-keying would break
 * `143-replay-divergence` for exactly the games we most want to re-examine.
 * §4 pins that the click and the bar's button send the identical action.
 *
 * ── WHAT IS HERE ──────────────────────────────────────────────────────
 *
 *   §1  THE DERIVATION, checked against the engine BY REFERENCE EQUALITY on
 *       the column array `formationSlots` hands back — not by label, not by
 *       re-deriving the grid. Both grids, because they are indexed
 *       differently and that difference is the one thing a reader gets wrong.
 *   §2  `gridSeatOf` — whose grid a question is about, derived from the
 *       question rather than from `Decision.seat`, which R225 can make a
 *       different seat entirely.
 *   §3  THE CLIENT, end to end through `test/ui-driver.ts`: the targets are
 *       really on screen, and clicking one really sends the decision.
 *   §4  THE NEGATIVE CONTROLS. No question, no targets; a spot the board has
 *       moved out from under draws nothing rather than drawing the wrong
 *       thing; and the top-bar buttons still answer.
 *
 * Seeds 21500-21599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import { formationSlotOffer, gridSeatOf, spotAnchor } from '../../ui/fslot.ts';
import { client } from './ui-driver.ts';
import { ent, finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { Action, GameState, Seat } from '../src/types.ts';

const ui = await client();

/** answer whatever placement question is still open, then run the battle out.
 * `finishBattle` refuses an unexpected decision on purpose — these fixtures
 * stop ON one, so the answer is part of the teardown, not part of the test. */
function done(h: Harness): void {
  const dec = h.state.decision;
  if (dec?.kind === 'formationSlot') h.do({ type: 'decide', seat: dec.seat, choice: 0 });
  finishBattle(h);
}

/** the count CT-94 measured: how many places on the line take a click */
const dropTargets = (html: string): number => (html.match(/data-act="fslot"/g) ?? []).length;
/** and the buttons the bar has always had, which must not go anywhere */
const decideButtons = (html: string): number => (html.match(/data-btn="decide"/g) ?? []).length;

/**
 * ATTACKER'S GRID: Hooba-Lin augmented onto an attacker asks "where does the
 * 1/1 join the formation?" the moment the host attacks. Two one-unit columns,
 * so the offer covers every shape at once — both ends, and a `behind` on each
 * column.
 */
function attackerAsk(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const host = spawn(h, A, 'Good Whale');
  const mate = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'fire', 4);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hooba-Lin'), hostId: host });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host], [mate]] });
  pass(h); pass(h);
  assert.equal(h.state.decision?.kind, 'formationSlot', 'the fixture really asks the question');
  return { h, A, D };
}

/**
 * DEFENDER'S GRID: Hooba-Bot's trigger is "when I attack OR BLOCK", so the
 * same question can be asked about the BLOCKING grid — which is keyed to the
 * attacking columns it blocks (R72) and therefore indexed differently. This
 * fixture exists because that difference is the whole of `attackColumnOf`, and
 * a test that only ever saw the attacker would pass with it deleted.
 */
function defenderAsk(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const a1 = spawn(h, A, 'Good Whale'), a2 = spawn(h, A, 'Good Whale'), a3 = spawn(h, A, 'Good Whale');
  const host = spawn(h, D, 'Good Whale'), mate = spawn(h, D, 'Good Whale');
  giveResources(h, D, 'metal', 4);
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Hooba-Bot'), hostId: host });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2], [a3]] });
  pass(h); pass(h);
  // ⚠ THE FIXTURE IS THE POINT. Attack column 0 is left UNBLOCKED, so the
  // defender's grid — `Object.keys(b.blocks)` in key order — is
  // [column 1, column 2] and its indexes 0 and 1 are the panel's columns 1 and
  // 2. A fixture that blocked everything would make the compaction the
  // identity map and this whole file would pass with `attackColumnOf` deleted.
  // Two blocking columns, one unit each, so two slots are offered and the
  // engine actually ASKS rather than auto-picking a lone option.
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [host], 2: [mate] } });
  pass(h); pass(h);                                  // the block trigger resolves
  assert.equal(h.state.decision?.kind, 'formationSlot', 'the fixture really asks the question');
  return { h, A, D };
}

/* ── §1 the derivation, against the engine's own answer ─────────────────── */

/** every spot the engine offers `seat` resolves to the column the ENGINE said,
 * compared by reference rather than by index arithmetic or by label */
function checkAgainstEngine(h: Harness, seat: Seat, why: string): number {
  const s = h.state, b = s.battle!;
  const slots = new E(s).formationSlots(seat);
  assert.ok(slots.length, `${why}: the engine really is offering slots`);
  for (const slot of slots) {
    const anchor = spotAnchor(s, seat, slot.spot);
    assert.ok(anchor, `${why}: "${slot.label}" resolves to somewhere on screen`);
    if (slot.col === null) {
      // a new column at an end — there is no existing column to point at
      assert.deepEqual(anchor, { kind: 'end', end: slot.end }, `${why}: "${slot.label}"`);
      continue;
    }
    assert.equal(anchor.kind, 'col', `${why}: "${slot.label}" points at a column that exists`);
    const ci = (anchor as { kind: 'col'; ci: number }).ci;
    const drawn = seat === b.attacker ? b.columns[ci] : b.blocks[ci];
    assert.equal(drawn, slot.col,
      `${why}: "${slot.label}" is drawn at column ${ci}, and that is the SAME ARRAY the engine `
      + 'named — reference equality, so an index that merely happens to line up today cannot pass');
  }
  return slots.length;
}

test('§1a the ATTACKING grid: every offered spot points at the column the engine named', () => {
  const { h, A } = attackerAsk(21500);
  const n = checkAgainstEngine(h, A, 'attacker');
  assert.equal(n, 4, 'two ends and a back slot on each of the two columns');
  done(h);
});

test('§1b the BLOCKING grid is COMPACTED, and the anchor un-compacts it', () => {
  const { h, D } = defenderAsk(21501);
  const b = h.state.battle!;
  assert.equal(b.blocks[0], undefined, 'attack column 0 is unblocked — that is what compacts the grid');
  const slots = new E(h.state).formationSlots(D);
  assert.deepEqual(slots.map(s => s.col), [b.blocks[1], b.blocks[2]],
    'the blocking grid is read in KEY order, so its indexes 0 and 1 are attack columns 1 and 2');
  checkAgainstEngine(h, D, 'defender');
  assert.deepEqual(slots.map(s => spotAnchor(h.state, D, s.spot)),
    [{ kind: 'col', ci: 1 }, { kind: 'col', ci: 2 }],
    'grid index 0 is drawn at ATTACK column 1 — the panel stacks the two halves of one `ci`, '
    + 'so drawing it at column 0 would put the drop target under an attacker nobody is blocking');
  // and the same via a `hole`, which is the branch that CANNOT fall back to
  // searching for a unit: it names a grid index and nothing else
  assert.deepEqual(spotAnchor(h.state, D, { kind: 'hole', column: 0 }), { kind: 'col', ci: 1 },
    'a hole in the blocking grid un-compacts the same way');
  assert.deepEqual(spotAnchor(h.state, D, { kind: 'hole', column: 1 }), { kind: 'col', ci: 2 });
  done(h);
});

test('§1c a spot the board has moved out from under resolves to nothing, not to the wrong place', () => {
  const { h, A } = attackerAsk(21502);
  const s = h.state;
  assert.equal(spotAnchor(s, A, { kind: 'behind', unit: 9999 as never }), null,
    'a unit that is not on the line names no column');
  assert.equal(spotAnchor(s, A, { kind: 'hole', column: 99 }), null,
    'a column index past the end of the line names no column');
  assert.deepEqual(spotAnchor(s, A, { kind: 'out' }), { kind: 'out' },
    'the printed "you MAY" is a real answer and it is not on the line');
  done(h);
});

/* ── §2 whose grid — derived from the question, not from Decision.seat ──── */

test('§2 gridSeatOf reads the grid off the OFFER, and agrees with the engine on both sides', () => {
  const atk = attackerAsk(21503);
  assert.equal(gridSeatOf(atk.h.state, atk.h.state.decision!), atk.h.state.battle!.attacker,
    'an offer containing an end spot is the attacking grid — only it can widen (R72)');
  done(atk.h);

  const def = defenderAsk(21504);
  assert.equal(gridSeatOf(def.h.state, def.h.state.decision!), def.h.state.battle!.defender,
    'an offer with no end spot at all is a blocking grid');
  assert.equal(def.h.state.decision!.options.some(o => o.spot?.kind === 'end'), false,
    'and that premise is asserted, not assumed — a blocking column is keyed to an attacking '
    + 'column, so a new one has no index to exist at');
  done(def.h);
});

test('§2b the derivation is not Decision.seat wearing a disguise', () => {
  // R225: the slots come from the grid the SOURCE ENTITY stands in, which is
  // not always the asked seat's own. So the two are DIFFERENT questions, and
  // this pins that `gridSeatOf` answers the second one. Hooba-Bot's host is
  // the defender's, and the defender is asked — but the check that matters is
  // that the answer came from the OPTIONS.
  const { h, D } = defenderAsk(21505);
  const dec = h.state.decision!;
  assert.equal(dec.seat, D);
  const asIfAttacker = { ...dec, options: [...dec.options, { label: 'x', value: 99, spot: { kind: 'end', end: 'left' } as const }] };
  assert.equal(gridSeatOf(h.state, asIfAttacker), h.state.battle!.attacker,
    'one end spot flips the answer with Decision.seat untouched — the offer decides, not the seat');
  done(h);
});

/* ── §3 the client: CT-94's own measurement, from the other side ────────── */

test('§3a the battlefield is no longer inert — the drop targets are really on screen', () => {
  const { h, A } = attackerAsk(21506);
  const html = ui.join(h.state as GameState, A, legalActions(h.state, A) as Action[]);
  const offer = formationSlotOffer(h.state, h.state.decision);
  assert.ok(offer, 'there is an offer to draw');
  assert.equal(dropTargets(html), offer.targets.length,
    'CT-94 measured 0 click targets on this exact question. One per resolvable option now.');
  assert.equal(dropTargets(html), 4, 'both ends and both back slots');
  assert.ok(decideButtons(html) >= 4,
    'and the bar\'s buttons are still there — this is a second way in, not a replacement');
  done(h);
});

test('§3b clicking a spot on the line sends the decision, keyed by OPTION INDEX', () => {
  const { h, A } = attackerAsk(21507);
  ui.join(h.state as GameState, A, legalActions(h.state, A) as Action[]);
  ui.sent();                                       // drop the join chatter
  const dec = h.state.decision!;
  const behind = dec.options.findIndex(o => o.spot?.kind === 'behind');
  assert.ok(behind > 0, 'the fixture offers a back slot, and it is not option 0');
  ui.click({ act: 'fslot', i: behind });
  assert.deepEqual(ui.actions(), [{ type: 'decide', seat: dec.seat, choice: behind }],
    'the INTEGER INDEX, which is the namespace every saved game is keyed on');
  done(h);
});

test('§3c the click really places the unit where the spot said it would', () => {
  // end to end: the client\'s action, applied, puts the token in the column the
  // target was DRAWN at. This is what makes the drawing worth anything.
  const { h, A } = attackerAsk(21508);
  ui.join(h.state as GameState, A, legalActions(h.state, A) as Action[]);
  ui.sent();
  const dec = h.state.decision!;
  const offer = formationSlotOffer(h.state, dec)!;
  const target = offer.targets.find(t => t.anchor.kind === 'col')!;
  const ci = (target.anchor as { kind: 'col'; ci: number }).ci;
  ui.click({ act: 'fslot', i: target.i });
  const [action] = ui.actions();
  h.do(action as Action);
  const col = h.state.battle!.columns[ci]!;
  assert.equal(col.length, 2, `column ${ci + 1} — the one the target was drawn in — took the unit`);
  assert.equal(ent(h, col[1]!)!.card, 'Unit Token');
  done(h);
});

test('§3d the BLOCKING question draws on the blocking half, at the right column', () => {
  const { h, D } = defenderAsk(21509);
  const html = ui.join(h.state as GameState, D, legalActions(h.state, D) as Action[]);
  assert.equal(dropTargets(html), 2, 'two blocking columns, one back slot each — and no ends');
  // the panel draws attack column `ci` as one `.col`, so the targets have to be
  // in the SECOND and THIRD ones — the columns actually being blocked
  const cols = html.split('<div class="col"').slice(1);
  assert.ok(cols.length >= 3, 'all three attacking columns are drawn');
  assert.equal(dropTargets(cols[0]!), 0,
    'nothing offered under the UNBLOCKED attacker — the compaction, seen on screen');
  assert.equal(dropTargets(cols[1]!), 1);
  assert.equal(dropTargets(cols[2]!), 1);
  done(h);
});

/* ── §4 the negative controls ───────────────────────────────────────────── */

test('§4a no formation question means no targets anywhere on the table', () => {
  const { h, A } = attackerAsk(21510);
  assert.ok(formationSlotOffer(h.state, h.state.decision), 'positive control: the offer exists now');
  const answered = { ...h.state, decision: null } as GameState;
  assert.equal(formationSlotOffer(answered, answered.decision), null);
  const html = ui.join(answered, A, []);
  assert.equal(dropTargets(html), 0, 'the line goes back to being scenery the moment it is answered');
  done(h);
});

test('§4b a decision of another kind is never mistaken for a placement', () => {
  const { h } = attackerAsk(21511);
  const dec = h.state.decision!;
  const targets = { ...h.state, decision: { ...dec, kind: 'targets' as const } } as GameState;
  assert.equal(formationSlotOffer(targets, targets.decision), null,
    'the kind is the gate — spots on a `targets` menu are not placements');
  done(h);
});

test('§4c an offer where NOTHING resolves draws nothing rather than an empty invitation', () => {
  const { h, A } = attackerAsk(21512);
  const dec = h.state.decision!;
  const stale = {
    ...h.state,
    decision: { ...dec, options: [{ label: 'behind a ghost', value: 0, spot: { kind: 'behind' as const, unit: 9999 as never } }] },
  } as GameState;
  assert.equal(formationSlotOffer(stale, stale.decision), null);
  const html = ui.join(stale, A, legalActions(h.state, A) as Action[]);
  assert.equal(dropTargets(html), 0);
  assert.ok(decideButtons(html) >= 1,
    'and the bar still answers it — an unpointable option is not an unanswerable one');
  done(h);
});
