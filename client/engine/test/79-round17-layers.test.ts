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
import { allCardNames, getCard, radiantList } from '../src/cards/dsl.ts';
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

/* ── R226: {Tough} + {Inverted} — the two-attribute case ───────────────────
 *
 * Playtest report #114 (FHDY, 2026-08-27): "Why did my Nectar Oracle die
 * there? It should have been an inverted and tough 1/3. I don't think that
 * tough works like that." — and #115, twenty-nine minutes later, RETRACTING
 * it and stating the rule while he did:
 *
 *   "Ignore that last comment about tough. That is actually how tough works.
 *    So tough + inverted always kills the unit since +0/+X is just -0/-X
 *    where X is its exact defense"
 *
 * There is no defect. The engine already agreed with him, so the work is to
 * pin the interaction rather than change it. What the tests below add is the
 * one thing his sentence gets WRONG, and it is worth being exact about,
 * because a test written to the literal words "always kills the unit" would
 * pin a false generalisation into the suite.
 *
 * THE LAW, as measured off effStats and not as paraphrased:
 *
 *   let Δ = the NET layer-3 defense change (counters + tempToughness + every
 *           dp/dt static), i.e. everything between base and layer 4.
 *
 *     layer 3  t = baseT + Δ
 *     layer 4  t = 2·(baseT + Δ)                       {Tough} doubles
 *     layer 5  t = 2·baseT − 2·(baseT + Δ) = −2Δ       {Inverted} negates the
 *                                                      delta from base
 *
 *   FINAL DEFENSE = −2Δ. The base cancels out completely — which is exactly
 *   his insight, said precisely: {Tough} contributes +0/+baseT+Δ, {Inverted}
 *   flips the whole accumulated change, and the doubled defense eats its own
 *   base. Power is untouched by {Tough} and so merely flips: p = baseP − Δp.
 *
 *   Δ ≥ 0 → t ≤ 0 → dies (checkDeaths kills on `t <= 0`). That is EVERY
 *           ordinary board — an untouched unit, a buffed unit, a damaged unit
 *           — which is why "always" felt true and why it is safe to teach.
 *   Δ < 0 → t = 2|Δ| > 0 → IT LIVES, and bigger than it started. A base 1/3
 *           carrying one -1/-1 counter comes out a 2/2.
 *
 * So: "tough + inverted kills the unit" is right for every board where the
 * unit has not been SHRUNK, and is the special case of `t = −2Δ` at Δ ≥ 0.
 * Ruling R226.
 */

test('R226: report #114 — the owner\'s Nectar Ridge Oracle, and the damage was never load-bearing', () => {
  // The real FHDY shape, both seats: the OPPONENT's Rampart Guardian ({Tough},
  // {Virus}) lands on the attacking Oracle, and then the owner's OWN Reality
  // Bender ({Inverted}, {Virus}) finishes it. He did not lose the unit to the
  // opponent's card — the opponent only loaded the gun.
  const h = new Harness(7907);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const oracle = spawn(h, A, 'Nectar Ridge Oracle');   // printed 1/3
  assert.deepEqual(effStats(h, oracle), [1, 3], 'printed 1/3 — "an inverted and tough 1/3"');
  giveResources(h, A, 'earth', 2);                    // Reality Bender: e / 2
  giveResources(h, D, 'earth', 2);                    // Rampart Guardian: e / 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[oracle]] });

  pass(h);                                            // the attacker's window
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Rampart Guardian'), hostId: oracle });
  pass(h); pass(h);                                   // resolve the virus
  assert.ok(ownAttrs(h, oracle).has('Tough'), 'the defender\'s virus donated {Tough}');
  assert.deepEqual(effStats(h, oracle), [1, 6], 'Tough: +0/+3, the 1/3 stands as a 1/6');

  // ⚠ THE ASSERTION THE REPORT NEEDS. The FHDY log has a Seismomancy for 3 on
  // this unit a few actions earlier, and the natural story is "3 damage plus
  // something finished it". It did not: 3 < 6, the Oracle survived that, and
  // the unit dies below at ZERO damage. Asserted, not assumed.
  assert.equal(ent(h, oracle)!.damage, 0, 'undamaged — nothing below is a damage kill');
  // and the counterfactual, because the 3 damage is the obvious suspect and it
  // is the wrong one: mark it and the Oracle is still fine, 3 < 6.
  const damaged = new E(structuredClone(h.state));
  damaged.entity(oracle)!.damage = 3;
  damaged.settle();
  assert.ok(damaged.entity(oracle),
    'the log\'s Seismomancy for 3 into a 1/6 SURVIVES — checkDeaths kills on damage >= t');

  // What the number IS at the instant {Inverted} lands, read before the
  // state-based check gets to it. `2·3 − 6 = 0`: the doubled defense ate its
  // own base and there is nothing left. (Probed on a copy of the state so the
  // real board below is untouched.)
  const probe = new E(structuredClone(h.state));
  probe.addTempAttr(probe.entity(oracle)!, 'Inverted');
  assert.deepEqual(probe.effStats(probe.entity(oracle)!), [1, 0],
    'Tough then Inverted on an undamaged 1/3: t = 2·3 − 6 = 0');

  // and now for real, with his own card
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Reality Bender'), hostId: oracle });
  pass(h); pass(h);
  assert.equal(ent(h, oracle), undefined,
    "#115: 'tough + inverted always kills the unit' — his own Reality Bender did it");
  finishBattle(h);
});

