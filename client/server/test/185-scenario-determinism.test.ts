/* R216 — THE SCENARIO MUTATION IS PURE, TOTAL, AND ACTUALLY THERE.
 *
 * `docs/14-scenario-tester.md` §2 rests the whole design on one property:
 *
 *   > The mutation must be pure and total: same scenario id + same engine →
 *   > the same board, every time. No `Date.now()`, no unseeded randomness.
 *
 * and §9 names the specific way a build like this fails:
 *
 *   > Freezing a `works` verdict into a test that cannot fail is §5 with extra
 *   > steps.
 *
 * Both hazards are real and both have precedent in this repo.
 *
 * `150-registration-order` is the precedent for the first: a batch importing
 * another batch reshuffled every deck and NOTHING IN THE SUITE NOTICED. A
 * scenario is a mutation applied inside the deal, so it sits on exactly that
 * fault line — and a scenario that dealt differently on the second run would
 * make every verdict citing it worthless, silently.
 *
 * `docs/13-assessment.md` §5 is the precedent for the second, four times over
 * ("four `fixed` reports had guards that could never have failed"). A
 * determinism test on a mutation that did NOTHING would pass beautifully. So
 * §1 below is not the determinism check — it is the check that there is
 * something to be deterministic about, and every one of these assertions was
 * break-tested by breaking `scenarios.ts` and watching it redden (the failure
 * messages are recorded in the round report).
 *
 * ── WHAT THIS FILE DOES NOT COVER ────────────────────────────────────────
 *
 * The byte-identical REBUILD — the property docs/14 §8.1 says decides whether
 * the design is right at all — needs `rooms.ts`, and `rooms.ts` pulls in `ws`
 * (R181). It is proved against the real server instead, in
 * `server/test-scenario.ts` §4: play a scenario room, kill the server, restore
 * from the file, and compare the pushed views byte for byte.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';
import { apply, createGame, legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../view.ts';
import {
  OPPONENT, SCENARIOS, YOU, dealScenario, passiveMove, printedClauses, scenarioBrief,
} from '../scenarios.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = 216216216;
const NAMES: [string, string] = ['You', 'Tester Bot'];
const ELS = ['fire', 'earth', 'light'] as import('../../engine/src/types.ts').Element[];

const deal = (id?: string): { state: GameState; events: unknown[] } =>
  dealScenario(SEED, NAMES, 'shared', ELS, undefined, id);

// ── §1 THE POSITIVE CONTROL — the mutation is not a no-op ────────────────
//
// Read this section first. Everything below it is only worth something if this
// holds, and a "deterministic" no-op would satisfy every other test here.

test('§1 a scenario board is DIFFERENT from the board the same seed deals without it', () => {
  const plain = deal();
  const scen = deal('lithoghul-donated');
  assert.notEqual(JSON.stringify(plain.state), JSON.stringify(scen.state),
    'the scenario deal produced the same state as a plain deal — the mutation did nothing');
});

test('§1 and the difference is the board the scenario DECLARES, in the seat\'s own redacted view', () => {
  const { state } = deal('lithoghul-donated');
  // the VIEW, not the raw state: this is the channel the browser is served,
  // and asserting the raw state would be checking that the code ran rather
  // than that the owner can see it
  const v = viewFor(state, YOU, null) as unknown as {
    players: { hand: string[]; life: number; resources: { state: string }[] }[];
    entities: Record<string, { card: string; kind: string; controller: number; region: number }>;
    phase: string; priority: number | null;
  };
  assert.deepEqual(v.players[YOU]!.hand, ['Lithoghul', 'Luminous Arc'],
    'your hand is exactly the two cards the scenario deals');
  assert.equal(v.players[YOU]!.resources.length, 6, 'and the six resources it deals');
  assert.ok(v.players[YOU]!.resources.every(r => r.state === 'open'), 'all open');

  const units = Object.values(v.entities).filter(e => e.kind === 'unit');
  assert.deepEqual(
    units.map(u => [u.card, u.controller]).sort(),
    [['The Foretold', YOU], ['Towering Colossus', OPPONENT]].sort(),
    'both bodies are on the board, on the right sides');
  assert.equal(v.phase, 'battle', 'and the prologue walked the game into the battle window');
  assert.equal(v.priority, YOU, 'with priority on the owner');
  assert.equal(v.players[YOU]!.life, 30);
  assert.equal(v.players[OPPONENT]!.life, 30);
});

test('§1 the board really produces the SITUATION the clause needs — a legal donated augment', () => {
  const { state } = deal('lithoghul-donated');
  const host = Object.values(state.entities).find(e => e.card === 'Towering Colossus')!;
  const offers = legalActions(state, YOU)
    .filter(a => a.type === 'augment') as (Action & { hostId?: number })[];
  assert.ok(offers.some(a => a.hostId === host.id),
    'augmenting Lithoghul onto the ENEMY unit is not on the menu — the {Virus} donation path '
    + `is unreachable from this board. Offered hosts: ${JSON.stringify(offers.map(a => a.hostId))}`);
});

/**
 * §1 — and the whole clause, end to end, in-process.
 *
 * This is a HAND-WRITTEN control, deliberately not the §6 "freeze a `works`
 * verdict into a regression test" pipeline (which is the next agent's job and
 * is explicitly out of scope for this slice). Its job here is narrow: prove
 * that the board this scenario deals actually reaches the printed clause and
 * produces a result the owner can judge — because a scenario that cannot be
 * played to a conclusion is a `bad scenario` verdict waiting to happen, and
 * the point of the vertical slice is to find that out now rather than at 40
 * cards an hour.
 *
 * R131: the augment is worn by the OPPONENT's unit, so "you" is the host's
 * controller. `batch-earth-a.ts`'s own comment calls that "the whole point of
 * the card", and no test in the suite had ever let it resolve —
 * `16-earth-a` and `105-semantics-playwatch` spawn Lithoghul as its own body,
 * and `112-literal-wood` NEGATES the virus before it can attach.
 */
