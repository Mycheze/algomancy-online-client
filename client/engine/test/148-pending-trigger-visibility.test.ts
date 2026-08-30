/* R175 — playtest report #15, refiled against its REAL cause.
 *
 * WHAT THE REPORT SAID (BRDM, 2026-08-20, action 180):
 *
 *     "Why didn't Refuse Reclaimer get a counter from my Oracle dying?
 *      It should have activated again"
 *
 * WHAT THE LEDGER SAID FOR FIVE DAYS: `by-design`, R12 region scoping — *"a
 * Reclaimer standing at home genuinely does not see an Oracle die in the battle
 * region"* — guarded by two region-scoping tests in `28-metal-c.test.ts`.
 *
 * WHAT ACTUALLY HAPPENED. The game was replayed on the engine it was played on
 * (`322d536~1`, where BRDM replays 262/262 clean; at HEAD it diverges at action
 * 34 and cannot reach the moment at all — see CARD-TODO #51):
 *
 *     a177  Reclaimer's trigger resolves ......... counters 0 -> 1
 *     a179  Oracle of Foretelling dies -> bin
 *     a179  Reclaimer's trigger FIRES AGAIN
 *     a180  <- the report was filed HERE. The trigger is ON THE STACK.
 *     a184  it resolves ......................... counters 1 -> 2
 *
 * Both units were in region 1, in the same formation, both his. **Region
 * scoping was never involved.** The trigger had already fired and was four
 * actions from resolving; the owner was looking at a board that could not tell
 * him so. Confirmed by him, 2026-08-25: *"It must have been a UI issue then."*
 *
 * So the closed entry was a plausible story fitted to the wrong game. Somebody
 * reconstructed a scenario that would explain the complaint, verified the
 * engine handles THAT correctly, and closed it — and the two guards pin a rule
 * the report never touched. That is the same shape as the four blind guards
 * R173 repaired, in the one entry an audit had cleared, and only the replay
 * could show it.
 *
 * WHY IT IS NOT LIVE. The stack was not on the table when he filed: the stack
 * window landed in `08575eb` on 2026-08-21, the DAY AFTER. There was no way to
 * see a pending trigger because there was nowhere to see the stack.
 *
 * WHAT THIS FILE HOLDS DOWN. A unit's own triggered ability, while it sits on
 * the stack, must be visible TO ITS CONTROLLER and must name the unit it came
 * from — read through `viewFor`, the way R173's guards do, because a field the
 * server redacts on the way out leaves every engine-side assertion green and
 * the screen exactly as blank as it was on 2026-08-20.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { viewFor } from '../../server/view.ts';
import { stackRows, leadRow, stackCaption } from '../../ui/flash.ts';
import { spawn, toDeployment, toNextBattle, ent, withE as whiteBox } from './util.ts';
import type { Seat } from '../src/types.ts';

/**
 * Report #15's shape, minimally: a Refuse Reclaimer in play, and another of its
 * controller's units dying beside it. Same controller, same region — the board
 * the owner actually had, with the region-scoping red herring removed.
 */
function reclaimerFixture(seed: number): { h: Harness; me: Seat; reclaimer: number; victim: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const me = h.state.initiative;
  const reclaimer = spawn(h, me, 'Refuse Reclaimer');
  const victim = spawn(h, me, 'Oracle of Foretelling');
  // IT HAS TO BE A BATTLE, and that is not incidental dressing — it is the
  // report. Report #15 was filed at turn 7, phase battle. Outside a battle
  // there is no priority window, `settle()` runs the trigger queue straight
  // through, and the counter lands before anyone could look: the board the
  // owner complained about cannot exist. The first draft of this fixture
  // killed the Oracle in deployment and all three tests failed for exactly
  // that reason — a fixture that cannot reproduce the report is worse than no
  // test, because it fails loudly for the wrong cause.
  toNextBattle(h, me);
  h.do({ type: 'declareAttack', seat: me, columns: [[reclaimer, victim]] });
  return { h, me, reclaimer, victim };
}

test('#15 a pending trigger is ON THE STACK the instant another ally dies', () => {
  const { h, reclaimer, victim } = reclaimerFixture(5960);
  const before = ent(h, reclaimer)!.counters;

  whiteBox(h, e => e.destroy(e.entity(victim)!, 'is deleted'));

  // The counter has NOT landed yet — that is the whole report. What must be
  // true is that the reason is visible, not that the effect is instant.
  const item = h.state.stack.find(i => i.kind === 'triggered' && i.sourceId === reclaimer);
  assert.ok(item,
    'the trigger must be on the stack at this moment. If it is not, either the card stopped '
    + 'triggering (a real regression) or triggers stopped using the stack — and in the second '
    + 'case this report becomes unreproducible rather than fixed, so rewrite this test, do not '
    + 'delete it.');
  assert.equal(ent(h, reclaimer)!.counters, before,
    'and the counter has NOT arrived yet — this is exactly the board the owner was looking at '
    + 'when he filed, four actions before it resolved');
});

test('#15 the pending trigger is visible to its own controller, not redacted away', () => {
  const { h, me, reclaimer, victim } = reclaimerFixture(5961);
  whiteBox(h, e => e.destroy(e.entity(victim)!, 'is deleted'));

  // viewFor, not h.state: the owner's complaint was about what reached HIS
  // SCREEN. An engine-side assertion cannot see a redaction on the way out.
  const seen = viewFor(h.state, me).stack.find(i => i.kind === 'triggered' && i.sourceId === reclaimer);
  assert.ok(seen,
    'the controller of a pending trigger must be able to see it in the stack he is served. '
    + 'This is the assertion the original close was missing entirely: it checked a region rule '
    + 'the report never involved.');
});

test('#15 the stack strip draws it, and the row names the unit it came from', () => {
  const { h, me, reclaimer, victim } = reclaimerFixture(5962);
  whiteBox(h, e => e.destroy(e.entity(victim)!, 'is deleted'));

  const view = viewFor(h.state, me);
  const rows = stackRows(view.stack, [], 0, view.resolving ?? null);
  const row = rows.find(r => r.item.sourceId === reclaimer);
  assert.ok(row, 'the pending trigger reaches the strip the client actually paints');

  // "Why didn't Refuse Reclaimer get a counter" — the answer has to name the
  // Reclaimer, or the row is on screen and still does not answer the question.
  const names = row.item.card ?? h.state.entities[row.item.sourceId!]?.card;
  assert.equal(names, 'Refuse Reclaimer',
    'the row must identify the unit whose ability this is — a row that says only "a trigger" '
    + 'leaves the player exactly where report #15 left him');

  assert.ok(leadRow(rows), 'and the strip has a lead row, so the caption has something to be about');
  const cap = stackCaption(rows, { mySeat: me, names: ['Ben', 'Rashi'] });
  assert.ok(cap, 'the caption renders rather than returning null on a triggered item');
  assert.ok(cap.verb, 'and it says what is happening to the lead item, which is the one line '
    + 'that would have answered the question the report asked');
});
