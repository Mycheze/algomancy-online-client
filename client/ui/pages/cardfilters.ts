/* THE CARD FILTERS, DRAWN: the facet rail and the search syntax, shared by the
 * Cards page (`?cards`) and the builder's pool (BL-65, 2026-11-04).
 *
 * Moved out of pages/cards.ts byte for byte, so the builder's "More filters"
 * sheet is the Cards page's own filter list and syntax help — the same code,
 * not a copy that drifts (the design page: "the Cards page's full filter list
 * and search syntax, the same code"). Only the BUTTON NAMES differ: the Cards
 * page's clicks route on `cards-*`, the builder's on `tt-*`, so the names are a
 * parameter (`FilterBtns`), and CARDS_BTNS is exactly what the Cards page drew
 * before the move. pages/cards.ts re-exports `facets` and `Facet` for the
 * modules that imported them from there.
 *
 * Pure, like every page module (962): the chips' state is read off the query
 * string (cardsearch.ts chipState — the string is the source of truth).
 */
import { ALL_ELEMENTS } from '../../engine/src/apply.ts';
import type { Release } from '../cardindex.ts';
import { allRows, facetValues, RELEASE_LABEL } from '../cardindex.ts';
import { FLAGS, KEYS, SORTS, VIEWS, chipState } from '../cardsearch.ts';
import { clickOrTap, esc, elIcon } from '../util.ts';

/** The data-btn names (and the rail's scroll key) a filter surface uses. */
export interface FilterBtns {
  /** a facet chip (data-key, data-value) */
  chip: string;
  /** a rail section's head (data-section) */
  section: string;
  /** a query to try: the syntax help's examples and flags (data-q) */
  try: string;
  /** the rail's `data-scroll` key (pages/frame.ts paintFrame) */
  scroll: string;
}

/** the Cards page's names, exactly as it drew them before the move */
export const CARDS_BTNS: FilterBtns = { chip: 'cards-chip', section: 'cards-section', try: 'cards-try', scroll: 'cards-rail' };
/** the builder's pool (architecture §2: tt-chip, tt-section, tt-try) */
export const POOL_BTNS: FilterBtns = { chip: 'tt-chip', section: 'tt-section', try: 'tt-try', scroll: 'tt-filters' };

/* ── the facet rail ────────────────────────────────────────────────────── */

export interface Facet { section: string; label: string; key: string; value: string; icon?: string; count?: number }

/**
 * The chips, derived from the pool rather than listed here — a new element, a
 * new subtype or a new printed deck appears in the rail with no edit to this
 * file. (`derive, never enumerate`: the one rule this repo keeps relearning.)
 */
