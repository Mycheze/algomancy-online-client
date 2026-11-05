/* A FINGER CARRIES A CARD TO THE SIDEBOARD AND BACK (CT-516).
 *
 * The deck builder's Sideboard rail was dragged both ways in real Firefox and
 * under Chrome's touch emulation (BL-65 W5b), but nothing in the suite had
 * ever moved a finger: 536 and 329 are source-level ("the driver dispatches no
 * pointer moves"), so the touch half of ui/drag.ts — the hold, the cancelled
 * touchmove, the lift above the finger, a pointercancel mid-carry — could
 * break with every test green. This drives drag.ts's OWN document listeners
 * with touch pointer events over a small fake page: a deck card on the left,
 * the Sideboard rail on the right, the felt between.
 *
 *   §0 the tabletop's provider is configured as the stub here is: a finger
 *      must hold (PEEK_MS), and its drop is place() — 536 §2 pins that place()
 *      is the tap's own route, and 831/1129 that the tap reaches the sideboard
 *   §1 a finger that moves before the hold is a swipe: nothing lifts, the
 *      touchmove is left to the browser (the page scrolls), nothing drops
 *   §2 held, then carried onto the rail: the card lifts, the touchmove is
 *      cancelled (the browser does not claim the pan), the ghost rides above
 *      the finger, the rail lights, and the release puts the card in the
 *      sideboard
 *   §3 and back: a sideboard card carried onto the table lands in the deck
 *   §4 a pointercancel mid-carry (what a browser sends when it takes the
 *      gesture after all) drops nothing and leaves the page undragged
 *   §5 a held finger gets no callout / context menu (iOS, Android)
 *
 * What this cannot prove is Safari's own gesture arbitration on a real iPad;
 * that is the owner's check in CT-516.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });

/* ── a fake page ── */
class Cls {
  private s = new Set<string>();
  add(...c: string[]): void { for (const x of c) this.s.add(x); }
  remove(...c: string[]): void { for (const x of c) this.s.delete(x); }
  contains(c: string): boolean { return this.s.has(c); }
  toggle(c: string, on?: boolean): void { if (on ?? !this.s.has(c)) this.s.add(c); else this.s.delete(c); }
}
interface Box { left: number; top: number; width: number; height: number }
class El {
  classList = new Cls();
  dataset: Record<string, string> = {};
  style: Record<string, unknown> & { removeProperty(k: string): void } = { removeProperty: () => {} };
  attributes: { name: string }[] = [];
  isConnected = true;
  removed = false;
  captured: number | null = null;
  name: string;
  box: Box;
  constructor(name: string, box: Box = { left: 0, top: 0, width: 0, height: 0 }) { this.name = name; this.box = box; }
  getBoundingClientRect() {
    const b = this.box;
    return { ...b, x: b.left, y: b.top, right: b.left + b.width, bottom: b.top + b.height, toJSON: () => b };
  }
  closest(): El | null { return null; }
  cloneNode(): El { return new El(`${this.name} (ghost)`, this.box); }
  querySelectorAll(): El[] { return []; }
  removeAttribute(): void {}
  setAttribute(): void {}
  appendChild(): void {}
  replaceChildren(): void {}
  remove(): void { this.removed = true; }
  setPointerCapture(id: number): void { this.captured = id; }
  releasePointerCapture(): void { this.captured = null; }
}

const html = new El('html');
const body = new El('body');
const felt = new El('felt');
const tableZone = new El('table', { left: 0, top: 0, width: 400, height: 800 });
tableZone.dataset['ttZone'] = 'pile:0';
const railZone = new El('sideboard rail', { left: 500, top: 0, width: 140, height: 800 });
railZone.dataset['ttZone'] = 'side';

/** the model the drop writes: card name → where it is */
const where = new Map<string, 'deck' | 'side'>([['Bumblecrab', 'deck'], ['Ashfang', 'side']]);
/** one card element per card, standing where its card is (a repaint, cheaply) */
const cards = new Map<string, El>();
for (const name of where.keys()) {
  const el = new El(name, { left: 0, top: 0, width: 120, height: 168 });
  el.dataset['ttSrc'] = name;
  cards.set(name, el);
}
const cardAt = (zone: 'deck' | 'side'): El => {
  const name = [...where].find(([, z]) => z === zone)![0];
  const el = cards.get(name)!;
  // the card stands at the top of its zone
  el.box = zone === 'deck'
    ? { left: 20, top: 100, width: 120, height: 168 } : { left: 510, top: 100, width: 120, height: 168 };
  return el;
};
/** what is under the finger: a card if one is there, else the zone, else the felt */
function elementFromPoint(x: number, y: number): El {
  for (const el of cards.values()) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return el;
  }
  if (x < 400) return tableZone;
  if (x >= 500 && x < 640) return railZone;
  return felt;
}
const zoneOf = (el: El | null): El | null => (el === null ? null
  : el.dataset['ttZone'] ? el
  : el.dataset['ttSrc'] ? (where.get(el.dataset['ttSrc']) === 'side' ? railZone : tableZone)
  : null);

