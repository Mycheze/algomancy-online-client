/* docs/21 — Watch: a closed week's run in the BL-38 replay viewer, at
 * `?challenge=watch&run=<id>`, dealt the challenge's own game.
 *
 *   §1 the viewer never shows a seat's live prompt. A constructed game opens
 *      on the draw phase's put-two-on-the-bottom step, and the dialog for it
 *      used to cover the replay's controls (and eat the first click) — for
 *      EVERY constructed replay and live spectator, not just a challenge's:
 *      `bottomSeat`/`draftSeat` in main.ts answered for NET's seat without
 *      asking whether this client has one
 *   §2 × goes back to the challenge page, on that week's board — not home
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import { newChallengeGame, type ChallengeDef } from '../../engine/src/challenge.ts';

const DEF: ChallengeDef = { id: 'w508', week: '2026-10-11', title: 'Watched', blurb: '', goal: { kind: 'unitsPlayed', n: 1 }, seed: 50800 };
const UNIT = DECK_LIST.find(n => getCard(n).kind === 'unit')!;
const DECK = Array.from({ length: 12 }, () => UNIT);
// the deal's own head: the dummy finishing its planning — the board then
// waits on the player's bottom step, which is exactly the moment in question
const ACTIONS = newChallengeGame(DEF, DECK).actions;

const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '?challenge=watch&run=run508';
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url.startsWith('/api/challenge/run/')) {
    return { status: 200, json: async () => ({ runId: 'run508', challengeId: DEF.id, name: 'Ann', deck: DECK, actions: ACTIONS, score: {}, at: 1 }) };
  }
  if (url === '/api/challenge') {
    return { status: 200, json: async () => ({ now: 1, current: null, past: [{ ...DEF, opens: 0, closes: 1, closed: true, entrants: 1 }] }) };
  }
  return new Promise(() => {});
};
// the shape of the replay client; home() because this route is not `?replay=`
const { home } = await import('./ui-driver.ts');

test('§1 a replay of a constructed game shows no draw-phase dialog', async () => {
  // the driver's setTimeout never fires on its own: settle on microtasks
  for (let i = 0; i < 40; i++) await Promise.resolve();
  const ui = home();
  const html = ui.html();
  assert.match(html, /class="replayroom">Watched</, 'non-vacuous: the replay is open');
  assert.match(html, /PLAN/i, 'non-vacuous: on the planning step');
  assert.doesNotMatch(html, /draw phase/, 'no seat prompt in a replay');
  assert.doesNotMatch(html, /data-btn="bottomcommit"/);
  assert.doesNotMatch(html, /data-btn="pickhide"/);
});

test('§2 closing the replay returns to that week on the challenge page', () => {
  const ui = home();
  ui.click({ replay: 'close' });
  assert.equal((globalThis as unknown as { location: { search: string } }).location.search, `?challenge=1&board=${DEF.id}`);
});
