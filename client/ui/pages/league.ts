/* THE LEAGUE PAGE, ITS HOME BANNER AND ITS HEADER BUTTON, DRAWN
 * (docs/20-league.md; the page contract, pages/README.md).
 *
 * Moved out of ui/league.ts in the design-system round, 2026-11-03. The split:
 *
 *   · leagueView(raw) / bannerView(raw) gather — the clock, the zone, the
 *     browser's zones, the trophy chips account.ts draws — into a plain view;
 *   · leagueHtml(view) / leagueBannerHtml(view) / leagueNavHtml(view) draw it,
 *     and touch nothing else;
 *   · ui/league.ts keeps the state, the fetches, the clicks and the wiring.
 *
 * TODO(ds): view/html split: paint() is still ui/league.ts's. After the
 * markup goes in, the availability grid and the Discord time code are wired
 * (wireGrid, wireStamp), and both write that module's state (the draft grid,
 * the focus cell, the chosen time) and repaint; so the module that owns the
 * state paints, calling this one. Moving the wiring here would need that
 * state to live outside league.ts first.
 *
 * Everything shown is the server's answer (server/league-store.ts
 * seasonView); nothing here re-derives a standing or a pairing.
 */
import { trophyChipHtml } from '../account.ts';
import { panel, panelSubheading } from '../components/panel.ts';
import { segmented } from '../components/segmented.ts';
import { frameChromeView, frameHtml, type FrameChrome } from './frame.ts';
import { table } from '../components/table.ts';
import { esc } from '../util.ts';
import { wallClock, zonedEpoch } from '../zonetime.ts';

// ── the server's shapes (server/league-store.ts seasonView) ───────────

export const GRID_LEN = 168;
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** The grid is STORED Monday first (server/league.ts) and SHOWN Sunday first:
 * the league's weeks run Sunday to Saturday (owner, 2026-10-04). */
export const SHOW_DAYS = [6, 0, 1, 2, 3, 4, 5];

export interface Win { start: number; hours: number }
/** `contact` (a typed Discord name) is present only when the server shows it
 * to this viewer — the season's own entrants and its organizers */
export interface Person { id: string; name: string; contact?: string | null }
export interface Suggestion { id: string; name: string; contact: string | null; days: number; hours: number; windows: Win[]; problem: string | null }
export interface Result { outcome: 'a' | 'b' | 'unplayed' | 'double-loss'; how: string; code?: string; at: string; note?: string; fixed?: true }
/** what a season's games are (server/league-store.ts LeagueFormat); absent = draft */
export type Format = 'draft' | 'constructed' | 'competitive';
export interface SeasonView {
  id: string; name: string; format?: Format; phase: number; label: string; weeks: number; perWeek: number; lateUntil: number;
  signupOpens: string; start: string; phases: { phase: number; label: string; at: string }[];
  auto: boolean; hold: boolean; hidden: boolean;
  entrants: (Person & { joinedPhase: number; withdrawn: boolean; skips: number[] })[];
  standings: { id: string; name: string; w: number; l: number; unplayed: number; points: number; omw: number; rank: number }[];
  matches: {
    id: string; week: number; final: boolean; a: Person; b: Person; result: Result | null; room: string | null;
    /** BL-48: organizers only — a player disputed the game that settled it */
    disputes?: { name: string; code: string; at: string; note: string }[];
  }[];
  champion: Person | null;
  me: null | {
    entered: boolean; withdrawn: boolean; skips: number[]; joinProblem: string | null;
    contact: string | null; suggestions: Suggestion[]; week0Cap: number;
    matches: {
      id: string; week: number; final: boolean; opponent: Person; windows: Win[]; result: Result | null;
      won: boolean | null; playable: boolean;
      /** when the two mean to play: suggested (by me or them) or agreed */
      time: { at: number; mine: boolean; agreed: boolean } | null;
    }[];
  };
  /** organizers only: why the running week cannot be paired again, or null */
  repairProblem?: string | null;
  /** organizers only: why the format can no longer change, or null */
  formatProblem?: string | null;
  log?: { at: string; what: string }[];
  outbox?: { id: number; to: string; kind: string; createdAt: string; sentAt: string | null; failed: string | null }[];
}
export interface LeagueState {
  season: SeasonView | null;
  /** the other seasons still running: a month's final shares its week with
   * the next month's sign-ups, and a player may be in both */
  others?: SeasonView[];
  seasons: { id: string; name: string; format?: Format; phase: number; weeks: number; hidden: boolean }[];
  signedIn: boolean;
  availability: { tz: string; grid: string } | null;
  /** the Discord name this account gave the league (or its linked handle) */
  contact: string | null;
  minHours: number;
  organizer: boolean;
}
export interface Preview { week: number; short: string | null; total: number; edges: { a: string; b: string; score: number; cost: number; windows: Win[] }[] }
export type MyMatch = NonNullable<SeasonView['me']>['matches'][number];

// ── the availability grid's data ──────────────────────────────────────

/* Quick fills for the availability grid. Each ADDS its hours to what is
 * painted, so they combine; pressing one that is all on takes it off again.
 * `to` may pass 24: late nights run into the next morning (and Sunday's into
 * Monday's, the week being a loop). */
export const PRESETS: { id: string; label: string; days: number[]; from: number; to: number }[] = [
  { id: 'weeknights', label: 'Weeknights 7–11pm', days: [0, 1, 2, 3, 4], from: 19, to: 23 },
  { id: 'evenings', label: 'Every evening 6–11pm', days: [0, 1, 2, 3, 4, 5, 6], from: 18, to: 23 },
  { id: 'weekend-day', label: 'Weekend days 10am–6pm', days: [5, 6], from: 10, to: 18 },
  { id: 'weekend-eve', label: 'Weekend evenings 6pm–midnight', days: [5, 6], from: 18, to: 24 },
  { id: 'lunch', label: 'Weekday lunch 12–2pm', days: [0, 1, 2, 3, 4], from: 12, to: 14 },
  { id: 'late', label: 'Late nights 10pm–2am', days: [0, 1, 2, 3, 4, 5, 6], from: 22, to: 26 },
];

export const presetHours = (p: (typeof PRESETS)[number]): number[] =>
  p.days.flatMap(d => Array.from({ length: p.to - p.from }, (_, k) => (d * 24 + p.from + k) % GRID_LEN));

export function defaultGrid(): string {
  const g = new Array<string>(GRID_LEN).fill('0');
  for (const i of presetHours(PRESETS[0]!)) g[i] = '1';
  return g.join('');
}

export const hoursIn = (grid: string): number => [...grid].filter(c => c === '1').length;

// ── the format, in words ──────────────────────────────────────────────
//
// Owner, 2026-11-01: the November season is "casual constructed" — bring any
// deck, change it every game if you like. Few words: one sentence each place.

const constructed = (s: Pick<SeasonView, 'format'> | null | undefined): boolean => s?.format === 'constructed';
/** docs/22 §6.2: Competitive Constructed — each league match a best of three */
const competitive = (s: Pick<SeasonView, 'format'> | null | undefined): boolean => s?.format === 'competitive';
const COMPETITIVE_LINE = 'Competitive Constructed: every match is a best of three, with a registered deck and a sideboard of up to 7 cards.';
/** the one sentence on what a match is */
const matchLine = (s: SeasonView): string => (competitive(s) ? COMPETITIVE_LINE : constructed(s)
  ? 'Casual constructed: bring any deck, and change it every game if you like.'
  : 'Every match is one live draft with random elements and a random first player.');
/** the format in a few words, for the organizer */
const formatWords = (f: Format | undefined): string =>
  (f === 'competitive' ? 'Competitive Constructed' : f === 'constructed' ? 'casual constructed' : 'live draft');
export const FORMATS: readonly Format[] = ['draft', 'constructed', 'competitive'];

// ── formatting, in the league zone ────────────────────────────────────

/** the browser's own zone (a view gatherer's question; pure enough to share) */
export const browserTz = (): string => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};

export function fmt(ms: number, opts: Intl.DateTimeFormatOptions, tz: string): string {
  try { return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz }).format(ms); }
  catch { return new Date(ms).toUTCString(); }
}
export const when = (iso: string | number, tz: string): string =>
  fmt(typeof iso === 'number' ? iso : Date.parse(iso), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }, tz);

function windowText(w: Win, tz: string): string {
  const end = w.start + w.hours * 3_600_000;
  return `${fmt(w.start, { weekday: 'short', day: 'numeric', month: 'short' }, tz)}, ${
    fmt(w.start, { hour: 'numeric', minute: '2-digit' }, tz)}–${fmt(end, { hour: 'numeric', minute: '2-digit' }, tz)}`;
}

/** a season still taking entrants: sign-ups, then late entry until `lateUntil` */
export const joinable = (s: SeasonView): boolean => s.phase >= 0 && s.phase < s.lateUntil;
const day = (iso: string, tz: string, less = 0): string => fmt(Date.parse(iso) - less, { weekday: 'short', day: 'numeric', month: 'short' }, tz);
/** A season closes at 00:00 UTC on the Monday AFTER its final's last day, so
 * name that Sunday. Twelve hours back, not one millisecond: east of UTC the
 * close falls in the small hours of Monday, and "ends Monday" read wrong. */
