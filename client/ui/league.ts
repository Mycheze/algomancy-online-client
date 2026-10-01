/* THE LEAGUE PAGE (docs/20-league.md).
 *
 * Same contract as ui/meta.ts and ui/account.ts, which main.ts already drives:
 * screen() says whether this page owns the app element, renderScreen() paints
 * it, handleButton() is offered every click (everything here is `lg-`), and
 * the state lives in this file. The URL is the page: `?league` (or
 * `?league=<season id>`), written with replaceState.
 *
 * Everything shown is the server's answer (server/league-store.ts
 * seasonView); nothing here re-derives a standing or a pairing. The one thing
 * this file owns is the AVAILABILITY EDITOR: a week of hours painted by
 * dragging, in the player's own time zone, saved as 168 characters.
 *
 * The organizer's controls are on the same page, shown when the server says
 * the viewer is an admin — the server refuses them to anybody else either way
 * (api-league.ts), so hiding them is a courtesy, not the gate.
 */
import * as acct from './account.ts';
import { esc } from './util.ts';

const GRID_LEN = 168;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Win { start: number; hours: number }
interface Person { id: string; name: string }
interface Result { outcome: 'a' | 'b' | 'unplayed' | 'double-loss'; how: string; code?: string; at: string; note?: string }
interface SeasonView {
  id: string; name: string; phase: number; label: string; weeks: number; perWeek: number; lateUntil: number;
  signupOpens: string; start: string; phases: { phase: number; label: string; at: string }[];
  auto: boolean; hold: boolean; hidden: boolean;
  entrants: (Person & { joinedPhase: number; withdrawn: boolean; skips: number[] })[];
  standings: { id: string; name: string; w: number; l: number; unplayed: number; points: number; omw: number; rank: number }[];
  matches: { id: string; week: number; final: boolean; a: Person; b: Person; result: Result | null; room: string | null }[];
  champion: Person | null;
  me: null | {
    entered: boolean; withdrawn: boolean; skips: number[]; joinProblem: string | null;
    matches: { id: string; week: number; final: boolean; opponent: Person; windows: Win[]; result: Result | null; won: boolean | null }[];
  };
  log?: { at: string; what: string }[];
  outbox?: { id: number; to: string; kind: string; createdAt: string; sentAt: string | null; failed: string | null }[];
}
interface LeagueState {
  season: SeasonView | null;
  seasons: { id: string; name: string; phase: number; weeks: number; hidden: boolean }[];
  signedIn: boolean;
  availability: { tz: string; grid: string } | null;
  discordLinked: boolean;
  requireDiscord: boolean;
  minHours: number;
  organizer: boolean;
}
interface Preview { week: number; short: string | null; total: number; edges: { a: string; b: string; score: number; cost: number; windows: Win[] }[] }

// ── module state ──────────────────────────────────────────────────────

let $app: HTMLElement | null = null;
let rerenderHost: () => void = () => {};
let open = false;
let want: string | null = null;         // a season id from the URL, or null for "the current one"
let data: LeagueState | null = null;
let loading = false;
let msg = '';
/** the availability being edited: starts from the saved one, or a sensible default */
let draft: { tz: string; grid: string } | null = null;
let dirty = false;
let preview: Preview | null = null;
/** a destructive organizer button pressed once, waiting for the second press */
let arming: string | null = null;
let busy = false;
/** the home banner's copy of the League page's answer (the current season),
 * and the session token it was asked with: a sign-in or out asks again */
let hint: LeagueState | null = null;
let hintFor: string | null | undefined;
/** whether the home banner is unfolded — remembered, since a player who is
 * not playing should be able to put it away. The key is spelled at each call
 * site: 267 finds the stored keys there. */
let bannerOpen = ((): boolean => {
  // unfolded it is a page of its own on a phone, so a phone starts it folded
  const fallback = typeof innerWidth !== 'number' || innerWidth >= 700;
  try { const v = localStorage.getItem('algoLeagueBanner'); return v === null ? fallback : v !== '0'; } catch { return fallback; }
})();

const browserTz = (): string => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};

