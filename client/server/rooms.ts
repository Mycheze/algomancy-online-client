/* In-memory room store and its JSON persistence. A room is one game: the authoritative
 * GameState, the seed and action log, the event history (for redacted resync) and up to
 * two sockets. A saved room is restored by replaying its log through the engine. */
import { existsSync, readdirSync, readFileSync, mkdirSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// type-only: rooms.ts takes no runtime dependency on ws
import type { WebSocket } from 'ws';
import type { Action, ActivateVia, AmendDest, AmendEdit, AmendSource, AmendUnitDest, CardName, Element, EngineEvent, EntityId, GameMode, GameRules, GameState, Phase, Seat } from '../engine/src/types.ts';
// CR D4.6: CC undo until Done — the engine's half (which step is open, whose, and what each action means to a take-back)
import { ccUndoFloor, ccUndoMark, type CcUndoMark } from '../engine/src/ccundo.ts';
import { AMEND_DESTS, AMEND_SOURCES, AMEND_UNIT_DESTS, STATE_SCHEMA } from '../engine/src/types.ts';
import { amendProblem, amendText } from '../engine/src/amend.ts';
import { singleCardsOf } from './cardladder.ts';
import { DECK_LIST } from '../engine/src/cards/registry.ts';
import { amendFrozen, apply, checkDeck, checkSingleCard, checkSingleDeck, makesUnits, decisionBlocks, forcedAction, hiddenSegment, legalActions as engineLegalActions, planningStep, sanitizeTrio, IllegalAction } from '../engine/src/apply.ts';
// CR D8.4: `dealScenario` is `createGame` when no scenario id is passed. It is imported
// instead of `createGame` so no deal in this file can forget the scenario. `isDealId`, not
// `isScenarioId`: a saved sandbox room is a deal too, and must restore.
import { dealScenario, isDealId, isSandboxId, savedRules } from './scenarios.ts';
import { legalForSeat, other } from './view.ts';
import type { HeldFrame, SegmentClose } from './view.ts';
// The on-disk shapes live in types.ts so replay-room.ts can name them without importing ws;
// re-exported because this module writes them.
import type { Amendment, Dispute, Fork, LostAction, RoomClosed, VersionStamp } from './types.ts';
export type { Amendment, Fork, LostAction, VersionStamp } from './types.ts';
import { engineVersion } from './engine-version.ts';
// The per-action board fingerprint. `signature` is semantic (card names and counts, never
// entity ids), so fingerprints compare across engines. Import only FROM replay-probe.ts: it
// runs inside checkouts of past commits and may import nothing but the engine.
import { digest, signature } from './replay-probe.ts';
import { capital, cutParts, cutText, describe, type CutItem, type CutPlan } from './rewind-cuts.ts';
import { zoneDelta } from './zonedelta.ts';
// CR D4.3e: what an action showed each seat of the hidden cards (the undo floor)
import { lastSeen, NOTHING_SEEN, SEEN_REFUSAL, seenBy, type Seen } from './seen.ts';
import { cardFact, cardOpen, sanitizeFact, sanitizeOpen, type CardFact, type CardOpen } from './cardledger.ts';
import { gamesDir } from './statepaths.ts';
import { sanitizeMatchLink } from './match-store.ts';
// CR D8.5: a conceded game weighs by the turn it was conceded on — stamped here, read by the
// folds. Only the type and the sanitizer: the thresholds live in concession.ts alone.
import { sanitizeConcession, type Concession } from './concession.ts';
import {
  resolveTrio, sanitizeMethod, sanitizeSubmission, submissionReady,
  type TrioHistoryRow, type TrioMethod, type TrioResult, type TrioSubmission,
} from './trio.ts';
// custom rules on a live draft: the deal the engine takes, and what the creator chose
import { sanitizeDraftDeal, type DraftDeal } from '../engine/src/draftdeal.ts';
import { sanitizeCustomRules, STANDARD_RULES, type CustomRules } from '../ui/customrules.ts';
// the standing pass. ui/passrelease.ts, not ui/battle.ts: its imports are engine types only,
// which is all the server may compile from ui/ (engine/test/282).
import { autoPassPlan, inPassWindow, passAllRelease, type PassMode } from '../ui/passrelease.ts';

/**
 * A live draft's custom rules, resolved once when the room is created. `rules` is what the
 * creator chose (lobby, history, rematch); `deal` is what it resolved to, and the only half
 * any re-deal reads, so a later classifier or grammar change cannot rewrite a game.
 */
export interface RoomCustom { rules: CustomRules; deal: DraftDeal }

/** how many elements this room's draft is played with: 3, or the custom deal's */
export function roomElementCount(room: { custom?: RoomCustom }): number {
  return room.custom?.deal.elements ?? 3;
}

/** A saved room's custom rules. Rules this build cannot read refuse the restore: replaying
 * the log onto a standard deal would describe a game nobody played. */
function restoreCustom(raw: { rules?: unknown; deal?: unknown } | undefined | null, mode: GameMode): RoomCustom | undefined {
  if (raw === undefined || raw === null) return undefined;
  const deal = sanitizeDraftDeal(raw.deal);
  if (mode !== 'draft' || !deal) {
    throw new Error('saved with custom rules this build cannot read — refusing to replay its log onto a standard deal');
  }
  return { rules: sanitizeCustomRules(raw.rules) ?? { ...STANDARD_RULES, bans: [] }, deal };
}

// ALGO_GAMES_DIR lets a test run against a throwaway directory of saved rooms
const GAMES_DIR = gamesDir();

/**
 * The hidden simultaneous segments: the steps played behind a screen.
 *
 *   'plan'   the resource step. Its actions touch only the actor's own hand and resources,
 *            fire no triggers, touch no stack, draw no RNG and allocate no entity ids, so
 *            the two seats' actions commute (test-hidden.ts) — which makes an undo here safe.
 *   'haste'  the haste step: plays resolve immediately, no priority, no responses (CR 504.3).
 *   'deploy' simultaneous deployment.
 *
 * When the key changes, the old segment's reveal is flushed and the new one snapshotted.
 * Nothing else in the server knows which phase it is looking at.
 */
export type SegKey = 'plan' | 'haste' | 'deploy';

/** Which hidden segment this state is in, if any — the engine's `hiddenSegment`, which its
 * decision gate also reads. */
export function segmentKey(s: GameState): SegKey | null {
  return hiddenSegment(s);
}

/* CR D6.2: every event an action produces inside a hidden step is held from the other seat
 * and flushed once at the barrier, inside that action's playback frame — a glimpse included.
 * No event type is exempt: an exemption would make that event public mid-step (test 203). */

/** The events of `evs` that `seat` may see now: those this room has not held from them.
 * Inside a step that is only the events of `seat`'s own actions (CR D6.1a); outside, all. */
export function unheldFor(room: Room, seat: Seat, evs: EngineEvent[]): EngineEvent[] {
  const held = new Set(room.heldEvents[seatSlot(seat)]);
  return evs.filter(e => !held.has(e));
}

/* CR D2.1b: inside a hidden segment one seat's open decision — deployment triggers use the
 * stack (CR 703.7), so a pile of them suspends on it — must not freeze the other seat.
 * `legalForSeat` still offers the other seat its options, and `arrivalVerdict` parks what
 * the engine cannot take yet instead of refusing it, applying it when the decision closes. */

/** How many actions one seat may park behind an opponent's decision; more is a client fault,
 * refused rather than queued. */
export const MAX_DEFERRED = 8;

/**
 * The legal actions the server publishes to `seat` (view.ts: Learn to Play offers the same).
 * In a snapshot-carrying suspension (apply.ts `decisionBlocks`, case 3) it offers the other
 * seat options the engine still refuses, and the room parks them (CR D2.1b). The engine's
 * `legalActions` must not be widened to match: every action it returns must be legal.
 */
export { legalForSeat };

/** What the server offers a seat, asked of the room: every site that publishes a legal list
 * (or drives the scripted opponent off one) asks here. */
export function legalInRoom(room: Room, seat: Seat): Action[] {
  // a game decided off the board (a loss on time, a stamped result) offers nothing
  if (decidedOutsideState(room)) return [];
  return legalForSeat(room.state, seat, room.segKey, legalActions);
}

/* One legal list per seat per board. A room's state is replaced by each action, never
 * edited, so the state object is the key. The list is shared: never change it. */
const legalLists = new WeakMap<GameState, [Action[]?, Action[]?]>();
export function legalActions(state: GameState, seat: Seat): Action[] {
  let lists = legalLists.get(state);
  if (!lists) legalLists.set(state, lists = []);
  return lists[seat] ??= engineLegalActions(state, seat);
}

/** One action of the open hidden step, held until an undo needs to know what
 * it showed each seat. Everything `seenBy` reads, as it stood when it landed. */
interface SeenPending {
  i: number; before: GameState; action: Action; after: GameState;
  events: readonly EngineEvent[]; frozen: GameState | null; names: readonly string[];
}

/** CR D4.3: the same measurement, the same inputs; only the moment moves. */
export function settleSeen(room: Room): void {
  for (const p of room.seenPending.splice(0)) {
    room.segSeen[p.i] = seenBy(p.before, p.action, p.after, p.events, { frozen: p.frozen, holding: true, names: p.names });
  }
}

/** What to do with an arriving action. */
export type ArrivalVerdict =
  /** apply it now, the way the server always has */
  | 'apply'
  /** park it: an opponent's decision is open inside a simultaneous segment,
   * and it lands as soon as that decision closes */
  | 'defer'
  /** hand it to the engine to refuse by name (or accept) */
  | 'refuse';

/**
 * Should this action be applied, parked, or left to the engine's refusal?
 *  - `decide`/`concede` is never parked: a decide closes the decision, and a concede must
 *    always be reachable (CR 104.4a).
 *  - the acting seat's own decision is never parked: they must answer it.
 *  - outside a hidden segment battle is sequential, and the block is correct.
 * Only what the engine will still refuse (`decisionBlocks`) is parked: answering a
 * snapshot-carrying suspension rewinds the state, erasing anything landed meanwhile.
 */
export function arrivalVerdict(
  state: GameState, action: Action, segKey: SegKey | null, parked: number,
): ArrivalVerdict {
  if (!state.decision) return 'apply';
  if (action.type === 'decide' || action.type === 'concede') return 'apply';
  if (state.decision.seat === action.seat) return 'refuse';
  if (segKey === null) return 'refuse';
  if (!decisionBlocks(state, action.seat)) return 'apply';
  if (parked >= MAX_DEFERRED) return 'refuse';
  return 'defer';
}

/**
 * The second way into the queue (CR D2.1d): the engine accepted the action into a draft,
 * found it disturbed the other seat's open question, and discarded it (`IllegalAction.disturbs`).
 * Whether an action suspends is known only once it runs, so it is parked here, keeping
 * CR D2.1c's promise that nothing goes back on the wire as a refusal.
 */
export function deferrableRefusal(room: Room, action: Action, err: unknown): boolean {
  return err instanceof IllegalAction && err.disturbs === true
    && room.segKey !== null
    && room.deferred[action.seat]!.length < MAX_DEFERRED;
}

/** Park an action behind the opponent's open decision. */
export function deferAction(room: Room, action: Action): void {
  room.deferred[action.seat]!.push(action);
}

/** The parked actions now free to run, cleared off the room; empty while any decision is
 * open. Each seat's queue keeps its arrival order; the order between seats is arbitrary. */
export function takeDeferred(room: Room): Action[] {
  if (room.state.decision) return [];
  const out = [...room.deferred[0]!, ...room.deferred[1]!];
  room.deferred = [[], []];
  return out;
}

/* Undo is a splice: the action leaves the log and the rest replays verbatim, so a later
 * action can stay legal while meaning something else (ids renumber; zones and the RNG differ).
 * So an undo is accepted iff every later action's reference key — what its payload pointed
 * at, in terms that survive renumbering — is unchanged by the rebuild. */

/** A stable label per action OBJECT (`splice()` keeps the objects), so a tag names the same
 * action across the two rebuilds an undo compares. Process-local: the counter restarts with
 * every server process, so a tag means something only within one. */
const ACTION_TAG = new WeakMap<object, string>();
let actionTagSeq = 0;
function tagOf(a: Action): string {
  let t = ACTION_TAG.get(a);
  if (!t) { t = `t${++actionTagSeq}`; ACTION_TAG.set(a, t); }
  return t;
}

/** Which slot of a two-seat pair a seat is. A narrowing rather than a `!`, so a third seat
 * would be a visibly wrong line instead of a silently false assertion. */
const seatSlot = (seat: Seat): 0 | 1 => seat === 0 ? 0 : 1;

/** The entity id an activation's `via` names, or null. `via` has three shapes — `'augment'`,
 * `{ mod }`, `{ face }` (CR 109.8) — and only `{ mod }` names an entity. */
const viaMod = (via: ActivateVia | undefined): EntityId | null =>
  typeof via === 'object' && via !== null && 'mod' in via ? via.mod : null;

/** how a `via` reads in a reference key: the mod's symbol, or the face and which of its
 * texts (`String({face})` would make every face compare equal) */
const viaKey = (via: ActivateVia | undefined, sym: (id: EntityId) => string): string =>
  typeof via !== 'object' || via === null ? String(via ?? '-')
    : 'mod' in via ? `mod:${sym(via.mod)}`
      : `face:${via.face}:${via.text ?? '-'}${via.copy ? `:${via.copy}` : ''}`;   // a copy's k-th box

/** The entity ids an action names in its payload — the references a renumbering re-points. */
function entityRefs(a: Action): EntityId[] {
  switch (a.type) {
    case 'castSpellToken': return [a.entityId];
    case 'activateAbility': {
      const m = viaMod(a.via);
      return m === null ? [a.entityId] : [a.entityId, m];
    }
    case 'augment': return a.hostId === undefined ? [] : [a.hostId];
    case 'graft': return [a.hostId];
    case 'declareAttack': return [...a.columns.flat(), ...(a.spellTokens ?? [])];
    case 'declareBlocks':
      return [...Object.values(a.blocks).flat(), ...(a.send ?? []), ...(a.spellTokens ?? [])];
    // a fix that takes a unit off the board names it
    case 'amend': return a.edit.kind === 'unit' ? [a.edit.id] : [];
    default: return [];
  }
}

/** id → "which action created it, and the how-many-th entity of that action": the identity
 * that survives a renumbering. `floors[j]` is `nextId` as action `j` was applied; ids below
 * the first floor came out of the deal. */
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
 * What this action referred to, in the state it was applied to — resolved references (the
 * card at the index, the option's label, the entity's creation identity), never the raw
 * payload. It adds the RNG position if the action drew, and what it did to the actor's own
 * private zones: in 'shared' mode an undo can change a later draw without moving any index.
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
      // draftCommit indexes hand.concat(pack): name what the merged pile holds at each index
      const pile = [...(p?.hand ?? []), ...(s.packs?.[a.seat] ?? [])];
      parts.push(a.packIndices.map(i => at(pile, i)).join(','));
      break;
    }
    case 'bottomCards': parts.push(a.handIndices.map(i => at(p?.hand, i)).join(',')); break;
    case 'playCard': parts.push(at(p?.hand, a.handIndex), a.mode ?? '-'); break;
    case 'prophesy': parts.push(a.from, a.from === 'cache' ? at(p?.cache, a.index)
      : at(a.from === 'hand' ? p?.hand : p?.bin, a.index)); break;
    case 'playFromBin': parts.push(at(p?.bin, a.binIndex)); break;
    // CR 403.3b: the optional modes join the key only when present, so every
    // older playCached keys exactly as it always did
    case 'playCached': parts.push(at(p?.cache, a.index), ...(a.mode ? [a.mode] : []),
      ...(a.eraseGrant ? ['erase'] : [])); break;
    case 'castSpellToken': parts.push(sym(a.entityId), ...(a.ordered ? ['ordered'] : []),
      ...(a.firstPick ? ['first'] : [])); break;
    case 'activateAbility':
      parts.push(sym(a.entityId), String(a.abilityIndex), viaKey(a.via, sym));
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
      // never the decision's id: the suspension rollback takes decision ids off `nextId`, so a
      // renumbering moves them. The kind, option count and chosen labels are what it meant.
      const d = s.decision;
      const picked = (Array.isArray(a.choice) ? a.choice : [a.choice])
        .map(i => { const o = d?.options[i]; return o ? `${o.label}/${o.card ?? ''}` : '∅'; });
      parts.push(String(d?.kind ?? '-'), String(d?.options.length ?? 0), picked.join(','));
      break;
    }
    // what an agreed fix meant: the card at the index, the unit by creation identity, whose
    // draw and what it drew. An undo through a fix needs all of it unchanged (undoActionAt),
    // so a fix keeps meaning what both players agreed to.
    case 'amend': {
      const ed = a.edit;
      if (ed.kind === 'life') parts.push(`life:${ed.target}:${ed.life}`);
      else if (ed.kind === 'drawCards') parts.push(`draw:${ed.target}:${ed.n}`, zoneDelta(s, after, ed.target));
      else if (ed.kind === 'move') parts.push(`move:${ed.from}`, at(modZone(ed.from), ed.index), ed.to);
      else parts.push(`unit:${sym(ed.id)}:${ed.card}:${ed.to}`, zoneDelta(s, after, s.entities[ed.id]?.controller ?? a.seat));
      break;
    }
    // donePlanning / doneHaste / doneDeploying / passPriority / concede name nothing: their
    // payload is { type, seat }, so their key is their type.
    default: break;
  }
  if (drewRng) parts.push(`rng@${s.rngState}`);
  parts.push(zoneDelta(s, after, a.seat));
  return parts.join('|');
}

