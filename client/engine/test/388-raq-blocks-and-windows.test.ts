/**
 * RAQ batch A, part 2 — what is blocked, who may block, the damage sub-steps,
 * and where damage comes from. Same conventions as 387: every test names its
 * thread, and a `{ todo }` test is a claim the engine does not honour today
 * (its register entry names the CT ticket). Nothing in engine/src was changed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { blockDeclarationIssue } from '../src/apply.ts';
import type { Attr, EntityId, Seat } from '../src/types.ts';
import { ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, unitsOf } from './util.ts';

function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  return u.id;
}
function grant(h: Harness, id: EntityId, attr: Attr): void {
  const g = new E(h.state);
  g.addTempAttr(g.entity(id)!, attr);
}
/** pass until `seat` holds priority (or the window closes) */
function passTo(h: Harness, seat: Seat): void {
  let guard = 8;
  while (h.state.priority !== seat && h.state.priority !== null && guard-- > 0) pass(h);
  assert.equal(h.state.priority, seat, 'priority reached the acting seat');
}
/** what the engine says about a block declaration, without making it */
const blockIssue = (h: Harness, seat: Seat, blocks: Record<number, EntityId[]>): string | null =>
  blockDeclarationIssue(new E(structuredClone(h.state)), seat, blocks, []);

// ── [Solved] What is blocked? <Bubby don't hurt me> ──

test('RAQ Blocked: a unit played in as a blocker after blocks blocks that column, and it stays blocked when removed', { todo: 'RAQ: a defender cannot play a unit opposite an unblocked column' }, () => {
  // Caleb: "3.) I think it would be considered blocked … 4.) … the column should still be blocked in that case"
  // The defending grid is only the columns it already blocks (E.formationGrid),
  // so Tiderunner Initiate is offered no spot opposite an unblocked attacker.
  const h = new Harness(38801);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 3, 3);
  giveResources(h, D, 'water', 1);                   // Tiderunner Initiate b/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tiderunner Initiate') });
  const dec = h.state.decision;
  assert.ok(dec && dec.options.some(o => /column 1/.test(o.label)),
    '"during after block window as defender I put Tiderunner Initiate as blocker" — the spot opposite column 1 is offered at cast');
  h.do({ type: 'decide', seat: dec.seat, choice: dec.options.findIndex(o => /column 1/.test(o.label)) });
  pass(h); pass(h);
  const runner = unitsOf(h, D).find(u => u.card === 'Tiderunner Initiate')!;
  assert.ok(h.state.battle!.blocks[0]?.includes(runner.id), 'it stands in the block of column 1');
  const g = new E(h.state);
  g.destroy(g.entity(runner.id)!, 'dies');
  g.settle();
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30, 'the column stayed blocked after its blocker was removed: no damage through');
});

test('RAQ Blocked: a defender may block where no attacker is — a side-block — and Roving Quillback counts it', { todo: 'RAQ: side-blocking is not implemented' }, () => {
  // The Manual: "Units may even be placed blocking in slots where attackers
  // aren't". Caleb: "So Roving Quillback will consider side-blocking columns
  // as 'blocked'?" — "yeah it should!"; and blocking eight units to the side
  // as eight separate columns — "Yep you should be able to".
  const h = new Harness(38802);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 5);
  const s1 = tok(h, D, 1, 1), s2 = tok(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  // columns 1 and 2 are past the end of a one-column attack: no attacker stands there
  assert.equal(blockIssue(h, D, { 1: [s1], 2: [s2] }), null,
    'the engine refuses this with "no such attacking column" — a blocking column is keyed to the attack column it answers');
});

// ── [Solved] Alluring AND Evasive column ──

/** A attacks with one Alluring + Evasive column (Tempest Wrangler + Curio Drifter) and lures D's first unit */
function allureBoard(seed: number, defenders: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const wrangler = spawn(h, A, 'Tempest Wrangler');  // {Alluring}
  const drifter = spawn(h, A, 'Curio Drifter');      // {Evasive}
  const other = tok(h, A, 1, 1);                     // a second, plain attack column
  const ds = Array.from({ length: defenders }, () => tok(h, D, 1, 5));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wrangler, drifter], [other]] });
  pick(h, { unit: ds[0] });                          // Alluring targets "A"
  pass(h); pass(h);                                  // the lure resolves
  let guard = 6;
  while (h.state.battle?.step !== 'blocks' && guard-- > 0) pass(h);
  assert.equal(h.state.battle?.step, 'blocks');
  assert.ok(ent(h, ds[0]!)!.allured, 'the target is lured');
  return { h, D, ds };
}

