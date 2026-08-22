/* Playtest round 7 (game BRDM, 2026-08-20) — the three rules-level reports.
 *
 *  - "Tempest Wrangler (with alluring) didn't trigger on attack": Alluring was
 *    in the Attr union and in the rules reference and enforced nowhere, so an
 *    Alluring attacker could simply be ignored.
 *  - "Formless is broken here. It should have set Manablub to a 4/4, but it's
 *    combined with the other thing. Stats need to be able to be SET without
 *    using + or -.": the engine had no layer 2. Formless and Body Swap both
 *    write the BASE, and doing it with deltas made a Body-Swapped Bloated
 *    Manablub come out 6/9 instead of 4/4.
 *  - "Body Swap puts into the log that the units get -X/+X … it's supposed to
 *    be a pure swap": same cause, and the log now says what happened.
 *
 * Seeds 5200-5299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { apply, legalActions, unmetAllure, IllegalAction } from '../src/apply.ts';
import { shouldAutoYield } from '../ui/inspect.ts';
import { effStats, ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';
import type { Action, EntityId, GameState, Seat } from '../src/types.ts';

/* ── layer 2: stats that are SET, not adjusted ─────────────────────────── */

test('Formless SETS the base — a second base-setter replaces, never compounds', () => {
  const h = new Harness(5200);
  toDeployment(h);
  const seat: Seat = 0;
  const u = spawn(h, seat, 'Good Whale');           // printed 7/5
  const e = () => new E(h.state);

  e().setBase(ent(h, u)!, 4, 4);
  assert.deepEqual(effStats(h, u), [4, 4], 'base rewritten, not nudged');

  // this is the reported bug: a SECOND base-setting effect on the same unit
  // must land on 3/3, not on 4/4 plus a delta to 3/3
  e().setBase(ent(h, u)!, 3, 3);
  assert.deepEqual(effStats(h, u), [3, 3]);
  assert.deepEqual(ent(h, u)!.baseSet, [3, 3]);
});

test('layer 3 still applies on top of a rewritten base', () => {
  const h = new Harness(5201);
  toDeployment(h);
  const u = spawn(h, 0, 'Good Whale');
  const e = new E(h.state);
  e.setBase(ent(h, u)!, 4, 4);
  e.addCounters(ent(h, u)!, 2);
  e.addTemp(ent(h, u)!, 1, 0);
  assert.deepEqual(effStats(h, u), [7, 6], '4/4 base, +2/+2 counters, +1/+0 temp');
});

test('a rewritten base is an until-regroup change and regroup clears it', () => {
  const h = new Harness(5202);
  toDeployment(h);
  const A = h.state.initiative;
  const u = spawn(h, A, 'Good Whale');
  new E(h.state).setBase(ent(h, u)!, 1, 1);
  assert.deepEqual(effStats(h, u), [1, 1]);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [] });
  while (h.state.phase === 'battle') {
    const b = h.state.battle!;
    if (b.step === 'declare') h.do({ type: 'declareAttack', seat: b.attacker, columns: [] });
    else if (b.step === 'blocks') h.do({ type: 'declareBlocks', seat: b.defender, blocks: {} });
    else pass(h);
  }
  assert.equal(ent(h, u)!.baseSet, undefined, 'cleared with the other temp changes (R11 step 3)');
  assert.deepEqual(effStats(h, u), [7, 5], 'back to printed');
});

test('Body Swap exchanges bases, and says so in the log', () => {
  const h = new Harness(5203);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const mine = spawn(h, A, 'Good Whale');           // 7/5
  const theirs = spawn(h, D, 'Rune Channeler');     // 4/3
  const [mp, mt] = effStats(h, mine), [tp, tt] = effStats(h, theirs);
  giveResources(h, A, 'metal', 12);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });

  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Body Swap') });
  pick(h, { unit: mine });
  pick(h, { unit: theirs });
  const from = h.log.length;
  pass(h); pass(h);

  assert.deepEqual(effStats(h, mine), [tp, tt], 'took the other unit’s stats');
  assert.deepEqual(effStats(h, theirs), [mp, mt], 'and vice versa');
  const said = h.log.slice(from).join('\n');
  assert.match(said, /base becomes/, 'the log describes a swap, not a ±delta');
  assert.doesNotMatch(said, /gets [+-]\d+\/[+-]\d+ until regroup/,
    '"gets -3/-2 until regroup" is not what a base exchange does');
});

