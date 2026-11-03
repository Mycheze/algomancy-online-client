/* The profile: Stats · Achievements · Ladder · Friends · Decks · History —
 * DRAWN. Plus the small pure pieces other screens borrow (the badge and
 * trophy chips, the game-history rows and their tags), which account.ts
 * re-exports where they have always been found.
 *
 * Split out of ui/account.ts in the design-system round (2026-11-03) under the
 * page contract (pages/README.md), with one difference from a page: the
 * account's state stays in ui/account.ts, which nearly every module imports
 * for authHeaders() and currentUser(). So account.ts hands its state to
 * profileView(), profileHtml() draws the result, and account.ts paints #app
 * through paintProfile(). Nothing here imports account.ts except its types,
 * so there is no import cycle; what account.ts imports from meta.ts (the
 * cover art) arrives in the view as a URL.
 *
 * Components: the header (ui-page-header, keeping .accthead), its buttons and
 * Return to Lobby (ui-button, ui-back-link), the tabs (ui-tabs, caps), the
 * friends tab's message line (ui-status) and its "Everyone here" table
 * (ui-table). The cards stay `<section class="acctcard">`: ui-panel's title
 * is text only, and four of the profile's cards carry a count in theirs. The
 * other tables stay `.accttable`: the history rows are a pure function tests
 * and the post-game screen share, the ladder's rows carry their own classes
 * (styles/pages/30-queue.css), and Head to head has no header row. */
import { ALL_ELEMENTS } from '../../engine/src/apply.ts';
import { esc } from '../util.ts';
import { ICON_BASE } from '../assets.ts';
import { button, pageHeader, statusMessage, table, tabs } from '../components/index.ts';
import type { AchievementState, FriendView, LeaderRow, LeagueTrophy, Me, MatchRow } from '../account.ts';
import type { PublicDeck } from '../meta.ts';
import { elChip } from './signin.ts';

/** the engine's own element list, so a new element never leaves this file
 * with a stale copy (the string type fits the server's weight records) */
const ELEMENTS: readonly string[] = ALL_ELEMENTS;

// ── the chips other screens borrow ────────────────────────────────────

/** the badge as a chip: "Owner", "Judge L2" — nothing for an unmarked account */
export function badgeChipsHtml(badge: Me['badge']): string {
  if (!badge) return '';
  const chips: string[] = [];
  if (badge.owner) chips.push('<span class="badgechip owner" title="the site\'s owner">Owner</span>');
  if (badge.judge) chips.push(`<span class="badgechip judge" title="judge level ${badge.judge} — a trusted voice on rules and reports">Judge L${badge.judge}</span>`);
  return chips.join(' ');
}

const PLACE: Record<LeagueTrophy['place'], { icon: string; word: string }> = {
  champion: { icon: '🏆', word: 'Champion' },
  finalist: { icon: '🥈', word: 'Finalist' },
  participant: { icon: '🏅', word: 'Participant' },
};

/** One league place as a chip: "🏆 Champion", or with the season's name when
 * it is shown away from its season ("🏆 Champion · October 2026"). The record
 * is the title. An unknown place (a newer server) shows nothing. */
export function trophyChipHtml(t: Pick<LeagueTrophy, 'name' | 'place'> & Partial<LeagueTrophy>, withSeason = true): string {
  const p = PLACE[t.place];
  if (!p) return '';
  const title = typeof t.w === 'number' && typeof t.l === 'number'
    ? `${t.name}: ${p.word.toLowerCase()}, ${t.w}–${t.l} in the league` : `${p.word} of ${t.name}`;
  return `<span class="badgechip trophy ${t.place}" title="${esc(title)}">${
    p.icon} ${p.word}${withSeason ? ` · ${esc(t.name)}` : ''}</span>`;
}

/** Docs/20 §7: the league's trophies in the profile header, beside the badge —
 * one chip per finished season, newest first. Nothing for somebody who never
 * finished a season. */
export function trophyChipsHtml(trophies: readonly LeagueTrophy[] | undefined): string {
  return [...(trophies ?? [])].reverse().map(t => trophyChipHtml(t)).filter(Boolean).join(' ');
}

// ── the game history (shared with the post-game screen and tests) ─────

/** A game's `mode` as a player reads it — the one place the wire's names are
 * turned into words. 'shared' is the internal sandbox/tester mode (#175: the
 * account page said "shared" as though it were a format anyone could pick). */
export function modeName(mode: string): string {
  return mode === 'shared' ? 'sandbox' : mode === 'draft' ? 'live draft' : mode;
}

/** the format cell: a Competitive match game says which game it was */
function formatCell(g: MatchRow): string {
  if (!g.match) return esc(modeName(g.mode));
  return `competitive · game ${g.match.game}${g.match.bestOf ? ` of ${g.match.bestOf}` : ''}`;
}

