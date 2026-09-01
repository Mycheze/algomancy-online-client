/* R190 — THE ONE DECLARED LIST OF KNOWN-WRONG UPSTREAM PRINTED DATA.
 *
 * `AlgomancyCards-OracleText.json` is Caleb's transcription of the physical
 * cards. It is shared with the rules bot, the RAG corpus and the Discord
 * pipeline, and it is NOT this client's to rewrite. When a field in it is
 * demonstrably wrong AND the owner has ruled on the correction, the correction
 * lives here: the extractor applies it on the way into `printed.json`, so it
 * survives `npm run extract`, and the list of things we know are wrong upstream
 * is a file you can read instead of folklore spread across four comments.
 *
 * WHY NOT IN printed.json: that file is generated; a hand-edit there is
 * destroyed by the next extract. WHY NOT IN THE ORACLE FILE: see above.
 *
 * ── THE THREE CONSUMERS, AND HOW THEY ALL GET THE FIX NOW ────────────
 *
 * This header used to end: "an override here fixes exactly ONE of the three
 * consumers. The bot and the corpus read the oracle file directly and stay
 * wrong until Caleb corrects it at source." That was true and it was a live,
 * player-facing defect in OUR software: measured 2026-09-01, the Discord bot
 * answered a question about Might of the Grove with the type line
 * `{Battle}Tree Tree Druid Spell` — a duplicated word and a missing space the
 * owner had ruled on five days earlier — and about Arbiter of Armistice with a
 * `{Switch}` the card does not have. The client had been right since
 * 2026-08-25; the bot never saw the fix.
 *
 * So `npm run extract` now ALSO emits `data/cards/oracle-corrections.json`
 * from this table, and `bot/oracle.py` applies it on load for all three Python
 * readers (cards.py's CardIndex, build_corpus.py, build_anchors.py). THE TABLE
 * BELOW IS STILL THE ONLY SOURCE OF TRUTH: nothing is hand-ported into Python,
 * and the generated file carries each entry's `from` so the Python side can
 * refuse a stale correction exactly as `applyOverride` does here.
 *
 * The canonical oracle file is still never rewritten, and these are still
 * corrections we carry rather than facts about the game.
 *
 * ── the shape ────────────────────────────────────────────────────────
 *   card   the card name, as the oracle file keys it
 *   field  'type' | 'text' — which printed field is corrected
 *   from   what the oracle file says TODAY, verbatim, after normalisePrinted
 *   to     what it should say
 *   since  the date the correction was made
 *   by     who ruled it — 'Bena' / 'Caleb' for an owner ruling, otherwise the
 *          agent that proposed it, so an unruled entry is visible as unruled
 *   why    the argument, in one place
 *
 * EVERY ENTRY GOES TO EVERY CONSUMER. There was briefly a `scope` field here,
 * to hold back the {g} markers on the theory that they were a client rendering
 * concern; the owner ruled otherwise on 2026-09-01 (see the {g} entries) and
 * the field is deleted rather than left defaulting, because a mechanism with no
 * live case is exactly the dead code a red-check cannot see through.
 *
 * ── the property that matters most ───────────────────────────────────
 * `applyOverride` FAILS LOUDLY when `from` no longer matches the upstream
 * value. This repo has repeatedly been bitten by exemption lists that outlived
 * their cause: the day Caleb fixes his file, a silent no-op would leave a stale
 * entry here forever and nobody would notice. Instead the build breaks and
 * names the card. `test/161-printed-text-overrides.test.ts` asserts the same
 * thing without running the extractor, and `test/122-cardtext-markup.test.ts`
 * independently asserts that printed.json differs from the oracle file in
 * EXACTLY these places and nowhere else.
 *
 * ⚠ NOT A SPELLFIX. `normalisePrinted`'s own comment in the extractor sets the
 * rule this table exists to satisfy: *"a named one-entry override, never a
 * fuzzy spellfix"*. Nothing here may be generalised into a pattern.
 */

/** @typedef {{ card: string, field: 'type'|'text', from: string, to: string,
 *              since: string, by: string, why: string }} PrintedOverride */

