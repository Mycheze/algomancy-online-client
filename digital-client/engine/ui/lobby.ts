/* The draft lobby: two people agreeing on three elements.
 *
 * The room exists, both players are in it, and NO CARDS HAVE BEEN DEALT — that
 * is the point. Choosing the trio on the home screen made it one person's
 * decision and handed that person a free look at pack 1 pick 1 while they
 * waited for their opponent. Nothing is dealt until this screen resolves.
 *
 * Three methods, all of them blind: you never see what the other person
 * submitted until the trio comes back. A pick you can see is a pick you can
 * counter, and the point is that you each get to bring something you want to
 * play. All the deciding happens server-side (server/trio.ts) off a seeded
 * draw — this module only collects a submission and shows what came back.
 */

export interface TrioMethodInfo { id: string; label: string; blurb: string }

export interface TrioLobby {
  method: string;
  methods: TrioMethodInfo[];
  locked: [boolean, boolean];
  /** your own submission, echoed by the server so a refresh keeps it */
  mine: { element?: string; ranking?: string[] };
}

export interface TrioReveal {
  els: string[];
  how: string;
  detail: string[];
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ELEMENTS = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];

const icon = (el: string): string =>
  `<img class="elicon" src="/Icons/${el}.webp" alt="" onerror="this.style.display='none'">`;

// ── local, un-submitted state ─────────────────────────────────────────
//
// Kept here rather than on the connection: it is what you are still fiddling
// with, and nothing outside this screen has any business reading it.

let pick: string | null = null;
/** the ranking being built, best first */
let ranking: string[] = [];
/** the method these locals belong to — switching method throws them away */
let localFor = '';

/** Adopt whatever the server echoed back (a reconnect, or the other player
 * changing the method out from under us). */
function syncLocals(lobby: TrioLobby): void {
  if (localFor === lobby.method) return;
  localFor = lobby.method;
  pick = typeof lobby.mine.element === 'string' ? lobby.mine.element : null;
  ranking = Array.isArray(lobby.mine.ranking) ? lobby.mine.ranking.filter(e => ELEMENTS.includes(e)) : [];
}

/** what we would send right now */
function submission(method: string): unknown {
  if (method === 'pick-one') return pick ? { element: pick } : {};
  if (method === 'rank') return { ranking };
  return {};
}

/** is it complete enough to lock in? */
function ready(method: string): boolean {
  if (method === 'pick-one') return !!pick;
  if (method === 'rank') return ranking.length === ELEMENTS.length;
  return true;
}

// ── the screen ────────────────────────────────────────────────────────

export interface LobbyView {
  lobby: TrioLobby;
  seat: 0 | 1;
  names: [string, string];
  peers: [boolean, boolean];
  room: string;
  link: string;
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

function pickOneHtml(iAmLocked: boolean): string {
  return `<div class="elrow lobbyels">${ELEMENTS.map(el =>
    `<button class="elchip ${el} ${pick === el ? 'on' : ''}" data-btn="lobby-pick" data-el="${el}"
      ${iAmLocked ? 'disabled' : ''}>${icon(el)}${el}</button>`).join('')}</div>
  <p class="hint">${pick ? `You named <b>${esc(pick)}</b>. ` : 'Name one. '}Your opponent cannot see this
    until you are both locked in.</p>`;
}

function rankHtml(iAmLocked: boolean): string {
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
    <button data-btn="lobby-rank-clear" ${iAmLocked || !ranking.length ? 'disabled' : ''}>start over</button>
    <button data-btn="lobby-rank-fill" ${iAmLocked || !rest.length ? 'disabled' : ''}>fill the rest in any order</button>
  </div>
  <p class="hint">${ranking.length}/${ELEMENTS.length} ranked. Something you both put near the top is
    far more likely to come up — but nothing is certain.</p>`;
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

export function lobbyHtml(v: LobbyView): string {
  const { lobby, seat, names, peers, room, link } = v;
  syncLocals(lobby);
  const opp = (seat === 0 ? 1 : 0) as 0 | 1;
  const iAmLocked = lobby.locked[seat];
  const theyAreLocked = lobby.locked[opp];
  const theyAreHere = peers[opp];

  const body = lobby.method === 'pick-one' ? pickOneHtml(iAmLocked)
    : lobby.method === 'rank' ? rankHtml(iAmLocked)
    : lobby.method === 'again'
      ? '<p class="hint">Nothing to fill in — say you are ready and you will play it again.</p>'
      : `<p class="hint">Nothing to fill in — say you are ready and the server will find you a trio
         the two of you have never played.</p>`;

  return `<div class="lobbypage">
    <div class="lobbyhead">
      <h1 class="homelogo">ALGOMANCY</h1>
      <h2>Live draft — room <span class="roomcode">${esc(room)}</span></h2>
      <div class="headbtns"><button data-btn="gohome">Leave</button></div>
    </div>

    ${theyAreHere ? '' : `<div class="sharebar">Send your opponent the room code <b>${esc(room)}</b> or this link:
      <input class="sharelink" readonly value="${esc(link)}" onclick="this.select()">
      <button data-btn="copylink" data-link="${esc(link)}">copy</button></div>`}

    <div class="lobbygrid">
      <div class="lobbypanel">
        <div class="zonelabel">How should the trio be chosen?</div>
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
        ? `<button data-btn="lobby-unlock">Change my mind</button>`
        : `<button class="primary" data-btn="lobby-lock" ${ready(lobby.method) ? '' : 'disabled'}>
             ${ready(lobby.method) ? "I'm ready" : 'finish choosing first'}</button>`}</div>
    </div>

