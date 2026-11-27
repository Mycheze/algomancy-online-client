/* Who may use the card editor: an account holding `designer` or `admin`.
 *
 * The one place that question is asked; every card-edit route asks it first
 * and answers a refusal with the same 404 an unserved path gets, before reading
 * the body (api-admin.ts has the reason). An admin needs no designer flag, and a
 * designer gets no other admin power.
 */
import type { IncomingMessage } from 'node:http';
import { tokenOf } from './api-util.ts';
import { accountForToken, type Account } from './accounts.ts';

/** The caller's account if it may edit cards, else undefined. */
export function designerFor(req: IncomingMessage): Account | undefined {
  return designerForToken(tokenOf(req));
}

/** The same question for a session token that did not arrive as a bearer header. */
export function designerForToken(token: string | null | undefined): Account | undefined {
  const account = accountForToken(token);
  return account?.designer || account?.admin ? account : undefined;
}