export interface Room {
  code: string;
  seed: number;
  mode: GameMode;
  /** draft mode: the chosen trio (sanitized); ignored in 'shared' */
  els: Element[];
  /** constructed mode: each seat's deck list (null = not brought yet). The
   * game does not really start until both are in — see roomWaiting(). */
  decks: [CardName[] | null, CardName[] | null];
  /** Constructed: the collection deck id each seat's deck came from, carried into the game
   * record so a deck's win/loss is folded from history, not kept as a counter. Null for a
   * logged-out seat, a pasted list, or an older game. */
  deckIds: [string | null, string | null];
  /** The matchmaker made this room, so the game moves both ratings. Set at creation and
   * never after: a room made from a code cannot become rated, which stops friends trading
   * wins up the ladder (rating.ts). Persisted: history.ts reads it back. */
  rated?: boolean;
  /** The league match this room settles (docs/20-league.md §5). Set at creation by
   * createLeagueRoom and never after; persisted for main.ts recordFinishedGame. A rematch
   * does not copy it: the first decided game settles the match. */
  league?: RoomLeague;
  /** Competitive's rules set (docs/22 §2.3), part of the DEAL like `custom`: `{sequential: true}`
   * on Competitive rooms, plus the `initiative` the previous game's loser chose (alone, in a
   * Casual match). Every fresh()/rebuild() passes it (test 822); an unreadable one throws on restore. */
  rules?: GameRules;
  /** CC: the match this room is one game of (server/match.ts), 1-based. The
   * match record holds everything that lasts between games; the room holds
   * only this link. Absent on every other room. */
  match?: RoomMatch;
  /** CR D8.4: the scenario this room was dealt with, persisted beside `seed` because it is
   * part of the deal — a room's state is a function of (seed, mode, els, decks, scenario,
   * actions), so every rebuild, restore and replay works on a scenario room unchanged. */
  scenario?: string;
  /** A live draft's custom rules and the deal they resolved to. Part of the DEAL like
   * `scenario`: every fresh()/rebuild() passes `custom?.deal` (test-custom-rules.ts scans for it). */
  custom?: RoomCustom;
  /** CR D8.2: a Single Card Duel — each deck thirty copies of one card. A seat brings a card
   * name, never a list; the game is kept out of every player fold and feeds the card ladder. */
  single?: true;
  /** CR D8.2c: the last pair this duel was drawn on — two spells that make no units, so
   * neither player could enter the other's region. Both seats are shown it and pick again;
   * cleared when a game is dealt. Persisted, never recorded. */
  singleDraw?: [CardName, CardName];
  names: [string, string];
  /** ACCOUNT id per seat (null = whoever sat here was not logged in). Set on
   * join from the token, persisted with the room, and read back when the game
   * is folded into the players' stats — see history.ts. */
  users: [string | null, string | null];
  /** Who won, stamped when it happened and persisted, never re-derived: an old log replayed
   * on a newer engine can stop short of its ending (as CR D1.2d's trigger order did), and a
   * replay never clears this. */
  winner: Seat | null;
  /** CR D8.5: if a concede decided this game, who and on which turn — stamped by applyToRoom
   * as it lands, persisted, and carried onto the RecordedGame (tiers: concession.ts).
   * Absent folds as `normal`. */
  concession?: Concession;
  state: GameState;
  actions: Action[];
  /** Every restore that could not faithfully rebuild this game, from when restores replayed
   * the log. Carried as it stands; nothing writes a new one (a restart resumes from `live`). */
  forks: Fork[];
  /** Which engine recorded which stretch of this log: one entry per engine, each naming the
   * action index it took over at (`versions[0]` at creation; a restore under another commit
   * appends one). It is what `replay-room.ts --as-recorded` diffs against. */
  versions: VersionStamp[];
  /** full authoritative event history, for per-seat redacted log resync */
  events: EngineEvent[];
  /** connected client per seat (null = nobody there) */
  sockets: [WebSocket | null, WebSocket | null];
  /**
   * Who is watching, and nothing else about them. A watcher is never a seat: `pickSeat` never
   * sees this set and `conns` has no entry for one, so nothing it sends can act in the game.
   * In memory only. The seats are told the count: an omniscient view is a cheating vector,
   * and both players seeing that somebody is there is what keeps it manageable.
   */
  watchers: Set<WebSocket>;
  /** which hidden simultaneous segment is open right now (null = none) */
  segKey: SegKey | null;
  /** the state as of the open segment's start — each seat's view of the
   * OPPONENT is served from this freeze until the segment closes */
  segSnapshot: GameState | null;
  /** events each seat has NOT yet been shown (their opponent's hidden moves
   * this segment); flushed as the "reveal" when the segment closes */
  heldEvents: [EngineEvent[], EngineEvent[]];
  /** the board after each held action (view.ts playbackFrames), slotted like `heldEvents`:
   * `heldFrames[s]` is the other seat's actions, held from `s`. Derived; rebuild() redoes it. */
  heldFrames: [HeldFrame[], HeldFrame[]];
  /** where a rebuild starts (pushBase): the latest of these at or before the
   * change. Nothing before `bases[0].at` is replayed, undone or rewound. In
   * memory only; a restore starts from the file's `live` block alone, so a
   * restart seals the open step. */
  bases: Resume[];
  /** the action that closed the open segment, set by applyToRoom at the moment
   * it does and read by main.ts before openSegment() clears it */
  closing: SegmentClose | null;
  /** index into `actions` where the open segment began (-1 outside one) —
   * undo may splice a seat's own actions at/after this point */
  segStartIndex: number;
  /** CR D2.1c: actions parked behind the other seat's open decision inside a hidden segment,
   * per seat, in arrival order. Never persisted: an action reaches `actions` only once applied,
   * so a saved log is exactly the game played; a restart drops the queue like a lost message. */
  deferred: [Action[], Action[]];
  /**
   * CR D4.3e: per action, what it showed each seat of the hidden cards (seen.ts `seenBy`; `[]`
   * for nothing). Derived, parallel to `actions`, measured only inside the open hidden segment
   * (rebuild() re-measures it). `undoForSeat` walks back no further than the seat's latest
   * revealing action; `undoActionAt` refuses a splice that changes what a later action showed.
   */
  segSeen: Seen[];
  /** the open step's actions whose `segSeen` entry is still to be measured;
   * `settleSeen` fills them in when an undo asks. DERIVED, like `segSeen`. */
  seenPending: SeenPending[];
  /** CR D4.6: ccundo.ts's mark for every applied action, parallel to `actions`. Derived: pushed
   * by applyToRoom, recomputed by rebuild(); `key: null` outside a sequential room. */
  ccMarks: CcUndoMark[];
  /** Per action, `state.nextId` as it was applied (derived). It says which ids an action
   * allocated, so an entity's identity survives a renumbering, and which ids a splice at `j`
   * would shift. */
  segIdFloor: number[];
  /** Per action, its reference key (referenceKey); the undo gate accepts only if every later
   * key is byte-identical. Its entity tags are process-local, so it is never compared across a
   * restart; it is saved as `refs` because cardledger.ts reads each key's zone-delta tail. */
  segRefs: string[];
  /**
   * The board fingerprint after each action, `digest(signature(state))`, taken by the engine
   * that applied it. PERSISTED, and a record, not a derivation: a replay compares against it to
   * find where it stopped being the same game. A recorded entry is never recomputed; only
   * `applyToRoom` and the spliced tail of `undoActionAt` write new ones.
   */
  sigs: string[];
  /**
   * What each action did to the cards (cardledger.ts cardFact), taken as it is applied; `null`
   * where the file has no record. `cardOpen` is the board before the first action. Never
   * recomputed, like `sigs`: a draft's deal depends on the card registry, so a replay of an
   * old draft deals different packs. Only `applyToRoom` and `undoActionAt`'s tail write it.
   */
  cardLog: (CardFact | null)[];
  cardOpen: CardOpen | null;
  /** This room's clock bank: persisted, chosen at creation, never changed; `null` is no clock
   * at all. Kept beside `clockMs` because that is what is left and this is what there was. A
   * file without it restores at `CLOCK_START_MS`, the bank it was played with. */
  clockStart: number | null;
  /** chess clock (MTGO-style): remaining ms per seat. Meaningless — and never
   * sent to a client — while `clockStart` is null. */
  clockMs: [number, number];
  /** Date.now() of the last clock settle — elapsed since then is still
   * unbilled and belongs to the seats in clockRun */
  clockStamp: number;
  /** which seats' clocks have been RUNNING since clockStamp */
  clockRun: [boolean, boolean];
  /**
   * How long the match took: one wall clock for the table. Not derivable from `clockMs` (two
   * banks are not one game's length, and a clockless room has none). Billed by `settleClock`
   * over the same instants as the banks, while `matchRunning` (dealt, not frozen, not decided,
   * both seats connected). 0, from an older file, reads as unknown.
   */
  matchMs: number;
  /** was the match clock running since `clockStamp` (cached like `clockRun`, so the bill uses
   * the state at the start of the interval) */
  matchRun: boolean;
  /** epoch ms of the first settle that found this match live: the raw wall interval, so
   * `matchMs`'s both-connected rule can be judged. Null until the game starts. */
  startedAt: number | null;
  /** The formation a seat is building, before they commit it. Never an action, purely
   * presentational (the declaration is public a moment later), and dropped when any action
   * lands. Held on the room so a reconnecting client picks it up. */
  building: [Formation | null, Formation | null];
  /** Which seats asked that nothing act for them. The browser owns this preference; the server
   * needs it only because `drainForced` runs here. One seat's soft state, not persisted: the
   * client re-asserts it on every join. */
  fullControl: [boolean, boolean];
  /**
   * The standing pass as the server holds it, so an armed seat's clock does not run. One
   * seat's soft state: never an action, not persisted, dropped on join, on disconnect and
   * whenever `passAllRelease` would release the client's arm (`settlePassAll`). It carries the
   * whole arm, not a boolean, so the server releases exactly when the client would and a
   * backstop pass is always one the client would have sent.
   */
  passAll: [PassAllArm | null, PassAllArm | null];
  /** The auto-pass toggle and auto-yield (ui/passrelease.ts `autoPassPlan`), so a window they
   * answer is unbilled, as with `passAll`. A preference, not a promise, so nothing in the game
   * releases it. Soft state, not persisted, dropped on join and on disconnect. */
  autoPass: [AutoPassPref | null, AutoPassPref | null];
  /** The window a Pass-all seat sits in unbilled: the `actionCount` it opened at and when it
   * was first seen. The backstop (main.ts `sweepPassAll`) passes once it is PASS_ALL_BACKSTOP_MS
   * old, so a closed tab cannot freeze a clock. Written only by `settlePassAll`. */
  passAllWait: [{ at: number; since: number } | null, { at: number; since: number } | null];
  /** The last window the backstop passed for a seat: its `actionCount`, and the log length
   * after. A later `passPriority` from that seat stamped at or below `at` is its own late answer
   * and is dropped (main.ts); `len` retires the entry if an undo rewinds below it. */
  passAllCovered: [{ at: number; len: number } | null, { at: number; len: number } | null];
  /**
   * Which seats have the Report dialog open. A standing pass holds meanwhile, so the report
   * is filed against the board it is about: the arm is kept and re-judged on release, but the
   * window is not stamped, so the backstop does not fire and the holder's clock runs (which
   * bounds the hold). Soft state, not persisted, cleared on disconnect.
   */
  reportHold: [boolean, boolean];
  /** A seat watching a playback is not on the clock. A deadline, not a flag, so a client that
   * never says it is done cannot freeze a bank (main.ts playbackBudget). A "watch again" is not
   * held. Soft state, not persisted, cleared on disconnect. */
  watchHold: [number | null, number | null];
  /** When the action log last changed (an action, an undo, a re-deal); the idle sweep measures
   * from here. Persisted, because a restart must not reset it: a boot rewrites every file, so
   * mtime cannot age a room. An older file is backfilled by `lastActionOf`. */
  lastActionAt: number;
  /** Since when nobody (seat or watcher) has been in the room, as the idle sweep last saw it.
   * In memory only, owned by `sweepIdleRooms`: a restart restarts the count, giving a tab open
   * across a deploy the grace to come back. */
  unattendedSince: number | null;
  /** set only on the way out — see RoomClosed. A room holding it is never in
   * the map again. */
  closed?: RoomClosed;
  /** Draft mode: the room where the trio is chosen. Nothing is dealt until the trio is settled
   * and both players are in, so nobody studies the first pack alone. Elements picked when the
   * code was reserved make a 'chosen' lobby; null for a room created with an explicit trio
   * otherwise, which deals immediately. */
  lobby: Lobby | null;
  /** post-game: which seats have asked for a rematch. In memory only — a
   * rematch offer does not deserve to outlive the tab it was made in. */
  rematch: [boolean, boolean];
  /** the room a rematch moved to, so a straggler who clicks late (or
   * reconnects into the finished game) is still sent where their opponent
   * went rather than into a second, empty rematch */
  rematchRoom: string | null;
  /** Every agreed fix this game took (`Amendment`, types.ts). Persisted: the history's "fixed"
   * tag and the archive of what a rewind took back. A claim about THIS log, so a re-deal drops
   * it (resetSegment) and a rematch starts without it. */
  amendments: Amendment[];
  /** Who disputed this game's result from the post-game screen, and why; at most one per seat.
   * Persisted: the history's "disputed" tag. It changes nothing else. */
  disputes: Dispute[];
  /** The fix waiting for the other seat's answer, if any. Soft state like `rematch`, not
   * persisted; dropped when any action lands, on undo, disconnect, decline or cancel, and 60 s
   * after it was made. Both clocks stop while it stands (`clockRunning`). */
  proposal: Proposal | null;
  /** per seat, until when a proposal is refused after a decline (ms since the epoch; 0 = none).
   * Soft, like `proposal`. */
  fixCooldown: [number, number];
  /** The agreed fixes not yet filed as a bug report (FixRun). Persisted, so a restart between a
   * fix and the next move still files it (main.ts flushes every restored run at boot). */
  fixRun: FixRun | null;
}

/** A run of agreed fixes — consecutive, with no game action between — files ONE report row
 * when it ends (main.ts flushFixRun). It waits rather than amending: report ids are line
 * indexes of an append-only journal, so a row is written once. */
export interface FixRun {
  /** index in `amendments` of the run's first fix */
  from: number;
  /** the log length the FIRST fix was proposed at — the row's `actionIndex` */
  at: number;
  /** the log length after the latest fix (forced steps drained): a fix
   * proposed on exactly this log continues the run */
  len: number;
  /** ms since the epoch of the latest fix — the idle sweep's clock */
  last: number;
}

/** how long a run of fixes waits for a move before it is filed anyway */
export const FIX_RUN_IDLE_MS = 10 * 60_000;

/** see Room.league */
export interface RoomLeague { season: string; match: string }

/** see Room.match */
export interface RoomMatch { id: string; game: number }

/** A saved `match` link, or null if it is not one. */
export const sanitizeRoomMatch = (raw: unknown): RoomMatch | null => sanitizeMatchLink(raw);

/** A saved room's CC rules (docs/22 §2.3): scenarios.ts savedRules, the one reader every deal
 * of a saved room uses, under its old name. */
export const restoreRules = savedRules;

