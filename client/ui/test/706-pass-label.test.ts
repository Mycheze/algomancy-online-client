/* 706 — THE MAIN BUTTON SAYS WHAT IT DOES (board round 8, plan §P6).
 *
 * The prompt bar's primary button used to read "Pass (space)" in every battle
 * window, with a dim "(both pass: move to …)" beside it that was wrong twice:
 * it had no damage-window case at all ("the next step"), and on round 1's
 * after-combat window it always promised "round 2 (the counterattack)" even
 * when nobody had been sent — when the battle phase in fact ends there (the
 * same test ui/passrelease.ts passEndsBattlePhase makes).
 *
 * The owner's choice: the button names the destination, and on the FIRST of a
 * window's two passes a small second line says "‹opponent› can reply".
 *
 * §1  passLabel, table-driven over fixture states — every row of the plan
 * §2  the window's stack, as the engine reads it (CR 703.7 solo-region items)
 * §3  the two regressions of the old hint, through the rendered bar — and
 *     the hint itself is gone (board round 8, P4: it repeated the button)
 * §4  the bar: the button carries the label, the key hint and the note; the
 *     data-btn names do not move
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import type { GameState, Seat, StackItem } from '../../engine/src/types.ts';
import { pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { passLabel, passOutcome } from '../nextstep.ts';
import { client } from './ui-driver.ts';

const ui = await client();

/* ── fixtures ──────────────────────────────────────────────────────── */

type Battle = NonNullable<GameState['battle']>;
type Over = Omit<Partial<GameState>, 'battle'> & { battle?: Partial<Battle> | null };

/** a bare state with only what passLabel reads; region 0 has both players present */
function st(o: Over): GameState {
  const phase = o.phase ?? 'battle';
  const want = o.battle === undefined ? (phase === 'battle' ? {} : null) : o.battle;
  const battle = want === null ? null : {
    round: 1, attacker: 0, defender: 1, region: 1, step: 'attackWindow',
    columns: [], blocks: {}, sentAttackers: [], attackerPool: null, happened: true,
    ...want,
  } as Battle;
  return {
    phase: 'battle', battleRound: 1, passes: 0, priority: 0, stack: [],
    planningDone: [false, false], hasteDone: null, deployDone: null,
    players: [{ name: 'Ana' }, { name: 'Bo' }],
    regions: [{ owner: 0, presentSeats: [0] }, { owner: 1, presentSeats: [1, 0] }],
    ...o,
    battle,
  } as unknown as GameState;
}

const item = (card: string, region = 1): StackItem =>
  ({ id: 1, kind: 'spell', card, label: card, controller: 0, region, negated: false, parts: [] }) as unknown as StackItem;

/* ── §1 the table ──────────────────────────────────────────────────── */

