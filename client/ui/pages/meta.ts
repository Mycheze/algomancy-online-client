/* THE METAGAME, DRAWN: published decks, one shared deck (`?deck=`), the card
 * duel ladder — and the card stats tab, which pages/cardstats.ts draws.
 *
 * ui/meta.ts keeps the state, the fetches, the URL and the clicks (`meta-*`);
 * this file is the page contract (pages/README.md): metaView() gathers that
 * state into a plain object, metaHtml(view) draws whichever of the four views
 * is up and touches nothing else, paintMeta() puts it on the page and wires
 * the filter boxes.
 *
 * Moved out of meta.ts in the design-system round (2026-11-03), the templates
 * byte for byte. What the page must never do (invent a deck out of an
 * aggregate; decide for itself who may be seen) is in meta.ts's header.
 */
import * as acct from '../account.ts';
import { artHtml, cardPanelHtml, deckStripHtml } from '../cardpanel.ts';
import { cardLinker, clipDescription, descSummary } from '../cardlinks.ts';
import { mdToHtml } from '../markdown.ts';
import { rowFor } from '../cardindex.ts';
import { analyzeDeck, deckElements } from '../deckstats.ts';
import { GROUPINGS, deckSections, needsCountBadge, stackLayers } from '../decklayout.ts';
import type { DeckGrouping } from '../decklayout.ts';
import { deckStatsHtml } from '../decks.ts';
import { ALL_ELEMENTS } from '../../engine/src/apply.ts';
import { esc, elIcon } from '../util.ts';
import { artUrl } from '../assets.ts';
import type { CardStanding, MetaState, PublicDeck } from '../meta.ts';
import { cardStatsHtml, cardStatsView, paintCardStats, type CardStatsView } from './cardstats.ts';
import type { CardStatsState } from '../cardstats.ts';
import { segmented } from '../components/index.ts';
import { frameChromeView, frameHtml, paintFrame, type FrameChrome } from './frame.ts';

type Sort = MetaState['sort'];

/** Everything the page shows, whichever view is up. */
export interface MetaView extends Omit<MetaState, 'els'> {
  /** the element filter on the deck list */
  els: string[];
  /** signed in: a shared deck that is not yours can be copied */
  signedIn: boolean;
  /** the shared deck is the viewer's own */
  mine: boolean;
  /** the shared deck's own link, for the share bar */
  link: string;
  /** the shared deck's export panel, as text, in the format showing */
  exportText: string;
  /** the card stats tab, when that is the view */
  stats: CardStatsView | null;
  /** the toolbar's account and bell (pages/frame.ts) */
  chrome: FrameChrome;
}

/** Gather the page. `exportText` is meta.ts's (its copy button copies the same
 * text); `stats` is the card stats tab's own state. */
export function metaView(st: MetaState, exportText: string, stats: CardStatsState): MetaView {
  const one = st.one;
  return {
    ...st,
    els: [...st.els],
    signedIn: !!acct.token(),
    mine: !!one && acct.currentUser()?.id === one.owner.id,
    link: one ? `${location.origin}${location.pathname}?deck=${encodeURIComponent(one.id)}` : '',
    exportText,
    stats: st.view === 'stats' ? cardStatsView(stats, metaTabsHtml(st.view)) : null,
    chrome: frameChromeView(),
  };
}

/** the three tabs this page has: decks people published, how every card has
 * done across every game (ui/cardstats.ts), and cards that duelled. They sit
 * in the toolbar's centre (pages/frame.ts); a shared deck is under Published
 * decks, so that tab is the one lit while one is open. */
export function metaTabsHtml(view: MetaView['view']): string {
  return segmented({
    ariaLabel: 'Metagame', className: 'metatabs',
    options: [
      { label: 'Published decks', value: 'list', on: view === 'list' || view === 'deck', dataBtn: 'meta-list' },
      { label: 'Card stats', value: 'stats', on: view === 'stats', dataBtn: 'meta-stats-open' },
      { label: 'Card duel ladder', value: 'ladder', on: view === 'ladder', dataBtn: 'meta-ladder' },
    ],
  });
}

/** a metagame view in the frame: Home on the left, the tabs in the centre */
function metaFrame(v: MetaView, page: string, mainHtml: string, o: { titleHtml?: string; title?: string; toolsHtml?: string } = {}): string {
  return frameHtml({
    page, title: o.title ?? 'Metagame', titleHtml: o.titleHtml,
    back: { dataBtn: 'meta-close', label: 'Home' },
    centerHtml: metaTabsHtml(v.view), toolsHtml: o.toolsHtml,
    chrome: v.chrome, fill: true, mainHtml,
  });
}

