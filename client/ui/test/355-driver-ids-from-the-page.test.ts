/* CT-180 — THE DRIVER ANSWERS `getElementById` FROM THE PAGE, NOT FROM A LIST.
 *
 * test/ui-driver.ts used to hand back a stub element for any id not on its
 * typed `ABSENT` list. `setLiveSlot` in ui/main.ts bails with "no such node —
 * not a board screen" when `getElementById` comes back null, so in the driver
 * that bail was NEVER taken: every live-slot write appeared to land on every
 * screen, and no test in the repo could fail on a slot painted onto a screen
 * that has no node for it.
 *
 * The driver now derives the answer from what is on the page (see `onPage`
 * there). This file holds that:
 *
 * §1 an id no render ever wrote comes back null
 * §2 on a screen with no board, every live slot's lookup comes back null — so
 *    setLiveSlot takes its bail. The slot ids are DERIVED from the board's own
 *    markup (§3 renders it), never typed here.
 * §3 the positive control: on a board the same lookups find their nodes and
 *    the patcher's write reaches the screen — without it §2 is green for a
 *    driver that answers null to everything
 * §4 a node goes when the markup that held it goes
 * §5 a layer hung beside #app is found by its id, as the browser finds the
 *    hover tip — and `data-id="12"` is not `id="12"`
 *
 * Seeds 35500-35599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import type { Seat } from '../../engine/src/types.ts';

/** the real client, on the connecting screen: `?room=…` and no `joined` yet */
const ui = await client();
const SEAT: Seat = 0;

const doc = (globalThis as unknown as {
  document: {
    getElementById: (id: string) => unknown;
    createElement: (tag: string) => Record<string, unknown>;
    body: { appendChild: (el: unknown) => unknown };
  };
}).document;

/** every lookup made during `run`, with what the page answered */
const realGet = doc.getElementById;
let probe: { id: string; found: boolean }[] | null = null;
doc.getElementById = (id: string): unknown => {
  const el = realGet.call(doc, id);
  probe?.push({ id, found: el !== null });
  return el;
};
function lookups(run: () => void): { id: string; found: boolean }[] {
  probe = [];
  run();
  const seen = probe;
  probe = null;
  return seen;
}

/** the ids of the live slots in a chunk of markup, read the way the driver
 * reads them: a `liveslot` class and an id */
const liveSlotIds = (html: string): string[] => [...html.matchAll(/<[a-zA-Z][^>]*>/g)]
  .map(m => m[0])
  .filter(tag => /class="[^"]*\bliveslot\b[^"]*"/.test(tag))
  .map(tag => /\sid="([\w-]+)"/.exec(tag)?.[1])
  .filter((id): id is string => id !== undefined);

// what the boardless screen asked for, kept for §2 once §3 has named the slots
let boardless: { id: string; found: boolean }[] = [];

test('CT-180 §1 an id no render wrote comes back null from the driver', () => {
  assert.match(ui.html(), /Connecting to the server/, 'the fixture is not on the connecting screen');
  assert.equal(doc.getElementById('ct180-never-rendered'), null,
    'the driver handed back an element for an id nothing on the page carries — a write to it '
    + 'would look like it landed, which is the whole of CT-180');
  assert.notEqual(doc.getElementById('app'), null, 'and #app, which index.html ships, is always there');
});

test('CT-180 §2 on the connecting screen every live-slot lookup is null and nothing is painted into one', () => {
  // the CT-148 door: onMsg → t==='error' → flushPace() → paintLive() →
  // setLiveSlot(id, …) → getElementById(id)
  let html = '';
  boardless = lookups(() => { html = ui.push({ t: 'error', msg: 'No game with code ZZQX.' }); });
  assert.match(html, /No game with code ZZQX/, 'the refusal reached the connecting screen');
  assert.ok(boardless.length > 0,
    'the boardless paint looked nothing up at all — paintLive was not reached, so §3 below '
    + 'cannot say anything about its bail');
  assert.ok(boardless.every(l => !l.found),
    `the connecting screen has no board, and the driver still found ${boardless.filter(l => l.found)
      .map(l => `#${l.id}`).join(', ')} on it`);
});

test('CT-180 §3 on a board the same lookups find their nodes and the patched content is on screen', () => {
  const h = new Harness(35500);
  const html = ui.join(viewFor(h.state, SEAT), SEAT, legalActions(h.state, SEAT));
  const slots = liveSlotIds(ui.raw());
  assert.ok(slots.length >= 2, `the board emits ${slots.length} live slot(s); it has at least two`);

  // §2's verdict, now that the board has named the slots: every one of them
  // was asked for on the connecting screen, and every answer was null — which
  // is exactly setLiveSlot taking its "not a board screen" bail
  for (const id of slots) {
    const asked = boardless.filter(l => l.id === id);
    assert.ok(asked.length > 0,
      `#${id} is a live slot on the board and the connecting-screen paint never looked it up — `
      + 'the bail was not exercised for it');
    assert.ok(asked.every(l => !l.found),
      `#${id} was FOUND on the connecting screen; setLiveSlot wrote into a node the page does not have`);
  }

  // the positive control: the same lookups succeed with a board, and the
  // patcher's write is what put the presence dot on screen
  const onBoard = lookups(() => { ui.update(viewFor(h.state, SEAT), legalActions(h.state, SEAT)); });
  for (const id of slots) {
    assert.ok(onBoard.some(l => l.id === id && l.found),
      `#${id} is in the board markup and the driver did not find it — a driver that answers null `
      + 'to everything would make §2 green for nothing');
  }
  assert.match(ui.html(), /opponent connected/, 'the presence slot was filled on the board');
  assert.doesNotMatch(ui.raw(), /opponent connected/, 'and by the patcher, not by render()');
  assert.ok(html.includes('id="presenceslot"'), 'the join painted the board');
});

test('CT-180 §4 a node goes when the markup that held it goes', () => {
  assert.notEqual(doc.getElementById('presenceslot'), null, 'the fixture has no board on screen');
  // the server hands this seat to another connection: #app becomes a notice
  const html = ui.push({ t: 'kicked', msg: 'another connection took over this seat' });
  assert.match(html, /another connection took over this seat/);
  assert.equal(doc.getElementById('presenceslot'), null,
    'the board markup was replaced and the driver still has its live slot — a stale node');
});

test('CT-180 §5 a layer hung beside the app root is found by its id', () => {
  const el = doc.createElement('div');
  el['id'] = 'ct180-layer';
  assert.equal(doc.getElementById('ct180-layer'), null, 'an element nobody attached is not on the page');
  doc.body.appendChild(el);
  assert.equal(doc.getElementById('ct180-layer'), el,
    'an element on document.body carrying the id must be the one found — the hover tip is looked up this way');
});

test('CT-180 §5 an attribute that only ends in id is not an id', () => {
  // the board writes `data-id="12"` on every card; that is not `id="12"`
  const el = doc.createElement('div');
  el['innerHTML'] = '<div data-id="35501" class="card"></div>';
  doc.body.appendChild(el);
  assert.ok(ui.html().includes('data-id="35501"'), 'the layer is not on the page');
  assert.equal(doc.getElementById('35501'), null,
    'data-id="35501" was read as id="35501" — the lookup matches a substring, not an attribute');
});
