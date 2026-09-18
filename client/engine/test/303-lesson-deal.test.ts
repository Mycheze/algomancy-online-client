/* R297 — LEARN TO PLAY: the lesson deal and the Training Construct.
 *
 * A lesson game is constructed mode with a LessonDeal (src/lessondeal.ts): per
 * seat opening hands and draws with no bottom step, decks that can be stacked,
 * a per-turn Shard income, and starting Prismites and life. The Tutorial Bot's
 * only card, Training Construct ("Create an X/X unit"), is `lessonOnly` — in
 * the registry, out of DECK_LIST, and so out of every other kind of deal.
 *
 * Seeds 30300-30399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { checkDeck, createGame } from '../src/apply.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import { checkLessonDeck, type LessonDeal } from '../src/lessondeal.ts';
import type { Action, CardName, Seat } from '../src/types.ts';

const CONSTRUCT = 'Training Construct';
const FIRE_UNITS = DECK_LIST.filter(n => {
  const c = getCard(n);
  return c.kind === 'unit' && (c.factions ?? []).join() === 'fire';
});
const LEARNER: CardName[] = Array.from({ length: 30 }, (_, i) => FIRE_UNITS[i % FIRE_UNITS.length]!);
const BOT: CardName[] = Array.from({ length: 40 }, () => CONSTRUCT);
const DEAL: LessonDeal = {
  openingHand: [4, 1], drawPerTurn: [2, 1], stacked: [true, false],
  shardsPerTurn: [0, 1], firstShardTurn: 1, shardState: 'open',
  prismites: [2, 0], startingLife: [30, 30], initiative: 0,
};
const game = (seed: number, deal: LessonDeal = DEAL) =>
  new Harness(seed, ['Learner', 'Tutorial Bot'], 'constructed', undefined, [LEARNER, BOT], undefined, deal);

test('§1 hands and draws are per seat, turn 1 included, with no bottom step', () => {
  const h = game(30300);
  assert.equal(h.state.players[0]!.hand.length, 6, 'learner: 4 dealt + 2 drawn');
  assert.equal(h.state.players[1]!.hand.length, 2, 'bot: 1 dealt + 1 drawn');
  assert.equal(h.state.bottomDone ?? null, null, 'no draw-4/bottom-2 step');
  assert.ok(!h.legal(0).some(a => a.type === 'bottomCards'));
  assert.equal(h.state.initiative, 0);
});

test('§2 a stacked deck is dealt in the order given; an unstacked one is shuffled', () => {
  const h = game(30301);
  assert.deepEqual(h.state.players[0]!.hand, LEARNER.slice(0, 6));
  assert.deepEqual(h.state.decks![0], LEARNER.slice(6));
  const unstacked = game(30301, { ...DEAL, stacked: [false, false] });
  assert.notDeepEqual([...unstacked.state.players[0]!.hand, ...unstacked.state.decks![0]!], LEARNER);
});

test('§3 Shard income, prismites and life come from the deal', () => {
  const h = game(30302, { ...DEAL, startingLife: [25, 40] });
  const bot = h.state.players[1]!;
  assert.deepEqual(bot.resources, [{ kind: 'shard', state: 'open' }], 'no prismites, one open shard on turn 1');
  assert.equal(h.state.players[0]!.resources.filter(r => r.kind === 'prismite').length, 2);
  assert.deepEqual(h.state.players.map(p => p.life), [25, 40]);
  const late = game(30303, { ...DEAL, firstShardTurn: 3, shardState: 'dormant' });
  assert.equal(late.state.players[1]!.resources.length, 0, 'income starts on firstShardTurn');
});

test('§4 a lesson deal is constructed-only, and its deck rule is its own', () => {
  assert.throws(() => createGame(1, undefined, 'shared', undefined, undefined, undefined, DEAL), /constructed/);
  assert.equal(checkLessonDeck([CONSTRUCT]).ok, true);
  assert.equal(checkLessonDeck(['Unit Token']).ok, false, 'a token is not a deck card');
  assert.equal(checkLessonDeck(['No Such Card']).ok, false);
  assert.equal(checkLessonDeck([]).ok, false);
});

test('§5 Training Construct lives only in lesson deals', () => {
  assert.ok(!DECK_LIST.includes(CONSTRUCT), 'not in DECK_LIST');
  assert.equal(getCard(CONSTRUCT).lessonOnly, true);
  assert.equal(checkDeck([...LEARNER.slice(0, 29), CONSTRUCT]).ok, false, 'a constructed deck refuses it');
});

/** Learner does nothing; the bot casts every Construct it can at the largest X. */
function drive(h: Harness, turns: number): void {
  for (let step = 0; step < 2000 && !h.state.winner && h.state.turn <= turns; step++) {
    const d = h.state.decision;
    if (d) {
      const xs = d.options.map(o => o.value as number);
      h.do({ type: 'decide', seat: d.seat, choice: d.kind === 'payOrDecline' ? xs.indexOf(Math.max(...xs)) : 0 });
      continue;
    }
    let acted = false;
    for (const seat of [1, 0] as Seat[]) {
      const legal = h.legal(seat);
      const pick = (seat === 1 ? legal.find(a => a.type === 'playCard') : undefined)
        ?? legal.find(a => a.type === 'passPriority' || a.type.startsWith('done'))
        ?? legal.find(a => a.type === 'declareBlocks' || a.type === 'declareAttack');
      if (pick) { h.do(pick as Action); acted = true; break; }
    }
    if (!acted) break;
  }
}

test('§6 the bot casts Construct with its Shards and gets an X/X token', () => {
  const h = game(30304);
  drive(h, 3);
  const tokens = Object.values(h.state.entities).filter(e => e.controller === 1 && e.card === 'Unit Token');
  const sizes = tokens.map(t => t.tokenStats?.[0]).sort();
  assert.ok(sizes.includes(1), `turn 1 made a 1/1 (${sizes})`);
  assert.ok(sizes.includes(2), `turn 2 made a 2/2 (${sizes})`);
  for (const t of tokens) assert.deepEqual(t.tokenStats, [t.tokenStats![0], t.tokenStats![0]], 'X/X');
});

test('§7 seed + decks + deal + actions replays to the same game', () => {
  const a = game(30305); drive(a, 3);
  const b = game(30305);
  for (const act of a.actions) b.do(act);
  assert.deepEqual(b.state, a.state);
});
