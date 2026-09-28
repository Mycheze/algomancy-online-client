/* THE LEAGUE — the half that remembers (docs/20-league.md).
 *
 * league.ts decides; this file keeps. It owns `var/league.json` — every
 * season, its entrants, pairings and results, and the OUTBOX — and it is the
 * only thing that moves a season from one phase to the next.
 *
 * ── THE OUTBOX, AND WHY NOT A PUSH ───────────────────────────────────────
 *
 * The queue's events reach the bot by a fire-and-forget push (hooks.ts), and
 * the bot has never read the catch-up ring, so anything sent while the bot is
 * restarting is simply gone. That is fine for "someone is queueing" and not
 * fine for "here are your opponents for the week". So every league message is
 * a ROW here, written in the same atomic write as the change that caused it,
 * and it stays until the bot PULLS it (`/api/bot/league/outbox`) and ACKS it.
 * Neither side can lose one across a restart; a row the bot sent but never
 * acked is at worst sent twice, never zero times.
 *
 * ── PHASES ───────────────────────────────────────────────────────────────
 *
 * -1 announced · 0 sign-ups · 1..weeks · final · closed (league.ts). An
 * AUTOMATIC season follows its calendar (`tick`); a MANUAL one only moves when
 * the organizer presses Advance — that is how a test season runs a month in
 * half an hour, and nothing else about it differs. `hold` stops an automatic
 * season at its next boundary until the organizer advances it by hand.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { leagueFile } from './statepaths.ts';
import { accountById, setLeagueHonour, type Account, type LeagueHonour } from './accounts.ts';
import {
  MIN_HOURS, calendarPhase, closedPhase, finalPhase, hoursIn, meetings, pairWeek, phaseLabel,
  phaseStart, sharedWindows, standings, WEEK_MS,
  type LeagueMatch, type MatchResult, type Outcome, type Pairing, type SeasonClock, type StandingRow, type Window,
} from './league.ts';

export interface Entrant {
  userId: string;
  joinedAt: string;
  /** the phase it was when they joined: 0 = during sign-ups, 1 = a late entry in week 1 */
  joinedPhase: number;
  /** weeks they asked to sit out */
  skips: number[];
  withdrawnAt?: string;
}

export interface Season extends SeasonClock {
  /** `[a-z0-9-]`, e.g. `2026-10` — also the prefix of every match id */
  id: string;
  name: string;
  /** opponents per week (capped at entrants − 1 when paired) */
  perWeek: number;
  /** follows its calendar; false = moves only when the organizer advances it */
  auto: boolean;
  /** an automatic season waits at its next boundary */
  hold: boolean;
  /** seen by admins and its own entrants only — the prod smoke test */
  hidden: boolean;
  /** a late sign-up is accepted until this week's pairings go out */
  lateUntil: number;
  phase: number;
  createdAt: string;
  entrants: Entrant[];
  matches: LeagueMatch[];
  /** week → the player who was short that week */
  shorts: Record<string, string>;
  /** the final's winner, once the season is closed */
  champion?: string;
  /** what happened when, for the organizer */
  log: { at: string; what: string }[];
}

/** Who a row is for: an account id, or null for the league channel. */
export interface OutboxRow {
  id: number;
  season: string;
  to: string | null;
  kind: OutboxKind;
  /** everything the bot needs to render it; `ids` lists every account it names */
  data: Record<string, unknown> & { ids?: string[] };
  createdAt: string;
  sentAt?: string;
  /** why it could not be delivered: 'dm-closed', 'not-linked', … */
  failed?: string;
}

export type OutboxKind =
  | 'signup'         // you are in
  | 'signups-open'   // channel
  | 'pairings'       // your opponents this week
  | 'sitting-out'    // you skipped this week, or the numbers left you out
  | 'week-pairings'  // channel: the whole week
  | 'week-closed'    // channel: the table after a week
  | 'final'          // you are in the final / channel: the final is X vs Y
  | 'result'         // a match settled
  | 'season';        // the season is over: your place / channel: the champion

