/**
 * Reports #212 / #213 (room TJGW, LordZZX): "Mirage Walker and Automation of
 * Abundance resulted in a 3/3 and a 1/1 instead of two 3/3s." / "Soul Siphon
 * plus Automaton of Abundance creates a 1/1 as the second unit." (a 24/24).
 *
 * CR 304.14: Automaton of Abundance's "additional copy of each unique token
 * you created" has everything the creating effect gave the original — its
 * name, its X and the stats it set ("a 3/3", "an X/X"). The creation request
 * (`TokenRequest`) carried no stats, so the copy was the bare 1/1 Unit Token
 * definition. Every older Automaton test used Robots, whose size is counters
 * (the X), which is why none of them saw it.
 *
 * RED-CHECK: drop the `stats` spread from `spawnUnit`'s `noteTokenCreated`
 * call (or from `createToken`) and every test here fails — the copies read
 * 1/1. Drop `stats` from Automaton's uniqueness key and the 3/3 + 5/5 test
 * fails 1 !== 2.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { radiantHook } from '../src/cards/dsl.ts';
import type { TokenRequest } from '../src/cards/dsl.ts';
import { DECK_LIST, createsOf } from '../src/cards/registry.ts';
import type { Entity, Seat } from '../src/types.ts';
import { drillCard, seedBoard } from './drill.ts';
import { ent, give, giveResources, spawn, toDeployment, toNextBattle, unitsOf, pass } from './util.ts';

/** the printed (layer-1) stats of every Unit Token `seat` controls */
function unitTokenStats(h: Harness, seat: Seat): string[] {
  const e = new E(h.state);
  return unitsOf(h, seat).filter(u => u.card === 'Unit Token' && u.token)
    .map(u => e.printedStats(u).join('/')).sort();
}

test('CR 304.14: with Automaton of Abundance, creating a 3/3 Unit Token gives two 3/3s', () => {
  const h = new Harness(45801);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Automaton of Abundance');
  const e = new E(h.state);
  e.spawnUnit(A, 'Unit Token', e.homeRegion(A), { token: true, tokenStats: [3, 3] });   // Mirage Walker
  e.settle();
  assert.deepEqual(unitTokenStats(h, A), ['3/3', '3/3'],
    'report #212: the copy is a 3/3 like the original, not the bare 1/1 Unit Token');
});

test('CR 304.14: with Automaton of Abundance, an X/X Unit Token is copied as the same X/X', () => {
  const h = new Harness(45802);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Automaton of Abundance');
  const e = new E(h.state);
  e.spawnUnit(A, 'Unit Token', e.homeRegion(A), { token: true, tokenStats: [24, 24] });  // Soul Siphon
  e.settle();
  assert.deepEqual(unitTokenStats(h, A), ['24/24', '24/24'],
    'report #213: the second unit is a 24/24, not a 1/1');
});

test('CR 304.14: Spawntender with Automaton of Abundance makes two 8/8 Unit Tokens', () => {
  // D attacks into A's region; A, the defender, holds the Automaton there and
  // answers with Spawntender ({Battle} Alien Spell Unit, bbb/7)
  const h = new Harness(45803);
  toDeployment(h);
  const D = h.state.initiative as Seat, A = (1 - D) as Seat;
  spawn(h, A, 'Automaton of Abundance');
  const attacker = spawn(h, D, 'Tidal Menace');
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[attacker]] });
  pass(h);                                                   // D declines → A holds priority
  giveResources(h, A, 'water', 7);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spawntender') });
  for (let i = 0; i < 6 && unitTokenStats(h, A).length < 2 && h.state.priority !== null; i++) pass(h);
  assert.deepEqual(unitTokenStats(h, A), ['8/8', '8/8'],
    '"[Switch1] Create an 8/8 unit." — the printed 8/8 and its copy, both 8/8');
});

/** the batch replacement as the engine calls it, on a real anchor */
function extrasFor(h: Harness, anchor: Entity, batch: TokenRequest[]): TokenRequest[] {
  const e = new E(h.state);
  return radiantHook('Automaton of Abundance', 'replaceTokenBatch')!(e, anchor, batch) ?? [];
}

test('CR 304.14: a 3/3 and a 5/5 Unit Token made together are TWO unique tokens', () => {
  // owner steer: the permissive reading — the stats the creation set are part
  // of which token it is, exactly as the X is (CR 304.14)
  const h = new Harness(45804);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const aoa = ent(h, spawn(h, A, 'Automaton of Abundance'))!;
  const region = aoa.region;
  const extras = extrasFor(h, aoa, [
    { form: 'unit', name: 'Unit Token', x: 0, seat: A, region, stats: [3, 3] },
    { form: 'unit', name: 'Unit Token', x: 0, seat: A, region, stats: [5, 5] },
    { form: 'unit', name: 'Unit Token', x: 0, seat: A, region, stats: [3, 3] },
  ]);
  assert.equal(extras.length, 2, 'one extra per (name, X, stats), not one per name');
  assert.deepEqual(extras.map(r => r.stats), [[3, 3], [5, 5]], 'a copy of each, stats and all');
});

