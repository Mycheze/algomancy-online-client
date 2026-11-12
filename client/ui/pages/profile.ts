/* The profile: Overview · Achievements · Games · Players · Settings — DRAWN
 * (the account redesign, 2026-11-07; the tabs' story is above ProfileTab).
 * Plus the small pure pieces other screens borrow (the badge and trophy
 * chips, the game-history rows and their tags), which account.ts re-exports
 * where they have always been found.
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
 * In the app frame (pages/frame.ts, `fill`): the tabs a segmented control in
 * the toolbar's centre, each tab laid out in regions that scroll by
 * themselves (`data-scroll="acct-…"`); a tab is sections on flat surfaces
 * (`.pfsurface`, `.pfsec`), never a box per number. Its CSS is
 * styles/pages/53-profile.css. */
import { ALL_ELEMENTS } from '../../engine/src/apply.ts';
import { elIcon, esc } from '../util.ts';
import { ICON_BASE } from '../assets.ts';
import { button, icon, segmented, settingRow, statusMessage } from '../components/index.ts';
import { frameChromeView, frameHtml, paintFrame, type FrameChrome } from './frame.ts';
import type { AchievementState, FriendView, LeaderRow, LeagueTrophy, Me, MatchRow } from '../account.ts';
import type { PublicDeck } from '../meta.ts';
import { elChip } from './signin.ts';

/** the engine's own element list, so a new element never leaves this file
 * with a stale copy (the string type fits the server's weight records) */
const ELEMENTS: readonly string[] = ALL_ELEMENTS;

// ── the chips other screens borrow ────────────────────────────────────

/** a badge as the table sees it: the mark, without the date, and the league
 * seasons the player won, newest first (server/accounts.ts seatBadge) */
export type SeatBadge = { owner?: true; judge?: 1 | 2 | 3; champion?: string[] };

/** the badge as a chip: "Judge L2" — nothing for an unmarked account.
 *
 * The OWNER mark is never drawn (owner, 2026-11-08, #steward: "I don't want
 * the "Owner" badge to show on my account. it seems pretensious"). The mark
 * itself stays — it still opens Rules review and Judge review and still puts
 * his reports first on the admin dashboard (pages/admin.ts, which only an
 * admin sees, keeps its own "owner" chip) — it is just not shown on his
 * profile, beside his name at the table, or on his rules-review comments. */
export function badgeChipsHtml(badge: SeatBadge | null | undefined): string {
  if (!badge) return '';
  const chips: string[] = [];
  if (badge.judge) chips.push(`<span class="badgechip judge" title="judge level ${badge.judge} — a trusted voice on rules and reports">Judge L${badge.judge}</span>`);
  return chips.join(' ');
}

/** BL-17 — "visible on their profile and in game": the marks beside a
 * player's name on the board (ui/main.ts regionParts), led by a space; empty
 * for a guest or an unmarked account, so their name reads as it always did.
 *
 * ICONS, not the profile's worded chips (owner, 2026-11-10, #steward: "I
 * don't like how long they are. Instead of printing the text, I'd rather
 * display a little icon of some kind … When the badge is hovered over, *then*
 * it can display the complete text and explain what the badge is from"):
 * scales with the judge's level as a small digit, a trophy for a league
 * champion (with the count when they won more than one season). Both are
 * drawn from the client's own SVG icon set (components/icon.ts), never emoji:
 * an emoji is drawn by each device's own font, a colour picture that ignores
 * the text colour and looks different on every phone (owner, report #379,
 * 2026-11-11: "Better to find actual assets that look good and render the
 * same on all devices"). The whole group is an info
 * tip of its own (ui/infotip.ts, `data-tip="badge"`) — hover, or tap on touch,
 * and seatBadgeTipHtml says it in words. Nested in the name, whose tip is the
 * pile counts: the innermost `data-tip` wins, so each keeps its own. */
export function seatBadgeHtml(badge: SeatBadge | null | undefined, seat = 0): string {
  if (!badge) return '';
  const icons: string[] = [];
  if (badge.judge) icons.push(`<span class="sbicon judge">${icon('judge')}<span class="sblevel">${badge.judge}</span></span>`);
  const won = badge.champion?.length ?? 0;
  if (won) icons.push(`<span class="sbicon champion">${icon('league')}${won > 1 ? `<span class="sblevel">${won}</span>` : ''}</span>`);
  if (!icons.length) return '';
  return ` <span class="seatbadge" data-tip="badge" data-btn="infotip" data-p="${seat}" aria-label="${esc(seatBadgeWords(badge))}">${icons.join('')}</span>`;
}

/** the badges in one line of plain words — the icons' accessible name */
function seatBadgeWords(badge: SeatBadge): string {
  const parts: string[] = [];
  if (badge.judge) parts.push(`Judge level ${badge.judge}`);
  if (badge.champion?.length) parts.push(`league champion: ${badge.champion.join(', ')}`);
  return parts.join(' · ');
}

