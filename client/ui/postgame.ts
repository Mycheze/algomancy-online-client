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
  seats: [SeatStats, SeatStats];
  rematch: [boolean, boolean];
  rematchRoom: string | null;
  /** it went into somebody's profile */
  recorded: boolean;
  unlocked?: { id: string; name: string; desc: string; icon: string }[];
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
  const sub = `${esc(o.mode === 'draft' ? 'live draft' : o.mode)} · ${o.turns} turn${o.turns === 1 ? '' : 's'}`;

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

    <div class="pgnote">${o.recorded
      ? 'Recorded to your profile.'
      : 'Not recorded — nobody was signed in. Log in before the next one and it will count.'}</div>

    <div class="pgbtns">
      ${rematchHtml(o)}
      <button data-btn="pg-home">Return to home</button>
      <button disabled title="not built yet — for when there are more than two of us">
        Join matchmaking queue</button>
    </div>
    <button class="pgpeek" data-btn="pg-close" title="look at the final board">
      view the final board</button>
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
