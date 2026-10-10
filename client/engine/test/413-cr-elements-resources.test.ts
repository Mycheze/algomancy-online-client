/**
 * Comprehensive rules, unit U02 (elements and affinity, resources, numbers and X) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U02
 * (data/comprehensive-rules/build/probes/U02/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U02.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { IllegalAction, legalActions, ALL_ELEMENTS } from '../src/apply.ts';
import { ELEMENT_OF_PIP } from '../src/cards/dsl.ts';
import { ent, finishBattle, give, giveResources, pass, pick, skipHasteStep, spawn, toDeployment, toNextBattle, withE } from './util.ts';

/* ---------- resources ---------- */

test('cr:concepts.resources.dormant-active.starting — each player starts with exactly two dormant Prismites', () => {
  for (const seed of [90201, 90202, 90203]) {
    const h = new Harness(seed);
    for (const p of h.state.players) {
      assert.deepEqual(p.resources, [{ kind: 'prismite', state: 'dormant' }, { kind: 'prismite', state: 'dormant' }]);
    }
  }
});

test('cr:concepts.resources.activation — a third activation in a turn is refused, and activating a Shard counts toward the two', () => {
  const h = new Harness(90204);
  giveResources(h, 0, 'shard', 1, 'dormant');            // index 2
  h.do({ type: 'activateResource', seat: 0, index: 2 });   // the Shard
  assert.equal(h.state.players[0]!.activationsLeft, 1, 'the Shard used one activation');
  h.do({ type: 'activateResource', seat: 0, index: 0 });
  assert.equal(h.state.players[0]!.activationsLeft, 0);
  assert.throws(() => h.do({ type: 'activateResource', seat: 0, index: 1 }), IllegalAction, 'a third activation is refused');
  assert.ok(!legalActions(h.state, 0).some(a => a.type === 'activateResource'), 'and not offered');
});

test('cr:concepts.resources.recycle — several recycles in one resource step, each resource enters dormant', () => {
  const h = new Harness(90206);
  const start = h.state.players[0]!.resources.length;
  for (let k = 0; k < 4; k++) h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' });
  const made = h.state.players[0]!.resources.slice(start);
  assert.equal(made.length, 4, 'four recycles in one step: no limit');
  assert.ok(made.every(r => r.kind === 'fire' && r.state === 'dormant'), 'all dormant');
});

test('cr:concepts.resources.dormant-active.no-mana — a dormant resource is not mana and cannot pay a cost', () => {
  const h = new Harness(90207);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.state.players[P]!.resources = [];
  giveResources(h, P, 'fire', 3, 'dormant');
  assert.equal(new E(h.state).openMana(P), 0);
  give(h, P, 'Ignis Sprite');                               // r / 1
  assert.equal(new E(h.state).canPayCard(P, 'Ignis Sprite'), false, 'three dormant fire cannot pay [1]');
});

test('cr:concepts.resources.expend — expended resources refresh at the beginning of the next turn', () => {
  const h = new Harness(90208);
  toDeployment(h);
  giveResources(h, 0, 'water', 2, 'expended');
  giveResources(h, 1, 'water', 2, 'expended');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.equal(h.state.phase, 'planning');
  for (const p of h.state.players) assert.ok(!p.resources.some(r => r.state === 'expended'), 'nothing is still expended');
});

test('cr:concepts.resources.prismite.exchange — only an active Prismite, only in the resource step, and the new resource keeps its state', () => {
  const h = new Harness(92008);
  assert.throws(() => h.do({ type: 'exchangePrismite', seat: 0, index: 0, element: 'fire' }), IllegalAction, 'dormant refused');
  h.do({ type: 'activateResource', seat: 0, index: 0 });
  h.state.players[0]!.resources[0]!.state = 'expended';                         // white-box: an expended active Prismite
  h.do({ type: 'exchangePrismite', seat: 0, index: 0, element: 'fire' });
  assert.equal(h.state.players[0]!.resources[0]!.kind, 'fire');
  assert.equal(h.state.players[0]!.resources[0]!.state, 'expended', 'keeps its current state');
  h.do({ type: 'activateResource', seat: 0, index: 1 });
  h.do({ type: 'donePlanning', seat: 0 });
  assert.throws(() => h.do({ type: 'exchangePrismite', seat: 0, index: 1, element: 'water' }), IllegalAction, 'after the resource step: refused');
});