export const shortDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * CR D8.5 — the label a conceded row carries beside its result, or '' for a
 * normal one. The weight is the server's word (see MatchRow.concession); this
 * only puts it into English. Exported so the tab's rows can be tested without
 * a signed-in `me`.
 */
export function concessionTag(g: MatchRow): string {
  const c = g.concession;
  if (!c || c.weight === 'normal') return '';
  const who = c.mine ? 'you' : esc(g.opponent);
  if (c.weight === 'walkover') {
    return `<span class="constag walkover" title="${who} conceded on turn ${c.turn}">walkover · not counted</span>`;
  }
  return `<span class="constag early" title="${who} conceded on turn ${c.turn} — no fast-game achievements">early concession · half weight</span>`;
}

/** BL-46 — the label a row carries when the game took agreed fixes. It
 * COUNTS (owner, 2026-10-16) — the tag only says the board was fixed. */
export function fixedTag(g: MatchRow): string {
  if (!g.amended) return '';
  return `<span class="constag fixed" title="the players agreed to fix the board ${g.amended === 1 ? 'once' : `${g.amended} times`} during this game">fixed</span>`;
}

/** BL-48 — the label a row carries when a player disputed the result. The
 * result stands until someone reviews it; the tag says who disputed it. */
export function disputedTag(g: MatchRow): string {
  const d = g.disputed;
  if (!d || (!d.mine && !d.theirs)) return '';
  const who = d.mine && d.theirs ? 'both of you' : d.mine ? 'you' : 'your opponent';
  return `<span class="constag disputed" title="${who} disputed this result">disputed</span>`;
}

/** BL-43 — the label a custom-rules row carries: kept in the history, counted toward nothing. */
export function customTag(g: MatchRow): string {
  // CR D8.2e: a single card duel is tagged the same way, for the same reason
  if (g.single) {
    return `<span class="constag custom" title="Single Card Duel: ${esc(g.single[0])} vs ${esc(g.single[1])}">single card · not counted</span>`;
  }
  if (!g.custom) return '';
  return `<span class="constag custom" title="custom rules: ${esc(g.custom.join(' · '))}">custom · not counted</span>`;
}

/**
 * The elements a game was played with, as chips. A draft has one trio; any
 * other game has two sides, and the label is "yours vs theirs" — a constructed
 * game is not played with a trio, and labelling it with one is how every
 * constructed game came to read fire/water/earth. `sides` is already [mine,
 * theirs]; a side that played no card reads as a dash. Shared with the post-game
 * screen, so the two say the same thing about the same game.
 */
export function gameElementsHtml(els: readonly string[], sides?: readonly [readonly string[], readonly string[]]): string {
  const chips = (list: readonly string[]): string =>
    list.length ? list.map(el => `<span class="acctel ${esc(el)}">${esc(el)}</span>`).join('') : '—';
  return sides ? `${chips(sides[0])}<span class="hint"> vs </span>${chips(sides[1])}` : chips(els);
}

/** The match-history table body, one row per game. Pure: takes the rows. */
export function historyRowsHtml(history: MatchRow[]): string {
  return history.map(g => `<tr class="res-${g.result}${g.concession && g.concession.weight !== 'normal' ? ` weight-${g.concession.weight}` : ''}">
      <td class="resultcell">${g.result === 'win' ? 'WIN' : g.result === 'loss' ? 'loss' : '?'}${concessionTag(g)}${customTag(g)}${fixedTag(g)}${disputedTag(g)}</td>
      <td>${esc(g.opponent)}</td>
      <td>${formatCell(g)}</td>
      <td>${gameElementsHtml(g.els, g.sides)}</td>
      <td>${g.turns}${g.diverged ? '<span class="partial" title="played on an older engine — its numbers are a floor, not a total">+</span>' : ''}</td>
      <td>${g.life[0]}–${g.life[1]}</td>
      <td>${shortDate(g.playedAt)}</td>
      <td class="roomcell"><a class="replaylink" href="?replay=${encodeURIComponent(g.code)}"
        title="watch this game back">▶ ${esc(g.code)}</a></td>
    </tr>`).join('');
}

// ── the view ──────────────────────────────────────────────────────────

export type ProfileTab = 'stats' | 'achievements' | 'ladder' | 'friends' | 'decks' | 'history';
export const PROFILE_TABS: readonly ProfileTab[] = ['stats', 'achievements', 'ladder', 'friends', 'decks', 'history'];

