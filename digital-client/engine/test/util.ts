/* Shared white-box test helpers (ports of the prototype's test rig). Tests
 * set up states directly, then drive real actions through the reducer. */
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Entity, EntityId, ResourceKind, Seat } from '../src/types.ts';

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

/** drive the battle phase to its end (skip attacks, no blocks, pass all
 * windows; answer trigger-ordering decisions with the identity order) */
export function finishBattle(h: Harness): void {
  let guard = 200;
  while (h.state.phase === 'battle' && guard-- > 0) {
    const b = h.state.battle!;
    const dec = h.state.decision;
    if (dec) {
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

export function effStats(h: Harness, id: EntityId): [number, number] {
  return new E(h.state).effStats(h.state.entities[id]!);
}

export function ownAttrs(h: Harness, id: EntityId): Set<string> {
  return new E(h.state).ownAttrs(h.state.entities[id]!);
}