test('RAQ Alluring: a lone lured unit cannot block an Evasive column, so it need not — and it may block another column', () => {
  const { h, D, ds } = allureBoard(38803, 1);
  const [a] = ds as [EntityId];
  assert.equal(blockIssue(h, D, {}), null, '"A cannot be used alone to block Alluring & Evasive column, as Alluring says If able"');
  assert.equal(blockIssue(h, D, { 1: [a] }), null, '"Would A be able to block other column? Yes"');
  assert.notEqual(blockIssue(h, D, { 0: [a] }), null, 'and alone it cannot block the Evasive column at all');
});

test('RAQ Alluring: with two units, the lured one blocks the Evasive column with the other, or nobody blocks it', () => {
  const { h, D, ds } = allureBoard(38804, 2);
  const [a, b] = ds as [EntityId, EntityId];
  assert.equal(blockIssue(h, D, { 0: [a, b] }), null, '"Opponent can choose to either block with A+B"');
  assert.equal(blockIssue(h, D, {}), null, '"or he can forgo blocking this column at all"');
});

test('RAQ Alluring: with three units, A+B or A+C may block the Evasive column, but never B+C', () => {
  const { h, D, ds } = allureBoard(38805, 3);
  const [a, b, c] = ds as [EntityId, EntityId, EntityId];
  assert.equal(blockIssue(h, D, { 0: [a, b] }), null, 'A+B');
  assert.equal(blockIssue(h, D, { 0: [a, c] }), null, 'A+C');
  assert.equal(blockIssue(h, D, {}), null, '"Opponent can forgo blocking this column"');
  assert.notEqual(blockIssue(h, D, { 0: [b, c] }), null, '"but he cannot declare block with B+C"');
});

// ── [Solved] Thieving with 2 units in column? ──

test('RAQ Thieving: two Thieving units in one column draw ONE card — the column is the source', () => {
  const h = new Harness(38806);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const s1 = spawn(h, A, 'Slink'), s2 = spawn(h, A, 'Slink');   // 2/3 {Thieving} each
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[s1, s2]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  const hand = h.state.players[A]!.hand.length;
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30 - 4, 'the column dealt 4');
  assert.equal(h.state.players[A]!.hand.length, hand + 1, '"No, you get to draw only 1 card"');
});

// ── [Solved] Swift/Normal/Sluggish. Opportunity windows & Gaining-Losing Attributes /Joining mid combat ──

/** run until the battle sits in a damage-boundary window, or fail */
function toBoundary(h: Harness): void {
  let guard = 8;
  while (h.state.battle?.step !== 'damageWindow' && guard-- > 0) pass(h);
  assert.equal(h.state.battle?.step, 'damageWindow', 'a boundary window between damage sub-steps is open');
}

test('RAQ Swift: a column that dealt Swift damage deals no normal damage, even once its Swift unit is gone', { todo: 'RAQ: a column does not remember it struck in the Swift sub-step' }, () => {
  // "If column with Swift dealt damage, it's marked with 'I did Swift damage', which
  // means it won't be able to deal regular-combat-damage; even if original Swift unit
  // is removed from that column."
  const h = new Harness(38807);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');          // 2/1 {Swift}
  const back = tok(h, A, 3, 3);                      // shares Swift while Dune Drifter is in the column
  const plain = tok(h, A, 1, 1);                     // a normal-speed column, so there is a normal sub-step
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune, back], [plain]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  toBoundary(h);
  assert.equal(h.state.players[D]!.life, 30 - 5, 'the Swift column struck for 2 + 3');
  const g = new E(h.state);
  g.recall(g.entity(dune)!);
  g.settle();
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30 - 5 - 1,
    'only the plain column strikes in the normal sub-step; the 3/3 already struck with its column');
});

test('RAQ Swift: a column that dealt normal damage deals no Sluggish damage, even if it gains Sluggish', { todo: 'RAQ: a column does not remember it struck in the normal sub-step' }, () => {
  // "If column dealt regular-combat-damage, it's marked with 'I did Regular damage'
  // which means it won't be able to deal sluggish-combat-damage; even if it were to gain Sluggish."
  const h = new Harness(38808);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const plain = tok(h, A, 3, 3);
  const slow = spawn(h, A, 'Ambling Mountaintop');   // 4/5 {Sluggish}: there is a Sluggish sub-step
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[plain], [slow]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  toBoundary(h);
  assert.equal(h.state.players[D]!.life, 30 - 3, 'the plain column struck in the normal sub-step');
  grant(h, plain, 'Sluggish');
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30 - 3 - 4, 'only the Ambling Mountaintop strikes in the Sluggish sub-step');
});