const lastDay = (iso: string, tz: string): string => day(iso, tz, 12 * 3_600_000);
const BANNER_ROWS = 8;

/** a suggestion must leave this long to answer it (the server says the same) */
const LEAD_MS = 10 * 60_000;
/** the chips: one per shared window still to come — so, as a rule, one a day */
const CHIP_MAX = 6;
/** the picker's step: times are on the quarter hour (owner, 2026-10-18) */
export const STEP_MIN = 15;

/** `YYYY-MM-DDTHH:MM` for a datetime-local field: the wall clock in `tz` */
function wallValue(ms: number, tz: string): string {
  const w = wallClock(ms, tz);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${w.y}-${p(w.mo)}-${p(w.d)}T${p(w.h)}:${p(w.mi)}`;
}

/** a datetime-local value, read as wall time in `tz` and put on the quarter hour; NaN if it is not one */
export function fromWallValue(v: string, tz: string, step = STEP_MIN): number {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return Number.NaN;
  const mins = Math.round((Number(m[2]) * 60 + Number(m[3])) / step) * step;
  return zonedEpoch(m[1]!, mins, tz);
}

// ── a Discord time code ───────────────────────────────────────────────
//
// Owner, 2026-11-01: "a Discord timestamp generator like hammertime.xyz …
// setting a time in your time zone, then copying the actual code". Discord
// shows `<t:UNIX:X>` in each READER's own zone, so a time typed here in yours
// reads right to whoever you message. The field is the "suggest a time" one
// (wallValue / fromWallValue, read in the league zone), to the minute.

export type StampStyle = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R';
export const STAMP_STYLES: readonly StampStyle[] = ['t', 'T', 'd', 'D', 'f', 'F', 'R'];

/** the code Discord turns into a time */
export const discordCode = (unix: number, style: StampStyle): string => `<t:${unix}:${style}>`;

/** how Discord shows a style, near enough, in `tz` (its own English wording; Intl's here) */
export function stampPreview(ms: number, style: StampStyle, tz: string, now = Date.now()): string {
  const f = (o: Intl.DateTimeFormatOptions): string => {
    try { return new Intl.DateTimeFormat(undefined, { ...o, timeZone: tz }).format(ms); } catch { return new Date(ms).toUTCString(); }
  };
  const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  switch (style) {
    case 't': return f(time);
    case 'T': return f({ ...time, second: '2-digit' });
    case 'd': return f({ day: '2-digit', month: '2-digit', year: 'numeric' });
    case 'D': return f({ day: 'numeric', month: 'long', year: 'numeric' });
    case 'f': return f({ day: 'numeric', month: 'long', year: 'numeric', ...time });
    case 'F': return f({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', ...time });
    case 'R': {
      const sec = Math.round((ms - now) / 1000);
      const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_536_000], ['month', 2_592_000], ['day', 86_400], ['hour', 3_600], ['minute', 60]];
      const [unit, size] = units.find(([, n]) => Math.abs(sec) >= n) ?? ['second', 1];
      try { return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(sec / size), unit); }
      catch { return `${Math.round(sec / size)} ${unit}s`; }
    }
  }
}

export const nextQuarter = (now: number): number => Math.ceil(now / (STEP_MIN * 60_000)) * STEP_MIN * 60_000;

// ── copy for Discord ──────────────────────────────────────────────────
//
// The bot is only in the organizer's own server (owner, 2026-10-04), so what
// the community reads, the organizer pastes. This is the post for where the
// season is now, ready to copy. Times are Discord timestamps (`<t:…>`), which
// Discord shows in each reader's own zone, typed by anybody — not only a bot.

const stamp = (ms: number, style: 'D' | 'f' | 'F' | 'R' = 'F'): string => `<t:${Math.floor(ms / 1000)}:${style}>`;
/** the name, and the Discord name as a mention, so pasting the post pings them */
const who = (p: Person): string => `**${p.name}**${p.contact ? ` (@${p.contact.replace(/^@+/, '')})` : ''}`;

export function postText(s: SeasonView, origin: string): string {
  const link = `${origin}/?league`;
  const at = (k: number): number => Date.parse(s.phases.find(p => p.phase === k)?.at ?? s.start);
  const ins = s.entrants.filter(e => !e.withdrawn);
  const table = (n: number): string => s.standings.slice(0, n).map(r =>
    `${r.rank}. ${r.name} — ${r.w}–${r.l}, ${r.points} pts`).join('\n');
  if (s.phase <= 0) {
    return [
      `🏅 **${s.name}** — sign-ups are open!`,
      ...(constructed(s) ? ['Casual constructed: bring any deck, and change it every game if you like.'] : []),
      ...(competitive(s) ? [COMPETITIVE_LINE] : []),
      `Weeks run Sunday to Saturday. This is sign-up week: no pairings yet. Join, and the League page shows who is free when you are — up to ${s.perWeek} games against them count.`,
      `Week 1 pairings go up ${stamp(at(1))}, then each Sunday for ${s.weeks} weeks, then a final between the top two.`,
      ``,
      `Signed up (${ins.length}): ${ins.map(e => who(e)).join(', ') || 'nobody yet'}`,
      ``,
      `Join: ${link}`,
    ].join('\n');
  }
  if (s.phase <= s.weeks) {
    const week = s.matches.filter(m => m.week === s.phase);
    return [
      `🏅 **${s.name} — week ${s.phase} of ${s.weeks}**`,
      `Play before ${stamp(at(s.phase + 1))}. Suggest a time to your opponent on the League page, then both press Play.`,
      ``,
      ...week.map(m => `• ${who(m.a)} vs ${who(m.b)}`),
      ...(s.phase > 1 || s.standings.some(r => r.w + r.l) ? ['', '**Standings**', table(10)] : []),
      ``,
      link,
    ].join('\n');
  }
  if (s.phase === s.weeks + 1) {
    const fin = s.matches.find(m => m.final);
    return [
      `🏆 **${s.name} — the final**`,
      fin ? `${who(fin.a)} vs ${who(fin.b)}, one game, before ${stamp(at(s.phase + 1))}.` : 'No final this season.',
      ``,
      `**Final standings**`,
      table(10),
      ``,
      link,
    ].join('\n');
  }
  return [
    `🏆 **${s.name} is over!** ${s.champion ? `Champion: **${s.champion.name}**. ` : ''}Thank you all for playing.`,
    ``,
    table(10),
    ``,
    link,
  ].join('\n');
}

// ── the header button ─────────────────────────────────────────────────

export interface LeagueNavView {
  /** the current season the home page knows of, or null */
  season: SeasonView | null;
  /** the server said this viewer organizes leagues */
  organizer: boolean;
}

/** The home header's way in (owner, 2026-10-04: an installed web app has no
 * address bar). Shown while there is a season this viewer can see — one
 * taking sign-ups, one running, or a hidden one they are in — and always to
 * an organizer, who needs it to create the first. The banner below has its
 * own button too, but it can be folded to one line or scrolled past. */
export function leagueNavHtml(v: LeagueNavView): string {
  const s = v.season;
  if (!s && !v.organizer) return '';
  const signUp = !!s && joinable(s) && !s.me?.entered;
  return `<button class="homedecks${signUp ? ' lgnavjoin' : ''}" data-btn="nav-league">🏅 League${signUp ? ' · sign up' : ''}</button>`;
}

// ── the home's League card and Join sheet (docs/24, 2026-11-03) ───────
//
// The new home has no banner: a League card (the whole card is H1's
// `nav-league` button, so the glance has NO buttons of its own) and a Join
// sheet that lists the league matches you can play now with their Play
// buttons. Both are drawn from the same answer the banner was.

export interface LeagueGlanceView {
  name: string;
  /** "Competitive · Week 2 of 3" */
  phase: string;
  /** where the viewer stands: entered, sign-ups taking them, sign-ups shut, or nothing to say */
  status: 'in' | 'open' | 'closed' | '';
  /** the one date that matters next ('' when none) */
  next: string;
  /** the season's steps as a track (Sign-ups · W1 · W2 · … · Final), where it is now */
  track: { label: string; state: 'past' | 'now' | 'next' }[];
  /** how many are in (withdrawn players not counted) */
  players: number;
  /** the top of the table once a week has been played (at most three) */
  leaders: { name: string; points: number }[];
  /** every match the viewer still has to play this week, in no order (a week's
   * matches have none — report #354): who, and the agreed time ('' when none) */
  matches: { opponent: string; when: string }[];
}

const GLANCE_STATUS: Record<Exclude<LeagueGlanceView['status'], ''>, string> = {
  in: "✓ you're in", open: 'Sign-ups open', closed: 'Sign-ups closed',
};

/** Gather the glance from the server's answer: null while there is no season to show. */
export function leagueGlanceView(st: LeagueState | null, tz: string): LeagueGlanceView | null {
  const s = st?.season;
  if (!s) return null;
  const status = s.me?.entered ? 'in' : joinable(s) ? 'open'
    // before sign-ups the next date says when they open; a finished season has a champion
    : s.phase < 0 || s.champion ? '' : 'closed';
  return {
    name: s.name,
    phase: `${competitive(s) ? 'Competitive' : constructed(s) ? 'Constructed' : 'Draft'} · ${s.label}`,
    status,
    next: nextText(s, tz),
    track: s.phases.filter(p => p.phase <= s.weeks + 1).map(p => ({
      label: p.phase <= 0 ? 'Sign-ups' : p.phase <= s.weeks ? `W${p.phase}` : 'Final',
      state: p.phase < s.phase || s.champion ? 'past' as const : p.phase === s.phase ? 'now' as const : 'next' as const,
    })),
    players: s.entrants.filter(e => !e.withdrawn).length,
    leaders: s.phase >= 1 ? s.standings.filter(r => r.w + r.l > 0).slice(0, 3).map(r => ({ name: r.name, points: r.points })) : [],
    matches: (s.me?.matches ?? []).filter(x => x.playable && !x.result)
      .map(m => ({ opponent: m.opponent.name, when: m.time?.agreed ? when(m.time.at, tz) : '' })),
  };
}

/** "A", "A and B", "A, B and C" */
const andList = (xs: string[]): string =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/** The League card's body: '' when there is no season (the card says so itself). Pure, no buttons. */
export function leagueGlanceHtml(v: LeagueGlanceView | null): string {
  if (!v) return '';
  const people = v.players ? `<span class="lgglplayers">${v.players} player${v.players === 1 ? '' : 's'}</span>` : '';
  return `<div class="lgglance">
    <div class="lgglname">${esc(v.name)}</div>
    <div class="lgglphase">${esc(v.phase)}</div>
    ${v.track.length > 1 ? `<ol class="lggltrack">${v.track.map(t => `<li class="${t.state}">${esc(t.label)}</li>`).join('')}</ol>` : ''}
    ${v.status || people ? `<div class="lgglrow">${v.status ? `<span class="lgglstate ${v.status}">${GLANCE_STATUS[v.status]}</span>` : ''}${people}</div>` : ''}
    ${v.matches.length ? `<div class="lgglmatch">This week vs: ${andList(v.matches.map(m =>
      `<b>${esc(m.opponent)}</b>${m.when ? ` (${esc(m.when)})` : ''}`))}</div>` : ''}
    ${v.leaders.length ? `<ol class="lgglleaders">${v.leaders.map(r => `<li><span>${esc(r.name)}</span><b>${r.points}</b></li>`).join('')}</ol>` : ''}
    ${v.next ? `<div class="lgglnext">${esc(v.next)}</div>` : ''}
  </div>`;
}

/** one league match the viewer can play now */
export interface LeagueJoinRow {
  season: string; seasonName: string; match: string; opponent: string;
  /** the agreed time, in the viewer's zone ('' when none is agreed) */
  when: string;
}

/** Every match the viewer can press Play on now, in this season and the others still running. */
export function leagueJoinView(st: LeagueState | null, tz: string): LeagueJoinRow[] {
  if (!st) return [];
  return [...(st.season ? [st.season] : []), ...(st.others ?? [])].flatMap(s =>
    (s.me?.matches ?? []).filter(m => m.playable && !m.result).map(m => ({
      season: s.id, seasonName: s.name, match: m.id, opponent: m.opponent.name,
      when: m.time?.agreed ? when(m.time.at, tz) : '',
    })));
}

/** The Join sheet's league rows, each with the banner's own Play button; '' when none. Pure. */
export function leagueJoinRowsHtml(rows: readonly LeagueJoinRow[]): string {
  if (!rows.length) return '';
  return `<div class="lgjoinrows">${rows.map(r => `<div class="lgjoinrow">
    <span>vs <b>${esc(r.opponent)}</b> <span class="dim">· ${esc(r.seasonName)}${r.when ? ` · ${esc(r.when)} ✓` : ''}</span></span>
    <button class="primary" data-btn="lg-play" data-season="${esc(r.season)}" data-match="${esc(r.match)}">Play</button>
  </div>`).join('')}</div>`;
}

// ── the home banner ───────────────────────────────────────────────────
//
// The season at a glance, on the home page while one is visible: the dates,
// how it works, how to join (ticked off for the viewer), and who is in — the
// sign-ups before week 1, then the standings and the week's pairings. Folded,
// it is one line. Everything here is the server's answer, as on the page.

export interface LeagueBannerView {
  /** the server's answer for the current season, or null: no banner */
  st: LeagueState | null;
  /** the banner is unfolded */
  open: boolean;
  /** "How it works" unfolded: null = the default (open until you are in) */
  howOpen: boolean | null;
  /** the zone times are shown in */
  tz: string;
}

export function leagueBannerHtml(v: LeagueBannerView): string {
  const { st, tz } = v;
  const bannerOpen = v.open;
  const s = st?.season;
  if (!st || !s) return '';
  const me = s.me;
  const cta = joinable(s) && !me?.entered
    ? '<button class="cta primary" data-btn="lg-open">Sign up</button>'
    : '<button data-btn="lg-open">League page</button>';
  return `<section class="lgbanner" aria-label="League">
    <div class="lgbhead">
      <button class="lgbfold" data-btn="lg-banner" aria-expanded="${bannerOpen}">
        <span class="lgbcaret">${bannerOpen ? '▾' : '▸'}</span> 🏅 <b>${esc(s.name)}</b></button>
      <span class="lgbphase">${competitive(s) ? 'Competitive · ' : constructed(s) ? 'Constructed · ' : ''}${esc(s.label)}</span>
      ${me?.entered ? `<span class="lgbin">✓ you're in</span>` : ''}
      <span class="lgbnext">${esc(nextText(s, tz))}</span>
      ${cta}
    </div>
    ${bannerOpen ? `<ol class="lgbdates">${s.phases.map(p => `<li class="${
      p.phase === s.phase ? 'now' : p.phase < s.phase ? 'past' : ''}"><span>${
      esc(p.phase === 0 ? 'Sign-up week' : p.phase === s.weeks + 2 ? 'Ends' : p.label.replace(/ of \d+$/, ''))
    }</span> ${esc(p.phase === s.weeks + 2 ? lastDay(p.at, tz) : day(p.at, tz))}</li>`).join('')}</ol>
    <div class="lgbbody">
      <div>${((): string => {
        const shown = v.howOpen ?? !me?.entered;
        return `<h3><button class="lgbhowfold" data-btn="lg-how" aria-expanded="${shown}">${shown ? '▾' : '▸'} How it works</button></h3>${
          shown ? howHtml(s) : ''}`;
      })()}</div>
      <div>${s.champion ? `<h3>Champion</h3><p class="lgbchamp">🏆 <b>${esc(s.champion.name)}</b></p>`
        : me?.entered && s.phase >= 0 ? mineHtml(s, tz) : joinStepsHtml(st, s, tz)}</div>
      ${tableHtml(s)}
    </div>` : ''}
  </section>${(st.others ?? []).map(o => otherHtml(o, tz)).join('')}`;
}

/** Another season still running, on one line: the old month's final while
 * the new month takes sign-ups (owner, 2026-11-01). Its name, where it is,
 * your own open match with a Play button, and the way to its page. */
function otherHtml(s: SeasonView, tz: string): string {
  const mine = s.me?.matches.filter(m => m.playable) ?? [];
  const fin = s.phase === s.weeks + 1 ? s.matches.find(m => m.final) : undefined;
  return `<section class="lgbanner lgbother" aria-label="${esc(s.name)}">
    <div class="lgbhead">
      <span>🏅 <b>${esc(s.name)}</b></span>
      <span class="lgbphase">${esc(s.label)}</span>
      <span class="lgbnext">${fin && !mine.length ? pairingText(fin) : esc(nextText(s, tz))}</span>
      ${mine.map(m => `<span>vs <b>${esc(m.opponent.name)}</b></span>
        <button class="primary" data-btn="lg-play" data-season="${esc(s.id)}" data-match="${esc(m.id)}">Play</button>`).join('')}
      <button data-btn="lg-open" data-season="${esc(s.id)}">${esc(s.name)}</button>
    </div>
  </section>`;
}

/** the one date that matters next, for the folded line */
function nextText(s: SeasonView, tz: string): string {
  if (s.champion) return `Champion: ${s.champion.name}`;
  const next = s.phases.find(p => p.phase === s.phase + 1);
  if (s.phase < 0) return `Sign-ups open ${day(s.signupOpens, tz)}`;
  if (!next) return '';
  if (s.phase === 0) return `Week 1 starts ${day(next.at, tz)}`;
  if (s.phase === s.weeks) return `The final starts ${day(next.at, tz)}`;
  if (s.phase > s.weeks) return `Ends ${lastDay(next.at, tz)}`;
  return `Week ${s.phase + 1} starts ${day(next.at, tz)}`;
}

function howHtml(s: SeasonView): string {
  return `<ul class="lgbhow">
    <li>Each week (Sunday to Saturday) you get ${s.perWeek} opponents, matched on the hours you are both free.</li>
    <li>Sign-up week has no pairings: the League page shows who is free when you are, and up to ${s.perWeek} games against them count.</li>
    <li>${matchLine(s)}</li>
    <li>Suggest a time on the League page (your opponent sees it in their own time zone), then both press Play.</li>
    <li>A win is 3 points. A match nobody plays counts for neither player.</li>
    <li>After week ${s.weeks}, the top two play one game for the title.</li>
  </ul>`;
}

/** how to join, each step ticked once the viewer has done it */
function joinStepsHtml(st: LeagueState, s: SeasonView, tz: string): string {
  if (s.phase >= 0 && !joinable(s)) {
    return `<h3>How to join</h3><p class="dim">Sign-ups for this season have closed. The next one will be announced on Discord.</p>`;
  }
  const grid = st.availability?.grid ?? '';
  const todo = (label: string): string => (st.signedIn ? `<button class="linkbtn" data-btn="lg-open">${label}</button>` : label);
  const steps: [boolean, string][] = [
    [st.signedIn, st.signedIn ? 'Signed in' : '<button class="linkbtn" data-btn="acct-open-auth">Sign in or make an account</button>'],
    [hoursIn(grid) >= st.minHours, hoursIn(grid) >= st.minHours ? 'Marked when you are usually free' : todo('Mark when you are usually free')],
    [!!st.contact, st.contact ? `Discord name: ${esc(st.contact)}` : todo('Add your Discord name')],
    [!!s.me?.entered, s.me?.entered ? 'Joined' : s.phase < 0 ? `Join from ${day(s.signupOpens, tz)}` : 'Join on the League page'],
  ];
  return `<h3>How to join</h3><ol class="lgbsteps">${steps.map(([done, what]) =>
    `<li class="${done ? 'done' : ''}"><span class="lgbtick">${done ? '✓' : ''}</span>${what}</li>`).join('')}</ol>
    ${s.phase === 0 && s.lateUntil > 1 ? '<p class="dim">Late entries are open until week 2.</p>' : ''}`;
}

/** an entrant's own matches this week (or the final), with a Play button on each open one */
function mineHtml(s: SeasonView, tz: string): string {
  const me = s.me;
  const now = me?.matches.filter(m => m.week === s.phase) ?? [];
  const rows = now.length ? `<ul class="lgbrows">${now.map(m => `<li><span>vs <b>${esc(m.opponent.name)}</b>${
    m.opponent.contact ? ` <span class="dim">(${esc(m.opponent.contact)} on Discord)</span>` : ''}${
    // when they mean to play, in a word: the League page has the controls
    m.time && !m.result ? `<br><span class="lgbtime${m.time.agreed ? ' agreed' : m.time.mine ? ' dim' : ' ask'}">${
      m.time.agreed ? `${esc(when(m.time.at, tz))} ✓` : m.time.mine ? `you suggested ${esc(when(m.time.at, tz))}`
        : `suggests ${esc(when(m.time.at, tz))} — answer on the League page`}</span>` : ''}</span><span>${
      m.result ? (m.won === true ? '✅ won' : m.won === false ? 'lost' : '<span class="dim">not played</span>')
        : m.playable ? `<button class="primary" data-btn="lg-play" data-season="${esc(s.id)}" data-match="${esc(m.id)}">Play</button>` : '<span class="dim">to play</span>'
    }</span></li>`).join('')}</ul>` : '';
  if (s.phase === 0) {
    const free = me?.suggestions.filter(x => x.days > 0).length ?? 0;
    return `<h3>Sign-up week</h3>${rows}
      <p>${free ? `${free} player${free === 1 ? ' is' : 's are'} free when you are.` : 'Nobody shares your hours yet.'}
        Up to ${me?.week0Cap ?? 3} games this week count.</p>
      <p><button data-btn="lg-open">Find an opponent</button></p>`;
  }
  if (!me || !now.length) return `<h3>Your matches</h3><p class="dim">${
    me?.skips.includes(s.phase) ? 'You are sitting this week out.' : 'None this week.'}</p>`;
  return `<h3>${s.phase > s.weeks ? 'Your final' : 'Your matches this week'}</h3>${rows}`;
}

/** who is in: the sign-ups until week 1, then the table and this week's pairings */
function tableHtml(s: SeasonView): string {
  if (s.phase <= 0) {
    const ins = s.entrants.filter(e => !e.withdrawn);
    return `<div><h3>Signed up${ins.length ? ` (${ins.length})` : ''}</h3>${ins.length
      ? `<p class="lgbnames">${ins.map(e => `<span>${esc(e.name)}</span>`).join('')}</p>`
      : `<p class="dim">Nobody yet${s.phase < 0 ? '' : ' — be the first'}.</p>`}</div>`;
  }
  const top = s.standings.slice(0, BANNER_ROWS);
  const week = s.matches.filter(m => m.week === s.phase);
  const myIds = new Set(s.me?.matches.map(m => m.id) ?? []);
  const mine = (m: { id: string }): boolean => myIds.has(m.id);
  const pairs = [...week.filter(mine), ...week.filter(m => !mine(m))];
  return `<div><h3>Standings</h3>
      <table class="lgbtable"><tbody>${top.map(r => `<tr><td>${r.rank}</td><td>${esc(r.name)}${
        s.champion?.id === r.id ? ' 🏆' : ''}</td><td>${r.w}–${r.l}</td><td>${r.points} pts</td></tr>`).join('')}</tbody></table>
      ${s.standings.length > top.length ? `<p class="dim">+${s.standings.length - top.length} more on the League page</p>` : ''}
    </div>
    ${pairs.length ? `<div><h3>${s.phase > s.weeks ? 'The final' : `Week ${s.phase} pairings`}</h3>
      <ul class="lgbrows">${pairs.slice(0, BANNER_ROWS).map(m => `<li class="${mine(m) ? 'mine' : ''}">${pairingText(m)}</li>`).join('')}</ul>
      ${pairs.length > BANNER_ROWS ? `<p class="dim">+${pairs.length - BANNER_ROWS} more on the League page</p>` : ''}
    </div>` : ''}`;
}

/** one line: "Winner beat Loser", or "A vs B" and what is left of it */
function pairingText(m: { a: Person; b: Person; result: Result | null }): string {
  const r = m.result;
  if (r && (r.outcome === 'a' || r.outcome === 'b')) {
    const [w, l] = r.outcome === 'a' ? [m.a, m.b] : [m.b, m.a];
    return `<span><b>${esc(w.name)}</b> <span class="dim">beat</span> ${esc(l.name)}</span>`;
  }
  return `<span>${esc(m.a.name)} <span class="dim">vs</span> ${esc(m.b.name)}</span> <span class="dim">${
    !r ? 'to play' : r.outcome === 'unplayed' ? 'not played' : 'double loss'}</span>`;
}

function resultText(m: { a: Person; b: Person; result: Result | null }): string {
  const r = m.result;
  if (!r) return '<span class="dim">to play</span>';
  if (r.outcome === 'unplayed') return '<span class="dim">not played</span>';
  if (r.outcome === 'double-loss') return '<span class="dim">double loss</span>';
  const w = r.outcome === 'a' ? m.a : m.b;
  return `<b>${esc(w.name)}</b> won${r.how === 'organizer' ? ' <span class="dim">(organizer)</span>' : ''}`
    // BL-46: the game took agreed fixes — it counts, and says so
    + (r.fixed ? ' <span class="dim" title="the players agreed to fix the board during this game">(fixed)</span>' : '');
}

// ── the page ──────────────────────────────────────────────────────────

export interface LeagueView {
  /** the server's answer, or null before the first one */
  data: LeagueState | null;
  loading: boolean;
  /** the last thing a button said ('' = nothing) */
  msg: string;
  /** the availability being edited: the saved one, or a sensible default */
  draft: { tz: string; grid: string; contact: string };
  /** the draft differs from what is saved */
  dirty: boolean;
  /** a POST is on its way */
  busy: boolean;
  /** a destructive button pressed once, waiting for the second press */
  arming: string | null;
  /** the availability grid's one tabbable cell (its data-i), or null */
  gridFocus: number | null;
  /** the match whose "suggest a time" form is open */
  timeOpen: string | null;
  /** the organizer's preview of next week's pairings */
  preview: Preview | null;
  /** the clock (ms) everything "still to come" is measured from */
  now: number;
  /** the zone times are shown in: the availability's, else the browser's */
  tz: string;
  /** the browser's own zone (the "use …" button) */
  browserTz: string;
  /** the zones the time-zone box offers */
  zones: string[];
  /** where the site is, for the Discord post's links */
  origin: string;
  /** the Discord time code's instant */
  stampAt: number;
  /** a closed season's two trophy chips (account.ts trophyChipHtml), '' before */
  chips: { champion: string; finalist: string };
  /** which part of the season is showing (the toolbar's tabs) */
  section: LeagueSection;
  /** the toolbar's account and bell (pages/frame.ts) */
  chrome: FrameChrome;
}

/* ── the page in the app frame (2026-11-04, docs/24) ─────────────────────
   One window: the seasons in a rail on the left (each with its phase and its
   own Play buttons — the season tabs and the other seasons' banners in one
   list), the season's parts as tabs in the toolbar, and the part showing
   scrolling inside itself. */

export const LEAGUE_SECTIONS = ['season', 'avail', 'standings', 'stamp', 'organizer'] as const;
export type LeagueSection = typeof LEAGUE_SECTIONS[number];
const SECTION_LABEL: Record<LeagueSection, string> = {
  season: 'Season', avail: 'Availability', standings: 'Standings', stamp: 'Time code', organizer: 'Organizer',
};

/** the parts this viewer has: Availability signed in, Standings with a season, Organizer for an organizer */
export function leagueSections(v: Pick<LeagueView, 'data'>): LeagueSection[] {
  const d = v.data;
  return LEAGUE_SECTIONS.filter(k => k === 'season' || k === 'stamp'
    || (k === 'avail' && !!d?.signedIn)
    || (k === 'standings' && !!d?.season)
    || (k === 'organizer' && !!d?.organizer));
}

/** server/league.ts phaseLabel, for a season the answer has only the bare numbers of */
function phaseText(x: { phase: number; weeks: number }): string {
  if (x.phase < 0) return 'Announced';
  if (x.phase === 0) return 'Sign-up week';
  if (x.phase <= x.weeks) return `Week ${x.phase} of ${x.weeks}`;
  if (x.phase === x.weeks + 1) return 'The final';
  return 'Finished';
}

/** The seasons, one row each: the row opens it; an open match of yours has its Play */
function railHtml(v: LeagueView): string {
  const d = v.data;
  if (!d) return '';
  const cur = d.season;
  const list = d.seasons.length ? d.seasons : cur ? [{ id: cur.id, name: cur.name, phase: cur.phase, weeks: cur.weeks, hidden: cur.hidden }] : [];
  if (list.length <= 1 && !(d.others ?? []).length) return '';
  return `<nav class="lgrail" aria-label="Seasons" data-scroll="lg-rail">${list.map(x => {
    const full = cur?.id === x.id ? cur : (d.others ?? []).find(o => o.id === x.id) ?? null;
    // the season showing has its Play buttons in Your matches, beside the rail
    const mine = cur?.id === x.id ? [] : full?.me?.matches.filter(m => m.playable) ?? [];
    const fin = full && full.phase === full.weeks + 1 && !mine.length ? full.matches.find(m => m.final) : undefined;
    const next = full ? (fin ? pairingText(fin) : esc(nextText(full, v.tz))) : '';
    return `<div class="lgrailrow${cur?.id === x.id ? ' on' : ''}">
      <button class="lgseasonbtn" data-btn="lg-season" data-id="${esc(x.id)}"${cur?.id === x.id ? ' aria-current="true"' : ''}>
        <span class="lgrailname">${esc(x.name)}${x.hidden ? ' 🔒' : ''}</span>
        <span class="lgbphase">${esc(full?.label ?? phaseText(x))}</span>
        ${next ? `<span class="lgrailnext">${next}</span>` : ''}
      </button>
      ${mine.map(m => `<div class="lgrailplay"><span>vs <b>${esc(m.opponent.name)}</b></span>
        <button class="primary" data-btn="lg-play" data-season="${esc(full!.id)}" data-match="${esc(m.id)}">Play</button></div>`).join('')}
    </div>`;
  }).join('')}</nav>`;
}

export function leagueHtml(v: LeagueView): string {
  const { data, msg, loading } = v;
  const s = data?.season ?? null;
  const secs = leagueSections(v);
  const sec: LeagueSection = secs.includes(v.section) ? v.section : 'season';
  const body = sec === 'avail' ? availabilityCardHtml(v)
    : sec === 'standings' ? `${s && (s.standings.length || s.phase <= 0) ? standingsHtml(s, v) : ''}${s && s.matches.length ? allMatchesHtml(s, v) : ''}`
    : sec === 'stamp' ? stampHtml(v)
    : sec === 'organizer' ? organizerHtml(s, v)
    : `${data && !s ? panel({ title: 'No season yet', wide: true, bodyHtml: '<p>There is no league season running right now. Watch the Discord for the next one.</p>' }) : ''}
      ${s ? seasonCardHtml(s, v) : ''}
      ${s ? entryCardHtml(s, v) : ''}
      ${s?.me?.matches.length ? myMatchesHtml(s, v) : ''}
      ${s && s.phase === 0 && s.me?.entered ? suggestionsHtml(s, v) : ''}`;
  const rail = railHtml(v);
  return frameHtml({
    page: 'lgpage', title: 'League', back: { dataBtn: 'lg-close', label: 'Home' }, chrome: v.chrome, fill: true,
    centerHtml: data ? segmented({ ariaLabel: 'League', className: 'lgsections',
      options: secs.map(k => ({ label: SECTION_LABEL[k], value: k, on: k === sec, dataBtn: 'lg-section', attrs: { 'data-v': k } })) }) : '',
    mainHtml: `${msg ? `<div class="acctmsg">${esc(msg)}</div>` : ''}
    ${loading && !data ? '<p class="dim">Loading…</p>' : ''}
    <div class="lgwork${rail ? '' : ' lgnorail'}">${rail}
      <div class="lgsection" data-scroll="lg-${sec}-${esc(s?.id ?? 'none')}"><div class="acctbody lgsec-${sec}">${body}</div></div>
    </div>`,
  });
}

function seasonCardHtml(s: SeasonView, v: LeagueView): string {
  const wk1 = s.phases.find(p => p.phase === 1);
  const fin = s.phases.find(p => p.phase === s.weeks + 1);
  const end = s.phases.find(p => p.phase === s.weeks + 2);
  const active = s.entrants.filter(e => !e.withdrawn).length;
  return panel({ className: 'lgspan2', title: s.name,
    titleHtml: `${s.hidden ? '<span class="lgtag">hidden</span>' : ''}${s.hold ? '<span class="lgtag">on hold</span>' : ''}`, bodyHtml: `
    <div class="statgrid">
      <div class="statcell"><div class="statval lgphase">${esc(s.label)}</div><div class="statlab">now</div></div>
      <div class="statcell"><div class="statval">${active}</div><div class="statlab">players</div></div>
      <div class="statcell"><div class="statval">${s.perWeek}</div><div class="statlab">opponents a week</div></div>
      <div class="statcell"><div class="statval">${s.weeks}</div><div class="statlab">weeks + a final</div></div>
    </div>
    <p>${s.phase < 0 ? `Sign-ups open <b>${when(s.signupOpens, v.tz)}</b>. ` : ''}Week 1 starts <b>${wk1 ? when(wk1.at, v.tz) : '?'}</b>,
      the final <b>${fin ? when(fin.at, v.tz) : '?'}</b>, and the season ends <b>${end ? when(end.at, v.tz) : '?'}</b>
      <span class="dim">(your time)</span>.</p>
    ${s.champion ? `<p>🏆 Champion: <b>${esc(s.champion.name)}</b></p>` : ''}
    <p class="hint">Weeks run Sunday to Saturday. ${matchLine(s)} Your opponents are here each week: suggest a time below (or message them on Discord), then both press Play.
      A match nobody plays by the end of its week counts for neither player.</p>
  ` });
}

function entryCardHtml(s: SeasonView, v: LeagueView): string {
  const { data, arming, busy } = v;
  if (!data?.signedIn) {
    return panel({ title: 'Join', bodyHtml: `<p>Sign in to join the league.</p>
      <button class="primary" data-btn="acct-open-auth">Log in / Sign up</button>` });
  }
  const me = s.me!;
  if (me.entered) {
    const future = Array.from({ length: s.weeks }, (_, i) => i + 1).filter(k => k > s.phase);
    const out = s.phase >= 1 && s.phase <= s.weeks && me.skips.includes(s.phase);
    return panel({ title: "You're in", bodyHtml: `
      ${out ? `<p>You are sitting week ${s.phase} out and its pairings are out. Want to play after all? Ask the organizer to put you back in.</p>` : ''}
      ${future.length ? `<p>Can't play a week? Sit it out before its pairings go out, and nobody is left waiting for you.</p>
        <div class="lgskips">${future.map(k => {
          const on = me.skips.includes(k);
          const armed = arming === `skip:${k}`;
          return `<button class="${on ? 'on' : armed ? 'danger' : ''}" aria-pressed="${on}" data-btn="lg-skip" data-week="${k}" data-skip="${on ? '0' : '1'}"
            title="${on ? 'you are sitting this week out — press to play it' : 'sit this week out'}">${
            armed ? `Press again to sit week ${k} out` : `Week ${k}: ${on ? 'sitting out' : 'playing'}`}</button>`;
        }).join('')}</div>` : ''}
      ${s.phase < s.weeks + 2 ? `<p><button data-btn="lg-leave" class="${arming === 'leave' ? 'danger' : ''}">${
        arming === 'leave' ? 'Press again to leave the league' : 'Leave the league'}</button></p>` : ''}
    ` });
  }
  const problem = me.joinProblem;
  return panel({ title: 'Join', bodyHtml: `
    ${problem
      ? `<p>${esc(problem[0]!.toUpperCase() + problem.slice(1))}.${/Discord name|usually free|hours/.test(problem)
        ? ' <button class="linkbtn" data-btn="lg-section" data-v="avail">Availability</button>' : ''}</p>`
      : `<p>You are all set. ${s.phase <= 0 ? 'Join, then play anybody free when you are this week. Pairings start with week 1.'
        : 'Press the button and your pairings arrive with the next week.'}</p>`}
    <button class="primary" data-btn="lg-join" ${problem || busy ? 'disabled' : ''}>Join ${esc(s.name)}</button>
    ${me.withdrawn ? '<p class="hint">You left this season; joining again keeps the results you already played.</p>' : ''}
  ` });
}

function availabilityCardHtml(v: LeagueView): string {
  const { draft: d, zones, dirty, busy, gridFocus } = v;
  const hrs = hoursIn(d.grid);
  const min = v.data?.minHours ?? 6;
  return panel({ title: "When you're usually free", wide: true, bodyHtml: `
    <div class="lgavail"><div class="lgavside">
    <p>Mark the hours you could usually play: pick quick fills, or <span class="mouseonly">drag across</span><span class="touchonly">tap hours on</span> the grid. Opponents are matched on the hours you share.</p>
    <div class="lgtzrow"><label>Your Discord name <input id="lg-contact" value="${esc(d.contact)}" maxlength="40"
      spellcheck="false" placeholder="e.g. rashi" autocomplete="off"></label></div>
    <p class="hint">Only other league players see it, so they can message you to arrange a game.</p>
    <div class="lgtzrow"><label>Time zone <input id="lg-tz" list="lg-tzlist" value="${esc(d.tz)}" spellcheck="false"></label>
      <datalist id="lg-tzlist">${zones.map(z => `<option value="${esc(z)}">`).join('')}</datalist>
      <button data-btn="lg-tz-here" title="use this device's time zone">Use ${esc(v.browserTz)}</button></div>
    <div class="lgpresets">${PRESETS.map(p => {
      const on = presetHours(p).every(i => d.grid[i] === '1');
      return `<button class="${on ? 'on' : ''}" data-btn="lg-grid-preset" aria-pressed="${on}" data-preset="${p.id}">${esc(p.label)}</button>`;
    }).join('')}</div>
    <p><span id="lg-hours" class="${hrs < min ? 'lgwarn' : ''}">${hrs} hours a week</span>${hrs < min ? ` — mark at least ${min} to join` : ''}.</p>
    ${d.contact.trim() ? '' : '<p class="lgwarn">Add your Discord name to join.</p>'}
    <p><button data-btn="lg-grid-clear">Clear</button>
      <button class="primary" data-btn="lg-grid-save" ${dirty && !busy ? '' : 'disabled'}>${dirty ? 'Save' : 'Saved'}</button></p>
    </div>
    <div class="lggrid" id="lg-grid" role="grid" aria-label="Hours you are usually free: arrow keys move, Space marks"
      aria-multiselectable="true">
      <div class="lgrow" role="row"><div role="columnheader" aria-label="hour"></div>${SHOW_DAYS.map(day =>
        `<div class="lgday" role="columnheader">${DAY_NAMES[day]}</div>`).join('')}</div>
      ${Array.from({ length: 24 }, (_, h) => `<div class="lgrow" role="row"><div class="lghr" role="rowheader">${hourLabel(h)}</div>${SHOW_DAYS.map((day, c) => {
        const i = day * 24 + h;
        const on = d.grid[i] === '1';
        const label = `${DAY_NAMES[day]} ${hourLabel(h)}`;
        return `<div class="lgcell${on ? ' on' : ''}" role="gridcell" aria-selected="${on}" aria-label="${label}"
          tabindex="${i === (gridFocus ?? SHOW_DAYS[1]! * 24 + 19) ? 0 : -1}" data-i="${i}" data-c="${c}" data-h="${h}" title="${label}"></div>`;
      }).join('')}</div>`).join('')}
    </div></div>
  ` });
}

function hourLabel(h: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' }).format(Date.UTC(2026, 0, 5, h));
  } catch { return `${h}:00`; }
}

const weekName = (s: SeasonView, k: number): string =>
  k > s.weeks ? 'The final' : k === 0 ? 'Sign-up week' : `Week ${k}`;

// the league's tables have no header row: the panel's title (and a week's
// sub-heading) say what the rows are. A column's class sits on every cell.
const MY_MATCH_COLUMNS = [{ key: 'who', label: '' }, { key: 'play', label: '', className: 'lgplay' }, { key: 'result', label: '' }];
const SUGGEST_COLUMNS = [{ key: 'who', label: '' }, { key: 'free', label: '' }, { key: 'play', label: '', className: 'lgplay' }];
const STAMP_COLUMNS = [{ key: 'preview', label: '' }, { key: 'code', label: '' }, { key: 'copy', label: '' }];
const OUTBOX_COLUMNS = [{ key: 'kind', label: '' }, { key: 'to', label: '' }, { key: 'at', label: '', className: 'dim' }, { key: 'state', label: '' }];
const PREVIEW_COLUMNS = [{ key: 'pair', label: '' }, { key: 'shared', label: '' }, { key: 'windows', label: '', className: 'dim' }];
const STANDINGS_COLUMNS = [{ key: 'rank', label: '#' }, { key: 'player', label: 'player' }, { key: 'wl', label: 'W–L' }, { key: 'pts', label: 'pts' },
  { key: 'omw', label: 'OMW', title: "opponents' match-win percentage — the tiebreak" }];

function myMatchesHtml(s: SeasonView, v: LeagueView): string {
  const { arming, timeOpen } = v;
  const me = s.me!;
  const weeks = [...new Set(me.matches.map(m => m.week))].sort((a, b) => b - a);
  return panel({ title: 'Your matches', wide: true, bodyHtml: `
    ${weeks.map(k => `${panelSubheading({ text: weekName(s, k) })}
      ${table({ className: 'lgmatches', headless: true, columns: MY_MATCH_COLUMNS, rows: me.matches.filter(m => m.week === k).map(m => ({ cells: {
        who: { html: `vs <b>${esc(m.opponent.name)}</b>${m.opponent.contact
          ? `<br><span class="dim">Discord: </span>${esc(m.opponent.contact)}` : ''}` },
        play: { html: m.playable ? `<button class="primary" data-btn="lg-play" data-season="${esc(s.id)}" data-match="${esc(m.id)}">Play</button>
          ${m.week === 0 ? `<button data-btn="lg-cancel" data-match="${esc(m.id)}" class="${arming === `cancel:${m.id}` ? 'danger' : ''}">${
            arming === `cancel:${m.id}` ? 'Press again to call it off' : 'Call off'}</button>` : ''}` : '' },
        result: { html: m.result
          ? (m.won === true ? '✅ you won' : m.won === false ? 'you lost'
            : m.result.outcome === 'double-loss' ? 'double loss' : '<span class="dim">not played</span>')
          : timeHtml(s, m, v) + (timeOpen === m.id ? '' : freeLineHtml(m, v)) },
      } })) })}`).join('')}
    <p class="hint">Times are in ${esc(v.tz)}. Play opens your match room; your opponent joins from their own
      League page. Nothing is dealt until you are both there, and the elements are drawn at random.</p>
  ` });
}

/** the shared hours still to come — a window already over is no use to anybody */
function freeLineHtml(m: MyMatch, v: LeagueView): string {
  const ahead = m.windows.filter(w => w.start + w.hours * 3_600_000 > v.now);
  return ahead.length
    ? `<div><span class="dim">you're both free:</span> ${ahead.slice(0, 4).map(w => windowText(w, v.tz)).map(esc).join(' · ')}</div>`
    : `<div class="dim">no shared hours left this week — suggest a time anyway, or arrange one on Discord</div>`;
}

