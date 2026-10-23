/* Report round 2026-10-23 — A REPORT FROM A SOLO ROOM CARRIES THE GAME.
 *
 * Players file bugs from the Weekly Challenge, and every one arrived with
 * nothing replayable: a challenge run is a room in the browser (ui/solo.ts),
 * the report form attached room/seat/actionIndex only for a SERVER room, and
 * so the server got `room: ''` and the note — while the whole run sat in
 * localStorage. One reporter wrote "in the attached state…", believing it had
 * been sent. Learn to Play is the same room and had the same gap.
 *
 *   §1 from a challenge run, through main.ts's rail button: the body carries
 *      the run — the challenge as dealt, the ordered deck, the room's whole
 *      log (both seats) and the index the reporter is at — and the page is
 *      `challenge`, and the server's own sanitizer keeps all of it
 *   §2 the attachment is the moment the form OPENED: play on after Cancel
 *      and the next report carries the longer log
 *   §3 the toast tells the truth: a bug from a run says it can be replayed
 *   §4 Learn to Play: the same, from its deal (the rail's handler names
 *      learn.reportAttachment for a Learn to Play game)
 *   §5 a report from a SERVER room is the body it always was — no `solo`
 *
 * Seeds 59200-59299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import type { Action, GameState } from '../../engine/src/types.ts';
import type { ChallengeDef } from '../../engine/src/challenge.ts';

const DEF: ChallengeDef = { id: 'c592', week: '2026-10-18', title: 'Tiny', blurb: '', goal: { kind: 'unitsPlayed', n: 50 }, seed: 59200, par: 3 };
const SPARK = DECK_LIST.find(n => { const c = getCard(n); return c.kind === 'unit' && c.mana === 1 && c.timing === 'deploy' && (c.factions ?? []).join() === 'fire' && c.cost.length <= 1; })!;
const DECK = Array.from({ length: 12 }, () => SPARK);

const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = `?challenge=play&id=${DEF.id}`;
g['__UI_DRIVER_STORE'] = { algoChallengeRun: JSON.stringify({ v: 1, def: DEF, deck: DECK, actions: [], by: [] }) };
const { home } = await import('./ui-driver.ts');
const chrun = await import('../challengerun.ts');
const learn = await import('../learn.ts');
const { openReport } = await import('../report.ts');
const { sanitizeReportRun } = await import('../../server/report-run.ts');
const { fallbackMove } = await import('../bot.ts');

/** every /api/report body, answered ok */
const posted: Record<string, unknown>[] = [];
g['fetch'] = (url: string, init?: { body?: string }) => {
  if (url === '/api/report') {
    posted.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>);
    return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
  }
  return new Promise(() => {});
};
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const settle = (): Promise<void> => new Promise(r => setImmediate(r));

/** a player that plays what it can, recycling once a turn */
function playerMove(legal: Action[], state: GameState, mem: { t?: number }): Action {
  const play = legal.find(a => a.type === 'playCard');
  if (play) return play;
  const rec = legal.find(a => a.type === 'recycleForResource');
  if (rec && mem.t !== state.turn) { mem.t = state.turn; return rec; }
  const on = legal.find(a => a.type === 'activateResource' || a.type === 'exchangePrismite');
  if (on) return on;
  return fallbackMove(legal) ?? legal[0]!;
}

const ui = home();

/** fill and send the open form as a bug */
async function sendBug(note: string): Promise<Record<string, unknown>> {
  posted.length = 0;
  ui.click({ report: 'kind', kind: 'bug' });
  ui.click({ report: 'severity', severity: 'medium' });
  ui.type('report-note', note);
  ui.click({ report: 'send' });
  await settle();
  assert.equal(posted.length, 1, 'one POST to /api/report');
  return posted[0]!;
}

