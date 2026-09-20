/* The post-game screen.
 *
 * A game used to end with one line in the prompt bar — "Rashi wins." — over a
 * board nobody could touch any more. That is the wrong shape for the end of an
 * hour of play: you want to see what happened, and then you want to press
 * something.
 *
 * So: who won, both players' numbers side by side, whatever the game unlocked,
 * and three ways out. The numbers come from the same summarizeGame() that
 * feeds the profile (server/stats.ts), which is what stops this screen and
 * your stats page from ever disagreeing about the game you just played.
 */
import { ALL_ELEMENTS } from '../engine/src/apply.ts';
import { esc } from './util.ts';
import { isGuest } from './account.ts';

/** NB: the wire carries more fields than the client reads (e.g. a per-seat
 * `won` — this screen reads GameOver.winner instead) — only what the UI
 * renders is declared here. */
export interface SeatStats {
  name: string;
  cards: Record<string, number>;
  unitsPlayed: number; spellsPlayed: number; tokensCast: number; modsApplied: number;
  cardElements: Record<string, number>;
  recycled: Record<string, number>;
  resourcesActivated: number; abilitiesActivated: number;
  attacksDeclared: number; unitsAttackedWith: number;
  damageDealt: number; lifeLost: number; unitsLost: number; unitsKilled: number;
  cardsDrafted: number; lifeLeft: number;
}

export interface GameOver {
  seat: 0 | 1;
  winner: 0 | 1 | null;
  names: [string, string];
  mode: string;
  els: string[];
  turns: number;
  /**
   * BL-37 — how long the match took, in ms of live table time. The owner:
   * *"a global wall-clock match timer — literal elapsed time, not
   * double-counting per-player time."*
   *
   * ⚠ ABSENT, NOT ZERO, when it is unknown — a game restored from a file
   * written before the timer existed carries no number, and printing 0:00 for
   * it would be a measurement nobody took. The line is omitted instead.
   */
  matchMs?: number;
  seats: [SeatStats, SeatStats];
  rematch: [boolean, boolean];
  rematchRoom: string | null;
  /** it went into somebody's profile */
  recorded: boolean;
  /** R298: a single card duel — the card per seat. Counted toward nothing of
   * either player's; it moves the two cards on the card ladder. */
  single?: [string, string];
  unlocked?: { id: string; name: string; desc: string; icon: string }[];
  /**
   * R290 — present only when a concede decided the game: who conceded, on
   * which game turn, and how much the server says it weighed. The WEIGHT is
   * the server's word, not something this screen works out from the turn —
   * the thresholds are named once, in server/concession.ts, and the client
   * must not carry a copy that can drift.
   *   walkover  turn 1: not a game, counted nowhere, conceder −5 rating
   *   early     turn 2: counts, half rating weight, no fast-game feats
   *   normal    turn 3+: an ordinary result
   */
  concession?: { seat: 0 | 1; turn: number; weight: 'walkover' | 'early' | 'normal' };
}

/**
 * R290 — the one line the post-game screen adds for a concession that did
 * not weigh as a full game. Empty for a normal concession (turn 3+): the
 * owner's ruling is that such a player "is dead and just concedes to save
 * time", and the screen should not say anything a lethal blow would not.
 */
export function concessionNote(o: GameOver): string {
  const c = o.concession;
  // the weights only mean anything for a game that went into a profile — a
  // test-mode or signed-out game is left, not conceded, and the note is noise
  if (!o.recorded || !c || c.weight === 'normal') return '';
  const who = c.seat === o.seat ? 'You' : esc(o.names[c.seat] ?? 'Your opponent');
  if (c.weight === 'walkover') {
    return `Walkover — not counted (${who} conceded on turn ${c.turn}). `
      + 'Not a game: no stats, no achievements, no rated game for either player; '
      + 'the conceder loses a few rating points and the winner gains nothing.';
  }
  return `Early concession — half weight (${who} conceded on turn ${c.turn}). `
    + 'It counts as a win and a loss, moves ratings at half the usual amount, '
    + 'and is left out of the fast-game achievements.';
}

/** the engine's own element list (string-typed to fit the weight records) */
const ELEMENTS: readonly string[] = ALL_ELEMENTS;

/** the element a player leaned on this game — argmax of what they played */
function leaned(weights: Record<string, number>): string | null {
  let best: string | null = null;
  for (const el of ELEMENTS) {
    if ((weights[el] ?? 0) > 0 && (!best || weights[el]! > weights[best]!)) best = el;
  }
  return best;
}

/**
 * BL-37 — the match length, read the way a person says it: "1h 12m", "47m",
 * "3m". Never seconds above a minute (nobody tunes a clock to the second) and
 * never a bare "0m" (a game that took under a minute reads as "<1m", which is
 * a fact; "0m" reads as a bug).
 */
