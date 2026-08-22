/* The card-text engine: what a card's text box SAYS RIGHT NOW.
 *
 * DOM-free, like ui/inspect.ts — main.ts renders the answer, and
 * test/57-ui-cardtext.test.ts checks it.
 *
 * Playtest 2026-08-21, Bena: "cards have their oracle text changed all the
 * time. Mods, grafts, counters, other cards adding or removing rules text.
 * The printed card is hardly ever correct." The scan on the table is the
 * card's HISTORY; this module answers what the game currently thinks it is.
 *
 * ── the composition rule ─────────────────────────────────────────────
 *
 * A live card's text box is assembled from sources the engine already models
 * separately, so nothing here re-derives rules — every line comes from a
 * public query, and the arithmetic is E.effStats/E.ownAttrs/E.projections
 * themselves. A box can therefore never disagree with the board it describes.
 *
 *   printed   the card's own text box
 *   augment   a clause donated by an augment mod slid under it (R55)
 *   graft     a [Switch] clause folded into the host's cause (Manual p.33)
 *   granted   text handed to it until regroup (R63)
 *   static    a continuous projection radiating onto it from elsewhere
 *   note      the one per-ability fact: a bounded [Switch1] already spent
 *
 * An until-regroup change with no card text behind it is not a line: a temp
 * +X/+Y is a term in the stat arithmetic and a temp attribute is a chip in
 * the attribute row, both tagged 'temp' there.
 *
 * ── what is deliberately NOT split ───────────────────────────────────
 *
 * A card's OWN printed text stays one line rather than being cut into one
 * clause per scripted ability. Printed text is prose written for humans and
 * `abilities[]` is an implementation of it; the two do not line up 1:1 (a
 * sentence can be two abilities, an ability can span two sentences, and
 * reminder text belongs to no ability at all). Guessing a mapping would make
 * the box confidently wrong, which is worse than the printed card.
 *
 * It costs nothing, because everything that varies per clause is already
 * per-CARD: a mod is its own card, a grant carries its own text, and
 * suppression (R62) is all-or-nothing by rule — "loses all abilities", never
 * "loses its second ability". The one genuinely per-ability fact, a bounded
 * [Switch1] whose budget is spent, rides as a `note` line naming the ability
 * by its label.
 */
import { getCard, graftCauseIndex, isTriggered } from '../src/cards/dsl.ts';
import type { Ability, CardDef } from '../src/cards/dsl.ts';
import type { E } from '../src/engine.ts';
import type { CardName, Entity, EntityId } from '../src/types.ts';

// ── the model ─────────────────────────────────────────────────────────

export type LineOrigin =
  | 'printed' | 'augment' | 'graft' | 'granted' | 'static' | 'note';

export interface TextLine {
  /** rules text with its printed markup intact — the caller iconizes it */
  text: string;
  /** the card this clause is printed on ('' for a synthesized line) */
  from: CardName;
  origin: LineOrigin;
  /** false = the line is there but doing nothing right now; `why` says why */
  active: boolean;
  why?: string;
  /** this line IS the whole composed graft ability, not one clause of it */
  composed?: boolean;
}

export type AttrOrigin = 'printed' | 'augment' | 'static' | 'temp' | 'column';

export interface AttrLine {
  attr: string;
  origin: AttrOrigin;
  /** the card that supplies it (null = printed on this card) */
  from: CardName | null;
  /** false = suppressed (R62): printed on the card, not in play */
  active: boolean;
}

/** the stat arithmetic, layer by layer, so a surprising number can be read */
export interface StatBreakdown {
  power: number;
  toughness: number;
  /** layer 1 — what is printed on the card (or a token's minted stats) */
  printed: [number, number];
  /** layer 2 — the base after any rewrite (Formless, Body Swap) */
  base: [number, number];
  /** layer 3+ contributions, in application order */
  parts: { label: string; dp: number; dt: number }[];
  counters: number;
  damage: number;
  /** true when power/toughness differ from what is printed */
  changed: boolean;
}

