/* CT-318 — A TRIGGER DOES NOT TAKE THE WINDOW AWAY FROM THE INITIATIVE PLAYER.
 *
 * PLAYTEST REPORT #234, room RCUY at actions [180]–[182], filed by Tomzy:
 * *"I did not have priority after attacking here, when I should have."*
 * Tomzy had the initiative and attacked with Rousing Spirit. Its "When I
 * attack" trigger went on the stack — and LordZZX, the defender, received
 * priority first.
 *
 * The sources:
 *   · CR 605.1a — "The initiative player receives priority first in the
 *     attack window."
 *   · CR 604.3c — on-attack triggers "are put on the stack before the attack
 *     window opens, so players can respond to them in that window."
 *   · CR 703.3a — in a priority window the initiative player receives
 *     priority first.
 *   · CR 703.3c — after a resolution "all players then receive priority in
 *     order again, which is a new priority window."
 *   · Rulebook 2023: "Player A has the initiative and attacks player B. There
 *     is a priority window during the attack step, so player A recieves
 *     priority first."
 *   · Annex D2.9 (the engine convention) — "when a player puts something on
 *     the stack in battle, priority goes to the opponent." That is a player's
 *     ACTION, and §5 below keeps it.
 *
 * The cause: `E.pushItem` handed priority to the opponent of whoever
 * controlled ANY pushed item. A trigger pushed as a window opened (or after
 * a resolution) therefore moved the window to whoever did not control the
 * trigger — the initiative player lost it whenever the trigger was theirs.
 *
 * Seeds 51800–51999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { allCardNames, getCard, isTriggered } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import type { EventType, Seat } from '../src/types.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';

/* ── the classes, derived from the registry ───────────────────────────── */

/** every UNIT that carries a triggered ability (in play — not a bin/cache
 * listener) on one of these events. Units only: the synthetic `Alluring
 * Attribute` listens to 'attacked' too, but it is a token's text, not
 * something that can stand in a column. */
function triggerCards(events: EventType[]): string[] {
  return allCardNames().filter(n => {
    const c = getCard(n);
    return c.kind === 'unit' && (c.abilities ?? []).some(a => isTriggered(a) && !a.zone
      && a.events.some(ev => events.includes(ev)));
  });
}

const ATTACK = triggerCards(['attacked', 'attackDeclared']);
const BLOCK = triggerCards(['blocked', 'blocksDeclared']);
const AFTER = triggerCards(['afterCombat']);

/** answer whatever is pending by shape — a `pickOrder` question takes the
 * identity order, anything else its first option (as util's drivers do) */
function answerAll(h: Harness): void {
  for (let guard = 40; guard-- > 0;) {
    const dec = h.state.decision;
    if (!dec) return;
    h.do({ type: 'decide', seat: dec.seat, choice: dec.pickOrder ? dec.options.map((_, i) => i) : 0 });
  }
  throw new Error('answerAll did not terminate');
}

const stackedFrom = (h: Harness, name: string): boolean =>
  h.state.stack.some(it => it.kind === 'triggered' && it.card === name);

/** the shared verdict: a window that opened with `name`'s trigger on the
 * stack is the initiative player's to act in first */
function windowIsInitiatives(h: Harness, name: string, where: string): void {
  assert.equal(h.state.priority, h.state.initiative,
    `${name}: its trigger is on the stack as the ${where} opens, and the initiative player `
    + `(seat ${h.state.initiative}) must receive priority first — seat ${h.state.priority} has it`);
  assert.equal(h.state.passes, 0, `${name}: a fresh window, nobody has passed`);
}

/** keep the per-class results honest: a class that silently fired nothing
 * proves nothing */
function nonVacuous(cls: string[], fired: string[], what: string, must: string[]): void {
  assert.ok(cls.length > 0, `the ${what} class derived from the registry is empty`);
  for (const m of must) assert.ok(fired.includes(m), `${m}'s ${what} trigger never reached the stack`);
  assert.ok(fired.length * 2 >= cls.length,
    `only ${fired.length}/${cls.length} ${what} cards put a trigger on the stack: `
    + `${cls.filter(n => !fired.includes(n)).join(', ')}`);
}

/* ══ §1 — THE ATTACK WINDOW, every on-attack trigger card ═══════════════ */

