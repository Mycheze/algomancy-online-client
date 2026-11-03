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
 * Touch-first (a 120 s window on an iPad): every move is one tap on a visible
 * button; nothing here needs hover or a right-click.
 */
import { checkSwap, SIDEBOARD_MAX, type MatchConfig } from '../../engine/src/matchdeck.ts';
import type { Seat } from '../../engine/src/types.ts';
import * as acct from '../account.ts';
import { button, statusMessage, toggle } from '../components/index.ts';
import * as dk from '../decks.ts';
import { roomFriendsHtml } from '../inbox.ts';
import {
  clock, matchLink, matchState, myMatchLine, pickOf, sameBoards, scoreWords, shown, wireDeckSelect,
  type CcDeck, type MatchLobbyInfo, type MatchSummary,
} from '../match.ts';
import { esc, shareBar } from '../util.ts';

/** owner, docs/22 §0: a paused match closes after 7 days */
const PAUSE_DAYS_MS = 7 * 24 * 3600_000;

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

function dayText(ms: number): string {
  try { return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
  catch { return new Date(ms).toDateString(); }
}

/** a multiset as name → count */
function counts(list: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of list) m.set(n, (m.get(n) ?? 0) + 1);
  return m;
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
  return `<select id="cc-deck" class="deckselect">
      ${pick ? '' : '<option value="" selected disabled>no deck is Competitive legal yet</option>'}${opts}
    </select>`;
}

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
  };
}

function headerHtml(v: MatchRoomView): string {
  const w = v.w;
  return `<div class="lobbyhead">
      <h1 class="homelogo">ALGOMANCY</h1>
      <h2>Competitive — Best of ${w.bestOf} — room <span class="roomcode">${esc(v.room)}</span></h2>
      <div class="headbtns">${button({ label: 'Leave', dataBtn: 'gohome' })}</div>
    </div>`;
}

/** score, both frozen clocks, and the countdown (patched in place each second) */
function scoreboardHtml(v: MatchRoomView): string {
  const w = v.w;
  const me = v.seat, opp = other(me);
  const left = w.until !== null && w.phase === 'between' && !w.locked
    ? ` · <span class="cccount" data-cc-until="${w.until}">${clock(w.until - v.now)}</span> to sideboard` : '';
  return `<div class="ccscore">
    <div class="ccgame">Game ${w.game} of ${w.bestOf} — ${esc(scoreWords(w.score, me))}${left}</div>
    <div class="ccbanks">Your clock <b>${clock(w.banks[me] ?? 0)}</b> · ${esc(w.names[opp] || 'Opponent')} <b>${clock(w.banks[opp] ?? 0)}</b>
      <span class="dim">of ${clock(w.clockStart)}</span></div>
  </div>`;
}

/** a board's cards as chips; a tap moves one copy across */
function boardHtml(cfg: MatchConfig, from: 'main' | 'side', live: boolean): string {
  const rows = [...counts(cfg[from])].sort((a, b) => a[0].localeCompare(b[0]));
  if (!rows.length) return '<p class="hint">Empty.</p>';
  return rows.map(([n, c]) => `<button class="ccchip" data-btn="cc-move" data-from="${from}" data-card="${esc(n)}"
      data-prev="${esc(n)}" ${live ? '' : 'disabled'}>${esc(n)}${c > 1 ? ` <b>×${c}</b>` : ''}</button>`).join('');
}

/** back to the deck as registered — one tap (docs/22 §8 Q3), off while it already is */
function resetHtml(w: MatchLobbyInfo, cfg: MatchConfig): string {
  const same = sameBoards(cfg, w.mine!.registered);
  return `<div class="ccreset"><button data-btn="cc-reset" ${same ? 'disabled' : ''}>Back to the registered deck</button></div>`;
}

