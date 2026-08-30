/* R192 — CARD-TODO #64 and #65: the cache thumb's first click, and the badge
 * class attribute that could not be matched.
 *
 * TWO TICKETS, ONE FILE, because both are about the same thing: a piece of
 * markup that LOOKED right and could not be interrogated.
 *
 * CARD-TODO #64. `regionCacheHtml` drew its thumbs with no affordance of their
 * own, inside a panel that is itself `data-btn="cacheopen"`. So a click on a
 * cached card that you could play RIGHT NOW bubbled up and opened the dialog —
 * a two-click path where the first click looked like it should have been the
 * last. Never a dead control; just one that lied about how far it got you.
 *
 * CARD-TODO #65. `cardHtml` built a chip's class from a template with three
 * holes in it, so a plain chip rendered `class="badge   "` — badge plus THREE
 * spaces — and a classed one `badge` + three spaces + `proph on`. CSS did not
 * care. Every naive space-separated regex written against it silently never
 * matched, which is to say never FAILED: the R183 agent's `/badge offer/` was
 * an assertion that could not go red, and it only came to light because a
 * mutation that should have reddened it did not.
 *
 * §1  A cached card that is playable now plays on the FIRST click of its thumb.
 * §2  An unplayable thumb keeps the old route: no affordance of its own, so the
 *     click reaches the panel and the dialog opens. The zone stays one click
 *     from being READ, which is why the cache is public (R41) at all.
 * §3  The thumb plays the entry it is drawn for, with two live entries on
 *     screen and only one of them playable.
 * §4  A badge chip's class attribute has single spaces and no trailing space —
 *     and therefore a naive `class="badge glimpse on"` match works, which is
 *     the whole falsifiability point of #65.
 *
 * ⚠ HOW THE CLIENT IS DRIVEN. test/ui-driver.ts in hotseat mode — a fake DOM,
 * no socket, main.ts's own Harness, clicks through main.ts's own handlers.
 * NOTHING here reads ui/main.ts as source text: two tests in 70-playtest-round15
 * that did were coupled to LAYOUT rather than behaviour and both failed on a
 * pure refactor that preserved every invariant they named.
 *
 * ⚠ WHAT THIS FILE COULD NOT ASSERT, AND NOW CAN (R205/CT-75). This paragraph
 * used to say the driver's fake `closest()` had no ancestors, so it could not
 * model a click BUBBLING from a thumb to the panel around it — and that §2
 * therefore asserted the two facts that COMPOSE to the bubble rather than
 * watching the event travel. That was true and it was the bug: a `data-act`
 * nested in a `data-btn` is dead in a browser and was green in the driver, so
 * a whole class of click bug could not be written down here at all.
 *
 * R205 gave `test/ui-driver.ts` real ancestors, resolved out of the rendered
 * HTML, and `closest()` is now the browser's algorithm. §2 below still asserts
 * the composing facts, because they are the ones that say WHY, but the bubble
 * itself is now watched in `test/176-nested-affordance-and-serialiser.test.ts`
 * — which also guards, over the markup the client really paints, that no
 * `data-act` anywhere sits inside a `data-btn`.
 *
 * That is why the fix here is a `data-btn` and NOT the `data-act="cache"`
 * CARD-TODO #64 proposed: the click listener asks `closest('[data-btn]')`
 * first and only then `closest('[data-act]')`, so a `data-act` on a thumb
 * loses to the panel's `data-btn` in a real browser at any depth. `closest`
 * matches the element itself before any ancestor, so a `data-btn` on the thumb
 * is the one attribute that wins. 176 §3 plants #64's version and shows it go
 * red; before R205 it went green.
 *
 * Seeds 16300-16399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import { registerSynthetic } from '../src/cards/dsl.ts';
import { playableCachedIndexes } from '../ui/inspect.ts';
import { spawn } from './util.ts';
import type { Seat } from '../src/types.ts';

/* ── the client, hotseat ─────────────────────────────────────────────── */
// set BEFORE the driver is imported, and the import must therefore be dynamic:
// a static one is hoisted and would run the driver (and ui/main.ts with it)
// before this line ever executed.
(globalThis as Record<string, unknown>)['__UI_DRIVER_SEARCH'] = '?hotseat=1';
const { local, zone } = await import('./ui-driver.ts');
const ui = local();

/* ── fixtures ────────────────────────────────────────────────────────── */

const SEAT: Seat = 0;

/** deployment-timed: with a live glimpse stamp this is playable RIGHT NOW */
const NOW = 'B7 Cache Now';
registerSynthetic({
  name: NOW, cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Gain 3 life.',
}, { spellEffect: { run: (g, ctx) => { g.gainLife(ctx.controller, 3, NOW); } } });

