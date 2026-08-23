/* In-memory room store + JSON persistence.
 *
 * A room is one game: an authoritative GameState, the seed + action log (the
 * whole game — docs/04 §1), the full event history (for redacted log resync),
 * and up to two connected sockets (seat 0 and seat 1).
 *
 * Persistence is a plain JSON file per room under server/games/<code>.json
 * holding { seed, names, actions }. On startup rooms are restored by replaying
 * the action log through the engine (replay = seed + actions).
 */
import { readdirSync, readFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// type-only, so rooms.ts gains no runtime dependency on ws — the sockets are
// the real WebSockets main.ts plugs in; this module only checks presence
import type { WebSocket } from 'ws';
import type { Action, CardName, Element, EngineEvent, EntityId, GameMode, GameState, Seat } from '../engine/src/types.ts';
import { apply, checkDeck, createGame, legalActions, sanitizeTrio, IllegalAction } from '../engine/src/apply.ts';
import { other } from './view.ts';
import {
  resolveTrio, sanitizeMethod, sanitizeSubmission, submissionReady,
  type TrioHistoryRow, type TrioMethod, type TrioResult, type TrioSubmission,
} from './trio.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
// ALGO_GAMES_DIR lets a test run against a throwaway directory of saved rooms
const GAMES_DIR = process.env['ALGO_GAMES_DIR'] ?? join(HERE, 'games');

/**
 * The HIDDEN SIMULTANEOUS SEGMENTS — the one place that knows which steps are
 * played behind a screen.
 *
 * Playtest UZRG (2026-08-21): "Planning should be like deployment, entirely
 * divorced from what your opponent is doing. But right now, you can't take
 * back making the wrong resource or recycling the wrong card if your opponent
 * does something (which shouldn't matter) and you can see what your opponent
 * is doing live, so there's technically a reason to wait to see what they do
 * (which there shouldn't be)."
 *
 * So a turn has THREE hidden segments, not one:
 *
 *   'plan'   the resource step  — recycle / activate / exchange / draft /
 *            bottom, ending when both players have hit done planning. Every
 *            one of those actions is confined to the actor's own hand and
 *            resources, fires no triggers, touches no stack, draws no RNG and
 *            allocates no entity ids, so the two seats' actions COMMUTE
 *            (test-hidden.ts asserts it directly) — which is exactly what
 *            makes an undo here always safe.
 *   'haste'  the haste step — plays resolve immediately, no priority, no
 *            responses (R18). Deployment's hazards, and no more.
 *   'deploy' simultaneous deployment, as before.
 *
 * Everything downstream is ONE rule: **the key changed → flush the old
 * segment's reveal, snapshot the new one.** Nothing else in the server knows
 * which phase it is looking at.
 */
export type SegKey = 'plan' | 'haste' | 'deploy';

/** Which hidden segment is this state in, if any? */
export function segmentKey(s: GameState): SegKey | null {
  // hasteEnding: the haste step's end-of-step triggers may suspend on a
  // decision with hasteDone already conceptually spent — the resource step is
  // definitively over, so this is never 'plan' again.
  if (s.phase === 'planning') return (s.hasteDone || s.hasteEnding) ? 'haste' : 'plan';
  if (s.phase === 'deploy') return 'deploy';
  return null;
}

/** Did this action move the id clock or the RNG stream? (the undo gate) */
const movedIdOrRng = (before: GameState, after: GameState): boolean =>
  before.nextId !== after.nextId || before.rngState !== after.rngState;

/* ── WHAT A SPLICE CAN QUIETLY CHANGE, AND HOW WE MEASURE IT ──────────────
 *
 * Undo is a SPLICE: the action leaves the log and seed + the remaining
 * actions is replayed. Everything after the hole therefore re-runs from a
 * different prior state, and the log is replayed VERBATIM — nobody rewrites
 * anyone's payload. So a later action can come out of the rebuild meaning
 * something other than what its author meant, by three routes:
 *
 *   ids     `nextId` is one global clock. Splicing an action that allocated
 *           ids shifts every id after it down. `augment { hostId: 21 }` then
 *           names entity 21, which is now a different unit — or nobody.
 *   zones   the spliced action's EFFECT is gone too. If it made the opponent
 *           draw or discard, their later `playCard { handIndex: 3 }` names a
 *           different card, and stays perfectly legal while doing it.
 *   rng     an action that drew from the stream draws a different number when
 *           the stream is at a different position. The opponent already SAW
 *           that outcome.
 *
 * The old gate predicted all three at once with a blunt proxy — "did the
 * spliced action touch the id clock or the RNG stream, and has the opponent
 * done anything with a payload since" — and the honest cost of that proxy is
 * the report it produced (ledger #76, WEHH 2026-08-22): *"Despite Deployment
 * being entirely separate from the opponent, I can't take back some things …
 * What they do doesn't matter during deployment, so I should always be able
 * to."* Deployment is hidden and simultaneous, so the overwhelmingly common
 * case is two seats deploying units side by side, referring to nothing of
 * each other's — and it was refused, every time, because the opponent had a
 * payload.
 *
 * "Always allow it" is not the answer either: the three routes above are
 * real, and an action that stays LEGAL while meaning something else is worse
 * than a refusal — it is silent corruption, and the rebuild cannot see it,
 * because the rebuild only notices actions that become illegal.
 *
 * So the gate is a MEASUREMENT, not a prediction (the shape RENUMBER_IMMUNE
 * already argued for barriers: a measurement beats a prediction). Every
 * action carries a REFERENCE KEY — what its payload actually pointed at in
 * the state it was applied to, written in terms that survive renumbering:
 * an entity id becomes "the k-th entity the action tagged `t7` created", a
 * hand index becomes the card name at that index, a decision becomes the
 * option's own label. The splice is rebuilt, the keys are recomputed, and the
 * undo is accepted iff every later action still refers to exactly what it
 * referred to before. Nothing else is asked, and nothing wider is refused.
 */

/** Stable per-ACTION-OBJECT label. `actions.splice()` keeps the very same
 * objects, so a tag identifies the same action across the two rebuilds an
 * undo compares — which array position it happens to sit at does not. */
const ACTION_TAG = new WeakMap<object, string>();
let actionTagSeq = 0;
function tagOf(a: Action): string {
  let t = ACTION_TAG.get(a);
  if (!t) { t = `t${++actionTagSeq}`; ACTION_TAG.set(a, t); }
  return t;
}

/**
 * The entity ids an action NAMES in its payload — the references a renumbering
 * re-points. Everything else an action carries is an index into a zone, a
 * choice, or nothing at all.
 *
 * This is the whole list, and it is the reason the old `RENUMBER_IMMUNE`
 * exception list is gone rather than tidied away: its five members
 * (`donePlanning`, `doneHaste`, `doneDeploying`, `passPriority`, `concede`)
 * were exempt precisely because their entire payload is `{ type, seat }`, and
 * that argument — "no id, no index, no choice, so no renumbering can change
 * what it means" — is now made once, generally, by returning nothing for them
 * here and by their reference key being their bare type.
 */
function entityRefs(a: Action): EntityId[] {
  switch (a.type) {
    case 'castSpellToken': return [a.entityId];
    case 'activateAbility':
      return typeof a.via === 'object' && a.via ? [a.entityId, a.via.mod] : [a.entityId];
    case 'augment': return a.hostId === undefined ? [] : [a.hostId];
    case 'graft': return [a.hostId];
    case 'declareAttack': return [...a.columns.flat(), ...(a.spellTokens ?? [])];
    case 'declareBlocks':
      return [...Object.values(a.blocks).flat(), ...(a.send ?? []), ...(a.spellTokens ?? [])];
    default: return [];
  }
}

/** id → "which action created it, and the how-many-th entity of that action" —
 * the identity that survives a renumbering. `floors[j]` is `nextId` as action
 * `j` was applied, so the creator of `id` is the last action whose floor is at
 * or below it. Ids below the first floor came out of the deal. */
function symbolizer(
  actions: readonly Action[], floors: readonly number[], upto: number, nextId: number,
): (id: EntityId) => string {
  return (id: EntityId): string => {
    if (id >= nextId) return `∅${id}`;              // names nothing (the rebuild will refuse it)
    let at = -1;
    for (let j = 0; j < upto; j++) {
      if (floors[j]! <= id) at = j; else break;     // floors is non-decreasing
    }
    if (at < 0) return `deal#${id}`;
    return `${tagOf(actions[at]!)}#${id - floors[at]!}`;
  };
}

/**
 * WHAT this action referred to, in the state it was applied to.
 *
 * Two rebuilds that produce the same key for an action agree about what that
 * action meant; anything else is a difference the author of the action never
 * asked for. Deliberately made of RESOLVED references (the card at the index,
 * the option's label, the entity's creation identity) rather than of the raw
 * payload, which is identical by construction — the payload is what gets
 * replayed verbatim.
 *
 * `drewRng` is the third route: an action that consumed the stream is a
 * function of where the stream stood, so where it stood is part of what it
 * meant. An action that drew nothing is unaffected by a re-roll and does not
 * carry it.
 *
 * And the tail: the OUTCOME the actor was shown. A reference can survive a
 * splice intact while the result does not — in 'shared' mode both seats draw
 * off one deck, so undoing a play that drew a card hands the opponent's later
 * draw a different card without touching any index they named. `zoneDelta`
 * below is the cheapest complete statement of "what this action did to my own
 * private zones", written in card names so that renumbering cannot move it.
 */
function referenceKey(s: GameState, after: GameState, a: Action, sym: (id: EntityId) => string, drewRng: boolean): string {
  const p = s.players[a.seat];
  const at = (z: readonly unknown[] | undefined, i: number): string =>
    `${i}:${z && i >= 0 && i < z.length ? JSON.stringify(z[i]) : '∅'}`;
  const modZone = (from: 'hand' | 'bin' | 'cache'): readonly unknown[] | undefined =>
    from === 'hand' ? p?.hand : from === 'bin' ? p?.bin : p?.cache;
  const parts: string[] = [a.type];
  switch (a.type) {
    case 'recycleForResource': parts.push(at(p?.hand, a.handIndex), a.element); break;
    case 'activateResource': parts.push(at(p?.resources, a.index)); break;
    case 'exchangePrismite': parts.push(at(p?.resources, a.index), a.element); break;
    case 'draftCommit': {
      // the pile draftCommit indexes is hand.concat(pack) — R? the pack lives
      // on the state, so name whatever the merged pile holds at each index
      const pile = [...(p?.hand ?? []), ...(s.packs?.[a.seat] ?? [])];
      parts.push(a.packIndices.map(i => at(pile, i)).join(','));
      break;
    }
    case 'bottomCards': parts.push(a.handIndices.map(i => at(p?.hand, i)).join(',')); break;
    case 'playCard': parts.push(at(p?.hand, a.handIndex), a.mode ?? '-'); break;
    case 'prophesy': parts.push(a.from, at(a.from === 'hand' ? p?.hand : p?.bin, a.index)); break;
    case 'playFromBin': parts.push(at(p?.bin, a.binIndex)); break;
    case 'playCached': parts.push(at(p?.cache, a.index)); break;
    case 'castSpellToken': parts.push(sym(a.entityId)); break;
    case 'activateAbility':
      parts.push(sym(a.entityId), String(a.abilityIndex),
        typeof a.via === 'object' && a.via ? `mod:${sym(a.via.mod)}` : String(a.via ?? '-'));
      break;
    case 'augment':
      parts.push(a.from, at(modZone(a.from), a.index),
        a.hostId === undefined ? '-' : sym(a.hostId),
        a.hostStack === undefined ? '-' : `stack:${at(s.stack, a.hostStack)}`);
      break;
    case 'graft':
      parts.push(a.from, at(modZone(a.from), a.index), sym(a.hostId), String(a.position));
      break;
    case 'declareAttack':
      parts.push(a.columns.map(c => c.map(sym).join('+')).join('|'),
        (a.spellTokens ?? []).map(sym).join(','));
      break;
    case 'declareBlocks':
      parts.push(Object.keys(a.blocks).sort().map(k => `${k}:${a.blocks[Number(k)]!.map(sym).join('+')}`).join('|'),
        (a.send ?? []).map(sym).join(','), (a.spellTokens ?? []).map(sym).join(','));
      break;
    case 'decide': {
      // NEVER the decision's id: R85 takes decision ids off `nextId`, so a
      // renumbering moves them without anything about the decision changing.
      // The kind, the option count and the CHOSEN options' own labels are what
      // the answer meant.
      const d = s.decision;
      const picked = (Array.isArray(a.choice) ? a.choice : [a.choice])
        .map(i => { const o = d?.options[i]; return o ? `${o.label}/${o.card ?? ''}` : '∅'; });
      parts.push(String(d?.kind ?? '-'), String(d?.options.length ?? 0), picked.join(','));
      break;
    }
    // donePlanning / doneHaste / doneDeploying / passPriority / concede name
    // nothing at all: their whole payload is { type, seat }, so their key is
    // their type and no renumbering or re-roll can move it.
    default: break;
  }
  if (drewRng) parts.push(`rng@${s.rngState}`);
  parts.push(zoneDelta(s, after, a.seat));
  return parts.join('|');
}

/** The acting seat's own private zones, as card names — no entity ids, so a
 * renumbering cannot move it. */
function zoneCards(s: GameState, seat: Seat): string[] {
  const p = s.players[seat];
  if (!p) return [];
  return [
    ...p.hand.map(c => `h:${c}`),
    ...p.bin.map(c => `b:${c}`),
    ...(p.cache ?? []).map(c => `c:${JSON.stringify(c)}`),
    ...(p.erased ?? []).map(c => `x:${c}`),
  ];
}

/** What an action MOVED through its own seat's private zones, as a multiset
 * difference. A difference, not a snapshot: the board an action lands on may
 * legitimately differ after an undo (the spliced play's own units are gone,
 * and that is what undo means), but what the action itself did with the
 * actor's cards is theirs and must come out the same. */
function zoneDelta(before: GameState, after: GameState, seat: Seat): string {
  const n = new Map<string, number>();
  for (const c of zoneCards(before, seat)) n.set(c, (n.get(c) ?? 0) - 1);
  for (const c of zoneCards(after, seat)) n.set(c, (n.get(c) ?? 0) + 1);
  return [...n.entries()].filter(([, k]) => k !== 0).sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([c, k]) => `${k > 0 ? '+' : ''}${k}${c}`).join(',');
}