test('§1 the scenario plays to its printed outcome: the HOST\'S CONTROLLER takes the 6', () => {
  let s = deal('lithoghul-donated').state;
  const host = Object.values(s.entities).find(e => e.card === 'Towering Colossus')!;
  const step = (a: Action): void => { s = apply(s, a).state; };

  const aug = legalActions(s, YOU).find(a =>
    a.type === 'augment' && (a as Action & { hostId?: number }).hostId === host.id)!;
  step(aug);
  // the scripted opponent's own rule, not a hand-rolled "pass" — so this test
  // also exercises what main.ts will actually do at the table
  drain(() => s, step);
  assert.equal(s.entities[host.id]!.mods.length, 1, 'the donated augment attached');

  const arc = s.players[YOU]!.hand.indexOf('Luminous Arc');
  step({ type: 'playCard', seat: YOU, handIndex: arc } as Action);
  const opt = s.decision!.options.findIndex(o =>
    (o.value as { unit?: number }).unit === host.id);
  assert.ok(opt >= 0, 'the enemy host is on the Arc\'s target menu');
  step({ type: 'decide', seat: YOU, choice: opt } as Action);
  drain(() => s, step);

  assert.equal(s.entities[host.id]!.damage, 6, 'the Arc dealt its 6 to the host');
  assert.equal(s.players[OPPONENT]!.life, 24,
    'R131: the augment is worn by THEIR unit, so "you" is its controller — they take the 6');
  assert.equal(s.players[YOU]!.life, 30,
    'and not the augment\'s owner. If this reads 24 the "me"/"you" resolution on donated text '
    + 'has flipped, which is the family docs/13 §1③ names as the biggest untested hole.');
});

/** Pass both seats until the stack is empty (or nothing passive is on offer),
 * using the same `passiveMove` rule the server's scripted opponent uses. */
function drain(get: () => GameState, step: (a: Action) => void): void {
  for (let i = 0; i < 12; i++) {
    const s = get();
    if (!s.stack.length && s.priority === YOU) return;
    if (s.decision) return;
    const seat = (s.priority ?? YOU) as Seat;
    const move = passiveMove(legalActions(s, seat));
    if (!move) return;
    step(move);
  }
}

// ── §2 PURITY — same id, same engine, same board ─────────────────────────

test('§2 dealing the same scenario twice produces byte-identical states', () => {
  for (const id of Object.keys(SCENARIOS)) {
    const a = deal(id);
    const b = deal(id);
    assert.equal(JSON.stringify(a.state), JSON.stringify(b.state),
      `scenario '${id}' dealt two different boards from the same seed — it is not pure, and every `
      + 'verdict citing it would be a claim about a game nobody can reproduce');
    assert.equal(JSON.stringify(a.events), JSON.stringify(b.events),
      `scenario '${id}' produced two different event lists`);
  }
});