/** the info tip over the badge icons: each badge in full, and what it is
 * from. Pure (ui/test/1174); '' when there is nothing to say. */
export function seatBadgeTipHtml(badge: SeatBadge | null | undefined): string {
  if (!badge) return '';
  const rows: string[] = [];
  if (badge.judge) rows.push(`<div class="tiphead">${icon('judge')} Judge L${badge.judge}</div><div class="tipline dim wrap">a judge, level ${badge.judge} of 3 — a trusted voice on rules and reports</div>`);
  if (badge.champion?.length) rows.push(`<div class="tiphead">${icon('league')} League champion</div>${
    badge.champion.map(n => `<div class="tipline dim wrap">won the ${esc(n)} league</div>`).join('')}`);
  return rows.join('');
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

/* The account redesign (owner, 2026-11-07: "the boxes aren't aligned, they're
 * hard to read, they're named a bit weird"). Six tabs became five, in the
 * toolbar's centre like the League's:
 *   Overview      was Stats, without the forms: who you are, your record and
 *                 ratings, then three equal columns (elements and the career
 *                 numbers · the cards you play most · who you play)
 *   Achievements  as it was, one surface
 *   Games         was History
 *   Players       Ladder + Friends + "Everyone here": your friends beside ONE
 *                 board (Constructed · Live draft · Everyone), and a stranger
 *                 on it is one tap from a friend request
 *   Settings      the forms out of Stats (password, Discord, favourite
 *                 element), the table's toggles (sound, motion, auto-pass,
 *                 bluff haste), accessible colours (ui/prefs.ts), log out, and
 *                 the staff's pages for an admin or a judge
 * The published decks, which were a tab of their own, are a section of the
 * Overview. League and Challenge left: the home has both. */
export type ProfileTab = 'overview' | 'achievements' | 'games' | 'players' | 'settings';
export const PROFILE_TABS: readonly ProfileTab[] = ['overview', 'achievements', 'games', 'players', 'settings'];
const TAB_LABEL: Record<ProfileTab, string> = {
  overview: 'Overview', achievements: 'Achievements', games: 'Games', players: 'Players', settings: 'Settings',
};

export type LadderMode = 'constructed' | 'draft';
/** the Players tab's board: a format's ladder, or everybody by games played */
export type PlayersBoard = LadderMode | 'all';
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

/** the player's own settings as the Settings tab shows them (ui/prefs.ts Prefs) */
export interface ProfilePrefs {
  colours: 'standard' | 'accessible';
  sound: boolean; motion: boolean; autoPass: boolean; bluffHaste: boolean;
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
  /** why the last favourite-element pick did not take ('' when it did) */
  favMsg: string;
  /** a guest naming their account from Settings: the server's last answer */
  claimMsg: string;
  /** the all-time scoreboard (the Players tab's Everyone): null while loading */
  leaders: LeaderRow[] | null;
  /** …and whether its last load failed */
  leadersFailed: boolean;
  board: PlayersBoard;
  ladder: Ladder | null;
  prefs: ProfilePrefs;
  /** a card's art URL (meta.ts artFor) — for the published decks' covers and the most played cards */
  artFor: (card: string) => string;
}

export interface ProfileView {
  me: Me;
  tab: ProfileTab;
  /** a guest (provisional) account: no password box, a way to name it instead */
  guest: boolean;
  /** the Discord row, or null when this deploy links nothing */
  connections: { linked: string | null; code: string | null; linkMsg: string } | null;
  friendMsg: string;
  pwMsg: { text: string; ok: boolean } | null;
  favMsg: string;
  claimMsg: string;
  leaders: LeaderRow[] | null;
  leadersFailed: boolean;
  board: PlayersBoard;
  ladder: Ladder | null;
  prefs: ProfilePrefs;
  /** the published decks, each with its cover's URL (or null) */
  decks: { deck: PublicDeck; cover: string | null }[];
  /** the most played cards, each with its art */
  topCards: { card: string; n: number; art: string }[];
  /** the toolbar's account and bell (pages/frame.ts) */
  chrome: FrameChrome;
}

export function profileView(s: ProfileState, now = Date.now()): ProfileView {
  const live = s.linkCode && s.linkCode.expiresAt > now ? s.linkCode.code : null;
  return {
    me: s.me, tab: s.tab, guest: !!s.me.provisional,
    connections: s.discordLinking ? { linked: s.me.discord ?? null, code: live, linkMsg: s.linkMsg } : null,
    friendMsg: s.friendMsg, pwMsg: s.pwMsg, favMsg: s.favMsg, claimMsg: s.claimMsg,
    leaders: s.leaders, leadersFailed: s.leadersFailed, board: s.board, ladder: s.ladder, prefs: s.prefs,
    decks: (s.me.decks ?? []).map(deck => ({ deck, cover: deck.cover ? s.artFor(deck.cover) : null })),
    topCards: s.me.topCards.map(c => ({ ...c, art: s.artFor(c.card) })),
    chrome: frameChromeView(),
  };
}

// ── small pieces ──────────────────────────────────────────────────────

const pct = (have: number, need: number): number => Math.max(0, Math.min(100, Math.round((have / need) * 100)));
const num = (n: number): string => Math.round(n).toLocaleString('en-GB');
const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;

/** a section of a tab: a heading over its body, on the tab's one surface */
const section = (title: string, body: string, o: { cls?: string; aside?: string } = {}): string =>
  `<section class="pfsec${o.cls ? ` ${o.cls}` : ''}"><header class="pfsechead"><h3>${esc(title)}</h3>${o.aside ?? ''}</header>${body}</section>`;

/** an element's swatch: the colour, as the board paints it (follows the accessible palette) */
const swatch = (el: string): string => `<span class="pfswatch ${esc(el)}"></span>`;

// ── Overview ──────────────────────────────────────────────────────────

/** one number in the header band: big value, small name, an optional line under */
const tile = (value: string, label: string, sub = '', title = ''): string =>
  `<div class="pftile"${title ? ` title="${esc(title)}"` : ''}><b>${esc(value)}</b><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;

function heroHtml(v: ProfileView): string {
  const me = v.me, p = me.profile;
  const decided = p.wins + p.losses;
  const el = me.favoriteElement;
  const chips = `${badgeChipsHtml(me.badge)} ${trophyChipsHtml(me.trophies)}`.trim();
  const rated = (m: string): number => p.ratedGames?.[m] ?? 0;
  const ratingTile = (m: 'constructed' | 'draft', label: string): string => {
    const n = rated(m);
    return tile(num(p.rating?.[m] ?? 1000), label, n ? plural(n, 'rated game') : 'not rated yet');
  };
  return `<section class="pfhero">
    <div class="pfwho">
      <span class="pfcrest${el ? ` ${esc(el)}` : ''}">${el ? `<img src="${ICON_BASE}${esc(el)}.webp" alt="${esc(el)}">` : ''}</span>
      <div class="pfwhotext">
        <h2 class="pfname">${esc(me.username)}</h2>
        ${chips ? `<div class="pfchips">${chips}</div>` : ''}
        <div class="pfsince">${v.guest ? 'Guest account · ' : ''}Playing since ${shortDate(p.firstPlayed ?? me.createdAt)}</div>
      </div>
    </div>
    <div class="pftiles">
      ${tile(`${p.wins}–${p.losses}`, 'Record', decided ? `${Math.round((p.wins / decided) * 100)}% won · ${plural(p.games, 'game')}` : plural(p.games, 'game'),
        p.unresolved ? `${plural(p.unresolved, 'game')} from before results were recorded` : '')}
      ${tile(String(p.streak), 'Win streak', `best ${p.bestStreak}`)}
      ${ratingTile('constructed', 'Constructed')}
      ${ratingTile('draft', 'Live draft')}
    </div>
  </section>`;
}

/** a share bar and its legend, biggest first */
function elementShareHtml(weights: Record<string, number>): string {
  const total = ELEMENTS.reduce((n, el) => n + (weights[el] ?? 0), 0);
  if (!total) return '<p class="pfnone">Nothing yet.</p>';
  const order = ELEMENTS.filter(el => (weights[el] ?? 0) > 0).sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0));
  const share = (el: string): number => Math.round(((weights[el] ?? 0) / total) * 100);
  return `<div class="pfbar">${order.map(el => `<span class="pfswatch ${el}" style="flex:${weights[el]}" title="${el} ${share(el)}%"></span>`).join('')}</div>
    <ul class="pflegend">${order.map(el => `<li>${swatch(el)}<span>${el}</span><b>${share(el)}%</b></li>`).join('')}</ul>`;
}

/** label · value rows, hairlines between */
const numberRows = (rows: [string, number | string][]): string =>
  `<dl class="pfrows">${rows.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${typeof val === 'number' ? num(val) : esc(val)}</dd></div>`).join('')}</dl>`;

function elementsColumn(v: ProfileView): string {
  const p = v.me.profile;
  return `<div class="pfcol" data-scroll="acct-ov-1">
    ${section('Elements played', elementShareHtml(p.cardElements), { aside: '<span class="pfaside" title="a hybrid card counts half to each element">by card</span>' })}
    ${section('Recycled', elementShareHtml(p.recycled))}
  </div>`;
}

function cardsColumn(v: ProfileView): string {
  const cards = v.topCards;
  const different = Object.values(v.me.profile.cards).filter(n => n > 0).length;
  const list = cards.length
    ? `<ol class="pfcards">${cards.map(c => `<li>
        <span class="pfart"><img src="${esc(c.art)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></span>
        <span class="pfcardname">${esc(c.card)}</span><b>×${c.n}</b></li>`).join('')}</ol>`
    : '<p class="pfnone">Nothing yet.</p>';
  return `<div class="pfcol" data-scroll="acct-ov-2">
    ${section('Most played', list, { aside: different ? `<span class="pfaside">${plural(different, 'different card')}</span>` : '' })}
  </div>`;
}

function careerHtml(v: ProfileView): string {
  const p = v.me.profile;
  return section('Career', `<div class="pfcareer">${numberRows([
    ['Units played', p.unitsPlayed], ['Spells played', p.spellsPlayed], ['Spell tokens cast', p.tokensCast],
    ['Augments & grafts', p.modsApplied], ['Abilities used', p.abilitiesActivated], ['Resources opened', p.resourcesActivated],
    ['Cards drafted', p.cardsDrafted], ['Turns played', p.turnsPlayed], ['Longest game', `${p.longestGameTurns} turns`],
  ])}${numberRows([
    ['Damage dealt', p.damageDealt], ['Life lost', p.lifeLost], ['Attacks', p.attacksDeclared],
    ['Units sent in', p.unitsAttackedWith], ['Units killed', p.unitsKilled], ['Units lost', p.unitsLost],
  ])}</div>`);
}

function peopleColumn(v: ProfileView): string {
  const opps = v.me.opponents;
  const h2h = opps.length
    ? `<ul class="pfh2h">${opps.map(o => {
      const decided = o.wins + o.losses;
      return `<li><span class="pfopp">${esc(o.username)}</span>
        <span class="pfwl" title="${o.wins} won, ${o.losses} lost">${decided
          ? `<span class="pfwlbar"><span style="flex:${o.wins}" class="w"></span><span style="flex:${o.losses}" class="l"></span></span>` : ''}</span>
        <b>${o.wins}–${o.losses}</b></li>`;
    }).join('')}</ul>`
    : '<p class="pfnone">Nobody yet.</p>';
  const decks = v.decks.length
    ? section('Published decks', `<div class="pfdecks">${v.decks.map(({ deck: d, cover }) => {
      const { wins, losses, games } = d.record;
      return `<button class="pfdeck" data-btn="meta-open" data-id="${esc(d.id)}">
        <span class="pfart">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : ''}</span>
        <span class="pfdeckname">${esc(d.name)}</span>
        <span class="pfdeckrec">${games ? `${wins}–${losses}` : 'no games'}</span></button>`;
    }).join('')}</div>`)
    : '';
  return `<div class="pfcol" data-scroll="acct-ov-3">
    ${section('Head to head', h2h)}
    ${decks}
  </div>`;
}

function overviewTab(v: ProfileView): string {
  return `<div class="pfoverview">
    ${heroHtml(v)}
    <div class="pfcols">
      ${elementsColumn(v)}
      ${cardsColumn(v)}
      ${peopleColumn(v)}
    </div>
    <div class="pfcareerband">${careerHtml(v)}</div>
  </div>`;
}

// ── Achievements ──────────────────────────────────────────────────────

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
  // group first, then within a group: earned, then whatever you are closest to finishing
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
    return section(g, `<div class="achgrid">${cards.map(c => achievementCard(c.row, c.rungs)).join('')}</div>`,
      { aside: `<span class="pfaside">${got} of ${byGroup.get(g)!.length}</span>` });
  }).join('');
  const share = list.length ? pct(me.earned, list.length) : 0;
  return `<div class="pfpane">
    <div class="pfpanehead"><b>${me.earned} of ${list.length}</b> earned
      <span class="pfmeter" title="${share}%"><span style="width:${share}%"></span></span></div>
    <div class="pfsurface pfscroll" data-scroll="acct-achievements">${sections}</div>
  </div>`;
}

