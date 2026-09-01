/* BL-06 — TEST MODE: THE CHEAT IS IN THE SETUP, AND IT IS AN ACTION.
 *
 * The backlog entry's own design note is the whole of this file's subject:
 *
 *   > The engine is a pure reducer and its purity is why replay, undo and the
 *   > fuzzer all work. Test-mode cheats should be ACTIONS in the log, gated to
 *   > sandbox rooms — not out-of-band state mutation, which would break replay
 *   > for the one mode most likely to be used to reproduce a bug report.
 *
 * So the four things worth proving here are:
 *
 *   §1 THE GATE. Every `sandbox*` action is refused in an ordinary game. This
 *      is the security-shaped assertion of the feature — a route that mints a
 *      12/12 is a cheating vector on a public deploy — and it is written as a
 *      NEGATIVE CONTROL that derives its own list of cheats from types.ts,
 *      rather than from four names somebody remembered to write down. A fifth
 *      cheat added without a gate fails this test.
 *
 *   §2 THE DEAL. `state.sandbox` is set by the DEAL and by nothing else, and
 *      the dealt board is the one BL-06 asks for: 1000 life a side, both
 *      seats, empty hands. An ordinary deal is untouched.
 *
 *   §3 THE CHEATS. Any card from the WHOLE REGISTRY into hand, board or bin;
 *      any mana; any life; the phase advanced without a second player. Plus
 *      the three refusals a player can actually provoke.
 *
 *   §4 ⚠ AND THEN IT BEHAVES UNDER NORMAL RULES. The line in DONE WHEN that
 *      makes this a sandbox rather than a cheat menu: a unit summoned this way
 *      fires its spawn trigger, the mana minted this way pays real costs
 *      through the ordinary cast rules, and the resulting attack deals its
 *      damage to a real life total.
 *
 *   §5 DETERMINISM AND REPLAY, the way `185-scenario-determinism.test.ts` does
 *      it for scenarios: same deal twice, byte for byte; and the same action
 *      log applied to two fresh deals landing on the same state. The
 *      room-level property — play it, kill the server, restore, compare —
 *      needs `rooms.ts` and is proved in `server/test-sandbox.ts` §4.
 *
 * ── HOW THESE WERE BREAK-TESTED ──────────────────────────────────────────
 *
 * Every section here was reddened on purpose before it was believed: the gate
 * by making `needSandbox` a no-op, the deal by dropping `state.sandbox = true`,
 * §4 by having `doSandboxSpawn` push the card's name into play without
 * spawning it, and §5 by seeding the pool rebuild from the record's own key
 * order. The failure messages are in the round report.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Action, Element, GameState, Seat } from '../src/types.ts';
import { apply, createGame, legalActions, IllegalAction } from '../src/apply.ts';
import { allCardNames } from '../src/cards/dsl.ts';
import { dealScenario, SANDBOX_ID, isDealId, isScenarioId } from '../../server/scenarios.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = 60600606;
const NAMES: [string, string] = ['Seat 1', 'Seat 2'];
/** any trio: `mode: 'shared'` gives the game all seven elements whatever this
 * says, and `dealScenario` wants a list rather than `undefined`. */
const ELS: Element[] = ['fire', 'water', 'earth'];
const YOU: Seat = 0;
const THEM: Seat = 1;

const sandbox = (): GameState =>
  dealScenario(SEED, NAMES, 'shared', ELS, undefined, SANDBOX_ID).state;
const ordinary = (): GameState =>
  dealScenario(SEED, NAMES, 'shared', ELS, undefined).state;

/** apply, or the refusal's message */
function refusal(s: GameState, a: Action): string {
  try {
    apply(s, a);
    return '';
  } catch (err) {
    return err instanceof IllegalAction ? err.message : `THREW ${String(err)}`;
  }
}

