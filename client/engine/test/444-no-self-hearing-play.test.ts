/* CR 701.1e — A CARD NEVER HEARS ITS OWN PLAY. Whole pool, derived.
 *
 * The owner, answering D-U14-11 (reading B), 2026-10-11: an ability that
 * triggers when its controller plays a unit, a spell or a card works only
 * while its card is in play. A card being played is on the stack, not in
 * play, so its own play never triggers it, whether or not it prints
 * "another", and whatever zone it is played from. ("No units should be able
 * to see themselves go onto the stack, of course.")
 *
 * WHY A SWEEP AND NOT A CARD TEST. CT-277 found one card (Stalwart Sentinel,
 * played out of a bin by Wake the Dead, took its own two counters) after
 * CT-254 had already settled Bloomcaster. A card test for each would leave the
 * next listener unasked. So the population is DERIVED from the registry:
 *
 *   · every triggered ability (own text or [Augment] text, not a bin/cache
 *     `zone` clause) listening on a PLAY event, `cardPlayed` or `spellPlayed`;
 *   · every one listening on `spawned` whose printed text is a play clause
 *     ("When you play …"). A plain unit play is announced on its own 'spawned',
 *     so a card that reads 'spawned' as a play is a play listener too.
 *     A 'spawned' listener that says "When I spawn" or "another ally spawns" is
 *     about arriving, not about playing, and is outside this rule.
 *
 * Each card is then PLAYED through every route the engine has for a unit to be
 * played, each by a real effect or action:
 *
 *   hand   playCard in deployment (the stack, then resolution);
 *   cache  playCached after cacheTopOfDeck (CR 403.3b);
 *   bin    Wake the Dead, "Play up to two units in any bin" (the `asPlay` spawn);
 *   deck   Tides of the Cosmos, "You may play them now, for free" (CR 701.4 push).
 *
 * The check is on the trigger LOG, not on a side effect, so it reads every card
 * the same way: no "Trigger: <card> — <that ability's label>." line may be
 * logged for the very entity the play created.
 *
 * ── ON BLINDNESS (test 147's header) ──────────────────────────────────────
 * A sweep that silently drives nothing passes. So the reach is MEASURED and
 * asserted: the population has a floor, every route must have driven a floor
 * of cards, the known listeners must be in the population, and the detector is
 * calibrated on a firing it must see (a Sentinel already in play hearing the
 * second unit Wake the Dead plays).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { allCardNames, getCard, type TriggeredAbility } from '../src/cards/dsl.ts';
import type { EngineEvent, EntityId, EventType, Seat } from '../src/types.ts';
import printed from '../src/cards/printed.json' with { type: 'json' };
import { give, giveResources, spawn, toDeployment, toNextBattle, unitsOf, withE } from './util.ts';

const PLAY_EVENTS: EventType[] = ['cardPlayed', 'spellPlayed'];
/** a trigger condition about PLAYING: "When you play …", "Whenever a player plays …" */
const PLAY_CLAUSE = /\bwhen(?:ever)?\b[^.]*?\bplays?\b/i;
const ELEMENTS = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'] as const;

interface Listener { card: string; label: string; why: string }

function textOf(name: string): string {
  const row = (printed as Record<string, { text?: string }>)[name];
  return row?.text ?? '';
}

/** the derived population: (card, play-listening ability) */
function population(): Listener[] {
  const out: Listener[] = [];
  for (const card of allCardNames()) {
    const def = getCard(card);
    for (const list of [def.abilities, def.augmentText]) {
      for (const a of list ?? []) {
        if (a.type !== 'triggered') continue;
        const t = a as TriggeredAbility;
        if (t.zone) continue;
        const why: string[] = t.events.filter(e => PLAY_EVENTS.includes(e));
        if (t.events.includes('spawned') && !t.self && PLAY_CLAUSE.test(textOf(card))) why.push('spawned');
        if (why.length) out.push({ card, label: t.label, why: why.join('+') });
      }
    }
  }
  return out;
}

const POP = population();
const CARDS = [...new Set(POP.map(l => l.card))].sort();

/** every resource kind open in bulk, so affinity and mana never decide reach */
function fund(h: Harness, seat: Seat): void {
  for (const el of ELEMENTS) giveResources(h, seat, el, 6);
  giveResources(h, seat, 'prismite', 6);
}

/** Answer whatever the board asks until it is quiet: trigger order in the
 *  identity order, `pick(dec)` for the route's own questions, the first option
 *  for anything else, and pass priority while the stack is non-empty. */
