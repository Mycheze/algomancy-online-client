/* Test titles, read with a real JavaScript tokenizer.
 *
 * WHY NOT A REGEX. A title is a string literal, and string literals carry
 * escapes: `'§2 a Pure recipient\'s own Vulnerable …'` is the title
 * "§2 a Pure recipient's own Vulnerable …", and a regex that stops at the
 * first quote reads "§2 a Pure recipient\". Titles are also concatenations
 * (`'… ' + '…'`) and templates, and a quote character can sit inside a
 * comment or a regex literal anywhere above the call. So the source is
 * tokenized — comments, the three string forms (escapes undone), template
 * literals with nested `${ … }`, regex literals — and a title is read off the
 * token stream: `test` / `it` (optionally `.skip` / `.only` / `.todo`), not
 * preceded by `.`, then `(`, then string operands joined by `+`.
 *
 * A template's `${ … }` is kept as written (it cannot be evaluated here). A
 * concatenation that reaches a non-literal operand stops there; the title is
 * marked `partial`. */

const IDENT_START = /[A-Za-z_$\u0080-￿]/;
const IDENT_PART = /[\w$\u0080-￿]/;
/** after these keywords a `/` starts a regex, not a division */
const REGEX_AFTER_KEYWORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
  'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/** undo one escape sequence starting at src[i] === '\\'; returns [text, nextIndex] */
function unescapeAt(src, i) {
  const c = src[i + 1];
  const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
  if (c === undefined) return ['', i + 1];
  if (c === '\r' && src[i + 2] === '\n') return ['', i + 3];         // line continuation
  if (c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029') return ['', i + 2];
  if (c in simple && !(c === '0' && /\d/.test(src[i + 2] ?? ''))) return [simple[c], i + 2];
  if (c === 'x') return [String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16)), i + 4];
  if (c === 'u') {
    if (src[i + 2] === '{') {
      const end = src.indexOf('}', i + 3);
      return [String.fromCodePoint(parseInt(src.slice(i + 3, end), 16)), end + 1];
    }
    return [String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)), i + 6];
  }
  return [c, i + 2];                                                   // \' \" \\ \` \$ and the rest
}

/**
 * Tokenize JS/TS source. Tokens: {t: 'id'|'str'|'tmpl'|'num'|'re'|'p', v, s, e}
 * where `v` is the cooked value for strings and templates.
 */
export function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const prevAllowsDivision = () => {
    const p = out[out.length - 1];
    if (!p) return false;
    if (p.t === 'id') return !REGEX_AFTER_KEYWORD.has(p.v);
    if (p.t === 'num' || p.t === 'str' || p.t === 'tmpl' || p.t === 're') return true;
    return p.t === 'p' && (p.v === ')' || p.v === ']' || p.v === '}');
  };
  /** read a template starting at the backtick; returns its cooked text */
  const readTemplate = () => {
    const s = i;
    let v = '';
    i++;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { const [t, j] = unescapeAt(src, i); v += t; i = j; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        const start = i;
        i += 2;
        skipExpression();
        v += src.slice(start, i);                                      // `${ … }` kept as written
        continue;
      }
      v += src[i++];
    }
    i++;
    out.push({ t: 'tmpl', v, s, e: i });
  };
  /** inside `${`: scan tokens until the matching `}` (pushed tokens are discarded) */
  const skipExpression = () => {
    const mark = out.length;
    let depth = 0;
    while (i < n) {
      const before = out.length;
      step();
      const tok = out[out.length - 1];
      if (out.length > before && tok.t === 'p') {
        if (tok.v === '{') depth++;
        else if (tok.v === '}') {
          if (depth === 0) break;
          depth--;
        }
      }
    }
    out.length = mark;
  };
  const step = () => {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\ufeff' || c === '\u00a0') { i++; return; }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; return; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; return; }
    if (c === '"' || c === "'") {
      const s = i;
      let v = '';
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { const [t, j] = unescapeAt(src, i); v += t; i = j; continue; }
        if (src[i] === '\n') break;                                    // unterminated: stop at the line
        v += src[i++];
      }
      i++;
      out.push({ t: 'str', v, s, e: i });
      return;
    }
    if (c === '`') { readTemplate(); return; }
    if (c === '/' && !prevAllowsDivision()) {
      const s = i;
      let inClass = false;
      i++;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        i++;
      }
      i++;
      while (i < n && IDENT_PART.test(src[i])) i++;                  // flags
      out.push({ t: 're', v: src.slice(s, i), s, e: i });
      return;
    }
    if (IDENT_START.test(c)) {
      const s = i;
      while (i < n && IDENT_PART.test(src[i])) i++;
      out.push({ t: 'id', v: src.slice(s, i), s, e: i });
      return;
    }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      const s = i;
      while (i < n && /[\w.]/.test(src[i])) i++;
      out.push({ t: 'num', v: src.slice(s, i), s, e: i });
      return;
    }
    out.push({ t: 'p', v: c, s: i, e: i + 1 });
    i++;
  };
  while (i < n) step();
  return out;
}

const TEST_FNS = new Set(['test', 'it']);
const MODIFIERS = new Set(['skip', 'only', 'todo']);

/** every `test(…)` / `it(…)` title in one source file, in file order */
export function testTitlesOf(src) {
  const toks = tokenize(src);
  const titles = [];
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k];
    if (tok.t !== 'id' || !TEST_FNS.has(tok.v)) continue;
    const prev = toks[k - 1];
    if (prev && prev.t === 'p' && prev.v === '.') continue;           // re.test(…), t.it(…)
    let j = k + 1;
    if (toks[j]?.v === '.' && toks[j + 1]?.t === 'id' && MODIFIERS.has(toks[j + 1].v)) j += 2;
    if (toks[j]?.v !== '(') continue;
    j++;
    if (toks[j]?.t !== 'str' && toks[j]?.t !== 'tmpl') continue;      // a helper's own it(1, …)
    let title = toks[j].v;
    let partial = false;
    j++;
    while (toks[j]?.v === '+') {
      const operand = toks[j + 1];
      if (operand?.t !== 'str' && operand?.t !== 'tmpl') { partial = true; break; }
      title += operand.v;
      j += 2;
    }
    titles.push(partial ? { title, partial } : { title });
  }
  return titles;
}
