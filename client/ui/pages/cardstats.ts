/* CARD STATS, DRAWN — the metagame page's third tab (`?cardstats`).
 *
 * ui/cardstats.ts keeps the state, the fetch and the clicks (`meta-cs-*`);
 * this file is the page contract (pages/README.md): cardStatsView() gathers
 * that state into a plain object, cardStatsHtml(view) draws it and touches
 * nothing else, paintCardStats() puts it on the page and wires the filter
 * box. ui/meta.ts still owns the page (its URL, its tab row and its paint),
 * so the tab row arrives here as a slot.
 *
 * Moved out of cardstats.ts in the design-system round (2026-11-03), the
 * templates byte for byte. The vocabulary (GIH, OH, GNS, IWD) and the
 * owner's RAW NUMBERS rule are in cardstats.ts's header: every win rate is
 * printed with the number of games under it, and nothing is shrunk.
 */
import * as acct from '../account.ts';
import { cardPanelHtml } from '../cardpanel.ts';
import { rowFor } from '../cardindex.ts';
import { artUrl } from '../assets.ts';
import { esc, elIcon } from '../util.ts';
import type { CardStatsState, CsCard, Mode, Range, Wr } from '../cardstats.ts';
import { segmented, toggle } from '../components/index.ts';
import { frameChromeView, frameHtml, paintFrame, type FrameChrome } from './frame.ts';

const ELEMENTS = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];

/** Everything the page shows. `tabs` is meta.ts's tab row, a slot. */
export interface CardStatsView extends Omit<CardStatsState, 'els'> {
  /** the element filter, in the order it was pressed */
  els: string[];
  /** "my games" is offered only to a signed-in player */
  signedIn: boolean;
  /** meta.ts's tabs, a slot: the toolbar's centre */
  tabs: string;
  /** the toolbar's account and bell (pages/frame.ts) */
  chrome: FrameChrome;
}

export function cardStatsView(st: CardStatsState, tabs: string): CardStatsView {
  return { ...st, els: [...st.els], signedIn: !!acct.currentUser(), tabs, chrome: frameChromeView() };
}

// ── numbers ───────────────────────────────────────────────────────────

const rate =(a: number, b: number): number | null => (b ? a / b : null);
const wrOf = (w: Wr): number | null => rate(w.w, w.n);
const iwd = (c: CsCard): number | null => {
  const a = wrOf(c.gih), b = wrOf(c.gns);
  return a === null || b === null ? null : a - b;
};
const pct = (x: number | null, d = 0): string => (x === null ? '' : `${(x * 100).toFixed(d)}%`);
const fix = (x: number | null, d = 1): string => (x === null ? '' : x.toFixed(d));

/** A win rate's tint: a diverging scale around 50% — orange below, cyan above,
 * grey at the middle. The number is always printed, so the colour is never
 * the only thing saying it. The two colours are tokens (--color-winrate-up /
 * -down and their channels, styles/tokens.css); the strength is the alpha. */
function wrTint(x: number | null): string {
  if (x === null) return '';
  const d = Math.max(-1, Math.min(1, (x - 0.5) / 0.25));
  const a = (Math.abs(d) * 0.34).toFixed(3);
  return `background: rgb(var(--color-winrate-${d >= 0 ? 'up' : 'down'}-rgb) / ${a})`;
}

function wrCell(w: Wr): string {
  const x = wrOf(w);
  if (x === null) return '<td class="csnum dim">·</td>';
  return `<td class="csnum cswr" style="${wrTint(x)}" title="${w.w} won of ${w.n}">${pct(x)}<small>${w.n}</small></td>`;
}

const iwdCell = (c: CsCard): string => {
  const x = iwd(c);
  if (x === null) return '<td class="csnum dim">·</td>';
  return `<td class="csnum" style="${wrTint(0.5 + x / 2)}" title="GIH ${pct(wrOf(c.gih))} of ${c.gih.n} vs not seen ${pct(wrOf(c.gns))} of ${c.gns.n}">${x > 0 ? '+' : ''}${(x * 100).toFixed(0)}<small>pp</small></td>`;
};

