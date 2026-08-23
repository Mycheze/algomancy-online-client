/* sets/helpers.ts — helpers shared by the batch files. Each of these was born
 * as a per-batch copy (the batches were scripted by separate agents); the
 * bodies here are the common versions, hoisted verbatim once the copies were
 * audited as identical. A batch that needs a genuinely different flavor keeps
 * its own local (e.g. batch-hybrids-ld-a's eraseUnit carries a different
 * 'erased' payload) — divergence is a reason to stay local, not to grow flags.
 */
import type {
  CardName, EffectPart, EngineEvent, Entity, EntityId, Seat, StackItem, TargetRef,
} from '../../types.ts';
import type { E } from '../../engine.ts';
import { getCard, type EffectCtx, type EffectDef, type XPreviewRow } from '../dsl.ts';

/** The unit an effect is anchored on, IF it is still in play: triggered and
 * activated abilities carry their source's id; spells have none. */
export const selfOf = (g: E, ctx: EffectCtx): Entity | undefined =>
  ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;

/** Is this resolved target (or event datum) an entity? Only entities carry an
 * `id` — a player / stack / cached / bin target does not. */
export const isEnt = (t: unknown): t is Entity =>
  !!t && typeof t === 'object' && 'id' in t;

/**
 * R57: the unit a modal part is aimed at, for an `EffectDef.modes` prompt.
 *
 * `E.collectModes` runs AFTER `collectPartTargets`, so by the time a mode is
 * asked the target is already declared on the part — which is the whole point
 * of that ordering: Burgeon can say "double Good Whale's power (5 → 10) or
 * defense (3 → 6)?" rather than "double its power or defense?".
 *
 * Undefined when the part has no target yet or it is not an entity; a `modes`
 * function must stay total, because it is called before the item exists on the
 * stack and must never throw the cast away.
 */
export const modeTargetOf = (g: E, part: EffectPart): Entity | undefined => {
  const ref = part.targets[0];
  if (!ref) return undefined;
  const t = g.resolveTargetRef(ref);
  return isEnt(t) ? t : undefined;
};

/**
 * R57: the modal half for a card run INLINE — a spell played out of another
 * effect's resolution (Tides of the Cosmos, Spell Excavation), where there is
 * no cast window and no stack item because the card never reaches the stack.
 *
 * `E.collectModes` is the normal home for this and it is where the fix lives:
 * a modal card put on the stack must say which half it is before anybody may
 * respond. An inline play has no response window AT ALL — that is what makes
 * it an approximation in the first place — so there is no earlier moment to
 * move the question to, and asking here is the honest answer rather than a
 * relapse. It is `ctx.choose`, so it suspends and replays like every other
 * mid-resolution question.
 *
 * `undefined` for an effect that declares no modes; the single value (or
 * `null`) when there is nothing to choose between, matching collectModes.
 */
export function inlineMode(
  g: E, ctx: EffectCtx, def: EffectDef, key: string,
  o: { card?: CardName; x?: number; targets?: TargetRef[]; event?: EngineEvent | null } = {},
): unknown {
  if (!def.modes) return undefined;
  // a stand-in for the item that never exists: `modes` reads x, the declared
  // target refs and the trigger event, and an inline play has all three or
  // legitimately has none
  const part: EffectPart = { effectKey: '', targets: o.targets ?? [] };
  const item: StackItem = {
    id: -1, kind: 'spell', label: o.card ?? ctx.sourceName, controller: ctx.controller,
    region: ctx.region, negated: false, parts: [part],
    ...(o.card !== undefined ? { card: o.card } : {}),
    ...(o.x !== undefined ? { x: o.x } : {}),
    ...(o.event !== undefined ? { event: o.event } : {}),
  };
  const options = def.modes.options(g, item, part);
  if (options.length < 2) return options.length ? options[0]!.value : null;
  return ctx.choose(key, {
    kind: 'electricPath', seat: ctx.controller,
    prompt: def.modes.prompt(g, item, part), options,
  });
}

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

/* ── UI-only X previews (#85) ──────────────────────────────────────────── */

/** One row per seat for a `CardBehavior.xPreviewRows`, labelled the way report
 * #85 asked for it: 'you' for the hand owner, the opponent by name. `f` is the
 * card's own reading of the battle ledger for that seat.
 *
 * PURE and UI-only, like the hook it feeds — never call it from an effect.
 * `1 - seat` rather than engine.ts's `other()`: this module imports E as a
 * TYPE only, and a value import from engine.ts would close a module cycle. */
export const perSeatRows = (g: E, seat: Seat, f: (s: Seat) => number): XPreviewRow[] =>
  ([seat, (1 - seat) as Seat] as Seat[]).map(s => ({ label: s === seat ? 'you' : g.pname(s), x: f(s) }));

/** The `lifeLost:<seat>` battle ledger — E.loseLife bumps it, it is region
 * -keyed (R14) and wiped at the start of every battle. Copied out of the three
 * batch files that each had their own local, so a preview and the effect it
 * previews cannot read the counter two different ways. */
export const lifeLostIn = (g: E, region: number, seat: Seat): number =>
  g.battleCounter(region, `lifeLost:${seat}`);
/** the `lifeGained:<seat>` twin of `lifeLostIn` (E.gainLife bumps it, R49) */
export const lifeGainedIn = (g: E, region: number, seat: Seat): number =>
  g.battleCounter(region, `lifeGained:${seat}`);
