/* THE CARD LEDGER — which cards each player held, drew, took, passed, played,
 * recycled and bottomed, in one game. What the Card Stats page is folded from.
 *
 * A saved game is a seed and an action log, and the obvious way to know what
 * was in somebody's hand is to replay it. For an OLD game that is exactly the
 * wrong way: a replay onto a newer engine can become a different game without
 * refusing anything (replay-drift-is-silent), and a DRAFT game's deal is a
 * function of the card registry's order and size, so any card added since it
 * was played reshuffles its packs, its hands and its initiative. A statistic
 * read off that replay would be about games nobody played, and nothing would
 * say so.
 *
 * So the facts are TAKEN AS THE GAME IS PLAYED, by the engine playing it, and
 * written into the game file beside `sigs` (rooms.ts: Room.cardLog /
 * Room.cardOpen). ⚠ A RECORDED ENTRY IS NEVER RECOMPUTED — same rule, same
 * reason as `sigs`. For a file that predates the record, `ledgerForFile`
 * climbs a ladder and says which rung it stood on (`source`), and which facts
 * that rung can vouch for (`coverage`):
 *
 *   live         the file's own record, complete. Everything is known.
 *   replay-sigs  a replay on THIS engine whose every board fingerprint matched
 *                the one recorded as the game was played. Same game, proven.
 *   replay-refs  no fingerprints, but every action's R191 zone delta (what it
 *                moved through the actor's own zones, in card names) matched.
 *                Weaker: it checks only the actor's zones, action by action.
 *   refs         the replay could not be trusted, so the refs are read as
 *                text. What the ACTOR did is exact (plays, recycles, bottoms,
 *                picks, the pack they picked from); draws and opening hands
 *                are unknown, and the turn is counted, not read.
 *   none         nothing to read but a constructed decklist.
 *
 * Every metric's denominator counts only the games whose coverage includes
 * the fact it needs (cardstats.ts) — a refs-only game is not a game in which
 * a card was "not seen".
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Action, CardName, Element, EngineEvent, GameMode, GameState, Seat } from '../engine/src/types.ts';
import { apply, IllegalAction, sanitizeTrio } from '../engine/src/apply.ts';
import { getCard } from '../engine/src/cards/dsl.ts';
import { sanitizeDraftDeal } from '../engine/src/draftdeal.ts';
import { engineVersion } from './engine-version.ts';
import { digest, signature } from './replay-probe.ts';
import { dealScenario } from './scenarios.ts';
import { parseRef, zoneDelta } from './zonedelta.ts';

// ── what is written into the game file ────────────────────────────────

/**
 * Where a card was or went. One letter each, because this is written once
 * per action into every game file forever:
 *   D deck · H hand · P pack · B bin · C cache · R resource (recycled)
 *   U under (bottomed, constructed) · X into play / onto the stack
 *   S prophesied · ? anything else (a discard, an effect)
 */
export type Zone = 'D' | 'H' | 'P' | 'B' | 'C' | 'R' | 'U' | 'X' | 'S' | '?';
export type Move = [seat: Seat, card: CardName, from: Zone, to: Zone];

/** One action's card facts. `m` only lists moves across the edge of a hand,
 * plus a card played straight out of the bin or the cache. */
export interface CardFact {
  /** the game turn the action was taken on */
  t: number;
  m?: Move[];
  /** draftCommit only: who drafted, the physical pack's serial, how many
   * merges it had seen before this one (0 = fresh), and every card in it */
  pk?: [seat: Seat, serial: number, commitsBefore: number, offered: CardName[]];
}

/** The board before the first action: who had initiative, and each hand as
 * it stood at the first decision (draft 6; constructed the 4 dealt plus turn
 * 1's draw of 4, before the first bottom; shared 7). */
export interface CardOpen { init: Seat; hands: [CardName[], CardName[]] }

const FROM: Record<string, Zone> = { deck: 'D', bin: 'B', play: 'X', stack: 'X', cache: 'C', hand: 'H' };

