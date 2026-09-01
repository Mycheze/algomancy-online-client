/* CT-174(a) / report #156 — THE HAND-REVEAL AID GOES AWAY WHEN THE PLAYER
 * SAYS SO, AND AT NO OTHER TIME.
 *
 * THE REPORT, verbatim (DQVZ):
 *
 *   "It'd be better to NOT automatically dismiss the 'hand revealed' helper
 *    box for the player. Just leave it there till they dismiss it themselves."
 *
 * ── WHAT WAS ACTUALLY DISMISSING IT, MEASURED
 *
 * The ticket's own guess was "something else is clearing it early", and the
 * obvious suspects are all innocent — each of these was checked before
 * anything here was written:
 *
 *   · the ENGINE never clears it in this game. `E.revealHandTo` writes
 *     `seenHand[viewer]` once; the only clear is `apply.ts`'s draft pack
 *     merge, and DQVZ is CONSTRUCTED.
 *   · the SERVER never touches it. `viewFor` is `structuredClone(state)` and
 *     the string `seenHand` does not occur anywhere in client/server/, so it
 *     rides every push, including inside a frozen segment.
 *   · nothing DECAYS. `seenHandKey` reads the snapshot's own `turn`, never the
 *     live one, and the snapshot's card array is a copy — so neither the turn
 *     advancing nor the opponent's hand changing moves the key.
 *   · there is no timeout. The self-expiring sibling is `glimpseUp`, a
 *     different box.
 *
 * Replayed against DQVZ's own 197 actions, `seenHandView(...).show` goes true
 * at [97] — Eldritch Dreamtender, "sacrifice me — look at that player's hand
 * and discard a card" — and is still true at [119], the action the owner filed
 * from, and at every action to the end of the game. §3 pins that.
 *
 * So the aid cannot vanish by itself, and `seenDrop` has exactly one writer
 * (`forgetSeen`) with exactly two callers, both click handlers. THE BUG WAS IN
 * WHAT AN ORDINARY CLICK DID:
 *
 *     return { show: cards.length > 0, … }        // ui/inspect.ts, before
 *
 * The strip's own hint says *"✕ a card to forget it"*, so crossing cards off
 * as they are played is the intended use — and crossing off the LAST one
 * deleted the whole aid, persistently (`algoSeen:<room>` in localStorage) and
 * with no way back and no affordance left to bring it back with. One ✕ hit by
 * accident does the same thing. From the player's side that is exactly "it
 * dismissed itself".
 *
 * §1 the aid survives its own last card
 * §2 the explicit dismiss is the only path to hidden
 * §3 …and nothing in a real game's states takes it away (DQVZ, replayed)
 * §4 the strip on the real client: it collapses, it does not disappear
 *
 * ⚠ HALF (b) OF #156 IS NOT HERE. "show the cards at the END of the revealing
 * moment" is `E.revealHandTo` snapshotting at call time, one line above
 * `ctx.choose('dream', …)` in batch-metal-a.ts — an ENGINE change, and this
 * lane does not own it. CT-174 stays open for it.
 *
 * Seeds 26800-26899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { apply, IllegalAction, legalActions } from '../src/apply.ts';
import { dealScenario } from '../../server/scenarios.ts';
import { viewFor } from '../../server/view.ts';
import {
  dismissSeenCard, dismissSeenHand, restoreSeenHand, seenHandKey, seenHandView,
} from '../../ui/inspect.ts';
import { client } from './ui-driver.ts';
import type { SeenHandDismissals } from '../../ui/inspect.ts';
import type { GameState, Seat } from '../src/types.ts';
import { toDeployment } from './util.ts';

/** the real client, driven — §4 only */
const ui = await client();
const ME: Seat = 0, THEM: Seat = 1;

/** a real look at the opponent's hand, through the engine's own writer */
function look(seed: number): GameState {
  const h = new Harness(seed);
  toDeployment(h);
  const e = new E(h.state);
  e.revealHandTo(ME, THEM);
  e.settle();
  assert.ok(h.state.seenHand[ME], 'fixture: the engine really recorded the look');
  return h.state;
}

/* ══ §1 — the aid survives its own last card ═══════════════════════════ */

test('CT-174 crossing off the last card does not delete the aid', () => {
  const s = look(26800);
  const seen = s.seenHand[ME]!;
  assert.ok(seen.cards.length >= 2, 'fixture: there is more than one card to cross off');

  let drop: SeenHandDismissals | null = null;
  for (const [i] of seen.cards.entries()) {
    drop = dismissSeenCard(seen, drop, i);
    const v = seenHandView(seen, drop);
    assert.equal(v.show, true,
      `the aid vanished after crossing off card ${i + 1} of ${seen.cards.length}. The hint tells `
      + 'the player to ✕ cards as they are played, so this is the NORMAL end of using it — and '
      + 'it used to delete the aid persistently, with nothing left to bring it back. That is '
      + 'report #156: "leave it there till they dismiss it themselves".');
  }
  const done = seenHandView(seen, drop);
  assert.equal(done.cards.length, 0, 'every card really is crossed off');
  assert.equal(done.emptied, true, 'and the view says so, so the surface can collapse it');
  assert.equal(done.dismissed, seen.cards.length, 'and counts them, so it can offer them back');
});

test('CT-174 …and they can all be put back — an accidental ✕ is not permanent', () => {
  const s = look(26801);
  const seen = s.seenHand[ME]!;
  let drop: SeenHandDismissals | null = null;
  for (const [i] of seen.cards.entries()) drop = dismissSeenCard(seen, drop, i);
  assert.equal(seenHandView(seen, drop).cards.length, 0, 'fixture: nothing left on screen');

  const back = restoreSeenHand(seen, drop);
  const v = seenHandView(seen, back);
  assert.deepEqual(v.cards.map(c => c.name), seen.cards, 'the whole look is back, in order');
  assert.equal(v.dismissed, 0, 'and nothing is crossed off any more');
});

