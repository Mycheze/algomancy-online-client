/* 1063 — THE SIDEBOARDING TABLE: A CARD GOES ACROSS BY TAP AND BY DROP.
 *
 * Owner, 2026-11-03, on the chip list the between screen had been: "I wanted
 * something like MTGO. Your deck laid out below, on the table we spent so
 * much time building, then the sideboard above and you slide cards in and
 * out." So the between screen is a table (pages/match.ts sideboardTableHtml):
 * the deck as the tabletop's piles (`data-cc-zone="main"`), the sideboard as a
 * row of cards above it (`data-cc-zone="side"`). A card moves by one tap —
 * mouse or finger — and by a drag (ui/drag.ts, ui/match.ts sideboardDrag),
 * whose drop is the tap's own `moveCopy`.
 *
 *   §1 a mouse click on a deck card puts that copy in the sideboard; a finger's
 *      tap on a sideboard card puts it back in the deck
 *   §2 a DROP does the same: the provider picks up a card of the table (and
 *      nothing else), lights only the OTHER zone, and its drop lands the copy
 *      there — the same config the tap sends
 *   §3 every card is a scan on the table (the tabletop's own markup), and the
 *      deck is laid out as piles by cost
 *
 * Driven through the real client (ui-driver.ts) with the server's payload shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { client, elementFor } from './ui-driver.ts';
import { sideboardDrag } from '../match.ts';

const ui = await client();

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 24);
const MAIN = N.slice(0, 15).flatMap(n => [n, n]);   // 30
const SIDE = N.slice(15, 21);                        // 6 singles
const info = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'M1060', bestOf: 3, game: 2, score: [1, 0], names: ['Ann', 'Bo'],
  banks: [38 * 60_000, 41 * 60_000], clockStart: 45 * 60_000,
  phase: 'between', chooser: 1, initiative: null, until: Date.now() + 100_000, locked: false, ready: [false, false],
  mine: { registered: { main: MAIN, side: SIDE }, current: { main: MAIN, side: SIDE } },
  ...over,
});
const lobby = (over: Record<string, unknown> = {}, t = 'update'): string => ui.push({
  t, room: 'UIDRIVER', seat: 0, waiting: { have: [true, true], match: info(over) }, peers: [true, true], names: ['Ann', 'Bo'],
});
const cc = (): Record<string, unknown>[] => ui.sent().filter(m => m['t'] === 'cc');

/** the card names drawn in a zone of the table */
function zoneCards(html: string, z: 'main' | 'side'): string[] {
  const at = html.indexOf(`data-cc-zone="${z}"`);
  assert.ok(at >= 0, `no ${z} zone on screen`);
  const end = html.indexOf(z === 'main' ? '<footer' : 'data-cc-zone="main"', at);
  return [...html.slice(at, end).matchAll(/data-card="([^"]+)"/g)].map(m => m[1]!);
}
const count = (l: string[], n: string): number => l.filter(x => x === n).length;

lobby({}, 'joined');
ui.sent();

test('§1 a click moves a deck card to the sideboard, a finger\'s tap moves it back', () => {
  let html = ui.html();
  assert.equal(zoneCards(html, 'main').length, 30);
  assert.equal(zoneCards(html, 'side').length, 6);
  html = ui.click({ btn: 'cc-move', from: 'main', card: N[0]! });
  assert.equal(count(zoneCards(html, 'main'), N[0]!), 1, 'one copy left the deck');
  assert.equal(count(zoneCards(html, 'side'), N[0]!), 1, '…and is in the sideboard');
  assert.deepEqual(cc(), [], 'a 29-card deck is not sent');
  html = ui.tap({ btn: 'cc-move', from: 'side', card: N[15]! });
  assert.equal(count(zoneCards(html, 'side'), N[15]!), 0, 'the side card left the sideboard');
  assert.equal(count(zoneCards(html, 'main'), N[15]!), 1, '…and is in the deck');
  const sent = cc();
  assert.equal(sent.length, 1, 'legal again: the config went out');
  // the server holds it now
  lobby({ mine: { registered: { main: MAIN, side: SIDE }, current: { main: sent[0]!['main'], side: sent[0]!['side'] } } });
});