export function cardOpen(dealt: GameState): CardOpen {
  return {
    init: dealt.initiative,
    hands: [[...(dealt.players[0]?.hand ?? [])], [...(dealt.players[1]?.hand ?? [])]],
  };
}

/** The card(s) an action names, read out of the PRE-action state (an index
 * means nothing afterwards), with where each comes from and goes to. */
function named(s: GameState, a: Action): { cards: CardName[]; from: Zone; to: Zone } | null {
  const p = s.players[a.seat];
  if (!p) return null;
  const one = (c: CardName | undefined, from: Zone, to: Zone) => (c ? { cards: [c], from, to } : null);
  const modFrom = (from: 'hand' | 'bin' | 'cache', i: number) =>
    from === 'bin' ? one(p.bin[i], 'B', 'X') : from === 'cache' ? one(p.cache?.[i]?.card, 'C', 'X') : one(p.hand[i], 'H', 'X');
  switch (a.type) {
    case 'playCard': return one(p.hand[a.handIndex], 'H', 'X');
    case 'playCached': return one(p.cache?.[a.index]?.card, 'C', 'X');
    case 'playFromBin': return one(p.bin[a.binIndex], 'B', 'X');
    case 'augment':
    case 'graft': return modFrom(a.from, a.index);
    case 'recycleForResource': return one(p.hand[a.handIndex], 'H', 'R');
    case 'prophesy': return a.from === 'bin' ? one(p.bin[a.index], 'B', 'S') : one(p.hand[a.index], 'H', 'S');
    case 'bottomCards': {
      const cards = a.handIndices.map(i => p.hand[i]).filter((c): c is CardName => !!c);
      return cards.length ? { cards, from: 'H', to: 'U' } : null;
    }
    default: return null;
  }
}

/** multiset helpers over card names */
const bag = (cards: readonly CardName[]): Map<CardName, number> => {
  const m = new Map<CardName, number>();
  for (const c of cards) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
};
const take = (m: Map<CardName, number>, c: CardName): boolean => {
  const k = m.get(c) ?? 0;
  if (k <= 0) return false;
  if (k === 1) m.delete(c); else m.set(c, k - 1);
  return true;
};

/**
 * What one applied action did to the cards. Pure: the state before, the state
 * after, the action, and the events the engine emitted applying it.
 *
 * Entries come from `handEntered` (every route into a hand announces itself —
 * engine.ts toHand — for both seats, inside battle or out). The one route that
 * does not is the draft merge, which is read off the pile here. Exits are the
 * multiset `before + entered − after` per hand; the named card of the actor's
 * action gets its real destination and anything else that left is '?'.
 */
export function cardFact(before: GameState, after: GameState, a: Action, events: readonly EngineEvent[]): CardFact {
  const m: Move[] = [];
  const entered: [CardName[], CardName[]] = [[], []];
  for (const ev of events) {
    if (ev.type !== 'handEntered') continue;
    const d = ev.data ?? {};
    const seat = d.seat === 0 || d.seat === 1 ? d.seat : null;
    if (seat === null || !Array.isArray(d.cards)) continue;
    const from = FROM[String(d.from)] ?? '?';
    for (const c of d.cards as unknown[]) {
      if (typeof c !== 'string') continue;
      entered[seat].push(c);
      m.push([seat, c, from, 'H']);
    }
  }
  let pk: CardFact['pk'];
  const seat = a.seat === 0 || a.seat === 1 ? a.seat : null;
  if (seat !== null && a.type === 'draftCommit') {
    const hand = before.players[seat]?.hand ?? [];
    const pack = before.packs?.[seat] ?? [];
    const back = new Set(a.packIndices);
    for (let i = 0; i < pack.length; i++) {
      if (back.has(hand.length + i)) continue;
      entered[seat].push(pack[i]!);
      m.push([seat, pack[i]!, 'P', 'H']);
    }
    const meta = before.packMeta?.[seat];
    pk = [seat, meta?.serial ?? 0, meta?.commits ?? 0, [...pack]];
  }
  const what = seat !== null && a.type !== 'draftCommit' ? named(before, a) : null;
  for (const s of [0, 1] as Seat[]) {
    const out = bag([...(before.players[s]?.hand ?? []), ...entered[s]!]);
    for (const c of after.players[s]?.hand ?? []) take(out, c);
    if (s === seat && what) {
      for (const c of what.cards) {
        if (what.from === 'H') { if (take(out, c)) m.push([s, c, 'H', what.to]); }
        else m.push([s, c, what.from, what.to]);
      }
    }
    const dest: Zone = s === seat && a.type === 'draftCommit' ? 'P' : '?';
    for (const [c, k] of out) for (let i = 0; i < k; i++) m.push([s, c, 'H', dest]);
  }
  return { t: before.turn, ...(m.length ? { m } : {}), ...(pk ? { pk } : {}) };
}