const numCell = (v: string, title = ''): string =>
  v ? `<td class="csnum"${title ? ` title="${esc(title)}"` : ''}>${v}</td>` : '<td class="csnum dim">·</td>';

// ── the columns ───────────────────────────────────────────────────────

interface Col {
  key: string;
  label: string;
  tip: string;
  modes: Mode[];
  /** `csg` is the constructed seat-games under the filters: Deck % divides by it */
  sort: (c: CsCard, csg: number) => number | null;
  cell: (c: CsCard, csg: number) => string;
}

const ALL: Mode[] = ['all', 'draft', 'constructed'];
const deckRate = (c: CsCard, csg: number): number | null => rate(c.deck.n, csg);

export const COLS: Col[] = [
  { key: 'games', label: 'Games', tip: 'seat-games the card figured in at all', modes: ALL,
    sort: c => c.games, cell: c => numCell(String(c.games)) },
  { key: 'gih', label: 'GIH WR', tip: 'win rate when it was in your hand at any point', modes: ALL,
    sort: c => wrOf(c.gih), cell: c => wrCell(c.gih) },
  { key: 'oh', label: 'OH WR', tip: 'win rate when it was in your opening hand', modes: ALL,
    sort: c => wrOf(c.oh), cell: c => wrCell(c.oh) },
  { key: 'drawn', label: 'Drawn WR', tip: 'win rate when it reached your hand after the opening — drawn, or drafted in', modes: ALL,
    sort: c => wrOf(c.drawn), cell: c => wrCell(c.drawn) },
  { key: 'played', label: 'Played WR', tip: 'win rate when you played or cast it', modes: ALL,
    sort: c => wrOf(c.played), cell: c => wrCell(c.played) },
  { key: 'gns', label: 'GNS WR', tip: 'win rate when it was in your deck or your draft\'s pool and you never held it', modes: ALL,
    sort: c => wrOf(c.gns), cell: c => wrCell(c.gns) },
  { key: 'iwd', label: 'IWD', tip: 'improvement when drawn: GIH win rate minus not-seen win rate, in points', modes: ALL,
    sort: iwd, cell: iwdCell },
  { key: 'playrate', label: 'Play %', tip: 'of the games you held it, how often you played it', modes: ALL,
    sort: c => rate(c.gihPlayed, c.gih.n), cell: c => numCell(pct(rate(c.gihPlayed, c.gih.n)), `played in ${c.gihPlayed} of the ${c.gih.n} games it was held`) },
  { key: 'firstturn', label: 'Turn', tip: 'average turn it was first played on', modes: ALL,
    sort: c => rate(c.firstTurnSum, c.firstTurnN), cell: c => numCell(fix(rate(c.firstTurnSum, c.firstTurnN))) },
  { key: 'recycled', label: 'Recycled', tip: 'copies recycled for a resource', modes: ALL,
    sort: c => c.recycled, cell: c => numCell(c.recycled ? String(c.recycled) : '', `${pct(rate(c.recycledFull, c.copiesSeen))} of the copies held`) },
  { key: 'pick', label: 'Pick %', tip: 'of the copies in a pack you drafted from, how many you took', modes: ['all', 'draft'],
    sort: c => rate(c.picked, c.offered), cell: c => numCell(c.offered ? pct(rate(c.picked, c.offered)) : '', `${c.picked} of ${c.offered}`) },
  { key: 'pos', label: 'Pick pos', tip: 'average place in a pack\'s life it was taken at: 0 fresh, 1 once passed, 2 twice passed', modes: ['draft'],
    sort: c => rate(c.pickPosSum, c.picked), cell: c => numCell(fix(rate(c.pickPosSum, c.picked))) },
  { key: 'passed', label: 'Passed', tip: 'copies left in a pack you drafted from', modes: ['draft'],
    sort: c => c.offered - c.picked, cell: c => numCell(c.offered ? String(c.offered - c.picked) : '') },
  { key: 'given', label: 'Given', tip: 'copies you moved out of your hand into a pack', modes: ['draft'],
    sort: c => c.given, cell: c => numCell(c.given ? String(c.given) : '') },
  { key: 'deck', label: 'Deck %', tip: 'of the constructed decks, how many ran it', modes: ['all', 'constructed'],
    sort: deckRate, cell: (c, csg) => numCell(c.deck.n ? pct(deckRate(c, csg)) : '', `${c.deck.n} decks`) },
  { key: 'copies', label: 'Copies', tip: 'average copies in the decks that ran it', modes: ['constructed'],
    sort: c => rate(c.deckCopies, c.deck.n), cell: c => numCell(fix(rate(c.deckCopies, c.deck.n))) },
  { key: 'deckwr', label: 'Deck WR', tip: 'win rate of the decks that ran it', modes: ['constructed'],
    sort: c => wrOf(c.deck), cell: c => wrCell(c.deck) },
  { key: 'bottom', label: 'Bottom %', tip: 'of the copies held, how many were put on the bottom in the draw step', modes: ['constructed'],
    sort: c => rate(c.bottomedFull, c.copiesSeen), cell: c => numCell(pct(rate(c.bottomedFull, c.copiesSeen)), `${c.bottomed} bottomed in all`) },
];

