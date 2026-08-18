/* Hotseat UI over the pure engine — a dumb terminal (docs/04 §7).
 * Full re-render after every action; all game mutation goes through
 * Harness.do(action); pending decisions render as highlights or a prompt.
 * Both hands are visible: this is the M1 test rig, not the product. */
import { Harness } from '../src/harness.ts';
import { legalActions, IllegalAction } from '../src/apply.ts';
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
  legal: Action[] = [];
  peers: [boolean, boolean] = [false, false];
  joined = false;
  ws: WebSocket;
  constructor(room: string, seat: Seat | null) {
    if (seat != null) this.seat = seat;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);
    this.ws.onopen = () => this.ws.send(JSON.stringify({ t: 'join', room, seat }));
    this.ws.onmessage = ev => this.onMsg(JSON.parse(String(ev.data)));
    this.ws.onclose = () => { uiError = 'disconnected from server — refresh to reconnect'; if (this.joined) render(); };
  }
  do(a: Action): void { this.ws.send(JSON.stringify({ t: 'action', action: a })); }
  private onMsg(m: {
    t: string; seat?: Seat; view?: GameState; log?: string[]; legal?: Action[];
    events?: { msg: string }[]; peers?: [boolean, boolean]; msg?: string;
  }): void {
    if (m.t === 'joined') {
      this.joined = true; this.seat = m.seat!; this.state = m.view!;
      this.log = m.log ?? []; this.legal = m.legal ?? []; this.peers = m.peers ?? [false, false];
      resetUi(); uiError = ''; render(); return;
    }
    if (m.t === 'update') {
      if (m.view) this.state = m.view;
      if (m.events) for (const e of m.events) this.log.push(e.msg);
      if (m.legal) this.legal = m.legal;
      if (m.peers) this.peers = m.peers;
      render(); return;
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
  modding: { from: 'hand' | 'bin'; index: number; seat: Seat; mode: 'augment' | 'graft' } | null;
  menu: { x: number; y: number; items: { label: string; go: () => void }[] } | null;
  orderPicked: number[];
}
let ui: UiState = { carrying: null, columns: [], send: [], modding: null, menu: null, orderPicked: [] };
const resetUi = () => { ui = { carrying: null, columns: [], send: [], modding: null, menu: null, orderPicked: [] }; };

const $app = document.getElementById('app')!;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const art = (name: string) => ART + name.replace(/ /g, '-') + '.jpg';
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

// ── rendering ─────────────────────────────────────────────────────────
function cardHtml(name: string, opts: {
  playable?: boolean; candidate?: boolean; selected?: boolean; carrying?: boolean;
  badges?: { t: string; mod?: boolean }[]; stats?: string; dmg?: string; data?: string;
} = {}): string {
  const cls = ['card'];
  if (opts.playable) cls.push('playable');
  if (opts.candidate) cls.push('candidate');
  if (opts.selected) cls.push('selected');
  if (opts.carrying) cls.push('carrying');
  const badges = (opts.badges ?? []).map(b => `<span class="badge ${b.mod ? 'mod' : ''}">${esc(b.t)}</span>`).join('');
  return `<div class="${cls.join(' ')}" ${opts.data ?? ''} data-prev="${esc(name)}">
    <img src="${art(name)}" alt="${esc(name)}">
    ${badges ? `<div class="badges">${badges}</div>` : ''}
    ${opts.stats ? `<div class="stats">${opts.stats}</div>` : ''}
    ${opts.dmg ? `<div class="dmg">${opts.dmg}</div>` : ''}
  </div>`;
}

/** a face-down card back (opponent's hidden hand in network mode) */
function backHtml(): string {
  return `<div class="card back" title="hidden card"></div>`;
}

function unitHtml(u: Entity, opts: { selected?: boolean; clickable?: boolean } = {}): string {
  const [p, t] = q().effStats(u);
  const badges: { t: string; mod?: boolean }[] = [...q().ownAttrs(u)].map(a => ({ t: a }));
  for (const modId of u.mods) {
    const m = h.state.entities[modId];
    if (m) badges.push({ t: (m.appliedAs === 'graft' ? '⑂' : '+') + m.card.split(' ')[0], mod: true });
  }
  if (u.absent) badges.push({ t: 'sent', mod: true });
  return cardHtml(u.card, {
    stats: `${p}/${t}`, dmg: u.damage ? `−${u.damage}` : '', badges,
    candidate: isCandidate({ unit: u.id }),
    selected: opts.selected, carrying: ui.carrying === u.id,
    playable: opts.clickable,
    data: `data-act="unit" data-id="${u.id}"`,
  });
}

function resHtml(r: { kind: string; state: string }, p: Seat, i: number): string {
  const canact = legalFor(p).some(a =>
    (a.type === 'activateResource' || a.type === 'exchangePrismite') && a.index === i);
  return `<span class="res ${r.kind} ${r.state} ${canact ? 'canact' : ''}" title="${r.kind} (${r.state})"
    data-act="res" data-p="${p}" data-i="${i}"></span>`;
}

function playerHtml(p: Seat): string {
  const pl = h.state.players[p]!;
  const legal = legalFor(p);
  const acting = legal.length > 0;
  const e = q();
  const inFormation = new Set<EntityId>();
  const b = h.state.battle;
  if (b) {
    for (const col of b.columns) col.forEach(id => inFormation.add(id));
    for (const col of Object.values(b.blocks)) col.forEach(id => inFormation.add(id));
  }
  for (const col of ui.columns) col.forEach(id => inFormation.add(id));
  const units = Object.values(h.state.entities)
    .filter(en => en.kind === 'unit' && en.controller === p && !inFormation.has(en.id));
  const tokens = e.tokensOf(p);
  const canDeclareHere = !!b && ((b.step === 'declare' && b.attacker === p) || (b.step === 'blocks' && b.defender === p))
    && (!NET || p === NET.seat);   // in network mode I only build MY own formations

  const handCards = pl.hand.map((n, i) => {
    if (n === HIDDEN_CARD) return backHtml();   // opponent's hidden hand (network mode)
    const playable = legal.some(a =>
      (a.type === 'playCard' && a.handIndex === i) ||
      (a.type === 'augment' && a.from === 'hand' && a.index === i) ||
      (a.type === 'graft' && a.from === 'hand' && a.index === i) ||
      (h.state.phase === 'planning' && a.type === 'recycleForResource' && a.handIndex === i));
    return cardHtml(n, { playable, data: `data-act="hand" data-p="${p}" data-i="${i}"` });
  }).join('');
  const binItems = pl.bin.map((n, i) => {
    const usable = legal.some(a => (a.type === 'augment' || a.type === 'graft') && a.from === 'bin' && a.index === i);
    return `<span class="badge ${usable ? 'mod' : ''}" style="cursor:${usable ? 'pointer' : 'default'}"
      data-act="bin" data-p="${p}" data-i="${i}" data-prev="${esc(n)}">${esc(n)}</span>`;
  }).join(' ');

  return `<div class="player ${acting ? '' : 'inactive'}">
    <div class="pheader">
      <span class="pname">${esc(pl.name)}${h.state.initiative === p ? ' ⭐' : ''}</span>
      <span class="life ${isCandidate({ player: p }) ? 'candidate' : ''}" data-act="player" data-p="${p}">♥ ${pl.life}</span>
      <span class="resrow">${pl.resources.map((r, i) => resHtml(r, p, i)).join('')}
        <span style="color:var(--dim)">(${e.openMana(p)} mana open${h.state.phase === 'planning' ? `, ${pl.activationsLeft} activations` : ''})</span>
      </span>
      <span class="binline">deck ${h.state.sharedDeck.length} · bin ${pl.bin.length}</span>
    </div>
    <div class="zonelabel">In play — region of ${esc(pl.name)}</div>
    <div class="zone">${units.map(u => unitHtml(u, { clickable: canDeclareHere && u.controller === p })).join('')
    }${tokens.map(t => cardHtml(t.card, {
      stats: 'X=' + t.x,
      playable: legal.some(a => a.type === 'castSpellToken' && a.entityId === t.id),
      data: `data-act="token" data-id="${t.id}"`,
    })).join('')}</div>
    <div class="zonelabel">Hand (${pl.hand.length})</div>
    <div class="zone">${handCards}</div>
    ${pl.bin.length ? `<div class="zonelabel">Bin</div><div class="zone">${binItems}</div>` : ''}
  </div>`;
}

function battleHtml(): string {
  const b = h.state.battle;
  if (!b) return '';
  const A = h.state.players[b.attacker]!.name, D = h.state.players[b.defender]!.name;

  if (b.step === 'declare') {
    const cols = ui.columns.map((col, ci) => colBuilderHtml(col, ci)).join('');
    const extra = colBuilderHtml([], ui.columns.length);
    return `<div class="battle"><h3>⚔ ${esc(A)} declares an attack — round ${b.round}${b.attackerPool ? ' (sent units only)' : ''}</h3>
      <div style="color:var(--dim);margin-bottom:6px">Click one of your units, then a slot. Front row first, 2 max per column.</div>
      <div class="cols">${cols}${extra}</div></div>`;
  }

  const attackCols = b.columns.map((col, ci) => {
    const blockers = b.blocks[ci] ?? [];
    const blockBuild = (b.step === 'blocks') ? blockBuilderHtml(ci) :
      blockers.map(id => h.state.entities[id] ? unitHtml(h.state.entities[id]!) : '').join('');
    return `<div class="col"><div class="collabel">column ${ci + 1}</div>
      ${col.map(id => h.state.entities[id] ? unitHtml(h.state.entities[id]!) : '').join('') || '<div class="slot">gone</div>'}
      <div class="vs" style="width:100%"></div>
      ${blockBuild || '<div class="slot">unblocked</div>'}
    </div>`;
  }).join('');
  const sendZone = (b.step === 'blocks' && b.round === 1)
    ? `<div class="col"><div class="collabel">send to counterattack</div>
        ${ui.send.map(id => h.state.entities[id] ? unitHtml(h.state.entities[id]!, { selected: true }) : '').join('')}
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
    if (dec.kind === 'targets') {
      return `<div class="promptbar pending"><span class="who">${who}:</span>
        ${esc(dec.prompt)} — click a highlighted target${err}</div>`;
    }
    if (dec.kind === 'orderTriggers') {
      const btns = dec.options.map((o, i) => ui.orderPicked.includes(i)
        ? `<span style="color:var(--dim)">${ui.orderPicked.indexOf(i) + 1}. ${esc(o.label)}</span>`
        : `<button data-btn="orderpick" data-i="${i}">${esc(o.label)}</button>`).join(' ');
      return `<div class="promptbar pending"><span class="who">${who}:</span>
        ${esc(dec.prompt)} — ${btns}${err}</div>`;
    }
    // payOrDecline / electricPath: plain option buttons
    const btns = dec.options.map((o, i) => `<button data-btn="decide" data-i="${i}">${esc(o.label)}</button>`).join(' ');
    return `<div class="promptbar pending"><span class="who">${who}:</span> ${esc(dec.prompt)} ${btns}${err}</div>`;
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
      (s.phase === 'deploy') ? s.deployPlayer === seat : false;
    if (!mine) {
      const note = NET.peers[other(seat)] ? '' : ' <span style="color:var(--dim)">(opponent not connected yet)</span>';
      return `<div class="promptbar"><span class="who">Waiting for opponent…</span>${note}${err}</div>`;
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
  if (s.phase === 'planning') {
    return `<div class="promptbar"><span class="who">Planning</span>
      Click a hand card to recycle it into a resource; click dormant resources to activate (max 2). ${doneRow(s.planningDone, 'doneplan', 'done planning')}${err}</div>`;
  }
  if (s.phase === 'battle') {
    const b = s.battle!;
    if (b.step === 'declare') {
      return `<div class="promptbar"><span class="who">${esc(s.players[b.attacker]!.name)}:</span> build your attack
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
    return `<div class="promptbar"><span class="who">${esc(s.players[s.priority!]!.name)}:</span>
      you have priority — play a battle card / cast a token / virus-augment, or
      <button class="primary" data-btn="pass">Pass</button>
      <span style="color:var(--dim)">(both pass: ${s.stack.length ? 'resolve top of stack' : 'next step'})</span>${err}</div>`;
  }
  if (s.phase === 'deploy') {
    if (ui.modding) {
      return `<div class="promptbar pending"><span class="who">${esc(s.players[ui.modding.seat]!.name)}:</span>
        pick a host unit to ${ui.modding.mode} with ${esc(s.players[ui.modding.seat]![ui.modding.from][ui.modding.index] ?? '?')}
        <button data-btn="modcancel">cancel</button>${err}</div>`;
    }
    return `<div class="promptbar"><span class="who">${esc(s.players[s.deployPlayer!]!.name)} deploying:</span>
      play cards, mod units (augment/graft from hand or bin), activate abilities
      <button class="primary" data-btn="donedeploy">Done deploying</button>${err}</div>`;
  }
  return `<div class="promptbar">${esc(s.phase)}${err}</div>`;
}

