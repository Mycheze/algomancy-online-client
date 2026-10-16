/* Report #211 — the whole-pool sweep behind 452.
 *
 * A target restriction that READS X ("target unit with cost [x] or less",
 * Abduct) can only be judged once X is known, and X is chosen before the
 * targets (CR 702.3a, 702.3c). So for every such card, in every board this
 * sweep builds:
 *
 *   - the play is offered  ⇔  some X the caster could pay leaves every
 *     required target slot fillable (CR 110.7, 107.2a);
 *   - when it is played, the X menu is EXACTLY those X — none that would put
 *     the spell on the stack aimed at nothing, none missing.
 *
 * Which cards those are is DERIVED, never listed: every restriction in the
 * pool is called against a live board with a ctx whose `x` is a tripwire, and
 * whatever touches it is swept. The oracle reads targets through
 * `targetCandidates` at each X directly, not through the gate or the menu
 * under test. A restriction that reads X on any route this sweep does not
 * drive (a non-battle card, an activated ability, a variable-cost X) fails
 * loudly instead of being skipped — extend the sweep when one appears.
 *
 * Seeds 45300-45399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import {
  affinityPips, allCardNames, getCard, slotRestrict, specForSlot, targetMinimum,
  type ResolvedTarget, type TargetCtx, type TargetSpec,
} from '../src/cards/dsl.ts';
import { DECK_LIST, effectsOf } from '../src/cards/registry.ts';
import type { Element, ResourceState, Seat, TargetRef } from '../src/types.ts';
import { pass, spawn, toDeployment, toNextBattle } from './util.ts';

/** one deck unit per printed cost 0..4, the first in deck order that fields cleanly */
function unitsByCost(): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const n of DECK_LIST) {
    const c = getCard(n);
    if (c.kind !== 'unit' || typeof c.mana !== 'number' || c.mana > 4) continue;
    m.set(c.mana, [...(m.get(c.mana) ?? []), n]);
  }
  if (!m.has(0)) m.set(0, ['Unit Token']);
  return m;
}

interface Reader { card: string; route: string; spec: TargetSpec }

/** every (card, effect) whose target restriction reads ctx.x on a live board */
function xReaders(): Reader[] {
  const h = new Harness(45300);
  toDeployment(h);
  for (const [, names] of unitsByCost()) {
    for (const seat of [0, 1] as Seat[]) {
      try { spawn(h, seat, names[0]!); } catch { /* not spawnable here */ }
    }
  }
  const g = new E(h.state);
  const units = Object.values(h.state.entities).filter(e => e.kind === 'unit' && !e.absent);
  const probes: ResolvedTarget[] = [...units, { player: 0 }, { player: 1 }];
  const out: Reader[] = [];
  for (const card of allCardNames()) {
    const c = getCard(card);
    effectsOf(card).forEach((eff, k) => {
      const spec = eff.targets;
      if (!spec) return;
      let reads = false;
      for (let i = 0; i < 4 && !reads; i++) {
        const r = slotRestrict(spec, i);
        if (!r) continue;
        for (const t of probes) {
          for (const ally of [0, 1] as Seat[]) {
            const ctx = { ally, region: units[0]!.region, chosen: [] } as TargetCtx;
            Object.defineProperty(ctx, 'x', { get: () => { reads = true; return 0; }, enumerable: true });
            try { r(g, t, ctx); } catch { /* a restriction that wants more context */ }
          }
        }
      }
      if (reads) out.push({ card, route: eff === c.spellEffect ? 'spell' : `effect ${k}`, spec });
    });
  }
  return out;
}

/** CR 110.7, judged independently: can `need` distinct slots be filled at `x`? */
function fillableAt(g: E, spec: TargetSpec, region: number, ally: Seat, x: number): boolean {
  // an X count requires one counted slot, or all X of them for `min: 'X'` (CT-303)
  const need = targetMinimum(spec, spec.count !== 'X' ? (spec.count ?? 1) : spec.min === 'X' ? x : 1);
  const go = (i: number, picked: TargetRef[]): boolean => {
    if (i >= need) return true;
    const chosen = picked.map(r => g.resolveTargetRef(r)).filter((t): t is ResolvedTarget => t !== null);
    return g.targetCandidates(specForSlot(spec, i), region, undefined, ally, undefined, x, chosen)
      .filter(c => !picked.some(p => JSON.stringify(p) === JSON.stringify(c)))
      .some(c => go(i + 1, [...picked, c]));
  };
  return go(0, []);
}

