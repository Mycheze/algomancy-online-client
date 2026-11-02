/* A STALE SWAP IS KEPT, SHOWN DISABLED, AND SAYS WHY (docs/22 §4.6) — the
 * sideboard tab of ui/decks.ts, driven through the real client.
 *
 * Validity is computed, never stored: a preset is usable iff its out-cards
 * are in the deck, its in-cards are in the sideboard, and the result is a
 * legal Competitive deck (engine/src/matchdeck.ts applyPreset). A later edit
 * can break one. It is kept, its Try is disabled, and the row says why in
 * applyPreset's own words.
 *
 *   §1 as loaded: a usable preset beside two stale ones, each with its reason
 *   §2 a deck edit makes a usable preset stale — it is kept, disabled, and
 *      not re-sent (the server never rewrites it either)
 *   §3 the edit undone, it is usable again; a stale one fixed by tapping
 *      its chip is usable too
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 30);
const MAIN = N.slice(0, 15).flatMap(n => [n, n]);            // 30 cards
const SIDE = N.slice(15, 19);                                // 4 singles
const DECK = {
  id: 'd833', name: 'Stale deck', cards: MAIN, maybe: [], sideboard: SIDE, cover: null,
  swaps: [
    { id: 'ok', name: 'vs aggro', out: [N[0]], in: [SIDE[0]] },
    // an in-card the sideboard does not hold (it is in the deck)
    { id: 'gone', name: 'vs control', out: [N[1]], in: [N[2]] },
    // takes out more than it puts in: the deck would be 29
    { id: 'short', name: 'lean', out: [N[3], N[4]], in: [SIDE[1]] },
  ],
  author: 'you', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', problems: [], ccProblems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
const POSTS: { url: string; body: Record<string, unknown> }[] = [];
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't833' };
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

/** each row: id → { stale, Try disabled, the reason shown } */
function rows(html: string): Record<string, { stale: boolean; off: boolean; why: string | null }> {
  const out: Record<string, { stale: boolean; off: boolean; why: string | null }> = {};
  for (const m of html.matchAll(/<div class="dkswaprow( stale)?">([\s\S]*?)(?=<div class="dkswaprow|<\/section>)/g)) {
    const r = m[2]!;
    out[/data-swap-name="([^"]+)"/.exec(r)![1]!] = {
      stale: !!m[1],
      off: /data-btn="deck-swap-try"[^>]*\sdisabled>/.test(r),
      why: /<div class="dkswapwhy">([^<]*)<\/div>/.exec(r)?.[1] ?? null,
    };
  }
  return out;
}

test('§1 a usable preset beside two stale ones, each with its reason', () => {
  const r = rows(ui.html());
  assert.deepEqual(Object.keys(r), ['ok', 'gone', 'short'], 'all three are kept');
  assert.deepEqual(r['ok'], { stale: false, off: false, why: null });
  assert.deepEqual(r['gone'], { stale: true, off: true, why: `needs 1× ${N[2]} in the sideboard` });
  assert.deepEqual(r['short'], { stale: true, off: true, why: 'would leave the main deck at 29 cards — it needs 30' });
  // Set from current and ✕ stay: they are how a stale preset is mended or dropped
  const html = ui.html();
  assert.match(html, /data-btn="deck-swap-set" data-swap="gone">Set from current</);
  assert.match(html, /data-btn="deck-swap-del" data-swap="gone"/);
});

test('§2 a deck edit makes a usable preset stale: kept, disabled, not re-sent', () => {
  // the only copy of SIDE[0] leaves the sideboard for the deck
  const html = ui.click({ btn: 'deck-from-side', card: SIDE[0]! });
  assert.deepEqual(rows(html)['ok'], { stale: true, off: true, why: `needs 1× ${SIDE[0]} in the sideboard` });
  ui.tick();
  const body = POSTS.at(-1)!.body;
  assert.ok(!('swaps' in body), 'the presets are not re-sent, so nothing rewrites them');
});

test('§3 undone, it is usable again; a stale one mended by its chip is too', () => {
  ui.click({ btn: 'deck-tab', tab: 'cards' });
  ui.click({ btn: 'deck-to-side', card: SIDE[0]! });
  let html = ui.click({ btn: 'deck-tab', tab: 'side' });
  assert.deepEqual(rows(html)['ok'], { stale: false, off: false, why: null }, 'computed again, never stored');
  html = ui.click({ btn: 'deck-swap-dropout', swap: 'short', card: N[4]! });
  assert.deepEqual(rows(html)['short'], { stale: false, off: false, why: null }, 'one out, one in: usable');
});