function settle(h: Harness, pick?: (labels: string[]) => number | null): void {
  let guard = 80;
  while (guard-- > 0) {
    const dec = h.state.decision;
    if (dec?.kind === 'orderTriggers') {
      h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
      continue;
    }
    if (dec) {
      const mine = pick?.(dec.options.map(o => o.label));
      h.do({ type: 'decide', seat: dec.seat, choice: mine ?? 0 });
      continue;
    }
    if (h.state.stack.length && h.state.priority !== null) {
      h.do({ type: 'passPriority', seat: h.state.priority });
      continue;
    }
    return;
  }
  throw new Error('settle did not terminate');
}

type Route = 'hand' | 'cache' | 'bin' | 'deck';
const ROUTES: Route[] = ['hand', 'cache', 'bin', 'deck'];

/** Play `card` by `route` for seat A. Returns the window of events the play
 *  produced, or a reason it could not be driven. */
function drive(card: string, route: Route, seed: number): { events: EngineEvent[]; A: Seat } | { skip: string } {
  const h = new Harness(seed, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let from = 0;
  if (route === 'hand' || route === 'cache') {
    fund(h, A);
    from = h.events.length;
    if (route === 'hand') {
      h.do({ type: 'playCard', seat: A, handIndex: give(h, A, card) });
    } else {
      h.state.sharedDeck.unshift(card);
      withE(h, e => { e.cacheTopOfDeck(A, 1, { playable: true }); });
      if (!h.state.players[A]!.cache?.some(c => c.card === card)) return { skip: 'not cached' };
      h.do({ type: 'playCached', seat: A, index: h.state.players[A]!.cache!.findIndex(c => c.card === card) });
    }
    settle(h);
  } else {
    const atk = spawn(h, A, 'Unit Token');
    fund(h, A);
    toNextBattle(h, A);
    if (h.state.phase !== 'battle' || h.state.battle?.attacker !== A) return { skip: 'no battle for A' };
    h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
    if (route === 'bin') {
      h.state.players[A]!.bin.push(card);
      from = h.events.length;
      h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Wake the Dead') });
      settle(h, labels => {
        const i = labels.findIndex(l => l.startsWith(`${card} [`));
        return i >= 0 ? i : labels.indexOf('Done');
      });
    } else {
      h.state.sharedDeck.unshift(card);
      from = h.events.length;
      h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Tides of the Cosmos') });
      settle(h, labels => {
        const i = labels.findIndex(l => l.startsWith(`${card} [`));
        if (i >= 0) return i;
        const play = labels.indexOf(`Play ${card}`);
        if (play >= 0) return play;
        const done = labels.indexOf('Done');
        return done >= 0 ? done : null;
      });
    }
  }
  return { events: h.events.slice(from), A };
}

/** the entity the play created: the card's own 'spawned' line in the window */
function arrived(events: EngineEvent[], card: string, A: Seat): EntityId | undefined {
  const ev = events.find(e => e.type === 'spawned' && e.data?.['card'] === card && e.data?.['seat'] === A
    && e.data?.['from'] !== undefined);
  return ev?.data?.['unit'] as EntityId | undefined;
}

/** the trigger lines `card`'s play listeners logged for entity `id` */
function selfHeard(events: EngineEvent[], card: string, id: EntityId): string[] {
  const lines = new Set(POP.filter(l => l.card === card).map(l => `Trigger: ${card} — ${l.label}.`));
  return events.filter(e => e.type === 'triggered' && e.data?.['unit'] === id && lines.has(e.msg)).map(e => e.msg);
}

// ── the sweep: one result per (card, route), computed once ───────────────
type Outcome = { card: string; route: Route; heard?: string[]; skip?: string };
const RESULTS: Outcome[] = [];
CARDS.forEach((card, ci) => {
  ROUTES.forEach((route, ri) => {
    let r: ReturnType<typeof drive>;
    try { r = drive(card, route, 44400 + ci * 10 + ri); }
    catch (err) { RESULTS.push({ card, route, skip: `threw: ${(err as Error).message.slice(0, 80)}` }); return; }
    if ('skip' in r) { RESULTS.push({ card, route, skip: r.skip }); return; }
    const id = arrived(r.events, card, r.A);
    if (id === undefined) { RESULTS.push({ card, route, skip: 'never arrived in play' }); return; }
    RESULTS.push({ card, route, heard: selfHeard(r.events, card, id) });
  });
});
const driven = (route?: Route) => RESULTS.filter(r => r.heard && (!route || r.route === route));

// ── reach ────────────────────────────────────────────────────────────────

test('CR 701.1e reach: the derived population of play listeners holds the known ones and has not collapsed', () => {
  for (const known of ['Stalwart Sentinel', 'Proph', 'Bloomcaster', 'Void Mandible', 'Sparkwraith']) {
    assert.ok(CARDS.includes(known), `${known} is a play listener and must be in the derived population`);
  }
  assert.ok(POP.some(l => l.why.endsWith('spawned')), 'the spawned-as-play arm found nothing: PLAY_CLAUSE or printed.json went blind');
  // 21 on 2026-10-11. Ancient One is among them only through its "all
  // abilities of adjacent allies" listener: played alone it has nothing to
  // hear, so it is driven but proves nothing about itself.
  assert.ok(CARDS.length >= 20, `only ${CARDS.length} play-listening cards derived (21 on 2026-10-11)`);
});

test('CR 701.1e reach: every route drove the population into play', () => {
  const floors: Record<Route, number> = { hand: 20, cache: 20, bin: 20, deck: 20 };
  const skips = RESULTS.filter(r => r.skip).map(r => `${r.card} via ${r.route}: ${r.skip}`);
  for (const route of ROUTES) {
    const n = driven(route).length;
    assert.ok(n >= floors[route], `route ${route} drove only ${n} of ${CARDS.length} cards (floor ${floors[route]}); not driven:\n  ${skips.filter(s => s.includes(` via ${route}:`)).join('\n  ')}`);
  }
  for (const known of ['Stalwart Sentinel', 'Proph', 'Bloomcaster', 'Void Mandible']) {
    for (const route of ['cache', 'bin', 'deck'] as Route[]) {
      assert.ok(driven(route).some(r => r.card === known), `${known} was not driven via ${route}`);
    }
  }
});

test('CR 701.1e reach: the coverage, as a diagnostic', t => {
  t.diagnostic(`${CARDS.length} play-listening cards: ${CARDS.join(', ')}`);
  for (const route of ROUTES) t.diagnostic(`${route}: ${driven(route).length} driven`);
  for (const r of RESULTS.filter(x => x.skip)) t.diagnostic(`not driven: ${r.card} via ${r.route} (${r.skip})`);
});

test('CR 701.1e calibration: the detector sees a Stalwart Sentinel hear a unit played after it', () => {
  // Wake the Dead plays the Sentinel FIRST and a second unit after it. The
  // second play is heard (the Sentinel is in play by then): 2 counters, and
  // the trigger line this sweep looks for is logged. The first play, its own,
  // must not be.
  const h = new Harness(44471, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const atk = spawn(h, A, 'Unit Token');
  fund(h, A);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.bin.push('Stalwart Sentinel', 'Curio Drifter');
  const from = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Wake the Dead') });
  let k = 0;
  settle(h, labels => {
    const want = k++ === 0 ? 'Stalwart Sentinel [' : 'Curio Drifter [';
    const i = labels.findIndex(l => l.startsWith(want));
    return i >= 0 ? i : null;
  });
  const events = h.events.slice(from);
  const id = arrived(events, 'Stalwart Sentinel', A)!;
  assert.ok(id !== undefined, 'the Sentinel was played from the bin');
  assert.ok(unitsOf(h, A).some(u => u.card === 'Curio Drifter'), 'and the Drifter after it');
  assert.equal(selfHeard(events, 'Stalwart Sentinel', id).length, 1,
    'the detector sees exactly one firing ([once])');
  // …and it is the DRIFTER's: logged after the Drifter arrived. A Sentinel that
  // heard itself spends its [once] on its own arrival, before the Drifter.
  const fired = events.findIndex(e => e.type === 'triggered' && e.data?.['unit'] === id);
  const drifter = events.findIndex(e => e.type === 'spawned' && e.data?.['card'] === 'Curio Drifter');
  assert.ok(drifter >= 0 && fired > drifter, 'the one firing came after the Drifter arrived, so it heard the Drifter');
  assert.equal(h.state.entities[id]!.counters, 2, 'two counters, for the Drifter alone');
});

// ── the rule, per route, naming each convicted card ──────────────────────

// Four literal titles, not a loop: the ledgers name these tests as guards, and
// 83 reads titles off the source text.
function noneHeardItself(route: Route): void {
  const convicted = driven(route).filter(r => r.heard!.length)
    .map(r => `${r.card} (${r.heard!.join(' / ')})`);
  assert.deepEqual(convicted, [], `these cards heard their own play from ${route}:\n  ${convicted.join('\n  ')}`);
}
test('CR 701.1e: no play listener hears its own play from hand', () => noneHeardItself('hand'));
test('CR 701.1e: no play listener hears its own play from a cache', () => noneHeardItself('cache'));
test('CR 701.1e: no play listener hears its own play from a bin', () => noneHeardItself('bin'));
test('CR 701.1e: no play listener hears its own play from the deck', () => noneHeardItself('deck'));

test('CR 701.1e: Stalwart Sentinel played from a bin by Wake the Dead takes no counters for its own play', () => {
  const r = RESULTS.find(x => x.card === 'Stalwart Sentinel' && x.route === 'bin')!;
  assert.ok(r.heard, `not driven: ${r.skip}`);
  assert.deepEqual(r.heard, [], 'Stalwart Sentinel heard its own play from the bin');
});