/** the columns a format shows (cardstats.ts asks too, to keep the sort on one of them) */
export const colsFor = (mode: Mode): Col[] => COLS.filter(c => c.modes.includes(mode));

// ── filtering and sorting ─────────────────────────────────────────────

function kindOf(card: string): 'unit' | 'spell' | null {
  const k = rowFor(card)?.kind;
  if (!k) return null;
  return k === 'unit' ? 'unit' : 'spell';
}

function shown(v: CardStatsView): CsCard[] {
  const q = v.text.trim().toLowerCase();
  const col = COLS.find(c => c.key === v.sortKey) ?? COLS[0]!;
  const csg = v.data?.constructedSeatGames ?? 0;
  return (v.data?.cards ?? []).filter(c => {
    if (c.games < v.minGames) return false;
    if (q && !c.card.toLowerCase().includes(q)) return false;
    const r = rowFor(c.card);
    if (v.els.length && !(r?.factions ?? []).some(f => v.els.includes(f))) return false;
    if (v.kind !== 'all' && kindOf(c.card) !== v.kind) return false;
    return true;
  }).sort((a, b) => {
    const x = col.sort(a, csg), y = col.sort(b, csg);
    if (x === null && y === null) return a.card.localeCompare(b.card);
    if (x === null) return 1;             // unknowns sink, whichever way
    if (y === null) return -1;
    return (x - y) * v.sortDir || b.games - a.games || a.card.localeCompare(b.card);
  });
}

// ── pieces ────────────────────────────────────────────────────────────

const art = (name: string): string => {
  const r = rowFor(name);
  return r ? artUrl(r.image || r.name.replace(/ /g, '-') + '.jpg') : '';
};

const thumb = (name: string): string =>
  `<span class="csthumb">${art(name) ? `<img src="${esc(art(name))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : ''}</span>`;

const elIcons = (name: string): string =>
  (rowFor(name)?.factions ?? []).map(f => `<span class="acctel icon ${esc(f)}" title="${esc(f)}">${elIcon(f, f)}</span>`).join('');

function cardName(name: string): string {
  return `<button class="csname" data-btn="meta-cs-focus" data-card="${esc(name)}" data-prev="${esc(name)}">
    ${thumb(name)}<span>${esc(name)}</span><span class="cselicons">${elIcons(name)}</span></button>`;
}

/** one choice of a few, as the page's segmented controls draw it */
function seg<T extends string>(label: string, btn: string, now: T, opts: [T, string][]): string {
  return segmented({
    ariaLabel: label, size: 'sm',
    options: opts.map(([value, text]) => ({ label: text, value, on: now === value, dataBtn: btn, attrs: { 'data-v': value } })),
  });
}

