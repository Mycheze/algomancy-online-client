/* Shared white-box test helpers (ports of the prototype's test rig). Tests
 * set up states directly, then drive real actions through the reducer. */
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { redactLog } from '../../server/view.ts';
import type { Entity, EntityId, ResourceKind, Seat } from '../src/types.ts';

/**
 * R203 / CT-84 — the log the SEAT is actually served. Use this, not `h.log`,
 * for anything that claims a piece of information is or is not shared.
 *
 * `h.log` is the HOTSEAT firehose: `Harness.absorb()` pushes every event's
 * `msg` into one seatless array and `visibleToSeat` is nowhere near it, so an
 * assertion written against it reads exactly the same whether the information
 * is public or private. 42-dark-b's
 * `h.log.some(l => l.includes('Thought Extraction reveals'))` passed while the
 * card was publishing an opponent's entire hand to the shared log, and passed
 * again after R197b fixed it. Two genuine leaks (R197b's three "look at a
 * hand" cards, R202's `handEntered`) survived 153 test files for that reason
 * alone, and both had to be caught from a server-adjacent file.
 *
 * Built from `h.events`, never from `h.log`. Redaction operates on EVENTS — a
 * `privateTo` tag and a per-type rewrite, both of which `msg` has already
 * thrown away — so there is only one list to read and this cannot drift from
 * `log` the way `logTypes` did (see harness.ts).
 *
 * ⚠ It lives here rather than on `Harness` because `engine/src/**` must not
 * import `server/**`: server/view.ts already imports engine/src/engine.ts, so
 * the accessor would close a cycle. Engine TESTS import server/view.ts freely
 * (144-hotseat-decision-gate, 159-glimpse-reveal-visibility, 173-look-at-a-hand),
 * which is why this is a free function over a Harness and not a method on one.
 * 174-secrecy-is-seat-aware is the lint that keeps secrecy assertions here.
 */
export function logFor(h: Harness, seat: Seat): string[] {
  return redactLog(h.events, seat, h.state.players.map(p => p.name));
}

export function giveResources(h: Harness, seat: Seat, kind: ResourceKind, n: number, state: 'open' | 'dormant' | 'expended' = 'open'): void {
  for (let i = 0; i < n; i++) h.state.players[seat]!.resources.push({ kind, state });
}

/** put a card in hand, return its index */
export function give(h: Harness, seat: Seat, name: string): number {
  h.state.players[seat]!.hand.push(name);
  return h.state.players[seat]!.hand.length - 1;
}

export function handIdx(h: Harness, seat: Seat, name: string): number {
  return h.state.players[seat]!.hand.indexOf(name);
}

/** spawn a unit into its controller's region, firing spawn triggers */
export function spawn(h: Harness, seat: Seat, name: string): EntityId {
  const e = new E(h.state);
  const u = e.spawnUnit(seat, name, e.homeRegion(seat));
  e.settle();
  return u.id;
}

export function ent(h: Harness, id: EntityId): Entity | undefined {
  return h.state.entities[id];
}

export function unitsOf(h: Harness, seat: Seat): Entity[] {
  return Object.values(h.state.entities).filter(e => e.kind === 'unit' && e.controller === seat && !e.absent);
}

export function tokensOf(h: Harness, seat: Seat): Entity[] {
  return Object.values(h.state.entities).filter(e => e.kind === 'spellToken' && e.controller === seat);
}

/** decline the haste step for both players if it engaged (R18: it only
 * appears when someone holds a payable haste card) */
export function skipHasteStep(h: Harness): void {
  for (const seat of [0, 1]) {
    if (h.state.phase === 'planning' && h.state.hasteDone && !h.state.hasteDone[seat]) {
      h.do({ type: 'doneHaste', seat });
    }
  }
}

/** finish planning for both players and skip both battle rounds → deployment */
export function toDeployment(h: Harness): void {
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') {
    h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  }
}

/** finish deployment, start the next turn, pin the initiative (= round-1
 * attacker) if given, and finish planning into the battle phase */
export function toNextBattle(h: Harness, attacker?: Seat): void {
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // initiative flips here
  if (attacker !== undefined) h.state.initiative = attacker;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
}

/** pass priority with whoever holds it */
export function pass(h: Harness): void {
  h.do({ type: 'passPriority', seat: h.state.priority! });
}

/** answer the pending targets decision by picking the option matching a ref */
export function pick(h: Harness, ref: unknown): void {
  const dec = h.state.decision!;
  const idx = dec.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify(ref));
  if (idx === -1) throw new Error(`no option matching ${JSON.stringify(ref)} in [${dec.options.map(o => JSON.stringify(o.value))}]`);
  h.do({ type: 'decide', seat: dec.seat, choice: idx });
}

/** R64: the refs the pending decision is offering, as JSON keys */
export function offered(h: Harness): string[] {
  return (h.state.decision?.options ?? []).map(o => JSON.stringify(o.value));
}

/** R64: assert a target is NOT on the pending decision's menu — an illegal
 * target is not something you choose and then have refused, it is something
 * you were never shown. */
export function notOffered(h: Harness, ref: unknown, why = ''): void {
  const keys = offered(h);
  if (keys.includes(JSON.stringify(ref))) {
    throw new Error(`${JSON.stringify(ref)} should not be a legal target${why ? ` (${why})` : ''}; menu was [${keys}]`);
  }
}

/** drive the battle phase to its end (skip attacks, no blocks, pass all
 * windows; answer trigger-ordering decisions with the identity order) */
export function finishBattle(h: Harness): void {
  let guard = 200;
  while (h.state.phase === 'battle' && guard-- > 0) {
    const b = h.state.battle!;
    const dec = h.state.decision;
    if (dec) {
      // R120: an elective-split question is answered with its first option —
      // the one-click default front-to-back share, i.e. exactly the split the
      // engine used to auto-assign before the election existed
      if (dec.kind === 'assignDamage') {
        h.do({ type: 'decide', seat: dec.seat, choice: 0 });
        continue;
      }
      if (dec.kind !== 'orderTriggers') throw new Error('unexpected decision during finishBattle');
      h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
      continue;
    }
    if (b.step === 'declare') h.do({ type: 'declareAttack', seat: b.attacker, columns: [] });
    else if (b.step === 'blocks') h.do({ type: 'declareBlocks', seat: b.defender, blocks: {} });
    else pass(h);
  }
  if (guard <= 0) throw new Error('finishBattle did not terminate');
}

/** R120: answer every pending elective combat-split question with its FIRST
 * option — on the first ask of a strike that is "default: share front-to-back",
 * the exact split the engine auto-assigned before the election existed. Tests
 * whose board raises the election but whose subject is something else call
 * this after the pass into combat damage; their numbers are unchanged. */
export function assignDefault(h: Harness): void {
  while (h.state.decision?.kind === 'assignDamage') {
    h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  }
}

export function effStats(h: Harness, id: EntityId): [number, number] {
  return new E(h.state).effStats(h.state.entities[id]!);
}

export function ownAttrs(h: Harness, id: EntityId): Set<string> {
  return new E(h.state).ownAttrs(h.state.entities[id]!);
}
