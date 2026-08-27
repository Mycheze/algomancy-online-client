/* Tiny shared helpers for the UI modules — the pieces that were being copied
 * between main, lobby, account and postgame until the copies drifted. */

/** HTML-escape for interpolating untrusted text into markup */
export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** The game's REAL icon (element pip, cost circle, marker) as an inline img.
 * `alt` shows only while the file is missing: pass the name where no word is
 * printed beside the icon (the topbar trio), nothing where one already is. */
export const elIcon = (el: string, alt = ''): string =>
  `<img class="elicon" src="/Icons/${el}.webp" alt="${alt}" onerror="this.style.display='none'">`;

/** The "send your opponent this link" strip. One copy of the furniture for
 * the draft lobby, the constructed waiting room and the mid-game banner —
 * only the lead-in sentence differs between them. */
export const shareBar = (lead: string, room: string, link: string): string =>
  `<div class="sharebar">${lead} <b>${esc(room)}</b> or this link:
    <input class="sharelink" readonly value="${esc(link)}" onclick="this.select()">
    <button data-btn="copylink" data-link="${esc(link)}">copy</button></div>`;

/* ── the deck you are bringing to constructed ─────────────────────────
 *
 * One browser-local choice, read by the home screen, the constructed waiting
 * room, the hotseat rig and the socket join — and WRITTEN by two screens that
 * cannot import each other (main.ts's picker and the decks page). It lived as
 * a private pair of functions in main.ts until the second writer arrived.
 *
 * `id` is the collection deck this came from, when it came from one. It rides
 * along on the join so the server can credit the game to that deck's record
 * (server/collection.ts); a pasted list or a logged-out pick simply has none.
 */
export interface ChosenDeck {
  id?: string;
  name: string;
  author: string;
  url?: string;
  cards: string[];
}

const CHOSEN_KEY = 'algoDeck';

export const chosenDeck = (): ChosenDeck | null => {
  try {
    const d = JSON.parse(localStorage.getItem(CHOSEN_KEY) ?? '') as ChosenDeck;
    return Array.isArray(d?.cards) && d.cards.length ? d : null;
  } catch { return null; }
};

export const chooseDeck = (d: ChosenDeck): void => {
  localStorage.setItem(CHOSEN_KEY, JSON.stringify({
    ...(d.id ? { id: d.id } : {}), name: d.name, author: d.author,
    ...(d.url ? { url: d.url } : {}), cards: d.cards,
  }));
};
