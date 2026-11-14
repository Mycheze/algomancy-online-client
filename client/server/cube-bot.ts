/* CUBE DRAFT BOTS — the pick heuristic and the suggested deck (docs/25-cube-draft.md §5).
 *
 * A port of the owner's MTG DraftTrainer heuristic (DraftTrainer/app/heuristic.py, "Ben's spec
 * 2026-10-14"), with Magic's words swapped for Algomancy's:
 *
 *   colour  → element (a card's `factions`)        pip   → an affinity letter of `cost` ('rr', 'eb')
 *   creature → unit (kind 'unit' or 'spellUnit')    cmc   → `mana` (an X counts 0, CR 107.3a)
 *   lands   → none (Algomancy has no land cards, so nothing is excluded from voting)
 *
 *   score = 100 × wr + element + bomb + curve + jitter
 *
 * `wr` is the card's game-in-hand win rate shrunk toward 50%: (w + 5) / (n + 10); no data = 0.5.
 * Deliberately slight, as in the original: every adjustment is a few points, so the win rate still
 * decides most picks — and with no data at all (every card 50) the element and curve terms decide.
 *
 * PURE: card facts come from the engine's trusted pool (`getCard`), win rates are passed in, and
 * the only randomness is a jitter hashed from (seed, card) — so a bot's pick is a function of its
 * arguments, and a replayed draft picks the same cards.
 */

import { getCard } from '../engine/src/cards/dsl.ts';
import '../engine/src/cards/registry.ts';   // registers every card before getCard is asked
import { MATCH_COPY_CAP, SIDEBOARD_MAX } from '../engine/src/matchdeck.ts';
import type { Element } from '../engine/src/types.ts';
import { hashSeed } from './league.ts';

export type WinRates = Map<string, { n: number; w: number }>;

// ── the knobs (named as in heuristic.py) ────────────────────────────────────

/** element: points off per element the card needs that the pool doesn't support, ramping from
 *  EMPTY on an empty pool to COMMITTED once the pool holds COMMIT_AFTER elemental cards */
const OFF_ELEMENT_EMPTY = 1.5;
const OFF_ELEMENT_COMMITTED = 6.0;
const COMMIT_AFTER = 12;
/** each affinity of an unsupported element beyond the first, at full commitment ('rr' is a worse
 *  splash than 'r') */
const EXTRA_PIP = 2.0;
/** elements outside the pool's top two count as partly supported, by depth, never more than this */
const THIRD_ELEMENT_SUPPORT = 0.5;

const BOMB_WR = 0.61;
const BOMB_BONUS = 1.0;
const BOMB_BONUS_MAX = 2.0;

/**
 * curve: units by mana slot (5 = five or more) for a 30-card deck.
 *
 * Measured on the five Single-Box Battle Decks (server/default-decks.json), units per slot
 * 1/2/3/4/5+: Fire 5/10/2/2/1, Water 2/3/10/3/3, Earth 7/12/2/3/2, Wood 6/6/4/0/1,
 * Metal 2/9/6/1/0 — 17 to 26 units of 30, mean ≈ 20, weighted to the 1–3 drops.
 * The targets are that mean rounded: 4 / 7 / 5 / 2 / 2 = 20 units.
 *
 * A unit gets up to CURVE_BONUS when the pool's on-element units at its slot are behind
 * target × min(1, pool / CURVE_BY). MTG builds 23 from 42 picks and meets the curve by pick 28;
 * a cube player keeps ~30 of ~39, so nearly every pick is a deck card and the curve is due by
 * the end: CURVE_BY = 30. No curve bonus before CURVE_FROM picks (docs/25 §5: "from pick 14"),
 * where power and element decide.
 */
const CURVE_TARGET: Record<number, number> = { 1: 4, 2: 7, 3: 5, 4: 2, 5: 2 };
const CURVE_BONUS = 1.5;
const CURVE_BY = 30;
const CURVE_FROM = 14;