test('R226: the special case his wording misses — a SHRUNK unit survives, at 2·|Δ|', () => {
  // "+0/+X is just -0/-X where X is its exact defense" is exact only while the
  // net layer-3 change is zero or positive. Shrink the unit first and the same
  // two attributes are a BUFF: final defense is −2Δ, so Δ = −1 gives 2.
  //
  // This is the test that stops "always kills the unit" from being written
  // into the suite as a law. If it ever goes red because the unit died, the
  // engine has adopted the paraphrase instead of the arithmetic.
  const h = new Harness(7908);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const u = spawnToken(h, p, 1, 3);                   // the Oracle's body
  ent(h, u)!.counters = -1;                           // Δ = −1
  assert.deepEqual(effStats(h, u), [0, 2], 'a 1/3 with one -1/-1 counter');

  giveResources(h, p, 'earth', 4);                    // e/2 each
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Rampart Guardian'), hostId: u });
  assert.deepEqual(effStats(h, u), [0, 4], 'Tough doubles the SHRUNK defense, not the base');
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Reality Bender'), hostId: u });
  assert.ok(ent(h, u), 'ALIVE — the interaction is not unconditional');
  assert.deepEqual(effStats(h, u), [2, 2],
    'final defense = −2Δ = 2, and power flips to baseP − Δp = 1 − (−1) = 2');

  // and the law itself, swept rather than asserted at one point: with {Tough}
  // and {Inverted} both on, the defense depends on NOTHING but Δ — the base
  // cancels out of `2·baseT − 2·(baseT + Δ)` entirely. Probed on copies so one
  // board answers for the whole range.
  const defenseAt = (delta: number): number => {
    const g = new E(structuredClone(h.state));
    const e = g.entity(u)!;
    e.counters = delta;
    return g.effStats(e)[1]!;
  };
  for (let d = -3; d <= 3; d++) {
    assert.equal(defenseAt(d), -2 * d || 0, `Δ=${d}: final defense is −2Δ, independent of the 3 base`);
    assert.equal(defenseAt(d) > 0, d < 0,
      `Δ=${d}: it lives iff the unit was SHRUNK — checkDeaths kills on t <= 0`);
  }
});

test('R226: the column wipe — {Inverted} on the front unit, {Tough} on the BACK, and both die', () => {
  // The consequence report #114 could not see, and the one that actually
  // matters at the table. Attributes are shared down a column (R19, and
  // calebgannon verbatim: "So, all attributes are shared between the units in
  // the same column? Including stuff like Inverted or Tough?" / "Yes"), so
  // two viruses that never touch the same body still compose on both bodies.
  // Two cards, a whole column gone, and neither card was aimed at the unit
  // that mattered.
  const h = new Harness(7909);
  toDeployment(h);
  const A = h.state.initiative;
  const front = spawnToken(h, A, 4, 4);
  const back = spawnToken(h, A, 6, 6);
  giveResources(h, A, 'earth', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[front, back]] });

  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Reality Bender'), hostId: front });
  pass(h); pass(h);
  // Δ = 0 on both, so {Inverted} ALONE is a no-op — this is the half that
  // makes the wipe invisible until the second card lands.
  assert.deepEqual(effStats(h, front), [4, 4], '{Inverted} with nothing to invert changes nothing');
  assert.deepEqual(effStats(h, back), [6, 6], 'and the column-mate shares an equally inert {Inverted}');
  // `ownAttrs` is what the unit ITSELF carries; the sharing lives one level up,
  // in the column walk `statLayerAttrs`/`effAttrs` runs. The back unit does not
  // OWN {Inverted} and is Inverted all the same, which is exactly why a player
  // cannot see this coming by reading the two bodies.
  assert.ok(!ownAttrs(h, back).has('Inverted'), 'the back unit does not own it…');
  assert.ok(new E(h.state).effAttrs(ent(h, back)!).has('Inverted'), '…and has it anyway');

  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Rampart Guardian'), hostId: back });
  pass(h); pass(h);
  assert.equal(ent(h, back), undefined, 'the {Tough} host dies: 2·6 − 12 = 0');
  assert.equal(ent(h, front), undefined,
    'AND the front unit dies, having been touched by neither card in the sequence');
  finishBattle(h);
});