/** run a list of actions from a state, failing loudly on the first refusal */
function run(s: GameState, actions: Action[]): GameState {
  let out = s;
  for (const a of actions) {
    try {
      out = apply(out, a).state;
    } catch (err) {
      assert.fail(`${a.type} was refused: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

// ── §1 THE GATE ──────────────────────────────────────────────────────────

/**
 * The cheats, DERIVED from the Action union's own source.
 *
 * A TypeScript union cannot be reflected at runtime, and a hand-typed list of
 * four names is exactly the copy that would not grow when a fifth cheat is
 * added — which is the one failure that matters here, because the missing one
 * would be the ungated one. So the list is read off `types.ts`, and §1's first
 * assertion is that the scan can see. Same shape as `185 §3`'s source sweep,
 * and deliberately dumb for the same reason.
 */
function sandboxActionTypesInSource(): string[] {
  const src = readFileSync(join(HERE, '..', 'src', 'types.ts'), 'utf8');
  const hits = [...src.matchAll(/\btype:\s*'(sandbox[A-Za-z]*)'/g)].map(m => m[1]!);
  return [...new Set(hits)].sort();
}

/** one representative, well-formed instance of each cheat */
const SAMPLE: Record<string, Action> = {
  sandboxSpawn: { type: 'sandboxSpawn', seat: YOU, card: 'Towering Colossus', to: 'hand' },
  sandboxResources: { type: 'sandboxResources', seat: YOU, pool: { fire: 3 } },
  sandboxLife: { type: 'sandboxLife', seat: YOU, life: 5 },
  sandboxAdvance: { type: 'sandboxAdvance', seat: YOU },
};

test('§1 the scan finds every sandbox action the Action union declares', () => {
  const found = sandboxActionTypesInSource();
  assert.ok(found.length >= 4,
    `the source scan found ${found.length} sandbox actions — it has gone blind, and §1 below `
    + 'would then be testing nothing');
  assert.deepEqual(found, Object.keys(SAMPLE).sort(),
    'types.ts declares a sandbox action this test has no sample for. Add it to SAMPLE — the '
    + 'point of deriving this list is that a new cheat cannot be added without a gate test.');
});

test('§1 ⚠ every sandbox action is REFUSED in an ordinary game', () => {
  const plain = ordinary();
  assert.equal(plain.sandbox, undefined, 'an ordinary deal is not a sandbox');
  for (const [type, action] of Object.entries(SAMPLE)) {
    const why = refusal(plain, action);
    assert.match(why, /only legal in a sandbox room/,
      `${type} was NOT refused in an ordinary game (got: ${why || 'it was ACCEPTED'}). `
      + 'This is the security-shaped assertion of the whole feature: the client is untrusted, '
      + 'and a public deploy would otherwise let anyone mint a board mid-game.');
  }
});

test('§1 …and no sequence of actions can turn an ordinary game into a sandbox', () => {
  // the flag is a property of the DEAL. Nothing in `dispatch` writes it, and
  // this is the check that keeps it that way: the whole gate rests on there
  // being no action-shaped path to `state.sandbox`.
  const src = readFileSync(join(HERE, '..', 'src', 'apply.ts'), 'utf8');
  assert.equal(/\.sandbox\s*=(?!=)/.test(src), false,
    'engine/src/apply.ts assigns to `.sandbox`. The flag must only ever be set at the deal '
    + '(server/scenarios.ts dealSandbox) — an action that could set it would make the gate '
    + 'in §1 a formality.');
  // and the positive control for that sweep
  assert.equal(/\.sandbox\s*=(?!=)/.test('s.sandbox = true;'), true,
    'the sweep cannot see an assignment at all — it would report clean on any file');
});

test('§1 none of the cheats is offered in legalActions — the fuzzer must not wander in', () => {
  // the same rule `concede` follows, and for the same reason
  const s = sandbox();
  for (const seat of [YOU, THEM]) {
    const types = new Set(legalActions(s, seat).map(a => a.type));
    for (const type of Object.keys(SAMPLE)) {
      assert.equal(types.has(type as Action['type']), false,
        `${type} is on seat ${seat}'s legal-action menu. It is never a move to CONSIDER, `
        + 'only one to choose, and the fuzzer indexes into this list.');
    }
  }
});

