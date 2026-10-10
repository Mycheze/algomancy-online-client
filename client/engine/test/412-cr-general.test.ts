/**
 * Comprehensive rules, unit U01 (general, golden rules, players, starting and ending the game) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U01
 * (data/comprehensive-rules/build/probes/U01/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U01.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * The three tests titled "engine differs" are the exception: their rules state
 * the ruling and carry an engineDiffers mark, and these tests pin the
 * divergence the mark describes. They are deliberately NOT listed in those
 * rules' sources. When one goes red the engine has been brought in line with
 * the ruling: drop the engineDiffers mark and the test, and bind a real example.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/index.ts';
import { getCard, type EffectCtx, type EffectDef } from '../src/cards/dsl.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E, GameEnded } from '../src/engine.ts';
import type { CardName, EngineEvent, Entity, Seat } from '../src/types.ts';
import { visibleToSeat } from '../../server/view.ts';
import {
  ent, give, giveResources, pick, skipHasteStep, spawn, toDeployment, toNextBattle, withE,
} from './util.ts';

/** run one effect directly, answering every choice with its first option; returns the events it emitted */
function run(def: EffectDef, g: E, ctx: Partial<EffectCtx> & { controller: Seat }): EngineEvent[] {
  const before = g.events.length;
  def.run(g, {
    sourceName: 'probe', region: g.homeRegion(ctx.controller), targets: [], event: null,
    eraseSelf: () => {}, choose: (_k, dec) => dec.options[0]!.value, ...ctx,
  } as EffectCtx);
  return g.events.slice(before);
}

const constructed = (seed: number): Harness => new Harness(seed, undefined, 'constructed', undefined,
  [DECK_LIST.slice(0, 30) as CardName[], DECK_LIST.slice(30, 60) as CardName[]]);

/* ---------- 100 general ---------- */

test('cr:concepts.general.digital-scope — every game the engine creates has exactly two seats, two regions and two packs', () => {
  for (const mode of ['draft', 'shared'] as const) {
    const h = new Harness(80113, undefined, mode);
    assert.equal(h.state.players.length, 2);
    assert.equal(h.state.regions.length, 2);
    assert.equal(h.state.packs.length, 2);
  }
  const c = constructed(80305);
  assert.equal(c.state.players.length, 2);
  assert.equal(c.state.regions.length, 2);
});

/* ---------- 101 golden rules ---------- */

test('cr:concepts.golden.regions.information — every public event of a Recall resolved in a region the other seat is not in is delivered to that seat', () => {
  const h = new Harness(80112);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const g = new E(h.state);
  const region = g.homeRegion(A);
  assert.ok(!g.s.regions[region]!.presentSeats.includes(D), 'D is not in the home region of A');
  const evs = run(getCard('Recall').spellEffect!, g, { controller: A, sourceName: 'Recall', region });
  const lines = evs.filter(ev => ev.msg && !(ev.data && 'privateTo' in ev.data));
  assert.ok(lines.length > 0, 'the Recall produced log lines');
  for (const ev of lines) assert.equal(visibleToSeat(ev, D), true, ev.msg);
});

/** a Luminous Arc of seat A sits on the stack in the battle region; returns it and the home region of A */
function arcOnTheStack(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const mine = spawn(h, A, 'Unit Token');
  const foe = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'fire', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: foe });
  const item = h.state.stack.find(it => it.controller === A && it.card === 'Luminous Arc');
  assert.ok(item, 'the spell is on the stack');
  const home = new E(h.state).homeRegion(A);
  assert.notEqual(item!.region, home, 'and it is in the battle region, not the home region of A');
  return { h, A, item: item!, home };
}

test('cr:concepts.golden.regions — engine differs: Molten Riftbreaker despawn text resolving in a home region negates a spell on the stack in the battle region', () => {
  const { h, A, item, home } = arcOnTheStack(80108);
  withE(h, g => {
    run(getCard('Molten Riftbreaker').augmentText![0]!.effect, g, { controller: A, sourceName: 'Molten Riftbreaker', region: home });
  });
  const negated = h.events.filter(ev => /negat/i.test(ev.type) || /negat/i.test(ev.msg));
  assert.ok(negated.some(ev => /Luminous Arc/.test(ev.msg)), 'the Luminous Arc was negated');
  const still = h.state.stack.find(it => it.id === item.id);
  assert.ok(!still || still.negated, 'the spell in the other region is gone or negated');
});

