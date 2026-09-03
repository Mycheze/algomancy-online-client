/* Report #85 — "Soul Siphon (and cards like it) should have a way of showing,
 * while in your hand, what the X value is for each player."
 *
 * The pattern already existed: CardBehavior.xPreview, a UI-only pure query the
 * engine never calls. It could not answer this report, though, because it
 * returns ONE number keyed on the hand owner's seat, and Soul Siphon's X is
 * "the life TARGET PLAYER lost in this battle" — one value per player. Hence
 * `xPreviewRows`, and hence this file.
 *
 * Three things are worth pinning, and only three:
 *
 *  1. THE PREVIEW IS BOUND TO THE TRUTH. A preview that only agrees with
 *     itself is worse than none — it is a confident wrong number. So the test
 *     drives a real battle, reads the rows, then RESOLVES the card and checks
 *     the unit it actually creates.
 *  2. THE CLIENT CAN ACTUALLY COMPUTE IT. The rows are evaluated against
 *     `viewFor(state, seat)` — the redacted state a client really holds — for
 *     BOTH seats, not against the server's raw state. This is what fails if
 *     viewFor ever starts redacting battleCounters.
 *  3. THE NEXT SOUL SIPHON DOES NOT SHIP UNWIRED. A census: every card whose
 *     implementation reads a battle counter either previews it or sits on a
 *     hand-listed exemption carrying its reason.
 *
 * On showing both seats: every battle counter is public. Each is bumped by a
 * visible event, and they only move during battle — which has no hidden
 * simultaneous segment (server/rooms.ts segmentKey() returns null for it). So
 * a row for the opponent leaks nothing that the log has not already printed.
 *
 * Seeds 9600-9699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { allCardNames, getCard } from '../../engine/src/cards/dsl.ts';
import type { XPreviewRow } from '../../engine/src/cards/dsl.ts';
import { viewFor } from '../view.ts';
import {
  effStats, finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle, unitsOf,
} from '../../engine/test/util.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';

/** what the UI's xPreviewFor does, minus the DOM: rows if the card has them,
 * the old single number as one unlabelled row otherwise, null for neither */
function previewRows(state: GameState, name: string, seat: Seat): XPreviewRow[] | null {
  if (state.phase !== 'battle' || !state.battle) return null;
  const c = getCard(name), g = new E(state), region = state.battle.region;
  const rows = c.xPreviewRows?.(g, seat, region)?.filter(r => Number.isFinite(r.x));
  if (rows?.length) return rows;
  const v = c.xPreview?.(g, seat, region);
  return typeof v === 'number' && Number.isFinite(v) ? [{ label: '', x: v }] : null;
}

/** answer a pending decision by value match */
function decide(h: Harness, match: (value: unknown) => boolean): void {
  const dec = h.state.decision!;
  const idx = dec.options.findIndex(o => match(o.value));
  assert.notEqual(idx, -1, `no option matching in [${dec.options.map(o => o.label)}]`);
  h.do({ type: 'decide', seat: dec.seat, choice: idx });
}

/** A attacks with a 7/5, D declines to block and loses 7 — the cheapest real
 * way to put an ASYMMETRIC number into the `lifeLost` ledger. Stops with the
 * after-combat window open and A holding priority. */
