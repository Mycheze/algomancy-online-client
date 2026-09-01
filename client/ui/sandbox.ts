/* BL-06 — TEST MODE: the sandbox controls.
 *
 * The owner: *"Test mode (summon any card, make any mana, no opponent, 1000
 * life)"*, and why: *"you can see how cards interact, try new combos and
 * such."* Two uses and he named both — testing the engine, and card
 * interaction exploration. So this is a panel a PLAYER can use, not a debug
 * console with a JSON box in it.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT DO ──────────────────────────────
 *
 * It never decides whether it is a sandbox room. `state().sandbox` is a field
 * of the authoritative GameState, set at the DEAL by server/scenarios.ts and
 * never by an action, and the browser only ever sees it because the server
 * pushed it (`viewFor` structuredClones the state, so the flag rides in the
 * redacted view). No client-side flag, no query parameter and no localStorage
 * key can make these controls appear over a real game — the same fail-closed
 * shape as ui/scenario.ts, and for the same reason.
 *
 * And it never mutates anything. Every control here sends an ACTION through
 * main.ts's `act()` — the same funnel a click on a card goes through — so a
 * sandbox game is a seed plus a log like any other game, and replays like one.
 * That is the whole architectural point of the mode: the first thing anybody
 * will do with test mode is reproduce a bug and hand somebody the room code.
 *
 * ── WHY IT PAINTS OUTSIDE #app ───────────────────────────────────────────
 *
 * `ui/main.ts` is the file most likely to collide when several people are
 * working at once, and this feature could easily have wanted fifty lines in
 * it. It gets two: one import and one `installSandbox({…})` call. Everything
 * else lives here — the panel is appended to `document.body`, its styles are
 * injected by this module, its clicks are claimed by a `data-sbx` attribute
 * that main.ts's global `[data-btn]` listener does not match, and it repaints
 * itself off a MutationObserver on `#app` rather than from a render hook.
 *
 * The one thing that DOES go inside `#app` is the home-screen launcher, and it
 * is put there by the same observer: the button is appended to the home
 * screen's "On your own" row the moment that row appears, so test mode is
 * started from the home screen without renderHome() knowing this file exists.
 */
import { allCardNames } from '../engine/src/cards/dsl.ts';
import type { Action, GameState, ResourceKind, Seat } from '../engine/src/types.ts';
import { search as runSearch } from './cardsearch.ts';
import type { CardRow } from './cardindex.ts';
import { esc } from './util.ts';

/** Everything this panel needs from main.ts, as callbacks — so the hook over
 * there is one statement and this module holds no state of main's. */
export interface SandboxCtx {
  /** the state this client is rendering, or null before one arrives */
  state: () => GameState | null;
  /** this client's seat, or null (hotseat / home screen) */
  seat: () => Seat | null;
  /** the room code, or null outside a network game */
  room: () => string | null;
  /** main.ts's `act()` — THE funnel every engine action goes through */
  act: (a: Action) => void;
}

/** The resource kinds the mana editor offers, DERIVED from the state's own
 * element list rather than typed out here (derive, never enumerate: a
 * hand-listed row set would be missing an eighth element forever). The two
 * non-element kinds are appended because they are the rest of `ResourceKind`
 * and there is nowhere else to read them from. */
function kindsFor(s: GameState): ResourceKind[] {
  return [...s.elements, 'prismite', 'shard'] as ResourceKind[];
}

let ctx: SandboxCtx | null = null;
let root: HTMLElement | null = null;

// ── local, unsent state ──────────────────────────────────────────────────
//
// Held in module scope rather than in the DOM for the reason ui/scenario.ts
// gives: a server push repaints, and a half-typed search must survive it.

/** the card search box */
let query = '';
/** which zone the search results spawn into */
let zone: 'hand' | 'play' | 'bin' = 'hand';
/** the mana pool being edited, per kind. null = "adopt whatever the board
 * says", which is what a fresh join and a seat change both want. */
