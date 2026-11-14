/* THE CUBE EVENT PAGE, DRAWN (docs/25-cube-draft.md §10; the page contract, pages/README.md).
 *
 *   · cubeView(raw) gathers ui/cube.ts's state — the server's CubeView, the list of my
 *     events, the New-event form, the clock — into a plain view;
 *   · cubeHtml(view) draws it and touches nothing else;
 *   · paintCube(app, view, hooks) puts it on screen and carries what is typed.
 *
 * Two pages in one module: the LIST (my events + New event) and an EVENT, by phase —
 * lobby (the seats, the settings, the share link), building (who has submitted, Build your
 * deck), playing (Standings · Round/Schedule · Matches · Players in the toolbar, Your match
 * beside them), done (the final standings). The draft itself is the pick screen
 * (ui/cubedraft.ts), which ui/cube.ts paints instead of this while the viewer drafts.
 *
 * Everything shown is the server's answer (server/cube.ts cubeView): nothing here pairs,
 * scores or ranks. The one thing worked out here is the New-event sheet's live pack line,
 * which the server works out again at the start (§3) — it is a preview.
 *
 * Countdowns are drawn with the time left at `now` and carry `data-cube-until="<ms>"`;
 * ui/cube.ts rewrites their text in place once a second, so a tick never rebuilds a button
 * under the pointer.
 */
import type {
  CubeConfig, CubeMatchView, CubeMine, CubePhase, CubeRules, CubeView, StandingRow, Tournament,
} from '../../server/cube-types.ts';
import type { Element } from '../../engine/src/types.ts';
import { ALL_ELEMENTS } from '../../engine/src/apply.ts';
import { draftDeckList } from '../../engine/src/cards/registry.ts';
import { button, chip, emptyState, segmented, settingRow, sheet, statusMessage, table, toggle } from '../components/index.ts';
import type { StatusTone } from '../components/status.ts';
import { elIcon, esc } from '../util.ts';
import { caretIn, restoreCaret } from './caret.ts';
import { frameChromeView, frameHtml, paintFrame, type FrameChrome } from './frame.ts';

// ── the numbers (docs/25 §3) ──────────────────────────────────────────

export const PLAYERS_MIN = 2;
export const PLAYERS_MAX = 12;
export const ROUNDS_MAX = 10;
/** the most pack rounds the server takes */
export const PACKS_MAX = 6;
/** the five elements of the base game: the standard cube */
export const BASE_ELEMENTS: readonly Element[] = ['fire', 'water', 'earth', 'wood', 'metal'];
/** a pack's least size before the draft refuses (§3) */
export const PACK_MIN = 5;
/** a pasted list keeps at most this many of a card (§3, the constructed copy cap) */
export const LIST_COPY_CAP = 2;

/** §3's auto numbers: 3 packs, as many cards each as the pool allows (15 at most) */
export function packMath(pool: number, seats: number, packs: number | null, packSize: number | null):
  { seats: number; packs: number; packSize: number; ok: boolean } {
  const p = packs ?? 3;
  const size = packSize ?? Math.min(15, Math.floor(pool / Math.max(1, seats * p)));
  return { seats, packs: p, packSize: size, ok: size >= PACK_MIN && seats * p * size <= pool };
}

/** A pasted list as names with their copies: `2 Fire Spirit`, `2x Fire Spirit`, `Fire Spirit`.
 * Blank lines and `//` or `#` lines are skipped; each card at most LIST_COPY_CAP. Unknown names
 * stay in: the server names them when it refuses the list. */
export function parseList(text: string): string[] {
  const n = new Map<string, number>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    const m = /^(\d+)\s*x?\s+(.+)$/i.exec(line);
    const name = (m ? m[2]! : line).trim();
    const k = m ? Number(m[1]) : 1;
    if (name && k > 0) n.set(name, Math.min(LIST_COPY_CAP, (n.get(name) ?? 0) + k));
  }
  return [...n].flatMap(([name, k]) => Array<string>(k).fill(name));
}

// ── the New-event / settings form ─────────────────────────────────────

export interface CubeForm {
  name: string;
  source: 'elements' | 'list';
  elements: Element[];
  listText: string;
  packs: number | null;
  packSize: number | null;
  minPlayers: number;
  maxPlayers: number;
  fillBots: boolean;
  start: 'host' | 'time';
  /** epoch ms, used when start is 'time' */
  startAt: number;
  tournament: Tournament;
  swissRounds: number;
  rules: CubeRules;
  bestOf: 1 | 3;
}

/** the next whole hour after the next one: a time to start at that is not "now" */
export const laterHour = (now: number): number => Math.ceil(now / 3_600_000) * 3_600_000 + 3_600_000;

export function defaultForm(hostName: string, now: number): CubeForm {
  return {
    name: hostName ? `${hostName}'s cube` : 'Cube draft', source: 'elements', elements: [...BASE_ELEMENTS], listText: '',
    packs: null, packSize: null, minPlayers: 2, maxPlayers: 8, fillBots: true, start: 'host', startAt: laterHour(now),
    tournament: 'swiss', swissRounds: 3, rules: 'casual', bestOf: 1,
  };
}

export function formFromConfig(c: CubeConfig, now: number): CubeForm {
  return {
    name: c.name, source: c.source.kind, elements: c.source.kind === 'elements' ? [...c.source.elements] : [...BASE_ELEMENTS],
    listText: c.source.kind === 'list' ? listText(c.source.names) : '',
    packs: c.packs, packSize: c.packSize, minPlayers: c.minPlayers, maxPlayers: c.maxPlayers, fillBots: c.fillBots,
    start: c.startAt === null ? 'host' : 'time', startAt: c.startAt ?? laterHour(now),
    tournament: c.tournament, swissRounds: c.swissRounds, rules: c.rules, bestOf: c.bestOf,
  };
}

/** names with multiplicity → "2 Fire Spirit" lines */
function listText(names: readonly string[]): string {
  const n = new Map<string, number>();
  for (const x of names) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].map(([x, k]) => `${k} ${x}`).join('\n');
}

export function formConfig(f: CubeForm): CubeConfig {
  return {
    name: f.name.trim() || 'Cube draft',
    source: f.source === 'elements' ? { kind: 'elements', elements: ALL_ELEMENTS.filter(e => f.elements.includes(e)) }
      : { kind: 'list', names: parseList(f.listText) },
    packs: f.packs, packSize: f.packSize, minPlayers: f.minPlayers, maxPlayers: f.maxPlayers, fillBots: f.fillBots,
    startAt: f.start === 'time' ? f.startAt : null,
    tournament: f.tournament, swissRounds: f.swissRounds, rules: f.rules, bestOf: f.bestOf,
  };
}