function battleWhereDefenderLost7(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');                   // 7/5
  giveResources(h, A, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                        // combat: D loses 7
  assert.equal(h.state.players[D]!.life, 23, 'the ledger has a real 7 in it');
  return { h, A, D };
}

/* ── 1. the preview, bound to what the card actually does ──────────────── */

test('#85: Soul Siphon previews a row PER PLAYER, and the row is the size of the unit it makes', () => {
  const { h, A, D } = battleWhereDefenderLost7(9601);

  // A is holding it, and A has lost nothing — the whole point of the report is
  // that the interesting number is the OTHER player's
  const rows = previewRows(h.state, 'Soul Siphon', A);
  assert.ok(rows, 'Soul Siphon has a preview at all (it had none before #85)');
  assert.deepEqual(rows, [
    { label: 'you', x: 0 },
    { label: h.state.players[D]!.name, x: 7 },
  ], 'one row per player: you 0, the bled opponent 7');

  // now BIND IT: cast it at D and check the row was telling the truth
  const opp = rows![1]!.x;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Soul Siphon') });
  decide(h, v => JSON.stringify(v) === JSON.stringify({ player: D }));   // R67: target at cast
  pass(h); pass(h);
  const made = unitsOf(h, A).filter(u => u.card === 'Unit Token');
  assert.equal(made.length, 1, 'the X/X unit was created');
  assert.deepEqual(effStats(h, made[0]!.id), [opp, opp],
    'the preview row is exactly the unit the effect creates — not a number that merely agrees with itself');
  finishBattle(h);
});

test('#85: the rows swap with the seat asking — "you" is always the hand owner', () => {
  const { h, A, D } = battleWhereDefenderLost7(9602);
  assert.deepEqual(previewRows(h.state, 'Soul Siphon', A),
    [{ label: 'you', x: 0 }, { label: h.state.players[D]!.name, x: 7 }]);
  assert.deepEqual(previewRows(h.state, 'Soul Siphon', D),
    [{ label: 'you', x: 7 }, { label: h.state.players[A]!.name, x: 0 }]);
  finishBattle(h);
});

test('#85: Null Drone shows both seats AND the greatest — the ceiling it actually uses', () => {
  const { h, A, D } = battleWhereDefenderLost7(9603);
  const rows = previewRows(h.state, 'Null Drone', A);
  assert.ok(rows);
  assert.equal(rows!.length, 3, 'two seats plus the max');
  assert.deepEqual(rows!.slice(0, 2),
    [{ label: 'you', x: 0 }, { label: h.state.players[D]!.name, x: 7 }]);
  assert.equal(rows![2]!.x, 7, 'the third row is the greatest, which is the negate threshold');
  assert.match(rows![2]!.label, /greatest/i);
  finishBattle(h);
});

test('#85: a card whose number does not differ by player gets one labelled row', () => {
  const { h, A } = battleWhereDefenderLost7(9604);
  for (const name of ['Dropslime', 'Animated Spark', 'Life Channel',
    'Riftspawn Remnant', 'Mischievous Reclaimer']) {
    const rows = previewRows(h.state, name, A);
    assert.ok(rows, `${name} has a preview`);
    assert.equal(rows!.length, 1, `${name} is a single row`);
    assert.ok(rows![0]!.label.length > 3, `${name}'s row names what it counts`);
    assert.ok(Number.isInteger(rows![0]!.x), `${name}'s row is a whole number`);
  }
  // Riftspawn Remnant's row is the predicate its static hangs on: A lost
  // nothing, D lost 7, and the row follows the seat
  assert.equal(previewRows(h.state, 'Riftspawn Remnant', A)![0]!.x, 0);
  finishBattle(h);
});

test('#85: no preview outside battle — the ledgers only exist during one', () => {
  const h = new Harness(9605);
  assert.notEqual(h.state.phase, 'battle');
  assert.equal(previewRows(h.state, 'Soul Siphon', 0), null);
  assert.equal(previewRows(h.state, 'Null Drone', 0), null);
});

test('#85: the older single-number xPreview still reads as one unlabelled row', () => {
  // the cards that already had #5's xPreview must keep working unchanged, so
  // every render site has exactly one shape to handle. Burning Vengeance is
  // the example the xPreview doc comment itself names ("units that died this
  // battle"); nobody has died here, so it is a flat 0.
  const { h, A } = battleWhereDefenderLost7(9606);
  const rows = previewRows(h.state, 'Burning Vengeance', A);
  assert.deepEqual(rows, [{ label: '', x: 0 }], 'one row, no label — the #5 badge wording survives');
  assert.equal(getCard('Burning Vengeance').xPreviewRows, undefined, 'and it was not converted');
  finishBattle(h);
});

test('R157 §21: Retribution Thing previews BOTH ledgers, because the caster picks one', () => {
  // It used to be a single-number xPreview showing lost PLUS gained. §21 makes
  // the bracket a cast-time mode, so the badge has to show the two numbers the
  // choice is between — a sum is a value nobody can now cast for.
  const { h, A, D } = battleWhereDefenderLost7(9610);
  assert.deepEqual(previewRows(h.state, 'Retribution Thing', D),
    [{ label: 'lost', x: 7 }, { label: 'gained', x: 0 }],
    'the bled defender sees a live 7 on the half they would choose');
  assert.deepEqual(previewRows(h.state, 'Retribution Thing', A),
    [{ label: 'lost', x: 0 }, { label: 'gained', x: 0 }],
    'and the attacker, whose life has not moved, sees why theirs would do nothing');
  finishBattle(h);
});

/* ── 2. through the redaction the client actually sees ─────────────────── */

test('#85: ROUND TRIP — the rows compute identically off viewFor(state, seat), for both seats', () => {
  const { h, A, D } = battleWhereDefenderLost7(9607);
  // This is the assertion that fails the day viewFor starts redacting
  // battleCounters: the client would then be rendering a confident 0.
  for (const seat of [A, D] as Seat[]) {
    const view = viewFor(h.state, seat);
    for (const name of ['Soul Siphon', 'Null Drone', 'The Silent', 'Dropslime',
      'Animated Spark', 'Life Channel', 'Riftspawn Remnant', 'Mischievous Reclaimer']) {
      assert.deepEqual(
        previewRows(view, name, seat), previewRows(h.state, name, seat),
        `${name} must compute the same from seat ${seat}'s redacted view as from the raw state`,
      );
    }
  }
  // and the opponent's number really does survive the redaction — not just
  // "the same", but the same NONZERO number
  const fromA = previewRows(viewFor(h.state, A), 'Soul Siphon', A);
  assert.equal(fromA![1]!.x, 7, "A's client can see what D lost");
  finishBattle(h);
});

test('#85: The Silent previews the surcharge each player is paying, both seats', () => {
  const { h, A, D } = battleWhereDefenderLost7(9608);
  // A casts a spell; the tax is 2 per spell the PAYER has played, so it must
  // move for A and stay put for D
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Soul Siphon') });
  decide(h, v => JSON.stringify(v) === JSON.stringify({ player: D }));
  pass(h); pass(h);
  const rows = previewRows(viewFor(h.state, A), 'The Silent', A)!;
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.label, 'you');
  assert.equal(rows[0]!.x, 2, 'A has played one nontoken spell → a [2] surcharge on the next');
  assert.equal(rows[1]!.x, 0, 'D has played none and is untaxed — the asymmetry is the card');
  finishBattle(h);
});

