/* R297 — SOLO PLAY IN THE BROWSER: A ROOM WITH NO SERVER.
 *
 * Learn to Play is one learner against the Tutorial Bot, and the owner wants
 * the bot's hand hidden. The client already knows how to draw a game whose
 * other half is hidden — that is the whole NET path (NetBackend in main.ts):
 * redacted views, a frozen opponent inside the simultaneous steps, the reveal
 * at each barrier, paced opponent updates. So the tutorial does not get a
 * second renderer. It gets a second SERVER, small enough to run in the page,
 * that speaks the same messages over a socket-shaped object, and NetBackend
 * cannot tell the difference.
 *
 * What it reuses, rather than restates, from the real server:
 *   · `viewFor`, `redactEvent`, `visibleToSeat`, `redactLog` — the redactor
 *   · `escapesHold`, `legalForSeat` — the hidden-segment rules (moved from
 *     server/rooms.ts to server/view.ts so both halves read one copy)
 *   · `hiddenSegment` — the segment key
 *
 * ⚠ ONE THING IT DOES DIFFERENTLY, ON PURPOSE. The server checks for a
 * segment boundary once per TICK, after the whole tick (the player's action,
 * forced drains, the scripted opponent) has run. Its scripted opponent only
 * ever passes, so that never mattered. This bot PLAYS: on the tick that opens
 * a deployment it immediately casts, and a snapshot taken after the tick would
 * already hold its unit — the freeze would show the learner exactly what it
 * exists to hide. So the boundary is checked after EVERY applied action.
 *
 * Deterministic end to end (the bot is, the engine is), so a saved game is
 * just its deal plus its action log, and undo is "replay without the last
 * learner action".
 *
 * The socket itself is `ui/fakesocket.ts` — it stopped being solo's the moment
 * BL-38's replay viewer needed the same seam.
 *
 * No DOM here. Messages cross on MICROTASKS, not timers: a background tab
 * throttles timers to once a second or slower, and every bot answer is several
 * hops — a long stack resolved with the tab in the background crawled to what
 * looked like a bot that had stopped passing (first playtest).
 */
import type { Action, CardName, EngineEvent, GameState, Seat } from '../engine/src/types.ts';
import { Harness } from '../engine/src/harness.ts';
import { forcedAction, hiddenSegment, IllegalAction } from '../engine/src/apply.ts';
import type { LessonDeal } from '../engine/src/lessondeal.ts';
import { escapesHold, legalForSeat, redactEvent, redactLog, viewFor, visibleToSeat } from '../server/view.ts';
import { fallbackMove, type BotPolicy } from './bot.ts';
// the socket half moved out when BL-38's replay viewer became its second user
import { FakeSocket } from './fakesocket.ts';

export const LEARNER: Seat = 0;
export const BOT: Seat = 1;

/** Everything needed to deal the game again. */
export interface SoloDeal {
  seed: number;
  names: [string, string];
  decks: [CardName[], CardName[]];
  lesson: LessonDeal;
}

/** who took each logged action: the Learner, the Bot, or a Forced step */
export type ActedBy = 'L' | 'B' | 'F';

export interface SoloSave {
  v: 1;
  deal: SoloDeal;
  actions: Action[];
  by: ActedBy[];
}

type SegKey = ReturnType<typeof hiddenSegment>;

export interface SoloHooks {
  /** after every change the learner is told about (a save point) */
  onChange?: (server: SoloServer) => void;
  /** the bot was refused or looped — a bug worth surfacing, never a hang */
  onBotStuck?: (why: string) => void;
}

export class SoloServer {
  readonly deal: SoloDeal;
  readonly policy: BotPolicy;
  private hooks: SoloHooks;
  private h!: Harness;
  private by: ActedBy[] = [];
  private segKey: SegKey = null;
  private segSnapshot: GameState | null = null;
  /** the bot's events inside the open hidden segment, parked for the reveal */
  private held: EngineEvent[] = [];
  /** events applied since the learner was last told */
  private fresh: EngineEvent[] = [];
  /** bot events a closed segment released since the learner was last told */
  private revealed: EngineEvent[] = [];
  private revealStep: SegKey = null;
  private sock: FakeSocket | null = null;
  /** BL-18: the learner's full-control switch, off the join and 'fullcontrol'
   * messages exactly as the server keeps it — while on, nothing here answers a
   * forced step that is the learner's. The bot's own forced steps still drain. */
  private fullControl = false;

