/* BL-76 — "NOT A BUG! JUST TAKING SOMETHING BACK." IN THE PROPOSE A FIX DIALOG.
 *
 * The owner, 2026-11-13: "we should add a checkbox below the 'Reason' that
 * just allows them to say 'Not a bug! Just taking something back.' That would
 * help us sort reports more easily and stop players from having to type 'oops'
 * or 'aoiehf' in the reason box."
 *
 *   §1 the box sits under the reason box; ticked, the fix sends with the
 *      reason empty and says it is a take-back; unticked, the reason is
 *      required as before
 *   §2 the other seat's bar says it is a take-back — and still names the fix
 *   §3 the admin reports page tells a take-back row from a bug at a glance
 *
 * Seeds 124310-124319.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';
import { adminHtml, type AdminView } from '../pages/admin.ts';
import { client } from './ui-driver.ts';

const ui = await client();
(globalThis as unknown as { fetch: unknown }).fetch = () =>
  Promise.resolve({ json: () => Promise.resolve({ ok: true }) });

const FIX = '🛠 Beta: propose a fix';
const fixSent = (): Record<string, unknown>[] => ui.sent().filter(m => m['t'] === 'amend');

function battle(seed: number): { h: Harness; me: Seat; them: Seat } {
  const h = new Harness(seed, ['Ann', 'Bo']);
  toDeployment(h);
  const A = h.state.initiative;
  spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  const me = (h.state.priority ?? A) as Seat;
  return { h, me, them: (me === 0 ? 1 : 0) as Seat };
}

function openDialog(seed: number): { me: Seat; them: Seat } {
  const { h, me, them } = battle(seed);
  ui.join(viewFor(h.state, me) as GameState, me, legalActions(h.state, me) as Action[]);
  ui.push({ t: 'amend', fix: {} });
  ui.sent();
  const html = ui.rightClick({ act: 'player', p: me });
  const labels = [...html.matchAll(/data-btn="menuitem" data-i="\d+">([\s\S]*?)<\/button>/g)].map(m => m[1]!.replace(/<[^>]*>/g, '').trim());
  ui.click({ btn: 'menuitem', i: String(labels.indexOf(FIX)) });
  ui.push({ t: 'amendopts', rewinds: [{ to: 3, label: 'Take back the last 1 action', takes: 'your pass' }], editWhy: null });
  ui.click({ amend: 'kind', kind: 'rewind' });
  ui.sent();
  return { me, them };
}

const sendOff = (): boolean => /data-amend="send"[^>]*disabled/.test(ui.html());

test('1243 §1 ticked, the fix sends with no reason and says take-back; unticked, the reason is required', () => {
  const { me } = openDialog(124310);
  const html = ui.html();
  assert.match(html, /id="amend-reason"[\s\S]*?<label class="amendtakeback"><input type="checkbox" data-amend="takeback">\s*Not a bug! Just taking something back\.<\/label>/,
    'the box sits under the reason box, unticked');
  ui.click({ amend: 'rewindto', to: '3' });
  assert.ok(sendOff(), 'negative control: no reason, no box — the send is off');
  ui.click({ amend: 'takeback' });
  assert.match(ui.html(), /data-amend="takeback" checked/, 'the click ticks it');
  assert.ok(!sendOff(), 'ticked: the reason may stay empty');
  ui.click({ amend: 'send' });
  assert.deepEqual(fixSent(), [{ t: 'amend', op: 'propose', reason: '', takeBack: true, rewind: 3 }]);
  // the server put it up: the dialog goes, and the box starts unticked next time
  ui.push({ t: 'amend', how: 'proposed', fix: { proposal: { id: 5, seat: me, kind: 'rewind', what: 'back to before your pass', reason: '', takeBack: true, left: 60000 } } });
  ui.push({ t: 'amend', how: 'applied', fix: {} });
  openDialog(124311);
  assert.match(ui.html(), /data-amend="takeback">/, 'a fresh dialog starts unticked');
  ui.click({ amend: 'takeback' });
  ui.click({ amend: 'takeback' });
  ui.click({ amend: 'rewindto', to: '3' });
  assert.ok(sendOff(), 'unticked again: the reason is required again');
  ui.click({ amend: 'close' });
});

test('1243 §2 the other seat reads take-back on the bar, with the fix it names', () => {
  const { h, me, them } = battle(124312);
  ui.join(viewFor(h.state, me) as GameState, me, legalActions(h.state, me) as Action[]);
  const html = ui.push({ t: 'amend', how: 'proposed', fix: { proposal: { id: 8, seat: them, kind: 'rewind', what: 'back to before their attack', reason: '', takeBack: true, left: 60000 } } });
  assert.match(html, /proposes a fix:<\/b> back to before their attack\./, 'what is taken back is still said');
  assert.match(html, /Not a bug, just taking it back\./);
  assert.doesNotMatch(html, /Why: /, 'no empty "Why:"');
  const said = ui.push({ t: 'amend', how: 'proposed', fix: { proposal: { id: 9, seat: them, kind: 'rewind', what: 'back to before their attack', reason: 'misclick', takeBack: true, left: 60000 } } });
  assert.match(said, /Not a bug, just taking it back: misclick/);
  const plain = ui.push({ t: 'amend', how: 'proposed', fix: { proposal: { id: 10, seat: them, kind: 'edit', what: "set Ann's life to 12", reason: 'the heal did not happen', left: 60000 } } });
  assert.match(plain, /Why: the heal did not happen/, 'negative control: an ordinary fix keeps its Why');
  ui.push({ t: 'amend', how: 'cancelled', fix: {} });
});

test('1243 §3 the admin reports page shows a take-back row as a take-back', () => {
  const base = { ledgerId: null, room: 'QXZK', seat: 0, actionIndex: 3, by: { name: 'Bo' }, status: null, guards: [], ledgerNote: null, mark: null, markedBy: null };
  const v: AdminView = {
    access: true, current: 'reports', isLoading: false, actionMsg: '', faultMsg: '', overview: null,
    accountRows: [], gameRows: [], roomRows: [], calendar: null, onlyUnmarked: false, chrome: { signedIn: true, alerts: 0 },
    reportRows: [
      { ...base, id: 1, ts: '2026-11-14T10:00:00Z', note: '[Take-back] back to before Bo attacked. Not a bug, just taking something back.', kind: 'other', severity: null, fix: { takeBack: true } },
      { ...base, id: 2, ts: '2026-11-14T09:00:00Z', note: '[Agreed fix] Bo draws 1 card. What went wrong: no draw', kind: 'bug', severity: null, fix: {} },
    ],
  };
  const html = adminHtml(v);
  const cells = [...html.matchAll(/<tr class="">([\s\S]*?)<\/tr>/g)].map(m => m[1]!);
  assert.equal(cells.length, 2);
  assert.match(cells[0]!, /<span class="stchip"[^>]*>take-back<\/span>/);
  assert.doesNotMatch(cells[1]!, /take-back/, 'an ordinary fix row is still a bug');
  assert.match(cells[1]!, /<td>bug<\/td>/);
});