/** the form's pool size: the elements' deck-legal cards, or the pasted names */
export const formPool = (f: CubeForm): number =>
  f.source === 'elements' ? draftDeckList(f.elements).length : parseList(f.listText).length;

// ── the view ──────────────────────────────────────────────────────────

export const CUBE_TABS = ['standings', 'round', 'matches', 'players'] as const;
export type CubeTab = typeof CUBE_TABS[number];

export type CubeSheet =
  | { kind: 'new' } | { kind: 'edit' } | { kind: 'pairings' } | { kind: 'startnow' }
  | { kind: 'result'; pairing: string };

/** what ui/cube.ts hands the view */
export interface CubeRaw {
  /** null: the list of my events */
  code: string | null;
  event: CubeView | null;
  list: CubeMine[] | null;
  /** the list could not be fetched */
  listMissed: boolean;
  loading: boolean;
  signedIn: boolean;
  /** the server's clock minus this one's, from the last view */
  skew: number;
  tab: CubeTab;
  sheet: CubeSheet | null;
  form: CubeForm | null;
  msg: string;
  msgTone: StatusTone;
  busy: boolean;
  /** a destructive button pressed once ("leave", "kick:<user>" …), waiting for the second press */
  arming: string | null;
  /** the pairings sheet's first pick */
  swapPick: string | null;
  /** a match was just found for me: the banner */
  banner: CubeMatchView | null;
  /** the socket is up */
  online: boolean;
}

export interface CubeDayChoice { label: string; offset: number; on: boolean }

export interface CubePageView extends Omit<CubeRaw, 'skew'> {
  chrome: FrameChrome;
  /** the server's clock, as well as this one knows it */
  now: number;
  tz: string;
  /** the event's link to share */
  shareUrl: string;
  /** the form's numbers: its pool, and the packs at a full table and with the fewest players */
  formMath: { pool: number; full: ReturnType<typeof packMath>; least: ReturnType<typeof packMath> } | null;
  /** the scheduled start's day buttons and its words */
  days: CubeDayChoice[];
  startText: string;
}

const browserTz = (): string => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};

/** the day's local start (ms) of `ms` in the browser's zone */
function dayStart(ms: number): number { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }

/** Gather the page: the ONLY reader of the clock, the zone and the address bar. */
export function cubeView(raw: CubeRaw): CubePageView {
  const now = Date.now() + raw.skew;
  const tz = browserTz();
  const f = raw.form;
  const pool = f ? formPool(f) : 0;
  const today = dayStart(Date.now());
  const days: CubeDayChoice[] = f ? Array.from({ length: 7 }, (_, i) => {
    const at = new Date(today); at.setDate(at.getDate() + i);
    return {
      offset: i, on: dayStart(f.startAt) === at.getTime(),
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmt(at.getTime(), { weekday: 'short', day: 'numeric' }, tz),
    };
  }) : [];
  let origin = '';
  try { origin = location.origin; } catch { /* a test */ }
  const { skew: _skew, ...rest } = raw;
  return {
    ...rest, chrome: frameChromeView(), now, tz,
    shareUrl: `${origin}/?cube=${encodeURIComponent(raw.code ?? '')}`,
    formMath: f ? { pool, full: packMath(pool, f.maxPlayers, f.packs, f.packSize), least: packMath(pool, f.minPlayers, f.packs, f.packSize) } : null,
    days,
    startText: f ? fmt(f.startAt, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }, tz) : '',
  };
}

// ── words ─────────────────────────────────────────────────────────────

export function fmt(ms: number, opts: Intl.DateTimeFormatOptions, tz: string): string {
  try { return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz }).format(ms); } catch { return new Date(ms).toISOString(); }
}

/** time left as a clock: "1:12", "2:05:09", "3 days" */
export function untilText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 2 * 86_400) return `${Math.floor(s / 86_400)} days`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n: number): string => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

/** a countdown ui/cube.ts keeps ticking */
const until = (at: number, now: number): string => `<span class="cubeclock" data-cube-until="${at}">${untilText(at - now)}</span>`;

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const TOURNAMENT_WORDS: Record<Tournament, string> = { swiss: 'Swiss', roundrobin: 'Round robin', exhibition: 'Exhibition' };

const PHASE_WORDS: Record<CubePhase, string> = {
  lobby: 'Waiting to start', drafting: 'Drafting', building: 'Building decks', playing: 'Playing', done: 'Finished', cancelled: 'Called off',
};

const tournamentLine = (c: CubeConfig): string =>
  c.tournament === 'swiss' ? `Swiss, ${c.swissRounds} round${c.swissRounds === 1 ? '' : 's'}` : TOURNAMENT_WORDS[c.tournament];

const mathLine = (m: { seats: number; packs: number; packSize: number }, pool: number): string =>
  `${m.seats} players · ${m.packs} packs of ${m.packSize} · ${pool} cards`;

const nameOf = (v: CubeView, user: string): string => v.players.find(p => p.user === user)?.name ?? '?';

// ── the page ──────────────────────────────────────────────────────────

/** The cube page: the list of my events, or one event. Pure. */
export function cubeHtml(v: CubePageView): string {
  const e = v.event;
  // a refusal of the form's Create / Save is said in its sheet, where the form is
  const inForm = v.sheet?.kind === 'new' || v.sheet?.kind === 'edit';
  const msg = v.msg && !inForm ? statusMessage({ tone: v.msgTone, text: v.msg, className: 'cubemsg' }) : '';
  if (!v.code) {
    return frameHtml({
      page: 'cubepage', title: 'Cube draft', back: { dataBtn: 'cube-close', label: 'Home' }, chrome: v.chrome, fill: true,
      mainHtml: `${msg}${listHtml(v)}${sheetHtml(v)}`,
    });
  }
  const tabs = e?.phase === 'playing' ? tabsFor(e) : [];
  const tab = tabs.includes(v.tab) ? v.tab : 'standings';
  return frameHtml({
    page: 'cubepage', title: e?.config.name ?? 'Cube draft',
    titleHtml: `${esc(e?.config.name ?? 'Cube draft')}<small>${esc(e ? PHASE_WORDS[e.phase] : '')}</small>`,
    back: { dataBtn: 'cube-back', label: 'Back', icon: 'back', title: 'your cube events' }, chrome: v.chrome, fill: true,
    centerHtml: tabs.length ? segmented({
      ariaLabel: 'Event', className: 'cubetabs',
      options: tabs.map(k => ({ label: TAB_LABEL(e!, k), value: k, on: k === tab, dataBtn: 'cube-tab', attrs: { 'data-v': k } })),
    }) : '',
    mainHtml: `${msg}${bannerHtml(v)}${!v.online && e ? '<p class="cubeoffline">Reconnecting…</p>' : ''}${e ? eventHtml(v, e, tab) : loadingHtml(v)}${sheetHtml(v)}`,
  });
}