export type LadderMode = 'constructed' | 'draft';
/** BL-02 — one format's rating board, as /api/players?mode= answers it */
export interface Ladder {
  mode: LadderMode;
  players: LeaderRow[];
  /** your own row and TRUE rank, even when you are not listed yet */
  you: (LeaderRow & { rank: number }) | null;
  /** how many players have a rated game at all — the denominator of `rank` */
  rated: number;
  publicAfter: number;
  /** the fetch failed: say so, rather than drawing an empty board that reads
   * as "nobody has played yet" (test/905) */
  failed?: boolean;
}

/** what account.ts keeps, as profileView() takes it */
export interface ProfileState {
  me: Me;
  tab: ProfileTab;
  /** BL-39: this deploy has a Discord bot */
  discordLinking: boolean;
  linkCode: { code: string; expiresAt: number } | null;
  linkMsg: string;
  friendMsg: string;
  pwMsg: { text: string; ok: boolean } | null;
  /** the all-time scoreboard on the friends tab: null while loading */
  leaders: LeaderRow[] | null;
  /** …and whether its last load failed */
  leadersFailed: boolean;
  ladderMode: LadderMode;
  ladder: Ladder | null;
  /** a card's art URL (meta.ts artFor) — for the published decks' covers */
  artFor: (card: string) => string;
}

export interface ProfileView {
  me: Me;
  tab: ProfileTab;
  /** a guest (provisional) account: no password box */
  guest: boolean;
  /** the Connections card, or null when this deploy links nothing */
  connections: { linked: string | null; code: string | null; linkMsg: string } | null;
  friendMsg: string;
  pwMsg: { text: string; ok: boolean } | null;
  leaders: LeaderRow[] | null;
  leadersFailed: boolean;
  ladderMode: LadderMode;
  ladder: Ladder | null;
  /** the published decks, each with its cover's URL (or null) */
  decks: { deck: PublicDeck; cover: string | null }[];
}

export function profileView(s: ProfileState, now = Date.now()): ProfileView {
  const live = s.linkCode && s.linkCode.expiresAt > now ? s.linkCode.code : null;
  return {
    me: s.me, tab: s.tab, guest: !!s.me.provisional,
    connections: s.discordLinking ? { linked: s.me.discord ?? null, code: live, linkMsg: s.linkMsg } : null,
    friendMsg: s.friendMsg, pwMsg: s.pwMsg, leaders: s.leaders, leadersFailed: s.leadersFailed,
    ladderMode: s.ladderMode, ladder: s.ladder,
    decks: (s.me.decks ?? []).map(deck => ({ deck, cover: deck.cover ? s.artFor(deck.cover) : null })),
  };
}

// ── the tabs ──────────────────────────────────────────────────────────

const pct = (have: number, need: number): number => Math.max(0, Math.min(100, Math.round((have / need) * 100)));

/**
 * The decks this account has published — the shelf you point somebody at.
 *
 * PUBLIC ONLY. An unlisted deck is reachable by its link and by nothing else;
 * putting it on a profile would make the two shared states mean the same
 * thing. The server already filters (publicDecksOf), and this does not second-
 * guess it — it prints what it was sent.
 */