test('CR D8.1 / report 271 §1 a report from a challenge run carries the run, and the server keeps all of it', async () => {
  await flush();
  const run = chrun.currentRun();
  assert.ok(run, 'fixture: the saved run was picked up');
  const mem: { t?: number } = {};
  for (let i = 0; i < 12; i++) run.server.act(playerMove(run.server.legal(), run.state, mem));
  const log = run.server.save.actions;
  assert.ok(log.length > 12 && log.some(a => a.seat === 1), 'non-vacuous: a log with both seats in it');

  const dialog = ui.click({ btn: 'reportopen' });
  assert.match(dialog, /Filed with this exact moment of the game/, 'the form says the moment goes with it');
  const body = await sendBug('the meter stopped');
  assert.equal(body['room'], '', 'still no room: there is none on the server');
  assert.equal(body['page'], 'challenge', 'the page names the kind of room');
  const solo = body['solo'] as Record<string, unknown> | undefined;
  assert.ok(solo, 'the body carries the run (before this round: the note alone)');
  assert.equal(solo['kind'], 'challenge');
  assert.deepEqual(solo['deck'], DECK, 'the ordered deck');
  assert.deepEqual(solo['actions'], log, 'the WHOLE log, both seats');
  assert.equal(solo['at'], log.length, 'the index the reporter was at');
  const def = solo['def'] as Record<string, unknown>;
  assert.equal(def['id'], DEF.id);
  assert.equal(def['seed'], DEF.seed, 'the challenge as this browser dealt it');
  const kept = sanitizeReportRun(solo);
  assert.ok(kept.ok, `the server keeps it: ${kept.ok ? '' : kept.why}`);
  assert.deepEqual(kept.run.actions, log, 'and keeps every action of it');
});

test('CR D8.1 / report 271 §2 the run is the moment the form opened', async () => {
  const run = chrun.currentRun()!;
  const before = run.server.save.actions.length;
  const mem: { t?: number } = {};
  for (let i = 0; i < 6; i++) run.server.act(playerMove(run.server.legal(), run.state, mem));
  const now = run.server.save.actions.length;
  assert.ok(now > before, 'fixture: play went on');
  ui.click({ btn: 'reportopen' });
  const body = await sendBug('again');
  assert.equal((body['solo'] as { at: number }).at, now, 'the second report is at the later moment');
  assert.equal((body['solo'] as { actions: unknown[] }).actions.length, now);
});

test('CR D8.1 / report 271 §3 a bug filed from a run says it can be replayed', async () => {
  ui.click({ btn: 'reportopen' });
  await sendBug('toast check');
  assert.match(ui.html(), /class="toast">[^<]*replay this exact moment/,
    'the toast promised a replay for room bugs only; it is true for a run now too');
});

test('CR D8.1 / report 271 §4 Learn to Play carries its deal and log', async () => {
  const { server } = learn.startSolo('fire', { fresh: true });
  for (let i = 0; i < 4; i++) {
    const legal = server.legal();
    if (!legal.length) break;
    server.act(fallbackMove(legal) ?? legal[0]!);
  }
  const log = server.save.actions;
  assert.ok(log.length > 0, 'non-vacuous: the game has a log');
  const att = learn.reportAttachment(server);
  openReport({ solo: att });
  const body = await sendBug('the bot froze');
  assert.equal(body['page'], 'learn');
  const solo = body['solo'] as Record<string, unknown>;
  assert.equal(solo['kind'], 'learn');
  assert.deepEqual(solo['actions'], log);
  assert.equal(solo['at'], log.length);
  assert.deepEqual((solo['deal'] as { seed: number }).seed, server.deal.seed);
  const kept = sanitizeReportRun(solo);
  assert.ok(kept.ok, `the server keeps it: ${kept.ok ? '' : kept.why}`);
  // the rail is one handler for every board; read it, since this page is a
  // challenge run and cannot also be Learn to Play
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  const handler = /reportopen: \(\) => \{[\s\S]*?\n {2}\},/.exec(main)?.[0] ?? '';
  assert.match(handler, /learn\.reportAttachment\(/, 'the rail hands a Learn to Play game its run');
  assert.match(handler, /chrun\.reportAttachment\(/, 'and a challenge run its run');
});

test('CR D8.1 / report 271 §5 a server room report is the body it always was', async () => {
  openReport({ room: 'ABCD', seat: 1 });
  const body = await sendBug('a room bug');
  assert.deepEqual(Object.keys(body).sort(), ['kind', 'note', 'page', 'room', 'seat', 'severity'], 'no solo key on a room report');
  assert.equal(body['page'], 'game');
});
