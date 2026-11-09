/* THE DECKS PAGE (BL-65, 2026-11-04): a shelf of deck boxes with the chosen deck open beside it, in the app
 * frame. Tap a box and its preview opens (Q2); Edit on the table goes to the builder. Every action the old
 * deck page's tabs and four modals held is a button on the preview, and each opens a side sheet.
 *
 * ui/decks.ts keeps the collection, the save queue, the clicks and the builder's host; this file is the page
 * contract (pages/README.md): decksView() gathers decks.ts's snapshot into a plain object, decksHtml(view)
 * draws it and touches nothing else, paintDecks() puts it on the page.
 *
 * Two pieces are exported for other surfaces:
 *  - deckPreviewHtml(view, { readOnly, actionsHtml }): the preview panel. The shared deck (`?deck=`, W3)
 *    draws it read-only, with its own buttons in place of Edit and the icon row. deckPreviewView() builds its
 *    view from any deck-shaped record.
 *  - deckInfoHtml(view): the builder's Deck info sheet (the deck's host draws it, ui/decks.ts sheetHtml).
 *
 * No page scroll at desktop or tablet: the shelf scrolls inside itself if it has to (`deck-shelf`), and so does
 * the preview's card list (`deck-list|<id>`).
 */
import { getCard } from '../../engine/src/cards/dsl.ts';
import { checkMatchDeck, SIDEBOARD_MAX } from '../../engine/src/matchdeck.ts';
import { artUrl } from '../assets.ts';
import { cardPanelHtml } from '../cardpanel.ts';
import { cardLinker, clipDescription } from '../cardlinks.ts';
import { analyzeDeck, deckElements } from '../deckstats.ts';
import { mdToHtml } from '../markdown.ts';
import { noImgDrag } from '../piletable.ts';
import { esc } from '../util.ts';
import { authorName } from '../deckformat.ts';
import { button, chip, emptyState, field, iconButton, segmented, sheet, statusMessage, table } from '../components/index.ts';
import type { TablePill } from '../tabletop.ts';
import { frameChromeView, frameHtml, paintFrame, type FrameChrome } from './frame.ts';

/* ── the shapes ───────────────────────────────────────────────────────── */

/** a constructed deck's least size (engine/src/apply.ts checkDeck) */
export const DECK_MIN = 30;
/** how many decks an account may keep (server/collection.ts MAX_DECKS) */
export const SHELF_MAX = 20;

export const DECK_SORTS = ['recent', 'name', 'played'] as const;
export type DeckSort = typeof DECK_SORTS[number];
const SORT_LABEL: Record<DeckSort, string> = { recent: 'Recent', name: 'Name', played: 'Most played' };

export type Visibility = 'private' | 'unlisted' | 'public';
const VIS_LABEL: Record<Visibility, string> = { private: 'Private', unlisted: 'Unlisted', public: 'Public' };

export interface DeckRecordLike { games: number; wins: number; losses: number; unresolved: number }

/** what a preview or a box is made from: a deck of yours, or someone else's shared one */
export interface DeckSource {
  id: string;
  name: string;
  cards: readonly string[];
  maybe?: readonly string[];
  sideboard?: readonly string[];
  cover: string | null;
  visibility?: Visibility;
  description?: string;
  updatedAt?: string;
  author?: string;
  url?: string;
  record?: DeckRecordLike;
}

export interface DeckBoxView {
  id: string;
  name: string;
  /** the cover's scan, or null */
  art: string | null;
  /** the deck's elements, the biggest share first */
  els: string[];
  /** "30", or "27 / 30" on a deck short of the minimum */
  count: string;
  /** amber: the deck is not legal */
  warn: boolean;
  /** what is wrong, when warn */
  problems: string;
  /** "4W–2L", else "6 maybe", else '' */
  meta: string;
  /** legal for a Competitive match (checkMatchDeck) */
  cc: boolean;
  on: boolean;
}

export interface DeckListRow { name: string; n: number; cost: string; over: boolean }

export interface DeckPreviewView {
  id: string;
  name: string;
  banner: string | null;
  /** "Public · edited 2 Nov · 4W–2L in 6 games" */
  meta: string;
  /** "built by Caleb", or '' for your own */
  author: string;
  url: string | null;
  /** the description, rendered (markdown + card links), clipped unless open; '' = none */
  descHtml: string;
  descClipped: boolean;
  descOpen: boolean;
  total: number;
  side: number;
  maybe: number;
  rows: DeckListRow[];
  legal: boolean;
  /** "Legal · Competitive ready", "Legal", or what is wrong */
  legalText: string;
  tone: 'ok' | 'warn' | 'bad';
  /** this is the deck you are bringing to constructed games */
  chosen: boolean;
  games: number;
  /** the card rows' and the description's card links' button */
  focusBtn: string;
  /** the description's more/less button */
  descBtn: string;
}

