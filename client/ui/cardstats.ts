/* CARD STATS — the metagame page's third tab: 17lands-style numbers for every
 * card, out of every finished game (server/cardstats.ts, /api/cardstats).
 *
 * ui/meta.ts owns the page (its URL, its tabs, its paint and its clicks) and
 * hands this module the `stats` view: `pageHtml()` is the markup,
 * `handle()` answers every `meta-cs-*` button, `afterPaint()` wires the
 * filter box. The numbers are the server's; this file sorts, filters and
 * draws them, and never re-derives one.
 *
 * RAW NUMBERS (the owner, 2026-09-27): every win rate is printed with the
 * number of games under it and nothing is shrunk or hidden. A 100% over one
 * game says "100% · 1" and the reader judges. The "min games" stepper is a
 * view control, not a statistic.
 *
 * Vocabulary, for a reader who knows 17lands:
 *   GIH     in hand at any point (opening, drawn, or drafted in)
 *   OH      in the opening hand
 *   Drawn   reached the hand after the opening
 *   Played  played or cast at least once
 *   GNS     in your deck (or your draft's pool) and never in your hand
 *   IWD     GIH win rate minus GNS win rate
 * Every rate divides only by the games that KNOW its fact — see the server's
 * coverage note — which is why GIH and Played can have different game counts.
 */
import * as acct from './account.ts';
import { cardPanelHtml } from './cardpanel.ts';
import { rowFor } from './cardindex.ts';
import { artUrl } from './assets.ts';
import { esc, elIcon } from './util.ts';

// ── the wire shape (server/cardstats.ts CardStatsResult) ──────────────

interface Wr { n: number; w: number }
export interface CsCard {
  card: string; games: number;
  gih: Wr; oh: Wr; drawn: Wr; played: Wr; gns: Wr;
  copiesSeen: number; timesPlayed: number; recycled: number; bottomed: number; gihPlayed: number;
  recycledFull: number; bottomedFull: number;
  firstTurnSum: number; firstTurnN: number; turnHist: number[];
  offered: number; picked: number; pickPosSum: number; given: number;
  deck: Wr; deckCopies: number;
}
interface CsElement { el: string; seat: Wr; picked: number; played: number }
export interface CsResult {
  ok: true;
  games: number; seatGames: number;
  coverage: { open: number; draws: number; plays: number; picks: number; init: number };
  sources: Record<string, number>;
  firstPlayed: string | null; lastPlayed: string | null;
  cards: CsCard[]; elements: CsElement[];
  pairs: Record<string, Wr>; trios: Record<string, number>;
  onPlay: Wr; turns: Record<string, number>; constructedSeatGames: number;
  floor: number;
}

type Mode = 'all' | 'draft' | 'constructed';
type Range = 'all' | '30' | '7';
type Section = 'cards' | 'elements' | 'highlights' | 'game';

const ELEMENTS = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];

// ── module state ──────────────────────────────────────────────────────

let repaint: () => void = () => {};
let data: CsResult | null = null;
let loading = false;
let msg = '';
let mode: Mode = 'all';
let range: Range = 'all';
let rated = false;
let bothSigned = false;
let mine = false;
let section: Section = 'cards';
let sortKey = 'games';
let sortDir: 1 | -1 = -1;
let text = '';
const els = new Set<string>();
let kind: 'all' | 'unit' | 'spell' = 'all';
let minGames = 1;
let focus: string | null = null;

export function initCardStats(opts: { repaint: () => void }): void { repaint = opts.repaint; }

/** What the URL remembers — only the card, so a link to one card's numbers works. */
export const focused = (): string | null => focus;

export function open(card?: string | null): void {
  if (card) { focus = card; section = 'cards'; }
  load();
}

const day = (d: Date): string => d.toISOString().slice(0, 10);

function query(): string {
  const q = new URLSearchParams();
  if (mode !== 'all') q.set('mode', mode);
  if (range !== 'all') q.set('from', day(new Date(Date.now() - Number(range) * 86_400_000)));
  if (rated) q.set('rated', '1');
  if (bothSigned) q.set('signed', 'both');
  if (mine) q.set('me', '1');
  return q.toString();
}

