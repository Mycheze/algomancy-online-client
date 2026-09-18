/* R297 — Learn to Play: the decks and the lesson flow, played for real.
 *
 * Every claim here is read off a real tutorial game: a SoloServer running the
 * real tutorial deal, a scripted learner who plays sensibly, and the lessons
 * checked against exactly what the learner's client would hand them — the
 * redacted view and the learner's legal list from each push.
 *
 *   §1 each element's deck: 30 cards, all Simple, all one element, nothing
 *      untaught, and the stacked top as scheduled
 *   §2 the first four lessons open on turns 1-3, in order, in every element
 *   §3 a game reaches its end, and the end lesson opens there
 *   §4 no lesson opens before the one ahead of it unless it is optional
 *   §5 the static words: unique ids, every [[card]] resolves, every quote cited
 *
 * Seeds 30500-30599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/index.ts';
import type { Action, GameState } from '../../engine/src/types.ts';
import { rowFor } from '../cardindex.ts';
import { fallbackMove, tutorialBotV1 } from '../bot.ts';
import { SoloServer } from '../solo.ts';
import { newDeal } from '../learn.ts';
import { dueLesson, lessonContext, pageBody, type LessonCtx } from '../lessonflow.ts';
import { ALL_LESSONS, END, GAME_LESSONS, LESSONS } from '../lessons.ts';
import { buildLearnerDeck, DECK_SCHEDULE, LEARN_ELEMENTS, learnerPool } from '../lessondeck.ts';

/** a learner who makes resources, plays what they can, blocks with what they have */
function learner(s: GameState, legal: readonly Action[]): Action | undefined {
  const me = s.players[0]!;
  if (s.decision?.seat === 0) return legal.find(a => a.type === 'decide');
  const el = s.deckElements?.[0]?.[0] ?? 'fire';
  const count = (a: Action, k: 'blocks' | 'columns'): number =>
    k === 'blocks' ? Object.values((a as { blocks: Record<number, number[]> }).blocks).flat().length
      : (a as { columns: number[][] }).columns.flat().length;
  return legal.find(a => a.type === 'exchangePrismite' && a.element === el)
    ?? (me.resources.length < 6 && s.turn <= 4 && me.hand.length > 2
      ? legal.find(a => a.type === 'recycleForResource' && a.element === el) : undefined)
    ?? legal.find(a => a.type === 'activateResource')
    ?? legal.find(a => a.type === 'playCard' && !a.mode)
    ?? legal.find(a => a.type === 'augment' || a.type === 'graft')
    ?? legal.filter(a => a.type === 'declareBlocks').sort((a, b) => count(b, 'blocks') - count(a, 'blocks'))[0]
    ?? legal.filter(a => a.type === 'declareAttack').sort((a, b) => count(b, 'columns') - count(a, 'columns'))[0]
    ?? fallbackMove(legal);
}

interface Played { fired: { id: string; turn: number }[]; server: SoloServer }

/** play one tutorial game, opening each lesson the moment it is due */
function play(el: typeof LEARN_ELEMENTS[number], seed: number): Played {
  const server = new SoloServer(newDeal(el, seed), tutorialBotV1());
  const msgs: { t: string; view?: GameState; legal?: Action[] }[] = [];
  const sock = server.socket();
  sock.deliver = m => { msgs.push(JSON.parse(JSON.stringify(m)) as typeof msgs[number]); };
  server.receive(JSON.stringify({ t: 'join' }));
  const seen: string[] = [];
  const fired: Played['fired'] = [];
  const openDue = (ctx: LessonCtx): void => {
    for (let l = dueLesson(GAME_LESSONS, { seen }, ctx); l; l = dueLesson(GAME_LESSONS, { seen }, ctx)) {
      seen.push(l.id);
      fired.push({ id: l.id, turn: ctx.state.turn });
    }
  };
  for (let i = 0; i < 3000 && server.state.phase !== 'gameover'; i++) {
    const last = [...msgs].reverse().find(m => m.legal)!;
    openDue({ state: last.view!, legal: last.legal!, seat: 0 });
    const a = learner(last.view!, last.legal!);
    assert.ok(a, `the learner has a move on turn ${server.state.turn}`);
    const n = msgs.length;
    server.act(a!);
    if (msgs.slice(n).some(m => m.t === 'error')) server.act(fallbackMove(last.legal!)!);
  }
  const final = [...msgs].reverse().find(m => m.view)!;
  openDue({ state: final.view!, legal: [], seat: 0 });
  return { fired, server };
}

