/* R252 / report #118 — THE REMINDER A PLAYER READS IS THE GAME'S, PART TWO.
 *
 * R248 answered report #118 for the fifteen glossary rows a CARD reminds you
 * about: the printed `{i}(…)` span became `text`, the repo's generalisation
 * moved to `rule`. The owner then read the card browser again and objected to
 * the two rows under Aetherflux Golem, verbatim:
 *
 *   "That text for 'Virus' and 'Augment' is OUR text. Not the games. Notice
 *    how it references R numbers and not just the stuff in the manual."
 *
 * Two things were in that, and only one of them was undone work.
 *
 *   · The trailing "R79, R95, R161" was ui/cardpanel.ts printing the `ruling`
 *     FIELD, and R248 deleted that render hours before the report was written.
 *     227-reminder-text.test.ts already guards it three ways. Nothing here.
 *   · {Virus} and {Augment} carry NO printed reminder on any card, so R248's
 *     swap had nothing to swap in and left our sentence on screen. THAT is
 *     this file.
 *
 * ── WHY THIS IS A TEST AND NOT JUST A JSON FILE ──
 *
 * The manual is a two-column illustrated PDF. Its checked-in plain-text
 * extraction (`pdftotext -layout`) puts fragments of three different columns on
 * one line, so a naive grep returns a sentence spliced together out of three
 * unrelated paragraphs — and pasting one of those on screen as if it were the
 * rulebook is worse than showing our own honest sentence. The extraction in
 * ui/manual-reminders.json was therefore read out of a SECOND extraction
 * (`pdftotext -raw`, which follows the PDF's reading order instead of its
 * geometry), and this file is the third channel: it rebuilds every sentence
 * out of the CHECKED-IN file's own fragments and fails if a single word was
 * paraphrased. Two mechanisms that share a premise are one mechanism
 * (docs/13 §7.2), so the rebuild is deliberately unlike the reading: it never
 * looks at reading order, only at which fragments exist and on which lines.
 *
 * ── AND WHY IT PINS THE ROWS THAT ARE *NOT* IN THE MANUAL ──
 *
 * "A scrape that reads less than it should" is this repository's signature
 * bug. The honest result here is that the manual has NO per-attribute glossary
 * — p.24 says only that attributes "have a reminder text in italics" and
 * delegates to the cards — so twenty-one rows get nothing, and fourteen of
 * those do not occur in the manual under any spelling. §5 pins the occurrence
 * count for every one of them, so the difference between "the manual is silent
 * about {Evasive}" and "somebody's regex missed it" is a number in this file
 * rather than a claim in a commit message.
 *
 * Seeds: none — pure data and pure string matching.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AUTHORED_GLOSSARY, GLOSSARY, MANUAL_REMINDERS, MANUAL_SOURCE, PRINTED_REMINDERS,
} from '../ui/glossary.ts';

/** the checked-in `pdftotext -layout` extraction, which is what a human
 * auditing this file will open next to the PDF */
const MANUAL = readFileSync(new URL('../../../Rules/Algomancy-Manual.txt', import.meta.url), 'utf8');

/* ════════════════════════════════════════════════════════════════════════
 * 1. THE REBUILD: every sentence really is the manual's
 * ════════════════════════════════════════════════════════════════════════
 *
 * `compact` throws away everything that the two extractions disagree about —
 * spacing, the line breaks the layout wraps at, the soft hyphens it wraps
 * WITH, and the curly quotes — and keeps every letter. What survives is the
 * word sequence, which is the thing that must not have been edited.
 */
const compact = (s: string): string => s
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[\s­-]/g, '').toLowerCase();

interface Frag { ln: number; c: string }

/** the manual as the fragments the layout extraction actually contains: each
 * line cut at every run of 3+ spaces, which is where a column boundary is */
const FRAGMENTS: Frag[] = MANUAL.split('\n').flatMap((line, ln) =>
  line.split(/ {3,}/).map(p => ({ ln, c: compact(p) })).filter(f => f.c.length > 0));

/**
 * Can `sentence` be laid down end to end using whole fragments of the manual,
 * taken in non-decreasing line order and never going backwards?
 *
 * That is a much stronger question than "do these words appear". A paraphrase
 * breaks at the first altered word, because no fragment continues it; an
 * invented sentence never starts. The final fragment may be entered and left
 * early — a quoted sentence usually ends mid-line — and nothing else may.
 *
 * Backtracking, not greedy: the longest fragment that fits is often the wrong
 * one (it can advance the line pointer past the continuation), and a greedy
 * walk rejected two sentences that are verbatim in the file.
 */