/** A saved `league` tag, or null if it is not one. */
export function sanitizeLeague(raw: unknown): RoomLeague | null {
  const r = raw as { season?: unknown; match?: unknown } | null;
  return r && typeof r.season === 'string' && typeof r.match === 'string' && r.season && r.match
    ? { season: r.season.slice(0, 40), match: r.match.slice(0, 80) } : null;
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
 * counterattackers being set aside (round-1 blocks), and — CR 606.4a — the block
 * columns to the LEFT of the attack, `left[0]` just left of column 1 */
export interface Formation { cols: number[][]; send: number[]; left?: number[][] }

/** The default chess-clock bank per player, read only at room creation (and by a restore of a
 * file older than the setting, which was played at this bank). Anything wanting this room's
 * bank wants `room.clockStart`. */
export const CLOCK_START_MS = 60 * 60 * 1000;

/**
 * The bank a matchmade room gets, per format. It must not come from either player's picker:
 * one player's "Off" would hand the other an untimed rated game. The UI keeps its own copy
 * (`CLOCK_DEFAULT_BY_MODE`, ui/main.ts), and 279-queue-and-rating.test.ts fails if they disagree.
 */
export const MATCH_CLOCK_MS: Record<'constructed' | 'draft', number> = {
  constructed: 45 * 60 * 1000,
  draft: 60 * 60 * 1000,
};

/** Bounds on a per-room bank, in ms: they reject nonsense, they do not choose presets. The
 * floor is low on purpose: a one-second bank is what makes the time-loss rule testable at speed. */
export const MIN_CLOCK_MS = 1000;
export const MAX_CLOCK_MS = 6 * 60 * 60 * 1000;

/**
 * A bank requested off the wire, as the setting a room is created with. `null` is no clock at
 * all — a real setting, never a large number.
 *   undefined            → the default
 *   null / 0 / 'off'     → off
 *   a number of ms       → clamped into [MIN_CLOCK_MS, MAX_CLOCK_MS]
 *   anything else        → the default, never a throw: a junk field must not stop a room being created
 */
export function sanitizeClock(v: unknown): number | null {
  if (v === undefined) return CLOCK_START_MS;
  if (v === null || v === 'off' || v === 0 || v === '0') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return CLOCK_START_MS;
  return Math.round(Math.min(MAX_CLOCK_MS, Math.max(MIN_CLOCK_MS, n)));
}

/** Which seats' clocks should run right now: the game is waiting on a seat
 * iff it has at least one legal action (covers pending decisions, priority,
 * draft picks, and the simultaneous planning/deploy done-flags — both clocks
 * may run at once during simultaneous phases, which is correct). Clocks only
 * run while BOTH players are connected (casual client: waiting alone for an
 * opponent, a dropped tab, or a room restored after a server restart must
 * not silently drain anybody), and a finished game stops both clocks. */
export function matchRunning(room: Room): boolean {
  if (roomWaiting(room)) return false;
  if (room.state.winner !== null || room.state.phase === 'gameover') return false;
  // a game decided outside the state (a loss on time, a stamped result whose replay stopped
  // short): without this, the next settle would restart both banks on a game that is over
  if (decidedOutsideState(room)) return false;
  if (!room.sockets[0] || !room.sockets[1]) return false;
  return true;
}

export function clockRunning(room: Room): [boolean, boolean] {
  // a room with no clock runs none — first, so "off" is a property of the room
  if (room.clockStart === null) return [false, false];
  // the banks stop for exactly the match clock's reasons, plus "no clock" above
  if (!matchRunning(room)) return [false, false];
  // both clocks stop while a proposed fix waits for its answer (it lapses after FIX_PROPOSAL_MS)
  if (room.proposal) return [false, false];
  // A seat whose standing pass, auto-pass or yield answers THIS window is not billed for it.
  // `passAllWait` (set by `settlePassAll`, which settleClock runs first) marks only a real pass
  // window, so a decision, a target or a declaration is still billed. Nor is a seat watching a playback.
  return [0, 1].map(s => legalActions(room.state, s as 0 | 1).length > 0
    && room.passAllWait[s]?.at !== room.state.actionCount
    && room.watchHold[s] === null) as [boolean, boolean];
}

/* The standing pass. The client tells the server its arm; the seat's clock stops while the arm
 * answers the window in front of it, and if its pass has not arrived within PASS_ALL_BACKSTOP_MS
 * the server sends it (main.ts `sweepPassAll`), so a closed tab cannot freeze a game. */

/** The arm as it rides the wire: ui/battle.ts `armSnapshot`, taken once at the
 * click. The `armed` bit is the field being non-null. */
export interface PassAllArm {
  mode: PassMode;
  armedPhase: Phase;
  armedItems: EntityId[];
  armedOpts: string[];
}

/** How long an armed seat may sit in one window, unbilled, before the server
 * passes for it. The client's own pass takes the pace hold (up to PACE_MS),
 * the stagger (STAGGER_MS) and a round trip, so it normally lands first; this
 * is the backstop, not the tempo. */
export const PASS_ALL_BACKSTOP_MS = 2000;

/** A `passall` message's arm, off the wire. Never throws: a junk field is an
 * arm with nothing in scope, which `passAllRelease` releases conservatively
 * ('stack' mode hands back on any stack item it does not know). */
export function sanitizePassAll(raw: Record<string, unknown>): PassAllArm | null {
  if (raw['on'] !== true) return null;
  const ids = Array.isArray(raw['items']) ? raw['items'] : [];
  const opts = Array.isArray(raw['opts']) ? raw['opts'] : [];
  return {
    mode: raw['mode'] === 'stack' ? 'stack' : 'all',
    armedPhase: (typeof raw['phase'] === 'string' ? raw['phase'].slice(0, 32) : 'battle') as Phase,
    armedItems: ids.filter((n): n is number => Number.isInteger(n)).slice(0, 256),
    armedOpts: opts.filter((k): k is string => typeof k === 'string').slice(0, 512).map(k => k.slice(0, 256)),
  };
}

/** The auto-pass toggle and the yields as they ride the wire: the two inputs `autoPassPlan`
 * takes besides the window. */
export interface AutoPassPref {
  /** the auto-pass toggle is on */
  pref: boolean;
  /** the units whose triggers this seat yields to */
  yields: EntityId[];
}

/** An `autopass` message off the wire; null when it asks for nothing. Never
 * throws: a junk field is a preference that answers nothing. */
export function sanitizeAutoPass(raw: Record<string, unknown>): AutoPassPref | null {
  const pref = raw['pref'] === true;
  const yields = (Array.isArray(raw['yields']) ? raw['yields'] : [])
    .filter((n): n is number => Number.isInteger(n)).slice(0, 256);
  return pref || yields.length ? { pref, yields } : null;
}

/** One seat's auto-pass toggle and yields; true when anything changed. The
 * window stamp restarts either way, as `setPassAll`'s does. */
export function setAutoPass(room: Room, seat: Seat, p: AutoPassPref | null): boolean {
  const was = room.autoPass[seat];
  room.autoPass[seat] = p;
  room.passAllWait[seat] = null;
  return JSON.stringify(was) !== JSON.stringify(p);
}

/** One seat's standing pass. Refused (false) while that seat has full control
 * on, which drops every automatic answer; otherwise true when anything
 * changed. The window stamp restarts either way. */
export function setPassAll(room: Room, seat: Seat, arm: PassAllArm | null): boolean {
  if (arm && room.fullControl[seat]) return false;
  const was = room.passAll[seat];
  room.passAll[seat] = arm;
  room.passAllWait[seat] = null;
  return was !== null || arm !== null;
}

/**
 * Re-judge each seat's standing pass against the state now: drop an arm the client's release
 * would drop, and stamp the window an arm answers. Run by settleClock, so every state a client
 * is shown is judged here first. The release is the client's own `passAllRelease`, never a
 * mirror (CR D1.3); the server's state is never older, so it releases no later than the client.
 */
function settlePassAll(room: Room, now: number): void {
  const s0 = room.state;
  const over = s0.winner !== null || s0.phase === 'gameover' || decidedOutsideState(room);
  for (const seat of [0, 1] as const) {
    const arm = room.passAll[seat];
    if (arm && over) room.passAll[seat] = null;
    let held = false;
    if (room.passAll[seat] && room.clockStart !== null && matchRunning(room)) {
      const legal = legalInRoom(room, seat);
      const release = passAllRelease(s0, seat, legal, {
        armed: true, mode: arm!.mode, armedPhase: arm!.armedPhase,
        armedStack: arm!.armedItems.length, armedSig: [],
        armedItems: arm!.armedItems, armedOpts: arm!.armedOpts,
        // the two inputs that are not the arm, and that passAllRelease never reads
        prefOn: false, yieldIds: new Set(),
      });
      if (release !== null) room.passAll[seat] = null;
      // a seat with its report dialog open keeps its arm but is not answered for: no stamp, so
      // no backstop and no unbilled window
      else held = !room.reportHold[seat] && !room.proposal && inPassWindow(s0, seat, legal);
      // …nor while a proposed fix waits: a pass would land an action, which ends the proposal
    }
    // …and a window the auto-pass toggle or a yield answers, on the same terms (the client's
    // own `autoPassPlan`). Full control drops every automatic answer; the report dialog and a
    // proposed fix hold them, as they hold the arm above.
    const auto = room.autoPass[seat];
    if (!held && auto && !room.fullControl[seat] && !room.reportHold[seat] && !room.proposal
      && room.clockStart !== null && matchRunning(room)) {
      const legal = legalInRoom(room, seat);
      const plan = autoPassPlan(s0, seat, legal, {
        armed: false, armedStack: 0, armedSig: [],
        prefOn: auto.pref, yieldIds: new Set(auto.yields),
      });
      held = plan.pass !== null && inPassWindow(s0, seat, legal);
    }
    const w = room.passAllWait[seat];
    if (!held) room.passAllWait[seat] = null;
    else if (!w || w.at !== s0.actionCount) room.passAllWait[seat] = { at: s0.actionCount, since: now };
  }
}

/**
 * The seat the backstop should pass for right now, or null. The cheap gate is
 * the cached stamp (no engine call for a room nobody has armed in); an overdue
 * stamp is re-judged by a settle before it is trusted, so a window that has
 * just released, or that the client has just answered, is never passed.
 */
export function passAllDue(room: Room, now: number): Seat | null {
  const late = (s: Seat): boolean => {
    const w = room.passAllWait[s];
    return !!w && w.at === room.state.actionCount && now - w.since >= PASS_ALL_BACKSTOP_MS;
  };
  if (!late(0) && !late(1)) return null;
  settleClock(room);
  for (const s of [0, 1] as const) if ((room.passAll[s] || room.autoPass[s]) && late(s)) return s;
  return null;
}

/** Record a backstop pass, so the client's own late answer to the same
 * window can be recognised (see `Room.passAllCovered`). */
export function notePassAllCovered(room: Room, seat: Seat, at: number): void {
  room.passAllCovered[seat] = { at, len: room.actions.length };
}

/** Is this `passPriority`, stamped with the count of the view it answered, a
 * late answer to a window the backstop already passed? */
export function passAllStale(room: Room, seat: Seat, at: unknown): boolean {
  const c = room.passAllCovered[seat];
  if (!c || typeof at !== 'number') return false;
  if (room.actions.length < c.len) { room.passAllCovered[seat] = null; return false; }
  return at <= c.at;
}

/** Bill the time since the last settle to the running seats, clamp at zero, and recompute the
 * running set. Call after anything that changes the state or the connections. Reaching zero
 * loses the game (`expiredSeat` / `expireOnTime`). */
export function settleClock(room: Room): void {
  const now = Date.now();
  const dt = Math.max(0, now - room.clockStamp);
  for (const s of [0, 1] as const) {
    if (room.clockRun[s]) room.clockMs[s] = Math.max(0, room.clockMs[s] - dt);
  }
  // the table's own clock, billed off the same stamp and interval as the banks. It counts up
  // and has no floor: a record, not a resource.
  if (room.matchRun) room.matchMs += dt;
  room.clockStamp = now;
  settlePassAll(room, now);   // before clockRunning, which reads its stamp
  // a playback hold whose deadline has passed lapses here, so the seat is back
  // on the clock from this instant (the sweep in main.ts makes sure this runs)
  for (const s of [0, 1] as const) {
    const w = room.watchHold[s];
    if (w !== null && now >= w) room.watchHold[s] = null;
  }
  room.clockRun = clockRunning(room);
  room.matchRun = matchRunning(room);
  // the first instant this match was live, kept raw so the "both connected"
  // rule above can be judged against the wall rather than trusted
  if (room.matchRun && room.startedAt === null) room.startedAt = now;
}

/** What a client is told about this room's clocks. `start` is the bank the room was created
 * with, so a seat joining late still sees it. */
export interface ClockSnapshot {
  ms: [number, number];
  running: [boolean, boolean];
  at: number;
  /** the bank this room was created with */
  start: number;
}

/** The clock snapshot attached to every state broadcast; clients extrapolate from `at` using
 * `running`. `null` for a room with the clock off, and the caller omits the field, so the
 * client shows no clocks rather than a frozen one. */
export function clockSnapshot(room: Room): ClockSnapshot | null {
  if (room.clockStart === null) return null;
  settleClock(room);
  return {
    ms: [...room.clockMs], running: [...room.clockRun], at: room.clockStamp,
    start: room.clockStart,
  };
}

/* Running out of time loses the game, so a losing player cannot stall it forever. The decision
 * lives here; the noticing lives in main.ts's sweep, because expiry is the one game event with
 * no action behind it. */

/**
 * Which seat (if any) has run out of time right now, against billed time (it settles first).
 *   clockStart === null   nothing expires in a room with no clock
 *   already decided       idempotent: the sweep runs every second
 *   roomWaiting           there is no game yet
 *   clockRun[s]           a disconnected seat does not bleed time (`clockRunning` is
 *                         [false, false] unless both sockets are present)
 */
export function expiredSeat(room: Room): Seat | null {
  if (room.clockStart === null) return null;
  if (gameDecided(room)) return null;
  if (roomWaiting(room)) return null;
  // The cheap gate: `clockRun` is the cached running set, kept by settleClock at every event
  // that could change it, so this is two subtractions. Settle (which runs `legalActions`) only
  // when a bank could have reached zero.
  const dt = Math.max(0, Date.now() - room.clockStamp);
  const maybe = ([0, 1] as const).some(s => room.clockRun[s] && room.clockMs[s] - dt <= 0);
  if (!maybe) return null;
  settleClock(room);
  for (const s of [0, 1] as const) {
    if (room.clockRun[s] && room.clockMs[s] <= 0) return s;
  }
  return null;
}

/**
 * A seat has run out of time: end the game, stamp the result, tell the log. Returns the losing
 * seat, or null. The result is STAMPED (`Room.winner`), never logged as an action: the clock is
 * wall time, not game state, so a pseudo-action would stop the log reproducing its game. The
 * note is returned as well as pushed, because the caller must put it on the wire.
 */
export function expireOnTime(room: Room): { loser: Seat; events: EngineEvent[] } | null {
  const loser = expiredSeat(room);
  if (loser === null) return null;
  const winner = other(loser);
  room.winner = winner;
  // nothing runs in a decided game, and the sweep must not look at this room
  // again before the next settle proves it
  room.clockRun = [false, false];
  const note = {
    type: 'note',
    msg: `⏱ ${room.names[loser]} ran out of time. ${room.names[winner]} wins.`,
    data: { winner, loser, onTime: true },
  } as unknown as EngineEvent;
  room.events.push(note);
  console.log(`[rooms] ${room.code}: seat ${loser} lost on time; seat ${winner} wins`);
  persist(room);
  return { loser, events: [note] };
}

const rooms = new Map<string, Room>();

/** Build a fresh game and its initial event list. CR D8.4: every caller passes the room's own
 * `scenario`; forgetting it deals an ordinary game, the safe direction. */
function fresh(seed: number, names: [string, string], mode: GameMode, els: Element[], decks?: [CardName[], CardName[]], scenario?: string, deal?: DraftDeal, rules?: GameRules): { state: GameState; events: EngineEvent[] } {
  // Forgetting `deal` (a custom draft) or `rules` (a CC game) is NOT safe: the room would be
  // re-dealt as a standard game under its own log. Test 822 and test-custom-rules.ts check every call.
  const r = dealScenario(seed, names, mode, els, decks, scenario, deal, rules);
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

/** Who won: the live state first, then the stamp (an old log may no longer replay to its
 * ending). null while the game goes on, and in a drawn game: "is it over" is `gameDecided`. */
export const decidedWinner = (room: Room): Seat | null => room.state.winner ?? room.winner;

/** Is this game over: won, lost on time, or drawn (CR 104.1b — phase 'gameover', no winner). */
export const gameDecided = (room: Room): boolean =>
  room.state.phase === 'gameover' || decidedWinner(room) !== null;

/** Decided by something the state does not know: a stamped result its replay no longer reaches,
 * or a loss on time (the clock is not game state, and must not become it). So `legalInRoom`
 * offers nothing and `applyToRoom` refuses. */
const decidedOutsideState = (room: Room): boolean =>
  room.state.winner === null && room.winner !== null;

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
  // a league room's trio is drawn at random, full stop (docs/20 §5); a picked one stays picked
  if (room.league || lobby.method === 'chosen') return false;
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

/** One seat's "nothing may act for me". Soft state: nothing logs, stamps or saves. True when it
 * changed, so a caller can skip a repaint. */
export function setFullControl(room: Room, seat: Seat, on: boolean): boolean {
  // the client drops a standing pass when full control goes on; the server's copy goes with it,
  // whatever order the two messages arrive in
  if (on) setPassAll(room, seat, null);
  if (room.fullControl[seat] === on) return false;
  room.fullControl[seat] = on;
  return true;
}

/** One seat's playback hold (`Room.watchHold`): a deadline, or null to release it. True when it
 * changed; the caller settles the clock. */
export function setWatchHold(room: Room, seat: Seat, until: number | null): boolean {
  if (room.watchHold[seat] === until) return false;
  room.watchHold[seat] = until;
  return true;
}

/** Is a playback hold past its deadline and not yet lapsed? (main.ts's sweep
 * settles the clock for such a room, which is what lapses it.) */
export function watchHoldExpired(room: Room, now: number): boolean {
  return room.watchHold.some(w => w !== null && now >= w);
}

/** One seat's report-dialog hold (`Room.reportHold`). Soft state: nothing logs, stamps or
 * saves. True when it changed. */
export function setReportHold(room: Room, seat: Seat, on: boolean): boolean {
  if (room.reportHold[seat] === on) return false;
  room.reportHold[seat] = on;
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
    chosen: room.els,
    rng: room.seed,
    count: roomElementCount(room),
  });
  lobby.result = result;
  room.els = sanitizeTrio(result.els, roomElementCount(room));
  const { state, events } = fresh(room.seed, room.names, room.mode, room.els, undefined, room.scenario, room.custom?.deal, room.rules);
  room.state = state;
  room.actions = [];
  room.events = events;
  // the dealt game's first segment starts here, or the freeze would hold the placeholder (and its
  // placeholder names) for all of turn 1
  resetSegment(room);
  room.clockStamp = Date.now();
  persist(room);
  return result;
}

/** CR D8.2: the two cards of a single card duel, seat order — null for any other
 * room, and for one still waiting on a card. What the history row, the
 * post-game tag and the card ladder all read; nothing re-derives it. */
export function singleCards(room: Pick<Room, 'single' | 'decks'>): [CardName, CardName] | null {
  return room.single ? singleCardsOf(room.decks) : null;
}

/** The stand-in deck of a constructed league room before either player has picked: the league
 * creates the room before anybody has chosen. The state built from it is never dealt; it is
 * thrown away when the second deck is in. */
const leaguePlaceholderDeck = (): CardName[] => {
  const c = checkSingleCard(DECK_LIST[0]);
  if (!c.ok) throw new Error(`no placeholder deck: ${c.error}`);
  return c.cards;
};

/** the decks to build a constructed room's state from: any missing deck is
 * stood in for by the other one (placeholder games are never played) — and a
 * league room with neither yet by the placeholder above */
function decksFor(room: Pick<Room, 'decks'> & { league?: RoomLeague | null; match?: RoomMatch | null }): [CardName[], CardName[]] {
  const a = room.decks[0] ?? room.decks[1];
  const b = room.decks[1] ?? room.decks[0];
  if (!a || !b) {
    // …and a CC game room after game 1, created before anybody has brought a deck
    if (room.league || room.match) { const p = leaguePlaceholderDeck(); return [p, p]; }
    throw new Error('a constructed room needs at least one deck');
  }
  return [a, b];
}

/**
 * Does a deck riding on a join register for this seat? The client sends its selected deck with
 * every join, but that is only what this browser last selected, so it counts only when the join
 * creates a friend's constructed room (`creates`: the deck was shown beside Create) or is the
 * waiting room's own "Play this deck" (`pick`). Every other join registers nothing.
 */
export function takesJoinDeck(room: Pick<Room, 'league' | 'match'>, pick: boolean, creates = false): boolean {
  // docs/22 §2.4: a CC room never takes a join's deck: game 1 registers through server/match.ts,
  // and games 2–3 are dealt from the match's locked configurations
  if (room.match) return false;
  return pick || (creates && !room.league);
}

/**
 * Register `seat`'s deck (validated) while the room is waiting; when it completes the pair the
 * real game is dealt and the placeholder discarded. True when the game just started.
 * Constructed rooms only (`single` rooms are, CR D8.2): `roomWaiting` is also true of every
 * draft room still in its lobby, and the client sends a deck on every join.
 */
export function setRoomDeck(room: Room, seat: 0 | 1, cards: CardName[], deckId: string | null = null): boolean {
  if (room.mode !== 'constructed') return false;
  if (!roomWaiting(room)) return false;
  room.decks[seat] = [...cards];
  room.deckIds[seat] = deckId;
  let complete = !!room.decks[0] && !!room.decks[1];
  // CR D8.2c: two cards that can never make a unit are a DRAW, not a game: nothing is dealt or
  // recorded, each seat is told the pair, and both choose again (the same card is allowed).
  const pair = complete ? singleCards(room) : null;
  if (pair && !makesUnits(pair[0]) && !makesUnits(pair[1])) {
    room.singleDraw = pair;
    room.decks = [null, null];
    room.deckIds = [null, null];
    complete = false;
  } else if (complete) {
    delete room.singleDraw;
  }
  if (complete) {
    const { state, events } = fresh(room.seed, room.names, room.mode, room.els, decksFor(room), room.scenario, room.custom?.deal, room.rules);
    room.state = state;
    room.actions = [];
    room.events = events;
    resetSegment(room);   // same as resolveLobby: the real game's turn 1
    room.clockStamp = Date.now();
  }
  persist(room);
  return complete;
}

/** CR D4.6: what one applied action means to a CC take-back — the engine's mark (ccundo.ts)
 * and, inside the open CC step, the measured floor (seen.ts). Outside a hidden segment both
 * players watch every event live, so whatever reached either seat is shown. */
function ccMeasure(before: GameState, a: Action, after: GameState, events: readonly EngineEvent[], names: readonly [string, string]): { mark: CcUndoMark; seen: Seen | null } {
  if (!before.sequential) return { mark: blankMark(a.seat), seen: null };
  const mark = ccUndoMark(before, a, after, events);
  return { mark, seen: mark.key !== null ? seenBy(before, a, after, events, { frozen: null, holding: false, names: [...names] as [string, string] }) : null };
}
/** the mark of an action no CC walk can cross: no step key ends the trailing run */
const blankMark = (seat: Seat): CcUndoMark => ({ key: null, seat, barrier: null, leftDecision: false, decide: false });

/** A point a room can be rebuilt from: the board after `at` actions, the
 * length of the event history then, and the hidden step as it stood. */
export interface Resume {
  at: number; ev: number; state: GameState;
  seg: { start: number; snapshot: GameState | null; held: [EngineEvent[], EngineEvent[]]; frames: [HeldFrame[], HeldFrame[]] };
}

/** copies of the held arrays: the room goes on pushing into its own */
const point = (at: number, ev: number, state: GameState, start: number, snapshot: GameState | null,
  held: [EngineEvent[], EngineEvent[]], frames: [HeldFrame[], HeldFrame[]]): Resume =>
  ({ at, ev, state, seg: { start, snapshot, held: [[...held[0]], [...held[1]]], frames: [[...frames[0]], [...frames[1]]] } });

/** the room's current point. `persist` runs mid-tick, before main.ts opens the
 * next segment, so a changed key is written as the segment openSegment will open. */
function resumePoint(room: Room): Resume {
  const { state } = room, key = segmentKey(state), n = room.actions.length;
  return key === room.segKey
    ? point(n, room.events.length, state, room.segStartIndex, room.segSnapshot, room.heldEvents, room.heldFrames)
    : point(n, room.events.length, state, key ? n : -1, key ? structuredClone(state) : null, [[], []], [[], []]);
}

/** A new step's start joins the bases. Kept: the starts of the previous and the
 * current step (what an undo rebuilds from), and at most two older ones at least
 * FIX_REWIND_WINDOW apart (so the oldest lies at or past a rewind's reach) —
 * never a chain of states. */
function pushBase(bases: Resume[], p: Resume): Resume[] {
  const all = [...bases, p], older: Resume[] = [];
  for (const b of all.slice(0, -2)) if (!older.length || b.at - older.at(-1)!.at >= FIX_REWIND_WINDOW) older.push(b);
  return [...older.slice(-2), ...all.slice(-2)];
}

/** `s` carrying the room's seat names, which renameSeat writes outside the log */
const named = (s: GameState, names: readonly string[]): GameState =>
  s.players.every((p, i) => p.name === names[i]) ? s
    : { ...s, players: s.players.map((p, i) => ({ ...p, name: names[i] ?? p.name })) };

interface Rebuilt {
  bases: Resume[];
  ccMarks: CcUndoMark[];
  state: GameState;
  events: EngineEvent[];
  segKey: SegKey | null;
  segSnapshot: GameState | null;
  heldEvents: [EngineEvent[], EngineEvent[]];
  heldFrames: [HeldFrame[], HeldFrame[]];
  segStartIndex: number;
  segSeen: Seen[];
  segIdFloor: number[];
  segRefs: string[];
  /** The board fingerprint after each action as THIS engine sees it; `''` where refused (an
   * unmoved board's fingerprint would read as a match). An answer, not the record: only
   * `undoActionAt`'s spliced tail, which is new history, may adopt it. */
  sigs: string[];
  /** this engine's card facts per action (null where refused). Like `sigs`, an answer, not the
   * record: only an undo's spliced tail may adopt it. */
  cardLog: (CardFact | null)[];
  /** logged actions this rebuild could not apply (see LostAction) */
  skipped: LostAction[];
}

/** Re-run the room's actions from `b`, one of its bases, accumulating the full
 * event history and the hidden-segment bookkeeping; the bookkeeping for the
 * actions before the base is carried unchanged. Tolerant: an action that no
 * longer applies after an undo's splice is skipped and reported in `skipped`,
 * which undoActionAt measures. */
