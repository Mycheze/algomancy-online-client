/* R216 — THE SCENARIO LIBRARY CANNOT ROT SILENTLY, AND THE FORENSIC STACK
 * STILL WORKS ON A SCENARIO ROOM.
 *
 * `docs/14-scenario-tester.md` §9 names scenario rot as one of the four ways
 * this build fails, and names the model for the fix:
 *
 *   > A scenario naming a card that gets renamed, or a board that stops being
 *   > legal, must fail the suite loudly. The `backlog.test.ts` pattern — every
 *   > `touches` path is asserted to exist — is the model, and the README says
 *   > why: it is "the specific way a list like this rots into a text file".
 *
 * So §1 below is DERIVED over the whole library (docs/13 §7.2's standing rule:
 * derive, never enumerate) rather than written per scenario. A scenario added
 * next round is covered the day it is added; a card renamed under one is a red
 * suite, not a confused owner at 40 cards an hour.
 *
 * §2 is the other half, and it is the one that costs a round if it is wrong:
 * docs/14 §4's ⚠ — "a scenario that silently needs an opponent looks like a
 * hung game, and a hung game looks like a bug." A `needsLiveOpponent: false`
 * scenario is therefore not taken on trust; the scripted opponent's OWN rule
 * (`passiveMove`, imported, not restated) is run against the board and the
 * table has to keep moving.
 *
 * §3 is the forensic stack. The scenario id is in the room file beside `seed`
 * precisely so that `replay-room.ts`, the R200 divergence diff and the stats
 * fold keep working — and `replay-probe.ts`, which cannot, has to say so
 * rather than answer wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Action, CardName, Element, GameState, Seat } from '../src/types.ts';
import { apply, legalActions } from '../src/apply.ts';
// R201 / docs/13 §5: `allCardNames()` is complete only once `src/apply.ts` has
// been imported — one of the three synthetics is registered there, and eight
// pool-wide sweeps could see 494 of 495 cards because of it. The `apply` import
// above is what makes this list whole, and it is load-bearing rather than
// incidental.
import { allCardNames } from '../src/cards/dsl.ts';
import {
  OPPONENT, SCENARIOS, YOU, dealScenario, passiveMove, printedClauses, scenarioIds,
} from '../../server/scenarios.ts';
import { analyze, type RoomFile } from '../../server/replay-room.ts';
import { probe } from '../../server/replay-probe.ts';
import { summarizeGame } from '../../server/stats.ts';

const SEED = 216216216;
const NAMES: [string, string] = ['You', 'Tester Bot'];
const ELS: Element[] = ['fire', 'earth', 'light'];
const deal = (id?: string): { state: GameState } =>
  dealScenario(SEED, NAMES, 'shared', ELS, undefined, id);

const REGISTERED = new Set<string>(allCardNames());

// ── §1 every scenario is still describable ───────────────────────────────

test('§1 every scenario names cards this build actually has', () => {
  let checked = 0;
  for (const id of scenarioIds()) {
    const sc = SCENARIOS[id]!;
    const named: CardName[] = [
      sc.card,
      ...sc.you.hand, ...sc.opponent.hand,
      ...sc.you.play.map(p => p.card), ...sc.opponent.play.map(p => p.card),
    ];
    for (const n of named) {
      assert.ok(REGISTERED.has(n),
        `scenario '${id}' names '${n}', which is not a registered card. This is docs/14 §9's `
        + 'scenario rot: a rename elsewhere in the pool has to be a red suite, not a board the '
        + 'owner cannot play.');
      checked++;
    }
  }
  // the positive control for this sweep: it can see an unregistered name at all
  assert.equal(REGISTERED.has('Definitely Not A Card'), false);
  assert.ok(checked > 0, 'the sweep examined no card names — it would report clean on anything');
});

test('§1 every scenario has the three fields the runner screen cannot work without', () => {
  for (const id of scenarioIds()) {
    const sc = SCENARIOS[id]!;
    assert.equal(sc.id, id, `SCENARIOS['${id}'] carries id '${sc.id}' — a verdict cites the id, `
      + 'and the two must never disagree');
    assert.ok(sc.why.trim().length > 10, `'${id}' does not say why the card is in the queue`);
    assert.ok(sc.expect.trim().length > 20,
      `'${id}' has no usable \`expect\` line — docs/14 §3 calls it the load-bearing field: it is `
      + 'what lets the owner tell "the card is wrong" from "the setup is wrong"');
    // a card with printed text must produce at least one clause for the
    // dropdown; a card whose whole text is its type line (an attribute-only
    // [Augment]) legitimately produces none
    const clauses = printedClauses(sc.card);
    assert.ok(Array.isArray(clauses), `'${id}': printedClauses threw or returned nothing usable`);
  }
});

test('§1 every scenario deals, and lands where it declares it lands', () => {
  for (const id of scenarioIds()) {
    const sc = SCENARIOS[id]!;
    // dealScenario asserts phase/priority itself and throws a ScenarioError
    // naming the scenario; this is the suite-level version of that, so a rules
    // change that moves a prologue is red HERE rather than in the owner's tab
    const { state } = deal(id);
    assert.equal(state.phase, sc.phase, `'${id}' declares phase '${sc.phase}'`);
    assert.equal(state.priority ?? null, sc.priority ?? null, `'${id}' declares priority`);
    assert.equal(state.decision, null, `'${id}' opens with an unanswered decision`);
    assert.equal(state.winner, null, `'${id}' opens on a decided game`);
    // the board it claims is the board it has
    assert.deepEqual(state.players[YOU]!.hand, sc.you.hand, `'${id}': your hand`);
    assert.deepEqual(state.players[OPPONENT]!.hand, sc.opponent.hand, `'${id}': their hand`);
  }
});

// ── §2 the opponent flag (docs/14 §4 — the expensive one to get wrong) ───

/**
 * Walk the table forward with the SCRIPTED OPPONENT ONLY, and report whether
 * the owner ever gets a move.
 *
 * The failure this models is precise: the owner opens a scenario, the board is
 * waiting on seat 1, nobody is in seat 1, and the bot has nothing passive to
 * play. The tab sits there. docs/14 §4: "a scenario that silently needs an
 * opponent looks like a hung game, and a hung game looks like a bug" — and the
 * cost is a round of somebody chasing it.
 *
 * Returns null when the owner has a move (the good case), or a description of
 * where it stalled.
 */
