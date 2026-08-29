/**
 * BL-21 — WHAT YOUR OPPONENT DID, READ AT A GLANCE.
 *
 * The owner, 2026-08-25:
 *
 *   "I mean when you see what your opponent did, it's very hard to actually
 *    read. It's getting overly cluttered and verbose and doesn't actually show
 *    the mods they do, that sort of thing. After dismissing it, there's also a
 *    weird flurry of their stack and abilities, which is weird and rudundant
 *    there."
 *
 * Three complaints. This module answers the first two; the third is a hold in
 * `ui/main.ts` and has nothing to do with what the surface says.
 *
 * ── ⚠ THE MEASUREMENT, because the first complaint is worse than it sounds ──
 *
 * A deployment of two Good Whales with a Hooba-Lin augmented onto the first
 * one produced exactly ONE row on screen:
 *
 *   Good Whale | Player 2 spawns Good Whale, Hooba-Lin targets Good Whale,
 *                Hooba-Lin augments Good Whale (Player 2's) — it is now
 *                Unstable, Player 2 spawns Good Whale.
 *
 * That is not merely verbose, it is WRONG: the last clause is a DIFFERENT Good
 * Whale, folded into the first one's row. And Hooba-Lin — the mod he is asking
 * to see — has no scan anywhere on the surface.
 *
 * Both come from the same cause. The old grouping ran `findCardName` over the
 * message PROSE and grouped consecutive messages that produced the same name,
 * and `findCardName` returns the LONGEST card name in the string. So a
 * two-word host ("Good Whale") outranks a one-word mod ("Hooba-Lin") in every
 * message that mentions both, and two units with the same card name are one
 * group by construction.
 *
 * ── SO THIS READS THE STRUCTURE, NOT THE PROSE ────────────────────────
 *
 * Every event the reveal carries already says who it is about, in `data`, and
 * it survives redaction to the opponent intact — measured, not assumed:
 *
 *   spawned     { seat, unit, region, card, from }
 *   targeted    { unit, region }
 *   modApplied  { host, mod, appliedAs }
 *
 * `unit`/`host` is the row, `mod` is the chip on it. Two Good Whales are two
 * different entity ids and therefore two rows, whatever they are called; a mod
 * is named by `data.mod` and cannot be outranked by anything.
 *
 * ⚠ THE PROSE FALLBACK IS STILL HERE AND MUST STAY. Not every line carries a
 * subject: a SPELL has no entity to be about, so "Rashi plays Biotoxicity."
 * carries none — and dropping the prose key would have taken the spell's own
 * scan off the surface. A line with no subject and no card name at all becomes
 * a `note`, which is still shown. **A reveal that silently drops what it does
 * not understand is worse than a verbose one**, because the failure is
 * invisible: you cannot tell a segment where nothing happened from one this
 * module could not read. `217-reveal-rows.test.ts` §4 is that claim, over
 * every event type the engine can emit.
 *
 * ── ⚠ AND THE OLDER REPORT THIS MUST NOT UNDO ─────────────────────────
 *
 * This is the SECOND time the owner has complained about this surface. Round 8,
 * with a screenshot of one Biotoxicity filling the whole interstitial:
 *
 *   "single cards create 5, full sized entries […] it's good to show the full
 *    chain of events, but they don't need to take up so much space."
 *
 * `groupReveal` was that fix, and it over-corrected into folding everything
 * that shared a name into ONE row — which is the bug being fixed now. So the
 * rule here has to satisfy both reports at once, and one row per entity does
 * NOT: a spell that makes three tokens makes three entities, and three
 * full-sized rows is round 8, filed again.
 *
 * The rule that satisfies both: **a row is one entity, and then adjacent rows
 * for the SAME CARD merge — unless one of them carries a mod.** A mod is what
 * makes a copy individual; without one, two copies of a card side by side are
 * one beat and are counted rather than repeated. Three Poison tokens collapse
 * to "Poison ×3"; a Good Whale wearing Hooba-Lin never merges with the plain
 * Good Whale deployed after it, because the chip would then appear to be on
 * both. `217` §2 holds the new rule and re-runs round 8's own fixture.
 */
import { findCardName } from './inspect.ts';
import type { CardName, EngineEvent, EntityId } from '../src/types.ts';

/** one card on the reveal surface: a scan, its mods, and whatever else was
 * said about it */
export interface RevealRow {
  /** the card to draw a scan of */
  card: CardName;
  /** the entities this row stands for. Empty when the row came from prose (a
   * spell, which is not an entity) — `id` below is what the surface hovers. */
  ids: EntityId[];
  /** how many things it stands for: 1, or the size of a merged run */
  count: number;
  /** R35/R105: mods applied to it during the segment — the thing the report
   * asked for by name, on the card it was applied to */
  mods: { card: CardName; how: string }[];
  /** the lines about this card that the scan and the chips do not already
   * say. `times` collapses a RUN of the same message — an effect that fires
   * once per target narrates itself once per target, and three identical
   * sentences in a row are the verbosity being removed, not a shorter form of
   * it. (This is `ui/inspect.ts::joinMessages`'s rule, kept when the prose
   * grouping around it was deleted.) */
  lines: { text: string; times: number }[];
}

/** the entity a row's scan should preview, if it has one */
export const rowId = (row: RevealRow): EntityId | undefined => row.ids[0];

export interface RevealView {
  rows: RevealRow[];
  /** every line that belongs to no card on the board — kept, never dropped */
  notes: string[];
}

/**
 * WHICH ENTITY an event is about, or null. `unit` and `host` are the two
 * spellings the engine uses for "the thing this happened to"; nothing else is
 * guessed at, and a type that starts carrying a third lands in `notes` rather
 * than being silently mis-filed.
 */