/** {Battle}-timed: permitted and live, and the WRONG STEP — so it is in the
 * zone, is not playable, and must keep the dialog route */
const LATER = 'B7 Cache Later';
registerSynthetic({
  name: LATER, cost: '', mana: 0, power: 0, toughness: 0,
  type: '{Battle} Test Spell', kind: 'spell', timing: 'battle', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Gain 7 life. [Battle]',
}, { spellEffect: { run: (g, ctx) => { g.gainLife(ctx.controller, 7, LATER); } } });

/** §4 wants a PLAIN chip — one with no `mod`, no `ctr` and no `cls`, i.e. the
 * case whose class attribute was `badge` followed by three spaces. A unit's
 * own attributes are exactly that. */
const FLIER = 'B7 Badge Flier';
registerSynthetic({
  name: FLIER, cost: '', mana: 0, power: 2, toughness: 2,
  type: 'Test Unit', kind: 'unit', timing: 'deploy', attrs: ['Flying'],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Flying.',
}, {});

/** turn 1, in DEPLOYMENT — the step every section below is set during */
function deployment(seed = 16300): Harness {
  const h = new Harness(seed);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) {
    if (h.state.hasteDone && !h.state.hasteDone[s]) h.do({ type: 'doneHaste', seat: s });
  }
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') {
    h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  }
  assert.equal(h.state.phase, 'deploy', 'the fixture really is in deployment');
  return h;
}

/** cache a card with a glimpse stamp that is live this turn; return its index */
function glimpse(h: Harness, seat: Seat, name: string): number {
  const pl = h.state.players[seat]!;
  pl.cache ??= [];
  pl.cache.push({ card: name, uid: 9300 + pl.cache.length, playableUntilTurn: h.state.turn });
  return pl.cache.length - 1;
}

/** the opening `<div …>` of the card scan drawn for `name` inside `chunk` */
function scanTag(chunk: string, name: string): string {
  const at = chunk.indexOf(`data-prev="${name}"`);
  assert.ok(at >= 0, `no scan of ${name} in this chunk`);
  return chunk.slice(chunk.lastIndexOf('<div', at), chunk.indexOf('>', at) + 1);
}

/** the mini cache panel in a seat's region — the board's own name for it */
const panelOf = (html: string, p: Seat): string => zone(html, `cache:${p}`);

/** is the full cache dialog open? */
const dialogOpen = (html: string): boolean => html.includes('cachebox');

/* ═══ §1 THE FIRST CLICK IS THE LAST ONE ══════════════════════════════ */

test('R192 §1: a playable cached card plays on the FIRST click of its region-cache thumb', () => {
  const h = deployment();
  const i = glimpse(h, SEAT, NOW);

  // ⚠ disbelieve the ticket first: the engine has to actually be offering this
  // play, or a green test below would be about a client that refused nothing.
  assert.deepEqual(playableCachedIndexes(legalActions(h.state, SEAT)), [i],
    'the engine really is offering this cached play in this step');

  const html = ui.show(structuredClone(h.state));
  const panel = panelOf(html, SEAT);
  assert.ok(panel.includes(NOW), 'the thumb is drawn in the panel');
  assert.ok(!dialogOpen(html), 'and the dialog is shut to begin with');

  const before = ui.state().players[SEAT]!.life;
  ui.click({ btn: 'cacheplay', p: SEAT, i });

  assert.equal(ui.state().players[SEAT]!.life, before + 3,
    'ONE click on the thumb played the card');
  assert.equal(ui.state().players[SEAT]!.cache?.length ?? 0, 0, 'and it left the cache');
  assert.ok(!dialogOpen(ui.html()),
    'and the click was not spent opening the dialog on the way');
});

/* ═══ §2 THE TRADE-OFF, KEPT ══════════════════════════════════════════ */

test('R192 §2: an unplayable cache thumb carries no affordance, so the click still opens the zone', () => {
  const h = deployment(16301);
  const i = glimpse(h, SEAT, LATER);           // {Battle} timing, live stamp, wrong step

  assert.deepEqual(playableCachedIndexes(legalActions(h.state, SEAT)), [],
    'permitted and live, but not playable in THIS step');

  const html = ui.show(structuredClone(h.state));
  const panel = panelOf(html, SEAT);

  // the two facts that compose to "the click reaches the panel" — asserted
  // apart because they are the ones that say WHY. R205 made the bubble itself
  // watchable; 176 §2 does the watching.
  const thumb = scanTag(panel, LATER);
  assert.doesNotMatch(thumb, /data-btn=/, 'the unplayable thumb claims no click of its own');
  assert.doesNotMatch(thumb, /data-act=/, 'and offers no action either');
  assert.match(panel, /^<div class="regioncache[^"]*" data-btn="cacheopen"/,
    'and the element it is drawn inside IS the open-the-dialog panel');

  // …and that route still works and still lands on a clickable entry. R41: the
  // cache is public precisely so both players can READ it, and one click to
  // inspect the zone is what this section is protecting.
  assert.ok(!dialogOpen(html), 'shut before');
  const after = ui.click({ btn: 'cacheopen', p: SEAT });
  assert.ok(dialogOpen(after), 'clicking the panel opens the full cache dialog');
  assert.ok(after.includes(LATER), 'with the entry in it');
  assert.ok(ui.has({ act: 'cache', p: SEAT, i }),
    'and the dialog entry is the clickable one it always was');
});

