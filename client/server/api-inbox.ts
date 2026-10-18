/* /api/inbox and /api/invite — the bell and the room's friends panel.
 *
 * Every signed-in page polls GET /api/inbox (ui/inbox.ts). The answer is
 * everything the bell counts — invites to a game, friend requests — plus
 * the friends list with who is around, which the room's friends panel is
 * drawn from. `?room=CODE` adds, per friend, whether this player has
 * already invited them to that room. State and the rules about it are in
 * inbox.ts; this file is the HTTP and the friends list.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { addrOf, json, rateLimited, readBody, str, tokenOf } from './api-util.ts';
import { accountById, accountForToken, favoriteOf } from './accounts.ts';
import { acceptInvite, declineInvite, invitesFor, sendInvite, sentFrom, touch, type RoomLookup } from './inbox.ts';
import type { Element } from '../engine/src/types.ts';

export interface InboxContext {
  /** on the site at all — seated, or polling this (main.ts isOnline) */
  online: (userId: string) => boolean;
  /** the accounts sitting at a table that has been dealt and is not over */
  playing: () => Set<string>;
  lookup: RoomLookup;
}

export type FriendStatus = 'online' | 'playing' | 'offline';

/** one friend, as the room panel draws them */
export interface InboxFriend {
  id: string; username: string; favoriteElement: Element | null;
  status: FriendStatus;
  /** only with `?room=`: whether they have been invited to it */
  invite: 'sent' | 'declined' | null;
}

const ORDER: Record<FriendStatus, number> = { online: 0, playing: 1, offline: 2 };

export async function inboxRoutes(
  req: IncomingMessage, res: ServerResponse, path: string, url: URL, ctx: InboxContext,
): Promise<boolean> {
  if (path !== '/api/inbox' && !path.startsWith('/api/invite')) return false;
  const me = accountForToken(tokenOf(req));
  if (!me) return json(res, { ok: false, error: 'log in first' }, 401), true;

  if (path === '/api/inbox' && req.method === 'GET') {
    touch(me.id);
    const code = str(url.searchParams.get('room'), 12).toUpperCase();
    const sent = code ? sentFrom(me.id, code) : new Map<string, 'sent' | 'declined'>();
    const playing = ctx.playing();
    const friends: InboxFriend[] = me.friends.flatMap(id => {
      const a = accountById(id);
      if (!a) return [];
      const status: FriendStatus = playing.has(id) ? 'playing' : ctx.online(id) ? 'online' : 'offline';
      return [{ id, username: a.username, favoriteElement: favoriteOf(a), status, invite: sent.get(id) ?? null }];
    }).sort((x, y) => ORDER[x.status] - ORDER[y.status] || x.username.localeCompare(y.username));
    return json(res, {
      ok: true,
      invites: invitesFor(me.id, ctx.lookup),
      requests: me.incoming.flatMap(id => {
        const a = accountById(id);
        return a ? [{ id, username: a.username }] : [];
      }),
      friends,
    }), true;
  }

  if (path === '/api/invite' && req.method === 'POST') {
    // a person clicks a friend at a time; this only stops a loop
    if (rateLimited(addrOf(req), 'invite', 60, 60_000)) {
      return json(res, { ok: false, error: 'too many invites — wait a minute' }, 429), true;
    }
    const b = await readBody(req);
    const r = sendInvite(me, str(b['to'], 64), str(b['room'], 12).toUpperCase(), ctx.lookup,
      id => me.friends.includes(id));
    return json(res, r), true;
  }

  // Join on the popup: answered, so gone before the join's page asks again
  if (path === '/api/invite/accept' && req.method === 'POST') {
    const b = await readBody(req);
    acceptInvite(me.id, str(b['id'], 64));
    return json(res, { ok: true }), true;
  }

  if (path === '/api/invite/decline' && req.method === 'POST') {
    const b = await readBody(req);
    declineInvite(me.id, str(b['id'], 64));
    return json(res, { ok: true }), true;
  }

  json(res, { ok: false, error: `no such endpoint: ${path}` }, 404);
  return true;
}
