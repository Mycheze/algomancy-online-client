/* 779 — WHEN ONE EFFECT ASKS EACH PLAYER IN TURN, THE SECOND CHOOSER'S WIRE
 * DID NOT CARRY THE FIRST CHOOSER'S PICK.
 *
 * Rockfall (A Fast Pile of Rocks) and General Smof ask every present player
 * for one of their own units, one seat after the other, and commit nothing
 * until the last has answered (plan-then-commit). The engine runs that as a
 * 'resolve' suspension: `ctx.choose` throws, and the part is re-run from the
 * top with every answer so far in `suspension.answers`. When the second seat
 * was asked, `viewFor` (server/view.ts) handed it that suspension with only
 * `snapshot` deleted — so its WebSocket data carried, e.g.,
 *
 *     { type: 'resolve', answers: { '0:rf:0': 2 }, pendingKey: '0:rf:1', … }
 *
 * where 2 is the unit the FIRST seat had just chosen. Nothing on screen drew
 * it (no client/ui code reads `answers`), but it was readable in devtools.
 *
 * Whether the second chooser SHOULD know the first pick is an open rules
 * question (owner, 2026-11-01: close the leak now, ask the rules channel).
 * So this pins only the wire, not the screen or the asking order.
 *
 * THE ASSERTION IS NON-INTERFERENCE, NOT A STRING SEARCH. The first seat's
 * chosen unit is still on the board when the second seat is asked (nothing
 * is committed yet), so its id is legitimately all over the view and
 * grepping for it proves nothing. Instead each scenario is played twice from
 * the same seed, identical except for WHICH unit the first seat picks, and
 * everything the second seat is served at its own prompt — the whole
 * serialized view plus every event of the first seat's answer that reaches
 * it — must be byte-identical. Any field anywhere that encodes the pick
 * makes the two differ.
 *
 * Seeds 77900-77999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { ent, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { EngineEvent, EntityId, Seat } from '../../engine/src/types.ts';
import { redactEvent, viewFor, visibleToSeat } from '../view.ts';

const ANVIL = 'Triskaidekaphage';        // 0/13, no static, no spawn trigger

const passUntil = (h: Harness, seat: Seat): void => { while (h.state.priority !== seat) pass(h); };
const drain0 = (h: Harness): void => {
  let guard = 200;
  while (h.state.stack.length && !h.state.decision && guard-- > 0) pass(h);
};

/** What `seat` is served at its prompt: the redacted view plus the redacted,
 * visible events of the action that raised the prompt. */
function served(h: Harness, seat: Seat, evs: EngineEvent[]): string {
  const names = h.state.players.map(p => p.name);
  const lines = evs.filter(e => visibleToSeat(e, seat)).map(e => redactEvent(e, seat, names));
  return JSON.stringify([viewFor(h.state, seat), lines]);
}

/** the JSON paths at which two served payloads differ (empty = identical) */
function diffPaths(a: unknown, b: unknown, at = '$', out: string[] = []): string[] {
  if (out.length > 20) return out;
  if (a === b) return out;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    out.push(`${at}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    return out;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  for (const k of new Set([...ka, ...kb])) {
    diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${at}.${k}`, out);
  }
  return out;
}

function sameServed(x: string, y: string, why: string): void {
  const d = diffPaths(JSON.parse(x), JSON.parse(y));
  assert.deepEqual(d, [], `${why}:\n  ${d.join('\n  ')}`);
}

interface Asked { first: Seat; second: Seat; servedSecond: string; firstPicked: EntityId }

/** Answer the first question with option `which`, and capture what the
 * second-asked seat is served at its own prompt. */