// ── Games ─────────────────────────────────────────────────────────────

/** the elements of a game as swatches: a draft's trio, or yours vs theirs */
function elementSwatches(g: MatchRow): string {
  const dots = (list: readonly string[]): string =>
    list.length ? `<span class="pfdots" title="${esc(list.join(', '))}">${list.map(swatch).join('')}</span>` : '<span class="pfnone">—</span>';
  return g.sides ? `${dots(g.sides[0])}<span class="pfvs">vs</span>${dots(g.sides[1])}` : dots(g.els);
}

/** The Games tab's rows: the result as a word on its colour, then who, what,
 * how long, how close, when, and Watch. The tags (custom, walkover, fixed,
 * disputed) sit under the opponent, where they explain the row. */
export function gameRowsHtml(history: readonly MatchRow[]): string {
  return history.map(g => {
    const tags = `${concessionTag(g)}${customTag(g)}${fixedTag(g)}${disputedTag(g)}`;
    const weight = g.concession && g.concession.weight !== 'normal' ? ` weight-${g.concession.weight}` : '';
    return `<tr class="res-${g.result}${weight}">
      <td><span class="pfres">${g.result === 'win' ? 'Win' : g.result === 'loss' ? 'Loss' : '?'}</span></td>
      <td><span class="pfopp">${esc(g.opponent)}</span>${tags ? `<span class="pftags">${tags}</span>` : ''}</td>
      <td class="pfdim pffmt">${formatCell(g)}</td>
      <td>${elementSwatches(g)}</td>
      <td class="pfnum">${g.turns}${g.diverged ? '<span class="partial" title="played on an older engine — its numbers are a floor, not a total">+</span>' : ''}</td>
      <td class="pfnum">${g.life[0]}–${g.life[1]}</td>
      <td class="pfdim">${shortDate(g.playedAt)}</td>
      <td class="pfwatch"><a class="replaylink" href="?replay=${encodeURIComponent(g.code)}" title="watch this game back (room ${esc(g.code)})">▶ Watch</a></td>
    </tr>`;
  }).join('');
}