let pool: Partial<Record<ResourceKind, number>> | null = null;
/** the life box's draft, as typed */
let lifeDraft = '';
/** the whole panel is rolled up */
let collapsed = false;
/** the last thing that happened, shown in the panel rather than as a toast */
let status = '';
/** what the last repaint was drawn from — a cheap signature, so an ordinary
 * server push does not rebuild the DOM (and eat the search box's caret) */
let painted = '';

const MAX_RESULTS = 40;

// ── the search ───────────────────────────────────────────────────────────

/**
 * Every card that can be summoned: the SPAWNABLE pool.
 *
 * `allCardNames()` is the authority, because it is what `getCard` — and so
 * `sandboxSpawn` — will actually accept. `allRows()` (which the search runs
 * over) is the catalogue ∪ the registry, so intersecting here is what
 * guarantees every result on screen is a card the engine can really put on the
 * board, rather than a browse-only row that would come back refused.
 *
 * ⚠ BL-25's note, which cost that ticket the most: `src/apply.ts` registers a
 * synthetic card, so `allCardNames()` answers a different number depending on
 * whether apply.ts has been imported yet. main.ts imports it, so the browser
 * always sees the full list — but do not trust a count taken from this module
 * in isolation.
 */
function spawnable(): Set<string> {
  if (!SPAWNABLE) SPAWNABLE = new Set(allCardNames());
  return SPAWNABLE;
}
let SPAWNABLE: Set<string> | null = null;

/**
 * Matches for the current query, over THE WHOLE REGISTRY.
 *
 * This is `ui/cardsearch.ts` — the card browser's own query engine — over an
 * unfiltered pool, which is exactly what BL-25's note asks the next reader to
 * do ("reuse rather than rebuild"). It costs nothing and it buys the whole
 * query language: `t:unit`, `e:fire`, `p>5`, `a:flying`, quoted phrases. A
 * hand-rolled substring filter here would have been a second, worse search
 * over the same index.
 *
 * `implicit: false` evaluates the query exactly as written: the browser's
 * implicit `class:card` narrowing is a browse convenience, and in a sandbox
 * "any card" means any card.
 */
function matches(): { rows: CardRow[]; total: number } {
  const pool = spawnable();
  const res = runSearch(query.trim(), { implicit: false });
  const rows = res.rows.filter(r => pool.has(r.name));
  return { rows, total: rows.length };
}

/** the one-line "2 · 1/3 · fire" summary under a card name in the results */
function cardLine(r: CardRow): string {
  const cost = r.isX ? 'X' : String(r.mana);
  const body = r.kind === 'spell' ? 'spell' : `${r.power}/${r.toughness}`;
  return `${cost} · ${body}${r.factions.length ? ` · ${r.factions.join('/')}` : ''}`;
}

// ── the panel ────────────────────────────────────────────────────────────

/** Is there a sandbox to draw controls for right now? */
function active(): GameState | null {
  const s = ctx?.state() ?? null;
  return s && s.sandbox === true && ctx!.seat() !== null ? s : null;
}

/** The mana pool as the BOARD currently has it — what the editor adopts when
 * it has no draft of its own. Counts open resources only, which is what the
 * `sandboxResources` action sets. */
function boardPool(s: GameState, seat: Seat): Partial<Record<ResourceKind, number>> {
  const out: Partial<Record<ResourceKind, number>> = {};
  for (const r of s.players[seat]!.resources) {
    if (r.state !== 'open') continue;
    out[r.kind] = (out[r.kind] ?? 0) + 1;
  }
  return out;
}