function rebuild(p: Room, b: Resume): Rebuilt {
  const { actions, names } = p, at = b.at;
  let state = named(b.state, names);
  const all = p.events.slice(0, b.ev);
  let segKey = segmentKey(state);
  let bases = p.bases.filter(x => x.at <= b.at);
  const seg0 = bases.at(-1)!.seg;
  let { start: segStartIndex, snapshot: segSnapshot } = seg0;
  let heldEvents: [EngineEvent[], EngineEvent[]] = [[...seg0.held[0]], [...seg0.held[1]]];
  let heldFrames: [HeldFrame[], HeldFrame[]] = [[...seg0.frames[0]], [...seg0.frames[1]]];
  const segSeen: Seen[] = p.segSeen.slice(0, at);
  const segIdFloor: number[] = p.segIdFloor.slice(0, at);
  const segRefs: string[] = p.segRefs.slice(0, at);
  const ccMarks: CcUndoMark[] = p.ccMarks.slice(0, at);
  const sigs: string[] = p.sigs.slice(0, at);
  const cardLog: (CardFact | null)[] = p.cardLog.slice(0, at);
  const skipped: LostAction[] = [];
  // CR D4.3e: the OPEN segment's applied actions, measured once the loop knows
  // which segment that is (it is the only one an undo can walk)
  let inSegment: { i: number; before: GameState; a: Action; after: GameState; events: EngineEvent[] }[] = [];
  for (let i = at; i < actions.length; i++) {
    const a = actions[i]!;
    const before = state;
    // recorded BEFORE the action runs, and before its own floor is pushed:
    // every id it can name was allocated by an earlier action
    const sym = symbolizer(actions, segIdFloor, i, before.nextId);
    segIdFloor.push(before.nextId);
    // hold only while the open segment is still this action's: the forced battle drain runs
    // public actions after the key has moved on, and an agreed fix is public
    const isFix = a.type === 'amend';
    const holding = !isFix && segKey !== null && segmentKey(before) === segKey;
    let r;
    try {
      r = apply(state, a);
    } catch (err) {
      if (err instanceof IllegalAction) {
        skipped.push({ i, type: a.type, seat: a.seat, why: err.message, kind: 'lost' });
        segSeen.push(NOTHING_SEEN);   // keep the index alignment with `actions`
        ccMarks.push(blankMark(a.seat));
        segRefs.push(`refused:${err.message}`);
        sigs.push('');            // no board moved, so there is nothing to fingerprint
        cardLog.push(null);
        continue;
      }
      throw err;
    }
    segRefs.push(referenceKey(before, r.state, a, sym, before.rngState !== r.state.rngState));
    state = r.state;
    sigs.push(digest(signature(state)));
    cardLog.push(cardFact(before, state, a, r.events));
    all.push(...r.events);
    segSeen.push(NOTHING_SEEN);   // the open segment's entries are filled in below
    // CR D4.6: a CC game's take-back marks, and its measured floor (no segment there)
    const cc = ccMeasure(before, a, state, r.events, names);
    ccMarks.push(cc.mark);
    if (cc.seen) segSeen[i] = cc.seen;
    if (holding) inSegment.push({ i, before, a, after: state, events: r.events });
    // the frozen board shows an agreed fix as applyToRoom patched it, or a restart would un-show it
    if (isFix && segKey !== null && segSnapshot && segmentKey(state) === segKey) {
      segSnapshot = amendFrozen(segSnapshot, a as Extract<Action, { type: 'amend' }>, before);
    }
    // CR D6.1a, D6.2: EVERY event of a hidden step is held for the barrier, a reveal included
    const now = segmentKey(state);
    if (holding) {
      const held = [...r.events];
      heldEvents[seatSlot(other(a.seat))].push(...held);
      // the same frames applyToRoom keeps, so an undo or a restart inside a
      // step does not cost the opponent their playback
      if (now === segKey && held.length) heldFrames[seatSlot(other(a.seat))].push({ state: structuredClone(state), events: held });
    }
    if (now !== segKey) {
      segKey = now;
      segSnapshot = now ? structuredClone(state) : null;
      segStartIndex = now ? i + 1 : -1;
      heldEvents = [[], []];
      heldFrames = [[], []];
      inSegment = [];
    }
    // a new step starts: a base, as applyToRoom takes one
    if (stepKey(before) !== stepKey(state)) bases = pushBase(bases, point(i + 1, all.length, state, segStartIndex, segSnapshot, heldEvents, heldFrames));
  }
  // CR D4.3f: the same measurement applyToRoom takes as each action lands, against
  // the same frozen board — so a restart, or the rebuild an undo does, keeps
  // the floor exactly where play left it
  if (segKey !== null) {
    for (const x of inSegment) {
      segSeen[x.i] = seenBy(x.before, x.a, x.after, x.events, { frozen: segSnapshot, holding: true, names });
    }
  }
  return { bases, state, events: all, segKey, segSnapshot, heldEvents, heldFrames, segStartIndex, segSeen, segIdFloor, segRefs, ccMarks, sigs, cardLog, skipped };
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

/** Forget a room. The file stays: it is the game's record, and history reads files, not this
 * map. `keepFile: false` is for sandbox rooms, which are scratch. */
export function dropRoom(code: string, keepFile = true): boolean {
  const room = rooms.get(code);
  if (!room) return false;
  rooms.delete(code);
  // a finished game's resume point goes with it: the file is the record now
  if (keepFile && gameDecided(room) && !room.closed) persist(room, true, false);
  if (!keepFile) {
    try { unlinkSync(join(GAMES_DIR, `${code}.json`)); } catch { /* never written, or already gone */ }
  }
  return true;
}

/** Every room this process holds, as an iterator: the expiry sweep walks it every second. */
export function allRooms(): IterableIterator<Room> {
  return rooms.values();
}

/**
 * How many of the other seat's actions the open hidden step holds from `seat` (0 outside one):
 * what `viewFor` takes off the `actionCount` it serves, so the count moves only for your own
 * plays. The standing pass's `at` needs no such care: `passPriority` is never legal in a hidden step.
 */
export function hiddenActionsFrom(room: Room, seat: Seat): number {
  if (!room.segSnapshot || room.segStartIndex < 0) return 0;
  const opp = seat === 0 ? 1 : 0;
  let n = 0;
  for (let i = room.segStartIndex; i < room.actions.length; i++) if (room.actions[i]!.seat === opp) n++;
  return n;
}

/** The sandbox rooms in the map, least recently played first: what main.ts's sandbox cap starts
 * from after a restart. Called once, right after `restoreRooms()`. */
export function sandboxCodesByAge(): string[] {
  return [...rooms.values()]
    .filter(r => r.scenario !== undefined && isSandboxId(r.scenario))
    .sort((a, b) => a.lastActionAt - b.lastActionAt || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map(r => r.code);
}

/* Idle rooms close themselves. A room closes when both hold:
 *   - no action for its window (fewer than IDLE_FEW_ACTIONS actions → an hour; otherwise
 *     twelve), counted from `Room.lastActionAt`; and
 *   - nobody is in it (no seat socket, no watcher), and nobody has been for RECONNECT_GRACE_MS,
 *     because a locking phone or a deploy drops sockets that come back.
 * A closed room gets NO result — rated or not, nobody wins, nothing moves a
 * rating, and the history reads it as unfinished. The file stays, marked `closed`, so a
 * restart never brings it back and a late visitor is told what happened to it.
 */
/** fewer than this many actions is a room somebody opened and left */
export const IDLE_FEW_ACTIONS = 5;
export const IDLE_SHORT_MS = 3600_000;
export const IDLE_LONG_MS = 12 * 3600_000;
/** how long a room must have been empty before the sweep believes it */
export const RECONNECT_GRACE_MS = 5 * 60_000;

/** the inactivity window for a room with this many actions */
export const idleWindowMs = (actions: number): number =>
  actions < IDLE_FEW_ACTIONS ? IDLE_SHORT_MS : IDLE_LONG_MS;

/** docs/22 §2.5 — the idle sweep's exemption, supplied by server/match.ts
 * (setRoomHeld). Nothing is held until it is set. */
let roomHeld: (room: Room) => boolean = () => false;
export function setRoomHeld(fn: (room: Room) => boolean): void { roomHeld = fn; }

/** is anybody in the room — a seat or an audience? */
export const roomAttended = (room: Room): boolean =>
  !!room.sockets[0] || !!room.sockets[1] || room.watchers.size > 0;

/**
 * Should the sweep close this room at `now`? A decided room is not this
 * sweep's business (main.ts sweepFinished forgets those, with their result).
 * Updates `unattendedSince` as a side effect — the sweep is its only writer.
 */
export function idleDue(room: Room, now: number): boolean {
  if (roomAttended(room)) { room.unattendedSince = null; return false; }
  room.unattendedSince ??= now;
  if (gameDecided(room)) return false;
  // docs/22 §2.5: a PAUSED match's waiting room is held for as long as the
  // pause may last (server/match.ts voids it at 7 days). Injected, because
  // match.ts imports this module and this module must not import it.
  if (roomHeld(room)) return false;
  if (now - room.unattendedSince < RECONNECT_GRACE_MS) return false;
  return now - room.lastActionAt >= idleWindowMs(room.actions.length);
}

/** pin a closed file's mtime to its last move: history.ts reads the mtime as
 * "when this game was played", and the closing write is not a move */
function pinMtime(path: string, at: number): void {
  try { utimesSync(path, at / 1000, at / 1000); } catch { /* the record is written; the date is a nicety */ }
}

/** Close one room: mark the file, write it, forget the room; true when closed. No result is
 * stamped, which keeps a closed rated game out of every rating fold (rating.ts isRated). A
 * sandbox room goes file and all. */
export function closeIdleRoom(room: Room, now: number): boolean {
  if (rooms.get(room.code) !== room) return false;
  if (room.scenario !== undefined && isSandboxId(room.scenario)) return dropRoom(room.code, false);
  room.closed = { reason: 'idle', at: now, afterMs: idleWindowMs(room.actions.length) };
  persist(room);
  pinMtime(join(GAMES_DIR, `${room.code}.json`), room.lastActionAt);
  return dropRoom(room.code, true);
}

/**
 * docs/22 §2.5 — close a CC match's room for a reason that is not idling: the
 * match was voided, or decided between games. Like closeIdleRoom: no result
 * is stamped, the file is kept and marked, the room is forgotten.
 */
export function closeMatchRoom(room: Room, reason: 'void' | 'match', now: number): boolean {
  if (rooms.get(room.code) !== room) return false;
  room.closed = { reason, at: now, afterMs: 0 };
  persist(room);
  pinMtime(join(GAMES_DIR, `${room.code}.json`), room.lastActionAt);
  return dropRoom(room.code, true);
}

/** docs/22 §2.5: a pause (or a resume) restarts the room's idle and restore
 * clocks — the 7-day restore window then lapses with the 7-day void. */
export function touchRoom(room: Room, now: number): void {
  room.lastActionAt = now;
  persist(room);
}

/** The sweep: close every room that is due. Returns the codes it closed. */
export function sweepIdleRooms(now: number): string[] {
  const closed: string[] = [];
  for (const room of [...rooms.values()]) {
    if (idleDue(room, now) && closeIdleRoom(room, now)) closed.push(room.code);
  }
  return closed;
}

/** a code that could name a file in GAMES_DIR — and nothing outside it */
const FILE_CODE = /^[A-Z0-9]{1,12}$/;

/**
 * What a visitor to a closed or finished room's link is told, or null when the code names
 * neither; read off the file, since the room is gone from memory. A finished game's link says
 * who won and that its players can watch it back (/api/replay serves only them).
 */
export function closedNotice(code: string): string | null {
  if (!FILE_CODE.test(code)) return null;
  try {
    const raw = JSON.parse(readFileSync(join(GAMES_DIR, `${code}.json`), 'utf8')) as {
      closed?: Partial<RoomClosed>; winner?: unknown; names?: unknown; scenario?: unknown;
    };
    if (raw.winner === 0 || raw.winner === 1) {
      const name = Array.isArray(raw.names) && typeof raw.names[raw.winner] === 'string'
        ? String(raw.names[raw.winner]) : `Player ${raw.winner + 1}`;
      // a scenario room is a test fixture, never a history row (history.ts)
      return `Game ${code} is over: ${name} won.`
        + (raw.scenario === undefined || raw.scenario === null ? ' Its players can watch it back from their match history.' : '');
    }
    if (raw.closed?.reason === 'void') return `Game ${code} closed: its match was called off with no result.`;
    if (raw.closed?.reason === 'match') return `Game ${code} closed: its match is over.`;
    if (raw.closed?.reason === 'update') return `Game ${code} closed: a server update could not carry it over.`;
    if (raw.closed?.reason !== 'idle') return null;
    const h = Math.max(1, Math.round((Number(raw.closed.afterMs) || IDLE_SHORT_MS) / 3600_000));
    return `Game ${code} closed after ${h} hour${h === 1 ? '' : 's'} without a move.`;
  } catch { return null; }
}

let otherCodeTaken: (code: string) => boolean = () => false;
/** docs/25 §3 — main.ts tells this module which codes a cube event holds */
export function setCodeTakenAlso(fn: (code: string) => boolean): void { otherCodeTaken = fn; }

/** May a new room be given this code? Not if a room, a reservation or a saved game holds it:
 * reusing a forgotten room's code would overwrite that game's only record. */
export function codeTaken(code: string): boolean {
  if (rooms.has(code) || reserved.has(code)) return true;
  // docs/25 §3: cube events share this code space (a code typed into Join is
  // never ambiguous). Injected, so rooms.ts never imports the cube store.
  if (otherCodeTaken(code)) return true;
  return FILE_CODE.test(code) && existsSync(join(GAMES_DIR, `${code}.json`));
}

/** `creatorDeck` (constructed only): the first joiner's deck, for the waiting room's placeholder
 * state. `clockStart` is this room's bank (`undefined` the default, `null` no clock). `cc`
 * (docs/22 §2.4, server/match.ts only): a CC game room's `rules`, `match` link and the banks
 * the match carried out of the previous game. */
export function createRoom(code: string, seed: number, names: [string, string] = ['Player 1', 'Player 2'], mode: GameMode = 'shared', els?: Element[], creatorDeck?: CardName[], scenario?: string, clockStart: number | null = CLOCK_START_MS, customIn?: RoomCustom, single = false,
  /** a match's game (docs/22), or — no `match` — a Competitive draft room's rules */
  cc?: { rules?: GameRules; match?: RoomMatch; clockMs?: [number, number]; users?: [string | null, string | null]; league?: RoomLeague; rated?: boolean }): Room {
  // custom rules belong to a live draft, and never to a scenario deal
  const custom = mode === 'draft' && !scenario ? customIn : undefined;
  const trio = sanitizeTrio(els, roomElementCount({ custom }));
  if (cc?.match && (mode !== 'constructed' || scenario || single)) throw new IllegalAction('a match room is a plain constructed room');
  if (cc && !cc.match && (mode !== 'draft' || scenario || cc.rules?.sequential !== true || cc.rules.initiative !== undefined)) {
    throw new IllegalAction('only a match or a Competitive draft room carries rules');
  }
  if (mode === 'constructed' && !creatorDeck && !cc?.match) throw new IllegalAction('a constructed room needs a deck');
  const decks: [CardName[] | null, CardName[] | null] = [null, null];
  // an empty rule set is no rules: the room deals, saves and replays as a house-rules game
  const rules = cc?.rules && (cc.rules.sequential || cc.rules.initiative !== undefined) ? { ...cc.rules } : undefined;
  const placeholder = creatorDeck ?? (cc?.match ? leaguePlaceholderDeck() : undefined);
  const { state, events } = mode === 'constructed'
    ? fresh(seed, names, mode, trio, [placeholder!, placeholder!], scenario, custom?.deal, rules)
    : fresh(seed, names, mode, trio, undefined, scenario, custom?.deal, rules);
  const room: Room = {
    code, seed, mode, els: trio, decks, deckIds: [null, null], names, users: cc?.users ? [...cc.users] : [null, null], winner: null,
    // CR D8.4: only a scenario room carries one; `undefined` is the normal case
    // and is not persisted (see persist()).
    ...(scenario ? { scenario } : {}),
    // likewise only a custom room, and persisted only then
    ...(custom ? { custom } : {}),
    // CR D8.2: only ever constructed, and persisted only when set
    ...(single && mode === 'constructed' ? { single: true as const } : {}),
    // docs/22: a CC game room's rules and match link, persisted only then —
    // and, for a game after the first, the match's two accounts (stamped
    // before either client connects, as createRematch does), its league tag
    // and whether it is rated
    ...(rules ? { rules } : {}),
    ...(cc?.match ? { match: { ...cc.match } } : {}),
    ...(cc?.league ? { league: { ...cc.league } } : {}),
    ...(cc?.rated ? { rated: true } : {}),
    lobby: mode === 'draft' && !els ? freshLobby() : null,
    rematch: [false, false], rematchRoom: null,
    amendments: [], proposal: null, fixCooldown: [0, 0], fixRun: null,
    disputes: [],
    state, actions: [], events, sockets: [null, null], watchers: new Set(), forks: [],
    // stamped by resetSegment() below, where every fresh action log gets its first version stamp
    versions: [],
    segKey: null, segSnapshot: null, heldEvents: [[], []], heldFrames: [[], []], bases: [], closing: null, segStartIndex: -1, segSeen: [], seenPending: [],
    segIdFloor: [], segRefs: [], sigs: [], cardLog: [], cardOpen: null, deferred: [[], []], ccMarks: [],
    // both banks start at the room's own setting (the one site that reads the default, through
    // the argument); a clockless room's `clockMs` is never read. docs/22 §5.5: a CC game after
    // the first starts on the banks the match carried out of the game before.
    clockStart, clockMs: clockStart === null ? [0, 0] : cc?.clockMs ? [...cc.clockMs] : [clockStart, clockStart],
    matchMs: 0, matchRun: false, startedAt: null,
    clockStamp: Date.now(), clockRun: [false, false],
    building: [null, null],
    fullControl: [false, false],
    passAll: [null, null], passAllWait: [null, null], passAllCovered: [null, null],
    autoPass: [null, null],
    reportHold: [false, false],
    watchHold: [null, null],
    // stamped again by resetSegment below, which is where every fresh log starts
    lastActionAt: Date.now(), unattendedSince: null,
  };
  // turn 1's planning segment opens HERE, not on the first action
  resetSegment(room);
  rooms.set(code, room);
  persist(room);
  return room;
}

// Who may create a room: only a code the server handed out (/api/new reserves it, and the first
// join spends the reservation). A code you typed yourself never creates anything, so a mistyped
// code cannot mint an empty game.

/** minted-but-not-yet-joined codes: when each was minted, the custom rules its creator chose
 * (resolved and checked), and the elements the creator picked (the ones the rules were checked
 * against). A join creates the room from THIS, never from its own message, so the second player
 * cannot re-specify the rules. */
interface Reservation { at: number; custom?: RoomCustom; els?: Element[] }
const reserved = new Map<string, Reservation>();
/** a reservation nobody used is a dead code — do not honour it forever */
const RESERVE_TTL_MS = 6 * 60 * 60 * 1000;
/** hard cap so a script hammering /api/new cannot grow this without bound */
const RESERVE_MAX = 500;

function pruneReservations(): void {
  const now = Date.now();
  for (const [code, r] of reserved) {
    if (now - r.at > RESERVE_TTL_MS) reserved.delete(code);
  }
  // still too many: drop the oldest (Map iterates in insertion order)
  while (reserved.size > RESERVE_MAX) {
    const oldest = reserved.keys().next();
    if (oldest.done) break;
    reserved.delete(oldest.value);
  }
}

/** /api/new: this code may be turned into a room by its first joiner */
export function reserveRoomCode(code: string, custom?: RoomCustom, els?: Element[]): void {
  pruneReservations();
  reserved.set(code, { at: Date.now(), ...(custom ? { custom } : {}), ...(els ? { els: [...els] } : {}) });
}

/** is `code` either a live room or a code we minted? (i.e. joinable at all) */
export function roomExistsOrReserved(code: string): boolean {
  pruneReservations();
  return rooms.has(code) || reserved.has(code);
}

/**
 * CR D7.5: the sentence a join with a bad room code is refused with, or null when the code is
 * fine. The client shows it verbatim on the connecting screen. A value, so a test can read it
 * without a socket; decks, seats and modes are refused later, with the room.
 */
export function joinRefusal(code: string): string | null {
  if (!code) return 'a room code is required';
  if (!roomExistsOrReserved(code)) {
    // a closed room is not a typo: say what happened
    const closed = closedNotice(code);
    if (closed) return closed;
    // a code that names no room and that we never minted is a typo: say so, never create a game
    // around it
    return `No game with code ${code}. Check the code with your opponent, or start a new game.`;
  }
  return null;
}

/**
 * Which seat a joiner gets, or the sentence they are refused with. A seat is CLAIMED when
 * `room.users[seat]` names an account; the claim binds, not the live socket, so "wait for the
 * disconnect, then sit down" fails exactly like sitting down on them.
 *
 *   requested, claimed by another account  → refuse, naming the occupant
 *   requested, claimed by me               → allow; the stale tab is kicked
 *   requested, unclaimed                   → allow; whoever is there is kicked
 *   no seat requested                      → my own claimed seat if I have one, else the
 *                                            first seat neither claimed nor occupied, else "full"
 *
 * An unclaimed seat has no identity to bind to, so a signed-out player can be displaced from
 * it; logging in is the mitigation. A value, so test-seat-binding.ts reads it without a socket.
 */
export type SeatVerdict =
  | { seat: 0 | 1; kicked: Room['sockets'][number] }
  | { refuse: string };

export function seatVerdict(room: Room, requested: number | undefined, me: string | null): SeatVerdict {
  // docs/22 §2.2: a Competitive match hangs off two ACCOUNTS — its pause and
  // resume, the league. A guest still has casual constructed.
  if (room.match && me === null) {
    return { refuse: 'a Competitive match needs an account — sign in (or play as a guest) first' };
  }
  const claimedByAnother = (seat: 0 | 1): boolean =>
    room.users[seat] !== null && room.users[seat] !== me;
  const occupant = (seat: 0 | 1): string => room.names[seat] || `seat ${seat}'s player`;
  if (requested === 0 || requested === 1) {
    if (claimedByAnother(requested)) {
      return {
        refuse: `seat ${requested} belongs to ${occupant(requested)}. `
          + (me ? 'Take the other seat, or ask them for a new room.'
                : 'If that is you, log in first; otherwise take the other seat.'),
      };
    }
    return { seat: requested, kicked: room.sockets[requested] };
  }
  for (const seat of [0, 1] as const) {
    if (me !== null && room.users[seat] === me) return { seat, kicked: room.sockets[seat] };
  }
  for (const seat of [0, 1] as const) {
    if (!room.sockets[seat] && !claimedByAnother(seat)) return { seat, kicked: null };
  }
  return { refuse: 'room is full (2 players) — ask your opponent for their seat link, or use a new room' };
}

/**
 * The room for `code`, creating it only if /api/new reserved the code; null when it names
 * nothing. `mode`/`els`/`creatorDeck`/`clockStart` matter only to the creator's first join; a
 * join to an existing room ignores them, so a joiner cannot re-set the room's clock.
 */
export function joinableRoom(code: string, mode: GameMode = 'shared', els?: Element[], creatorDeck?: CardName[], clockStart: number | null = CLOCK_START_MS, single = false,
  /** docs/22 §5.1: a match's game 1, created by its creator's join (server/match.ts); or, no
   * `match`, a Competitive draft room's rules */
  cc?: { rules?: GameRules; match?: RoomMatch }): Room | null {
  const existing = rooms.get(code);
  if (existing) return existing;
  pruneReservations();
  // spending the reservation and creating are one step: a second join to the
  // same code finds the room above rather than a second reservation
  const reservation = reserved.get(code);
  if (!reservation) return null;
  reserved.delete(code);
  // a reservation brings its custom rules and the elements its creator picked; the join's own
  // `els` are not consulted then. Only a live draft carries either.
  const custom = mode === 'draft' ? reservation.custom : undefined;
  const picked = mode === 'draft' ? reservation.els : undefined;
  const room = createRoom(code, (Math.random() * 1e9) >>> 0, undefined, mode, picked ?? (custom ? undefined : els), creatorDeck,
    undefined, clockStart, custom, single,
    mode === 'constructed' && !single && cc?.match ? cc : mode === 'draft' && !cc?.match ? cc : undefined);
  // picked elements still wait in the lobby, so the room's code and invites are shown and
  // nobody sees a pack before the opponent is in
  if (picked) { room.lobby = freshLobby('chosen'); persist(room); }
  return room;
}

/** Apply an action to the room's authoritative state and record it. Throws
 * whatever the engine throws (IllegalAction) — caller reports it to the actor. */
export function applyToRoom(room: Room, action: Action): EngineEvent[] {
  // a game over without the board saying so (a loss on time, a stamped result): the engine
  // would still take the loser's moves. `state.winner` itself stays the engine's business.
  if (decidedOutsideState(room)) throw new IllegalAction('this game is already over');
  settleClock(room);   // bill elapsed time to whoever WAS on the clock
  // any action that lands ends a proposed fix, which was about the board as it stood
  // (main.ts tells both seats)
  room.proposal = null;
  const before = room.state;
  // hold this action's events from the opponent only while the segment it was taken in is still
  // open: main.ts drains forced battle actions after the key has moved on, and those are public.
  // An agreed fix is never held: it is public, and the frozen board is patched to show it.
  const isFix = action.type === 'amend';
  const holding = !isFix && room.segKey !== null && segmentKey(before) === room.segKey;
  // the reference key is taken against the state the action is applied to,
  // with the floors of every action BEFORE it (rebuild() does the same)
  const sym = symbolizer(room.actions, room.segIdFloor, room.actions.length, before.nextId);
  // inside a hidden step, the closing action's resolutions are kept as frames
  // for the playback (E.frames — rules-inert, a clone per resolution)
  const r = apply(room.state, action, holding ? { frames: true } : {});
  // the opening is the board the first action was taken on; a room restored mid-game has none
  // and never invents one
  if (room.actions.length === 0 && !room.cardOpen) room.cardOpen = cardOpen(before);
  room.cardLog.push(cardFact(before, r.state, action, r.events));
  room.state = r.state;
  room.actions.push(action);
  room.lastActionAt = Date.now();   // the idle sweep's clock
  room.segIdFloor.push(before.nextId);
  room.segRefs.push(referenceKey(before, r.state, action, sym, before.rngState !== r.state.rngState));
  // the fingerprint record, taken by the engine that just applied the action: the only moment
  // anybody knows the board for certain
  room.sigs.push(digest(signature(r.state)));
  // CR D4.3e, D4.3f: what this showed each seat of the hidden cards, measured only for an action
  // that stays inside the open hidden step, as rebuild() re-measures it; held in `seenPending`
  // until an undo asks (settleSeen)
  room.segSeen.push(NOTHING_SEEN);
  // CR D4.6: the CC take-back's marks, as rebuild() derives them
  const cc = ccMeasure(before, action, r.state, r.events, room.names);
  room.ccMarks.push(cc.mark);
  if (cc.seen) room.segSeen[room.segSeen.length - 1] = cc.seen;
  // …and the measurement itself waits for the only thing that reads it, an
  // undo: four more replays of the move, on every move of a hidden step
  else if (holding && segmentKey(r.state) === room.segKey) {
    room.seenPending.push({
      i: room.segSeen.length - 1, before, action, after: r.state, events: r.events,
      frozen: room.segSnapshot, names: [...room.names],
    });
  }
  room.events.push(...r.events);
  if (isFix && room.segSnapshot && room.segKey !== null && segmentKey(r.state) === room.segKey) {
    room.segSnapshot = amendFrozen(room.segSnapshot, action, before);
  }
  // CR D6.1a, D6.2: EVERY event of a hidden step is held for the barrier, a reveal included
  if (holding) {
    const held = [...r.events];
    room.heldEvents[seatSlot(other(action.seat))].push(...held);
    // the playback: the action that CLOSES the step is the tail's, not a
    // frame of its own (its events go out as public, after the barrier)
    if (segmentKey(r.state) !== room.segKey) {
      room.closing = { before, events: r.events, frames: r.frames ?? [] };
    } else if (held.length) {
      room.heldFrames[seatSlot(other(action.seat))].push({ state: structuredClone(r.state), events: held });
    }
  }
  if (room.state.winner !== null) room.winner = room.state.winner;   // stamp it
  // CR D8.5: a concede that decided it stamps who and on which turn, read off the state it was
  // applied to, so the fold never replays to recover it
  if (action.type === 'concede' && before.winner === null && room.state.winner !== null) {
    room.concession = { seat: action.seat, turn: before.turn };
  }
  if (stepKey(before) !== stepKey(r.state)) room.bases = pushBase(room.bases, resumePoint(room));
  settleClock(room);   // recompute who is on the clock under the NEW state
  persist(room);
  return r.events;
}

/** Close whatever segment was open and open the one the current state is in (maybe none): a
 * fresh freeze, start index and hold. The caller reads `heldEvents` for the reveal first. Every
 * segment boundary is this one call; there is no per-phase branch. */
export function openSegment(room: Room): void {
  room.segKey = segmentKey(room.state);
  room.segSnapshot = room.segKey ? structuredClone(room.state) : null;
  room.segStartIndex = room.segKey ? room.actions.length : -1;
  room.heldEvents = [[], []];
  room.heldFrames = [[], []];
  room.closing = null;
}

/** A room whose state was re-dealt and whose action log was reset (a resolved
 * lobby, a completed constructed pair, a rematch): the derived per-action
 * bookkeeping goes with it, and the new game's first segment opens now. */
function resetSegment(room: Room): void {
  room.segSeen = [];
  room.seenPending = [];
  room.ccMarks = [];
  room.segIdFloor = [];
  room.segRefs = [];
  // a fingerprint is a claim about THIS log, like `forks` and `versions` below
  room.sigs = [];
  room.cardLog = [];
  room.cardOpen = null;
  // the previous action log is gone, so any fork recorded against it is too:
  // a fork is a claim about THIS log, and this is a different one
  room.forks = [];
  // an agreed fix is a claim about the discarded log too
  room.amendments = [];
  room.proposal = null;
  // …and so is a dispute of its result
  room.disputes = [];
  room.fixRun = null;
  // and so is the version ledger: old stamps index a discarded log. The re-deal runs on this
  // engine, so the new log is stamped with it from action 0.
  room.versions = [{ at: new Date().toISOString(), sha: engineVersion(), from: 0 }];
  // a fresh log is a fresh start for the idle sweep
  room.lastActionAt = Date.now();
  openSegment(room);
  room.bases = [resumePoint(room)];
}

/** Undo the most recent action (single-step, docs/07 §15): pop it and rebuild
 * state by replaying seed + remaining actions. Caller enforces who/when. */
export function undoLastAction(room: Room): LostAction[] {
  return undoActionAt(room, room.actions.length - 1);
}

/**
 * The one thing a splice can break that no repair can fix: does a later action name an entity
 * this action created? Those ids (`[lo, hi)`) cease to exist, so there is no number to rewrite
 * them to, and we refuse. Who acted after, and whether their action has a payload, are not
 * asked: only ids are at risk, and `entityRefs` lists them all.
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
 * A reference key renumbered the way `renumberAction` renumbers an action. A key names entities
 * by creation identity, but a cached card is written whole into it, with a `uid` off the same
 * `nextId` clock, so a splice shifts it. Only the comparison renumbers (undoActionAt); a uid
 * inside the spliced block is left alone, so the compare still refuses.
 */
export function renumberRefUids(ref: string, lo: number, hi: number): string {
  if (!ref.includes('"uid":')) return ref;
  const shift = hi - lo;
  return ref.replace(/"uid":(\d+)/g, (m, d: string) => {
    const uid = Number(d);
    return uid < hi ? m : `"uid":${uid - shift}`;
  });
}

/**
 * No action payload carries a cached-card `uid` (a target is answered by a `decide` index, and
 * the cache-reading actions name a cache index), so `renumberAction` shifts none; the one place
 * a uid reaches a comparison is the reference key (`renumberRefUids`). `ActionCarriesUid` makes
 * this a compile error: give an action a `uid` and the server typecheck fails here.
 */
type ActionCarriesUid<T> = T extends readonly (infer U)[] ? ActionCarriesUid<U>
  : T extends object ? { [K in keyof T]-?: K extends 'uid' ? true : ActionCarriesUid<T[K]> }[keyof T]
  : false;
const _noUidInActions: [ActionCarriesUid<Action>] extends [false] ? true : never = true;
void _noUidInActions;

/**
 * The same action, renumbered for a log the splice has shortened: every id at or above `hi`
 * moves down by `hi - lo`. An id is the row a choice was filed under, not the choice, so this
 * keeps the player's intent. The shift is verified, not assumed: `undoActionAt` compares every
 * later reference key and rolls back on any difference. The result keeps the original's tag.
 */
export function renumberAction(a: Action, lo: number, hi: number): Action {
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
    case 'activateAbility': {
      // only a `{ mod }` via names an id to move; 'augment' and `{ face }` are
      // carried through untouched by the spread (see viaMod)
      const m = viaMod(a.via);
      out = m === null
        ? { ...a, entityId: one(a.entityId) }
        : { ...a, entityId: one(a.entityId), via: { mod: one(m) } };
      break;
    }
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
    case 'amend':
      if (a.edit.kind !== 'unit') return a;
      out = { ...a, edit: { ...a.edit, id: one(a.edit.id) } };
      break;
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
 * Undo the action at `index` (splice + full rebuild), or refuse: [] on success, otherwise each
 * entry names a later action the splice would damage. The splice is repaired (`renumberAction`),
 * measured against the log it came from, and rolled back if a later action is
 *   lost     refused by the rebuild, though it was accepted before; or
 *   changed  still legal, but its reference key moved (another unit, card or roll).
 * Callers enforce who may remove what.
 */
export function undoActionAt(room: Room, index: number): LostAction[] {
  // the rebuild starts at bases[0], so nothing before it can be spliced out
  const old = room.actions[index];
  if (old && index < room.bases[0]!.at) return [{ i: index, type: old.type, seat: old.seat, why: 'it is before the earliest step the game can go back to', kind: 'lost' }];
  settleSeen(room);
  settleClock(room);   // bill up to the undo; the rebuild changes who runs
  room.proposal = null;   // the board a proposed fix was about is moving
  const restore = [...room.actions];
  const wasRefs = [...room.segRefs];
  // CR D4.3d: what each later action in the open step showed somebody of the hidden cards. A
  // splice may not change it: re-dealing cards a seat has seen is the take-back the rule forbids.
  const wasSeen = [...room.segSeen];
  const wasStart = room.segStartIndex;
  // the block of ids this action allocated — the ones that cease to exist,
  // and the size of the shift everything above them takes
  const lo = room.segIdFloor[index];
  const hi = lo === undefined ? undefined : (room.segIdFloor[index + 1] ?? room.state.nextId);
  const tail = restore.slice(index + 1);
  room.actions = restore.slice(0, index).concat(
    lo !== undefined && hi !== undefined && hi > lo
      ? tail.map(a => renumberAction(a, lo, hi))
      : tail);
  const rb = rebuildRoom(room, index);
  const lost = rb.skipped;
  // …and the actions that survive but no longer mean what they meant. Compared
  // by ACTION OBJECT position: original j > index sits at j-1 in the splice.
  const changed: LostAction[] = [];
  if (!lost.length) {
    for (let j = index + 1; j < restore.length; j++) {
      const sameSeen = wasStart < 0 || j < wasStart
        || JSON.stringify(rb.segSeen[j - 1] ?? NOTHING_SEEN) === JSON.stringify(wasSeen[j] ?? NOTHING_SEEN);
      // the old key with its cache uids renumbered as the splice renumbered the ids (a cached
      // card's uid is off the same clock)
      const was = lo !== undefined && hi !== undefined && hi > lo && wasRefs[j] !== undefined
        ? renumberRefUids(wasRefs[j]!, lo, hi) : wasRefs[j];
      if (rb.segRefs[j - 1] === was && sameSeen) continue;
      const a = restore[j]!;
      changed.push({
        i: j, type: a.type, seat: a.seat,
        why: sameSeen
          ? 'it would refer to a different unit, card or outcome once the earlier action is gone'
          : 'it would change cards that were already shown once the earlier action is gone',
      });
    }
  }
  if (lost.length || changed.length) {
    room.actions = restore;
    assignRebuild(room, rebuildRoom(room, index));   // deterministic: exact prior state
    settleClock(room);
    return lost.length ? asLost(lost, 'lost') : asLost(changed, 'changed');
  }
  assignRebuild(room, rb);
  // An undo is the one thing that rewrites the fingerprint record: every action after the splice
  // was applied to a board that no longer exists. The prefix keeps its recorded entries; the
  // rollback above restores the log, so it leaves `room.sigs` alone.
  room.sigs = room.sigs.length === restore.length
    ? room.sigs.slice(0, index).concat(rb.sigs.slice(index))
    : rb.sigs;   // a file without fingerprints has no prefix worth preserving
  // the card log, the same splice, except that an unrecorded prefix stays null rather than being
  // filled in by today's engine
  const keptCards = room.cardLog.slice(0, index);
  while (keptCards.length < index) keptCards.push(null);
  room.cardLog = keptCards.concat(rb.cardLog.slice(index));
  room.lastActionAt = Date.now();   // a take-back is a move too, for the idle sweep
  settleClock(room);
  persist(room);
  return [];
}

/** The take-back, as one decision: ok, or the refusal to show the player, in the words of what
 * actually went wrong. test-undo-segment.ts drives it directly. */
export type UndoOutcome = { ok: true } | { ok: false; why: string };

/**
 * How far back a walk may go: the first action in the open segment that is the player's own
 * business. Debt and rot damage resolve inside the barrier actions (CR 502.4, CR 112.13c), so
 * below `segStartIndex`; but a segment that opens mid-suspension starts with a run of `decide`s
 * draining a start-of-phase trigger, which is the phase's business. Nobody else may act while a
 * decision is pending, so that run is unbroken and ends at the first non-`decide`.
 */
export function segmentFloor(room: Room): number {
  const start = room.segStartIndex;
  if (start < 0) return -1;
  if (!room.segSnapshot?.decision) return start;
  let i = start;
  while (i < room.actions.length && room.actions[i]!.type === 'decide') i++;
  return i;
}

/** CR D4.6: the earliest action `seat` may take back in a CC game now, or `actions.length` for
 * none: the engine's floor (ccUndoFloor) raised past the latest action in that run that showed
 * either seat a hidden card (seen.ts: both players watch a CC step live). */
export function ccFloor(room: Room, seat: Seat): number {
  const len = room.actions.length;
  if (!room.state.sequential || gameDecided(room)) return len;
  settleSeen(room);
  let floor = ccUndoFloor(room.ccMarks, seat, room.state);
  if (floor >= len) return len;
  floor = Math.max(floor, lastSeen(room.segSeen, 0, floor) + 1, lastSeen(room.segSeen, 1, floor) + 1, amendFloor(room), room.bases[0]!.at);
  return Math.min(floor, len);
}

/** CR D4.6: may `seat` press undo now? The boolean each CC push carries
 * (docs/22 §3.6 point 5) — never the marks. */
export const ccUndoOpen = (room: Room, seat: Seat): boolean =>
  !!room.state.sequential && ccFloor(room, seat) < room.actions.length;

export function undoForSeat(room: Room, seat: Seat): UndoOutcome {
  settleSeen(room);
  // An agreed fix stands: a rewind's cut is a hard floor, and an agreed edit is never undone
  // itself. An action before an edit may go only if undoActionAt measures the edit unchanged
  // (referenceKey's 'amend' case), so a fix does not freeze moves it does not depend on.
  const fixFloor = amendFloor(room);
  const segKey = room.segKey;
  // A pending PRE-COMMIT cast chain of the requester's own (X / cost /
  // target stages, CR 702.3) is undoable in ANY phase: while their decision
  // pends nobody else can act, so the log's tail is provably theirs and
  // splicing it takes nothing away from the opponent. The client chains
  // one undo per state until the suspension clears (cast-cancel, docs/07).
  // The undo lock (CR D4.3) needs no floor here: every stage comes before the item resolves, so
  // nothing hidden has been shown yet (a glimpse or a draw runs at resolution).
  const sus = room.state.suspension, dec = room.state.decision;
  const castChain = !!dec && !!sus && dec.seat === seat
    && (sus.type === 'cast' ? sus.item.kind !== 'triggered' && sus.item.controller === seat
      // CR D4.2: picking a burst's next token is part of the same pre-commit cast
      : sus.type === 'burstPick' && sus.seat === seat);
  // CR D4.6: undo until Done (docs/22 §3.6). A CC game has no hidden segment; its walk is the
  // trailing run of this seat's actions in the open CC step, back to the latest barrier and the
  // latest action that showed either seat a hidden card — one action per press, through every gate.
  if (room.state.sequential && !segKey && !castChain) {
    const len = room.actions.length;
    const floor = ccFloor(room, seat);
    if (floor >= len) {
      return { ok: false, why: 'nothing to undo — only your own moves in this step can be taken back, until you press Done' };
    }
    const i = len - 1;
    if (i < fixFloor || room.actions[i]!.type === 'amend') return { ok: false, why: FIX_UNDO_REFUSAL };
    if (!spliceable(room, i, seat)) {
      return { ok: false, why: 'a later move is about the very unit that action put on the board — it cannot be taken back on its own' };
    }
    const refused = undoActionAt(room, i);
    if (refused.length) return { ok: false, why: undoRefusal(refused) };
    return { ok: true };
  }
  if (!segKey && !castChain) {
    return { ok: false, why: 'undo only works during planning and deploy (or while your own cast is awaiting X, costs or targets)' };
  }
  if (segKey) {
    // Inside a hidden simultaneous segment your last action is very often not
    // the last one overall — your opponent is acting in parallel, behind the
    // screen, and what they do must not be able to take your undo away. So
    // walk back to YOUR most recent action within the segment and splice
    // that, in all three segments. Repeated presses walk back to `segmentFloor` and stop there;
    // the window closes at each barrier, when the step's decisions lock.
    const floor = segmentFloor(room);
    let i = room.actions.length - 1;
    // an agreed fix is nobody's own action to take back: the walk passes over it
    // (FIX_UNDO_REFUSAL says what still stops it)
    while (i >= floor && i >= 0 && (room.actions[i]!.seat !== seat || room.actions[i]!.type === 'amend')) i--;
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
    if (i < room.bases[0]!.at) return { ok: false, why: 'nothing to undo — nothing of yours this step' };
    // CR D4.3: nor past what you have seen. The walk stops just after the step's latest action
    // that showed THIS seat a hidden card, measured per action (seen.ts); an opponent's peek at
    // a shared deck showed you nothing and does not stop you.
    if (i < fixFloor) return { ok: false, why: FIX_UNDO_REFUSAL };
    if (i <= lastSeen(room.segSeen, seat, room.segStartIndex)) {
      return { ok: false, why: SEEN_REFUSAL };
    }
    // ...and the one thing left that can stop it: a later move naming an entity this action
    // created. A renumbering is our bookkeeping, and undoActionAt repairs it.
    if (!spliceable(room, i, seat)) {
      return { ok: false, why: 'a later move is about the very unit that action put on the board — it cannot be taken back on its own' };
    }
    const refused = undoActionAt(room, i);
    if (refused.length) return { ok: false, why: undoRefusal(refused) };
    return { ok: true };
  }
  const last = room.actions[room.actions.length - 1];
  if (!last || room.actions.length - 1 < room.bases[0]!.at) return { ok: false, why: 'nothing to undo' };
  if (room.actions.length - 1 < fixFloor || last.type === 'amend') return { ok: false, why: FIX_UNDO_REFUSAL };
  if (last.seat !== seat) return { ok: false, why: 'your opponent acted since — nothing of yours to undo' };
  const refused = undoLastAction(room);
  if (refused.length) return { ok: false, why: undoRefusal(refused) };
  return { ok: true };
}

/* Agreed fixes. Both shapes need the other seat's yes, and change nothing else in the game:
 *
 *   EDIT    an `amend` action (engine/src/types.ts), logged like any action so replay,
 *           restore and the record see it; built ONLY here, by the accept path — main.ts
 *           refuses one off a socket.
 *   REWIND  the log is TRUNCATED, as Learn to Play rewinds (ui/solo.ts). The actions
 *           taken back are archived on the room (`Amendment.removed`), and the
 *           agreement waives the seen-cards undo lock (CR D4.3).
 *
 * The proposal is soft state (`Room.proposal`), like a rematch offer; the record is
 * `Room.amendments`.
 */

/** how long a proposal waits for its answer */
export const FIX_PROPOSAL_MS = 60_000;
/** after a decline, how long the proposer waits before proposing again */
export const FIX_COOLDOWN_MS = 15_000;
/** the most non-forced actions a rewind may take back */
export const FIX_REWIND_MAX = 5;
/** how far back a rewind's search looks, in logged actions */
const FIX_REWIND_WINDOW = 80;
/** the proposer's "what went wrong" — it becomes a bug report */
export const FIX_REASON_MAX = 600;

/** the refusal an undo reads when an agreed fix stands in the way */
export const FIX_UNDO_REFUSAL = 'an agreed fix stands — it cannot be undone by one player (propose a rewind instead)';

export interface Proposal {
  id: number;
  /** the proposer — whose cards a `move` names */
  seat: Seat;
  kind: 'edit' | 'rewind';
  edit?: AmendEdit;
  /** 'rewind': the log length it goes back to */
  to?: number;
  /** the fix in one sentence, every action named — the RECORD's wording (the
   * game file and the bug report; no player reads it) */
  what: string;
  /** a rewind as each seat reads it ("your Fireball", "their pass"; a hidden-step action of the
   * other seat never named or counted). Absent for an edit, which reads the same to both. */
  whats?: [string, string];
  /** …and as the public log line reads it, which both seats see */
  pub?: string;
  reason: string;
  /** the proposer ticked "Not a bug! Just taking something back.": the reason may be empty, and
   * the report the fix files says it is a take-back */
  takeBack?: true;
  /** `actions.length` when it was made — an answer to a different board is refused */
  at: number;
  /** ms since the epoch */
  expires: number;
}

/** what a seat is shown of the open proposal (and of nothing else) */
export interface ProposalView {
  id: number; seat: Seat; kind: 'edit' | 'rewind'; what: string; reason: string;
  /** the proposer says it is a take-back, not a bug */
  takeBack?: true;
  /** ms left to answer */
  left: number;
}

/** one rewind on offer, as the asking seat reads it: where it goes back to,
 * and what it takes back (null: nothing worth naming) */
export interface RewindOption { to: number; label: string; takes: string | null }

let proposalSeq = 0;

/** a file's fixes back off disk, dropping what is not one. Not bounded by the log's length: a
 * later rewind that went further back legitimately leaves an earlier fix's `at` past the end
 * (replay-room.ts --branch walks this whole list). */
function sanitizeAmendments(raw: unknown, _actions: number): Amendment[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is Amendment => !!a && typeof a === 'object'
    && (a.kind === 'edit' || a.kind === 'rewind')
    && Number.isInteger(a.at) && a.at >= 0
    && (a.seat === 0 || a.seat === 1) && (a.by === 0 || a.by === 1)
    && typeof a.what === 'string' && typeof a.reason === 'string');
}

/** The log index below which one seat's undo may not reach: the length the LAST agreed rewind
 * left (-1 when none) — not the largest, since a later, deeper rewind cut the earlier one's
 * board away. An agreed edit is guarded by measurement instead (undoForSeat). */
export function amendFloor(room: Room): number {
  for (let k = room.amendments.length - 1; k >= 0; k--) {
    const a = room.amendments[k]!;
    if (a.kind === 'rewind') return a.at;
  }
  return -1;
}

/** Why this ROOM takes no fixes at all — or null when it does. Asked before
 * anything is offered: the menu entry is drawn only where this is null. */
export function fixesRefusal(room: Room): string | null {
  if (roomWaiting(room)) return 'the game has not started';
  if (gameDecided(room)) return 'the game is over';
  // two people agreeing is the whole of the safety: a scripted opponent
  // cannot agree to anything, and test mode has tools of its own
  if (room.state.sandbox) return 'test mode has its own tools for this';
  if (room.scenario) return 'fixes are for a game between two players';
  return null;
}

/** Why an EDIT cannot be proposed right now (the timing half) — null when it
 * can. A rewind has no timing rule: "a rewind any time". */
export function editTiming(room: Room): string | null {
  // a fix is shown to both seats at once, so the hidden steps take edits too (apply.ts doAmend)
  if (room.state.decision) return 'no edits while a decision is pending — a rewind still works';
  return null;
}

/** The fix-related fields every push carries — undefined for a room that
 * takes no fixes, so an ordinary scenario or sandbox payload is unchanged. */
export function fixInfo(room: Room, seat: Seat, now = Date.now()): { proposal?: ProposalView; cooldown?: number } | undefined {
  if (fixesRefusal(room) !== null) return undefined;
  const p = room.proposal;
  const cool = room.fixCooldown[seatSlot(seat)] - now;
  return {
    // each seat reads the fix in its own words, never the record's, which names the other
    // seat's hidden actions
    ...(p ? { proposal: { id: p.id, seat: p.seat, kind: p.kind, what: p.whats?.[seatSlot(seat)] ?? p.what, reason: p.reason, ...(p.takeBack ? { takeBack: true as const } : {}), left: Math.max(0, p.expires - now) } } : {}),
    ...(cool > 0 ? { cooldown: cool } : {}),
  };
}

/** a step, as far as "back to the start of this step" means one: the phase
 * and its sub-step, the battle window and round, on this turn */
function stepKey(s: GameState): string {
  return [s.turn, s.phase, planningStep(s) ?? '', s.battleRound, s.battle?.region ?? '',
    s.battle?.round ?? '', s.battle?.step ?? ''].join('|');
}
function stepLabel(s: GameState): string {
  const seg = planningStep(s);
  const what = seg === 'plan' ? 'planning' : seg === 'haste' ? 'the haste step' : seg === 'deploy' ? 'deployment'
    : s.phase === 'battle' && s.battle ? `battle (${s.battle.step}${s.battle.round === 2 ? ', counterattack' : ''})`
      : s.phase;
  return `turn ${s.turn}, ${what}`;
}

/**
 * The boards before each of the last `FIX_REWIND_WINDOW` actions, no further
 * back than the window's base: `states[k]` is the board action `lo + k` was
 * applied to, and the last entry is the board now.
 */
function tailStates(room: Room): { lo: number; states: GameState[] } {
  const actions = room.actions, base = room.bases[0]!;
  const lo = Math.max(base.at, actions.length - FIX_REWIND_WINDOW);
  let state = base.state;
  const states: GameState[] = [];
  for (let i = base.at; i < actions.length; i++) {
    if (i >= lo) states.push(state);
    try { state = apply(state, actions[i]!).state; } catch (err) {
      if (!(err instanceof IllegalAction)) throw err;
    }
  }
  states.push(state);
  return { lo, states };
}

/**
 * What a rewind may go back to now, as `seat` would propose it: just before each of the last
 * five non-forced actions, before the seat's own last action, and the start of this step and
 * of the step before. Non-forced, because a forced step re-applies itself as soon as the board
 * owes it. Every option names what it takes back. Inside a hidden step a cut within the step
 * takes none of the other seat's hidden actions, the step's start may (saying so with no
 * count), and nothing counts the log.
 */
export function rewindPlans(room: Room, seat: Seat): CutPlan[] {
  if (fixesRefusal(room) !== null || !room.actions.length) return [];
  const { lo, states } = tailStates(room);
  const len = room.actions.length;
  const at = (i: number): GameState => states[i - lo]!;
  const forced = (i: number): boolean => {
    const f = forcedAction(at(i));
    return f !== null && JSON.stringify(f) === JSON.stringify(room.actions[i]);
  };
  // the hidden step the board is in now, if any, and its first action: every
  // action from `openStart` on was taken inside it
  const segNow = hiddenSegment(at(len));
  let openStart = len;
  if (segNow !== null) {
    const turn = at(len).turn;
    while (openStart > lo && hiddenSegment(at(openStart - 1)) === segNow && at(openStart - 1).turn === turn) openStart--;
  }
  const item: CutItem[] = [];
  for (let i = lo; i < len; i++) item.push(describe(room.actions[i]!, at(i), i, i >= openStart));
  const it = (i: number): CutItem => item[i - lo]!;
  const items = (to: number): CutItem[] => {
    const out: CutItem[] = [];
    for (let i = to; i < len; i++) if (!forced(i)) out.push(it(i));
    return out;
  };
  /** something in the cut this seat can see and did not merely re-trigger */
  const real = (xs: CutItem[]): boolean => xs.some(x => !(x.hidden && x.seat !== seat));
  /** a cut inside the open hidden step takes back none of the other seat's hidden actions there,
   * only its public ones (rewind-cuts.ts PUBLIC_IN_HIDDEN) — CR D4.5d */
  const ownOnly = (to: number): boolean => {
    if (segNow === null) return true;
    if (to <= openStart) return false;   // that is the start of the step's own option
    for (let i = to; i < len; i++) if (it(i).hidden && it(i).seat !== seat) return false;
    return true;
  };
  const plans: CutPlan[] = [];
  const offer = (p: CutPlan): void => {
    if (p.to >= len || p.to < lo) return;
    const same = plans.find(o => o.to === p.to);
    // the start of a step that is also "before X": one option, and its label
    // says both, so "restart this step" is always findable
    if (same) {
      if (p.kind !== 'before' && same.kind === 'before') same.alsoStart = p.kind === 'start' ? 'this step' : p.step;
      return;
    }
    if (real(p.items)) plans.push(p);
  };
  const before = (to: number, lastOwn = false): CutPlan =>
    ({ to, kind: 'before', ...(lastOwn ? { lastOwn } : {}), items: items(to), hiddenStep: segNow !== null, seat });
  // "back to before your last action" — first-class, however far back it is
  for (let i = len - 1; i >= lo; i--) {
    const a = room.actions[i]!;
    if (a.seat !== seat || a.type === 'amend' || forced(i)) continue;
    if (ownOnly(i)) offer(before(i, true));
    break;
  }
  let n = 0;
  for (let i = len - 1; i >= lo && n < FIX_REWIND_MAX; i--) {
    if (forced(i) || !ownOnly(i)) continue;
    n++;
    offer(before(i));
  }
  // the start of a step: the earliest index whose board is still in it
  const startOf = (end: number): number => {
    const key = stepKey(at(end));
    let j = end;
    while (j > lo && stepKey(at(j - 1)) === key) j--;
    return j;
  };
  const here = segNow !== null ? openStart : startOf(len);
  // (the window's edge mid-step — a restart, or a step longer than the window — is not its start)
  if (here > lo || lo === 0) offer({ to: here, kind: 'start', step: stepLabel(at(len)), items: items(here), hiddenStep: segNow !== null, seat });
  // the start of the step before skips forced actions, as the before-cuts do (a cut just before
  // one takes it again at once); a step of nothing but forced actions was never stood on, so it
  // is passed over for the last step a player actually stood in.
  let end = here;
  while (end > lo) {
    const prev = startOf(end - 1);
    let to = prev;
    while (to < end && forced(to)) to++;
    if (to < end) {
      offer({ to, kind: 'prev', step: stepLabel(at(to)), items: items(to), hiddenStep: segNow !== null, seat });
      break;
    }
    end = prev;
  }
  return plans.sort((x, y) => y.to - x.to);
}

/** the rewinds on offer to `seat`, in that seat's words */
export function rewindOptions(room: Room, seat: Seat): RewindOption[] {
  return rewindPlans(room, seat).map(p => {
    const { head, takes } = cutParts(p, seat, room.names);
    return { to: p.to, label: capital(head), takes };
  });
}

/** the edit as a client sent it, rebuilt from known fields only — or null */
function sanitizeEdit(raw: unknown): AmendEdit | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const seat = (v: unknown): Seat | null => v === 0 || v === 1 ? v : null;
  const int = (v: unknown): number | null => typeof v === 'number' && Number.isInteger(v) ? v : null;
  const str = (v: unknown): string | null => typeof v === 'string' && v.length <= 80 ? v : null;
  switch (r['kind']) {
    case 'life': { const t = seat(r['target']), l = int(r['life']); return t !== null && l !== null ? { kind: 'life', target: t, life: l } : null; }
    case 'drawCards': { const t = seat(r['target']), n = int(r['n']); return t !== null && n !== null ? { kind: 'drawCards', target: t, n } : null; }
    case 'move': {
      const from = r['from'], to = r['to'], index = int(r['index']), card = str(r['card']);
      if (!(AMEND_SOURCES as readonly unknown[]).includes(from) || !(AMEND_DESTS as readonly unknown[]).includes(to)) return null;
      return index !== null && card !== null
        ? { kind: 'move', from: from as AmendSource, index, card, to: to as AmendDest } : null;
    }
    case 'unit': {
      const id = int(r['id']), card = str(r['card']), to = r['to'];
      if (!(AMEND_UNIT_DESTS as readonly unknown[]).includes(to)) return null;
      return id !== null && card !== null ? { kind: 'unit', id, card, to: to as AmendUnitDest } : null;
    }
    default: return null;
  }
}

export type FixOutcome = { ok: true } | { ok: false; why: string };

/**
 * `seat` proposes a fix. `req` is the client's `{ edit }` or `{ rewind }` and
 * `reason`, untrusted. On success the proposal stands and both clocks stop;
 * the caller tells both seats.
 *
 * An edit is TRIED on a copy of the board first (the engine is pure), so the
 * other seat is never asked to agree to something that would then bounce.
 */
export function proposeFix(room: Room, seat: Seat, req: { edit?: unknown; rewind?: unknown; reason?: unknown; takeBack?: unknown }, now = Date.now()): FixOutcome {
  const no = fixesRefusal(room);
  if (no !== null) return { ok: false, why: no };
  if (!room.sockets[0] || !room.sockets[1]) return { ok: false, why: 'your opponent is not here to agree' };
  if (room.proposal) return { ok: false, why: 'a fix is already waiting for an answer' };
  const cool = room.fixCooldown[seatSlot(seat)] - now;
  if (cool > 0) return { ok: false, why: `your last fix was declined — wait ${Math.ceil(cool / 1000)}s` };
  const reason = typeof req.reason === 'string' ? req.reason.trim().slice(0, FIX_REASON_MAX) : '';
  // a take-back is not a bug, and needs no "what went wrong"
  const takeBack = req.takeBack === true;
  if (!takeBack && reason.length < 3) return { ok: false, why: 'say what went wrong — it is filed as a bug report' };
  let p: Omit<Proposal, 'id' | 'expires' | 'at' | 'seat' | 'reason' | 'takeBack'>;
  if (req.rewind !== undefined) {
    const to = req.rewind;
    const plan = rewindPlans(room, seat).find(o => o.to === to);
    if (!plan) return { ok: false, why: 'that rewind is not on offer any more — open the fix again' };
    // no count of the log in any of them, and each seat its own words
    p = {
      kind: 'rewind', to: plan.to, what: cutText(plan, 'record', room.names),
      whats: [cutText(plan, 0, room.names), cutText(plan, 1, room.names)],
      pub: cutText(plan, 'public', room.names),
    };
  } else {
    const edit = sanitizeEdit(req.edit);
    if (!edit) return { ok: false, why: 'that is not a fix this version knows' };
    const t = editTiming(room);
    if (t !== null) return { ok: false, why: t };
    const problem = amendProblem(room.state, seat, edit);
    if (problem !== null) return { ok: false, why: problem };
    try {
      apply(room.state, { type: 'amend', seat, by: other(seat), edit });
    } catch (err) {
      if (err instanceof IllegalAction) return { ok: false, why: err.message };
      throw err;
    }
    p = { kind: 'edit', edit, what: amendText(room.state, seat, edit) };
  }
  settleClock(room);
  room.proposal = { ...p, id: ++proposalSeq, seat, reason, ...(takeBack ? { takeBack: true as const } : {}),
    at: room.actions.length, expires: now + FIX_PROPOSAL_MS };
  settleClock(room);   // both clocks stop from here
  return { ok: true };
}

/**
 * An answer to the open proposal: the OTHER seat accepts or declines, the
 * proposer cancels. Returns the proposal it settles (cleared from the room;
 * the caller carries an accept out), or the refusal.
 */
export function answerFix(room: Room, seat: Seat, op: 'accept' | 'decline' | 'cancel', id: unknown, now = Date.now()): { ok: true; proposal: Proposal } | { ok: false; why: string } {
  const p = room.proposal;
  if (!p || p.id !== id) return { ok: false, why: 'that fix is no longer waiting for an answer' };
  if (op === 'cancel' ? seat !== p.seat : seat === p.seat) {
    return { ok: false, why: op === 'cancel' ? 'only the player who proposed it can cancel it' : 'the other player answers your proposal' };
  }
  if (now > p.expires) { dropProposal(room); return { ok: false, why: 'that fix ran out of time' }; }
  if (op === 'accept' && room.actions.length !== p.at) {
    dropProposal(room);
    return { ok: false, why: 'the board moved since it was proposed' };
  }
  dropProposal(room);
  if (op === 'decline') room.fixCooldown[seatSlot(p.seat)] = now + FIX_COOLDOWN_MS;
  return { ok: true, proposal: p };
}

/** Clear the open proposal, restarting the clocks. True if there was one. */
export function dropProposal(room: Room): boolean {
  if (!room.proposal) return false;
  settleClock(room);
  room.proposal = null;
  settleClock(room);
  return true;
}

/** the expiry sweep's question: a proposal past its minute is dropped */
export function proposalExpired(room: Room, now = Date.now()): boolean {
  return !!room.proposal && now > room.proposal.expires && dropProposal(room);
}

/** Record an agreed EDIT whose `amend` action has just landed at `at`. */
export function recordAmendment(room: Room, entry: Amendment): void {
  room.amendments.push(entry);
  persist(room);
}

/* Disputing a finished game: a dispute files a report and tags the game; it changes no result,
 * rating or stat (main.ts / dispute.ts carry it out). */

/** the longest "what went wrong" a dispute keeps */
export const DISPUTE_NOTE_MAX = 1000;

/** Why this ROOM takes no disputes at all — or null when it does. What the
 * post-game screen's button is drawn from: a game between two players. */
export function disputesRefusal(room: Room): string | null {
  // a scenario (the tester, Learn-style scripts) and test mode have no
  // opponent whose result could be wrong
  if (room.state.sandbox || room.scenario) return 'only a game between two players can be disputed';
  return null;
}

/** `seat` can watch this game back once it is decided: `/api/replay` admits an account that
 * played it, and the browser viewer refuses a scenario deal; a sandbox room's file is scratch. */
export function replayableBy(room: Room, seat: Seat): boolean {
  return !!room.users[seat] && !room.state.sandbox && !room.scenario;
}

/** Why `seat` may not dispute this game right now — null when it may. */
export function disputeRefusal(room: Room, seat: Seat | null): string | null {
  if (seat !== 0 && seat !== 1) return 'only a player in this game can dispute it';
  const no = disputesRefusal(room);
  if (no) return no;
  if (roomWaiting(room) || !gameDecided(room)) return 'the game is not over';
  if (room.disputes.some(d => d.seat === seat)) return 'you have already disputed this game';
  return null;
}

/** which seats have disputed, as the post-game screen reads it */
export const disputedSeats = (room: Room): [boolean, boolean] =>
  [room.disputes.some(d => d.seat === 0), room.disputes.some(d => d.seat === 1)];

/** Record one seat's dispute and save it with the room. The caller has asked
 * disputeRefusal; this asks again, so nothing can record a second one. */
export function recordDispute(room: Room, seat: Seat | null, note: string, now = Date.now()): Dispute | string {
  const no = disputeRefusal(room, seat);
  if (no !== null || seat === null) return no ?? 'only a player in this game can dispute it';
  const text = note.trim().slice(0, DISPUTE_NOTE_MAX);
  if (!text) return 'say what went wrong';
  const d: Dispute = { seat, at: new Date(now).toISOString(), note: text, actionIndex: room.actions.length };
  room.disputes.push(d);
  persist(room);
  return d;
}

/** a file's disputes back off disk — drop what is not one, and a second per seat */
function sanitizeDisputes(raw: unknown): Dispute[] {
  if (!Array.isArray(raw)) return [];
  const out: Dispute[] = [];
  for (const d of raw) {
    if (!d || typeof d !== 'object') continue;
    const x = d as Partial<Dispute>;
    if ((x.seat !== 0 && x.seat !== 1) || out.some(o => o.seat === x.seat)) continue;
    if (typeof x.note !== 'string' || typeof x.at !== 'string' || !Number.isInteger(x.actionIndex)) continue;
    out.push({ seat: x.seat, at: x.at, note: x.note, actionIndex: x.actionIndex! });
  }
  return out;
}

/** Is a fix accepted NOW part of the open run — no game action since the
 * last one? Asked before the fix is carried out. */
export function fixRunContinues(room: Room): boolean {
  const r = room.fixRun;
  return !!r && room.actions.length === r.len && r.from < room.amendments.length;
}

/** After a fix is carried out (its amendment pushed, forced steps drained):
 * extend the open run, or start one. `at` is the proposal's log length. */
export function noteFixRun(room: Room, continues: boolean, at: number, now = Date.now()): void {
  if (continues && room.fixRun) {
    room.fixRun.len = room.actions.length;
    room.fixRun.last = now;
  } else {
    room.fixRun = { from: room.amendments.length - 1, at, len: room.actions.length, last: now };
  }
  persist(room);
}

/** End the open run: clear it and hand back what to file (null: none). `keepDate`: the boot's
 * flush, which is not a move (see persist). */
export function takeFixRun(room: Room, keepDate = false): { from: number; at: number; fixes: Amendment[] } | null {
  const r = room.fixRun;
  if (!r) return null;
  room.fixRun = null;
  persist(room, keepDate);
  const fixes = room.amendments.slice(r.from);
  return fixes.length ? { from: r.from, at: r.at, fixes } : null;
}

/** a file's unfiled run back off disk — dropped unless it indexes a fix */
function sanitizeFixRun(raw: unknown, amendments: unknown): FixRun | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(amendments)) return null;
  const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (!int(r['from']) || !int(r['at']) || !int(r['len']) || !int(r['last']) || r['from'] >= amendments.length) return null;
  return { from: r['from'], at: r['at'], len: r['len'], last: r['last'] };
}