export interface CardTextBox {
  name: CardName;
  typeLine: string;
  /** null for a card with no meaningful stats (a spell) */
  stats: StatBreakdown | null;
  attrs: AttrLine[];
  lines: TextLine[];
  suppressed: { attrs: boolean; abilities: boolean; by: CardName[] };
  /** short state notes: damage marked, sent to counterattack, X, … */
  state: string[];
  /** true when this box is not simply the printed card — the UI badges it */
  modified: boolean;
}

// ── text helpers ──────────────────────────────────────────────────────

/**
 * Collapse the scan's line-break markup to one readable line.
 *
 * `{/n}` is a mid-WORD break from the card scans ("be- {/n}comes"), never a
 * clause separator — which is exactly why nothing here splits on it. The
 * hyphen in front of one is a SOFT hyphen and is joined away with it; every
 * `- ` in the whole printed pool is one of those (four of them lost their
 * `{/n}` in extraction, which is the other reason to match the hyphen rather
 * than the marker).
 */
export const clean = (s: string): string =>
  s.replace(/\{\/n\}/g, ' ').replace(/-\s+/g, '').replace(/\s+/g, ' ').trim();

const SWITCH_RE = /\[switch1?\]/i;
const AUGMENT_RE = /\[augment\]/i;

/** a card's text from its `[Switch]` marker onward — the half that transfers
 * when it is grafted (Manual p.32-33) */
export function switchClause(name: CardName): string {
  const t = textOf(name);
  const m = SWITCH_RE.exec(t);
  return clean(m ? t.slice(m.index) : t);
}

/**
 * A card's text from its text-box `[Augment]` marker onward — the half that
 * transfers when it augments (R55: printed `[Augment]` is a permission, so a
 * card with no marker in its TEXT donates nothing textual and the type line
 * carries the grant instead).
 */
export function augmentClause(name: CardName): string {
  const t = textOf(name);
  const m = AUGMENT_RE.exec(t);
  return m ? clean(t.slice(m.index)) : '';
}

function textOf(name: CardName): string {
  try { return getCard(name).text ?? ''; } catch { return ''; }
}
function defOf(name: CardName): CardDef | null {
  try { return getCard(name); } catch { return null; }
}

/** an ability's printed budget marker, for the "already used" note */
const boundedTag = (a: Ability): string => (isTriggered(a) ? '[Switch1]' : '[once]');

// ── the composed graft ability (Manual p.33) ──────────────────────────

/**
 * A host's graft-cause trigger and its grafted `[Switch]` effects are ONE
 * ability, and the box has to read like one: the host's cause clause, then
 * the host's own effect, then each graft's effect in mod order. Returns null
 * when there is nothing composed to show.
 */
export function graftComposition(e: E, u: Entity): { head: string; parts: { text: string; from: CardName }[] } | null {
  const grafts = u.mods
    .map(id => e.entity(id))
    .filter((m): m is Entity => !!m && m.appliedAs === 'graft');
  if (!grafts.length) return null;
  const host = textOf(u.card);
  if (!host) return null;
  let causeIndex = -1;
  try { causeIndex = graftCauseIndex(u.card); } catch { return null; }
  if (causeIndex < 0) return null;
  const m = SWITCH_RE.exec(host);
  const head = clean(m ? host.slice(0, m.index) : host);
  const parts: { text: string; from: CardName }[] = [];
  if (m) parts.push({ text: clean(host.slice(m.index)), from: u.card });
  for (const g of grafts) {
    const t = switchClause(g.card);
    if (t) parts.push({ text: t, from: g.card });
  }
  return { head, parts };
}

// ── attributes, attributed ────────────────────────────────────────────

/**
 * Every attribute this unit has RIGHT NOW and where each one comes from,
 * plus — when R62 has switched the layer off — the printed ones it would have
 * had, marked inactive, because "it has Flying but Flying is off" is the
 * thing a player needs to see.
 *
 * Column-shared attributes (combat shares them vertically) are included and
 * flagged 'column': in a formation they are as real as printed ones, and they
 * are the single most-missed thing on the board.
 */