/* ── 3. the census that stops the next one shipping unwired ────────────── */

/** the source of every function reachable on a card's behavior */
function behaviorSource(v: unknown, depth = 0): string {
  if (depth > 6 || v === null || v === undefined) return '';
  if (typeof v === 'function') return String(v);
  if (Array.isArray(v)) return v.map(x => behaviorSource(x, depth + 1)).join('\n');
  if (typeof v === 'object') return Object.values(v as object).map(x => behaviorSource(x, depth + 1)).join('\n');
  return '';
}

/** how a card can reach a per-battle ledger: E.battleCounter, the raw
 * battleCounters map, or one of the shared named readers */
const READS_A_LEDGER = /battleCounters?\b|lifeLostThisBattle|lifeGainedThisBattle|lifeLostIn|lifeGainedIn/;

/**
 * A card may read a battle counter and still have nothing to show — but the
 * reason has to be written down, by hand, HERE. A new card reading a ledger
 * fails this test until someone decides which side it is on.
 */
const NO_PREVIEW_NEEDED: Record<string, string> = {
  // R143 removed Hush Mush's entry: it no longer reads a ledger at all. The
  // negated effect's controller rides on its own stack item (StackItem
  // .spawnUnder) and the body ENTERS as that seat's unit — the `hushMushGiveTo`
  // scratch slot and the spawn trigger that read it are both gone.
  // R147 removed Borrower of Forms' entry for the same reason and by the same
  // route: the `bof:*` counters and the `copyParks` slot are gone, the copied
  // body rides the spell's own stack item (StackItem.spawnWearing), and the
  // self-spawn trigger that read them has been deleted.
  Origon: 'FLAG-STYLE, and it arrived here as of R166 (2026-08-25) — before that it counted '
    + 'spells on a PER-CARRIER counter, which is exactly the bug R166 fixed ("their first spell" '
    + 'is the PLAYER\'s first, not the first this Origon has seen). Reading the seat-wide '
    + '`spellsPlayedAny:<seat>` ledger is the fix, and it is what brings the card into this '
    + 'census. There is no X and no hand card to hang a number on: the ledger is read inside a '
    + '`when` predicate as a threshold (=== 1), on an [Augment] trigger of a unit already in '
    + 'play. '
    + '⚠ It is NOT nothing, though, and the right affordance is a different one. "Have I already '
    + 'played a spell in this battle?" is hidden information that changes whether it is safe to '
    + 'cast — the same family as reports #43/#45 ("not possible to see the X value for an effect '
    + 'while it is on the stack"). An xPreviewRows entry is the wrong shape for it; a threat '
    + 'indicator on the Origon, or a "first spell" marker on the caster, is the right one. '
    + 'Recorded here rather than filed, because this census is the only thing in the repo that '
    + 'currently knows the question exists.',
  'Echo of Despair': 'FLAG-STYLE, deferred with #85\'s other flags (Suspend\'s life-lock, '
    + 'Abyssal Evocation\'s bin-play permission). It reads the ledger as a BOOLEAN — "did a '
    + 'player lose life this battle" — on an afterCombat trigger of a unit already in play, '
    + 'so there is no X and no hand card to put a number on. Filed separately.',
};

