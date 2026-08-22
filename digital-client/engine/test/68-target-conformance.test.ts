/* TARGET CONFORMANCE — a card that prints "target" twice must ASK twice, at
 * cast.
 *
 * The playtest report this exists for (VEAV, 2026-08-22) is not really about
 * one card:
 *
 *   "Squish, on cast, only has you select 1 target unit, but it needs 2
 *    targets (a target ally and any target). This is a RECURRING ISSUE, do a
 *    full text search for anything that has 2 targets (either says the word
 *    target more than once or says 'two targets') and ensure all cards and
 *    effects that need to choose targets happen ON CAST."
 *
 * It is the fourth time in five games (Flight in MNWK, Necromorph in BRDM,
 * Download in PEMC, Squish here), and each time it was fixed one card at a
 * time by reading the card that just misbehaved. That is the thing that
 * recurs: the pool is 492 cards and the eye is not a search. So this is the
 * search, run on every `npm test`.
 *
 * THE RULE (R67): if a card's printed text says "target" N times, the card
 * declares at least N cast-time target slots across its effects. R58's
 * per-slot `slots`/`slotPrompts`/`slotRestricts` is what carries a spec whose
 * two slots differ in legality (Fight, Squish, Necromorph); `count: 'X'`
 * carries "X target …" and counts as many.
 *
 * Every exemption is listed below WITH ITS REASON, and the list is asserted
 * to be exactly right: an entry that stops being needed fails just as loudly
 * as a card that stops declaring its targets. A new card with two printed
 * targets and one declared slot cannot be added without this failing, which
 * is the whole point — nobody has to remember the rule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { allCardNames, ambushEffect, getCard } from '../src/cards/dsl.ts';
import type { EffectDef, TargetSpec } from '../src/cards/dsl.ts';

/** how many cast-time targets a spec asks for; 'X' is "as many as X", which
 * is never fewer than the one printed "X target …" it stands for */
function slotsOf(spec: TargetSpec | undefined): number {
  if (!spec) return 0;
  const c = spec.count ?? 1;
  // "X target allies" is ONE printed occurrence of the word, however many
  // units it ends up aiming at — and X may legitimately be 1. R83's
  // `extraSlots` are separate printed targets and each counts.
  return (c === 'X' ? 1 : c) + (spec.extraSlots ?? 0);
}

/** every effect a card owns, including the Ambush mode's generated one */
function effectsWithAmbush(name: string): EffectDef[] {
  const c = getCard(name);
  const out: EffectDef[] = [];
  if (c.spellEffect) out.push(c.spellEffect);
  if (c.graftEffect) out.push(c.graftEffect.effect);
  for (const a of c.abilities ?? []) out.push(a.effect);
  for (const a of c.augmentText ?? []) out.push(a.effect);
  if (c.ambush) out.push(ambushEffect(name));
  return out;
}

/** printed occurrences of the word "target"/"targets", REMINDER TEXT REMOVED.
 * Italic parentheticals restate rules, they do not add them — Reconfigure's
 * "(the FIRST TARGET must have [Augment] …)" is the same target the sentence
 * already named, and counting it would demand a third slot that does not
 * exist. The one place reminder text carries a real target is an Ambush
 * mode's "(Play me with the effect 'Recall target ally …')", and that mode's
 * effect is generated with its target already declared — which the
 * declares-a-target-somewhere test below still checks against the FULL text. */
function printedTargetWords(text: string): number {
  return ((text.replace(/\{i\}[\s\S]*?\{\/i\}/g, ' ')).match(/\btargets?\b/gi) ?? []).length;
}

/**
 * Cards whose printed "target" count is NOT their cast-time slot count, each
 * with the reason. Grouped by why, because the reasons are only four.
 */
