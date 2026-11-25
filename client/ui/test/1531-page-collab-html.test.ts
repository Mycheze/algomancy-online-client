/* 1531 · A SHARED DECK TABLE'S OWN MARKUP (ui/pages/collab.ts, docs/26), from made-up views.
 *
 *   §1 the Together button counts the people here and draws one dot each, in their colour
 *   §2 the sheet: the link, who is at the table, friends to invite (sent, here), and the host's End
 *   §3 a guest's sheet: no Remove, and Save a copy and Leave instead of End
 *   §4 the page before the table: joining, signed out (Sign in), over (Save a copy, Home)
 *   §5 the marks: a pointer and a held card at the boxes given, names escaped
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collabMarksHtml, collabPageHtml, collabSheetHtml, collabStartHtml, collabToolHtml, type CollabSheetView,
} from '../pages/collab.ts';

const CHROME = { signedIn: true, alerts: 0 };
const PEOPLE = [
  { id: 'h', name: 'Ben', colour: '#e0a526', here: true, host: true },
  { id: 'r', name: 'Rashi', colour: '#3d8bfd', here: true, host: false },
  { id: 'q', name: 'Quill', colour: '#e5534b', here: false, host: false },
];
const sheetView = (over: Partial<CollabSheetView> = {}): CollabSheetView => ({
  link: 'https://algomancy.online/?collab=ABCDEFGHJK', people: PEOPLE, me: 'h', youHost: true, hostName: 'Ben',
  friends: [
    { id: 'r', username: 'Rashi', status: 'online', sent: false, joined: true },
    { id: 'z', username: 'Zed', status: 'offline', sent: true, joined: false },
    { id: 'y', username: 'Yara', status: 'online', sent: false, joined: false },
  ],
  friendsLoaded: true, msg: '', ...over,
});

test('§1 the Together button', () => {
  const html = collabToolHtml(PEOPLE, false);
  assert.match(html, /data-btn="tt-collab-sheet"/);
  assert.match(html, /Together · 2/, 'the two who are here');
  assert.equal((html.match(/class="collabdot"/g) ?? []).length, 2, 'a dot each, the away one not');
  assert.match(html, /--collab:#3d8bfd/);
  assert.match(collabStartHtml(), /data-btn="tt-collab-start"/);
});

test('§2 the host’s sheet', () => {
  const html = collabSheetHtml(sheetView());
  assert.match(html, /value="https:\/\/algomancy\.online\/\?collab=ABCDEFGHJK"/);
  assert.match(html, /data-btn="tt-collab-copylink"/);
  assert.equal((html.match(/data-btn="tt-collab-kick"/g) ?? []).length, 2, 'Remove beside everyone but the host');
  assert.match(html, /data-btn="tt-collab-invite"[^>]*data-user="y"/, 'Yara can be invited');
  assert.match(html, /invited ✓/, 'Zed already was');
  assert.doesNotMatch(html, /tt-collab-invite"[^>]*data-user="r"/, 'Rashi is here already');
  assert.match(html, /data-btn="tt-collab-end"/);
  assert.doesNotMatch(html, /tt-collab-copy"|tt-collab-leave/);
});

test('§3 a guest’s sheet', () => {
  const html = collabSheetHtml(sheetView({ me: 'r', youHost: false }));
  assert.doesNotMatch(html, /tt-collab-kick|tt-collab-end/);
  assert.match(html, /data-btn="tt-collab-copy"/);
  assert.match(html, /data-btn="tt-collab-leave"/);
  assert.match(html, /Ben’s deck/);
  assert.match(collabSheetHtml(sheetView({ friendsLoaded: false })), /Loading your friends/);
  assert.match(collabSheetHtml(sheetView({ friends: [] })), /Add friends from your profile/);
});

test('§4 the page before the table', () => {
  assert.match(collabPageHtml({ state: 'joining', msg: '' }, CHROME), /Joining the table/);
  const signin = collabPageHtml({ state: 'signin', msg: 'Sign in to join.' }, CHROME);
  assert.match(signin, /data-btn="acct-open-auth"/);
  const over = collabPageHtml({ state: 'ended', msg: 'The host ended the session.', canCopy: true }, CHROME);
  assert.match(over, /The host ended the session\./);
  assert.match(over, /data-btn="collab-copy"/);
  assert.match(over, /data-btn="collab-home"/);
  assert.doesNotMatch(collabPageHtml({ state: 'ended', msg: 'x', canCopy: false }, CHROME), /collab-copy/);
});

test('§5 the marks', () => {
  const html = collabMarksHtml([
    { id: 'r', name: '<b>Rashi</b>', colour: '#3d8bfd', x: 100.4, y: 50.6, held: { left: 10, top: 20, width: 90, height: 120 } },
    { id: 'q', name: 'Quill', colour: '#e5534b', x: null, y: null, held: null },
  ]);
  assert.match(html, /translate\(100px,51px\)/);
  assert.match(html, /left:10px;top:20px;width:90px;height:120px/);
  assert.match(html, /&lt;b&gt;Rashi&lt;\/b&gt;/, 'a name is escaped');
  assert.doesNotMatch(html, /Quill/, 'nothing to draw for someone off the table');
});