test('#85: CENSUS — every card reading a battle counter previews it or is exempted by name', () => {
  const unwired: string[] = [];
  for (const name of allCardNames()) {
    const c = getCard(name) as unknown as Record<string, unknown>;
    const { xPreview, xPreviewRows, ...behavior } = c;
    if (!READS_A_LEDGER.test(behaviorSource(behavior))) continue;
    if (xPreview !== undefined || xPreviewRows !== undefined) continue;
    if (NO_PREVIEW_NEEDED[name]) continue;
    unwired.push(name);
  }
  assert.deepEqual(unwired, [],
    'these cards read a hidden per-battle ledger and show the player nothing — give them an '
    + 'xPreviewRows, or add them to NO_PREVIEW_NEEDED with the reason');
});

test('#85: the exemption list is live — every entry names a real card that really reads one', () => {
  // an exemption that has gone stale is a hole in the census above
  for (const [name, why] of Object.entries(NO_PREVIEW_NEEDED)) {
    assert.ok(allCardNames().includes(name), `${name} is not a card any more — drop the exemption`);
    const c = getCard(name) as unknown as Record<string, unknown>;
    const { xPreview, xPreviewRows, ...behavior } = c;
    assert.ok(READS_A_LEDGER.test(behaviorSource(behavior)),
      `${name} no longer reads a battle counter — drop the exemption`);
    assert.equal(xPreview ?? xPreviewRows, undefined,
      `${name} has a preview now — drop the exemption instead of carrying both`);
    assert.ok(why.length > 40, `${name}'s exemption needs a real reason, not a shrug`);
  }
});

test('#85: every preview is PURE — reading it changes nothing', () => {
  // the contract xPreviewRows inherits from xPreview: the engine never calls
  // it, and neither may it call the engine back in a way that mutates
  const { h, A, D } = battleWhereDefenderLost7(9609);
  const before = JSON.stringify(h.state);
  for (const name of allCardNames()) {
    const c = getCard(name);
    if (!c.xPreviewRows && !c.xPreview) continue;
    for (const seat of [A, D] as Seat[]) previewRows(h.state, name, seat);
  }
  assert.equal(JSON.stringify(h.state), before, 'a preview must not touch the game state');
  finishBattle(h);
});