test('CR 605.1a every on-attack trigger card: after the initiative player attacks, the initiative player has priority', () => {
  const fired: string[] = [];
  ATTACK.forEach((name, i) => {
    const h = new Harness(51800 + i);
    toDeployment(h);
    const A = h.state.deployPlayer!, D = (1 - A) as Seat;
    const u = spawn(h, A, name);
    spawn(h, D, 'Lithoghul');   // something for an attack trigger to aim at
    spawn(h, A, 'Lithoghul');   // and something friendly
    toNextBattle(h, A);
    assert.equal(h.state.initiative, A);
    h.do({ type: 'declareAttack', seat: A, columns: [[u]] });
    assert.equal(h.state.battle!.attacker, A, `${name}: the initiative player is the attacker`);
    // a trigger that suspends for its targets is pushed later, from the
    // answer — the window must still be the initiative player's then
    answerAll(h);
    if (h.state.battle?.step !== 'attackWindow' || !stackedFrom(h, name)) return;
    fired.push(name);
    windowIsInitiatives(h, name, 'attack window');
  });
  nonVacuous(ATTACK, fired, 'on-attack', ['Rousing Spirit']);
});

/* ══ §2 — THE BLOCK WINDOW, every on-block trigger card ═════════════════ */

test('CR 703.3a every on-block trigger card: a block trigger controlled by the initiative player leaves the block window with them', () => {
  // the discriminating case is a trigger the INITIATIVE player controls (the
  // old code handed priority to its controller's opponent), so the blocker
  // is the initiative player's: round two, where the other seat attacks
  const fired: string[] = [];
  BLOCK.forEach((name, i) => {
    const h = new Harness(51900 + i);
    toDeployment(h);
    const I = h.state.deployPlayer!, N = (1 - I) as Seat;
    const blocker = spawn(h, I, name);
    const attacker = spawn(h, N, 'Lithoghul');
    toNextBattle(h, I);
    h.do({ type: 'declareAttack', seat: I, columns: [] });   // round one: no attack
    assert.equal(h.state.battle?.attacker, N, 'round two: the other seat attacks');
    h.do({ type: 'declareAttack', seat: N, columns: [[attacker]] });
    answerAll(h);
    pass(h); pass(h);
    answerAll(h);
    assert.equal(h.state.battle?.step as string, 'blocks', `${name}: at the block declaration`);
    h.do({ type: 'declareBlocks', seat: I, blocks: { 0: [blocker] } });
    answerAll(h);
    if ((h.state.battle?.step as string) !== 'blockWindow' || !stackedFrom(h, name)) return;
    fired.push(name);
    assert.equal(h.state.initiative, I);
    windowIsInitiatives(h, name, 'block window');
  });
  nonVacuous(BLOCK, fired, 'on-block', []);
});

/* ══ §3 — THE AFTER-COMBAT WINDOW, every after-combat trigger card ══════ */

test('CR 703.3a every after-combat trigger card: the after-combat window opens with the initiative player', () => {
  const fired: string[] = [];
  AFTER.forEach((name, i) => {
    const h = new Harness(52000 + i);
    toDeployment(h);
    const A = h.state.deployPlayer!, D = (1 - A) as Seat;
    const u = spawn(h, A, name);
    const other = spawn(h, A, 'Lithoghul');
    toNextBattle(h, A);
    h.do({ type: 'declareAttack', seat: A, columns: [[u], [other]] });
    for (let guard = 80; guard-- > 0;) {
      const b = h.state.battle;
      if (!b || h.state.phase !== 'battle' || b.attacker !== A) return;
      if (h.state.decision) { answerAll(h); continue; }
      if (b.step === 'afterWindow') break;
      if (b.step === 'blocks') { h.do({ type: 'declareBlocks', seat: D, blocks: {} }); continue; }
      if (h.state.priority === null) return;
      pass(h);
    }
    if (h.state.battle?.step !== 'afterWindow' || !stackedFrom(h, name)) return;
    // only the window as it OPENED counts: if anything has resolved since,
    // CR 703.3c has opened a new one, which §4 covers
    if (h.state.passes !== 0) return;
    fired.push(name);
    windowIsInitiatives(h, name, 'after-combat window');
  });
  nonVacuous(AFTER, fired, 'after-combat', []);
});

