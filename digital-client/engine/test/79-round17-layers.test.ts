/* Round 17 — the layers and seams the owner's four "deck enabler" reports and
 * playtest report #73 landed on, each one a thing the engine had a comment
 * for and no code in.
 *
 *   · STAT LAYER 5, {Inverted} (R93) — playtest #73: "Inverted isn't working
 *     on my Malformed Monstrosity. -7/-7 should become +7/+7, making it a
 *     17/16". effStats() literally ended on "// layer 5 (Inverted), 6
 *     (Unaware) go here"; three cards in the pool (Its Dark Bubb, Reality
 *     Bender, and every unit either one touches) were the attribute and
 *     nothing else.
 *
 * Seeds 7900-7999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { EntityId, Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass,
  spawn, toDeployment, toNextBattle,
} from './util.ts';

/** spawn a stat token (no triggers) into a seat's home region */
function spawnToken(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const e = new E(h.state);
  const u = e.spawnUnit(seat, 'Unit Token', e.homeRegion(seat), { token: true, tokenStats: [p, t] });
  e.settle();
  return u.id;
}

/* ── R94: an EFFECT reads its source's LIVE attributes ─────────────────────
 *
 * `dealEffectDamageAll` opened on `this.card(ctx.sourceName)?.attrs` — the
 * PRINTED card — so a unit that GAINED {Powerful} hit twice as hard with its
 * body (combat damage has always read the live entity through colAttrs →
 * ownAttrs → staticsFor) and exactly as hard as before with its own damage
 * ability. The designer scales a unit-sourced noncombat effect by that unit's
 * {Powerful}, RAQ "[Solved] Resonant, Combat Damage, Conduit and Powerful":
 * "2/4 Resonant Powerful would deal 4 combat damage to enemy unit and then put
 * effect on stack to deal 8 damage to enemy face."
 */

test('R94: a unit\'s own damage ability reads the {Powerful} it was GRANTED, not its printed attrs', () => {
  // Roving Quillback: "[Augment] Whenever blockers are declared, I deal 1
  // damage to each opponent per blocked column" — a unit-sourced NONCOMBAT
  // effect, printed with no attributes. Emberflame Enlightener's units half
  // grants it {Powerful}. Nine cards in the pool are shaped like this (Soul
  // Reaver, Deformant, Bloated Manablub, Verdant Necrophage, Cthyrian Culler,
  // Nectar Ridge Oracle, Restitution, Seismomancy, Mirrorback Ambusher).
  const h = new Harness(7910);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const quill = spawn(h, A, 'Roving Quillback');
  const ember = spawn(h, A, 'Emberflame Enlightener');
  const blocker = spawn(h, D, 'Unit Token');
  const life = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[quill], [ember]] });
  pass(h); pass(h);                                   // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  // one blocked column → "1 damage to each opponent", doubled to 2 because the
  // Quillback is standing in its own Enlightener's aura
  while (h.state.stack.length) { pass(h); pass(h); }
  assert.ok(ownAttrs(h, quill).has('Powerful'), 'the Quillback was granted {Powerful}');
  assert.equal(h.state.players[D]!.life, life - 2,
    'the ability deals 2, not the printed 1 — the source is read live');
  finishBattle(h);
});

/* ── STAT LAYER 5: {Inverted} ──────────────────────────────────────────────
 *
 * R93. "Invert the stat changes of inverted units. For example, -1/+2 would
 * become +1/-2." (Its Dark Bubb's own reminder text.)
 *
 * The operation is on the NET CHANGE FROM BASE. Caleb Gannon derived it in
 * rules-questions and checked it against the per-contribution reading:
 *
 *   "1/4 tough balanced is 8/8 — Tough is +0/+4, Balanced is +7/0. If we
 *    include inverted it gains +0/-4, -7/+0 → To become a -6/0"
 *   "If we compare 8/8 to 1/4, it's +7/+4"
 *   "Which also works to invert to a -6/0"
 *
 * so `2·base − current`, applied once, after layer 4.
 */

test('R93 layer 5: the owner\'s Malformed Monstrosity — a 10/9 at -7/-7 inverts to 17/16', () => {
  // Playtest report #73, room GETD, 2026-08-22: "Inverted isn't working on my
  // Malformed Monstrosity. -7/-7 should become +7/+7, making it a 17/16".
  // Monstrosity is printed 10/9 with a self-affecting -7/-7 static, so it
  // normally stands on the board as a 3/2; inverting the net -7/-7 gives
  // +7/+7 off the printed base, which is the 17/16 he asked for.
  const h = new Harness(7900);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const mm = spawn(h, p, 'Malformed Monstrosity');
  assert.deepEqual(effStats(h, mm), [3, 2], 'base 10/9 with its own -7/-7 static');

  // Reality Bender is the {Inverted} donor: "[Augment] {Inverted} Ancient
  // Anima {Virus} Unit" — its type-line [Augment] half hands the attribute to
  // whatever it is augmented onto.
  giveResources(h, p, 'earth', 2);                    // Reality Bender: e / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Reality Bender'), hostId: mm });
  assert.ok(ownAttrs(h, mm).has('Inverted'), 'the [Augment] half donated {Inverted}');
  assert.deepEqual(effStats(h, mm), [17, 16], "playtest #73: '-7/-7 should become +7/+7, making it a 17/16'");
});

