/* BL-28 — "MAKE AN ACCOUNT RIGHT AFTER FINISHING PLAYING".
 *
 * The owner, 2026-08-25: "When live, no, you will not claim the games unless
 * you make an account right after finishing playing, in which case that
 * becomes your first tracked game." The server half (a single-use ticket per
 * signed-out seat, the window, no name sweeps) is guarded in
 * server/e2e/test-accounts.ts. This is the screen half, through the real
 * client (test/ui-driver.ts):
 *
 *   §1 a signed-out seat's post-game screen offers the sign-up, with the
 *      owner's password warning, and the browser keeps the ticket
 *   §2 no ticket, no offer; and a rejoin (whose payload never carries one)
 *      puts the kept ticket back for THIS room only
 *   §3 signing up sends the ticket with the name and password, and the
 *      screen then says the game is on the profile
 *
 * Seeds 63800-63899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';

const g = globalThis as unknown as Record<string, unknown>;
const POSTS: { url: string; body: Record<string, unknown> }[] = [];
g['__UI_DRIVER_FETCH'] = (url: string, init?: { body?: string }) => {
  if (url === '/api/auth/register') {
    const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
    POSTS.push({ url, body });
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({
        ok: true, token: 'tok-638', claimed: body['claim'] === 'T-GOOD' ? 1 : 0,
        me: { id: 'u638', username: String(body['username']), history: [], profile: {} },
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
const LATER = Date.now() + 30 * 60_000;

function over(seed: number, payload: Record<string, unknown>): string {
  const s = board(seed);
  ui.join(viewFor(s, SEAT), SEAT, legalActions(s, SEAT));
  ui.sent();
  return ui.push({ t: 'gameover', ...payload });
}
const kept = (): { ticket?: string; room?: string } | null =>
  JSON.parse((g['localStorage'] as Storage).getItem('algoSignupClaim') ?? 'null');

test('BL-28 §1 a signed-out seat is offered the sign-up for the game just played', () => {
  const html = over(63800, { ...OVER, signup: { ticket: 'T-ONE', until: LATER } });
  assert.match(html, /data-btn="pg-signup"/, 'the offer is on the post-game screen');
  assert.match(html, /Keep this game\?/);
  assert.match(html, /DO NOT FORGET YOUR PASSWORD\. THERE IS NO PASSWORD RESET\./,
    'it creates an account, so it carries the owner warning');
  assert.match(html, /<button type="button" class="primary" data-btn="pg-signup">/,
    'a plain button: a submit button in a form would GET this page with the password in the address');
  assert.deepEqual(kept(), { ticket: 'T-ONE', until: LATER, room: 'UIDRIVER' }, 'the browser keeps the ticket, for this room');
});

test('BL-28 §2 no ticket means no offer, and a rejoin puts the kept one back for this room only', () => {
  (g['localStorage'] as Storage).removeItem('algoSignupClaim');
  assert.doesNotMatch(over(63801, OVER), /pg-signup/, 'a seat the server offered nothing gets nothing');
  over(63802, { ...OVER, signup: { ticket: 'T-TWO', until: LATER } });
  // a refresh: the rejoin payload carries no ticket
  assert.match(over(63803, OVER), /data-btn="pg-signup"/, 'the kept ticket is put back after a refresh');
  // …but only for the room it was issued in
  (g['localStorage'] as Storage).setItem('algoSignupClaim', JSON.stringify({ ticket: 'T-X', until: LATER, room: 'ELSE' }));
  assert.doesNotMatch(over(63804, OVER), /pg-signup/, 'another room ticket is not offered here');
  // …and not once it has run out
  (g['localStorage'] as Storage).setItem('algoSignupClaim', JSON.stringify({ ticket: 'T-OLD', until: Date.now() - 1, room: 'UIDRIVER' }));
  assert.doesNotMatch(over(63805, OVER), /pg-signup/, 'an expired ticket is not offered');
});

test('BL-28 §3 signing up sends the ticket, and the screen says the game is on the profile', async () => {
  over(63806, { ...OVER, signup: { ticket: 'T-GOOD', until: LATER } });
  ui.type('pg-su-user', 'Newbie');
  ui.type('pg-su-pass', 'a good password');
  ui.click({ btn: 'pg-signup' });
  await flush();
  assert.equal(POSTS.length, 1, 'one registration');
  assert.deepEqual(POSTS[0]!.body, { username: 'Newbie', password: 'a good password', claim: 'T-GOOD' },
    'the name, the password and the ticket for this game');
  // the next paint of the board (the browser also swaps the form at once)
  const html = ui.push({ t: 'rematch', rematch: [false, false], room: null });
  assert.match(html, /Signed up — this game is the first one on your profile\./, 'the screen says what happened');
  assert.doesNotMatch(html, /data-btn="pg-signup"/, 'and the form is gone');
  assert.equal(kept(), null, 'the spent ticket is forgotten');
  assert.equal((g['localStorage'] as Storage).getItem('algoToken'), 'tok-638', 'and the browser is signed in');
});
