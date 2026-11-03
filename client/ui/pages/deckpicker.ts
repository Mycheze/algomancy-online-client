/* The constructed deck picker: which deck this browser brings to a game.
 *
 * Drawn in three places — the home screen's Constructed card, the constructed
 * (and constructed league) waiting room, and the matchmaking queue's
 * constructed picker (ui/queue.ts borrows it through initQueue rather than
 * growing a second one: which decks are offered is a rule with one home).
 *
 * Moved out of main.ts in the design-system round, 2026-11-03, with its state
 * (the bundled default list and the import message), which nothing else in
 * main.ts read. The chosen deck itself lives in ui/util.ts (chosenDeck /
 * chooseDeck), because the decks page writes it too. */
import * as acct from '../account.ts';
import * as dk from '../decks.ts';
import { button, statusMessage } from '../components/index.ts';
import { chooseDeck, chosenDeck, esc, type ChosenDeck } from '../util.ts';

/** the bundled default decks — fetched once from the server */
let defaultDeckList: ChosenDeck[] | null = null;
let defaultDecksLoading = false;
/** import status / problems shown under the deck picker */
let deckMsg = '';

function ensureDefaultDecks(then: () => void): void {
  if (defaultDeckList || defaultDecksLoading) return;
  defaultDecksLoading = true;
  fetch('/api/deck/defaults').then(r => r.json()).then((r: { decks: (ChosenDeck & { problems: string[] })[] }) => {
    defaultDeckList = r.decks.filter(d => !d.problems.length);
    then();
  }).catch(() => { deckMsg = 'could not load the default decks from the server'; then(); });
}

export interface DeckPickerView {
  /** the deck this browser brings (ui/util.ts chosenDeck), or none yet */
  current: ChosenDeck | null;
  /** signed in: the "My decks →" button, and the loading line says "your decks" */
  signedIn: boolean;
  /** the LEGAL decks of the signed-in collection; empty signed out (or still loading) */
  mine: readonly ChosenDeck[];
  /** the bundled defaults, or null while they load */
  defaults: readonly ChosenDeck[] | null;
  /** the import status / problem line, or '' */
  msg: string;
}

/** gather the picker's state: the chosen deck, the account, the two lists */
export function deckPickerView(): DeckPickerView {
  return {
    current: chosenDeck(),
    signedIn: !!acct.token(),
    mine: acct.token() ? dk.playableDecks() : [],
    defaults: defaultDeckList,
    msg: deckMsg,
  };
}

/**
 * The picker's markup. Pure: everything comes in through `v` (deckPickerView).
 *
 * Two sources, and only ever one of them at a time. Signed in, it is YOUR
 * saved collection (ui/decks.ts) — which already holds copies of the five
 * bundled decks, seeded at first sight, so offering both would list the same
 * decks twice under two different identities. Signed out there is no
 * collection, so it falls back to the bundled five plus import-by-link, which
 * is exactly what this picker was before the collection existed.
 *
 * Only LEGAL decks are offered: a picker that lets you choose a 27-card deck
 * and then refuses the game is a worse way to say "not yet" than not offering
 * it. The decks page says which ones those are and why.
 */
export function deckPickerHtml(v: DeckPickerView, o: { importHtml?: string } = {}): string {
  const cur = v.current;
  const mine = v.mine;
  const msg = v.msg;
  const manage = v.signedIn
    ? button({ label: 'My decks →', className: 'deckmanage', dataBtn: 'deck-openpage' })
    : '';

  if (mine.length) {
    const opts = mine.map((d, i) =>
      `<option value="c${i}" ${cur && cur.id === d.id ? 'selected' : ''}>${esc(d.name)}${
        d.author && d.author !== 'you' ? ` — by ${esc(d.author)}` : ''}</option>`).join('');
    const strayOpt = cur && !mine.some(d => d.id === cur.id)
      ? `<option value="stray" selected>${esc(cur.name)} (not in your collection)</option>` : '';
    const info = cur
      ? `<div class="deckinfo">${cur.cards.length} cards${cur.url
          ? ` · <a href="${esc(cur.url)}" target="_blank" rel="noopener">algomancer.cc</a>` : ''}</div>`
      : '<div class="deckinfo"></div>';
    return `<select id="h-deck" class="deckselect">
        ${cur ? '' : '<option value="" selected disabled>choose a deck…</option>'}${opts}${strayOpt}
      </select>
      ${info}${manage}
      ${msg ? statusMessage({ tone: 'note', className: 'deckmsg', text: msg }) : ''}`;
  }

  const defaults = v.defaults;
  if (!defaults) {
    return `<div class="hint">${v.signedIn ? 'loading your decks…' : 'loading the deck list…'}</div>${
      msg ? statusMessage({ tone: 'note', className: 'deckmsg', text: msg }) : ''}${manage}`;
  }
  const isDefault = !!cur && defaults.some(d => d.name === cur.name && d.url === cur.url);
  const opts = defaults.map((d, i) =>
    `<option value="d${i}" ${cur && d.name === cur.name && d.url === cur.url ? 'selected' : ''}>${esc(d.name)} — by ${esc(d.author)}</option>`).join('');
  const customOpt = cur && !isDefault
    ? `<option value="custom" selected>${esc(cur.name)}${cur.author && cur.author !== 'you' ? ` — by ${esc(cur.author)}` : ''} (imported)</option>` : '';
  const info = cur
    ? `<div class="deckinfo">${cur.cards.length} cards · by ${esc(cur.author)}${cur.url
        ? ` · <a href="${esc(cur.url)}" target="_blank" rel="noopener">view on algomancer.cc</a>` : ''}</div>`
    : '<div class="deckinfo"></div>';
  return `<select id="h-deck" class="deckselect">
      ${cur ? '' : '<option value="" selected disabled>choose a deck…</option>'}${opts}${customOpt}
    </select>
    ${info}${manage}
    ${o.importHtml ?? deckImportHtml()}
    ${msg ? statusMessage({ tone: 'note', className: 'deckmsg', text: msg }) : ''}`;
}

