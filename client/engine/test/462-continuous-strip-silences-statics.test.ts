/**
 * Report #214 (room TJGW) / CT-256 / CR 712.1a: a unit that a CONTINUOUS
 * effect strips of its abilities (Transmogrifant, Monke, The Everywhere) stops
 * applying its static abilities, exactly as one Suppression Field stamped does.
 *
 * The owner, binding: "static effects count as abilities. Everything (besides
 * an attribute) is an ability."
 *
 * The report: Gogorobot augmented Transmogrifant onto LordZZX's Hooba-Pon while
 * LordZZX's Aberrant Statweaver ("[Augment] Your units are base 3/3.") was in
 * play. "Your" is the host's controller, so the Statweaver lost its abilities,
 * yet every LordZZX unit still read base 3/3. The radiator walks checked only
 * the one-shot stamp a spell leaves (`textStrippedShallow`), and a continuous
 * strip leaves none.
 *
 * Two strippers that each fall under the other: the NEWER applies and the
 * older does not. Caleb, rules-questions 2023-08-27 (msg 1145226276911714384):
 * "they would end up with +2/+2 buff, the second transmogrifant turns off the
 * irst one"; 2023-09-05 (msg 1148449043282927626): "The two transmogrifants
 * would turn off the other one though so you could only have one of them
 * active at once" / "Oh true I guess one would get +2/+2 and one would mot".
 * Where only one of two strippers falls under the other, timestamp order
 * decides (CR 113.2, 113.3a): the one not under the other applies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { effStats, ent, spawn, toDeployment, withE } from './util.ts';

const other = (s: Seat): Seat => (1 - s) as Seat;

function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  h.state = g.s;
  return u.id;
}
const stripped = (h: Harness, id: EntityId): boolean => {
  const g = new E(h.state);
  return g.abilitiesSuppressed(g.entity(id)!);
};

test('462 Mirage Walker with Aberrant Statweaver and Transmogrifant reads 4/6, the stripped Statweaver sets no base', () => {
  const h = new Harness(46201);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const mw = spawn(h, p, 'Mirage Walker');                  // printed 2/4
  const sw = spawn(h, p, 'Aberrant Statweaver');            // [Augment] Your units are base 3/3
  assert.deepEqual(effStats(h, mw), [3, 3], 'setup: the Statweaver sets base 3/3');
  spawn(h, p, 'Transmogrifant');
  assert.ok(stripped(h, sw), 'setup: the Statweaver has lost its abilities');
  assert.deepEqual(effStats(h, mw), [4, 6], 'printed 2/4 plus +2/+2, no base 3/3');
  assert.deepEqual(effStats(h, sw), [5, 5], 'the Statweaver itself: printed 3/3 plus +2/+2');
});

test('462 the report shape: Transmogrifant augmented onto an enemy host silences that player Statweaver', () => {
  const h = new Harness(46202);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = other(A);
  const host = spawn(h, D, 'Hooba-Pon');                    // printed 2/2
  const mw = spawn(h, D, 'Mirage Walker');                  // printed 2/4
  const sw = spawn(h, D, 'Aberrant Statweaver');
  const mine = spawn(h, A, 'Mirage Walker');
  assert.deepEqual(effStats(h, host), [3, 3], 'setup: base 3/3 from the Statweaver');
  withE(h, e => { e.attachMod(e.entity(host)!, 'Transmogrifant', A, 'augment'); });
  assert.ok(stripped(h, sw), 'the enemy Statweaver is one of the host controller other units');
  assert.deepEqual(effStats(h, host), [2, 2], 'the host is not "other": its printed 2/2, and no base 3/3');
  assert.deepEqual(effStats(h, mw), [4, 6], 'the host controller other units: printed plus +2/+2');
  assert.deepEqual(effStats(h, sw), [5, 5], 'the Statweaver: printed 3/3 plus +2/+2');
  assert.deepEqual(effStats(h, mine), [2, 4], 'the augmenting player units are untouched');
});

test('462 Sandstone Defender under Transmogrifant gives a 1/1 token nothing, a 3/3', () => {
  const h = new Harness(46203);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Sandstone Defender');
  const t = tok(h, p, 1, 1);
  assert.deepEqual(effStats(h, t), [1, 3], 'setup: the static applies');
  spawn(h, p, 'Transmogrifant');
  assert.deepEqual(effStats(h, t), [3, 3]);
});

test('462 Gatekeeper of Souls under Transmogrifant need not be targeted', () => {
  const h = new Harness(46204);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const gk = spawn(h, p, 'Gatekeeper of Souls');
  const region = ent(h, gk)!.region;
  assert.ok(new E(h.state).mustBeTargetedIn(region).has(gk), 'setup: it must be targeted');
  spawn(h, p, 'Transmogrifant');
  assert.ok(stripped(h, gk), 'setup: stripped');
  assert.ok(!new E(h.state).mustBeTargetedIn(region).has(gk), 'a stripped Gatekeeper no longer must be targeted');
});

test('462 two Transmogrifants in play: only the newer applies, a token gets +2/+2 once', () => {
  const h = new Harness(46205);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const t = tok(h, p, 1, 1);
  const older = spawn(h, p, 'Transmogrifant');               // printed 4/3
  assert.deepEqual(effStats(h, t), [3, 3], 'setup: one Transmogrifant');
  const newer = spawn(h, p, 'Transmogrifant');
  assert.deepEqual(effStats(h, t), [3, 3], 'the token gets +2/+2 once, not twice');
  assert.ok(stripped(h, older), 'the second turns off the first');
  assert.ok(!stripped(h, newer), 'the first does not turn off the second');
  assert.deepEqual(effStats(h, older), [6, 5], 'the older gets the newer +2/+2');
  assert.deepEqual(effStats(h, newer), [4, 3], 'the newer gets nothing from the older');
  // the newer leaves play: the older applies again at once
  withE(h, e => e.destroy(e.entity(newer)!, 'is deleted'));
  assert.ok(!stripped(h, older), 'the older is back');
  assert.deepEqual(effStats(h, t), [3, 3], 'and the token still has +2/+2, from the older');
});

test('462 two Transmogrifants augmented onto two hosts: the newer mod turns off the older', () => {
  const h = new Harness(46206);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const a = spawn(h, p, 'Hooba-Pon');                       // 2/2
  const b = spawn(h, p, 'Hooba-Pon');
  const t = tok(h, p, 1, 1);
  withE(h, e => { e.attachMod(e.entity(a)!, 'Transmogrifant', p, 'augment'); });
  withE(h, e => { e.attachMod(e.entity(b)!, 'Transmogrifant', p, 'augment'); });
  assert.deepEqual(effStats(h, t), [3, 3], 'one +2/+2');
  assert.deepEqual(effStats(h, a), [4, 4], 'host A is under the newer mod');
  assert.deepEqual(effStats(h, b), [2, 2], 'host B gets nothing from the silenced older mod');
});

test('462 two Monkes in battle: the newer applies, the older is silenced', () => {
  const h = new Harness(46207);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const older = spawn(h, p, 'Monke');
  const newer = spawn(h, p, 'Monke');
  h.state.phase = 'battle';                                // Monke reads the phase live
  assert.ok(stripped(h, older), 'the older Monke has lost its abilities');
  assert.ok(!stripped(h, newer), 'the newer Monke keeps them');
});

test('462 a stripper only one way under another: The Everywhere entering under Transmogrifant is silenced, so what it names keeps its abilities', () => {
  const h = new Harness(46208);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = other(A);
  spawn(h, A, 'Transmogrifant');
  const te = spawn(h, A, 'The Everywhere');
  const g = new E(h.state);
  const gk = g.spawnUnit(D, 'Gatekeeper of Souls', g.homeRegion(A)).id;   // in The Everywhere region
  g.settle();
  h.state = g.s;
  withE(h, e => { e.entity(te)!.named = 'Gatekeeper of Souls'; });
  assert.ok(stripped(h, te), 'The Everywhere printed text is older than Transmogrifant');
  assert.ok(!stripped(h, gk), 'so it silences nothing');
  assert.ok(new E(h.state).mustBeTargetedIn(ent(h, gk)!.region).has(gk), 'the Gatekeeper still must be targeted');
});

test('462 The Everywhere not under Transmogrifant silences what it names, and Transmogrifant still applies', () => {
  const h = new Harness(46209);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = other(A);
  const te = spawn(h, D, 'The Everywhere');                 // the other player: not under "your"
  const g = new E(h.state);
  const region = ent(h, te)!.region;
  const gk = g.spawnUnit(A, 'Gatekeeper of Souls', region).id;
  const tm = g.spawnUnit(A, 'Transmogrifant', region).id;
  const t = g.spawnUnit(A, 'Unit Token', region, { token: true, tokenStats: [1, 1] }).id;
  g.settle();
  h.state = g.s;
  withE(h, e => { e.entity(te)!.named = 'Gatekeeper of Souls'; });
  assert.ok(!stripped(h, te), 'The Everywhere is not one of Transmogrifant "your other units"');
  assert.ok(stripped(h, gk));
  assert.ok(!new E(h.state).mustBeTargetedIn(region).has(gk));
  assert.ok(!stripped(h, tm), 'Transmogrifant is not named');
  assert.deepEqual(effStats(h, t), [3, 3]);
});
