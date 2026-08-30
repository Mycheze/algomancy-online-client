/**
 * ATTRIBUTE INTERACTIONS — every attribute that changes how damage lands,
 * exercised OUTSIDE combat and in combination with other attributes.
 *
 * WHY THIS FILE EXISTS
 *
 * The owner, 2026-08-23, naming the shape of the bug he keeps hitting:
 *
 *   "For units with attributes, you should make sure its attributes work
 *    alongside other effects (ie deadly on something that deals 2 damage to
 *    anything is enough to kill, piercing is done even when its on a
 *    non-combat effect, etc)."
 *
 * That is a real gap in what the suite covered. `09-attrs.test.ts` tests
 * Powerful / Vulnerable / Poisonous / Resonant / Thieving, and mostly through
 * COMBAT. The attributes that matter here are the ones read by
 * `E.dealEffectDamageAll` — the batch every non-combat damage source in the
 * game goes through — and whether they are honoured there had never been
 * asserted card-by-card.
 *
 * The distinction that makes these tests worth having: an attribute reaches
 * effect damage through `srcAttrs`, which is the SOURCE ENTITY's live
 * `ownAttrs` (or the printed card's attrs once the body is gone, so a "when I
 * die" ping still carries them), unioned with R79's `ctx.grantedAttrs` — the
 * attributes a VIRUS donated to the effect while it sat on the stack. Three
 * different provenances, one set, and each is asserted below, because a fix
 * that only reads the printed card is a fix that breaks the virus case.
 *
 * {PIERCING} — the owner's own second example — is asserted below as of
 * 2026-08-23, when he settled what it does off the column: "It redirects
 * excess damage to that unit's controller (not as a trigger, just as part of
 * resolution of the damage)." That closed CARD-TODO #4. The tests in the
 * PIERCING section are the specification: the split is asserted on both sides
 * (what stuck to the unit, what reached the life total), because an
 * implementation that pierces the WHOLE amount and one that pierces the right
 * remainder both make a life total drop.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  effStats, ent, ownAttrs, pass, spawn, toDeployment, toNextBattle, absorb,
} from './util.ts';
import type { Attr, EngineEvent, EntityId, Seat } from '../src/types.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Deal effect (NON-COMBAT) damage from a real unit on the board.
 *
 * `sourceId` is what makes this the real thing rather than a simulation: the
 * engine reads the SOURCE ENTITY's live attributes, so a unit that has been
 * pumped, augmented or had an attribute granted to it is judged as it stands
 * now — which is the whole point of the exercise.
 */
function dealFrom(
  h: Harness, controller: Seat, sourceId: EntityId, targetId: EntityId, n: number,
  grantedAttrs?: Attr[],
): EngineEvent[] {
  return dealAllFrom(h, controller, sourceId, [{ id: targetId, n }], grantedAttrs);
}

/**
 * The same thing for a MULTI-recipient effect — one batch, several victims,
 * which is the shape R80 exists for and the shape {Piercing} has to get right
 * when more than one of them overkills.
 *
 * Returns the batch's events so a test can assert on the engine's EVENT
 * VOCABULARY (a 'damage' event carrying `player`, `n` and the batch `total`)
 * rather than on log prose, which is one rewrite away from being wrong.
 */
function dealAllFrom(
  h: Harness, controller: Seat, sourceId: EntityId,
  hits: { id: EntityId; n: number }[], grantedAttrs?: Attr[],
): EngineEvent[] {
  const g = new E(h.state);
  const src = g.entity(sourceId)!;
  g.dealEffectDamageAll(
    {
      controller, sourceName: src.card, sourceId, region: g.homeRegion(controller),
      targets: [], event: null, grantedAttrs,
      eraseSelf: () => {},   // no stack item here — a direct-run ctx
      choose: () => { throw new Error('no choice expected'); },
    },
    hits.map(hit => ({ target: g.entity(hit.id)!, n: hit.n })));
  g.settle();
  h.state = g.s;
  absorb(h, g.events);
  return g.events;
}