function panelHtml(s: GameState, seat: Seat, room: string | null): string {
  const other = seat === 0 ? 1 : 0;
  const head = `<div class="sbxhead" data-sbx="collapse" title="roll the panel up">
    <span class="sbxglyph">🧪</span><b>Test mode</b>
    <span class="sbxroom">${room ? esc(room) : 'local'} · seat ${seat + 1}</span>
    <span class="sbxchev">${collapsed ? '▸' : '▾'}</span></div>`;
  if (collapsed) return head;

  const hits = matches();
  const results = hits.rows.slice(0, MAX_RESULTS).map(r =>
    `<button class="sbxhit" data-sbx="spawn" data-card="${esc(r.name)}"
      title="put ${esc(r.name)} into your ${zone === 'play' ? 'board' : zone}">
      <span class="sbxhitname">${esc(r.name)}</span><span class="sbxhitmeta">${esc(cardLine(r))}</span></button>`).join('');

  const p = pool ?? boardPool(s, seat);
  const manaRows = kindsFor(s).map(k => `<div class="sbxmana">
      <span class="sbxkind">${esc(k)}</span>
      <button data-sbx="mana-" data-kind="${esc(k)}">−</button>
      <span class="sbxn">${p[k] ?? 0}</span>
      <button data-sbx="mana+" data-kind="${esc(k)}">+</button>
    </div>`).join('');

  // the second seat is a REAL seat: the owner asked for it to be openable in
  // another tab precisely so one screen does not carry two sets of cheats
  const otherHref = room ? `/?ws=1&amp;room=${encodeURIComponent(room)}&amp;seat=${other}` : '';
  const otherLine = room
    ? `<a class="sbxtab" href="${otherHref}" target="_blank" rel="noopener">↗ open seat ${other + 1} in a new tab</a>
       <div class="sbxhint">Stock it exactly the same way. While nobody is sitting there the
       table closes its steps by itself, so you never need a second player.</div>`
    : '';

  return `${head}
  <div class="sbxbody">
    <div class="sbxsec">
      <div class="sbxlabel">Summon — any of the ${spawnable().size} cards</div>
      <div class="sbxzones">
        ${(['hand', 'play', 'bin'] as const).map(z =>
          `<button class="sbxzone${z === zone ? ' on' : ''}" data-sbx="zone" data-zone="${z}">${z === 'play' ? 'board' : z}</button>`).join('')}
      </div>
      <input id="sbx-q" class="sbxq" placeholder="name, or t:unit e:fire p&gt;5" spellcheck="false">
      <div class="sbxhits">${results || '<div class="sbxhint">nothing matches that</div>'}</div>
      ${hits.total > MAX_RESULTS
        ? `<div class="sbxhint">${hits.total - MAX_RESULTS} more — keep typing</div>` : ''}
    </div>

    <div class="sbxsec">
      <div class="sbxlabel">Mana &amp; affinity</div>
      <div class="sbxmanas">${manaRows}</div>
      <div class="sbxrow">
        <button class="sbxgo" data-sbx="mana-set">Set mana</button>
        <button data-sbx="mana-all">all 5</button>
        <button data-sbx="mana-none">none</button>
      </div>
    </div>

    <div class="sbxsec">
      <div class="sbxlabel">Life — ${s.players[seat]!.life}</div>
      <div class="sbxrow">
        <input id="sbx-life" class="sbxlife" inputmode="numeric" placeholder="${s.players[seat]!.life}">
        <button class="sbxgo" data-sbx="life-set">Set</button>
        <button data-sbx="life-1000">1000</button>
      </div>
    </div>

    <div class="sbxsec">
      <div class="sbxlabel">Phase — ${esc(s.phase)}${s.battleRound ? ` (round ${s.battleRound})` : ''}, turn ${s.turn}</div>
      <div class="sbxrow">
        <button class="sbxgo" data-sbx="advance">⏭ next phase</button>
      </div>
      <div class="sbxhint">Closes the step for both seats with real actions — every trigger and
        every end-of-step still runs. It stops on a question rather than answering it for you.</div>
    </div>

    <div class="sbxsec">${otherLine}</div>
    ${status ? `<div class="sbxstatus">${esc(status)}</div>` : ''}
  </div>`;
}

// ── clicks ───────────────────────────────────────────────────────────────

