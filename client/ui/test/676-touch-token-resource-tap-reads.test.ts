/* 676 — ON TOUCH, A TAP ON A SPELL TOKEN OR A RESOURCE READS; A BUTTON ACTS
 * (CT-408, the rest of report #201).
 *
 * Report #201 (WUSC, 2026-10-08): "the game forced me to play my card in
 * battle when I was just trying to look at it." test/384 made a finger's tap
 * on a hand or cache card only read it, test/646 the bin. Three taps still
 * acted at once: casting your own spell token, firing a unit's only
 * unconfirmed ability, and activating a resource. The owner (2026-10-25),
 * asked which should become "tap shows the card, then a button acts":
 * "Casting a spell token, Activating a resource". So:
 *
 *  - a finger's tap on your own castable spell token reads it, and a Cast
 *    button appears on that token; the button casts;
 *  - a finger's tap on a resource whose click would act at once (activate, or
 *    the one exchange) reads it, and that action's button appears on it;
 *  - a unit's only ability STAYS a one-tap action;
 *  - a mouse is unchanged everywhere.
 *
 * Driven through the real client (test/ui-driver.ts), as 384 and 646 are: the
 * finger is a pointerdown/pointerup of type `touch` and the click the browser
 * makes. The driver lays nothing out, so the zoom copy itself never goes up
 * here; the headless-Chrome check of it is in the round's report.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { giveResources, spawn, toDeployment } from '../../engine/test/util.ts';
import type { Action, EntityId, GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();
const me = 0 as Seat;

/** a mouse's press, so the next click is a mouse click again */
const mouse = (want: Record<string, string | number>): void => {
  ui.pointer('pointerdown', want, { pointerType: 'mouse', pointerId: 2, isPrimary: true });
};

