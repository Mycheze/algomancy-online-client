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
