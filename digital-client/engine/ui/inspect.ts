/* DOM-free view logic, so it can be unit-tested without a browser.
 *
 * Everything here answers a question the UI asks about game state and card
 * data — "what is this stack item actually going to do?", "will clicking this
 * ability cost me something I can't get back?" — and none of it touches the
 * document. main.ts renders the answers; test/50-ui-inspect.test.ts checks
 * them.
 */
import { getCard } from '../src/cards/dsl.ts';
import type { E } from '../src/engine.ts';
import { specForSlot } from '../src/cards/dsl.ts';
import type { ActivatedAbility } from '../src/cards/dsl.ts';
import type { Action, CardName, Entity, GameState, Seat, StackItem } from '../src/types.ts';

/** collapse the printed text markup to one readable line */
const clean = (s: string): string => s.replace(/\{\/n\}/g, ' ').replace(/\s+/g, ' ').trim();

/** a graftable card's text from its [Switch] marker onward — the half that
 * actually transfers when it is grafted */
export function switchClause(name: CardName): string {
  let t = '';
  try { t = getCard(name).text; } catch { return ''; }
  const m = /\[switch1?\]/i.exec(t);
  return clean(m ? t.slice(m.index) : t);
}

/**
 * The rules text of ONE part of a stack item, and the card it came from.
 *
 * Playtest ask: a triggered or grafted ability on the stack used to preview
 * the whole card, which for a graft stack is a wall of text that says nothing
 * about what is about to happen. A part maps back to exactly one authored
 * clause through its effect key (dsl.ts):
 *   spell:<Card>        the card itself is the effect — its printed text
 *   ability:<Card>#<i>  abilities[i]
 *   augment:<Card>#<i>  augmentText[i] (text-box [Augment] text)
 *   graft:<Card>        the card's [Switch]-marked clause
 * Returns null for a key that names nothing renderable, so callers can fall
 * back to the item label rather than print an empty row.
 */
export function partText(effectKey: string): { source: CardName; text: string; graft?: boolean } | null {
  const ci = effectKey.indexOf(':');
  if (ci < 0) return null;
  const tag = effectKey.slice(0, ci), rest = effectKey.slice(ci + 1);
  try {
    if (tag === 'spell') {
      const t = clean(getCard(rest).text);
      return t ? { source: rest, text: t } : null;
    }
    if (tag === 'graft') {
      const t = switchClause(rest);
      return t ? { source: rest, text: t, graft: true } : null;
    }
    const [name, idxStr] = rest.split('#');
    const i = Number(idxStr);
    if (!name || !Number.isInteger(i)) return null;
    const c = getCard(name);
    const ab = tag === 'ability' ? c.abilities?.[i] : tag === 'augment' ? c.augmentText?.[i] : undefined;
    if (!ab?.label) return null;
    return { source: name, text: ab.label };
  } catch { return null; }
}

/** every live part of a stack item, in resolution order, as attributed text.
 * Spent parts (a bounded graft already used this turn, a declined cost) are
 * dropped — they will do nothing, so showing them would mislead. */
export function stackAbilityRows(item: StackItem): { source: CardName; text: string; graft?: boolean }[] {
  const out: { source: CardName; text: string; graft?: boolean }[] = [];
  for (const p of item.parts) {
    if (p.spent) continue;
    const t = partText(p.effectKey);
    if (t) out.push(t);
  }
  return out;
}

/** the ActivatedAbility an activateAbility action refers to, resolving its
 * `via` (own abilities / own [Augment] text / an augment mod's donated text) */
export function abilityOf(
  state: GameState, unit: Entity, a: Extract<Action, { type: 'activateAbility' }>,
): ActivatedAbility | undefined {
  try {
    const list = a.via === undefined
      ? getCard(unit.card).abilities
      : getCard(a.via === 'augment' ? unit.card : state.entities[a.via.mod]?.card ?? '').augmentText;
    const ab = list?.[a.abilityIndex];
    return ab && ab.type === 'activated' ? ab : undefined;
  } catch { return undefined; }
}

/**
 * Should activating this ask "are you sure?" before it fires?
 *
 * Playtest report: "Sacrifice me:" abilities are very easy to fire by accident
 * during battle — you meant to pick the unit as a blocker — and there is no
 * taking it back. Two things make one safe to fire on a single click:
 *  - the cost is only mana, so nothing permanent is spent; or
 *  - the engine will stop and ask for a TARGET, which is both a moment to
 *    notice and (since R57) strictly before anything is paid.
 *
 * The target test is "will a decision actually appear", not "does the card
 * print the word target". An ability whose targets have no legal candidates
 * skips the decision entirely and pays the cost anyway — precisely the trap
 * that "up to one target" with nothing to aim at sets.
 */
export function activationNeedsConfirm(
  e: E, unit: Entity, a: Extract<Action, { type: 'activateAbility' }>,
): boolean {
  const ab = abilityOf(e.s, unit, a);
  if (!ab) return false;
  const c = ab.cost;
  const irreversible = !!(c.sacrificeSelf || c.life || c.discard
    || c.sacrificeOther || c.discardOrSacrifice || c.debt);
  if (!irreversible) return false;
  const spec = ab.effect.targets;
  if (!spec) return true;                       // nothing will stop to ask
  try {
    return e.targetCandidates(
      specForSlot(spec, 0), e.actionRegion(unit.controller), undefined, unit.controller,
    ).length === 0;
  } catch { return true; }
}

/**
 * The cards `seat` could release from their cache RIGHT NOW, by name.
 *
 * Playtest ask: a reminder before ending deployment, because the cache is a
 * zone nobody has muscle memory for and a prophecy you already paid for is
 * easy to walk past. "Playable now" is narrower than "permitted" — a fulfilled
 * prophecy still has to clear normal timing (R42) — and the legal-action list
 * is the only thing that knows both, so this reads from there rather than
 * re-deriving it. Deduped and index-ordered: one entry may be offered by
 * several actions.
 */
export function playableCachedNames(cache: { card: CardName }[], legal: Action[]): CardName[] {
  const idx = new Set(legal
    .filter((a): a is Extract<Action, { type: 'playCached' }> => a.type === 'playCached')
    .map(a => a.index));
  return [...idx].sort((x, y) => x - y).map(i => cache[i]?.card).filter((n): n is CardName => !!n);
}

/** seat helper kept here so main.ts imports one module, not two */
export type { Seat };

/**
 * Should the client auto-pass this priority window because the thing about to
 * resolve is a trigger the player has chosen to yield to?
 *
 * Playtest 2026-08-20 ("auto yield literally isn't doing anything"): the old
 * test was `stack.every(item is a yielded trigger)`. Passing priority only
 * ever resolves the TOP of the stack, so requiring the whole stack to be
 * yielded meant that the moment anything else was on it — the opponent's
 * spell, a second unit's trigger, the very common case in a real game — the
 * chip did nothing at all. One of Bena's stacks that turn held four triggers
 * from four different units.
 *
 * The right question is about the top item only. Everything under it gets its
 * own window later, and this runs again for each.
 */
export function shouldAutoYield(
  state: GameState, seat: Seat, yielded: ReadonlySet<number>,
): boolean {
  if (!yielded.size) return false;
  // a priority window of my own, with nothing being asked of anybody
  if (state.priority !== seat || state.decision) return false;
  const top = state.stack[state.stack.length - 1];
  if (!top || top.negated) return false;
  return top.kind === 'triggered' && top.sourceId !== undefined && yielded.has(top.sourceId);
}