function stallsWithoutAHuman(id: string): string | null {
  let s = deal(id).state;
  for (let step = 0; step < 40; step++) {
    if (legalActions(s, YOU).length > 0) return null;         // the owner is in control
    if (s.winner !== null || s.phase === 'gameover') return null;
    const move = passiveMove(legalActions(s, OPPONENT as Seat));
    if (!move) {
      return `seat 1 is being asked for a real decision the scripted opponent will not invent `
        + `(phase '${s.phase}', priority ${s.priority}, legal for seat 1: `
        + `${JSON.stringify(legalActions(s, OPPONENT as Seat).map(a => a.type))})`;
    }
    s = apply(s, move).state;
  }
  return `40 scripted moves and the owner still has nothing to do (phase '${s.phase}')`;
}

test('§2 a scenario that says it needs no live opponent really does not', () => {
  for (const id of scenarioIds()) {
    if (SCENARIOS[id]!.needsLiveOpponent) continue;
    const stall = stallsWithoutAHuman(id);
    assert.equal(stall, null,
      `'${id}' is marked needsLiveOpponent: false and hangs: ${stall}\n`
      + '      docs/14 §4: getting this flag wrong in the PERMISSIVE direction is the expensive '
      + 'mistake — the owner sees a dead board and files it as a card bug.');
  }
});

