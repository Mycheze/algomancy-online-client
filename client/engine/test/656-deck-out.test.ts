/**
 * CT-385 — running out of cards (CR 104.5).
 *
 * The owner, 2026-10-24, asked whether to follow the designer on deck-out:
 * "Follow Caleb". The designer, rules-questions:
 *   · 2025-04-01: "In constructed you lose if you draw on an empty deck"
 *   · 2025-08-04: "in constructed you lose", and "in live draft the game just
 *     ends if you run out of cards (don't make sense to make a player lose
 *     since its a shared deck)"
 *   · 2025-06-25, asked what happens when a live draft's shared deck runs out:
 *     "The game ends, highest life total wins"
 *   · 2025-03-20 / 2025-03-24: the recycled cards are reshuffled in when the
 *     deck reaches them (the mark); the bin is not ("Correct")
 *
 * So "empty" is the deck AND the recycle pile (CR 408.2b reshuffles the pile in
 * first), and only a DRAW ends the game — a mill or a reveal does not.
 * Lesson deals (Learn to Play, Weekly Challenges) keep drawing fewer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E, GameEnded, other } from '../src/engine.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { legalActions } from '../src/apply.ts';
import type { Action, CardName, GameState, Seat } from '../src/types.ts';
import type { LessonDeal } from '../src/lessondeal.ts';

const constructed = (seed: number): Harness => new Harness(seed, undefined, 'constructed', undefined,
  [DECK_LIST.slice(0, 30) as CardName[], DECK_LIST.slice(30, 60) as CardName[]]);

/** empty `seat`'s deck and recycle pile */
function emptyOut(g: E, seat: Seat): void {
  g.deckOf(seat).length = 0;
  g.recycleOf(seat).length = 0;
}

/** run `body` on an engine over a copy of `s`; true when it ended the game */
function ends(s: GameState, body: (g: E) => void): { g: E; ended: boolean } {
  const g = new E(structuredClone(s));
  try { body(g); } catch (sig) {
    if (!(sig instanceof GameEnded)) throw sig;
    return { g, ended: true };
  }
  return { g, ended: false };
}

/** the most passive legal move for whoever can move */
function passive(s: GameState): Action | undefined {
  for (const seat of [0, 1] as Seat[]) {
    const legal = legalActions(s, seat).filter(a => a.type !== 'concede');
    const by = (t: Action['type']) => legal.find(a => a.type === t);
    const a = by('bottomCards') ?? by('donePlanning') ?? by('doneHaste')
      ?? legal.find(x => x.type === 'declareAttack' && x.columns.length === 0)
      ?? legal.find(x => x.type === 'declareBlocks' && Object.keys(x.blocks).length === 0)
      ?? by('passPriority') ?? by('doneDeploying') ?? by('decide');
    if (a) return a;
  }
  return undefined;
}

test('CR 104.5 / CT-385: in constructed a draw from an empty deck and an empty recycle pile loses, whatever the life totals', () => {
  const h = constructed(65601);
  const P: Seat = 0;
  const { g, ended } = ends(h.state, e => {
    emptyOut(e, P);
    e.player(P).life = 50;
    e.draw(P, 1);
  });
  assert.ok(ended, 'the draw ended the game');
  assert.equal(g.s.winner, other(P), 'the player who had to draw lost');
  const ev = g.events.find(x => x.type === 'gameOver')!;
  assert.equal((ev.data as { deckedOut?: number }).deckedOut, P);
});

test('CR 104.5 / CT-385: the cards that are there are drawn first, then the draw that finds nothing loses', () => {
  const h = constructed(65602);
  const P: Seat = 1;
  const { g, ended } = ends(h.state, e => {
    const keep = e.deckOf(P).slice(0, 2);
    emptyOut(e, P);
    e.deckOf(P).push(...keep);
    e.draw(P, 4);
  });
  assert.ok(ended);
  assert.equal(g.s.winner, other(P));
  assert.equal(g.events.find(x => x.type === 'draw')?.data?.['n'], 2, 'two drawn before the loss');
});