/** The signed-out picker's two ways to bring a deck of your own: an
 * algomancer.cc link and a pasted list. Drawn under the picker by default; the
 * home screen (docs/24, 2026-11-03) passes `importHtml` to deckPickerHtml
 * instead and draws this in its Import sheet. Pure. */
export function deckImportHtml(): string {
  return `<div class="joinrow deckimport">
      <input id="h-deckurl" placeholder="algomancer.cc deck link" spellcheck="false">
      ${button({ label: 'Load', dataBtn: 'deckimporturl' })}
    </div>
    <details class="deckpaste"><summary>…or paste a deck list</summary>
      <textarea id="h-decktext" rows="6" spellcheck="false" placeholder="1 Ignis Sprite&#10;2 Overwhelm&#10;…"></textarea>
      ${button({ label: 'Use pasted list', dataBtn: 'deckimporttext' })}
    </details>`;
}

/** the picker as it stands now — what ui/queue.ts is handed as `deckPickerHtml` */
export const deckPicker = (): string => deckPickerHtml(deckPickerView());

/** wire the picker's <select> after (re)rendering the screen holding it */
export function wireDeckPicker(rerender: () => void): void {
  // BOTH sources, always: a signed-in player whose collection is empty (they
  // deleted the starters) falls through to the bundled list, and fetching only
  // the collection would leave that picker saying "loading…" for ever
  ensureDefaultDecks(rerender);
  if (acct.token()) dk.ensureCollection(rerender);
  const sel = document.getElementById('h-deck') as HTMLSelectElement | null;
  sel?.addEventListener('change', () => {
    const v = sel.value;
    if (v.startsWith('c')) {
      const d = dk.playableDecks()[Number(v.slice(1))];
      if (d) { chooseDeck(d); deckMsg = ''; }
    } else if (v.startsWith('d') && defaultDeckList) {
      const d = defaultDeckList[Number(v.slice(1))];
      if (d) { chooseDeck(d); deckMsg = ''; }
    }
    rerender();
  });
}

/** import a deck through the server (link fetch or paste parse) */
export function importDeck(body: { url?: string; text?: string }, rerender: () => void): void {
  deckMsg = 'importing…';
  rerender();
  fetch('/api/deck/import', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json()).then((r: { ok: boolean; error?: string; deck?: ChosenDeck & { problems: string[] } }) => {
    if (!r.ok || !r.deck) { deckMsg = r.error ?? 'import failed'; rerender(); return; }
    if (r.deck.problems.length) {
      deckMsg = `not playable: ${r.deck.problems.slice(0, 4).join(' · ')}${r.deck.problems.length > 4 ? ` (+${r.deck.problems.length - 4} more)` : ''}`;
      rerender(); return;
    }
    chooseDeck(r.deck);
    deckMsg = `loaded ${r.deck.name} (${r.deck.cards.length} cards) by ${r.deck.author}`;
    // the link or list is used up: empty its box BEFORE the repaint, which
    // otherwise carries typed text across (HOME_TYPED) and would put it back
    for (const id of ['h-deckurl', 'h-decktext']) {
      const box = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
      if (box) box.value = '';
    }
    rerender();
  }).catch(() => { deckMsg = 'could not reach the server'; rerender(); });
}