function onClick(ev: MouseEvent): void {
  const target = ev.target as HTMLElement;
  const inPanel = !!target.closest('#sbx-root');
  const btn = target.closest('[data-sbx]') as HTMLElement | null;
  if (!inPanel && !btn) return;
  // main.ts's global listener matches `[data-btn]`, and then — in a game —
  // falls through to a bare `render()` for any click it does not recognise.
  // Every click in this panel is ours, including the ones on its chrome.
  ev.stopPropagation();
  if (!btn) return;
  // …but never swallow the "open seat 2" link's own navigation
  if (btn.tagName !== 'A') ev.preventDefault();
  const what = btn.dataset['sbx'];

  if (what === 'open') { openSandbox(btn); return; }

  const s = active();
  const seat = ctx?.seat() ?? null;
  if (!s || seat === null || !ctx) return;

  if (what === 'collapse') { collapsed = !collapsed; repaint(true); return; }
  if (what === 'zone') {
    zone = (btn.dataset['zone'] as typeof zone) ?? 'hand';
    repaint(true);
    return;
  }
  if (what === 'spawn') {
    const card = btn.dataset['card'] ?? '';
    ctx.act({ type: 'sandboxSpawn', seat, card, to: zone });
    status = `${card} → ${zone === 'play' ? 'board' : zone}`;
    repaint(true);
    return;
  }
  if (what === 'mana+' || what === 'mana-') {
    const kind = btn.dataset['kind'] as ResourceKind;
    const next = { ...(pool ?? boardPool(s, seat)) };
    next[kind] = Math.max(0, Math.min(99, (next[kind] ?? 0) + (what === 'mana+' ? 1 : -1)));
    pool = next;
    repaint(true);
    return;
  }
  if (what === 'mana-all' || what === 'mana-none') {
    const next: Partial<Record<ResourceKind, number>> = {};
    for (const k of kindsFor(s)) next[k] = what === 'mana-all' ? 5 : 0;
    pool = next;
    repaint(true);
    return;
  }
  if (what === 'mana-set') {
    const next = pool ?? boardPool(s, seat);
    ctx.act({ type: 'sandboxResources', seat, pool: next });
    // the draft is released: the board is about to BE the draft, and holding
    // it would leave the editor showing a pool the table no longer has after
    // the next recycle or activation
    pool = null;
    status = 'mana set';
    repaint(true);
    return;
  }
  if (what === 'life-set' || what === 'life-1000') {
    const typed = lifeDraft.trim();
    // an EMPTY box is not zero. `Number('')` is 0, so without this line
    // pressing Set with nothing typed would put the seat on 0 life and end the
    // game — the one destructive thing on this panel, from the one click
    // nobody means to make.
    if (what === 'life-set' && !typed) { status = 'type a number first'; repaint(true); return; }
    const raw = what === 'life-1000' ? 1000 : Number(typed);
    if (!Number.isFinite(raw)) { status = 'that is not a number'; repaint(true); return; }
    ctx.act({ type: 'sandboxLife', seat, life: Math.max(0, Math.floor(raw)) });
    lifeDraft = '';
    status = `life → ${Math.max(0, Math.floor(raw))}`;
    repaint(true);
    return;
  }
  if (what === 'advance') {
    ctx.act({ type: 'sandboxAdvance', seat });
    status = '';
    repaint(true);
    return;
  }
}

/** The home-screen launcher: deal a sandbox room and go to it. */
function openSandbox(btn: HTMLElement): void {
  btn.setAttribute('disabled', 'disabled');
  btn.textContent = 'dealing…';
  fetch('/api/sandbox/open?json=1')
    .then(r => r.json())
    .then((r: { ok?: boolean; join?: string; error?: string }) => {
      if (r.ok && r.join) { location.href = r.join; return; }
      btn.removeAttribute('disabled');
      btn.textContent = `test mode — ${r.error ?? 'the server refused'}`;
    })
    .catch(() => {
      btn.removeAttribute('disabled');
      btn.textContent = 'test mode — could not reach the server';
    });
}