test('R226: {Unaware} beats both — layer 6 returns the printed numbers', () => {
  // The documented escape. R106 made {Unaware} stat layer 6 and it RETURNS
  // printedStats, discarding layers 2-5 wholesale, so it does not "undo" the
  // Tough/Inverted pair so much as never reach it. Bubb is the [Augment]
  // donor; Trashling and Haboob carry the same attribute.
  const h = new Harness(7911);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const u = spawn(h, p, 'Nectar Ridge Oracle');       // the report's own unit
  giveResources(h, p, 'earth', 8);                    // Bubb e/4, then e/2 + e/2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Bubb'), hostId: u });
  assert.ok(ownAttrs(h, u).has('Unaware'), 'Bubb\'s type-line [Augment] donated {Unaware}');

  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Rampart Guardian'), hostId: u });
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Reality Bender'), hostId: u });
  assert.ok(ent(h, u), 'ALIVE with both killers attached');
  assert.deepEqual([...ownAttrs(h, u)].sort(), ['Inverted', 'Tough', 'Unaware'],
    'all three really are on it — the escape is the layer, not a missing attribute');
  assert.deepEqual(effStats(h, u), [1, 3],
    "layer 6 returns printed: 'it looks ONLY at what is the literal printed text'");
});

test('R226: the TWO-attribute case, in either grant order — a 1/4 Tough Inverted is a 1/0', () => {
  // The gap this file had. Caleb's THREE-attribute example (Tough Balanced
  // Inverted → -6/0) is pinned above and is the one he did the arithmetic for;
  // the pair that actually turns up in games was pinned nowhere, and report
  // #114 is what happens when a player meets it for the first time.
  //
  // ORDER-INDEPENDENCE is the substantive claim here, not decoration. R93
  // shipped {Inverted} as a clean layer 5 over an ⚠ OPEN note in effStats:
  // Caleb said "Tough inverted balanced would be different" from "tough
  // balanced inverted", which would make {Inverted} an interleaved member of
  // layer 4's type-line order instead. With only these TWO attributes the two
  // readings cannot be told apart by the answer — but they CAN be told apart
  // by whether the answer moves when the grant order flips, and under the
  // shipped layering it must not. If this ever goes red, layer 5 has been
  // reopened; go read that note before touching anything.
  const h = new Harness(7912);
  toDeployment(h);
  const p = h.state.deployPlayer!;

  const walk = (order: ('Tough' | 'Inverted')[]): [number, number] => {
    const u = spawnToken(h, p, 1, 4);                 // Caleb's own base
    assert.deepEqual(effStats(h, u), [1, 4], 'base 1/4');
    for (const a of order) {
      const e = new E(h.state);
      e.addTempAttr(e.entity(u)!, a);                 // no settle: read the number, not the corpse
      h.state = e.s;
    }
    return effStats(h, u);
  };
  assert.deepEqual(walk(['Tough', 'Inverted']), [1, 0],
    'Tough then Inverted: 4 → 8 → 2·4 − 8 = 0');
  assert.deepEqual(walk(['Inverted', 'Tough']), [1, 0],
    'Inverted then Tough is the SAME — layer 5 is a layer, not a step in the type-line order');
});

