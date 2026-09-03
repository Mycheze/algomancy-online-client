/* R215 — A RULING NUMBER CITED IN CODE MUST RESOLVE TO A RULING.
 *
 * `docs/digital-rules.md` is the register: one `## R<n>` section per ruling,
 * and the rest of the repository cites those numbers constantly — in comments,
 * in test names, in `card-todo.ts` entries, in the other docs. A citation is
 * how a reader gets from "why is this line like this" to the reasoning.
 *
 * ── WHAT WENT WRONG ───────────────────────────────────────────────────
 *
 * Nothing checked that a cited number resolves, and **twelve did not**. Round
 * 27's own commit message says *"Renumber my two rulings out of collision:
 * R195->R201 (stripCode), R196->R202 (the leak)"* — R202 got a register entry,
 * R201 did not, and it was cited thirteen times across three files. It was
 * found by a person sweeping for something else, a round later.
 *
 * R201 was not the interesting one. **R142 is cited forty times across ten
 * files and has no entry.** So does R134 (32), R141 (18), R135 (15). Those are
 * not typos; they are rulings that were made, implemented, cited, and never
 * written down. The reasoning behind forty citations lives nowhere.
 *
 * ── WHY THIS IS A LEDGER AND NOT AN ALLOWLIST ─────────────────────────
 *
 * CARD-TODO #83 is an open ticket about exactly the failure of prose-reasoned
 * exemption lists — *"an exemption list is a claim about the code, and nothing
 * checks it"* — so this file must not add a tenth one.
 *
 * It does not. `UNREGISTERED` below is a DEBT LEDGER asserted with
 * `deepEqual`, which fails in BOTH directions:
 *
 *   · a NEW ruling number minted without a register entry  → FAILS (the point)
 *   · one of the eleven finally written up                 → FAILS, naming it
 *
 * The second half is what makes it a ledger rather than a blanket. A waiver
 * that gets quietly satisfied and stays on the list forever is CT-68's bug;
 * here, paying the debt down is itself a red test that tells you to delete the
 * row. The count can only go one way without somebody noticing.
 *
 * ⚠ THE ONE RULE FOR EDITING `UNREGISTERED`: you may DELETE a row (because you
 * wrote the ruling up). You may not ADD one. A new number with no entry is the
 * bug this file exists to catch, and adding a row to make the suite green is
 * how it stops working.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, '..', '..');
const REGISTER = join(CLIENT, 'docs', 'digital-rules.md');

/** Directories that hold no source of ours, or hold runtime data. */
const SKIP = new Set(['node_modules', '.git', 'games', 'accounts', 'AlgomancyCards']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|md|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/** Every `## R<n>` (and `## R<n>b`) heading in the register. */
export function registeredRulings(md: string): Set<number> {
  return new Set([...md.matchAll(/^## R(\d+)b?\b/gm)].map(m => Number(m[1])));
}

/** Every `R<n>` cited in a body of text. Bounded to 1..250 so a stray token
 *  like an `R2` in unrelated prose cannot invent a ruling; the register's own
 *  highest number is the ceiling this has to clear. */
export function citedRulings(text: string): number[] {
  return [...text.matchAll(/\bR(\d{1,3})\b/g)]
    .map(m => Number(m[1]))
    .filter(n => n >= 1 && n <= 999);
}

/**
 * ⚠ THE CEILING WAS 250 AND IT SILENTLY SWITCHED THIS FILE OFF FOR SEVENTEEN
 * RULINGS (found by the R261 agent, 2026-08-30).
 *
 * `citedRulings` used to end `.filter(n => n >= 1 && n <= 250)`, and the
 * comment beside it said the ceiling was "the register's own highest number".
 * That stopped being true at R251 — so every citation of R251 through R267,
 * which is the whole of rounds 31, 32 and 33, was dropped before it reached
 * the "a cited number must resolve" check. The guard did not fail; it had
 * nothing left to look at, which is the same shape as the empty-subject-set
 * failure this repo keeps finding (docs/13 §5) and is why a hand-set bound
 * that has to be maintained is a bug even while it is correct.
 *
 * The bound is now 999, which is the most the `\d{1,3}` regex can produce, so
 * there is nothing left to keep in step. A citation ABOVE the register's max
 * is not "out of range" — it is precisely the dangling reference this file
 * exists to catch, and it now lands in the unregistered set like any other.
 *
 * THE DEBT. Eleven numbers cited in the tree with no `## R<n>` section.
 *
 * Each row says what the ruling is ABOUT — reconstructed from its citations,
 * not invented — so that whoever writes the entry has somewhere to start. The
 * `where` is a real citation, checked below to still exist: a ledger row whose
 * own evidence has moved is the stale-waiver bug this file is guarding against.
 *
 * ⚠ R159 IS DIFFERENT AND MUST STAY HERE. It is cited six times and the repo
 * knows it does not exist — `docs/16-divergence-inventory.md` says outright
 * *"There is no R159."* It is a numbering hole that got referenced, not a
 * ruling that went unwritten. Writing an R159 to satisfy this test would be
 * inventing a rule; the row records the hole instead.
 */
const UNREGISTERED: { n: number; about: string; where: string }[] = [
  { n: 134, about: 'a token nobody taught the formatter — the card-text markup class',
    where: 'ui/inspect.ts' },
  { n: 135, about: 'a line never repeats what its own tag already says; {Unstable}',
    where: 'client/docs/12-card-text.md' },
  { n: 136, about: 'the badge strip is ONE line — a card inspector that wraps its attributes '
      + 'onto a second row reads as two separate claims',
    where: 'ui/inspect.ts' },
  { n: 141, about: 'the pool spells the same thing more than one way, and a formatter must not '
      + 'fix them one at a time',
    where: 'ui/cardtext.ts' },
  { n: 142, about: 'none of the formatting markup may ever reach a player — markers are a '
      + 'presentation layer, not card content',
    where: 'client/docs/12-card-text.md' },
  { n: 159, about: 'DOES NOT EXIST — a numbering hole. docs/16-divergence-inventory.md says '
      + '"There is no R159." Do not write one to make this pass',
    where: 'client/docs/16-divergence-inventory.md' },
  { n: 163, about: "the 'targeted' event carries a seat and a kind",
    where: 'client/ui/test/156-reaping-and-formation.test.ts' },
  { n: 175, about: 'playtest report #15 refiled against its real cause — pending-trigger '
      + 'visibility',
    where: 'engine/test/148-pending-trigger-visibility.test.ts' },
  { n: 176, about: 'a sweep that cannot fail is worse than no sweep',
    where: 'client/server/test/173-look-at-a-hand.test.ts' },
  { n: 177, about: 'card REGISTRATION ORDER is part of the game\'s determinism',
    where: 'engine/test/150-registration-order.test.ts' },
  { n: 186, about: 'the replay tool must REFUSE a file it cannot faithfully reproduce',
    where: 'server/test-forensics.ts' },
];

/* ══ §1 · THE SCAN CAN SEE ════════════════════════════════════════════ */

test('R215 §1: the register scan and the citation scan both find something', () => {
  // docs/13-assessment.md §7.4: every observation channel needs a positive
  // control. A register scan that matches nothing reports "no gaps" — the
  // most flattering possible answer — and so does a citation scan that
  // matches nothing.
  const md = readFileSync(REGISTER, 'utf8');
  const reg = registeredRulings(md);
  assert.ok(reg.size > 150,
    `only ${reg.size} rulings found in the register — the heading pattern has drifted, and this `
    + 'whole file is measuring nothing');
  assert.ok(reg.has(202), 'R202 is a known ruling; if the scan cannot see it, it can see nothing');
  assert.ok(reg.has(197), 'R197 must survive the R197b sibling — the `b?` in the pattern is load-bearing');
});

test('R215 §1: the scans can go red — synthetic inputs, both directions', () => {
  assert.deepEqual(citedRulings('this follows R42 and also R7.'), [42, 7]);
  assert.deepEqual(citedRulings('no rulings here at all'), [],
    'the citation scan must be capable of finding nothing, or "no new gaps" means nothing');
  assert.deepEqual(citedRulings('R1234 is out of range, R0 too'), [],
    'a four-digit token is not a ruling number and neither is R0');
  assert.equal(registeredRulings('## R99 — a thing\n## R100b — another\n').size, 2,
    'the register scan must read a `b` suffix as the same number, not a different one');
});

/* ══ §2 · THE LEDGER ══════════════════════════════════════════════════ */

test('R215 §2: every R-number cited in the tree resolves to a register entry, or is on the ledger', () => {
  const md = readFileSync(REGISTER, 'utf8');
  const registered = registeredRulings(md);

  const citedIn = new Map<number, Set<string>>();
  for (const file of walk(CLIENT)) {
    if (file === REGISTER) continue;
    for (const n of citedRulings(readFileSync(file, 'utf8'))) {
      (citedIn.get(n) ?? citedIn.set(n, new Set()).get(n)!).add(relative(CLIENT, file));
    }
  }

  const gaps = [...citedIn.keys()].filter(n => !registered.has(n)).sort((a, b) => a - b);
  const ledger = UNREGISTERED.map(u => u.n).sort((a, b) => a - b);

  const detail = (n: number): string =>
    `R${n} (cited in ${citedIn.get(n)!.size} file(s), e.g. ${[...citedIn.get(n)!][0]})`;

  assert.deepEqual(gaps, ledger,
    'the set of cited-but-unregistered ruling numbers has changed.\n'
    + `  NEW GAPS (cited, no "## R<n>" section, not on the ledger): ${
      gaps.filter(n => !ledger.includes(n)).map(detail).join(', ') || 'none'}\n`
    + `  PAID OFF (on the ledger but now registered — DELETE the row): ${
      ledger.filter(n => !gaps.includes(n)).map(n => `R${n}`).join(', ') || 'none'}\n`
    + '  A new gap means a ruling number was minted and never written up. Write the "## R<n>" '
    + 'section in docs/digital-rules.md — do NOT add a row to UNREGISTERED to make this pass.');
});

test('R215 §2: every ledger row still points at a file that cites it', () => {
  // The stale-waiver check CT-83 asks of every exemption list: an entry must
  // still resolve to the thing it exempts. A row whose evidence has moved is
  // a claim about the code that has quietly stopped being true.
  for (const { n, where, about } of UNREGISTERED) {
    const p = join(CLIENT, where.replace(/^client\//, ''));
    let text: string;
    try { text = readFileSync(p, 'utf8'); } catch {
      assert.fail(`R${n}'s ledger row points at ${where}, which does not exist. Find a live `
        + `citation and update the row, or delete it if nothing cites R${n} any more.`);
    }
    assert.ok(citedRulings(text).includes(n),
      `R${n}'s ledger row says ${where} cites it, and it does not any more. The row is stale — `
      + `re-point it at a real citation, or if NOTHING cites R${n} now, delete the row (a number `
      + 'nobody cites needs no entry).');
    assert.ok(about.length > 30,
      `R${n}'s ledger row must say what the ruling is ABOUT, so whoever writes the entry has a `
      + 'starting point. A row that only says "missing" is a blanket, not a debt.');
  }
});

test('R215 §2: R159 stays a hole — the ledger row is not an instruction to invent one', () => {
  const md = readFileSync(REGISTER, 'utf8');
  assert.ok(!registeredRulings(md).has(159),
    'somebody has written an R159 section. The repo records that there is no R159 '
    + '(docs/16-divergence-inventory.md); a number that was skipped must stay skipped, or every '
    + 'citation of it now points at a rule nobody made.');
});

/* ══ §3 · THE OTHER DIRECTION, FOR INFORMATION ════════════════════════ */

test('R215 §3: a registered ruling nobody cites is reported, not failed', () => {
  // Deliberately NOT an assertion. A ruling can be correct, settled and simply
  // not need a code comment anywhere — R15 and R36 are both like this. Failing
  // on it would push people to sprinkle citations to keep a test quiet, which
  // is worse than the thing it measures. Printed so the number is visible.
  const md = readFileSync(REGISTER, 'utf8');
  const registered = registeredRulings(md);
  const cited = new Set<number>();
  for (const file of walk(CLIENT)) {
    if (file === REGISTER) continue;
    for (const n of citedRulings(readFileSync(file, 'utf8'))) cited.add(n);
  }
  const uncited = [...registered].filter(n => !cited.has(n)).sort((a, b) => a - b);
  console.log(`    ${registered.size} rulings registered · ${UNREGISTERED.length} cited with no `
    + `entry (the ledger) · ${uncited.length} registered but never cited`
    + (uncited.length ? `: ${uncited.map(n => `R${n}`).join(', ')}` : ''));
});

test('R215 §3: a ruling gets exactly one `## R<n>` heading, and no other `## ` sits between two rulings', () => {
  // CLAUDE.md's rule, enforced. Five write-ups were pasted in with their own
  // `## ` headings intact — 35 of them, inside R27, R237-R240 and R245 — so any
  // table of contents built from the file listed sub-points as rulings.
  const md = readFileSync(REGISTER, 'utf8');
  const stray = md.split('\n')
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.startsWith('## ') && !/^## R\d+b?\b/.test(l))
    .map(({ l, i }) => `${i + 1}: ${l}`);
  assert.deepEqual(stray, [],
    'these `## ` headings are not rulings — demote them to `###` (a pasted write-up keeps its structure one level down):\n  ' + stray.join('\n  '));
});

test('R215 §4: CLAUDE.md and client/README.md name the register\'s extent, and it is the real one', () => {
  // "R1–R267" sat in both files for twenty-one rulings. Derived now: the
  // highest registered number is what the two sentences must say.
  const max = Math.max(...registeredRulings(readFileSync(REGISTER, 'utf8')));
  for (const rel of ['../CLAUDE.md', 'README.md']) {
    const text = readFileSync(join(CLIENT, rel), 'utf8');
    const m = /R1–R(\d+)/.exec(text);
    assert.ok(m, `${rel} no longer says "R1–R<n>" anywhere`);
    assert.equal(Number(m[1]), max,
      `${rel} says R1–R${m[1]}; the register goes to R${max}. Update the sentence.`);
  }
});
