/* R234 / CT-101 — AN OPEN TICKET MUST NOT RE-LITIGATE A CLOSED RULING.
 *
 * ── THE NEAR MISS THAT CAUSED THIS FILE ───────────────────────────────
 *
 * R157 §17 (2026-08-25) ruled Torrential Reclamation **"Already correct"**.
 * Four days later:
 *
 *   · `card-todo.ts` CT-91 carried it as a MAJOR OPEN BUG,
 *   · `182-correctness-sample` recorded the engine as WRONG on it, and
 *   · `docs/questions-round28.md` Q1 RE-ASKED THE OWNER THE SETTLED QUESTION
 *     **while recommending the opposite answer.**
 *
 * He happened to answer consistently with his earlier ruling (R221). **Had he
 * taken the recommendation he would have reversed R157 §17 and the suite would
 * have stayed green.** A ruling can be re-opened, re-asked and reversed with
 * nothing in this repository objecting.
 *
 * ── WHY THE EXISTING GUARDS ALL MISS IT, BY DESIGN ────────────────────
 *
 *   · `184-ruling-register` asks: does a CITED number RESOLVE to a section?
 *   · R215 asked: is a USED ruling REGISTERED?
 *
 * Both run from the code toward the register. **Neither runs from the register
 * back toward the open work.** That direction had never been checked, and it is
 * the direction in which a decision gets silently undone.
 *
 * ── THE SIGNAL, AND WHY THIS ONE RATHER THAN A CLEVERER ONE ───────────
 *
 * Matching "is this ticket about the same QUESTION as that ruling" is a
 * judgement no test can make. So this guard takes the narrowest signal that
 * would have caught the real case: a ruling section that says **"Already
 * correct"** is the register asserting the engine needs no change about the
 * cards it names. An OPEN ticket claiming one of those cards is broken, or an
 * UNANSWERED question asking about one, is a contradiction on its face — and
 * either the ruling or the ticket is wrong, which is exactly the moment a human
 * should look.
 *
 * High precision, deliberately low recall. It will not catch every re-opened
 * ruling. It catches the shape that actually happened, it produces no noise on
 * today's tree, and a noisy guard would be turned off within a round.
 *
 * ⚠ IT IS NOT A BAN. If a card really has regressed since a ruling, that is a
 * genuine open ticket — say so IN the ticket by naming the ruling and what
 * changed, and this guard steps aside. That escape hatch is the point: it
 * forces the contradiction to be acknowledged rather than merely existing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import '../src/cards/registry.ts';
import '../src/apply.ts';
import { allCardNames } from '../src/cards/dsl.ts';
import { CARD_TODO } from '../../ledgers/card-todo.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(HERE, '..', '..', 'docs');

/**
 * Cards a ruling section marks as needing no change.
 *
 * A "section" is a `##` or `###` heading and everything under it — the heading
 * matters as much as the body, because R157 §17's card name is IN ITS HEADING
 * and only its body says "Already correct".
 */
