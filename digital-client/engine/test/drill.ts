/**
 * THE CARD DRILL — a deterministic driver that plays ONE named card through
 * the engine's own action path, in a real game, and reports what happened.
 *
 * WHY THIS EXISTS
 *
 * The owner's complaint, verbatim: "we keep running into non functional
 * cards… I'm tired of coming across cards that just don't even do what
 * they're supposed to."
 *
 * Two nets already existed and neither could catch that class:
 *
 *  - `65-effect-conformance` is FUZZ-driven, so it only ever sees the cards a
 *    random walk happens to reach. Measured on 2026-08-23: 143 of the 424
 *    cards with effects were NEVER driven, not once, across 140 fuzz games.
 *    An effect that never runs can never be caught being silent.
 *  - `71-card-ledger` reads a card's SHAPE. That catches `events: []` and an
 *    empty `run`, but a card whose run collects a target, names a player and
 *    then quietly does nothing reads as working code.
 *
 * The gap between them is the card that LOOKS alive, is never driven, and
 * does nothing in a real game. That is the Harbinger class, and it is what
 * this file drives out.
 *
 * WHAT "the exact code that would appear in a game" MEANS HERE
 *
 * The drill never calls an effect's `run` directly and never pokes state to
 * simulate a cast. It puts the card in a hand, walks the real game forward,
 * and plays it with the `playCard` action the UI sends — chosen out of
 * `legalActions`, so the engine's own legality is what decides when the card
 * may be played. Everything after that is the ordinary stack: priority is
 * passed, decisions are answered, the item resolves. If a card cannot be
 * reached this way it is not castable in a real game either, and that is a
 * finding rather than a limitation of the harness.
 */
import { apply, createGame, legalActions, IllegalAction } from '../src/apply.ts';
import { getCard } from '../src/cards/dsl.ts';
import { E } from '../src/engine.ts';
import { checkInvariants } from './fuzz.ts';
import type { Action, Element, GameState, Seat } from '../src/types.ts';

const ELEMENTS: Element[] = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];

export interface DrillResult {
  card: string;
  /** the card became a legal `playCard` at some window and was played */
  played: boolean;
  /** the play resolved off the stack (or was a permanent that entered play) */
  resolved: boolean;
  /** engine events emitted from the moment of the play onward */
  events: string[];
  /** event TYPES, for asserting something other than a log line happened */
  types: string[];
  /** how the drill ended */
  outcome: 'resolved' | 'never-legal' | 'stuck' | 'crash' | 'illegal';
  /** populated on 'crash' / 'illegal' */
  error?: string;
  /** the action that broke, if any */
  badAction?: Action;
  /** phases at which the card was seen as a legal play */
  windows: string[];
  /** entities on the board that were not there before the play */
  newEntities: string[];
  /** a compact description of what changed in the game state */
  changed: string[];
  /** events emitted strictly from the resolution of THIS card onward — the
   *  card's own effect, with the "plays → stack" bookkeeping stripped */
  effectEvents: string[];
  /** event TYPES emitted from this card's own resolution onward — what the
   *  card DID, in the engine's own vocabulary rather than in prose */
  effectTypes: string[];
  /** the effect announced a guard ("… — nothing happens."). Legitimate, but
   *  it means the drill did NOT observe the card's payload, so a human has to
   *  say whether the condition should have been met. */
  guarded: boolean;
}

/** every resource kind open, in bulk, so affinity and mana are never the
 *  reason a card cannot be reached. Prismites cover hybrid pip costs. */
function fundSeat(s: GameState, seat: Seat): void {
  const rs = s.players[seat]!.resources;
  rs.length = 0;
  for (const el of ELEMENTS) for (let i = 0; i < 6; i++) rs.push({ kind: el, state: 'open' });
  for (let i = 0; i < 6; i++) rs.push({ kind: 'prismite', state: 'open' });
}