/** Ready, with the loser's two buttons and never a default (§8 answer 1) */
function readyHtml(v: MatchRoomView, legal: boolean): string {
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
  const dot = `<span class="lobbyseat"><i class="seatdot${w.ready[opp] ? ' ready' : v.peers[opp] ? '' : ' away'}"></i>
      <span>${them}${w.ready[opp] ? ' — ready' : v.peers[opp] ? '' : ' — not here'}</span></span>`;
  const note = !legal ? '<span class="dim">Fix the deck to ready up.</span>' : '';
  let body: string;
  if (readyMe) {
    body = `<b class="lockedin">Ready ✓</b> ${choosing ? esc(choiceWords(w.initiative)) : ''}
      <button data-btn="cc-ready" data-ready="0">Not ready</button>`;
  } else if (choosing) {
    body = `<p>You lost the last game: you choose who takes the initiative.</p>
      ${two(['Ready — I take the initiative', 'Ready — they take it'], !legal)} ${note}`;
  } else {
    body = `<button data-btn="cc-ready" ${legal ? '' : 'disabled'}>Ready</button> ${note}`;
  }
  const chooserLine = !choosing && w.chooser !== null
    ? `<p class="hint">${w.initiative === null ? `${them} is choosing who takes the initiative…` : esc(choiceWords(w.initiative))}</p>` : '';
  return `<div class="ccready">${chooserLine}${body}<div class="lobbyseats">${dot}</div></div>`;
}

function pauseHtml(v: MatchRoomView): string {
  const w = v.w;
  const me = v.seat, opp = other(me);
  const them = esc(w.names[opp] || 'Your opponent');
  if (w.locked) return '';
  const p = w.pause;
  if (!p || p.offeredBy === null) return '<button data-btn="cc-pause">Offer pause</button>';
  if (p.offeredBy === me) return `<span class="dim">You offered a pause.</span> <button data-btn="cc-unpause">Withdraw</button>`;
  return `<span>${them} offers to pause the match.</span>
    <button class="primary" data-btn="cc-pause">Accept pause</button> <button data-btn="cc-unpause">Decline</button>`;
}

function concedeHtml(concedeAsk: boolean): string {
  return concedeAsk
    ? `<span class="ccconcede">Concede the match? You lose it. <button data-btn="cc-concede-yes">Concede match</button>
        <button data-btn="cc-concede-no">Keep playing</button></span>`
    : '<button data-btn="cc-concede">🏳 Concede match</button>';
}

/** game 1, before the deal: each seat registers a CC-legal deck */
function registerHtml(v: MatchRoomView): string {
  const w = v.w;
  const me = v.seat, opp = other(me);
  const pick = v.pick;
  return `${shareBar('Send your opponent the room code', v.room, v.link)}
    ${v.friends}
    ${w.mine ? '' : `<div class="lobbypanel deckpicker">
      <div class="zonelabel">Your deck for the match</div>
      <p class="hint">Main deck and sideboard. You can swap between games, never before game 1.</p>
      ${ccDeckSelectHtml(v.decks, pick)}
      <button class="cta primary" data-btn="cc-register" ${pick ? '' : 'disabled'}>Play this deck</button>
    </div>`}
    <div class="lobbyfoot"><div class="lobbyseats">
      <span class="lobbyseat"><i class="seatdot${w.ready[me] ? ' ready' : ''}"></i>
        <span>${esc(v.names[me] ?? 'You')} (you) — ${w.ready[me] ? '<b class="lockedin">deck is in</b>' : '<span class="dim">pick a deck above</span>'}</span></span>
      <span class="lobbyseat"><i class="seatdot${w.ready[opp] ? ' ready' : v.peers[opp] ? '' : ' away'}"></i>
        <span>${esc(v.names[opp] ?? 'Opponent')} — ${w.ready[opp] ? '<b class="lockedin">deck is in</b>'
          : `<span class="dim">${v.peers[opp] ? 'choosing a deck…' : 'not here yet'}</span>`}</span></span>
    </div></div>
    <p class="homefoot">Game 1 deals when both decks are in. Initiative is random.</p>`;
}

