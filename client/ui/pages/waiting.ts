/* THE WAITING ROOMS: what a seat sees after joining a room and before the
 * game is dealt. Four kinds, one dispatcher (paintWaiting):
 *
 *   · a live draft room choosing its trio  → pages/lobby.ts lobbyHtml
 *   · a Single Card Duel room              → singleWaitingHtml, here
 *   · a Competitive Constructed match room → ui/match.ts matchWaitingHtml
 *   · a constructed room (and a constructed LEAGUE match) → constructedWaitingHtml, here
 *
 * Moved out of main.ts in the design-system round, 2026-11-03. main.ts
 * renderWaiting() drops the board's baselines and the .board class, then hands
 * this module the connection (`NET`) and the last error. Its buttons
 * (deckjoin, singlejoin, gohome, copylink, lobby-*, cc-*, sc-*) are still
 * routed by main.ts handleButton / handlePregameButton.
 */
import type { Seat } from '../../engine/src/types.ts';
import * as acct from '../account.ts';
import * as dk from '../decks.ts';
import { roomFriendsHtml } from '../inbox.ts';
import * as lob from '../lobby.ts';
import * as mt from '../match.ts';
import * as sc from '../singlecard.ts';
import { chosenDeck, esc, shareBar } from '../util.ts';
import { deckPickerHtml, deckPickerView, wireDeckPicker, type DeckPickerView } from './deckpicker.ts';
import { singleCardPickerHtml, singleCardPickerView } from './singlecard.ts';
import { lobbyHtml, lobbyView } from './lobby.ts';

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

/** what the server says about a room that has not been dealt (main.ts NetBackend.waiting) */
export interface RoomWaiting {
  have: [boolean, boolean];
  trio?: lob.TrioLobby;
  custom?: lob.CustomRulesInfo;
  single?: true;
  league?: true;
  drawn?: { mine: string; theirs: string };
  match?: mt.MatchLobbyInfo;
}

/** the parts of main.ts's NetBackend a waiting room reads */
export interface WaitingNet {
  room: string;
  seat: Seat;
  names: [string, string];
  peers: [boolean, boolean];
  waiting: RoomWaiting | null;
  custom: lob.CustomRulesInfo | null;
  matchEnded: mt.MatchSummary | null;
}

/* ── the constructed room ─────────────────────────────────────────────── */

export interface ConstructedWaitingView {
  room: string;
  /** the link handed to the OTHER seat — never with a clock on it (test 271 §3) */
  link: string;
  /** a constructed LEAGUE match: both seats are bound, so no code to share */
  league: boolean;
  /** inbox.ts roomFriendsHtml — the Invite a friend panel (a slot; '' in a league room) */
  friends: string;
  mineIn: boolean;
  oppIn: boolean;
  /** the opponent's socket is connected */
  oppHere: boolean;
  myName: string | undefined;
  oppName: string | undefined;
  /** the deck this browser brings, or none chosen */
  deck: { name: string; author: string } | null;
  deckPicker: DeckPickerView;
  error: string;
}

export function constructedWaitingView(net: WaitingNet, error: string): ConstructedWaitingView {
  const w = net.waiting!;
  const me = net.seat, opp = other(me);
  const league = w.league === true;
  return {
    room: net.room,
    link: `${location.origin}/?ws=1&room=${encodeURIComponent(net.room)}&seat=${opp}&mode=constructed`,
    league,
    friends: league ? '' : roomFriendsHtml(!net.peers[opp]),
    mineIn: !!w.have[me],
    oppIn: !!w.have[opp],
    oppHere: !!net.peers[opp],
    myName: net.names[me],
    oppName: net.names[opp],
    deck: chosenDeck(),
    deckPicker: deckPickerView(),
    error,
  };
}

/** Constructed lobby: the room exists but the game has not been dealt — it
 * starts the moment both seats have brought a deck. Pure.
 *
 * A constructed LEAGUE match (owner, 2026-11-01): a deck for this game, any
 * deck. Both seats are bound, so there is no code to share — the draft league
 * lobby says the same (ui/lobby.ts).
 *
 * Same furniture as the draft lobby (ui/lobby.ts): it is the same moment in
 * the same room, and the two screens looking different made it read as two
 * different products. */
