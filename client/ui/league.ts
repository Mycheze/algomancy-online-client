/* THE LEAGUE PAGE (docs/20-league.md).
 *
 * Same contract as ui/meta.ts and ui/account.ts, which main.ts already drives:
 * screen() says whether this page owns the app element, renderScreen() paints
 * it, handleButton() is offered every click (everything here is `lg-`), and
 * the state lives in this file. The URL is the page: `?league` (or
 * `?league=<season id>`), written with replaceState.
 *
 * The markup is pages/league.ts's (the design-system round, 2026-11-03):
 * leagueView() gathers this file's state into a view, leagueHtml() draws it,
 * and so for the home banner and the header button. Since 2026-11-13 the
 * painting and its wiring are that module's too (paintLeague): the
 * AVAILABILITY EDITOR — a week of hours painted by dragging (a mouse) or
 * tapped (a finger), in the player's own time zone, saved as 168
 * characters — and the time code's time box. They write this file's state
 * through HOOKS. This file keeps the state, the fetches and the clicks.
 *
 * The organizer's controls are on the same page, shown when the server says
 * the viewer is an admin — the server refuses them to anybody else either way
 * (api-league.ts), so hiding them is a courtesy, not the gate.
 */
import * as acct from './account.ts';
import {
  FORMATS, GRID_LEN, PRESETS, STAMP_STYLES, browserTz, defaultGrid, discordCode, fromWallValue,
  LEAGUE_SECTIONS, leagueBannerHtml, leagueGlanceHtml, leagueGlanceView, leagueJoinRowsHtml, leagueJoinView,
  leagueNavHtml, leagueView, nextQuarter, paintLeague, presetHours, viewTz as tzOf, when as whenIn,
  type Format, type LeagueHooks, type LeagueSection, type LeagueState, type Preview, type StampStyle,
} from './pages/league.ts';
import type { StatusTone } from './components/status.ts';

export { discordCode, postText, stampPreview, STAMP_STYLES, type StampStyle } from './pages/league.ts';

// ── module state ──────────────────────────────────────────────────────

let $app: HTMLElement | null = null;
let rerenderHost: () => void = () => {};
let open = false;
let want: string | null = null;         // a season id from the URL, or null for "the current one"
let data: LeagueState | null = null;
/** the session token `data` was asked with. Signing up from this page goes
 * through the profile and comes back here, so the page must notice it is now
 * somebody, or it keeps the signed-out answer: no availability grid, and a
 * Join card that still says "sign in" (owner, 2026-10-01). */
let dataFor: string | null | undefined;
let loading = false;
let msg = '';
/** how `msg` reads: a result (ok), a refusal (error) — set only through say() */
let msgTone: StatusTone = 'error';
const say = (text: string, tone: StatusTone): void => { msg = text; msgTone = tone; loadMissed = false; };
/** BL-10 (docs/23-ui-inventory/02 §8.5 item 28, "the league `msg` never clears"):
 * the line is a LOAD that failed, not something the player did — so the next
 * load that works takes it away (a refusal or a result stays: say() resets this) */
let loadMissed = false;
const missed = (text: string): void => { say(text, 'error'); loadMissed = true; };
/** a load worked: a load's own failure line is no longer true */
const loaded = (): void => { if (loadMissed) { msg = ''; loadMissed = false; } };
/** the availability being edited: starts from the saved one, or a sensible default */
let draft: { tz: string; grid: string; contact: string } | null = null;
let dirty = false;
let preview: Preview | null = null;
/** a destructive organizer button pressed once, waiting for the second press */
let arming: string | null = null;
/** the availability grid's keyboard cell (its data-i), kept across repaints:
 * the grid is a roving-tabindex grid, so exactly this cell is tabbable */
let gridFocus: number | null = null;
let busy = false;
/** the match whose "suggest a time" form is open */
let timeOpen: string | null = null;
/** the home banner's copy of the League page's answer (the current season),
 * and the session token it was asked with: a sign-in or out asks again */
