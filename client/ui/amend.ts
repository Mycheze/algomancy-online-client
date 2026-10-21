/* BL-46 — "BETA: PROPOSE A FIX". The dialog, and the bar the other seat answers on.
 *
 * The owner, 2026-10-16: *"Assuming both players agree, it doesn't change
 * anything in the game. it'll only be used to solve broken engine/game
 * issues. For example, Debeli lost a game yesterday since their card draw
 * didn't trigger (twice) and the game would have been 100% normal if they
 * could have just given themselves a card."*
 *
 * One seat proposes (this dialog, from "🛠 Beta: propose a fix" in the table
 * menu or "🛠 Propose: move this card" in a card's), the other agrees or
 * declines on a bar across the top of the board, and the server carries it out
 * (server/rooms.ts proposeFix / answerFix, server/main.ts carryOutFix). Nothing
 * here touches the game: the client proposes, and the server decides.
 *
 * A LAYER, the way ui/report.ts is: appended beside `#app`, its own clicks
 * (`data-amend`, never `data-btn`), its own Escape, its own scrim — so a board
 * repaint cannot touch a half-typed reason, and the overlay census (269) and
 * the layer-keys census (457) see it as what it is. main.ts's `overlaysUp`
 * asks `isAmendOpen()`, so no game hotkey reaches through the dialog.
 *
 * The fixes on offer are the owner's v1 list: either seat's life, either seat
 * draws N, one of YOUR cards between hand / bin / cache / deck top / deck
 * bottom, a unit off the board, and a rewind (up to five actions, or back to
 * the start of this step or the one before). Nothing names a card in the
 * opponent's hidden zones; a fix about your own hidden card shows it to them.
 */
import { esc } from './util.ts';
import type { AmendDest, AmendEdit, AmendSource, AmendUnitDest, EntityId, GameState, Seat } from '../engine/src/types.ts';

/** the open proposal as the server shows it (server/rooms.ts ProposalView) */
export interface ProposalView {
  id: number; seat: Seat; kind: 'edit' | 'rewind'; what: string; reason: string;
  /** ms left to answer, when it was sent */
  left: number;
}
/** what every push of a room that takes fixes carries (server/rooms.ts fixInfo) */
export interface FixInfo { proposal?: ProposalView; cooldown?: number }
/** a rewind on offer (server/rooms.ts RewindOption): where it goes back to,
 * and what it takes back, both in this seat's words (CT-323) */
export interface RewindOption { to: number; label: string; takes?: string | null }

/** what the dialog may preselect when it is opened from a card's menu */
export type FixPreset =
  | { kind: 'move'; from: AmendSource; index: number }
  | { kind: 'unit'; id: EntityId };

export interface AmendCtx {
  /** put a `{ t: 'amend', … }` message on the wire */
  send(msg: Record<string, unknown>): void;
  /** the board this seat is looking at, or null when there is no game */
  view(): { state: GameState; seat: Seat; names: [string, string] } | null;
  /** the dialog opened or closed — main.ts holds the standing auto-pass */
  openChanged(open: boolean): void;
  /** the proposal appeared or went — main.ts re-plans its auto-pass */
  proposalChanged(): void;
  /** CT-323: this seat's own play is still being aimed (a pre-commit cast) —
   * Escape takes that back alone, no fix needed (#243, #254) */
  castPending?(): boolean;
}

type Kind = 'life' | 'drawCards' | 'move' | 'unit' | 'rewind';
const KINDS: readonly [Kind, string, string][] = [
  ['life', 'Life', "set either player's life total"],
  ['drawCards', 'Draw', 'either player draws cards'],
  ['move', 'Move a card', 'one of your cards between hand, bin, cache and the deck'],
  ['unit', 'Unit off the board', 'take a unit off the board, quietly'],
  ['rewind', 'Rewind', 'go back to before a recent action, or to the start of a step'],
];
const DESTS: readonly [AmendDest, string][] = [
  ['hand', 'your hand'], ['bin', 'your bin'], ['cache', 'your cache'],
  ['deckTop', 'the top of the deck'], ['deckBottom', 'the bottom of the deck'],
];
const UNIT_DESTS: readonly [AmendUnitDest, string][] = [
  ['hand', 'its controller’s hand'], ['bin', 'its controller’s bin'], ['deckBottom', 'the bottom of the deck'],
];