/** the 'damage' events of a batch, split by what they landed on */
function damageTo(evs: EngineEvent[]): {
  units: { unit: EntityId; n: number; total: number }[];
  players: { player: Seat; n: number; total: number }[];
} {
  const dmg = evs.filter(e => e.type === 'damage').map(e => e.data ?? {});
  return {
    units: dmg.filter(d => 'unit' in d)
      .map(d => ({ unit: d['unit'] as EntityId, n: d['n'] as number, total: d['total'] as number })),
    players: dmg.filter(d => 'player' in d)
      .map(d => ({ player: d['player'] as Seat, n: d['n'] as number, total: d['total'] as number })),
  };
}

/** a board with one source unit for A and one victim for D */
function duel(seed: number, srcCard: string, tgtCard: string): {
  h: Harness; A: Seat; D: Seat; src: EntityId; tgt: EntityId;
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  return { h, A, D, src: spawn(h, A, srcCard), tgt: spawn(h, D, tgtCard) };
}

/**
 * The same board with a VANILLA STAT TOKEN as the victim.
 *
 * The RAQ answers this file quotes use "a 5/6 Bubb" as their stand-in for a
 * plain 5/6 body, and this file copied that. R106 (2026-08-23) shipped stat
 * layer 6 and Bubb stopped being a plain 5/6 body: {Unaware} means it ignores
 * every stat change, so a -1/-1 counter and a +1/+1-per-prevented-damage
 * shield are both INVISIBLE on it and the two assertions that measured a stat
 * layer through Bubb had nothing left to measure. The mechanics under test
 * (Poisonous places counters instead of damage; R98's shield pays out in
 * counters) are unchanged — the yardstick was.
 *
 * Where a test needs to READ a stat change off the victim, it uses this. Where
 * it only needs a 5/6 that dies or does not, Bubb is still fine and still
 * named, because the RAQ names it.
 */
function duelToken(seed: number, srcCard: string, p: number, t: number): {
  h: Harness; A: Seat; D: Seat; src: EntityId; tgt: EntityId;
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const src = spawn(h, A, srcCard);
  const g = new E(h.state);
  const tgt = g.spawnUnit(D, 'Unit Token', g.homeRegion(D), { token: true, tokenStats: [p, t] });
  g.settle();
  return { h, A, D, src, tgt: tgt.id };
}

// ── DEADLY ──────────────────────────────────────────────────────────────
// The owner's first example, verbatim: "deadly on something that deals 2
// damage to anything is enough to kill".

test('Deadly: 2 points of NON-COMBAT damage kills a 5/6 outright (the owner\'s example)', () => {
  const { h, A, src, tgt } = duel(7201, 'Carapace Devourer', 'Bubb');
  assert.deepEqual(effStats(h, tgt), [5, 6], 'Bubb is a 5/6 — 2 damage is nowhere near lethal');
  dealFrom(h, A, src, tgt, 2);
  assert.equal(ent(h, tgt), undefined,
    'R21: any NONZERO damage from a {Deadly} source kills, whatever the toughness — '
    + 'and it must hold for an effect exactly as it does in combat');
  assert.ok(h.log.some(l => /Carapace Devourer is Deadly — Bubb dies/.test(l)),
    'and it must SAY it was Deadly that did it, not merely delete the unit');
});

test('Deadly: ZERO damage kills nothing — "deadly" is not "destroy"', () => {
  const { h, A, src, tgt } = duel(7202, 'Carapace Devourer', 'Bubb');
  dealFrom(h, A, src, tgt, 0);
  assert.ok(ent(h, tgt), 'R98: no damage was dealt, so nothing happened — no Deadly kill');
  assert.equal(ent(h, tgt)!.damage, 0);
});

test('Deadly GRANTED by a virus reaches an effect the same way a printed one does', () => {
  // R79, Caleb 2025-03-06: "you can only do this with attributes — mostly
  // Deadly, Piercing, and Powerful are impacted by this, especially Deadly."
  // The Foretold is a vanilla 3/3 with no attributes at all, so a kill here can
  // only be the granted attribute.
  const { h, A, src, tgt } = duel(7203, 'The Foretold', 'Bubb');
  dealFrom(h, A, src, tgt, 2, ['Deadly']);
  assert.equal(ent(h, tgt), undefined, 'a virus-donated {Deadly} must kill through effect damage');
});

