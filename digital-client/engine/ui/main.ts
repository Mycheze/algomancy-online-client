/* Hotseat UI over the pure engine — a dumb terminal (docs/04 §7).
 * Full re-render after every action; all game mutation goes through
 * Harness.do(action); pending decisions render as highlights or a prompt.
 * Both hands are visible: this is the M1 test rig, not the product. */
import { Harness } from '../src/harness.ts';
import { forcedAction, legalActions, IllegalAction, ALL_ELEMENTS } from '../src/apply.ts';
import { getCard, graftCauseIndex, ELEMENT_OF_PIP } from '../src/cards/dsl.ts';
import { E } from '../src/engine.ts';
import type { Action, CachedCard, Entity, EntityId, EventType, GameState, Seat, TargetRef } from '../src/types.ts';

const ART = '../../../AlgomancyCards/';
/** placeholder name the server sends for a hidden card (opp hand / deck) — see server/view.ts */
const HIDDEN_CARD = '__HIDDEN__';
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
  waiting: { have: [boolean, boolean] } | null = null;
  names: [string, string] = ['Player 1', 'Player 2'];
  /** set when the server hands this seat to a newer connection — stop rendering game UI */
  dead = false;
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
      if (this.joined) render();
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
      mode: this.mode, els: this.els, ...(deck ? { deck: deck.cards } : {}),
    }));
  }
  do(a: Action): void { this.ws.send(JSON.stringify({ t: 'action', action: a })); }
  undo(): void { this.ws.send(JSON.stringify({ t: 'undo' })); }
  private onMsg(m: {
    t: string; seat?: Seat; view?: GameState; log?: string[]; legal?: Action[];
    events?: { msg: string; type?: EventType }[]; reveal?: { msg: string }[]; peers?: [boolean, boolean]; msg?: string;
    clock?: ClockSnap; waiting?: { have: [boolean, boolean] }; names?: [string, string];
  }): void {
    if (m.clock) clockSnap = { ...m.clock, rx: Date.now() };
    if (m.names) this.names = m.names;
    if (m.t === 'joined') {
      this.joined = true; this.seat = m.seat!;
      this.wantSeat = m.seat!;   // reconnect/deck-rejoin keeps this seat
      if (m.waiting) { this.waiting = m.waiting; this.peers = m.peers ?? [false, false]; uiError = ''; render(); return; }
      this.waiting = null;
      this.state = m.view!;
      this.log = m.log ?? []; this.logTypes = this.log.map(() => undefined);
      this.legal = m.legal ?? []; this.peers = m.peers ?? [false, false];
      resetUi(); uiError = ''; render(); return;
    }
    if (m.t === 'update') {
      if (m.waiting) { this.waiting = m.waiting; this.peers = m.peers ?? this.peers; render(); return; }
      if (m.view) this.state = m.view;
      if (m.log) { this.log = m.log; this.logTypes = m.log.map(() => undefined); }   // full resync (undo shrank it)
      if (m.events) for (const e of m.events) { this.log.push(e.msg); this.logTypes.push(e.type); }
      if (m.legal) this.legal = m.legal;
      if (m.peers) this.peers = m.peers;
      // deploy-end reveal: what the opponent secretly did during deployment.
      // Only worth an interstitial when there's more than the bare "is done
      // deploying" line. The state underneath applies normally — only the
      // view is gated behind the overlay's Continue button.
      if (m.reveal && m.reveal.some(ev => !/is done deploying/i.test(ev.msg))) {
        pendingReveal = m.reveal.map(ev => ev.msg);
      }
      render(); return;
    }
    if (m.t === 'kicked') {
      this.dead = true;
      $app.innerHTML = `<div class="joinscreen"><h2>Algomancy</h2>
        <p>${esc(m.msg ?? 'another connection took over this seat')}</p>
        <button data-btn="gohome">home</button></div>`;
      return;
    }
    if (m.t === 'error') { ui.cancelling = false; uiError = m.msg ?? 'error'; render(); return; }
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
  /** home screen: the draft trio being picked (persisted per browser) */
  homeEls: string[];
  /** constructed draw phase: hand indices picked to go to the bottom, in order */
  bottomPick: number[];
  /** which turn+seat bottomPick was built for (re-init on change) */
  bottomFor: string;
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
  bottomPick: [], bottomFor: '',
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
/** deploy-end reveal waiting behind the interstitial (C2) — messages to show */
let pendingReveal: string[] | null = null;
const resetUi = () => {
  ui = freshUi();
  pendingReveal = null;
  snaps = [];
};

const $app = document.getElementById('app')!;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
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
/** the game's REAL icon (element pip, cost circle, marker) as an inline img */
const elIcon = (name: string): string =>
  `<img class="elicon" src="/Icons/${name}.webp" alt="${name}" onerror="this.style.display='none'">`;

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
  if (NET) {
    // network mode: the server is authoritative — send the intent and wait for
    // the pushed redacted update (or an 'error' message). Never apply locally.
    if (a.seat !== NET.seat) { uiError = 'not your seat'; return; }
    NET.do(a);
    uiError = '';
    return;
  }
  snaps.push({ state: structuredClone(h.state), logLen: h.log.length, actionsLen: (h as Harness).actions.length });
  if (snaps.length > 60) snaps.shift();
  try {
    h.do(a);
    // local mode: drain forced steps (empty boards attack/block by themselves;
    // the server does the same for network games)
    for (let g = 0; g < 8; g++) {
      const f = forcedAction(h.state);
      if (!f) break;
      h.do(f);
    }
    uiError = '';
  } catch (err) {
    snaps.pop();   // state unchanged — drop the pre-action snapshot
    if (err instanceof IllegalAction) uiError = err.message;
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
/** net mode rewinds via the server undo — the solo phases, plus any pending
 * pre-commit cast chain of your own (the server verifies the same predicate) */
const cancelWorksHere = (): boolean => true;
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
  return NET ? cancelWorksHere() : hotseatCancelIndex() >= 0;
}
function startCastCancel(): void {
  if (!canCancelNow()) return;
  if (!NET) {
    const i = hotseatCancelIndex();
    const snap = snaps[i]!;
    h.state = snap.state;
    h.log.length = snap.logLen;
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
  if (!cancelableCast() || !cancelWorksHere()) { ui.cancelling = false; return; }
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
/** When I hold priority with no pending decision and EVERY unresolved stack
 * item is a trigger sourced from an auto-yielded unit, pass automatically —
 * anything else on the stack (spells, other triggers) keeps the window open. */
function maybeAutoYield(): void {
  if (!NET || !yieldMap.size) return;
  const s = h.state;
  if (s.phase !== 'battle' || s.decision || s.priority !== NET.seat) return;
  if (!s.stack.length) return;
  if (!s.stack.every(it => it.kind === 'triggered' && it.sourceId !== undefined && yieldMap.has(it.sourceId))) return;
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
function cardHtml(name: string, opts: {
  playable?: boolean; candidate?: boolean; selected?: boolean; carrying?: boolean; modhost?: boolean;
  badges?: { t: string; mod?: boolean; ctr?: boolean; html?: boolean; cls?: string }[]; stats?: string; dmg?: string; data?: string;
} = {}): string {
  const cls = ['card'];
  if (opts.playable) cls.push('playable');
  if (opts.candidate) cls.push('candidate');
  if (opts.selected) cls.push('selected');
  if (opts.carrying) cls.push('carrying');
  if (opts.modhost) cls.push('modhost');
  const badges = (opts.badges ?? []).map(b => `<span class="badge ${b.mod ? 'mod' : ''} ${b.ctr ? 'ctr' : ''} ${b.cls ?? ''}">${b.html ? b.t : esc(b.t)}</span>`).join('');
  return `<div class="${cls.join(' ')}" ${opts.data ?? ''} data-prev="${esc(name)}">
    <img src="${art(name)}" alt="${esc(name)}" onerror="this.classList.add('noart')">
    <div class="artfallback">${esc(name)}</div>
    ${badges ? `<div class="badges">${badges}</div>` : ''}
    ${opts.stats ? `<div class="stats">${opts.stats}</div>` : ''}
    ${opts.dmg ? `<div class="dmg">${opts.dmg}</div>` : ''}
  </div>`;
}

/** a face-down card back (opponent's hidden hand in network mode) */
function backHtml(): string {
  return `<div class="card back" title="hidden card"></div>`;
}

function unitHtml(u: Entity, opts: { selected?: boolean; clickable?: boolean; inert?: boolean } = {}): string {
  const [p, t] = q().effStats(u);
  const badges: { t: string; mod?: boolean; ctr?: boolean; html?: boolean }[] = [...q().ownAttrs(u)].map(a => ({ t: a }));
  if (u.counters) {
    const sign = u.counters > 0 ? '+' : '';
    badges.unshift({ t: `${sign}${u.counters}/${sign}${u.counters}`, ctr: true });
  }
  for (const modId of u.mods) {
    const m = h.state.entities[modId];
    if (m) badges.push({
      t: txtIcon(m.appliedAs === 'graft' ? 'graft' : 'augment', m.appliedAs === 'graft' ? '⇄' : '+') + esc(m.card.split(' ')[0]),
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
    stats, dmg: u.damage ? `−${u.damage}` : '', badges,
    candidate: !opts.inert && isCandidate({ unit: u.id }),
    selected: opts.selected, carrying: ui.carrying === u.id,
    playable: opts.clickable,
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
  return pl.hand.map((n, i) => {
    if (n === HIDDEN_CARD) return backHtml();
    const playable = legal.some(a =>
      (a.type === 'playCard' && a.handIndex === i) ||
      (a.type === 'augment' && a.from === 'hand' && a.index === i) ||
      (a.type === 'graft' && a.from === 'hand' && a.index === i) ||
      (a.type === 'prophesy' && a.from === 'hand' && a.index === i) ||
      (h.state.phase === 'planning' && a.type === 'recycleForResource' && a.handIndex === i));
    // #5: live X preview during battle for state-derived X spells
    const badges: { t: string; mod?: boolean; ctr?: boolean; html?: boolean; cls?: string }[] = [];
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
      playable, badges,
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

  const here = Object.values(s.entities).filter(en =>
    (en.kind === 'unit' || en.kind === 'spellToken') && !en.absent &&
    en.region === region && !inFormation.has(en.id));
  const canClick = (u: Entity): boolean => !!b && (!NET || u.controller === NET.seat) &&
    ((b.step === 'declare' && u.controller === b.attacker) ||
      (b.step === 'blocks' && u.controller === b.defender));
  const entHtml = (en: Entity): string => en.kind === 'spellToken'
    ? tokenHtml(en)
    : unitHtml(en, { clickable: canClick(en) });
  const ownHere = here.filter(en => en.controller === p).map(entHtml).join('');
  // #1: invaders sit as a compact strip at the SIDE of the region's space —
  // visually subordinate to the owner's formation, not front-and-center
  const invaders = here.filter(en => en.controller !== p);
  const invaderHtml = invaders.length
    ? `<div class="invaders"><div class="zonelabel invaderlabel">${txtIcon('battle', '[battle]')} invaders — ${esc(s.players[invaders[0]!.controller]!.name)}</div>
        <div class="zone invaderzone">${invaders.map(entHtml).join('')}</div></div>`
    : '';

  // B2: counterattackers in transit — out of the region rows, inert
  const sent = Object.values(s.entities).filter(en =>
    (en.kind === 'unit' || en.kind === 'spellToken') && en.controller === p && en.absent);
  const sentStrip = sent.length
    ? `<div class="sentstrip"><div class="zonelabel">counterattacking — arrives next round</div>
        <div class="zone">${sent.map(en => en.kind === 'spellToken'
          ? cardHtml(en.card, { stats: 'X=' + en.x })
          : unitHtml(en, { inert: true })).join('')}</div></div>`
    : '';

  // B3: during a battle only state.battle.region is "real"
  const focus = s.phase === 'battle' && b ? (b.region === region ? 'battlefocus' : 'battledim') : '';

  // B5: opponent's hidden hand lives in their identity row; seen-hand memory strip
  const hiddenHand = pl.hand.length > 0 && pl.hand.every(n => n === HIDDEN_CARD);
  const miniHand = hiddenHand
    ? `<span class="minihand" title="hand: ${pl.hand.length} cards">${pl.hand.map(() => '<span class="miniback"></span>').join('')}</span><span style="color:var(--dim)">hand ${pl.hand.length}</span>`
    : '';
  const seen = NET && p === other(NET.seat) ? s.seenHand?.[NET.seat] : null;
  const seenStrip = seen
    ? `<div class="seenhand"><span class="seenlabel">👁 You saw their hand (turn ${seen.turn}) — memory aid, cards may have been played since:</span>
        <span class="seencards">${seen.cards.map(n => cardHtml(n)).join('')}</span></div>`
    : '';

  const handZone = opts.omitHand || hiddenHand ? '' :
    `<div class="zonelabel">Hand (${pl.hand.length})</div><div class="zone">${handZoneHtml(p)}</div>`;

  // the bin lives IN its player's region: a mini stack on the right that
  // opens a full dialog (bin-play clicks work from the dialog).
  // #4: when bin cards are legally usable as mods right now, say so loudly.
  const binUsable = legal.some(a =>
    ((a.type === 'augment' || a.type === 'graft') && a.from === 'bin') ||
    (a.type === 'prophesy' && a.from === 'bin'));
  const binMini = `<div class="regionbin ${binUsable ? 'hasmods' : ''}" data-btn="binopen" data-p="${p}" title="open ${esc(pl.name)}'s bin">
      <div class="zonelabel">bin (${pl.bin.length})</div>
      <div class="regionbinthumbs">${pl.bin.slice(-3).map(n => cardHtml(n)).join('') || '<span class="binempty">empty</span>'}</div>
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
      <span class="life ${isCandidate({ player: p }) ? 'candidate' : ''}" data-act="player" data-p="${p}">♥ ${pl.life}</span>
      ${counters}
      <span class="resrow">${pl.resources.map((r, i) => resHtml(r, p, i)).join('')}
        <span style="color:var(--dim)">(${e.openMana(p)} mana open${s.phase === 'planning' ? `, ${pl.activationsLeft} activations` : ''})</span>
      </span>
      ${miniHand}
      <span class="binline">deck ${s.mode === 'constructed' ? s.decks![p]!.length : s.sharedDeck.length}${s.mode === 'draft' ? ` · pack ${s.packs[p]!.length}` : ''}</span>
    </div>
    ${seenStrip}
    <div class="regionrow">
      <div class="regionmain">
        <div class="zonelabel">Region of ${esc(pl.name)}${focus === 'battlefocus' ? ` — ${txtIcon('battle', '[battle]')} the battle is here` : focus === 'battledim' ? ' — outside this battle' : ''}</div>
        <div class="zone">${ownHere}</div>
        ${sentStrip}
      </div>
      ${invaderHtml}
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
    const badges: { t: string; mod?: boolean; ctr?: boolean; html?: boolean; cls?: string }[] = [];
    if (canAug || canGraft) {
      badges.push({
        t: `${canAug ? txtIcon('augment', '+') : ''}${canGraft ? txtIcon('graft', '[Switch]') : ''} usable as mod`,
        mod: true, html: true,
      });
    }
    if (canProph) badges.push({ t: '📜 prophesy from bin', cls: 'proph on' });
    return cardHtml(n, { playable: usable, badges, data: `data-act="bin" data-p="${p}" data-i="${i}"` });
  }).join('');
  return `<div class="overlay mainonly"><div class="overlaybox binbox">
    <h3>${esc(pl.name)}'s bin (${pl.bin.length})</h3>
    ${anyUsable ? `<div class="binmodbanner">${txtIcon('augment', '+')} Glowing cards can be applied to a unit as a mod right now — click one, then pick a host.</div>` : ''}
    <div class="zone binzone bindialog">${items || '<span class="binempty">empty</span>'}</div>
    <button data-btn="binclose">Close</button>
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
function cacheBadges(p: Seat, i: number): { t: string; mod?: boolean; ctr?: boolean; html?: boolean; cls?: string }[] {
  const e = q();
  const cc = e.cache(p)[i];
  if (!cc) return [];
  const out: { t: string; mod?: boolean; ctr?: boolean; html?: boolean; cls?: string }[] = [];
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
    badges: cacheBadges(p, i),
    playable: !!opts.clickable && (via !== null || cacheModActions(p, i).length > 0),
    candidate,
    data: `data-act="cache" data-p="${p}" data-i="${i}"`,
  });
  return `<div class="cacheentry">${card}${meta}</div>`;
}

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
  const note = mine && now ? `<div class="cachehint">${now} playable now</div>`
    : permitted ? `<div class="cachewait">${permitted} ready${mine ? ' — not this step' : ''}</div>`
      : `<div class="cachewait">${cache.length} waiting</div>`;
  return `<div class="regioncache ${hot ? 'hasplay' : ''}" data-btn="cacheopen" data-p="${p}"
      title="R41: the cache is public — both players see every cached card. Click to open.">
    <div class="zonelabel">cache (${cache.length})</div>
    <div class="regionbinthumbs">${cache.slice(-3).map(cc => cardHtml(cc.card)).join('')}</div>
    ${note}
  </div>`;
}

/** the full cache dialog — the zone is public, so this opens for either seat */
function cacheDialogHtml(): string {
  if (cacheView === null) return '';
  const p = cacheView;
  const pl = h.state.players[p]!;
  const cache = cacheOf(p);
  const mine = !NET || NET.seat === p;
  const items = cache.map((_, i) => cacheCardHtml(p, i, { clickable: mine })).join('');
  const anyPlayable = cache.some((_, i) => q().cachePermission(p, i) !== null);
  return `<div class="overlay mainonly"><div class="overlaybox binbox cachebox">
    <h3>${esc(pl.name)}'s cache (${cache.length})</h3>
    <div class="hint">The cache is public information (R41) — you both see every card here.
      Being cached is not permission to play: a card is playable only while its prophecy is
      fulfilled (free, ignoring affinity) or a glimpse still allows it this turn (pay the mana,
      ignoring affinity). Normal timing still applies. You may also augment or graft from here.</div>
    ${anyPlayable && mine ? '<div class="binmodbanner">Glowing cards can be used right now — click one.</div>' : ''}
    <div class="zone binzone bindialog cachezone">${items || '<span class="binempty">empty</span>'}</div>
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

const KEYWORDS: [string, string][] = [
  ['Flying', 'Its column can only be blocked by a column with Flying.'],
  ['Evasive', 'Needs two blockers — a single unit cannot block it.'],
  ['Sneaky', 'If it is the only attacking unit, it cannot be blocked at all.'],
  ['Alluring', 'Defenders that are able to block it must block it.'],
  ['Piercing', 'Excess damage from its blocked column carries through to the defending player (automatic).'],
  ['Electric', 'Excess damage arcs to an adjacent unit in the formation — the controller picks the path.'],
  ['Deadly', 'Any amount of damage it deals destroys the damaged unit.'],
  ['Swift', 'Its column deals combat damage before normal units; triggers from that damage resolve before normal damage.'],
  ['Sluggish', 'Its column deals combat damage after normal units.'],
  ['Tough', 'Its defense is doubled.'],
  ['Balanced', 'Its power and defense each become the higher of the two.'],
  ['Powerful', 'It deals double damage.'],
  ['Vulnerable', 'It takes double damage.'],
  ['Feeble', 'It cannot block.'],
  ['Poisonous', 'Damage it deals becomes permanent −1/−1 counters instead of marked damage.'],
  ['Resonant', 'When it damages a unit, that unit’s controller also loses that much life.'],
  ['Thieving', 'When its column deals combat damage to a player, its controller draws a card.'],
  ['Reaping', 'When it kills a unit, its controller draws a card.'],
  ['Inverted', 'Its stat CHANGES are reversed (a −7/−7 becomes +7/+7).'],
  ['Unaware', 'Everything counts as interacting with it.'],
  ['Burst', 'Casting one of your burst spell tokens casts all of them in that region at once.'],
  ['Unstable', 'A modded unit that dies is erased (with its mods) instead of going to a bin.'],
  ['Virus', 'May be augmented onto an ENEMY unit during battle.'],
  ['Ambush', 'An alternative battle-time cost: recall a target ally and take its position in play.'],
  // Light & Dark (docs/08). Kept here so the card inspector can explain them
  // instead of falling back to "see the rules reference".
  ['Blessed', 'Damage dealt by a blessed source makes its controller gain that much life — simultaneously, so it applies before the lethal check.'],
  ['Afflicting', 'When an afflicting source kills one or more units — by damage OR by −1/−1 counters — those units’ controllers each gain a rot.'],
  ['Lethal', 'Any combat damage from a lethal unit kills a player outright.'],
  ['Modular', 'You may apply mods from your hand and/or bin to this card as it is played, paying their costs; they ride on the stack with it.'],
  ['Pure', 'Pure cards and cards they interact with ignore all other attributes. (Not implemented — parked with the attribute-suppression layer.)'],
];

/** the Light & Dark zone/counter concepts, explained in the rules reference */
const EXPANSION_GUIDE: [string, string][] = [
  ['Rot ☠', 'A counter on the PLAYER. At the start of every deployment you take damage equal to your rot. It never decreases on its own.'],
  ['Debt ⛓', 'A counter on the PLAYER. At the very end of your next resource step you must pay 1 mana per debt; each mana removes one. Anything you cannot pay carries over, and the mana spent is gone for the turn.'],
  ['Cache 📜', 'A fourth zone beside hand, bin and deck — and a PUBLIC one: you both see every cached card. Being cached is not permission to play it.'],
  ['Prophecy', 'During DEPLOYMENT, pay a card’s banner cost to cache it with its condition attached. Once the condition has been met it stays met, and you may play (or graft/augment) the card for free, ignoring affinity — normal timing still applies.'],
  ['Glimpse', 'Reveal the top N cards of your deck and cache them. Until end of turn you may play them as if they were in hand, ignoring affinity but still paying their mana. Afterwards they stay cached, inert.'],
  ['Trash', 'A nontoken card entering a bin from anywhere but the stack is trashed — discarding, sacrificing, milling and dying in combat all count. A resolved spell going to the bin does not.'],
];

const PHASE_GUIDE: [string, string][] = [
  ['Planning', 'Refresh resources · draw 2 · (draft: merge hand+pack, leave exactly 10, pass) · recycle cards into dormant resources · activate up to 2 resources (3+ affinity of an element when activating it grants a free dormant Shard) · exchange active Prismites.'],
  ['Haste', 'Only {Haste} cards may be played; they resolve immediately. Skipped when nobody can.'],
  ['Battle round 1', 'Initiative attacks: build columns (max 2 units each; column-mates SHARE combat attributes) → response window → defender declares blocks AND may send counterattackers (they cease to exist until round 2) → response window → combat damage (Swift → normal → Sluggish; triggers resolve between steps, no priority) → after-combat window.'],
  ['Battle round 2', 'The counterattack, in the other region: only units sent in round 1 (or a fresh attack if round 1 didn’t happen). Same steps.'],
  ['Regroup', 'Automatic: everyone returns home · damage cleared · temporary changes cleared · spell tokens erased · formations dissolve. Deployment buffs persist into NEXT battle.'],
  ['Deployment', 'Simultaneous and hidden: play cards, augment/graft (from hand or bin), activate abilities — alone in your region. Battle-timing cards unplayable. Reveals when both are done; then end-of-turn triggers (no responses) and initiative passes.'],
];

function helpOverlayHtml(): string {
  return `<div class="overlay mainonly"><div class="overlaybox helpbox">
    <h3>Rules reference</h3>
    <div class="helpscroll">
      <h4>The turn</h4>
      ${PHASE_GUIDE.map(([k, v]) => `<div class="helprow"><b>${k}</b><span>${iconizeText(v)}</span></div>`).join('')}
      <h4>Keywords</h4>
      ${KEYWORDS.map(([k, v]) => `<div class="helprow"><b>${k}</b><span>${iconizeText(v)}</span></div>`).join('')}
      <h4>Light &amp; Dark</h4>
      ${EXPANSION_GUIDE.map(([k, v]) => `<div class="helprow"><b>${k}</b><span>${iconizeText(v)}</span></div>`).join('')}
      <h4>Quick reminders</h4>
      <div class="helprow"><b>Augment ${txtIcon('augment', '(+)')}</b><span>${iconizeText('Slide under a unit from hand or bin: donates type-line attributes and text-box [Augment] text to the host.')}</span></div>
      <div class="helprow"><b>Graft ${txtIcon('graft', '(⇄)')}</b><span>${iconizeText('Insert into a graft-cause unit’s stack: the [Switch] effects join its trigger as one ability. [Switch1] = once per turn per card.')}</span></div>
      <div class="helprow"><b>Resources</b><span>Each grants 1 affinity of its element even while expended (dormant ones grant nothing); expend for 1 mana, refresh each turn. Shards: mana only, no affinity.</span></div>
      <div class="helprow"><b>Undo</b><span>Ctrl+Z or the ↶ button — your own last action, during planning and deployment.</span></div>
    </div>
    <button data-btn="helpclose">Close</button>
  </div></div>`;
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
  let text = '', type = '', printedAttrs: string[] = [];
  try { const c = getCard(name); text = c.text; type = c.type; printedAttrs = c.attrs; } catch { /* unknown */ }
  // a live unit shows its CURRENT attributes (shared/temp/static included);
  // otherwise the printed ones
  const u = inspect.id !== undefined ? h.state.entities[inspect.id] : undefined;
  const attrs = u ? [...q().ownAttrs(u)] : printedAttrs;
  const attrRows = attrs.length
    ? attrs.map(a => {
        const def = KEYWORDS.find(([k]) => k === a)?.[1] ?? 'see the rules reference';
        return `<div class="helprow"><b>${esc(a)}</b><span>${esc(def)}</span></div>`;
      }).join('')
    : '<div class="hint">no attributes</div>';
  const rulings = inspect.rulings === null
    ? '<div class="hint">loading rulings…</div>'
    : inspect.rulings.length
      ? inspect.rulings.map(r => `<div class="rulingrow">${esc(r)}</div>`).join('')
      : `<div class="hint">no recorded rulings for this card${inspect.error ? ` (${esc(inspect.error)})` : ''}</div>`;
  return `<div class="overlay mainonly"><div class="overlaybox inspectbox">
    <h3>${esc(name)} <span class="hint">${iconizeText(type)}</span></h3>
    <div class="inspectscroll">
      <div class="inspecttop"><img src="${art(name)}" alt="" onerror="this.style.display='none'">
        <div class="inspecttext">${iconizeText(text)}</div></div>
      ${u ? graftComposedHtml(u) : ''}
      <h4>Attributes${u ? ' (current, shared/granted included)' : ' (printed)'}</h4>
      ${attrRows}
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
    const cols = ui.columns.map((col, ci) => colBuilderHtml(col, ci)).join('');
    const extra = colBuilderHtml([], ui.columns.length);
    return `<div class="battle"><h3>${txtIcon('battle', '[battle]')} ${esc(A)} declares an attack — round ${b.round}${b.attackerPool ? ' (sent units only)' : ''}</h3>
      <div style="color:var(--dim);margin-bottom:6px">Click one of your units, then a slot. Front row first, 2 max per column.
        Click your spell tokens to bring them along.${ui.spellTokens.length ? ` <b>${ui.spellTokens.length} token${ui.spellTokens.length === 1 ? '' : 's'} riding.</b>` : ''}</div>
      <div class="cols">${cols}${extra}</div></div>`;
  }

  // table orientation: YOUR units sit BELOW the vs-line, the opponent's above
  // (net mode; hotseat keeps attacker-on-top). Default layout has the
  // attacker on top — flip when the viewer IS the attacker.
  const flip = NET ? NET.seat === b.attacker : false;
  // #2: fronts stay on one shared line — each side lives in a fixed-height
  // half anchored against the vs line; extra depth grows AWAY from the front
  // (.bhalf.top is column-reverse, so the FIRST unit — the front — hugs the line)
  const attackCols = b.columns.map((col, ci) => {
    const blockers = b.blocks[ci] ?? [];
    const blockBuild = (b.step === 'blocks') ? blockBuilderHtml(ci) :
      blockers.map(id => h.state.entities[id] ? unitHtml(h.state.entities[id]!) : '').join('');
    const atkSide = col.map(id => h.state.entities[id] ? unitHtml(h.state.entities[id]!) : '').join('') || '<div class="slot">gone</div>';
    const blkSide = blockBuild || '<div class="slot">unblocked</div>';
    const top = flip ? blkSide : atkSide;
    const bottom = flip ? atkSide : blkSide;
    return `<div class="col"><div class="collabel">column ${ci + 1}</div>
      <div class="bhalf top">${top}</div>
      <div class="vs" style="width:100%"></div>
      <div class="bhalf bot">${bottom}</div>
    </div>`;
  }).join('');
  const sendEntHtml = (id: EntityId): string => {
    const en = h.state.entities[id];
    if (!en) return '';
    return en.kind === 'spellToken'
      ? cardHtml(en.card, { stats: 'X=' + en.x, selected: true, data: `data-act="token" data-id="${en.id}"` })
      : unitHtml(en, { selected: true });
  };
  const sendZone = (b.step === 'blocks' && b.round === 1)
    ? `<div class="col"><div class="collabel">send to counterattack</div>
        ${ui.send.map(sendEntHtml).join('')}
        <div class="slot ${ui.carrying ? 'open' : ''}" data-act="sendslot">send</div></div>`
    : '';
  const stepLabel: Record<string, string> = {
    attackWindow: 'response window (attack)', blocks: `${esc(D)} declares blocks & counterattackers`,
    blockWindow: 'response window (blocks)', afterWindow: 'after combat',
  };
  return `<div class="battle"><h3>${txtIcon('battle', '[battle]')} ${esc(A)} attacks ${esc(D)} — ${stepLabel[b.step] ?? b.step}</h3>
    <div class="cols">${attackCols}${sendZone}</div></div>`;
}

function colBuilderHtml(col: EntityId[], ci: number): string {
  const u0 = col[0] !== undefined ? h.state.entities[col[0]] : undefined;
  const u1 = col[1] !== undefined ? h.state.entities[col[1]] : undefined;
  const front = u0 ? unitHtml(u0, { selected: true }) : slotHtml(ci, 0, !!ui.carrying);
  const back = u0 ? (u1 ? unitHtml(u1, { selected: true }) : slotHtml(ci, 1, !!ui.carrying)) : '';
  return `<div class="col"><div class="collabel">column ${ci + 1}</div>${front}${back}</div>`;
}
function slotHtml(ci: number, row: number, open: boolean): string {
  return `<div class="slot ${open ? 'open' : ''}" data-act="slot" data-ci="${ci}" data-row="${row}">${row === 0 ? 'front' : 'back'}</div>`;
}
function blockBuilderHtml(ci: number): string {
  const col = ui.columns[ci] ?? [];
  const u0 = col[0] !== undefined ? h.state.entities[col[0]] : undefined;
  const u1 = col[1] !== undefined ? h.state.entities[col[1]] : undefined;
  const front = u0 ? unitHtml(u0, { selected: true }) : slotHtml(ci, 0, !!ui.carrying);
  const back = u0 ? (u1 ? unitHtml(u1, { selected: true }) : slotHtml(ci, 1, !!ui.carrying)) : '';
  return front + back;
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
  const err = uiError ? `<span style="color:var(--bad)"> ✗ ${esc(uiError)}</span>` : '';
  if (s.phase === 'gameover') {
    const won = s.players[s.winner!]!.name;
    if (NET) return `<div class="promptbar"><span class="who">${s.winner === NET.seat ? 'You win! 🎉' : `${esc(won)} wins.`}</span></div>`;
    return `<div class="promptbar"><span class="who">${esc(won)} wins!</span>
      <button data-btn="restart">New game</button></div>`;
  }
  const dec = s.decision;
  if (dec) {
    const who = esc(s.players[dec.seat]!.name);
    // A2: options that ARE cards (hand looks, deck tops, bin picks) render as
    // clickable scans; the rest stay ordinary buttons after them
    const isRef = (v: unknown): boolean => !!v && typeof v === 'object' &&
      ('unit' in (v as object) || 'player' in (v as object) || 'stack' in (v as object));
    const cardRow = (btn: string, skip?: (i: number) => boolean): string => {
      const cards = dec.options.map((o, i) => (o.card && !skip?.(i))
        ? cardHtml(o.card, { playable: true, data: `data-btn="${btn}" data-i="${i}"${pingAttrs(o)}` }) : '').join('');
      return cards ? `<div class="deccards">${cards}</div>` : '';
    };
    if (dec.kind === 'targets') {
      const hasRefs = dec.options.some(o => isRef(o.value));
      // A1: every non-board-target option (e.g. "No more targets") gets a real button
      const btns = dec.options.map((o, i) => (isRef(o.value) || o.card) ? ''
        : `<button data-btn="decide" data-i="${i}"${pingAttrs(o)}>${iconizeText(o.label)}</button>`).join(' ');
      return `<div class="promptbar pending"><span class="who">${who}:</span>
        ${iconizeText(dec.prompt)}${hasRefs ? ' — click a highlighted target' : ''} ${cardRow('decide')} ${btns} ${castCancelBtnHtml()}${err}</div>`;
    }
    if (dec.kind === 'orderTriggers') {
      const btns = dec.options.map((o, i) => ui.orderPicked.includes(i)
        ? `<span style="color:var(--dim)">${ui.orderPicked.indexOf(i) + 1}. ${iconizeText(o.label)}</span>`
        : o.card ? '' : `<button data-btn="orderpick" data-i="${i}"${pingAttrs(o)}>${iconizeText(o.label)}</button>`).join(' ');
      return `<div class="promptbar pending"><span class="who">${who}:</span>
        ${iconizeText(dec.prompt)} — ${cardRow('orderpick', i => ui.orderPicked.includes(i))} ${btns}${err}</div>`;
    }
    // payOrDecline / electricPath / insertGraft: cards then plain option buttons
    const btns = dec.options.map((o, i) => o.card ? '' : `<button data-btn="decide" data-i="${i}"${pingAttrs(o)}>${iconizeText(o.label)}</button>`).join(' ');
    return `<div class="promptbar pending"><span class="who">${who}:</span> ${iconizeText(dec.prompt)} ${cardRow('decide')} ${btns} ${castCancelBtnHtml()}${err}</div>`;
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
    return `<div class="promptbar"><span class="who">Deployment</span>
      both players deploy at the same time — moves stay hidden until everyone is done.
      Play cards, mod units (augment/graft from hand or bin), activate abilities.
      ${doneRow(dd, 'donedeploy', 'done deploying')}${err}</div>`;
  }
  return `<div class="promptbar">${esc(s.phase)}${err}</div>`;
}

// ── game log styling ──────────────────────────────────────────────────
/** EventType per log line, index-aligned with `h.log`. Hotseat reads the
 * Harness's parallel event list (absorb() pushes both in lockstep); network
 * mode reads the types the server attached to each pushed event. */
function logTypeAt(i: number): EventType | undefined {
  if (NET) return NET.logTypes[i];
  return (h as Harness).events[i]?.type;
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

function stackHtml(): string {
  const items = [...h.state.stack].reverse().map(it => {
    const targets = it.parts.flatMap(p => p.targets).map(tgtLabel).join(', ');
    // {Modular}: mods applied as the card was PLAYED ride on the stack with it
    // (Caleb 2025-02-07). it.label already names them, but the label is one
    // line of text — the mods get their own scans + chips so they read as the
    // separate cards they are, and can be hovered/right-clicked like any card.
    const mods = it.mods ?? [];
    const modChips = mods.length
      ? `<div class="stackmods">${mods.map(m =>
          `<span class="badge mod" data-prev="${esc(m.card)}">${txtIcon('graft', '[Switch]')}${esc(m.card)}
            <span class="modfrom">from ${esc(m.from)}</span></span>`).join('')}</div>`
      : '';
    const modThumbs = mods.map(m =>
      `<img class="stackthumb modthumb" src="${art(m.card)}" alt="" data-prev="${esc(m.card)}" onerror="this.style.display='none'">`).join('');
    // a modular item's extra parts ARE its mods' [Switch] effects — don't
    // double-count them as "grafted parts"
    const extraParts = it.parts.length - 1 - mods.length;
    return `<div class="stackitem ${it.negated ? 'negated' : ''} ${isCandidate({ stack: it.id }) ? 'candidate' : ''}"
      data-act="stackitem" data-id="${it.id}" ${it.card ? `data-prev="${esc(it.card)}"` : ''}>
      ${it.card ? `<img class="stackthumb" src="${art(it.card)}" alt="" onerror="this.style.display='none'">` : ''}
      ${modThumbs}
      <div class="stackmain">${iconizeText(it.label)}${modChips}
      <div class="by">${esc(h.state.players[it.controller]!.name)} · ${it.kind}${extraParts > 0 ? ` · ${extraParts + 1} grafted parts` : ''}${mods.length ? ` · ${mods.length} {Modular} mod${mods.length === 1 ? '' : 's'}` : ''}${targets ? ' → ' + targets : ''}</div></div>
    </div>`;
  }).join('');
  return `<div class="stackpanel"><h3>Stack (top first)</h3>${items || '<div class="stackempty">empty</div>'}</div>`;
}
function tgtLabel(t: TargetRef): string {
  if ('unit' in t) return esc(h.state.entities[t.unit]?.card ?? 'gone');
  if ('player' in t) return esc(h.state.players[t.player]!.name);
  // R41: a card in someone's cache (Prismatic Observer) — the zone is public
  if ('cached' in t) {
    const cc = (h.state.players[t.cached.seat]!.cache ?? []).find(c => c.uid === t.cached.uid);
    return esc(cc ? `${cc.card} (cache)` : 'gone');
  }
  return esc(h.state.stack.find(i => i.id === t.stack)?.label ?? 'gone');
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

/** Share banner: shown while the opponent's seat is empty in network mode. */
function shareBannerHtml(): string {
  if (!NET || NET.peers[other(NET.seat)]) return '';
  const link = `${location.origin}/?ws=1&room=${encodeURIComponent(NET.room)}&seat=${other(NET.seat)}&mode=${h.state.mode}`;
  return `<div class="sharebar">Waiting for your opponent — send them the room code
    <b>${esc(NET.room)}</b> or this link:
    <input class="sharelink" readonly value="${esc(link)}" onclick="this.select()">
    <button data-btn="copylink" data-link="${esc(link)}">copy</button></div>`;
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
  picksMade?: number; lastLook?: boolean;
}

/** #5: "Pack #N · pick M (X of Y cards left)" + the last-look warning */
function packInfoHtml(): string {
  const pi = (h.state as GameState & { packInfo?: PackInfo }).packInfo;
  if (!pi || typeof pi !== 'object' || typeof pi.packNumber !== 'number') return '';
  const pick = typeof pi.picksMade === 'number' ? ` · pick ${pi.picksMade + 1}` : '';
  const count = typeof pi.remaining === 'number' && typeof pi.originalSize === 'number'
    ? ` (${pi.remaining} of ${pi.originalSize} cards left)` : '';
  const last = pi.lastLook === true
    ? `<div class="lastlook">your <b>last look</b> at this pack — after this commit it never comes back to you; your opponent will see whatever you leave in it</div>`
    : '';
  return `<div class="packrow"><span class="packinfo">Pack #${pi.packNumber}${pick}${count}</span>${last}</div>`;
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
  return `<div class="draftpanel">
    ${packInfoHtml()}
    <div class="drafthead"><span class="who">${esc(s.players[seat]!.name)} — draft step</span>
      Click cards to move them between hand and pack. Leave exactly ${need} in the pack.
      <button class="primary" data-btn="draftcommit" data-p="${seat}" ${ok ? '' : 'disabled'}>
        Keep ${handIdx.length} · pass the pack (enter)</button>
      ${ok ? '' : `<span style="color:var(--bad)">pack has ${packIdx.length}/${need}</span>`}</div>
    <div class="zonelabel">Your hand after drafting (${handIdx.length})</div>
    <div class="zone draftkeep">${cardRow(handIdx)}</div>
    <div class="zonelabel">Left in the pack — passes to your opponent (${packIdx.length}/${need})</div>
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

function render(): void {
  if (NET && (NET.dead || !NET.joined)) { if (!NET.dead) renderConnecting(); return; }
  if (NET?.waiting) { renderWaiting(); return; }   // constructed lobby
  $app.classList.toggle('netmode', !!NET);   // net mode: sticky hand dock at the bottom
  ensureDraftUi();
  ensureBottomUi();
  ensureCounterPrefill();
  modHostCache = moddingHosts();   // #4: legal hosts for a mod-in-progress glow
  const logFrom = Math.max(0, h.log.length - 80);
  const logItems = h.log.slice(-80).map((l, i) => {
    const t = logTypeAt(logFrom + i);
    const cls = t ? LOG_EVENT_CLASS[t] ?? '' : '';
    return `<div class="${cls}">${iconizeText(l)}</div>`;
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
  const autoPref = localStorage.getItem('algoAutopass') === '1';
  $app.innerHTML = `
    <div class="main">
      <div class="topbar">
        <span>Turn ${h.state.turn}${h.state.mode === 'draft' ? ` · draft: ${h.state.elements.map(el => elIcon(el)).join('')}` : ''}</span>
        ${phaseTrackHtml()}
        <span class="init">initiative: ${esc(h.state.players[h.state.initiative]!.name)} ⭐</span>
        ${netTag}
        ${clocksHtml()}
        ${ui.autopass ? '<button class="passallchip" data-btn="passallstop" title="click to stop passing">auto-passing… ✕ stop</button>' : ''}
        ${NET ? `<button data-btn="autopasstoggle" class="aptoggle ${autoPref ? 'on' : ''}"
          title="when ON: automatically pass whenever passing is your only legal action">auto-pass: ${autoPref ? 'on' : 'off'}</button>` : ''}
        <button data-btn="helpopen" title="rules reference: phases + keywords" style="margin-left:auto">? rules</button>
        <button data-btn="judgeopen" title="ask the rules judge bot">⚖ judge</button>
        ${NET ? '<button data-btn="reportopen" title="report an issue — the server logs this exact game moment">🐛</button>' : ''}
        ${canUndo ? '<button data-btn="undo" title="undo your last action (Ctrl+Z)">↶ undo</button>' : ''}
        ${NET ? '' : '<button data-btn="restart">New game</button>'}
      </div>
      ${shareBannerHtml()}
      ${promptHtml()}
      ${draftPanelHtml()}
      ${bottomPanelHtml()}
      ${regionPanelHtml(topSeat)}
      ${battleHtml()}
      ${regionPanelHtml(botSeat, { omitHand: !!NET })}
    </div>
    <div class="side">
      <div class="preview" id="preview"><div class="hint">hover a card to preview</div></div>
      ${stackHtml()}
      <div class="logpanel" id="log"><h3>Game log</h3>${logItems}</div>
    </div>
    ${NET ? `<div class="handdock"><div class="zonelabel">Your hand (${h.state.players[botSeat]!.hand.length})</div>
      <div class="zone">${handZoneHtml(botSeat)}</div></div>` : ''}
    ${menuHtml()}
    ${binDialogHtml()}
    ${cacheDialogHtml()}
    ${helpOpen ? helpOverlayHtml() : ''}
    ${inspectorHtml()}
    ${judgeOpen ? judgeOverlayHtml() : ''}
    ${pendingReveal ? revealOverlayHtml() : ''}
    ${reportOpen ? reportOverlayHtml() : ''}
    ${toastMsg ? `<div class="toast">${esc(toastMsg)}</div>` : ''}`;
  const log = document.getElementById('log')!;
  log.scrollTop = log.scrollHeight;
  clampMenu();
  maybeAutopass();
  maybeAutoYield();
  maybeCancelChain();
  // judge input: submit on Enter, survive re-renders mid-typing
  const jq = document.getElementById('judge-q') as HTMLInputElement | null;
  if (jq) {
    if (judgeDraft) { jq.value = judgeDraft; jq.focus(); jq.setSelectionRange(jq.value.length, jq.value.length); }
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
    if (!reportBusy) { rn.focus(); rn.setSelectionRange(rn.value.length, rn.value.length); }
    rn.addEventListener('input', () => {
      reportDraft = rn.value;
      const send = document.querySelector('[data-btn="reportsend"]') as HTMLButtonElement | null;
      if (send) send.disabled = reportBusy || !reportDraft.trim();
    });
  }
}
/** the judge question being typed (survives server-push re-renders) */
let judgeDraft = '';

// ── deployment reveal interstitial (C2) ───────────────────────────────
/** longest word-sequence in `msg` that names a known card, if any */
function findCardName(msg: string): string | null {
  const words = msg.split(/\s+/).map(w => w.replace(/[.,!:;()'"]/g, ''));
  for (let len = Math.min(6, words.length); len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const cand = words.slice(i, i + len).join(' ');
      try { getCard(cand); return cand; } catch { /* not a card */ }
    }
  }
  return null;
}

function revealOverlayHtml(): string {
  const lines = (pendingReveal ?? []).map(msg => {
    const name = findCardName(msg);
    return `<div class="revealline">${name ? cardHtml(name) : '<span class="revealspacer"></span>'}<span>${esc(msg)}</span></div>`;
  }).join('');
  // 'mainonly' leaves the side column (focus viewer!) uncovered so the
  // revealed cards can be read by hovering them
  return `<div class="overlay mainonly"><div class="overlaybox">
    <h3>Your opponent's deployment</h3>
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
  $app.innerHTML = `<div class="joinscreen"><h2>Algomancy</h2>
    <p>${uiError ? esc(uiError) : 'Connecting to the server…'}</p></div>`;
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

/** Home screen (docs/07 §2): new game / join / hotseat / practice. */
function renderHome(): void {
  const name = localStorage.getItem('algoName') ?? '';
  const deck = savedDeck();
  $app.innerHTML = `<div class="joinscreen home">
    <h1 class="homelogo">ALGOMANCY</h1>
    <label class="namerow">Your name <input id="h-name" maxlength="24" value="${esc(name)}" placeholder="(optional)"></label>
    <div class="homebtns">
      <div class="elpicker">
        <div class="zonelabel">Live draft — pick exactly 3 of the ${ALL_ELEMENTS.length} elements
          (${TRIO_COUNT} trios)</div>
        <div class="elrow">${ALL_ELEMENTS.map(el =>
          `<button class="elchip ${el} ${ui.homeEls.includes(el) ? 'on' : ''}" data-btn="eltoggle" data-el="${el}">${elIcon(el)}${el}</button>`).join('')}
          <button data-btn="elrandom" title="pick a random trio — any of the ${TRIO_COUNT}">🎲</button>
        </div>
        <button class="primary" data-btn="newgame" data-mode="draft" ${ui.homeEls.length === 3 ? '' : 'disabled'}>
          New live draft${ui.homeEls.length === 3 ? ` · ${ui.homeEls.join(' + ')}` : ` (${ui.homeEls.length}/3 picked)`}</button>
      </div>
      <div class="elpicker deckpicker">
        <div class="zonelabel">Constructed — bring your own deck</div>
        ${deckPickerHtml()}
        <button class="primary" data-btn="newgame" data-mode="constructed" ${deck ? '' : 'disabled'}>
          New constructed game${deck ? ` · ${esc(deck.name)}` : ' (pick a deck)'}</button>
      </div>
      <div class="joinrow">
        <input id="h-code" placeholder="CODE" maxlength="8" autocapitalize="characters"
          spellcheck="false" style="text-transform:uppercase">
        <button data-btn="joincode">Join game</button>
      </div>
      <button data-btn="hotseat">Local hotseat</button>
      <button data-btn="practice">Practice demo</button>
    </div>
    <p class="hint">One of you starts a new game and sends the other the room code or link.</p>
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
  const net = NET!;
  const w = net.waiting!;
  const me = net.seat, opp = other(me);
  const link = `${location.origin}/?ws=1&room=${encodeURIComponent(net.room)}&seat=${opp}&mode=constructed`;
  const deck = savedDeck();
  const mineIn = w.have[me];
  const oppLine = w.have[opp]
    ? '✓ deck is in'
    : net.peers[opp] ? 'connected — still choosing a deck…' : 'not here yet';
  $app.innerHTML = `<div class="joinscreen home">
    <h2>Constructed — room ${esc(net.room)}</h2>
    <div class="waitstatus">
      <div>${esc(net.names[me] ?? 'You')} (you): ${mineIn
        ? `✓ deck is in${deck ? ` — <b>${esc(deck.name)}</b> by ${esc(deck.author)}` : ''}`
        : 'pick a deck below'}</div>
      <div>${esc(net.names[opp] ?? 'Opponent')}: ${oppLine}</div>
    </div>
    ${mineIn ? '<p class="hint">The game deals the moment both decks are in.</p>' : `
      <div class="elpicker deckpicker">
        ${deckPickerHtml()}
        <button class="primary" data-btn="deckjoin" ${deck ? '' : 'disabled'}>Play this deck</button>
      </div>`}
    <div class="sharebar">Send your opponent the room code <b>${esc(net.room)}</b> or this link:
      <input class="sharelink" readonly value="${esc(link)}" onclick="this.select()">
      <button data-btn="copylink" data-link="${esc(link)}">copy</button></div>
    ${uiError ? `<p class="deckmsg">${esc(uiError)}</p>` : ''}
    <button data-btn="gohome">home</button>
  </div>`;
  wireDeckPicker(renderWaiting);
}

const saveHomeName = (): void => {
  const inp = document.getElementById('h-name') as HTMLInputElement | null;
  if (inp) localStorage.setItem('algoName', inp.value.trim());
};

// ── interaction ───────────────────────────────────────────────────────
/** the focus viewer for a live unit: composed modded card (base art + each
 * mod's text strip, like the physical slide-under), live vs base stats,
 * counters, damage, attrs — the Discord bot's combine, in HTML */
/** #7: a host's graft-cause trigger + its grafted [Switch] effects, rendered
 * as the single composed ability they actually are (Manual p.33): the host's
 * trigger clause (its text up to the [Switch] marker), then the host's own
 * effect and each grafted card's [Switch] effect in mod order — each keeping
 * its [switch]/[switch1] marker so iconizeText prefixes the right icon. */
function graftComposedHtml(u: Entity): string {
  const grafts = u.mods
    .map(id => h.state.entities[id])
    .filter((m): m is Entity => !!m && m.appliedAs === 'graft');
  if (!grafts.length) return '';
  let hostText = '';
  try { if (graftCauseIndex(u.card) < 0) return ''; hostText = getCard(u.card).text; } catch { return ''; }
  const sw = /\[switch1?\]/i;
  const clean = (s: string): string => s.replace(/\{\/n\}/g, ' ').replace(/\s+/g, ' ').trim();
  const m = sw.exec(hostText);
  const head = clean(m ? hostText.slice(0, m.index) : hostText);
  const parts: string[] = m ? [clean(hostText.slice(m.index))] : [];
  for (const g of grafts) {
    let t = '';
    try { t = getCard(g.card).text; } catch { /* unknown */ }
    if (!t) continue;
    const gm = sw.exec(t);
    parts.push(clean(gm ? t.slice(gm.index) : t));
  }
  return `<div class="grafted"><span class="grafttag">${txtIcon('graft', '[Switch]')} grafted — one ability</span>
    <div class="graftbody">${iconizeText(head)} ${parts.map(p => iconizeText(p)).join(' ')}</div></div>`;
}

function previewEntityHtml(id: EntityId): string {
  const u = h.state.entities[id];
  if (!u) return '';
  const e = q();
  const [p, t] = e.effStats(u);
  let base: [number, number] = u.tokenStats ?? [0, 0];
  let text = '';
  try { const c = getCard(u.card); base = u.tokenStats ?? [c.power, c.toughness]; text = c.text; } catch { /* unknown */ }
  const modStrips = u.mods.map(mid => {
    const m = h.state.entities[mid];
    if (!m) return '';
    let mtext = '';
    try { mtext = getCard(m.card).text; } catch { /* unknown */ }
    const tag = m.appliedAs === 'graft'
      ? `${txtIcon('graft', '[Switch]')} grafted` : `${txtIcon('augment', '+')} augment`;
    return `<div class="modstrip"><img src="${art(m.card)}" alt="">
      <span class="modtag">${tag} · ${esc(m.card)}</span></div>
      <div class="hint modtext">${iconizeText(mtext)}</div>`;
  }).join('');
  const changed = p !== base[0] || t !== base[1];
  const bits = [
    `<b class="${changed ? (p + t >= base[0] + base[1] ? 'statup' : 'statdown') : ''}">${p}/${t}</b>${changed ? ` <span class="basestat">base ${base[0]}/${base[1]}</span>` : ''}`,
    u.counters ? `${u.counters > 0 ? '+' : ''}${u.counters}/${u.counters > 0 ? '+' : ''}${u.counters} counters` : '',
    u.damage ? `${u.damage} damage` : '',
  ].filter(Boolean).join(' · ');
  const attrs = [...e.ownAttrs(u)].join(' · ');
  return `<img src="${art(u.card)}" alt="" onerror="this.style.display='none'">${modStrips}
    ${graftComposedHtml(u)}
    <div class="prevstats">${bits}</div>
    ${attrs ? `<div class="hint">${esc(attrs)}</div>` : ''}
    <div class="hint">${iconizeText(text)}</div>`;
}

document.addEventListener('mouseover', e => {
  // #3: hovering a decision button that refers to a live entity pings that
  // unit's card(s) on the board
  const ping = (e.target as HTMLElement).closest('[data-ping]') as HTMLElement | null;
  if (ping) {
    for (const el of document.querySelectorAll(`[data-id="${ping.dataset['ping']}"]`)) el.classList.add('pinghl');
  }
  const t = (e.target as HTMLElement).closest('[data-prev], [data-previd]') as HTMLElement | null;
  if (!t) return;
  const prev = document.getElementById('preview');
  if (!prev) return;
  if (t.dataset['previd']) {
    const html = previewEntityHtml(Number(t.dataset['previd']));
    if (html) { prev.innerHTML = html; return; }
  }
  const name = t.dataset['prev'];
  if (!name) return;
  let text = '';
  try { text = getCard(name).text; } catch { /* unknown card */ }
  // #5: hand cards carry their live X preview into the focus viewer
  const xnow = t.dataset['xnow'] !== undefined
    ? `<div class="xnow">X = ${esc(t.dataset['xnow'])} right now</div>` : '';
  prev.innerHTML = `<img src="${art(name)}" alt="" onerror="this.style.display='none'">${xnow}<div class="hint">${iconizeText(text)}</div>`;
});

document.addEventListener('mouseout', e => {
  const ping = (e.target as HTMLElement).closest('[data-ping]') as HTMLElement | null;
  if (!ping) return;
  for (const el of document.querySelectorAll('.pinghl')) el.classList.remove('pinghl');
});

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
  const b = btn.dataset['btn'];
  if (b === 'eltoggle') {
    const el = btn.dataset['el']!;
    if (ui.homeEls.includes(el)) ui.homeEls = ui.homeEls.filter(x => x !== el);
    else if (ui.homeEls.length < 3) ui.homeEls.push(el);
    else { ui.homeEls.shift(); ui.homeEls.push(el); }   // full: rotate the oldest out
    localStorage.setItem('algoEls', JSON.stringify(ui.homeEls));
    renderHome();
    return;
  }
  if (b === 'elrandom') {
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
    const els = mode === 'draft' && ui.homeEls.length === 3
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
  if (b === 'revealdone') pendingReveal = null;
  if (b === 'donedeploy') act({ type: 'doneDeploying', seat: Number(btn.dataset['p']) });
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
    if (b && u && !s.decision &&
      ((b.step === 'declare' && u.controller === b.attacker) || (b.step === 'blocks' && u.controller === b.defender))) {
      const placed = ui.columns.some(c => c.includes(id)) || ui.send.includes(id);
      if (placed) {
        ui.columns = ui.columns.map(c => c.filter(x => x !== id)).filter(c => b.step === 'declare' ? c.length > 0 : true);
        ui.send = ui.send.filter(x => x !== id);
      } else {
        ui.carrying = (ui.carrying === id ? null : id);
      }
    } else if (u && !s.decision) {
      // activated abilities on your own units
      const opts = legalFor(u.controller).filter(a => a.type === 'activateAbility' && a.entityId === id);
      const optLabel = (a: Action): string => {
        if (a.type !== 'activateAbility') return '?';
        // resolve the ability list the action's `via` refers to (own abilities /
        // own [Augment] text / text donated by an augment mod)
        if (a.via === undefined) return getCard(u.card).abilities?.[a.abilityIndex]?.label ?? '?';
        const name = a.via === 'augment' ? u.card : h.state.entities[a.via.mod]?.card;
        const label = name ? getCard(name).augmentText?.[a.abilityIndex]?.label : undefined;
        return name && a.via !== 'augment' ? `${name}: ${label ?? '?'}` : label ?? '?';
      };
      if (opts.length === 1) act(opts[0]!);
      else if (opts.length > 1) {
        ui.menu = {
          x: e.clientX, y: e.clientY,
          items: opts.map(a => ({
            label: optLabel(a),
            go: () => { act(a); render(); },
          })),
        };
      }
    }
  }

  if (kind === 'slot' && ui.carrying !== null) {
    const ci = Number(t.dataset['ci']);
    if (!ui.columns[ci]) ui.columns[ci] = [];
    if (ui.columns[ci]!.length < 2) ui.columns[ci]!.push(ui.carrying);
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
      ];
      if (mods.some(a => a.type === 'augment')) items.push({ label: `Augment a unit with ${name}`, go: () => { binView = null; ui.modding = { seat: p, from: 'bin', index: i, mode: 'augment' }; render(); } });
      if (mods.some(a => a.type === 'graft')) items.push({ label: `Graft ${name} under a unit`, go: () => { binView = null; ui.modding = { seat: p, from: 'bin', index: i, mode: 'graft' }; render(); } });
      if (items.length === 1) items[0]!.go();
      else ui.menu = { x: e.clientX, y: e.clientY, items };
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
  if (modActions.some(a => a.type === 'augment')) {
    items.push({ label: `Augment a unit with ${name}`, go: () => { ui.modding = { seat: p, from: 'hand', index: i, mode: 'augment' }; render(); } });
  }
  if (modActions.some(a => a.type === 'graft')) {
    items.push({ label: `Graft ${name} under a unit`, go: () => { ui.modding = { seat: p, from: 'hand', index: i, mode: 'graft' }; render(); } });
  }
  if (items.length === 1) items[0]!.go();
  else if (items.length > 1) { ui.menu = { x: e.clientX, y: e.clientY, items }; render(); }
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
  if (mods.some(a => a.type === 'augment')) {
    items.push({ label: `Augment a unit with ${cc.card}${free}`, go: () => { cacheView = null; ui.modding = { seat: p, from: 'cache', index: i, mode: 'augment' }; render(); } });
  }
  if (mods.some(a => a.type === 'graft')) {
    items.push({ label: `Graft ${cc.card} under a unit${free}`, go: () => { cacheView = null; ui.modding = { seat: p, from: 'cache', index: i, mode: 'graft' }; render(); } });
  }
  if (!items.length) return;
  if (items.length === 1) items[0]!.go();
  else ui.menu = { x: e.clientX, y: e.clientY, items };
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
    if (cacheView !== null) { cacheView = null; render(); return; }
    if (pendingReveal) { pendingReveal = null; render(); return; }
    if (inField) return;
    if (ui.modding) { ui.modding = null; render(); return; }
    if (canCancelNow()) { startCastCancel(); render(); return; }
    if (ui.carrying !== null) { ui.carrying = null; render(); return; }
    if (ui.columns.some(c => c && c.length) || ui.send.length || ui.spellTokens.length) {
      ui.columns = []; ui.send = []; ui.spellTokens = []; render(); return;
    }
    return;
  }

  if (inField) return;   // never fire game hotkeys while typing
  const overlayUp = reportOpen || judgeOpen || helpOpen || !!inspect || binView !== null || cacheView !== null || !!ui.menu;

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

// right-click any card (board, hand, bin, preview, reveal) → inspector menu
document.addEventListener('contextmenu', e => {
  if (!inGame) return;   // never paint game UI over the home screen
  const t = (e.target as HTMLElement).closest('[data-prev], [data-previd]') as HTMLElement | null;
  if (!t) return;
  e.preventDefault();
  const id = t.dataset['previd'] !== undefined ? Number(t.dataset['previd']) : undefined;
  const name = id !== undefined ? h.state.entities[id]?.card : t.dataset['prev'];
  if (!name || name === HIDDEN_CARD) return;
  const me = e as MouseEvent;
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
      const it = h.state.stack.find(i => i.id === Number(t.dataset['id']));
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
  ui.menu = { x: me.clientX, y: me.clientY, items };
  render();
});

const params = new URLSearchParams(location.search);
/** false on the home screen — the game click-fallback must not fire there */
const inGame = (params.has('room') && !!params.get('room')!.trim()) || params.has('hotseat') || params.has('demo');
if (params.has('room') && params.get('room')!.trim()) {
  const room = params.get('room')!.toUpperCase().trim();
  const sp = params.get('seat');
  const seat: Seat | null = sp === '0' ? 0 : sp === '1' ? 1 : null;
  const urlEls = params.get('els')?.split(',').map(s => s.trim()).filter(Boolean);
  NET = new NetBackend(room, seat, params.get('mode') ?? undefined, urlEls?.length ? urlEls : undefined);
  h = NET;
  loadYield();   // #2: per-room auto-yield choices survive a refresh
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