test('RAQ Swift: a Swift column that gains Sluggish strikes again in the Sluggish sub-step', () => {
  // "It's still possible to give this column Sluggish attribute and it will deal
  // damage during sluggish-combat-damage (for effective doublestrike)"
  const h = new Harness(38809);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');          // 2/1 {Swift}
  const slow = spawn(h, A, 'Ambling Mountaintop');   // 4/5 {Sluggish}
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune], [slow]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  toBoundary(h);
  assert.equal(h.state.players[D]!.life, 30 - 2, 'Swift sub-step: the Dune Drifter column');
  grant(h, dune, 'Sluggish');
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30 - 2 - 2 - 4, 'Sluggish sub-step: the Dune Drifter column again, and the Mountaintop');
});

test('RAQ Swift: a Tiderunner played into an emptied Swift column deals no normal damage', { todo: 'RAQ: a column does not remember it struck in the Swift sub-step' }, () => {
  // "if original Swift unit was removed and you played Tiderunner Innitiate in
  // it's place, then this Tiderunner won't deal regular-combat-damage."
  const h = new Harness(38810);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');
  const plain = tok(h, A, 1, 1);
  giveResources(h, A, 'water', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune], [plain]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  toBoundary(h);
  assert.equal(h.state.players[D]!.life, 30 - 2);
  {
    const g = new E(h.state);
    g.recall(g.entity(dune)!);
    g.settle();
  }
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Tiderunner Initiate') });
  const dec = h.state.decision!;
  assert.ok(dec, 'Tiderunner asks for its open spot as it is played');
  const spot = dec.options.findIndex(o => /^column 1 /.test(o.label));
  assert.ok(spot >= 0, `the emptied column is offered (menu: ${dec.options.map(o => o.label).join(' | ')})`);
  h.do({ type: 'decide', seat: dec.seat, choice: spot });
  pass(h); pass(h);                                  // it resolves into the spot
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30 - 2 - 1, 'the plain column strikes; the Tiderunner in the spent column does not');
});

// ── [Solved] Squish/Fight/Battle vs Source of damage & Interactions ──