function headerHtml(v: CardStatsView): string {
  const d = v.data;
  const span = d?.firstPlayed && d.lastPlayed ? `${d.firstPlayed.slice(0, 10)} → ${d.lastPlayed.slice(0, 10)}` : '';
  const full = d ? d.coverage.draws : 0;
  const flag = (on: boolean, btn: string, label: string): string => toggle({ label, on, size: 'sm', dataBtn: btn, className: 'csflag' });
  return `
    <div class="framebar csfilters">
      ${seg('Section', 'meta-cs-section', v.section, [['cards', 'Cards'], ['elements', 'Elements'], ['highlights', 'Highlights'], ['game', 'Games']])}
      <span class="framespacer"></span>
      <span class="zonelabel">format</span>
      ${seg('Format', 'meta-cs-mode', v.mode, [['all', 'both'], ['draft', 'draft'], ['constructed', 'constructed']] as [Mode, string][])}
      <span class="zonelabel">played</span>
      ${seg('Played', 'meta-cs-range', v.range, [['all', 'ever'], ['30', 'last 30 days'], ['7', 'last 7 days']] as [Range, string][])}
    </div>
    <div class="framebar csline">
      ${d ? `<span class="hint">
        <b>${d.games}</b> game${d.games === 1 ? '' : 's'} · ${d.seatGames} seats${span ? ` · ${span}` : ''}
        · <b>${full}</b> of ${d.seatGames} seats have every draw on record
        <span class="dim" title="Hands and draws are read from each game's own record. An older game that no longer replays on today's rules still says what was played and drafted, but not what was drawn, so it counts toward Played and not toward GIH.">(why?)</span>
        ${v.mine ? ' · <b>your games only</b>' : ''}</span>` : ''}
      <span class="framespacer"></span>
      ${flag(v.rated, 'meta-cs-rated', 'rated only')}
      ${flag(v.bothSigned, 'meta-cs-signed', 'both signed in')}
      ${v.signedIn ? flag(v.mine, 'meta-cs-mine', 'my games') : ''}
    </div>`;
}

// ── 1. the card table ─────────────────────────────────────────────────

function tableHtml(v: CardStatsView): string {
  const rows = shown(v);
  const cs = colsFor(v.mode);
  const csg = v.data?.constructedSeatGames ?? 0;
  const head = cs.map(c =>
    `<th class="csnum"><button class="cssort${v.sortKey === c.key ? ' on' : ''}" data-btn="meta-cs-sort" data-v="${c.key}" title="${esc(c.tip)}">${c.label}${
      v.sortKey === c.key ? (v.sortDir < 0 ? ' ▾' : ' ▴') : ''}</button></th>`).join('');
  return `
    <div class="framebar">
      <input id="meta-cs-q" class="dksearch" spellcheck="false" placeholder="find a card" value="${esc(v.text)}">
      ${seg('Kind', 'meta-cs-kind', v.kind, [['all', 'all'], ['unit', 'units'], ['spell', 'spells']])}
      <div class="dkfilters">
        ${ELEMENTS.map(el => `<button class="elchip ${el}${v.els.includes(el) ? ' on' : ''}" data-btn="meta-cs-el" data-v="${el}">${elIcon(el)}${el}</button>`).join('')}
        ${v.els.length || v.text || v.kind !== 'all' || v.minGames > 1 ? '<button data-btn="meta-cs-clear">Clear</button>' : ''}
      </div>
      <span class="framespacer"></span>
      ${minGamesHtml(v)}
    </div>
    <div class="dkwork cswork">
      <div class="dkworkmain cstablewrap" data-scroll="cs-table">
        <table class="cstable">
          <thead><tr><th class="cscard">Card <span class="dim">${rows.length}</span></th>${head}</tr></thead>
          <tbody>${rows.map(c => `<tr class="${v.focus === c.card ? 'on' : ''}"><td class="cscard">${cardName(c.card)}</td>${cs.map(col => col.cell(c, csg)).join('')}</tr>`).join('')}</tbody>
        </table>
        ${!rows.length ? '<p class="hint">No card matches that.</p>' : ''}
      </div>
      ${v.focus ? `<div class="cbside" data-scroll="cs-focus-${esc(v.focus)}">${detailHtml(v, v.focus)}</div>` : ''}
    </div>`;
}

