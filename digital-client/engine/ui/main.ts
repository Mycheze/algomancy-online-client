/* Hotseat UI over the pure engine — a dumb terminal (docs/04 §7).
 * Full re-render after every action; all game mutation goes through
 * Harness.do(action); pending decisions render as highlights or a prompt.
 * Both hands are visible: this is the M1 test rig, not the product. */
import { Harness } from '../src/harness.ts';
import { forcedAction, legalActions, IllegalAction, ALL_ELEMENTS } from '../src/apply.ts';
import { getCard, ELEMENT_OF_PIP } from '../src/cards/dsl.ts';
import {
  activatableUnits, activationBadge, activationNeedsConfirm, dismissSeenCard, dismissSeenHand,
  erasedPileView, groupReveal, linkCardNames,
  partitionOptions, playableCachedNames, seenHandView, shouldAutoYield, stackAbilityRows, stackItemX,
  stackXMark, tokensCreatedBy, unitClickOptions, waitingNote, watchCast,
} from './inspect.ts';
import type { CastWatch, FormationRole, SeenHandDismissals, UnitClickOption } from './inspect.ts';
import { halfRows, publishCols, rekeyBuild } from './formation.ts';
import { entityTextBox, printedTextBox, textBoxFor } from './cardtext.ts';
import type { AttrOrigin, CardTextBox, LineOrigin, StatBreakdown } from './cardtext.ts';
import { census, diffCensus, HIDDEN_CARD, nameKeys } from './motion.ts';
import { EXPANSION_GUIDE, glossaryHits, GLOSSARY, KEYWORDS } from './glossary.ts';
import type { GlossEntry } from './glossary.ts';
import type { Census } from './motion.ts';
import {
  captureFrame, clarityOn, clearArrows, initAnim, motionOn, playMotion,
  setBaseArrows, setHoverArrows, setMotionOn,
} from './anim.ts';
import type { ArrowSpec } from './anim.ts';
import { armsIdle, diffSfx, sfxSnap } from './sfx.ts';
import type { SfxSnap } from './sfx.ts';
import { censusFlashes, nextFlashWake, pruneFlashes, queueFlashes, stackCaption, stackRows } from './flash.ts';
import type { Flash } from './flash.ts';
import {
  armIdle, disarmIdle, playCue, primeAudio, setSoundOn, soundOn,
} from './audio.ts';
import { E } from '../src/engine.ts';
import type {
  Action, CachedCard, EngineEvent, Entity, EntityId, EventType, GameState, Seat, StackItem, TargetRef,
} from '../src/types.ts';
import * as acct from './account.ts';
import * as lob from './lobby.ts';
import * as pg from './postgame.ts';
import { elIcon as elIconOf, esc, shareBar } from './util.ts';

const ART = '../../../AlgomancyCards/';
const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

/** chess-clock snapshot the server attaches to every state broadcast (#6);
 * absent on an older server → the topbar clocks simply stay hidden.
 * rx = local Date.now() at receipt (fallback anchor when clocks are skewed). */
interface ClockSnap { ms: [number, number]; running: [boolean, boolean]; at: number }
let clockSnap: (ClockSnap & { rx: number }) | null = null;

/** minimal backend contract the UI renders against — Harness (hotseat) or NetBackend (remote) */
interface Backend { state: GameState; log: string[]; do(a: Action): void; }

/** Remote backend: sends intents over WS, renders from server-pushed redacted views.
 * The server is authoritative — do() never mutates local state; a server 'update'
 * (or 'joined') message replaces state/log/legal and re-renders. */
class NetBackend implements Backend {
  state: GameState = null as unknown as GameState;
  log: string[] = [];
  /** EventType per log line, index-aligned with `log` (log styling). Lines
   * that arrived as a bare full-log resync have no type and stay unstyled. */
  logTypes: (EventType | undefined)[] = [];
  seat: Seat = 0;
  room: string;
  legal: Action[] = [];
  peers: [boolean, boolean] = [false, false];
  joined = false;
  /** constructed lobby: non-null while the room waits for both decks */
  waiting: { have: [boolean, boolean]; trio?: lob.TrioLobby } | null = null;
  names: [string, string] = ['Player 1', 'Player 2'];
  /** set when the server hands this seat to a newer connection — stop rendering game UI */
  dead = false;
  /**
   * The formation the OPPONENT is building right now, before they commit it
   * (server/rooms.ts Room.building). The digital stand-in for watching someone
   * slide units into columns across the table — playtest ask, 2026-08-20.
   * Cleared by any real action, because the declaration supersedes it.
   */
  building: { cols: EntityId[][]; send: EntityId[] } | null = null;
  /** the last payload we sent, so a re-render does not re-send it */
  private sentBuilding = '';
  ws: WebSocket;
  private wantSeat: Seat | null;
  private mode?: string;
  private els?: string[];
  constructor(room: string, seat: Seat | null, mode?: string, els?: string[]) {
    if (seat != null) this.seat = seat;
    this.wantSeat = seat;
    this.mode = mode;
    this.els = els;
    this.room = room;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);
    this.ws.onopen = () => this.sendJoin();
    this.ws.onmessage = ev => this.onMsg(JSON.parse(String(ev.data)));
    this.ws.onclose = () => {
      if (this.dead) return;
      uiError = 'disconnected from server — refresh to reconnect';
      // unconditionally: a connection that failed BEFORE 'joined' routes to
      // renderConnecting, which is where the error and the way home live —
      // without this the user is stuck on "Connecting…" forever
      render();
    };
  }
  /** (re-)join — also called from the waiting screen once a deck is picked.
   * mode + trio only matter when this join creates the room; the selected
   * deck rides along on every join and the server uses it where it matters
   * (constructed room creation / a waiting seat). */
  sendJoin(): void {
    const name = (localStorage.getItem('algoName') ?? '').trim();
    const deck = savedDeck();
    this.ws.send(JSON.stringify({
      t: 'join', room: this.room, seat: this.wantSeat, name,
      // accounts: the session token binds this seat to an account server-side,
      // which is what makes the game count toward your stats
      ...(acct.token() ? { token: acct.token() } : {}),
      mode: this.mode, els: this.els, ...(deck ? { deck: deck.cards } : {}),
    }));
  }
  do(a: Action): void {
    // an intent is going out, whoever sent it — the auto-pass and auto-yield
    // paths call this directly, without act(), and must stop the idle
    // countdown too: the obligation it was counting down to is being consumed
    disarmIdle();
    this.sentBuilding = '';                       // a real action resets the relay
    this.ws.send(JSON.stringify({ t: 'action', action: a }));
  }
  /** publish the formation being built (no-op when nothing changed) */
  sendBuilding(cols: EntityId[][], send: EntityId[]): void {
    const payload = JSON.stringify({ t: 'building', cols, send });
    if (payload === this.sentBuilding || this.ws.readyState !== WebSocket.OPEN) return;
    this.sentBuilding = payload;
    this.ws.send(payload);
  }
  undo(): void { this.ws.send(JSON.stringify({ t: 'undo' })); }
  /** draft lobby: change the method, submit, lock or unlock (server/trio.ts) */
  lobby(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ t: 'lobby', ...msg }));
  }
  /** post-game: ask for (or take back) a rematch */
  rematch(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ t: 'rematch', ...msg }));
  }
  private onMsg(m: {
    t: string; seat?: Seat; view?: GameState; log?: string[]; legal?: Action[];
    events?: EngineEvent[]; reveal?: { msg: string }[]; peers?: [boolean, boolean]; msg?: string;
    /** which hidden segment a reveal closes (server/main.ts sendReveal) */
    step?: 'plan' | 'haste' | 'deploy';
    clock?: ClockSnap; waiting?: { have: [boolean, boolean]; trio?: lob.TrioLobby }; names?: [string, string];
    trio?: lob.TrioReveal;
    cols?: EntityId[][]; send?: EntityId[]; building?: { cols: EntityId[][]; send: EntityId[] } | null;
    me?: acct.Me;
    rematch?: [boolean, boolean];
  }): void {
    // the post-game screen: the whole payload on game over, then just the
    // rematch state as the two of you make up your minds
    if (m.t === 'gameover') {
      postGame = m as unknown as pg.GameOver;
      postGameHidden = false;
      if (m.me) acct.applyMe(m.me);
      render();
      return;
    }
    if (m.t === 'rematch') {
      if (postGame) {
        postGame = { ...postGame, rematch: m.rematch ?? postGame.rematch, rematchRoom: (m as { room?: string }).room ?? null };
        // both said yes: the server has already built the room
        if (postGame.rematchRoom) { pg.goToRematch(postGame.rematchRoom, postGame); return; }
        render();
      }
      return;
    }
    // accounts: the profile that rides along with a join (a game's end pushes
    // its profile + unlocks on the 'gameover' payload instead)
    if (m.t === 'me') { if (m.me) acct.applyMe(m.me); return; }
    // the opponent moved a unit into (or out of) a column they are still
    // building — presentation only, no state, no log
    if (m.t === 'building') {
      const cols = (m.cols ?? []).filter(c => c.length);
      this.building = cols.length || m.send?.length
        ? { cols: m.cols ?? [], send: m.send ?? [] } : null;
      render();
      return;
    }
    if (m.clock) clockSnap = { ...m.clock, rx: Date.now() };
    if (m.names) this.names = m.names;
    if (m.t === 'joined') {
      this.joined = true; this.seat = m.seat!;
      this.wantSeat = m.seat!;   // reconnect/deck-rejoin keeps this seat
      if (m.waiting) { this.waiting = m.waiting; this.peers = m.peers ?? [false, false]; uiError = ''; render(); return; }
      this.waiting = null;
      // the lobby just resolved: show what the trio is and how it got there
      if (m.trio) { pendingTrio = m.trio; lob.resetLobby(); }
      this.state = m.view!;
      this.building = m.building ?? null;   // reconnect mid-declaration
      this.log = m.log ?? []; this.logTypes = this.log.map(() => undefined);
      this.legal = m.legal ?? []; this.peers = m.peers ?? [false, false];
      resetUi();
      // R78: seed the cast watch AFTER resetUi has dropped the baselines, so
      // the first update after a join has something to diff against. Never
      // `quiet` — a join is not an action somebody just took.
      noteCast(this.state, this.seat, false);
      uiError = ''; render(); return;
    }
    if (m.t === 'update') {
      if (m.waiting) { this.waiting = m.waiting; this.peers = m.peers ?? this.peers; render(); return; }
      rememberStack();   // R68: before the new view replaces the negated item
      if (m.view) { this.state = m.view; this.building = null; }   // a real action supersedes
      if (m.log) { this.log = m.log; this.logTypes = m.log.map(() => undefined); }   // full resync (undo shrank it)
      if (m.events) {
        // a signal-only event ('stackFlash') is not a log line — same rule the
        // hotseat Harness and the server's redactLog follow, and the reason
        // logTypes can stay index-aligned with the log
        for (const e of m.events) {
          if (!e.msg) continue;
          this.log.push(e.msg);
          this.logTypes.push(e.type);
        }
      }
      if (m.legal) this.legal = m.legal;
      if (m.peers) this.peers = m.peers;
      // R78(b): a cast-time suspension is the ONE thing that changes the board
      // and says nothing at all. A full log resync (`m.log` — an undo replayed
      // the game) is a wholesale arrival, not an action, so it re-baselines.
      noteCast(this.state, this.seat, !m.log
        && !(m.events ?? []).some(e => e.msg) && !(m.reveal ?? []).some(e => e.msg));
      // segment-end reveal: what the opponent secretly did while their half of
      // the view was frozen. `step` names WHICH segment just closed: a 'plan'
      // close fires every single turn and its payload is resource-step lines,
      // so it lands as log lines and board motion only; 'haste' and 'deploy'
      // closes earn the interstitial when there's more than the bare "is done"
      // line. The state underneath applies normally — only the view is gated
      // behind the overlay's Continue button. Signal-only events ('stackFlash')
      // carry no line and are not part of the reveal.
      const told = m.reveal?.filter(ev => ev.msg) ?? [];
      // an older server sends no step, and the only reveal it ever sent was
      // the deploy one — so that is what a missing step means
      const step = m.step ?? 'deploy';
      if (step !== 'plan' && told.some(ev => !/is done deploying/i.test(ev.msg))) {
        pendingReveal = { step, msgs: told.map(ev => ev.msg) };
      }
      // The beats belong to the board, and behind the reveal overlay nobody is
      // looking at the board — so a reveal holds them until you close it. That
      // is also when they mean something: the reveal is the moment you find
      // out the opponent deployed anything at all.
      if (pendingReveal) heldFlashes.push(...(m.events ?? []));
      else absorbFlashes(m.events ?? []);
      render(); return;
    }
    if (m.t === 'kicked') {
      this.dead = true;
      $app.classList.remove('board');   // back to normal flow for the notice
      $app.innerHTML = `<div class="joinscreen"><h2>Algomancy</h2>
        <p>${esc(m.msg ?? 'another connection took over this seat')}</p>
        <button data-btn="gohome">home</button></div>`;
      return;
    }
    if (m.t === 'error') {
      ui.cancelling = false; uiError = m.msg ?? 'error'; playCue('error'); render(); return;
    }
  }
}

let NET: NetBackend | null = null;
let h: Backend = new Harness(Math.floor(Math.random() * 1e6));
let uiError = '';

/** the zones a mod (augment/graft) can be applied from — R41 added the cache */
type ModZone = 'hand' | 'bin' | 'cache';

interface UiState {
  carrying: EntityId | null;
  columns: EntityId[][];
  send: EntityId[];
  /** spell tokens riding along with the attack being built (C1) */
  spellTokens: EntityId[];
  /** R41: 'cache' is a third mod source — "you CAN augment or graft from
   * cache" (Caleb 2024-12-02) — so the in-progress mod has to name it too. */
  modding: { from: ModZone; index: number; seat: Seat; mode: 'augment' | 'graft' } | null;
  menu: { x: number; y: number; items: { label: string; icon?: string; go: () => void }[] } | null;
  orderPicked: number[];
  /** draft step: pile indices (into hand.concat(pack)) marked "leave in pack" */
  draftPack: number[] | null;
  /** which turn+seat draftPack was built for (re-init on change) */
  draftFor: string;
  /** keep passing my priority windows until the battle ends or something new
   * hits the stack (net mode only) */
  autopass: boolean;
  /** actionCount the last autopass was sent for (never double-send) */
  autopassAt: number;
  /** stack height when autopass was armed — growth disarms it */
  autopassStack: number;
  /** actionCount the auto-pass TOGGLE (C4) last sent a pass for */
  autopassPrefAt: number;
  /** #1: activateAbility keys that were already legal when Pass-all was armed —
   * a NEW key appearing (a resolution granted an ability) disarms the chip */
  autopassSig: string[];
  /** #2: actionCount the auto-yield-to-triggers pass was last sent for */
  yieldAt: number;
  /** #4: a chained cast-cancel is in progress (net: one undo per server state) */
  cancelling: boolean;
  /** actionCount the last cancel-chain undo was sent for */
  cancelAt: number;
  /** one-shot guard for the round-2 single-counterattacker prefill */
  prefillFor: string;
  /** "done planning" pressed with dormant resources + activations left: which
   * seat is being asked "are you sure?" */
  confirmDone: Seat | null;
  /** Pass pressed with castable spell tokens during battle (C5): which pass
   * button is being confirmed */
  confirmPass: 'pass' | 'passall' | null;
  /** playtest: "done deploying" pressed while cards in the cache are playable
   * RIGHT NOW — easy to forget a zone you are not used to watching. Holds the
   * seat being asked. */
  confirmDeploy: Seat | null;
  /** playtest: an irreversible activation (a "Sacrifice me:" cost) with NO
   * target decision to walk you back — held until confirmed. */
  confirmAct: { seat: Seat; entityId: EntityId; abilityIndex: number;
    via?: 'augment' | { mod: EntityId }; label: string; unit: string } | null;
  /** home screen: the draft trio being picked (persisted per browser) */
  homeEls: string[];
  /** home screen: the "fix the trio now" drawer is open. Held in state
   * because touching a chip re-renders the whole screen, which would
   * otherwise snap the drawer shut under the finger that opened it. */
  homeFixedTrio: boolean;
  /** constructed draw phase: hand indices picked to go to the bottom, in order */
  bottomPick: number[];
  /** which turn+seat bottomPick was built for (re-init on change) */
  bottomFor: string;
  /** R72/R75: the ATTACKING line as it stood at the last paint, so a collapse
   * or a left-insert can be spotted and `columns` — which is keyed by attack
   * column index — carried across it. Null outside my block step. */
  blockLine: EntityId[][] | null;
}
/** C(|ALL_ELEMENTS|, 3) — the number of live-draft trios the picker reaches.
 * Derived, never written down: adding an element to the engine moves it. */
const TRIO_COUNT = (n => (n * (n - 1) * (n - 2)) / 6)(ALL_ELEMENTS.length);
/** the persisted trio, filtered against the engine's element list so a stale
 * or hand-edited localStorage entry can never smuggle in a non-element */
const savedEls = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem('algoEls') ?? '') as string[];
    const clean = (Array.isArray(raw) ? raw : []).filter(el => (ALL_ELEMENTS as string[]).includes(el));
    return clean.length ? [...new Set(clean)].slice(0, 3) : ['fire', 'water', 'earth'];
  } catch { return ['fire', 'water', 'earth']; }
};
const freshUi = (): UiState => ({
  carrying: null, columns: [], send: [], spellTokens: [], modding: null, menu: null, orderPicked: [],
  draftPack: null, draftFor: '', autopass: false, autopassAt: -1, autopassStack: 0,
  autopassPrefAt: -1, autopassSig: [], yieldAt: -1, cancelling: false, cancelAt: -1,
  prefillFor: '', confirmDone: null, confirmPass: null, homeEls: savedEls(),
  homeFixedTrio: false,
  confirmDeploy: null, confirmAct: null,
  bottomPick: [], bottomFor: '', blockLine: null,
});

// ── constructed decks (algomancer.cc format, docs: server/decks.ts) ────

/** the deck this browser will bring to constructed games (persisted) */
interface SavedDeck { name: string; author: string; url?: string; cards: string[] }
const savedDeck = (): SavedDeck | null => {
  try {
    const d = JSON.parse(localStorage.getItem('algoDeck') ?? '') as SavedDeck;
    return Array.isArray(d.cards) && d.cards.length ? d : null;
  } catch { return null; }
};
const saveDeck = (d: SavedDeck): void => {
  localStorage.setItem('algoDeck', JSON.stringify({ name: d.name, author: d.author, url: d.url, cards: d.cards }));
};
/** the bundled default decks — fetched once from the server */
let defaultDeckList: SavedDeck[] | null = null;
let defaultDecksLoading = false;
/** import status / problems shown under the deck picker */
let deckMsg = '';
function ensureDefaultDecks(then: () => void): void {
  if (defaultDeckList || defaultDecksLoading) return;
  defaultDecksLoading = true;
  fetch('/api/deck/defaults').then(r => r.json()).then((r: { decks: (SavedDeck & { problems: string[] })[] }) => {
    defaultDeckList = r.decks.filter(d => !d.problems.length);
    then();
  }).catch(() => { deckMsg = 'could not load the default decks from the server'; then(); });
}
let ui: UiState = freshUi();
/** segment-end reveal waiting behind the interstitial (C2) — which hidden
 * segment closed (it titles the overlay) and the messages to show */
let pendingReveal: { step: 'haste' | 'deploy'; msgs: string[] } | null = null;
/** the trio the lobby just settled on, waiting behind its own interstitial —
 * the first thing you see when the cards are dealt is how they were chosen */
let pendingTrio: lob.TrioReveal | null = null;
/** the finished game's post-game screen (server payload), and whether it has
 * been dismissed to look at the final board */
let postGame: pg.GameOver | null = null;
let postGameHidden = false;
const resetUi = () => {
  ui = freshUi();
  pendingReveal = null;
  postGame = null;
  postGameHidden = false;
  snaps = [];
  // module-level view state survives a hotseat "New game" unless dropped here
  // — a concede dialog opened pre-restart could otherwise end the new game
  concedeAsk = null;
  binView = null;
  cacheView = null;
  erasedView = null;
  helpOpen = false;
  judgeOpen = false;
  inspect = null;
  showSpentCache = new Set();
  dropBaselines();
};

/** Drop every "what was on screen before" baseline — motion, sound, flash
 * beats. Called wherever the next paint is NOT the previous board plus one
 * action: a reset, the connecting screen, home, the lobby. clockSnap is
 * deliberately NOT dropped here: the 'joined' message sets it BEFORE resetUi
 * runs, so clearing it would wipe the very snapshot that just arrived. */
function dropBaselines(): void {
  motionReset();
  sfxReset();
  flashReset();
}

// ── the visual stack's flash queue (ui/flash.ts) ──────────────────────
//
// Items that resolve with no response window never touch state.stack, so the
// board could never show them there. The engine announces each one as a silent
// 'stackFlash' event; the queue below decides when each gets its beat, and
// stackBoardHtml draws them alongside whatever is really on the stack.

/** items having (or waiting for) their beat on the visual stack */
let flashQueue: Flash[] = [];
/**
 * R68: what the client last drew on the stack, by item id.
 *
 * Negating REMOVES an item now (docs/digital-rules R68) and the 'negated'
 * event carries only its id — the engine's own copy is detached and dropped.
 * So the beat that shows a player their spell was answered has to be drawn
 * from a snapshot this client kept while the item was still on screen.
 *
 * Merged rather than replaced, and cleared with the queue, because a beat can
 * be held behind the deploy reveal for a while before it is played. Stack ids
 * are monotonic within a game and never reused, so a stale entry can only ever
 * be unused, never wrong; the cap keeps a long game bounded.
 */
let seenStack = new Map<number, StackItem>();
const SEEN_STACK_CAP = 240;

/** Remember the stack as it stands RIGHT NOW — called immediately before any
 * state change, which is the last moment the about-to-be-negated item exists.
 * Cloned, so the snapshot cannot be edited underneath the beat (the same
 * discipline engine.ts uses for its own 'stackFlash' payloads). */
function rememberStack(): void {
  const stack = h?.state?.stack;
  if (!stack?.length) return;
  for (const it of stack) if (!seenStack.has(it.id)) seenStack.set(it.id, structuredClone(it));
  while (seenStack.size > SEEN_STACK_CAP) {
    seenStack.delete(seenStack.keys().next().value!);   // oldest id first
  }
}
/**
 * R78: the "a card has left their hand and has not appeared" watch.
 *
 * A CAST-time suspension (X, {Modular} mods, a bracketed cost, R67 targets)
 * happens before the item reaches state.stack, and view.ts nulls the other
 * seat's suspension along with their decision — so `resolving` cannot help and
 * there is no `casting` field to read. ui/inspect.ts watchCast() infers it from
 * public counts alone and re-baselines rather than guess whenever it cannot;
 * this is only where the fold lives across updates. Net mode only: hotseat
 * shows both seats' everything and has no wait banner to explain.
 */
let castWatch: CastWatch | null = null;

/** Fold one arriving view into the cast watch. `quiet` — the update carried no
 * log line — is the honesty gate; see ui/inspect.ts watchCast. */
function noteCast(state: GameState, mySeat: Seat, quiet: boolean): void {
  castWatch = watchCast(castWatch, state, other(mySeat), quiet);
}

/** beats parked behind the deploy-end reveal overlay (see NetBackend.onMsg) */
let heldFlashes: EngineEvent[] = [];
/** the pending repaint that ends the current beat */
let flashTimer: ReturnType<typeof setTimeout> | null = null;

/** Drop the queue. Called wherever motionReset() is, and for the same reason:
 * a state that arrives WHOLESALE (a fresh join, a resync, an undo's replay) is
 * not something somebody just did, and must not replay old beats. */
function flashReset(): void {
  flashQueue = [];
  heldFlashes = [];
  seenStack = new Map();
  // R78: and the cast watch with them. It is a DIFF against the last thing you
  // were shown, so a state that arrives wholesale gives it nothing to diff —
  // and a stale baseline would read a fresh join's hand as a card in flight.
  castWatch = null;
  if (flashTimer !== null) { clearTimeout(flashTimer); flashTimer = null; }
}

/** the reveal overlay closed — play the beats it was standing in front of */
function releaseHeldFlashes(): void {
  if (!heldFlashes.length) return;
  const held = heldFlashes;
  heldFlashes = [];
  absorbFlashes(held);
}

/** Fold one action's events into the queue. Gated on clarityOn() rather than
 * motionOn(): a beat is the only chance to SEE an unrespondable effect, so
 * prefers-reduced-motion must not silently delete it — an explicit
 * "motion: off" does. */
function absorbFlashes(events: readonly EngineEvent[]): void {
  if (!clarityOn()) return;
  flashQueue = queueFlashes(flashQueue, events, Date.now(), seenStack);
}

/** Book the repaint that starts the next beat (or ends the last one). */
function scheduleFlashWake(): void {
  if (flashTimer !== null) { clearTimeout(flashTimer); flashTimer = null; }
  const now = Date.now();
  flashQueue = pruneFlashes(flashQueue, now);
  const at = nextFlashWake(flashQueue, now);
  if (at === null) return;
  flashTimer = setTimeout(() => { flashTimer = null; render(); }, Math.max(16, at - now));
}

/**
 * Park the floating stack window beside the table.
 *
 * Playtest 2026-08-21: "it's too far in the middle… it should be its own
 * little window thingy, floating in space, sorta between where the bins are."
 * The bins sit at the right edge of each region panel, so the window rides the
 * right edge of the table column, halfway between them.
 *
 * It is `position: fixed` against MEASURED edges rather than arithmetic on the
 * grid, because the app is max-width'd and centred, the rail has its own
 * width, and net mode adds a hand dock under the table — three numbers that
 * would all have to be kept in sync by hand. The table's box does not move
 * when it scrolls, so this only has to run on paint and on resize.
 */
function placeStackWindow(): void {
  const main = document.querySelector('.main');
  if (!main) return;
  const r = main.getBoundingClientRect();
  // Halfway down the table you can actually SEE — the sticky prompt sits over
  // the top of `.main`, so its own box centre reads high, and the two bins the
  // window is meant to sit between are further down than that.
  const capped = document.querySelector('.stickytop')?.getBoundingClientRect().bottom ?? r.top;
  const top = Math.max(r.top, Math.min(capped, r.bottom));
  $app.style.setProperty('--table-right', `${Math.max(0, innerWidth - r.right)}px`);
  $app.style.setProperty('--table-mid', `${(top + r.bottom) / 2}px`);
}
addEventListener('resize', placeStackWindow);

/** the rows on the visual stack right now: the real stack, then the beats,
 * then (R78) whatever is mid-resolution — off the rules stack, still happening */
const visualStack = (): ReturnType<typeof stackRows> =>
  stackRows(h.state.stack, flashQueue, Date.now(), h.state.resolving ?? null);

/** A stack item by id, flashed ones included — the focus viewer, the arrows
 * and the target labels all address items by id and must not go blank the
 * moment an item's beat is the only reason it is on screen. */
function stackItemById(id: number): StackItem | undefined {
  return h.state.stack.find(i => i.id === id)
    ?? visualStack().find(r => r.item.id === id)?.item;
}

const $app = document.getElementById('app')!;
/** art path for a card: the registry's per-card image when it has one
 * (fixes e.g. 'Unit Token' → 'Generic-Unit.jpg'), else derived from the name
 * (resource faces and other non-registry art) */
const art = (name: string): string => {
  try {
    const img = getCard(name).image;
    if (img) return ART + img;
  } catch { /* not a registry card (resource faces etc.) — fall through */ }
  return ART + name.replace(/ /g, '-') + '.jpg';
};
/** the game's REAL icon (element pip, cost circle, marker) as an inline img —
 * alt = the name, because the topbar shows the icon with no word beside it */
const elIcon = (name: string): string => elIconOf(name, name);

// ── card-text icons (ported from the RAG front-end's token mapping) ────
/** [..] / {..} keywords that have a real icon (Icons/<name>.webp) */
const TEXT_ICON: Record<string, string> = {
  augment: 'augment', switch1: 'bounded_graft', switch: 'graft',
  virus: 'virus', battle: 'battle', haste: 'haste', once: 'once',
};
/** amounts are spelled out on the cards ([one], [x]); three_blue is Lurking
 * Slimebeast's amount+resource-in-one-word special */