    <p class="homefoot">No cards are dealt until you have both locked in, so nobody gets an early look
      at their first pack.</p>
  </div>`;
}

/** The "here is your trio, and here is exactly how it happened" interstitial.
 * The working is shown because a trio nobody can audit is a trio somebody
 * suspects — and this one is decided by a draw neither player can see. */
export function revealHtml(reveal: TrioReveal): string {
  return `<div class="trioreveal">
    <div class="triobanner">${reveal.els.map(el =>
      `<span class="elchip ${el} on">${icon(el)}${el}</span>`).join('')}</div>
    <div class="triohow">${esc(reveal.how)}</div>
    <ul class="triodetail">${reveal.detail.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
    <button class="primary" data-btn="trio-ok">Draft!</button>
  </div>`;
}

// ── clicks ────────────────────────────────────────────────────────────

export interface LobbyActions {
  lobby: TrioLobby;
  /** send a `{t:'lobby', …}` message */
  send: (msg: Record<string, unknown>) => void;
  rerender: () => void;
}

/** main.ts offers every button here first. Returns true when it was ours. */
export function handleLobbyButton(btn: HTMLElement, a: LobbyActions): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('lobby-')) return false;
  const el = btn.dataset['el'];
  syncLocals(a.lobby);

  switch (b) {
    case 'lobby-method':
      // the server clears both submissions on a method change — say so by
      // dropping ours here too, rather than letting a stale ranking linger
      // on screen until the next message arrives
      localFor = '';
      a.send({ method: btn.dataset['method'] });
      return true;

    case 'lobby-pick':
      pick = pick === el ? null : (el ?? null);
      a.rerender();
      return true;

    case 'lobby-rank':
      if (el && !ranking.includes(el)) ranking = [...ranking, el];
      a.rerender();
      return true;

    case 'lobby-unrank':
      ranking = ranking.filter(e => e !== el);
      a.rerender();
      return true;

    case 'lobby-rank-clear':
      ranking = [];
      a.rerender();
      return true;

    case 'lobby-rank-fill':
      // "I care about my top few and not the rest" is a real preference, and
      // making people rank all seven to express it is busywork
      ranking = [...ranking, ...ELEMENTS.filter(e => !ranking.includes(e))];
      a.rerender();
      return true;

    case 'lobby-lock':
      if (!ready(a.lobby.method)) return true;
      a.send({ submission: submission(a.lobby.method), lock: true });
      return true;

    case 'lobby-unlock':
      a.send({ lock: false });
      return true;
  }
  return false;
}

/** forget the in-progress submission (leaving the room) */
export function resetLobby(): void {
  pick = null;
  ranking = [];
  localFor = '';
}
