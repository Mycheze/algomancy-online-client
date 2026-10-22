/**
 * Report #214 / CT-256 / CR 712.1a, the CLASS: every radiating channel skips a
 * holder a continuous stripper has silenced, not only the statics walk.
 *
 * Derived, never enumerated: the holders are every unit card in the registry
 * whose body or [Augment] box declares the channel. Each is put in play,
 * asked for through its channel (it must be there — the check is not vacuous),
 * then put under Transmogrifant ("Your other units ... lose all attributes and
 * abilities") and asked again (it must be gone).
 *
 * How "asked for" is observed: every channel but statics reads its radiators
 * off one `anchored()` walk whose predicate holds the CR 712.1a filter, so the
 * spy records what the OUTERMOST walk returned during the query. The statics
 * channel resolves its strips after its walk (phase B), so it is observed
 * through `projections()` instead.
 *
 * A source check closes the loop: every `anchored()` walk in engine.ts applies
 * a strip filter, so a twelfth channel cannot arrive without one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../src/cards/registry.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Entity, EntityId, Seat } from '../src/types.ts';
import { toDeployment } from './util.ts';

type Q = (g: any, u: Entity) => unknown;
const amount = (u: Entity) => ({ kind: 'counters', region: u.region, amount: 1, unit: u, player: u.controller, combat: false });
const modCtx = (u: Entity) => ({ seat: u.controller, card: getCard('Nebula Drifter'), from: 'hand', region: u.region });
/** channel → the queries that read it (modPermissions has two sites) */
/** CT-239: Gatekeeper of Souls compels only "during battle", so a probe of the
 * channel puts a battle on in `region` (its declare step, exactly the shape
 * E.startBattleRound opens) for the length of the query. */
function duringBattleIn<T>(g: E, region: number, fn: () => T): T {
  const s = g.s, was = { phase: s.phase, battle: s.battle };
  s.phase = 'battle';
  s.battle = {
    round: 1, attacker: 0, defender: 1, region, step: 'declare',
    columns: [], blocks: {}, sentAttackers: [], attackerPool: null, happened: false,
  };
  try { return fn(); } finally { s.phase = was.phase; s.battle = was.battle; }
}

const CHANNELS: Record<string, Q[]> = {
  costMods: [(g, u) => g.costModsFor(u.region)],
  effectAttrs: [(g, u) => g.effectAttrsFor({ seat: u.controller, region: u.region, kind: 'spell' })],
  amountMods: [(g, u) => g.amountDelta(amount(u))],
  amountMultipliers: [(g, u) => g.amountFactor({ ...amount(u), kind: 'lifeGain' })],
  modPermissions: [(g, u) => g.mayAugmentInBattle(modCtx(u)), (g, u) => g.mayApplyModAtHaste(modCtx(u))],
  playPermissions: [(g, u) => g.hastePlayAllowance({ ...modCtx(u), card: getCard('Mirage Walker'), usedThisTurn: 0 })],
  asYouPlay: [(g, u) => g.asYouPlayOffers({ region: u.region, controller: u.controller, kind: 'unit', card: 'Mirage Walker' })],
  projects: [(g, u) => g.projectedFaces(u, 'behavior')],
  mustBeTargeted: [(g, u) => duringBattleIn(g, u.region, () => g.mustBeTargetedIn(u.region))],
};
const STRIPPERS = new Set(['Monke', 'Transmogrifant', 'The Everywhere']);

const isUnitCard = (n: string) => { const k = getCard(n).kind; return k === 'unit' || k === 'spellUnit'; };
const declares = (n: string, key: string) => {
  const d: any = getCard(n);
  const has = (b: any) => b && b[key] !== undefined && b[key] !== false && !(Array.isArray(b[key]) && b[key].length === 0);
  return has(d) || has(d.augmentBox);
};

/** what the outermost anchored() walks returned while `fn` ran */
function seenBy(fn: () => unknown): Set<EntityId> {
  const proto = E.prototype as any;
  const orig = proto.anchored;
  const seen = new Set<EntityId>();
  let depth = 0;
  proto.anchored = function (this: E, keep: any) {
    depth++;
    try {
      const out = orig.call(this, keep);
      if (depth === 1) for (const { holder, anchor } of out) { seen.add(holder.id); seen.add(anchor.id); }
      return out;
    } finally { depth--; }
  };
  try { fn(); } catch { /* a minimal ctx may trip a passing donor's callback; the walk was recorded */ }
  finally { proto.anchored = orig; }
  return seen;
}