const COST_WORD: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', x: 'x', three_blue: '3b',
};
/** cost letters → faction icon; 'p' (prismite/colorless) has NO icon — left as
 * text. Taken straight from the engine (l = light, d = dark) so a new element
 * can never leave the UI with a stale copy of the pip table. */
const PIP_EL: Record<string, string> = ELEMENT_OF_PIP;
/** the same pip letters as a character class, for the [4bb]-style cost token */
const COST_TOKEN_RE = new RegExp(`^[0-9]*[${Object.keys(PIP_EL).join('')}]+$`);
/** a text-line game icon; if the file is missing it degrades to `fallback` */
const txtIcon = (name: string, fallback: string): string =>
  `<img class="txticon" src="/Icons/${name}.webp" alt="${fallback}" onerror="this.outerHTML=this.alt">`;
/** Swap game tokens in card text / prose ([Switch1], {Battle}, [one], [4bb], …)
 * for the real icons. Escapes FIRST — always feed it RAW text, never pre-escaped
 * HTML. Unknown [tokens] stay bracketed; unknown {attrs} bare their word;
 * {/n}/{i}/{/i} formatting tokens become markup. */
function iconizeText(raw: string): string {
  return esc(raw).replace(/\[([^\[\]]+)\]|\{([^{}]+)\}/g, (tok, br?: string, bc?: string) => {
    if (br !== undefined) {
      const body = br.toLowerCase();
      const icon = TEXT_ICON[body];
      if (icon) return txtIcon(icon, tok);          // fallback KEEPS the brackets
      const cost = COST_WORD[body] ?? (COST_TOKEN_RE.test(body) ? body : undefined);
      if (cost !== undefined) {
        return [...cost].map(c => {
          const el = PIP_EL[c];
          return el ? txtIcon(el, c) : txtIcon(`cost_${c}`, c);
        }).join('');
      }
      return tok;                                    // unknown [token]: untouched
    }
    const body = bc!.toLowerCase();
    if (body === '/n') return '<br>';
    if (body === 'i' || body === 'i1') return '<i>';
    if (body === '/i') return '</i>';
    const icon = TEXT_ICON[body];
    if (icon) return txtIcon(icon, bc!);             // fallback bares the word
    return bc!;                                      // {Swift} → Swift
  });
}
const q = () => new E(h.state);

// ── R41: the cache zone ───────────────────────────────────────────────
/** `seat`'s cache. The field is optional/additive (older saves have none), so
 * it is always read through the engine query rather than off PlayerState. */
const cacheOf = (seat: Seat): CachedCard[] => q().cache(seat);
/** the card name at `index` of `seat`'s `zone` — the cache holds ENTRIES, not
 * bare names, so every cross-zone read goes through here */
function zoneCardName(seat: Seat, zone: ModZone, index: number): string | undefined {
  if (zone === 'cache') return cacheOf(seat)[index]?.card;
  return h.state.players[seat]![zone][index];
}
/** human name of a mod source zone, for prompts */
const zoneLabel = (z: ModZone): string => (z === 'bin' ? 'the bin' : z === 'cache' ? 'the cache' : 'hand');

/** #4 hotseat undo snapshots: one per local act() call, taken BEFORE the
 * action — cancelling a cast restores the snapshot from before the chain's
 * originating action (structuredClone; capped, chains are short) */
let snaps: { state: GameState; logLen: number; actionsLen: number }[] = [];

function act(a: Action): void {
  // you are demonstrably at the keyboard — stop counting down to the thump.
  // The next obligation to ARRIVE re-arms it (soundPass).
  disarmIdle();
  if (NET) {
    // network mode: the server is authoritative — send the intent and wait for
    // the pushed redacted update (or an 'error' message). Never apply locally.
    if (a.seat !== NET.seat) { uiError = 'not your seat'; playCue('error'); return; }
    NET.do(a);
    uiError = '';
    return;
  }
  snaps.push({ state: structuredClone(h.state), logLen: h.log.length, actionsLen: (h as Harness).actions.length });
  if (snaps.length > 60) snaps.shift();
  const local = h as Harness;   // past the NET guard above, h is the Harness
  try {
    // R68: the last moment an item that is about to be negated still exists
    rememberStack();
    absorbFlashes(local.do(a));
    // local mode: drain forced steps (empty boards attack/block by themselves;
    // the server does the same for network games)
    for (let g = 0; g < 8; g++) {
      const f = forcedAction(h.state);
      if (!f) break;
      rememberStack();
      absorbFlashes(local.do(f));
    }
    uiError = '';
  } catch (err) {
    snaps.pop();   // state unchanged — drop the pre-action snapshot
    if (err instanceof IllegalAction) { uiError = err.message; playCue('error'); }
    else throw err;
  }
}

// ── #4: always-cancelable casting ─────────────────────────────────────
/** The pending decision belongs to a PRE-COMMIT cast chain of the viewer's
 * own (X / cast cost / target stages before the item reaches the stack, plus
 * pre-resolve haste/deploy casts). While it is pending nobody else can act,
 * so unwinding the chain (the originating play/cast/activate action and the
 * decide answers so far) takes nothing away from the opponent. Trigger
 * targeting (kind 'triggered') is mandatory — never cancelable. */
function cancelableCast(): boolean {
  const s = h.state;
  const sus = s.suspension, dec = s.decision;
  if (!dec || !sus || sus.type !== 'cast') return false;
  if (sus.item.kind === 'triggered') return false;
  const seat = NET ? NET.seat : dec.seat;
  return dec.seat === seat && sus.item.controller === seat;
}
/** hotseat: the snapshot window still covers the chain's originating action */
function hotseatCancelIndex(): number {
  const H = h as Harness;
  let i = snaps.length - 1;
  while (i > 0 && H.actions[snaps[i]!.actionsLen]?.type === 'decide') i--;
  const a = snaps[i] ? H.actions[snaps[i]!.actionsLen] : undefined;
  return a && a.type !== 'decide' ? i : -1;
}
function canCancelNow(): boolean {
  if (!cancelableCast()) return false;
  // net mode always rewinds via the server undo (it verifies the same
  // predicate); hotseat needs a snapshot that still covers the chain
  return !!NET || hotseatCancelIndex() >= 0;
}
function startCastCancel(): void {
  if (!canCancelNow()) return;
  if (!NET) {
    const i = hotseatCancelIndex();
    const snap = snaps[i]!;
    h.state = snap.state;
    h.log.length = snap.logLen;
    // logTypes is index-aligned with log (src/harness.ts) — truncate both, or
    // every later line's styling is off by the unwound lines forever
    (h as Harness).logTypes.length = snap.logLen;
    (h as Harness).actions.length = snap.actionsLen;
    snaps.length = i;
    uiError = '';
    return;
  }
  // net: the server undoes ONE of my actions per message — chain them until
  // the whole pre-commit cast is unwound (maybeCancelChain drives the rest)
  ui.cancelling = true;
  ui.cancelAt = h.state.actionCount;
  NET.undo();
}
/** one follow-up undo per received server state while a cast-cancel runs */
function maybeCancelChain(): void {
  if (!NET || !ui.cancelling) return;
  if (!cancelableCast()) { ui.cancelling = false; return; }
  if (h.state.actionCount === ui.cancelAt) return;   // still waiting on the last undo
  ui.cancelAt = h.state.actionCount;
  NET.undo();
}
/** the ✕ Cancel button for the current pre-commit cast decision, if any */
function castCancelBtnHtml(): string {
  if (!cancelableCast()) return '';
  if (!NET) {
    return hotseatCancelIndex() >= 0
      ? `<button data-btn="castcancel" title="take back the whole cast — nothing has resolved yet">✕ Cancel (esc)</button>` : '';
  }
  return `<button data-btn="castcancel" title="takes back your own pending cast via the server undo — your opponent cannot have acted while this decision was open">✕ Cancel (esc)</button>`;
}

// ── decision helpers ──────────────────────────────────────────────────
function decisionOptionIndex(ref: TargetRef): number {
  const dec = h.state.decision;
  if (!dec || dec.kind !== 'targets') return -1;
  return dec.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify(ref));
}
const isCandidate = (ref: TargetRef) => decisionOptionIndex(ref) >= 0;

/** #3: when a decision option refers to a LIVE entity, its button/card pings
 * that unit on the board on hover (data-ping) and feeds the focus preview
 * (data-previd). Options without a live entity degrade to nothing. */
function pingAttrs(o: { value: unknown }): string {
  const v = o.value;
  let id: EntityId | null = null;
  if (v !== null && typeof v === 'object' && 'unit' in (v as object)) id = (v as { unit: EntityId }).unit;
  // electricPath options carry the raw entity id (other kinds use numbers for
  // non-entity payloads like X amounts — never ping those)
  else if (typeof v === 'number' && h.state.decision?.kind === 'electricPath') id = v;
  if (id === null || !h.state.entities[id]) return '';
  return ` data-ping="${id}" data-previd="${id}"`;
}

function legalFor(seat: Seat): Action[] {
  // network mode: the server computes and pushes MY legal actions (avoids
  // redaction problems client-side); the opponent's are unknown to me → none.
  if (NET) return seat === NET.seat ? NET.legal : [];
  return legalActions(h.state, seat);
}

/** hosts the in-progress mod (ui.modding) could legally land on — computed
 * once per render(); unitHtml highlights them (bin/hand mod affordance) */
let modHostCache = new Set<EntityId>();
/** UZRG: units with a legal activated ability RIGHT NOW — computed once per
 * render() from the legal-action list (never re-derived), so the glow and the
 * engine cannot disagree. unitHtml draws it. */
let actCache = new Set<EntityId>();
/** the list behind it, kept so the per-unit badge can name the ability without
 * recomputing legalActions once per card on the board */
let actLegalCache: Action[] = [];
/** every seat's legal actions, unioned — the glow is drawn for whoever's unit
 * it is (hotseat shows both boards; net mode knows only its own list) */
function refreshActCache(): void {
  actLegalCache = NET ? legalFor(NET.seat) : [...legalFor(0), ...legalFor(1)];
  actCache = activatableUnits(actLegalCache);
}
function moddingHosts(): Set<EntityId> {
  const m = ui.modding;
  if (!m) return new Set();
  return new Set(legalFor(m.seat)
    .filter(a => a.type === m.mode && (a as { from?: string }).from === m.from && (a as { index?: number }).index === m.index)
    .map(a => (a as unknown as { hostId: EntityId }).hostId));
}

/** distinct spell tokens `seat` could cast right now (C5 pass guard) */
function castableTokenCount(seat: Seat): number {
  return new Set(legalFor(seat)
    .filter(a => a.type === 'castSpellToken')
    .map(a => (a as { entityId: EntityId }).entityId)).size;
}

/** #1: identity keys of every activateAbility currently legal for `seat` —
 * Pass-all snapshots these on arming; a key that was NOT in the snapshot
 * means a resolution granted a new ability, and the chip must disarm. */
function abilityKeys(seat: Seat): string[] {
  return legalFor(seat)
    .filter(a => a.type === 'activateAbility')
    .map(a => {
      const aa = a as Extract<Action, { type: 'activateAbility' }>;
      const via = aa.via === undefined ? 'own' : aa.via === 'augment' ? 'aug' : `mod${aa.via.mod}`;
      return `${aa.entityId}:${aa.abilityIndex}:${via}`;
    });
}

// ── #2: auto-yield to a unit's triggers (MTGO-style) ──────────────────
/** entity id → card name (display) of units whose triggers I auto-yield to;
 * persisted per room so a refresh keeps the setting */
let yieldMap = new Map<EntityId, string>();
const yieldStoreKey = (): string | null => (NET ? `algoYield:${NET.room}` : null);
function loadYield(): void {
  const k = yieldStoreKey();
  if (!k) return;
  try { yieldMap = new Map(JSON.parse(localStorage.getItem(k) ?? '[]') as [EntityId, string][]); }
  catch { yieldMap = new Map(); }
}
function saveYield(): void {
  const k = yieldStoreKey();
  if (k) localStorage.setItem(k, JSON.stringify([...yieldMap]));
}
// ── round 13: the seen-hand aid's dismissals ──────────────────────────
/* "clicking a card removes it from the aid" / "a button to dismiss the whole
 * aid". `seenHand` is ENGINE state, re-sent whole on every snapshot, so the
 * dismissals are a view preference layered over it (ui/inspect.ts). They are
 * persisted per room exactly like the auto-yield set above: the client never
 * auto-reconnects, so every server restart reloads both players, and an aid
 * that resurrected everything you had forgotten would be worse than no aid.
 * The stored record names the look it belongs to, so a LATER reveal — a new
 * turn, or a different hand in the same turn — shows everything again. */
let seenDrop: SeenHandDismissals | null = null;
const seenStoreKey = (): string | null => (NET ? `algoSeen:${NET.room}` : null);
function loadSeenDrop(): void {
  const k = seenStoreKey();
  if (!k) return;
  try {
    const d = JSON.parse(localStorage.getItem(k) ?? 'null') as SeenHandDismissals | null;
    seenDrop = d && typeof d.key === 'string' && Array.isArray(d.cards) ? d : null;
  } catch { seenDrop = null; }
}
function saveSeenDrop(): void {
  const k = seenStoreKey();
  if (k && seenDrop) localStorage.setItem(k, JSON.stringify(seenDrop));
}

/** When I hold priority with no pending decision and the TOP of the stack is
 * a trigger sourced from an auto-yielded unit, pass automatically. Only the
 * top matters: passing resolves it, and whatever sits underneath gets its own
 * window — and its own check — afterwards (ui/inspect.ts shouldAutoYield). */
function maybeAutoYield(): void {
  if (!NET) return;
  const s = h.state;
  if (!shouldAutoYield(s, NET.seat, new Set(yieldMap.keys()))) return;
  if (s.actionCount === ui.yieldAt) return;   // one send per server state
  if (!NET.legal.some(a => a.type === 'passPriority')) return;
  ui.yieldAt = s.actionCount;
  NET.do({ type: 'passPriority', seat: NET.seat });
}

// ── #6: chess clocks (display only) ───────────────────────────────────
/** remaining ms for a seat, extrapolated locally from the last snapshot.
 * Anchor on the server's settle stamp; if the two clocks disagree wildly
 * (>5s skew) fall back to receipt time so the display never jumps. */
function clockDisplayMs(seat: Seat): number {
  const c = clockSnap!;
  const anchor = Math.abs(c.rx - c.at) > 5000 ? c.rx : c.at;
  return Math.max(0, c.ms[seat]! - (c.running[seat] ? Date.now() - anchor : 0));
}
function fmtClock(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
  const p = (n: number): string => String(n).padStart(2, '0');
  return hh > 0 ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}
function clocksHtml(): string {
  if (!NET || !clockSnap) return '';
  const cell = (seat: Seat, who: string): string => {
    const ms = clockDisplayMs(seat);
    const cls = `clocktime ${clockSnap!.running[seat] && ms > 0 ? 'run' : ''} ${ms <= 0 ? 'exp' : ''}`;
    return `<span class="clockcell" title="${esc(h.state.players[seat]!.name)}'s clock (display only)">${who}
      <span class="${cls}" data-clkseat="${seat}">${fmtClock(ms)}</span></span>`;
  };
  return `<span class="clocks" title="chess clocks (display only)">⏱ ${cell(NET.seat, 'you')} · ${cell(other(NET.seat), 'opp')}</span>`;
}
/** 1s ticker: patches ONLY the clock time nodes — never a full re-render */
setInterval(() => {
  if (!clockSnap || !NET) return;
  for (const el of document.querySelectorAll('.clocktime[data-clkseat]')) {
    const seat = Number((el as HTMLElement).dataset['clkseat']) as Seat;
    const ms = clockDisplayMs(seat);
    el.textContent = fmtClock(ms);
    el.classList.toggle('run', !!clockSnap.running[seat] && ms > 0);
    el.classList.toggle('exp', ms <= 0);
  }
}, 1000);

// ── #7: report-issue button ───────────────────────────────────────────
let reportOpen = false;
let reportBusy = false;
/** the note being typed (survives server-push re-renders, like judgeDraft) */
let reportDraft = '';
let toastMsg: string | null = null;
let toastTimer = 0;
function showToast(msg: string): void {
  toastMsg = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastMsg = null; render(); }, 4000);
}
function reportOverlayHtml(): string {
  return `<div class="overlay"><div class="overlaybox reportbox">
    <h3>🐛 Report an issue</h3>
    <div class="hint">What happened? The server stores your note with the room's exact action
      count, so this precise moment can be replayed later.</div>
    <textarea id="report-note" rows="4" placeholder="what happened?" ${reportBusy ? 'disabled' : ''}></textarea>
    <div class="judgerow">
      <button data-btn="reportclose">Cancel (esc)</button>
      <button class="primary" data-btn="reportsend" ${reportBusy || !reportDraft.trim() ? 'disabled' : ''}>${reportBusy ? 'sending…' : 'Send report'}</button>
    </div>
  </div></div>`;
}
function sendReport(): void {
  if (!NET || reportBusy) return;
  const note = reportDraft.trim();
  if (!note) return;
  reportBusy = true;
  render();
  fetch('/api/report', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ room: NET.room, seat: NET.seat, note }),
  }).then(r => r.json()).then((r: { ok?: boolean }) => {
    if (r.ok) {
      reportOpen = false;
      reportDraft = '';
      showToast('logged — thanks, we can replay this exact moment');
    } else uiError = 'the report was not accepted';
  }).catch(() => { uiError = 'could not reach the server to file the report'; })
    .finally(() => { reportBusy = false; render(); });
}

/** #5: the value a state-derived X spell would use if it resolved right now
 * (xPreview is a pure per-card query — see engine/src/cards/dsl.ts) */