test('R93 layer 5: Caleb\'s worked example — a 1/4 Tough Balanced Inverted is a -6/0', () => {
  // The example he did the arithmetic for himself, twice, both ways. It is
  // the reason layer 5 is a single net-delta negation rather than a walk back
  // down layer 4 undoing each attribute: he checked that they agree.
  const h = new Harness(7901);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const u = spawnToken(h, p, 1, 4);
  assert.deepEqual(effStats(h, u), [1, 4], 'base 1/4');

  // White-box, and deliberately without a settle: the answer is a 0 defense,
  // so the unit is dead the moment the board is checked. That is not a
  // problem with the arithmetic — Caleb walked this exact stack knowing it
  // ("(3 cards to shrink my unit from a 1/4 to a 1/1)") — it just means the
  // number has to be read before the death check, which is what effStats is.
  // The attrs go on in TYPE-LINE ORDER, which is layer 4's order (R19).
  const grant = (attr: 'Tough' | 'Balanced' | 'Inverted') => {
    const e = new E(h.state);
    e.addTempAttr(e.entity(u)!, attr);
    h.state = e.s;
  };
  grant('Tough');
  assert.deepEqual(effStats(h, u), [1, 8], 'Tough: +0/+4');
  grant('Balanced');
  assert.deepEqual(effStats(h, u), [8, 8], "'1/4 tough balanced is 8/8'");
  grant('Inverted');
  // "Tough is +0/+4, Balanced is +7/0 … It gains +0/-4, -7/+0 → To become a
  // -6/0", and the cross-check: "If we compare 8/8 to 1/4, it's +7/+4 —
  // Which also works to invert to a -6/0".
  assert.deepEqual(effStats(h, u), [-6, 0], "calebgannon: 'To become a -6/0'");
});

test('R93 layer 5: a base REWRITE is the thing inverted FROM, never inverted itself', () => {
  // Layer 2 redefines what base IS ("Your units are base 3/3" — Aberrant
  // Statweaver, R66), so it is not a "stat change" and {Inverted} must not
  // touch it. spikeydog_40883 in rules-questions: "Its base stats aren't being
  // inverted. Just the modifications to those stats by counters, stat-altering
  // augments, or attributes."
  //
  // ⚠ THIS ONE IS CONTESTED IN THE CORPUS AND THE OWNER SETTLED IT. Do not
  // "fix" this test by re-deriving the other reading — it has been considered
  // and rejected. _passer, who writes most of the [Solved] RAQ summaries, says
  // the OPPOSITE in rules-questions, twice and explicitly:
  //
  //   "Inverted looks at Printed base stats, looks what unit is 'currently'
  //    and invert the difference"
  //
  //   "So if there was 10/15 which base stats were changed to be 4/4 (Formless
  //    does this), it had +1/+1 counter, then: 10/15 → 4/4 → 5/5. If you invert
  //    it now it sees that total diff from original stat is -5/-10, so it
  //    traces back to original stats (10/15) and add inverted values (+5/+10)
  //    to 15/25"
  //
  // On this board that reading gives 15/25 where we give 3/3. Caleb never
  // addressed base rewrites — his own worked example (1/4 Tough Balanced
  // Inverted → -6/0, the test above) has no rewrite in it, so it does not
  // discriminate between the two readings. Bena ruled for THIS one on
  // 2026-08-22, having been shown both worked examples side by side. If it is
  // ever put to Caleb and he answers the other way, the change is one line in
  // effStats (compare against layer 1 instead of `base`) plus this test.
  const h = new Harness(7902);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const u = spawnToken(h, p, 7, 5);
  spawn(h, p, 'Aberrant Statweaver');                  // "your units are base 3/3"
  assert.deepEqual(effStats(h, u), [3, 3], 'layer 2 rewrote the base to 3/3');

  const e = new E(h.state);
  e.addTempAttr(e.entity(u)!, 'Inverted');
  e.settle(); h.state = e.s;
  assert.deepEqual(effStats(h, u), [3, 3],
    'nothing changed the base, so there is no change to invert — NOT 2·3−3 off the printed 7/5');

  // and with a real change on top of the rewritten base, it is THAT change
  // that flips: 3/3 with a +1/+1 counter is a 4/4, inverted a 2/2.
  ent(h, u)!.counters = 1;
  assert.deepEqual(effStats(h, u), [2, 2], "'Does inverted reverse the affect of +1/+1 Counters?' — 'yes'");
});