export function attrLines(e: E, u: Entity): AttrLine[] {
  const sup = e.suppressionOf(u);
  const out: AttrLine[] = [];
  const put = (attr: string, origin: AttrOrigin, from: CardName | null, active: boolean) => {
    const seen = out.find(a => a.attr === attr);
    if (seen) { if (active && !seen.active) { seen.active = true; seen.origin = origin; seen.from = from; } return; }
    out.push({ attr, origin, from, active });
  };
  const live = sup.attrs ? new Set<string>() : e.ownAttrs(u);
  const def = defOf(u.card);
  for (const a of def?.attrs ?? []) put(a, 'printed', null, live.has(a));
  for (const a of u.tempAttrs ?? []) put(a, 'temp', null, live.has(a));
  for (const id of u.mods) {
    const m = e.entity(id);
    if (!m || m.appliedAs !== 'augment') continue;
    for (const a of defOf(m.card)?.augmentAttrs ?? []) put(a, 'augment', m.card, live.has(a));
  }
  for (const p of e.projections(u)) {
    for (const a of p.attrs) put(a, 'static', p.from, live.has(a));
  }
  // shared vertically within a formation column — real, and easy to miss
  const col = e.columnOf(u.id);
  if (col && !sup.attrs) {
    for (const id of col) {
      if (id === u.id) continue;
      const mate = e.entity(id);
      if (!mate) continue;
      for (const a of e.ownAttrs(mate)) put(a, 'column', mate.card, true);
    }
  }
  return out;
}

// ── the stat arithmetic ───────────────────────────────────────────────

export function statBreakdown(e: E, u: Entity): StatBreakdown {
  const def = defOf(u.card);
  const printed: [number, number] = u.tokenStats ?? [def?.power ?? 0, def?.toughness ?? 0];
  const base = e.baseStatsOf(u);
  const [power, toughness] = e.effStats(u);
  const parts: { label: string; dp: number; dt: number }[] = [];
  if (base[0] !== printed[0] || base[1] !== printed[1]) {
    // layer 2 is a replacement, so it is shown as one line for the whole
    // rewrite rather than per source — but name the continuous source when
    // there is one, since its own dp/dt line would read +0/+0. Only a setter
    // whose numbers ARE the resolved base gets credit: layer 2 is last-wins,
    // and a Statweaver that an until-regroup rewrite overrode did not do this.
    const setters = [...new Set(e.projections(u)
      .filter(p => (p.baseP !== undefined || p.baseT !== undefined)
        && (p.baseP ?? base[0]) === base[0] && (p.baseT ?? base[1]) === base[1])
      .map(p => p.from))];
    const by = setters.length ? ` (${setters.join(', ')})` : '';
    parts.push({
      label: `base rewritten to ${base[0]}/${base[1]}${by}`,
      dp: base[0] - printed[0], dt: base[1] - printed[1],
    });
  }
  if (u.counters) parts.push({ label: `${u.counters > 0 ? '+' : ''}${u.counters} counters`, dp: u.counters, dt: u.counters });
  if (u.tempPower || u.tempToughness) {
    parts.push({ label: 'until regroup', dp: u.tempPower, dt: u.tempToughness });
  }
  for (const p of e.projections(u)) {
    if (p.dp || p.dt) parts.push({ label: p.from, dp: p.dp, dt: p.dt });
  }
  // whatever layer 4 (Tough/Balanced) and anything above it did is the gap
  // between the sum so far and the number the engine actually reports
  const summed = parts.reduce((acc, p) => [acc[0] + p.dp, acc[1] + p.dt] as [number, number],
    [printed[0], printed[1]] as [number, number]);
  if (summed[0] !== power || summed[1] !== toughness) {
    parts.push({ label: 'attribute layer', dp: power - summed[0], dt: toughness - summed[1] });
  }
  return {
    power, toughness, printed, base, parts,
    counters: u.counters, damage: u.damage,
    changed: power !== printed[0] || toughness !== printed[1],
  };
}