function gamesTab(me: Me): string {
  if (!me.history.length) return `<div class="pfpane"><div class="pfsurface"><p class="pfnone pfempty">No games yet.</p></div></div>`;
  return `<div class="pfpane">
    <div class="pfsurface pfscroll" data-scroll="acct-games">
      <table class="pftable pfgames"><thead><tr>
        <th>Result</th><th>Opponent</th><th>Format</th><th>Elements</th>
        <th class="pfnum">Turns</th><th class="pfnum" title="your life – theirs, at the end">Life</th><th>Played</th><th><span class="srname">Replay</span></th>
      </tr></thead><tbody>${gameRowsHtml(me.history)}</tbody></table>
    </div>
  </div>`;
}

// ── Players ───────────────────────────────────────────────────────────

/** A player's presence: the dot, then their name, then the state in words for a screen
 * reader (BL-10, docs/23-ui-inventory/02 §8.6 item 38: "Online status is colour-only. The
 * ladder rows' `.fdot` has no title at all"). The dot is the same on every row that has
 * one — a lit disc online, a hollow ring offline (17-accounts.css), so it is not told by
 * its colour alone — and names itself on hover; the spoken word sits after the name
 * ("Rashi, online now"), where a listener expects it. */
function presence(online: boolean, name: string): string {
  return `<span class="fdot${online ? ' on' : ''}" aria-hidden="true" title="${online ? 'Online now' : 'Offline'}"></span>`
    + `<span class="pfopp">${esc(name)}</span><span class="srname">, ${online ? 'online now' : 'offline'}</span>`;
}

