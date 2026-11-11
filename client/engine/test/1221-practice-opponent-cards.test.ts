/* BL-03 — the practice opponents' cards, and a token created WITH attributes.
 *
 * The owner (2026-08-25): "one opponent could, in each haste, make an x/x unit
 * where x is the turn number x2 … Another could be similar, but it makes a
 * unit during deployment which has a random attribute." Each opponent's deck
 * is one card (registry.ts): Sparring Construct (haste) and Wild Construct
 * (deploy, a random attribute from WILD_ATTRS, drawn off the game's own seeded
 * shuffle). The attribute rides `Entity.tokenAttrs`, read by ownAttrs at the
 * printed layer.
 *
 * Seeds 122100-122199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import '../src/apply.ts';
import { Harness } from '../src/harness.ts';
import { forcedAction } from '../src/apply.ts';
import { DECK_LIST, WILD_ATTRS } from '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import { E } from '../src/engine.ts';
import type { Action, CardName, Entity } from '../src/types.ts';
import type { LessonDeal } from '../src/lessondeal.ts';

const FIRE_UNITS = DECK_LIST.filter(n => getCard(n).kind === 'unit' && (getCard(n).factions ?? []).join() === 'fire');
const PLAYER: CardName[] = Array.from({ length: 30 }, (_, i) => FIRE_UNITS[i % FIRE_UNITS.length]!);
const DEAL: LessonDeal = {
  openingHand: [4, 0], drawPerTurn: [0, 1], stacked: [false, false],
  shardsPerTurn: [0, 0], firstShardTurn: 1, shardState: 'open',
  prismites: [2, 0], startingLife: [30, 30], cardStep: ['constructed', 'lesson'],
};

/** Seat 1 plays its card whenever it may and attacks with everything; seat 0
 * does the most passive thing on offer. Stops after `turns` or at game over. */
function play(card: CardName, seed: number, turns: number): Harness {
  const h = new Harness(seed, ['P', 'Bot'], 'constructed', undefined,
    [PLAYER, Array.from({ length: 30 }, () => card)], undefined, DEAL);
  const pick = (l: Action[]): Action | undefined =>
    l.find(a => a.type === 'playCard' && h.state.players[1]!.hand[a.handIndex] === card)
    ?? l.filter(a => a.type === 'declareAttack').sort((a, b) =>
      (b.type === 'declareAttack' ? b.columns.flat().length : 0) - (a.type === 'declareAttack' ? a.columns.flat().length : 0))[0]
    ?? l.find(a => a.type === 'decide') ?? l.find(a => a.type === 'declareBlocks')
    ?? l.find(a => ['donePlanning', 'doneHaste', 'doneDeploying', 'passPriority'].includes(a.type));
  const passive = (l: Action[]): Action | undefined =>
    l.find(a => a.type === 'passPriority') ?? l.find(a => a.type === 'declareBlocks' && !Object.values(a.blocks).flat().length)
    ?? l.find(a => a.type === 'declareAttack' && !a.columns.flat().length)
    ?? l.find(a => ['donePlanning', 'doneHaste', 'doneDeploying', 'bottomCards', 'decide'].includes(a.type)) ?? l[0];
  for (let n = 0; n < 4000 && h.state.phase !== 'gameover' && h.state.turn <= turns; n++) {
    const f = forcedAction(h.state);
    if (f) { h.do(f); continue; }
    const l1 = h.legal(1);
    const a = l1.length ? pick(l1) : passive(h.legal(0));
    if (!a) break;
    h.do(a);
  }
  return h;
}

const botUnits = (h: Harness): Entity[] =>
  Object.values(h.state.entities).filter((e): e is Entity => !!e && e.kind === 'unit' && e.controller === 1);

test('1221 §1 both cards are practice-only: free, lessonOnly, out of every deck list', () => {
  for (const [name, timing] of [['Sparring Construct', 'haste'], ['Wild Construct', 'deploy']] as const) {
    const c = getCard(name);
    assert.equal(c.timing, timing, `${name} is a ${timing} card`);
    assert.equal(c.mana, 0, `${name} is free`);
    assert.equal(c.lessonOnly, true);
    assert.ok(!DECK_LIST.includes(name), `${name} is never in a constructed, draft or shared deal`);
  }
});

test('1221 §2 Sparring Construct: every turn an X/X where X is twice the turn number, made in the haste step', () => {
  const h = play('Sparring Construct', 122100, 3);
  const units = botUnits(h);
  assert.ok(units.length >= 3, `three turns, three units (saw ${units.length})`);
  const sizes = units.map(u => u.tokenStats).sort((a, b) => a![0] - b![0]);
  assert.deepEqual(sizes.slice(0, 3), [[2, 2], [4, 4], [6, 6]], 'turn 1 a 2/2, turn 2 a 4/4, turn 3 a 6/6');
  assert.ok(h.log.some(l => l === 'Bot plays Sparring Construct.' || l === 'Bot plays Sparring Construct → stack.'));
});

test('1221 §3 Wild Construct: the X/X has one attribute off the list, and it is a real attribute of the unit', () => {
  const seen = new Set<string>();
  for (let seed = 122110; seed < 122118; seed++) {
    const h = play('Wild Construct', seed, 2);
    const e = new E(h.state);
    for (const u of botUnits(h)) {
      assert.equal(u.tokenAttrs?.length, 1, 'one attribute');
      const a = u.tokenAttrs![0]!;
      assert.ok(WILD_ATTRS.includes(a), `${a} is on the list`);
      assert.ok(e.ownAttrs(u).has(a), `ownAttrs reads the token's ${a}`);
      assert.equal(u.tokenStats![0], u.tokenStats![1]);
      assert.equal(u.tokenStats![0] % 2, 0, 'X is twice a turn number');
      seen.add(a);
    }
  }
  assert.ok(seen.size >= 3, `the attribute varies from game to game (saw ${[...seen].join(', ')})`);
});

test('1221 §4 the same game deals the same attributes — the draw is the seeded shuffle', () => {
  const attrs = (seed: number) => botUnits(play('Wild Construct', seed, 3)).map(u => u.tokenAttrs?.[0]);
  assert.deepEqual(attrs(122120), attrs(122120));
});

test('1221 §5 tokenAttrs: a token keeps the attributes it was created with; a plain token has none', () => {
  const h = play('Sparring Construct', 122130, 1);
  const g = new E(h.state);
  const u = botUnits(h)[0]!;
  assert.equal(u.tokenAttrs, undefined);
  assert.equal(g.ownAttrs(u).size, 0);
  const made = g.spawnUnit(1, 'Unit Token', 0, { token: true, tokenStats: [3, 3], tokenAttrs: ['Flying'] });
  assert.deepEqual([...g.ownAttrs(made)], ['Flying']);
  const card = g.spawnUnit(1, 'Unit Token', 0, { tokenAttrs: ['Flying'] });
  assert.equal(g.ownAttrs(card).size, 0, 'only a CREATED token takes them — a card put into play prints its own');
});
