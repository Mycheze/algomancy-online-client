/* THE METAGAME: published decks, and one shared deck at the end of a link.
 *
 * Same contract as ui/decks.ts, ui/cards.ts and ui/account.ts, which main.ts
 * already knows how to drive: screen() says whether this page owns the app
 * element, renderScreen() paints it, handleButton() is offered every click
 * (everything here is prefixed `meta-`), and the state lives in this file.
 *
 * TWO SCREENS, ONE MODULE, because they are one subject: a row on the list IS
 * a link to the deck view, and the deck view is what a share link opens. The
 * only thing they do not share is who may be on them — the list is `public`
 * decks, the deck view also opens for `unlisted` ones. That distinction is
 * decided on the SERVER (server/publicdecks.ts) and this file never re-derives
 * it; it asks and paints the answer.
 *
 * NOTHING HERE IS AN AGGREGATE THAT INVENTS A LIST. BL-13's standing note is
 * that a "top decks" view which reconstructs a decklist out of card play-rates
 * prints a deck nobody registered. Every row on this page is a deck whose
 * owner pressed publish, and the only thing computed about it is the record,
 * which is folded from real games.
 *
 * THE URL IS THE PAGE, the way it is for the card browser: `?meta=1` for the
 * list, `?deck=<id>` for one deck, both written with replaceState (never push
 * — one back-button step per filter click would bury the rest of the app).
 */
import * as acct from './account.ts';
import { artHtml, cardPanelHtml, deckStripHtml } from './cardpanel.ts';
import { cardLinker, clipDescription, descSummary } from './cardlinks.ts';
import { mdToHtml } from './markdown.ts';
import { rowFor } from './cardindex.ts';
import { analyzeDeck, deckElements } from './deckstats.ts';
import { GROUPINGS, deckSections, needsCountBadge, stackLayers } from './decklayout.ts';
import type { DeckGrouping } from './decklayout.ts';
import { deckStatsHtml } from './decks.ts';
import { ALL_ELEMENTS } from '../src/apply.ts';
import { esc, elIcon } from './util.ts';

/** the shape server/publicdecks.ts sends */
export interface PublicDeck {
  id: string;
  name: string;
  cards: string[];
  cover: string | null;
  author: string;
  url?: string;
  description?: string;
  visibility: 'private' | 'unlisted' | 'public';
  owner: { id: string; username: string };
  createdAt: string;
  updatedAt: string;
  problems: string[];
  record: { games: number; wins: number; losses: number; unresolved: number; lastPlayed: string | null };
  copies: number;
  copiedFrom?: { id: string; name: string; owner: string };
}

type Sort = 'winrate' | 'games' | 'new' | 'name';

// ── module state ──────────────────────────────────────────────────────

let $app: HTMLElement | null = null;
let rerenderHost: () => void = () => {};
/** which screen owns the page, or null for neither */
let view: 'list' | 'deck' | null = null;
let rows: PublicDeck[] | null = null;
let minGames = 5;
let one: PublicDeck | null = null;
let wantId: string | null = null;
let loading = false;
let msg = '';
let sort: Sort = 'winrate';
/** element filter — chips, not a query language: this page is for browsing */
const els = new Set<string>();
let text = '';
let focus: string | null = null;
/** how the shared deck's grid is split. Same vocabulary and same bucketing as
 * the builder (ui/decklayout.ts) — one deck must not look like two decks
 * depending on whose page it is on. */
let deckGroup: DeckGrouping = 'type';
/** the stats panel, folded away by default: this is a page you arrive at to
 * LOOK at a deck, and a wall of tables above the cards would bury the thing
 * you came for */
let statsOpen = false;
let descOpen = false;

export const screen = (): 'meta' | null => (view ? 'meta' : null);

/**
 * Wire the page up, and take the URL seriously.
 *
 * A share link has to work on a COLD LOAD — that is the entire point of it —
 * so `?deck=` is read here and the fetch starts before anybody clicks
 * anything. `?meta=1` is the same idea for the list.
 */
export function initMeta(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  const url = new URLSearchParams(location.search);
  const id = url.get('deck');
  if (id) { view = 'deck'; wantId = id; loadOne(id); }
  else if (url.has('meta')) { view = 'list'; loadList(); }
}

