/* COMPETITIVE CONSTRUCTED — THE MATCH SCREENS (docs/22 §5, §6.1): the home
 * screen's Competitive card and its "Your matches" row, and the match room —
 * game 1's registration, the between-games screen (score, frozen clocks,
 * sideboarding, Ready with the loser's initiative choice), the pause,
 * and a match that ended while the page waited.
 *
 * Moved out of ui/match.ts in the design-system round, 2026-11-03, under the
 * page contract (pages/README.md): each …View() reads ui/match.ts's state
 * (matchState, shown, pickOf) and the clock, each …Html(view) draws and
 * touches nothing else, paintMatchRoom() paints the room and wires it.
 * ui/match.ts keeps the wire types, the draft, the cc- clicks, the "Your
 * matches" fetch and the countdown, which rewrites `data-cc-until` in place.
 *
 * Touch-first (a 120 s window on an iPad): every move is one tap; nothing here
 * needs hover or a right-click.
 *
 * THE BETWEEN SCREEN IS A CARD TABLE (owner 2026-11-03, on the first live try
 * of a chip list: "I wanted something like MTGO. Your deck laid out below, on
 * the table we spent so much time building, then the sideboard above and you
 * slide cards in and out … you can't even see the card images"). Since BL-65
 * (2026-11-04) it is the builder's own table (pages/table.ts tableHtml), so it
 * is one thing to learn: the deck in its piles on the felt (as the player laid
 * it out on the builder, else by cost — matchPiles, BL-55), the Sideboard
 * in the rail on the right, the counts and the verdict in the strip at its
 * foot — and no pool, only the registered cards. A card goes across by one tap
 * or by a drag (ui/match.ts moveCopy, both; no menu, the window is 120 s). The
 * page is the app frame: its toolbar holds the match (the score, the
 * countdown, both clocks, the opponent, Undo, pause and concede), and only the
 * table's own regions scroll.
 */
import { checkSwap, SIDEBOARD_MAX, type MatchConfig } from '../../engine/src/matchdeck.ts';
import type { Seat } from '../../engine/src/types.ts';
import * as acct from '../account.ts';
import { iconButton, settingRow, statusMessage, toggle } from '../components/index.ts';
import * as dk from '../decks.ts';
import { reconcilePiles, seedPiles, type DeckPile } from '../deckarrange.ts';
import { roomFriendsHtml } from '../inbox.ts';
import {
  canUndo, clock, matchLink, matchState, myMatchLine, pickOf, sameBoards, scoreWords, shown, wireDeckSelect,
  type CcDeck, type MatchLobbyInfo, type MatchSummary,
} from '../match.ts';
import { cardHeight, cardWidth, stripOf, type PileCard, type PileView } from '../piletable.ts';
import { esc, shareBar } from '../util.ts';
import { roomFrameHtml, roomSection } from './lobby.ts';
import { frameChromeView, frameHtml, paintFrame, type FrameChrome } from './frame.ts';
import { tableHtml } from './table.ts';

/** owner, docs/22 §0: a paused match closes after 7 days */
const PAUSE_DAYS_MS = 7 * 24 * 3600_000;

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

