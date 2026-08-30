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
// R214: the PUBLIC entry point, not `cards/registry.ts`. registry.ts registers
// only 494 of the 495 cards — the third synthetic (`Alluring Attribute`) is
// registered by `src/apply.ts`, which index.ts pulls. See the pool-sight floor
// at the foot of this file and test/180-pool-sight.test.ts.
import '../src/index.ts';
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
  'Envoy of Lightning': "'your spell effects with a single TARGET are Electric' — an effectAttrs "
    + 'mod (R94), targets nothing. It reads how many targets somebody ELSE declared.',
  'Earnest Defender': "'whenever an ally becomes the TARGET of an enemy spell' — a trigger condition",
  'Hexbane Shiitake': "'you may choose new TARGETS for that spell' — the exchanged spell's, not mine",
  'Earthbound Replicator': "'a nonunit spell TARGETING me … new targets for the copy' — the copy's",
  'Maelstrom Charger': "'copy that spell and you may choose new TARGETS for the copy' — the copy's",
  'Gatekeeper of Souls': "'when a player selects TARGETS for an effect … I must be targeted' — a rule about others",

  // ── 2. two SEPARATE effects, one target each. The count is per card only
  // because printed text is per card; each effect asks for its own.
  'Stellarspore Harvester': 'the after-combat trigger targets a unit; the [Augment] death trigger targets an opponent',

  // ── 3. (empty) — Apex Prime lived here until round 17. Its exemption said the
  // card "targets nothing at all" because the copy layer did not exist; R92
  // found that three of the four layers already did (base stats via E.setBase,
  // attributes via E.addTempAttr, triggered/[Augment] text via E.grantText),
  // so the card now declares a real target and this test rightly threw the
  // exemption out. The remaining dead clauses (the copied NAME, statics and
  // ACTIVATED abilities) are a card-ledger matter, not a targeting one.
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
    // R184: "Create a 1/1 unit for each unit in target formation." The owner
    // ruled on 2026-08-25 that a formation is THE WHOLE SIDE, and `TargetRef`
    // has an arm for it now — so the printed noun finally names a real kind
    // and Galactic Germination's UNNAMED exemption is gone.
    [/^targets? formations?\b/, 'formation'],
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
  // (R184 retired the only entry: Galactic Germination's "target formation"
  // is a real kind now. The test below is what keeps this table honest.)
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

/* ── R256 · A RESTRICTIVE CLAUSE ON THE TARGET NOUN IS ASKED AT CAST ─────
 *
 * Report #134 (round 32): with one enemy Channeled Boon on the stack aimed at
 * ITS OWN controller's unit, Boon of Protection lit up as playable, that
 * illegal item was the only offered candidate, the mana was spent, the card
 * went to the bin, and the log said "does not target anything allied — no
 * effect". Its printed clause — "negate target effect THAT TARGETS an allied
 * effect, player or unit" — had only ever been checked at resolution.
 *
 * That is the third time the same shape has been reported: #35 (Squish),
 * #70 (Graxxlid), #134 (Boon of Protection). R64 and R88 settled the rule
 * both times — "the printed restriction is part of what makes a target LEGAL,
 * not a condition checked once the spell resolves" — and both times it was
 * applied to the one card in the report. Boon of Protection's comment even
 * cited the fix ("Graxxlid/Minor Kraken precedent") while doing the opposite
 * of it, and survived four rounds that way. The pool is 495 cards and the eye
 * is not a search. So this is the search.
 *
 * THE RULE. Take every printed occurrence of "target" that DECLARES one — the
 * determiner-like "target <noun>" — and read the clause that follows the head
 * noun. A RESTRICTIVE RELATIVE CLAUSE there ("with 5 or less defense", "that
 * player controls", "targeting me", "in your bin", "in my formation",
 * "controlled by an opponent") narrows which targets are LEGAL, so the card
 * must declare a cast-time predicate (`restrict` / `slotRestricts`) or a
 * target KIND that already carries the clause. An `if` clause modifies the
 * VERB, not the noun, and is a conditional effect rather than a restriction —
 * those are listed below with their reason, and the list is asserted to be
 * exactly right.
 *
 * The pool splits on that grammar with no residue: 33 cards print a
 * post-nominal clause and 2 print an `if` clause. Boon of Protection was the
 * single card on the wrong side of the line.
 *
 * WHAT THIS DOES NOT COVER, and why not:
 *   • PRE-nominal modifiers — "target ALLY", "target OPPONENT", "target
 *     NONTOKEN ally", "target CACHED card", "target SPELL effect". Those are
 *     carried by the target kind, and "every target kind a card declares is
 *     named by its printed text" above is already their guard, from both ends.
 *   • "ANOTHER target unit" (Fight, Squish, Chombot, Flux Constructor, Scrap
 *     For Parts, Reconfigure, Aethercap Siphoner, Eminence of the Barrens).
 *     Distinctness is carried by the engine for every multi-slot spec, not by
 *     the card: `collectTargets` filters the candidate list by the targets
 *     already chosen for the part. There is nothing per-card to check.
 *   • WHICH SLOT the clause governs. This is a per-CARD check: a two-slot card
 *     with one qualified slot passes on any cast-time predicate. Tying a
 *     printed occurrence to a slot index is beyond what a phrase matcher can
 *     honestly claim, and the R64 kind test above makes the same trade.
 */