function xPreviewFor(name: string, seat: Seat): number | null {
  const s = h.state;
  if (s.phase !== 'battle' || !s.battle) return null;
  try {
    const f = getCard(name).xPreview;
    if (!f) return null;
    const v = f(q(), seat, s.battle.region);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch { return null; }
}

// ── rendering ─────────────────────────────────────────────────────────
/** one corner chip on a card scan (cardHtml `badges`) */
interface Badge { t: string; mod?: boolean; ctr?: boolean; html?: boolean; cls?: string; title?: string }

function cardHtml(name: string, opts: {
  playable?: boolean; candidate?: boolean; selected?: boolean; carrying?: boolean; modhost?: boolean;
  /** UZRG: it has a legal activated ability — a DIFFERENT fact from `playable`
   * ("can be dragged into a formation"), and both can be true at once */
  activatable?: boolean;
  badges?: Badge[]; stats?: string; dmg?: string; data?: string;
  /** ui/motion.ts slot key — what makes this card the SAME card next render */
  anim?: string;
} = {}): string {
  const cls = ['card'];
  if (opts.playable) cls.push('playable');
  if (opts.candidate) cls.push('candidate');
  if (opts.selected) cls.push('selected');
  if (opts.carrying) cls.push('carrying');
  if (opts.modhost) cls.push('modhost');
  if (opts.activatable) cls.push('activatable');
  const badges = (opts.badges ?? []).map(b => `<span class="badge ${b.mod ? 'mod' : ''} ${b.ctr ? 'ctr' : ''} ${b.cls ?? ''}"${
    b.title ? ` title="${esc(b.title)}"` : ''}>${b.html ? b.t : esc(b.t)}</span>`).join('');
  return `<div class="${cls.join(' ')}" ${opts.data ?? ''} data-prev="${esc(name)}"${opts.anim ? ` data-anim="${esc(opts.anim)}"` : ''}>
    <img src="${art(name)}" alt="${esc(name)}" onerror="this.classList.add('noart')">
    <div class="artfallback">${esc(name)}</div>
    ${badges ? `<div class="badges">${badges}</div>` : ''}
    ${opts.stats ? `<div class="stats">${opts.stats}</div>` : ''}
    ${opts.dmg ? `<div class="dmg">${opts.dmg}</div>` : ''}
  </div>`;
}

/** a face-down card back (opponent's hidden hand in network mode) */
function backHtml(anim?: string): string {
  return `<div class="card back" title="hidden card"${anim ? ` data-anim="${esc(anim)}"` : ''}></div>`;
}

function unitHtml(u: Entity, opts: { selected?: boolean; clickable?: boolean; inert?: boolean } = {}): string {
  const [p, t] = q().effStats(u);
  const badges: Badge[] = [...q().ownAttrs(u)].map(a => ({ t: a }));
  // UZRG: it can act. The outline says "something here"; the badge says what.
  const canAct = !opts.inert && actCache.has(u.id);
  if (canAct) {
    const label = activationBadge(h.state, u, actLegalCache);
    if (label) badges.unshift({
      t: `⚡ ${iconizeText(label)}`, html: true, cls: 'act',
      title: `activated ability, playable right now — click the unit: ${label.replace(/[[{]([^\]}]+)[\]}]/g, '$1')}`,
    });
  }
  if (u.counters) {
    const sign = u.counters > 0 ? '+' : '';
    badges.unshift({ t: `${sign}${u.counters}/${sign}${u.counters}`, ctr: true });
  }
  for (const modId of u.mods) {
    const m = h.state.entities[modId];
    if (m) badges.push({
      // a mod has no card of its own on the table — this badge IS where it
      // lives, so it carries the mod's motion key and the flight lands here
      t: `<span data-anim="e${m.id}">`
        + txtIcon(m.appliedAs === 'graft' ? 'graft' : 'augment', m.appliedAs === 'graft' ? '⇄' : '+')
        + esc(m.card.split(' ')[0]) + '</span>',
      mod: true, html: true,
    });
  }
  if (u.absent) badges.push({ t: 'sent', mod: true });
  // #2: auto-yield indicator — this unit's triggers get passed automatically
  if (NET && yieldMap.has(u.id)) badges.push({ t: '⏩ auto-yield', mod: true });
  // base vs effective P/T: when they differ, color the live number and show
  // the printed base underneath it (playtest: base stats matter to the game)
  let base: [number, number] = u.tokenStats ?? [0, 0];
  try { const c = getCard(u.card); base = u.tokenStats ?? [c.power, c.toughness]; } catch { /* unknown */ }
  const changed = p !== base[0] || t !== base[1];
  const stats = changed
    ? `<span class="${p + t >= base[0] + base[1] ? 'statup' : 'statdown'}">${p}/${t}</span><span class="basestat">${base[0]}/${base[1]}</span>`
    : `${p}/${t}`;
  return cardHtml(u.card, {
    anim: `e${u.id}`,
    stats, dmg: u.damage ? `−${u.damage}` : '', badges,
    candidate: !opts.inert && isCandidate({ unit: u.id }),
    selected: opts.selected, carrying: ui.carrying === u.id,
    playable: opts.clickable,
    activatable: canAct,
    modhost: !opts.inert && modHostCache.has(u.id),
    // inert (B2): absent "sent" units are not targets and take no clicks
    data: opts.inert ? `data-previd="${u.id}"` : `data-act="unit" data-id="${u.id}" data-previd="${u.id}"`,
  });
}

function resHtml(r: { kind: string; state: string }, p: Seat, i: number): string {
  const canact = legalFor(p).some(a =>
    (a.type === 'activateResource' || a.type === 'exchangePrismite') && a.index === i);
  // docs/07 §9.2 (decided): literal resource-card scans. Dormant = the face-down
  // back (your own gets a small element chip — you know what's under it; the
  // opponent's kind arrives redacted as 'hidden'), open = element card face-up,
  // expended = turned sideways, prismite = its own card.
  const face =
    r.state === 'dormant' || r.kind === 'hidden' ? 'Dormant-Resource' :
    r.kind === 'prismite' ? 'Prismite' :
    r.kind.charAt(0).toUpperCase() + r.kind.slice(1) + '-Resource';
  const chip = r.state === 'dormant' && r.kind !== 'hidden'
    ? `<span class="reschip ${r.kind}">${r.kind === 'prismite' ? 'P' : r.kind.charAt(0).toUpperCase()}</span>` : '';
  const title = r.kind === 'hidden' ? 'dormant (element hidden)' : `${r.kind} (${r.state})`;
  // Light and Dark have no resource-card scan in AlgomancyCards/ yet, so the
  // face 404s. Degrade to a coloured element plate rather than a broken image:
  // `onerror` tags the wrapper and CSS swaps the plate in.
  return `<span class="rescard ${r.state} ${r.kind} ${canact ? 'canact' : ''}" title="${title}"
    data-act="res" data-p="${p}" data-i="${i}" data-prev="${face}"><img src="${art(face)}" alt=""
      onerror="this.closest('.rescard').classList.add('noart')"
    ><span class="resplate">${esc(r.kind === 'hidden' ? '?' : r.kind)}</span>${chip}</span>`;
}

/** one seat's hand row (also used by the sticky bottom dock in net mode) */
function handZoneHtml(p: Seat): string {
  const pl = h.state.players[p]!;
  const legal = legalFor(p);
  const keys = nameKeys(pl.hand, `h${p}:`);
  return pl.hand.map((n, i) => {
    if (n === HIDDEN_CARD) return backHtml(keys[i]);
    const playable = legal.some(a =>
      (a.type === 'playCard' && a.handIndex === i) ||
      (a.type === 'augment' && a.from === 'hand' && a.index === i) ||
      (a.type === 'graft' && a.from === 'hand' && a.index === i) ||
      (a.type === 'prophesy' && a.from === 'hand' && a.index === i) ||
      (h.state.phase === 'planning' && a.type === 'recycleForResource' && a.handIndex === i));
    // #5: live X preview during battle for state-derived X spells
    const badges: Badge[] = [];
    const xnow = xPreviewFor(n, p);
    if (xnow !== null) badges.push({ t: `X=${xnow} now`, ctr: true });
    // R42: this card can be prophesied RIGHT NOW — the banner cost, up front
    const proph = legal.find(a => a.type === 'prophesy' && a.from === 'hand' && a.index === i);
    if (proph) {
      let mana: number | undefined;
      try { mana = getCard(n).prophecy?.mana; } catch { /* unknown */ }
      badges.push({ t: `📜 prophesy${mana === undefined ? '' : ` [${mana}]`}`, cls: 'proph on' });
    }
    return cardHtml(n, {
      playable, badges, anim: keys[i],
      data: `data-act="hand" data-p="${p}" data-i="${i}"${xnow !== null ? ` data-xnow="${xnow}"` : ''}`,
    });
  }).join('');
}

/** what clicking a spell token does during formation building (C1):
 * 'ride' = toggle bring-along during my attack declare, 'send' = toggle
 * counterattack-send during my round-1 blocks, null = normal (cast). */
function tokenToggleMode(t: Entity): 'ride' | 'send' | null {
  const s = h.state, b = s.battle;
  if (!b || s.decision) return null;
  if (NET && t.controller !== NET.seat) return null;
  if (b.step === 'declare' && t.controller === b.attacker) {
    const fromRegion = b.round === 1 || b.attackerPool === null ? q().homeRegion(b.attacker) : b.region;
    if (t.region === fromRegion && (!b.attackerPool || b.attackerPool.includes(t.id))) return 'ride';
    return null;
  }
  if (b.step === 'blocks' && b.round === 1 && t.controller === b.defender) return 'send';
  return null;
}

function tokenHtml(t: Entity): string {
  const riding = ui.spellTokens.includes(t.id);
  const castable = legalFor(t.controller).some(a => a.type === 'castSpellToken' && a.entityId === t.id);
  return cardHtml(t.card, {
    anim: `e${t.id}`,
    stats: 'X=' + t.x,
    playable: castable || tokenToggleMode(t) !== null,
    selected: riding || ui.send.includes(t.id),
    badges: riding ? [{ t: `${txtIcon('battle', '[battle]')} riding`, mod: true, html: true }] : [],
    data: `data-act="token" data-id="${t.id}"`,
  });
}

/** B1: one REGION panel — every in-play unit/spell token standing in this
 * region (owner's first, then invaders marked), with the region owner's
 * identity row attached. Absent ("sent") units sit in their own strip (B2). */
function regionPanelHtml(p: Seat, opts: { omitHand?: boolean } = {}): string {
  const s = h.state;
  const pl = s.players[p]!;
  const legal = legalFor(p);
  const acting = legal.length > 0;
  const e = q();
  const region = e.homeRegion(p);
  const b = s.battle;
  const inFormation = new Set<EntityId>();
  if (b) {
    for (const col of b.columns) col.forEach(id => inFormation.add(id));
    for (const col of Object.values(b.blocks)) col.forEach(id => inFormation.add(id));
  }
  for (const col of ui.columns) col.forEach(id => inFormation.add(id));
  ui.send.forEach(id => inFormation.add(id));
  // ZQPC: a spell token you have chosen to bring along is part of the attack
  // being built, not part of the region any more — it renders in the battle
  // panel's "riding along" row with the columns it is joining.
  ui.spellTokens.forEach(id => inFormation.add(id));
  // …and the ones the OPPONENT is sliding in right now: they should leave
  // their region the moment they are placed, so the move is visible
  for (const col of NET?.building?.cols ?? []) col.forEach(id => inFormation.add(id));
  (NET?.building?.send ?? []).forEach(id => inFormation.add(id));

  const here = Object.values(s.entities).filter(en =>
    (en.kind === 'unit' || en.kind === 'spellToken') && !en.absent &&
    en.region === region && !inFormation.has(en.id));
  const canClick = (u: Entity): boolean => !!b && (!NET || u.controller === NET.seat) &&
    ((b.step === 'declare' && u.controller === b.attacker) ||
      (b.step === 'blocks' && u.controller === b.defender));
  const entHtml = (en: Entity): string => en.kind === 'spellToken'
    ? tokenHtml(en)
    : unitHtml(en, { clickable: canClick(en) });
  // ZQPC ("the spell tokens shouldn't get smushed in with the units — they
  // should have their own spot, over by the bin"): a spell token is not a
  // creature on the line, it is ammunition waiting to be spent, and mixing the
  // two made a formation impossible to read. Own strip, beside the bin.
  const isTok = (en: Entity): boolean => en.kind === 'spellToken';
  const ownHere = here.filter(en => en.controller === p && !isTok(en)).map(entHtml).join('');
  const ownTokens = here.filter(en => en.controller === p && isTok(en));
  const tokenStrip = ownTokens.length
    ? `<div class="tokenstrip"><div class="zonelabel">✨ spell tokens (${ownTokens.length})</div>
        <div class="zone tokenzone" data-animzone="tokens:${p}">${ownTokens.map(entHtml).join('')}</div></div>`
    : '';
  // #1: invaders sit as a compact strip at the SIDE of the region's space —
  // visually subordinate to the owner's formation, not front-and-center
  const invaders = here.filter(en => en.controller !== p);
  const invaderHtml = invaders.length
    ? `<div class="invaders"><div class="zonelabel invaderlabel">${txtIcon('battle', '[battle]')} invaders — ${esc(s.players[invaders[0]!.controller]!.name)}</div>
        <div class="zone invaderzone">${invaders.map(entHtml).join('')}</div></div>`
    : '';

  // B2 / playtest: counterattackers in transit. They used to sit under their
  // OWNER's formation, which is the one region they are provably not in. They
  // are heading HERE, so they render in the destination panel — a compact,
  // greyed, inert column beside the bin, the same visual weight as the bin
  // itself. Next round they stop being absent and drop back into the normal
  // formation rows where you declare with them.
  const incoming = Object.values(s.entities).filter(en =>
    (en.kind === 'unit' || en.kind === 'spellToken') && en.controller !== p && en.absent);
  const sentStrip = incoming.length
    ? `<div class="sentstrip" title="${esc(s.players[incoming[0]!.controller]!.name)} sent these to counterattack — they arrive in this region next round and cannot be interacted with until then">
        <div class="zonelabel">${txtIcon('battle', '[battle]')} incoming — ${esc(s.players[incoming[0]!.controller]!.name)}</div>
        <div class="zone sentzone">${incoming.map(en => en.kind === 'spellToken'
          ? cardHtml(en.card, { stats: 'X=' + en.x })
          : unitHtml(en, { inert: true })).join('')}</div>
        <div class="sentfoot">arrives next round</div></div>`
    : '';

  // B3: during a battle only state.battle.region is "real"
  const focus = s.phase === 'battle' && b ? (b.region === region ? 'battlefocus' : 'battledim') : '';

  // B5: opponent's hidden hand lives in their identity row; seen-hand memory strip
  const hiddenHand = pl.hand.length > 0 && pl.hand.every(n => n === HIDDEN_CARD);
  const miniHand = hiddenHand
    ? `<span class="minihand" data-animzone="hand:${p}" title="hand: ${pl.hand.length} cards">${nameKeys(pl.hand, `h${p}:`).map(k => `<span class="miniback" data-anim="${k}"></span>`).join('')}</span><span style="color:var(--dim)">hand ${pl.hand.length}</span>`
    : '';
  // round 13: the label used to be one long inline sentence that explained
  // itself at length every render and ate the width the cards needed. Now it
  // stacks ABOVE them in two short rows, and every card carries a ✕ that
  // forgets it. The ✕ rather than a bare card click on purpose: these are
  // real `cardHtml` scans, so hovering one previews it and right-clicking
  // opens the inspector, and a left-click that deleted the card would make
  // looking at it the same gesture as losing it.
  const seen = NET && p === other(NET.seat) ? s.seenHand?.[NET.seat] : null;
  const sv = seenHandView(seen, seenDrop);
  const seenStrip = sv.show
    ? `<div class="seenhand">
        <div class="seenhead">
          <span class="seenlabel">👁 Their hand, seen turn ${sv.turn}</span>
          <button class="seendismiss" data-btn="seenhideall" title="dismiss the whole memory aid until they show you their hand again">✕ dismiss</button>
        </div>
        <div class="seenhint">may be out of date${sv.dismissed ? ` · ${sv.dismissed} crossed off` : ''} — ✕ a card to forget it</div>
        <div class="seencards">${sv.cards.map(c => `<span class="seenslot">${cardHtml(c.name)
          }<button class="seenx" data-btn="seendrop" data-i="${c.index}" title="forget ${esc(c.name)} — it is played, or not worth tracking any more">✕</button></span>`).join('')}</div>
      </div>`
    : '';

  const handZone = opts.omitHand || hiddenHand ? '' :
    `<div class="zonelabel">Hand (${pl.hand.length})</div>
     <div class="zone" data-animzone="hand:${p}">${handZoneHtml(p)}</div>`;

  // the bin lives IN its player's region: a mini stack on the right that
  // opens a full dialog (bin-play clicks work from the dialog).
  // #4: when bin cards are legally usable as mods right now, say so loudly.
  const binUsable = legal.some(a =>
    ((a.type === 'augment' || a.type === 'graft') && a.from === 'bin') ||
    (a.type === 'prophesy' && a.from === 'bin'));
  const binKeys = nameKeys(pl.bin, `b${p}:`);
  const binMini = `<div class="regionbin ${binUsable ? 'hasmods' : ''}" data-btn="binopen" data-p="${p}"
      data-animzone="bin:${p}" title="open ${esc(pl.name)}'s bin">
      <div class="zonelabel">bin (${pl.bin.length})</div>
      <div class="regionbinthumbs">${pl.bin.slice(-3).map((n, k) =>
        cardHtml(n, { anim: binView === p ? undefined : binKeys[pl.bin.length - Math.min(3, pl.bin.length) + k] })).join('') || '<span class="binempty">empty</span>'}</div>
      ${binUsable ? `<div class="binmodhint">${txtIcon('augment', '+')}${txtIcon('graft', '[Switch]')} playable as mods</div>` : ''}
    </div>`;

  // R38/R39: rot and debt are per-player counters that bite every single turn
  // (rot damages you at the start of deployment and never decays; debt eats
  // mana at the end of your next resource step). They live next to life, and
  // ONLY when non-zero, so a base-set game's identity row looks unchanged.
  // Both are optional fields on PlayerState — always read through E.
  const rot = e.rot(p), debt = e.debt(p);
  const counters =
    (rot ? `<span class="pcount rot" title="R38: at the start of every deployment you take ${rot} damage from your own rot. Rot never decreases on its own.">☠ rot ${rot}</span>` : '') +
    (debt ? `<span class="pcount debt" title="R39: at the very END of your next resource step you must pay 1 mana per debt (${debt} mana). Whatever you cannot pay carries over.">⛓ debt ${debt}</span>` : '');

  return `<div class="player region ${acting ? '' : 'inactive'} ${focus}">
    <div class="pheader">
      <span class="pname">${esc(pl.name)}${s.initiative === p ? ' ⭐' : ''}</span>
      <span class="life ${isCandidate({ player: p }) ? 'candidate' : ''}" data-act="player" data-p="${p}"
        data-animzone="life:${p}">♥ ${pl.life}</span>
      ${counters}
      <span class="resrow" data-animzone="res:${p}">${pl.resources.map((r, i) => resHtml(r, p, i)).join('')}
        <span style="color:var(--dim)">(${e.openMana(p)} mana open${s.phase === 'planning' ? `, ${pl.activationsLeft} activations` : ''})</span>
      </span>
      ${miniHand}
      <span class="binline" data-animzone="deck:${p}">deck ${s.mode === 'constructed' ? s.decks![p]!.length : s.sharedDeck.length}${s.mode === 'draft' ? ` · pack ${s.packs[p]!.length}` : ''}</span>
    </div>
    ${seenStrip}
    <div class="regionrow">
      <div class="regionmain">
        <div class="zonelabel">Region of ${esc(pl.name)}${focus === 'battlefocus' ? ` — ${txtIcon('battle', '[battle]')} the battle is here` : focus === 'battledim' ? ' — outside this battle' : ''}</div>
        <div class="zone" data-animzone="field:${p}">${ownHere}</div>
      </div>
      ${tokenStrip}
      ${invaderHtml}
      ${sentStrip}
      ${binMini}
      ${regionCacheHtml(p)}
    </div>
    ${handZone}
  </div>`;
}

/** the full-bin dialog (opened from a region's mini bin) — bin cards keep
 * their data-act so augment/graft-from-bin still works from here */
let binView: Seat | null = null;
function binDialogHtml(): string {
  if (binView === null) return '';
  const p = binView;
  const pl = h.state.players[p]!;
  const legal = legalFor(p);
  const binKeys = nameKeys(pl.bin, `b${p}:`);
  let anyUsable = false;
  const items = pl.bin.map((n, i) => {
    // #4: bin cards that can be applied as mods RIGHT NOW carry a badge and glow
    const canAug = legal.some(a => a.type === 'augment' && a.from === 'bin' && a.index === i);
    const canGraft = legal.some(a => a.type === 'graft' && a.from === 'bin' && a.index === i);
    // R42: "I can be prophesied from your bin" (Angel of Anguish) — the only
    // way a bin card leaves the bin without being a mod
    const canProph = legal.some(a => a.type === 'prophesy' && a.from === 'bin' && a.index === i);
    const usable = canAug || canGraft || canProph;
    anyUsable ||= usable;
    const badges: Badge[] = [];
    if (canAug || canGraft) {
      badges.push({
        t: `${canAug ? txtIcon('augment', '+') : ''}${canGraft ? txtIcon('graft', '[Switch]') : ''} usable as mod`,
        mod: true, html: true,
      });
    }
    if (canProph) badges.push({ t: '📜 prophesy from bin', cls: 'proph on' });
    return cardHtml(n, { playable: usable, badges, anim: binKeys[i], data: `data-act="bin" data-p="${p}" data-i="${i}"` });
  }).join('');
  return `<div class="overlay mainonly"><div class="overlaybox binbox">
    <h3>${esc(pl.name)}'s bin (${pl.bin.length})</h3>
    ${anyUsable ? `<div class="binmodbanner">${txtIcon('augment', '+')} Glowing cards can be applied to a unit as a mod right now — click one, then pick a host.</div>` : ''}
    <div class="zone binzone bindialog">${items || '<span class="binempty">empty</span>'}</div>
    <button data-btn="binclose">Close</button>
  </div></div>`;
}

/** R65: the erased pile — cards taken OUT OF THE GAME. Not a zone anything is
 * played from, and nothing here is ever clickable; it exists because the
 * information is public and there was no way to look at it ("I dont think
 * there's currently a way to view erased cards").
 *
 * R69 sends every dying token through a bin and then erases it, so the pile
 * itself is now mostly dead Wisps. The engine's record keeps them; the VIEW
 * lists only the real cards and says how many tokens it left out —
 * erasedPileView() in ui/inspect.ts owns that decision and is tested there. */
let erasedView: Seat | null = null;
function erasedDialogHtml(): string {
  if (erasedView === null) return '';
  const pl = h.state.players[erasedView]!;
  const gone = erasedPileView(pl.erased);
  const empty = gone.cards.length === 0
    ? `<span class="binempty">${gone.tokensOmitted ? 'no real cards — only tokens have been erased' : 'nothing has been erased'}</span>`
    : '';
  return `<div class="overlay mainonly"><div class="overlaybox binbox">
    <h3>${esc(pl.name)}'s erased cards (${esc(gone.countLabel)})</h3>
    <div class="binmodbanner">Erased cards are out of the game — no bin, no death triggers, and nothing plays them back.</div>
    <div class="zone binzone bindialog">${gone.cards.map(n => cardHtml(n, {})).join('')}${empty}</div>
    ${gone.note ? `<div class="binmodbanner">${esc(gone.note)} erased and not listed — every dead token is erased, and listing them would bury the cards above.</div>` : ''}
    <button data-btn="erasedclose">Close</button>
  </div></div>`;
}

// (bins moved into their players' region panels — see regionPanelHtml/binDialogHtml)

// ── R41: the cache — a fourth zone, and a PUBLIC one ──────────────────
//
// Both players see every cached card and the prophecy attached to it (R41), so
// this renders identically for either seat and the server does no redaction.
// Being cached is NOT permission to play: an entry is playable only through a
// FULFILLED prophecy (free, ignoring affinity — R42) or a live glimpse stamp
// (pay the mana, ignoring affinity — R45), and everything else just sits there.

/** the seat whose cache the full dialog is showing, or null */
let cacheView: Seat | null = null;

/** the badges one cache entry wears: its prophecy condition, whether that
 * prophecy is fulfilled, the glimpse window, and how it would be paid for */
function cacheBadges(p: Seat, i: number): Badge[] {
  const e = q();
  const cc = e.cache(p)[i];
  if (!cc) return [];
  const out: Badge[] = [];
  const via = e.cachePermission(p, i);
  const pr = cc.prophecy;
  if (pr) {
    // R44: fulfilment latches, so "fulfilled" here never goes back to "not yet"
    const met = !!pr.fulfilled || via === 'prophecy';
    out.push({ t: met ? '✓ fulfilled' : '⏳ not yet', cls: met ? 'proph on' : 'proph' });
  }
  if (cc.playableUntilTurn !== undefined) {
    // R45: the glimpse permission expires at end of turn; the card stays
    const live = h.state.turn <= cc.playableUntilTurn;
    out.push({ t: live ? '👁 until end of turn' : '👁 expired', cls: live ? 'glimpse on' : 'glimpse' });
  }
  // how it would be paid for right now — the one thing a player must not guess
  if (via === 'prophecy') out.push({ t: 'FREE', cls: 'free' });
  else if (via === 'glimpse') out.push({ t: 'pay mana', cls: 'paid' });
  return out;
}

/** one cache entry: the real scan, its short status chips, and — under the
 * card, where a sentence can actually be read — the prophecy condition. */
function cacheCardHtml(p: Seat, i: number, opts: { clickable?: boolean } = {}): string {
  const cc = cacheOf(p)[i]!;
  const via = q().cachePermission(p, i);
  // R41: a cached card is a legal TARGET (Prismatic Observer) — in BOTH
  // players' caches, so the highlight is not gated on whose zone this is
  const candidate = cc.uid !== undefined && isCandidate({ cached: { seat: p, uid: cc.uid } });
  const pr = cc.prophecy;
  const met = !!pr?.fulfilled || via === 'prophecy';
  // R42/R45: permission is not the whole story — a cached card is still played
  // "as if it were in your hand", so its TIMING gate applies on top. Say which
  // it is, rather than letting a permitted-but-unplayable card look broken.
  const playableNow = legalFor(p).some(a => a.type === 'playCached' && a.index === i);
  const TIMING_WORD: Record<string, string> = { deploy: 'deployment', battle: 'battle', haste: 'the haste step' };
  const when = via ? TIMING_WORD[q().cachedTiming(p, i, via)] ?? '' : '';
  const stale = !!via && !!opts.clickable && !playableNow && when
    ? `<div class="cachepay none">…but only during ${when}</div>` : '';
  const meta = [
    pr ? `<div class="cachecond ${met ? 'met' : ''}">📜 ${esc(pr.condition)}${pr.release === 'haste' ? ' <i>(released at haste)</i>' : ''}</div>` : '',
    via === 'prophecy' ? '<div class="cachepay free">free · ignores affinity</div>' :
      via === 'glimpse' ? '<div class="cachepay">pay its mana · ignores affinity</div>' :
        '<div class="cachepay none">not playable from here</div>',
    stale,
  ].join('');
  const card = cardHtml(cc.card, {
    anim: cacheAnimKeys(p)[i],
    badges: cacheBadges(p, i),
    playable: !!opts.clickable && (via !== null || cacheModActions(p, i).length > 0),
    candidate,
    data: `data-act="cache" data-p="${p}" data-i="${i}"`,
  });
  return `<div class="cacheentry">${card}${meta}</div>`;
}

/** motion keys for a seat's cache, index-aligned with cacheOf(seat). The uid
 * is the real handle (R41); an entry cached before uids existed falls back to
 * name+occurrence, exactly as ui/motion.ts does. */
function cacheAnimKeys(p: Seat): string[] {
  const cache = cacheOf(p);
  const fb = nameKeys(cache.map(c => c.card), `c${p}:`);
  return cache.map((cc, i) => (cc.uid !== undefined ? `c${cc.uid}` : fb[i]!));
}

/**
 * R41/R45: a cache entry that can never be PLAYED again — no prophecy to
 * fulfil, and either no glimpse stamp at all or one that has expired. It is
 * not quite dead (you may still augment or graft from cache) but it is not
 * what the zone is for, and a pile of them buries the entries that matter.
 *
 * Playtest 2026-08-20: "cards in the cache that are expired should be hidden.
 * Still able to be shown or viewed, but mostly out of sight."
 */
function cacheSpent(p: Seat, i: number): boolean {
  const cc = cacheOf(p)[i];
  if (!cc) return false;
  if (cc.prophecy) return false;                       // a condition may yet be met
  if (cc.playableUntilTurn === undefined) return true;  // never had permission
  return h.state.turn > cc.playableUntilTurn;           // the glimpse window closed
}

/** the seats whose spent cache entries the player has asked to see */
let showSpentCache = new Set<Seat>();

/** the augment/graft actions available from `seat`'s cache entry `i` (R41:
 * "you CAN augment or graft from cache") */
function cacheModActions(seat: Seat, i: number): Action[] {
  return legalFor(seat).filter(a =>
    (a.type === 'augment' || a.type === 'graft') && a.from === 'cache' && a.index === i);
}

/** the mini cache panel that lives in a player's region next to their bin.
 * Rendered only when the zone is non-empty, so a base-set game is unchanged. */
function regionCacheHtml(p: Seat): string {
  const cache = cacheOf(p);
  if (!cache.length) return '';
  const legal = legalFor(p);
  const mine = !NET || NET.seat === p;   // net mode knows no legal actions for the opponent
  // "permitted" (a fulfilled prophecy or a live glimpse) and "playable right
  // now" are different things — normal TIMING applies on top — so the summary
  // line says which one it means rather than over-promising.
  const permitted = cache.filter((_, i) => q().cachePermission(p, i) !== null).length;
  const now = new Set(legal.filter(a => a.type === 'playCached').map(a => (a as { index: number }).index)).size;
  const usable = legal.some(a => (a.type === 'augment' || a.type === 'graft') && a.from === 'cache');
  const hot = now > 0 || usable;
  const waiting = cache.filter((_, i) => !cacheSpent(p, i)).length;
  const note = mine && now ? `<div class="cachehint">${now} playable now</div>`
    : permitted ? `<div class="cachewait">${permitted} ready${mine ? ' — not this step' : ''}</div>`
      : waiting ? `<div class="cachewait">${waiting} waiting</div>`
        : `<div class="cachewait">nothing live</div>`;
  const keys = cacheAnimKeys(p);
  // spent entries (expired glimpses, no prophecy) are still IN the zone but
  // are not what you are looking at it for — the thumbs show live ones
  const liveIdx = cache.map((_, i) => i).filter(i => !cacheSpent(p, i));
  const spent = cache.length - liveIdx.length;
  const thumbs = liveIdx.slice(-3);
  return `<div class="regioncache ${hot ? 'hasplay' : ''}" data-btn="cacheopen" data-p="${p}"
      data-animzone="cache:${p}"
      title="R41: the cache is public — both players see every cached card. Click to open.">
    <div class="zonelabel">cache (${liveIdx.length}${spent ? ` +${spent} spent` : ''})</div>
    <div class="regionbinthumbs">${thumbs.map(i =>
      cardHtml(cache[i]!.card, { anim: cacheView === p ? undefined : keys[i] })).join('')
      || '<span class="binempty">nothing live</span>'}</div>
    ${note}
  </div>`;
}

/** see ui/inspect.ts — the pure logic lives there so it can be unit-tested */
function needsConfirm(u: Entity, a: Extract<Action, { type: 'activateAbility' }>): boolean {
  return activationNeedsConfirm(q(), u, a);
}

/** see ui/inspect.ts */
function playableCached(seat: Seat): string[] {
  return playableCachedNames(cacheOf(seat), legalFor(seat));
}

/** the full cache dialog — the zone is public, so this opens for either seat */
function cacheDialogHtml(): string {
  if (cacheView === null) return '';
  const p = cacheView;
  const pl = h.state.players[p]!;
  const cache = cacheOf(p);
  const mine = !NET || NET.seat === p;
  const live = cache.map((_, i) => i).filter(i => !cacheSpent(p, i));
  const spent = cache.map((_, i) => i).filter(i => cacheSpent(p, i));
  const showSpent = showSpentCache.has(p);
  const items = live.map(i => cacheCardHtml(p, i, { clickable: mine })).join('');
  const spentItems = spent.length
    ? `<div class="spentcache">
        <button data-btn="cachespent" data-p="${p}">${showSpent ? '▾' : '▸'} ${spent.length} spent
          <span style="color:var(--dim)">— expired or never permitted; still graftable</span></button>
        ${showSpent ? `<div class="zone binzone bindialog cachezone dim">${
          spent.map(i => cacheCardHtml(p, i, { clickable: mine })).join('')}</div>` : ''}
      </div>` : '';
  const anyPlayable = cache.some((_, i) => q().cachePermission(p, i) !== null);
  return `<div class="overlay mainonly"><div class="overlaybox binbox cachebox">
    <h3>${esc(pl.name)}'s cache (${cache.length})</h3>
    <div class="hint">The cache is public information (R41) — you both see every card here.
      Being cached is not permission to play: a card is playable only while its prophecy is
      fulfilled (free, ignoring affinity) or a glimpse still allows it this turn (pay the mana,
      ignoring affinity). Normal timing still applies. You may also augment or graft from here.</div>
    ${anyPlayable && mine ? '<div class="binmodbanner">Glowing cards can be used right now — click one.</div>' : ''}
    <div class="zone binzone bindialog cachezone">${items || '<span class="binempty">nothing live</span>'}</div>
    ${spentItems}
    <button data-btn="cacheclose">Close</button>
  </div></div>`;
}

/** what happens when both players pass the current battle window */
function nextBattleStepName(): string {
  const s = h.state;
  const b = s.battle;
  if (!b) return 'the next step';
  if (b.step === 'attackWindow') return `${esc(s.players[b.defender]!.name)} declares blocks`;
  if (b.step === 'blockWindow') return 'combat damage';
  if (b.step === 'afterWindow') {
    return s.battleRound === 1 ? 'round 2 (the counterattack)' : 'regroup & deployment';
  }
  return 'the next step';
}

// ── rules reference + judge (in-game help) ────────────────────────────

let helpOpen = false;
let judgeOpen = false;
let judgeBusy = false;
const judgeLog: { q: string; a: string; cards: { title: string }[] }[] = [];

const PHASE_GUIDE: [string, string][] = [
  ['Planning', 'Refresh resources · draw 2 · (draft: merge hand+pack, leave exactly 10, pass) · recycle cards into dormant resources · activate up to 2 resources (3+ affinity of an element when activating it grants a free dormant Shard) · exchange active Prismites.'],
  ['Haste', 'Only {Haste} cards may be played; they resolve immediately. Skipped when nobody can.'],
  ['Battle round 1', 'Initiative attacks: build columns (max 2 units each; column-mates SHARE combat attributes) → response window → defender declares blocks AND may send counterattackers (they cease to exist until round 2) → response window → combat damage (Swift → normal → Sluggish; triggers resolve between steps, no priority) → after-combat window.'],
  ['Battle round 2', 'The counterattack, in the other region: only units sent in round 1 (or a fresh attack if round 1 didn’t happen). Same steps.'],
  ['Regroup', 'Automatic: everyone returns home · damage cleared · temporary changes cleared · spell tokens erased · formations dissolve. Deployment buffs persist into NEXT battle.'],
  ['Deployment', 'Simultaneous and hidden: play cards, augment/graft (from hand or bin), activate abilities — alone in your region. Battle-timing cards unplayable. Reveals when both are done; then end-of-turn triggers (no responses) and initiative passes.'],
];

/** one glossary entry as a reference row (the ? overlay and the inspector
 * print the same thing, so they print it the same way) */
const glossRow = (e: GlossEntry): string =>
  `<div class="helprow"><b>${iconizeText(e.label ?? e.term)}</b><span>${iconizeText(e.text)}</span></div>`;

function helpOverlayHtml(): string {
  return `<div class="overlay mainonly"><div class="overlaybox helpbox">
    <h3>Rules reference</h3>
    <div class="helpscroll">
      <h4>The turn</h4>
      ${PHASE_GUIDE.map(([k, v]) => `<div class="helprow"><b>${k}</b><span>${iconizeText(v)}</span></div>`).join('')}
      <h4>Keywords</h4>
      ${KEYWORDS.map(glossRow).join('')}
      <h4>Light &amp; Dark</h4>
      ${EXPANSION_GUIDE.map(glossRow).join('')}
      <h4>Quick reminders</h4>
      <div class="helprow"><b>Augment ${txtIcon('augment', '(+)')}</b><span>${iconizeText('Slide under a unit from hand or bin: donates type-line attributes and text-box [Augment] text to the host.')}</span></div>
      <div class="helprow"><b>Graft ${txtIcon('graft', '(⇄)')}</b><span>${iconizeText('Insert into a graft-cause unit’s stack: the [Switch] effects join its trigger as one ability. [Switch1] = once per turn per card.')}</span></div>
      <div class="helprow"><b>Resources</b><span>Each grants 1 affinity of its element even while expended (dormant ones grant nothing); expend for 1 mana, refresh each turn. Shards: mana only, no affinity.</span></div>
      <div class="helprow"><b>Undo</b><span>Ctrl+Z or the ↶ button — your own last action, during planning and deployment.</span></div>
    </div>
    <button data-btn="helpclose">Close</button>
  </div></div>`;
}

/** one token as a scan plus its own stat line and text — the whole point is
 * not having to remember what a Wraith is */
function tokenRowHtml(name: string): string {
  let type = '', text = '', p = 0, t = 0;
  try { const c = getCard(name); type = c.type; text = c.text; p = c.power; t = c.toughness; }
  catch { return ''; }
  // a SPELL token has no meaningful printed P/T (its X is supplied when it is
  // created — "Create a Crystal 2" is a Crystal with X=2), so don't print one
  const stats = /spell/i.test(type) ? '<span class="hint">X set when created</span>' : `<b>${p}/${t}</b>`;
  return `<div class="tokenrow">
    ${cardHtml(name, { data: `data-prev="${esc(name)}"` })}
    <div class="tokenbody">
      <div class="tokenname">${esc(name)} ${stats}</div>
      <div class="hint">${iconizeText(type)}</div>
      ${text ? `<div class="hint">${iconizeText(text)}</div>` : ''}
    </div>
  </div>`;
}

// ── right-click card inspector ────────────────────────────────────────
let inspect: {
  name: string;
  id?: EntityId;
  rulings: string[] | null;   // null = still loading
  error?: string;
} | null = null;

function openInspector(name: string, id?: EntityId): void {
  inspect = { name, id, rulings: null };
  render();
  fetch(`/api/cardinfo?name=${encodeURIComponent(name)}`)
    .then(r => r.json())
    .then((r: { rulings?: unknown[]; error?: string }) => {
      if (!inspect || inspect.name !== name) return;
      inspect.rulings = (r.rulings ?? []).map(x => String(x));
      inspect.error = r.error;
      render();
    })
    .catch(() => { if (inspect?.name === name) { inspect.rulings = []; inspect.error = 'rulings unavailable (judge offline?)'; render(); } });
}

function inspectorHtml(): string {
  if (!inspect) return '';
  const name = inspect.name;
  let text = '', type = '';
  try { const c = getCard(name); text = c.text; type = c.type; } catch { /* unknown */ }
  // the details screen leads with the box AS THE GAME SEES IT: live when
  // there is a unit behind it, printed otherwise
  const u = inspect.id !== undefined ? h.state.entities[inspect.id] : undefined;
  const box = u ? entityTextBox(q(), u) : printedTextBox(name);
  // every attribute on that box gets its reminder text — including the ones
  // that are switched off, which is exactly when a player goes looking
  const attrs = box.attrs.map(a => a.attr);
  const attrRows = box.attrs.length
    ? box.attrs.map(a => `<div class="attrgloss${a.active ? '' : ' off'}">${
        glossRow(GLOSSARY.find(e => e.term === a.attr) ?? { term: a.attr, text: 'see the rules reference' })
      }</div>`).join('')
    : '<div class="hint">no attributes</div>';
  // Playtest ask: every keyword this card (or a ruling about it) MENTIONS gets
  // its reminder text right here, not behind the ? button. Scanned from the
  // printed text, the type line, the text of any mod riding on this unit, and
  // the rulings — minus the card's own attributes, which have their own
  // section directly above.
  const modTexts = (u?.mods ?? []).map(mid => {
    const m = h.state.entities[mid];
    try { return m ? getCard(m.card).text : ''; } catch { return ''; }
  });
  const referenced = glossaryHits(
    [type, text, ...modTexts, ...(inspect.rulings ?? [])], { skip: attrs });
  // R69 + UZRG ("Primordial Coalescence isn't showing the Tokens it creates"):
  // the DECLARED creates list, plus an inflection-tolerant scan of the box the
  // inspector is actually showing — so a token named in granted (R63) or
  // donated text counts, and "Wraiths" finds Wraith.
  const tokenRows = tokensCreatedBy(name, u ? { e: q(), unit: u } : undefined)
    .map(tokenRowHtml).join('');
  const refRows = referenced.length
    ? referenced.map(glossRow).join('')
    : `<div class="hint">${inspect.rulings === null
      ? 'checking the text and rulings…' : 'nothing else to explain'}</div>`;
  const rulings = inspect.rulings === null
    ? '<div class="hint">loading rulings…</div>'
    : inspect.rulings.length
      ? inspect.rulings.map(r => `<div class="rulingrow">${esc(r)}</div>`).join('')
      : `<div class="hint">no recorded rulings for this card${inspect.error ? ` (${esc(inspect.error)})` : ''}</div>`;
  return `<div class="overlay mainonly"><div class="overlaybox inspectbox">
    <h3>${esc(name)} <span class="hint">${iconizeText(type)}</span></h3>
    <div class="inspectscroll">
      <div class="inspecttop"><img src="${art(name)}" alt="" onerror="this.style.display='none'">
        <div class="inspecttext">${textBoxHtml(box, { noTitle: true })}</div></div>
      <h4>Attributes${u ? ' (current, shared/granted included)' : ' (printed)'}</h4>
      ${attrRows}
      ${tokenRows ? `<h4>Tokens it creates</h4>${tokenRows}` : ''}
      <h4>Referenced rules <span class="hint">— named in the text${
        inspect.rulings?.length ? ' or the rulings' : ''}</span></h4>
      ${refRows}
      <h4>Rulings</h4>
      ${rulings}
    </div>
    <div class="judgerow">
      <button data-btn="inspectjudge" data-name="${esc(name)}">⚖ Ask the judge about ${esc(name)}</button>
      <button data-btn="inspectclose">Close</button>
    </div>
  </div></div>`;
}

function judgeOverlayHtml(): string {
  const rows = judgeLog.map(e => `
    <div class="judgeq">Q: ${esc(e.q)}</div>
    <div class="judgea">${esc(e.a).replace(/\n/g, '<br>')}${e.cards.length
      ? `<div class="hint">cards: ${e.cards.map(c => `<span data-prev="${esc(c.title)}">${esc(c.title)}</span>`).join(' · ')}</div>` : ''}</div>`).join('');
  return `<div class="overlay mainonly"><div class="overlaybox judgebox">
    <h3>⚖ Judge — ask the rules bot</h3>
    <div class="judgescroll">${rows || '<div class="hint">Ask anything — answers come from the rules corpus (Manual, rulebook, designer Q&A).</div>'}
      ${judgeBusy ? '<div class="hint">thinking…</div>' : ''}</div>
    <div class="judgerow">
      <input id="judge-q" placeholder="e.g. can a Feeble unit be sent to counterattack?" ${judgeBusy ? 'disabled' : ''}>
      <button class="primary" data-btn="judgeask" ${judgeBusy ? 'disabled' : ''}>Ask</button>
    </div>
    <button data-btn="judgeclose">Close</button>
  </div></div>`;
}

function askJudge(question: string): void {
  judgeBusy = true;
  render();
  fetch('/api/judge', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question }),
  }).then(r => r.json()).then((r: { answer?: string; cited_cards?: { title: string }[]; detail?: string }) => {
    judgeLog.push({ q: question, a: r.answer ?? r.detail ?? 'no answer', cards: r.cited_cards ?? [] });
  }).catch(err => {
    judgeLog.push({ q: question, a: `could not reach the judge: ${err}`, cards: [] });
  }).finally(() => {
    judgeBusy = false;
    render();
    const box = document.querySelector('.judgescroll');
    if (box) box.scrollTop = box.scrollHeight;
  });
}