test('Formless after Body Swap is a 4/4 — the exact BRDM position', () => {
  // Bloated Manablub came out of this sequence a 6/9 in the played game
  const h = new Harness(5204);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const victim = spawn(h, D, 'Good Whale');
  const other = spawn(h, A, 'Rune Channeler');
  const e = new E(h.state);
  // stand in for the earlier Body Swap: the victim's base is already rewritten
  e.setBase(ent(h, victim)!, e.effStats(ent(h, other)!)[0], e.effStats(ent(h, other)!)[1]);
  e.setBase(ent(h, victim)!, 4, 4);                 // …then Formless
  assert.deepEqual(effStats(h, victim), [4, 4],
    'a base 4/4 is a base 4/4 however many times the base was rewritten before');
});

/* ── Alluring ──────────────────────────────────────────────────────────── */

/** set up a battle where `A` attacks `D` with an Alluring unit */
function allureBoard(seed: number, extra?: (h: Harness, A: Seat, D: Seat) => void) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const lure = spawn(h, A, 'Tempest Wrangler');     // {Alluring}
  const blocker = spawn(h, D, 'Good Whale');
  extra?.(h, A, D);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure]] });
  pass(h); pass(h);
  return { h, A, D, lure, blocker };
}

test('Alluring: a defender who can block it may not decline', () => {
  const { h, D, lure } = allureBoard(5210);
  assert.ok(new E(h.state).colAttrs([lure]).has('Alluring'), 'the attacker really is Alluring');
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: {} }),
    (err: unknown) => err instanceof IllegalAction && /Alluring/.test((err as Error).message),
    'declining an Alluring attacker with a free blocker is illegal');
});

test('Alluring: legalActions never offers the declaration apply() would refuse', () => {
  // the fuzzer's "legalActions lied" invariant is what caught this rule living
  // in only one of the two places
  const { h, D } = allureBoard(5211);
  const legal = legalActions(h.state, D).filter(a => a.type === 'declareBlocks');
  assert.ok(legal.length, 'there are still legal ways to block');
  assert.ok(!legal.some(a => a.type === 'declareBlocks' && !Object.keys(a.blocks).length && !a.send?.length),
    'the "block nothing" option is gone while the duty stands');
  // and everything still offered is genuinely accepted (one declaration ends
  // the step, so each is checked against its own copy of the position)
  for (const a of legal) {
    const fresh = structuredClone(h.state);
    assert.doesNotThrow(() => apply(fresh, a),
      `legalActions offered ${JSON.stringify(a)} but apply() refused it`);
  }
});

test('Alluring: blocking it discharges the duty', () => {
  const { h, D, blocker } = allureBoard(5212);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  assert.deepEqual(h.state.battle!.blocks[0], [blocker]);
});