/**
 * Carry out an agreed rewind: truncate the log to `p.to` and rebuild. Returns the record, or a
 * refusal (the room untouched). What goes with the cut, being a claim about the actions cut:
 * `sigs`, `cardLog`, version stamps past the end (clamped), and the soft state an action would
 * have dropped. The caller drains the forced steps owed and re-sends each seat a fresh view.
 */
export function rewindRoom(room: Room, p: Proposal, by: Seat): { ok: true; amendment: Amendment } | { ok: false; why: string } {
  const to = p.to;
  if (p.kind !== 'rewind' || to === undefined || to < room.bases[0]!.at || to >= room.actions.length) {
    return { ok: false, why: 'that rewind is not on offer any more' };
  }
  settleClock(room);
  const restore = room.actions;
  room.actions = restore.slice(0, to);
  const rb = rebuildRoom(room, to);
  if (rb.skipped.length) {
    // a prefix of a clean log always replays; if this one does not, the room
    // was never clean, and cutting it would hide that
    room.actions = restore;
    return { ok: false, why: 'this game cannot be rewound — part of its log no longer replays' };
  }
  assignRebuild(room, rb);
  room.sigs = room.sigs.slice(0, to);
  room.cardLog = room.cardLog.slice(0, to);
  for (const v of room.versions) if (v.from > to) v.from = to;
  room.versions = room.versions.filter((v, i, all) => !all.slice(i + 1).some(w => w.from === v.from));
  room.passAll = [null, null]; room.passAllWait = [null, null]; room.passAllCovered = [null, null];
  room.deferred = [[], []];
  room.building = [null, null];
  room.watchHold = [null, null];
  room.proposal = null;
  const amendment: Amendment = {
    kind: 'rewind', at: to, seat: p.seat, by, what: p.what, reason: p.reason,
    ...(p.takeBack ? { takeBack: true as const } : {}),
    when: new Date().toISOString(), removed: restore.slice(to),
  };
  room.amendments.push(amendment);
  room.lastActionAt = Date.now();
  settleClock(room);
  persist(room);
  return { ok: true, amendment };
}

