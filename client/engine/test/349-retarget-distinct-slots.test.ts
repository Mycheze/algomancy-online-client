/* R307 / CT-189 — A RETARGET MAY NOT PUT ONE OBJECT IN TWO SLOTS OF ONE PART,
 * NOR ANYTHING INTO A SLOT ITS OWN PRINTED RESTRICTION FORBIDS.
 *
 * The owner, 2026-09-30, on the board-pick review boards: "You can target the
 * same unit twice and it does 4 damage to it. That's not supposed to be
 * legal. I think that might be a wider bug." Twin Flame prints "[Switch1] I
 * deal 2 damage to each of up to two target units" — two targets, so two
 * different units.
 *
 * Casting already refused it (every earlier pick is filtered out of the next
 * slot's menu) and so did Enigmatic Warder (`E.canFillSlot`). The route that
 * did not was the wholesale RE-CHOICE: Divine Intervention, Gravitational
 * Correction and Hexbane Shiitake each built every slot's menu off the part's
 * WHOLE spec and excluded nothing but (Divine Intervention only) the slot's
 * own occupant. So slot 0 could move onto slot 1's unit, or both slots onto a
 * fresh one — Twin Flame on one Good Whale twice, 4 damage — and a per-slot
 * restriction was never asked: Fight's "target ally" slot offered every unit,
 * Channel Through's "target opponent" slot offered units, Necromorph's bin
 * slot offered units.
 *
 * §1 is the owner's board, exactly. §2 is the class: every multi-target part
 * in the pool — DERIVED from the registry, never typed — put on the stack with
 * distinct legal targets and handed to each of the three re-choosers, driven
 * by an adversary that takes a sibling's ref whenever it is offered one. §3 is
 * the write-back, which re-checks whatever it is handed.
 *
 * Seeds 34900-34999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import { apply, legalActions } from '../src/apply.ts';
import { allCardNames, ambushEffect, getCard, specForSlot } from '../src/cards/dsl.ts';
import type { EffectCtx, EffectDef, TargetSpec } from '../src/cards/dsl.ts';
import { commitRetargets } from '../src/cards/sets/helpers.ts';
import { dealScenario } from '../../server/scenarios.ts';
import type { DecisionOption, GameState, Seat, StackItem, TargetRef } from '../src/types.ts';
import { toDeployment, withE } from './util.ts';

const key = (r: unknown): string => JSON.stringify(r);

/* ═══ §1 THE OWNER'S BOARD ══════════════════════════════════════════════ */

function deal(): GameState {
  return dealScenario(216216216, ['You', 'Tester Bot'], 'shared', undefined as never, undefined,
    'board-pick-stack').state;
}
function answer(s: GameState, pred: (o: DecisionOption) => boolean, why: string): GameState {
  const dec = s.decision;
  assert.ok(dec, `${why}: no question open`);
  const i = dec.options.findIndex(pred);
  assert.ok(i >= 0, `${why}: no such option in "${dec.prompt}": ${dec.options.map(o => o.label).join(' | ')}`);
  return apply(s, { type: 'decide', seat: dec.seat, choice: i }).state;
}
function untilAsked(s: GameState, why: string): GameState {
  for (let n = 0; n < 40; n++) {
    if (s.decision?.seat === 0) return s;
    if (s.decision) { s = apply(s, { type: 'decide', seat: s.decision.seat, choice: 0 }).state; continue; }
    const seat = ([0, 1] as Seat[]).find(p => legalActions(s, p).some(a => a.type === 'passPriority'));
    assert.ok(seat !== undefined, `${why}: nobody can pass and nobody is asked`);
    s = apply(s, { type: 'passPriority', seat }).state;
  }
  assert.fail(`${why}: seat 0 was never asked`);
}
const twinFlame = (s: GameState): StackItem => {
  const it = s.stack.find(i => i.card === 'Twin Flame');
  assert.ok(it, 'Twin Flame is on the stack');
  return it;
};
const unitNamed = (s: GameState, name: string, seat: Seat): number => {
  const u = Object.values(s.entities).find(e => e.kind === 'unit' && e.card === name && e.controller === seat);
  assert.ok(u, `${name} of seat ${seat} is in play`);
  return u.id;
};
/** Divine Intervention cast at the Twin Flame, resolved to "Change the targets" */
function toFirstRetarget(): GameState {
  let s = deal();
  s = apply(s, { type: 'playCard', seat: 0, handIndex: s.players[0]!.hand.indexOf('Divine Intervention') }).state;
  s = answer(s, o => (o.value as { stack?: number })?.stack === twinFlame(s).id, 'target Twin Flame');
  s = untilAsked(s, 'change its targets?');
  return answer(s, o => o.value === true, 'change the targets');
}

