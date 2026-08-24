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
 *   copy      R118: the card this entity currently IS, and what it kept of its
 *             own — a copy changes the game NAME but never the physical card,
 *             so the box has to say both
 *   static    a continuous projection radiating onto it from elsewhere
 *   note      the one per-ability fact: a once-per-turn budget already spent
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
 * ability whose once-per-turn budget is spent, rides as a `note` line.
 *
 * ── R135: a line never repeats what its own tag already says ──────────
 *
 * The renderer prefixes each line with a tag for its origin, and that tag is
 * an ICON — the augment symbol for an augment, ⇄ for a graft. A donated clause
 * is sliced FROM its printed marker, so the same symbol arrived twice, once on
 * the tag and once at the head of the text. `dropOriginMarker` takes the
 * leading one off; a marker sitting MID-sentence is load-bearing (it separates
 * a graft's cause from its effect) and is never touched, which is also why the
 * composed graft line keeps all of its own.
 */
import { getCard, graftCauseIndex, ELEMENT_OF_PIP } from '../src/cards/dsl.ts';
import { esc } from './util.ts';
import type { CardDef } from '../src/cards/dsl.ts';
import type { E } from '../src/engine.ts';
import type { CardName, Entity, EntityId } from '../src/types.ts';

// ── the model ─────────────────────────────────────────────────────────

export type LineOrigin =
  | 'printed' | 'augment' | 'graft' | 'granted' | 'copy' | 'static' | 'note';

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

/**
 * R135: drop the printed origin marker a line's own TAG already shows.
 *
 * Reported verbatim: "an augmented thing will show the :augment: icon twice,
 * once on each line." Both halves are correct on their own — `augmentClause`
 * slices the donated text from `[Augment]` because that is where the donation
 * starts, and `LINE_TAG.augment` is the augment icon because that is what the
 * line IS — so the fix belongs at the join, not in either half. Same shape for
 * a lone graft clause under the ⇄ tag.
 *
 * LEADING only. A `[Switch]` mid-sentence separates a graft's cause from its
 * effect and is the printed card's own punctuation; the composed graft line
 * therefore never goes through here.
 */
export const dropOriginMarker = (text: string): string =>
  text.replace(/^\[(?:augment|switch1?)\]\s*/i, '');

function textOf(name: CardName): string {
  try { return getCard(name).text ?? ''; } catch { return ''; }
}
function defOf(name: CardName): CardDef | null {
  try { return getCard(name); } catch { return null; }
}

/**
 * R135: the "already used this turn" note is tagged `[Once]`, always.
 *
 * It used to print the ability's PRINTED marker — `[Switch1]` for a triggered
 * ability, because that is genuinely what a bounded trigger prints ("When you
 * play a nontoken spell, [Switch1] I deal 2 damage" — Rune Channeler). That
 * was the wrong question. The note is not quoting the card; the printed line
 * directly above it already does that. The note is about the BUDGET, and the
 * budget symbol is [Once]. `[Switch1]`'s icon is the bounded-GRAFT symbol, so
 * a plain bounded trigger was being badged as though something were grafted
 * onto it — reported as "uses the wrong icon [Switch1] rather than [Once]".
 *
 * ⚠ This is the note line only. `[Switch1]` is a real token in printed card
 * text (118 cards print one) and still renders as the graft symbol there.
 */
const SPENT_TAG = '[Once]';

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
  // R118 layer 0: "printed" means the card this entity currently IS
  const def = defOf(e.nameOf(u));
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
  // R118 layer 0 IS layer 1's input, so the box reads the engine's own answer
  // rather than re-deriving it from a card definition
  const printed: [number, number] = e.printedStats(u);
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

// ── {Unstable} (R135) ─────────────────────────────────────────────────

/**
 * "It also doesn't show unstable anywhere."
 *
 * It is a bin REPLACEMENT, not a combat attribute — deliberately absent from
 * the `Attr` union (types.ts, dsl.ts) — so it was never going to arrive in the
 * attribute row, and nothing else looked for it. Two of the pool's cards print
 * `{Unstable}` in their TYPE LINE (Oorblak, Aberrant Statweaver), which the
 * type line does render; every OTHER way in is invisible, and those are the
 * ways that actually happen at the table. The blanket Manual p.35 rule is the
 * common one: a modded card is Unstable, so the moment you slide a mod under a
 * unit it stops going to a bin, and the box said nothing about it.
 *
 * So it rides in `state`, beside "token — erased when it leaves play", which
 * is the same class of fact: what happens to this card when it leaves play.
 *
 * The reason is worth printing because there are FOUR ways in and they expire
 * differently — a mod can be removed, an R96 stamp lapses at regroup, a printed
 * marker never does. Read through `E.isUnstable`, never re-derived: the union
 * lives in the engine and this asks it.
 */
const unstableState = (why: string): string =>
  `Unstable — ${why}; it is erased instead of binned (Manual p.35)`;

/** which of `E.isUnstable`'s four ways in applies, in the engine's own order */
function unstableWhy(e: E, u: Entity): string {
  if (u.mods.length > 0) return 'it is modded';
  if (u.unstable === true) return 'stamped until regroup';
  if (defOf(e.nameOf(u))?.unstable === true) return 'printed on its type line';
  return 'it copies a card that was modded';       // R118 ruling 2
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
  const face = e.nameOf(u);                 // R118: the card it currently IS
  const def = defOf(face);
  const sup = e.suppressionOf(u);
  const lines: TextLine[] = [];
  // NB: a silenced line carries no `why`. The suppression banner sits directly
  // above the lines and names the culprit once; repeating it on every struck
  // clause was the first thing that read as noise (2026-08-21). `why` is
  // reserved for reasons that are NOT already on the box.
  const silenced = sup.abilities;

  // 1. the printed box — composed with its grafts when they have a cause
  const comp = graftComposition(e, u);
  const printed = clean(textOf(face));
  if (comp) {
    lines.push({
      text: [comp.head, ...comp.parts.map(p => p.text)].filter(Boolean).join(' '),
      from: face, origin: 'graft', composed: true,
      active: !silenced,
    });
  } else if (printed) {
    lines.push({
      text: printed, from: face, origin: 'printed',
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
          // R135: the ⇄ tag beside it is already the [Switch] symbol
          text: dropOriginMarker(t), from: m.card, origin: 'graft', active: false,
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
      // R135: the augment icon is already on this line's tag
      text: dropOriginMarker(text), from: m.card, origin: 'augment',
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

  // 3b. R118 the COPY layer. The printed line above is already the copied
  //     card's, so what is left to say is the part a player cannot see: which
  //     PHYSICAL card this is (it bins as itself — ruling 1), how long the
  //     face lasts, and the mods' text a copy inherits without inheriting the
  //     mods themselves (ruling 2, and it is why the copy is Unstable).
  for (const c of u.copies ?? []) {
    if (!c.facets.includes('name')) continue;
    lines.push({
      text: `A copy of ${c.card}${c.until === 'regroup' ? ' until regroup' : ''}`
        + ` — the card itself is ${u.card}, and that is what bins.`,
      from: c.from, origin: 'copy', active: true,
    });
    if (c.modText?.length) {
      lines.push({
        text: `It copied a modded card, so it has ${c.modText.join(', ')} and is`
          + ' {Unstable} — erased instead of binned.',
        from: c.from, origin: 'copy', active: true,
      });
    }
  }
  // faces PROJECTED onto it right now (Ancient One) — additive, abilities only
  for (const facet of ['statics', 'activated', 'triggered', 'behavior'] as const) {
    for (const name of e.facesWith(u, facet)) {
      if (name === face) continue;
      if (lines.some(l => l.origin === 'copy' && l.from === name)) continue;
      lines.push({
        text: clean(textOf(name)), from: name, origin: 'copy', active: !silenced,
      });
    }
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

  // 5. bounded abilities whose budget is spent — the one per-ability fact.
  //
  //    R135: the note says WHICH BUDGET, not what the ability does. It used to
  //    restate `ab.label`, which is the scripted paraphrase of the very clause
  //    printed above it, so a spent ability read its own text twice and the box
  //    doubled in height ("it also duplicates the text, making it really long").
  //    Naming the ability by label was safe-looking and wrong: no card in the
  //    pool has TWO bounded abilities, so within one source there is nothing to
  //    disambiguate — only the SOURCE can repeat (a host plus two modded-on
  //    ones), and that is what these lines name.
  if (!sup.abilities) {
    for (const [prefix, list] of [['ability', def?.abilities], ['augment', def?.augmentText]] as const) {
      (list ?? []).forEach((ab, i) => {
        if (!ab.bounded) return;
        if (!(u.budgets[`${prefix}:${u.card}#${i}`] ?? 0)) return;
        lines.push({
          text: `${SPENT_TAG} already used this turn.`,
          from: u.card, origin: 'note', active: false, why: 'bounded to once per turn (R9)',
        });
      });
    }
    for (const id of u.mods) {
      const m = e.entity(id);
      if (!m) continue;
      if (m.appliedAs === 'graft' && (m.budgets['graft'] ?? 0)) {
        lines.push({
          text: `${SPENT_TAG} ${m.card}'s grafted effect — already used this turn.`,
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
            text: `${SPENT_TAG} ${m.card}'s ability — already used this turn.`,
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
  if (e.isUnstable(u)) state.push(unstableState(unstableWhy(e, u)));

  const attrs = attrLines(e, u);
  const stats = u.kind === 'mod' ? null : statBreakdown(e, u);
  return {
    name: face,
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
  return !!(u.damage || u.counters || u.granted?.length || u.mods.length || u.copies?.length);
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
    // R135: off the table the only Unstable a card can have is the printed one
    state: def?.unstable ? [unstableState('printed on its type line')] : [],
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

// ── card-text icons (ported from the RAG front-end's token mapping) ────
/** [..] / {..} keywords that have a real icon (Icons/<name>.webp) */
export const TEXT_ICON: Record<string, string> = {
  augment: 'augment', switch1: 'bounded_graft', switch: 'graft',
  virus: 'virus', battle: 'battle', haste: 'haste', once: 'once',
};
/** amounts are spelled out on the cards ([one], [x]); three_blue is Lurking
 * Slimebeast's amount+resource-in-one-word special */
const COST_WORD: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', x: 'x', three_blue: '3b',
};
/** cost letters → faction icon; 'p' (prismite/colorless) has NO icon — left as
 * text. Taken straight from the engine (l = light, d = dark) so a new element
 * can never leave the UI with a stale copy of the pip table. */
const PIP_EL: Record<string, string> = ELEMENT_OF_PIP;
/** the same pip letters as a character class, for the [4bb]-style cost token */
const COST_TOKEN_RE = new RegExp(`^[0-9]*[${Object.keys(PIP_EL).join('')}]+$`);
/**
 * R141 — a cost written as BARE DIGITS. The pool spells the same amount two
 * ways: `[two]` (24 cards) and `[2]` (12 cards). COST_TOKEN_RE demands at
 * least one pip letter, so the digit form failed every branch above and fell
 * through to "unknown [token]: untouched" — printing a literal "[2]" beside
 * cards whose `[two]` drew the icon. `Icons/cost_0..9` and `cost_x` have
 * existed the whole time; only one of the two spellings ever reached them.
 *
 * Exactly the R134 shape: a token nobody taught the formatter about does not
 * announce itself, it just renders as its own source text. Digits are resolved
 * per character like [4bb], so a hypothetical [10] draws 1 then 0.
 */
const COST_DIGITS_RE = /^[0-9]+$/;
/** a text-line game icon; if the file is missing it degrades to `fallback` */
export const txtIcon = (name: string, fallback: string): string =>
  `<img class="txticon" src="/Icons/${name}.webp" alt="${fallback}" onerror="this.outerHTML=this.alt">`;
/** Swap game tokens in card text / prose ([Switch1], {Battle}, [one], [4bb], …)
 * for the real icons. Escapes FIRST — always feed it RAW text, never pre-escaped
 * HTML. Unknown [tokens] stay bracketed; unknown {attrs} bare their word;
 * {/n}/{i}/{/i} formatting tokens become markup. */
/**
 * R134: FORMATTING markers are resolved globally, before the icon pass.
 *
 * They used to be handled inside the `[token]`/`{token}` replacer, which meant
 * a marker sitting INSIDE an unrecognised bracket token was never reached —
 * the modal construct `/[power {i1}or defense]` matches the bracket branch as
 * one unknown token and is returned verbatim, so five cards printed a literal
 * "{i1}" at the table (Burgeon, Void Memory, Spirit of Nature, Transmutide
 * Enigma, Floral Singularity).
 *
 * `{i1}` italicises exactly ONE word — it is the sibling of `{g}`, which
 * colours exactly one keyword. On the printed cards it is the "or" of a modal
 * choice. `{i}` opens a run that the pool almost never closes: close it at the
 * reminder's own ')' where it introduces one, and balance whatever is left over
 * at the end, so an `<i>` can never leak out of the text box.
 */
function formatting(escaped: string): string {
  let s = escaped.replace(/\{\/n\}/g, '<br>');
  // ITALICS FIRST, so the generic keyword marker below cannot mistake `{i}`
  // for one and swallow the word after it.
  s = s.replace(/\{i1\}\s*([A-Za-z][A-Za-z-]*)/g, '<i>$1</i>');
  // a reminder that opens with {i} and never closes: end it at its own ')'
  s = s.replace(/\{i\}(\([^)]*\))(?!\{\/i\})/g, '<i>$1</i>');
  s = s.replace(/\{i\}/g, '<i>').replace(/\{\/i\}/g, '</i>');
  // A SINGLE-LETTER marker before a word marks that ONE word as a keyword —
  // the printed cards colour it. `{g}` is the attributes ({g}deadly, {g}flying,
  // {g}piercing, {g}inverted) and `{p}` is {p}unstable. Handled GENERICALLY on
  // purpose: letter-by-letter, a marker nobody taught the formatter about falls
  // through to "unknown {token} bares its word" and renders as a stray letter
  // glued to the keyword — "ginverted", "punstable", which is exactly how this
  // was reported. A new marker letter now styles its word instead of leaking,
  // and the class carries the letter so a future palette can tell them apart.
  s = s.replace(/\{([a-z])\}([A-Za-z][A-Za-z-]*)/g, '<span class="kw kw-$1">$2</span>');
  const opens = (s.match(/<i>/g) ?? []).length;
  const shuts = (s.match(/<\/i>/g) ?? []).length;
  return opens > shuts ? s + '</i>'.repeat(opens - shuts) : s;
}

export function iconizeText(raw: string): string {
  return formatting(esc(raw))
    .replace(/\[([^\[\]]+)\]|\{([^{}]+)\}/g, (tok, br?: string, bc?: string) => {
    if (br !== undefined) {
      const body = br.toLowerCase();
      const icon = TEXT_ICON[body];
      if (icon) return txtIcon(icon, tok);          // fallback KEEPS the brackets
      const cost = COST_WORD[body]
        ?? (COST_TOKEN_RE.test(body) || COST_DIGITS_RE.test(body) ? body : undefined);
      if (cost !== undefined) {
        return [...cost].map(c => {
          const el = PIP_EL[c];
          return el ? txtIcon(el, c) : txtIcon(`cost_${c}`, c);
        }).join('');
      }
      return tok;                                    // unknown [token]: untouched
    }
    const body = bc!.toLowerCase();
    // {/n}, {i}, {i1}, {/i} and {g} are resolved by formatting() above
    const icon = TEXT_ICON[body];
    if (icon) return txtIcon(icon, bc!);             // fallback bares the word
    return bc!;                                      // {Swift} → Swift
  });
}
