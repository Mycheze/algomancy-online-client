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
 *
 * The screen's markup is pages/postgame.ts since the design-system round
 * (2026-11-03); this module keeps the wire types, the pg- clicks and the small
 * pure helpers the page and the tests share.
 */
import { esc } from './util.ts';
import { gameElementsHtml } from './account.ts';
import { matchLink, type MatchSummary } from './match.ts';

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
  /** a game that is not a draft: each SEAT's colours, by seat index — the
   * screen puts its own side first (server main.ts sendGameOver) */
  sides?: [string[], string[]];
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
  /** CR D8.2e: a single card duel — the card per seat. Counted toward nothing of
   * either player's; it moves the two cards on the card ladder. */
  single?: [string, string];
  unlocked?: { id: string; name: string; desc: string; icon: string }[];
  /**
   * CR D8.5 — present only when a concede decided the game: who conceded, on
   * which game turn, and how much the server says it weighed. The WEIGHT is
   * the server's word, not something this screen works out from the turn —
   * the thresholds are named once, in server/concession.ts, and the client
   * must not carry a copy that can drift.
   *   walkover  turn 1: not a game, counted nowhere, conceder −5 rating
   *   early     turn 2: counts, half rating weight, no fast-game feats
   *   normal    turn 3+: an ordinary result
   */
  concession?: { seat: 0 | 1; turn: number; weight: 'walkover' | 'early' | 'normal' };
  /**
   * BL-48 — this game can be disputed from here (a game between two players;
   * absent on a scenario or test-mode room), and which seats already have.
   * A dispute files a report and tags the game; the result stands.
   */
  disputable?: true;
  disputed?: [boolean, boolean];
  /**
   * BL-28 — this seat played signed out, and may make an account now and
   * keep THIS game as its first: a single-use ticket and when it runs out
   * (the server's window, never a copy of it here). Present only on the
   * payload sent at the moment the game was decided — or put back from this
   * browser's storage on a refresh (main.ts).
   */
  signup?: { ticket: string; until: number };
  /**
   * docs/22 §5.5 — this game was one of a Competitive match: where the match
   * stands now, and `room`, where it went (the next game's room). The screen
   * shows the score and Continue in place of Rematch; a finished match shows
   * the match result. Updated by `{t:'match'}` while the screen is up.
   */
  match?: MatchSummary;
}

/**
 * CR D8.5 — the one line the post-game screen adds for a concession that did
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

/** The game's elements: the trio, or "yours vs theirs" in any other game. */
export function elementsLine(o: Pick<GameOver, 'seat' | 'els' | 'sides'>): string {
  const sides = o.sides ? [o.sides[o.seat], o.sides[o.seat === 0 ? 1 : 0]] as const : undefined;
  return gameElementsHtml(o.els, sides);
}

export interface PostGameActions {
  over: GameOver;
  /** send a `{t:'rematch', …}` message */
  send: (msg: Record<string, unknown>) => void;
  rerender: () => void;
  /** hide the overlay without leaving the room */
  dismiss: () => void;
  /** BL-48: open the dispute form (ui/report.ts) */
  dispute: () => void;
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
    // docs/22 §5.5: on to the match's next game, same seat
    case 'pg-continue': if (btn.dataset['room']) location.search = matchLink(btn.dataset['room'], a.over.seat); return true;
    // …or, the match over, the Competitive card on the home screen with the same Best of
    case 'pg-newmatch': location.href = `${location.pathname}?bo=${btn.dataset['bo'] === '1' ? 1 : 3}`; return true;
    case 'pg-home': location.href = location.pathname; return true;
    case 'pg-close': a.dismiss(); return true;
    case 'pg-dispute': if (a.over.disputable && !a.over.disputed?.[a.over.seat]) a.dispute(); return true;
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