test('CT-189 owner board: Divine Intervention cannot aim Twin Flame at one Good Whale twice', () => {
  let s = toFirstRetarget();
  const whale = unitNamed(s, 'Good Whale', 1);
  const [bubb, shredder] = twinFlame(s).parts[0]!.targets;
  assert.deepEqual([bubb, shredder], [{ unit: unitNamed(s, 'Bubb', 0) }, { unit: unitNamed(s, 'Chitin Shredder', 0) }],
    'the premise: Twin Flame is aimed at your Bubb and your Chitin Shredder');

  // slot 0: the opponent's Good Whale is on offer — and the sibling is not
  const first = s.decision!.options.map(o => key(o.value));
  assert.ok(first.includes(key({ unit: whale })), 'the Whale is a legal new target');
  assert.ok(!first.includes(key(shredder)),
    `slot 0 may not move onto slot 1s Chitin Shredder — menu was [${first}]`);
  s = answer(s, o => key(o.value) === key({ unit: whale }), 'slot 0 -> Good Whale');

  // slot 1: the Whale is now slot 0's, so it is not offered again
  const second = s.decision!.options.map(o => key(o.value));
  assert.ok(!second.includes(key({ unit: whale })),
    `the Whale already fills slot 0 and is not offered for slot 1 — menu was [${second}]`);
  s = answer(s, o => /^Keep /.test(o.label), 'slot 1 keeps the Chitin Shredder');

  assert.deepEqual(twinFlame(s).parts[0]!.targets, [{ unit: whale }, shredder],
    'Twin Flame now aims at the Whale and the Shredder — two different units');
  const before = s.entities[whale]!.damage ?? 0;
  for (let n = 0; n < 20 && s.stack.some(i => i.card === 'Twin Flame'); n++) {
    if (s.decision) { s = apply(s, { type: 'decide', seat: s.decision.seat, choice: 0 }).state; continue; }
    const seat = ([0, 1] as Seat[]).find(p => legalActions(s, p).some(a => a.type === 'passPriority'))!;
    s = apply(s, { type: 'passPriority', seat }).state;
  }
  assert.ok(!s.stack.some(i => i.card === 'Twin Flame'), 'Twin Flame resolved');
  assert.equal((s.entities[whale]?.damage ?? 0) - before, 2, 'the Whale takes 2, never 4');
});

test('CT-189 owner board: moving slot 0 onto its sibling is not offered, so it cannot be chosen', () => {
  const s = toFirstRetarget();
  const shredder = twinFlame(s).parts[0]!.targets[1]!;
  const dec = s.decision!;
  const i = dec.options.findIndex(o => key(o.value) === key(shredder));
  assert.equal(i, -1, 'the Chitin Shredder is not on slot 0s menu');
  // and `decide` takes an index into the menu, so nothing off it can be sent
  assert.throws(() => apply(s, { type: 'decide', seat: dec.seat, choice: dec.options.length }),
    'an index past the menu is refused');
});

/* ═══ §2 THE CLASS: EVERY MULTI-TARGET PART × EVERY RE-CHOOSER ══════════ */

/** every effect a card owns, keyed the way a stack item's part names it */
function effectsOf(name: string): [string, EffectDef][] {
  const c = getCard(name);
  const out: [string, EffectDef][] = [];
  if (c.spellEffect) out.push([`spell:${name}`, c.spellEffect]);
  if (c.graftEffect) out.push([`graft:${name}`, c.graftEffect.effect]);
  (c.abilities ?? []).forEach((a, i) => out.push([`ability:${name}#${i}`, a.effect]));
  (c.augmentText ?? []).forEach((a, i) => out.push([`augment:${name}#${i}`, a.effect]));
  if (c.ambush) out.push([`ambush:${name}`, ambushEffect(name)]);
  return out;
}
const X = 3;
const maxSlots = (t: TargetSpec): number => (t.count === 'X' ? X : (t.count ?? 1)) + (t.extraSlots ?? 0);

/** DERIVED: every part that can hold two or more targets */
const MULTI = allCardNames().flatMap(name => effectsOf(name)
  .filter(([, d]) => d.targets && maxSlots(d.targets) >= 2)
  .map(([effectKey, d]) => ({ name, effectKey, spec: d.targets! })));

test('CT-189 the multi-target parts are derived from the registry, and Twin Flame is one', () => {
  const names = new Set(MULTI.map(m => m.name));
  // a cross-check, not the list: the sweep below walks MULTI, whatever it holds
  for (const n of ['Twin Flame', 'Fight', 'Channel Through', 'Necromorph', 'Tidal Reversion']) {
    assert.ok(names.has(n), `${n} is found by the derivation`);
  }
  assert.ok(MULTI.length >= 20, `the derivation finds the pool's multi-target parts (${MULTI.length})`);
});

