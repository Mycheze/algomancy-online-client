/* The player's half of Discord linking: mint a code, and unlink.
 *
 * Both routes are BEARER-authed, which is the security property the whole flow
 * rests on — see link.ts for why the code travels client -> Discord and not the
 * other way. The bot's half (claiming a code, unlinking from Discord) is in
 * api-bot.ts behind the bot token.
 *
 * ⚠ UNLINKING MUST WORK FROM BOTH SIDES, and this is the side that matters
 * most. There is no password reset on this server and no email, so an account
 * is only ever reachable by its own password — which makes the web the durable
 * side. Somebody who loses access to their Discord unlinks from here; somebody
 * who wants their Discord back unlinks from there.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, str, tokenOf } from './api-util.ts';
import { accountForToken, privateView, saveAccounts } from './accounts.ts';
import { mint, sweepLinks } from './link.ts';

/** Handle a /api/link/ route. True when the request was ours. */
export function linkRoutes(
  req: IncomingMessage, res: ServerResponse, path: string,
  ctx: { online: (id: string) => boolean; enabled: boolean },
): boolean {
  if (!path.startsWith('/api/link/')) return false;

  // With no bot token configured there is nothing on the other end to claim a
  // code, so the feature is absent rather than broken. /api/me says as much,
  // and the profile page hides the button.
  if (!ctx.enabled) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return true;
  }

  const account = accountForToken(tokenOf(req));
  if (!account) {
    json(res, { ok: false, error: 'sign in first' }, 401);
    return true;
  }

  if (path === '/api/link/discord/code' && req.method === 'POST') {
    if (account.linked?.discord) {
      json(res, {
        ok: false,
        error: `this account is already linked to @${account.linked.discord.username}`
             + ' — unlink it first',
      });
      return true;
    }
    sweepLinks();
    const pending = mint(account.id);
    json(res, {
      ok: true, code: pending.code, expiresAt: pending.expiresAt,
      expiresInMs: pending.expiresAt - Date.now(),
    });
    return true;
  }

  if (path === '/api/link/discord/unlink' && req.method === 'POST') {
    if (account.linked) delete account.linked.discord;
    saveAccounts();
    json(res, { ok: true, me: privateView(account, ctx.online) });
    return true;
  }

  json(res, { ok: false, error: `no such link route: ${str(path)}` }, 404);
  return true;
}
