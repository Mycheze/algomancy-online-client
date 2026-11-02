/* Competitive Constructed — THE MATCH SCREENS (docs/22 §5, §6.1).
 *
 * Everything a Competitive match draws outside the board: the home screen's
 * Competitive card and its "Your matches" row, the game-1 waiting room where
 * each seat registers a deck, and the BETWEEN screen — score, frozen clocks,
 * the sideboarding window, the presets, Ready (the previous game's loser
 * readies WITH the initiative choice: owner, docs/22 §8 answer 1), pause and
 * resume, and Concede match. ui/main.ts gains only the dispatch.
 *
 * The server is server/match.ts; the wire is docs/22 §5.8. This screen holds
 * ONE thing of its own: a configuration the player is part-way through. A tap
 * moves one copy across, and the in-between steps of a swap are illegal (31 →
 * 30 → 29 → 30), while the server refuses an illegal configuration outright
 * and keeps the last legal one. So the draft lives here, the legality line and
 * Ready read it, and only a LEGAL draft is sent — which is also why "the lock
 * deals the last legal one" can never cost a player a half-made swap they did
 * not see.
 *
 * Touch-first (a 120 s window on an iPad): every move is one tap on a visible
 * button; nothing here needs hover or a right-click.
 */
import { applyPreset, checkSwap, SIDEBOARD_MAX, type MatchConfig, type SwapPreset } from '../engine/src/matchdeck.ts';
import type { Seat } from '../engine/src/types.ts';
import { roomFriendsHtml } from './inbox.ts';
import { esc, shareBar } from './util.ts';

// ── the wire (server/match.ts) ───────────────────────────────────────

export type MatchPhase = 'game' | 'between' | 'paused' | 'over' | 'void';

/** `waiting.match` — this seat's view of the match, built per seat. The
 * opponent's deck is never in it: `ready` is all it says about them. */
export interface MatchLobbyInfo {
  id: string; bestOf: 1 | 3; game: number;
  score: [number, number]; names: [string, string];
  banks: [number, number]; clockStart: number;
  phase: MatchPhase;
  chooser: Seat | null; initiative: Seat | null;
  until: number | null; locked: boolean;
  ready: [boolean, boolean];
  mine: { registered: MatchConfig; current: MatchConfig; presets: SwapPreset[] } | null;
  pause?: { offeredBy: Seat | null; pausedAt: number | null; resume: [boolean, boolean] };
  result?: MatchResult;
}

export interface MatchResult { winner: Seat; how: 'games' | 'conceded' | 'time'; at: number; concededBy?: Seat }

/** the public summary every in-game push, `gameover` and `{t:'match'}` carry */
export interface MatchSummary {
  id: string; bestOf: 1 | 3; score: [number, number]; game: number;
  phase: MatchPhase; room: string;
  result?: MatchResult; voided?: { at: number; why: string };
}

/** a row of `/api/matches/mine` */
export interface MyMatch {
  id: string; bestOf: 1 | 3; seat: Seat; opponent: string; score: [number, number]; game: number;
  phase: MatchPhase; room: string; pausedAt: number | null; until: number | null; voidAt: number | null;
}

/** a deck in the collection with its Competitive verdict (ui/decks.ts competitiveDecks) */
export interface CcDeck { id: string; name: string; error: string | null }

/** owner, docs/22 §0: a paused match closes after 7 days */
const PAUSE_DAYS_MS = 7 * 24 * 3600_000;

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

/** the page that plays a match room: the room, the seat, and that it is a
 * match room (`cc=1`: the join never brings the casual deck) */
export const matchLink = (room: string, seat: Seat): string =>
  `?ws=1&room=${encodeURIComponent(room)}&seat=${seat}&mode=constructed&cc=1`;

// ── module state ─────────────────────────────────────────────────────

/** the home card's Best-of choice — Bo3 by default (§6.1); a post-game "New
 * match" link brings the last one back as `?bo=1` */
