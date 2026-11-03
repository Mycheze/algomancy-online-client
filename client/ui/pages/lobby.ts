/* THE DRAFT LOBBY: two people agreeing on the elements, before a card is
 * dealt — and the trio reveal, the "here is how it happened" interstitial over
 * the freshly dealt board.
 *
 * Moved out of ui/lobby.ts in the design-system round, 2026-11-03, under the
 * page contract (pages/README.md): lobbyView() adds ui/lobby.ts's un-submitted
 * choice (lobbyLocals) to what the room says, lobbyHtml(view) draws it and
 * touches nothing else. pages/waiting.ts paints it (its trio branch). The
 * reveal is drawn by main.ts's board render, over the board.
 *
 * Three methods, all of them blind (ui/lobby.ts's header says why); nothing
 * here shows what the other seat submitted.
 */
import { ALL_ELEMENTS } from '../../engine/src/apply.ts';
import { button } from '../components/index.ts';
import { lobbyLocals, type CustomRulesInfo, type TrioLobby, type TrioReveal } from '../lobby.ts';
import { elIcon as icon, esc, shareBar } from '../util.ts';

/** the engine's own element list, so a new element never leaves this screen
 * with a stale copy */
const ELEMENTS: readonly string[] = ALL_ELEMENTS;

/** what the room says: main.ts's connection, through pages/waiting.ts */
export interface LobbyArgs {
  lobby: TrioLobby;
  seat: 0 | 1;
  names: [string, string];
  peers: [boolean, boolean];
  room: string;
  link: string;
  /** BL-43: the room's custom rules, shown to both seats before the deal */
  custom?: CustomRulesInfo;
  /** the "Invite a friend" panel (ui/inbox.ts), drawn under the share bar */
  friends?: string;
}

export interface LobbyView extends LobbyArgs {
  /** pick-one: the element named so far, or null */
  pick: string | null;
  /** rank: the ranking built so far, best first */
  ranking: readonly string[];
  /** complete enough to lock in */
  ready: boolean;
}

export function lobbyView(a: LobbyArgs): LobbyView {
  return { ...a, ...lobbyLocals(a.lobby) };
}

function methodPickerHtml(lobby: TrioLobby, iAmLocked: boolean): string {
  // Each method carries its own blurb. The blurb used to live in one line
  // under the row, describing whichever method was selected — which meant
  // finding out what the other two did required selecting them.
  return `<div class="lobbymethods">
    ${lobby.methods.map(m => `<button class="lobbymethod ${m.id === lobby.method ? 'on' : ''}"
      data-btn="lobby-method" data-method="${esc(m.id)}" ${iAmLocked ? 'disabled' : ''}>
      <b>${esc(m.label)}</b><em>${esc(m.blurb)}</em></button>`).join('')}
  </div>`;
}

function pickOneHtml(pick: string | null, iAmLocked: boolean): string {
  return `<div class="elrow lobbyels">${ELEMENTS.map(el =>
    `<button class="elchip ${el} ${pick === el ? 'on' : ''}" data-btn="lobby-pick" data-el="${el}"
      ${iAmLocked ? 'disabled' : ''}>${icon(el)}${el}</button>`).join('')}</div>
  <p class="hint">${pick ? `You named <b>${esc(pick)}</b>. ` : 'Name one. '}Hidden until you are both locked in.</p>`;
}

function rankHtml(ranking: readonly string[], iAmLocked: boolean): string {
  const rest = ELEMENTS.filter(e => !ranking.includes(e));
  return `<div class="ranklist">
    ${ranking.map((el, i) => `<button class="elchip ${el} on ranked" data-btn="lobby-unrank" data-el="${el}"
      ${iAmLocked ? 'disabled' : ''} title="click to take it back out">
      <span class="ranknum">${i + 1}</span>${icon(el)}${el}</button>`).join('')}
    ${ranking.length ? '' : '<span class="hint">click them in order, most wanted first</span>'}
  </div>
  ${rest.length ? `<div class="elrow lobbyels">${rest.map(el =>
    `<button class="elchip ${el}" data-btn="lobby-rank" data-el="${el}" ${iAmLocked ? 'disabled' : ''}>
      ${icon(el)}${el}</button>`).join('')}</div>` : ''}
  <div class="lobbyrankbtns">
    ${button({ label: 'start over', dataBtn: 'lobby-rank-clear', disabled: iAmLocked || !ranking.length })}
    ${button({ label: 'fill the rest in any order', dataBtn: 'lobby-rank-fill', disabled: iAmLocked || !rest.length })}
  </div>
  <p class="hint">${ranking.length}/${ELEMENTS.length} ranked. Shared top picks are more likely, never certain.</p>`;
}

/** the heading over the right-hand panel — what this method wants FROM you */
function bodyLabel(method: string): string {
  if (method === 'pick-one') return 'Your element';
  if (method === 'rank') return 'Your ranking, best first';
  return 'Nothing to fill in';
}