// ── the per-game ledger ───────────────────────────────────────────────

export type LedgerSource = 'live' | 'replay-sigs' | 'replay-refs' | 'refs' | 'none';

/** Which facts this game's ledger can vouch for. */
export interface Coverage {
  /** the opening hands */
  open: boolean;
  /** every card that entered either hand (so "never saw it" is a fact) */
  draws: boolean;
  /** what the players played, recycled, bottomed */
  plays: boolean;
  /** draft picks and the packs they came from */
  picks: boolean;
  /** turn numbers are the engine's own (false = counted from the log) */
  turns: boolean;
  /** who had initiative on turn 1 */
  init: boolean;
}

type Counts = Record<CardName, number>;

export interface SeatLedger {
  /** constructed: the decklist brought, copies per card */
  deck: Counts;
  /** copies in the opening hand */
  open: Counts;
  /** copies that ever entered the hand: opening + draws + picks + returns */
  seen: Counts;
  /** copies drawn from the deck after the opening */
  drawn: Counts;
  /** draft: copies taken out of a pack / copies seen in a pack you picked from */
  picked: Counts;
  offered: Counts;
  /** draft: sum over picked copies of the pack's commits-before (0 fresh) */
  pickPos: Counts;
  /** draft: copies you moved from your hand into the pack */
  given: Counts;
  /** played or cast, from any zone */
  played: Counts;
  /** the turn each card was FIRST played on */
  firstTurn: Counts;
  recycled: Counts;
  bottomed: Counts;
  prophesied: Counts;
  /** element weight of every card played (a hybrid gives ½ to each) — what a
   * draft seat's colours are read from, since both seats share the trio */
  elements: Partial<Record<Element, number>>;
}

export interface GameLedger {
  v: 1;
  source: LedgerSource;
  coverage: Coverage;
  /** initiative on turn 1, when known */
  init: Seat | null;
  seats: [SeatLedger, SeatLedger];
}

export const LEDGER_V = 1;

const emptySeat = (): SeatLedger => ({
  deck: {}, open: {}, seen: {}, drawn: {}, picked: {}, offered: {}, pickPos: {}, given: {},
  played: {}, firstTurn: {}, recycled: {}, bottomed: {}, prophesied: {}, elements: {},
});

const add = (c: Counts, card: CardName, n = 1): void => { c[card] = (c[card] ?? 0) + n; };

const REAL_ELEMENTS = new Set<string>(['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark']);

/** A played card's weight across its elements; unknown cards give nothing. */
export function factionsOf(card: CardName): Element[] {
  try { return (getCard(card).factions ?? []).filter((f): f is Element => REAL_ELEMENTS.has(f)); } catch { return []; }
}

function creditPlay(s: SeatLedger, card: CardName, turn: number | null): void {
  add(s.played, card);
  if (turn !== null && (s.firstTurn[card] === undefined || turn < s.firstTurn[card]!)) s.firstTurn[card] = turn;
  const f = factionsOf(card);
  for (const el of f) s.elements[el] = (s.elements[el] ?? 0) + 1 / f.length;
}

const FULL: Coverage = { open: true, draws: true, plays: true, picks: true, turns: true, init: true };

