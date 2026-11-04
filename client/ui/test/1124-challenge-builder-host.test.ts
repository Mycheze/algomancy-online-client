/* BL-65 — THE WEEKLY CHALLENGE ON THE BUILDER (ui/challenge.ts's table host).
 *
 * The challenge is built on the same builder as a constructed deck: the pool
 * over a scratch table, the deck as a strip along the bottom in deal order
 * (540 drives the strip). What the challenge's host adds, through the real
 * client from a reload on `?table=ch:<id>`:
 *
 *   §1 a tap on a pool card adds ONE copy at the END of the deck strip (what
 *      is on top was put there on purpose), and the draft is saved that way
 *   §2 Import a deck is a side sheet of the saved decks; a pick replaces the
 *      strip, and the BUILDER's Undo brings the old order back (Redo again)
 *   §3 Esc and the sheet's own dismiss close the sheet; Back leaves no sheet
 *      open on the page
 *   §4 Play on the toolbar waits for a deck the engine would deal
 *   §5 the card browser's bridge is gone: no fullBrowser, no bridgeFor, no
 *      useDeck from the challenge
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import type { ChallengeDef } from '../../engine/src/challenge.ts';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (f: string): string => readFileSync(join(UI, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const NOW = Date.UTC(2026, 9, 26, 12);
const DEF: ChallengeDef = { id: 'c1124', week: '2026-10-25', title: 'Host week', blurb: '', goal: { kind: 'unitsInPlay', n: 30 }, seed: 112400, par: 50 };
const CUR = { ...DEF, opens: NOW - 86_400_000, closes: NOW + 5 * 86_400_000, closed: false, entrants: 0 };
const units = DECK_LIST.filter(n => getCard(n).kind === 'unit').slice(0, 8);
const LIST = [...units.slice(0, 6)];
const CHOSEN = [units[7]!, units[6]!, units[6]!];

const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = `?challenge=${DEF.id}&table=ch:${DEF.id}`;
g['__UI_DRIVER_STORE'] = {
  algoToken: 't1124',
  algoChallengeDecks: JSON.stringify({ [DEF.id]: LIST }),
  // no collection answers (below), so the import offers the deck chosen on the home page
  algoDeck: JSON.stringify({ name: 'Chosen', author: 'me', cards: CHOSEN }),
};
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url === '/api/challenge') return { status: 200, json: async () => ({ now: NOW, current: CUR, past: [] }) };
  if (url === `/api/challenge/${DEF.id}/board`) return { status: 200, json: async () => ({ id: DEF.id, closed: false, rows: [] }) };
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
await flush();

const unesc = (s: string): string => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
/** the strip's cards, left to right */
const names = (html: string): string[] => {
  const at = html.indexOf('data-tt-zone="strip"');
  assert.ok(at >= 0, 'the deck strip is on the page');
  return [...html.slice(at).matchAll(/data-tt-src="strip\|\d+\|[^"]+" data-tt-i="\d+" data-card="([^"]+)"/g)].map(m => unesc(m[1]!));
};
const draft = (): string[] => JSON.parse((g['localStorage'] as Storage).getItem('algoChallengeDecks') ?? '{}')[DEF.id] ?? [];
const sheetOpen = (html: string): boolean => /id="ch-importsheet"/.test(html);

test('§1 a pool tap adds one copy at the END of the strip, and the draft is saved so', () => {
  let html = ui.html();
  assert.deepEqual(names(html), LIST, 'non-vacuous: the draft is on the strip');
  const tiles = [...html.matchAll(/data-btn="tt-add" data-tt-src="(binder\|[^"]+)"/g)].map(m => unesc(m[1]!));
  assert.ok(tiles.length > 3, `the pool is over the table: ${tiles.length} cards`);
  const src = tiles[2]!;
  const name = src.slice('binder|'.length);
  html = ui.click({ btn: 'tt-add', 'tt-src': src });
  assert.deepEqual(names(html), [...LIST, name], 'one copy, at the bottom of the deck');
  assert.deepEqual(draft(), [...LIST, name], 'and saved');
  assert.match(html, new RegExp(`>${LIST.length + 1} in the deck<`), 'the pill counts it');
  // a second tap on the same card: another copy, still at the end (no copy cap in a challenge)
  html = ui.click({ btn: 'tt-add', 'tt-src': src });
  assert.deepEqual(names(html), [...LIST, name, name]);
  // back to the draft the other tests start from
  html = ui.click({ btn: 'tt-undo' });
  html = ui.click({ btn: 'tt-undo' });
  assert.deepEqual(names(html), LIST, 'the builder’s Undo takes both back');
});

test('§2 Import a deck: a side sheet of the saved decks; a pick replaces the strip, one Undo away', () => {
  let html = ui.html();
  assert.equal(sheetOpen(html), false);
  html = ui.click({ btn: 'ch-import' });
  assert.ok(sheetOpen(html), 'the sheet opens on the table');
  assert.match(html, /class="ui-sheet ui-sheet--side[^"]*"/, 'a side sheet');
  assert.match(html, /data-btn="ch-importdeck"[^>]*data-id="__chosen"[^>]*>Chosen <span class="dim">3</);
  assert.match(html, /data-btn="tt-add"/, 'still on the table, the pool under the sheet');
  html = ui.click({ btn: 'ch-importdeck', id: '__chosen' });
  assert.equal(sheetOpen(html), false, 'a pick closes it');
  assert.deepEqual(names(html), CHOSEN, 'the strip is the imported deck, in its order');
  assert.deepEqual(draft(), CHOSEN, 'saved');
  html = ui.click({ btn: 'tt-undo' });
  assert.deepEqual(names(html), LIST, 'the builder’s Undo brings the old order back');
  assert.deepEqual(draft(), LIST);
  html = ui.click({ btn: 'tt-redo' });
  assert.deepEqual(names(html), CHOSEN, 'and Redo the import');
  html = ui.click({ btn: 'tt-undo' });
  assert.deepEqual(names(html), LIST);
});

test('§3 the sheet closes on Esc and on its own dismiss; Back leaves nothing open', () => {
  let html = ui.click({ btn: 'ch-import' });
  assert.ok(sheetOpen(html));
  html = ui.key('Escape');
  assert.equal(sheetOpen(html), false, 'Esc');
  html = ui.click({ btn: 'ch-import' });
  assert.ok(sheetOpen(html));
  const scrim = /<div class="ui-sheet__scrim" data-btn="([^"]+)"/.exec(html)?.[1];
  assert.equal(scrim, 'ch-import', 'the scrim and ✕ dismiss it');
  html = ui.click({ btn: 'ch-import' });
  assert.equal(sheetOpen(html), false);
  html = ui.click({ btn: 'ch-import' });
  html = ui.click({ btn: 'tt-close' });
  assert.match(html, /apppage chpage"/, 'the challenge page');
  assert.doesNotMatch(html, /class="chimport"/, 'its own import list is not left open by the table’s');
  html = ui.click({ btn: 'ch-tabletop' });
  assert.equal(sheetOpen(html), false, 'and the table opens again without it');
  assert.deepEqual(names(html), LIST);
});