/** a snapshot of the things a card could plausibly change */
function snapshot(s: GameState, seat: Seat) {
  // effective stats and attributes, NOT just base: nearly every pump spell in
  // the pool grants "+N/+N until regroup", which touches no counter and no
  // damage. Reading effStats/ownAttrs is what makes those visible as a change
  // — without it Might of the Grove, Overbloom, Burgeon and a dozen others
  // read as inert here while working perfectly.
  const e = new E(s);
  const stats = Object.values(s.entities).map(u => {
    try { return `${u.id}:${e.effStats(u).join('/')}:${[...e.ownAttrs(u)].sort().join(',')}`; }
    catch { return `${u.id}:?`; }
  }).join('|');
  return {
    stats,
    // control changes, rot and debt are all "the card worked" and none of them
    // touch a stat, a counter or a zone count (Download, Rebalance, Fester,
    // Spellbind, Reap the Due all read as inert without these)
    control: Object.values(s.entities).map(u => `${u.id}:${u.controller}:${u.region}`).join('|'),
    rot: s.players.map(p => p.rot ?? 0),
    debt: s.players.map(p => p.debt ?? 0),
    life: s.players.map(p => p.life),
    hand: s.players.map(p => p.hand.length),
    bin: s.players.map(p => p.bin.length),
    cache: s.players.map(p => (p.cache ?? []).length),
    entities: new Set(Object.keys(s.entities)),
    counters: JSON.stringify(Object.values(s.entities).map(x => [x.card, x.counters, x.damage])),
    stack: s.stack.length,
  };
}

/**
 * What the CARD did, with what PLAYING it necessarily does taken out.
 *
 * A spell leaves your hand and lands in your bin whatever its text says, so
 * counting those two as "something happened" would make every card in the
 * pool look alive — which is how Collect Remains and Tilling the Graves first
 * read as inert here: their real effect (a card moving bin→hand) was exactly
 * cancelled by the spell's own migration hand→bin.
 */
function diff(a: ReturnType<typeof snapshot>, b: ReturnType<typeof snapshot>, card?: string, s?: GameState): string[] {
  const out: string[] = [];
  const self = card ? 1 : 0;
  for (const k of ['life', 'hand', 'bin', 'cache', 'rot', 'debt'] as const) {
    const av = a[k].slice(), bv = b[k].slice();
    if (k === 'hand' && card) av[0] = (av[0] ?? 0) - self;      // the card left hand
    if (k === 'bin' && card && s && s.players[0]!.bin.includes(card)) av[0] = (av[0] ?? 0) + self;
    if (JSON.stringify(av) !== JSON.stringify(bv)) out.push(`${k}: ${JSON.stringify(av)}→${JSON.stringify(bv)}`);
  }
  if (a.entities.size !== b.entities.size) out.push(`entities: ${a.entities.size}→${b.entities.size}`);
  if (a.counters !== b.counters) out.push('unit counters/damage changed');
  if (a.stats !== b.stats) out.push('unit stats/attributes changed');
  if (a.control !== b.control) out.push('unit control/region changed');
  return out;
}

/**
 * A board that gives a targeted card something to point at.
 *
 * Almost every "never legal" result in the first run of this drill was a
 * spell that is correctly uncastable with nothing on the table — `castable()`
 * refuses a cast with no legal target, which is the engine being right. So the
 * drill seeds a real, ordinary mid-game position instead of an empty one:
 * bodies for both seats, cards in both bins, cards in both caches. Vanilla
 * units are used on purpose (Tidal Menace, The Foretold — no text, no attrs,
 * no triggers), so nothing the drill observes can be the SEEDING acting rather
 * than the card under test.
 */
export function seedBoard(s: GameState, seat: Seat): void {
  const e = new E(s);
  const foe = (1 - seat) as Seat;
  for (const who of [seat, foe] as Seat[]) {
    // Bubb is here for its 6 defense ("target unit with 4 or more defense" —
    // Throw off a Cliff had no legal target without it) and Curio Drifter for
    // its type-line [Augment] (Reconfigure needs an augmentABLE target).
    for (const body of ['Tidal Menace', 'The Foretold', 'Unit Token', 'Bubb', 'Curio Drifter']) {
      try { e.spawnUnit(who, body, e.homeRegion(who), body === 'Unit Token' ? { token: true } : {}); } catch { /* not registered */ }
    }
    // a stocked bin (exhume / "target card in a bin" / trash costs) and a
    // stocked cache (R41 targets) — real cards, so the zones are well-formed
    const p = s.players[who]!;
    // a cheap unit (Resurrect: "cost 2 or less") and a real SPELL (Delver of
    // Mysteries: "target spell in your bin") — a bin of only expensive units
    // is not a bin those cards can see
    p.bin.push('Tidal Menace', 'The Foretold', 'Curio Drifter', 'Immolate');
    p.hand.push('Tidal Menace');
    (p.cache ??= []).push({ uid: 9000 + who, card: 'The Foretold' } as never);
  }
  try { e.settle(); } catch { /* a spawn trigger may suspend; the board is still seeded */ }
}