/** The refusal a player reads when an undo is rolled back. It names what was measured, so the
 * player can tell a rule from a bug. */
function undoRefusal(refused: LostAction[]): string {
  // an agreed fix in the way is named as one
  if (refused.some(r => r.type === 'amend')) return 'taking that back would change an agreed fix — it cannot be undone now';
  const changed = refused.every(r => r.kind === 'changed');
  const what = refused.length === 1 ? 'a move' : `${refused.length} moves`;
  return changed
    ? `taking that back would change what ${what} made after it refers to — it cannot be undone now`
    : `taking that back would drop ${what} made after it — it cannot be undone now`;
}

/** The recorded fingerprints off disk, aligned to the log. Nothing is invented: a missing entry
 * is `''` ("not recorded"), never the rebuilding engine's answer, which once persisted would let
 * a later replay verify today's answer against itself. Entries past the log are dropped. */
function sanitizeSigs(raw: unknown, actions: number): string[] {
  const recorded = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (let i = 0; i < actions; i++) {
    const r = recorded[i];
    out.push(typeof r === 'string' && r ? r : '');
  }
  return out;
}

/** A file's card log, index-aligned with its actions; a missing or unreadable
 * entry is null, never recomputed (Room.cardLog). */
function sanitizeCardLog(raw: unknown, actions: number): (CardFact | null)[] {
  const recorded = Array.isArray(raw) ? raw : [];
  const out: (CardFact | null)[] = [];
  for (let i = 0; i < actions; i++) out.push(sanitizeFact(recorded[i]));
  return out;
}