// ── §2 THE DEAL ──────────────────────────────────────────────────────────

test('§2 the sandbox deal: 1000 life a side, empty hands, no mana, nothing in play', () => {
  const s = sandbox();
  assert.equal(s.sandbox, true, 'the deal set the flag that makes the four cheats legal');
  assert.deepEqual(s.players.map(p => p.life), [1000, 1000],
    'BL-06: "no opponent, 1000 life" — and BOTH seats, because the second seat is a real seat '
    + 'somebody can open in another tab and stock the same way');
  assert.deepEqual(s.players.map(p => p.hand.length), [0, 0], 'both hands are empty');
  assert.deepEqual(s.players.map(p => p.resources.length), [0, 0], 'and so are both pools');
  assert.deepEqual(Object.keys(s.entities), [], 'nothing is in play');
  assert.equal(s.phase, 'planning');
});

test('§2 an ordinary deal is untouched by test mode existing', () => {
  // 185 §2 makes this claim for scenarios; the sandbox branch sits in the same
  // function and would break it the same way
  const viaDeal = dealScenario(SEED, NAMES, 'shared', ELS, undefined);
  const viaEngine = createGame(SEED, NAMES, 'shared', ELS);
  assert.equal(JSON.stringify(viaDeal.state), JSON.stringify(viaEngine.state),
    'dealScenario() with no id must still be createGame(), byte for byte');
  assert.equal(JSON.stringify(viaDeal.events), JSON.stringify(viaEngine.events));
});

test('§2 the sandbox does not touch the library or the RNG stream', () => {
  // 185 §2's subtle hazard, restated for this deal: a mutation that DREW would
  // shift every later draw in the game, and nothing downstream would notice
  const plain = createGame(SEED, NAMES, 'shared', ELS);
  const s = sandbox();
  assert.equal(s.rngState, plain.state.rngState,
    'the sandbox deal consumed randomness — every shuffle and draw after it has moved');
  assert.deepEqual(s.sharedDeck, plain.state.sharedDeck,
    'and it reordered the library; 150-registration-order is exactly this failure');
});

test('§2 "sandbox" is a deal id but NOT a scenario', () => {
  assert.equal(isDealId(SANDBOX_ID), true, 'rooms.ts must be able to restore a saved sandbox room');
  assert.equal(isScenarioId(SANDBOX_ID), false,
    'the scenario tester\'s admin route asks isScenarioId, and ?id=sandbox is not a scenario '
    + 'to open — it has no card, no `expect` line and no verdict to file');
  assert.throws(() => dealScenario(SEED, NAMES, 'shared', ELS, undefined, 'no-such-id'),
    /no such scenario/, 'and an unknown id still throws rather than dealing a plain board');
});

// ── §3 THE CHEATS ────────────────────────────────────────────────────────

test('§3 a card from the WHOLE registry reaches hand, board or bin', () => {
  const registry = allCardNames();
  assert.ok(registry.length > 400, `the registry is ${registry.length} cards`);
  const s = run(sandbox(), [
    { type: 'sandboxSpawn', seat: YOU, card: 'Towering Colossus', to: 'play' },
    { type: 'sandboxSpawn', seat: YOU, card: 'Luminous Arc', to: 'hand' },
    { type: 'sandboxSpawn', seat: THEM, card: 'Lithoghul', to: 'bin' },
  ]);
  assert.deepEqual(Object.values(s.entities).map(e => e.card), ['Towering Colossus'],
    'the unit is really in play — an entity, not a name in a list');
  assert.deepEqual(s.players[YOU]!.hand, ['Luminous Arc']);
  assert.deepEqual(s.players[THEM]!.bin, ['Lithoghul'],
    'and the SECOND seat can be stocked the same way — two-sided is not optional');
  // the search that feeds this is over allCardNames(), so the last card in the
  // registry is as reachable as the first. Derive, never enumerate.
  const last = registry[registry.length - 1]!;
  const s2 = run(sandbox(), [{ type: 'sandboxSpawn', seat: YOU, card: last, to: 'hand' }]);
  assert.deepEqual(s2.players[YOU]!.hand, [last], `the registry's last card (${last}) is reachable too`);
});

