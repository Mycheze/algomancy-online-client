/* THE RULES QUESTION BOARD — the library (ui/questions.ts) and the walk.
 *
 * A question is posted beside a link, and the link shows a board. Two things
 * can make that board lie, and this file is the guard against each:
 *
 *   §1  a step the engine no longer accepts. A question is a staged board then
 *       REAL actions; one that a rules change refuses would show a board that
 *       cannot happen. Every question is dealt and walked here, every step
 *       through `apply`, and the moments it names must exist and be in order.
 *   §2  the staging is deterministic and starts from the staged board — the
 *       replay viewer's checkpoint 0 is the STAGED board, not a plain deal of
 *       the same seed (positive control: the plain deal differs).
 *   §3  the CAPTION. Each question says which reading this client plays today,
 *       and its moment notes describe the board. If a ruling changes (report
 *       #231's fix would be CT-313), those sentences go stale in public. So the
 *       facts they state are asserted against the engine at each moment, and a
 *       red here means: update the question's `client` line and notes.
 *   §4  the same, for the two smaller questions (targetless retargeting, and
 *       "you may … target").
 *   §5  every card a question lists is a real card, and every id is a safe,
 *       unique link.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GameState } from '../../engine/src/types.ts';
import { apply, createGame } from '../../engine/src/apply.ts';
import { E } from '../../engine/src/engine.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import { QUESTIONS, QUESTION_NAMES, QUESTION_SEED, questionById, stageQuestion, questionUrl } from '../questions.ts';
import { ReplayServer } from '../replayserver.ts';

/** the board after `n` of a question's actions */
function boardAt(id: string, n: number): GameState {
  const st = stageQuestion(questionById(id)!);
  let s = structuredClone(st.dealt.state);
  for (const a of st.file.actions.slice(0, n)) s = apply(s, a).state;
  return s;
}
/** the board at a named moment */
function at(id: string, label: string): { s: GameState; g: E } {
  const st = stageQuestion(questionById(id)!);
  const k = st.marks.find(m => m.label === label);
  assert.ok(k, `${id} has no moment '${label}'`);
  const s = boardAt(id, k.at);
  return { s, g: new E(structuredClone(s)) };
}
const byCard = (g: E, s: GameState, card: string) => {
  const ent = Object.values(s.entities).find(x => x.card === card && x.kind === 'unit');
  assert.ok(ent, `no ${card} on the board`);
  return g.entity(ent.id)!;
};

test('§1 every question deals, every step is legal, and its moments are in order', () => {
  assert.ok(QUESTIONS.length >= 3, `positive control: ${QUESTIONS.length} questions`);
  for (const q of QUESTIONS) {
    const st = stageQuestion(q);
    assert.ok(st.file.actions.length > 0, `${q.id}: no steps`);
    let s = structuredClone(st.dealt.state);
    st.file.actions.forEach((a, i) => {
      try { s = apply(s, a).state; } catch (err) {
        assert.fail(`${q.id}: step ${i} (${a.type}, seat ${a.seat}) was refused: ${(err as Error).message} — `
          + 'the question no longer describes a legal game; re-stage it');
      }
    });
    assert.ok(st.marks.length >= 2, `${q.id}: a question needs at least two moments to compare`);
    for (let i = 1; i < st.marks.length; i++) {
      assert.ok(st.marks[i]!.at > st.marks[i - 1]!.at, `${q.id}: moment '${st.marks[i]!.label}' is not after the one before it`);
    }
    assert.ok(st.marks.every(k => k.at <= st.file.actions.length && k.note.length > 0), `${q.id}: a moment past the end, or with no note`);
    assert.ok(st.marks.some(k => k.at === st.opens), `${q.id}: the page would open between moments`);
    assert.deepEqual(st.file.names, QUESTION_NAMES, `${q.id}: a question names nobody real`);
  }
});

test('§2 staging is deterministic, and the replay walk starts from the staged board', () => {
  for (const q of QUESTIONS) {
    const a = stageQuestion(q);
    const b = stageQuestion(q);
    assert.equal(JSON.stringify(a.dealt.state), JSON.stringify(b.dealt.state), `${q.id}: two stagings differ`);
    assert.deepEqual(a.file.actions, b.file.actions);
  }
  const st = stageQuestion(QUESTIONS[0]!);
  const plain = createGame(QUESTION_SEED, QUESTION_NAMES, 'shared').state;
  assert.notEqual(JSON.stringify(plain.entities), JSON.stringify(st.dealt.state.entities),
    'positive control: a plain deal of the same seed is a different board');
  const rs = new ReplayServer(st.file, 0, true, st.dealt);
  const view = (): string => JSON.stringify(rs.view());
  rs.seek(0);
  const start = view();
  assert.match(start, /Transmogrifant/, 'checkpoint 0 is not the staged board');
  rs.seek(st.file.actions.length);
  const end = view();
  rs.seek(0);
  assert.equal(view(), start, 'rewinding to 0 did not come back to the staged board');
  rs.seek(st.file.actions.length);
  assert.equal(view(), end, 'walking forward again reached a different end');
  assert.equal(rs.refused, null, 'the in-page walk refused a step');
  assert.equal(JSON.stringify(st.dealt.state), JSON.stringify(stageQuestion(QUESTIONS[0]!).dealt.state),
    'the viewer mutated the staged board it was handed');
});

