/* THE WEEKLY CHALLENGE ON THE TABLETOP (ui/challenge.ts's host, ui/deckstrip.ts).
 *
 * A challenge deck is dealt exactly in order (docs/21), so on the tabletop it
 * is a STRIP under a scratch table — left to right = top to bottom — and the
 * scratch table's piles are cards being considered, NOT in the deck, kept in
 * this browser only. Through the real client, from a reload on
 * `?table=ch:<id>`:
 *
 *   §1 the strip is the draft, in order, one card per copy; the scratch piles
 *      are on the table; the page says the table is this browser's only
 *   §2 the Turn-1 hand bracket is the ENGINE's answer: as wide as the hand a
 *      game dealt by newChallengeGame holds, over exactly those cards — and
 *      after a reorder, the new deal's
 *   §3 a strip card moved by the tap route lands before the card tapped
 *      (counted after it has left), and the draft is saved in that order
 *   §4 strip → scratch leaves the deck; scratch → strip joins it, where it
 *      is put; the binder's + adds to the END of the deck
 *   §5 Back is the challenge page with the new order; its button opens the
 *      table again
 *   §6 the scratch table is a key of its own in BROWSER_KEYS, read and written
 *      inside try/catch, and a throwing storage costs only the save
 *   §7 no HTML5 drag and drop is left in the builder: every strip card is a
 *      `data-tt-src` of the tabletop's one provider, its scan never natively
 *      draggable, and it zooms like every table card
 *   §8 the wiring: main.ts registers the reload, the page never paints over
 *      the table, and a drop's index on the strip is the piles' rule turned
 *      sideways (ui/piletable.ts stripIndexAt)
 *
 * That a strip DRAG works is proved in two real browsers (docs/21 § Browser).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import { newChallengeGame, type ChallengeDef } from '../../engine/src/challenge.ts';
import { bracketWidth, challengeStripHtml, stripStep, stripWidth } from '../deckstrip.ts';
import { stripIndexAt } from '../piletable.ts';
import { BROWSER_KEYS } from '../legal.ts';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (f: string): string => readFileSync(join(UI, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const NOW = Date.UTC(2026, 9, 26, 12);
const DEF: ChallengeDef = { id: 'c540', week: '2026-10-25', title: 'Strip week', blurb: '', goal: { kind: 'unitsInPlay', n: 30 }, seed: 54000, par: 50 };
const CUR = { ...DEF, opens: NOW - 86_400_000, closes: NOW + 5 * 86_400_000, closed: false, entrants: 0 };
const units = DECK_LIST.filter(n => getCard(n).kind === 'unit').slice(0, 10);
const LIST = [...units, units[0]!, units[1]!, units[2]!, units[3]!];
const SCRATCH = [{ id: 'p1', name: 'Later', named: true, cards: [units[5]!] }];

const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = `?challenge=${DEF.id}&table=ch:${DEF.id}`;
g['__UI_DRIVER_STORE'] = {
  algoToken: 't540',
  algoChallengeDecks: JSON.stringify({ [DEF.id]: LIST }),
  algoChallengeTables: JSON.stringify({ [DEF.id]: SCRATCH }),
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

/** #app alone, without the binder beside it */
const appOf = (html: string): string => { const at = html.indexOf('<div class="ddscrim"'); return at < 0 ? html : html.slice(0, at); };
/** the strip's cards as [src, name], left to right */
const strip = (html: string): [string, string][] => {
  const at = html.indexOf('data-tt-zone="strip"');
  assert.ok(at >= 0, 'the deck strip is on the page');
  return [...html.slice(at).matchAll(/data-tt-src="(strip\|\d+\|[^"]+)" data-tt-i="\d+" data-card="([^"]+)"/g)].map(m => [m[1]!, m[2]!]);
};
const names = (html: string): string[] => strip(html).map(c => c[1]);
/** the scratch piles, as card names */
const scratch = (html: string): string[][] =>
  [...appOf(html).matchAll(/<section class="ttpile[^"]*" data-tt-zone="pile\|[^"]+"[\s\S]*?<\/section>/g)]
    .map(m => [...m[0].matchAll(/data-card="([^"]+)"/g)].map(c => c[1]!));
const draft = (): string[] => JSON.parse((g['localStorage'] as Storage).getItem('algoChallengeDecks') ?? '{}')[DEF.id] ?? [];
const stored = (): string[][] => (JSON.parse((g['localStorage'] as Storage).getItem('algoChallengeTables') ?? '{}')[DEF.id] ?? []).map((p: { cards: string[] }) => p.cards);
const dealt = (l: string[]): string[] => [...newChallengeGame(DEF, l as never).state.players[0]!.hand];
const sorted = (l: readonly string[]): string[] => [...l].sort();
/** the bracket's width, and the strip's step, as drawn */
const bracketPx = (html: string): number => Number(/class="ttbracket" style="width:(\d+)px"/.exec(html)?.[1] ?? 0);
const step = (html: string): number => Number(/data-tt-zone="strip" data-tt-axis="x" data-tt-s="(\d+)"/.exec(html)![1]);
const cardW = (html: string): number => Number(/class="ttpage" style="--cw:(\d+)px/.exec(html)![1]);

test('§1 a reload on ?table=ch:<id> lands on the table: the strip is the draft, the scratch piles beside it', () => {
  const html = ui.html();
  assert.match(appOf(html), /^<div class="(?:[\w-]+ )*ttpage"/, 'the tabletop page is up');
  assert.match(html, /← Back to the challenge/);
  assert.deepEqual(names(html), LIST, 'one card per copy, left to right = top to bottom');
  assert.deepEqual(strip(html).map(c => c[0]), LIST.map((n, k) => `strip|${k}|${n}`), 'each card is its own position');
  assert.deepEqual(scratch(html), [[units[5]]], 'the scratch table as saved');
  assert.match(html, /The table is saved in this browser only\./, 'and the page says so in one line');
  assert.match(html, /Cards on the table are not in the deck/);
  assert.doesNotMatch(html, /class="ttmaybe/, 'no Maybe pile on a challenge table');
  const nums = [...html.matchAll(/<span style="left:\d+px">(\d+)<\/span>/g)].map(m => Number(m[1]));
  assert.deepEqual(nums, LIST.map((_, k) => k + 1), 'a position under every card');
});

test('§2 the Turn-1 bracket is the engine’s deal: its width, and the cards under it', () => {
  const html = ui.html();
  const hand = dealt(LIST);
  assert.ok(hand.length >= 4 && hand.length < LIST.length, `non-vacuous: a real hand of ${hand.length} under a longer deck`);
  const Sx = step(html), cw = cardW(html);
  assert.equal(bracketPx(html), bracketWidth(hand.length, LIST.length, Sx, cw), 'as wide as the dealt hand');
  assert.equal(bracketPx(html), hand.length * Sx, 'which is that many cards of the strip');
  assert.deepEqual(sorted(names(html).slice(0, hand.length)), sorted(hand), 'over exactly the dealt cards');
  // a deck smaller than a hand is all hand: the bracket spans the whole fan
  const small = units.slice(0, 3);
  const all = challengeStripHtml({ list: small, hand: dealt(small).length, problem: null, cw: 132, ch: 183 });
  assert.equal(bracketPx(all), stripWidth(3, stripStep(132), 132));
  // an undealable deck has no bracket at all, and Play waits
  const none = challengeStripHtml({ list: ['Training Construct'], hand: null, problem: 'not a deck card', cw: 132, ch: 183 });
  assert.equal(bracketPx(none), 0);
  assert.match(none, /data-btn="ch-play" disabled/);
});

test('§3 the tap route: a strip card lands before the card tapped, and the draft keeps the order', () => {
  const before = names(ui.html());
  const hand = dealt(before).length;
  // a card from past the hand, into it
  const k = hand + 2;
  let html = ui.tap({ 'tt-src': `strip|${k}|${before[k]}` });
  assert.match(html, /class="ttselbar"/, 'a finger picks it up');
  assert.match(html, new RegExp(`class="ttcard[^"]*ttpicked[^"]*"[^>]*data-tt-src="strip\\|${k}\\|`), 'and it is marked');
  html = ui.tap({ 'tt-src': `strip|1|${before[1]}` });
  const want = [...before]; const [moved] = want.splice(k, 1); want.splice(1, 0, moved!);
  assert.deepEqual(names(html), want, 'before card 2, so it is card 2 now');
  assert.deepEqual(draft(), want, 'and saved as the draft');
  assert.match(html, new RegExp(`class="ttcard ttfront"[^>]*data-tt-src="strip\\|1\\|`), 'drawn in front where it landed');
  // the bracket is the NEW deal's
  const hand2 = dealt(want);
  assert.equal(bracketPx(html), hand2.length * step(html));
  assert.deepEqual(sorted(names(html).slice(0, hand2.length)), sorted(hand2), 'the new top of the deck is the new hand');
  // and back down: a card moved later counts its place after it has left
  html = ui.tap({ 'tt-src': `strip|0|${want[0]}` });
  html = ui.tap({ 'tt-src': `strip|4|${want[4]}` });
  const want2 = [...want]; const [m2] = want2.splice(0, 1); want2.splice(3, 0, m2!);
  assert.deepEqual(names(html), want2, 'before card 5 (counted after it left: index 3)');
});

test('§4 strip → scratch leaves the deck, scratch → strip joins it, the binder’s + adds at the bottom', () => {
  let html = ui.html();
  const before = names(html);
  const piles = scratch(html).length;
  html = ui.tap({ 'tt-src': `strip|2|${before[2]}` });
  html = ui.click({ btn: 'tt-newpile' });
  const out = [...before]; const [left] = out.splice(2, 1);
  assert.deepEqual(names(html), out, 'off the deck');
  assert.deepEqual(draft(), out);
  assert.equal(scratch(html).length, piles + 1, 'onto the table, a pile of its own');
  assert.ok(scratch(html).some(p => p.includes(left!)) && stored().some(p => p.includes(left!)), 'and the table is saved');
  // and back: the scratch card, tapped onto strip card 0
  const src = new RegExp(`data-tt-src="(pile\\|[^"|]+\\|\\d+\\|${left!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})"`).exec(appOf(html))![1]!;
  html = ui.tap({ 'tt-src': src });
  html = ui.tap({ 'tt-src': `strip|0|${out[0]}` });
  assert.deepEqual(names(html), [left, ...out], 'into the deck where it was put');
  assert.equal(scratch(html).length, piles, 'its unnamed pile went with it');
  assert.deepEqual(stored(), [[units[5]]]);
  // the strip's own end: a tap on the strip with a card picked up
  html = ui.tap({ 'tt-src': `strip|1|${out[0]}` });
  html = ui.tap({ 'tt-zone': 'strip' });
  assert.equal(names(html).at(-1), out[0], 'a tap on the strip itself is the bottom of the deck');
  // the binder's +: one copy, at the bottom of the deck (what is on top was put there on purpose)
  const pick = /data-dd="add" data-card="([^"]+)"/.exec(html)![1]!.replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const was = names(html);
  html = ui.click({ dd: 'add', card: pick });
  assert.deepEqual(names(html), [...was, pick], 'the binder’s + adds one copy at the bottom');
  assert.deepEqual(draft(), [...was, pick]);
});

test('§5 Back is the challenge page with the new order; its button opens the table again', () => {
  const order = names(ui.html());
  let html = ui.click({ btn: 'tt-close' });
  assert.doesNotMatch(html, /class="ttpage/, 'the table is gone');
  assert.match(html, /<div class="metapage chpage"/, 'the challenge page');
  assert.match(html, /data-btn="ch-tabletop"[^>]*>Build on the table</);
  const first = /class="chpos">1<\/span>\s*<span class="chname" data-prev="([^"]+)"/.exec(html)?.[1];
  assert.equal(first, order[0], 'its summary is the deck as the table left it');
  html = ui.click({ btn: 'ch-tabletop' });
  assert.match(html, /<div class="(?:[\w-]+ )*ttpage"/);
  assert.deepEqual(names(html), order);
});

