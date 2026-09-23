/* BL-38 — WATCHING A FINISHED GAME BACK, FROM ITS SAVED FILE.
 *
 * A saved game is a seed and an action log. The engine is pure — no
 * `Math.random`, no `Date.now` — so replaying it is not an approximation of
 * what happened, it IS what happened, right up until the rules move underneath
 * it. That caveat is the whole of `api-replay.ts` and it arrives here as a
 * verdict this module does not second-guess.
 *
 * What this file is: a third implementation of the `openSocket` seam, after
 * the real server and `ui/solo.ts`. It holds a log and a cursor, and every
 * time the cursor moves it pushes the board at that moment as a `watching`
 * frame. `NetBackend` cannot tell it from a live spectator feed, so the entire
 * board renderer — `regionPanelHtml` for both sides, the stack, the bin, the
 * arrows, the card inspector — works with nothing added to it.
 *
 * ── WHY `watching` AND NOT `update` ──────────────────────────────────
 *
 * They are not interchangeable and the difference is the feature. An `update`
 * goes through `pace.ts`'s queue, which holds a frame the viewer is not being
 * asked anything about for `PACE_MS` — one second, chosen from playtest #94 so
 * a live opponent's turn is legible. A replay auto-advancing at three actions
 * a second would be throttled to one, and at ten to one. `watching` is handled
 * at the top of `applyUpdate` and calls `render()` directly.
 *
 * It also carries no `events`, which keeps `flash.ts`'s 1200 ms beat queue
 * from arming: the beats exist to make ONE opponent turn readable as it
 * happens, and a scrubbed replay is a different thing being looked at in a
 * different way. `anim.ts` still runs and is explicitly non-blocking, but the
 * bar turns motion off above two frames a second, where the flights start
 * overlapping into noise.
 *
 * ── PERSPECTIVE (Bena, 2026-09-23) ───────────────────────────────────
 *
 * A replay opens on the seat you PLAYED — your hand face-up, theirs as backs,
 * and the hidden simultaneous steps still frozen exactly as they were while
 * you were in them. That last part is why this file tracks segments at all: a
 * replay that showed the server's omniscient board would be a record of the
 * game, but not of playing it, and "watch it the way I played it" is the thing
 * a finished game can offer that a live spectator view cannot.
 *
 * The eye toggle switches to `spectatorView` — the unredacted board, the full
 * log, both hands, the opponent's along the top in their own region panel,
 * which the renderer already draws that way for a live spectator. An admin
 * opens there, because they are looking for what somebody is complaining about
 * and the seat they did not play is usually where it is.
 *
 * ⚠ SCENARIO ROOMS ARE NOT REPLAYABLE HERE. A scenario's board is part of its
 * DEAL and lives in `server/scenarios.ts`, five batches of it, which would
 * land in `bundle.js` for a case that cannot arise: `history.ts` keeps scenario
 * rooms out of the game history, so neither entry point can reach one. The
 * route reports them; this refuses them by name rather than dealing a plain
 * board under a log written for a different one.
 */
import type { Action, CardName, Element, EngineEvent, GameMode, GameState, Seat } from '../engine/src/types.ts';
import { apply, createGame, hiddenSegment, IllegalAction } from '../engine/src/apply.ts';
import type { DraftDeal } from '../engine/src/draftdeal.ts';
import { escapesHold, redactLog, spectatorView, viewFor } from '../server/view.ts';
import { FakeSocket } from './fakesocket.ts';

/** The saved-game fields a replay needs. Every one optional but `seed` and
 * `actions`, because the file may be older than any of the others. */
export interface ReplayFile {
  seed: number;
  mode?: GameMode;
  els?: Element[];
  names?: [string, string];
  actions: Action[];
  decks?: [CardName[] | null, CardName[] | null];
  scenario?: string;
  custom?: { deal?: unknown } | null;
  winner?: number | null;
}

type SegKey = ReturnType<typeof hiddenSegment>;

/** Everything needed to resume the walk from action `at` without starting over. */
interface Checkpoint {
  at: number;
  state: GameState;
  /** how long `events` was — the array is truncated to this on a rewind */
  events: number;
  segKey: SegKey;
  segSnapshot: GameState | null;
  /** index into `events` at which the open segment's holdable events begin */
  segFrom: number;
}

