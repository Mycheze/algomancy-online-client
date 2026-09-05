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
import { iconizeText } from './cardtext.ts';
import { ALL_ELEMENTS } from '../engine/src/apply.ts';
import { artHtml, cardPanelHtml, costHtml, deckStripHtml, similarQuery } from './cardpanel.ts';
import type { CardRow, Release } from './cardindex.ts';
import { allRows, facetValues, RELEASE_LABEL, rowFor } from './cardindex.ts';
import {
  FLAGS, KEYS, SORTS, VIEWS, chipState, nextChipState, search,
  withChip, withDisplay, type SearchResult,
} from './cardsearch.ts';
import { suggest } from './cardsynonyms.ts';
import { esc, elIcon } from './util.ts';

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
/**
 * How many PUBLISHED decks play each card, or null until it has been asked
 * for. Fetched once per page open rather than per card: it is one small object
 * for the whole pool, and a request per pinned card would be a request per
 * click. Null means "not asked yet", `{}` means "asked, nobody has published
 * anything" — the difference decides whether the line is printed at all.
 */
let playedIn: Record<string, number> | null = null;
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
/** Ask once, when the page opens. A failure is silence, not an error: the
 * count is a nicety and the browser works without the server. */
function fetchPlayed(): void {
  if (playedIn) return;
  void fetch('/api/deck/played')
    .then(r => r.json() as Promise<{ ok: boolean; counts?: Record<string, number> }>)
    .then(r => { playedIn = r.ok && r.counts ? r.counts : {}; paint(); })
    .catch(() => { playedIn = {}; });
}

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
  fetchPlayed();
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
  if (bridge) {
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

/** This page's pinned card: the shared panel (ui/cardpanel.ts) plus the two
 * buttons that only mean something here, and the add button deckbuilding mode
 * puts on it. */
function detailHtml(): string {
  if (!focus) return '';
  const r = rowFor(focus);
  if (!r) return '';
  const played = playedIn?.[r.name] ?? 0;
  return cardPanelHtml(focus, {
    close: 'cards-unfocus',
    rulings,
    // Published decks only, and the link goes to the LIST rather than to a
    // filtered view of it: BL-13's note is that nothing may reconstruct a deck
    // out of an aggregate, and a count is the aggregate — the decks behind it
    // are on the metagame page, where each one is a list somebody published.
    extra: played
      ? `<div class="cbfact">Played in ${played} published deck${played === 1 ? '' : 's'} —
          <button class="cblink" data-btn="meta-openpage">see the metagame list</button></div>`
      : '',
    actions: `<button data-btn="cards-similar" data-card="${esc(r.name)}">find similar</button>
      <button data-btn="cards-rulings" data-card="${esc(r.name)}">rulings</button>
      ${bridge && r.playable ? `<button class="primary" data-btn="cards-add" data-card="${esc(r.name)}">add to ${esc(bridge.name())}</button>` : ''}`,
  });
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
  return deckStripHtml(bridge.name(), bridge.summary(),
    { trailing: '<button data-btn="cards-toDeck">back to the deck</button>' });
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
        <button class="primary" data-btn="cards-close">${bridge ? 'Back to the deck' : 'Return to Lobby'}</button>
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
      const sim = similarQuery(card);
      if (sim) {
        q = sim;
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
