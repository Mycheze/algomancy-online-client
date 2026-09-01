/* R288 / BL-30 — "DID YOU MEAN TO TARGET YOUR OWN UNITS?"
 *
 * The owner, 2026-08-26:
 *
 *   "there are many cards in the game that you can TECHNICALLY point at
 *    several of your own units (Fight, Organic Exchange). We shouldn't stop
 *    that from happening, they're legal targets, but it might be nice to add a
 *    small warning if they select two of their own units (Did you mean to
 *    target allies with this spell? Yes or No, rechoose targets). This should
 *    only be applied to spells where one target is 'supposed' to be an ally
 *    and the other is an enemy, in cases where it could be easy to misclick
 *    your own dudes."
 *
 * …and, asked how that family should be DERIVED rather than listed
 * (2026-09-01): *"Anything that says target ally AND target unit on the same
 * card … if a card calls out 'one ally, one other target', it is almost always
 * going to be one ally and one enemy."*
 *
 * ⚠ THE FALSE POSITIVE MATTERS MORE THAN THE TRUE ONE, and BL-30's doneWhen
 * says so in as many words: a spell that is SUPPOSED to hit only allies must
 * never ask, or the guard becomes noise and then gets ignored. §2 and §3 are
 * that half, and both are derived from the pool rather than from two card
 * names.
 *
 * ⚠ AND ONE THING THE OWNER'S TWO MESSAGES DISAGREE ABOUT, recorded rather
 * than smoothed over: he named ORGANIC EXCHANGE in the first message and gave
 * a derivation in the second that excludes it. Organic Exchange prints "two
 * target units" with no ally slot at all, so "target ally AND target unit on
 * the same card" does not describe it. It is a different shape: pointing it at
 * two of your own is not a misclick guess, it is a KNOWN NO-OP (you exchange
 * control of two units you already control), which is R74's job — a `warning`,
 * not a `confirm`. §0 pins the derived family so that difference is visible
 * instead of being argued about again.
 *
 * §0 the family, DERIVED from printed specs — and what is not in it
 * §1 the true positive: Fight, aimed at two of your own
 * §2 the false positives: the ally slot itself, and an enemy in the open slot
 * §3 …and no ally-only or enemy-only spell in the pool ever asks
 * §4 nothing is narrowed: the candidate list and the outcome are untouched
 * §5 the client asks, and "yes" sends exactly the pick it interrupted
 *
 * Seeds 27800-27899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import { effectByKey, getCard, mixedAllegiance, slotWhat, type TargetSpec } from '../src/cards/dsl.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { give, giveResources, spawn, toDeployment, toNextBattle } from './util.ts';
import type { DecisionOption, Seat } from '../src/types.ts';

const ui = await client();

/** every printed card's spell target spec, where it has one */
function specs(): { name: string; spec: TargetSpec; max: number }[] {
  const out: { name: string; spec: TargetSpec; max: number }[] = [];
  for (const name of new Set(DECK_LIST)) {
    let def;
    try { def = getCard(name); } catch { continue; }
    for (const key of [def.spellEffect, ...(def.abilities ?? []).map(a => a.effect)]) {
      const eff = key ? (typeof key === 'string' ? effectByKey(key) : key) : null;
      const spec = eff?.targets;
      if (!spec) continue;
      // the slot count the collector would actually use: an 'X' count is not
      // knowable here, so the fixed slots are what this census can speak about
      const counted = spec.count === 'X' ? (spec.slots?.length ?? 1) : (spec.count ?? 1);
      out.push({ name, spec, max: counted + (spec.extraSlots ?? 0) });
    }
  }
  return out;
}

/* ══ §0 THE FAMILY, DERIVED ═══════════════════════════════════════════ */

test('R288 §0 the family is derived from printed specs, and Fight is in it', () => {
  const all = specs();
  assert.ok(all.length > 40, `fixture: ${all.length} target specs found — the census is not reading the pool`);
  const mixed = [...new Set(all.filter(s => mixedAllegiance(s.spec, s.max)).map(s => s.name))].sort();
  assert.ok(mixed.includes('Fight'),
    `the card the owner named first is not in the derived family: ${mixed.join(', ') || 'none'}`);
  assert.ok(mixed.length >= 2,
    'only one card matched — a "derivation" with one member is a hard-coded name wearing a hat');
  // ⚠ ORGANIC EXCHANGE IS DELIBERATELY ABSENT. See the header: the owner named
  // it in the ask and then gave a rule that excludes it, and the rule is the
  // later and more general statement. Pinned so the disagreement is on the
  // record rather than rediscovered.
  assert.ok(!mixed.includes('Organic Exchange'),
    'Organic Exchange is in the derived family — then either its printed spec has gained an '
    + 'ally slot, or `mixedAllegiance` has been widened past "target ally AND target unit on '
    + 'the same card". Both are real changes and both need the owner');
});

