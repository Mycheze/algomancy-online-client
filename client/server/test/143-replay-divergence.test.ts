/* R169 / CT-45 + CT-47 — A REPLAY THAT MISREPORTS IS A TOOL THAT MANUFACTURES
 * WRONG CONCLUSIONS, AND A CONTRACT COMMENT THAT LIES IS THE SAME THING.
 *
 * This repo settles playtest bug reports by replaying saved games. So the
 * failure mode that matters most in `server/replay-room.ts` is not "it missed
 * something" — it is "it said something confident and wrong".
 *
 * It did. ANBB replayed as *"141 actions logged, 126 replayed, 15 skipped"*,
 * which reads as a 89%-faithful replay with fifteen small independent hiccups.
 * It is one failure. Action [125] is a `decide` the current engine cannot
 * accept; the decision it was meant to answer therefore stays open forever, and
 * `apply()` refuses every later action by EITHER seat. Thirteen of the fourteen
 * cascade refusals say "a decision is pending for Ben", which is exactly what a
 * different, real bug looks like — and they were read that way and briefed as
 * thirteen findings. All thirteen were phantom.
 *
 * §1  DIVERGENCE, NOT A SKIP COUNT. The report must name the FIRST action that
 *     failed, and must say in words that the remainder is cascade.
 * §2  THE ENGINE'S HALF. What `doDecide`'s orderTriggers arm does with an
 *     answer it can no longer accept, asserted directly. It REFUSES, and marks
 *     the refusal `unanswerable` — it does not coerce a scalar into an
 *     ordering. `processTriggerQueue` only ever raises that question when the
 *     seat has ≥2 distinguishable triggers, so a scalar cannot name a
 *     permutation of them under this encoding or any past one: reading a bare
 *     `0` as "the identity order" would INVENT an ordering the player never
 *     picked and carry the replay on over a board they never saw. For a tool
 *     whose whole job is settling bug reports, a fabricated answer is strictly
 *     worse than a stopped run.
 * §3  CT-47 — `legalActions`' contract, as newly worded, including its ONE
 *     named exception, and the fuzzer's refusal to widen it.
 *
 * The logs here are grown, not committed: a fuzz seed that happens to contain
 * a real trigger-ordering answer is a game this engine replays perfectly, so
 * corrupting exactly one action in it isolates the variable completely.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, createGame, legalActions, IllegalAction } from '../../engine/src/apply.ts';
import { Harness } from '../../engine/src/harness.ts';
import { registerSynthetic } from '../../engine/src/cards/dsl.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';
import { give, spawn } from '../../engine/test/util.ts';
import { fuzzGame, isContractException } from '../../engine/test/fuzz.ts';
import { analyze, reportLines, type RoomFile } from '../replay-room.ts';

/* ── fixtures ────────────────────────────────────────────────────────── */

/** Seeds known to produce a real `orderTriggers` answer. Several, because a
 * fuzz log drifts the moment anything upstream of it changes and this file
 * must not go quietly un-red when it does — if none of them still works the
 * helper says so out loud rather than skipping. */
// Re-found 2026-09-19 when R299 added a recycle option and every fuzz walk
// drifted (the old set was 13, 28, 30, 50, 1, 11, 27, 53). ⚠ Reaching an
// ordering answer is not enough: §1's cascade test needs the corrupted answer
// to WEDGE the rest of the log, and seeds 3, 12, 21 and 43 reach one without
// wedging. Every seed here does both.
const SEEDS = [44, 57, 63, 68, 73, 81, 86];

interface OrderingLog { seed: number; actions: Action[]; at: number }
let cached: OrderingLog | null = null;

/** A complete, faithful game log with a trigger-ORDERING answer inside it. */
function orderingLog(): OrderingLog {
  if (cached) return cached;
  for (const seed of SEEDS) {
    const r = fuzzGame(seed, 2500);
    const at = r.actions.findIndex(a => a.type === 'decide' && Array.isArray(a.choice));
    if (at >= 0) return (cached = { seed, actions: r.actions, at });
  }
  throw new Error(
    `none of the seeds ${SEEDS.join(', ')} still reaches an orderTriggers decision — `
    + 'find a fresh one (scan fuzzGame logs for a `decide` whose choice is an array) '
    + 'rather than deleting this file: the answers it pins are still live',
  );
}