/** Fold recorded facts into a ledger. `open` null = the opening is unknown. */
export function ledgerOf(
  open: CardOpen | null, log: readonly CardFact[], decks: readonly (readonly CardName[] | null | undefined)[] | undefined,
  source: LedgerSource, coverage: Coverage = FULL,
): GameLedger {
  const seats: [SeatLedger, SeatLedger] = [emptySeat(), emptySeat()];
  for (const s of [0, 1] as Seat[]) {
    for (const c of decks?.[s] ?? []) add(seats[s]!.deck, c);
    for (const c of open?.hands[s] ?? []) { { const me = seats[s]!; add(me.open, c); add(me.seen, c); } }
  }
  for (const f of log) {
    for (const [s, c, from, to] of f.m ?? []) {
      const me = seats[s];
      if (!me) continue;
      if (to === 'H') {
        add(me.seen, c);
        if (from === 'D') add(me.drawn, c);
        if (from === 'P') { add(me.picked, c); if (f.pk) add(me.pickPos, c, f.pk[2]); }
      } else if (from === 'H' && to === 'P' && f.pk) add(me.given, c);
      if (to === 'X') creditPlay(me, c, f.t);
      else if (to === 'R') add(me.recycled, c);
      else if (to === 'U') add(me.bottomed, c);
      else if (to === 'S') add(me.prophesied, c);
    }
    if (f.pk && (f.pk[0] === 0 || f.pk[0] === 1)) for (const c of f.pk[3]) add(seats[f.pk[0]].offered, c);
  }
  return { v: LEDGER_V, source, coverage, init: coverage.init ? open?.init ?? null : null, seats };
}

// ── reading a saved game file ─────────────────────────────────────────

/** The part of a game file (rooms.ts persist) the ladder reads. */
export interface LedgerFile {
  seed: number;
  mode?: GameMode;
  els?: Element[];
  names?: [string, string];
  actions: Action[];
  decks?: [CardName[] | null, CardName[] | null];
  scenario?: string;
  custom?: { rules?: unknown; deal?: unknown } | null;
  refs?: unknown;
  sigs?: unknown;
  cardLog?: unknown;
  cardOpen?: unknown;
}

/** A recorded fact, or null when the slot is missing or not a fact. The
 * shape check is structural and forgiving on purpose: this reads files. */
export function sanitizeFact(raw: unknown): CardFact | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as CardFact;
  if (typeof f.t !== 'number') return null;
  return f;
}

export function sanitizeOpen(raw: unknown): CardOpen | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as CardOpen;
  if ((o.init !== 0 && o.init !== 1) || !Array.isArray(o.hands) || o.hands.length !== 2) return null;
  if (!o.hands.every(h => Array.isArray(h) && h.every(c => typeof c === 'string'))) return null;
  return { init: o.init, hands: [[...o.hands[0]!], [...o.hands[1]!]] };
}

const strings = (raw: unknown, n: number): (string | null)[] | null => {
  if (!Array.isArray(raw) || raw.length !== n) return null;
  return raw.map(r => (typeof r === 'string' && r ? r : null));
};

/** Why a replay stopped being trusted, for the CLI's audit. */
export interface LedgerAudit { source: LedgerSource; actions: number; validUpTo: number; why: string }

/**
 * The ladder (see the header). Pure over the file's contents; the caller
 * memoises. Returns the ledger and the audit line that explains it.
 */