test('§1 each element\'s deck: 30 Simple cards of that element, nothing untaught, stacked as scheduled', () => {
  for (const el of LEARN_ELEMENTS) {
    const deck = buildLearnerDeck(el, 30500);
    assert.equal(deck.length, 30, `${el}: 30 cards`);
    const pool = new Set(learnerPool(el).map(r => r.name));
    for (const n of deck) {
      const r = rowFor(n)!;
      assert.ok(pool.has(n), `${el}: ${n} is from the learner's pool`);
      assert.equal(r.complexityLc, 'simple', `${el}: ${n} is Simple`);
      assert.deepEqual(r.factions, [el], `${el}: ${n} is mono-${el}`);
      assert.ok(!r.keywords.some(k => ['ambush', 'prophecy', 'unstable', 'debt', 'burst', 'discard me'].includes(k)), `${el}: ${n} teaches nothing untaught`);
    }
    const counts = new Map<string, number>();
    for (const n of deck) counts.set(n, (counts.get(n) ?? 0) + 1);
    assert.ok([...counts.values()].every(c => c <= 2), `${el}: at most two copies`);
    // the two-card opening hand holds a unit with an attribute (lesson 3b)
    assert.ok(deck.slice(0, 2).some(n => (rowFor(n)?.attrs.length ?? 0) > 0), `${el}: an attribute unit in the opening two`);
    assert.equal(DECK_SCHEDULE.reduce((s, t) => s + t.want.length, 0), 12, 'the schedule stacks two cards a turn for six turns');
    assert.deepEqual(buildLearnerDeck(el, 30500), deck, `${el}: the same seed builds the same deck`);
  }
});

test('§2 §3 in every element the core lessons open in order early, and the game ends with the end lesson', () => {
  for (const [i, el] of LEARN_ELEMENTS.entries()) {
    const { fired, server } = play(el, 30510 + i);
    const at = (id: string) => fired.find(f => f.id === id);
    const order = fired.map(f => f.id);
    assert.deepEqual(order.slice(0, 3), ['welcome', 'planning', 'deploy'], `${el}: 1, 2, 3 first (${order})`);
    assert.ok(fired.slice(0, 3).every(f => f.turn === 1), `${el}: all on turn 1`);
    assert.ok(at('combat') && at('combat')!.turn <= 3, `${el}: combat by turn 3 (${JSON.stringify(at('combat'))})`);
    assert.equal(server.state.phase, 'gameover', `${el}: the game ended (turn ${server.state.turn})`);
    assert.equal(order[order.length - 1], 'end', `${el}: the end lesson is the last to open`);
    assert.ok(server.state.turn >= 6, `${el}: the game lasted long enough to teach (${server.state.turn} turns)`);
    for (const [id, min] of [['battle-spells', 3], ['viruses', 3], ['augment', 4], ['graft', 5], ['haste', 5]] as const) {
      if (at(id)) assert.ok(at(id)!.turn >= min, `${el}: ${id} not before turn ${min}`);
    }
    assert.equal(at('planning-again')?.turn, 2, `${el}: the planning nudge comes on turn 2`);
    if (at('viruses')) assert.ok(order.indexOf('augment') >= 0 && order.indexOf('augment') < order.indexOf('viruses'), `${el}: viruses only after augmenting`);
    // the owner's bot, unsoftened: Metal and Earth may lose — but only after
    // the game has had time to reach the late lessons
    assert.ok(server.state.turn >= 7 || server.state.winner === 0, `${el}: the game lasts long enough to teach (turn ${server.state.turn}, winner ${server.state.winner})`);
  }
});

