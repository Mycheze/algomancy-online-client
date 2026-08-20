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
import { effStats, ent, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';
import type { EntityId, GameState, Seat } from '../src/types.ts';

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

test('auto-yield does not skip a negated trigger', () => {
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