test('cr:concepts.resources.prismite.exchange.activation — the exchange uses no activation; a third copy of an element creates a Shard, a second does not', () => {
  const h = new Harness(92007);
  giveResources(h, 0, 'earth', 2, 'open');
  h.do({ type: 'activateResource', seat: 0, index: 0 });
  h.do({ type: 'activateResource', seat: 0, index: 1 });
  assert.equal(h.state.players[0]!.activationsLeft, 0, 'both activations spent');
  h.do({ type: 'exchangePrismite', seat: 0, index: 0, element: 'earth' });   // legal with 0 activations left
  assert.equal(h.state.players[0]!.activationsLeft, 0);
  assert.equal(h.state.players[0]!.resources.filter(r => r.kind === 'shard').length, 1, 'third earth: a Shard');
  h.do({ type: 'exchangePrismite', seat: 0, index: 1, element: 'fire' });
  assert.equal(h.state.players[0]!.resources.filter(r => r.kind === 'shard').length, 1, 'first fire: no Shard');
});

/* The verifier's probe also measured that the engine refuses a Shard exchange, which this rule
 * allows: that half is a filed engine divergence, so only the Prismite half is asserted here. */
test('cr:concepts.resources.prismite.exchange.element-only — a Prismite cannot be exchanged into another Prismite', () => {
  const h = new Harness(92006);
  h.do({ type: 'activateResource', seat: 0, index: 0 });
  assert.throws(() => h.do({ type: 'exchangePrismite', seat: 0, index: 0, element: 'prismite' }), IllegalAction);
  assert.ok(!legalActions(h.state, 0).some(a => a.type === 'exchangePrismite' && (a as { element: string }).element === 'prismite'),
    'no Prismite exchange is offered');
});

/* ---------- elements and affinity ---------- */

/** one open and one dormant wood (plus four open Shards for mana) fail [g][g]; two expended wood meet it */
function dormantWoodProbe(): void {
  const h = new Harness(92003);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'wood', 1, 'open');
  giveResources(h, P, 'wood', 1, 'dormant');
  giveResources(h, P, 'shard', 4, 'open');
  assert.equal(new E(h.state).affinity(P, 'wood'), 1, 'the dormant wood does not count');
  assert.equal(new E(h.state).canPayCard(P, 'Accelerated Germination'), false, 'gg not met: dormant wood gives no affinity');
  h.state.players[P]!.resources.forEach(r => { if (r.kind === 'wood') r.state = 'expended'; });
  assert.equal(new E(h.state).affinity(P, 'wood'), 2, 'expended counts');
  assert.equal(new E(h.state).canPayCard(P, 'Accelerated Germination'), true, 'gg met by two (expended) wood');
}

test('cr:concepts.elements.affinity-count — a dormant element resource does not count toward a pip requirement; expended ones do', dormantWoodProbe);

test('cr:concepts.resources.kinds.element — an element resource counts one toward its affinity, except while dormant', dormantWoodProbe);

test('cr:concepts.elements.no-affinity-resources — active Prismites and Shards give no affinity to any of the seven elements', () => {
  const h = new Harness(92005);
  giveResources(h, 0, 'shard', 3, 'open');
  h.state.players[0]!.resources.forEach(r => { r.state = 'open'; });
  assert.ok(h.state.players[0]!.resources.some(r => r.kind === 'prismite' && r.state === 'open'), 'the Prismites are active');
  for (const el of ALL_ELEMENTS) assert.equal(new E(h.state).affinity(0, el), 0, `${el}: 0`);
});