/** where a match's time stands, and the controls to move it on */
function timeHtml(s: SeasonView, m: MyMatch, v: LeagueView): string {
  const { timeOpen, tz } = v;
  const t = m.time;
  const opp = esc(m.opponent.name);
  const line = !t ? ''
    : t.agreed ? `<div class="lgtime agreed">Playing <b>${esc(when(t.at, tz))}</b> ✓</div>`
    : t.mine ? `<div class="lgtime">You suggested <b>${esc(when(t.at, tz))}</b>. Waiting for ${opp}.</div>`
    : `<div class="lgtime ask">${opp} suggests <b>${esc(when(t.at, tz))}</b>
        <button class="primary" data-btn="lg-time-accept" data-season="${esc(s.id)}" data-match="${esc(m.id)}">Accept</button></div>`;
  if (!m.playable) return line;
  const toggle = timeOpen === m.id ? '' : `<button data-btn="lg-time-open" data-match="${esc(m.id)}">${
    t ? 'Suggest another time' : 'Suggest a time'}</button>`;
  return line + toggle + (timeOpen === m.id ? timeFormHtml(s, m, v) : '');
}

/** the week's end for this match: the next phase's start */
const deadlineOf = (s: SeasonView, m: MyMatch, now: number): number =>
  Date.parse(s.phases.find(p => p.phase === m.week + 1)?.at ?? '') || now + 7 * 86_400_000;

