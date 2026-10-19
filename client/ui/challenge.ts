/* THE WEEKLY CHALLENGE PAGE (docs/21-weekly-challenges.md § Browser).
 *
 * Same contract as ui/league.ts and ui/meta.ts, which main.ts already drives:
 * screen() says whether this page owns the app element, renderScreen() paints
 * it, handleButton() is offered every click (everything here is `ch-`), and
 * the state lives in this file. `?challenge` opens it, and so does the
 * `nav-challenge` button — the owner uses an installed web app with no
 * address bar, so a page reachable only by URL is a page he cannot reach.
 *
 * Everything shown is the server's answer (server/api-challenge.ts): the
 * week, its par, the boards, the caller's bests. The two things this page
 * owns are the BUILDER (ui/challengebuild.ts, an ordered deck kept per
 * challenge in this browser) and the hand-off to a run (ui/challengerun.ts,
 * which main.ts opens at `?challenge=play`).
 *
 * The home page's card and the header button are drawn from one fetch of
 * GET /api/challenge, asked the first time the home page draws and never at
 * boot: a game or replay link makes no request it has no use for.
 */
import type { CardName } from '../engine/src/types.ts';
import { CATEGORIES, goalText, type Category, type ChallengeDef, type RunScore } from '../engine/src/challenge.ts';
import * as acct from './account.ts';
import * as cb from './cards.ts';
import * as dk from './decks.ts';
import {
  blockCut, blockDown, blockLess, blockMore, blockUp, bridgeFor, builderHtml, loadDraft, moveBlock, saveDraft,
} from './challengebuild.ts';
import {
  CATEGORY_LABEL, canSubmit, statCell, doneRuns, forgetDone, freshRun, submitRun, type DoneRun, type SubmitReply,
} from './challengerun.ts';
import { chosenDeck, esc } from './util.ts';

// ── the server's shapes (server/api-challenge.ts, server/challenge-store.ts) ──

export type ChallengeView = ChallengeDef & { opens: number; closes: number; closed: boolean; entrants: number; par?: RunScore };
export interface BoardRow { rank: number; name: string; score: RunScore; at: number; runId?: string; deck?: CardName[] }
export interface BoardReply { id: string; by: Category; closed: boolean; rows: BoardRow[]; winner?: BoardRow }
export interface ChallengeReply {
  now: number;
  current: ChallengeView | null;
  past: ChallengeView[];
  mine?: Record<string, Partial<Record<Category, RunScore>>>;
}

// ── module state ──────────────────────────────────────────────────────

let $app: HTMLElement | null = null;
let rerenderHost: () => void = () => {};
let open = false;
let data: ChallengeReply | null = null;
/** the session token `data` was asked with: a sign-in asks again (for `mine`) */
let dataFor: string | null | undefined;
/** server clock minus ours, from the last answer, so "time left" is the server's */
let skew = 0;
let loading = false;
let msg = '';
/** the home card's copy, and the token it was asked with */
let hint: ChallengeReply | null = null;
let hintFor: string | null | undefined;
/** boards, by `${id}:${category}` */
const boards = new Map<string, BoardReply | 'loading' | 'error'>();
/** the category each challenge's board shows */
const tab = new Map<string, Category>();
/** the past week whose board is unfolded */
let pastOpen: string | null = null;
/** the builder: which challenge it builds for, and its list */
let building: string | null = null;
let list: string[] = [];
let importing = false;
/** one step back from a replace (import, clear, try this deck): the list
 * before it, for that challenge, and what to call it. Any other edit drops it. */
let undo: { id: string; list: string[]; what: string } | null = null;
/** a kept run's upload, by its `at` */
const sending = new Map<number, 'sending' | SubmitReply>();

export const screen = (): 'challenge' | null => (open ? 'challenge' : null);

export function initChallenge(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  const url = new URLSearchParams(location.search);
  const v = url.get('challenge');
  // `?challenge=play` and `?challenge=watch` are game pages main.ts opens
  if (url.has('challenge') && v !== 'play' && v !== 'watch') {
    open = true;
    if (v && v !== '1') building = v;
    // back from Watch: that week's board, unfolded
    pastOpen = url.get('board');
    load();
    // a run's goal panel, signed out: the sign-in form, then this page, which
    // submits the kept run (sendKept) once there is an account
    if (url.get('signin') === '1') acct.signInThenReturn();
  }
}