test('cr:concepts.elements.game-elements — a fire-water-earth draft refuses a Prismite exchanged into wood and accepts fire; a non-draft game has all seven', () => {
  const h = new Harness(92009, undefined, 'draft');
  assert.deepEqual([...h.state.elements].sort(), ['earth', 'fire', 'water']);
  const H = h.state.players[0]!.hand.length;
  h.do({ type: 'draftCommit', seat: 0, packIndices: h.state.packs[0]!.map((_, i) => H + i) });
  h.do({ type: 'activateResource', seat: 0, index: 0 });
  assert.throws(() => h.do({ type: 'exchangePrismite', seat: 0, index: 0, element: 'wood' }), IllegalAction);
  h.do({ type: 'exchangePrismite', seat: 0, index: 0, element: 'fire' });
  assert.equal(h.state.players[0]!.resources[0]!.kind, 'fire');
  const shared = new Harness(92010);
  assert.deepEqual(shared.state.elements, ALL_ELEMENTS, 'a non-draft game has all seven');
});

/* ---------- numbers and X ---------- */

/** All-Consuming Blaze is cast at fire affinity 2; a third fire arrives with the spell on the stack; it deals 3 */
function blazeAtResolutionProbe(): void {
  const h = new Harness(92004);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as 0 | 1;
  const target = spawn(h, A, 'Good Whale');           // 7/5
  giveResources(h, D, 'fire', 2, 'open');              // affinity 2 at cast
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[target]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'All-Consuming Blaze') });
  pick(h, { unit: target });
  assert.equal(new E(h.state).affinity(D, 'fire'), 2, 'two fire when the spell is cast');
  withE(h, e => { e.player(D).resources.push({ kind: 'fire', state: 'open' }); });   // a third fire arrives with the spell on the stack
  pass(h); pass(h);
  assert.equal(ent(h, target)!.damage, 3, 'damage = 3: the amount was counted at resolution');
}

test('cr:concepts.numbers.amounts-at-resolution — All-Consuming Blaze counts your fire affinity when it resolves, not when it is cast', blazeAtResolutionProbe);

test('cr:concepts.elements.affinity-as-number — All-Consuming Blaze deals damage equal to your [r], read as it resolves', blazeAtResolutionProbe);

test('cr:concepts.numbers.symbols — the pip letters map to the seven elements', () => {
  assert.deepEqual(ELEMENT_OF_PIP, { r: 'fire', b: 'water', e: 'earth', g: 'wood', m: 'metal', l: 'light', d: 'dark' });
});

test('cr:concepts.numbers.copy-x — a Maelstrom Charger copy of Wildfire uses the original X = 2; no X is asked or paid again', () => {
  const h = new Harness(92011);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as 0 | 1;
  const whale = spawn(h, A, 'Good Whale');             // 7/5
  spawn(h, D, 'Maelstrom Charger');
  giveResources(h, D, 'fire', 3, 'open');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wildfire') });
  const prompts: string[] = [];
  for (let k = 0; k < 8 && h.state.decision; k++) {
    const d = h.state.decision;
    prompts.push(d.options.map(o => o.label).join('|'));
    let i = d.options.findIndex(o => o.label === 'X = 2');
    if (i < 0) i = d.options.findIndex(o => o.label.startsWith('Sacrifice Maelstrom'));
    if (i < 0) i = d.options.findIndex(o => o.label === 'Keep the original targets');
    if (i < 0) i = d.options.findIndex(o => o.label.startsWith('Good Whale'));
    assert.ok(i >= 0, `unexpected decision [${d.options.map(o => o.label)}]`);
    h.do({ type: 'decide', seat: d.seat, choice: i });
  }
  assert.equal(prompts.filter(p => p.includes('X = 0')).length, 1, 'X was chosen once, for the original only');
  const xs = h.state.stack.map(i => ({ copy: !!i.copy, x: (i as { x?: number }).x }));
  assert.deepEqual(xs, [{ copy: false, x: 2 }, { copy: true, x: 2 }], 'the copy carries the original X');
  assert.equal(h.state.players[D]!.resources.filter(r => r.state === 'open').length, 1, 'only the original X = 2 was paid');
  pass(h); pass(h); pass(h); pass(h);
  assert.equal(ent(h, whale)!.damage, 4, '2 from the copy + 2 from the original');
});

