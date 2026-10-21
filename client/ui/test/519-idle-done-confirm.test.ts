/* DONE WITH NOTHING DONE, WHILE SOMETHING COULD HAVE BEEN — the owner,
 * 2026-10-21:
 *
 *   "if the player takes no actions, but *could have*, best to have a
 *    confirmation."
 *
 * The reports behind it: ZKKX #225, Done deploying with Bloomcaster and
 * Spewing Mushroom castable and ringed in hand; XSAP #246/#250 and RTPE #256,
 * the haste step's Done pressed three times out of three over a legal haste
 * play. Enter presses both buttons, so Enter is held to the same.
 *
 * "Could have" is read off the legal list the server sent (any play besides
 * the Done), never off a list of cards. Once the seat has made a play in the
 * step, Done is immediate again. The cache's older question (a playable
 * cached card) still asks, and the two never stack into two bars.
 *
 * Seeds 51900-51919.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { giveResources, toDeployment } from '../../engine/test/util.ts';
import type { Action, Seat } from '../../engine/src/types.ts';

const ui = await client();
ui.queries(true);   // Enter finds its button with querySelector — see ui-driver.ts
const A: Seat = 0, D: Seat = 1;
const HASTE_CARD = 'Cinder Scuttler';   // {Haste}, one fire: playable in both steps
const store = (globalThis as unknown as { localStorage: Storage }).localStorage;

const legal = (h: Harness, seat: Seat): Action[] => legalActions(h.state, seat);
const show = (h: Harness): string => ui.join(viewFor(h.state, A), A, legal(h, A));
const refresh = (h: Harness): string => ui.update(viewFor(h.state, A), legal(h, A));
const plays = (h: Harness): Action[] => legal(h, A).filter(a => !/^done|^pass/.test(a.type));
const bars = (html: string): number => (html.match(/class="promptbar/g) ?? []).length;

function fund(h: Harness): void {
  for (const seat of [A, D]) giveResources(h, seat, 'fire', 4);
}

/** deployment, seat A holding `hand` and the fire to pay for it */
function deploy(hand: string[], seed = 51900): Harness {
  const h = new Harness(seed);
  for (const seat of [A, D]) h.state.players[seat]!.hand = [];
  toDeployment(h);
  fund(h);
  h.state.players[A]!.hand = [...hand];
  h.state.players[A]!.cache = [];
  assert.equal(h.state.phase, 'deploy', 'the premise: deployment');
  assert.equal(h.state.decision, null, 'the premise: no question open');
  return h;
}

/** inside the haste step, seat A holding `hand` */
function haste(hand: string[], seed = 51910): Harness {
  store.setItem('algoBluffHaste', '');
  const h = new Harness(seed);
  fund(h);
  h.state.players[A]!.hand = [...hand];
  h.state.players[D]!.hand = [];
  h.do({ type: 'donePlanning', seat: A });
  h.do({ type: 'donePlanning', seat: D });
  assert.deepEqual(h.state.hasteDone, [false, false], 'the premise: inside the haste step');
  return h;
}