const JITTER = 0.5;
/** the deck autoBuild aims for: the deck rule's minimum (CR 901.9b's checkDeck) */
const MAIN_SIZE = 30;

/** affinity letter → element (verified over DECK_LIST: each letter appears only on its element) */
const PIP: Record<string, Element> = {
  r: 'fire', b: 'water', e: 'earth', g: 'wood', m: 'metal', l: 'light', d: 'dark',
};
const ELEMENTS: Element[] = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];

// ── card facts ──────────────────────────────────────────────────────────────

interface Facts {
  elements: Element[];
  /** one entry per affinity letter; a card with none needs each of its elements once */
  pips: Element[];
  unit: boolean;
  slot: number;            // 1..5
}

const FACTS = new Map<string, Facts>();

function facts(name: string): Facts {
  let f = FACTS.get(name);
  if (f) return f;
  try {
    const c = getCard(name);
    const elements = [...(c.factions ?? [])] as Element[];
    let pips = [...String(c.cost ?? '')].map(ch => PIP[ch]).filter((e): e is Element => !!e);
    if (!pips.length) pips = [...elements];
    const mana = typeof c.mana === 'number' ? c.mana : 0;
    f = {
      elements, pips,
      unit: c.kind === 'unit' || c.kind === 'spellUnit',
      slot: Math.min(5, Math.max(1, mana)),
    };
  } catch {
    f = { elements: [], pips: [], unit: false, slot: 1 };   // unknown name: neutral, never a crash
  }
  FACTS.set(name, f);
  return f;
}

function winRate(wr: WinRates, name: string): number {
  const r = wr.get(name);
  if (!r || !(r.n >= 0)) return 0.5;
  return (r.w + 5) / (r.n + 10);
}

/** in [-JITTER, +JITTER], a pure function of (seed, card) */
function jitter(seed: number, name: string): number {
  return ((hashSeed(`${seed >>> 0}|${name}`) / 4294967296) * 2 - 1) * JITTER;
}

// ── reading the pool ────────────────────────────────────────────────────────

type Support = Record<Element, number>;

/** (support per element 0..1, commitment 0..1): the two deepest elements are fully supported, any
 *  other the pool has cards in is supported by depth up to THIRD_ELEMENT_SUPPORT */
function support(picks: string[]): { sup: Support; commit: number } {
  const counts = Object.fromEntries(ELEMENTS.map(e => [e, 0])) as Support;
  let elemental = 0;
  for (const p of picks) {
    const f = facts(p);
    if (f.elements.length) elemental++;
    for (const e of f.elements) counts[e]++;
  }
  const ranked = ELEMENTS.filter(e => counts[e] > 0).sort((a, b) => counts[b] - counts[a]);
  const sup = Object.fromEntries(ELEMENTS.map(e => [e, 0])) as Support;
  const deepest = ranked.length ? counts[ranked[0]!] : 0;
  ranked.forEach((e, i) => { sup[e] = i < 2 ? 1 : THIRD_ELEMENT_SUPPORT * counts[e] / deepest; });
  return { sup, commit: Math.min(1, elemental / COMMIT_AFTER) };
}

/** how castable a card is from the pool's elements, 0..1: its worst affinity; elementless = 1 */
function fit(f: Facts, sup: Support): number {
  return f.pips.reduce((m, e) => Math.min(m, sup[e]), 1);
}

/** on-element units in the pool by curve slot */
function curveHave(picks: string[], sup: Support): Map<number, number> {
  const have = new Map<number, number>();
  for (const p of picks) {
    const f = facts(p);
    if (f.unit && fit(f, sup) >= 1) have.set(f.slot, (have.get(f.slot) ?? 0) + 1);
  }
  return have;
}

// ── the score ───────────────────────────────────────────────────────────────