// ── the box ───────────────────────────────────────────────────────────

/**
 * The text box of a live entity, as the game sees it.
 *
 * Order is the order a physical modded card reads: the printed box first
 * (composed with its grafts when it has any), then each mod's donated clause
 * in the order they were slid under it, then granted text, then what the rest
 * of the board is projecting onto it.
 */
export function entityTextBox(e: E, u: Entity): CardTextBox {
  const def = defOf(u.card);
  const sup = e.suppressionOf(u);
  const lines: TextLine[] = [];
  // NB: a silenced line carries no `why`. The suppression banner sits directly
  // above the lines and names the culprit once; repeating it on every struck
  // clause was the first thing that read as noise (2026-08-21). `why` is
  // reserved for reasons that are NOT already on the box.
  const silenced = sup.abilities;

  // 1. the printed box — composed with its grafts when they have a cause
  const comp = graftComposition(e, u);
  const printed = clean(textOf(u.card));
  if (comp) {
    lines.push({
      text: [comp.head, ...comp.parts.map(p => p.text)].filter(Boolean).join(' '),
      from: u.card, origin: 'graft', composed: true,
      active: !silenced,
    });
  } else if (printed) {
    lines.push({
      text: printed, from: u.card, origin: 'printed',
      active: !silenced,
    });
  }

  // 2. mods, in the order they were applied (index 0 sits nearest the card)
  for (const id of u.mods) {
    const m = e.entity(id);
    if (!m) continue;
    if (m.appliedAs === 'graft') {
      // already folded into the composition above; a graft with no cause to
      // join is the one case worth printing on its own, as a dead line
      if (comp) continue;
      const t = switchClause(m.card);
      if (t) {
        lines.push({
          text: t, from: m.card, origin: 'graft', active: false,
          why: `${u.card} has no [Switch] cause for it to join`,
        });
      }
      continue;
    }
    const donated = augmentClause(m.card);
    const attrs = defOf(m.card)?.augmentAttrs ?? [];
    const text = donated || (attrs.length
      ? `[Augment] Grants ${attrs.map(a => `{${a}}`).join(' ')}.`
      : '');
    if (!text) continue;
    lines.push({
      text, from: m.card, origin: 'augment',
      active: !silenced,
    });
  }

  // 3. R63 grants
  for (const g of u.granted ?? []) {
    lines.push({
      text: g.text, from: g.from, origin: 'granted',
      active: !silenced,
    });
  }

  // 4. what the board is projecting onto it. A projection is text on ANOTHER
  //    card, so it is synthesized from what the projection actually does —
  //    which is also the only honest thing to print, since the other card's
  //    sentence is about a whole class of units, not about this one.
  for (const p of e.projections(u)) {
    const bits: string[] = [];
    if (p.baseP !== undefined || p.baseT !== undefined) {
      // layer 2: it replaces the number rather than adjusting it, so it reads
      // "is base X/Y" — printing a delta here would be a lie about stacking
      bits.push(`is base ${p.baseP ?? '\u2014'}/${p.baseT ?? '\u2014'}`);
    }
    if (p.dp || p.dt) bits.push(`${sign(p.dp)}/${sign(p.dt)}`);
    if (p.attrs.length) bits.push(`gains ${p.attrs.map(a => `{${a}}`).join(' ')}`);
    if (p.suppressAttrs && p.suppressAbilities) bits.push('loses all attributes and abilities');
    else if (p.suppressAttrs) bits.push('loses all attributes');
    else if (p.suppressAbilities) bits.push('loses all abilities');
    if (!bits.length) continue;
    lines.push({ text: `${bits.join(', ')}.`, from: p.from, origin: 'static', active: true });
  }

  // 5. bounded abilities whose budget is spent — the one per-ability fact
  if (!sup.abilities) {
    for (const [prefix, list] of [['ability', def?.abilities], ['augment', def?.augmentText]] as const) {
      (list ?? []).forEach((ab, i) => {
        if (!ab.bounded) return;
        if (!(u.budgets[`${prefix}:${u.card}#${i}`] ?? 0)) return;
        lines.push({
          text: `${boundedTag(ab)} ${ab.label} — already used this turn.`,
          from: u.card, origin: 'note', active: false, why: 'bounded to once per turn (R9)',
        });
      });
    }
    for (const id of u.mods) {
      const m = e.entity(id);
      if (!m) continue;
      if (m.appliedAs === 'graft' && (m.budgets['graft'] ?? 0)) {
        lines.push({
          text: `[Switch1] ${m.card}'s grafted effect — already used this turn.`,
          from: m.card, origin: 'note', active: false, why: 'bounded to once per turn (R9)',
        });
      }
      // a bounded ability DONATED by an augment mod is budget-keyed by the
      // mod's card name, on the HOST's budgets (engine.ts composeParts:
      // `augment:<mod card>#<i>`, budgetHolder = the unit it fires from)
      if (m.appliedAs === 'augment') {
        (defOf(m.card)?.augmentText ?? []).forEach((ab, i) => {
          if (!ab.bounded) return;
          if (!(u.budgets[`augment:${m.card}#${i}`] ?? 0)) return;
          lines.push({
            text: `${boundedTag(ab)} ${ab.label} — already used this turn.`,
            from: m.card, origin: 'note', active: false, why: 'bounded to once per turn (R9)',
          });
        });
      }
    }
  }

  const state: string[] = [];
  if (u.absent) state.push('sent to counterattack — it does not exist until round 2');
  if (u.x !== undefined) state.push(`X = ${u.x}`);
  if (u.token) state.push('token — erased when it leaves play');

  const attrs = attrLines(e, u);
  const stats = u.kind === 'mod' ? null : statBreakdown(e, u);
  return {
    name: u.card,
    typeLine: def?.type ?? '',
    stats,
    attrs,
    lines,
    suppressed: sup,
    state,
    modified: isModified(u, lines, attrs, stats),
  };
}