function syncUrl(): void {
  try {
    const url = new URL(location.href);
    url.searchParams.delete('meta');
    url.searchParams.delete('deck');
    if (view === 'list') url.searchParams.set('meta', '1');
    else if (view === 'deck' && one) url.searchParams.set('deck', one.id);
    else if (view === 'deck' && wantId) url.searchParams.set('deck', wantId);
    history.replaceState(null, '', url.toString());
  } catch { /* file:// and the like */ }
}

const authHeaders = (): Record<string, string> => {
  const t = acct.token();
  return { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) };
};

function loadList(): void {
  loading = true;
  fetch(`/api/deck/meta?sort=${encodeURIComponent(sort)}`)
    .then(r => r.json() as Promise<{ ok: boolean; decks?: PublicDeck[]; minGames?: number; error?: string }>)
    .then(r => {
      loading = false;
      if (r.ok && r.decks) { rows = r.decks; minGames = r.minGames ?? minGames; }
      else msg = r.error ?? 'could not load the metagame list';
      paint();
    })
    .catch(() => { loading = false; msg = 'could not reach the server'; paint(); });
}

function loadOne(id: string): void {
  loading = true;
  fetch(`/api/deck/shared?id=${encodeURIComponent(id)}`)
    .then(r => r.json() as Promise<{ ok: boolean; deck?: PublicDeck; error?: string }>)
    .then(r => {
      loading = false;
      if (r.ok && r.deck) { one = r.deck; msg = ''; }
      else { one = null; msg = 'That deck is not shared, or the link is wrong.'; }
      paint();
    })
    .catch(() => { loading = false; msg = 'could not reach the server'; paint(); });
}

// ── opening it ────────────────────────────────────────────────────────

export function openMeta(): void {
  view = 'list'; one = null; focus = null; msg = '';
  syncUrl();
  if (!rows) loadList(); else paint();
}

export function openDeck(id: string): void {
  view = 'deck'; wantId = id; one = null; focus = null; descOpen = false; msg = '';
  syncUrl();
  loadOne(id);
}

function close(): void {
  view = null; one = null; focus = null;
  try {
    const url = new URL(location.href);
    url.searchParams.delete('meta');
    url.searchParams.delete('deck');
    history.replaceState(null, '', url.toString());
  } catch { /* ignore */ }
  rerenderHost();
}

// ── little pieces ─────────────────────────────────────────────────────

const ART = '../../../AlgomancyCards/';
const artFor = (name: string): string => {
  const r = rowFor(name);
  return r ? ART + (r.image || r.name.replace(/ /g, '-') + '.jpg') : '';
};

/**
 * A deck's record as a line, and the one thing it must never do: dress up a
 * sample it has not got. Under the floor it prints the count and NO rate.
 */
function recordLine(d: PublicDeck): string {
  const { games, wins, losses } = d.record;
  if (!games) return '<span class="dim">no games yet</span>';
  const decided = wins + losses;
  const ranked = games >= minGames && decided > 0;
  return `${ranked
    ? `<b class="${wins >= losses ? 'good' : 'bad'}">${Math.round((wins / decided) * 100)}%</b> `
    : ''}<span class="dim">${wins}W–${losses}L in ${games} game${games === 1 ? '' : 's'}${
    d.copies > 1 ? ` · ${d.copies} copies` : ''}</span>`;
}

const isRanked = (d: PublicDeck): boolean => d.record.games >= minGames && d.record.wins + d.record.losses > 0;

/** the deck's elements, from the same arithmetic the deck page uses */
function elLine(d: PublicDeck): string {
  return deckElements(analyzeDeck(d.cards))
    .map(e => `<span class="acctel ${e.el}" title="${Math.round(e.share * 100)}% of the deck">${e.el}</span>`)
    .join('');
}

/** the filters, applied in the browser: the server ranks, this narrows */
function shown(): PublicDeck[] {
  const q = text.trim().toLowerCase();
  return (rows ?? []).filter(d => {
    if (q && !d.name.toLowerCase().includes(q)
      && !d.owner.username.toLowerCase().includes(q)
      && !d.cards.some(c => c.toLowerCase().includes(q))) return false;
    if (els.size) {
      const have = new Set(deckElements(analyzeDeck(d.cards)).map(e => e.el));
      for (const el of els) if (!have.has(el)) return false;
    }
    return true;
  });
}