// ── the log's contract, and what happens when it breaks ───────────────
//
// A room file is a claim: **seed + actions reproduces this game**. It is the
// forensic record the whole playtest loop runs on, so when the claim stops
// being true that has to be LOUD.
//
// It stops being true like this. `rebuild()` is deliberately tolerant: an
// action the (possibly newer) engine now rejects is skipped rather than
// killing the room, because losing a live game to a rules tweak is worse than
// a slightly wrong log. But the skipped action STAYS in `actions`, and one
// skip cascades — the state the rest of the log was written against no longer
// exists, so action after action is refused too. Measured on a synthetic
// 60-action game: ONE action becoming illegal cost 28 of the 60, and rolled
// the game back from turn 4 to turn 2. Play then continues from the rolled-
// back board, appending to a log that is now two different games end to end,
// with nothing to mark the join.
//
// Note what is NOT wrong: the skip is deterministic, so `rebuild(seed,
// actions)` still equals the state the players are sitting in. The file is not
// self-contradictory — it is FORKED, and says nothing about it. That silence
// is the bug, and it is what makes a review months later report 79 rejections
// with no way to tell "the rules changed under this game" from "the server
// wrote a log it cannot honour".
//
// The fix is to make the file say so. We do NOT prune the skipped actions,
// even though pruning would restore the literal contract, because those
// actions are the evidence: a forked game is precisely the one you most want
// to inspect, `history.ts` counts the RAW log length so a real game is never
// demoted to a stub, and a rules commit can be reverted — a recorded fork can
// then be re-evaluated, a pruned one is gone. So the contract becomes
// explicit and checkable instead: **seed + actions, minus the forks this file
// declares, reproduces this game.** replay-room.ts verifies exactly that.

/** One logged action a rebuild could not apply. */
export interface LostAction {
  /** index into the room's `actions` */
  i: number;
  type: Action['type'];
  seat: Seat;
  /** the engine's own refusal */
  why: string;
  /**
   * WHICH failure this is, so the refusal a player reads names the real
   * reason instead of a guess (additive; absent on a restore's skip list,
   * which is always 'lost').
   *
   *   'lost'     the action no longer replays at all — the rebuild refused it.
   *   'changed'  the action still replays and is still legal, but it now
   *              REFERS to something else (another unit, another card in hand,
   *              another roll). The dangerous one: nothing downstream would
   *              ever notice, which is exactly why it is measured.
   */
  kind?: 'lost' | 'changed';
}

/** A restore that could not faithfully rebuild a game still being played. */
export interface Fork {
  /** when the restore happened (ISO) */
  at: string;
  /** what the log claimed vs what could actually be replayed */
  logged: number;
  lost: LostAction[];
  /** where the rebuild landed — the board play resumed from */
  turn: number;
  phase: string;
}

