/* R237 — {Deadly} kills through EFFECT damage, not just combat.
 *
 * Owner, 2026-08-28: "Yes, deadly works on spell effects and everything. Just
 * like powerful. So a fireball 1 with deadly would kill any unit."
 *
 * See scratchpad/rulings/R237.md. The tests here are the ones that would go
 * red if the {Deadly} reach were narrowed back to combat, or back to the
 * non-{Poisonous} half of the effect-damage commit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Attr, EngineEvent, EntityId, Seat } from '../src/types.ts';
import { ent, finishBattle, pass, spawn, toDeployment, toNextBattle, unitsOf } from './util.ts';

/** deal effect damage from `sourceName`, optionally as a live entity source
 * (`sourceId`) and/or with attributes donated on the stack (R79/R94).
 *
 * Returns the E's OWN event list. ⚠ `h.events` collects only what the harness
 * applied through `h.do`, so a direct `new E(state)` call's events never reach
 * it — reading `h.events` after this helper finds nothing and an assertion on
 * it passes vacuously. */
function dealEffect(h: Harness, controller: Seat, sourceName: string, targetId: EntityId, n: number,
  extra: { sourceId?: EntityId; grantedAttrs?: Attr[]; choose?: () => unknown } = {}): EngineEvent[] {
  const g = new E(h.state);
  const target = g.entity(targetId)!;
  g.dealEffectDamage(
    { controller, sourceName, region: g.homeRegion(controller), targets: [], event: null,
      eraseSelf: () => {},
      choose: () => { throw new Error('no choice expected'); }, ...extra },
    target, n);
  g.settle();
  return g.events;
}

// ── the half that already worked: a plain {Deadly} effect source ──────

test('R237: a plain {Deadly} effect source kills a unit it could never damage to death', () => {
  const h = new Harness(2371);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const devourer = spawn(h, A, 'Carapace Devourer');   // printed {Deadly}
  const victim = spawn(h, D, 'Rune Channeler');        // 4/3
  dealEffect(h, A, 'Carapace Devourer', victim, 1, { sourceId: devourer });
  assert.equal(ent(h, victim), undefined, '1 point from a Deadly source kills a 4/3');
});

// ── R237's actual gap: {Deadly} + {Poisonous} through an effect ───────

test('R237: {Deadly} + {Poisonous} effect damage still kills — the counter form is still damage', () => {
  const h = new Harness(2372);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sporefiend = spawn(h, A, 'Noxious Sporefiend');   // printed {Poisonous}
  const victim = spawn(h, D, 'Rune Channeler');           // 4/3
  // R125's channel: a virus/Rotspore grant reaches a live entity source too.
  dealEffect(h, A, 'Noxious Sporefiend', victim, 1,
    { sourceId: sporefiend, grantedAttrs: ['Deadly'] });
  assert.equal(ent(h, victim), undefined,
    'a Poisonous Deadly source deals its damage as -1/-1 counters and the Deadly kill still lands');
});

test('R237: the {Poisonous} form is preserved — the victim really took counters, not marked damage', () => {
  const h = new Harness(2373);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sporefiend = spawn(h, A, 'Noxious Sporefiend');
  const victim = spawn(h, D, 'Awoken Tomb');   // big enough to survive 1
  const before = new E(h.state).effStats(ent(h, victim)!);
  dealEffect(h, A, 'Noxious Sporefiend', victim, 1, { sourceId: sporefiend });
  const u = ent(h, victim);
  if (u) {
    assert.equal(u.damage, 0, 'Poisonous marks no damage');
    const after = new E(h.state).effStats(u);
    assert.ok(after[0] < before[0] || after[1] < before[1], 'it arrived as -1/-1 counters');
  }
});

// ── the owner's own worked example ────────────────────────────────────

test('R237: "a fireball 1 with deadly would kill any unit" — the Rotspore region', () => {
  const h = new Harness(2374);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  spawn(h, A, 'Rotspore Herald');                 // "[Augment] Everything is deadly"
  // R125 / Caleb 2023-09-07: the scope is the REGION and carries no ownership
  // qualifier, so the Herald deadly-fies its own controller's sources too —
  // which is the only reading a home region (one seat per region) can show.
  const gun = spawn(h, A, 'Bellowing Boulder');   // any live source in the region
  const victim = spawn(h, A, 'Rune Channeler');   // 4/3
  assert.ok(new E(h.state).effAttrs(ent(h, gun)!).has('Deadly'),
    'the Herald deadly-fied a source standing in its region');
  dealEffect(h, A, 'Bellowing Boulder', victim, 1, { sourceId: gun });
  assert.equal(ent(h, victim), undefined,
    '1 point of EFFECT damage from a deadly-fied source kills a 4/3');
  assert.ok(D !== A);
});

test('R237: a {Deadly} donated to a SPELL on the stack kills through the spell (R79/R94)', () => {
  const h = new Harness(2377);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const victim = spawn(h, D, 'Rune Channeler');   // 4/3
  // "a fireball 1 with deadly would kill any unit" (owner, 2026-08-28). A
  // SPELL has no entity in play, so its attrs are its printed ones plus the
  // grants the stack handed it — R94's `effectAttrs` channel, which is how
  // Rotspore Herald reaches a resolving spell (R125).
  dealEffect(h, A, 'Fireball', victim, 1, { grantedAttrs: ['Deadly'] });
  assert.equal(ent(h, victim), undefined, 'a deadly 1-damage spell kills a 4/3');
});

// ── the cross-check the ruling names: "just like powerful" ────────────

