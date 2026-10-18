/* 490 — GAME INVITES: THE PARTS THAT TAKE TIME.
 *
 * server/e2e/test-invites.ts drives invites through the real server; it cannot
 * wait ten minutes. This drives server/inbox.ts directly with a hand-built
 * room and a clock passed in.
 *
 *   §1 a poll is a sighting for SEEN_WINDOW_MS and no longer
 *   §2 an invite expires after INVITE_TTL_MS, answered or not
 *   §3 re-inviting the same friend to the same room replaces the invite
 *   §4 a decline by anybody but the recipient changes nothing
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INVITE_TTL_MS, SEEN_WINDOW_MS, declineInvite, invitesFor, resetInbox, seenRecently, sendInvite, sentFrom, touch,
  type InviteRoom, type Seat,
} from '../inbox.ts';

const ben = { id: 'u-ben', username: 'Ben' };
const RASHI = 'u-rashi';

/** a room with Ben at seat 0, connected, and seat 1 open */
function room(): InviteRoom {
  return {
    code: 'ABCD', mode: 'draft', label: 'Live draft',
    seatOf: id => (id === ben.id ? 0 : null),
    free: (s: Seat) => s === 1,
    here: (s: Seat) => s === 0,
  };
}
const lookup = (code: string): InviteRoom | null => (code === 'ABCD' ? room() : null);
const friend = (id: string): boolean => id === RASHI;

test('§1 a poll counts as being on the site for the window, and no longer', () => {
  resetInbox();
  touch(RASHI, 1000);
  assert.equal(seenRecently(RASHI, 1000 + SEEN_WINDOW_MS), true);
  assert.equal(seenRecently(RASHI, 1000 + SEEN_WINDOW_MS + 1), false);
  assert.equal(seenRecently('u-nobody', 1000), false);
});

test('§2 an invite expires, answered or not', () => {
  resetInbox();
  assert.deepEqual(sendInvite(ben, RASHI, 'ABCD', lookup, friend, 0), { ok: true });
  assert.equal(invitesFor(RASHI, lookup, INVITE_TTL_MS).length, 1);
  assert.equal(invitesFor(RASHI, lookup, INVITE_TTL_MS + 1).length, 0);
  assert.equal(sentFrom(ben.id, 'ABCD', INVITE_TTL_MS + 1).size, 0, 'and the sender stops seeing it too');
});

test('§3 inviting the same friend to the same room again replaces the invite', () => {
  resetInbox();
  sendInvite(ben, RASHI, 'ABCD', lookup, friend, 0);
  const [first] = invitesFor(RASHI, lookup, 1);
  declineInvite(RASHI, first!.id);
  assert.equal(sentFrom(ben.id, 'ABCD', 2).get(RASHI), 'declined');
  sendInvite(ben, RASHI, 'ABCD', lookup, friend, 3);
  const after = invitesFor(RASHI, lookup, 4);
  assert.equal(after.length, 1, 'one invite, not two');
  assert.notEqual(after[0]!.id, first!.id);
  assert.equal(sentFrom(ben.id, 'ABCD', 4).get(RASHI), 'sent');
});

test('§4 only the recipient can decline', () => {
  resetInbox();
  sendInvite(ben, RASHI, 'ABCD', lookup, friend, 0);
  const [inv] = invitesFor(RASHI, lookup, 1);
  declineInvite(ben.id, inv!.id);
  assert.equal(invitesFor(RASHI, lookup, 2).length, 1);
});