test('cr:concepts.golden.regions — engine differs: Cosmic Reversal resolving in a home region returns a spell on the stack in the battle region to its controller hand', () => {
  const { h, A, item, home } = arcOnTheStack(80304);
  withE(h, g => {
    run(getCard('Cosmic Reversal').spellEffect!, g, { controller: A, sourceName: 'Cosmic Reversal', region: home });
  });
  assert.ok(!h.state.stack.some(it => it.id === item.id), 'the spell in the other region left the stack');
  assert.ok(h.state.players[A]!.hand.includes('Luminous Arc'), 'and went to the hand of its controller');
});

/* ---------- 102 players ---------- */

test('cr:concepts.players.each-player — Recall resolved in a region holding only its caster touches only the caster', () => {
  const h = new Harness(70103);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, A, 'Tidal Menace');
  spawn(h, D, 'The Foretold');
  const g = new E(h.state);
  const region = g.homeRegion(A);
  assert.deepEqual(g.s.regions[region]!.presentSeats, [A]);
  const lifeA = g.s.players[A]!.life, lifeD = g.s.players[D]!.life;
  const handD = g.s.players[D]!.hand.length;
  run(getCard('Recall').spellEffect!, g, { controller: A, sourceName: 'Recall', region });
  assert.equal(g.s.players[A]!.life, lifeA - 2, 'the caster, present, loses 2');
  assert.equal(g.s.players[D]!.life, lifeD, 'the player not in the region loses nothing');
  assert.equal(g.s.players[D]!.hand.length, handD, 'and recalls nothing');
});

test('cr:concepts.players.each-opponent — Bloated Manablub with the opponent present in the region takes 3 from that opponent only', () => {
  const h = new Harness(70104);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const g = new E(h.state);
  const region = g.homeRegion(A);
  g.s.regions[region]!.presentSeats = [A, D];
  const lifeA = g.s.players[A]!.life, lifeD = g.s.players[D]!.life;
  run(getCard('Bloated Manablub').abilities![0]!.effect, g,
    { controller: A, sourceName: 'Bloated Manablub', region, event: { type: 'died', msg: '', data: {} } as EngineEvent });
  assert.equal(g.s.players[D]!.life, lifeD - 3, 'the present opponent loses 3');
  assert.equal(g.s.players[A]!.life, lifeA, 'the controller is not an opponent');
});

/** a Good Whale owned by O is given to P; both are present in its region */
function stolenWhale(seed: number, fn: (e: E, id: number, P: Seat, O: Seat) => void): void {
  const h = new Harness(seed);
  toDeployment(h);
  const P = h.state.deployPlayer!, O = (1 - P) as Seat;
  const id = spawn(h, O, 'Good Whale');
  withE(h, e => {
    assert.equal(e.giveControl(e.entity(id)!, P), true);
    const u = e.entity(id)!;
    e.s.regions[u.region]!.presentSeats = [P, O];
    fn(e, id, P, O);
  });
}

const targetableBy = (e: E, what: string, id: number, seat: Seat): boolean =>
  e.targetCandidates({ what, prompt: 'probe' } as never, e.entity(id)!.region, undefined, seat)
    .some(r => JSON.stringify(r) === JSON.stringify({ unit: id }));

test('cr:concepts.players.ally.control — a unit you have taken control of is on your ally menu and off the ally menu of its owner', () => {
  stolenWhale(70105, (e, id, P, O) => {
    assert.equal(e.entity(id)!.owner, O);
    assert.equal(targetableBy(e, 'allyUnit', id, P), true, 'the new controller can aim an ally slot at it');
    assert.equal(targetableBy(e, 'allyUnit', id, O), false, 'its owner cannot');
  });
});

test('cr:concepts.players.enemy — a unit taken from its owner is on the enemy menu of that owner and off the enemy menu of its controller', () => {
  stolenWhale(70105, (e, id, P, O) => {
    assert.equal(targetableBy(e, 'enemyUnit', id, O), true, 'it is an enemy to its owner');
    assert.equal(targetableBy(e, 'enemyUnit', id, P), false, 'and not to the player who controls it');
  });
});

