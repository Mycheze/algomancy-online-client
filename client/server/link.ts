/* BL-39 — proving that a Discord account and a game account are the same person.
 *
 * ── WHICH WAY ROUND, AND WHY ─────────────────────────────────────────
 *
 * The client MINTS a code and Discord CLAIMS it:
 *
 *   1. a signed-in player asks their own profile page for a code
 *   2. they type `/link ABCDEF` in Discord
 *   3. the bot presents it, and the account is bound to that Discord id
 *
 * Both halves are proved. The mint is bearer-authed, so only somebody already
 * signed in as that account can produce a code; and `interaction.user.id` is
 * asserted by Discord, which the bot cannot forge. The reverse direction —
 * the bot mints, you paste it on the site — proves exactly as much, and was
 * rejected for where it leaves the secret: born in a Discord message, and
 * redeemed on the surface where the player is LEAST likely to already be
 * signed in, so the flow ends at a login prompt with a live code in the
 * clipboard.
 *
 * Residual risk, stated rather than hidden: whoever holds the code can finish
 * the link. TTL, single use, and one live code per account keep the window
 * small, and the damage is visible and reversible — a stolen code links the
 * THIEF's Discord to the VICTIM's account, which the victim can see on their
 * own profile page and unlink with a bearer token the thief does not have.
 *
 * ── WHAT IS NOT PERSISTED ────────────────────────────────────────────
 *
 * Pending codes live in memory, like queue.ts's entries. A restart forgets
 * them and the recovery is "mint another", which is a button. Writing them to
 * disk would mean a second file that can be stale, for a value that is valid
 * for ten minutes.
 */

/**
 * The alphabet for anything a person has to read off one screen and type into
 * another: room codes and link codes both.
 *
 * ⚠ IT LIVES HERE AND main.ts IMPORTS IT, not the other way round. main.ts
 * imports this module, so taking the constant FROM main.ts would be a cycle —
 * one that happens to work, because it is only read inside a function body,
 * which is exactly the kind of thing that works until somebody moves a line.
 *
 * I, L and O are gone (they read as 1, 1 and 0). V stays: it is not ambiguous
 * in any font this is read in, and a test that assumed otherwise flaked.
 */
import { randomInt } from 'node:crypto';

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';

export const CODE_LENGTH = 6;
export const TTL_MS = 10 * 60 * 1000;

export interface PendingLink {
  code: string;
  userId: string;
  /** epoch ms; a code is dead at or after this */
  expiresAt: number;
}

/** code -> pending. Also indexed the other way so minting can replace. */
const byCode = new Map<string, PendingLink>();
const byUser = new Map<string, string>();

function freshCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return byCode.has(code) ? freshCode() : code;
}

/**
 * A code for this account, replacing any it already had.
 *
 * ⚠ ONE LIVE CODE PER ACCOUNT. Somebody who clicks the button twice must not
 * be left with two working codes and no idea which one the page is showing.
 */
export function mint(userId: string, now = Date.now()): PendingLink {
  const had = byUser.get(userId);
  if (had) byCode.delete(had);
  const pending: PendingLink = { code: freshCode(), userId, expiresAt: now + TTL_MS };
  byCode.set(pending.code, pending);
  byUser.set(userId, pending.code);
  return pending;
}

/**
 * Redeem a code. Returns the account id it was for, or null.
 *
 * ⚠ A WRONG CODE AND AN EXPIRED ONE ARE INDISTINGUISHABLE from here — both are
 * null, and the caller says one thing for both. Telling them apart would say
 * "that code was real, you were just slow", which is an oracle for guessing.
 */
export function claim(code: string, now = Date.now()): string | null {
  const pending = byCode.get((code || '').toUpperCase().trim());
  if (!pending || now >= pending.expiresAt) return null;
  byCode.delete(pending.code);
  byUser.delete(pending.userId);
  return pending.userId;
}

/** Drop anything that has expired. Cheap, and called on the read paths rather
 * than on a timer of its own — there is no counterpart to notify. */
export function sweepLinks(now = Date.now()): void {
  for (const [code, p] of byCode) {
    if (now >= p.expiresAt) { byCode.delete(code); byUser.delete(p.userId); }
  }
}

export function resetLinks(): void { byCode.clear(); byUser.clear(); }
export const pendingCount = (): number => byCode.size;
