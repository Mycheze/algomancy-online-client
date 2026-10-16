/* Report #215 (VDDT, LordZZX): "X=10 on Vroot".
 *
 * Vroot — "[Augment] When my column deals combat damage, each opponent gains
 * that much life." — resolved a gain of 4, its OWN column's share (CR 608.9a),
 * while the stack chip said X=10: the chip read the combat face-damage event's
 * `n`, which totals every connecting column. The engine was right; the UI
 * guessed. The cure is a DECLARATION, `EffectDef.eventAmount`, read through one
 * function (`eventAmountOf`) by the resolver, the stack chip (inspect.ts
 * stackItemX) and the does-line amount (doesline.ts amountOf) alike.
 *
 * Guards:
 *  · the board from the report in miniature: Vroot (4/4) and a 1/1, two
 *    unblocked columns. The chip says X=4 (it said X=5), the does-line amount
 *    is 4, and the opponent gains 4.
 *  · the same with Vroot as a VIRUS on a host — the host is the trigger's
 *    source (E.queueTrigger passes host.id), so the host's column counts.
 *  · a sweep: every effect in the pool whose resolver reads a per-column share
 *    off a combat event DECLARES it, so no fourth reader can disagree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { allCardNames, effectByKey, getCard } from '../../engine/src/cards/dsl.ts';
import { stackItemX, stackXMark } from '../inspect.ts';
import { amountOf } from '../doesline.ts';
import { pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { EntityId, Seat, StackItem } from '../../engine/src/types.ts';

function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  return u.id;
}

/** run combat until Vroot's trigger sits on the after-combat stack */
function toVrootOnStack(h: Harness): StackItem {
  let guard = 80;
  while (guard-- > 0) {
    const it = h.state.stack.find(s => s.kind === 'triggered' && /Vroot/.test(s.card ?? s.label + (s.parts[0]?.effectKey ?? '')));
    if (it) return it;
    const d = h.state.decision;
    if (d) {
      h.do({ type: 'decide', seat: d.seat, choice: d.kind === 'orderTriggers' ? d.options.map((_, i) => i) : 0 });
      continue;
    }
    if (h.state.phase !== 'battle') break;
    pass(h);
  }
  throw new Error('Vroot never reached the stack');
}

function drain(h: Harness): void {
  let guard = 40;
  while (h.state.stack.length && guard-- > 0) {
    const d = h.state.decision;
    if (d) { h.do({ type: 'decide', seat: d.seat, choice: 0 }); continue; }
    pass(h);
  }
}

function attackTwoColumns(h: Harness, A: Seat, D: Seat, first: EntityId, second: EntityId): void {
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[first], [second]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
}

test('report 215 - Vroot beside a 1/1 shows X=4 on the stack and the opponent gains 4', () => {
  const h = new Harness(6640);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const v = spawn(h, A, 'Vroot');                 // 4/4
  const solo = tok(h, A, 1, 1);
  attackTwoColumns(h, A, D, v, solo);
  const item = toVrootOnStack(h);
  assert.equal(item.event?.data?.['n'], 5, 'the face event totals both columns: 4 + 1');
  assert.equal(stackXMark(item), 'X=4', 'the chip shows MY column share, not the table total');
  assert.deepEqual(stackItemX(item).filter(r => r.kind === 'event').map(r => r.x), [4]);
  assert.equal(amountOf(item, item.parts[0]!, h.state)?.x, 4, 'the does-line reads the same 4');
  const life0 = h.state.players[D]!.life;
  drain(h);
  assert.equal(h.state.players[D]!.life, life0 + 4, 'and the gain it resolves with is that 4');
});

test('report 215 - Vroot as a virus reads its HOST column share', () => {
  const h = new Harness(6641);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const host = tok(h, A, 3, 3);
  const solo = tok(h, A, 1, 1);
  const g = new E(h.state);
  g.attachMod(g.entity(host)!, 'Vroot', A, 'augment');
  g.settle();
  attackTwoColumns(h, A, D, host, solo);
  const item = toVrootOnStack(h);
  assert.equal(item.sourceId, host, 'donated text fires with the HOST as its source');
  const total = item.event?.data?.['n'] as number;
  assert.ok(total > 3, `the face event totals both columns (it was ${total})`);
  const share = h.q.effStats(h.q.entity(host)!)[0];
  assert.equal(stackXMark(item), `X=${share}`);
  const life0 = h.state.players[D]!.life;
  drain(h);
  assert.equal(h.state.players[D]!.life, life0 + share, 'the gain is the host column share too');
});

/** every effect in the pool, by its registry key */
function* everyEffect(): Generator<[string, ReturnType<typeof effectByKey>]> {
  for (const name of allCardNames()) {
    const c = getCard(name);
    for (const [field, tag] of [['abilities', 'ability'], ['augmentText', 'augment']] as const) {
      const list = (c[field] as { effect?: unknown }[] | undefined) ?? [];
      for (let i = 0; i < list.length; i++) {
        if (list[i]?.effect) yield [`${tag}:${name}#${i}`, effectByKey(`${tag}:${name}#${i}`)];
      }
    }
    if (c.graftEffect) yield [`graft:${name}`, effectByKey(`graft:${name}`)];
    if (c.spellEffect) yield [`spell:${name}`, effectByKey(`spell:${name}`)];
  }
}

test('report 215 - every effect that reads a per-column combat share declares eventAmount', () => {
  // The resolver's own source is the evidence: a run that asks for a column's
  // share (faceDamageDealtBy / combatFaceHits / the hits breakdown) computes an
  // amount that is NOT the event n, so the UI must be told.
  const PER_COLUMN = /faceDamageDealtBy|combatFaceHits|\['hits'\]|\.hits\b/;
  const undeclared: string[] = [];
  let declared = 0;
  for (const [key, def] of everyEffect()) {
    const src = String(def.run);
    if (def.eventAmount) declared++;
    if (PER_COLUMN.test(src) && !def.eventAmount) undeclared.push(key);
  }
  assert.deepEqual(undeclared, [], 'these read a per-column share the stack chip cannot see');
  assert.ok(declared >= 1, 'Vroot declares it (the sweep is not vacuous)');
});
