/* COMMENT CONFORMANCE — the in-code notes on the card files must not rot.
 *
 * WHY THIS FILE EXISTS (R174)
 *
 * A stale comment in `src/cards/sets/**` is not a tidiness problem. A previous
 * round traced the owner's *"these bugs keep recurring"* complaint almost
 * entirely to stale in-code PARKED notes: a park note is a claim about the
 * engine AS OF THE DAY IT WAS WRITTEN, and several had outlived the primitive
 * they were waiting for. Somebody reads the note, believes the card is
 * blocked, and moves on. The card is live; nobody looks again.
 *
 * The sharpest version is a comment asserting that NOTHING IN THE POOL hits a
 * case. `batch-wood-a.ts`'s Burgeon note said *"No pool combo hits this
 * today"*; it is false (Rampart Guardian is a printed {Tough} unit and a legal
 * Burgeon target), and the bug it was guarding is real and reachable with two
 * cards. A negative claim about the pool is the one comment shape that can
 * make a live defect look unreachable.
 *
 * A comment cannot be unit-tested directly. So this file tests the FACTS the
 * comments assert, wherever a fact is machine-checkable, and nothing else. All
 * four checks are pure text/data properties, so they cost nothing to run and
 * stay true forever.
 *
 *   §1  A `PARKED` heading whose every bullet is already resolved fails.
 *   §2  A "the cost is paid at RESOLUTION" claim on a card that declares a
 *       real `castCost` fails.
 *   §3  A comment asserting a NEGATIVE about the card pool fails unless it
 *       WITHDRAWS itself (R210 — read over the enclosing bullet, as §2 always
 *       has) or is on an allowlist carrying its reason; every allowlisted
 *       reason is re-derived on each run, and the machine-checkable ones are
 *       asserted here against `printed.json`.
 *   §4  A helper in `src/**`, `test/**`, `scripts/**` or `ui/**` with zero
 *       call sites fails (R193/R201 — it used to read `src/cards/sets/**`
 *       alone).
 *
 * ⚠ R210 (CT-83): ALL FOUR SECTIONS' EXEMPTION LISTS NOW HAVE STALENESS TESTS.
 * §4's `DEAD_EXEMPT` got one from R193 after CT-68 caught it waiving two
 * deleted helpers. `PARKED_EXEMPT` (§1), `POOL_CLAIM_ALLOWLIST` (§3) and
 * `NOT_SCANNED` (§4) had none — a `.filter()` each and nothing else — and
 * `POOL_CLAIM_ALLOWLIST[0]` had already gone stale, still calling a fixed bug
 * "KNOWN FALSE … assigned to whoever fixes Burgeon" months after R166 fixed
 * it. An exemption list in the file built to stop claims outliving their
 * reasons is the last place that should happen.
 *
 * ── ON BLINDNESS ────────────────────────────────────────────────────────
 *
 * `stripCode` (test/stripcode.ts) went silently blind for weeks twice, and
 * every sweep resting on it stayed green both times. So §0 MEASURES THE REACH
 * of every scan in this file before any of them runs: how many files were
 * opened, how many card blocks were parsed, how many declarations were seen,
 * and whether any comment text survives into the code view. A check whose
 * population silently collapses fails there instead of passing vacuously.
 *
 * ✔ R193 — THE HOLE THIS HEADER USED TO DESCRIBE IS CLOSED, and saying so is
 * the point of the file. R174 measured `stripCode`'s `st === 'line'` state
 * falling through to the REGEX-LITERAL arm, so a line comment ended at its
 * first `/` and 927 comment lines across the batch files leaked into the code
 * view. `card-todo.ts` has had its own `st === 'line'` branch since R181;
 * 149-strip-code.test.ts pins the behaviour directly, and re-measured on
 * 2026-08-26 the leak over `src/cards/sets/**` is ZERO lines.
 *
 * So `codeView` no longer carries the repair R174 wrote for it. Retiring it
 * was not tidiness: over the WIDER corpus §4 now reads, the repair did real
 * damage. Its step 3 truncated a line at the first `//` `stripCode` had
 * blanked — which is also what a `//` inside a STRING or a REGEX looks like —
 * and that mangles 40 lines across src/ + test/ + ui/, e.g.
 * `71-card-ledger.test.ts:93`'s `.replace(/\/\*[\s\S]*?\*\//g, '')`. Every one
 * of those is a lost call site, i.e. a §4 false positive. An exemption that
 * outlives its cause is this file's own subject; so is a repair.
 *
 * ⚠ AND IT IS BLIND TODAY, IN A THIRD PLACE — measured, not assumed (R193).
 * `stripCode`'s `tpl` state has no notion of `${ … }`, so a NESTED template
 * literal INVERTS STRING/CODE PARITY: the inner opening backtick is read as
 * the outer's closing one, and everything up to the next backtick swaps role.
 *
 *     stripCode('`a ${ x ? `b` : `` } c`')   // the ` b ` arrives as CODE
 *
 * The measured damage on 2026-08-26, over engine/:
 *   · `src/engine.ts` — 12 nested templates, and the leak is confined to
 *     those 10 lines (a nested template re-inverts at its own closing
 *     backtick, so the desync cannot run away in this corpus);
 *   · `ui/main.ts` — 108 of them, 368 leaked lines and 911 lines of real code
 *     blanked. That is why §4 does NOT scan `ui/` (see allSources below), and
 *     it is stated here rather than left as an unexplained gap.
 * `164-sweep-sight.test.ts` plants violations into the swept files and
 * measures what the sweeps actually see, so the bound above is a test rather
 * than a paragraph.
 *
 * `§0 the code view carries no comment text` asserts the code view is clean
 * over the card files, so if `stripCode` grows a fourth hole this goes red
 * instead of quietly shrinking.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCode } from './stripcode.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '..');
const SETS = path.join(ENGINE, 'src', 'cards', 'sets');

/** every card-batch file. `helpers.ts` and `index.ts` are in the directory too
 * and are scanned by §4 (they can hold dead helpers) but carry no card
 * comments, so §1-§3 read the `batch-*` files. */
const ALL_FILES = fs.readdirSync(SETS).filter(f => f.endsWith('.ts')).sort();
const BATCH_FILES = ALL_FILES.filter(f => f.startsWith('batch-'));

const raw = (f: string): string => fs.readFileSync(path.join(SETS, f), 'utf8');

/**
 * A LINE-PRESERVING code view: comments and string literals blanked, real code
 * kept. `stripCode` is the codebase's stripper and does all of the work — this
 * is deliberately a one-line wrapper and NOT a second stripper. Line and column
 * survive, so `file:${i + 1}` in a failure message is the real line.
 *
 * R174 wrapped a two-step repair around this call for `stripCode`'s
 * line-comment early-exit. R181 fixed the stripper itself and R193 measured the
 * repair to be both unnecessary here (zero leaks over the card files) and
 * actively harmful over the wider corpus §4 now reads — see the header.
 */