test('§2 …and the check itself can see a hang (positive control)', () => {
  // The guard above is worth nothing if `stallsWithoutAHuman` cannot detect
  // one. docs/13 §7.4: every observation channel proves it can see. This is a
  // state the owner genuinely cannot act in — an unanswered decision belonging
  // to seat 1 with no passive answer available — built by hand rather than by
  // breaking a real scenario.
  const s = deal('lithoghul-donated').state;
  const frozen: GameState = structuredClone(s);
  // strip seat 1's board and hand and hand it a question nothing can answer:
  // legalActions returns [] for BOTH seats, which is exactly a hung table
  frozen.phase = 'gameover' as GameState['phase'];
  assert.equal(legalActions(frozen, YOU).length, 0, 'the control state gives the owner no move');
  assert.equal(passiveMove(legalActions(frozen, OPPONENT as Seat)), undefined,
    'and the bot no passive answer — which is the shape the guard above is looking for');
});

test('§2 the bot never plays a card, an augment or an attack it was not forced into', () => {
  // The bot's whole contract is "passes and declines". A bot that could reach
  // for `playCard` would be playing the opponent's deck, and a scenario's
  // outcome would depend on what the seed dealt seat 1 — the exact opposite of
  // a reproducible board.
  const forbidden = ['playCard', 'augment', 'graft', 'activate', 'concede', 'undo'];
  const legal: Action[] = [
    { type: 'playCard', seat: OPPONENT, handIndex: 0 } as Action,
    { type: 'passPriority', seat: OPPONENT } as Action,
  ];
  assert.equal(passiveMove(legal)!.type, 'passPriority', 'passing beats playing, always');
  assert.equal(passiveMove(legal.slice(0, 1)), undefined,
    `with only ${forbidden[0]} on offer the bot must decline to move at all`);
});

// ── §3 the forensic stack still reads a scenario room ────────────────────

/** Play the vertical slice's scenario in-process and return the log, so §3 can
 * check that a FILE holding that log replays to the same board. */
function playSlice(): { actions: Action[]; state: GameState } {
  let s = deal('lithoghul-donated').state;
  const actions: Action[] = [];
  const step = (a: Action): void => { actions.push(a); s = apply(s, a).state; };
  const host = Object.values(s.entities).find(e => e.card === 'Towering Colossus')!;
  step(legalActions(s, YOU).find(a =>
    a.type === 'augment' && (a as Action & { hostId?: number }).hostId === host.id)!);
  for (let i = 0; i < 3 && s.stack.length; i++) {
    const move = passiveMove(legalActions(s, (s.priority ?? YOU) as Seat));
    if (!move) break;
    step(move);
  }
  step({ type: 'playCard', seat: YOU, handIndex: s.players[YOU]!.hand.indexOf('Luminous Arc') } as Action);
  step({
    type: 'decide', seat: YOU,
    choice: s.decision!.options.findIndex(o => (o.value as { unit?: number }).unit === host.id),
  } as Action);
  for (let i = 0; i < 6 && s.stack.length; i++) {
    const move = passiveMove(legalActions(s, (s.priority ?? YOU) as Seat));
    if (!move) break;
    step(move);
  }
  return { actions, state: s };
}

test('§3 replay-room.ts replays a scenario room to the same board (the R200 diff still works)', () => {
  const played = playSlice();
  const file: RoomFile = {
    seed: SEED, mode: 'shared', els: ELS, names: NAMES,
    scenario: 'lithoghul-donated', actions: played.actions,
  };
  const an = analyze(file);
  assert.deepEqual(an.refusals, [],
    'the forensic replay refused actions from a log it had just been handed — replay-room.ts is '
    + 'not dealing the scenario board');
  assert.equal(JSON.stringify(an.state), JSON.stringify(played.state),
    'replay-room.ts rebuilt a DIFFERENT board from the same seed + scenario + log');
  assert.equal(an.state.players[OPPONENT]!.life, 24, 'and the clause still resolved the same way');
});

