/* 1027 — THE COUNTS THE NEW HOME BADGES, BEFORE ANYTHING HAS LOADED (docs/24,
 * 2026-11-03).
 *
 * The home's Alerts button badges inbox.ts inboxUnread(); its Join button
 * badges inviteCount() + match.ts myMatchCount() + league.ts joinCount(). All
 * are read on every home paint, so each must answer 0 — never throw — before
 * its first fetch has landed, and while signed out. No DOM here: the inbox is
 * never installed, so no poll runs.
 *
 * §1 nothing loaded: every count is 0, and the invite rows draw nothing
 * §2 signed out: the inbox counts are 0 even with its deps given
 * §3 onInboxChange takes one listener and does not call it on registration
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installInbox, inboxUnread, inviteCount, inviteRowsHtml, onInboxChange, type InboxDeps } from '../inbox.ts';
import { myMatchCount } from '../match.ts';

test('1027 §1 before anything loads, every count is 0', () => {
  assert.equal(inboxUnread(), 0);
  assert.equal(inviteCount(), 0);
  assert.equal(inviteRowsHtml(), '');
  assert.equal(myMatchCount(), 0);
});

test('1027 §2 signed out, the inbox counts nothing', () => {
  const deps: InboxDeps = {
    token: () => null, authHeaders: () => ({}), room: () => null, quiet: () => false, friendsChanged: () => {},
    tz: () => 'UTC', openLeague: () => {}, playLeague: () => {}, leagueChanged: () => {},
  };
  installInbox(deps); // no document: it keeps the deps and mounts nothing
  assert.equal(inboxUnread(), 0);
  assert.equal(inviteCount(), 0);
  assert.equal(inviteRowsHtml(), '');
});

test('1027 §3 one listener, not called just for registering', () => {
  let calls = 0;
  onInboxChange(() => { calls++; });
  onInboxChange(() => { calls += 10; });
  assert.equal(calls, 0);
});