const codeView = (src: string): string => stripCode(src);

/**
 * A `${ … }` interpolation inside a template literal is CODE, and `stripCode`
 * blanks it along with the rest of the literal. That is fine for a scan that
 * looks for DECLARATIONS (nobody declares a helper inside an interpolation)
 * and wrong for one that counts CALL SITES: `${resHtml(r)}` is a call.
 *
 * Measured on 2026-08-26, this single blind spot was 34 of the 45 helpers the
 * widened §4 reported dead on its first run — `142-static-conformance`'s
 * `continuousOf`, `70-playtest-ledger`'s `REFRESH`, `98-spawn-region`'s
 * `lineOf` and `extract-printed.mjs`'s `PIP`/`COST_WORDS` are all called only
 * from inside a `${ … }`. A sweep whose false-positive rate is 75% does not
 * get run twice, so this is not cosmetic.
 *
 * Restored from the RAW text by brace-matching from each `${`, because that is
 * the one place `stripCode` cannot help. Lines that OPEN with a comment marker
 * are skipped (56 of the tree's 4173 `${` spans sit in prose — `types.ts`
 * documents keys like `` `${seat}:${prefix}` ``), which keeps a comment from
 * resurrecting a dead helper. The residual error is one-directional and small:
 * a `${` in a trailing comment could still count as a use, i.e. this can MISS
 * a dead helper, never invent one.
 */
function interpolations(src: string): string {
  const isComment = src.split('\n').map(L => /^\s*(?:\*|\/\/|\/\*)/.test(L));
  const out: string[] = [];
  let line = 0;
  for (let i = 0; i + 1 < src.length; i++) {
    if (src[i] === '\n') { line++; continue; }
    if (src[i] !== '$' || src[i + 1] !== '{' || isComment[line]) continue;
    let depth = 0, j = i + 1;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    out.push(src.slice(i + 2, j));
  }
  return out.join('\n');
}

/** the view §4 counts CALL SITES over: the code view plus the interpolations
 *  `stripCode` blanked. Not line-preserving, and it does not need to be — it is
 *  only ever `.match`ed for a count. */
const useView = (src: string): string => codeView(src) + '\n' + interpolations(src);

/** printed.json, the source of truth for every pool-wide claim below */
type Printed = { name: string; kind: string; type?: string; attrs?: string[] };
const PRINTED: Printed[] = (() => {
  const j = JSON.parse(fs.readFileSync(path.join(ENGINE, 'src', 'cards', 'printed.json'), 'utf8'));
  return (Array.isArray(j) ? j : Object.values(j)) as Printed[];
})();

// ─────────────────────────── §0 · REACH ───────────────────────────────

/**
 * Parse a file into `card('Name', { … })` blocks paired with the contiguous
 * comment block immediately above them. Brace-matched over the CODE VIEW so a
 * `{` inside a comment or a string cannot desync the span.
 *
 * The NAME comes from the raw line: the code view blanks string literals, so
 * the stripped line reads `card(       , {` and carries no name at all. §0
 * caught this parser silently returning ZERO blocks on its first draft, which
 * is precisely what §0 exists for.
 */
type CardBlock = { file: string; line: number; name: string; comment: string; def: string };
function cardBlocks(f: string): CardBlock[] {
  const lines = raw(f).split('\n');
  const code = codeView(raw(f)).split('\n');
  const out: CardBlock[] = [];
  for (let i = 0; i < code.length; i++) {
    if (!/^card\(/.test(code[i]!)) continue;
    const m = /^card\('([^']+)'/.exec(lines[i]!);
    if (!m) continue;
    let s = i;
    while (s > 0 && /^\s*(?:\/\/|\/\*|\*)/.test(lines[s - 1]!)) s--;
    let depth = 0, e = i;
    for (; e < code.length; e++) {
      for (const ch of code[e]!) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      if (depth === 0 && e >= i) break;
    }
    out.push({
      file: f, line: i + 1, name: m[1]!,
      comment: lines.slice(s, i).join('\n'),
      def: code.slice(i, e + 1).join('\n'),
    });
  }
  return out;
}

const BLOCKS: CardBlock[] = BATCH_FILES.flatMap(cardBlocks);

