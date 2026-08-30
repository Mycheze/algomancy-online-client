/**
 * R267 — CAN THE REPOSITORY SEE THE GAME'S OWN WORDS?
 *
 * Round-32 Q6. The owner answered *"Rot has now been added"*, and round 32 had
 * told him there were no game words for {Rot} to be added FROM. That answer was
 * wrong, and it was wrong for a reason that generalises well past {Rot}:
 *
 *   R248 filled the glossary from the pool's `{i}(...)` reminder spans.
 *   R252 added the Algomancy Manual for the rows no card reminds you about.
 *   R252 §3 then stated, as a fact, that the remaining rows were ones for which
 *   "the glossary row remains the ONLY statement of the rule this repository
 *   has."
 *
 * That sentence is a claim about a SCAN, not about the game, and it is only
 * ever as true as the scan is complete. Two things were wrong with the scan:
 *
 *   (1) It recognised one of the pool's TWO reminder conventions. A span that
 *       names its own attribute — "(Any damage from a DEADLY source ...)" — was
 *       found; a keyword printed as the ability with the parenthetical
 *       explaining it — "Glimpse 1 {i}(Reveal the top card ...)" — was not.
 *       Three rows were behind their own cards because of it.
 *   (2) Both of its channels are BASE-GAME channels. The Light & Dark expansion
 *       has no manual, and its player counters print no reminder in our
 *       transcribed pool, so every L&D-only row was structurally guaranteed to
 *       fall through to the authored sentence whatever the game said.
 *
 * This file is the guard for both. §1 pins the derived candidate set for
 * convention B against the reviewed accept/reject split. §2 re-derives every
 * accepted reminder straight out of the pool. §3 re-derives the card-library
 * channel out of the checked-in Rules file. §4 is the measurement — how many
 * rows each channel actually supplies — and §0/§5 are the positive controls
 * that stop the whole file passing vacuously.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import printedJson from '../src/cards/printed.json' with { type: 'json' };
import {
  AUTHORED_GLOSSARY, GLOSSARY, LEAD_CANDIDATES, LEAD_VERDICTS, LIBRARY_REMINDERS,
  LIBRARY_SOURCE, MANUAL_REMINDERS, PRINTED_REMINDERS,
} from '../ui/glossary.ts';

const PRINTED = printedJson as unknown as Record<string, { text?: string }>;
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/* ════════════════════════════════════════════════════════════════════════
 * 0. POSITIVE CONTROLS — none of the sets below may be empty
 * ════════════════════════════════════════════════════════════════════════ */

test('POSITIVE CONTROL: the pool, the glossary and both reviewed channels all loaded', () => {
  assert.ok(Object.keys(PRINTED).length > 400,
    `only ${Object.keys(PRINTED).length} printed cards — the pool read is broken, not the pool`);
  assert.ok(GLOSSARY.length > 40, `only ${GLOSSARY.length} glossary rows`);
  assert.ok(LEAD_CANDIDATES.size > 0,
    'the convention-B derivation found NOTHING. Every check in this file would then pass '
    + 'vacuously and look identical to one that works.');
  assert.ok(LIBRARY_REMINDERS.size > 0, 'the card-library channel is empty');
});

/* ════════════════════════════════════════════════════════════════════════
 * 1. THE DERIVED CANDIDATE SET IS EXACTLY THE REVIEWED ONE
 * ════════════════════════════════════════════════════════════════════════ */