/** Two skip sets describe the same fork iff they lost the same indices. */
const sameLoss = (a: LostAction[], b: LostAction[]): boolean =>
  a.length === b.length && a.every((x, i) => x.i === b[i]!.i);

export interface Room {
  code: string;
  seed: number;
  mode: GameMode;
  /** draft mode: the chosen trio (sanitized); ignored in 'shared' */
  els: Element[];
  /** constructed mode: each seat's deck list (null = not brought yet). The
   * game does not really start until both are in — see roomWaiting(). */
  decks: [CardName[] | null, CardName[] | null];
  names: [string, string];
  /** ACCOUNT id per seat (null = whoever sat here was not logged in). Set on
   * join from the token, persisted with the room, and read back when the game
   * is folded into the players' stats — see history.ts. */
  users: [string | null, string | null];
  /**
   * Who won, RECORDED AT THE TIME and persisted — not re-derived.
   *
   * A saved game is replayed to restore it, and an old log replayed onto a
   * newer engine can diverge (R34 re-ordered simultaneous triggers; the log
   * then describes a board that no longer exists). When that happens the
   * replay stops short of the ending, and the game reads as if nobody won —
   * which is how three real wins turned into "five unfinished games". A fact
   * stamped when it happened cannot rot, so this is stickily kept: once set
   * it is never cleared by a replay that fails to reach it.
   */
  winner: Seat | null;
  state: GameState;
  actions: Action[];
  /**
   * Every restore that could NOT faithfully rebuild this game. Persisted.
   *
   * The log's contract is "seed + actions reproduces this game". A tolerant
   * restore breaks it silently: an action the current engine refuses is
   * skipped but LEFT in `actions`, so the file goes on claiming to be a
   * straight-through record of a game it no longer describes. This is the
   * file admitting otherwise — see recordFork().
   */
  forks: Fork[];
  /**
   * Actions the most recent rebuild could not apply. DERIVED (never
   * persisted): it is `forks` restated for the CURRENT engine, and it is what
   * undoActionAt() measures against to guarantee an undo never loses a play.
   */
  lost: LostAction[];
  /** full authoritative event history, for per-seat redacted log resync */
  events: EngineEvent[];
  /** connected client per seat (null = nobody there) */
  sockets: [WebSocket | null, WebSocket | null];
  /** which hidden simultaneous segment is open right now (null = none) */
  segKey: SegKey | null;
  /** the state as of the open segment's start — each seat's view of the
   * OPPONENT is served from this freeze until the segment closes */
  segSnapshot: GameState | null;
  /** events each seat has NOT yet been shown (their opponent's hidden moves
   * this segment); flushed as the "reveal" when the segment closes */
  heldEvents: [EngineEvent[], EngineEvent[]];
  /** index into `actions` where the open segment began (-1 outside one) —
   * undo may splice a seat's own actions at/after this point */
  segStartIndex: number;
  /**
   * Per-action: did it move the id clock or the RNG stream?
   *
   * Parallel to `actions` (same length, same indices) and DERIVED — never
   * persisted, rebuilt by rebuild(). It is the undo gate: splicing action `i`
   * out of a hidden segment re-runs everything after it from a different
   * prior state, so an action that consumed an entity id or an RNG draw
   * renumbers/re-rolls its successors. Seat B's augment on "unit 8" quietly
   * becomes an IllegalAction and is dropped by the tolerant replay — B loses
   * a play they were never told about. So an action may only leave a segment
   * when it is id- and RNG-inert, or when no opponent action follows it.
   *
   * Kept because it is the cheap, honest answer to "did this action move
   * anything at all"; the undo gate itself is now `segIdFloor`/`segRefs`
   * below, which measure rather than predict.
   */
  segTouched: boolean[];
  /**
   * Per-action: `state.nextId` as that action was applied. DERIVED, never
   * persisted, parallel to `actions`.
   *
   * Two jobs. It says which ids an action ALLOCATED (`segIdFloor[j]` up to
   * `segIdFloor[j+1]`), which is what makes an entity's identity survive a
   * renumbering; and it says which ids a splice at `j` would shift (anything
   * at or above `segIdFloor[j]`), which is `spliceable()`'s whole test.
   */
  segIdFloor: number[];
  /**
   * Per-action: WHAT it referred to when it was applied (referenceKey above).
   * DERIVED, never persisted, parallel to `actions`.
   *
   * The undo gate's measurement: splice, rebuild, recompute, and accept only
   * if every later action's key is byte-identical. A key that moved is an
   * action whose author would not recognise it any more.
   */
  segRefs: string[];
  /** chess clock (MTGO-style, display only): remaining ms per seat */
  clockMs: [number, number];
  /** Date.now() of the last clock settle — elapsed since then is still
   * unbilled and belongs to the seats in clockRun */
  clockStamp: number;
  /** which seats' clocks have been RUNNING since clockStamp */
  clockRun: [boolean, boolean];
  /**
   * The formation a seat is CURRENTLY BUILDING, before they commit it.
   *
   * Not a game action and never in `actions`: it is the digital stand-in for
   * watching someone physically slide units into columns across the table
   * (playtest ask, 2026-08-20 — "it'd be cool to see their thought process
   * and see where they're putting the units, live"). Purely presentational,
   * leaks nothing (the declaration becomes public a moment later anyway), and
   * dropped the instant any action lands, because the real declaration
   * supersedes it. Held on the room, not just relayed, so a reconnecting or
   * re-rendering client picks it up without waiting for the next twitch.
   */
  building: [Formation | null, Formation | null];
  /**
   * Draft mode: the room where the trio gets chosen, before there is a game.
   *
   * A draft room used to be dealt the instant its creator joined, which meant
   * one player picked the elements alone AND got to study pack 1 pick 1 for
   * however long the other took to click the link. Both go away if the cards
   * are not dealt until the trio is settled and both players are in — so a
   * draft room now starts here and only becomes a game when `result` is set.
   *
   * null for a room created with an explicit trio (`&els=`, hotseat, tests),
   * which still deals immediately.
   */
  lobby: Lobby | null;
  /** post-game: which seats have asked for a rematch. In memory only — a
   * rematch offer does not deserve to outlive the tab it was made in. */
  rematch: [boolean, boolean];
  /** the room a rematch moved to, so a straggler who clicks late (or
   * reconnects into the finished game) is still sent where their opponent
   * went rather than into a second, empty rematch */
  rematchRoom: string | null;
}

/** The pre-game room: choose a method, both submit, the server resolves. */
export interface Lobby {
  method: TrioMethod;
  /** a rematch's lobby knows what you just played, which is what makes
   * "run it back" a one-click option instead of a re-pick */
  previousTrio?: Element[];
  /** each seat's submission (empty until they put something in) */
  submissions: [TrioSubmission, TrioSubmission];
  /** each seat has locked their submission in */
  locked: [boolean, boolean];
  /** set once both are locked — from here the room is a real game */
  result: TrioResult | null;
}

/** an uncommitted attack/block declaration: columns of entity ids, plus the
 * counterattackers being set aside (round-1 blocks) */
export interface Formation { cols: number[][]; send: number[] }

/** Chess-clock starting bank per player. 40 minutes ran out mid-game in the
 * playtests — a draft game with real decisions wants an hour (Bena,
 * 2026-08-20). Persisted games keep whatever bank they were saved with. */
export const CLOCK_START_MS = 60 * 60 * 1000;

/** Which seats' clocks should run right now: the game is waiting on a seat
 * iff it has at least one legal action (covers pending decisions, priority,
 * draft picks, and the simultaneous planning/deploy done-flags — both clocks
 * may run at once during simultaneous phases, which is correct). Clocks only
 * run while BOTH players are connected (casual client: waiting alone for an
 * opponent, a dropped tab, or a room restored after a server restart must
 * not silently drain anybody), and a finished game stops both clocks. */
export function clockRunning(room: Room): [boolean, boolean] {
  if (roomWaiting(room)) return [false, false];
  if (room.state.winner !== null || room.state.phase === 'gameover') return [false, false];
  if (!room.sockets[0] || !room.sockets[1]) return [false, false];
  return [0, 1].map(s => legalActions(room.state, s as 0 | 1).length > 0) as [boolean, boolean];
}

/** Bill the time elapsed since the last settle to whichever seats were
 * running, clamp at zero (display only — no enforcement), and recompute the
 * running set from the current state + connections. Call after anything that
 * changes either (action applied, undo, join, leave). */
export function settleClock(room: Room): void {
  const now = Date.now();
  const dt = Math.max(0, now - room.clockStamp);
  for (const s of [0, 1] as const) {
    if (room.clockRun[s]) room.clockMs[s] = Math.max(0, room.clockMs[s] - dt);
  }
  room.clockStamp = now;
  room.clockRun = clockRunning(room);
}