export function facets(building: boolean): Facet[] {
  const rows = allRows();
  const out: Facet[] = [];
  for (const el of ALL_ELEMENTS) {
    out.push({ section: 'element', label: el, key: 'el', value: el, icon: elIcon(el) });
  }
  out.push({ section: 'element', label: 'mono', key: 'el', value: 'mono' });
  out.push({ section: 'element', label: 'hybrid', key: 'el', value: 'hybrid' });
  out.push({ section: 'element', label: 'colourless', key: 'el', value: 'none' });

  // Owner, 2026-09-05: "It should have: Unit, Spell, Token, Deployment Only,
  // Haste, Battle, Virus. Spell units should not be their own thing, but count
  // as a spell and/or a unit" — which `kind:unit` / `kind:spell` now do.
  for (const [k, label] of [['unit', 'Unit'], ['spell', 'Spell'], ['token', 'Token']] as const) {
    out.push({ section: 'kind', label, key: 'kind', value: k });
  }
  // `is:deploy`, not `timing:deploy`: the flag also leaves viruses out, which
  // print no timing and are playable whenever you hold priority
  out.push({ section: 'kind', label: 'Deployment only', key: 'is', value: 'deploy' });
  for (const [t, label] of [['haste', 'Haste'], ['battle', 'Battle']] as const) {
    out.push({ section: 'kind', label, key: 'timing', value: t });
  }
  out.push({ section: 'kind', label: 'Virus', key: 'is', value: 'virus' });
  for (let m = 0; m <= 8; m++) out.push({ section: 'cost', label: String(m), key: 'mana', value: String(m) });
  out.push({ section: 'cost', label: 'X', key: 'mana', value: 'X' });
  for (const n of ['1', '2', '3']) out.push({ section: 'cost', label: `${n} pip${n === '1' ? '' : 's'}`, key: 'pip', value: n });

  for (const { value, count } of facetValues(r => r.attrs, rows)) {
    out.push({ section: 'attr', label: value, key: 'attr', value: value.toLowerCase(), count });
  }
  // Owner, 2026-09-05: the Mechanics rail "should ONLY be things that are
  // game mechanics (some things here are attributes like unstable and
  // burst)". So: the flags MARKED mechanic (cardsearch.ts FlagDef.mechanic)
  // are the section; {Burst} and {Unstable} sit with the attributes; the
  // deck-building pair get a section of their own while a deck is open; and
  // the bookkeeping flags (arted, playable, exclusive, scripted, rulings…)
  // are `is:` queries only.
  for (const f of ['burst', 'unstable']) out.push({ section: 'attr', label: f, key: 'is', value: f });
  for (const f of FLAGS) {
    if (f.mechanic) out.push({ section: 'mechanic', label: f.flag, key: 'is', value: f.flag });
  }
  if (building) {
    for (const f of ['deck', 'maybe']) out.push({ section: 'building', label: f === 'deck' ? 'in the deck' : 'on the maybeboard', key: 'is', value: f });
  }
  for (const { value, count } of facetValues(r => r.subtypes, rows).slice(0, 40)) {
    out.push({ section: 'subtype', label: value, key: 'sub', value: value.toLowerCase(), count });
  }
  // three chips, not thirty-five: the element decks are the Element section's
  // business, and a player asking "which box" means one of these
  for (const { value, count } of facetValues(r => [r.release], rows)) {
    out.push({ section: 'set', label: RELEASE_LABEL[value as Release], key: 'set', value, count });
  }
  for (const { value, count } of facetValues(r => [r.complexity], rows)) {
    out.push({ section: 'rarity', label: value, key: 'rarity', value: value.toLowerCase(), count });
  }
  for (const c of ['card', 'token', 'resource', 'marker', 'help', 'exclusive']) {
    out.push({ section: 'class', label: c, key: 'class', value: c });
  }
  return out;
}

export const SECTIONS: { id: string; title: string; note?: string }[] = [
  { id: 'element', title: 'Element', note: `${clickOrTap()} once to include, twice to exclude` },
  { id: 'cost', title: 'Cost' },
  { id: 'kind', title: 'Kind and timing' },
  { id: 'attr', title: 'Attributes' },
  { id: 'mechanic', title: 'Mechanics' },
  { id: 'building', title: 'This deck' },
  { id: 'subtype', title: 'Subtypes', note: 'the forty most common — the rest are one `sub:` away' },
  { id: 'set', title: 'Printed deck', note: 'which box it came in — the element decks are under Element' },
  { id: 'rarity', title: 'Complexity' },
  { id: 'class', title: 'What kind of thing', note: 'tokens, resources and the box’s reference cards are not deck-legal' },
];

/** One facet chip: include, exclude or clear, read off the query string. */
export function chipHtml(f: Facet, q: string, btns: FilterBtns = CARDS_BTNS): string {
  const state = chipState(q, f.key, f.value);
  const cls = ['cbchip', f.section === 'element' ? `elchip ${f.value}` : '', state === 'on' ? 'on' : state === 'off' ? 'off' : ''];
  const title = state === 'on' ? `showing only ${f.label} — click to exclude`
    : state === 'off' ? `hiding ${f.label} — click to clear`
      : `include ${f.label}`;
  return `<button class="${cls.filter(Boolean).join(' ')}" title="${esc(title)}"
    data-btn="${esc(btns.chip)}" data-key="${esc(f.key)}" data-value="${esc(f.value)}"
    >${f.icon ?? ''}${esc(f.label)}${f.count === undefined ? '' : `<span class="cbn">${f.count}</span>`}</button>`;
}