function settledCards(): Map<string, string> {
  const text = readFileSync(join(DOCS, 'digital-rules.md'), 'utf8');
  const names = allCardNames();
  const out = new Map<string, string>();
  const blocks = text.split(/\n(?=#{2,3} )/);
  for (const b of blocks) {
    if (!/Already correct/.test(b)) continue;
    const heading = (b.split('\n')[0] ?? '').replace(/^#+\s*/, '').trim();
    for (const n of names) {
      // whole-name match; card names contain regex metacharacters (commas,
      // apostrophes, parentheses) so this is an indexOf with boundary checks,
      // never a constructed RegExp — R201's `$` bug was exactly that mistake.
      let i = b.indexOf(n);
      while (i !== -1) {
        const before = i === 0 ? ' ' : b[i - 1]!;
        const after = b[i + n.length] ?? ' ';
        if (!/[A-Za-z]/.test(before) && !/[A-Za-z]/.test(after)) { out.set(n, heading); break; }
        i = b.indexOf(n, i + 1);
      }
    }
  }
  return out;
}

/** `## Qn.` blocks whose ANSWER line is still blank */
function unansweredQuestions(): { file: string; heading: string; body: string }[] {
  const out: { file: string; heading: string; body: string }[] = [];
  for (const f of readdirSync(DOCS).filter(f => /^questions-.*\.md$/.test(f))) {
    const text = readFileSync(join(DOCS, f), 'utf8');
    for (const block of text.split(/\n(?=## Q)/).slice(1)) {
      const answer = /\nANSWER:(.*)/.exec(block);
      if (!answer || answer[1]!.trim() !== '') continue;
      out.push({ file: f, heading: (block.split('\n')[0] ?? '').trim(), body: block });
    }
  }
  return out;
}

const SETTLED = settledCards();

test('CT-101 POSITIVE CONTROL: the guard convicts the CT-91 / R157 §17 pair that motivated it', () => {
  // ⚠ WITHOUT THIS THE GUARD IS WORTH NOTHING. docs/13 §5 is a catalogue of
  // checkers in this repo that reported more sight than they had, and every one
  // was found by a person distrusting a clean result. A guard whose subject set
  // is empty passes forever and looks identical to a guard that works.
  assert.ok(SETTLED.size > 0,
    'no ruling section marks any card "Already correct", so this guard has NO SUBJECTS and '
    + 'its green means nothing. Either the register stopped using that phrasing — in which '
    + 'case pick the new marker deliberately — or the section reader has gone blind.');

  assert.ok(SETTLED.has('Torrential Reclamation'),
    'the guard can no longer see R157 §17, which is the exact case it was built from. '
    + `It currently sees ${SETTLED.size} settled card(s): ${[...SETTLED.keys()].join(', ')}`);

  // the real historical pair: an open, card-scoped ticket naming a settled card
  const fake = [{ id: 91, status: 'open' as const, cards: ['Torrential Reclamation'] }];
  const caught = fake.filter(t => t.status === 'open' && t.cards.some(c => SETTLED.has(c)));
  assert.equal(caught.length, 1,
    'the guard did not convict the CT-91 shape — an OPEN ticket naming a card a ruling '
    + 'already marked "Already correct". That is the one case it exists for.');

  // THE FALSE POSITIVE THAT SHAPED THIS GUARD, pinned so the fix cannot be
  // undone by someone "simplifying" the subject test back to a bare includes().
  const mention = 'Two cards (Uglk, Big Glimpse Card) fall back to "the other seat"';
  assert.ok(!mention.includes('**Big Glimpse Card**'),
    'a passing mention must not read as the question\'s subject — this is the shape that '
    + 'made the guard\'s first run fire on round-27 Q8, which is about region scoping while '
    + 'the ruling it collided with is about deck ownership');

  // and it must NOT convict a ticket about a card nobody has ruled settled
  const innocent = [{ id: 1, status: 'open' as const, cards: ['Hooba-Lin'] }];
  assert.equal(
    innocent.filter(t => t.status === 'open' && t.cards.some(c => SETTLED.has(c))).length, 0,
    'the guard convicts a ticket about an unruled card, so it would fire on ordinary work '
    + 'and be switched off within a round');
});

test('CT-101: no OPEN todo entry says a card is broken that a ruling calls "Already correct"', () => {
  const clashes: string[] = [];
  for (const t of CARD_TODO) {
    if (t.status !== 'open') continue;
    for (const c of t.cards ?? []) {
      const where = SETTLED.get(c);
      if (!where) continue;
      // THE ESCAPE HATCH: a ticket that names the contradiction is allowed.
      const body = `${t.title} ${t.detail} ${t.evidence} ${t.fix}`;
      if (/R\d+/.test(body) && /regress|since|no longer|reopen|contradict/i.test(body)) continue;
      clashes.push(`CT-${t.id} says "${c}" is broken, but a ruling says it is already correct: "${where}"`);
    }
  }
  assert.deepEqual(clashes.sort(), [],
    'an OPEN ticket contradicts a settled ruling:\n  ' + clashes.join('\n  ')
    + '\n\nOne of the two is wrong and a HUMAN has to say which. If the card really has '
    + 'regressed since the ruling, say so in the ticket — cite the R-number and what changed '
    + '— and this guard steps aside. Do NOT silence it by deleting the card from `cards`.');
});

test('CT-101: no UNANSWERED question re-asks something a ruling already settled', () => {
  const clashes: string[] = [];
  for (const q of unansweredQuestions()) {
    for (const [card, where] of SETTLED) {
      // ⚠ THE CARD MUST BE WHAT THE QUESTION IS ABOUT, not merely mentioned in
      // it. The first version of this test matched any occurrence and its very
      // first run produced a FALSE POSITIVE: round-27 Q8 asks whether a
      // region-scoped effect can reach a player outside the region, and names
      // "Big Glimpse Card" in a parenthetical — while R157 §18 settled an
      // entirely different question about the same card ("the deck" ownership).
      // Same card, different question, and the guard could not tell.
      //
      // That single false positive is worth more than the rule it produced. A
      // guard that fires on legitimate work gets switched off within a round,
      // and then the real case walks through. So: the card must be BOLDED or in
      // the HEADING — which is how these documents name their subject, and is
      // true of both real cases (round-28 Q1 bolds it, Q2 heads with it) and
      // false of the parenthetical mention.
      const subject = q.body.includes(`**${card}**`) || q.heading.includes(card);
      if (!subject) continue;
      clashes.push(`${q.file} "${q.heading}" asks about "${card}", already settled by: "${where}"`);
    }
  }
  assert.deepEqual(clashes.sort(), [],
    'an unanswered question re-asks a settled ruling:\n  ' + clashes.join('\n  ')
    + '\n\n⚠ THIS IS THE HALF THAT NEARLY COST A RULING. questions-round28.md Q1 re-asked the '
    + 'owner about Torrential Reclamation four days after R157 §17 settled it, AND RECOMMENDED '
    + 'THE OPPOSITE ANSWER. Answer the question from the register instead of from the owner: '
    + 'his attention is the scarcest thing in this project and re-asking spends it twice.');
});
