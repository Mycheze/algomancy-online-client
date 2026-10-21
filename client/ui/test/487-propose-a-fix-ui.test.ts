/* BL-46 — "BETA: PROPOSE A FIX" ON THE CLIENT (ui/amend.ts, ui/main.ts).
 *
 * The owner, 2026-10-16: "Beta: propose a fix" in the table menu, and
 * "Propose: move this card" in a card's menu — touch reach included. One seat
 * proposes in a dialog; the other agrees or declines on a bar; the server
 * carries it out. The client proposes and answers, and decides nothing.
 *
 *   §1 the table menu has the entry exactly where the server says the room
 *      takes fixes — and the ☰ table button (touch) is that same menu
 *   §2 a card's menu offers "Propose: move this card" for YOUR card, and it
 *      opens the dialog with that card chosen
 *   §3 the dialog proposes what it shows, with the required reason, and goes
 *      once the server has the proposal up
 *   §4 the other seat's bar: Agree and Decline answer the proposal by id
 *   §5 while the dialog is up no game key gets through, and Escape closes it
 *   §6 in a hidden step every fix is live (owner, 2026-10-16); only a
 *      decision open for either seat leaves Rewind alone
 *
 * Seeds 48700-48799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';
import { client } from './ui-driver.ts';

const ui = await client();
(globalThis as unknown as { fetch: unknown }).fetch = () =>
  Promise.resolve({ json: () => Promise.resolve({ ok: true }) });

function menuLabels(html: string): string[] {
  assert.ok(html.includes('class="menu"'), 'no menu opened');
  return [...html.matchAll(/data-btn="menuitem" data-i="\d+">([\s\S]*?)<\/button>/g)]
    .map(m => m[1]!.replace(/<[^>]*>/g, '').trim());
}
const FIX = '🛠 Beta: propose a fix';
const fixSent = (): Record<string, unknown>[] => ui.sent().filter(m => m['t'] === 'amend');

/** a battle window with a unit on each side; this client is the seat with priority */
function battle(seed: number): { h: Harness; me: Seat; them: Seat; unit: number } {
  const h = new Harness(seed, ['Ann', 'Bo']);
  toDeployment(h);
  const A = h.state.initiative;
  const unit = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  const me = (h.state.priority ?? A) as Seat;
  return { h, me, them: (me === 0 ? 1 : 0) as Seat, unit };
}

function joinWithFixes(h: Harness, me: Seat, fix: Record<string, unknown> | null = {}): void {
  ui.join(viewFor(h.state, me) as GameState, me, legalActions(h.state, me) as Action[]);
  ui.push({ t: 'amend', fix });
  ui.sent();
}

/* ── §1 ─────────────────────────────────────────────────────────────── */

test('§1 the table menu offers a fix exactly where the room takes fixes', () => {
  const { h, me } = battle(48700);
  joinWithFixes(h, me, null);
  assert.ok(!menuLabels(ui.rightClick({ act: 'player', p: me })).includes(FIX), 'no entry in a room that takes no fixes');
  ui.click({ btn: 'menuclose' });
  joinWithFixes(h, me);
  const labels = menuLabels(ui.rightClick({ act: 'player', p: me }));
  assert.ok(labels.includes(FIX), `the bare-table menu has the entry (${labels.join(' | ')})`);
  ui.click({ btn: 'menuclose' });
  assert.ok(menuLabels(ui.click({ btn: 'tablemenu' })).includes(FIX), 'and the ☰ table button — the finger route — is the same menu');
  ui.click({ btn: 'menuclose' });
});

/* ── §2 ─────────────────────────────────────────────────────────────── */

