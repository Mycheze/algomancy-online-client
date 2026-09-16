/**
 * R296 — WHAT A PLAYER ACTUALLY SEES OF THE MARK.
 *
 * The engine half of the recycle mark has ten guards (engine/test/300) and the
 * server half has two more (the redaction, and the resource-step freeze). None
 * of them renders anything. The owner's ask was a UI ask —
 *
 *   "We'll also need to change the UI so that you see how many cards are
 *    actually left in the deck, plus recycled (but can't look at the cards
 *    still) and then when deck hits 0, it shuffles in the recycled cards and
 *    starts again."
 *
 * — so this drives ui/main.ts through the hotseat driver and reads the markup
 * it really produced. A counter that is right in the state and absent from the
 * screen is not what was asked for, and nothing else in the suite would notice.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import type { GameState } from '../../engine/src/types.ts';

(globalThis as Record<string, unknown>)['__UI_DRIVER_SEARCH'] = '?hotseat=1';
const { local } = await import('./ui-driver.ts');
const ui = local();

/** the deck line as a player reads it, for seat 0 */
function deckLine(html: string): string {
  const m = html.match(/<span class="binline"[^>]*>([\s\S]*?)<\/span>/);
  assert.ok(m, 'the board draws a deck line at all');
  return m![1]!.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** a fresh shared-mode game, with `n` cards pushed past seat 0's mark */
function withPile(seed: number, n: number): GameState {
  const h = new Harness(seed);
  const g = new E(h.state);
  for (let i = 0; i < n; i++) g.recycleToBottom(0, 'Geode');
  return g.s;
}

test('R296 §1 with nothing recycled the line is just the deck — no "recycled 0" noise', () => {
  const s = withPile(3020, 0);
  const line = deckLine(ui.show(s));
  assert.match(line, /^deck \d+/, 'it leads with the deck count');
  assert.ok(!/recycled/.test(line),
    'and says nothing about the pile before anybody has put a card in it — "· recycled 0" is '
    + 'noise on a line that is already dense');
});

test('R296 §2 once cards are recycled the player sees BOTH numbers', () => {
  const s = withPile(3021, 3);
  const line = deckLine(ui.show(s));
  assert.match(line, /deck \d+ · recycled 3/,
    'THE OWNER\'S ASK: "you see how many cards are actually left in the deck, plus recycled"');
});

test('R296 §3 recycling does NOT inflate the deck count — that is the whole point of the mark', () => {
  // the failure this pins is the one the old rule produced: a recycled card
  // landed on the bottom of the live deck, so the deck number went UP and a
  // player counting cards left was told a number that included cards they
  // could not reach until they had drawn the whole deck.
  const before = deckLine(ui.show(withPile(3022, 0)));
  const after = deckLine(ui.show(withPile(3022, 5)));
  const deckOf = (line: string): number => Number(line.match(/deck (\d+)/)![1]);
  assert.equal(deckOf(after), deckOf(before),
    'five cards went past the mark and the DECK count did not move');
  assert.match(after, /recycled 5/, 'they are all accounted for in the other number');
});

test('R296 §4 the line explains the mark on hover, in words, where an operator-free player is', () => {
  const html = ui.show(withPile(3023, 2));
  const m = html.match(/<span class="binline"[^>]*title="([^"]*)"/);
  assert.ok(m, 'the deck line carries a title');
  const title = m![1]!;
  assert.match(title, /mark/i, 'it names the mark');
  assert.match(title, /shuffled/i, 'and says what happens when the deck runs out');
  assert.match(title, /look/i,
    'and that nobody may look at them — the half of the ask that is a RULE, not a number');
});

test('R296 §5 the pile the client is handed is card BACKS — the count is public, the cards are not', () => {
  // server/view.ts redacts it; this is the client end of the same claim. A
  // client that could name the cards would be one leak away from the mark
  // being pointless, because remembering what you recycled is exactly what it
  // exists to stop.
  const s = withPile(3024, 4);
  s.sharedRecycled = s.sharedRecycled!.map(() => '__HIDDEN__');
  const line = deckLine(ui.show(s));
  assert.match(line, /recycled 4/, 'a fully redacted pile still counts to four');
  assert.ok(!/__HIDDEN__/.test(ui.show(s)),
    'and nothing prints the placeholder itself onto the board');
});