// ── painting ─────────────────────────────────────────────────────────────

/** Put the search box's text and listeners back after a rebuild — the same
 * job, and the same reason, as ui/scenario.ts's `rewire()`. */
function rewire(): void {
  const q = document.getElementById('sbx-q') as HTMLInputElement | null;
  if (q) {
    q.value = query;
    q.addEventListener('input', () => { query = q.value; repaint(true); });
  }
  const life = document.getElementById('sbx-life') as HTMLInputElement | null;
  if (life) {
    life.value = lifeDraft;
    life.addEventListener('input', () => { lifeDraft = life.value; });
  }
}

/**
 * Repaint if anything visible changed.
 *
 * `force` is for our OWN clicks, which change local state the signature knows
 * nothing about. Everything else goes through the signature, so the dozens of
 * server pushes a turn cost one string compare each and never rebuild the DOM
 * under a caret.
 */
function repaint(force = false): void {
  if (!root || !ctx) return;
  const s = active();
  const seat = ctx.seat();
  if (!s || seat === null) {
    if (root.innerHTML) { root.innerHTML = ''; painted = ''; }
    root.classList.remove('on');
    homeLauncher();
    return;
  }
  const sig = JSON.stringify([
    s.actionCount, s.phase, s.turn, s.battleRound, seat, ctx.room(),
    s.players[seat]!.life, boardPool(s, seat), query, zone, pool, collapsed, status,
  ]);
  if (!force && sig === painted) return;
  painted = sig;
  root.classList.add('on');
  const q = document.getElementById('sbx-q') as HTMLInputElement | null;
  const caret = q ? q.selectionStart : null;
  root.innerHTML = panelHtml(s, seat, ctx.room());
  rewire();
  if (caret !== null) {
    const next = document.getElementById('sbx-q') as HTMLInputElement | null;
    next?.focus();
    next?.setSelectionRange(caret, caret);
  }
  homeLauncher();
}

/**
 * The home screen's "Test mode" button, put into the page rather than painted
 * over it.
 *
 * It goes in `.homesolo` — the "On your own" row that already holds Local
 * hotseat and Practice demo, which is exactly what this is — so it reads as
 * part of the menu instead of as a floating debug affordance. Appended by the
 * observer whenever that row appears, and idempotent, so `renderHome()` can
 * repaint as often as it likes without this file being wired into it.
 */
function homeLauncher(): void {
  const row = document.querySelector('.homesolo');
  if (!row) return;
  if (row.querySelector('[data-sbx="open"]')) return;
  const b = document.createElement('button');
  b.setAttribute('data-sbx', 'open');
  b.title = 'a solo sandbox: any card, any mana, 1000 life — and the rules still apply to what you build';
  b.textContent = 'Test mode';
  row.appendChild(b);
}