// ── the list ──────────────────────────────────────────────────────────

function rowHtml(d: PublicDeck): string {
  // the row is one line high, so the snippet is PROSE, not markdown — see descSummary
  const snippet = d.description ? descSummary(d.description) : '';
  return `<button class="metarow" data-btn="meta-open" data-id="${esc(d.id)}">
    <span class="metacover">${d.cover
      ? `<img src="${esc(artFor(d.cover))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
      : ''}</span>
    <span class="metabody">
      <span class="metaname">${esc(d.name)}</span>
      <span class="metaby">by ${esc(d.owner.username)}${
        d.copiedFrom ? ` <span class="dim">· after ${esc(d.copiedFrom.owner)}’s ${esc(d.copiedFrom.name)}</span>` : ''}</span>
      ${snippet ? `<span class="metadesc">${esc(snippet)}</span>` : ''}
      <span class="metaels">${elLine(d)}</span>
    </span>
    <span class="metarec">${recordLine(d)}</span>
  </button>`;
}

function listHtml(): string {
  const all = shown();
  const ranked = all.filter(isRanked);
  const rest = all.filter(d => !isRanked(d));
  const SORTS: [Sort, string][] = [
    ['winrate', 'winrate'], ['games', 'most played'], ['new', 'newest'], ['name', 'name'],
  ];
  return `<div class="metapage">
    <div class="accthead">
      <div><h1>Metagame</h1>
        <p class="hint">Decks their builders chose to publish, with the record of each list and
          every copy of it. Nothing here is inferred — a deck is on this page because somebody
          put it here.</p></div>
      <button data-btn="meta-close">Back</button>
    </div>
    ${msg ? `<div class="acctmsg">${esc(msg)}</div>` : ''}
    <div class="cbtools">
      <span class="zonelabel">sort</span>
      ${SORTS.map(([s, label]) =>
        `<button class="${sort === s ? 'on' : ''}" data-btn="meta-sort" data-sort="${s}">${label}</button>`).join('')}
      <span class="cbspacer"></span>
      <input id="meta-q" class="dksearch" spellcheck="false" placeholder="name, builder, or a card in it"
        value="${esc(text)}">
    </div>
    <div class="dkfilters">
      ${ALL_ELEMENTS.map(el =>
        `<button class="elchip ${el}${els.has(el) ? ' on' : ''}" data-btn="meta-el" data-el="${el}">${elIcon(el)}${el}</button>`).join('')}
      ${els.size || text ? '<button data-btn="meta-clear">clear</button>' : ''}
    </div>
    ${loading && !rows ? '<p class="hint">loading…</p>' : ''}
    ${rows && !all.length
      ? `<p class="hint">${rows.length
        ? 'Nothing matches those filters.'
        : 'No published decks yet. Open one of your own decks, then its <b>share</b> tab.'}</p>`
      : ''}
    <div class="metalist">${ranked.map(rowHtml).join('')}</div>
    ${rest.length ? `<div class="metadivider">Not enough games yet
        <span class="hint">— a deck is ranked once it has ${minGames} constructed games. Only games
        played signed in, with the deck picked from a collection, are counted, so this is where a
        new list lives until it has been played.</span></div>
      <div class="metalist">${rest.map(rowHtml).join('')}</div>` : ''}
  </div>`;
}

// ── one shared deck ───────────────────────────────────────────────────

/**
 * One card on a shared deck's grid.
 *
 * COPIES ARE DRAWN, NOT COUNTED — two copies is two cards, stacked
 * (ui/decklayout.ts). The number comes back only over the legal cap, where
 * "there are too many of these" is exactly what must not be left to the eye.
 */
function deckTile(name: string, n: number): string {
  const r = rowFor(name);
  const layers = stackLayers(n);
  // ⚠ THE OFFSET GOES ON A WRAPPER, NOT ON THE ART. `artHtml` returns an <img>
  // for a card with art and a <div class="cbnoart"> for one without, so
  // patching a style attribute into "<img " would silently do nothing on every
  // artless card — every ghost would sit at offset zero and the stack would
  // vanish exactly where it is least obvious. The wrapper is the positioned
  // box and takes whatever artHtml gives it.
  const art = (cls: string): string => (r ? artHtml(r, cls) : `<div class="${cls} cbnoart">${esc(name)}</div>`);
  // `--d` is the stack DEPTH, and the CSS derives the whole pile geometry from
  // it (see the .dkstack block in ui/style.css) rather than casing on a count.
  return `<div class="dktile${layers.length ? ' dkstack' : ''}"
      ${layers.length ? `style="--d:${layers.length}"` : ''}
      data-prev="${esc(name)}" data-btn="meta-focus" data-card="${esc(name)}"
      ${n > 1 ? `aria-label="${esc(name)} ×${n}"` : ''}>
    ${layers.map(i => `<span class="dkghostwrap" style="--i:${i}" aria-hidden="true">${
    art('dkart')}</span>`).join('')}
    ${art('dkart')}
    ${needsCountBadge(n) ? `<span class="dkn bad">×${n}</span>` : ''}
  </div>`;
}

/**
 * The shared deck, laid out.
 *
 * The owner: *"When viewing other people's decks, it's hard to really
 * visualize things since it's just a flat list."* It was literally that — one
 * `.dkgrid` over `a.copies` in whatever order the list happened to be stored
 * in, with no split, no sort and no stats, while the BUILDER had all three.
 * Both surfaces now go through ui/decklayout.ts.
 */
function deckGrid(d: PublicDeck): string {
  const a = analyzeDeck(d.cards);
  const sections = deckSections(a, deckGroup);
  return `<div class="dktoolbar">
      <span class="zonelabel">group by</span>
      ${GROUPINGS.map(g => `<button class="dkkind${deckGroup === g.id ? ' on' : ''}"
        data-btn="meta-group" data-group="${g.id}" title="${esc(g.hint)}">${esc(g.label)}</button>`).join('')}
      <span class="dkfilterspacer"></span>
      <button class="dkkind${statsOpen ? ' on' : ''}" data-btn="meta-stats"
        title="curve, elements, and the affinity this deck needs open">${
  statsOpen ? 'Hide stats' : 'Stats'}</button>
    </div>
    ${statsOpen ? `<div class="acctbody deckbody metastats">${deckStatsHtml(a)}</div>` : ''}
    ${sections.map(sec => `<div class="dkgroup">
      <div class="dkgrouphead">${esc(sec.label)} <span class="dim">${sec.cards} card${
  sec.cards === 1 ? '' : 's'}</span></div>
      <div class="dkgrid">${sec.entries.map(e => deckTile(e.name, e.n)).join('')}</div>
    </div>`).join('')}`;
}

function deckHtml(): string {
  if (!one) {
    return `<div class="metadeck">
      <div class="accthead"><div><h1>Deck</h1></div>
        <button data-btn="meta-close">Back</button></div>
      <p class="hint">${esc(msg || (loading ? 'loading…' : 'That deck is not shared.'))}</p>
      <button data-btn="meta-list">See the metagame list</button>
    </div>`;
  }
  const d = one;
  const a = analyzeDeck(d.cards);
  const mine = acct.currentUser()?.id === d.owner.id;
  const desc = d.description ?? '';
  const { text: shownDesc, clipped } = descOpen ? { text: desc, clipped: false } : clipDescription(desc, 400);
  const link = `${location.origin}${location.pathname}?deck=${encodeURIComponent(d.id)}`;
  return `<div class="metadeck">
    <div class="accthead">
      <div><h1>${esc(d.name)}</h1>
        <p class="hint">by ${esc(d.owner.username)}${
          d.copiedFrom ? ` · after ${esc(d.copiedFrom.owner)}’s ${esc(d.copiedFrom.name)}` : ''}${
          d.visibility === 'unlisted' ? ' · unlisted — only people with the link see this' : ''}</p></div>
      <button data-btn="meta-list">Metagame</button>
      <button data-btn="meta-close">Back</button>
    </div>
    ${msg ? `<div class="acctmsg">${esc(msg)}</div>` : ''}
    ${deckStripHtml(d.name, a, { lead: 'Deck' })}
    <div class="deckrecline">${recordLine(d)}</div>
    ${desc.trim() ? `<div class="deckdesc">
      <div class="deckdescbody">${mdToHtml(shownDesc, { inline: cardLinker({ focusBtn: 'meta-focus' }) })}</div>
      ${clipped || descOpen
        ? `<button class="cblink" data-btn="meta-desc-toggle">${descOpen ? 'show less' : 'read more'}</button>`
        : ''}</div>` : ''}
    <div class="dkaddrow">
      ${acct.token() && !mine
        ? '<button class="primary" data-btn="meta-take">Copy this deck to my collection</button>'
        : ''}
      ${mine ? '<span class="hint">This one is yours — edit it on your decks page.</span>' : ''}
    </div>
    <div class="sharebar">Send somebody this link:
      <input class="sharelink" readonly value="${esc(link)}" onclick="this.select()">
      <button data-btn="copylink" data-link="${esc(link)}">copy</button></div>
    <div class="dkwork">
      <div class="dkworkmain">${deckGrid(d)}</div>
      ${focus ? cardPanelHtml(focus, { close: 'meta-unfocus' }) : ''}
    </div>
  </div>`;
}

function paint(): void {
  if (!$app || !view) return;
  $app.classList.remove('board');
  $app.innerHTML = view === 'list' ? listHtml() : deckHtml();
  const box = document.getElementById('meta-q') as HTMLInputElement | null;
  if (box) {
    box.oninput = () => { text = box.value; repaintKeepingCaret(); };
  }
}

/** Typing in the filter box must not yank the caret out of it, which a full
 * repaint does — the same problem ui/cards.ts documents at repaintKeepingCaret. */
function repaintKeepingCaret(): void {
  const before = document.getElementById('meta-q') as HTMLInputElement | null;
  const at = before?.selectionStart ?? null;
  paint();
  const after = document.getElementById('meta-q') as HTMLInputElement | null;
  if (!after) return;
  after.focus();
  if (at !== null) after.setSelectionRange(at, at);
}

export function renderScreen(): void { paint(); }

// ── clicks ────────────────────────────────────────────────────────────

export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('meta-')) return false;
  const card = btn.dataset['card'] ?? '';

  switch (b) {
    case 'meta-openpage':
      openMeta();
      return true;
    case 'meta-close':
      close();
      return true;
    case 'meta-list':
      openMeta();
      return true;
    case 'meta-group':
      deckGroup = (btn.dataset['group'] ?? 'type') as DeckGrouping;
      paint();
      return true;

    case 'meta-stats':
      statsOpen = !statsOpen;
      paint();
      return true;

    case 'meta-open':
      openDeck(btn.dataset['id'] ?? '');
      return true;
    case 'meta-sort':
      sort = (btn.dataset['sort'] ?? 'winrate') as Sort;
      // the ranking is the server's — asking again is what keeps this page
      // from growing a second opinion about what "best" means
      loadList();
      paint();
      return true;
    case 'meta-el': {
      const el = btn.dataset['el'] ?? '';
      if (els.has(el)) els.delete(el); else els.add(el);
      paint();
      return true;
    }
    case 'meta-clear':
      els.clear(); text = '';
      paint();
      return true;
    case 'meta-focus':
      focus = focus === card ? null : card;
      paint();
      return true;
    case 'meta-unfocus':
      focus = null;
      paint();
      return true;
    case 'meta-desc-toggle':
      descOpen = !descOpen;
      paint();
      return true;
    case 'meta-take': {
      if (!one) return true;
      const id = one.id;
      msg = 'copying…';
      paint();
      void fetch('/api/decks/take', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ id }),
      })
        .then(r => r.json() as Promise<{ ok: boolean; error?: string; note?: string }>)
        .then(r => {
          msg = r.ok
            ? `Copied into your collection${r.note ? ` — ${r.note}` : ''}. It starts private.`
            : (r.error ?? 'could not copy that deck');
          paint();
        })
        .catch(() => { msg = 'could not reach the server'; paint(); });
      return true;
    }
  }
  return false;
}