// ── state ──────────────────────────────────────────────────────────────
let ctx: AmendCtx | null = null;
let layer: HTMLElement | null = null;
/** null: this room takes no fixes (a scenario, test mode, no game, over) */
let info: FixInfo | null = null;
/** when the open proposal lapses, in this page's clock */
let deadline = 0;
let open = false;
let kind: Kind = 'life';
let reason = '';
let error = '';
let busy = false;
/** the field values, per kind — module state so a repaint keeps them */
let lifeTarget: Seat = 0;
let lifeValue = '';
let drawTarget: Seat = 0;
let drawN = '1';
let moveCard = '';        // "hand:3"
let moveTo: AmendDest = 'bin';
let unitId = '';
let unitTo: AmendUnitDest = 'hand';
let rewindTo: number | null = null;
/** the server's answer to `options`: null until it arrives */
let rewinds: RewindOption[] | null = null;
let editWhy: string | null = null;
let optionsWhy: string | null = null;
let toast: string | null = null;
let toastTimer = 0;
let tick = 0;

export const isAmendOpen = (): boolean => open;
/** does this room take fixes at all? (the menu entries are drawn from it) */
export const fixesOn = (): boolean => info !== null;
/** is a proposal waiting for an answer — either seat's? */
export const proposalOpen = (): boolean => !!info?.proposal;

function setOpen(v: boolean): void {
  if (open === v) return;
  open = v;
  ctx?.openChanged(v);
}

function showToast(msg: string): void {
  toast = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast = null; paint(); }, 4500);
  paint();
}

const nameOf = (p: Seat): string => ctx?.view()?.names[p] ?? `Player ${p + 1}`;

/** your own cards a move may name, as `zone:index` → label */
function myCards(): [string, string][] {
  const v = ctx?.view();
  if (!v) return [];
  const p = v.state.players[v.seat];
  if (!p) return [];
  const out: [string, string][] = [];
  p.hand.forEach((c, i) => out.push([`hand:${i}`, `Hand · ${c}`]));
  (p.cache ?? []).forEach((c, i) => out.push([`cache:${i}`, `Cache · ${c.card}`]));
  p.bin.forEach((c, i) => out.push([`bin:${i}`, `Bin · ${c}`]));
  return out;
}

function units(): [string, string][] {
  const v = ctx?.view();
  if (!v) return [];
  return Object.values(v.state.entities)
    .filter(e => e.kind === 'unit')
    .map(e => [String(e.id), `${e.card}${e.token ? ' (token)' : ''} — ${nameOf(e.controller)}`] as [string, string]);
}

const option = (value: string, label: string, picked: string): string =>
  `<option value="${esc(value)}"${value === picked ? ' selected' : ''}>${esc(label)}</option>`;

function seatSelect(field: string, picked: Seat): string {
  const v = ctx?.view();
  const me = v?.seat ?? 0;
  const them = (me === 0 ? 1 : 0) as Seat;
  return `<select data-amendfield="${field}">${option(String(me), `${nameOf(me)} (you)`, String(picked))}${option(String(them), nameOf(them), String(picked))}</select>`;
}