/** the head noun phrase of a printed "target …". Everything after it is the
 * clause that modifies it. The pre-nominal adjectives are consumed here rather
 * than read, because the kind test above is what answers for them. */
const TARGET_HEAD = new RegExp('^(?:nontoken |nonspell |enemy |allied |cached |spell )*'
  + '(?:units?|allies|ally|players?|opponents?|effects?|spells?|cards?|tokens?|formations?)\\b\\s*');

/** clauses a target KIND already carries, and the kinds that carry them. A
 * card declaring the kind has the clause enforced by `targetCandidates`'
 * family stage, so it is stripped and whatever follows is read on its own —
 * which is how Hooba-Mon's "target unit IN YOUR BIN with cost 3 or less" is
 * still made to answer for its "with" half. A card that does NOT declare the
 * carrying kind keeps the clause and must answer for it. */
const CARRIED_BY_KIND: [RegExp, Kind[]][] = [
  [/^(?:in|from) your bin\b\s*/, ['binCard']],
  [/^(?:in|from) (?:a|that player's|its controller's|their) bin\b\s*/, ['anyBinCard']],
  [/^controlled by an opponent\b\s*/, ['enemyUnit']],
];

/** what a restrictive relative clause on the target noun begins with. */
const QUALIFIERS: RegExp[] = [
  /^with\b/,            // "with 5 or less defense", "with cost 2 or less", "with no stat changes"
  /^that\b/,            // "that targets an allied …", "that player controls"
  /^targeting\b/,       // "targeting me"
  /^in\b/,              // "in your bin", "in play", "in my formation" — `\b` keeps "into" out
  /^from\b/,            // "from your bin"
  /^controlled by\b/,   // "controlled by an opponent"
];

/** an `if` clause modifies the VERB: "delete target unit IF it has a -1/-1
 * counter on it" is a conditional effect, not a narrower target. */
const VERB_CONDITION = /^if\b/;

/** the cards whose printed clause is an `if` on the verb, each with the reason
 * its resolution-time reading is deliberate. Asserted below to be EXACTLY the
 * set the text matcher finds, in both directions: a new card printing "target
 * X if …" cannot be added without recording why, and an entry whose card stops
 * printing the clause fails just as loudly. */
const RESOLUTION_CONDITION: Record<string, string> = {
  'Null Drone': 'R256: "negate target spell effect IF its cost is less than or equal to the greatest '
    + 'amount of life lost by a player this battle" — the gate is a whole-board quantity that both '
    + 'players go on changing while the Drone sits on the stack, so a cast-time reading would promise '
    + 'an answer the resolution cannot keep. The `if` is on the verb: it negates, or it does not.',
  'Stellarspore Harvester': 'R256: "delete target unit IF it has a -1/-1 counter on it" — the '
    + 'resolution-only reading is documented WITH ITS REASON at batch-wood-c.ts, where the counter '
    + 'this trigger reads is one the same combat may still be putting on. The `if` is on the verb.',
};

/** every target KIND a card declares (the Ambush mode's synthesised slot is
 * not printed on the card, so it is not among them) */
function declaredKinds(name: string): Set<Kind> {
  const out = new Set<Kind>();
  for (const e of declaredEffects(name)) {
    if (!e.targets) continue;
    for (const k of [e.targets.what, ...(e.targets.slots ?? [])]) out.add(k);
  }
  return out;
}

/** does the card declare a cast-time targeting predicate anywhere? */
function hasCastPredicate(name: string): boolean {
  return declaredEffects(name).some(e => e.targets
    && (e.targets.restrict !== undefined || (e.targets.slotRestricts ?? []).some(r => r)));
}

/** one printed occurrence of "target", classified.
 *  - 'declares'  — "target <noun> …": `clause` is what modifies the noun
 *  - 'any'       — "ANY target", the damage kind (its own test above)
 *  - 'noun'      — "the TARGETS of …", "new TARGETS for …", "…TARGETS are …":
 *                  the word is a noun about somebody else's targeting
 *  - 'verb'      — "target effect that TARGETS an allied …" */
type Occurrence = { how: 'declares'; clause: string } | { how: 'any' | 'noun' | 'verb' };

function occurrences(text: string): Occurrence[] {
  const t = forPhrases(text);
  const out: Occurrence[] = [];
  for (const m of t.matchAll(/\btargets?\b/g)) {
    const before = t.slice(0, m.index);
    // the window runs to the next printed "target" or the end of the clause,
    // so one occurrence can never be answered for by the next one's words
    const after = t.slice(m.index).replace(/^\S+\s*/, '').split(/(?=\btargets?\b)|[.;]/)[0] ?? '';
    const head = after.match(TARGET_HEAD);
    if (head) { out.push({ how: 'declares', clause: after.slice(head[0].length) }); continue; }
    if (/\bany\s$/.test(before)) { out.push({ how: 'any' }); continue; }
    if (/^(?:of|for|are)\b/.test(after)) { out.push({ how: 'noun' }); continue; }
    if (/\bthat\s$/.test(before)) { out.push({ how: 'verb' }); continue; }
    out.push({ how: 'noun' });   // unclassifiable; the closure test below fails on it
  }
  return out;
}