function timeFormHtml(s: SeasonView, m: MyMatch, v: LeagueView): string {
  const now = v.now;
  const end = deadlineOf(s, m, now);
  const tz = v.tz;
  // one chip per window: its first whole hour still far enough ahead
  const chips: number[] = [];
  for (const w of m.windows) {
    if (chips.length >= CHIP_MAX) break;
    for (let h = 0; h < w.hours; h++) {
      const at = w.start + h * 3_600_000;
      if (at >= now + LEAD_MS && at < end) { chips.push(at); break; }
    }
  }
  // a standard date-and-time field (owner, 2026-10-18), stepping by the
  // quarter hour. It has no zone of its own: its value is read as wall time
  // in the LEAGUE zone, which the label says — not the browser's.
  const earliest = Math.ceil((now + LEAD_MS) / (STEP_MIN * 60_000)) * STEP_MIN * 60_000;
  const start = m.time?.at && m.time.at > earliest ? m.time.at : chips[0] ?? earliest;
  return `<div class="lgtimeform">
    ${chips.length ? `<div class="lgtimechips"><span class="dim">you're both free:</span>
      ${chips.map(at => `<button data-btn="lg-time" data-season="${esc(s.id)}" data-match="${esc(m.id)}" data-at="${at}">${esc(when(at, tz))}</button>`).join('')}</div>` : ''}
    <div class="lgtimepick"><span class="dim">or</span>
      <input type="datetime-local" id="lgt-at" aria-label="Suggest a time" step="${STEP_MIN * 60}" value="${wallValue(start, tz)}"
        min="${wallValue(earliest, tz)}" max="${wallValue(end - STEP_MIN * 60_000, tz)}">
      <span class="dim">${esc(tz)} time</span>
      <button class="primary" data-btn="lg-time-custom" data-season="${esc(s.id)}" data-match="${esc(m.id)}">Suggest</button>
      <button data-btn="lg-time-close">Cancel</button>
    </div>
  </div>`;
}