function fieldsHtml(): string {
  const v = ctx?.view();
  if (kind === 'life') {
    const cur = v?.state.players[lifeTarget]?.life;
    return `<div class="amendrow">${seatSelect('lifeTarget', lifeTarget)}
      <span>to</span><input type="number" min="1" max="999" data-amendfield="lifeValue" value="${esc(lifeValue)}" placeholder="${cur ?? ''}">
      <span class="hint">now ${cur ?? '?'}</span></div>`;
  }
  if (kind === 'drawCards') {
    return `<div class="amendrow">${seatSelect('drawTarget', drawTarget)}
      <span>draws</span><input type="number" min="1" max="10" data-amendfield="drawN" value="${esc(drawN)}"><span>card(s)</span></div>`;
  }
  if (kind === 'move') {
    const cards = myCards();
    if (!cards.length) return '<div class="hint">You have no cards in your hand, cache or bin to move.</div>';
    if (!cards.some(([k]) => k === moveCard)) moveCard = cards[0]![0];
    const from = moveCard.split(':')[0];
    if (moveTo === from) moveTo = (DESTS.find(([d]) => d !== from)![0]);
    return `<div class="amendrow"><select data-amendfield="moveCard">${cards.map(([k, l]) => option(k, l, moveCard)).join('')}</select>
      <span>to</span><select data-amendfield="moveTo">${DESTS.filter(([d]) => d !== from).map(([d, l]) => option(d, l, moveTo)).join('')}</select></div>
      <div class="hint">Your opponent sees which card it is.</div>`;
  }
  if (kind === 'unit') {
    const list = units();
    if (!list.length) return '<div class="hint">There are no units on the board.</div>';
    if (!list.some(([k]) => k === unitId)) unitId = list[0]![0];
    return `<div class="amendrow"><select data-amendfield="unitId">${list.map(([k, l]) => option(k, l, unitId)).join('')}</select>
      <span>to</span><select data-amendfield="unitTo">${UNIT_DESTS.map(([d, l]) => option(d, l, unitTo)).join('')}</select></div>
      <div class="hint">Nothing triggers: it does not die and is not recalled. A token is simply gone.</div>`;
  }
  // rewind — CT-323: each option names what it takes back, and NOTHING is
  // picked for you: the preselected "last 1" was how 15 of the round's 36
  // rewinds came to be filed one step at a time
  if (rewinds === null) return `<div class="hint">${optionsWhy ? esc(optionsWhy) : 'Looking at the log…'}</div>`;
  if (!rewinds.length) return '<div class="hint">There is nothing to rewind.</div>';
  if (rewindTo !== null && !rewinds.some(r => r.to === rewindTo)) rewindTo = null;
  const aiming = ctx?.castPending?.() ?? false;
  return `${aiming ? '<div class="hint amendaim">Still aiming your own play? Close this and press Esc — that takes the play back, no fix needed.</div>' : ''}
    <div class="reportchoices amendrewinds" role="radiogroup">${rewinds.map(r =>
    `<button type="button" role="radio" aria-checked="${r.to === rewindTo}" class="${r.to === rewindTo ? 'on' : ''}"
      data-amend="rewindto" data-to="${r.to}">${esc(r.label)}${r.takes ? `<span class="amendtakes">takes back ${esc(r.takes)}</span>` : ''}</button>`).join('')}</div>
    <div class="hint">Pick how far back. Everything after that point is taken back, cards already seen included.</div>`;
}

/** the edit the form describes, or null when it is not complete */
function editOf(): AmendEdit | null {
  const v = ctx?.view();
  if (!v) return null;
  if (kind === 'life') {
    const n = Number(lifeValue);
    return lifeValue.trim() && Number.isInteger(n) ? { kind: 'life', target: lifeTarget, life: n } : null;
  }
  if (kind === 'drawCards') {
    const n = Number(drawN);
    return Number.isInteger(n) && n > 0 ? { kind: 'drawCards', target: drawTarget, n } : null;
  }
  if (kind === 'move') {
    const [from, i] = moveCard.split(':');
    const index = Number(i);
    const p = v.state.players[v.seat];
    const zone = from === 'hand' ? p?.hand : from === 'bin' ? p?.bin : (p?.cache ?? []).map(c => c.card);
    const card = zone?.[index];
    return card ? { kind: 'move', from: from as AmendSource, index, card, to: moveTo } : null;
  }
  if (kind === 'unit') {
    const id = Number(unitId);
    const u = v.state.entities[id];
    return u ? { kind: 'unit', id, card: u.card, to: unitTo } : null;
  }
  return null;
}

const editsBlocked = (): boolean => editWhy !== null;
const complete = (): boolean => reason.trim().length >= 3
  && (kind === 'rewind' ? rewindTo !== null && !!rewinds?.length : !editsBlocked() && editOf() !== null);

function dialogHtml(): string {
  const v = ctx?.view();
  const them = v ? nameOf((v.seat === 0 ? 1 : 0) as Seat) : 'your opponent';
  const cool = info?.cooldown ? Math.ceil(info.cooldown / 1000) : 0;
  return `<div class="amendscrim" id="amendscrim"><div class="overlaybox amendbox" role="dialog" aria-label="Propose a fix">
    <h3>🛠 Propose a fix <span class="betatag">beta</span></h3>
    <div class="hint">For when the game got something wrong. ${esc(them)} has to agree. The fix is shown in the log and filed as a bug report.</div>
    <div class="reportfield">
      <div class="reportlabel">The fix</div>
      <div class="reportchoices" role="radiogroup">${KINDS.map(([k, label, why]) => {
        const off = k !== 'rewind' && editsBlocked();
        return `<button type="button" role="radio" aria-checked="${kind === k}" class="${kind === k ? 'on' : ''}"
          data-amend="kind" data-kind="${k}" title="${esc(off ? editWhy! : why)}"${off || busy ? ' disabled' : ''}>${esc(label)}</button>`;
      }).join('')}</div>
      ${editsBlocked() && kind !== 'rewind' ? `<div class="hint">${esc(editWhy!)}</div>` : ''}
      ${fieldsHtml()}
    </div>
    <div class="reportfield">
      <div class="reportlabel">What went wrong?</div>
      <textarea id="amend-reason" rows="3" placeholder="e.g. my draw did not happen at the start of the turn" ${busy ? 'disabled' : ''}></textarea>
    </div>
    <div class="judgerow">
      <button data-amend="close">Cancel <span class="kh">(esc)</span></button>
      <span class="reporthint">${cool ? `declined — wait ${cool}s` : ''}</span>
      <button class="primary" data-amend="send" ${busy || !complete() || cool > 0 ? 'disabled' : ''}>${busy ? 'asking…' : `Ask ${esc(them)} to agree`}</button>
    </div>
    ${error ? `<div class="reporterror">${esc(error)}</div>` : ''}
  </div></div>`;
}