type Fn = (e: Record<string, unknown>) => void;
const docOn = new Map<string, Fn[]>();
const winOn = new Map<string, Fn[]>();
const on = (m: Map<string, Fn[]>) => (t: string, fn: Fn): void => { m.set(t, [...(m.get(t) ?? []), fn]); };
const g = globalThis as Record<string, unknown>;
/** drag.ts's layer (it makes one, once): the ghost it last drew */
let ghost: El | null = null;
const layer = new El('draglayer');
layer.replaceChildren = (...els: unknown[]) => { ghost = els[0] as El; };
g['document'] = {
  documentElement: html, body,
  addEventListener: on(docOn),
  createElement: () => layer,
  elementFromPoint,
  querySelector: () => null,
  querySelectorAll: () => [],
};
g['window'] = { addEventListener: on(winOn), scrollBy: () => {} };
g['innerHeight'] = 800;
g['innerWidth'] = 1024;
g['scrollY'] = 0;
g['CSS'] = { escape: (s: string) => s };

const { installDrag, addDragProvider, dragActive } = await import('../drag.ts');
const { PEEK_MS } = await import('../touch.ts');

/* ── the provider, as the tabletop's (§0 holds the two together) ── */
const drops: { card: string; to: string }[] = [];
let ended = 0;
const provider = {
  holdMs: PEEK_MS,
  edgeScroll: true,
  pressLift: true,
  sourceOf: (el: Element) => ((el as unknown as El).dataset?.['ttSrc'] ? el as HTMLElement : null),
  plan(src: HTMLElement) {
    const card = (src as unknown as El).dataset['ttSrc']!;
    return {
      targets: [],
      zoneAt: (el: Element | null) => zoneOf(el as El | null) as Element | null,
      drop(zone: Element) {
        const to = (zone as unknown as El).dataset['ttZone'] === 'side' ? 'side' : 'deck';
        if (where.get(card) === to) return false;
        drops.push({ card, to });
        where.set(card, to);
        return true;
      },
    };
  },
  started: () => {},
  ended: () => { ended++; },
};
installDrag({ sourceOf: () => null, plan: () => null, started: () => {}, ended: () => {} });
addDragProvider(provider);

/* ── a finger ── */
const fire = (m: Map<string, Fn[]>, type: string, e: Record<string, unknown>): void => {
  for (const fn of m.get(type) ?? []) fn(e);
};
const finger = (x: number, y: number) => ({
  pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: x, clientY: y,
  target: elementFromPoint(x, y),
});
const down = (x: number, y: number): void => fire(docOn, 'pointerdown', finger(x, y));
const move = (x: number, y: number): void => fire(docOn, 'pointermove', finger(x, y));
const up = (x: number, y: number): void => fire(docOn, 'pointerup', finger(x, y));
/** the browser's touchmove: true when the page cancelled it (no scroll) */
const touchmove = (): boolean => {
  let prevented = false;
  fire(docOn, 'touchmove', { preventDefault: () => { prevented = true; } });
  return prevented;
};
const wait = (ms: number): void => { mock.timers.tick(ms); };