export interface DeckGameRow { result: 'win' | 'loss' | 'unknown'; opponent: string; turns: number; life: [number, number]; played: string; code: string }

export type DecksSheet =
  | { kind: 'import'; msg: string }
  | { kind: 'share'; vis: Visibility; link: string }
  | { kind: 'export'; format: 'text' | 'file'; body: string; downloadName: string }
  | { kind: 'delete'; name: string }
  | { kind: 'games'; record: DeckRecordLike; rows: DeckGameRow[] }
  | { kind: 'card'; name: string };

export interface DecksView {
  chrome: FrameChrome;
  signedIn: boolean;
  loading: boolean;
  /** decks saved; null = not loaded */
  count: number | null;
  sort: DeckSort;
  /** the shelf bar's note: a refusal, the import's or save's answer */
  note: string;
  boxes: DeckBoxView[];
  preview: DeckPreviewView | null;
  sheet: DecksSheet | null;
}

/** what ui/decks.ts hands the view (its snapshot) */
export interface DecksState {
  signedIn: boolean;
  loading: boolean;
  decks: readonly DeckSource[] | null;
  openId: string | null;
  sort: DeckSort;
  msg: string;
  descOpen: boolean;
  /** the id of the deck you are bringing */
  chosenId: string | null;
  sheet: DecksStateSheet | null;
  /** the account's recent games (account.ts history) */
  history: readonly { deckId: string | null; result: 'win' | 'loss' | 'unknown'; opponent: string; turns: number; life: [number, number]; playedAt: string; code: string }[];
  /** location.origin + pathname, for the share link */
  base: string;
  /** the export's body, built by decks.ts (deckformat.ts needs the origin) */
  exportBody: string;
}

export type DecksStateSheet =
  | { kind: 'import'; msg: string }
  | { kind: 'share' }
  | { kind: 'export'; format: 'text' | 'file' }
  | { kind: 'delete' }
  | { kind: 'games' }
  | { kind: 'card'; name: string };

/* ── gathering ────────────────────────────────────────────────────────── */

/** a card's scan: the registry's own image override, else derived from the name */
export function cardArt(name: string): string {
  try {
    const img = getCard(name).image;
    if (img) return artUrl(img);
  } catch { /* not a registry card */ }
  return artUrl(name.replace(/ /g, '-') + '.jpg');
}

const visOf = (d: DeckSource): Visibility => (d.visibility === 'public' || d.visibility === 'unlisted' ? d.visibility : 'private');