export function ledgerForFile(raw: LedgerFile): { ledger: GameLedger; audit: LedgerAudit } {
  const n = raw.actions?.length ?? 0;
  const decks = raw.mode === 'constructed' ? raw.decks : undefined;
  const audit = (source: LedgerSource, validUpTo: number, why: string): LedgerAudit => ({ source, actions: n, validUpTo, why });

  // 1. the record
  const log = Array.isArray(raw.cardLog) && raw.cardLog.length === n ? raw.cardLog.map(sanitizeFact) : null;
  const open = sanitizeOpen(raw.cardOpen);
  if (n && log && open && log.every(f => f !== null)) {
    return { ledger: ledgerOf(open, log as CardFact[], decks, 'live'), audit: audit('live', n, 'recorded as played') };
  }

  // 2. a replay, trusted only as far as the record can check it
  const sigs = strings(raw.sigs, n);
  const refs = strings(raw.refs, n);
  const checkable = !!sigs?.some(Boolean) || !!refs;
  let why = 'no fingerprints or refs to check a replay against';
  if (n && checkable) {
    const r = verifiedReplay(raw, sigs, refs);
    if (r.validUpTo === n) {
      const source: LedgerSource = sigs && sigs.every(Boolean) ? 'replay-sigs' : 'replay-refs';
      return { ledger: ledgerOf(r.open, r.facts, decks, source), audit: audit(source, n, 'replay verified to the end') };
    }
    why = r.why;
    if (refs) {
      // the verified prefix is still the game: its opening and its facts
      // stand, and the refs carry on from where the replay stopped matching
      const prefix = r.validUpTo > 0 ? r : null;
      return {
        ledger: refsLedger(refs.map(x => x ?? ''), raw.actions, decks, prefix),
        audit: audit('refs', r.validUpTo, why),
      };
    }
  }
  return {
    ledger: ledgerOf(null, [], decks, 'none', { open: false, draws: false, plays: false, picks: false, turns: false, init: false }),
    audit: audit('none', 0, n ? why : 'no actions'),
  };
}

function verifiedReplay(raw: LedgerFile, sigs: (string | null)[] | null, refs: (string | null)[] | null):
  { open: CardOpen; facts: CardFact[]; validUpTo: number; why: string } {
  const mode: GameMode = raw.mode ?? 'shared';
  const deal = mode === 'draft' ? sanitizeDraftDeal(raw.custom?.deal) : undefined;
  const els = sanitizeTrio(raw.els, deal?.elements ?? 3);
  const decks = mode === 'constructed'
    ? [raw.decks?.[0] ?? raw.decks?.[1], raw.decks?.[1] ?? raw.decks?.[0]] as [CardName[], CardName[]]
    : undefined;
  let state: GameState;
  try {
    if (raw.custom && !deal) throw new Error('custom rules this build cannot read');
    state = dealScenario(raw.seed, raw.names ?? ['Player 1', 'Player 2'], mode, els, decks, raw.scenario, deal).state;
  } catch (err) {
    return { open: { init: 0, hands: [[], []] }, facts: [], validUpTo: 0, why: `could not deal: ${err instanceof Error ? err.message : err}` };
  }
  const open = cardOpen(state);
  const facts: CardFact[] = [];
  for (let i = 0; i < raw.actions.length; i++) {
    const a = raw.actions[i]!;
    const before = state;
    let r;
    try { r = apply(state, a); } catch (err) {
      if (err instanceof IllegalAction) return { open, facts, validUpTo: i, why: `action ${i} (${a.type}) refused: ${err.message}` };
      throw err;
    }
    const sig = sigs?.[i];
    if (sig && digest(signature(r.state)) !== sig) {
      return { open, facts, validUpTo: i, why: `board fingerprint differs at action ${i} (${a.type})` };
    }
    const ref = refs?.[i];
    if (ref && !ref.startsWith('refused:')) {
      const tail = ref.slice(ref.lastIndexOf('|') + 1);
      if (zoneDelta(before, r.state, a.seat) !== tail) {
        return { open, facts, validUpTo: i, why: `cards moved differ at action ${i} (${a.type})` };
      }
    }
    facts.push(cardFact(before, r.state, a, r.events));
    state = r.state;
  }
  return { open, facts, validUpTo: raw.actions.length, why: '' };
}

/**
 * The refs as text. Exact for the ACTING seat — that is what a zone delta is
 * — and blind to everything else: the other seat's draws, the opening deal.
 * The turn is COUNTED: every seat makes exactly one card-step action a turn
 * (a draftCommit in draft, a bottomCards in constructed), so the turn an
 * action was on is how many of those its seat had made. The pack a draft pick
 * came from is `sent back − given + taken`, and its place in the pack's life
 * is the commit count mod 3 (a 1v1 pack is redealt every third turn).
 */