test('Deadly DOES kill through Poisonous — and the counter lands too (R237)', () => {
  // ⚠ THIS TEST USED TO ASSERT THE OPPOSITE, under the heading "Not a bug, and
  // worth pinning precisely because it looks like one". It was a bug. The old
  // note read "a {Poisonous} source deals its damage as permanent -1/-1
  // counters INSTEAD of marked damage, so no damage is dealt … and there is
  // nothing for {Deadly} to key off", and cited the Phytochemical Protection
  // RAQ for it — but that RAQ is about PREVENTION, and its FIRST line is
  // "Poisonous damage does count as damage being dealt."
  //
  // Caleb, 2023-08-23, asked this exact question ("If a unit has both deadly
  // and poisonous does it still get the deadly effect, or does 'deals damage in
  // -1/-1 counters' mean it doesn't deal damage to trigger deadly?"):
  //
  //   "yeah it'll get instakilled by deadly but also trigger to put counters
  //    on it"
  //
  // BOTH. R237 (owner, 2026-08-28: "deadly works on spell effects and
  // everything") is the ruling that landed the change; {Poisonous} is a FORM of
  // dealing damage, not a replacement of it.
  //
  // a 5/6 stat token rather than the RAQ's Bubb: R106 made Bubb {Unaware}, and
  // an Unaware unit ignores the -1/-1 this test exists to observe (see
  // duelToken).
  const { h, A, src, tgt } = duelToken(7204, 'Noxious Sporefiend', 5, 6);
  dealFrom(h, A, src, tgt, 1, ['Deadly']);
  assert.equal(ent(h, tgt), undefined,
    'the counter IS damage being dealt, so the Deadly kill lands — Caleb 2023-08-23');
  assert.ok(h.log.some(l => /gets 1 -1\/-1 counter/.test(l)),
    '"but also trigger to put counters on it": the counter went on before it died');
});

test('Deadly + Poisonous: PREVENTION still stops both halves (R98 is untouched)', () => {
  // The other side of the same RAQ, and the line R237 must not have broken:
  // "damage is dealt in the form of -1/-1 counters, which means if there is not
  // damage being dealt, then no counters are placed" — so a shielded victim
  // takes no counters AND takes no Deadly kill.
  const { h, A, src, tgt } = duelToken(7219, 'Noxious Sporefiend', 5, 6);
  const g = new E(h.state);
  g.entity(tgt)!.damageShield = 'Phytochemical Protection';
  dealFrom(h, A, src, tgt, 1, ['Deadly']);
  assert.ok(ent(h, tgt), 'no damage was dealt, so there was nothing for Deadly to kill through');
  assert.deepEqual(effStats(h, tgt), [6, 7],
    'and the prevented point paid out as a +1/+1 counter instead');
});

// ── POWERFUL ────────────────────────────────────────────────────────────

test('Powerful doubles NON-COMBAT damage, and stacks with a granted Deadly', () => {
  const { h, A, src, tgt } = duel(7205, 'Chitin Shredder', 'Bubb');
  dealFrom(h, A, src, tgt, 1, ['Deadly']);
  assert.ok(h.log.some(l => /Chitin Shredder deals 2 to Bubb/.test(l)),
    '{Powerful} doubles 1 → 2 before anything else reads the number');
  assert.equal(ent(h, tgt), undefined, 'and the granted {Deadly} then kills on that nonzero hit');
});

test('Powerful (source) and Vulnerable (receiver) both apply to one effect hit', () => {
  // Two doublings on opposite sides of the same damage, which is the case a
  // one-sided implementation gets wrong: 2 → 4 (Powerful) → 8 (Vulnerable).
  const { h, A, src, tgt } = duel(7206, 'Chitin Shredder', 'Crumbling Ancient');
  assert.deepEqual(effStats(h, tgt), [3, 8], 'Crumbling Ancient is a 3/8 {Vulnerable}');
  dealFrom(h, A, src, tgt, 2);
  assert.ok(h.log.some(l => /deals 8 to Crumbling Ancient/.test(l)),
    'source doubling and receiver doubling compose: 2 → 4 → 8');
  assert.equal(ent(h, tgt), undefined, 'which is exactly lethal on 8 toughness');
});

// ── BLESSED / REAPING / RESONANT: the riders ────────────────────────────

test('Blessed: an effect hit gains its controller that much life, before the lethal check', () => {
  const { h, A, D, src, tgt } = duel(7207, 'Shib', 'Bubb');
  const before = h.state.players[A]!.life;
  dealFrom(h, A, src, tgt, 4);
  assert.equal(h.state.players[A]!.life, before + 4, 'R48: the gain lands on the same state check as the damage');
  assert.equal(h.state.players[D]!.life, 30, "and it is the SOURCE's controller who gains, not the victim's");
});