/** sideboarding, Ready, pause and concede — or the paused screen */
function betweenHtml(v: MatchRoomView): string {
  const w = v.w;
  const me = v.seat, opp = other(me);
  const them = esc(w.names[opp] || 'Your opponent');
  if (w.phase === 'paused') {
    const p = w.pause;
    // the server's deadline (a league week can end before the 7 days)
    const until = p?.voidAt ?? (p?.pausedAt ?? v.now) + PAUSE_DAYS_MS;
    const asked = !!p?.resume[me];
    const here = v.peers[opp];
    return `<div class="lobbypanel ccpaused">
        <div class="zonelabel">Paused</div>
        <p>Paused — resume any time before ${esc(dayText(until))}.</p>
        ${asked ? `<p class="hint">Waiting for ${them} to resume…</p>`
          : `<button class="cta primary" data-btn="cc-resume" ${here ? '' : 'disabled'}>Resume</button>
             ${here ? (p?.resume[opp] ? `<p class="hint">${them} wants to resume.</p>` : '') : `<p class="hint">${them} is not here — you both need to be.</p>`}`}
      </div>
      <div class="ccfoot">${concedeHtml(v.concedeAsk)}</div>`;
  }
  const cfg = v.shown!;
  const reg = w.mine!.registered;
  const live = !w.locked;
  const why = live ? legalityLine(reg, cfg) : null;
  return `<div class="lobbypanel ccside">
      <div class="zonelabel">${live ? 'Sideboarding — tap a card to move it across' : 'Your deck for this game'}</div>
      ${live ? resetHtml(w, cfg) : ''}
      <div class="ccboards">
        <div class="ccboard"><h3>Main <span class="acctcount${cfg.main.length < 30 ? ' bad' : ''}">${cfg.main.length}</span></h3>${boardHtml(cfg, 'main', live)}</div>
        <div class="ccboard"><h3>Sideboard <span class="acctcount${cfg.side.length > SIDEBOARD_MAX ? ' bad' : ''}">${cfg.side.length}/${SIDEBOARD_MAX}</span></h3>${boardHtml(cfg, 'side', live)}</div>
      </div>
      ${why ? statusMessage({ tag: 'p', className: 'deckmsg cclegal', text: why }) : ''}
    </div>
    ${readyHtml(v, !why)}
    <div class="ccfoot">${pauseHtml(v)} ${concedeHtml(v.concedeAsk)}</div>`;
}

/** the match is over (or void) while this page was waiting on it */
function endedHtml(v: MatchRoomView, m: MatchSummary): string {
  return `<div class="lobbypanel ccover">${matchResultHtml(m, v.seat, v.names)}
    <button class="cta" data-btn="gohome">Return to home</button></div>`;
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
  return `<div class="ccresult ${won ? 'won' : 'lost'}"><b>${won ? 'You win the match' : `${esc(names[r.winner] ?? 'Your opponent')} wins the match`} ${score}.</b> ${how}</div>`;
}

/** The whole waiting page of a match room. Pure. */
export function matchRoomHtml(v: MatchRoomView): string {
  const w = v.w;
  const body = v.ended ? endedHtml(v, v.ended)
    : registering(v, w) ? registerHtml(v)
      : w.mine ? `${scoreboardHtml(v)}${betweenHtml(v)}`
        : '<p class="hint">Waiting for the match…</p>';
  return `<div class="lobbypage ccpage">
    ${headerHtml(v)}
    ${body}
    ${v.error ? statusMessage({ tag: 'p', className: 'deckmsg', text: v.error }) : ''}
  </div>`;
}

/** Paint a match room into `app` and wire it (pages/waiting.ts's dispatch).
 * `rerender` is main.ts renderWaiting. */
export function paintMatchRoom(app: HTMLElement, seat: MatchSeatView, w: MatchLobbyInfo, error: string, rerender: () => void): void {
  app.innerHTML = matchRoomHtml(matchRoomView(seat, w, acct.token() ? dk.competitiveDecks() : null, error));
  if (acct.token()) dk.ensureCollection(rerender);
  wireDeckSelect(rerender);
}
