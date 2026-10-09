/* 384 — ON TOUCH, A TAP ONLY READS (report #201, WUSC, 2026-10-08, filed
 * "gamebreaking"):
 *
 *   "The game forced me to play my card in battle when I was just trying to
 *    look at it. At the very least for mobile we need a better way to
 *    distinguish casting or playing a card vs trying to read or look at it. I
 *    lost because the game forced me to play a card when it did literally
 *    nothing and would have worked well later."
 *
 * The cause: a tap is a click, and a click on a hand card with exactly ONE
 * legal action fires it (main.ts offer → planOffer 'go'). The owner's answer:
 * on touch, a tap only reads; drag plays. Desktop clicks are unchanged.
 *
 * Driven through the real client (test/ui-driver.ts): the finger is a
 * pointerdown/pointerup of type `touch` and the click the browser makes of
 * them, through main.ts's and ui/touch.ts's own listeners. What the driver
 * CANNOT show is the zoom itself (it lays nothing out, so a copy never goes
 * up) or a drag (pointer capture, elementFromPoint). Both were proved in
 * headless Chrome with real CDP touch input on the regions and the classic
 * board — a tap opened the zoom and sent nothing, the next tap put it away
 * and acted on nothing, a drag onto the table played the card, a drag in
 * planning opened the recycle menu. What is pinned HERE is the decision: what
 * a finger's tap may send, and that everything else still sends what it did.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { give, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Action, Decision, GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();
const me = 0 as Seat;

/** a mouse's press, so the next click is a mouse click again */
const mouse = (want: Record<string, string | number>): void => {
  ui.pointer('pointerdown', want, { pointerType: 'mouse', pointerId: 2, isPrimary: true });
};

/** a battle, a card in my hand, and that card's play the one legal action */
function battleWithACard(): { state: GameState; i: number; legal: Action[] } {
  const h = new Harness(38401);
  toDeployment(h);
  toNextBattle(h, me);
  assert.equal(h.state.phase, 'battle', 'the fixture is in battle, where the report was');
  const i = give(h, me, 'Fireball');
  return { state: h.state, i, legal: [{ type: 'playCard', seat: me, handIndex: i }] };
}

const preview = (): string =>
  String((globalThis as unknown as { document: { getElementById(id: string): { innerHTML?: unknown } | null } })
    .document.getElementById('preview')?.innerHTML ?? '');

test('§1 the control: a mouse click on the one playable card still plays it', () => {
  const { state, i, legal } = battleWithACard();
  ui.join(state, me, legal);
  ui.sent();
  mouse({ act: 'hand', p: me, i });
  ui.click({ act: 'hand', p: me, i });
  assert.deepEqual(ui.actions(), legal, 'one legal play, one click, played — the desktop is unchanged');
});

test('§2 a finger\'s tap on that card in battle sends nothing and opens no menu — it reads', () => {
  const { state, i, legal } = battleWithACard();
  ui.join(state, me, legal);
  ui.sent();
  const html = ui.tap({ act: 'hand', p: me, i });
  assert.deepEqual(ui.actions(), [], 'a tap must not play the card (report #201)');
  assert.doesNotMatch(html, /class="menu"/, 'nor offer a menu to play it from');
  // the rail still follows the tap, as it always did on touch — the card's
  // text is one look away in the rail as well as in the zoom
  ui.tick();
  assert.match(preview(), /Fireball/, 'the rail shows the tapped card');
});

test('§3 the same on every surface: deployment, and planning (no recycle menu)', () => {
  const h = new Harness(38402);
  toDeployment(h);
  const i = give(h, me, 'Fireball');
  const legal: Action[] = [{ type: 'playCard', seat: me, handIndex: i }];
  ui.join(h.state, me, legal);
  ui.sent();
  ui.tap({ act: 'hand', p: me, i });
  assert.deepEqual(ui.actions(), [], 'deployment: a tap does not play');

  const p = new Harness(38403);
  assert.equal(p.state.phase, 'planning');
  const j = give(p, me, 'Fireball');
  ui.join(p.state, me, [{ type: 'recycleForResource', seat: me, handIndex: j, element: 'fire' } as Action]);
  ui.sent();
  const html = ui.tap({ act: 'hand', p: me, i: j });
  assert.doesNotMatch(html, /Recycle →/, 'planning: a tap does not open the recycle menu (a drag onto the table does)');
  // …and the mouse still gets it
  mouse({ act: 'hand', p: me, i: j });
  assert.match(ui.click({ act: 'hand', p: me, i: j }), /Recycle →/, 'a mouse click still opens the recycle menu');
});

test('§4 a tap that ANSWERS a question still answers it: a hand card that is an option is picked', () => {
  const { state, i } = battleWithACard();
  const s = structuredClone(state);
  const card = s.players[me]!.hand[i]!;
  s.decision = {
    id: 9384, seat: me, kind: 'targets', prompt: 'discard a card',
    options: [{ label: card, value: { discard: i }, card }],
  } as Decision;
  ui.join(s, me, [{ type: 'decide', seat: me, choice: 0 }]);
  ui.sent();
  ui.tap({ act: 'hand', p: me, i });
  assert.deepEqual(ui.actions(), [{ type: 'decide', seat: me, choice: 0 }],
    'answering is not playing — the board pick still takes a finger');
});

test('§5 a cached card that is playable now: a tap reads it, a mouse click plays it', () => {
  const { state } = battleWithACard();
  const s = structuredClone(state);
  s.players[me]!.cache = [{ card: 'Fireball', uid: 777 }];
  const legal: Action[] = [{ type: 'playCached', seat: me, index: 0 } as Action];
  ui.join(s, me, legal);
  assert.ok(ui.has({ act: 'cache', p: me, i: 0 }), 'the cached card is drawn beside the hand, playable');
  ui.sent();
  ui.tap({ act: 'cache', p: me, i: 0 });
  assert.deepEqual(ui.actions(), [], 'a tap does not play a cached card either (R311: the cache plays like the hand)');
  mouse({ act: 'cache', p: me, i: 0 });
  ui.click({ act: 'cache', p: me, i: 0 });
  assert.deepEqual(ui.actions(), legal, 'a mouse click still does');
});

test('§6 it is the POINTER, not the device: a mouse after a finger plays again', () => {
  const { state, i, legal } = battleWithACard();
  ui.join(state, me, legal);
  ui.sent();
  ui.tap({ act: 'hand', p: me, i });
  assert.deepEqual(ui.actions(), []);
  mouse({ act: 'hand', p: me, i });
  ui.click({ act: 'hand', p: me, i });
  assert.deepEqual(ui.actions(), legal, 'a laptop with a touch screen still plays on a mouse click');
});