test('§0 the scans reach the whole card pool — nothing here can pass vacuously', () => {
  // 30 files today (28 batches + helpers + index). A DROP is the blindness
  // signal; a rise is a new batch and only needs the number bumped.
  assert.ok(ALL_FILES.length >= 30,
    `only ${ALL_FILES.length} files in src/cards/sets — the directory scan has gone blind`);
  assert.ok(BATCH_FILES.length >= 28,
    `only ${BATCH_FILES.length} batch-*.ts files — the batch filter has gone blind`);

  // Every card block the parser found must have brace-matched to a real span.
  for (const b of BLOCKS) {
    assert.ok(b.def.trimEnd().endsWith('});') || b.def.trimEnd().endsWith('}'),
      `${b.file}:${b.line} card('${b.name}') — the brace match ran off the end; stripCode may be blind`);
  }

  // EVERY top-level `card('…', …)` line in the batch files must have been
  // parsed. Counted straight off the raw text, so this compares the parser
  // against the ground truth rather than against a remembered number — a
  // desync that swallows ten definitions (which is what the unrepaired
  // stripCode does to batch-hybrids-ld-c.ts and batch-light-a.ts) is caught
  // exactly, not approximately.
  const declared = BATCH_FILES.flatMap(f =>
    raw(f).split('\n').map((L, i) => [f, i + 1, L] as const).filter(([, , L]) => /^card\('/.test(L)));
  assert.equal(BLOCKS.length, declared.length,
    `${declared.length} top-level card() lines exist but only ${BLOCKS.length} were parsed — `
    + 'the code view has gone blind and every check below is looking at less than it thinks');
  assert.ok(BLOCKS.length >= 450,
    `only ${BLOCKS.length} card() blocks in the batch files — expected ~455`);

  // And it must actually be able to SEE a castCost, which is what §2 rests on.
  const withCastCost = BLOCKS.filter(b => /castCost\s*:/.test(b.def));
  assert.ok(withCastCost.length >= 5,
    `only ${withCastCost.length} card blocks show a castCost — §2 would be vacuous`);

  assert.equal(PRINTED.length, 492, 'printed.json is the 492-card pool');
});

test('§0 the code view carries no comment text', () => {
  // The anti-blindness assertion for `codeView` itself. If either half of the
  // repair described in the header stops working — or if `stripCode` grows a
  // third leak — comment prose starts arriving as code, and every scan below
  // begins reading English as TypeScript.
  // Nothing in src/cards/sets/** puts a `//` inside a string literal (measured:
  // zero lines), so the FIRST `//` on a line is always where its comment
  // begins — and everything from there to end of line must be blank in the
  // view. That covers a full-line comment and a trailing one with one rule.
  const leaks: string[] = [];
  for (const f of ALL_FILES) {
    const lines = raw(f).split('\n');
    const code = codeView(raw(f)).split('\n');
    lines.forEach((L, i) => {
      const k = L.indexOf('//');
      const o = code[i] ?? '';
      const tail = k >= 0 ? o.slice(k) : (/^\s*(?:\*|\/\*)/.test(L) ? o : '');
      if (tail.trim() === '') return;
      leaks.push(`${f}:${i + 1}  leaked ${JSON.stringify(tail.trim().slice(0, 60))}`
               + `\n      from: ${L.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(leaks.slice(0, 12), [],
    `${leaks.length} comment line(s) survive into the code view. See this file's header:\n`
    + "`stripCode`'s line-comment state falls through to the regex branch, so a `//`\n"
    + 'comment ends at its first `/`. codeView repairs that; if this is red, the repair\n'
    + 'has stopped matching what stripCode does.\n');
});

// ────────────── §1 · a PARKED heading with nothing parked ──────────────

/**
 * The rot: a `PARKED (needs engine machinery that does not exist yet):`
 * heading under which EVERY bullet already says UN-PARKED / NOT PARKED / LIVE
 * / COMPLETE. The heading is what a reader skims, and it is a lie.
 *
 * A heading is ACQUITTED when it, or its section body, says out loud that
 * nothing is parked — `PARKED: none`, `nothing in this batch is parked`, and
 * the parenthetical form several batches use. That cures the skim, which is
 * the whole harm.
 */
/**
 * A word-boundary matcher for a JS IDENTIFIER, which `\b${name}\b` is not.
 *
 * Two bugs in one, both found on 2026-08-26 by re-enabling the `ui/` scan:
 *
 *  1. **`$` IS A REGEX ANCHOR.** `$` is a perfectly legal identifier character
 *     in JS, and `new RegExp('\\b$app\\b')` reads as "end of input, then the
 *     literal `app`" — it can NEVER match. `ui/main.ts::$app` is used on eight
 *     lines and the sweep reported it dead. Any identifier holding a regex
 *     metacharacter was invisible in the same way.
 *  2. **`\b` IS THE WRONG BOUNDARY FOR `$`.** `$` is not a word character, so
 *     even escaped, `\b\$app\b` fails at the leading edge. `_` happens to work
 *     (it IS a word char), which is why nobody hit this before.
 *
 * A lookaround over the identifier alphabet is right in both directions, and
 * it also stops `foo` matching inside `$foo` or `foo$`.
 */
const identRe = (name: string): RegExp =>
  new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`, 'g');

const RESOLVED = new RegExp([
  // "unparked" / "UN-PARKED" is a verdict word: it cannot occur in this corpus
  // by accident, so it is matched case-INsensitively. batch-light-c.ts writes
  // one of its five as lowercase "fully unparked", and a case-sensitive match
  // missed it — which ACQUITTED that section and made §1 unable to fail on it.
  '[uU][nN]-?[pP][aA][rR][kK][eE][dD]',
  // The rest stay SHOUTY. `\bLIVE\b` case-insensitively matches "live when
  // played normally", which appears in dozens of honest approximation bullets;
  // it would mark them resolved, acquit a genuinely parked section, and turn a
  // real rot green. Same for "complete" and "gone" in ordinary prose.
  'NOT PARKED', '\\bLIVE\\b', '\\bCOMPLETE\\b', 'NO LONGER', 'is REAL', '\\bGONE\\b', 'WORKS as of',
].join('|'));
const DISCLAIMED = /PARKED: none|nothing (?:is |left )?parked|Nothing is parked|no card in this batch is parked|nothing in this batch is parked|none left in this batch/i;

/** heading lines that CLAIM something is parked. `UN-PARKED (…)` and
 * `UNPARKED by R…` headings claim the opposite and are not candidates. */
const isParkedHeading = (L: string): boolean =>
  /^\s*\*\s*(?:⚠\s*)?PARKED\b/.test(L) && !/^\s*\*\s*[-·✔✘]/.test(L);

type Section = { file: string; line: number; head: string; bullets: string[]; body: string };
function parkedSections(f: string): Section[] {
  const lines = raw(f).split('\n');
  const out: Section[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isParkedHeading(lines[i]!)) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const L = lines[j]!;
      if (!/^\s*\*/.test(L) || /^\s*\*\//.test(L)) break;
      if (isParkedHeading(L)) break;
      if (/^\s*\*\s*(?:⚠\s*)?(?:UN-?PARKED|UNPARKED)\b/.test(L) && !/^\s*\*\s*[-·✔✘]/.test(L)) break;
      body.push(L);
    }
    const bullets: string[][] = [];
    for (const L of body) {
      if (/^\s*\*\s*(?:⚠\s*)?[-·✔✘]\s/.test(L)) bullets.push([L]);
      else if (bullets.length && L.trim() !== '*') bullets[bullets.length - 1]!.push(L);
    }
    out.push({
      file: f, line: i + 1, head: lines[i]!.trim(),
      bullets: bullets.map(b => b.join(' ')), body: body.join('\n'),
    });
  }
  return out;
}

/**
 * KNOWN-ROTTEN, held by another agent's worktree in round 26. Each carries the
 * reason it is not fixed here. An entry that no longer matches any section is
 * dead weight and should be deleted, but it does NOT fail the test: these two
 * files are being edited in parallel and a passing fix must not turn this red.
 */
const PARKED_EXEMPT: { file: string; head: string; why: string }[] = [
  {
    file: 'batch-metal-a.ts',
    head: 'PARKED (needs engine primitives that do not exist; subsets',
    why: 'R174: all three bullets beneath are already UN-PARKED. batch-metal-a.ts was '
       + 'held by another agent for the whole of round 26 (see STALE-WORKLIST DEFERRED); '
       + 'retitling it here would have collided on a live worktree.',
  },
  {
    file: 'batch-water-a.ts',
    head: 'PARKED (needs engine primitives that do not exist; subsets',
    why: 'R174: same shape, same round, same reason — every entry beneath says '
       + '"NO LONGER parked", one of them out loud. batch-water-a.ts was held by '
       + 'another agent.',
  },
];

test('§1 no PARKED heading survives every card beneath it being un-parked', () => {
  const sections = BATCH_FILES.flatMap(parkedSections);
  assert.ok(sections.length >= 6,
    `only ${sections.length} PARKED headings found across the batch files — the scan has gone blind`);

  const bad: string[] = [];
  for (const s of sections) {
    if (s.bullets.length === 0) continue;                       // a bare "PARKED: none." line
    if (!s.bullets.every(b => RESOLVED.test(b))) continue;      // something really is parked
    if (DISCLAIMED.test(s.head) || DISCLAIMED.test(s.body)) continue;
    if (PARKED_EXEMPT.some(e => e.file === s.file && s.head.includes(e.head))) continue;
    bad.push(`${s.file}:${s.line}  ${s.head}\n      all ${s.bullets.length} bullets beneath are already resolved`);
  }
  assert.deepEqual(bad, [],
    'A PARKED heading whose every entry has shipped makes a LIVE card look blocked.\n'
    + 'Retitle the heading (UN-PARKED … / PARKED: none.) or say in the section which\n'
    + 'entry is the survivor. Do NOT delete the history beneath it.\n'
    + bad.join('\n'));
});

test('§1 every PARKED_EXEMPT entry still names a heading this sweep flags', () => {
  // R210 (CT-83) — the third list in this file with no staleness test, and the
  // one the ticket did not name. Its own doc comment said "an entry that no
  // longer matches any section is dead weight and should be deleted, but it
  // does NOT fail the test", which was the right call in round 26 (both files
  // were held by other worktrees) and is exactly how a temporary waiver becomes
  // permanent: the sentence describing the cleanup is the only thing that was
  // ever going to do it.
  //
  // ⚠ THE SOFT/HARD SPLIT IS DELIBERATE AND KEPT. An entry that no longer
  // matches ANY heading is still not a hard failure of §1 — a passing fix
  // landing in a parallel worktree must not turn this red for the agent who
  // did not make it. But it is a hard failure HERE, in a test whose only
  // subject is the list, so the cleanup has an owner and a deadline instead of
  // a comment.
  const sections = BATCH_FILES.flatMap(parkedSections);
  const stale: string[] = [];

  for (const e of PARKED_EXEMPT) {
    if (!BATCH_FILES.includes(e.file)) {
      stale.push(`${e.file} is not a batch file the scan reads — delete the entry or fix the `
        + `path. (Was: ${e.why})`);
      continue;
    }
    const matched = sections.filter(s => s.file === e.file && s.head.includes(e.head));
    if (!matched.length) {
      stale.push(`${e.file}: no PARKED heading containing "${e.head}" exists any more — the `
        + `heading was retitled or removed and the exemption waives nothing. Delete it. `
        + `(Was: ${e.why})`);
      continue;
    }
    // and it must still be a heading §1 WOULD flag: every bullet resolved, no
    // disclaimer. Otherwise §1 already lets it through and the entry is dead
    // weight for the other reason.
    const stillFlagged = matched.some(s =>
      s.bullets.length > 0
      && s.bullets.every(b => RESOLVED.test(b))
      && !DISCLAIMED.test(s.head) && !DISCLAIMED.test(s.body));
    if (!stillFlagged) {
      stale.push(`${e.file}: the heading "${e.head}" is no longer one §1 would flag — it has `
        + 'a genuinely parked bullet again, or it now carries a disclaimer. Either way the '
        + `exemption is doing nothing. Delete it. (Was: ${e.why})`);
    }
  }

  assert.deepEqual(stale, [],
    'PARKED_EXEMPT entries that have outlived their reason:\n  ' + stale.join('\n  ')
    + '\n\nThese were written in round 26 as "known-rotten, held by another worktree". '
    + 'The worktrees are gone; the entries are not supposed to outlive them.');

  assert.ok(PARKED_EXEMPT.length >= 2,
    `PARKED_EXEMPT is down to ${PARKED_EXEMPT.length} entries — if a heading really was `
    + 'retitled, lower this floor in the same commit and say which.');
});

// ───────── §2 · "paid at RESOLUTION" over a real declared cost ──────────

/**
 * `castCost` is the bracketed cost slot: whatever it names is chosen and paid
 * in the CAST WINDOW, before the item is respondable. A comment on a card that
 * declares one, saying that same cost is paid at RESOLUTION, is a flat
 * contradiction — and it is the exact shape that made Grox, No Hand Killer and
 * Sacrificial Burst look approximated for months after R49/R64 made them real.
 *
 * ⚠ DELIBERATELY NOT WIDENED TO `cost:`. Auric Ascendant (batch-hybrids-wm-b)
 * declares `cost: { mana: 1 }` AND its comment correctly says "the recall is
 * paid at resolution" — the mana is a real activation cost, the recall half is
 * not. A card can have a mixed cost, so `cost:` proves nothing about which
 * half a sentence is talking about. `castCost` has no such ambiguity. Widening
 * this check produces a false positive on an honest comment, which is worse
 * than the check missing a case.
 */
const RESOLUTION_COST_CLAIM = /STILL AT RESOLUTION|(?:paid|checked\/paid|checked and paid)\s+at\s+RESOLUTION/i;
/** the comment is QUOTING the old claim in order to retract it */
const RETRACTED = /used to|USED TO|no longer|NO LONGER|UN-?PARKED|\bGONE\b|this (?:note|entry|line)|it read|✔|retired|overturned|is a real|REAL CAST COST/;

/** does a line START a doc-comment bullet? (`* - …`, `* · …`, `* ⚠ ✔ …`) */
const isBulletStart = (L: string): boolean => /^\s*\*\s*(?:⚠\s*)?[-·✔✘]\s/.test(L);

/**
 * The whole BULLET that line `i` belongs to: that line plus the continuation
 * lines above and below it, stopping at the next bullet marker in either
 * direction.
 *
 * ⚠ R210: THIS IS WHY §3 COULD NOT SEE A RETRACTION. §2 has read retractions
 * at bullet granularity since it was written, because the claim and the words
 * that withdraw it are almost never on the same LINE — a bullet opens "BURGEON:
 * NO LONGER an approximation (R166), and the note that used to sit here was
 * false…" and the sentence being quoted lands four lines further down. §3
 * matched line by line, so it saw the quoted claim and none of the retraction
 * around it, and the only way to silence it was an allowlist entry. Lifted out
 * of §2 verbatim so both sections read a comment the same way.
 */
function enclosingBullet(lines: string[], i: number): string {
  let s = i;
  while (s > 0 && /^\s*\*/.test(lines[s - 1]!) && !isBulletStart(lines[s]!)) s--;
  let e = i;
  while (e + 1 < lines.length && /^\s*\*/.test(lines[e + 1]!) && !isBulletStart(lines[e + 1]!)) e++;
  return lines.slice(s, e + 1).join('\n');
}

test('§2 no card declaring a castCost is documented as paying it at resolution', () => {
  const bad: string[] = [];
  for (const b of BLOCKS) {
    if (!/castCost\s*:/.test(b.def)) continue;
    if (!RESOLUTION_COST_CLAIM.test(b.comment)) continue;
    if (RETRACTED.test(b.comment)) continue;
    bad.push(`${b.file}:${b.line}  card('${b.name}') declares a castCost, and its own comment `
           + 'says the cost is paid at RESOLUTION');
  }

  // The same claim can sit in a FILE HEADER bullet naming the card. Bind a
  // header bullet to any card defined in that same file whose name it mentions.
  for (const f of BATCH_FILES) {
    const lines = raw(f).split('\n');
    const mine = BLOCKS.filter(b => b.file === f);
    lines.forEach((L, i) => {
      if (!/^\s*\*/.test(L) || !RESOLUTION_COST_CLAIM.test(L)) return;
      const bullet = enclosingBullet(lines, i);       // this line plus its continuations
      if (RETRACTED.test(bullet)) return;
      for (const b of mine) {
        if (!bullet.includes(b.name)) continue;
        if (!/castCost\s*:/.test(b.def)) continue;
        bad.push(`${f}:${i + 1}  header bullet says the cost of '${b.name}' is paid at RESOLUTION, `
               + 'but the card declares a castCost');
      }
    });
  }

  assert.deepEqual(bad, [],
    'A castCost is collected in the CAST WINDOW by definition. A comment saying\n'
    + 'otherwise makes a real, respondable cost look like an approximation.\n'
    + bad.join('\n'));
});

// ────────── §3 · negative claims about the card pool ───────────────────

/**
 * The category that hides real bugs. Every one of these must be on the
 * allowlist WITH ITS REASON, because the reason is the only thing that can be
 * re-checked when the pool grows. Two of the four reasons are asserted against
 * `printed.json` in the test below, so they cannot rot silently.
 */
const NEGATIVE_POOL_CLAIM: RegExp[] = [
  /no pool combo/i,
  /nothing in the (?:set|pool)/i,
  /no (?:such |other )?card in the (?:whole )?(?:pool|set)/i,
  /no other card in the pool/i,
  /nothing else in the pool/i,
  /the only card in the (?:whole )?pool/i,
  /no pool card/i,
  /not a single card/i,
];

/**
 * ⚠ R210 (CT-83) — THIS LIST HAD NO STALENESS TEST, AND ITS FIRST ENTRY HAD
 * ALREADY GONE STALE.
 *
 * Entry [0] said Burgeon's "No pool combo hits this today" was *"KNOWN FALSE
 * … assigned to whoever fixes Burgeon"*. Burgeon was fixed by R166 —
 * `doubleStats` in `sets/helpers.ts`, regression at
 * `140-layers-and-riders.test.ts:245` — and `batch-wood-a.ts` rewrote the
 * comment into a QUOTED RETRACTION that opens "BURGEON: NO LONGER an
 * approximation (R166)" and says out loud "⚠ THE POOL DID HIT THIS, WITH NO
 * COMBO AT ALL". There is no Burgeon ticket. The entry outlived every word of
 * its own reason and nothing could notice, because the only thing referring to
 * this list was a `.filter()`.
 *
 * TWO CHANGES, and the second is the one that matters:
 *
 *  1. §3 now reads a retraction the way §2 always has — over the enclosing
 *     BULLET rather than the line. That acquits `batch-wood-a.ts` on the
 *     comment's own words, so entry [0] is deleted rather than reworded.
 *  2. EVERY REMAINING ENTRY IS RE-DERIVED ON EVERY RUN (the test below). It
 *     must still match a claim that the sweep actually finds and that the
 *     retraction filter does NOT already acquit, and its `basis` has to be
 *     machine-checkable:
 *       · 'retracted' — RETRACTED matches its bullet. Then it is redundant and
 *         is REPORTED AS SUCH, because a redundant waiver is how a list starts
 *         growing again.
 *       · 'verified' — it carries a `check` that re-runs the verification
 *         against `printed.json`, and the test runs it. Not a sentence saying
 *         somebody verified it once.
 *
 * Deliberately NOT the `SILENT_KNOWN` shape (65-effect-conformance), which
 * asserts `why.length > 40`. A stale reason is still a long reason.
 */
type PoolClaim = {
  file: string;
  text: string;
  basis: 'verified' | 'retracted';
  why: string;
  /** required when basis is 'verified': re-run the check, throw if it fails */
  check?: () => void;
};

const POOL_CLAIM_ALLOWLIST: PoolClaim[] = [
  {
    file: 'batch-dark-c.ts', text: 'the only card in the whole pool with a',
    basis: 'verified',
    why: 'PAST TENSE and self-limiting: "Rotling WAS the only card in the whole pool with a '
       + '[Switch]-marked EFFECT and no `graftEffect`". R124 gave Rotling a graftEffect, '
       + 'which is what puts the sentence in the past — so the thing to re-check is not the '
       + 'pool-wide search (it is history) but that Rotling still HAS one. If it loses it, '
       + 'the sentence silently becomes a live and unverified pool-wide negative again.\n'
       + '⚠ R210: this entry read `basis: retracted` for about ten minutes and the staleness '
       + 'test below immediately said no — RETRACTED reads `*`-doc bullets and this claim is '
       + 'in a `//` block, so the retraction filter never sees it. That is the difference '
       + 'between a reason and a checked reason, on the first run.',
    check: () => {
      const rotling = BLOCKS.find(b => b.file === 'batch-dark-c.ts' && b.name === 'Rotling');
      assert.ok(rotling, 'batch-dark-c.ts no longer defines Rotling — the note above is orphaned');
      assert.match(rotling!.def, /graftEffect\s*:/,
        "Rotling has lost its `graftEffect`. batch-dark-c.ts's note says it WAS the only card "
        + 'in the pool with a [Switch]-marked effect and no graft — put in the past tense by '
        + 'R124 giving it one. Without that, the sentence is a live pool-wide negative that '
        + 'nobody has checked, and the [Switch1] marker is dead text again (R125).');
    },
  },
  {
    file: 'batch-light-a.ts', text: 'the only card in the whole pool that does',
    basis: 'verified',
    why: 'A QUOTED RETRACTION that is ALSO checkable: the line quotes the old note in '
       + 'order to close it (R157 §25), and the thing it claims — that no card carries '
       + '{Switch} on its type line — is a fact about printed.json.',
    check: () => {
      // batch-light-a.ts, Arbiter of Armistice: "the only card in the whole pool
      // that [carries a bare {Switch} on its type line]" — closed by R157 §25 and
      // stripped from the data by extract-printed.mjs's TYPE_OVERRIDES.
      const switchTyped = PRINTED.filter(c => /Switch/i.test(c.type ?? '')).map(c => c.name);
      assert.deepEqual(switchTyped, [],
        'a card carries {Switch} on its type line again — batch-light-a.ts\'s '
        + 'CLOSED-by-R157-§25 note and extract-printed.mjs\'s TYPE_OVERRIDES both need re-reading');
    },
  },
  {
    file: 'batch-metal-c.ts', text: 'no pool card answers neither',
    basis: 'verified',
    why: 'Void Memory (R284): the caster declares "unit" or "spell", and the claim the note '
       + 'still makes is that the two halves TOGETHER cover the pool — so every card in a '
       + 'hand answers at least one of them, and "reveal instead" can only ever mean "you '
       + 'hold none of the declared type", never "the pool has a card that is neither".',
    check: () => {
      // batch-metal-c.ts, Void Memory: the two halves cover the pool between
      // them. A spellUnit's printed type line reads "… Spell Unit", so it
      // answers BOTH halves; a spellToken's reads "Spell Token", so even one
      // somehow in hand answers the 'spell' half.
      const kinds = new Set(PRINTED.map(c => c.kind));
      assert.deepEqual([...kinds].sort(), ['spell', 'spellToken', 'spellUnit', 'unit'],
        'a new card KIND exists — Void Memory\'s "unit or spell" note in batch-metal-c.ts '
        + 'is no longer exhaustive and must be re-derived');
      for (const c of PRINTED.filter(x => x.kind === 'spellToken')) {
        assert.match(c.type ?? '', /Spell/,
          `${c.name} is a spellToken whose type line does not say "Spell" — Void Memory's note breaks`);
      }
      for (const c of PRINTED.filter(x => x.kind === 'spellUnit')) {
        assert.match(c.type ?? '', /Spell Unit/,
          `${c.name} is a spellUnit whose type line does not read "Spell Unit" — Void Memory's `
          + 'permissive reading (it answers both halves) loses its printed basis');
      }
    },
  },
];

/** every negative pool claim the comment scan finds, with the bullet it sits in */
function poolClaimHits(): { file: string; line: number; text: string; bullet: string }[] {
  const out: { file: string; line: number; text: string; bullet: string }[] = [];
  for (const f of BATCH_FILES) {
    const lines = raw(f).split('\n');
    lines.forEach((L, i) => {
      if (!/^\s*(?:\*|\/\/)/.test(L)) return;
      if (!NEGATIVE_POOL_CLAIM.some(r => r.test(L))) return;
      out.push({ file: f, line: i + 1, text: L.trim(), bullet: enclosingBullet(lines, i) });
    });
  }
  return out;
}

test('§3 every negative claim about the card pool is allowlisted with its reason', () => {
  const hits = poolClaimHits();
  assert.ok(hits.length >= 4,
    `only ${hits.length} negative pool claims found — the comment scan has gone blind`);

  const bad = hits
    // R210: a comment that QUOTES a pool-wide negative in order to withdraw it is
    // not asserting it. §2 has read retractions this way since it was written.
    .filter(h => !RETRACTED.test(h.bullet))
    .filter(h => !POOL_CLAIM_ALLOWLIST.some(a => a.file === h.file && h.text.includes(a.text)))
    .map(h => `${h.file}:${h.line}  ${h.text}`);

  assert.deepEqual(bad, [],
    '"Nothing in the pool hits this" is the comment shape that leaves real defects\n'
    + 'alone. Burgeon\'s copy of it was FALSE and was hiding a two-card bug. Verify the\n'
    + 'claim against printed.json and add it to POOL_CLAIM_ALLOWLIST with the reason,\n'
    + 'or rewrite the comment so it does not assert a pool-wide negative.\n'
    + bad.join('\n'));
});

test('§3 every POOL_CLAIM_ALLOWLIST entry still waives a live claim, and its basis holds', () => {
  // CT-83's assertion, on the list CT-83 named. An allowlist entry is a claim
  // about a COMMENT and a claim about the POOL, and both go stale.
  const hits = poolClaimHits();
  const stale: string[] = [];

  for (const a of POOL_CLAIM_ALLOWLIST) {
    assert.ok(BATCH_FILES.includes(a.file),
      `POOL_CLAIM_ALLOWLIST names ${a.file}, which is not a batch file the scan reads — `
      + `delete the entry or fix the path. (Was: ${a.why})`);

    const matched = hits.filter(h => h.file === a.file && h.text.includes(a.text));
    if (!matched.length) {
      stale.push(`${a.file}: no comment matching "${a.text}" is found by the pool-claim scan any `
        + `more — the entry waives nothing. Delete it. (Was: ${a.why})`);
      continue;
    }

    const retracted = matched.every(h => RETRACTED.test(h.bullet));
    if (a.basis === 'retracted' && !retracted) {
      stale.push(`${a.file}: basis is 'retracted', but the bullet around "${a.text}" no longer `
        + 'reads as a withdrawal. Either the comment was rewritten into a live assertion — in '
        + 'which case verify it against printed.json and change the basis — or RETRACTED has '
        + `stopped matching it. (Was: ${a.why})`);
    }
    if (a.basis === 'verified') {
      // collected, not thrown: one broken entry must not hide the others
      if (!a.check) {
        stale.push(`${a.file}: basis is 'verified' but the entry carries no \`check\`. `
          + '"Verified" in prose is exactly what CT-83 is about — a claim nothing re-runs.');
        continue;
      }
      a.check();
      if (retracted) {
        stale.push(`${a.file}: the comment around "${a.text}" now retracts itself, so §3 acquits `
          + 'it without this entry and the entry is dead weight. Delete it (keep the `check` if '
          + `it is worth having, as a test of its own). (Was: ${a.why})`);
      }
    }
  }

  assert.deepEqual(stale, [],
    'POOL_CLAIM_ALLOWLIST entries that have outlived their reason:\n  ' + stale.join('\n  '));

  // the denominator: an emptied list would make every loop above vacuous
  assert.ok(POOL_CLAIM_ALLOWLIST.length >= 3,
    `POOL_CLAIM_ALLOWLIST is down to ${POOL_CLAIM_ALLOWLIST.length} entries — if that is a `
    + 'deliberate deletion lower this floor in the same commit, and say which claim went.');
});

test('§3 the allowlisted pool claims that CAN be checked are checked', () => {
  // R210: these two checks used to live HERE, as loose code beside a list that
  // did not know about them — so an entry could be deleted and leave its check
  // behind, or gain a "verified below" reason with nothing below. They now hang
  // off the entries they verify (`check`), and this runs them.
  const verified = POOL_CLAIM_ALLOWLIST.filter(a => a.basis === 'verified');
  assert.ok(verified.length >= 2,
    `only ${verified.length} allowlisted pool claims are machine-verifiable — if one was `
    + 'downgraded to \'retracted\' or deleted, lower this floor deliberately and say why');
  for (const a of verified) {
    assert.ok(a.check, `${a.file}: 'verified' with no check`);
    a.check!();
  }
});

// ──────────────────── §4 · helpers with zero call sites ────────────────────

/**
 * `payLife` sat in `batch-light-a.ts` with a doc comment saying it paid life
 * "as a COST at resolution (header note)" and ZERO call sites, long after all
 * three life-cost cards moved to real R49/R64 `castCost` costs. A dead function
 * is the most confident wrong statement a file can make about how its cards
 * work, and it reads exactly like documentation.
 *
 * ⚠ THIS SWEEP AND `noUnusedLocals` ARE COMPLEMENTARY, AND NEITHER SUBSUMES
 * THE OTHER. `tsconfig.json` grew `noUnusedLocals` in R181, which is what makes
 * the next unexported dead local a compile error — that is how
 * `28-metal-c::constructedTurn` and `36-cache-prophecy::cacheIdx` were caught.
 * But **`tsc` does not report an EXPORTED declaration**, no matter how dead, so
 * it would never have seen `helpers.ts::lifeGainedIn`, and it did not see
 * `src/cards/dsl.ts::printedCost` — which R193 found here, R210 deleted, and
 * `tsc` was clean over on both days. Do not "simplify" this away in favour of
 * the compiler flag; the exemption list below going stale is exactly why the
 * distinction has to stay written down.
 * (Also measured, because it looks like a way out and is not: the `_` prefix
 * exempts an unused binding only inside a DESTRUCTURING PATTERN. A plain
 * `const _x = …` and an unused import are still errors.)
 *
 * R193 WIDENED THE DECLARATION SCAN from `src/cards/sets/**` to `src/**`,
 * `test/**` and `scripts/**`. A dead helper in `test/` was outside the old
 * sweep's reach entirely.
 */
/* ui/ is a SIBLING of engine/ since it was lifted out on 2026-08-30, so it is
 * named relatively here and comes back from scanFiles() as `../ui/…`. §4's
 * third check below is what proves the walk still reaches it. */
const SCAN_DIRS = ['src', 'test', 'scripts', path.join('..', 'ui')];

/**
 * ⚠ `ui/` WAS EXCLUDED FOR ONE DAY AND IS SCANNED AGAIN (R201). The exclusion
 * was honest and correctly reasoned — `stripCode` mis-parsed nested template
 * literals, `ui/main.ts` has 108 of them, 911 lines of its real code were
 * blanked, and a scan over `ui/` reported 10 dead helpers of which ALL TEN were
 * false (`saveDeck`, `renderNow`, `blockBuilderHtml` and the rest are called
 * from lines the stripper could not see).
 *
 * R201 taught `stripCode` a `${ … }` brace stack, which is the cause those ten
 * false positives had. THE EXCLUSION IS THEREFORE ITS OWN EXPIRY CONDITION, and
 * the test below is what enforces that it expired: leaving it in place would
 * have been a waiver outliving its reason, which is the exact failure class
 * this whole file exists to prevent — and which its own DEAD_EXEMPT list had
 * just been caught committing.
 *
 * ⚠ R210 (CT-83): "THE TEST BELOW IS WHAT ENFORCES THAT IT EXPIRED" WAS NOT
 * TRUE. There was no such test. `NOT_SCANNED` had exactly two references in
 * the file — this declaration and the `[...SCAN_DIRS, ...NOT_SCANNED]` spread
 * in `allSources()` — and nothing anywhere asserted that `ui/` had come back
 * into `SCAN_DIRS`, that the list was empty, or that a name in it meant
 * anything. A comment describing a guard that does not exist is the same lie
 * as an exemption outliving its reason, and it was sitting in the file whose
 * entire subject is that lie. The test now exists, below.
 */
const NOT_SCANNED: string[] = [];

/**
 * Counting is done over the USE VIEW of every .ts/.mjs in src/, test/, scripts/
 * and ui/, so a name that appears only inside a comment or a string literal
 * does not count as a use — while a name inside a `${ … }` interpolation, which
 * IS a call, does. `helpers.ts::lifeGainedIn`'s last appearance tree-wide was
 * inside a REGEX LITERAL in `96-x-preview.test.ts`, which is not a call, and
 * that is the shape this view exists to see through.
 */
function allSources(): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|mts|mjs|js)$/.test(e.name)) out.push(useView(fs.readFileSync(p, 'utf8')));
    }
  };
  for (const d of [...SCAN_DIRS, ...NOT_SCANNED]) {
    const p = path.join(ENGINE, d);
    if (fs.existsSync(p)) walk(p);
  }
  return out;
}

