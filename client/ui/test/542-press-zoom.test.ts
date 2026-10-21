/* PRESS TO READ A CARD ON THE TABLETOP (ui/presszoom.ts + ui/zoom.ts).
 *
 * Owner, 2026-10-21: "Clicking and holding (or using the mouse wheel to click
 * down) should enlarge and zoom in on cards. Like normal hovering does in
 * game. It's a little hard to read cards from here."
 *
 *   §1 the gesture, walked through its state machine with a hand-turned clock:
 *      a mouse held still zooms after HOLD_MS and the release is no click; a
 *      quick click never zooms; a press that moves past the drag's slop never
 *      zooms, or lets the zoom go; the wheel zooms at once, follows the cursor
 *      and its browser default is cancelled; a finger zooms on the drag's own
 *      hold, clear of the finger; nothing zooms under a drag, on a tile's
 *      button, or off a card
 *   §2 the seams: the zoom is zoom.ts's one layer (no second zoom), HELD so
 *      the hover zoom leaves it alone; drag.ts lets it go when a press becomes
 *      a drag; the tabletop installs it; the middle button's own effects are
 *      cancelled on cards only
 *   §3 the markup: every table card, Maybe card and binder tile carries
 *      `data-zoom`, through the real client
 *
 * The suites cannot press a real mouse (329's header): the Firefox and Chrome
 * walks in the round's hand-off are the proof that it works in a browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (f: string): string => readFileSync(join(UI, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const DECK = {
  id: 'd542', name: 'Zoom deck', maybe: ['Fireball'], cover: null,
  cards: ['Ignis Sprite', 'Ignis Sprite', 'Good Whale'],
  author: 'you', createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z', problems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '?table=d542';
g['__UI_DRIVER_STORE'] = { algoToken: 't542' };
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [DECK] }) };
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const { pressGesture, HOLD_MS } = await import('../presszoom.ts');
const { PEEK_MS } = await import('../touch.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
await flush();

// ── §1's rig: fake cards, a clock turned by hand, a display that logs ──

interface Card { name: string; isConnected: boolean; button?: boolean; closest(sel: string): unknown }
const card = (name: string, button = false): Card => ({
  name, isConnected: true, button,
  closest(sel: string) { return button && sel.includes('button') ? this : null; },
});
const A = card('A'), B = card('B'), BTN = card('+', true);

function rig(opts: { dragging?: boolean } = {}) {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const log: string[] = [];
  let up = false;
  let swallowed = 0;
  let under: Card | null = null;
  const gest = pressGesture({
    target: el => (el && !(el as unknown as Card).button ? el : null),
    under: () => under as unknown as Element,
    show: (el, at, animate) => {
      up = true;
      log.push(`show ${(el as unknown as Card).name}${at ? ` at ${at.x},${at.y}` : ''}${animate ? '' : ' still'}`);
      return true;
    },
    showing: () => up,
    end: () => { if (up) log.push('end'); up = false; },
    swallow: () => { swallowed++; },
    dragging: () => !!opts.dragging,
    later: (fn, ms) => { const id = next++; timers.push({ at: now + ms, fn, id }); return id; },
    cancel: t => { const i = timers.findIndex(x => x.id === t); if (i >= 0) timers.splice(i, 1); },
  });
  const tick = (ms: number): void => {
    now += ms;
    for (const t of timers.filter(x => x.at <= now)) { timers.splice(timers.indexOf(t), 1); t.fn(); }
  };
  let prevented = 0;
  const ev = (o: Partial<{ type: string; button: number; buttons: number; x: number; y: number; on: Card | null }>) => ({
    pointerId: 1, pointerType: o.type ?? 'mouse', button: o.button ?? 0, buttons: o.buttons ?? 1, isPrimary: true,
    clientX: o.x ?? 100, clientY: o.y ?? 100, target: (o.on === undefined ? A : o.on) as unknown as EventTarget,
    preventDefault: () => { prevented++; },
  });
  return {
    gest, tick, ev, log, setUnder: (c: Card | null) => { under = c; },
    get swallowed() { return swallowed; }, get prevented() { return prevented; }, get up() { return up; },
  };
}

test('§1 a mouse held still zooms after HOLD_MS; the release lets it go and is no click', () => {
  const r = rig();
  r.gest.down(r.ev({}));
  r.tick(HOLD_MS - 1);
  assert.deepEqual(r.log, [], 'not before the hold is up');
  r.gest.move(r.ev({ x: 103, y: 102 }));     // a hand's tremor, under the slop
  r.tick(1);
  assert.deepEqual(r.log, ['show A'], 'centred on the card (no finger point), grown out of it');
  r.gest.move(r.ev({ x: 104, y: 103 }));
  assert.ok(r.up, 'jitter under the slop keeps it');
  r.gest.up(r.ev({}));
  assert.deepEqual(r.log, ['show A', 'end']);
  assert.equal(r.swallowed, 1, 'the release of a read is not a click (no pin)');
  assert.equal(r.prevented, 0, 'a left press is never cancelled: the drag and the click are the browser\'s');
});

test('§1 a quick click never zooms', () => {
  const r = rig();
  r.gest.down(r.ev({}));
  r.tick(150);
  r.gest.up(r.ev({}));
  r.tick(1000);
  assert.deepEqual(r.log, []);
  assert.equal(r.swallowed, 0, 'and the click is the click');
});

test('§1 a press that becomes a drag never flashes the zoom, and a held zoom goes at the slop', () => {
  const r = rig();
  r.gest.down(r.ev({}));
  r.tick(80);
  r.gest.move(r.ev({ x: 106, y: 100 }));     // the drag's slop: 6px for a mouse
  r.tick(1000);
  assert.deepEqual(r.log, [], 'the drag took it before the hold was up');
  const s = rig();
  s.gest.down(s.ev({}));
  s.tick(HOLD_MS + 200);
  s.gest.move(s.ev({ x: 100, y: 94 }));
  assert.deepEqual(s.log, ['show A', 'end'], 'held, then carried: the zoom goes, the drag carries on');
  s.gest.up(s.ev({ x: 300, y: 300 }));
  assert.equal(s.swallowed, 0, 'the drop is the drag\'s business');
});

test('§1 the wheel: at once, while held, following the cursor; its default cancelled', () => {
  const r = rig();
  r.gest.down(r.ev({ button: 1, buttons: 4 }));
  assert.deepEqual(r.log, ['show A'], 'no wait');
  assert.equal(r.prevented, 1, 'autoscroll / paste: the press is cancelled');
  r.setUnder(B);
  r.gest.move(r.ev({ button: -1, buttons: 4, x: 100, y: 140 }));
  assert.deepEqual(r.log, ['show A', 'show B still'], 'run along a pile to read it, without the grow each time');
  r.setUnder(null);
  r.gest.move(r.ev({ button: -1, buttons: 4, x: 600, y: 140 }));
  assert.equal(r.log.length, 2, 'off the cards it keeps the last one');
  r.gest.up(r.ev({ button: 1, buttons: 0 }));
  assert.deepEqual(r.log, ['show A', 'show B still', 'end']);
  assert.equal(r.swallowed, 0, 'a middle release makes no click to eat — eating one would take the next real one');
  const s = rig();
  s.gest.down(s.ev({ button: 1, buttons: 4 }));
  s.gest.move(s.ev({ button: -1, buttons: 0 }));
  assert.deepEqual(s.log, ['show A', 'end'], 'released elsewhere: a move with the wheel up lets it go');
});

test('§1 a finger: on the drag\'s own hold, clear of the finger; moving on carries the card', () => {
  assert.equal(PEEK_MS, 380);
  const r = rig();
  r.gest.down(r.ev({ type: 'touch', x: 200, y: 300 }));
  r.tick(PEEK_MS - 1);
  assert.deepEqual(r.log, []);
  r.tick(1);
  assert.deepEqual(r.log, ['show A at 200,300'], 'the peek\'s box: placed off the finger\'s point');
  r.gest.move(r.ev({ type: 'touch', x: 210, y: 300 }));   // the touch slop: 10px
  assert.deepEqual(r.log, ['show A at 200,300', 'end'], 'the hold became a carry');
  const s = rig();
  s.gest.down(s.ev({ type: 'touch' }));
  s.tick(PEEK_MS);
  s.gest.up(s.ev({ type: 'touch' }));
  assert.equal(s.swallowed, 1, 'lifting a read is not a tap: it does not pick the card up');
  const w = rig();
  w.gest.down(w.ev({ type: 'touch' }));
  w.tick(100);
  w.gest.cancel();                                         // the browser took the swipe as a scroll
  w.tick(1000);
  assert.deepEqual(w.log, [], 'a swipe never zooms');
});

test('§1 nothing zooms under a drag, on a tile\'s button, off a card, or for a right press', () => {
  const d = rig({ dragging: true });
  d.gest.down(d.ev({}));
  d.gest.down(d.ev({ button: 1, buttons: 4 }));
  d.tick(1000);
  assert.deepEqual(d.log, []);
  for (const on of [BTN, null]) {
    const r = rig();
    r.gest.down(r.ev({ on }));
    r.gest.down(r.ev({ on, button: 1, buttons: 4 }));
    r.tick(1000);
    assert.deepEqual(r.log, [], `on ${on ? 'a button' : 'nothing'}`);
    assert.equal(r.prevented, 0, 'and the middle button keeps its default off the cards');
  }
  const r = rig();
  r.gest.down(r.ev({ button: 2, buttons: 2 }));
  r.tick(1000);
  assert.deepEqual(r.log, []);
  assert.ok(HOLD_MS >= 250 && HOLD_MS <= 450, 'long enough to never flash on a click, short enough to feel held');
});

test('§2 one zoom, held; drag.ts lets it go; the tabletop installs it; the wheel cancelled on cards only', () => {
  const zoom = code('zoom.ts'), drag = code('drag.ts'), pz = code('presszoom.ts');
  // the one layer: nothing but zoom.ts makes #cardzoom
  for (const f of ['presszoom.ts', 'tabletop.ts', 'piletable.ts', 'binder.ts', 'drag.ts']) {
    assert.doesNotMatch(code(f), /cardzoom/, `${f} builds no zoom of its own`);
  }
  assert.match(zoom, /export function zoomPress\([\s\S]*?put\(c, copy, r, box, animate\);\s*pressing = c;\s*held = true;/,
    'the press zoom is put on the same layer as the hover zoom, and HELD');
  assert.match(zoom, /if \(peeking \|\| pressing\) return;/, 'a menu edge (zoomHold) never lets it go');
  assert.match(zoom, /export function zoomAt\([^)]*\): void \{\s*if \(held\) return;/, 'the hover zoom leaves a held copy alone');
  assert.match(zoom, /export function zoomCheck\(\): void \{\s*if \(held \|\|/, 'and so does the pointer-follow');
  assert.match(drag, /function begin\([^)]*\): boolean \{\s*zoomPressEnd\(\);/,
    'drag.ts lets the zoom go as the first thing a drag does');
  assert.match(pz, /if \(!e\.isPrimary \|\| io\.dragging\(\)\) return;/, 'never opens under a drag');
  assert.match(pz, /if \(mouse && e\.button === 1\) \{\s*e\.preventDefault\(\);/);
  assert.match(pz, /e\.button === 1 && pressTarget\(e\.target as Element \| null\)\) e\.preventDefault\(\);/,
    'mousedown / mouseup / auxclick: the middle button cancelled on a card, nowhere else');
  assert.match(pz, /\['mousedown', 'mouseup', 'auxclick'\]/);
  assert.match(code('tabletop.ts'), /function ensureListeners\(\): void \{[\s\S]*?installPressZoom\(\);/);
  assert.match(pz, /mouse \? HOLD_MS : PEEK_MS/, 'a finger\'s zoom rides the same beat as the lift');
  assert.match(code('tabletop.ts'), /holdMs: PEEK_MS,/, 'which is the tabletop\'s drag hold');
});

test('§3 every table card, Maybe card and binder tile carries data-zoom', () => {
  const html = ui.html();
  assert.match(html, /<div class="ttpage"/, 'the table is open');
  const cards = [...html.matchAll(/<div class="ttcard[^>]*>/g)].map(m => m[0]);
  assert.equal(cards.length, DECK.cards.length + DECK.maybe.length, 'the deck and the Maybe pile are drawn');
  for (const c of cards) assert.match(c, /\sdata-zoom[\s>]/, c);
  const tiles = [...html.matchAll(/<div class="dktile ddtile[^>]*>/g)].map(m => m[0]);
  assert.ok(tiles.length > 10, `the binder is up (${tiles.length} tiles)`);
  for (const t of tiles) assert.match(t, /\sdata-zoom[\s>]/, t);
});