/* ---------- tester additions: the rules the verifier left without a demonstration ---------- */

/** answer every pending decision with the option whose label matches, else the first; bounded */
function answerAll(h: Harness, prefer: (label: string) => boolean = () => false): string[] {
  const seen: string[] = [];
  for (let k = 0; k < 12 && h.state.decision; k++) {
    const d = h.state.decision;
    seen.push(d.options.map(o => o.label).join('|'));
    const i = d.options.findIndex(o => prefer(o.label));
    h.do({ type: 'decide', seat: d.seat, choice: i >= 0 ? i : 0 });
  }
  return seen;
}

test('cr:concepts.elements.affinity — a card is offered and playable only once its pips are met: one Shard cannot play Curio Drifter, one water can', () => {
  const h = new Harness(41301);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.state.players[P]!.resources = [];
  giveResources(h, P, 'shard', 3, 'open');                   // mana enough, no water affinity
  const idx = give(h, P, 'Curio Drifter');                   // b / 1
  assert.ok(!legalActions(h.state, P).some(a => a.type === 'playCard' && a.handIndex === idx), 'not offered without the pip');
  assert.throws(() => h.do({ type: 'playCard', seat: P, handIndex: idx }), IllegalAction, 'and refused');
  giveResources(h, P, 'water', 1, 'open');
  assert.ok(legalActions(h.state, P).some(a => a.type === 'playCard' && a.handIndex === idx), 'offered once the pip is met');
  h.do({ type: 'playCard', seat: P, handIndex: idx });
  answerAll(h);
  assert.ok(Object.values(h.state.entities).some(u => u.card === 'Curio Drifter' && u.controller === P), 'and it is played');
});

test('cr:concepts.resources.what — an open resource is mana that pays for a card, and resources stay in play from turn to turn', () => {
  const h = new Harness(41302);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.state.players[P]!.resources = [];
  assert.equal(new E(h.state).openMana(P), 0, 'no resources, no mana');
  assert.equal(new E(h.state).canPayCard(P, 'Curio Drifter'), false);
  giveResources(h, P, 'water', 2, 'open');
  assert.equal(new E(h.state).openMana(P), 2, 'each open resource is one mana');
  assert.equal(new E(h.state).canPayCard(P, 'Curio Drifter'), true);
  const before = h.state.players.map(p => p.resources.map(r => r.kind));
  toNextBattle(h);
  finishBattle(h);
  for (const [seat, kinds] of before.entries()) {
    assert.deepEqual(h.state.players[seat]!.resources.map(r => r.kind).slice(0, kinds.length), kinds, `seat ${seat}: every resource is still in play a turn later`);
  }
});