/**
 * How often a checkpoint is taken.
 *
 * Stepping BACK one action means replaying from somewhere, and replaying from
 * zero every time is quadratic in the log — noticeable the moment somebody
 * holds the ◀ button down on a 300-action game. Every 25 actions bounds a step
 * back at 25 applies (well under a millisecond) for a handful of cloned states.
 */
const CHECKPOINT = 25;

export class ReplayServer {
  readonly file: ReplayFile;
  readonly names: [string, string];
  /** the seat whose view is served while `omniscient` is off */
  seat: Seat;
  /** both hands, the full log — what a live spectator gets */
  omniscient: boolean;
  /** called after every cursor move, so the control bar can repaint */
  onChange: (() => void) | null = null;

  private sock: FakeSocket | null = null;
  private state: GameState;
  private events: EngineEvent[] = [];
  /** which seat's action produced `events[i]` — the hold test needs it */
  private eventSeat: Seat[] = [];
  private segKey: SegKey = null;
  private segSnapshot: GameState | null = null;
  private segFrom = -1;
  private checkpoints: Checkpoint[] = [];
  private cursor = 0;
  /** the first action the engine refused, if the walk has reached one */
  private refusedAt: number | null = null;

  constructor(file: ReplayFile, seat: Seat, omniscient: boolean) {
    if (file.scenario) throw new Error('a scenario room cannot be replayed in the browser');
    this.file = file;
    this.names = file.names ?? ['Player 1', 'Player 2'];
    this.seat = seat;
    this.omniscient = omniscient;
    const r = createGame(
      file.seed, this.names, file.mode ?? 'shared', file.els,
      decksOf(file), file.custom?.deal as DraftDeal | undefined,
    );
    this.state = r.state;
    this.events = [...r.events];
    this.eventSeat = r.events.map(() => 0 as Seat);   // the deal belongs to nobody
    this.openSegment();
    this.snapshot();
  }

  /* ── where we are ──────────────────────────────────────────────────── */

  get total(): number { return this.file.actions.length; }
  get at(): number { return this.cursor; }
  get turn(): number { return this.state.turn; }
  /** the action that produced the board now on screen, if any */
  get lastAction(): Action | null { return this.cursor > 0 ? this.file.actions[this.cursor - 1] ?? null : null; }
  /** the first index the engine refused on the way here, if it refused one */
  get refused(): number | null { return this.refusedAt; }
  /** the turn each action landed in, for the scrubber's tick marks. Walked
   * once, lazily, because it costs a whole replay and most viewers never
   * scrub. */
  turnMarks(): number[] {
    if (this.marks) return this.marks;
    const probe = new ReplayServer(this.file, this.seat, true);
    const out: number[] = [];
    for (let i = 0; i < this.total; i++) { probe.seek(i + 1); out.push(probe.turn); }
    this.marks = out;
    return out;
  }
  private marks: number[] | null = null;

  /* ── moving ────────────────────────────────────────────────────────── */

  /**
   * Show the board after `n` actions. Forward is a walk; backward rewinds to
   * the nearest checkpoint at or before `n` and walks from there.
   */
  seek(n: number): void {
    const want = Math.max(0, Math.min(this.total, Math.floor(n)));
    if (want === this.cursor) { this.push(); return; }
    if (want < this.cursor) this.rewind(want);
    while (this.cursor < want) this.step();
    this.push();
  }

  step(): void {
    if (this.cursor >= this.total) return;
    const a = this.file.actions[this.cursor]!;
    const before = this.state;
    const holding = this.segKey !== null && hiddenSegment(before) === this.segKey;
    try {
      const r = apply(this.state, a);
      this.state = r.state;
      for (const e of r.events) { this.events.push(e); this.eventSeat.push(a.seat); }
      if (!holding) this.segFrom = this.events.length;   // nothing of this one is held
    } catch (err) {
      // The same tolerance rooms.ts's rebuild has, and for a sharper reason
      // here: the person watching is entitled to see everything up to the
      // point the record and this engine part company, and a throw would show
      // them nothing at all. `api-replay.ts` has already told the bar where
      // that point is.
      if (!(err instanceof IllegalAction)) throw err;
      if (this.refusedAt === null) this.refusedAt = this.cursor;
    }
    this.cursor++;
    const now = hiddenSegment(this.state);
    if (now !== this.segKey) this.openSegment();
    if (this.cursor % CHECKPOINT === 0) this.snapshot();
  }