test('§4 a non-optional lesson holds back the ones after it', () => {
  const ctx = { state: { phase: 'battle', turn: 9, players: [{ hand: [], bin: [], resources: [] }, { hand: [], bin: [], resources: [] }], entities: {} } as unknown as GameState, legal: [{ type: 'declareBlocks', seat: 0, blocks: {} }] as Action[], seat: 0 as const };
  // nothing seen: welcome is always due first
  assert.equal(dueLesson(GAME_LESSONS, { seen: [] }, ctx)?.id, 'welcome');
  // welcome seen, planning not due in battle and not optional: combat waits
  assert.equal(dueLesson(GAME_LESSONS, { seen: ['welcome'] }, ctx), null);
  // once planning and deploy are seen, combat is due; attributes (optional) does not block it
  assert.equal(dueLesson(GAME_LESSONS, { seen: ['welcome', 'planning', 'deploy'] }, ctx)?.id, 'combat');
  // …and a learner with no units, who only ever passes in battle, still gets it
  assert.equal(dueLesson(GAME_LESSONS, { seen: ['welcome', 'planning', 'deploy'] }, { ...ctx, legal: [{ type: 'passPriority', seat: 0 }] })?.id, 'combat');
});

test('§4b the end of the game is never held back by a lesson the game did not reach', () => {
  const over = { state: { phase: 'gameover', turn: 6, winner: 1, players: [{ hand: [], bin: [], resources: [] }, { hand: [], bin: [], resources: [] }], entities: {} } as unknown as GameState, legal: [] as Action[], seat: 0 as const };
  assert.equal(dueLesson(GAME_LESSONS, { seen: ['welcome', 'planning'] }, over)?.id, 'end');
});

test('§5b every lesson page shows something, in every element', async () => {
  const { pageFigures } = await import('../lessonflow.ts');
  const { FORMATS } = await import('../lessons.ts');
  for (const el of LEARN_ELEMENTS) {
    const ctx = { state: { players: [{ hand: [], bin: [], resources: [] }, { hand: [], bin: [], resources: [] }], entities: {}, deckElements: [[el], []], phase: 'planning', turn: 1, winner: null } as unknown as GameState, legal: [] as Action[], seat: 0 as const };
    for (const l of [...LESSONS, FORMATS, END]) {
      if (l.compact) continue;   // a nudge points at the real board instead
      for (const p of l.pages) {
        const figs = pageFigures(p, ctx);
        assert.ok(figs.length > 0, `${el}: ${l.id} / ${p.title} has a picture`);
        for (const f of figs) if (f.kind === 'frames') assert.ok(f.frames.length > 1, `${el}: ${l.id} / ${p.title}: a sequence has steps`);
      }
    }
  }
});

test('§5 the words: unique ids, every [[card]] resolves, every quote is cited, context is capped', () => {
  const menu = ALL_LESSONS.map(l => l.id);
  assert.equal(new Set(menu).size, menu.length, 'menu lesson ids are unique');
  assert.ok(LESSONS.every(l => l.compact || menu.includes(l.id)) && !menu.includes(END.id), 'the menu lists every lesson, not the nudge or the end screen');
  assert.equal(new Set(GAME_LESSONS.map(l => l.id)).size, GAME_LESSONS.length, 'game lesson ids are unique');
  for (const l of [...GAME_LESSONS, ...ALL_LESSONS]) {
    for (const p of l.pages) {
      const body = pageBody(p, null);
      assert.ok(body.trim().length > 20, `${l.id} / ${p.title}: has words even with no game up`);
      for (const m of body.matchAll(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g)) {
        assert.ok(rowFor(m[1]!.trim()), `${l.id}: [[${m[1]}]] is a real card`);
      }
      for (const q of p.quotes ?? []) assert.match(q.source, /\S/, `${l.id}: every quote says where it is from`);
      assert.doesNotMatch(body, /\bR\d{2,3}\b/, `${l.id}: no ruling numbers in player-facing text`);
    }
    assert.ok(lessonContext(l, null).length <= 3000, `${l.id}: the judge context is capped`);
  }
});
