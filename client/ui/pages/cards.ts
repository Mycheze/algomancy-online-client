/* THE CARD BROWSER, DRAWN (`?cards`): browse, search, the syntax sheet, the
 * grid / list / text views, a pinned card, and deckbuilding mode.
 *
 * ui/cards.ts keeps the state (the query IS the page — see its header), the
 * fetches, the URL, the clicks and the keys; this file is the page contract
 * (pages/README.md): cardsView() gathers that state into a plain object,
 * cardsHtml(view) draws it and touches nothing else, paintCards() puts it on
 * the page and wires the query box and the sort menu.
 *
 * Moved out of cards.ts in the design-system round (2026-11-03), the
 * templates byte for byte. The tile's three deliberate absences (no name
 * banner, no `title`, no `i` button) are documented at tileHtml below; the
 * `data-prev` on every tile and row is what the hover text box reads
 * (test/907).
 */
import { iconizeText } from '../cardtext.ts';
import { ALL_ELEMENTS } from '../../engine/src/apply.ts';
import { artHtml, cardPanelHtml, costHtml, deckStripHtml } from '../cardpanel.ts';
import type { CardRow, Release } from '../cardindex.ts';
import { allRows, facetValues, RELEASE_LABEL, rowFor } from '../cardindex.ts';
import { printsStats } from '../../engine/src/cards/dsl.ts';   // CR 206.2
import { FLAGS, KEYS, SORTS, VIEWS, chipState, type SearchResult } from '../cardsearch.ts';
import { suggest } from '../cardsynonyms.ts';
import { esc, elIcon } from '../util.ts';
import type { CardsState, DeckBridge } from '../cards.ts';

/** How many tiles are painted before the "show the rest" button. Not a cap on
 * the SEARCH — the count above the grid is always the true total. */
export const CHUNK = 120;

/** Everything the page shows. */
export interface CardsView {
  q: string;
  /** the query, run */
  res: SearchResult;
  /** how many deck-legal cards there are ("The 450 cards.") */
  cardCount: number;
  /** deckbuilding mode: the deck being built, or null */
  deck: {
    name: string;
    summary: ReturnType<DeckBridge['summary']>;
    /** a weekly challenge's deck has no maybeboard */
    noMaybe: boolean;
    /** copies in the deck of every card painted this time */
    copies: Record<string, number>;
  } | null;
  facets: Facet[];
  railOpen: Record<string, boolean>;
  /** "did you mean" suggestions for the query */
  hints: ReturnType<typeof suggest>;
  saved: { name: string; q: string }[];
  helpOpen: boolean;
  focus: string | null;
  /** the pinned card's row, or null when it is not one the index knows */
  focusRow: CardRow | null;
  /** how many published decks play the pinned card */
  played: number;
  rulings: { name: string; lines: string[] } | null;
  /** the keyboard cursor into the painted results, or -1 */
  cursor: number;
  /** how many results are painted */
  shown: number;
}

/** Gather the page from cards.ts's state. */
export function cardsView(st: CardsState): CardsView {
  const b = st.bridge;
  const page = st.res.rows.slice(0, st.shown);
  return {
    q: st.q,
    res: st.res,
    cardCount: allRows().filter(r => r.cls === 'card').length,
    deck: b ? {
      name: b.name(), summary: b.summary(), noMaybe: !!b.noMaybe,
      copies: Object.fromEntries(page.map(r => [r.name, b.copies(r.name)])),
    } : null,
    facets: facets(!!b),
    railOpen: { ...st.railOpen },
    hints: suggest(st.q),
    saved: st.saved,
    helpOpen: st.helpOpen,
    focus: st.focus,
    focusRow: st.focus ? rowFor(st.focus) ?? null : null,
    played: st.focus ? st.playedIn?.[rowFor(st.focus)?.name ?? ''] ?? 0 : 0,
    rulings: st.rulings,
    cursor: st.cursor,
    shown: st.shown,
  };
}

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