function loadingHtml(v: CubePageView): string {
  if (v.loading) return '<p class="dim cubeloading">Loading…</p>';
  return emptyState({ title: 'No event here', text: 'Check the code, or open one of your events.',
    actionHtml: button({ label: 'Your events', dataBtn: 'cube-back' }) });
}

/** the playing tabs: Exhibition has no rounds, Round robin's is its schedule */
function tabsFor(e: CubeView): CubeTab[] {
  return CUBE_TABS.filter(k => k !== 'round' || e.config.tournament !== 'exhibition');
}
const TAB_LABEL = (e: CubeView, k: CubeTab): string =>
  k === 'round' ? (e.config.tournament === 'roundrobin' ? 'Schedule' : 'Round') : cap(k);

// ── the list ──────────────────────────────────────────────────────────

const mineLine = (r: CubeMine): string => {
  if (r.phase === 'lobby') return `${r.players} of ${r.maxPlayers} joined`;
  if (r.phase === 'playing' && r.myMatch && r.myMatch.status !== 'done') return r.myMatch.status === 'live' ? 'Your match is on' : 'Your match is ready';
  return PHASE_WORDS[r.phase];
};

function listHtml(v: CubePageView): string {
  if (!v.signedIn) {
    return emptyState({ title: 'Cube draft', text: 'Sign in to make a cube event or join one. A guest account works too.',
      actionHtml: button({ label: 'Sign in', variant: 'primary', dataBtn: 'acct-open-auth' }) });
  }
  const rows = v.list ?? [];
  const bar = `<div class="framebar"><p class="framenote">Draft packs from a shared cube with up to ${PLAYERS_MAX} players, then play a tournament with what you drafted.</p>
    <span class="framespacer"></span>${button({ label: 'New event', variant: 'primary', dataBtn: 'cube-new' })}</div>`;
  if (!v.list) return `${bar}<p class="dim cubeloading">${v.listMissed ? 'Could not load your events just now.' : 'Loading…'}</p>`;
  if (!rows.length) {
    return `${bar}${emptyState({ text: 'No cube events yet. Make one and share its code, or open a link someone sent you.' })}`;
  }
  return `${bar}<div class="framelist cubelist" data-scroll="cube-list">${rows.map(r => `<button class="cuberow" data-btn="cube-open" data-code="${esc(r.code)}">
      <span class="cuberowname">${esc(r.name)}</span>
      <span class="cuberowline">${esc(mineLine(r))}</span>
      ${r.isHost ? chip({ label: 'Host', tone: 'accent' }) : ''}
      ${r.myMatch && r.myMatch.status !== 'done' ? chip({ label: r.myMatch.status === 'live' ? 'Playing' : 'Match ready', tone: 'success', shape: 'pill' }) : ''}
      <span class="cuberowcode">${esc(r.code)}</span>
    </button>`).join('')}</div>`;
}

// ── an event ──────────────────────────────────────────────────────────

function eventHtml(v: CubePageView, e: CubeView, tab: CubeTab): string {
  switch (e.phase) {
    case 'lobby': return lobbyHtml(v, e);
    case 'drafting': return draftingHtml(v, e);
    case 'building': return buildingHtml(v, e);
    case 'playing': return playingHtml(v, e, tab);
    case 'done': return doneHtml(v, e);
    case 'cancelled':
      return emptyState({ title: 'Called off', text: 'The host called this event off.', actionHtml: button({ label: 'Your events', dataBtn: 'cube-back' }) });
  }
}

/** the settings, as a short list of facts */
function factsHtml(v: CubePageView, e: CubeView): string {
  const c = e.config;
  const cards = c.source.kind === 'elements'
    ? `<span class="cubeels">${c.source.elements.map(el => `<span class="cubeel">${elIcon(el, el)}${esc(cap(el))}</span>`).join('')}</span>`
    : `A pasted list`;
  const rows: [string, string][] = [
    ['Cards', `${cards} <span class="dim">· ${e.poolSize} cards</span>`],
    ['Players', esc(`${c.minPlayers} to ${c.maxPlayers}${c.fillBots ? ', bots fill the table' : ''}`)],
    ['Tournament', esc(tournamentLine(c))],
    ['Games', esc(`${cap(c.rules)} · best of ${c.bestOf}`)],
    ['Host', esc(e.host.name)],
  ];
  if (e.phase === 'lobby') {
    rows.push(['Start', c.startAt === null ? 'When the host starts it'
      : `${esc(fmt(c.startAt, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }, v.tz))}`
        + (c.startAt > v.now ? ` <span class="dim">· in ${until(c.startAt, v.now)}</span>` : '')]);
  }
  return `<dl class="cubefacts">${rows.map(([k, x]) => `<dt>${esc(k)}</dt><dd>${x}</dd>`).join('')}</dl>`;
}

/** the pack line(s): now, and for a full table when that differs */
function packsHtml(e: CubeView): string {
  const [now, full] = e.packMath;
  if (!now) return '';
  const line = (label: string, m: CubeView['packMath'][number]): string =>
    `<p class="cubepacks${m.ok ? '' : ' bad'}">${label ? `<span class="dim">${esc(label)}:</span> ` : ''}${esc(m.ok ? mathLine(m, e.poolSize) : `Too few cards for ${m.seats} players`)}</p>`;
  return full && (full.seats !== now.seats || full.packSize !== now.packSize)
    ? line('Now', now) + line('Full table', full) : line('', now);
}

function shareHtml(v: CubePageView, e: CubeView): string {
  return `<div class="cubeshare">
    <div class="cubecode"><span class="dim">Code</span> <b>${esc(e.code)}</b>
      ${button({ label: 'Copy code', size: 'sm', dataBtn: 'cube-copy', attrs: { 'data-what': 'code' } })}</div>
    <div class="cubelink"><input id="cube-share" class="cubesharebox" readonly value="${esc(v.shareUrl)}" aria-label="the event's link">
      ${button({ label: 'Copy link', size: 'sm', variant: 'action', dataBtn: 'cube-copy', attrs: { 'data-what': 'link' } })}</div>
  </div>`;
}