test('§2 a drop is the tap\'s own move: a card of the table, the other zone lit, the copy lands there', () => {
  let html = ui.html();
  const src = elementFor(html, { btn: 'cc-move', from: 'main', card: N[1]! }) as unknown as HTMLElement;
  assert.equal(sideboardDrag.sourceOf(src), src, 'a deck card is picked up');
  // nothing outside the table is: the score line, a bar button
  assert.equal(sideboardDrag.sourceOf(elementFor(html, { btn: 'cc-reset' }) as unknown as Element), null);
  const plan = sideboardDrag.plan(src);
  assert.ok(plan, 'it may be dragged while the window is open');
  assert.deepEqual(plan!.targets, [], 'no targets lit up front (the tabletop\'s rule)');
  const sideCard = elementFor(html, { btn: 'cc-move', from: 'side', card: N[16]! }) as unknown as Element;
  const otherDeck = elementFor(html, { btn: 'cc-move', from: 'main', card: N[2]! }) as unknown as Element;
  const zone = plan!.zoneAt(sideCard) as HTMLElement | null;
  assert.equal(zone?.dataset['ccZone'], 'side', 'over the sideboard: the sideboard is the zone');
  assert.equal(plan!.zoneAt(otherDeck), null, 'over its own zone: nowhere to drop (it flies home)');
  assert.equal(plan!.zoneAt(elementFor(html, { btn: 'cc-reset' }) as unknown as Element), null, 'off the table: nowhere');
  assert.equal(plan!.drop(zone!, 0, 0), true, 'the drop is taken');
  html = ui.html();
  assert.equal(count(zoneCards(html, 'side'), N[1]!), 1, 'the dropped copy is in the sideboard');
  assert.equal(count(zoneCards(html, 'main'), N[1]!), 1, '…one copy left in the deck');
  assert.deepEqual(cc(), [], '29 cards: not sent, as by tap');
  // and back the other way, by drop
  const back = elementFor(html, { btn: 'cc-move', from: 'side', card: N[1]! }) as unknown as HTMLElement;
  const plan2 = sideboardDrag.plan(back)!;
  const deckZone = plan2.zoneAt(elementFor(html, { btn: 'cc-move', from: 'main', card: N[3]! }) as unknown as Element);
  assert.equal((deckZone as HTMLElement | null)?.dataset['ccZone'], 'main');
  assert.equal(plan2.drop(deckZone!, 0, 0), true);
  const sent = cc();
  assert.equal(sent.length, 1, 'legal again: sent, exactly as a tap would');
  assert.equal(count(sent[0]!['main'] as string[], N[1]!), 2);
});

test('§2b no drag once the window has locked, or when the move would do nothing', () => {
  let html = lobby({ locked: true, until: null });
  assert.doesNotMatch(html, /data-btn="cc-move"/, 'locked: the cards take no tap');
  html = lobby();
  const src = elementFor(html, { btn: 'cc-move', from: 'main', card: N[4]! }) as unknown as HTMLElement;
  lobby({ locked: true, until: null });
  assert.equal(sideboardDrag.plan(src), null, 'a press that crosses the slop after the lock carries nothing');
  lobby();
});

test('§3 the table is the tabletop: piles of scans for the deck, whole cards for the sideboard', () => {
  const html = ui.html();
  const deck = html.slice(html.indexOf('data-cc-zone="main"'), html.indexOf('<footer'));
  assert.match(deck, /<section class="ttpile ccsbpile" data-tt-zone="main\|/, 'the deck is the tabletop\'s piles');
  assert.ok((deck.match(/class="ttpile /g) ?? []).length >= 2, 'by cost: more than one pile');
  assert.equal((deck.match(/class="ttcard/g) ?? []).length, 30, 'every copy a card of its own');
  assert.equal((deck.match(/<img [^>]*class="ttart"|class="ttart[^"]*"/g) ?? []).length, 30, 'every card its scan');
  const side = html.slice(html.indexOf('data-cc-zone="side"'), html.indexOf('data-cc-zone="main"'));
  assert.equal((side.match(/class="ttcard ccsbcard"/g) ?? []).length, 6);
  assert.equal((side.match(/class="ccsbslot"/g) ?? []).length, 1, 'the room left up to seven, as an empty place');
  assert.doesNotMatch(html, /draggable="true"|<img (?![^>]*draggable="false")/, 'no scan is natively draggable (Firefox, ui/drag.ts)');
});
