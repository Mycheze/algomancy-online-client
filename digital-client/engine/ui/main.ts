/* Hotseat UI over the pure engine — a dumb terminal (docs/04 §7).
 * Full re-render after every action; all game mutation goes through
 * Harness.do(action); pending decisions render as highlights or a prompt.
 * Both hands are visible: this is the M1 test rig, not the product. */
import { Harness } from '../src/harness.ts';
import { forcedAction, legalActions, IllegalAction } from '../src/apply.ts';
import { getCard } from '../src/cards/dsl.ts';
import { E } from '../src/engine.ts';
import type { Action, Entity, EntityId, GameState, Seat, TargetRef } from '../src/types.ts';

const ART = '../../../AlgomancyCards/';
/** placeholder name the server sends for a hidden card (opp hand / deck) — see server/view.ts */
const HIDDEN_CARD = '__HIDDEN__';
const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

/** minimal backend contract the UI renders against — Harness (hotseat) or NetBackend (remote) */
interface Backend { state: GameState; log: string[]; do(a: Action): void; }

/** Remote backend: sends intents over WS, renders from server-pushed redacted views.
 * The server is authoritative — do() never mutates local state; a server 'update'
 * (or 'joined') message replaces state/log/legal and re-renders. */
class NetBackend implements Backend {
  state: GameState = null as unknown as GameState;
  log: string[] = [];
  seat: Seat = 0;
  room: string;
  legal: Action[] = [];
  peers: [boolean, boolean] = [false, false];
  joined = false;
  /** set when the server hands this seat to a newer connection — stop rendering game UI */
  dead = false;
  ws: WebSocket;
  constructor(room: string, seat: Seat | null, mode?: string, els?: string[]) {
    if (seat != null) this.seat = seat;
    this.room = room;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);
    const name = (localStorage.getItem('algoName') ?? '').trim();
    // mode + chosen trio only matter when this join creates the room (the
    // creator's link carries them) — the server ignores them for existing rooms
    this.ws.onopen = () => this.ws.send(JSON.stringify({ t: 'join', room, seat, name, mode, els }));
    this.ws.onmessage = ev => this.onMsg(JSON.parse(String(ev.data)));
    this.ws.onclose = () => {
      if (this.dead) return;
      uiError = 'disconnected from server — refresh to reconnect';
      if (this.joined) render();
    };
  }
  do(a: Action): void { this.ws.send(JSON.stringify({ t: 'action', action: a })); }
  undo(): void { this.ws.send(JSON.stringify({ t: 'undo' })); }
  private onMsg(m: {
    t: string; seat?: Seat; view?: GameState; log?: string[]; legal?: Action[];
    events?: { msg: string }[]; reveal?: { msg: string }[]; peers?: [boolean, boolean]; msg?: string;
  }): void {
    if (m.t === 'joined') {
      this.joined = true; this.seat = m.seat!; this.state = m.view!;
      this.log = m.log ?? []; this.legal = m.legal ?? []; this.peers = m.peers ?? [false, false];
      resetUi(); uiError = ''; render(); return;
    }
    if (m.t === 'update') {
      if (m.view) this.state = m.view;
      if (m.log) this.log = m.log;               // full log resync (undo shrank it)
      if (m.events) for (const e of m.events) this.log.push(e.msg);
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
    if (m.t === 'error') { uiError = m.msg ?? 'error'; render(); return; }
  }
}

let NET: NetBackend | null = null;
let h: Backend = new Harness(Math.floor(Math.random() * 1e6));
let uiError = '';