function friendRow(f: FriendView, kind: 'friend' | 'incoming' | 'outgoing'): string {
  return `<li class="pffriend">
    ${presence(f.online, f.username)}
    ${elChip(f.favoriteElement)}
    <span class="pfspacer"></span>
    ${kind === 'incoming'
      ? button({ label: 'Accept', variant: 'primary', size: 'sm', dataBtn: 'acct-friend-accept', attrs: { 'data-id': f.id } })
        + button({ label: 'Decline', size: 'sm', dataBtn: 'acct-friend-remove', attrs: { 'data-id': f.id } })
      : kind === 'outgoing'
        ? `<span class="pfaside">asked</span>${button({ label: 'Cancel', size: 'sm', dataBtn: 'acct-friend-remove', attrs: { 'data-id': f.id } })}`
        : button({ label: '✕', variant: 'icon', size: 'sm', dataBtn: 'acct-friend-remove', title: `remove ${f.username}`, attrs: { 'data-id': f.id } })}
  </li>`;
}

function friendsColumn(v: ProfileView): string {
  const me = v.me;
  const add = `<div class="pfadd">
      <input id="a-friend" maxlength="20" aria-label="Their username" placeholder="Their username" spellcheck="false" autocomplete="off">
      ${button({ label: 'Add', dataBtn: 'acct-friend-add' })}
    </div>
    ${v.friendMsg ? statusMessage({ tone: 'note', text: v.friendMsg }) : ''}`;
  return `<div class="pfsurface pfscroll pffriends" data-scroll="acct-friends">
    ${section('Add a friend', add)}
    ${me.incoming.length ? section('Wants to be friends', `<ul class="pflist">${me.incoming.map(f => friendRow(f, 'incoming')).join('')}</ul>`) : ''}
    ${section('Friends', me.friends.length
      ? `<ul class="pflist">${me.friends.map(f => friendRow(f, 'friend')).join('')}</ul>`
      : '<p class="pfnone">Nobody yet.</p>', { aside: me.friends.length ? `<span class="pfaside">${me.friends.length}</span>` : '' })}
    ${me.outgoing.length ? section('Waiting on', `<ul class="pflist">${me.outgoing.map(f => friendRow(f, 'outgoing')).join('')}</ul>`) : ''}
  </div>`;
}

/**
 * BL-02 — the board.
 *
 * ⚠ THE "YOU" ROW IS THE POINT, not decoration. The owner's rule is that a
 * player can always see where they are and is not SHOWN to anybody until
 * their fifth rated game, so a board that simply hid them would answer half
 * of it. The rank comes from the server, computed over everybody with a rated
 * game, which is why it can be a bigger number than the listed rows below it.
 *
 * Every row that is not you and not already a friend (or asked) has Add: the
 * board is where you find the people you play.
 */