const shortDate = (iso: string | undefined | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const recordText = (r: DeckRecordLike | undefined): string =>
  r?.games ? `${r.wins}W–${r.losses}L in ${r.games} game${r.games === 1 ? '' : 's'}` : '';

/** the elements a deck plays, biggest first (deckstats.ts deckElements' floor) */
const elsOf = (cards: readonly string[]): string[] => deckElements(analyzeDeck(cards)).map(e => e.el);

/** what is wrong with a deck, one line each: the casual rules, unknown cards, then the Competitive check */
export function deckProblems(d: DeckSource): { legal: boolean; cc: boolean; casual: string[]; ccError: string | null } {
  const a = analyzeDeck(d.cards);
  const casual = [...a.problems, ...(a.unknown.length
    ? [`this build cannot play: ${a.unknown.slice(0, 3).join(', ')}${a.unknown.length > 3 ? ` (+${a.unknown.length - 3})` : ''}`]
    : [])];
  const c = checkMatchDeck(d.cards, d.sideboard ?? []);
  return { legal: a.legal, cc: c.ok, casual, ccError: c.ok ? null : c.error };
}

export function deckBoxView(d: DeckSource, on: boolean): DeckBoxView {
  const a = analyzeDeck(d.cards);
  const p = deckProblems(d);
  const cover = d.cover ?? d.cards[0] ?? null;
  const maybe = d.maybe?.length ?? 0;
  return {
    id: d.id, name: d.name, art: cover ? cardArt(cover) : null, els: elsOf(d.cards),
    count: a.total < DECK_MIN ? `${a.total} / ${DECK_MIN}` : String(a.total),
    warn: !p.legal, problems: p.casual.join(' · '),
    meta: d.record?.games ? `${d.record.wins}W–${d.record.losses}L` : maybe ? `${maybe} maybe` : '',
    cc: p.cc, on,
  };
}

/** the list by cost: one row per card, cheapest first, X last */
function listRows(cards: readonly string[]): DeckListRow[] {
  const a = analyzeDeck(cards);
  const key = (r: DeckListRow): number => (r.cost === 'X' ? 98 : r.cost === '?' ? 99 : Number(r.cost));
  return a.copies
    .map(c => ({ name: c.name, n: c.n, cost: c.facts ? (c.facts.isX ? 'X' : String(c.facts.mana)) : '?', over: c.n > 2 }))
    .sort((x, y) => key(x) - key(y) || x.name.localeCompare(y.name));
}

export interface PreviewViewOpts {
  descOpen?: boolean;
  chosen?: boolean;
  /** the card links' button (default deck-focus) */
  focusBtn?: string;
  /** the description's more/less (default deck-desc-toggle) */
  descBtn?: string;
  /** how much description shows before "more": characters, and source lines */
  budget?: number;
  lines?: number;
}

/** A deck's preview, from any deck-shaped record. */
export function deckPreviewView(d: DeckSource, o: PreviewViewOpts = {}): DeckPreviewView {
  const focusBtn = o.focusBtn ?? 'deck-focus';
  const p = deckProblems(d);
  const src = (d.description ?? '').trim();
  const { text, clipped } = o.descOpen ? { text: src, clipped: false } : clipDescription(src, o.budget ?? 160, o.lines ?? 3);
  const cover = d.cover ?? d.cards[0] ?? null;
  const edited = shortDate(d.updatedAt);
  const legalText = p.legal
    ? (p.cc ? 'Legal · Competitive ready' : `Legal · not Competitive: ${p.ccError ?? ''}`)
    : p.casual.join(' · ') || 'Not legal yet';
  return {
    id: d.id, name: d.name, banner: cover ? cardArt(cover) : null,
    meta: [VIS_LABEL[visOf(d)], edited ? `edited ${edited}` : '', recordText(d.record)].filter(Boolean).join(' · '),
    // never an id (CT-541, report #355): see authorName
    author: authorName(d.author) && d.author !== 'you' ? `built by ${authorName(d.author)}` : '',
    url: d.url ?? null,
    descHtml: src ? mdToHtml(text, { inline: cardLinker({ focusBtn, art: true }) }) : '',
    descClipped: clipped, descOpen: !!o.descOpen,
    total: d.cards.length, side: d.sideboard?.length ?? 0, maybe: d.maybe?.length ?? 0,
    rows: listRows(d.cards),
    legal: p.legal, legalText,
    tone: p.legal ? (p.cc ? 'ok' : 'warn') : analyzeDeck(d.cards).unknown.length ? 'bad' : 'warn',
    chosen: !!o.chosen, games: d.record?.games ?? 0,
    focusBtn, descBtn: o.descBtn ?? 'deck-desc-toggle',
  };
}

/** the shelf's order */
export function sortDecks<T extends DeckSource>(decks: readonly T[], sort: DeckSort): T[] {
  const out = [...decks];
  const time = (d: DeckSource): number => Date.parse(d.updatedAt ?? '') || 0;
  if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'played') out.sort((a, b) => (b.record?.games ?? 0) - (a.record?.games ?? 0) || time(b) - time(a));
  else out.sort((a, b) => time(b) - time(a));
  return out;
}

