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

/** the effects a card DECLARES ITSELF: the spell, its graft rider, its
 * abilities and its [Augment] text. The Ambush mode's effect is not among
 * them — `ambushEffect()` synthesises it in dsl.ts with its `allyUnit` slot
 * already filled in, and no part of it is printed on the card, so anything
 * that reads a declaration against printed text must not see it. */
function declaredEffects(name: string): EffectDef[] {
  const c = getCard(name);
  const out: EffectDef[] = [];
  if (c.spellEffect) out.push(c.spellEffect);
  if (c.graftEffect) out.push(c.graftEffect.effect);
  for (const a of c.abilities ?? []) out.push(a.effect);
  for (const a of c.augmentText ?? []) out.push(a.effect);
  return out;
}

/** every effect a card owns, including the Ambush mode's generated one —
 * the COUNTING tests want it, because an Ambush's printed reminder text does
 * name a target and the generated effect is what answers for it */
function effectsWithAmbush(name: string): EffectDef[] {
  const c = getCard(name);
  const out = declaredEffects(name);
  if (c.ambush) out.push(ambushEffect(name));
  return out;
}

/** printed text with REMINDER TEXT REMOVED. Italic parentheticals restate
 * rules, they do not add them — Reconfigure's "(the FIRST TARGET must have
 * [Augment] …)" is the same target the sentence already named, and counting it
 * would demand a third slot that does not exist. The one place reminder text
 * carries a real target is an Ambush mode's "(Play me with the effect 'Recall
 * target ally …')", and that mode's effect is generated with its target
 * already declared — which the declares-a-target-somewhere test below still
 * checks against the FULL text. */
function withoutReminders(text: string): string {
  return text.replace(/\{i\}[\s\S]*?\{\/i\}/g, ' ');
}

