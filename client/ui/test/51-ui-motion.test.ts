/* Playtest round 7 — the DOM-free half of the visual-clarification system
 * (ui/motion.ts). Bena: "it's really hard to tell what's happening unless
 * you're super tuned into the game."
 *
 * The client re-renders everything after every action, so animating a card
 * from one zone to another comes down to ONE question: given the state before
 * and the state after, which card went where? These tests pin that answer for
 * every route a card actually takes — played, resolved, killed, drawn,
 * recycled — plus the two ways it can go wrong (a card the diff should NOT
 * see moving, and an opponent's face-down card that has no name to match on).
 *
 * Seeds 5100-5199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import {
  census, diffCensus, HIDDEN_CARD, nameKeys,
} from '../motion.ts';
import type { Census, Move } from '../motion.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, unitsOf } from '../../engine/test/util.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';

/** the single move that touches `key` on either end, or undefined */
const via = (moves: Move[], key: string): Move | undefined =>
  moves.find(m => m.from === key || m.to === key);

const routes = (a: Census, b: Census): string[] =>
  diffCensus(a, b).moves.map(m => `${m.from ?? '·'}>${m.to ?? '·'}`);

/* ── keys ──────────────────────────────────────────────────────────────── */

test('nameKeys identifies the k-th copy of a name, not its index', () => {
  const hand = ['Fireball', 'Good Whale', 'Fireball'];
  assert.deepEqual(nameKeys(hand, 'h0:'),
    ['h0:Fireball#0', 'h0:Good Whale#0', 'h0:Fireball#1']);
  // playing the FIRST card leaves the other two keys untouched — which is the
  // whole point: an index-keyed hand would renumber everything after it
  const after = nameKeys(['Good Whale', 'Fireball'], 'h0:');
  assert.deepEqual(after, ['h0:Good Whale#0', 'h0:Fireball#0']);
});

test('census keys every zone, and a still state moves nothing', () => {
  const h = new Harness(5100);
  toDeployment(h);
  const seat: Seat = h.state.initiative;
  give(h, seat, 'Fireball');
  const id = spawn(h, seat, 'Good Whale');
  h.state.players[seat]!.bin.push('Leaping Lillik');

  const c = census(h.state);
  const keys = new Set(c.slots.map(s => s.key));
  assert.ok(keys.has(`h${seat}:Fireball#0`), 'the hand card');
  assert.ok(keys.has(`b${seat}:Leaping Lillik#0`), 'the bin card');
  assert.ok(keys.has(`e${id}`), 'the unit in play');
  assert.ok(keys.has('p0') && keys.has('p1'), 'both players (for life pulses)');

  const same = diffCensus(c, census(h.state));
  assert.deepEqual(same.moves, [], 'nothing changed, so nothing moved');
  assert.deepEqual(same.pulses, [], 'and nothing pulsed');
});

/* ── the routes a card takes ───────────────────────────────────────────── */

test('hand → stack → field: a spell unit is followed all the way in', () => {
  const h = new Harness(5101);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Good Whale');
  const victim = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'water', 12);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });

  const i = give(h, A, 'Leaping Lillik');
  const before = census(h.state);
  h.do({ type: 'playCard', seat: A, handIndex: i });
  pick(h, { unit: victim });
  const onStack = census(h.state);

  const played = via(diffCensus(before, onStack).moves, `h${A}:Leaping Lillik#0`);
  assert.ok(played, 'the hand card was seen leaving hand');
  assert.equal(played.to, `s${h.state.stack[0]!.id}`, 'and arriving on the stack');
  assert.equal(played.card, 'Leaping Lillik');
  assert.equal(played.kind, 'move');

  const stackKey = played.to!;
  pass(h); pass(h);            // resolve it: deletes the whale, spawns as a unit
  const unit = unitsOf(h, A).find(u => u.card === 'Leaping Lillik')!;
  const resolved = via(diffCensus(onStack, census(h.state)).moves, stackKey);
  assert.ok(resolved, 'the stack item was seen leaving the stack');
  assert.equal(resolved.to, `e${unit.id}`, 'and becoming the unit on the field');
});

