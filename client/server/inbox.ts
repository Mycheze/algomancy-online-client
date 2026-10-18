/* The inbox: game invites between friends, and who is on the site.
 *
 * Owner, 2026-10-18: "We should make the friends feature do a little more
 * than... nothing." Make a room, see your friends (the online ones first),
 * click one, and a popup on their screen joins them to it. The bell that
 * counts invites counts friend requests too, and is the place anything
 * else of the kind goes.
 *
 * ── TWO THINGS HERE ARE NOT WHAT THEY LOOK LIKE ──────────────────────
 *
 * ⚠ "ONLINE" USED TO MEAN "SEATED IN A ROOM". The only presence this server
 * kept was a count of seated sockets (main.ts markOnline), because the home
 * screen has no socket (ui/queue.ts says why). So a friend sitting on the
 * home page — the one person an invite is FOR — read as offline. The inbox
 * is polled over HTTP by every signed-in page, and a poll is a sighting:
 * `seenRecently` is the second half of main.ts isOnline. The window is
 * wide because a background tab's timers are throttled to once a minute.
 *
 * ⚠ AN INVITE IS NOT TRUSTED FOR ANYTHING BUT WHO TO ASK. The seat and the
 * mode are read off the ROOM when the invite is made, and the invite is
 * re-checked against the room every time it is read: it is shown only while
 * the seat is still free and its sender is still at the table. One that has
 * stopped being true is hidden, not deleted — a sender's reload drops their
 * socket for a second, and an invite deleted in that second would be gone
 * for good. Expiry deletes.
 *
 * Nothing here is persisted. A restart drops every invite, which is right:
 * it also drops every socket, and so every sender's place at the table.
 */

export type Seat = 0 | 1;

/** what an invite needs to know about a room — main.ts builds it off the
 * live Room, the tests build it by hand */
export interface InviteRoom {
  code: string;
  /** the `mode` the join link carries */
  mode: string;
  /** what the invite calls the game: "Live draft", "Constructed"… */
  label: string;
  /** the seat this account holds in the room, or null */
  seatOf(userId: string): Seat | null;
  /** can a newcomer still sit in this seat (nobody claimed, nobody there, not decided) */
  free(seat: Seat): boolean;
  /** is somebody connected at this seat right now */
  here(seat: Seat): boolean;
}

export type RoomLookup = (code: string) => InviteRoom | null;

interface Invite {
  id: string;
  from: string;
  fromName: string;
  to: string;
  room: string;
  /** the seat the invited friend takes — the sender's other one */
  seat: Seat;
  at: number;
  declined: boolean;
}

/** what the invited friend's screen is sent */
export interface InviteView {
  id: string;
  from: string;
  room: string;
  seat: Seat;
  mode: string;
  label: string;
  at: number;
}

/** an invite lives this long, answered or not */
export const INVITE_TTL_MS = 10 * 60_000;
/** a poll this recent counts as being on the site (see the header) */
export const SEEN_WINDOW_MS = 90_000;
/** the most invites one player may have open at once — a brake, not a rule */
const OPEN_CAP = 30;

const invites = new Map<string, Invite>();
const lastSeen = new Map<string, number>();
let serial = 0;

// ── presence ──────────────────────────────────────────────────────────

export function touch(userId: string, now = Date.now()): void {
  lastSeen.set(userId, now);
  // bounded: one entry per account that ever polled, swept of the stale
  // whenever it grows past what one deploy's players could fill
  if (lastSeen.size > 5000) {
    for (const [k, t] of lastSeen) if (now - t > SEEN_WINDOW_MS) lastSeen.delete(k);
  }
}

export const seenRecently = (userId: string, now = Date.now()): boolean =>
  now - (lastSeen.get(userId) ?? -Infinity) <= SEEN_WINDOW_MS;

// ── invites ───────────────────────────────────────────────────────────

