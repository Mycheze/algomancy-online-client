/* THE CARD BROWSER: look at the whole pool, ask it a real question, build.
 *
 * Same contract as ui/decks.ts and ui/account.ts, which main.ts already knows
 * how to drive: screen() says whether this page owns the app element,
 * renderScreen() paints it, handleButton() is offered every click first
 * (everything here is prefixed `cards-`), and the page's state lives in this
 * file and nowhere else.
 *
 * TWO EDITORS, ONE STATE. The query string in the box IS the page: the facet
 * chips down the left do not hold state of their own, they rewrite that string
 * (ui/cardsearch.ts `withChip`), and typing in the box re-derives which chips
 * look pressed. So a chip can never disagree with the box, the URL can carry
 * the whole page, and a search is a link. The alternative — chips holding
 * booleans, with the box as a shortcut — has two representations of one thing
 * and they drift the first time somebody types a paren.
 *
 * NO RESULT CAP. The drawer this replaces showed the first 60 and said so;
 * 537 rows is nothing to filter, so the only limit here is how many tiles are
 * PAINTED at once (CHUNK), and the button that reveals the rest says how many
 * are left. A count that is the truth is the whole point of a search.
 *
 * DECKBUILDING MODE. Opened from a deck (`useDeck`), every tile grows the
 * add/cut controls and `in:` / `copies:` start answering. The browser never
 * touches the deck itself: it calls the bridge ui/decks.ts handed it, so every
 * edit still goes through that file's one `edit()` -> `scheduleSave()` funnel
 * and the debounce rules stay where they are documented.
 */
import { iconizeText, printedTextBox, txtIcon } from './cardtext.ts';
import { GLOSSARY } from './glossary.ts';
import { ALL_ELEMENTS } from '../src/apply.ts';
import type { CardRow } from './cardindex.ts';
import { allRows, facetValues } from './cardindex.ts';
import {
  FLAGS, KEYS, SORTS, VIEWS, chipState, nextChipState, search,
  withChip, withDisplay, type SearchResult,
} from './cardsearch.ts';
import { meaningOf, suggest } from './cardsynonyms.ts';
import { esc, elIcon } from './util.ts';

const ART = '../../../AlgomancyCards/';
const art = (r: CardRow): string => ART + (r.image || r.name.replace(/ /g, '-') + '.jpg');

/**
 * The scan, or the name in its place.
 *
 * The board and the deck page both emit an `<img>` unconditionally and hide it
 * `onerror`, which is right there: every card they can show has art. This page
 * shows the whole box, and nine of those cards (the Kickstarter Glitch cards)
 * have no scan at all — so an unconditional `<img>` fires nine guaranteed 404s
 * on every paint that includes them. The index already knows: `hasArt` is
 * computed at extract time from what is on disk. Ask for a file only when
 * there is one, and print the name when there is not.
 */
function artHtml(r: CardRow, cls: string): string {
  if (!r.hasArt) return `<div class="${cls} cbnoart">${esc(r.name)}</div>`;
  return `<img class="${cls}" src="${esc(art(r))}" alt="${esc(r.name)}" loading="lazy"
    onerror="this.style.visibility='hidden'">`;
}

/** How many tiles are painted before the "show the rest" button. Not a cap on
 * the SEARCH — the count above the grid is always the true total. */
const CHUNK = 120;

/* An empty box means "the cards", not "everything" — see the implicit class
 * filter in ui/cardsearch.ts. There is no seeded default query any more:
 * clearing the box has to actually clear it. */
const QUERY_KEY = 'algoCardQuery';
const SAVED_KEY = 'algoCardSearches';

/** What ui/decks.ts lends the browser so it can build a deck without either
 * file importing the other's state. See the header. */
export interface DeckBridge {
  id: () => string | null;
  name: () => string;
  copies: (name: string) => number;
  maybe: (name: string) => number;
  add: (name: string) => void;
  remove: (name: string) => void;
  toMaybe: (name: string) => void;
  /** everything the deck strip paints: the count, whether it is legal yet, and
   * the two numbers you actually build against — the curve and the element
   * spread. All of it from ui/deckstats.ts's `analyzeDeck`, so the browser
   * does no deck arithmetic of its own. */
  summary: () => {
    total: number;
    legal: boolean;
    problems: string[];
    curve: { mana: number; total: number }[];
    elements: Record<string, number>;
  };
  /** go back to the deck page */
  back: () => void;
}

