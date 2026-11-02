/* THE SWAP PRESET EDITOR (docs/22 §4.6) — the sideboard tab of ui/decks.ts,
 * driven through the real client.
 *
 * A preset is a target RELATIVE TO THE DECK, so the deck must stay put while
 * one is worked out: the editor moves cards in a trial configuration, and
 * "Set from current" (presetBetween) captures the trial's difference from the
 * deck as it is saved.
 *
 *   §1 no presets yet: the trial is the deck, and Save as a swap waits for a change
 *   §2 a tap moves a card across in the trial — and the deck does not change
 *   §3 Save as a swap makes a named preset: out and in, as chips
 *   §4 a preset's name is typed in place and saved without a repaint
 *   §5 Registered deck resets the trial; Try puts the preset back in it;
 *      Set from current rewrites the preset from the trial
 *   §6 a chip tapped is one copy out of the preset; ✕ deletes it
 *   §7 two presets, saved with the deck — and a later card edit does not
 *      re-send them
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 30);
const MAIN = N.slice(0, 15).flatMap(n => [n, n]);            // 30 cards
const SIDE = N.slice(15, 20);                                // 5 singles
const DECK = {
  id: 'd832', name: 'Swap deck', cards: MAIN, maybe: [], sideboard: SIDE, cover: null,
  author: 'you', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', problems: [], ccProblems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
const POSTS: { url: string; body: Record<string, unknown> }[] = [];
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't832' };
g['__UI_DRIVER_FETCH'] = async (url: string, init?: { body?: string }) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [DECK] }) };
  if (init?.body) POSTS.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
await flush();
ui.click({ btn: 'deck-openpage' });
await flush();
ui.click({ btn: 'deck-tab', tab: 'side' });

/** the trial's two columns, as chip labels */
const col = (html: string, which: 'deck-try-out' | 'deck-try-in'): string[] =>
  [...html.matchAll(new RegExp(`data-btn="${which}" data-card="[^"]+"\\s*data-prev="[^"]+">([^<]+)<`, 'g'))].map(m => m[1]!);
/** a row's chips as a multiset: "Name ×2" is two */
const chipList = (r: string, btn: string): string[] =>
  [...r.matchAll(new RegExp(`data-btn="${btn}" data-card="([^"]+)"[^>]*>[^<]*?(?: ×(\\d+))?<`, 'g'))]
    .flatMap(x => Array.from({ length: Number(x[2] ?? 1) }, () => x[1]!));
/** each preset row: [id, name, out chips, in chips, Try disabled?] */
const rows = (html: string): { id: string; name: string; out: string[]; in: string[]; tryOff: boolean }[] =>
  [...html.matchAll(/<div class="dkswaprow[^"]*">([\s\S]*?)<\/span>\s*(?:<div class="dkswapwhy">[^<]*<\/div>\s*)?<\/div>/g)].map(m => {
    const r = m[1]!;
    const id = /data-swap-name="([^"]+)"/.exec(r)![1]!;
    return {
      id, name: /class="dkswapname"[\s\S]*?value="([^"]*)"/.exec(r)![1]!,
      out: chipList(r, 'deck-swap-dropout'),
      in: chipList(r, 'deck-swap-dropin'),
      tryOff: /data-btn="deck-swap-try"[^>]*disabled/.test(r),
    };
  });
const sideTiles = (html: string): number => (html.match(/data-btn="deck-from-side"/g) ?? []).length;

test('§1 no presets: the trial is the deck, and saving waits for a change', () => {
  const html = ui.html();
  assert.match(html, /<h3>Swaps <span class="acctcount">0<\/span><\/h3>/);
  assert.equal(col(html, 'deck-try-out').length, 15, 'the deck, one chip per card');
  assert.match(html, /<div class="zonelabel">Deck 30<\/div>/);
  assert.match(html, /<div class="zonelabel">Sideboard 5\/7<\/div>/);
  assert.match(html, /data-btn="deck-swap-new" disabled>Save as a swap</, 'nothing to save yet');
  assert.match(html, /data-btn="deck-swap-reset" disabled>Registered deck</);
});

test('§2 a tap moves a card across in the trial, and the deck stays put', () => {
  ui.click({ btn: 'deck-try-out', card: N[0]! });
  const html = ui.click({ btn: 'deck-try-in', card: SIDE[0]! });
  assert.match(html, /<div class="zonelabel">Deck 30<\/div>/, 'one out, one in');
  assert.ok(col(html, 'deck-try-in').includes(N[0]!), `${N[0]} sits in the trial sideboard`);
  assert.match(html, new RegExp(`class="dkswapchip moved" data-btn="deck-try-out" data-card="${SIDE[0]}"`), 'what came in is marked');
  assert.equal(sideTiles(html), 5, 'the deck’s own sideboard is unchanged');
  assert.match(html, /data-tab="side">sideboard <span class="acctcount">5\/7/);
  ui.tick();
  assert.equal(POSTS.length, 0, 'and nothing was saved');
});

