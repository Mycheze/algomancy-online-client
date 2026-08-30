/* R283 — {Reaping} pays ONE card for the whole kill, and its second sentence
 * is unreachable in this pool.
 *
 * ── WHY THIS WAS WRONG FOR AS LONG AS IT WAS ──────────────────────────
 *
 * R184 built {Reaping} as a kill rider and says so in its own words: none of
 * the four cards *"carries a reminder at all. `ui/glossary.ts` is the repo's
 * own statement of it, AND IT IS WHAT R184 READ."* `156-reaping-and-formation`
 * repeats that in its header. It is false, and the CT-171 glossary audit found
 * out by opening the scans. Every {Reaping} card prints, in italics above its
 * ability line:
 *
 *   (When a reaping source kills one or more units, draw a card.
 *    It loses reaping until regroup.)
 *
 * It is absent from `AlgomancyCards-OracleText.json` because {Reaping} is a
 * TYPE-LINE ATTRIBUTE and that file's `text` field carries ABILITY text —
 * owner, 2026-08-30: *"That's cause they're attributes in the type line, not
 * abilities."* So the reminder never reached `printed.json`, no scan could see
 * it, and the attribute was built from the repo's own paraphrase instead.
 *
 * Two things follow, and only one of them is a bug worth code.
 *
 * ── 1. "one or more units, draw A CARD" — one draw, not one per body ──
 *
 * Both payout sites read `for (const _ of killed/dead) this.reapingDraw(...)`.
 * §2 kills two units in one diff and requires one card.
 *
 * ⚠ HOW REACHABLE IS IT? §3 measures, and the honest answer is "barely": all
 * four printers are single-target `kind: 'spell'` cards, so a two-body diff
 * needs a CASCADE — the killed unit was carrying a static that kept another
 * alive. That is why the owner had *"not noticed anything particularly wrong
 * with reaping cards"* when this was filed, and he was right to say so. It is
 * fixed because the card says so, not because it was costing games.
 *
 * ── 2. "It loses reaping until regroup" is UNREACHABLE, so nothing is built ──
 *
 * A one-shot spell resolves once; `killRiders` fires once per resolving part.
 * For a source that cannot kill twice, "loses reaping until regroup" can never
 * be observed. It would bite only if a UNIT could carry {Reaping} — and §4
 * proves nothing in the pool can give it one: the four printers are all spells
 * with empty `augmentAttrs` (so no virus/augment donation), and The Omniphage,
 * the only other card naming the attribute, grants from BIN UNIT cards.
 *
 * A 2026-08-26 round built a {Reaping} combat seam on a premise like this one
 * and had to revert it — no test could have failed, because the case could not
 * happen. §4 is the guard that was missing then: it goes RED the day a card
 * makes a unit reaping, which is the day the second sentence needs code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import '../src/cards/registry.ts';
import '../src/apply.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { spawn, toDeployment } from './util.ts';
import type { Seat } from '../src/types.ts';

function board(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative;
  return { h, A, D: (1 - A) as Seat };
}

test('R283 §0 PREMISE: the kill-diff seam really pays a reaping source for one dead unit', () => {
  const { h, A, D } = board(28300);
  const victim = spawn(h, D, 'Unit Token');
  const e = new E(h.state);
  const before = e.snapshotUnits();
  assert.ok(before.has(victim), 'non-vacuity: the victim is in the snapshot');
  e.destroy(e.entity(victim)!, 'dies');
  const drew = h.state.players[A]!.hand.length;
  e.killRiders(before, new Set(['Reaping']), 'Probe', A);
  assert.equal(h.state.players[A]!.hand.length, drew + 1,
    'one kill still pays exactly one card — the seam works and the test can see it');
});

test('R283 §1 CONTROL: a diff with no dead unit pays nothing', () => {
  const { h, A, D } = board(28301);
  spawn(h, D, 'Unit Token');
  const e = new E(h.state);
  const before = e.snapshotUnits();
  const drew = h.state.players[A]!.hand.length;
  e.killRiders(before, new Set(['Reaping']), 'Probe', A);
  assert.equal(h.state.players[A]!.hand.length, drew,
    'nothing died, so nothing is drawn — the payout is not unconditional');
});

test('R283 §2 THE FIX: two units dying in one kill draw ONE card, not two', () => {
  const { h, A, D } = board(28302);
  const a = spawn(h, D, 'Unit Token');
  const b = spawn(h, D, 'Unit Token');
  const e = new E(h.state);
  const before = e.snapshotUnits();
  // non-vacuity FIRST: both really are in the snapshot and both really die
  assert.ok(before.has(a) && before.has(b), 'both victims are in the snapshot');
  e.destroy(e.entity(a)!, 'dies');
  e.destroy(e.entity(b)!, 'dies');
  assert.ok(!e.entity(a) && !e.entity(b), 'both really left play — the diff has two bodies');
  const drew = h.state.players[A]!.hand.length;
  e.killRiders(before, new Set(['Reaping']), 'Probe', A);
  assert.equal(h.state.players[A]!.hand.length, drew + 1,
    'the printed reminder reads "kills ONE OR MORE units, draw A CARD" — one card for the '
    + 'whole kill. Paying per body is the pre-R283 reading, taken from the repo own paraphrase '
    + 'because the printed reminder never reached printed.json');
});

test('R283 §2b and it does not scale with the body count — three dead still draw one', () => {
  const { h, A, D } = board(28303);
  const ids = [spawn(h, D, 'Unit Token'), spawn(h, D, 'Unit Token'), spawn(h, D, 'Unit Token')];
  const e = new E(h.state);
  const before = e.snapshotUnits();
  assert.ok(ids.every(i => before.has(i)), 'non-vacuity: all three are in the snapshot');
  for (const i of ids) e.destroy(e.entity(i)!, 'dies');
  assert.ok(ids.every(i => !e.entity(i)), 'all three really left play');
  const drew = h.state.players[A]!.hand.length;
  e.killRiders(before, new Set(['Reaping']), 'Probe', A);
  assert.equal(h.state.players[A]!.hand.length, drew + 1,
    'still one card. The old reading drew one PER BODY, so this is the assertion that '
    + 'separates "one per kill" from "one per unit" — two dead could be a coincidence of '
    + 'some other off-by-one, three cannot');
});

test('R283 §3 the fix is barely reachable in this pool, and that is recorded not guessed', () => {
  const printers = allCardNames().filter(n => (getCard(n).attrs ?? []).includes('Reaping'));
  assert.deepEqual(printers.sort(),
    ['Flame of History', 'Invasive Reassignment', 'Noxious Demise', 'Seismomancy'],
    'the {Reaping} printers have changed — re-measure how many units one of them can kill');
  for (const n of printers) {
    assert.equal(getCard(n).kind, 'spell', `${n} is no longer a spell — a persistent reaping `
      + 'source can kill more than once, which makes BOTH sentences of the reminder live');
  }
  // every one is single-target: a two-body diff needs a cascade, which is why
  // the owner had noticed nothing wrong when this was filed.
  for (const n of printers) {
    assert.match(getCard(n).text, /\btarget\b|any target/i,
      `${n}: expected a targeted spell — if it now hits several units at once, the two-body `
      + 'case in §2 stopped being a corner and became the normal one');
  }
});

test('R283 §4 nothing in the pool can give a UNIT reaping, which is why the second sentence is not built', () => {
  const printers = allCardNames().filter(n => (getCard(n).attrs ?? []).includes('Reaping'));
  assert.ok(printers.length > 0, 'non-vacuity: the pool really does print {Reaping}');
  // (a) no printer can donate it as an augment/virus — R79 donates augmentAttrs
  for (const n of printers) {
    assert.deepEqual(getCard(n).augmentAttrs ?? [], [],
      `${n} can now donate its attributes to a host. If {Reaping} can land on a UNIT, the unit `
      + 'can kill more than once and "It loses reaping until regroup" MUST be implemented.');
  }
  // (b) nothing else grants it either
  const others = allCardNames().filter(n => !printers.includes(n)
    && /Reaping/.test(JSON.stringify(getCard(n), (_k, v) => typeof v === 'function' ? v.toString() : v)));
  assert.deepEqual(others, ['The Omniphage'],
    'a card other than The Omniphage now names {Reaping}. The Omniphage grants attributes off '
    + 'BIN UNIT cards and every printer is a spell, so today it cannot reach one. Any other '
    + 'card naming the attribute has to be read: if it can make a unit reaping, the '
    + 'until-regroup clause becomes reachable and needs building (CT-173).');
});