/** Gather the page from ui/decks.ts's snapshot. */
export function decksView(st: DecksState): DecksView {
  const decks = st.decks;
  const open = decks?.find(d => d.id === st.openId) ?? null;
  let sheetV: DecksSheet | null = null;
  const s = st.sheet;
  if (s?.kind === 'import') sheetV = { kind: 'import', msg: s.msg };
  else if (s?.kind === 'card') sheetV = { kind: 'card', name: s.name };
  else if (s && open) {
    if (s.kind === 'share') sheetV = { kind: 'share', vis: visOf(open), link: `${st.base}?deck=${encodeURIComponent(open.id)}` };
    else if (s.kind === 'export') {
      sheetV = { kind: 'export', format: s.format, body: st.exportBody,
        downloadName: `${open.name.replace(/[^\w. -]+/g, '').trim() || 'deck'}${s.format === 'file' ? '.json' : '.txt'}` };
    } else if (s.kind === 'delete') sheetV = { kind: 'delete', name: open.name };
    else if (s.kind === 'games') {
      sheetV = { kind: 'games', record: open.record ?? { games: 0, wins: 0, losses: 0, unresolved: 0 },
        rows: st.history.filter(g => g.deckId === open.id).map(g => ({
          result: g.result, opponent: g.opponent, turns: g.turns, life: g.life, played: shortDate(g.playedAt), code: g.code,
        })) };
    }
  }
  return {
    chrome: frameChromeView(),
    signedIn: st.signedIn,
    loading: st.loading,
    count: decks ? decks.length : null,
    sort: st.sort,
    note: st.msg,
    boxes: decks ? sortDecks(decks, st.sort).map(d => deckBoxView(d, d.id === st.openId)) : [],
    preview: open ? deckPreviewView(open, { descOpen: st.descOpen, chosen: st.chosenId === open.id }) : null,
    sheet: sheetV,
  };
}

/* ── drawing ──────────────────────────────────────────────────────────── */

const dots = (els: readonly string[]): string =>
  `<span class="dkdots">${els.map(e => `<span class="dkdot" style="background:var(--${esc(e)})" title="${esc(e)}"></span>`).join('')}</span>`;

/** One deck box on the shelf. Pure. */
export function deckBoxHtml(b: DeckBoxView): string {
  return `<button class="dkbox${b.on ? ' on' : ''}" type="button" data-btn="deck-open" data-id="${esc(b.id)}"${b.on ? ' aria-current="true"' : ''}>`
    + `<span class="dkboxart">${b.art ? `<img src="${esc(b.art)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : ''}</span>`
    + (b.cc ? chip({ label: 'Bo3 ready', tone: 'neutral', shape: 'pill', className: 'dkboxcc' }) : '')
    + `<span class="dkboxbody"><span class="dkboxname">${esc(b.name)}</span>`
    + `<span class="dkboxmeta">${dots(b.els)}<span class="dkboxcount${b.warn ? ' warn' : ''}"${b.warn && b.problems ? ` title="${esc(b.problems)}"` : ''}>${
      esc(b.count)}${b.meta ? ` · ${esc(b.meta)}` : ''}</span></span></span></button>`;
}

export interface PreviewHtmlOpts {
  /** someone else's deck: no Edit, no Play, no icon row, no Games */
  readOnly?: boolean;
  /** trusted markup: the read-only preview's own buttons, where Edit and the icon row would be */
  actionsHtml?: string;
}

/** The open deck's preview panel. Pure. */
export function deckPreviewHtml(v: DeckPreviewView, o: PreviewHtmlOpts = {}): string {
  const acts = o.readOnly ? (o.actionsHtml ?? '') : `<div class="dkprevmain">${
    button({ label: 'Edit on the table', variant: 'primary', dataBtn: 'deck-tabletop', className: 'dkprevedit' })}${
    button({ label: v.chosen ? 'Playing this ✓' : 'Play', variant: 'action', dataBtn: 'deck-play', disabled: !v.legal,
      className: `dkprevplay${v.chosen ? ' on' : ''}`, title: v.legal ? undefined : 'Not legal yet' })}</div>
    <div class="dkprevacts">${
    iconButton({ label: 'Duplicate', icon: 'copy', dataBtn: 'deck-duplicate' })}${
    iconButton({ label: 'Share', icon: 'share', dataBtn: 'deck-share' })}${
    iconButton({ label: 'Export', icon: 'export', dataBtn: 'deck-export', attrs: { 'data-format': 'text' } })}${
    iconButton({ label: 'Delete', icon: 'trash', dataBtn: 'deck-delete', className: 'dkprevdel' })}</div>${
    o.actionsHtml ?? ''}`;
  const desc = v.descHtml
    ? `<div class="deckdesc dkprevdesc${v.descOpen ? ' on' : ''}"${v.descOpen ? ` data-scroll="deck-desc|${esc(v.id)}"` : ''}>
      <div class="deckdescbody">${v.descHtml}</div>${v.descClipped || v.descOpen
      ? button({ label: v.descOpen ? 'less' : 'more', variant: 'link', size: 'sm', dataBtn: v.descBtn, className: 'dkprevmore' }) : ''}</div>`
    : '';
  const rows = v.rows.map(r => `<button class="dklrow" type="button" data-btn="${esc(v.focusBtn)}" data-card="${esc(r.name)}" data-prev="${esc(r.name)}">`
    + `<span class="dklcost">${esc(r.cost)}</span><span class="dklname">${esc(r.name)}</span>${
      r.n > 1 || r.over ? `<span class="dkln${r.over ? ' bad' : ''}">×${r.n}</span>` : ''}</button>`).join('');
  const legal = v.tone === 'ok'
    ? chip({ label: v.legalText, tone: 'success', shape: 'pill', className: 'dkprevlegal' })
    : `<span class="dkprevlegal dkprevlegal--${v.tone}">${esc(v.legalText)}</span>`;
  return `<section class="dkprev" aria-label="${esc(v.name)}">
    <div class="dkprevbanner">${v.banner ? `<img src="${esc(v.banner)}" alt="" onerror="this.style.visibility='hidden'">` : ''}</div>
    <div class="dkprevhead"><h2 class="dkprevname">${esc(v.name)}</h2>
      <div class="dkprevmeta">${esc(v.meta)}${v.author ? ` · ${esc(v.author)}` : ''}${
      v.url ? ` · <a href="${esc(v.url)}" target="_blank" rel="noopener">algomancer.cc</a>` : ''}</div></div>
    ${desc}
    ${acts}
    <div class="dkprevlisthead"><span>Main deck ${v.total}</span><span>Side ${v.side}/${SIDEBOARD_MAX} · Maybe ${v.maybe}</span></div>
    <div class="dkprevlist" data-scroll="deck-list|${esc(v.id)}">${rows || '<p class="dkprevempty">No cards yet.</p>'}</div>
    <div class="dkprevfoot">${legal}${o.readOnly ? ''
      : button({ label: 'Games ›', variant: 'link', size: 'sm', dataBtn: 'deck-games', className: 'dkprevgames' })}</div>
  </section>`;
}

