/* 2026-10-03 — A CARD MAKES ONE JOURNEY: hand → stack → board.
 *
 * Owner: "the card going onto the stack flashes in weird ways, seems to move
 * to weird areas and that sort of thing. The game engine works perfectly, but
 * the visual side of things is a bit off." And, choosing between the two
 * fixes offered for a play nobody can respond to: one clean trip via the
 * stack, not straight to the board.
 *
 * Measured in a real browser before anything was changed (a headless rig that
 * samples the DOM every frame): a deployed unit stood on the board from the
 * first frame, while a ghost of it flew to the stack and a third copy sat in
 * the window as "just resolved". The beat replays an item the state has
 * already finished with, and nothing held the result back.
 *
 * What is pinned here is the pure half — ui/flash.ts `resultKeys` /
 * `beatCensus` and ui/motion.ts `census` / `diffCensus`. The DOM half (the
 * hide, the closing frame, the pinned window) is the browser rig's; this file
 * proves the census tells it the right story.
 *
 * Seeds 35900-35999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import type { GameState, Seat, StackItem } from '../../engine/src/types.ts';
import {
  HOLD_MS, beatCensus, deferredKeys, flashItems, landedResults, queueFlashes, resultKeys, stackRows,
} from '../flash.ts';
import type { Flash } from '../flash.ts';
import { census, diffCensus } from '../motion.ts';
import type { Slot } from '../motion.ts';
import { give, giveResources, toDeployment } from '../../engine/test/util.ts';

const bornSince = (prev: GameState, next: GameState): Slot[] => {
  const had = new Set(census(prev).slots.map(s => s.key));
  return census(next).slots.filter(s => !had.has(s.key));
};

/** a deployed Ignis Sprite: a UNIT play (no `resolved` heading) whose spawn
 * trigger makes a TOKEN (a result that is not the beat's own card) */
function ignis(): { h: Harness; seat: Seat; before: GameState; events: ReturnType<Harness['do']> } {
  const h = new Harness(35901);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  giveResources(h, seat, 'fire', 6);
  const idx = give(h, seat, 'Ignis Sprite');
  const before = structuredClone(h.state);
  const events = h.do({ type: 'playCard', seat, handIndex: idx });
  return { h, seat, before, events };
}

/* ── §1 what each beat holds back ──────────────────────────────────────── */

test('§1a the unit a play deployed, and the token its trigger made, are each their own beat\'s result', () => {
  const { h, before, events } = ignis();
  const items = flashItems(events);
  const sprite = items.find(i => i.kind === 'unit')!;
  const trigger = items.find(i => i.kind === 'triggered')!;
  assert.ok(sprite && trigger, 'the fixture is the real thing: a unit beat and a trigger beat');
  const born = bornSince(before, h.state);
  const taken = new Set<string>();
  const unitKeys = resultKeys(events, sprite, born, taken);
  const tokenKeys = resultKeys(events, trigger, born, taken);
  const spriteEnt = Object.values(h.state.entities).find(e => e.card === 'Ignis Sprite')!;
  assert.deepEqual(unitKeys, [`e${spriteEnt.id}`], 'the play holds back exactly its own unit');
  assert.equal(tokenKeys.length, 1, 'the trigger holds back the one thing it made');
  assert.notEqual(tokenKeys[0], unitKeys[0], 'and never the unit the play already claimed');
  assert.equal(h.state.entities[Number(tokenKeys[0]!.slice(1))]?.kind, 'spellToken');
});

test('§1b nothing that was on screen before the batch is ever held back', () => {
  const { h, events } = ignis();
  const items = flashItems(events);
  // `born` empty = a beat replayed later (the deploy reveal's held flashes):
  // everything it touched is already on the board and must stay there
  for (const it of items) assert.deepEqual(resultKeys(events, it, []), []);
  const q = queueFlashes([], events, 0, new Map(), []);
  assert.ok(q.every(f => !f.results), 'no born slots, no results');
  void h;
});

test('§1c a spell holds back its own copy in the bin — the one result with no event', () => {
  // `toBin(…, 'stack')` is silent, so this one is by name: the first bin slot
  // the batch created for that controller and card
  const item: StackItem = { id: 7, kind: 'spell', card: 'Fireball', label: 'Fireball', controller: 1, region: 1, negated: false, parts: [] };
  const born = [
    { key: 'b0:Fireball#0', zone: 'bin', seat: 0, card: 'Fireball' },   // the other seat's
    { key: 'b1:Fireball#2', zone: 'bin', seat: 1, card: 'Fireball' },
  ];
  assert.deepEqual(resultKeys([], item, born), ['b1:Fireball#2']);
  const taken = new Set(['b1:Fireball#2']);
  assert.deepEqual(resultKeys([], item, born, taken), [], 'a copy another beat claimed is not claimed twice');
});

