/*
 * 285 · AN EMPTY HAND SAYS SO (T12, polish round 2026-09-05)
 *
 * The owner's first live look: "when a player has no cards in hand the hand
 * strip is not rendered at all". What actually happened was worse than
 * hidden — it was AMBIGUOUS. Online, the other seat's hand is a row of card
 * backs plus "hand N" in their identity row, and both are derived from the
 * hidden cards themselves; at zero there is no card to be hidden, so the
 * summary vanished and an empty "HAND (0)" strip appeared in a different place
 * in their region. Your own dock read "YOUR HAND (0)" over 20px of nothing.
 *
 * Now every hand surface says "0 cards in hand" in words at zero, and the
 * other seat's summary stays in the identity row where it lives at every other
 * size. The animzone survives: a draw into an empty hand still has a target.
 *
 * Driven through test/ui-driver.ts as the ONLINE client — the two surfaces
 * this is about (the dock, the opponent's summary) exist only there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import { toDeployment } from '../../engine/test/util.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();

/** a real deployment, with both hands emptied through the engine's own handle */
function emptyHands(seed: number): GameState {
  const h = new Harness(seed);
  toDeployment(h);
  const e = new E(h.state);
  e.player(0).hand = []; e.player(1).hand = [];
  e.settle();
  assert.equal(h.state.players[0]!.hand.length, 0, 'fixture: seat 0 has no cards');
  assert.equal(h.state.players[1]!.hand.length, 0, 'fixture: seat 1 has no cards');
  return h.state;
}

test('T12 §1 your own dock says "0 cards in hand", not "(0)" over an empty strip', () => {
  const s = emptyHands(28500);
  const seat: Seat = 0;
  const html = ui.join(viewFor(s, seat), seat, legalActions(s, seat));
  assert.match(html, /Your hand — 0 cards in hand/,
    'the dock label does not spell out that the hand is empty');
  assert.doesNotMatch(html, /Your hand \(0\)/, 'the old "(0)" label is still there');
  // the strip itself is still a real box: ui/anim.ts drops a flight whose
  // endpoint does not measure, so a hidden dock would silently stop draws animating
  assert.match(html, /<div class="zone" data-animzone="hand:0">/,
    'the empty dock lost its animzone — the next draw has nowhere to fly to');
});

test('T12 §2 the other seat\'s summary stays in their identity row and says 0 in words', () => {
  const s = emptyHands(28501);
  const seat: Seat = 0;
  const html = ui.join(viewFor(s, seat), seat, legalActions(s, seat));
  // the count carries .handcount since the life-meter round — it was an inline
  // `style="color:var(--dim)"`, and it grew with the life total beside it
  assert.match(html, /<span class="minihand" data-animzone="hand:1"[^>]*><\/span><span class="handcount">0 cards in hand<\/span>/,
    'the opponent\'s hand summary vanished at zero — it used to be derived from the hidden cards, of which there are none');
  assert.doesNotMatch(html, /<div class="zonelabel">Hand \(0\)<\/div>/,
    'an empty "Hand (0)" zone is drawn in the opponent\'s region — the summary belongs in their identity row, at every size');
  assert.doesNotMatch(html, /Hand — 0 cards in hand/,
    'the opponent\'s empty hand is drawn as a region strip rather than summarised — online, their hand is never a strip');
});

test('T12 §3 negative control: a hand with cards in it is unchanged', () => {
  const h = new Harness(28502);
  toDeployment(h);
  const seat: Seat = 0;
  const mine = h.state.players[0]!.hand.length;
  const theirs = h.state.players[1]!.hand.length;
  assert.ok(mine > 0 && theirs > 0, 'fixture: both hands are dealt');
  const html = ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  assert.match(html, new RegExp(`Your hand \\(${mine}\\)`), 'the dock label with cards in it changed shape');
  assert.match(html, new RegExp(`>hand ${theirs}</span>`), 'the opponent\'s summary with cards in it changed shape');
  assert.doesNotMatch(html, /0 cards in hand/, 'the empty-hand wording is showing on a hand that is not empty');
});
