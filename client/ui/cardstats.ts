/* CARD STATS — the metagame page's third tab: 17lands-style numbers for every
 * card, out of every finished game (server/cardstats.ts, /api/cardstats).
 *
 * ui/meta.ts owns the page (its URL, its tabs, its paint and its clicks) and
 * hands this module the `stats` view. This file keeps the tab's state and its
 * fetch, and `handle()` answers every `meta-cs-*` button; the markup is
 * pages/cardstats.ts (cardStatsView / cardStatsHtml / paintCardStats, the
 * page contract), which also wires the filter box. The numbers are the
 * server's; nothing here or there re-derives one — the page only sorts,
 * filters and draws them.
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
import { colsFor } from './pages/cardstats.ts';
import type { StatusTone } from './components/status.ts';

// ── the wire shape (server/cardstats.ts CardStatsResult) ──────────────

export interface Wr { n: number; w: number }
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

export type Mode = 'all' | 'draft' | 'constructed';
export type Range = 'all' | '30' | '7';
export type Section = 'cards' | 'elements' | 'highlights' | 'game';
export type Kind = 'all' | 'unit' | 'spell';

// ── module state ──────────────────────────────────────────────────────

let repaint: () => void = () => {};
let data: CsResult | null = null;
let loading = false;
let msg = '';
/** how `msg` reads: a refusal (error) or a word on the filters (note) — set only through say() */
let msgTone: StatusTone = 'error';
const say = (text: string, tone: StatusTone): void => { msg = text; msgTone = tone; };
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
let kind: Kind = 'all';
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
        // too few games is not a failure: the filters are too narrow, and
        // the line says how to widen them — drawn as a note, not in red
        if (r.error === 'not enough games') {
          say(`Only ${r.games ?? 0} game${r.games === 1 ? '' : 's'} match these filters. Card stats need at least ${r.floor ?? 5}, so nobody's hand from one game is on show — widen the filters.`, 'note');
        } else say(r.error, 'error');
      }
      repaint();
    })
    .catch(() => { loading = false; say('could not reach the server', 'error'); repaint(); });
}

/** The state the page is drawn from — pages/cardstats.ts cardStatsView()
 * gathers it, cardStatsHtml() draws it. */
export interface CardStatsState {
  data: CsResult | null;
  loading: boolean;
  msg: string;
  /** a refusal in red (error), a word on the filters in the note gold */
  msgTone: StatusTone;
  mode: Mode;
  range: Range;
  rated: boolean;
  bothSigned: boolean;
  mine: boolean;
  section: Section;
  sortKey: string;
  sortDir: 1 | -1;
  text: string;
  els: ReadonlySet<string>;
  kind: Kind;
  minGames: number;
  focus: string | null;
}

export const state = (): CardStatsState => ({
  data, loading, msg, msgTone, mode, range, rated, bothSigned, mine, section, sortKey, sortDir, text, els, kind, minGames, focus,
});

/** the filter box's text, set as it is typed (pages/cardstats.ts paintCardStats) */
export function setText(t: string): void { text = t; }

/** Every `meta-cs-*` button. Returns false for anything else. */
export function handle(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('meta-cs-')) return false;
  const v = btn.dataset['v'] ?? '';
  switch (b) {
    case 'meta-cs-mode': mode = v as Mode; if (!colsFor(mode).some(c => c.key === sortKey)) sortKey = 'games'; load(); break;
    case 'meta-cs-range': range = v as Range; load(); break;
    case 'meta-cs-rated': rated = !rated; load(); break;
    case 'meta-cs-signed': bothSigned = !bothSigned; load(); break;
    case 'meta-cs-mine': mine = !mine; load(); break;
    case 'meta-cs-section': section = v as Section; break;
    case 'meta-cs-sort':
      if (sortKey === v) sortDir = sortDir < 0 ? 1 : -1;
      else { sortKey = v; sortDir = v === 'firstturn' || v === 'pos' ? 1 : -1; }
      break;
    case 'meta-cs-kind': kind = v as Kind; break;
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