test('§0 the tabletop’s provider holds for a finger and drops through place(), as the stub here does', () => {
  const tt = readFileSync(new URL('../tabletop.ts', import.meta.url), 'utf8');
  const prov = tt.slice(tt.indexOf('const provider: DragProvider = {'));
  assert.ok(prov.length > 0, 'the tabletop’s provider moved — this test needs updating');
  assert.match(prov, /^const provider: DragProvider = \{\s*holdMs: PEEK_MS,\s*edgeScroll: true,\s*pressLift: true,/);
  assert.match(prov, /zoneAt\(el\) \{\s*let z = el\?\.closest\?\.\('\[data-tt-zone\]'\)/, 'its zone is the [data-tt-zone] under the finger');
  assert.match(prov, /drop\(zone, x, y\) \{\s*const to = placeAt\(h, carry, zone as HTMLElement, x, y\);\s*return !!to && place\(h, carry, to\);/);
  assert.ok(PEEK_MS >= 200, 'a hold a finger can tell from a swipe');
});

test('§1 a finger that moves before the hold is a swipe: no lift, the page scrolls, nothing drops', () => {
  const card = cardAt('deck');
  down(60, 150);
  wait(PEEK_MS / 4);
  move(60, 175);                                   // 25px down, well past the slop, too soon
  assert.equal(touchmove(), false, 'the touchmove is the browser’s: the table scrolls');
  assert.ok(!card.classList.contains('draglift'), 'nothing lifted');
  wait(PEEK_MS);                                   // the hold's cue must not fire for a let-go press
  assert.ok(!card.classList.contains('draglift'), 'not even late');
  move(560, 175);
  assert.equal(dragActive(), false, 'and no card is in the air');
  up(560, 175);
  assert.deepEqual(drops, [], 'nothing dropped');
  assert.equal(where.get('Bumblecrab'), 'deck');
});

test('§2 held, then carried onto the Sideboard rail: the card goes to the sideboard', () => {
  const card = cardAt('deck');
  down(60, 150);
  assert.equal(touchmove(), false, 'before the hold the finger may still scroll');
  wait(PEEK_MS + 10);
  assert.ok(card.classList.contains('draglift'), 'the hold lifts the card (the cue)');
  assert.equal(touchmove(), true, 'once held, the touchmove is cancelled — the browser cannot claim the pan');
  move(70, 160);                                   // past the 10px slop: the carry begins
  assert.equal(dragActive(), true, 'the card is in the air');
  assert.ok(html.classList.contains('dragging'));
  assert.equal(html.captured, 7, 'the finger is captured, so the carry follows it off the card');
  assert.ok(card.classList.contains('dragsrc'), 'the card dims where it was');
  assert.ok(!card.classList.contains('draglift'));
  move(560, 300);
  assert.ok(railZone.classList.contains('dropover'), 'the rail lights under the finger');
  assert.ok(!tableZone.classList.contains('dropover'));
  assert.equal(touchmove(), true, 'and the touchmove stays cancelled for the whole carry');
  up(560, 300);
  assert.deepEqual(drops, [{ card: 'Bumblecrab', to: 'side' }], 'one drop, on the sideboard');
  assert.equal(where.get('Bumblecrab'), 'side');
  assert.equal(dragActive(), false);
  assert.ok(!html.classList.contains('dragging'));
  assert.ok(!railZone.classList.contains('dropover'), 'the light goes out');
  assert.ok(!card.classList.contains('dragsrc'));
  assert.equal(html.captured, null, 'the capture is released');
  assert.equal(touchmove(), false, 'and the page scrolls again');
});

test('§2b the ghost rides above the finger that carries it, where it would otherwise cover the card', () => {
  // a carry from the sideboard, read mid-flight — Ashfang is the sideboard's first card
  where.set('Bumblecrab', 'deck');
  cardAt('side');
  ghost = null;
  down(560, 150);
  wait(PEEK_MS + 10);
  move(300, 400);
  try {
    const drawn = ghost as El | null;
    assert.ok(drawn, 'a ghost was drawn');
    const t = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(String(drawn.style['transform']));
    assert.ok(t, 'the ghost is placed by transform');
    // picked up 50px below the card's top: a mouse would put the top at 350
    assert.ok(Number(t![2]) < 350 - 168 * 0.5, `the ghost's top (${t![2]}) is lifted clear of the finger`);
  } finally {
    fire(docOn, 'pointercancel', finger(300, 400));   // put the card back, pass or fail
  }
});

test('§3 and back: a sideboard card carried onto the table lands in the deck', () => {
  drops.length = 0;
  where.set('Bumblecrab', 'side');
  where.set('Ashfang', 'side');
  const card = cardAt('side');
  const name = card.dataset['ttSrc']!;
  down(560, 150);
  wait(PEEK_MS + 10);
  move(540, 170);
  move(200, 400);
  assert.ok(tableZone.classList.contains('dropover'), 'the table lights');
  up(200, 400);
  assert.deepEqual(drops, [{ card: name, to: 'deck' }]);
  assert.equal(where.get(name), 'deck');
});

test('§4 a pointercancel mid-carry (the browser took the gesture) drops nothing', () => {
  drops.length = 0;
  const before = ended;
  const card = cardAt('deck');
  down(60, 150);
  wait(PEEK_MS + 10);
  move(80, 170);
  move(560, 300);
  assert.equal(dragActive(), true);
  fire(docOn, 'pointercancel', finger(560, 300));
  assert.equal(dragActive(), false, 'the carry is over');
  assert.ok(!html.classList.contains('dragging'));
  assert.ok(!card.classList.contains('dragsrc'));
  assert.ok(!railZone.classList.contains('dropover'));
  assert.equal(ended, before + 1, 'the page is told, so it paints what it deferred');
  up(560, 300);
  assert.deepEqual(drops, [], 'and the late lift drops nothing');
});

test('§5 a held finger gets no callout or context menu; a resting one keeps it', () => {
  const menu = (): boolean => {
    let prevented = false;
    fire(winOn, 'contextmenu', { preventDefault: () => { prevented = true; }, stopPropagation: () => {} });
    return prevented;
  };
  assert.equal(menu(), false, 'no press: the browser’s own menu');
  cardAt('deck');
  down(60, 150);
  wait(PEEK_MS + 10);
  assert.equal(menu(), true, 'held: no callout');
  up(60, 150);
  assert.equal(menu(), false, 'let go: the browser’s own again');
});
