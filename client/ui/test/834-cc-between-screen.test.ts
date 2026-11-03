/* docs/22 §5.4 — THE BETWEEN SCREEN of a Competitive match (ui/match.ts),
 * driven through the real client with the server's own payload shape
 * (server/match.ts matchLobbyInfo).
 *
 * Since 2026-11-03 (owner: "I wanted something like MTGO. Your deck laid out
 * below, on the table … then the sideboard above") the screen is a card table:
 * the deck as the tabletop's piles, the sideboard as a row of cards, each a
 * zone (`data-cc-zone`). The chip lists these sections used to read are gone;
 * what they assert is unchanged. 1060–1062 hold the table itself.
 *
 *   §1 the header: the format, the score from this seat's side, both frozen
 *      clocks and the countdown
 *   §2 ONE TAP MOVES ONE COPY across, by mouse or by finger; the in-between
 *      illegal deck says why in the legality line, Ready is disabled, and
 *      nothing is sent until the deck is legal again — then the config is
 *   §3 one tap back to the registered deck — an ordinary config. (Saved swap
 *      presets were taken out on 2026-11-03, owner: "rip it out for now".)
 *   §4 the opponent is a ready dot and a name: their deck is never drawn
 *   §5 the winner's Ready carries no initiative
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { client } from './ui-driver.ts';

const ui = await client();

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 24);
const MAIN = N.slice(0, 15).flatMap(n => [n, n]);   // 30
const SIDE = N.slice(15, 22);                        // 7 singles
const UNTIL = Date.now() + 100_000;
const info = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'M834', bestOf: 3, game: 2, score: [1, 0], names: ['Ann', 'Bo'],
  banks: [38 * 60_000, 41 * 60_000 + 5_000], clockStart: 45 * 60_000,
  phase: 'between', chooser: 1, initiative: null, until: UNTIL, locked: false, ready: [false, false],
  mine: {
    registered: { main: MAIN, side: SIDE }, current: { main: MAIN, side: SIDE },
  },
  ...over,
});
const lobby = (over: Record<string, unknown> = {}, t = 'update'): string => ui.push({
  t, room: 'UIDRIVER', seat: 0, waiting: { have: [true, true], match: info(over) }, peers: [true, true], names: ['Ann', 'Bo'],
});
const cc = (): Record<string, unknown>[] => ui.sent().filter(m => m['t'] === 'cc');
/** a zone of the table: the sideboard's row runs to the deck, the deck's piles to the bottom bar */
const board = (html: string, which: 'Main' | 'Sideboard'): string => {
  const at = html.indexOf(`data-cc-zone="${which === 'Main' ? 'main' : 'side'}"`);
  assert.ok(at >= 0, `no ${which} zone on screen`);
  return html.slice(at, html.indexOf(which === 'Main' ? '<footer' : 'data-cc-zone="main"', at));
};
const readyBtn = (html: string): string => /<button data-btn="cc-ready"[^>]*>Ready<\/button>/.exec(html)?.[0] ?? '';

lobby({}, 'joined');
ui.sent();

test('§1 the header: format, score, both frozen clocks, the countdown', () => {
  const html = ui.html();
  assert.match(html, /Competitive — Best of 3 — room <span class="roomcode">UIDRIVER<\/span>/);
  assert.match(html, /Game 2 of 3 — you lead 1–0/);
  assert.match(html, /Your clock <b>38:00<\/b> · Bo <b>41:05<\/b>/);
  assert.match(html, /of 45:00/);
  assert.match(html, new RegExp(`data-cc-until="${UNTIL}">1:[34]\\d</span> to sideboard`));
});

test('§2 one tap moves one copy; an illegal deck is not sent and Ready waits', () => {
  let html = ui.click({ btn: 'cc-move', from: 'main', card: N[0]! });
  assert.match(board(html, 'Main'), /<b>Deck<\/b> <span class="ttpilecount bad">29<\/span>/);
  assert.match(html, /Main deck needs 30 — you have 29\./, 'the legality line says why');
  assert.match(readyBtn(html), /disabled/, 'Ready is disabled while the deck is illegal');
  assert.deepEqual(cc(), [], 'an illegal configuration never goes to the server');
  assert.match(board(html, 'Sideboard'), new RegExp(`${N[0]}`), 'the copy is in the sideboard');
  assert.match(board(html, 'Sideboard'), /8\/7/);
  // …and back the other way, by finger: a side card into the main deck
  html = ui.tap({ btn: 'cc-move', from: 'side', card: N[15]! });
  assert.doesNotMatch(html, /cclegal/, 'legal again: no legality line');
  assert.doesNotMatch(readyBtn(html), /disabled/, 'Ready is back');
  const sent = cc();
  assert.equal(sent.length, 1, 'the legal configuration went out');
  assert.equal(sent[0]!['op'], 'config');
  assert.equal((sent[0]!['main'] as string[]).length, 30);
  assert.ok((sent[0]!['main'] as string[]).includes(N[15]!) && (sent[0]!['side'] as string[]).includes(N[0]!));
  // the server holds it now: its push of the same deck ends the draft quietly
  html = lobby({ mine: { ...(info()['mine'] as object), current: { main: sent[0]!['main'], side: sent[0]!['side'] } } });
  assert.match(board(html, 'Main'), new RegExp(`${N[15]}`));
});

test('§3 one tap back to the registered deck, sent as an ordinary config', () => {
  const html = ui.html();
  assert.doesNotMatch(html, /cc-preset/, 'no saved swaps');
  assert.match(html, /<button data-btn="cc-reset" >Back to the registered deck<\/button>/, 'moved away from it: offered');
  ui.click({ btn: 'cc-reset' });
  assert.deepEqual(cc(), [{ t: 'cc', op: 'config', main: MAIN, side: SIDE }]);
  const back = lobby();
  assert.match(back, /<button data-btn="cc-reset" disabled>Back to the registered deck<\/button>/, 'there already: off');
});

test('§4 the opponent is a ready dot and a name, never a deck', () => {
  let html = lobby();
  assert.equal((html.match(/data-cc-zone="/g) ?? []).length, 2, 'two zones, both mine');
  assert.match(html, /<i class="seatdot"><\/i>\s*<span>Bo<\/span>/, 'not ready: a plain dot');
  html = lobby({ ready: [false, true] });
  assert.match(html, /<i class="seatdot ready"><\/i>\s*<span>Bo — ready<\/span>/);
  ui.push({ t: 'update', waiting: { have: [true, true], match: info({ ready: [false, true] }) }, peers: [true, false] });
  assert.match(ui.html(), /seatdot ready/, 'ready stays ready with the opponent away');
});

test('§5 the winner has one Ready, and it carries no initiative', () => {
  const html = lobby();
  assert.equal((html.match(/data-btn="cc-ready"/g) ?? []).length, 1);
  assert.match(html, /Bo is choosing who takes the initiative…/);
  ui.click({ btn: 'cc-ready' });
  assert.deepEqual(cc(), [{ t: 'cc', op: 'ready', ready: true }]);
  const after = lobby({ ready: [true, false], initiative: 1 });
  assert.match(after, /Bo takes the initiative\./, 'the choice is public once made');
  assert.match(after, /<b class="lockedin">Ready ✓<\/b>/);
  ui.click({ btn: 'cc-ready', ready: '0' });
  assert.deepEqual(cc(), [{ t: 'cc', op: 'ready', ready: false }], 'and un-ready');
});