function battleHtml(): string {
  const b = h.state.battle;
  if (!b) return '';
  const A = h.state.players[b.attacker]!.name, D = h.state.players[b.defender]!.name;

  if (b.step === 'declare') {
    // the seat that is NOT declaring watches it happen (playtest 2026-08-20:
    // "it'd be cool to see their thought process… live")
    if (NET && b.attacker !== NET.seat) return watchingHtml(A, 'is choosing an attack');
    const cols = ui.columns.map((col, ci) => colBuilderHtml(col, ci)).join('');
    const extra = colBuilderHtml([], ui.columns.length);
    // ZQPC: a token you have picked up to bring along leaves the quiet "spell
    // tokens" strip and stands WITH the attack, next to the columns it is
    // joining — the one place a riding token has to stay legible.
    const riding = ui.spellTokens
      .map(id => h.state.entities[id]).filter((t): t is Entity => !!t);
    const rideCol = riding.length
      ? `<div class="col ridecol"><div class="collabel">${txtIcon('battle', '[battle]')} riding along</div>
          <div class="sendrow">${riding.map(t => tokenHtml(t)).join('')}</div></div>`
      : '';
    return `<div class="battle"><h3>${txtIcon('battle', '[battle]')} ${esc(A)} declares an attack — round ${b.round}${b.attackerPool ? ' (sent units only)' : ''}</h3>
      <div style="color:var(--dim);margin-bottom:6px">Click one of your units, then a slot. Front row first, 2 max per column.
        Click your spell tokens to bring them along.${ui.spellTokens.length ? ` <b>${ui.spellTokens.length} token${ui.spellTokens.length === 1 ? '' : 's'} riding.</b>` : ''}</div>
      <div class="cols">${cols}${extra}${rideCol}</div></div>`;
  }

  // table orientation: YOUR units sit BELOW the vs-line, the opponent's above
  // (net mode; hotseat keeps attacker-on-top). Default layout has the
  // attacker on top — flip when the viewer IS the attacker.
  const flip = NET ? NET.seat === b.attacker : false;
  const iBlock = !NET || b.defender === NET.seat;
  // #2: fronts stay on one shared line — each side lives in a fixed-height
  // half anchored against the vs line; extra depth grows AWAY from the front
  // (.bhalf.top is column-reverse, so the FIRST unit — the front — hugs the line)
  //
  // playtest DEYK: "the fact that, at every point during attacks, you can see
  // the whole column, including the back row (which might be totally empty)
  // takes up space. All the needed slots should be shown when there's a
  // choice to be made, but otherwise the visual space should be simplified."
  // So the shared height is now the DEEPEST column actually in play rather
  // than a hardcoded two rows — the fronts still line up, but a battle of
  // one-unit columns stops reserving a second row nobody is standing in.
  const atkRows = halfRows(b.columns.map(col => col.filter(id => h.state.entities[id])));
  const blkCols = b.columns.map((_col, ci) => b.step === 'blocks'
    ? (iBlock ? (ui.columns[ci] ?? []) : (NET?.building?.cols[ci] ?? []))
    : (b.blocks[ci] ?? []));
  // …except while you are BUILDING a block: then every slot has to be
  // reachable, so the full depth comes back for exactly as long as the choice
  // is yours to make.
  const blkRows = halfRows(blkCols, b.step === 'blocks' && iBlock);
  const topRows = flip ? blkRows : atkRows;
  const botRows = flip ? atkRows : blkRows;
  const attackCols = b.columns.map((col, ci) => {
    const blockers = b.blocks[ci] ?? [];
    const blockBuild = b.step === 'blocks'
      ? (iBlock ? blockBuilderHtml(ci) : pendingColHtml(NET?.building?.cols[ci] ?? []))
      : blockers.map(id => h.state.entities[id] ? unitHtml(h.state.entities[id]!) : '').join('');
    // the "nothing here" markers are a thin strip, not a card-sized hole: the
    // half already reserves the height it needs, so the label only has to say
    // the word
    const atkSide = col.map(id => h.state.entities[id] ? unitHtml(h.state.entities[id]!) : '').join('') || '<div class="slot ghost">gone</div>';
    const blkSide = blockBuild || '<div class="slot ghost">unblocked</div>';
    const top = flip ? blkSide : atkSide;
    const bottom = flip ? atkSide : blkSide;
    return `<div class="col"><div class="collabel">column ${ci + 1}</div>
      <div class="bhalf top">${top}</div>
      <div class="vs" style="width:100%"></div>
      <div class="bhalf bot">${bottom}</div>
    </div>`;
  }).join('');
  const colsStyle = `--rowstop:${topRows};--rowsbot:${botRows}`;
  const sendEntHtml = (id: EntityId): string => {
    const en = h.state.entities[id];
    if (!en) return '';
    return en.kind === 'spellToken'
      ? cardHtml(en.card, { stats: 'X=' + en.x, selected: true, data: `data-act="token" data-id="${en.id}"` })
      : unitHtml(en, { selected: true });
  };
  // counterattackers lay out ACROSS, not down — the list has no 2-per-column
  // limit to keep it short, so stacking it vertically was the one part of the
  // battle panel that could grow without bound ("it'd be way easier to see
  // horizontally. We have a good amount of space to go to the right").
  const sendZone = (b.step === 'blocks' && b.round === 1)
    ? (iBlock
      ? `<div class="col sendcol"><div class="collabel">send to counterattack</div>
          <div class="sendrow">${ui.send.map(sendEntHtml).join('')}
          <div class="slot ${ui.carrying ? 'open' : ''}" data-act="sendslot">send</div></div></div>`
      : (NET?.building?.send?.length
        ? `<div class="col sendcol"><div class="collabel">being sent to counterattack</div>
            ${pendingColHtml(NET.building.send, { across: true })}</div>` : ''))
    : '';
  const stepLabel: Record<string, string> = {
    attackWindow: 'response window (attack)', blocks: `${esc(D)} declares blocks & counterattackers`,
    blockWindow: 'response window (blocks)', afterWindow: 'after combat',
  };
  return `<div class="battle"><h3>${txtIcon('battle', '[battle]')} ${esc(A)} attacks ${esc(D)} — ${stepLabel[b.step] ?? b.step}</h3>
    <div class="cols" style="${colsStyle}">${attackCols}${sendZone}</div></div>`;
}

/**
 * The opponent's half-built column, read-only: the units they have slid into
 * place so far. Inert — not clickable, not targetable — and marked `pending`
 * so it never reads as a committed declaration.
 */
function pendingColHtml(col: EntityId[], opts: { across?: boolean } = {}): string {
  const cards = col.map(id => {
    const u = h.state.entities[id];
    return u ? unitHtml(u, { inert: true }) : '';
  }).join('');
  const cls = `pendingcol${opts.across ? ' across' : ''}`;
  return cards ? `<div class="${cls}">${cards}</div>` : '<div class="slot ghost">…</div>';
}

/** the whole battle panel while the OTHER seat declares: their formation as
 * it is being built, with nothing of mine to click */
function watchingHtml(who: string, doing: string): string {
  // keep each column's TRUE index — the label is "column 3", so dropping the
  // empty ones before numbering would rename the ones that are left
  const cols = (NET?.building?.cols ?? []).map((c, ci) => ({ c: c ?? [], ci }))
    .filter(x => x.c.length);
  const sending = NET?.building?.send ?? [];
  const body = cols.length
    ? `<div class="cols">${cols.map(({ c, ci }) =>
        `<div class="col"><div class="collabel">column ${ci + 1}</div>${pendingColHtml(c)}</div>`).join('')}</div>`
    : '<div style="color:var(--dim)">nothing placed yet…</div>';
  const sent = sending.length
    ? `<div class="collabel">sending to counterattack</div>
       <div class="cols"><div class="col sendcol">${pendingColHtml(sending, { across: true })}</div></div>` : '';
  return `<div class="battle watching"><h3>${txtIcon('battle', '[battle]')} ${esc(who)} ${esc(doing)}…
      <span class="livedot">● live</span></h3>
    <div style="color:var(--dim);margin-bottom:6px">You are watching them build it — nothing is committed until they confirm.</div>
    ${body}${sent}</div>`;
}

function colBuilderHtml(col: EntityId[], ci: number): string {
  return `<div class="col"><div class="collabel">column ${ci + 1}</div>${colSlotsHtml(col, ci)}</div>`;
}
/** the two rows of one column being built: a unit, or an open slot you can
 * drop into. Both rows are always offered (playtest: the back row used to
 * appear only once the front was filled, which forced a click order) — and
 * both are always DRAWN, because the half reserves room for two rows while a
 * choice is live and an undrawn back row just left a hole in it. */
function colSlotsHtml(col: EntityId[], ci: number): string {
  const u0 = col[0] !== undefined ? h.state.entities[col[0]] : undefined;
  const u1 = col[1] !== undefined ? h.state.entities[col[1]] : undefined;
  const front = u0 ? unitHtml(u0, { selected: true }) : slotHtml(ci, 0, !!ui.carrying);
  const back = u1 ? unitHtml(u1, { selected: true }) : slotHtml(ci, 1, !!ui.carrying);
  return front + back;
}
function slotHtml(ci: number, row: number, open: boolean): string {
  return `<div class="slot ${open ? 'open' : ''}" data-act="slot" data-ci="${ci}" data-row="${row}"
    title="${row === 0 ? 'front row — takes the damage, and dropping here pushes a unit already standing there to the back' : 'back row'}">${row === 0 ? 'front' : 'back'}</div>`;
}
function blockBuilderHtml(ci: number): string {
  return colSlotsHtml(ui.columns[ci] ?? [], ci);
}

/** #4: the mod-in-progress banner — spells out card, source zone and mode,
 * and points at the highlighted legal hosts (modHostCache glows them) */
function moddingBarHtml(err: string): string {
  const m = ui.modding!;
  const card = zoneCardName(m.seat, m.from, m.index) ?? '?';
  const icon = txtIcon(m.mode === 'graft' ? 'graft' : 'augment', m.mode === 'graft' ? '[Switch]' : '[Augment]');
  const nHosts = modHostCache.size;
  // R42: a fulfilled prophecy makes the graft/augment free too, not only the play
  const free = m.from === 'cache' && q().cachePermission(m.seat, m.index) === 'prophecy'
    ? ' <span class="freetag">FREE — fulfilled prophecy</span>' : '';
  return `<div class="promptbar pending"><span class="who">${esc(h.state.players[m.seat]!.name)}:</span>
    applying <b>${esc(card)}</b> from ${zoneLabel(m.from)}${free} as ${icon} <b>${m.mode}</b>
    — pick a glowing host unit${nHosts ? ` (${nHosts} legal)` : ''}
    <button data-btn="modcancel">✕ cancel (esc)</button>${err}</div>`;
}

function promptHtml(): string {
  const s = h.state;
  const err = uiError ? `<span style="color:var(--danger)"> ✗ ${esc(uiError)}</span>` : '';
  // playtest: an irreversible activation that will not stop to ask for a
  // target asks here instead. Takes precedence over every other prompt — it is
  // a modal question about something you already clicked.
  if (ui.confirmAct) {
    const a = ui.confirmAct;
    return `<div class="promptbar pending"><span class="who">${esc(s.players[a.seat]!.name)}:</span>
      activate <b>${esc(a.unit)}</b> — ${iconizeText(a.label)}?
      <span style="color:var(--dim)">this cost cannot be taken back</span>
      <button data-btn="actcancel">Cancel</button>
      <button class="primary" data-btn="actconfirm">Yes, activate</button>${err}</div>`;
  }
  if (s.phase === 'gameover') {
    const won = s.players[s.winner!]!.name;
    // net games get the full post-game screen; this bar is what is behind it
    // once you dismiss it to look at the board, so it has a way back
    if (NET) return `<div class="promptbar"><span class="who">${s.winner === NET.seat ? 'You win! 🎉' : `${esc(won)} wins.`}</span>
      ${postGame ? '<button data-btn="pg-reopen">Post-game summary</button>' : ''}</div>`;
    return `<div class="promptbar"><span class="who">${esc(won)} wins!</span>
      <button data-btn="restart">New game</button></div>`;
  }
  // Playtest 2026-08-20: "when a decision is pending for the other player I
  // get the window for priority and it asks me to pass, but I can't." The
  // server redacts the opponent's decision to null (view.ts — its options are
  // private), so the client fell through to the ordinary priority bar and
  // offered a button the server would refuse. It does not need the decision to
  // know: an EMPTY legal-action list means nothing at all is mine to do.
  if (NET && !s.decision && !NET.legal.length) {   // gameover returned above
    const opp = esc(s.players[other(NET.seat)]!.name);
    // R78: WHY you are waiting, when the state can say. `resolving` names the
    // effect outright; the cast watch reports only what it observed. Both live
    // in ui/inspect.ts (waitingNote), which is where the judgement is tested.
    return `<div class="promptbar waiting"><span class="who">Waiting for ${opp}…</span>
      <span style="color:var(--dim)">${esc(waitingNote(s, castWatch?.casting ?? false))}</span>${err}</div>`;
  }
  const dec = s.decision;
  if (dec) {
    const who = esc(s.players[dec.seat]!.name);
    // A2: options that ARE cards (hand looks, deck tops, bin picks) render as
    // clickable scans; the rest stay ordinary buttons after them
    const split = partitionOptions(dec.options);
    const cardRow = (btn: string, skip?: (i: number) => boolean): string => {
      const cards = dec.options.map((o, i) => (o.card && !skip?.(i))
        ? cardHtml(o.card, { playable: true, data: `data-btn="${btn}" data-i="${i}"${pingAttrs(o)}` }) : '').join('');
      return cards ? `<div class="deccards">${cards}</div>` : '';
    };
    /** one option as a real button (ui/inspect.ts decides which bucket it is in) */
    const optBtn = (i: number, cls = ''): string => {
      const o = dec.options[i]!;
      return `<button ${cls ? `class="${cls}" ` : ''}data-btn="decide" data-i="${i}"${
        pingAttrs(o)}>${iconizeText(o.label)}</button>`;
    };
    if (dec.kind === 'targets') {
      // UZRG, and the expensive one: a ref-valued option ({stack:96}) used to
      // render NO button at all — you had to find and click the highlighted
      // card in the floating stack window. With min:0 the engine adds "No more
      // targets" from the very first slot, so the ONLY button in the bar was
      // the decline, in the same screen position the player had just clicked
      // ten times to pay a 10-card cost. Every option gets a real button now,
      // and the decline is last and secondary.
      const picks = [...split.refs, ...split.plain].map(i => optBtn(i)).join(' ');
      const declines = split.decline.map(i => optBtn(i, 'declinebtn')).join(' ');
      return `<div class="promptbar pending"><span class="who">${who}:</span>
        ${iconizeText(dec.prompt)}${split.refs.length ? ' — click a highlighted target, or pick one here' : ''}
        ${cardRow('decide')} <span class="decpicks">${picks}</span>
        ${declines ? `<span class="decdecline">${declines}</span>` : ''} ${castCancelBtnHtml()}${err}</div>`;
    }
    if (dec.kind === 'orderTriggers') {
      const btns = dec.options.map((o, i) => ui.orderPicked.includes(i)
        ? `<span style="color:var(--dim)">${ui.orderPicked.indexOf(i) + 1}. ${iconizeText(o.label)}</span>`
        : o.card ? '' : `<button data-btn="orderpick" data-i="${i}"${pingAttrs(o)}>${iconizeText(o.label)}</button>`).join(' ');
      return `<div class="promptbar pending"><span class="who">${who}:</span>
        ${iconizeText(dec.prompt)} — ${cardRow('orderpick', i => ui.orderPicked.includes(i))} ${btns}${err}</div>`;
    }
    // payOrDecline / electricPath: cards, then the affirmative
    // options, then the decline — same ordering rule as the targets bar, so
    // "stop" is never where "go" was a click ago
    const btns = [...split.refs, ...split.plain].map(i => optBtn(i)).join(' ');
    const declines = split.decline.map(i => optBtn(i, 'declinebtn')).join(' ');
    return `<div class="promptbar pending"><span class="who">${who}:</span> ${iconizeText(dec.prompt)}
      ${cardRow('decide')} <span class="decpicks">${btns}</span>
      ${declines ? `<span class="decdecline">${declines}</span>` : ''} ${castCancelBtnHtml()}${err}</div>`;
  }
  // network mode: if the current control belongs to the opponent, show a wait
  // banner instead of the opponent's buttons (their turn is theirs to drive).
  if (NET && !ui.modding) {
    const seat = NET.seat, b = s.battle;
    const mine =
      (s.phase === 'planning' && s.hasteDone) ? !s.hasteDone[seat] :
      (s.phase === 'planning') ? !s.planningDone[seat] :
      (s.phase === 'battle' && b?.step === 'declare') ? b.attacker === seat :
      (s.phase === 'battle' && b?.step === 'blocks') ? b.defender === seat :
      (s.phase === 'battle') ? s.priority === seat :
      (s.phase === 'deploy') ? !!s.deployDone && !s.deployDone[seat] : false;
    if (!mine) {
      const note = NET.peers[other(seat)] ? '' : ' <span style="color:var(--dim)">(opponent not connected yet)</span>';
      const flavor = s.phase === 'deploy'
        ? 'Waiting — your opponent is still deploying (hidden). Their moves will be revealed when they finish.'
        : 'Waiting for opponent…';
      return `<div class="promptbar"><span class="who">${flavor}</span>${note}${err}</div>`;
    }
  }
  const doneRow = (done: boolean[], btn: string, label: string): string =>
    ([0, 1] as Seat[]).map(p => (done[p] || (NET && p !== NET.seat))
      ? `<span style="color:var(--dim)">${esc(s.players[p]!.name)} ${done[p] ? 'ready ✓' : '…'}</span>`
      : `<button data-btn="${btn}" data-p="${p}" title="hotkey: enter">${esc(s.players[p]!.name)}: ${label} (enter)</button>`).join(' ');
  if (s.phase === 'planning' && s.hasteDone) {
    return `<div class="promptbar"><span class="who">Haste step</span>
      Play haste cards (they resolve immediately). ${doneRow(s.hasteDone, 'donehaste', 'done')}${err}</div>`;
  }
  if (s.phase === 'planning' && s.mode === 'draft' && s.draftDone) {
    if (NET && s.draftDone[NET.seat]) {
      return `<div class="promptbar"><span class="who">Draft</span>
        You passed your pack — your opponent is still drafting… You can keep planning meanwhile.
        ${doneRow(s.planningDone, 'doneplan', 'done planning')}${err}</div>`;
    }
    return `<div class="promptbar pending"><span class="who">Draft step</span>
      Combine your hand and pack below, then leave exactly 10 cards in the pack.${err}</div>`;
  }
  if (s.phase === 'planning') {
    if (ui.confirmDone !== null) {
      const p = ui.confirmDone;
      const pl = s.players[p]!;
      const dormant = pl.resources.filter(r => r.state === 'dormant').length;
      return `<div class="promptbar pending"><span class="who">${esc(pl.name)}:</span>
        you still have <b>${pl.activationsLeft} activation${pl.activationsLeft === 1 ? '' : 's'}</b> and
        <b>${dormant} dormant resource${dormant === 1 ? '' : 's'}</b> — activate them this turn?
        <button data-btn="doneplancancel">Go back (esc)</button>
        <button class="primary" data-btn="doneplanconfirm" data-p="${p}">Really done (enter)</button>${err}</div>`;
    }
    return `<div class="promptbar"><span class="who">Planning</span>
      Click a hand card to recycle it into a resource; click dormant resources to activate (max 2). ${doneRow(s.planningDone, 'doneplan', 'done planning')}${err}</div>`;
  }
  if (s.phase === 'battle') {
    const b = s.battle!;
    if (b.step === 'declare') {
      const built = ui.columns.some(c => c.length) || ui.spellTokens.length > 0;
      return `<div class="promptbar"><span class="who">${esc(s.players[b.attacker]!.name)}:</span> build your attack
        <button data-btn="attackall" title="every eligible unit joins, one per column — adjust before confirming">${txtIcon('battle', '[battle]')} Attack with everything</button>
        <button class="primary" data-btn="confirmattack" ${ui.columns.some(c => c.length) ? '' : 'disabled'}>Attack! (enter)</button>
        <button data-btn="skipattack">Don't attack</button>
        ${built ? '<button data-btn="clearform" title="empty the formation being built">✕ Clear (esc)</button>' : ''}${err}</div>`;
    }
    if (b.step === 'blocks') {
      const built = ui.columns.some(c => c && c.length) || ui.send.length > 0;
      return `<div class="promptbar"><span class="who">${esc(s.players[b.defender]!.name)}:</span>
        assign blockers (click unit, then slot)${b.round === 1 ? ' and optionally send counterattackers' : ''}
        <button class="primary" data-btn="confirmblocks">Confirm (enter)</button>
        ${built ? '<button data-btn="clearform" title="empty the blocks/send being built">✕ Clear (esc)</button>' : ''}${err}</div>`;
    }
    if (ui.modding) return moddingBarHtml(err);
    if (ui.confirmPass !== null) {
      // C5: passing away castable spell tokens wants a second look
      const n = castableTokenCount(s.priority!);
      return `<div class="promptbar pending"><span class="who">${esc(s.players[s.priority!]!.name)}:</span>
        you still have <b>${n} castable spell token${n === 1 ? '' : 's'}</b> — pass anyway?
        <button data-btn="passcancel">Go back</button>
        <button class="primary" data-btn="passconfirm">Pass anyway (space)</button>${err}</div>`;
    }
    return `<div class="promptbar"><span class="who">${esc(s.players[s.priority!]!.name)}:</span>
      you have priority — play a battle card / cast a token / virus-augment, or
      <button class="primary" data-btn="pass">Pass (space)</button>
      ${NET ? `<button data-btn="passall" title="keep passing until the battle ends or something new is played">Pass all</button>` : ''}
      <span style="color:var(--dim)">(both pass: ${s.stack.length ? 'resolve top of stack' : `move to ${nextBattleStepName()}`})</span>${err}</div>`;
  }
  if (s.phase === 'deploy') {
    if (ui.modding) return moddingBarHtml(err);
    const dd = s.deployDone ?? s.players.map(() => true);
    // playtest: the cache is a zone nobody has muscle memory for, and a
    // prophecy you paid for is easy to walk past. Name the cards, don't just
    // count them, and make "end anyway" the deliberate second click.
    if (ui.confirmDeploy !== null) {
      const names = playableCached(ui.confirmDeploy);
      return `<div class="promptbar pending"><span class="who">${esc(s.players[ui.confirmDeploy]!.name)}:</span>
        you can still play <b>${names.length}</b> card${names.length === 1 ? '' : 's'} from your cache —
        <span class="cachenames">${names.map(n => `<span data-prev="${esc(n)}">${esc(n)}</span>`).join(', ')}</span>
        <button data-btn="deploycancel">Go back</button>
        <button class="primary" data-btn="deployconfirm">End deployment anyway</button>${err}</div>`;
    }
    return `<div class="promptbar"><span class="who">Deployment</span>
      both players deploy at the same time — moves stay hidden until everyone is done.
      Play cards, mod units (augment/graft from hand or bin), activate abilities.
      ${doneRow(dd, 'donedeploy', 'done deploying')}${err}</div>`;
  }
  return `<div class="promptbar">${esc(s.phase)}${err}</div>`;
}