const SECTIONS: { id: string; title: string; note?: string }[] = [
  { id: 'element', title: 'Element', note: 'click once to include, twice to exclude' },
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

function chipHtml(f: Facet, q: string): string {
  const state = chipState(q, f.key, f.value);
  const cls = ['cbchip', f.section === 'element' ? `elchip ${f.value}` : '', state === 'on' ? 'on' : state === 'off' ? 'off' : ''];
  const title = state === 'on' ? `showing only ${f.label} — click to exclude`
    : state === 'off' ? `hiding ${f.label} — click to clear`
      : `include ${f.label}`;
  return `<button class="${cls.filter(Boolean).join(' ')}" title="${esc(title)}"
    data-btn="cards-chip" data-key="${esc(f.key)}" data-value="${esc(f.value)}"
    >${f.icon ?? ''}${esc(f.label)}${f.count === undefined ? '' : `<span class="cbn">${f.count}</span>`}</button>`;
}

function railHtml(v: CardsView): string {
  const all = v.facets;
  return `<aside class="cbrail">
    ${SECTIONS.map(s => {
    const mine = all.filter(f => f.section === s.id);
    if (!mine.length) return '';
    const on = v.railOpen[s.id] ?? false;
    const active = mine.filter(f => chipState(v.q, f.key, f.value)).length;
    return `<section class="cbsection${on ? ' open' : ''}">
        <button class="cbsectionhead" data-btn="cards-section" data-section="${esc(s.id)}">
          <span>${esc(s.title)}</span>
          ${active ? `<span class="cbactive">${active}</span>` : ''}
          <span class="cbcaret">${on ? '▾' : '▸'}</span>
        </button>
        ${on ? `<div class="cbchips">${mine.map(f => chipHtml(f, v.q)).join('')}</div>
          ${s.note ? `<div class="cbnote">${s.note}</div>` : ''}` : ''}
      </section>`;
  }).join('')}
  </aside>`;
}

/* ── results ───────────────────────────────────────────────────────────── */

/** The per-card controls, which only exist when a deck is open. */
function tileButtons(v: CardsView, r: CardRow): string {
  const deck = v.deck;
  if (!deck || !r.playable) return '';
  const n = deck.copies[r.name] ?? 0;
  return `<span class="dkbtns">
    ${n ? `<button data-btn="cards-less" data-card="${esc(r.name)}" title="cut one">−</button>` : ''}
    <button data-btn="cards-add" data-card="${esc(r.name)}" title="add a copy">+</button>
    ${!deck.noMaybe ? `<button data-btn="cards-maybe" data-card="${esc(r.name)}" title="add to the maybeboard">»</button>` : ''}
  </span>`;
}

/**
 * One card tile.
 *
 * THREE THINGS IT DELIBERATELY DOES NOT HAVE, all from the owner's first read
 * of the shipped page (2026-08-28):
 *
 *  - NO NAME BANNER. The deck page prints the card's name across the bottom of
 *    the scan, which is right there (you are looking for a card you chose) and
 *    wrong here (you are reading cards you have not chosen): *"The name banner
 *    is blocking the card text from being read. Better to just remove it."*
 *    The scan prints its own name at the top anyway.
 *  - NO `title`. The native tooltip and the client's own hover box were both
 *    firing: *"There are two hover texts that are competing. The one that shows
 *    the text (not just the card name) is more useful."* `data-prev` is that
 *    one, so the native one goes.
 *  - NO `i` BUTTON. The whole tile is the target: *"The i clicking doesn't need
 *    to be its own button, just clicking the card should pin it like that."*
 *    The add/cut buttons still work, because main.ts's delegation asks
 *    `closest('[data-btn]')` and they are nearer than the tile.
 */
function tileHtml(v: CardsView, r: CardRow, at = -1): string {
  const n = v.deck?.copies[r.name] ?? 0;
  const over = n > 2;
  return `<div class="dktile cbtile${over ? ' overcap' : ''}${r.cls === 'card' ? '' : ' noncard'}${at === v.cursor ? ' sel' : ''}"
      data-prev="${esc(r.name)}" data-btn="cards-focus" data-card="${esc(r.name)}">
    ${artHtml(r, 'dkart')}
    ${n ? `<span class="dkn${over ? ' bad' : ''}">×${n}</span>` : ''}
    ${r.cls === 'card' ? '' : `<span class="cbclass">${esc(r.cls)}</span>`}
    ${tileButtons(v, r)}
  </div>`;
}

/** A card's rules text on ONE line. `iconizeText` turns the printed `{/n}`
 * into a real `<br>`, which `white-space: nowrap` cannot flatten — so the list
 * rows grew to two and three lines each and the table stopped scanning. */
const oneLine = (text: string): string =>
  iconizeText(text).replace(/<br\s*\/?>/gi, ' ').replace(/\s{2,}/g, ' ');

function rowHtml(v: CardsView, r: CardRow, at = -1): string {
  const n = v.deck?.copies[r.name] ?? 0;
  return `<div class="cbrow${at === v.cursor ? ' sel' : ''}"
      data-prev="${esc(r.name)}" data-btn="cards-focus" data-card="${esc(r.name)}">
    <span class="cbrowcost">${costHtml(r)}</span>
    <span class="cbrowname">${esc(r.name)}</span>
    <span class="cbrowtype">${esc(r.type)}</span>
    ${/* ALWAYS emitted, empty for a spell. A spell has no power/toughness, and
        omitting the cell let CSS grid slide the rules text up into the 44px
        stats column, where every spell's text was clipped to "Gain c..." —
        which looked like a text bug and was a layout one. */ ''
    }<span class="cbpt">${printsStats(r.kind) ? `${r.power}/${r.toughness}` : ''}</span>
    <span class="cbrowtext">${oneLine(r.text)}</span>
    ${n ? `<span class="dkn">×${n}</span>` : ''}
    ${tileButtons(v, r)}
  </div>`;
}

function resultsHtml(v: CardsView): string {
  const { res, q } = v;
  const { rows, total, query } = res;
  const page = rows.slice(0, v.shown);
  const rest = total - page.length;
  const body = query.view === 'text'
    ? `<textarea class="cbtext" readonly rows="${Math.min(30, Math.max(4, page.length))}"
        onclick="this.select()">${esc(page.map(r => r.name).join('\n'))}</textarea>`
    : query.view === 'list'
      ? `<div class="cblist">${page.map((r, i) => rowHtml(v, r, i)).join('')}</div>`
      : `<div class="dkgrid cbgrid">${page.map((r, i) => tileHtml(v, r, i)).join('')}</div>`;
  return `<div class="cbcount">
      <b>${total}</b> card${total === 1 ? '' : 's'}${total > page.length ? ` — showing ${page.length}` : ''}
      ${res.implicitCards
    ? `<span class="cbimplicit">tokens and reference cards not counted —
        <button class="cblink" data-btn="cards-try" data-q="${esc(q ? `${q} class:all` : 'class:all')}">class:all</button></span>`
    : ''}
      ${total === 0 ? '<span class="hint">nothing matches — loosen a filter, or check the syntax under \u201c?\u201d.</span>' : ''}
    </div>
    ${body}
    ${rest > 0
    ? `<button class="cbmore" data-btn="cards-more">show ${Math.min(rest, CHUNK)} more (${rest} left)</button>`
    : ''}`;
}

/* ── the detail pane ───────────────────────────────────────────────────── */

/** This page's pinned card: the shared panel (ui/cardpanel.ts) plus the two
 * buttons that only mean something here, and the add button deckbuilding mode
 * puts on it. */
function detailHtml(v: CardsView): string {
  const { focus, focusRow: r } = v;
  if (!focus) return '';
  if (!r) return '';
  const played = v.played;
  return cardPanelHtml(focus, {
    close: 'cards-unfocus',
    rulings: v.rulings,
    // Published decks only, and the link goes to the LIST rather than to a
    // filtered view of it: BL-13's note is that nothing may reconstruct a deck
    // out of an aggregate, and a count is the aggregate — the decks behind it
    // are on the metagame page, where each one is a list somebody published.
    extra: (played
      ? `<div class="cbfact">In ${played} published deck${played === 1 ? '' : 's'} —
          <button class="cblink" data-btn="meta-openpage">metagame</button></div>`
      : '')
      // how it has done in the games played here — the card stats tab, opened on it
      + `<div class="cbfact"><button class="cblink" data-btn="meta-stats-open" data-card="${esc(r.name)}">card stats</button></div>`,
    actions: `<button data-btn="cards-similar" data-card="${esc(r.name)}">find similar</button>
      <button data-btn="cards-rulings" data-card="${esc(r.name)}">rulings</button>
      <button data-btn="cards-copylink" data-card="${esc(r.name)}" title="a link to this card, to paste in Discord or anywhere">copy link</button>
      ${v.deck && r.playable ? `<button class="primary" data-btn="cards-add" data-card="${esc(r.name)}">add to ${esc(v.deck.name)}</button>` : ''}`,
  });
}

/* ── the help sheet, printed from the parser's own tables ──────────────── */

function helpHtml(v: CardsView): string {
  if (!v.helpOpen) return '';
  return `<section class="cbhelp">
    <button class="cbclose" data-btn="cards-help" title="close">×</button>
    <h2>Search syntax</h2>
    <p>Bare words search the name, type line and rules text. Terms side by side mean AND;
      <code>OR</code>, brackets to group, and a leading <code>-</code> to exclude.</p>
    <pre class="cbexample">-el:fire (sub:sprite OR sub:demon) mana&lt;=3</pre>
    <table class="cbkeys">
      <tr><th>filter</th><th>also</th><th>what it matches</th><th>example</th></tr>
      ${KEYS.map(d => `<tr>
        <td><code>${esc(d.key)}:</code></td>
        <td class="dim">${d.aliases.map(a => `<code>${esc(a)}:</code>`).join(' ')}</td>
        <td>${esc(d.help)}</td>
        <td><button class="cblink" data-btn="cards-try" data-q="${esc(d.example)}"><code>${esc(d.example)}</code></button></td>
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
    `<button class="cblink" data-btn="cards-try" data-q="is:${esc(f.flag)}"><code>is:${esc(f.flag)}</code></button>
       <span class="dim">${esc(f.help)}</span>`).join(' · ')}</div>
    <h3>Ordering</h3>
    <p><code>sort:</code> ${SORTS.map(s => `<code>${s}</code>`).join(' ')} ·
      <code>dir:asc</code>/<code>desc</code> ·
      <code>view:</code> ${VIEWS.map(v => `<code>${v}</code>`).join(' ')}</p>
  </section>`;
}

/* ── the page ──────────────────────────────────────────────────────────── */

/**
 * The strip that says what you are building, and moves as you build it.
 *
 * The curve and the element spread are here rather than back on the deck page
 * because they are the two things you are deciding ABOUT while you search: a
 * card is a good pick or a bad one relative to what the deck already has, and
 * making you click away to find that out is what makes a browser feel separate
 * from the deckbuilder.
 */
function deckSideHtml(v: CardsView): string {
  if (!v.deck) return '';
  return deckStripHtml(v.deck.name, v.deck.summary,
    { trailing: '<button data-btn="cards-toDeck">back to the deck</button>' });
}

function barHtml(v: CardsView): string {
  const { res, q, hints, saved } = v;
  return `<div class="cbbar">
      <input id="cb-q" class="cbq" spellcheck="false" autocomplete="off"
        placeholder="search — try  el:wood kind:unit mana:2 -kw:virus"
        value="${esc(q)}">
      ${q ? '<button class="cbclear" data-btn="cards-clear" title="clear">×</button>' : ''}
      <button data-btn="cards-help" title="search syntax">?</button>
    </div>
    ${res.query.errors.length
    ? `<div class="cberr">${res.query.errors.map(e => esc(e.message)).join(' · ')}</div>`
    : ''}
    ${hints.length
    ? `<div class="cbsuggest">did you mean ${hints.map(h =>
      `<button class="cblink" data-btn="cards-try" data-q="${esc(h.query)}" title="${esc(h.why)}"><code>${esc(h.query)}</code></button>`).join(' or ')}?</div>`
    : ''}
    <div class="cbtools">
      <label>sort
        <select id="cb-sort">${SORTS.map(s =>
    `<option value="${s}"${res.query.sort === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
      </label>
      <button data-btn="cards-dir" title="reverse the order">${res.query.dir === 'asc' ? '↑' : '↓'}</button>
      <span class="cbviews">${VIEWS.map(v =>
    `<button class="${res.query.view === v ? 'on' : ''}" data-btn="cards-view" data-view="${v}">${v}</button>`).join('')}</span>
      <span class="cbspacer"></span>
      ${saved.map(s => `<button class="cblink" data-btn="cards-try" data-q="${esc(s.q)}">${esc(s.name)}</button>`).join('')}
      ${q ? '<button data-btn="cards-save" title="keep this search">save search</button>' : ''}
      ${saved.length ? '<button data-btn="cards-forget" title="drop the saved searches">forget</button>' : ''}
    </div>`;
}

export function cardsHtml(v: CardsView): string {
  return `<div class="cbpage">
    <div class="accthead">
      <div>
        <h1>Cards</h1>
        <div class="hint">The ${v.cardCount} cards. Tokens and
          reference cards: <button class="cblink" data-btn="cards-try" data-q="class:all">class:all</button>.</div>
      </div>
      <div class="accthbtns">
        <button class="primary" data-btn="cards-close">${v.deck ? 'Back to the deck' : 'Return to Lobby'}</button>
      </div>
    </div>
    ${deckSideHtml(v)}
    ${barHtml(v)}
    ${helpHtml(v)}
    <div class="cbmain">
      ${railHtml(v)}
      <section class="cbresults">${resultsHtml(v)}</section>
      ${detailHtml(v)}
    </div>
  </div>`;
}

/** What paintCards wires the query box and the sort menu to (cards.ts). */
export interface CardsHooks {
  /** the sort menu changed */
  onSort: (value: string) => void;
  /** a keystroke in the query box */
  onInput: (value: string) => void;
  /** true once after the page opens or the box is cleared: put the caret in the box */
  takeFocus: () => boolean;
}

/** Paint `v` into `app`, then wire the live query box — it must not repaint
 * the page under the cursor (cards.ts scheduleRepaint / repaintKeepingCaret). */
export function paintCards(app: HTMLElement, v: CardsView, h: CardsHooks): void {
  app.classList.remove('board');
  app.innerHTML = cardsHtml(v);
  // the sort menu answers to CHANGE, not to click. A click on a <select> is the
  // click that OPENS it, so a click handler reads the value you are replacing.
  const sort = document.getElementById('cb-sort') as HTMLSelectElement | null;
  sort?.addEventListener('change', () => h.onSort(sort.value));

  // keep the keyboard cursor on screen. Full-repaint rendering means the
  // browser's own scroll-into-view never fires, so it is done by hand.
  document.querySelector('.cbtile.sel, .cbrow.sel')?.scrollIntoView({ block: 'nearest' });

  const box = document.getElementById('cb-q') as HTMLInputElement | null;
  if (!box) return;
  box.addEventListener('input', () => h.onInput(box.value));
  if (h.takeFocus()) {
    box.focus();
    box.selectionStart = box.selectionEnd = box.value.length;
  }
}
