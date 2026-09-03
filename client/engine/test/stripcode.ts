/* stripCode — the code view of a TypeScript source: comments blanked, string
 * and regex literals blanked, everything else in place, SAME LENGTH as the
 * input so an offset into the view is an offset into the file.
 *
 * It lived in ledgers/card-todo.ts until 2026-09-03, which meant ten sweeps
 * that wanted to lex a comment imported a ten-thousand-line work queue (and
 * the engine, and the harness) to do it, and the queue was the one ledger
 * that was not data. 149-strip-code.test.ts pins the behaviour; 147 §0
 * measures its reach on every run. The ⚠ notes on what it cannot see
 * (nested template literals) are in 147's header.
 */
/**
 * TypeScript source with block comments, line comments and string literals
 * removed, in that order. THE one place this repo strips code for reading, and
 * it exists because both halves have burned it inside a single day:
 *
 *  · `JSON.stringify` on a card definition DROPS FUNCTIONS, so a check that
 *    reads card behaviour that way silently answers "clean" (CARD-TODO #27's
 *    first draft).
 *  · `Function.prototype.toString()` KEEPS comments and strings, so a comment
 *    that merely MENTIONS the bad idiom — very often the comment explaining
 *    that the card no longer does it — holds the check true (R140's three
 *    fixed cards).
 *
 * Strings go last so a `'` inside a comment ("a unit's mods") is already gone
 * and cannot open a string that swallows the rest of the file. The one known
 * limit is the mirror of that: a `//` INSIDE a string literal would eat the
 * rest of its line. Nothing in src/ does that, and the cost of the miss is one
 * unread line, never a false alarm.
 *
 * Exported (R148) because the sweeps in 90-coverage-census read whole FILES
 * this way, and a second copy of these three regexes is a second thing to get
 * wrong.
 */
let reClass = false;   // open character class inside a regex literal

const KEYWORDS_BEFORE_REGEX = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void',
  'instanceof', 'do', 'else', 'yield', 'await', 'throw',
]);

/**
 * Does the `/` at this point open a REGEX LITERAL, or is it division?
 *
 * The classic JS ambiguity, and the whole reason the old three-regex stripper
 * was unsound. A `/` starts a regex when what precedes it cannot END an
 * expression: an operator, an opening bracket, a comma, a semicolon — or one
 * of the keywords that takes an expression next. It is DIVISION when it
 * follows an identifier, a number, `)`, `]` or a closing quote.
 *
 * A misjudgement here is no longer catastrophic in either direction, because
 * the scanner is line-preserving and re-synchronises at the next newline: the
 * worst case is one mis-blanked span, not a file-long desync.
 */
function startsRegex(prev: string, out: string): boolean {
  if (prev === '') return true;
  if ('([{,;:=!&|?+-*%~^<>'.includes(prev)) return true;
  if (/[)\]}\w$]/.test(prev)) {
    const w = /([A-Za-z_$][\w$]*)\s*$/.exec(out);
    return !!w && KEYWORDS_BEFORE_REGEX.has(w[1]!);
  }
  return true;
}