test('R267: every convention-B candidate the pool produces has a reviewed verdict', () => {
  // THE POINT OF THE WHOLE FILE. The candidate set is DERIVED from printed
  // card data; the verdict on each candidate is REVIEWED, because the
  // derivation admits real noise ("create a Shard. {i}(It spawns dormant.)"
  // explains the token, not the marker). A new card that creates a fourth
  // candidate must redden this and make somebody look — which is the only
  // thing standing between "reviewed judgement" and "list somebody typed".
  const derived = [...LEAD_CANDIDATES.keys()].sort();
  const reviewed = [...Object.keys(LEAD_VERDICTS.accepted),
    ...Object.keys(LEAD_VERDICTS.rejected)].sort();
  assert.deepEqual(derived, reviewed,
    'the pool now produces a convention-B candidate nobody has ruled on, or a reviewed verdict '
    + 'no longer matches any card. Read the span and either accept it (the row shows the game '
    + 'words) or reject it with the reason, in ui/glossary.ts LEAD_ACCEPTED / LEAD_REJECTED.');
  assert.ok(Object.keys(LEAD_VERDICTS.accepted).length >= 3,
    'fewer than three accepted convention-B reminders');
  // R267: an accepted verdict may NAME the card whose wording is shown. Where it
  // does, that card must really print the sentence the row displays — otherwise
  // the name is decoration and printed.json key order is picking again.
  for (const [term, card] of Object.entries(LEAD_VERDICTS.accepted)) {
    if (card === null) continue;
    const shown = GLOSSARY.find(e => e.term === term);
    assert.ok(shown, `{${term}} is accepted but is not a glossary row`);
    assert.equal(shown!.printedOn, card,
      `{${term}} is reviewed as showing ${card}s wording but the row was built from `
      + `${String(shown!.printedOn)}`);
  }
  assert.ok(Object.keys(LEAD_VERDICTS.rejected).length >= 1,
    'no candidate is rejected any more — if the noise really is gone, the reviewed split has '
    + 'stopped earning its keep and the derivation can be used directly');
});

test('R267: no term is claimed by both reminder conventions', () => {
  // convention A is the more specific statement and must win outright;
  // two sources claiming one row is the ambiguity 227 already forbids.
  const both = [...LEAD_CANDIDATES.keys()].filter(t => {
    const hit = PRINTED_REMINDERS.get(t)?.[0];
    return hit !== undefined && hit.text !== LEAD_CANDIDATES.get(t)!.text
      && new RegExp(`\\b${t}\\b`, 'i').test(hit.text);
  });
  assert.deepEqual(both, [],
    'a term has a convention-A reminder AND a convention-B candidate — decide which the client '
    + 'shows rather than letting scan order decide it');
});

/* ════════════════════════════════════════════════════════════════════════
 * 2. EVERY ACCEPTED REMINDER IS REALLY IN THE POOL, RE-DERIVED HERE
 * ════════════════════════════════════════════════════════════════════════ */

/** the card text, with the pool's inline markup flattened the way a reader
 * sees it — deliberately a second, simpler implementation than the one in
 * ui/glossary.ts, so this is a check on the POOL and not on that code */
const flat = (s: string): string => s.replace(/\{\/n\}/g, ' ').replace(/\s+/g, ' ').trim();

test('R267: each accepted convention-B reminder is printed on a real card, verbatim', () => {
  const bad: string[] = [];
  for (const term of Object.keys(LEAD_VERDICTS.accepted)) {
    const shown = GLOSSARY.find(e => e.term === term);
    if (!shown) { bad.push(`{${term}} is accepted but is not a glossary row`); continue; }
    // find it ourselves, from the raw pool, without asking glossary.ts
    const cards = Object.entries(PRINTED).filter(([, def]) => {
      const text = flat(def.text ?? '');
      const m = [...text.matchAll(/\{i\}\(([^)]*)\)/g)]
        .find(x => flat(x[1] ?? '') === shown.text);
      if (!m) return false;
      return new RegExp(`\\b${term}\\b`, 'i').test(text.slice(0, m.index));
    }).map(([n]) => n);
    if (!cards.length) {
      bad.push(`{${term}}: the row shows "${shown.text}" but no card in the pool prints that `
        + 'span with the keyword in front of it');
      continue;
    }
    if (shown.printedOn === undefined || !cards.includes(shown.printedOn)) {
      bad.push(`{${term}}: printedOn is ${String(shown.printedOn)}, which is not one of the `
        + `cards that print it (${cards.join(', ')})`);
    }
    if (shown.rule === undefined) {
      bad.push(`{${term}}: a printed reminder displaced its text and the authored rule did not `
        + 'move to `rule` — that is a deletion, not a shortening');
    }
  }
  assert.deepEqual(bad, [], `\n  ${bad.join('\n  ')}\n`);
});