/** one seat's line in the footer: a dot, a name, a state */
function seatLine(name: string, you: boolean, here: boolean, locked: boolean): string {
  const dot = !here ? 'away' : locked ? 'ready' : '';
  const state = !here ? 'has not arrived yet' : locked ? '<b class="lockedin">ready</b>' : 'still choosing…';
  return `<span class="lobbyseat"><i class="seatdot ${dot}"></i>
    <span>${esc(name)}${you ? ' (you)' : ''} — ${!here || locked ? state : `<span class="dim">${state}</span>`}</span></span>`;
}

/** BL-43: the rules this room was created with — both seats read them before anything is dealt */
function customPanelHtml(c: CustomRulesInfo): string {
  return `<div class="lobbycustom"><div class="zonelabel">Custom rules</div>
    <ul>${c.summary.map(line => `<li>${esc(line)}</li>`).join('')}</ul>
    <p class="hint">${c.excluded} card${c.excluded === 1 ? '' : 's'} left out. Kept in your history, counts toward no stats.</p></div>`;
}

/** The lobby. Pure: everything comes in through `v` (lobbyView). */
export function lobbyHtml(v: LobbyView): string {
  const { lobby, seat, names, peers, room, link } = v;
  const opp = (seat === 0 ? 1 : 0) as 0 | 1;
  const iAmLocked = lobby.locked[seat];
  const theyAreLocked = lobby.locked[opp];
  const theyAreHere = peers[opp];
  const count = lobby.count ?? 3;
  const word = count === 3 ? 'trio' : count === 2 ? 'pair' : 'set of elements';

  const body = lobby.method === 'pick-one' ? pickOneHtml(v.pick, iAmLocked)
    : lobby.method === 'rank' ? rankHtml(v.ranking, iAmLocked)
    : lobby.method === 'again'
      ? '<p class="hint">Say you are ready and you will play it again.</p>'
      // a league match: the method is fixed (server/trio.ts 'random')
      : lobby.method === 'random'
        ? `<p class="hint">This is a league match. When you are both ready, the ${word} is drawn at random and the first player is picked at random.</p>`
      : `<p class="hint">Say you are ready and the server picks a ${word} the two of you have never played.</p>`;

  return `<div class="lobbypage">
    <div class="lobbyhead">
      <h1 class="homelogo">ALGOMANCY</h1>
      <h2>${v.custom ? 'Custom live draft' : lobby.method === 'random' ? 'League match' : 'Live draft'} — room <span class="roomcode">${esc(room)}</span></h2>
      <div class="headbtns">${button({ label: 'Leave', dataBtn: 'gohome' })}</div>
    </div>

    ${theyAreHere ? '' : lobby.method === 'random'
      ? '<p class="hint lobbywait">Waiting for your opponent. They join from their own League page — tell them on Discord you are here.</p>'
      : shareBar('Send your opponent the room code', room, link) + (v.friends ?? '')}

    ${v.custom ? customPanelHtml(v.custom) : ''}

    <div class="lobbygrid">
      <div class="lobbypanel">
        <div class="zonelabel">How should the ${word} be chosen?</div>
        ${methodPickerHtml(lobby, iAmLocked)}
      </div>
      <div class="lobbypanel">
        <div class="zonelabel">${esc(bodyLabel(lobby.method))}</div>
        <div class="lobbysection">${body}</div>
      </div>
    </div>

    <div class="lobbyfoot">
      <div class="lobbyseats">
        ${seatLine(names[seat] ?? 'You', true, true, iAmLocked)}
        ${seatLine(names[opp] ?? 'Your opponent', false, theyAreHere, theyAreLocked)}
      </div>
      <div class="lobbygo">${iAmLocked
        ? button({ label: 'Change my mind', dataBtn: 'lobby-unlock' })
        : button({ label: v.ready ? "I'm ready" : 'finish choosing first', variant: 'primary', dataBtn: 'lobby-lock', disabled: !v.ready })}</div>
    </div>

    <p class="homefoot">Nothing is dealt until you have both locked in.</p>
  </div>`;
}

/** The "here is your trio, and here is exactly how it happened" interstitial.
 * The working is shown because a trio nobody can audit is a trio somebody
 * suspects — and this one is decided by a draw neither player can see. Pure. */
export function revealHtml(reveal: TrioReveal): string {
  return `<div class="trioreveal">
    <div class="triobanner">${reveal.els.map(el =>
      `<span class="elchip ${el} on">${icon(el)}${el}</span>`).join('')}</div>
    <div class="triohow">${esc(reveal.how)}</div>
    <ul class="triodetail">${reveal.detail.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
    ${button({ label: 'Draft!', variant: 'primary', dataBtn: 'trio-ok' })}
  </div>`;
}