test('stack → bin: a spell that is not a unit lands in its owner’s bin', () => {
  const h = new Harness(5102);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Good Whale');
  const ally = spawn(h, A, 'Ignis Sprite');
  const victim = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'earth', 12);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk], [ally]] });

  const i = give(h, A, 'Fight');
  h.do({ type: 'playCard', seat: A, handIndex: i });
  pick(h, { unit: atk });      // my ally…
  pick(h, { unit: victim });   // …fights theirs
  const onStack = census(h.state);
  const stackKey = `s${h.state.stack[0]!.id}`;
  pass(h); pass(h);

  const moves = diffCensus(onStack, census(h.state)).moves;
  const gone = via(moves, stackKey);
  assert.ok(gone, 'the resolved spell went somewhere');
  assert.equal(gone.to, `b${A}:Fight#0`, 'into the caster’s bin');
  // and a unit that died in the fight took its own trip to its owner's bin
  const dead = via(moves, `e${victim}`);
  assert.ok(dead, 'the dead unit was seen leaving the field');
  assert.equal(dead.to, `b${D}:Good Whale#0`, 'into its owner’s bin');
});

test('field → bin has a landing anchor even when the bin shows no scan', () => {
  // the bin mini only renders its last three cards; ui/anim.ts flies to the
  // zone anchor when the card itself has no element, so every move carries one
  const h = new Harness(5103);
  toDeployment(h);
  const seat: Seat = 0;
  const id = spawn(h, seat, 'Good Whale');
  const before = census(h.state);
  new E(h.state).destroy(h.state.entities[id]!, 'dies');
  new E(h.state).settle();

  const m = via(diffCensus(before, census(h.state)).moves, `e${id}`)!;
  assert.equal(m.fromAnchor, `@field:${seat}`);
  assert.equal(m.toAnchor, `@bin:${seat}`);
});

/* ── zones with no per-card slot: deck and resources ───────────────────── */

test('a drawn card flies out of the deck counter', () => {
  const h = new Harness(5104);
  const seat: Seat = 0;
  const before = census(h.state);
  const drawn = h.state.sharedDeck[0]!;
  new E(h.state).draw(seat, 1);

  const after = census(h.state);
  const m = diffCensus(before, after).moves.find(x => x.card === drawn)!;
  assert.ok(m, 'the drawn card appears as a move, not a bare pop-in');
  assert.equal(m.from, `@deck:${seat}`, 'out of the deck');
  assert.equal(m.to, `h${seat}:${drawn}#0`);
  assert.ok(after.deck[seat]! < before.deck[seat]!, 'and the deck shrank');
});

test('recycling a card for a resource flies it into the resource row', () => {
  const h = new Harness(5105);
  const seat: Seat = 0;
  const name = h.state.players[seat]!.hand[0]!;
  const before = census(h.state);
  h.do({ type: 'recycleForResource', seat, handIndex: 0, element: h.state.elements[0]! });

  const m = via(diffCensus(before, census(h.state)).moves, `h${seat}:${name}#0`)!;
  assert.equal(m.to, `@res:${seat}`, 'the hand card became a resource');
});

test('a card that is simply erased fades where it stood', () => {
  const h = new Harness(5106);
  toDeployment(h);
  const id = spawn(h, 0, 'Good Whale');
  const before = census(h.state);
  delete h.state.entities[id];   // erased: no bin, no deck, no trace

  const m = via(diffCensus(before, census(h.state)).moves, `e${id}`)!;
  assert.equal(m.kind, 'leave');
  assert.equal(m.to, null, 'nowhere to fly to — ui/anim.ts fades it out');
});

/* ── the opponent's face-down hand ─────────────────────────────────────── */

test('a hidden card matches by seat, because it has no name to match on', () => {
  // this is the redacted view a network client actually renders: the
  // opponent's hand is a row of __HIDDEN__, and one of them becoming a named
  // stack item is exactly the moment worth animating
  const h = new Harness(5107);
  toDeployment(h);
  const A = h.state.initiative;
  const s: GameState = h.state;
  s.players[A]!.hand = [HIDDEN_CARD, HIDDEN_CARD, HIDDEN_CARD];
  const before = census(s);

  s.players[A]!.hand = [HIDDEN_CARD, HIDDEN_CARD];
  s.stack.push({
    id: 999, kind: 'spell', card: 'Fireball', label: 'Fireball', controller: A,
    region: 0, negated: false, parts: [],
  });
  const m = via(diffCensus(before, census(s)).moves, 's999')!;
  assert.equal(m.from, `h${A}:${HIDDEN_CARD}#2`, 'one of their face-down cards left hand');
  assert.equal(m.card, 'Fireball', 'and the flight is drawn as the card it turned out to be');
});

