/* Hotseat UI over the pure engine — a dumb terminal (docs/04 §7).
 * Full re-render after every action; all game mutation goes through
 * Harness.do(action); pending decisions render as highlights or a prompt.
 * Both hands are visible: this is the M1 test rig, not the product. */
import { Harness } from '../src/harness.ts';
import {
  decisionBlocks, forcedAction, legalActions, IllegalAction, ALL_ELEMENTS,
} from '../src/apply.ts';
import { getCard, ELEMENT_OF_PIP } from '../src/cards/dsl.ts';
import type { XPreviewRow } from '../src/cards/dsl.ts';
import {
  actionNeedsMenu, activatableUnits, activationBadge, activationKeys, activationNeedsConfirm,
  assignSplitStep, assignSplitStepper, assignSplitSubmit,
  blockPlanIssue, boardMenuEntries, cacheBlockReason, cardClasses, castableTokens,
  counterAmountIndex, counterPickIndex, counterPickUnits, counterPickValue, counterStepper,
  counterStepperCount,
  dismissSeenCard, dismissSeenHand,
  erasedPileView, groupReveal, growCardLedger, handOfferBadge, handOffers,
  linkCardNames, modHostCount, modHostPhrase,
  modHosts, onlyKnownNames, optionPingId, packBadgeLine,
  partitionOptions, planOffer, playableCachedIndexes, playableCachedNames, seenHandView,
  spellAugmentNote,
  stackAbilityRows, stackItemX, stackItemModes,
  prismiteClickPlan, resourceMenuElements,
  stackXMark, takeAutoPass, tokensCreatedBy, transformFaces, unitClickOptions, waitingNote,
  watchCast,
} from './inspect.ts';
import type {
  AutoPassPlan, Badge, CacheBlock, CastWatch, FormationRole, ModHosts, SeenHandDismissals,
  UnitClickOption,
} from './inspect.ts';
import {
  autoPassDecision, blockVerdict, passEndsBattlePhase, ridableTokens, sendableTokens, shouldAskRide,
  shouldAskSend, splitCounterattack,
} from './battle.ts';
import type * as bat from './battle.ts';
import { clearBuild, dropIntoRow, halfRows, hasBuild, publishCols, rekeyBuild } from './formation.ts';
import { entityTextBox, iconizeText, printedTextBox, textBoxFor, txtIcon } from './cardtext.ts';
import type { AttrOrigin, CardTextBox, LineOrigin, StatBreakdown } from './cardtext.ts';
import { census, diffCensus, HIDDEN_CARD, nameKeys } from './motion.ts';
import { EXPANSION_GUIDE, glossaryHits, GLOSSARY, KEYWORDS } from './glossary.ts';
import { mdToHtml } from './markdown.ts';
import { resourceRow } from './resources.ts';
import type { ResourceView } from './resources.ts';
import type { GlossEntry } from './glossary.ts';
import type { Census } from './motion.ts';
import {
  captureFrame, clarityOn, clearArrows, initAnim, motionOn, playMotion, pulseKeys,
  setBaseArrows, setHoverArrows, setMotionOn,
} from './anim.ts';
import type { ArrowSpec } from './anim.ts';
import { armsIdle, diffSfx, sfxSnap } from './sfx.ts';
import type { SfxSnap } from './sfx.ts';
import {
  censusFlashes, combatStages, dueBeats, heldLines, nextBeatWake, nextFlashWake,
  pruneFlashes, queueBeats, queueFlashes, stackCaption, stackRows, STAGGER_MS,
} from './flash.ts';
import type { Beat, Flash } from './flash.ts';
import { emptyPace, holdable, pace, paceDue, paceFlush, paceHeld, paceWake } from './pace.ts';
import type { PaceQueue } from './pace.ts';
import {
  armIdle, disarmIdle, playCue, primeAudio, setSoundOn, soundOn,
} from './audio.ts';
import { E } from '../src/engine.ts';
import type {
  Action, ActivateVia, CachedCard, CardName, Decision, EngineEvent, Entity, EntityId, EventType,
  GameState, Seat, StackItem, TargetRef,
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

/** one message off the socket. Named (it used to be inline on onMsg) because
 * R150 QUEUES the 'update' ones — see ui/pace.ts. */
interface NetMsg {
  t: string; seat?: Seat; view?: GameState; log?: string[]; legal?: Action[];
  events?: EngineEvent[]; reveal?: { msg: string }[]; peers?: [boolean, boolean]; msg?: string;
  /** which hidden segment a reveal closes (server/main.ts sendReveal) */
  step?: 'plan' | 'haste' | 'deploy';
  clock?: ClockSnap; waiting?: { have: [boolean, boolean]; trio?: lob.TrioLobby }; names?: [string, string];
  trio?: lob.TrioReveal;
  cols?: EntityId[][]; send?: EntityId[]; building?: { cols: EntityId[][]; send: EntityId[] } | null;
  me?: acct.Me;
  rematch?: [boolean, boolean];
}

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
  /**
   * R150/CT-28: authoritative updates waiting their turn on the clock, so the
   * table can never move faster than a human can read it. See ui/pace.ts for
   * the whole argument; the two invariants worth repeating here are that the
   * queue only ever holds updates the player cannot act on, and that an
   * un-holdable update FLUSHES everything ahead of it rather than jumping it.
   */
  private paced: PaceQueue<NetMsg> = emptyPace();
  private paceTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * An intent of ours is on the wire, so the next update is (very probably)
   * our own echo and must not be delayed — the throttle may never add latency
   * to the player's own input. Over-eager by construction: if the opponent's
   * update overtakes ours the worst case is one update surfacing early, which
   * is the safe direction.
   */
  private mineInFlight = false;
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
    // [59] …and must take the latch with them. This state has now been spent;
    // nothing else may act on it until the server says what it became.
    this.latch();
    this.mineInFlight = true;   // R150: our own echo is never paced
    this.sentBuilding = '';                       // a real action resets the relay
    this.ws.send(JSON.stringify({ t: 'action', action: a }));
  }
  /** [59] one intent per authoritative state — see UiState.sentFor */
  private latch(): void { ui.sentFor = this.state?.actionCount ?? -1; }
  /** publish the formation being built (no-op when nothing changed) */
  sendBuilding(cols: EntityId[][], send: EntityId[]): void {
    const payload = JSON.stringify({ t: 'building', cols, send });
    if (payload === this.sentBuilding || this.ws.readyState !== WebSocket.OPEN) return;
    this.sentBuilding = payload;
    this.ws.send(payload);
  }
  undo(): void {
    this.latch(); this.mineInFlight = true;
    this.ws.send(JSON.stringify({ t: 'undo' }));
  }

  // ── R150/CT-28: the drain ───────────────────────────────────────────
  /** release everything whose moment has come, then re-arm the timer */
  private pumpPace(): void {
    const { out, rest } = paceDue(this.paced, Date.now());
    this.paced = rest;
    for (const m of out) this.applyUpdate(m);
    if (out.length) render();
    this.schedulePace();
  }

  /** the skip / fast-forward affordance: jump to the live state in one step */
  flushPace(): void {
    const { out, rest } = paceFlush(this.paced);
    this.paced = rest;
    this.schedulePace();
    for (const m of out) this.applyUpdate(m);
    if (out.length) render();
  }

  /** how many updates the throttle is holding — what the skip chip counts */
  heldUpdates(): number { return paceHeld(this.paced, Date.now()); }

  private schedulePace(): void {
    if (this.paceTimer !== null) { clearTimeout(this.paceTimer); this.paceTimer = null; }
    const at = paceWake(this.paced, Date.now());
    if (at === null) return;
    this.paceTimer = setTimeout(() => {
      this.paceTimer = null;
      this.pumpPace();
    }, Math.max(0, at - Date.now()));
  }
  /** draft lobby: change the method, submit, lock or unlock (server/trio.ts) */
  lobby(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ t: 'lobby', ...msg }));
  }
  /** post-game: ask for (or take back) a rematch */
  rematch(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ t: 'rematch', ...msg }));
  }
  private onMsg(m: NetMsg): void {
    // the post-game screen: the whole payload on game over, then just the
    // rematch state as the two of you make up your minds
    if (m.t === 'gameover') {
      this.flushPace();   // R150: nothing is left waiting behind the result
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
      // R150/CT-28: a readable ceiling on how fast the table may move. The
      // gate is in ui/pace.ts and is tested there; all this does is ask it,
      // queue, and pump.
      const mine = this.mineInFlight;
      this.mineInFlight = false;
      const legal = m.legal ?? this.legal;
      // "this window is going to be answered without asking the player" — two
      // ways in. The Pass-all chip is a loud, visible arm with its own ✕ stop.
      // The PREFERENCE only fires when passing is the sole legal action, so
      // that case is tested rather than assumed: a window offering a real
      // choice is never held on the strength of the preference alone.
      const autoPassArmed = ui.autopass
        || (localStorage.getItem('algoAutopass') === '1'
          && legal.length > 0 && legal.every(a => a.type === 'passPriority'));
      const hold = holdable({
        mine,
        // server/view.ts nulls a decision that is not yours, so a decision
        // this client can see is always this seat's to answer
        askedOfMe: !!m.view?.decision,
        legal: legal.length,
        autoPassArmed,
        over: m.view?.phase === 'gameover',
      });
      this.paced = pace(this.paced, m, Date.now(), hold);
      this.pumpPace();
      return;
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
      // R150: never say "no" about a board the player cannot see yet — spend
      // the queue first, so the refusal lands on the state it is about
      this.flushPace();
      // [59] a refusal leaves actionCount exactly where it was, so the latch
      // would never lift on its own — and the player would be locked out of a
      // state they are still holding. Release it here instead.
      ui.sentFor = -1; ui.autoAt = -1;
      ui.cancelling = false; uiError = m.msg ?? 'error'; playCue('error'); render(); return;
    }
  }

  /** One queued authoritative update, folded in. Everything here used to run
   * inline in onMsg; R150 only moved WHEN it runs, never what it does. The
   * caller renders — a flush folds several in and paints once. */
  private applyUpdate(m: NetMsg): void {
    // [59] a fresh authoritative state supersedes a complaint about the
    // previous one. uiError was cleared in act() and nowhere on the way IN,
    // so a refusal earned by an automatic pass — which never goes through
    // act() — stayed on screen for the rest of the game.
    uiError = '';
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
    // UFAB: the cast list grows from the batch BEFORE anything is drawn, or
    // the very line announcing a card ("Ben plays Bripp → stack.") would be
    // the one line that fails to link it.
    noteCardsSeen(m.events ?? []);
    // R80: and the combat beats are staged off the same batch, so the log
    // lets go of a whole damage step one stage at a time. Behind the reveal
    // overlay nobody is looking at the log, so that batch is not paced —
    // and passing [] is also what clears a queue the reveal would otherwise
    // leave holding lines that now belong to a different batch.
    // (…and not off a full resync either: `m.log` means the log was
    // REWRITTEN — an undo replayed the game — so its tail is not a story
    // anybody just watched happen.)
    absorbBeats(pendingReveal || m.log ? [] : (m.events ?? []));
  }
}

let NET: NetBackend | null = null;
let h: Backend = new Harness(Math.floor(Math.random() * 1e6));
let uiError = '';

/** the zones a mod (augment/graft) can be applied from — R41 added the cache */
type ModZone = 'hand' | 'bin' | 'cache';

/**
 * One entry in the click menu (ui.menu), and in the list `offer()` weighs
 * before deciding whether there is anything to open a menu FOR.
 *
 * [08b] `confirm` is the flag that keeps a lone entry from firing on the click
 * that revealed it — see actionNeedsMenu in ui/inspect.ts.
 */
interface MenuItem { label: string; icon?: string; go: () => void; confirm?: boolean }

interface UiState {
  carrying: EntityId | null;
  columns: EntityId[][];
  send: EntityId[];
  /** spell tokens riding along with the attack being built (C1) */
  spellTokens: EntityId[];
  /** R41: 'cache' is a third mod source — "you CAN augment or graft from
   * cache" (Caleb 2024-12-02) — so the in-progress mod has to name it too. */
  modding: { from: ModZone; index: number; seat: Seat; mode: 'augment' | 'graft' } | null;
  menu: { x: number; y: number; items: MenuItem[] } | null;
  orderPicked: number[];
  /** BL-25/R139: how many counters the next counter-removal click takes, and
   * the decision id it was dialled for — a fresh question always starts at
   * the floor, so the count can never be carried onto a menu that never
   * offered it. */
  counterCount: number;
  counterFor: number;
  /** CT-34/R149: how much combat damage the elective-split ticker is offering
   * the victim currently being asked, and the decision id it was dialled for.
   * A strike asks one question per victim, so a fresh id always restarts at
   * that victim's floor rather than carrying a number its menu never had. */
  assignCount: number;
  assignFor: number;
  /** draft step: pile indices (into hand.concat(pack)) marked "leave in pack" */
  draftPack: number[] | null;
  /** which turn+seat draftPack was built for (re-init on change) */
  draftFor: string;
  /** keep passing my priority windows until the battle ends or something new
   * hits the stack (net mode only) */
  autopass: boolean;
  /** stack height when autopass was armed — growth disarms it */
  autopassStack: number;
  /** #1: activateAbility keys that were already legal when Pass-all was armed —
   * a NEW key appearing (a resolution granted an ability) disarms the chip */
  autopassSig: string[];
  /**
   * [59] actionCount an AUTOMATIC pass has already been scheduled for.
   *
   * One field for all three auto-pass reasons (Pass-all, the C4 toggle, an
   * auto-yielded trigger). They used to hold a stamp each, which made them
   * one-shot individually and not at all collectively: with the toggle on and
   * a yielded trigger on top, two passes went out for one state and the second
   * came back "you do not have priority".
   */
  autoAt: number;
  /**
   * [59] actionCount ANY intent was last handed to the socket for.
   *
   * The client has no local copy of the rules in net mode, so between a send
   * and the pushed view it is looking at a state it has already spent. This is
   * the latch that stops it spending it twice — set by NetBackend.do/undo,
   * released by the next authoritative actionCount (an applied action always
   * bumps it) or, if the server refused, by the error itself.
   */
  sentFor: number;
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
  /** [69] "Attack!" pressed with ride-along spell tokens available and none
   * picked: which seat is being asked which tokens come along. */
  confirmRide: Seat | null;
  /** [69] the ride-along question has been answered for the attack currently
   * being built — one dialogue per attack, not one per click of Attack!.
   * Cleared wherever the formation is (a declaration, a clear, a skip). */
  rideAnswered: boolean;
  /** playtest: "done deploying" pressed while cards in the cache are playable
   * RIGHT NOW — easy to forget a zone you are not used to watching. Holds the
   * seat being asked. */
  confirmDeploy: Seat | null;
  /** playtest: an irreversible activation (a "Sacrifice me:" cost) with NO
   * target decision to walk you back — held until confirmed. */
  confirmAct: { seat: Seat; entityId: EntityId; abilityIndex: number;
    via?: ActivateVia; label: string; unit: string } | null;
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
  /**
   * [77] The last block declaration the ENGINE refused, as structure: which
   * units went, why, and what the board kept. Held so the bar can name them
   * and offer "Reset blockers?" instead of the board silently emptying.
   * Cleared by the next declaration, by the reset, and by the step ending.
   */
  blockRefusal: bat.BlockVerdict | null;
  /**
   * [77] A block declaration is on the wire and the board is still holding the
   * plan that produced it.
   *
   * The plan used to be dropped the instant the action was sent, which is
   * right in hotseat (`act()` has already applied it or set `uiError`) and
   * wrong over a socket, where the refusal arrives after the wipe. So the
   * plan is kept until an authoritative state says the declaration LANDED —
   * `ensureBlockKeys` drops it then.
   */
  blockSent: boolean;
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
  counterCount: 1, counterFor: -1,
  assignCount: 0, assignFor: -1,
  draftPack: null, draftFor: '', autopass: false, autopassStack: 0,
  autopassSig: [], autoAt: -1, sentFor: -1, cancelling: false, cancelAt: -1,
  prefillFor: '', confirmDone: null, confirmPass: null,
  confirmRide: null, rideAnswered: false, homeEls: savedEls(),
  homeFixedTrio: false,
  confirmDeploy: null, confirmAct: null,
  bottomPick: [], bottomFor: '', blockLine: null,
  blockRefusal: null, blockSent: false,
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
  cardsSeen = new Set();
  dropBaselines();
};