let bestOf: 1 | 3 = (() => {
  try { return new URLSearchParams(location.search).get('bo') === '1' ? 1 : 3; } catch { return 3; }
})();
/** the deck this browser brings to a match (home card, game-1 waiting room) */
let pickId: string | null = null;
/** the configuration being worked out, keyed to the match and game it is for */
let draft: { key: string; cfg: MatchConfig } | null = null;
/** Concede match asks once before it counts */
let concedeAsk = false;
/** "Your matches": null until the first answer */
let mine: MyMatch[] | null = null;
let mineLoading = false;

// ── small words ──────────────────────────────────────────────────────

function clock(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = (n: number): string => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

/** "you lead 1–0", "you trail 0–1", "1–1" — from this seat's side */
export function scoreWords(score: [number, number], seat: Seat): string {
  const a = score[seat] ?? 0, b = score[other(seat)] ?? 0;
  return a > b ? `you lead ${a}–${b}` : a < b ? `you trail ${a}–${b}` : `${a}–${b}`;
}

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
const sameBoards = (a: MatchConfig, b: MatchConfig): boolean => {
  const k = (l: readonly string[]): string => [...l].sort().join('\n');
  return k(a.main) === k(b.main) && k(a.side) === k(b.side);
};

/** the legality line, in the player's words; null when the draft is legal */
function legalityLine(registered: MatchConfig, cfg: MatchConfig): string | null {
  const c = checkSwap(registered, cfg);
  if (c.ok) return null;
  if (cfg.main.length < 30) return `Main deck needs 30 — you have ${cfg.main.length}.`;
  if (cfg.side.length > SIDEBOARD_MAX) return `Sideboard holds ${SIDEBOARD_MAX} — you have ${cfg.side.length}.`;
  return c.error.charAt(0).toUpperCase() + c.error.slice(1) + '.';
}

// ── the draft ────────────────────────────────────────────────────────

const keyOf = (w: MatchLobbyInfo): string => `${w.id}:${w.game}`;

/** what this seat's panel shows: the draft if one is under way, else the server's */
function shown(w: MatchLobbyInfo): MatchConfig | null {
  if (!w.mine) return null;
  return draft && draft.key === keyOf(w) ? draft.cfg : w.mine.current;
}

/** a push arrived: a draft the server now holds is no longer a draft */
export function onLobby(w: MatchLobbyInfo): void {
  if (!draft) return;
  if (draft.key !== keyOf(w) || !w.mine || w.locked || w.phase !== 'between' || sameBoards(draft.cfg, w.mine.current)) {
    draft = null;
  }
}

/** move one copy of `card` off `from`, onto the other board */
function moved(cfg: MatchConfig, from: 'main' | 'side', card: string): MatchConfig | null {
  const src = [...cfg[from]];
  const i = src.lastIndexOf(card);
  if (i < 0) return null;
  src.splice(i, 1);
  return from === 'main'
    ? { main: src, side: [...cfg.side, card] }
    : { main: [...cfg.main, card], side: src };
}

// ── the home card ────────────────────────────────────────────────────

/** the deck the card and the game-1 room offer first: the last pick if it is
 * still legal, else the first legal deck */
function pickOf(decks: CcDeck[]): CcDeck | null {
  const legal = decks.filter(d => !d.error);
  return legal.find(d => d.id === pickId) ?? legal[0] ?? null;
}

/** the CC-legal picker: an illegal deck is listed greyed, with its reason */
function deckSelectHtml(decks: CcDeck[] | null): string {
  if (!decks) return '<div class="hint">loading your decks…</div>';
  if (!decks.length) return '<div class="hint">No decks yet — build one under 🗂 My decks.</div>';
  const pick = pickOf(decks);
  const opts = decks.map(d => d.error
    ? `<option value="${esc(d.id)}" disabled>${esc(d.name)} — ${esc(d.error)}</option>`
    : `<option value="${esc(d.id)}" ${pick?.id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  return `<select id="cc-deck" class="deckselect">
      ${pick ? '' : '<option value="" selected disabled>no deck is Competitive legal yet</option>'}${opts}
    </select>`;
}

/**
 * docs/22 §6.1 — the Competitive card, beside Constructed. Best of 1 or 3
 * (Bo3 first), the CC-legal decks, and New match. A match hangs off two
 * accounts, so signed out the card says so and offers the sign-in.
 */
export function competitiveCardHtml(signedIn: boolean, decks: CcDeck[] | null): string {
  const head = `<h2>Competitive</h2>
    <p class="cardsub">Constructed with a sideboard of up to 7. 45 minutes each for the whole match.</p>`;
  if (!signedIn) {
    return `<div class="homecard offer cccard">${head}
      <p class="hint">Sign in to play a Competitive match.</p>
      <div class="spacer"></div>
      <button class="cta" data-btn="acct-open-auth">Log in / Sign up</button>
    </div>`;
  }
  const pick = decks ? pickOf(decks) : null;
  return `<div class="homecard offer cccard">${head}
    <div class="ccbo" role="group" aria-label="match length">
      ${([3, 1] as const).map(n => `<button class="${bestOf === n ? 'on' : ''}" data-btn="cc-bo" data-bo="${n}" aria-pressed="${bestOf === n}">Best of ${n}</button>`).join('')}
    </div>
    ${deckSelectHtml(decks)}
    <div class="spacer"></div>
    <button class="cta primary" data-btn="cc-new" ${pick ? '' : 'disabled'}>New match${pick ? '' : ' — pick a deck first'}</button>
  </div>`;
}

/** wire the picker's <select> after a paint that holds it */
export function wireDeckSelect(rerender: () => void): void {
  const sel = typeof document !== 'undefined' ? document.getElementById('cc-deck') as HTMLSelectElement | null : null;
  sel?.addEventListener?.('change', () => { pickId = sel.value || null; rerender(); });
}

/** New match: reserve a code, then open the room as its creator */
function newMatch(decks: CcDeck[] | null, fail: (msg: string) => void): void {
  const pick = decks ? pickOf(decks) : null;
  if (!pick) return;
  fetch('/api/new').then(async r => {
    const j = await r.json() as { code?: string; error?: string };
    if (!r.ok || !j.code) { fail(j.error ?? 'could not start a match'); return; }
    location.search = `?ws=1&room=${encodeURIComponent(j.code)}&seat=0&mode=constructed&bo=${bestOf}&ccdeck=${encodeURIComponent(pick.id)}`;
  }).catch(() => fail('could not reach the server'));
}

// ── "Your matches" (§5.6: a paused match is always one button away) ──

/** ask once per page; a loaded or loading list returns BARE (a render passes
 * this its own repaint — see ensureCollection's 2,696-repaint note) */
export function loadMyMatches(headers: Record<string, string> | null, rerender: () => void): void {
  if (!headers || mine || mineLoading) return;
  mineLoading = true;
  let asked: Promise<unknown>;
  try { asked = fetch('/api/matches/mine', { headers }); } catch { asked = Promise.reject(new Error('no fetch')); }
  asked
    .then(r => (r as Response).json() as Promise<{ ok?: boolean; matches?: MyMatch[] }>)
    .then(r => { mine = r.ok ? r.matches ?? [] : []; })
    .catch(() => { mine = []; })
    .finally(() => { mineLoading = false; if (mine?.length) rerender(); });
}

/** forget the list (signing out) */
export function resetMyMatches(): void { mine = null; mineLoading = false; }

/** one open match, as a line and a button — shared with the bell */
export function myMatchLine(m: MyMatch, now = Date.now()): { text: string; button: string } {
  const days = Math.max(0, Math.floor((now - (m.pausedAt ?? now)) / 86_400_000));
  const where = m.phase === 'paused'
    ? `paused ${days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}`
    : m.phase === 'between' ? `game ${m.game} of ${m.bestOf} — sideboarding`
      : `game ${m.game} of ${m.bestOf}`;
  return {
    text: `vs <b>${esc(m.opponent || 'your opponent')}</b> · ${esc(scoreWords(m.score, m.seat))} · ${esc(where)}`,
    button: m.phase === 'paused' ? 'Resume' : 'Open',
  };
}

export function yourMatchesHtml(): string {
  if (!mine?.length) return '';
  return `<div class="ccmine"><div class="zonelabel">Your matches</div>
    ${mine.map(m => {
      const l = myMatchLine(m);
      return `<div class="ccmatchrow"><span>${l.text}</span>
        <button class="primary" data-btn="cc-open" data-room="${esc(m.room)}" data-seat="${m.seat}">${l.button}</button></div>`;
    }).join('')}
  </div>`;
}

// ── the waiting room (game 1) and the between screen ─────────────────

/** what the waiting page needs from the socket client */
export interface MatchSeatView {
  room: string; seat: Seat; names: [string, string]; peers: [boolean, boolean];
  /** a match that ended while this page waited (a `{t:'match'}` with no room) */
  ended: MatchSummary | null;
}

function headerHtml(v: MatchSeatView, w: MatchLobbyInfo): string {
  return `<div class="lobbyhead">
      <h1 class="homelogo">ALGOMANCY</h1>
      <h2>Competitive — Best of ${w.bestOf} — room <span class="roomcode">${esc(v.room)}</span></h2>
      <div class="headbtns"><button data-btn="gohome">Leave</button></div>
    </div>`;
}

/** score, both frozen clocks, and the countdown (patched in place each second) */
function scoreboardHtml(v: MatchSeatView, w: MatchLobbyInfo): string {
  const me = v.seat, opp = other(me);
  const left = w.until !== null && w.phase === 'between' && !w.locked
    ? ` · <span class="cccount" data-cc-until="${w.until}">${clock(w.until - Date.now())}</span> to sideboard` : '';
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

function presetsHtml(w: MatchLobbyInfo, cfg: MatchConfig, live: boolean): string {
  const reg = w.mine!.registered;
  const btn = (attrs: string, label: string, on: boolean, why: string | null): string =>
    `<span class="ccpreset"><button class="${on ? 'on' : ''}" ${attrs} ${live && !why ? '' : 'disabled'}>${esc(label)}</button>${
      why ? `<span class="ccwhy">${esc(why)}</span>` : ''}</span>`;
  return `<div class="ccpresets">
    ${btn('data-btn="cc-preset" data-preset="registered"', 'Registered deck', sameBoards(cfg, reg), null)}
    ${w.mine!.presets.map(p => {
      const got = applyPreset(reg, p);
      const why = 'error' in got ? got.error : null;
      return btn(`data-btn="cc-preset" data-preset="${esc(p.id)}"`, p.name, !why && sameBoards(cfg, got as MatchConfig), why);
    }).join('')}
  </div>`;
}

/** Ready, with the loser's two buttons and never a default (§8 answer 1) */
function readyHtml(v: MatchSeatView, w: MatchLobbyInfo, legal: boolean): string {
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

function pauseHtml(v: MatchSeatView, w: MatchLobbyInfo): string {
  const me = v.seat, opp = other(me);
  const them = esc(w.names[opp] || 'Your opponent');
  if (w.locked) return '';
  const p = w.pause;
  if (!p || p.offeredBy === null) return '<button data-btn="cc-pause">Offer pause</button>';
  if (p.offeredBy === me) return `<span class="dim">You offered a pause.</span> <button data-btn="cc-unpause">Withdraw</button>`;
  return `<span>${them} offers to pause the match.</span>
    <button class="primary" data-btn="cc-pause">Accept pause</button> <button data-btn="cc-unpause">Decline</button>`;
}

function concedeHtml(): string {
  return concedeAsk
    ? `<span class="ccconcede">Concede the match? You lose it. <button data-btn="cc-concede-yes">Concede match</button>
        <button data-btn="cc-concede-no">Keep playing</button></span>`
    : '<button data-btn="cc-concede">🏳 Concede match</button>';
}

/** game 1, before the deal: each seat registers a CC-legal deck */
function registerHtml(v: MatchSeatView, w: MatchLobbyInfo, decks: CcDeck[] | null): string {
  const me = v.seat, opp = other(me);
  const link = `${location.origin}/${matchLink(v.room, opp)}`;
  const pick = decks ? pickOf(decks) : null;
  return `${shareBar('Send your opponent the room code', v.room, link)}
    ${roomFriendsHtml(!v.peers[opp])}
    ${w.mine ? '' : `<div class="lobbypanel deckpicker">
      <div class="zonelabel">Your deck for the match</div>
      <p class="hint">Main deck and sideboard. You can swap between games, never before game 1.</p>
      ${deckSelectHtml(decks)}
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
function betweenHtml(v: MatchSeatView, w: MatchLobbyInfo): string {
  const me = v.seat, opp = other(me);
  const them = esc(w.names[opp] || 'Your opponent');
  if (w.phase === 'paused') {
    const p = w.pause;
    const until = (p?.pausedAt ?? Date.now()) + PAUSE_DAYS_MS;
    const asked = !!p?.resume[me];
    const here = v.peers[opp];
    return `<div class="lobbypanel ccpaused">
        <div class="zonelabel">Paused</div>
        <p>Paused — resume any time before ${esc(dayText(until))}.</p>
        ${asked ? `<p class="hint">Waiting for ${them} to resume…</p>`
          : `<button class="cta primary" data-btn="cc-resume" ${here ? '' : 'disabled'}>Resume</button>
             ${here ? (p?.resume[opp] ? `<p class="hint">${them} wants to resume.</p>` : '') : `<p class="hint">${them} is not here — you both need to be.</p>`}`}
      </div>
      <div class="ccfoot">${concedeHtml()}</div>`;
  }
  const cfg = shown(w)!;
  const reg = w.mine!.registered;
  const live = !w.locked;
  const why = live ? legalityLine(reg, cfg) : null;
  return `<div class="lobbypanel ccside">
      <div class="zonelabel">${live ? 'Sideboarding — tap a card to move it across' : 'Your deck for this game'}</div>
      ${live ? presetsHtml(w, cfg, live) : ''}
      <div class="ccboards">
        <div class="ccboard"><h3>Main <span class="acctcount${cfg.main.length < 30 ? ' bad' : ''}">${cfg.main.length}</span></h3>${boardHtml(cfg, 'main', live)}</div>
        <div class="ccboard"><h3>Sideboard <span class="acctcount${cfg.side.length > SIDEBOARD_MAX ? ' bad' : ''}">${cfg.side.length}/${SIDEBOARD_MAX}</span></h3>${boardHtml(cfg, 'side', live)}</div>
      </div>
      ${why ? `<p class="deckmsg cclegal">${esc(why)}</p>` : ''}
    </div>
    ${readyHtml(v, w, !why)}
    <div class="ccfoot">${pauseHtml(v, w)} ${concedeHtml()}</div>`;
}

/** the match is over (or void) while this page was waiting on it */
function endedHtml(v: MatchSeatView, m: MatchSummary): string {
  return `<div class="lobbypanel ccover">${matchResultHtml(m, v.seat, v.names)}
    <button class="cta" data-btn="gohome">Return to home</button></div>`;
}

/** "You win the match 2–1" / "Rashi wins the match" / "closed with no result" */
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

/** the whole waiting page of a match room (main.ts renderWaiting's dispatch) */
export function matchWaitingHtml(v: MatchSeatView, w: MatchLobbyInfo, decks: CcDeck[] | null, err: string): string {
  const body = v.ended ? endedHtml(v, v.ended)
    : w.phase === 'game' && w.game === 1 ? registerHtml(v, w, decks)
      : w.mine ? `${scoreboardHtml(v, w)}${betweenHtml(v, w)}`
        : '<p class="hint">Waiting for the match…</p>';
  return `<div class="lobbypage ccpage">
    ${headerHtml(v, w)}
    ${body}
    ${err ? `<p class="deckmsg">${esc(err)}</p>` : ''}
  </div>`;
}

// ── clicks ───────────────────────────────────────────────────────────

/** what a click here may do through the socket client */
export interface MatchActions {
  /** the room's lobby payload, if this page is a match room */
  lobby(): MatchLobbyInfo | null;
  seat(): Seat;
  /** a `{t:'cc', …}` (or `{t:'concedeMatch'}`) on the room's socket */
  send(msg: Record<string, unknown>): void;
  /** game 1: register this deck (a join carrying its id) */
  register(deckId: string): void;
  decks(): CcDeck[] | null;
  fail(msg: string): void;
  rerender(): void;
}

/** a `cc-*` button. False when the button is not one of ours. */
export function handleMatchButton(btn: HTMLElement, a: MatchActions): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('cc-')) return false;
  const w = a.lobby();
  switch (b) {
    case 'cc-bo': bestOf = btn.dataset['bo'] === '1' ? 1 : 3; a.rerender(); return true;
    case 'cc-new': newMatch(a.decks(), a.fail); return true;
    case 'cc-open': {
      const seat: Seat = btn.dataset['seat'] === '1' ? 1 : 0;
      location.search = matchLink(btn.dataset['room'] ?? '', seat);
      return true;
    }
    case 'cc-register': {
      const decks = a.decks();
      const pick = decks ? pickOf(decks) : null;
      if (pick) a.register(pick.id);
      return true;
    }
    case 'cc-move': {
      if (!w?.mine || w.locked) return true;
      const from = btn.dataset['from'] === 'side' ? 'side' : 'main';
      const next = moved(shown(w)!, from, btn.dataset['card'] ?? '');
      if (!next) return true;
      draft = { key: keyOf(w), cfg: next };
      // only a legal configuration goes to the server — it would refuse the
      // rest and keep the last legal one, which is what the lock deals
      if (checkSwap(w.mine.registered, next).ok) a.send({ t: 'cc', op: 'config', main: next.main, side: next.side });
      a.rerender();
      return true;
    }
    case 'cc-preset':
      // the server's push of the new deck is the repaint
      draft = null;
      a.send({ t: 'cc', op: 'preset', preset: btn.dataset['preset'] ?? 'registered' });
      return true;
    case 'cc-ready': {
      if (!w) return true;
      if (btn.dataset['ready'] === '0') { a.send({ t: 'cc', op: 'ready', ready: false }); return true; }
      const init = btn.dataset['init'];
      a.send({ t: 'cc', op: 'ready', ready: true, ...(init === '0' || init === '1' ? { initiative: Number(init) } : {}) });
      return true;
    }
    case 'cc-pause': a.send({ t: 'cc', op: 'pause' }); return true;
    case 'cc-unpause': a.send({ t: 'cc', op: 'unpause' }); return true;
    case 'cc-resume': a.send({ t: 'cc', op: 'resume' }); return true;
    case 'cc-concede': concedeAsk = true; a.rerender(); return true;
    case 'cc-concede-no': concedeAsk = false; a.rerender(); return true;
    case 'cc-concede-yes': concedeAsk = false; a.send({ t: 'concedeMatch' }); a.rerender(); return true;
  }
  return false;
}

// ── the countdown ────────────────────────────────────────────────────

let ticking = false;
/** the sideboarding countdown, patched in place: ONE steady setInterval tick
 * (never a self-re-arming setTimeout — the headless suites boot this module,
 * memory: headless-suites-and-timers), and never a repaint of the page under
 * a player's finger */
export function installCountdown(): void {
  if (ticking || typeof window === 'undefined' || typeof document === 'undefined') return;
  ticking = true;
  window.setInterval(() => {
    const els = typeof document.querySelectorAll === 'function' ? document.querySelectorAll('[data-cc-until]') : [];
    for (const el of Array.from(els as ArrayLike<HTMLElement>)) {
      const until = Number(el.dataset?.['ccUntil'] ?? el.getAttribute?.('data-cc-until'));
      if (Number.isFinite(until)) el.textContent = clock(until - Date.now());
    }
  }, 500);
}