/** sign-up week: everybody else in the league, best shared hours first */
function suggestionsHtml(s: SeasonView, v: LeagueView): string {
  const me = s.me!;
  const used = me.matches.filter(m => m.week === 0).length;
  return panel({ title: 'Free when you are', wide: true, bodyHtml: `
    <p>Sign-up week has no pairings. Play anybody here instead: up to ${me.week0Cap} games count in the standings
      (you have ${used}), one per opponent. Message them on Discord, then start the game and both press Play.</p>
    ${me.suggestions.length ? table({ className: 'lgsuggest', headless: true, columns: SUGGEST_COLUMNS, rows: me.suggestions.map(x => ({ cells: {
      who: { html: `<b>${esc(x.name)}</b>${x.contact ? `<br><span class="dim">Discord: </span>${esc(x.contact)}` : ''}` },
      free: { html: x.days ? `<span class="dim">free together:</span> ${x.windows.map(w => windowText(w, v.tz)).map(esc).join(' · ')}`
        : '<span class="dim">no shared hours left this week</span>' },
      play: { html: x.problem ? `<span class="dim">${esc(x.problem)}</span>`
        : `<button data-btn="lg-challenge" data-id="${esc(x.id)}">Start a league game</button>` },
    } })) }) : '<p class="dim">Nobody else has joined yet.</p>'}
    <p class="hint">Times are in ${esc(v.tz)}.</p>
  ` });
}