function rebuild(sentence: string): { ok: boolean; from?: number } {
  const want = compact(sentence);
  const dead = new Set<string>();
  const walk = (i: number, ln: number): boolean => {
    if (i >= want.length) return true;
    const key = `${i}:${ln}`;
    if (dead.has(key)) return false;
    const tail = want.slice(i);
    if (FRAGMENTS.some(f => f.ln >= ln && f.c.startsWith(tail))) return true;
    const fits = FRAGMENTS.filter(f => f.ln >= ln && want.startsWith(f.c, i))
      .sort((a, b) => b.c.length - a.c.length);
    for (const f of fits) if (walk(i + f.c.length, f.ln)) return true;
    dead.add(key);
    return false;
  };
  const start = FRAGMENTS.find(f => want.startsWith(f.c) || f.c.startsWith(want));
  return { ok: walk(0, -1), from: start?.ln };
}

test('R252: the manual extraction is loaded, and it is the file the JSON cites', () => {
  assert.equal(MANUAL_SOURCE.file, 'Rules/Algomancy-Manual.txt',
    'ui/manual-reminders.json must cite the file this test verifies it against');
  assert.ok(MANUAL.length > 100_000, `only ${MANUAL.length} bytes of manual — the read is broken`);
  assert.ok(FRAGMENTS.length > 1_500,
    `only ${FRAGMENTS.length} fragments — the column split is broken, not the manual`);
  assert.equal(MANUAL_REMINDERS.size, 7,
    'seven rows are quotable from the manual. Changing this number is a rules decision: read '
    + 'the _README in ui/manual-reminders.json before moving it in either direction.');
});

test('R252: every quoted sentence rebuilds out of the manual word for word', () => {
  const bad: string[] = [];
  for (const [term, m] of MANUAL_REMINDERS) {
    const r = rebuild(m.text);
    if (!r.ok) {
      bad.push(`{${term}}: "${m.text}" is not in ${MANUAL_SOURCE.file} as written. `
        + `Quote the manual or do not claim to — a sentence shown as the rulebook must BE it.`);
    }
  }
  assert.deepEqual(bad, [], `\n  ${bad.join('\n  ')}\n`);
});

test('POSITIVE CONTROL: the rebuild rejects a paraphrase and an invention', () => {
  // the failure this whole file exists to catch: our words, presented as the
  // manual's. One word moved is enough.
  const real = MANUAL_REMINDERS.get('Haste')!.text;
  assert.equal(rebuild(real).ok, true, 'the control needs a sentence that really is in the manual');
  for (const fake of [
    'Haste cards may also be played during the haste phase.',   // reworded
    'Haste cards can also be played during the haste step, and in deployment too.',  // extended
    'Evasive units need two blockers, so a single unit cannot block them.',          // invented
    'The one card you may augment DURING BATTLE, and only out of your hand.',        // ours
  ]) {
    assert.equal(rebuild(fake).ok, false, `the rebuild accepted a sentence the manual does not contain: ${fake}`);
  }
  // and it is not rejecting everything: a long verbatim run from a DIFFERENT
  // page, which nothing in ui/manual-reminders.json quotes
  assert.equal(rebuild('Tokens are temporary cards that are created directly into play.').ok, true,
    'the rebuild cannot find plain manual prose — it is broken, and every check above is vacuous');
});

/* ════════════════════════════════════════════════════════════════════════
 * 2. THE EXTRACTION RULE, machine-checked
 * ════════════════════════════════════════════════════════════════════════
 *
 * ui/manual-reminders.json states one rule for what may go in it: a contiguous
 * run of prose under a HEADING THAT NAMES THE TERM. Without that rule the file
 * degenerates into a second authored table assembled out of the manual's own
 * words, which is the thing report #118 is complaining about with extra steps.
 * So the rule is asserted rather than promised.
 */

test('R252: every quoted row sits under a manual heading that names its term', () => {
  const bad: string[] = [];
  for (const [term, m] of MANUAL_REMINDERS) {
    if (!new RegExp(`\\b${term}S?\\b`, 'i').test(m.heading)) {
      bad.push(`{${term}}: heading "${m.heading}" does not name the term. A section that is ABOUT `
        + `something else is a sentence somebody chose, not a definition the manual gives.`);
    }
    if (!new RegExp(`\\b${m.heading.split(/\s+/)[0]}\\b`).test(MANUAL)) {
      bad.push(`{${term}}: heading "${m.heading}" is not in the manual at all`);
    }
    assert.ok(m.page > 0 && m.page < 60, `{${term}}: page ${m.page} is not a page of this manual`);
    assert.ok(m.section.length > 3, `{${term}}: needs a section a reader can navigate to`);
  }
  assert.deepEqual(bad, [], `\n  ${bad.join('\n  ')}\n`);
});