test('Alluring: a defender with nobody able is not obliged', () => {
  const h = new Harness(5213);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const lure = spawn(h, A, 'Tempest Wrangler');
  toNextBattle(h, A);                               // D has NO units at all
  h.do({ type: 'declareAttack', seat: A, columns: [[lure]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  assert.deepEqual(h.state.battle!.blocks, {}, 'no units, no duty');
  assert.equal(unmetAllure(new E(h.state), D, {}), null);
});

/* ── R76: two Alluring columns, and the stuck state that hid behind them ──
 *
 * Alluring is COMPULSORY, and a declaration must discharge every duty on the
 * board at once. `legalActions` offered a representative set of declarations
 * that each blocked exactly ONE column, which cannot express that: with two
 * Alluring columns and two able blockers, every option left the other column
 * unblocked with a blocker to spare, so every option was refused — no legal
 * action for either player, no pending decision, and the game HANGS.
 *
 * Found by the fuzzer at seed 1993 (pinned in test/06-fuzz.test.ts). The bug is
 * exactly as old as Alluring itself: the single-column generator and the
 * compulsory filter landed together in this round.
 */

/** every declaration `legalActions` offers the defender, as concrete actions */
function blockOptions(h: Harness, D: Seat): Extract<Action, { type: 'declareBlocks' }>[] {
  return legalActions(h.state, D)
    .filter((a): a is Extract<Action, { type: 'declareBlocks' }> => a.type === 'declareBlocks');
}

/** two one-unit Alluring columns, and `nBlockers` plain 3/3s to answer them */
function twoAlluringColumns(seed: number, nBlockers: number): {
  h: Harness; A: Seat; D: Seat; lures: EntityId[]; blockers: EntityId[];
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lures = [0, 1].map(() => spawn(h, A, 'Tempest Wrangler'));   // 1/3 {Alluring}
  const blockers = Array.from({ length: nBlockers }, () => spawn(h, D, 'The Foretold'));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: lures.map(id => [id]) });
  pass(h); pass(h);                                   // → the block step
  return { h, A, D, lures, blockers };
}

test('R76: two Alluring columns and two able blockers is not a stuck state', () => {
  const { h, D } = twoAlluringColumns(5240, 2);
  const anyone = [...legalActions(h.state, 0), ...legalActions(h.state, 1)];
  assert.ok(anyone.length > 0,
    'SOMEBODY must have something to do — an empty list here hangs the game');
  const opts = blockOptions(h, D);
  assert.ok(opts.some(a => Object.keys(a.blocks).length === 2),
    'and at least one offer must block BOTH Alluring columns, because both compel');
});

test('R76: every block declaration legalActions offers is one apply() accepts', () => {
  // the fuzzer's "legalActions lied" invariant, aimed at the position that
  // broke it: each option is checked against its own copy, since one
  // declaration ends the step
  const { h, D } = twoAlluringColumns(5241, 2);
  const opts = blockOptions(h, D);
  assert.ok(opts.length, 'there are options at all');
  for (const a of opts) {
    const fresh = structuredClone(h.state);
    assert.doesNotThrow(() => apply(fresh, a),
      `legalActions offered ${JSON.stringify(a)} but apply() refused it`);
  }
});

test('R76: with two able blockers, blocking only ONE Alluring column is still illegal', () => {
  // the fix must not have loosened the rule — the position was always legal,
  // it was the offer list that could not express it
  const { h, D, lures, blockers } = twoAlluringColumns(5242, 2);
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blockers[0]!] } }),
    (err: unknown) => err instanceof IllegalAction && /Alluring/.test((err as Error).message));
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: {} }),
    (err: unknown) => err instanceof IllegalAction && /Alluring/.test((err as Error).message));
  // …and covering both is accepted
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blockers[0]!], 1: [blockers[1]!] } });
  assert.deepEqual(h.state.battle!.blocks[0], [blockers[0]!]);
  assert.deepEqual(h.state.battle!.blocks[1], [blockers[1]!]);
  assert.ok(lures.length === 2);
});

test('R76: two Alluring columns against ONE blocker is unchanged — one duty, discharged once', () => {
  const { h, D, blockers } = twoAlluringColumns(5243, 1);
  const opts = blockOptions(h, D);
  assert.ok(opts.length, 'not stuck');
  assert.ok(!opts.some(a => Object.keys(a.blocks).length === 2),
    'there is nobody to cover the second column');
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [blockers[0]!] } });
  assert.deepEqual(h.state.battle!.blocks[1], [blockers[0]!],
    'committing the only blocker to either column discharges what can be discharged');
});

test('R76: an Alluring column that also needs TWO blockers gets two', () => {
  const h = new Harness(5244);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const plain = spawn(h, A, 'The Foretold');
  const blockers = [0, 1].map(() => spawn(h, D, 'The Foretold'));
  new E(h.state).addTempAttr(ent(h, lure)!, 'Evasive');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure], [plain]] });
  pass(h); pass(h);
  const opts = blockOptions(h, D);
  assert.ok(opts.length, 'not stuck');
  for (const a of opts) {
    assert.equal((a.blocks[0] ?? []).length, 2,
      'Evasive needs two, and the compulsory core supplies two or the duty is undischargeable');
  }
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: blockers } });
  assert.deepEqual(h.state.battle!.blocks[0], blockers);
});

test('R76: a lone Sneaky attacker that is also Alluring is not a stuck state either', () => {
  // R20 forbids blocking it; Alluring demanded a block. Two rules, no legal
  // declaration, and the same hang — found by reading rather than by fuzzing.
  const h = new Harness(5245);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const blocker = spawn(h, D, 'The Foretold');
  new E(h.state).addTempAttr(ent(h, lure)!, 'Sneaky');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure]] });
  pass(h); pass(h);
  assert.ok(blockOptions(h, D).length, 'not stuck');
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } }),
    (err: unknown) => err instanceof IllegalAction && /Sneaky/.test((err as Error).message),
    'R20 still forbids blocking it');
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  assert.deepEqual(h.state.battle!.blocks, {},
    'nobody is ABLE to block it, so the Alluring duty is discharged by doing nothing');
});