// ── module state ──────────────────────────────────────────────────────

let $app: HTMLElement | null = null;
let rerenderHost: () => void = () => {};
let open = false;
let q = '';
let bridge: DeckBridge | null = null;
let focus: string | null = null;
let shown = CHUNK;
let helpOpen = false;
/** which facet sections are unfolded — the rail is long and most of it is not
 * what you came for */
const railOpen: Record<string, boolean> = { element: true, cost: true, kind: true };
let rulings: { name: string; lines: string[] } | null = null;
/** focus the query box on the NEXT paint only. Focusing on every paint means a
 * chip click yanks the caret out of wherever you were, and the page under it
 * jumps — the drawer in ui/decks.ts gets away with it because it paints once
 * when it opens; this page repaints on every chip. */
let wantFocus = true;
/** the keyboard cursor into the painted results, or -1 for none */
let cursor = -1;

export const screen = (): 'cards' | null => (open ? 'cards' : null);

export function initCards(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  // a query in the URL wins: that is what makes a search a shareable link
  const url = new URLSearchParams(location.search);
  const fromUrl = url.get('q');
  if (fromUrl !== null) q = fromUrl;
  else q = load(QUERY_KEY, '');
  if (url.has('cards')) open = true;
}

/** Hand the browser a deck to build, or null to leave deckbuilding mode. */
export function useDeck(b: DeckBridge | null): void {
  bridge = b;
}

/** Open the browser. `query` seeds the box; deckbuilding mode is whatever the
 * last `useDeck` said. */
export function openBrowser(query?: string): void {
  if (query !== undefined) q = query;
  open = true;
  shown = CHUNK;
  focus = null;
  wantFocus = true;
  // the address bar has to say what the page is showing FROM THE START. It was
  // only written on the next edit, so opening the page with a remembered query
  // showed 18 cards behind a URL that meant "all of them" — and copying that
  // link sent someone a different search.
  syncUrl();
  renderScreen();
}

const load = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch { return fallback; }
};
const save = (key: string, v: unknown): void => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window */ }
};

const savedSearches = (): { name: string; q: string }[] => load(SAVED_KEY, [] as { name: string; q: string }[]);

/* ── running the query ─────────────────────────────────────────────────── */

const ctx = (): { copies?: (n: string) => number; maybe?: (n: string) => number } =>
  (bridge ? { copies: bridge.copies, maybe: bridge.maybe } : {});

function run(): SearchResult {
  return search(q, { ctx: ctx() });
}

/* ── the facet rail ────────────────────────────────────────────────────── */

interface Facet { section: string; label: string; key: string; value: string; icon?: string; count?: number }

/**
 * The chips, derived from the pool rather than listed here — a new element, a
 * new subtype or a new printed deck appears in the rail with no edit to this
 * file. (`derive, never enumerate`: the one rule this repo keeps relearning.)
 */