test('CR 304.14: a Unit Token created with no stats and one created as a 1/1 are ONE unique token', () => {
  // a creation that set no stats has the definition's own (1/1), so the key
  // must not tell the two apart
  const h = new Harness(45805);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const aoa = ent(h, spawn(h, A, 'Automaton of Abundance'))!;
  const region = aoa.region;
  const extras = extrasFor(h, aoa, [
    { form: 'unit', name: 'Unit Token', x: 0, seat: A, region },
    { form: 'unit', name: 'Unit Token', x: 0, seat: A, region, stats: [1, 1] },
  ]);
  assert.equal(extras.length, 1);
});

// ── THE SWEEP ───────────────────────────────────────────────────────────────
//
// Every card that declares it creates a Unit Token (`createsOf`, which
// 65-effect-conformance keeps honest), drilled through the real game with an
// Automaton of Abundance on its side. Each batch the Automaton pays out is
// checked: the copies' printed stats must be exactly the distinct printed
// stats of the originals it copied. Derived, not enumerated — a new card that
// creates "a 6/6" joins the sweep by declaring it.

interface Batch { orig: string[]; copies: string[] }

test('CR 304.14 sweep: every Automaton copy of a card-created Unit Token has the printed stats of its original', () => {
  const cls = DECK_LIST.filter(n => createsOf(n).includes('Unit Token'));
  assert.ok(cls.length >= 20, `the class is derived from createsOf (${cls.length})`);
  // The instrument: each creation REQUEST is tagged with the printed stats of
  // the body it produced (newEntity runs just before noteTokenCreated inside
  // spawnUnit), so a settled batch knows what its originals really were even
  // where the request itself does not say — which is the defect.
  const proto = E.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const orig = {
    newEntity: proto.newEntity!, note: proto.noteTokenCreated!,
    createToken: proto.createToken!, settle: proto.settleTokenBatch!,
  };
  const madeAs = new WeakMap<object, string>();
  let lastTok: Entity | null = null;
  let current: Batch | null = null;
  let batches: Batch[] = [];
  proto.newEntity = function (this: E, ...a: unknown[]) {
    const u = orig.newEntity.apply(this, a) as Entity;
    if (u.kind === 'unit' && u.token) lastTok = u;
    return u;
  };
  proto.noteTokenCreated = function (this: E, ...a: unknown[]) {
    const req = a[0] as TokenRequest;
    if (req.form === 'unit' && lastTok && lastTok.card === req.name) {
      madeAs.set(req, this.printedStats(lastTok).join('/'));
    }
    return orig.note.apply(this, a);
  };
  proto.createToken = function (this: E, ...a: unknown[]) {
    const t = orig.createToken.apply(this, a) as Entity;
    if (current && t.kind === 'unit' && t.card === 'Unit Token') current.copies.push(this.printedStats(t).join('/'));
    return t;
  };
  proto.settleTokenBatch = function (this: E, ...a: unknown[]) {
    const batch = a[0] as TokenRequest[];
    const outer = current;
    current = {
      orig: batch.filter(r => r.form === 'unit' && r.name === 'Unit Token' && r.seat === 0)
        .map(r => madeAs.get(r) ?? '?'),
      copies: [],
    };
    try { return orig.settle.apply(this, a); } finally {
      if (current.copies.length) batches.push(current);
      current = outer;
    }
  };
  const bad: string[] = [];
  const reachedBig = new Set<string>();
  try {
    for (const card of cls) {
      for (const press of [false, true]) {
        // press mode (the fixture library, two battles) is the expensive half:
        // run it only for a card the plain cast did not already prove
        if (press && reachedBig.has(card)) continue;
        batches = [];
        drillCard(card, 900_000, {
          press, activate: true,
          setup: (s, seat) => {
            seedBoard(s, seat);
            const e = new E(s);
            e.spawnUnit(seat, 'Automaton of Abundance', e.homeRegion(seat));
            e.settle();
          },
        });
        for (const b of batches) {
          const want = [...new Set(b.orig)].sort(), got = [...new Set(b.copies)].sort();
          if (b.orig.some(st => st !== '1/1')) reachedBig.add(card);
          if (JSON.stringify(want) !== JSON.stringify(got)) {
            bad.push(`${card}${press ? ' (press)' : ''}: originals ${want.join(',')} → copies ${got.join(',')}`);
          }
        }
      }
    }
  } finally {
    Object.assign(proto, {
      newEntity: orig.newEntity, noteTokenCreated: orig.note,
      createToken: orig.createToken, settleTokenBatch: orig.settle,
    });
  }
  // a positive control: the sweep must actually reach the non-1/1 class
  for (const c of ['Mirage Walker', 'Spawntender', 'Feed to Hooba', 'Flesh Tithe']) {
    assert.ok(reachedBig.has(c), `the sweep reached ${c}'s own non-1/1 creation (reached: ${[...reachedBig].join(', ')})`);
  }
  assert.deepEqual(bad, [], 'an Automaton copy with different printed stats from its original');
});