  constructor(deal: SoloDeal, policy: BotPolicy, save?: Pick<SoloSave, 'actions' | 'by'>, hooks: SoloHooks = {}) {
    this.deal = deal;
    this.policy = policy;
    this.hooks = hooks;
    this.rebuild(save?.actions ?? [], save?.by ?? []);
  }

  // ── the game ────────────────────────────────────────────────────────

  get state(): GameState { return this.h.state; }
  get events(): readonly EngineEvent[] { return this.h.events; }
  get save(): SoloSave {
    return { v: 1, deal: this.deal, actions: [...this.h.actions], by: [...this.by] };
  }

  /** Deal afresh and replay `actions`, then let the bot catch up. */
  private rebuild(actions: Action[], by: ActedBy[]): void {
    const d = this.deal;
    this.h = new Harness(d.seed, d.names, 'constructed', undefined, d.decks, undefined, d.lesson);
    this.by = [];
    this.openSegment();
    for (const [i, a] of actions.entries()) {
      try { this.applyOne(a, by[i] ?? (a.seat === BOT ? 'B' : 'L')); } catch { break; }
    }
    this.settle();
    this.fresh = []; this.revealed = []; this.revealStep = null;
  }

  private openSegment(): void {
    this.segKey = hiddenSegment(this.h.state);
    this.segSnapshot = this.segKey ? structuredClone(this.h.state) : null;
    this.held = [];
  }

  /** One action, with the room's hold-and-reveal bookkeeping around it. */
  private applyOne(a: Action, who: ActedBy): void {
    const holding = this.segKey !== null && hiddenSegment(this.h.state) === this.segKey;
    const evs = this.h.do(a);   // throws IllegalAction, state untouched
    this.by.push(who);
    this.fresh.push(...evs);
    if (holding && a.seat === BOT) this.held.push(...evs.filter(e => !escapesHold(e)));
    const now = hiddenSegment(this.h.state);
    if (now !== this.segKey) {
      if (this.segKey && this.held.length) { this.revealed.push(...this.held); this.revealStep = this.segKey; }
      this.openSegment();
    }
  }

  /** a forced step nobody has told us not to take for its seat */
  private forced(): Action | null {
    const f = forcedAction(this.h.state);
    return f && !(f.seat === LEARNER && this.fullControl) ? f : null;
  }

  /** Forced steps only (either seat's empty-board declarations). */
  private drainForced(): void {
    for (let guard = 0; guard < 16; guard++) {
      const f = this.forced();
      if (!f) return;
      this.applyOne(f, 'F');
    }
  }

  private tryBot(a: Action): boolean {
    try { this.applyOne(a, 'B'); return true; } catch { return false; }
  }

  /** Forced steps and the bot, until neither has anything to do. */
  private settle(): number {
    let moves = 0;
    for (let guard = 0; guard < 400; guard++) {
      if (this.h.state.phase === 'gameover') return moves;
      const f = this.forced();
      if (f) { this.applyOne(f, 'F'); moves++; continue; }
      const legal = legalForSeat(this.h.state, BOT);
      if (!legal.length) return moves;
      const a = this.policy.choose(this.h.state, BOT, legal);
      if (!a) return moves;
      if (this.tryBot(a)) { moves++; continue; }
      // ⚠ NEVER LEAVE THE GAME WITH NOBODY TO MOVE. The bot moves only inside
      // a learner's tick, so a refused bot move with nothing else tried is a
      // board the learner waits on forever. Report it, then fall back: the
      // most passive move, then anything the engine will take.
      this.hooks.onBotStuck?.(`${a.type} was refused`);
      const rest = [fallbackMove(legal), ...legal].filter((x): x is Action => !!x && x !== a);
      if (rest.some(x => this.tryBot(x))) { moves++; continue; }
      return moves;
    }
    this.hooks.onBotStuck?.('the bot hit its step cap');
    return moves;
  }

  // ── what the learner is shown ───────────────────────────────────────

  /** the learner's redacted view, the bot's half frozen inside a hidden step */
  view(): GameState { return viewFor(this.h.state, LEARNER, this.segSnapshot); }
  legal(): Action[] { return legalForSeat(this.h.state, LEARNER); }

  /** the whole log the learner may read (the open segment's bot lines held back) */
  log(): string[] {
    const held = new Set(this.held);
    return redactLog(this.h.events.filter(e => !held.has(e)), LEARNER, this.deal.names);
  }