function standingsHtml(s: SeasonView, v: LeagueView): string {
  // before week 1 the table is everybody at 0–0: say who is in instead
  if (s.phase <= 0) {
    const ins = s.entrants.filter(e => !e.withdrawn);
    return panel({ title: `Signed up (${ins.length})`, wide: true,
      bodyHtml: `<p class="lgbnames">${ins.map(e => `<span>${esc(e.name)}</span>`).join('')}</p>` });
  }
  const withdrawn = new Set(s.entrants.filter(e => e.withdrawn).map(e => e.id));
  // a CLOSED season names its champion and finalist with the chip their
  // profile carries (docs/20 §7) — the two players of its final match
  const fin = s.phase >= s.weeks + 2 ? s.matches.find(m => m.final) : undefined;
  const mark = (id: string): string => {
    const place = s.champion?.id === id ? 'champion' as const
      : fin && (fin.a.id === id || fin.b.id === id) ? 'finalist' as const : null;
    if (place && s.phase >= s.weeks + 2) return v.chips[place];
    return s.champion?.id === id ? ' 🏆' : '';
  };
  return panel({ title: 'Standings', bodyHtml: `
    ${table({ columns: STANDINGS_COLUMNS, rows: s.standings.map(r => ({ className: withdrawn.has(r.id) ? 'dim' : undefined, cells: {
      rank: r.rank, player: { html: `${esc(r.name)}${mark(r.id)}` },
      wl: { html: `${r.w}–${r.l}${r.unplayed ? ` <span class="dim" title="matches not played">(${r.unplayed})</span>` : ''}` },
      pts: r.points, omw: r.w + r.l + r.unplayed ? `${Math.round(r.omw * 100)}%` : '–',
    } })) })}
    <p class="hint">3 points a win. Ties go to opponents' match-win percentage, then head to head.</p>
  ` });
}