interface LeagueStore { version: 1; seasons: Season[]; outbox: OutboxRow[]; nextId: number }

/** sent and failed rows are kept this long, for the organizer to look at */
const OUTBOX_KEEP_MS = 30 * 24 * 3_600_000;

let store: LeagueStore | null = null;
let fileOverride: string | null = null;
const filePath = (): string => fileOverride ?? leagueFile();

function db(): LeagueStore {
  if (store) return store;
  try {
    const raw = JSON.parse(readFileSync(filePath(), 'utf8')) as Partial<LeagueStore>;
    store = { version: 1, seasons: raw.seasons ?? [], outbox: raw.outbox ?? [], nextId: raw.nextId ?? 1 };
  } catch {
    store = { version: 1, seasons: [], outbox: [], nextId: 1 };
  }
  return store;
}

/** Re-read the file (boot, and tests). */
export function loadLeague(): void { store = null; db(); }

/** Tests only: point the store at a throwaway file. Returns a restore function. */
export function useLeagueFile(path: string): () => void {
  const prev = fileOverride;
  fileOverride = path;
  loadLeague();
  return () => { fileOverride = prev; loadLeague(); };
}

/** Temp file + rename, like accounts.ts: a crash mid-write must not leave half a season. */
function persist(now = Date.now()): void {
  const s = db();
  s.outbox = s.outbox.filter(r => !(r.sentAt || r.failed) || now - Date.parse(r.sentAt ?? r.createdAt) < OUTBOX_KEEP_MS);
  try {
    const file = filePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 1));
    renameSync(`${file}.tmp`, file);
  } catch (err) {
    console.error('[league] could not persist:', err);
  }
}

const iso = (ms: number): string => new Date(ms).toISOString();
const nameOf = (id: string): string => accountById(id)?.username ?? 'someone';

function send(season: Season, to: string | null, kind: OutboxKind, data: OutboxRow['data'], now: number): void {
  const s = db();
  s.outbox.push({ id: s.nextId++, season: season.id, to, kind, data, createdAt: iso(now) });
}

function note(season: Season, what: string, now: number): void {
  season.log.push({ at: iso(now), what });
  if (season.log.length > 200) season.log.splice(0, season.log.length - 200);
}

// ── reading ───────────────────────────────────────────────────────────

export const allSeasons = (): Season[] => db().seasons;
export const seasonById = (id: string): Season | undefined => db().seasons.find(s => s.id === id);

export const isClosed = (s: Season): boolean => s.phase >= closedPhase(s);

/** Can this viewer see this season at all? A hidden one is for admins and its own entrants. */
export function canSee(s: Season, viewer: Account | undefined, admin: boolean): boolean {
  return !s.hidden || admin || (!!viewer && s.entrants.some(e => e.userId === viewer.id));
}

/**
 * The season a page should show: the newest one still running (or announced),
 * else the newest finished one. `?season=` picks a particular one instead.
 */
export function currentSeason(viewer: Account | undefined, admin: boolean): Season | null {
  const visible = db().seasons.filter(s => canSee(s, viewer, admin));
  const live = visible.filter(s => !isClosed(s));
  const pick = (xs: Season[]): Season | null =>
    xs.length ? xs.reduce((a, b) => (Date.parse(b.start) > Date.parse(a.start) ? b : a)) : null;
  return pick(live) ?? pick(visible);
}

export const activeEntrants = (s: Season): Entrant[] => s.entrants.filter(e => !e.withdrawnAt);

/** The table, over everybody who entered (a withdrawn player keeps the results they played). */
export function table(s: Season): StandingRow[] {
  return standings(s.entrants.map(e => e.userId), s.matches);
}

const recordOf = (rows: StandingRow[], id: string): string => {
  const r = rows.find(x => x.id === id);
  return r ? `${r.w}–${r.l}` : '0–0';
};

// ── the organizer's side: seasons ─────────────────────────────────────