let hint: LeagueState | null = null;
let hintFor: string | null | undefined;
/** the server said this viewer organizes leagues — they need the way in even
 * before a season exists, to create one */
let hintOrganizer = false;
/** BL-10 (docs/23-ui-inventory/01 §4 S16, "the league and challenge fetch
 * failures render nothing at all"): the home's ask went unanswered — it threw,
 * or the reply was no league answer — and when. The card then says it could
 * not load the league, not "No league running right now", which was a guess
 * stated as a fact; the next home draw HINT_RETRY_MS on asks again. */
let hintMissedAt: number | null = null;
export const HINT_RETRY_MS = 15_000;
/** the banner's "How it works" list, folded or not: null = the default, which
 * is open for somebody deciding whether to join and folded once they are in —
 * it is most of the banner's height (owner, 2026-10-04). Kept for the visit
 * only, so it is not a stored key. */
let howOpen: boolean | null = null;
/** the Discord time code's instant; null = not chosen yet (the next quarter hour) */
let stampAt: number | null = null;
/** the part of the season showing (the toolbar's tabs); Season each time the page opens */
let section: LeagueSection = 'season';
/** whether the home banner is unfolded — remembered, since a player who is
 * not playing should be able to put it away. The key is spelled at each call
 * site: 267 finds the stored keys there. */
let bannerOpen = ((): boolean => {
  // unfolded it is a page of its own on a phone, so a phone starts it folded
  const fallback = typeof innerWidth !== 'number' || innerWidth >= 700;
  try { const v = localStorage.getItem('algoLeagueBanner'); return v === null ? fallback : v !== '0'; } catch { return fallback; }
})();

export const screen = (): 'league' | null => (open ? 'league' : null);

export function initLeague(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  const url = new URLSearchParams(location.search);
  if (url.has('league')) {
    const v = url.get('league');
    want = v && v !== '1' ? v : null;
    open = true;
    load();
  }
}

/* The home banner's data is asked for the first time the HOME PAGE draws,
 * not at boot: a game or replay link must not make a request it has no use
 * for (320-replay-viewer pins every request a replay page makes, and caught
 * the boot-time version). */
function askHint(): void {
  const tok = acct.token();
  if (hintFor === tok && (hintMissedAt === null || Date.now() - hintMissedAt < HINT_RETRY_MS)) return;
  hintFor = tok;
  const missed = (): void => {
    const was = hintMissedAt !== null;
    hintMissedAt = Date.now();
    // one repaint per flip, none while it stays down
    if (!was && !hint && !hintOrganizer && !open) rerenderHost();
  };
  fetch('/api/league', { headers: acct.authHeaders(false) })
    .then(r => r.json() as Promise<{ ok: boolean } & LeagueState>)
    .then(r => {
      if (!r || !r.ok) { missed(); return; }
      const had = !!hint || hintOrganizer || hintMissedAt !== null;
      hintMissedAt = null;
      hint = r.season ? r : null;
      hintOrganizer = r.organizer === true;
      if ((hint || hintOrganizer || had) && !open) rerenderHost();
    })
    .catch(missed);
}

/** The home's League card could not get an answer and has nothing older to
 * show: it says so (pages/home.ts) rather than that no league is running. */
export function hintUnreachable(): boolean {
  askHint();
  return hintMissedAt !== null && !hint && !hintOrganizer;
}

/** The home header's way in: pages/league.ts leagueNavHtml, from the banner's answer. */
export function navButtonHtml(): string {
  askHint();
  return leagueNavHtml({ season: hint?.season ?? null, organizer: hintOrganizer });
}

const formatOfVal = (v: string | undefined): Format => (FORMATS as readonly (string | undefined)[]).includes(v) ? v as Format : 'draft';

/** The season at a glance on the home page: pages/league.ts leagueBannerHtml. */
export function homeBannerHtml(): string {
  askHint();
  return leagueBannerHtml({ st: hint, open: bannerOpen, howOpen, tz: viewTz() });
}