function dayText(ms: number): string {
  try { return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
  catch { return new Date(ms).toDateString(); }
}

/** the legality line, in the player's words; null when the draft is legal */
function legalityLine(registered: MatchConfig, cfg: MatchConfig): string | null {
  const c = checkSwap(registered, cfg);
  if (c.ok) return null;
  if (cfg.main.length < 30) return `Main deck needs 30 — you have ${cfg.main.length}.`;
  if (cfg.side.length > SIDEBOARD_MAX) return `Sideboard holds ${SIDEBOARD_MAX} — you have ${cfg.side.length}.`;
  return c.error.charAt(0).toUpperCase() + c.error.slice(1) + '.';
}

/* ── the home card ────────────────────────────────────────────────────── */

/** the CC-legal picker: an illegal deck is listed greyed, with its reason.
 * Exported for the home's Play card (docs/24, 2026-11-03), which draws it in
 * its Deck row when Constructed is on Competitive. */
export function ccDeckSelectHtml(decks: CcDeck[] | null, pick: CcDeck | null): string {
  if (!decks) return '<div class="hint">loading your decks…</div>';
  if (!decks.length) return '<div class="hint">No decks yet — build one under 🗂 My decks.</div>';
  const opts = decks.map(d => d.error
    ? `<option value="${esc(d.id)}" disabled>${esc(d.name)} — ${esc(d.error)}</option>`
    : `<option value="${esc(d.id)}" ${pick?.id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  return `<select id="cc-deck" class="deckselect" aria-label="Your deck for the match">
      ${pick ? '' : '<option value="" selected disabled>no deck is Competitive legal yet</option>'}${opts}
    </select>`;
}

/** report #356: a match is Casual or Competitive by its rules set */
const matchKind = (w: { casual?: true }): string => (w.casual ? 'Casual' : 'Competitive');

export interface CompetitiveCardView {
  signedIn: boolean;
  /** the collection with each deck's Competitive verdict (ui/decks.ts), or null while it loads */
  decks: CcDeck[] | null;
  /** Bo3 by default (§6.1); a post-game "New match" brings the last one back */
  bestOf: 1 | 3;
  /** the deck offered first: the last pick if it is still legal, else the first legal one */
  pick: CcDeck | null;
}

export function competitiveCardView(signedIn: boolean, decks: CcDeck[] | null): CompetitiveCardView {
  return { signedIn, decks, bestOf: matchState().bestOf, pick: decks ? pickOf(decks) : null };
}

/**
 * docs/22 §6.1 — the Competitive card, beside Constructed. Best of 1 or 3
 * (Bo3 first), the CC-legal decks, and New match. A match hangs off two
 * accounts, so signed out the card says so and offers the sign-in. Pure.
 */
export function competitiveCardHtml(v: CompetitiveCardView): string {
  const head = `<h2>Competitive</h2>
    <p class="cardsub">Constructed with a sideboard of up to 7. 45 minutes each for the whole match.</p>`;
  if (!v.signedIn) {
    return `<div class="homecard offer cccard">${head}
      <p class="hint">Sign in to play a Competitive match.</p>
      <div class="spacer"></div>
      <button class="cta" data-btn="acct-open-auth">Log in / Sign up</button>
    </div>`;
  }
  const pick = v.pick;
  return `<div class="homecard offer cccard">${head}
    <div class="ccbo" role="group" aria-label="match length">
      ${([3, 1] as const).map(n => toggle({ label: `Best of ${n}`, on: v.bestOf === n, strong: true, dataBtn: 'cc-bo', attrs: { 'data-bo': n } })).join('')}
    </div>
    ${ccDeckSelectHtml(v.decks, pick)}
    <div class="spacer"></div>
    <button class="cta primary" data-btn="cc-new" ${pick ? '' : 'disabled'}>New match${pick ? '' : ' — pick a deck first'}</button>
  </div>`;
}

/* ── "Your matches" (§5.6: a paused match is always one button away) ── */

export interface YourMatchesView {
  /** each open match as its line and button (ui/match.ts myMatchLine, shared with the bell) */
  rows: readonly { room: string; seat: Seat; text: string; button: string }[];
}

export function yourMatchesView(): YourMatchesView {
  const now = Date.now();
  return {
    rows: (matchState().mine ?? []).map(m => ({ room: m.room, seat: m.seat, ...myMatchLine(m, now) })),
  };
}

/** Pure. Nothing at all while there is no open match. */
export function yourMatchesHtml(v: YourMatchesView): string {
  if (!v.rows.length) return '';
  return `<div class="ccmine"><div class="zonelabel">Your matches</div>
    ${v.rows.map(l => {
      return `<div class="ccmatchrow"><span>${l.text}</span>
        <button class="primary" data-btn="cc-open" data-room="${esc(l.room)}" data-seat="${l.seat}">${l.button}</button></div>`;
    }).join('')}
  </div>`;
}

/* ── the match room: game 1's registration, and the between screen ───── */

/** what the room needs from the socket client */
export interface MatchSeatView {
  room: string; seat: Seat; names: [string, string]; peers: [boolean, boolean];
  /** a match that ended while this page waited (a `{t:'match'}` with no room) */
  ended: MatchSummary | null;
}

export interface MatchRoomView extends MatchSeatView {
  /** `waiting.match` — this seat's view of the match */
  w: MatchLobbyInfo;
  /** the CC-legal collection (game 1's picker), or null signed out / loading */
  decks: CcDeck[] | null;
  /** the deck game 1's picker offers first */
  pick: CcDeck | null;
  /** the last refusal, or '' */
  error: string;
  /** Date.now() at the paint: the countdown's first frame, a pause's default deadline */
  now: number;
  /** game 1: the link handed to the OTHER seat */
  link: string;
  /** game 1: inbox.ts roomFriendsHtml, the Invite a friend panel — a slot, '' otherwise */
  friends: string;
  /** what this seat's panel shows: the draft under way, else the server's configuration */
  shown: MatchConfig | null;
  /** Concede match asked once and waits for the answer */
  concedeAsk: boolean;
  /** the sideboarding table's sizes: the card width and height the tabletop
   * draws at for this window, and the table's height (its piles' strips
   * tighten to fit it). Absent = the tabletop's touch size, a 460px pane */
  table?: TableSize;
  /** the table's Undo has a move to take back (ui/match.ts canUndo); absent = none */
  undo?: boolean;
  /** the toolbar's account and bell (pages/frame.ts) */
  chrome: FrameChrome;
}

export interface TableSize { cw: number; ch: number; paneH: number }

const TABLE_DEFAULT: TableSize = { cw: 108, ch: cardHeight(108), paneH: 460 };

/** what the table region spends on itself before a pile's fan: its padding,
 * the "Main deck" line, a pile's padding and header (47-competitive-match.css) */
const PANE_CHROME = 92;

/** the table region's height as last painted (paintMatchRoom measures it) */
let paneSeen = 0;

/** the card size for this window (the tabletop's rule) and the table
 * region's height: as measured at the last paint, else what the window leaves it */
function tableSize(): TableSize {
  if (typeof document === 'undefined' || typeof innerWidth !== 'number') return TABLE_DEFAULT;
  const touch = !!document.documentElement?.classList?.contains?.('touch');
  const cw = cardWidth({ touch, width: innerWidth });
  const ch = cardHeight(cw);
  // the frame's two bars and the strip at the table's foot
  const guess = (typeof innerHeight === 'number' ? innerHeight : 800) - 76 - 46 - 58;
  return { cw, ch, paneH: Math.max(ch + PANE_CHROME, paneSeen || guess) };
}

/** the room is in game 1 before the deal: each seat registers a deck */
const registering = (seat: MatchSeatView, w: MatchLobbyInfo): boolean =>
  !seat.ended && w.phase === 'game' && w.game === 1;

export function matchRoomView(seat: MatchSeatView, w: MatchLobbyInfo, decks: CcDeck[] | null, error: string): MatchRoomView {
  const opp = other(seat.seat);
  const reg = registering(seat, w);
  return {
    ...seat, w, decks, error,
    pick: decks ? pickOf(decks) : null,
    now: Date.now(),
    link: `${location.origin}/${matchLink(seat.room, opp)}`,
    // asked only where the page used to draw it: the panel polls who is online
    friends: reg ? roomFriendsHtml(!seat.peers[opp]) : '',
    shown: shown(w),
    concedeAsk: matchState().concedeAsk,
    table: tableSize(),
    undo: canUndo(w),
    chrome: frameChromeView(),
  };
}

/** score, both frozen clocks, and the countdown (patched in place each second) */
function scoreboardHtml(v: MatchRoomView): string {
  const w = v.w;
  const me = v.seat, opp = other(me);
  const left = w.until !== null && w.phase === 'between' && !w.locked
    ? ` · <span class="cccount" data-cc-until="${w.until}">${clock(w.until - v.now)}</span> to sideboard` : '';
  return `<div class="ccscore">
    <div class="ccgame">Game ${w.game} of ${w.bestOf} — ${esc(scoreWords(w.score, me))}${left}</div>
    ${w.clockStart === null
      // the creator chose no clock (docs/22 §6.1): there are no banks to show
      ? '<div class="ccbanks"><span class="dim">No clock in this match</span></div>'
      : `<div class="ccbanks">Your clock <b>${clock(w.banks[me] ?? 0)}</b> · ${esc(w.names[opp] || 'Opponent')} <b>${clock(w.banks[opp] ?? 0)}</b>
      <span class="dim">of ${clock(w.clockStart)}</span></div>`}
  </div>`;
}

/**
 * THE DECK'S PILES ON THE TABLE (BL-55): the deck as its owner laid it out on
 * the tabletop builder when they registered it, else by cost, as a deck
 * nobody arranged opens on the builder.
 *
 * Worked out afresh from the REGISTERED arrangement on every paint, never
 * kept: reconcilePiles (the builder's own rule) takes a copy sideboarded out
 * off the last pile holding it and puts a card brought in where the builder
 * would (beside its name, else its Re-sort bucket, else "New"). So a copy
 * that comes back — a tap, Undo, Back to the registered deck — is back in
 * the pile it started in, and the registered deck is its arrangement exactly.
 * A pile left empty is not drawn unless its owner named it, as on the builder.
 */
export function matchPiles(main: readonly string[], arranged: readonly DeckPile[] | undefined): DeckPile[] {
  if (!arranged?.length) return seedPiles(main, 'cost');
  return reconcilePiles(main, arranged).filter(p => p.cards.length > 0 || p.named);
}

/** the deck as the builder's piles (matchPiles), every copy a card of its
 * own; a tap on a copy (or a drop on the sideboard) moves it out. Shown, not
 * editable, once the window locks */
function deckPiles(main: readonly string[], arranged: readonly DeckPile[] | undefined, live: boolean, t: TableSize): PileView[] {
  const room = t.paneH - PANE_CHROME;
  return matchPiles(main, arranged).map(p => {
    const cards: PileCard[] = p.cards.map((name, k) => ({ name, src: `main|${p.id}|${k}|${name}` }));
    return {
      zone: `main|${p.id}`, name: p.name, cards, S: stripOf(cards.length, room, t.ch), ch: t.ch,
      cls: 'ccsbpile', tap: live ? { card: 'cc-move', from: 'main' } : { card: null },
    };
  });
}

/** the sideboard, the rail's pile: n/7, red over it, an empty one keeps a
 * card's room to drop on */
function sidePile(side: readonly string[], live: boolean, t: TableSize): PileView {
  const cards: PileCard[] = side.map((name, k) => ({ name, src: `side|${k}|${name}` }));
  return {
    zone: 'side', name: 'Sideboard', cards, S: stripOf(cards.length, t.paneH - PANE_CHROME, t.ch), ch: t.ch,
    cls: 'ttsidepile', limit: SIDEBOARD_MAX, slot: true,
    tap: live ? { card: 'cc-move', from: 'side' } : { card: null },
  };
}

/** back to the deck as registered — one tap (docs/22 §8 Q3), off while it already is */
function resetHtml(w: MatchLobbyInfo, cfg: MatchConfig): string {
  const same = sameBoards(cfg, w.mine!.registered);
  return `<div class="ccreset"><button data-btn="cc-reset" ${same ? 'disabled' : ''}>Back to the registered deck</button></div>`;
}

/** Ready, with the loser's two buttons and never a default (§8 answer 1).
 * `lead`: trusted markup just before the buttons (Back to the registered deck) */
function readyHtml(v: MatchRoomView, legal: boolean, lead = ''): string {
  const w = v.w;
  const me = v.seat, opp = other(me);
  const them = esc(w.names[opp] || 'Your opponent');
  const choosing = w.chooser === me;
  const choiceWords = (s: Seat | null): string => s === null ? '' : s === me ? 'You take the initiative.' : `${them} takes the initiative.`;
  const two = (label: [string, string], dis: boolean): string =>
    `<button data-btn="cc-ready" data-init="${me}" ${dis ? 'disabled' : ''}>${label[0]}</button>
     <button data-btn="cc-ready" data-init="${opp}" ${dis ? 'disabled' : ''}>${label[1]}</button>`;
  if (w.locked) {
    return choosing
      ? `<div class="ccready"><p>Sideboarding is over. Who takes the initiative?</p>
          ${two(['I take the initiative', 'They take it'], false)}</div>`
      : `<div class="ccready"><p class="hint">Waiting for ${them} to choose who takes the initiative…</p></div>`;
  }
  const readyMe = w.ready[me];
  const note = !legal ? '<span class="dim">Fix the deck to ready up.</span>' : '';
  let body: string;
  if (readyMe) {
    body = `${lead}<b class="lockedin">Ready ✓</b> ${choosing ? esc(choiceWords(w.initiative)) : ''}
      <button data-btn="cc-ready" data-ready="0">Not ready</button>`;
  } else if (choosing) {
    body = `<p>You lost the last game: you choose who takes the initiative.</p>
      ${lead}${two(['Ready — I take the initiative', 'Ready — they take it'], !legal)} ${note}`;
  } else {
    body = `${lead}<button data-btn="cc-ready" ${legal ? '' : 'disabled'}>Ready</button> ${note}`;
  }
  const chooserLine = !choosing && w.chooser !== null
    ? `<p class="hint">${w.initiative === null ? `${them} is choosing who takes the initiative…` : esc(choiceWords(w.initiative))}</p>` : '';
  return `<div class="ccready">${chooserLine}${body}</div>`;
}

/** the opponent: a ready dot and a name, never a deck (they sit by their clock) */
function opponentHtml(v: MatchRoomView): string {
  const w = v.w;
  const opp = other(v.seat);
  const them = esc(w.names[opp] || 'Your opponent');
  return `<div class="lobbyseats ccsbopp"><span class="lobbyseat"><i class="seatdot${w.ready[opp] ? ' ready' : v.peers[opp] ? '' : ' away'}"></i>
      <span>${them}${w.ready[opp] ? ' — ready' : v.peers[opp] ? '' : ' — not here'}</span></span></div>`;
}

/** the table toolbar's match, in two lines: the countdown (the one thing that
 * must never be cut), the opponent's ready dot; then the score and both clocks */
function tableMatchHtml(v: MatchRoomView): string {
  const w = v.w;
  const me = v.seat, opp = other(me);
  const left = w.until !== null && w.phase === 'between' && !w.locked
    ? `<span class="ccsbclock"><span class="cccount" data-cc-until="${w.until}">${clock(w.until - v.now)}</span> to sideboard</span>` : '';
  const banks = w.clockStart === null
    ? '<span class="dim">No clock in this match</span>'
    : `Your clock <b>${clock(w.banks[me] ?? 0)}</b> · ${esc(w.names[opp] || 'Opponent')} <b>${clock(w.banks[opp] ?? 0)}</b>
      <span class="dim ccof">of ${clock(w.clockStart)}</span>`;
  return `<div class="ccsbinfo"><div class="ccsbline1">${left}${opponentHtml(v)}</div>
    <div class="ccsbline2"><span class="ccgame">Game ${w.game} of ${w.bestOf} — ${esc(scoreWords(w.score, me))}</span> · <span class="ccbanks">${banks}</span></div></div>`;
}

/** the table toolbar's own tools: Undo, the pause offer, Concede match. An
 * offer under way or Concede's question is the row under the toolbar (askHtml) */
function tableToolsHtml(v: MatchRoomView, live: boolean): string {
  const w = v.w;
  const p = w.pause;
  return (live ? iconButton({ label: 'Undo', icon: 'undo', dataBtn: 'cc-undo', disabled: !v.undo }) : '')
    + (!w.locked && (!p || p.offeredBy === null)
      ? iconButton({ label: 'Offer pause', icon: 'pause', dataBtn: 'cc-pause' }) : '')
    + (v.concedeAsk ? '' : iconButton({ label: 'Concede match', iconHtml: '<span class="ccflag" aria-hidden="true">🏳</span>', dataBtn: 'cc-concede' }));
}

/** a question waiting on this player, in one row under the toolbar: Concede
 * match asked, a pause offered (by them: accept or decline; by me: withdraw) */
function askHtml(v: MatchRoomView): string {
  const w = v.w;
  const them = esc(w.names[other(v.seat)] || 'Your opponent');
  const p = w.locked ? null : w.pause;
  const pause = !p || p.offeredBy === null ? ''
    : p.offeredBy === v.seat ? '<span class="ccsbaskpause"><span class="dim">You offered a pause.</span> <button data-btn="cc-unpause">Withdraw</button></span>'
      : `<span class="ccsbaskpause"><span>${them} offers to pause the match.</span>
        <button class="primary" data-btn="cc-pause">Accept pause</button> <button data-btn="cc-unpause">Decline</button></span>`;
  const concede = v.concedeAsk ? concedeHtml(true) : '';
  return pause || concede ? `<div class="ccsbask" role="status">${concede}${pause}</div>` : '';
}

function concedeHtml(concedeAsk: boolean): string {
  return concedeAsk
    ? `<span class="ccconcede">Concede the match? You lose it. <button data-btn="cc-concede-yes">Concede match</button>
        <button data-btn="cc-concede-no">Keep playing</button></span>`
    : '<button data-btn="cc-concede">🏳 Concede match</button>';
}

/** game 1, before the deal: each seat registers a CC-legal deck — the room
 * card's sections (pages/lobby.ts roomSection) */
function registerHtml(v: MatchRoomView): string {
  const w = v.w;
  const me = v.seat, opp = other(me);
  const pick = v.pick;
  return roomSection(shareBar('Send your opponent the room code', v.room, v.link))
    + roomSection(v.friends)
    + roomSection(w.mine ? '' : `<div class="lobbypanel deckpicker">
      ${settingRow({ label: 'Your deck for the match', controlHtml: ccDeckSelectHtml(v.decks, pick),
        hintHtml: 'Main deck and sideboard. You can swap between games, never before game 1.' })}
      <button class="cta primary" data-btn="cc-register" ${pick ? '' : 'disabled'}>Play this deck</button>
    </div>`)
    + roomSection(`<div class="lobbyfoot"><div class="lobbyseats">
      <span class="lobbyseat"><i class="seatdot${w.ready[me] ? ' ready' : ''}"></i>
        <span>${esc(v.names[me] ?? 'You')} (you) — ${w.ready[me] ? '<b class="lockedin">deck is in</b>' : '<span class="dim">pick a deck above</span>'}</span></span>
      <span class="lobbyseat"><i class="seatdot${w.ready[opp] ? ' ready' : v.peers[opp] ? '' : ' away'}"></i>
        <span>${esc(v.names[opp] ?? 'Opponent')} — ${w.ready[opp] ? '<b class="lockedin">deck is in</b>'
          : `<span class="dim">${v.peers[opp] ? 'choosing a deck…' : 'not here yet'}</span>`}</span></span>
    </div></div>`, 'roomsec--foot');
}

/** the paused screen (sideboarding itself is the table below) */
function pausedHtml(v: MatchRoomView): string {
  const w = v.w;
  const me = v.seat, opp = other(me);
  const them = esc(w.names[opp] || 'Your opponent');
  const p = w.pause;
  // the server's deadline (a league week can end before the 7 days)
  const until = p?.voidAt ?? (p?.pausedAt ?? v.now) + PAUSE_DAYS_MS;
  const asked = !!p?.resume[me];
  const here = v.peers[opp];
  return roomSection(scoreboardHtml(v)) + roomSection(`<div class="lobbypanel ccpaused">
        <div class="zonelabel">Paused</div>
        <p>Paused — resume any time before ${esc(dayText(until))}.</p>
        ${asked ? `<p class="hint">Waiting for ${them} to resume…</p>`
          : `<button class="cta primary" data-btn="cc-resume" ${here ? '' : 'disabled'}>Resume</button>
             ${here ? (p?.resume[opp] ? `<p class="hint">${them} wants to resume.</p>` : '') : `<p class="hint">${them} is not here — you both need to be.</p>`}`}
      </div>`)
    + roomSection(`<div class="ccfoot">${concedeHtml(v.concedeAsk)}</div>`, 'roomsec--foot');
}

/**
 * THE SIDEBOARDING TABLE (docs/22 §5.4; owner 2026-11-03, "like MTGO"; BL-65
 * 2026-11-04, the builder's table). The page is the frame. Toolbar: Leave, the
 * room, the score and the countdown, both clocks, the opponent's ready dot,
 * Undo, pause, concede. Then the table (pages/table.ts): the deck as piles by
 * cost on the felt, the Sideboard in the rail, and at its foot this game's
 * deck — Main n · Side n/7, the verdict, back to the registered deck, Ready.
 * Locked (the window is over and the loser is choosing), the same table, not
 * editable. No pool: only the registered cards are on it.
 */
function sideboardTableHtml(v: MatchRoomView): string {
  const w = v.w;
  const t = v.table ?? TABLE_DEFAULT;
  const cfg = v.shown!;
  const live = !w.locked;
  const why = live ? legalityLine(w.mine!.registered, cfg) : null;
  const short = cfg.main.length < 30, over = cfg.side.length > SIDEBOARD_MAX;
  const verdict = why
    ? statusMessage({ tag: 'p', className: 'deckmsg cclegal', text: why })
    : `<span class="ccsbok">${live ? '✓ Legal' : 'Locked in'}</span>`;
  const foot = `<footer class="ccsbbar">
      <div class="ccsbdeckline">
        <div class="ccsbverdict"><span class="ccsbcounts">Main <b class="${short ? 'bad' : ''}">${cfg.main.length}</b>
          · Side <b class="${over ? 'bad' : ''}">${cfg.side.length}/${SIDEBOARD_MAX}</b></span>
          ${verdict}</div>
        ${v.error ? statusMessage({ tag: 'p', tone: 'error', className: 'pageerr', text: v.error }) : ''}
      </div>
      ${readyHtml(v, !why, live ? resetHtml(w, cfg) : '')}
    </footer>`;
  const table = tableHtml({
    cw: t.cw, ch: t.ch, piles: deckPiles(cfg.main, w.mine!.piles, live, t), newPiles: null,
    zoneAttrs: { 'data-cc-zone': 'main' },
    headHtml: `<div class="tthead"><span class="ttheadlabel">Main deck</span><b class="ttheadcount${short ? ' bad' : ''}">${cfg.main.length}</b></div>`,
    rail: { side: sidePile(cfg.side, live, t), sideAttrs: { 'data-cc-zone': 'side' } },
    footHtml: foot,
    className: live ? 'ccsbwrap' : 'ccsbwrap ccsblocked',
    scrollKey: 'cc-table',
  });
  // `ccpage` stays the root's LAST class (ui/report.ts pageOf reads it); `ccsbtable` marks this screen
  return frameHtml({
    page: 'ccsbtable ccpage',
    title: `${matchKind(w)} — Best of ${w.bestOf} — room ${v.room}`,
    titleHtml: `${matchKind(w)}<span class="ccsbbo"> — Best of ${w.bestOf}</span><small>room <span class="roomcode">${esc(v.room)}</span></small>`,
    back: { dataBtn: 'gohome', label: 'Leave' },
    centerHtml: tableMatchHtml(v),
    toolsHtml: tableToolsHtml(v, live),
    chrome: v.chrome, fill: true, bleed: true, wide: true,
    mainHtml: askHtml(v) + table,
  });
}

/** the match is over (or void) while this page was waiting on it */
function endedHtml(v: MatchRoomView, m: MatchSummary): string {
  return roomSection(`<div class="lobbypanel ccover">${matchResultHtml(m, v.seat, v.names)}
    <button class="cta" data-btn="gohome">Return to home</button></div>`);
}

/** "You win the match 2–1" / "Rashi wins the match" / "closed with no result".
 * Pure; the post-game screen draws it too (pages/postgame.ts). */
export function matchResultHtml(m: MatchSummary, seat: Seat, names: [string, string]): string {
  if (m.phase === 'void') return '<div class="ccresult">The match closed with no result.</div>';
  const r = m.result;
  if (!r) return '';
  const won = r.winner === seat;
  // the winner's games first, as a result is read out
  const score = `${m.score[r.winner]}–${m.score[other(r.winner)]}`;
  const how = r.how === 'conceded'
    ? (r.concededBy === seat ? 'You conceded.' : `${esc(names[r.concededBy ?? other(seat)] ?? 'Your opponent')} conceded.`)
    : r.how === 'time' ? (won ? `${esc(names[other(seat)] ?? 'Your opponent')} ran out of time.` : 'You ran out of time.') : '';
  return `<div class="ccresult ${won ? 'won' : 'lost'}"><b>${won ? 'You win the match' : `${esc(names[r.winner] ?? 'Your opponent')} wins the match`} ${score}.</b> ${how}${gamesHtml(m, seat, names)}</div>`;
}

/** BL-55: each game's winner under a Bo3's result — "Game 1: you won ·
 * Game 2: Bo won (conceded)". A Bo1's one game is the match line itself, and
 * an older server sends no `games`: nothing. */
function gamesHtml(m: MatchSummary, seat: Seat, names: [string, string]): string {
  const games = m.games ?? [];
  if (m.bestOf !== 3 || !games.length) return '';
  const line = games.map((g, i) => {
    const who = g.winner === null ? 'no result'
      : g.winner === seat ? 'you won' : `${esc(names[g.winner] || 'your opponent')} won`;
    const note = g.how === 'conceded' ? ' (conceded)' : g.how === 'time' ? ' (on time)' : '';
    return `Game ${i + 1}: ${who}${g.winner === null ? '' : note}`;
  }).join(' · ');
  return `<div class="ccgames dim">${line}</div>`;
}

/** The whole waiting page of a match room. Pure. */
export function matchRoomHtml(v: MatchRoomView): string {
  const w = v.w;
  // between games and not paused: the sideboarding table is the whole page
  if (!v.ended && !registering(v, w) && w.phase !== 'paused' && w.mine && v.shown) return sideboardTableHtml(v);
  const reg = !v.ended && registering(v, w);
  const card = v.ended ? endedHtml(v, v.ended)
    : reg ? registerHtml(v)
      : w.mine ? pausedHtml(v)
        : roomSection('<p class="hint">Waiting for the match…</p>');
  // the room in the frame (pages/lobby.ts roomFrameHtml); `ccpage` stays the
  // root's LAST class (report.ts pageOf)
  return roomFrameHtml({
    page: 'ccpage', kind: `${matchKind(w)} — Best of ${w.bestOf}`, room: v.room, chrome: v.chrome,
    cardHtml: card + roomSection(v.error ? statusMessage({ tag: 'p', tone: 'error', className: 'pageerr', text: v.error }) : ''),
    footHtml: reg ? '<p class="homefoot">Game 1 deals when both decks are in. Initiative is random.</p>' : '',
  });
}

/** Paint a match room into `app` and wire it (pages/waiting.ts's dispatch).
 * `rerender` is main.ts renderWaiting. */
export function paintMatchRoom(app: HTMLElement, seat: MatchSeatView, w: MatchLobbyInfo, error: string, rerender: () => void): void {
  const view = (): MatchRoomView => matchRoomView(seat, w, acct.token() ? dk.competitiveDecks() : null, error);
  let v = view();
  paintFrame(app, matchRoomHtml(v));
  // the sideboarding table: the table region's real height, so its piles'
  // strips fit it — painted once more if the first paint guessed it wrong
  const pane = typeof app.querySelector === 'function' ? app.querySelector<HTMLElement>('.ccsbtable .tttable') : null;
  if (pane && pane.clientHeight > 0) {
    paneSeen = pane.clientHeight;
    if (Math.abs(paneSeen - (v.table?.paneH ?? 0)) > 8) { v = view(); paintFrame(app, matchRoomHtml(v)); }
  }
  if (acct.token()) dk.ensureCollection(rerender);
  wireDeckSelect(rerender);
}
