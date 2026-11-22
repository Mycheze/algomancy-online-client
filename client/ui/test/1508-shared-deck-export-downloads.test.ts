/* A shared deck's export on the Metagame page downloads, as your own deck's does.
 *
 * The Decks page's export sheet has Copy and Download; the Metagame page's export
 * panel on a deck somebody published had Copy and Close only, so the whole-deck
 * file — the format meant to be taken away — could only be pasted.
 *
 *   §1 the panel: Download, named after the deck, .txt for the list, .json for the file
 *   §2 ui/meta.ts driven through the real client: Download hands the browser the
 *      text that is showing, under that name
 *   §3 every export panel offers both Copy and Download
 *   §4 both panels call the two formats by the same names
 *   §5 and describe them alike, naming the boards each file carries
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { deckDownloadName } from '../deckformat.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 15);
const SHARED = {
  id: 'p1508', name: 'Fire / Water: "tempo"', cards: N.flatMap(n => [n, n]), sideboard: [], cover: null, author: 'someone',
  visibility: 'public', owner: { id: 'u1', username: 'someone' },
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', problems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null }, copies: 0,
};
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url.startsWith('/api/deck/meta')) return { status: 200, json: async () => ({ ok: true, decks: [SHARED], minGames: 0 }) };
  if (url.startsWith('/api/deck/shared')) return { status: 200, json: async () => ({ ok: true, deck: SHARED }) };
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const { decksSheetHtml } = await import('../pages/decks.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

/** what the page handed the browser to save: the anchor's name and the blob's text */
const SAVED: { name: string; body: Promise<string> }[] = [];
const blobs = new Map<string, Blob>();
URL.createObjectURL = (b: Blob): string => { const u = `blob:1508/${blobs.size}`; blobs.set(u, b); return u; };
URL.revokeObjectURL = (): void => {};
const doc = g['document'] as { createElement: (t: string) => Record<string, unknown> };
const made = doc.createElement.bind(doc);
doc.createElement = (t: string) => {
  const el = made(t);
  if (t !== 'a') return el;
  return new Proxy(el, {
    get: (o, k) => (k === 'click'
      ? () => { SAVED.push({ name: String(o['download']), body: blobs.get(String(o['href']))!.text() }); }
      : o[k as string]),
    set: (o, k, v) => { o[k as string] = v; return true; },
  });
};

const textarea = (html: string): string => (/<textarea class="dkexporttext"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? '')
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const downloadName = (html: string): string | undefined =>
  /data-btn="meta-download" data-name="([^"]*)"/.exec(html)?.[1]?.replace(/&quot;/g, '"').replace(/&amp;/g, '&');

test('1508 §1 BL-10: the shared deck\'s export panel has a Download, named for the deck and the format', async () => {
  await flush();
  ui.click({ btn: 'meta-openpage' });
  await flush();
  ui.click({ btn: 'meta-open', id: 'p1508' });
  await flush();
  ui.click({ btn: 'meta-export' });
  const list = ui.click({ btn: 'meta-export', format: 'text' });
  assert.match(list, /<button data-btn="meta-download"[^>]*>Download<\/button>/, 'the card list downloads');
  assert.equal(downloadName(list), 'Fire  Water tempo.txt');
  const file = ui.click({ btn: 'meta-export', format: 'file' });
  assert.equal(downloadName(file), 'Fire  Water tempo.json', 'the whole deck downloads as a deck file');
  assert.equal(deckDownloadName('', 'text'), 'deck.txt', 'a name that is all punctuation still names a file');
});

test('1508 §2 BL-10: Download on a shared deck saves the text that is showing, under its name', async () => {
  for (const format of ['text', 'file'] as const) {
    const html = ui.click({ btn: 'meta-export', format });
    SAVED.length = 0;
    ui.click({ btn: 'meta-download' });
    assert.equal(SAVED.length, 1, `${format}: one file handed to the browser`);
    assert.equal(SAVED[0]!.name, deckDownloadName(SHARED.name, format));
    const stamp = (s: string): string => s.replace(/"exportedAt": "[^"]*"/, '"exportedAt": "…"');
    assert.equal(stamp(await SAVED[0]!.body), stamp(textarea(html)), `${format}: the file is the export on screen`);
  }
  const file = JSON.parse(await SAVED[0]!.body) as { name?: string };
  assert.equal(file.name, SHARED.name, 'the deck file carries the deck');
});

test('1508 §3 BL-10: every export panel offers Copy and Download', () => {
  const own = decksSheetHtml({ kind: 'export', format: 'text', body: '2 Ignis Sprite', downloadName: 'Mine.txt' });
  const shared = ui.click({ btn: 'meta-export', format: 'text' });
  for (const [where, html, copy, download] of [
    ['your Decks page', own, 'deck-copy-list', 'deck-download'],
    ['the Metagame page', shared, 'meta-copy-export', 'meta-download'],
  ] as const) {
    assert.match(html, new RegExp(`data-btn="${copy}"[^>]*>Copy<`), `${where}: Copy`);
    assert.match(html, new RegExp(`data-btn="${download}"[^>]*>Download<`), `${where}: Download`);
  }
});

test('1508 §4 BL-10: both export panels call the formats by the same names', () => {
  const labels = (html: string): Record<string, string> => Object.fromEntries(
    [...html.matchAll(/<button[^>]*data-format="(text|file)"[^>]*>([^<]*)<\/button>/g)].map(m => [m[1]!, m[2]!]));
  const own = labels(decksSheetHtml({ kind: 'export', format: 'text', body: '2 Ignis Sprite', downloadName: 'Mine.txt' }));
  const shared = labels(ui.click({ btn: 'meta-export', format: 'text' }));
  assert.deepEqual(Object.keys(own).sort(), ['file', 'text'], 'your Decks page offers both formats');
  assert.deepEqual(shared, own, 'the Metagame page names them as your Decks page does');
});

test('1508 §5 BL-10: both export panels describe each format alike, naming the boards the file carries', () => {
  const note = (html: string): string => (/<(?:p class="dksheetnote"|div class="hint")>([^<]*)<\/(?:p|div)>/.exec(html)?.[1] ?? '');
  for (const format of ['text', 'file'] as const) {
    const own = note(decksSheetHtml({ kind: 'export', format, body: '2 Ignis Sprite', downloadName: 'Mine.txt' }));
    const shared = note(ui.click({ btn: 'meta-export', format }));
    assert.ok(own && shared, `${format}: both panels say what the format holds`);
    assert.equal(shared, own.replace('maybeboard ', ''), `${format}: the Metagame page says it as your Decks page does`);
  }
  const shared = note(ui.click({ btn: 'meta-export', format: 'file' }));
  assert.match(shared, /sideboard/, 'a shared deck file carries its sideboard, and says so');
  assert.doesNotMatch(shared, /maybeboard/, 'a shared deck has no maybeboard to promise');
});
