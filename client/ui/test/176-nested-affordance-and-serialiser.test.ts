/* R205 — CT-75 and CT-82(b)(c)(d): the checker that could not see a nested
 * affordance, and the serialiser nobody had named.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────
 *
 * ui/main.ts routes every click through ONE delegator (main.ts, the
 * `document.addEventListener('click', …)` near the end):
 *
 *     const btn = target.closest('[data-btn]'); if (btn) { … return; }
 *     const t   = target.closest('[data-act]'); …
 *
 * Two separate `closest` calls, asked in order. So a `data-act` element sitting
 * ANYWHERE inside a `data-btn` container — one level down or ten — never gets
 * its handler: the container claims the click first. The board has two such
 * containers, `.regioncache` (`data-btn="cacheopen"`) and `.regionbin`
 * (`data-btn="binopen"`), and both are full of card scans.
 *
 * `test/ui-driver.ts` could not see any of that, because its fake element had
 * NO ANCESTORS: there was no container for an inner element to lose to. A test
 * about a nested affordance therefore went green in the driver and was wrong on
 * screen. That is not hypothetical — CARD-TODO #64's own prescribed fix was
 * "give the thumbs the same data-act the dialog entries use", which in a
 * browser does nothing at all, and in the old driver would have passed. The
 * driver's header comment asserted the opposite in so many words, and that
 * sentence is what let it survive: docs/13-assessment.md §5's list of checkers
 * that reported more sight than they had, one entry longer.
 *
 * R205 gave the driver real ancestors (`ancestorsOf`, resolved out of the
 * rendered HTML), so `closest()` here is now the browser's algorithm — element
 * first, then outward, nearest match wins.
 *
 * ── WHAT THIS FILE ASSERTS ────────────────────────────────────────────
 *
 * §1  The driver's ancestor chain is REAL: closest() walks it, the nearest
 *     match wins, and contains()/parentElement agree with it.
 * §2  THE GUARD. No `data-act` anywhere in the rendered board sits inside a
 *     `data-btn`. The list is COMPUTED from the markup the client painted
 *     (docs/13 §7.2), never typed from a report — a panel added next year
 *     walks into this guard by itself.
 * §3  §2's positive control: the detector, shown the swallowed shape, says so.
 *     Without this §2 is exactly the thing the ticket is about.
 * §4  CT-82(b). The bin panel's twin of CT-64: a bin card usable RIGHT NOW is
 *     one click from the region panel, and an unusable one still opens the
 *     zone.
 * §5  CT-82(c). No class attribute the client writes has a doubled or trailing
 *     space, and no two attributes on one line are separated by more than one.
 *     That is what makes a regex spanning two of them able to fail.
 * §6  CT-82(d). `anim.ts`'s flight stagger — the second serialiser, live and
 *     unnamed since R189 fixed the first one.
 *
 * Seeds 17600-17699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { registerSynthetic } from '../../engine/src/cards/dsl.ts';
import { flightDelays } from '../anim.ts';
import { playableCachedIndexes } from '../inspect.ts';
import { spawn } from '../../engine/test/util.ts';
import type { Seat } from '../../engine/src/types.ts';

/* ── the client, hotseat ─────────────────────────────────────────────── */
// set BEFORE the driver is imported, so the import must be dynamic: a static
// one is hoisted and would load ui/main.ts before this line ever ran.
const { local, affordances, elementFor } = await import('./ui-driver.ts');
const ui = local();

/* ── fixtures ────────────────────────────────────────────────────────── */

const SEAT: Seat = 0;

/** a plain body to stand in a region and to pad a bin with */
const HOST = 'B7-176 Host';
registerSynthetic({
  name: HOST, cost: '', mana: 0, power: 2, toughness: 2,
  type: 'Test Unit', kind: 'unit', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '', text: '',
}, {});

/** free, so it is legal from the bin the moment there is a host to put it on */
const AUG = 'B7-176 Bin Augment';
registerSynthetic({
  name: AUG, cost: '', mana: 0, power: 1, toughness: 1,
  type: 'Test Augment', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: ['Flying'], image: '',
  text: 'Augment. +1/+1 and Flying.',
}, {});

/** deployment-timed with a live glimpse stamp: playable from the cache NOW */
const CACHED = 'B7-176 Cache Now';
registerSynthetic({
  name: CACHED, cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Gain 3 life.',
}, { spellEffect: { run: (g, ctx) => { g.gainLife(ctx.controller, 3, CACHED); } } });