function facets(): Facet[] {
  const rows = allRows();
  const out: Facet[] = [];
  for (const el of ALL_ELEMENTS) {
    out.push({ section: 'element', label: el, key: 'el', value: el, icon: elIcon(el) });
  }
  out.push({ section: 'element', label: 'mono', key: 'el', value: 'mono' });
  out.push({ section: 'element', label: 'hybrid', key: 'el', value: 'hybrid' });
  out.push({ section: 'element', label: 'colourless', key: 'el', value: 'none' });

  for (const k of ['unit', 'spell', 'spellunit', 'spelltoken']) {
    out.push({ section: 'kind', label: k, key: 'kind', value: k });
  }
  for (const t of ['deploy', 'battle', 'haste']) {
    out.push({ section: 'kind', label: t, key: 'timing', value: t });
  }
  for (let m = 0; m <= 8; m++) out.push({ section: 'cost', label: String(m), key: 'mana', value: String(m) });
  out.push({ section: 'cost', label: 'X', key: 'mana', value: 'X' });
  for (const n of ['1', '2', '3']) out.push({ section: 'cost', label: `${n} pip${n === '1' ? '' : 's'}`, key: 'pip', value: n });

  for (const { value, count } of facetValues(r => r.attrs, rows)) {
    out.push({ section: 'attr', label: value, key: 'attr', value: value.toLowerCase(), count });
  }
  for (const f of FLAGS) {
    // already chips in another section — a rail that offers the same filter
    // twice is a rail you cannot read the state of
    if (['unit', 'spell', 'spellunit', 'deploy', 'battle', 'haste', 'mono', 'hybrid', 'colorless'].includes(f.flag)) continue;
    // and the two that can only ever answer "no" without a deck open
    if ((f.flag === 'deck' || f.flag === 'maybe') && !bridge) continue;
    out.push({ section: 'mechanic', label: f.flag, key: 'is', value: f.flag });
  }
  for (const { value, count } of facetValues(r => r.subtypes, rows).slice(0, 40)) {
    out.push({ section: 'subtype', label: value, key: 'sub', value: value.toLowerCase(), count });
  }
  for (const { value, count } of facetValues(r => [r.set], rows)) {
    out.push({ section: 'set', label: value, key: 'set', value, count });
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
  { id: 'subtype', title: 'Subtypes', note: 'the forty most common — the rest are one `sub:` away' },
  { id: 'set', title: 'Printed deck' },
  { id: 'rarity', title: 'Complexity' },
  { id: 'class', title: 'What kind of thing', note: 'tokens, resources and the box’s reference cards are not deck-legal' },
];

function chipHtml(f: Facet): string {
  const state = chipState(q, f.key, f.value);
  const cls = ['cbchip', f.section === 'element' ? `elchip ${f.value}` : '', state === 'on' ? 'on' : state === 'off' ? 'off' : ''];
  const title = state === 'on' ? `showing only ${f.label} — click to exclude`
    : state === 'off' ? `hiding ${f.label} — click to clear`
      : `include ${f.label}`;
  return `<button class="${cls.filter(Boolean).join(' ')}" title="${esc(title)}"
    data-btn="cards-chip" data-key="${esc(f.key)}" data-value="${esc(f.value)}"
    >${f.icon ?? ''}${esc(f.label)}${f.count === undefined ? '' : `<span class="cbn">${f.count}</span>`}</button>`;
}

function railHtml(): string {
  const all = facets();
  return `<aside class="cbrail">
    ${SECTIONS.map(s => {
    const mine = all.filter(f => f.section === s.id);
    if (!mine.length) return '';
    const on = railOpen[s.id] ?? false;
    const active = mine.filter(f => chipState(q, f.key, f.value)).length;
    return `<section class="cbsection${on ? ' open' : ''}">
        <button class="cbsectionhead" data-btn="cards-section" data-section="${esc(s.id)}">
          <span>${esc(s.title)}</span>
          ${active ? `<span class="cbactive">${active}</span>` : ''}
          <span class="cbcaret">${on ? '▾' : '▸'}</span>
        </button>
        ${on ? `<div class="cbchips">${mine.map(chipHtml).join('')}</div>
          ${s.note ? `<div class="cbnote">${s.note}</div>` : ''}` : ''}
      </section>`;
  }).join('')}
  </aside>`;
}

/* ── results ───────────────────────────────────────────────────────────── */

const ELEMENT_OF_PIP_ICON: Record<string, string> =
  { r: 'fire', b: 'water', e: 'earth', g: 'wood', m: 'metal', l: 'light', d: 'dark' };

/**
 * The printed cost as real icons: the mana circle, then the affinity pips.
 *
 * TWO-DIGIT COSTS DRAW PER DIGIT, which is not a flourish — the icon set stops
 * at cost_9, and `Collective Creation` (10) and `Vengeance` (13) each asked the
 * server for a `cost_13.webp` that does not exist. `txtIcon` degrades to its
 * alt text on error so it LOOKED right, and fired a 404 on every paint that
 * included either card. Splitting the digits is the convention ui/cardtext.ts
 * already states for `[10]`, so this matches what the card text does.
 */
const costHtml = (r: CardRow): string => {
  const mana = r.isX
    ? txtIcon('cost_x', '[X]')
    : [...String(r.mana)].map(d => txtIcon(`cost_${d}`, d)).join('');
  // Only the seven elements have a pip icon. The `p` of the prismite and shard
  // faces has none — asking for /Icons/p.webp 404s on every paint and shows
  // the alt text anyway — so an unknown pip prints the way the oracle file
  // writes it instead.
  return mana + [...r.cost]
    .map(p => (ELEMENT_OF_PIP_ICON[p] ? txtIcon(ELEMENT_OF_PIP_ICON[p]!, `[${p}]`) : `[${esc(p)}]`))
    .join('');
};

/** The per-card controls, which only exist when a deck is open. */
function tileButtons(r: CardRow): string {
  if (!bridge || !r.playable) return '';
  const n = bridge.copies(r.name);
  return `<span class="dkbtns">
    ${n ? `<button data-btn="cards-less" data-card="${esc(r.name)}" title="cut one">−</button>` : ''}
    <button data-btn="cards-add" data-card="${esc(r.name)}" title="add a copy">+</button>
    <button data-btn="cards-maybe" data-card="${esc(r.name)}" title="add to the maybeboard">»</button>
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
function tileHtml(r: CardRow, at = -1): string {
  const n = bridge?.copies(r.name) ?? 0;
  const over = n > 2;
  return `<div class="dktile cbtile${over ? ' overcap' : ''}${r.cls === 'card' ? '' : ' noncard'}${at === cursor ? ' sel' : ''}"
      data-prev="${esc(r.name)}" data-btn="cards-focus" data-card="${esc(r.name)}">
    ${artHtml(r, 'dkart')}
    ${n ? `<span class="dkn${over ? ' bad' : ''}">×${n}</span>` : ''}
    ${r.cls === 'card' ? '' : `<span class="cbclass">${esc(r.cls)}</span>`}
    ${tileButtons(r)}
  </div>`;
}

/** A card's rules text on ONE line. `iconizeText` turns the printed `{/n}`
 * into a real `<br>`, which `white-space: nowrap` cannot flatten — so the list
 * rows grew to two and three lines each and the table stopped scanning. */
const oneLine = (text: string): string =>
  iconizeText(text).replace(/<br\s*\/?>/gi, ' ').replace(/\s{2,}/g, ' ');

function rowHtml(r: CardRow, at = -1): string {
  const n = bridge?.copies(r.name) ?? 0;
  return `<div class="cbrow${at === cursor ? ' sel' : ''}"
      data-prev="${esc(r.name)}" data-btn="cards-focus" data-card="${esc(r.name)}">
    <span class="cbrowcost">${costHtml(r)}</span>
    <span class="cbrowname">${esc(r.name)}</span>
    <span class="cbrowtype">${esc(r.type)}</span>
    ${/* ALWAYS emitted, empty for a spell. A spell has no power/toughness, and
        omitting the cell let CSS grid slide the rules text up into the 44px
        stats column, where every spell's text was clipped to "Gain c..." —
        which looked like a text bug and was a layout one. */ ''
    }<span class="cbpt">${r.kind === 'spell' ? '' : `${r.power}/${r.toughness}`}</span>
    <span class="cbrowtext">${oneLine(r.text)}</span>
    ${n ? `<span class="dkn">×${n}</span>` : ''}
    ${tileButtons(r)}
  </div>`;
}

function resultsHtml(res: SearchResult): string {
  const { rows, total, query } = res;
  const page = rows.slice(0, shown);
  const rest = total - page.length;
  const body = query.view === 'text'
    ? `<textarea class="cbtext" readonly rows="${Math.min(30, Math.max(4, page.length))}"
        onclick="this.select()">${esc(page.map(r => r.name).join('\n'))}</textarea>`
    : query.view === 'list'
      ? `<div class="cblist">${page.map((r, i) => rowHtml(r, i)).join('')}</div>`
      : `<div class="dkgrid cbgrid">${page.map((r, i) => tileHtml(r, i)).join('')}</div>`;
  return `<div class="cbcount">
      <b>${total}</b> card${total === 1 ? '' : 's'}${total > page.length ? ` — showing ${page.length}` : ''}
      ${res.implicitCards
    ? `<span class="cbimplicit">tokens, resources and the box\u2019s reference cards are not counted —
        <button class="cblink" data-btn="cards-try" data-q="${esc(q ? `${q} class:all` : 'class:all')}">class:all</button> to include them</span>`
    : ''}
      ${total === 0 ? '<span class="hint">nothing matches. Loosen a chip, or check the syntax with \u201c?\u201d.</span>' : ''}
    </div>
    ${body}
    ${rest > 0
    ? `<button class="cbmore" data-btn="cards-more">show ${Math.min(rest, CHUNK)} more (${rest} left)</button>`
    : ''}`;
}

/* ── the detail pane ───────────────────────────────────────────────────── */

/**
 * What every keyword on this card means.
 *
 * The glossary is the RULE, and it wins wherever it has an entry — those lines
 * are pinned to rulings by 177-glossary-conformance. ui/cardsynonyms.ts covers
 * the rest (graft, debt, prophecy…) in the looser search phrasing, so a
 * keyword the rules reference has not got a row for still gets a sentence
 * rather than nothing.
 */
function glossaryFor(r: CardRow): string {
  const terms = GLOSSARY.filter(g => r.attrs.includes(g.term) || r.keywords.includes(g.term.toLowerCase()));
  const covered = new Set(terms.map(g => g.term.toLowerCase()));
  const rest = r.keywords
    .filter(k => !covered.has(k))
    .map(k => ({ k, meaning: meaningOf(k) }))
    .filter((x): x is { k: string; meaning: string } => x.meaning !== null);
  if (!terms.length && !rest.length) return '';
  return `<div class="cbgloss">${terms.map(g =>
    `<div><b>${esc(g.label ?? g.term)}</b> — ${esc(g.text)}${
      g.ruling?.length ? ` <span class="dim">${esc(g.ruling.join(', '))}</span>` : ''}</div>`).join('')}${
    rest.map(x => `<div><b>${esc(x.k)}</b> — ${esc(x.meaning)}</div>`).join('')}</div>`;
}

function detailHtml(): string {
  if (!focus) return '';
  const r = allRows().find(x => x.name === focus);
  if (!r) return '';
  const box = r.scripted ? printedTextBox(r.name) : null;
  const lines = box ? box.lines.map(l => l.text) : [r.text];
  return `<section class="cbdetail">
    <button class="cbclose" data-btn="cards-unfocus" title="close">×</button>
    ${artHtml(r, 'cbdetailart')}
    <h2>${esc(r.name)}</h2>
    <div class="cbdetailcost">${costHtml(r)}</div>
    <div class="cbdetailtype">${esc(r.type)}${r.kind === 'spell' ? '' : ` · ${r.power}/${r.toughness}`}</div>
    <div class="cbdetailtext">${lines.map(t => `<p>${iconizeText(t)}</p>`).join('')}</div>
    ${r.prophecy ? '<div class="cbfact">Prophecy — a cheaper alternative cost once its printed condition is true.</div>' : ''}
    ${r.ambush ? '<div class="cbfact">Ambush — an alternative battle play mode.</div>' : ''}
    ${glossaryFor(r)}
    <dl class="cbfacts">
      ${r.set ? `<dt>deck</dt><dd>${esc(r.set)}</dd>` : ''}
      ${r.complexity ? `<dt>complexity</dt><dd>${esc(r.complexity)}</dd>` : ''}
      <dt>class</dt><dd>${esc(r.cls)}${r.playable ? '' : ' · not deck-legal'}</dd>
      ${r.scripted ? '' : '<dt>engine</dt><dd>not scripted — the client cannot play this card</dd>'}
      ${r.provisional ? '<dt>source</dt><dd>transcribed from pre-release art, provisional</dd>' : ''}
      ${r.creates.length ? `<dt>creates</dt><dd>${r.creates.map(c => esc(c)).join(', ')}</dd>` : ''}
      ${r.transforms ? `<dt>transforms into</dt><dd>${esc(r.transforms)}</dd>` : ''}
    </dl>
    <div class="cbdetailbtns">
      <button data-btn="cards-similar" data-card="${esc(r.name)}">find similar</button>
      <button data-btn="cards-rulings" data-card="${esc(r.name)}">rulings</button>
      ${bridge && r.playable ? `<button class="primary" data-btn="cards-add" data-card="${esc(r.name)}">add to ${esc(bridge.name())}</button>` : ''}
    </div>
    ${rulings && rulings.name === r.name
    ? `<div class="cbrulings">${rulings.lines.length
      ? rulings.lines.map(l => `<p>${esc(l)}</p>`).join('')
      : '<p class="hint">no recorded rulings for this card.</p>'}</div>`
    : ''}
  </section>`;
}

/* ── the help sheet, printed from the parser's own tables ──────────────── */

function helpHtml(): string {
  if (!helpOpen) return '';
  return `<section class="cbhelp">
    <button class="cbclose" data-btn="cards-help" title="close">×</button>
    <h2>Search syntax</h2>
    <p>Words with no prefix search the name, the type line and the rules text.
      Put terms next to each other to mean AND, use <code>OR</code> for either,
      brackets to group, and a leading <code>-</code> to exclude — a term or a
      whole group.</p>
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
function deckSideHtml(): string {
  if (!bridge) return '';
  const s = bridge.summary();
  const peak = Math.max(1, ...s.curve.map(c => c.total));
  const spread = Object.entries(s.elements).filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  return `<div class="cbdeckbar">
    <span class="cbdeckname">Building <b>${esc(bridge.name())}</b></span>
    <span class="cbdeckcount">${s.total} card${s.total === 1 ? '' : 's'}</span>
    ${s.legal
    ? '<span class="ok">legal</span>'
    : `<span class="warn">${esc(s.problems[0] ?? 'not legal yet')}</span>`}
    <span class="cbminicurve" title="the mana curve, lowest first">${s.curve.map(c =>
    `<span class="cbcbar" title="${c.mana} mana: ${c.total}"><i style="height:${
      Math.round((c.total / peak) * 100)}%"></i><em>${c.mana}</em></span>`).join('')}</span>
    <span class="cbdeckels">${spread.map(([el, n]) =>
    `<span class="cbdeckel" title="${esc(el)}">${elIcon(el)}${Math.round(n * 10) / 10}</span>`).join('')}</span>
    <span class="cbspacer"></span>
    <button data-btn="cards-toDeck">back to the deck</button>
  </div>`;
}

function barHtml(res: SearchResult): string {
  const hints = suggest(q);
  const saved = savedSearches();
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

function paint(): void {
  if (!$app) return;
  $app.classList.remove('board');
  const res = run();
  $app.innerHTML = `<div class="cbpage">
    <div class="accthead">
      <div>
        <h1>Cards</h1>
        <div class="hint">The ${allRows().filter(r => r.cls === 'card').length} cards.
          Tokens, resources and the box\u2019s reference cards are here too, and sit out of the way
          until you ask for them &mdash; <button class="cblink" data-btn="cards-try" data-q="class:all">class:all</button>.</div>
      </div>
      <div class="accthbtns">
        <button class="primary" data-btn="cards-close">${bridge ? 'Back to the deck' : 'Back to games'}</button>
      </div>
    </div>
    ${deckSideHtml()}
    ${barHtml(res)}
    ${helpHtml()}
    <div class="cbmain">
      ${railHtml()}
      <section class="cbresults">${resultsHtml(res)}</section>
      ${detailHtml()}
    </div>
  </div>`;
  wire();
}

/** the live query box — it must not repaint the page under the cursor */
function wire(): void {
  // the sort menu answers to CHANGE, not to click. A click on a <select> is the
  // click that OPENS it, so a click handler reads the value you are replacing.
  const sort = document.getElementById('cb-sort') as HTMLSelectElement | null;
  sort?.addEventListener('change', () => {
    q = withDisplay(q, 'sort', sort.value || 'name');
    save(QUERY_KEY, q);
    syncUrl();
    paint();
  });

  // keep the keyboard cursor on screen. Full-repaint rendering means the
  // browser's own scroll-into-view never fires, so it is done by hand.
  document.querySelector('.cbtile.sel, .cbrow.sel')?.scrollIntoView({ block: 'nearest' });

  const box = document.getElementById('cb-q') as HTMLInputElement | null;
  if (!box) return;
  box.addEventListener('input', () => {
    q = box.value;
    save(QUERY_KEY, q);
    shown = CHUNK;
    cursor = -1;
    syncUrl();
    scheduleRepaint();
  });
  if (wantFocus) {
    wantFocus = false;
    box.focus();
    box.selectionStart = box.selectionEnd = box.value.length;
  }
}

/**
 * Repaint after a keystroke, on a short debounce.
 *
 * THE WHOLE PAGE, not just the results. The first version repainted only
 * `.cbresults` and `.cbrail` so the `<input>` would survive under the caret,
 * and everything else in the bar silently stopped following what you typed:
 * the clear button never appeared, the syntax error never showed, and the
 * "did you mean `attr:deadly`" hint — the entire point of ui/cardsynonyms.ts —
 * only ever rendered if you happened to click something afterwards. Live
 * feedback that is not live is worse than none, because you stop looking.
 *
 * `repaintKeepingCaret` puts the caret back, so the input surviving is no
 * longer a reason to leave half the page stale. The debounce is what keeps
 * that affordable: one paint per pause, not one per keystroke.
 */
const REPAINT_MS = 90;
let repaintTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRepaint(): void {
  if (repaintTimer) clearTimeout(repaintTimer);
  repaintTimer = setTimeout(() => {
    repaintTimer = null;
    repaintKeepingCaret();
  }, REPAINT_MS);
}

/**
 * Repaint without throwing the user out of the query box.
 *
 * The page repaints by replacing `#app.innerHTML`, which destroys the input —
 * so anything that repaints while you are typing (a keystroke, an arrow key)
 * would silently drop focus, and the next letter would go nowhere. Nothing
 * looks broken; the box just stops accepting letters.
 */
function repaintKeepingCaret(): void {
  const before = document.getElementById('cb-q') as HTMLInputElement | null;
  const had = document.activeElement === before;
  const at = before ? [before.selectionStart, before.selectionEnd] as const : null;
  paint();
  if (!had) return;
  const after = document.getElementById('cb-q') as HTMLInputElement | null;
  if (!after) return;
  after.focus();
  if (at) [after.selectionStart, after.selectionEnd] = [at[0], at[1]];
}

/** The query in the address bar, so a search is a link. Replaces rather than
 * pushes: one back-button step per search would bury the rest of the app. */
function syncUrl(): void {
  try {
    const url = new URL(location.href);
    url.searchParams.set('cards', '1');
    if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
    history.replaceState(null, '', url.toString());
  } catch { /* file:// and the like */ }
}

function clearUrl(): void {
  try {
    const url = new URL(location.href);
    url.searchParams.delete('cards');
    url.searchParams.delete('q');
    history.replaceState(null, '', url.toString());
  } catch { /* ignore */ }
}

export function renderScreen(): void {
  paint();
}

/* ── clicks ────────────────────────────────────────────────────────────── */

/** Ask the game server (which proxies the rules bot) what has been ruled about
 * a card. The bot is often not running; that is a missing section, not an
 * error the page should shout about. */
function fetchRulings(name: string): void {
  rulings = { name, lines: ['loading…'] };
  paint();
  fetch(`/api/cardinfo?name=${encodeURIComponent(name)}`)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((info: { rulings?: unknown[] }) => {
      rulings = {
        name,
        lines: (info.rulings ?? []).map(x => (typeof x === 'string' ? x : JSON.stringify(x))),
      };
      paint();
    })
    .catch(() => {
      rulings = { name, lines: [] };
      paint();
    });
}

/** main.ts offers every button here. Returns true when it was ours. */
export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('cards-')) return false;
  const card = btn.dataset['card'] ?? '';

  switch (b) {
    case 'cards-openpage':
      openBrowser();
      return true;

    case 'cards-close':
      open = false;
      helpOpen = false;
      focus = null;
      clearUrl();
      if (bridge) bridge.back(); else rerenderHost();
      return true;

    case 'cards-toDeck':
      open = false;
      focus = null;
      clearUrl();
      bridge?.back();
      return true;

    case 'cards-chip': {
      const key = btn.dataset['key'] ?? '';
      const value = btn.dataset['value'] ?? '';
      q = withChip(q, key, value, nextChipState(chipState(q, key, value)));
      shown = CHUNK;
      save(QUERY_KEY, q);
      syncUrl();
      paint();
      return true;
    }

    case 'cards-section': {
      const s = btn.dataset['section'] ?? '';
      railOpen[s] = !railOpen[s];
      paint();
      return true;
    }

    case 'cards-try':
      q = btn.dataset['q'] ?? '';
      helpOpen = false;
      shown = CHUNK;
      save(QUERY_KEY, q);
      syncUrl();
      paint();
      return true;

    case 'cards-similar': {
      const r = allRows().find(x => x.name === card);
      if (r) {
        // "more like this": same element identity and the same kind, minus the
        // card itself. Deliberately a QUERY rather than a similarity score —
        // you can see why it matched, and edit it.
        const els = r.factions.length ? `el=${r.factions.join(',')} ` : 'el:none ';
        q = `${els}kind:${r.kind.toLowerCase()} -name="${r.name}"`;
        shown = CHUNK;
        focus = null;
        save(QUERY_KEY, q);
        syncUrl();
        paint();
      }
      return true;
    }

    case 'cards-focus':
      focus = card;
      rulings = null;
      paint();
      return true;

    case 'cards-unfocus':
      focus = null;
      paint();
      return true;

    case 'cards-rulings':
      fetchRulings(card);
      return true;

    case 'cards-help':
      helpOpen = !helpOpen;
      paint();
      return true;

    case 'cards-clear':
      q = '';
      shown = CHUNK;
      wantFocus = true;
      save(QUERY_KEY, q);
      syncUrl();
      paint();
      return true;

    case 'cards-more':
      shown += CHUNK;
      paint();
      return true;

    case 'cards-view':
      q = withDisplay(q, 'view', btn.dataset['view'] ?? 'grid');
      save(QUERY_KEY, q);
      syncUrl();
      paint();
      return true;

    case 'cards-dir':
      q = withDisplay(q, 'dir', run().query.dir === 'asc' ? 'desc' : 'asc');
      save(QUERY_KEY, q);
      syncUrl();
      paint();
      return true;

    case 'cards-save': {
      const name = q.length > 24 ? `${q.slice(0, 24)}…` : q;
      const list = savedSearches().filter(s => s.q !== q);
      save(SAVED_KEY, [{ name, q }, ...list].slice(0, 8));
      paint();
      return true;
    }

    case 'cards-forget':
      save(SAVED_KEY, []);
      paint();
      return true;

    case 'cards-add':
      bridge?.add(card);
      paint();
      return true;

    case 'cards-less':
      bridge?.remove(card);
      paint();
      return true;

    case 'cards-maybe':
      bridge?.toMaybe(card);
      paint();
      return true;

    default:
      return false;
  }
}