// ── game log styling ──────────────────────────────────────────────────
/** EventType per log line, index-aligned with `h.log`. Both sides keep a
 * parallel array rather than indexing the event list, because not every event
 * is a log line: a signal-only event ('stackFlash') is absorbed and never
 * printed, so the two lists drift. */
function logTypeAt(i: number): EventType | undefined {
  if (NET) return NET.logTypes[i];
  return (h as Harness).logTypes[i];
}
/** The event types that earn their own colour in the log. Everything else
 * keeps the default dim line — the point is that the Light & Dark bookkeeping
 * (a zone and two counters nobody is used to watching) cannot slip past. */
const LOG_EVENT_CLASS: Partial<Record<EventType, string>> = {
  cached: 'ev-cache',
  prophesied: 'ev-cache',
  glimpsed: 'ev-cache',
  prophecyFulfilled: 'ev-prophecy',
  rotGained: 'ev-rot',
  debtGained: 'ev-debt',
  debtPaid: 'ev-debtpaid',
  trashed: 'ev-trash',
  lifeGained: 'ev-life',
};

/**
 * One log line, with every card it names made inspectable.
 *
 * UZRG: "the log and the stack are not inspectable." The engine does log X and
 * does log "Bena spawns Wraith", but `iconizeText` emitted no `data-prev`, so
 * the log was inert prose — and `data-prev` is the single hook behind the
 * hover preview, the long-hover text box AND right-click-inspect, so one
 * change buys all three. Segmenting is ui/inspect.ts's `linkCardNames`, the
 * one name-matcher in the client; this only paints the spans it returns.
 */
function logLineHtml(msg: string): string {
  return linkCardNames(msg).map(sp => sp.name
    ? `<span class="logcard" data-prev="${esc(sp.name)}">${iconizeText(sp.text)}</span>`
    : iconizeText(sp.text)).join('');
}

/** Focus-viewer body for a stack item: its art plus the text of the ABILITY
 * on the stack — each live part attributed to the card that contributed it,
 * which is the whole point for a graft stack (Manual p.33: they resolve as one
 * composed ability, and you need to see the composition). */
function previewStackHtml(id: number): string {
  const it = stackItemById(id);
  if (!it) return '';
  const abRows = stackAbilityRows(it);
  const rows = abRows.map(t => {
    const tag = t.graft ? `${txtIcon('graft', '[Switch]')} ${esc(t.source)}` : esc(t.source);
    // R64: a clause that paid its own variable cast cost defines its own X —
    // it belongs on the clause, not on the item, or a grafted rider's X and
    // its carrier's would read as the same number
    const x = t.x !== undefined
      ? `<div class="xnow xinline">X = ${t.x}${t.receipt ? ` <span class="hint">— ${esc(t.receipt)}</span>` : ''}</div>` : '';
    return `<div class="abrow"><span class="absrc">${tag}</span>${iconizeText(t.text)}${x}</div>`;
  }).join('');
  // UZRG: "it's not possible to see the X value for an effect while it's on
  // the stack." This viewer replaces the label with ability rows, and the label
  // was the ONLY string carrying X (apply.ts rewrites it to "Card (X=n)") — so
  // for any real spell the X was exactly what got dropped. Same badge as the
  // hand card's live X preview: one presentation for one idea. Rows already
  // attributed to a clause above are not repeated here.
  const shown = new Set(abRows.filter(r => r.x !== undefined).map(r => r.part));
  const xRows = stackItemX(it)
    .filter(r => r.part === undefined || !shown.has(r.part))
    .map(r => `<div class="xnow">X = ${r.x} <span class="hint">— ${
      r.kind === 'cast' ? 'cast for X' : `${esc(r.source ?? 'additional cost')}${r.receipt ? `, ${esc(r.receipt)}` : ''}`
    }</span></div>`).join('');
  const targets = it.parts.flatMap(p => p.targets).map(tgtLabel).join(', ');
  const composed = it.parts.filter(p => !p.spent).length > 1;
  // {Modular}: mods applied as the card was PLAYED ride on the stack with it
  // (Caleb 2025-02-07). The label names them, but the label is one line of
  // text — the chips make them the separate, hoverable cards they are.
  const mods = it.mods ?? [];
  const modChips = mods.length
    ? `<div class="stackmods">${mods.map(m =>
        `<span class="badge mod" data-prev="${esc(m.card)}">${txtIcon('graft', '[Switch]')}${esc(m.card)}
          <span class="modfrom">from ${esc(m.from)}</span></span>`).join('')}</div>`
    : '';
  return `${it.card ? `<img src="${art(it.card)}" alt="" onerror="this.style.display='none'">` : ''}
    <div class="abilitybox">
      <div class="abhead">${esc(STACK_KIND[it.kind] ?? it.kind)}${composed ? ' — resolves as ONE composed ability' : ''}</div>
      ${xRows}
      ${rows || `<div class="hint">${iconizeText(it.label)}</div>`}
      ${modChips}
      ${targets ? `<div class="abtargets">→ ${targets}</div>` : ''}
      ${it.negated ? '<div class="abneg">answered — it left the stack and will do nothing</div>' : ''}
    </div>`;
}

/** How wide the row of stack cards may get, in `--cw` units. Shared with the
 * window's max-width (style.css `.stackboard.live`) — change both together. */
const STACK_SPAN = 3;
/** one card's width, in `--cw` units (style.css `.stackcard`) */
const STACK_CARD = 1.05;
/** how far each card advances when there is room to spare */
const STACK_STEP_MAX = 0.55;

/** StackItem.kind, in words a player uses. The engine's names are internal
 * ('spellUnit', 'triggered'), and the tag under a stack card is two words of
 * space. */
const STACK_KIND: Record<string, string> = {
  unit: 'unit', spell: 'spell', spellUnit: 'spell unit', spellToken: 'token',
  virus: 'virus', triggered: 'trigger', activated: 'ability', ambush: 'ambush',
};

/**
 * The stack, ON THE TABLE, as cards.
 *
 * Playtest 2026-08-21: "the effects go on as list items… it would be better to
 * have a little horizontal stack using actual visual cards, slightly
 * overlapping, on the field". So this is a strip of real card scans between
 * the two regions — the middle of the table, where you are already looking —
 * rather than a bulleted list off in the side rail. Cards overlap left to
 * right in the order they went on, so the newest is on top and on the right,
 * which is also the one that resolves next.
 *
 * The rows come from ui/flash.ts, which mixes in items that resolved with no
 * response window and so never touched state.stack at all. Those are drawn as
 * cards like any other, marked as already-resolved, for one beat each.
 *
 * R78 adds the third kind of row: the item that is resolving RIGHT NOW. Playtest
 * round 13: "to my opponent, it looks like something already resolved… it would
 * make more sense if there was a different state before resolution like
 * 'Opponent is resolving [effect]'". It is off state.stack (so the "negate every
 * effect on the stack" sweeps cannot reach it) but it has not happened yet, so
 * it goes on the strip rightmost, teal and breathing, and the caption names its
 * controller. Which row is which, and what the caption says, is decided in
 * ui/flash.ts (stackRows / stackCaption) where it is tested; this only paints.
 */
function stackBoardHtml(): string {
  const rows = visualStack();
  // Out of the flow it can simply not be there: an empty floating window is
  // clutter, and there is no layout to hold open. The motion layer only needs
  // the @stack anchor in the frame where a card is actually going to or
  // leaving it, and in both of those the window exists.
  if (!rows.length) return '';
  // However deep the stack gets, the window stays the same width: the cards
  // close ranks instead of marching off across the table. STACK_SPAN is shared
  // with the window's max-width in style.css, so the row can never outgrow the
  // box it lives in — at the cost of very thin slivers on an absurd stack,
  // which is an honest picture of an absurd stack.
  const step = rows.length > 1
    ? Math.min(STACK_STEP_MAX, (STACK_SPAN - STACK_CARD) / (rows.length - 1))
    : STACK_STEP_MAX;
  // Only the RIGHTMOST card wears a floating chip: every other card is
  // overlapped from the right by its neighbour, which would eat the label.
  // The buried ones say what they are in their own tag instead.
  const last = rows.length - 1;
  const cards = rows.map((r, i) => {
    const it = r.item;
    const mods = it.mods ?? [];
    // a modular item's extra parts ARE its mods' [Switch] effects — don't
    // double-count them as "grafted parts"
    const extraParts = it.parts.length - 1 - mods.length;
    const marks = [
      // R68: a beat is either "it happened" or "it was answered" — never both,
      // and never neither. `negated` reaches this client only on a flash
      // snapshot (ui/flash.ts negatedFlashItems); GameState never carries it.
      // R78 adds the third, mutually exclusive state: still going.
      r.resolving ? 'resolving' : r.flashing ? (it.negated ? 'answered' : 'resolved') : '',
      // UZRG: X, on EVERY card. The caption under the row only ever describes
      // the lead item, and a stack four deep has four X's to answer for.
      stackXMark(it),
      extraParts > 0 ? `${extraParts + 1}×` : '',
      mods.length ? `${txtIcon('graft', '[Switch]')}${mods.length}` : '',
    ].filter(Boolean).join(' · ');
    const cls = [
      'stackcard',
      r.flashing ? 'flashing' : '',
      r.resolving ? 'resolving' : '',   // R78: pending, not finished (style.css)
      r.top ? 'top' : '',
      it.negated ? 'negated' : '',   // greys it and stamps the ✕ (style.css)
      isCandidate({ stack: it.id }) ? 'candidate' : '',
      // whose it is, at a glance: net mode knows which seat is you, hotseat
      // colours by seat number instead
      NET ? (it.controller === NET.seat ? 'mine' : 'theirs') : `seat${it.controller}`,
    ].filter(Boolean).join(' ');
    const face = it.card
      ? `<img src="${art(it.card)}" alt="" onerror="this.parentElement.classList.add('noart')">`
      : '';
    // UZRG: a stack card carried data-prevstack but no data-prev, so the
    // contextmenu handler's closest('[data-prev], [data-previd]') never matched
    // one — right-click-inspect could not fire on the stack at all, and the
    // auto-yield-on-trigger branch behind it was dead code. Name the card the
    // item is ABOUT (a trigger has none of its own: use its source unit), and
    // only when it really is a card — the label is prose, not a lookup key.
    const prevName = it.card ?? (it.sourceId !== undefined ? h.state.entities[it.sourceId]?.card : undefined);
    return `<div class="${cls}" style="z-index:${i + 1}"
      data-act="stackitem" data-id="${it.id}" data-prevstack="${it.id}" data-anim="s${it.id}"
      ${prevName ? `data-prev="${esc(prevName)}"` : ''}
      title="${esc(it.label)}">
      ${face}<div class="stackface">${esc(it.card ?? it.label)}</div>
      <div class="stacktag">${esc(STACK_KIND[it.kind] ?? it.kind)}${marks ? ` · ${marks}` : ''}</div>
      ${r.resolving
        // R78: the pending chip is NOT gated on being the rightmost card the
        // way the other two are. stackRows() puts the resolving item last so
        // in practice it is rightmost, but this is the one label that must
        // survive whatever else lands on the strip — it is the answer to "why
        // has nothing happened yet?", not a decoration.
        ? '<div class="stackbolt pending">resolving…</div>'
        : i === last && r.flashing
          ? `<div class="stackbolt${it.negated ? ' answered' : ''}">${it.negated ? 'answered' : 'resolved'}</div>`
          : ''}
      ${i === last && r.top ? '<div class="stacknext">next</div>' : ''}
    </div>`;
  }).join('');
  // one line of prose for the card that matters: what is happening right now
  // (R78), else what resolves next, else — when nothing is really on the stack
  // — what just went off. ui/flash.ts stackCaption() picks the row and the
  // words; this only paints them.
  const cap = stackCaption(rows, {
    mySeat: NET ? NET.seat : null,
    names: h.state.players.map(p => p.name),
  })!;
  const lead = cap.row.item;
  const targets = lead.parts.flatMap(p => p.targets).map(tgtLabel).join(', ');
  const by = cap.by !== null || targets
    ? `<span class="by">${cap.by !== null ? esc(cap.by) : ''}${targets ? ` → ${esc(targets)}` : ''}</span>`
    : '';
  return `<div class="stackboard live${cap.pending ? ' pending' : ''}" data-animzone="stack">
    <div class="stackrow" style="--stackstep:${step.toFixed(3)}">${cards}</div>
    <div class="stackcaption${cap.pending ? ' pending' : ''}">
      <span class="stackverb">${esc(cap.verb)}</span>
      ${iconizeText(lead.label)}${cap.pending ? '<span class="stackwait">…</span>' : ''}
      ${by}
      ${rows.length > 1 ? `<span class="stackdepth" title="${cap.pending
        ? 'one of these is resolving right now — the rest are still waiting'
        : 'the stack resolves from the right — the raised card goes first'}">${rows.length} deep ↢</span>` : ''}
    </div>
  </div>`;
}

function tgtLabel(t: TargetRef): string {
  if ('unit' in t) return esc(h.state.entities[t.unit]?.card ?? 'gone');
  if ('player' in t) return esc(h.state.players[t.player]!.name);
  // R41: a card in someone's cache (Prismatic Observer) — the zone is public
  if ('cached' in t) {
    const cc = (h.state.players[t.cached.seat]!.cache ?? []).find(c => c.uid === t.cached.uid);
    return esc(cc ? `${cc.card} (cache)` : 'gone');
  }
  // R64: a card named in a bin — the zone is public, so it always reads
  if ('bin' in t) return esc(`${t.bin.card} (bin)`);
  return esc(stackItemById(t.stack)?.label ?? 'gone');
}

function menuHtml(): string {
  if (!ui.menu) return '';
  const items = ui.menu.items.map((it, i) =>
    `<button data-btn="menuitem" data-i="${i}">${it.icon ? elIcon(it.icon) : ''}${iconizeText(it.label)}</button>`).join('');
  return `<div class="menu" style="left:${ui.menu.x}px;top:${ui.menu.y}px">${items}<button data-btn="menuclose">cancel</button></div>`;
}

/** Phase track (docs/07 §4.5): every phase visible, the current one lit —
 * including the battle SUB-step (playtest: "impossible to tell the sub phase"). */
function phaseTrackHtml(): string {
  const s = h.state;
  const subStep = (): string => {
    const b = s.battle;
    if (!b) return 'battle';
    if (b.damageStep) return `battle·r${s.battleRound}·damage`;
    const sub: Record<string, string> = {
      declare: 'attack?', attackWindow: 'responses', blocks: 'blocks?',
      blockWindow: 'responses', afterWindow: 'after-combat',
    };
    return `battle·r${s.battleRound}·${sub[b.step] ?? b.step}`;
  };
  const steps: { key: string; label: string; cur: boolean }[] = [
    { key: 'planning', label: s.mode === 'draft' && s.draftDone ? 'plan·draft' : 'plan', cur: s.phase === 'planning' && !s.hasteDone },
    { key: 'haste', label: 'haste', cur: s.phase === 'planning' && !!s.hasteDone },
    { key: 'battle', label: subStep(), cur: s.phase === 'battle' },
    { key: 'regroup', label: 'regroup', cur: s.phase === 'regroup' },
    { key: 'deploy', label: 'deploy', cur: s.phase === 'deploy' },
  ];
  if (s.phase === 'gameover') return `<span class="phasetrack"><span class="ph cur">game over</span></span>`;
  return `<span class="phasetrack">${steps.map(p =>
    `<span class="ph ${p.cur ? 'cur' : ''}">${p.label}</span>`).join('<span class="phsep">▸</span>')}</span>`;
}

/** Share banner: shown while the opponent's seat is empty in network mode.
 * Never on a finished game — there is nothing left to invite anybody to, and
 * the post-game screen is what that room is for now. */
function shareBannerHtml(): string {
  if (!NET || NET.peers[other(NET.seat)]) return '';
  if (h.state.phase === 'gameover' || postGame) return '';
  const link = `${location.origin}/?ws=1&room=${encodeURIComponent(NET.room)}&seat=${other(NET.seat)}&mode=${h.state.mode}`;
  return shareBar('Waiting for your opponent — send them the room code', NET.room, link);
}

// ── live draft (M4) ───────────────────────────────────────────────────

/** the seat whose draft step this client should render, or null.
 * Network mode: my seat while uncommitted. Hotseat: first uncommitted seat. */
function draftSeat(): Seat | null {
  const s = h.state;
  if (s.mode !== 'draft' || s.phase !== 'planning' || !s.draftDone) return null;
  if (NET) return s.draftDone[NET.seat] ? null : NET.seat;
  const pending = s.draftDone.findIndex(d => !d);
  return pending === -1 ? null : (pending as Seat);
}

/** (re)build the tentative pack marks when the draft step (re)opens */
function ensureDraftUi(): void {
  const seat = draftSeat();
  if (seat === null) { ui.draftPack = null; return; }
  const key = `${h.state.turn}:${seat}`;
  if (ui.draftFor !== key || !ui.draftPack) {
    const H = h.state.players[seat]!.hand.length;
    ui.draftPack = h.state.packs[seat]!.map((_, i) => H + i);   // keep hand as-is
    ui.draftFor = key;
  }
}

/** per-seat pack metadata the server adds to draft-mode views (additive —
 * absent on older servers and in hotseat, so consume defensively) */
interface PackInfo {
  packNumber?: number; originalSize?: number; remaining?: number;
  picksMade?: number; picksTotal?: number;
  after?: 'returns' | 'others' | 'recycled';
}

/**
 * What happens to the pack once you commit (server/view.ts PackInfo.after,
 * from engine.ts packCycle).
 *
 * The 'recycled' line is the fix for a banner that was actively lying: it used
 * to say "your opponent will see whatever you leave in it" on EVERY last look,
 * including the cycle's final one — where the leftovers go to the bottom of
 * the deck and nobody drafts them. That is the difference between a hate-draft
 * being worth a pick and being worth nothing (Bena, playtest 2026-08-20).
 */
const PACK_FATE: Record<string, { cls: string; html: string }> = {
  returns: {
    cls: 'packback',
    html: 'this pack <b>comes back to you</b> later this cycle — what you leave, your opponent picks from first',
  },
  others: {
    cls: 'lastlook',
    html: 'your <b>last look</b> at this pack — after this commit it never comes back to you, and your opponent drafts whatever you leave in it',
  },
  recycled: {
    cls: 'lastlook final',
    html: '<b>final look</b> — this pack is retired after this commit: what you leave is shuffled into the bottom of the deck, and <b>nobody</b> drafts from it again',
  },
};

/** #5: "Pack #N · pick M of T (X of Y cards left)" + what happens to it next */
function packInfoHtml(): string {
  const pi = (h.state as GameState & { packInfo?: PackInfo }).packInfo;
  if (!pi || typeof pi !== 'object' || typeof pi.packNumber !== 'number') return '';
  const of = typeof pi.picksTotal === 'number' ? ` of ${pi.picksTotal}` : '';
  const pick = typeof pi.picksMade === 'number' ? ` · pick ${pi.picksMade + 1}${of}` : '';
  const count = typeof pi.remaining === 'number' && typeof pi.originalSize === 'number'
    ? ` (${pi.remaining} of ${pi.originalSize} cards left)` : '';
  const fate = PACK_FATE[pi.after ?? ''];
  const note = fate ? `<div class="${fate.cls}">${fate.html}</div>` : '';
  return `<div class="packrow"><span class="packinfo">Pack #${pi.packNumber}${pick}${count}</span>${note}</div>`;
}

function draftPanelHtml(): string {
  const seat = draftSeat();
  if (seat === null || !ui.draftPack) return '';
  const s = h.state;
  const pile = [...s.players[seat]!.hand, ...s.packs[seat]!];
  const need = s.packs[seat]!.length;
  const inPack = new Set(ui.draftPack);
  const cardRow = (indices: number[]): string => indices.map(i =>
    cardHtml(pile[i]!, { playable: true, data: `data-act="draftcard" data-i="${i}"` })).join('');
  const handIdx = pile.map((_, i) => i).filter(i => !inPack.has(i));
  const packIdx = pile.map((_, i) => i).filter(i => inPack.has(i));
  const ok = packIdx.length === need;
  // the pack's own label makes the same promise the banner does, so it has to
  // tell the same truth: on the cycle's final look these cards go to the
  // bottom of the deck, not to the player across the table
  const fate = (h.state as GameState & { packInfo?: PackInfo }).packInfo?.after;
  const leftLabel = fate === 'recycled'
    ? 'Left in the pack — recycled into the deck, unseen'
    : 'Left in the pack — passes to your opponent';
  return `<div class="draftpanel">
    ${packInfoHtml()}
    <div class="drafthead"><span class="who">${esc(s.players[seat]!.name)} — draft step</span>
      Click cards to move them between hand and pack. Leave exactly ${need} in the pack.
      <button class="primary" data-btn="draftcommit" data-p="${seat}" ${ok ? '' : 'disabled'}>
        Keep ${handIdx.length} · ${fate === 'recycled' ? 'end the pack' : 'pass the pack'} (enter)</button>
      ${ok ? '' : `<span style="color:var(--danger)">pack has ${packIdx.length}/${need}</span>`}</div>
    <div class="zonelabel">Your hand after drafting (${handIdx.length})</div>
    <div class="zone draftkeep">${cardRow(handIdx)}</div>
    <div class="zonelabel">${leftLabel} (${packIdx.length}/${need})</div>
    <div class="zone draftleave">${cardRow(packIdx)}</div>
  </div>`;
}

// ── constructed draw phase (draw 4, bottom 2) ─────────────────────────

/** the seat whose bottoming this client should render, or null.
 * Network mode: my seat while pending. Hotseat: first pending seat. */
function bottomSeat(): Seat | null {
  const s = h.state;
  if (s.mode !== 'constructed' || s.phase !== 'planning' || !s.bottomDone) return null;
  if (NET) return s.bottomDone[NET.seat] ? null : NET.seat;
  const pending = s.bottomDone.findIndex(d => !d);
  return pending === -1 ? null : (pending as Seat);
}

/** (re)set the tentative picks when the draw phase (re)opens */
function ensureBottomUi(): void {
  const seat = bottomSeat();
  if (seat === null) { ui.bottomPick = []; ui.bottomFor = ''; return; }
  const key = `${h.state.turn}:${seat}`;
  if (ui.bottomFor !== key) { ui.bottomPick = []; ui.bottomFor = key; }
}

function bottomPanelHtml(): string {
  const seat = bottomSeat();
  if (seat === null) return '';
  const s = h.state;
  const hand = s.players[seat]!.hand;
  const need = Math.min(2, hand.length);
  const picked = ui.bottomPick.filter(i => i < hand.length);
  const keep = hand.map((_, i) => i).filter(i => !picked.includes(i));
  const ok = picked.length === need;
  const row = (indices: number[]): string => indices.map(i =>
    cardHtml(hand[i]!, { playable: true, data: `data-act="bottomcard" data-i="${i}"` })).join('');
  return `<div class="draftpanel bottompanel">
    <div class="drafthead"><span class="who">${esc(s.players[seat]!.name)} — draw phase</span>
      You drew 4. Click ${need === 1 ? 'the card' : `${need} cards`} to put on the bottom of your deck, then confirm.
      <button class="primary" data-btn="bottomcommit" data-p="${seat}" ${ok ? '' : 'disabled'}>
        Put ${picked.length}/${need} on the bottom (enter)</button></div>
    <div class="zonelabel">Keeping (${keep.length})</div>
    <div class="zone draftkeep">${row(keep)}</div>
    <div class="zonelabel">To the bottom of your deck, in this order (${picked.length}/${need})</div>
    <div class="zone draftleave">${row(picked) || '<span class="binempty">click cards above</span>'}</div>
  </div>`;
}

/** One-liner from playtest: a round-2 counterattack whose sent pool is exactly
 * one unit (but spell tokens could ride, so the engine deliberately does NOT
 * auto-declare) starts with that unit prefilled — the player just confirms. */
function ensureCounterPrefill(): void {
  const s = h.state, b = s.battle;
  if (s.phase !== 'battle' || !b || b.step !== 'declare' || b.round !== 2 || !b.attackerPool) return;
  if (NET && b.attacker !== NET.seat) return;
  const key = `${s.turn}:r2:${b.attacker}`;
  if (ui.prefillFor === key) return;   // once per counterattack — removals stick
  ui.prefillFor = key;
  if (ui.columns.some(c => c.length)) return;
  const eligible = q().unitsOf(b.attacker, b.region).filter(u => b.attackerPool!.includes(u.id));
  if (eligible.length === 1) ui.columns = [[eligible[0]!.id]];
}

/**
 * R72/R75: keep the in-progress block preview pointing at the attackers the
 * player actually pointed at.
 *
 * `ui.columns` is keyed by ATTACK column index while blocking, and R72 leaves
 * those indices moving for exactly as long as the block step lasts: the last
 * unit in a column dies, the line closes ranks, and every key from the hole
 * rightwards means a different column than it did a moment ago. R75's
 * left-insert does the same in the other direction. `doDeclareBlocks` rejects
 * a key naming no column, so the engine is safe — but from the table a
 * rejected declaration is indistinguishable from the client eating your work.
 *
 * ui/formation.ts owns the arithmetic (and the reasoning); this only spots the
 * change, applies it, and says so when a column the player was answering is
 * gone. The snapshot is dropped outside the step, so re-entering the block
 * step always starts from a fresh baseline.
 */
function ensureBlockKeys(): void {
  const b = h.state.battle;
  const mine = !!b && b.step === 'blocks' && (!NET || b.defender === NET.seat);
  if (!b || !mine) { ui.blockLine = null; return; }
  const was = ui.blockLine;
  ui.blockLine = b.columns.map(col => [...col]);
  if (!was) return;                       // first paint of this block step
  const r = rekeyBuild(was, ui.blockLine, ui.columns);
  if (!r.changed) return;
  ui.columns = r.columns;
  if (r.dropped.length) {
    const n = r.dropped.length;
    showToast(`the line closed ranks — the column you were blocking is gone, so ${n === 1 ? 'your blocker is' : `your ${n} blockers are`} free to place again`);
    playCue('error');
  }
}

/** Scrollers whose position must survive a repaint. `.main` is the board
 * itself — the one the playtest report was about — and the focus viewer
 * scrolls independently of it in the side rail. */
const SCROLLERS = ['.main', '.side .preview'] as const;

/** Paint the whole UI. Returns false when it painted something that is NOT a
 * board (connecting / lobby) — the motion layer uses that to drop its
 * baseline instead of animating the first real board out of nowhere. */