test('cr:concepts.players.owner.token — a token is owned by the player whose effect created it, and a control change does not move that', () => {
  const h = new Harness(70101);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const g = new E(h.state);
  const region = g.homeRegion(A);
  g.s.regions[region]!.presentSeats = [A, D];
  const before = new Set(Object.keys(g.s.entities));
  run(getCard('Accelerated Germination').spellEffect!, g, { controller: A, sourceName: 'Accelerated Germination', region });
  const made = Object.values(g.s.entities).filter(u => !before.has(String(u.id)) && u.token) as Entity[];
  assert.equal(made.length, 2, 'two tokens were created');
  for (const u of made) { assert.equal(u.owner, A); assert.equal(u.controller, A); }
  // Arcane Echo: A copies a token of D; the copy is the creation of A
  const dTok = g.spawnUnit(D, made[0]!.card, region, { token: true } as never);
  assert.equal(dTok.owner, D);
  const before2 = new Set(Object.keys(g.s.entities));
  run(getCard('Arcane Echo').spellEffect!, g, { controller: A, sourceName: 'Arcane Echo', region, targets: [dTok] as never });
  const copy = Object.values(g.s.entities).find(u => !before2.has(String(u.id))) as Entity | undefined;
  assert.ok(copy, 'the copy exists');
  assert.equal(copy!.owner, A, 'the copy of the enemy token is owned by its creator');
  // Download: D gains control of a token of A; ownership stays with A
  run(getCard('Download').spellEffect!, g, { controller: D, sourceName: 'Download', region, targets: [made[1]!] as never });
  assert.equal(made[1]!.controller, D);
  assert.equal(made[1]!.owner, A, 'a token taken by Download is still owned by the player who created it');
});

test('cr:concepts.players.owner — engine differs: a stolen card recalled to the thief hand and replayed from it comes back owned by the thief', () => {
  const h = new Harness(80107);
  toDeployment(h);
  const P = h.state.deployPlayer!, O = (1 - P) as Seat;
  const id = spawn(h, O, 'Good Whale');
  withE(h, e => { assert.equal(e.giveControl(ent(h, id)!, P), true); });
  assert.equal(ent(h, id)!.owner, O, 'still owned by O while stolen');
  withE(h, e => e.recall(ent(h, id)!));
  assert.ok(h.state.players[P]!.hand.includes('Good Whale'), 'the card went to the thief hand');
  giveResources(h, P, 'water', 8);
  h.do({ type: 'playCard', seat: P, handIndex: h.state.players[P]!.hand.lastIndexOf('Good Whale') });
  while (h.state.stack.length && h.state.priority !== null) h.do({ type: 'passPriority', seat: h.state.priority! });
  const replayed = Object.values(h.state.entities).find(u => u.card === 'Good Whale' && u.id !== id) as Entity | undefined;
  assert.ok(replayed, 'the whale is back in play');
  assert.equal(replayed!.owner, P, 'the owner is now the thief: the hand kept only the card name');
});

/* ---------- 103 starting the game ---------- */

test('cr:concepts.starting.live-draft.elements — a standard 1v1 live draft is built from exactly 3 elements, and a chosen trio is used as given', () => {
  const h = new Harness(80105, undefined, 'draft');
  assert.equal(h.state.elements.length, 3);
  const h2 = new Harness(80106, undefined, 'draft', ['wood', 'fire', 'water']);
  assert.deepEqual([...h2.state.elements].sort(), ['fire', 'water', 'wood']);
});

test('cr:concepts.starting.live-draft.deal — 16 cards per seat leave the shared deck: 6 in hand (4 + 2) and a pack of 10', () => {
  const h = new Harness(80104, undefined, 'draft');
  for (const s of [0, 1]) {
    assert.equal(h.state.players[s]!.hand.length, 6);
    assert.equal(h.state.packs[s]!.length, 10);
  }
  assert.equal(h.state.sharedDeck.length + 2 * 16, 177, 'the 3-element live-draft deck is 177 and 32 were dealt');
});