/** turn 1, in DEPLOYMENT — the step every section below is set during */
function deployment(seed = 17600): Harness {
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

/** a board with a live bin entry, a live cache entry and a unit on the field —
 * i.e. one where every container-shaped affordance is actually drawn */
function loaded(seed: number): Harness {
  const h = deployment(seed);
  spawn(h, SEAT, HOST);
  const pl = h.state.players[SEAT]!;
  pl.bin.push(HOST, HOST, AUG);           // AUG last: the strip shows the last three
  pl.cache ??= [];
  pl.cache.push({ card: CACHED, uid: 9760, playableUntilTurn: h.state.turn });
  return h;
}

/** the opening `<div …>` of the card scan drawn for `name` inside `chunk` */
function scanTag(chunk: string, name: string): string {
  const at = chunk.indexOf(`data-prev="${name}"`);
  assert.ok(at >= 0, `no scan of ${name} in this chunk`);
  return chunk.slice(chunk.lastIndexOf('<div', at), chunk.indexOf('>', at) + 1);
}

/* ══ §1 THE DRIVER HAS ANCESTORS ═══════════════════════════════════════ */

test('R205 §1: the driver resolves closest() through REAL ancestors, nearest first', () => {
  const h = loaded(17601);
  const html = ui.show(structuredClone(h.state));

  // the census must see nesting AT ALL, or every guard built on it is vacuous.
  // docs/13 §5 is a list of checkers that did not clear this bar.
  const all = affordances(html);
  assert.ok(all.length >= 8, `the board painted ${all.length} affordances — too few to be a board`);
  assert.ok(all.some(a => a.ancestors.length > 0),
    'EVERY affordance came back with an empty ancestor chain — the driver is still blind');
  const nested = all.filter(a => a.enclosingBtn !== null);
  assert.ok(nested.length > 0,
    'no affordance on this board is inside a data-btn container, so §2 proves nothing. '
    + 'The cache and bin thumbs are supposed to be exactly that.');

  // and the chain really is the markup's: a thumb inside the cache panel names
  // the panel, and the panel is not inside itself
  const thumb = all.find(a => a.btn === 'cacheplay');
  assert.ok(thumb, 'the playable cache thumb is on screen');
  assert.equal(thumb.enclosingBtn, 'cacheopen',
    'and the driver can see the panel it sits in — which is the whole of CT-75');

  // the three views of the chain must agree, or the two nobody looks at are
  // free to drift into a second lie of the same species
  const i = playableCachedIndexes(legalActions(h.state, SEAT))[0]!;
  const el = elementFor(html, { btn: 'cacheplay', p: SEAT, i });
  const closest = el['closest'] as (s: string) => Record<string, unknown> | null;
  const panel = closest('[data-btn]');
  assert.equal(panel, el, 'closest() matches the element ITSELF before any ancestor');
  const up = el['parentElement'] as Record<string, unknown> | null;
  assert.ok(up, 'the clicked element has a parent — the old fake said null for everything');
  assert.equal((up['contains'] as (o: unknown) => boolean)(el), true,
    'and the parent contains it');
  assert.equal((el['contains'] as (o: unknown) => boolean)(up), false,
    'while the child does not contain the parent — the relation has a direction');
  assert.equal((el['contains'] as (o: unknown) => boolean)(el), true,
    'contains() includes the node itself, as the DOM\'s does');
});

test('R205 §1: closest() prefers the element itself, then the nearest ancestor', () => {
  const h = loaded(17602);
  const html = ui.show(structuredClone(h.state));
  const all = affordances(html);

  // the thumb carries data-btn="cacheplay" and sits inside data-btn="cacheopen".
  // A browser's closest('[data-btn]') returns the THUMB. That is the one
  // property R192 leaned on, and until R205 nothing could check it.
  const thumb = all.find(a => a.btn === 'cacheplay')!;
  assert.equal(thumb.btn, 'cacheplay');
  assert.equal(thumb.enclosingBtn, 'cacheopen');

  // …and the click really lands on the thumb's handler, not the panel's: the
  // card resolves and the dialog does not open.
  const i = playableCachedIndexes(legalActions(h.state, SEAT))[0]!;
  const before = ui.state().players[SEAT]!.life;
  const after = ui.click({ btn: 'cacheplay', p: SEAT, i });
  assert.equal(ui.state().players[SEAT]!.life, before + 3,
    'the nearer data-btn won: the card played');
  assert.ok(!after.includes('cachebox'),
    'and the click was not spent opening the panel it is nested inside');
});

/* ══ §2 THE GUARD ══════════════════════════════════════════════════════ */

/** every rendered state this file can reach, labelled. The corpus is what the
 * guard's coverage IS — add a state here rather than a name to a list. */
function corpus(): { where: string; html: string }[] {
  const out: { where: string; html: string }[] = [];
  const push = (where: string, html: string): void => { out.push({ where, html }); };

  const h = loaded(17610);
  push('the board, bin and cache both live', ui.show(structuredClone(h.state)));
  push('the bin dialog open', ui.click({ btn: 'binopen', p: SEAT }));
  push('the bin dialog closed again', ui.click({ btn: 'binclose' }));
  push('the cache dialog open', ui.click({ btn: 'cacheopen', p: SEAT }));
  push('the cache dialog closed again', ui.click({ btn: 'cacheclose' }));
  push('the rules panel open', ui.click({ btn: 'helpopen' }));
  push('the rules panel closed again', ui.click({ btn: 'helpclose' }));

  // a board with NOTHING live: the thumbs must fall back to the panel route,
  // and the panels are still containers
  const bare = deployment(17611);
  bare.state.players[SEAT]!.bin.push(HOST, HOST);
  push('the board with an inert bin', ui.show(structuredClone(bare.state)));
  push('the inert bin\'s dialog', ui.click({ btn: 'binopen', p: SEAT }));
  push('shut again', ui.click({ btn: 'binclose' }));
  return out;
}

/** the affordances `html` renders that a real browser would SWALLOW: a
 * `data-act` inside a `data-btn` container, at any depth. */
const swallowed = (html: string): string[] =>
  affordances(html)
    .filter(a => a.act !== null && a.enclosingBtn !== null)
    .map(a => `data-act="${a.act}" is inside data-btn="${a.enclosingBtn}" — ${a.tag.slice(0, 90)}`);

test('R205 §2: no data-act in the rendered board sits inside a data-btn container', () => {
  const seen = corpus();
  assert.ok(seen.length >= 8, 'the corpus is the coverage — it must not quietly shrink');
  let containers = 0;
  for (const { where, html } of seen) {
    containers += affordances(html).filter(a => a.enclosingBtn !== null).length;
    const bad = swallowed(html);
    assert.deepEqual(bad, [],
      `${where}: main.ts's click delegator asks closest('[data-btn]') BEFORE `
      + `closest('[data-act]'), so these affordances are DEAD in a browser and only look `
      + `alive here:\n  ${bad.join('\n  ')}\n`
      + 'The fix is a data-btn on the inner element (see cacheplay / binplay), never a '
      + 'data-act — CARD-TODO #64 prescribed the data-act and it could not have worked.');
  }
  // the same bar as §1, held across the whole corpus: a guard that never saw a
  // container is a guard that would pass on a board with no panels at all
  assert.ok(containers > 0,
    'not one state in the corpus painted a nested affordance — this guard proved nothing');
});

/* ══ §3 THE POSITIVE CONTROL ═══════════════════════════════════════════ */

test('R205 §3: shown the swallowed shape, the detector says so — verbatim', () => {
  // CARD-TODO #64's prescribed fix, written out. It is not reachable from
  // main.ts any more (R192 and R205 both wrote data-btn instead), so it is
  // planted here: §2 without this is a checker with no proof it can go red.
  const planted = '<div class="board"><div class="regioncache" data-btn="cacheopen" data-p="0">'
    + '<div class="regionbinthumbs"><div class="card" data-act="cache" data-p="0" data-i="0">'
    + '<img src="x" alt=""><div class="badges"><span class="badge">live</span></div>'
    + '</div></div></div></div>';
  assert.deepEqual(swallowed(planted).length, 1, 'the detector sees the plant');
  assert.match(swallowed(planted)[0]!, /data-act="cache" is inside data-btn="cacheopen"/);

  // …and it is DEPTH that is being modelled, not adjacency: bury it four more
  // levels down and the answer must not change. The old fake `closest()`
  // answered null for every one of these.
  const deep = '<div data-btn="cacheopen"><div><div><span><b>'
    + '<div data-act="cache"></div></b></span></div></div></div>';
  assert.equal(swallowed(deep).length, 1, 'depth does not save it, and must not hide it either');

  // the counter-cases, so the detector is not just "any nesting is bad":
  // a data-btn inside a data-btn is FINE (closest returns the nearer one), and
  // a data-act with no data-btn above it is fine.
  const ok = '<div data-btn="cacheopen"><div data-btn="cacheplay"></div></div>'
    + '<div class="overlay"><div data-act="cache"></div></div>';
  assert.deepEqual(swallowed(ok), [], 'the nearer data-btn wins, and a free data-act is free');
});

/* ══ §4 CT-82(b): THE BIN PANEL ════════════════════════════════════════ */

test('R205 §4: a bin card usable RIGHT NOW is one click from the region panel', () => {
  const h = loaded(17620);

  // disbelieve the ticket first: the engine has to actually be offering this,
  // or a green test below would be about a client that refused nothing
  const offers = legalActions(h.state, SEAT)
    .filter(a => (a.type === 'augment' || a.type === 'graft' || a.type === 'prophesy')
      && a.from === 'bin');
  assert.ok(offers.length > 0, 'the engine really is offering a bin play in this step');
  const i = (offers[0] as { index: number }).index;

  const html = ui.show(structuredClone(h.state));
  const panel = affordances(html).find(a => a.btn === 'binplay');
  assert.ok(panel, 'the usable bin card carries its own affordance in the mini panel');
  assert.equal(panel.enclosingBtn, 'binopen',
    'nested inside the panel — the shape CT-64\'s prescribed fix would have got wrong');
  assert.equal(panel.act, null, 'and it is a data-btn, not the data-act that would be swallowed');

  // it hands to the DIALOG's handler, so the panel and the dialog do the same
  // thing with the same card: an augment with a host to pick starts modding.
  assert.ok(!html.includes('binbox'), 'the dialog is shut to begin with');
  const after = ui.click({ btn: 'binplay', p: SEAT, i });
  assert.ok(!after.includes('binbox'),
    'ONE click acted on the card — it was not spent opening the dialog');
  assert.match(after, /modhost|candidate/,
    'and the mod flow is live: the click reached handleBinClick, not binopen');
});

test('R205 §4: an unusable bin thumb keeps the old route — the click opens the zone', () => {
  const h = deployment(17621);
  h.state.players[SEAT]!.bin.push(HOST, HOST);
  assert.deepEqual(
    legalActions(h.state, SEAT).filter(a => 'from' in a && a.from === 'bin'), [],
    'nothing in this bin is usable in this step');

  const html = ui.show(structuredClone(h.state));
  const thumb = scanTag(html.slice(html.indexOf('class="regionbin')), HOST);
  assert.doesNotMatch(thumb, /data-btn=/, 'the inert thumb claims no click of its own');
  assert.doesNotMatch(thumb, /data-act=/, 'and offers no action either');

  assert.ok(!html.includes('binbox'), 'shut before');
  const after = ui.click({ btn: 'binopen', p: SEAT });
  assert.ok(after.includes('binbox'), 'clicking the panel still opens the full bin');
  assert.ok(after.includes(HOST), 'with the cards in it');
});

/* ══ §5 CT-82(c): ATTRIBUTES A REGEX CAN SPAN ══════════════════════════ */

/** class attributes with a doubled, leading or trailing space — the shape a
 * multi-slot template writes when one of its slots comes out empty */
const looseClasses = (html: string): string[] =>
  [...html.matchAll(/class="([^"]*)"/g)].map(m => m[1]!).filter(c => /\s\s|^\s|\s$/.test(c));

/** two attributes on ONE line with more than one space between them — the
 * `class="card"␣␣data-prev=` shape. A newline plus indentation is deliberate
 * template formatting and is not this. */
const looseGaps = (html: string): string[] =>
  [...html.matchAll(/"[ \t][ \t]+[a-zA-Z-]+="/g)].map(m => m[0]!);

test('R205 §5: nothing the client writes has a doubled or trailing space in a class', () => {
  for (const { where, html } of corpus()) {
    assert.deepEqual([...new Set(looseClasses(html))], [],
      `${where}: a class attribute with a stray space. CSS does not care and a regex does — `
      + 'this is how /badge offer/ became an assertion that could never fail (CT-65/R192). '
      + 'Build the list with a conditional that carries its own space, or filter(Boolean).join.');
    assert.deepEqual([...new Set(looseGaps(html))], [],
      `${where}: two attributes on one line with more than one space between them. `
      + 'An empty `${opts.data}` slot writing `class="card"  data-prev=` defeats any regex '
      + 'spanning the pair.');
  }
});

test('R205 §5: …and the check can go red — it is not matching nothing', () => {
  assert.deepEqual(looseClasses('<div class="card  cached">'), ['card  cached']);
  assert.deepEqual(looseClasses('<div class="card ">'), ['card ']);
  assert.deepEqual(looseGaps('<div class="card"  data-prev="x">'), ['"  data-prev="']);
  // and the shapes that are fine stay fine
  assert.deepEqual(looseClasses('<div class="card cached">'), []);
  assert.deepEqual(looseGaps('<div class="card"\n    data-prev="x">'), []);
});

/* ══ §6 CT-82(d): THE SECOND SERIALISER ════════════════════════════════ */

const mv = (from: string | null, to: string | null): { fromAnchor: string | null; toAnchor: string | null } =>
  ({ fromAnchor: from, toAnchor: to });

test('R205 §6: flights that made the same journey in one render share a beat', () => {
  // R189's own moment, one layer down: four units die in a seat's field and
  // four triggers land on the stack in ONE update. That is one thing happening
  // and was drawn as four, 45ms apart, because the delay was the array index.
  const batch = [mv('@field:0', '@stack'), mv('@field:0', '@stack'),
    mv('@field:0', '@stack'), mv('@field:0', '@stack')];
  assert.deepEqual(flightDelays(batch), [0, 0, 0, 0],
    'one journey, one beat — the batch leaves together');
});

test('R205 §6: a sequence still looks sequential — different journeys are spaced', () => {
  const chain = [mv('@hand:0', '@stack'), mv('@stack', '@field:0'), mv('@field:1', '@bin:1')];
  assert.deepEqual(flightDelays(chain), [0, 45, 90],
    'three different trips are three beats, exactly as before');

  // …and the two halves compose: a batch inside a sequence stays a batch, and
  // it does not consume a step per member
  const mixed = [mv('@hand:0', '@field:0'), mv('@field:1', '@stack'),
    mv('@hand:0', '@field:0'), mv('@hand:0', '@field:0')];
  assert.deepEqual(flightDelays(mixed), [0, 45, 0, 0],
    'the second and later members of a journey rejoin its beat wherever they sit in the list');
});

test('R205 §6: POSITIVE EVIDENCE ONLY — a flight with an unnamed end keeps its own step', () => {
  // R189's third consequence, held to literally: "a batch the client can read
  // nothing about behaves exactly as it did before". A `leave` (erased,
  // trashed) has no destination and an `enter` (a token out of nowhere) has no
  // origin, so neither can be shown to be simultaneous with anything.
  const unknown = [mv('@field:0', null), mv('@field:0', null), mv(null, '@field:0')];
  assert.deepEqual(flightDelays(unknown), [0, 45, 90],
    'a null end is not evidence of a shared arrival, so nothing is merged on it');

  // a known journey next to unknown ones still groups
  const mix = [mv('@field:0', null), mv('@hand:0', '@field:0'), mv('@hand:0', '@field:0')];
  assert.deepEqual(flightDelays(mix), [0, 45, 45]);
});

test('R205 §6: the cap still holds, and it caps BEATS not cards', () => {
  // twelve cards on twelve different trips: the old stagger and the new one
  // agree exactly, which is what makes this a refactor for every case that is
  // not a batch
  const twelve = Array.from({ length: 12 }, (_, i) => mv(`@field:${i}`, '@stack'));
  assert.deepEqual(flightDelays(twelve),
    [0, 45, 90, 135, 180, 220, 220, 220, 220, 220, 220, 220],
    'i * 45 capped at 220, unchanged');

  // twelve cards on ONE trip is one beat, and the cap never comes near
  const one = Array.from({ length: 12 }, () => mv('@field:0', '@stack'));
  assert.deepEqual(flightDelays(one), Array.from({ length: 12 }, () => 0));

  assert.deepEqual(flightDelays([]), [], 'and an empty render animates nothing');
});
