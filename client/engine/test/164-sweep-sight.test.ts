/* SWEEP SIGHT — what would these checkers print if they were BLIND? (R193)
 *
 * WHY THIS FILE EXISTS
 *
 * This repo's most expensive class of defect is not a broken card. It is a
 * VERIFIER THAT IS BLIND AND REPORTS CLEAN. `stripCode` — the primitive every
 * source-reading sweep in `test/` rests on — has gone blind twice:
 *
 *   1. it had no notion of a REGEX LITERAL, so the lone `'` inside the
 *      character class at `src/engine.ts:175` opened a string that ran to the
 *      next quote in the file. Whole-file, that deleted 5128 of engine.ts's
 *      8901 lines, all three of its `bin.push` sites among them — and the bin
 *      sweeps went on saying clean.
 *   2. its `st === 'line'` state had no branch of its own and fell through to
 *      the regex arm, so a LINE COMMENT ENDED AT ITS FIRST SLASH; 927 comment
 *      lines across the card files were handed back as code.
 *
 * Both were found by a person saying *"this says clean and I don't believe
 * it"*. Neither was found by the suite. So this file does the not-believing on
 * a schedule: it PLANTS known violations into an in-memory copy of the files
 * the sweeps read, and asserts the sweeps see N of N.
 *
 * A sweep that reports zero violations is telling you one of two things and
 * the report does not say which: nothing is wrong, or nothing is visible. The
 * measurement is what separates them, and a coverage number going UP is not
 * self-evidently good news — a sweep that has started counting comment text as
 * code also makes numbers go up.
 *
 *   §A  `stripCode`'s third hole, pinned: a NESTED template literal.
 *   §B  the three whole-file sweeps in 90-coverage-census see 8 planted
 *       violations spread the length of engine.ts, and the regexes they were
 *       measured against are still the ones that file runs.
 *   §C  the third hole hides nothing today — an independent oracle and
 *       `stripCode` pick out the same lines, everywhere in `src/`.
 *   §D  the sweeps' populations are not empty.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCode } from '../../ledgers/card-todo.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '..');
const ENGINE_TS = path.join(ENGINE, 'src', 'engine.ts');

// ───────────── §A · the hole stripCode has TODAY ──────────────────────────

/**
 * `stripCode`'s `tpl` state consumes everything up to the next backtick. A
 * template literal may contain `${ … }`, and inside that the language is back
 * in CODE — where another template literal may open. The stripper does not
 * know, so the inner opening backtick reads as the outer's CLOSING one and
 * string/code parity inverts for everything up to the following backtick.
 *
 * ✔ CLOSED THE SAME DAY IT WAS FOUND (R201). This test was written as a
 * CHARACTERISATION of the hole, with instructions to rewrite it as the correct
 * expectation once `card-todo.ts` learned `${ … }` — which is what happened
 * within the hour, and this is that rewrite. The instruction worked exactly as
 * designed: the test failed, said which of the two possible causes it was, and
 * named the follow-up. Keep writing them that way.
 */
test('§A stripCode reads `${ … }` inside a template literal as CODE (R201)', () => {
  const src = 'const a = `x ${ f(`y`) } z`;';
  const out = stripCode(src);
  assert.equal(out.length, src.length, 'stripCode must stay length-preserving');

  // The CORRECT answer, and the one it now gives: `f(` and `)` survive as code;
  // `x `, the inner body `y` and ` z` are blanked as string.
  //
  // Before R201 it returned 'const a =          y       ;' — exactly inverted,
  // `f(` swallowed and the string body `y` promoted to code — because the inner
  // opening backtick was read as the OUTER literal's closing tick.
  assert.equal(out, 'const a =       f(   )     ;',
    'stripCode\'s handling of a nested template literal has changed AGAIN. R201 taught '
    + 'the `tpl` state a `${ … }` brace stack; if this no longer holds, a FOURTH stripper '
    + 'regression is in flight and every sweep in the repo is downstream of it.');

  // and the consequence that mattered: the inner body must NOT come back as code
  const two = 'const a = `x ${ f(`y`) } z`;\nconst b = `p ${ g(`q`) } r`;';
  const stripped = stripCode(two);
  assert.ok(!/\by\b/.test(stripped) && !/\bq\b/.test(stripped),
    'an inner template body handed back as code is the whole hole R201 closed');
  assert.ok(stripped.includes('f(') && stripped.includes('g('),
    'and the code around it must survive — swallowing `f(` was the other half');
});

// ───────────── §B · plant a violation, count what is seen ─────────────────

/**
 * The three whole-file source sweeps in `90-coverage-census.test.ts` and the
 * exact patterns they hunt with. They are copied here ON PURPOSE — this file's
 * job is to be a second opinion — and the copy is PINNED to the original by
 * `§B the patterns measured here are the patterns 90-coverage-census runs`
 * below, so the two cannot drift apart silently.
 */