/* ═══ §3 THE THUMB PLAYS ITS OWN ENTRY ════════════════════════════════ */

test('R192 §3: with two live entries the thumb plays the one it was drawn for', () => {
  // LATER first, so a client that reached for "the first live entry" — or for
  // the first thumb — would play the wrong card, or nothing at all.
  const h = deployment(16302);
  const later = glimpse(h, SEAT, LATER);
  const now = glimpse(h, SEAT, NOW);
  assert.equal(later, 0);
  assert.deepEqual(playableCachedIndexes(legalActions(h.state, SEAT)), [now],
    'exactly one of the two is playable in this step');

  const html = ui.show(structuredClone(h.state));
  const panel = panelOf(html, SEAT);
  assert.ok(panel.includes(LATER) && panel.includes(NOW), 'both thumbs are on screen');
  assert.doesNotMatch(scanTag(panel, LATER), /data-btn=/, 'only one of them is clickable');
  assert.match(scanTag(panel, NOW), /data-btn="cacheplay" data-p="0" data-i="1"/,
    'and it carries its own index, not the panel\'s');

  const before = ui.state().players[SEAT]!.life;
  ui.click({ btn: 'cacheplay', p: SEAT, i: now });
  assert.equal(ui.state().players[SEAT]!.life, before + 3,
    'the playable one resolved — +3, not the {Battle} card\'s +7');
  assert.deepEqual((ui.state().players[SEAT]!.cache ?? []).map(c => c.card), [LATER],
    'and the other entry is untouched');
});

/* ═══ §4 A BADGE CLASS THAT CAN BE MATCHED ════════════════════════════ */

/** every `class="…"` the client wrote that IS a badge chip's — `badge` alone,
 * or `badge` followed by a space and the rest. ⚠ It must not swallow the
 * CONTAINER's `class="badges hasmore"`, and it must still catch the broken
 * `badge   ` form, or the red-check below would be meaningless. */
const badgeClasses = (html: string): string[] =>
  [...html.matchAll(/class="(badge(?: [^"]*)?)"/g)].map(m => m[1]!);

test('R192 §4: a badge chip class has single spaces and no trailing space', () => {
  const h = deployment(16303);
  spawn(h, SEAT, FLIER);                       // a PLAIN chip: no mod, no ctr, no cls
  glimpse(h, SEAT, NOW);                       // and a CLASSED one: `glimpse on`

  const html = ui.show(structuredClone(h.state));
  const classes = badgeClasses(html);
  assert.ok(classes.length >= 2, `the board drew ${classes.length} badge chips, wanted 2+`);

  for (const c of classes) {
    assert.equal(c, c.trim(), `badge class "${c}" has a leading or trailing space`);
    assert.doesNotMatch(c, / {2}/, `badge class "${c}" has a run of spaces`);
    for (const word of c.split(' ')) assert.ok(word, `badge class "${c}" has an empty slot`);
  }

  // the two shapes, spelled the way a reader would naively write them — which
  // is the entire point of #65: before the fix NEITHER of these could match,
  // so an assertion of this form was unfalsifiable rather than true.
  assert.ok(classes.includes('badge'),
    'a chip with no mod, no counter and no class is exactly `badge`');
  assert.ok(classes.includes('badge glimpse on'),
    'and the cached card\'s expiry chip is exactly `badge glimpse on`');
  assert.match(html, /class="badge glimpse on"/,
    'so a naive space-separated match finds it — and could have failed');
});

/* the state used above is cloned into the client, so nothing here leaks into
 * another test file's Harness — but assert it, because a shared client is the
 * one thing in this file two tests could fight over */
test('R192: the driver is holding its own state, not a fixture Harness', () => {
  const h = deployment(16304);
  const before = structuredClone(h.state);
  ui.show(structuredClone(h.state));
  ui.state().players[0]!.life = 77;
  assert.notEqual(before.players[0]!.life, 77, 'the fixture is untouched by the client');
});
