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
import { readdirSync, readFileSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// type-only, so rooms.ts gains no runtime dependency on ws — the sockets are
// the real WebSockets main.ts plugs in; this module only checks presence
import type { WebSocket } from 'ws';
import type { Action, ActivateVia, CardName, Element, EngineEvent, EntityId, GameMode, GameState, Seat } from '../engine/src/types.ts';
import { apply, checkDeck, decisionBlocks, hiddenSegment, legalActions, sanitizeTrio, IllegalAction } from '../engine/src/apply.ts';
// R216 — the scenario tester. `dealScenario` IS `createGame` when no scenario
// id is passed, byte for byte, so every ordinary room is unaffected; when one
// is passed it applies the scenario's deterministic board mutation. It is
// imported instead of `createGame` rather than beside it, deliberately: a
// second `createGame` call site in this file would be a deal that forgets the
// scenario, which is exactly the bug docs/14 §2 is written to prevent.
// BL-06: `isDealId`, not `isScenarioId` — the sandbox is a second kind of
// deal (see scenarios.ts's SANDBOX_ID), and a saved sandbox room must restore.
import { dealScenario, isDealId } from './scenarios.ts';
import { escapesHold, legalForSeat, other } from './view.ts';
// R181: the on-disk shapes moved to types.ts so replay-room.ts can name them
// without importing this module (and `ws` with it). Re-exported here because
// this is still where they are WRITTEN, and the old import path is the one
// every reader knows.
import type { Fork, LostAction, VersionStamp } from './types.ts';
export type { Fork, LostAction, VersionStamp } from './types.ts';
import { engineVersion } from './engine-version.ts';
import { gamesDir } from './statepaths.ts';
// R290: a conceded game weighs by the turn it was conceded on — stamped here,
// read by the folds. The type and the sanitizer only; the thresholds stay in
// concession.ts, which is the one place they are named.
import { sanitizeConcession, type Concession } from './concession.ts';
import {
  resolveTrio, sanitizeMethod, sanitizeSubmission, submissionReady,
  type TrioHistoryRow, type TrioMethod, type TrioResult, type TrioSubmission,
} from './trio.ts';
// BL-43: custom rules on a live draft — the deal the engine takes, and what the creator chose
import { sanitizeDraftDeal, type DraftDeal } from '../engine/src/draftdeal.ts';
import { sanitizeCustomRules, STANDARD_RULES, type CustomRules } from '../ui/customrules.ts';

/**
 * BL-43 — a live draft's custom rules, as the room keeps them.
 *
 * RESOLVED ONCE, when the room was created (main.ts /api/new, through
 * ui/customrules.ts checkCustomRules). `rules` is what the creator chose, kept
 * for the lobby panel, the history tag and a rematch; `deal` is what it
 * resolved to, and it is the ONLY half any re-deal reads — fresh(), rebuild(),
 * the restore, the stats fold and the forensic replay all pass `deal` and none
 * of them re-resolve `rules`. A later classifier run or search-grammar change
 * therefore cannot rewrite a game already in progress or already played.
 */
export interface RoomCustom { rules: CustomRules; deal: DraftDeal }

/** how many elements this room's draft is played with: 3, or the custom deal's */
export function roomElementCount(room: { custom?: RoomCustom }): number {
  return room.custom?.deal.elements ?? 3;
}

/** A saved room's custom rules. A file that names custom rules this build
 * cannot read is REFUSED, never restored as a standard game: its log was
 * recorded against a custom deal, and replaying it onto a standard one would
 * produce a plausible room describing a game nobody played (R216's argument). */
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

/** Which hidden segment is this state in, if any?
 *
 * R154 moved the predicate itself into the engine (`hiddenSegment` in
 * apply.ts) because the engine's own decision gate now turns on it, and two
 * copies of one rule is the drift BL-19 is this repo's standing example of.
 * The doc block above stays here, where the segments are actually about the
 * server's reveal machinery; this is the same function under the name the
 * server has always called it by.
 *
 * (hasteEnding: the haste step's end-of-step triggers may suspend on a
 * decision with hasteDone already conceptually spent — the resource step is
 * definitively over, so this is never 'plan' again.) */
export function segmentKey(s: GameState): SegKey | null {
  return hiddenSegment(s);
}

/* ── R235 (owner, from R188): A REVEAL INSIDE A HIDDEN SEGMENT IS PUBLIC
 *    IMMEDIATELY — "the card says REVEAL." ─────────────────────────────────
 *
 * The hold below (`heldEvents`) used to be ALL-OR-NOTHING per segment: every
 * event an action produced inside a hidden simultaneous step was parked for
 * the other seat until the barrier. `Oracle of Foretelling` is `timing:
 * deploy`, so EVERY Oracle reveal is inside such a step, and R188 proved end
 * to end that its Glimpse 5 was silent to the opponent until deployment
 * closed. Glook, Lilbot, Visionary Construct, Maw of Despair and Seer of Empty
 * Spaces (haste) reach the same state; the {Battle} Glimpse cards never do,
 * and neither does Lifebound Seer, whose printed timing is `deploy` but whose
 * trigger is "when I attack or block" — battle, where nothing is held.
 * (Grafts move any of these effects onto any host, so the set of SITUATIONS is
 * open-ended. That is exactly why this is a rule about EVENTS, not cards.)
 *
 * So the hold gains a per-event exemption. `glimpsed` is a REVEAL: the card
 * prints the word, and R45/R41 make both the reveal and the cache public.
 *
 * ⚠ WHAT DOES **NOT** ESCAPE, AND WHY THAT IS THE WHOLE DESIGN. Only the
 * reveal itself. The framing lines around it — that a card resolved, WHICH
 * card resolved, which of the revealed cards was then cached, what was
 * recycled — stay held, because a reveal being public is not the same claim as
 * a hidden step being public, and the hidden step is a deliberate information
 * rule (docs/03), not an engine accident. The `glimpsed` message is
 * self-contained by construction — it names the glimpsing player and every
 * card revealed — so it reads perfectly well on its own; it simply does not
 * say what caused it, which is the part that is still secret.
 *
 * Widening this set is a RULES change, not a refactor. Anything added here
 * becomes public mid-step for every card that can emit it.
 */
// ⚠ The code moved to view.ts (R297) so the Learn to Play client, which runs the
// same freeze in the browser, reads the one copy. The reasoning above is still its doc.
export { escapesHold };

/** The events of `evs` that `seat` may see RIGHT NOW: the ones this room has
 * not parked for them. Derived from the queue itself rather than from a rule
 * about which events those are, so `escapesHold` is the only place the answer
 * is decided — main.ts asks this and does not need to know about reveals.
 *
 * Outside a hidden segment nothing is held and this is the identity. */
export function unheldFor(room: Room, seat: Seat, evs: EngineEvent[]): EngineEvent[] {
  const held = new Set(room.heldEvents[seatSlot(seat)]);
  return evs.filter(e => !held.has(e));
}

/* ── R150 / CT-32: ONE SEAT'S TRIGGERS MUST NOT FREEZE THE OTHER SEAT ──────
 *
 * Playtest #98 (SMVJ, action 238): *"Rashi's start of combat (doing all her
 * Wraith triggers) doesn't need to take away from what I'm doing in
 * Deployment."*
 *
 * WHAT ACTUALLY BLOCKS — and it is NOT the presentation layer.
 *
 * The engine is a single pure reducer over ONE state, and `apply()` opens with
 * a global gate:
 *
 *     if (e.s.decision && action.type !== 'decide' && action.type !== 'concede')
 *       e.illegal(`a decision is pending for ${...}`);
 *
 * and `legalActions()` opens with the matching one — `if (s.decision) return
 * legalDecisionActions(...)`, which returns [] for the seat that does not own
 * it. So while the OPPONENT is mid-answer, this seat is handed an EMPTY legal
 * list and every action it sends is refused by name. The client's "Waiting for
 * X…" bar (ui/main.ts) is a faithful drawing of that — un-gating the UI alone
 * would just turn a frozen screen into a screen full of refusals.
 *
 * That gate is right in BATTLE, where priority is sequential and an opponent
 * mid-resolution genuinely does hold the game. It is wrong in a HIDDEN
 * SIMULTANEOUS SEGMENT, where by construction both seats are acting at once
 * and neither can see the other — R144 put deployment triggers on the stack,
 * so from that ruling onward a pile of start-of-deployment Wraith triggers
 * sits there suspended on its controller's decision while the other player is
 * simply trying to deploy.
 *
 * THE FIX, IN TWO HALVES, BOTH HERE (the engine stays untouched and pure):
 *
 *   legalForSeat   what the server PUBLISHES to a seat. Inside a segment, a
 *                  decision belonging to the other seat is answered against a
 *                  shadow state with `decision` cleared, so this seat's own
 *                  deployment options are offered as normal.
 *   arrivalVerdict what the server DOES with an action that arrives while such
 *                  a decision is open: it is DEFERRED, not refused, and
 *                  applied the moment the decision closes. Serialising two
 *                  concurrent seats by arrival order is what the room already
 *                  does with every other simultaneous action; this only widens
 *                  it across a decision boundary.
 *
 * Nothing about redaction changes. `viewFor` still nulls a decision that is
 * not yours, still serves the opponent's half of a segment from the freeze,
 * and `E.beginResolving` still publishes `s.resolving` in the battle phase
 * only — a segment must not leak that you are mid-something.
 */

/** How many actions one seat may have parked behind an opponent's decision.
 * A human deploying while a trigger pile resolves sends a handful; anything
 * past this is a client fault or a firehose, and is refused rather than
 * queued. */
export const MAX_DEFERRED = 8;

/**
 * The legal actions the server publishes to `seat`.
 *
 * ⚠ R154 SHRANK THIS, and the sliver that is left is the interesting part.
 *
 * R150 wrote this as a shadow state with `decision`/`suspension` nulled,
 * because `legalActions` opened with a global `if (s.decision) return
 * legalDecisionActions(...)` and there was no other way past it. That made the
 * server the second place the "who may act while a question is open" rule was
 * written, and the FIRST place — the engine — went on freezing hotseat and
 * the whole test suite (CARD-TODO #44). R154 moved the rule into the engine,
 * so for almost everything this is now `legalActions`, once, with no shadow.
 *
 * THE EXCEPTION, and why deleting this function outright was wrong: the
 * snapshot-carrying mid-resolution suspension (apply.ts `decisionBlocks`,
 * case 3). There the engine must keep REFUSING the other seat — answering
 * rewinds the whole GameState past anything they did — but the server can
 * still OFFER them their options and park what arrives, because parking is
 * not applying. The two layers disagree ON PURPOSE:
 *
 *      engine   "not yet"          (and it means it — R85 would erase you)
 *      server   "go ahead, I'll hold it"   (arrivalVerdict → 'defer')
 *
 * `legalActions` must NOT be widened to match, whatever the symmetry argues:
 * its contract is "every action returned is legal", the fuzzer checks it, and
 * an engine that offers what it refuses is the exact half-fix R150's notes
 * warn about. An offer the SERVER makes good on with a queue is a different
 * thing from an offer the engine breaks.
 *
 * The `segKey` argument is now ignored — the engine derives the segment from
 * the state, which beats trusting the room's cached copy — and is kept only so
 * this stays a drop-in for every existing call site.
 */
// (moved to view.ts beside escapesHold — R297: the browser's solo game offers the same list)
export { legalForSeat };

/**
 * CT-160 — what the server OFFERS a seat, asked of the ROOM rather than of the
 * state.
 *
 * `legalForSeat` above takes a GameState and cannot see a freeze, which is not
 * an oversight: a frozen room's STATE is perfectly legal to act on, and that is
 * the whole trouble — the board is fine, the log that produced it is not. So
 * the freeze is a property of the room, and every site that publishes a legal
 * list to a client (or drives the scripted opponent off one) asks here.
 *
 * Offering nothing is not the enforcement — `applyToRoom` is, and a client
 * that ignores this list is still refused by name. This is so the board goes
 * quiet at once rather than inviting a click the server will bounce.
 */
export function legalInRoom(room: Room, seat: Seat): Action[] {
  if (room.frozen) return [];
  // BL-27: and a game decided by something the board cannot show — a loss on
  // time, or a stamped result the replay never reached. The state still offers
  // a full hand of moves; the game is over anyway.
  if (decidedOutsideState(room)) return [];
  return legalForSeat(room.state, seat, room.segKey);
}

/** What to do with an arriving action. */
export type ArrivalVerdict =
  /** apply it now, the way the server always has */
  | 'apply'
  /** park it: an opponent's decision is open inside a simultaneous segment,
   * and it lands as soon as that decision closes */
  | 'defer'
  /** hand it to the engine and let it refuse by name (or accept it) — the
   * pre-R150 path, kept for every case deferral must not cover */
  | 'refuse';

/**
 * Should this action be applied, parked, or left to the engine's refusal?
 *
 * The negative cases are the load-bearing ones:
 *  - a `decide`/`concede` is never parked: `decide` is the very thing that
 *    closes the decision, and a concede must always be reachable (R65).
 *  - a decision belonging to the ACTING seat is never parked. It is their own
 *    question, they must answer it, and the engine's refusal is the right
 *    answer — this is the negative control the tests assert.
 *  - outside a hidden segment there is no concurrency to protect: battle is
 *    sequential and the block is correct.
 *
 * R154 NARROWED IT. Before, every action arriving while the opponent held a
 * question was parked, because the engine refused all of them — which meant a
 * player deploying against a twelve-trigger pile watched their own clicks
 * queue up and land in a burst thirty seconds later. That is still #98's
 * complaint, one layer along. Now the engine takes the action outright
 * wherever it can prove the question is undisturbed, so the room only parks
 * what the engine will still refuse: `decisionBlocks` is the same predicate on
 * both sides of the wire, asked once.
 *
 * What is left to park is exactly the snapshot-carrying mid-resolution
 * suspension (apply.ts `decisionBlocks`, case 3): answering it rewinds the
 * whole GameState to the part boundary, so anything the other seat landed in
 * the meantime would be erased. THAT is why this queue is not redundant.
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
 * R154's second door onto the same queue: the engine ACCEPTED the action into
 * a draft, discovered on the way out that it had disturbed the other seat's
 * open question, and threw the draft away whole (`IllegalAction.disturbs`).
 *
 * Whether an action suspends cannot be known before it runs — it depends on
 * the card, its targets and the board — so `arrivalVerdict` cannot predict
 * this case and must not try. Park it here instead, where it is now a fact
 * rather than a forecast: the player gets the same "lands when they answer"
 * they would have got from a prediction, and R150's promise that nothing goes
 * back on the wire as a refusal survives R154's narrowing.
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

/**
 * The parked actions that are now free to run, oldest first, cleared off the
 * room. Empty while any decision is still open — a queue drained halfway
 * would just hit the same gate.
 *
 * Both seats' queues drain together, each seat in its own arrival order. The
 * interleaving BETWEEN seats is arbitrary, which is exactly what it already
 * is for two people deploying at the same time.
 */
export function takeDeferred(room: Room): Action[] {
  if (room.state.decision) return [];
  const out = [...room.deferred[0]!, ...room.deferred[1]!];
  room.deferred = [[], []];
  return out;
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
/**
 * The entity id an activation's `via` names, or null when it names none.
 *
 * R181, and this was a live bug rather than a tidy-up. `ActivateVia` has THREE
 * shapes — the string `'augment'`, `{ mod }` (activate through a mod on the
 * unit), and `{ face }` (activate through a granted face's text, R63). The
 * three sites below were written when `{ mod }` was the only OBJECT shape, so
 * they tested `typeof via === 'object'` and read `.mod` — which on a `{ face }`
 * activation is `undefined`. `entityRefs` then reported `undefined` as a
 * referenced id, and `renumberAction` wrote `{ mod: NaN }` back OVER the face,
 * erasing which ability the action was even for. An undo segment containing a
 * face-granted activation could not survive its own renumbering.
 */
/**
 * Which slot of a two-seat pair a seat is.
 *
 * The engine declares `type Seat = number` (with `// 0 | 1 in 1v1` next to it),
 * so `heldEvents[other(seat)]` on a `[T, T]` reads as `T | undefined` — that is
 * where R181's two "Object is possibly 'undefined'" errors came from, and they
 * are strictness noise, not defects: every seat reaching those lines came from
 * `pickSeat` (which returns 0 or 1 and nothing else) or from an action the
 * engine already accepted. Written as a narrowing rather than a `!` so that if
 * the game ever grows a third seat this is a visibly wrong line instead of an
 * assertion that was silently false.
 */
const seatSlot = (seat: Seat): 0 | 1 => seat === 0 ? 0 : 1;

const viaMod = (via: ActivateVia | undefined): EntityId | null =>
  typeof via === 'object' && via !== null && 'mod' in via ? via.mod : null;

/** how a `via` reads in a reference key: the mod's symbol when it names one,
 * otherwise the face (and which of its texts) the ability was reached through
 * — `String({face})` would flatten every face to "[object Object]" and make
 * two different faces compare equal. */
const viaKey = (via: ActivateVia | undefined, sym: (id: EntityId) => string): string =>
  typeof via !== 'object' || via === null ? String(via ?? '-')
    : 'mod' in via ? `mod:${sym(via.mod)}`
      : `face:${via.face}:${via.text ?? '-'}`;

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

/* `LostAction` and `Fork` — the two shapes this file WRITES into the saved
 * game — are declared in `./types.ts` and re-exported from the import block at
 * the top. They live there so `replay-room.ts`, which reads them back off
 * disk, can name the same interface instead of restating it structurally; see
 * that file's header for the `ws` problem that forced the restatement. */

/** Two skip sets describe the same fork iff they lost the same indices IN THE
 *  SAME WAY. R191 added the second half: a restore can now report an action
 *  index as 'changed' (it still replays, it just means something else) where a
 *  previous one reported it as 'lost', and those are different facts about the
 *  same game — collapsing them would leave the file claiming the first. */
const sameLoss = (a: LostAction[], b: LostAction[]): boolean =>
  a.length === b.length && a.every((x, i) => x.i === b[i]!.i && x.kind === b[i]!.kind);

export interface Room {
  code: string;
  seed: number;
  mode: GameMode;
  /** draft mode: the chosen trio (sanitized); ignored in 'shared' */
  els: Element[];
  /** constructed mode: each seat's deck list (null = not brought yet). The
   * game does not really start until both are in — see roomWaiting(). */
  decks: [CardName[] | null, CardName[] | null];
  /**
   * Constructed: the COLLECTION deck id (server/collection.ts) each seat's
   * deck came from, when the seat was logged in and brought one from their
   * saved decks. Persisted beside `decks` and carried into the game record,
   * which is the whole reason it exists: it is what lets a deck's win/loss
   * record be folded out of the history rather than kept as a counter that
   * can drift. Null everywhere else — a logged-out seat, a pasted list, a
   * game played before decks had ids.
   */
  deckIds: [string | null, string | null];
  /**
   * BL-02 — THE MATCHMAKER MADE THIS ROOM, so the game moves both players'
   * ratings. Persisted, because "was this rated" is a fact about the game and
   * must survive a restart and a re-import (history.ts reads it back off the
   * file).
   *
   * ⚠ It is set at CREATION and never afterwards. A rated game is one two
   * strangers were put into by the queue; a room made from a code is not one
   * and cannot become one, which is what stops two friends trading wins up
   * the public ladder. See rating.ts (1).
   */
  rated?: boolean;
  /**
   * R216 — the scenario this room was dealt with, if any. PERSISTED, beside
   * `seed`, because it is part of the deal.
   *
   * A room's state is a function of `(seed, mode, els, decks, scenario,
   * actions)`. Recording the id (and not a `GameState`) is the whole design:
   * `rebuild()`, `restoreRooms()`, `undoActionAt()`, `replay-room.ts` and the
   * R200 divergence diff all keep working on a scenario room, because it is
   * still a seed and a log. See scenarios.ts's header for the four deal sites
   * this had to reach and the one it deliberately does not.
   *
   * Additive: a file without it restores exactly as it always did.
   */
  scenario?: string;
  /** BL-43: a live draft's custom rules and the deal they resolved to. Absent on
   * every standard room, every non-draft room and every file from before BL-43.
   * Part of the DEAL like `scenario`: every fresh()/rebuild() in this file
   * passes `custom?.deal` (test-custom-rules.ts scans for it). */
  custom?: RoomCustom;
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
  /**
   * R290 — IF a concede decided this game: who, and on which game turn.
   * Stamped by applyToRoom the moment the concede lands (the turn is
   * `state.turn` as the action was applied), persisted with the room, and
   * carried onto the RecordedGame by history.ts. It is what makes a turn-1
   * concede a walkover and a turn-2 one a half-weight game — see
   * concession.ts for the tiers. Absent on every other game, and on every
   * file written before 2026-09-05; absent folds as `normal`.
   */
  concession?: Concession;
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
   * CT-160 — WHY THIS GAME HAS BEEN STOPPED, in the words both players read.
   * `null` for every ordinary room. DERIVED, never persisted.
   *
   * A restore that cannot replay part of the log rebuilds the board WITHOUT
   * the actions it refused (rebuild() is deliberately tolerant, and one skip
   * cascades — a measured 28 of 60 on the fixture in test-forensics.ts, which
   * rolled that game from turn 4 back to turn 2). CT-66 made that visible with
   * `forks`; visibility was treated as the fix and it is not one. Play then
   * CONTINUED from the rebuilt board, appending to a log that is two different
   * games end to end, and it is the continuing — not the rebuild — that
   * destroys the file as evidence. A frozen game is still evidence; a rebuilt
   * one is not.
   *
   * So a LIVE room whose rebuild refused anything is frozen here instead, and
   * `applyToRoom` refuses every action from every source (see there — it is
   * the one choke point, which is why the freeze is checked there and not at
   * the six call sites).
   *
   * ⚠ ONLY LIVE ROOMS. A finished game restores exactly as it always did: its
   * skips are read-only forensics, nobody is going to play into it, and the
   * saved corpus has to stay readable. Same condition as recordFork().
   *
   * ⚠ ONLY REFUSALS, not R191 drift. A drifted log still replays straight
   * through — every action applies, the board is a board that log really does
   * produce — so it is one game, recorded honestly, on rules that moved.
   * `forks` says so and the players are told. A refusal is different in kind:
   * the log stops describing the board at that index, and everything appended
   * after it is fiction.
   *
   * NOT PERSISTED, on purpose. The freeze is a statement about THIS engine's
   * reading of the log, and it is recomputed by every restore for free. A
   * deploy that rolls the engine back to one the log replays on lifts it — the
   * log was never edited, so it is a true record again, and a persisted flag
   * would strand the room for good on the strength of a build that is gone.
   */
  frozen: string | null;
  /**
   * R200 — which engine recorded which stretch of this log. Persisted.
   *
   * One entry per engine this game has been played under, in order, each
   * naming the action index it took over at. `versions[0]` is stamped at
   * creation; a restore under a different commit appends another, because
   * from that moment on play continues under different rules.
   *
   * This is what makes `replay-room.ts --as-recorded` possible, and it is the
   * whole answer to the divergence problem: without a reference engine to diff
   * against, a replay months later can report THAT a file diverges but not
   * WHAT changed — and its "divergence point" is only ever the first REFUSAL,
   * which is an upper bound, late by up to six actions in every case anyone
   * has measured.
   *
   * Additive: a file written before R200 has no `versions` and restores
   * exactly as it always did. It simply cannot be replayed --as-recorded,
   * which is a true statement about it rather than a failure.
   */
  versions: VersionStamp[];
  /**
   * Actions the most recent rebuild could not apply. DERIVED (never
   * persisted): it is `forks` restated for the CURRENT engine, and it is what
   * undoActionAt() measures against to guarantee an undo never loses a play.
   */
  lost: LostAction[];
  /**
   * R191 — actions the most recent RESTORE replayed happily while they came to
   * mean something else. DERIVED (never persisted), always `kind: 'changed'`,
   * and deliberately NOT part of `lost`.
   *
   * `lost` is the refusals, and it is undoActionAt()'s baseline for "an undo
   * must never cost anybody a move"; padding it with actions that still apply
   * would raise that baseline and silence a real loss. So drift travels beside
   * it, and the two meet again in `recordFork`, which writes both into the
   * file under the `kind` that says which is which.
   *
   * WHY IT EXISTS. A restore that refuses nothing used to leave no trace at
   * all — an engine that ACCEPTS every logged action while producing a
   * different board is invisible to a skip list, and it is the worse of the
   * two cases, because the log goes on reading as a faithful record. It is
   * measured the way undoActionAt() measures its own splice: every action's
   * REFERENCE KEY (see referenceKey) is compared against the key the same
   * action had when it was played, which persist() writes into the file. A key
   * that moved is an action whose author would not recognise it any more.
   *
   * ⚠ Only ever computed when the rebuild refused NOTHING. Once one action is
   * refused, every key after it is measured against a board the log stopped
   * describing, and calling that "drift" would bury the refusal in noise.
   */
  drifted: LostAction[];
  /** full authoritative event history, for per-seat redacted log resync */
  events: EngineEvent[];
  /** connected client per seat (null = nobody there) */
  sockets: [WebSocket | null, WebSocket | null];
  /**
   * BL-29 — WHO IS WATCHING, and nothing else about them.
   *
   * The owner, 2026-09-01, answering the entry's one blocking question (does a
   * spectator see the game seat-by-seat with each side's hidden information
   * still hidden, or an omniscient broadcast?): *"Just omniscient and live is
   * fine for now."*
   *
   * A watcher is NOT a seat and can never become one: `pickSeat` never sees
   * this set, `conns` never gets an entry for one, and the action path reads
   * `conns` — so a watching socket has no seat to act as and every message it
   * sends about the game is dropped by construction rather than by a check
   * somebody has to remember to write.
   *
   * IN MEMORY ONLY. A watcher is not part of the game, so it is not part of
   * the record: nothing here is persisted, and a restart simply loses the
   * audience, which is what happens when a screen goes off.
   *
   * ⚠ THE SEATS ARE TOLD THE COUNT. BL-29's own doneWhen asks that "whether
   * the players can see that they are being watched is decided deliberately,
   * and the entry records which way", and an OMNISCIENT live view forces the
   * answer: a spectator who can see both hands and talk to a player is a
   * cheating vector, and the one thing that makes that manageable at a
   * friendly table is that both players can see somebody is there.
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
  /** index into `actions` where the open segment began (-1 outside one) —
   * undo may splice a seat's own actions at/after this point */
  segStartIndex: number;
  /**
   * R150/CT-32: actions parked behind the OTHER seat's open decision inside a
   * hidden simultaneous segment, per seat, in arrival order.
   *
   * DERIVED and never persisted — an action only reaches `actions` once it has
   * actually been applied, so a saved log is still exactly the game that was
   * played and `replay-room.ts` still replays it straight through. A queue
   * that outlives its segment is drained or refused before then; a server
   * restart simply drops it, which is the same as the client's action never
   * arriving.
   */
  deferred: [Action[], Action[]];
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
  /**
   * BL-26 — THIS ROOM'S CLOCK SETTING. Persisted, chosen at creation, never
   * changed afterwards. `null` means **no clock at all**.
   *
   * `CLOCK_START_MS` used to be the rule: a module constant every room got,
   * nobody could change, and nothing could switch off. It is now only the
   * DEFAULT, and this is the value every other site asks — `clockRunning`
   * (a room with no clock runs none), `clockSnapshot` (a room with no clock
   * sends none, so the client draws none rather than a frozen 60:00) and
   * BL-27's expiry (nothing expires in a room with no clock).
   *
   * Kept BESIDE `clockMs` rather than derived from it, because `clockMs` is
   * what is LEFT and this is what there was: twenty minutes in, the two have
   * nothing to do with each other, and a joiner still has to be able to see
   * which game they walked into.
   *
   * Additive: a file written before the setting existed has no `clockStart`
   * and restores at `CLOCK_START_MS`, which is the bank it really was played
   * with. See restoreRooms.
   */
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
   * BL-37 — HOW LONG THE MATCH ACTUALLY TOOK. One clock for the table.
   *
   * The owner, 2026-09-01: *"a global wall-clock match timer — literal elapsed
   * time, not double-counting per-player time — saved with the game to track
   * average game length and tune the clocks."*
   *
   * ⚠ IT CANNOT BE DERIVED FROM `clockMs`, which is why it is a field. Two
   * banks of 45 minutes are ninety minutes of clock and one game; adding the
   * consumed halves together answers "how much thinking happened", not "how
   * long were we sitting here". And a room with the clock OFF has no banks at
   * all, which is exactly the room whose length you most want to know when you
   * are choosing what the banks should be.
   *
   * Billed by `settleClock`, off the same stamp and the same interval as the
   * two banks, so the three numbers are always measured over the same instants.
   * It runs while `matchRunning` is true — the game is dealt, not frozen, not
   * decided, and BOTH SEATS ARE CONNECTED. That last clause is the one worth
   * arguing about, and the argument is the same one `clockRunning` already
   * won: an overnight gap with a closed tab is not match length, and counting
   * it would make the average useless for the thing it is for. `startedAt`
   * beside it keeps the raw wall interval recoverable either way.
   *
   * Additive: a file written before this existed restores at 0, which reads as
   * "unknown" and is why the post-game screen omits the line rather than
   * printing 0:00.
   */
  matchMs: number;
  /** BL-37: was the match clock running since `clockStamp` (cached, exactly
   * like `clockRun`, so the bill uses the state at the START of the interval) */
  matchRun: boolean;
  /** BL-37: epoch ms of the first settle that found this match live — the raw
   * wall interval, kept so `matchMs`'s "both connected" rule can be judged
   * rather than trusted. Null until the game starts. */
  startedAt: number | null;
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
   * BL-18 — WHICH SEATS HAVE ASKED THAT NOTHING ACT FOR THEM.
   *
   * Full control is a per-PLAYER preference that lives in the browser
   * (`algoFullControl` in localStorage), and the server has to know it for one
   * reason only: `drainForced` is the fourth of the four things that act for
   * you, and it runs here. The client half — auto-pass, the standing Pass-all,
   * the auto-yield map, and the hotseat's own copy of this same drain — is
   * decided in ui/main.ts and never reaches the wire.
   *
   * ⚠ NOT SHAPED LIKE `clockStart`, and the difference is the point. BL-26's
   * bank is a property of the ROOM: chosen once by whoever created it, binding
   * on both seats, persisted, and deliberately ignored on a later join so the
   * second player cannot re-specify it. This is the opposite on every count —
   * it is one seat's own preference, it may be turned on and off mid-game, and
   * it binds nobody but them. So it is shaped like `building`: per-seat, soft,
   * relayed rather than negotiated.
   *
   * NOT PERSISTED, for the same reason `frozen` is not: the browser is the
   * source of truth and re-asserts it on every join (ui/main.ts sendJoin), so
   * a restart, a reconnect or a seat takeover re-establishes it for free. A
   * persisted copy could only ever disagree with the localStorage that is
   * actually driving the other half of the same feature.
   */
  fullControl: [boolean, boolean];
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

/** The DEFAULT chess-clock bank per player — BL-26 made it the default rather
 * than the rule. 40 minutes ran out mid-game in the playtests — a draft game
 * with real decisions wants an hour (Bena, 2026-08-20). Persisted games keep
 * whatever bank they were saved with, and a room may be created with another
 * bank or with none: see `Room.clockStart` and `sanitizeClock`.
 *
 * ⚠ Nothing outside room CREATION may read this. A site that wants "this
 * room's bank" wants `room.clockStart`, which is the whole point of BL-26 —
 * the two are equal only for a room nobody configured. The one apparent
 * exception is `restoreRooms`, and it is not one: a file saved before the
 * setting existed carries no bank, and 60:00 is the bank it was played with. */
export const CLOCK_START_MS = 60 * 60 * 1000;

/**
 * BL-01 — THE BANK A MATCHMADE ROOM GETS, per format.
 *
 * ⚠ A MATCHMADE GAME MUST NOT USE EITHER PLAYER'S PICKER. `chosenClockMs()`
 * in ui/main.ts reads *that browser's* `algoClockMs`, which is right for a
 * room you make and hand to a friend and wrong for a rated game against a
 * stranger: whoever's setting won would be choosing for somebody who never
 * saw it, and one player's "Off" would hand the other an untimed rated game —
 * which quietly disables BL-27, the anti-BM rule that is the only thing making
 * a stalled rated game end in a result.
 *
 * So the queue asks nobody. The numbers are the owner's own defaults
 * (2026-09-01: *"45m and 60m. Constructed games are shorter, so I'd say the
 * default for constructed is 45m and the default for live draft is 60m."*).
 *
 * ⚠ THE UI HAS ITS OWN COPY, `CLOCK_DEFAULT_BY_MODE` in ui/main.ts, and it
 * cannot import this one (the browser bundle does not reach into server/).
 * `279-queue-and-rating.test.ts` reads both files and fails if they disagree —
 * the same lock `ledgers/backlog.test.ts` already puts on CLOCK_START_MS.
 */
export const MATCH_CLOCK_MS: Record<'constructed' | 'draft', number> = {
  constructed: 45 * 60 * 1000,
  draft: 60 * 60 * 1000,
};

/**
 * BL-26 — bounds on a per-room bank, in ms.
 *
 * The server's job here is to reject nonsense (a negative, a NaN, a year),
 * NOT to decide which banks are worth offering: two people who can both see
 * the setting before the first action may play whatever length they agree on,
 * and the list of PRESETS a player picks from is a UI question (and an open
 * one — see docs/questions-round36.md).
 *
 * The floor is deliberately low. A one-second bank is a silly game and a
 * perfectly legitimate test, and BL-27's expiry is only testable at speed
 * because of it — a floor set at "one minute, because who would want less"
 * would have made the anti-BM rule's own guard take a minute per assertion.
 */
export const MIN_CLOCK_MS = 1000;
export const MAX_CLOCK_MS = 6 * 60 * 60 * 1000;

/**
 * BL-26 — a bank requested off the wire, turned into the setting a room is
 * created with. `null` is **no clock at all**, and it is a real setting rather
 * than a very large number: a room with no clock must not run one invisibly.
 *
 *   undefined            → the default (an old client, or a caller that does
 *                          not care, gets exactly today's behaviour)
 *   null / 0 / 'off'     → off
 *   a number of ms       → clamped into [MIN_CLOCK_MS, MAX_CLOCK_MS]
 *   anything else        → the default, never a throw: this reads a value off
 *                          a socket, and a junk `clock` field must not be able
 *                          to stop a room being created (same discipline as
 *                          sanitizeTrio / sanitizeMethod).
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
  // CT-160: a stopped game is waiting on nobody. Its state still offers plenty
  // of legal actions — that is exactly why the freeze has to be asked about
  // here too, or both banks drain for as long as the two of them sit staring
  // at a board that will not accept a move.
  if (room.frozen) return false;
  if (room.state.winner !== null || room.state.phase === 'gameover') return false;
  // BL-27: …and a game decided WITHOUT the state saying so — a loss on time,
  // or a stamped result whose replay stopped short. Without this arm the very
  // next settle after an expiry would look at a board still full of legal
  // moves and start both banks running again on a game that is over.
  if (decidedOutsideState(room)) return false;
  if (!room.sockets[0] || !room.sockets[1]) return false;
  return true;
}

export function clockRunning(room: Room): [boolean, boolean] {
  // BL-26: a room with no clock does not run one. FIRST, above every other
  // arm, because "off" has to be a property of the room rather than something
  // the other conditions happen to add up to.
  if (room.clockStart === null) return [false, false];
  // BL-37: every other arm this function used to spell out is now
  // `matchRunning`, unchanged and in the same order — the match clock and the
  // two banks stop for exactly the same reasons, and the ONLY thing that is
  // true of the banks and not of the match is BL-26's "this room has no
  // clock". Splitting it rather than copying it is the whole point: a room
  // with the clock off is precisely the room whose length you want to know.
  if (!matchRunning(room)) return [false, false];
  return [0, 1].map(s => legalActions(room.state, s as 0 | 1).length > 0) as [boolean, boolean];
}

/** Bill the time elapsed since the last settle to whichever seats were
 * running, clamp at zero, and recompute the running set from the current
 * state + connections. Call after anything that changes either (action
 * applied, undo, join, leave).
 *
 * BL-27: the clamp is no longer "display only". Reaching zero loses the game —
 * see `expiredSeat` / `expireOnTime`, which are the only readers of it. */
export function settleClock(room: Room): void {
  const now = Date.now();
  const dt = Math.max(0, now - room.clockStamp);
  for (const s of [0, 1] as const) {
    if (room.clockRun[s]) room.clockMs[s] = Math.max(0, room.clockMs[s] - dt);
  }
  // BL-37: the table's own clock, billed off the same stamp and the same
  // interval so the three numbers always measure the same instants. It counts
  // UP and has no floor: it is a record, not a resource.
  if (room.matchRun) room.matchMs += dt;
  room.clockStamp = now;
  room.clockRun = clockRunning(room);
  room.matchRun = matchRunning(room);
  // the first instant this match was live, kept raw so the "both connected"
  // rule above can be judged against the wall rather than trusted
  if (room.matchRun && room.startedAt === null) room.startedAt = now;
}

/** What a client is told about this room's clocks. `start` is BL-26's setting
 * itself, carried so a seat joining twenty minutes in can still see what bank
 * the game was created with. */
export interface ClockSnapshot {
  ms: [number, number];
  running: [boolean, boolean];
  at: number;
  /** the bank this room was created with (BL-26) */
  start: number;
}

/**
 * The clock snapshot attached to every state broadcast: clients extrapolate
 * locally from `at` using `running` until the next message arrives.
 *
 * BL-26: `null` for a room with the clock OFF, and the caller omits the field
 * entirely — a client must show NO clocks rather than a frozen 60:00, and the
 * honest way to say "there is no clock" is to send nothing rather than a pair
 * of numbers that never move.
 */
export function clockSnapshot(room: Room): ClockSnapshot | null {
  if (room.clockStart === null) return null;
  settleClock(room);
  return {
    ms: [...room.clockMs], running: [...room.clockRun], at: room.clockStamp,
    start: room.clockStart,
  };
}

/* ── BL-27: RUNNING OUT OF TIME LOSES THE GAME ────────────────────────────
 *
 * The owner's reason is not pacing, it is BM. Today a player who is losing can
 * simply stop acting: the game never ends, and it lands in history as
 * `finished: false` with no winner — indistinguishable from an honest "we both
 * had to go". A launch blocker, in his words: "we'll make the timer actally
 * cause a game loss before launching to prevent BMing."
 *
 * The decision lives HERE, as two pure-ish functions, and the *noticing* lives
 * in main.ts's sweep. That split is the whole design: expiry is the one game
 * event with no action behind it, so there is nothing to hang it off, and a
 * rule buried inside a timer callback can only ever be tested by waiting.
 */

/**
 * Which seat (if any) has run out of time RIGHT NOW. Settles the clock first,
 * so it is answered against billed time rather than the last snapshot.
 *
 * Every negative arm is a requirement of the entry, not defensive padding:
 *
 *   clockStart === null   BL-26. Nothing expires in a room with no clock.
 *   frozen                CT-160. A stopped game is waiting on nobody, and
 *                         handing one of them a loss for not moving — in a
 *                         room that refuses every move — would be absurd.
 *   already decided       a concede, a real win, or an expiry that already
 *                         fired. Idempotent: the sweep runs every second.
 *   roomWaiting           there is no game yet.
 *   clockRun[s]           A MERELY DISCONNECTED SEAT DOES NOT BLEED TIME.
 *                         `clockRunning` already returns [false,false] unless
 *                         both sockets are present, so this arm inherits that
 *                         rather than restating it — one rule, asked once.
 */
export function expiredSeat(room: Room): Seat | null {
  if (room.clockStart === null) return null;
  if (room.frozen) return null;
  if (decidedWinner(room) !== null) return null;
  if (roomWaiting(room)) return null;
  // THE CHEAP GATE, and the reason a once-a-second sweep over every room in
  // the process costs nothing measurable. `clockRun` is the CACHED running
  // set, maintained by settleClock at every event that could change it (an
  // action, an undo, a join, a leave), so "could anybody's bank have reached
  // zero since the last settle" is two subtractions. Only when the answer is
  // yes do we settle — and settling means `clockRunning`, which means
  // `legalActions` twice, which is the one thing worth not doing 86,400 times
  // a day per room.
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
 * A seat has run out of time: end the game, stamp the result, tell the log.
 * Returns the LOSING seat, or null if nothing expired.
 *
 * THE RESULT IS STAMPED, NOT LOGGED — and that is deliberate, not a shortcut.
 * A concede is a real `Action` because a player took it; running out of time
 * is not something anybody did, and it cannot be replayed, because the clock
 * is wall time and is not part of the game state. Appending a pseudo-action
 * would make every saved log stop reproducing its own game. `Room.winner`
 * exists for exactly this shape — read its comment: "a fact stamped when it
 * happened cannot rot" — and `summarizeGame` already prefers the stamp over
 * the replay, so the history sync and the future rating fold (BL-02) see an
 * ordinary decided game with `finished: true` and a named winner.
 *
 * The note it appends is RETURNED as well as pushed, because the caller has to
 * put it on the wire: a view refresh with an empty event list leaves both
 * players looking at a stopped board and an unchanged log, which is the silent
 * ending this whole entry exists to abolish. (It did exactly that in the first
 * draft, and the guard below caught it.)
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

/** Build a fresh game and its initial event list.
 *
 * R216: `scenario` rides along, and every caller in this file passes the
 * room's own. It is the LAST argument on purpose — a caller that forgets it
 * deals an ordinary game, which is the safe direction, and the two tests that
 * matter (185/186 + test-scenario.ts) fail loudly if a room path forgets. */
function fresh(seed: number, names: [string, string], mode: GameMode, els: Element[], decks?: [CardName[], CardName[]], scenario?: string, deal?: DraftDeal): { state: GameState; events: EngineEvent[] } {
  // BL-43: `deal` is the room's custom deal. Unlike a scenario, forgetting it
  // is NOT the safe direction — a custom room would be re-dealt as a standard
  // game under its own log — so test-custom-rules.ts checks every call site.
  const r = dealScenario(seed, names, mode, els, decks, scenario, deal);
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

/**
 * BL-27 — decided by something the STATE does not know about.
 *
 * Two ways in, and they want the same treatment: a result STAMPED when it
 * happened whose replay no longer reaches it (the case `Room.winner` was
 * added for), and a loss on time, which never was a board position at all —
 * the engine has no idea and never will, because the clock is not part of the
 * game state and must not become part of it (a replay would then depend on
 * wall time, and every saved log would stop reproducing).
 *
 * Both mean: this game is over, and the board in front of you is not going to
 * say so. So `legalInRoom` offers nothing and `applyToRoom` refuses — without
 * which a seat that ran out of time could go on playing a game it had already
 * lost, on a board that still looked perfectly legal.
 */
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

/**
 * BL-18 — one seat's "nothing may act for me", as the server holds it.
 *
 * A setter rather than a bare assignment because the DECISION of what the flag
 * means belongs beside the field: it is soft state, it is never persisted, and
 * it is not a game action — so nothing here logs, stamps or saves. Returns
 * whether it actually changed, so a caller can decline to repaint for a
 * message that said what it already knew.
 */
export function setFullControl(room: Room, seat: Seat, on: boolean): boolean {
  if (room.fullControl[seat] === on) return false;
  room.fullControl[seat] = on;
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
    count: roomElementCount(room),
  });
  lobby.result = result;
  room.els = sanitizeTrio(result.els, roomElementCount(room));
  const { state, events } = fresh(room.seed, room.names, room.mode, room.els, undefined, room.scenario, room.custom?.deal);
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
export function setRoomDeck(room: Room, seat: 0 | 1, cards: CardName[], deckId: string | null = null): boolean {
  if (!roomWaiting(room)) return false;
  room.decks[seat] = [...cards];
  room.deckIds[seat] = deckId;
  const complete = !!room.decks[0] && !!room.decks[1];
  if (complete) {
    const { state, events } = fresh(room.seed, room.names, room.mode, room.els, decksFor(room), room.scenario, room.custom?.deal);
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
function rebuild(seed: number, names: [string, string], actions: Action[], mode: GameMode, els: Element[], decks?: [CardName[], CardName[]], scenario?: string, deal?: DraftDeal): Rebuilt {
  let { state, events } = fresh(seed, names, mode, els, decks, scenario, deal);
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
    // R235: a reveal is public immediately and is never parked (escapesHold)
    if (holding) heldEvents[seatSlot(other(a.seat))].push(...r.events.filter(e => !escapesHold(e)));
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

/**
 * R191 — WHAT THIS REBUILD QUIETLY CHANGED (see `Room.drifted`).
 *
 * `saved` is the per-action reference keys the file recorded as the game was
 * played; `refs` is what the same actions mean under the engine that has just
 * replayed them. Every index where the two disagree is an action that still
 * applies and no longer refers to what its author was looking at — another
 * unit, another card at that hand index, another roll of the dice.
 *
 * Returns [] and says nothing when there is no honest comparison to make:
 *
 *  · the file predates the field (`saved` absent) — silence, never a fork.
 *    An old file is not evidence of drift; it is evidence of nothing.
 *  · the lengths disagree — the file is not describing this action list at
 *    all (a still-waiting room whose strays were dropped, a hand edit), and a
 *    per-index comparison would be meaningless rather than wrong.
 *  · the rebuild refused something — see the ⚠ on `Room.drifted`.
 *
 * ⚠ THE KEY FORMAT IS THE COMPARISON. `referenceKey` writes what an action
 * meant, and changing HOW it writes it would move every key in every file at
 * once and report every game as drifted. That is a real hazard and it is
 * deliberately not solved here: a stamp saying which format a file's keys are
 * in belongs to the saved-game versioning work (CARD-TODO #66), which is the
 * consumer of this signal. Until then, a change to referenceKey's spelling
 * must be treated as a change to this file's on-disk format.
 */
function driftedAgainst(saved: unknown, refs: string[], actions: Action[], skipped: LostAction[]): LostAction[] {
  if (skipped.length) return [];
  if (!Array.isArray(saved) || saved.length !== actions.length) return [];
  const out: LostAction[] = [];
  for (let i = 0; i < actions.length; i++) {
    if (saved[i] === refs[i]) continue;
    const a = actions[i]!;
    out.push({
      i, type: a.type, seat: a.seat, kind: 'changed',
      why: 'it still replays, but it now refers to a different unit, card or outcome',
    });
  }
  return out;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

/**
 * Every room this process is holding. BL-27's expiry sweep is the only caller
 * and the only reason it exists: expiry is the one game event with nobody
 * acting, so the only way to notice it is to go and look.
 *
 * An iterator rather than an array — the sweep runs once a second forever, and
 * it has no business allocating a copy of the room table each time to walk it.
 */
/** Forget a room. THE FILE STAYS — it is the game's record and everything
 * that reads history reads files, not this map. What goes is the in-memory
 * copy that sweepExpiry walks every second and that nothing was ever freeing:
 * there was no `rooms.delete` anywhere, so every room since boot stayed
 * resident until the next restart. `keepFile: false` is for sandbox rooms,
 * which are scratch by definition. */
export function dropRoom(code: string, keepFile = true): boolean {
  const room = rooms.get(code);
  if (!room) return false;
  rooms.delete(code);
  if (!keepFile) {
    try { unlinkSync(join(GAMES_DIR, `${code}.json`)); } catch { /* never written, or already gone */ }
  }
  return true;
}

export function allRooms(): IterableIterator<Room> {
  return rooms.values();
}

/** `creatorDeck` (constructed only): the first joiner's deck, used to build
 * the waiting room's placeholder state — setRoomDeck assigns it to the actual
 * seat once main.ts has picked one.
 *
 * BL-26: `clockStart` is THIS room's bank — `undefined` takes the default,
 * `null` means no clock. It is last and optional so every existing caller
 * (the tests, the rematch, the scenario deal) keeps getting exactly today's
 * 60-minute room without saying so. */
export function createRoom(code: string, seed: number, names: [string, string] = ['Player 1', 'Player 2'], mode: GameMode = 'shared', els?: Element[], creatorDeck?: CardName[], scenario?: string, clockStart: number | null = CLOCK_START_MS, customIn?: RoomCustom): Room {
  // BL-43: custom rules belong to a live draft, and never to a scenario deal
  const custom = mode === 'draft' && !scenario ? customIn : undefined;
  const trio = sanitizeTrio(els, roomElementCount({ custom }));
  if (mode === 'constructed' && !creatorDeck) throw new IllegalAction('a constructed room needs a deck');
  const decks: [CardName[] | null, CardName[] | null] = [null, null];
  const { state, events } = mode === 'constructed'
    ? fresh(seed, names, mode, trio, [creatorDeck!, creatorDeck!], scenario, custom?.deal)
    : fresh(seed, names, mode, trio, undefined, scenario, custom?.deal);
  const room: Room = {
    code, seed, mode, els: trio, decks, deckIds: [null, null], names, users: [null, null], winner: null,
    // R216: only a scenario room carries one; `undefined` is the normal case
    // and is not persisted (see persist()).
    ...(scenario ? { scenario } : {}),
    // BL-43: likewise only a custom room, and persisted only then
    ...(custom ? { custom } : {}),
    lobby: mode === 'draft' && !els ? freshLobby() : null,
    rematch: [false, false], rematchRoom: null,
    state, actions: [], events, sockets: [null, null], watchers: new Set(), forks: [], lost: [], drifted: [],
    frozen: null,
    // R200: stamped a line below, by resetSegment(), which is where EVERY
    // fresh action log gets its first version stamp — a new room and a re-deal
    // are the same event as far as "which engine is recording this" goes.
    // Setting it here as well would be dead code the moment resetSegment runs,
    // and dead code is exactly what a red-check cannot see through.
    versions: [],
    segKey: null, segSnapshot: null, heldEvents: [[], []], segStartIndex: -1, segTouched: [],
    segIdFloor: [], segRefs: [], deferred: [[], []],
    // BL-26: both banks START at the room's own setting — the ONE site that is
    // allowed to read the constant, and it reads it through the argument
    // default rather than directly. A clockless room's `clockMs` is never
    // billed, never sent and never read; 0 says so louder than 60:00 would.
    clockStart, clockMs: clockStart === null ? [0, 0] : [clockStart, clockStart],
    matchMs: 0, matchRun: false, startedAt: null,   // BL-37
    clockStamp: Date.now(), clockRun: [false, false],
    building: [null, null],
    fullControl: [false, false],   // BL-18: opt-in, and nobody has yet
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

/** minted-but-not-yet-joined codes: when each was minted and — BL-43 — the
 * custom rules its creator chose (already resolved and checked) with the fixed
 * elements they were checked against. A join creates the room from THIS, never
 * from its own message, so the second player can no more re-specify the rules
 * than the clock. */
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
  reserved.set(code, { at: Date.now(), ...(custom ? { custom, ...(els ? { els: [...els] } : {}) } : {}) });
}

/** is `code` either a live room or a code we minted? (i.e. joinable at all) */
export function roomExistsOrReserved(code: string): boolean {
  pruneReservations();
  return rooms.has(code) || reserved.has(code);
}

/**
 * R274 / CT-148 — WHY THE MESSAGE LIVES HERE AND NOT IN THE SOCKET HANDLER.
 *
 * A mistyped room code is the one refusal a player earns before they have a
 * game at all, and the SENTENCE is the whole product: the client shows it
 * verbatim on the connecting screen, and if it never arrives the screen says
 * "Connecting to the server…" forever. That decision used to be two inline
 * `send(ws, {t:'error', …})` calls inside main.ts's `msg.t === 'join'` branch,
 * where the only way to read it was to open a real WebSocket and play — the
 * same trap R204 named for the pacing and R150 named for the drain. Lifted to
 * a named function it is a value, so a test can assert what the player is
 * told without binding a port.
 *
 * Returns null when nothing is wrong with the CODE itself. It says nothing
 * about decks, seats or modes — those refusals need the room, and come after.
 */
export function joinRefusal(code: string): string | null {
  if (!code) return 'a room code is required';
  if (!roomExistsOrReserved(code)) {
    // A code that names no room, and that we never minted, is a typo — say so
    // instead of quietly creating an empty game around it (playtest: two of
    // those ended up saved in games/, and the player thought they were in
    // their opponent's room the whole time).
    return `No game with code ${code}. Check the code with your opponent, or start a new game.`;
  }
  return null;
}

/**
 * Which seat a joiner gets, or the sentence they are refused with.
 *
 * A seat is CLAIMED when `room.users[seat]` names an account — set on join,
 * persisted, restored, carried across a rematch. The claim is what binds, not
 * the live socket: the socket is gone the moment the victim's tab closes, and
 * "wait for the disconnect, then sit down" has to fail exactly like sitting
 * down on them. So:
 *
 *   requested, claimed by another account  → refuse, naming the occupant
 *   requested, claimed by me               → allow; the stale tab is kicked
 *                                            (a stale tab must never dead-end
 *                                            the real person behind "seat
 *                                            taken" — the LAN-era rule, kept)
 *   requested, unclaimed                   → allow; whoever is there is kicked
 *   no seat requested                      → my own claimed seat if I have
 *                                            one, else the first seat that is
 *                                            neither claimed by another nor
 *                                            occupied, else "full"
 *
 * ⚠ THE SIGNED-OUT CARVE-OUT, argued rather than assumed. An unclaimed seat
 * has no identity to bind to, so a signed-out player can be displaced from
 * one by anyone with the code. The alternative is a per-connection seat
 * token — a second auth system beside the one that already exists, with its
 * own "I lost my tab" recovery story. The mitigation is "log in": a claimed
 * seat cannot be taken, and playing signed in is what records the game
 * anyway. A signed-out joiner asking for a CLAIMED seat is refused like
 * anyone else — no account is "another account" from the claim's side.
 *
 * Like `joinRefusal`: a value, so test-seat-binding.ts can read the
 * sentence without a socket.
 */
export type SeatVerdict =
  | { seat: 0 | 1; kicked: Room['sockets'][number] }
  | { refuse: string };

export function seatVerdict(room: Room, requested: number | undefined, me: string | null): SeatVerdict {
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
 * The room for `code`, creating it ONLY if the code was reserved by /api/new.
 * Returns null when the code names nothing — the caller turns that into the
 * error the player sees.
 *
 * `mode`/`els`/`creatorDeck`/`clockStart` only matter when the room doesn't
 * exist yet (the creator's first join carries them); joining an existing room
 * ignores them.
 *
 * ⚠ BL-26: that "ignores them" is load-bearing for the clock. The SECOND
 * player's join carries whatever their own client felt like sending, and the
 * room's bank is not theirs to set — a joiner who could re-specify it could
 * hand their opponent a three-second game by editing a link.
 */
export function joinableRoom(code: string, mode: GameMode = 'shared', els?: Element[], creatorDeck?: CardName[], clockStart: number | null = CLOCK_START_MS): Room | null {
  const existing = rooms.get(code);
  if (existing) return existing;
  pruneReservations();
  // spending the reservation and creating are one step: a second join to the
  // same code finds the room above rather than a second reservation
  const reservation = reserved.get(code);
  if (!reservation) return null;
  reserved.delete(code);
  // BL-43: a reservation made with custom rules brings them, with the fixed
  // elements (if any) the pool was checked against — the join's own `els` are
  // not consulted. Only a live draft carries rules; any other mode plays standard.
  const custom = mode === 'draft' ? reservation.custom : undefined;
  return createRoom(code, (Math.random() * 1e9) >>> 0, undefined, mode, custom ? reservation.els : els, creatorDeck,
    undefined, clockStart, custom);
}

/** Apply an action to the room's authoritative state and record it. Throws
 * whatever the engine throws (IllegalAction) — caller reports it to the actor. */
export function applyToRoom(room: Room, action: Action): EngineEvent[] {
  // CT-160 — THE ONE DOOR. A frozen game accepts nothing, and this is the
  // only place that has to know it: every route an action can take to the
  // state goes through here (main.ts's `action` handler, its `drainForced`
  // drain of the steps a board owes itself, its deferred-queue drain, the
  // scripted opponent, undoActionAt's rebuild-and-reapply). Guarding the call
  // sites instead would be five guards and a sixth site added later.
  //
  // `concede` is refused too, and that is deliberate rather than an oversight
  // of R65. Conceding APPENDS to the log and stamps a winner — on a game whose
  // log already stopped describing its board, and into the stats fold. There
  // is no move that makes a forked file honest again; the players start a new
  // room.
  if (room.frozen) throw new IllegalAction(room.frozen);
  // BL-27 — and a game that is over without the BOARD saying so. The engine
  // refuses everything once `state.winner` is set, but a loss on time never
  // touches the state (and neither does a stamped result whose replay stopped
  // short), so without this the loser could go on playing a game they had
  // already lost. Narrow on purpose: `state.winner !== null` is still the
  // engine's own business, so no in-state path can be changed by this line.
  if (decidedOutsideState(room)) throw new IllegalAction('this game is already over');
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
  // R235: a reveal is public immediately and is never parked (escapesHold)
  if (holding) room.heldEvents[seatSlot(other(action.seat))].push(...r.events.filter(e => !escapesHold(e)));
  if (room.state.winner !== null) room.winner = room.state.winner;   // stamp it
  // R290: and if it was a concede that decided it, stamp who and WHEN. The
  // turn is read off the state the action was applied to — a concede does
  // not advance the turn, but "the turn it was taken on" is a fact about the
  // moment, and the fold must never have to replay to recover it.
  if (action.type === 'concede' && before.winner === null && room.state.winner !== null) {
    room.concession = { seat: action.seat, turn: before.turn };
  }
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
  room.drifted = [];
  // CT-160: and so is the freeze, for the same reason — it is a claim about a
  // log that has just been discarded. (Unreachable in practice: a re-deal only
  // happens on a room whose log was empty. Left in so the invariant "every
  // claim about `actions` is dropped with `actions`" has no exception to
  // remember.)
  room.frozen = null;
  // R200: and so is the version ledger, for exactly the same reason — the old
  // stamps index an action log that no longer exists, and a `from` pointing
  // into a discarded log is worse than no stamp at all. The re-deal happens on
  // the running engine, so the new log starts stamped with it from action 0.
  room.versions = [{ at: new Date().toISOString(), sha: engineVersion(), from: 0 }];
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
/** Exported for `test-undo-segment.ts` §8: this is a pure function of an
 * action and an id range, and R181's `via: { face }` corruption is only
 * observable in its OUTPUT — by the time the rebuild has run, a mangled
 * activation is indistinguishable from an action the engine simply refused. */
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
  // CT-160: an undo is a WRITE to the log — it splices an action out and
  // rebuilds. `applyToRoom` would not stop it (undoActionAt replays through
  // rebuild(), not through it), and editing a log that has already stopped
  // describing its board is the one thing freezing exists to prevent.
  if (room.frozen) return { ok: false, why: room.frozen };
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
 * R200 — read a file's version ledger back, keeping only entries that could
 * have been written by this server.
 *
 * Defensive because the input is a FILE: it may predate the field entirely
 * (→ `[]`, which is honest — "this game does not say what recorded it"), and
 * a hand-edited one may hold anything. A malformed entry is DROPPED rather
 * than repaired: an invented `from` would send `--as-recorded` to the wrong
 * commit for part of the log, which is the exact failure the ledger exists to
 * prevent. `from` must be non-decreasing for the segments to mean anything.
 */
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
 * R200 — this room is about to be played on THIS engine: say so in the file if
 * it is not already what the file says.
 *
 * Returns true when something was appended (so the caller persists).
 *
 * Idempotent by construction: the stamp only appends when the running SHA
 * differs from the last one recorded, so restarting ten times on one commit
 * writes one stamp, not ten — the same discipline `recordFork` uses, and for
 * the same reason (the deploy box restarts a lot).
 *
 * A room whose file predates the field gets its FIRST stamp here, with
 * `from` = however many actions are already logged. That is the truthful
 * statement available: everything before this index was recorded by an engine
 * this file never named, and everything after it by this one. It deliberately
 * does NOT claim `from: 0` — backdating the current SHA over a log recorded by
 * an older engine would make `--as-recorded` confidently replay the wrong
 * rules and call the mismatch a rules change.
 */
function stampVersion(room: Room): boolean {
  const sha = engineVersion();
  const last = room.versions[room.versions.length - 1];
  if (last && last.sha === sha) return false;
  room.versions.push({ at: new Date().toISOString(), sha, from: room.actions.length });
  return true;
}

/**
 * CT-160 — STOP RATHER THAN REBUILD.
 *
 * A LIVE room whose rebuild REFUSED a logged action is frozen: from here on it
 * accepts nothing (applyToRoom, undoForSeat) and offers nothing (legalInRoom).
 * Returns true when this call is what froze it.
 *
 * The condition is exactly `recordFork`'s, minus drift:
 *
 *   live (`decidedWinner === null`)   a finished game is archive, and the
 *                                     archive must stay readable. Nobody is
 *                                     going to play into it, so there is
 *                                     nothing to stop.
 *   `lost.length > 0`                 a REFUSAL is where the log stops
 *                                     describing the board. R191 drift is a
 *                                     different animal: every action still
 *                                     applies, so the log does still produce
 *                                     this board — on rules that moved, which
 *                                     `forks` says out loud and the players
 *                                     are told. That game is one game.
 *
 * The reason is a sentence, not a boolean, because it is the message BOTH
 * players get — once in the game log (recordFork writes it there) and again by
 * name every time either of them clicks anything.
 */
function freezeForFork(room: Room): boolean {
  if (room.frozen) return false;
  if (decidedWinner(room) !== null) return false;
  if (!room.lost.length) return false;
  room.frozen = `This game has been STOPPED. The rules changed under it while it was being `
    + `played: ${room.lost.length} of its ${room.actions.length} logged moves no longer happen `
    + `the way they were recorded, so the board was rebuilt without them and it is not the `
    + `board this game was played on. Continuing would record new moves onto a game nobody `
    + `played. Nothing is lost — the whole log is saved exactly as it stands. Start a new game.`;
  console.warn(`[rooms] ${room.code} FROZEN: ${room.lost.length} of ${room.actions.length} `
    + `logged actions no longer replay; the room accepts no further actions`);
  return true;
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
  // R191: EITHER kind of divergence. A restore that refused nothing and still
  // produced a different board is a fork too — the quieter one, and the one
  // the file had no way of admitting to before.
  const entries = [...room.lost, ...room.drifted];
  if (!entries.length) return false;
  const previous = room.forks[room.forks.length - 1];
  if (previous && sameLoss(previous.lost, entries)) return false;   // already known
  room.forks.push({
    at: new Date().toISOString(),
    logged: room.actions.length,
    lost: entries.map(l => ({ ...l })),
    turn: room.state.turn,
    phase: room.state.phase,
    // R200: WHICH engine refused these actions, and therefore which engine the
    // rest of this log was recorded against. Without it the fork block says a
    // game broke without saying what broke it.
    engineVersion: engineVersion(),
  });
  // and say it OUT LOUD, in the game's own log, where both players see it on
  // their next join. Degrading quietly is the whole failure mode here — and a
  // silent change of meaning degrades more quietly than a refusal, so it gets
  // its own sentence rather than being counted in with the losses.
  const msg = room.lost.length
    ? `⚠ This game could not be fully restored: ${room.lost.length} of ${room.actions.length} `
      + `logged actions no longer replay under the current rules, so it has been rebuilt without `
      + `them and stands at turn ${room.state.turn}. Everything before this line describes a `
      + `different board.`
      // CT-160: and it goes no further. Before this, the sentence above was the
      // whole response and play carried straight on from the rebuilt board —
      // which is what made the REST of the log fiction. `freezeForFork` runs
      // just before this, so a live room's note ends by saying what will
      // actually happen when either player clicks.
      + (room.frozen
        ? ` THE GAME HAS BEEN STOPPED HERE: no further moves will be accepted, because they `
          + `would be recorded onto a board this game was never played on. The log is kept `
          + `intact. Start a new game to keep playing.`
        : '')
    : `⚠ This game was restored onto changed rules: all ${room.actions.length} logged actions still `
      + `replay, but ${room.drifted.length} of them now refer to something else (another unit, `
      + `another card, another roll), so the board at turn ${room.state.turn} is not the one they `
      + `were taken on. Everything before this line describes a different board.`;
  room.events.push({
    type: 'note',
    msg,
    data: { lost: room.lost.length, changed: room.drifted.length, logged: room.actions.length },
  } as unknown as EngineEvent);
  console.warn(`[rooms] ${room.code} FORKED on restore: ${room.lost.length} of ${room.actions.length} `
    + `actions could not be replayed`
    + (room.drifted.length ? `, ${room.drifted.length} changed meaning` : '')
    + `; the game resumes at turn ${room.state.turn} ${room.state.phase}`);
  return true;
}

/** rebuild() for a room that already knows its own seed/mode/els/decks. */
function rebuildRoom(room: Room): Rebuilt {
  return rebuild(room.seed, room.names, room.actions, room.mode, room.els,
    room.mode === 'constructed' ? decksFor(room) : undefined, room.scenario, room.custom?.deal);
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
  // R191: drift is a claim about the FILE this room was restored from, and this
  // rebuild has just superseded it (a persist() follows every one of these and
  // rewrites the keys). Only restoreRooms() sets it.
  room.drifted = [];
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
  // BL-26: a rematch keeps the clock setting. "Run it back" means the same
  // game again, and a pair who agreed on a 20-minute bank (or on none) did not
  // agree to an hour on the second one.
  const room = old.mode === 'constructed' && old.decks[0] && old.decks[1]
    ? createRoom(code, seed, [...old.names], old.mode, old.els, old.decks[0]!, undefined, old.clockStart)
    // BL-43: and a custom draft keeps its rules — the same resolved deal, not a re-resolution
    : createRoom(code, seed, [...old.names], old.mode, old.mode === 'draft' ? undefined : old.els,
      undefined, undefined, old.clockStart, old.custom);
  if (old.mode === 'constructed' && old.decks[0] && old.decks[1]) {
    room.decks = [[...old.decks[0]!], [...old.decks[1]!]];
    room.deckIds = [...old.deckIds];
    const { state, events } = fresh(seed, room.names, room.mode, room.els, [room.decks[0]!, room.decks[1]!], room.scenario, room.custom?.deal);
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

/**
 * BL-01 — build the room the MATCHMAKER puts two strangers into.
 *
 * The sibling of `createRematch` above, and deliberately shaped like it: the
 * SERVER builds the room outright and hands both clients its code, rather than
 * one client creating a room and the other being told to find it. That is what
 * makes "two players land in the same room without either one sending a link"
 * true by construction — there is no window in which one of them has a room
 * and the other has a URL.
 *
 * `a` and `b` are the two queue entries. `a` takes seat 0. The caller decides
 * which is which (queue.ts randomises it off the pair, so neither the
 * longer-waiting player nor the higher-rated one gets a systematic side).
 *
 * ⚠ THREE THINGS THIS DOES THAT A NORMAL ROOM CREATION DOES NOT:
 *
 * 1. `rated: true`. This is the ONLY site that sets it — see Room.rated.
 * 2. The clock comes from MATCH_CLOCK_MS, not from either player. See that
 *    constant for why asking them would break BL-27.
 * 3. `users` is stamped before either client has connected, exactly as the
 *    rematch does, so the game is attributable from the first action. If it
 *    waited for the joins, a player who accepted and then closed the tab
 *    would leave a game belonging to nobody.
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
    // The constructed branch of createRematch, for the same reason: both
    // players have already chosen a deck (you cannot queue for constructed
    // without one), so the room DEALS rather than opening a deck-picker
    // lobby. createRoom only takes one deck, so the second is assigned and
    // the state re-dealt from both.
    const room = createRoom(code, seed, names, mode, undefined, a.deck, undefined, MATCH_CLOCK_MS.constructed);
    room.decks = [[...a.deck], [...b.deck]];
    room.deckIds = [a.deckId ?? null, b.deckId ?? null];
    const { state, events } = fresh(seed, names, mode, room.els, [room.decks[0]!, room.decks[1]!], room.scenario, room.custom?.deal);
    room.state = state;
    room.events = events;
    room.users = [a.userId, b.userId];
    room.rated = true;
    for (const seat of [0, 1] as Seat[]) room.state.players[seat]!.name = names[seat]!;
    resetSegment(room);   // the deal above replaced the state
    persist(room);
    return room;
  }
  // Draft: pass NO trio, so createRoom opens the ordinary blind lobby. Two
  // strangers have even more reason than two friends not to let one of them
  // pick the elements — which is the argument the lobby was built on.
  const room = createRoom(code, seed, names, mode, undefined, undefined, undefined, MATCH_CLOCK_MS.draft);
  room.users = [a.userId, b.userId];
  room.rated = true;
  for (const seat of [0, 1] as Seat[]) room.state.players[seat]!.name = names[seat]!;
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

/** Files older than this are left on disk and NOT restored at boot. They are
 * still readable by replay-room.ts and by the history fold, which read files;
 * what they no longer do is get replayed through the engine on every restart
 * and walked by the sweep every second for ever. */
const RESTORE_WINDOW_MS = 7 * 24 * 3600_000;

function persist(room: Room): void {
  // ⚠ SANDBOX ROOMS ARE PERSISTED TOO — BL-06's call, and test-sandbox.ts
  // asserts a played one rebuilds byte-identically across a restart. What
  // bounds the disk is main.ts's cap: the fifty-first sandbox evicts the
  // oldest WITH its file (dropRoom(code, false)).
  try {
    mkdirSync(GAMES_DIR, { recursive: true });
    const path = join(GAMES_DIR, `${room.code}.json`);
    // temp + rename, like accounts.ts: this file is the game's only record,
    // and a crash mid-write must not leave it half-written (restoreRooms
    // would silently skip the corrupt room and the game would be lost)
    const tmp = `${path}.tmp`;
    // clockMs is persisted too: elapsed time cannot be reconstructed from a
    // replay. (Additive field — older files without it restore at CLOCK_START_MS, which is 60:00 — this comment said 40:00 until 2026-08-26 and was wrong from the day the constant moved.)
    writeFileSync(tmp, JSON.stringify({
      seed: room.seed, mode: room.mode, els: room.els, names: room.names,
      // accounts: who each seat belonged to, so the stats fold knows whose
      // game this was long after the sockets are gone (additive field)
      users: room.users,
      // and the result, stamped at the time — see Room.winner
      winner: room.winner,
      // R290: and, when a concede decided it, who conceded on which turn.
      // Additive: written only when present, so no other file grows a field.
      ...(room.concession ? { concession: room.concession } : {}),
      // the draft lobby: a room can be restarted mid-trio-choice, and losing
      // two rankings to a deploy would be a genuinely annoying way to lose
      // them (additive field)
      ...(room.lobby ? { lobby: room.lobby } : {}),
      // R216: the scenario is part of the DEAL, so it sits beside `seed`
      // rather than anywhere near the log. Additive: absent on every ordinary
      // room and on every file written before the tester existed.
      ...(room.scenario ? { scenario: room.scenario } : {}),
      // BL-43: the custom rules AND the deal they resolved to, beside the seed —
      // the deal is what a restore re-deals from. Additive: written only when present.
      ...(room.custom ? { custom: room.custom } : {}),
      // BL-02: rated iff the matchmaker made this room. Additive and written
      // only when true, so no existing game file grows a field — and an
      // absent flag reads as unrated, which is right for every game played
      // before the queue existed.
      ...(room.rated ? { rated: true } : {}),
      actions: room.actions, clockMs: room.clockMs,
      // BL-26: the room's own bank, ALWAYS written (including `null`, which is
      // "no clock" and must be distinguishable from a file that predates the
      // setting — an absent field means 60:00, which is what those games were
      // really played with). See restoreRooms.
      clockStart: room.clockStart,
      // BL-37: how long the match actually took, and when it started. Always
      // written; a file without them predates the timer and reads as unknown
      // (0 / null), which is why the post-game screen omits the line rather
      // than printing 0:00 for every game ever played before today.
      matchMs: room.matchMs, startedAt: room.startedAt,
      // R191: WHAT EACH ACTION MEANT WHEN IT WAS TAKEN (referenceKey), so a
      // later restore can tell that the log still replays and no longer
      // describes the same game — see driftedAgainst(). Parallel to `actions`.
      // Additive: a file without it is compared against nothing and reports no
      // drift, which is the only honest answer for a file that never recorded
      // what its actions meant.
      ...(room.segRefs.length === room.actions.length && room.actions.length
        ? { refs: room.segRefs }
        : {}),
      // every restore that could not faithfully rebuild this game. Without
      // it the file goes on claiming to be a straight-through record of a
      // game it no longer describes (additive field)
      ...(room.forks.length ? { forks: room.forks } : {}),
      // R200: which engine recorded which stretch of this log — the decoder
      // ring `replay-room.ts --as-recorded` needs to check the file's claim
      // against the rules as they actually were. Additive: a file without it
      // restores exactly as before, it just cannot be replayed as-recorded.
      ...(room.versions.length ? { versions: room.versions } : {}),
      // constructed: decks are part of the replay config (additive field)
      ...(room.mode === 'constructed' ? { decks: room.decks, deckIds: room.deckIds } : {}),
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
  let stale = 0;
  for (const f of files) {
    const code = f.replace(/\.json$/, '');
    try {
      if (Date.now() - statSync(join(GAMES_DIR, f)).mtimeMs > RESTORE_WINDOW_MS) { stale++; continue; }
      const raw = JSON.parse(readFileSync(join(GAMES_DIR, f), 'utf8')) as {
        seed: number; mode?: GameMode; els?: Element[]; names?: [string, string];
        actions: Action[]; clockMs?: [number, number];
        /** BL-26: the room's bank. Absent in every file written before the
         *  setting existed — see the restore below. */
        clockStart?: number | null;
        /** BL-37: how long the match ran, and when it started. Absent in every
         *  file written before the timer existed, which reads as unknown. */
        matchMs?: number;
        startedAt?: number | null;
        users?: [string | null, string | null];
        winner?: number | null;
        lobby?: Lobby;
        decks?: [CardName[] | null, CardName[] | null];
        deckIds?: [string | null, string | null];
        forks?: Fork[];
        /** R191: per-action reference keys, as of when the game was played */
        refs?: unknown;
        versions?: VersionStamp[];
        /** R216: the scenario this room was dealt with */
        scenario?: unknown;
        /** BL-43: the custom rules, and the deal they resolved to */
        custom?: { rules?: unknown; deal?: unknown } | null;
        /** BL-02: the matchmaker made this room */
        rated?: unknown;
        /** R290: who conceded, on which turn */
        concession?: unknown;
      };
      const concession = sanitizeConcession(raw.concession);
      const names = raw.names ?? ['Player 1', 'Player 2'];
      const users: [string | null, string | null] = [raw.users?.[0] ?? null, raw.users?.[1] ?? null];
      const savedWinner: Seat | null = raw.winner === 0 || raw.winner === 1 ? raw.winner : null;
      const mode = raw.mode ?? 'shared';
      const custom = restoreCustom(raw.custom, mode);
      const els = sanitizeTrio(raw.els, roomElementCount({ custom }));
      // R216. A file naming a scenario this build does not have is NOT
      // restored as an ordinary game: the log was recorded against a board
      // that came from somewhere, and replaying it without that board would
      // produce a plausible-looking room describing a game nobody played.
      // Loud, and the catch below turns it into a skipped room with a reason.
      const scenario = raw.scenario === undefined || raw.scenario === null
        ? undefined
        : String(raw.scenario);
      if (scenario !== undefined && !isDealId(scenario)) {
        throw new Error(`saved with scenario '${scenario}', which this build does not define`
          + ' — refusing to replay its log onto an ordinary deal');
      }
      const decks: [CardName[] | null, CardName[] | null] = [null, null];
      if (mode === 'constructed') {
        for (const s of [0, 1] as const) {
          const c = checkDeck(raw.decks?.[s]);
          if (c.ok) decks[s] = c.cards;
        }
        if (!decks[0] && !decks[1]) throw new Error('constructed room with no decks');
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
      const { state, events, segKey, segSnapshot, heldEvents, segStartIndex, segTouched,
        segIdFloor, segRefs, skipped } = rebuild(
        raw.seed, names, actions, mode, els,
        mode === 'constructed' ? decksFor({ decks }) : undefined, scenario, custom?.deal);
      // BL-26 — THE ADDITIVE CASE, and the only place CLOCK_START_MS is still
      // read outside creation. A file written before the setting existed has
      // no `clockStart`, and 60:00 is not a guess for it: it is the bank that
      // game was actually played with, because it was the only one there was.
      // `sanitizeClock(undefined)` says exactly that, and `null` on disk (a
      // room created with no clock) survives the round trip as `null` rather
      // than being read as "missing".
      const clockStart = sanitizeClock(raw.clockStart);
      const clockMs: [number, number] = Array.isArray(raw.clockMs) && raw.clockMs.length === 2
        ? [Math.max(0, Number(raw.clockMs[0]) || 0), Math.max(0, Number(raw.clockMs[1]) || 0)]
        : clockStart === null ? [0, 0] : [clockStart, clockStart];
      rooms.set(code, {
        code, seed: raw.seed, mode, els, decks, deckIds, names, users, lobby,
        ...(scenario ? { scenario } : {}),
        ...(custom ? { custom } : {}),
        // BL-02: carried across the restart, or the queue's games would
        // quietly stop being rated every time the box is deployed
        ...(raw.rated === true ? { rated: true } : {}),
        rematch: [false, false], rematchRoom: null,
        // the replay may not reach the ending this game actually had
        winner: state.winner ?? savedWinner,
        // R290: the concession stamp survives the restart with the result
        ...(concession ? { concession } : {}),
        state, actions, events,
        sockets: [null, null], watchers: new Set(), segKey, segSnapshot, heldEvents, segStartIndex, segTouched,
        segIdFloor, segRefs, deferred: [[], []],
        forks: Array.isArray(raw.forks) ? raw.forks : [], lost: skipped,
        // CT-160: recomputed a few lines below, once the room exists to ask
        // decidedWinner() about
        frozen: null,
        // R191: and what this rebuild changed WITHOUT refusing anything
        drifted: driftedAgainst(raw.refs, segRefs, actions, skipped),
        versions: sanitizeVersions(raw.versions),
        clockStart,
        // Nobody is connected right after a restart, so no clock runs yet —
        // and BL-27 leans on both halves of this line. `clockStamp` is NOW,
        // not the moment the file was written, so the hours the server spent
        // down are never billed to anybody; `clockRun` is [false,false], so
        // the expiry sweep skips this room outright until somebody joins and
        // settles it. Nobody may lose on the strength of wall-clock time that
        // passed while there was no game to play.
        clockMs, clockStamp: Date.now(), clockRun: [false, false],
        // BL-37: the match clock is CARRIED ACROSS the restart, for the same
        // reason `clockMs` is — it is time that really was spent on this game.
        // What is NOT carried is the hours the server was down: `matchRun` is
        // false and `clockStamp` is now, so the first settle after somebody
        // joins bills nothing for the gap. A file that predates the timer
        // restores at 0, which reads as unknown.
        matchMs: Math.max(0, Number(raw.matchMs) || 0),
        matchRun: false,
        startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : null,
        building: [null, null],
        // BL-18: not persisted — every client re-asserts it on the join that
        // brings it back into the room
        fullControl: [false, false],
      });
      // a LIVE room whose log could not be fully replayed has just forked:
      // record it in the file and in the game's own log before play resumes
      const restored = rooms.get(code)!;
      // CT-160: BEFORE recordFork, because a live room that lost actions is
      // stopped here rather than continued, and the note recordFork writes
      // into the game's own log has to say so. Freezing does not replace the
      // record — it replaces continuing on top of it.
      freezeForFork(restored);
      let dirty = decidedWinner(restored) === null && recordFork(restored);
      // R200: and a LIVE room now continues under THIS engine, whether or not
      // anything was lost. A rules change that costs no action still changes
      // what the actions after it mean, so the boundary is stamped on any
      // engine change — the loss-free case is the one that used to leave no
      // trace at all.
      if (decidedWinner(restored) === null && stampVersion(restored)) dirty = true;
      if (dirty) persist(restored);
      console.log(`[rooms] restored ${code} (${raw.actions.length} actions`
        + `${skipped.length ? `, ${skipped.length} unreplayable` : ''}`
        + `${restored.drifted.length ? `, ${restored.drifted.length} changed meaning` : ''}`
        + `${restored.frozen ? ', FROZEN' : ''})`);
    } catch (err) {
      console.error(`[rooms] could not restore ${code}:`, err instanceof Error ? err.message : err);
    }
  }
  if (stale) console.log(`[rooms] ${stale} game file${stale === 1 ? '' : 's'} older than 7 days left on disk, not restored`);
}
