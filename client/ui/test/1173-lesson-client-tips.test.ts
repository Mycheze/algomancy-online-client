/* BL-11 — Learn to Play teaches the CLIENT's own controls, in play.
 *
 * The owner's UI-tutorial checklist (BL-11, 2026-08-25): "planning, priority
 * passing, yielding, modding, using the bin, multiple targets, complicated
 * graft effects, attacks/counter attacks, bringing along spell tokens". The
 * Learn to Play game already teaches the ideas; these are the short tips
 * (ui/lessons.ts CLIENT_TIPS) that point at the control the moment it is
 * first usable.
 *
 *   §1 every control a tip lights up is one the client really draws, and
 *      every control it names is the one the interface guide names
 *   §2 played for real: each tip opens at its own moment, never before the
 *      lesson that explains the idea, and the core lessons keep their order
 *   §3 a tip is a nudge: compact, optional, and not in the lesson menu
 *
 * Seeds 117300-117399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../../engine/src/index.ts';
import type { Action, GameState } from '../../engine/src/types.ts';
import { fallbackMove, tutorialBotV1 } from '../bot.ts';
import { SoloServer } from '../solo.ts';
import { newDeal } from '../learn.ts';
import { dueLesson, pageBody, type LessonCtx } from '../lessonflow.ts';
import { ALL_LESSONS, CLIENT_TIPS, GAME_LESSONS } from '../lessons.ts';
import { TUTORIAL } from '../tutorial.ts';
import { LEARN_ELEMENTS } from '../lessondeck.ts';

const MAIN = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');

/** the learner of 305: makes resources, plays what it can, blocks and attacks with everything */
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

interface Fired { id: string; turn: number; ctx: LessonCtx }

/** one tutorial game, opening each lesson the moment it is due */
function play(el: typeof LEARN_ELEMENTS[number], seed: number): Fired[] {
  const server = new SoloServer(newDeal(el, seed), tutorialBotV1());
  const msgs: { t: string; view?: GameState; legal?: Action[] }[] = [];
  const sock = server.socket();
  sock.deliver = m => { msgs.push(JSON.parse(JSON.stringify(m)) as typeof msgs[number]); };
  server.receive(JSON.stringify({ t: 'join' }));
  const seen: string[] = [];
  const fired: Fired[] = [];
  for (let i = 0; i < 3000 && server.state.phase !== 'gameover'; i++) {
    const last = [...msgs].reverse().find(m => m.legal)!;
    const ctx: LessonCtx = { state: last.view!, legal: last.legal!, seat: 0 };
    for (let l = dueLesson(GAME_LESSONS, { seen }, ctx); l; l = dueLesson(GAME_LESSONS, { seen }, ctx)) {
      seen.push(l.id);
      fired.push({ id: l.id, turn: ctx.state.turn, ctx });
    }
    const a = learner(last.view!, last.legal!);
    assert.ok(a, `the learner has a move on turn ${server.state.turn}`);
    const n = msgs.length;
    server.act(a!);
    if (msgs.slice(n).some(m => m.t === 'error')) server.act(fallbackMove(last.legal!)!);
  }
  return fired;
}

test('§1 every control a tip lights up is drawn by the client', () => {
  for (const t of CLIENT_TIPS) {
    for (const p of t.pages) {
      assert.ok(p.highlight?.length, `${t.id}: points at something on the board`);
      for (const sel of p.highlight!) {
        const attr = /^\[(data-(?:btn|act))="([\w-]+)"\]$/.exec(sel);
        const cls = /^\.([\w-]+)$/.exec(sel);
        assert.ok(attr || cls, `${t.id}: ${sel} is a data-btn, a data-act or a class`);
        if (attr) assert.ok(MAIN.includes(`${attr[1]}="${attr[2]}"`), `${t.id}: ui/main.ts draws ${sel}`);
        if (cls) assert.match(MAIN, new RegExp(`class="[^"]*\\b${cls[1]}\\b`), `${t.id}: ui/main.ts draws ${sel}`);
      }
    }
  }
});