test('R267: the three rows this ruling moved are the ones the pool actually speaks for', () => {
  // named on purpose: these three were each written down SOMEWHERE as a row the
  // game is silent about, and each claim was false when it was made.
  //   {Glimpse}  R252 §3 — "the ONLY statement of the rule this repository has"
  //   {Unstable} R252 §4 — judged the manual inadmissible, never checked a card
  //   {Ambush}   R252 §1 — took the manual while six cards printed a shorter one
  for (const term of ['Glimpse', 'Unstable', 'Ambush']) {
    const e = GLOSSARY.find(g => g.term === term)!;
    assert.ok(PRINTED_REMINDERS.has(term),
      `{${term}} has stopped being a printed row — if a card lost its reminder that is a real `
      + 'event, and R267 needs re-reading before this line is edited');
    assert.equal(e.manualOn, undefined, `{${term}} is printed; the manual must not also claim it`);
    assert.ok((e.ruling ?? []).includes('printed'), `{${term}} does not cite printed`);
  }
  assert.equal(MANUAL_REMINDERS.has('Ambush'), false,
    'ui/manual-reminders.json quotes the manual for {Ambush} again — printed beats manual, so '
    + 'the manual row must go rather than sit behind the cards as a second answer');
});

/* ════════════════════════════════════════════════════════════════════════
 * 3. THE CARD-LIBRARY CHANNEL REBUILDS OUT OF THE CHECKED-IN RULES FILE
 * ════════════════════════════════════════════════════════════════════════ */

test('R267: every card-library sentence is quoted verbatim from the file it cites', () => {
  // The same standard 231 holds the manual to, one channel over. What this
  // proves is that WE TRANSCRIBED THE CARD FAITHFULLY. It does NOT prove the
  // card is in the current print run, and the _README says so in as many words.
  const file = LIBRARY_SOURCE.file!;
  const raw = readFileSync(`${REPO}${file}`, 'utf8');
  assert.ok(raw.length > 5_000, `only ${raw.length} bytes of ${file} — the read is broken`);
  const unwrapped = raw.replace(/\s+/g, ' ');
  const bad: string[] = [];
  for (const [term, r] of LIBRARY_REMINDERS) {
    if (!unwrapped.includes(r.text)) {
      bad.push(`{${term}}: "${r.text}" is not in ${file} word for word — it has been paraphrased, `
        + 'or the file changed under the review');
    }
    if (!unwrapped.includes(r.card)) bad.push(`{${term}}: ${file} does not name the card ${r.card}`);
    if (!unwrapped.includes(r.posted)) bad.push(`{${term}}: ${file} does not carry the date ${r.posted}`);
  }
  assert.deepEqual(bad, [], `\n  ${bad.join('\n  ')}\n`);
});

test('R267: a card-library row shows the game words and keeps the authored rule', () => {
  const authored = new Map(AUTHORED_GLOSSARY.map(e => [e.term, e.text]));
  for (const [term, r] of LIBRARY_REMINDERS) {
    const e = GLOSSARY.find(g => g.term === term)!;
    assert.equal(e.text, r.text, `{${term}} does not show the card sentence`);
    assert.equal(e.rule, authored.get(term),
      `{${term}} lost its authored rule instead of moving it to \`rule\``);
    assert.ok(e.libraryOn?.includes(r.card), `{${term}} does not name the card it came from`);
    assert.equal(e.printedOn, undefined, `{${term}} is not a printed row`);
    assert.equal(e.manualOn, undefined, `{${term}} is not a manual row`);
  }
});

