/* sets/helpers.ts — helpers shared by the batch files. Each of these was born
 * as a per-batch copy (the batches were scripted by separate agents); the
 * bodies here are the common versions, hoisted verbatim once the copies were
 * audited as identical. A batch that needs a genuinely different flavor keeps
 * its own local — divergence is a reason to stay local, not to grow flags.
 *
 * R172 retired the standing example of that. batch-hybrids-ld-a's `eraseUnit`
 * "carried a different 'erased' payload", and the different payload was the
 * whole of the difference: both bodies were hand-rolled erases that predated
 * `E.eraseFromPlay`, and both were missing the same three things (the R157 §10
 * face revert, the R172 despawn, R72's formation repair). Divergence is a
 * reason to stay local only when the DIVERGENCE is the point; two copies of a
 * primitive that disagree by accident are one primitive with two bugs.
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

/**
 * The cost of a card KNOWN ONLY BY NAME — a card in a bin, a hand, a cache, a
 * deck, or a unit standing in play. An X card reads as **0**.
 *
 * R157 §1 is why, and it is a decision rather than an approximation:
 * *"Pips aren't a relevant part of looking at the cost of a card in Algomancy.
 * And paying X replaces the letter X on the printed card temporarily."* So an
 * X card's cost is the X that was paid for it — and a card that was never cast
 * has had no X paid, so it has no cost. Zero, not its pips (the ruling says
 * pips are not part of a cost at all) and not "excluded" (the standing steer
 * says take the reading that lets more things happen: a bin-sweep with a cost
 * bar should be able to reach an X card, not refuse to see it).
 *
 * A card that IS being cast, or has just been cast, has a real cost — use
 * `castCostOf` with the item's / event's `x`.
 */
export const manaOf = (name: CardName): number => {
  const m = getCard(name).mana;
  return m === 'X' ? 0 : m;
};

/**
 * R157 §1 — the cost of a spell that was ACTUALLY CAST: its printed mana, or,
 * on an X card, the X its caster paid ("paying X replaces the letter X on the
 * printed card temporarily").
 *
 * `x` is `StackItem.x` for an item on the stack, or the `x` the engine now
 * carries on the 'spellPlayed' / 'cardPlayed' events. `undefined` means no X
 * was paid — a free prophecy release casts an X spell for X = 0 (R111), and a
 * card read out of a zone has no cast at all — so it reads as 0, exactly as
 * `manaOf` does.
 */
export const castCostOf = (name: CardName, x?: number): number => {
  const m = getCard(name).mana;
  return m === 'X' ? (x ?? 0) : m;
};

/**
 * R157 §1 — "that spell's cost" read off a 'spellPlayed' / 'cardPlayed' event
 * (Channeled Amalgam, Arcane Concentrator, Death Greeter). The event carries
 * both the card name and, on an X card, the X that was paid; R1 says a
 * triggered ability reads its condition off the event snapshot, and this is
 * that snapshot.
 *
 * Deliberately NOT a stack lookup by (card, controller): the event is fired
 * before `pushItem`, and `commitItem(…, 'resolve')` — a deploy-timing or
 * haste-step play — never pushes the item at all, so a deploy-timing X spell
 * (Floral Singularity) would never be found. 0 when the event carries no card.
 */