/** the challenges this page knows, newest first */
const allViews = (d: ChallengeReply | null): ChallengeView[] => (d ? [...(d.current ? [d.current] : []), ...d.past] : []);
const viewOf = (id: string | null): ChallengeView | null => allViews(data ?? hint).find(c => c.id === id) ?? null;

function load(): void {
  loading = true;
  const tok = acct.token();
  fetch('/api/challenge', { headers: acct.authHeaders(false) })
    .then(r => r.json() as Promise<ChallengeReply>)
    .then(r => {
      loading = false;
      if (!r || typeof r.now !== 'number') { msg = 'could not load the challenges'; paint(); return; }
      data = r; dataFor = tok;
      hint = r; hintFor = tok;
      skew = r.now - Date.now();
      if (building && !viewOf(building)) building = null;
      if (building && !list.length) list = loadDraft(building);
      if (pastOpen && !r.past.some(c => c.id === pastOpen)) pastOpen = null;
      if (pastOpen && !boards.has(`${pastOpen}:${tabOf(pastOpen)}`)) loadBoard(pastOpen, tabOf(pastOpen));
      const cur = r.current;
      if (cur && !boards.has(`${cur.id}:${tabOf(cur.id)}`)) loadBoard(cur.id, tabOf(cur.id));
      sendKept();
      paint();
    })
    .catch(() => { loading = false; msg = 'could not reach the server'; paint(); });
}

/** The home card's data, asked the first time the home page draws. */
function askHint(): void {
  const tok = acct.token();
  if (hintFor === tok) return;
  hintFor = tok;
  fetch('/api/challenge', { headers: acct.authHeaders(false) })
    .then(r => r.json() as Promise<ChallengeReply>)
    .then(r => {
      if (!r || typeof r.now !== 'number') return;
      const had = !!hint;
      hint = r;
      skew = r.now - Date.now();
      if ((had || r.current || r.past.length) && !open) rerenderHost();
    })
    .catch(() => { /* no server, no card */ });
}

const tabOf = (id: string): Category => tab.get(id) ?? 'skill';

function loadBoard(id: string, by: Category): void {
  const key = `${id}:${by}`;
  boards.set(key, 'loading');
  fetch(`/api/challenge/${encodeURIComponent(id)}/board?by=${by}`)
    .then(r => r.json() as Promise<BoardReply>)
    .then(r => { boards.set(key, r && Array.isArray(r.rows) ? r : 'error'); paint(); })
    .catch(() => { boards.set(key, 'error'); paint(); });
}

/** Runs finished in this browser and not on a board yet: send them once
 * there is a named account to send them as. */
function sendKept(): void {
  if (!canSubmit()) return;
  for (const d of doneRuns()) {
    if (sending.has(d.at) || !viewOf(d.challengeId)) continue;
    sending.set(d.at, 'sending');
    void submitRun(d).then(r => {
      sending.set(d.at, r);
      if (r.ok) {
        forgetDone(d.at);
        boards.delete(`${d.challengeId}:${tabOf(d.challengeId)}`);
        load();
      } else paint();
    });
  }
}

export function openChallenge(build?: string): void {
  open = true; msg = ''; importing = false;
  if (build !== undefined) { building = build; list = loadDraft(build); }
  syncUrl();
  load();
  paint();
}

/** Something about the challenges changed (a sign-in): ask again. */
export function refresh(): void {
  if (open) load();
  hintFor = undefined;
}

function close(): void {
  open = false; importing = false;
  syncUrl();
  rerenderHost();
}

function syncUrl(): void {
  try {
    const url = new URL(location.href);
    url.searchParams.delete('challenge');
    url.searchParams.delete('board');
    url.searchParams.delete('signin');
    if (open) url.searchParams.set('challenge', building ?? '1');
    history.replaceState(null, '', url.toString());
  } catch { /* file:// */ }
}

// ── formatting ────────────────────────────────────────────────────────