export interface SeasonInput {
  id: string; name: string; signupOpens: string; start: string;
  weeks: number; perWeek: number; auto: boolean; hidden: boolean; lateUntil?: number;
}

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function checkInput(i: Partial<SeasonInput>): string | null {
  if (!i.id || !/^[a-z0-9][a-z0-9-]{0,23}$/.test(i.id)) return 'the id is 1–24 lowercase letters, digits and dashes, like 2026-10';
  if (!i.name || i.name.length > 60) return 'give the season a name (60 characters at most)';
  if (!i.signupOpens || Number.isNaN(Date.parse(i.signupOpens))) return 'sign-ups need an opening date';
  if (!i.start || Number.isNaN(Date.parse(i.start))) return 'week 1 needs a start date';
  if (Date.parse(i.signupOpens) > Date.parse(i.start)) return 'sign-ups must open before week 1 starts';
  if (!Number.isInteger(i.weeks) || i.weeks! < 1 || i.weeks! > 8) return 'a season is 1–8 weeks';
  if (!Number.isInteger(i.perWeek) || i.perWeek! < 1 || i.perWeek! > 6) return '1–6 opponents a week';
  if (i.lateUntil !== undefined && (!Number.isInteger(i.lateUntil) || i.lateUntil < 1 || i.lateUntil > i.weeks!)) {
    return 'late sign-ups must close by a week of the season';
  }
  return null;
}

export function createSeason(i: SeasonInput, now: number): Res<{ season: Season }> {
  const bad = checkInput(i);
  if (bad) return { ok: false, error: bad };
  if (seasonById(i.id)) return { ok: false, error: `there is already a season called ${i.id}` };
  const season: Season = {
    id: i.id, name: i.name, signupOpens: iso(Date.parse(i.signupOpens)), start: iso(Date.parse(i.start)),
    weeks: i.weeks, perWeek: i.perWeek, auto: i.auto, hold: false, hidden: i.hidden,
    lateUntil: Math.min(i.lateUntil ?? 2, i.weeks), phase: -1, createdAt: iso(now),
    entrants: [], matches: [], shorts: {}, log: [],
  };
  db().seasons.push(season);
  note(season, 'created', now);
  // an automatic season whose sign-ups are already due opens now
  if (season.auto) catchUp(season, now);
  persist(now);
  return { ok: true, season };
}

/** Change a season. The calendar can only change before week 1 is paired;
 * `hold`, `hidden`, `auto` and the name at any time. */