test('Reaping: a kill by effect damage draws its controller a card', () => {
  const { h, A, src, tgt } = duel(7208, 'Flame of History', 'Unit Token');
  const before = h.state.players[A]!.hand.length;
  dealFrom(h, A, src, tgt, 3);
  assert.equal(ent(h, tgt), undefined);
  assert.equal(h.state.players[A]!.hand.length, before + 1,
    '{Reaping} pays out on a kill however the damage was dealt');
});

test('Resonant: the victim\'s controller loses that much life on top of the damage', () => {
  const { h, A, D, src, tgt } = duel(7209, 'Resonant Form', 'Bubb');
  dealFrom(h, A, src, tgt, 3);
  assert.equal(h.state.players[D]!.life, 27, 'the rider hits the unit\'s controller, not the caster');
  assert.equal(h.state.players[A]!.life, 30);
});

// ── PIERCING ────────────────────────────────────────────────────────────
// The owner's second example, verbatim: "piercing is done even when its on a
// non-combat effect", and his ruling on what it then does (2026-08-23): "It
// redirects excess damage to that unit's controller (not as a trigger, just as
// part of resolution of the damage)."
//
// Ruinbringer is a plain 8/9 {Piercing} body in play (its printed text is
// [Augment]-only), so every number below is the attribute and nothing else.

/** put a damage shield on a unit, the way Phytochemical Protection does */
function shield(h: Harness, id: EntityId): void {
  const g = new E(h.state);
  g.entity(id)!.damageShield = 'Phytochemical Protection';
  g.settle();
  h.state = g.s;
}

test('Piercing: 5 effect damage to a 1/1 kills it and the other 4 hit its controller', () => {
  const { h, A, D, src, tgt } = duel(7210, 'Ruinbringer', 'Unit Token');
  assert.deepEqual(effStats(h, tgt), [1, 1], 'a 1/1 — 1 point is lethal, 4 are excess');
  const evs = dealFrom(h, A, src, tgt, 5);
  assert.equal(ent(h, tgt), undefined, 'the unit still dies');
  assert.equal(h.state.players[D]!.life, 26, 'and the 4 it could not absorb reached ITS controller');
  assert.equal(h.state.players[A]!.life, 30, 'never the source\'s controller');
  // the split, asserted on both sides: a version that pierced the whole 5
  // would also drop a life total.
  const { units, players } = damageTo(evs);
  assert.deepEqual(units.map(u => u.n), [1], 'exactly lethal stuck to the unit');
  assert.deepEqual(players.map(p => [p.player, p.n]), [[D, 4]], 'the remainder, to that unit\'s controller');
  // "not as a trigger, just as part of resolution of the damage": one batch,
  // so both halves carry the same R80 `total` (1 + 4).
  assert.deepEqual([...units, ...players].map(e => e.total), [5, 5],
    'both halves belong to ONE damage resolution, not two');
});

test('Piercing: exactly lethal pierces nothing', () => {
  const { h, A, D, src, tgt } = duel(7211, 'Ruinbringer', 'Bubb');
  assert.deepEqual(effStats(h, tgt), [5, 6], 'Bubb is a 5/6, so 6 is exactly lethal');
  const evs = dealFrom(h, A, src, tgt, 6);
  assert.equal(ent(h, tgt), undefined);
  assert.equal(h.state.players[D]!.life, 30, 'there was no excess, so nothing carried over');
  assert.deepEqual(damageTo(evs).players, [], 'and no face damage event was invented');
});

test('Piercing: less than lethal pierces nothing and the unit lives', () => {
  const { h, A, D, src, tgt } = duel(7212, 'Ruinbringer', 'Bubb');
  const evs = dealFrom(h, A, src, tgt, 4);
  assert.equal(ent(h, tgt)!.damage, 4, 'all 4 stayed on the unit');
  assert.equal(h.state.players[D]!.life, 30);
  assert.deepEqual(damageTo(evs).players, [], 'Piercing is an OVERFLOW rule, not a redirect');
});