test('R226: the rest of the class — the Omniphage kills itself, and Beyond aims {Tough} at its own board', () => {
  // The two class members that reach the interaction without anybody playing
  // a virus at anything.
  const h = new Harness(7913);
  toDeployment(h);
  const p = h.state.deployPlayer!;

  // "[Augment] I gain all attributes of units in your bin." — one static per
  // attribute, live at every evaluation. The Omniphage does not need an
  // opponent: it needs a bin.
  const omni = spawn(h, p, 'The Omniphage');          // printed 5/5, Δ = 0
  assert.deepEqual(effStats(h, omni), [5, 5], 'an empty-enough bin: printed 5/5');
  h.state.players[p]!.bin.push('Rampart Guardian');
  assert.deepEqual(effStats(h, omni), [5, 10], 'a {Tough} unit card in the bin doubles it');
  h.state.players[p]!.bin.push('Reality Bender');
  assert.deepEqual(effStats(h, omni), [5, 0], 'and an {Inverted} one takes all of it back: 2·5 − 10');
  const e = new E(h.state); e.settle(); h.state = e.s;
  assert.equal(ent(h, omni), undefined, 'it dies to its own bin, with no card played at it');

  // "Your units are {g}inverted." — Beyond turns any {Tough} anywhere near its
  // controller's board into targeted removal AGAINST that controller.
  const h2 = new Harness(7914);
  toDeployment(h2);
  const q = h2.state.deployPlayer!;
  const beyond = spawn(h2, q, 'Beyond, Codex Incarnate');
  const whale = spawn(h2, q, 'Good Whale');           // printed 7/5
  assert.ok(ownAttrs(h2, whale).has('Inverted'), '"your units are inverted" reaches every one of them');
  assert.deepEqual(effStats(h2, whale), [7, 5], 'inert on its own: Δ = 0');
  assert.deepEqual(effStats(h2, beyond), [8, 3], 'Beyond inverts ITSELF too, equally harmlessly');
  giveResources(h2, q, 'earth', 2);
  h2.do({ type: 'augment', seat: q, from: 'hand', index: give(h2, q, 'Rampart Guardian'), hostId: whale });
  assert.equal(ent(h2, whale), undefined,
    'a {Tough} augment on your own unit is now a kill spell: 2·5 − 10 = 0');
  assert.ok(ent(h2, beyond), 'Beyond itself is untouched — it never gained {Tough}');
});

test('R226: the class is FIVE cards, computed from the pool and not typed from the report', () => {
  // docs/13 §7.2, "derive, never enumerate". The interaction needs {Tough} and
  // {Inverted} on one unit (or one column), so the class is every card that
  // can put either attribute onto a body. Recomputed here from printed data
  // and the behaviour definitions, so a sixth card entering the pool reddens
  // this test instead of quietly widening an interaction nobody re-checked.
  const grantors = (attr: 'Tough' | 'Inverted'): string[] => allCardNames().filter(n => {
    const c = getCard(n) as unknown as {
      attrs?: string[]; augmentAttrs?: string[]; statics?: { attrs?: string[] }[];
    };
    return !!c.attrs?.includes(attr)
      || !!c.augmentAttrs?.includes(attr)
      || radiantList(n, 'statics').some(s => s.attrs?.includes(attr));   // R268: body + box
  }).sort();

  assert.deepEqual(grantors('Tough'), ['Rampart Guardian', 'The Omniphage'],
    '{Tough}: one printed/[Augment] virus, plus the Omniphage\'s per-attribute bin static');
  assert.deepEqual(grantors('Inverted'),
    ['Beyond, Codex Incarnate', 'Its Dark Bubb', 'Reality Bender', 'The Omniphage'],
    '{Inverted}: two bodies, one [Augment] virus, one "your units are inverted" static');

  // Its Dark Bubb CAN be donated: its scan prints the type-line [Augment] the
  // transcription had lost (restored 2026-09-25 — this used to assert []). It
  // is no {Virus}, though, so it only ever lands on its controller's OWN units
  // — which is still why the report's shape, an {Inverted} arriving on an
  // opponent's unit, needed Reality Bender.
  assert.deepEqual(getCard('Its Dark Bubb').augmentAttrs, ['Inverted'],
    'Its Dark Bubb donates {Inverted} as an augment mod');
  assert.equal(getCard('Its Dark Bubb').virus, false,
    '…but never to an opponent: it is not a {Virus}');
  // and the escapes, also derived: {Unaware} (layer 6) and the strippers.
  const unaware = allCardNames().filter(n => getCard(n).attrs.includes('Unaware')).sort();
  assert.deepEqual(unaware, ['Bubb', 'Haboob', 'Trashling'], 'the layer-6 escape hatches');
  const strippers = allCardNames().filter(n => /loses? all attributes/i.test(getCard(n).text)).sort();
  assert.deepEqual(strippers, ['Formless', 'Monke', 'Suppression Field', 'Transmogrifant'],
    'the other escape: take an attribute away and the composition never happens');
});