/** does `ref` belong to the family slot `ti`'s own spec reaches? An
 * independent reading of `what`, not the engine's candidate code. */
function fitsSlot(s: GameState, ally: Seat, spec: TargetSpec, ti: number, ref: TargetRef): boolean {
  const what = specForSlot(spec, ti).what;
  const u = 'unit' in ref ? s.entities[ref.unit] : undefined;
  switch (what) {
    case 'unit': case 'token': return !!u;
    case 'allyUnit': return !!u && u.controller === ally;
    case 'enemyUnit': return !!u && u.controller !== ally;
    case 'opponent': return 'player' in ref && ref.player !== ally;
    case 'player': return 'player' in ref;
    case 'any': return !!u || 'player' in ref;
    case 'stackSpell': case 'stackEffect': return 'stack' in ref;
    case 'cachedCard': return 'cached' in ref;
    case 'binCard': case 'anyBinCard': return 'bin' in ref;
    case 'formation': return 'formation' in ref;
  }
}

/** a board with something of every family on it, all in one region */
function board(): { h: Harness; region: number; D: Seat; A: Seat } {
  const h = new Harness(34900);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  let region = -1;
  withE(h, e => {
    region = e.homeRegion(A);
    // both players present, as in a battle there, so "target player" has two
    e.s.regions[region]!.presentSeats = [A, D];
    for (const seat of [A, D]) {
      for (const n of ['Good Whale', 'Bubb', 'Chitin Shredder', 'Good Whale']) e.spawnUnit(seat, n, region);
    }
  });
  for (const seat of [A, D]) h.state.players[seat]!.bin.push('Bubb', 'Chitin Shredder', 'Good Whale');
  return { h, region, D, A };
}

const RECHOOSERS = ['Divine Intervention', 'Gravitational Correction', 'Hexbane Shiitake'] as const;

/**
 * Put `effectKey` on the stack under `D` with distinct legal targets (the
 * cast collector's rule: first candidate of each slot, earlier picks
 * excluded), then run `who`'s retarget over it with an ADVERSARY answering:
 * whenever a menu offers the ref of a SIBLING slot, it takes it. Returns every
 * complaint; empty means the re-chooser held.
 */
function sweepOne(m: typeof MULTI[number], who: typeof RECHOOSERS[number]): { filled: number; bad: string[] } {
  const { h, region, D, A } = board();
  const bad: string[] = [];
  let filled = 0;
  withE(h, e => {
    // two spare items, so "target effect(s)" has something besides this one
    const spare = (n: number): StackItem => ({
      id: 34990 + n, kind: 'spell', label: 'Fireball', card: 'Fireball', controller: A, region,
      negated: false, parts: [{ effectKey: 'spell:Fireball', targets: [] }],
    });
    const item: StackItem = {
      id: 34900, kind: 'spell', label: m.name, card: m.name, controller: D, region, x: X,
      negated: false, parts: [{ effectKey: m.effectKey, targets: [], costPaid: { x: X } }],
    };
    e.s.stack.push(spare(0), spare(1), item);
    const part = item.parts[0]!;
    for (let ti = 0; ti < maxSlots(m.spec); ti++) {
      const c = e.slotCandidates(item, 0, ti, part.targets);
      if (!c.length) break;
      part.targets.push(c[0]!);
    }
    filled = part.targets.length;
    if (filled < 2) return;
    const work = part.targets.slice();

    const choose = (k: string, dec: { options: DecisionOption[] }): unknown => {
      const mm = /(?:retarget|rt):(\d+):(\d+)$/.exec(k);
      if (!mm) {
        if (k === 'may' || k === 'swap') return true;   // Divine Intervention / Shiitake: yes
        if (k === 'pay') return false;                  // Correction: its victim declines
        return dec.options[0]!.value;
      }
      const ti = Number(mm[2]);
      const refs = dec.options.map(o => o.value)
        .filter((v): v is TargetRef => !!v && typeof v === 'object' && !('keep' in v));
      for (const r of refs) {
        // "ally" is the item's controller — for Shiitake, its controller-to-be
        const ally = who === 'Hexbane Shiitake' ? A : item.controller;
        if (key(r) !== key(work[ti]) && !fitsSlot(e.s, ally, m.spec, ti, r)) {
          bad.push(`${who} offered ${key(r)} for slot ${ti} of ${m.effectKey}, outside that slot's own spec`);
        }
      }
      const sib = refs.find(r => work.some((w, j) => j !== ti && key(w) === key(r)));
      if (sib) {
        bad.push(`${who} offered slot ${ti} of ${m.effectKey} its sibling's ${key(sib)}`);
        work[ti] = sib;
        return sib;
      }
      const fresh = refs.find(r => key(r) !== key(work[ti]));
      if (fresh) work[ti] = fresh;
      return fresh ?? dec.options[0]!.value;
    };

    const def = who === 'Hexbane Shiitake'
      ? getCard(who).augmentText![0]!.effect : getCard(who).spellEffect!;
    const shroom = who === 'Hexbane Shiitake' ? e.spawnUnit(A, who, region) : undefined;
    const ctx = {
      controller: A, sourceName: who, region, x: X,
      ...(shroom ? { sourceId: shroom.id } : {}),
      targets: who === 'Hexbane Shiitake' ? [] : [{ stack: item.id }],
      event: who === 'Hexbane Shiitake'
        ? { type: 'spellPlayed', msg: '', data: { card: m.name, seat: D, item: item.id } } : null,
      choose,
      eraseSelf: () => {}, refundBudget: () => {},
    } as unknown as EffectCtx;
    def.run(e, ctx);

    const after = e.s.stack.find(i => i.id === item.id)!.parts[0]!.targets;
    const keys = after.map(key);
    if (new Set(keys).size !== keys.length) {
      bad.push(`${who} left ${m.effectKey} aimed at one object twice: [${keys}]`);
    }
  });
  return { filled, bad };
}

