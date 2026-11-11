/* 1223 — THE SIDEBOARDING TABLE LAYS THE DECK OUT AS ITS OWNER DID (BL-55,
 * doneWhen 2).
 *
 * Between Competitive games the deck sat on the table in piles by cost
 * (pages/match.ts deckPiles: seedPiles(main, 'cost')) whatever the player had
 * built on the tabletop. The match payload now carries the registered deck's
 * piles (`mine.piles`, server test 1222), and the table draws them:
 *
 *   §1 matchPiles, pure: no arrangement → by cost, as before; an arrangement →
 *      its piles, its order, every copy; a copy sideboarded out leaves the LAST
 *      pile holding it, and coming back puts it back where it was; a card
 *      brought in joins its name's pile, else "New"; a pile emptied away is
 *      not drawn unless it was named
 *   §2 through the real client with the server's payload: the main zone shows
 *      the owner's piles in the owner's order; a tap out and back restores
 *      them; with no `piles` the table is by cost
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { seedPiles, type DeckPile } from '../deckarrange.ts';
import { matchPiles } from '../pages/match.ts';
import { client } from './ui-driver.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 24);
const MAIN = N.slice(0, 15).flatMap(n => [n, n]);   // 30
const SIDE = N.slice(15, 20);                        // 5 singles
/** the owner's layout: reversed, in two piles named by hand, N[7]'s copies split */
const PILES: DeckPile[] = [
  { id: 'p1', name: 'Finishers', cards: [...N.slice(8, 15).reverse().flatMap(n => [n, n]), N[7]!], named: true },
  { id: 'p2', name: 'Plan', cards: [N[7]!, ...N.slice(0, 7).flatMap(n => [n, n])] },
];
const shape = (piles: readonly DeckPile[]): Array<[string, string[]]> => piles.map(p => [p.name, p.cards]);

test('§1 matchPiles: the arrangement, kept through moves out and back', () => {
  assert.deepEqual(shape(matchPiles(MAIN, undefined)), shape(seedPiles(MAIN, 'cost')), 'never arranged: by cost');
  assert.deepEqual(shape(matchPiles(MAIN, [])), shape(seedPiles(MAIN, 'cost')), 'an empty arrangement is none');
  assert.deepEqual(shape(matchPiles(MAIN, PILES)), shape(PILES), 'the owner\'s piles, as laid out');

  // N[7] out once: off the LAST pile holding it (Plan), Finishers keeps its copy
  const out1 = MAIN.filter((_, i) => i !== MAIN.indexOf(N[7]!));
  const a = matchPiles(out1, PILES);
  assert.deepEqual(a.map(p => p.cards.filter(c => c === N[7]).length), [1, 0]);
  // and back: exactly as registered
  assert.deepEqual(shape(matchPiles(MAIN, PILES)), shape(PILES), 'back in, back in its place');

  // a sideboard card in for two copies of N[0]
  const swapped = [...MAIN.filter(c => c !== N[0]), SIDE[0]!];
  const b = matchPiles(swapped, PILES);
  assert.deepEqual(b.flatMap(p => p.cards).sort(), [...swapped].sort(), 'every copy on the table, no other card');
  assert.equal(b[0]!.name, 'New', 'a card the arrangement never held goes to New, at the front');
  assert.deepEqual(b[0]!.cards, [SIDE[0]]);

  // every copy of Plan out: the unnamed pile is not drawn; the named one is, empty
  const planOut = MAIN.filter(c => !PILES[1]!.cards.includes(c));
  assert.deepEqual(matchPiles(planOut, PILES).map(p => p.name), ['Finishers'], 'an emptied pile goes');
  const finishersOut = MAIN.filter(c => !PILES[0]!.cards.includes(c));
  assert.deepEqual(matchPiles(finishersOut, PILES).map(p => [p.name, p.cards.length]),
    [['Finishers', 0], ['Plan', 14]], 'a NAMED pile stays, empty, as on the builder');
});

const ui = await client();
const REG = { main: MAIN, side: SIDE };
const info = (mine: Record<string, unknown>): Record<string, unknown> => ({
  id: 'M1223', bestOf: 3, game: 2, score: [1, 0], names: ['Ann', 'Bo'],
  banks: [38 * 60_000, 41 * 60_000], clockStart: 45 * 60_000,
  phase: 'between', chooser: 1, initiative: null, until: Date.now() + 100_000, locked: false, ready: [false, true],
  mine,
});
const lobby = (mine: Record<string, unknown>, t = 'update'): string => ui.push({
  t, room: 'UIDRIVER', seat: 0, waiting: { have: [true, true], match: info(mine) }, peers: [true, true], names: ['Ann', 'Bo'],
});
/** the main zone's piles, as [header, cards] */
function tablePiles(html: string): Array<[string, string[]]> {
  const at = html.indexOf('data-cc-zone="main"');
  assert.ok(at >= 0, 'no main zone on screen');
  const zone = html.slice(at, html.indexOf('data-cc-zone="side"', at));
  return zone.split('<section class="ttpile').slice(1).map(s => [
    /class="ttpile(?:label|name)"[^>]*>([^<]*)</.exec(s)?.[1] ?? '?',
    [...s.matchAll(/data-card="([^"]+)"/g)].map(m => m[1]!),
  ]);
}

test('§2 the table draws the registered arrangement, and keeps it through a move out and back', () => {
  let html = lobby({ registered: REG, current: REG, piles: PILES }, 'joined');
  assert.deepEqual(tablePiles(html), shape(PILES), 'the owner\'s piles on the table');
  html = ui.click({ btn: 'cc-move', from: 'main', card: N[3]! });
  assert.deepEqual(tablePiles(html).map(([n, c]) => [n, c.length]), [['Finishers', 15], ['Plan', 14]], 'one out of Plan');
  html = ui.click({ btn: 'cc-move', from: 'side', card: N[3]! });
  assert.deepEqual(tablePiles(html), shape(PILES), 'back where it was');
});

test('§2 with no arrangement the table is by cost, as before', () => {
  const html = lobby({ registered: REG, current: REG });
  assert.deepEqual(tablePiles(html), shape(seedPiles(MAIN, 'cost')));
});