test('R256: every printed occurrence of target is read, not skipped', () => {
  // A scrape that quietly reads less than it should is this repo's recurring
  // blindness — eight sweeps saw 494 of 495 cards and none of them said so
  // (R214, below). So before the sweep asserts anything about the clauses it
  // found, it asserts it found ALL of them: every printed "target" is one of
  // the four readings, and the residue is named.
  const unread: string[] = [];
  for (const name of allCardNames()) {
    const t = forPhrases(getCard(name).text ?? '');
    for (const m of t.matchAll(/\btargets?\b/g)) {
      const before = t.slice(0, m.index);
      const after = t.slice(m.index).replace(/^\S+\s*/, '').split(/(?=\btargets?\b)|[.;]/)[0] ?? '';
      if (TARGET_HEAD.test(after)) continue;
      if (/\bany\s$/.test(before)) continue;
      if (/^(?:of|for|are)\b/.test(after)) continue;
      if (/\bthat\s$/.test(before)) continue;
      unread.push(`${name}: …${before.slice(-30)}[target] ${after.slice(0, 40)}…`);
    }
  }
  assert.deepEqual(unread, [], 'printed "target"s the clause reader cannot classify — it is '
    + `reading less of the pool than the sweep below claims:\n  ${unread.join('\n  ')}`);
});

test('R256: a restrictive clause on a target noun is enforced at CAST', () => {
  const late: string[] = [];
  for (const name of allCardNames()) {
    if (name in RESOLUTION_CONDITION) continue;
    const kinds = declaredKinds(name);
    for (const o of occurrences(getCard(name).text ?? '')) {
      if (o.how !== 'declares') continue;
      // strip the clauses this card's declared KIND already enforces, then
      // read what is left of the modifier
      let clause = o.clause;
      for (;;) {
        const carried = CARRIED_BY_KIND.find(([re, ks]) => re.test(clause) && ks.some(k => kinds.has(k)));
        if (!carried) break;
        clause = clause.replace(carried[0], '');
      }
      if (!QUALIFIERS.some(re => re.test(clause))) continue;
      if (hasCastPredicate(name)) continue;
      late.push(`${name}: "target … ${clause.slice(0, 60)}" is a restriction on WHICH targets are `
        + `legal, but the card declares no restrict/slotRestricts and no kind that carries it`);
    }
  }
  assert.deepEqual(late, [], 'cards whose printed targeting restriction is not asked at cast — each '
    + 'one offers the whole board, takes the mana and then says it did nothing (R64/R88/R256):\n  '
    + late.join('\n  '));
});

test('R256: the if-clause exemptions are exactly the cards that print one', () => {
  const found = new Set<string>();
  for (const name of allCardNames()) {
    for (const o of occurrences(getCard(name).text ?? '')) {
      if (o.how === 'declares' && VERB_CONDITION.test(o.clause)) found.add(name);
    }
  }
  for (const why of Object.values(RESOLUTION_CONDITION)) {
    assert.ok(why.length > 40, 'an if-clause exemption needs a reason, not a shrug');
  }
  assert.deepEqual([...found].sort(), Object.keys(RESOLUTION_CONDITION).sort(),
    'the reasoned if-clause exemptions no longer match the cards that print an if-clause on a '
    + 'target. A NEW card here is the R256 question being asked again — decide whether the clause '
    + 'narrows the TARGET (a restrict) or gates the VERB (an entry here, with the reason).');
});

// ── R214 · POOL SIGHT ───────────────────────────────────────────────────
//
// This file sweeps the WHOLE card pool. `src/cards/registry.ts` is the natural
// card entry point and it registers 494 of the 495 cards: two of the three
// `registerSynthetic` calls are its own, and the third — `Alluring Attribute`
// — is in `src/apply.ts`. Eight sweeps imported registry.ts alone, saw 494,
// and NOT ONE OF THEM ASSERTED A POOL SIZE, so every clean sheet they produced
// silently covered one card fewer than it claimed.
//
// The floor is what stops that being reintroduced by an import change nobody
// reads as a behaviour change. `test/180-pool-sight.test.ts` holds the same
// floor for the whole suite and the guard that catches a ninth sweep.
test('R214: this sweep sees the whole card pool', () => {
  const n = allCardNames().length;
  assert.ok(n >= 495,
    `this sweep sees ${n} cards, not the full 495 — its imports reach src/cards/registry.ts `
    + 'but not src/apply.ts, so the synthetic Alluring Attribute is invisible to it and every '
    + 'verdict above covers one card fewer than it says. Import ../src/index.ts.');
  assert.ok(allCardNames().includes('Alluring Attribute'),
    'the pool is big enough but Alluring Attribute is not in it — the count floor above has '
    + 'been satisfied by some other card, which is not the thing being guarded');
});
