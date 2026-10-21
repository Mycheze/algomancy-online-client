/* CT-323 / CT-325 — A REWIND SAYS WHAT IT TAKES BACK, PICKS NOTHING FOR YOU,
 * AND NEVER TOUCHES OR COUNTS WHAT THE OTHER SEAT HAS NOT SEEN.
 *
 * The 2026-10-21 round brought 36 agreed rewinds. The options were bare
 * counts across BOTH seats ("take back the last 1 action") and the first was
 * preselected: in all 12 multi-step runs the point the player wanted was on
 * offer the first time, yet they stepped back one at a time (15 of 36 rows),
 * and in 9 runs "the last 1" took back only the opponent's reply. Inside a
 * hidden step the counts also cut the opponent's hidden actions (XSAP #247,
 * RTPE #255) and the proposal's "(10 logged actions)" told the other seat how
 * many hidden actions had been taken.
 *
 *   §1 every option names its cut — whose action, from the log itself — and
 *      "back to before your last action" is offered
 *   §2 inside a hidden step no option but the step's start (or the step
 *      before) cuts an action the asking seat has not seen, and nothing any
 *      seat is shown counts the log or names the other seat's hidden actions
 *   §3 the dialog preselects nothing, shows what each option takes back, and
 *      says Escape takes back a play still being aimed
 *
 * Seeds 52300-52399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness } from '../../engine/src/harness.ts';
import { forcedAction, hiddenSegment, legalActions, replay } from '../../engine/src/apply.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';
import { viewFor } from '../../server/view.ts';
import type { Room } from '../../server/rooms.ts';
import { give, giveResources, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { client } from './ui-driver.ts';

process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-523-'));
const R = await import('../../server/rooms.ts');

const NAMES: [string, string] = ['Ann', 'Bo'];
const other = (s: Seat): Seat => (s === 0 ? 1 : 0);
const live = (room: Room): void => { room.sockets = [{} as never, {} as never]; };

/** one tick of main.ts: apply, drain the forced steps, reopen a closed segment */
function tick(room: Room, a: Action): void {
  const was = room.segKey;
  R.applyToRoom(room, a);
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    R.applyToRoom(room, f);
  }
  if (R.segmentKey(room.state) !== was) R.openSegment(room);
}

/** a plain player (485's): enough to reach battle */
function greedy(room: Room, seat: Seat, recycled: Set<string>): Action | null {
  const legal = R.legalInRoom(room, seat);
  const key = `${room.state.turn}:${seat}`;
  const rec = legal.find(a => a.type === 'recycleForResource');
  if (rec && !recycled.has(key)) { recycled.add(key); return rec; }
  return legal.find(a => a.type === 'activateResource')
    ?? (room.state.phase === 'deploy' ? legal.find(a => a.type === 'playCard') : undefined)
    ?? legal.find(a => ['decide', 'donePlanning', 'doneHaste', 'declareBlocks', 'passPriority', 'doneDeploying'].includes(a.type))
    ?? legal.filter(a => a.type === 'declareAttack').at(-1) ?? null;
}

/** is log action `i` a forced step (the board owed it)? */
function forcedAt(room: Room, i: number): boolean {
  const s = replay(room.seed, room.actions.slice(0, i), [...NAMES], 'shared').state;
  const f = forcedAction(s);
  return f !== null && JSON.stringify(f) === JSON.stringify(room.actions[i]);
}

const COUNTED = /take back the last|\blogged\b|\b\d+ actions?\b/i;

/* ── §1 ─────────────────────────────────────────────────────────────── */