/** a two-press button: the first press arms it, the second does it */
function armed(v: CubePageView, key: string, label: string, again: string, dataBtn: string, attrs: Record<string, string> = {}, size: 'sm' | 'md' = 'md'): string {
  const on = v.arming === key;
  return button({ label: on ? again : label, variant: on ? 'danger' : 'secondary', size, dataBtn, attrs, disabled: v.busy });
}

function lobbyHtml(v: CubePageView, e: CubeView): string {
  const c = e.config;
  const seats = Array.from({ length: Math.max(c.maxPlayers, e.players.length) }, (_, i) => e.players[i] ?? null);
  const seatHtml = seats.map(p => {
    if (!p) return `<li class="cubeseat empty">${c.fillBots ? 'Bot' : 'Open'}</li>`;
    const host = p.user === e.host.user;
    return `<li class="cubeseat${p.user === e.me ? ' me' : ''}"><span class="cubeseatname">${esc(p.name)}</span>
      ${host ? chip({ label: 'Host', tone: 'accent' }) : ''}${p.user === e.me ? chip({ label: 'You' }) : ''}
      ${e.isHost && !host ? armed(v, `kick:${p.user}`, 'Remove', 'Remove?', 'cube-kick', { 'data-user': p.user }, 'sm') : ''}</li>`;
  }).join('');
  const short = c.minPlayers - e.players.length;
  const startOk = short <= 0 && (e.packMath[0]?.ok ?? false);
  const actions = !v.signedIn
    ? button({ label: 'Sign in to join', variant: 'primary', dataBtn: 'acct-open-auth' })
    : e.isHost
      ? `${button({ label: 'Start draft', variant: 'primary', dataBtn: 'cube-start', disabled: !startOk || v.busy,
          title: short > 0 ? `needs ${short} more` : startOk ? undefined : 'too few cards for this table' })}
        ${button({ label: 'Edit settings', dataBtn: 'cube-edit' })}
        ${armed(v, 'cancel', 'Call off', 'Call off the event?', 'cube-cancel')}`
      : e.joined
        ? armed(v, 'leave', 'Leave', 'Leave the event?', 'cube-leave')
        : button({ label: 'Join', variant: 'primary', dataBtn: 'cube-join', disabled: v.busy || e.players.length >= c.maxPlayers,
          title: e.players.length >= c.maxPlayers ? 'the table is full' : undefined });
  return `<div class="cubework">
    <section class="cubepane" data-scroll="cube-lobby-seats">
      <h2 class="cubehead">Seats <span class="dim">${e.players.length} of ${c.maxPlayers}</span></h2>
      <ol class="cubeseats">${seatHtml}</ol>
      ${short > 0 ? `<p class="dim">Needs ${short} more player${short === 1 ? '' : 's'} to start.</p>` : ''}
      ${c.startAt !== null && c.startAt > v.now ? `<p class="cubebig">Starts in ${until(c.startAt, v.now)}</p>` : ''}
    </section>
    <aside class="cubeside" data-scroll="cube-lobby-side">
      ${factsHtml(v, e)}
      ${packsHtml(e)}
      ${shareHtml(v, e)}
      <div class="cubeactions">${actions}</div>
    </aside>
  </div>`;
}

function draftingHtml(v: CubePageView, e: CubeView): string {
  return `<div class="cubework">
    <section class="cubepane" data-scroll="cube-drafting">
      <h2 class="cubehead">The draft is on</h2>
      <p>${e.joined ? 'Your pack is waiting, and its clock keeps running.' : 'The players are drafting. Decks are built next, then the matches start.'}</p>
      ${e.joined ? button({ label: 'Back to the draft', variant: 'primary', dataBtn: 'cube-draft-show' }) : ''}
      <ol class="cubeseats">${e.players.map(p => `<li class="cubeseat"><span class="cubeseatname">${esc(p.name)}</span></li>`).join('')}</ol>
    </section>
    <aside class="cubeside" data-scroll="cube-drafting-side">${factsHtml(v, e)}</aside>
  </div>`;
}

/** "Round 2 in 1:12" (the break), for everybody; the host's Pairings button with it */
function breakHtml(v: CubePageView, e: CubeView): string {
  if (!e.breakUntil || e.breakUntil <= v.now) return '';
  const next = e.config.tournament === 'swiss' ? `Round ${e.round + 1}` : e.round === 0 ? 'The matches' : 'Next round';
  return `<div class="cubebreak"><p class="cubebig">${esc(next)} in ${until(e.breakUntil, v.now)}</p>
    ${e.isHost && e.pending?.length ? button({ label: 'Pairings', variant: 'action', dataBtn: 'cube-pairings' }) : ''}</div>`;
}

function buildingHtml(v: CubePageView, e: CubeView): string {
  const me = e.players.find(p => p.user === e.me);
  const waiting = e.players.filter(p => !p.submitted && !p.dropped);
  const deck = e.myDeck;
  return `<div class="cubework">
    <section class="cubepane" data-scroll="cube-building">
      ${breakHtml(v, e)}
      ${me ? `<div class="cubeyours">
        <h2 class="cubehead">Your deck</h2>
        <p>${deck ? `Submitted: ${deck.main.length} cards${deck.side.length ? ` and ${deck.side.length} in the sideboard` : ''}. You can change it until your first match.`
          : `At least 30 cards and up to 7 in the sideboard, from the ${e.myPool?.length ?? 0} you drafted.`}</p>
        ${button({ label: deck ? 'Edit your deck' : 'Build your deck', variant: 'primary', dataBtn: 'cube-build' })}
      </div>` : ''}
      <h2 class="cubehead">Decks <span class="dim">${e.players.length - waiting.length} of ${e.players.length} in</span></h2>
      <ul class="cubesubmits">${e.players.map(p => `<li class="${p.submitted ? 'in' : ''}${p.dropped ? ' out' : ''}">
        <span class="cubemark" aria-hidden="true">${p.submitted ? '✓' : '…'}</span>${esc(p.name)}
        <span class="dim">${p.dropped ? 'dropped' : p.submitted ? 'submitted' : 'building'}</span></li>`).join('')}</ul>
    </section>
    <aside class="cubeside" data-scroll="cube-building-side">
      ${factsHtml(v, e)}
      ${e.isHost && waiting.length ? `<div class="cubeactions">${button({ label: 'Start now', variant: 'action', dataBtn: 'cube-startnow',
        title: 'start the matches without the decks still being built' })}</div>` : ''}
    </aside>
  </div>`;
}

