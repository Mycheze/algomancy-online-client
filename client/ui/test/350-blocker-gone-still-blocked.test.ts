/* 350 — A COLUMN WHOSE BLOCKER LEFT IS STILL BLOCKED, AND THE TABLE SAYS SO
 * (CT-190, report #176, game EGBM).
 *
 * EGBM [334] declared blocks {1:[107], 3:[108]}; [343] Cosmic Reversal
 * recalled the blocker 108, leaving `battle.blocks[3]` an EMPTY list; [345]
 * the engine said "Column 4 is blocked (blockers gone) — no damage through."
 * (R185: removing a blocker does not un-declare the block). The battle panel
 * read `blocks[ci] ?? []`, found nothing, and drew the column "unblocked" —
 * the one word that tells the defender to expect the damage the engine is
 * about to withhold.
 *
 * `BattleState.blocks`: KEY PRESENCE is the sticky "blocked" flag.
 *
 * §1  regions board: the emptied column reads "blocked — blocker gone", the
 *     column nobody blocked still reads "unblocked"
 * §2  classic board (▦ turned back): the same, from the same builder
 * §3  the attacker sees it too — it is their damage that is not going through
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { spawn, toDeployment, toNextBattle, withE } from '../../engine/test/util.ts';
import type { EntityId, GameState, Seat } from '../../engine/src/types.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const store = (globalThis as { localStorage: Storage }).localStorage;

/** battle column `ci` of the panel, as markup up to the next column */
function colChunk(html: string, ci: number): string {
  const parts = html.split(/<div class="col"><div class="collabel">column /);
  const col = parts.find(p => p.startsWith(`${ci + 1}<`));
  assert.ok(col, `no column ${ci + 1} on the battle panel`);
  return col;
}

/** two attacking columns; the defender blocks column 1 only, then the blocker
 * is recalled (as Cosmic Reversal did in EGBM) */
function blockerGone(seed: number): { state: GameState; A: Seat; D: Seat; blocker: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = [spawn(h, A, 'The Foretold'), spawn(h, A, 'The Foretold')];
  const blocker = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: atk.map(id => [id]) });
  const drain = (until: () => boolean): void => {
    for (let guard = 0; guard < 40 && !until(); guard++) {
      const dec = h.state.decision;
      if (dec) h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
      else h.do({ type: 'passPriority', seat: h.state.priority! });
    }
  };
  drain(() => h.state.battle?.step === 'blocks');
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  withE(h, e => e.recall(e.s.entities[blocker]!));
  const b = h.state.battle!;
  assert.ok(!h.state.entities[blocker], 'the premise: the blocker has left play');
  assert.deepEqual(b.blocks, { 0: [] }, 'the premise: column 1 is still keyed as blocked, with nobody in it');
  return { state: h.state, A, D, blocker };
}

const view = (seat: Seat, s: GameState): string => ui.join(s, seat, legalActions(s, seat));

test('§1 regions board: an emptied block reads blocked, not unblocked', () => {
  store.removeItem('algoLayout');
  const { state, D } = blockerGone(35001);
  const html = view(D, state);
  assert.match(html, /class="lboard/, 'the premise: the regions board is drawn');
  const c1 = colChunk(html, 0), c2 = colChunk(html, 1);
  assert.doesNotMatch(c1, />unblocked</, 'column 1 was blocked — its blocker leaving does not unblock it');
  assert.match(c1, /blockgone[^>]*>blocked — blocker gone</);
  assert.match(c2, />unblocked</, 'column 2 nobody blocked, and it still says so');
});

test('§2 classic board: the same column reads the same', () => {
  store.setItem('algoLayout', '1');
  try {
    const { state, D } = blockerGone(35002);
    const html = view(D, state);
    assert.doesNotMatch(html, /class="lboard/, 'the premise: the classic board is drawn');
    assert.doesNotMatch(colChunk(html, 0), />unblocked</);
    assert.match(colChunk(html, 0), />blocked — blocker gone</);
    assert.match(colChunk(html, 1), />unblocked</);
  } finally {
    store.removeItem('algoLayout');
  }
});

test('§3 the attacker is told the same thing', () => {
  const { state, A } = blockerGone(35003);
  const html = view(A, state);
  assert.match(colChunk(html, 0), />blocked — blocker gone</);
  assert.match(colChunk(html, 1), />unblocked</);
});