test('§1 every control a tip names in bold is named the same way in the interface guide', () => {
  const guide = TUTORIAL.flatMap(s => s.steps.map(st => `${st.label ?? ''} ${st.text}`)).join('\n').toLowerCase();
  for (const t of CLIENT_TIPS) {
    for (const p of t.pages) {
      const body = pageBody(p, null);
      for (const m of body.matchAll(/\*\*([^*]+)\*\*/g)) {
        const name = m[1]!.replace(/^✕\s*/, '').trim().toLowerCase();
        if (['counterattack', 'one at a time'].includes(name)) continue;   // the idea, not a control
        assert.ok(guide.includes(name), `${t.id}: "${m[1]}" is what the interface guide calls it`);
      }
      assert.doesNotMatch(body, /\bCR\s*\d|\bR\d{2,3}\b|\bBL-\d/, `${t.id}: no rule or ticket numbers in player text`);
    }
  }
});

test('§2 played for real: each tip opens at its moment, after the lesson behind it', () => {
  const at = new Map<string, number>();
  for (const [i, el] of LEARN_ELEMENTS.entries()) {
    for (const seed of [117300 + i, 117310 + i]) {
      const fired = play(el, seed);
      const order = fired.map(f => f.id);
      assert.deepEqual(order.slice(0, 3), ['welcome', 'planning', 'deploy'], `${el}/${seed}: the first three lessons still come first (${order})`);
      const idx = (id: string) => order.indexOf(id);
      for (const f of fired) {
        if (!f.id.startsWith('tip-')) continue;
        at.set(f.id, (at.get(f.id) ?? 0) + 1);
        const s = f.ctx.state;
        const why = `${el}/${seed}: ${f.id} on turn ${f.turn} (${order})`;
        switch (f.id) {
          case 'tip-undo':
            assert.equal(s.phase, 'deploy', why);
            assert.ok(f.turn >= 2, why);
            assert.ok(idx('deploy') < idx(f.id), why);
            break;
          case 'tip-block':
            assert.ok(f.ctx.legal.some(a => a.type === 'declareBlocks') && s.battle?.round === 1, why);
            break;
          case 'tip-targets':
            assert.equal(s.decision?.kind, 'targets', why);
            assert.equal(s.decision?.seat, 0, why);
            break;
          case 'tip-ride':
            assert.ok(f.ctx.legal.some(a => a.type === 'declareAttack'), why);
            break;
          case 'tip-pass':
            assert.ok(s.phase === 'battle' && s.stack.length > 0 && f.ctx.legal.some(a => a.type === 'passPriority'), why);
            if (idx('battle-spells') >= 0) assert.ok(idx('battle-spells') < idx(f.id), `${why}: after the stack lesson when there was one`);
            break;
          default: assert.fail(`${f.id}: an unknown tip`);
        }
        if (f.id !== 'tip-undo') assert.ok(idx('combat') >= 0 && idx('combat') < idx(f.id), `${why}: after the combat lesson`);
      }
    }
  }
  // the moments every tutorial game reaches: deploying again, being attacked,
  // a target to pick, something on the stack (2026-11-07: all ten games reached
  // all four, and three of ten had a spell token to bring along)
  for (const id of ['tip-undo', 'tip-block', 'tip-targets', 'tip-pass']) {
    assert.equal(at.get(id) ?? 0, LEARN_ELEMENTS.length * 2, `${id} opened in every game`);
  }
  assert.ok((at.get('tip-ride') ?? 0) > 0, 'some game had a spell token to bring, and the tip opened there');
});

test('§3 a tip is a nudge: compact, optional, and not in the lesson menu', () => {
  const game = GAME_LESSONS.map(l => l.id);
  for (const t of CLIENT_TIPS) {
    assert.ok(t.compact && t.optional, `${t.id}: a compact, optional nudge`);
    assert.ok(game.includes(t.id), `${t.id}: in the game's lesson order`);
    assert.ok(!ALL_LESSONS.some(l => l.id === t.id), `${t.id}: not a menu lesson`);
    assert.equal(t.n, '', `${t.id}: not numbered as a lesson`);
  }
});
