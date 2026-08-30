/* THE DECLARED LIST OF THINGS THE CARD AUDIT FINDS AND WE ACCEPT.
 *
 * `scripts/audit-cards.mjs` checks the oracle transcription and the two files
 * derived from it. Some of what it finds is not a bug: a help card genuinely
 * has no element, `Whale` genuinely is a subtype only Good Whale prints. Those
 * live here, named, with the reason — not as a loosened check.
 *
 * WHY NOT JUST LOOSEN THE CHECK: because the checks that matter are the ones
 * that fire on a single card. R162 found `AI Cosmic Spell` precisely because
 * `AI` was the pool's ONLY single-card subtype on a Cosmic spell, and R240
 * later confirmed it was an OCR artifact rather than a subtype. A rule broad
 * enough to make `Whale` silent is broad enough to make the next `AI` silent
 * too. So the singleton check stays sharp and the 27 real singletons are
 * listed below.
 *
 * -- the shape --------------------------------------------------------
 *   check  the audit check id, exactly as the report prints it
 *   card   the card name, or '*' for a finding that is not about one card
 *   why    the argument for accepting it
 *   since  the date it was accepted
 *
 * A STALE ENTRY IS A FAILURE, the same way a stale PRINTED_OVERRIDE is.
 * If a listed finding stops firing -- because the source was corrected, or a
 * card was scripted, or art was added -- the audit exits non-zero naming the
 * entry, and the entry must be DELETED rather than kept "just in case". This
 * file is a record of what is wrong today, not a list of what was once wrong.
 */

/** @typedef {{ check: string, card: string, why: string, since: string }} KnownFinding */

const on = (check, cards, why, since) => cards.map(card => ({ check, card, why, since }));

/** @type {KnownFinding[]} */
export const KNOWN_FINDINGS = [
  /* -- the twelve reference cards with no element ----------------------
   * Their oracle `factions` is the literal STRING "Unknown", not a list. They
   * are turn-structure charts, the cardback, the intent tokens and the keyword
   * reference: physical components of the box, not cards with a colour. The
   * extractor coerces them to [], which is right; the audit names them so the
   * coercion is a decision on the record rather than a silent shrug. */
  ...on('factions-not-a-list', [
    '1v1 Turn Structure', 'Blank Card', 'Cardback', 'Initiative', 'Initiative Back',
    'Intent', 'Left', 'Player Icons Card', 'Player Keywords Card', 'Right', 'Stay',
    'Turn Structure',
  ], 'a reference component, not a card: it has no element to disagree about', '2026-08-28'),

  /* -- the nine Kickstarter Glitch cards with no scan -------------------
   * They are in the oracle file and in no other pipeline: no local jpg, no
   * printed data in the engine, no behaviour. The browser shows them with the
   * art fallback and a "not scripted" badge, which is the honest rendering.
   * Delete an entry the day a scan lands in data/cards/. */
  ...on('art-missing', [
    'KSX Crystal Buddy', 'KSX Fire Buddy', 'KSX Metal Buddy', 'KSX Plant Buddy',
    'KSX Price of Power', 'KSX Self Assembly', 'KSX Soul Tithe', 'KSX Tides of War',
    'KSX Water Buddy',
  ], 'Kickstarter exclusive with no scan in data/cards/ and no engine script', '2026-08-28'),

  /* -- the 27 subtypes exactly one card prints --------------------------
   * Each was checked against the card scan. They are real: Algomancy prints a
   * lot of one-off creature words. The value of listing them is that the
   * TWENTY-EIGHTH one has to be looked at. */
  ...on('subtype-singleton', [
    'Alpaca', 'Angel', 'Apple', 'Banana', 'Buddy', 'Cat', 'Caterpillar', 'Clam',
    'Dormant', 'Earth', 'Fire', 'Friend', 'Horse', 'Ice', 'Kraken', 'Lord', 'Metal',
    'Monkey', 'Nebula', 'Porcupine', 'Prismite', 'Shard', 'Slag', 'Squid', 'Water',
    'Whale', 'Wood',
  ], 'a real one-off printed subtype, confirmed against the card scan', '2026-08-28'),

  /* -- NOTHING ELSE, and one deletion worth reading ---------------------
   * This list opened with a `text-misspelling / Linked Extinction` entry, for
   * the "Sacrifce a unit" the extractor's comment still cites as the example
   * of a typo we report and leave. The audit's very first run rejected it as
   * STALE: the source had already been corrected (commit 0818074, "Fix
   * 'Sacrifce' at SOURCE"), so the finding no longer fires and the entry was
   * an exemption with no cause. Deleted the same day it was written, which is
   * the behaviour this file is supposed to have.
   *
   * The `text-misspelling` CHECK stays in audit-cards.mjs as a regression
   * guard. A check that finds nothing is not a check that is not working. */
];

/** Fast lookup: "check card" -> entry. */
const BY_KEY = new Map();
for (const k of KNOWN_FINDINGS) {
  const key = `${k.check} ${k.card}`;
  if (BY_KEY.has(key)) throw new Error(`KNOWN_FINDINGS has two entries for ${k.check} / ${k.card}`);
  BY_KEY.set(key, k);
}

export const isKnown = (check, card) => BY_KEY.has(`${check} ${card}`);

/**
 * Split findings into accepted and new, and name the entries here that no
 * longer fire. That third return value is the one that keeps this file honest.
 */
export function partition(findings) {
  const seen = new Set();
  const fresh = [];
  for (const f of findings) {
    const key = `${f.check} ${f.card}`;
    if (BY_KEY.has(key)) seen.add(key);
    else fresh.push(f);
  }
  const stale = KNOWN_FINDINGS.filter(k => !seen.has(`${k.check} ${k.card}`));
  return { fresh, stale, accepted: seen.size };
}