/**
 * Drive the game until `card` is playable by `seat`, play it, and resolve.
 *
 * `mode` picks which play mode we are drilling — the ordinary cast, the
 * [Ambush] alternative, or the "Discard me" line — because those are three
 * different pieces of card text and a card can be alive in one and dead in
 * another.
 */
export function drillCard(
  card: string,
  seed = 900_000,
  opts: {
    mode?: 'ambush' | 'discardMe';
    maxSteps?: number;
    setup?: (s: GameState, seat: Seat) => void;
    /** put an OPPONENT-controlled effect on the stack before drilling.
     *  Eleven cards in the pool ("Negate target effect", "Change the targets
     *  of target effect", "Recall target spell effect") are uncastable with an
     *  empty stack, and correctly so — without bait they all report
     *  "never legal" and look broken when they are not. */
    bait?: boolean;
  } = {},
): DrillResult {
  const maxSteps = opts.maxSteps ?? 600;
  const res: DrillResult = {
    card, played: false, resolved: false, events: [], types: [],
    outcome: 'never-legal', windows: [], newEntities: [], changed: [],
    effectEvents: [], effectTypes: [], guarded: false,
  };
  let { state } = createGame(seed);
  const seat: Seat = 0;
  (opts.setup ?? seedBoard)(state, seat);

  let before = snapshot(state, seat);
  let playedAt = -1;
  const BAIT = 'Protective Adaptations';   // b1, one plain unit target
  let baited = false;

  for (let step = 0; step < maxSteps; step++) {
    if (state.phase === 'gameover') break;
    try { checkInvariants(state); } catch (err) {
      res.outcome = 'crash'; res.error = `invariant: ${(err as Error).message}`; return res;
    }

    // keep the card in hand and the seat solvent at every window: a previous
    // window may have shuffled the hand, and resources expend as they are used
    if (!res.played) {
      const hand = state.players[seat]!.hand;
      if (!hand.includes(card)) hand.push(card);
      fundSeat(state, seat);
    }

    // ── the opponent's bait effect, so a counterspell has something to hit ─
    let chosen: Action | null = null;
    let isBait = false;
    if (opts.bait && !baited && !res.played && state.phase === 'battle' && !state.decision) {
      const foe = (1 - seat) as Seat;
      const fh = state.players[foe]!.hand;
      if (!fh.includes(BAIT)) fh.push(BAIT);
      fundSeat(state, foe);
      const bi = fh.indexOf(BAIT);
      const bp = safeLegal(state, foe).find(a => a.type === 'playCard' && a.handIndex === bi && !a.mode);
      if (bp) { chosen = bp; baited = true; isBait = true; }
    }

    if (!chosen && !res.played) {
      const idx = state.players[seat]!.hand.indexOf(card);
      const legal = safeLegal(state, seat);
      const play = legal.find(a =>
        a.type === 'playCard' && a.handIndex === idx && (a.mode ?? undefined) === opts.mode);
      if (play) {
        res.windows.push(`${state.phase}${state.battle ? `/${state.battle.step}` : ''}`);
        // snapshot AT the play, so the delta is the card's doing and not the
        // drill's board-keeping
        before = snapshot(state, seat);
        chosen = play;
      }
    }

    // ── otherwise take the action that moves the game along ────────────
    if (!chosen) chosen = progressAction(state, res.played ? seat : undefined);
    if (!chosen) { res.outcome = res.played ? 'resolved' : 'stuck'; break; }

    // the BAIT is a playCard too — counting it as "the card was played" is
    // what made all fifteen bait-drilled cards report a resolution they never
    // had, with the bait's own delta attributed to them
    const wasPlay = chosen.type === 'playCard' && !isBait;
    try {
      const r = apply(state, chosen);
      state = r.state;
      for (const ev of r.events) {
        if (res.played || wasPlay) {
          if (ev.msg) res.events.push(ev.msg);
          res.types.push(ev.type);
          // everything after the "Resolving <card>:" marker is the payload
          if (ev.msg && /nothing happens|no legal|nothing to/i.test(ev.msg)) res.guarded = true;
        }
      }
    } catch (err) {
      if (err instanceof IllegalAction) {
        // legalActions offered it and apply refused: that is a real defect
        res.outcome = 'illegal'; res.error = (err as Error).message; res.badAction = chosen; return res;
      }
      res.outcome = 'crash'; res.error = (err as Error).stack ?? String(err); res.badAction = chosen; return res;
    }

    if (wasPlay) { res.played = true; playedAt = step; }

    // once played, stop as soon as the stack is empty and nothing is pending
    if (res.played && !state.decision && state.stack.length === 0 && step > playedAt) {
      res.resolved = true; res.outcome = 'resolved'; break;
    }
  }

  if (res.played && res.outcome === 'never-legal') res.outcome = 'resolved';
  const marker = res.events.findIndex(m => m.startsWith(`Resolving ${card}`));
  res.effectEvents = marker >= 0 ? res.events.slice(marker + 1) : [];
  // The TYPE stream is what the semantic pass reads. It is deliberately taken
  // from the whole post-play window rather than from after the "Resolving"
  // marker: a card's payload legitimately arrives via a trigger that resolves
  // AFTER its own item leaves the stack (a spawn trigger, an after-combat
  // clause), and cutting at the marker would score those cards as doing
  // nothing when they did exactly what they print.
  res.effectTypes = res.types.slice();
  const after = snapshot(state, seat);
  res.changed = diff(before, after, card, state);
  for (const [id, e] of Object.entries(state.entities)) {
    if (!before.entities.has(id)) res.newEntities.push(e.card);
  }
  return res;
}