/** @type {PrintedOverride[]} */
export const PRINTED_OVERRIDES = [
  {
    card: 'Arbiter of Armistice',
    field: 'type',
    from: '{Haste} {Switch} Holy Unit',
    to: '{Haste} Holy Unit',
    since: '2026-08-25',
    by: 'Bena (owner ruling, R157 §25)',
    why: 'Verbatim: "That\'s an error on your part. The card does not have a [Switch] '
      + 'thing. It just adds an additional cost to all spells cast in battle to pay 2 '
      + 'life." The transcription\'s bare {Switch} is the only one of its kind in the pool '
      + '(every other [Switch] is a rules-text marker on a graftable effect), and nothing '
      + 'reads a type-line {Switch} — graftability is CardDef.graftEffect — so this is a '
      + 'display correction with no behaviour attached.',
  },
  {
    card: 'Might of the Grove',
    field: 'type',
    from: '{Battle}Tree Tree Druid Spell',
    to: '{Battle} Tree Druid Spell',
    since: '2026-08-25',
    by: 'Bena (owner ruling, R162)',
    why: 'Verbatim, on being shown the line: "Might of the Grove should read \'{Battle} '
      + 'Tree Druid Spell\'" — which confirms BOTH halves, the marker glued to the next '
      + 'word and the duplicated subtype. The reasoning that reached it independently is '
      + 'kept because it is what to reuse on the next one: every other Druid spell in the '
      + 'pool is "{Battle} <one subtype> Druid Spell" (Invigorate "Mystic", Wither and '
      + 'Bloom "Arcane", four with none), and no card in the pool repeats a subtype.',
  },
  /* ── CT-132: four attribute words that were not marked as keywords ────
   *
   * These four are `field: 'text'`, the first of their kind in this table, and
   * they are the ONLY entries here proposed by an agent rather than ruled by
   * the owner — because there is nothing to rule. Nobody disputes that
   * Brough's "balanced" is the attribute Brough grants; the transcription
   * simply did not mark it, on four cards out of twelve.
   *
   * ⚠ THE LIST IS DERIVED, NOT TYPED. `test/270-attribute-words-are-
   * keywords.test.ts` computes, from printed.json, every card whose rules text
   * names an `Attr` it does not carry on its type line, and asserts the marker
   * is on all of them. That is the guard — so the thirteenth card is covered
   * the day it is written, and these four entries are what makes it pass
   * today rather than what it checks.
   */
  {
    card: 'Brough',
    field: 'text',
    from: '[Augment] Everything is balanced. {i}(The power and defense of balanced units are equal to the greater of the two.)',
    to: '[Augment] Everything is {g}balanced. {i}(The power and defense of balanced units are equal to the greater of the two.)',
    since: '2026-09-01',
    by: 'CT-132 (agent; a consistency correction, not an owner ruling — see `why`)',
    // ⚠ RULED BY THE OWNER, 2026-09-01, verbatim: "`{g}` is in the text marker
    // and it makes the following word GOLD. It's used for giving units
    // attributes." So this is a TEXT-FORMATTING marker that belongs in the
    // corrected data for every reader, not a client-only rendering concern —
    // an earlier draft held these four back on that theory and was wrong.
    //
    // ⚠ AND `g` MEANS TWO DIFFERENT THINGS DEPENDING ON THE FIELD. In a `cost`
    // string it is the WOOD pip (dsl.ts ELEMENT_OF_PIP: r fire, b water,
    // e earth, g wood, m metal, l light, d dark). In `text`, `{g}` is the gold
    // keyword marker. These entries touch `text` and only `text`; no correction
    // in this table has ever touched a cost, and the four cards' affinity costs
    // were verified correct against the owner (Brough `le`, Blob of the Dark
    // Order `l`, Inexorable Miasma `gd`, Unrelenting Horror `d`). Say which
    // field you mean, every time — a summary that did not caused exactly this
    // confusion once.
    why: 'CT-132. `{g}` colours ONE word as a keyword, and the pool disagrees with itself '
      + 'about this one: twelve cards name an attribute they do not carry on their type line, '
      + 'eight tag it and four do not, so the same word reads as a keyword on one card and as '
      + 'grey prose on another — which reads as though it means something different. '
      + 'Rotspore Herald\'s "[Augment] Everything is {g}deadly." is the SAME SENTENCE with the marker present — the two sit side by side in the pool, one coloured, one not.'
      + ' The marker is COLOUR ONLY: it adds no glossary row and no behaviour (card text is '
      + 'display data — the rules live in src/cards/sets/), so this is presentation '
      + 'consistency and not the missing-rules-text bug report #118 was about. '
      + 'The bare occurrence inside the {i}(…) reminder is deliberately left alone: reminder '
      + 'text is prose ABOUT the keyword and is untagged on all eight cards that do tag it.',
  },
  {
    card: 'Blob of the Dark Order',
    field: 'text',
    from: '[Augment] Pay 1 life: I gain piercing until regroup.',
    to: '[Augment] Pay 1 life: I gain {g}piercing until regroup.',
    since: '2026-09-01',
    by: 'CT-132 (agent; a consistency correction, not an owner ruling — see `why`)',
    // ⚠ RULED BY THE OWNER, 2026-09-01, verbatim: "`{g}` is in the text marker
    // and it makes the following word GOLD. It's used for giving units
    // attributes." So this is a TEXT-FORMATTING marker that belongs in the
    // corrected data for every reader, not a client-only rendering concern —
    // an earlier draft held these four back on that theory and was wrong.
    //
    // ⚠ AND `g` MEANS TWO DIFFERENT THINGS DEPENDING ON THE FIELD. In a `cost`
    // string it is the WOOD pip (dsl.ts ELEMENT_OF_PIP: r fire, b water,
    // e earth, g wood, m metal, l light, d dark). In `text`, `{g}` is the gold
    // keyword marker. These entries touch `text` and only `text`; no correction
    // in this table has ever touched a cost, and the four cards' affinity costs
    // were verified correct against the owner (Brough `le`, Blob of the Dark
    // Order `l`, Inexorable Miasma `gd`, Unrelenting Horror `d`). Say which
    // field you mean, every time — a summary that did not caused exactly this
    // confusion once.
    why: 'CT-132. `{g}` colours ONE word as a keyword, and the pool disagrees with itself '
      + 'about this one: twelve cards name an attribute they do not carry on their type line, '
      + 'eight tag it and four do not, so the same word reads as a keyword on one card and as '
      + 'grey prose on another — which reads as though it means something different. '
      + 'Protective Adaptations ("gains +1/+1 and {g}piercing until regroup") and Pernicious Photosynthesis are the same clause with the marker present.'
      + ' The marker is COLOUR ONLY: it adds no glossary row and no behaviour (card text is '
      + 'display data — the rules live in src/cards/sets/), so this is presentation '
      + 'consistency and not the missing-rules-text bug report #118 was about. '
      + 'The bare occurrence inside the {i}(…) reminder is deliberately left alone: reminder '
      + 'text is prose ABOUT the keyword and is untagged on all eight cards that do tag it.',
  },
  {
    card: 'Inexorable Miasma',
    field: 'text',
    from: 'Target unit gains poisonous until regroup.{/n}After combat, if I am in your bin you may remove a -1/-1 counter from a unit to recall me.',
    to: 'Target unit gains {g}poisonous until regroup.{/n}After combat, if I am in your bin you may remove a -1/-1 counter from a unit to recall me.',
    since: '2026-09-01',
    by: 'CT-132 (agent; a consistency correction, not an owner ruling — see `why`)',
    // ⚠ RULED BY THE OWNER, 2026-09-01, verbatim: "`{g}` is in the text marker
    // and it makes the following word GOLD. It's used for giving units
    // attributes." So this is a TEXT-FORMATTING marker that belongs in the
    // corrected data for every reader, not a client-only rendering concern —
    // an earlier draft held these four back on that theory and was wrong.
    //
    // ⚠ AND `g` MEANS TWO DIFFERENT THINGS DEPENDING ON THE FIELD. In a `cost`
    // string it is the WOOD pip (dsl.ts ELEMENT_OF_PIP: r fire, b water,
    // e earth, g wood, m metal, l light, d dark). In `text`, `{g}` is the gold
    // keyword marker. These entries touch `text` and only `text`; no correction
    // in this table has ever touched a cost, and the four cards' affinity costs
    // were verified correct against the owner (Brough `le`, Blob of the Dark
    // Order `l`, Inexorable Miasma `gd`, Unrelenting Horror `d`). Say which
    // field you mean, every time — a summary that did not caused exactly this
    // confusion once.
    why: 'CT-132. `{g}` colours ONE word as a keyword, and the pool disagrees with itself '
      + 'about this one: twelve cards name an attribute they do not carry on their type line, '
      + 'eight tag it and four do not, so the same word reads as a keyword on one card and as '
      + 'grey prose on another — which reads as though it means something different. '
      + 'Envoy of Lightning ("are {g}Electric") is the same shape with the marker present; no other card in the pool names poisonous in its rules text at all.'
      + ' The marker is COLOUR ONLY: it adds no glossary row and no behaviour (card text is '
      + 'display data — the rules live in src/cards/sets/), so this is presentation '
      + 'consistency and not the missing-rules-text bug report #118 was about. '
      + 'The bare occurrence inside the {i}(…) reminder is deliberately left alone: reminder '
      + 'text is prose ABOUT the keyword and is untagged on all eight cards that do tag it.',
  },
  {
    card: 'Unrelenting Horror',
    field: 'text',
    from: 'When I spawn, discard a card.{/n}When you trash a card, [Switch1] I gain +2/+2 and piercing until regroup.',
    to: 'When I spawn, discard a card.{/n}When you trash a card, [Switch1] I gain +2/+2 and {g}piercing until regroup.',
    since: '2026-09-01',
    by: 'CT-132 (agent; a consistency correction, not an owner ruling — see `why`)',
    // ⚠ RULED BY THE OWNER, 2026-09-01, verbatim: "`{g}` is in the text marker
    // and it makes the following word GOLD. It's used for giving units
    // attributes." So this is a TEXT-FORMATTING marker that belongs in the
    // corrected data for every reader, not a client-only rendering concern —
    // an earlier draft held these four back on that theory and was wrong.
    //
    // ⚠ AND `g` MEANS TWO DIFFERENT THINGS DEPENDING ON THE FIELD. In a `cost`
    // string it is the WOOD pip (dsl.ts ELEMENT_OF_PIP: r fire, b water,
    // e earth, g wood, m metal, l light, d dark). In `text`, `{g}` is the gold
    // keyword marker. These entries touch `text` and only `text`; no correction
    // in this table has ever touched a cost, and the four cards' affinity costs
    // were verified correct against the owner (Brough `le`, Blob of the Dark
    // Order `l`, Inexorable Miasma `gd`, Unrelenting Horror `d`). Say which
    // field you mean, every time — a summary that did not caused exactly this
    // confusion once.
    why: 'CT-132. `{g}` colours ONE word as a keyword, and the pool disagrees with itself '
      + 'about this one: twelve cards name an attribute they do not carry on their type line, '
      + 'eight tag it and four do not, so the same word reads as a keyword on one card and as '
      + 'grey prose on another — which reads as though it means something different. '
      + 'Protective Adaptations and Pernicious Photosynthesis are the same "+X/+X and {g}piercing until regroup" clause with the marker present.'
      + ' The marker is COLOUR ONLY: it adds no glossary row and no behaviour (card text is '
      + 'display data — the rules live in src/cards/sets/), so this is presentation '
      + 'consistency and not the missing-rules-text bug report #118 was about. '
      + 'The bare occurrence inside the {i}(…) reminder is deliberately left alone: reminder '
      + 'text is prose ABOUT the keyword and is untagged on all eight cards that do tag it.',
  },
  /* ── DELETED 2026-08-28 (R240): Interdiction Rift ─────────────────────
   *
   * The entry read `from: '{Battle}AI Cosmic Spell'`, `to: '{Battle} AI Cosmic
   * Spell'` — a whitespace-only repair proposed by R162 and marked STILL
   * UNRULED, because it guessed that only the space was wrong.
   *
   * The owner ruled on it, verbatim, 2026-08-28: *"Correct, that's a typo in
   * the oracle text. {Battle} Cosmic Spell is correct. AI shouldn't be there."*
   * So the guess was half wrong: the `AI` was a spurious subtype, not a real
   * one that had merely lost its space. R162's own note that `AI` is the pool's
   * only single-card subtype on a Cosmic spell was the visible symptom, and the
   * card art confirms it — Interdiction Rift's printed type line reads
   * "Cosmic Spell", with the {Battle} carried by the crossed-swords icon in the
   * title bar, exactly as every other {Battle} spell transcribes it.
   *
   * ⚠ THIS ENTRY IS DELETED RATHER THAN CORRECTED, and that is the rule this
   * file's header sets: *"If Caleb has corrected the source, DELETE the entry
   * — do not update `from` to make this pass."* The oracle file now reads
   * "{Battle} Cosmic Spell" at source, so there is nothing left to override;
   * a rewritten entry would be an exemption outliving its cause. What survives
   * the deletion is `test/209-interdiction-rift-type-line.test.ts`, which pins
   * the corrected line from BOTH sides — upstream and printed.json — so a
   * regression that reintroduced the `AI` would fail loudly with nothing in
   * this table papering over it.
   */
];