test('R267: the card library is consulted LAST, never over the pool or the manual', () => {
  const clash = [...LIBRARY_REMINDERS.keys()]
    .filter(t => PRINTED_REMINDERS.has(t) || MANUAL_REMINDERS.has(t));
  assert.deepEqual(clash, [],
    'a row is quoted from the card library AND from a stronger channel. Printed beats manual '
    + 'beats card library: delete the library entry rather than leaving two sources for one row.');
});

/* ════════════════════════════════════════════════════════════════════════
 * 4. THE MEASUREMENT — what each channel actually reaches
 * ════════════════════════════════════════════════════════════════════════ */

test('R267: the four channels partition the glossary, and the split is pinned', () => {
  // Not decoration. R252 §3 published a number for this and the number was
  // wrong, so the number is now derived and asserted rather than written in
  // prose where nothing can check it.
  const of = (e: typeof GLOSSARY[number]): string =>
    PRINTED_REMINDERS.has(e.term) ? 'printed'
      : MANUAL_REMINDERS.has(e.term) ? 'manual'
        : LIBRARY_REMINDERS.has(e.term) ? 'library' : 'authored';
  const tally: Record<string, number> = { printed: 0, manual: 0, library: 0, authored: 0 };
  for (const e of GLOSSARY) tally[of(e)]! += 1;
  assert.deepEqual(tally, { printed: 18, manual: 6, library: 1, authored: 18 },
    'the channel split moved. If PRINTED went up a card started reminding players about a row '
    + '(good, and the row should stop citing the weaker channel); if AUTHORED went up a row lost '
    + 'a source. Either way R267 wants re-reading before this number is edited.');
  assert.equal(Object.values(tally).reduce((a, b) => a + b, 0), GLOSSARY.length,
    'the four channels no longer partition the table — a row is being counted twice or not at all');
  // and the thing R252 §3 got wrong, stated as an assertion this time
  assert.ok(tally.printed! > 15,
    'convention B has stopped reaching the three rows it was written for — R248 found 15 and '
    + 'R267 found three more, so anything at or below 15 means the second convention is dead');
});

/* ════════════════════════════════════════════════════════════════════════
 * 5. POSITIVE CONTROL: the derivation notices when the pool changes
 * ════════════════════════════════════════════════════════════════════════ */

test('POSITIVE CONTROL: the convention-B rule really depends on the lead text', () => {
  // If this passed with the keyword removed from the lead, the derivation
  // would be matching on something else and every accept above would be luck.
  const term = 'Glimpse';
  const shown = GLOSSARY.find(e => e.term === term)!;
  const withLead = Object.values(PRINTED).filter(def => {
    const text = flat(def.text ?? '');
    const m = [...text.matchAll(/\{i\}\(([^)]*)\)/g)].find(x => flat(x[1] ?? '') === shown.text);
    return m !== undefined && new RegExp(`\\b${term}\\b`, 'i').test(text.slice(0, m.index));
  }).length;
  const anywhere = Object.values(PRINTED).filter(def =>
    [...flat(def.text ?? '').matchAll(/\{i\}\(([^)]*)\)/g)]
      .some(x => new RegExp(`\\b${term}\\b`, 'i').test(flat(x[1] ?? '')))).length;
  // ONE, not two: the row shows Premonition's `Glimpse X` wording, which is the
  // general parameterised form and the only card that prints it. The count that
  // matters here is "more than zero, and found by the LEAD" — the `anywhere`
  // assertion below is what makes that non-trivial.
  assert.ok(withLead >= 1, `only ${withLead} cards print the {Glimpse} span with the keyword ahead of it`);
  assert.equal(anywhere, 0,
    'a card now names Glimpse INSIDE its reminder span, which means convention A can see the row '
    + 'on its own and the convention-B accept for it is no longer load-bearing');
});
