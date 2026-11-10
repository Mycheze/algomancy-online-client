/* Sending a deck to a friend: a line in their bell that opens it.
 *
 * Owner, 2026-11-10 (#steward): "I want a way to easily share a deck (inside
 * the webapp) to a friend. When you're on the deck sharing page, there should
 * be way to, basically, send them a notification that they can click on to
 * view the deck you want them to see." The Decks page's Share sheet lists
 * your friends with a Send button each; the friend's bell (ui/inbox.ts) gets
 * "<you> sent you <deck>" with a View button that opens the shared deck page
 * (`?deck=<id>`), the same page the share link opens.
 *
 * ── WHY IT IS NOT IN inbox.ts ────────────────────────────────────────
 *
 * inbox.ts keeps game invites in memory on purpose: a restart drops every
 * seat, so an invite to one is dead anyway. A deck is not — it is still
 * there after a deploy, and the friend it was sent to may not open the site
 * until tomorrow. So a sent deck is kept on the RECIPIENT's account
 * (`Account.deckShares`, top-level for the same reason `linked` is) and
 * written with the accounts store.
 *
 * ── WHAT IT TRUSTS ───────────────────────────────────────────────────
 *
 * The share holds ids only. The deck's name and whether it may be seen are
 * read off the SENDER's collection every time the bell asks, through the one
 * visibility rule (collection.ts visibilityOf): a deck made private, or
 * deleted, after it was sent is not shown — hidden, not deleted, so making it
 * unlisted again brings the line back — and a private deck cannot be sent at
 * all, because the page the button opens would refuse the friend.
 */
import { accountById, saveAccounts, type Account } from './accounts.ts';
import { visibilityOf, type CollectionDeck } from './collection.ts';

/** one deck sent to this account, as stored on it */
export interface DeckShare {
  id: string;
  /** the sender's account id */
  from: string;
  /** the deck's id, in the sender's collection */
  deck: string;
  /** epoch ms */
  at: number;
}

/** what the recipient's bell is sent */
export interface DeckShareView {
  id: string;
  /** the sender's name, as it is now */
  from: string;
  deck: string;
  /** the deck's name, as it is now */
  name: string;
  at: number;
}

/** the most sent decks one account keeps — the oldest go first; a brake, not a rule */
export const DECK_SHARE_CAP = 20;

let serial = 0;

/** the sender's deck, if it is still theirs and still shared */
function liveDeck(fromId: string, deckId: string): { owner: Account; deck: CollectionDeck } | null {
  const owner = accountById(fromId);
  const deck = owner?.decks?.find(d => d.id === deckId);
  if (!owner || !deck || visibilityOf(deck) === 'private') return null;
  return { owner, deck };
}

/**
 * Send one of my decks to a friend. Sending the same deck to the same friend
 * again replaces the old line (it comes back to the top of their bell) rather
 * than adding a second.
 */
export function sendDeck(me: Account, toId: string, deckId: string, now = Date.now()): { ok: true } | { ok: false; error: string } {
  const to = accountById(toId);
  if (!to || !me.friends.includes(toId)) return { ok: false, error: 'you can only send a deck to a friend' };
  const deck = me.decks?.find(d => d.id === deckId);
  if (!deck) return { ok: false, error: 'that deck is not in your collection' };
  if (visibilityOf(deck) === 'private') {
    return { ok: false, error: 'this deck is private — choose Unlisted or Public so they can open it' };
  }
  const kept = (to.deckShares ?? []).filter(s => !(s.from === me.id && s.deck === deckId));
  kept.push({ id: `${now.toString(36)}-${(++serial).toString(36)}`, from: me.id, deck: deckId, at: now });
  to.deckShares = kept.slice(-DECK_SHARE_CAP);
  saveAccounts();
  return { ok: true };
}

/** the decks waiting in this account's bell, newest first — only the ones it can still open */
export function deckSharesFor(account: Account): DeckShareView[] {
  const out: DeckShareView[] = [];
  for (const s of account.deckShares ?? []) {
    // a friend since removed has no business in the bell
    if (!account.friends.includes(s.from)) continue;
    const live = liveDeck(s.from, s.deck);
    if (!live) continue;
    out.push({ id: s.id, from: live.owner.username, deck: s.deck, name: live.deck.name, at: s.at });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** The line was opened or dismissed: it goes. One already gone is not an error. */
export function clearDeckShare(account: Account, id: string): void {
  const before = account.deckShares ?? [];
  const after = before.filter(s => s.id !== id);
  if (after.length === before.length) return;
  account.deckShares = after;
  saveAccounts();
}