test('cr:concepts.starting.no-first-draw — a new live-draft game is on turn 1 with only the 6 dealt cards in hand and nothing more taken from the deck', () => {
  for (const seed of [80114, 80302, 80303]) {
    const h = new Harness(seed, undefined, 'draft');
    assert.equal(h.state.turn, 1);
    assert.deepEqual(h.state.players.map(p => p.hand.length), [6, 6]);
    assert.equal(h.state.sharedDeck.length, 177 - 32, 'only the 16-card deal per seat left the deck');
    assert.equal(h.events.filter(ev => ev.type === 'draw').length, 0, 'no draw event on turn 1');
  }
});

test('cr:concepts.starting.constructed.opening-hand — a constructed seat is dealt 4, then turn 1 draws 4: hand 8, deck 22, and the draw phase open until 2 go back', () => {
  const c = constructed(80305);
  assert.equal(c.state.turn, 1);
  for (const s of [0, 1]) {
    assert.equal(c.state.players[s]!.hand.length, 8);
    assert.equal(c.state.decks![s]!.length, 22);
  }
  assert.deepEqual(c.state.bottomDone, [false, false], 'the draw phase is open until 2 go back');
});

test('cr:concepts.starting.constructed.first-draw — the only draws of a new constructed game are one draw of 4 per seat in turn 1, and the phase waits for 2 back', () => {
  const c = constructed(80305);
  const draws = c.events.filter(ev => ev.type === 'draw');
  assert.equal(draws.length, 2, 'one draw event per seat');
  for (const ev of draws) assert.match(ev.msg, /draws 4/);
  assert.deepEqual(c.state.bottomDone, [false, false]);
});

/* ---------- 104 ending the game ---------- */

test('cr:concepts.ending.elimination.immediate — life reaching 0 ends the game inside the effect, and the rest of the effect never runs', () => {
  const h = new Harness(80111);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const g = new E(h.state);
  g.player(D).life = 2;
  let after = false;
  const def = { run: (gg: E) => { gg.loseLife(D, 3, 'probe'); after = true; } } as unknown as EffectDef;
  let ended = false;
  try { run(def, g, { controller: A }); } catch (err) { ended = err instanceof GameEnded; }
  assert.equal(ended, true, 'GameEnded is thrown out of the middle of the effect');
  assert.equal(after, false, 'the second half of the effect did not run');
  assert.equal(g.s.winner, A);
  assert.equal(g.s.phase, 'gameover');
});

/* ---------- added by the unit tester: the rules no verifier probe demonstrated ---------- */

test('cr:concepts.general.goal — bringing a player to 0 life eliminates them and the other player wins the game', () => {
  for (const loser of [0, 1] as Seat[]) {
    const h = new Harness(81201 + loser);
    toDeployment(h);
    const g = new E(h.state);
    g.player(loser).life = 3;
    let ended = false;
    try { g.loseLife(loser, 3, 'probe'); } catch (err) { ended = err instanceof GameEnded; }
    assert.equal(ended, true, 'the game ended');
    assert.equal(g.player(loser).life, 0);
    assert.equal(g.s.winner, 1 - loser, 'the opponent of the eliminated player won');
    assert.equal(g.s.phase, 'gameover');
  }
});

test('cr:concepts.general.turns — one turn counter and one phase for the table: a phase waits for both seats, and both enter turn 2 together', () => {
  const h = new Harness(81203);
  assert.equal(h.state.turn, 1);
  assert.equal(h.state.phase, 'planning');
  h.do({ type: 'donePlanning', seat: 0 });
  assert.equal(h.state.phase, 'planning', 'one seat finishing planning does not move the game on');
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  assert.equal(h.state.phase, 'battle', 'both seats done: the whole table moves to battle');
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  assert.equal(h.state.phase, 'deploy');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.equal(h.state.turn, 1, 'one seat finishing deployment does not end the turn');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.equal(h.state.turn, 2, 'the next global turn');
  assert.equal(h.state.phase, 'planning');
});

test('cr:concepts.players.region-and-life — each seat owns a different home region, and a life loss of one seat leaves the life of the other alone', () => {
  const h = new Harness(81204);
  const g = new E(h.state);
  const r0 = g.homeRegion(0), r1 = g.homeRegion(1);
  assert.ok(r0 >= 0 && r1 >= 0, 'each seat has a home region');
  assert.notEqual(r0, r1, 'and they are different regions');
  const l0 = g.player(0).life, l1 = g.player(1).life;
  g.loseLife(0, 4, 'probe');
  assert.equal(g.player(0).life, l0 - 4);
  assert.equal(g.player(1).life, l1, 'each player has their own life total');
});