test('hidden cards never pair across seats', () => {
  const h = new Harness(5108);
  toDeployment(h);
  const s = h.state;
  s.players[0]!.hand = [HIDDEN_CARD];
  s.players[1]!.hand = [];
  const before = census(s);
  s.players[0]!.hand = [];
  s.players[1]!.hand = [HIDDEN_CARD];

  const rs = routes(before, census(s));
  assert.ok(!rs.includes(`h0:${HIDDEN_CARD}#0>h1:${HIDDEN_CARD}#0`),
    'a card must not teleport between hands just because both are face-down');
});

/* ── pulses: the same card, different numbers ──────────────────────────── */

test('damage and counters pulse the card in place, with a direction', () => {
  const h = new Harness(5109);
  toDeployment(h);
  const id = spawn(h, 0, 'Good Whale');
  const before = census(h.state);
  h.state.entities[id]!.damage += 2;
  const hurt = diffCensus(before, census(h.state));
  assert.deepEqual(hurt.moves, [], 'taking damage is not a move');
  assert.deepEqual(hurt.pulses, [{ key: `e${id}`, anchor: '@field:0', kind: 'hurt' }]);

  const mid = census(h.state);
  h.state.entities[id]!.counters += 3;
  assert.equal(diffCensus(mid, census(h.state)).pulses[0]?.kind, 'buff');
});

test('losing life pulses the player’s identity row', () => {
  const h = new Harness(5110);
  const before = census(h.state);
  h.state.players[1]!.life -= 4;
  const p = diffCensus(before, census(h.state)).pulses;
  assert.deepEqual(p, [{ key: 'p1', anchor: '@life:1', kind: 'hurt' }]);
});

test('a player is never paired with a card', () => {
  // p<seat> slots exist only to carry life; they must never be matched as the
  // origin or destination of a flight
  const h = new Harness(5111);
  const before = census(h.state);
  h.state.players[0]!.life -= 1;
  h.state.players[0]!.hand.push('Fireball');
  const m = diffCensus(before, census(h.state)).moves;
  assert.ok(m.every(x => x.from !== 'p0' && x.to !== 'p0'));
});

/* ── the diff must not invent motion ───────────────────────────────────── */

test('a unit that stays put produces no move (FLIP handles the walk)', () => {
  const h = new Harness(5112);
  toDeployment(h);
  const A = h.state.initiative;
  const id = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  const before = census(h.state);
  h.do({ type: 'declareAttack', seat: A, columns: [[id]] });

  // joining an attack column keeps the entity id, so the card is the same DOM
  // element in a new place — that is FLIP's job, not a ghost flight's
  assert.ok(!via(diffCensus(before, census(h.state)).moves, `e${id}`),
    'no flight for a unit that only changed position');
});

test('two copies of one card in the same zone stay distinct', () => {
  const h = new Harness(5113);
  const seat: Seat = 0;
  h.state.players[seat]!.hand = ['Fireball', 'Fireball', 'Good Whale'];
  const before = census(h.state);
  h.state.players[seat]!.hand = ['Fireball', 'Good Whale'];

  const rs = routes(before, census(h.state));
  assert.deepEqual(rs, [`h${seat}:Fireball#1>·`],
    'exactly one Fireball left, and the surviving one kept its key');
});

test('a triggered ability leaps off the unit that produced it', () => {
  // nothing changes zone when a trigger goes on the stack — no card left a
  // hand — so without the origin hint it would just pop into the stack panel
  // and leave "why is this here?" unanswered
  const h = new Harness(5114);
  toDeployment(h);
  const A = h.state.initiative;
  const src = spawn(h, A, 'Rune Channeler');
  const before = census(h.state);
  h.state.stack.push({
    id: 900, kind: 'triggered', label: 'Rune Channeler: deal 2 damage',
    controller: A, region: 0, negated: false, parts: [], sourceId: src,
  });

  const m = via(diffCensus(before, census(h.state)).moves, 's900')!;
  assert.equal(m.from, `e${src}`, 'the flight starts on the unit that triggered');
  assert.equal(m.card, 'Rune Channeler', 'and is drawn as that unit’s scan');
  assert.equal(m.kind, 'move');
});

test('an ability whose source is already gone just pops in', () => {
  const h = new Harness(5115);
  toDeployment(h);
  const A = h.state.initiative;
  const before = census(h.state);
  h.state.stack.push({
    id: 901, kind: 'triggered', label: 'a dead unit’s death trigger',
    controller: A, region: 0, negated: false, parts: [], sourceId: 12345,
  });

  const m = via(diffCensus(before, census(h.state)).moves, 's901')!;
  assert.equal(m.kind, 'enter', 'no origin on screen — nothing to fly from');
  assert.equal(m.from, null);
});