function answerFirst(h: Harness, which: 0 | 1, label: string): Asked {
  const dec = h.state.decision;
  assert.ok(dec, `${label}: the first seat is being asked`);
  const first = dec.seat;
  assert.ok(dec.options.length >= 2, `${label}: the first seat has a real choice`);
  const firstPicked = dec.options[which]!.value as EntityId;
  const evs = h.do({ type: 'decide', seat: first, choice: which });
  const dec2 = h.state.decision;
  assert.ok(dec2, `${label}: a second question follows`);
  const second = dec2.seat;
  assert.notEqual(second, first, `${label}: the second question is the OTHER seat's`);
  assert.equal(h.state.suspension?.type, 'resolve', `${label}: asked mid-resolution`);
  return { first, second, servedSecond: served(h, second, evs), firstPicked };
}

function noAnswersOnTheWire(h: Harness, a: Asked, label: string): void {
  for (const seat of [a.first, a.second]) {
    const sus = viewFor(h.state, seat).suspension as Record<string, unknown> | null;
    if (!sus) continue;
    const answers = sus['answers'] as Record<string, unknown> | undefined;
    assert.ok(!answers || Object.keys(answers).length === 0,
      `${label}: seat ${seat}'s view carries suspension.answers ${JSON.stringify(answers)}`);
  }
}

// ── Rockfall ─────────────────────────────────────────────────────────────

function rockfall(which: 0 | 1): { h: Harness; a: Asked } {
  const h = new Harness(77901);
  toDeployment(h);
  const A = h.state.deployPlayer as Seat, D = (1 - A) as Seat;
  const rocks = spawn(h, A, 'A Fast Pile of Rocks');
  const mine = [spawn(h, A, ANVIL), spawn(h, A, ANVIL)];
  spawn(h, D, ANVIL); spawn(h, D, ANVIL);
  giveResources(h, A, 'fire', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rocks], [mine[0]!], [mine[1]!]] });
  passUntil(h, A);
  h.state.players[A]!.hand = [];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: rocks });
  drain0(h);
  assert.equal(ent(h, rocks), undefined, 'the Rock Pile died');
  return { h, a: answerFirst(h, which, 'Rockfall') };
}

test('Rockfall: the second chooser is served the same thing whichever unit the first chose', () => {
  const x = rockfall(0), y = rockfall(1);
  assert.notEqual(x.a.firstPicked, y.a.firstPicked, 'the two runs really differ in the first pick');
  assert.equal(x.a.second, y.a.second);
  sameServed(x.a.servedSecond, y.a.servedSecond,
    "the second chooser's wire encodes the first chooser's pick");
  noAnswersOnTheWire(x.h, x.a, 'Rockfall');
});

// ── General Smof (each player sacrifices a unit) ─────────────────────────

function smof(which: 0 | 1): { h: Harness; a: Asked } {
  const h = new Harness(77902);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const general = spawn(h, A, 'General Smof');
  const fodder = spawn(h, A, 'Conduit of Pain');
  spawn(h, D, 'Good Whale'); spawn(h, D, ANVIL);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[general], [fodder]] });
  pass(h); pass(h);                                  // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                  // combat, afterCombat trigger pushed
  pass(h); pass(h);                                  // resolve the trigger
  return { h, a: answerFirst(h, which, 'General Smof') };
}

test('General Smof: the second sacrificer is served the same thing whichever unit the first chose', () => {
  const x = smof(0), y = smof(1);
  assert.notEqual(x.a.firstPicked, y.a.firstPicked, 'the two runs really differ in the first pick');
  assert.equal(x.a.second, y.a.second);
  sameServed(x.a.servedSecond, y.a.servedSecond,
    "the second sacrificer's wire encodes the first sacrificer's pick");
  noAnswersOnTheWire(x.h, x.a, 'General Smof');
});

// ── the fix is a redaction, not a change to the game ─────────────────────

test('the server still resumes from the real answers: both picks land', () => {
  const { h, a } = smof(1);
  const dec = h.state.decision!;
  h.do({ type: 'decide', seat: dec.seat, choice: 0 });
  assert.equal(ent(h, a.firstPicked), undefined, "the first seat's pick was sacrificed");
  assert.ok(h.state.players[a.second]!.bin.length > 0, "the second seat's pick was sacrificed too");
});