export function updateSeason(id: string, patch: Partial<SeasonInput> & { hold?: boolean }, now: number): Res<{ season: Season }> {
  const s = seasonById(id);
  if (!s) return { ok: false, error: 'no such season' };
  const calendar = ['signupOpens', 'start', 'weeks', 'perWeek', 'lateUntil'] as const;
  if (s.phase >= 1 && calendar.some(k => patch[k] !== undefined)) {
    return { ok: false, error: 'the calendar is fixed once week 1 is paired' };
  }
  const next = { ...s, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Season;
  const bad = checkInput(next);
  if (bad) return { ok: false, error: bad };
  s.name = next.name; s.auto = next.auto === true; s.hidden = next.hidden === true;
  s.signupOpens = iso(Date.parse(next.signupOpens)); s.start = iso(Date.parse(next.start));
  s.weeks = next.weeks; s.perWeek = next.perWeek; s.lateUntil = Math.min(next.lateUntil, next.weeks);
  if (patch.hold !== undefined) s.hold = patch.hold === true;
  note(s, `settings changed: ${Object.keys(patch).join(', ')}`, now);
  if (s.auto) catchUp(s, now);
  persist(now);
  return { ok: true, season: s };
}

/** Only a HIDDEN season can be deleted — a test season. A real one is kept
 * even when it went wrong: people's results are in it. */
export function deleteSeason(id: string): Res {
  const st = db();
  const s = seasonById(id);
  if (!s) return { ok: false, error: 'no such season' };
  if (!s.hidden) return { ok: false, error: 'only a hidden (test) season can be deleted' };
  st.seasons = st.seasons.filter(x => x !== s);
  st.outbox = st.outbox.filter(r => r.season !== id);
  persist();
  return { ok: true };
}

// ── the player's side ─────────────────────────────────────────────────

/** Why this account cannot join right now, or null if it can. */
export function joinProblem(s: Season, account: Account, opts: { requireDiscord: boolean; byAdmin?: boolean }): string | null {
  const e = s.entrants.find(x => x.userId === account.id);
  if (e && !e.withdrawnAt) return 'you are already in';
  if (s.phase < 0 && !opts.byAdmin) return 'sign-ups are not open yet';
  if (s.phase >= finalPhase(s)) return 'this season is over';
  if (s.phase >= s.lateUntil && !opts.byAdmin) return 'late sign-ups for this season have closed';
  if (account.provisional && !opts.byAdmin) return 'give your guest account a name and password first';
  const grid = account.league?.grid;
  if (!account.league?.tz || !grid) return 'set when you are usually free first';
  if (hoursIn(grid) < MIN_HOURS && !opts.byAdmin) return `mark at least ${MIN_HOURS} hours a week when you could play`;
  if (opts.requireDiscord && !opts.byAdmin && !account.linked?.discord) {
    return 'link your Discord account first — pairings and reminders come as Discord messages';
  }
  return null;
}

export function joinSeason(s: Season, account: Account, now: number, opts: { requireDiscord: boolean; byAdmin?: boolean }): Res {
  const why = joinProblem(s, account, opts);
  if (why) return { ok: false, error: why };
  const had = s.entrants.find(x => x.userId === account.id);
  if (had) { delete had.withdrawnAt; had.joinedPhase = Math.max(0, s.phase); }
  else s.entrants.push({ userId: account.id, joinedAt: iso(now), joinedPhase: Math.max(0, s.phase), skips: [] });
  note(s, `${account.username} joined${opts.byAdmin ? ' (added by the organizer)' : ''}`, now);
  const firstWeek = Math.max(1, s.phase + 1);
  send(s, account.id, 'signup', {
    season: s.name, firstWeek, weeks: s.weeks,
    firstPairings: Math.floor(phaseStart(s, firstWeek) / 1000),
    late: s.phase >= 1,
  }, now);
  persist(now);
  return { ok: true };
}

/** Leave. During sign-ups that removes the entry outright; later it withdraws
 * (the results already played stay in the table, and no more pairings come). */
export function leaveSeason(s: Season, account: Account, now: number): Res {
  const e = s.entrants.find(x => x.userId === account.id && !x.withdrawnAt);
  if (!e) return { ok: false, error: 'you are not in this season' };
  if (s.phase >= closedPhase(s)) return { ok: false, error: 'this season is over' };
  if (s.phase <= 0) s.entrants = s.entrants.filter(x => x !== e);
  else e.withdrawnAt = iso(now);
  note(s, `${account.username} left`, now);
  persist(now);
  return { ok: true };
}

/** Sit out (or stop sitting out) a week whose pairings have not gone out yet. */
export function setSkip(s: Season, account: Account, week: number, on: boolean, now: number): Res<{ skips: number[] }> {
  const e = s.entrants.find(x => x.userId === account.id && !x.withdrawnAt);
  if (!e) return { ok: false, error: 'you are not in this season' };
  if (!Number.isInteger(week) || week < 1 || week > s.weeks) return { ok: false, error: 'no such week' };
  if (week <= s.phase) return { ok: false, error: `week ${week}'s pairings are already out` };
  e.skips = on ? [...new Set([...e.skips, week])].sort((a, b) => a - b) : e.skips.filter(w => w !== week);
  note(s, `${account.username} ${on ? 'will sit out' : 'will play'} week ${week}`, now);
  persist(now);
  return { ok: true, skips: e.skips };
}

// ── moving a season on ────────────────────────────────────────────────

/** Who gets paired in week k: in, not withdrawn, joined before week k began, not sitting it out. */
function pairable(s: Season, k: number): Entrant[] {
  return activeEntrants(s).filter(e => e.joinedPhase < k && !e.skips.includes(k));
}

/** What week k's pairings would be, without publishing anything. */
export function pairingFor(s: Season, k: number): Pairing {
  const rows = table(s);
  const rank = new Map(rows.map(r => [r.id, r]));
  const shortCount = (id: string): number => Object.values(s.shorts).filter(x => x === id).length;
  return pairWeek({
    players: pairable(s, k).map(e => {
      const a = accountById(e.userId);
      return {
        id: e.userId,
        wins: rank.get(e.userId)?.w ?? 0,
        av: a?.league?.tz && a.league.grid ? { tz: a.league.tz, grid: a.league.grid } : null,
        shortCount: shortCount(e.userId),
        rank: rank.get(e.userId)?.rank ?? rows.length + 1,
      };
    }),
    perWeek: s.perWeek,
    weekStartMs: phaseStart(s, k),
    met: meetings(s.matches.filter(m => !m.final)),
    seed: `${s.id}:w${k}`,
  });
}

/** The organizer's preview of the NEXT week's pairings (null when the next phase is not a week). */
export function previewNext(s: Season): { week: number; pairing: Pairing } | null {
  const k = Math.max(1, s.phase + 1);
  if (k > s.weeks) return null;
  return { week: k, pairing: pairingFor(s, k) };
}

const unix = (ms: number): number => Math.floor(ms / 1000);
const windowsOut = (ws: Window[]): { start: number; hours: number }[] =>
  ws.map(w => ({ start: unix(w.start), hours: w.hours }));

function publishWeek(s: Season, k: number, now: number): void {
  const p = pairingFor(s, k);
  p.edges.forEach((e, i) => {
    s.matches.push({ id: `${s.id}-w${k}-${i + 1}`, week: k, a: e.a, b: e.b, windows: e.windows });
  });
  if (p.short) s.shorts[String(k)] = p.short;
  const rows = table(s);
  const deadline = unix(phaseStart(s, k + 1));
  const week = s.matches.filter(m => m.week === k);
  const paired = new Set(week.flatMap(m => [m.a, m.b]));
  for (const id of paired) {
    const mine = week.filter(m => m.a === id || m.b === id);
    send(s, id, 'pairings', {
      season: s.name, week: k, weeks: s.weeks, deadline, record: recordOf(rows, id),
      short: p.short === id,
      opponents: mine.map(m => {
        const opp = m.a === id ? m.b : m.a;
        return { id: opp, name: nameOf(opp), record: recordOf(rows, opp), match: m.id, windows: windowsOut(m.windows) };
      }),
      ids: [id, ...mine.map(m => (m.a === id ? m.b : m.a))],
    }, now);
  }
  for (const e of activeEntrants(s)) {
    if (paired.has(e.userId) || e.joinedPhase >= k) continue;
    send(s, e.userId, 'sitting-out', {
      season: s.name, week: k, skipped: e.skips.includes(k), next: k < s.weeks ? k + 1 : null,
    }, now);
  }
  send(s, null, 'week-pairings', {
    season: s.name, week: k, weeks: s.weeks, deadline,
    matches: week.map(m => ({ a: m.a, b: m.b, aName: nameOf(m.a), bName: nameOf(m.b) })),
    ids: [...paired],
  }, now);
  note(s, `week ${k} paired: ${week.length} matches${p.weak.length ? `, ${p.weak.length} with little shared time` : ''}`, now);
}

/** Every match of week k still open becomes unplayed (docs/20 §9 Q2: no result, 0 points). */
function closeWeek(s: Season, k: number, now: number): void {
  let n = 0;
  for (const m of s.matches) {
    if (m.week !== k || m.result) continue;
    m.result = { outcome: 'unplayed', how: 'deadline', at: iso(now) };
    n++;
  }
  note(s, `week ${k} closed${n ? `, ${n} unplayed` : ''}`, now);
}

function openFinal(s: Season, now: number): void {
  const rows = table(s).filter(r => activeEntrants(s).some(e => e.userId === r.id));
  const [one, two] = rows;
  if (!one || !two) { note(s, 'no final: fewer than two players', now); return; }
  const k = finalPhase(s);
  const windows = sharedWindows(avOf(one.id), avOf(two.id), phaseStart(s, k));
  const m: LeagueMatch = { id: `${s.id}-final`, week: k, final: true, a: one.id, b: two.id, windows };
  s.matches.push(m);
  const deadline = unix(phaseStart(s, k + 1));
  for (const [me, them] of [[one.id, two.id], [two.id, one.id]] as const) {
    send(s, me, 'final', {
      season: s.name, finalist: true, opponent: { id: them, name: nameOf(them), record: recordOf(rows, them) },
      match: m.id, windows: windowsOut(windows), deadline, ids: [me, them],
    }, now);
  }
  send(s, null, 'final', {
    season: s.name, finalist: false, a: one.id, b: two.id, aName: nameOf(one.id), bName: nameOf(two.id),
    deadline, ids: [one.id, two.id],
  }, now);
  note(s, `final: ${nameOf(one.id)} vs ${nameOf(two.id)}`, now);
}

function avOf(id: string): { tz: string; grid: string } | null {
  const a = accountById(id);
  return a?.league?.tz && a.league.grid ? { tz: a.league.tz, grid: a.league.grid } : null;
}

/** Close the season: settle the final, write every entrant's honour onto their account. */
function closeSeason(s: Season, now: number): void {
  closeWeek(s, finalPhase(s), now);
  const fin = s.matches.find(m => m.final);
  const out = fin?.result?.outcome;
  if (fin && (out === 'a' || out === 'b')) s.champion = out === 'a' ? fin.a : fin.b;
  const rows = table(s);
  const played = (id: string): boolean => s.matches.some(m => (m.a === id || m.b === id)
    && (m.result?.outcome === 'a' || m.result?.outcome === 'b'));
  for (const e of s.entrants) {
    if (!played(e.userId)) continue;
    const r = rows.find(x => x.id === e.userId);
    let w = r?.w ?? 0, l = r?.l ?? 0;
    if (fin && (fin.a === e.userId || fin.b === e.userId) && (out === 'a' || out === 'b')) {
      if (s.champion === e.userId) w++; else l++;
    }
    const place: LeagueHonour['place'] = s.champion === e.userId ? 'champion'
      : fin && (fin.a === e.userId || fin.b === e.userId) ? 'finalist' : 'participant';
    const account = accountById(e.userId);
    if (account) setLeagueHonour(account, { season: s.id, name: s.name, place, w, l });
    send(s, e.userId, 'season', { season: s.name, place, w, l, champion: s.champion ? nameOf(s.champion) : null }, now);
  }
  send(s, null, 'season', {
    season: s.name, champion: s.champion ?? null, championName: s.champion ? nameOf(s.champion) : null,
    table: rows.slice(0, 8).map(r => ({ id: r.id, name: nameOf(r.id), w: r.w, l: r.l, points: r.points })),
    ids: rows.slice(0, 8).map(r => r.id),
  }, now);
  note(s, s.champion ? `closed: ${nameOf(s.champion)} is champion` : 'closed: no champion', now);
}

/** Move a season on by exactly one phase. */
export function advance(s: Season, now: number): Res<{ phase: number; label: string }> {
  if (s.phase >= closedPhase(s)) return { ok: false, error: 'this season is already over' };
  const p = s.phase + 1;
  if (p === 0) {
    send(s, null, 'signups-open', {
      season: s.name, start: unix(phaseStart(s, 1)), weeks: s.weeks, perWeek: s.perWeek,
    }, now);
    note(s, 'sign-ups opened', now);
  } else if (p === 1) {
    publishWeek(s, 1, now);
  } else if (p <= s.weeks) {
    closeWeek(s, p - 1, now);
    weekClosed(s, p - 1, now);
    publishWeek(s, p, now);
  } else if (p === finalPhase(s)) {
    closeWeek(s, s.weeks, now);
    weekClosed(s, s.weeks, now);
    openFinal(s, now);
  } else {
    closeSeason(s, now);
  }
  s.phase = p;
  persist(now);
  return { ok: true, phase: p, label: phaseLabel(s, p) };
}

function weekClosed(s: Season, k: number, now: number): void {
  const rows = table(s);
  send(s, null, 'week-closed', {
    season: s.name, week: k, weeks: s.weeks,
    table: rows.slice(0, 10).map(r => ({ id: r.id, name: nameOf(r.id), w: r.w, l: r.l, points: r.points })),
    ids: rows.slice(0, 10).map(r => r.id),
  }, now);
}

/** An automatic season catches up with its calendar — one phase at a time,
 * so a server that was down over a boundary still pairs the week it missed. */
function catchUp(s: Season, now: number): boolean {
  if (!s.auto || s.hold) return false;
  let moved = false;
  const target = calendarPhase(s, now);
  while (s.phase < target && s.phase < closedPhase(s)) {
    advance(s, now);
    moved = true;
  }
  return moved;
}

/** The server's sweep calls this; it is cheap and does nothing most minutes. */
export function tick(now: number): void {
  for (const s of db().seasons) catchUp(s, now);
}

// ── results ───────────────────────────────────────────────────────────

/** The organizer's verdict on a match: a win either way, unplayed, a double
 * loss — or 'clear' to reopen it (only while its week is still running). */
export function overrideResult(s: Season, matchId: string, outcome: Outcome | 'clear', noteText: string, now: number): Res<{ match: LeagueMatch }> {
  const m = s.matches.find(x => x.id === matchId);
  if (!m) return { ok: false, error: 'no such match' };
  if (outcome === 'clear') {
    if (m.week < s.phase || s.phase >= closedPhase(s)) return { ok: false, error: 'that week is closed — set a result instead' };
    delete m.result;
  } else if (['a', 'b', 'unplayed', 'double-loss'].includes(outcome)) {
    m.result = { outcome, how: 'organizer', at: iso(now), ...(noteText ? { note: noteText.slice(0, 200) } : {}) };
  } else {
    return { ok: false, error: 'unknown outcome' };
  }
  note(s, `${m.id} set to ${outcome} by the organizer${noteText ? `: ${noteText.slice(0, 80)}` : ''}`, now);
  if (m.result && (outcome === 'a' || outcome === 'b')) resultMessages(s, m, now);
  persist(now);
  return { ok: true, match: m };
}

/** A league room reached a result at the table (docs/20 §5). The first decided
 * game settles the match; later ones are ignored. */
export function recordPlayed(matchId: string, winnerUserId: string, code: string, now: number): boolean {
  for (const s of db().seasons) {
    const m = s.matches.find(x => x.id === matchId);
    if (!m) continue;
    if (m.result && m.result.outcome !== 'unplayed') return false;
    if (winnerUserId !== m.a && winnerUserId !== m.b) return false;
    m.result = { outcome: winnerUserId === m.a ? 'a' : 'b', how: 'played', code, at: iso(now) } satisfies MatchResult;
    note(s, `${m.id}: ${nameOf(winnerUserId)} won (${code})`, now);
    resultMessages(s, m, now);
    persist(now);
    return true;
  }
  return false;
}

function resultMessages(s: Season, m: LeagueMatch, now: number): void {
  const out = m.result?.outcome;
  if (out !== 'a' && out !== 'b') return;
  const rows = table(s);
  const winner = out === 'a' ? m.a : m.b, loser = out === 'a' ? m.b : m.a;
  for (const id of [m.a, m.b]) {
    const r = rows.find(x => x.id === id);
    send(s, id, 'result', {
      season: s.name, match: m.id, final: m.final === true, won: id === winner,
      opponent: { id: id === m.a ? m.b : m.a, name: nameOf(id === m.a ? m.b : m.a) },
      record: recordOf(rows, id), rank: r?.rank ?? null, of: rows.length,
      ids: [winner, loser],
    }, now);
  }
}

// ── the outbox, from the bot's side ───────────────────────────────────

/** Rows not yet sent or failed, oldest first. */
export function pendingOutbox(limit = 50): OutboxRow[] {
  return db().outbox.filter(r => !r.sentAt && !r.failed).slice(0, limit);
}

export const outboxRows = (): OutboxRow[] => db().outbox;

/** The bot says it sent these (and could not send those). Idempotent. */
export function ackOutbox(sent: number[], failed: Record<string, string>, now: number): number {
  let n = 0;
  for (const r of db().outbox) {
    if (sent.includes(r.id) && !r.sentAt) { r.sentAt = iso(now); delete r.failed; n++; }
    const why = failed[String(r.id)];
    if (why && !r.sentAt) { r.failed = why.slice(0, 60); n++; }
  }
  if (n) persist(now);
  return n;
}

// ── views ─────────────────────────────────────────────────────────────

/** Everything the League page shows about a season. Availability never
 * leaves this file except as the SHARED windows of your own matches. */
export function seasonView(s: Season, viewer: Account | undefined, opts: { admin: boolean; requireDiscord: boolean }) {
  const rows = table(s);
  const person = (id: string) => ({ id, name: nameOf(id) });
  const mine = viewer ? s.entrants.find(e => e.userId === viewer.id) : undefined;
  const phases = Array.from({ length: closedPhase(s) + 1 }, (_, p) => ({
    phase: p, label: phaseLabel(s, p), at: iso(phaseStart(s, p)),
  }));
  return {
    id: s.id, name: s.name, phase: s.phase, label: phaseLabel(s, s.phase),
    weeks: s.weeks, perWeek: s.perWeek, lateUntil: s.lateUntil,
    signupOpens: s.signupOpens, start: s.start, phases,
    auto: s.auto, hold: s.hold, hidden: s.hidden,
    entrants: s.entrants.map(e => ({
      ...person(e.userId), joinedPhase: e.joinedPhase, withdrawn: !!e.withdrawnAt, skips: e.skips,
    })),
    standings: rows.map(r => ({ ...r, name: nameOf(r.id) })),
    matches: s.matches.map(m => ({
      id: m.id, week: m.week, final: m.final === true, a: person(m.a), b: person(m.b),
      result: m.result ?? null, room: m.room ?? null,
    })),
    champion: s.champion ? person(s.champion) : null,
    me: viewer ? {
      entered: !!mine && !mine.withdrawnAt,
      withdrawn: !!mine?.withdrawnAt,
      skips: mine?.skips ?? [],
      joinProblem: joinProblem(s, viewer, { requireDiscord: opts.requireDiscord }),
      matches: s.matches.filter(m => m.a === viewer.id || m.b === viewer.id).map(m => ({
        id: m.id, week: m.week, final: m.final === true,
        opponent: person(m.a === viewer.id ? m.b : m.a),
        windows: m.windows, result: m.result ?? null,
        won: m.result?.outcome === 'a' ? m.a === viewer.id : m.result?.outcome === 'b' ? m.b === viewer.id : null,
      })),
    } : null,
    ...(opts.admin ? {
      log: s.log.slice(-40),
      outbox: db().outbox.filter(r => r.season === s.id).slice(-60).map(r => ({
        id: r.id, to: r.to ? nameOf(r.to) : '#channel', kind: r.kind, createdAt: r.createdAt,
        sentAt: r.sentAt ?? null, failed: r.failed ?? null,
      })),
    } : {}),
  };
}

/** A week's boundaries, for the page: when it started and when it closes. */
export const weekSpan = (s: Season, k: number): { from: number; to: number } =>
  ({ from: phaseStart(s, k), to: phaseStart(s, k) + WEEK_MS });
