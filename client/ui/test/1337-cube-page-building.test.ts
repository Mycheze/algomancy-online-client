/* 1337 — BUILDING DECKS (docs/25 §6, §10), DOM-free.
 *
 * §1 who has a deck in; my Build your deck (Edit once submitted)
 * §2 the host's Start now asks first, naming who will be dropped
 * §3 the drafting page under the pick screen: Back to the draft, or the table for somebody watching
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeHtml } from '../pages/cube.ts';
import { eventView, NOW, pageView, tagOf } from './cube-fixture.ts';

test('1337 §1 who has a deck in, and mine', () => {
  const html = cubeHtml(pageView({ event: eventView('building', { me: 'u2' }) }));
  assert.match(html, /Decks <span class="dim">3 of 4 in<\/span>/);
  assert.match(html, /<li class="in">[^]*?Ann[^]*?submitted/);
  assert.match(html, /<li class="">[^]*?Cy[^]*?building/);
  assert.match(html, /data-btn="cube-build"[^>]*>Build your deck</);
  assert.match(html, /from the 39 you drafted/);
  const done = cubeHtml(pageView({ event: eventView('building', { me: 'u2', myDeck: { main: Array(30).fill('x'), side: Array(7).fill('y') } }) }));
  assert.match(done, /data-btn="cube-build"[^>]*>Edit your deck</);
  assert.match(done, /Submitted: 30 cards and 7 in the sideboard/);
  assert.equal(tagOf(html, 'cube-startnow'), '', 'a player has no Start now');
});

test('1337 §2 Start now names who will be dropped', () => {
  const host = cubeHtml(pageView({ event: eventView('building') }));
  assert.ok(tagOf(host, 'cube-startnow'), 'the host has Start now while a deck is missing');
  const sheet = cubeHtml(pageView({ event: eventView('building'), sheet: { kind: 'startnow' } }));
  assert.match(sheet, /Cy has no deck yet and will be dropped from the event\./);
  assert.ok(tagOf(sheet, 'cube-startnow-go'));
  assert.ok(tagOf(sheet, 'cube-sheet-close'), 'Wait');
  // every deck in: the first break counts down, no Start now
  const allIn = eventView('building', { players: eventView('building').players.map(p => ({ ...p, submitted: true })), breakUntil: NOW + 90_000 });
  const going = cubeHtml(pageView({ event: allIn }));
  assert.equal(tagOf(going, 'cube-startnow'), '');
  assert.match(going, /Round 1 in <span class="cubeclock" data-cube-until="\d+">1:30<\/span>/);
});

test('1337 §3 the drafting page', () => {
  const me = cubeHtml(pageView({ event: eventView('drafting') }));
  assert.ok(tagOf(me, 'cube-draft-show'), 'a drafter who stepped out has the way back');
  const watcher = cubeHtml(pageView({ event: eventView('drafting', { me: 'u9', joined: false }) }));
  assert.equal(tagOf(watcher, 'cube-draft-show'), '');
  assert.match(watcher, /The players are drafting/);
});