function renderNow(): boolean {
  // the board is about to be replaced under the cursor: a long-hover box left
  // floating over it would be describing a card that has moved or died
  hideHoverTip();
  if (NET?.dead) return false;                              // kicked: the notice owns the page
  if (NET && !NET.joined) { renderConnecting(); return false; }
  if (NET?.waiting) { renderWaiting(); return false; }   // constructed lobby
  $app.classList.toggle('netmode', !!NET);   // net mode: the hand docks under the table
  $app.classList.add('board');   // full-height board layout (style.css §board)
  ensureDraftUi();
  ensureBottomUi();
  ensureCounterPrefill();
  ensureBlockKeys();
  modHostCache = moddingHosts();   // #4: legal hosts for a mod-in-progress glow
  refreshActCache();               // UZRG: units with a legal activated ability
  const logFrom = Math.max(0, h.log.length - 80);
  const logItems = h.log.slice(-80).map((l, i) => {
    const t = logTypeAt(logFrom + i);
    const cls = t ? LOG_EVENT_CLASS[t] ?? '' : '';
    return `<div class="${cls}">${logLineHtml(l)}</div>`;
  }).join('');
  // in network mode keep MY seat at the bottom (opponent on top)
  const topSeat: Seat = NET ? other(NET.seat) : 1;
  const botSeat: Seat = NET ? NET.seat : 0;
  const oppOn = NET ? NET.peers[other(NET.seat)] : true;
  const netTag = NET ? `<span class="init">room ${esc(NET.room)} · you are ${esc(h.state.players[NET.seat]!.name)}</span>
    <span class="presence ${oppOn ? 'on' : 'off'}">● ${oppOn ? 'opponent connected' : 'opponent offline'}</span>` : '';
  const canUndo = NET && (h.state.phase === 'planning' || h.state.phase === 'deploy');
  if (ui.confirmPass !== null && (h.state.phase !== 'battle' || h.state.priority === null ||
    castableTokenCount(h.state.priority) === 0)) ui.confirmPass = null;   // stale confirm
  // the two playtest confirms go stale the same way — the phase moved on, the
  // cache emptied, or the ability stopped being legal while the bar was up
  if (ui.confirmDeploy !== null
    && (h.state.phase !== 'deploy' || playableCached(ui.confirmDeploy).length === 0)) {
    ui.confirmDeploy = null;
  }
  if (ui.confirmAct && !legalFor(ui.confirmAct.seat).some(a => a.type === 'activateAbility'
    && a.entityId === ui.confirmAct!.entityId && a.abilityIndex === ui.confirmAct!.abilityIndex)) {
    ui.confirmAct = null;
  }
  const autoPref = localStorage.getItem('algoAutopass') === '1';
  // playtest DEYK: "it constantly resets the scroll height, which means you
  // have to scroll down to see your units every time you click something".
  // The client repaints by replacing $app.innerHTML, which throws away the
  // scroll position of every scroller in it — and mid-battle the board is
  // taller than the window, so every click threw you back to the top. The
  // positions are read BEFORE the swap and put back after; the game log is
  // deliberately not in the list, because it always wants to be at the bottom.
  const scrollBefore = SCROLLERS.map(sel =>
    [sel, document.querySelector(sel)?.scrollTop ?? 0] as const);
  // same discipline for the two text inputs a server push can repaint
  // mid-word: remember which one (if either) owned focus and where the caret
  // sat, so the rebuilt input neither steals focus nor teleports the caret
  const focusedBox = document.activeElement;
  const keepFocus = (focusedBox instanceof HTMLInputElement || focusedBox instanceof HTMLTextAreaElement)
    && (focusedBox.id === 'judge-q' || focusedBox.id === 'report-note')
    ? { id: focusedBox.id, start: focusedBox.selectionStart ?? 0, end: focusedBox.selectionEnd ?? 0 }
    : null;
  const hadJudge = !!document.getElementById('judge-q');
  const hadReport = !!document.getElementById('report-note');
  $app.innerHTML = `
    <div class="main">
      <!-- playtest: the turn/phase strip AND the "what to do next" bar are one
           sticky unit at the top. The prompt used to scroll away exactly when
           it mattered — mid-battle, with the board pushed down the page. -->
      <div class="stickytop">
        <div class="topbar">
          <span>Turn ${h.state.turn}${h.state.mode === 'draft' ? ` · draft: ${h.state.elements.map(el => elIcon(el)).join('')}` : ''}</span>
          ${phaseTrackHtml()}
          <span class="init">initiative: ${esc(h.state.players[h.state.initiative]!.name)} ⭐</span>
          ${ui.autopass ? '<button class="passallchip" data-btn="passallstop" title="click to stop passing">auto-passing… ✕ stop</button>' : ''}
        </div>
        ${shareBannerHtml()}
        ${promptHtml()}
      </div>
      ${draftPanelHtml()}
      ${bottomPanelHtml()}
      ${regionPanelHtml(topSeat)}
      ${battleHtml()}
      ${regionPanelHtml(botSeat, { omitHand: !!NET })}
    </div>
    <div class="side">
      <!-- playtest: room identity, presence, clocks and every chrome button
           live here, above the focus viewer, instead of crowding the left. -->
      <div class="sidehead">
        ${netTag ? `<div class="sideid">${netTag}</div>` : ''}
        ${clocksHtml()}
        <div class="sidebtns">
          <button data-btn="helpopen" title="rules reference: phases + keywords">? rules</button>
          <button data-btn="judgeopen" title="ask the rules judge bot">⚖ judge</button>
          ${NET ? '<button data-btn="reportopen" title="report an issue — the server logs this exact game moment">🐛 bug</button>' : ''}
          ${NET ? `<button data-btn="autopasstoggle" class="aptoggle ${autoPref ? 'on' : ''}"
            title="when ON: automatically pass whenever passing is your only legal action">auto-pass: ${autoPref ? 'on' : 'off'}</button>` : ''}
          <button data-btn="motiontoggle" class="aptoggle ${motionOn() ? 'on' : ''}"
            title="card-movement animations and targeting arrows">✨ motion: ${motionOn() ? 'on' : 'off'}</button>
          <button data-btn="soundtoggle" class="aptoggle ${soundOn() ? 'on' : ''}"
            title="notification sounds: phase and sub-step changes, priority, decisions${NET ? ", and a nudge if you haven't reacted in 15s" : ''}">${soundOn() ? '🔊' : '🔇'} sound: ${soundOn() ? 'on' : 'off'}</button>
          ${canUndo ? '<button data-btn="undo" title="undo your last action (Ctrl+Z)">↶ undo</button>' : ''}
          ${NET ? '' : '<button data-btn="restart">New game</button>'}
        </div>
      </div>
      <div class="preview" id="preview"><div class="hint">hover a card to preview</div></div>
      <div class="logpanel" id="log"><h3>Game log</h3>${logItems}</div>
    </div>
    ${NET ? `<div class="handdock"><div class="zonelabel">Your hand (${h.state.players[botSeat]!.hand.length})</div>
      <div class="zone" data-animzone="hand:${botSeat}">${handZoneHtml(botSeat)}</div></div>` : ''}
    ${stackBoardHtml()}
    ${erasedDialogHtml()}
    ${concedeHtml()}
    ${menuHtml()}
    ${binDialogHtml()}
    ${cacheDialogHtml()}
    ${helpOpen ? helpOverlayHtml() : ''}
    ${inspectorHtml()}
    ${judgeOpen ? judgeOverlayHtml() : ''}
    ${pendingReveal ? revealOverlayHtml() : ''}
    ${pendingTrio ? `<div class="overlay trioover">${lob.revealHtml(pendingTrio)}</div>` : ''}
    ${postGame && !postGameHidden ? pg.postGameHtml(postGame) : ''}
    ${reportOpen ? reportOverlayHtml() : ''}
    ${toastMsg ? `<div class="toast">${esc(toastMsg)}</div>` : ''}`;
  for (const [sel, top] of scrollBefore) {
    if (!top) continue;
    const el = document.querySelector(sel);
    // clamped by the browser if the new content is shorter — a board that
    // shrank scrolls to its new bottom rather than to nowhere
    if (el) el.scrollTop = top;
  }
  const log = document.getElementById('log')!;
  log.scrollTop = log.scrollHeight;
  placeStackWindow();
  clampMenu();
  maybeAutopass();
  maybeAutoYield();
  maybeCancelChain();
  publishBuilding();
  // judge input: submit on Enter, survive re-renders mid-typing. Focus goes
  // back only to the box that HAD it (with its caret where it was) — or to a
  // freshly opened box, caret at the end of any prefill.
  const jq = document.getElementById('judge-q') as HTMLInputElement | null;
  if (jq) {
    if (judgeDraft) jq.value = judgeDraft;
    if (keepFocus?.id === 'judge-q') { jq.focus(); jq.setSelectionRange(keepFocus.start, keepFocus.end); }
    else if (!hadJudge) { jq.focus(); jq.setSelectionRange(jq.value.length, jq.value.length); }
    jq.addEventListener('input', () => { judgeDraft = jq.value; });
    jq.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') {
        judgeDraft = '';
        (document.querySelector('[data-btn="judgeask"]') as HTMLElement | null)?.click();
      }
    });
  }
  // report note: keep the draft across re-renders, live-toggle the send button
  const rn = document.getElementById('report-note') as HTMLTextAreaElement | null;
  if (rn) {
    rn.value = reportDraft;
    if (!reportBusy) {
      if (keepFocus?.id === 'report-note') { rn.focus(); rn.setSelectionRange(keepFocus.start, keepFocus.end); }
      else if (!hadReport) { rn.focus(); rn.setSelectionRange(rn.value.length, rn.value.length); }
    }
    rn.addEventListener('input', () => {
      reportDraft = rn.value;
      const send = document.querySelector('[data-btn="reportsend"]') as HTMLButtonElement | null;
      if (send) send.disabled = reportBusy || !reportDraft.trim();
    });
  }
  return true;
}

// ── the motion pass (ui/motion.ts + ui/anim.ts) ───────────────────────
//
// The client re-renders EVERYTHING after every action, so no DOM node lives
// long enough to be animated. Instead: measure the old board, take a census of
// the old state, paint, then diff the two censuses and fly ghost cards along
// the routes the diff found. The board underneath is final and clickable the
// whole time — motion explains what happened, it never gates anything.

/** the census the board on screen was painted from; null = no baseline yet
 * (fresh join, home screen), which suppresses one round of animation */
let lastCensus: Census | null = null;
/** re-entrancy guard: renderChipOff() can re-render from inside a render */
let painting = false;

/** drop the motion baseline — nothing on screen is a "before" any more */
function motionReset(): void { lastCensus = null; clearArrows(); }

// ── the sound pass (ui/sfx.ts + ui/audio.ts) ──────────────────────────
//
// Same shape as the motion pass, and for the same reason: the phase that just
// changed is only visible as a DIFF between the state the board was painted
// from and the new one. At most one cue per render (ui/sfx.ts CUE_ORDER).

/** the snapshot the board on screen was painted from; null = no baseline,
 * which makes the next render silent */
let lastSfx: SfxSnap | null = null;

/** Drop the sound baseline. Called wherever motionReset() is, and for the
 * same reason: a state that arrives WHOLESALE — a fresh join, a reconnect
 * resync, an undo's full-log replay, a return to the home screen — is not a
 * change anybody just made, and must not fire cues for a phase that turned
 * ten minutes ago. */
function sfxReset(): void { lastSfx = null; disarmIdle(); }

function soundPass(): void {
  const s = h.state;
  // whose ears these are. Network mode: my seat, and legalFor() already knows
  // to use the legal actions the server pushed me. Hotseat: there is no
  // "opponent", so the listener is simply whoever the game is waiting on.
  const seat: Seat = NET ? NET.seat : (s.decision?.seat ?? s.priority ?? 0);
  const snap = sfxSnap(s, seat, legalFor(seat).length > 0);
  const before = lastSfx;
  const cue = diffSfx(before, snap);
  lastSfx = snap;
  if (cue) playCue(cue);
  // The idle thump is a NETWORK-mode safety net. In hotseat the game is never
  // waiting on someone who isn't in the room, so a nudge every 15s would be
  // hurrying you along rather than catching you out.
  if (NET && armsIdle(before, snap)) armIdle();
  // …and it can also stop being owed without this player acting at all: the
  // opponent's move mooted it, or the game ended. A countdown with nothing
  // left to owe must not fire.
  else if (!snap.mine || snap.over) disarmIdle();
}

/**
 * The census, plus the items having their beat on the visual stack.
 *
 * A flashed item is not in GameState anywhere — it already resolved — so
 * ui/motion.ts cannot see it. Splicing it in here is what makes the card
 * visibly LEAVE the hand (or leap off the unit whose trigger it is) and land
 * on the stack, instead of the board simply being different afterwards.
 *
 * Prepended, because the pairing in diffCensus is greedy and stable: a haste
 * card that goes hand → (stack) → bin has two equally plausible destinations
 * born in the same render, and the stack is the one worth watching.
 */
function censusWithFlashes(s: GameState): Census {
  const base = census(s);
  const rows = censusFlashes(visualStack());
  if (!rows.length) return base;
  const phantom = rows.map(r => ({
    key: `s${r.item.id}`, zone: 'stack' as const, seat: r.item.controller,
    // same fallback ui/motion.ts census() uses for a real stack slot: an
    // ability has no card of its own, so it is drawn as its source's
    card: r.item.card ?? (r.item.sourceId !== undefined ? s.entities[r.item.sourceId]?.card : undefined) ?? '',
    anchor: '@stack',
    ...(r.item.sourceId !== undefined ? { origin: `e${r.item.sourceId}` } : {}),
  }));
  return { ...base, slots: [...phantom, ...base.slots] };
}

function render(): void {
  if (painting) { renderNow(); return; }
  painting = true;
  try {
    const frame = captureFrame();
    const before = lastCensus;
    const painted = renderNow();
    if (!painted) { lastCensus = null; clearArrows(); sfxReset(); flashReset(); return; }
    const after = censusWithFlashes(h.state);
    lastCensus = after;
    if (before) playMotion(frame, diffCensus(before, after));
    updateArrows();
    soundPass();
    // a beat starts or ends at a known moment, so book the repaint for it
    scheduleFlashWake();
  } finally { painting = false; }
}

// ── targeting arrows ──────────────────────────────────────────────────

/** where a TargetRef lives on screen, best element first */
function targetSelectors(t: TargetRef): string[] {
  if ('unit' in t) return [`.card[data-anim="e${t.unit}"]`, `[data-anim="e${t.unit}"]`];
  if ('player' in t) return [`[data-animzone="life:${t.player}"]`];
  if ('stack' in t) return [`.stackcard[data-anim="s${t.stack}"]`];
  if ('bin' in t) return [`[data-animzone="bin:${t.bin.seat}"]`];
  return [`[data-anim="c${t.cached.uid}"]`, `[data-animzone="cache:${t.cached.seat}"]`];
}

/** the arrows for one item ON the stack: what fired it (dashed, into the
 * item) and everything it is pointed at (solid, out of the item). Spent parts
 * are skipped — they are the parts that will do nothing. */
function stackArrows(id: number, cls: 'tgt' | 'soft'): ArrowSpec[] {
  const it = stackItemById(id);
  // R68: a negated item is off the rules stack, so this can only ever be a
  // flash snapshot having its beat — and an answered effect must not still be
  // drawing arrows at the things it was going to do
  if (!it || it.negated) return [];
  const self = [`.stackcard[data-anim="s${it.id}"]`];
  const out: ArrowSpec[] = [];
  if (it.sourceId !== undefined) {
    out.push({ from: [`.card[data-anim="e${it.sourceId}"]`], to: self, cls: 'src' });
  }
  const seen = new Set<string>();
  const aim = (t: TargetRef): void => {
    const sel = targetSelectors(t);
    if (seen.has(sel[0]!)) return;
    seen.add(sel[0]!);
    out.push({ from: self, to: sel, cls });
  };
  for (const part of it.parts) {
    if (part.spent) continue;
    part.targets.forEach(aim);
  }
  if (it.hostId !== undefined) aim({ unit: it.hostId });
  return out;
}

/** #4/R57: targets chosen for a cast that has NOT reached the stack yet. The
 * item has no stack row to point from, so the arrows start at its source unit
 * — or at the prompt bar, which is where the player's attention already is. */
function pendingAimArrows(): ArrowSpec[] {
  const sus = h.state.suspension;
  if (!sus || sus.type !== 'cast') return [];
  const it = sus.item;
  const from = it.sourceId !== undefined
    ? [`.card[data-anim="e${it.sourceId}"]`, '.promptbar'] : ['.promptbar'];
  const out: ArrowSpec[] = [];
  // "which card is asking me this?" — the prompt names the ability, but the
  // card it came from can be anywhere on the table. Point at it.
  if (h.state.decision && it.sourceId !== undefined) {
    out.push({ from: [`.card[data-anim="e${it.sourceId}"]`], to: ['.promptbar'], cls: 'src' });
  }
  const seen = new Set<string>();
  for (const part of it.parts) {
    if (part.spent) continue;
    for (const t of part.targets) {
      const sel = targetSelectors(t);
      if (seen.has(sel[0]!)) continue;
      seen.add(sel[0]!);
      out.push({ from, to: sel, cls: 'tgt' });
    }
  }
  return out;
}

/** the always-on arrows: what you are currently aiming, or failing that the
 * TOP of the stack — the one thing that is about to happen, drawn thin so a
 * three-deep stack does not turn the table into a cat's cradle. */
function updateArrows(): void {
  const aim = pendingAimArrows();
  if (aim.length) { setBaseArrows(aim); return; }
  const top = h.state.stack[h.state.stack.length - 1];
  setBaseArrows(top ? stackArrows(top.id, 'soft') : []);
}

/** the arrows for whatever the cursor is over, or null for "nothing special" */
function hoverArrowsFor(target: HTMLElement): ArrowSpec[] | null {
  const ping = target.closest('[data-ping]') as HTMLElement | null;
  if (ping) {
    const id = ping.dataset['ping']!;
    return [{ from: ['.promptbar'], to: [`.card[data-anim="e${id}"]`, `[data-anim="e${id}"]`], cls: 'tgt' }];
  }
  const st = target.closest('[data-prevstack]') as HTMLElement | null;
  if (st) return stackArrows(Number(st.dataset['prevstack']), 'tgt');
  // hovering a unit answers the other half of the question: what is aimed AT
  // me, and what did I put on the stack?
  const card = target.closest('.card[data-anim]') as HTMLElement | null;
  const key = card?.dataset['anim'] ?? '';
  if (!key.startsWith('e')) return null;
  const id = Number(key.slice(1));
  const me = `.card[data-anim="e${id}"]`;
  const out = h.state.stack.flatMap(it => stackArrows(it.id, 'tgt').filter(a => a.to[0] === me));
  for (const it of h.state.stack) {
    if (it.sourceId === id) out.push({ from: [me], to: [`.stackcard[data-anim="s${it.id}"]`], cls: 'src' });
  }
  return out.length ? out : null;
}

/**
 * Show the opponent what I am building, while I build it.
 *
 * Only during MY declaration step — outside it there is nothing being built,
 * and an empty payload is how the other client learns I have cleared it.
 * NetBackend.sendBuilding de-duplicates, so calling this from every render is
 * one message per actual change.
 */
function publishBuilding(): void {
  if (!NET) return;
  const b = h.state.battle;
  const mine = !!b && ((b.step === 'declare' && b.attacker === NET.seat)
    || (b.step === 'blocks' && b.defender === NET.seat));
  // publishCols keeps the sparse column INDICES, which the old
  // `.filter(c => c.length)` compacted away — see ui/formation.ts.
  NET.sendBuilding(mine ? publishCols(ui.columns) : [], mine ? ui.send : []);
}

/** the judge question being typed (survives server-push re-renders) */
let judgeDraft = '';

// ── deployment reveal interstitial (C2) ───────────────────────────────

function revealOverlayHtml(): string {
  // one row per card, not one per event — ui/inspect.ts groupReveal
  const lines = groupReveal(pendingReveal?.msgs ?? []).map(row =>
    `<div class="revealline">${row.name ? cardHtml(row.name) : '<span class="revealspacer"></span>'}<span>${esc(row.text)}</span></div>`,
  ).join('');
  // 'mainonly' leaves the side column (focus viewer!) uncovered so the
  // revealed cards can be read by hovering them
  return `<div class="overlay mainonly"><div class="overlaybox">
    <h3>Your opponent's ${pendingReveal?.step === 'haste' ? 'haste step' : 'deployment'}</h3>
    <div class="hint">hover a card to read it in the focus viewer →</div>
    <div class="reveallist">${lines}</div>
    <button class="primary" data-btn="revealdone">Continue (enter)</button>
  </div></div>`;
}

/** keep a context menu fully inside the viewport (playtest: the recycle menu
 * ran off the bottom of smaller screens) */
function clampMenu(): void {
  const el = document.querySelector('.menu') as HTMLElement | null;
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.bottom > innerHeight - 8) el.style.top = `${Math.max(8, innerHeight - r.height - 8)}px`;
  if (r.right > innerWidth - 8) el.style.left = `${Math.max(8, innerWidth - r.width - 8)}px`;
}

/** "Pass all": keep passing my priority windows until the battle ends or the
 * stack grows (someone played something — then it's worth a look). */
function maybeAutopass(): void {
  if (!NET) return;
  if (ui.autopass) {
    const s = h.state;
    if (s.phase !== 'battle' || !s.battle) ui.autopass = false;
    else if (s.stack.length > ui.autopassStack) ui.autopass = false;
    // #1: a resolution granted me a NEW activateAbility (e.g. a negate) that
    // wasn't legal when the chip was armed — disarm so the window is mine
    else if (abilityKeys(NET.seat).some(k => !ui.autopassSig.includes(k))) ui.autopass = false;
    else {
      ui.autopassStack = s.stack.length;
      if (!s.decision && s.priority === NET.seat) {
        // C5: never skip through castable spell tokens — disarm and let the
        // player decide (the confirm bar shows on their next manual Pass)
        if (castableTokenCount(NET.seat) > 0) ui.autopass = false;
        else if (s.actionCount !== ui.autopassAt) {
          ui.autopassAt = s.actionCount;
          NET.do({ type: 'passPriority', seat: NET.seat });
          return;
        }
      }
    }
    if (!ui.autopass) renderChipOff();
  }
  maybeAutoPassPref();
}

/** the "auto-passing…" chip was drawn this render but the arm just dropped —
 * repaint it away without re-entering the full pipeline recursively */
let chipRepainting = false;
function renderChipOff(): void {
  if (chipRepainting) return;
  chipRepainting = true;
  try { render(); } finally { chipRepainting = false; }
}

/** C4: the persistent auto-pass TOGGLE — pass automatically whenever passing
 * is my ONLY legal action (independent of "Pass all"). */
function maybeAutoPassPref(): void {
  if (!NET || localStorage.getItem('algoAutopass') !== '1') return;
  const s = h.state;
  if (s.decision || s.phase === 'gameover') return;
  if (!NET.legal.length || !NET.legal.every(a => a.type === 'passPriority')) return;
  if (s.actionCount === ui.autopassPrefAt) return;   // one send per server state
  ui.autopassPrefAt = s.actionCount;
  NET.do({ type: 'passPriority', seat: NET.seat });
}

function renderConnecting(): void {
  dropBaselines();
  $app.classList.remove('board');
  // a refused join (a room code that names no game) lands here, so this screen
  // needs a way out — without the button it is a dead end you can only leave by
  // editing the URL
  $app.innerHTML = `<div class="joinscreen"><h2>Algomancy</h2>
    <p${uiError ? ' class="joinerr"' : ''}>${uiError ? esc(uiError) : 'Connecting to the server…'}</p>
    ${uiError ? '<button class="primary" data-btn="gohome">← Back to the home screen</button>' : ''}</div>`;
}

/** The constructed deck picker: the bundled algomancer.cc test decks (with
 * their builders credited), plus import-by-link and paste-a-list. Used on the
 * home screen and on the constructed waiting screen. */
function deckPickerHtml(): string {
  const cur = savedDeck();
  const defaults = defaultDeckList;
  if (!defaults) return `<div class="hint">loading the deck list…</div>${deckMsg ? `<div class="deckmsg">${esc(deckMsg)}</div>` : ''}`;
  const isDefault = !!cur && defaults.some(d => d.name === cur.name && d.url === cur.url);
  const opts = defaults.map((d, i) =>
    `<option value="d${i}" ${cur && d.name === cur.name && d.url === cur.url ? 'selected' : ''}>${esc(d.name)} — by ${esc(d.author)}</option>`).join('');
  const customOpt = cur && !isDefault
    ? `<option value="custom" selected>${esc(cur.name)}${cur.author && cur.author !== 'you' ? ` — by ${esc(cur.author)}` : ''} (imported)</option>` : '';
  const info = cur
    ? `<div class="deckinfo">${cur.cards.length} cards · by ${esc(cur.author)}${cur.url
        ? ` · <a href="${esc(cur.url)}" target="_blank" rel="noopener">view on algomancer.cc</a>` : ''}</div>`
    : '<div class="deckinfo">pick a deck to play constructed</div>';
  return `<select id="h-deck" class="deckselect">
      ${cur ? '' : '<option value="" selected disabled>choose a deck…</option>'}${opts}${customOpt}
    </select>
    ${info}
    <div class="joinrow deckimport">
      <input id="h-deckurl" placeholder="algomancer.cc deck link" spellcheck="false">
      <button data-btn="deckimporturl">Load</button>
    </div>
    <details class="deckpaste"><summary>…or paste a deck list</summary>
      <textarea id="h-decktext" rows="6" spellcheck="false" placeholder="1 Ignis Sprite&#10;2 Overwhelm&#10;…"></textarea>
      <button data-btn="deckimporttext">Use pasted list</button>
    </details>
    ${deckMsg ? `<div class="deckmsg">${esc(deckMsg)}</div>` : ''}`;
}

/** wire the picker's <select> after (re)rendering the screen holding it */
function wireDeckPicker(rerender: () => void): void {
  ensureDefaultDecks(rerender);
  const sel = document.getElementById('h-deck') as HTMLSelectElement | null;
  sel?.addEventListener('change', () => {
    const v = sel.value;
    if (v.startsWith('d') && defaultDeckList) {
      const d = defaultDeckList[Number(v.slice(1))];
      if (d) { saveDeck(d); deckMsg = ''; }
    }
    rerender();
  });
}

/** import a deck through the server (link fetch or paste parse) */
function importDeck(body: { url?: string; text?: string }, rerender: () => void): void {
  deckMsg = 'importing…';
  rerender();
  fetch('/api/deck/import', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json()).then((r: { ok: boolean; error?: string; deck?: SavedDeck & { problems: string[] } }) => {
    if (!r.ok || !r.deck) { deckMsg = r.error ?? 'import failed'; rerender(); return; }
    if (r.deck.problems.length) {
      deckMsg = `not playable: ${r.deck.problems.slice(0, 4).join(' · ')}${r.deck.problems.length > 4 ? ` (+${r.deck.problems.length - 4} more)` : ''}`;
      rerender(); return;
    }
    saveDeck(r.deck);
    deckMsg = `loaded ${r.deck.name} (${r.deck.cards.length} cards) by ${r.deck.author}`;
    rerender();
  }).catch(() => { deckMsg = 'could not reach the server'; rerender(); });
}

/** Home screen (docs/07 §2): new game / join / hotseat / practice.
 *
 * Three cards abreast, not one 340px column. The old stack put "join with a
 * code" and the two solo modes below the fold on an ordinary window, and it
 * sat centred in the LEFT half of the board grid with the rail's width blank
 * beside it (playtest 2026-08-21). Abreast, the whole menu is one screenful
 * and each way in states what it is before it asks for anything. */
function renderHome(): void {
  dropBaselines();
  $app.classList.remove('board');
  // an open account screen (sign-in / profile) owns the page instead
  if (acct.screen()) { acct.renderScreen(); return; }
  const user = acct.currentUser();
  const name = user ? user.username : (localStorage.getItem('algoName') ?? '');
  const deck = savedDeck();
  $app.innerHTML = `<div class="homepage">
    <div class="homehead">
      <h1 class="homelogo">ALGOMANCY</h1>
      <div class="homeident">
        ${user
          ? `<div class="namerow fixedname">Playing as <b>${esc(user.username)}</b></div>`
          : `<label class="namerow">Your name <input id="h-name" maxlength="24" value="${esc(name)}" placeholder="(optional)"></label>`}
        ${acct.barHtml()}
      </div>
    </div>

    <div class="homegrid">
      <div class="homecard offer">
        <h2>Live draft</h2>
        <p class="cardsub">Draft a deck out of shared packs, then play it. You choose the three
          elements together once you are both in the room — one each, something you have never
          played, or from your combined rankings. Nothing is dealt until then.</p>
        <details class="fixedtrio" ${ui.homeFixedTrio ? 'open' : ''}>
          <summary>…or fix the trio now, and skip the lobby</summary>
          <div class="elrow">${ALL_ELEMENTS.map(el =>
            `<button class="elchip ${el} ${ui.homeEls.includes(el) ? 'on' : ''}" data-btn="eltoggle" data-el="${el}">${elIcon(el)}${el}</button>`).join('')}
            <button data-btn="elrandom" title="pick a random trio — any of the ${TRIO_COUNT}">🎲</button>
          </div>
          <button data-btn="newgame" data-mode="draft" data-els="1" ${ui.homeEls.length === 3 ? '' : 'disabled'}>
            ${ui.homeEls.length === 3 ? `Start ${ui.homeEls.join(' + ')} straight away` : `pick 3 of the ${ALL_ELEMENTS.length} (${ui.homeEls.length}/3)`}</button>
        </details>
        <div class="spacer"></div>
        <button class="cta primary" data-btn="newgame" data-mode="draft">New live draft</button>
      </div>

      <div class="homecard offer deckpicker">
        <h2>Constructed</h2>
        <p class="cardsub">Bring a deck you already built. Pick one of the bundled algomancer.cc
          decks, or import your own by link or list.</p>
        ${deckPickerHtml()}
        <div class="spacer"></div>
        <button class="cta primary" data-btn="newgame" data-mode="constructed" ${deck ? '' : 'disabled'}>
          New constructed game${deck ? '' : ' — pick a deck first'}</button>
      </div>

      <div class="homecard">
        <h2>Join a game</h2>
        <p class="cardsub">Someone sent you a four-letter room code — or a link, which skips
          this box entirely.</p>
        <div class="joinrow">
          <input id="h-code" placeholder="CODE" maxlength="8" autocapitalize="characters"
            spellcheck="false" style="text-transform:uppercase">
          <button data-btn="joincode">Join</button>
        </div>
        <div class="spacer"></div>
        <div class="homesep">
          <div class="zonelabel">On your own</div>
          <div class="homesolo">
            <button data-btn="hotseat" title="both seats on this one screen">Local hotseat</button>
            <button data-btn="practice" title="a scripted mid-battle to poke at">Practice demo</button>
          </div>
        </div>
      </div>
    </div>

    <p class="homefoot">One of you starts a new game and sends the other the room code or link.</p>
  </div>`;
  const codeInput = document.getElementById('h-code') as HTMLInputElement | null;
  codeInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') (document.querySelector('[data-btn="joincode"]') as HTMLElement).click();
  });
  wireDeckPicker(renderHome);
}