const sign = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

function isModified(u: Entity, lines: TextLine[], attrs: AttrLine[], stats: StatBreakdown | null): boolean {
  if (lines.some(l => l.origin !== 'printed' || !l.active)) return true;
  if (attrs.some(a => a.origin !== 'printed' || !a.active)) return true;
  if (stats?.changed) return true;
  return !!(u.damage || u.counters || u.granted?.length || u.mods.length);
}

/**
 * The text box of a card that is NOT in play — one in hand, a bin, a cache, a
 * token being explained. There is no live state to read, so this is the
 * printed card; it exists so every surface in the UI renders through one
 * function and a card does not change shape as it hits the table.
 */
export function printedTextBox(name: CardName): CardTextBox {
  const def = defOf(name);
  const text = clean(def?.text ?? '');
  const spell = !def || def.kind !== 'unit';
  return {
    name,
    typeLine: def?.type ?? '',
    stats: spell || !def ? null : {
      power: def.power, toughness: def.toughness,
      printed: [def.power, def.toughness], base: [def.power, def.toughness],
      parts: [], counters: 0, damage: 0, changed: false,
    },
    attrs: (def?.attrs ?? []).map(a => ({ attr: a, origin: 'printed' as const, from: null, active: true })),
    lines: text ? [{ text, from: name, origin: 'printed', active: true }] : [],
    suppressed: { attrs: false, abilities: false, by: [] },
    state: [],
    modified: false,
  };
}

/** the box for whatever the UI is pointing at: a live entity if it has one,
 * otherwise the printed card */
export function textBoxFor(e: E | null, name: CardName, id?: EntityId): CardTextBox {
  if (e && id !== undefined) {
    const u = e.entity(id);
    if (u) return entityTextBox(e, u);
  }
  return printedTextBox(name);
}
