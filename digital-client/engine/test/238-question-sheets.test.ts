/* R259 — A QUESTION THE OWNER HAS ALREADY ANSWERED MUST NOT STILL READ AS OPEN.
 *
 * ── THE FAILURE THIS FILE COMES FROM ──────────────────────────────────
 *
 * `docs/questions-round31.md` opened, on 2026-08-29, with:
 *
 *     `docs/questions-round27.md` — Q2, Q4, Q6, Q7, Q8 unanswered.
 *
 * **Four of those five were answered the day before.** Q2 by R237, Q5 by R238,
 * Q6 by R240, Q8 by R239 — all on 2026-08-28, all rulings the owner gave, and
 * R237 and R238 each name the question by number in their own first line. What
 * never happened is the boring half: nobody went back to the SHEET and filled in
 * its `ANSWER:` line. So the sheet still had a blank there, and every list built
 * by looking for a blank reported the question open.
 *
 * The cost is the owner's attention, which is the scarcest thing in this
 * project. Round 32's brief opened by naming two questions as the round's
 * blockers; the real number was five, and it took a manual pass over the
 * register to find that out.
 *
 * ── WHY NO EXISTING GUARD CATCHES IT ──────────────────────────────────
 *
 * `202-settled-rulings-not-reopened` exists for the OPPOSITE direction — round
 * 28's Q1 re-asked a settled question and recommended reversing it — and its
 * header states the lesson as *"a question sheet is not proof a thing is
 * unruled"*. This file is the mirror: **a blank answer line is not proof of it
 * either.**
 *
 * 202 structurally cannot see these four. It matches on CARD NAMES appearing in
 * a ruling section marked "Already correct", and all four of these rulings are
 * about MECHANICS — {Deadly} reaching effect damage, a replaced hit still being
 * dealt, region scoping, a type-line transcription error. There is no card to
 * match on. Widening 202 to match mechanics is not available: it would have to
 * decide "is this ruling about the same question as that sheet", which is the
 * judgement its own header says no test can make.
 *
 * ── THE TWO SIGNALS, AND WHY BOTH ─────────────────────────────────────
 *
 * §1 is DERIVED and catches the case with no human in the loop: a ruling that
 * says it answers `questions-round27 Q2` is a machine-readable back-pointer, and
 * the sheet had better agree. It caught two of the four real cases, and it is
 * free forever after.
 *
 * §2 is an INVENTORY, the pattern R246 used for printed Xs: the set of blank
 * answers must equal a list that names each one and says why it is still open.
 * It catches all four — not by cleverness but by making a human look at each
 * blank once. Its second direction is the load-bearing one: when the owner
 * answers something, this file goes RED and names it, which is the moment the
 * sheet gets backfilled.
 *
 * §1 alone would be a guard with two subjects. §2 alone would be a list nobody
 * derives. Together the derived half holds the cases that announce themselves
 * and the inventory holds the rest.
 *
 * ⚠ THE ONE RULE FOR EDITING `OPEN_QUESTIONS`: you may DELETE a row, because the
 * owner answered it and you backfilled the sheet. You may ADD a row only for a
 * question you have just ASKED. Adding a row for a question that has been
 * sitting blank is how this file stops working — that is CT-68's bug and
 * 184-ruling-register's `UNREGISTERED` carries the identical warning.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(HERE, '..', '..', 'docs');
const REGISTER = readFileSync(join(DOCS, 'digital-rules.md'), 'utf8');

interface Question {
  /** e.g. `questions-round27.md` */
  file: string;
  /** the round number, e.g. 27 */
  round: number;
  /** the question number within the sheet, e.g. 2 */
  n: number;
  heading: string;
  /** everything after `ANSWER:` on its line, trimmed */
  answer: string;
  body: string;
}

const SHEETS = (): string[] =>
  readdirSync(DOCS).filter(f => /^questions-round\d+\.md$/.test(f)).sort();

