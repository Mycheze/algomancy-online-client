/* CR 802.25g — {Pure} outside combat: the attribute layer switched off per
 * (effect, recipient) pairing.
 *
 * The combat half (the column pair) came first. This is the other half, and the shape of
 * the fixtures is 82-attr-interactions's: a real board, a real source entity,
 * `dealEffectDamageAll` called the way a card script calls it, and the
 * engine's own 'damage' events read back — not the prose.
 *
 *   §1 a Pure SOURCE: its own Powerful and Deadly do nothing
 *   §2 a Pure RECIPIENT: the source's Powerful/Deadly do nothing to it, and its
 *      own Vulnerable does nothing either
 *   §3 the pairing rule: one batch, two recipients, only the Pure one is plain
 *   §4 a Pure {Blessed} source gains nothing
 *   §5 negative control: the same hits WITHOUT Pure double and kill — so the
 *      assertions above are not vacuous
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { effStats, ent, ownAttrs, spawn, toDeployment, absorb } from './util.ts';
import type { Attr, EngineEvent, EntityId, Seat } from '../src/types.ts';

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
      eraseSelf: () => {},
      choose: () => { throw new Error('no choice expected'); },
    },
    hits.map(hit => ({ target: g.entity(hit.id)!, n: hit.n })));
  g.settle();
  h.state = g.s;
  absorb(h, g.events);
  return g.events;
}
const dealFrom = (h: Harness, c: Seat, src: EntityId, tgt: EntityId, n: number, granted?: Attr[]): EngineEvent[] =>
  dealAllFrom(h, c, src, [{ id: tgt, n }], granted);

/** what each unit RECEIVED, by entity id, from the batch's 'damage' events */
const dealtTo = (evs: EngineEvent[]): Map<number, number> => {
  const m = new Map<number, number>();
  for (const e of evs) if (e.type === 'damage' && typeof e.data?.['unit'] === 'number') {
    m.set(e.data['unit'] as number, (m.get(e.data['unit'] as number) ?? 0) + (e.data['n'] as number));
  }
  return m;
};

function board(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  return { h, A, D: (1 - A) as Seat };
}

// ── §0 the cards this rests on are what the fixtures assume ──────────────

test('§0 POSITIVE CONTROL: the fixture cards carry the attributes the sections read', () => {
  const { h, A, D } = board(2890);
  const shredder = spawn(h, A, 'Chitin Shredder');
  const crumb = spawn(h, D, 'Crumbling Ancient');
  const pure = spawn(h, D, 'Just a Unit');
  assert.ok(ownAttrs(h, shredder).has('Powerful'), 'Chitin Shredder is printed {Powerful}');
  assert.ok(ownAttrs(h, crumb).has('Vulnerable'), 'Crumbling Ancient is printed {Vulnerable}');
  assert.ok(ownAttrs(h, pure).has('Pure'), 'Just a Unit is printed {Pure}');
  assert.deepEqual(effStats(h, crumb), [3, 8]);
});

// ── §1 a Pure source ─────────────────────────────────────────────────────

test('§1 a Pure source: its own Powerful does not double and its granted Deadly does not kill', () => {
  const { h, A, D } = board(2891);
  const src = spawn(h, A, 'Chitin Shredder');
  const tgt = spawn(h, D, 'Crumbling Ancient');      // 3/8 Vulnerable — doubles on the other side too
  const evs = dealFrom(h, A, src, tgt, 1, ['Pure', 'Deadly']);
  assert.equal(dealtTo(evs).get(tgt), 1, 'one point dealt: no Powerful (source side), no Vulnerable (victim side)');
  assert.ok(ent(h, tgt), 'and the granted Deadly did not kill — it is an attribute, and the pairing is blind');
  assert.equal(ent(h, tgt)!.damage, 1);
});

// ── §2 a Pure recipient ──────────────────────────────────────────────────

test('§2 a Pure recipient: the source\'s Powerful and Deadly do nothing to it', () => {
  const { h, A, D } = board(2892);
  const src = spawn(h, A, 'Chitin Shredder');         // printed Powerful
  const tgt = spawn(h, D, 'Just a Unit');             // printed Pure
  const [, t] = effStats(h, tgt);
  assert.ok(t > 1, `positive control: Just a Unit has more than 1 toughness (${t}), so 1 is not lethal on its own`);
  const evs = dealFrom(h, A, src, tgt, 1, ['Deadly']);
  assert.equal(dealtTo(evs).get(tgt), 1, 'one point, not two');
  assert.ok(ent(h, tgt), 'alive: Deadly is off against a Pure recipient');
});