function importBody(msg: string): string {
  return `<div class="dksheetform">
    ${field({ id: 'dk-url', label: 'An algomancer.cc deck link', placeholder: 'https://algomancer.cc/…', attrs: { spellcheck: 'false', autocomplete: 'off' } })}
    ${button({ label: 'Load', dataBtn: 'deck-import-url' })}
    ${field({ id: 'dk-text', label: 'Or paste a list, or a deck file', control: 'textarea', rows: 9,
    placeholder: '2 Ignis Sprite\n2 Rune Channeler\n…', attrs: { spellcheck: 'false' } })}
    ${button({ label: 'Import', variant: 'primary', dataBtn: 'deck-import-text' })}
    ${msg ? statusMessage({ tone: 'note', text: msg }) : ''}
  </div>`;
}

/** the visibility choice and the link: the Share sheet's body, and Deck info's */
export function shareBodyHtml(vis: Visibility, link: string): string {
  return `${segmented({
    ariaLabel: 'Who can see it', full: true, className: 'dkvis',
    options: (['private', 'unlisted', 'public'] as const).map(x => ({
      label: VIS_LABEL[x], value: x, on: vis === x, dataBtn: 'deck-visibility', attrs: { 'data-visibility': x },
      title: x === 'private' ? 'Only you' : x === 'unlisted' ? 'Anyone with the link' : 'The link, your profile and the metagame list',
    })),
  })}
    <div class="sharebar dksharebar${vis === 'private' ? ' off' : ''}">
      <input class="sharelink" readonly value="${esc(link)}" onclick="this.select()" aria-label="Link">
      ${button({ label: 'Copy link', size: 'sm', dataBtn: 'copylink', attrs: { 'data-link': link } })}
    </div>
    ${vis === 'private' ? '<p class="dksheetnote">Private: the link only opens for you.</p>' : ''}`;
}

function exportBody(s: Extract<DecksSheet, { kind: 'export' }>): string {
  const file = s.format === 'file';
  return `${segmented({
    ariaLabel: 'Format', full: true,
    options: [
      { label: 'Card list', value: 'text', on: !file, dataBtn: 'deck-export', attrs: { 'data-format': 'text' } },
      { label: 'Deck file (JSON)', value: 'file', on: file, dataBtn: 'deck-export', attrs: { 'data-format': 'file' } },
    ],
  })}
    <p class="dksheetnote">${file
    ? 'Description, cover, sideboard, maybeboard and attribution included. Any import box reads it.'
    : 'Cards only, one per line. algomancer.cc reads this.'}</p>
    <textarea class="dkexporttext" rows="${file ? 16 : 12}" readonly onclick="this.select()">${esc(s.body)}</textarea>`;
}

