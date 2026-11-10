/* THE POST-GAME SCREEN: who won, both players' numbers side by side,
 * whatever the game unlocked, and the ways out — painted over the finished
 * board by main.ts's render.
 *
 * Moved out of ui/postgame.ts in the design-system round, 2026-11-03, under
 * the page contract (pages/README.md): postGameView() adds what the account
 * says (a guest, a signed-out game's "keep it" offer) and the markup other
 * modules draw (the elements line, a match result) to the server's GameOver;
 * postGameHtml(view) draws it and touches nothing else. ui/postgame.ts keeps
 * the wire types, the pg- clicks and the helpers the tests share
 * (concessionNote, matchLength, elementsLine).
 */
import { ALL_ELEMENTS } from '../../engine/src/apply.ts';
import { currentUser, isGuest, modeName, signupNoteHtml, signupOutcome } from '../account.ts';
import { button } from '../components/index.ts';
import { scoreWords } from '../match.ts';
import { concessionNote, elementsLine, matchLength, type GameOver, type SeatStats } from '../postgame.ts';
import { esc } from '../util.ts';
import { matchResultHtml } from './match.ts';

export interface PostGameView {
  over: GameOver;
  /** "single card duel", or the mode's name (account.ts modeName) */
  modeLabel: string;
  /** the game's elements, drawn (ui/postgame.ts elementsLine) — a slot; null
   * when the game has none to show (no trio, no sides) */
  elements: string | null;
  /** BL-42: this seat played as a guest and may keep the account */
  guest: boolean;
  /** BL-28: the "keep this game" offer — the form, the outcome's note
   * (account.ts signupNoteHtml, a slot), or nothing */
  signup: { form: true } | { note: string } | null;
  /** a finished or void match's result, drawn (pages/match.ts) — a slot, '' otherwise */
  matchResult: string;
}