test('RAQ Squish: the unit is the source — a Powerful ally deals double its defense', () => {
  const h = new Harness(38811);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ally = tok(h, A, 1, 3);
  const wall = tok(h, D, 0, 20);
  giveResources(h, A, 'earth', 2);                   // Squish e/2
  toNextBattle(h, A);
  grant(h, ally, 'Powerful');
  h.do({ type: 'declareAttack', seat: A, columns: [[ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Squish') });
  pick(h, { unit: ally });
  pick(h, { unit: wall });
  pass(h); pass(h);
  assert.equal(ent(h, wall)!.damage, 6, '"you would need to target ally unit which is Powerful to deal double damage"');
  finishBattle(h);
});

test('RAQ Squish: a Powerful Squish does not double — the spell is not the source', { todo: 'RAQ: a Squish/Fight/Battle spell lends its own attributes to the unit dealing the damage' }, () => {
  // "It doesn't matter if Squish is Powerful". Chitin Shredder is a {Powerful}
  // Virus, and R79 lets a Virus go onto a spell on the stack.
  const h = new Harness(38817);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ally = tok(h, A, 1, 3);
  const wall = tok(h, D, 0, 20);
  giveResources(h, A, 'earth', 4);                   // Squish e/2 + Chitin Shredder ee/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Squish') });
  pick(h, { unit: ally });
  pick(h, { unit: wall });
  const squish = h.state.stack[h.state.stack.length - 1]!;
  assert.equal(squish.card, 'Squish');
  passTo(h, A);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Chitin Shredder'), hostStack: squish.id });
  pass(h); pass(h);                                  // the virus resolves first
  assert.deepEqual(h.state.stack.find(i => i.id === squish.id)?.augments, [{ card: 'Chitin Shredder', by: A }],
    'Squish carries the {Powerful} virus');
  pass(h); pass(h);                                  // Squish resolves
  assert.equal(ent(h, wall)!.damage, 3, 'the ally\'s 3 defense, undoubled');
  finishBattle(h);
});

test('RAQ Squish: Squish damage is the unit dealing it, so Ember of Life does not trigger', () => {
  const h = new Harness(38812);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ally = tok(h, A, 1, 3);
  const ember = spawn(h, A, 'Ember of Life');        // attacks too, so it stands in the battle region (R12)
  const wall = tok(h, D, 0, 20);
  giveResources(h, A, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ally], [ember]] });
  const before = unitsOf(h, A).length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Squish') });
  pick(h, { unit: ally });
  pick(h, { unit: wall });
  pass(h); pass(h);
  pass(h); pass(h);
  assert.equal(ent(h, wall)!.damage, 3, 'Squish dealt the 3');
  assert.equal(unitsOf(h, A).length, before, '"Damage resulting from Squish/Fight/Battle won\'t trigger Ember of Life"');
  finishBattle(h);
});

/** Squish with `allyName` (A's) onto D's `victim`; returns the victim and D */
function squishBoard(seed: number, mine: (h: Harness, A: Seat) => EntityId, theirs: (h: Harness, D: Seat) => EntityId) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ally = mine(h, A);
  const victim = theirs(h, D);
  giveResources(h, A, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Squish') });
  pick(h, { unit: ally });
  pick(h, { unit: victim });
  pass(h); pass(h);
  return { h, A, D, ally, victim };
}
const robot = (n: number) => (h: Harness, seat: Seat): EntityId => {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Robot', g.homeRegion(seat), { token: true, counters: n });
  g.settle();
  return u.id;
};

test('RAQ Squish: Unaware Bubb squishing a Robot 10 kills it — the Robot is read at its printed 0/0', () => {
  const { h, victim } = squishBoard(38813, (h, A) => spawn(h, A, 'Bubb'), robot(10));
  assert.ok(!ent(h, victim), '"the Robot will die as Bubb is Unaware"');
  finishBattle(h);
});

test('RAQ Squish: a Robot 10 squishing Unaware Bubb deals its printed defense, 0', { todo: 'RAQ: Squish reads the ally’s live defense even against an Unaware target' }, () => {
  const { h, victim } = squishBoard(38814, robot(10), (h, D) => spawn(h, D, 'Bubb'));
  assert.ok(ent(h, victim), 'Bubb survives — today the Robot deals its live 10 and kills it');
  assert.equal(ent(h, victim)!.damage, 0, '"Squish to make Robot 10 deal its defense as damage to Bubb will cause no harm to Bubb"');
  finishBattle(h);
});

test('RAQ Squish: Bubb in a column with Good Whale squishes with Piercing — the excess reaches the player', () => {
  // _passer, answering a player: "Since Bubb will be the source of damage and he
  // has Piercing, then any excess damage can be dealt to enemy player." (R294:
  // a unit has its column's attributes for everything it does.)
  const h = new Harness(38815);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const bubb = spawn(h, A, 'Bubb');                  // 5/6 {Unaware}
  const whale = spawn(h, A, 'Good Whale');           // 7/5 {Piercing}
  const victim = tok(h, D, 1, 1);
  giveResources(h, A, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bubb, whale]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Squish') });
  pick(h, { unit: bubb });
  pick(h, { unit: victim });
  const life = h.state.players[D]!.life;
  pass(h); pass(h);
  assert.ok(!ent(h, victim));
  assert.equal(life - h.state.players[D]!.life, 5, 'Bubb deals 6; 1 kills the 1/1 and 5 pierce');
  finishBattle(h);
});

// ── [Solved] Life lost in battle vs Gaining life ──

test('RAQ Life lost: life lost in a battle adds up the losses and ignores the gains — Soul Siphon makes a 13/13', () => {
  const h = new Harness(38816);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 5);
  giveResources(h, A, 'water', 2);                   // Soul Siphon b/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  {
    const g = new E(h.state);
    g.loseLife(D, 10, 'test');                       // 30 → 20
    g.gainLife(D, 8, 'test');                        // 20 → 28
    g.loseLife(D, 3, 'test');                        // 28 → 25
    g.settle();
  }
  assert.equal(h.state.players[D]!.life, 25);
  const before = unitsOf(h, A).map(u => u.id);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Soul Siphon') });
  pick(h, { player: D });
  pass(h); pass(h);
  const made = unitsOf(h, A).filter(u => !before.includes(u.id));
  assert.equal(made.length, 1);
  assert.deepEqual(new E(h.state).effStats(made[0]!), [13, 13], '"Total life lost = 10+3 = 13 life lost"');
  finishBattle(h);
});