// ── the new home's League card and Join sheet (docs/24) ──────────────
// From the banner's answer (`hint`), asked for the first time a home draws.

/** a season to show, or the viewer organizes leagues: the home's League button is live */
export function hasLeague(): boolean {
  askHint();
  return !!hint?.season || hintOrganizer;
}

/** The League card's body: pages/league.ts leagueGlanceHtml; '' with no season. */
export function homeGlanceHtml(): string {
  askHint();
  return leagueGlanceHtml(leagueGlanceView(hint, viewTz()));
}

/** your league matches to play now, as rows with Play buttons; '' when none */
export function joinRowsHtml(): string {
  askHint();
  return leagueJoinRowsHtml(leagueJoinView(hint, viewTz()));
}

/** how many of them — part of the home's Join badge */
export function joinCount(): number {
  askHint();
  return leagueJoinView(hint, viewTz()).length;
}

function syncUrl(): void {
  try {
    const url = new URL(location.href);
    url.searchParams.delete('league');
    if (open) url.searchParams.set('league', want ?? '1');
    history.replaceState(null, '', url.toString());
  } catch { /* file:// */ }
}

function load(): void {
  loading = true;
  const tok = acct.token();
  const q = want ? `?season=${encodeURIComponent(want)}` : '';
  fetch(`/api/league${q}`, { headers: acct.authHeaders(false) })
    .then(r => r.json() as Promise<{ ok: boolean } & LeagueState>)
    .then(r => {
      loading = false;
      if (!r.ok) { missed('could not load the league'); paint(); return; }
      loaded();
      if (tok !== dataFor) { dirty = false; preview = null; arming = null; }
      data = r;
      dataFor = tok;
      if (!want) { hint = r.season ? r : null; hintFor = tok; }
      hintOrganizer = r.organizer === true;
      if (!dirty) draft = { ...(r.availability ?? { tz: browserTz(), grid: defaultGrid() }), contact: r.contact ?? '' };
      paint();
    })
    .catch(() => { loading = false; missed('could not reach the server'); paint(); });
}

/** Something changed in the league that this page is showing — the bell
 * heard of it (ui/inbox.ts). Ask again: the page if it is open, the home
 * banner the next time it draws (and now, if it is the screen). */
export function refresh(): void {
  // …but not under a half-picked time: the reload would reset the field.
  // Suggesting or cancelling reloads anyway.
  if (open && !timeOpen) load();
  hintFor = undefined;
  askHint();
}

export function openLeague(season?: string): void {
  open = true; want = season ?? null; msg = ''; preview = null; arming = null; section = 'season';
  syncUrl();
  load();
  paint();
}

function close(): void {
  open = false; preview = null; arming = null;
  syncUrl();
  rerenderHost();
}

async function post(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string } & Record<string, unknown>> {
  busy = true;
  try {
    const r = await fetch(path, { method: 'POST', headers: acct.authHeaders(), body: JSON.stringify(body) });
    if (r.status === 404) return { ok: false, error: 'not allowed' };
    return await r.json() as { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: 'could not reach the server' };
  } finally {
    busy = false;
  }
}

/** The zone to show times in: the one the viewer's availability is written
 * in, else the browser's. */
const viewTz = (): string => tzOf(data, hint);
const when = (iso: string | number): string => whenIn(iso, viewTz());

// ── the page ──────────────────────────────────────────────────────────

/** What pages/league.ts's wiring may do to this module's state. */
const HOOKS: LeagueHooks = {
  draft: () => draft,
  editDraft: patch => { if (draft) { Object.assign(draft, patch); dirty = true; } },
  setGridFocus: i => { gridFocus = i; },
  setStampAt: ms => { stampAt = ms; },
  repaint: () => paint(),
};

function paint(): void {
  if (!$app || !open) return;
  paintLeague($app, leagueView({
    data, hint, loading, msg, msgTone, draft, dirty, busy, arming, gridFocus, timeOpen, preview, stampAt, section,
  }), HOOKS);
}