function fileOf(actions: Action[], seed: number): RoomFile {
  return { seed, mode: 'shared', names: ['Ben', 'Rashi'], actions };
}

/** the board as it stood just before the logged action at `at` */
function stateBefore(log: OrderingLog): GameState {
  let { state } = createGame(log.seed, undefined, 'shared');
  for (let i = 0; i < log.at; i++) state = apply(state, log.actions[i]!).state;
  return state;
}

function refuse(state: GameState, action: Action): IllegalAction {
  try {
    apply(state, action);
  } catch (err) {
    assert.ok(err instanceof IllegalAction, `expected an IllegalAction, got ${String(err)}`);
    return err as IllegalAction;
  }
  throw new assert.AssertionError({ message: `${JSON.stringify(action)} was ACCEPTED` });
}

/* ═══ §1 DIVERGENCE, NOT A SKIP COUNT ════════════════════════════════ */

test('R169/CT-45: a log whose decision answer can no longer be accepted names the FIRST diverging action, not a skip count', () => {
  const log = orderingLog();
  const asked = log.actions[log.at]!;
  assert.ok(asked.type === 'decide' && Array.isArray(asked.choice) && asked.choice.length >= 2,
    'the fixture really is a trigger ordering — an array over ≥2 triggers');

  // exactly ANBB [125]: the recorded answer is a scalar where the live question
  // wants a permutation. ONE action changed, nothing else.
  const bad = structuredClone(log.actions);
  (bad[log.at] as { choice: unknown }).choice = 0;

  const an = analyze(fileOf(bad, log.seed));
  assert.ok(an.divergedAt, 'the replay is reported as DIVERGED, not merely short');
  assert.equal(an.divergedAt!.i, log.at,
    'and the divergence point is the corrupted action itself — the FIRST refusal, '
    + 'not the last, not a count of all of them');
  assert.equal(an.divergedAt!.type, 'decide');
  assert.ok(an.refusals.length > 1,
    'there IS a pile of later refusals — this is the shape that got misread');

  const text = reportLines('fixture.json', fileOf(bad, log.seed), an).lines.join('\n');
  assert.match(text, new RegExp(`DIVERGENCE at action \\[${log.at}\\]`),
    'the report says the index in so many words');
  assert.match(text, /ordering expects an array of \d+ indices/,
    'and the engine\'s own reason for refusing it');
  assert.match(text, /ONLY REFUSAL IN THIS FILE THAT IS EVIDENCE ON ITS OWN/,
    'and states that the other refusals are not findings');
});

test('R169/CT-45: the report says the remainder is CASCADE, and proves the wedge rather than guessing it', () => {
  const log = orderingLog();
  const bad = structuredClone(log.actions);
  (bad[log.at] as { choice: unknown }).choice = 0;
  const raw = fileOf(bad, log.seed);
  const an = analyze(raw);

  assert.ok(an.cascade.length > 0, 'the cascade run is measured, not asserted');
  assert.equal(an.cascade[0]!.i, log.at + 1, 'it starts at the very next action');
  // the cascade test is structural: every one of these stands under the
  // byte-identical decision that was standing at the divergence, so nothing
  // answered it in between and none of them is a second finding
  for (const c of an.cascade) {
    assert.equal(c.pending, an.divergedAt!.pending,
      `[${c.i}] was refused under the SAME unanswered question as [${log.at}]`);
  }
  assert.ok(an.wedged,
    'and it runs to the end of the log: from the divergence on, NOTHING either '
    + 'seat logged was ever legal again — a total replay loss, not a 4% one');
  assert.equal(an.refusals.length, an.cascade.length + 1,
    'so every single refusal in the file is that one action or its cascade');

  const text = reportLines('fixture.json', raw, an).lines.join('\n');
  assert.match(text, /CASCADE/, 'the word is in the report');
  assert.match(text, /WEDGED/, 'and so is the wedge');
  assert.match(text, new RegExp(`ONE failure, not ${an.cascade.length}`),
    'stated as one failure and its count, so a reader cannot re-derive N findings');
  assert.match(text, /TOTAL loss of the log/, 'and named as total, not partial');
  // the headline itself: a bare skip count is what invited the misreading, so
  // the very first mention of the numbers carries the divergence with it
  const headline = reportLines('fixture.json', raw, an).lines.find(l => l.includes('actions logged'))!;
  assert.match(headline, /refused/);
  assert.ok(!/skipped/.test(text),
    'the word "skipped" is gone entirely — it is what made 14 cascades read as 14 hiccups');
});