/** The clock snapshot attached to every state broadcast: clients extrapolate
 * locally from `at` using `running` until the next message arrives. */
export function clockSnapshot(room: Room): { ms: [number, number]; running: [boolean, boolean]; at: number } {
  settleClock(room);
  return { ms: [...room.clockMs], running: [...room.clockRun], at: room.clockStamp };
}

const rooms = new Map<string, Room>();

/** Build a fresh game and its initial event list. */
function fresh(seed: number, names: [string, string], mode: GameMode, els: Element[], decks?: [CardName[], CardName[]]): { state: GameState; events: EngineEvent[] } {
  const r = createGame(seed, names, mode, els, decks);
  return { state: r.state, events: r.events };
}

/** A room that is not a game yet: its held state is a PLACEHOLDER (never
 * acted on — main.ts gates actions/undo on this) and the real one is dealt
 * once the missing piece arrives. Two kinds: a constructed room still waiting
 * for decks, and a draft room still choosing its trio. */
export function roomWaiting(room: Room): boolean {
  if (room.lobby && !room.lobby.result) return true;
  return room.mode === 'constructed' && (!room.decks[0] || !room.decks[1]);
}

/**
 * Is this game decided, and by whom?
 *
 * The live state first, then the stamp. They come apart for a game saved
 * before the winner stamp existed whose log no longer replays to its ending:
 * the replay stops short so `state.winner` is null, but we know perfectly
 * well who won. Anything asking "is this game over" wants this, not the raw
 * state — otherwise such a room reads as still playable.
 */
export const decidedWinner = (room: Room): Seat | null => room.state.winner ?? room.winner;

/** The draft lobby, while it is still open. */
export function roomLobby(room: Room): Lobby | null {
  return room.lobby && !room.lobby.result ? room.lobby : null;
}

const freshLobby = (method: TrioMethod = 'pick-one', previousTrio?: Element[]): Lobby => ({
  method, submissions: [{}, {}], locked: [false, false], result: null,
  // coming out of a game, "the same again" is the most likely answer, so it
  // is the one already selected
  ...(previousTrio ? { previousTrio: [...previousTrio], method: 'again' as TrioMethod } : {}),
});

/**
 * Change the method. Either player may, while the lobby is open, and it
 * clears both submissions — a ranking is not a pick, and silently carrying
 * one over into another method would submit something nobody chose.
 */
export function setLobbyMethod(room: Room, method: unknown): boolean {
  const lobby = roomLobby(room);
  if (!lobby) return false;
  const next = sanitizeMethod(method);
  if (next === lobby.method) return false;
  lobby.method = next;
  lobby.submissions = [{}, {}];
  lobby.locked = [false, false];
  persist(room);
  return true;
}

/** Record a seat's submission. `lock` marks them ready; the caller resolves. */
export function setLobbySubmission(room: Room, seat: 0 | 1, raw: unknown, lock: boolean): boolean {
  const lobby = roomLobby(room);
  if (!lobby) return false;
  const sub = sanitizeSubmission(raw, lobby.method);
  lobby.submissions[seat] = sub;
  lobby.locked[seat] = lock && submissionReady(sub, lobby.method);
  persist(room);
  return true;
}

/** Un-lock (the "change my mind" button), legal until the other side is in. */
export function unlockLobby(room: Room, seat: 0 | 1): boolean {
  const lobby = roomLobby(room);
  if (!lobby || !lobby.locked[seat]) return false;
  lobby.locked[seat] = false;
  persist(room);
  return true;
}

/**
 * Both seats are locked in: decide the trio and DEAL THE GAME. Returns the
 * result, or null if the lobby is not ready.
 *
 * The randomness is seeded off the room seed — reproducible, and not
 * something either player can influence by the timing of their click.
 */
export function resolveLobby(room: Room, history: TrioHistoryRow[]): TrioResult | null {
  const lobby = roomLobby(room);
  if (!lobby) return null;
  if (!lobby.locked[0] || !lobby.locked[1]) return null;
  const result = resolveTrio({
    method: lobby.method,
    submissions: lobby.submissions,
    names: room.names,
    history,
    previousTrio: lobby.previousTrio,
    rng: room.seed,
  });
  lobby.result = result;
  room.els = sanitizeTrio(result.els);
  const { state, events } = fresh(room.seed, room.names, room.mode, room.els);
  room.state = state;
  room.actions = [];
  room.events = events;
  // the dealt game's first planning segment starts here — without this the
  // freeze would still hold the placeholder (and its placeholder NAMES) for
  // the whole of turn 1
  resetSegment(room);
  room.clockStamp = Date.now();
  persist(room);
  return result;
}

/** the decks to build a constructed room's state from: any missing deck is
 * stood in for by the other one (placeholder games are never played) */
function decksFor(room: Pick<Room, 'decks'>): [CardName[], CardName[]] {
  const a = room.decks[0] ?? room.decks[1];
  const b = room.decks[1] ?? room.decks[0];
  if (!a || !b) throw new Error('a constructed room needs at least one deck');
  return [a, b];
}

/** Register `seat`'s deck (validated!) while the room is waiting. When it
 * completes the pair, the REAL game is dealt (the placeholder state and the
 * empty action log are discarded). Returns true when the game just started. */
export function setRoomDeck(room: Room, seat: 0 | 1, cards: CardName[]): boolean {
  if (!roomWaiting(room)) return false;
  room.decks[seat] = [...cards];
  const complete = !!room.decks[0] && !!room.decks[1];
  if (complete) {
    const { state, events } = fresh(room.seed, room.names, room.mode, room.els, decksFor(room));
    room.state = state;
    room.actions = [];
    room.events = events;
    resetSegment(room);   // same as resolveLobby: the real game's turn 1
    room.clockStamp = Date.now();
  }
  persist(room);
  return complete;
}

interface Rebuilt {
  state: GameState;
  events: EngineEvent[];
  segKey: SegKey | null;
  segSnapshot: GameState | null;
  heldEvents: [EngineEvent[], EngineEvent[]];
  segStartIndex: number;
  segTouched: boolean[];
  segIdFloor: number[];
  segRefs: string[];
  /** logged actions this rebuild could not apply (see LostAction) */
  skipped: LostAction[];
}

/** Re-run seed + actions, accumulating the full event history (the engine's
 * own replay() returns only the creation events, so we accumulate here) and the
 * hidden-segment bookkeeping. Tolerant: an action the (possibly newer) engine
 * now rejects is skipped with a warning instead of killing the whole room — a
 * personal server should never eat a live game over a rules tweak. */
function rebuild(seed: number, names: [string, string], actions: Action[], mode: GameMode, els: Element[], decks?: [CardName[], CardName[]]): Rebuilt {
  let { state, events } = fresh(seed, names, mode, els, decks);
  const all = [...events];
  // SEED THE SEGMENT FROM THE INITIAL STATE: createGame already ends inside
  // turn 1's planning, and turn-1 planning has no preceding action — a
  // "snapshot after an action" pattern would miss the very first segment of
  // every game (and serve a stale, placeholder-named opponent all through it).
  let segKey = segmentKey(state);
  let segSnapshot: GameState | null = segKey ? structuredClone(state) : null;
  let segStartIndex = segKey ? 0 : -1;
  let heldEvents: [EngineEvent[], EngineEvent[]] = [[], []];
  const segTouched: boolean[] = [];
  const segIdFloor: number[] = [];
  const segRefs: string[] = [];
  const skipped: LostAction[] = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    const before = state;
    // recorded BEFORE the action runs, and before its own floor is pushed:
    // every id it can name was allocated by an earlier action
    const sym = symbolizer(actions, segIdFloor, i, before.nextId);
    segIdFloor.push(before.nextId);
    // hold only while the open segment is still the one this action is in:
    // the forced battle drain runs public actions after the key has moved on
    const holding = segKey !== null && segmentKey(before) === segKey;
    let r;
    try {
      r = apply(state, a);
    } catch (err) {
      if (err instanceof IllegalAction) {
        // NOT just a warning: the caller records this into the file, because
        // a log that quietly stopped describing its own game is the thing we
        // most need to be able to see afterwards
        skipped.push({ i, type: a.type, seat: a.seat, why: err.message, kind: 'lost' });
        segTouched.push(false);   // keep the index alignment with `actions`
        segRefs.push(`refused:${err.message}`);
        continue;
      }
      throw err;
    }
    segRefs.push(referenceKey(before, r.state, a, sym, before.rngState !== r.state.rngState));
    state = r.state;
    all.push(...r.events);
    segTouched.push(movedIdOrRng(before, state));
    if (holding) heldEvents[other(a.seat)].push(...r.events);
    const now = segmentKey(state);
    if (now !== segKey) {
      segKey = now;
      segSnapshot = now ? structuredClone(state) : null;
      segStartIndex = now ? i + 1 : -1;
      heldEvents = [[], []];
    }
  }
  return { state, events: all, segKey, segSnapshot, heldEvents, segStartIndex, segTouched, segIdFloor, segRefs, skipped };
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