test('POSITIVE CONTROL: the heading rule rejects the two rows that were left out', () => {
  // {Unstable} is defined under PERMADEATH and {Graft}'s own section lead has
  // two symbol glyphs that drop out of extraction. Both were read, both were
  // rejected, and the rule that rejected them has to still do so.
  const names = (heading: string, term: string): boolean =>
    new RegExp(`\\b${term}S?\\b`, 'i').test(heading);
  assert.equal(names('PERMADEATH', 'Unstable'), false,
    'the heading rule would now admit the PERMADEATH paragraph, which defines only the modded '
    + 'route and would tell a player that Aberrant Statweaver does not have the attribute it prints');
  assert.equal(names('AUGMENT', 'Augment'), true, 'and it must still admit the rows that are in');
  // {Graft}: the sentence as extraction leaves it. Its two symbol glyphs are
  // simply gone, so what is left says "denoted by the      or      symbol" —
  // which reads, on a screen, as a sentence with a word missing.
  assert.equal(rebuild(
    'The graft mechanic in Algomancy, denoted by the or symbol on a card, is a modification '
    + 'that allows for the combination of multiple effects into a single cause').ok, true,
  'if the manual now extracts the graft symbols, {Graft} has become quotable — read it and add '
  + 'the row rather than leaving this comment describing a problem that is fixed');
});

/* ════════════════════════════════════════════════════════════════════════
 * 3. PRECEDENCE, and the citation that admits which channel spoke
 * ════════════════════════════════════════════════════════════════════════ */

test('R252: printed beats manual, and no row is claimed by both channels', () => {
  const both = [...MANUAL_REMINDERS.keys()].filter(t => PRINTED_REMINDERS.has(t));
  assert.deepEqual(both, [],
    'a card now prints a reminder for a term this file quotes the manual for. That is not a '
    + 'failure — the printed sentence wins and `asShown` already prefers it — but the manual row '
    + 'is now dead weight claiming to be the source, so delete it from ui/manual-reminders.json.');
});

test('R252: a row cites Manual exactly when the manual supplied its sentence', () => {
  // both directions, mirroring 177's rule for `printed`: a citation nobody
  // checks is worse than none, because it reads as checked.
  const claims = GLOSSARY.filter(e => (e.ruling ?? []).includes('Manual')).map(e => e.term).sort();
  assert.deepEqual(claims, [...MANUAL_REMINDERS.keys()].sort(),
    'the rows citing the Manual and the rows quoting it must be the same rows');
});

/* ════════════════════════════════════════════════════════════════════════
 * 4. THE SWAP: the player reads the manual, the repo keeps its rule
 * ════════════════════════════════════════════════════════════════════════
 *
 * The R248 invariant, applied to the second channel. 177 §7 owns the general
 * form; this is the same assertion stated over the manual so that a failure
 * names the manual, and so that the owner's two examples are pinned by name.
 */

test('R252: every manual row shows the manual sentence and keeps its own rule', () => {
  const authored = new Map(AUTHORED_GLOSSARY.map(e => [e.term, e.text]));
  const bad: string[] = [];
  for (const [term, m] of MANUAL_REMINDERS) {
    const e = GLOSSARY.find(g => g.term === term);
    if (!e) { bad.push(`{${term}}: quoted from the manual but there is no glossary row`); continue; }
    if (e.text !== m.text) bad.push(`{${term}}: shows "${e.text}", manual says "${m.text}"`);
    if (e.rule !== authored.get(term)) {
      bad.push(`{${term}}: the authored rule did not survive onto \`rule\` — shortening what a `
        + 'player reads may never be the same edit as deleting a rule');
    }
    if (!e.manualOn?.includes(m.heading)) bad.push(`{${term}}: manualOn does not cite ${m.heading}`);
    if (e.printedOn !== undefined) bad.push(`{${term}}: printedOn is set on a manual row`);
  }
  assert.deepEqual(bad, [], `\n  ${bad.join('\n  ')}\n`);
});

