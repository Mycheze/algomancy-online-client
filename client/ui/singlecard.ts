/* R298 — SINGLE CARD DUEL: the card picker.
 *
 * Pick one card; your deck is thirty copies of it. Used in two places — the
 * home screen's Constructed card, where the creator picks before the room
 * exists, and the waiting room, where the joiner picks theirs. BLIND: nothing
 * here, and nothing the server sends, says which card the opponent brought.
 * You find out when it hits the table (the owner, 2026-09-18: "Blind but NO
 * reveal is all that's needed. The reveal comes in game").
 *
 * The pool is the engine's DECK_LIST — the same list `checkSingleCard` checks
 * on the server, so the picker can offer nothing the server would refuse.
 *
 * Typing never repaints the host page: the suggestions are patched in place,
 * so the input keeps its focus (the same reason ui/customrulespanel.ts gives).
 */
import { DECK_LIST } from '../engine/src/cards/registry.ts';
import { SINGLE_CARD_COPIES, makesUnits } from '../engine/src/apply.ts';
import { artHtml } from './cardpanel.ts';
import { rowFor } from './cardindex.ts';
import { esc } from './util.ts';

const STORE_KEY = 'algoSingleCard';

let draft = '';
let focusInput = false;

/** the card this browser last picked, if it is still a deck card */
export function chosen(): string | null {
  try {
    const n = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORE_KEY);
    return n && DECK_LIST.includes(n) ? n : null;
  } catch { return null; }
}

function choose(name: string): void {
  try { localStorage.setItem(STORE_KEY, name); } catch { /* private mode: this page only */ }
  draft = '';
}

function suggestionsHtml(): string {
  const q = draft.trim().toLowerCase();
  if (q.length < 2) return '';
  const hits = DECK_LIST.filter(n => n.toLowerCase().includes(q)).slice(0, 8);
  return hits.length
    ? hits.map(n => `<button data-btn="sc-pick" data-name="${esc(n)}" data-prev="${esc(n)}">${esc(n)}</button>`).join('')
    : '<span class="dim">no card by that name</span>';
}

/** the picker: the chosen card's scan, a type-ahead and a 🎲 */
export function pickerHtml(): string {
  const cur = chosen();
  const row = cur ? rowFor(cur) : null;
  return `<div class="scpick">
    <div class="scchosen">${cur
      ? `<span class="scart" data-prev="${esc(cur)}">${row ? artHtml(row, 'scimg') : ''}</span>
         <span class="scname"><b>${esc(cur)}</b><span class="dim">× ${SINGLE_CARD_COPIES}</span>${makesUnits(cur) ? ''
           : `<span class="scwarn" title="a deck of this card can never put a unit on the table">makes no units — if your opponent's card doesn't either, the game is a draw</span>`}</span>`
      : '<span class="dim">no card picked yet</span>'}</div>
    <div class="joinrow">
      <input id="sc-q" placeholder="find a card…" spellcheck="false" autocomplete="off" value="${esc(draft)}">
      <button data-btn="sc-random" title="any card at random — any of the ${DECK_LIST.length}">🎲</button>
    </div>
    <div id="sc-sugg" class="crsugg">${suggestionsHtml()}</div>
  </div>`;
}

/** the picker's clicks — true when handled; the caller repaints */
export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'];
  if (b === 'sc-pick') {
    const n = btn.dataset['name'] ?? '';
    if (DECK_LIST.includes(n)) choose(n);
    return true;
  }
  if (b === 'sc-random') {
    choose(DECK_LIST[Math.floor(Math.random() * DECK_LIST.length)]!);
    return true;
  }
  return false;
}

/** after the host paints: keep typing in place (see the header) */
export function wire(): void {
  const q = document.getElementById('sc-q') as HTMLInputElement | null;
  if (!q) return;
  q.addEventListener('input', () => {
    draft = q.value;
    const list = document.getElementById('sc-sugg');
    if (list) list.innerHTML = suggestionsHtml();
  });
  q.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    focusInput = true;
    (document.querySelector('#sc-sugg [data-btn="sc-pick"]') as HTMLElement | null)?.click();
  });
  if (focusInput) { q.focus(); focusInput = false; }
}
