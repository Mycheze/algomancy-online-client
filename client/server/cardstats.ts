/* THE CARD STATS FOLD — 17lands-style numbers for every card, out of every
 * finished game's card ledger (cardledger.ts).
 *
 * Same shape as cardladder.ts: a structural input (a history row with its
 * ledger joined on), a pure fold, no I/O. api-cardstats.ts does the reading
 * and the caching; cardstats-cli.ts prints the same fold as a table.
 *
 * THE UNIT IS THE SEAT-GAME — one player's side of one game. Every rate below
 * is a count of seat-games over a count of seat-games, and each denominator
 * counts ONLY the seat-games whose ledger can vouch for the fact it needs
 * (`Coverage`). A game read from refs alone knows what was played but not
 * what was drawn, so it is a game in which "never saw it" is unknown — it
 * counts toward Played and not toward GIH, GNS or IWD.
 *
 * RAW NUMBERS, BY THE OWNER'S CHOICE (2026-09-27): no shrinkage, no
 * intervals. Every win rate travels as {n, w} and the page prints both. With
 * a few dozen games most cards are a handful of seat-games; the page says so
 * by printing the n, not by hiding the number.
 *
 * Draft is Algomancy's live draft — both seats draft from ONE trio's pool, so
 * a trio's win rate is 50% by construction. A draft seat's COLOURS are what
 * it actually played (`identity`), which is what the element table ranks.
 *
 * Standing BL-13 rule (ui/meta.ts header): nothing here reconstructs a deck.
 * These are facts about cards, never a decklist nobody registered.
 */
import type { CardName, Element, GameMode, Seat } from '../engine/src/types.ts';
import { canonicalCardName } from '../engine/src/cards/dsl.ts';
import { draftPool } from '../engine/src/draftdeal.ts';
import { concessionWeight, type Concession } from './concession.ts';
import { factionsOf, type GameLedger, type LedgerSource, type SeatLedger } from './cardledger.ts';

export const ELEMENTS: Element[] = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];

/** The part of a history row (accounts.ts RecordedGame) the fold reads, with
 * the game's ledger joined on by code. */
export interface StatsGame {
  code: string;
  playedAt: string;
  mode: GameMode;
  els: Element[];
  finished: boolean;
  winner: Seat | null;
  turns: number;
  users: [string | null, string | null];
  rated?: boolean;
  concession?: Concession;
  custom?: unknown;
  single?: unknown;
  ledger: GameLedger;
}

export interface CardStatsFilter {
  mode: 'draft' | 'constructed' | 'all';
  /** inclusive, YYYY-MM-DD, on playedAt's UTC day */
  from?: string;
  to?: string;
  /** matchmaker games only */
  rated?: boolean;
  /** both seats signed in */
  bothSignedIn?: boolean;
  /** an account id: fold only that account's own seats */
  me?: string | null;
}

/** A raw win rate: games (seat-games) and wins. The page divides. */
export interface Wr { n: number; w: number }

export interface CardRow {
  card: CardName;
  /** seat-games the card figured in at all (held, played, offered, or decked) */
  games: number;
  /** Game In Hand: held at any point (draws-coverage seat-games) */
  gih: Wr;
  /** in the opening hand */
  oh: Wr;
  /** reached the hand after the opening (a draw or a pick) */
  drawn: Wr;
  /** played or cast at least once */
  played: Wr;
  /** Game Not Seen: in the pool/deck and never in hand (draws-coverage) */
  gns: Wr;
  /** copies held, in the seat-games where every draw is known */
  copiesSeen: number;
  /** of the GIH seat-games, how many it was also played in — the play
   * rate's numerator, from the same games as its denominator */
  gihPlayed: number;
  timesPlayed: number;
  /** copies recycled / bottomed in every game that knows what was done
   * (the leaderboards), and in the full-coverage games only (the numerator
   * that goes over `copiesSeen` — a rate's two halves from the same games) */
  recycled: number;
  bottomed: number;
  recycledFull: number;
  bottomedFull: number;
  /** the first-played turn over the seat-games it was played in */
  firstTurnSum: number;
  firstTurnN: number;
  /** first-played turn histogram, index = turn (capped at TURN_CAP) */
  turnHist: number[];
  /** draft: copies offered in a pack you drafted from, taken, given back */
  offered: number;
  picked: number;
  pickPosSum: number;
  given: number;
  /** constructed: seat-games whose deck ran it, and copies across them */
  deck: Wr;
  deckCopies: number;
}

export interface ElementRow { el: Element; seat: Wr; picked: number; played: number }

