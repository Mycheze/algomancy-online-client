/* THE WIRE — every message between the browser and the game server, named once.
 *
 * server/main.ts parses what arrives with `parseClientMsg` and sends only
 * `ServerMsg`; ui/main.ts reads `ServerMsg` and sends only `ClientMsg`, and so
 * do the servers that run inside the page (ui/solo.ts, ui/replayserver.ts). A
 * new message is a new variant here, and each handler that switches over the
 * union stops compiling until it says what it does with it.
 *
 * A payload whose shape one side owns (the server builds it, a ui/ module
 * declares what it reads) is a slot in `Payloads`, filled in by its reader.
 * Types and pure helpers only, over the engine's types (engine/test/282 §6).
 */
import type { Action, AmendEdit, CardName, EngineEvent, EntityId, GameState, Phase, Seat } from '../engine/src/types.ts';

type Pair<T> = [T, T];
type Open = { [k: string]: unknown };

/** a formation the other seat is still building: columns by attacker column,
 * the counterattack list and, CR 606.4a, its LEFT side-blocks */
export type Building = { cols: EntityId[][]; send: EntityId[]; left?: EntityId[][] };
/** one step of a hidden step's playback: an opponent's move, or one
 * resolution of the closing action (server/view.ts playbackFrames) */
export type PlaybackFrame = { view: GameState; events: EngineEvent[]; kind: 'opp' | 'tail' };

// ── browser → server ────────────────────────────────────────────────────

export type ClientMsg =
  | { t: 'watch'; room: string; token?: string }
  | {
    t: 'join'; room: string; seat: Seat | null; name: string; token?: string;
    /** the waiting room's own "Play this deck" */
    pick?: true;
    /** read only by the join that creates the room */
    mode?: string; els?: string[]; rules?: 'competitive'; clock?: string; cc?: { bestOf: 1 | 3; casual?: true };
    /** full control and the report dialog's hold, re-asserted on every join */
    on: boolean; hold?: true;
    deck?: CardName[]; deckId?: string; single?: CardName;
    /** a registration's sideboard beside `deck`: read, but the browser registers by `deckId` */
    side?: CardName[];
  }
  | { t: 'queue'; token: string; q: 'join'; mode: string; ranked: boolean; vs?: string; deckId?: string }
  | { t: 'queue'; token: string; q: 'leave' | 'accept' | 'decline' }
  | { t: 'cube'; op: 'sub'; code: string; token: string | null }
  | { t: 'cube'; op: 'unsub' }
  | { t: 'cube'; op: 'reserve' | 'pick'; card: string }
  | { t: 'cc'; op: 'config'; main: CardName[]; side: CardName[] }
  | { t: 'cc'; op: 'ready'; ready: boolean; initiative?: number }
  | { t: 'cc'; op: 'pause' | 'unpause' | 'resume' }
  | { t: 'concedeMatch' }
  | { t: 'rematch'; want: boolean }
  | { t: 'dispute'; note: string }
  | { t: 'lobby'; method?: string }
  | { t: 'lobby'; submission: { element?: string; ranking?: string[] }; lock: true }
  | { t: 'lobby'; lock: false }
  /** `at`: a pass carries the `actionCount` of the view it answers */
  | { t: 'action'; action: Action; at?: number }
  | ({ t: 'building' } & Building)
  | { t: 'fullcontrol'; on: boolean }
  | { t: 'passall'; on: true; mode: 'all' | 'stack'; phase: Phase; items: readonly EntityId[]; opts: readonly string[] }
  | { t: 'passall'; on: false }
  | { t: 'autopass'; pref: boolean; yields: EntityId[] }
  | { t: 'reporthold'; on: boolean }
  | { t: 'playbackdone' }
  | { t: 'undo' }
  | { t: 'amend'; op: 'options' }
  | { t: 'amend'; op: 'propose'; reason: string; takeBack?: true; rewind?: number | null; edit?: AmendEdit | null }
  | { t: 'amend'; op: 'accept' | 'decline' | 'cancel'; id: number };

/** every tag, once: one added to the union and not here does not compile */
const CLIENT_TAGS: Record<ClientMsg['t'], true> = {
  watch: true, join: true, queue: true, cube: true, cc: true, concedeMatch: true, rematch: true,
  dispute: true, lobby: true, action: true, building: true, fullcontrol: true, passall: true,
  autopass: true, reporthold: true, playbackdone: true, undo: true, amend: true,
};

type KeysOf<M> = M extends unknown ? Exclude<keyof M, 't'> : never;
/** a client message as the SERVER holds it: the tag checked, every other field
 * whatever arrived, until the branch that reads it checks it */
export type Received = {
  [T in ClientMsg['t']]: { t: T } & { [K in KeysOf<Extract<ClientMsg, { t: T }>>]?: unknown }
}[ClientMsg['t']];

/** One frame off the socket: a known tag, or the sentence it is refused with.
 * Never throws (`JSON.parse("null")` succeeds). */
export function parseClientMsg(text: string): Received | { refused: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { refused: 'bad JSON' }; }
  const t: unknown = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { t?: unknown }).t : undefined;
  if (typeof t !== 'string') return { refused: 'bad message' };
  return Object.hasOwn(CLIENT_TAGS, t) ? raw as Received : { refused: `unknown message ${t}` };
}