test('§3 Save as a swap: a named preset, out and in', () => {
  const html = ui.click({ btn: 'deck-swap-new' });
  assert.deepEqual(rows(html), [{ id: 'w1', name: 'Swap 1', out: [N[0]!], in: [SIDE[0]!], tryOff: false }]);
  assert.match(html, /<h3>Swaps <span class="acctcount">1<\/span><\/h3>/);
});

test('§4 a name is typed in place, saved without a repaint', () => {
  ui.tick();
  POSTS.length = 0;
  const before = ui.html();
  ui.pointer('input', { 'swap-name': 'w1' }, { target: { value: 'vs control', dataset: { swapName: 'w1' } } });
  assert.equal(ui.html(), before, 'no repaint while typing');
  ui.tick();
  const sent = POSTS.at(-1)!.body['swaps'] as { name: string }[];
  assert.equal(sent[0]!.name, 'vs control', 'the name rode the save');
  ui.click({ btn: 'deck-tab', tab: 'side' });
  assert.equal(rows(ui.html())[0]!.name, 'vs control');
});

test('§5 Registered deck, Try, and Set from current', () => {
  let html = ui.click({ btn: 'deck-swap-reset' });
  assert.ok(!col(html, 'deck-try-in').includes(N[0]!), 'the trial is the deck again');
  html = ui.click({ btn: 'deck-swap-try', swap: 'w1' });
  assert.ok(col(html, 'deck-try-in').includes(N[0]!), 'Try puts the preset in the trial');
  ui.click({ btn: 'deck-try-out', card: N[1]! });
  ui.click({ btn: 'deck-try-in', card: SIDE[1]! });
  html = ui.click({ btn: 'deck-swap-set', swap: 'w1' });
  assert.deepEqual(rows(html)[0], { id: 'w1', name: 'vs control', out: [N[0]!, N[1]!], in: [SIDE[0]!, SIDE[1]!], tryOff: false },
    'the preset is now the trial’s difference from the deck');
});

test('§6 a chip tapped is one copy out of the preset; ✕ deletes it', () => {
  let html = ui.click({ btn: 'deck-swap-dropout', swap: 'w1', card: N[1]! });
  assert.deepEqual(rows(html)[0]!.out, [N[0]!]);
  ui.click({ btn: 'deck-swap-reset' });
  ui.click({ btn: 'deck-try-in', card: SIDE[3]! });
  html = ui.click({ btn: 'deck-swap-new' });
  assert.equal(rows(html).length, 2);
  html = ui.click({ btn: 'deck-swap-del', swap: 'w2' });
  assert.deepEqual(rows(html).map(r => r.id), ['w1']);
});

test('§7 two presets, saved with the deck; a card edit later leaves them alone', () => {
  ui.click({ btn: 'deck-swap-reset' });
  ui.click({ btn: 'deck-try-out', card: N[2]! });
  ui.click({ btn: 'deck-try-out', card: N[2]! });
  ui.click({ btn: 'deck-try-in', card: SIDE[2]! });
  const html = ui.click({ btn: 'deck-swap-new' });
  assert.deepEqual(rows(html).map(r => [r.id, r.out, r.in]), [
    ['w1', [N[0]!], [SIDE[0]!, SIDE[1]!]],
    ['w2', [N[2]!, N[2]!], [SIDE[2]!]],
  ]);
  POSTS.length = 0;
  ui.tick();
  const body = POSTS.at(-1)!.body;
  assert.deepEqual((body['swaps'] as { id: string; name: string; out: string[]; in: string[] }[]).map(p => [p.id, p.name, p.out, p.in]), [
    ['w1', 'vs control', [N[0]!], [SIDE[0]!, SIDE[1]!]],
    ['w2', 'Swap 2', [N[2]!, N[2]!], [SIDE[2]!]],
  ], 'both presets go to the server with the deck');
  assert.deepEqual(body['sideboard'], SIDE, 'beside the sideboard, which no preset changed');
  assert.deepEqual(body['cards'], MAIN, 'and the deck itself, which no preset changed either');
  POSTS.length = 0;
  ui.click({ btn: 'deck-side-less', card: SIDE[4]! });
  ui.tick();
  assert.ok(!('swaps' in POSTS.at(-1)!.body), 'a card edit does not re-send the swaps');
});