const EXEMPT: Record<string, string> = {
  // ── 1. the word is about ANOTHER effect's targeting, not this card's.
  // These say "target" twice because one of them is a noun about someone
  // else's spell ("change the targets of target effect").
  'Gravitational Correction': "'change the TARGETS of target effect' — one own target",
  'Enigmatic Warder': "'change a TARGET of target effect to me' — one own target",
  'Divine Intervention': "'you may change the TARGETS of target effect' — one own target",
  'Boon of Protection': "'negate target effect that TARGETS an allied …' — one own target",
  'Download': "'gain control of target token. You may choose new TARGETS for spells controlled this way'",
  'Envoy of Lightning': "'your spell effects with a single TARGET are Electric' — a static, targets nothing",
  'Earnest Defender': "'whenever an ally becomes the TARGET of an enemy spell' — a trigger condition",
  'Hexbane Shiitake': "'you may choose new TARGETS for that spell' — the exchanged spell's, not mine",
  'Earthbound Replicator': "'a nonunit spell TARGETING me … new targets for the copy' — the copy's",
  'Maelstrom Charger': "'copy that spell and you may choose new TARGETS for the copy' — the copy's",
  'Gatekeeper of Souls': "'when a player selects TARGETS for an effect … I must be targeted' — a rule about others",

  // ── 2. two SEPARATE effects, one target each. The count is per card only
  // because printed text is per card; each effect asks for its own.
  'Stellarspore Harvester': 'the after-combat trigger targets a unit; the [Augment] death trigger targets an opponent',

  // ── 3. genuinely unimplemented, and parked as such rather than faked.
  'Apex Prime':
    "'all of your units become a copy of target unit until regroup' needs a COPY layer that does "
    + 'not exist (R67); the card targets nothing at all until it does.',
};

test('R67: a card printing N targets declares N cast-time target slots', () => {
  const wrong: string[] = [];
  for (const name of allCardNames()) {
    const c = getCard(name);
    const printed = printedTargetWords(c.text ?? '');
    if (printed < 2) continue;
    if (name in EXEMPT) continue;
    const declared = Math.max(0, ...effectsWithAmbush(name).map(e => slotsOf(e.targets)));
    if (declared < printed) {
      wrong.push(`${name}: prints "target" ${printed}×, declares ${declared} slot(s)\n      ${c.text}`);
    }
  }
  assert.deepEqual(wrong, [], `cards that choose a printed target late (or not at all):\n  ${wrong.join('\n  ')}`);
});

test('R67: a card printing "target" at all declares a target somewhere', () => {
  const silent: string[] = [];
  for (const name of allCardNames()) {
    const c = getCard(name);
    if (!/\btargets?\b/i.test(c.text ?? '')) continue;
    if (name in EXEMPT) continue;
    if (effectsWithAmbush(name).some(e => e.targets)) continue;
    silent.push(`${name}: ${c.text}`);
  }
  assert.deepEqual(silent, [], `cards printing "target" with no TargetSpec anywhere:\n  ${silent.join('\n  ')}`);
});

test('every exemption is still needed, and still names a real card', () => {
  const stale: string[] = [];
  for (const [name, why] of Object.entries(EXEMPT)) {
    assert.ok(why.length > 20, `${name}'s exemption needs a reason, not a shrug`);
    let c;
    try { c = getCard(name); } catch { stale.push(`${name}: no such card any more`); continue; }
    const printed = printedTargetWords(c.text ?? '');
    if (printed === 0) { stale.push(`${name}: prints no "target" at all now`); continue; }
    const declared = Math.max(0, ...effectsWithAmbush(name).map(e => slotsOf(e.targets)));
    // it earns its place only while it would actually fail one of the two
    // tests above — a card that has since grown its slots must come off
    if (printed >= 2 && declared >= printed) {
      stale.push(`${name}: declares ${declared} of ${printed} now — drop the exemption`);
    }
    if (printed === 1 && declared >= 1) {
      stale.push(`${name}: declares a target now — drop the exemption`);
    }
  }
  assert.deepEqual(stale, [], `exemptions that have outlived their reason:\n  ${stale.join('\n  ')}`);
});
