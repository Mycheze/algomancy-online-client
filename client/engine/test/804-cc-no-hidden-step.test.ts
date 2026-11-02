/* Competitive Constructed (doc 22 §3.3) — no step is hidden, and whole games
 * play sequentially.
 *
 * `hiddenSegment` is null on a CC state, so everything keyed on it stands
 * down by construction: the server's frozen board and held events, the
 * decision gate's "not your business" exception (a question blocks both seats,
 * as it does in battle) and the timestamp re-basing. `planningStep` still
 * NAMES the step, for the agreed-fix rewind's "start of this step".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { apply, createGame, decisionBlocks, hiddenSegment, planningStep } from '../src/apply.ts';
import type { Action, CardName, Decision, GameState, Seat } from '../src/types.ts';
import { ccGame, ccToDeploy, ccToHaste, ccBottomed, gateDisagreements, randomDeck, walk } from './cc-walk.ts';

const twinOf = (s: GameState): GameState => { const t = structuredClone(s); delete t.sequential; return t; };

test('CC: hiddenSegment is null in every step, and planningStep names the step', () => {
  const h = ccGame(0);
  const seen: string[] = [];
  const look = (): void => {
    assert.equal(hiddenSegment(h.state), null);
    assert.equal(planningStep(h.state), hiddenSegment(twinOf(h.state)), 'the name is the house rule key');
    seen.push(String(planningStep(h.state)));
  };
  look();
  ccBottomed(h); look();
  ccToHaste(h); look();
  ccToDeploy(h); look();
  assert.deepEqual(seen, ['plan', 'plan', 'haste', 'deploy']);
});

test('CC: an open decision blocks both seats, where the house rule lets the other seat act', () => {
  const h = ccToDeploy(ccGame(0));
  const asked = structuredClone(h.state);
  asked.decision = { id: 1, seat: 0, kind: 'targets', prompt: 'probe', options: [] } as unknown as Decision;
  assert.equal(decisionBlocks(asked, 0), true);
  assert.equal(decisionBlocks(asked, 1), true, 'CC: the other seat waits, as in battle');
  assert.equal(decisionBlocks(twinOf(asked), 1), false, 'house rule: inside a hidden step it is none of their business');
});

test('CC: random whole games play sequentially, the reducer and the offer agreeing throughout', () => {
  let finished = 0, nitPlays = 0, turns = 0;
  for (let seed = 301; seed <= 312; seed++) {
    const decks: [CardName[], CardName[]] = [randomDeck(seed), randomDeck(seed + 104729)];
    // per (turn, step): the seats that took a non-answer action, in order
    const order = new Map<string, Seat[]>();
    let n = 0;
    const r = walk(seed, {
      mode: 'constructed', decks, rules: { sequential: true }, maxActions: 700, invariants: true,
      onStep: (s, legal) => {
        assert.equal(hiddenSegment(s), null);
        const step = planningStep(s);
        if (!step || s.decision || (step === 'plan' && s.bottomDone != null)) return;
        const acting = ([0, 1] as Seat[]).filter(x => legal[x]!.length > 0);
        assert.ok(acting.length <= 1, `seed ${seed} turn ${s.turn} ${step}: one seat at a time (${acting})`);
        const int = s.initiative, nit = 1 - int;
        if (acting[0] === nit) {
          const intDone = step === 'plan' ? s.planningDone[int] : step === 'haste' ? s.hasteDone![int] : s.deployDone![int];
          assert.equal(intDone, true, `seed ${seed} turn ${s.turn} ${step}: the NIT acts only after the INT is done`);
        }
        if (++n % 5 === 0) assert.deepEqual(gateDisagreements(s), [], `seed ${seed} turn ${s.turn} ${step}`);
      },
    });
    finished += r.finished ? 1 : 0;
    turns = Math.max(turns, r.state.turn);
    // replay the walk and read who acted in which step
    nitPlays += countNitPlays(seed, decks, r.actions, order);
    for (const [k, seq] of order) {
      const firstNit = seq.findIndex(x => x !== seq[0]);
      assert.ok(firstNit < 0 || seq.slice(firstNit).every(x => x === seq[firstNit]), `seed ${seed} ${k}: no seat acts after the other has taken over (${seq})`);
    }
  }
  assert.ok(turns >= 4, 'the walks reach later turns');
  assert.ok(nitPlays > 0, 'the NIT does take its steps');
  assert.ok(finished > 0, 'some CC walks reach the end of the game');
});

/** walk the log again: who acted, per (turn, step), outside answers; and how
 * many non-Done actions the NIT took in its own steps */
function countNitPlays(seed: number, decks: [CardName[], CardName[]], actions: readonly Action[], order: Map<string, Seat[]>): number {
  let s = createGame(seed, undefined, 'constructed', undefined, decks, undefined, undefined, { sequential: true }).state;
  let nit = 0;
  for (const a of actions) {
    const step = planningStep(s);
    if (step && a.type !== 'decide' && a.type !== 'bottomCards' && a.type !== 'concede') {
      const k = `${s.turn}:${step}`;
      const seq = order.get(k) ?? [];
      seq.push(a.seat);
      order.set(k, seq);
      if (a.seat !== s.initiative && !/^done/.test(a.type)) nit++;
    }
    s = apply(s, a).state;
  }
  return nit;
}