const SWEEP_PATTERNS: { what: string; re: RegExp }[] = [
  { what: 'R124 bin EXIT', re: /\.bin\.splice\(|\bbin\.splice\(|\[from\]\.splice\(/ },
  { what: 'R145 bin ENTRY', re: /\.bin\.push\(|\bbin\.push\(/ },
  { what: 'R148 control change', re: /[A-Za-z_$][\w$]*\.controller\s*=(?!=)/ },
];

/** one line that trips all three sweeps at once, and contains no quote,
 *  backtick or slash of its own — so planting it cannot perturb the very
 *  parity this file is measuring. */
const VIOLATION = '    if (Date.now() < 0) { const z: any = null; '
  + 'z.bin.push(z); z.bin.splice(0, 1); z.controller = 0; }';

/** statement-looking lines inside a method body, spread the length of the
 *  file, so the plants sit both before and after every nested template. */
function plantSites(lines: string[], want: number): number[] {
  const step = Math.floor(lines.length / (want + 1));
  const out: number[] = [];
  for (let t = step; out.length < want && t < lines.length; t += step) {
    for (let i = t; i < Math.min(t + 400, lines.length); i++) {
      if (/^ {4,}[A-Za-z_$(].*;\s*$/.test(lines[i]!) && !/^\s*\*/.test(lines[i]!)) { out.push(i); break; }
    }
  }
  return out;
}

test('§B a violation planted anywhere in engine.ts is seen by all three whole-file sweeps', () => {
  const lines = fs.readFileSync(ENGINE_TS, 'utf8').split('\n');
  const sites = plantSites(lines, 8);
  assert.equal(sites.length, 8, 'the file has stopped looking like engine.ts — no plant sites found');

  const planted = [...lines];
  // bottom-up, so the earlier indices stay valid
  const at: number[] = [];
  for (const i of [...sites].reverse()) planted.splice(i + 1, 0, VIOLATION);
  for (let n = 0, i = 0; i < planted.length; i++) if (planted[i] === VIOLATION) { at.push(i + 1); n++; }
  assert.equal(at.length, 8, 'the plant did not land');

  const view = stripCode(planted.join('\n')).split('\n');
  for (const { what, re } of SWEEP_PATTERNS) {
    const seen = at.filter(n => re.test(view[n - 1] ?? ''));
    assert.deepEqual(seen, at,
      `${what}: the sweep saw ${seen.length} of ${at.length} planted violations. `
      + `Blind at lines [${at.filter(n => !seen.includes(n)).join(', ')}]. A source-reading `
      + 'sweep that cannot see a violation it is standing on reports "clean" for the same '
      + 'reason it would report "clean" on a healthy file, and nothing downstream can tell '
      + 'the two apart. Find out what the stripper is doing to those lines before trusting '
      + 'any green run of 90-coverage-census.');
  }

  // ✔ AND THE INTERPOLATION IS NO LONGER A HOLE (R201). This block used to
  // assert the opposite — that a bin write or controller assignment inside a
  // `${ … }` was invisible to all three sweeps — and said so out loud rather
  // than hiding it, which is why it took under an hour to close once measured.
  // `${ … }` is code, so a violation written there is read like any other.
  const hidden = stripCode('const s = `${ (e.player(0).bin.push(n), u.controller = 1) }`;');
  for (const { what, re } of SWEEP_PATTERNS.slice(1)) {
    assert.ok(re.test(hidden),
      `${what} can no longer see inside a \`\${ … }\` interpolation. R201 made an `
      + 'interpolation code; if this reddens, that has been undone and a real bypass can '
      + 'hide there again — which is exactly how a live bin.push sat unseen in src/rng.ts.');
  }
});

test('§B the patterns measured here are the patterns 90-coverage-census runs', () => {
  // The copies above are only a second opinion if they are copies. This reads
  // the original's source and asserts each pattern still appears in it, so an
  // edit there cannot leave this file quietly measuring a retired regex.
  const src = fs.readFileSync(path.join(HERE, '90-coverage-census.test.ts'), 'utf8');
  for (const { what, re } of SWEEP_PATTERNS) {
    assert.ok(src.includes(re.source),
      `90-coverage-census.test.ts no longer contains the ${what} pattern /${re.source}/. `
      + 'Update SWEEP_PATTERNS in this file to match, or the sight measurement above is '
      + 'about a sweep that no longer exists.');
  }
});

// ───────────── §C · does the hole hide anything today? ────────────────────

/**
 * An ORACLE — a stripper that knows what `stripCode` does not, and exists only
 * to disagree with it.
 *
 * ⚠ This is a deliberate exception to "one stripper, one place to be wrong".
 * A checker cannot audit itself: measuring `stripCode`'s blind spots with
 * `stripCode` is exactly the move that let two of them live for weeks. The
 * oracle is not used by any sweep and its output is never trusted on its own —
 * only the DISAGREEMENT between the two is reported, and only on the handful
 * of idioms the sweeps actually hunt.
 *
 * The one thing it adds is a `${ … }` stack: on `${` it pushes the template
 * and returns to code; on the matching `}` it pops back into the template.
 */
function oracle(src: string): string {
  type St = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' | 're';
  let out = '', st: St = 'code', prev = '', reClass = false, braceDepth = 0;
  const stack: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!, n = src[i + 1];
    if (st !== 'code') {
      if (c === '\n') { out += '\n'; if (st === 'line' || st === 'sq' || st === 'dq' || st === 're') st = 'code'; continue; }
      out += ' ';
      if (st === 'block') { if (c === '*' && n === '/') { out += ' '; i++; st = 'code'; } }
      else if (st === 'sq') { if (c === '\\') { out += ' '; i++; } else if (c === "'") st = 'code'; }
      else if (st === 'dq') { if (c === '\\') { out += ' '; i++; } else if (c === '"') st = 'code'; }
      else if (st === 'tpl') {
        if (c === '\\') { out += ' '; i++; }
        else if (c === '`') st = 'code';
        else if (c === '$' && n === '{') { out += ' '; i++; stack.push(braceDepth); braceDepth++; st = 'code'; }
      } else if (st === 're') {
        if (c === '\\') { out += ' '; i++; }
        else if (c === '[') reClass = true;
        else if (c === ']') reClass = false;
        else if (c === '/' && !reClass) st = 'code';
      }
      continue;
    }
    if (c === '/' && n === '*') { out += '  '; i++; st = 'block'; continue; }
    if (c === '/' && n === '/') { out += '  '; i++; st = 'line'; continue; }
    if (c === "'") { out += ' '; st = 'sq'; continue; }
    if (c === '"') { out += ' '; st = 'dq'; continue; }
    if (c === '`') { out += ' '; st = 'tpl'; continue; }
    if (c === '{') braceDepth++;
    if (c === '}') {
      braceDepth--;
      if (stack.length && braceDepth === stack[stack.length - 1]) { stack.pop(); out += ' '; st = 'tpl'; continue; }
    }
    if (c === '/' && (prev === '' || /[=(,:;[{!&|?+\-*%~^<>]/.test(prev))) { out += ' '; reClass = false; st = 're'; continue; }
    out += c;
    if (!/\s/.test(c)) prev = c;
  }
  return out;
}

function srcFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) out.push(p);
    }
  };
  walk(path.join(ENGINE, 'src'));
  return out;
}

test('§C the nested-template hole hides no swept idiom in src/ — measured, not assumed', () => {
  const files = srcFiles();
  assert.ok(files.length >= 8, `only ${files.length} .ts files under src/ — the walk has gone blind`);

  const any = new RegExp(SWEEP_PATTERNS.map(p => p.re.source).join('|'));
  const disagreements: string[] = [];
  let nested = 0;
  for (const p of files) {
    const src = fs.readFileSync(p, 'utf8');
    const a = stripCode(src).split('\n');
    const b = oracle(src).split('\n');
    for (let i = 0; i < b.length; i++) {
      const inA = any.test(a[i] ?? ''), inB = any.test(b[i] ?? '');
      if (inA !== inB) {
        disagreements.push(`${path.relative(ENGINE, p)}:${i + 1} — ${inB ? 'ORACLE sees it, stripCode does NOT' : 'stripCode sees it, the oracle does not'}`);
      }
    }
    // and count the shape that causes the divergence, for the log
    nested += (src.match(/\$\{[^{}]*`/g) ?? []).length;
  }
  console.log(`    sweep sight: ${files.length} files under src/ compared against the oracle · `
    + `${nested} candidate nested-template sites · ${disagreements.length} disagreements`);

  assert.deepEqual(disagreements, [],
    'a line that one stripper calls CODE and the other calls STRING contains an idiom the '
    + 'whole-file sweeps in 90-coverage-census hunt for. If the oracle sees it and stripCode '
    + 'does not, a real bin write or controller assignment is INVISIBLE to those sweeps and '
    + 'they are reporting clean for the wrong reason (§A is the mechanism). If stripCode sees '
    + 'it and the oracle does not, the sweeps are about to fail on something that is only a '
    + 'comment. Either way, do not touch the sweeps until this line is understood.\n  '
    + disagreements.join('\n  '));
});

// ───────────── §D · none of these populations is empty ────────────────────

test('§D no sweep in 90-coverage-census is reading an empty population', () => {
  // `R148 stays solved: no card in src/cards/ assigns a unit's .controller`
  // walks src/cards/ and asserts the offender list is empty. It carries NO
  // floor of its own: if the walk returned nothing the test would pass, and
  // the only thing anchoring it today is that CONTROLLER_ASSIGN_OK happens to
  // be non-empty and its entries are checked for staleness. An allowlist
  // emptying out is a normal, good event — and it would silently take that
  // sweep's whole reach with it.
  const cards: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) cards.push(p);
    }
  };
  walk(path.join(ENGINE, 'src', 'cards'));
  assert.ok(cards.length >= 30,
    `only ${cards.length} .ts files under src/cards/ — 90-coverage-census's "R148 stays solved" `
    + 'sweep walks this directory and has no floor of its own, so an empty walk there passes');

  // and the sweep must still be able to SEE a controller assignment in a card
  // file: the shape it hunts, planted into the card corpus's own idiom.
  const planted = stripCode("item.controller = ctx.controller;   // in a card file");
  assert.match(planted, SWEEP_PATTERNS[2]!.re,
    'the card-side R148 sweep can no longer recognise the assignment it exists to find');
});