/** `creatorDeck` (constructed only): the first joiner's deck, used to build
 * the waiting room's placeholder state — setRoomDeck assigns it to the actual
 * seat once main.ts has picked one. */
export function createRoom(code: string, seed: number, names: [string, string] = ['Player 1', 'Player 2'], mode: GameMode = 'shared', els?: Element[], creatorDeck?: CardName[]): Room {
  const trio = sanitizeTrio(els);
  if (mode === 'constructed' && !creatorDeck) throw new IllegalAction('a constructed room needs a deck');
  const decks: [CardName[] | null, CardName[] | null] = [null, null];
  const { state, events } = mode === 'constructed'
    ? fresh(seed, names, mode, trio, [creatorDeck!, creatorDeck!])
    : fresh(seed, names, mode, trio);
  const room: Room = {
    code, seed, mode, els: trio, decks, names, users: [null, null], winner: null,
    lobby: mode === 'draft' && !els ? freshLobby() : null,
    rematch: [false, false], rematchRoom: null,
    state, actions: [], events, sockets: [null, null], forks: [], lost: [],
    segKey: null, segSnapshot: null, heldEvents: [[], []], segStartIndex: -1, segTouched: [],
    segIdFloor: [], segRefs: [],
    clockMs: [CLOCK_START_MS, CLOCK_START_MS], clockStamp: Date.now(), clockRun: [false, false],
    building: [null, null],
  };
  // turn 1's planning segment opens HERE, not on the first action
  resetSegment(room);
  rooms.set(code, room);
  persist(room);
  return room;
}

// ── who is allowed to CREATE a room ───────────────────────────────────
//
// Joining used to be get-or-create, so a mistyped code silently minted a brand
// new empty game and dropped you into it, alone, convinced you were in your
// friend's room. Playtest: Rashi did exactly that, twice, and the misses sat in
// games/ afterwards as empty rooms nobody had played in.
//
// Creation is now the privilege of a code the SERVER handed out: /api/new mints
// one and reserves it, and the first join to a reserved code spends the
// reservation to create the room. Every other code must already exist. A code
// you typed yourself can never create anything, which is the whole point — the
// New-game button is unaffected because it goes through /api/new already.

/** minted-but-not-yet-joined codes, and when they were minted */
const reserved = new Map<string, number>();
/** a reservation nobody used is a dead code — do not honour it forever */
const RESERVE_TTL_MS = 6 * 60 * 60 * 1000;
/** hard cap so a script hammering /api/new cannot grow this without bound */
const RESERVE_MAX = 500;

function pruneReservations(): void {
  const now = Date.now();
  for (const [code, at] of reserved) {
    if (now - at > RESERVE_TTL_MS) reserved.delete(code);
  }
  // still too many: drop the oldest (Map iterates in insertion order)
  while (reserved.size > RESERVE_MAX) {
    const oldest = reserved.keys().next();
    if (oldest.done) break;
    reserved.delete(oldest.value);
  }
}

/** /api/new: this code may be turned into a room by its first joiner */
export function reserveRoomCode(code: string): void {
  pruneReservations();
  reserved.set(code, Date.now());
}

/** is `code` either a live room or a code we minted? (i.e. joinable at all) */
export function roomExistsOrReserved(code: string): boolean {
  pruneReservations();
  return rooms.has(code) || reserved.has(code);
}

/**
 * The room for `code`, creating it ONLY if the code was reserved by /api/new.
 * Returns null when the code names nothing — the caller turns that into the
 * error the player sees.
 *
 * `mode`/`els`/`creatorDeck` only matter when the room doesn't exist yet (the
 * creator's first join carries them); joining an existing room ignores them.
 */
export function joinableRoom(code: string, mode: GameMode = 'shared', els?: Element[], creatorDeck?: CardName[]): Room | null {
  const existing = rooms.get(code);
  if (existing) return existing;
  pruneReservations();
  // spending the reservation and creating are one step: a second join to the
  // same code finds the room above rather than a second reservation
  if (!reserved.delete(code)) return null;
  return createRoom(code, (Math.random() * 1e9) >>> 0, undefined, mode, els, creatorDeck);
}

/** Apply an action to the room's authoritative state and record it. Throws
 * whatever the engine throws (IllegalAction) — caller reports it to the actor. */
export function applyToRoom(room: Room, action: Action): EngineEvent[] {
  settleClock(room);   // bill elapsed time to whoever WAS on the clock
  const before = room.state;
  // hold this action's events back from the opponent only while the segment
  // it was taken in is the one still open. (main.ts drains a run of forced
  // battle actions after a segment's key has already moved on; those are
  // public and must not land in anybody's held queue.)
  const holding = room.segKey !== null && segmentKey(before) === room.segKey;
  // the reference key is taken against the state the action is applied to,
  // with the floors of every action BEFORE it (rebuild() does the same)
  const sym = symbolizer(room.actions, room.segIdFloor, room.actions.length, before.nextId);
  const r = apply(room.state, action);
  room.state = r.state;
  room.actions.push(action);
  room.segIdFloor.push(before.nextId);
  room.segRefs.push(referenceKey(before, r.state, action, sym, before.rngState !== r.state.rngState));
  room.segTouched.push(movedIdOrRng(before, r.state));
  room.events.push(...r.events);
  if (holding) room.heldEvents[other(action.seat)].push(...r.events);
  if (room.state.winner !== null) room.winner = room.state.winner;   // stamp it
  settleClock(room);   // recompute who is on the clock under the NEW state
  persist(room);
  return r.events;
}

/**
 * Close whatever segment was open and open the one the CURRENT state is in
 * (which may be none): a fresh freeze, a fresh start index, an empty hold.
 *
 * The caller reads `heldEvents` for the reveal BEFORE calling this. Every
 * segment boundary — 'plan'→'haste', 'haste'→null, 'deploy'→'plan' — is this
 * one call; there is no per-phase branch anywhere.
 */
export function openSegment(room: Room): void {
  room.segKey = segmentKey(room.state);
  room.segSnapshot = room.segKey ? structuredClone(room.state) : null;
  room.segStartIndex = room.segKey ? room.actions.length : -1;
  room.heldEvents = [[], []];
}

/** A room whose state was re-dealt and whose action log was reset (a resolved
 * lobby, a completed constructed pair, a rematch): the derived per-action
 * bookkeeping goes with it, and the new game's first segment opens now. */
function resetSegment(room: Room): void {
  room.segTouched = [];
  room.segIdFloor = [];
  room.segRefs = [];
  // the previous action log is gone, so any fork recorded against it is too:
  // a fork is a claim about THIS log, and this is a different one
  room.forks = [];
  room.lost = [];
  openSegment(room);
}

/** Undo the most recent action (single-step, docs/07 §15): pop it and rebuild
 * state by replaying seed + remaining actions. Caller enforces who/when. */
export function undoLastAction(room: Room): LostAction[] {
  return undoActionAt(room, room.actions.length - 1);
}

/**
 * The ONE thing a splice can break that no repair can fix: does a LATER action
 * name an entity that THIS action brought into existence?
 *
 * THIS USED TO BE THE WHOLE GATE, AND THE OWNER REJECTED IT (2026-08-23,
 * answering ledger #76):
 *
 *   "In deployment and planning, you're 'alone' in a world that no one else
 *    can see. So you should be perfectly allowed to undo everything, up to the
 *    beginning of that phase … I don't understand your question otherwise."
 *
 * He is right at the game level, and the gate was answering a question about
 * NUMBERING, not about the game. `nextId` is one global clock, so splicing an
 * action that allocated ids shifts every later id down by however many it
 * took; the log is replayed verbatim, so an opponent's `hostId: 8` goes on
 * saying 8 when their unit has become 7. That is a bookkeeping fault in OUR
 * representation, and the player should never have been asked to pay for it.
 * `undoActionAt` now REPAIRS it (see `renumberAction`) instead of refusing.
 *
 * What survives here is the residue that a repair genuinely cannot reach. The
 * ids in `[lo, hi)` are the ones the spliced action created, and after the
 * splice they do not exist at all — there is no number to rewrite them to. A
 * later action naming one of them is an action about a unit that is being
 * un-played, and the only honest answers are "refuse" or "silently drop their
 * move"; we refuse.
 *
 * Two things this deliberately does NOT ask, both of which were the report:
 *
 *  - **Who** acted after you. `seat` is kept in the signature because the call
 *    site reads better with it. Deployment being "entirely separate from the
 *    opponent" is true, and is precisely why the opponent's identity was never
 *    the question.
 *  - Whether the later action **has a payload**. Hand indices and choices are
 *    untouched by a renumbering; only ids are at risk, and `entityRefs` is the
 *    exhaustive list of those. The old `RENUMBER_IMMUNE` five (`donePlanning`,
 *    `doneHaste`, `doneDeploying`, `passPriority`, `concede`) are covered by
 *    the general rule rather than by an exception list — they name no id, so
 *    they can never be re-pointed.
 *
 * Inside a hidden segment this should essentially never fire: naming a unit
 * your opponent deployed behind the screen means naming a unit you cannot see.
 * It is kept because `undoActionAt` is also reachable from forensics and from
 * the public tail path, where an attack CAN name a unit deployed a turn ago.
 */