function load(): void {
  loading = true;
  msg = '';
  const q = query();
  fetch(`/api/cardstats${q ? `?${q}` : ''}`, { headers: mine ? acct.authHeaders(false) : {} })
    .then(r => r.json() as Promise<CsResult | { ok: false; error: string; games?: number; floor?: number }>)
    .then(r => {
      loading = false;
      if (r.ok) data = r;
      else {
        data = null;
        msg = r.error === 'not enough games'
          ? `Only ${r.games ?? 0} game${r.games === 1 ? '' : 's'} match these filters. Card stats need at least ${r.floor ?? 5}, so nobody's hand from one game is on show — widen the filters.`
          : r.error;
      }
      repaint();
    })
    .catch(() => { loading = false; msg = 'could not reach the server'; repaint(); });
}

// ── numbers ───────────────────────────────────────────────────────────

const rate = (a: number, b: number): number | null => (b ? a / b : null);
const wrOf = (w: Wr): number | null => rate(w.w, w.n);
const iwd = (c: CsCard): number | null => {
  const a = wrOf(c.gih), b = wrOf(c.gns);
  return a === null || b === null ? null : a - b;
};
const pct = (x: number | null, d = 0): string => (x === null ? '' : `${(x * 100).toFixed(d)}%`);
const fix = (x: number | null, d = 1): string => (x === null ? '' : x.toFixed(d));

/** A win rate's tint: a diverging scale around 50% — orange below, cyan above,
 * grey at the middle. The number is always printed, so the colour is never
 * the only thing saying it. */
function wrTint(x: number | null): string {
  if (x === null) return '';
  const d = Math.max(-1, Math.min(1, (x - 0.5) / 0.25));
  const a = (Math.abs(d) * 0.34).toFixed(3);
  return d >= 0 ? `background: rgba(79, 179, 201, ${a})` : `background: rgba(224, 123, 57, ${a})`;
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
  sort: (c: CsCard) => number | null;
  cell: (c: CsCard) => string;
}

const ALL: Mode[] = ['all', 'draft', 'constructed'];
const deckRate = (c: CsCard): number | null => rate(c.deck.n, data?.constructedSeatGames ?? 0);

const COLS: Col[] = [
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
    sort: deckRate, cell: c => numCell(c.deck.n ? pct(deckRate(c)) : '', `${c.deck.n} decks`) },
  { key: 'copies', label: 'Copies', tip: 'average copies in the decks that ran it', modes: ['constructed'],
    sort: c => rate(c.deckCopies, c.deck.n), cell: c => numCell(fix(rate(c.deckCopies, c.deck.n))) },
  { key: 'deckwr', label: 'Deck WR', tip: 'win rate of the decks that ran it', modes: ['constructed'],
    sort: c => wrOf(c.deck), cell: c => wrCell(c.deck) },
  { key: 'bottom', label: 'Bottom %', tip: 'of the copies held, how many were put on the bottom in the draw step', modes: ['constructed'],
    sort: c => rate(c.bottomedFull, c.copiesSeen), cell: c => numCell(pct(rate(c.bottomedFull, c.copiesSeen)), `${c.bottomed} bottomed in all`) },
];

const cols = (): Col[] => COLS.filter(c => c.modes.includes(mode));

// ── filtering and sorting ─────────────────────────────────────────────

function kindOf(card: string): 'unit' | 'spell' | null {
  const k = rowFor(card)?.kind;
  if (!k) return null;
  return k === 'unit' ? 'unit' : 'spell';
}