const ROWS: { name: string; s: GameState; seat: Seat; text: string; note?: string }[] = [
  { name: 'planning', s: st({ phase: 'planning' }), seat: 0, text: 'Done Planning' },
  { name: 'haste step', s: st({ phase: 'planning', hasteDone: [false, false] }), seat: 0, text: 'To Battle' },
  { name: 'attackWindow, first pass', s: st({ battle: { step: 'attackWindow' } }), seat: 0, text: 'To Blockers', note: 'Bo can reply' },
  { name: 'attackWindow, second pass', s: st({ passes: 1, priority: 1, battle: { step: 'attackWindow' } }), seat: 1, text: 'To Blockers' },
  { name: 'blockWindow', s: st({ battle: { step: 'blockWindow' } }), seat: 0, text: 'To Damage', note: 'Bo can reply' },
  { name: 'blockWindow, seat 1 first', s: st({ priority: 1, battle: { step: 'blockWindow' } }), seat: 1, text: 'To Damage', note: 'Ana can reply' },
  { name: 'damageWindow before normal', s: st({ battle: { step: 'damageWindow', pendingSub: 'normal' } }), seat: 0, text: 'To normal damage', note: 'Bo can reply' },
  { name: 'damageWindow before Sluggish', s: st({ battle: { step: 'damageWindow', pendingSub: 'Sluggish' } }), seat: 0, text: 'To Sluggish damage', note: 'Bo can reply' },
  // engine advanceBattleStep: `b.pendingSub ?? 'after'`
  { name: 'damageWindow, no pending sub', s: st({ battle: { step: 'damageWindow', pendingSub: null } }), seat: 0, text: 'To After Combat', note: 'Bo can reply' },
  { name: 'afterWindow r1, counterattackers sent', s: st({ battle: { step: 'afterWindow', sentAttackers: [7] } }), seat: 0, text: 'To Counterattack', note: 'Bo can reply' },
  { name: 'afterWindow r1, none sent', s: st({ battle: { step: 'afterWindow', sentAttackers: [] } }), seat: 0, text: 'End Battle', note: 'Bo can reply' },
  { name: 'afterWindow r2', s: st({ battleRound: 2, battle: { round: 2, step: 'afterWindow', attacker: 1, defender: 0 } }), seat: 0, text: 'End Battle', note: 'Bo can reply' },
  { name: 'stack, first pass', s: st({ stack: [item('Jelly')], battle: { step: 'blockWindow' } }), seat: 0, text: 'Resolve Jelly', note: 'Bo can reply' },
  { name: 'stack, second pass', s: st({ passes: 1, priority: 1, stack: [item('Jelly')] }), seat: 1, text: 'Resolve Jelly' },
  { name: 'deploy, opponent not done', s: st({ phase: 'deploy', deployDone: [false, false] }), seat: 0, text: 'Done Deploying' },
  { name: 'deploy, opponent done', s: st({ phase: 'deploy', deployDone: [false, true] }), seat: 0, text: 'End Turn' },
  { name: 'deploy, seat 1, opponent done', s: st({ phase: 'deploy', deployDone: [true, false] }), seat: 1, text: 'End Turn' },
  { name: 'blocks step', s: st({ priority: null, battle: { step: 'blocks' } }), seat: 1, text: 'Confirm Blocks' },
];

for (const r of ROWS) {
  test(`§1 ${r.name} → "${r.text}"${r.note ? ` / "${r.note}"` : ''}`, () => {
    const got = passLabel(r.s, r.seat);
    assert.equal(got.text, r.text);
    assert.equal(got.note, r.note, r.note ? 'the first of two passes says the opponent can reply' : 'no note here');
  });
}

/* ── §2 the window's stack ─────────────────────────────────────────── */

test('§2 a solo-region item is not in the window (CR 703.7): the step label stands', () => {
  // region 0 has only Ana present — engine soloStacked
  const s = st({ stack: [item('Lonely', 0)], battle: { step: 'attackWindow' } });
  assert.equal(passOutcome(s).kind, 'blocks');
  assert.equal(passLabel(s, 0).text, 'To Blockers');
});

test('§2 under a solo-region top, the windowed item is the one named', () => {
  const s = st({ stack: [item('Jelly', 1), item('Lonely', 0)], battle: { step: 'attackWindow' } });
  assert.equal(passLabel(s, 0).text, 'Resolve Jelly');
});

test('§2 a triggered item with no card is named by its label', () => {
  const it = { ...item('x'), card: undefined, label: 'After combat' } as unknown as StackItem;
  assert.equal(passLabel(st({ stack: [it] }), 0).text, 'Resolve After combat');
});

/* ── §3 + §4 the rendered bar ──────────────────────────────────────── */

/** the main pass button's markup in `html` */
function passBtn(html: string): string {
  const m = html.match(/<button class="primary" data-btn="pass">([\s\S]*?)<\/button>/);
  assert.ok(m, 'the bar offers the pass button');
  return m[1]!;
}
/** P4 took the dim "(both pass: …)" hint out of the bar: the button says it */
const noHint = (html: string): void => assert.doesNotMatch(html, /both pass:/, 'the bar repeats the button no more');