test('§6 the scratch table: its own key, try/catch around every access, a throwing storage costs only the save', async () => {
  assert.ok(BROWSER_KEYS.some(k => k.covers.includes('algoChallengeTables')), 'the privacy page names it');
  const src = code('challengebuild.ts');
  const uses = [...src.matchAll(/localStorage\.\w+\(/g)].length;
  const guarded = [...src.matchAll(/try \{[^}]*localStorage\.\w+\(/g)].length;
  assert.ok(uses >= 4, `non-vacuous: ${uses} storage calls`);
  assert.equal(guarded, uses, 'every storage call is inside a try');
  const store = new Map<string, string>();
  let throws = false;
  const was = g['localStorage'];
  g['localStorage'] = {
    getItem: (k: string) => { if (throws) throw new Error('denied'); return store.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (throws) throw new Error('quota'); store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  try {
    const B = await import('../challengebuild.ts');
    B.saveScratch('w1', [{ id: 'p1', name: 'One', cards: [units[0]!] }]);
    B.saveScratch('w2', [{ id: 'p1', name: 'Two', cards: [units[1]!] }]);
    assert.deepEqual(B.loadScratch('w1'), [{ id: 'p1', name: 'One', cards: [units[0]] }]);
    assert.equal(B.loadScratch('w3'), null, 'none yet');
    B.saveScratch('w1', []);
    assert.equal(B.loadScratch('w1'), null, 'an empty table drops the entry');
    store.set('algoChallengeTables', JSON.stringify({ w4: [{ id: 'x' }, { id: 'p2', name: 'ok', cards: [units[2], 7] }] }));
    assert.deepEqual(B.loadScratch('w4'), [{ id: 'p2', name: 'ok', cards: [units[2]] }], 'a bad pile or card is dropped, not trusted');
    store.set('algoChallengeTables', '{not json');
    assert.equal(B.loadScratch('w2'), null, 'a corrupt store reads as none');
    throws = true;
    assert.doesNotThrow(() => B.saveScratch('w1', [{ id: 'p1', name: 'One', cards: [units[0]!] }]));
    assert.equal(B.loadScratch('w1'), null);
  } finally { g['localStorage'] = was; }
});

test('§7 no HTML5 drag and drop; every strip card is the tabletop provider’s, never natively draggable, and zooms', () => {
  for (const f of ['challenge.ts', 'challengebuild.ts', 'deckstrip.ts']) {
    assert.doesNotMatch(code(f), /draggable="true"|\.draggable = true|dataTransfer|addEventListener\('(?:drop|dragstart|dragover)'|wireDrag/, `${f} uses no HTML5 drag and drop`);
  }
  const html = ui.html();
  const zone = html.indexOf('data-tt-zone="strip"');
  assert.ok(zone >= 0 && zone < html.indexOf('class="ttfan"', zone), 'the strip zone is the fan’s ancestor (the provider finds the fan in it)');
  assert.match(html, /data-tt-zone="strip" data-tt-axis="x"/, 'sideways');
  assert.ok(html.indexOf('class="ttpage"') < zone || /ttpage"/.test(html.slice(0, zone)), 'inside the page the provider claims');
  const cards = [...html.slice(zone).matchAll(/<div class="ttcard[^>]*data-tt-src="strip\|[^>]*>/g)].map(m => m[0]);
  assert.equal(cards.length, names(html).length);
  assert.ok(cards.every(c => /data-btn="tt-card"/.test(c) && /data-zoom/.test(c)), 'each a tap target that zooms');
  const imgs = html.slice(zone).match(/<img\b[^>]*>/g) ?? [];
  assert.ok(imgs.length >= cards.length, `scans on the strip: ${imgs.length}`);
  assert.deepEqual(imgs.filter(t => !/draggable="false"/.test(t)).slice(0, 2), [], 'Firefox starts its own image drag on any other');
  assert.doesNotMatch(code('deckstrip.ts'), /artHtml\(/, 'a scan only through scanHtml');
});

test('§8 the wiring: the reload, the paint guard, and the strip’s drop index', () => {
  assert.match(code('main.ts'), /tt\.registerTableResolver\('challenge', chal\.tabletopHostFor\);/);
  const ch = code('challenge.ts');
  const paint = ch.slice(ch.indexOf('function paint('), ch.indexOf('function setList('));
  assert.ok(paint.indexOf('if (tt.screen()) return;') >= 0 && paint.indexOf('if (tt.screen()) return;') < paint.indexOf('innerHTML'),
    'the page never paints over the table (a commit there repaints the table, not this)');
  assert.match(ch, /commit: next => \{[\s\S]*?setList\(next\.cards\)[\s\S]*?tt\.tabletopChanged\(\);/, 'the strip commits through setList (saved, Undo ended) and repaints the table');
  // the index a release at x lands at: the gap before card i is i, past the last card's middle is the end
  const Sx = stripStep(132), n = 10;
  assert.equal(stripIndexAt(0 + 3 * Sx + 2, 0, 0, Sx, n, 132), 3);
  assert.equal(stripIndexAt(0 + 3 * Sx - 2, 0, 0, Sx, n, 132), 3, 'just before card 3 is still before it');
  assert.equal(stripIndexAt(0 + 3 * Sx + Sx / 2 + 1, 0, 0, Sx, n, 132), 4, 'past card 3’s strip middle is after it');
  assert.equal(stripIndexAt(0 + (n - 1) * Sx + 132 - 1, 0, 0, Sx, n, 132), n, 'over the last card’s right half: the end');
  assert.equal(stripIndexAt(200, 300, 100, Sx, n, 132), stripIndexAt(300, 300, 0, Sx, n, 132), 'the box’s scroll counts');
});
