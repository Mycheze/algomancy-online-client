/* BL-03 — PRACTICE OPPONENTS: a whole game against each, in the page's room.
 *
 * The owner (2026-08-25): scripted opponents "running a very simplified game
 * plan" — an X/X each turn where X is twice the turn number, "don't block ever
 * and always attack all"; the second makes its unit in deployment with a
 * random attribute. They play a constructed deck of yours, in this browser,
 * and nothing is recorded.
 *
 *   §1 each opponent, against a player who does nothing, plays its card every
 *      turn, attacks with everything, and wins — through the SoloServer and
 *      its socket, the path the board uses
 *   §2 it never blocks, even when it could
 *   §3 begin/startPractice: the save, a resume that is the same game, and no
 *      game without a deck or a known opponent
 *   §4 adding an opponent is a row: every row's card is a practice-only card
 *
 * Seeds 122200-122299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/index.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import type { Action, GameState } from '../../engine/src/types.ts';
import { fallbackMove } from '../bot.ts';
import { OPPONENTS, opponentById, planBot, practiceDeal } from '../opponents.ts';
import { SoloServer } from '../solo.ts';
import decks from '../../server/default-decks.json' with { type: 'json' };

const DECK = (decks as { name: string; cards: string[] }[])[0]!;

/** a player who never plays a card, never attacks, never blocks */
const idle = (legal: readonly Action[]): Action | undefined =>
  legal.find(a => a.type === 'declareAttack' && !a.columns.flat().length)
  ?? legal.find(a => a.type === 'declareBlocks' && !Object.values(a.blocks).flat().length)
  ?? legal.find(a => a.type === 'bottomCards') ?? fallbackMove(legal);

function playOut(server: SoloServer, me: (s: GameState, legal: readonly Action[]) => Action | undefined = (_s, l) => idle(l)) {
  const msgs: { t: string; view?: GameState; legal?: Action[] }[] = [];
  const sock = server.socket();
  sock.deliver = m => { msgs.push(JSON.parse(JSON.stringify(m)) as typeof msgs[number]); };
  server.receive(JSON.stringify({ t: 'join' }));
  for (let i = 0; i < 3000 && server.state.phase !== 'gameover'; i++) {
    const last = [...msgs].reverse().find(m => m.legal)!;
    const a = me(last.view!, last.legal!);
    assert.ok(a, `the player has a move on turn ${server.state.turn}`);
    server.act(a!);
  }
}

test('1222 §1 each opponent plays its card every turn, attacks with everything, and beats a player who does nothing', () => {
  for (const [i, opp] of OPPONENTS.entries()) {
    const stuck: string[] = [];
    const server = new SoloServer(practiceDeal(opp, DECK.cards, 'You', 122200 + i), planBot(opp), undefined, { onBotStuck: w => stuck.push(w) });
    playOut(server);
    assert.deepEqual(stuck, [], `${opp.name} never got stuck`);
    assert.equal(server.state.phase, 'gameover', `${opp.name}: the game ends`);
    assert.equal(server.state.winner, 1, `${opp.name} wins against nobody`);
    const log = server.log();
    const turns = server.state.turn;
    const casts = log.filter(l => l.startsWith(`${opp.name} plays ${opp.card}`)).length;
    // one a turn — the turn the game ends on may end before its card's step comes round
    assert.ok(casts === turns || casts === turns - 1, `${opp.name}: one ${opp.card} a turn (${casts} in ${turns} turns)`);
    assert.ok(turns >= 3, `${opp.name} is beatable: it takes a few turns (${turns})`);
    assert.ok(log.some(l => l.startsWith('Unit Token attacks') || /attack/.test(l)), `${opp.name} attacks`);
    // every unit it made is the size of its turn: the biggest is twice the last turn
    const sizes = Object.values(server.state.entities).filter(e => e?.kind === 'unit' && e.controller === 1).map(e => e!.tokenStats![0]);
    assert.ok(sizes.every(x => x % 2 === 0 && x <= 2 * turns), `${opp.name}: X is twice a turn number (${sizes})`);
  }
});

test('1222 §2 it never blocks, even with units to block with', () => {
  const opp = opponentById('sparring')!;
  const bot = planBot(opp);
  const none = { type: 'declareBlocks', seat: 1, blocks: {} } as unknown as Action;
  const some = { type: 'declareBlocks', seat: 1, blocks: { 0: [5] } } as unknown as Action;
  const state = { decision: null, players: [{ hand: [] }, { hand: [] }] } as unknown as GameState;
  assert.equal(bot.choose(state, 1, [some, none]), none);
  assert.equal(bot.choose(state, 1, [none, some]), none);
  // …and attacks with the most units it is offered
  const one = { type: 'declareAttack', seat: 1, columns: [[1]] } as unknown as Action;
  const all = { type: 'declareAttack', seat: 1, columns: [[1], [2, 3]] } as unknown as Action;
  const zero = { type: 'declareAttack', seat: 1, columns: [] } as unknown as Action;
  assert.equal(bot.choose(state, 1, [zero, one, all]), all);
});

test('1222 §3 a practice game is saved in this browser, resumes as the same game, and needs a deck and an opponent', async () => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>)['localStorage'] = {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  try {
    const practice = await import('../practice.ts');
    assert.equal(practice.begin('nobody', DECK), false, 'no such opponent');
    assert.equal(practice.begin('wild', null), false, 'no deck');
    assert.equal(practice.startPractice(), null, 'nothing saved: nothing to start');
    assert.equal(practice.begin('wild', DECK, 'Tester', 122210), true);
    const a = practice.startPractice()!;
    assert.equal(a.opponent.id, 'wild');
    assert.deepEqual(a.server.state.players.map(p => p.name), ['Tester', 'The Wild Card']);
    playOut(a.server);
    const saved = practice.loadPractice()!;
    assert.ok(saved.game.actions.length > 10, 'every move is saved');
    const b = practice.startPractice()!;
    assert.equal(b.server.state.phase, a.server.state.phase);
    assert.deepEqual(b.server.state.players.map(p => p.life), a.server.state.players.map(p => p.life), 'the resumed game is the same game');
  } finally {
    delete (globalThis as Record<string, unknown>)['localStorage'];
  }
});

test('1222 §4 every opponent is a row whose card is practice-only', () => {
  assert.equal(new Set(OPPONENTS.map(o => o.id)).size, OPPONENTS.length, 'ids are unique');
  for (const o of OPPONENTS) {
    const c = getCard(o.card);
    assert.equal(c.lessonOnly, true, `${o.card} is lessonOnly`);
    assert.ok(!DECK_LIST.includes(o.card), `${o.card} is in no real deal`);
    assert.ok(o.blurb.length > 20 && o.name.length > 2);
  }
});
