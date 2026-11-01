/* 779 — WHEN ONE EFFECT ASKS EACH PLAYER IN TURN, WHAT THE LATER CHOOSER IS
 * SERVED ABOUT THE EARLIER PICK — exactly what CR 102.3b allows, and nothing
 * through any other field.
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
 * That leak was closed first (2026-11-01, report #317), and the question went
 * to the rules channel. Its answer, relayed by the owner the same day: "Hidden
 * information stays hidden (all you know is that your opponent made a
 * choice), but open information is known by both players for the choice."
 *
 * So the wire now carries the earlier pick ON PURPOSE when it is open — a unit
 * in play, here — and ONLY in the one field built for it, `decision.earlier`
 * (the asked seat) / `earlierPicks` (the waiting seat), classified by the
 * engine. A hidden pick (Cthyrian Culler: each player discards a card) is
 * served as "seat N chose" and nothing else.
 *
 * THE ASSERTION IS NON-INTERFERENCE, NOT A STRING SEARCH. The first seat's
 * chosen unit is still on the board when the second seat is asked (nothing
 * is committed yet), so its id is legitimately all over the view and
 * grepping for it proves nothing. Instead each scenario is played twice from
 * the same seed, identical except for WHICH unit (or card) the first seat
 * picks, and everything the second seat is served at its own prompt — the
 * whole serialized view plus every event of the first seat's answer that
 * reaches it — is compared. For an open pick the two may differ at the
 * `earlier` field and nowhere else; for a hidden pick they may not differ at
 * all.
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

/** CR 102.3b: the served payload with the one sanctioned carrier of the
 * earlier pick taken out — what must still be identical for an OPEN pick */
function withoutEarlier(x: string): string {
  const [view, lines] = JSON.parse(x) as [{ decision?: { earlier?: unknown } | null }, unknown];
  if (view.decision) delete view.decision.earlier;
  return JSON.stringify([view, lines]);
}

/** the earlier picks the asked seat is shown, read off what it was served */
function earlierServed(x: string): unknown {
  return (JSON.parse(x) as [{ decision?: { earlier?: unknown } }])[0].decision?.earlier;
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

test('Rockfall: the second chooser is served the same thing whichever unit the first chose, except the open pick in decision.earlier', () => {
  const x = rockfall(0), y = rockfall(1);
  assert.notEqual(x.a.firstPicked, y.a.firstPicked, 'the two runs really differ in the first pick');
  assert.equal(x.a.second, y.a.second);
  sameServed(withoutEarlier(x.a.servedSecond), withoutEarlier(y.a.servedSecond),
    "the second chooser's wire encodes the first chooser's pick somewhere other than decision.earlier");
  noAnswersOnTheWire(x.h, x.a, 'Rockfall');
});

test('CR 102.3b: Rockfall — the second chooser is shown which unit the first chose (open information)', () => {
  for (const which of [0, 1] as const) {
    const { a } = rockfall(which);
    const earlier = earlierServed(a.servedSecond) as { seat: number; open: boolean; option?: { value: unknown } }[];
    assert.equal(earlier?.length, 1, 'one earlier pick is served');
    assert.equal(earlier[0]!.seat, a.first);
    assert.equal(earlier[0]!.open, true);
    assert.equal(earlier[0]!.option?.value, a.firstPicked, 'the unit the first seat chose, by id');
  }
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

test('General Smof: the second sacrificer is served the same thing whichever unit the first chose, except the open pick in decision.earlier', () => {
  const x = smof(0), y = smof(1);
  assert.notEqual(x.a.firstPicked, y.a.firstPicked, 'the two runs really differ in the first pick');
  assert.equal(x.a.second, y.a.second);
  sameServed(withoutEarlier(x.a.servedSecond), withoutEarlier(y.a.servedSecond),
    "the second sacrificer's wire encodes the first sacrificer's pick somewhere other than decision.earlier");
  noAnswersOnTheWire(x.h, x.a, 'General Smof');
});

test('CR 102.3a: General Smof asks the initiative player first', () => {
  const { h, a } = smof(0);
  assert.equal(a.first, h.state.initiative);
});

test('CR 102.3b: the waiting first chooser is shown its own open pick, and whose turn it is', () => {
  const { h, a } = smof(1);
  const v = viewFor(h.state, a.first);
  assert.equal(v.decision, null, 'the question is not the waiting seat\'s');
  assert.equal(v.pendingAsk?.seat, a.second, 'it is the other seat\'s turn to pick');
  assert.deepEqual(v.earlierPicks?.map(p => [p.seat, p.open, p.option?.value]), [[a.first, true, a.firstPicked]]);
});

// ── Cthyrian Culler (each player discards a card): a HIDDEN pick ──────────

function culler(which: 0 | 1): { h: Harness; a: Asked } {
  const h = new Harness(77903);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const unit = spawn(h, A, 'Cthyrian Culler');
  spawn(h, D, ANVIL);
  toNextBattle(h, A);
  for (const s of [A, D]) {
    h.state.players[s]!.hand = [];
    give(h, s, 'Immolate'); give(h, s, 'Tidal Menace'); give(h, s, 'Bubb');
  }
  h.do({ type: 'declareAttack', seat: A, columns: [[unit]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  for (let guard = 0; guard < 12 && !h.state.decision; guard++) pass(h);
  assert.match(h.state.decision?.prompt ?? '', /Cthyrian Culler/, 'the Culler is asking');
  return { h, a: answerFirst(h, which, 'Cthyrian Culler') };
}

test('CR 102.3b: Cthyrian Culler — the second discarder is served the same thing whichever card the first chose (a hand is hidden)', () => {
  const x = culler(0), y = culler(1);
  assert.notEqual(x.a.firstPicked, y.a.firstPicked, 'the two runs really differ in the first pick');
  assert.equal(x.a.second, y.a.second);
  sameServed(x.a.servedSecond, y.a.servedSecond,
    "the second discarder's wire encodes which card the first discarder chose");
  assert.deepEqual(earlierServed(x.a.servedSecond), [{ seat: x.a.first, open: false }],
    'the second discarder is told THAT the first chose, and nothing more');
  noAnswersOnTheWire(x.h, x.a, 'Cthyrian Culler');
});

test('CR 102.3b: the waiting seat is served a hidden pick as "chosen" only, even if the engine had filled it in', () => {
  const { h, a } = culler(0);
  // belt and braces: the view reduces a hidden entry itself, whatever the engine put there
  h.state.decision!.earlier = [{ seat: a.first, open: false, option: { label: 'Bubb', value: 2, card: 'Bubb' } }];
  for (const seat of [a.first, a.second]) {
    const v = viewFor(h.state, seat);
    const picks = v.decision?.earlier ?? v.earlierPicks;
    assert.deepEqual(picks, [{ seat: a.first, open: false }], `seat ${seat}`);
  }
});

// ── the fix is a redaction, not a change to the game ─────────────────────

test('the server still resumes from the real answers: both picks land', () => {
  const { h, a } = smof(1);
  const dec = h.state.decision!;
  h.do({ type: 'decide', seat: dec.seat, choice: 0 });
  assert.equal(ent(h, a.firstPicked), undefined, "the first seat's pick was sacrificed");
  assert.ok(h.state.players[a.second]!.bin.length > 0, "the second seat's pick was sacrificed too");
});