function refsLedger(refs: string[], actions: Action[], decks: LedgerFile['decks'] | undefined,
  prefix: { open: CardOpen; facts: CardFact[]; validUpTo: number } | null): GameLedger {
  const facts: CardFact[] = prefix ? [...prefix.facts] : [];
  const from = prefix?.validUpTo ?? 0;
  const steps: [number, number] = [0, 0];
  for (let i = 0; i < refs.length; i++) {
    const a = actions[i];
    const seat = a?.seat === 0 || a?.seat === 1 ? a.seat : null;
    const ref = refs[i]!;
    if (seat === null || !ref || ref.startsWith('refused:')) continue;
    const p = parseRef(ref);
    if (p.type === 'draftCommit' || p.type === 'bottomCards') steps[seat]++;
    if (i < from) continue;   // the verified replay already said what this did
    const t = Math.max(1, steps[seat]);
    const m: Move[] = [];
    const handIn: CardName[] = [], handOut: CardName[] = [];
    for (const d of p.delta) {
      if (d.z !== 'h') continue;
      for (let k = 0; k < Math.abs(d.k); k++) (d.k > 0 ? handIn : handOut).push(d.card);
    }
    switch (p.type) {
      case 'draftCommit': {
        for (const c of handIn) m.push([seat, c, 'P', 'H']);
        for (const c of handOut) m.push([seat, c, 'H', 'P']);
        const pack = bag(p.named);
        for (const c of handOut) take(pack, c);
        const offered = [...pack.entries()].flatMap(([c, k]) => Array<CardName>(k).fill(c)).concat(handIn);
        facts.push({ t, m, pk: [seat, 0, (steps[seat] - 1) % 3, offered] });
        continue;
      }
      case 'playCard': case 'playCached': case 'playFromBin': {
        const c = p.named[0];
        if (c) m.push([seat, c, p.type === 'playCached' ? 'C' : p.type === 'playFromBin' ? 'B' : 'H', 'X']);
        break;
      }
      case 'augment': case 'graft': {
        // augment|<hand|bin|cache>|i:"Card"|…
        const from = ref.split('|')[1];
        const c = p.named[0];
        if (c) m.push([seat, c, from === 'bin' ? 'B' : from === 'cache' ? 'C' : 'H', 'X']);
        break;
      }
      case 'recycleForResource': if (p.named[0]) m.push([seat, p.named[0], 'H', 'R']); break;
      case 'bottomCards': for (const c of p.named) m.push([seat, c, 'H', 'U']); break;
      case 'prophesy': if (p.named[0]) m.push([seat, p.named[0], 'H', 'S']); break;
      default: break;
    }
    if (m.length) facts.push({ t, m });
  }
  // a verified prefix knows how the game OPENED; nothing knows every draw
  return ledgerOf(prefix?.open ?? null, facts, decks, 'refs',
    { open: !!prefix, draws: false, plays: true, picks: true, turns: false, init: !!prefix });
}

// ── the file reader, memoised ─────────────────────────────────────────

const memo = new Map<string, { key: string; ledger: GameLedger; audit: LedgerAudit }>();

/**
 * The ledger of the saved game `<dir>/<code>.json`, or null when there is no
 * such file. Read-only — a backfill never writes a game file: its mtime IS
 * when the game was played (history.ts). Memoised on the file's size and
 * mtime, and, for anything but a recorded ledger, on the engine too: a
 * replay's verdict is a claim about the engine that ran it.
 */
export function readLedger(dir: string, code: string): { ledger: GameLedger; audit: LedgerAudit } | null {
  const path = join(dir, `${code}.json`);
  let st;
  try { st = statSync(path); } catch { return null; }
  const key = `${st.mtimeMs}:${st.size}:${LEDGER_V}`;
  const hit = memo.get(path);
  if (hit && (hit.key === key || hit.key === `${key}:${engineVersion()}`)) return hit;
  let raw: LedgerFile;
  try { raw = JSON.parse(readFileSync(path, 'utf8')) as LedgerFile; } catch { return null; }
  const r = ledgerForFile(raw);
  const entry = { key: r.audit.source === 'live' ? key : `${key}:${engineVersion()}`, ...r };
  memo.set(path, entry);
  return r;
}