const READERS = xReaders();

/** the pending decision, read fresh (an earlier guard narrows `h.state.decision` to null) */
const menu = (h: Harness) => h.state.decision;

test('the X-reading restriction sweep finds the card report 211 was about', () => {
  assert.ok(READERS.some(r => r.card === 'Abduct' && r.route === 'spell'),
    `the tripwire must catch Abduct, or it catches nothing: ${JSON.stringify(READERS.map(r => r.card))}`);
});

test('every X-reading restriction is on a route this sweep drives', () => {
  const undriven = READERS.filter(r => {
    const c = getCard(r.card);
    return !(r.route === 'spell' && c.mana === 'X' && c.timing === 'battle'
      && !(c.spellEffect?.castCost && 'n' in c.spellEffect.castCost && c.spellEffect.castCost.n === 'X'));
  });
  assert.deepEqual(undriven.map(r => `${r.card} (${r.route})`), [],
    'a restriction reads X on a route the sweep below does not drive: extend it');
});

test('an X-reading spell is offered exactly when some payable X reaches a target, and its menu is exactly those X', () => {
  const byCost = unitsByCost();
  const ran: string[] = [];
  let seed = 45310;
  for (const r of READERS) {
    const c = getCard(r.card);
    if (!(r.route === 'spell' && c.mana === 'X' && c.timing === 'battle')) continue;
    const pips = affinityPips(c.cost) as Partial<Record<Element, number>>;
    const affinity: ResourceState[] = Object.entries(pips)
      .flatMap(([el, n]) => Array.from({ length: n ?? 0 }, () => ({ kind: el as Element, state: 'open' as const })));
    const filler = (Object.keys(pips)[0] ?? 'fire') as Element;
    for (const [cost, names] of byCost) {
      for (let extra = 0; extra <= 4; extra++) {
        const h = new Harness(seed++);
        toDeployment(h);
        const A = h.state.initiative as Seat, D = (1 - A) as Seat;
        let atk: number | undefined;
        for (const n of names) {
          try { atk = spawn(h, A, n); } catch { continue; }
          if (!h.state.decision) break;
          atk = undefined;
        }
        if (atk === undefined) continue;
        toNextBattle(h, A);
        h.state.players[A]!.resources = [];
        h.state.players[D]!.resources = [...affinity.map(x => ({ ...x })),
          ...Array.from({ length: extra }, () => ({ kind: filler, state: 'open' as const }))];
        h.state.players[D]!.hand = [r.card];
        try { h.do({ type: 'declareAttack', seat: A, columns: [[atk]] }); } catch { continue; }
        pass(h);
        if (h.state.priority !== D || h.state.decision) continue;
        const where = `${r.card} vs a cost-${cost} ${getCard(h.state.entities[atk]!.card).name}, ${affinity.length + extra} open`;
        const g = new E(h.state);
        const region = h.state.battle!.region;
        const openMana = g.openMana(D);
        const want: number[] = [];
        for (let x = g.xFloor(D, r.card, { region }); x <= openMana; x++) {
          if (g.manaToPlay(D, r.card, { region, x }) > openMana) continue;
          if (fillableAt(g, r.spec, region, D, x)) want.push(x);
        }
        const offered = legalActions(h.state, D).some(a => a.type === 'playCard');
        assert.equal(offered, want.length > 0, `${where}: offered iff some payable X reaches a target (${JSON.stringify(want)})`);
        ran.push(where);
        if (!offered) continue;
        h.do({ type: 'playCard', seat: D, handIndex: 0 });
        assert.deepEqual(menu(h)?.options.map(o => o.value), want, `${where}: the X menu is exactly the aimable X`);
        h.do({ type: 'decide', seat: D, choice: 0 });
        assert.ok((menu(h)?.options.length ?? 0) > 0, `${where}: the smallest X offered has a target to choose`);
      }
    }
  }
  assert.ok(ran.length >= 10, `the sweep drove too few boards to mean anything: ${ran.length}`);
});