test('R76: an attack that has collapsed to nothing still lets the defender declare', () => {
  // R72: every attacking column can empty and close up before blocks, leaving
  // b.columns []. The defender must still have a way to say "no blocks".
  const h = new Harness(5246);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  const e = new E(h.state);
  e.destroy(ent(h, atk)!, 'is deleted');
  e.settle();
  assert.deepEqual(h.state.battle!.columns, [], 'the whole attack collapsed away');
  const opts = blockOptions(h, D);
  assert.ok(opts.length, 'not stuck');
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  assert.equal(h.state.battle!.step, 'blockWindow', 'and the battle moves on');
  finishBattle(h);
});

test('Alluring: a unit sent to counterattack is spoken for, not "able"', () => {
  const { h, D, blocker } = allureBoard(5214);
  // sending the only free unit away is a real choice; the duty cannot also
  // claim it
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [blocker] });
  assert.deepEqual(h.state.battle!.sentAttackers, [blocker]);
});

test('unmetAllure names the attacker that is being ignored', () => {
  const { h, D } = allureBoard(5215);
  assert.equal(unmetAllure(new E(h.state), D, {}), 'Tempest Wrangler');
});

/* ── auto-yield ────────────────────────────────────────────────────────── */

/** a state with `stack` on it, priority to seat 0 */
function stacked(kinds: { kind: string; sourceId?: EntityId }[]): GameState {
  const h = new Harness(5220);
  toDeployment(h);
  const s = h.state;
  s.priority = 0;
  s.decision = null;
  s.stack = kinds.map((k, i) => ({
    id: 100 + i, kind: k.kind as 'triggered' | 'spell', label: `item ${i}`,
    controller: 0, region: 0, negated: false, parts: [],
    ...(k.sourceId !== undefined ? { sourceId: k.sourceId } : {}),
  }));
  return s;
}

test('auto-yield fires on the TOP of the stack, whatever is underneath', () => {
  // the reported bug: the old test required the WHOLE stack to be yielded
  // triggers, so one unyielded item — the common case — disabled the chip entirely
  const s = stacked([
    { kind: 'spell' },                       // somebody else's spell, at the bottom
    { kind: 'triggered', sourceId: 9 },      // not yielded
    { kind: 'triggered', sourceId: 7 },      // TOP: yielded
  ]);
  assert.equal(shouldAutoYield(s, 0, new Set([7])), true);
});

test('auto-yield stays quiet when the top is not yours to skip', () => {
  const yielded = new Set([7]);
  assert.equal(shouldAutoYield(stacked([{ kind: 'triggered', sourceId: 9 }]), 0, yielded), false,
    'a different unit’s trigger still deserves a look');
  assert.equal(shouldAutoYield(stacked([{ kind: 'spell', sourceId: 7 }]), 0, yielded), false,
    'a spell is never auto-yielded, whoever cast it');
  assert.equal(shouldAutoYield(stacked([]), 0, yielded), false, 'an empty stack is not a yield');
  assert.equal(shouldAutoYield(stacked([{ kind: 'triggered', sourceId: 7 }]), 1, yielded), false,
    'not my priority, not my pass');
  assert.equal(shouldAutoYield(stacked([{ kind: 'triggered', sourceId: 7 }]), 0, new Set()), false,
    'nothing yielded, nothing skipped');
});

test('auto-yield never passes through a pending decision', () => {
  const s = stacked([{ kind: 'triggered', sourceId: 7 }]);
  s.decision = { id: 1, seat: 0, kind: 'targets', prompt: 'pick', options: [] };
  assert.equal(shouldAutoYield(s, 0, new Set([7])), false);
});

test('auto-yield does not skip a negated trigger (R68: unreachable, kept as a guard)', () => {
  // R68 made this state impossible to reach in play — negation splices the
  // item off the stack, so nothing on the stack is ever `negated`. The guard
  // stays because the flag stays on the type, and a stack item wearing it
  // should never be silently passed through.
  const s = stacked([{ kind: 'triggered', sourceId: 7 }]);
  s.stack[0]!.negated = true;
  assert.equal(shouldAutoYield(s, 0, new Set([7])), false,
    'a negated item is worth seeing resolve into nothing');
});