// ── playing ───────────────────────────────────────────────────────────

const vsWords = (m: CubeMatchView, me: string | null): string => {
  if (!m.b) return `${m.a.name} has a bye`;
  if (m.a.user === me) return `vs ${m.b.name}`;
  if (m.b.user === me) return `vs ${m.a.name}`;
  return `${m.a.name} vs ${m.b.name}`;
};

const roundWord = (e: CubeView, m: CubeMatchView): string =>
  e.config.tournament === 'exhibition' ? '' : `Round ${m.round}`;

function yourMatchHtml(v: CubePageView, e: CubeView): string {
  const me = e.players.find(p => p.user === e.me);
  if (!me) return e.joined ? '' : '<p class="dim">You are watching this event.</p>';
  if (me.dropped) return `<div class="cubeyours"><h2 class="cubehead">Your match</h2><p>You have dropped out of this event.</p></div>`;
  const m = e.myMatch;
  let body: string;
  if (m && !m.b) {
    body = `<p class="cubebig">A bye${m.round ? ` in round ${m.round}` : ''}</p><p class="dim">It counts as a win. Watch a match while you wait.</p>`;
  } else if (m && m.status !== 'done') {
    body = `<p class="cubebig">${esc(vsWords(m, e.me))}</p>
      <p class="dim">${esc([roundWord(e, m), m.status === 'live' ? 'Under way' : 'Ready to play'].filter(Boolean).join(' · '))}</p>
      ${button({ label: m.status === 'live' ? 'Back to your match' : 'Play', variant: 'primary', className: 'cubeplay', dataBtn: 'cube-play',
        attrs: { 'data-pairing': m.pairing }, disabled: v.busy })}`;
  } else if (m) {
    body = `<p class="cubebig">${esc(vsWords(m, e.me))} <span class="cubescore">${esc(m.score ?? '')}</span></p>
      <p class="dim">${m.winner === e.me ? 'You won.' : m.winner ? 'You lost.' : 'Done.'} Waiting for the others to finish.</p>`;
  } else if (e.config.tournament === 'exhibition') {
    body = `<p>${me.ready ? 'Looking for someone you have not played.' : 'Taking a break: you will not be paired.'}</p>`;
  } else {
    body = '<p class="dim">No match for you right now.</p>';
  }
  const ready = e.config.tournament === 'exhibition' && !me.inMatch
    ? `<div class="cubeready">${toggle({ label: me.ready ? 'Ready to play' : 'Not ready', on: me.ready, strong: true, dataBtn: 'cube-ready',
      attrs: { 'data-on': me.ready ? '0' : '1' }, className: 'cubereadyswitch', disabled: v.busy })}</div>` : '';
  return `<div class="cubeyours"><h2 class="cubehead">Your match</h2>${ready}${body}
    <div class="cubeactions">${button({ label: 'Your deck', dataBtn: 'cube-build', disabled: me.inMatch,
      title: me.inMatch ? 'you can change your deck between matches' : 'change your deck for the next match' })}</div></div>`;
}

const STANDINGS_COLUMNS = [
  { key: 'rank', label: '#', align: 'right' as const }, { key: 'player', label: 'Player' },
  { key: 'pts', label: 'Points', align: 'right' as const }, { key: 'wld', label: 'W–L–D', align: 'center' as const },
  { key: 'omw', label: 'OMW', align: 'right' as const, title: 'how well your opponents did' },
  { key: 'gw', label: 'GW', align: 'right' as const, title: 'your share of games won' },
  { key: 'ogw', label: 'OGW', align: 'right' as const, title: 'your opponents’ share of games won' },
];
const pct = (x: number): string => `${Math.round(x * 100)}%`;

function standingsHtml(e: CubeView): string {
  return table({
    className: 'cubestandings', columns: STANDINGS_COLUMNS, emptyText: 'No results yet.',
    rows: e.standings.map((r: StandingRow) => ({
      className: `${r.user === e.me ? 'me' : ''}${r.dropped ? ' out' : ''}`,
      cells: {
        rank: String(r.rank), player: { html: `${esc(r.name)}${r.dropped ? ' <span class="dim">dropped</span>' : ''}` },
        pts: String(r.points), wld: `${r.w}–${r.l}–${r.d}`, omw: pct(r.omw), gw: pct(r.gw), ogw: pct(r.ogw),
      },
    })),
  });
}

const STATUS_WORDS: Record<CubeMatchView['status'], string> = { waiting: 'Not started', live: 'Under way', done: 'Done' };

/** one match as a row: who, where it stands, Watch while live, the host's Edit */
function matchRowHtml(v: CubePageView, e: CubeView, m: CubeMatchView, showRound: boolean): string {
  const who = m.b ? `${esc(m.a.name)} <span class="dim">vs</span> ${esc(m.b.name)}` : `${esc(m.a.name)} <span class="dim">· bye</span>`;
  const mine = m.a.user === e.me || m.b?.user === e.me;
  const watch = m.status === 'live' && m.room && !mine
    ? button({ label: 'Watch', size: 'sm', variant: 'action', href: `/?ws=1&room=${encodeURIComponent(m.room)}&watch=1&cube=${encodeURIComponent(e.code)}`,
      className: 'cubewatch' }) : '';
  const play = mine && m.b && m.status !== 'done' && e.config.tournament === 'roundrobin'
    ? button({ label: m.status === 'live' ? 'Rejoin' : 'Play', size: 'sm', variant: 'primary', dataBtn: 'cube-play', attrs: { 'data-pairing': m.pairing } }) : '';
  const edit = e.isHost && m.b ? button({ label: 'Result', size: 'sm', variant: 'ghost', dataBtn: 'cube-result-open', attrs: { 'data-pairing': m.pairing },
    title: 'set or clear this match’s result' }) : '';
  const state = m.status === 'done' ? `<b>${esc(m.score ?? '')}</b>${m.winner ? ` <span class="dim">${esc(nameOf(e, m.winner))}</span>` : ''}` : esc(STATUS_WORDS[m.status]);
  return `<div class="cubematch${mine ? ' me' : ''}${m.status === 'live' ? ' live' : ''}">
    ${showRound && e.config.tournament !== 'exhibition' ? `<span class="cubematchround dim">R${m.round}</span>` : ''}
    <span class="cubematchwho">${who}</span><span class="cubematchstate">${state}</span>
    <span class="cubematchbtns">${play}${watch}${edit}</span></div>`;
}