/** every file whose top-level declarations are swept, as a path relative to
 *  `engine/` — which is also the key `DEAD_EXEMPT` entries are written in. */
function scanFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|mts|mjs|js)$/.test(e.name)) out.push(path.relative(ENGINE, p));
    }
  };
  for (const d of SCAN_DIRS) {
    const p = path.join(ENGINE, d);
    if (fs.existsSync(p)) walk(p);
  }
  return out.sort();
}

const DECL = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*[:=]/;

/** the top-level declarations in one file, as `[name, line]` */
function declarationsIn(rel: string): [string, number][] {
  const out: [string, number][] = [];
  codeView(fs.readFileSync(path.join(ENGINE, rel), 'utf8')).split('\n').forEach((L, i) => {
    const m = DECL.exec(L);
    const name = m?.[1] ?? m?.[2];
    if (name) out.push([name, i + 1]);
  });
  return out;
}

/**
 * Dead helpers that this round could not delete, each with the reason.
 * `file` is a path relative to `engine/`.
 *
 * ⚠ EVERY ENTRY IS ASSERTED TO STILL NAME A REAL DECLARATION (R193). Without
 * that, a waiver survives the code it waives and the list quietly turns back
 * into a blanket — the same failure as a PARKED note outliving its cause,
 * which is the thing this whole file was built to prevent. It had already
 * happened here: R174 wrote entries for `batch-metal-a.ts::tokensInRegion` and
 * `helpers.ts::lifeGainedIn`, R181 DELETED both helpers, and the two entries sat
 * on for a further round waiving nothing at all.
 */