/** round 1's attack window, A attacking with one unit */
function attackWindow(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const u = spawn(h, A, 'The Foretold');
  spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[u]] });
  for (let g = 0; g < 20 && h.state.stack.length; g++) pass(h);
  assert.equal(h.state.battle!.step, 'attackWindow', 'premise: the attack window');
  assert.equal(h.state.passes, 0, 'premise: nobody has passed yet');
  return { h, A, D };
}

/** show `s` to the priority holder */
function show(s: GameState): string {
  const seat = s.priority!;
  return ui.join(s, seat, legalActions(s, seat));
}

test('§4 the attack window: "To Blockers", the space hint, and the opponent can reply', () => {
  const { h, A, D } = attackWindow(70601);
  const html = show(h.state);
  const btn = passBtn(html);
  assert.match(btn, /^To Blockers <span class="kh">\(space\)<\/span>/, btn);
  assert.ok(btn.includes(`<span class="btnnote">${h.state.players[D]!.name} can reply</span>`), btn);
  assert.equal(h.state.priority, A, 'the attacker holds priority first');
  assert.doesNotMatch(html, />Pass <span class="kh">/, 'the old label is gone');
});

test('§4 the second pass has no note — it goes straight there', () => {
  const { h } = attackWindow(70602);
  pass(h);
  assert.equal(h.state.passes, 1);
  const btn = passBtn(show(h.state));
  assert.match(btn, /^To Blockers/);
  assert.doesNotMatch(btn, /btnnote/);
});

test('§3 regression: a damage window names the next sub-step (the old hint said "the next step")', () => {
  const { h } = attackWindow(70603);
  const s = structuredClone(h.state);
  s.battle!.step = 'damageWindow';
  s.battle!.pendingSub = 'Sluggish';
  const html = show(s);
  assert.match(passBtn(html), /^To Sluggish damage/);
  noHint(html);
});

test('§3 regression: round 1 after combat with nobody sent ends the battle (the old hint said "round 2")', () => {
  const { h } = attackWindow(70604);
  const s = structuredClone(h.state);
  s.battle!.step = 'afterWindow';
  s.battle!.sentAttackers = [];
  assert.equal(s.battleRound, 1);
  const html = show(s);
  assert.match(passBtn(html), /^End Battle/);
  noHint(html);
  // …and with a counterattacker sent it really is the counterattack
  s.battle!.sentAttackers = [Object.values(s.entities).find(e => e.kind === 'unit' && e.controller === s.battle!.defender)!.id];
  const html2 = show(s);
  assert.match(passBtn(html2), /^To Counterattack/);
  noHint(html2);
});

test('§4 deployment: "Done Deploying", then "End Turn" once the opponent is done', () => {
  const h = new Harness(70605);
  toDeployment(h);
  const me = h.state.deployPlayer!;
  let html = ui.join(h.state, me, legalActions(h.state, me));
  assert.match(html, new RegExp(`data-btn="donedeploy" data-p="${me}"[^>]*>[^<]*: Done Deploying <span class="kh">\\(enter\\)</span></button>`));
  const s = structuredClone(h.state);
  s.deployDone = [true, true];
  s.deployDone[me] = false;
  html = ui.join(s, me, legalActions(s, me));
  assert.match(html, /data-btn="donedeploy"[^>]*>[^<]*: End Turn <span class="kh">\(enter\)<\/span><\/button>/);
});

test('§4 planning: "Done Planning" on the doneplan button', () => {
  const h = new Harness(70606);
  const html = ui.join(h.state, 0, legalActions(h.state, 0));
  assert.match(html, /data-btn="doneplan" data-p="0"[^>]*>[^<]*: Done Planning <span class="kh">\(enter\)<\/span><\/button>/);
});