function boardHtml(v: ProfileView): string {
  const me = v.me;
  const known = new Set([me.id, ...me.friends.map(f => f.id), ...me.outgoing.map(f => f.id), ...me.incoming.map(f => f.id)]);
  const addCell = (l: LeaderRow): string => known.has(l.id) ? ''
    : button({ label: 'Add friend', size: 'sm', dataBtn: 'acct-friend-add', title: `send ${l.username} a friend request`, attrs: { 'data-name': l.username } });
  const who = (l: LeaderRow): string => `${presence(l.online, l.username)} ${elChip(l.favoriteElement)}`;

  if (v.board === 'all') {
    if (v.leadersFailed) {
      return statusMessage({ tone: 'error', text: 'Could not load the players.' })
        + button({ label: 'Try again', dataBtn: 'acct-ladder-mode', attrs: { 'data-mode': 'all' } });
    }
    if (!v.leaders) return '<p class="pfnone">Loading…</p>';
    return `<table class="pftable pfboard"><thead><tr><th>Player</th><th class="pfnum">Games</th><th class="pfnum">Record</th><th class="pfnum" title="achievements earned">Badges</th><th><span class="srname">Add friend</span></th></tr></thead>
      <tbody>${v.leaders.map(l => `<tr${l.id === me.id ? ' class="myrow"' : ''}><td>${who(l)}</td>
        <td class="pfnum">${l.games}</td><td class="pfnum">${l.wins}–${l.losses}</td><td class="pfnum">${l.earned}</td><td class="pfact">${addCell(l)}</td></tr>`).join('')}</tbody></table>`;
  }

  const ladder = v.ladder, mode = v.board;
  const fmt = mode === 'draft' ? 'live draft' : 'constructed';
  if (!ladder || ladder.mode !== mode) return '<p class="pfnone">Loading…</p>';
  if (ladder.failed) {
    return statusMessage({ tone: 'error', text: 'Could not load the ladder.' })
      + button({ label: 'Try again', dataBtn: 'acct-ladder-mode', attrs: { 'data-mode': mode } });
  }
  const you = ladder.you;
  const listedMe = !!you && ladder.players.some(p => p.id === you.id);
  const meLine = !you
    ? `<p class="pfyou">You have no rated ${fmt} games yet.</p>`
    : listedMe ? ''
      : `<p class="pfyou"><b>You: #${you.rank} of ${ladder.rated}, ${you.rating}.</b> ${
        ladder.publicAfter - you.ratedGames} more rated game${ladder.publicAfter - you.ratedGames === 1 ? '' : 's'} and you are on the board.</p>`;
  const rows = ladder.players.length
    ? `<table class="pftable pfboard"><thead><tr><th class="pfnum">#</th><th>Player</th><th class="pfnum">Rating</th><th class="pfnum">Rated</th><th class="pfnum">Record</th><th><span class="srname">Add friend</span></th></tr></thead>
      <tbody>${ladder.players.map((l, i) => `<tr${l.id === you?.id ? ' class="myrow"' : ''}>
        <td class="pfnum pfrank">${i + 1}</td><td>${who(l)}</td><td class="pfnum"><b class="pfrating">${l.rating}</b></td>
        <td class="pfnum">${l.ratedGames}</td><td class="pfnum">${l.wins}–${l.losses}</td><td class="pfact">${addCell(l)}</td></tr>`).join('')}</tbody></table>`
    : `<p class="pfnone">Nobody has ${ladder.publicAfter} rated ${fmt} games yet.</p>`;
  return `${meLine}${rows}`;
}

function playersTab(v: ProfileView): string {
  const boards: [PlayersBoard, string][] = [['constructed', 'Constructed'], ['draft', 'Live draft'], ['all', 'Everyone']];
  const switcher = segmented({
    ariaLabel: 'Board', size: 'sm',
    options: boards.map(([m, label]) => ({ label, value: m, on: m === v.board, dataBtn: 'acct-ladder-mode', attrs: { 'data-mode': m } })),
  });
  // BL-02 (engine test 279): the rule a player needs to read a rating that has not moved
  const note = v.board === 'all' ? 'Everyone who has played here.'
    : 'Only <b>matchmaking queue</b> games are rated. Constructed and live draft are rated separately; everyone starts at 1000.';
  return `<div class="pfplayers">
    ${friendsColumn(v)}
    <div class="pfpane">
      <div class="pfpanehead">${switcher}<span class="pfaside">${note}</span></div>
      <div class="pfsurface pfscroll" data-scroll="acct-board-${v.board}">${boardHtml(v)}</div>
    </div>
  </div>`;
}

// ── Settings ──────────────────────────────────────────────────────────