// ── a Discord time code (pages/league.ts draws it) ────────────────────

const stampMs = (): number => stampAt ?? nextQuarter(Date.now());


/** Copy text: the clipboard where the browser allows it, else select the
 * field it is shown in and copy that (older iOS web apps) — the same two
 * steps the organizer's "Post for Discord" Copy has always taken. */
function copyText(text: string, field: HTMLInputElement | HTMLTextAreaElement | null, done: () => void): void {
  const fallback = (): void => {
    if (!field) return;
    field.select();
    field.setSelectionRange?.(0, field.value.length);
    try { if (document.execCommand('copy')) done(); } catch { /* the text stays selected to copy by hand */ }
  };
  try {
    void navigator.clipboard.writeText(text).then(done, fallback);
  } catch { fallback(); }
}

// ── clicks ────────────────────────────────────────────────────────────

const val = (id: string): string => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
const checked = (id: string): boolean => (document.getElementById(id) as HTMLInputElement | null)?.checked ?? false;

async function act(path: string, body: Record<string, unknown>, done?: string): Promise<void> {
  const r = await post(path, body);
  if (r.ok) say(done ?? '', 'ok'); else say(r.error ?? 'that did not work', 'error');
  arming = null;
  load();
}

/** Open a league match's room and go into it — the Play button here, the
 * home banner's, and the bell's (ui/inbox.ts) all come through this. */
export function playMatch(season: string, match: string): void {
  if (busy) return;   // the first press is still on its way
  const fail = (why: string): void => {
    if (!open) {
      // pressed somewhere with nowhere to say it: the League page lists the
      // same match, so open it and say it there
      openLeague(season && season !== hint?.season?.id ? season : undefined);
    }
    say(why, 'error');
    paint();
  };
  if (!season || !match) { fail('could not find that match: try its Play button here'); return; }
  void post('/api/league/play', { season, match }).then(r => {
    if (!r.ok) { fail(r.error ?? 'could not open the match'); return; }
    // into the game the way the queue goes: a full navigation, room in the query
    const seat = Number(r['seat']);
    // the season's format, as the server says: a constructed league room
    // waits for a deck from each seat (the server's answer, so an old server
    // that never says is a draft)
    // A Competitive match's room is a MATCH room (`cc=1`, as ui/match.ts
    // matchLink): its join brings no deck — game 1 registers in the room,
    // games 2-3 deal from the match (CT-514)
    location.search = `?ws=1&room=${encodeURIComponent(String(r['room']))}`
      + (seat === 0 || seat === 1 ? `&seat=${seat}` : '') + `&mode=${r['mode'] === 'constructed' || r['mode'] === 'competitive' ? 'constructed' : 'draft'}`
      + (r['mode'] === 'competitive' ? '&cc=1' : '');
  });
}

