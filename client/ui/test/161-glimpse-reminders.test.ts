/**
 * R190 — the reminder text a player actually READS about Glimpse.
 *
 * Playtest report #106 (GYSR, action 154): *"The reminder text for Glimpsing is
 * wrong — it does not mention that the other cards not chosen are recycled."*
 *
 * ⚠ THE TRIAGE OF THAT REPORT WAS WRONG, AND THIS FILE IS WHERE THAT IS PINNED
 * DOWN. Both the ledger note and CARD-TODO #73 recorded it as an upstream data
 * error — "Oracle of Foretelling reads … and stops" — and routed it to
 * `AlgomancyCards-OracleText.json`. It is not. The four cards that Glimpse more
 * than one card print "Recycle the rest." in the oracle file, in the generated
 * `printed.json`, and on the card face; §1 below asserts that per card so the
 * claim cannot be made again without failing.
 *
 * What the player was reading is `ui/glossary.ts`'s **Glimpse** entry, which
 * the card inspector prints under every card whose text mentions Glimpse
 * ("all referenced keywords should have their reminder text right there to
 * see", Bena 2026-08-20). That entry still described R45 as it read BEFORE the
 * 2026-08-19 correction — "cache them", all N, no recycle — so the panel
 * contradicted itself: the printed box said "cache one … Recycle the rest" and
 * the reminder directly beneath it said the opposite. §2 pins the entry to what
 * `E.glimpse` does.
 *
 * (This file was `161-printed-text-overrides.test.ts` and also held the checks
 * on the extractor's override table. That table is gone — corrections are made
 * in the oracle file itself since 2026-09-20 — and so are those sections; the
 * Glimpse guards are unchanged.)
 *
 * Seeds: none — this file is pure data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allCardNames, getCard } from '../../engine/src/cards/dsl.ts';
import type { CardName } from '../../engine/src/types.ts';
// side-effecting: importing the registry is what REGISTERS the pool, so
// getCard resolves. Without it every card here is "Unknown card".
import '../../engine/src/cards/registry.ts';
import { GLOSSARY, glossaryHits } from '../glossary.ts';

/* ── §1 · the printed reminders — per card, all five ───────────────────── */

/**
 * ⚠ DERIVED FROM PRINTED TEXT, NOT TYPED — CT-81(a) / R209.
 *
 * This list used to be the FIVE names CARD-TODO #73 happened to report, and it
 * drives all three of this file's loops, so those five WERE the file's whole
 * coverage. **Eleven cards print Glimpse.** Six were uncovered — Lifebound
 * Seer, Seer of Empty Spaces, Glook, Maw of Despair, Lilbot and Visionary
 * Construct — and the last of those prints a full `{i}(Reveal the top card…)`
 * reminder in wording identical to Foretell's, i.e. exactly the shape §1 exists
 * to police. That is the round's own output reproducing the failure the round
 * exists to catch, and docs/13-assessment.md §7.2 makes the rule: **a guard's
 * card list is computed from printed data, never typed from a report.**
 *
 * ⚠ DERIVE FROM PRINTED TEXT, NOT FROM CALL SITES. A grep for `.glimpse(`
 * finds twelve hits in seven files and MISSES four of these eleven cards,
 * because `batch-water-a.ts` and `batch-hybrids-wm-b.ts` each route through a
 * file-local `glimpse()` wrapper rather than calling `g.glimpse` directly. The
 * two derivations agree only if a sweep chases the wrappers; this one has no
 * such hole, and it is also the right basis on principle — the subject here is
 * what the card SAYS, which is what the player reads.
 *
 * ⚠ `Big Glimpse Card` is EXCLUDED, and correctly. Its printed text is "Reveal
 * the top 7 cards… Target opponent splits them into two piles…" — the word
 * "Glimpse" appears in its NAME and nowhere in its text, and its body
 * hand-rolls the pile split rather than calling `E.glimpse`. It is not a
 * Glimpse card; it is a card called Glimpse. The filter reads `.text`, never
 * the name, so it is out for the right reason — asserted below so a filter
 * that started reading names would fail rather than quietly re-admit it.
 *
 * `recycles` is computed from the parsed N, not declared: N > 1 (or X, which
 * is only ever ≥ 1 and reads as "the rest" on the card) leaves cards over to
 * recycle, N = 1 does not. That asymmetry is R45's own reading — "the N=1
 * cards read 'reveal the top card and cache it' only because the two readings
 * coincide there" — so it is asserted rather than papered over.
 *
 * `reminder` is whether the card prints the parenthetical at all. Five of the
 * eleven do not, and for those the GLOSSARY row §2 checks is the only reminder
 * their reader ever gets — which is precisely why R190's glossary fix needs
 * them in scope.
 */
