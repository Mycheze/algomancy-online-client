/* One stat read walks the board a fixed number of times, however crowded it is.
 *
 * The owner, in #steward, 2026-11-06: "I just played a Game with Nyar and the
 * 'game end report screen' thing didn't come up at the end. There was now just
 * a 'Home' button." The game (room MCHQ) ended on a board of sixty Robots and
 * fifteen other units. Recording a finished game replays it, and the post-game
 * screen goes out after the record; that replay took 25 seconds on the home
 * box, during which the server answered nobody. Restored one pass before the
 * end on a test server, the last pass got its board back at once and no
 * post-game payload for well over two seconds; with the fix it comes in time.
 *
 * The cost was in `staticsFor` (every stat read): it reads the faces of every
 * radiator in the region, and each face read (`projectedSources`, the Ancient
 * One layer) walked the whole board again looking for a card that projects.
 * n radiators × an n-entity walk, per read, and a board scan reads n units.
 * Now the projector walk is taken once per region per `staticsFor` and reused under it —
 * a read moves nothing, so it is the same answer (every saved game's summary
 * replays to the identical result, MCHQ in 4 seconds instead of 25).
 *
 *   §1 the number of board walks one effStats makes does not grow with the board
 *   §2 Ancient One still borrows its neighbour's static in a crowded column
 *
 * Seeds 114900-114999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { EntityId } from '../src/types.ts';
import { spawn, toDeployment, toNextBattle } from './util.ts';

/** how many times one effStats on `id` walks the board (`anchored`) */
function walks(h: Harness, id: EntityId): number {
  const g = new E(h.state);
  const priv = g as unknown as { anchored: (...a: unknown[]) => unknown };
  const real = priv.anchored.bind(g);
  let n = 0;
  priv.anchored = (...a: unknown[]) => { n++; return real(...a); };
  g.effStats(h.state.entities[id]!);
  return n;
}

function crowd(seed: number, units: number): { h: Harness; probe: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Ancient One');   // a projector on the board, so the face layer is live
  const probe = spawn(h, A, 'Unit Token');
  for (let i = 0; i < units; i++) spawn(h, A, 'Unit Token');
  return { h, probe };
}

test('§1 the number of board walks one effStats makes does not grow with the board', () => {
  const small = crowd(114900, 5), big = crowd(114900, 40);
  const a = walks(small.h, small.probe), b = walks(big.h, big.probe);
  assert.ok(a > 0, 'the read walks the board at all (the probe counts)');
  // before the fix: one walk per radiator, so 40 more units were 35 more walks
  assert.equal(b, a, `5 units: ${a} walks; 40 units: ${b} walks — the walk count must not scale with the board`);
});

test('§2 Ancient One still borrows its neighbour\'s static in a crowded column', () => {
  const h = new Harness(114901);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const ancient = spawn(h, A, 'Ancient One');
  const lord = spawn(h, A, 'Aberrant Statweaver');   // "Your units are base 3/3"
  const crowdIds: EntityId[] = [];
  for (let i = 0; i < 12; i++) crowdIds.push(spawn(h, A, 'Unit Token'));
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lord], [ancient], ...crowdIds.map(c => [c])] });
  const g = new E(h.state);
  assert.ok(g.facesWith(h.state.entities[ancient]!, 'statics').includes('Aberrant Statweaver'),
    'the Ancient One wears its neighbour\'s face in a column of fourteen');
});