/** What the rail draws from. */
export interface FilterRailView {
  facets: Facet[];
  /** the query: every chip's state is read off it */
  q: string;
  /** which sections are open, by SECTIONS id */
  railOpen: Record<string, boolean>;
}

/** The facet rail: a section per SECTIONS entry that has chips, each folding
 * open on its head; the count of active chips on a closed one. */
export function filterRailHtml(v: FilterRailView, btns: FilterBtns = CARDS_BTNS): string {
  const all = v.facets;
  return `<aside class="cbrail" data-scroll="${esc(btns.scroll)}">
    ${SECTIONS.map(s => {
    const mine = all.filter(f => f.section === s.id);
    if (!mine.length) return '';
    const on = v.railOpen[s.id] ?? false;
    const active = mine.filter(f => chipState(v.q, f.key, f.value)).length;
    return `<section class="cbsection${on ? ' open' : ''}">
        <button class="cbsectionhead" data-btn="${esc(btns.section)}" data-section="${esc(s.id)}">
          <span>${esc(s.title)}</span>
          ${active ? `<span class="cbactive">${active}</span>` : ''}
          <span class="cbcaret">${on ? '▾' : '▸'}</span>
        </button>
        ${on ? `<div class="cbchips">${mine.map(f => chipHtml(f, v.q, btns)).join('')}</div>
          ${s.note ? `<div class="cbnote">${s.note}</div>` : ''}` : ''}
      </section>`;
  }).join('')}
  </aside>`;
}

/* ── the help sheet, printed from the parser's own tables ──────────────── */

/** The search syntax: the BODY of a sheet (the Cards page draws it in a centred
 * sheet, `cards-syntax`; the builder may draw it in a side one). Every example
 * and flag is a button that tries that query. */
export function syntaxHelpHtml(btns: FilterBtns = CARDS_BTNS): string {
  return `<p>Bare words search the name, type line and rules text. Terms side by side mean AND;
      <code>OR</code>, brackets to group, and a leading <code>-</code> to exclude.</p>
    <pre class="cbexample">-el:fire (sub:sprite OR sub:demon) mana&lt;=3</pre>
    <table class="cbkeys">
      <tr><th>filter</th><th>also</th><th>what it matches</th><th>example</th></tr>
      ${KEYS.map(d => `<tr>
        <td><code>${esc(d.key)}:</code></td>
        <td class="dim">${d.aliases.map(a => `<code>${esc(a)}:</code>`).join(' ')}</td>
        <td>${esc(d.help)}</td>
        <td><button class="cblink" data-btn="${esc(btns.try)}" data-q="${esc(d.example)}"><code>${esc(d.example)}</code></button></td>
      </tr>`).join('')}
    </table>
    <h3>Operators</h3>
    <p><code>:</code> contains · <code>=</code> exactly · <code>!=</code> not ·
      <code>&gt; &lt; &gt;= &lt;=</code> compare. A value can be
      <code>"a quoted phrase"</code> or <code>/a regex/</code>.</p>
    <p>Elements take all of them, which is where inclusive and exclusive live:
      <code>el:fire</code> has fire · <code>el:fire,wood</code> has both ·
      <code>el=fire,wood</code> is exactly those two ·
      <code>el&lt;=fire,wood</code> fits inside a fire/wood deck ·
      <code>-el:fire</code> is not fire at all.</p>
    <h3><code>is:</code></h3>
    <div class="cbflags">${FLAGS.map(f =>
    `<button class="cblink" data-btn="${esc(btns.try)}" data-q="is:${esc(f.flag)}"><code>is:${esc(f.flag)}</code></button>
       <span class="dim">${esc(f.help)}</span>`).join(' · ')}</div>
    <h3>Ordering</h3>
    <p><code>sort:</code> ${SORTS.map(s => `<code>${s}</code>`).join(' ')} ·
      <code>dir:asc</code>/<code>desc</code> ·
      <code>view:</code> ${VIEWS.map(v => `<code>${v}</code>`).join(' ')}</p>`;
}