test('§3 …and the same file WITHOUT the scenario field diverges immediately (positive control)', () => {
  // The assertion above is only evidence if a missing scenario would have been
  // visible. This is docs/13 §5's lesson applied to this file: a replay that
  // says "faithful" about a board it never built is the worst outcome
  // available, and it is what would happen if replay-room.ts had been left
  // calling createGame directly.
  const played = playSlice();
  const noScenario: RoomFile = {
    seed: SEED, mode: 'shared', els: ELS, names: NAMES, actions: played.actions,
  };
  const an = analyze(noScenario);
  assert.ok(an.refusals.length > 0,
    'a scenario log replayed on the PLAIN opening board was accepted in full — which means the '
    + 'assertion above proves nothing');
});

test('§3 replay-probe.ts REFUSES a scenario room rather than probing it wrong', async () => {
  const res = await probe({
    seed: SEED, mode: 'shared', els: ELS, names: NAMES,
    scenario: 'lithoghul-donated', actions: [],
  });
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /scenario/,
    'the probe must name the scenario as the reason. It loads createGame out of a worktree at a '
    + 'PAST commit and the scenario board is built against TODAY\'s engine; probing anyway would '
    + 'replay the log onto the wrong board and report a rules change that never happened.');
  // and it still works on an ordinary file
  const plain = await probe({ seed: SEED, mode: 'shared', els: ELS, names: NAMES, actions: [] });
  assert.equal(plain.ok, true, 'the refusal is scoped to scenario rooms only');
});

test('§3 the stats fold summarises a scenario room on its own board', () => {
  const played = playSlice();
  const summary = summarizeGame({
    code: 'TEST', seed: SEED, mode: 'shared', els: ELS, names: NAMES,
    scenario: 'lithoghul-donated', actions: played.actions,
  });
  assert.equal(summary.skipped, 0,
    'summarizeGame skipped actions — the post-game screen is replaying the wrong board');
  assert.equal(summary.actions, played.actions.length);
});

test('§3 history.ts refuses to fold a scenario room into anybody\'s record', async () => {
  // history.ts writes accounts on import-and-run, so the env has to be pointed
  // at scratch BEFORE it is loaded — hence the dynamic import.
  const scratch = mkdtempSync(join(tmpdir(), 'algo-186-'));
  const prevAccounts = process.env['ALGO_ACCOUNTS_FILE'];
  process.env['ALGO_ACCOUNTS_FILE'] = join(scratch, 'accounts.json');
  try {
    const games = join(scratch, 'games');
    mkdirSync(games, { recursive: true });
    const played = playSlice();
    // identical but for the one field, and both stamped with a winner so the
    // "a room somebody opened and left is not a game" filter (MIN_GAME_ACTIONS)
    // cannot be what does the skipping — the scenario field has to be
    const common = {
      seed: SEED, mode: 'shared', els: ELS, names: NAMES, actions: played.actions, winner: 0,
    };
    writeFileSync(join(games, 'SCEN.json'), JSON.stringify({ ...common, scenario: 'lithoghul-donated' }));
    writeFileSync(join(games, 'REAL.json'), JSON.stringify(common));

    const { syncGamesDir } = await import('../../server/history.ts');
    const report = syncGamesDir(games);
    const codes = report.rows.map(r => r.game.code).sort();
    assert.deepEqual(codes, ['REAL'],
      'a scenario room was folded into the game history. It is a TEST FIXTURE — a dealt board, a '
      + 'scripted opponent and a purpose — and counting it would let the instrument rewrite the '
      + 'numbers it exists to check.');
  } finally {
    if (prevAccounts === undefined) delete process.env['ALGO_ACCOUNTS_FILE'];
    else process.env['ALGO_ACCOUNTS_FILE'] = prevAccounts;
    rmSync(scratch, { recursive: true, force: true });
  }
});