/**
 * Every `## Qn.` section of every sheet, with its answer.
 *
 * ⚠ The split pattern is the same one `202-settled-rulings-not-reopened` uses,
 * deliberately: two readers of these files that disagree about what a question
 * IS would produce two different open lists, which is the failure one directory
 * up. `parses something` below is the positive control on it.
 */
function questions(): Question[] {
  const out: Question[] = [];
  for (const f of SHEETS()) {
    const round = Number(/(\d+)/.exec(f)![1]);
    const text = readFileSync(join(DOCS, f), 'utf8');
    for (const block of text.split(/\n(?=## Q)/).slice(1)) {
      const heading = (block.split('\n')[0] ?? '').trim();
      const n = Number(/^## Q(\d+)/.exec(heading)?.[1] ?? NaN);
      const m = /\nANSWER:(.*)/.exec(block);
      out.push({ file: f, round, n, heading, answer: (m?.[1] ?? '').trim(), body: block });
    }
  }
  return out;
}

/** `{round, n}` for every `questions-roundNN[.md] Qk` back-pointer in the register. */
function backPointers(md: string): { round: number; n: number; where: string }[] {
  const out: { round: number; n: number; where: string }[] = [];
  const re = /questions-round(\d+)(?:\.md)? Q(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const line = md.slice(md.lastIndexOf('\n', m.index) + 1, md.indexOf('\n', m.index));
    out.push({ round: Number(m[1]), n: Number(m[2]), where: line.trim() });
  }
  return out;
}

/** every `## R<n>` / `### R<n>` section number in the register (R197b counts as 197) */
function registered(md: string): Set<number> {
  const out = new Set<number>();
  for (const m of md.matchAll(/^#{2,3} R(\d+)b? /gm)) out.add(Number(m[1]));
  return out;
}

const QUESTIONS = questions();
const REGISTERED = registered(REGISTER);

/* ══ §0 · POSITIVE CONTROLS — every channel here must be able to see ══ */

test('R259 §0: the sheet reader, the back-pointer scan and the register scan all find something', () => {
  // docs/13 §7.4. A reader that matches nothing reports "no blanks", which is
  // the most flattering possible answer and indistinguishable from working.
  assert.ok(SHEETS().length >= 3, `only ${SHEETS().length} question sheets found — the filename pattern has drifted`);
  assert.ok(QUESTIONS.length > 20,
    `only ${QUESTIONS.length} questions parsed out of ${SHEETS().length} sheets — the `
    + '`## Q` split has gone blind and this whole file is measuring nothing');
  assert.ok(QUESTIONS.every(q => Number.isFinite(q.n)),
    'a question heading did not yield a number: '
    + QUESTIONS.filter(q => !Number.isFinite(q.n)).map(q => q.heading).join(' / '));

  assert.ok(backPointers(REGISTER).length >= 2,
    'no ruling in the register says which question it answers. That back-pointer is what §1 '
    + 'runs on, and without it §1 has no subjects.');
  assert.ok(REGISTERED.size > 150, `only ${REGISTERED.size} rulings found — the heading pattern drifted`);
});

test('R259 §0: the scans can go red — synthetic inputs, both directions', () => {
  assert.deepEqual(
    backPointers('*(round 29b. Answers questions-round27 Q2. Two commits changed)*')
      .map(b => [b.round, b.n]),
    [[27, 2]]);
  assert.deepEqual(backPointers('this ruling cites no question sheet at all'), [],
    'the back-pointer scan must be capable of finding nothing');
  assert.deepEqual(
    backPointers('see questions-round28.md Q3 and questions-round31 Q8').map(b => [b.round, b.n]),
    [[28, 3], [31, 8]],
    'both spellings — with and without the .md — must be read, because the register uses both');
});

/* ══ §1 · DERIVED — a ruling that says it answers a question is believed ══ */

test('R259 §1: every question a ruling claims to answer has a non-blank ANSWER on its sheet', () => {
  const byKey = new Map(QUESTIONS.map(q => [`${q.round}/${q.n}`, q]));
  const unbackfilled: string[] = [];
  for (const b of backPointers(REGISTER)) {
    const q = byKey.get(`${b.round}/${b.n}`);
    if (!q) continue;               // a pointer at a sheet or number that does not exist is §3's problem
    if (q.answer !== '') continue;
    unbackfilled.push(`${q.file} ${q.heading} is still blank, but the register says: "${b.where}"`);
  }
  assert.deepEqual([...new Set(unbackfilled)].sort(), [],
    'a ruling says it answered a question and the sheet still shows it open:\n  '
    + unbackfilled.join('\n  ')
    + '\n\n⚠ THIS IS THE EXACT SHAPE THAT HAPPENED. R237 and R238 each open by naming the '
    + 'round-27 question they answer, and both questions sat blank on the sheet for a day, so '
    + 'round 32 opened believing they were still open work. Fill in the ANSWER line with a '
    + 'pointer to the ruling — do not delete the question.');
});

/* ══ §2 · THE INVENTORY — every remaining blank is here, with its reason ══ */

/**
 * Every question that is genuinely still waiting on the owner, and why.
 *
 * ⚠ DELETE a row when he answers it and you backfill the sheet. ADD a row only
 * for a question you just asked. See the header.
 */
const OPEN_QUESTIONS: { round: number; n: number; why: string }[] = [
  { round: 27, n: 4, why: 'a card played mid-resolution carries no source-zone marker, so Proph and Stalwart Sentinel fire for nobody. Re-asked as round-32 Q3.' },
  { round: 27, n: 7, why: 'R157 §23 gives the multiplier formula for TWO Arbiters and explicitly does not rule composition with additive mods. Re-asked as round-32 Q4.' },
  { round: 28, n: 3, why: 'Shoreline Specter offers itself to its own "recall target ally". Re-asked as round-32 Q5.' },
  { round: 31, n: 8, why: 'R3 vs Caleb on damage priority windows. Blocks CT-112 and report #119. Re-asked as round-32 Q1.' },
  { round: 32, n: 1, why: 'R3 vs Caleb on damage priority windows — carried from round-31 Q8.' },
  { round: 32, n: 2, why: 'does "zones follow control" (R250) reach recall/cache/erase, or only the bin?' },
  { round: 32, n: 3, why: 'is a card played mid-resolution "played from your hand"? Carried from round-27 Q4; Proph and Stalwart Sentinel read a blank marker.' },
  { round: 32, n: 4, why: 'three multipliers, 6x or 8x, and which order against an additive mod. Carried from round-27 Q7.' },
  { round: 32, n: 5, why: 'can "recall target ally" pick the card doing the recalling? Carried from round-28 Q3; Shoreline Specter offers itself today.' },
  { round: 32, n: 6, why: 'does "Rot cards do not have rules text" mean the browser never shows the row (fixed this round by CT-129) or that our authored sentence should be replaced by the game words (there are none — the Manual mentions Rot zero times)?' },
  { round: 32, n: 7, why: 'hiding the log (report #131) put CT-55 unused-token announcement behind a click; does it need its own notice like CT-78 glimpse, or a whole toast tier? Blocks CT-134.' },
];

test('R259 §2: the blank answers on every sheet are exactly the inventory, no more and no fewer', () => {
  const blanks = QUESTIONS.filter(q => q.answer === '').map(q => `${q.round}/${q.n}`).sort();
  const listed = OPEN_QUESTIONS.map(o => `${o.round}/${o.n}`).sort();
  assert.deepEqual(blanks, listed,
    'the set of unanswered questions has moved.\n'
    + `  sheets say: ${blanks.join(', ')}\n`
    + `  inventory says: ${listed.join(', ')}\n\n`
    + 'If the owner ANSWERED one: fill in its ANSWER line, then delete its row here — that is '
    + 'the red test telling you to do the backfill, and it is the whole reason this file exists. '
    + 'If you ASKED a new one: add a row saying what it blocks. Never add a row for a question '
    + 'that has been sitting blank; that is how the list stops meaning anything.');
});

test('R259 §2: every inventory row points at a question that exists and says what it blocks', () => {
  const byKey = new Set(QUESTIONS.map(q => `${q.round}/${q.n}`));
  for (const o of OPEN_QUESTIONS) {
    assert.ok(byKey.has(`${o.round}/${o.n}`),
      `the inventory lists round-${o.round} Q${o.n}, which is not on any sheet`);
    assert.ok(o.why.trim().length > 30,
      `round-${o.round} Q${o.n} has no real reason recorded; a one-word reason is a row nobody `
      + 'will be able to judge in a month');
  }
});

/* ══ §3 · AN ANSWER THAT CITES A RULING MUST RESOLVE ══════════════════ */

test('R259 §3: every R-number an ANSWER line cites is a ruling that exists', () => {
  const dangling: string[] = [];
  for (const q of QUESTIONS) {
    for (const m of q.answer.matchAll(/\bR(\d{1,3})b?\b/g)) {
      const n = Number(m[1]);
      if (n === 0) continue;
      if (!REGISTERED.has(n)) dangling.push(`${q.file} ${q.heading} cites R${n}, which has no section`);
    }
  }
  assert.deepEqual(dangling.sort(), [],
    'an answer points at a ruling that does not exist:\n  ' + dangling.join('\n  ')
    + '\n\nAn ANSWER that cites a number is the only trail from the sheet back to the reasoning. '
    + 'A number that does not resolve is R215\'s bug on a surface R215 does not scan.');
});

/* ══ §4 · POSITIVE CONTROLS ON THE GUARDS THEMSELVES ══════════════════ */

test('R259 §4: the guard convicts the HISTORICAL state — round-27 Q2 blank while R237 claims it', () => {
  // ⚠ Reconstructed from what actually shipped, not a fixture built to be
  // caught. R237's first line is `*(2026-08-28, round 29b. Answers
  // questions-round27 Q2. …` and the sheet's line 61 was the bare word
  // `ANSWER:` with nothing after it.
  const sheet = '# s\n\n## Q2. Does a kill rider fire?\n\nsome body\n\nANSWER:\n\n---\n';
  const md = '## R237 — {Deadly} reaches every damage site\n\n'
    + '*(2026-08-28, round 29b. Answers questions-round27 Q2. Two commits changed.)*\n';

  const block = sheet.split(/\n(?=## Q)/)[1]!;
  const answer = (/\nANSWER:(.*)/.exec(block)?.[1] ?? '').trim();
  assert.equal(answer, '', 'the reconstruction is wrong — the historical line was blank');
  assert.deepEqual(backPointers(md).map(b => [b.round, b.n]), [[27, 2]],
    'the back-pointer scan cannot see R237, which is the case this guard was built from');

  // and the two together are exactly what §1 convicts on
  assert.ok(answer === '' && backPointers(md).length === 1,
    '§1 would not have caught the real case');
});

test('R259 §4: the guard does NOT convict a backfilled answer, or ordinary unreferenced work', () => {
  const backfilled = '# s\n\n## Q2. Does a kill rider fire?\n\nbody\n\n'
    + 'ANSWER: **YES** — answered 2026-08-28, recorded as **R237**.\n\n---\n';
  const block = backfilled.split(/\n(?=## Q)/)[1]!;
  assert.notEqual((/\nANSWER:(.*)/.exec(block)?.[1] ?? '').trim(), '',
    'a backfilled answer must read as answered, or this guard fires on the fix it asks for');

  assert.deepEqual(backPointers('## R241 — a card menu carries card things\n\nno sheet named here\n'), [],
    'a ruling that answers nothing on a sheet must produce no subject, or every ordinary '
    + 'ruling becomes a false positive and this file is switched off within a round');
});
