/**
 * CR 408.2c — WHAT A PLAYER ACTUALLY SEES OF THE MARK.
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

const { local } = await import('./ui-driver.ts');
const ui = local();

/** the deck's numbers as a player reads them, for seat 0. Board round 8
 * (owner, 2026-10-27) took the always-on deck line off the table: hovering
 * — or tapping — a player's name shows every pile as a number (ui/infotip.ts),
 * so this taps the name, as a finger would, and reads the window it opens. */
let lastTip = '';
function deckLine(html: string): string {
  assert.match(html, /data-tip="counts"[^>]*data-p="0"|data-p="0"[^>]*data-tip="counts"/, 'the name opens the counts at all');
  const shown = ui.click({ tip: 'counts', p: 0 });
  // a second tap closes it; leave the window down for the next read
  const tip = /<div class="tiphead">[\s\S]*?<\/table>(?:<div class="tipfoot">[\s\S]*?<\/div>)?/.exec(shown)?.[0] ?? '';
  ui.click({ tip: 'counts', p: 0 });
  assert.ok(tip, 'the tap opened the counts window');
  lastTip = tip;
  const cell = (k: string): string | undefined => new RegExp(`<th>${k}</th><td>(\\d+)</td>`).exec(tip)?.[1];
  const recycled = Number(cell('recycle pile') ?? 0);
  return `deck ${cell('deck(?: \\(shared\\))?')}${recycled ? ` · recycled ${recycled}` : ''}`;
}

/** a fresh shared-mode game, with `n` cards pushed past seat 0's mark */
function withPile(seed: number, n: number): GameState {
  const h = new Harness(seed);
  const g = new E(h.state);
  for (let i = 0; i < n; i++) g.recycleToBottom(0, 'Geode');
  return g.s;
}

test('§1 with nothing recycled the line is just the deck — no "recycled 0" noise', () => {
  const s = withPile(3020, 0);
  const line = deckLine(ui.show(s));
  assert.match(line, /^deck \d+/, 'it leads with the deck count');
  assert.ok(!/recycled/.test(line),
    'and says nothing about the pile before anybody has put a card in it — "· recycled 0" is '
    + 'noise on a line that is already dense');
});

test('CR 408.2c once cards are recycled the player sees BOTH numbers', () => {
  const s = withPile(3021, 3);
  const line = deckLine(ui.show(s));
  assert.match(line, /deck \d+ · recycled 3/,
    'THE OWNER\'S ASK: "you see how many cards are actually left in the deck, plus recycled"');
});

test('CR 408.2 recycling does NOT inflate the deck count — that is the whole point of the mark', () => {
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

test('§4 the counts explain the mark, in words, where an operator-free player is', () => {
  deckLine(ui.show(withPile(3023, 2)));
  const m = /<div class="tipfoot">([\s\S]*?)<\/div>/.exec(lastTip);
  assert.ok(m, 'the counts window carries the note');
  const title = m![1]!;
  assert.match(title, /mark/i, 'it names the mark');
  assert.match(title, /shuffled/i, 'and says what happens when the deck runs out');
  assert.match(title, /look/i,
    'and that nobody may look at them — the half of the ask that is a RULE, not a number');
});

test('CR 408.2c the pile the client is handed is card BACKS — the count is public, the cards are not', () => {
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