/** the "at least N games" stepper, on the card table and over the highlights */
function minGamesHtml(v: CardStatsView): string {
  return `<span class="csstep"><span class="zonelabel">min games</span>
    <button data-btn="meta-cs-min" data-v="-1" aria-label="fewer">−</button><b class="csmin">${v.minGames}</b><button data-btn="meta-cs-min" data-v="1" aria-label="more">+</button></span>`;
}

// ── 2. one card ───────────────────────────────────────────────────────

/** Horizontal bars, one row each, scaled to the biggest — a funnel or a
 * breakdown. `cls` colours the fill; the number is always printed. */
function bars(items: [string, number, string?][], cls = ''): string {
  const max = Math.max(1, ...items.map(([, v]) => v));
  return `<div class="csbars">${items.map(([label, v, note]) => `
    <div class="csbar"><span class="csbarlabel">${esc(label)}</span>
      <span class="csbartrack"><span class="csbarfill ${cls}" style="width:${((100 * v) / max).toFixed(1)}%"></span></span>
      <span class="csbarval">${v}${note ? ` <small>${esc(note)}</small>` : ''}</span></div>`).join('')}</div>`;
}

function tile(label: string, w: Wr, tip: string): string {
  const x = wrOf(w);
  return `<div class="cstile" style="${wrTint(x)}" title="${esc(tip)}"><span class="cstilelabel">${label}</span>
    <b>${x === null ? '·' : pct(x)}</b><small>${w.n} game${w.n === 1 ? '' : 's'}</small></div>`;
}

function detailHtml(v: CardStatsView, name: string): string {
  const c = v.data?.cards.find(x => x.card === name);
  const body = !c
    ? '<p class="hint">No finished game under these filters has this card in it.</p>'
    : (() => {
      const i = iwd(c);
      const hist = c.turnHist.map((n, t) => [t, n] as [number, number]).filter(([t]) => t > 0);
      const lastTurn = Math.max(0, ...hist.filter(([, n]) => n).map(([t]) => t));
      return `
      <div class="cstiles">
        ${tile('in hand', c.gih, 'win rate when it was in hand at any point')}
        ${tile('opening hand', c.oh, 'win rate when it was in the opening hand')}
        ${tile('played', c.played, 'win rate when it was played or cast')}
        ${tile('never seen', c.gns, 'win rate when it was in the deck or pool and never held')}
      </div>
      <p class="hint">${i === null ? 'Not enough to compare holding it with not seeing it.'
        : `Holding it: <b>${i > 0 ? '+' : ''}${(i * 100).toFixed(0)} points</b> against the games it sat unseen.`}</p>
      ${c.offered ? `<h4>In the draft</h4>${bars([
        ['in packs you drafted from', c.offered],
        ['taken', c.picked, c.offered ? pct(rate(c.picked, c.offered)) : ''],
        ['given back from hand', c.given],
      ], 'pick')}
      ${c.picked ? `<p class="hint">Taken on average at pick <b>${fix(rate(c.pickPosSum, c.picked))}</b> of a pack's life (0 fresh, 2 twice passed).</p>` : ''}` : ''}
      ${c.deck.n ? `<h4>In constructed</h4>${bars([
        ['decks that ran it', c.deck.n, `${fix(rate(c.deckCopies, c.deck.n))} copies`],
        ['bottomed in the draw step', c.bottomed],
      ], 'deck')}` : ''}
      <h4>What happened to it</h4>
      ${bars([
        ['held (copies)', c.copiesSeen],
        ['played', c.timesPlayed],
        ['recycled for a resource', c.recycled],
      ], 'fate')}
      ${lastTurn ? `<h4>First played on turn</h4>
        <div class="cshist">${hist.filter(([t]) => t <= lastTurn).map(([t, n]) => {
          const max = Math.max(1, ...hist.map(([, v]) => v));
          return `<div class="cshistcol" title="turn ${t}${t === hist.length ? '+' : ''}: ${n}"><span class="cshistbar" style="height:${((100 * n) / max).toFixed(0)}%"></span><small>${t}${t === hist.length ? '+' : ''}</small></div>`;
        }).join('')}</div>` : ''}`;
    })();
  return cardPanelHtml(name, { close: 'meta-cs-unfocus', extra: `<div class="csdetail">${body}</div>` });
}