test('§4 Play on the toolbar waits for a deck the engine would deal', () => {
  let html = ui.html();
  assert.match(html, /data-btn="ch-play"/);
  assert.doesNotMatch(html, /<button[^>]*data-btn="ch-play"[^>]*disabled[^>]*>Play</, 'a legal deck can be played');
  // empty the strip: every card back off the deck, through the pool (the remove zone)
  for (let k = LIST.length - 1; k >= 0; k--) {
    html = ui.tap({ 'tt-src': `strip|${k}|${names(html)[k]}` });
    html = ui.click({ btn: 'tt-cut' });
  }
  assert.deepEqual(names(html), [], 'non-vacuous: nothing left in the deck');
  assert.match(html, />0 in the deck</);
  assert.match(html, /data-btn="ch-play"[^>]*disabled/, 'Play waits');
  for (let k = 0; k < LIST.length; k++) html = ui.click({ btn: 'tt-undo' });
  assert.deepEqual(names(html), LIST);
});

test('§5 the card browser’s bridge is gone from the challenge', () => {
  for (const f of ['challenge.ts', 'challengebuild.ts', 'tabletop.ts']) {
    assert.doesNotMatch(code(f), /fullBrowser|bridgeFor|useDeck|DeckBridge|openBrowser/, `${f} has no card browser bridge`);
  }
});