const DEAD_EXEMPT: { file: string; name: string; why: string }[] = [
  // R210 (CT-83): EMPTY, and that is the whole point of the entry that was
  // here. `src/cards/dsl.ts::printedCost` was waived by R193 with an explicit
  // expiry — "deleting it is a one-line change for a quiet tree" — and R210
  // made that deletion, so the waiver goes with it. It is worth saying that
  // this list did its job exactly as designed: the sweep found the function,
  // the waiver named it with a reason and a condition, the staleness test
  // below kept the name honest, and the entry lived one round. That is the
  // shape CT-83 asked the other lists to grow, and it is why `printedCost` was
  // a CLEANUP rather than a discovery — the ticket called it an unseen gap
  // ("outside src/cards/sets so §4 never saw it"), which stopped being true
  // when R193 widened SCAN_DIRS to src/ test/ scripts/ and then ui/.
  //
  // The list stays, empty, with its staleness test — the same way
  // 81-card-drill's SILENT_KNOWN, 90-coverage-census's BIN_PUSH_EXEMPT and
  // 99-endofturn's EXEMPT do. An empty exemption list that is still asserted
  // over is a guard; a deleted one is a hole waiting to be re-dug.
];

// ⚠ THE NAME IS PINNED. CARD-TODO #60's `guards` field names this test by the
// substring 'no card-file helper has zero call sites', and 83-card-todo asserts
// that a real, non-todo test carries it — so dropping those words is a hard
// failure in another file. R193 widened the sweep well past the card files; the
// addition says so without breaking the pin.
test('§4 R210: the R201 ui/ exclusion really did expire, and NOT_SCANNED is honest', () => {
  // The assertion `NOT_SCANNED`'s own comment claimed already existed. Three
  // separate things, because the exclusion could rot in three ways.
  //
  //  1. `ui/` is back in the DECLARATION sweep. This is the R201 expiry
  //     condition itself. A directory can silently drop out of SCAN_DIRS in a
  //     one-word edit and the sweep just reports fewer dead helpers.
  //     (It is `../ui` since the package was lifted out of engine/ on
  //     2026-08-30 — matched by suffix so the next move does not silently
  //     drop it the way a literal 'ui' would have.)
  assert.ok(SCAN_DIRS.some(d => d === 'ui' || d.endsWith(path.sep + 'ui')),
    'ui/ has left SCAN_DIRS, so its 108-template-literal files are back outside the dead-helper '
    + 'sweep. R201 put it back deliberately after teaching stripCode a `${ … }` brace stack; if '
    + 'that is being undone, the ten false positives it fixed are the thing to re-read first.');

  //  2. Every NOT_SCANNED entry names a real directory that is NOT already
  //     swept — an entry naming a swept dir is a no-op pretending to be a
  //     waiver, and one naming nothing is dead weight.
  const stale: string[] = [];
  for (const d of NOT_SCANNED) {
    if (!fs.existsSync(path.join(ENGINE, d))) {
      stale.push(`${d} is in NOT_SCANNED but does not exist under engine/ — delete the entry`);
    } else if (SCAN_DIRS.includes(d)) {
      stale.push(`${d} is in NOT_SCANNED and in SCAN_DIRS — the exclusion expired and the entry `
        + 'is doing nothing but making the sweep look narrower than it is');
    }
  }
  assert.deepEqual(stale, [], 'NOT_SCANNED entries that mean nothing:\n  ' + stale.join('\n  '));

  //  3. And the sweep actually reads ui/ — a directory in the list that the
  //     walk never reaches is the failure the list cannot see.
  const files = scanFiles();
  const uiFiles = files.filter(f => f.startsWith(path.join('..', 'ui') + path.sep));
  assert.ok(uiFiles.length >= 5,
    `SCAN_DIRS names ui/ but the declaration walk found only ${uiFiles.length} files there — `
    + 'the directory is listed and unread, which reports as clean either way');
});