// ── the log's cast list (ui/inspect.ts growCardLedger) ────────────────
//
// UFAB: "all strings that match card names become hoverable cards… so
// 'Battle:' (which happens every turn) looks like it's a card name. Instead,
// the game log should only highlight actual cards used in the game."
//
// `Battle` IS a card, so the phase line linked one every turn. This is the set
// of cards this game has really shown; `logLineHtml` links a name only if it
// is in here. It grows and never shrinks — a card recalled out of play must
// still link in the older lines that named it — and is dropped only by
// resetUi(), which is a NEW GAME, not a new view of this one.
let cardsSeen = new Set<CardName>();

/** Fold the current board (and, when a batch just arrived, its events) into
 * the cast list. Called from renderNow — so the set is always at least as big
 * as what is on screen, whatever route the state took to get here — and from
 * the two action paths, which is what catches the things state alone cannot:
 * a spell token created and resolved inside one batch is in no state this
 * client is ever handed, but its 'stackFlash' snapshot names it. */
function noteCardsSeen(events: readonly EngineEvent[] = []): void {
  growCardLedger(cardsSeen, h.state, events);
}

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
  beatQueue = [];       // R80: and the narrative beats holding back log lines
  cancelAutoPass();     // R80: a pass scheduled against a board that is gone
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

// ── R80: narrative beats — the combat step told one stage at a time ───
//
// UFAB: "Neither of us had anything to do during the end of that combat, but
// damage and all effects happened instantly. We should have been able to see,
// much slower, what happened and how much damage went through."
//
// ui/flash.ts does the arithmetic; this is the two lines of plumbing it needs.
// The board is NOT staged — docs/11's contract is that a beat explains and
// never gates, and the whole point of the report is that nobody had anything
// to answer. What is staged is the LOG: `heldLines` says how many lines at the
// tail of `h.log` have not been told yet, and renderNow simply draws fewer of
// them. The array itself is never touched, so an undo, a resync or a bug can
// only ever make the missing lines appear — at worst 2.2s (MAX_LEAD_MS) late.

/** the stages of the batch being told, and when each is told */
let beatQueue: Beat[] = [];

/** Stage one action's events. A new batch REPLACES the queue: its lines are
 * already appended behind the old ones, so holding those back now would hide
 * the newest events instead of pacing them. */
function absorbBeats(events: readonly EngineEvent[]): void {
  beatQueue = clarityOn() ? queueBeats(combatStages(events), Date.now()) : [];
}

/** Play the beats whose moment has come: pulse what each stage is about, once.
 * The first stage is skipped — it lands with the batch's own motion diff,
 * which has just pulsed the same cards, and pulsing them twice in one frame
 * reads as a stutter rather than as emphasis. */
function fireBeats(): void {
  const now = Date.now();
  for (const b of dueBeats(beatQueue, now)) {
    b.fired = true;
    if (b !== beatQueue[0]) pulseKeys(b.keys);
  }
}