test('CR 104.5 / CT-385: an empty deck with recycled cards behind the mark reshuffles them in and does not lose', () => {
  const h = constructed(65603);
  const P: Seat = 0;
  const { g, ended } = ends(h.state, e => {
    const pile = e.deckOf(P).slice(0, 3);
    emptyOut(e, P);
    e.recycleOf(P).push(...pile);
    e.draw(P, 2);
  });
  assert.equal(ended, false);
  assert.equal(g.s.winner, null);
  assert.equal(g.deckOf(P).length, 1, 'three reshuffled in, two drawn');
});

test('CR 104.5 / CT-385: a mill or a cache from an empty deck is not a draw and does not end the game', () => {
  const h = constructed(65604);
  const { g, ended } = ends(h.state, e => {
    emptyOut(e, 0);
    e.mill(0, 2);
    e.cacheTopOfDeck(0, 1);
  });
  assert.equal(ended, false);
  assert.equal(g.s.winner, null);
});

test('CR 104.5 / CT-385: in constructed the card step from an empty deck and pile ends the game at the start of the turn', () => {
  const h = constructed(65605);
  const s = structuredClone(h.state);
  const turn = s.turn;
  let state = s;
  let emptied: Seat | null = null;
  for (let i = 0; i < 300 && state.phase !== 'gameover'; i++) {
    if (emptied === null && state.phase === 'deploy') {
      // the non-initiative seat runs dry during deployment
      const g = new E(state);
      emptied = other(state.initiative);
      emptyOut(g, emptied);
      state = g.s;
    }
    const a = passive(state);
    if (!a) break;
    const h2 = new Harness(1);
    h2.state = state;
    h2.do(a);
    state = h2.state;
  }
  assert.equal(state.phase, 'gameover');
  assert.equal(state.turn, turn + 1, 'at the next turn card step');
  assert.equal(state.winner, other(emptied!), 'and the seat that ran dry lost');
});

test('CR 104.5 / CT-385: with a shared deck (live draft) the game ends and the higher life total wins, even over the player who had to draw', () => {
  for (const mode of ['draft', 'shared'] as const) {
    const h = new Harness(65606, undefined, mode);
    const P: Seat = 0;
    const { g, ended } = ends(h.state, e => {
      e.deckOf(P).length = 0;
      e.recycleOf(P).length = 0;
      e.player(P).life = 12;
      e.player(other(P)).life = 9;
      e.draw(P, 1);
    });
    assert.ok(ended, mode);
    assert.equal(g.s.winner, P, `${mode}: 12 beats 9; nobody loses for drawing`);
  }
});

test('CR 104.5 / CT-385: a live-draft deck-out with the life totals tied goes against the initiative player', () => {
  const h = new Harness(65607, undefined, 'draft');
  const { g, ended } = ends(h.state, e => {
    e.deckOf(0).length = 0;
    e.recycleOf(0).length = 0;
    e.player(0).life = 7;
    e.player(1).life = 7;
    e.draw(other(e.s.initiative), 1);
  });
  assert.ok(ended);
  assert.equal(g.s.winner, other(h.state.initiative));
});

test('CR 104.5 / CT-385: a lesson deal (Learn to Play, Weekly Challenges) draws fewer and plays on', () => {
  const deal: LessonDeal = {
    openingHand: [4, 1], drawPerTurn: [2, 1], stacked: [true, false],
    shardsPerTurn: [0, 1], firstShardTurn: 1, shardState: 'open',
    prismites: [2, 0], startingLife: [30, 30], initiative: 0,
  };
  const h = new Harness(65608, ['Learner', 'Tutorial Bot'], 'constructed', undefined,
    [DECK_LIST.slice(0, 30) as CardName[], DECK_LIST.slice(30, 60) as CardName[]], undefined, deal);
  const { g, ended } = ends(h.state, e => {
    emptyOut(e, 0);
    e.draw(0, 3);
  });
  assert.equal(ended, false);
  assert.equal(g.s.winner, null);
});
