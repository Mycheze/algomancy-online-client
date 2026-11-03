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
 * and so for the home banner and the header button. This file keeps the
 * state, the fetches, the clicks, and the one thing it owns outright: the
 * AVAILABILITY EDITOR's wiring — a week of hours painted by dragging (a mouse)
 * or tapped (a finger), in the player's own time zone, saved as 168
 * characters.
 *
 * The organizer's controls are on the same page, shown when the server says
 * the viewer is an admin — the server refuses them to anybody else either way
 * (api-league.ts), so hiding them is a courtesy, not the gate.
 */
import * as acct from './account.ts';
import {
  FORMATS, GRID_LEN, PRESETS, SHOW_DAYS, STAMP_STYLES, browserTz, defaultGrid, discordCode, fromWallValue,
  hoursIn, leagueBannerHtml, leagueHtml, leagueNavHtml, leagueView, nextQuarter, presetHours, viewTz as tzOf, when as whenIn,
  type Format, type LeagueState, type Preview, type StampStyle,
} from './pages/league.ts';

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
/** the banner's "How it works" list, folded or not: null = the default, which
 * is open for somebody deciding whether to join and folded once they are in —
 * it is most of the banner's height (owner, 2026-10-04). Kept for the visit
 * only, so it is not a stored key. */
let howOpen: boolean | null = null;
/** the Discord time code's instant; null = not chosen yet (the next quarter hour) */
let stampAt: number | null = null;
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
  if (hintFor === tok) return;
  hintFor = tok;
  fetch('/api/league', { headers: acct.authHeaders(false) })
    .then(r => r.json() as Promise<{ ok: boolean } & LeagueState>)
    .then(r => {
      const had = !!hint || hintOrganizer;
      hint = r.ok && r.season ? r : null;
      hintOrganizer = r.ok && r.organizer === true;
      if ((hint || hintOrganizer || had) && !open) rerenderHost();
    })
    .catch(() => { /* no league, no banner */ });
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
      if (!r.ok) { msg = 'could not load the league'; paint(); return; }
      if (tok !== dataFor) { dirty = false; preview = null; arming = null; }
      data = r;
      dataFor = tok;
      if (!want) { hint = r.season ? r : null; hintFor = tok; }
      hintOrganizer = r.organizer === true;
      if (!dirty) draft = { ...(r.availability ?? { tz: browserTz(), grid: defaultGrid() }), contact: r.contact ?? '' };
      paint();
    })
    .catch(() => { loading = false; msg = 'could not reach the server'; paint(); });
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
  open = true; want = season ?? null; msg = ''; preview = null; arming = null;
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

function paint(): void {
  if (!$app || !open) return;
  $app.classList.remove('board');
  $app.innerHTML = leagueHtml(leagueView({
    data, hint, loading, msg, draft, dirty, busy, arming, gridFocus, timeOpen, preview, stampAt,
  }));
  wireGrid();
  wireStamp();
}

// ── a Discord time code (pages/league.ts draws it) ────────────────────

const stampMs = (): number => stampAt ?? nextQuarter(Date.now());

function wireStamp(): void {
  const el = document.getElementById('lg-stamp-at') as HTMLInputElement | null;
  if (!el) return;
  el.onchange = () => {
    const at = fromWallValue(el.value, viewTz(), 1);
    if (Number.isFinite(at)) { stampAt = at; paint(); }
  };
}

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
// ── the availability grid ─────────────────────────────────────────────