/* ══ §4 — THE DAMAGE WINDOW AND A RESOLUTION ═══════════════════════════ */

test('CR 608.3b the damage window between split sub-steps opens with the initiative player', () => {
  // test 297's board: Adversary of the Deep hears the normal sub-step's 6
  // and its trigger is on the stack at the boundary
  const h = new Harness(52100);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const adv = spawn(h, A, 'Adversary of the Deep');
  const bripp = spawn(h, A, 'Bripp');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bripp], [adv]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'damageWindow');
  assert.ok(stackedFrom(h, 'Adversary of the Deep'), 'the trigger is on the stack at the boundary');
  windowIsInitiatives(h, 'Adversary of the Deep', 'damage window');
});

test('CR 703.3c a trigger queued by a resolution: the new window still opens with the initiative player', () => {
  // the defender kills the attacking Geode; Geode's "when I die" trigger is
  // the INITIATIVE player's, and it goes on the stack as the new window opens
  const h = new Harness(52101);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const geode = spawn(h, A, 'Geode');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[geode]] });
  assert.equal(h.state.priority, A);
  pass(h);
  giveResources(h, D, 'fire', 2);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: geode });
  assert.equal(h.state.priority, A, 'D2.9 control: the defender acted, the attacker responds');
  pass(h); pass(h);
  assert.ok(!h.state.entities[geode], 'the Arc killed the Geode');
  assert.ok(stackedFrom(h, 'Geode'), 'and its death trigger is on the stack');
  windowIsInitiatives(h, 'Geode', 'post-resolution window');
});

/* ══ §5 — THE CONTROL: A PLAYER'S OWN ACTION STILL PASSES PRIORITY (D2.9) ═ */

test('Annex D2.9 the control: a cast in battle hands priority to the opponent of the caster, either way round', () => {
  const h = new Harness(52102);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Lithoghul');
  const def = spawn(h, D, 'Lithoghul');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.equal(h.state.priority, A, 'an empty attack window opens with the initiative player');
  giveResources(h, A, 'fire', 2);
  giveResources(h, D, 'fire', 2);
  // the attacker casts: the defender responds
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: def });
  assert.equal(h.state.priority, D, 'the attacker cast — the defender has priority');
  // the defender casts in response: the attacker responds
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: atk });
  assert.equal(h.state.priority, A, 'the defender cast — the attacker has priority');
  assert.equal(h.state.passes, 0);
});

/* ══ §6 — THE REPORT'S BOARD ═══════════════════════════════════════════ */

test('report 234 RCUY at 180: Tomzy has the initiative, attacks with Rousing Spirit, and receives priority first', () => {
  // RCUY's board at [180], as the replay builds it: Tomzy (initiative)
  // attacks with [[Plague Bellower], [Rousing Spirit], [Ephemeral Skywalker,
  // Flourishing Flora]] into LordZZX's Tempest Oracle and Shoreline Specter,
  // with no unit in his bin (the trigger takes no target and still goes on
  // the stack). On c0ee278 the replay stands here with priority on LordZZX.
  const h = new Harness(52103);
  toDeployment(h);
  const T = h.state.deployPlayer!, L = (1 - T) as Seat;
  const bellower = spawn(h, T, 'Plague Bellower');
  const spirit = spawn(h, T, 'Rousing Spirit');
  const sky = spawn(h, T, 'Ephemeral Skywalker');
  const flora = spawn(h, T, 'Flourishing Flora');
  spawn(h, L, 'Tempest Oracle');
  spawn(h, L, 'Shoreline Specter');
  h.state.players[T]!.bin = ['Woodland Warding', 'Verdant Vengeance'];
  toNextBattle(h, T);
  h.do({ type: 'declareAttack', seat: T, columns: [[bellower], [spirit], [sky, flora]] });
  answerAll(h);
  assert.ok(stackedFrom(h, 'Rousing Spirit'), 'the Rousing Spirit trigger is on the stack');
  assert.equal(h.state.battle!.step, 'attackWindow');
  assert.equal(h.state.priority, T, 'THE REPORT: the attacker with the initiative acts first');
  // [181] in the log is LordZZX passing; after the fix it is Tomzy's turn first
  pass(h);
  assert.equal(h.state.priority, L, 'then the defender may respond to the trigger');
});