function safeLegal(s: GameState, seat: Seat): Action[] {
  try { return legalActions(s, seat); } catch { return []; }
}

/**
 * The smallest action that advances the game without making choices for the
 * player we are drilling — except once the card is played, when answering
 * decisions IS the drill (a card that asks a question has to be able to
 * receive its answer).
 */
function progressAction(s: GameState, answerSeat?: Seat): Action | null {
  if (s.decision) {
    const d = s.decision;
    const first = d.options[0];
    if (!first) return null;
    if (d.kind === 'orderTriggers') {
      return { type: 'decide', seat: d.seat, choice: d.options.map((_, i) => i) } as Action;
    }
    // CHOOSE THE BIGGEST X, NOT THE FIRST. The X menu is offered smallest
    // first, so answering with option 0 pays X = 0 — and an X spell cast for
    // zero does nothing BY THE RULES. Eleven cards (Wildfire, Discharge,
    // Soul Siphon, Blight's End, Mindburn, Torrential Reclamation, Channel
    // Through, Floral Singularity …) reported themselves inert here for that
    // reason alone, which is the drill testing the drill.
    let idx = 0;
    const nums = d.options.map(o => typeof o.value === 'number' ? o.value : null);
    if (nums.every(n => n !== null) && nums.length > 1) {
      idx = nums.indexOf(Math.max(...(nums as number[])));
    }
    return { type: 'decide', seat: d.seat, choice: idx } as Action;
  }
  const order: Seat[] = answerSeat !== undefined ? [answerSeat, (1 - answerSeat) as Seat] : [0, 1];
  // prefer the actions that move a phase forward, in a fixed priority, so the
  // drill is deterministic and never wanders into a random board state
  const RANK = ['decide', 'passPriority', 'declareBlocks', 'declareAttack', 'doneHaste', 'donePlanning', 'doneDeploying', 'draftCommit'];
  for (const seat of order) {
    const legal = safeLegal(s, seat);
    for (const want of RANK) {
      // A BATTLE HAS TO ACTUALLY HAPPEN. The first run of this drill declared
      // the empty attack `columns: []` at every declare step, so combat never
      // started, priority was never granted, and every battle-timing card in
      // the pool reported "never legal" — 135 of them, none of which was a
      // real defect. Declaring the FULLEST attack on offer is what opens the
      // battle priority windows those cards are played in.
      if (want === 'declareAttack') {
        const attacks = legal.filter(a => a.type === 'declareAttack');
        if (!attacks.length) continue;
        const size = (a: Action) => a.type === 'declareAttack' ? a.columns.flat().length : 0;
        return attacks.reduce((best, a) => size(a) > size(best) ? a : best);
      }
      // and blocks are declined, so the attack reaches the damage step with
      // its priority windows intact rather than being traded away
      if (want === 'declareBlocks') {
        const blocks = legal.filter(a => a.type === 'declareBlocks');
        if (!blocks.length) continue;
        const size = (a: Action) => a.type === 'declareBlocks' ? Object.keys(a.blocks).length : 99;
        return blocks.reduce((best, a) => size(a) < size(best) ? a : best);
      }
      const hit = legal.find(a => a.type === want);
      if (hit) return hit;
    }
  }
  for (const seat of order) {
    const legal = safeLegal(s, seat);
    if (legal.length) return legal[0]!;
  }
  return null;
}

/** cards the drill should not try to hand-play: they are not hand cards */
export function drillable(name: string): boolean {
  const c = getCard(name);
  if (c.kind === 'spellToken') return false;          // created, never played
  return true;
}