test('R237: {Powerful} and {Deadly} reach the same effect-damage sites', () => {
  const h = new Harness(2375);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const shredder = spawn(h, A, 'Chitin Shredder');   // printed {Powerful}
  const v1 = spawn(h, D, 'Rune Channeler');          // 4/3
  dealEffect(h, A, 'Chitin Shredder', v1, 2, { sourceId: shredder });
  const u = ent(h, v1);
  assert.equal(u, undefined, '{Powerful} doubled 2 into 4 through an EFFECT and killed the 4/3');
});

test('R237: {Powerful} doubles a {Poisonous} effect hit too — the same branch {Deadly} must reach', () => {
  const h = new Harness(2376);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sporefiend = spawn(h, A, 'Noxious Sporefiend');
  const victim = spawn(h, D, 'Rune Channeler');   // 4/3
  dealEffect(h, A, 'Noxious Sporefiend', victim, 2,
    { sourceId: sporefiend, grantedAttrs: ['Powerful'] });
  assert.equal(ent(h, victim), undefined,
    '2 doubled to 4 arrives as four -1/-1 counters and kills the 4/3');
});

// ── R237's other half: the {Poisonous} hit was DEALT, so it triggers ──

test('R237: an un-prevented {Poisonous} hit fires "whenever I am dealt damage" (the RAQ example)', () => {
  const h = new Harness(2378);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sporefiend = spawn(h, A, 'Noxious Sporefiend');   // printed {Poisonous}
  // RAQ "[Solved] Poisonous vs 'Whenever I am dealt damage'": "Awoken Tomb
  // receives 2 damage in form of -2/-2 counters and is triggered to make 2/2
  // token unit." Caleb, 2025-02-03: "Poisonous damage does count as damage."
  const tomb = spawn(h, D, 'Awoken Tomb');                // 0/5, "when I am dealt damage…"
  const before = unitsOf(h, D).length;
  dealEffect(h, A, 'Noxious Sporefiend', tomb, 2, { sourceId: sporefiend });
  assert.ok(unitsOf(h, D).length > before,
    'the counters ARE damage being dealt, and the Tomb heard it');
});

// ── R237 at the fourth damage site: Oorblak's redirect ────────────────

test('R237: a {Deadly} column redirected into Oorblak kills it', () => {
  const h = new Harness(2379);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const devourer = spawn(h, A, 'Carapace Devourer');   // printed {Deadly}
  // "[Augment] If combat damage would be dealt to you, that damage is dealt to
  // me instead" — a unit-damage commit living in a card, offered AFTER
  // sweepDeadly has run, which is why it had to deliver the kill itself.
  const oorblak = spawn(h, D, 'Oorblak');
  const lifeD = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[devourer]] });
  while (h.state.stack.length) pass(h);
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(ent(h, oorblak), undefined,
    'any damage from a deadly source kills a unit — a redirected hit included');
  assert.equal(h.state.players[D]!.life, lifeD,
    'and the redirect still happened: no life was lost (the column was not Piercing)');
  finishBattle(h);
});

// ── the same rule in COMBAT, which is what retired the 'poison' channel ──

test('R237: a {Poisonous} COMBAT hit fires a real \'damage\' event', () => {
  const h = new Harness(2380);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const sporefiend = spawn(h, A, 'Noxious Sporefiend');   // 2/2 {Poisonous} {Swift}
  const wall = spawn(h, D, 'Awoken Tomb');                // 0/5 — survives, so it can be heard
  const before = unitsOf(h, D).length;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sporefiend]] });
  while (h.state.stack.length) pass(h);
  pass(h); pass(h);
  const ci = h.state.battle!.columns.findIndex(c => c.includes(sporefiend));
  h.do({ type: 'declareBlocks', seat: D, blocks: { [ci]: [wall] } });
  pass(h); pass(h);
  // BEHAVIOURAL, not a log read: `E.ev` writes the line whether or not
  // `fireEvent` dispatches it, so asserting on the log would pass either way.
  // Awoken Tomb's "when I am dealt damage, create an X/X unit" is the dispatch.
  assert.ok(unitsOf(h, D).length > before,
    "the poison hit announced itself on 'damage' and the Tomb heard it — which "
    + "is what makes the old 'poison' proxy channel (countersChanged during a "
    + 'damage step) redundant');
  const line = h.events.find(e => e.type === 'damage' && e.data?.['unit'] === wall);
  assert.equal(line?.data?.['poisonous'], true, 'and it says which FORM it took');
  assert.equal(ent(h, wall)!.damage, 0, 'no marked damage: the form really is counters');
  finishBattle(h);
});

// ── the R166 `lethal` fact, on the form that shrinks toughness ────────

test('R237: a poison hit onto ALREADY-MARKED damage reports itself lethal', () => {
  const h = new Harness(2384);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sporefiend = spawn(h, A, 'Noxious Sporefiend');
  const victim = spawn(h, D, 'Awoken Tomb');   // 0/5
  const g0 = new E(h.state);
  g0.entity(victim)!.damage = 3;               // 3 marked, 2 toughness to spare
  // 2 poison counters take it to 0/3 with 3 marked — `checkDeaths` kills on
  // `damage >= t`, so the hit IS lethal, and the R166 fact must say so.
  // Reading it as "t - through <= 0" alone would call this survivable.
  const evs = dealEffect(h, A, 'Noxious Sporefiend', victim, 2,
    { sourceId: sporefiend, choose: () => 0 });
  const line = evs.find(e => e.type === 'damage' && e.data?.['unit'] === victim);
  assert.equal(line?.data?.['lethal'], true,
    'the hit that killed it is not allowed to report that it was survived');
  assert.equal(ent(h, victim), undefined, 'and it really did die');
});