const ALL_MATCH_COLUMNS = [{ key: 'pair', label: '' }, { key: 'result', label: '' }];
const ALL_MATCH_COLUMNS_ORG = [...ALL_MATCH_COLUMNS, { key: 'org', label: '', className: 'lgorg' }];

function allMatchesHtml(s: SeasonView, v: LeagueView): string {
  const weeks = [...new Set(s.matches.map(m => m.week))].sort((a, b) => b - a);
  const org = v.data?.organizer === true;
  // the organizer's result controls need the width; a player's view sits beside the table
  return panel({ title: 'Matches', wide: org, className: org ? undefined : 'lgspan2', bodyHtml: `
    ${weeks.map(k => `${panelSubheading({ text: weekName(s, k) })}
      ${table({ headless: true, columns: org ? ALL_MATCH_COLUMNS_ORG : ALL_MATCH_COLUMNS, rows: s.matches.filter(m => m.week === k).map(m => ({ cells: {
        pair: `${m.a.name} vs ${m.b.name}`, result: { html: `${resultText(m)}${disputesHtml(m)}` },
        org: { html: `<select id="lg-ov-${esc(m.id)}" aria-label="Set the result of ${esc(m.a.name)} vs ${esc(m.b.name)}">
          <option value="">set…</option><option value="a">${esc(m.a.name)} won</option><option value="b">${esc(m.b.name)} won</option>
          <option value="unplayed">not played</option><option value="double-loss">double loss</option><option value="clear">reopen</option>
        </select><button data-btn="lg-override" data-match="${esc(m.id)}">Set</button>` },
      } })) })}`).join('')}
  ` });
}

/** BL-48 — the organizer's line under a disputed match: who, and what they
 * said. The result is untouched; the override beside it is the remedy. */
function disputesHtml(m: SeasonView['matches'][number]): string {
  return (m.disputes ?? []).map(d =>
    `<div class="lgdispute">Disputed by <b>${esc(d.name)}</b> (${esc(d.code)}): ${esc(d.note)}</div>`).join('');
}

function stampHtml(v: LeagueView): string {
  const tz = v.tz;
  const at = v.stampAt;
  const unix = Math.floor(at / 1000);
  return panel({ title: 'Discord time code', className: 'lgstamp', bodyHtml: `
    <p class="lgtimepick"><input type="datetime-local" id="lg-stamp-at" aria-label="Date and time" step="60" value="${wallValue(at, tz)}">
      <span class="dim">${esc(tz)} time</span></p>
    ${table({ className: 'lgstamps', headless: true, columns: STAMP_COLUMNS, rows: STAMP_STYLES.map(st => ({ cells: {
      preview: stampPreview(at, st, tz, v.now),
      code: { html: `<input id="lg-stamp-${st}" class="lgstampcode" readonly aria-label="Discord code" value="${esc(discordCode(unix, st))}">` },
      copy: { html: `<button data-btn="lg-stamp-copy" data-style="${st}">Copy</button>` },
    } })) })}
  ` });
}

// ── the organizer ─────────────────────────────────────────────────────

/** the next Sunday 07:00 UTC — midnight Saturday on the US west coast, the
 * league's week boundary (owner, 2026-10-04) */
function nextSundayUtc(from: number): string {
  const d = new Date(from);
  const add = ((7 - d.getUTCDay()) % 7) || 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add, 7)).toISOString();
}