for (const [step, build, btn, confirm, cancel, done] of [
  ['deployment', deploy, 'donedeploy', 'deployconfirm', 'deploycancel', 'doneDeploying'],
  ['the haste step', haste, 'donehaste', 'hasteconfirm', 'hastecancel', 'doneHaste'],
] as const) {
  test(`${step}: Done with a play on offer and none made sends nothing and asks`, () => {
    const h = build([HASTE_CARD, HASTE_CARD]);
    assert.ok(plays(h).length, `the premise: the engine offers a play in ${step}`);
    show(h);
    ui.sent();
    const html = ui.click({ btn, p: A });
    assert.deepEqual(ui.actions(), [], 'nothing went out');
    assert.ok(ui.has({ btn: confirm }), 'the confirm bar is up');
    assert.match(html, /you have not played anything yet, and you still can/);
    assert.equal(ui.has({ btn, p: A }), false, 'and it stands in place of the Done button');
  });

  test(`${step}: confirming sends the Done, and going back sends nothing`, () => {
    const h = build([HASTE_CARD]);
    show(h);
    ui.click({ btn, p: A });
    ui.click({ btn: cancel });
    assert.deepEqual(ui.actions(), [], 'Go back sends nothing');
    assert.ok(ui.has({ btn, p: A }), 'and the Done button is back');
    ui.click({ btn, p: A });
    ui.click({ btn: confirm });
    assert.deepEqual(ui.actions(), [{ type: done, seat: A }], 'the second click is the Done');
  });

  test(`${step}: Enter on Done asks too, and a second Enter does not get through`, () => {
    const h = build([HASTE_CARD]);
    show(h);
    ui.sent();
    ui.key('Enter');
    assert.deepEqual(ui.actions(), [], 'Enter sent nothing');
    assert.ok(ui.has({ btn: confirm }), 'Enter raised the same confirm');
    ui.key('Enter');
    assert.deepEqual(ui.actions(), [], 'a reflex second Enter is not the way through');
    ui.key('Escape');
    assert.ok(ui.has({ btn, p: A }), 'Escape is Go back');
  });

  test(`${step}: after one play Done goes at once, button and Enter`, () => {
    for (const how of ['click', 'Enter'] as const) {
      const h = build([HASTE_CARD, HASTE_CARD]);
      show(h);
      ui.sent();
      ui.click({ act: 'hand', p: A, i: 0 });
      const sent = ui.actions();
      assert.equal(sent.length, 1, `the play went out: ${JSON.stringify(sent)}`);
      h.do(sent[0]!);
      while (h.state.decision?.seat === A) h.do({ type: 'decide', seat: A, choice: 0 });
      assert.ok(plays(h).length, 'the premise: the second copy is still playable');
      refresh(h);
      if (how === 'click') ui.click({ btn, p: A }); else ui.key('Enter');
      assert.deepEqual(ui.actions(), [{ type: done, seat: A }], `${how}: Done went straight out`);
      assert.equal(ui.has({ btn: confirm }), false, 'and no confirm was raised');
    }
  });

  test(`${step}: with nothing on offer Done goes at once`, () => {
    const h = build([]);
    assert.deepEqual(plays(h), [], 'the premise: nothing to play');
    store.setItem('algoBluffHaste', '1');   // the haste step would otherwise ready itself
    try {
      show(h);
      ui.sent();
      ui.click({ btn, p: A });
      assert.deepEqual(ui.actions(), [{ type: done, seat: A }]);
    } finally { store.setItem('algoBluffHaste', ''); }
  });
}

test('deployment: a play that was refused or undone does not count as acting', () => {
  const h = deploy([HASTE_CARD]);
  show(h);
  ui.sent();
  ui.click({ act: 'hand', p: A, i: 0 });
  assert.equal(ui.actions().length, 1, 'the play went out');
  ui.push({ t: 'error', msg: 'refused' });
  refresh(h);   // the same state comes back: nothing happened
  ui.click({ btn: 'donedeploy', p: A });
  assert.deepEqual(ui.actions(), [], 'still asks');
  assert.ok(ui.has({ btn: 'deployconfirm' }));
  ui.click({ btn: 'deploycancel' });

  // undone: the play lands, then the undo puts the state from before it back
  const before = structuredClone(h.state);
  ui.click({ act: 'hand', p: A, i: 0 });
  h.do(ui.actions()[0]!);
  refresh(h);
  ui.click({ btn: 'donedeploy', p: A });
  assert.deepEqual(ui.actions(), [{ type: 'doneDeploying', seat: A }], 'the landed play counted');
  h.state = before;
  refresh(h);
  ui.click({ btn: 'donedeploy', p: A });
  assert.deepEqual(ui.actions(), [], 'after the undo it asks again');
  assert.ok(ui.has({ btn: 'deployconfirm' }), 'with the confirm, not a swallowed click');
});

test('deployment: the cache question and the idle one are one bar, and the cache one wins', () => {
  const h = deploy([HASTE_CARD]);
  h.state.players[A]!.cache = [{ card: HASTE_CARD, uid: 91900, playableUntilTurn: h.state.turn }];
  assert.ok(legal(h, A).some(a => a.type === 'playCached'), 'the premise: the cached card is playable');
  show(h);
  ui.sent();
  const html = ui.click({ btn: 'donedeploy', p: A });
  assert.deepEqual(ui.actions(), []);
  assert.equal(bars(html), 1, 'one bar');
  assert.match(html, /from your cache/, 'the cache question, naming the card');
  assert.doesNotMatch(html, /you have not played anything/, 'not both questions');
  ui.click({ btn: 'deployconfirm' });
  assert.deepEqual(ui.actions(), [{ type: 'doneDeploying', seat: A }]);

  // and having acted does not silence the cache's question — it never depended on that
  const h2 = deploy([HASTE_CARD, HASTE_CARD], 51901);
  h2.state.players[A]!.cache = [{ card: HASTE_CARD, uid: 91901, playableUntilTurn: h2.state.turn }];
  show(h2);
  ui.sent();
  ui.click({ act: 'hand', p: A, i: 0 });
  h2.do(ui.actions()[0]!);
  refresh(h2);
  ui.click({ btn: 'donedeploy', p: A });
  assert.deepEqual(ui.actions(), [], 'the cache still asks after a play');
  assert.match(ui.html(), /from your cache/);
});