interface UiState {
  carrying: EntityId | null;
  columns: EntityId[][];
  send: EntityId[];
  /** spell tokens riding along with the attack being built (C1) */
  spellTokens: EntityId[];
  modding: { from: 'hand' | 'bin'; index: number; seat: Seat; mode: 'augment' | 'graft' } | null;
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
  /** "done planning" pressed with dormant resources + activations left: which
   * seat is being asked "are you sure?" */
  confirmDone: Seat | null;
  /** Pass pressed with castable spell tokens during battle (C5): which pass
   * button is being confirmed */
  confirmPass: 'pass' | 'passall' | null;
  /** home screen: the draft trio being picked (persisted per browser) */
  homeEls: string[];
}
const savedEls = (): string[] => {
  try { return JSON.parse(localStorage.getItem('algoEls') ?? '') as string[]; }
  catch { return ['fire', 'water', 'earth']; }
};
let ui: UiState = {
  carrying: null, columns: [], send: [], spellTokens: [], modding: null, menu: null, orderPicked: [],
  draftPack: null, draftFor: '', autopass: false, autopassAt: -1, autopassStack: 0,
  autopassPrefAt: -1, confirmDone: null, confirmPass: null, homeEls: savedEls(),
};
/** deploy-end reveal waiting behind the interstitial (C2) — messages to show */
let pendingReveal: string[] | null = null;
const resetUi = () => {
  ui = {
    carrying: null, columns: [], send: [], spellTokens: [], modding: null, menu: null, orderPicked: [],
    draftPack: null, draftFor: '', autopass: false, autopassAt: -1, autopassStack: 0,
    autopassPrefAt: -1, confirmDone: null, confirmPass: null, homeEls: savedEls(),
  };
  pendingReveal = null;
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
const q = () => new E(h.state);

function act(a: Action): void {
  if (NET) {
    // network mode: the server is authoritative — send the intent and wait for
    // the pushed redacted update (or an 'error' message). Never apply locally.
    if (a.seat !== NET.seat) { uiError = 'not your seat'; return; }
    NET.do(a);
    uiError = '';
    return;
  }
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
    if (err instanceof IllegalAction) uiError = err.message;
    else throw err;
  }
}

// ── decision helpers ──────────────────────────────────────────────────
function decisionOptionIndex(ref: TargetRef): number {
  const dec = h.state.decision;
  if (!dec || dec.kind !== 'targets') return -1;
  return dec.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify(ref));
}
const isCandidate = (ref: TargetRef) => decisionOptionIndex(ref) >= 0;

function legalFor(seat: Seat): Action[] {
  // network mode: the server computes and pushes MY legal actions (avoids
  // redaction problems client-side); the opponent's are unknown to me → none.
  if (NET) return seat === NET.seat ? NET.legal : [];
  return legalActions(h.state, seat);
}

/** distinct spell tokens `seat` could cast right now (C5 pass guard) */
function castableTokenCount(seat: Seat): number {
  return new Set(legalFor(seat)
    .filter(a => a.type === 'castSpellToken')
    .map(a => (a as { entityId: EntityId }).entityId)).size;
}