export function constructedWaitingHtml(v: ConstructedWaitingView): string {
  const oppLine = v.oppHere ? 'connected — still choosing a deck…' : 'not here yet';
  return `<div class="lobbypage">
    <div class="lobbyhead">
      <h1 class="homelogo">ALGOMANCY</h1>
      <h2>${v.league ? 'League match' : 'Constructed'} — room <span class="roomcode">${esc(v.room)}</span></h2>
      <div class="headbtns"><button data-btn="gohome">Leave</button></div>
    </div>

    ${v.league
      ? (v.oppHere ? '' : '<p class="hint lobbywait">Waiting for your opponent. They join from their own League page — tell them on Discord you are here.</p>')
      : `${shareBar('Send your opponent the room code', v.room, v.link)}
    ${v.friends}`}

    ${v.mineIn ? '' : `<div class="lobbypanel deckpicker">
      <div class="zonelabel">Your deck${v.league ? ' for this game' : ''}</div>
      ${v.league ? '<p class="hint">Any deck. Keep it or change it every game.</p>' : ''}
      ${deckPickerHtml(v.deckPicker)}
      <button class="cta primary" data-btn="deckjoin" ${v.deck ? '' : 'disabled'}>Play this deck</button>
    </div>`}

    <div class="lobbyfoot">
      <div class="lobbyseats">
        <span class="lobbyseat"><i class="seatdot${v.mineIn ? ' ready' : ''}"></i>
          <span>${esc(v.myName ?? 'You')} (you) — ${v.mineIn
            ? `<b class="lockedin">deck is in</b>${v.deck ? ` — ${esc(v.deck.name)} by ${esc(v.deck.author)}` : ''}`
            : '<span class="dim">pick a deck above</span>'}</span></span>
        <span class="lobbyseat"><i class="seatdot${v.oppIn ? ' ready' : v.oppHere ? '' : ' away'}"></i>
          <span>${esc(v.oppName ?? 'Opponent')} — ${v.oppIn
            ? '<b class="lockedin">deck is in</b>' : `<span class="dim">${esc(oppLine)}</span>`}</span></span>
      </div>
    </div>

    ${v.error ? `<p class="deckmsg">${esc(v.error)}</p>` : ''}
    <p class="homefoot">Deals when both decks are in.</p>
  </div>`;
}

/* ── the Single Card Duel room ────────────────────────────────────────── */

export interface SingleWaitingView {
  room: string;
  /** no `&single=1`: the room exists, the server says what it is (see singleArmed) */
  link: string;
  friends: string;
  /** both picked cards that never make a unit: a draw before it starts, pick again */
  drawn: { mine: string; theirs: string } | null;
  mineIn: boolean;
  oppIn: boolean;
  oppHere: boolean;
  myName: string | undefined;
  oppName: string | undefined;
  /** the card picked so far (ui/singlecard.ts), or null */
  card: string | null;
  /** pages/singlecard.ts singleCardPickerHtml() — a slot; '' once my card is in */
  picker: string;
  error: string;
}

export function singleWaitingView(net: WaitingNet, error: string): SingleWaitingView {
  const w = net.waiting!;
  const me = net.seat, opp = other(me);
  const mineIn = !!w.have[me];
  return {
    room: net.room,
    link: `${location.origin}/?ws=1&room=${encodeURIComponent(net.room)}&seat=${opp}&mode=constructed`,
    friends: roomFriendsHtml(!net.peers[opp]),
    drawn: w.drawn ?? null,
    mineIn,
    oppIn: !!w.have[opp],
    oppHere: !!net.peers[opp],
    myName: net.names[me],
    oppName: net.names[opp],
    card: sc.chosen(),
    picker: mineIn ? '' : singleCardPickerHtml(singleCardPickerView()),
    error,
  };
}

/** CR D8.2: the waiting room of a single card duel — the constructed one, asking
 * for a card. Blind: the other seat's line says only that their card is in. Pure. */
