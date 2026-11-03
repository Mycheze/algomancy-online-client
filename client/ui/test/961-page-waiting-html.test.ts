/* 961 — THE WAITING ROOMS, DRAWN WITHOUT A PAGE (design-system round, 2026-11-03).
 *
 * The constructed and Single Card Duel waiting rooms left main.ts for
 * pages/waiting.ts as view → pure html. Driven here with made-up views, no DOM.
 *
 * §1 one seat in the room: the share bar, the picker, the opponent "not here yet"
 * §2 both seats in: no picker, both decks in
 * §3 a constructed league match: no code to share, no friends panel
 * §4 a Single Card Duel room: the card picker, the draw notice, blind opponent
 * §5 names and errors are escaped
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  constructedWaitingHtml, singleWaitingHtml, type ConstructedWaitingView, type SingleWaitingView,
} from '../pages/waiting.ts';

const LINK = 'http://x/?ws=1&room=QXZZ&seat=1&mode=constructed';

function cview(over: Partial<ConstructedWaitingView> = {}): ConstructedWaitingView {
  return {
    room: 'QXZZ', link: LINK, league: false, friends: '<!--SLOT:friends-->',
    mineIn: false, oppIn: false, oppHere: false, myName: 'Ann', oppName: 'Bo',
    deck: null,
    deckPicker: { current: null, signedIn: false, mine: [], defaults: null, msg: '' },
    error: '',
    ...over,
  };
}
function sview(over: Partial<SingleWaitingView> = {}): SingleWaitingView {
  return {
    room: 'QXZZ', link: LINK, friends: '<!--SLOT:friends-->', drawn: null,
    mineIn: false, oppIn: false, oppHere: false, myName: 'Ann', oppName: 'Bo',
    card: null, picker: '<!--SLOT:scpicker-->', error: '',
    ...over,
  };
}
const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);
const seats = (html: string): string[] => [...html.matchAll(/<i class="seatdot([^"]*)"><\/i>/g)].map(m => m[1]!.trim());

test('961 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  assert.match(constructedWaitingHtml(cview()), /^<div class="lobbypage">/);
});

test('961 §1 one seat in a constructed room: share, invite, pick a deck', () => {
  const html = constructedWaitingHtml(cview());
  assert.match(html, /Constructed — room <span class="roomcode">QXZZ<\/span>/);
  assert.ok(html.includes(LINK.replace(/&/g, '&amp;')) || html.includes(LINK), 'the share link is on screen');
  assert.match(html, /<!--SLOT:friends-->/, 'the Invite a friend panel');
  assert.match(html, /<div class="lobbypanel deckpicker">/, 'the deck picker panel');
  assert.match(html, /loading the deck list…/, 'the picker view is drawn inside it');
  assert.deepEqual(btns(html).filter(b => b !== 'copylink'), ['gohome', 'deckjoin']);
  assert.match(html, /data-btn="deckjoin" disabled>Play this deck/, 'no deck, no Play');
  assert.deepEqual(seats(html), ['', 'away'], 'me: not in yet; them: not connected');
  assert.match(html, /Bo — <span class="dim">not here yet<\/span>/);
  // the opponent connects
  const here = constructedWaitingHtml(cview({ oppHere: true }));
  assert.deepEqual(seats(here), ['', '']);
  assert.match(here, /connected — still choosing a deck…/);
});

test('961 §2 two seats in: no picker, both decks in', () => {
  const html = constructedWaitingHtml(cview({
    mineIn: true, oppIn: true, oppHere: true, deck: { name: 'Ember Rush', author: 'Caleb' },
  }));
  assert.doesNotMatch(html, /lobbypanel deckpicker/, 'the picker goes once my deck is in');
  assert.deepEqual(seats(html), ['ready', 'ready']);
  assert.match(html, /Ann \(you\) — <b class="lockedin">deck is in<\/b> — Ember Rush by Caleb/);
  assert.match(html, /Bo — <b class="lockedin">deck is in<\/b>/);
  assert.match(constructedWaitingHtml(cview({ deck: { name: 'X', author: 'Y' } })), /data-btn="deckjoin" >Play this deck/);
});

test('961 §3 a constructed league match: nothing to share, any deck', () => {
  const html = constructedWaitingHtml(cview({ league: true, friends: '' }));
  assert.match(html, /League match — room/);
  assert.doesNotMatch(html, /data-btn="copylink"/, 'both seats are bound: no code to share');
  assert.match(html, /Waiting for your opponent\. They join from their own League page/);
  assert.match(html, /Your deck for this game/);
  assert.doesNotMatch(constructedWaitingHtml(cview({ league: true, oppHere: true })), /lobbywait/,
    'the waiting line goes when they arrive');
});

test('961 §4 a Single Card Duel room: the card picker, the draw, and a blind opponent', () => {
  const html = singleWaitingHtml(sview());
  assert.match(html, /Single Card Duel — room/);
  assert.match(html, /<!--SLOT:scpicker-->/);
  assert.match(html, /data-btn="singlejoin" disabled>Pick a card first/);
  assert.deepEqual(btns(html).filter(b => b !== 'copylink'), ['gohome', 'singlejoin']);
  assert.doesNotMatch(html, /scdraw/);
  const picked = singleWaitingHtml(sview({ card: 'Ignis Sprite' }));
  assert.match(picked, /data-btn="singlejoin" >Play Ignis Sprite/);
  const drawn = singleWaitingHtml(sview({ drawn: { mine: 'Overwhelm', theirs: 'Tidal <Wave>' } }));
  assert.match(drawn, /<div class="lobbypanel scdraw">/);
  assert.match(drawn, /data-prev="Tidal &lt;Wave&gt;"/);
  // both in: blind — their line never names their card
  const both = singleWaitingHtml(sview({ mineIn: true, oppIn: true, oppHere: true, card: 'Ignis Sprite', picker: '' }));
  assert.doesNotMatch(both, /lobbypanel deckpicker/);
  assert.match(both, /Ann \(you\) — <b class="lockedin">card is in<\/b> — Ignis Sprite/);
  assert.match(both, /Bo — <b class="lockedin">card is in<\/b><\/span>/);
});

test('961 §5 names and errors are escaped', () => {
  const html = constructedWaitingHtml(cview({ myName: '<A>', oppName: '<B>', error: 'refused <x>' }));
  assert.match(html, /&lt;A&gt; \(you\)/);
  assert.match(html, /&lt;B&gt; — /);
  assert.match(html, /<p class="ui-status ui-status--note deckmsg" role="status">refused &lt;x&gt;<\/p>/);
  assert.match(constructedWaitingHtml(cview({ myName: undefined, oppName: undefined })), /You \(you\)[^]*Opponent — /);
});