export interface CardStatsResult {
  filter: CardStatsFilter;
  games: number;
  seatGames: number;
  /** seat-games per coverage fact — the denominators the page explains */
  coverage: { open: number; draws: number; plays: number; picks: number; init: number };
  sources: Partial<Record<LedgerSource, number>>;
  firstPlayed: string | null;
  lastPlayed: string | null;
  cards: CardRow[];
  /** per element: seat-games whose colours include it */
  elements: ElementRow[];
  /** element pairs (and monos, keyed by one element), by a seat's colours */
  pairs: Record<string, Wr>;
  /** draft: games per trio (a trio's own win rate is 50% by construction) */
  trios: Record<string, number>;
  /** had initiative on turn 1 */
  onPlay: Wr;
  /** games by length in turns */
  turns: Record<number, number>;
  /** the constructed seat-games, the main-deck rate's denominator */
  constructedSeatGames: number;
}

export const TURN_CAP = 12;

/** Is this game a result the card stats may count? */
export function eligible(g: StatsGame, f: CardStatsFilter): boolean {
  if (!g.finished || (g.winner !== 0 && g.winner !== 1)) return false;
  if (g.custom || g.single) return false;
  if (concessionWeight(g) === 'walkover') return false;
  if (g.mode !== 'draft' && g.mode !== 'constructed') return false;   // 'shared' is a test table
  if (f.mode !== 'all' && g.mode !== f.mode) return false;
  const day = g.playedAt.slice(0, 10);
  if (f.from && day < f.from) return false;
  if (f.to && day > f.to) return false;
  if (f.rated && !g.rated) return false;
  if (f.bothSignedIn && (!g.users[0] || !g.users[1])) return false;
  if (f.me && g.users[0] !== f.me && g.users[1] !== f.me) return false;
  return true;
}

/** A seat's colours: the elements carrying at least a quarter of its weight
 * (what it played in draft; its deck in constructed), in wheel order. */
export function identity(weights: Partial<Record<Element, number>>): Element[] {
  const total = ELEMENTS.reduce((n, e) => n + (weights[e] ?? 0), 0);
  if (!total) return [];
  return ELEMENTS.filter(e => (weights[e] ?? 0) / total >= 0.25);
}

function deckWeights(deck: Record<CardName, number>): Partial<Record<Element, number>> {
  const w: Partial<Record<Element, number>> = {};
  for (const [card, k] of Object.entries(deck)) {
    const f = factionsOf(card);
    for (const el of f) w[el] = (w[el] ?? 0) + k / f.length;
  }
  return w;
}

const poolCache = new Map<string, Set<CardName>>();
function poolOf(els: Element[]): Set<CardName> {
  const key = [...els].sort().join('+');
  let p = poolCache.get(key);
  if (!p) { try { p = new Set(draftPool(els)); } catch { p = new Set(); } poolCache.set(key, p); }
  return p;
}

const has = (c: Record<CardName, number>, card: CardName): boolean => (c[card] ?? 0) > 0;

