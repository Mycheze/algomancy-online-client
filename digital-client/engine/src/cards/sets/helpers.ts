/* sets/helpers.ts — helpers shared by the batch files. Each of these was born
 * as a per-batch copy (the batches were scripted by separate agents); the
 * bodies here are the common versions, hoisted verbatim once the copies were
 * audited as identical. A batch that needs a genuinely different flavor keeps
 * its own local (e.g. batch-hybrids-ld-a's eraseUnit carries a different
 * 'erased' payload) — divergence is a reason to stay local, not to grow flags.
 */
import type { CardName, Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { getCard, type EffectCtx } from '../dsl.ts';

/** The unit an effect is anchored on, IF it is still in play: triggered and
 * activated abilities carry their source's id; spells have none. */
export const selfOf = (g: E, ctx: EffectCtx): Entity | undefined =>
  ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;

/** Is this resolved target (or event datum) an entity? Only entities carry an
 * `id` — a player / stack / cached / bin target does not. */
export const isEnt = (t: unknown): t is Entity =>
  !!t && typeof t === 'object' && 'id' in t;

/** True while endTurn() is resolving end-of-turn triggers — a ctx.choose
 * suspension there strands the game (see batch-fire-a), so choose-based
 * effects reachable then must auto-pick deterministically instead. */
export const inEndOfTurn = (g: E): boolean =>
  g.s.phase === 'deploy' && g.s.deployPlayer === null;

/** printed mana cost of a card; an X card reads as 0, its printed floor
 * (same rule as dsl's printedCost — kept here for the batch files' idiom) */
export const manaOf = (name: CardName): number => {
  const m = getCard(name).mana;
  return m === 'X' ? 0 : m;
};

/** is the card a unit when in play? (spell units are; spell tokens are not) */
export const isUnitCard = (name: CardName): boolean => {
  const k = getCard(name).kind;
  return k === 'unit' || k === 'spellUnit';
};

/** `chooser` picks one of `candidates` (auto-picked when only one). Returns
 * null when there is nothing to pick. Plan-then-commit: call all chooses
 * before mutating (the engine replays the part on suspension). */
export const chooseUnit = (
  g: E, ctx: EffectCtx, key: string, chooser: Seat, candidates: Entity[], prompt: string,
): Entity | null => {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0]!;
  const id = ctx.choose(key, {
    kind: 'electricPath', seat: chooser, prompt,
    options: candidates.map(u => ({ label: u.card, value: u.id })),
  }) as EntityId;
  return g.entity(id) ?? null;
};

/** chooseUnit's id-returning sibling: `chooser` picks one of `pool` (forced
 * when only one), null when the pool is empty. The caller re-looks the id up
 * at use, so a unit that died mid-plan is its problem to notice. */
export const pickUnit = (
  ctx: EffectCtx, key: string, chooser: Seat, pool: Entity[], prompt: string,
): EntityId | null => {
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0]!.id;
  return ctx.choose(key, {
    kind: 'electricPath', seat: chooser, prompt,
    options: pool.map(u => ({ label: u.card, value: u.id })),
  }) as EntityId;
};

/** remove an id from every formation column / the sent-attacker list (mirror
 * of the engine's private removeFromFormation) */
export function unslot(g: E, id: EntityId): void {
  const b = g.s.battle;
  if (!b) return;
  for (const col of [...b.columns, ...Object.values(b.blocks)]) {
    const i = col.indexOf(id);
    if (i !== -1) col.splice(i, 1);
  }
  const si = b.sentAttackers.indexOf(id);
  if (si !== -1) b.sentAttackers.splice(si, 1);
}

/** Erase an entity from play entirely: no bin, no death/despawn triggers, and
 * so (R40) no trash either; its mods are erased with it (Celestial Purge's
 * pattern). */
export function eraseFromPlay(g: E, u: Entity): void {
  for (const modId of u.mods) delete g.s.entities[modId];
  delete g.s.entities[u.id];
  unslot(g, u.id);
  g.ev('erased', `${u.card} is ERASED (no bin, no death).`, { unit: u.id, card: u.card, seat: u.controller });
}