function shown(): CsCard[] {
  const q = text.trim().toLowerCase();
  const col = COLS.find(c => c.key === sortKey) ?? COLS[0]!;
  return (data?.cards ?? []).filter(c => {
    if (c.games < minGames) return false;
    if (q && !c.card.toLowerCase().includes(q)) return false;
    const r = rowFor(c.card);
    if (els.size && !(r?.factions ?? []).some(f => els.has(f))) return false;
    if (kind !== 'all' && kindOf(c.card) !== kind) return false;
    return true;
  }).sort((a, b) => {
    const x = col.sort(a), y = col.sort(b);
    if (x === null && y === null) return a.card.localeCompare(b.card);
    if (x === null) return 1;             // unknowns sink, whichever way
    if (y === null) return -1;
    return (x - y) * sortDir || b.games - a.games || a.card.localeCompare(b.card);
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

function headerHtml(): string {
  const d = data;
  const span = d?.firstPlayed && d.lastPlayed ? `${d.firstPlayed.slice(0, 10)} → ${d.lastPlayed.slice(0, 10)}` : '';
  const full = d ? d.coverage.draws : 0;
  const chip = (on: boolean, btn: string, label: string, extra = ''): string =>
    `<button class="${on ? 'on' : ''}" data-btn="${btn}"${extra}>${label}</button>`;
  return `
    <div class="cbtools csfilters">
      <span class="zonelabel">format</span>
      ${(['all', 'draft', 'constructed'] as Mode[]).map(m => chip(mode === m, 'meta-cs-mode', m === 'all' ? 'both' : m, ` data-v="${m}"`)).join('')}
      <span class="zonelabel">played</span>
      ${(['all', '30', '7'] as Range[]).map(r => chip(range === r, 'meta-cs-range', r === 'all' ? 'ever' : `last ${r} days`, ` data-v="${r}"`)).join('')}
      <span class="cbspacer"></span>
      ${chip(rated, 'meta-cs-rated', 'rated only')}
      ${chip(bothSigned, 'meta-cs-signed', 'both signed in')}
      ${acct.currentUser() ? chip(mine, 'meta-cs-mine', 'my games') : ''}
    </div>
    ${d ? `<p class="hint csline">
      <b>${d.games}</b> game${d.games === 1 ? '' : 's'} · ${d.seatGames} seats${span ? ` · ${span}` : ''}
      · <b>${full}</b> of ${d.seatGames} seats have every draw on record
      <span class="dim" title="Hands and draws are read from each game's own record. An older game that no longer replays on today's rules still says what was played and drafted, but not what was drawn, so it counts toward Played and not toward GIH.">(why?)</span>
      ${mine ? ' · <b>your games only</b>' : ''}</p>` : ''}
    <div class="cbtools metatabs cssections">
      ${(['cards', 'elements', 'highlights', 'game'] as Section[]).map(s =>
        chip(section === s, 'meta-cs-section', s === 'cards' ? 'Cards' : s === 'elements' ? 'Elements' : s === 'highlights' ? 'Highlights' : 'Games', ` data-v="${s}"`)).join('')}
    </div>`;
}

// ── 1. the card table ─────────────────────────────────────────────────

function tableHtml(): string {
  const rows = shown();
  const cs = cols();
  const head = cs.map(c =>
    `<th class="csnum"><button class="cssort${sortKey === c.key ? ' on' : ''}" data-btn="meta-cs-sort" data-v="${c.key}" title="${esc(c.tip)}">${c.label}${
      sortKey === c.key ? (sortDir < 0 ? ' ▾' : ' ▴') : ''}</button></th>`).join('');
  return `
    <div class="cbtools">
      <input id="meta-cs-q" class="dksearch" spellcheck="false" placeholder="find a card" value="${esc(text)}">
      ${(['all', 'unit', 'spell'] as const).map(k =>
        `<button class="${kind === k ? 'on' : ''}" data-btn="meta-cs-kind" data-v="${k}">${k === 'all' ? 'all' : `${k}s`}</button>`).join('')}
      <span class="cbspacer"></span>
      <span class="zonelabel">min games</span>
      <button data-btn="meta-cs-min" data-v="-1" aria-label="fewer">−</button><b class="csmin">${minGames}</b><button data-btn="meta-cs-min" data-v="1" aria-label="more">+</button>
    </div>
    <div class="dkfilters">
      ${ELEMENTS.map(el => `<button class="elchip ${el}${els.has(el) ? ' on' : ''}" data-btn="meta-cs-el" data-v="${el}">${elIcon(el)}${el}</button>`).join('')}
      ${els.size || text || kind !== 'all' || minGames > 1 ? '<button data-btn="meta-cs-clear">clear</button>' : ''}
    </div>
    <div class="dkwork cswork">
      <div class="dkworkmain cstablewrap">
        <table class="cstable">
          <thead><tr><th class="cscard">Card <span class="dim">${rows.length}</span></th>${head}</tr></thead>
          <tbody>${rows.map(c => `<tr class="${focus === c.card ? 'on' : ''}"><td class="cscard">${cardName(c.card)}</td>${cs.map(col => col.cell(c)).join('')}</tr>`).join('')}</tbody>
        </table>
        ${!rows.length ? '<p class="hint">No card matches that.</p>' : ''}
      </div>
      ${focus ? detailHtml(focus) : ''}
    </div>`;
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

function detailHtml(name: string): string {
  const c = data?.cards.find(x => x.card === name);
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

function elementsHtml(): string {
  const d = data!;
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

function highlightsHtml(): string {
  const all = data!.cards;
  const N = 8;
  const top = (f: (c: CsCard) => boolean, key: (c: CsCard) => number, dir = -1): CsCard[] =>
    all.filter(f).sort((a, b) => (key(a) - key(b)) * dir || b.games - a.games).slice(0, N);
  const m = Math.max(1, minGames);
  const gihWr = (c: CsCard): number => wrOf(c.gih) ?? 0;
  const pr = (c: CsCard): number => rate(c.picked, c.offered) ?? 0;
  const gamesSub = (w: Wr) => `${w.w}–${w.n - w.w}`;
  return `
    <div class="cbtools">
      <span class="hint">Every list counts only cards with at least</span>
      <button data-btn="meta-cs-min" data-v="-1" aria-label="fewer">−</button><b class="csmin">${minGames}</b><button data-btn="meta-cs-min" data-v="1" aria-label="more">+</button>
      <span class="hint">game${minGames === 1 ? '' : 's'} behind the number.</span>
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
      ${board('Most main-decked', 'constructed decks that ran it', top(c => c.deck.n >= m, c => c.deck.n), c => String(c.deck.n), c => pct(deckRate(c)))}
      ${board('Sent to the bottom', 'most copies bottomed in the constructed draw step', top(c => c.bottomed > 0 && c.games >= m, c => c.bottomed), c => String(c.bottomed), c => `${c.games} games`)}
    </div>`;
}

// ── 5. the games themselves ───────────────────────────────────────────

function gameHtml(): string {
  const d = data!;
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

export function pageHtml(tabs: string): string {
  return `<div class="metapage cspage">
    <div class="accthead">
      <div><h1>Card stats</h1>
        <p class="hint">How every card has done, from every game played here. Each percentage has
          its number of games beside it — a small number is a small sample.</p></div>
      <button data-btn="meta-close">Back</button>
    </div>
    ${tabs}
    ${headerHtml()}
    ${msg ? `<div class="acctmsg">${esc(msg)}</div>` : ''}
    ${loading && !data ? '<p class="hint">loading…</p>' : ''}
    ${data ? (section === 'cards' ? tableHtml() : section === 'elements' ? elementsHtml()
      : section === 'highlights' ? highlightsHtml() : gameHtml()) : ''}
  </div>`;
}

export function afterPaint(): void {
  const box = document.getElementById('meta-cs-q') as HTMLInputElement | null;
  if (box) box.oninput = () => {
    text = box.value;
    const at = box.selectionStart;
    repaint();
    const after = document.getElementById('meta-cs-q') as HTMLInputElement | null;
    if (after) { after.focus(); if (at !== null) after.setSelectionRange(at, at); }
  };
}

/** Every `meta-cs-*` button. Returns false for anything else. */
export function handle(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('meta-cs-')) return false;
  const v = btn.dataset['v'] ?? '';
  switch (b) {
    case 'meta-cs-mode': mode = v as Mode; if (!cols().some(c => c.key === sortKey)) sortKey = 'games'; load(); break;
    case 'meta-cs-range': range = v as Range; load(); break;
    case 'meta-cs-rated': rated = !rated; load(); break;
    case 'meta-cs-signed': bothSigned = !bothSigned; load(); break;
    case 'meta-cs-mine': mine = !mine; load(); break;
    case 'meta-cs-section': section = v as Section; break;
    case 'meta-cs-sort':
      if (sortKey === v) sortDir = sortDir < 0 ? 1 : -1;
      else { sortKey = v; sortDir = v === 'firstturn' || v === 'pos' ? 1 : -1; }
      break;
    case 'meta-cs-kind': kind = v as typeof kind; break;
    case 'meta-cs-el': if (els.has(v)) els.delete(v); else els.add(v); break;
    case 'meta-cs-min': minGames = Math.max(1, Math.min(50, minGames + Number(v))); break;
    case 'meta-cs-clear': els.clear(); text = ''; kind = 'all'; minGames = 1; break;
    case 'meta-cs-focus': {
      const card = btn.dataset['card'] ?? '';
      focus = focus === card && section === 'cards' ? null : card;
      section = 'cards';
      break;
    }
    case 'meta-cs-unfocus': focus = null; break;
    default: return false;
  }
  repaint();
  return true;
}
