/* 1345 · THE BUILDER ON A RESTRICTED POOL (ui/tabletop.ts `TableHost.owned`, docs/25 §6) — a cube's
 * drafted cards: only those in the pool band, and never more copies than you have.
 *
 *   §1 the pool band shows only the owned cards; one you have two of says ×2
 *   §2 a tap on a card you have ONE of, already in the deck, is refused with the note — nothing moves
 *   §3 a card you do not have is refused wherever it is put (the door, not just the tap)
 *   §4 two owned: the second copy lands, a third is refused; the sideboard counts with the deck
 *   §5 the card menu's Add another is off at the owned ceiling
 *   §6 a host without `owned` is untouched: every playable card, no ×n badge, the old tile markup
 *   §7 source: the owned check sits in place(), beside the copy cap, and nowhere else decides it
 *
 * Seeds: none. The table paints into a stand-in #app (no DOM): pages/frame.ts writes innerHTML.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import * as tt from '../tabletop.ts';
import { poolHtml, type PoolView } from '../pages/pool.ts';

const [ONE, TWO, OTHER, NOTMINE] = [DECK_LIST[3]!, DECK_LIST[7]!, DECK_LIST[11]!, DECK_LIST[19]!];
const root = { innerHTML: '' } as unknown as HTMLElement;
tt.initTabletop({ app: root, rerender: () => {} });

/** a deck host over a tiny drafted pool, applying its own commits */
function host(start: string[] = [], side: string[] = []): tt.TableHost & { main: string[]; sb: string[] } {
  const h = {
    main: [...start], sb: [...side],
    kind: 'deck' as const, key: 'cube:T1345', title: () => 'Cube', backLabel: 'Event',
    cards: () => h.main, side: () => h.sb, sideMax: 7, cap: 2, pool: true,
    owned: () => new Map([[ONE, 1], [TWO, 2], [OTHER, 1]]),
    piles: () => null,
    commit: (n: tt.TableNext) => { if (n.cards) h.main = n.cards; if (n.sideboard) h.sb = n.sideboard; tt.tabletopChanged(); },
    close: () => {},
  };
  return h;
}
const el = (btn: string, data: Record<string, string> = {}): HTMLElement =>
  ({ dataset: { btn, ...data }, closest: () => null }) as unknown as HTMLElement;
