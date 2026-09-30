/**
 * WHAT A STACK ITEM LOOKS LIKE WHEN IT IS NOT A CARD (owner, 2026-09-29).
 *
 * "It's hard to tell the difference between an ability and a card being
 * actually played. On the stack, a unit's triggered effect looks the same as if
 * that unit was on the stack itself." A trigger's `item.card` is the source's
 * own name, so the strip drew the unit's whole scan and the only difference was
 * one word in an 8px tag.
 *
 * The owner's picture, and the choices settled against the mockups:
 *
 *  · ONLY triggered and activated abilities change shape. A copy, a spell
 *    token, an ambush and a virus stay full cards.
 *  · The ability is a SLICE of the scan: the printed name bar and the top of
 *    the art are cut off (rows `EFFECT_ART_TOP`…1 — the bar alone is ~5.5% of
 *    the scan, which does not read as shorter at 78px), and a name line —
 *    "Chombot · trigger" — sits where the bar was.
 *  · A graft rides along: every graft part hangs its strip below, the same
 *    strip it hangs below the unit on the field. Two grafts, two strips — the
 *    item gets longer, deliberately.
 *  · An augment's ability is a FRANKEN-CARD: the host's art, with the host's
 *    own rules box cut away and the donating card's spliced in. It is named
 *    after the host — the unit that was clicked, the "me" of the text.
 *
 * The data it reads, and why it is enough: the engine puts the card whose TEXT
 * is running in `item.card` and the body it runs on in `sourceId`
 * (engine.ts queueTrigger / apply.ts activateAbility). For a unit's own text
 * the two agree; for an augment mod's text, or a face lent by an Ancient One
 * (R118), they do not — and that disagreement is exactly the Franken-card.
 * Graft parts name their card in the key (`graft:<name>`), so their strips
 * survive the graft's entity leaving play.
 *
 * Pure, and tested by ui/test/342-effect-face.test.ts; ui/main.ts only paints.
 */
import { effectByKey } from '../engine/src/cards/dsl.ts';
import { E } from '../engine/src/engine.ts';
import type { CardName, GameState, StackItem, TargetRef } from '../engine/src/types.ts';
import { rowFor } from './cardindex.ts';

/** where an ability's art starts, as a fraction of the scan's height (the
 * owner picked this cut off the mockups: the bar and the top fifth of the art) */
export const EFFECT_ART_TOP = 0.30;

export interface EffectFace {
  /** the name line: the body the ability belongs to */
  name: CardName | string;
  word: 'trigger' | 'ability';
  /** the name bar's colours, as printed: the named card's affinities
   * (`--fire`, `--wood` …), one for a mono card, two for a hybrid, none for a
   * card the catalogue does not know (the bar falls back to a neutral slate) */
  tint: string[];
  /** the art slice, rows EFFECT_ART_TOP…`to` of this card's scan. Absent for
   * an ability with no card at all — the name line carries it alone. */
  art?: { card: CardName; to: number };
  /** the Franken splice: this card's rules box, from `from` to the bottom */
  text?: { card: CardName; from: number };
  /** where the text came from, for the zoom's rules box — set whenever the
   * text is not the body's own, spliced or not */
  from?: string;
  /** each graft part's strip, in part order; `peek` is the measured share of
   * the scan it shows (absent → the stylesheet's default) */
  grafts: { card: CardName; peek?: number }[];
}

const textTop = (card: CardName): number | null => rowFor(card)?.textTop ?? null;
const modPeek = (card: CardName): number | undefined => rowFor(card)?.modPeek ?? undefined;
const tintOf = (card: string): string[] => (rowFor(card)?.factions ?? []).slice(0, 2);

/**
 * The face of a stack item, or null when it should be drawn as the card it is.
 * `state` is where its source is looked up; a source that has left play (every
 * "when I die" trigger) just means no splice — the ability is drawn from its
 * own card.
 */