test('R288 §0 CONTROL: the predicate rejects both single-allegiance shapes', () => {
  // If this ever passes everything, §1's true positive is meaningless.
  const allyOnly: TargetSpec = { what: 'allyUnit', prompt: 'x', count: 2 };
  const enemyOnly: TargetSpec = { what: 'enemyUnit', prompt: 'x', count: 2 };
  const plain: TargetSpec = { what: 'unit', prompt: 'x', count: 2 };
  assert.equal(mixedAllegiance(allyOnly, 2), false, 'a spell meant to hit two allies must never ask');
  assert.equal(mixedAllegiance(enemyOnly, 2), false, 'nor one that cannot hit an ally at all');
  assert.equal(mixedAllegiance(plain, 2), false,
    'nor one that never says "ally" — that is Organic Exchange, and it is a no-op question '
    + '(R74), not a misclick question');
  assert.equal(mixedAllegiance({ ...plain, slots: ['allyUnit', 'unit'] }, 2), true,
    'positive control: the shape the owner described IS accepted');
  assert.equal(mixedAllegiance({ ...plain, slots: ['allyUnit', 'unit'] }, 1), false,
    'and only when the second slot is actually being collected — `max` is the caller\'s, '
    + 'because an X-counted spec does not know it');
});

/* ══ the fixture ══════════════════════════════════════════════════════ */

/** a battle window with Fight in hand, an ally and an enemy on the board */
function fightBoard(seed: number): { h: Harness; me: Seat; ally: number; foe: number; idx: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Oorblak');
  const mine = spawn(h, D, 'Prickly Protector');
  const mine2 = spawn(h, D, 'Prickly Protector');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'passPriority', seat: A });
  assert.equal(h.state.priority, D, 'fixture: the defender holds the window');
  giveResources(h, D, 'earth', 8);
  // TWO of mine: the misclick is aiming the open slot at a second unit of my
  // own, which needs a second one to exist
  void mine2;
  return { h, me: D, ally: mine, foe: atk, idx: give(h, D, 'Fight') };
}

/** the option indices of a decision, by what they point at */
const optFor = (opts: readonly DecisionOption[], id: number): DecisionOption | undefined =>
  opts.find(o => !!o.value && typeof o.value === 'object' && (o.value as { unit?: number }).unit === id);

/* ══ §1 THE TRUE POSITIVE ═════════════════════════════════════════════ */

test('R288 §1 Fight aimed at a second unit of your own asks whether you meant it', () => {
  const { h, me, ally, foe, idx } = fightBoard(27800);
  h.do({ type: 'playCard', seat: me, handIndex: idx });

  // slot 0 — the forced ally
  const first = h.state.decision!;
  assert.equal(first.kind, 'targets', 'fixture: it is asking for a target');
  const pickAlly = first.options.findIndex(o => (o.value as { unit?: number })?.unit === ally);
  assert.ok(pickAlly >= 0, 'fixture: the ally is on the menu for slot 0');
  h.do({ type: 'decide', seat: me, choice: pickAlly });

  // slot 1 — the open one. THIS is where the question belongs.
  const second = h.state.decision!;
  const mineOpt = second.options.find(o => {
    const u = (o.value as { unit?: number })?.unit;
    return u !== undefined && u !== ally && h.state.entities[u]?.controller === me;
  });
  assert.ok(mineOpt, 'fixture: a second unit of my own is a legal target for slot 1');
  assert.match(String(mineOpt.confirm),
    /every target you have picked is one of your own units/,
    'no question was asked about aiming a mixed-allegiance spell entirely at your own side — '
    + 'which is the whole of BL-30');
  void foe;
});

/* ══ §2 THE FALSE POSITIVES, on the same card ═════════════════════════ */

test('R288 §2 the ALLY slot never asks — being an ally is what that slot is for', () => {
  const { h, me, idx } = fightBoard(27801);
  h.do({ type: 'playCard', seat: me, handIndex: idx });
  const first = h.state.decision!;
  assert.ok(first.options.length > 0, 'fixture: slot 0 has candidates');
  assert.deepEqual(first.options.filter(o => o.confirm).map(o => o.label), [],
    'slot 0 asked "did you mean an ally?" about the slot that can hold NOTHING but an ally. '
    + 'A guard that fires on every cast is one nobody reads');
});

test('R288 §2 picking the ENEMY in the open slot is silent', () => {
  const { h, me, ally, foe, idx } = fightBoard(27802);
  h.do({ type: 'playCard', seat: me, handIndex: idx });
  const pickAlly = h.state.decision!.options.findIndex(o => (o.value as { unit?: number })?.unit === ally);
  h.do({ type: 'decide', seat: me, choice: pickAlly });

  const enemy = optFor(h.state.decision!.options, foe);
  assert.ok(enemy, 'fixture: the attacker is a legal target for slot 1');
  assert.equal(enemy.confirm, undefined,
    'the normal, intended play raised a question. This is the case the card is FOR');
});