/** Fast lookup: card -> field -> entry. */
const BY_CARD = new Map();
for (const o of PRINTED_OVERRIDES) {
  if (!BY_CARD.has(o.card)) BY_CARD.set(o.card, new Map());
  const byField = BY_CARD.get(o.card);
  if (byField.has(o.field)) {
    throw new Error(`PRINTED_OVERRIDES has two entries for ${o.card} (${o.field})`);
  }
  byField.set(o.field, o);
}

/** The stale-entry error, thrown rather than `process.exit`ed so a test can
 * provoke it without killing the runner. The extractor turns it into a
 * non-zero exit. */
export class StaleOverrideError extends Error {}

/**
 * Apply the declared override for `card`/`field`, asserting the upstream value
 * still says what the table claims. Returns `value` unchanged when no entry
 * exists. Throws `StaleOverrideError` when an entry has gone stale — which is
 * the whole point: an override whose cause has been fixed upstream must break
 * the build, not keep quietly rewriting a field that is already correct.
 */
export function applyOverride(card, field, value) {
  const o = BY_CARD.get(card)?.get(field);
  if (!o) return value;
  if (value !== o.from) {
    throw new StaleOverrideError(
      `PRINTED_OVERRIDES is stale for ${card} (${field}): expected `
      + `${JSON.stringify(o.from)}, oracle now has ${JSON.stringify(value)}. `
      + 'Re-check the entry and DELETE it if the source has been corrected.');
  }
  return o.to;
}