// ── rendering ─────────────────────────────────────────────────────────
function cardHtml(name: string, opts: {
  playable?: boolean; candidate?: boolean; selected?: boolean; carrying?: boolean;
  badges?: { t: string; mod?: boolean; ctr?: boolean }[]; stats?: string; dmg?: string; data?: string;
} = {}): string {
  const cls = ['card'];
  if (opts.playable) cls.push('playable');
  if (opts.candidate) cls.push('candidate');
  if (opts.selected) cls.push('selected');
  if (opts.carrying) cls.push('carrying');
  const badges = (opts.badges ?? []).map(b => `<span class="badge ${b.mod ? 'mod' : ''} ${b.ctr ? 'ctr' : ''}">${esc(b.t)}</span>`).join('');
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
  const badges: { t: string; mod?: boolean; ctr?: boolean }[] = [...q().ownAttrs(u)].map(a => ({ t: a }));
  if (u.counters) {
    const sign = u.counters > 0 ? '+' : '';
    badges.unshift({ t: `${sign}${u.counters}/${sign}${u.counters}`, ctr: true });
  }
  for (const modId of u.mods) {
    const m = h.state.entities[modId];
    if (m) badges.push({ t: (m.appliedAs === 'graft' ? '⑂' : '+') + m.card.split(' ')[0], mod: true });
  }
  if (u.absent) badges.push({ t: 'sent', mod: true });
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
  return `<span class="rescard ${r.state} ${canact ? 'canact' : ''}" title="${title}"
    data-act="res" data-p="${p}" data-i="${i}" data-prev="${face}"><img src="${art(face)}" alt="">${chip}</span>`;
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
      (h.state.phase === 'planning' && a.type === 'recycleForResource' && a.handIndex === i));
    return cardHtml(n, { playable, data: `data-act="hand" data-p="${p}" data-i="${i}"` });
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
    badges: riding ? [{ t: '⚔ riding', mod: true }] : [],
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
  const invaders = here.filter(en => en.controller !== p);
  const invaderHtml = invaders.length
    ? `<div class="invaders"><div class="zonelabel invaderlabel">⚔ Invaders — ${esc(s.players[invaders[0]!.controller]!.name)}'s units standing here</div>
        <div class="zone">${invaders.map(entHtml).join('')}</div></div>`
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
  // opens a full dialog (bin-play clicks work from the dialog)
  const binMini = `<div class="regionbin" data-btn="binopen" data-p="${p}" title="open ${esc(pl.name)}'s bin">
      <div class="zonelabel">bin (${pl.bin.length})</div>
      <div class="regionbinthumbs">${pl.bin.slice(-3).map(n => cardHtml(n)).join('') || '<span class="binempty">empty</span>'}</div>
    </div>`;

  return `<div class="player region ${acting ? '' : 'inactive'} ${focus}">
    <div class="pheader">
      <span class="pname">${esc(pl.name)}${s.initiative === p ? ' ⭐' : ''}</span>
      <span class="life ${isCandidate({ player: p }) ? 'candidate' : ''}" data-act="player" data-p="${p}">♥ ${pl.life}</span>
      <span class="resrow">${pl.resources.map((r, i) => resHtml(r, p, i)).join('')}
        <span style="color:var(--dim)">(${e.openMana(p)} mana open${s.phase === 'planning' ? `, ${pl.activationsLeft} activations` : ''})</span>
      </span>
      ${miniHand}
      <span class="binline">deck ${s.sharedDeck.length}${s.mode === 'draft' ? ` · pack ${s.packs[p]!.length}` : ''}</span>
    </div>
    ${seenStrip}
    <div class="regionrow">
      <div class="regionmain">
        <div class="zonelabel">Region of ${esc(pl.name)}${focus === 'battlefocus' ? ' — ⚔ the battle is here' : focus === 'battledim' ? ' — outside this battle' : ''}</div>
        <div class="zone">${ownHere}</div>
        ${invaderHtml}
        ${sentStrip}
      </div>
      ${binMini}
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
  const items = pl.bin.map((n, i) => {
    const usable = legal.some(a => (a.type === 'augment' || a.type === 'graft') && a.from === 'bin' && a.index === i);
    return cardHtml(n, { playable: usable, data: `data-act="bin" data-p="${p}" data-i="${i}"` });
  }).join('');
  return `<div class="overlay mainonly"><div class="overlaybox binbox">
    <h3>${esc(pl.name)}'s bin (${pl.bin.length})</h3>
    <div class="zone binzone bindialog">${items || '<span class="binempty">empty</span>'}</div>
    <button data-btn="binclose">Close</button>
  </div></div>`;
}

// (bins moved into their players' region panels — see regionPanelHtml/binDialogHtml)

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
      ${PHASE_GUIDE.map(([k, v]) => `<div class="helprow"><b>${k}</b><span>${v}</span></div>`).join('')}
      <h4>Keywords</h4>
      ${KEYWORDS.map(([k, v]) => `<div class="helprow"><b>${k}</b><span>${v}</span></div>`).join('')}
      <h4>Quick reminders</h4>
      <div class="helprow"><b>Augment (+)</b><span>Slide under a unit from hand or bin: donates type-line attributes and text-box [Augment] text to the host.</span></div>
      <div class="helprow"><b>Graft (⇄)</b><span>Insert into a graft-cause unit’s stack: the [Switch] effects join its trigger as one ability. [Switch1] = once per turn per card.</span></div>
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
    <h3>${esc(name)} <span class="hint">${esc(type)}</span></h3>
    <div class="inspectscroll">
      <div class="inspecttop"><img src="${art(name)}" alt="" onerror="this.style.display='none'">
        <div class="inspecttext">${esc(text)}</div></div>
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
    return `<div class="battle"><h3>⚔ ${esc(A)} declares an attack — round ${b.round}${b.attackerPool ? ' (sent units only)' : ''}</h3>
      <div style="color:var(--dim);margin-bottom:6px">Click one of your units, then a slot. Front row first, 2 max per column.
        Click your spell tokens to bring them along.${ui.spellTokens.length ? ` <b>${ui.spellTokens.length} token${ui.spellTokens.length === 1 ? '' : 's'} riding.</b>` : ''}</div>
      <div class="cols">${cols}${extra}</div></div>`;
  }

  // table orientation: YOUR units sit BELOW the vs-line, the opponent's above
  // (net mode; hotseat keeps attacker-on-top). Default layout has the
  // attacker on top — flip when the viewer IS the attacker.
  const flip = NET ? NET.seat === b.attacker : false;
  const attackCols = b.columns.map((col, ci) => {
    const blockers = b.blocks[ci] ?? [];
    const blockBuild = (b.step === 'blocks') ? blockBuilderHtml(ci) :
      blockers.map(id => h.state.entities[id] ? unitHtml(h.state.entities[id]!) : '').join('');
    const atkSide = col.map(id => h.state.entities[id] ? unitHtml(h.state.entities[id]!) : '').join('') || '<div class="slot">gone</div>';
    const blkSide = blockBuild || '<div class="slot">unblocked</div>';
    const top = flip ? blkSide : atkSide;
    const bottom = flip ? atkSide : blkSide;
    return `<div class="col"><div class="collabel">column ${ci + 1}</div>
      ${top}
      <div class="vs" style="width:100%"></div>
      ${bottom}
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
  return `<div class="battle"><h3>⚔ ${esc(A)} attacks ${esc(D)} — ${stepLabel[b.step] ?? b.step}</h3>
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
        ? cardHtml(o.card, { playable: true, data: `data-btn="${btn}" data-i="${i}"` }) : '').join('');
      return cards ? `<div class="deccards">${cards}</div>` : '';
    };
    if (dec.kind === 'targets') {
      const hasRefs = dec.options.some(o => isRef(o.value));
      // A1: every non-board-target option (e.g. "No more targets") gets a real button
      const btns = dec.options.map((o, i) => (isRef(o.value) || o.card) ? ''
        : `<button data-btn="decide" data-i="${i}">${esc(o.label)}</button>`).join(' ');
      return `<div class="promptbar pending"><span class="who">${who}:</span>
        ${esc(dec.prompt)}${hasRefs ? ' — click a highlighted target' : ''} ${cardRow('decide')} ${btns}${err}</div>`;
    }
    if (dec.kind === 'orderTriggers') {
      const btns = dec.options.map((o, i) => ui.orderPicked.includes(i)
        ? `<span style="color:var(--dim)">${ui.orderPicked.indexOf(i) + 1}. ${esc(o.label)}</span>`
        : o.card ? '' : `<button data-btn="orderpick" data-i="${i}">${esc(o.label)}</button>`).join(' ');
      return `<div class="promptbar pending"><span class="who">${who}:</span>
        ${esc(dec.prompt)} — ${cardRow('orderpick', i => ui.orderPicked.includes(i))} ${btns}${err}</div>`;
    }
    // payOrDecline / electricPath / insertGraft: cards then plain option buttons
    const btns = dec.options.map((o, i) => o.card ? '' : `<button data-btn="decide" data-i="${i}">${esc(o.label)}</button>`).join(' ');
    return `<div class="promptbar pending"><span class="who">${who}:</span> ${esc(dec.prompt)} ${cardRow('decide')} ${btns}${err}</div>`;
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
      : `<button data-btn="${btn}" data-p="${p}">${esc(s.players[p]!.name)}: ${label}</button>`).join(' ');
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
        <button data-btn="doneplancancel">Go back</button>
        <button class="primary" data-btn="doneplanconfirm" data-p="${p}">Really done</button>${err}</div>`;
    }
    return `<div class="promptbar"><span class="who">Planning</span>
      Click a hand card to recycle it into a resource; click dormant resources to activate (max 2). ${doneRow(s.planningDone, 'doneplan', 'done planning')}${err}</div>`;
  }
  if (s.phase === 'battle') {
    const b = s.battle!;
    if (b.step === 'declare') {
      return `<div class="promptbar"><span class="who">${esc(s.players[b.attacker]!.name)}:</span> build your attack
        <button data-btn="attackall" title="every eligible unit joins, one per column — adjust before confirming">⚔ Attack with everything</button>
        <button class="primary" data-btn="confirmattack" ${ui.columns.some(c => c.length) ? '' : 'disabled'}>Attack!</button>
        <button data-btn="skipattack">Don't attack</button>${err}</div>`;
    }
    if (b.step === 'blocks') {
      return `<div class="promptbar"><span class="who">${esc(s.players[b.defender]!.name)}:</span>
        assign blockers (click unit, then slot)${b.round === 1 ? ' and optionally send counterattackers' : ''}
        <button class="primary" data-btn="confirmblocks">Confirm</button>${err}</div>`;
    }
    if (ui.modding) {
      return `<div class="promptbar pending"><span class="who">${esc(s.players[ui.modding.seat]!.name)}:</span>
        pick a host unit for ${esc(s.players[ui.modding.seat]![ui.modding.from][ui.modding.index] ?? '?')}
        <button data-btn="modcancel">cancel</button>${err}</div>`;
    }
    if (ui.confirmPass !== null) {
      // C5: passing away castable spell tokens wants a second look
      const n = castableTokenCount(s.priority!);
      return `<div class="promptbar pending"><span class="who">${esc(s.players[s.priority!]!.name)}:</span>
        you still have <b>${n} castable spell token${n === 1 ? '' : 's'}</b> — pass anyway?
        <button data-btn="passcancel">Go back</button>
        <button class="primary" data-btn="passconfirm">Pass anyway</button>${err}</div>`;
    }
    return `<div class="promptbar"><span class="who">${esc(s.players[s.priority!]!.name)}:</span>
      you have priority — play a battle card / cast a token / virus-augment, or
      <button class="primary" data-btn="pass">Pass</button>
      ${NET ? `<button data-btn="passall" title="keep passing until the battle ends or something new is played">Pass all</button>` : ''}
      <span style="color:var(--dim)">(both pass: ${s.stack.length ? 'resolve top of stack' : `move to ${nextBattleStepName()}`})</span>${err}</div>`;
  }
  if (s.phase === 'deploy') {
    if (ui.modding) {
      return `<div class="promptbar pending"><span class="who">${esc(s.players[ui.modding.seat]!.name)}:</span>
        pick a host unit to ${ui.modding.mode} with ${esc(s.players[ui.modding.seat]![ui.modding.from][ui.modding.index] ?? '?')}
        <button data-btn="modcancel">cancel</button>${err}</div>`;
    }
    const dd = s.deployDone ?? s.players.map(() => true);
    return `<div class="promptbar"><span class="who">Deployment</span>
      both players deploy at the same time — moves stay hidden until everyone is done.
      Play cards, mod units (augment/graft from hand or bin), activate abilities.
      ${doneRow(dd, 'donedeploy', 'done deploying')}${err}</div>`;
  }
  return `<div class="promptbar">${esc(s.phase)}${err}</div>`;
}