function subjectOf(ev: EngineEvent): EntityId | null {
  const d = ev.data;
  if (!d) return null;
  for (const key of ['unit', 'host'] as const) {
    const v = d[key];
    if (typeof v === 'number') return v as EntityId;
  }
  return null;
}

/**
 * The lines a row does NOT need to print, because the row already SHOWS them:
 *
 *   · `modApplied` — the chip names the mod, the host and how it was applied,
 *                    so the sentence saying the same thing is pure repetition.
 *
 * Everything else keeps its line, and `spawned` DELIBERATELY does — its text
 * carries things the scan does not, the token counter count among them
 * ("creates a Poison 1"), and trading a real fact for one less line is not a
 * readability win. This is a rule about EVENT TYPES, not about wording: no
 * message is parsed, edited or matched against, so a rephrasing upstream
 * cannot turn it into a silent drop.
 */
const SHOWN_BY_THE_ROW = new Set(['modApplied']);

/**
 * Build the surface. `cardOf` names an entity — `ui/main.ts` passes the live
 * state's lookup, and it is a parameter so this module never imports one.
 *
 * Rows come out in the order their card first appeared, which is the order the
 * opponent did things in.
 */
export function revealView(
  events: readonly EngineEvent[],
  cardOf: (id: EntityId) => CardName | null,
): RevealView {
  const raw: RevealRow[] = [];
  const notes: string[] = [];
  /** the row the walk is currently adding to, and the key that opened it. A
   * RUN, not a lookup: the chain has to stay in the order it happened, so a
   * card that comes back later is a new beat (round 8's own rule). */
  let key: string | null = null;

  const open = (k: string, card: CardName, id?: EntityId): RevealRow => {
    const row: RevealRow = { card, ids: id === undefined ? [] : [id], count: 1, mods: [], lines: [] };
    raw.push(row);
    key = k;
    return row;
  };
  const current = (k: string): RevealRow | null => (key === k ? raw[raw.length - 1]! : null);

  for (const ev of events) {
    // A MOD IS A FACT ABOUT ITS HOST — the one thing the report named. It can
    // reach back to a row already closed (the host was deployed, something
    // else happened, then the mod landed), so this is a search, not a peek at
    // the current row.
    if (ev.type === 'modApplied' && typeof ev.data?.['mod'] === 'number') {
      const host = subjectOf(ev);
      const modCard = cardOf(ev.data['mod'] as EntityId);
      const row = host === null ? null : (raw.find(r => r.ids.includes(host)) ?? openFor(host));
      if (row && modCard) {
        const how = typeof ev.data['appliedAs'] === 'string' ? ev.data['appliedAs'] : 'augment';
        row.mods.push({ card: modCard, how });
        continue;
      }
      // could not place it — fall through, so the LINE is still shown
    }
    if (!ev.msg) continue;                       // signal-only (stackFlash)

    const id = subjectOf(ev);
    let row: RevealRow | null = null;
    if (id !== null) {
      const card = cardOf(id);
      // the entity is gone (it died inside the segment, or was never ours to
      // see): no scan to draw, so fall through to the prose key rather than
      // opening a row with a blank picture
      if (card) row = current(`e${id}`) ?? open(`e${id}`, card, id);
    }
    if (!row) {
      const named = findCardName(ev.msg);
      // a SPELL is not an entity, so this is the only way its scan reaches the
      // surface at all
      if (named) row = current(`c${named}`) ?? open(`c${named}`, named);
    }
    if (!row) { key = null; notes.push(ev.msg); continue; }
    if (SHOWN_BY_THE_ROW.has(ev.type)) continue;
    const last = row.lines[row.lines.length - 1];
    if (last && last.text === ev.msg) last.times++;
    else row.lines.push({ text: ev.msg, times: 1 });
  }

  /** a mod naming a host no row covers still has to be shown SOMEWHERE */
  function openFor(host: EntityId): RevealRow | null {
    const card = cardOf(host);
    return card ? open(`e${host}`, card, host) : null;
  }

  return { rows: mergeRuns(raw), notes };
}

/**
 * Round 8's rule, restated on entities: adjacent rows for the SAME CARD are
 * one beat and are counted, not repeated.
 *
 * ⚠ A ROW CARRYING A MOD NEVER MERGES, in either direction. The chip is drawn
 * on the row, so merging a modded copy with a plain one would put the mod
 * visually on both — which is the misinformation this whole change exists to
 * remove, arriving by a different door.
 */
function mergeRuns(rows: readonly RevealRow[]): RevealRow[] {
  const out: RevealRow[] = [];
  for (const row of rows) {
    const prev = out[out.length - 1];
    if (prev && prev.card === row.card && !prev.mods.length && !row.mods.length) {
      prev.count += row.count;
      prev.ids.push(...row.ids);
      for (const l of row.lines) {
        const last = prev.lines[prev.lines.length - 1];
        if (last && last.text === l.text) last.times += l.times;
        else prev.lines.push({ ...l });
      }
      continue;
    }
    out.push(row);
  }
  return out;
}

/**
 * Does this reveal say anything at all?
 *
 * `ui/main.ts` used to decide by scanning the messages for "is done
 * deploying", which is a phrase test: it fails the moment the line is
 * rephrased, and it cannot see a reveal whose only content is a MOD (whose
 * line the row now absorbs). Asking the built view instead is the same
 * judgement made against what will actually be on screen.
 */
export function revealWorthShowing(view: RevealView): boolean {
  if (view.rows.length) return true;
  return view.notes.some(m => !/is done (deploying|hasting)/i.test(m));
}
