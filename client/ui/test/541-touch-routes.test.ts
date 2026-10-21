/* EVERY DRAG ON THE TABLETOP HAS A TAP ROUTE (ui/tabletop.ts) — for a finger.
 *
 * On a tablet the table scrolls, so a finger holds a card to lift it — and if
 * a browser claims that hold as a pan, the tap route is what is left. It is a
 * FINGER's route only: v1 made it the mouse's too, and the owner's whole
 * experience of v1 was "click and click again to drop". So a tap picks a card
 * up, a mouse click reads it; the pointer that pressed decides, never the
 * device. Through the real client:
 *
 *   §1 a tap picks a card up (it shows in the binder too); a second tap on it
 *      puts it down; Escape puts it down
 *   §2 then a tap on a pile lands it at the pile's end; a tap on a card lands
 *      it before that card
 *   §3 the bar: Cut takes it out, Maybe and To deck move it, New pile makes one
 *   §4 the grip picks a pile up, and ◀ ▶ move it along the row
 *   §5 a mouse click on the same card picks nothing up
 *   §6 every intent of the drag model has its tap: the list, against the code
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (f: string): string => readFileSync(join(UI, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const DECK = {
  id: 'd541', name: 'Touch deck', maybe: [], cover: null,
  cards: ['Ignis Sprite', 'Ignis Sprite', 'Good Whale', 'Good Whale', 'Fireball'],
  author: 'you', createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z', problems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '?table=d541';
g['__UI_DRIVER_STORE'] = { algoToken: 't541' };
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [DECK] }) };
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
await flush();

/** the table's piles as [zone, [card names]] (Maybe included, last) */
const table = (html: string): [string, string[]][] =>
  [...html.matchAll(/<section class="ttpile[^"]*" data-tt-zone="([^"]+)"[\s\S]*?<\/section>/g)]
    .map(m => [m[1]!, [...m[0].matchAll(/data-tt-src="[^"]*" data-tt-i="\d+" data-card="([^"]+)"/g)].map(c => c[1]!)]);
const srcs = (html: string, zone: string): string[] => {
  const at = html.indexOf(`data-tt-zone="${zone}"`);
  const next = html.indexOf('<section class="ttpile', at + 10);
  return [...html.slice(at, next < 0 ? undefined : next).matchAll(/data-tt-src="([^"]+)"/g)].map(m => m[1]!);
};
const piles = (html: string): string[] => table(html).map(p => p[0]).filter(z => z.startsWith('pile|'));
const total = (html: string): number => table(html).filter(p => p[0].startsWith('pile|')).reduce((n, p) => n + p[1].length, 0);

test('§1 a tap picks a card up, a second tap or Escape puts it down', () => {
  const [z] = piles(ui.html());
  const src = srcs(ui.html(), z!)[0]!;
  let html = ui.tap({ 'tt-src': src });
  assert.match(html, /class="ttselbar"/, 'picked up: its bar is up');
  assert.match(html, new RegExp(`class="ttcard[^"]*ttpicked[^"]*"[^>]*data-tt-src="${src.replace(/[|]/g, '\\|')}"`), 'and it is marked');
  assert.match(html, /class="ddpinbox"/, 'one gesture reads it too');
  html = ui.tap({ 'tt-src': src });
  assert.doesNotMatch(html, /class="ttselbar"/, 'a second tap puts it down');
  ui.tap({ 'tt-src': src });
  html = ui.key('Escape');
  html = ui.key('Escape');
  assert.doesNotMatch(html, /class="ttselbar"/, 'Escape puts it down (after the binder has unpinned)');
});

test('§2 a tap on a pile lands it at the end; a tap on a card, before that card', () => {
  let html = ui.html();
  const [a, b] = piles(html);
  const card = srcs(html, a!)[0]!;
  const name = card.split('|').slice(3).join('|');
  const nB = table(html).find(p => p[0] === b)![1].length;
  ui.tap({ 'tt-src': card });
  html = ui.tap({ btn: 'tt-to', 'tt-zone': b! });
  const after = table(html).find(p => p[0] === b)![1];
  assert.equal(after.length, nB + 1);
  assert.equal(after[after.length - 1], name, 'at the end of the pile');
  assert.match(html, new RegExp(`class="ttcard ttfront[^"]*"[^>]*data-card="${name}"`), 'drawn in front');
  // and back again, before the first card of a pile
  const first = srcs(html, piles(html)[0]!)[0]!;
  const moving = srcs(html, b!)[after.length - 1]!;
  ui.tap({ 'tt-src': moving });
  html = ui.tap({ 'tt-src': first });
  const p0 = table(html).find(p => p[0] === piles(html)[0])![1];
  assert.equal(p0[0], name, 'before the card tapped');
});

test('§3 the bar: Cut, Maybe and back, New pile', () => {
  let html = ui.html();
  const n = total(html);
  const pilesBefore = piles(html).length;
  ui.tap({ 'tt-src': srcs(html, piles(html)[0]!)[0]! });
  html = ui.click({ btn: 'tt-newpile' });
  assert.equal(piles(html).length, pilesBefore + 1, 'New pile makes one for it');
  ui.tap({ 'tt-src': srcs(html, piles(html)[0]!)[0]! });
  html = ui.click({ btn: 'tt-tomaybe' });
  assert.equal(total(html), n - 1, 'Maybe takes it off the deck');
  assert.equal(table(html).find(p => p[0] === 'maybe')![1].length, 1, 'onto the Maybe pile');
  ui.tap({ 'tt-src': srcs(html, 'maybe')[0]! });
  html = ui.click({ btn: 'tt-todeck' });
  assert.equal(total(html), n, 'To deck puts it back');
  ui.tap({ 'tt-src': srcs(html, piles(html)[0]!)[0]! });
  html = ui.click({ btn: 'tt-cut' });
  assert.equal(total(html), n - 1, 'Cut takes it out');
});

test('§4 the grip picks a pile up, and ◀ ▶ move it', () => {
  let html = ui.html();
  const order = piles(html);
  const id = order[0]!.split('|')[1]!;
  html = ui.tap({ btn: 'tt-head', 'tt-pile': id });
  assert.match(html, /class="ttselbar"[\s\S]*data-btn="tt-pilemove" data-tt-by="1"/, 'its bar moves it');
  html = ui.click({ btn: 'tt-pilemove', 'tt-by': '1' });
  assert.deepEqual(piles(html).slice(0, 2), [order[1], order[0]], 'one place to the right');
});

test('§5 a mouse click on a card picks nothing up', () => {
  ui.click({ btn: 'tt-putdown' });
  const src = srcs(ui.html(), piles(ui.html())[0]!)[0]!;
  ui.pointer('pointerdown', { 'tt-src': src }, { pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 0 });
  const html = ui.click({ 'tt-src': src });
  assert.doesNotMatch(html, /class="ttselbar"/, 'no pick-up');
  assert.match(html, /class="ddpinbox"/, 'it pins the card to read');
  const tt = code('tabletop.ts');
  assert.match(tt, /addEventListener\('pointerdown', e => \{ lastPointer = e\.pointerType \|\| 'mouse'; \}, \{ capture: true/,
    'the pointer that pressed is noted before its click');
  assert.match(tt, /if \(lastPointer === 'mouse'\) \{ pinCard\(carry\.name\); return true; \}/, 'a mouse reads');
  assert.doesNotMatch(tt, /touchSeen\(|matchMedia\(|ontouchstart/, 'never the device');
});

test('§6 every intent of the drag model has its tap', () => {
  const tt = code('tabletop.ts');
  const click = tt.slice(tt.indexOf('export function handleButton('));
  const routes: [string, RegExp][] = [
    ['move a copy (pick up, put down)', /case 'tt-card':[\s\S]*?case 'tt-to':/],
    ['before a card', /beforeCard\(c, zone,/],
    ['remove', /case 'tt-cut': put\(\{ at: 'binder' \}\)/],
    ['to Maybe', /case 'tt-tomaybe': put\(\{ at: 'maybe' \}\)/],
    ['back from Maybe', /case 'tt-todeck':/],
    ['a new pile', /case 'tt-newpile': put\(\{ at: 'newpile'/],
    ['move a pile', /case 'tt-head':[\s\S]*?case 'tt-pilemove':/],
    ['rename a pile', /case 'tt-rename':/],
    ['re-sort', /case 'tt-resort':/],
  ];
  for (const [what, re] of routes) assert.match(click, re, `${what} has a tap route`);
  assert.match(code('binder.ts'), /case 'add': if \(card\) h\.add\(card\);/, 'add from the binder: its +');
  assert.match(code('piletable.ts'), /data-btn="tt-head"/, 'the pile’s grip is a button');
});