const CSS = `
#sbx-root { position: fixed; top: 56px; right: 8px; width: 306px; max-height: calc(100vh - 72px);
  overflow: auto; z-index: 90; font: 12px/1.4 system-ui, sans-serif; }
#sbx-root:not(.on) { display: none; }
#sbx-root .sbxhead { display: flex; align-items: center; gap: 6px; cursor: pointer;
  background: #1d2330; color: #e8ecf4; border: 1px solid #3a4759; border-radius: 6px 6px 0 0;
  padding: 6px 8px; }
#sbx-root .sbxhead b { font-weight: 600; }
#sbx-root .sbxroom { margin-left: auto; opacity: .6; font-size: 11px; }
#sbx-root .sbxchev { opacity: .6; }
#sbx-root .sbxbody { background: #141922; color: #d7dee8; border: 1px solid #3a4759; border-top: 0;
  border-radius: 0 0 6px 6px; padding: 8px; }
#sbx-root .sbxsec { margin-bottom: 10px; }
#sbx-root .sbxsec:last-child { margin-bottom: 0; }
#sbx-root .sbxlabel { font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
  opacity: .55; margin-bottom: 4px; }
#sbx-root .sbxhint { font-size: 11px; opacity: .5; margin-top: 4px; }
#sbx-root button { font: inherit; background: #263041; color: #d7dee8; border: 1px solid #3a4759;
  border-radius: 4px; padding: 3px 7px; cursor: pointer; }
#sbx-root button:hover { background: #33405a; }
#sbx-root button[disabled] { opacity: .5; cursor: default; }
#sbx-root .sbxgo { background: #2f5d8a; border-color: #4b83bb; }
#sbx-root .sbxzones { display: flex; gap: 4px; margin-bottom: 4px; }
#sbx-root .sbxzone.on { background: #2f5d8a; border-color: #4b83bb; }
#sbx-root .sbxq, #sbx-root .sbxlife { font: inherit; width: 100%; box-sizing: border-box;
  background: #0d1119; color: #e8ecf4; border: 1px solid #3a4759; border-radius: 4px; padding: 4px 6px; }
#sbx-root .sbxlife { width: 84px; }
#sbx-root .sbxhits { max-height: 190px; overflow: auto; margin-top: 4px;
  border: 1px solid #29323f; border-radius: 4px; }
#sbx-root .sbxhit { display: block; width: 100%; text-align: left; border: 0; border-radius: 0;
  border-bottom: 1px solid #222b37; padding: 3px 6px; }
#sbx-root .sbxhitname { display: block; }
#sbx-root .sbxhitmeta { display: block; font-size: 10px; opacity: .45; }
#sbx-root .sbxmanas { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; }
#sbx-root .sbxmana { display: flex; align-items: center; gap: 3px; }
#sbx-root .sbxkind { flex: 1; opacity: .8; }
#sbx-root .sbxn { min-width: 16px; text-align: center; }
#sbx-root .sbxrow { display: flex; gap: 4px; align-items: center; margin-top: 4px; }
#sbx-root .sbxtab { color: #7fb3e8; }
#sbx-root .sbxstatus { border-top: 1px solid #29323f; padding-top: 6px; opacity: .75; }
`;

/**
 * Install the panel. TWO LINES in main.ts — an import and this call.
 *
 * Safe to call once; a second call is ignored, so a hot reload cannot end up
 * with two panels claiming the same clicks.
 */
export function installSandbox(next: SandboxCtx): void {
  if (root) return;
  /* ⚠ THE FAKE BROWSER. `engine/test/ui-driver.ts` gives main.ts "the smallest
   * browser it will accept" — a `document` with `getElementById`, an
   * `innerHTML` string and a click delegator, and nothing else. It has no
   * `head`, no `body` and no MutationObserver, and it says so on purpose:
   * anything the client asks for that the fake cannot answer throws a
   * TypeError naming the call.
   *
   * This module is the first thing in the client to paint OUTSIDE #app, so it
   * is the first to ask. It declines rather than throwing, because the honest
   * answer is that there is nowhere for this panel to live in that fake and
   * none of the 33 tests that use it is about this panel. What it must not
   * become is a silent no-op in a REAL browser — so `275-sandbox-panel.test.ts`
   * hands it a document that does have these pieces and asserts it installs.
   */
  const d = document as Partial<Document>;
  if (!d.head || !d.body || typeof d.createElement !== 'function'
    || typeof globalThis.MutationObserver !== 'function') return;
  ctx = next;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  root = document.createElement('div');
  root.id = 'sbx-root';
  document.body.appendChild(root);
  // capture, and on the root/document rather than inside #app: this listener
  // must claim its own clicks before main.ts's document listener sees them
  document.addEventListener('click', onClick, true);
  // No render hook. #app is rewritten on every push and on every home-screen
  // repaint, so watching it is the same signal a hook would have carried —
  // and it costs main.ts nothing.
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => repaint()).observe(app, { childList: true, subtree: true });
  repaint();
}