function matchListHtml(v: CubePageView, e: CubeView, list: CubeMatchView[], showRound: boolean, empty: string): string {
  return list.length ? `<div class="framelist cubematches">${list.map(m => matchRowHtml(v, e, m, showRound)).join('')}</div>`
    : `<p class="dim">${esc(empty)}</p>`;
}

function roundTabHtml(v: CubePageView, e: CubeView): string {
  if (e.config.tournament === 'roundrobin') {
    const rounds = [...new Set(e.matches.map(m => m.round))].sort((a, b) => a - b);
    return rounds.length ? rounds.map(r => `<h3 class="cubesub">Round ${r}</h3>${matchListHtml(v, e, e.matches.filter(m => m.round === r), false, '')}`).join('')
      : '<p class="dim">The schedule is posted when the break ends.</p>';
  }
  const now = e.matches.filter(m => m.round === e.round);
  return `<h3 class="cubesub">Round ${e.round || 1}${e.config.tournament === 'swiss' ? ` of ${e.config.swissRounds}` : ''}</h3>
    ${matchListHtml(v, e, now, false, 'The pairings are posted when the break ends.')}`;
}

function matchesTabHtml(v: CubePageView, e: CubeView): string {
  const order = { live: 0, waiting: 1, done: 2 } as const;
  const list = [...e.matches].sort((a, b) => order[a.status] - order[b.status] || b.round - a.round);
  return matchListHtml(v, e, list, true, 'No matches yet.');
}

function playersTabHtml(v: CubePageView, e: CubeView): string {
  return `<div class="framelist cubeplayers">${e.players.map(p => {
    const tags = [
      p.user === e.host.user ? chip({ label: 'Host', tone: 'accent' }) : '',
      p.dropped ? chip({ label: 'Dropped', tone: 'danger' }) : p.inMatch ? chip({ label: 'Playing', tone: 'success', shape: 'pill' })
        : e.config.tournament === 'exhibition' && p.ready ? chip({ label: 'Ready', tone: 'info', shape: 'pill' }) : '',
      !p.submitted && !p.dropped ? chip({ label: 'No deck', tone: 'warning' }) : '',
    ].join('');
    const host = e.isHost && p.user !== e.host.user
      ? (p.dropped ? button({ label: 'Put back', size: 'sm', dataBtn: 'cube-drop', attrs: { 'data-user': p.user, 'data-on': '0' }, disabled: v.busy })
        : armed(v, `drop:${p.user}`, 'Drop', 'Drop them?', 'cube-drop', { 'data-user': p.user, 'data-on': '1' }, 'sm')) : '';
    return `<div class="cubeplayer${p.user === e.me ? ' me' : ''}"><span class="cubeplayername">${esc(p.name)}</span>${tags}<span class="cubematchbtns">${host}</span></div>`;
  }).join('')}</div>`;
}

function playingHtml(v: CubePageView, e: CubeView, tab: CubeTab): string {
  const body = tab === 'round' ? roundTabHtml(v, e) : tab === 'matches' ? matchesTabHtml(v, e)
    : tab === 'players' ? playersTabHtml(v, e) : standingsHtml(e);
  return `<div class="cubework cubework--play">
    <aside class="cubeside" data-scroll="cube-play-side">
      ${breakHtml(v, e)}
      ${yourMatchHtml(v, e)}
      ${e.isHost ? `<div class="cubeactions cubehost">${armed(v, 'end', 'End the event', 'End it now?', 'cube-end')}</div>` : ''}
    </aside>
    <section class="cubepane" data-scroll="cube-tab-${tab}">${body}</section>
  </div>`;
}

function doneHtml(v: CubePageView, e: CubeView): string {
  const top = e.standings[0];
  return `<div class="cubework cubework--play">
    <aside class="cubeside" data-scroll="cube-done-side">
      <div class="cubeyours"><h2 class="cubehead">Finished</h2>
        ${top ? `<p class="cubebig">🏆 ${esc(top.name)}</p><p class="dim">${top.points} points · ${top.w}–${top.l}–${top.d}</p>` : ''}</div>
      ${factsHtml(v, e)}
    </aside>
    <section class="cubepane" data-scroll="cube-done">${standingsHtml(e)}</section>
  </div>`;
}

function bannerHtml(v: CubePageView): string {
  const m = v.banner, e = v.event;
  if (!m || !e) return '';
  const words = m.b ? `Your match is ready: <b>${esc(vsWords(m, e.me))}</b>` : `You have a bye${m.round ? ` in round ${m.round}` : ''}.`;
  return `<div class="cubebanner" role="status">${statusMessage({ tone: 'info', textHtml: words })}
    ${m.b ? button({ label: 'Play', variant: 'primary', size: 'sm', dataBtn: 'cube-play', attrs: { 'data-pairing': m.pairing } }) : ''}
    ${button({ label: 'Dismiss', size: 'sm', variant: 'ghost', dataBtn: 'cube-banner-close' })}</div>`;
}

// ── the sheets ────────────────────────────────────────────────────────

