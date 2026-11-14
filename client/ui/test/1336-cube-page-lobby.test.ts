/* 1336 — THE EVENT LOBBY (docs/25 §10), DOM-free: what the host sees and what a player sees.
 *
 * §1 the seats: people first, then "Bot" (fill on) or "Open" (fill off), the host marked
 * §2 the host: Start draft (off while short of players), Edit settings, Call off, Remove (two presses)
 * §3 a player: Join while not in, Leave (two presses) once in; signed out: sign in
 * §4 the settings summary, the pack math, the share link and code, the scheduled countdown
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeHtml } from '../pages/cube.ts';
import { CONFIG, eventView, NOW, pageView, PLAYERS, tagOf } from './cube-fixture.ts';

const lobby = (over: Parameters<typeof eventView>[1] = {}, page: Parameters<typeof pageView>[0] = {}): string =>
  cubeHtml(pageView({ event: eventView('lobby', over), ...page }));

test('1336 §1 the seats', () => {
  const html = lobby();
  assert.equal((html.match(/class="cubeseat( me)?"/g) ?? []).length, 3, 'three people');
  assert.equal((html.match(/class="cubeseat empty">Bot</g) ?? []).length, 5, 'five bots fill the table of eight');
  const open = lobby({ config: { ...CONFIG, fillBots: false } });
  assert.equal((open.match(/class="cubeseat empty">Open</g) ?? []).length, 5);
  assert.match(html, /Seats <span class="dim">3 of 8<\/span>/);
  assert.match(html, /class="cubeseat me"><span class="cubeseatname">Ann<\/span>[^]*?>Host</);
  assert.match(html, /data-scroll="cube-lobby-seats"/);
  assert.match(html, /data-scroll="cube-lobby-side"/);
});

test('1336 §2 the host', () => {
  const html = lobby();
  assert.doesNotMatch(tagOf(html, 'cube-start'), /disabled/, 'three of at least two: Start draft is live');
  assert.ok(tagOf(html, 'cube-edit'), 'Edit settings');
  assert.ok(tagOf(html, 'cube-cancel'), 'Call off');
  assert.match(tagOf(html, 'cube-kick', 'data-user="u2"'), /data-user="u2"/, 'Remove on another player');
  assert.equal(tagOf(html, 'cube-kick', 'data-user="u1"'), '', 'not on the host');
  const short = lobby({ config: { ...CONFIG, minPlayers: 4 } });
  assert.match(tagOf(short, 'cube-start'), /disabled/);
  assert.match(short, /Needs 1 more player to start\./);
  const tooFew = lobby({ packMath: [{ seats: 8, packs: 3, packSize: 4, ok: false }] });
  assert.match(tagOf(tooFew, 'cube-start'), /disabled/);
  assert.match(tooFew, /Too few cards for 8 players/);
  // the second press: the button says what it will do
  assert.match(lobby({}, { arming: 'kick:u2' }), /Remove\?/);
  assert.match(lobby({}, { arming: 'cancel' }), /Call off the event\?/);
  assert.equal(tagOf(lobby({ me: 'u2' }), 'cube-start'), '', 'a player has no Start');
});

test('1336 §3 a player, and somebody not in yet', () => {
  const inHtml = lobby({ me: 'u2' });
  assert.ok(tagOf(inHtml, 'cube-leave'));
  assert.equal(tagOf(inHtml, 'cube-join'), '');
  assert.match(lobby({ me: 'u2' }, { arming: 'leave' }), /Leave the event\?/);
  const outsider = lobby({ me: 'u9', joined: false });
  assert.doesNotMatch(tagOf(outsider, 'cube-join'), /disabled/);
  const full = lobby({ me: 'u9', joined: false, config: { ...CONFIG, maxPlayers: 3 } });
  assert.match(tagOf(full, 'cube-join'), /disabled/, 'a full table');
  const signedOut = cubeHtml(pageView({ signedIn: false, event: eventView('lobby', { me: null, joined: false }) }));
  assert.ok(tagOf(signedOut, 'acct-open-auth'));
  assert.equal(PLAYERS.length, 4, 'positive control: the fixture');
});

test('1336 §4 the summary, the packs, the share box, the countdown', () => {
  const html = lobby();
  assert.match(html, /Friday &lt;cube&gt;/, 'the event name, escaped');
  assert.match(html, /<dt>Tournament<\/dt><dd>Swiss, 3 rounds<\/dd>/);
  assert.match(html, /<dt>Games<\/dt><dd>Casual · best of 1<\/dd>/);
  assert.match(html, /<dt>Start<\/dt><dd>When the host starts it<\/dd>/);
  assert.match(html, /8 players · 3 packs of 13 · 320 cards/);
  assert.match(html, /<b>QZXV<\/b>/);
  assert.match(tagOf(html, 'cube-copy', 'data-what="code"'), /Copy code|cube-copy/);
  assert.ok(tagOf(html, 'cube-copy', 'data-what="link"'));
  assert.match(html, /id="cube-share"[^>]*value="https:\/\/x\/\?cube=QZXV"/);
  assert.match(html, /data-btn="cube-back"/, 'the way back to my events');
  const later = lobby({ config: { ...CONFIG, startAt: NOW + 72_000 } });
  assert.match(later, /Starts in <span class="cubeclock" data-cube-until="\d+">1:12<\/span>/, 'a scheduled start counts down');
  // the two pack lines when the table is not full
  const two = lobby({ packMath: [{ seats: 3, packs: 3, packSize: 15, ok: true }, { seats: 8, packs: 3, packSize: 13, ok: true }] });
  assert.match(two, /Now:<\/span> 3 players · 3 packs of 15/);
  assert.match(two, /Full table:<\/span> 8 players · 3 packs of 13/);
});