test('Piercing + Powerful: the excess is what is left after the doubling', () => {
  // Chitin Shredder is {Powerful}; the {Piercing} is donated. 4 → 8 at the
  // source, 6 of which Bubb needs, so 2 pierce. Computing the excess BEFORE
  // the doubling would pierce nothing at all (4 < 6).
  const { h, A, D, src, tgt } = duel(7213, 'Chitin Shredder', 'Bubb');
  const evs = dealFrom(h, A, src, tgt, 4, ['Piercing']);
  assert.equal(ent(h, tgt), undefined, 'the doubled 8 killed the 5/6');
  assert.equal(h.state.players[D]!.life, 28, '8 dealt − 6 lethal = 2 pierced');
  const { units, players } = damageTo(evs);
  assert.deepEqual(units.map(u => u.n), [6]);
  assert.deepEqual(players.map(p => p.n), [2]);
});

test('Piercing vs a Vulnerable victim: the excess is what is left after the RECEIVE-side doubling', () => {
  // Crumbling Ancient is a 3/8 {Vulnerable}: it RECEIVES double, so only 4 of
  // the pool are needed to kill it and 6 pierce. Pricing it at its raw 8
  // toughness would pierce only 2 — the receive-side doubling is why this is
  // the case an implementation gets wrong.
  const { h, A, D, src, tgt } = duel(7214, 'Ruinbringer', 'Crumbling Ancient');
  assert.deepEqual(effStats(h, tgt), [3, 8], 'a 3/8 {Vulnerable}');
  const evs = dealFrom(h, A, src, tgt, 10);
  assert.equal(ent(h, tgt), undefined);
  assert.equal(h.state.players[D]!.life, 24, '10 − 4 needed = 6 pierced');
  const { units } = damageTo(evs);
  assert.deepEqual(units.map(u => u.n), [8], 'and the unit was DEALT the doubled 8, not the 4 assigned');
});

test('Piercing vs a damage-shielded unit: the shield changes what is dealt, never what pierces', () => {
  // RAQ "[Solved] Excessive Combat Damage & interaction with Piercing, Deadly
  // and Phytochemical Protection", on a shielded unit standing in front of a
  // 5/6 Bubb: "Atleast 5 damage to Awoken (gets atleast +5/+5, won't create
  // 5/5), atleast 6 damage to Bubb, rest can go to Opponent HP." Assignment is
  // planned against the unit's REAL toughness as if it were unprotected, and
  // prevention runs afterwards, at commit (R98).
  // again a 5/6 stat token standing in for the RAQ's Bubb: R98 pays the shield
  // out in +1/+1 counters, and R106's {Unaware} would swallow them whole.
  const { h, A, D, src, tgt } = duelToken(7215, 'Ruinbringer', 5, 6);
  shield(h, tgt);
  dealFrom(h, A, src, tgt, 10);
  assert.equal(h.state.players[D]!.life, 26,
    'the 6 Bubb needed were still planned against its 6 toughness, so 4 pierced — '
    + 'a shield does not send MORE (or less) to the face');
  const survivor = ent(h, tgt)!;
  assert.equal(survivor.damage, 0, 'and none of the 6 was actually dealt');
  assert.deepEqual(effStats(h, tgt), [11, 12], 'R98: +1/+1 for each of the 6 prevented');
});

test('Piercing + Deadly: one point is all it needs, so almost the whole hit pierces', () => {
  // Same RAQ, the Deadly line: "Atleast 1 dmg to Awoken (gets +1/+1, won't
  // create 1/1 unit), rest of the damage can go to Bubb." One point is the
  // whole of what a Deadly source must spend on a victim, so 1 sticks and 4
  // carry on — NOT the 6 a non-Deadly source would have to spend first.
  const { h, A, D, src, tgt } = duel(7216, 'Ruinbringer', 'Bubb');
  const evs = dealFrom(h, A, src, tgt, 5, ['Deadly']);
  assert.equal(ent(h, tgt), undefined, 'Deadly killed the 5/6 on 1 damage');
  assert.equal(h.state.players[D]!.life, 26, 'and the other 4 pierced');
  const { units, players } = damageTo(evs);
  assert.deepEqual(units.map(u => u.n), [1]);
  assert.deepEqual(players.map(p => p.n), [4]);
});

