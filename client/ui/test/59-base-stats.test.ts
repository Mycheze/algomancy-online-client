/* Stat layer 2, end to end — every card in the pool that REWRITES a unit's
 * base power/defense rather than adjusting it.
 *
 * The playtest report: "Aberrant Statweaver gives units +-X/+-X. But really
 * what should happen is a pure replacement effect that changes the BASE stats
 * of the card. Like, if Statweaver could, it would change the literal numbers
 * on the card."
 *
 * Round 7 (test 53) built the ONE-SHOT half of layer 2 — Entity.baseSet,
 * stamped by E.setBase for Formless and Body Swap. Four cards were still
 * faking it with until-regroup deltas, and there was no CONTINUOUS half at
 * all, so Statweaver had to compute "3 minus your printed power" and hand it
 * to the +X/+X layer. That is a different effect wearing the same numbers:
 * it stacks with a second copy, it re-derives off the PRINTED base so it
 * cannot see another rewrite, and it reads as a buff to everything that asks
 * "does this unit have stat changes" or "what is its base power".
 *
 * Now: E.baseStatsOf resolves both halves — the until-regroup stamp and
 * StaticMod.baseP/baseT radiating from a unit in play — LAST-WINS by
 * timestamp, never by summing. Layer 3 applies on top of the answer.
 *
 * Covers the continuous setter (Aberrant Statweaver), the four converted
 * one-shots (Celestial Shifter, Unstable Refactor, Floral Singularity, and
 * Borrower of Forms's copy), the two cards that ASK about a base (Unmake,
 * Leave None Pure), and what the text box says about all of it.
 *
 * Seeds 5900-5999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E, Suspended } from '../../engine/src/engine.ts';
import { getCard, type EffectCtx } from '../../engine/src/cards/dsl.ts';
import { statBreakdown, entityTextBox } from '../cardtext.ts';
import {
  effStats, ent, finishBattle, give, giveResources, notOffered, pass, pick,
  spawn, toDeployment, toNextBattle, unitsOf,
} from '../../engine/test/util.ts';
import type { EntityId, Seat } from '../../engine/src/types.ts';

/** run engine mutations white-box, absorbing a mid-settle suspension */
function whiteBox(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  try {
    f(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
}

const baseOf = (h: Harness, id: EntityId): [number, number] =>
  new E(h.state).baseStatsOf(h.state.entities[id]!);

/* ── the continuous half: Aberrant Statweaver ──────────────────────────── */

test('Statweaver REPLACES the base — a 7/5 and a 1/1 both land on exactly 3/3', () => {
  const h = new Harness(5900);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const whale = spawn(h, A, 'Good Whale');                   // printed 7/5
  spawn(h, A, 'Aberrant Statweaver');
  assert.deepEqual(baseOf(h, whale), [3, 3], 'the number on the card is 3/3 now');
  assert.deepEqual(effStats(h, whale), [3, 3], 'not 7/5 plus a −4/−2 buff');
});

test('two Statweavers do not stack — a base rewrite is idempotent', () => {
  const h = new Harness(5901);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const whale = spawn(h, A, 'Good Whale');                   // 7/5
  spawn(h, A, 'Aberrant Statweaver');
  assert.deepEqual(effStats(h, whale), [3, 3], 'one setter: 3/3');
  spawn(h, A, 'Aberrant Statweaver');
  // as a delta this was 7 + (3−7) + (3−7) = −1 power, i.e. a dead whale
  assert.deepEqual(effStats(h, whale), [3, 3], 'two setters: still exactly 3/3');
  spawn(h, A, 'Aberrant Statweaver');
  assert.deepEqual(effStats(h, whale), [3, 3], 'three setters: still exactly 3/3');
});

test('layer 3 still applies ON TOP of the rewritten base', () => {
  const h = new Harness(5902);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const whale = spawn(h, A, 'Good Whale');                   // 7/5
  spawn(h, A, 'Aberrant Statweaver');
  spawn(h, A, 'Glowhaven Elder');                            // +1/+1 to your OTHER units
  whiteBox(h, e => e.addCounters(e.entity(whale)!, 2));
  assert.deepEqual(baseOf(h, whale), [3, 3], 'the base is untouched by layer 3');
  assert.deepEqual(effStats(h, whale), [6, 6], 'base 3/3 + 2 counters + the Elder');
});

test('the rewrite is CONTINUOUS — it ends the moment the Statweaver leaves', () => {
  const h = new Harness(5903);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const whale = spawn(h, A, 'Good Whale');
  const sw = spawn(h, A, 'Aberrant Statweaver');
  assert.deepEqual(effStats(h, whale), [3, 3]);
  whiteBox(h, e => e.destroy(e.entity(sw)!, 'dies'));
  assert.deepEqual(effStats(h, whale), [7, 5], 'the printed numbers are back');
});

/* ── two rewrites at once: last one wins, by timestamp ─────────────────── */

test('a one-shot rewrite AFTER a Statweaver overrides it (and not the sum)', () => {
  const h = new Harness(5904);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const tok = spawn(h, A, 'Unit Token');                     // 1/1
  spawn(h, A, 'Aberrant Statweaver');
  assert.deepEqual(effStats(h, tok), [3, 3], 'the static has it at 3/3');
  whiteBox(h, e => e.setBase(e.entity(tok)!, 9, 9));         // later stamp
  assert.deepEqual(effStats(h, tok), [9, 9], 'the later rewrite wins outright');
});

test('a Statweaver arriving AFTER a one-shot rewrite overrides that', () => {
  const h = new Harness(5905);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const tok = spawn(h, A, 'Unit Token');                     // 1/1
  whiteBox(h, e => e.setBase(e.entity(tok)!, 9, 9));
  assert.deepEqual(effStats(h, tok), [9, 9]);
  spawn(h, A, 'Aberrant Statweaver');                        // later source
  assert.deepEqual(effStats(h, tok), [3, 3], 'the newcomer rewrites it again');
});

test('a rewrite is until-regroup; the Statweaver underneath it survives regroup', () => {
  const h = new Harness(5906);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const whale = spawn(h, A, 'Good Whale');                   // 7/5
  whiteBox(h, e => e.addCounters(e.entity(whale)!, 3));      // so a base 0 defense is survivable
  spawn(h, A, 'Aberrant Statweaver');
  assert.deepEqual(effStats(h, whale), [6, 6], 'base 3/3 + 3 counters');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  giveResources(h, A, 'metal', 2);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Unstable Refactor') });
  pick(h, { unit: whale });
  pass(h); pass(h);
  assert.deepEqual(baseOf(h, whale), [5, 0], 'the spell is the later rewrite');
  assert.deepEqual(effStats(h, whale), [8, 3], 'base 5/0 + 3 counters');
  finishBattle(h);
  // the stamp is cleared at regroup; the static never was a stamp, so it is
  // simply still radiating on the other side
  assert.deepEqual(baseOf(h, whale), [3, 3], 'the Statweaver has it again');
  assert.deepEqual(effStats(h, whale), [6, 6]);
});

/* ── the converted one-shots ───────────────────────────────────────────── */

test('Unstable Refactor twice: the second RE-bases, it does not compound', () => {
  const h = new Harness(5907);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const mine = spawn(h, A, 'Unit Token');                    // 1/1
  whiteBox(h, e => e.addCounters(e.entity(mine)!, 4));       // 5/5 — survives a 0 base
  giveResources(h, A, 'metal', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  for (let i = 0; i < 2; i++) {
    h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Unstable Refactor') });
    pick(h, { unit: mine });
    pass(h); pass(h);
  }
  // as a delta the second cast added another (5 − 5)/(−0)… off the CURRENT
  // base, which drifted: the base is a single number, so it cannot drift
  assert.deepEqual(baseOf(h, mine), [5, 0], 'still base 5/0 after two casts');
  assert.deepEqual(effStats(h, mine), [9, 4], 'base 5/0 + its 4 counters');
  finishBattle(h);
  assert.deepEqual(effStats(h, mine), [5, 5], 'the rewrite ends at regroup');
});

test('Celestial Shifter twice: the later X replaces the earlier one', () => {
  const h = new Harness(5908);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const sh = spawn(h, A, 'Celestial Shifter');               // 2/2
  giveResources(h, A, 'metal', 7);
  h.do({ type: 'activateAbility', seat: A, entityId: sh, abilityIndex: 0, via: 'augment' });
  // R196: the [x] is a `payMana` cast cost, paid a point at a time
  for (let k = 0; k < 5; k++) pick(h, { payMana1: true });
  pick(h, { doneCost: true });
  assert.deepEqual(baseOf(h, sh), [5, 5], 'base 5/5');
  h.do({ type: 'activateAbility', seat: A, entityId: sh, abilityIndex: 0, via: 'augment' });
  // only [2] are left, so the cost closes itself at X = 2 with no "that's
  // enough" to answer — a variable cost stops when nothing more can be paid
  pick(h, { payMana1: true }); pick(h, { payMana1: true });
  // as a delta this was 2 + (5−2) + (2−2) = 5 power: the second, SMALLER X
  // could not shrink it, because it re-derived off the printed 2/2
  assert.deepEqual(baseOf(h, sh), [2, 2], 'the later, smaller X wins');
  assert.deepEqual(effStats(h, sh), [2, 2]);
});

test('Floral Singularity: every one of your units is base X/X, whatever it was', () => {
  const h = new Harness(5909);
  toDeployment(h);
  const p: Seat = h.state.deployPlayer!;
  const whale = spawn(h, p, 'Good Whale');                   // 7/5
  const tok = spawn(h, p, 'Unit Token');                     // 1/1
  whiteBox(h, e => e.addCounters(e.entity(tok)!, 1));
  whiteBox(h, e => {
    const ctx: EffectCtx = {
      controller: p, sourceName: 'Floral Singularity', region: e.homeRegion(p),
      targets: [], x: 4, event: null,
      eraseSelf: () => {},   // no stack item here — a direct-run ctx
      choose: () => 'base',
    };
    getCard('Floral Singularity').spellEffect!.run(e, ctx);
  });
  assert.deepEqual(baseOf(h, whale), [4, 4], 'the 7/5 is base 4/4');
  assert.deepEqual(baseOf(h, tok), [4, 4], 'the 1/1 is base 4/4');
  assert.deepEqual(effStats(h, tok), [5, 5], 'its counter still applies on top');
});

test('Borrower of Forms copies the base a unit HAS, not the one it was printed with', () => {
  const h = new Harness(5910);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Good Whale');                  // printed 7/5
  spawn(h, D, 'Aberrant Statweaver');                        // …but base 3/3 right now
  giveResources(h, A, 'metal', 7);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
  pick(h, { unit: victim });
  pass(h); pass(h);                                         // resolve: erase + spawn
  pass(h); pass(h);                                         // resolve the become-a-copy trigger
  assert.ok(!ent(h, victim), 'the victim is erased');
  const bof = unitsOf(h, A).find(u => u.card === 'Borrower of Forms')!;
  assert.deepEqual(effStats(h, bof.id), [3, 3], 'it borrows the 3/3 body, not the printed 7/5');
  finishBattle(h);
});

/* ── the cards that ASK about a base ───────────────────────────────────── */

test('Unmake: a rewrite can drop a unit INTO "base power 2 or less"', () => {
  const h = new Harness(5911);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');                   // printed 7/5 — far out of range
  // D's own Floral Singularity for X = 2 re-bases their board to 2/2
  whiteBox(h, e => {
    const ctx: EffectCtx = {
      controller: D, sourceName: 'Floral Singularity', region: e.homeRegion(D),
      targets: [], x: 2, event: null,
      eraseSelf: () => {},   // no stack item here — a direct-run ctx
      choose: () => 'base',
    };
    getCard('Floral Singularity').spellEffect!.run(e, ctx);
  });
  assert.deepEqual(baseOf(h, whale), [2, 2], 'base power 2 now');
  giveResources(h, A, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Unmake') });
  pick(h, { unit: whale });
  pass(h); pass(h);
  assert.ok(!ent(h, whale), 'a printed 7/5 is Unmakeable once its base says 2');
  finishBattle(h);
});

test('Unmake: a rewrite can lift a unit OUT of range', () => {
  const h = new Harness(5912);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Trashling');                      // base 2/2, a legal target
  const tok = spawn(h, D, 'Unit Token');                     // base 1/1 — in range
  whiteBox(h, e => e.addCounters(e.entity(tok)!, 4));        // 5/5; base still 1/1
  giveResources(h, A, 'metal', 4);                           // Refactor + Unmake @ m/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Unstable Refactor') });
  pick(h, { unit: tok });
  pass(h); pass(h);
  assert.deepEqual(baseOf(h, tok), [5, 0], 'base power 5 now');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Unmake') });
  notOffered(h, { unit: tok }, 'the rewrite put its base power at 5');
  pick(h, { unit: atk });                                    // the one still in range
  pass(h); pass(h);
  assert.ok(ent(h, tok), 'and it survives');
  finishBattle(h);
});

test('Leave None Pure: a rewritten base counts as a stat change', () => {
  const h = new Harness(5913);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const clean = spawn(h, D, 'Good Whale');
  const rewritten = spawn(h, D, 'Lurking Slimebeast');       // 8/3
  // a rewrite to the SAME numbers is still a rewrite — effStats alone cannot
  // see it, which is why the purity check reads layer 2 directly
  whiteBox(h, e => e.setBase(e.entity(rewritten)!, 8, 3));
  assert.deepEqual(effStats(h, rewritten), [8, 3], 'it looks untouched');
  giveResources(h, A, 'dark', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Leave None Pure') });
  notOffered(h, { unit: rewritten }, 'its base was rewritten — that is a stat change');
  pick(h, { unit: clean });
  pass(h); pass(h);
  assert.ok(!ent(h, clean), 'the untouched one is deleted');
  assert.ok(ent(h, rewritten), 'the rewritten one is not');
  finishBattle(h);
});

/* ── what the player is told ───────────────────────────────────────────── */

test('the text box says "is base 3/3", not a +0/+0 projection', () => {
  const h = new Harness(5914);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const whale = spawn(h, A, 'Good Whale');
  spawn(h, A, 'Aberrant Statweaver');
  const e = new E(h.state);
  const box = entityTextBox(e, ent(h, whale)!);
  const line = box.lines.find(l => l.from === 'Aberrant Statweaver');
  assert.ok(line, 'the Statweaver is credited on the whale');
  assert.match(line!.text, /is base 3\/3/, 'as a replacement, not a delta');
  assert.ok(!/\+|−|-\d/.test(line!.text), `no signed delta in "${line!.text}"`);
});

test('the stat breakdown attributes the rewrite to the card that made it', () => {
  const h = new Harness(5915);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const whale = spawn(h, A, 'Good Whale');
  spawn(h, A, 'Aberrant Statweaver');
  whiteBox(h, e => e.addCounters(e.entity(whale)!, 1));
  const e = new E(h.state);
  const b = statBreakdown(e, ent(h, whale)!);
  assert.deepEqual(b.printed, [7, 5]);
  assert.deepEqual(b.base, [3, 3]);
  assert.deepEqual([b.power, b.toughness], [4, 4]);
  const rewrite = b.parts.find(p => /base rewritten/.test(p.label))!;
  assert.ok(rewrite, 'the rewrite is one line');
  assert.match(rewrite.label, /Aberrant Statweaver/, 'and it names the culprit');
  assert.equal(b.parts.filter(p => /base rewritten/.test(p.label)).length, 1,
    'one line for the whole of layer 2, however many setters there are');
});

test('the breakdown does not credit a base-setter that was overridden', () => {
  const h = new Harness(5916);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const whale = spawn(h, A, 'Good Whale');
  spawn(h, A, 'Aberrant Statweaver');
  whiteBox(h, e => e.setBase(e.entity(whale)!, 6, 6));       // later, so it wins
  const e = new E(h.state);
  const b = statBreakdown(e, ent(h, whale)!);
  assert.deepEqual(b.base, [6, 6]);
  const rewrite = b.parts.find(p => /base rewritten/.test(p.label))!;
  assert.match(rewrite.label, /base rewritten to 6\/6/);
  assert.ok(!/Aberrant Statweaver/.test(rewrite.label),
    `the Statweaver lost the layer, so it is not blamed: "${rewrite.label}"`);
});