interface GlimpseCard { name: string; n: number | 'X'; recycles: boolean; reminder: boolean }

const GLIMPSE_CARDS: GlimpseCard[] = allCardNames()
  .filter(n => /Glimpse/i.test(getCard(n).text ?? ''))
  .map((name): GlimpseCard => {
    const text = getCard(name).text ?? '';
    // "Glimpse 5", "Glimpse X", "Its controller Glimpses 3" — one shape.
    const m = /Glimpses?\s+(\d+|X)/i.exec(text);
    assert.ok(m, `${name} prints "Glimpse" but no N this parser can read: ${text}`);
    const n: number | 'X' = m[1] === 'X' || m[1] === 'x' ? 'X' : Number(m[1]);
    return {
      name,
      n,
      recycles: n === 'X' || n > 1,
      reminder: /\{i\}\(\s*(?:They )?[Rr]eveal the top/.test(text),
    };
  });

/** the pool this file's derivation ran against. R209: `allCardNames()` returns
 * 495 (492 printed + 3 synthetics) only when `src/apply.ts` has been imported —
 * `registerSynthetic` is called at registry.ts:384, registry.ts:433 AND
 * apply.ts:1830 — and this file imports the registry only, so it sees 494. It
 * is asserted rather than assumed because a sweep that silently ran against a
 * smaller pool than it thought is how a card goes uncovered. No Glimpse card is
 * synthetic, so 494 and 495 give the same eleven; the number is pinned so a
 * future reader knows which pool the eleven was counted over. */
const POOL = allCardNames().length;

test('§1 the Glimpse list is DERIVED and complete — a NEW Glimpse card fails here', () => {
  // R297: registry.ts registers Training Construct too, so registry-only is 495
  assert.equal(POOL, 495,
    `this file imports src/cards/registry.ts only, which registers 495 cards. Seeing ${POOL} `
    + 'means the pool moved (a card was added) or an import changed — if it is 496, apply.ts '
    + 'is now in this file\'s graph and brings its own synthetic. Either way, recount.');
  assert.deepEqual(GLIMPSE_CARDS.map(c => c.name).sort(), [
    'Celestial Purge', 'Dematerialize', 'Foretell', 'Glook', 'Lifebound Seer', 'Lilbot',
    'Maw of Despair', 'Oracle of Foretelling', 'Premonition', 'Seer of Empty Spaces',
    'Visionary Construct',
  ], 'the pool\'s Glimpse cards have changed. A NEW Glimpse card must be ADDED here '
    + 'deliberately — this assertion exists so it cannot slip into the pool uncovered, which '
    + 'is exactly what happened to the six this list used to omit (CT-81a).');
  assert.equal(GLIMPSE_CARDS.length, 11);
  assert.ok(!GLIMPSE_CARDS.some(c => c.name === 'Big Glimpse Card'),
    'Big Glimpse Card must stay out: "Glimpse" is in its NAME, not its text, and its body '
    + 'hand-rolls a two-pile split rather than calling E.glimpse. If it is in this list the '
    + 'filter has started reading names instead of printed text.');
  // and it really is in the pool, so the exclusion is a live decision rather
  // than an accident of the card not existing
  assert.ok(allCardNames().includes('Big Glimpse Card' as CardName));
  assert.doesNotMatch(getCard('Big Glimpse Card' as CardName).text ?? '', /Glimpse/i);
});

test('§1 the parsed N and the derived `recycles` agree with what each card prints', () => {
  // the derivation stated as data, so a wrong parse is visible as a wrong row
  // rather than as a mysteriously passing loop below
  assert.deepEqual(
    GLIMPSE_CARDS.map(c => `${c.name}: N=${c.n} recycles=${c.recycles} reminder=${c.reminder}`).sort(),
    [
      'Celestial Purge: N=3 recycles=true reminder=true',
      'Dematerialize: N=3 recycles=true reminder=true',
      'Foretell: N=1 recycles=false reminder=true',
      'Glook: N=1 recycles=false reminder=false',
      'Lifebound Seer: N=2 recycles=true reminder=false',
      'Lilbot: N=2 recycles=true reminder=false',
      'Maw of Despair: N=2 recycles=true reminder=false',
      'Oracle of Foretelling: N=5 recycles=true reminder=true',
      'Premonition: N=X recycles=true reminder=true',
      'Seer of Empty Spaces: N=1 recycles=false reminder=false',
      'Visionary Construct: N=1 recycles=false reminder=true',
    ]);
});

for (const { name, recycles, reminder } of GLIMPSE_CARDS) {
  test(`§1 ${name} (Glimpse ${GLIMPSE_CARDS.find(c => c.name === name)!.n}) prints ${
    reminder ? (recycles ? 'a reminder that names the recycle' : 'a reminder for N=1, with no rest to recycle')
      : 'no reminder — the glossary row is its reader\'s only one'}`, () => {
    const printed = getCard(name).text ?? '';
    assert.match(printed, /Glimpse/i, `${name} should print a Glimpse reminder at all`);
    if (!reminder) {
      // R209/CT-81(a): five of the eleven print the keyword bare. There is no
      // parenthetical to check, and that is the POINT — §2 below is the whole
      // of what these cards' readers get, so they must be in this file's scope.
      assert.doesNotMatch(printed, /\{i\}\(/,
        `${name} has grown a printed reminder — check it against the four N>1 cards and set `
        + '`reminder` accordingly (it is derived, so this means the printed text changed)');
      return;
    }
    if (recycles) {
      assert.match(printed, /cache one/i,
        `${name} should print "cache one" — R45 as corrected 2026-08-19`);
      assert.match(printed, /Recycle the rest/i,
        `${name}'s printed text is where report #106 said the omission was. It is NOT there:\n`
        + `  ${printed}\n`
        + 'If this ever fails, the oracle file really has lost the clause and the fix is a '
        + 'text entry in scripts/printed-overrides.mjs plus a message to Caleb.');
    } else {
      assert.doesNotMatch(printed, /Recycle the rest/i,
        `${name} is Glimpse 1: one card is revealed and cached, so nothing is left over`);
      assert.match(printed, /cache it/i, 'the N=1 reading, R45');
    }
  });
}

test('§1 every printed N>1 reminder says cache-ONE-and-recycle, matching E.glimpse', () => {
  // one assertion over the group, so a single card quietly drifting out of the
  // family is visible next to the others rather than only in its own test.
  // R209: the group is DERIVED (N>1 and a printed reminder), so a new card that
  // arrives in it appears here without anyone remembering to add it.
  const said = GLIMPSE_CARDS.filter(c => c.recycles && c.reminder).map(c => {
    const t = getCard(c.name).text ?? '';
    return `${c.name}: cacheOne=${/cache one/i.test(t)} recycle=${/Recycle the rest/i.test(t)}`;
  }).sort();
  assert.deepEqual(said, [
    'Celestial Purge: cacheOne=true recycle=true',
    'Dematerialize: cacheOne=true recycle=true',
    'Oracle of Foretelling: cacheOne=true recycle=true',
    'Premonition: cacheOne=true recycle=true',
  ]);
});

test('§1 every printed N=1 reminder says cache-IT and claims no rest', () => {
  // Visionary Construct is the card CT-81(a) named: Glimpse 1 with a FULL
  // printed reminder in wording identical to Foretell's, omitted from the
  // hand-typed list — the exact shape §1 exists to police, uncovered.
  const said = GLIMPSE_CARDS.filter(c => !c.recycles && c.reminder).map(c => {
    const t = getCard(c.name).text ?? '';
    return `${c.name}: cacheIt=${/cache it/i.test(t)} recycle=${/Recycle the rest/i.test(t)}`;
  }).sort();
  assert.deepEqual(said, [
    'Foretell: cacheIt=true recycle=false',
    'Visionary Construct: cacheIt=true recycle=false',
  ]);
});

/* ── §2 · the reminder the inspector actually prints ───────────────────── */

const glimpseEntry = (): { term: string; text: string; rule?: string } => {
  const e = GLOSSARY.find(g => g.term === 'Glimpse');
  assert.ok(e, 'the glossary has lost its Glimpse entry');
  return e;
};

test('§2 the Glimpse glossary reminder names the recycle, and the full rule survives beside it', () => {
  // ⚠ CONVERTED BY R267, AND THE OLD EXPECTATIONS ARE KEPT HERE BECAUSE THEY
  // ARE STILL THE RULE — they moved, they were not dropped:
  //
  //     assert.match(text, /recycled to the bottom of your deck/i);
  //     assert.match(text, /\bONE\b/);
  //
  // Both were written against our AUTHORED sentence, when that was the only
  // {Glimpse} reminder the repo had. R267 found that four cards print one, so
  // `text` is now the game's own words and the authored sentence moved WHOLE
  // into `rule` (R248 §2) — where the browser still renders it underneath.
  // So the two assertions are made against the half that still carries each
  // claim, which is stricter than before: previously nothing checked `rule`.
  //
  // ⚠ THE CARD IS A REVIEWED CHOICE AND REPORT #106 IS WHY. Glimpse is printed
  // four ways, and the wording the MOST cards print is Glimpse 1's — a
  // degenerate instance with one card revealed, nothing left over, and
  // therefore NO recycle clause at all. Picking by popularity would have
  // silently re-opened the owner's report. The row shows Premonition's
  // `Glimpse X`: the general form, second person, recycle included.
  const { text, rule } = glimpseEntry();
  assert.match(text, /recycle the rest/i,
    'report #106: "it does not mention that the other cards not chosen are recycled". '
    + 'The game says "Recycle the rest." and that is what a player now reads.');
  assert.ok(rule, 'the authored rule must survive on `rule` — R248 §2, and 177 §7 agrees');
  // R296 CHANGED WHERE, AND THE CLAIM IS STILL "WHERE". This read
  // /recycled to the bottom of your deck/ until the mark existed; the printed
  // reminder says only "Recycle the rest", so wherever a recycled card
  // actually goes, the authored half is the only place a player can read it.
  assert.match(rule!, /recycle pile|past the mark/i,
    'WHERE they go is not in the printed reminder, so the repo statement of it must not be lost');
  assert.match(rule!, /\bONE\b/,
    'R45 as corrected 2026-08-19 caches exactly one, not all N');
  assert.doesNotMatch(text, /cache them/i,
    'the pre-correction wording ("cache them", all N) is what shipped in report #106');
});

test('§2 the Glimpse reminder keeps the three limits R45 puts on the cached card', () => {
  // ⚠ CONVERTED BY R267. All three were asserted on `text` when `text` WAS our
  // authored sentence:
  //
  //     assert.match(text, /ignoring affinity/i);
  //     assert.match(text, /paying its mana/i);
  //     assert.match(text, /timing/i);
  //
  // The game's printed reminder states one of the three and not the other two —
  // which is exactly the case R248 §2 built `rule` for, and exactly why
  // shortening what a player reads may never be the same edit as deleting a
  // rule. Each limit is now asserted on whichever half actually carries it, so
  // NONE of them can be lost; before this, two of them were only ever checked
  // on a string that R267 was free to replace.
  const { text, rule } = glimpseEntry();
  assert.ok(rule, 'the authored rule must survive on `rule`');
  assert.match(text, /ignoring affinity/i,
    'Caleb 2024-10-28 — and the game prints this one itself');
  assert.match(rule!, /ignoring affinity/i, 'and the repo statement still says it too');
  assert.match(rule!, /paying its mana/i,
    'Caleb 2023-08-13 — you still pay the cost. The printed reminder does not say so, so this '
    + 'is one of the two limits that would vanish if `rule` were ever dropped.');
  assert.match(rule!, /timing/i,
    'Caleb 2025-12-28 — printed timing still applies. The other limit the cards do not print.');
});

test('§2 the Recycle reminder no longer denies what the Glimpse one now says', () => {
  // the two rows print TOGETHER on the four N>1 cards, because those cards'
  // text says both words. The Recycle entry used to read "the card is gone for
  // the rest of the game", which is the one thing recycling never does:
  // apply.ts's doRecycle calls e.recycleToBottom(seat, card) before it pushes
  // the dormant resource, and the Rulebook glosses the word inline as "putting
  // it on the bottom of the deck".
  const e = GLOSSARY.find(g => g.term === 'Recycle');
  assert.ok(e, 'the glossary has lost its Recycle entry');
  assert.match(e.text, /bottom of/i, 'recycling puts the card on the bottom of the deck');
  assert.doesNotMatch(e.text, /gone for the rest of the game/i);
});

for (const { name } of GLIMPSE_CARDS) {
  test(`§2 ${name}'s inspector panel offers the corrected Glimpse reminder`, () => {
    // exactly what ui/main.ts asks for: the type line and the printed text,
    // minus the card's own attributes
    const c = getCard(name);
    const hits = glossaryHits([c.type, c.text], { skip: c.attrs });
    const glimpse = hits.find(h => h.term === 'Glimpse');
    assert.ok(glimpse, `${name} says Glimpse, so the panel must explain Glimpse`);
    // R267: was /recycled to the bottom of your deck/i, against our authored
    // sentence. The panel now shows the game's own words, which say "Recycle
    // the rest." — report #106's substance, in the game's phrasing. Where they
    // go is on `rule`, checked above and rendered beneath by the browser.
    assert.match(glimpse.text, /recycle the rest/i);
    // R296: "the bottom of your deck" became "past the mark, into the recycle
    // pile". The claim is unchanged — where they go is on `rule`.
    assert.match(glimpse.rule ?? '', /recycle pile|past the mark/i,
      'the authored rule must still be reachable beside the printed reminder');
    // and the row that sits beside it on the N>1 cards must agree
    const recycle = hits.find(h => h.term === 'Recycle');
    if (recycle) assert.doesNotMatch(recycle.text, /gone for the rest of the game/i);
  });
}
