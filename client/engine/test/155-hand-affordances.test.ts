/* R183 / CT-49 + CT-50 — WHAT THE HAND'S GREEN RING IS ACTUALLY SAYING.
 *
 * TWO TICKETS, ONE SURFACE, ON PURPOSE.
 *
 * CARD-TODO #54. A card in hand wore a single undifferentiated `.card.playable`
 * outline that was the OR of FIVE actions — `playCard`, `augment`, `graft`,
 * `prophesy`, `recycleForResource`. A {Battle} spell during deployment, which
 * can only be GRAFTED, was therefore drawn exactly like a castable deployment
 * card, and the client disambiguated only after the click.
 *
 * That is playtest report #80. #80 itself is `by-design` — the owner withdrew
 * it himself (*"It was offering me to GRAFT the ability from hand, which is
 * legal"*) — but the reason he misread the board in the first place is the
 * ring. ⚠ And the finding had been recorded ONLY inside #80's closing note,
 * which claimed it was "filed as a separate UI item". No such item existed.
 *
 * CARD-TODO #63 (report #103). Cached cards that CAN be played should also
 * appear at the right-hand end of the hand area — *"it feels like they're in
 * your hand (which is should), is clearly different from cards in hand (they're
 * on the left) and are harder to just forget about."* Explicitly ADDITIVE:
 * *"They should also be in the cache area as they are now, this is just an
 * easier way to see and play them."*
 *
 * They are the same ticket because adding a SIXTH class of card to a strip
 * whose ring already OR-folds five action kinds makes the ambiguity worse, not
 * better. The vocabulary is designed once, in ui/inspect.ts:
 *
 *   the ring EXISTS       → "something is on offer here"      (unchanged)
 *   the ring's LOOK       → `.nocast` = you cannot CAST this, only the named
 *                           verbs · `.multi` = more than one, the click asks
 *   an `offer` CHIP       → the verbs, by name
 *   `.cached` + its group → "…and this one is not in your hand at all"
 *
 * §1  A castable card in hand is UNCHANGED — the class string is still exactly
 *     `card playable` and it wears no offer chip. This section is the brake on
 *     every other one: the common case must not pay for the ambiguous ones.
 * §2  THE #80 CASE. A {Battle} spell in deployment, graftable, is not drawn the
 *     same as a castable deployment card, and says "graft".
 * §3  TWO KINDS AT ONCE say so — both verbs on the chip, and a ring that warns
 *     the click will ask.
 * §4  CT-50. A playable cached card is drawn at the RIGHT of the hand AND left
 *     in the cache row, and clicking EITHER copy plays it.
 * §5  An unplayable cached entry is in the cache row and nowhere near the hand.
 *
 * HOW THE CLIENT IS DRIVEN. test/ui-driver.ts in hotseat mode — a fake DOM, no
 * socket, main.ts's own Harness, clicks through main.ts's own handlers.
 * ⚠ Nothing here reads ui/main.ts as SOURCE TEXT. Two tests that did broke last
 * round on a pure refactor while the invariant they were about held perfectly.
 * Every assertion below is about markup the client really produced or a click
 * it really took.
 *
 * Seeds 15500-15599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import { registerSynthetic } from '../src/cards/dsl.ts';
import { handOfferBadge, handOffers, playableCachedIndexes } from '../../ui/inspect.ts';
import { give, spawn } from './util.ts';
import type { GameState, Seat } from '../src/types.ts';

/* ── the client, hotseat ─────────────────────────────────────────────── */
// set BEFORE the driver is imported, and the import must therefore be dynamic:
// a static one is hoisted and would run the driver (and ui/main.ts with it)
// before this line ever executed.
(globalThis as Record<string, unknown>)['__UI_DRIVER_SEARCH'] = '?hotseat=1';
const { local, zone } = await import('./ui-driver.ts');
const ui = local();

/* ── fixtures ────────────────────────────────────────────────────────── */

const SEAT: Seat = 0;

/** the plain case §1 protects: a free deployment spell, castable and nothing
 * else. No augment attrs, no [Switch], no prophecy banner. */