test('Piercing + Poisonous: the counters are lethal at the same number, so the rest still pierces', () => {
  // {Poisonous} deals its damage as permanent -1/-1 counters instead of marked
  // damage, but `checkDeaths` kills on `t <= 0 || damage >= t`, so `t - damage`
  // counters are exactly as lethal as `t - damage` damage. The combat path's
  // `assign` already prices a Poisonous column's lethal share off toughness the
  // same way; this pins that the two paths agree.
  const { h, A, D, src, tgt } = duel(7217, 'Noxious Sporefiend', 'Unit Token');
  const evs = dealFrom(h, A, src, tgt, 4, ['Piercing']);
  assert.equal(ent(h, tgt), undefined, 'one -1/-1 counter took the 1/1 to 0 toughness');
  assert.equal(h.state.players[D]!.life, 27, '4 − 1 needed = 3 pierced');
  // R237: the unit's share DOES fire a 'damage' event now — "Poisonous damage
  // does count as damage being dealt" (RAQ 2025-03-25) — tagged with the FORM
  // it took, while the -1/-1 counters remain what actually landed.
  assert.deepEqual(damageTo(evs).units.map(u => u.n), [1],
    "the unit's share announced itself as damage dealt");
  assert.ok(evs.some(e => e.type === 'damage' && e.data?.['poisonous'] === true),
    'and it says which form: counters, not marked damage');
  assert.deepEqual(damageTo(evs).players.map(p => p.n), [3],
    'the pierced remainder is ordinary damage to the face');
});

test('Piercing DONATED by a virus pierces exactly like a printed one', () => {
  // R79, Caleb 2025-03-06, the ruling that authorises the donation and names
  // this attribute: "you can only do this with attributes — mostly Deadly,
  // Piercing, and Powerful are impacted by this." The Foretold is a vanilla
  // 3/3 with no attributes at all, so the 4 that reach the face can only be
  // the donated one — which is the whole reason this feature exists.
  const { h, A, D, src, tgt } = duel(7218, 'The Foretold', 'Unit Token');
  assert.deepEqual([...ownAttrs(h, src)], [], 'the source prints nothing');
  const evs = dealFrom(h, A, src, tgt, 5, ['Piercing']);
  assert.equal(ent(h, tgt), undefined);
  assert.equal(h.state.players[D]!.life, 26, 'a donated {Piercing} is not a dead donation');
  assert.deepEqual(damageTo(evs).players.map(p => p.n), [4]);
});

test('Piercing in a BATCH: each unit\'s excess goes to THAT unit\'s controller', () => {
  // One effect, two victims on opposite sides, both overkilled. "That unit's
  // controller" is the load-bearing half of the ruling: a version that sent
  // every remainder to the opponent would pass a one-victim test and be wrong
  // here, and it would be wrong in the source's own favour.
  const { h, A, D, src, tgt } = duel(7219, 'Ruinbringer', 'Unit Token');
  const mine = spawn(h, A, 'Unit Token');              // the SOURCE's own 1/1
  const evs = dealAllFrom(h, A, src, [{ id: tgt, n: 3 }, { id: mine, n: 3 }]);
  assert.equal(ent(h, tgt), undefined);
  assert.equal(ent(h, mine), undefined);
  assert.equal(h.state.players[D]!.life, 28, 'D takes the excess of D\'s unit');
  assert.equal(h.state.players[A]!.life, 28, 'A takes the excess of A\'s own unit');
  const { players } = damageTo(evs);
  assert.deepEqual(players.map(p => [p.player, p.n]).sort(), [[A, 2], [D, 2]].sort());
  assert.deepEqual(players.map(p => p.total), [6, 6],
    'R80: one batch of 6 dealt, however many recipients it reached');
});

test('Piercing: a unit named twice in one batch is overkilled ONCE, and the rest pierces', () => {
  // R80 coalesces a recipient named twice into a single hit, so the lethal
  // share is priced against the total the batch will really deal it — 8 to a
  // 5/6 is 6 lethal and 2 pierced, not two independent 4s that each pierce
  // nothing.
  const { h, A, D, src, tgt } = duel(7220, 'Ruinbringer', 'Bubb');
  const evs = dealAllFrom(h, A, src, [{ id: tgt, n: 4 }, { id: tgt, n: 4 }]);
  assert.equal(ent(h, tgt), undefined);
  assert.equal(h.state.players[D]!.life, 28);
  const { units, players } = damageTo(evs);
  assert.deepEqual(units.map(u => u.n), [6], 'one damage event for the unit, not two');
  assert.deepEqual(players.map(p => p.n), [2]);
});