function barHtml(): string {
  const p = info?.proposal;
  const v = ctx?.view();
  if (!p || !v) return '';
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  if (p.seat === v.seat) {
    return `<div class="amendbar mine" role="status">🛠 Waiting for ${esc(nameOf((v.seat === 0 ? 1 : 0) as Seat))} to agree: <b>${esc(p.what)}</b>
      <span class="amendleft">${left}s</span> <button data-amend="cancel">Withdraw</button></div>`;
  }
  return `<div class="amendbar" role="alertdialog" aria-label="A fix is proposed">🛠 <b>${esc(nameOf(p.seat))} proposes a fix:</b> ${esc(p.what)}.
    <span class="amendwhy">Why: ${esc(p.reason)}</span> <span class="amendleft">${left}s</span>
    <button class="primary" data-amend="accept">Agree</button> <button data-amend="decline">Decline</button></div>`;
}

function paint(): void {
  if (!layer) return;
  layer.innerHTML = barHtml() + (open ? dialogHtml() : '') + (toast ? `<div class="toast">${esc(toast)}</div>` : '');
  if (!open) return;
  const box = document.getElementById('amend-reason') as HTMLTextAreaElement | null;
  if (box) {
    box.value = reason;
    box.addEventListener('input', () => { reason = box.value; refreshSend(); });
  }
  for (const el of Array.from(layer.querySelectorAll('[data-amendfield]')) as (HTMLInputElement | HTMLSelectElement)[]) {
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => onField(el.dataset['amendfield']!, el.value));
  }
}

/** the send button's enabled state, without repainting over the caret */
function refreshSend(): void {
  const send = layer?.querySelector('[data-amend="send"]') as HTMLButtonElement | null;
  if (send) send.disabled = busy || !complete() || (info?.cooldown ?? 0) > 0;
}

function onField(field: string, value: string): void {
  switch (field) {
    case 'lifeTarget': lifeTarget = Number(value) as Seat; lifeValue = ''; paint(); return;
    case 'lifeValue': lifeValue = value; refreshSend(); return;
    case 'drawTarget': drawTarget = Number(value) as Seat; refreshSend(); return;
    case 'drawN': drawN = value; refreshSend(); return;
    case 'moveCard': moveCard = value; paint(); return;
    case 'moveTo': moveTo = value as AmendDest; refreshSend(); return;
    case 'unitId': unitId = value; refreshSend(); return;
    case 'unitTo': unitTo = value as AmendUnitDest; refreshSend(); return;
    default: return;
  }
}

/** Open the dialog — from the table menu with nothing chosen, or from a
 * card's menu with that card preselected. Asks the server what a rewind could
 * reach and whether an edit can be made right now. */
export function openFix(preset?: FixPreset): void {
  if (!ctx || info === null) return;
  const v = ctx.view();
  if (v) { lifeTarget = v.seat; drawTarget = v.seat; }
  if (preset?.kind === 'move') { kind = 'move'; moveCard = `${preset.from}:${preset.index}`; }
  else if (preset?.kind === 'unit') { kind = 'unit'; unitId = String(preset.id); }
  rewinds = null; editWhy = null; optionsWhy = null; error = ''; busy = false;
  rewindTo = null;   // CT-323: never a rewind the player did not pick
  setOpen(true);
  ctx.send({ op: 'options' });
  paint();
}

export function closeFix(): void {
  setOpen(false);
  busy = false;
  paint();
}

function send(): void {
  if (!ctx || busy || !complete()) return;
  const msg: Record<string, unknown> = { op: 'propose', reason: reason.trim() };
  if (kind === 'rewind') msg['rewind'] = rewindTo;
  else msg['edit'] = editOf();
  busy = true;
  error = '';
  ctx.send(msg);
  paint();
}