function wireGrid(): void {
  const el = document.getElementById('lg-grid');
  const tz = document.getElementById('lg-tz') as HTMLInputElement | null;
  if (tz) {
    tz.onchange = () => { if (draft && tz.value.trim()) { draft.tz = tz.value.trim(); dirty = true; paint(); } };
  }
  const contact = document.getElementById('lg-contact') as HTMLInputElement | null;
  if (contact) {
    // typing must not repaint (it would steal the caret): flag the Save button by hand
    contact.oninput = () => {
      if (!draft) return;
      draft.contact = contact.value;
      dirty = true;
      const save = document.querySelector('[data-btn="lg-grid-save"]') as HTMLButtonElement | null;
      if (save) { save.disabled = false; save.textContent = 'Save'; }
    };
  }
  if (!el) return;
  /* Owner, 2026-11-02 ("tap cells + arrow keys"), and test/906:
   *  - a MOUSE (or pen) drag paints, as it always did;
   *  - a FINGER scrolls the page (style.css: touch-action manipulation, and no
   *    preventDefault for touch), and a TAP toggles one cell — the click that
   *    follows a tap, which the browser does not send after a scroll;
   *  - the KEYBOARD: one cell is tabbable (roving tabindex, `gridFocus`), the
   *    arrows move it, Space or Enter toggles it.
   * Before, `touch-action: none` meant a thumb landing on the grid (taller than
   * a phone's screen) could not scroll past it and painted cells instead, and
   * nothing in the grid could be reached by Tab at all. */
  let painting: '0' | '1' | null = null;
  let lastPointer = '';
  /** the last cell a drag painted — a fast stroke skips cells between
   * pointermove samples, so the gap is filled in (`line`) */
  let from: HTMLElement | null = null;
  const cellAt = (c: number, h: number): HTMLElement | null =>
    el.querySelector(`.lgcell[data-c="${c}"][data-h="${h}"]`);
  const put = (cell: HTMLElement, v: '0' | '1'): void => {
    if (!draft || cell.dataset['i'] === undefined) return;
    const i = Number(cell.dataset['i']);
    if (draft.grid[i] === v) return;
    draft.grid = draft.grid.slice(0, i) + v + draft.grid.slice(i + 1);
    cell.classList.toggle('on', v === '1');
    cell.setAttribute('aria-selected', String(v === '1'));
    dirty = true;
    const n = hoursIn(draft.grid);
    const out = document.getElementById('lg-hours');
    if (out) { out.textContent = `${n} hours a week`; out.classList.toggle('lgwarn', n < (data?.minHours ?? 6)); }
    const save = document.querySelector('[data-btn="lg-grid-save"]') as HTMLButtonElement | null;
    if (save) { save.disabled = false; save.textContent = 'Save'; }
  };
  const toggle = (cell: HTMLElement): void => {
    if (draft) put(cell, draft.grid[Number(cell.dataset['i'])] === '1' ? '0' : '1');
  };
  /** every cell from `a` to `b` inclusive, stepping one cell at a time */
  const line = (a: HTMLElement, b: HTMLElement): HTMLElement[] => {
    const [c0, h0, c1, h1] = [a.dataset['c'], a.dataset['h'], b.dataset['c'], b.dataset['h']].map(Number) as [number, number, number, number];
    const n = Math.max(Math.abs(c1 - c0), Math.abs(h1 - h0));
    const out: HTMLElement[] = [];
    for (let k = 1; k <= n; k++) {
      const cell = cellAt(Math.round(c0 + (c1 - c0) * k / n), Math.round(h0 + (h1 - h0) * k / n));
      if (cell) out.push(cell);
    }
    return out;
  };
  /** make `cell` the grid's one tabbable cell */
  const rove = (cell: HTMLElement): void => {
    for (const other of el.querySelectorAll<HTMLElement>('.lgcell[tabindex="0"]')) other.tabIndex = -1;
    cell.tabIndex = 0;
    gridFocus = Number(cell.dataset['i']);
  };
  el.onpointerdown = e => {
    lastPointer = e.pointerType;
    if (e.pointerType === 'touch') return;   // a finger scrolls; its tap is the click below
    const cell = (e.target as HTMLElement).closest('.lgcell') as HTMLElement | null;
    if (!cell || !draft) return;
    e.preventDefault();
    painting = draft.grid[Number(cell.dataset['i'])] === '1' ? '0' : '1';
    el.setPointerCapture?.(e.pointerId);
    from = cell;
    put(cell, painting);
    rove(cell);
  };
  // pointer capture sends every move here; find the cell under the pointer,
  // and paint the whole way from the last one
  el.onpointermove = e => {
    if (!painting) return;
    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.lgcell') as HTMLElement | null;
    if (!cell || !el.contains(cell) || cell === from) return;
    for (const c of from ? line(from, cell) : [cell]) put(c, painting);
    from = cell;
  };
  el.onpointerup = el.onpointercancel = () => { painting = null; from = null; };
  el.onclick = e => {
    if (lastPointer !== 'touch') return;   // a mouse drag has painted already
    const cell = (e.target as HTMLElement).closest('.lgcell') as HTMLElement | null;
    if (cell) { toggle(cell); rove(cell); }
  };
  el.onkeydown = e => {
    const cell = (e.target as HTMLElement).closest?.('.lgcell') as HTMLElement | null;
    if (!cell) return;
    const c = Number(cell.dataset['c']), h = Number(cell.dataset['h']);
    const move: Record<string, [number, number]> = {
      ArrowLeft: [c - 1, h], ArrowRight: [c + 1, h], ArrowUp: [c, h - 1], ArrowDown: [c, h + 1],
      Home: [0, h], End: [SHOW_DAYS.length - 1, h],
    };
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(cell); return; }
    const to = move[e.key];
    if (!to) return;
    e.preventDefault();
    const next = cellAt(to[0], to[1]);
    if (next) { rove(next); next.focus(); }
  };
}

// ── clicks ────────────────────────────────────────────────────────────

const val = (id: string): string => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
const checked = (id: string): boolean => (document.getElementById(id) as HTMLInputElement | null)?.checked ?? false;

async function act(path: string, body: Record<string, unknown>, done?: string): Promise<void> {
  const r = await post(path, body);
  msg = r.ok ? (done ?? '') : (r.error ?? 'that did not work');
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
    msg = why;
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
    case 'lg-season': want = btn.dataset['id'] ?? null; preview = null; syncUrl(); load(); return true;

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
        if (r.ok) { dirty = false; msg = 'Saved.'; } else msg = r.error ?? 'could not save';
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
      if (!Number.isFinite(at)) { msg = 'pick a day and a time first'; paint(); return true; }
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
      copyText(el.value, el, () => { msg = 'Copied.'; paint(); });
      return true;
    }
    case 'lg-stamp-copy': {
      const st = btn.dataset['style'] as StampStyle;
      if (!STAMP_STYLES.includes(st)) return true;
      const code = discordCode(Math.floor(stampMs() / 1000), st);
      // pin the time: a default of "the next quarter hour" must not move under the copy
      stampAt = stampMs();
      copyText(code, document.getElementById(`lg-stamp-${st}`) as HTMLInputElement | null, () => { msg = `Copied ${code}`; paint(); });
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
        msg = r.ok ? 'Season created.' : (r.error ?? 'could not create it');
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
          if (r.ok) { preview = r as unknown as Preview; msg = ''; } else msg = r.error ?? 'no preview';
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
