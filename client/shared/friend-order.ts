/* THE ORDER FRIENDS ARE LISTED IN, named once.
 *
 * Every friends list (the profile's Players tab, a room's Invite a friend
 * panel, the Decks page's Send to a friend) sorts with this: friends on the
 * site first (a friend in a game counts), then the ones you have played most,
 * then by name. The server sorts what it sends; the profile sorts again on the
 * inbox's live presence, which is newer than the profile's.
 */

export interface FriendOrderKey {
  username: string;
  /** on the site at all: online or in a game */
  onSite: boolean;
  /** games played against this friend */
  games: number;
}

export function compareFriends(a: FriendOrderKey, b: FriendOrderKey): number {
  return Number(b.onSite) - Number(a.onSite) || b.games - a.games || a.username.localeCompare(b.username);
}