function defaultGrid(): string {
  const g = new Array<string>(GRID_LEN).fill('0');
  for (let d = 0; d < 5; d++) for (let h = 19; h < 23; h++) g[d * 24 + h] = '1';
  return g.join('');
}

const hoursIn = (grid: string): number => [...grid].filter(c => c === '1').length;

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
      const had = !!hint;
      hint = r.ok && r.season ? r : null;
      if ((hint || had) && !open) rerenderHost();
    })
    .catch(() => { /* no league, no banner */ });
}

// ── the home banner ───────────────────────────────────────────────────
//
// The season at a glance, on the home page while one is visible: the dates,
// how it works, how to join (ticked off for the viewer), and who is in — the
// sign-ups before week 1, then the standings and the week's pairings. Folded,
// it is one line. Everything here is the server's answer, as on the page.

/** a season still taking entrants: sign-ups, then late entry until `lateUntil` */
const joinable = (s: SeasonView): boolean => s.phase >= 0 && s.phase < s.lateUntil;
const day = (iso: string, less = 0): string => fmt(Date.parse(iso) - less, { weekday: 'short', day: 'numeric', month: 'short' });
/** A season closes at 00:00 UTC on the Monday AFTER its final's last day, so
 * name that Sunday. Twelve hours back, not one millisecond: east of UTC the
 * close falls in the small hours of Monday, and "ends Monday" read wrong. */
const lastDay = (iso: string): string => day(iso, 12 * 3_600_000);
const BANNER_ROWS = 8;