test('R252: the two rows report #118 names read as the game words them', () => {
  // the report, end to end. Aetherflux Golem is a {Virus} unit with an
  // [Augment] line, so its panel draws exactly these two rows.
  const virus = GLOSSARY.find(e => e.term === 'Virus')!;
  assert.equal(virus.text, 'Virus cards can also be applied as augments from your hand during battle.');
  assert.match(virus.rule ?? '', /enemy/i, 'R157: a virus may be augmented onto an enemy unit');
  assert.match(virus.rule ?? '', /hand/i, 'R95: and only out of your hand');

  const augment = GLOSSARY.find(e => e.term === 'Augment')!;
  assert.match(augment.text, /^The Augment mechanic allows players to take all of the text/);
  assert.match(augment.rule ?? '', /deployment/i, 'R206: modding is a deployment action');
  assert.match(augment.rule ?? '', /spell token/i, 'R89: your own spell token is a legal host');

  // and neither sentence a player reads carries an R-number. 227 derives this
  // over every row; it is restated here because it is half of what #118 said.
  for (const e of [virus, augment]) assert.doesNotMatch(e.text, /\bR\d+\b/);
});

/* ════════════════════════════════════════════════════════════════════════
 * 5. THE TWENTY-ONE ROWS THE MANUAL DOES NOT DEFINE
 * ════════════════════════════════════════════════════════════════════════
 *
 * The honest size of the second hole, as a number. For these the authored row
 * is still the only statement of the rule this repository has (R206 / CT-80) —
 * R184 was decided by reading one of them — so they are NOT candidates for
 * shortening, and a future round that wants to shorten one has to move a pin
 * here first and say why.
 */

/** how many times each undefined term occurs in the manual, at all. Fourteen
 * are zero: the manual predates the Light & Dark zones ({Rot}, {Debt},
 * {Cache}, {Prophecy}, {Glimpse}) and never names most of the attributes. The
 * seven non-zero ones were each read and rejected — see the table below. */
const OCCURRENCES: Readonly<Record<string, number>> = {
  // attributes the manual never names at all
  Evasive: 0, Alluring: 0, Vulnerable: 0, Feeble: 0, Resonant: 0, Thieving: 0,
  Reaping: 0, Unaware: 0,
  // zones and mechanics that postdate it, or that it has no word for
  Rot: 0, Debt: 0, Cache: 0, Prophecy: 0, Glimpse: 0, Trash: 0,
  // present, but not quotable:
  Sneaky: 1,      // once, as flavour prose about the Water element
  Tough: 8,       // only as a worked example, in the Q&A stat-layer answer
  Unstable: 4,    // defined under PERMADEATH, which does not name it (§2 control)
  Graft: 20,      // its own section, whose lead sentence loses two glyphs (§2)
  Once: 20,       // ordinary English throughout; the bounded MARKER is never defined
  Recycle: 3,     // only ever the parenthetical "(put on the bottom of the deck)"
  Prismite: 1,    // named in setup; the affinity-for-every-element rule is not stated
};

test('R252: the rows no channel speaks for are pinned, and so is what the manual does say', () => {
  const silent = AUTHORED_GLOSSARY.map(e => e.term)
    .filter(t => !PRINTED_REMINDERS.has(t) && !MANUAL_REMINDERS.has(t));
  assert.deepEqual(silent.slice().sort(), Object.keys(OCCURRENCES).sort(),
    'the set of rows with neither a printed nor a manual reminder has changed. If it SHRANK, a '
    + 'row found a source and the pin below should go with it; if it GREW, a row lost one.');

  // the anti-"the scrape read less than it should" control. A count that moves
  // means the manual changed under us — a re-extraction, a new edition — and
  // every judgement in ui/manual-reminders.json was made against the old one.
  const now: Record<string, number> = {};
  for (const t of silent) now[t] = (MANUAL.match(new RegExp(`\\b${t}\\b`, 'gi')) ?? []).length;
  assert.deepEqual(now, OCCURRENCES,
    'the manual mentions one of these terms a different number of times than when the extraction '
    + 'was reviewed. Re-read the new occurrences before assuming the row is still unquotable.');

  // and the sweep is not vacuous
  assert.equal(silent.length, 21);
  assert.ok(GLOSSARY.filter(e => e.rule === undefined).length === 21,
    'a row with no reminder in either channel must carry no `rule`, because nothing displaced it');
});

test('R252: the manual has no per-attribute glossary, which is WHY the hole is this size', () => {
  // The reason fourteen of those counts are zero is structural, not accidental:
  // the manual defines attributes by pointing at the cards. If that sentence
  // ever stops being true, the whole judgement in ui/manual-reminders.json is
  // worth re-making, so it is asserted rather than remembered.
  assert.equal(rebuild(
    'Some units have attributes, which can modify how they engage in combat. These cards have a '
    + 'reminder text in italics to help players remember what each attribute does.').ok, true,
  'the manual no longer delegates attribute reminders to the cards (p.24). Re-read the '
  + 'Attributes section — it may now define them, in which case rows can move out of §5.');
});