const PLAIN = 'B6 Plain Deploy';
registerSynthetic({
  name: PLAIN, cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Gain 1 life.',
}, { spellEffect: { run: (g, ctx) => { g.gainLife(ctx.controller, 1, PLAIN); } } });

/** a host that can RECEIVE grafts — `graftCauseIndex` wants an ability marked
 * as the graft cause (Manual p.33), and without one `pushMods` offers nothing */
const HOST = 'B6 Graft Host';
registerSynthetic({
  name: HOST, cost: '', mana: 0, power: 2, toughness: 2,
  type: 'Test Unit', kind: 'unit', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: '[Switch] When I attack, gain 1 life.',
}, {
  abilities: [{
    type: 'triggered', events: ['attacked'], label: 'gain 1 life', graftCause: true,
    effect: { run: (g, ctx) => { g.gainLife(ctx.controller, 1, HOST); } },
  }],
});

/** ⚠ THE #80 CARD: {Battle} timing, so it cannot be CAST during deployment —
 * and graftable, so `pushMods` offers it anyway. Before R183 this wore the
 * identical ring the PLAIN card above wears. */
const BATTLE_GRAFT = 'B6 Battle Switch';
registerSynthetic({
  name: BATTLE_GRAFT, cost: '', mana: 0, power: 0, toughness: 0,
  type: '{Battle} Test Spell', kind: 'spell', timing: 'battle', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: '[Switch] Gain 1 life.',
}, {
  spellEffect: { run: (g, ctx) => { g.gainLife(ctx.controller, 1, BATTLE_GRAFT); } },
  graftEffect: { bounded: false, effect: { run: (g, ctx) => { g.gainLife(ctx.controller, 1, BATTLE_GRAFT); } } },
});

/** §3: castable AND an augment — two kinds on one card, at the same instant */
const TWO_WAYS = 'B6 Two Ways';
registerSynthetic({
  name: TWO_WAYS, cost: '', mana: 0, power: 1, toughness: 1,
  type: 'Test Unit', kind: 'unit', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: ['Flying'], image: '',
  text: '[Augment] Flying.',
}, {});

/** §4/§5: the cached cards. One deployment-timed (playable from a live glimpse
 * during deployment) and one {Battle}-timed (permitted, live, and wrong step —
 * so it is in the cache row and must NOT reach the hand). */
const CACHED_NOW = 'B6 Cached Now';
registerSynthetic({
  name: CACHED_NOW, cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Gain 3 life.',
}, { spellEffect: { run: (g, ctx) => { g.gainLife(ctx.controller, 3, CACHED_NOW); } } });

const CACHED_LATER = 'B6 Cached Later';
registerSynthetic({
  name: CACHED_LATER, cost: '', mana: 0, power: 0, toughness: 0,
  type: '{Battle} Test Spell', kind: 'spell', timing: 'battle', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Gain 3 life. [Battle]',
}, { spellEffect: { run: (g, ctx) => { g.gainLife(ctx.controller, 3, CACHED_LATER); } } });

/** turn 1, in DEPLOYMENT — the step every section below is set during. Same
 * shape 144-hotseat-decision-gate uses, deliberately. */
function deployment(): Harness {
  const h = new Harness(15500);
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

/** the markup of ONE hand card, found by the affordance it carries */
function handCard(html: string, i: number): string {
  const at = html.indexOf(`data-act="hand" data-p="${SEAT}" data-i="${i}"`);
  assert.ok(at >= 0, `hand card ${i} is not on screen at all`);
  const open = html.lastIndexOf('<div', at);
  return html.slice(open, html.indexOf('>', at) + 1);
}

/** the `class="…"` of that card, as the client wrote it */
const classOf = (tag: string): string => (/class="([^"]*)"/.exec(tag) ?? [])[1] ?? '';

/* ═══ §1 THE PLAIN CARD IS UNTOUCHED ══════════════════════════════════ */