test('cr:concepts.players.you — Primordial Coalescence and Thought Extraction controlled by a seat give that seat the Wraiths and the rot, never the other', () => {
  const h = new Harness(81205);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const g = new E(h.state);
  const rotA = g.rot(A), rotD = g.rot(D);
  const unitsA = g.unitsOf(A).length, unitsD = g.unitsOf(D).length;
  // "Create three Wraiths and gain 2 Rot." names no player: the controller does it
  run(getCard('Primordial Coalescence').spellEffect!, g, { controller: D, sourceName: 'Primordial Coalescence', region: g.homeRegion(D) });
  assert.equal(g.rot(D), rotD + 2, 'the controller gains the rot');
  assert.equal(g.rot(A), rotA);
  assert.equal(g.unitsOf(D).length, unitsD + 3, 'and creates the Wraiths');
  assert.equal(g.unitsOf(A).length, unitsA);
  // "... You gain 1 rot." with the other seat as the target player: you is still the controller
  const region = g.homeRegion(D);
  g.s.regions[region]!.presentSeats = [A, D];
  const handA = g.player(A).hand.length;
  run(getCard('Thought Extraction').spellEffect!, g, { controller: D, sourceName: 'Thought Extraction', region, targets: [{ player: A }] as never });
  assert.equal(g.player(A).hand.length, handA - 1, 'the target player discarded');
  assert.equal(g.rot(D), rotD + 3, 'the controller, not the target, gains the rot');
  assert.equal(g.rot(A), rotA);
});

test('cr:concepts.players.you.the-deck — Foretell glimpses from the own deck of its controller in constructed and from the shared deck in live draft', () => {
  const c = constructed(81206);
  const g = new E(c.state);
  for (const A of [0, 1] as Seat[]) {
    const D = (1 - A) as Seat;
    const top = g.deckOf(A)[0]!;
    const nA = c.state.decks![A]!.length, nD = c.state.decks![D]!.length;
    run(getCard('Foretell').spellEffect!, g, { controller: A, sourceName: 'Foretell' });
    assert.equal(c.state.decks![A]!.length, nA - 1, 'the deck of the controller lost its top card');
    assert.equal(c.state.decks![D]!.length, nD, 'the deck of the other seat is untouched');
    assert.ok(g.cache(A).some(x => x.card === top), 'and that top card is in the cache of the controller');
  }
  const d = new Harness(81207, undefined, 'draft');
  const g2 = new E(d.state);
  for (const A of [0, 1] as Seat[]) {
    const top = d.state.sharedDeck[0]!;
    const n = d.state.sharedDeck.length;
    assert.equal(g2.deckOf(A), d.state.sharedDeck, 'in live draft the deck of every seat is the shared deck');
    run(getCard('Foretell').spellEffect!, g2, { controller: A, sourceName: 'Foretell' });
    assert.equal(d.state.sharedDeck.length, n - 1);
    assert.ok(g2.cache(A).some(x => x.card === top));
  }
});

test('cr:concepts.starting.live-draft.initiative — the first initiative is a seeded coin flip: either seat can get it, and the same seed gives the same seat', () => {
  const seen = new Set<number>();
  for (let s = 81300; s < 81340; s++) {
    const h = new Harness(s, undefined, 'draft');
    assert.ok(h.state.initiative === 0 || h.state.initiative === 1);
    seen.add(h.state.initiative);
    assert.equal(new Harness(s, undefined, 'draft').state.initiative, h.state.initiative, 'deterministic per seed');
  }
  assert.deepEqual([...seen].sort(), [0, 1], 'both seats win the flip across seeds');
});

test('cr:concepts.starting.live-draft.life — each seat starts a live draft (and a shared-deck game) at 30 life', () => {
  for (const mode of ['draft', 'shared'] as const) {
    const h = new Harness(81208, undefined, mode);
    assert.deepEqual(h.state.players.map(p => p.life), [30, 30]);
  }
});
