/* CT-232 — a target's legality is judged ONCE, as the item begins to resolve.
 *
 * CR 704.5a: "The check is made once, as the effect begins to resolve. An
 * earlier part of the effect cannot make a later part's target illegal in the
 * middle of its resolution." `markIllegalTargets` makes that check, and
 * `resolveParts` drops a slot it judged illegal before the run is called. So a
 * run that tests its own printed restriction AGAIN can only ever disagree with
 * that judgement in one situation — the one the rule forbids: something earlier
 * in the same resolution changed the target. Minor Kraken did ("if (def <= 5)
 * g.recall(t)"), so a composite whose first part put counters on the unit
 * switched its second part off.
 *
 * §1 is the report, through the real stack: a graft composite.
 * §2 is the sweep, DERIVED from the registry rather than listed: every effect
 * whose target slot is narrower than "any unit" is run on a target that was
 * legal and has since been made into a unit the slot would refuse (it is given
 * another unit's identity, stats and controller in place). A run that re-tests
 * the restriction does nothing at all; one that trusts the judgement acts.
 * It drives UNIT slots only. Three stack-target runs had the same shape and were
 * fixed beside it (Frosted Denial "enemy effect", Graxxlid "targeting me", Boon
 * of Protection "targets something allied"); a stack slot is not swept here.
 *
 * Seeds 55400-55499. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  allCardNames, getCard, registerSynthetic, slotWhat, specForSlot,
  type EffectCtx, type ResolvedTarget, type TargetSpec,
} from '../src/cards/dsl.ts';
import { effectsOf } from '../src/cards/registry.ts';
import type { CardName, Entity, EntityId, GameState, Seat } from '../src/types.ts';
import { ent, finishBattle, giveResources, pick, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';

/* ══ §1 — THE REPORT: Minor Kraken grafted under a cause that grows its target ══ */

registerSynthetic({
  name: 'T554 Grower', cost: '', mana: 0, power: 1, toughness: 3,
  type: 'Test Unit', kind: 'unit', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], text: '', image: '',
}, {
  abilities: [{
    type: 'triggered', events: ['attacked'], self: true, graftCause: true,
    label: 'put eleven +1/+1 counters on target unit',
    effect: {
      targets: { what: 'unit', prompt: 'T554 Grower: put eleven +1/+1 counters on target unit' },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (t && 'id' in (t as object) && g.entity((t as Entity).id)) g.addCounters(g.entity((t as Entity).id)!, 11);
      },
    },
  }],
});

function krakenComposite(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const grower = spawn(h, A, 'T554 Grower');
  const crab = spawn(h, D, 'Mirage Scuttler');                         // 0/2
  const g = new E(h.state);
  g.attachMod(g.entity(grower)!, 'Minor Kraken', A, 'graft');
  h.state = g.s;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[grower]] });
  return { h, A, D, grower, crab };
}

test('CR 704.5a / CT-232: Minor Kraken grafted under a part that grows its target past 5 defense still recalls it', () => {
  const { h, D, crab } = krakenComposite(55401);
  // the composite collects its parts' targets in order: the grower first
  assert.match(h.state.decision?.prompt ?? '', /^T554 Grower/, 'setup: the grower part is asked first');
  pick(h, { unit: crab });
  assert.match(h.state.decision?.prompt ?? '', /^Minor Kraken/, 'setup: then the grafted Kraken recall');
  pick(h, { unit: crab });                                              // a 0/2: legal
  const item = h.state.stack.find(i => i.parts.some(p => p.effectKey === 'graft:Minor Kraken'));
  assert.deepEqual(item?.parts.map(p => p.effectKey), ['ability:T554 Grower#0', 'graft:Minor Kraken'],
    'setup: one item, the grower part resolving before the recall');
  pass(h); pass(h);
  assert.ok(!ent(h, crab),
    'the 0/2 was a legal target as the item began to resolve; the counters the first part put on it '
    + 'cannot make the second part refuse it');
  assert.ok(h.state.players[D]!.hand.includes('Mirage Scuttler'), 'recalled to its owner');
  finishBattle(h);
});

test('CR 704.5 / CT-232 CONTROL: a target already past 5 defense when the item begins to resolve is still refused', () => {
  const { h, crab } = krakenComposite(55402);
  pick(h, { unit: crab });
  pick(h, { unit: crab });
  withE(h, e => e.addCounters(e.entity(crab)!, 11));                    // grown BEFORE resolution
  pass(h); pass(h);
  assert.ok(ent(h, crab), 'judged once, at the start: a 13-defense unit is not a legal target, so it stays');
  finishBattle(h);
});