export function matchLength(ms: number): string {
  // ⚠ ASKED OF THE RAW MILLISECONDS, not of the rounded minutes: 40 seconds
  // rounds UP to one, and "1m" for a forty-second game is a small lie told
  // confidently. Under a minute is under a minute.
  if (ms < 60_000) return '<1m';
  const mins = Math.round(ms / 60_000);
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
}

/** One comparison row. `better` decides which side gets the highlight; pass
 * null for stats where more is not obviously better (life lost). */
interface Row { label: string; get: (s: SeatStats) => number; better?: 'high' | null }

const ROWS: Row[] = [
  { label: 'life left', get: s => s.lifeLeft, better: 'high' },
  { label: 'damage dealt', get: s => Math.round(s.damageDealt), better: 'high' },
  { label: 'units played', get: s => s.unitsPlayed, better: 'high' },
  { label: 'spells played', get: s => s.spellsPlayed, better: 'high' },
  { label: 'spell tokens cast', get: s => s.tokensCast, better: 'high' },
  { label: 'augments & grafts', get: s => s.modsApplied, better: 'high' },
  { label: 'units killed', get: s => s.unitsKilled, better: 'high' },
  { label: 'units lost', get: s => s.unitsLost, better: null },
  { label: 'attacks declared', get: s => s.attacksDeclared, better: 'high' },
  { label: 'units sent', get: s => s.unitsAttackedWith, better: 'high' },
  { label: 'cards drafted', get: s => s.cardsDrafted, better: 'high' },
  { label: 'resources opened', get: s => s.resourcesActivated, better: 'high' },
  { label: 'abilities used', get: s => s.abilitiesActivated, better: 'high' },
];

function statTableHtml(o: GameOver): string {
  const me = o.seat, opp = (o.seat === 0 ? 1 : 0) as 0 | 1;
  const rows = ROWS
    // a row that is 0–0 says nothing; drop it rather than pad the table
    .filter(r => r.get(o.seats[0]) || r.get(o.seats[1]))
    .map(r => {
      const a = r.get(o.seats[me]), b = r.get(o.seats[opp]);
      const lead = r.better === 'high' && a !== b ? (a > b ? 'me' : 'opp') : '';
      return `<tr>
        <td class="pgnum ${lead === 'me' ? 'lead' : ''}">${a.toLocaleString()}</td>
        <td class="pglabel">${esc(r.label)}</td>
        <td class="pgnum ${lead === 'opp' ? 'lead' : ''}">${b.toLocaleString()}</td>
      </tr>`;
    }).join('');

  const topCard = (s: SeatStats): string => {
    const best = Object.entries(s.cards).sort((x, y) => y[1] - x[1])[0];
    return best ? `${esc(best[0])}${best[1] > 1 ? ` ×${best[1]}` : ''}` : '—';
  };
  const el = (s: SeatStats): string => {
    const e = leaned(s.cardElements);
    return e ? `<span class="acctel ${e}">${e}</span>` : '—';
  };

  return `<table class="pgtable">
    <thead><tr>
      <th class="${o.winner === me ? 'pgwin' : ''}">${esc(o.names[me] ?? 'You')}</th>
      <th></th>
      <th class="${o.winner === opp ? 'pgwin' : ''}">${esc(o.names[opp] ?? 'Opponent')}</th>
    </tr></thead>
    <tbody>
      ${rows}
      <tr><td class="pgel">${el(o.seats[me])}</td><td class="pglabel">leaned on</td>
        <td class="pgel">${el(o.seats[opp])}</td></tr>
      <tr><td class="pgcard">${topCard(o.seats[me])}</td><td class="pglabel">most played</td>
        <td class="pgcard">${topCard(o.seats[opp])}</td></tr>
    </tbody>
  </table>`;
}

/**
 * BL-42 — "keep this account", for somebody who queued as a guest.
 *
 * ⚠ THIS IS A RENAME, NOT AN IMPORT. The game that just finished already
 * points at this account id, because a guest is an ordinary account that has
 * not been named yet — so there is nothing to migrate and nothing to claim by
 * matching names. That is the whole reason the guest is a real account rather
 * than a separate kind of session.
 *
 * Shown after the game rather than before it, which is the owner's ordering:
 * *"they can make their account to save things after the game"*.
 */
function guestClaimHtml(): string {
  if (!isGuest()) return '';
  return `<form class="pgclaim" data-form="pg-claim">
    <div class="pgclaimhead">Keep this game?</div>
    <div class="hint">You played as a guest. Sign up to keep this game and your rating.</div>
    <input name="username" placeholder="a name" autocomplete="username" maxlength="40">
    <input name="password" type="password" placeholder="a password" autocomplete="new-password">
    <button class="primary" data-btn="pg-claim">Keep it</button>
    <div class="hint pgclaimerr"></div>
  </form>`;
}