/** Constructed lobby: the room exists but the game has not been dealt — it
 * starts the moment both seats have brought a deck. */
function renderWaiting(): void {
  dropBaselines();
  $app.classList.remove('board');
  const net = NET!;
  const w = net.waiting!;
  // a draft room chooses its trio here, before a single card is dealt
  if (w.trio) {
    const link = `${location.origin}/?ws=1&room=${encodeURIComponent(net.room)}&seat=${other(net.seat)}&mode=draft`;
    $app.innerHTML = lob.lobbyHtml({
      lobby: w.trio, seat: net.seat as 0 | 1, names: net.names,
      peers: net.peers, room: net.room, link,
    });
    return;
  }
  const me = net.seat, opp = other(me);
  const link = `${location.origin}/?ws=1&room=${encodeURIComponent(net.room)}&seat=${opp}&mode=constructed`;
  const deck = savedDeck();
  const mineIn = w.have[me];
  const oppLine = net.peers[opp] ? 'connected — still choosing a deck…' : 'not here yet';
  // same furniture as the draft lobby (ui/lobby.ts): it is the same moment in
  // the same room, and the two screens looking different made it read as two
  // different products
  $app.innerHTML = `<div class="lobbypage">
    <div class="lobbyhead">
      <h1 class="homelogo">ALGOMANCY</h1>
      <h2>Constructed — room <span class="roomcode">${esc(net.room)}</span></h2>
      <div class="headbtns"><button data-btn="gohome">Leave</button></div>
    </div>

    ${shareBar('Send your opponent the room code', net.room, link)}

    ${mineIn ? '' : `<div class="lobbypanel deckpicker">
      <div class="zonelabel">Your deck</div>
      ${deckPickerHtml()}
      <button class="cta primary" data-btn="deckjoin" ${deck ? '' : 'disabled'}>Play this deck</button>
    </div>`}

    <div class="lobbyfoot">
      <div class="lobbyseats">
        <span class="lobbyseat"><i class="seatdot ${mineIn ? 'ready' : ''}"></i>
          <span>${esc(net.names[me] ?? 'You')} (you) — ${mineIn
            ? `<b class="lockedin">deck is in</b>${deck ? ` — ${esc(deck.name)} by ${esc(deck.author)}` : ''}`
            : '<span class="dim">pick a deck above</span>'}</span></span>
        <span class="lobbyseat"><i class="seatdot ${w.have[opp] ? 'ready' : net.peers[opp] ? '' : 'away'}"></i>
          <span>${esc(net.names[opp] ?? 'Opponent')} — ${w.have[opp]
            ? '<b class="lockedin">deck is in</b>' : `<span class="dim">${esc(oppLine)}</span>`}</span></span>
      </div>
    </div>

    ${uiError ? `<p class="deckmsg">${esc(uiError)}</p>` : ''}
    <p class="homefoot">The game deals the moment both decks are in.</p>
  </div>`;
  wireDeckPicker(renderWaiting);
}

const saveHomeName = (): void => {
  // logged in, the name box is not rendered at all — the account name is the
  // one the server files stats under and must not be overwritten by a stale
  // input value
  const inp = document.getElementById('h-name') as HTMLInputElement | null;
  if (inp) localStorage.setItem('algoName', inp.value.trim());
};

// ── the current text box ──────────────────────────────────────────────
/*
 * Playtest 2026-08-21, Bena: "cards have their oracle text changed all the
 * time […] The printed card is hardly ever correct." The scan is the card's
 * history; this is what the game currently thinks it says.
 *
 * All of the thinking is in ui/cardtext.ts (pure, tested). Everything below
 * is markup: one renderer, used by the focus viewer, the long-hover tooltip
 * and the inspector, so the box never says three different things about the
 * same unit.
 */

/** the little tag that says where a line came from */
const LINE_TAG: Record<LineOrigin, (from: string) => string> = {
  printed: () => 'printed',
  augment: from => `${txtIcon('augment', '+')} ${esc(from)}`,
  graft: from => `${txtIcon('graft', '⇄')} ${esc(from)}`,
  granted: from => `✦ granted by ${esc(from)}`,
  static: from => `⟳ ${esc(from)}`,
  note: () => '⏳ spent',
};

const ATTR_TAG: Record<AttrOrigin, string> = {
  printed: 'printed', augment: 'from a mod', static: 'projected',
  temp: 'until regroup', column: 'shared by the column',
};

function statMathHtml(st: StatBreakdown): string {
  if (!st.parts.length) return '';
  const bits = st.parts.map(p => {
    const d = `${p.dp >= 0 ? '+' : ''}${p.dp}/${p.dt >= 0 ? '+' : ''}${p.dt}`;
    return `<span class="tbterm"><b>${esc(d)}</b> ${esc(p.label)}</span>`;
  });
  return `<div class="tbmath"><span class="tbterm"><b>${st.printed[0]}/${st.printed[1]}</b> printed</span>${bits.join('')}</div>`;
}

/**
 * The whole box.
 *
 *  - `compact` drops the arithmetic and the state notes — the long-hover
 *    tooltip wants the text, not the ledger.
 *  - `noTitle` drops the name and type line, for the inspector, whose own
 *    heading is already both of them. The "current text" badge stays: that
 *    one is a claim about the box, not a label for the card.
 */
function textBoxHtml(box: CardTextBox, opts: { compact?: boolean; noTitle?: boolean } = {}): string {
  const st = box.stats;
  const changed = st?.changed ?? false;
  const stats = st
    ? `<div class="tbstats">
        <b class="${changed ? (st.power + st.toughness >= st.printed[0] + st.printed[1] ? 'statup' : 'statdown') : ''}">${st.power}/${st.toughness}</b>
        ${changed ? `<span class="basestat">printed ${st.printed[0]}/${st.printed[1]}</span>` : ''}
        ${st.damage ? `<span class="tbdmg">−${st.damage} damage</span>` : ''}
      </div>${opts.compact ? '' : statMathHtml(st)}`
    : '';
  const attrs = box.attrs.length
    ? `<div class="tbattrs">${box.attrs.map(a =>
        `<span class="tbattr${a.active ? '' : ' off'}" title="${esc(ATTR_TAG[a.origin])}${a.from ? ` — ${esc(a.from)}` : ''}">${esc(a.attr)}${
          a.origin !== 'printed' ? `<em>${esc(ATTR_TAG[a.origin])}</em>` : ''}</span>`).join('')}</div>`
    : '';
  // the one thing a player must never miss: this card is not doing what it says
  const supp = box.suppressed.attrs || box.suppressed.abilities
    ? `<div class="tbsupp">⊘ ${esc([
        box.suppressed.attrs ? 'attributes' : '', box.suppressed.abilities ? 'abilities' : '',
      ].filter(Boolean).join(' and '))} switched off by ${esc(box.suppressed.by.join(', '))}</div>`
    : '';
  // on a card that is simply itself, "printed" is a tag with no other tag to
  // distinguish it from — the box is quieter without it
  const bare = box.lines.length === 1 && box.lines[0]!.origin === 'printed' && !box.modified;
  const lines = box.lines.length
    ? box.lines.map(l => `<div class="tbline tb-${l.origin}${l.active ? '' : ' off'}">
        ${bare ? '' : `<span class="tbfrom">${l.composed
          ? `${txtIcon('graft', '⇄')} grafted — one ability`
          : LINE_TAG[l.origin](l.from)}</span>`}
        <span class="tbtext">${iconizeText(l.text)}</span>
        ${l.why ? `<span class="tbwhy">${esc(l.why)}</span>` : ''}
      </div>`).join('')
    : '<div class="tbline tb-printed"><span class="tbtext hint">no rules text</span></div>';
  const state = !opts.compact && box.state.length
    ? `<div class="tbstate">${box.state.map(s => `<span>${esc(s)}</span>`).join('')}</div>`
    : '';
  const head = opts.noTitle
    ? (box.modified ? '<div class="tbhead bare"><span class="tbbadge">current text</span></div>' : '')
    : `<div class="tbhead">
        <span class="tbname">${esc(box.name)}</span>
        <span class="tbtype">${iconizeText(box.typeLine)}</span>
        ${box.modified ? '<span class="tbbadge">current text</span>' : ''}
      </div>`;
  return `<div class="textbox${box.modified ? ' modified' : ''}${opts.compact ? ' compact' : ''}">
    ${head}${stats}${attrs}${supp}
    <div class="tblines">${lines}</div>${state}
  </div>`;
}

/** the box for whatever the UI is pointing at, live where a live entity backs
 * it and printed where one does not */
function boxFor(name: string, id?: EntityId): CardTextBox {
  return textBoxFor(inGame ? q() : null, name, id);
}

// ── interaction ───────────────────────────────────────────────────────
/**
 * The focus viewer for a live unit: the composed modded card (base art with
 * each mod's text strip slid under it, the way it looks on a table), then the
 * CURRENT text box underneath.
 *
 * The art shows what is physically stacked there; the box says what the game
 * reads off it. Both, in that order, because the picture is how you recognise
 * the card and the box is how you play it correctly.
 */
function previewEntityHtml(id: EntityId): string {
  const u = h.state.entities[id];
  if (!u) return '';
  const modStrips = u.mods.map(mid => {
    const m = h.state.entities[mid];
    if (!m) return '';
    const tag = m.appliedAs === 'graft'
      ? `${txtIcon('graft', '[Switch]')} grafted` : `${txtIcon('augment', '+')} augment`;
    return `<div class="modstrip"><img src="${art(m.card)}" alt="">
      <span class="modtag">${tag} · ${esc(m.card)}</span></div>`;
  }).join('');
  return `<img src="${art(u.card)}" alt="" onerror="this.style.display='none'">${modStrips}
    ${textBoxHtml(entityTextBox(q(), u))}`;
}

/* ── the long-hover text box ────────────────────────────────────────────
 *
 * Playtest ask: the current text box "should also be shown when hovering for
 * long enough over a unit". The focus viewer in the side rail already has it,
 * but reading it means looking away from the board — and mid-battle nobody
 * does, which is how a silenced unit gets blocked as if it still had Flying.
 *
 * So: dwell on a card for HOVER_MS and the box comes to the cursor. Only on a
 * DWELL, never on a sweep, because a tooltip that fires on every pass across
 * a crowded formation is worse than none. It is inert to pointer events, so
 * it can never eat the click it is sitting on top of.
 */
const HOVER_MS = 550;
let hoverTimer: number | null = null;
let hoverKey = '';

const hoverTip = (): HTMLElement => {
  let el = document.getElementById('hovertip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hovertip';
    el.className = 'hovertip';
    document.body.appendChild(el);
  }
  return el;
};

function hideHoverTip(): void {
  if (hoverTimer !== null) { clearTimeout(hoverTimer); hoverTimer = null; }
  hoverKey = '';
  const el = document.getElementById('hovertip');
  if (el) el.classList.remove('on');
}

/** place the tip beside the cursor, folded back inside the viewport */
function placeHoverTip(el: HTMLElement, x: number, y: number): void {
  el.style.left = '0px';
  el.style.top = '0px';
  el.classList.add('on');
  const r = el.getBoundingClientRect();
  const left = x + 18 + r.width > window.innerWidth ? Math.max(4, x - 18 - r.width) : x + 18;
  const top = Math.max(4, Math.min(y + 14, window.innerHeight - r.height - 4));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function armHoverTip(target: HTMLElement, x: number, y: number): void {
  const id = target.dataset['previd'];
  const name = target.dataset['prev'];
  if (id === undefined && !name) { hideHoverTip(); return; }
  const key = id !== undefined ? `e${id}` : `c${name}`;
  if (key === hoverKey) return;                    // same card: leave it alone
  hideHoverTip();
  hoverKey = key;
  hoverTimer = window.setTimeout(() => {
    hoverTimer = null;
    const box = id !== undefined ? boxFor(name ?? '', Number(id)) : printedTextBox(name!);
    const el = hoverTip();
    el.innerHTML = textBoxHtml(box, { compact: true });
    placeHoverTip(el, x, y);
  }, HOVER_MS);
}

document.addEventListener('mouseover', e => {
  // targeting arrows follow the cursor's subject: a stack item shows what it
  // aims at, a unit shows what aims at it. null falls back to the base set.
  if (inGame) setHoverArrows(hoverArrowsFor(e.target as HTMLElement));
  // #3: hovering a decision button that refers to a live entity pings that
  // unit's card(s) on the board
  const ping = (e.target as HTMLElement).closest('[data-ping]') as HTMLElement | null;
  if (ping) {
    for (const el of document.querySelectorAll(`[data-id="${ping.dataset['ping']}"]`)) el.classList.add('pinghl');
  }
  const t = (e.target as HTMLElement).closest('[data-prev], [data-previd], [data-prevstack]') as HTMLElement | null;
  if (!t) { hideHoverTip(); return; }
  // a stack item has no card box of its own — the side rail explains it
  if (t.dataset['prevstack'] === undefined) armHoverTip(t, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  else hideHoverTip();
  const prev = document.getElementById('preview');
  if (!prev) return;
  if (t.dataset['previd']) {
    const html = previewEntityHtml(Number(t.dataset['previd']));
    if (html) { prev.innerHTML = html; return; }
  }
  // a stack item shows the ABILITY that is on the stack, not the whole card
  if (t.dataset['prevstack']) {
    const html = previewStackHtml(Number(t.dataset['prevstack']));
    if (html) { prev.innerHTML = html; return; }
  }
  const name = t.dataset['prev'];
  if (!name) return;
  // #5: hand cards carry their live X preview into the focus viewer
  const xnow = t.dataset['xnow'] !== undefined
    ? `<div class="xnow">X = ${esc(t.dataset['xnow'])} right now</div>` : '';
  prev.innerHTML = `<img src="${art(name)}" alt="" onerror="this.style.display='none'">${xnow}${
    textBoxHtml(printedTextBox(name))}`;
});

document.addEventListener('mouseout', e => {
  const ping = (e.target as HTMLElement).closest('[data-ping]') as HTMLElement | null;
  if (!ping) return;
  for (const el of document.querySelectorAll('.pinghl')) el.classList.remove('pinghl');
});

// the cursor leaving the window fires no mouseover, so drop the hover set here
document.addEventListener('mouseleave', () => { setHoverArrows(null); hideHoverTip(); });
// a click, a scroll or a keypress means the player is doing something else
document.addEventListener('pointerdown', hideHoverTip, { passive: true });
document.addEventListener('keydown', hideHoverTip);
window.addEventListener('scroll', hideHoverTip, { passive: true, capture: true });

// Autoplay policy: samples can only be warmed once the page has seen a
// gesture. Any click or key anywhere counts, and priming is a no-op after the
// first, so this costs one branch per event forever after.
document.addEventListener('pointerdown', primeAudio, { passive: true });
document.addEventListener('keydown', primeAudio);

document.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest('[data-btn]') as HTMLElement | null;
  if (btn) { handleButton(btn); return; }
  // outside a game (home screen / kicked screen) a stray click must not
  // trigger the game render() — it would paint the hotseat board over the UI.
  if (!inGame) return;
  const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!t) { ui.menu = null; render(); return; }
  handleAction(t, e as MouseEvent);
});

function handleButton(btn: HTMLElement): void {
  // accounts own everything prefixed acct- (sign-in, profile, friends)
  if (acct.handleButton(btn)) return;
  // and the post-game screen everything prefixed pg-
  if (postGame && pg.handlePostGameButton(btn, {
    over: postGame,
    send: msg => NET!.rematch(msg),
    rerender: render,
    dismiss: () => { postGameHidden = true; render(); },
  })) return;
  // and the draft lobby everything prefixed lobby-
  if (NET?.waiting?.trio && lob.handleLobbyButton(btn, {
    lobby: NET.waiting.trio,
    send: msg => NET!.lobby(msg),
    rerender: renderWaiting,
  })) return;
  const b = btn.dataset['btn'];
  if (b === 'eltoggle') {
    ui.homeFixedTrio = true;
    const el = btn.dataset['el']!;
    if (ui.homeEls.includes(el)) ui.homeEls = ui.homeEls.filter(x => x !== el);
    else if (ui.homeEls.length < 3) ui.homeEls.push(el);
    else { ui.homeEls.shift(); ui.homeEls.push(el); }   // full: rotate the oldest out
    localStorage.setItem('algoEls', JSON.stringify(ui.homeEls));
    renderHome();
    return;
  }
  if (b === 'elrandom') {
    ui.homeFixedTrio = true;
    // every element the ENGINE knows about, so the die reaches all C(n,3)
    // trios — 35 of them with Light & Dark in
    ui.homeEls = [];
    while (ui.homeEls.length < 3) {
      const pick = ALL_ELEMENTS[Math.floor(Math.random() * ALL_ELEMENTS.length)]!;
      if (!ui.homeEls.includes(pick)) ui.homeEls.push(pick);
    }
    localStorage.setItem('algoEls', JSON.stringify(ui.homeEls));
    renderHome();
    return;
  }
  if (b === 'newgame') {
    saveHomeName();
    const m = btn.dataset['mode'];
    const mode = m === 'draft' ? 'draft' : m === 'constructed' ? 'constructed' : 'shared';
    if (mode === 'constructed' && !savedDeck()) return;   // button is disabled anyway
    // a draft with NO els opens the lobby and chooses the trio there; passing
    // els is the deliberate escape hatch that skips it
    const els = mode === 'draft' && btn.dataset['els'] && ui.homeEls.length === 3
      ? `&els=${encodeURIComponent(ui.homeEls.join(','))}` : '';
    fetch('/api/new').then(r => r.json()).then((r: { code: string }) => {
      location.search = `?ws=1&room=${encodeURIComponent(r.code)}&seat=0&mode=${mode}${els}`;
    }).catch(() => { uiError = 'could not reach the server'; renderHome(); });
    return;
  }
  if (b === 'deckimporturl') {
    const inp = document.getElementById('h-deckurl') as HTMLInputElement | null;
    const url = inp?.value.trim();
    if (url) importDeck({ url }, NET ? render : renderHome);
    return;
  }
  if (b === 'deckimporttext') {
    const ta = document.getElementById('h-decktext') as HTMLTextAreaElement | null;
    const text = ta?.value.trim();
    if (text) importDeck({ text }, NET ? render : renderHome);
    return;
  }
  if (b === 'deckjoin') { NET?.sendJoin(); return; }
  if (b === 'joincode') {
    saveHomeName();
    const code = (document.getElementById('h-code') as HTMLInputElement).value.trim().toUpperCase();
    if (!code) return;
    location.search = `?ws=1&room=${encodeURIComponent(code)}`;
    return;
  }
  if (b === 'hotseat') { saveHomeName(); location.search = '?hotseat=1'; return; }
  if (b === 'practice') { saveHomeName(); location.search = '?demo=1'; return; }
  if (b === 'gohome') { location.href = location.pathname; return; }
  if (b === 'copylink') {
    const link = btn.dataset['link']!;
    // clipboard API needs a secure context; plain-http LAN needs the fallback
    void navigator.clipboard?.writeText(link).catch(() => {});
    const inp = document.querySelector('.sharelink') as HTMLInputElement | null;
    if (inp) { inp.select(); document.execCommand('copy'); }
    btn.textContent = 'copied ✓';
    return;
  }
  if (b === 'cachespent') {
    const p = Number(btn.dataset['p']) as Seat;
    if (showSpentCache.has(p)) showSpentCache.delete(p); else showSpentCache.add(p);
    render(); return;
  }
  if (b === 'motiontoggle') { setMotionOn(!motionOn()); motionReset(); flashReset(); render(); return; }
  if (b === 'soundtoggle') {
    const on = !soundOn();
    setSoundOn(on);
    // switching it ON plays the quietest cue as an audition: you find out both
    // that it works and how loud it is, without waiting for a phase to turn.
    if (on) { primeAudio(); playCue('priority'); }
    render();
    return;
  }
  if (b === 'undo') { NET?.undo(); return; }
  const s = h.state;
  if (b === 'restart' && !NET) {
    const d = h.state.mode === 'constructed' ? savedDeck() : null;
    h = new Harness(Math.floor(Math.random() * 1e6), undefined,
      h.state.mode === 'constructed' && !d ? 'shared' : h.state.mode, undefined,
      d ? [d.cards, d.cards] : undefined);
    resetUi(); uiError = '';
  }
  if (b === 'doneplan') {
    const p = Number(btn.dataset['p']) as Seat;
    const pl = s.players[p]!;
    const dormant = pl.resources.filter(r => r.state === 'dormant').length;
    // guard against accidentally skipping activations (playtest feedback: a
    // dormant board looks deceptively "ready")
    if (pl.activationsLeft > 0 && dormant > 0) ui.confirmDone = p;
    else act({ type: 'donePlanning', seat: p });
  }
  if (b === 'doneplanconfirm') {
    ui.confirmDone = null;
    act({ type: 'donePlanning', seat: Number(btn.dataset['p']) });
  }
  if (b === 'doneplancancel') ui.confirmDone = null;
  if (b === 'donehaste') act({ type: 'doneHaste', seat: Number(btn.dataset['p']) });
  const armPassAll = (): void => {
    ui.autopass = true;
    ui.autopassStack = s.stack.length;
    ui.autopassAt = s.actionCount;
    // #1: remember which activateAbility keys were ALREADY legal — a new one
    // appearing later (granted by a resolution) disarms the chip
    ui.autopassSig = NET ? abilityKeys(NET.seat) : [];
  };
  if (b === 'pass' || b === 'passall') {
    // C5: passing away castable spell tokens during battle wants a confirm
    if (s.phase === 'battle' && s.priority !== null && castableTokenCount(s.priority) > 0) {
      ui.confirmPass = b;
      render();
      return;
    }
  }
  if (b === 'pass') act({ type: 'passPriority', seat: s.priority! });
  if (b === 'passall') { armPassAll(); act({ type: 'passPriority', seat: s.priority! }); }
  if (b === 'passcancel') ui.confirmPass = null;
  if (b === 'passconfirm') {
    const mode = ui.confirmPass;
    ui.confirmPass = null;
    if (mode) {
      if (mode === 'passall') armPassAll();
      act({ type: 'passPriority', seat: s.priority! });
    }
  }
  if (b === 'passallstop') ui.autopass = false;
  if (b === 'autopasstoggle') {
    localStorage.setItem('algoAutopass', localStorage.getItem('algoAutopass') === '1' ? '' : '1');
  }
  if (b === 'pg-reopen') { postGameHidden = false; render(); return; }
  if (b === 'trio-ok') { pendingTrio = null; render(); return; }
  if (b === 'revealdone') { pendingReveal = null; releaseHeldFlashes(); }
  if (b === 'donedeploy') {
    // playtest: don't let a paid-for prophecy or a glimpsed card die in the
    // cache because deployment is the one step you click through fast.
    const seat = Number(btn.dataset['p']) as Seat;
    if (playableCached(seat).length) ui.confirmDeploy = seat;
    else act({ type: 'doneDeploying', seat });
  }
  if (b === 'deploycancel') ui.confirmDeploy = null;
  if (b === 'deployconfirm') {
    const seat = ui.confirmDeploy;
    ui.confirmDeploy = null;
    if (seat !== null) act({ type: 'doneDeploying', seat });
  }
  if (b === 'actcancel') ui.confirmAct = null;
  if (b === 'actconfirm') {
    const a = ui.confirmAct;
    ui.confirmAct = null;
    if (a) {
      act({ type: 'activateAbility', seat: a.seat, entityId: a.entityId,
        abilityIndex: a.abilityIndex, ...(a.via ? { via: a.via } : {}) });
    }
  }
  if (b === 'skipattack') { act({ type: 'declareAttack', seat: s.battle!.attacker, columns: [] }); ui.columns = []; ui.carrying = null; ui.spellTokens = []; }
  if (b === 'attackall') {
    // one click for the whole army: every eligible unit fronts its own
    // column (still adjustable before "Attack!"; playtest: 100 token clicks)
    const bt = s.battle!;
    const e = q();
    const from = bt.round === 1 || bt.attackerPool === null ? e.homeRegion(bt.attacker) : bt.region;
    const placed = new Set(ui.columns.flat());
    for (const u of e.unitsOf(bt.attacker, from)) {
      if (placed.has(u.id)) continue;
      if (bt.attackerPool && !bt.attackerPool.includes(u.id)) continue;
      ui.columns.push([u.id]);
    }
    ui.carrying = null;
  }
  if (b === 'confirmattack') {
    const cols = ui.columns.filter(c => c.length);
    act({ type: 'declareAttack', seat: s.battle!.attacker, columns: cols, spellTokens: ui.spellTokens.slice() });
    if (!uiError) { ui.columns = []; ui.carrying = null; ui.spellTokens = []; }
  }
  if (b === 'confirmblocks') {
    const blocks: Record<number, EntityId[]> = {};
    ui.columns.forEach((col, ci) => { if (col && col.length) blocks[ci] = col; });
    act({ type: 'declareBlocks', seat: s.battle!.defender, blocks, send: ui.send });
    if (!uiError) { ui.columns = []; ui.send = []; ui.carrying = null; ui.spellTokens = []; }
  }
  if (b === 'draftcommit' && ui.draftPack) {
    act({ type: 'draftCommit', seat: Number(btn.dataset['p']) as Seat, packIndices: ui.draftPack.slice() });
    if (!uiError) { ui.draftPack = null; }
  }
  if (b === 'bottomcommit') {
    act({ type: 'bottomCards', seat: Number(btn.dataset['p']) as Seat, handIndices: ui.bottomPick.slice() });
    if (!uiError) { ui.bottomPick = []; ui.bottomFor = ''; }
  }
  if (b === 'decide') act({ type: 'decide', seat: s.decision!.seat, choice: Number(btn.dataset['i']) });
  if (b === 'orderpick') {
    ui.orderPicked.push(Number(btn.dataset['i']));
    if (ui.orderPicked.length === s.decision!.options.length) {
      const choice = ui.orderPicked.slice();
      ui.orderPicked = [];
      act({ type: 'decide', seat: s.decision!.seat, choice });
    }
  }
  if (b === 'binopen') { binView = Number(btn.dataset['p']) as Seat; }
  if (b === 'binclose') binView = null;
  // the memory aid: forget one card, or the whole strip. Decision logic is in
  // ui/inspect.ts — this only reads the live look and stores the answer.
  if (b === 'seendrop' || b === 'seenhideall') {
    const seen = NET ? h.state.seenHand?.[NET.seat] : null;
    seenDrop = b === 'seenhideall'
      ? dismissSeenHand(seen)
      : dismissSeenCard(seen, seenDrop, Number(btn.dataset['i']));
    saveSeenDrop();
  }
  if (b === 'erasedclose') erasedView = null;
  if (b === 'concedeno') concedeAsk = null;
  if (b === 'concedeyes') {
    const seat = concedeAsk;
    concedeAsk = null;
    if (seat !== null) act({ type: 'concede', seat });
  }
  // R41: the cache is public — either seat's zone opens for either player
  if (b === 'cacheopen') { cacheView = Number(btn.dataset['p']) as Seat; }
  if (b === 'cacheclose') cacheView = null;
  if (b === 'helpopen') helpOpen = true;
  if (b === 'helpclose') helpOpen = false;
  if (b === 'judgeopen') judgeOpen = true;
  if (b === 'judgeclose') judgeOpen = false;
  if (b === 'inspectclose') inspect = null;
  if (b === 'inspectjudge') {
    const name = btn.dataset['name'] ?? inspect?.name ?? '';
    inspect = null;
    judgeOpen = true;
    judgeDraft = `I have a question about ${name}. `;
  }
  if (b === 'judgeask') {
    const inp = document.getElementById('judge-q') as HTMLInputElement | null;
    const question = inp?.value.trim();
    if (question && !judgeBusy) { if (inp) inp.value = ''; judgeDraft = ''; askJudge(question); return; }
  }
  if (b === 'modcancel') ui.modding = null;
  if (b === 'castcancel') startCastCancel();
  if (b === 'clearform') { ui.columns = []; ui.send = []; ui.spellTokens = []; ui.carrying = null; }
  if (b === 'reportopen') reportOpen = true;
  if (b === 'reportclose') reportOpen = false;
  if (b === 'reportsend') { sendReport(); return; }
  if (b === 'menuitem') { const it = ui.menu!.items[Number(btn.dataset['i'])]!; ui.menu = null; it.go(); }
  if (b === 'menuclose') ui.menu = null;
  render();
}