function gamesBody(s: Extract<DecksSheet, { kind: 'games' }>): string {
  const r = s.record;
  const head = r.games
    ? `<p class="dkgamesrec"><b class="${r.wins >= r.losses ? 'good' : 'bad'}">${r.wins}W–${r.losses}L</b> in ${r.games} game${r.games === 1 ? '' : 's'}${
      r.unresolved ? ` · ${r.unresolved} with no result` : ''}</p>`
    : '<p class="dksheetnote">No games with this deck yet.</p>';
  if (!s.rows.length) return head;
  return head + table({
    className: 'dkgames',
    columns: [
      { key: 'result', label: 'Result' }, { key: 'opponent', label: 'Opponent' },
      { key: 'turns', label: 'Turns', align: 'right' }, { key: 'life', label: 'Life', align: 'right' },
      { key: 'played', label: 'Played' }, { key: 'room', label: '' },
    ],
    rows: s.rows.map(g => ({
      className: `res-${g.result}`,
      cells: {
        result: g.result === 'win' ? 'Win' : g.result === 'loss' ? 'Loss' : '?', opponent: g.opponent, turns: g.turns,
        life: `${g.life[0]}–${g.life[1]}`, played: g.played,
        room: { html: `<a class="replaylink" href="?replay=${encodeURIComponent(g.code)}">▶ ${esc(g.code)}</a>` },
      },
    })),
  });
}

/** The open sheet of the Decks page, docked at the side. Pure. */
export function decksSheetHtml(s: DecksSheet | null): string {
  if (!s) return '';
  const side = { open: true, placement: 'side' as const, className: 'dksheet', attrs: { 'data-dk-sheet': s.kind } };
  switch (s.kind) {
    case 'import':
      return sheet({ ...side, id: 'dk-import', title: 'Import a deck', width: 'md', dismissBtn: 'deck-import-close', bodyHtml: importBody(s.msg) });
    case 'share':
      return sheet({ ...side, id: 'dk-share', title: 'Share', width: 'sm', dismissBtn: 'deck-share-close', bodyHtml: shareBodyHtml(s.vis, s.link) });
    case 'export':
      return sheet({ ...side, id: 'dk-export', title: 'Export', width: 'md', dismissBtn: 'deck-export-close', bodyHtml: exportBody(s),
        footerHtml: button({ label: 'Copy', variant: 'primary', dataBtn: 'deck-copy-list' })
          + button({ label: 'Download', dataBtn: 'deck-download', attrs: { 'data-name': s.downloadName } }) });
    case 'delete':
      return sheet({ ...side, id: 'dk-delete', title: 'Delete this deck?', width: 'sm', dismissBtn: 'deck-delete-no',
        bodyHtml: `<p class="dksheetnote">“${esc(s.name)}” and its record go for good.</p>`,
        footerHtml: button({ label: 'Delete it', variant: 'danger', dataBtn: 'deck-delete-yes' })
          + button({ label: 'Keep it', dataBtn: 'deck-delete-no' }) });
    case 'games':
      return sheet({ ...side, id: 'dk-games', title: 'Games', width: 'md', dismissBtn: 'deck-games-close', bodyHtml: gamesBody(s) });
    case 'card':
      return sheet({ ...side, id: 'dk-card', title: s.name, width: 'sm', dismissBtn: 'deck-unfocus', className: 'dksheet dkcardsheet',
        bodyHtml: cardPanelHtml(s.name, { close: 'deck-unfocus' }) });
  }
}