/** The rematch control, which is really four states wearing one button. */
function rematchHtml(o: GameOver): string {
  const me = o.seat, opp = (o.seat === 0 ? 1 : 0) as 0 | 1;
  const them = esc(o.names[opp] ?? 'Your opponent');
  if (o.rematchRoom) {
    return `<button class="primary" data-btn="pg-goto-rematch" data-room="${esc(o.rematchRoom)}">
      Starting the rematch…</button>`;
  }
  if (o.rematch[me]) {
    return `<button class="primary" disabled>Waiting for ${them}…</button>
      <button data-btn="pg-rematch-cancel">Never mind</button>`;
  }
  if (o.rematch[opp]) {
    return `<button class="primary pgwants" data-btn="pg-rematch">${them} wants a rematch — accept</button>`;
  }
  return `<button class="primary" data-btn="pg-rematch">Request rematch</button>`;
}

export function postGameHtml(o: GameOver): string {
  const me = o.seat;
  const won = o.winner === me;
  const drew = o.winner === null;
  const title = drew ? 'Game over' : won ? 'You win!' : `${esc(o.names[o.winner!] ?? 'Your opponent')} wins`;
  const sub = `${esc(o.single ? 'single card duel' : o.mode === 'draft' ? 'live draft' : o.mode)} · ${o.turns} turn${o.turns === 1 ? '' : 's'}`
    + (o.matchMs ? ` · ${matchLength(o.matchMs)}` : '');

  return `<div class="overlay pgover"><div class="pgbox ${drew ? '' : won ? 'won' : 'lost'}">
    <div class="pghead">
      <div class="pgtitle">${title}</div>
      <div class="pgsub">${sub}${o.els.length
        ? ` · ${o.els.map(el => `<span class="acctel ${el}">${el}</span>`).join('')}` : ''}</div>
    </div>

    ${statTableHtml(o)}

    ${o.unlocked?.length ? `<div class="pgunlocked">
      <div class="pgunlockedhead">Unlocked</div>
      ${o.unlocked.map(u => `<div class="pgach"><span class="achicon">${u.icon}</span>
        <span><b>${esc(u.name)}</b><br><span class="hint">${esc(u.desc)}</span></span></div>`).join('')}
    </div>` : ''}

    ${concessionNote(o) ? `<div class="pgnote pgweight ${o.concession!.weight}">${concessionNote(o)}</div>` : ''}
    <div class="pgnote">${o.single
      ? `${esc(o.single[o.seat])} vs ${esc(o.single[o.seat === 0 ? 1 : 0])}. ${o.single[0] === o.single[1]
          ? 'A mirror match — it moves nothing, anywhere.'
          : o.winner === null || o.concession?.weight === 'walkover'
            ? 'In the match history; it moves nothing on the card ladder.'
            : 'Rated the cards, not you — see the card ladder under 🏆 Metagame.'}`
      : o.recorded
      ? (o.concession?.weight === 'walkover' ? 'In your match history, marked as not counted.' : 'Recorded to your profile.')
      : 'Not recorded — nobody was signed in.'}</div>

    ${guestClaimHtml()}

    <div class="pgbtns">
      ${rematchHtml(o)}
      <button data-btn="pg-home">Return to home</button>
      <button data-btn="pg-queue">Join matchmaking queue</button>
    </div>
    <button class="pgpeek" data-btn="pg-close">view the final board</button>
  </div></div>`;
}

export interface PostGameActions {
  over: GameOver;
  /** send a `{t:'rematch', …}` message */
  send: (msg: Record<string, unknown>) => void;
  rerender: () => void;
  /** hide the overlay without leaving the room */
  dismiss: () => void;
}

export function handlePostGameButton(btn: HTMLElement, a: PostGameActions): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('pg-')) return false;
  switch (b) {
    // BL-01: the queue lives on the home screen, so this is a navigation and
    // not a message. It was `disabled` from the day this screen was built.
    case 'pg-queue': location.href = `${location.pathname}?queue=1`; return true;
    case 'pg-rematch': a.send({ want: true }); return true;
    case 'pg-rematch-cancel': a.send({ want: false }); return true;
    case 'pg-goto-rematch': goToRematch(btn.dataset['room'] ?? '', a.over); return true;
    case 'pg-home': location.href = location.pathname; return true;
    case 'pg-close': a.dismiss(); return true;
  }
  return false;
}

/** Both agreed: walk into the new room, same seat, same format. The mode
 * rides along because a draft rematch lands in a lobby, and a lobby has to
 * know it is a draft one. */
export function goToRematch(room: string, o: GameOver): void {
  if (!room) return;
  location.search = `?ws=1&room=${encodeURIComponent(room)}&seat=${o.seat}&mode=${encodeURIComponent(o.mode)}`;
}
