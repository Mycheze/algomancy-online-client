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
 * destroyed by the next extract. WHY NOT IN THE ORACLE FILE: see above — and
 * because an override here fixes exactly ONE of the three consumers. The bot
 * and the corpus read the oracle file directly and stay wrong until Caleb
 * corrects it at source. Every entry below is therefore also a line item on
 * the message that has to go to Caleb.
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
  {
    card: 'Interdiction Rift',
    field: 'type',
    from: '{Battle}AI Cosmic Spell',
    to: '{Battle} AI Cosmic Spell',
    since: '2026-08-25',
    by: 'Claude (R162) — ⚠ STILL UNRULED',
    why: 'A pure whitespace repair of the same shape as Might of the Grove: a marker brace '
      + 'glued to the next word. These two are the only type lines in the whole oracle file '
      + 'matching /\\}[A-Za-z]/, so a general rule would fire exactly here anyway. Reported '
      + 'alongside R157 §25 rather than authorised by it — say so rather than letting the '
      + 'Might of the Grove ruling cover it by proximity. Nothing reads the line: `kind` '
      + 'only asks whether "Spell" appears and {Battle} is matched brace-to-brace.',
  },
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