function answer(op: 'accept' | 'decline' | 'cancel'): void {
  const p = info?.proposal;
  if (!ctx || !p) return;
  ctx.send({ op, id: p.id });
}

function onButton(what: string, el: HTMLElement): void {
  switch (what) {
    case 'close': closeFix(); return;
    case 'send': send(); return;
    case 'accept': case 'decline': case 'cancel': answer(what); return;
    case 'kind': {
      const k = el.dataset['kind'] as Kind | undefined;
      if (!k || !KINDS.some(([v]) => v === k)) return;
      if (k !== 'rewind' && editsBlocked()) return;
      kind = k;
      paint();
      return;
    }
    case 'rewindto': rewindTo = Number(el.dataset['to']); paint(); return;
    default: return;
  }
}

// ── what the server says ────────────────────────────────────────────────

/** the room's fix state, off a join or an `amend` message (`how` says what
 * just happened, when something did). `null`: the room takes no fixes. */
export function setFixInfo(next: FixInfo | null, how?: string): void {
  const v = ctx?.view();
  const had = info?.proposal ?? null;
  info = next;
  if (next?.proposal) deadline = Date.now() + next.proposal.left;
  if (!next) setOpen(false);
  const mine = !!v && had?.seat === v.seat;
  if (how === 'proposed' && next?.proposal && v && next.proposal.seat === v.seat) {
    // ours is up — the dialog's work is done, and the reason starts blank next time
    setOpen(false);
    busy = false;
    reason = '';
  }
  if (had && !next?.proposal) {
    if (how === 'declined' && mine) showToast(`${nameOf((v!.seat === 0 ? 1 : 0) as Seat)} declined your fix`);
    else if (how === 'expired') showToast('the proposed fix ran out of time');
    else if (how === 'cancelled' && !mine) showToast(`${nameOf(had.seat)} withdrew the fix`);
    else if (how === 'applied') showToast('fix applied');
    else if (how === 'moved') showToast('the proposed fix was dropped — the board moved');
  }
  if ((had?.id ?? null) !== (next?.proposal?.id ?? null)) ctx?.proposalChanged();
  // the countdown on the bar
  clearInterval(tick);
  if (next?.proposal) tick = window.setInterval(() => paint(), 1000);
  paint();
}

/** a push of the room without a proposal in it: only whether fixes exist */
export function setFixesOn(on: boolean): void {
  if (on === (info !== null)) return;
  setFixInfo(on ? {} : null);
}

/** the server's answer to `options` */
export function setFixOptions(m: { rewinds?: RewindOption[]; editWhy?: string | null; why?: string }): void {
  if (m.why) { optionsWhy = m.why; rewinds = []; editWhy = m.why; }
  else { rewinds = m.rewinds ?? []; editWhy = m.editWhy ?? null; }
  rewindTo = null;
  if (editWhy && kind !== 'rewind') kind = 'rewind';
  paint();
}

/** a refusal of something this dialog sent */
export function fixRefused(msg: string): void {
  busy = false;
  if (open) { error = msg; paint(); }
  else showToast(msg);
}

let installed = false;

/** Mount the layer beside #app. Safe in a document with no body (the
 * headless harness without a page): nothing here is load-bearing for the game. */
export function installAmend(c: AmendCtx): void {
  ctx = c;
  if (installed) return;
  const app = document.getElementById('app');
  if (!app || !document.body || typeof document.body.appendChild !== 'function') return;
  installed = true;
  layer = document.createElement('div');
  layer.id = 'amendlayer';
  document.body.appendChild(layer);
  // our own clicks, in capture, on our own elements — main.ts's handler looks
  // for `[data-btn]`, and these are `[data-amend]`
  document.addEventListener('click', e => {
    const target = e.target as HTMLElement | null;
    const t = target?.closest?.('[data-amend]') as HTMLElement | null;
    if (!t) {
      if (open && target?.id === 'amendscrim') { e.stopPropagation(); closeFix(); }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    onButton(t.dataset['amend']!, t);
  }, { capture: true });
  // while the dialog is up it owns the keyboard (D3, as the report form)
  document.addEventListener('keydown', e => {
    if (!open) return;
    if (e.key === 'Escape') { e.stopPropagation(); closeFix(); return; }
    const t = e.target as Node | null;
    if (!(t && typeof layer?.contains === 'function' && layer.contains(t))) e.stopPropagation();
  }, { capture: true });
  layer.addEventListener('keydown', e => { if (open) e.stopPropagation(); });
  paint();
}