export function foldCardStats(games: readonly StatsGame[], filter: CardStatsFilter): CardStatsResult {
  const rows = new Map<CardName, CardRow>();
  const row = (raw: CardName): CardRow => {
    const card = canonicalCardName(raw);
    let r = rows.get(card);
    if (!r) {
      r = {
        card, games: 0, gih: { n: 0, w: 0 }, oh: { n: 0, w: 0 }, drawn: { n: 0, w: 0 }, played: { n: 0, w: 0 },
        gns: { n: 0, w: 0 }, copiesSeen: 0, gihPlayed: 0, timesPlayed: 0, recycled: 0, bottomed: 0, recycledFull: 0, bottomedFull: 0,
        firstTurnSum: 0, firstTurnN: 0, turnHist: Array<number>(TURN_CAP + 1).fill(0),
        offered: 0, picked: 0, pickPosSum: 0, given: 0, deck: { n: 0, w: 0 }, deckCopies: 0,
      };
      rows.set(card, r);
    }
    return r;
  };
  const tally = (wr: Wr, won: boolean): void => { wr.n++; if (won) wr.w++; };

  const out: CardStatsResult = {
    filter, games: 0, seatGames: 0,
    coverage: { open: 0, draws: 0, plays: 0, picks: 0, init: 0 },
    sources: {}, firstPlayed: null, lastPlayed: null, cards: [],
    elements: ELEMENTS.map(el => ({ el, seat: { n: 0, w: 0 }, picked: 0, played: 0 })),
    pairs: {}, trios: {}, onPlay: { n: 0, w: 0 }, turns: {}, constructedSeatGames: 0,
  };
  const elRow = new Map(out.elements.map(e => [e.el, e]));

  for (const g of games) {
    if (!eligible(g, filter)) continue;
    const L = g.ledger;
    out.games++;
    out.sources[L.source] = (out.sources[L.source] ?? 0) + 1;
    if (!out.firstPlayed || g.playedAt < out.firstPlayed) out.firstPlayed = g.playedAt;
    if (!out.lastPlayed || g.playedAt > out.lastPlayed) out.lastPlayed = g.playedAt;
    out.turns[g.turns] = (out.turns[g.turns] ?? 0) + 1;
    if (g.mode === 'draft') {
      const key = [...g.els].sort((a, b) => ELEMENTS.indexOf(a) - ELEMENTS.indexOf(b)).join('+');
      out.trios[key] = (out.trios[key] ?? 0) + 1;
    }
    const cov = L.coverage;
    const pool = g.mode === 'draft' && cov.draws ? poolOf(g.els) : null;

    for (const seat of [0, 1] as Seat[]) {
      if (filter.me && g.users[seat] !== filter.me) continue;
      const s: SeatLedger = L.seats[seat]!;
      const won = g.winner === seat;
      out.seatGames++;
      if (cov.open) out.coverage.open++;
      if (cov.draws) out.coverage.draws++;
      if (cov.plays) out.coverage.plays++;
      if (cov.picks && g.mode === 'draft') out.coverage.picks++;
      if (cov.init && L.init !== null) { out.coverage.init++; if (L.init === seat) tally(out.onPlay, won); }
      if (g.mode === 'constructed') out.constructedSeatGames++;

      // colours: what the seat played in draft, what it brought in constructed
      const ids = identity(g.mode === 'constructed' ? deckWeights(s.deck) : s.elements);
      for (const el of ids) tally(elRow.get(el)!.seat, won);
      if (ids.length === 1 || ids.length === 2) {
        const key = ids.join('+');
        tally(out.pairs[key] ??= { n: 0, w: 0 }, won);
      }

      // every card this seat-game touched, once
      const touched = new Set<CardName>([
        ...Object.keys(s.seen), ...Object.keys(s.played), ...Object.keys(s.offered), ...Object.keys(s.deck),
        ...Object.keys(s.recycled), ...Object.keys(s.bottomed),
      ]);
      for (const card of touched) {
        const r = row(card);
        r.games++;
        if (cov.draws) {
          if (has(s.seen, card)) {
            tally(r.gih, won);
            r.copiesSeen += s.seen[card]!;
            if (has(s.played, card)) r.gihPlayed++;
            // a copy beyond the opening's reached the hand later
            if (s.seen[card]! > (s.open[card] ?? 0)) tally(r.drawn, won);
          }
          r.recycledFull += s.recycled[card] ?? 0;
          r.bottomedFull += s.bottomed[card] ?? 0;
        }
        if (cov.plays) {
          r.recycled += s.recycled[card] ?? 0;
          r.bottomed += s.bottomed[card] ?? 0;
        }
        if (cov.open && has(s.open, card)) tally(r.oh, won);
        if (cov.plays && has(s.played, card)) {
          tally(r.played, won);
          r.timesPlayed += s.played[card]!;
          const t = s.firstTurn[card];
          if (t !== undefined && cov.turns) {
            r.firstTurnSum += t; r.firstTurnN++;
            r.turnHist[Math.min(t, TURN_CAP)]!++;
          }
        }
        if (cov.picks && g.mode === 'draft') {
          r.offered += s.offered[card] ?? 0;
          r.picked += s.picked[card] ?? 0;
          r.pickPosSum += s.pickPos[card] ?? 0;
          r.given += s.given[card] ?? 0;
        }
        if (g.mode === 'constructed' && has(s.deck, card)) {
          tally(r.deck, won);
          r.deckCopies += s.deck[card]!;
        }
      }
      // Game Not Seen: in this seat's deck (constructed) or its trio's pool
      // (draft) and never in its hand — only where every draw is known
      if (cov.draws) {
        const universe = g.mode === 'constructed' ? Object.keys(s.deck) : pool ? [...pool] : [];
        for (const card of universe) if (!has(s.seen, card)) tally(row(card).gns, won);
      }
      for (const [card, k] of Object.entries(s.picked)) {
        const f = factionsOf(card);
        for (const el of f) elRow.get(el)!.picked += k / f.length;
      }
      for (const [el, w] of Object.entries(s.elements)) elRow.get(el as Element)!.played += w ?? 0;
    }
  }
  // a card that was only ever "not seen" is a pool card nobody met — it
  // stays, with games 0, so the page can list the untouched too
  out.cards = [...rows.values()].sort((a, b) => b.games - a.games || (a.card < b.card ? -1 : 1));
  return out;
}