/** A file's version ledger, keeping only entries this server could have written. A malformed
 * entry is dropped, never repaired: an invented `from` would send `--as-recorded` to the wrong
 * commit. `from` must be non-decreasing. */
function sanitizeVersions(raw: unknown): VersionStamp[] {
  if (!Array.isArray(raw)) return [];
  const out: VersionStamp[] = [];
  for (const v of raw as VersionStamp[]) {
    if (!v || typeof v.sha !== 'string' || !v.sha) continue;
    if (typeof v.from !== 'number' || !Number.isInteger(v.from) || v.from < 0) continue;
    if (out.length && v.from < out[out.length - 1]!.from) continue;
    out.push({ at: typeof v.at === 'string' ? v.at : '', sha: v.sha, from: v.from });
  }
  return out;
}

/**
 * This room is about to be played on THIS engine: append a stamp unless the last one already
 * names it (true when appended, so the caller persists; one stamp per commit across restarts).
 * A file without stamps gets its first at `from` = the actions already logged, never `from: 0`:
 * backdating the current SHA over an older engine's log would make `--as-recorded` replay the wrong rules.
 */
function stampVersion(room: Room): boolean {
  const sha = engineVersion();
  const last = room.versions[room.versions.length - 1];
  if (last && last.sha === sha) return false;
  room.versions.push({ at: new Date().toISOString(), sha, from: room.actions.length });
  return true;
}

/** rebuild() from the room's latest base at or before `from` — the first
 * action that changes. */
function rebuildRoom(room: Room, from: number): Rebuilt {
  return rebuild(room, room.bases.filter(b => b.at <= from).at(-1) ?? room.bases[0]!);
}

/** Adopt a rebuild's results wholesale (state + event history + the derived
 * segment and integrity bookkeeping). */
function assignRebuild(room: Room, rb: Rebuilt): void {
  room.bases = rb.bases;
  room.state = rb.state;
  room.events = rb.events;
  room.segKey = rb.segKey;
  room.segSnapshot = rb.segSnapshot;
  room.heldEvents = rb.heldEvents;
  room.heldFrames = rb.heldFrames;
  room.closing = null;
  room.segStartIndex = rb.segStartIndex;
  room.segSeen = rb.segSeen;
  room.seenPending = [];
  room.ccMarks = rb.ccMarks;
  room.segIdFloor = rb.segIdFloor;
  room.segRefs = rb.segRefs;
  // `sigs` is NOT adopted: it is the record, and a rebuild is what it must survive. Its two
  // legitimate extenders (restoreRooms, undoActionAt's spliced tail) write it themselves.
}

/** Build the room a rematch moves to: same players, seats and format, a new seed. A draft gets a
 * fresh lobby that knows what you just played; constructed keeps both decks and deals at once. */
export function createRematch(old: Room, code: string): Room {
  const seed = (Math.random() * 1e9) >>> 0;
  // a rematch keeps the clock setting: it is the same game again
  const room = old.mode === 'constructed' && old.decks[0] && old.decks[1]
    // …and a single card duel stays one, with the same two cards
    ? createRoom(code, seed, [...old.names], old.mode, old.els, old.decks[0]!, undefined, old.clockStart, undefined, !!old.single)
    // and a custom draft keeps its rules — the same resolved deal, not a re-resolution
    : createRoom(code, seed, [...old.names], old.mode, old.mode === 'draft' ? undefined : old.els,
      undefined, undefined, old.clockStart, old.custom, false,
      // a Competitive draft's rematch is Competitive too
      old.mode === 'draft' && old.rules?.sequential ? { rules: { sequential: true } } : undefined);
  if (old.mode === 'constructed' && old.decks[0] && old.decks[1]) {
    room.decks = [[...old.decks[0]!], [...old.decks[1]!]];
    room.deckIds = [...old.deckIds];
    const { state, events } = fresh(seed, room.names, room.mode, room.els, [room.decks[0]!, room.decks[1]!], room.scenario, room.custom?.deal, room.rules);
    room.state = state;
    room.events = events;
  } else if (old.mode === 'draft') {
    room.lobby = freshLobby('pick-one', old.els);
  }
  // carry the seat↔account binding over, so the rematch is already countable
  // even before either client has re-joined
  room.users = [...old.users];
  room.state = named(room.state, room.names);
  resetSegment(room);   // the constructed branch above replaced the state
  old.rematchRoom = code;
  persist(room);
  return room;
}

/**
 * Build the room the matchmaker puts two strangers into. The server builds it outright and hands
 * both clients its code, so there is no window where one has a room and the other a URL. `a`
 * takes seat 0 (queue.ts randomises the pair). Unlike a normal creation:
 *   1. `rated: true` — the only site that sets it (Room.rated);
 *   2. the clock comes from MATCH_CLOCK_MS, not from either player;
 *   3. `users` is stamped before either client connects, so the game is attributable from the
 *      first action even if a player closes the tab.
 */
export function createMatch(
  a: { userId: string; username: string; deck?: CardName[]; deckId?: string },
  b: { userId: string; username: string; deck?: CardName[]; deckId?: string },
  mode: 'constructed' | 'draft',
  code: string,
): Room {
  const seed = (Math.random() * 1e9) >>> 0;
  const names: [string, string] = [a.username, b.username];
  if (mode === 'constructed') {
    if (!a.deck || !b.deck) throw new IllegalAction('a constructed match needs both decks');
    // both players brought a deck to queue, so the room deals rather than opening a picker;
    // createRoom takes one deck, so the second is assigned and the state re-dealt from both
    const room = createRoom(code, seed, names, mode, undefined, a.deck, undefined, MATCH_CLOCK_MS.constructed);
    room.decks = [[...a.deck], [...b.deck]];
    room.deckIds = [a.deckId ?? null, b.deckId ?? null];
    const { state, events } = fresh(seed, names, mode, room.els, [room.decks[0]!, room.decks[1]!], room.scenario, room.custom?.deal, room.rules);
    room.state = state;
    room.events = events;
    room.users = [a.userId, b.userId];
    room.rated = true;
    room.state = named(room.state, names);
    resetSegment(room);   // the deal above replaced the state
    persist(room);
    return room;
  }
  // Draft: no trio, so createRoom opens the blind lobby and neither stranger picks the elements
  const room = createRoom(code, seed, names, mode, undefined, undefined, undefined, MATCH_CLOCK_MS.draft);
  room.users = [a.userId, b.userId];
  room.rated = true;
  room.state = named(room.state, names);
  persist(room);
  return room;
}

/**
 * The room a league match is played in (docs/20-league.md §5): createMatch's draft branch, but
 *   1. `league` is stamped, so the finished game reports to the league;
 *   2. the lobby uses the 'random' method, drawn only once both players are ready, so nobody
 *      sees a pack before the opponent arrives (dealing at creation would skip the lobby);
 *   3. `rated` is the caller's: system-made pairings move the rating, a week-0 game does not.
 * `users` is stamped before either client connects, so seatVerdict admits only the two players.
 */
export function createLeagueRoom(
  a: { userId: string; username: string },
  b: { userId: string; username: string },
  code: string,
  league: RoomLeague,
  rated: boolean,
  mode: 'draft' | 'constructed' = 'draft',
): Room {
  const seed = (Math.random() * 1e9) >>> 0;
  const names: [string, string] = [a.username, b.username];
  // A constructed season uses the ordinary constructed waiting room: each seat picks a deck there.
  // Created on the placeholder and the constructed clock; a rated one moves the constructed
  // rating (the rating is per room.mode).
  const room = mode === 'constructed'
    ? createRoom(code, seed, names, 'constructed', undefined, leaguePlaceholderDeck(), undefined, MATCH_CLOCK_MS.constructed)
    : createRoom(code, seed, names, 'draft', undefined, undefined, undefined, MATCH_CLOCK_MS.draft);
  if (mode === 'draft') room.lobby = freshLobby('random');
  room.users = [a.userId, b.userId];
  room.league = { ...league };
  if (rated) room.rated = true;
  room.state = named(room.state, names);
  persist(room);
  return room;
}

/** Rename a seat. Names are cosmetic and live outside the action log, so they never reach the
 * open segment's frozen snapshot: viewFor() carries the live name over it (a name is never
 * hidden). The state is replaced, never edited: a rebuild base may be holding it. */
