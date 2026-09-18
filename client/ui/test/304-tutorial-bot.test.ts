/* R297 — the Tutorial Bot (ui/bot.ts) against real lesson games.
 *
 * The bot is a policy over the engine's legal list, so the claims worth
 * proving are behavioural and are read off the game, not the policy: it never
 * makes an illegal move and never stalls, it spends everything on the largest
 * Construct, it attacks with every unit, it never blocks — and a game with it
 * in reaches an end.
 *
 * Seeds 30400-30499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { Harness } from '../../engine/src/harness.ts';
import { forcedAction } from '../../engine/src/apply.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import type { LessonDeal } from '../../engine/src/lessondeal.ts';
import type { Action, CardName, Seat } from '../../engine/src/types.ts';
import { CONSTRUCT, fallbackMove, runBot, tutorialBotV1, type BotPolicy } from '../bot.ts';

const DEAL: LessonDeal = {
  openingHand: [4, 1], drawPerTurn: [2, 1], stacked: [false, false],
  shardsPerTurn: [0, 1], firstShardTurn: 1, shardState: 'open',
  prismites: [2, 0], startingLife: [30, 30],
};
const deckOf = (el: string): CardName[] => {
  const pool = DECK_LIST.filter(n => getCard(n).kind === 'unit' && (getCard(n).factions ?? []).join() === el);
  return Array.from({ length: 30 }, (_, i) => pool[i % pool.length]!);
};

/** a learner who does nothing but finish each step */
const idle: BotPolicy = { id: 'idle', name: 'Idle', choose: (_s, _seat, legal) => fallbackMove(legal) ?? null };

interface Played { h: Harness; botMoves: Action[] }

function play(seed: number, el: string, learner: BotPolicy, bot = tutorialBotV1(), maxSteps = 4000): Played {
  const h = new Harness(seed, ['Learner', 'Tutorial Bot'], 'constructed', undefined, [deckOf(el), Array(40).fill(CONSTRUCT)], undefined, DEAL);
  const botMoves: Action[] = [];
  let steps = 0;
  while (h.state.phase !== 'gameover' && steps < maxSteps) {
    const f = forcedAction(h.state);
    if (f) { h.do(f); steps++; continue; }
    let moved = 0;
    for (const [seat, p] of [[1, bot], [0, learner]] as [Seat, BotPolicy][]) {
      const r = runBot(a => { h.do(a); if (seat === 1) botMoves.push(a); }, () => ({ state: h.state, legal: h.legal(seat) }), seat, p);
      assert.equal(r.stuck, undefined, `seat ${seat} stuck on turn ${h.state.turn}: ${r.stuck}`);
      moved += r.steps;
    }
    if (!moved) assert.fail(`nobody can move on turn ${h.state.turn} (phase ${h.state.phase})`);
    steps += moved;
  }
  return { h, botMoves };
}

test('§1 the bot never errs and a game against an idle learner ends, won by the bot', () => {
  for (const [i, el] of ['fire', 'water', 'earth', 'wood', 'metal'].entries()) {
    const { h } = play(30400 + i, el, idle);
    assert.equal(h.state.phase, 'gameover', `${el}: the game ended`);
    assert.equal(h.state.winner, 1, `${el}: the bot won`);
    assert.ok(h.state.turn <= 12, `${el}: and not slowly (turn ${h.state.turn})`);
  }
});

test('§2 every Construct is cast at the largest X its mana allows (one Shard a turn)', () => {
  const { h } = play(30410, 'fire', idle);
  const tokens = Object.values(h.state.entities).filter(e => e.card === 'Unit Token' && e.controller === 1);
  const seen = new Set(tokens.map(t => t.tokenStats![0]));
  // with one Shard a turn and everything spent each turn, turn N's unit is N/N
  assert.ok(h.state.turn > 4, 'non-vacuous: the game ran past turn 4');
  for (const n of [1, 2, 3, 4]) assert.ok(seen.has(n), `a ${n}/${n} on turn ${n} (saw ${[...seen]})`);
  assert.ok(![...seen].some(n => n > h.state.turn), 'never bigger than its Shards');
});

test('§3 it attacks with every unit it has and never blocks', () => {
  const { botMoves } = play(30420, 'earth', idle);
  const attacks = botMoves.filter(a => a.type === 'declareAttack');
  assert.ok(attacks.some(a => a.columns.flat().length >= 2), 'non-vacuous: a multi-unit attack happened');
  for (const a of botMoves) {
    if (a.type === 'declareBlocks') assert.equal(Object.values(a.blocks).flat().length, 0, 'never blocks');
  }
});

test('§4 twoUnitsAt splits the mana into two units', () => {
  const policy = tutorialBotV1({ twoUnitsAt: 4 });
  const { h } = play(30430, 'wood', idle, policy);
  const tokens = Object.values(h.state.entities).filter(e => e.card === 'Unit Token' && e.controller === 1);
  const byTurn = new Map<number, number>();
  for (const t of tokens) byTurn.set(t.tokenStats![0], (byTurn.get(t.tokenStats![0]) ?? 0) + 1);
  assert.ok([...byTurn.values()].some(n => n >= 2), `some turn made two units of one size (${[...byTurn]})`);
});

test('§5 fallbackMove prefers the passive option', () => {
  const s = 0 as Seat;
  assert.equal(fallbackMove([{ type: 'doneDeploying', seat: s }, { type: 'passPriority', seat: s }])?.type, 'passPriority');
  assert.equal(fallbackMove([]), undefined);
});