test('R183 §1: a plainly castable card in hand is drawn exactly as it always was', () => {
  const h = deployment();
  const i = give(h, SEAT, PLAIN);
  const html = ui.show(structuredClone(h.state));

  // the class string, byte for byte. `.nocast`/`.multi`/`.cached` are appended
  // AFTER `.activatable` in cardClasses for precisely this reason: the common
  // case must not move because the ambiguous ones got a vocabulary.
  assert.equal(classOf(handCard(html, i)), 'card playable',
    'the ordinary castable card still wears exactly `card playable`');

  // and no chip: "cast" is the unmarked default meaning of a card in your hand,
  // so a chip saying so would be noise on every card in every hand.
  // ⚠ `badge[^"]*offer`, not `badge offer`: cardHtml writes the chip class as
  // `badge ${mod} ${ctr} ${cls}`, so there are two empty slots between them and
  // a naive space-separated regex would never match — i.e. would never fail.
  const whole = zone(html, `hand:${SEAT}`);
  assert.doesNotMatch(whole, /badge[^"]*offer/, 'and no offer chip anywhere in the hand');
});

/* ═══ §2 THE #80 CASE ═════════════════════════════════════════════════ */

test('R183 §2: a {Battle} spell in deployment is NOT drawn like a castable deployment card', () => {
  const h = deployment();
  spawn(h, SEAT, HOST);                       // something with a graft cause to land on
  const plain = give(h, SEAT, PLAIN);
  const graft = give(h, SEAT, BATTLE_GRAFT);

  // ⚠ DISBELIEVE THE TICKET FIRST. If the rules layer were not offering the
  // graft, this would be a rules bug wearing a rendering bug's clothes and the
  // fix below would be painting a lie. Measure the offer, in this position.
  const legal = legalActions(h.state, SEAT);
  assert.ok(legal.some(a => a.type === 'graft' && a.from === 'hand' && a.index === graft),
    'the engine really is offering the GRAFT from hand — this is report #80\'s position');
  assert.ok(!legal.some(a => a.type === 'playCard' && a.handIndex === graft),
    '…and really is not offering the cast: {Battle} timing, during deployment');

  const html = ui.show(structuredClone(h.state));
  const graftTag = handCard(html, graft), plainTag = handCard(html, plain);

  // THE BUG, in one line: before R183 these two strings were identical.
  assert.notEqual(classOf(graftTag), classOf(plainTag),
    'the graft-only card and the castable card are not drawn the same');
  assert.match(classOf(graftTag), /\bplayable\b/, 'it is still offered — the ring stays on');
  assert.match(classOf(graftTag), /\bnocast\b/, '…but the ring says CASTING is not what is on offer');
  assert.doesNotMatch(classOf(plainTag), /\bnocast\b/, 'and the castable card is not so marked');

  // and the ring is not the only channel: the chip names the verb.
  assert.match(html, /badge[^"]*offer[^"]*nocast[^>]*>⇄ graft</,
    'the card says "graft" in words, not only in colour');
});

/* ═══ §3 TWO KINDS AT ONCE ════════════════════════════════════════════ */

test('R183 §3: a card offering two kinds at once says which two', () => {
  const h = deployment();
  spawn(h, SEAT, HOST);                       // a unit of mine for the augment to land on
  const both = give(h, SEAT, TWO_WAYS);

  const legal = legalActions(h.state, SEAT);
  const kinds = handOffers(legal, both);
  assert.deepEqual(kinds, ['cast', 'augment'],
    'the fixture really is offering both — the ticket is about a card that does');

  const html = ui.show(structuredClone(h.state));
  const cls = classOf(handCard(html, both));
  assert.match(cls, /\bplayable\b/, 'offered');
  assert.match(cls, /\bmulti\b/, 'and marked as a CHOICE, because the click will ask');
  assert.doesNotMatch(cls, /\bnocast\b/, 'casting IS among them, so the ring stays a cast ring');
  assert.match(html, /badge[^"]*offer[^"]*multi[^>]*>⑂ cast\/augment</,
    'and both verbs are named on the chip');
});

test('R183 §3: the offer chip is the pure judgement, not a coincidence of this position', () => {
  // the vocabulary as a function: same input, same words, no DOM in sight.
  assert.equal(handOfferBadge(['cast']), null,
    'cast alone is the unmarked case — no chip');
  assert.equal(handOfferBadge(['prophesy']), null,
    'prophesy alone is already named in full, with its banner cost, by the hand\'s own '
    + '📜 chip — two chips saying it would just fold each other away');
  assert.equal(handOfferBadge([])?.t, undefined, 'nothing offered, nothing said');
  assert.equal(handOfferBadge(['graft'])!.t, '⇄ graft');
  assert.match(handOfferBadge(['graft'])!.cls!, /\bnocast\b/);
  assert.equal(handOfferBadge(['recycle'])!.t, '♻ recycle');
  assert.equal(handOfferBadge(['cast', 'graft'])!.t, '⑂ cast/graft');
  assert.match(handOfferBadge(['augment', 'graft'])!.cls!, /\bmulti\b.*\bnocast\b/,
    'two kinds and neither is casting — BOTH facts, because they are different questions');
});

/* ═══ §4 CT-50: THE CACHED CARD, TWICE ════════════════════════════════ */

/** a live glimpse stamp on `name` for `seat`, i.e. R45 permission that expires
 * at end of THIS turn — the silent loss the ticket is about */
function glimpse(h: Harness, seat: Seat, name: string): number {
  const pl = h.state.players[seat]!;
  pl.cache ??= [];
  pl.cache.push({ card: name, uid: 9000 + pl.cache.length, playableUntilTurn: h.state.turn });
  return pl.cache.length - 1;
}

test('R183 §4: a playable cached card is drawn at the right of the hand AND left in the cache row', () => {
  const h = deployment();
  const inHand = give(h, SEAT, PLAIN);
  const i = glimpse(h, SEAT, CACHED_NOW);

  const legal = legalActions(h.state, SEAT);
  assert.deepEqual(playableCachedIndexes(legal), [i],
    'the engine really is offering this cached play right now');

  const html = ui.show(structuredClone(h.state));

  // BOTH surfaces. The cache row is untouched — the owner was explicit: "They
  // should also be in the cache area as they are now."
  assert.match(zone(html, 'cache:0'), new RegExp(CACHED_NOW),
    'the cache row still holds it — this is a second surface, not a move');

  // …and the second one is inside the hand zone, to the RIGHT of the hand.
  const hand = zone(html, `hand:${SEAT}`);
  assert.match(hand, /class="handcached"/, 'the cached group rides in the hand zone');
  const handAt = hand.indexOf(`data-act="hand" data-p="${SEAT}" data-i="${inHand}"`);
  const cacheAt = hand.indexOf('data-act="cache"');
  assert.ok(handAt >= 0 && cacheAt > handAt,
    'and it comes AFTER every real hand card — "they\'re on the left", report #103');

  // the sixth thing the strip has to say, said: not-in-your-hand, and expiring.
  const tag = hand.slice(hand.lastIndexOf('<div', cacheAt), hand.indexOf('>', cacheAt) + 1);
  assert.match(classOf(tag), /\bplayable\b.*\bcached\b/,
    'it is playable AND it is a cached card — two facts, two words');
  assert.match(hand, /👁 this turn/,
    'the chip is the EXPIRY, because forgetting it is the loss the ticket is about');
});

test('R183 §4: clicking the copy beside the hand plays the cached card, exactly as the cache row does', () => {
  const h = deployment();
  glimpse(h, SEAT, CACHED_NOW);

  // the hand-side copy
  ui.show(structuredClone(h.state));
  const before = ui.state().players[SEAT]!.life;
  const hand = zone(ui.html(), `hand:${SEAT}`);
  assert.match(hand, /data-act="cache"/, 'the copy beside the hand is on screen');
  ui.click({ act: 'cache', p: SEAT, i: 0 });
  assert.equal(ui.state().players[SEAT]!.life, before + 3, 'clicking it PLAYED the card');
  assert.equal(ui.state().players[SEAT]!.cache?.length ?? 0, 0, 'and it left the cache');

  // the cache row's own copy, from a fresh state — same handler, same result,
  // which is the point of giving both surfaces the same `data-act="cache"`.
  const h2 = deployment();
  glimpse(h2, SEAT, CACHED_NOW);
  ui.show(structuredClone(h2.state));
  const life2 = ui.state().players[SEAT]!.life;
  ui.click({ btn: 'cacheopen', p: SEAT });          // the full cache dialog
  ui.click({ act: 'cache', p: SEAT, i: 0 });
  assert.equal(ui.state().players[SEAT]!.life, life2 + 3,
    'and the cache row still plays it too — this is additive, not a move');
});

/* ═══ §5 THE NEGATIVE CONTROL ═════════════════════════════════════════ */

test('R183 §5: a cached card that is NOT playable now stays in the cache row and out of the hand', () => {
  const h = deployment();
  give(h, SEAT, PLAIN);
  glimpse(h, SEAT, CACHED_LATER);              // {Battle} timing, live stamp, wrong step

  const legal = legalActions(h.state, SEAT);
  assert.deepEqual(playableCachedIndexes(legal), [],
    'permitted and live, but not playable in THIS step — the whole point of the filter');

  const html = ui.show(structuredClone(h.state));
  const hand = zone(html, `hand:${SEAT}`);
  assert.doesNotMatch(hand, /class="handcached"/,
    'nothing playable, so no cached group beside the hand at all');
  assert.doesNotMatch(hand, /data-act="cache"/, 'and no cached card in the hand zone');

  // …but it has NOT been hidden: the zone it lives in still shows it.
  assert.match(html, /data-animzone="cache:0"/, 'the cache row is on screen');
  assert.match(zone(html, 'cache:0'), new RegExp(CACHED_LATER),
    'and the entry is still in it — the second surface is a shortcut, not the zone');
});

/* ═══ §6 THE STATE THE TICKET IS REALLY ABOUT ═════════════════════════ */

test('R183 §6: an empty hand with a live cached play still draws the reminder', () => {
  // the forgetting case in its purest form: nothing in hand, one thing in the
  // cache that expires at end of turn. `handZoneHtml` is still rendered (the
  // hand is empty, not hidden), so the strip is where the reminder can live.
  const h = deployment();
  h.state.players[SEAT]!.hand = [];
  glimpse(h, SEAT, CACHED_NOW);

  const hand = zone(ui.show(structuredClone(h.state)), `hand:${SEAT}`);
  assert.match(hand, /class="handcached"/,
    'an empty hand is exactly when a cached card is easiest to walk past');
  assert.match(hand, /data-act="cache" data-p="0" data-i="0"/, 'and it is clickable there');
});

/* ═══ §7 THE OTHER THREE KINDS, THROUGH THE CLIENT ════════════════════ */

test('R183 §7: recycling in planning is a ring that says recycle, not a ring that says cast', () => {
  // the fifth folded kind, and the one that is furthest from "cast": during
  // PLANNING a hand card's only offer is recycleForResource, and it used to
  // wear the identical green cast ring.
  const h = new Harness(15501);
  assert.equal(h.state.phase, 'planning', 'turn 1 opens in planning');
  const i = give(h, SEAT, PLAIN);

  const legal = legalActions(h.state, SEAT);
  assert.deepEqual(handOffers(legal, i), ['recycle'],
    'recycle-for-resource, and nothing else, is what planning offers a hand card');

  const html = ui.show(structuredClone(h.state));
  const cls = classOf(handCard(html, i));
  assert.match(cls, /\bplayable\b/, 'still offered');
  assert.match(cls, /\bnocast\b/, 'and marked as not-a-cast');
  assert.match(html, /badge[^"]*offer[^"]*nocast[^>]*>♻ recycle</, 'and it says so');
});

/* the state used above is cloned into the client, so nothing here leaks into
 * another test file's Harness — but assert it, because a shared client is the
 * one thing in this file two tests could fight over */
test('R183: the driver is holding its own state, not a fixture Harness', () => {
  const h = deployment();
  const before: GameState = structuredClone(h.state);
  ui.show(structuredClone(h.state));
  ui.state().players[0]!.life = 99;
  assert.notEqual(before.players[0]!.life, 99, 'the fixture is untouched by the client');
});