/* ══ §3 …AND NOTHING ELSE IN THE POOL ASKS ════════════════════════════ */

test('R288 §3 no single-allegiance spell in the pool can reach the question', () => {
  // Derived, not driven: `mixedAllegiance` is the only gate on the engine
  // side, so proving no other printed spec passes it proves no other card can
  // ever raise the confirm — for every board, not just the ones a test builds.
  const asking = specs().filter(s => mixedAllegiance(s.spec, s.max));
  for (const { name, spec, max } of asking) {
    const kinds = Array.from({ length: max }, (_, i) => slotWhat(spec, i));
    assert.ok(kinds.includes('allyUnit'),
      `${name} can ask, but prints no ally slot — the derivation has drifted from the owner's `
      + 'words ("target ally AND target unit on the same card")');
    assert.ok(kinds.some(k => k === 'unit' || k === 'any'),
      `${name} can ask, but every slot is fixed to one side — there is nothing to misclick`);
  }
});

/* ══ §4 NOTHING IS NARROWED ═══════════════════════════════════════════ */

test('R288 §4 the question changes no legality: same candidates, same outcome', () => {
  const { h, me, ally, idx } = fightBoard(27803);
  h.do({ type: 'playCard', seat: me, handIndex: idx });
  const pickAlly = h.state.decision!.options.findIndex(o => (o.value as { unit?: number })?.unit === ally);
  h.do({ type: 'decide', seat: me, choice: pickAlly });

  const opts = h.state.decision!.options;
  const asked = opts.filter(o => o.confirm).length;
  assert.ok(asked > 0, 'fixture: something really is being asked about here');
  // R157's steer: printed text wins, take the permissive reading. The option
  // is OFFERED — the confirm is a question, never a filter.
  const mineIdx = opts.findIndex(o => o.confirm);
  h.do({ type: 'decide', seat: me, choice: mineIdx });
  assert.equal(h.state.decision, null,
    'answering it was refused — BL-30 says twice that these are legal targets and that we '
    + 'must not stop it');
  assert.ok(h.state.stack.length >= 1 || h.log.some(l => /Fight/.test(l)),
    'and the spell went ahead exactly as it would have without the field');
});

/* ══ §5 THE CLIENT ════════════════════════════════════════════════════ */

test('R288 §5 the client asks before sending, and "yes" sends the very pick it interrupted', () => {
  const { h, me, ally, idx } = fightBoard(27804);
  h.do({ type: 'playCard', seat: me, handIndex: idx });
  const pickAlly = h.state.decision!.options.findIndex(o => (o.value as { unit?: number })?.unit === ally);
  h.do({ type: 'decide', seat: me, choice: pickAlly });
  const opts = h.state.decision!.options;
  const mineIdx = opts.findIndex(o => o.confirm);
  assert.ok(mineIdx >= 0, 'fixture: the engine is offering the question');

  ui.join(viewFor(h.state, me), me, legalActions(h.state, me));
  ui.sent();
  ui.click({ btn: 'decide', i: mineIdx });
  assert.deepEqual(ui.actions(), [],
    'the client sent the pick straight through — the player never got asked, and BL-30 is a '
    + 'question or it is nothing');
  assert.ok(ui.has({ btn: 'allyconfirm' }) && ui.has({ btn: 'allycancel' }),
    'and there is no bar on screen to answer it with');

  ui.click({ btn: 'allyconfirm' });
  assert.deepEqual(ui.actions(), [{ type: 'decide', seat: me, choice: mineIdx }],
    '"yes" must send the SAME index that was interrupted — re-deriving it is how a confirm '
    + 'dialogue ends up committing a different click');
});

test('R288 §5 "no" sends nothing and leaves the same pick open', () => {
  const { h, me, ally, idx } = fightBoard(27805);
  h.do({ type: 'playCard', seat: me, handIndex: idx });
  const pickAlly = h.state.decision!.options.findIndex(o => (o.value as { unit?: number })?.unit === ally);
  h.do({ type: 'decide', seat: me, choice: pickAlly });
  const mineIdx = h.state.decision!.options.findIndex(o => o.confirm);

  ui.join(viewFor(h.state, me), me, legalActions(h.state, me));
  ui.sent();
  ui.click({ btn: 'decide', i: mineIdx });
  ui.click({ btn: 'allycancel' });
  assert.deepEqual(ui.actions(), [],
    '"no" put something on the wire. Nothing had been sent yet, so there is nothing to undo — '
    + 'and BL-30 is explicit that this must not become a cancelled cast');
  assert.ok(ui.has({ btn: 'decide' }),
    'and the target pick is not on screen any more — "rechoose targets" means the same '
    + 'question is still there to answer');
});