function handleAction(t: HTMLElement, e: MouseEvent): void {
  const kind = t.dataset['act'];
  const s = h.state;

  if (kind === 'draftcard') {
    if (!ui.draftPack) return;
    const i = Number(t.dataset['i']);
    const at = ui.draftPack.indexOf(i);
    if (at >= 0) ui.draftPack.splice(at, 1); else ui.draftPack.push(i);
    render();
    return;
  }

  if (kind === 'bottomcard') {
    const i = Number(t.dataset['i']);
    const at = ui.bottomPick.indexOf(i);
    if (at >= 0) ui.bottomPick.splice(at, 1);
    else if (ui.bottomPick.length < 2) ui.bottomPick.push(i);
    render();
    return;
  }

  if (kind === 'res') {
    const p = Number(t.dataset['p']) as Seat, i = Number(t.dataset['i']);
    const opts = legalFor(p).filter(a =>
      (a.type === 'activateResource' && a.index === i) ||
      (a.type === 'exchangePrismite' && a.index === i));
    if (opts.length === 1) act(opts[0]!);
    else if (opts.length > 1) {
      ui.menu = {
        x: e.clientX, y: e.clientY,
        items: opts.map(a => ({
          label: a.type === 'activateResource' ? 'Activate' : `Exchange → ${(a as { element: string }).element}`,
          icon: a.type === 'exchangePrismite' ? (a as { element: string }).element : undefined,
          go: () => { act(a); render(); },
        })),
      };
    }
  }

  if (kind === 'player') {
    const ref: TargetRef = { player: Number(t.dataset['p']) };
    const idx = decisionOptionIndex(ref);
    if (idx >= 0) act({ type: 'decide', seat: s.decision!.seat, choice: idx });
  }

  if (kind === 'stackitem') {
    const ref: TargetRef = { stack: Number(t.dataset['id']) };
    const idx = decisionOptionIndex(ref);
    if (idx >= 0) act({ type: 'decide', seat: s.decision!.seat, choice: idx });
  }

  if (kind === 'token') {
    const tok = s.entities[Number(t.dataset['id'])];
    if (tok && (!NET || tok.controller === NET.seat)) {
      // C1: during formation building a click toggles ride-along / send
      const mode = tokenToggleMode(tok);
      if (mode === 'ride') {
        const at = ui.spellTokens.indexOf(tok.id);
        if (at >= 0) ui.spellTokens.splice(at, 1); else ui.spellTokens.push(tok.id);
      } else if (mode === 'send') {
        const at = ui.send.indexOf(tok.id);
        if (at >= 0) ui.send.splice(at, 1); else ui.send.push(tok.id);
      } else {
        act({ type: 'castSpellToken', seat: tok.controller, entityId: tok.id });
      }
    }
  }

  if (kind === 'unit') {
    const id = Number(t.dataset['id']);
    const ref: TargetRef = { unit: id };
    const idx = decisionOptionIndex(ref);
    if (idx >= 0) { act({ type: 'decide', seat: s.decision!.seat, choice: idx }); render(); return; }
    if (ui.modding) {
      const m = ui.modding;
      ui.modding = null;
      applyMod(m, id, e);
      render();
      return;
    }
    const u = s.entities[id];
    const b = s.battle;
    if (NET && u && u.controller !== NET.seat) return;   // in net mode I only manipulate my own units
    if (u && !s.decision) {
      // UZRG: the formation branch used to be tested FIRST, so during your own
      // declare (or block) step every click on your own unit picked it up for a
      // column and the ability branch below was unreachable — a {Battle}-timed
      // ability on a unit you are also attacking with had no input path at all.
      // The two are one LIST now (ui/inspect.ts unitClickOptions): one entry
      // means do it, more than one means ask.
      const inFormation = !!b &&
        ((b.step === 'declare' && u.controller === b.attacker) ||
         (b.step === 'blocks' && u.controller === b.defender));
      const role: FormationRole | null = inFormation && b ? {
        step: b.step === 'declare' ? 'attack' : 'block',
        placed: ui.columns.some(c => c.includes(id)) || ui.send.includes(id),
        carrying: ui.carrying === id,
      } : null;
      const takeFormation = (): void => {
        if (!role || !b) return;
        if (role.placed) {
          ui.columns = ui.columns.map(c => c.filter(x => x !== id)).filter(c => b.step === 'declare' ? c.length > 0 : true);
          ui.send = ui.send.filter(x => x !== id);
        } else {
          ui.carrying = (ui.carrying === id ? null : id);
        }
      };
      // playtest: a single ability used to fire on a bare click, so clicking a
      // unit you meant to BLOCK with instead paid its "Sacrifice me:" cost and
      // deleted it. Anything that spends something you cannot get back, and
      // that will not stop to ask for a target, now asks first.
      const take = (o: UnitClickOption): void => {
        if (o.kind === 'formation') { takeFormation(); return; }
        const a = o.action!;
        if (needsConfirm(u, a)) {
          ui.confirmAct = {
            seat: u.controller, entityId: id, abilityIndex: a.abilityIndex,
            ...(a.via ? { via: a.via } : {}),
            label: o.label, unit: u.card,
          };
        } else act(a);
      };
      const opts = unitClickOptions(s, u, legalFor(u.controller), role);
      if (opts.length === 1) take(opts[0]!);
      else if (opts.length > 1) {
        ui.menu = {
          x: e.clientX, y: e.clientY,
          items: opts.map(o => ({ label: o.label, go: () => { take(o); render(); } })),
        };
      }
    }
  }

  if (kind === 'slot' && ui.carrying !== null) {
    const ci = Number(t.dataset['ci']);
    // playtest: the column used to offer one slot at a time and just push, so
    // the ORDER you clicked units in was the order they stood in — "I was
    // forced to do creature B as a blocker before creature A". Both rows are
    // live now and the row you click is the row you get: dropping into the
    // front of an occupied column pushes the sitting unit to the back.
    const row = Number(t.dataset['row']) || 0;
    if (!ui.columns[ci]) ui.columns[ci] = [];
    const col = ui.columns[ci]!;
    if (col.length < 2) col.splice(Math.min(row, col.length), 0, ui.carrying);
    ui.carrying = null;
  }
  if (kind === 'sendslot' && ui.carrying !== null) {
    ui.send.push(ui.carrying);
    ui.carrying = null;
  }

  if (kind === 'hand') {
    handleHandClick(Number(t.dataset['p']) as Seat, Number(t.dataset['i']), e);
  }
  if (kind === 'bin') {
    const p = Number(t.dataset['p']) as Seat, i = Number(t.dataset['i']);
    const legal = legalFor(p);
    // R42: Angel of Anguish prints "I can be prophesied from your bin" — the
    // bin is a prophesy source too, so a bin card can offer both.
    const proph = legal.filter(a => a.type === 'prophesy' && a.from === 'bin' && a.index === i);
    const mods = legal.filter(a => (a.type === 'augment' || a.type === 'graft') && a.from === 'bin' && a.index === i);
    if (proph.length) {
      const name = h.state.players[p]!.bin[i] ?? '?';
      const items: { label: string; go: () => void }[] = [
        { label: prophesyLabel(name), go: () => { binView = null; act(proph[0]!); render(); } },
        ...modMenuItems(p, 'bin', i, name, mods, { close: () => { binView = null; } }),
      ];
      offer(items, e);
    } else {
      if (mods.length) binView = null;   // close the bin dialog so the host pick is visible
      startModding(p, 'bin', i, mods, e);
    }
  }
  if (kind === 'cache') {
    handleCacheClick(Number(t.dataset['p']) as Seat, Number(t.dataset['i']), e);
  }
  render();
}

function handleHandClick(p: Seat, i: number, e: MouseEvent): void {
  if (NET && p !== NET.seat) return;   // can't act from the opponent's hand
  const s = h.state;
  const name = s.players[p]!.hand[i];
  if (!name || name === HIDDEN_CARD || s.decision) return;

  // during an open draft step the hand is drafted from the panel, not recycled
  if (s.mode === 'draft' && s.draftDone && !s.draftDone[p]) return;
  if (s.phase === 'planning' && !s.planningDone[p]) {
    ui.menu = {
      x: e.clientX, y: e.clientY,
      // only the elements actually in this game (a fwe draft offers no wood/metal)
      items: s.elements.map(el => ({
        label: `Recycle → ${el} resource`,
        icon: el,
        go: () => { act({ type: 'recycleForResource', seat: p, handIndex: i, element: el }); render(); },
      })),
    };
    render();
    return;
  }

  const legal = legalFor(p);
  const playActions = legal.filter(a => a.type === 'playCard' && a.handIndex === i);
  const modActions = legal.filter(a => (a.type === 'augment' || a.type === 'graft') && a.from === 'hand' && a.index === i);
  const prophesyActions = legal.filter(a => a.type === 'prophesy' && a.from === 'hand' && a.index === i);
  const items: { label: string; go: () => void }[] = [];
  for (const a of playActions) {
    const mode = a.type === 'playCard' ? a.mode : undefined;
    // R40: "1 Discard me" is a whole alternative play mode like Ambush — pay
    // the cost line, discard the card, which TRASHES it and fires its own
    // "when I am trashed" trigger (Dropslime, Nothyr, Sacrifice Dude).
    const label = mode === 'ambush' ? `Ambush with ${name}`
      : mode === 'discardMe' ? discardMeLabel(name)
      : `Play ${name}`;
    items.push({ label, go: () => { act(a); render(); } });
  }
  // R42: prophesying is a DEPLOYMENT-only action; legalActions already knows
  // that, and which cards may come from the bin, so this just renders it.
  for (const a of prophesyActions) {
    items.push({ label: prophesyLabel(name), go: () => { act(a); render(); } });
  }
  items.push(...modMenuItems(p, 'hand', i, name, modActions));
  offer(items, e);
}

/** a plain mana amount as the bracketed WORD the cards print ([two]), so
 * iconizeText swaps in the real cost icon; big/odd numbers stay as digits */
const MANA_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const manaTok = (n: number): string => `[${MANA_WORDS[n] ?? n}]`;

/** R42: the prophesy menu entry. The banner cost is a PLAIN number — no
 * affinity pips — and the condition is what the payment actually buys. */
function prophesyLabel(name: string): string {
  let mana: number | undefined;
  let condition = '';
  try {
    const pr = getCard(name).prophecy;
    if (pr) { mana = pr.mana; condition = pr.condition; }
  } catch { /* not a registry card */ }
  return `Prophesy ${name}${mana === undefined ? '' : ` for ${manaTok(mana)}`} — cache it` +
    (condition ? `, free once “${condition}”` : '');
}

/** R40: the "Discard me" cost line, spelled out (it is a cost, not an effect).
 * A cost with affinity pips (Nothyr's `2 [d]`) has to stay in DIGITS — the
 * spelled-out `[two]` form only iconizes on its own, `[twod]` matches nothing. */
function discardMeLabel(name: string): string {
  let cost = '';
  try {
    const dm = getCard(name).discardMe;
    if (dm) cost = ` for [${dm.cost ? `${dm.mana}${dm.cost}` : MANA_WORDS[dm.mana] ?? dm.mana}]`;
  } catch { /* not a registry card */ }
  return `Discard ${name}${cost} — pay and trash it (fires its own trashed trigger)`;
}

/** R41/R42/R45: clicking a cached card — play it (free via a fulfilled
 * prophecy, or for its mana via a live glimpse), or apply it as a mod. Cached
 * cards in EITHER cache are also legal targets (Prismatic Observer). */
function handleCacheClick(p: Seat, i: number, e: MouseEvent): void {
  const s = h.state;
  const cc = cacheOf(p)[i];
  if (!cc) return;
  if (s.decision) {
    if (cc.uid === undefined) return;   // cached before uids existed: untargetable
    const idx = decisionOptionIndex({ cached: { seat: p, uid: cc.uid } });
    if (idx >= 0) act({ type: 'decide', seat: s.decision.seat, choice: idx });
    return;
  }
  if (NET && p !== NET.seat) return;   // I can look at their cache, not play from it
  const via = q().cachePermission(p, i);
  const plays = legalFor(p).filter(a => a.type === 'playCached' && a.index === i);
  const mods = cacheModActions(p, i);
  const items: { label: string; go: () => void }[] = [];
  for (const a of plays) {
    items.push({
      label: via === 'prophecy'
        ? `Play ${cc.card} — FREE (fulfilled prophecy; ignores affinity)`
        : `Play ${cc.card} — pay its mana (glimpse; ignores affinity)`,
      go: () => { cacheView = null; act(a); render(); },
    });
  }
  // R42: a fulfilled prophecy makes grafting/augmenting free as well
  const free = via === 'prophecy' ? ' — free' : '';
  items.push(...modMenuItems(p, 'cache', i, cc.card, mods,
    { close: () => { cacheView = null; }, suffix: free }));
  offer(items, e);
}

/** the common tail: exactly one thing to offer just happens; more open a menu
 * at the cursor (the caller's render() paints it) */
function offer(items: { label: string; go: () => void }[], e: MouseEvent): void {
  if (items.length === 1) items[0]!.go();
  else if (items.length > 1) ui.menu = { x: e.clientX, y: e.clientY, items };
}

/** The augment/graft menu entries for a mod-source card. Hand, bin and cache
 * share them, differing only in the zone, an optional dialog to close first
 * (so the host pick is visible), and the cache's "— free" tag (R42: a
 * fulfilled prophecy pays for the mod too). */
function modMenuItems(p: Seat, from: ModZone, i: number, name: string, mods: Action[],
  opts: { close?: () => void; suffix?: string } = {}): { label: string; go: () => void }[] {
  const start = (mode: 'augment' | 'graft') => (): void => {
    opts.close?.();
    ui.modding = { seat: p, from, index: i, mode };
    render();
  };
  const sfx = opts.suffix ?? '';
  const items: { label: string; go: () => void }[] = [];
  if (mods.some(a => a.type === 'augment')) items.push({ label: `Augment a unit with ${name}${sfx}`, go: start('augment') });
  if (mods.some(a => a.type === 'graft')) items.push({ label: `Graft ${name} under a unit${sfx}`, go: start('graft') });
  return items;
}

function startModding(p: Seat, from: ModZone, i: number, legal: Action[], e: MouseEvent): void {
  const modes: ('augment' | 'graft')[] = [];
  if (legal.some(a => a.type === 'augment')) modes.push('augment');
  if (legal.some(a => a.type === 'graft')) modes.push('graft');
  if (!modes.length) return;
  if (modes.length === 1) { ui.modding = { seat: p, from, index: i, mode: modes[0]! }; return; }
  ui.menu = {
    x: e.clientX, y: e.clientY,
    items: modes.map(mode => ({ label: `${mode} with this card`, go: () => { ui.modding = { seat: p, from, index: i, mode }; render(); } })),
  };
}

function applyMod(m: NonNullable<UiState['modding']>, hostId: EntityId, e: MouseEvent): void {
  if (m.mode === 'augment') {
    act({ type: 'augment', seat: m.seat, from: m.from, index: m.index, hostId });
    return;
  }
  const host = h.state.entities[hostId];
  const nMods = host?.mods.length ?? 0;
  if (nMods === 0) {
    act({ type: 'graft', seat: m.seat, from: m.from, index: m.index, hostId, position: 0 });
    return;
  }
  // choose the insert position (below the base, anywhere in the stack)
  ui.menu = {
    x: e.clientX, y: e.clientY,
    items: Array.from({ length: nMods + 1 }, (_, pos) => ({
      label: pos === 0 ? 'Insert directly under the base card' : `Insert below mod #${pos}`,
      go: () => { act({ type: 'graft', seat: m.seat, from: m.from, index: m.index, hostId, position: pos }); render(); },
    })),
  };
}

// ?demo — jump into a mid-battle with a spell on the stack
function demoBattle(): void {
  h = new Harness(7);
  resetUi();
  // NB: h.do() replaces h.state — always read it fresh
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const e = new E(h.state);
  const whale = e.spawnUnit(A, 'Good Whale', e.homeRegion(A));
  const sky = e.spawnUnit(A, 'Ephemeral Skywalker', e.homeRegion(A));
  e.spawnUnit(D, 'Rune Channeler', e.homeRegion(D));
  e.spawnUnit(D, 'Curio Drifter', e.homeRegion(D));
  for (let i = 0; i < 4; i++) h.state.players[A]!.resources.push({ kind: 'fire', state: 'open' });
  for (let i = 0; i < 5; i++) h.state.players[D]!.resources.push({ kind: 'water', state: 'open' });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.state.initiative = A;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  // decline the haste step if a drawn haste card engaged it (seed-dependent)
  for (const seat of [0, 1] as Seat[]) {
    if (h.state.phase === 'planning' && h.state.hasteDone && !h.state.hasteDone[seat]) {
      h.do({ type: 'doneHaste', seat });
    }
  }
  h.do({ type: 'declareAttack', seat: A, columns: [[whale.id], [sky.id]] });
  h.do({ type: 'passPriority', seat: A });
  h.state.players[D]!.hand.push('Jelly');
  h.do({ type: 'playCard', seat: D, handIndex: h.state.players[D]!.hand.length - 1 });
  const dec = h.state.decision!;
  const idx = dec.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ unit: whale.id }));
  h.do({ type: 'decide', seat: dec.seat, choice: idx });
}

// ── bootstrap: home screen by default; ?ws=1&room=… network game,
//    ?hotseat=1 local hotseat, ?demo scripted mid-battle ─────────────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && NET) {
    e.preventDefault();
    NET.undo();
  }
});

// ── #3 hotkeys: Space = pass, Enter = primary confirm, Esc = cancel ────
/** primary "done/confirm" buttons Enter may trigger, most specific first —
 * presence in the DOM ⇒ the action is legal right now (render() guarantees) */
const ENTER_BTNS = [
  '[data-btn="revealdone"]', '[data-btn="passconfirm"]', '[data-btn="doneplanconfirm"]',
  '[data-btn="confirmattack"]', '[data-btn="confirmblocks"]', '[data-btn="draftcommit"]',
  '[data-btn="bottomcommit"]',
  '[data-btn="donedeploy"]', '[data-btn="doneplan"]', '[data-btn="donehaste"]',
];
document.addEventListener('keydown', e => {
  if (!inGame) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.repeat) return;   // held key must not machine-gun actions
  const el = e.target as HTMLElement | null;
  const inField = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

  if (e.key === 'Escape') {
    // close whatever is on top first; game-state cancels only come after every
    // overlay is gone — and never while typing (the field just blurs/closes)
    if (inField) el!.blur();
    if (ui.menu) { ui.menu = null; render(); return; }
    if (reportOpen) { reportOpen = false; render(); return; }
    if (inspect) { inspect = null; render(); return; }
    if (judgeOpen) { judgeOpen = false; render(); return; }
    if (helpOpen) { helpOpen = false; render(); return; }
    if (binView !== null) { binView = null; render(); return; }
    if (erasedView !== null) { erasedView = null; render(); return; }
    if (concedeAsk !== null) { concedeAsk = null; render(); return; }
    if (cacheView !== null) { cacheView = null; render(); return; }
    if (pendingReveal) { pendingReveal = null; releaseHeldFlashes(); render(); return; }
    if (inField) return;
    // the four "are you sure?" bars — Esc is their "Go back" (the doneplan
    // one even advertises it on the button)
    if (ui.confirmDone !== null) { ui.confirmDone = null; render(); return; }
    if (ui.confirmPass !== null) { ui.confirmPass = null; render(); return; }
    if (ui.confirmDeploy !== null) { ui.confirmDeploy = null; render(); return; }
    if (ui.confirmAct) { ui.confirmAct = null; render(); return; }
    if (ui.modding) { ui.modding = null; render(); return; }
    if (canCancelNow()) { startCastCancel(); render(); return; }
    if (ui.carrying !== null) { ui.carrying = null; render(); return; }
    if (ui.columns.some(c => c && c.length) || ui.send.length || ui.spellTokens.length) {
      ui.columns = []; ui.send = []; ui.spellTokens = []; render(); return;
    }
    return;
  }

  if (inField) return;   // never fire game hotkeys while typing
  const overlayUp = reportOpen || judgeOpen || helpOpen || !!inspect
    || binView !== null || erasedView !== null || concedeAsk !== null || cacheView !== null || !!ui.menu;

  if (e.key === ' ') {
    if (overlayUp) return;
    const btn = document.querySelector('[data-btn="pass"], [data-btn="passconfirm"]') as HTMLButtonElement | null;
    if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }   // consumed: no page scroll
    return;
  }

  if (e.key === 'Enter') {
    // the reveal interstitial's Continue outranks everything; other overlays
    // swallow Enter so it cannot confirm game actions behind them
    if (!pendingReveal && overlayUp) return;
    for (const sel of ENTER_BTNS) {
      const btn = document.querySelector(sel) as HTMLButtonElement | null;
      if (btn && !btn.disabled) { e.preventDefault(); btn.click(); return; }
      if (pendingReveal) return;   // reveal open: only Continue is eligible
    }
    return;
  }
});

/** R65: the two things the board itself offers on a right-click, wherever you
 * click — both were playtest asks ("We need a way to right click -> concede
 * match :(", "I dont think there's currently a way to view erased cards").
 * They ride on every card menu too, so you never have to hunt for bare table. */
function boardMenuItems(): { label: string; go: () => void }[] {
  const items: { label: string; go: () => void }[] = [];
  for (const p of [0, 1] as Seat[]) {
    const pl = h.state.players[p]!;
    // the same count the dialog shows: real cards, then "+n tokens" (R69)
    const n = erasedPileView(pl.erased).countLabel;
    const mine = NET ? p === NET.seat : false;
    items.push({
      label: `🚫 ${mine ? 'My' : `${pl.name}'s`} erased cards (${n})`,
      go: () => { erasedView = p; render(); },
    });
  }
  if (h.state.phase !== 'gameover') {
    // net: you may only concede your own seat. Hotseat: one person is driving
    // both, so both are offered — and priority can be null (planning, draft),
    // which is exactly when someone might want to stop.
    const seats: Seat[] = NET ? [NET.seat] : [0, 1];
    for (const seat of seats) {
      items.push({
        label: NET ? '🏳 Concede the match' : `🏳 Concede as ${h.state.players[seat]!.name}`,
        go: () => { concedeAsk = seat; render(); },
      });
    }
  }
  return items;
}

/** the concede confirmation — irreversible, so it is never one click */
let concedeAsk: Seat | null = null;
function concedeHtml(): string {
  if (concedeAsk === null) return '';
  const name = h.state.players[concedeAsk]!.name;
  return `<div class="overlay mainonly"><div class="overlaybox">
    <h3>Concede the match?</h3>
    <p>${esc(name)} loses immediately and the game is over. This cannot be undone.</p>
    <button data-btn="concedeyes">Concede</button>
    <button data-btn="concedeno">Keep playing</button>
  </div></div>`;
}

// right-click any card (board, hand, bin, preview, reveal) → inspector menu
document.addEventListener('contextmenu', e => {
  if (!inGame) return;   // never paint game UI over the home screen
  const t = (e.target as HTMLElement).closest('[data-prev], [data-previd]') as HTMLElement | null;
  if (!t) {
    // bare table: the board menu on its own
    const bare = boardMenuItems();
    if (!bare.length) return;
    e.preventDefault();
    ui.menu = { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY, items: bare };
    render();
    return;
  }
  e.preventDefault();
  const id = t.dataset['previd'] !== undefined ? Number(t.dataset['previd']) : undefined;
  const me = e as MouseEvent;
  const name = id !== undefined ? h.state.entities[id]?.card : t.dataset['prev'];
  if (!name || name === HIDDEN_CARD) {
    // a card back has nothing to inspect, but the board menu still applies —
    // otherwise right-clicking the opponent's hand is a dead click
    ui.menu = { x: me.clientX, y: me.clientY, items: boardMenuItems() };
    render();
    return;
  }
  const items: { label: string; go: () => void }[] = [
    { label: `📖 ${name} — details, attributes & rulings`, go: () => openInspector(name, id) },
    { label: `⚖ Ask the judge about ${name}`, go: () => {
        judgeOpen = true;
        judgeDraft = `I have a question about ${name}. `;
        render();
      } },
  ];
  // #2: auto-yield toggle — on units, and on TRIGGER items on the stack
  // (keyed by the trigger's source entity id; net games only, stored per room)
  if (NET) {
    let yid: EntityId | undefined;
    let yname = name;
    const en = id !== undefined ? h.state.entities[id] : undefined;
    if (en && en.kind === 'unit') yid = en.id;
    else if (t.dataset['act'] === 'stackitem') {
      const it = stackItemById(Number(t.dataset['id']));
      if (it && it.kind === 'triggered' && it.sourceId !== undefined) {
        yid = it.sourceId;
        yname = h.state.entities[it.sourceId]?.card ?? it.card ?? name;
      }
    }
    if (yid !== undefined) {
      const on = yieldMap.has(yid);
      const target = yid;
      items.push({
        label: on ? `⏩ Stop auto-yielding to ${yname}'s triggers`
                  : `⏩ Auto-yield to ${yname}'s triggers`,
        go: () => {
          if (on) yieldMap.delete(target); else yieldMap.set(target, yname);
          saveYield();
          render();
        },
      });
    }
  }
  ui.menu = { x: me.clientX, y: me.clientY, items: [...items, ...boardMenuItems()] };
  render();
});

// the ghost cards the motion layer flies need the same art resolution the
// board uses (registry image overrides included) — except a card this client
// may not see, which has no art and flies as a card back
initAnim({ art: (name: string) => (name === HIDDEN_CARD ? '' : art(name)) });

const params = new URLSearchParams(location.search);
/** false on the home screen — the game click-fallback must not fire there */
const inGame = (params.has('room') && !!params.get('room')!.trim()) || params.has('hotseat') || params.has('demo');
// accounts: fetch the profile behind the stored token, and give the module a
// way to repaint. In a game the repaint is a no-op — a profile push arriving
// mid-game must never paint the home screen over the board.
acct.initAccounts({ app: $app, rerender: () => { if (!inGame) renderHome(); } });
if (params.has('room') && params.get('room')!.trim()) {
  const room = params.get('room')!.toUpperCase().trim();
  const sp = params.get('seat');
  const seat: Seat | null = sp === '0' ? 0 : sp === '1' ? 1 : null;
  const urlEls = params.get('els')?.split(',').map(s => s.trim()).filter(Boolean);
  NET = new NetBackend(room, seat, params.get('mode') ?? undefined, urlEls?.length ? urlEls : undefined);
  h = NET;
  loadYield();       // #2: per-room auto-yield choices survive a refresh
  loadSeenDrop();    // …and so do the cards you have crossed off the hand aid
  renderConnecting();
} else if (params.has('hotseat')) {
  if (params.get('mode') === 'draft') {
    const hotEls = params.get('els')?.split(',').map(s => s.trim()).filter(Boolean) as import('../src/types.ts').Element[] | undefined;
    h = new Harness(Math.floor(Math.random() * 1e6), undefined, 'draft', hotEls);
  } else if (params.get('mode') === 'constructed') {
    // hotseat constructed: the saved deck plays against itself (testing rig)
    const d = savedDeck();
    if (d) h = new Harness(Math.floor(Math.random() * 1e6), undefined, 'constructed', undefined, [d.cards, d.cards]);
  }
  render();
} else if (params.has('demo')) {
  demoBattle();
  render();
} else {
  renderHome();
}