test('§1 every rewind option names whose action it goes back before, and your last action is offered', () => {
  const room = R.createRoom('N523', 52300, [...NAMES], 'shared');
  const recycled = new Set<string>();
  for (let i = 0; i < 400; i++) {
    const battle = room.state.phase === 'battle' && hiddenSegment(room.state) === null && !room.state.decision
      && room.state.priority !== null && room.actions.length > 40;
    if (battle) break;
    const a = greedy(room, 0, recycled) ?? greedy(room, 1, recycled);
    assert.ok(a, `the drive stuck at ${room.state.phase}`);
    tick(room, a!);
  }
  assert.equal(room.state.phase, 'battle', 'fixture: a public battle window');
  for (const P of [0, 1] as Seat[]) {
    const opts = R.rewindOptions(room, P);
    assert.ok(opts.length >= 2, `seat ${P} is offered rewinds`);
    for (const o of opts) {
      assert.doesNotMatch(`${o.label} ${o.takes ?? ''}`, COUNTED, `"${o.label}" names its cut, it does not count it`);
      assert.ok(o.takes, `"${o.label}" says what it takes back`);
      if (!o.label.startsWith('Back to before')) {
        assert.match(o.label, /^Back to the start of (this step|the step before) \(turn \d+, /, `"${o.label}" is a step start`);
        continue;
      }
      // whose action it is, read off the LOG — never off the label's own claim
      const cut = room.actions[o.to]!;
      assert.match(o.label, new RegExp(`^Back to before ${cut.seat === P ? 'your' : 'their'} `),
        `seat ${P}: "${o.label}" goes back before seat ${cut.seat}'s ${cut.type}`);
      assert.ok(o.takes!.startsWith(o.label.slice('Back to before '.length).replace(/ \(.*$/, '')),
        `seat ${P}: what "${o.label}" takes back starts with the action it names (${o.takes})`);
    }
    // the seat's own last action, however far back: first-class
    let last = -1;
    for (let i = room.actions.length - 1; i >= Math.max(0, room.actions.length - 80); i--) {
      const a = room.actions[i]!;
      if (a.seat === P && a.type !== 'amend' && !forcedAt(room, i)) { last = i; break; }
    }
    assert.ok(last >= 0, `fixture: seat ${P} acted lately`);
    const mine = opts.filter(o => /\(your last action/.test(o.label));
    assert.equal(mine.length, 1, `seat ${P}: one "your last action" option (${opts.map(o => o.label).join(' | ')})`);
    assert.equal(mine[0]!.to, last, `seat ${P}: it goes back to just before that seat's own last action`);
  }
});

/* ── §2 ─────────────────────────────────────────────────────────────── */

test('§2 inside a hidden step no option cuts what the asking seat has not seen, and nothing counts the log', () => {
  const room = R.createRoom('H523', 52301, [...NAMES], 'shared');
  live(room);
  // both seats act in the hidden planning step, interleaved: Ann, Bo, Ann
  const act = (seat: Seat, type: string): void => {
    const a = R.legalInRoom(room, seat).find(x => x.type === type);
    assert.ok(a, `fixture: seat ${seat} may ${type} (${R.legalInRoom(room, seat).map(x => x.type).join(',')})`);
    tick(room, a!);
  };
  act(0, 'recycleForResource');
  act(1, 'recycleForResource');
  act(0, 'activateResource');
  assert.ok(room.segKey, 'fixture: still inside the hidden step');
  const start = room.segStartIndex;
  const hiddenOf = (seat: Seat, from: number): boolean => room.actions.slice(Math.max(from, start)).some(a => a.seat === seat
    && a.type !== 'donePlanning' && a.type !== 'doneDeploying' && a.type !== 'amend');
  for (const P of [0, 1] as Seat[]) {
    const O = other(P);
    const opts = R.rewindOptions(room, P);
    assert.ok(opts.some(o => /^Back to the start of this step/.test(o.label)), `seat ${P}: the start of the step is offered`);
    for (const o of opts) {
      const text = `${o.label} — ${o.takes ?? ''}`;
      assert.doesNotMatch(text, COUNTED, `seat ${P}: "${text}" counts nothing`);
      assert.doesNotMatch(text, /their (recycle|resource)/, `seat ${P}: "${text}" names none of the other seat's hidden actions`);
      if (/^Back to the start of/.test(o.label)) {
        assert.match(o.takes ?? '', /anything they did this step/, `seat ${P}: the step's start says it takes theirs, uncounted`);
        continue;
      }
      assert.ok(!hiddenOf(O, o.to), `seat ${P}: "${o.label}" (to ${o.to}) would cut seat ${O}'s hidden actions`);
    }
  }
  // Ann's own resource is hers to go back before; Bo's recycle stands between
  // her and her own recycle, so that cut is only the step's start
  const ann = R.rewindOptions(room, 0);
  assert.ok(ann.some(o => o.to === 2 && /\(your last action/.test(o.label)), 'Ann may go back before her own last action');
  assert.ok(!ann.some(o => o.to === 1 || (o.to === 0 && o.label.startsWith('Back to before'))), 'and no further, but to the step start');
  assert.ok(!R.rewindOptions(room, 1).some(o => o.label.startsWith('Back to before')), 'Bo, whose last action Ann has acted after, only the start');

  // every rewind Ann could propose: what each seat — and the public log line — is told
  for (const o of ann) {
    const P = 0 as Seat;
    assert.deepEqual(R.proposeFix(room, P, { rewind: o.to, reason: 'I misclicked' }), { ok: true });
    const toOther = R.fixInfo(room, 1)!.proposal!.what;
    const toMe = R.fixInfo(room, 0)!.proposal!.what;
    for (const [who, text] of [['Bo', toOther], ['Ann', toMe], ['the public log', room.proposal!.pub ?? '']] as const) {
      assert.doesNotMatch(text, COUNTED, `${who} is told no count: "${text}"`);
    }
    // (Bo's OWN recycle he may read about — "your recycle"; never Ann's)
    assert.doesNotMatch(toOther, /their (recycle|resource)|Ann's/, `Bo is not told which of Ann's hidden actions: "${toOther}"`);
    assert.doesNotMatch(room.proposal!.pub ?? '', /recycle|resource/, `nor is the public line: "${room.proposal!.pub}"`);
    assert.ok(R.answerFix(room, P, 'cancel', room.proposal!.id).ok);
  }
});

/* ── §3 ─────────────────────────────────────────────────────────────── */

const ui = await client();
(globalThis as unknown as { fetch: unknown }).fetch = () =>
  Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
const fixSent = (): Record<string, unknown>[] => ui.sent().filter(m => m['t'] === 'amend');
const FIX = '🛠 Beta: propose a fix';
function menuLabels(html: string): string[] {
  return [...html.matchAll(/data-btn="menuitem" data-i="\d+">([\s\S]*?)<\/button>/g)].map(m => m[1]!.replace(/<[^>]*>/g, '').trim());
}
function openDialog(h: Harness, me: Seat): void {
  ui.join(viewFor(h.state, me) as GameState, me, legalActions(h.state, me) as Action[]);
  ui.push({ t: 'amend', fix: {} });
  ui.rightClick({ act: 'player', p: me });
  ui.click({ btn: 'menuitem', i: String(menuLabels(ui.html()).indexOf(FIX)) });
  ui.sent();
}
const OPTS = [
  { to: 41, label: 'Back to before their pass', takes: 'their pass' },
  { to: 40, label: 'Back to before your Fireball (your last action)', takes: 'your Fireball and their pass' },
];

test('§3 the dialog picks no rewind for you, shows what each takes back, and points a play still being aimed at Escape', () => {
  const h = new Harness(52302, ['Ann', 'Bo']);
  toDeployment(h);
  const A = h.state.initiative;
  spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  // on to the attack window, where the attacker holds priority
  h.do(legalActions(h.state, A).filter(a => a.type === 'declareAttack').at(-1)!);
  for (let g = 0; g < 10 && h.state.priority === null; g++) { const f = forcedAction(h.state); if (!f) break; h.do(f); }
  const me = h.state.priority as Seat;
  assert.ok(me === 0 || me === 1, 'fixture: a seat holds priority');
  openDialog(h, me);
  let html = ui.push({ t: 'amendopts', rewinds: OPTS, editWhy: null });
  ui.click({ amend: 'kind', kind: 'rewind' });
  ui.type('amend-reason', 'I passed by mistake');
  html = ui.html();
  assert.doesNotMatch(html, /aria-checked="true"[^>]*data-amend="rewindto"/, 'no rewind is chosen until the player chooses one');
  assert.match(html, /data-amend="send"[^>]*disabled/, 'so there is nothing to send yet');
  ui.click({ amend: 'send' });
  assert.deepEqual(fixSent(), [], 'and send sends nothing');
  for (const o of OPTS) assert.ok(html.includes(`takes back ${o.takes}`), `the option shows what it takes back (${o.takes})`);
  assert.doesNotMatch(html, /press Esc/, 'no Escape hint while nothing of yours is being aimed');
  html = ui.click({ amend: 'rewindto', to: '40' });
  assert.match(html, /aria-checked="true" class="on"\s+data-amend="rewindto" data-to="40"/, 'the one clicked is chosen');
  ui.click({ amend: 'send' });
  assert.deepEqual(fixSent(), [{ t: 'amend', op: 'propose', reason: 'I passed by mistake', rewind: 40 }]);
  // a reopened dialog starts with nothing chosen again
  ui.push({ t: 'amenderr', msg: 'x' });
  ui.click({ amend: 'close' });
  openDialog(h, me);
  html = ui.push({ t: 'amendopts', rewinds: OPTS, editWhy: null });
  ui.click({ amend: 'kind', kind: 'rewind' });
  assert.doesNotMatch(ui.html(), /aria-checked="true"[^>]*data-amend="rewindto"/, 'reopened: nothing chosen');
  ui.click({ amend: 'close' });

  // your own play, still being aimed (#243, #254): Escape takes it back alone
  give(h, me, 'Flame of History');
  giveResources(h, me, 'fire', 4);
  const play = legalActions(h.state, me).find(a => a.type === 'playCard'
    && h.state.players[me]!.hand[(a as { handIndex: number }).handIndex] === 'Flame of History');
  assert.ok(play, 'fixture: Flame of History can be played');
  h.do(play!);
  assert.equal(h.state.suspension?.type, 'cast', 'fixture: it waits on its target');
  openDialog(h, me);
  ui.push({ t: 'amendopts', rewinds: OPTS, editWhy: null });
  html = ui.click({ amend: 'kind', kind: 'rewind' });
  assert.match(html, /Still aiming your own play\? Close this and press Esc/, 'the dialog says Escape takes the play back');
  ui.click({ amend: 'close' });
});
