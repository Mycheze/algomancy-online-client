/* BL-48 — "DISPUTE GAME", BESIDE REMATCH, ON THE POST-GAME SCREEN.
 *
 * Report #231: the loser of a league game wanted to be able to give the win
 * back "if you ended up winning due to a bug". The owner, 2026-10-21: "Maybe
 * just a 'dispute game' button right on the final screen, by 'rematch'".
 *
 * Driven through the real client (test/ui-driver.ts): the server's post-game
 * payload goes in, the markup and the wire come out.
 *
 *   §1 the button sits beside Rematch when the server says the game can be
 *      disputed, and nowhere else (a scenario or test-mode room's payload
 *      does not say so, and Learn to Play has no server at all)
 *   §2 it opens the report form as a dispute: one required note, no kinds
 *   §3 Send puts the note on the game's socket; the server's answer closes
 *      the form and the button turns into "Disputed"
 *   §4 a refusal stays on the form with the server's reason
 *   §5 the other seat's dispute is said on the screen
 *
 * Seeds 52100-52199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import { postGameHtml, type GameOver } from '../postgame.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();
const SEAT: Seat = 0;
const board = (seed: number): GameState => new Harness(seed).state;
const join = (s: GameState): string => ui.join(viewFor(s, SEAT), SEAT, legalActions(s, SEAT));

const seatStats = (name: string): Record<string, unknown> => ({
  name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 30,
});
const OVER = {
  seat: 0, winner: 0, names: ['Ann', 'Bo'], mode: 'draft', els: ['fire', 'water', 'earth'],
  turns: 6, seats: [seatStats('Ann'), seatStats('Bo')],
  rematch: [false, false], rematchRoom: null, recorded: true,
};
const DISPUTABLE = { ...OVER, disputable: true, disputed: [false, false] };

/** the post-game screen's row of buttons, in order, as their data-btn (or their text when disabled) */
function buttons(html: string): string[] {
  const row = /<div class="pgbtns">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(row, 'the post-game screen is up');
  return [...row[1]!.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)]
    .map(m => /data-btn="([^"]+)"/.exec(m[1]!)?.[1] ?? m[2]!.replace(/<[^>]*>/g, '').trim());
}

/** a fresh board and its post-game screen */
function over(seed: number, payload: Record<string, unknown>): string {
  join(board(seed));
  if (ui.has({ report: 'close' })) ui.click({ report: 'close' });
  ui.sent();
  return ui.push({ t: 'gameover', ...payload });
}

test('§1 the button sits beside Rematch where the game can be disputed, and nowhere else', () => {
  const html = over(52100, DISPUTABLE);
  assert.deepEqual(buttons(html).slice(0, 2), ['pg-rematch', 'pg-dispute'], 'Dispute game is right after Rematch');
  assert.match(html, /data-btn="pg-dispute">Dispute game<\/button>/);
  // the payload of a scenario or test-mode room carries no `disputable`
  assert.ok(!buttons(over(52101, OVER)).includes('pg-dispute'), 'no button where the server does not offer it');
  // pure markup: the same rule, without the client around it
  assert.doesNotMatch(postGameHtml(OVER as unknown as GameOver), /pg-dispute|Disputed/);
  assert.match(postGameHtml({ ...DISPUTABLE, disputed: [true, false] } as unknown as GameOver), /<button disabled>Disputed<\/button>/,
    'once disputed, it says so and does nothing');
  assert.doesNotMatch(postGameHtml({ ...DISPUTABLE, disputed: [true, false] } as unknown as GameOver), /pg-dispute/);
  // the other seat sees its own button, not ours
  assert.match(postGameHtml({ ...DISPUTABLE, seat: 1, disputed: [true, false] } as unknown as GameOver), /data-btn="pg-dispute"/);
});

test('§2 it opens the report form as a dispute: one required note, no kinds to pick', () => {
  over(52102, DISPUTABLE);
  const html = ui.click({ btn: 'pg-dispute' });
  assert.match(html, /<h3>Dispute game<\/h3>/, 'the form is up, titled as a dispute');
  assert.match(html, /placeholder="What went wrong\?"/);
  assert.doesNotMatch(html, /data-report="kind"/, 'no kind buttons: a dispute is "the outcome was wrong"');
  assert.doesNotMatch(html, /data-report="severity"/);
  assert.match(html, /data-report="send" disabled/, 'Send waits for a note');
  ui.type('report-note', '   ');
  ui.click({ report: 'send' });
  assert.equal(ui.sent().filter(m => m['t'] === 'dispute').length, 0, 'a blank note sends nothing');
  ui.click({ report: 'close' });
  assert.ok(!ui.has({ report: 'send' }), 'Cancel closes it');
  assert.ok(ui.has({ btn: 'pg-dispute' }), 'and the button is still there');
});

test('§3 Send puts the note on the socket; the answer closes the form and the button says Disputed', () => {
  over(52103, DISPUTABLE);
  ui.click({ btn: 'pg-dispute' });
  ui.type('report-note', 'I won because Bo\'s blocker vanished');
  const busy = ui.click({ report: 'send' });
  const wire = ui.sent().filter(m => m['t'] === 'dispute');
  assert.deepEqual(wire, [{ t: 'dispute', note: 'I won because Bo\'s blocker vanished' }], 'one dispute on the game\'s socket');
  assert.match(busy, /sending…/, 'the form waits for the server');
  const html = ui.push({ t: 'dispute', disputed: [true, false] });
  assert.ok(!ui.has({ report: 'send' }), 'the server\'s answer closes the form');
  assert.match(html, /dispute sent/, 'with a toast');
  assert.ok(buttons(html).includes('Disputed'), 'the button now says Disputed');
  assert.ok(!ui.has({ btn: 'pg-dispute' }), 'and cannot be pressed again');
});

test('§4 a refusal stays on the form with the reason from the server', () => {
  over(52104, DISPUTABLE);
  ui.click({ btn: 'pg-dispute' });
  ui.type('report-note', 'bugged');
  ui.click({ report: 'send' });
  const html = ui.push({ t: 'disputeerr', msg: 'you have already disputed this game' });
  assert.ok(ui.has({ report: 'send' }), 'the form stays up');
  assert.match(html, /class="reporterror">you have already disputed this game</);
  ui.click({ report: 'close' });
});

test('§5 the other seat disputing is said on the screen', () => {
  over(52105, DISPUTABLE);
  const html = ui.push({ t: 'dispute', disputed: [false, true] });
  assert.match(html, /Bo disputed this result\./);
  assert.ok(ui.has({ btn: 'pg-dispute' }), 'our own button is still there');
  assert.ok(!ui.has({ report: 'send' }), 'and no form opened');
});