/* ══ §2 — THE SWEEP ═════════════════════════════════════════════════════ */

const BODIES = ['Tidal Menace', 'The Foretold', 'Curio Drifter', 'Bubb', 'Crumbling Ancient', 'Good Whale', 'The Omniphage'];
const ELS = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'] as const;

/** an attack declared, so formations exist; varied bodies on both sides, a
 *  token each, and every element open */
function board(): { state: GameState; A: Seat; D: Seat; region: number } {
  const h = new Harness(55400);
  toDeployment(h);
  for (const seat of [0, 1] as Seat[]) {
    for (const b of BODIES) { try { spawn(h, seat, b); } catch { /* a spawn trigger suspended */ } }
    const e = new E(h.state);
    try { e.spawnUnit(seat, 'Ignis Sprite' as CardName, e.homeRegion(seat), { token: true }); e.settle(); } catch { /* */ }
    // a unit with a stat change, for "with no stat changes"
    try { e.addCounters(e.unitsOf(seat, e.homeRegion(seat))[0]!, 1); e.settle(); } catch { /* */ }
    h.state.players[seat]!.bin.push('Ignis Sprite', 'Curio Drifter', 'Tidal Menace');
  }
  toNextBattle(h);
  const att = h.state.battle!.attacker;
  // a three-unit attack: a formation small enough that "cost ≤ units in my
  // formation" refuses somebody, and a defender's region holding both sides
  const e = new E(h.state);
  const mine = e.unitsOf(att, e.homeRegion(att)).map(u => u.id);
  h.do({ type: 'declareAttack', seat: att, columns: [[mine[0]!], [mine[1]!], [mine[2]!]] });
  for (const seat of [0, 1] as Seat[]) for (const k of ELS) giveResources(h, seat, k, 6);
  return { state: h.state, A: att, D: (1 - att) as Seat, region: h.state.battle!.region };
}

const UNIT_KINDS = new Set(['unit', 'allyUnit', 'enemyUnit', 'token']);
const slotsOf = (spec: TargetSpec): number =>
  Math.max(1, typeof spec.count === 'number' ? spec.count : 1) + (spec.extraSlots ?? 0);
/** is slot i narrower than "any unit in the region"? */
const narrow = (spec: TargetSpec, i: number): boolean =>
  UNIT_KINDS.has(slotWhat(spec, i)) && (slotWhat(spec, i) !== 'unit' || !!specForSlot(spec, i).restrict);

/** what a run can change; the log is not in it */
const fingerprint = (s: GameState): string =>
  JSON.stringify([s.entities, s.players, s.stack, s.battle]);

/**
 * Runs that do nothing on this rig for a reason that is NOT a re-tested
 * restriction. Each says why; a new entry needs the same.
 */
const UNMOVED: Record<string, string> = {
  // "If you do, draw a card": the changed unit is already the opponent's, so
  // giving the opponent control of it changes nothing and draws nothing —
  // the run's ally check and the action agree.
  'Mindspore Fiend [0] slot 0': 'giving control to its controller is a no-op',
  // CR 109.3c: the lure needs its source in an {Alluring} attack column, which
  // this rig's carrier is not — an intervening condition, not the target slot.
  'Alluring Attribute [0] slot 0': 'needs an Alluring column as its source',
};

interface Probe { label: string; slot: number; acted: boolean }