function ladderRowHtml(c: CardStanding, rank: number | null): string {
  return `<div class="metarow ladderrow" data-prev="${esc(c.card)}">
    <span class="metacover">${artFor(c.card)
      ? `<img src="${esc(artFor(c.card))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : ''}</span>
    <span class="metabody">
      <span class="metaname">${rank !== null ? `<span class="dim">#${rank}</span> ` : ''}${esc(c.card)}</span>
      <span class="metaby">${c.wins}W–${c.losses}L in ${c.games} duel${c.games === 1 ? '' : 's'}${
        c.mirrors ? ` · ${c.mirrors} mirror${c.mirrors === 1 ? '' : 's'}` : ''}</span>
    </span>
    <span class="metarec"><b>${c.rating}</b></span>
  </div>`;
}

function ladderHtml(v: MetaView): string {
  const { ladder } = v;
  const q = v.text.trim().toLowerCase();
  const all = (ladder?.cards ?? []).filter(c => !q || c.card.toLowerCase().includes(q));
  const bar = ladder?.rankedAfter ?? 5;
  // rank numbers belong to the whole ranked ladder, not to whatever the filter left
  const rankOf = new Map((ladder?.cards ?? []).filter(c => c.games >= bar).map((c, i) => [c.card, i + 1]));
  const ranked = all.filter(c => rankOf.has(c.card));
  const rest = all.filter(c => !rankOf.has(c.card));
  return metaFrame(v, 'metapage', `
    <div class="framebar">
      <span class="dim">${ladder ? `${ladder.duels} duel${ladder.duels === 1 ? '' : 's'} · ${ladder.cards.length} card${ladder.cards.length === 1 ? '' : 's'} rated` : ''}</span>
      <span class="framespacer"></span>
      <input id="meta-q" class="dksearch metaq" spellcheck="false" placeholder="find a card" value="${esc(v.text)}">
    </div>
    ${v.msg ? `<div class="acctmsg">${esc(v.msg)}</div>` : ''}
    <div class="framelist" data-scroll="meta-ladder">
      ${v.loading && !ladder ? '<p class="hint metaempty">loading…</p>' : ''}
      ${ladder && !ladder.cards.length ? '<p class="hint metaempty">No duels yet. Somebody has to go first.</p>' : ''}
      ${ladder && ladder.cards.length && !all.length ? '<p class="hint metaempty">No rated card matches that.</p>' : ''}
      <div class="metalist">${ranked.map(c => ladderRowHtml(c, rankOf.get(c.card)!)).join('')}</div>
      ${rest.length ? `<div class="metadivider">Not enough duels yet
          <span class="hint">— a card is ranked once it has ${bar} duels that were not mirrors.</span></div>
        <div class="metalist">${rest.map(c => ladderRowHtml(c, null)).join('')}</div>` : ''}
    </div>
    <p class="framenote">Each card's Elo from Single Card Duels: thirty copies of one card against thirty of another. Start one from Home, under Constructed.</p>`);
}

// ── little pieces ─────────────────────────────────────────────────────

export const artFor = (name: string): string => {
  const r = rowFor(name);
  return r ? artUrl(r.image || r.name.replace(/ /g, '-') + '.jpg') : '';
};

/**
 * A deck's record as a line, and the one thing it must never do: dress up a
 * sample it has not got. Under the floor it prints the count and NO rate.
 */
function recordLine(d: PublicDeck, minGames: number): string {
  const { games, wins, losses } = d.record;
  if (!games) return '<span class="dim">no games yet</span>';
  const decided = wins + losses;
  // still asked here, and it is the shared DECK page that needs it: that page
  // opens any shared deck, floor or no floor, and "100%" off two games is a
  // number nobody should be shown. Everything on the metagame LIST is over the
  // floor by construction now (server/publicdecks.ts's metaList).
  const ranked = games >= minGames && decided > 0;
  return `${ranked
    ? `<b class="${wins >= losses ? 'good' : 'bad'}">${Math.round((wins / decided) * 100)}%</b> `
    : ''}<span class="dim">${wins}W–${losses}L in ${games} game${games === 1 ? '' : 's'}${
    d.copies > 1 ? ` · ${d.copies} copies` : ''}</span>`;
}

/** the deck's elements, from the same arithmetic the deck page uses */
function elLine(d: PublicDeck): string {
  return deckElements(analyzeDeck(d.cards))
    .map(e => `<span class="acctel ${e.el}" title="${Math.round(e.share * 100)}% of the deck">${e.el}</span>`)
    .join('');
}