test('§3 ⚠ a card PLACED in a bin is not TRASHED', () => {
  /* R40 defines trashing by the destination, so routing a sandbox bin summon
   * through `E.toBin` (which R145's census requires — it is the only place that
   * knows which zone a card came from) would have trashed it by default, and
   * fired "when I am trashed" for a card that had never been anywhere. That is
   * the sandbox inventing an event, which is the wrong side of BL-06's ⚠ line.
   * `from: 'sandbox'` joins `'stack'` as a non-trashing entry, and this is what
   * says so. The real trash is one click away: summon it to a hand and discard
   * it under the ordinary rules. */
  const r = apply(sandbox(), { type: 'sandboxSpawn', seat: YOU, card: 'Dropslime', to: 'bin' });
  assert.deepEqual(r.state.players[YOU]!.bin, ['Dropslime'], 'it is in the bin');
  assert.deepEqual(r.events.filter(e => e.type === 'trashed'), [],
    'and nothing was trashed on the way there — Dropslime prints a "when I am trashed" '
    + 'trigger, and a board being SET UP must not fire the events that would have got it there');
});

test('§3 mana and affinity are set to anything, in a canonical order', () => {
  const s = run(sandbox(), [
    { type: 'sandboxResources', seat: YOU, pool: { dark: 1, fire: 2 } },
  ]);
  assert.deepEqual(s.players[YOU]!.resources,
    [{ kind: 'fire', state: 'open' }, { kind: 'fire', state: 'open' }, { kind: 'dark', state: 'open' }],
    'the pool is rebuilt in ALL_ELEMENTS order, not in the order the record\'s keys arrived — '
    + 'the resource array is indexed by activateResource/exchangePrismite, so its order is part '
    + 'of the board and must not depend on what a client\'s JSON did with the key order');
  // the same pool, keys the other way round, is the same board
  const flipped = run(sandbox(), [
    { type: 'sandboxResources', seat: YOU, pool: { fire: 2, dark: 1 } },
  ]);
  assert.deepEqual(flipped.players[YOU]!.resources, s.players[YOU]!.resources);
  // and it SETS rather than adds
  const reset = run(s, [{ type: 'sandboxResources', seat: YOU, pool: { water: 1 } }]);
  assert.deepEqual(reset.players[YOU]!.resources, [{ kind: 'water', state: 'open' }]);
});

test('§3 life is set on either seat', () => {
  const s = run(sandbox(), [
    { type: 'sandboxLife', seat: THEM, life: 12 },
    { type: 'sandboxLife', seat: YOU, life: 1000 },
  ]);
  assert.deepEqual(s.players.map(p => p.life), [1000, 12]);
});

test('§3 the phase advances with nobody in the second seat', () => {
  // the acceptance line: "advance or jump phases without needing a legal
  // action". Nothing is in either hand and there is no mana, so there is no
  // play to make — and the table still moves.
  let s = sandbox();
  const seen: string[] = [s.phase];
  for (let i = 0; i < 4; i++) {
    s = run(s, [{ type: 'sandboxAdvance', seat: YOU }]);
    seen.push(`${s.phase}${s.battleRound ? `/${s.battleRound}` : ''}`);
  }
  assert.deepEqual(seen, ['planning', 'battle/1', 'battle/2', 'deploy', 'planning'],
    'four presses walk one whole turn: planning (through the haste step) into battle round 1, '
    + 'round 2, deployment, and around to the next turn');
  assert.equal(s.turn, 2, 'and the turn really flipped — end-of-turn ran');
});