test('R169/CT-45 (negative control): the same log UNCORRUPTED replays clean and is reported FAITHFUL', () => {
  const log = orderingLog();
  const raw = fileOf(log.actions, log.seed);
  const an = analyze(raw);
  assert.equal(an.refusals.length, 0, 'a fuzz log replays perfectly by construction');
  assert.equal(an.divergedAt, null, 'so there is no divergence to name');
  assert.equal(an.cascade.length, 0);
  assert.equal(an.wedged, false);
  const r = reportLines('fixture.json', raw, an);
  assert.match(r.lines.join('\n'), /✓ FAITHFUL/);
  assert.equal(r.exit, 0, 'and it exits 0 — the divergence machinery invents nothing');
});

/* ═══ §2 THE ENGINE'S HALF — refuse, never coerce ════════════════════ */

test('R169: a scalar answer to an orderTriggers question is refused as UNANSWERABLE, not coerced into an ordering', () => {
  const log = orderingLog();
  const s = stateBefore(log);
  const dec = s.decision!;
  assert.equal(dec.kind, 'orderTriggers');
  assert.equal(dec.pickOrder, true);
  assert.ok(dec.options.length >= 2,
    'the engine only ever asks this with ≥2 distinguishable triggers — which is '
    + 'exactly why no scalar can ever be a legacy encoding of the answer');

  const err = refuse(s, { type: 'decide', seat: dec.seat, choice: 0 as unknown as number[] });
  assert.equal(err.unanswerable, true,
    'flagged `unanswerable`: not "wrong now" but "no reply of this shape can ever '
    + 'be accepted", which is what lets a replay name it as the whole finding');
  assert.match(err.message, /ordering expects an array of 2 indices, got 0/,
    'and it says what it wanted and what it got, so the log can be diagnosed '
    + 'without a debugger');
  assert.match(err.message, /permutation/);

  // the ordering was NOT invented for the player
  assert.deepEqual(s.decision, dec, 'the question is untouched and still standing');
  assert.equal(s.triggerOrderedSeats.includes(dec.seat), false,
    'and the seat is not recorded as having ordered anything');
});

test('R169: an ordering answer of the WRONG LENGTH is unanswerable too — that is queue drift, not a typo', () => {
  const log = orderingLog();
  const s = stateBefore(log);
  const dec = s.decision!;
  const short = refuse(s, { type: 'decide', seat: dec.seat, choice: [0] });
  assert.equal(short.unanswerable, true);
  assert.match(short.message, /not the ones this answer was written for/,
    'the message names the real cause: the batch of triggers moved under the question');
  const long = refuse(s, {
    type: 'decide', seat: dec.seat, choice: [...dec.options.map((_o, i) => i), 0],
  });
  assert.equal(long.unanswerable, true, 'a too-LONG answer is the same failure');
});

test('R169: a right-length ordering answer with junk indices is an ordinary retryable refusal, NOT unanswerable', () => {
  const log = orderingLog();
  const s = stateBefore(log);
  const dec = s.decision!;
  const n = dec.options.length;
  const dup = refuse(s, { type: 'decide', seat: dec.seat, choice: Array<number>(n).fill(0) });
  assert.equal(dup.unanswerable, undefined,
    'a live caller simply clicks again and gets it right — flagging THIS would '
    + 'teach the replay tool to declare a divergence over a bad click');
  assert.match(dup.message, /bad ordering/);

  // and the question really is still answerable, which is the property the
  // whole distinction rests on
  const good = apply(s, { type: 'decide', seat: dec.seat, choice: [n - 1, ...Array.from({ length: n - 1 }, (_x, i) => i)] });
  assert.ok(good.state.triggerOrderedSeats.includes(dec.seat),
    'a well-formed permutation is accepted from the very same board');
});