test('§1d a spell that makes tokens holds back its own bin copy too', () => {
  const h = new Harness(35941);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  giveResources(h, seat, 'fire', 6);
  const idx = give(h, seat, 'Flame Juggle');
  const before = structuredClone(h.state);
  const events = h.do({ type: 'playCard', seat, handIndex: idx });
  const juggle = flashItems(events).find(i => i.card === 'Flame Juggle')!;
  assert.ok(juggle, 'the fixture is the real thing: Flame Juggle had its beat');
  const keys = resultKeys(events, juggle, bornSince(before, h.state));
  assert.equal(keys.filter(k => k.startsWith('e')).length, 3, 'its three Fireballs');
  assert.ok(keys.some(k => /^b\d:Flame Juggle#/.test(k)), 'and the Juggle itself, on its way to the bin');
});

/* ── §2 the census tells one journey ───────────────────────────────────── */

test('§2a during the beat the unit is NOT on the board; when it ends the card flies stack → board', () => {
  const { h, before, events } = ignis();
  const q: Flash[] = queueFlashes([], events, 0, new Map(), bornSince(before, h.state));
  const spriteFlash = q.find(f => f.item.kind === 'unit')!;
  const unitKey = spriteFlash.results![0]!;
  const cardOf = (id: number) => h.state.entities[id]?.card;
  const at = (now: number) => beatCensus(census(h.state), stackRows(h.state.stack, q, now), q, now, true, cardOf);

  const before0 = beatCensus(census(before), [], [], 0, true, cardOf);
  const showing = at(spriteFlash.at + 10);
  const keys = new Set(showing.slots.map(s => s.key));
  assert.ok(keys.has(`s${spriteFlash.item.id}`), 'the card is on the strip');
  assert.ok(!keys.has(unitKey), '…and its unit is not yet on the board — the bug was both at once');
  assert.ok(deferredKeys(q, spriteFlash.at + 10).has(unitKey));

  // hand → stack, at the click
  const onto = diffCensus(before0, showing).moves.find(m => m.to === `s${spriteFlash.item.id}`);
  assert.equal(onto?.kind, 'move');
  assert.match(onto!.from ?? '', /^h\d:Ignis Sprite#/, 'it leaves the HAND for the stack');

  // stack → board, at the beat's end — and nothing fades out where it was
  const ended = at(spriteFlash.until);
  const off = diffCensus(showing, ended);
  const toBoard = off.moves.find(m => m.to === unitKey);
  assert.equal(toBoard?.from, `s${spriteFlash.item.id}`, 'the unit arrives FROM the stack card');
  assert.ok(!off.moves.some(m => m.from === `s${spriteFlash.item.id}` && m.kind === 'leave'),
    'the stack card is not also a ghost fading in the window');
});

test('§2b a trigger\'s token flies from the trigger\'s stack card, not out of nowhere', () => {
  const { h, before, events } = ignis();
  const q = queueFlashes([], events, 0, new Map(), bornSince(before, h.state));
  const trig = q.find(f => f.item.kind === 'triggered')!;
  const token = trig.results![0]!;
  const cardOf = (id: number) => h.state.entities[id]?.card;
  const at = (now: number) => beatCensus(census(h.state), stackRows(h.state.stack, q, now), q, now, true, cardOf);
  const last = Math.max(...q.map(f => f.until));
  const showing = at(trig.until - 1);
  const ended = at(last);
  assert.equal(landedResults(q, trig.until).get(token), `s${trig.item.id}`);
  const d = diffCensus(showing, ended);
  const mv = d.moves.find(m => m.to === token);
  assert.equal(mv?.kind, 'move', 'the token is a flight, not a pop');
  assert.equal(mv?.from, `s${trig.item.id}`);
  assert.ok(!d.moves.some(m => m.from === `s${trig.item.id}` && m.kind === 'leave'),
    'the trigger card went INTO the token — it does not also fade out');
});

test('§2c motion off: nothing is held back — the beat tells the story over a final board, as before', () => {
  const { h, before, events } = ignis();
  const q = queueFlashes([], events, 0, new Map(), bornSince(before, h.state));
  const unitKey = q.find(f => f.item.kind === 'unit')!.results![0]!;
  const c = beatCensus(census(h.state), stackRows(h.state.stack, q, 10), q, 10, false, () => undefined);
  assert.ok(c.slots.some(s => s.key === unitKey));
});

test('§2d the hold is bounded by the beat: nothing is held a moment past HOLD_MS of the last beat', () => {
  const { h, before, events } = ignis();
  const q = queueFlashes([], events, 0, new Map(), bornSince(before, h.state));
  const end = Math.max(...q.map(f => f.until));
  assert.ok(end <= q.length * (HOLD_MS + 1000), 'the queue itself is bounded');
  assert.equal(deferredKeys(q, end).size, 0, 'and once the last beat ends, the board is the state');
});

test('§2e the RESPONDABLE stack: one item resolves, and what it made flies out of it', () => {
  // battle: the opponent's death trigger "Create a Fireball 1" sits on the
  // real stack; a pass resolves it, and the same update removes the item and
  // adds the token. No beat is involved, so no Flash.results — the rule is
  // motion.ts's own.
  const slot = (key: string, zone: Slot['zone'], seat: Seat, card: string): Slot =>
    ({ key, zone, seat, card, anchor: zone === 'stack' ? '@stack' : `@${zone}:${seat}` });
  const base = { deck: [10, 10], pack: [0, 0], res: [2, 2] };
  const before = { ...base, slots: [slot('e2', 'field', 1, 'Palewing'), slot('s9', 'stack', 1, 'Ignis Sprite')] };
  const after = { ...base, slots: [slot('e2', 'field', 1, 'Palewing'), slot('e10', 'field', 1, 'Fireball')] };
  const d = diffCensus(before, after);
  const tok = d.moves.find(m => m.to === 'e10');
  assert.equal(tok?.kind, 'move', 'the token flies');
  assert.equal(tok?.from, 's9', '…out of the trigger that made it');
  assert.equal(tok?.fromAnchor, '@stack');
  assert.ok(!d.moves.some(m => m.from === 's9' && m.kind === 'leave'), 'and the trigger does not also fade out alone');
  // two items gone at once is a story this cannot tell: it tells none
  const two = { ...before, slots: [...before.slots, slot('s8', 'stack', 1, 'Bubb')] };
  assert.equal(diffCensus(two, after).moves.find(m => m.to === 'e10')?.kind, 'enter');
  // and never across seats: the OTHER player's new unit did not come out of it
  const theirs = { ...base, slots: [slot('e2', 'field', 1, 'Palewing'), slot('e11', 'field', 0, 'Bubb')] };
  assert.equal(diffCensus(before, theirs).moves.find(m => m.to === 'e11')?.kind, 'enter');
});

/* ── §3 the card being cast is on the census (the hand → cast teleport) ── */

test('§3 the card being cast flies out of the hand, and a cancel flies it back', () => {
  const h = new Harness(35931);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  give(h, seat, 'Ignis Sprite');
  const inHand = structuredClone(h.state);
  // a cast-time suspension, as the asking seat's own view holds it: the card
  // is out of the hand and on the suspension, under the id it keeps on the stack
  const casting = structuredClone(h.state);
  const p = casting.players[seat]!;
  p.hand.splice(p.hand.lastIndexOf('Ignis Sprite'), 1);
  const item: StackItem = { id: 4242, kind: 'unit', card: 'Ignis Sprite', label: 'Ignis Sprite', controller: seat, region: 0, negated: false, parts: [] };
  (casting as unknown as { suspension: unknown }).suspension = { type: 'cast', item };
  (casting as unknown as { decision: unknown }).decision = { seat };
  const out = diffCensus(census(inHand), census(casting)).moves.find(m => m.to === 's4242');
  assert.equal(out?.kind, 'move', 'it flies to where it waits');
  assert.match(out!.from ?? '', /^h\d:Ignis Sprite#/);
  const back = diffCensus(census(casting), census(inHand)).moves.find(m => m.from === 's4242');
  assert.equal(back?.kind, 'move', 'cancelled, it flies back');
  assert.match(back!.to ?? '', /^h\d:Ignis Sprite#/);
  // and once it is really on the stack it is the SAME key — a slide, not a trip
  const pushed = structuredClone(casting);
  pushed.stack = [item];
  assert.equal(diffCensus(census(casting), census(pushed)).moves.length, 0);
});