function sweep(now: number): void {
  for (const [id, inv] of invites) if (now - inv.at > INVITE_TTL_MS) invites.delete(id);
}

/** is this invite still something its recipient can act on */
function live(inv: Invite, lookup: RoomLookup): InviteRoom | null {
  if (inv.declined) return null;
  const room = lookup(inv.room);
  if (!room || !room.free(inv.seat)) return null;
  const sender = room.seatOf(inv.from);
  if (sender === null || sender === inv.seat || !room.here(sender)) return null;
  return room;
}

/**
 * Invite a friend into the room the sender is sitting in. `isFriend` is the
 * caller's (accounts.ts owns the friends list); everything about the room is
 * read off it here. Inviting the same friend to the same room again replaces
 * the old invite, so "invite again" after a decline asks once more.
 */
export function sendInvite(
  from: { id: string; username: string }, to: string, code: string,
  lookup: RoomLookup, isFriend: (id: string) => boolean, now = Date.now(),
): { ok: true } | { ok: false; error: string } {
  sweep(now);
  if (!isFriend(to)) return { ok: false, error: 'you can only invite a friend' };
  const room = lookup(code);
  if (!room) return { ok: false, error: 'that room has closed' };
  const mine = room.seatOf(from.id);
  if (mine === null) return { ok: false, error: 'you are not sitting in that room' };
  const seat: Seat = mine === 0 ? 1 : 0;
  if (!room.free(seat)) return { ok: false, error: 'somebody already has the other seat' };
  if (room.seatOf(to) !== null) return { ok: false, error: 'they are already in this room' };
  for (const [id, inv] of invites) if (inv.from === from.id && inv.to === to && inv.room === room.code) invites.delete(id);
  if ([...invites.values()].filter(inv => inv.from === from.id).length >= OPEN_CAP) {
    return { ok: false, error: 'that is a lot of open invites — give them a minute' };
  }
  const id = `${now.toString(36)}-${(++serial).toString(36)}`;
  invites.set(id, { id, from: from.id, fromName: from.username, to, room: room.code, seat, at: now, declined: false });
  return { ok: true };
}

/** the invites waiting on this player, newest first */
export function invitesFor(userId: string, lookup: RoomLookup, now = Date.now()): InviteView[] {
  sweep(now);
  const out: InviteView[] = [];
  for (const inv of invites.values()) {
    if (inv.to !== userId) continue;
    const room = live(inv, lookup);
    if (!room) continue;
    out.push({ id: inv.id, from: inv.fromName, room: room.code, seat: inv.seat, mode: room.mode, label: room.label, at: inv.at });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Turn an invite down. The sender's room panel says so. Answering an
 * invite that has already gone is not an error: it is gone either way. */
export function declineInvite(userId: string, id: string): void {
  const inv = invites.get(id);
  if (inv && inv.to === userId) inv.declined = true;
}

/** Take an invite up: it is answered, so it goes — and so does every other
 * invite to the same room, which the friend is now on the way into. Deleted
 * here, BEFORE the join, rather than left for the seat check to hide: the
 * page the join opens polls at once, and can ask before the seat is bound,
 * which put the popup back over the room it had just brought them to. */
export function acceptInvite(userId: string, id: string): void {
  const inv = invites.get(id);
  if (!inv || inv.to !== userId) return;
  for (const [k, other] of invites) if (other.to === userId && other.room === inv.room) invites.delete(k);
}

/** what the sender's room panel shows beside each friend they invited */
export function sentFrom(userId: string, code: string, now = Date.now()): Map<string, 'sent' | 'declined'> {
  sweep(now);
  const out = new Map<string, 'sent' | 'declined'>();
  for (const inv of invites.values()) {
    if (inv.from === userId && inv.room === code) out.set(inv.to, inv.declined ? 'declined' : 'sent');
  }
  return out;
}

/** tests only: start from nothing */
export function resetInbox(): void {
  invites.clear();
  lastSeen.clear();
}