function stackHtml(): string {
  const items = [...h.state.stack].reverse().map(it => {
    const targets = it.parts.flatMap(p => p.targets).map(tgtLabel).join(', ');
    return `<div class="stackitem ${it.negated ? 'negated' : ''} ${isCandidate({ stack: it.id }) ? 'candidate' : ''}"
      data-act="stackitem" data-id="${it.id}" ${it.card ? `data-prev="${esc(it.card)}"` : ''}>
      ${it.card ? `<img class="stackthumb" src="${art(it.card)}" alt="" onerror="this.style.display='none'">` : ''}
      <div class="stackmain">${esc(it.label)}
      <div class="by">${esc(h.state.players[it.controller]!.name)} · ${it.kind}${it.parts.length > 1 ? ` · ${it.parts.length} grafted parts` : ''}${targets ? ' → ' + targets : ''}</div></div>
    </div>`;
  }).join('');
  return `<div class="stackpanel"><h3>Stack (top first)</h3>${items || '<div class="stackempty">empty</div>'}</div>`;
}
function tgtLabel(t: TargetRef): string {
  if ('unit' in t) return esc(h.state.entities[t.unit]?.card ?? 'gone');
  if ('player' in t) return esc(h.state.players[t.player]!.name);
  return esc(h.state.stack.find(i => i.id === t.stack)?.label ?? 'gone');
}

