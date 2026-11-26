/* 1533 — THE POST-GAME SIGN-UP, WHEN THE NAME WAS ALREADY YOURS.
 *
 * The server signs a name's owner in from the sign-up form (server/test/1532)
 * and says so with `signedIn`. The post-game screen then says "Signed in",
 * not "Signed up", and does not promise the game it did not keep.
 *
 * Seeds 153300-153399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_FETCH'] = (url: string, init?: { body?: string }) => {
  if (url === '/api/auth/register') {
    const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({
        ok: true, token: 'tok-1533', claimed: 0, signedIn: true,
        me: { id: 'u1533', username: String(body['username']), history: [], profile: {} },
      }),
    });
  }
  return new Promise(() => {});
};
const { client } = await import('./ui-driver.ts');
const ui = await client();
const SEAT: Seat = 0;
const board = (seed: number): GameState => new Harness(seed).state;
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

const seatStats = (name: string): Record<string, unknown> => ({
  name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 30,
});
const OVER = {
  seat: 0, winner: 0, names: ['Ann', 'Bo'], mode: 'draft', els: ['fire', 'water', 'earth'],
  turns: 6, seats: [seatStats('Ann'), seatStats('Bo')],
  rematch: [false, false], rematchRoom: null, recorded: false,
};

test('post-game sign-up with a name already yours: the screen says signed in, not signed up', async () => {
  const s = board(153300);
  ui.join(viewFor(s, SEAT), SEAT, legalActions(s, SEAT));
  ui.sent();
  const offered = ui.push({ t: 'gameover', ...OVER, signup: { ticket: 'T-MINE', until: Date.now() + 30 * 60_000 } });
  assert.match(offered, /data-btn="pg-signup"/, 'the offer is there');
  ui.type('pg-su-user', 'Oweneth');
  ui.type('pg-su-pass', 'my real password');
  ui.click({ btn: 'pg-signup' });
  await flush();
  const html = ui.push({ t: 'rematch', rematch: [false, false], room: null });
  assert.match(html, /Signed in — that account was already yours\./, 'it says what happened');
  assert.doesNotMatch(html, /Signed up/, 'and not that an account was made');
  assert.doesNotMatch(html, /data-btn="pg-signup"/, 'the form is gone');
  assert.equal((g['localStorage'] as Storage).getItem('algoToken'), 'tok-1533', 'the browser is signed in');
});