export function spliceable(room: Room, index: number, seat: Seat): boolean {
  void seat;
  const lo = room.segIdFloor[index];
  if (lo === undefined) return true;
  // the floor of the NEXT action is this one's ceiling; past the end of the
  // log, the live state's clock is
  const hi = room.segIdFloor[index + 1] ?? room.state.nextId;
  if (hi === lo) return true;            // allocated nothing: nothing to lose
  return !room.actions.slice(index + 1)
    .some(a => entityRefs(a).some(id => id >= lo && id < hi));
}

/**
 * The same action, renumbered for a log the splice has shortened.
 *
 * WHY THIS IS NOT "REWRITING SOMEBODY ELSE'S MOVE". An entity id is not part
 * of what a player chose — it is the row number we happened to file their
 * choice under. `augment { hostId: 8 }` means "the mod goes on that unit", and
 * after the unit ahead of it is un-played the same unit is called 7. Leaving
 * the 8 in place does not preserve their intent; it destroys it, which is
 * exactly what the "no such unit" refusal above was.
 *
 * WHY A CONSTANT SHIFT IS THE RIGHT ARITHMETIC. The spliced action allocated
 * `[lo, hi)`. If nothing else about the rebuild changes — which is the thing
 * we are about to check — every later action allocates the same ids it did
 * before, one block lower, so `id -> id - (hi - lo)` for everything at or
 * above `hi`. Ids below `lo` predate the splice and never move.
 *
 * WHY THE ASSUMPTION IS SAFE. It is not assumed, it is VERIFIED:
 * `undoActionAt` rebuilds and then compares every later action's reference
 * key, which resolves an id to "the k-th entity created by the action tagged
 * t7" rather than to a number. If the shift was right, every key comes out
 * byte-identical; if the world moved in any other way, a key differs and the
 * whole undo is rolled back. So the repair can only ever land when it is
 * provably a repair.
 *
 * The rewritten action carries the ORIGINAL's tag: it is the same action, and
 * the reference keys on both sides of the comparison have to agree about that
 * or every entity it created would look like a different entity.
 */
function renumberAction(a: Action, lo: number, hi: number): Action {
  const shift = hi - lo;
  let moved = false;
  const one = (id: EntityId): EntityId => {
    if (id < hi) return id;              // predates the splice, or is being erased by it
    moved = true;
    return id - shift;
  };
  const list = (ids: readonly EntityId[]): EntityId[] => ids.map(one);
  let out: Action;
  switch (a.type) {
    case 'castSpellToken': out = { ...a, entityId: one(a.entityId) }; break;
    case 'activateAbility':
      out = typeof a.via === 'object' && a.via
        ? { ...a, entityId: one(a.entityId), via: { mod: one(a.via.mod) } }
        : { ...a, entityId: one(a.entityId) };
      break;
    case 'augment': out = a.hostId === undefined ? a : { ...a, hostId: one(a.hostId) }; break;
    case 'graft': out = { ...a, hostId: one(a.hostId) }; break;
    case 'declareAttack':
      out = { ...a, columns: a.columns.map(list),
        ...(a.spellTokens ? { spellTokens: list(a.spellTokens) } : {}) };
      break;
    case 'declareBlocks': {
      // the KEYS are attack-column indices, not ids — only the values move
      const blocks: Record<number, EntityId[]> = {};
      for (const [k, v] of Object.entries(a.blocks)) blocks[Number(k)] = list(v);
      out = { ...a, blocks,
        ...(a.send ? { send: list(a.send) } : {}),
        ...(a.spellTokens ? { spellTokens: list(a.spellTokens) } : {}) };
      break;
    }
    default: return a;                   // names no id: nothing to renumber
  }
  if (!moved) return a;
  ACTION_TAG.set(out, tagOf(a));          // the same action, under new numbers
  return out;
}

/** How a refused undo is reported: 'lost' actions no longer replay at all,
 * 'changed' ones still replay but now mean something else. */
function asLost(l: LostAction[], kind: 'lost' | 'changed'): LostAction[] {
  return l.map(x => ({ ...x, kind }));
}

/**
 * Undo the action at `index` (splice + full rebuild), or REFUSE.
 *
 * Returns [] on success; a non-empty list is the refusal, and each entry names
 * a later action the splice would have damaged and how (`LostAction.kind`).
 * Callers enforce who may remove what; `spliceable()` screens the one case no
 * repair can reach, and this repairs and measures everything else.
 *
 * An undo must never cost anybody an action they did not ask to give up, and
 * must never quietly turn one into a different action. So the splice is
 * performed, REPAIRED, MEASURED against the log it came from, and rolled back
 * if either happened — a measurement beats a prediction:
 *
 *   lost     the rebuild refused an action it used to accept. This was always
 *            here; a silently dropped play is the bug that made game UZRG
 *            unreadable.
 *   changed  every surviving later action's REFERENCE KEY must be unchanged.
 *            This is the important half: an action that stays legal while
 *            pointing at another unit, another card in hand or another roll of
 *            the dice is invisible to the rebuild, invisible in the log, and
 *            worse than any refusal.
 *
 * THE REPAIR is what makes the owner's "you should be perfectly allowed to
 * undo everything" actually true rather than nearly true. Splicing shifts the
 * id clock, and the log replays verbatim, so without it the opponent's
 * `hostId` goes on naming a number that no longer exists and the undo dies on
 * "no such unit" — measured in real games, not supposed. `renumberAction`
 * rewrites those references down by the block the spliced action gave up, and
 * the reference-key comparison below is the PROOF that the rewrite was a
 * repair: keys are written in terms of which action created an entity, not of
 * its number, so a correct renumbering leaves every key byte-identical and any
 * other movement shows up as `changed` and is rolled back.
 */
export function undoActionAt(room: Room, index: number): LostAction[] {
  settleClock(room);   // bill up to the undo; the rebuild changes who runs
  const restore = [...room.actions];
  const wasRefs = [...room.segRefs];
  // the block of ids this action allocated — the ones that cease to exist,
  // and the size of the shift everything above them takes
  const lo = room.segIdFloor[index];
  const hi = lo === undefined ? undefined : (room.segIdFloor[index + 1] ?? room.state.nextId);
  const tail = restore.slice(index + 1);
  room.actions = restore.slice(0, index).concat(
    lo !== undefined && hi !== undefined && hi > lo
      ? tail.map(a => renumberAction(a, lo, hi))
      : tail);
  const rb = rebuildRoom(room);
  const lost = rb.skipped.length > room.lost.length ? rb.skipped : [];
  // …and the actions that survive but no longer mean what they meant. Compared
  // by ACTION OBJECT position: original j > index sits at j-1 in the splice.
  const changed: LostAction[] = [];
  if (!lost.length) {
    for (let j = index + 1; j < restore.length; j++) {
      if (rb.segRefs[j - 1] === wasRefs[j]) continue;
      const a = restore[j]!;
      changed.push({
        i: j, type: a.type, seat: a.seat,
        why: 'it would refer to a different unit, card or outcome once the earlier action is gone',
      });
    }
  }
  if (lost.length || changed.length) {
    room.actions = restore;
    assignRebuild(room, rebuildRoom(room));   // deterministic: exact prior state
    settleClock(room);
    return lost.length ? asLost(lost, 'lost') : asLost(changed, 'changed');
  }
  assignRebuild(room, rb);
  settleClock(room);
  persist(room);
  return [];
}