/** The page, in the app frame. Pure. */
export function decksHtml(v: DecksView): string {
  const back = { dataBtn: 'deck-close', label: 'Back', icon: 'back' as const };
  if (!v.signedIn) {
    return frameHtml({
      page: 'deckpage', title: 'Decks', back, chrome: v.chrome,
      mainHtml: emptyState({
        title: 'Your decks', text: 'Log in to keep your decks and their records. You start with five.', className: 'dkempty',
        actionHtml: button({ label: 'Log in / Sign up', variant: 'primary', dataBtn: 'acct-open-auth' }),
      }),
    });
  }
  const bar = `<div class="framebar dkshelfbar">
      <span class="dkshelfcount">${v.count === null ? (v.loading ? 'Loading…' : '') : `${v.count} of ${SHELF_MAX}`}</span>
      ${segmented({
    ariaLabel: 'Sort', size: 'sm', className: 'dksort',
    options: DECK_SORTS.map(s => ({ label: SORT_LABEL[s], value: s, on: v.sort === s, dataBtn: 'deck-sort', attrs: { 'data-sort': s } })),
  })}
      <span class="framespacer"></span>
      ${button({ label: 'Import', dataBtn: 'deck-import-open' })}
      ${button({ label: '+ New deck', variant: 'primary', dataBtn: 'deck-new' })}
    </div>
    ${v.note ? statusMessage({ tone: 'note', text: v.note, className: 'dkshelfnote' }) : ''}`;
  const shelf = v.boxes.length
    ? `<div class="dkshelf" data-scroll="deck-shelf">${v.boxes.map(deckBoxHtml).join('')}</div>`
    : emptyState({ text: v.loading || v.count === null ? 'Loading your decks…' : 'No decks yet. Make one, or import one.', bare: true, className: 'dkempty' });
  const prev = v.preview
    ? deckPreviewHtml(v.preview)
    : `<section class="dkprev dkprev--none">${emptyState({ text: v.boxes.length ? 'Pick a deck.' : '', bare: true })}</section>`;
  return frameHtml({
    page: 'deckpage', title: 'Decks', back, chrome: v.chrome, fill: true, wide: true,
    toolsHtml: button({ label: 'Refresh', size: 'sm', dataBtn: 'deck-refresh', className: 'dkrefresh' }),
    mainHtml: `<div class="dkshelfpage"><section class="dkshelfcol">${bar}${shelf}</section>${prev}</div>${decksSheetHtml(v.sheet)}`,
  });
}

/* ── the builder's toolbar: the count pill and Deck info ─────────────────── */

/** The builder's count pill for a deck: "30 cards" or "27 / 30", its tone, and what is wrong, one line each —
 * the casual rules, then (on a deck that meets them) the Competitive check. */
export function deckPill(d: DeckSource): TablePill {
  const a = analyzeDeck(d.cards);
  const p = deckProblems(d);
  const problems = p.legal ? (p.ccError ? [`Competitive: ${p.ccError}`] : []) : p.casual;
  const over = a.copies.some(c => c.n > 2);
  return {
    text: a.total < DECK_MIN ? `${a.total} / ${DECK_MIN}` : `${a.total} cards`,
    tone: p.legal ? (p.cc ? 'ok' : 'warn') : a.unknown.length || over ? 'bad' : 'warn',
    problems,
  };
}

/** the builder's Deck info button (the host's toolsHtml) */
export const deckInfoButtonHtml = (on: boolean): string =>
  iconButton({ label: 'Deck info', icon: 'edit', dataBtn: 'deck-settings', on });

/* ── the builder's Deck info sheet (ui/decks.ts tabletopHost sheetHtml) ── */

export interface DeckInfoView {
  name: string;
  cover: string | null;
  /** the deck's distinct cards, dearest first, to pick the cover from */
  covers: { name: string; art: string }[];
  /** the description, rendered; '' = none */
  descHtml: string;
  /** the editor is open, holding `draft` */
  editing: boolean;
  draft: string;
  syntax: boolean;
  vis: Visibility;
  link: string;
}

export function deckInfoView(d: DeckSource, o: { editing: boolean; draft: string | null; syntax: boolean; base: string }): DeckInfoView {
  const names = analyzeDeck(d.cards).copies
    .sort((x, y) => (y.facts?.mana ?? 0) - (x.facts?.mana ?? 0) || x.name.localeCompare(y.name))
    .map(c => c.name);
  const src = (d.description ?? '').trim();
  return {
    name: d.name, cover: d.cover, covers: names.map(n => ({ name: n, art: cardArt(n) })),
    descHtml: src ? mdToHtml(src, { inline: cardLinker({ art: true }) }) : '',
    editing: o.editing, draft: o.draft ?? d.description ?? '', syntax: o.syntax,
    vis: visOf(d), link: `${o.base}?deck=${encodeURIComponent(d.id)}`,
  };
}