/* ── nothing to do while the opponent decides ──────────────────────────── */

test('a seat with a decision pending against the OTHER seat has no legal action', () => {
  // Playtest: "when a decision is pending for the other player I get the window
  // for priority and it asks me to pass, but I can't." The server redacts the
  // opponent's decision to null, so the client cannot see it — but it does not
  // need to: this is the fact the waiting bar is built on (main.ts promptHtml).
  const h = new Harness(5230);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Good Whale');
  spawn(h, D, 'Good Whale');
  giveResources(h, A, 'water', 12);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Leaping Lillik') });

  const dec = h.state.decision;
  assert.ok(dec, 'A owes a target decision');
  assert.equal(dec.seat, A);
  assert.deepEqual(legalActions(h.state, D), [],
    'the other seat has nothing legal — so no Pass button may be offered');
  assert.ok(legalActions(h.state, A).length, 'and the deciding seat does');
});

/* ── the round-7 deferral ledger ────────────────────────────────────────────
 *
 * The round-7 commit message closed with "Still open, deliberately:" and four
 * items, and left ZERO trace in the repo — no PARKED comment, no ⚠ header, no
 * { todo: true } test. The engine README's own rule is that the todo count IS
 * the backlog; these four sat outside it, which is exactly why two of them
 * came back as fresh reports. The ledger lives here now (park-hygiene audit,
 * round 13, 2026-08-21):
 *
 *   · Necromorph's second target — CLOSED. R64 gave bin cards a real TargetRef
 *     (`BinRef`); test/43-dark-c.test.ts exercises the exchange end to end.
 *   · Formless's attribute-removal half — CLOSED. R62 is the suppression
 *     layer; batch-metal-b.ts calls `g.suppress(t, 'Formless', { attrs: true })`
 *     and test/59-base-stats.test.ts covers it.
 *   · the empty-column collapse — CLOSED. R72, test/64-formation-collapse.test.ts.
 *   · Eldritch Dreamtender's sacrifice timing — CLOSED. R73 (Bena, 2026-08-22):
 *     "sacrifice me" is a CAST COST, paid on the way to the stack, not at
 *     resolution. `sacrificeUnits` gained `from: 'self'` (resolved through
 *     item.sourceId, the `removeCounters` precedent) and the card carries it.
 *     Real tests, no longer todos: test/26-metal-a.test.ts for the card,
 *     test/32-cast-costs.test.ts for the primitive.
 *
 * ALL FOUR round-7 deferrals are now closed. What survives below is NOT one of
 * them: R73 settled WHETHER the sacrifice is a cost, and left open WHICH combat
 * damage sub-step the trigger fires in — a question the round-7 ledger never
 * asked and that no primitive is missing for.
 */

test('Eldritch Dreamtender: WHICH combat-damage sub-step the trigger fires in '
  + '(PARKED: a rules question — needs Bena)', { todo: true }, () => {
  // NOT the round-7 deferral, which R73 closed. The printed text is "When my
  // column deals combat damage to an opponent, sacrifice me. If you do, look
  // at that player's hand and discard a card from it." R73 (2026-08-22) ruled
  // that the sacrifice is a CAST COST, so it is paid on the way to the stack
  // rather than at resolution — the unit is in the bin before anyone has
  // priority. What is STILL undecided is which damage sub-step the trigger
  // fires in, and that moves the payment with it.
  //
  // Today: the trigger fires off the aggregated combat `lifeLost` event inside
  // the damage sub-step, and R3/R31 resolve it IMMEDIATELY, before the next
  // sub-step — so a Dreamtender in a Swift column is already in the bin when
  // normal damage is dealt, and one in a normal column is gone before the
  // Sluggish sub-step and before the after-combat window. That is a real
  // difference: it changes what a Sluggish column-mate's attribute sharing
  // sees, whether the Dreamtender is around for an "after combat" trigger, and
  // (as of R72) whether its column collapses mid-combat.
  //
  // The alternative reading — the trigger waits until combat damage is
  // finished — is not obviously wrong, and the paper game resolves it by
  // conversation. There is no engine primitive missing: the trigger queue can
  // express either. What is missing is the RULING, which is why this is a todo
  // and not a bug.
  //
  // Related but separate, and already noted on the card: `myColumnConnected`
  // reads "my column connected" off the aggregated lifeLost event
  // (Amphivore's approximation), so two columns connecting in the same
  // sub-step are indistinguishable to it.
});