/**
 * The keys.
 *
 * `/` focuses the box, Escape backs out of whatever is on top, and the arrows
 * walk the results so you can scan without the mouse. Enter opens the detail
 * pane; `+` and `-` add and cut in deckbuilding mode. main.ts owns the keydown
 * listener and offers it here first — before its own `if (!inGame) return`,
 * since this is a pre-game page.
 */
export function handleKey(e: KeyboardEvent): boolean {
  if (!open) return false;
  const el = e.target as HTMLElement | null;
  const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA';

  if (e.key === 'Escape') {
    if (helpOpen) { helpOpen = false; paint(); return true; }
    if (focus) { focus = null; paint(); return true; }
    if (typing) { (el as HTMLInputElement).blur(); return true; }
    return false;
  }
  if (e.key === '/' && !typing) {
    wantFocus = true;
    (document.getElementById('cb-q') as HTMLInputElement | null)?.focus();
    return true;
  }
  // the arrows belong to the caret while you are typing in the box
  if (typing && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;

  const rows = run().rows.slice(0, shown);
  if (!rows.length) return false;
  const step = (by: number): boolean => {
    cursor = Math.max(0, Math.min(rows.length - 1, cursor + by));
    e.preventDefault();
    repaintKeepingCaret();
    return true;
  };
  switch (e.key) {
    case 'ArrowDown': return step(cursor < 0 ? 0 : 1);
    case 'ArrowUp': return cursor <= 0 ? false : step(-1);
    case 'ArrowRight': return typing ? false : step(cursor < 0 ? 0 : 1);
    case 'ArrowLeft': return typing || cursor <= 0 ? false : step(-1);
    case 'Enter': {
      if (cursor < 0) return false;
      focus = rows[cursor]!.name;
      rulings = null;
      paint();
      return true;
    }
    case '+':
    case '=': {
      if (cursor < 0 || !bridge) return false;
      bridge.add(rows[cursor]!.name);
      paint();
      return true;
    }
    case '-': {
      if (cursor < 0 || !bridge) return false;
      bridge.remove(rows[cursor]!.name);
      paint();
      return true;
    }
    default: return false;
  }
}