test('§3 report #231: the board says what the caption says, at every moment', () => {
  const id = 'transmogrifant-control-change';
  const q = questionById(id)!;
  assert.match(q.client, /keeps the Piercing/, 'positive control: the caption claim this section checks');

  // Before the switch: A's units have Piercing and are not under Transmogrifant;
  // B's Restitution is, so it has no abilities
  {
    const { s, g } = at(id, 'Before the switch');
    const robot = byCard(g, s, 'Robot');
    assert.equal(robot.controller, 0);
    assert.ok(g.effAttrs(robot).has('Piercing'), 'before the switch the Robot must have Piercing');
    assert.equal(g.suppressionOf(robot).attrs, false);
    assert.deepEqual(g.suppressionOf(byCard(g, s, 'Restitution')).by, ['Transmogrifant'],
      'before the switch Restitution must be under Transmogrifant (its own controller\'s)');
  }
  // After the switch: Transmogrifant covers A's units now. Bubb's PRINTED
  // Unaware is gone; the later Piercing is KEPT — the reading this client plays
  {
    const { s, g } = at(id, 'After the switch');
    assert.equal(byCard(g, s, 'The Bonesculptor').controller, 0, 'Rebalance did not give Player A The Bonesculptor');
    const robot = byCard(g, s, 'Robot');
    const bubb = byCard(g, s, 'Bubb');
    assert.deepEqual(g.suppressionOf(robot).by, ['Transmogrifant'], 'Transmogrifant does not cover Player A\'s Robot after the switch');
    assert.ok(!g.effAttrs(bubb).has('Unaware'), 'the note says Bubb has lost its printed Unaware');
    assert.ok(g.effAttrs(robot).has('Piercing') && g.effAttrs(bubb).has('Piercing'),
      'THE CAPTION IS STALE: this client no longer keeps the Piercing. Update the question\'s `client` line '
      + 'and its "After the switch" and "Combat damage" notes (ui/questions.ts) — they are public');
    assert.equal(g.suppressionOf(byCard(g, s, 'Restitution')).abilities, false, 'Restitution should have its ability back');
  }
  // Combat damage: Restitution is dealt 4, the other 30 pierces, Player A wins
  {
    const { s, g } = at(id, 'Combat damage');
    assert.equal(byCard(g, s, 'Restitution').damage, 4, 'the note says Restitution is dealt 4');
    assert.equal(s.players[1]!.life, 17 - 9 - 30, 'Bubb\'s 9 unblocked and the Robot\'s 30 pierced');
    assert.equal(s.players[0]!.life, 9);
    assert.equal(s.winner, 0);
  }
});

test('§4 the targetless retarget and the "you may … target" boards say what their captions say', () => {
  {
    const id = 'retarget-a-targetless-effect';
    assert.match(questionById(id)!.client, /lets Gravitational Correction be cast/);
    const { s } = at(id, 'The trigger');
    assert.equal(s.stack.length, 1);
    assert.equal(s.stack[0]!.card, 'Surly Stalker');
    assert.ok(s.stack[0]!.parts!.every(p => (p.targets ?? []).length === 0), 'the trigger is supposed to have no targets');
    const cast = at(id, 'Cast at it').s;
    const top = cast.stack[cast.stack.length - 1]!;
    assert.equal(top.card, 'Gravitational Correction', 'THE CAPTION IS STALE: the client no longer lets it be cast at the trigger');
    assert.match(JSON.stringify(top.parts), new RegExp(`"stack":${s.stack[0]!.id}\\b`), 'it does not target the trigger');
  }
  {
    const id = 'may-trigger-target-first';
    assert.match(questionById(id)!.client, /target first/);
    const ask = at(id, 'The trigger').s.decision;
    assert.equal(ask?.kind, 'targets', 'the trigger is supposed to ask for its target first');
    assert.ok(ask!.options.every(o => typeof o.value === 'object'),
      'THE CAPTION IS STALE: the target step now offers a way to decline');
    const res = at(id, 'On resolution').s.decision;
    assert.equal(res?.kind, 'payOrDecline');
    assert.ok(res!.options.some(o => o.value === false), 'the "may" is supposed to be asked on resolution');
  }
});

test('§5 every listed card is real, and every id is a unique, safe link', () => {
  const ids = new Set<string>();
  for (const q of QUESTIONS) {
    assert.match(q.id, /^[a-z0-9-]+$/, `${q.id}: a link id is lower-case words and dashes`);
    assert.ok(!ids.has(q.id), `${q.id}: two questions share an id, and the later one would never open`);
    ids.add(q.id);
    for (const c of q.cards) assert.doesNotThrow(() => getCard(c), `${q.id}: ${c} is not a card`);
    assert.ok(q.readings.length >= 2, `${q.id}: a question states at least two readings`);
    assert.equal(questionUrl('https://algomancy.online', q.id), `https://algomancy.online/?question=${q.id}`);
  }
  assert.equal(questionById('no-such-question'), undefined);
});