export function renameSeat(room: Room, seat: 0 | 1, name: string): void {
  room.names[seat] = name;
  room.state = named(room.state, room.names);
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

/** Games whose last move (`lastActionOf`, never the mtime) is older than this stay on disk and
 * are not restored at boot; replay-room.ts and the history fold still read their files. */
const RESTORE_WINDOW_MS = 7 * 24 * 3600_000;
/** how long a finished game with nobody at it stays in memory (main.ts sweepFinished) */
export const FORGET_AFTER_MS = 3600_000;

/**
 * When a saved game's log last changed: `lastActionAt`, or for an older file the earliest version
 * stamp whose `from` equals the log's length (written by a boot that found every action there, so
 * an upper bound on the last one). With no such stamp, the mtime.
 */
export function lastActionOf(raw: { lastActionAt?: unknown; actions?: unknown; versions?: unknown }, mtimeMs: number): number {
  if (typeof raw.lastActionAt === 'number' && Number.isFinite(raw.lastActionAt)) return raw.lastActionAt;
  const n = Array.isArray(raw.actions) ? raw.actions.length : 0;
  for (const v of sanitizeVersions(raw.versions)) {
    if (v.from !== n) continue;
    const at = Date.parse(v.at);
    if (Number.isFinite(at)) return Math.min(at, mtimeMs);
  }
  return mtimeMs;
}

/**
 * `keepDate`: write the file but leave its mtime, which history.ts reads as the day a game was
 * played. A write that is not a move (a version stamp, a fork record, a boot's fix-run filing)
 * must not move it.
 */
function persist(room: Room, keepDate = false, live = true): void {
  // sandbox rooms are persisted too (test-sandbox.ts rebuilds one across a restart); main.ts's
  // cap bounds the disk, evicting the oldest with its file
  try {
    mkdirSync(GAMES_DIR, { recursive: true });
    const path = join(GAMES_DIR, `${room.code}.json`);
    let was: number | null = null;
    if (keepDate) { try { was = statSync(path).mtimeMs; } catch { /* no file yet: nothing to keep */ } }
    // temp + rename: this file is the game's only record, and a crash mid-write must not leave it
    // half-written
    const tmp = `${path}.tmp`;
    // clockMs is persisted: elapsed time cannot be reconstructed from a replay
    writeFileSync(tmp, JSON.stringify({
      seed: room.seed, mode: room.mode, els: room.els, names: room.names,
      // who each seat belonged to, so the stats fold knows whose game this was
      users: room.users,
      // and the result, stamped at the time — see Room.winner
      winner: room.winner,
      // CR D8.5: when a concede decided it, who conceded on which turn (written only when present)
      ...(room.concession ? { concession: room.concession } : {}),
      // the draft lobby: a room can restart mid-trio-choice
      ...(room.lobby ? { lobby: room.lobby } : {}),
      // CR D8.4: the scenario is part of the DEAL, so it sits beside `seed`, not the log
      ...(room.scenario ? { scenario: room.scenario } : {}),
      // the custom rules and the deal they resolved to: the deal is what a restore re-deals from
      ...(room.custom ? { custom: room.custom } : {}),
      // CR D8.2: a single card duel, written only when set
      ...(room.single ? { single: true } : {}),
      ...(room.singleDraw ? { singleDraw: room.singleDraw } : {}),
      // rated iff the matchmaker made this room; written only when true, and absent reads as unrated
      ...(room.rated ? { rated: true } : {}),
      // the league match this room settles. Additive: written only when set.
      ...(room.league ? { league: room.league } : {}),
      // docs/22 §2.3: a CC game's rules are part of the deal, like `custom`; and its match link
      ...(room.rules ? { rules: room.rules } : {}),
      ...(room.match ? { match: room.match } : {}),
      actions: room.actions, clockMs: room.clockMs,
      // when the log last changed: what restore and the idle sweep age a room by
      lastActionAt: room.lastActionAt,
      // …and, on the one write that ends a room's life, why it ended
      ...(room.closed ? { closed: room.closed } : {}),
      // the room's own bank, always written: `null` is no clock, and must differ from a file that
      // predates the setting (absent means CLOCK_START_MS)
      clockStart: room.clockStart,
      // how long the match took and when it started; absent (an older file) reads as unknown
      matchMs: room.matchMs, startedAt: room.startedAt,
      // what each action meant when it was taken (referenceKey); its tags are process-local, so
      // the card ledger reads only each key's zone-delta tail
      ...(room.segRefs.length === room.actions.length && room.actions.length
        ? { refs: room.segRefs }
        : {}),
      // the board after each action, recorded as played (Room.sigs). Length-guarded like `refs`: a
      // partial array cannot be indexed by action, and half a record read as whole is worse than none.
      ...(room.sigs.length === room.actions.length && room.actions.length
        ? { sigs: room.sigs }
        : {}),
      // what each action did to the cards (Room.cardLog); the same length guard
      ...(room.cardLog.length === room.actions.length && room.actions.length
        ? { cardLog: room.cardLog }
        : {}),
      ...(room.cardOpen && room.actions.length ? { cardOpen: room.cardOpen } : {}),
      // the agreed fixes: the "fixed" tag's source and a rewind's archive
      ...(room.amendments.length ? { amendments: room.amendments } : {}),
      // who disputed the result
      ...(room.disputes.length ? { disputes: room.disputes } : {}),
      // …and the run of them not yet filed as a report (see FixRun)
      ...(room.fixRun ? { fixRun: room.fixRun } : {}),
      // every restore that could not faithfully rebuild this game, so the file never claims to be
      // a straight-through record of it
      ...(room.forks.length ? { forks: room.forks } : {}),
      // which engine recorded which stretch of this log: what `replay-room.ts --as-recorded` replays against
      ...(room.versions.length ? { versions: room.versions } : {}),
      // constructed: decks are part of the replay config
      ...(room.mode === 'constructed' ? { decks: room.decks, deckIds: room.deckIds } : {}),
      // where a restart resumes this game: the log is never replayed to load it.
      // A finished game keeps it while it is in memory (its post-game screen)
      ...(room.closed || !live ? {} : { live: liveBlock(room) }),
    }));
    renameSync(tmp, path);
    if (was !== null) pinMtime(path, was);
  } catch (err) {
    console.error(`[rooms] could not persist ${room.code}:`, err);
  }
}

/** The room's resume point as the file holds it: held events by their index
 * in `events`, so a load hands back the very objects the history holds. */
function liveBlock(room: Room): object {
  const p = resumePoint(room);
  const held = p.seg.held.map(h => h.map(e => room.events.lastIndexOf(e)));
  return { schema: STATE_SCHEMA, at: p.at, state: p.state, events: room.events, seg: { start: p.seg.start, snapshot: p.seg.snapshot, held } };
}

/** A file's `live` block back as a resume point and its event history, or
 * null when it has none this engine can take for this log. */
function resumeOf(raw: unknown, actions: number): { base: Resume; events: EngineEvent[] } | null {
  const l = raw as { schema?: unknown; at?: unknown; state?: GameState; events?: unknown; seg?: { start?: unknown; snapshot?: GameState | null; held?: unknown } } | null;
  if (!l || typeof l !== 'object' || l.schema !== STATE_SCHEMA) return null;
  const seg = l.seg, events = l.events as EngineEvent[];
  if (l.at !== actions || !l.state || !Array.isArray(events) || !seg || !Number.isInteger(seg.start) || !Array.isArray(seg.held)) return null;
  const state = l.state;
  try { legalActions(state, 0); legalActions(state, 1); } catch { return null; }
  const idx = seg.held as unknown[];
  const held = [idx[0], idx[1]].map(h => (Array.isArray(h) ? h : [])
    .map(i => events[i as number]).filter((e): e is EngineEvent => !!e)) as [EngineEvent[], EngineEvent[]];
  // the playback of what was held before the restart: one frame, the board now
  const frames = held.map(h => h.length ? [{ state, events: h }] : []) as [HeldFrame[], HeldFrame[]];
  return { base: point(actions, events.length, state, seg.start as number, seg.snapshot ?? null, held, frames), events };
}

/** A run of fixes in a file the restore does not load (closed, or a week without a move). The
 * restore takes it out of the file (keeping the date) and parks it here; main.ts files each one
 * as a live run is filed. */
export interface StaleFixRun {
  code: string;
  users: [string | null, string | null];
  from: number;
  at: number;
  fixes: Amendment[];
}
const staleFixRuns: StaleFixRun[] = [];
/** the runs the last restore took out of files it did not load; empties the list */
export function takeStaleFixRuns(): StaleFixRun[] {
  return staleFixRuns.splice(0);
}
/** a not-restored file's unfiled run, parked for main.ts — null when none */
function staleFixRunOf(code: string, raw: { fixRun?: unknown; amendments?: unknown; users?: unknown }): StaleFixRun | null {
  const run = sanitizeFixRun(raw.fixRun, raw.amendments);
  if (!run) return null;
  const fixes = sanitizeAmendments(raw.amendments, 0).slice(run.from);
  if (!fixes.length) return null;
  const u = Array.isArray(raw.users) ? raw.users : [];
  const user = (x: unknown): string | null => (typeof x === 'string' ? x : null);
  return { code, users: [user(u[0]), user(u[1])], from: run.from, at: run.at, fixes };
}

/** Restore all persisted rooms from their resume points. Best-effort: a room
 * whose file throws is skipped with a warning rather than crashing startup. */
export function restoreRooms(now = Date.now()): void {
  let files: string[];
  try {
    files = readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'));
  } catch {
    return; // no games dir yet
  }
  let stale = 0;
  let closedCount = 0;
  for (const f of files) {
    const code = f.replace(/\.json$/, '');
    try {
      const path = join(GAMES_DIR, f);
      const mtimeMs = statSync(path).mtimeMs;
      const raw = JSON.parse(readFileSync(path, 'utf8')) as {
        seed: number; mode?: GameMode; els?: Element[]; names?: [string, string];
        actions: Action[]; clockMs?: [number, number];
        /** the room's bank; absent in a file older than the setting (see below) */
        clockStart?: number | null;
        /** how long the match ran, and when it started; absent reads as unknown */
        matchMs?: number;
        startedAt?: number | null;
        users?: [string | null, string | null];
        winner?: number | null;
        lobby?: Lobby;
        decks?: [CardName[] | null, CardName[] | null];
        deckIds?: [string | null, string | null];
        forks?: Fork[];
        /** per-action reference keys, as of when the game was played
         * (process-local tags — never compared; the card ledger reads them) */
        refs?: unknown;
        /** per-action board fingerprints, as of when the game was played */
        sigs?: unknown;
        /** per-action card facts and the opening, as played */
        cardLog?: unknown;
        cardOpen?: unknown;
        versions?: VersionStamp[];
        /** CR D8.4: the scenario this room was dealt with */
        scenario?: unknown;
        /** the custom rules, and the deal they resolved to */
        custom?: { rules?: unknown; deal?: unknown } | null;
        /** the matchmaker made this room */
        rated?: unknown;
        /** the league match this room settles (docs/20-league.md) */
        league?: unknown;
        /** docs/22: a CC game's rules (part of the deal) and its match link */
        rules?: unknown;
        match?: unknown;
        /** CR D8.5: who conceded, on which turn */
        concession?: unknown;
        /** CR D8.2: a single card duel */
        single?: unknown;
        /** CR D8.2c: the pair it was last drawn on */
        singleDraw?: unknown;
        /** when the log last changed (lastActionOf) */
        lastActionAt?: unknown;
        /** the room was closed: never restored */
        closed?: unknown;
        /** the agreed fixes */
        amendments?: unknown;
        /** who disputed the result */
        disputes?: unknown;
        /** the run of them not yet filed */
        fixRun?: unknown;
        /** where a live game resumes (liveBlock) */
        live?: unknown;
      };
      // a file this loop does not load still files its run of fixes
      const strayRun = raw.fixRun === undefined ? null : staleFixRunOf(code, raw);
      // a CLOSED game is over for good — never back in the map
      if (raw.closed) {
        closedCount++;
        if (strayRun) {
          const { fixRun: _filed, ...rest } = raw;
          const tmp = `${path}.tmp`;
          writeFileSync(tmp, JSON.stringify(rest));
          renameSync(tmp, path);
          pinMtime(path, mtimeMs);
          staleFixRuns.push(strayRun);
        }
        continue;
      }
      const lastActionAt = lastActionOf(raw, mtimeMs);
      // a finished game past the hour `sweepFinished` keeps one for is not loaded: it would only
      // be forgotten again
      const stampedOver = raw.winner === 0 || raw.winner === 1;
      // closed in its file on the way past (no result — `winner` untouched), so
      // its link says what happened instead of "no game with that code"
      const closeFile = (closed: RoomClosed): void => {
        if (strayRun) staleFixRuns.push(strayRun);
        const { fixRun: _filed, live: _live, ...kept } = raw;
        const tmp = `${path}.tmp`;
        writeFileSync(tmp, JSON.stringify({ ...kept, lastActionAt, closed }));
        renameSync(tmp, path);
        pinMtime(path, lastActionAt);
        closedCount++;
      };
      // a finished game not loaded keeps its result; its run of fixes is filed
      // and its resume point dropped — the file is the record now
      const leaveFile = (): void => {
        stale++;
        if (!strayRun && raw.live === undefined) return;
        if (strayRun) staleFixRuns.push(strayRun);
        const { fixRun: _filed, live: _live, ...kept } = raw;
        const tmp = `${path}.tmp`;
        writeFileSync(tmp, JSON.stringify(kept));
        renameSync(tmp, path);
        pinMtime(path, mtimeMs);   // filing a run is not a move
      };
      if (now - lastActionAt > RESTORE_WINDOW_MS || (stampedOver && now - lastActionAt > FORGET_AFTER_MS)) {
        // a week without a move. An UNFINISHED one is closed; a finished one
        // keeps its result and is simply not loaded.
        if (!stampedOver) {
          closeFile({ reason: 'idle', at: now, afterMs: idleWindowMs(Array.isArray(raw.actions) ? raw.actions.length : 0) });
          continue;
        }
        leaveFile();
        continue;
      }
      const concession = sanitizeConcession(raw.concession);
      const names = raw.names ?? ['Player 1', 'Player 2'];
      const users: [string | null, string | null] = [raw.users?.[0] ?? null, raw.users?.[1] ?? null];
      const savedWinner: Seat | null = raw.winner === 0 || raw.winner === 1 ? raw.winner : null;
      const mode = raw.mode ?? 'shared';
      const custom = restoreCustom(raw.custom, mode);
      const els = sanitizeTrio(raw.els, roomElementCount({ custom }));
      // CR D8.4: a file naming a scenario this build lacks is refused, never restored as an
      // ordinary game: replaying its log without that board would describe a game nobody played.
      // The catch below skips the room with the reason.
      const scenario = raw.scenario === undefined || raw.scenario === null
        ? undefined
        : String(raw.scenario);
      if (scenario !== undefined && !isDealId(scenario)) {
        throw new Error(`saved with scenario '${scenario}', which this build does not define`
          + ' — refusing to replay its log onto an ordinary deal');
      }
      const decks: [CardName[] | null, CardName[] | null] = [null, null];
      const single = mode === 'constructed' && raw.single === true;
      const league = sanitizeLeague(raw.league);
      // docs/22 §2.3: throws on rules this build cannot read (the catch below
      // skips the room with the reason) — never a CC log under house rules
      const rules = restoreRules(raw.rules, mode);
      const match = sanitizeRoomMatch(raw.match);
      if (mode === 'constructed') {
        for (const s of [0, 1] as const) {
          // CR D8.2: a single-card room holds single-card decks and nothing else
          const c = single ? checkSingleDeck(raw.decks?.[s]) : checkDeck(raw.decks?.[s]);
          if (c.ok) decks[s] = c.cards;
        }
        // …except a constructed LEAGUE room nobody has picked a deck in yet,
        // which waits on the placeholder (createLeagueRoom)
        if (!decks[0] && !decks[1] && !league && !match) throw new Error('constructed room with no decks');
      }
      const deckIds: [string | null, string | null] = [
        typeof raw.deckIds?.[0] === 'string' ? raw.deckIds[0] : null,
        typeof raw.deckIds?.[1] === 'string' ? raw.deckIds[1] : null,
      ];
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
      // a game resumes where it stood, from its `live` block — the log is never
      // replayed to load it. Without one this engine can take, a game being
      // played is closed by the update; a finished one stays on disk with its result
      const resumed = resumeOf(raw.live, actions.length);
      if (!resumed) {
        if (stampedOver) { leaveFile(); continue; }
        closeFile({ reason: 'update', at: now, afterMs: 0 });
        console.warn(`[rooms] ${code} closed: its stored state does not load on this engine`);
        continue;
      }
      // the actions before the resume point are sealed, so their bookkeeping is padding
      const { base: b, events } = resumed, { state } = b;
      // the only read of CLOCK_START_MS outside creation: a file older than the setting has no
      // `clockStart`, and was played at the default. `null` on disk (no clock) stays `null`.
      const clockStart = sanitizeClock(raw.clockStart);
      const clockMs: [number, number] = Array.isArray(raw.clockMs) && raw.clockMs.length === 2
        ? [Math.max(0, Number(raw.clockMs[0]) || 0), Math.max(0, Number(raw.clockMs[1]) || 0)]
        : clockStart === null ? [0, 0] : [clockStart, clockStart];
      rooms.set(code, {
        code, seed: raw.seed, mode, els, decks, deckIds, names, users, lobby,
        ...(scenario ? { scenario } : {}),
        ...(custom ? { custom } : {}),
        ...(single ? { single: true as const } : {}),
        ...(single && Array.isArray(raw.singleDraw) && raw.singleDraw.length === 2 && raw.singleDraw.every(c => typeof c === 'string')
          ? { singleDraw: raw.singleDraw as [CardName, CardName] } : {}),
        // carried across the restart, or the queue's games would stop being rated at every deploy
        ...(raw.rated === true ? { rated: true } : {}),
        // …and a league room stays one, or its result would never reach the league
        ...(league ? { league } : {}),
        // docs/22: and a CC game stays one — its rules re-dealt it just above
        ...(rules ? { rules } : {}),
        ...(match ? { match } : {}),
        rematch: [false, false], rematchRoom: null,
        // the record survives the restart; a proposal does not
        amendments: sanitizeAmendments(raw.amendments, actions.length), proposal: null, fixCooldown: [0, 0],
        // and so does a dispute
        disputes: sanitizeDisputes(raw.disputes),
        // …and so does a run of fixes not yet filed — main.ts files it at boot
        fixRun: sanitizeFixRun(raw.fixRun, raw.amendments),
        // a loss on time never reaches the state
        winner: state.winner ?? savedWinner,
        // CR D8.5: the concession stamp survives the restart with the result
        ...(concession ? { concession } : {}),
        state, actions, events,
        sockets: [null, null], watchers: new Set(), segKey: segmentKey(state), segSnapshot: b.seg.snapshot,
        heldEvents: [[...b.seg.held[0]], [...b.seg.held[1]]], heldFrames: [[...b.seg.frames[0]], [...b.seg.frames[1]]],
        bases: [b], closing: null, segStartIndex: b.seg.start, seenPending: [],
        segSeen: actions.map(() => NOTHING_SEEN), segIdFloor: actions.map(() => 0), ccMarks: actions.map(a => blankMark(a.seat)),
        segRefs: sanitizeSigs(raw.refs, actions.length), deferred: [[], []],
        // the file's own record, kept verbatim, with an empty slot for every action it has none for
        sigs: sanitizeSigs(raw.sigs, actions.length),
        // the file's card record, verbatim; null where it has none
        cardLog: sanitizeCardLog(raw.cardLog, actions.length),
        cardOpen: actions.length ? sanitizeOpen(raw.cardOpen) : null,
        forks: Array.isArray(raw.forks) ? raw.forks : [],
        versions: sanitizeVersions(raw.versions),
        clockStart,
        // Nobody is connected after a restart, so no clock runs: `clockStamp` is now, so the downtime
        // is never billed, and `clockRun` is [false, false], so the expiry sweep skips the room until
        // somebody joins. Nobody loses on time that passed with no game to play.
        clockMs, clockStamp: Date.now(), clockRun: [false, false],
        // the match clock is carried across the restart (time really spent on this game), but not the
        // downtime: `matchRun` is false and `clockStamp` is now. An older file restores at 0, unknown.
        matchMs: Math.max(0, Number(raw.matchMs) || 0),
        matchRun: false,
        startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : null,
        building: [null, null],
        // not persisted: every client re-asserts it on the join that brings it back
        fullControl: [false, false],
        // …and neither is a standing pass, which no join ever carries back
        passAll: [null, null], passAllWait: [null, null], passAllCovered: [null, null],
        autoPass: [null, null],       // …nor the auto-pass toggle or a yield
        reportHold: [false, false],   // …nor a report dialog
        watchHold: [null, null],      // …nor a playback
        // from the file (or backfilled), never "now": a restart is not a move. A room past its window
        // is restored anyway, and the idle sweep closes it after the reconnect grace.
        lastActionAt, unattendedSince: null,
      });
      // a LIVE room now continues under THIS engine: a rules change still
      // changes what the actions after it mean, so the boundary is stamped
      const restored = rooms.get(code)!;
      // a restart is not a move: the stamp is written, the date kept
      if (!gameDecided(restored) && stampVersion(restored)) persist(restored, true);
      console.log(`[rooms] restored ${code} (${raw.actions.length} actions)`);
    } catch (err) {
      console.error(`[rooms] could not restore ${code}:`, err instanceof Error ? err.message : err);
    }
  }
  if (stale) console.log(`[rooms] ${stale} finished game${stale === 1 ? '' : 's'} left on disk, not restored`);
  if (closedCount) console.log(`[rooms] ${closedCount} closed game${closedCount === 1 ? '' : 's'} left on disk, not restored`);
}