/** the filters, applied in the browser: the server ranks, this narrows */
function shown(v: MetaView): PublicDeck[] {
  const q = v.text.trim().toLowerCase();
  return (v.rows ?? []).filter(d => {
    if (q && !d.name.toLowerCase().includes(q)
      && !d.owner.username.toLowerCase().includes(q)
      && !d.cards.some(c => c.toLowerCase().includes(q))) return false;
    if (v.els.length) {
      const have = new Set(deckElements(analyzeDeck(d.cards)).map(e => e.el));
      for (const el of v.els) if (!have.has(el)) return false;
    }
    return true;
  });
}

// ── the list ──────────────────────────────────────────────────────────

export function metaRowHtml(d: PublicDeck, minGames: number): string {
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
    <span class="metarec">${recordLine(d, minGames)}</span>
  </button>`;
}

function listHtml(v: MetaView): string {
  const { rows, minGames } = v;
  // ⚠ NO SECOND TIER. The server used to send every public deck and this page
  // split them around `minGames` into a ranked list and a "not enough games
  // yet" tail. Since decks publish by default, that tail was every unplayed
  // deck on the deploy, so the floor moved into `metaList` and became a filter
  // — everything that arrives here is legal and has been played.
  const all = shown(v);
  const SORTS: [Sort, string][] = [
    ['winrate', 'winrate'], ['games', 'most played'], ['new', 'newest'], ['name', 'name'],
  ];
  return metaFrame(v, 'metapage', `
    <div class="framebar">
      <input id="meta-q" class="dksearch metaq" spellcheck="false" placeholder="name, builder, or a card in it"
        value="${esc(v.text)}">
      <div class="dkfilters metaels">
        ${ALL_ELEMENTS.map(el =>
          `<button class="elchip ${el}${v.els.includes(el) ? ' on' : ''}" data-btn="meta-el" data-el="${el}">${elIcon(el)}${el}</button>`).join('')}
        ${v.els.length || v.text ? '<button data-btn="meta-clear">clear</button>' : ''}
      </div>
      <span class="framespacer"></span>
      ${segmented({
        ariaLabel: 'Sort', size: 'sm',
        options: SORTS.map(([s, label]) => ({ label, value: s, on: v.sort === s, dataBtn: 'meta-sort', attrs: { 'data-sort': s } })),
      })}
    </div>
    ${v.msg ? `<div class="acctmsg">${esc(v.msg)}</div>` : ''}
    <div class="framelist" data-scroll="meta-decks">
      ${v.loading && !rows ? '<p class="hint metaempty">loading…</p>' : ''}
      ${rows && !all.length
        ? `<p class="hint metaempty">${rows.length
          ? 'Nothing matches those filters.'
          : `Nothing on the list yet. A deck appears here once it is <b>public</b>, <b>legal</b>
             and has ${minGames} constructed games behind it, played signed in.`}</p>`
        : ''}
      <div class="metalist">${all.map(d => metaRowHtml(d, minGames)).join('')}</div>
    </div>
    ${all.length ? `<p class="framenote">Every deck here is legal and has at least ${minGames}
      constructed games behind it.</p>` : ''}`);
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
function deckGrid(d: PublicDeck, deckGroup: DeckGrouping, statsOpen: boolean): string {
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

function exportHtml(v: MetaView): string {
  const file = v.exporting === 'file';
  return `<div class="dkexport">
    <div class="dktoolbar">
      <span class="zonelabel">export</span>
      <button class="dkkind${file ? '' : ' on'}" data-btn="meta-export" data-format="text">card list</button>
      <button class="dkkind${file ? ' on' : ''}" data-btn="meta-export" data-format="file">whole deck (JSON)</button>
      <span class="dkfilterspacer"></span>
      <button data-btn="meta-copy-export">copy</button>
      <button data-btn="meta-export-close">close</button>
    </div>
    <div class="hint">${file
      ? 'Description, cover and attribution included — paste it into the import box on your decks page.'
      : 'One line per card — paste it anywhere, including algomancer.cc.'}</div>
    <textarea class="dkexporttext" rows="${file ? 16 : 10}" readonly
      onclick="this.select()">${esc(v.exportText)}</textarea>
  </div>`;
}

function deckHtml(v: MetaView): string {
  const { one, msg } = v;
  if (!one) {
    return metaFrame(v, 'metadeck', `<div class="metadeckgone">
      <p class="hint">${esc(msg || (v.loading ? 'loading…' : 'That deck is not shared.'))}</p>
      <button data-btn="meta-list">See the metagame list</button>
    </div>`, { title: 'Deck' });
  }
  const d = one;
  const a = analyzeDeck(d.cards);
  const desc = d.description ?? '';
  const { text: shownDesc, clipped } = v.descOpen ? { text: desc, clipped: false } : clipDescription(desc, 400);
  const link = v.link;
  const by = `by ${esc(d.owner.username)}${
    d.copiedFrom ? ` · after ${esc(d.copiedFrom.owner)}’s ${esc(d.copiedFrom.name)}` : ''}${
    d.visibility === 'unlisted' ? ' · unlisted — only people with the link see this' : ''}`;
  // two columns that each scroll: what the deck IS on the left (who made it,
  // its record, its primer, how to take it), the cards on the right
  return metaFrame(v, 'metadeck', `
    ${msg ? `<div class="acctmsg">${esc(msg)}</div>` : ''}
    ${deckStripHtml(d.name, a, { lead: 'Deck' })}
    <div class="metadeckwork">
      <aside class="metadeckinfo" data-scroll="meta-deck-info">
        <div class="deckrecline">${recordLine(d, v.minGames)}</div>
        ${desc.trim() ? `<div class="deckdesc">
          <div class="deckdescbody">${mdToHtml(shownDesc, { inline: cardLinker({ focusBtn: 'meta-focus' }) })}</div>
          ${clipped || v.descOpen
            ? `<button class="cblink" data-btn="meta-desc-toggle">${v.descOpen ? 'show less' : 'read more'}</button>`
            : ''}</div>` : ''}
        <div class="dkaddrow">
          ${v.signedIn && !v.mine
            ? '<button class="primary" data-btn="meta-take">Copy this deck to my collection</button>'
            : ''}
          ${v.mine ? '<span class="hint">Yours — edit it on your decks page.</span>' : ''}
        </div>
        <div class="sharebar">Send somebody this link:
          <input class="sharelink" readonly value="${esc(link)}" onclick="this.select()">
          <button data-btn="copylink" data-link="${esc(link)}">copy</button></div>
        ${v.exporting ? exportHtml(v) : '<button class="dkadd" data-btn="meta-export">Export this deck</button>'}
      </aside>
      <div class="dkwork metadeckcards">
        <div class="dkworkmain" data-scroll="meta-deck-cards">${deckGrid(d, v.deckGroup, v.statsOpen)}</div>
        ${v.focus ? `<div class="cbside" data-scroll="meta-deck-focus-${esc(v.focus)}">${cardPanelHtml(v.focus, { close: 'meta-unfocus' })}</div>` : ''}
      </div>
    </div>`, { title: d.name, titleHtml: `${esc(d.name)}<small>${by}</small>` });
}

/** Whichever view is up. Empty when the page does not own #app. */
export function metaHtml(v: MetaView): string {
  return v.view === 'list' ? listHtml(v) : v.view === 'ladder' ? ladderHtml(v)
    : v.view === 'stats' && v.stats ? cardStatsHtml(v.stats) : v.view === 'deck' ? deckHtml(v) : '';
}

/** What paintMeta wires the page's boxes to. */
export interface MetaHooks {
  /** the deck list's and the ladder's filter box (one text, both tabs) */
  setText: (text: string) => void;
  /** the card stats tab's filter box */
  setStatsText: (text: string) => void;
  /** paint the page again */
  repaint: () => void;
  /** the card stats tab's repaint, which also writes the URL */
  statsRepaint: () => void;
}

/** Paint `v` into `app`, and wire the filter box. */
export function paintMeta(app: HTMLElement, v: MetaView, h: MetaHooks): void {
  if (v.stats) paintCardStats(app, v.stats, h.setStatsText, h.statsRepaint);
  else paintFrame(app, metaHtml(v));
  const box = document.getElementById('meta-q') as HTMLInputElement | null;
  if (box) {
    box.oninput = () => { h.setText(box.value); repaintKeepingCaret(h.repaint); };
  }
}

/** Typing in the filter box must not yank the caret out of it, which a full
 * repaint does — the same problem ui/cards.ts documents at repaintKeepingCaret. */
function repaintKeepingCaret(repaint: () => void): void {
  const before = document.getElementById('meta-q') as HTMLInputElement | null;
  const at = before?.selectionStart ?? null;
  repaint();
  const after = document.getElementById('meta-q') as HTMLInputElement | null;
  if (!after) return;
  after.focus();
  if (at !== null) after.setSelectionRange(at, at);
}