test('R93 layer 5: {Inverted} applies ONCE however many sources grant it', () => {
  // R19's rule for layer 4 is "an attribute is either present or not", and
  // layer 5 reads the same deduped list. Two Reality Benders on one host must
  // not cancel each other out into a double negation.
  const h = new Harness(7903);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  // Poison counters, so that inverting is a BUFF and the unit stays on the
  // board through both augments — the "Inverted + poison counters is good"
  // combo the channel kept coming back to.
  const u = spawnToken(h, p, 5, 5);
  ent(h, u)!.counters = -2;                           // → 3/3
  assert.deepEqual(effStats(h, u), [3, 3], '5/5 with two -1/-1 counters');

  giveResources(h, p, 'earth', 4);                    // two Reality Benders: e / 2 each
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Reality Bender'), hostId: u });
  assert.deepEqual(effStats(h, u), [7, 7], 'one {Inverted}: the -2/-2 becomes +2/+2');
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Reality Bender'), hostId: u });
  assert.deepEqual(effStats(h, u), [7, 7], 'a second {Inverted} does not invert back — duplicates do not stack');
});

test('R93 layer 5: {Inverted} is shared down the COLUMN, like every other attribute', () => {
  // Asked and answered verbatim —
  //   spikeydog_40883: "So, all attributes are shared between the units in
  //                     the same column? Including stuff like Inverted or Tough?"
  //   calebgannon:     "Yes"
  // and a player working the consequence out in the same channel: augmenting
  // Reality Bender onto a robot's column-mate kills the robot "because it
  // would share inverted attribute with" it.
  const h = new Harness(7904);
  toDeployment(h);
  const A = h.state.initiative;
  const front = spawnToken(h, A, 4, 4);
  const back = spawnToken(h, A, 6, 6);
  ent(h, front)!.counters = -2;                       // → 2/2
  ent(h, back)!.counters = -1;                        // → 5/5
  giveResources(h, A, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[front, back]] });
  assert.deepEqual(effStats(h, front), [2, 2], 'unshared: 4/4 -2/-2');
  assert.deepEqual(effStats(h, back), [5, 5], 'unshared: 6/6 -1/-1');

  // {Inverted} lands on the FRONT unit only, and the whole column has it
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Reality Bender'), hostId: front });
  pass(h); pass(h);                                   // resolve the virus
  assert.deepEqual(effStats(h, front), [6, 6], 'the host: -2/-2 inverted to +2/+2');
  assert.deepEqual(effStats(h, back), [7, 7], "its column-mate shares it: -1/-1 inverted to +1/+1");
  finishBattle(h);
});

test('R93 layer 5: hitting 0 mid-calculation is not death — the equation resolves first', () => {
  // calebgannon, asked whether a unit that passes through 0 toughness partway
  // through the layer walk dies there: "Not if it hits 0 mid calculation" /
  // "Doesn't instantly die", and the gloss he agreed with — "imagine it as one
  // big equation that has at the end 'and all of this = health'. It is not a
  // time thing… in the game no time passes inbetween."
  //
  // Malformed Monstrosity is the sharpest case in the pool: 10/9 with its own
  // -7/-7 gets to 3/2 and then to 17/16, and a 1/1 body carrying it would be
  // at -6 partway. Here: a 1/1 token driven to exactly 0/0 by counters, then
  // inverted back to 2/2 — the engine computes effStats atomically and checks
  // deaths afterwards, so nothing sees the 0.
  const h = new Harness(7905);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const u = spawnToken(h, p, 1, 1);
  giveResources(h, p, 'earth', 2);
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Reality Bender'), hostId: u });
  ent(h, u)!.counters = -1;                           // 1/1 → 0/0 before layer 5
  const e = new E(h.state);
  e.settle();                                          // the death check runs here
  h.state = e.s;
  assert.ok(ent(h, u), 'alive: the -1/-1 inverted to +1/+1, and 0 was never a state the board was in');
  assert.deepEqual(effStats(h, u), [2, 2], 'a 1/1 with a -1/-1 counter, inverted, is a 2/2');
});

test('R93 layer 5: Its Dark Bubb — the whole card is the attribute, and it works now', () => {
  // "{Inverted} Slime Unit", d/4, 4/6, with reminder text and nothing else:
  // "(Invert the stat changes of inverted units. For example, -1/+2 would
  // become +1/-2.)" card('Its Dark Bubb', {}) is the CORRECT definition — the
  // card is the type line — which is exactly why nothing in the suite could
  // notice it was dead.
  const h = new Harness(7906);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const bubb = spawn(h, p, 'Its Dark Bubb');
  assert.ok(ownAttrs(h, bubb).has('Inverted'), 'prints {Inverted}');
  assert.deepEqual(effStats(h, bubb), [4, 6], 'no stat changes yet: printed 4/6');
  ent(h, bubb)!.counters = -2;                        // a poison-counter play
  assert.deepEqual(effStats(h, bubb), [6, 8],
    'the reminder text, literally: a -2/-2 becomes a +2/+2');
});