/** a setting that is one of a few: a small segmented control */
function choice(pref: string, ariaLabel: string, current: string, options: [string, string][]): string {
  return segmented({
    ariaLabel, size: 'sm',
    options: options.map(([value, label]) => ({ label, value, on: value === current, dataBtn: 'acct-pref', attrs: { 'data-pref': pref, 'data-v': value } })),
  });
}
const onOff = (pref: string, label: string, on: boolean): string => choice(pref, label, on ? 'on' : 'off', [['on', 'On'], ['off', 'Off']]);

/** Owner, 2026-09-05: "Allow them to override and choose their favorite."
 * One icon per element, the chosen one lit; Auto goes back to the one played most. */
function favoritePickerHtml(me: Me): string {
  const picked = me.favoritePicked ?? null;
  return `<div class="favpick" role="radiogroup" aria-label="favourite element">
    ${ELEMENTS.map(el => `<button type="button" role="radio" aria-checked="${picked === el}" class="favel ${el}${picked === el ? ' on' : ''}"
      data-btn="acct-favorite" data-el="${el}" title="${el}"><img src="${ICON_BASE}${el}.webp" alt="${el}"></button>`).join('')}
    <button type="button" role="radio" aria-checked="${picked === null}" class="favel auto${picked === null ? ' on' : ''}"
      data-btn="acct-favorite" data-el="" title="the element you have played most">Auto</button>
  </div>`;
}

/* BL-39 — Discord linking. */
function discordHtml(c: NonNullable<ProfileView['connections']>): string {
  const msg = c.linkMsg ? statusMessage({ tone: 'error', text: c.linkMsg }) : '';
  if (c.linked) {
    return `<div class="pfinline"><span>@${esc(c.linked)}</span>${button({ label: 'Unlink', size: 'sm', dataBtn: 'acct-discord-unlink' })}</div>${msg}`;
  }
  if (c.code) {
    return `<div class="pfinline"><span class="linkcode">${esc(c.code)}</span></div>
      <div class="pfhint">Type <code>/link code ${esc(c.code)}</code> in Discord within ten minutes.</div>${msg}`;
  }
  return `${button({ label: 'Link Discord', size: 'sm', dataBtn: 'acct-discord-link' })}${msg}`;
}

/* #296 — change your password: needs the current one (there is no reset by
 * email; the sign-up screen says so). A guest has no password to change, and
 * names the account instead (BL-42's claim, the post-game form's twin). */
function accountSection(v: ProfileView): string {
  const rows: string[] = [];
  if (v.guest) {
    rows.push(settingRow({ label: 'Name', controlHtml: `<div class="pfform">
        <input id="acct-claim-name" maxlength="20" aria-label="Username" placeholder="Pick a username" autocomplete="username" spellcheck="false">
        <input id="acct-claim-pass" type="password" maxlength="200" aria-label="Password" placeholder="And a password" autocomplete="new-password">
        ${button({ label: 'Keep this account', variant: 'primary', size: 'sm', dataBtn: 'acct-claim' })}
        ${v.claimMsg ? statusMessage({ tone: 'error', text: v.claimMsg }) : ''}
      </div>`, hintHtml: 'You are playing as a guest. Name the account to keep your games and sign in elsewhere.' }));
  } else {
    rows.push(settingRow({ label: 'Username', controlHtml: `<span class="pfvalue">${esc(v.me.username)}</span>` }));
    const pw = v.pwMsg;
    rows.push(settingRow({ label: 'Password', controlHtml: `<div class="pfform pwform">
        <input type="text" autocomplete="username" value="${esc(v.me.username)}" hidden>
        <input id="acct-pw-old" type="password" maxlength="200" aria-label="Current password" placeholder="Current password" autocomplete="current-password">
        <input id="acct-pw-new" type="password" maxlength="200" aria-label="New password" placeholder="New password" autocomplete="new-password">
        <input id="acct-pw-again" type="password" maxlength="200" aria-label="New password again" placeholder="New password again" autocomplete="new-password">
        ${button({ label: 'Change password', size: 'sm', dataBtn: 'acct-password' })}
        ${pw ? statusMessage({ tone: pw.ok ? 'ok' : 'error', text: pw.text }) : ''}
      </div>` }));
  }
  if (v.connections) rows.push(settingRow({ label: 'Discord', controlHtml: discordHtml(v.connections),
    hintHtml: v.connections.linked || v.connections.code ? '' : 'Lets the bot\'s /profile and /rating find you.' }));
  return section('Account', rows.join(''), { aside: button({ label: 'Log out', size: 'sm', dataBtn: 'acct-logout' }) });
}