test('§2 a card menu offers Propose: move this card for your own card, and opens the dialog with it', () => {
  const { h, me, them } = battle(48701);
  joinWithFixes(h, me);
  const mine = h.state.players[me]!.hand[0]!;
  const labels = menuLabels(ui.rightClick({ prev: mine }));
  assert.ok(labels.includes('🛠 Propose: move this card'), `your hand card offers it (${labels.join(' | ')})`);
  const i = labels.indexOf('🛠 Propose: move this card');
  const html = ui.click({ btn: 'menuitem', i: String(i) });
  assert.ok(html.includes('class="amendscrim"'), 'the fix dialog opened');
  assert.match(html, /<option value="hand:0" selected>/, 'with that card chosen');
  assert.deepEqual(fixSent(), [{ t: 'amend', op: 'options' }], 'and it asked the server what can be done now');
  ui.click({ amend: 'close' });
  // a unit on the board is public — anyone's may be proposed
  const theirUnit = spawn(h, them, 'Good Whale');
  joinWithFixes(h, me);
  assert.ok(menuLabels(ui.rightClick({ previd: theirUnit })).includes('🛠 Propose: move this card'), 'a unit on the board offers it');
  ui.click({ btn: 'menuclose' });
});

/* ── §3 ─────────────────────────────────────────────────────────────── */

test('§3 the dialog proposes what it shows, with the reason, and goes once the proposal is up', () => {
  const { h, me } = battle(48702);
  joinWithFixes(h, me);
  ui.rightClick({ act: 'player', p: me });
  const labels = menuLabels(ui.html());
  ui.click({ btn: 'menuitem', i: String(labels.indexOf(FIX)) });
  assert.deepEqual(fixSent(), [{ t: 'amend', op: 'options' }], 'opening asks what can be done now');
  ui.push({ t: 'amendopts', rewinds: [{ to: 3, label: 'Take back the last 1 action' }], editWhy: null });
  ui.click({ amend: 'kind', kind: 'drawCards' });
  assert.ok(ui.has({ amend: 'send', disabled: '' }) || /data-amend="send"[^>]*disabled/.test(ui.html()),
    'no reason yet: the send is off — the reason becomes the bug report');
  ui.type('amend-reason', 'my draw did not trigger');
  ui.click({ amend: 'send' });
  assert.deepEqual(fixSent(), [{ t: 'amend', op: 'propose', reason: 'my draw did not trigger', edit: { kind: 'drawCards', target: me, n: 1 } }]);
  const html = ui.push({ t: 'amend', how: 'proposed', fix: { proposal: { id: 4, seat: me, kind: 'edit', what: 'Ann draws 1 card', reason: 'my draw did not trigger', left: 60000 } } });
  assert.ok(!html.includes('class="amendscrim"'), 'the dialog went once the proposal was up');
  assert.match(html, /Waiting for .* to agree/, 'and the proposer sees it waiting');
  ui.click({ amend: 'cancel' });
  assert.deepEqual(fixSent(), [{ t: 'amend', op: 'cancel', id: 4 }], 'which the proposer may withdraw');
  ui.push({ t: 'amend', how: 'cancelled', fix: {} });
});

/* ── §4 ─────────────────────────────────────────────────────────────── */

test('§4 the other seat agrees or declines on a bar, by the proposal id', () => {
  const { h, me, them } = battle(48703);
  joinWithFixes(h, me);
  const html = ui.push({ t: 'amend', how: 'proposed', fix: { proposal: { id: 7, seat: them, kind: 'edit', what: "set Ann's life to 12 (it was 9)", reason: 'the heal did not happen', left: 60000 } } });
  assert.match(html, /proposes a fix:/);
  assert.match(html, /Why: the heal did not happen/, 'the reason is on the bar');
  ui.click({ amend: 'accept' });
  assert.deepEqual(fixSent(), [{ t: 'amend', op: 'accept', id: 7 }]);
  ui.click({ amend: 'decline' });
  assert.deepEqual(fixSent(), [{ t: 'amend', op: 'decline', id: 7 }]);
  const gone = ui.push({ t: 'amend', how: 'applied', fix: {} });
  assert.ok(!/proposes a fix:/.test(gone), 'the bar goes with the proposal');
});