function stackHtml(): string {
  const items = [...h.state.stack].reverse().map(it => {
    const targets = it.parts.flatMap(p => p.targets).map(tgtLabel).join(', ');
    return `<div class="stackitem ${it.negated ? 'negated' : ''} ${isCandidate({ stack: it.id }) ? 'candidate' : ''}"
      data-act="stackitem" data-id="${it.id}">
      ${esc(it.label)}
      <div class="by">${esc(h.state.players[it.controller]!.name)} · ${it.kind}${it.parts.length > 1 ? ` · ${it.parts.length} grafted parts` : ''}${targets ? ' → ' + targets : ''}</div>
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
  const items = ui.menu.items.map((it, i) => `<button data-btn="menuitem" data-i="${i}">${esc(it.label)}</button>`).join('');
  return `<div class="menu" style="left:${ui.menu.x}px;top:${ui.menu.y}px">${items}<button data-btn="menuclose">cancel</button></div>`;
}

function render(): void {
  if (NET && !NET.joined) { renderConnecting(); return; }
  const logItems = h.log.slice(-80).map(l => `<div>${esc(l)}</div>`).join('');
  // in network mode keep MY seat at the bottom (opponent on top)
  const topSeat: Seat = NET ? other(NET.seat) : 1;
  const botSeat: Seat = NET ? NET.seat : 0;
  const netTag = NET ? `<span class="init">you are ${esc(h.state.players[NET.seat]!.name)} (seat ${NET.seat})</span>` : '';
  $app.innerHTML = `
    <div class="main">
      <div class="topbar">
        <span>Turn ${h.state.turn}</span>
        <span class="phase">${h.state.phase}${h.state.battle ? ' · round ' + h.state.battleRound : ''}</span>
        <span class="init">initiative: ${esc(h.state.players[h.state.initiative]!.name)} ⭐</span>
        ${netTag}
        ${NET ? '' : '<button data-btn="restart" style="margin-left:auto">New game</button>'}
      </div>
      ${promptHtml()}
      ${playerHtml(topSeat)}
      ${battleHtml()}
      ${playerHtml(botSeat)}
    </div>
    <div class="side">
      <div class="preview" id="preview"><div class="hint">hover a card to preview</div></div>
      ${stackHtml()}
      <div class="logpanel" id="log"><h3>Game log</h3>${logItems}</div>
    </div>
    ${menuHtml()}`;
  const log = document.getElementById('log')!;
  log.scrollTop = log.scrollHeight;
}

function renderConnecting(): void {
  $app.innerHTML = `<div class="joinscreen"><h2>Algomancy</h2>
    <p>${uiError ? esc(uiError) : 'Connecting to the server…'}</p></div>`;
}

/** tiny join screen (?ws=1 with no room) */
function renderJoin(): void {
  $app.innerHTML = `<div class="joinscreen">
    <h2>Algomancy — join a game</h2>
    <label>Room code <input id="j-room" value="ROOM" autocapitalize="characters"></label>
    <div class="seats">Seat:
      <label><input type="radio" name="j-seat" value=""checked> auto</label>
      <label><input type="radio" name="j-seat" value="0"> 0</label>
      <label><input type="radio" name="j-seat" value="1"> 1</label>
    </div>
    <button data-btn="joingame">Join</button>
    <p class="hint">Share the same room code with your opponent; each of you takes a seat.</p>
  </div>`;
}

// ── interaction ───────────────────────────────────────────────────────
document.addEventListener('mouseover', e => {
  const t = (e.target as HTMLElement).closest('[data-prev]') as HTMLElement | null;
  if (!t) return;
  const prev = document.getElementById('preview');
  if (prev) {
    const name = t.dataset['prev']!;
    let text = '';
    try { text = getCard(name).text; } catch { /* unknown card */ }
    prev.innerHTML = `<img src="${art(name)}" alt=""><div class="hint">${esc(text)}</div>`;
  }
});

document.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest('[data-btn]') as HTMLElement | null;
  if (btn) { handleButton(btn); return; }
  const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!t) { ui.menu = null; render(); return; }
  handleAction(t, e as MouseEvent);
});

function handleButton(btn: HTMLElement): void {
  const b = btn.dataset['btn'];
  if (b === 'joingame') {
    const room = (document.getElementById('j-room') as HTMLInputElement).value.trim().toUpperCase() || 'ROOM';
    const seat = (document.querySelector('input[name="j-seat"]:checked') as HTMLInputElement).value;
    location.search = `?ws=1&room=${encodeURIComponent(room)}${seat ? `&seat=${seat}` : ''}`;
    return;
  }
  const s = h.state;
  if (b === 'restart' && !NET) { h = new Harness(Math.floor(Math.random() * 1e6)); resetUi(); uiError = ''; }
  if (b === 'doneplan') act({ type: 'donePlanning', seat: Number(btn.dataset['p']) });
  if (b === 'donehaste') act({ type: 'doneHaste', seat: Number(btn.dataset['p']) });
  if (b === 'pass') act({ type: 'passPriority', seat: s.priority! });
  if (b === 'donedeploy') act({ type: 'doneDeploying', seat: s.deployPlayer! });
  if (b === 'skipattack') { act({ type: 'declareAttack', seat: s.battle!.attacker, columns: [] }); ui.columns = []; ui.carrying = null; }
  if (b === 'confirmattack') {
    const cols = ui.columns.filter(c => c.length);
    act({ type: 'declareAttack', seat: s.battle!.attacker, columns: cols });
    if (!uiError) { ui.columns = []; ui.carrying = null; }
  }
  if (b === 'confirmblocks') {
    const blocks: Record<number, EntityId[]> = {};
    ui.columns.forEach((col, ci) => { if (col && col.length) blocks[ci] = col; });
    act({ type: 'declareBlocks', seat: s.battle!.defender, blocks, send: ui.send });
    if (!uiError) { ui.columns = []; ui.send = []; ui.carrying = null; }
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
  if (b === 'modcancel') ui.modding = null;
  if (b === 'menuitem') { const it = ui.menu!.items[Number(btn.dataset['i'])]!; ui.menu = null; it.go(); }
  if (b === 'menuclose') ui.menu = null;
  render();
}

function handleAction(t: HTMLElement, e: MouseEvent): void {
  const kind = t.dataset['act'];
  const s = h.state;

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
    if (tok && (!NET || tok.controller === NET.seat)) act({ type: 'castSpellToken', seat: tok.controller, entityId: tok.id });
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
    startModding(p, 'bin', i, legal, e);
  }
  render();
}

function handleHandClick(p: Seat, i: number, e: MouseEvent): void {
  if (NET && p !== NET.seat) return;   // can't act from the opponent's hand
  const s = h.state;
  const name = s.players[p]!.hand[i];
  if (!name || name === HIDDEN_CARD || s.decision) return;

  if (s.phase === 'planning' && !s.planningDone[p]) {
    ui.menu = {
      x: e.clientX, y: e.clientY,
      items: (['fire', 'water', 'earth', 'wood', 'metal'] as const).map(el => ({
        label: `Recycle → ${el} resource`,
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
  h.do({ type: 'declareAttack', seat: A, columns: [[whale.id], [sky.id]] });
  h.do({ type: 'passPriority', seat: A });
  h.state.players[D]!.hand.push('Jelly');
  h.do({ type: 'playCard', seat: D, handIndex: h.state.players[D]!.hand.length - 1 });
  const dec = h.state.decision!;
  const idx = dec.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ unit: whale.id }));
  h.do({ type: 'decide', seat: dec.seat, choice: idx });
}

// ── bootstrap: hotseat by default, network mode via ?ws=1 / ?room=… ─────
const params = new URLSearchParams(location.search);
if (params.get('ws') === '1' || params.has('room')) {
  const room = (params.get('room') ?? '').toUpperCase().trim();
  if (!room) {
    renderJoin();   // tiny join screen: ask for a room code + seat
  } else {
    const sp = params.get('seat');
    const seat: Seat | null = sp === '0' ? 0 : sp === '1' ? 1 : null;
    NET = new NetBackend(room, seat);
    h = NET;
    renderConnecting();
  }
} else {
  if (params.has('demo')) demoBattle();
  render();
}
