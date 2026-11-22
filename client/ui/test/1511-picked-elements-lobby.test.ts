/* 1511 — THE LOBBY OF A DRAFT ROOM MADE WITH ITS ELEMENTS PICKED.
 *
 * The owner, in #steward: a room started "with the draft already choosen" had no joining screen
 * "where you can invite your friends or anything". It opens in the lobby now (server test 1510);
 * this is what that lobby draws: the code to share and the invites while the opponent is away,
 * the picked elements as chips, one method and no other to switch to, and I'm ready.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lobbyHtml, type LobbyView } from '../pages/lobby.ts';

const view = (peers: [boolean, boolean]): LobbyView => ({
  lobby: {
    method: 'chosen', chosen: ['fire', 'water', 'wood'],
    methods: [{ id: 'chosen', label: 'Already picked — fire + water + wood', blurb: 'picked when the room was made' }],
    locked: [false, false], mine: {},
  },
  seat: 0, names: ['Ann', 'Bo'], peers, room: 'PKUI', link: 'http://x/?room=PKUI&seat=1',
  friends: '<!--SLOT:friends-->', pick: null, ranking: [], ready: true,
  chrome: { signedIn: true, alerts: 0 },
});

test('1511 inbox: a room made with its elements picked shows the code, the invites and the elements', () => {
  const away = lobbyHtml(view([true, false]));
  assert.match(away, /<h1 class="frametitle">Live draft<small>room <span class="roomcode">PKUI<\/span>/);
  assert.match(away, /Send your opponent the room code/, '⭐ the code to share');
  assert.match(away, /<!--SLOT:friends-->/, '⭐ and the invites');
  for (const el of ['fire', 'water', 'wood']) assert.match(away, new RegExp(`<span class="elchip ${el} on">`));
  assert.doesNotMatch(away, /class="elchip (earth|metal|dark|light) on"/);
  assert.match(away, /picked when the room was made/);
  assert.equal([...away.matchAll(/data-btn="lobby-method"/g)].length, 1, 'one method, nothing to switch to');
  assert.match(away, /data-btn="lobby-lock"[^>]*>I'm ready</);

  const here = lobbyHtml(view([true, true]));
  assert.doesNotMatch(here, /Send your opponent the room code/, 'the opponent is in: nothing to send');
});