function looksSection(v: ProfileView): string {
  const me = v.me, picked = me.favoritePicked ?? null;
  const favHint = picked ? '' : `Auto: the one you play most${me.favoriteElement ? ` (${me.favoriteElement})` : ''}.`;
  return section('Look', [
    settingRow({ label: 'Your element', controlHtml: favoritePickerHtml(me) + (v.favMsg ? statusMessage({ tone: 'error', text: v.favMsg }) : ''),
      hintHtml: favHint ? esc(favHint) : '' }),
    settingRow({ label: 'Colours', controlHtml: `${choice('colours', 'Colours', v.prefs.colours, [['standard', 'Standard'], ['accessible', 'Accessible']])}
        <span class="pfpreview">${ELEMENTS.map(el => elIcon(el, el)).join('')}</span>`,
      hintHtml: 'Accessible is for red-green colour blindness.' }),
    settingRow({ label: 'Motion', controlHtml: onOff('motion', 'Motion', v.prefs.motion), hintHtml: 'Cards moving, and targeting arrows.' }),
  ].join(''));
}

function tableSection(v: ProfileView): string {
  return section('At the table', [
    settingRow({ label: 'Sound', controlHtml: onOff('sound', 'Sound', v.prefs.sound) }),
    settingRow({ label: 'Auto-pass', controlHtml: onOff('autoPass', 'Auto-pass', v.prefs.autoPass), hintHtml: 'Passes for you when passing is all you can do.' }),
    settingRow({ label: 'Bluff haste', controlHtml: onOff('bluffHaste', 'Bluff haste', v.prefs.bluffHaste), hintHtml: 'Always stop in the haste step, so your timing gives nothing away.' }),
  ].join(''));
}

/** the pages only staff open: drawn from what the SERVER sent about this
 * account (tests 301 and 439 read these lines and run their conditions) */
function staffSection(me: Me): string {
  const btns = [
    me.admin ? button({ label: 'Admin', size: 'sm', dataBtn: 'nav-admin', title: 'the operator dashboard' }) : '',
    me.admin ? button({ label: 'Design (Storybook)', size: 'sm', dataBtn: 'nav-storybook', title: 'the design system\'s components, in Storybook (opens a new window)' }) : '',
    me.badge?.owner || me.badge?.judge ? button({ label: 'Rules review', size: 'sm', dataBtn: 'nav-crreview', title: 'the comprehensive rules, open for review and comments' }) : '',
    me.badge?.owner || me.badge?.judge ? button({ label: 'Judge review', size: 'sm', dataBtn: 'nav-judging', title: 'the rules bot\'s answers, to flag the wrong ones' }) : '',
  ].filter(Boolean);
  return btns.length ? section('Staff', `<div class="pfinline">${btns.join('')}</div>`) : '';
}

function settingsTab(v: ProfileView): string {
  return `<div class="pfsettings">
    <div class="pfsurface pfscroll" data-scroll="acct-settings-1">${accountSection(v)}${tableSection(v)}</div>
    <div class="pfsurface pfscroll" data-scroll="acct-settings-2">${looksSection(v)}${staffSection(v.me)}</div>
  </div>`;
}

// ── the page ──────────────────────────────────────────────────────────

/** The profile, in the app frame (pages/frame.ts): the five tabs in the
 * toolbar's centre, the tab filling the window below, each of its regions
 * scrolling by itself. The toolbar's start is Home (`acct-close`). */
export function profileHtml(v: ProfileView): string {
  const me = v.me, tab = v.tab;
  const counts: Partial<Record<ProfileTab, string>> = {
    achievements: `${me.earned}/${me.achievements.length}`,
    players: me.incoming.length ? `${me.incoming.length}` : undefined,
  };
  const nav = segmented({
    ariaLabel: 'Profile', className: 'acctnav',
    options: PROFILE_TABS.map(id => ({
      label: TAB_LABEL[id], value: id, on: id === tab, dataBtn: 'acct-tab',
      attrs: { 'data-tab': id, ...(counts[id] && id === 'players' ? { 'data-count': counts[id] } : {}) },
    })),
  });
  return frameHtml({
    page: 'acctpage', title: 'Profile',
    back: { dataBtn: 'acct-close', label: 'Home' },
    chrome: v.chrome, fill: true, centerHtml: nav,
    mainHtml: `<div class="pfbody pf-${esc(tab)}">${
      tab === 'overview' ? overviewTab(v)
      : tab === 'achievements' ? achievementsTab(me)
      : tab === 'games' ? gamesTab(me)
      : tab === 'players' ? playersTab(v)
      : settingsTab(v)}</div>`,
  });
}

export function paintProfile(app: HTMLElement, v: ProfileView): void {
  paintFrame(app, profileHtml(v));
}

/** the type a profile's tab is checked against before it is believed. The
 * old tab names still land somewhere sensible (a link or a test written
 * before 2026-11-07). */
const OLD_TABS: Record<string, ProfileTab> = { stats: 'overview', history: 'games', friends: 'players', ladder: 'players', decks: 'overview' };
export const isProfileTab = (t: unknown): t is ProfileTab => PROFILE_TABS.includes(t as ProfileTab);
export const profileTabFor = (t: unknown): ProfileTab => isProfileTab(t) ? t : (typeof t === 'string' && OLD_TABS[t]) || 'overview';
