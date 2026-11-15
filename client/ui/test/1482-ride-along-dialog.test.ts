/*
 * The ride-along question as a dialog: after Attack! (or a counterattack's
 * Confirm) every spell token that may come along is a card in a dialog over
 * the table, clicked in and out, with Bring all, Bring none, the confirm and
 * Go back. Driven through the real client (test/ui-driver.ts).
 *
 * Seeds 14820-14829.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { ridePickerHtml } from '../ride-picker.ts';
import { client } from './ui-driver.ts';
import type { EntityId, Seat } from '../../engine/src/types.ts';

const ui = await client();
ui.queries(true);   // Enter finds its button with querySelector — see ui-driver.ts

/** a declare step with `n` spell tokens at home, ready to ride, and the attack built */
function asked(seed: number, n: number): { A: Seat; toks: EntityId[]; html: string } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'The Foretold');
  const e = new E(h.state);
  const toks = Array.from({ length: n }, (_, i) => e.createSpellToken(A, 'Poison', i + 1, e.homeRegion(A)).id);
  e.settle();
  toNextBattle(h, A);
  ui.join(h.state, A, legalActions(h.state, A));
  ui.click({ act: 'unit', id: String(atk) });
  ui.click({ act: 'slot', ci: '0', row: '0' });
  ui.sent();
  return { A, toks, html: ui.click({ btn: 'confirmattack' }) };
}

/** the dialog's own markup, or '' when it is not up */
const dialog = (html: string): string => {
  const at = html.indexOf('class="overlaybox ridebox"');
  return at < 0 ? '' : html.slice(at);
};

const declared = (): EntityId[] | undefined => {
  const acts = ui.actions();
  assert.equal(acts.length, 1, 'one declaration went out');
  assert.equal(acts[0]!.type, 'declareAttack');
  return (acts[0] as { spellTokens?: EntityId[] }).spellTokens;
};

test('BL-78 #406: Attack! opens a dialog of the ridable spell tokens as cards, with Bring all and Bring none', () => {
  const { toks, html } = asked(14820, 2);
  assert.deepEqual(ui.actions(), [], 'the attack waits for the answer');
  const box = dialog(html);
  assert.ok(box, 'the ride-along question is a dialog over the table');
  assert.match(html, /class="overlay mainonly rideover"/, 'with the modal scrim');
  for (const id of toks) {
    assert.match(box, new RegExp(`class="card[^"]*"[^>]*data-act="token" data-id="${id}"`),
      `token ${id} is a card tile in the dialog`);
  }
  assert.match(box, /data-btn="rideall"[^>]*>Bring all 2</, 'a Bring all button that says how many');
  assert.match(box, /data-btn="ridenone"[^>]*>Bring none</, 'a Bring none button');
  assert.match(box, /data-btn="ridecancel"/, 'and Go back');
  assert.doesNotMatch(box, /data-btn="rideconfirm"/, 'no confirm until something is picked');
  assert.doesNotMatch(html, /data-btn="confirmattack"/,
    'the bar behind the dialog offers no second Attack! for Enter to find');
});

test('BL-78: Bring all declares the attack with every ridable token', () => {
  const { toks } = asked(14821, 3);
  ui.click({ btn: 'rideall' });
  assert.deepEqual([...(declared() ?? [])].sort((a, b) => a - b), [...toks].sort((a, b) => a - b),
    'every token rides');
});

test('BL-78: Bring none declares the attack with no tokens, and Enter never does', () => {
  asked(14822, 2);
  ui.key('Enter');
  assert.deepEqual(ui.actions(), [], 'Enter with nothing picked declines nothing and sends nothing');
  assert.ok(dialog(ui.html()), 'the dialog is still asking');
  ui.click({ btn: 'ridenone' });
  assert.deepEqual(declared(), [], 'with nothing riding');
});

test('BL-78: clicking a tile picks it; the confirm says how many and Enter sends it', () => {
  const { toks } = asked(14823, 2);
  const picked = ui.click({ act: 'token', id: String(toks[1]!) });
  const box = dialog(picked);
  assert.match(box, /class="ridecard on"/, 'the picked tile is marked');
  assert.match(box, /data-btn="rideconfirm"[^>]*>Attack — 1 token riding/, 'the confirm counts it');
  ui.key('Enter');
  assert.deepEqual(declared(), [toks[1]!], 'Enter sends the attack with the one picked');
});

test('BL-78: Escape and Go back return to the attack being built, picks kept', () => {
  const { toks } = asked(14824, 2);
  ui.click({ act: 'token', id: String(toks[0]!) });
  const back = ui.key('Escape');
  assert.equal(dialog(back), '', 'Escape puts the dialog away');
  assert.match(back, /data-btn="confirmattack"/, 'and the attack is being built again');
  assert.deepEqual(ui.actions(), [], 'nothing was declared');
  // Attack! with a token already picked goes straight out with it
  ui.click({ btn: 'confirmattack' });
  assert.deepEqual(declared(), [toks[0]!], 'the pick made in the dialog was kept');

  asked(14825, 1);
  const again = ui.click({ btn: 'ridecancel' });
  assert.equal(dialog(again), '', 'Go back puts it away too');
  assert.match(again, /data-btn="confirmattack"/);
});

test('BL-78: the dialog is drawn only from its view', () => {
  const card = (name: string, o: { data?: string }): string => `<div class="card" ${o.data ?? ''}>${name}</div>`;
  assert.equal(ridePickerHtml(null, card), '');
  const html = ridePickerHtml({ who: 'Ann', side: 'counter', tokens: [{ id: 7, card: 'Poison', x: 2, on: true }], picked: 1 }, card);
  assert.match(html, /Counterattack — 1 token riding/);
  assert.match(html, /<b>Ann:<\/b>/);
});

test('BL-78: on a counterattack, Bring all sends every token the counterattack may take', () => {
  const h = new Harness(14826);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  const ctr = spawn(h, D, 'The Foretold');
  const e = new E(h.state);
  const toks = [1, 2].map(x => e.createSpellToken(D, 'Poison', x, e.homeRegion(D)).id);
  e.settle();
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (let g = 0; g < 40 && h.state.battle!.step !== 'blocks'; g++) {
    const dec = h.state.decision;
    if (dec) h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
    else h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  assert.equal(h.state.battle!.step, 'blocks', 'fixture: the block step');
  ui.join(h.state, D, legalActions(h.state, D));
  ui.click({ act: 'unit', id: String(ctr) });
  ui.click({ act: 'sendslot' });
  ui.sent();
  const box = dialog(ui.click({ btn: 'confirmblocks' }));
  assert.match(box, /Bring all 2/, 'the counterattack asks in the same dialog');
  ui.click({ btn: 'rideall' });
  const acts = ui.actions();
  assert.equal(acts.length, 1);
  const a = acts[0] as { type: string; send?: EntityId[]; spellTokens?: EntityId[] };
  assert.equal(a.type, 'declareBlocks');
  assert.deepEqual(a.send, [ctr], 'the unit goes');
  assert.deepEqual([...(a.spellTokens ?? [])].sort((x, y) => x - y), [...toks].sort((x, y) => x - y),
    'and every token with it');
});