/** what the description syntax `?` opens: how this client reads a description (ui/markdown.ts, ui/cardlinks.ts) */
const SYNTAX_HTML = `<div class="dksyntax">
    <h3>Description syntax</h3>
    <p>A description is <b>markdown</b>, and a deliberately small dialect of it — the renderer
      emits a closed set of tags and no attributes at all, which is what makes it safe to show
      your text on somebody else’s screen.</p>
    <table class="accttable">
      <thead><tr><th>write</th><th>get</th></tr></thead>
      <tbody>
        <tr><td><code>## A heading</code></td><td>a heading (<code>#</code> through <code>###</code>)</td></tr>
        <tr><td><code>**bold**</code> · <code>*italic*</code></td><td><b>bold</b> · <i>italic</i></td></tr>
        <tr><td><code>- a list item</code></td><td>a bulleted list</td></tr>
        <tr><td><code>1. a step</code></td><td>a numbered list</td></tr>
        <tr><td><code>&gt; a quote</code></td><td>an indented quote</td></tr>
        <tr><td><code>\`code\`</code></td><td>a monospaced run</td></tr>
        <tr><td>a blank line</td><td>a new paragraph</td></tr>
      </tbody>
    </table>
    <h3>Card names link themselves</h3>
    <p>Write a card’s name as it is printed — <code>Ignis Sprite</code> — and it becomes a link
      that shows the card when a reader hovers it, and pins it when they click. You do not mark it
      up; the client finds it.</p>
    <p>Two things that follow from that, and surprise people:</p>
    <ul>
      <li><b>Case matters.</b> “we fight early” is prose; <code>Fight</code> is the card.</li>
      <li><b>One-word names that are also rules words do not auto-link</b> — Battle, Trash, Graft
        and the rest. A strategy primer says those words constantly and a page full of links is
        unreadable.</li>
    </ul>
    <p>To link one of those anyway, or to name a card in your own words, write
      <code>[the two-drop](Ignis Sprite)</code> — any text, any card the client knows.</p>
    <p class="hint">A pasted URL stays plain text.</p>
  </div>`;

/** The builder's Deck info sheet: the name, the cover, the description, who can see it. Pure. */
export function deckInfoHtml(v: DeckInfoView): string {
  const covers = v.covers.length
    ? `<div class="dkcoverbar">${button({ label: 'Random', size: 'sm', dataBtn: 'deck-cover-random' })}</div>
      <div class="dkcovergrid">${v.covers.map(c => `<button class="dkcovertile${c.name === v.cover ? ' on' : ''}" type="button" data-btn="deck-cover" data-card="${esc(c.name)}" title="${esc(c.name)}">`
        + `<img src="${esc(c.art)}" alt="${esc(c.name)}" loading="lazy" onerror="this.style.visibility='hidden'"></button>`).join('')}</div>`
    : '<p class="dksheetnote">Put some cards in it first.</p>';
  const desc = v.editing
    ? `<div class="dkdescedit">
        ${v.syntax ? SYNTAX_HTML : ''}
        ${field({ id: 'dk-desc', label: 'Markdown; card names link themselves', control: 'textarea', rows: 12, value: v.draft, className: 'dkdesctext',
    placeholder: 'What is the deck trying to do? What do you keep? What beats it?', attrs: { maxlength: '6000' } })}
        <div class="dkdescbtns">${button({ label: 'Save', variant: 'primary', size: 'sm', dataBtn: 'deck-desc-save' })}${
        button({ label: 'Cancel', size: 'sm', dataBtn: 'deck-desc-cancel' })}<span class="framespacer"></span>${
        button({ label: v.syntax ? 'Hide syntax' : 'Syntax', variant: 'link', size: 'sm', dataBtn: 'deck-desc-syntax', className: v.syntax ? 'on' : undefined })}</div>
      </div>`
    : `${v.descHtml ? `<div class="deckdesc dkinfodesc"><div class="deckdescbody">${v.descHtml}</div></div>` : ''}
      ${button({ label: v.descHtml ? 'Edit' : 'Write one', size: 'sm', dataBtn: 'deck-desc-edit' })}`;
  return sheet({
    open: true, placement: 'side', width: 'md', id: 'dk-info', title: 'Deck info', dismissBtn: 'deck-settings-close',
    className: 'dksheet dkinfo', attrs: { 'data-dk-sheet': 'info' },
    bodyHtml: `${field({ id: 'dk-name', label: 'Name', value: v.name, attrs: { maxlength: '60', spellcheck: 'false', autocomplete: 'off' } })}
      <h3 class="dksheeth">Cover</h3>${covers}
      <h3 class="dksheeth">Description</h3>${desc}
      <h3 class="dksheeth">Who can see it</h3>${shareBodyHtml(v.vis, v.link)}`,
  });
}

/* ── painting ─────────────────────────────────────────────────────────── */

/** Put the page on screen, every scrolling region where it was. */
export function paintDecks(app: HTMLElement, v: DecksView): void {
  paintFrame(app, noImgDrag(decksHtml(v)));
}