function decksTab(decks: ProfileView['decks']): string {
  if (!decks.length) {
    return `<section class="acctcard wide"><h3>Published decks</h3>
      <p class="hint">Nothing published yet. Share a deck from its <b>share</b> tab and it
        appears here.</p></section>`;
  }
  return `<section class="acctcard wide"><h3>Published decks</h3>
    <div class="metalist">${decks.map(({ deck: d, cover }) => {
    const { games, wins, losses } = d.record;
    const decided = wins + losses;
    return `<button class="metarow" data-btn="meta-open" data-id="${esc(d.id)}">
      <span class="metacover">${cover
        ? `<img src="${esc(cover)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
        : ''}</span>
      <span class="metabody">
        <span class="metaname">${esc(d.name)}</span>
        <span class="metaby">${d.cards.length} cards${
      d.copiedFrom ? ` · after ${esc(d.copiedFrom.owner)}’s ${esc(d.copiedFrom.name)}` : ''}</span>
      </span>
      <span class="metarec">${games
      ? `${decided ? `<b>${Math.round((wins / decided) * 100)}%</b> ` : ''}<span class="dim">${wins}W–${losses}L in ${games}</span>`
      : '<span class="dim">no games yet</span>'}</span>
    </button>`;
  }).join('')}</div></section>`;
}

/** the element bar: how much of everything you have actually played */
function elementBarHtml(weights: Record<string, number>): string {
  const total = ELEMENTS.reduce((n, el) => n + (weights[el] ?? 0), 0);
  if (!total) return '<div class="hint">No cards played yet.</div>';
  return `<div class="elbar">${ELEMENTS.map(el => {
    const w = weights[el] ?? 0;
    if (w <= 0) return '';
    return `<span class="elbarseg ${el}" style="flex:${w}" title="${el}: ${Math.round((w / total) * 100)}%"></span>`;
  }).join('')}</div>
  <div class="ellegend">${ELEMENTS.filter(el => (weights[el] ?? 0) > 0).map(el =>
    `<span class="acctel ${el}">${el} ${Math.round(((weights[el] ?? 0) / total) * 100)}%</span>`).join('')}</div>`;
}

/** Owner, 2026-09-05: "Allow them to override and choose their favorite in
 * the account stats tab." One icon per element, the chosen one lit; "auto"
 * goes back to the one played most. */
function favoritePickerHtml(me: Me): string {
  const picked = me.favoritePicked ?? null;
  return `<div class="favpick" role="radiogroup" aria-label="favourite element">
    ${ELEMENTS.map(el => `<button type="button" role="radio" aria-checked="${picked === el}" class="favel ${el}${picked === el ? ' on' : ''}"
      data-btn="acct-favorite" data-el="${el}" title="${el}"><img src="${ICON_BASE}${el}.webp" alt="${el}"></button>`).join('')}
    <button type="button" role="radio" aria-checked="${picked === null}" class="favel auto${picked === null ? ' on' : ''}"
      data-btn="acct-favorite" data-el="" title="the element you have played most">auto</button>
  </div>
  <div class="hint">${picked ? `You chose ${picked}.` : `Showing the element you have played most${me.favoriteElement ? ` — ${me.favoriteElement}` : ''}.`}</div>`;
}

const stat = (label: string, value: string | number, title = ''): string =>
  `<div class="statcell"${title ? ` title="${esc(title)}"` : ''}>
    <div class="statval">${typeof value === 'number' ? Math.round(value).toLocaleString() : esc(String(value))}</div>
    <div class="statlab">${esc(label)}</div></div>`;

/* BL-39 — Discord linking, on the stats tab rather than a tab of its own.
 *
 * ⚠ DELIBERATELY NOT A NEW TAB. The tab router parses its name out of a
 * hand-written allow-list (see the ⚠ on the acct-tab case in account.ts), and
 * 'decks' was once missing from it and silently rendered the stats page
 * instead. One row of content is not worth walking into that a second time.
 */
function connectionsHtml(c: ProfileView['connections']): string {
  if (!c) return '';
  const linked = c.linked;
  if (linked) {
    return `<section class="acctcard">
      <h3>Connections</h3>
      <div class="statgrid"><div class="stat"><b>Discord</b><span>@${esc(linked)}</span></div></div>
      <button class="btn" data-btn="acct-discord-unlink">Unlink Discord</button>
      <div class="hint">Lets <code>/profile</code> and <code>/rating</code> find you.
        Unlinking works even if you have lost the Discord account.</div>
    </section>`;
  }
  const linkMsg = c.linkMsg;
  return `<section class="acctcard">
      <h3>Connections</h3>
      ${c.code
        ? `<div class="statgrid"><div class="stat"><b>your code</b>
             <span class="linkcode">${esc(c.code)}</span></div></div>
           <div class="hint">Type <code>/link code ${esc(c.code)}</code> in
             Discord within ten minutes.</div>`
        : `<button class="btn" data-btn="acct-discord-link">Link Discord</button>
           <div class="hint">Get a code here and type it into the bot.</div>`}
      ${linkMsg ? `<p class="deckmsg">${esc(linkMsg)}</p>` : ''}
    </section>`;
}

/* #296 — change your password, on your own profile. Not for a guest: its
 * password is one nobody knows, and it claims an account instead. Still no
 * RESET — this needs the current one. */
function passwordHtml(v: ProfileView): string {
  if (v.guest) return '';
  const pwMsg = v.pwMsg;
  return `<section class="acctcard pwform">
      <h3>Password</h3>
      <input type="text" autocomplete="username" value="${esc(v.me.username)}" hidden>
      <label class="namerow">Current <input id="acct-pw-old" type="password" maxlength="200" autocomplete="current-password"></label>
      <label class="namerow">New <input id="acct-pw-new" type="password" maxlength="200" autocomplete="new-password"></label>
      <label class="namerow">New again <input id="acct-pw-again" type="password" maxlength="200" autocomplete="new-password"></label>
      <button type="button" data-btn="acct-password">Change password</button>
      ${pwMsg ? `<div class="${pwMsg.ok ? 'hint' : 'deckmsg'}">${esc(pwMsg.text)}</div>` : ''}
    </section>`;
}

function statsTab(v: ProfileView): string {
  const me = v.me, p = me.profile;
  const modes = Object.entries(p.byMode).filter(([, n]) => n > 0)
    .map(([m, n]) => `${modeName(m)} ${n}`).join(' · ') || 'none yet';
  return `<section class="acctcard">
      <h3>Record</h3>
      <div class="statgrid">
        ${stat('games', p.games)}
        ${stat('wins', p.wins)}
        ${stat('losses', p.losses)}
        ${stat('no result', p.unresolved, 'games played on an older engine whose log no longer replays to its ending — the result was never recorded')}
        ${stat('win streak', p.streak)}
        ${stat('best streak', p.bestStreak)}
      </div>
      <div class="hint">formats played: ${esc(modes)}</div>
      <h4>Rating</h4>
      <div class="statgrid">
        ${stat('constructed', p.rating?.['constructed'] ?? 1000,
          `${p.ratedGames?.['constructed'] ?? 0} rated constructed games`)}
        ${stat('live draft', p.rating?.['draft'] ?? 1000,
          `${p.ratedGames?.['draft'] ?? 0} rated draft games`)}
      </div>
      <div class="hint">${((p.ratedGames?.['constructed'] ?? 0) + (p.ratedGames?.['draft'] ?? 0)) === 0
        ? 'Everyone starts at 1000 — see the ladder for what counts.'
        : `over ${p.ratedGames?.['constructed'] ?? 0} constructed and ${p.ratedGames?.['draft'] ?? 0} draft games from the queue`}</div>
      ${p.unresolved ? `<div class="hint">${p.unresolved} game${p.unresolved === 1 ? '' : 's'} from before
        results were recorded.</div>` : ''}
    </section>
    ${connectionsHtml(v.connections)}
    ${passwordHtml(v)}
    <section class="acctcard">
      <h3>Elements</h3>
      ${elementBarHtml(p.cardElements)}
      <div class="hint">By card played; a hybrid counts half to each element.</div>
      <h4>Recycled for resources</h4>
      ${elementBarHtml(p.recycled)}
      <div class="hint">Prismites you turned into an element count here too.</div>
      <h4>Favourite element</h4>
      ${favoritePickerHtml(me)}
    </section>
    <section class="acctcard">
      <h3>On the table</h3>
      <div class="statgrid">
        ${stat('units played', p.unitsPlayed)}
        ${stat('spells played', p.spellsPlayed)}
        ${stat('spell tokens cast', p.tokensCast)}
        ${stat('augments & grafts', p.modsApplied)}
        ${stat('cards drafted', p.cardsDrafted)}
        ${stat('different cards', Object.values(p.cards).filter(n => n > 0).length)}
        ${stat('abilities used', p.abilitiesActivated)}
        ${stat('resources opened', p.resourcesActivated)}
      </div>
    </section>
    <section class="acctcard">
      <h3>Combat</h3>
      <div class="statgrid">
        ${stat('damage dealt', p.damageDealt)}
        ${stat('life lost', p.lifeLost)}
        ${stat('units killed', p.unitsKilled)}
        ${stat('units lost', p.unitsLost)}
        ${stat('attacks declared', p.attacksDeclared)}
        ${stat('units sent', p.unitsAttackedWith)}
        ${stat('turns played', p.turnsPlayed)}
        ${stat('longest game', `turn ${p.longestGameTurns}`)}
      </div>
    </section>
    <section class="acctcard">
      <h3>Most played cards</h3>
      ${me.topCards.length ? `<ol class="topcards">${me.topCards.map(c =>
        `<li><span class="tcname">${esc(c.card)}</span><span class="tcn">×${c.n}</span></li>`).join('')}</ol>`
        : '<div class="hint">Nothing yet.</div>'}
    </section>
    ${me.opponents.length ? `<section class="acctcard">
      <h3>Head to head</h3>
      <table class="accttable"><tbody>${me.opponents.map(o =>
        `<tr><td>${esc(o.username)}</td><td>${o.games} games</td>
          <td class="${o.wins >= o.losses ? 'good' : 'bad'}">${o.wins}W–${o.losses}L</td></tr>`).join('')}
      </tbody></table>
    </section>` : ''}`;
}

/** Server-side `GROUPS`, mirrored for ORDER only — an achievement whose group
 * this list does not know still renders, in a trailing section, rather than
 * vanishing because the client is a deploy behind the server. */
const GROUP_ORDER = [
  'Getting started', 'Winning', 'Elements', 'On the table',
  'Combat', 'One-game feats', 'Formats and people', 'League',
];

/**
 * Collapse each LADDER to a single card.
 *
 * "Play 50 / 150 / 300 different cards" is one pursuit at three goals, and
 * showing three cards for it says the player has three things to do. So a
 * ladder renders as its lowest UNEARNED rung — the one actually in front of
 * you — carrying a pip per rung so the finished ones still read as progress.
 * A fully-climbed ladder shows its top rung, earned.
 */
function collapseLadders(list: AchievementState[]): { row: AchievementState; rungs: boolean[] }[] {
  const out: { row: AchievementState; rungs: boolean[] }[] = [];
  const ladders = new Map<string, AchievementState[]>();
  for (const a of list) {
    if (!a.tier) { out.push({ row: a, rungs: [] }); continue; }
    const got = ladders.get(a.tier.of);
    if (got) got.push(a);
    else ladders.set(a.tier.of, [a]);
  }
  for (const rungs of ladders.values()) {
    rungs.sort((x, y) => (x.tier!.rung) - (y.tier!.rung));
    const show = rungs.find(r => !r.earned) ?? rungs[rungs.length - 1]!;
    out.push({ row: show, rungs: rungs.map(r => r.earned) });
  }
  return out;
}

function achievementCard(a: AchievementState, rungs: boolean[]): string {
  const pips = rungs.length > 1
    ? `<div class="achpips" title="${rungs.filter(Boolean).length} of ${rungs.length} earned">${
      rungs.map(got => `<span class="${got ? 'on' : ''}"></span>`).join('')}</div>`
    : '';
  return `<div class="ach ${a.earned ? 'got' : ''} ${a.hidden ? 'secret' : ''}">
    <div class="achicon">${a.icon}</div>
    <div class="achbody">
      <div class="achname">${esc(a.name)}${a.earned && a.earnedAt
        ? `<span class="achdate">${shortDate(a.earnedAt)}</span>` : ''}</div>
      <div class="achdesc">${esc(a.desc)}</div>
      ${pips}
      ${a.earned || a.hidden ? '' : `<div class="achbar"><span style="width:${pct(a.have, a.need)}%"></span></div>
        <div class="achprog">${a.have} / ${a.need}</div>`}
    </div>
  </div>`;
}

function achievementsTab(me: Me): string {
  const list = me.achievements;
  // group first, then within a group keep the old order: earned, then whatever
  // you are closest to finishing
  const byGroup = new Map<string, AchievementState[]>();
  for (const a of list) {
    const g = a.group ?? 'Other';
    const got = byGroup.get(g);
    if (got) got.push(a);
    else byGroup.set(g, [a]);
  }
  const order = [
    ...GROUP_ORDER.filter(g => byGroup.has(g)),
    ...[...byGroup.keys()].filter(g => !GROUP_ORDER.includes(g)),
  ];

  const sections = order.map(g => {
    const cards = collapseLadders(byGroup.get(g)!)
      .sort((x, y) => Number(y.row.earned) - Number(x.row.earned)
        || (y.row.have / y.row.need) - (x.row.have / x.row.need));
    const got = byGroup.get(g)!.filter(a => a.earned).length;
    return `<div class="achgroup">
      <h4>${esc(g)} <span class="acctcount">${got}/${byGroup.get(g)!.length}</span></h4>
      <div class="achgrid">${cards.map(c => achievementCard(c.row, c.rungs)).join('')}</div>
    </div>`;
  }).join('');

  return `<section class="acctcard wide">
    <h3>Achievements <span class="acctcount">${me.earned} of ${list.length}</span></h3>
    ${sections}
  </section>`;
}

function friendRow(f: FriendView, kind: 'friend' | 'incoming' | 'outgoing'): string {
  return `<div class="friendrow">
    <span class="fdot ${f.online ? 'on' : ''}" title="${f.online ? 'online now' : 'offline'}"></span>
    <span class="fname">${esc(f.username)}</span>
    ${elChip(f.favoriteElement)}
    <span class="fstats">${f.games} games · ${f.wins}W</span>
    <span class="fspacer"></span>
    ${kind === 'incoming'
      ? `<button class="primary" data-btn="acct-friend-accept" data-id="${esc(f.id)}">Accept</button>
         <button data-btn="acct-friend-remove" data-id="${esc(f.id)}">Decline</button>`
      : kind === 'outgoing'
        ? `<span class="hint">asked</span>
           <button data-btn="acct-friend-remove" data-id="${esc(f.id)}">Cancel</button>`
        : `<button data-btn="acct-friend-remove" data-id="${esc(f.id)}" title="remove friend">✕</button>`}
  </div>`;
}

/**
 * BL-02 — the ladder.
 *
 * ⚠ THE "YOU" ROW IS THE POINT, not decoration. The owner's rule is that a
 * player can always see where they are and is not SHOWN to anybody until
 * their fifth rated game, so a board that simply hid them would answer half
 * of it. The rank comes from the server, computed over everybody with a rated
 * game, which is why it can be a bigger number than the listed rows below it
 * — and saying so out loud is better than a rank the player cannot reconcile
 * with what they can count.
 */
function ladderTab(ladder: Ladder | null, ladderMode: LadderMode): string {
  const modes = (['constructed', 'draft'] as const).map(m =>
    `<button class="elchip${m === ladderMode ? ' on' : ''}" data-btn="acct-ladder-mode" data-mode="${m}">${
      m === 'draft' ? 'Live draft' : 'Constructed'}</button>`).join('');

  if (!ladder) {
    return `<section class="acctcard"><h3>Ladder</h3>
      <div class="elrow">${modes}</div>
      <div class="hint">loading…</div></section>`;
  }

  if (ladder.failed) {
    return `<section class="acctcard"><h3>Ladder</h3>
      <div class="elrow">${modes}</div>
      <p class="deckmsg">Could not load the ladder.</p>
      <button data-btn="acct-ladder-mode" data-mode="${ladderMode}">Try again</button></section>`;
  }

  const row = (l: LeaderRow, rank: number, mine: boolean): string => `<tr${mine ? ' class="myrow"' : ''}>
    <td class="lrank">${rank}</td>
    <td><span class="fdot ${l.online ? 'on' : ''}"></span></td>
    <td>${esc(l.username)} ${elChip(l.favoriteElement)}</td>
    <td class="lrating"><b>${l.rating}</b></td>
    <td>${l.ratedGames}</td>
    <td>${l.wins}W–${l.losses}L</td></tr>`;

  const you = ladder.you;
  const listedMe = !!you && ladder.players.some(p => p.id === you.id);
  const board = ladder.players.length
    ? `<table class="accttable ladder"><thead><tr>
        <th>#</th><th></th><th>player</th><th>rating</th><th>rated</th><th>record</th></tr></thead>
      <tbody>${ladder.players.map((l, i) => row(l, i + 1, l.id === you?.id)).join('')}</tbody></table>`
    : `<div class="hint">nobody has played ${ladder.publicAfter} rated ${
        ladderMode === 'draft' ? 'draft' : 'constructed'} games yet — the board fills up as people play.</div>`;

  const meLine = !you
    ? `<div class="hint">You have no rated ${ladderMode === 'draft' ? 'draft' : 'constructed'} games yet.</div>`
    : listedMe
      ? ''
      : `<div class="youstanding">
          <b>You</b> · #${you.rank} of ${ladder.rated} · <b>${you.rating}</b>
          <span class="hint">${you.ratedGames} rated game${you.ratedGames === 1 ? '' : 's'} —
            ${ladder.publicAfter - you.ratedGames} more and you appear on the board above.</span>
        </div>`;

  return `<section class="acctcard">
      <h3>Ladder</h3>
      <div class="elrow">${modes}</div>
      ${meLine}
      ${board}
      <div class="hint">Everyone starts at 1000. Only games from the <b>matchmaking queue</b> are
        rated — a game started by room code moves nothing. Constructed and live draft are rated separately.</div>
    </section>`;
}

/** the friends tab's "Everyone here": every player, loading, or why it could not load */
function everyoneHtml(leaders: LeaderRow[] | null, failed: boolean): string {
  // a failed fetch used to draw an EMPTY table — a header row and nobody under
  // it, which reads as "nobody plays here" (design-system round, 2026-11-03).
  // The friends tab's own button asks again.
  if (failed) {
    return statusMessage({ tone: 'error', text: 'Could not load the players.' })
      + button({ label: 'Try again', dataBtn: 'acct-tab', attrs: { 'data-tab': 'friends' } });
  }
  if (!leaders) return '<div class="hint">loading…</div>';
  return table({
    columns: [
      { key: 'dot', label: '' }, { key: 'player', label: 'player' }, { key: 'games', label: 'games' },
      { key: 'record', label: 'record' }, { key: 'badges', label: 'badges' },
    ],
    rows: leaders.map(l => ({ cells: {
      dot: { html: `<span class="fdot ${l.online ? 'on' : ''}"></span>` },
      player: { html: `${esc(l.username)} ${elChip(l.favoriteElement)}` },
      games: l.games, record: `${l.wins}W–${l.losses}L`, badges: l.earned,
    } })),
  });
}

function friendsTab(v: ProfileView): string {
  const me = v.me, friendMsg = v.friendMsg;
  return `<section class="acctcard">
      <h3>Add a friend</h3>
      <div class="joinrow">
        <input id="a-friend" maxlength="20" placeholder="their username" spellcheck="false">
        <button data-btn="acct-friend-add">Send request</button>
      </div>
      ${friendMsg ? statusMessage({ tone: 'note', text: friendMsg }) : ''}
    </section>
    ${me.incoming.length ? `<section class="acctcard">
      <h3>Wants to be friends</h3>${me.incoming.map(f => friendRow(f, 'incoming')).join('')}
    </section>` : ''}
    <section class="acctcard">
      <h3>Friends <span class="acctcount">${me.friends.length}</span></h3>
      ${me.friends.length ? me.friends.map(f => friendRow(f, 'friend')).join('')
        : '<div class="hint">Nobody yet. Add your opponent by their username.</div>'}
      ${me.outgoing.length ? `<h4>Waiting on</h4>${me.outgoing.map(f => friendRow(f, 'outgoing')).join('')}` : ''}
    </section>
    <section class="acctcard wide">
      <h3>Everyone here</h3>
      ${everyoneHtml(v.leaders, v.leadersFailed)}
    </section>`;
}

function historyTab(me: Me): string {
  if (!me.history.length) return '<section class="acctcard"><div class="hint">No games recorded yet.</div></section>';
  return `<section class="acctcard wide">
    <h3>Recent games</h3>
    <table class="accttable games"><thead><tr>
      <th>result</th><th>opponent</th><th>format</th><th>elements</th>
      <th>turns</th><th>life</th><th>played</th><th>room</th>
    </tr></thead><tbody>${historyRowsHtml(me.history)}</tbody></table>
    <div class="hint">▶ watches a game back, one action at a time. <b>+</b>: played on an older
      engine, so its numbers are a floor. A <b>walkover</b>
      (conceded on turn 1) counts toward nothing; an <b>early concession</b> counts at half weight.</div>
  </section>`;
}

// ── the page ──────────────────────────────────────────────────────────

/** the header's buttons, before Return to Lobby. The Admin and Rules review
 * buttons are drawn from what the SERVER sent about this account (tests 301
 * and 439 read these two lines and run their conditions). */
function headerButtons(me: Me): string {
  return [
    button({ label: '🏅 League', dataBtn: 'nav-league', title: 'the league: sign up, your matches, the standings' }),
    button({ label: '🧩 Challenge', dataBtn: 'nav-challenge', title: 'this week\'s solo puzzle and its leaderboard' }),
    me.admin ? button({ label: '🛠 Admin', dataBtn: 'nav-admin', title: 'the operator dashboard' }) : '',
    me.badge?.owner || me.badge?.judge ? button({ label: '📜 Rules review', dataBtn: 'nav-crreview', title: 'the comprehensive rules, open for review and comments' }) : '',
    button({ label: '↻', variant: 'icon', dataBtn: 'acct-refresh', title: 'reload from the server' }),
    button({ label: 'Log out', dataBtn: 'acct-logout' }),
  ].filter(Boolean).join('\n        ');
}

export function profileHtml(v: ProfileView): string {
  const me = v.me, p = me.profile, tab = v.tab;
  const counts: Partial<Record<ProfileTab, string>> = {
    achievements: `${me.earned}/${me.achievements.length}`,
    friends: `${me.friends.length}${me.incoming.length ? ` +${me.incoming.length}` : ''}`,
    decks: `${me.decks?.length ?? 0}`,
  };
  return `<div class="acctpage">
    ${pageHeader({
      title: me.username,
      titleHtml: `${elChip(me.favoriteElement)} ${badgeChipsHtml(me.badge)} ${trophyChipsHtml(me.trophies)}`,
      subtitleHtml: `${p.games} game${p.games === 1 ? '' : 's'} · ${p.wins}W–${p.losses}L${
        p.unresolved ? ` · ${p.unresolved} with no recorded result` : ''
      } · playing since ${shortDate(p.firstPlayed ?? me.createdAt)}`,
      actionsHtml: headerButtons(me),
      back: { dataBtn: 'acct-close' },
      className: 'accthead',
    })}
    ${tabs({ items: PROFILE_TABS.map(id => ({ id, count: counts[id] })), active: tab, variant: 'caps', dataBtn: 'acct-tab' })}
    <div class="acctbody">${
      tab === 'stats' ? statsTab(v)
      : tab === 'achievements' ? achievementsTab(me)
      : tab === 'ladder' ? ladderTab(v.ladder, v.ladderMode)
      : tab === 'friends' ? friendsTab(v)
      : tab === 'decks' ? decksTab(v.decks)
      : historyTab(me)}</div>
  </div>`;
}

export function paintProfile(app: HTMLElement, v: ProfileView): void {
  app.innerHTML = profileHtml(v);
}

/** the type a profile's tab is checked against before it is believed */
export const isProfileTab = (t: unknown): t is ProfileTab => PROFILE_TABS.includes(t as ProfileTab);