/** the one door to the wire, for every socket the browser opens */
export function sendMsg(ws: { send(data: string): void }, msg: ClientMsg): void {
  ws.send(JSON.stringify(msg));
}

// ── server → browser ────────────────────────────────────────────────────

/** The shapes one side owns: the server builds each (the file named), and a
 * reader that needs one names its type when it instantiates `ServerMsg`. */
export interface Payloads {
  me: unknown;          // accounts.ts privateView
  gameOver: Open;       // main.ts sendGameOver, beside `t`
  waiting: unknown;     // main.ts waitingInfo
  clock: unknown;       // rooms.ts clockSnapshot
  scenario: unknown;    // main.ts scenarioInfo
  custom: unknown;      // main.ts customInfo
  badge: unknown;       // accounts.ts seatBadge
  fix: unknown;         // rooms.ts fixInfo
  rewind: unknown;      // rooms.ts rewindOptions
  match: unknown;       // match.ts matchSummary
  trio: unknown;        // main.ts, the lobby's resolveLobby
  queue: Open;          // main.ts queueStateFor, beside `t`
  cubeView: unknown;    // cube-types.ts CubeView
  cubeMatch: unknown;   // cube-types.ts CubeMatchView
}
type S<P, K extends keyof Payloads> = K extends keyof P ? P[K] : Payloads[K];

/** what every push of a dealt game carries (server/main.ts baseView); an
 * optional field is absent, never null, where it does not apply */
export type GamePush<P = Payloads> = {
  view: GameState; legal: Action[]; peers: Pair<boolean>;
  scenario?: S<P, 'scenario'>; custom?: S<P, 'custom'>; single?: true;
  /** why the server stopped this game */
  frozen?: string;
  watchers?: number; badges?: Pair<S<P, 'badge'> | null>; clock?: S<P, 'clock'>;
  fix?: S<P, 'fix'>; match?: S<P, 'match'>;
  /** CR D4.6: in a Competitive game, "you can undo now" */
  ccUndo?: boolean;
  waiting?: never;
};
/** a seat's push while its room waits for decks or a trio */
export type LobbyPush<P = Payloads> = { waiting: S<P, 'waiting'>; peers: Pair<boolean>; names: Pair<string>; view?: never };

/** `room` and `boot` are absent only from a server inside the page. `boot`
 * names the server PROCESS, so a reconnect can tell it was restarted. `both`,
 * CR D2.1: this connection acts for BOTH seats — one screen, both hands, no
 * redaction; only a server inside the page serving both halves sends it. */
type JoinedHead = { t: 'joined'; room?: string; seat: Seat; boot?: string; both?: true };
type WatchingHead = { t: 'watching'; room: string; boot?: string; names: Pair<string>; peers: Pair<boolean> };

export type ServerMsg<P = Payloads> =
  | { t: 'error'; msg: string }
  | { t: 'kicked'; msg: string }
  | (JoinedHead & LobbyPush<P>)
  | (JoinedHead & GamePush<P> & {
    names: Pair<string>; log: string[];
    /** the opponent's formation in progress, on a reconnect */
    building?: Building | null;
    trio?: S<P, 'trio'>;
    /** an agreed rewind cut the log */
    rewound?: true;
  })
  | ({ t: 'update' } & LobbyPush<P>)
  | ({ t: 'update' } & GamePush<P> & {
    events?: EngineEvent[];
    /** the whole log, replacing this seat's (an undo removed lines) */
    log?: string[];
    /** the hidden step that just closed, with its playback or its reveal */
    step?: 'plan' | 'haste' | 'deploy'; frames?: PlaybackFrame[]; reveal?: EngineEvent[];
  })
  | (WatchingHead & { waiting: true; view?: never })
  | (WatchingHead & {
    view: GameState; log: string[]; watchers?: number; badges?: Pair<S<P, 'badge'> | null>;
    frozen?: string; clock?: S<P, 'clock'>; waiting?: never;
  })
  | { t: 'me'; me: S<P, 'me'> }
  | ({ t: 'gameover'; me?: S<P, 'me'> } & S<P, 'gameOver'>)
  | { t: 'rematch'; rematch: Pair<boolean>; room: string | null }
  | { t: 'dispute'; disputed: Pair<boolean> }
  | { t: 'disputeerr'; msg: string }
  | ({ t: 'building'; seat: Seat } & Building)
  | { t: 'clock'; clock: S<P, 'clock'> }
  | { t: 'amend'; how: string; fix: S<P, 'fix'> | null; clock?: S<P, 'clock'> }
  | { t: 'amendopts'; why: string }
  | { t: 'amendopts'; rewinds: S<P, 'rewind'>[]; editWhy: string | null }
  | { t: 'amenderr'; msg: string }
  /** where a match went: `room` is its next game's, null once it is over */
  | { t: 'match'; match: S<P, 'match'>; room: string | null }
  | { t: 'queue'; matched: { room: string; seat: Seat; mode: string } }
  | ({ t: 'queue'; matched?: never } & S<P, 'queue'>)
  | { t: 'cube'; view: S<P, 'cubeView'> }
  | { t: 'cube'; error: string }
  | { t: 'cube'; matched: S<P, 'cubeMatch'> };

/** a message without the fields its sender fills in, over each variant */
export type Body<M, K extends PropertyKey = 't'> = M extends unknown ? Omit<M, K> : never;