test('§2 and so does dealing it at a different moment (no wall-clock, no unseeded RNG)', () => {
  // The cheap, direct version of the source sweep below: if anything in the
  // mutation read the clock or an unseeded RNG, two deals separated by real
  // work would part. 150-registration-order is why this is not assumed.
  const first = deal('lithoghul-donated').state;
  let churn = 0;
  for (let i = 0; i < 200_000; i++) churn += Math.random();
  const second = deal('lithoghul-donated').state;
  assert.ok(churn >= 0);   // keep the loop from being optimised away
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('§2 the mutation does not consume the deal\'s RNG stream or its id clock', () => {
  // The subtle version of the same hazard, and the one 150-registration-order
  // actually caught: a mutation that DRAWS from the shared RNG leaves every
  // later draw in that game shifted. The board patch may allocate entity ids
  // (it spawns units — that is its job), but the RNG state it hands the game
  // must be the one createGame produced.
  const plain = createGame(SEED, NAMES, 'shared', ELS);
  const scen = deal('lithoghul-donated');
  assert.equal(scen.state.rngState, plain.state.rngState,
    'the scenario board consumed randomness — every shuffle and every draw after it has moved');
  assert.equal(scen.state.sharedDeck?.length, plain.state.sharedDeck?.length,
    'the scenario board changed the deck; a scenario deals a HAND, it does not touch the library');
  assert.deepEqual(scen.state.sharedDeck, plain.state.sharedDeck,
    'and it did not reorder it either — 150-registration-order is exactly this failure, one level up');
});

test('§2 an ordinary room is untouched by the tester existing', () => {
  const viaScenarios = deal();
  const viaEngine = createGame(SEED, NAMES, 'shared', ELS);
  assert.equal(JSON.stringify(viaScenarios.state), JSON.stringify(viaEngine.state),
    'dealScenario() with no scenario id must be createGame(), byte for byte — rooms.ts routes '
    + 'EVERY room through it, including the 23 real games on the server');
  assert.equal(JSON.stringify(viaScenarios.events), JSON.stringify(viaEngine.events));
});

test('§2 an unknown scenario id throws rather than dealing a plain board', () => {
  assert.throws(() => deal('no-such-scenario'), /no such scenario/,
    'a room naming a scenario this build does not have must never quietly become an ordinary game: '
    + 'its log was recorded against a board that came from somewhere');
});

// ── §3 THE SOURCE SWEEP ──────────────────────────────────────────────────

test('§3 scenarios.ts names no clock and no unseeded randomness', () => {
  const src = readFileSync(join(HERE, '..', 'scenarios.ts'), 'utf8');
  // Deliberately a raw scan of the WHOLE FILE, comments included, and it is
  // allowed to be over-eager: docs/13 §5 records `stripCode` going blind three
  // separate times, and every sweep in the repo rests on it. This one has
  // nothing to go blind about — if the words appear anywhere in this file,
  // somebody should look. The comments here say "no `Date.now()`" with
  // backticks, which is why the patterns require a call or an identifier
  // rather than the bare word.
  for (const pattern of [/Date\s*\.\s*now\s*\(/, /Math\s*\.\s*random\s*\(/, /performance\s*\.\s*now\s*\(/, /crypto\./]) {
    assert.equal(pattern.test(src), false,
      `server/scenarios.ts matches ${pattern} — a scenario board must be a pure function of its id`);
  }
  // and the positive control for THIS sweep: it can see when the thing is there
  assert.equal(/Date\s*\.\s*now\s*\(/.test('const t = Date.now();'), true,
    'the sweep cannot see a clock call at all — it would report clean on any file');
});

// ── §4 the runner's payload is derived, not typed ────────────────────────

test('§4 the clause dropdown is derived from printed.json', () => {
  const clauses = printedClauses('Lithoghul');
  assert.deepEqual(clauses, ['[Augment] Whenever I am dealt damage, I deal that much damage to you.'],
    'the clause list is what the CARD prints — docs/13 §7.2\'s standing rule is derive, never '
    + 'enumerate, and a hand-typed list would keep the old wording forever after an errata');
  // reminder text and frame line-breaks are markup, not clauses
  const withReminder = printedClauses('Adversary of the Deep');
  assert.ok(withReminder.length >= 1);
  assert.ok(!withReminder.join(' ').includes('{i}'), 'reminder markup is stripped');
  assert.ok(!withReminder.join(' ').includes('{/n}'), 'frame line-breaks are stripped');
});

test('§4 every scenario gets a brief, and it carries the four buttons\' subject matter', () => {
  for (const id of Object.keys(SCENARIOS)) {
    const brief = scenarioBrief(id);
    assert.ok(brief, `no brief for '${id}'`);
    assert.equal(brief!.id, id);
    assert.ok(brief!.expect.trim().length > 20,
      `'${id}' has no usable \`expect\` line — it is the field that lets the owner tell "the card `
      + 'is wrong" from "the setup is wrong"');
  }
  assert.equal(scenarioBrief('no-such-scenario'), null);
});