test('CT-174 a restore touches only THIS look — another look\'s record is not its to discard', () => {
  const s = look(26802);
  const seen = s.seenHand[ME]!;
  const foreign: SeenHandDismissals = { key: 'someone-elses-look', cards: [0, 1], all: true };
  assert.deepEqual(restoreSeenHand(seen, foreign), foreign,
    'a dismissal record belonging to a different look is left exactly as it was');
});

/* ══ §2 — the explicit dismiss is the only path to hidden ══════════════ */

test('CT-174 the only way the aid comes off the screen is the player dismissing it', () => {
  const s = look(26803);
  const seen = s.seenHand[ME]!;

  // every reachable dismissal state, and which of them may hide the aid
  const states: [string, SeenHandDismissals | null][] = [
    ['nothing dismissed', null],
    ['one card crossed off', dismissSeenCard(seen, null, 0)],
    ['every card crossed off', seen.cards.reduce<SeenHandDismissals | null>(
      (d, _, i) => dismissSeenCard(seen, d, i), null)],
    ['a record from another look', { key: 'other', cards: [0], all: true }],
    ['restored', restoreSeenHand(seen, dismissSeenCard(seen, null, 0))],
  ];
  for (const [what, drop] of states) {
    assert.equal(seenHandView(seen, drop).show, true,
      `the aid is hidden with ${what} — nothing but the ✕ dismiss button may do that`);
  }
  assert.equal(seenHandView(seen, dismissSeenHand(seen)).show, false,
    'positive control: the explicit dismiss DOES hide it, or this guard is about nothing');

  // …and the next look brings it back, because the dismissal names the look
  const later = { turn: seen.turn + 1, cards: [...seen.cards].reverse() };
  assert.notEqual(seenHandKey(later), seenHandKey(seen), 'fixture: a genuinely different look');
  assert.equal(seenHandView(later, dismissSeenHand(seen)).show, true,
    'a dismissal belongs to the look it was made against, and never to the next one');
});

/* ══ §3 — nothing in a real game's states takes it away ════════════════ */

const DQVZ = '/home/bena/Documents/Algomancy/var/games/DQVZ.json';

test('CT-174 across every state of the reported game, the aid is never taken away', { skip: !existsSync(DQVZ) && 'var/games/DQVZ.json is not on this machine (var/ is gitignored)' }, () => {
  // THE REPORT'S OWN GAME. This is the measurement the ticket's premise needed
  // and did not have: if any of turn-decay, hand-change, redaction or a
  // timeout could clear the look, it would show up here as a `show` that goes
  // false somewhere between the reveal and the end of the game.
  const raw = JSON.parse(readFileSync(DQVZ, 'utf8')) as {
    seed: number; names: [string, string]; mode: string; els: unknown;
    decks: unknown; scenario: unknown; actions: { type: string }[];
  };
  let state = (dealScenario(
    raw.seed, raw.names, raw.mode as never, raw.els as never,
    raw.decks as never, raw.scenario as never,
  ) as { state: GameState }).state;

  let firstShown: number | null = null;
  const wentDark: number[] = [];
  raw.actions.forEach((a, i) => {
    try { state = apply(state, a as never).state; }
    catch (err) { if (!(err instanceof IllegalAction)) throw err; return; }
    const v = viewFor(state, ME);
    const sv = seenHandView(v.seenHand?.[ME], null);
    if (sv.show && firstShown === null) firstShown = i;
    if (firstShown !== null && !sv.show) wentDark.push(i);
  });

  assert.notEqual(firstShown, null,
    'the look never lands at all — this fixture is not the reported game any more');
  assert.deepEqual(wentDark, [],
    `the aid went dark at action(s) ${wentDark.join(', ')} with nobody clicking anything. `
    + 'Something in the state pipeline is clearing the look after all — which is what the '
    + 'ticket guessed and this measurement had ruled out.');
  assert.ok(firstShown! < 119,
    `the look lands at [${firstShown}], after the action the owner filed from ([119]) — the `
    + 'fixture no longer covers the moment the report is about');
});

/* ══ §4 — the strip on the real client ═════════════════════════════════ */

test('CT-174 on the real client the strip collapses to its head instead of disappearing', () => {
  const s = look(26804);
  ui.join(viewFor(s, ME), ME, legalActions(s, ME));
  const shown = ui.html();
  assert.match(shown, /Their hand, seen turn/, 'fixture: the aid is on screen after the look');
  const cards = [...shown.matchAll(/data-btn="seendrop" data-i="(\d+)"/g)].map(m => m[1]!);
  assert.ok(cards.length > 1, 'fixture: there is more than one card to cross off');

  let html = shown;
  for (const i of cards) html = ui.click({ btn: 'seendrop', i });
  assert.match(html, /Their hand, seen turn/,
    'the aid disappeared when the last card was crossed off — #156 exactly');
  assert.match(html, /crossed off/, 'and it says what happened to the cards');
  assert.ok(ui.has({ btn: 'seenrestore' }),
    'and offers them back — without this the player has no way to undo an ✕ they did not mean');

  const restored = ui.click({ btn: 'seenrestore' });
  assert.equal([...restored.matchAll(/data-btn="seendrop"/g)].length, cards.length,
    'the restore put every card back on screen');

  // and the one control that is allowed to take it away still does
  const gone = ui.click({ btn: 'seenhideall' });
  assert.doesNotMatch(gone, /Their hand, seen turn/,
    'positive control: the ✕ dismiss button still dismisses, or §4 is about nothing');
});