/**
 * THE TAKE-BACK, as one decision.
 *
 * Ledger #37 (UZRG, 2026-08-21) — *"Planning should be like deployment,
 * entirely divorced from what your opponent is doing … you can't take back
 * making the wrong resource … if your opponent does something (which
 * shouldn't matter)"* — was answered by building the three hidden segments.
 * One day later ledger #76 (WEHH, 2026-08-22) filed the SAME complaint about
 * deployment, because the segments were only half of it: the segment says
 * which of your actions the undo should look at, and the SPLICE GATE says
 * whether it may go. #37's guards pin the first and cannot fail on the
 * second, and the reason nothing else pinned it is that the decision lived
 * inside a WebSocket message handler, where only a whole game over a socket
 * could reach it. It lives here now, and `test-undo-segment.ts` drives it
 * directly in the shape the owner reported.
 *
 * Returns ok, or the refusal to show the player — in the words of the thing
 * that actually went wrong. The old text ("your opponent has already acted on
 * top of that one") named the gate's proxy, not its reason, which is a large
 * part of why the report reads as a bug rather than as a rule.
 */
export type UndoOutcome = { ok: true } | { ok: false; why: string };

/**
 * How far back a walk may go: the first action in the open segment that is the
 * PLAYER'S OWN business.
 *
 * The owner drew this line himself (2026-08-23): *"you should be perfectly
 * allowed to undo everything, up to the beginning of that phase (unless there
 * is anything that triggers at the beginning/end of those phases such as
 * paying debt or 'at the beginning of deployment')"*.
 *
 * `segStartIndex` is nearly that line and not quite. Most start-of-phase
 * machinery never reaches the log at all — debt is paid inside the barrier
 * action that ends the resource step (R39), and start-of-deployment rot
 * damage inside the one that opens deployment (R38), so both are already
 * below `segStartIndex`. What DOES reach the log is a start-of-phase trigger
 * that asks a question: the segment opens with the suspension already
 * standing, and the `decide` answering it lands at `segStartIndex` itself —
 * inside the walk, and undoable, which is what he says he does not want.
 *
 * So: if the segment opened mid-suspension, the leading run of `decide`
 * actions draining it is the phase's business, not the player's. That run is
 * unambiguous — while a decision is pending nobody else may act, so nothing
 * can be interleaved into it, and it ends at the first action that is not a
 * `decide` (the player's first free move of the step).
 */
export function segmentFloor(room: Room): number {
  const start = room.segStartIndex;
  if (start < 0) return -1;
  if (!room.segSnapshot?.decision) return start;
  let i = start;
  while (i < room.actions.length && room.actions[i]!.type === 'decide') i++;
  return i;
}

export function undoForSeat(room: Room, seat: Seat): UndoOutcome {
  const segKey = room.segKey;
  // A pending PRE-COMMIT cast chain of the requester's own (X / cost /
  // target stages, R35) is undoable in ANY phase: while their decision
  // pends nobody else can act, so the log's tail is provably theirs and
  // splicing it takes nothing away from the opponent. The client chains
  // one undo per state until the suspension clears (cast-cancel, docs/07).
  const sus = room.state.suspension, dec = room.state.decision;
  const castChain = !!dec && !!sus && sus.type === 'cast' && sus.item.kind !== 'triggered'
    && dec.seat === seat && sus.item.controller === seat;
  if (!segKey && !castChain) {
    return { ok: false, why: 'undo only works during planning and deploy (or while your own cast is awaiting X, costs or targets)' };
  }
  if (segKey) {
    // Inside a hidden simultaneous segment your last action is very often not
    // the last one overall — your opponent is acting in parallel, behind the
    // screen, and what they do must not be able to take your undo away. So
    // walk back to YOUR most recent action within the segment and splice
    // that. ALL THREE segments, not deployment alone: 'plan', 'haste' and
    // 'deploy' are one `segmentKey`, which is exactly what #37 asked for
    // ("planning should be like deployment") and what makes #76's fix reach
    // planning for free.
    //
    // Pressing undo repeatedly walks you back to `segmentFloor` and stops
    // there — the owner's "up to the beginning of that phase". The window
    // closes at each barrier, which is right: once both of you have pressed
    // done, the step's decisions lock.
    const floor = segmentFloor(room);
    let i = room.actions.length - 1;
    while (i >= floor && i >= 0 && room.actions[i]!.seat !== seat) i--;
    if (floor < 0 || i < 0 || i < floor) {
      // distinguish the two ways the walk ends, because they mean different
      // things to the player: "there is nothing left of mine" versus "what is
      // left is the phase starting, which was never yours to take back"
      const atStart = floor > room.segStartIndex && room.segStartIndex >= 0
        && room.actions.slice(room.segStartIndex, floor).some(a => a.seat === seat);
      return atStart
        ? { ok: false, why: 'that is the start of the phase — its triggers cannot be taken back' }
        : { ok: false, why: 'nothing to undo — nothing of yours this step' };
    }
    // ...and the ONLY thing that can still stop it: a later move that names an
    // entity this action created, which un-playing it destroys outright. Note
    // what is NOT asked any more, which was the whole of #76: "has your
    // opponent acted since", nor even "would this renumber their move" — a
    // renumbering is our bookkeeping and undoActionAt repairs it.
    if (!spliceable(room, i, seat)) {
      return { ok: false, why: 'a later move is about the very unit that action put on the board — it cannot be taken back on its own' };
    }
    const refused = undoActionAt(room, i);
    if (refused.length) return { ok: false, why: undoRefusal(refused) };
    return { ok: true };
  }
  const last = room.actions[room.actions.length - 1];
  if (!last) return { ok: false, why: 'nothing to undo' };
  if (last.seat !== seat) return { ok: false, why: 'your opponent acted since — nothing of yours to undo' };
  const refused = undoLastAction(room);
  if (refused.length) return { ok: false, why: undoRefusal(refused) };
  return { ok: true };
}

/** The refusal a player reads when an undo is rolled back. A refusal has to
 * name what was measured, or the player has no way to tell a rule from a bug
 * — which is how #76 came to be filed. */
function undoRefusal(refused: LostAction[]): string {
  const changed = refused.every(r => r.kind === 'changed');
  const what = refused.length === 1 ? 'a move' : `${refused.length} moves`;
  return changed
    ? `taking that back would change what ${what} made after it refers to — it cannot be undone now`
    : `taking that back would drop ${what} made after it — it cannot be undone now`;
}

/**
 * A restore could not faithfully rebuild this game: write that into the file,
 * and tell the players.
 *
 * Only for rooms still being PLAYED. A finished game's skips are read-only
 * forensics — `stats.ts` already reports it as diverged, `replay-room.ts`
 * spells it out, and recording a fork for each of them would rewrite hundreds
 * of settled files on every boot (the ~650 skip warnings at startup are these,
 * and they are normal). A LIVE room is different: play is about to continue
 * into that log, and the join has to be marked before it happens.
 *
 * Idempotent across restarts — restoring the same room under the same engine
 * loses the same actions, and that is one fork, not one per boot.
 */
function recordFork(room: Room): boolean {
  if (!room.lost.length) return false;
  const previous = room.forks[room.forks.length - 1];
  if (previous && sameLoss(previous.lost, room.lost)) return false;   // already known
  room.forks.push({
    at: new Date().toISOString(),
    logged: room.actions.length,
    lost: room.lost.map(l => ({ ...l })),
    turn: room.state.turn,
    phase: room.state.phase,
  });
  // and say it OUT LOUD, in the game's own log, where both players see it on
  // their next join. Degrading quietly is the whole failure mode here.
  room.events.push({
    type: 'note',
    msg: `⚠ This game could not be fully restored: ${room.lost.length} of ${room.actions.length} `
      + `logged actions no longer replay under the current rules, so it has been rebuilt without `
      + `them and stands at turn ${room.state.turn}. Everything before this line describes a `
      + `different board.`,
    data: { lost: room.lost.length, logged: room.actions.length },
  } as unknown as EngineEvent);
  console.warn(`[rooms] ${room.code} FORKED on restore: ${room.lost.length} of ${room.actions.length} `
    + `actions could not be replayed; the game resumes at turn ${room.state.turn} ${room.state.phase}`);
  return true;
}

/** rebuild() for a room that already knows its own seed/mode/els/decks. */
function rebuildRoom(room: Room): Rebuilt {
  return rebuild(room.seed, room.names, room.actions, room.mode, room.els,
    room.mode === 'constructed' ? decksFor(room) : undefined);
}

/** Adopt a rebuild's results wholesale (state + event history + the derived
 * segment and integrity bookkeeping). */