/** an ISO instant as a datetime-local value, in this browser's zone */
function localInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function organizerHtml(s: SeasonView | null, v: LeagueView): string {
  const { arming, preview, tz } = v;
  const now = v.now;
  const start = nextSundayUtc(now);
  const next = s ? s.phases.find(p => p.phase === s.phase + 1) : null;
  return panel({ title: 'Organizer', wide: true, className: 'lgorgcard', bodyHtml: `
    ${s ? `
      <p>${esc(s.name)} (${formatWords(s.format)}) is at <b>${esc(s.label)}</b>. ${s.auto
        ? `It moves on by itself${s.hold ? ' — <b>but it is on hold</b>' : ''}${next ? `: next is <b>${esc(next.label)}</b> at ${when(next.at, tz)}` : ''}.`
        : 'It moves on only when you press Advance.'}</p>
      <p>
        ${next ? `<button class="${arming === 'advance' ? 'danger' : 'primary'}" data-btn="lg-advance">${
          arming === 'advance' ? `Press again: move to ${esc(next.label)} now` : `Advance to ${esc(next.label)}`}</button>` : ''}
        ${s.phase < s.weeks ? '<button data-btn="lg-preview">Preview next pairings</button>' : ''}
        <button data-btn="lg-set" data-key="hold" data-val="${s.hold ? '0' : '1'}">${s.hold ? 'Release hold' : 'Hold at next boundary'}</button>
        <button data-btn="lg-set" data-key="auto" data-val="${s.auto ? '0' : '1'}">${s.auto ? 'Switch to manual' : 'Switch to automatic'}</button>
        <button data-btn="lg-set" data-key="hidden" data-val="${s.hidden ? '0' : '1'}">${s.hidden ? 'Make public' : 'Hide'}</button>
        ${s.formatProblem ? '' : FORMATS.filter(f => f !== (s.format ?? 'draft')).map(f =>
          `<button data-btn="lg-format" data-val="${f}">Make it ${formatWords(f)}</button>`).join(' ')}
        ${s.hidden ? `<button class="${arming === 'delete' ? 'danger' : ''}" data-btn="lg-delete">${arming === 'delete' ? 'Press again to delete this test season' : 'Delete'}</button>` : ''}
      </p>
      ${repairHtml(s, v)}
      <p><input id="lg-addname" aria-label="Player name" placeholder="player name" spellcheck="false"> <button data-btn="lg-add">Add player</button>
        <span class="dim">(skips the Discord-name, hours and late-entry checks)</span></p>
      ${preview ? previewHtml(preview, tz) : ''}
      ${postHtml(s, v)}
      ${s.outbox?.length ? `${panelSubheading({ text: 'Discord messages' })}${table({ className: 'lgout', headless: true, columns: OUTBOX_COLUMNS,
        rows: s.outbox.slice().reverse().slice(0, 25).map(r => ({ cells: {
          kind: r.kind, to: r.to, at: { html: when(r.createdAt, tz) },
          state: { html: r.failed ? `⚠ ${esc(r.failed)}` : r.sentAt ? '✓ sent' : '<span class="dim">waiting</span>' },
        } })) })}` : ''}
      ${s.log?.length ? `<details><summary>Log</summary><ul class="lglog">${s.log.slice().reverse().map(l =>
        `<li><span class="dim">${when(l.at, tz)}</span> ${esc(l.what)}</li>`).join('')}</ul></details>` : ''}
    ` : ''}
    <details ${s ? '' : 'open'}><summary>New season</summary>
      <div class="lgform">
        <label>Id <input id="lg-new-id" value="${esc(new Date(start).toISOString().slice(0, 7))}" spellcheck="false"></label>
        <label>Name <input id="lg-new-name" value="${esc(fmt(Date.parse(start), { month: 'long', year: 'numeric' }, tz))}"></label>
        <label>Sign-ups open <input id="lg-new-open" type="datetime-local" value="${localInput(new Date(now).toISOString())}"></label>
        <label>Week 1 starts <input id="lg-new-start" type="datetime-local" value="${localInput(start)}"></label>
        <label>Weeks <input id="lg-new-weeks" type="number" min="1" max="8" value="3"></label>
        <label>Opponents a week <input id="lg-new-per" type="number" min="1" max="6" value="3"></label>
        <label>Format <select id="lg-new-format">
          <option value="draft">Live draft (random elements)</option>
          <option value="constructed">Casual constructed (any deck, every game)</option>
          <option value="competitive">Competitive Constructed (best of three, sideboards)</option></select></label>
        <label><input id="lg-new-auto" type="checkbox" checked> automatic (follows the calendar)</label>
        <label><input id="lg-new-hidden" type="checkbox"> hidden (a test season)</label>
      </div>
      <p class="hint">Week boundaries are a whole week apart from week 1's start. Sunday 07:00 UTC (midnight Saturday, US Pacific) is the default.</p>
      <button class="primary" data-btn="lg-create">Create season</button>
    </details>
  ` });
}

/** The running week, paired again: a player who sat it out by mistake goes
 * back in. Only while nobody has started on it (the server says why not). */
function repairHtml(s: SeasonView, v: LeagueView): string {
  if (s.phase < 1 || s.phase > s.weeks) return '';
  const { arming } = v;
  const k = s.phase;
  const out = s.entrants.filter(e => !e.withdrawn && e.skips.includes(k));
  const why = s.repairProblem ?? null;
  const btn = (key: string, label: string, extra = ''): string =>
    `<button data-btn="lg-repair" ${extra} class="${arming === key ? 'danger' : ''}" ${why ? 'disabled' : ''}>${
      arming === key ? `Press again: ${label.toLowerCase()} and pair week ${k} again` : label}</button>`;
  return `<p>${out.length ? `Sitting week ${k} out: ${out.map(e =>
      `<b>${esc(e.name)}</b> ${btn(`repair:${e.id}`, 'Put back in', `data-put="${esc(e.id)}"`)}`).join(' ')} ` : ''}
    ${btn('repair:', `Pair week ${k} again`)}
    <span class="dim">${why ? `(not now: ${esc(why)})` : '(new opponents for everybody; post the new pairings)'}</span></p>`;
}

function postHtml(s: SeasonView, v: LeagueView): string {
  const text = postText(s, v.origin);
  return `${panelSubheading({ text: 'Post for Discord' })}
    <textarea id="lg-post" class="lgpost" readonly aria-label="The post" rows="${Math.min(18, text.split('\n').length + 1)}">${esc(text)}</textarea>
    <p><button data-btn="lg-copy">Copy</button> <span class="dim">Times are Discord timestamps — each reader sees their own.</span></p>`;
}

function previewHtml(p: Preview, tz: string): string {
  return `${panelSubheading({ text: `Week ${p.week} would be` })}
    ${table({ headless: true, columns: PREVIEW_COLUMNS, rows: p.edges.map(e => ({ className: e.score < 2 ? 'lgweak' : undefined, cells: {
      pair: `${e.a} vs ${e.b}`, shared: `${e.score} day${e.score === 1 ? '' : 's'} shared`,
      windows: e.windows.slice(0, 2).map(w => windowText(w, tz)).join(' · '),
    } })) })}
    <p class="hint">${p.short ? `${esc(p.short)} has one opponent fewer this week. ` : ''}Rows in red share fewer than two days — they
      may struggle to meet. The real pairing is made from the players and results at the moment the week starts.</p>`;
}

// ── gathering ─────────────────────────────────────────────────────────

/** ui/league.ts's state, as it stands, that the page reads */
export interface LeagueRaw {
  data: LeagueState | null;
  /** the home banner's copy (the zone falls back to it) */
  hint: LeagueState | null;
  loading: boolean;
  msg: string;
  draft: { tz: string; grid: string; contact: string } | null;
  dirty: boolean;
  busy: boolean;
  arming: string | null;
  gridFocus: number | null;
  timeOpen: string | null;
  preview: Preview | null;
  /** the chosen Discord time code instant, or null for the next quarter hour */
  stampAt: number | null;
  /** the part of the season showing */
  section: LeagueSection;
}

/** The zone to show times in: the one the viewer's availability is written
 * in, else the browser's. */
export const viewTz = (data: LeagueState | null, hint: LeagueState | null): string =>
  (data ?? hint)?.availability?.tz ?? browserTz();

function supportedZones(): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (f) return f('timeZone');
  } catch { /* old browser */ }
  return [browserTz(), 'UTC'];
}

/** Gather everything the League page shows. */
export function leagueView(r: LeagueRaw): LeagueView {
  const now = Date.now();
  const s = r.data?.season ?? null;
  return {
    data: r.data, loading: r.loading, msg: r.msg,
    draft: r.draft ?? { tz: browserTz(), grid: defaultGrid(), contact: '' },
    dirty: r.dirty, busy: r.busy, arming: r.arming, gridFocus: r.gridFocus, timeOpen: r.timeOpen, preview: r.preview,
    now,
    tz: viewTz(r.data, r.hint),
    browserTz: browserTz(),
    zones: r.data?.signedIn ? supportedZones() : [],
    origin: location.origin,
    stampAt: r.stampAt ?? nextQuarter(now),
    chips: s ? { champion: trophyChipHtml({ name: s.name, place: 'champion' }, false), finalist: trophyChipHtml({ name: s.name, place: 'finalist' }, false) }
      : { champion: '', finalist: '' },
    section: r.section,
    chrome: frameChromeView(),
  };
}