export function postGameView(o: GameOver): PostGameView {
  let signup: PostGameView['signup'] = null;
  if (o.signup) {
    const done = signupOutcome(o.signup.ticket);
    signup = done ? { note: signupNoteHtml(done) } : currentUser() ? null : { form: true };
  }
  const m = o.match;
  return {
    over: o,
    modeLabel: o.single ? 'single card duel' : modeName(o.mode),
    elements: o.sides || o.els.length ? elementsLine(o) : null,
    guest: isGuest(),
    signup,
    matchResult: m && (m.phase === 'over' || m.phase === 'void') ? matchResultHtml(m, o.seat, o.names) : '',
  };
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
        <th scope="row" class="pglabel">${esc(r.label)}</th>
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
      <th scope="col" class="${o.winner === me ? 'pgwin' : ''}">${esc(o.names[me] ?? 'You')}</th>
      <th scope="col"><span class="srname">Stat</span></th>
      <th scope="col" class="${o.winner === opp ? 'pgwin' : ''}">${esc(o.names[opp] ?? 'Opponent')}</th>
    </tr></thead>
    <tbody>
      ${rows}
      <tr><td class="pgel">${el(o.seats[me])}</td><th scope="row" class="pglabel">leaned on</th>
        <td class="pgel">${el(o.seats[opp])}</td></tr>
      <tr><td class="pgcard">${topCard(o.seats[me])}</td><th scope="row" class="pglabel">most played</th>
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
function guestClaimHtml(guest: boolean): string {
  if (!guest) return '';
  return `<form class="pgclaim" data-form="pg-claim">
    <div class="pgclaimhead">Keep this game?</div>
    <div class="hint">You played as a guest. Sign up to keep this game and your rating.</div>
    <input name="username" aria-label="Username" placeholder="a name" autocomplete="username" maxlength="40">
    <input name="password" type="password" aria-label="Password" placeholder="a password" autocomplete="new-password">
    ${button({ label: 'Keep it', variant: 'primary', dataBtn: 'pg-claim' })}
    <div class="hint pgclaimerr"></div>
  </form>`;
}

/**
 * BL-28 — "keep this game", for somebody who played signed out. The owner,
 * 2026-08-25: "you will not claim the games unless you make an account right
 * after finishing playing, in which case that becomes your first tracked
 * game." So the offer is on this screen, for this game, while the server's
 * ticket lasts — and it creates an account, so it carries the owner's warning
 * in his own capitals, as the Account screen's create form does.
 *
 * ⚠ `type="button"` (button() writes it): a bare <button> in a <form> SUBMITS
 * it, which is a GET to this page with the name and password in the address.
 */
function signupClaimHtml(signup: PostGameView['signup']): string {
  if (!signup) return '';
  if ('note' in signup) return signup.note;
  return `<form class="pgclaim" id="pg-su-form" data-form="pg-signup">
    <div class="pgclaimhead">Keep this game?</div>
    <div class="hint">You played signed out. Make an account now and this game is the first one on your profile.</div>
    <p class="pwwarn"><b>DO NOT FORGET YOUR PASSWORD. THERE IS NO PASSWORD RESET.</b></p>
    <input id="pg-su-user" name="username" aria-label="Username" placeholder="a name" autocomplete="username" maxlength="20">
    <input id="pg-su-pass" name="password" type="password" aria-label="Password" placeholder="a password" autocomplete="new-password">
    ${button({ label: 'Sign up and keep it', variant: 'primary', dataBtn: 'pg-signup' })}
    <div class="hint pgclaimerr" id="pg-su-err"></div>
  </form>`;
}

/**
 * docs/22 §5.5 — in a Competitive match, Continue takes Rematch's place: the
 * next game's room already exists. A finished match offers a NEW match (the
 * Competitive card, with the same Best of), never `createRematch`, which would
 * build a casual room.
 */
function matchButtonsHtml(o: GameOver): string {
  const m = o.match!;
  if (m.phase === 'over' || m.phase === 'void') {
    return button({ label: 'New match', variant: 'primary', dataBtn: 'pg-newmatch', attrs: { 'data-bo': m.bestOf } });
  }
  return button({ label: `Continue to game ${m.game}`, variant: 'primary', dataBtn: 'pg-continue', attrs: { 'data-room': m.room } });
}

/** the match's line: "Game 1 of 3 · you lead 1–0", or its result */
function matchLineHtml(v: PostGameView): string {
  const o = v.over, m = o.match;
  if (!m) return '';
  if (m.phase === 'over' || m.phase === 'void') return `<div class="pgnote pgmatch">${v.matchResult}</div>`;
  const played = m.score[0] + m.score[1];
  return `<div class="pgnote pgmatch">Best of ${m.bestOf} · ${esc(scoreWords(m.score, o.seat))} after ${played} game${played === 1 ? '' : 's'}.</div>`;
}

/** The rematch control, which is really four states wearing one button. */
function rematchHtml(o: GameOver): string {
  const me = o.seat, opp = (o.seat === 0 ? 1 : 0) as 0 | 1;
  const them = o.names[opp] ?? 'Your opponent';
  if (o.rematchRoom) {
    return button({ label: 'Starting the rematch…', variant: 'primary', dataBtn: 'pg-goto-rematch', attrs: { 'data-room': o.rematchRoom } });
  }
  if (o.rematch[me]) {
    return `${button({ label: `Waiting for ${them}…`, variant: 'primary', disabled: true })}
      ${button({ label: 'Never mind', dataBtn: 'pg-rematch-cancel' })}`;
  }
  if (o.rematch[opp]) {
    return button({ label: `${them} wants a rematch — accept`, variant: 'primary', className: 'pgwants', dataBtn: 'pg-rematch' });
  }
  return button({ label: 'Request rematch', variant: 'primary', dataBtn: 'pg-rematch' });
}

/**
 * BL-48 — "Dispute game", beside Rematch (the owner, 2026-10-21: "a 'dispute
 * game' button right on the final screen, by 'rematch'"). Once per player;
 * after that it says so and does nothing.
 */
function disputeHtml(o: GameOver): string {
  if (!o.disputable) return '';
  return o.disputed?.[o.seat]
    ? button({ label: 'Disputed', disabled: true })
    : button({ label: 'Dispute game', dataBtn: 'pg-dispute' });
}

/** BL-48: the other player disputed this result — say so, once */
function disputedNote(o: GameOver): string {
  const opp = (o.seat === 0 ? 1 : 0) as 0 | 1;
  return o.disputable && o.disputed?.[opp]
    ? `<div class="pgnote">${esc(o.names[opp] ?? 'Your opponent')} disputed this result.</div>` : '';
}

/** The screen. Pure: everything comes in through `v` (postGameView). */
export function postGameHtml(v: PostGameView): string {
  const o = v.over;
  const me = o.seat;
  const won = o.winner === me;
  const drew = o.winner === null;
  const title = drew ? 'Game over' : won ? 'You win!' : `${esc(o.names[o.winner!] ?? 'Your opponent')} wins`;
  const sub = `${esc(v.modeLabel)} · ${o.turns} turn${o.turns === 1 ? '' : 's'}`
    + (o.matchMs ? ` · ${matchLength(o.matchMs)}` : '');

  return `<div class="overlay pgover"><div class="pgbox ${drew ? '' : won ? 'won' : 'lost'}" role="dialog" aria-label="${title}">
    <div class="pghead">
      <h2 class="pgtitle">${title}</h2>
      <div class="pgsub">${sub}${v.elements !== null ? ` · ${v.elements}` : ''}</div>
    </div>

    <div class="pgcols"><div class="pgstats">
    ${statTableHtml(o)}

    ${o.unlocked?.length ? `<div class="pgunlocked">
      <div class="pgunlockedhead">Unlocked</div>
      ${o.unlocked.map(u => `<div class="pgach"><span class="achicon">${u.icon}</span>
        <span><b>${esc(u.name)}</b><br><span class="hint">${esc(u.desc)}</span></span></div>`).join('')}
    </div>` : ''}
    </div><div class="pgside">

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

    ${matchLineHtml(v)}
    ${disputedNote(o)}
    ${guestClaimHtml(v.guest)}
    ${signupClaimHtml(v.signup)}

    <div class="pgbtns">
      ${o.match ? matchButtonsHtml(o) : rematchHtml(o)}
      ${disputeHtml(o)}
      ${button({ label: 'Return to home', dataBtn: 'pg-home' })}
      ${button({ label: 'Join matchmaking queue', dataBtn: 'pg-queue' })}
    </div>
    <button class="pgpeek" data-btn="pg-close">View the final board</button>
    </div></div>
  </div></div>`;
}