/** one (effect, slot) driven with one carrier: a Probe, or why it could not be */
function probe(B: ReturnType<typeof board>, card: string, label: string, def: ReturnType<typeof effectsOf>[number],
  slot: number, carrier: (g: E) => Entity | undefined): Probe | string {
  const spec = def.targets!;
  const n = slotsOf(spec);
  const g = new E(structuredClone(B.state) as GameState);
  const { A, region } = B;
  const sourceId = carrier(g)?.id;
  const x = 4;
  // every slot filled through the engine's own cast-time machinery
  const got: ResolvedTarget[] = [];
  const taken = new Set<string>();
  for (let i = 0; i < n; i++) {
    const ref = g.targetCandidates(specForSlot(spec, i), region, undefined, A, sourceId, x, got, null)
      .find(c => !taken.has(JSON.stringify(c)) && !(i === slot && 'unit' in c && c.unit === sourceId));
    const r = ref ? g.resolveTargetRef(ref) : null;
    if (!ref || !r) return 'no full legal target set';
    taken.add(JSON.stringify(ref));
    got.push(r);
  }
  const u = got[slot] as Entity;
  const earlier = got.slice(0, slot);
  const offered = (id: EntityId) => g.targetCandidates(specForSlot(spec, slot), region, undefined, A, sourceId, x, earlier, null)
    .some(c => 'unit' in c && c.unit === id);
  // a unit in the region the slot would refuse, used by no other slot —
  // one with u's controller first, so that only the restriction differs
  const refused = g.unitsIn(region)
    .filter(w => !offered(w.id) && !got.some(t => 'id' in t && t.id === w.id) && w.id !== sourceId);
  const f = refused.find(w => w.controller === u.controller) ?? refused[0];
  if (!f) return 'nothing here fails the slot';
  // the "earlier part": u becomes f in place — card, stats, counters, controller
  const keep = { id: u.id, mods: u.mods, region: u.region };
  Object.assign(u, structuredClone({ ...f, mods: [] }), keep);
  if (offered(u.id)) return 'the slot still accepts the changed unit';
  const ctx = {
    controller: A, sourceName: card, region, targets: got, x,
    ...(sourceId !== undefined ? { sourceId } : {}),
    // a triggered effect may read its amount off the event (Beyond's "that many")
    event: { type: 'info', text: '', data: { n: 3 } },
    eraseSelf: () => {}, refundBudget: () => {},
    choose: (_k: string, dec: { options: { value: unknown }[] }) => dec.options[0]!.value,
  } as unknown as EffectCtx;
  const before = fingerprint(g.s);
  try { def.run(g, ctx); } catch { return 'the run threw'; }
  return { label, slot, acted: fingerprint(g.s) !== before || label in UNMOVED };
}

function sweep(): { probes: Probe[]; skipped: string[] } {
  const B = board();
  const probes: Probe[] = [];
  const skipped: string[] = [];
  const seen = new Set<unknown>();
  // a carrier for a unit's ability: one of the attacker's own attackers, and
  // failing that one of its units standing outside the formation ("units in
  // MY formation" counts differently for each)
  const inCols = (g: E) => new Set(g.s.battle!.columns.flat());
  const attacker = (g: E) => [...inCols(g)].map(id => g.entity(id)).find((u): u is Entity => !!u && u.controller === B.A);
  const bystander = (g: E) => g.unitsOf(B.A, B.region).find(u => !inCols(g).has(u.id));
  for (const card of allCardNames()) {
    effectsOf(card).forEach((def, k) => {
      if (seen.has(def)) return;
      seen.add(def);
      const spec = def.targets;
      if (!spec) return;
      const carriers = getCard(card).kind === 'spell' ? [() => undefined] : [attacker, bystander];
      for (let slot = 0; slot < slotsOf(spec); slot++) {
        if (!narrow(spec, slot)) continue;
        const label = `${card} [${k}] slot ${slot}`;
        const why: string[] = [];
        let done = false;
        for (const c of carriers) {
          const r = probe(B, card, label, def, slot, c);
          if (typeof r === 'string') { why.push(r); continue; }
          probes.push(r);
          done = true;
          break;
        }
        if (!done) skipped.push(`${label}: ${why.join(' / ')}`);
      }
    });
  }
  return { probes, skipped };
}

const SWEEP = sweep();

test('CT-232 sweep non-vacuity: it reaches the cards the ticket names and the families beside them', () => {
  const reached = new Set(SWEEP.probes.map(p => p.label.replace(/ \[.*$/, '')));
  for (const c of ['Minor Kraken', 'Throw off a Cliff', 'Leave None Pure', 'Unmake', 'Fight', 'Squish',
    'Abduct', 'Lumengrove Lurker', 'Reconfigure']) {
    assert.ok(reached.has(c), `${c} is driven by the sweep (skips: ${SWEEP.skipped.filter(s => s.startsWith(c)).join('; ')})`);
  }
  assert.ok(SWEEP.probes.length >= 15, `the sweep drove ${SWEEP.probes.length} narrowed slots`);
});

test('CR 704.5a / CT-232: no effect re-tests its own target restriction in its run, so a target judged legal is acted on', () => {
  const refused = SWEEP.probes.filter(p => !p.acted).map(p => p.label);
  assert.deepEqual(refused, [],
    'these runs did nothing to a target that was legal when the item began to resolve and was changed since. '
    + 'The restriction is already judged once by markIllegalTargets (CR 704.5a); drop the re-check in the run');
});