// ── 3. elements ───────────────────────────────────────────────────────

function elementsHtml(v: CardStatsView): string {
  const d = v.data!;
  const maxPick = Math.max(1, ...d.elements.map(e => e.picked));
  const maxPlay = Math.max(1, ...d.elements.map(e => e.played));
  const sorted = [...d.elements].sort((a, b) => (wrOf(b.seat) ?? -1) - (wrOf(a.seat) ?? -1));
  const wrBar = (w: Wr): string => {
    const x = wrOf(w);
    if (x === null) return '<span class="dim">·</span>';
    // a bar drawn FROM the 50% line, left for below and right for above
    const off = Math.abs(x - 0.5) * 100;
    return `<span class="cswrbar"><span class="cswrmid"></span><span class="cswrfill ${x >= 0.5 ? 'up' : 'down'}" style="${
      x >= 0.5 ? `left:50%;width:${off}%` : `left:${50 - off}%;width:${off}%`}"></span></span>`;
  };
  const pair = (a: string, b: string): Wr | null => d.pairs[a === b ? a : [a, b].join('+')] ?? d.pairs[[b, a].join('+')] ?? null;
  return `
    <p class="hint">A player's colours are the elements that make up at least a quarter of what they
      played (draft) or brought (constructed). Both draft players share one trio, so the trio itself
      always wins half its games; what differs is which part of it each player leaned on.</p>
    <div class="cstablewrap cselementswrap"><table class="cstable cselements">
      <thead><tr><th>Element</th><th class="csnum">Win rate</th><th></th><th class="csnum">Picked</th><th class="csnum">Played</th></tr></thead>
      <tbody>${sorted.map(e => `<tr>
        <td><span class="acctel ${e.el}">${elIcon(e.el)}${e.el}</span></td>
        ${wrCell(e.seat)}
        <td class="cswrcell">${wrBar(e.seat)}</td>
        <td class="cssharecell"><span class="csshare"><span class="csbarfill el-${e.el}" style="width:${((100 * e.picked) / maxPick).toFixed(0)}%"></span></span><small>${e.picked.toFixed(0)}</small></td>
        <td class="cssharecell"><span class="csshare"><span class="csbarfill el-${e.el}" style="width:${((100 * e.played) / maxPlay).toFixed(0)}%"></span></span><small>${e.played.toFixed(0)}</small></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <h3>Colour pairs</h3>
    <p class="hint">Each cell is the win rate of players whose colours were that pair (the diagonal: one colour only), with the number of games under it.</p>
    <div class="cspairwrap"><table class="cspairs">
      <thead><tr><th></th>${ELEMENTS.map(e => `<th title="${e}">${elIcon(e, e)}</th>`).join('')}</tr></thead>
      <tbody>${ELEMENTS.map((a, i) => `<tr><th title="${a}">${elIcon(a, a)}</th>${ELEMENTS.map((b, j) => {
        if (j < i) return '<td class="csblank"></td>';
        const w = pair(a, b);
        if (!w || !w.n) return '<td class="cspair dim">·</td>';
        return `<td class="cspair" style="${wrTint(wrOf(w))}" title="${a === b ? a : `${a} + ${b}`}: ${w.w} won of ${w.n}">${pct(wrOf(w))}<small>${w.n}</small></td>`;
      }).join('')}</tr>`).join('')}</tbody>
    </table></div>
    ${Object.keys(d.trios).length ? `<h3>Draft trios</h3>
      <div class="cstrios">${Object.entries(d.trios).sort((a, b) => b[1] - a[1]).map(([t, n]) =>
        `<span class="cstrio">${t.split('+').map(e => elIcon(e, e)).join('')}<b>${n}</b></span>`).join('')}</div>` : ''}`;
}

// ── 4. highlights ─────────────────────────────────────────────────────

function board(title: string, tip: string, list: CsCard[], val: (c: CsCard) => string, sub: (c: CsCard) => string): string {
  return `<div class="csboard"><h4 title="${esc(tip)}">${title}</h4>${list.length
    ? `<ol>${list.map(c => `<li><button class="csboardrow" data-btn="meta-cs-focus" data-card="${esc(c.card)}" data-prev="${esc(c.card)}">
        ${thumb(c.card)}<span class="csboardname">${esc(c.card)}</span><b>${val(c)}</b><small>${sub(c)}</small></button></li>`).join('')}</ol>`
    : '<p class="hint">Nothing yet.</p>'}</div>`;
}

function highlightsHtml(v: CardStatsView): string {
  const all = v.data!.cards;
  const csg = v.data!.constructedSeatGames;
  const N = 8;
  const top = (f: (c: CsCard) => boolean, key: (c: CsCard) => number, dir = -1): CsCard[] =>
    all.filter(f).sort((a, b) => (key(a) - key(b)) * dir || b.games - a.games).slice(0, N);
  const m = Math.max(1, v.minGames);
  const gihWr = (c: CsCard): number => wrOf(c.gih) ?? 0;
  const pr = (c: CsCard): number => rate(c.picked, c.offered) ?? 0;
  const gamesSub = (w: Wr) => `${w.w}–${w.n - w.w}`;
  return `
    <div class="framebar">
      <span class="hint">Every list counts only cards with at least ${v.minGames} game${v.minGames === 1 ? '' : 's'} behind the number.</span>
      <span class="framespacer"></span>
      ${minGamesHtml(v)}
    </div>
    <div class="csboards">
      ${board('Best in hand', 'highest win rate when held', top(c => c.gih.n >= m, gihWr), c => pct(wrOf(c.gih)), c => gamesSub(c.gih))}
      ${board('Worst in hand', 'lowest win rate when held', top(c => c.gih.n >= m, gihWr, 1), c => pct(wrOf(c.gih)), c => gamesSub(c.gih))}
      ${board('Biggest swing', 'improvement when drawn: holding it against never seeing it', top(c => c.gih.n >= m && c.gns.n >= m && iwd(c) !== null, c => iwd(c)!), c => `${iwd(c)! > 0 ? '+' : ''}${(iwd(c)! * 100).toFixed(0)}pp`, c => `${c.gih.n} / ${c.gns.n}`)}
      ${board('Best when played', 'highest win rate when played or cast', top(c => c.played.n >= m, c => wrOf(c.played) ?? 0), c => pct(wrOf(c.played)), c => gamesSub(c.played))}
      ${board('First picks', 'most often taken out of a pack you drafted from', top(c => c.offered >= m, pr), c => pct(pr(c)), c => `${c.picked} of ${c.offered}`)}
      ${board('Passed over', 'most copies left in the pack', top(c => c.offered >= m, c => c.offered - c.picked), c => String(c.offered - c.picked), c => `of ${c.offered}`)}
      ${board('Least drafted', 'lowest pick rate', top(c => c.offered >= m, pr, 1), c => pct(pr(c)), c => `${c.picked} of ${c.offered}`)}
      ${board('Given back', 'most often moved from a hand into a pack', top(c => c.given > 0 && c.games >= m, c => c.given), c => String(c.given), c => `${c.games} games`)}
      ${board('Most played', 'most copies played or cast', top(c => c.timesPlayed > 0 && c.games >= m, c => c.timesPlayed), c => String(c.timesPlayed), c => `${c.played.n} games`)}
      ${board('Best mana', 'most copies recycled for a resource', top(c => c.recycled > 0 && c.games >= m, c => c.recycled), c => String(c.recycled), c => `${c.games} games`)}
      ${board('Most main-decked', 'constructed decks that ran it', top(c => c.deck.n >= m, c => c.deck.n), c => String(c.deck.n), c => pct(deckRate(c, csg)))}
      ${board('Sent to the bottom', 'most copies bottomed in the constructed draw step', top(c => c.bottomed > 0 && c.games >= m, c => c.bottomed), c => String(c.bottomed), c => `${c.games} games`)}
    </div>`;
}

// ── 5. the games themselves ───────────────────────────────────────────

function gameHtml(v: CardStatsView): string {
  const d = v.data!;
  const turns = Object.entries(d.turns).map(([t, n]) => [Number(t), n] as [number, number]).sort((a, b) => a[0] - b[0]);
  const maxT = Math.max(1, ...turns.map(([, n]) => n));
  const src: Record<string, string> = {
    live: 'recorded as played', 'replay-sigs': 'replayed and proven by its board fingerprints',
    'replay-refs': 'replayed and checked card by card', refs: 'read from what each player did (older rules)', none: 'decklists only',
  };
  return `
    <div class="cstiles">
      ${tile('on the play', d.onPlay, 'win rate of the player who had initiative on turn 1')}
      <div class="cstile"><span class="cstilelabel">games</span><b>${d.games}</b><small>${d.seatGames} seats</small></div>
    </div>
    <h3>How long games run</h3>
    <div class="cshist cshistwide">${turns.map(([t, n]) =>
      `<div class="cshistcol" title="${n} game${n === 1 ? '' : 's'} over in ${t} turn${t === 1 ? '' : 's'}"><small class="cshistn">${n}</small><span class="cshistbar" style="height:${((100 * n) / maxT).toFixed(0)}%"></span><small>${t}</small></div>`).join('')}</div>
    <p class="hint">turns per game</p>
    <h3>Where the numbers come from</h3>
    <p class="hint">Every finished game counts except custom-rules games, Single Card Duels and games conceded on the first turn.
      Each game's cards are read from its own record:</p>
    <ul class="cssources">${Object.entries(d.sources).sort((a, b) => b[1] - a[1]).map(([k, n]) =>
      `<li><b>${n}</b> ${esc(src[k] ?? k)}</li>`).join('')}</ul>`;
}

// ── the page ──────────────────────────────────────────────────────────

/** The tab, in the frame (pages/frame.ts): the filters fixed at the top, and
 * the section under them scrolling inside itself — the card table in its own
 * box with the pinned card beside it, the other sections as one column. */
export function cardStatsHtml(v: CardStatsView): string {
  const body = v.data ? (v.section === 'cards' ? tableHtml(v)
    : `<div class="csscroll" data-scroll="cs-${esc(v.section)}">${v.section === 'elements' ? elementsHtml(v)
      : v.section === 'highlights' ? highlightsHtml(v) : gameHtml(v)}</div>`) : '';
  return frameHtml({
    page: 'cspage', title: 'Metagame',
    back: { dataBtn: 'meta-close', label: 'Home' },
    centerHtml: v.tabs, chrome: v.chrome, fill: true,
    mainHtml: `${headerHtml(v)}
    ${v.msg ? `<div class="acctmsg">${esc(v.msg)}</div>` : ''}
    ${v.loading && !v.data ? '<p class="hint">loading…</p>' : ''}
    ${body}`,
  });
}

/** Paint the tab into `app` and wire its filter box. Typing keeps the caret:
 * a repaint replaces the input under it (the same problem cards.ts documents
 * at repaintKeepingCaret). */
export function paintCardStats(app: HTMLElement, v: CardStatsView, setText: (text: string) => void,
  rerender: () => void): void {
  paintFrame(app, cardStatsHtml(v));
  const box = document.getElementById('meta-cs-q') as HTMLInputElement | null;
  if (box) box.oninput = () => {
    setText(box.value);
    const at = box.selectionStart;
    rerender();
    const after = document.getElementById('meta-cs-q') as HTMLInputElement | null;
    if (after) { after.focus(); if (at !== null) after.setSelectionRange(at, at); }
  };
}