function sheetHtml(v: CubePageView): string {
  const s = v.sheet, e = v.event;
  if (!s) return '';
  const base = { open: true, dismissBtn: 'cube-sheet-close', className: 'cubesheet' } as const;
  switch (s.kind) {
    case 'new': case 'edit':
      return v.form ? sheet({ ...base, id: 'cube-form', placement: 'side', width: 'lg', title: s.kind === 'new' ? 'New cube event' : 'Event settings',
        bodyHtml: formHtml(v, v.form), footerHtml: formFooterHtml(v, v.form, s.kind) }) : '';
    case 'pairings':
      return e ? sheet({ ...base, id: 'cube-pairings', width: 'md', title: `Round ${e.round + 1} pairings`, bodyHtml: pairingsHtml(v, e),
        footerHtml: `${button({ label: 'Post now', variant: 'primary', dataBtn: 'cube-post', disabled: v.busy })}${button({ label: 'Done', dataBtn: 'cube-sheet-close' })}` }) : '';
    case 'startnow': {
      if (!e) return '';
      const out = e.players.filter(p => !p.submitted && !p.dropped);
      return sheet({ ...base, id: 'cube-startnow', width: 'sm', title: 'Start without them?',
        bodyHtml: `<p>${out.length ? `${esc(out.map(p => p.name).join(', '))} ${out.length === 1 ? 'has' : 'have'} no deck yet and will be dropped from the event.` : 'Everyone has a deck.'}</p>`,
        footerHtml: `${button({ label: 'Start now', variant: 'danger', dataBtn: 'cube-startnow-go', disabled: v.busy })}${button({ label: 'Wait', dataBtn: 'cube-sheet-close' })}` });
    }
    case 'result': {
      const m = e?.matches.find(x => x.pairing === s.pairing);
      if (!e || !m || !m.b) return '';
      const opt = (label: string, outcome: string, on: boolean): { label: string; value: string; on: boolean; dataBtn: string; attrs: Record<string, string> } =>
        ({ label, value: outcome, on, dataBtn: 'cube-result', attrs: { 'data-pairing': m.pairing, 'data-outcome': outcome } });
      const done = m.status === 'done';
      return sheet({ ...base, id: 'cube-result', width: 'sm', title: `${m.a.name} vs ${m.b.name}`,
        bodyHtml: `${m.status === 'live' ? '<p class="dim">This match is being played. Setting a result ends it.</p>' : ''}
          ${segmented({ ariaLabel: 'Result', full: true, options: [
            // a win is sent as the winner's account id (server/api-cube.ts /result)
            opt(`${m.a.name} wins`, m.a.user, done && m.winner === m.a.user), opt(`${m.b.name} wins`, m.b.user, done && m.winner === m.b.user),
            opt('Draw', 'draw', done && !m.winner && m.score !== 'Bye'), opt('No result', 'clear', !done),
          ] })}`,
        footerHtml: button({ label: 'Close', dataBtn: 'cube-sheet-close' }) });
    }
  }
}

function pairingsHtml(v: CubePageView, e: CubeView): string {
  const pend = e.pending ?? [];
  const who = (p: { user: string; name: string }): string => {
    const on = v.swapPick === p.user;
    return `<button class="cubeswap${on ? ' on' : ''}" aria-pressed="${on}" data-btn="cube-swap" data-user="${esc(p.user)}">${esc(p.name)}</button>`;
  };
  return `<p class="dim">${v.swapPick ? `Now tap who ${esc(nameOf(e, v.swapPick))} swaps with.` : 'Tap two players to swap them.'}
      They post by themselves when the break ends${e.breakUntil ? ` (${until(e.breakUntil, v.now)})` : ''}.</p>
    <div class="framelist cubepend">${pend.map(m => `<div class="cubematch">${who(m.a)}<span class="dim">vs</span>${m.b ? who(m.b) : '<span class="dim">a bye</span>'}</div>`).join('')}</div>`;
}

const stepper = (key: string, n: string, lessOk: boolean, moreOk: boolean, label: string): string =>
  `<span class="cubestep" role="group" aria-label="${esc(label)}">${button({ label: '−', variant: 'icon', size: 'sm', title: `fewer: ${label}`, dataBtn: 'cube-f-step',
    attrs: { 'data-k': key, 'data-d': '-1' }, disabled: !lessOk })}<b class="cubestepval">${esc(n)}</b>${button({ label: '+', variant: 'icon', size: 'sm',
    title: `more: ${label}`, dataBtn: 'cube-f-step', attrs: { 'data-k': key, 'data-d': '1' }, disabled: !moreOk })}</span>`;

const seg = (label: string, key: string, options: [string, string][], cur: string): string => segmented({
  ariaLabel: label, size: 'sm',
  options: options.map(([value, text]) => ({ label: text, value, on: cur === value, dataBtn: 'cube-f-set', attrs: { 'data-k': key, 'data-v': value } })),
});

/** Auto, or a number with its stepper */
function autoNumber(key: 'packs' | 'packSize', label: string, n: number | null, auto: number, min: number, max: number): string {
  return `${seg(label, key, [['auto', `Auto (${auto})`], ['set', 'Set']], n === null ? 'auto' : 'set')}
    ${n === null ? '' : stepper(key, String(n), n > min, n < max, label)}`;
}

