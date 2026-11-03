/* The deck page opened from a constructed waiting room can be closed.
 *
 * The waiting room's deck picker offers "My decks →" (pages/deckpicker.ts deckPickerHtml),
 * which opens the full deck page in place. Its only exit, "Return to Lobby"
 * (decks.ts `deck-close`), closes the module and calls the rerender main.ts
 * gave it — and that rerender was `if (!inGame) renderHome()`, a no-op in any
 * `?room=`. The button did nothing and the player was stuck until a reload
 * (found 2026-11-02 in a browser: 0 repaints on click). In a waiting room it
 * now calls render(), which paints the waiting room while NET.waiting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
const decks = readFileSync(new URL('../decks.ts', import.meta.url), 'utf8');
// the picker left main.ts for pages/ in the design-system round (2026-11-03)
const picker = readFileSync(new URL('../pages/deckpicker.ts', import.meta.url), 'utf8');
const waiting = readFileSync(new URL('../pages/waiting.ts', import.meta.url), 'utf8');

test('positive control: the waiting room offers the deck page, and its close calls the host rerender', () => {
  // a button() since the design-system round (2026-11-03)
  assert.match(picker, /button\(\{ label: 'My decks →', className: 'deckmanage', dataBtn: 'deck-openpage' \}\)/);
  assert.match(waiting, /\$\{deckPickerHtml\(v\.deckPicker\)\}/, 'the constructed waiting room draws the picker');
  const close = decks.slice(decks.indexOf("case 'deck-close':"), decks.indexOf('return true;', decks.indexOf("case 'deck-close':")));
  assert.match(close, /rerenderHost\(\)/);
  assert.match(main, /if \(NET\?\.waiting\) \{ hideHoverTip\(\); renderWaiting\(\); return false; \}/, 'renderNow paints the room');
});

test('the deck page\'s rerender paints the waiting room when there is one', () => {
  const init = main.match(/dk\.initDecks\(\{ app: \$app, rerender: \(\) => \{([^}]*)\} \}\);/);
  assert.ok(init, 'dk.initDecks found');
  assert.match(init![1]!, /if \(!inGame\) renderHome\(\);/);
  assert.match(init![1]!, /else if \(NET\?\.waiting\) render\(\);/, 'in a room, the room is painted again');
});