/** Every card of the pack scored for a bot holding `picks`, best first (ties: pack order). */
export function scorePack(pack: string[], picks: string[], wr: WinRates, seed: number): { card: string; score: number }[] {
  const { sup, commit } = support(picks);
  const have = curveHave(picks, sup);
  const bombs = picks.filter(p => winRate(wr, p) >= BOMB_WR).map(p => facts(p).elements);
  const per = OFF_ELEMENT_EMPTY + (OFF_ELEMENT_COMMITTED - OFF_ELEMENT_EMPTY) * commit;
  const scored = pack.map((card, i) => {
    const f = facts(card);
    // element: each affinity pays for its element; gold cards pay per element
    const need = new Map<Element, number>();
    for (const e of f.pips) need.set(e, (need.get(e) ?? 0) + 1);
    let element = 0;
    for (const [e, n] of need) element -= (1 - sup[e]) * (per + EXTRA_PIP * commit * (n - 1));
    // bomb: sharing an element with a bomb already in the pool
    let bomb = 0;
    if (f.elements.length) {
      const shared = bombs.filter(b => b.some(e => f.elements.includes(e))).length;
      bomb = Math.min(BOMB_BONUS_MAX, BOMB_BONUS * shared);
    }
    // curve: an on-element unit at a slot the pool is short of
    let curve = 0;
    if (f.unit && picks.length >= CURVE_FROM) {
      const target = CURVE_TARGET[f.slot] ?? 0;
      const expected = target * Math.min(1, picks.length / CURVE_BY);
      const short = expected - (have.get(f.slot) ?? 0);
      curve = CURVE_BONUS * fit(f, sup) * Math.max(0, Math.min(1, short));
    }
    const score = 100 * winRate(wr, card) + element + bomb + curve + jitter(seed, card);
    return { card, score, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map(({ card, score }) => ({ card, score }));
}

/** The bot's pick: the best-scored card of the pack. */
export function botPick(pack: string[], picks: string[], wr: WinRates, seed: number): string {
  const best = scorePack(pack, picks, wr, seed)[0];
  if (!best) throw new Error('botPick: an empty pack');
  return best.card;
}

// ── the suggested deck ──────────────────────────────────────────────────────

/**
 * A deck from a drafted pool: the pool's best two elements by score mass (each card's 100 × wr
 * credited to every element it has), every card whose elements lie within those two (monos and
 * the gold cards of exactly that pair), best first to 30; if fewer than 30 are on-element, the
 * next best off-element cards fill it. Side = the next SIDEBOARD_MAX best of what is left.
 * At most MATCH_COPY_CAP copies of a card across both boards. A pool too small for 30 gives a
 * short main deck — the caller's deck check says so.
 */
export function autoBuild(pool: string[], wr: WinRates): { main: string[]; side: string[] } {
  const mass = Object.fromEntries(ELEMENTS.map(e => [e, 0])) as Record<Element, number>;
  for (const p of pool) for (const e of facts(p).elements) mass[e] += 100 * winRate(wr, p);
  const two = new Set(ELEMENTS.filter(e => mass[e] > 0).sort((a, b) => mass[b] - mass[a]).slice(0, 2));

  const ranked = pool.map((card, i) => ({ card, i, s: 100 * winRate(wr, card) }))
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const onElement = (c: string): boolean => {
    const els = facts(c).elements;
    return els.length > 0 && els.every(e => two.has(e));
  };

  const used = new Map<string, number>();
  const taken = new Set<number>();
  const take = (into: string[], want: number, ok: (c: string) => boolean): void => {
    for (const r of ranked) {
      if (into.length >= want) return;
      if (taken.has(r.i) || !ok(r.card)) continue;
      const n = used.get(r.card) ?? 0;
      if (n >= MATCH_COPY_CAP) continue;
      used.set(r.card, n + 1);
      taken.add(r.i);
      into.push(r.card);
    }
  };
  const main: string[] = [];
  take(main, MAIN_SIZE, onElement);
  take(main, MAIN_SIZE, () => true);
  const side: string[] = [];
  take(side, SIDEBOARD_MAX, () => true);
  return { main, side };
}