/** "3d 4h left", "5h 12m left" — the server's clock, not this machine's */
export function timeLeft(closes: number, now = Date.now() + skew): string {
  const ms = Math.max(0, closes - now);
  const m = Math.floor(ms / 60_000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (ms <= 0) return 'closed';
  return d ? `${d}d ${h % 24}h left` : h ? `${h}h ${m % 60}m left` : `${Math.max(1, m)}m left`;
}

const scoreLine = (s: RunScore): string =>
  `Skill ${s.skill} · ${s.cards} card${s.cards === 1 ? '' : 's'} · ${s.elements} element${s.elements === 1 ? '' : 's'} · ${s.turns} turn${s.turns === 1 ? '' : 's'}`;

// ── the home page ─────────────────────────────────────────────────────

/** The header's way in, while there is a challenge to show. */
export function navButtonHtml(): string {
  askHint();
  if (!hint || (!hint.current && !hint.past.length)) return '';
  return '<button class="homedecks" data-btn="nav-challenge">🧩 Challenge</button>';
}

/** "This week's challenge": hidden when there is none or no server. */
export function homeCardHtml(): string {
  askHint();
  const c = hint?.current;
  if (!c) return '';
  const best = hint?.mine?.[c.id]?.skill;
  return `<div class="homecard chhome">
    <h2>This week's challenge</h2>
    <p class="cardsub"><b>${esc(goalText(c.goal))}</b></p>
    <p class="cardsub">${esc(timeLeft(c.closes))}${best ? ` · your best: Skill ${best.skill}` : ''}</p>
    <div class="spacer"></div>
    <button class="cta primary" data-btn="ch-home-play" data-id="${esc(c.id)}">Play</button>
  </div>`;
}

// ── the page ──────────────────────────────────────────────────────────

function bestsHtml(id: string): string {
  const m = data?.mine?.[id];
  if (!m || !Object.keys(m).length) return '';
  return `<h4>Your bests</h4><div class="statgrid">${CATEGORIES.map(c => {
    const s = m[c];
    return statCell(CATEGORY_LABEL[c], s ? s[c] : '–');
  }).join('')}</div>`;
}

function weekCardHtml(c: ChallengeView): string {
  return `<div class="acctcard chweek">
    <h3>${esc(c.title)}</h3>
    <p class="chgoal">${esc(goalText(c.goal))}</p>
    ${c.blurb ? `<p>${esc(c.blurb)}</p>` : ''}
    <p class="dim">${esc(timeLeft(c.closes))} · ${c.entrants} entrant${c.entrants === 1 ? '' : 's'}</p>
    ${c.par ? `<p class="dim">Par: ${esc(scoreLine(c.par))}</p>` : ''}
    ${bestsHtml(c.id)}
    ${building === c.id ? '' : `<p><button class="primary" data-btn="ch-build" data-id="${esc(c.id)}">Build a deck</button></p>`}
  </div>`;
}

function boardHtml(c: ChallengeView, past = false): string {
  const by = tabOf(c.id);
  const b = boards.get(`${c.id}:${by}`);
  const tabs = `<div class="cbtools chtabs">${CATEGORIES.map(k =>
    `<button class="${k === by ? 'on' : ''}" data-btn="ch-tab" data-id="${esc(c.id)}" data-cat="${k}">${CATEGORY_LABEL[k]}</button>`).join('')}</div>`;
  let body: string;
  if (!b || b === 'loading') body = '<p class="dim">Loading…</p>';
  else if (b === 'error') body = '<p class="dim">Could not load the board.</p>';
  else if (!b.rows.length) body = '<p class="dim">No runs yet.</p>';
  else {
    const others = CATEGORIES.filter(k => k !== by && k !== 'skill');
    body = `${b.closed && b.winner ? `<p>Winner: <b>${esc(b.winner.name)}</b>, Skill ${b.winner.score.skill}</p>` : ''}
      <table class="accttable chboard"><thead><tr><th>#</th><th>player</th><th>${CATEGORY_LABEL[by]}</th>${
        by === 'skill' ? '' : '<th>Skill</th>'}${others.map(k => `<th>${CATEGORY_LABEL[k]}</th>`).join('')}${b.closed ? '<th></th>' : ''}</tr></thead>
      <tbody>${b.rows.map(r => `<tr><td>${r.rank}</td><td>${esc(r.name)}</td><td><b>${r.score[by]}</b></td>${
        by === 'skill' ? '' : `<td>${r.score.skill}</td>`}${others.map(k => `<td>${r.score[k]}</td>`).join('')}${
        b.closed ? `<td class="chrowbtns">${r.deck ? `<button data-btn="ch-try" data-id="${esc(c.id)}" data-run="${esc(r.runId ?? '')}" title="load this deck into the builder">Try this deck</button>` : ''}${
          r.runId ? `<button data-btn="ch-watch" data-run="${esc(r.runId)}">Watch</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table>`;
  }
  const head = past ? `${esc(c.title)} <span class="dim">· week of ${esc(c.week)}</span>` : 'Board';
  return `<div class="acctcard${b && b !== 'loading' && b !== 'error' && b.closed ? ' wide' : ''} chboardcard"><h3>${head}</h3>${tabs}${body}</div>`;
}

function pastHtml(d: ChallengeReply): string {
  if (!d.past.length) return '';
  return `<div class="acctcard wide"><h3>Past weeks</h3>
    <table class="accttable chpast"><tbody>${d.past.map(c => `<tr>
      <td>${esc(c.week)}</td><td><b>${esc(c.title)}</b> <span class="dim">${esc(goalText(c.goal))}</span></td>
      <td class="dim">${c.entrants} entrant${c.entrants === 1 ? '' : 's'}</td>
      <td class="chrowbtns"><button class="${pastOpen === c.id ? 'on' : ''}" data-btn="ch-past" data-id="${esc(c.id)}">Board</button>
        <button data-btn="ch-build" data-id="${esc(c.id)}">Build</button></td></tr>`).join('')}</tbody></table>
  </div>${pastOpen ? ((): string => { const c = d.past.find(x => x.id === pastOpen); return c ? boardHtml(c, true) : ''; })() : ''}`;
}

function keptHtml(): string {
  const kept = doneRuns().filter(r => viewOf(r.challengeId));
  if (!kept.length) return '';
  return `<div class="acctcard wide chkept"><h3>Finished runs</h3>
    ${kept.map(r => {
      const st = sending.get(r.at);
      return `<div class="chkeptrow"><b>${esc(r.title)}</b> <span class="dim">${esc(scoreLine(r.score))}</span>
        ${st === 'sending' ? '<span class="dim">Submitting…</span>'
          : st && !st.ok ? `<span class="chproblem">${esc(st.error ?? 'could not submit')}</span>` : ''}
        ${canSubmit()
          ? (st === 'sending' ? '' : `<button data-btn="ch-send" data-at="${r.at}">Submit</button>`)
          : '<button class="primary" data-btn="ch-signin">Sign in to submit</button>'}
        <button data-btn="ch-forget" data-at="${r.at}" title="drop this run">✕</button></div>`;
    }).join('')}
  </div>`;
}

/** the builder's decks to import: the collection's, else the one chosen on the home page */
function importable(): { id: string; name: string; cards: string[] }[] {
  const mine = dk.playableDecks();
  if (mine.length) return mine.map(d => ({ id: d.id, name: d.name, cards: d.cards }));
  const c = chosenDeck();
  return c ? [{ id: '__chosen', name: c.name, cards: c.cards }] : [];
}

function paint(): void {
  if (!$app || !open) return;
  $app.classList.remove('board');
  const cur = data?.current ?? null;
  const b = building ? viewOf(building) : null;
  $app.innerHTML = `<div class="metapage chpage">
    <div class="accthead">
      <div><h1>Weekly challenge</h1>
        <p class="hint">Build a deck in order, then reach the goal using as few cards, elements and turns as you can.</p></div>
      <div class="accthbtns"><button data-btn="ch-close">Back</button></div>
    </div>
    ${msg ? `<div class="acctmsg">${esc(msg)}</div>` : ''}
    ${loading && !data ? '<p class="dim">Loading…</p>' : ''}
    <div class="acctbody">
      ${keptHtml()}
      ${b ? `${b.id !== cur?.id ? `<div class="acctcard wide"><h3>${esc(b.title)}</h3><p class="chgoal">${esc(goalText(b.goal))}</p>${
        b.closed ? '<p class="dim">This week is closed. A run still goes on its board.</p>' : ''}</div>` : ''}
        ${builderHtml({ def: b, list, decks: importable(), importing, undo: undo?.id === b.id ? undo.what : null })}` : ''}
      ${data && !cur ? '<div class="acctcard"><h3>No challenge this week</h3><p>Check back on Sunday.</p></div>' : ''}
      ${cur ? weekCardHtml(cur) : ''}
      ${cur ? boardHtml(cur) : ''}
      ${data ? pastHtml(data) : ''}
    </div>
  </div>`;
  wireDrag();
}

/** a mouse can also drag a row; a finger has the ↑↓ buttons */
let dragFrom: number | null = null;
function wireDrag(): void {
  if (typeof document.querySelectorAll !== 'function') return;
  for (const row of Array.from(document.querySelectorAll<HTMLElement>('.chrow'))) {
    const at = Number(row.dataset['chblock']);
    row.addEventListener('dragstart', e => { dragFrom = at; e.dataTransfer?.setData('text/plain', String(at)); });
    row.addEventListener('dragover', e => { if (dragFrom !== null) e.preventDefault(); });
    row.addEventListener('drop', e => {
      e.preventDefault();
      if (dragFrom === null || dragFrom === at) { dragFrom = null; return; }
      setList(moveBlock(list, dragFrom, at));
      dragFrom = null;
    });
    row.addEventListener('dragend', () => { dragFrom = null; });
  }
}

function setList(next: string[], replacing?: string): void {
  undo = replacing && building ? { id: building, list: [...list], what: replacing } : null;
  list = next;
  if (building) saveDraft(building, list);
  paint();
}

/** Start a run of the builder's deck: saved for `?challenge=play`, then go. */
function play(id: string): void {
  const def = viewOf(id);
  if (!def) return;
  freshRun({ id: def.id, week: def.week, title: def.title, blurb: def.blurb, goal: def.goal, seed: def.seed }, list);
  location.search = `?challenge=play&id=${encodeURIComponent(id)}`;
}

// ── clicks ────────────────────────────────────────────────────────────

export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('ch-')) return false;
  const i = Number(btn.dataset['b']);
  const id = btn.dataset['id'] ?? '';
  if (b !== 'ch-import' && b !== 'ch-importdeck') importing = false;
  switch (b) {
    case 'ch-home-play': openChallenge(id || hint?.current?.id); return true;
    case 'ch-close': close(); return true;
    case 'ch-build': building = id; list = loadDraft(id); syncUrl(); paint(); return true;
    case 'ch-tab': {
      const cat = btn.dataset['cat'] as Category;
      if (!CATEGORIES.includes(cat)) return true;
      tab.set(id, cat);
      if (!boards.has(`${id}:${cat}`)) loadBoard(id, cat);
      paint();
      return true;
    }
    case 'ch-past':
      pastOpen = pastOpen === id ? null : id;
      if (pastOpen && !boards.has(`${id}:${tabOf(id)}`)) loadBoard(id, tabOf(id));
      paint();
      return true;
    case 'ch-try': {
      const bd = boards.get(`${id}:${tabOf(id)}`);
      const row = bd && typeof bd === 'object' ? bd.rows.find(r => r.runId === btn.dataset['run']) : null;
      if (!row?.deck) return true;
      if (building !== id) { building = id; list = loadDraft(id); }
      setList([...row.deck], `Loaded ${row.name}'s deck.`);
      syncUrl();
      return true;
    }
    case 'ch-watch':
      location.search = `?challenge=watch&run=${encodeURIComponent(btn.dataset['run'] ?? '')}`;
      return true;
    case 'ch-up': setList(blockUp(list, i)); return true;
    case 'ch-down': setList(blockDown(list, i)); return true;
    case 'ch-more': setList(blockMore(list, i)); return true;
    case 'ch-less': setList(blockLess(list, i)); return true;
    case 'ch-cut': setList(blockCut(list, i)); return true;
    case 'ch-clear': setList([], 'Cleared.'); return true;
    case 'ch-undo':
      if (undo && undo.id === building) { const back = undo.list; setList(back); }
      return true;
    case 'ch-import': importing = !importing; if (importing) dk.ensureCollection(paint); paint(); return true;
    case 'ch-importdeck': {
      const d = importable().find(x => x.id === btn.dataset['id']);
      importing = false;
      if (d) setList([...d.cards], `Imported ${d.name}.`); else paint();
      return true;
    }
    case 'ch-browse': {
      const def = building ? viewOf(building) : null;
      if (!def) return true;
      cb.useDeck(bridgeFor({
        title: def.title, list: () => list,
        set: l => { list = l; if (building) saveDraft(building, list); },
        back: () => { cb.useDeck(null); paint(); },
      }));
      cb.openBrowser();
      rerenderHost();
      return true;
    }
    case 'ch-play': if (building) play(building); return true;
    case 'ch-send': {
      const d = doneRuns().find(x => x.at === Number(btn.dataset['at']));
      if (d) { sending.delete(d.at); sendOne(d); }
      return true;
    }
    case 'ch-forget': forgetDone(Number(btn.dataset['at'])); paint(); return true;
    case 'ch-signin': acct.signInThenReturn(); return true;
  }
  return false;
}

function sendOne(d: DoneRun): void {
  sending.set(d.at, 'sending');
  paint();
  void submitRun(d).then(r => {
    sending.set(d.at, r);
    if (r.ok) { forgetDone(d.at); boards.clear(); load(); } else paint();
  });
}

export function renderScreen(): void {
  if (data && !loading && dataFor !== acct.token()) load();
  paint();
}

/** test seam: the builder's list as it stands */
export const builderList = (): readonly string[] => list;