function formHtml(v: CubePageView, f: CubeForm): string {
  const m = v.formMath!;
  const els = `<div class="elrow cubeelpick">${ALL_ELEMENTS.map(el => {
    const on = f.elements.includes(el);
    return `<button class="elchip ${el}${on ? ' on' : ''}" aria-pressed="${on}" data-btn="cube-f-el" data-el="${el}">${elIcon(el, el)}${esc(cap(el))}</button>`;
  }).join('')}</div>`;
  const cards = f.source === 'elements' ? els
    : `<textarea id="cube-f-list" class="cubelistbox" rows="8" spellcheck="false" aria-label="the cards, one a line" placeholder="One card a line, e.g. 2 Fire Spirit">${esc(f.listText)}</textarea>`;
  const shown = f.fillBots ? m.full : m.least;
  const math = !m.pool ? '<p class="cubepacks bad">No cards yet.</p>'
    : m.full.ok ? `<p class="cubepacks">${esc(mathLine(m.full, m.pool))}${f.fillBots ? '' : ` <span class="dim">(a full table)</span>`}</p>`
      + (!f.fillBots && m.least.packSize !== m.full.packSize && m.least.ok ? `<p class="cubepacks dim">${esc(mathLine(m.least, m.pool))}</p>` : '')
      : `<p class="cubepacks bad">${esc(`Too few cards for ${m.full.seats} players: ${m.pool} cards, ${m.full.packs} packs of ${m.full.packSize}`)}</p>`;
  const row = (label: string, controlHtml: string, hintHtml = ''): string => settingRow({ label, controlHtml, hintHtml });
  const start = seg('Start', 'start', [['host', 'When I press Start'], ['time', 'At a set time']], f.start)
    + (f.start === 'time' ? `<div class="cubewhen">${segmented({ ariaLabel: 'Day', size: 'sm', className: 'cubedays',
      options: v.days.map(d => ({ label: d.label, value: String(d.offset), on: d.on, dataBtn: 'cube-f-day', attrs: { 'data-d': String(d.offset) } })) })}
      <span class="cubestep" role="group" aria-label="Time">${[-60, -15].map(d => button({ label: d === -60 ? '−1h' : '−15m', size: 'sm', dataBtn: 'cube-f-time',
        attrs: { 'data-d': String(d) } })).join('')}<b class="cubestepval">${esc(fmt(f.startAt, { hour: '2-digit', minute: '2-digit' }, v.tz))}</b>${[15, 60].map(d => button({
        label: d === 60 ? '+1h' : '+15m', size: 'sm', dataBtn: 'cube-f-time', attrs: { 'data-d': String(d) } })).join('')}</span></div>` : '');
  return `<div class="cubeform">
    ${row('Name', `<input id="cube-f-name" class="cubeinput" maxlength="40" aria-label="the event's name" value="${esc(f.name)}">`)}
    ${row('Cards', seg('Cards', 'source', [['elements', 'Elements'], ['list', 'Paste a list']], f.source) + cards,
      f.source === 'elements' ? 'Every deck card of the chosen elements, one copy each.' : 'At most 2 copies of a card.')}
    ${row('Players', `<span class="cuberange">${stepper('minPlayers', String(f.minPlayers), f.minPlayers > PLAYERS_MIN, f.minPlayers < f.maxPlayers, 'fewest players')}
      <span class="dim">to</span>${stepper('maxPlayers', String(f.maxPlayers), f.maxPlayers > f.minPlayers, f.maxPlayers < PLAYERS_MAX, 'most players')}</span>`)}
    ${row('Bots', toggle({ label: f.fillBots ? 'Bots fill empty seats' : 'No bots', on: f.fillBots, dataBtn: 'cube-f-bots' }),
      'Bots only draft. The tournament is people only.')}
    ${row('Packs', autoNumber('packs', 'packs', f.packs, 3, 1, PACKS_MAX))}
    ${row('Pack size', autoNumber('packSize', 'cards a pack', f.packSize, packMath(m.pool, shown.seats, f.packs, null).packSize, PACK_MIN, 20))}
    <div class="cubemath">${math}</div>
    ${row('Tournament', seg('Tournament', 'tournament', [['swiss', 'Swiss'], ['roundrobin', 'Round robin'], ['exhibition', 'Exhibition']], f.tournament)
      + (f.tournament === 'swiss' ? stepper('swissRounds', `${f.swissRounds} rounds`, f.swissRounds > 1, f.swissRounds < ROUNDS_MAX, 'rounds') : ''),
      f.tournament === 'swiss' ? 'Players with the same record meet.' : f.tournament === 'roundrobin' ? 'Everyone plays everyone once, at any time.'
        : 'Play whoever is free and new to you, as often as you like.')}
    ${row('Rules', seg('Rules', 'rules', [['casual', 'Casual'], ['competitive', 'Competitive']], f.rules))}
    ${row('Best of', seg('Best of', 'bestOf', [['1', '1 game'], ['3', '3 games']], String(f.bestOf)))}
    ${row('Start', start, f.start === 'time' ? esc(v.startText) : 'You start the draft from the event page.')}
  </div>`;
}

/** why the form cannot be sent, or '' */
export function formProblem(f: CubeForm, pool: number, fullOk: boolean): string {
  if (f.source === 'elements' && !f.elements.length) return 'Pick at least one element';
  if (!pool) return f.source === 'list' ? 'Paste a list first' : 'No cards in those elements';
  if (!fullOk) return 'Too few cards for a full table';
  return '';
}

function formFooterHtml(v: CubePageView, f: CubeForm, kind: 'new' | 'edit'): string {
  const m = v.formMath!;
  const why = formProblem(f, m.pool, m.full.ok);
  return `${button({ label: kind === 'new' ? 'Create event' : 'Save', variant: 'primary', dataBtn: kind === 'new' ? 'cube-create' : 'cube-save',
    disabled: !!why || v.busy, title: why || undefined })}${button({ label: 'Cancel', dataBtn: 'cube-sheet-close' })}
    ${why ? `<span class="cubewhy">${esc(why)}</span>` : ''}
    ${v.msg ? statusMessage({ tone: v.msgTone, text: v.msg, className: 'cubemsg' }) : ''}`;
}

// ── the home card and the Join sheet (docs/25 §10) ────────────────────

/** The home's Cube draft card body: my events at a glance ('' with none). Pure, no buttons. */
export function cubeGlanceHtml(rows: readonly CubeMine[]): string {
  if (!rows.length) return '';
  return `<ul class="cubeglance">${rows.slice(0, 3).map(r => `<li><b>${esc(r.name)}</b> <span class="dim">${esc(
    r.myMatch && r.myMatch.status !== 'done' ? (r.myMatch.status === 'live' ? 'your match is on' : 'your match is ready') : PHASE_WORDS[r.phase])}</span></li>`).join('')}${
    rows.length > 3 ? `<li class="dim">and ${rows.length - 3} more</li>` : ''}</ul>`;
}

/** The Join sheet's "Your cube events" rows, each with its Open; '' when none. Pure. */
export function cubeJoinRowsHtml(rows: readonly CubeMine[]): string {
  if (!rows.length) return '';
  return `<div class="cubejoinrows">${rows.map(r => `<div class="cubejoinrow">
    <span><b>${esc(r.name)}</b> <span class="dim">· ${esc(r.code)} · ${esc(mineLine(r))}</span></span>
    ${button({ label: r.myMatch && r.myMatch.status !== 'done' ? 'Play' : 'Open', variant: r.myMatch && r.myMatch.status !== 'done' ? 'primary' : 'secondary',
      size: 'sm', dataBtn: 'cube-open', attrs: { 'data-code': r.code } })}
  </div>`).join('')}</div>`;
}

// ── painting ──────────────────────────────────────────────────────────

/** what the page's wiring may write back to ui/cube.ts */
export interface CubeHooks {
  /** a form box changed (the name, the pasted list) */
  typed(id: 'name' | 'list', value: string): void;
  /** the list box changed: repaint the numbers */
  repaint(): void;
}

const TYPED = ['cube-f-name', 'cube-f-list'] as const;

/** Put the page on screen, the typing boxes' caret where it was. */
export function paintCube(app: HTMLElement, v: CubePageView, hooks: CubeHooks): void {
  const caret = caretIn(TYPED);
  paintFrame(app, cubeHtml(v));
  restoreCaret(caret);
  const name = document.getElementById('cube-f-name') as HTMLInputElement | null;
  name?.addEventListener?.('input', () => hooks.typed('name', name.value));
  const list = document.getElementById('cube-f-list') as HTMLTextAreaElement | null;
  // the pack line follows the list as it is typed or pasted (the caret is carried over the repaint)
  list?.addEventListener?.('input', () => { hooks.typed('list', list.value); hooks.repaint(); });
}