export function singleWaitingHtml(v: SingleWaitingView): string {
  const oppLine = v.oppHere ? 'connected — still choosing a card…' : 'not here yet';
  return `<div class="lobbypage">
    <div class="lobbyhead">
      <h1 class="homelogo">ALGOMANCY</h1>
      <h2>Single Card Duel — room <span class="roomcode">${esc(v.room)}</span></h2>
      <div class="headbtns"><button data-btn="gohome">Leave</button></div>
    </div>

    ${shareBar('Send your opponent the room code', v.room, v.link)}
    ${v.friends}

    ${v.drawn ? `<div class="lobbypanel scdraw">
      <div class="zonelabel">Draw — pick again</div>
      <p>You picked <b data-prev="${esc(v.drawn.mine)}">${esc(v.drawn.mine)}</b>; ${esc(v.oppName ?? 'your opponent')} picked
        <b data-prev="${esc(v.drawn.theirs)}">${esc(v.drawn.theirs)}</b>. Neither ever makes a unit, so nobody
        could attack — a draw before it starts. Pick again (the same card is allowed).</p>
    </div>` : ''}

    ${v.mineIn ? '' : `<div class="lobbypanel deckpicker">
      <div class="zonelabel">Your card</div>
      <p class="cardsub">Thirty copies of whatever you pick, hidden from your opponent.</p>
      ${v.picker}
      <button class="cta primary" data-btn="singlejoin" ${v.card ? '' : 'disabled'}>${v.card ? `Play ${esc(v.card)}` : 'Pick a card first'}</button>
    </div>`}

    <div class="lobbyfoot">
      <div class="lobbyseats">
        <span class="lobbyseat"><i class="seatdot${v.mineIn ? ' ready' : ''}"></i>
          <span>${esc(v.myName ?? 'You')} (you) — ${v.mineIn
            ? `<b class="lockedin">card is in</b>${v.card ? ` — ${esc(v.card)}` : ''}`
            : '<span class="dim">pick a card above</span>'}</span></span>
        <span class="lobbyseat"><i class="seatdot${v.oppIn ? ' ready' : v.oppHere ? '' : ' away'}"></i>
          <span>${esc(v.oppName ?? 'Opponent')} — ${v.oppIn
            ? '<b class="lockedin">card is in</b>' : `<span class="dim">${esc(oppLine)}</span>`}</span></span>
      </div>
    </div>

    ${v.error ? `<p class="deckmsg">${esc(v.error)}</p>` : ''}
    <p class="homefoot">Deals when both cards are in.</p>
  </div>`;
}

/* ── the dispatcher ───────────────────────────────────────────────────── */

/** Paint whichever waiting room `net` is in, and wire it. `rerender` is
 * main.ts renderWaiting. */
export function paintWaiting(app: HTMLElement, net: WaitingNet, error: string, rerender: () => void): void {
  const w = net.waiting!;
  // a draft room chooses its trio here, before a single card is dealt
  if (w.trio) {
    const link = `${location.origin}/?ws=1&room=${encodeURIComponent(net.room)}&seat=${other(net.seat)}&mode=draft`;
    app.innerHTML = lobbyHtml(lobbyView({
      lobby: w.trio, seat: net.seat as 0 | 1, names: net.names,
      peers: net.peers, room: net.room, link,
      friends: roomFriendsHtml(!net.peers[other(net.seat)]),
      ...(w.custom ?? net.custom ? { custom: (w.custom ?? net.custom)! } : {}),
    }));
    return;
  }
  if (w.single) {
    app.innerHTML = singleWaitingHtml(singleWaitingView(net, error));
    sc.wire();
    return;
  }
  // docs/22 §5.4: a Competitive match's room — game 1's registration, the
  // between-games screen, a pause — is ui/match.ts's page
  if (w.match) {
    app.innerHTML = mt.matchWaitingHtml(
      { room: net.room, seat: net.seat, names: net.names, peers: net.peers, ended: net.matchEnded },
      w.match, acct.token() ? dk.competitiveDecks() : null, error);
    if (acct.token()) dk.ensureCollection(rerender);
    mt.wireDeckSelect(rerender);
    return;
  }
  app.innerHTML = constructedWaitingHtml(constructedWaitingView(net, error));
  wireDeckPicker(rerender);
}