// ── the two paths, measured against each other ──────────────────────────

test('combat and effect damage agree on how much was dealt', () => {
  // R114 (report #84, 2026-08-23): "ALL damage is dealt to units, even if it
  // surpasses its defense."
  //
  // This is the invariant whose ABSENCE let the two damage paths drift.
  // `dealEffectDamageAll` always dealt the full amount; `assignColumnDamage`
  // clamped a combat hit to the victim's lethal need and silently dropped the
  // rest. Both paths end at the same `damage` event, and every card that reads
  // "that much" reads its `n` — so the same source dealing the same amount to
  // the same body had to be measured once each way, and never was.
  //
  // 7 into a 3/5: lethal is 5, so a clamp shows up as 5 on one side and 7 on
  // the other.
  const effect = duelToken(7230, 'Life Plant', 3, 5);        // Life Plant is a 7/3, no attrs
  const evs = dealAllFrom(effect.h, effect.A, effect.src, [{ id: effect.tgt, n: 7 }]);
  const viaEffect = damageTo(evs).units.map(u => u.n);
  assert.deepEqual(viaEffect, [7], 'effect damage deals the whole 7 to a 3/5');

  const h = new Harness(7231);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const src = spawn(h, A, 'Life Plant');                     // the same 7 power
  const g = new E(h.state);
  const tgt = g.spawnUnit(D, 'Unit Token', g.homeRegion(D), { token: true, tokenStats: [3, 5] }).id;
  g.settle();
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[src]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [tgt] } });
  const mark = h.events.length;
  pass(h); pass(h);
  const viaCombat = h.events.slice(mark)
    .filter(e => e.type === 'damage' && e.data?.['unit'] === tgt)
    .map(e => e.data!['n'] as number);
  assert.deepEqual(viaCombat, viaEffect,
    'the same source dealing the same amount to the same body must report the same number '
    + 'whether it came through combat or through an effect');
});

// ── the standing guarantee ──────────────────────────────────────────────

test('every damage-reading attribute is honoured by the non-combat damage batch', () => {
  // The list is the point. `dealEffectDamageAll` is the single choke point every
  // non-combat damage source goes through, so an attribute that changes how
  // damage lands must be READ there or it silently works in combat only — which
  // is the exact shape of the {Piercing} gap the owner reported.
  const engineFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'engine.ts');
  const engine = fs.readFileSync(engineFile, 'utf8');
  // the method body only: from its signature to the next method at class
  // indentation. Slicing to end-of-file instead would let ANY later mention of
  // an attribute satisfy this, which is how the first version of this
  // assertion claimed Piercing was already handled.
  const from = engine.indexOf('  dealEffectDamageAll(');
  assert.ok(from > 0, 'dealEffectDamageAll has been renamed — this assertion needs updating');
  const rest = engine.slice(from + 10);
  const next = rest.search(/\n  [a-zA-Z_$][\w$]*\(/);
  const body = next > 0 ? rest.slice(0, next) : rest;
  //
  // {Piercing} joined this list on 2026-08-23, when the owner settled what it
  // does off the column — "It redirects excess damage to that unit's
  // controller (not as a trigger, just as part of resolution of the damage)" —
  // which closed CARD-TODO #4. It is the reason the list is asserted at all:
  // it worked in combat for months while being byte-identical to no attribute
  // at all here, and nothing said so.
  //
  // {Unaware} joined it on the same day, from the other end of CARD-TODO #5.
  // R106's second half is a PAIRWISE collapse — "it looks ONLY at what is the
  // literal printed text on all cards 'involved'" — so an Unaware SOURCE makes
  // this batch price and kill its victims at their printed defense ("Haboob
  // kills anything that has 1 defense printed at the card level"). It is read
  // here, deliberately, and the assertion that used to say it must NOT be has
  // been deleted rather than weakened.
  const READS = [
    'Deadly', 'Powerful', 'Poisonous', 'Resonant', 'Blessed', 'Reaping', 'Electric', 'Piercing',
    'Unaware',
  ];
  const missing = READS.filter(a => !body.includes(`'${a}'`));
  assert.deepEqual(missing, [],
    `these attributes are not read by the non-combat damage batch: ${missing.join(', ')}`);
  // The list is still NOT a claim that the set is complete — it is a claim
  // that each of these was, at some point, silently absent.
});