export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('lg-')) return false;
  const s = data?.season ?? null;
  if (b !== 'lg-advance' && b !== 'lg-delete' && b !== 'lg-leave' && b !== 'lg-cancel' && b !== 'lg-skip' && b !== 'lg-repair') arming = null;

  switch (b) {
    case 'lg-open': openLeague(btn.dataset['season'] || undefined); return true;
    case 'lg-how': {
      const me = hint?.season?.me;
      howOpen = !(howOpen ?? !me?.entered);
      rerenderHost();
      return true;
    }
    case 'lg-banner':
      bannerOpen = !bannerOpen;
      try { localStorage.setItem('algoLeagueBanner', bannerOpen ? '1' : '0'); } catch { /* private mode */ }
      rerenderHost();
      return true;
    case 'lg-close': close(); return true;
    // another season: a line about the one on screen is not about it
    case 'lg-season': want = btn.dataset['id'] ?? null; preview = null; msg = ''; syncUrl(); load(); return true;
    // the toolbar's tabs: which part of the season shows (pages/league.ts LEAGUE_SECTIONS)
    case 'lg-section': {
      const v = btn.dataset['v'] as LeagueSection | undefined;
      if (v && (LEAGUE_SECTIONS as readonly string[]).includes(v)) { section = v; paint(); }
      return true;
    }

    case 'lg-grid-preset': {
      const p = PRESETS.find(x => x.id === btn.dataset['preset']);
      if (!draft || !p) return true;
      const g = [...draft.grid];
      const allOn = (q: (typeof PRESETS)[number]): boolean => presetHours(q).every(i => g[i] === '1');
      if (allOn(p)) {
        // off again — but not the hours another quick fill that is on shares
        const kept = new Set(PRESETS.filter(q => q !== p && allOn(q)).flatMap(presetHours));
        for (const i of presetHours(p)) if (!kept.has(i)) g[i] = '0';
      } else {
        for (const i of presetHours(p)) g[i] = '1';
      }
      draft.grid = g.join('');
      dirty = true;
      paint();
      return true;
    }
    case 'lg-grid-clear': if (draft) { draft.grid = '0'.repeat(GRID_LEN); dirty = true; paint(); } return true;
    case 'lg-tz-here': if (draft) { draft.tz = browserTz(); dirty = true; paint(); } return true;
    case 'lg-grid-save':
      if (!draft) return true;
      void post('/api/league/availability', { tz: draft.tz, grid: draft.grid, contact: draft.contact }).then(r => {
        if (r.ok) { dirty = false; say('Saved.', 'ok'); } else say(r.error ?? 'could not save', 'error');
        load();
      });
      return true;

    case 'lg-join': if (s) void act('/api/league/join', { season: s.id }, `You're in ${s.name}.`); return true;
    case 'lg-challenge':
      if (s) void act('/api/league/challenge', { season: s.id, opponent: btn.dataset['id'] ?? '' },
        'Game on: it is in Your matches. Message them on Discord, then both press Play.');
      return true;
    case 'lg-cancel': {
      const match = btn.dataset['match'] ?? '';
      if (arming !== `cancel:${match}`) { arming = `cancel:${match}`; paint(); return true; }
      if (s) void act('/api/league/cancel', { season: s.id, match }, 'Called off.');
      return true;
    }
    case 'lg-time-open': timeOpen = btn.dataset['match'] ?? null; paint(); return true;
    case 'lg-time-close': timeOpen = null; paint(); return true;
    case 'lg-time':
    case 'lg-time-custom': {
      const season = btn.dataset['season'] ?? s?.id ?? '';
      const match = btn.dataset['match'] ?? '';
      const at = b === 'lg-time' ? Number(btn.dataset['at']) : fromWallValue(val('lgt-at'), viewTz());
      if (!Number.isFinite(at)) { say('pick a day and a time first', 'error'); paint(); return true; }
      timeOpen = null;
      void act('/api/league/time', { season, match, at }, `Suggested ${when(at)}. They'll see it in their own time zone.`);
      return true;
    }
    case 'lg-time-accept':
      void act('/api/league/time/accept', { season: btn.dataset['season'] ?? s?.id ?? '', match: btn.dataset['match'] ?? '' },
        'Agreed. You both get a reminder fifteen minutes before.');
      return true;
    case 'lg-play': {
      /* The home banner has a Play button too, and it is drawn from `hint`,
       * not `data`: `data` is only there once the League page has been
       * opened, and then it holds whichever season that page last showed,
       * which need not be the banner's. So each Play button says which
       * season it belongs to, and the fallbacks follow the page it is on. */
      const match = btn.dataset['match'] ?? '';
      const season = btn.dataset['season']
        || (open ? s?.id : hint?.season?.id) || s?.id || hint?.season?.id || '';
      playMatch(season, match);
      return true;
    }
    case 'lg-copy': {
      const el = document.getElementById('lg-post') as HTMLTextAreaElement | null;
      if (!el) return true;
      copyText(el.value, el, () => { say('Copied.', 'ok'); paint(); });
      return true;
    }
    case 'lg-stamp-copy': {
      const st = btn.dataset['style'] as StampStyle;
      if (!STAMP_STYLES.includes(st)) return true;
      const code = discordCode(Math.floor(stampMs() / 1000), st);
      // pin the time: a default of "the next quarter hour" must not move under the copy
      stampAt = stampMs();
      copyText(code, document.getElementById(`lg-stamp-${st}`) as HTMLInputElement | null, () => { say(`Copied ${code}`, 'ok'); paint(); });
      return true;
    }
    case 'lg-leave':
      if (arming !== 'leave') { arming = 'leave'; paint(); return true; }
      if (s) void act('/api/league/leave', { season: s.id }, 'You left the league.');
      return true;
    case 'lg-skip':
      if (btn.dataset['skip'] === '1' && arming !== `skip:${btn.dataset['week']}`) {
        arming = `skip:${btn.dataset['week']}`; paint(); return true;
      }
      if (s) void act('/api/league/skip', { season: s.id, week: Number(btn.dataset['week']), skip: btn.dataset['skip'] === '1' });
      return true;

    // ── organizer ──
    case 'lg-create': {
      const openAt = val('lg-new-open'), startAt = val('lg-new-start');
      void post('/api/league/admin/create', {
        id: val('lg-new-id').trim(), name: val('lg-new-name').trim(),
        signupOpens: openAt ? new Date(openAt).toISOString() : '', start: startAt ? new Date(startAt).toISOString() : '',
        weeks: Number(val('lg-new-weeks')), perWeek: Number(val('lg-new-per')),
        auto: checked('lg-new-auto'), hidden: checked('lg-new-hidden'),
        format: formatOfVal(val('lg-new-format')),
      }).then(r => {
        if (r.ok) say('Season created.', 'ok'); else say(r.error ?? 'could not create it', 'error');
        if (r.ok) want = String(r['id']);
        syncUrl();
        load();
      });
      return true;
    }
    case 'lg-advance':
      if (arming !== 'advance') { arming = 'advance'; paint(); return true; }
      if (s) { preview = null; void act('/api/league/admin/advance', { id: s.id }, 'Moved on.'); }
      return true;
    case 'lg-preview':
      if (s) {
        void post('/api/league/admin/preview', { id: s.id }).then(r => {
          if (r.ok) { preview = r as unknown as Preview; msg = ''; } else say(r.error ?? 'no preview', 'error');
          paint();
        });
      }
      return true;
    case 'lg-set':
      if (s) void act('/api/league/admin/update', { id: s.id, [btn.dataset['key'] ?? '']: btn.dataset['val'] === '1' });
      return true;
    case 'lg-format':
      if (s) void act('/api/league/admin/update', { id: s.id, format: formatOfVal(btn.dataset['val']) });
      return true;
    case 'lg-delete':
      if (arming !== 'delete') { arming = 'delete'; paint(); return true; }
      if (s) { want = null; void act('/api/league/admin/delete', { id: s.id }, 'Deleted.'); }
      return true;
    case 'lg-repair': {
      const put = btn.dataset['put'] ?? '';
      if (arming !== `repair:${put}`) { arming = `repair:${put}`; paint(); return true; }
      if (s) void act('/api/league/admin/repair', { id: s.id, ...(put ? { putBack: put } : {}) },
        'Paired again. Copy the new post below for Discord.');
      return true;
    }
    case 'lg-add':
      if (s) void act('/api/league/admin/add', { id: s.id, name: val('lg-addname').trim() }, 'Added.');
      return true;
    case 'lg-override': {
      const match = btn.dataset['match'] ?? '';
      const outcome = val(`lg-ov-${match}`);
      if (s && outcome) void act('/api/league/admin/result', { id: s.id, match, outcome }, 'Result set.');
      return true;
    }
  }
  return false;
}

export function renderScreen(): void {
  if (data && !loading && dataFor !== acct.token()) load();
  paint();
}
