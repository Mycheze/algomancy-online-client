/* 1497 — A DECK OR CARD THAT IS IN CAN STILL BE CHANGED BEFORE THE DEAL.
 *
 * Constructed and Single Card Duel rooms deal when both seats have brought
 * theirs. Until the opponent has, the seat that is in gets Change, which opens
 * the picker again; the one in stays in (and named) until Play sends another,
 * which the server puts in its place. Keep closes the picker on the one in.
 *
 *   §1 the constructed room drawn: Change once in, the picker and Keep once pressed
 *   §2 the Single Card Duel room drawn the same way
 *   §3 the real client: Change, pick another, Play sends a new pick
 *   §4 Keep puts the browser's choice back on the deck that is in
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  constructedWaitingHtml, singleWaitingHtml, type ConstructedWaitingView, type SingleWaitingView,
} from '../pages/waiting.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);
const A = { name: 'Ember Rush', author: 'Caleb', cards: ['x'] };
const B = { name: 'Tidal Wall', author: 'Ann', cards: ['y'] };

function cview(over: Partial<ConstructedWaitingView> = {}): ConstructedWaitingView {
  return {
    room: 'QXZZ', link: 'http://x/', league: false, friends: '',
    mineIn: true, oppIn: false, oppHere: true, myName: 'Ann', oppName: 'Bo', deck: A,
    deckPicker: { current: null, signedIn: false, mine: [], defaults: null, msg: '' },
    error: '', chrome: { signedIn: true, alerts: 0 }, ...over,
  };
}
function sview(over: Partial<SingleWaitingView> = {}): SingleWaitingView {
  return {
    room: 'QXZZ', link: 'http://x/', friends: '', drawn: null,
    mineIn: true, oppIn: false, oppHere: true, myName: 'Ann', oppName: 'Bo',
    card: 'Overwhelm', picker: '<!--SLOT:scpicker-->', error: '',
    chrome: { signedIn: true, alerts: 0 }, ...over,
  };
}

test('BL-10 §1 a constructed seat whose deck is in can open the picker again, and keep the one in', () => {
  const inHtml = constructedWaitingHtml(cview());
  assert.ok(btns(inHtml).includes('room-change'), 'no Change once my deck is in');
  assert.match(inHtml, />Change deck</);
  assert.doesNotMatch(inHtml, /lobbypanel deckpicker/, 'the picker shows before Change is pressed');

  const open = constructedWaitingHtml(cview({ deck: B, changing: true, inDeck: A }));
  assert.match(open, /lobbypanel deckpicker/, 'Change did not open the picker');
  assert.ok(btns(open).includes('deckjoin'), 'no Play this deck in the reopened picker');
  assert.match(open, /data-btn="room-keep"[^>]*>Keep Ember Rush</, 'Keep does not name the deck that is in');
  assert.match(open, /deck is in<\/b> — Ember Rush by Caleb <span class="dim">until you play another/,
    'the seat line must name the deck the server holds, not the one the picker moved to');
  assert.doesNotMatch(open, /Tidal Wall by/);
  assert.ok(!btns(open).includes('room-change'));

  // the opponent's deck is in too: the game deals, so there is nothing to change
  assert.ok(!btns(constructedWaitingHtml(cview({ oppIn: true }))).some(b => b.startsWith('room-')));
  // and before mine is in, the picker is simply there
  assert.ok(!btns(constructedWaitingHtml(cview({ mineIn: false }))).some(b => b.startsWith('room-')));
});

test('BL-10 §2 a Single Card Duel seat whose card is in can change it the same way', () => {
  const inHtml = singleWaitingHtml(sview());
  assert.match(inHtml, /data-btn="room-change"[^>]*>Change card</);
  assert.doesNotMatch(inHtml, /SLOT:scpicker/);
  const open = singleWaitingHtml(sview({ card: 'Torrential', changing: true, inCard: 'Overwhelm' }));
  assert.match(open, /SLOT:scpicker/, 'Change did not open the card picker');
  assert.match(open, /data-btn="singlejoin"[^>]*>Play Torrential</);
  assert.match(open, /card is in<\/b> — Overwhelm <span class="dim">until you play another/);
  assert.match(open, /data-btn="room-keep"[^>]*>Keep Overwhelm</);
});

/* the real client, through the ui driver */
const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 15);
const deckOf = (name: string): Record<string, unknown> => ({ name, author: 'you', cards: N.flatMap(n => [n, n]) });
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_STORE'] = { algoDeck: JSON.stringify(deckOf('Room deck A')) };
g['__UI_DRIVER_FETCH'] = async () => new Promise(() => {});
const { client } = await import('./ui-driver.ts');
const ui = await client();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const roomMsg = (t: 'joined' | 'update', mineIn: boolean): Record<string, unknown> => ({
  t, seat: 0, room: 'UIDRIVER', waiting: { have: [mineIn, false] },
  peers: [true, true], names: ['Ann', 'Bo'],
});
const store = g['localStorage'] as Storage;

test('BL-10 §3 Change, another deck, Play: a new pick goes to the server and the picker closes', async () => {
  ui.push(roomMsg('joined', true));
  await flush();
  assert.match(ui.html(), /deck is in<\/b> — Room deck A/);
  assert.doesNotMatch(ui.html(), /data-btn="deckjoin"/, 'the fixture is not a seat whose deck is in');

  ui.click({ btn: 'room-change' });
  assert.match(ui.html(), /data-btn="deckjoin"/, 'Change did not open the picker');
  store.setItem('algoDeck', JSON.stringify(deckOf('Room deck B')));   // the picker's choice
  ui.push(roomMsg('update', true));   // a push while choosing keeps the picker open
  ui.tick();
  assert.match(ui.html(), /deck is in<\/b> — Room deck A/, 'the seat line followed the picker, not the server');
  assert.match(ui.html(), /data-btn="deckjoin"/, 'a push closed the picker');

  const before = ui.sent().length;
  ui.click({ btn: 'deckjoin' });
  const out = ui.sent().slice(before).find(m => m['t'] === 'join');
  assert.ok(out, 'Play this deck sent nothing');
  assert.equal(out['pick'], true, 'the join is not a pick, so the server would keep the old deck');
  ui.push(roomMsg('update', true));
  ui.tick();
  assert.doesNotMatch(ui.html(), /data-btn="deckjoin"/, 'the picker stayed open after the new deck went in');
  assert.match(ui.html(), /deck is in<\/b> — Room deck B/);
});

test('BL-10 §4 Keep closes the picker and puts the choice back on the deck that is in', async () => {
  ui.click({ btn: 'room-change' });
  store.setItem('algoDeck', JSON.stringify(deckOf('Room deck C')));
  ui.push(roomMsg('update', true));
  ui.tick();
  assert.match(ui.html(), /data-btn="room-keep"[^>]*>Keep Room deck B</);
  ui.click({ btn: 'room-keep' });
  assert.doesNotMatch(ui.html(), /data-btn="deckjoin"/, 'Keep left the picker open');
  assert.match(ui.html(), /deck is in<\/b> — Room deck B/);
  assert.equal((JSON.parse(store.getItem('algoDeck')!) as { name: string }).name, 'Room deck B',
    'Keep left the browser on the deck it did not play');
});