/* ═══ §3 CT-47 — the contract, and its ONE named exception ═══════════ */

const HALTS = 'R169 CT47 Halt';
registerSynthetic({
  name: HALTS, cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Gain 1 life, then ask.',
}, {
  spellEffect: {
    run: (g, ctx) => {
      g.gainLife(ctx.controller, 1, HALTS);
      ctx.choose('halt', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: `${HALTS}: carry on?`, options: [{ label: 'yes', value: 0 }],
      });
    },
  },
});

/** deployment open, with `n` Wraiths on `seat` whose start-of-deployment pile
 * leaves that seat holding an open question the other seat may act around */
function withWraiths(seat: Seat, n: number): Harness {
  const h = new Harness(424242);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) {
    if (h.state.hasteDone && !h.state.hasteDone[s]) h.do({ type: 'doneHaste', seat: s });
  }
  for (let i = 0; i < n; i++) spawn(h, seat, 'Wraith');
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') {
    h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  }
  return h;
}

test('R169/CT-47: legalActions offers an action apply() refuses — the ONE exception its contract now names', () => {
  const h = withWraiths(1, 3);
  assert.equal(h.state.decision!.seat, 1, 'seat 1 holds the open question');

  give(h, 0, HALTS);
  const mine: Action = { type: 'playCard', seat: 0, handIndex: h.state.players[0]!.hand.length - 1 };
  assert.ok(legalActions(h.state, 0).some(
    a => a.type === 'playCard' && a.handIndex === mine.handIndex,
  ), 'legalActions OFFERS it — the crack is real, not hypothetical: whether a '
   + 'play suspends depends on the card and the board, so no menu can predict it');

  const err = refuse(h.state, mine);
  assert.equal(err.disturbs, true,
    'apply() refuses it and flags `disturbs` — the exception is recognisable by '
    + 'FLAG, so no caller has to match on a message');
  assert.ok(isContractException(h.state, mine, err),
    'and the fuzzer names it as the documented exception instead of reporting '
    + '"legalActions lied"');
});

test('R169/CT-47: the fuzzer refuses to widen that exception past what R154 actually promises', () => {
  const h = withWraiths(1, 3);
  const mine: Action = { type: 'playCard', seat: 0, handIndex: 0 };

  // an ORDINARY illegal action is still a lie, flag or no flag
  assert.equal(isContractException(h.state, mine, new IllegalAction('you do not have priority')), false,
    'an unflagged refusal is still "legalActions lied" and still stops the fuzz');
  assert.equal(isContractException(h.state, mine, new Error('boom')), false,
    'and so is a crash');

  // a `disturbs` flag on the ASKING seat's own action is not the R154 case at
  // all: that seat is blocked by its own question, and swallowing it would hide
  // a real freeze
  const own = new IllegalAction('mislabelled'); own.disturbs = true;
  assert.throws(() => isContractException(h.state, { type: 'passPriority', seat: 1 }, own),
    /ASKING seat's own action/,
    'the exception is CHECKED against the standing question, never assumed');

  // and with no question standing there is nothing to disturb
  const clean = new Harness(424242);
  assert.equal(clean.state.decision, null);
  const stray = new IllegalAction('mislabelled'); stray.disturbs = true;
  assert.throws(() => isContractException(clean.state, { type: 'donePlanning', seat: 0 }, stray),
    /NO decision standing/);
});

test('R169/CT-47: the fuzzer counts the exception rather than swallowing it, so its use stays visible', () => {
  // The count is the guard against the failure mode CT-47 warns about — a
  // fuzzer that tolerates a whole class of refusal silently is one that will
  // hide the next real one. MEASURED, not assumed: as of R169 random play
  // reaches this window only rarely and disturbs nothing in it, so the honest
  // assertion is that the counter exists and reads zero, not that it fires.
  const r = fuzzGame(13, 2500);
  assert.equal(typeof r.disturbed, 'number',
    'every fuzz game reports how often the exception fired');
  assert.equal(r.disturbed, 0,
    'and today it never does — random play barely enters R154\'s window. If this '
    + 'ever goes red the exception has started firing for real, and that is worth '
    + 'a look rather than a silent tolerance');
});
