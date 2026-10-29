/* Ledger #25 (ZQPC, 2026-08-20) — "The spell tokens shouldn't get smushed in
 * with the units. They should have their own spot, over by the bin."
 *
 * WHY THIS FILE EXISTS
 *
 * #25 was closed against two guards in 70-playtest-round15.test.ts that were
 * written for a DIFFERENT report (#61, "let the box expand so they group
 * horizontally"). Both read ui/style.css and only ui/style.css: they check the
 * strip's flex arithmetic, so they answer "does the strip wrap two cards
 * abreast", never "is there a strip at all". Neither ever opens ui/main.ts.
 * Deleting the whole separation — putting the tokens straight back among the
 * units — leaves both of them green. The reported bug had no guard.
 *
 * WHAT THIS FILE DOES INSTEAD
 *
 * It drives the real client. ui/main.ts is the page entry point: it has no
 * exports, it reads `document` and `location.search` at import time, and it
 * builds its WebSocket in a constructor. So the fixture below hands it a
 * minimal DOM, a WebSocket that hands us back the instance, and a `?room=`
 * search string — the online path — and then pushes a real server `joined`
 * message carrying a real GameState built by the engine. main.ts renders it
 * the way it renders any board, into `#app`, and the assertions read the HTML
 * it actually produced. Nothing here scans source text.
 *
 * The fixture is deliberately dumb: every stub is the smallest thing that
 * lets the render run to completion. If main.ts grows a DOM call this fake
 * does not answer, this file goes red with a TypeError naming the call, which
 * is a good failure — nobody is left believing a render happened when it did
 * not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import type { EntityId, GameState, Seat } from '../../engine/src/types.ts';
import { skipHasteStep } from '../../engine/test/util.ts';

// ── the fixture: enough browser for ui/main.ts to paint ────────────────

const RECT = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };

/** an element that remembers what is assigned to it and shrugs at everything
 * else — `innerHTML` is the one property this file actually reads back */
function mkEl(id = ''): Record<string, unknown> {
  const store: Record<string, unknown> = {
    id, innerHTML: '', textContent: '', value: '', scrollTop: 0, scrollHeight: 0, tagName: 'DIV',
  };
  const noop = (): void => {};
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k as string];
      if (k === 'style' || k === 'dataset') return (t[k as string] = new Proxy({}, { get: () => '', set: () => true }));
      if (k === 'classList') return { add: noop, remove: noop, toggle: noop, contains: () => false };
      if (k === 'getBoundingClientRect') return () => RECT;
      if (k === 'querySelector' || k === 'closest') return () => null;
      if (k === 'querySelectorAll' || k === 'getElementsByClassName') return () => [];
      if (k === 'children' || k === 'childNodes') return [];
      if (k === 'parentElement' || k === 'parentNode' || k === 'firstChild' || k === 'nextElementSibling') return null;
      if (typeof k === 'symbol') return undefined;
      return noop;
    },
    set(t, k, v) { t[k as string] = v; return true; },
  }) as Record<string, unknown>;
}

const ELS = new Map<string, Record<string, unknown>>();
const byId = (id: string): Record<string, unknown> => {
  if (!ELS.has(id)) ELS.set(id, mkEl(id));
  return ELS.get(id)!;
};
const APP = byId('app');
/** the boxes main.ts asks for by id and treats as "absent unless open" */
const ABSENT = new Set(['judge-q', 'report-note', 'preview', 'hovertip']);

interface FakeSocket { onopen: null | (() => void); onmessage: null | ((e: { data: string }) => void); onclose: null | (() => void) }
let SOCKET: FakeSocket | null = null;

const g = globalThis as unknown as Record<string, unknown>;
g.document = {
  getElementById: (id: string) => (ABSENT.has(id) ? null : byId(id)),
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => mkEl(), createElementNS: () => mkEl(),
  addEventListener: () => {}, removeEventListener: () => {},
  body: mkEl(), documentElement: mkEl(), activeElement: null, title: '', hidden: false,
};
g.window = globalThis;
g.addEventListener = () => {};
// the online path: `?room=…` is what makes main.ts build a NetBackend at
// import time instead of painting the home screen
g.location = { host: 'x', protocol: 'http:', search: '?room=TOKENSEP&seat=0', hash: '', href: 'http://x/' };
// the regions board is the only board since board round 8 (the classic one
// these tests were first written against is gone)
g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
g.WebSocket = class {
  static OPEN = 1;
  readyState = 1;
  onopen: null | (() => void) = null;
  onmessage: null | ((e: { data: string }) => void) = null;
  onclose: null | (() => void) = null;
  constructor(_url: string) { SOCKET = this as unknown as FakeSocket; }
  send(_s: string): void {}
  close(): void {}
};
g.HTMLInputElement = class {};
g.HTMLTextAreaElement = class {};
g.HTMLElement = class {};
g.requestAnimationFrame = () => 0;
g.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
g.setInterval = () => 0;
g.innerWidth = 1200; g.innerHeight = 900; g.scrollX = 0; g.scrollY = 0; g.devicePixelRatio = 1;
g.getComputedStyle = () => new Proxy({}, { get: () => '' });

await import('../main.ts');
assert.ok(SOCKET, 'ui/main.ts did not open a socket for ?room= — the fixture is not driving the client');

/** hand the client an authoritative state the way the server does, and give
 * back the markup it painted */