  private redact(evs: EngineEvent[]): EngineEvent[] {
    return evs.filter(e => visibleToSeat(e, LEARNER)).map(e => redactEvent(e, LEARNER, this.deal.names));
  }

  /** Everything since the last push, as one 'update' — or null if nothing
   * happened and `always` is not set. (An action that emits no line still moves
   * the state — a pass hands priority on — so the actor is always answered, as
   * the server always answers.) */
  private takeUpdate(always = false): Record<string, unknown> | null {
    if (!always && !this.fresh.length && !this.revealed.length) return null;
    const held = new Set(this.held);
    const revealed = new Set(this.revealed);
    const tail = this.fresh.filter(e => !held.has(e) && !revealed.has(e));
    const msg: Record<string, unknown> = {
      t: 'update', view: this.view(), legal: this.legal(), peers: [true, true],
      events: this.redact([...this.revealed, ...tail]),
      ...(this.revealed.length ? { reveal: this.redact(this.revealed), step: this.revealStep } : {}),
    };
    this.fresh = []; this.revealed = []; this.revealStep = null;
    return msg;
  }

  // ── the wire ────────────────────────────────────────────────────────

  /** A socket-shaped object NetBackend can use in place of a WebSocket. */
  socket(): FakeSocket {
    this.sock = new FakeSocket(this);
    return this.sock;
  }

  /** a message from the client (the NetBackend protocol's client half) */
  receive(raw: string): void {
    let m: { t?: string; action?: Action; on?: unknown };
    try { m = JSON.parse(raw) as typeof m; } catch { return; }
    if (m.t === 'join' || m.t === 'fullcontrol') this.fullControl = m.on === true;
    if (m.t === 'fullcontrol') return;
    if (m.t === 'join') {
      this.settle();
      this.fresh = []; this.revealed = []; this.revealStep = null;
      this.push({
        t: 'joined', seat: LEARNER, view: this.view(), log: this.log(), legal: this.legal(),
        peers: [true, true], names: this.deal.names,
      });
      return;
    }
    if (m.t === 'action' && m.action) return this.act(m.action);
    if (m.t === 'undo') return this.undo();
    // building / lobby / rematch: nothing to relay to a bot
  }

  /** The learner acts; they are told, then the bot answers in its own push —
   * so its moves reach the client as the OPPONENT's update and are paced. */
  act(a: Action): void {
    if (a.seat !== LEARNER) return this.push({ t: 'error', msg: `you are seat ${LEARNER}, not seat ${a.seat}` });
    try {
      this.applyOne(a, 'L');
    } catch (err) {
      if (err instanceof IllegalAction) return this.push({ t: 'error', msg: err.message });
      throw err;
    }
    this.drainForced();
    this.push(this.takeUpdate(true)!);
    const moved = this.settle();
    const theirs = this.takeUpdate(moved > 0);
    if (theirs) this.push(theirs);
    this.hooks.onChange?.(this);
  }

  /** Take back the learner's most recent action, and everything after it. */
  undo(): void {
    const i = this.by.lastIndexOf('L');
    if (i < 0) return this.push({ t: 'error', msg: 'nothing of yours to undo' });
    this.rebuild(this.h.actions.slice(0, i), this.by.slice(0, i));
    this.push({ t: 'update', view: this.view(), legal: this.legal(), log: this.log(), peers: [true, true] });
    this.hooks.onChange?.(this);
  }

  /** Replay the game up to the moment turn `turn` began (the learner's
   * "rewind to the start of this turn" after a loss). */
  rewindToTurn(turn: number): void {
    const actions = this.h.actions, by = this.by;
    const probe = new Harness(this.deal.seed, this.deal.names, 'constructed', undefined, this.deal.decks, undefined, this.deal.lesson);
    let keep = 0;
    if (probe.state.turn < turn) {
      for (; keep < actions.length; keep++) {
        try { probe.do(actions[keep]!); } catch { break; }
        if (probe.state.turn >= turn) { keep++; break; }
      }
    }
    this.rebuild(actions.slice(0, keep), by.slice(0, keep));
    this.push({ t: 'update', view: this.view(), legal: this.legal(), log: this.log(), peers: [true, true] });
    this.hooks.onChange?.(this);
  }

  private push(msg: Record<string, unknown>): void { this.sock?.deliver(msg); }
}