function board(card: string): { h: Harness; p: Seat; u: EntityId } {
  const h = new Harness(46301);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const g = new E(h.state);
  const u = g.spawnUnit(p, card, g.homeRegion(p)).id;
  // somebody for a static to land on, on both sides
  g.spawnUnit(p, 'Unit Token', g.homeRegion(p), { token: true, tokenStats: [1, 1] });
  g.spawnUnit((1 - p) as Seat, 'Unit Token', g.homeRegion(p), { token: true, tokenStats: [1, 1] });
  g.settle();
  h.state = g.s;
  return { h, p, u };
}
function strip(h: Harness, p: Seat): void {
  const g = new E(h.state);
  g.spawnUnit(p, 'Transmogrifant', g.homeRegion(p));
  g.settle();
  h.state = g.s;
}

for (const [key, queries] of Object.entries(CHANNELS)) {
  test(`463 ${key}: a holder under Transmogrifant is skipped by every query of the channel`, () => {
    const holders = allCardNames().filter(n => isUnitCard(n) && declares(n, key) && !STRIPPERS.has(n));
    assert.ok(holders.length > 0, `the registry has a unit card declaring ${key}`);
    const fails: string[] = [];
    for (const card of holders) {
      queries.forEach((q, qi) => {
        const { h, p, u } = board(card);
        const before = seenBy(() => q(new E(h.state), new E(h.state).entity(u)!));
        if (!before.has(u)) { fails.push(`${card} (query ${qi}): not read even unstripped — the check would be vacuous`); return; }
        strip(h, p);
        const g = new E(h.state);
        assert.ok(g.abilitiesSuppressed(g.entity(u)!), `setup: ${card} is stripped`);
        const after = seenBy(() => q(g, g.entity(u)!));
        if (after.has(u)) fails.push(`${card} (query ${qi}): still radiates ${key} under Transmogrifant`);
      });
    }
    assert.deepEqual(fails, []);
  });
}

test('463 statics: no holder under Transmogrifant projects onto anyone', () => {
  const holders = allCardNames().filter(n => isUnitCard(n) && declares(n, 'statics') && !STRIPPERS.has(n));
  const fails: string[] = [];
  let live = 0;
  for (const card of holders) {
    const { h, p, u } = board(card);
    const projecting = (g: E) => Object.values(g.s.entities)
      .filter(x => x.kind === 'unit' && !x.absent)
      .some(x => g.projections(x).some(pr => pr.holder === u));
    if (!projecting(new E(h.state))) continue;              // its condition is not met on this board
    live++;
    strip(h, p);
    if (projecting(new E(h.state))) fails.push(`${card}: still projects under Transmogrifant`);
  }
  assert.ok(live >= 8, `enough statics holders project on the bare board to mean something (${live})`);
  assert.deepEqual(fails, []);
});

test('463 every anchored walk in the engine applies a strip filter', () => {
  const src = readFileSync(new URL('../src/engine.ts', import.meta.url), 'utf8');
  const sites = [...src.matchAll(/this\.anchored\(/g)].map(m => m.index!);
  assert.ok(sites.length >= 12, `found ${sites.length} walks`);
  const bare: string[] = [];
  for (const at of sites) {
    // the predicate: the text up to the statement's end, and never into the next walk
    const next = sites.find(x => x > at) ?? src.length;
    const window = src.slice(at, Math.min(next, src.indexOf(');', at) + 2));
    const line = src.slice(0, at).split('\n').length;
    if (/live\(h, a\)|textStripped\(h, a\)/.test(window)) continue;
    // the one-shot stamp alone is the bug this file guards, UNLESS the walk is
    // one of the two that feed phase A themselves (staticsFor, radiates)
    if (/textStrippedShallow\(h, a\)/.test(window)
      && src.slice(at, at + 1500).includes('activeStrippersAmong(')) continue;
    bare.push(`engine.ts:${line}`);
  }
  assert.deepEqual(bare, [], 'an anchored() walk with no CR 712.1a filter');
});