function assignRebuild(room: Room, rb: Rebuilt): void {
  room.state = rb.state;
  room.events = rb.events;
  room.segKey = rb.segKey;
  room.segSnapshot = rb.segSnapshot;
  room.heldEvents = rb.heldEvents;
  room.segStartIndex = rb.segStartIndex;
  room.segTouched = rb.segTouched;
  room.segIdFloor = rb.segIdFloor;
  room.segRefs = rb.segRefs;
  room.lost = rb.skipped;
}

/**
 * Build the room a rematch moves to: same players, same seats, same format,
 * a new seed — and, for a draft, a fresh lobby that already knows what you
 * just played (so "run it back" is one click).
 *
 * Constructed keeps both decks and deals immediately: you have already each
 * brought one, and being sent back to the deck picker to choose the same deck
 * again would be a strange way to say "again".
 */
export function createRematch(old: Room, code: string): Room {
  const seed = (Math.random() * 1e9) >>> 0;
  const room = old.mode === 'constructed' && old.decks[0] && old.decks[1]
    ? createRoom(code, seed, [...old.names], old.mode, old.els, old.decks[0]!)
    : createRoom(code, seed, [...old.names], old.mode, old.mode === 'draft' ? undefined : old.els);
  if (old.mode === 'constructed' && old.decks[0] && old.decks[1]) {
    room.decks = [[...old.decks[0]!], [...old.decks[1]!]];
    const { state, events } = fresh(seed, room.names, room.mode, room.els, [room.decks[0]!, room.decks[1]!]);
    room.state = state;
    room.events = events;
  } else if (old.mode === 'draft') {
    room.lobby = freshLobby('pick-one', old.els);
  }
  // carry the seat↔account binding over, so the rematch is already countable
  // even before either client has re-joined
  room.users = [...old.users];
  for (const seat of [0, 1] as Seat[]) room.state.players[seat]!.name = room.names[seat]!;
  resetSegment(room);   // the constructed branch above replaced the state
  old.rematchRoom = code;
  persist(room);
  return room;
}

/** Rename a seat. Names are cosmetic: they live in room.names (persisted, used
 * by replay) and in the live state's player slot for rendering.
 *
 * NOTE this happens OUTSIDE the action log, so it does not reach the open
 * segment's frozen snapshot — and turn 1's 'plan' segment is snapshotted at
 * room creation, before anybody has typed a name. viewFor() therefore carries
 * the LIVE name over the frozen player slot; a name is never hidden. */
export function renameSeat(room: Room, seat: 0 | 1, name: string): void {
  room.names[seat] = name;
  room.state.players[seat]!.name = name;
  persist(room);
}

/** Bind a seat to an account (or clear it when nobody is logged in there).
 * Idempotent, and persisted — this is what makes the game countable later. */
export function setSeatUser(room: Room, seat: 0 | 1, userId: string | null): void {
  if (room.users[seat] === userId) return;
  room.users[seat] = userId;
  persist(room);
}

// ── persistence ───────────────────────────────────────────────────────

function persist(room: Room): void {
  try {
    mkdirSync(GAMES_DIR, { recursive: true });
    const path = join(GAMES_DIR, `${room.code}.json`);
    // temp + rename, like accounts.ts: this file is the game's only record,
    // and a crash mid-write must not leave it half-written (restoreRooms
    // would silently skip the corrupt room and the game would be lost)
    const tmp = `${path}.tmp`;
    // clockMs is persisted too: elapsed time cannot be reconstructed from a
    // replay. (Additive field — older files without it restore at 40:00.)
    writeFileSync(tmp, JSON.stringify({
      seed: room.seed, mode: room.mode, els: room.els, names: room.names,
      // accounts: who each seat belonged to, so the stats fold knows whose
      // game this was long after the sockets are gone (additive field)
      users: room.users,
      // and the result, stamped at the time — see Room.winner
      winner: room.winner,
      // the draft lobby: a room can be restarted mid-trio-choice, and losing
      // two rankings to a deploy would be a genuinely annoying way to lose
      // them (additive field)
      ...(room.lobby ? { lobby: room.lobby } : {}),
      actions: room.actions, clockMs: room.clockMs,
      // every restore that could not faithfully rebuild this game. Without
      // it the file goes on claiming to be a straight-through record of a
      // game it no longer describes (additive field)
      ...(room.forks.length ? { forks: room.forks } : {}),
      // constructed: decks are part of the replay config (additive field)
      ...(room.mode === 'constructed' ? { decks: room.decks } : {}),
    }));
    renameSync(tmp, path);
  } catch (err) {
    console.error(`[rooms] could not persist ${room.code}:`, err);
  }
}

/** Restore all persisted rooms by replaying their action logs. Best-effort:
 * a room whose replay throws (e.g. an engine change made an old log invalid)
 * is skipped with a warning rather than crashing startup. */
export function restoreRooms(): void {
  let files: string[];
  try {
    files = readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'));
  } catch {
    return; // no games dir yet
  }
  for (const f of files) {
    const code = f.replace(/\.json$/, '');
    try {
      const raw = JSON.parse(readFileSync(join(GAMES_DIR, f), 'utf8')) as {
        seed: number; mode?: GameMode; els?: Element[]; names?: [string, string];
        actions: Action[]; clockMs?: [number, number];
        users?: [string | null, string | null];
        winner?: number | null;
        lobby?: Lobby;
        decks?: [CardName[] | null, CardName[] | null];
        forks?: Fork[];
      };
      const names = raw.names ?? ['Player 1', 'Player 2'];
      const users: [string | null, string | null] = [raw.users?.[0] ?? null, raw.users?.[1] ?? null];
      const savedWinner: Seat | null = raw.winner === 0 || raw.winner === 1 ? raw.winner : null;
      const mode = raw.mode ?? 'shared';
      const els = sanitizeTrio(raw.els);
      const decks: [CardName[] | null, CardName[] | null] = [null, null];
      if (mode === 'constructed') {
        for (const s of [0, 1] as const) {
          const c = checkDeck(raw.decks?.[s]);
          if (c.ok) decks[s] = c.cards;
        }
        if (!decks[0] && !decks[1]) throw new Error('constructed room with no decks');
      }
      // a draft lobby that never resolved: keep the method and both
      // submissions, and make sure the placeholder is rebuilt, not replayed
      const lobby: Lobby | null = raw.lobby
        ? {
            method: sanitizeMethod(raw.lobby.method),
            submissions: [
              sanitizeSubmission(raw.lobby.submissions?.[0], sanitizeMethod(raw.lobby.method)),
              sanitizeSubmission(raw.lobby.submissions?.[1], sanitizeMethod(raw.lobby.method)),
            ],
            locked: [!!raw.lobby.locked?.[0], !!raw.lobby.locked?.[1]],
            result: raw.lobby.result ?? null,
          }
        : null;
      // a still-waiting room never had real actions — drop any strays
      const unresolved = (mode === 'constructed' && (!decks[0] || !decks[1]))
        || (!!lobby && !lobby.result);
      const actions = unresolved ? [] : raw.actions;
      const { state, events, segKey, segSnapshot, heldEvents, segStartIndex, segTouched,
        segIdFloor, segRefs, skipped } = rebuild(
        raw.seed, names, actions, mode, els,
        mode === 'constructed' ? decksFor({ decks }) : undefined);
      const clockMs: [number, number] = Array.isArray(raw.clockMs) && raw.clockMs.length === 2
        ? [Math.max(0, Number(raw.clockMs[0]) || 0), Math.max(0, Number(raw.clockMs[1]) || 0)]
        : [CLOCK_START_MS, CLOCK_START_MS];
      rooms.set(code, {
        code, seed: raw.seed, mode, els, decks, names, users, lobby,
        rematch: [false, false], rematchRoom: null,
        // the replay may not reach the ending this game actually had
        winner: state.winner ?? savedWinner,
        state, actions, events,
        sockets: [null, null], segKey, segSnapshot, heldEvents, segStartIndex, segTouched,
        segIdFloor, segRefs,
        forks: Array.isArray(raw.forks) ? raw.forks : [], lost: skipped,
        // nobody is connected right after a restart, so no clock runs yet
        clockMs, clockStamp: Date.now(), clockRun: [false, false],
        building: [null, null],
      });
      // a LIVE room whose log could not be fully replayed has just forked:
      // record it in the file and in the game's own log before play resumes
      const restored = rooms.get(code)!;
      if (decidedWinner(restored) === null && recordFork(restored)) persist(restored);
      console.log(`[rooms] restored ${code} (${raw.actions.length} actions`
        + `${skipped.length ? `, ${skipped.length} unreplayable` : ''})`);
    } catch (err) {
      console.error(`[rooms] could not restore ${code}:`, err instanceof Error ? err.message : err);
    }
  }
}