export function stripCode(src: string): string {
  let out = '';
  let st: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' | 're' = 'code';
  let prev = '';   // last significant code char, for the regex/division call
  reClass = false;
  // R201 / CT-68: `${ … }` INSIDE A TEMPLATE LITERAL IS CODE, NOT STRING, and
  // this is the THIRD time this one function has been caught blind.
  //
  // Without the stack below, a NESTED template inverts parity: the inner
  // opening backtick reads as the OUTER one's closing tick, so the code before
  // it is swallowed as string and the inner string body comes back as CODE.
  //
  //     stripCode('const a = `x ${ f(`y`) } z`;')  ->  'const a =          y       ;'
  //
  // `f(` gone, `y` promoted to code. Measured across engine/: src/engine.ts has
  // 12 nested templates and leaks those 10 lines; ui/main.ts has 108, leaking
  // 368 lines and BLANKING 911 lines of real code — which is why 147's helper
  // sweep had to exclude ui/ to stay honest.
  //
  // The cost was not theoretical. A real `z.bin.push(1)` planted inside a
  // nested template in src/rng.ts left all nine tests of 90-coverage-census
  // GREEN — a live bypass of the R124/R145 bin choke point, invisible to every
  // sweep that rests on this helper. 164-sweep-sight.test.ts §C runs an
  // INDEPENDENT oracle beside this function over all of src/ and reports only
  // the disagreements, because a checker cannot audit itself: measuring
  // stripCode's blind spots with stripCode is exactly the move that let the
  // first two live for weeks.
  //
  // `braceDepth` counts `{` in code; `tplStack` remembers the depth at which
  // each interpolation opened, so the matching `}` — and only that one — hands
  // control back to the template.
  let braceDepth = 0;
  const tplStack: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!, n = src[i + 1];
    if (st !== 'code') {
      // BLANK, never delete: line and column must survive, because callers
      // report `file:${n + 1}` from the stripped text.
      // RESYNC AT END OF LINE. Only a block comment and a template literal may
      // legally span a newline in JS/TS; a line comment, a quoted string and a
      // regex literal may not. Ending those states here is what makes a
      // misjudged `/` cost one line instead of the rest of the file — the
      // failure that silently deleted 5128 of engine.ts's 8901 lines and blinded
      // every sweep built on this helper.
      if (c === '\n') {
        out += '\n';
        if (st === 'line' || st === 'sq' || st === 'dq' || st === 're') st = 'code';
        continue;
      }
      out += ' ';
      if (st === 'block') { if (c === '*' && n === '/') { out += ' '; i++; st = 'code'; } }
      else if (st === 'sq') { if (c === '\\') { out += ' '; i++; } else if (c === "'") st = 'code'; }
      else if (st === 'dq') { if (c === '\\') { out += ' '; i++; } else if (c === '"') st = 'code'; }
      else if (st === 'tpl') {
        if (c === '\\') { out += ' '; i++; }
        else if (c === '`') st = 'code';
        else if (c === '$' && n === '{') { out += ' '; i++; tplStack.push(braceDepth); braceDepth++; st = 'code'; }
      }
      // A LINE COMMENT ENDS AT THE NEWLINE AND AT NOTHING ELSE. It needs its
      // own branch — without one it fell through to the regex arm below, where
      // an unescaped `/` outside a character class does `st = 'code'`, so the
      // comment ENDED AT ITS FIRST SLASH and its tail was handed back as code.
      // `+1/+1`, `ll/2`, `and/or` and every file path make that near-universal:
      // 927 line-comment lines across the 28 batch files leaked, plus 86 in
      // engine.ts. Worse, a leaked backtick opened a TEMPLATE-LITERAL state,
      // which may legally span newlines, so the desync then swallowed real
      // code — ten `card()` definitions vanished from the stripped view of
      // batch-hybrids-ld-c.ts and batch-light-a.ts, and every sweep resting on
      // this helper was reading English as TypeScript.
      //
      // This is the SECOND time this one function has gone blind (the first was
      // the regex-literal hole that deleted 5128 of engine.ts's 8901 lines).
      // Both times it was found the same way — an agent saying "my sweep says
      // clean and I don't believe it" — and never by the sweeps themselves.
      // 149-strip-code.test.ts measures it directly now.
      else if (st === 'line') { /* consumed above; only a newline leaves this state */ }
      else {
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
    // R201: track brace depth so an interpolation's CLOSING `}` — and no other
    // `}` — returns to the template it opened inside.
    if (c === '{') braceDepth++;
    if (c === '}') {
      braceDepth--;
      if (tplStack.length && braceDepth === tplStack[tplStack.length - 1]) {
        tplStack.pop(); out += ' '; st = 'tpl'; continue;
      }
    }
    if (c === '/' && startsRegex(prev, out)) { out += ' '; reClass = false; st = 're'; continue; }
    out += c;
    if (!/\s/.test(c)) prev = c;
  }
  return out;
}