/** Book the repaint that starts the next beat (or ends the last one). */
function scheduleFlashWake(): void {
  if (flashTimer !== null) { clearTimeout(flashTimer); flashTimer = null; }
  const now = Date.now();
  flashQueue = pruneFlashes(flashQueue, now);
  const flash = nextFlashWake(flashQueue, now);
  const beat = nextBeatWake(beatQueue, now);
  const at = flash === null ? beat : beat === null ? flash : Math.min(flash, beat);
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

// card-text icon/markup formatting lives in ./cardtext.ts (iconizeText) so it
// can be tested — see R134. main.ts imports it with the other text helpers.

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

/** Every engine action, hotseat or network, funnels through act(). The focus
 * pin reads this to tell a MOVE from a LOOK: a click that reaches act() was
 * playing the game, not reading a card. */
let actCount = 0;

function act(a: Action): void {
  actCount++;
  // you are demonstrably at the keyboard — stop counting down to the thump.
  // The next obligation to ARRIVE re-arms it (soundPass).
  disarmIdle();
  if (NET) {
    // network mode: the server is authoritative — send the intent and wait for
    // the pushed redacted update (or an 'error' message). Never apply locally.
    if (a.seat !== NET.seat) { uiError = 'not your seat'; playCue('error'); return; }
    // [59] this state has already been spent — by a click a frame ago, by an
    // automatic pass, or by a cast-cancel undo. A second intent for it is
    // either refused ("you do not have priority") or, worse, applied to a
    // window that is no longer the one the player was looking at.
    if (ui.sentFor === h.state.actionCount) return;
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
    const evs = local.do(a);
    absorbFlashes(evs);
    noteCardsSeen(evs);
    // local mode: drain forced steps (empty boards attack/block by themselves;
    // the server does the same for network games)
    for (let g = 0; g < 8; g++) {
      const f = forcedAction(h.state);
      if (!f) break;
      rememberStack();
      const more = local.do(f);
      absorbFlashes(more);
      noteCardsSeen(more);
      evs.push(...more);
    }
    absorbBeats(evs);
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
/** BL-25/R139: `{counterFrom: id}` is a unit ref too — the highlight has to
 * agree with the click handler, or the board lights up nothing while the
 * prompt tells you to click a unit. */
const isCandidate = (ref: TargetRef): boolean => decisionOptionIndex(ref) >= 0
  || ('unit' in ref && counterPickIndex(h.state.decision, ref.unit, 1) >= 0);

/** #3: when a decision option refers to a LIVE entity, its button/card pings
 * that unit on the board on hover (data-ping) and feeds the focus preview
 * (data-previd). Options without a live entity degrade to nothing. */
function pingAttrs(o: { value: unknown }): string {
  // the judgement (which option values name a live entity, per decision kind)
  // is ui/inspect.ts optionPingId, where BL-24's collision is tested: R75's
  // formation-slot options carry slot INDEXES, which are not entity ids
  const id = optionPingId(o.value, h.state.decision?.kind);
  if (id === null || !h.state.entities[id]) return '';
  return ` data-ping="${id}" data-previd="${id}"`;
}

/* ── BL-25/R139: the counter-removal quantity stepper ──────────────────
 *
 * The owner: "it's just not clear that it wants you to click the unit. It
 * needs to say that. Plus maybe a counter with up/down arrows … or an 'All'
 * button which jumps the count to the max (WITHOUT auto submitting)".
 *
 * Every judgement — which decisions get one, the floor, the ceiling, what −/+/
 * All do, and which option index a unit click sends — is in ui/inspect.ts and
 * tested in test/124-counter-stepper. This is the drawing and the wiring only.
 */

/** the count the stepper is showing for the LIVE decision. A new decision id
 * resets it: an amount dialled for one menu is not an answer to the next
 * question, and a stale 6 over a menu that now caps at 2 would silently take
 * 2 while the bar still said 6. */
function counterCount(): number {
  const dec = h.state.decision;
  if (!dec) return 1;
  if (ui.counterFor !== dec.id) { ui.counterFor = dec.id; ui.counterCount = counterStepper(dec, 1).count; }
  return counterStepper(dec, ui.counterCount).count;
}

/** the option index a click on `unit` should send, or -1 */
function counterClickIndex(id: EntityId): number {
  const dec = h.state.decision;
  return dec ? counterPickIndex(dec, id, counterCount()) : -1;
}

function counterStepperHtml(dec: Decision): string {
  const v = counterStepper(dec, counterCount());
  if (v.mode === 'none') return '';
  const btn = (act: string, txt: string, on: boolean, title: string): string =>
    `<button data-btn="${act}" title="${esc(title)}"${on ? '' : ' disabled'}>${txt}</button>`;
  // the 'amount' shape has no unit to click (the effect already fixed it), so
  // it needs a confirm of its own; the 'pick' shape's confirm IS the unit
  const take = v.mode === 'amount' && counterAmountIndex(dec, v.count) >= 0
    ? ` ${btn('ctrtake', `Take ${v.count}`, true, 'answer with this many')}` : '';
  // styled inline: ui/style.css belongs to another change in flight, and the
  // stepper needs nothing a class would give it that three declarations don't
  return `<span class="ctrstep" style="display:inline-flex;align-items:center;gap:.2em;white-space:nowrap">${
    v.hint ? `<span style="color:var(--dim)">${esc(v.hint)}</span> ` : ''}${
    btn('ctrdown', '−', v.canDown, 'one fewer')}<b style="min-width:1.2em;text-align:center">${v.count}</b>${
    btn('ctrup', '+', v.canUp, 'one more')}${
    btn('ctrall', `All (${v.max})`, v.canAll, 'set the count to the most this can take — it does NOT submit')}${take}</span>`;
}

/* CT-34/R149 — the R120 elective damage-split ticker.
 *
 * Owner report #100: "The damage distribution UI is terrible and confusing.
 * Better would to have a ticker counter thing on each unit that you click
 * up/down and they always are forced to sum to the amount of damage you have."
 *
 * Every judgement — the floor, the ceiling, the clamp, which victims the
 * strike has, which option index a number sends, and why a submit is refused —
 * is in ui/inspect.ts and tested in test/126-assign-split. This is the drawing
 * and the wiring only, for the same reason BL-25 was lifted out of here: a
 * decision that only exists in main.ts is reachable only by playing a whole
 * game over a websocket, and nobody writes that test.
 */

/** the amount the ticker is showing for the LIVE question, clamped into the
 * menu the engine actually sent */
function assignCount(): number {
  const dec = h.state.decision;
  if (!dec) return 0;
  if (ui.assignFor !== dec.id) {
    ui.assignFor = dec.id;
    ui.assignCount = assignSplitStepper(dec, h.state, -Infinity).count;   // the floor
  }
  return assignSplitStepper(dec, h.state, ui.assignCount).count;
}

function assignSplitHtml(dec: Decision): string {
  const v = assignSplitStepper(dec, h.state, assignCount());
  if (v.mode === 'none') return '';
  const sub = assignSplitSubmit(dec, v.count);
  const btn = (act: string, txt: string, on: boolean, title: string): string =>
    `<button data-btn="${act}" title="${esc(title)}"${on ? '' : ' disabled'}>${txt}</button>`;
  // the whole column, so the player can SEE the sum being forced instead of
  // being told about it: what the victims in front were already given, what
  // this one is being offered, and what is left for the ones behind
  const rows = v.rows.map(r => {
    const live = r.state === 'active';
    const dim = r.state === 'behind' ? 'var(--dim)' : 'inherit';
    return `<span style="color:${dim}${live ? ';font-weight:700' : ''}">${
      esc(r.card)} <b>${r.amount}</b>${r.state === 'locked' ? ' ✓' : ''}</span>`;
  }).join('<span style="color:var(--dim)"> → </span>');
  const left = `<span style="color:${v.remaining > 0 ? 'var(--dim)' : 'inherit'}">${
    v.remaining > 0 ? `${v.remaining} still to assign behind` : 'all of it assigned'}</span>`;
  const takeTitle = sub.ok ? `assign ${v.count} to this unit` : sub.why;
  return `<span class="asgstep" style="display:inline-flex;align-items:center;gap:.3em;flex-wrap:wrap">${
    v.hint ? `<span style="color:var(--dim)">${esc(v.hint)}</span>` : ''}${
    rows ? `<span style="display:inline-flex;align-items:center;gap:.2em">${rows}</span>` : ''}${
    btn('asgdown', '−', v.canDown, `one fewer (floor ${v.min} — lethal to this unit)`)}<b style="min-width:1.4em;text-align:center">${v.count}</b>${
    btn('asgup', '+', v.canUp, 'one more')}${
    btn('asgall', `All (${v.max})`, v.canAll, 'give this unit everything left — it does NOT submit')}${
    btn('asgtake', `Assign ${v.count} of ${v.total}`, sub.ok, takeTitle)}${
    v.defaultIndex >= 0 ? ` ${btn('asgdefault', 'Default split', true, 'share front-to-back, the whole column in one click')}` : ''
    } ${left}</span>`;
}

function legalFor(seat: Seat): Action[] {
  // network mode: the server computes and pushes MY legal actions (avoids
  // redaction problems client-side); the opponent's are unknown to me → none.
  if (NET) return seat === NET.seat ? NET.legal : [];
  return legalActions(h.state, seat);
}

/**
 * R170/CT-46 — does the open question (if any) stop `seat` from touching the
 * board? THE one predicate behind every "a decision is up, take no input"
 * branch in this file, and the reason there is only one is that the two
 * callers do not agree and used to.
 *
 * R154 taught `apply()` and `legalActions()` that a decision belongs to a
 * SEAT: outside battle, and where answering it will not rewind the world, the
 * other seat may keep deploying. The client stayed on the pre-R154 reading —
 * a bare `!!s.decision` — and so drew a board it would then refuse to use:
 * measured, seat 1's hand card still wearing its green `playable` ring, taking
 * clicks and doing nothing, with no "done deploying" button anywhere on
 * screen. A frozen board, one layer above an engine that was no longer frozen.
 *
 * ⚠ ONLINE THIS IS A NO-OP BY CONSTRUCTION, and deliberately written so that
 * it can be read as one. `server/view.ts` nulls a decision that is not yours
 * before it ever reaches this client, so a net client's `s.decision` is always
 * its own and `!!NET ||` short-circuits to exactly the old expression.
 * HOTSEAT is the only caller that can see both seats at once, and therefore
 * the only one that ever needed the distinction.
 */
function decisionFreezes(seat: Seat): boolean {
  const s = h.state;
  return !!s.decision && (!!NET || decisionBlocks(s, seat));
}

/** hosts the in-progress mod (ui.modding) could legally land on — computed
 * once per render(); unitHtml highlights the units and stackBoardHtml the
 * stack items (R79), both from the same read of the legal-action list */
let modHostCache: ModHosts = { units: new Set(), stack: new Set() };
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
function moddingHosts(): ModHosts {
  const m = ui.modding;
  // R89: the state is what tells a spell-token host from a unit host — the
  // engine names both in `hostId`, so without it the token would glow as a
  // "unit" and the bar would say so.
  return modHosts(m ? legalFor(m.seat) : [], m, h.state);
}

/* [59] both of these are pure over a legal-action list, and autoPassPlan needs
 * them, so the arithmetic lives in ui/inspect.ts and these just say whose
 * list to read. */
/** distinct spell tokens `seat` could cast right now (C5 pass guard) */
const castableTokenCount = (seat: Seat): number => castableTokens(legalFor(seat));
/** #1: identity keys of every activateAbility currently legal for `seat` —
 * Pass-all snapshots these on arming; a key that was NOT in the snapshot
 * means a resolution granted a new ability, and the chip must disarm. */
const abilityKeys = (seat: Seat): string[] => activationKeys(legalFor(seat));

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

/* [59] The auto-yield pass used to live here as maybeAutoYield(), called
 * unconditionally right after maybeAutopass() — which is how the toggle and
 * the yield came to send two passes for one state. It is one branch of
 * autoPassPlan (ui/inspect.ts) now; only the yielded-unit SET still lives up
 * here, because it is a per-room browser preference and not game state. */

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

/** #5 / #85: the value(s) a card reading a hidden battle ledger would use if it
 * resolved right now. Both hooks are pure per-card queries the engine never
 * calls — see engine/src/cards/dsl.ts.
 *
 * #85 ("Soul Siphon should show what X is for each player") widened this from
 * one number to a list of labelled rows, because Soul Siphon's X is keyed on
 * the DECLARED TARGET player and so has one value per seat. A card carrying
 * only the older single-number `xPreview` comes back as one unlabelled row, so
 * every render site below has exactly one shape to handle. */
function xPreviewFor(name: string, seat: Seat): XPreviewRow[] | null {
  const s = h.state;
  if (s.phase !== 'battle' || !s.battle) return null;
  try {
    const c = getCard(name);
    const region = s.battle.region;
    // rows win when a card defines both — they say strictly more
    const rows = c.xPreviewRows?.(q(), seat, region)
      ?.filter(r => Number.isFinite(r.x));
    if (rows?.length) return rows;
    const v = c.xPreview?.(q(), seat, region);
    return typeof v === 'number' && Number.isFinite(v) ? [{ label: '', x: v }] : null;
  } catch { return null; }
}

/** the corner chip. One row keeps #5's original "X=3 now" wording exactly —
 * the chip is a few pixels wide and a label does not fit — and the labels ride
 * in the tooltip. Several rows show the bare numbers in row order. */
const xBadge = (rows: XPreviewRow[]): Badge => ({
  t: rows.length === 1 ? `X=${rows[0]!.x} now` : `X now: ${rows.map(r => r.x).join(' · ')}`,
  ctr: true,
  title: rows.map(r => (r.label ? `${r.label}: ${r.x}` : `X = ${r.x}`)).join('\n'),
});

/** the same rows spelled out where there IS room (the focus viewer, the
 * inspector). Same `.xnow` presentation the stack viewer already uses for a
 * committed item's X — one idea, one look. */
const xRowsHtml = (rows: XPreviewRow[]): string => rows.map(r =>
  `<div class="xnow">X = ${r.x} right now${
    r.label ? ` <span class="hint">— ${iconizeText(r.label)}</span>` : ''}</div>`).join('');

/** rows ride to the focus viewer through a data attribute, so they have to
 * survive a round trip through the DOM as text. JSON rather than a separator,
 * because a player's name may contain any character at all. */
const packXRows = (rows: XPreviewRow[]): string => JSON.stringify(rows);
function unpackXRows(s: string): XPreviewRow[] {
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v)
      ? v.filter((r): r is XPreviewRow =>
        !!r && typeof r === 'object' && typeof (r as XPreviewRow).x === 'number')
      : [];
  } catch { return []; }
}

// ── rendering ─────────────────────────────────────────────────────────
function cardHtml(name: string, opts: {
  playable?: boolean; candidate?: boolean; selected?: boolean; carrying?: boolean; modhost?: boolean;
  /** UZRG: it has a legal activated ability — a DIFFERENT fact from `playable`
   * ("can be dragged into a formation"), and both can be true at once */
  activatable?: boolean;
  /** CT-49/CT-50 — what the ring MEANS. See ui/inspect.ts `cardClasses`. */
  nocast?: boolean; multi?: boolean; cached?: boolean;
  badges?: Badge[]; stats?: string; dmg?: string; data?: string;
  /** ui/motion.ts slot key — what makes this card the SAME card next render */
  anim?: string;
} = {}): string {
  // [35] the class list is ui/inspect.ts's cardClasses — `.activatable` is the
  // one class with no behaviour attached to it, so nothing but a test notices
  // when it stops being emitted and the green halo quietly goes away.
  const cls = cardClasses(opts);
  // BL-23/R136: the strip is ONE line. Chips are pushed from a dozen call
  // sites that cannot each know how many others there will be, so the fold
  // decision lives here, in the container — ui/inspect.ts packBadgeLine, where
  // 123-badge-line can reach it. Nothing is dropped: what does not fit rides in
  // the "+N" chip's tooltip, and the strip itself carries the full list.
  const line = packBadgeLine(opts.badges ?? []);
  const badges = [...line.shown, ...(line.more ? [line.more] : [])].map(b => `<span class="badge ${b.mod ? 'mod' : ''} ${b.ctr ? 'ctr' : ''} ${b.cls ?? ''}"${
    b.title ? ` title="${esc(b.title)}"` : ''}>${b.html ? b.t : esc(b.t)}</span>`).join('');
  return `<div class="${cls.join(' ')}" ${opts.data ?? ''} data-prev="${esc(name)}"${opts.anim ? ` data-anim="${esc(opts.anim)}"` : ''}>
    <img src="${art(name)}" alt="${esc(name)}" onerror="this.classList.add('noart')">
    <div class="artfallback">${esc(name)}</div>
    ${badges ? `<div class="badges${line.more ? ' hasmore' : ''}"${line.more ? ` title="${esc(line.title)}"` : ''}>${badges}</div>` : ''}
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
    modhost: !opts.inert && modHostCache.units.has(u.id),
    // inert (B2): absent "sent" units are not targets and take no clicks
    data: opts.inert ? `data-previd="${u.id}"` : `data-act="unit" data-id="${u.id}" data-previd="${u.id}"`,
  });
}

function resHtml(r: ResourceView, p: Seat, i: number): string {
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
  // R151 (CT-31): `title` and `emphasis` come from ui/resources.ts, so the
  // "dormant is not spendable here" rule is a tested value rather than a class.
  // Light and Dark have no resource-card scan in AlgomancyCards/ yet, so the
  // face 404s. Degrade to a coloured element plate rather than a broken image:
  // `onerror` tags the wrapper and CSS swaps the plate in.
  return `<span class="rescard ${r.state} ${r.kind} ${canact ? 'canact' : ''} ${r.emphasis === 'muted' ? 'muted' : ''}" title="${r.title}"
    data-act="res" data-p="${p}" data-i="${i}" data-prev="${face}"><img src="${art(face)}" alt=""
      onerror="this.closest('.rescard').classList.add('noart')"
    ><span class="resplate">${esc(r.kind === 'hidden' ? '?' : r.kind)}</span>${chip}</span>`;
}

/** one seat's hand row (also used by the sticky bottom dock in net mode) */
function handZoneHtml(p: Seat): string {
  const pl = h.state.players[p]!;
  const legal = legalFor(p);
  const keys = nameKeys(pl.hand, `h${p}:`);
  const cards = pl.hand.map((n, i) => {
    if (n === HIDDEN_CARD) return backHtml(keys[i]);
    // CT-49 (#54): the ring used to be this OR and nothing else, so a {Battle}
    // spell in deployment — GRAFT only — was drawn exactly like a castable
    // deploy card and disambiguated itself only after the click (report #80).
    // handOffers takes the same OR apart again; ui/inspect.ts owns the words.
    const offers = handOffers(legal, i);
    const playable = offers.length > 0;
    // #5 / #85: live X preview during battle for cards reading a hidden
    // battle ledger — one row per player where the number differs by player
    const badges: Badge[] = [];
    const offer = handOfferBadge(offers);
    // first in push order and rank 0 (it carries a `cls`), so the one chip that
    // says what a click will DO is the last thing packBadgeLine folds away
    if (offer) badges.push(offer);
    const xrows = xPreviewFor(n, p);
    if (xrows) badges.push(xBadge(xrows));
    // R42: this card can be prophesied RIGHT NOW — the banner cost, up front
    if (offers.includes('prophesy')) {
      let mana: number | undefined;
      try { mana = getCard(n).prophecy?.mana; } catch { /* unknown */ }
      badges.push({ t: `📜 prophesy${mana === undefined ? '' : ` [${mana}]`}`, cls: 'proph on' });
    }
    return cardHtml(n, {
      playable, badges, anim: keys[i],
      nocast: playable && !offers.includes('cast'),
      multi: offers.length > 1,
      data: `data-act="hand" data-p="${p}" data-i="${i}"${
        xrows ? ` data-xnow="${esc(packXRows(xrows))}"` : ''}`,
    });
  }).join('');
  return cards + handCachedHtml(p);
}

/**
 * CT-50 (#63): the cached cards this seat can play RIGHT NOW, drawn again at
 * the right-hand end of their hand.
 *
 * Owner, report #103: *"it feels like they're in your hand (which is should),
 * is clearly different from cards in hand (they're on the left) and are harder
 * to just forget about."* — and explicitly ADDITIVE: *"They should also be in
 * the cache area as they are now, this is just an easier way to see and play
 * them."* So `regionCacheHtml` is untouched and this is a second surface onto
 * the same entries; only the ones that are playable this instant, because
 * "harder to forget" is the whole point and a dead entry is not something to
 * remember.
 *
 * The forgetting is a REAL loss: a glimpse stamp carries `playableUntilTurn`
 * and expires silently at end of turn, so the one chip these wear is the
 * window, not the price.
 *
 * ⚠ NO `anim` key. The cache row already draws these entries under `c<uid>`,
 * and a second element wearing the same motion key would give ui/anim.ts two
 * landing spots for one flight. The click, on the other hand, is deliberately
 * the SAME `data-act="cache"` the cache row uses — one handler, so the two
 * surfaces can never come to play different cards.
 */
function handCachedHtml(p: Seat): string {
  const cache = cacheOf(p);
  if (!cache.length) return '';
  const idx = playableCachedIndexes(legalFor(p)).filter(i => cache[i]);
  if (!idx.length) return '';
  const e = q();
  const cards = idx.map(i => {
    const cc = cache[i]!;
    const via = e.cachePermission(p, i);
    // ONE chip, and it is the one you would otherwise lose money on. The full
    // set (the condition, the affinity note, the price) is a glance away in the
    // cache row, which this does not replace.
    const badge: Badge = via === 'prophecy'
      ? { t: '📜 free', cls: 'free' }
      : { t: '👁 this turn', cls: 'glimpse on' };
    return cardHtml(cc.card, {
      playable: true, cached: true, badges: [badge],
      candidate: cc.uid !== undefined && isCandidate({ cached: { seat: p, uid: cc.uid } }),
      data: `data-act="cache" data-p="${p}" data-i="${i}"`,
    });
  }).join('');
  return `<div class="handcached" title="R41: these are in your CACHE, not your hand — shown here so they are not forgotten. They are still in the cache row too.">
    <div class="handcachedlabel">cached · playable now</div>
    <div class="handcachedcards">${cards}</div>
  </div>`;
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
  // [67] R87: and the counterattack side, from the same mirror of the engine
  // the dialogue lists — a token standing somewhere other than the contested
  // region is one doDeclareBlocks refuses, so it must not be clickable into
  // the send list either.
  if (b.step === 'blocks' && b.round === 1 && t.controller === b.defender) {
    return sendableTokens(s, b.defender).includes(t.id) ? 'send' : null;
  }
  return null;
}

function tokenHtml(t: Entity): string {
  const riding = ui.spellTokens.includes(t.id);
  const castable = legalFor(t.controller).some(a => a.type === 'castSpellToken' && a.entityId === t.id);
  // R89: a spell token is the third kind of mod host (Caleb 2025-03-06 — "you
  // can augment spells during deployment but currently that would only be
  // possible with spell tokens"). It wears the same green pulse a unit host
  // does, because it is the same click.
  const modhost = modHostCache.tokens?.has(t.id) ?? false;
  const badges: Badge[] = [];
  if (riding) badges.push({ t: `${txtIcon('battle', '[battle]')} riding`, mod: true, html: true });
  for (const modId of t.mods) {
    const m = h.state.entities[modId];
    if (m) badges.push({
      t: `<span data-anim="e${m.id}">${txtIcon('augment', '+')}${esc(m.card.split(' ')[0])}</span>`,
      mod: true, html: true,
    });
  }
  if (t.absent) badges.push({ t: 'sent', mod: true });
  return cardHtml(t.card, {
    anim: `e${t.id}`,
    stats: 'X=' + t.x,
    playable: castable || tokenToggleMode(t) !== null,
    selected: riding || ui.send.includes(t.id),
    modhost,
    badges,
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
  // ⚠ `ui.columns` is SPARSE by construction: the drop handler writes
  // `ui.columns[ci] = dropIntoRow(ui.columns[ci] ?? [], …)` into a `[]`, so
  // blocking attacking column 2 first leaves holes at 0 and 1. `for…of` walks
  // holes and yields `undefined` (unlike .map/.filter/.forEach, which skip
  // them) — so this line threw a TypeError out of regionPanelHtml and the board
  // stopped repainting, for every player whose first blocker did not go on
  // column 0. Every other reader of ui.columns already skips holes; blockPlan()
  // guards with the same `col &&`. 2026-08-25.
  for (const col of ui.columns) if (col) col.forEach(id => inFormation.add(id));
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
      <span class="resrow" data-animzone="res:${p}">${resourceRow(e, p).resources.map(r => resHtml(r, p, r.index)).join('')}
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
    // R96/R123: a bin card that may be PLAYED right now — under Abyssal
    // Evocation's battle grant, or the card's own "played from your bin" line
    // (Trench Stalker). legalActions already knows which; this just renders it.
    const canPlay = legal.some(a => a.type === 'playFromBin' && a.binIndex === i);
    const usable = canAug || canGraft || canProph || canPlay;
    anyUsable ||= usable;
    const badges: Badge[] = [];
    if (canAug || canGraft) {
      badges.push({
        t: `${canAug ? txtIcon('augment', '+') : ''}${canGraft ? txtIcon('graft', '[Switch]') : ''} usable as mod`,
        mod: true, html: true,
      });
    }
    if (canProph) badges.push({ t: '📜 prophesy from bin', cls: 'proph on' });
    if (canPlay) badges.push({ t: '▶ playable from bin', cls: 'proph on' });
    return cardHtml(n, { playable: usable, badges, anim: binKeys[i], data: `data-act="bin" data-p="${p}" data-i="${i}"` });
  }).join('');
  return `<div class="overlay mainonly"><div class="overlaybox binbox">
    <h3>${esc(pl.name)}'s bin (${pl.bin.length})</h3>
    ${anyUsable ? `<div class="binmodbanner">${txtIcon('augment', '+')} Glowing cards can be applied to a ${
      // R79: not always a unit — a virus from the bin can go onto a spell on
      // the stack too, and this banner used to deny that in so many words.
      modHostPhrase(modHosts(legal, { from: 'bin', mode: 'augment' }, h.state))
    } as a mod right now — click one, then pick a host.</div>` : ''}
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
  //
  // Report #78: it must say WHICH gate, and only after asking. This used to
  // print "…but only during deployment" whenever a permitted entry was not in
  // the legal list — during deployment, at a card that was merely unaffordable.
  // cacheBlockReason (ui/inspect.ts) asks pushCachedPlays' questions in
  // pushCachedPlays' order and this prints the answer it gets.
  const TIMING_WORD: Record<string, string> = { deploy: 'deployment', battle: 'battle', haste: 'the haste step' };
  const e = q();
  const when = via ? TIMING_WORD[e.cachedTiming(p, i, via)] ?? '' : '';
  const why: CacheBlock = opts.clickable ? cacheBlockReason(e, p, i, legalFor(p)) : 'none';
  const stale =
    why === 'mana' ? `<div class="cachepay none">…but it needs ${e.manaToPlay(p, cc.card)} mana and you have ${e.openMana(p)}</div>`
      : why === 'no-target' ? '<div class="cachepay none">…but there is nothing legal to aim it at</div>'
        : why === 'timing' && when ? `<div class="cachepay none">…but only during ${when}</div>`
          : '';
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
  const e = q();
  const permittedIdx = cache.map((_, i) => i).filter(i => e.cachePermission(p, i) !== null);
  const permitted = permittedIdx.length;
  const now = new Set(legal.filter(a => a.type === 'playCached').map(a => (a as { index: number }).index)).size;
  const usable = legal.some(a => (a.type === 'augment' || a.type === 'graft') && a.from === 'cache');
  const hot = now > 0 || usable;
  const waiting = cache.filter((_, i) => !cacheSpent(p, i)).length;
  // Report #78: this line used to blame TIMING for every permitted-but-unoffered
  // entry, so a {Deployment} card during deployment that was two mana short read
  // "not this step". cacheBlockReason (ui/inspect.ts) asks the enumerator's own
  // questions in its own order; rank the answers so the summary names the entry
  // that is CLOSEST to playable rather than the first one in the zone.
  const RANK: Record<CacheBlock, number> = { none: 0, mana: 1, 'no-target': 2, timing: 3, 'no-permission': 4 };
  let best: { i: number; why: CacheBlock } | null = null;
  for (const i of permittedIdx) {
    const why = cacheBlockReason(e, p, i, legal);
    if (!best || RANK[why] < RANK[best.why]) best = { i, why };
  }
  const because = !best ? ''
    : best.why === 'mana' ? ` — needs ${e.manaToPlay(p, cache[best.i]!.card)} mana`
      : best.why === 'no-target' ? ' — no legal target'
        : ' — not this step';
  const note = mine && now ? `<div class="cachehint">${now} playable now</div>`
    : permitted ? `<div class="cachewait">${permitted} ready${mine ? because : ''}</div>`
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
  ['Haste', 'Only cards with haste may be played — printed {Haste}, or granted by something in play (R97, Dispatch Courier). They resolve immediately. Skipped when nobody can. A {Battle} card does NOT become playable here even when granted haste.'],
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
  // Ledger #24 (ZQPC): "Scholar of the Void doesn't say what the Beyond card it
  // can transform into does". The back face gets the SAME row builder the
  // tokens do — tokenRowHtml prints stats, type line and rules text off a bare
  // name, which is exactly what "say what it does" means — and it must be
  // readable while the card is still in hand, because the cost of finding out
  // the other way is discarding your entire hand.
  const transformRows = transformFaces(name, u ? { e: q(), unit: u } : undefined)
    .map(tokenRowHtml).join('');
  // #85: "Soul Siphon should have a way of showing, WHILE IN YOUR HAND, what
  // the X value is for each player." The hand chip is a few pixels of corner;
  // this panel is where a player actually reads a card, and it showed no X at
  // all. Whose "you" it is: the seat this client plays in, or — hotseat, where
  // there is no single viewer — the inspected unit's own controller.
  const xseat: Seat = NET ? NET.seat : (u?.controller ?? 0);
  const xRows = xPreviewFor(name, xseat);
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
      ${xRows ? `<h4>X right now</h4>${xRowsHtml(xRows)}` : ''}
      <h4>Attributes${u ? ' (current, shared/granted included)' : ' (printed)'}</h4>
      ${attrRows}
      ${tokenRows ? `<h4>Tokens it creates</h4>${tokenRows}` : ''}
      ${transformRows ? `<h4>Transforms into</h4>${transformRows}` : ''}
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
    <div class="judgea">${mdToHtml(e.a, { inline: iconizeText })}${e.cards.length
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

/**
 * [77] The notice a refused block declaration leaves behind: what the engine
 * said, which units were taken out of the plan, what the board is compelled
 * to include — and the "Reset blockers?" button the report asked for by name.
 *
 * The units are NAMED, not counted. "Trying to declare illegal blocks entirely
 * resets the board" is half the complaint; the other half is that the only
 * feedback was one line of engine prose with no way to tell which of a dozen
 * blockers it was about. Everything here comes off `ui.blockRefusal`, which is
 * the engine's own verdict as structure (ui/battle.ts).
 */
function blockRefusalHtml(): string {
  const r = ui.blockRefusal;
  if (!r) return '';
  const names = [...new Set(r.offenders.map(o => o.card))];
  const cleared = names.length
    ? `<b class="duty">${esc(names.join(', '))}</b> ${names.length === 1 ? 'was' : 'were'} taken back out — the rest of your plan is still on the board.`
    : 'the rest of your plan is still on the board.';
  const req = Object.values(r.required).flat()
    .map(id => h.state.entities[id]?.card).filter(Boolean) as string[];
  const must = req.length
    ? ` <span class="duty">${esc([...new Set(req)].join(', '))}</span> must block — that one is compulsory.`
    : '';
  return `<span class="blockrefusal">✗ ${esc(r.why)} — ${cleared}${must}
    <button data-btn="resetblocks" title="clear every blocker and counterattacker and start again">Reset blockers?</button>
    </span> `;
}

/** [77] `blockPlan`'s inverse: the board's `ui.columns` for a declaration the
 * engine has accepted. Keyed by ATTACK column index, so the array has to be
 * long enough to hold the highest key and holes are empty columns. */
function columnsFromPlan(blocks: Record<number, EntityId[]>): EntityId[][] {
  const keys = Object.keys(blocks).map(Number);
  const out: EntityId[][] = Array.from({ length: keys.length ? Math.max(...keys) + 1 : 0 }, () => []);
  for (const ci of keys) out[ci] = [...(blocks[ci] ?? [])];
  return out;
}

/** the block declaration the board is holding right now, in the shape the
 * action takes. ONE reader of `ui.columns`, so the bar's R84 duty check and
 * the button that sends the declaration can never be looking at two different
 * plans (the whole point of gating Confirm). */
function blockPlan(): Record<number, EntityId[]> {
  const blocks: Record<number, EntityId[]> = {};
  ui.columns.forEach((col, ci) => { if (col && col.length) blocks[ci] = col; });
  return blocks;
}

/** #4: the mod-in-progress banner — spells out card, source zone and mode,
 * and points at the highlighted legal hosts (modHostCache glows them) */
function moddingBarHtml(err: string): string {
  const m = ui.modding!;
  const card = zoneCardName(m.seat, m.from, m.index) ?? '?';
  const icon = txtIcon(m.mode === 'graft' ? 'graft' : 'augment', m.mode === 'graft' ? '[Switch]' : '[Augment]');
  const nHosts = modHostCount(modHostCache);
  // R79: the hosts are not always units — a virus may go onto a SPELL on the
  // stack, and the bar has to name what is actually glowing. modHostPhrase
  // reads the offer, so it can never promise a host the engine will refuse.
  const what = modHostPhrase(modHostCache);
  // R42: a fulfilled prophecy makes the graft/augment free too, not only the play
  const free = m.from === 'cache' && q().cachePermission(m.seat, m.index) === 'prophecy'
    ? ' <span class="freetag">FREE — fulfilled prophecy</span>' : '';
  // R89: "you can only do this with attributes" (Caleb 2025-03-06). A mod
  // whose whole payload is rules text is a legal thing to put on a spell token
  // and donates nothing at all — said HERE, while the card can still be taken
  // back, not in the log after it is spent.
  const gift = modHostCache.tokens?.size
    ? `<div class="modgift">${txtIcon('augment', '+')} ${esc(spellAugmentNote(card))}</div>` : '';
  return `<div class="promptbar pending"><span class="who">${esc(h.state.players[m.seat]!.name)}:</span>
    applying <b>${esc(card)}</b> from ${zoneLabel(m.from)}${free} as ${icon} <b>${m.mode}</b>
    — pick a glowing host: a ${what}${nHosts ? ` (${nHosts} legal)` : ''}
    <button data-btn="modcancel">✕ cancel (esc)</button>${gift}${err}</div>`;
}

/**
 * [59] What renderNow decided about passing this window, computed before the
 * markup so promptHtml can tell the truth about it. Recomputed every paint;
 * `pass: null` is the ordinary case where the window really is mine.
 */
let autoPassing: AutoPassPlan = { disarm: false, pass: null };
/** the reason, in the words the player set up */
const AUTO_PASS_WHY: Record<'passall' | 'pref' | 'yield', string> = {
  passall: 'Pass all is on — stop it in the bar above to take this window back.',
  pref: 'auto-pass is on and passing is your only legal action here.',
  yield: 'you chose to auto-yield to this unit’s triggers.',
};

/** The four "armed" confirm bars — activate, done planning, pass, end
 * deployment — are one pattern: the player clicked something irreversible,
 * the bar names what it would cost and offers Go back or a primary button
 * that does it anyway. Only the words and the data-btn names differ, so each
 * bar is a row here and promptHtml supplies the question. (The ride-along
 * question is deliberately NOT one of these — its token chips make it a
 * picker, not a yes/no.) The labels carry the hotkey hints: Esc is Go back on
 * every one of them (the keydown handler), only doneplan advertises it; the
 * confirm key is named where Enter/Space is wired to the primary button. */
const CONFIRM_BARS = {
  act:    { cancel: 'actcancel',      back: 'Cancel',        confirm: 'actconfirm',      go: 'Yes, activate' },
  done:   { cancel: 'doneplancancel', back: 'Go back (esc)', confirm: 'doneplanconfirm', go: 'Really done (enter)' },
  pass:   { cancel: 'passcancel',     back: 'Go back',       confirm: 'passconfirm',     go: 'Pass anyway (space)' },
  deploy: { cancel: 'deploycancel',   back: 'Go back',       confirm: 'deployconfirm',   go: 'End deployment anyway' },
} as const;
/** one armed-confirm bar; `attrs` rides on the confirm button (doneplanconfirm
 * carries the seat it is answering for) */
function confirmBarHtml(kind: keyof typeof CONFIRM_BARS, seat: Seat, question: string, err: string, attrs = ''): string {
  const c = CONFIRM_BARS[kind];
  return `<div class="promptbar pending"><span class="who">${esc(h.state.players[seat]!.name)}:</span>
        ${question}
        <button data-btn="${c.cancel}">${c.back}</button>
        <button class="primary" data-btn="${c.confirm}"${attrs}>${c.go}</button>${err}</div>`;
}

/** The pending decision's bar: the prompt, every option as something
 * clickable, and the cast-cancel escape hatch. Options that ARE cards render
 * as scans; the rest are buttons, ordered so the decline is never where the
 * affirmative was a click ago. */
function decisionBarHtml(dec: Decision, err: string): string {
  const s = h.state;
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
  // BL-25/R139: a counter-removal menu carries one option per (unit, amount)
  // pair. The bar draws ONE scan per unit and lets the stepper carry the
  // amount — the alternative, a wall of "Take 2 / Take 3 / Take 4 …" buttons
  // per ally, is the tedium the stepper exists to end.
  // counterCount() FIRST: it is what resets the dial on a new decision id, and
  // the scans below read the reset value. Reading `ui.counterCount` raw here
  // drew a bar whose number and whose clickable scans disagreed for exactly
  // one frame — the frame the new menu appeared on.
  const step = counterStepper(dec, counterCount());
  const stepperHtml = counterStepperHtml(dec);
  const isCtrOpt = (i: number): boolean => counterPickValue(dec.options[i]!.value) !== null;
  const ctrCards = (): string => {
    const cards = counterPickUnits(dec).map(u => {
      const i = counterClickIndex(u), name = h.state.entities[u]?.card;
      return i >= 0 && name
        ? cardHtml(name, { playable: true, data: `data-btn="decide" data-i="${i}" data-ping="${u}" data-previd="${u}"` })
        : '';
    }).join('');
    return cards ? `<div class="deccards">${cards}</div>` : '';
  };
  if (dec.kind === 'targets') {
    // UZRG, and the expensive one: a ref-valued option ({stack:96}) used to
    // render NO button at all — you had to find and click the highlighted
    // card in the floating stack window. With min:0 the engine adds "No more
    // targets" from the very first slot, so the ONLY button in the bar was
    // the decline, in the same screen position the player had just clicked
    // ten times to pay a 10-card cost. Every option gets a real button now,
    // and the decline is last and secondary.
    const picks = [...split.refs, ...split.plain]
      .filter(i => step.mode !== 'pick' || !isCtrOpt(i))
      .map(i => optBtn(i)).join(' ');
    const declines = split.decline.map(i => optBtn(i, 'declinebtn')).join(' ');
    return `<div class="promptbar pending"><span class="who">${who}:</span>
        ${iconizeText(dec.prompt)}${split.refs.length ? ' — click a highlighted target, or pick one here' : ''}
        ${stepperHtml}
        ${step.mode === 'pick' ? ctrCards() : cardRow('decide')} <span class="decpicks">${picks}</span>
        ${declines ? `<span class="decdecline">${declines}</span>` : ''} ${castCancelBtnHtml()}${err}</div>`;
  }
  // CT-34/R149: the elective split gets the ticker instead of the wall of
  // "1 to X / 2 to X / 3 to X …" buttons the owner called terrible. The raw
  // options stay reachable behind the expander below, because the ticker is an
  // affordance over the menu, never a narrowing of it — every legal split the
  // engine offered is still takeable.
  const asg = assignSplitStepper(dec, h.state, assignCount());
  if (asg.mode === 'assign') {
    return `<div class="promptbar pending"><span class="who">${who}:</span>
        ${iconizeText(dec.prompt)}
        ${assignSplitHtml(dec)}
        <details><summary style="color:var(--dim);cursor:pointer">every split</summary>
          <span class="decpicks">${dec.options.map((_o, i) => optBtn(i)).join(' ')}</span></details>
        ${castCancelBtnHtml()}${err}</div>`;
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
  const btns = [...split.refs, ...split.plain]
    .filter(i => step.mode !== 'pick' || !isCtrOpt(i))
    .map(i => optBtn(i)).join(' ');
  const declines = split.decline.map(i => optBtn(i, 'declinebtn')).join(' ');
  return `<div class="promptbar pending"><span class="who">${who}:</span> ${iconizeText(dec.prompt)}
      ${stepperHtml}
      ${step.mode === 'pick' ? ctrCards() : cardRow('decide')} <span class="decpicks">${btns}</span>
      ${declines ? `<span class="decdecline">${declines}</span>` : ''} ${castCancelBtnHtml()}${err}</div>`;
}

function promptHtml(): string {
  const s = h.state;
  const err = uiError ? `<span style="color:var(--danger)"> ✗ ${esc(uiError)}</span>` : '';
  // playtest: an irreversible activation that will not stop to ask for a
  // target asks here instead. Takes precedence over every other prompt — it is
  // a modal question about something you already clicked.
  if (ui.confirmAct) {
    const a = ui.confirmAct;
    return confirmBarHtml('act', a.seat, `activate <b>${esc(a.unit)}</b> — ${iconizeText(a.label)}?
        <span style="color:var(--dim)">this cost cannot be taken back</span>`, err);
  }
  // [59] this window is already being given away — a pass is scheduled for
  // this exact state. Painting "you have priority — Pass" over it was a lie
  // that lasted a whole server round trip, and clicking the button it drew
  // sent the second pass that came back "you do not have priority".
  if (NET && autoPassing.pass) {
    return `<div class="promptbar waiting"><span class="who">Auto-passing…</span>
      <span style="color:var(--dim)">${esc(AUTO_PASS_WHY[autoPassing.pass])}</span>${err}</div>`;
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
  if (s.decision) {
    const bar = decisionBarHtml(s.decision, err);
    // R170/CT-46: ONLINE this is the whole truth and always was — view.ts
    // nulls a decision that is not yours, so the only question a net client
    // ever holds is its own, and `decisionFreezes` says so for both seats.
    //
    // HOTSEAT is different in kind: one screen, both seats, no redaction. R154
    // taught the engine that the seat which is NOT being asked may carry on
    // deploying, and returning only the asker's bar is what still froze them —
    // it is the bar that carries "done deploying". So the free seat's own bar
    // goes UNDER the question instead of being replaced by it. Nothing is
    // hidden and nothing is reordered: the question is still on top, still the
    // thing that has to be answered before the step can end.
    return decisionFreezes(other(s.decision.seat)) ? bar : bar + phaseBarHtml('');
  }
  return phaseBarHtml(err);
}

/** The ordinary phase bar: whose turn it is to do what, and the buttons for
 * doing it. Split out of `promptHtml` by R170 for one reason — with a decision
 * open for ONE seat in hotseat, the other seat still needs this. */
function phaseBarHtml(err: string): string {
  const s = h.state;
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
  // R170: …and never to a seat the engine would refuse. In hotseat this bar is
  // now drawn UNDER an open question (promptHtml), and the seat being asked
  // must not be handed a "done deploying" button that `apply()` throws on —
  // that is the "screen full of refusals" R150's own notes warn about. A no-op
  // online, where this bar is only ever reached with no decision at all.
  const doneRow = (done: boolean[], btn: string, label: string): string =>
    ([0, 1] as Seat[]).map(p => (done[p] || (NET && p !== NET.seat) || decisionFreezes(p))
      ? `<span style="color:var(--dim)">${esc(s.players[p]!.name)} ${done[p] ? 'ready ✓' : '…'}</span>`
      : `<button data-btn="${btn}" data-p="${p}" title="hotkey: enter">${esc(s.players[p]!.name)}: ${label} (enter)</button>`).join(' ');
  if (s.phase === 'planning' && s.hasteDone) {
    return `<div class="promptbar"><span class="who">Haste step</span>
      Play cards with haste, printed or granted (they resolve immediately). ${doneRow(s.hasteDone, 'donehaste', 'done')}${err}</div>`;
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
      return confirmBarHtml('done', p, `you still have <b>${pl.activationsLeft} activation${pl.activationsLeft === 1 ? '' : 's'}</b> and
        <b>${dormant} dormant resource${dormant === 1 ? '' : 's'}</b> — activate them this turn?`, err, ` data-p="${p}"`);
    }
    return `<div class="promptbar"><span class="who">Planning</span>
      Click a hand card to recycle it into a resource; click dormant resources to activate (max 2). ${doneRow(s.planningDone, 'doneplan', 'done planning')}${err}</div>`;
  }
  if (s.phase === 'battle') {
    const b = s.battle!;
    if (b.step === 'declare') {
      // [69] "It's very easy to attack without bringing along any spell tokens
      // into the new region… make it a choice AFTER declaring attackers." The
      // attack is built and Attack! has been pressed; the declaration is held
      // here until the ride-along question is answered once. The tokens listed
      // are the ones the ENGINE would accept (ui/battle.ts ridableTokens
      // mirrors doDeclareAttack), and each chip is the same clickable token as
      // the one in the strip, so the answer and the affordance are one thing.
      if (ui.confirmRide !== null) {
        const chips = ridableTokens(s, ui.confirmRide)
          .map(id => s.entities[id]).filter((t): t is Entity => !!t)
          .map(t => `<span class="ridechip${ui.spellTokens.includes(t.id) ? ' on' : ''}"
              data-act="token" data-id="${t.id}">${ui.spellTokens.includes(t.id) ? '✓ ' : ''}${esc(t.card)} <b>X=${t.x}</b></span>`)
          .join('');
        const n = ui.spellTokens.length;
        return `<div class="promptbar pending"><span class="who">${esc(s.players[ui.confirmRide]!.name)}:</span>
          Select the spell tokens you wish to bring into the attacked region, or select Bring none.
          <span class="ridepick">${chips}</span>
          <button data-btn="ridecancel">Go back (esc)</button>
          <button ${n ? '' : 'class="primary" '}data-btn="ridenone">Bring none</button>
          ${n ? `<button class="primary" data-btn="rideconfirm">Attack — ${n} token${n === 1 ? '' : 's'} riding (enter)</button>` : ''}${err}</div>`;
      }
      // BL-19: one reading of "is anything built" for both bars and for Esc —
      // ui/formation.ts hasBuild. This bar used to ask about spellTokens and
      // forget `send`, the block bar the exact other way round.
      const built = hasBuild(ui);
      return `<div class="promptbar"><span class="who">${esc(s.players[b.attacker]!.name)}:</span> build your attack
        <button data-btn="attackall" title="every eligible unit joins, one per column — adjust before confirming">${txtIcon('battle', '[battle]')} Attack with everything</button>
        <button class="primary" data-btn="confirmattack" ${ui.columns.some(c => c.length) ? '' : 'disabled'}>Attack! (enter)</button>
        <button data-btn="skipattack">Don't attack</button>
        ${built ? '<button data-btn="clearform" title="empty the formation being built">✕ Clear (esc)</button>' : ''}${err}</div>`;
    }
    if (b.step === 'blocks') {
      // [67] R87: the same dialogue as the attack side, on the counterattack.
      // "What happened to Rashi's Poison tokens here? She just wanted to bring
      // them with her attackers but they somehow went onto the stack" — the
      // Confirm is held here until the question is answered once. The chips
      // are `data-act="token"`, literally the same clickable token as the one
      // in the strip, and sendableTokens (ui/battle.ts) mirrors
      // doDeclareBlocks, so the list can never offer what the engine refuses.
      if (ui.confirmRide !== null) {
        const chips = sendableTokens(s, ui.confirmRide)
          .map(id => s.entities[id]).filter((t): t is Entity => !!t)
          .map(t => `<span class="ridechip${ui.send.includes(t.id) ? ' on' : ''}"
              data-act="token" data-id="${t.id}">${ui.send.includes(t.id) ? '✓ ' : ''}${esc(t.card)} <b>X=${t.x}</b></span>`)
          .join('');
        const n = splitCounterattack(s, ui.send).spellTokens.length;
        return `<div class="promptbar pending"><span class="who">${esc(s.players[ui.confirmRide]!.name)}:</span>
          Select the spell tokens you wish to bring into the attacked region, or select Bring none.
          <span class="ridepick">${chips}</span>
          <button data-btn="ridecancel">Go back (esc)</button>
          <button ${n ? '' : 'class="primary" '}data-btn="ridenone">Bring none</button>
          ${n ? `<button class="primary" data-btn="rideconfirm">Counterattack — ${n} token${n === 1 ? '' : 's'} riding (enter)</button>` : ''}${err}</div>`;
      }
      const built = hasBuild(ui);   // BL-19 — same question, same answer, both bars
      // R84: a lured unit's block is COMPULSORY, and the client used to know
      // nothing about it — Confirm was always live and the duty only ever
      // surfaced as a red error after the fact. blockPlanIssue (ui/inspect.ts)
      // asks the engine's own validator what it would say to this declaration.
      const duty = blockPlanIssue(s, b.defender, blockPlan());
      return `<div class="promptbar ${duty || ui.blockRefusal ? 'pending' : ''}"><span class="who">${esc(s.players[b.defender]!.name)}:</span>
        ${blockRefusalHtml()}${duty
          ? `<b class="duty">${esc(duty)}</b> — that block is compulsory, so nothing can be confirmed until it is assigned.`
          : `assign blockers (click unit, then slot)${b.round === 1 ? ' and optionally send counterattackers' : ''}`}
        <button class="primary" data-btn="confirmblocks" ${duty ? 'disabled' : ''}>Confirm (enter)</button>
        ${built ? '<button data-btn="clearform" title="empty the blocks/send being built">✕ Clear (esc)</button>' : ''}${err}</div>`;
    }
    if (ui.modding) return moddingBarHtml(err);
    if (ui.confirmPass !== null) {
      // C5/[66]: the owner wrote the copy for this one — "You're about to move
      // to Regroup which will remove your Spell Tokens. Are you sure?" — and it
      // is now shown only on the pass that would actually get there.
      const n = castableTokenCount(s.priority!);
      return confirmBarHtml('pass', s.priority!, `You're about to move to Regroup, which will remove your spell tokens.
        Are you sure? <span style="color:var(--dim)">(${n} still castable)</span>`, err);
    }
    // [59] …and the same lie told by hand: the manual Pass handler's trailing
    // render() repaints this bar, live button and all, over a state whose
    // priority has already gone to the socket. The latch says so — wait.
    if (NET && ui.sentFor === s.actionCount) {
      return `<div class="promptbar waiting"><span class="who">Sent — waiting for the server…</span>
        <span style="color:var(--dim)">this priority window has already been spent</span>${err}</div>`;
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
      return confirmBarHtml('deploy', ui.confirmDeploy, `you can still play <b>${names.length}</b> card${names.length === 1 ? '' : 's'} from your cache —
        <span class="cachenames">${names.map(n => `<span data-prev="${esc(n)}">${esc(n)}</span>`).join(', ')}</span>`, err);
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
 *
 * UFAB: and it links only the cards THIS GAME has shown. `linkCardNames` is a
 * question about a sentence and stays general (the deployment reveal asks it
 * the same way); `cardsSeen` is the answer to "is the log talking about a card
 * at all?", which is a question about the game. Without it the phase line
 * `Battle: Ben may attack.` linked the card Battle every single turn.
 */
function logLineHtml(msg: string): string {
  return onlyKnownNames(linkCardNames(msg), cardsSeen).map(sp => sp.name
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
      r.kind === 'cast' ? 'cast for X'
        : r.kind === 'event' ? esc(r.from ?? 'from the event that fired this')
          : `${esc(r.source ?? 'additional cost')}${r.receipt ? `, ${esc(r.receipt)}` : ''}`
    }</span></div>`).join('');
  // R57 (report #81, EGCW): the declared MODE rides on the stack so the
  // opponent can price their response. Choosing it at cast time is only half
  // the fix — an unreadable declaration leaves them responding blind, which is
  // the harm the report described. Same badge as X: one presentation, one idea.
  const modeRows = stackItemModes(it, q())
    .map(r => `<div class="xnow">${esc(r.key === 'stat' ? 'Doubling' : 'Mode')}: ${
      esc(r.label)}${r.source ? ` <span class="hint">— ${esc(r.source)}</span>` : ''}</div>`).join('');
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
      ${xRows}${modeRows}
      ${rows || `<div class="hint">${iconizeText(it.label)}</div>`}
      ${modChips}
      ${targets ? `<div class="abtargets">→ ${targets}</div>` : ''}
      ${it.negated ? '<div class="abneg">answered — it left the stack and will do nothing</div>' : ''}
      ${modHostCache.stack.has(it.id)
        // R79: the other place the player looks at a stack item. The glow is
        // on the strip; the viewer says what it means in words.
        ? `<div class="abmodhost">${txtIcon('augment', '+')} a legal host for the mod you are
            placing — click this card on the stack to apply it</div>`
        : ''}
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
    // R79: this spell is a legal host for the mod the player is holding
    const modhost = modHostCache.stack.has(it.id);
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
      // R79: a mod is in flight and THIS spell is one of its legal hosts —
      // the same green pulse a unit host wears (style.css .card.modhost /
      // .stackcard.modhost), because it is the same click.
      modhost ? 'modhost' : '',
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
      title="${esc(modhost ? `${it.label} — click to apply the mod to this spell` : it.label)}">
      ${face}<div class="stackface">${esc(it.card ?? it.label)}</div>
      ${modhost ? `<div class="stackmodhost">${txtIcon('augment', '+')} host</div>` : ''}
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
  // [77] the declaration LANDED (the step moved on, or the battle did): only
  // now is it safe to drop the plan that produced it. Sending is not landing —
  // over a socket the refusal arrives after the send, and dropping the plan
  // there is the whole of the report.
  if (ui.blockSent && !mine) {
    ui.blockSent = false;
    ui.columns = []; ui.send = []; ui.spellTokens = []; ui.rideAnswered = false;
  }
  if (!mine) { ui.blockRefusal = null; ui.blockLine = null; return; }
  if (!b) { ui.blockLine = null; return; }
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
  noteCardsSeen();                 // UFAB: the log links only cards in the game
  // R80: the tail of the log a narrative beat has not told yet. `h.log` itself
  // is untouched — this is a curtain, not an edit, and it lifts on a timer
  // bounded by MAX_LEAD_MS whatever else happens.
  const untold = heldLines(beatQueue, Date.now());
  const logEnd = Math.max(0, h.log.length - untold);
  const logFrom = Math.max(0, logEnd - 80);
  const logItems = h.log.slice(logFrom, logEnd).map((l, i) => {
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
  gcStaleUi();
  const autoPref = localStorage.getItem('algoAutopass') === '1';
  // [59] BEFORE the markup: whether this client is about to pass this window
  // by itself decides what the prompt bar may claim. The send happens after
  // the paint (runAutoPass, at the bottom) — this only decides and disarms.
  autoPassing = planAutoPass();
  // R150/CT-28: how many authoritative updates the throttle is still holding.
  // Read once, before the markup, so the chip and its count agree.
  const paceHeldNow = NET ? NET.heldUpdates() : 0;
  const snap = snapshotViewport();
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
          ${paceHeldNow ? `<button class="passallchip" data-btn="paceskip"
            title="the table is being shown to you one step per second — click (or press S) to jump straight to the live state">catching up (${paceHeldNow}) — ⏭ skip</button>` : ''}
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
  restoreViewport(snap);
  runAutoPass(autoPassing);   // [59] the send, now that the truth is on screen
  maybeCancelChain();
  publishBuilding();
  rewireInputs(snap);
  return true;
}

/** Game-state policy that renderNow applies before it paints: every confirm
 * bar asks a question about the state it was raised on, and the answer stops
 * meaning anything the moment that state moves on underneath it (an undo, a
 * resync, the opponent acting, the thing asked about becoming illegal). So
 * the arm is dropped here, on the way into the paint, rather than painted
 * over a question that is no longer being asked. */
function gcStaleUi(): void {
  // stale confirm — the bar asks about a pass that would end the battle with
  // tokens still castable, so it goes the moment either half stops being true
  // ([66]: the window moved on, or the tokens did)
  if (ui.confirmPass !== null && (h.state.priority === null
    || !passEndsBattlePhase(h.state, h.state.priority)
    || castableTokenCount(h.state.priority) === 0)) ui.confirmPass = null;
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
  // [69] and the ride-along question: it belongs to ONE attack declaration, so
  // it goes the moment that declare step does (an undo, a resync, the attack
  // landing) — and `rideAnswered` goes with it, or the next attack would
  // inherit an answer given about a formation that no longer exists.
  // …and R87 gives the block step the same dialogue, so both steps keep it.
  if (h.state.battle?.step !== 'declare' && h.state.battle?.step !== 'blocks') {
    ui.confirmRide = null; ui.rideAnswered = false;
  }
}

/** What a repaint would otherwise destroy: the scroll position of each
 * SCROLLERS panel, and which of the two typing boxes (if either) owned focus
 * and where its caret sat. Read before `$app.innerHTML` is replaced, put back
 * by restoreViewport / rewireInputs after. */
type ViewportSnap = {
  scroll: (readonly [string, number])[];
  keepFocus: { id: string; start: number; end: number } | null;
  hadJudge: boolean;
  hadReport: boolean;
};
function snapshotViewport(): ViewportSnap {
  // playtest DEYK: "it constantly resets the scroll height, which means you
  // have to scroll down to see your units every time you click something".
  // The client repaints by replacing $app.innerHTML, which throws away the
  // scroll position of every scroller in it — and mid-battle the board is
  // taller than the window, so every click threw you back to the top. The
  // positions are read BEFORE the swap and put back after; the game log is
  // deliberately not in the list, because it always wants to be at the bottom.
  const scroll = SCROLLERS.map(sel =>
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
  return { scroll, keepFocus, hadJudge, hadReport };
}

/** After the paint: the focus viewer, the scroll positions, the log tail and
 * the two floating panels (stack window, context menu) — everything that has
 * to be right before the player can look at the new board. */
function restoreViewport(snap: ViewportSnap): void {
  // the rail was rebuilt with it: put the focused card back, re-derived from
  // the state that just landed, BEFORE the scroll positions go back on — the
  // panel has to have its content again for its scrollTop to mean anything
  repaintFocus();
  for (const [sel, top] of snap.scroll) {
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
}

/** After the paint and the auto-actions: the two typing boxes are fresh DOM
 * nodes again, so their drafts, their listeners and (for the one that had it)
 * their focus and caret all have to be put back by hand. */
function rewireInputs(snap: ViewportSnap): void {
  const { keepFocus, hadJudge, hadReport } = snap;
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
    // R80: the narrative beats this paint just let out point at what they are
    // about — after playMotion, so the pulse lands on the settled board
    fireBeats();
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

/**
 * BL-19: throw the whole declaration away and start again.
 *
 * The owner asked for it as *"reset blocks"*, but it is the same click and the
 * same frustration on all three declarations — an attack formation, a block
 * assignment, a counterattack send — so there is one of these and all three
 * entry points (the Clear button on either bar, and Esc) come through it. They
 * used to be three hand-written copies of the same five assignments, and they
 * had already drifted apart: Esc left a block refusal notice standing over the
 * plan it was complaining about, and the Clear button left `uiError` up.
 *
 * ui/formation.ts owns what an empty build IS, so the emptying is testable and
 * so the sparse block keys cannot be "tidied" on the way through — a cleared
 * `columns` is `[]`, never a compacted or re-indexed version of what was
 * there. Local only: nothing is declared, sent or committed here.
 *
 * The republish is the caller's `render()`, which runs publishBuilding above —
 * `publishCols([])` is `[]`, and that empty payload is the only thing that
 * takes the formation off the OPPONENT's screen. Clearing without repainting
 * would leave them staring at a line I have already thrown away.
 */
function resetFormation(): void {
  const fresh = clearBuild();
  ui.columns = fresh.columns;
  ui.send = fresh.send;
  ui.spellTokens = fresh.spellTokens;
  ui.carrying = fresh.carrying;
  ui.rideAnswered = fresh.rideAnswered;   // [69] a cleared formation is a new attack
  // the complaints were about the plan that no longer exists
  ui.blockRefusal = null;
  uiError = '';
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

/**
 * [59] The whole automatic-pass decision, made BEFORE the board is painted.
 *
 * Report: "I turned on auto yield to a bunch of triggers and it's working, but
 * visually I see a flash of the top of the screen that looks like it's giving
 * me prio for like 1 frame AND I see a 'You do not have priority' note."
 *
 * The frame was not a frame. The pass used to be sent from the BOTTOM of
 * renderNow, after $app.innerHTML had already been written with a "you have
 * priority — Pass" bar; the send is a ws.send, so the corrective view only
 * arrives a whole round trip later. On a real network it gets worse, not
 * better. So the answer is computed here, up front, and promptHtml is told —
 * it paints the waiting bar instead of offering a window that is already gone.
 *
 * The judgement itself lives in ui/battle.ts (autoPassDecision) and ui/inspect.ts
 * (the toggle and the yield), where it is tested. This function is only the
 * bookkeeping around it: the Pass-all chip's arm, and its repaint when the arm
 * drops.
 *
 * [68] "I hit pass all, but then it stopped passing all. Why?" — because the
 * release list used to contain "you hold a castable spell token", which is true
 * of most windows of most battles, so the chip passed once and switched itself
 * off. ui/battle.ts passAllRelease is now the single named list of every
 * condition that takes the chip off, and the token clause in it asks the
 * sharper question (would this pass actually REACH Regroup and erase them).
 */
function planAutoPass(): AutoPassPlan {
  if (!NET) return { disarm: false, pass: null };
  const s = h.state;
  const plan = autoPassDecision(s, NET.seat, NET.legal, {
    armed: ui.autopass, armedStack: ui.autopassStack, armedSig: ui.autopassSig,
    prefOn: localStorage.getItem('algoAutopass') === '1',
    yieldIds: new Set(yieldMap.keys()),
  });
  if (ui.autopass) {
    if (plan.disarm) ui.autopass = false;
    else ui.autopassStack = s.stack.length;
  }
  return plan;
}

/** [59] and the send, after the paint — one per authoritative state, whichever
 * of the three reasons won. */
function runAutoPass(plan: AutoPassPlan): void {
  if (!NET) return;
  // the chip was drawn this render but the arm just dropped: repaint it away
  if (plan.disarm) renderChipOff();
  const at = h.state.actionCount;
  // one send per authoritative state, whichever reason won and however many
  // times this state gets painted (ui/inspect.ts owns the latch, and tests it)
  if (!takeAutoPass(plan, at, ui)) return;
  sendAutoPass(at);
}

/** the "auto-passing…" chip was drawn this render but the arm just dropped —
 * repaint it away without re-entering the full pipeline recursively */
let chipRepainting = false;
function renderChipOff(): void {
  if (chipRepainting) return;
  chipRepainting = true;
  try { render(); } finally { chipRepainting = false; }
}

/**
 * R80: an automatic pass, a beat late.
 *
 * UFAB: "damage and all effects happened instantly." Half of that is the
 * engine's one-pump damage step (the beats above); the other half is this.
 * Both auto-passes fired their `passPriority` SYNCHRONOUSLY from inside
 * render(), so an unopposed end of combat was: paint, pass, server round-trip,
 * paint, pass, … — several server states collapsing into one apparent instant
 * with nothing on screen long enough to read.
 *
 * A short wait puts each of those states on screen for its own moment. It is
 * shorter than one beat (STAGGER_MS) because it is not telling a story, only
 * refusing to sprint, and the player is not waiting on it for anything: the
 * board is already final and any real click cancels the pass by moving the
 * game on underneath it.
 *
 * One send per server state, still. The callers stamp `actionCount` BEFORE
 * scheduling (so a re-entrant render cannot queue a second one), the timer is
 * single and self-replacing, and the send re-checks at fire time that the
 * world has not moved — a stale pass would be either illegal or, worse, legal
 * for a window that is now genuinely mine to use.
 */
let autoPassTimer: ReturnType<typeof setTimeout> | null = null;
function cancelAutoPass(): void {
  if (autoPassTimer !== null) { clearTimeout(autoPassTimer); autoPassTimer = null; }
}
function sendAutoPass(at: number): void {
  cancelAutoPass();
  // …and it waits for the story to finish first. Without this the pass lands
  // mid-combat, the server's answer arrives, and the new batch supersedes the
  // beat queue — the client would be racing itself to cut off its own
  // explanation. Self-limiting: the queue is capped at MAX_LEAD_MS.
  const last = beatQueue[beatQueue.length - 1];
  const rest = last ? Math.max(0, last.at - Date.now()) : 0;
  autoPassTimer = setTimeout(() => {
    autoPassTimer = null;
    const s = h.state;
    // the world moved on while we waited: whoever moved it owns this window
    if (!NET || s.actionCount !== at || s.decision || s.priority !== NET.seat) return;
    // [59] …and "moved on" includes an intent that is still in flight. A click
    // during the wait spends this state without changing actionCount yet, so
    // the timer would otherwise land the second pass the report complained
    // about — one round trip later, and this time from a real decision.
    if (ui.sentFor === at) return;
    NET.do({ type: 'passPriority', seat: NET.seat });
  }, rest + STAGGER_MS);
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
  copy: from => `⧉ ${esc(from)}`,          // R118: a copied / projected face
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

/* ── the focus viewer: what it shows, and when hover may change it ──────
 *
 * Two playtest asks (2026-08-22), one mechanism.
 *
 * 1. It OPENS AT THE BOTTOM. A modded unit is taller than the rail, and the
 *    half you want is the bottom half — the current text and the mods, not
 *    the name and the cost you already read off the board. Opening at the top
 *    meant a scroll for every modded unit, and the scroll is the expensive
 *    part, because:
 * 2. A CLICK THAT DID NOTHING ELSE PINS IT for PIN_MS. Reaching the panel to scroll it means
 *    dragging the cursor across the board, and every card on the way steals
 *    the viewer — so you arrive at the scrollbar reading the wrong card and
 *    have to thread the path again. A click says "this one", and for five
 *    seconds hover cannot take it away. The pin only suspends hover; it never
 *    clears the panel, so when it lapses the card is still sitting there.
 *
 * Both need the viewer to know what it is SHOWING rather than just holding
 * markup: a repaint (every action repaints the board, and the click that pins
 * is usually also an action) has to re-derive the card from the state that
 * just landed, not re-show a snapshot taken before it.
 */
const PIN_MS = 5000;

/** the three hooks hover reads, as data. A card can carry more than one —
 * a stack card has both `prevstack` and `prev` — so this is a record, not a
 * union, and `focusHtmlFor` tries them in the order hover always tried them. */
type FocusSubject = { eid?: number; sid?: number; name?: string; xnow?: string };

/** what the viewer is pointed at (null = the hint), and its identity, so a
 * mouseover that merely crosses a child element of the same card is a no-op
 * instead of a repaint that would fight the player's own scrolling */
let focusSub: FocusSubject | null = null;
let focusKey = '';
/** bumped on every paint, so a slow image cannot scroll a card that has since
 * been replaced */
let focusGen = 0;
/** set while a click holds the viewer; hover is inert until it fires */
let pinTimer: number | null = null;

function focusKeyOf(t: HTMLElement): string {
  return `${t.dataset['previd'] ?? ''}|${t.dataset['prevstack'] ?? ''}|${
    t.dataset['prev'] ?? ''}|${t.dataset['xnow'] ?? ''}`;
}

function focusSubjectFor(t: HTMLElement): FocusSubject | null {
  const eid = t.dataset['previd'];
  const sid = t.dataset['prevstack'];
  const name = t.dataset['prev'];
  const xnow = t.dataset['xnow'];
  if (eid === undefined && sid === undefined && !name) return null;
  const sub: FocusSubject = {};
  if (eid !== undefined) sub.eid = Number(eid);
  if (sid !== undefined) sub.sid = Number(sid);
  if (name) sub.name = name;
  if (xnow !== undefined) sub.xnow = xnow;
  return sub;
}

/** a live entity first, then the stack item, then the printed card — each
 * falling through to the next when it has nothing to say (the unit died, the
 * item resolved), which is what a stack card's two hooks are for */
function focusHtmlFor(sub: FocusSubject): string {
  if (sub.eid !== undefined) {
    const html = previewEntityHtml(sub.eid);
    if (html) return html;
  }
  // a stack item shows the ABILITY that is on the stack, not the whole card
  if (sub.sid !== undefined) {
    const html = previewStackHtml(sub.sid);
    if (html) return html;
  }
  if (!sub.name) return '';
  // #5 / #85: hand cards carry their live X preview into the focus viewer,
  // where there is room to print what each row is counting
  const xnow = sub.xnow !== undefined ? xRowsHtml(unpackXRows(sub.xnow)) : '';
  return `<img src="${art(sub.name)}" alt="" onerror="this.style.display='none'">${xnow}${
    textBoxHtml(printedTextBox(sub.name))}`;
}

/** Drop the panel to the bottom of its content. Art that has not been fetched
 * yet contributes NO height, so the first drop is to the bottom of a panel
 * that is about to grow — hence the second one per image as it lands. */
function scrollFocusToBottom(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight;
  const gen = focusGen;
  for (const img of el.querySelectorAll('img')) {
    if (img.complete) continue;
    const again = (): void => { if (gen === focusGen) el.scrollTop = el.scrollHeight; };
    img.addEventListener('load', again, { once: true });
    img.addEventListener('error', again, { once: true });
  }
}

const PIN_BADGE = '<div class="pinbadge">📌 held — hovering elsewhere will not steal this</div>';

/** Paint `sub` into the rail. `fresh` marks a card the player just chose,
 * which opens at the bottom; a repaint after a board render is not fresh and
 * leaves the scroll position alone (renderNow puts it back with the rest). */
function paintFocus(sub: FocusSubject, fresh: boolean): boolean {
  const prev = document.getElementById('preview');
  if (!prev) return false;
  const html = focusHtmlFor(sub);
  if (!html) return false;
  focusGen++;
  prev.innerHTML = html + (pinTimer !== null ? PIN_BADGE : '');
  prev.classList.toggle('pinned', pinTimer !== null);
  if (fresh) scrollFocusToBottom(prev);
  return true;
}

/** hover moved onto a different card */
function showFocus(sub: FocusSubject, key: string): void {
  if (!paintFocus(sub, true)) return;
  focusSub = sub;
  focusKey = key;
}

/** The board was just repainted under it: put the same card back, re-derived
 * from the state that landed. Without this the viewer blanked to the hint on
 * every single action — and a pinned card would not survive the click that
 * pinned it, since that click is usually an action too. */
function repaintFocus(): void {
  if (focusSub) paintFocus(focusSub, false);
}

/** A click says "this one": hold it against hover for PIN_MS. Clicking again
 * — the same card or another — re-arms rather than stacking timers. */
function pinFocus(sub: FocusSubject, key: string): void {
  if (!document.getElementById('preview')) return;   // no rail: not on a board
  if (pinTimer !== null) clearTimeout(pinTimer);
  pinTimer = window.setTimeout(() => {
    pinTimer = null;
    // the card STAYS; only hover's claim on the panel comes back
    repaintFocus();
  }, PIN_MS);
  focusSub = sub;
  focusKey = key;
  paintFocus(sub, true);
}

/** The parts of the UI a click is allowed to change. Deliberately a LIST and
 * not `JSON.stringify(ui)`: the autopass / yield / cancel bookkeeping fields
 * are rewritten by render() itself, and handleAction always renders, so
 * including them would make every click look like it had done something. */
const CLICK_STATE_KEYS = ['carrying', 'columns', 'send', 'spellTokens', 'modding', 'menu',
  'orderPicked', 'draftPack', 'bottomPick', 'confirmDone', 'confirmPass', 'confirmDeploy',
  'confirmAct', 'confirmRide', 'counterCount', 'assignCount'] as const;

/** everything a click may move, as one string */
function clickSig(): string {
  return JSON.stringify([actCount, uiError, binView, cacheView, CLICK_STATE_KEYS.map(k => ui[k])]);
}

/* A click on a card pins the viewer to it — but ONLY when the click had
 * nothing else to do.
 *
 * Playtest (2026-08-22): "clicking CAN'T count when you're supposed to click
 * cards." Half the clicks in this game are MOVES — drafting, recycling,
 * playing, answering a decision, building a line — and hanging a five-second
 * hover freeze off those puts it on the busiest part of the turn, where the
 * card you clicked is not even the one you want to read.
 *
 * The test is empirical rather than a hand-kept list of safe places to click,
 * which would drift from handleAction the first time either changed: take a
 * signature of everything a click can move, let the normal handlers run, and
 * pin only if nothing moved. That is exactly the set the report describes —
 * a unit on the field with no legal click, an opponent's unit, a hand card you
 * cannot cast yet — plus the ones it did not think to mention: a card name in
 * the log, a mod badge, a stack thumbnail, a revealed card.
 *
 * Scheduled rather than immediate because the answer is only known AFTER the
 * other handlers and the render they trigger; pinFocus repaints the rail
 * itself, so arriving late costs nothing.
 */
document.addEventListener('click', e => {
  const t = (e.target as HTMLElement)?.closest?.(
    '[data-prev], [data-previd], [data-prevstack]') as HTMLElement | null;
  if (!t) return;
  const sub = focusSubjectFor(t);
  if (!sub) return;
  const key = focusKeyOf(t);
  const before = clickSig();
  setTimeout(() => { if (clickSig() === before) pinFocus(sub, key); }, 0);
}, { capture: true });

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
  // a clicked card owns the viewer until its pin lapses
  if (pinTimer !== null) return;
  const key = focusKeyOf(t);
  if (key === focusKey) return;            // same card: nothing to repaint
  const sub = focusSubjectFor(t);
  if (sub) showFocus(sub, key);
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

/** The home screen and the lobbies: element picker, deck import, room join,
 * the share link. Nothing here repaints the BOARD — each button repaints the
 * home screen itself, navigates away, or fires a request whose reply does the
 * painting — so the caller stops when one of these claims the click. */
function handlePregameButton(b: string | undefined, btn: HTMLElement): boolean {
  if (b === 'eltoggle') {
    ui.homeFixedTrio = true;
    const el = btn.dataset['el']!;
    if (ui.homeEls.includes(el)) ui.homeEls = ui.homeEls.filter(x => x !== el);
    else if (ui.homeEls.length < 3) ui.homeEls.push(el);
    else { ui.homeEls.shift(); ui.homeEls.push(el); }   // full: rotate the oldest out
    localStorage.setItem('algoEls', JSON.stringify(ui.homeEls));
    renderHome();
    return true;
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
    return true;
  }
  if (b === 'newgame') {
    saveHomeName();
    const m = btn.dataset['mode'];
    const mode = m === 'draft' ? 'draft' : m === 'constructed' ? 'constructed' : 'shared';
    if (mode === 'constructed' && !savedDeck()) return true;   // button is disabled anyway
    // a draft with NO els opens the lobby and chooses the trio there; passing
    // els is the deliberate escape hatch that skips it
    const els = mode === 'draft' && btn.dataset['els'] && ui.homeEls.length === 3
      ? `&els=${encodeURIComponent(ui.homeEls.join(','))}` : '';
    fetch('/api/new').then(r => r.json()).then((r: { code: string }) => {
      location.search = `?ws=1&room=${encodeURIComponent(r.code)}&seat=0&mode=${mode}${els}`;
    }).catch(() => { uiError = 'could not reach the server'; renderHome(); });
    return true;
  }
  if (b === 'deckimporturl') {
    const inp = document.getElementById('h-deckurl') as HTMLInputElement | null;
    const url = inp?.value.trim();
    if (url) importDeck({ url }, NET ? render : renderHome);
    return true;
  }
  if (b === 'deckimporttext') {
    const ta = document.getElementById('h-decktext') as HTMLTextAreaElement | null;
    const text = ta?.value.trim();
    if (text) importDeck({ text }, NET ? render : renderHome);
    return true;
  }
  if (b === 'deckjoin') { NET?.sendJoin(); return true; }
  if (b === 'joincode') {
    saveHomeName();
    const code = (document.getElementById('h-code') as HTMLInputElement).value.trim().toUpperCase();
    if (!code) return true;
    location.search = `?ws=1&room=${encodeURIComponent(code)}`;
    return true;
  }
  if (b === 'hotseat') { saveHomeName(); location.search = '?hotseat=1'; return true; }
  if (b === 'practice') { saveHomeName(); location.search = '?demo=1'; return true; }
  if (b === 'gohome') { location.href = location.pathname; return true; }
  if (b === 'copylink') {
    const link = btn.dataset['link']!;
    // clipboard API needs a secure context; plain-http LAN needs the fallback
    void navigator.clipboard?.writeText(link).catch(() => {});
    const inp = document.querySelector('.sharelink') as HTMLInputElement | null;
    if (inp) { inp.select(); document.execCommand('copy'); }
    btn.textContent = 'copied ✓';
    return true;
  }
  return false;
}

/** A board button's handler. The click handler repaints the board after every
 * one of these — the one decision a handler owns is whether that repaint is
 * wanted. `'no-repaint'` says it is not: either the reply to a send will paint
 * (undo, the judge, a bug report) or the handler painted by hand. Everything
 * else mutates and lets the shared render() show the result. */
type BtnHandler = (btn: HTMLElement) => void | 'no-repaint';

/** the chip: keep passing until the battle ends or something new is played */
function armPassAll(): void {
  ui.autopass = true;
  ui.autopassStack = h.state.stack.length;
  // [59] the pass that arms the chip is the one going out for THIS state —
  // the latch (UiState.sentFor, set by NetBackend.do) is what stops the
  // chip's own auto-pass adding a second one on the very next paint.
  // #1: remember which activateAbility keys were ALREADY legal — a new one
  // appearing later (granted by a resolution) disarms the chip
  ui.autopassSig = NET ? abilityKeys(NET.seat) : [];
}

/** Pass / Pass all: the one pass that costs something asks first. */
function passClick(mode: 'pass' | 'passall'): void {
  const s = h.state;
  // C5, rewritten for [66]: "The UI is reminding me I have unused tokens at
  // EVERY chance it has… It should just be right at the end before moving to
  // Regroup." The guard used to fire on any pass while a castable token was
  // in hand, which during a busy battle is every window — so it stopped being
  // information and became a second click on the Pass button.
  //
  // Regroup is the ONLY step that erases spell tokens (R11), so the pass that
  // reaches it is the only pass that costs anything. passEndsBattlePhase
  // (ui/battle.ts) derives that from the engine's own transition and is
  // tested there.
  if (s.priority !== null && passEndsBattlePhase(s, s.priority)
    && castableTokenCount(s.priority) > 0) {
    ui.confirmPass = mode;
    return;
  }
  if (mode === 'passall') armPassAll();
  act({ type: 'passPriority', seat: s.priority! });
}

/** [69] send the attack that has been built, riders and all */
function declareBuiltAttack(): void {
  const s = h.state;
  if (!s.battle || s.battle.step !== 'declare') return;   // the window moved
  const cols = ui.columns.filter(c => c.length);
  act({ type: 'declareAttack', seat: s.battle!.attacker, columns: cols, spellTokens: ui.spellTokens.slice() });
  if (!uiError) { ui.columns = []; ui.carrying = null; ui.spellTokens = []; ui.rideAnswered = false; }
}

/** [67] send the block declaration that has been built, riders and all */
function declareBuiltBlocks(): void {
  const s = h.state;
  if (!s.battle || s.battle.step !== 'blocks') return;   // the window moved
  const blocks = blockPlan();
  // R84: the bar disables the button, and Enter honours `disabled` — this is
  // the belt to that braces, so no path can send a declaration the engine has
  // already told us it will refuse.
  const duty = blockPlanIssue(s, s.battle!.defender, blocks);
  if (duty) { uiError = duty; render(); return; }
  // R87: one list on the board, two fields in the action. splitCounterattack
  // (ui/battle.ts) is the only place that split is made, so the log line and
  // the reachability ledger see the tokens the player actually picked.
  const { send, spellTokens } = splitCounterattack(s, ui.send);
  // [77] …and the same question about EVERY other block rule, asked before
  // the action goes anywhere. A refusal now keeps the parts of the plan the
  // engine would take and clears only the units it named — the whole of
  // ledger #77. blockVerdict (ui/battle.ts) is a read of the engine's own
  // validator, exactly as blockPlanIssue is; it never invents a rule.
  const verdict = blockVerdict(s, s.battle!.defender, blocks, send, spellTokens);
  if (verdict) {
    ui.blockRefusal = verdict;
    ui.columns = columnsFromPlan(verdict.keep.blocks);
    ui.send = [...verdict.keep.send, ...verdict.keep.spellTokens];
    ui.carrying = null;
    // the reason belongs NEXT TO the units it is about, not in the generic
    // error slot at the far end of the bar — blockRefusalHtml prints it
    uiError = '';
    playCue('error');
    render();
    return;
  }
  ui.blockRefusal = null;
  act({ type: 'declareBlocks', seat: s.battle!.defender, blocks, send, spellTokens });
  if (!uiError) {
    // [77] over a socket the refusal has not arrived yet, so the plan is
    // held until an authoritative state says the declaration LANDED
    // (ensureBlockKeys). Hotseat has already applied it, so it goes now.
    if (NET) ui.blockSent = true;
    else { ui.columns = []; ui.send = []; ui.spellTokens = []; ui.rideAnswered = false; }
    ui.carrying = null;
  }
}

/** the memory aid: forget one card, or the whole strip. Decision logic is in
 * ui/inspect.ts — this only reads the live look and stores the answer. */
function forgetSeen(what: 'card' | 'all', i = 0): void {
  const seen = NET ? h.state.seenHand?.[NET.seat] : null;
  seenDrop = what === 'all' ? dismissSeenHand(seen) : dismissSeenCard(seen, seenDrop, i);
  saveSeenDrop();
}

/** Every board button by its data-btn name. The home screen and the lobbies
 * are handlePregameButton; the acct-/pg-/lobby- families dispatch to their
 * own modules before this table is consulted (handleButton). */
const BOARD_BTNS: Record<string, BtnHandler> = {
  cachespent: btn => {
    const p = Number(btn.dataset['p']) as Seat;
    if (showSpentCache.has(p)) showSpentCache.delete(p); else showSpentCache.add(p);
  },
  motiontoggle: () => { setMotionOn(!motionOn()); motionReset(); flashReset(); },
  soundtoggle: () => {
    const on = !soundOn();
    setSoundOn(on);
    // switching it ON plays the quietest cue as an audition: you find out both
    // that it works and how loud it is, without waiting for a phase to turn.
    if (on) { primeAudio(); playCue('priority'); }
  },
  undo: () => { NET?.undo(); return 'no-repaint'; },
  restart: () => {
    if (NET) return;   // hotseat only — a net game never draws this button
    const d = h.state.mode === 'constructed' ? savedDeck() : null;
    h = new Harness(Math.floor(Math.random() * 1e6), undefined,
      h.state.mode === 'constructed' && !d ? 'shared' : h.state.mode, undefined,
      d ? [d.cards, d.cards] : undefined);
    resetUi(); uiError = '';
  },
  doneplan: btn => {
    const s = h.state;
    const p = Number(btn.dataset['p']) as Seat;
    const pl = s.players[p]!;
    const dormant = pl.resources.filter(r => r.state === 'dormant').length;
    // guard against accidentally skipping activations (playtest feedback: a
    // dormant board looks deceptively "ready")
    if (pl.activationsLeft > 0 && dormant > 0) ui.confirmDone = p;
    else act({ type: 'donePlanning', seat: p });
  },
  doneplanconfirm: btn => {
    ui.confirmDone = null;
    act({ type: 'donePlanning', seat: Number(btn.dataset['p']) });
  },
  doneplancancel: () => { ui.confirmDone = null; },
  donehaste: btn => { act({ type: 'doneHaste', seat: Number(btn.dataset['p']) }); },
  pass: () => passClick('pass'),
  passall: () => passClick('passall'),
  passcancel: () => { ui.confirmPass = null; },
  passconfirm: () => {
    const mode = ui.confirmPass;
    ui.confirmPass = null;
    if (mode) {
      if (mode === 'passall') armPassAll();
      act({ type: 'passPriority', seat: h.state.priority! });
    }
  },
  // R80: an auto-pass is SCHEDULED now rather than sent on the spot, so
  // switching either of them off has to reach into the wait as well — the
  // whole point of the stop button is that this window becomes yours again.
  passallstop: () => { ui.autopass = false; cancelAutoPass(); },
  // R150/CT-28: jump to the live state. flushPace() renders on its own, and
  // the handler table's trailing render() is harmless on top of it.
  paceskip: () => { NET?.flushPace(); },
  autopasstoggle: () => {
    localStorage.setItem('algoAutopass', localStorage.getItem('algoAutopass') === '1' ? '' : '1');
    cancelAutoPass();
  },
  'pg-reopen': () => { postGameHidden = false; },
  'trio-ok': () => { pendingTrio = null; },
  revealdone: () => { pendingReveal = null; releaseHeldFlashes(); },
  donedeploy: btn => {
    // playtest: don't let a paid-for prophecy or a glimpsed card die in the
    // cache because deployment is the one step you click through fast.
    const seat = Number(btn.dataset['p']) as Seat;
    if (playableCached(seat).length) ui.confirmDeploy = seat;
    else act({ type: 'doneDeploying', seat });
  },
  deploycancel: () => { ui.confirmDeploy = null; },
  deployconfirm: () => {
    const seat = ui.confirmDeploy;
    ui.confirmDeploy = null;
    if (seat !== null) act({ type: 'doneDeploying', seat });
  },
  actcancel: () => { ui.confirmAct = null; },
  actconfirm: () => {
    const a = ui.confirmAct;
    ui.confirmAct = null;
    if (a) {
      act({ type: 'activateAbility', seat: a.seat, entityId: a.entityId,
        abilityIndex: a.abilityIndex, ...(a.via ? { via: a.via } : {}) });
    }
  },
  skipattack: () => {
    act({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
    ui.columns = []; ui.carrying = null; ui.spellTokens = []; ui.rideAnswered = false;
  },
  attackall: () => {
    // one click for the whole army: every eligible unit fronts its own
    // column (still adjustable before "Attack!"; playtest: 100 token clicks)
    const bt = h.state.battle!;
    const e = q();
    const from = bt.round === 1 || bt.attackerPool === null ? e.homeRegion(bt.attacker) : bt.region;
    const placed = new Set(ui.columns.flat());
    for (const u of e.unitsOf(bt.attacker, from)) {
      if (placed.has(u.id)) continue;
      if (bt.attackerPool && !bt.attackerPool.includes(u.id)) continue;
      ui.columns.push([u.id]);
    }
    ui.carrying = null;
  },
  confirmattack: () => {
    // [69] the last thing between the formation and the declaration: if tokens
    // COULD ride along and none were picked, ask once. shouldAskRide
    // (ui/battle.ts) is the judgement — it says no when there are no tokens (so
    // this is never modal noise) and no once the question has been answered for
    // this attack (so Attack! is not a two-click button from then on).
    const s = h.state;
    const atk = s.battle!.attacker;
    if (shouldAskRide(s, atk, ui.spellTokens, ui.rideAnswered)) {
      ui.confirmRide = atk; return;
    }
    declareBuiltAttack();
  },
  // "Bring none" is the explicit answer the report asked for — it must be a
  // CHOICE the player makes, not the silent default that produced ten
  // token-less attacks in GETD. On the block side "none" means dropping the
  // tokens back out of the send list, leaving the counterattackers behind.
  ridenone: () => {
    const s = h.state;
    ui.rideAnswered = true; ui.confirmRide = null;
    if (s.battle?.step === 'blocks') {
      ui.send = splitCounterattack(s, ui.send).send;
      declareBuiltBlocks();
    } else { ui.spellTokens = []; declareBuiltAttack(); }
  },
  rideconfirm: () => {
    ui.rideAnswered = true; ui.confirmRide = null;
    if (h.state.battle?.step === 'blocks') declareBuiltBlocks(); else declareBuiltAttack();
  },
  ridecancel: () => { ui.confirmRide = null; },   // back to building, unanswered
  confirmblocks: () => {
    // [67] the counterattack's own ride question, gated by shouldAskSend —
    // which stays silent when there are no tokens, when the player has already
    // picked some, and (the rule, not politeness) when no UNIT is being sent,
    // because "they always need a unit to take them with them".
    const s = h.state;
    const def = s.battle!.defender;
    if (shouldAskSend(s, def, ui.send, ui.rideAnswered)) {
      ui.confirmRide = def; return;
    }
    declareBuiltBlocks();
  },
  draftcommit: btn => {
    if (!ui.draftPack) return;
    act({ type: 'draftCommit', seat: Number(btn.dataset['p']) as Seat, packIndices: ui.draftPack.slice() });
    if (!uiError) { ui.draftPack = null; }
  },
  bottomcommit: btn => {
    act({ type: 'bottomCards', seat: Number(btn.dataset['p']) as Seat, handIndices: ui.bottomPick.slice() });
    if (!uiError) { ui.bottomPick = []; ui.bottomFor = ''; }
  },
  decide: btn => { act({ type: 'decide', seat: h.state.decision!.seat, choice: Number(btn.dataset['i']) }); },
  // BL-25/R139 — the stepper. NONE of these three answers the decision: the
  // owner asked for All to jump the count "without auto submitting", and the
  // whole reason is that a unit with a lot of counters is exactly where you
  // want to see the number before you spend them. ui/inspect.ts says so in
  // the type (CounterStepperAction.submit is the literal false).
  ctrup: () => { ui.counterCount = counterStepperCount(h.state.decision, ui.counterCount, 'up').count; },
  ctrdown: () => { ui.counterCount = counterStepperCount(h.state.decision, ui.counterCount, 'down').count; },
  ctrall: () => { ui.counterCount = counterStepperCount(h.state.decision, ui.counterCount, 'all').count; },
  // the 'amount' shape (an effect that asks HOW MANY) has no unit to click,
  // so its confirm is a button — and it is the ONLY one of the four that acts
  ctrtake: () => {
    const dec = h.state.decision;
    const i = dec ? counterAmountIndex(dec, counterStepper(dec, ui.counterCount).count) : -1;
    if (i >= 0) act({ type: 'decide', seat: dec!.seat, choice: i });
  },
  // CT-34/R149 — the damage-split ticker. As with the counter stepper, −/+/All
  // move the dial and NOTHING ELSE: assigning combat damage is irreversible,
  // so the number is read before it is spent (StepperAction.submit is the
  // literal false). asgtake and asgdefault are the only two that act.
  asgup: () => { ui.assignCount = assignSplitStep(h.state.decision, h.state, ui.assignCount, 'up').count; },
  asgdown: () => { ui.assignCount = assignSplitStep(h.state.decision, h.state, ui.assignCount, 'down').count; },
  asgall: () => { ui.assignCount = assignSplitStep(h.state.decision, h.state, ui.assignCount, 'all').count; },
  asgtake: () => {
    const dec = h.state.decision;
    const sub = assignSplitSubmit(dec, assignSplitStepper(dec, h.state, ui.assignCount).count);
    if (sub.ok && sub.index >= 0) act({ type: 'decide', seat: dec!.seat, choice: sub.index });
    else if (sub.why) uiError = sub.why;
  },
  asgdefault: () => {
    const dec = h.state.decision;
    const i = assignSplitStepper(dec, h.state, ui.assignCount).defaultIndex;
    if (i >= 0) act({ type: 'decide', seat: dec!.seat, choice: i });
  },
  orderpick: btn => {
    const s = h.state;
    ui.orderPicked.push(Number(btn.dataset['i']));
    if (ui.orderPicked.length === s.decision!.options.length) {
      const choice = ui.orderPicked.slice();
      ui.orderPicked = [];
      act({ type: 'decide', seat: s.decision!.seat, choice });
    }
  },
  binopen: btn => { binView = Number(btn.dataset['p']) as Seat; },
  binclose: () => { binView = null; },
  seendrop: btn => forgetSeen('card', Number(btn.dataset['i'])),
  seenhideall: () => forgetSeen('all'),
  erasedclose: () => { erasedView = null; },
  concedeno: () => { concedeAsk = null; },
  concedeyes: () => {
    const seat = concedeAsk;
    concedeAsk = null;
    if (seat !== null) act({ type: 'concede', seat });
  },
  // R41: the cache is public — either seat's zone opens for either player
  cacheopen: btn => { cacheView = Number(btn.dataset['p']) as Seat; },
  cacheclose: () => { cacheView = null; },
  helpopen: () => { helpOpen = true; },
  helpclose: () => { helpOpen = false; },
  judgeopen: () => { judgeOpen = true; },
  judgeclose: () => { judgeOpen = false; },
  inspectclose: () => { inspect = null; },
  inspectjudge: btn => {
    const name = btn.dataset['name'] ?? inspect?.name ?? '';
    inspect = null;
    judgeOpen = true;
    judgeDraft = `I have a question about ${name}. `;
  },
  judgeask: () => {
    const inp = document.getElementById('judge-q') as HTMLInputElement | null;
    const question = inp?.value.trim();
    if (question && !judgeBusy) { if (inp) inp.value = ''; judgeDraft = ''; askJudge(question); return 'no-repaint'; }
  },
  modcancel: () => { ui.modding = null; },
  castcancel: () => { startCastCancel(); },
  // BL-19: the one-click start-again, on the attack bar and the block bar
  // alike. resetFormation is the whole of it — and the repaint that
  // handleButton does next republishes the now-empty formation.
  clearform: () => { resetFormation(); },
  // [77] "…give a notice as well as a 'Reset blockers?' button". The explicit
  // start-again, offered BESIDE the surviving plan rather than done to it.
  resetblocks: () => { resetFormation(); },
  reportopen: () => { reportOpen = true; },
  reportclose: () => { reportOpen = false; },
  reportsend: () => { sendReport(); return 'no-repaint'; },
  menuitem: btn => { const it = ui.menu!.items[Number(btn.dataset['i'])]!; ui.menu = null; it.go(); },
  menuclose: () => { ui.menu = null; },
};

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
  if (handlePregameButton(b, btn)) return;
  // a board button: the table's handler mutates, the repaint is shared — and a
  // name the table does not know still repaints (a stray data-btn closes a menu)
  if (BOARD_BTNS[b ?? '']?.(btn) === 'no-repaint') return;
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
    // #63: the exchange list DEFAULTS to your deck's elements, with the rest
    // behind an expander. prismiteClickPlan (ui/inspect.ts) owns the judgement
    // — including the auto-fire, which counts LEGAL actions and never the
    // filtered display: an active prismite offers seven exchanges and no
    // activate, so a mono-element deck counting the short list would have its
    // prismite silently spent with no menu at all.
    const openRes = (expanded: boolean): void => {
      const plan = prismiteClickPlan(s, p, opts, expanded);
      if (plan.kind === 'none') return;
      if (plan.kind === 'auto') { act(plan.action); return; }
      const items: MenuItem[] = plan.actions.map(a => ({
        label: a.type === 'activateResource' ? 'Activate' : `Exchange → ${(a as { element: string }).element}`,
        icon: a.type === 'exchangePrismite' ? (a as { element: string }).element : undefined,
        go: () => { act(a); render(); },
      }));
      if (plan.hidden) items.push({
        label: `more elements… (${plan.hidden})`,
        go: () => { openRes(true); render(); },
      });
      ui.menu = { x: e.clientX, y: e.clientY, items };
    };
    openRes(false);
  }

  if (kind === 'player') {
    const ref: TargetRef = { player: Number(t.dataset['p']) };
    const idx = decisionOptionIndex(ref);
    if (idx >= 0) act({ type: 'decide', seat: s.decision!.seat, choice: idx });
  }

  if (kind === 'stackitem') {
    const id = Number(t.dataset['id']);
    const ref: TargetRef = { stack: id };
    const idx = decisionOptionIndex(ref);
    if (idx >= 0) act({ type: 'decide', seat: s.decision!.seat, choice: idx });
    // R79: a stack item is the second KIND of mod host — clicking a glowing
    // spell finishes the placement exactly as clicking a glowing unit does.
    // modHostCache.stack is the engine's own answer (hostStack), so a spell
    // that is not a legal host takes no click at all.
    else if (ui.modding && modHostCache.stack.has(id)) {
      const m = ui.modding;
      ui.modding = null;
      applyMod(m, { stack: id }, e);
    }
  }

  if (kind === 'token') {
    const tok = s.entities[Number(t.dataset['id'])];
    // R89: a mod in flight lands on a glowing spell token exactly as it lands
    // on a glowing unit. Checked FIRST and against modHostCache.tokens — the
    // engine's own offer — so a token that is not a legal host takes no click,
    // and a placement in progress is never mistaken for "cast this token".
    if (tok && ui.modding && (modHostCache.tokens?.has(tok.id) ?? false)) {
      const m = ui.modding;
      ui.modding = null;
      applyMod(m, { unit: tok.id }, e);
      render();
      return;
    }
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
    // BL-25/R139: a counter-removal option names its unit as {counterFrom},
    // which the ref lookup above has never matched — so the unit standing on
    // the BOARD was inert and the only way in was its scan down in the prompt
    // bar. That is the "not clear that it wants you to click the unit" the
    // owner hit: the obvious thing to click did nothing at all.
    const ctr = counterClickIndex(id as EntityId);
    if (ctr >= 0) { act({ type: 'decide', seat: s.decision!.seat, choice: ctr }); render(); return; }
    if (ui.modding) {
      const m = ui.modding;
      ui.modding = null;
      applyMod(m, { unit: id }, e);
      render();
      return;
    }
    const u = s.entities[id];
    const b = s.battle;
    if (NET && u && u.controller !== NET.seat) return;   // in net mode I only manipulate my own units
    // R170: both option-pick routes above have already been tried and missed,
    // so an open question this unit IS part of can never reach here. What is
    // left is "may its controller act at all", and since R154 that turns on
    // whose question it is — see `decisionFreezes`.
    if (u && !decisionFreezes(u.controller)) {
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
    // the insert itself is ui/formation.ts dropIntoRow, tested there
    ui.columns[ci] = dropIntoRow(ui.columns[ci] ?? [], row, ui.carrying);
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
    // R96/R123: playing a card straight out of the bin (Abyssal Evocation's
    // grant, or the card's own line — Trench Stalker)
    const plays = legal.filter(a => a.type === 'playFromBin' && a.binIndex === i);
    if (plays.length || proph.length) {
      const name = h.state.players[p]!.bin[i] ?? '?';
      const items: MenuItem[] = [
        ...plays.map(a => ({ label: `Play ${name} from your bin`,
          go: () => { binView = null; act(a); render(); } })),
        // [08b] same rule as the hand: never on the revealing click
        ...(proph.length ? [{ label: prophesyLabel(name), confirm: actionNeedsMenu(proph[0]!),
          go: () => { binView = null; act(proph[0]!); render(); } }] : []),
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
  // R170: `decisionFreezes`, not a bare `s.decision`. No TargetRef names a
  // hand card (types.ts), so nothing here can ever be a decision OPTION and
  // the gate is only ever "may this seat act at all" — which since R154 is a
  // question about WHOSE question it is. It used to be answered wrong in the
  // most misleading way available: the card kept its green `playable` ring
  // (handHtml reads legalFor, which was never gated) and then ate the click.
  if (!name || name === HIDDEN_CARD || decisionFreezes(p)) return;

  // during an open draft step the hand is drafted from the panel, not recycled
  if (s.mode === 'draft' && s.draftDone && !s.draftDone[p]) return;
  if (s.phase === 'planning' && !s.planningDone[p]) {
    // only the elements actually in this game (a fwe draft offers no wood/metal),
    // and in constructed only the ones in YOUR deck (#63) — with every one of
    // the seven still one click away, because an off-element resource is a real
    // play (Reap the Due is mono-light and scales off DARK affinity).
    const openRecycle = (expanded: boolean): void => {
      const { show, hidden } = resourceMenuElements(s, p, s.elements, expanded);
      const items: MenuItem[] = show.map(el => ({
        label: `Recycle → ${el} resource`,
        icon: el,
        go: () => { act({ type: 'recycleForResource', seat: p, handIndex: i, element: el }); render(); },
      }));
      if (hidden.length) items.push({
        label: `more elements… (${hidden.length})`,
        go: () => { openRecycle(true); render(); },
      });
      ui.menu = { x: e.clientX, y: e.clientY, items };
    };
    openRecycle(false);
    render();
    return;
  }

  const legal = legalFor(p);
  const playActions = legal.filter(a => a.type === 'playCard' && a.handIndex === i);
  const modActions = legal.filter(a => (a.type === 'augment' || a.type === 'graft') && a.from === 'hand' && a.index === i);
  const prophesyActions = legal.filter(a => a.type === 'prophesy' && a.from === 'hand' && a.index === i);
  const items: MenuItem[] = [];
  for (const a of playActions) {
    const mode = a.type === 'playCard' ? a.mode : undefined;
    // R40: "1 Discard me" is a whole alternative play mode like Ambush — pay
    // the cost line, discard the card, which TRASHES it and fires its own
    // "when I am trashed" trigger (Dropslime, Nothyr, Sacrifice Dude).
    const label = mode === 'ambush' ? `Ambush with ${name}`
      : mode === 'discardMe' ? discardMeLabel(name)
      // R123: an erase-funded haste play (Writhing Host) — the cost is said
      // on the button, before the click, because the erase is not undoable
      : a.type === 'playCard' && a.eraseGrant ? `Play ${name} as if it had [Haste] — erases the grantor from your bin`
      : `Play ${name}`;
    items.push({ label, go: () => { act(a); render(); } });
  }
  // R42: prophesying is a DEPLOYMENT-only action; legalActions already knows
  // that, and which cards may come from the bin, so this just renders it.
  // [08b] …and it never fires on the click that revealed it: it spends mana
  // and takes the card out of your hand for good, with no target decision
  // anywhere in it to walk you back.
  for (const a of prophesyActions) {
    items.push({ label: prophesyLabel(name), confirm: actionNeedsMenu(a), go: () => { act(a); render(); } });
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
    // a cached card IS a legal target (Prismatic Observer), so the option-pick
    // is tried first and wins — `cc.uid === undefined` means cached before
    // uids existed, i.e. untargetable, and it simply cannot be one.
    if (cc.uid !== undefined) {
      const idx = decisionOptionIndex({ cached: { seat: p, uid: cc.uid } });
      if (idx >= 0) { act({ type: 'decide', seat: s.decision.seat, choice: idx }); return; }
    }
    // R170: it is not an option. Then this is an ordinary click, and whether
    // it is allowed is the R154 question of whose decision is open — not the
    // pre-R154 "any decision at all".
    if (decisionFreezes(p)) return;
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
function offer(items: MenuItem[], e: MouseEvent): void {
  // [08b] planOffer (ui/inspect.ts) owns the judgement, including the one an
  // item can override: a `confirm` item never fires on the click that revealed
  // it, however alone it is on the list.
  const plan = planOffer(items);
  if (plan.kind === 'go') items[plan.index]!.go();
  else if (plan.kind === 'menu') ui.menu = { x: e.clientX, y: e.clientY, items };
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
  if (mods.some(a => a.type === 'augment')) {
    // R79: name the hosts the engine is actually offering — a virus in a
    // battle window can go onto a spell on the stack, and an entry that says
    // "a unit" is how that ruling stayed invisible.
    const what = modHostPhrase(modHosts(mods, { from, index: i, mode: 'augment' }, h.state));
    items.push({ label: `Augment a ${what} with ${name}${sfx}`, go: start('augment') });
  }
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

/** the two kinds of host a mod can land on: a unit in play, or (R79) a spell
 * on the stack. `Action.augment` carries exactly one of them. */
type ModHost = { unit: EntityId } | { stack: number };

function applyMod(m: NonNullable<UiState['modding']>, host: ModHost, e: MouseEvent): void {
  // R79: a virus onto a SPELL. Only augment ever offers a stack host (a graft
  // wants a graft-cause unit's stack, which a spell has not got), so there is
  // no position menu to open here — it goes on the stack above its host.
  if ('stack' in host) {
    act({ type: 'augment', seat: m.seat, from: m.from, index: m.index, hostStack: host.stack });
    return;
  }
  const hostId = host.unit;
  if (m.mode === 'augment') {
    act({ type: 'augment', seat: m.seat, from: m.from, index: m.index, hostId });
    return;
  }
  const hostEnt = h.state.entities[hostId];
  const nMods = hostEnt?.mods.length ?? 0;
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
  // [69] "Bring none" is deliberately NOT here: Enter is how the token-less
  // attack got sent ten times in GETD, and the whole point of this bar is that
  // declining is a choice somebody makes, not a key they were already holding.
  '[data-btn="rideconfirm"]',
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
    // the five "are you sure?" bars — Esc is their "Go back" (the doneplan and
    // the [69] ride-along ones even advertise it on the button)
    if (ui.confirmRide !== null) { ui.confirmRide = null; render(); return; }
    if (ui.confirmDone !== null) { ui.confirmDone = null; render(); return; }
    if (ui.confirmPass !== null) { ui.confirmPass = null; render(); return; }
    if (ui.confirmDeploy !== null) { ui.confirmDeploy = null; render(); return; }
    if (ui.confirmAct) { ui.confirmAct = null; render(); return; }
    if (ui.modding) { ui.modding = null; render(); return; }
    if (canCancelNow()) { startCastCancel(); render(); return; }
    if (ui.carrying !== null) { ui.carrying = null; render(); return; }
    // BL-19: Esc is the Clear button's shortcut, so it must do the Clear
    // button's job — the same reset, and the same repaint-and-republish
    if (hasBuild(ui)) { resetFormation(); render(); return; }
    return;
  }

  if (inField) return;   // never fire game hotkeys while typing
  const overlayUp = reportOpen || judgeOpen || helpOpen || !!inspect
    || binView !== null || erasedView !== null || concedeAsk !== null || cacheView !== null || !!ui.menu;

  // R150/CT-28: S skips the pacing. Deliberately a bare letter and not Enter
  // or Space: those two are how game actions are confirmed, and the whole
  // promise of the skip is that it only ever moves the SCREEN forward.
  if (e.key === 's' || e.key === 'S') {
    if (overlayUp || !NET || !NET.heldUpdates()) return;
    e.preventDefault();
    NET.flushPace();
    return;
  }

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
function boardMenuItems(): MenuItem[] {
  // [30]/[31] WHICH entries there are, and what they are called, is decided in
  // ui/inspect.ts (boardMenuEntries) where it is tested. This hangs the two
  // behaviours on them — and note that neither one ACTS: concede opens the
  // confirmation (concedeHtml), it never concedes.
  return boardMenuEntries(h.state, NET ? NET.seat : null).map(entry => ({
    label: entry.label,
    confirm: entry.confirm,
    go: entry.kind === 'erased'
      ? (): void => { erasedView = entry.seat; render(); }
      : (): void => { concedeAsk = entry.seat; render(); },
  }));
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