test('§2 a Pure recipient\'s own Vulnerable is off too: a Pure source hitting a Vulnerable unit deals what it says', () => {
  // first a Pure SOURCE ("either side" of the pairing) pins the Vulnerable read;
  // the second half below makes the RECIPIENT itself Pure, as the title says
  const { h, A, D } = board(2893);
  const src = spawn(h, A, 'Chitin Shredder');
  const tgt = spawn(h, D, 'Crumbling Ancient');
  const evs = dealFrom(h, A, src, tgt, 2, ['Pure']);
  assert.equal(dealtTo(evs).get(tgt), 2, '2 → 2: neither the source doubling nor the receiver doubling');
  assert.ok(ent(h, tgt), 'a 3/8 with 2 damage on it is alive');

  // CT-241 (7): and the case the title names — the RECIPIENT itself is Pure (and
  // Vulnerable), the source is not: its own Vulnerable must still be off
  const b2 = board(2896);
  const src2 = spawn(b2.h, b2.A, 'Chitin Shredder');         // printed Powerful, NOT Pure
  const tgt2 = spawn(b2.h, b2.D, 'Crumbling Ancient');       // printed Vulnerable
  ent(b2.h, tgt2)!.tempAttrs = ['Pure'];                      // … and Pure until regroup
  assert.ok(ownAttrs(b2.h, tgt2).has('Pure') && ownAttrs(b2.h, tgt2).has('Vulnerable'),
    'premise: the recipient is both Pure and Vulnerable');
  assert.ok(!ownAttrs(b2.h, src2).has('Pure'), 'premise: the source is not Pure');
  const evs2 = dealFrom(b2.h, b2.A, src2, tgt2, 2);
  assert.equal(dealtTo(evs2).get(tgt2), 2, 'a Pure recipient takes the printed 2: its own Vulnerable is off');
});

// ── §3 the pairing rule ──────────────────────────────────────────────────

test('§3 one batch, two recipients: only the pairing with the Pure unit is attribute-blind', () => {
  const { h, A, D } = board(2894);
  const src = spawn(h, A, 'Chitin Shredder');         // Powerful, not Pure
  const pure = spawn(h, D, 'Just a Unit');
  const plain = spawn(h, D, 'Bubb');
  const evs = dealAllFrom(h, A, src, [{ id: pure, n: 1 }, { id: plain, n: 1 }]);
  const got = dealtTo(evs);
  assert.equal(got.get(pure), 1, 'the Pure recipient takes the printed 1');
  assert.equal(got.get(plain), 2, 'the ordinary recipient beside it still takes Powerful\'s 2');
});

// ── §4 a rider ───────────────────────────────────────────────────────────

test('§4 a Pure {Blessed} source gains nothing — Blessed is an attribute like the rest', () => {
  const { h, A, D } = board(2895);
  const src = spawn(h, A, 'Shib');                     // printed Blessed (82 §Blessed)
  assert.ok(ownAttrs(h, src).has('Blessed'), 'positive control: Shib is Blessed');
  const tgt = spawn(h, D, 'Bubb');
  const before = h.state.players[A]!.life;
  dealFrom(h, A, src, tgt, 3, ['Pure']);
  assert.equal(h.state.players[A]!.life, before, 'no life gained');
});

// ── §5 negative control ──────────────────────────────────────────────────

test('§5 NEGATIVE CONTROL: without Pure the same hit doubles twice and Deadly kills', () => {
  const { h, A, D } = board(2896);
  const src = spawn(h, A, 'Chitin Shredder');
  const tgt = spawn(h, D, 'Crumbling Ancient');
  const evs = dealFrom(h, A, src, tgt, 1, ['Deadly']);
  assert.equal(dealtTo(evs).get(tgt), 4, '1 → 2 (Powerful) → 4 (Vulnerable)');
  assert.equal(ent(h, tgt), undefined, 'and Deadly kills');
});