export function effectFace(item: StackItem, state: GameState): EffectFace | null {
  if (item.kind !== 'triggered' && item.kind !== 'activated') return null;
  const word = item.kind === 'triggered' ? 'trigger' : 'ability';
  const host = item.sourceId !== undefined ? state.entities[item.sourceId] : undefined;
  let body: CardName | undefined;
  try { body = host ? new E(state).faceName(host) : undefined; } catch { body = undefined; }
  const textCard = item.card;
  const grafts = item.parts
    .filter(p => !p.spent && p.effectKey.startsWith('graft:'))
    .map(p => {
      const card = p.effectKey.slice('graft:'.length);
      const peek = modPeek(card);
      return peek !== undefined ? { card, peek } : { card };
    });

  // nothing names a card: the name line is all there is
  if (!textCard && !body) return { name: item.label, word, tint: [], grafts };
  // the body's own text (or the body is gone): one card, one slice
  if (!textCard || !body || textCard === body) {
    const card = (textCard ?? body)!;
    return { name: card, word, tint: tintOf(card), art: { card, to: 1 }, grafts };
  }

  // the text is borrowed. Say from where…
  const mod = host?.mods.map(id => state.entities[id]).find(m => m?.card === textCard);
  const from = mod
    ? `from ${textCard}, ${mod.appliedAs === 'graft' ? 'grafted onto' : 'augmented under'} ${body}`
    : `${textCard}'s text, lent to ${body}`;
  // …and splice it in where both scans say where their rules boxes start
  const cut = textTop(body), top = textTop(textCard);
  if (cut !== null && top !== null && cut > EFFECT_ART_TOP) {
    return { name: body, word, tint: tintOf(body), art: { card: body, to: cut }, text: { card: textCard, from: top }, from, grafts };
  }
  // an unmeasured scan: the body whole, the lender hanging below it like a mod
  const peek = modPeek(textCard);
  return {
    name: body, word, tint: tintOf(body), art: { card: body, to: 1 }, from,
    grafts: [peek !== undefined ? { card: textCard, peek } : { card: textCard }, ...grafts],
  };
}

/**
 * WHO DOES WHAT (owner, 2026-09-29): "when an effect has more than one target
 * and will do different things to the different targets, it's not always
 * obvious which target is which … Reconfigure puts a target unit UNDER another
 * target unit." The card declares the jobs (TargetSpec.roles, cards/dsl.ts);
 * this fills them in — "moves Graxxlid onto Chombot" — for the stack caption,
 * the one place the owner wanted them.
 *
 * One clause per live part, joined ", then " (a graft resolves after its
 * carrier, Manual p.33). A part without `roles` keeps its plain list. Null when
 * NO part declares roles: the caption's old "→ A, B" stands untouched, which is
 * every symmetric card (Twin Flame) and every single-target one.
 *
 * `label` names a target and `text` escapes the words between — main.ts passes
 * HTML-making ones, the test passes identities.
 */
export function roleSentence(item: StackItem, label: (t: TargetRef) => string,
  text: (s: string) => string = s => s): string | null {
  let any = false;
  const clauses = item.parts.filter(p => !p.spent && p.targets.length).map(p => {
    let roles: string | undefined;
    try { roles = effectByKey(p.effectKey).targets?.roles; } catch { roles = undefined; }
    if (!roles) return p.targets.map(label).join(', ');
    any = true;
    return roles.split(/(\{\d+\+?\})/).map(bit => {
      const m = /^\{(\d+)(\+?)\}$/.exec(bit);
      if (!m) return text(bit);
      const i = Number(m[1]);
      // a target that has left since the cast (R5) leaves a dash, not a hole
      if (m[2]) return p.targets.slice(i).map(label).join(', ') || text('—');
      const t = p.targets[i];
      return t ? label(t) : text('—');
    }).join('');
  });
  return any ? clauses.join(text(', then ')) : null;
}

/**
 * TARGET MISSING (owner, 2026-09-30): "When something lower down on the stack
 * suddenly has its target removed, it could be nice to have a visual indicator
 * why the arrow isn't showing up, just in case the stack is very large and
 * hard to track."
 *
 * The targets of a still-live part that are no longer there to be hit — by the
 * ENGINE's own test (`E.targetStillLegal`, the one resolution uses to fizzle
 * an item under R5), so the strip cannot mark a target lost that the rules
 * would still hit, or miss one they would skip. A negated item is left out:
 * it is already off the stack and does nothing either way.
 */
export function lostTargets(item: StackItem, state: GameState): TargetRef[] {
  if (item.negated) return [];
  let e: E;
  try { e = new E(state); } catch { return []; }
  const out: TargetRef[] = [];
  const seen = new Set<string>();
  for (const p of item.parts) {
    if (p.spent) continue;
    for (const t of p.targets) {
      const k = JSON.stringify(t);
      if (seen.has(k)) continue;
      seen.add(k);
      if (!e.targetStillLegal(t)) out.push(t);
    }
  }
  return out;
}