/** deployment, with a Fireball spell token of mine standing at home */
function withAToken(seed: number): { state: GameState; id: EntityId; legal: Action[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const e = new E(h.state);
  e.createSpellToken(me, 'Fireball', 2, e.homeRegion(me));
  h.state = e.s;
  const tok = Object.values(h.state.entities).find(t => t.kind === 'spellToken' && t.controller === me);
  assert.ok(tok, 'the fixture has a spell token of mine');
  return { state: h.state, id: tok.id, legal: [{ type: 'castSpellToken', seat: me, entityId: tok.id }] };
}

/** the planning phase, one dormant resource of mine whose one action is to activate it */
function withADormantResource(seed: number): { state: GameState; i: number; legal: Action[] } {
  const h = new Harness(seed);
  giveResources(h, me, 'fire', 1, 'dormant');
  const i = h.state.players[me]!.resources.length - 1;
  return { state: h.state, i, legal: [{ type: 'activateResource', seat: me, index: i }] };
}

const CAST = (id: EntityId): Action => ({ type: 'castSpellToken', seat: me, entityId: id, ordered: true });

test('CR 701.1b / CT-408: the control, a mouse click on my castable spell token still casts it', () => {
  const { state, id, legal } = withAToken(67601);
  ui.join(state, me, legal);
  ui.sent();
  mouse({ act: 'token', id });
  ui.click({ act: 'token', id });
  assert.deepEqual(ui.actions(), [CAST(id)], 'one click, cast: the desktop is unchanged');
});

test('CR 701.1b / CT-408: a finger tap on my castable spell token sends nothing, and a Cast button appears on it', () => {
  const { state, id, legal } = withAToken(67602);
  ui.join(state, me, legal);
  ui.sent();
  assert.ok(!ui.has({ btn: 'tapgo' }), 'no button before the tap');
  const html = ui.tap({ act: 'token', id });
  assert.deepEqual(ui.actions(), [], 'a tap must not cast the token (report #201)');
  assert.doesNotMatch(html, /class="menu"/, 'nor open a menu');
  assert.match(html, new RegExp(`data-act="token" data-id="${id}"[^>]*>[\\s\\S]*?data-btn="tapgo"[^>]*>[^<]*Cast`),
    'the Cast button is drawn on the tapped token');
});

test('CR 701.1b / CT-408: the finger route, a tap on the Cast button casts the token', () => {
  const { state, id, legal } = withAToken(67603);
  ui.join(state, me, legal);
  ui.sent();
  ui.tap({ act: 'token', id });
  assert.deepEqual(ui.actions(), []);
  ui.tap({ btn: 'tapgo' });
  assert.deepEqual(ui.actions(), [CAST(id)], 'a button is a button: tapped, it casts');
  assert.ok(!ui.has({ btn: 'tapgo' }), 'and it goes once used');
});

test('CR 701.1b / CT-408: a tap anywhere else, or Escape, takes the Cast button away unused', () => {
  const { state, id, legal } = withAToken(67604);
  ui.join(state, me, legal);
  ui.sent();
  ui.tap({ act: 'token', id });
  assert.ok(ui.has({ btn: 'tapgo' }));
  ui.key('Escape');
  assert.ok(!ui.has({ btn: 'tapgo' }), 'Escape puts it away');
  ui.tap({ act: 'token', id });
  assert.ok(ui.has({ btn: 'tapgo' }));
  ui.tap({ act: 'player', p: 1 });
  assert.ok(!ui.has({ btn: 'tapgo' }), 'a tap on something else puts it away');
  assert.deepEqual(ui.actions(), [], 'and nothing was cast along the way');
});

test('CR 502.2b / CT-408: the control, a mouse click on a dormant resource still activates it', () => {
  const { state, i, legal } = withADormantResource(67605);
  ui.join(state, me, legal);
  ui.sent();
  mouse({ act: 'res', p: me, i });
  ui.click({ act: 'res', p: me, i });
  assert.deepEqual(ui.actions(), legal, 'one click, activated: the desktop is unchanged');
});

test('CR 502.2b / CT-408: a finger tap on a dormant resource sends nothing; its Activate button activates it', () => {
  const { state, i, legal } = withADormantResource(67606);
  ui.join(state, me, legal);
  ui.sent();
  const html = ui.tap({ act: 'res', p: me, i });
  assert.deepEqual(ui.actions(), [], 'a tap must not activate the resource');
  assert.doesNotMatch(html, /class="menu"/, 'nor open a menu');
  assert.match(html, new RegExp(`data-act="res" data-p="${me}" data-i="${i}"[^>]*>[\\s\\S]*?data-btn="tapgo"[^>]*>[^<]*Activate`),
    'the Activate button is drawn on the tapped resource');
  ui.tap({ btn: 'tapgo' });
  assert.deepEqual(ui.actions(), legal, 'tapped, the button activates it');
});

test('CR 502.2b / CT-408: a resource with more than one route still opens its menu on a tap, and nothing acts', () => {
  const h = new Harness(67607);
  h.state.players[me]!.resources.push({ kind: 'prismite', state: 'open' });
  const i = h.state.players[me]!.resources.length - 1;
  const legal: Action[] = (['fire', 'water'] as const).map(element => ({ type: 'exchangePrismite', seat: me, index: i, element }));
  ui.join(h.state, me, legal);
  ui.sent();
  const html = ui.tap({ act: 'res', p: me, i });
  assert.deepEqual(ui.actions(), [], 'nothing is exchanged on the tap');
  assert.match(html, /class="menu"/, 'the menu is already a second step, so it stays');
  ui.key('Escape');
});

test('CR 502.2b / CT-408: a tap on a stale button sends nothing once the action is gone', () => {
  const { state, i, legal } = withADormantResource(67608);
  ui.join(state, me, legal);
  ui.sent();
  ui.tap({ act: 'res', p: me, i });
  assert.ok(ui.has({ btn: 'tapgo' }));
  ui.join(state, me, []);   // the server moved on: nothing to activate any more
  ui.sent();
  assert.ok(!ui.has({ btn: 'tapgo' }), 'the button goes with the action it stood for');
});

test('CT-408: a unit with one unconfirmed ability still fires it on a single finger tap (the owner kept it one tap)', () => {
  const h = new Harness(67609, ['Ann', 'Bo']);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  const obs = spawn(h, seat, 'Prismatic Observer');
  const a = legalActions(h.state, seat).find(x => x.type === 'activateAbility' && x.entityId === obs);
  assert.ok(a, 'the observer can be activated in deployment');
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  ui.sent();
  ui.tap({ act: 'unit', id: obs });
  assert.deepEqual(ui.actions(), [a], 'one tap, activated, as before');
  assert.ok(!ui.has({ btn: 'tapgo' }), 'and no button was drawn for it');
});