const tiles = (html: string): string[] => [...html.matchAll(/data-btn="tt-add" data-tt-src="binder\|([^"]+)"/g)].map(m => m[1]!);
const NOTE = (html: string): string | null => /<div class="ttnote" role="status">([^<]*)<\/div>/.exec(html)?.[1] ?? null;
const unesc = (s: string | null): string | null => s?.replace(/&#39;/g, "'").replace(/&amp;/g, '&') ?? null;

test('§1 only the owned cards; ×2 on the one you have two of', () => {
  tt.openTabletop(host());
  const html = root.innerHTML;
  assert.deepEqual(tiles(html).sort(), [ONE, TWO, OTHER].sort());
  const two = new RegExp(`data-tt-src="binder\\|${TWO}"[^>]*>[\\s\\S]*?<span class="ttpoolown" title="You have 2">×2</span></div>`);
  assert.match(html, two);
  assert.equal((html.match(/class="ttpoolown"/g) ?? []).length, 1, 'a card you have one of says nothing');
});

test('§2 the second copy of a card you have one of is refused', () => {
  const h = host([ONE]);
  tt.openTabletop(h);
  assert.match(root.innerHTML, new RegExp(`class="ttpooltile ttcap" data-btn="tt-add" data-tt-src="binder\\|${ONE}"[\\s\\S]*?<span class="ttpooln cap">1/1</span>`),
    'at its ceiling: dimmed, 1/1');
  tt.handleButton(el('tt-add', { ttSrc: `binder|${ONE}` }));
  assert.deepEqual(h.main, [ONE], 'still one');
  assert.equal(unesc(NOTE(root.innerHTML)), `You have 1 ${ONE}.`);
});

test('§3 a card you do not have: refused at the door, wherever it goes', () => {
  const h = host();
  tt.openTabletop(h);
  for (const to of [{ at: 'auto' }, { at: 'side' }, { at: 'newpile', pos: 0 }] as tt.Place[]) {
    assert.equal(tt.place(h, { from: 'binder', name: NOTMINE }, to), false, JSON.stringify(to));
  }
  tt.tabletopChanged();
  assert.equal(unesc(NOTE(root.innerHTML)), `${NOTMINE} is not in your pool.`);
  assert.deepEqual([h.main, h.sb], [[], []]);
});

test('§4 two owned: two land, a third does not; the sideboard counts', () => {
  const h = host();
  tt.openTabletop(h);
  assert.equal(tt.place(h, { from: 'binder', name: TWO }, { at: 'auto' }), true);
  assert.equal(tt.place(h, { from: 'binder', name: TWO }, { at: 'side' }), true, 'the second, into the sideboard');
  assert.equal(tt.place(h, { from: 'binder', name: TWO }, { at: 'auto' }), false, 'no third');
  assert.equal(tt.place(h, { from: 'binder', name: TWO }, { at: 'side' }), false);
  assert.deepEqual([h.main, h.sb], [[TWO], [TWO]]);
  assert.equal(tt.place(h, { from: 'binder', name: ONE }, { at: 'side' }), true);
  assert.equal(tt.place(h, { from: 'binder', name: ONE }, { at: 'auto' }), false, 'the one in the sideboard is the one you have');
  // moving a copy you have is no new copy: side → deck is fine
  assert.equal(tt.place(h, { from: 'side', index: 1, name: ONE }, { at: 'auto' }), true);
  assert.deepEqual([h.main.sort(), h.sb], [[ONE, TWO].sort(), [TWO]]);
});

test('§5 Add another is off at the ceiling', () => {
  const h = host([ONE, TWO]);
  tt.openTabletop(h);
  const pile = /data-tt-src="(pile\|[^"|]+\|\d+\|[^"]+)"/g;
  const srcs = [...root.innerHTML.matchAll(pile)].map(m => m[1]!);
  const of = (name: string): string => srcs.find(s => s.endsWith(`|${name}`))!;
  tt.handleButton(el('tt-card', { ttSrc: of(ONE) }));
  assert.match(root.innerHTML, /<button[^>]*data-btn="tt-more"[^>]*disabled/, 'one owned, one in: off');
  tt.handleButton(el('tt-putdown'));
  tt.handleButton(el('tt-card', { ttSrc: of(TWO) }));
  assert.doesNotMatch(root.innerHTML, /<button[^>]*data-btn="tt-more"[^>]*disabled/, 'two owned, one in: on');
  tt.handleButton(el('tt-putdown'));
});

test('§6 a host without `owned` is as it was', () => {
  const h = host([ONE]);
  delete (h as Partial<typeof h>).owned;
  tt.openTabletop(h);
  const html = root.innerHTML;
  assert.ok(tiles(html).length > 100, 'every playable card');
  assert.ok(tiles(html).includes(NOTMINE));
  assert.equal(html.includes('ttpoolown'), false);
  assert.equal(tt.place(h, { from: 'binder', name: ONE }, { at: 'auto' }), true, 'a second copy: the cap allows it');
  assert.equal(tt.place(h, { from: 'binder', name: ONE }, { at: 'auto' }), false, 'a third: the cap');
  tt.tabletopChanged();   // a refusal's caller paints
  assert.equal(unesc(NOTE(root.innerHTML)), `Max 2 of ${ONE}.`);
  tt.closeTabletop();
  // the tile markup without `owned`, byte for byte as before
  const v: PoolView = { query: '', chips: [], active: false, total: 1, cap: 2, target: 'deck', targets: ['deck'], scrollKey: 'k',
    tiles: [{ name: ONE, inDeck: 2, inSide: 0, atCap: true, over: false }] };
  assert.match(poolHtml(v), new RegExp(`<div class="ttpooltile ttcap" data-btn="tt-add" data-tt-src="binder\\|${ONE}" data-card="${ONE}" data-zoom><img [^>]*><span class="ttpooln cap">2/2</span></div>`));
});

test('§7 source: the owned check is in place()', () => {
  const src = readFileSync(new URL('../tabletop.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export function place('), src.indexOf('export function tabletopChanged('));
  assert.match(body, /const short = ownedNote\(h, carry, to\);\s*if \(short\) \{ note = short; paintPending = true; return false; \}/);
  assert.equal((src.match(/ownedNote\(/g) ?? []).length, 2, 'defined once, called once');
});