test('§3 the refusals a player can actually provoke are readable', () => {
  const s = sandbox();
  assert.match(refusal(s, { type: 'sandboxSpawn', seat: YOU, card: 'Nope Nope', to: 'hand' }),
    /there is no card called "Nope Nope"/, 'a typo comes back as a refusal, not as a stack trace');
  assert.match(refusal(s, { type: 'sandboxSpawn', seat: YOU, card: 'Luminous Arc', to: 'play' }),
    /is a spell — it has no body/,
    'a spell put on the board would be a 0/0 named after a card that never enters play, and the '
    + 'owner would file the resulting nonsense as a rules bug');
  assert.match(
    refusal(s, { type: 'sandboxResources', seat: YOU, pool: { nonsense: 2 } as never }),
    /no such resource kind 'nonsense'/, 'and an unknown kind is refused rather than dropped');
});

// ── §4 ⚠ AND THEN IT BEHAVES UNDER NORMAL RULES ──────────────────────────

test('§4 a unit summoned this way fires its spawn trigger', () => {
  // Swirling Shardform: "When I spawn, create two Shards." No mode, no
  // question — so if the trigger fired, two shards are in the pool, and if the
  // spawn was faked they are not.
  const s = run(sandbox(), [
    { type: 'sandboxSpawn', seat: YOU, card: 'Swirling Shardform', to: 'play' },
  ]);
  const shards = s.players[YOU]!.resources.filter(r => r.kind === 'shard');
  assert.equal(shards.length, 2,
    'Swirling Shardform\'s "When I spawn, create two Shards" did not fire. The cheat is in '
    + 'SETTING THE BOARD UP, not in how a card behaves afterwards — that distinction is the '
    + 'whole of BL-06\'s ⚠ line, and this is what holds it.');
});

test('§4 minted mana pays a real cost through the ordinary cast rules', () => {
  // Not a peek at an internal: the observable is the engine's OWN menu, and
  // then the resources it really expends. The mana is only real if the cost
  // rules accept it and spend it.
  const canPlay = (s: GameState): boolean =>
    legalActions(s, YOU).some(a => a.type === 'playCard');
  let s = run(sandbox(), [
    { type: 'sandboxSpawn', seat: YOU, card: 'Swirling Shardform', to: 'hand' },
    // Swirling Shardform is a DEPLOY card, so walk to deployment the ordinary
    // way — asserting playability in a phase it cannot be played in would be
    // a test about the wrong thing
    { type: 'sandboxAdvance', seat: YOU },
    { type: 'sandboxAdvance', seat: YOU },
    { type: 'sandboxAdvance', seat: YOU },
  ]);
  assert.equal(s.phase, 'deploy');
  assert.equal(canPlay(s), false, 'with no mana the card in hand is not playable');

  s = run(s, [{ type: 'sandboxResources', seat: YOU, pool: { earth: 4 } }]);
  assert.equal(canPlay(s), true,
    'the minted mana did not pay for the card — a sandbox that hands out unspendable resources '
    + 'is not a sandbox');

  s = run(s, [legalActions(s, YOU).find(a => a.type === 'playCard')!]);
  assert.deepEqual(Object.values(s.entities).map(e => e.card), ['Swirling Shardform'],
    'and playing it put a real unit in play');
  assert.equal(s.players[YOU]!.resources.filter(r => r.kind === 'earth' && r.state === 'expended').length, 2,
    'Swirling Shardform costs 2, and two of the minted earth were really spent — the cheat mints '
    + 'the mana, the RULES spend it');
  assert.equal(s.players[YOU]!.resources.filter(r => r.kind === 'shard').length, 2,
    'and its spawn trigger fired on the way in, off an ordinary play this time');
});