export function homeBannerHtml(): string {
  askHint();
  const st = hint;
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
      <span class="lgbphase">${esc(s.label)}</span>
      ${me?.entered ? `<span class="lgbin">✓ you're in</span>` : ''}
      <span class="lgbnext">${esc(nextText(s))}</span>
      ${cta}
    </div>
    ${bannerOpen ? `<ol class="lgbdates">${s.phases.map(p => `<li class="${
      p.phase === s.phase ? 'now' : p.phase < s.phase ? 'past' : ''}"><span>${
      esc(p.phase === 0 ? 'Sign-ups' : p.phase === s.weeks + 2 ? 'Ends' : p.label.replace(/ of \d+$/, ''))
    }</span> ${esc(p.phase === s.weeks + 2 ? lastDay(p.at) : day(p.at))}</li>`).join('')}</ol>
    <div class="lgbbody">
      <div><h3>How it works</h3>${howHtml(s)}</div>
      <div>${s.champion ? `<h3>Champion</h3><p class="lgbchamp">🏆 <b>${esc(s.champion.name)}</b></p>`
        : me?.entered && s.phase > 0 ? mineHtml(s) : joinStepsHtml(st, s)}</div>
      ${tableHtml(s)}
    </div>` : ''}
  </section>`;
}

/** the one date that matters next, for the folded line */
function nextText(s: SeasonView): string {
  if (s.champion) return `Champion: ${s.champion.name}`;
  const next = s.phases.find(p => p.phase === s.phase + 1);
  if (s.phase < 0) return `Sign-ups open ${day(s.signupOpens)}`;
  if (!next) return '';
  if (s.phase === 0) return `Week 1 starts ${day(next.at)}`;
  if (s.phase === s.weeks) return `The final starts ${day(next.at)}`;
  if (s.phase > s.weeks) return `Ends ${lastDay(next.at)}`;
  return `Week ${s.phase + 1} starts ${day(next.at)}`;
}

function howHtml(s: SeasonView): string {
  return `<ul class="lgbhow">
    <li>Each week you get ${s.perWeek} opponents, matched on the hours you are both free.</li>
    <li>Every match is one live draft with random elements and a random first player.</li>
    <li>Your pairings arrive as a Discord message. Agree a time and play on this site.</li>
    <li>A win is 3 points. A match nobody plays counts for neither player.</li>
    <li>After week ${s.weeks}, the top two play one game for the title.</li>
  </ul>`;
}

/** how to join, each step ticked once the viewer has done it */
function joinStepsHtml(st: LeagueState, s: SeasonView): string {
  if (s.phase >= 0 && !joinable(s)) {
    return `<h3>How to join</h3><p class="dim">Sign-ups for this season have closed. The next one will be announced on Discord.</p>`;
  }
  const grid = st.availability?.grid ?? '';
  const steps: [boolean, string][] = [
    [st.signedIn, st.signedIn ? 'Signed in' : '<button class="linkbtn" data-btn="acct-open-auth">Sign in or make an account</button>'],
    ...(st.requireDiscord ? [[st.discordLinked, st.discordLinked ? 'Discord linked'
      : st.signedIn ? '<button class="linkbtn" data-btn="acct-open-profile">Link your Discord</button> on your profile' : 'Link your Discord']] as [boolean, string][] : []),
    [hoursIn(grid) >= st.minHours, 'Mark when you are usually free'],
    [!!s.me?.entered, s.me?.entered ? 'Joined' : s.phase < 0 ? `Join from ${day(s.signupOpens)}` : 'Join on the League page'],
  ];
  return `<h3>How to join</h3><ol class="lgbsteps">${steps.map(([done, what]) =>
    `<li class="${done ? 'done' : ''}"><span class="lgbtick">${done ? '✓' : ''}</span>${what}</li>`).join('')}</ol>
    ${s.phase === 0 && s.lateUntil > 1 ? '<p class="dim">Late entries are open until week 2.</p>' : ''}`;
}

/** an entrant's own matches this week (or the final) */
function mineHtml(s: SeasonView): string {
  const me = s.me;
  const now = me?.matches.filter(m => m.week === s.phase) ?? [];
  if (!me || !now.length) return `<h3>Your matches</h3><p class="dim">${
    me?.skips.includes(s.phase) ? 'You are sitting this week out.' : 'None this week.'}</p>`;
  return `<h3>${s.phase > s.weeks ? 'Your final' : 'Your matches this week'}</h3>
    <ul class="lgbrows">${now.map(m => `<li><span>vs <b>${esc(m.opponent.name)}</b></span><span>${
      m.result ? (m.won === true ? '✅ won' : m.won === false ? 'lost' : '<span class="dim">not played</span>') : '<span class="dim">to play</span>'
    }</span></li>`).join('')}</ul>`;
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
  return `<span>${esc(m.a.name)} <span class="dim">vs</span> ${esc(m.b.name)}</span><span class="dim">${
    !r ? 'to play' : r.outcome === 'unplayed' ? 'not played' : 'double loss'}</span>`;
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
  const q = want ? `?season=${encodeURIComponent(want)}` : '';
  fetch(`/api/league${q}`, { headers: acct.authHeaders(false) })
    .then(r => r.json() as Promise<{ ok: boolean } & LeagueState>)
    .then(r => {
      loading = false;
      if (!r.ok) { msg = 'could not load the league'; paint(); return; }
      data = r;
      if (!want) { hint = r.season ? r : null; hintFor = acct.token(); }
      if (!dirty) draft = r.availability ? { ...r.availability } : { tz: browserTz(), grid: defaultGrid() };
      paint();
    })
    .catch(() => { loading = false; msg = 'could not reach the server'; paint(); });
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

// ── formatting ────────────────────────────────────────────────────────

/** The zone to show times in: the one the viewer's availability is written
 * in, else the browser's. */
const viewTz = (): string => (data ?? hint)?.availability?.tz ?? browserTz();

function fmt(ms: number, opts: Intl.DateTimeFormatOptions): string {
  try { return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: viewTz() }).format(ms); }
  catch { return new Date(ms).toUTCString(); }
}
const when = (iso: string | number): string =>
  fmt(typeof iso === 'number' ? iso : Date.parse(iso), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function windowText(w: Win): string {
  const end = w.start + w.hours * 3_600_000;
  return `${fmt(w.start, { weekday: 'short', day: 'numeric', month: 'short' })}, ${
    fmt(w.start, { hour: 'numeric', minute: '2-digit' })}–${fmt(end, { hour: 'numeric', minute: '2-digit' })}`;
}

function resultText(m: { a: Person; b: Person; result: Result | null }): string {
  const r = m.result;
  if (!r) return '<span class="dim">to play</span>';
  if (r.outcome === 'unplayed') return '<span class="dim">not played</span>';
  if (r.outcome === 'double-loss') return '<span class="dim">double loss</span>';
  const w = r.outcome === 'a' ? m.a : m.b;
  return `<b>${esc(w.name)}</b> won${r.how === 'organizer' ? ' <span class="dim">(organizer)</span>' : ''}`;
}

// ── the page ──────────────────────────────────────────────────────────

function paint(): void {
  if (!$app || !open) return;
  $app.classList.remove('board');
  const s = data?.season ?? null;
  $app.innerHTML = `<div class="metapage lgpage">
    <div class="accthead">
      <div><h1>🏅 League</h1>
        <p class="hint">A month of live drafts: three opponents a week, matched on when you can play, then a final.</p></div>
      <div class="accthbtns"><button data-btn="lg-close">Back</button></div>
    </div>
    ${msg ? `<div class="acctmsg">${esc(msg)}</div>` : ''}
    ${data && data.seasons.length > 1 ? `<div class="cbtools">${data.seasons.map(x =>
      `<button class="${s?.id === x.id ? 'on' : ''}" data-btn="lg-season" data-id="${esc(x.id)}">${esc(x.name)}${x.hidden ? ' 🔒' : ''}</button>`).join('')}</div>` : ''}
    ${loading && !data ? '<p class="dim">Loading…</p>' : ''}
    <div class="acctbody">
      ${data && !s ? `<div class="acctcard wide"><h3>No season yet</h3><p>There is no league season running right now. Watch the Discord for the next one.</p></div>` : ''}
      ${s ? seasonCardHtml(s) : ''}
      ${s ? entryCardHtml(s) : ''}
      ${data?.signedIn ? availabilityCardHtml() : ''}
      ${s?.me?.matches.length ? myMatchesHtml(s) : ''}
      ${s && s.standings.length ? standingsHtml(s) : ''}
      ${s && s.matches.length ? allMatchesHtml(s) : ''}
      ${data?.organizer ? organizerHtml(s) : ''}
    </div>
  </div>`;
  wireGrid();
}

function seasonCardHtml(s: SeasonView): string {
  const wk1 = s.phases.find(p => p.phase === 1);
  const fin = s.phases.find(p => p.phase === s.weeks + 1);
  const end = s.phases.find(p => p.phase === s.weeks + 2);
  const active = s.entrants.filter(e => !e.withdrawn).length;
  return `<div class="acctcard wide">
    <h3>${esc(s.name)} ${s.hidden ? '<span class="lgtag">hidden</span>' : ''}${s.hold ? '<span class="lgtag">on hold</span>' : ''}</h3>
    <div class="statgrid">
      <div class="statcell"><div class="statval lgphase">${esc(s.label)}</div><div class="statlab">now</div></div>
      <div class="statcell"><div class="statval">${active}</div><div class="statlab">players</div></div>
      <div class="statcell"><div class="statval">${s.perWeek}</div><div class="statlab">opponents a week</div></div>
      <div class="statcell"><div class="statval">${s.weeks}</div><div class="statlab">weeks + a final</div></div>
    </div>
    <p>${s.phase < 0 ? `Sign-ups open <b>${when(s.signupOpens)}</b>. ` : ''}Week 1 starts <b>${wk1 ? when(wk1.at) : '?'}</b>,
      the final <b>${fin ? when(fin.at) : '?'}</b>, and the season ends <b>${end ? when(end.at) : '?'}</b>
      <span class="dim">(your time)</span>.</p>
    ${s.champion ? `<p>🏆 Champion: <b>${esc(s.champion.name)}</b></p>` : ''}
    <p class="hint">Every match is one live draft with random elements and a random first player. Pairings and
      reminders come as Discord messages from the Algomancy bot, with a link straight into your match.
      A match nobody plays by the end of its week counts for neither player.</p>
  </div>`;
}

function entryCardHtml(s: SeasonView): string {
  if (!data?.signedIn) {
    return `<div class="acctcard"><h3>Join</h3><p>Sign in to join the league.</p>
      <button class="primary" data-btn="acct-open-auth">Log in / Sign up</button></div>`;
  }
  const me = s.me!;
  if (me.entered) {
    const future = Array.from({ length: s.weeks }, (_, i) => i + 1).filter(k => k > s.phase);
    return `<div class="acctcard"><h3>You're in</h3>
      ${future.length ? `<p>Can't play a week? Sit it out before its pairings go out, and nobody is left waiting for you.</p>
        <div class="lgskips">${future.map(k => {
          const on = me.skips.includes(k);
          return `<button class="${on ? 'on' : ''}" data-btn="lg-skip" data-week="${k}" data-skip="${on ? '0' : '1'}"
            title="${on ? 'you are sitting this week out — press to play it' : 'sit this week out'}">Week ${k}: ${on ? 'sitting out' : 'playing'}</button>`;
        }).join('')}</div>` : ''}
      ${s.phase < s.weeks + 2 ? `<p><button data-btn="lg-leave" class="${arming === 'leave' ? 'danger' : ''}">${
        arming === 'leave' ? 'Press again to leave the league' : 'Leave the league'}</button></p>` : ''}
    </div>`;
  }
  const problem = me.joinProblem;
  const needsLink = !!problem && /Discord/.test(problem);
  return `<div class="acctcard"><h3>Join</h3>
    ${problem
      ? `<p>${esc(problem[0]!.toUpperCase() + problem.slice(1))}.</p>
         ${needsLink ? '<p><button data-btn="acct-open-profile">Link Discord on your profile</button></p>' : ''}`
      : '<p>You are all set: press the button and your first pairings arrive when the week starts.</p>'}
    <button class="primary" data-btn="lg-join" ${problem || busy ? 'disabled' : ''}>Join ${esc(s.name)}</button>
    ${me.withdrawn ? '<p class="hint">You left this season; joining again keeps the results you already played.</p>' : ''}
  </div>`;
}

function availabilityCardHtml(): string {
  const d = draft ?? { tz: browserTz(), grid: defaultGrid() };
  const zones = supportedZones();
  const hrs = hoursIn(d.grid);
  const min = data?.minHours ?? 6;
  return `<div class="acctcard wide"><h3>When you're usually free</h3>
    <p>Paint the hours of a normal week when you could play — drag across the grid. Opponents are matched on
      the hours you share, so the more you mark, the better your matches.</p>
    <div class="lgtzrow"><label>Time zone <input id="lg-tz" list="lg-tzlist" value="${esc(d.tz)}" spellcheck="false"></label>
      <datalist id="lg-tzlist">${zones.map(z => `<option value="${esc(z)}">`).join('')}</datalist>
      <button data-btn="lg-tz-here" title="use this device's time zone">use ${esc(browserTz())}</button></div>
    <div class="lggrid" id="lg-grid">
      <div></div>${Array.from({ length: 24 }, (_, h) => `<div class="lghr">${h % 3 === 0 ? hourLabel(h) : ''}</div>`).join('')}
      ${DAY_NAMES.map((dn, day) => `<div class="lgday">${dn}</div>${Array.from({ length: 24 }, (_, h) => {
        const i = day * 24 + h;
        return `<div class="lgcell${d.grid[i] === '1' ? ' on' : ''}" data-i="${i}" title="${dn} ${hourLabel(h)}"></div>`;
      }).join('')}`).join('')}
    </div>
    <p><span id="lg-hours" class="${hrs < min ? 'lgwarn' : ''}">${hrs} hours a week</span>${hrs < min ? ` — mark at least ${min} to join` : ''}.
      <button data-btn="lg-grid-preset">Weeknights 7–11pm</button>
      <button data-btn="lg-grid-clear">Clear</button>
      <button class="primary" data-btn="lg-grid-save" ${dirty && !busy ? '' : 'disabled'}>${dirty ? 'Save' : 'Saved'}</button></p>
  </div>`;
}

function hourLabel(h: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' }).format(Date.UTC(2026, 0, 5, h));
  } catch { return `${h}:00`; }
}

function supportedZones(): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (f) return f('timeZone');
  } catch { /* old browser */ }
  return [browserTz(), 'UTC'];
}

function myMatchesHtml(s: SeasonView): string {
  const me = s.me!;
  const weeks = [...new Set(me.matches.map(m => m.week))].sort((a, b) => b - a);
  return `<div class="acctcard wide"><h3>Your matches</h3>
    ${weeks.map(k => `<h4>${k > s.weeks ? 'The final' : `Week ${k}`}</h4>
      <table class="accttable lgmatches"><tbody>${me.matches.filter(m => m.week === k).map(m => `<tr>
        <td>vs <b>${esc(m.opponent.name)}</b></td>
        <td>${m.result
          ? (m.won === true ? '✅ you won' : m.won === false ? 'you lost'
            : m.result.outcome === 'double-loss' ? 'double loss' : '<span class="dim">not played</span>')
          : m.windows.length
            ? `<span class="dim">you're both free:</span> ${m.windows.slice(0, 4).map(windowText).map(esc).join(' · ')}`
            : '<span class="dim">no shared hours — arrange a time on Discord</span>'}</td>
      </tr>`).join('')}</tbody></table>`).join('')}
    <p class="hint">Times are in ${esc(viewTz())}.</p>
  </div>`;
}

function standingsHtml(s: SeasonView): string {
  const withdrawn = new Set(s.entrants.filter(e => e.withdrawn).map(e => e.id));
  return `<div class="acctcard"><h3>Standings</h3>
    <table class="accttable"><thead><tr><th>#</th><th>player</th><th>W–L</th><th>pts</th><th title="opponents' match-win percentage — the tiebreak">OMW</th></tr></thead>
    <tbody>${s.standings.map(r => `<tr class="${withdrawn.has(r.id) ? 'dim' : ''}">
      <td>${r.rank}</td><td>${esc(r.name)}${s.champion?.id === r.id ? ' 🏆' : ''}</td>
      <td>${r.w}–${r.l}${r.unplayed ? ` <span class="dim" title="matches not played">(${r.unplayed})</span>` : ''}</td>
      <td>${r.points}</td><td>${r.w + r.l + r.unplayed ? `${Math.round(r.omw * 100)}%` : '–'}</td></tr>`).join('')}</tbody></table>
    <p class="hint">3 points a win. Ties go to opponents' match-win percentage, then head to head.</p>
  </div>`;
}

function allMatchesHtml(s: SeasonView): string {
  const weeks = [...new Set(s.matches.map(m => m.week))].sort((a, b) => b - a);
  const org = data?.organizer === true;
  // the organizer's result controls need the width; a player's view sits beside the table
  return `<div class="acctcard${org ? ' wide' : ''}"><h3>Matches</h3>
    ${weeks.map(k => `<h4>${k > s.weeks ? 'The final' : `Week ${k}`}</h4>
      <table class="accttable"><tbody>${s.matches.filter(m => m.week === k).map(m => `<tr>
        <td>${esc(m.a.name)} vs ${esc(m.b.name)}</td><td>${resultText(m)}</td>
        ${org ? `<td class="lgorg"><select id="lg-ov-${esc(m.id)}">
          <option value="">set…</option><option value="a">${esc(m.a.name)} won</option><option value="b">${esc(m.b.name)} won</option>
          <option value="unplayed">not played</option><option value="double-loss">double loss</option><option value="clear">reopen</option>
        </select><button data-btn="lg-override" data-match="${esc(m.id)}">set</button></td>` : ''}
      </tr>`).join('')}</tbody></table>`).join('')}
  </div>`;
}

// ── the organizer ─────────────────────────────────────────────────────

function nextMondayUtc(from: number): string {
  const d = new Date(from);
  const add = ((8 - d.getUTCDay()) % 7) || 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add)).toISOString();
}
/** an ISO instant as a datetime-local value, in this browser's zone */
function localInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function organizerHtml(s: SeasonView | null): string {
  const now = Date.now();
  const start = nextMondayUtc(now + 6 * 86_400_000);
  const next = s ? s.phases.find(p => p.phase === s.phase + 1) : null;
  return `<div class="acctcard wide lgorgcard"><h3>Organizer</h3>
    ${s ? `
      <p>${esc(s.name)} is at <b>${esc(s.label)}</b>. ${s.auto
        ? `It moves on by itself${s.hold ? ' — <b>but it is on hold</b>' : ''}${next ? `: next is <b>${esc(next.label)}</b> at ${when(next.at)}` : ''}.`
        : 'It moves on only when you press Advance.'}</p>
      <p>
        ${next ? `<button class="${arming === 'advance' ? 'danger' : 'primary'}" data-btn="lg-advance">${
          arming === 'advance' ? `Press again: move to ${esc(next.label)} now` : `Advance to ${esc(next.label)}`}</button>` : ''}
        ${s.phase < s.weeks ? '<button data-btn="lg-preview">Preview next pairings</button>' : ''}
        <button data-btn="lg-set" data-key="hold" data-val="${s.hold ? '0' : '1'}">${s.hold ? 'Release hold' : 'Hold at next boundary'}</button>
        <button data-btn="lg-set" data-key="auto" data-val="${s.auto ? '0' : '1'}">${s.auto ? 'Switch to manual' : 'Switch to automatic'}</button>
        <button data-btn="lg-set" data-key="hidden" data-val="${s.hidden ? '0' : '1'}">${s.hidden ? 'Make public' : 'Hide'}</button>
        ${s.hidden ? `<button class="${arming === 'delete' ? 'danger' : ''}" data-btn="lg-delete">${arming === 'delete' ? 'Press again to delete this test season' : 'Delete'}</button>` : ''}
      </p>
      <p><input id="lg-addname" placeholder="player name" spellcheck="false"> <button data-btn="lg-add">Add player</button>
        <span class="dim">(skips the Discord and late-entry checks)</span></p>
      ${preview ? previewHtml(preview) : ''}
      ${s.outbox?.length ? `<h4>Discord messages</h4><table class="accttable lgout"><tbody>${s.outbox.slice().reverse().slice(0, 25).map(r => `<tr>
        <td>${esc(r.kind)}</td><td>${esc(r.to)}</td><td class="dim">${when(r.createdAt)}</td>
        <td>${r.failed ? `⚠ ${esc(r.failed)}` : r.sentAt ? '✓ sent' : '<span class="dim">waiting</span>'}</td></tr>`).join('')}</tbody></table>` : ''}
      ${s.log?.length ? `<details><summary>Log</summary><ul class="lglog">${s.log.slice().reverse().map(l =>
        `<li><span class="dim">${when(l.at)}</span> ${esc(l.what)}</li>`).join('')}</ul></details>` : ''}
    ` : ''}
    <details ${s ? '' : 'open'}><summary>New season</summary>
      <div class="lgform">
        <label>Id <input id="lg-new-id" value="${esc(new Date(start).toISOString().slice(0, 7))}" spellcheck="false"></label>
        <label>Name <input id="lg-new-name" value="${esc(fmt(Date.parse(start), { month: 'long', year: 'numeric' }))}"></label>
        <label>Sign-ups open <input id="lg-new-open" type="datetime-local" value="${localInput(new Date(now).toISOString())}"></label>
        <label>Week 1 starts <input id="lg-new-start" type="datetime-local" value="${localInput(start)}"></label>
        <label>Weeks <input id="lg-new-weeks" type="number" min="1" max="8" value="3"></label>
        <label>Opponents a week <input id="lg-new-per" type="number" min="1" max="6" value="3"></label>
        <label><input id="lg-new-auto" type="checkbox" checked> automatic (follows the calendar)</label>
        <label><input id="lg-new-hidden" type="checkbox"> hidden (a test season)</label>
      </div>
      <p class="hint">Week boundaries are a whole week apart from week 1's start. Monday 00:00 UTC is the default.</p>
      <button class="primary" data-btn="lg-create">Create season</button>
    </details>
  </div>`;
}

function previewHtml(p: Preview): string {
  return `<h4>Week ${p.week} would be</h4>
    <table class="accttable"><tbody>${p.edges.map(e => `<tr class="${e.score < 2 ? 'lgweak' : ''}">
      <td>${esc(e.a)} vs ${esc(e.b)}</td><td>${e.score} day${e.score === 1 ? '' : 's'} shared</td>
      <td class="dim">${e.windows.slice(0, 2).map(windowText).map(esc).join(' · ')}</td></tr>`).join('')}</tbody></table>
    <p class="hint">${p.short ? `${esc(p.short)} has one opponent fewer this week. ` : ''}Rows in red share fewer than two days — they
      may struggle to meet. The real pairing is made from the players and results at the moment the week starts.</p>`;
}

// ── the availability grid ─────────────────────────────────────────────

function wireGrid(): void {
  const el = document.getElementById('lg-grid');
  const tz = document.getElementById('lg-tz') as HTMLInputElement | null;
  if (tz) {
    tz.onchange = () => { if (draft && tz.value.trim()) { draft.tz = tz.value.trim(); dirty = true; paint(); } };
  }
  if (!el) return;
  let painting: '0' | '1' | null = null;
  const set = (cell: Element | null): void => {
    if (!painting || !draft || !(cell instanceof HTMLElement) || cell.dataset['i'] === undefined) return;
    const i = Number(cell.dataset['i']);
    if (draft.grid[i] === painting) return;
    draft.grid = draft.grid.slice(0, i) + painting + draft.grid.slice(i + 1);
    cell.classList.toggle('on', painting === '1');
    dirty = true;
    const n = hoursIn(draft.grid);
    const out = document.getElementById('lg-hours');
    if (out) { out.textContent = `${n} hours a week`; out.classList.toggle('lgwarn', n < (data?.minHours ?? 6)); }
    const save = document.querySelector('[data-btn="lg-grid-save"]') as HTMLButtonElement | null;
    if (save) { save.disabled = false; save.textContent = 'Save'; }
  };
  el.onpointerdown = e => {
    const cell = (e.target as HTMLElement).closest('.lgcell') as HTMLElement | null;
    if (!cell || !draft) return;
    e.preventDefault();
    painting = draft.grid[Number(cell.dataset['i'])] === '1' ? '0' : '1';
    el.setPointerCapture?.(e.pointerId);
    set(cell);
  };
  // pointer capture sends every move here; find the cell under the finger
  el.onpointermove = e => { if (painting) set(document.elementFromPoint(e.clientX, e.clientY)?.closest('.lgcell') ?? null); };
  el.onpointerup = el.onpointercancel = () => { painting = null; };
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

export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('lg-')) return false;
  const s = data?.season ?? null;
  if (b !== 'lg-advance' && b !== 'lg-delete' && b !== 'lg-leave') arming = null;

  switch (b) {
    case 'lg-open': openLeague(); return true;
    case 'lg-banner':
      bannerOpen = !bannerOpen;
      try { localStorage.setItem('algoLeagueBanner', bannerOpen ? '1' : '0'); } catch { /* private mode */ }
      rerenderHost();
      return true;
    case 'lg-close': close(); return true;
    case 'lg-season': want = btn.dataset['id'] ?? null; preview = null; syncUrl(); load(); return true;

    case 'lg-grid-preset': if (draft) { draft.grid = defaultGrid(); dirty = true; paint(); } return true;
    case 'lg-grid-clear': if (draft) { draft.grid = '0'.repeat(GRID_LEN); dirty = true; paint(); } return true;
    case 'lg-tz-here': if (draft) { draft.tz = browserTz(); dirty = true; paint(); } return true;
    case 'lg-grid-save':
      if (!draft) return true;
      void post('/api/league/availability', { tz: draft.tz, grid: draft.grid }).then(r => {
        if (r.ok) { dirty = false; msg = 'Saved.'; } else msg = r.error ?? 'could not save';
        load();
      });
      return true;

    case 'lg-join': if (s) void act('/api/league/join', { season: s.id }, `You're in ${s.name}.`); return true;
    case 'lg-leave':
      if (arming !== 'leave') { arming = 'leave'; paint(); return true; }
      if (s) void act('/api/league/leave', { season: s.id }, 'You left the league.');
      return true;
    case 'lg-skip':
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
    case 'lg-delete':
      if (arming !== 'delete') { arming = 'delete'; paint(); return true; }
      if (s) { want = null; void act('/api/league/admin/delete', { id: s.id }, 'Deleted.'); }
      return true;
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

export function renderScreen(): void { paint(); }