test('§4 no card-file helper has zero call sites — nor (R193) any helper in src/ test/ scripts/', () => {
  const sources = allSources();
  assert.ok(sources.length >= 200,
    `only ${sources.length} source files scanned for call sites — the walk has gone blind`);

  const files = scanFiles();
  assert.ok(files.length >= 190,
    `only ${files.length} files in the declaration scan — the walk has gone blind`);

  let declsSeen = 0;
  let setsDeclsSeen = 0;
  const dead: string[] = [];
  for (const f of files) {
    for (const [name, line] of declarationsIn(f)) {
      declsSeen++;
      if (f.startsWith(path.join('src', 'cards', 'sets'))) setsDeclsSeen++;
      const re = identRe(name);
      let uses = 0;
      for (const s of sources) uses += (s.match(re) ?? []).length;
      if (uses > 1) continue;                                // the declaration itself is 1
      if (DEAD_EXEMPT.some(e => e.file === f && e.name === name)) continue;
      dead.push(`${f}:${line}  ${name} — declared, never called anywhere in `
        + `${SCAN_DIRS.join('/ ')}/ or ui/`);
    }
  }

  // TWO reach floors, not one. The widened scan makes the TOTAL go up by ~1150,
  // and a number going up is not by itself good news — it can hide the original
  // population collapsing to nothing. So the old floor is kept, on the old
  // population, and the new one is additional. Measured 2026-08-26: 1392 total,
  // 231 in src/cards/sets.
  assert.ok(setsDeclsSeen >= 200,
    `only ${setsDeclsSeen} declarations seen in src/cards/sets — the card-file scan has gone `
    + 'blind, whatever the total below says');
  assert.ok(declsSeen >= 1300,
    `only ${declsSeen} declarations seen across ${files.length} files — the scan has gone blind`);

  assert.deepEqual(dead, [],
    'A dead helper carries a doc comment describing machinery nobody uses, which reads\n'
    + 'exactly like a description of how the code works. `noUnusedLocals` catches the\n'
    + 'unexported ones; it CANNOT see an exported declaration, which is what this is for.\n'
    + 'Delete it (leaving a note saying what it was and why it went), or wire it up.\n'
    + dead.join('\n'));
});