test('§4 combat resolves against a life total set by the cheat', () => {
  let s = run(sandbox(), [
    { type: 'sandboxSpawn', seat: YOU, card: 'Towering Colossus', to: 'play' },
    { type: 'sandboxLife', seat: THEM, life: 40 },
    { type: 'sandboxAdvance', seat: YOU },
  ]);
  assert.equal(s.phase, 'battle');
  const colossus = Object.values(s.entities).find(e => e.card === 'Towering Colossus')!;
  const attacker = s.battle!.attacker;
  assert.equal(attacker, YOU,
    'seat 0 has the round-1 attack on this seed — if this flips, the seed changed, not the rules');
  s = run(s, [{ type: 'declareAttack', seat: YOU, columns: [[colossus.id]] }]);
  // drain the battle the passive way: both seats decline everything
  for (let i = 0; i < 12 && s.players[THEM]!.life === 40; i++) {
    const seat = (s.priority ?? THEM) as Seat;
    const legal = legalActions(s, seat);
    const move = legal.find(a => a.type === 'declareBlocks')
      ?? legal.find(a => a.type === 'passPriority')
      ?? legal[0];
    if (!move) break;
    s = run(s, [move]);
  }
  assert.equal(s.players[THEM]!.life, 30,
    'the 10/15 summoned by the cheat dealt its 10 to a life total set by the cheat. Triggers '
    + 'fire, statics apply, combat resolves — the sandbox only builds the board.');
});

// ── §5 DETERMINISM AND REPLAY ────────────────────────────────────────────

test('§5 the sandbox deal is byte-identical twice', () => {
  const a = dealScenario(SEED, NAMES, 'shared', ELS, undefined, SANDBOX_ID);
  const b = dealScenario(SEED, NAMES, 'shared', ELS, undefined, SANDBOX_ID);
  assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));
  assert.equal(JSON.stringify(a.events), JSON.stringify(b.events));
});

test('§5 and so is a sandbox GAME — the same log replays to the same board', () => {
  /* THE property BL-06 rests on. A sandbox room's whole purpose is to be
   * handed to somebody else as a room code, so `(seed, deal id, actions)` has
   * to reproduce it exactly — which is only true because every cheat is an
   * ACTION and none of them reads anything outside the state. */
  const LOG: Action[] = [
    { type: 'sandboxSpawn', seat: YOU, card: 'Swirling Shardform', to: 'play' },
    { type: 'sandboxSpawn', seat: THEM, card: 'Towering Colossus', to: 'play' },
    { type: 'sandboxResources', seat: YOU, pool: { light: 4, fire: 1 } },
    { type: 'sandboxSpawn', seat: YOU, card: 'Luminous Arc', to: 'hand' },
    { type: 'sandboxLife', seat: THEM, life: 25 },
    { type: 'sandboxAdvance', seat: YOU },
    { type: 'sandboxSpawn', seat: THEM, card: 'Lithoghul', to: 'bin' },
  ];
  const first = run(sandbox(), LOG);
  let churn = 0;
  for (let i = 0; i < 100_000; i++) churn += Math.random();
  assert.ok(churn >= 0);   // keep the loop from being optimised away
  const second = run(sandbox(), LOG);
  assert.equal(JSON.stringify(first), JSON.stringify(second),
    'two runs of the same sandbox log parted. Something in a cheat is reading the wall clock, '
    + 'unseeded randomness, or state outside the game — and every bug report reproduced in test '
    + 'mode would be a claim about a board nobody else can build.');
  assert.equal(first.actionCount, LOG.length, 'and every cheat is really IN the log');
});

test('§5 a sandbox log replayed onto an ORDINARY deal is refused, not silently applied', () => {
  // the other half of the gate, and the reason it must never be a warning: a
  // saved sandbox room whose deal id went missing must fail loudly rather than
  // quietly become a game somebody played
  const why = refusal(ordinary(), { type: 'sandboxSpawn', seat: YOU, card: 'Lithoghul', to: 'play' });
  assert.match(why, /only legal in a sandbox room/);
});