function menuHtml(): string {
  if (!ui.menu) return '';
  const items = ui.menu.items.map((it, i) =>
    `<button data-btn="menuitem" data-i="${i}">${it.icon ? elIcon(it.icon) : ''}${esc(it.label)}</button>`).join('');
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
    <div class="drafthead"><span class="who">${esc(s.players[seat]!.name)} — draft step</span>
      Click cards to move them between hand and pack. Leave exactly ${need} in the pack.
      <button class="primary" data-btn="draftcommit" data-p="${seat}" ${ok ? '' : 'disabled'}>
        Keep ${handIdx.length} · pass the pack</button>
      ${ok ? '' : `<span style="color:var(--bad)">pack has ${packIdx.length}/${need}</span>`}</div>
    <div class="zonelabel">Your hand after drafting (${handIdx.length})</div>
    <div class="zone draftkeep">${cardRow(handIdx)}</div>
    <div class="zonelabel">Left in the pack — passes to your opponent (${packIdx.length}/${need})</div>
    <div class="zone draftleave">${cardRow(packIdx)}</div>
  </div>`;
}

function render(): void {
  if (NET && (NET.dead || !NET.joined)) { if (!NET.dead) renderConnecting(); return; }
  $app.classList.toggle('netmode', !!NET);   // net mode: sticky hand dock at the bottom
  ensureDraftUi();
  const logItems = h.log.slice(-80).map(l => `<div>${esc(l)}</div>`).join('');
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
        ${ui.autopass ? '<button class="passallchip" data-btn="passallstop" title="click to stop passing">auto-passing… ✕ stop</button>' : ''}
        ${NET ? `<button data-btn="autopasstoggle" class="aptoggle ${autoPref ? 'on' : ''}"
          title="when ON: automatically pass whenever passing is your only legal action">auto-pass: ${autoPref ? 'on' : 'off'}</button>` : ''}
        <button data-btn="helpopen" title="rules reference: phases + keywords" style="margin-left:auto">? rules</button>
        <button data-btn="judgeopen" title="ask the rules judge bot">⚖ judge</button>
        ${canUndo ? '<button data-btn="undo" title="undo your last action (Ctrl+Z)">↶ undo</button>' : ''}
        ${NET ? '' : '<button data-btn="restart">New game</button>'}
      </div>
      ${shareBannerHtml()}
      ${promptHtml()}
      ${draftPanelHtml()}
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
    ${helpOpen ? helpOverlayHtml() : ''}
    ${inspectorHtml()}
    ${judgeOpen ? judgeOverlayHtml() : ''}
    ${pendingReveal ? revealOverlayHtml() : ''}`;
  const log = document.getElementById('log')!;
  log.scrollTop = log.scrollHeight;
  clampMenu();
  maybeAutopass();
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
    <button class="primary" data-btn="revealdone">Continue</button>
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

/** Home screen (docs/07 §2): new game / join / hotseat / practice. */
function renderHome(): void {
  const name = localStorage.getItem('algoName') ?? '';
  $app.innerHTML = `<div class="joinscreen home">
    <h1 class="homelogo">ALGOMANCY</h1>
    <label class="namerow">Your name <input id="h-name" maxlength="24" value="${esc(name)}" placeholder="(optional)"></label>
    <div class="homebtns">
      <div class="elpicker">
        <div class="zonelabel">Live draft — pick exactly 3 elements</div>
        <div class="elrow">${(['fire', 'water', 'earth', 'wood', 'metal'] as const).map(el =>
          `<button class="elchip ${el} ${ui.homeEls.includes(el) ? 'on' : ''}" data-btn="eltoggle" data-el="${el}">${elIcon(el)}${el}</button>`).join('')}
          <button data-btn="elrandom" title="pick a random trio">🎲</button>
        </div>
        <button class="primary" data-btn="newgame" data-mode="draft" ${ui.homeEls.length === 3 ? '' : 'disabled'}>
          New live draft${ui.homeEls.length === 3 ? ` · ${ui.homeEls.join(' + ')}` : ` (${ui.homeEls.length}/3 picked)`}</button>
      </div>
      <button data-btn="newgame" data-mode="shared">New constructed game</button>
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
}

const saveHomeName = (): void => {
  const inp = document.getElementById('h-name') as HTMLInputElement | null;
  if (inp) localStorage.setItem('algoName', inp.value.trim());
};

// ── interaction ───────────────────────────────────────────────────────
/** the focus viewer for a live unit: composed modded card (base art + each
 * mod's text strip, like the physical slide-under), live vs base stats,
 * counters, damage, attrs — the Discord bot's combine, in HTML */
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
    return `<div class="modstrip"><img src="${art(m.card)}" alt="">
      <span class="modtag">${m.appliedAs === 'graft' ? '⑂ grafted' : '+ augment'} · ${esc(m.card)}</span></div>
      <div class="hint modtext">${esc(mtext)}</div>`;
  }).join('');
  const changed = p !== base[0] || t !== base[1];
  const bits = [
    `<b class="${changed ? (p + t >= base[0] + base[1] ? 'statup' : 'statdown') : ''}">${p}/${t}</b>${changed ? ` <span class="basestat">base ${base[0]}/${base[1]}</span>` : ''}`,
    u.counters ? `${u.counters > 0 ? '+' : ''}${u.counters}/${u.counters > 0 ? '+' : ''}${u.counters} counters` : '',
    u.damage ? `${u.damage} damage` : '',
  ].filter(Boolean).join(' · ');
  const attrs = [...e.ownAttrs(u)].join(' · ');
  return `<img src="${art(u.card)}" alt="" onerror="this.style.display='none'">${modStrips}
    <div class="prevstats">${bits}</div>
    ${attrs ? `<div class="hint">${esc(attrs)}</div>` : ''}
    <div class="hint">${esc(text)}</div>`;
}

document.addEventListener('mouseover', e => {
  const t = (e.target as HTMLElement).closest('[data-prev], [data-previd]') as HTMLElement | null;
  if (!t) return;
  const prev = document.getElementById('preview');
  if (!prev) return;
  if (t.dataset['previd']) {
    const html = previewEntityHtml(Number(t.dataset['previd']));
    if (html) { prev.innerHTML = html; return; }
  }
  const name = t.dataset['prev']!;
  let text = '';
  try { text = getCard(name).text; } catch { /* unknown card */ }
  prev.innerHTML = `<img src="${art(name)}" alt="" onerror="this.style.display='none'"><div class="hint">${esc(text)}</div>`;
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
    const all = ['fire', 'water', 'earth', 'wood', 'metal'];
    ui.homeEls = [];
    while (ui.homeEls.length < 3) {
      const pick = all[Math.floor(Math.random() * all.length)]!;
      if (!ui.homeEls.includes(pick)) ui.homeEls.push(pick);
    }
    localStorage.setItem('algoEls', JSON.stringify(ui.homeEls));
    renderHome();
    return;
  }
  if (b === 'newgame') {
    saveHomeName();
    const mode = btn.dataset['mode'] === 'draft' ? 'draft' : 'shared';
    const els = mode === 'draft' && ui.homeEls.length === 3
      ? `&els=${encodeURIComponent(ui.homeEls.join(','))}` : '';
    fetch('/api/new').then(r => r.json()).then((r: { code: string }) => {
      location.search = `?ws=1&room=${encodeURIComponent(r.code)}&seat=0&mode=${mode}${els}`;
    }).catch(() => { uiError = 'could not reach the server'; renderHome(); });
    return;
  }
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
  if (b === 'restart' && !NET) { h = new Harness(Math.floor(Math.random() * 1e6), undefined, h.state.mode); resetUi(); uiError = ''; }
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
    const legal = legalFor(p).filter(a => (a.type === 'augment' || a.type === 'graft') && a.from === 'bin' && a.index === i);
    if (legal.length) binView = null;   // close the bin dialog so the host pick is visible
    startModding(p, 'bin', i, legal, e);
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
  const items: { label: string; go: () => void }[] = [];
  for (const a of playActions) {
    const label = a.type === 'playCard' && a.mode === 'ambush' ? `Ambush with ${name}` : `Play ${name}`;
    items.push({ label, go: () => { act(a); render(); } });
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

function startModding(p: Seat, from: 'hand' | 'bin', i: number, legal: Action[], e: MouseEvent): void {
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
  ui.menu = {
    x: me.clientX, y: me.clientY,
    items: [
      { label: `📖 ${name} — details, attributes & rulings`, go: () => openInspector(name, id) },
      { label: `⚖ Ask the judge about ${name}`, go: () => {
          judgeOpen = true;
          judgeDraft = `I have a question about ${name}. `;
          render();
        } },
    ],
  };
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
  renderConnecting();
} else if (params.has('hotseat')) {
  if (params.get('mode') === 'draft') {
    const hotEls = params.get('els')?.split(',').map(s => s.trim()).filter(Boolean) as import('../src/types.ts').Element[] | undefined;
    h = new Harness(Math.floor(Math.random() * 1e6), undefined, 'draft', hotEls);
  }
  render();
} else if (params.has('demo')) {
  demoBattle();
  render();
} else {
  renderHome();
}