export const eventCardCost = (ev: { data?: Record<string, unknown> } | null | undefined): number => {
  const name = ev?.data?.card;
  if (typeof name !== 'string') return 0;
  const x = ev?.data?.x;
  return castCostOf(name, typeof x === 'number' ? x : undefined);
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

/**
 * Erase an entity from play entirely — **now a one-line shim over the engine
 * choke point** (R172). Eight card sites across six batches call this
 * (Banishment, Celestial Purge, Borrower of Forms, Feed to Hooba, Reap the
 * Due, …), so re-pointing the body was the whole of "route the copies through
 * `E.eraseFromPlay`".
 *
 * What the hand-rolled body used to get wrong, all four of them silently:
 *  · **no `revertFace`** — R157 §10 says a transformed card exists as its
 *    FRONT side in every zone but play, so a Beyond, Codex Incarnate erased by
 *    Banishment was filed on the erased pile under the BACK face, and the
 *    Scholar of the Void that really left the game was never recorded;
 *  · **no despawn** — R157 §3 / R172: an erase is not a death but it IS a
 *    despawn, and this route fired nothing a listener could hear;
 *  · **the wrong seat** — it filed the card under `u.controller`, so a stolen
 *    unit was erased out of the THIEF's pile; the engine files it under
 *    `u.owner`, the seat whose card it is, as every bin route does;
 *  · **`unslot` instead of `removeFromFormation`** — the local mirror skipped
 *    `repairFormation`, so erasing the last unit of a column left the R72 gap
 *    open until some later death happened to close it. That helper had no
 *    other caller and is gone with the body.
 * The mods also reach the pile now (R65), which the local copy never did.
 */
export function eraseFromPlay(g: E, u: Entity): void {
  g.eraseFromPlay(u);
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

/* ── doubling a unit's effective stats (Burgeon, Surly Stalker) ─────────
 *
 * MOVED HERE FROM batch-wood-a.ts, 2026-08-25 (R177), and the reason is not
 * tidiness. `batch-water-b.ts` imported it from `batch-wood-a.ts`, and a card
 * batch importing a LATER card batch pulls that batch's module evaluation
 * forward — so its `card()` calls registered early, `allCardNames()` came back
 * in a different order, and EVERY SEEDED DEAL IN THE GAME CHANGED. Saved game
 * SMVJ went from 166 replayable actions to 65. Nothing failed; the pool was
 * still 494 cards and the suite was still green.
 *
 * `helpers.ts` registers no cards, so anything shared between batches belongs
 * here. 150-registration-order.test.ts now fails on the import shape AND on
 * the resulting order, so this cannot recur silently.
 */

/** how far either side of 0 the solver will look for a delta. Cheap: the
 *  search is a bisection, so the range costs a logarithm. */
const DOUBLE_SOLVE_RANGE = 1024;

/** `effStats` as if `dp`/`dt` had been added at layer 3, unit restored. */
function statsWithTemp(g: E, u: Entity, dp: number, dt: number): [number, number] {
  const p = u.tempPower, t = u.tempToughness;
  u.tempPower = p + dp;
  u.tempToughness = t + dt;
  try { return g.effStats(u); } finally { u.tempPower = p; u.tempToughness = t; }
}

/**
 * The smallest-magnitude layer-3 delta on `axis` (0 = power, 1 = defense) that
 * makes `effStats` read exactly `want`, holding the other axis at `other`, or
 * `null` when no delta can get there — which is a real answer, not a failure:
 * an {Unaware} unit reads at its printed numbers for every purpose (R106), so
 * nothing applied at layer 3 moves them.
 *
 * Layers 4-6 are weakly monotone in one layer-3 axis ({Tough} scales, and only
 * defense; {Balanced} is a max, so it plateaus; {Inverted} decreases), which is
 * exactly what a bisection needs — plus the equality check at the end, because
 * a plateau can step straight over `want`.
 */
function solveAxis(g: E, u: Entity, axis: 0 | 1, want: number, other: number): number | null {
  const f = (d: number): number =>
    statsWithTemp(g, u, axis === 0 ? d : other, axis === 0 ? other : d)[axis];
  if (f(0) === want) return 0;                      // prefer "change nothing"
  const lo = -DOUBLE_SOLVE_RANGE, hi = DOUBLE_SOLVE_RANGE;
  const rising = f(hi) >= f(lo);
  const at = (d: number): number => (rising ? f(d) : -f(d));
  const goal = rising ? want : -want;
  if (at(hi) < goal) return null;                   // out of reach in that direction
  let a = lo, b = hi;
  while (a < b) {                                   // smallest d with at(d) >= goal
    const mid = Math.floor((a + b) / 2);
    if (at(mid) >= goal) b = mid; else a = mid + 1;
  }
  return f(a) === want ? a : null;
}

/**
 * Double `which` of a unit's EFFECTIVE stats until regroup, as one `addTemp`.
 * 'both' solves the two axes alternately because {Balanced} couples them; four
 * passes is far more than the couplings in the pool need, and the result is
 * verified before it is applied.
 */
export function doubleStats(g: E, u: Entity, which: 'power' | 'defense' | 'both'): void {
  const [p0, t0] = g.effStats(u);
  let dp = 0, dt = 0, ok = true;
  if (which === 'both') {
    for (let pass = 0; pass < 4; pass++) {
      const np = solveAxis(g, u, 0, p0 * 2, dt);
      const nt = np === null ? null : solveAxis(g, u, 1, t0 * 2, np);
      if (np === null || nt === null) { ok = false; break; }
      if (np === dp && nt === dt) break;
      dp = np; dt = nt;
    }
    if (ok) {
      const [cp, ct] = statsWithTemp(g, u, dp, dt);
      ok = cp === p0 * 2 && ct === t0 * 2;
    }
  } else {
    const axis = which === 'power' ? 0 : 1;
    const d = solveAxis(g, u, axis, (axis === 0 ? p0 : t0) * 2, 0);
    if (d === null) ok = false;
    else if (axis === 0) dp = d;
    else dt = d;
  }
  if (!ok) {
    // Nothing at layer 3 can move this unit's numbers ({Unaware}). The change
    // is still a change — apply the plain doubling so it is there if the
    // attribute goes away — but say that the board will not show it.
    g.ev('info',
      `${u.card} reads at its printed stats — doubling changes nothing while that holds.`,
      { unit: u.id });
    g.addTemp(u, which === 'defense' ? 0 : p0, which === 'power' ? 0 : t0);
    return;
  }
  g.addTemp(u, dp, dt);
}