for (const who of RECHOOSERS) {
  test(`CT-189 ${who} never offers a sibling slot or a ref outside the slot spec, on every multi-target part`, () => {
    const bad: string[] = [];
    const swept: string[] = [];
    for (const m of MULTI) {
      const r = sweepOne(m, who);
      if (r.filled >= 2) swept.push(m.effectKey);
      bad.push(...r.bad);
    }
    // the board reaches units, players, the stack and bins, so EVERY derived
    // part is put on the stack with at least two targets — a part it could not
    // fill would pass by omission, so that is a failure too
    assert.deepEqual(MULTI.map(m => m.effectKey).filter(k => !swept.includes(k)), [],
      'every multi-target part was swept with two or more targets');
    assert.deepEqual(bad, [], bad.join('\n'));
  });
}

test('CT-189 canFillSlot, the Enigmatic Warder gate, refuses a sibling ref on every multi-target part', () => {
  let checked = 0;
  for (const m of MULTI) {
    const { h, region, D } = board();
    withE(h, e => {
      const item: StackItem = {
        id: 34900, kind: 'spell', label: m.name, card: m.name, controller: D, region, x: X,
        negated: false, parts: [{ effectKey: m.effectKey, targets: [], costPaid: { x: X } }],
      };
      e.s.stack.push(item);
      const part = item.parts[0]!;
      for (let ti = 0; ti < maxSlots(m.spec); ti++) {
        const c = e.slotCandidates(item, 0, ti, part.targets);
        if (!c.length) break;
        part.targets.push(c[0]!);
      }
      part.targets.forEach((_, ti) => part.targets.forEach((sib, j) => {
        if (j === ti) return;
        checked++;
        assert.equal(e.canFillSlot(item, 0, ti, sib), false,
          `${m.effectKey}: slot ${ti} may not take slot ${j}s ${key(sib)}`);
      }));
    });
  }
  assert.ok(checked >= MULTI.length * 2, `every part had a sibling pair to check (${checked})`);
});

/* ═══ §3 THE WRITE-BACK RE-CHECKS WHAT IT IS HANDED ══════════════════════ */

test('CT-189 commitRetargets refuses a write that would leave one object in two slots of a part', () => {
  const h = new Harness(34901);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  withE(h, e => {
    const region = e.homeRegion(A);
    const u1 = e.spawnUnit(A, 'Bubb', region), u2 = e.spawnUnit(A, 'Good Whale', region);
    const item: StackItem = {
      id: 34950, kind: 'spell', label: 'Twin Flame', card: 'Twin Flame', controller: A, region,
      negated: false, parts: [{ effectKey: 'spell:Twin Flame', targets: [{ unit: u1.id }, { unit: u2.id }] }],
    };
    assert.equal(commitRetargets(e, item, [[0, 0, { unit: u2.id }]], 'test'), 0, 'nothing is written');
    assert.deepEqual(item.parts[0]!.targets, [{ unit: u1.id }, { unit: u2.id }], 'the targets stay as they were');
    assert.equal(commitRetargets(e, item, [[0, 0, { unit: u2.id }], [0, 1, { unit: u1.id }]], 'test'), 2,
      'a swap is two distinct targets, and is written');
    assert.deepEqual(item.parts[0]!.targets, [{ unit: u2.id }, { unit: u1.id }]);
  });
});