/** printed occurrences of the word "target"/"targets" */
function printedTargetWords(text: string): number {
  return (withoutReminders(text).match(/\btargets?\b/gi) ?? []).length;
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

/* ── the 'any' kind belongs to the cards that print "any target".
 *
 * Playtest UFAB, 2026-08-22: "Bripp can target units for some reason. All
 * cards that say 'target player' or 'target opponent' should only be able to
 * have PLAYERS selected as legal targets." Bripp's spec said `what: 'any'`,
 * which offers every unit in the region AND both seats — so the cast was
 * legal, the unit was aimed at, and the resolution printed "the target is not
 * a player" and did nothing. The card was silently spent.
 *
 * 'any' is the DAMAGE kind. It is what "deal 3 damage to any target" means,
 * and dsl.ts says so at the declaration; it is not a way to reach a player.
 * `'player'` (plain "target player", yourself included) and `'opponent'`
 * ("target opponent") are the player-only kinds, and both have existed since
 * R64/R67. Nine cards had 'any' anyway, each with a comment claiming the
 * engine had no player-only scope — one false belief, copied forward, which
 * is why this is a test and not nine fixes.
 *
 * The Ambush mode is filtered out rather than exempted: its slot is
 * synthesised by `ambushEffect()`, not printed. */
test('R64: only a card printing "any target" declares the \'any\' target kind', () => {
  const wrong: string[] = [];
  for (const name of allCardNames()) {
    const c = getCard(name);
    const claims = declaredEffects(name).some(e =>
      e.targets && [e.targets.what, ...(e.targets.slots ?? [])].includes('any'));
    if (!claims) continue;
    if (/\bany target\b/i.test(withoutReminders(c.text ?? ''))) continue;
    wrong.push(`${name}: declares 'any' — the damage kind — but prints no "any target"\n      ${c.text}`);
  }
  assert.deepEqual(wrong, [],
    `cards offering units where the text names a player:\n  ${wrong.join('\n  ')}`);
});

/* ── and the converse, kind by kind: every declared kind is NAMED in the text.
 *
 * The 'any' test above catches the one kind that was actually abused, but the
 * abuse was possible because nothing tied a declaration to the words on the
 * card at all. This does, for all of them: walk each printed "target", work
 * out which kind that phrase names, and require every kind a card declares to
 * appear in that set. A card that says "target ally" and declares 'unit', or
 * says "target opponent" and declares 'player', fails here.
 *
 * Two things make it read the phrase the way a player does:
 *   • LONGEST MATCH FIRST. "target spell effect" is 'stackSpell' and must be
 *     tried before "target effect" ('stackEffect'), and the BIN clause beats
 *     the head noun — "recall target unit … from your bin" names a card in a
 *     bin, not a unit in play. Whose bin decides between 'binCard' and
 *     'anyBinCard', which is the whole difference between the two kinds.
 *   • EACH OCCURRENCE ON ITS OWN, and no window may run past the next
 *     "target". A two-slot card (Fight, Squish, Channel Through, Necromorph)
 *     prints two phrases naming two kinds, and a window that ran to the full
 *     stop would let the second phrase answer for the first.
 *
 * Containment, not equality: a card may print a "target" that names nobody's
 * kind (Gravitational Correction's "the TARGETS of target effect") without
 * that being a fault. The fault is a kind with nothing on the card behind it.
 */
type Kind = TargetSpec['what'];

/** the phrase each kind is printed as, longest/most specific first. Each is
 * anchored at a "target" occurrence; `[^target]{0,70}` is spelled the long way
 * so a window can never swallow the NEXT printed target. */
const KIND_PHRASES: [RegExp, Kind][] = (() => {
  const upTo = String.raw`(?:(?!\btargets?\b)[^.;]){0,70}?`;
  return [
    // only a CARD can be a card in a bin, so the bin clause is read off those
    // head nouns alone — Necromantic Rebuke's "negate target effect unless its
    // controller erases X cards from their bin" is a cost, not a target.
    [new RegExp(String.raw`^targets? (?:cards?|units?|spells?)\b${upTo}\bin a bin\b`), 'anyBinCard'],
    [new RegExp(String.raw`^targets? (?:cards?|units?|spells?)\b${upTo}\b(?:that player's|its controller's|their) bin\b`), 'anyBinCard'],
    [new RegExp(String.raw`^targets? (?:cards?|units?|spells?)\b${upTo}\b(?:from|in) your bin\b`), 'binCard'],
    [/^targets? cached card\b/, 'cachedCard'],
    [/^targets? spell effects?\b/, 'stackSpell'],
    [/^targets? (?:nonspell |enemy )?effects?\b/, 'stackEffect'],
    [/^targets? opponents?\b/, 'opponent'],
    [/^targets? players?\b/, 'player'],
    [/^targets? tokens?\b/, 'token'],
    [/^targets? (?:nontoken )?(?:ally|allies)\b/, 'allyUnit'],
    // R84 {Alluring} is the only thing in the pool that prints this, and it is
    // rules text rather than a card — but 'enemyUnit' is a kind in the union
    // and had no phrase, so a card printing it would have gone unread too.
    [new RegExp(String.raw`^targets? units?\b${upTo}\bcontrolled by an opponent\b`), 'enemyUnit'],
    [/^targets? units?\b/, 'unit'],
  ];
})();

/** printed text as a phrase-matcher sees it: reminders gone (they restate,
 * they do not name), the layout's `{/n}` line breaks closed up — including the
 * hyphenated ones, so Formless's "be- {/n}comes" is one word again — and
 * lowercased. */
function forPhrases(text: string): string {
  return withoutReminders(text)
    .replace(/-\s*\{\/n\}\s*/g, '')
    .replace(/\{\/n\}/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** every target kind the printed text NAMES, one printed "target" at a time */
function kindsNamedBy(text: string): Set<Kind> {
  const t = forPhrases(text);
  const named = new Set<Kind>();
  for (const m of t.matchAll(/\btargets?\b/g)) {
    const at = t.slice(m.index);
    const hit = KIND_PHRASES.find(([re]) => re.test(at));
    if (hit) { named.add(hit[1]); continue; }
    // "deal 3 damage to ANY target" — the only kind whose adjective comes first
    if (/\bany\s$/.test(t.slice(0, m.index))) named.add('any');
  }
  return named;
}

/** kinds whose printed phrase the matcher cannot read, and why. */
const UNNAMED: Record<string, string> = {
  'Galactic Germination': "'each unit in target formation' — there is no 'formation' kind, so the "
    + "spell targets a unit in it and the printed noun names nothing the engine has",
};

test('R64: every target kind a card declares is named by its printed text', () => {
  const wrong: string[] = [];
  for (const name of allCardNames()) {
    const c = getCard(name);
    if (name in UNNAMED) continue;
    const declared = new Set<Kind>();
    for (const e of declaredEffects(name)) {
      if (!e.targets) continue;
      for (const k of [e.targets.what, ...(e.targets.slots ?? [])]) declared.add(k);
    }
    if (!declared.size) continue;
    const named = kindsNamedBy(c.text ?? '');
    const orphan = [...declared].filter(k => !named.has(k));
    if (orphan.length) {
      wrong.push(`${name}: declares ${orphan.map(k => `'${k}'`).join(', ')}; the text names `
        + `${[...named].map(k => `'${k}'`).join(', ') || 'no kind at all'}\n      ${c.text}`);
    }
  }
  assert.deepEqual(wrong, [], `declared kinds with nothing on the card behind them:\n  ${wrong.join('\n  ')}`);
});

test('every unnamed-kind exemption is still needed, and still names a real card', () => {
  const stale: string[] = [];
  for (const [name, why] of Object.entries(UNNAMED)) {
    assert.ok(why.length > 20, `${name}'s exemption needs a reason, not a shrug`);
    let c;
    try { c = getCard(name); } catch { stale.push(`${name}: no such card any more`); continue; }
    const declared = new Set<Kind>();
    for (const e of declaredEffects(name)) {
      if (!e.targets) continue;
      for (const k of [e.targets.what, ...(e.targets.slots ?? [])]) declared.add(k);
    }
    const named = kindsNamedBy(c.text ?? '');
    if ([...declared].every(k => named.has(k))) stale.push(`${name}: every kind is named now — drop the exemption`);
  }
  assert.deepEqual(stale, [], `exemptions that have outlived their reason:\n  ${stale.join('\n  ')}`);
});