/* ── §5 ─────────────────────────────────────────────────────────────── */

test('§5 while the dialog is up no game key gets through, and Escape closes it', () => {
  const h = new Harness(48704, ['Ann', 'Bo']);
  toDeployment(h);
  const me = h.state.deployPlayer!;
  joinWithFixes(h, me);
  ui.key('z', { ctrl: true });
  assert.equal(ui.sent().filter(m => m['t'] === 'undo').length, 1, 'negative control: on the bare board Ctrl+Z is the game undo');
  ui.rightClick({ act: 'player', p: me });
  ui.click({ btn: 'menuitem', i: String(menuLabels(ui.html()).indexOf(FIX)) });
  ui.sent();
  ui.key('z', { ctrl: true });
  assert.equal(ui.sent().filter(m => m['t'] === 'undo').length, 0, 'the dialog owns the keyboard');
  const html = ui.key('Escape');
  assert.ok(!html.includes('class="amendscrim"'), 'Escape closed it');
});

/* ── §6 ─────────────────────────────────────────────────────────────── */

test('§6 in a hidden step every fix is live, from the table menu; only an open decision leaves Rewind alone', () => {
  // owner, 2026-10-16: edits work in the hidden planning / deploy steps too
  const h = new Harness(48705, ['Ann', 'Bo']);
  assert.equal(h.state.phase, 'planning', 'fixture: the hidden planning step');
  joinWithFixes(h, 0);
  const labels = menuLabels(ui.rightClick({ act: 'player', p: 0 }));
  assert.ok(labels.includes(FIX), `the table menu offers a fix in the hidden step (${labels.join(' | ')})`);
  ui.click({ btn: 'menuitem', i: String(labels.indexOf(FIX)) });
  ui.sent();
  let html = ui.push({ t: 'amendopts', rewinds: [{ to: 1, label: 'Take back the last 1 action' }], editWhy: null });
  for (const k of ['life', 'drawCards', 'move', 'unit']) {
    assert.doesNotMatch(html, new RegExp(`data-kind="${k}" title="[^"]*" disabled`), `${k} is live in the hidden step`);
  }
  ui.click({ amend: 'kind', kind: 'drawCards' });
  ui.type('amend-reason', 'the turn draw was skipped');
  ui.click({ amend: 'send' });
  assert.deepEqual(fixSent(), [{ t: 'amend', op: 'propose', reason: 'the turn draw was skipped', edit: { kind: 'drawCards', target: 0, n: 1 } }]);
  ui.click({ amend: 'close' });
  // a question open for either seat: the server says edits must wait
  ui.rightClick({ act: 'player', p: 0 });
  ui.click({ btn: 'menuitem', i: String(menuLabels(ui.html()).indexOf(FIX)) });
  ui.sent();
  html = ui.push({ t: 'amendopts', rewinds: [{ to: 1, label: 'Take back the last 1 action' }],
    editWhy: 'no edits while a decision is pending — a rewind still works' });
  assert.match(html, /aria-checked="true" class="on"\s+data-amend="kind" data-kind="rewind"/, 'rewind is chosen');
  for (const k of ['life', 'drawCards', 'move', 'unit']) {
    assert.match(html, new RegExp(`data-kind="${k}" title="[^"]*" disabled`), `${k} waits for the answer`);
  }
  assert.match(html, /no edits while a decision is pending/, 'and the dialog says why');
  ui.type('amend-reason', 'he misclicked');
  ui.click({ amend: 'rewindto', to: '1' });   // CT-323: nothing is picked for you (523)
  ui.click({ amend: 'send' });
  assert.deepEqual(fixSent(), [{ t: 'amend', op: 'propose', reason: 'he misclicked', rewind: 1 }]);
  ui.push({ t: 'amenderr', msg: 'that rewind is not on offer any more' });
  assert.match(ui.html(), /that rewind is not on offer any more/, 'a refusal is shown in the dialog');
  ui.click({ amend: 'close' });
});