test('cr:concepts.resources.activation.when — creating and activating a resource is offered in the resource step and refused once it is over', () => {
  const h = new Harness(41303);
  assert.equal(h.state.phase, 'planning');
  const acts = legalActions(h.state, 0);
  assert.ok(acts.some(a => a.type === 'activateResource'), 'activation offered in the resource step');
  assert.ok(acts.some(a => a.type === 'recycleForResource'), 'creation (recycling) offered in the resource step');
  h.do({ type: 'donePlanning', seat: 0 });
  assert.ok(!legalActions(h.state, 0).some(a => a.type === 'activateResource' || a.type === 'recycleForResource'), 'neither after the resource step');
  assert.throws(() => h.do({ type: 'activateResource', seat: 0, index: 0 }), IllegalAction, 'activation refused after it');
  assert.throws(() => h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' }), IllegalAction, 'creation refused after it');
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if ((h.state.phase as string) === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  assert.equal(h.state.phase, 'deploy');
  const P = h.state.deployPlayer!;
  assert.throws(() => h.do({ type: 'activateResource', seat: P, index: 0 }), IllegalAction, 'activation refused in deployment');
  assert.throws(() => h.do({ type: 'recycleForResource', seat: P, handIndex: 0, element: 'fire' }), IllegalAction, 'creation refused in deployment');
});

test('cr:concepts.resources.expend.paying — paying a mana cost expends exactly that many un-expended resources', () => {
  const h = new Harness(41304);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.state.players[P]!.resources = [];
  giveResources(h, P, 'earth', 1, 'expended');
  giveResources(h, P, 'earth', 3, 'open');
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Rampart Guardian') });   // e / 2
  answerAll(h);
  const states = h.state.players[P]!.resources.map(r => r.state);
  assert.equal(states.filter(s => s === 'expended').length, 3, 'the one already expended plus the two paid');
  assert.equal(states.filter(s => s === 'open').length, 1, 'one left open');
  assert.equal(states[0], 'expended', 'the already-expended resource paid nothing');
});

test('cr:concepts.numbers.x — X in a mana cost is chosen by the caster, a token takes its X from the creating card, and a where-X clause reads the card', () => {
  // the caster chooses X in Wildfire's cost
  const h = new Harness(41305);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as 0 | 1;
  const whale = spawn(h, A, 'Good Whale');
  giveResources(h, D, 'fire', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wildfire') });
  assert.equal(h.state.decision!.seat, D, 'the caster is asked');
  assert.ok(h.state.decision!.options.some(o => o.label === 'X = 2'), 'X is a choice');
  pick(h, 2);
  pick(h, { unit: whale });
  assert.equal(h.state.stack.find(i => i.card === 'Wildfire')!.x, 2, 'the chosen X');
  // a where-X clause: Self-Assembly makes a Robot X, where X is your metal
  const g = new Harness(41306);
  toDeployment(g);
  const P = g.state.deployPlayer!;
  g.state.players[P]!.resources = [];
  giveResources(g, P, 'metal', 3, 'open');
  g.do({ type: 'playCard', seat: P, handIndex: give(g, P, 'Self-Assembly') });
  answerAll(g);
  while (g.state.stack.length) { pass(g); answerAll(g); }
  const robot = Object.values(g.state.entities).find(u => u.card === 'Robot' && u.controller === P);
  assert.ok(robot, 'a Robot was made');
  assert.equal(robot!.counters, 3, 'its X is the metal affinity: it spawned with 3 +1/+1 counters');
});

test('cr:concepts.numbers.token-x — Manufacture makes a Robot 3, a Robot 2 and a Robot 1: each token takes the X its creator names', () => {
  const h = new Harness(41307);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.state.players[P]!.resources = [];
  giveResources(h, P, 'metal', 6, 'open');
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Manufacture') });
  answerAll(h);
  while (h.state.stack.length) { pass(h); answerAll(h); }
  const robots = Object.values(h.state.entities).filter(u => u.card === 'Robot' && u.controller === P && !u.absent);
  assert.deepEqual(robots.map(r => r.counters).sort(), [1, 2, 3], 'Robots with X = 3, 2 and 1');
});

test('cr:concepts.numbers.amounts-at-resolution.cost-snapshot — Volatile Toxicity reads the sacrificed unit defense as it was in play, counters included', () => {
  const h = new Harness(41308);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as 0 | 1;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');                   // printed 7/5
  ent(h, whale)!.counters = 2;                                // two +1/+1 counters: 9/7 in play
  giveResources(h, D, 'fire', 1);
  giveResources(h, D, 'wood', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Volatile Toxicity') });
  pick(h, { unit: whale });                                   // the sacrifice is paid now
  assert.ok(!ent(h, whale) || ent(h, whale)!.absent, 'the Whale has left play');
  pass(h); pass(h);
  const toks = Object.values(h.state.entities).filter(e => e.kind === 'spellToken' && e.controller === D);
  assert.ok(toks.some(t => t.card === 'Poison' && t.x === 7), 'Poison 7: the in-play defense, not the printed 5');
  assert.ok(toks.some(t => t.card === 'Fireball' && t.x === 7), 'Fireball 7');
});

test('cr:concepts.numbers.symbols.mana — [3b] is three mana at one water pip, [x] is X generic mana, and [three] is three mana', () => {
  // [3b]: Lurking Slimebeast ambush. Four Shards pay the mana but not the pip; one water and two Shards pay both.
  const ambushOffered = (water: number, shards: number): { h: Harness; D: 0 | 1; ok: boolean; rc: number } => {
    const h = new Harness(41309);
    toDeployment(h);
    const A = h.state.initiative, D = (1 - A) as 0 | 1;
    const sprite = spawn(h, A, 'Unit Token');
    const rc = spawn(h, D, 'Rampart Guardian');
    h.state.players[D]!.resources = [];
    giveResources(h, D, 'water', water);
    giveResources(h, D, 'shard', shards);
    give(h, D, 'Lurking Slimebeast');
    toNextBattle(h, A);
    h.do({ type: 'declareAttack', seat: A, columns: [[sprite]] });
    pass(h); pass(h);
    h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [rc] } });
    while (h.state.priority !== D) pass(h);
    return { h, D, rc, ok: legalActions(h.state, D).some(a => a.type === 'playCard' && a.mode === 'ambush') };
  };
  assert.equal(ambushOffered(0, 4).ok, false, 'four Shards: three mana is there, the water pip is not');
  const { h, D, rc, ok } = ambushOffered(1, 2);
  assert.equal(ok, true, 'one water and two Shards: offered');
  h.do({ type: 'playCard', seat: D, handIndex: h.state.players[D]!.hand.indexOf('Lurking Slimebeast'), mode: 'ambush' });
  pick(h, { unit: rc });
  assert.equal(h.state.players[D]!.resources.filter(r => r.state === 'expended').length, 3, 'three mana paid');

  // [x]: Frosted Denial asks the target effect controller to pay X generic mana; Shards pay it.
  const f = new Harness(41310);
  toDeployment(f);
  const A2 = f.state.deployPlayer!, D2 = (1 - A2) as 0 | 1;
  const tok = spawn(f, A2, 'Unit Token');
  giveResources(f, A2, 'water', 3);
  f.state.players[D2]!.resources = [];
  giveResources(f, D2, 'water', 1);                           // Overwhelm
  giveResources(f, D2, 'shard', 2);                           // the [x], X = 2
  toNextBattle(f, A2);
  f.do({ type: 'declareAttack', seat: A2, columns: [[tok]] });
  pass(f);
  f.do({ type: 'playCard', seat: D2, handIndex: give(f, D2, 'Overwhelm') });
  pick(f, { unit: tok });
  const ow = f.state.stack[0]!.id;
  f.do({ type: 'playCard', seat: A2, handIndex: give(f, A2, 'Frosted Denial') });
  pick(f, 2);
  pick(f, { stack: ow });
  pass(f); pass(f);
  const d = f.state.decision;
  assert.ok(d && d.seat === D2, `the controller of the target effect is asked to pay [x]; decision ${JSON.stringify(d?.options.map(o => o.label))}`);
  const payIdx = d!.options.findIndex(o => o.label === 'pay 2');
  assert.ok(payIdx >= 0, `a pay option: ${d!.options.map(o => o.label)}`);
  f.do({ type: 'decide', seat: D2, choice: payIdx });
  assert.equal(f.state.players[D2]!.resources.filter(r => r.kind === 'shard' && r.state === 'expended').length, 2, 'X = 2 generic mana, paid with Shards');

  // [three]: under a Stasis Sentry a one-mana spell costs three during battle.
  const s = new Harness(41311);
  toDeployment(s);
  const A3 = s.state.initiative, D3 = (1 - A3) as 0 | 1;
  const atk = spawn(s, A3, 'Unit Token');
  spawn(s, D3, 'Stasis Sentry');
  toNextBattle(s, A3);
  s.do({ type: 'declareAttack', seat: A3, columns: [[atk]] });
  assert.equal(new E(s.state).manaToPlay(D3, 'Overwhelm'), 3, 'base cost [three]: three mana');
});