  private rewind(to: number): void {
    let c = this.checkpoints[0]!;
    for (const k of this.checkpoints) if (k.at <= to) c = k;
    this.state = structuredClone(c.state);
    this.events.length = c.events;
    this.eventSeat.length = c.events;
    this.segKey = c.segKey;
    this.segSnapshot = c.segSnapshot ? structuredClone(c.segSnapshot) : null;
    this.segFrom = c.segFrom;
    this.cursor = c.at;
    // a refusal at or after where we are going has not happened yet
    if (this.refusedAt !== null && this.refusedAt >= to) this.refusedAt = null;
  }

  /** Close whatever segment was open and open the one the current state is in
   *  (which may be none) — rooms.ts's openSegment, minus the persistence. */
  private openSegment(): void {
    this.segKey = hiddenSegment(this.state);
    this.segSnapshot = this.segKey ? structuredClone(this.state) : null;
    this.segFrom = this.segKey ? this.events.length : -1;
  }

  private snapshot(): void {
    if (this.checkpoints.some(k => k.at === this.cursor)) return;
    this.checkpoints.push({
      at: this.cursor,
      state: structuredClone(this.state),
      events: this.events.length,
      segKey: this.segKey,
      segSnapshot: this.segSnapshot ? structuredClone(this.segSnapshot) : null,
      segFrom: this.segFrom,
    });
    this.checkpoints.sort((x, y) => x.at - y.at);
  }

  /* ── what the page is shown ────────────────────────────────────────── */

  view(): GameState {
    return this.omniscient ? spectatorView(this.state) : viewFor(this.state, this.seat, this.segSnapshot);
  }

  /**
   * The log this viewer may read.
   *
   * Omniscient is every line, as the live spectator feed is. From a seat it is
   * the redacted log MINUS the opponent's lines inside the open hidden segment
   * — the same events `rooms.ts` parks in `heldEvents` and reveals at the
   * barrier. Without that subtraction a replay of your own game would narrate,
   * in the log, the deployment you could not see while you were making yours.
   */
  log(): string[] {
    if (this.omniscient) return this.events.filter(e => e.msg).map(e => e.msg!);
    const mine = this.seat;
    const visible = this.events.filter((e, i) => {
      if (this.segFrom < 0 || i < this.segFrom) return true;
      if (this.eventSeat[i] === mine) return true;
      return escapesHold(e);      // R235: a reveal is public immediately
    });
    return redactLog(visible, mine, this.names);
  }

  /* ── the socket ────────────────────────────────────────────────────── */

  socket(): FakeSocket {
    this.sock = new FakeSocket(this);
    return this.sock;
  }

  /** Client frames. A replay answers `watch` and `join` with the same board and
   * ignores everything else: there is nothing to act on, and `spectating` on
   * the NetBackend means the client offers no affordance that would send one. */
  receive(data: string): void {
    let m: { t?: string };
    try { m = JSON.parse(data) as { t?: string }; } catch { return; }
    if (m.t === 'watch' || m.t === 'join') this.push();
  }

  push(): void {
    this.sock?.deliver({
      t: 'watching',
      room: 'REPLAY',
      view: this.view() as unknown as Record<string, unknown>,
      log: this.log(),
      names: this.names,
      peers: [true, true],
      watchers: 0,
    });
    this.onChange?.();
  }
}

/** constructed decks off the file, in the shape createGame wants */
function decksOf(file: ReplayFile): [CardName[], CardName[]] | undefined {
  if (file.mode !== 'constructed') return undefined;
  const a = file.decks?.[0];
  const b = file.decks?.[1];
  return a && b ? [a, b] : undefined;
}