function paint(state: GameState, seat: Seat): string {
  SOCKET!.onmessage!({
    data: JSON.stringify({
      t: 'joined', seat, view: state, log: [], legal: [], peers: [true, true], names: ['Ann', 'Bo'],
    }),
  });
  const html = String(APP.innerHTML);
  assert.ok(html.length > 500, 'the client painted nothing — the fixture broke, not the behaviour');
  return html;
}

// ── reading the markup back ───────────────────────────────────────────

/** the whole `<div …>…</div>` whose opening tag contains offset `at` */
function divAround(html: string, at: number, what: string): string {
  assert.ok(at >= 0, `the board has no ${what} at all`);
  const start = html.lastIndexOf('<div', at);
  assert.ok(start >= 0, `${what} is not inside a <div>`);
  let i = html.indexOf('>', at), depth = 1;
  while (depth > 0) {
    const open = html.indexOf('<div', i), close = html.indexOf('</div>', i);
    assert.ok(close >= 0, `unbalanced markup around ${what}`);
    if (open >= 0 && open < close) { depth++; i = open + 4; } else { depth--; i = close + 6; }
  }
  return html.slice(start, i);
}

/** the element carrying `data-animzone="<key>"`, with everything inside it */
const zone = (html: string, key: string): string =>
  divAround(html, html.indexOf(`data-animzone="${key}"`), `the "${key}" zone`);

const idsIn = (chunk: string): number[] =>
  [...chunk.matchAll(/data-id="(\d+)"/g)].map(m => Number(m[1]));

// ── the position: one unit and one spell token, side by side at home ───

interface Board { state: GameState; seat: Seat; unit: EntityId; token: EntityId }

function board(seed = 4242): Board {
  const h = new Harness(seed);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  // CR 504.5: the haste step is now ALWAYS offered, so this fixture would sit in
  // planning rather than battle — close the step to reach the board it means.
  // The unit is a vanilla one (Curio Drifter): an Ignis Sprite's spawn trigger
  // used to wait on the battle stack here, but its controller is alone in this
  // region, so that stack drains on its own (CR 703.7, CT-234) and its Fireball
  // would be a second token in the strip this test is counting.
  skipHasteStep(h);
  const seat = h.state.initiative;
  const e = new E(h.state);
  const unit = e.spawnUnit(seat, 'Curio Drifter', e.homeRegion(seat)).id;
  const token = e.createSpellToken(seat, 'Poison', 1, e.homeRegion(seat)).id;
  e.settle();
  return { state: h.state, seat, unit, token };
}

// ── the claims ────────────────────────────────────────────────────────

test('#25: the formation zone holds units and only units — a spell token is not smushed in with them', () => {
  const { state, seat, unit, token } = board();
  const field = zone(paint(state, seat), `field:${seat}`);
  assert.ok(idsIn(field).includes(unit), 'the unit is in the formation zone (sanity: the board rendered)');
  assert.ok(!idsIn(field).includes(token),
    `the Poison token (id ${token}) is standing in the formation zone next to the units — this is `
    + 'the reported bug verbatim');
});

test('#25: the spell tokens get their own container, and it is the token that is in it', () => {
  const { state, seat, unit, token } = board();
  const strip = zone(paint(state, seat), `tokens:${seat}`);
  assert.deepEqual(idsIn(strip), [token],
    'the token strip should hold exactly the spell tokens — no units, and no missing tokens');
  assert.ok(!idsIn(strip).includes(unit), 'and the unit is not in it');
});

test('#25: that container is a corner of its own, outside the formation', () => {
  const { state, seat, token } = board();
  const html = paint(state, seat);
  // "their own spot": the token corner of the seat's In Play (board round 8,
  // 2026-10-29: at the band's outer end, away from the units — it was "over by
  // the bin" on the classic board)
  const corner = html.split(`<div class="ltok" data-fit="cards" data-tip="tokens" data-p="${seat}"`)[1]?.split('<template')[0] ?? '';
  assert.ok(idsIn(corner).includes(token), 'the token is in the seat\'s token corner');
  // …and NOT in the field the units stand in
  assert.ok(!idsIn(zone(html, `field:${seat}`)).includes(token),
    'the token is inside the field — the formation. That is the smushing.');
});

test('#25: no spell tokens means no strip — the spot is earned, not reserved', () => {
  const h = new Harness(4242);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);                                  // CR 504.5 (see board() above)
  const seat = h.state.initiative;
  const e = new E(h.state);
  e.spawnUnit(seat, 'Curio Drifter', e.homeRegion(seat));
  e.settle();
  const html = paint(h.state, seat);
  assert.ok(html.includes(`data-animzone="field:${seat}"`), 'the board rendered');
  assert.ok(!html.includes(`data-animzone="tokens:${seat}"`),
    'an empty token strip is rendered — a label and a hole where nothing is');
});

test('#25: the strip is the OWNER\'s tokens — an invader\'s token is not filed under yours', () => {
  const h = new Harness(4242);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  const seat = h.state.initiative, foe = (1 - seat) as Seat;
  const e = new E(h.state);
  const mine = e.createSpellToken(seat, 'Poison', 1, e.homeRegion(seat)).id;
  // a token of theirs standing in MY region — an invader, by controller
  const theirs = e.createSpellToken(foe, 'Crystal', 2, e.homeRegion(seat)).id;
  e.settle();
  const strip = zone(paint(h.state, seat), `tokens:${seat}`);
  assert.deepEqual(idsIn(strip), [mine],
    `the strip must hold only seat ${seat}'s tokens; the invading token (id ${theirs}) belongs in `
    + 'the invaders strip, not under your own label');
});