test('§4 every DEAD_EXEMPT entry still names a real declaration', () => {
  // The staleness check R174 left out, and the reason CARD-TODO #68 exists. An
  // exemption is a claim about the code AS OF THE DAY IT WAS WRITTEN; unchecked,
  // it outlives the code and nobody finds out.
  const files = new Set(scanFiles());
  for (const e of DEAD_EXEMPT) {
    assert.ok(files.has(e.file),
      `DEAD_EXEMPT waives ${e.file}::${e.name}, but ${e.file} is not a file the scan reads — `
      + `delete the entry or fix the path. (Was: ${e.why})`);
    assert.ok(declarationsIn(e.file).some(([n]) => n === e.name),
      `DEAD_EXEMPT waives ${e.file}::${e.name}, but ${e.file} declares no such thing any more — `
      + `the exemption has done its job, delete it. (Was: ${e.why})`);
  }
});

test('§4 the sweep can see a dead helper — positive control over a synthetic file', () => {
  // §4 answers "no dead helpers" and the honest question about any such answer
  // is whether it could still say that if it were blind. So: run its own two
  // primitives over a corpus built to contain exactly one dead helper, one live
  // one, one whose only call is inside a `${ … }`, and one named only in prose.
  const file = [
    'export function r27LiveHelper(): number { return 1; }',
    'const r27DeadHelper = (): number => 2;',
    'const r27InterpolatedHelper = (): string => "x";',
    'function r27CommentOnlyHelper(): number { return 3; }',
    '// r27CommentOnlyHelper is mentioned here and nowhere else.',
    'export const r27Use = (): string => `${r27InterpolatedHelper()}` + r27LiveHelper();',
    'void r27Use();',
  ].join('\n');
  const corpus = [useView(file)];
  const seen: string[] = [];
  codeView(file).split('\n').forEach(L => {
    const m = DECL.exec(L);
    const name = m?.[1] ?? m?.[2];
    if (!name) return;
    let uses = 0;
    for (const s of corpus) uses += (s.match(identRe(name)) ?? []).length;
    if (uses <= 1) seen.push(name);
  });
  assert.deepEqual(seen.sort(), ['r27CommentOnlyHelper', 'r27DeadHelper'],
    'the §4 predicate no longer separates a dead helper from a live one. Either it stopped '
    + 'seeing declarations (it would report none, and the whole sweep is vacuous) or it '
    + 'stopped seeing call sites (it would report all four, and the sweep is crying wolf). '
    + 'Both have happened to sweeps in this repo; this is the control that says which.');
});
