/* RECITE — step 1c of the CR-only migration: every live `R<n>` citation becomes
 * a `CR <num>` citation, a pointer, plain words, or nothing.
 *
 *   node client/engine/scripts/cr/migrate/recite.mjs [--dry-run] [--report <file>]
 *
 * INPUTS (all re-derivable or committed):
 *   build/cites.json      score.mjs's table, built from THIS checkout before absorb
 *                         (run.mjs runs it first). A row's `id` is stable: file +
 *                         ruling + line-text hash + occurrence.
 *   decisions/*.json      the agent pass: {decisions: {<id>: {action, nums, suggest}}}
 *   visible.json          hand-written replacements for player- and owner-visible
 *                         strings (no rule numbers reach a player)
 *
 * WHAT EACH ROW BECOMES (an agent decision always wins over a script pick):
 *   cite     CR <num>[, <num>] in the citation's own form: bare, a list `R25/R239`
 *            (union, de-duplicated), `R157 §5` (the § goes with it), a range, a
 *            test-title prefix (`R110: ` → `CR 802.4a: ` with one number, stripped
 *            otherwise; `[R266] ` likewise)
 *   drop     the citation leaves, the prose stays grammatical — or the row is
 *            reported `drop-unapplied` and left alone
 *   reword   the agent's `suggest` replaces the words it rewrites (anchored on its
 *            first and last words, minimised to the differing span); unanchored →
 *            reported and left
 *   pointer  a process ruling: `(see 154-guard-shape)`; inside its own guard file
 *            the citation is dropped
 *   leave    unsure, or no decision: left as it is and LISTED (never guessed)
 *
 * BINDINGS move with their titles, through ONE function: every test title the
 * rewrite changes is recorded old → new, and every `<file>.test.ts::<needle>`
 * (CR examples[].test, ledger guards, any string in client/) whose needle sits
 * in a changed title is re-cut from the new title. Quotes of changed files
 * (findings evidence, discrepancy sides quoting a `file:`, card-todo `still()` /
 * `body()` needles) are re-cut the same way, from the file's own edit list.
 *
 * NOT TOUCHED: verdicts/*.json and the closed ledgers' evidence (frozen history;
 * score.mjs never emits them), the provenance rows absorb.mjs already worded,
 * a ruling's own quotes (`sources.owner[].quote`, the owner's words). */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, basename, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { REPO_ROOT, CR_RULES_DIR, CR_FINDINGS_DIR, CR_DISCREPANCIES_DIR } from '../../paths.mjs';
import { tokenize } from '../extract-test-titles.mjs';
import { indentOf } from './util.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
/** esbuild's TS parser (the engine's dev dependency), when installed: a parse check on every rewritten file */
let esbuildTransform = null;
try { esbuildTransform = createRequire(join(REPO_ROOT, 'client/engine/package.json'))('esbuild').transformSync; } catch { esbuildTransform = null; }
export const DECISIONS_DIR = join(HERE, 'decisions');
export const VISIBLE_JSON = join(HERE, 'visible.json');
export const GLOSSARY_TS = 'client/ui/glossary.ts';
const TOK = /\bR(\d{1,3})(b?)\b/g;
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);
const normLine = (s) => String(s).replace(/\s+/g, ' ').trim();

/* ── decisions ── */
export function loadDecisions(dir = DECISIONS_DIR) {
  const D = new Map();
  if (!existsSync(dir)) return D;
  // the unit files first (M001…), then the override layers in a fixed order: cleanup (the
  // unsure pass), audit (corrections), fixups (exact find/replace) — a later file wins by id
  // precedence (orchestrator 2026-10-11): remediation-* > cleanup > M0xx units > the script's auto picks;
  // audit corrections sit between cleanup and remediation; exact fix-ups, then the leftover pass, on top
  const layer = (f) => (/^cleanup/.test(f) ? 1 : /^audit/.test(f) ? 2 : /^remediation/.test(f) ? 3 : /^fixup/.test(f) ? 4 : /^leftover/.test(f) ? 5 : /^polish/.test(f) ? 6 : 0);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort((a, b) => layer(a) - layer(b) || a.localeCompare(b))) {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    for (const [id, d] of Object.entries(j.decisions ?? {})) D.set(id, { ...d, unit: j.unit ?? f });
  }
  return D;
}

/** what one census row becomes, before its group is considered */
export function actionOf(row, D) {
  if (row.method === 'fp' || row.method === 'provenance') return { kind: 'skip' };
  if (row.form === 'binding') return { kind: 'binding' };
  const d = D.get(row.id);
  if (d?.find) return { kind: 'exact', find: d.find, replace: d.replace ?? '', src: d.unit };
  if (d) {
    if (d.action === 'cite') return d.nums?.length ? { kind: 'cite', nums: d.nums, src: d.unit } : { kind: 'leave', why: 'cite with no number', src: d.unit };
    if (d.action === 'drop') return { kind: 'drop', src: d.unit };
    if (d.action === 'reword') return { kind: 'reword', suggest: d.suggest ?? null, nums: d.nums ?? [], src: d.unit };
    if (d.action === 'freeze') return { kind: 'leave', why: `freeze: ${d.note ?? ''}`.trim(), frozen: true, src: d.unit };
    if (d.action === 'machinery') return { kind: 'leave', why: `machinery: ${d.note ?? ''}`.trim(), machinery: true, src: d.unit };
    return { kind: 'leave', why: `unsure: ${d.note ?? ''}`.trim(), src: d.unit };
  }
  // a script pick never rewrites a sentence about the ruling's history (reversed, superseded,
  // "before R154", a dead ruling): a CR number there changes what the sentence says
  const auto = row.method === 'unique' || ((row.method === 'scored' || row.method === 'binding') && row.auto && row.pick) || row.method === 'process';
  if (auto && row.historical) return { kind: 'leave', why: 'historical: an auto pick in a sentence about the ruling\'s history (pending a decision)', pending: 'historical', src: 'auto' };
  if (row.method === 'unique' || ((row.method === 'scored' || row.method === 'binding') && row.auto && row.pick)) return { kind: 'cite', nums: [row.pick], src: row.method };
  if (row.method === 'process') return row.obsolete ? { kind: 'drop', src: 'process-obsolete' } : { kind: 'pointer', pointer: row.pointer, src: 'process' };
  return { kind: 'leave', why: `no decision (${row.method}${row.reason ? `: ${row.reason}` : ''})`, src: 'none' };
}

/* ── per-file model: lines, string literals, test titles ── */
function fileModel(text, rel) {
  const lines = text.split('\n');
  const offs = [0];
  for (const l of lines) offs.push(offs[offs.length - 1] + l.length + 1);
  const m = { text, rel, lines, offs, strs: [], titles: [] };
  if (/\.(ts|mts|mjs|js)$/.test(rel)) {
    let toks = null;
    try { toks = tokenize(text); } catch { toks = null; }
    if (toks) {
      for (const t of toks) if (t.t === 'str' || t.t === 'tmpl') m.strs.push({ s: t.s, e: t.e, q: text[t.s] });
      m.titles = titlesOf(toks);
    }
  }
  return m;
}
/** test titles with their literal extents: [{title, s, e}] (s..e spans the operand literals) */
export function titlesOf(toks) {
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k];
    if (tok.t !== 'id' || (tok.v !== 'test' && tok.v !== 'it')) continue;
    const prev = toks[k - 1];
    if (prev && prev.t === 'p' && prev.v === '.') continue;
    let j = k + 1;
    if (toks[j]?.v === '.' && ['skip', 'only', 'todo'].includes(toks[j + 1]?.v)) j += 2;
    if (toks[j]?.v !== '(') continue;
    j++;
    if (toks[j]?.t !== 'str' && toks[j]?.t !== 'tmpl') continue;
    let title = toks[j].v; const s = toks[j].s; let e = toks[j].e; j++;
    while (toks[j]?.v === '+' && (toks[j + 1]?.t === 'str' || toks[j + 1]?.t === 'tmpl')) { title += toks[j + 1].v; e = toks[j + 1].e; j += 2; }
    out.push({ title, s, e });
  }
  return out;
}
const strAt = (m, off) => m.strs.find((x) => x.s < off && off < x.e) ?? null;
/** escape replacement text for a string literal delimited by q */
function esc(text, q) {
  if (!q) return text;
  let t = text.replace(/\\/g, '\\\\');
  if (q === '`') t = t.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  else t = t.split(q).join(`\\${q}`);
  return t.replace(/\n/g, '\\n');
}

/* ── citation groups on one line ── */
const CONNECT = /^\s?(?:\/|[-–—]|\.\.|to|through|\+|&)\s?$/;
const SECTION_TAIL = /^(?:\s?\((?:its\s)?§\s?\d+[^)]*\)|,?\s?(?:its\s)?§\s?\d+[a-z]?(?:[-–]\d+[a-z]?)?(?:\s?\((?:[^()]{0,40})\))?)/;
export function groupsOf(line) {
  const toks = [...line.matchAll(TOK)].map((x) => ({ a: x.index, b: x.index + x[0].length, id: `R${Number(x[1])}${x[2]}` }));
  const groups = [];
  for (const t of toks) {
    const g = groups[groups.length - 1];
    if (g && CONNECT.test(line.slice(g.b, t.a)) && !/§/.test(line.slice(g.b, t.a))) { g.b = t.b; g.members.push(t); }
    else groups.push({ a: t.a, b: t.b, members: [t] });
  }
  for (const g of groups) {
    const tail = SECTION_TAIL.exec(line.slice(g.b));
    if (tail && !/\bR\d/.test(tail[0])) { g.b += tail[0].length; g.sec = true; }
    if (g.members.length > 1 && /[-–—]|\.\.|to|through/.test(line.slice(g.members[0].b, g.members[1].a))) g.range = true;
  }
  return groups;
}

/* ── the text a group becomes ── */
const citeText = (nums) => `CR ${[...new Set(nums)].join(', ')}`;
const PREP = /(?:\b(?:per|see|cf\.|under|in|by|from|after|since|following|via|of|as in|like)\s+)$/i;

/** cite: the group's replacement and any widening of its span on the line */
function citeEdit(line, g, nums) {
  let a = g.a, b = g.b;
  let text = citeText(nums);
  const before = line.slice(0, a), after = line.slice(b);
  let m;
  if ((m = /(?:docs\/)?digital-rules(?:\.md)?\s*(?:§\s*)?$/.exec(before))) a -= m[0].length;
  else if ((m = /\b[Rr]ulings?\s+$/.exec(before))) a -= m[0].length;
  // "R118 ruling 1" numbered a part of the old write-up: the part number goes with it
  if ((m = /^\s+ruling\s+\d+\b/.exec(after))) b += m[0].length;
  else if ((m = /^(\s+)(ruling)(s?)\b/.exec(after)) && !/\brules?\s+$/.test(before)) { b += m[0].length; text += `${m[1]}rule${m[3]}`; }
  return { a, b, text };
}

/** drop: the span to delete (and any replacement), or null when no grammatical removal is known */
export function dropEdit(line, g) {
  const before = line.slice(0, g.a), after = line.slice(g.b);
  let m, n;
  // "(R25)", "(see R25)", "(per R25)" — the whole parenthetical
  if ((m = /\s*\(\s*(?:(?:see|per|cf\.?|under|by|after|from)\s+)?$/.exec(before)) && (n = /^\s*\)/.exec(after))) {
    // keep a space if the parenthesis sat between two words with no other space
    return { a: g.a - m[0].length, b: g.b + n[0].length, text: '' };
  }
  // "[R266] " — a bracket label
  if ((m = /\[\s*$/.exec(before)) && (n = /^\s*\]\s?/.exec(after))) return { a: g.a - m[0].length, b: g.b + n[0].length, text: '' };
  // inside a parenthesis with other content: "(CT-83, R210)" / "(R210, CT-83)"
  if ((m = /,\s*$/.exec(before)) && /^\s*[)\];:.]/.test(after)) return { a: g.a - m[0].length, b: g.b, text: '' };
  if ((n = /^,\s*/.exec(after)) && /[(\[]\s*$/.test(before)) return { a: g.a, b: g.b + n[0].length, text: '' };
  if ((m = /(?<=[\w)\]])\s*(?:\/|·|;)\s*$/.exec(before)) && /^\s*(?:[)\]:,.;—–]|$)/.test(after)) return { a: g.a - m[0].length, b: g.b, text: '' };
  if ((n = /^\s*(?:\/|·)\s*/.exec(after)) && /(?:^|[(\[\s*#/-])\s*$/.test(before)) return { a: g.a, b: g.b + n[0].length, text: '' };
  // "R25's reading" / "in R95's shape" → "the reading" / "in the shape" (an article before it is kept)
  if ((n = /^'s\s+(?=[a-z`(])/.exec(after))) {
    if ((m = /\b(the|The|a|A|an|An)\s+$/.exec(before))) return { a: g.a - m[0].length, b: g.b + n[0].length, text: `${m[1].length === 2 && /an/i.test(m[1]) ? (m[1][0] === 'A' ? 'A' : 'a') : m[1]} ` };
    const cap = /(^|[.!?]\s+|\/\/+\s*|\*\s*|#+\s*|['"`]\s*)$/.test(before);
    return { a: g.a, b: g.b + n[0].length, text: cap ? 'The ' : 'the ' };
  }
  // "two R9 budgets", "each R25 region": a determiner before, a lower-case noun after
  if ((m = /\b(?:one|two|three|four|each|every|no|any|all|both|his|their|our|your|those|these|its)\s+$/i.exec(before)) && (n = /^\s+(?=[a-z])/.exec(after))) return { a: g.a, b: g.b + n[0].length, text: '' };
  // "per R25, the unit" / "the unit, per R25." / "as ruled in R25."
  if ((m = PREP.exec(before))) {
    const lead = /(^|[(\[]|[.!?:;—–]\s+|\/\/+\s*|\*\s*|#+\s*|-\s+|'\s*|"\s*|`\s*)$/.exec(before.slice(0, before.length - m[0].length));
    if (lead && (n = /^,\s*/.exec(after))) {
      // sentence-initial "Per R25, the unit" → "The unit"
      const rest = after.slice(n[0].length);
      const cap = /^[a-z]/.test(rest) && /(^|[.!?]\s+|\/\/+\s*|\*\s*|#+\s*|'\s*|"\s*|`\s*)$/.test(before.slice(0, before.length - m[0].length));
      return { a: g.a - m[0].length, b: g.b + n[0].length + (cap ? 1 : 0), text: cap ? rest[0].toUpperCase() : '' };
    }
    if (/^\s*(?:[,.;:)\]—–]|$)/.test(after)) {
      const sp = /(?:\s+[—–]|\s+-)?,?\s+$/.exec(before.slice(0, before.length - m[0].length));
      return { a: g.a - m[0].length - (sp ? sp[0].length : 0), b: g.b, text: '' };
    }
    return null;
  }
  // a label at the start of a comment line / title: "// R25: blah", "R25 — blah", "R25 · BLAH"
  if (/((?:^|\s)(?:\/\/+|\/\*+|\*|#+|-|>)\s*[⚠✔❌✅]?\s*|^\s*|['"`]\s*[⚠✔❌✅]?\s*)$/.test(before) && (n = /^\s*(?:[:—–·|]|-(?=\s))\s*/.exec(after))) return { a: g.a, b: g.b + n[0].length, text: '' };
  // "the unit dies — R25." / "… (CT-12) R25" trailing: the cite ends its clause
  if ((m = /\s*(?:[—–-]|,)?\s+$/.exec(before)) && /^\s*(?:[.;:)\]]|$)/.test(after) && before.trim()) return { a: g.a - m[0].length, b: g.b, text: '' };
  // "the R25 rule" / "an R25 test": an article before, a lower-case noun after
  if ((m = /\b(the|The|a|A|an|An|this|This|that|its|their)\s+$/.exec(before)) && (n = /^(?:'s)?\s+(?=[a-z])/.exec(after))) {
    const art = m[1].toLowerCase() === 'an' ? (m[1] === 'An' ? 'A' : 'a') : m[1];
    return { a: g.a - m[0].length, b: g.b + n[0].length, text: `${art} ` };
  }
  return null;
}

/** process pointer: the citation leaves the sentence (grammatically, as a drop) and
 *  "(see 154-guard-shape)" closes the clause it was in; inside its own file the pointer
 *  is not needed and the citation is just dropped. `limit` is where the clause may run to
 *  (a string literal's closing quote). null when no grammatical removal is known. */
function pointerEdit(line, g, pointer, rel, limit = line.length) {
  if (!pointer) return null;
  const self = basename(rel).replace(/\.test\.ts$/, '').replace(/\.(ts|md|mjs)$/, '') === pointer.replace(/\.(ts|md|mjs)$/, '')
    || rel.endsWith(pointer) || (pointer.startsWith('CLAUDE.md') && rel === 'CLAUDE.md');
  const d = dropEdit(line, g);
  if (!d) return null;
  if (self) return d;
  // the clause ends at the first sentence punctuation after the citation, or the end of the comment / string
  let end = limit;
  const tail = line.slice(d.b, limit);
  const m = /[.;:!?](?=\s|$|['"`])|\s[—–]\s|\s\*\/\s*$|\s*\*\/|\s*$/.exec(tail);
  if (m) end = d.b + m.index;
  if (end < d.b) end = d.b;
  return { a: d.a, b: end, text: `${d.text}${line.slice(d.b, end)} (see ${pointer})`.replace(/^\s+\(see/, ' (see') };
}

/** a test-title prefix: `R110: x` / `[R266] x` / `R3 STILL STANDS: x` */
function titlePrefixEdit(line, g, titleStart, nums) {
  const off = g.a - titleStart; // characters between the literal's opening quote+1 and the group
  if (off > 1) return null;
  const bracket = line[g.a - 1] === '[';
  if (bracket) {
    const close = /^\s*\]\s?/.exec(line.slice(g.b));
    if (!close) return null;
    if (nums?.length === 1) return { a: g.a, b: g.b, text: `CR ${nums[0]}` };
    return { a: g.a - 1, b: g.b + close[0].length, text: '' };
  }
  if (off !== 0) return null;
  if (nums?.length === 1) return { a: g.a, b: g.b, text: `CR ${nums[0]}` };
  // "R259 §0: the scan…" keeps its own section mark: "§0: the scan…"
  const sec = /§\s?\d+[a-z]?(?:[-–]\d+[a-z]?)?/.exec(line.slice(g.members.at(-1).b, g.b));
  if (sec) return { a: g.a, b: g.b, text: sec[0].replace(/\s/g, '') };
  const sep = /^\s*(?:[:—–·|\/]|-(?=\s))?\s*/.exec(line.slice(g.b));
  return { a: g.a, b: g.b + sep[0].length, text: '' };
}

/* ── reword: anchor the suggestion on its first and last words ── */
/** a suggestion is WORDS: an agent that pasted the source line around them (`test('…', () => {`,
 *  the literal's own quotes, its escapes) has the wrapping taken off before it is spliced */
export function cleanSuggest(suggest, q) {
  let t = String(suggest ?? '').trim();
  const m = /^(?:test|it)(?:\.\w+)?\(\s*(['"`])([\s\S]*?)\1\s*(?:[,)][\s\S]*)?$/.exec(t);
  if (m) t = m[2];
  if (q && t.length > 1 && t.startsWith(q) && t.endsWith(q)) t = t.slice(1, -1);
  else if (q && t.endsWith(q) && !t.slice(0, -1).includes(q)) t = t.slice(0, -1);
  else if (q && t.startsWith(q) && !t.slice(1).includes(q)) t = t.slice(1);
  if (q) t = unescapeJs(t);
  return t;
}
const W = (s) => s.toLowerCase().replace(/^[^\p{L}\p{N}§]+|[^\p{L}\p{N}]+$/gu, '');
function wordsWithPos(s) { return [...s.matchAll(/\S+/g)].map((x) => ({ w: W(x[0]), a: x.index, b: x.index + x[0].length, raw: x[0] })); }

/** → {a, b, text} over `logical`, or null */
export function anchorReword(logical, p, q, suggest) {
  const Lw = wordsWithPos(logical);
  const Tw = wordsWithPos(suggest).filter((x) => x.w);
  if (!Tw.length) return null;
  const iP = Lw.findIndex((x) => x.b > p);
  const iQ = Lw.findIndex((x) => x.b >= q);
  if (iP < 0 || iQ < 0) return null;
  const match = (i, k, from) => k <= Tw.length && i >= 0 && i + k <= Lw.length && Tw.slice(from, from + k).every((t, j) => Lw[i + j].w === t.w);
  let start = null;
  for (const k of [3, 2]) {
    for (let i = iP; i >= Math.max(0, iP - 40); i--) if (match(i, k, 0)) { start = i; break; }
    if (start !== null) break;
  }
  if (start === null && Tw[0].w.length >= 6) for (let i = iP; i >= Math.max(0, iP - 12); i--) if (match(i, 1, 0)) { start = i; break; }
  let end = null;
  for (const k of [3, 2]) {
    if (Tw.length < k) continue;
    for (let i = iQ; i <= Math.min(Lw.length - k, iQ + 60); i++) if (match(i, k, Tw.length - k)) { end = i + k - 1; break; }
    if (end !== null) break;
  }
  if (end === null && Tw.at(-1).w.length >= 6) for (let i = iQ; i <= Math.min(Lw.length - 1, iQ + 20); i++) if (Lw[i].w === Tw.at(-1).w) { end = i; break; }
  // the suggestion's own tail may be new words ("… scope (803.8a)"): anchor on one of its last
  // three words that the original goes on with, close after the citation, and keep the rest
  let tailAnchored = false;
  if (end === null) {
    for (let j = Tw.length - 2; j >= Math.max(1, Tw.length - 3) && end === null; j--) {
      if (Tw[j].w.length < 4) continue;
      for (let i = iQ + 1; i <= Math.min(Lw.length - 1, iQ + 8); i++) if (Lw[i].w === Tw[j].w) { end = i; tailAnchored = true; break; }
    }
  }
  if (start === null && end === null && Tw.length > 6) return null;
  let a = start === null ? p : Lw[start].a;
  let b = end === null ? q : Lw[end].b;
  if (a > p || b < q) return null;
  // the suggestion's own trailing punctuation is kept only where the original had it
  let text = suggest.trim();
  // the suggestion's closing punctuation, where the original goes on with its own
  if (end === null && /[.;:,]$/.test(text) && /^\s*[.;:,]/.test(logical.slice(b))) text = text.replace(/[.;:,]+$/, '');
  if (end !== null && !tailAnchored && /[.]$/.test(text) && !/[.]$/.test(logical.slice(a, b))) text = text.replace(/[.]$/, '');
  // minimise: shrink the region and the text by their common leading / trailing words
  const R = wordsWithPos(logical.slice(a, b)), T = wordsWithPos(text);
  let i = 0;
  while (i < R.length - 1 && i < T.length - 1 && R[i].raw === T[i].raw && a + R[i].b <= p) i++;
  let j = 0;
  while (j < R.length - 1 - i && j < T.length - 1 - i && R[R.length - 1 - j].raw === T[T.length - 1 - j].raw && a + R[R.length - 1 - j].a >= q) j++;
  const ra = a + (i ? R[i].a : 0), rb = a + (j ? R[R.length - 1 - j].b : (b - a));
  const ta = i ? T[i].a : 0, tb = j ? T[T.length - 1 - j].b : text.length;
  let out = text.slice(ta, tb);
  const core = (w) => (w.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/u) ?? [''])[0];
  // a suggestion that restates words the original already has just outside the region (its
  // tail repeats what follows, or its head what precedes, within three words): the region
  // grows over them instead of printing them twice
  const O = wordsWithPos(out);
  let ra2 = ra;
  let rb2 = rb;
  {
    const A2 = wordsWithPos(logical.slice(rb, rb + 400));
    // the original's next words (from within three of the region's end) reappear inside the
    // suggestion, three or more in a row: the suggestion already says them, so the region covers them
    let best = null;
    for (let k = 0; k <= 3 && k < A2.length; k++) {
      for (let i = 0; i < O.length; i++) {
        let m = 0;
        while (i + m < O.length && k + m < A2.length && core(O[i + m].raw) && core(O[i + m].raw) === core(A2[k + m].raw)) m++;
        if (m >= 3 && (!best || m > best.m)) best = { k, m, i };
      }
    }
    if (best) rb2 = rb + A2[best.k + best.m - 1].b;
    const before = logical.slice(Math.max(0, ra - 400), ra);
    const B2 = wordsWithPos(before);
    let bestB = null;
    for (let k = 0; k <= 3 && k < B2.length; k++) {
      const endB = B2.length - 1 - k; // the word k before the region
      for (let i = O.length - 1; i >= 0; i--) {
        let m = 0;
        while (i - m >= 0 && endB - m >= 0 && core(O[i - m].raw) && core(O[i - m].raw) === core(B2[endB - m].raw)) m++;
        if (m >= 3 && (!bestB || m > bestB.m)) bestB = { k, m, i };
      }
    }
    if (bestB) ra2 = ra - (before.length - B2[B2.length - 1 - bestB.k - bestB.m + 1].a);
  }
  // never splice a word next to its own copy: "as" + "as the …" → "as the …"
  const prevWord = /(\S+)\s*$/.exec(logical.slice(0, ra2))?.[1] ?? '';
  const nextWord = /^\s*(\S+)/.exec(logical.slice(rb2))?.[1] ?? '';
  const first = /^(\S+)(\s+|$)/.exec(out), last = /(^|\s+)(\S+)$/.exec(out);
  if (first && core(first[1]) && core(first[1]) === core(prevWord)) out = out.slice(first[0].length);
  if (last && out && core(last[2]) && core(last[2]) === core(nextWord)) out = out.slice(0, out.length - last[0].length);
  if (!out.trim()) { const sep = /^\s*[\/,;·]\s*/.exec(logical.slice(rb)); if (sep) rb2 = rb + sep[0].length; }
  // a suggestion opening with "(" (or closing with ")") beside the original's own bracket would double it
  if (out.startsWith('(') && /\(\s*$/.test(logical.slice(0, ra2))) out = out.slice(1);
  if (out.endsWith(')') && /^\s*\)/.test(logical.slice(rb2))) out = out.slice(0, -1);
  return { a: ra2, b: rb2, text: out };
}

/** the comment block / md paragraph around a line, as one logical string with an offset map */
function logicalBlock(m, lineIdx, kind) {
  const L = m.lines;
  const isComment = (l) => /^\s*(\/\/|\/\*|\*|#)/.test(l);
  const inBlock = kind === 'md' ? (k) => L[k] !== undefined && L[k].trim() !== '' && !/^#{1,6}\s/.test(L[k]) && !/^\s*[-*|]\s/.test(L[k])
    : kind === 'comment' ? (k) => L[k] !== undefined && isComment(L[k]) && !/^\s*(\/\/|\*)\s*$/.test(L[k]) : () => false;
  let a = lineIdx, b = lineIdx;
  if (kind !== 'line') {
    while (a > 0 && lineIdx - a < 10 && inBlock(a - 1)) a--;
    while (b < L.length - 1 && b - lineIdx < 10 && inBlock(b + 1)) b++;
  }
  let logical = '';
  const map = []; // logical index → absolute offset
  for (let k = a; k <= b; k++) {
    const raw = L[k];
    const pre = kind === 'comment' ? (/^\s*(?:\/\/+|\/\*+|\*+(?!\/))\s?/.exec(raw)?.[0] ?? '') : kind === 'md' && k > a ? (/^\s*/.exec(raw)[0]) : '';
    if (k > a) { map.push(m.offs[k] - 1); logical += ' '; }
    for (let c = pre.length; c < raw.length; c++) { map.push(m.offs[k] + c); logical += raw[c]; }
  }
  map.push(m.offs[b] + L[b].length);
  return { logical, map, from: a, to: b };
}

/** a string literal's content (between its quotes), as a logical block */
function literalBlock(m, lit) {
  const map = [];
  let logical = '';
  for (let o = lit.s + 1; o < lit.e - 1; o++) { map.push(o); logical += m.text[o] === '\n' ? ' ' : m.text[o]; }
  map.push(lit.e - 1);
  return { logical, map, from: 0, to: 0 };
}

/** the code of a JS/TS file with every string and template blanked: an edit to comments
 *  and string CONTENTS leaves it unchanged, anything else is a broken rewrite */
export function codeShape(text) {
  try { return tokenize(text).map((t) => (t.t === 'str' || t.t === 'tmpl' || t.t === 're' ? `<${t.t}>` : t.v)).join(' '); } catch (e) { return `<untokenizable: ${e.message}>`; }
}

/** the edits that turn `a` into `b`, word by word (an LCS over word-and-space tokens) */
export function diffEdits(a, b) {
  const A = a.match(/\s+|[^\s]+/g) ?? [], B = b.match(/\s+|[^\s]+/g) ?? [];
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const edits = [];
  let i = 0, j = 0, pa = 0, cur = null;
  const flush = () => { if (cur) { edits.push(cur); cur = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { flush(); pa += A[i].length; i++; j++; }
    else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) { cur ??= { a: pa, b: pa, text: '' }; cur.text += B[j]; j++; }
    else { cur ??= { a: pa, b: pa, text: '' }; pa += A[i].length; cur.b = pa; i++; }
  }
  flush();
  return edits;
}

/* ── edit lists and position mapping ── */
export function applyEdits(text, edits) {
  const es = edits.slice().sort((x, y) => x.a - y.a || x.b - y.b);
  for (let i = 1; i < es.length; i++) if (es[i].a < es[i - 1].b) throw new Error(`overlapping edits at ${es[i].a}`);
  let out = '', pos = 0;
  for (const e of es) { out += text.slice(pos, e.a) + e.text; pos = e.b; }
  return out + text.slice(pos);
}
/** map an old [a, b) through sorted, non-overlapping edits to the new text's [a', b') */
export function mapRange(edits, a, b) {
  const es = edits.slice().sort((x, y) => x.a - y.a);
  let da = 0, db = 0, na = null, nb = null;
  for (const e of es) {
    const d = e.text.length - (e.b - e.a);
    if (e.b <= a) da += d;
    else if (e.a < a && na === null) na = e.a + da; // a falls inside the edit: widen to its start
    if (e.b <= b) db += d;
    else if (e.a < b && nb === null) nb = e.a + db + e.text.length; // b falls inside: widen to its end
  }
  return [na ?? a + da, nb ?? b + db];
}

/* ── the main pass ── */
export function recite({ cites, decisions = loadDecisions(), dryRun = false, root = REPO_ROOT, skipFiles = [], handFiles: handList = null } = {}) {
  // every file the hand step edits (any op): the mention pass leaves them to it
  const handFiles = new Set(handList ?? (() => { try { return Object.keys(JSON.parse(readFileSync(join(HERE, 'hand', 'manifest.json'), 'utf8')).files); } catch { return []; } })());
  // a file the hand step owns whole is written there, citations included: never rewritten here
  const skip = new Set(skipFiles);
  const rows = cites.rows.filter((r) => !skip.has(r.file));
  const visible = existsSync(VISIBLE_JSON) ? JSON.parse(readFileSync(VISIBLE_JSON, 'utf8')).entries : [];
  const report = { rows: rows.length, handOwned: cites.rows.length - rows.length, byKind: {}, bySrc: {}, leave: [], dropUnapplied: [], rewordUnapplied: [], coveredByReword: 0,
    visible: { applied: 0, missing: [] }, titles: 0, bindings: { rewritten: 0, unresolved: [] }, requoted: { evidence: 0, sides: 0, needles: 0, failed: [] },
    glossary: { rows: 0, left: [] }, jsonRows: { applied: 0, notFound: [] }, files: 0, notFound: [] };
  const inc = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  const models = new Map();
  const model = (rel) => { if (!models.has(rel)) models.set(rel, fileModel(readFileSync(join(root, rel), 'utf8'), rel)); return models.get(rel); };
  const editsOf = new Map(); // rel → [{a,b,text,why}]
  const addEdit = (rel, e) => { (editsOf.get(rel) ?? editsOf.set(rel, []).get(rel)).push(e); };
  const consumed = new Set(); // row ids already handled by a wider edit

  /* 0. the visible-strings table: exact substrings, hand-written words */
  for (const v of visible) {
    const m = model(v.file);
    const at = [];
    for (let k = m.text.indexOf(v.find); k >= 0; k = m.text.indexOf(v.find, k + 1)) at.push(k);
    if (!at.length || (at.length > 1 && !v.all)) { report.visible.missing.push(`${v.file}: ${at.length ? 'found twice' : 'not found'}: ${v.find.slice(0, 60)}`); continue; }
    for (const i of at) {
      addEdit(v.file, { a: i, b: i + v.find.length, text: v.replace, why: 'visible' });
      report.visible.applied++;
      for (const r of rows) if (r.file === v.file && r.line && m.offs[r.line - 1] + r.col >= i && m.offs[r.line - 1] + r.col < i + v.find.length) consumed.add(r.id);
    }
  }

  /* 0a. line pseudo-ids (`line:<file>:<original line>`): an exact find/replace on a line no citation
   *     row names (a fix text, a title, a proof clause), found within ±3 lines of that line, once */
  report.lineEdits = { applied: 0, failed: [] };
  for (const [id, d] of decisions) {
    const m0 = /^line:(.+):(\d+)$/.exec(id);
    if (!m0 || !d.find) continue;
    const [, rel, ln] = m0;
    if (!existsSync(join(root, rel))) { report.lineEdits.failed.push(`${id}: no such file`); continue; }
    const m = model(rel);
    const i = Number(ln) - 1;
    const lo = m.offs[Math.max(0, i - 3)], hi = m.offs[Math.min(m.lines.length, i + 4)] ?? m.text.length;
    const win = m.text.slice(lo, hi);
    const at = win.indexOf(d.find);
    if (at < 0 || win.indexOf(d.find, at + 1) >= 0) { report.lineEdits.failed.push(`${id}: find ${at < 0 ? 'not found' : 'found twice'} near line ${ln}`); continue; }
    addEdit(rel, { a: lo + at, b: lo + at + d.find.length, text: d.replace ?? '', why: `line ${id}` });
    report.lineEdits.applied++;
    for (const r of rows) if (r.file === rel && r.line) { const o = m.offs[r.line - 1] + r.col; if (o >= lo + at && o < lo + at + d.find.length) consumed.add(r.id); }
  }

  /* 0b. card-todo proof needles are re-cut from their target file, never cited on their own */
  const needleSpans = new Map(); // rel → [{s, e}]
  for (const rel of ['client/ledgers/card-todo.ts']) {
    if (!existsSync(join(root, rel))) continue;
    const m = model(rel);
    const toks = tokenize(m.text);
    const spans = [];
    for (let k = 0; k < toks.length; k++) {
      if (toks[k].t !== 'id' || !['still', 'body', 'rx'].includes(toks[k].v) || toks[k + 1]?.v !== '(' || toks[k - 1]?.v === '.') continue;
      if (toks[k + 2]?.t !== 'str') continue;
      const target = toks[k + 2].v;
      for (let j = k + 3; j < toks.length && toks[j].v !== ')'; j++) if (toks[j].t === 'str' || toks[j].t === 're') spans.push({ s: toks[j].s, e: toks[j].e, target, tok: toks[j], fn: toks[k].v });
    }
    needleSpans.set(rel, spans);
    for (const r of rows) if (r.file === rel && r.line) {
      const off = m.offs[r.line - 1] + r.col;
      if (spans.some((x) => x.s <= off && off < x.e)) consumed.add(r.id);
    }
  }

  /* 1. glossary.ts `ruling: [...]` → `rule: [<cr key>...]` (done in step 4 off the decisions) */
  const glossRows = new Set();
  if (existsSync(join(root, GLOSSARY_TS))) {
    const m = model(GLOSSARY_TS);
    for (const r of rows) if (r.file === GLOSSARY_TS && r.line && /\bruling:\s*\[/.test(m.lines[r.line - 1]) && strAt(m, m.offs[r.line - 1] + r.col)) {
      const s = strAt(m, m.offs[r.line - 1] + r.col);
      if (/^.R\d{1,3}b?.$/.test(m.text.slice(s.s, s.e))) { glossRows.add(r.id); consumed.add(r.id); }
    }
  }

  /* 1b. QUOTES ARE FROZEN (audit 2026-10-11): a citation inside a quotation — a ledger's `evidence:`
   *     string, a "double-quoted" or “curly-quoted” span in a comment, a string or a doc, a question
   *     sheet (the owner's own Q&A) — is left verbatim: rewriting it would make the quote say what its
   *     source never said. Only a polish-* decision (the line-level review) may still touch one. */
  const frozenSpans = new Map(); // rel → [[a, b]]
  report.frozenQuotes = 0;
  const addFrozen = (rel, a, b) => (frozenSpans.get(rel) ?? frozenSpans.set(rel, []).get(rel)).push([a, b]);
  const filesWithRows = [...new Set(rows.filter((r) => r.line).map((r) => r.file))];
  for (const rel of filesWithRows) {
    if (!existsSync(join(root, rel))) continue;
    const m = model(rel);
    if (/^client\/docs\/questions-round\d+\.md$/.test(rel)) { addFrozen(rel, 0, m.text.length); continue; }
    if (/^client\/ledgers\/.*\.ts$/.test(rel)) {
      let toks = null; try { toks = tokenize(m.text); } catch { toks = null; }
      for (let k = 0; toks && k < toks.length; k++) {
        if (toks[k].t === 'id' && toks[k].v === 'evidence' && toks[k + 1]?.v === ':' && toks[k - 1]?.v !== '.') {
          let j = k + 2;
          while (toks[j] && (toks[j].t === 'str' || toks[j].t === 'tmpl')) { addFrozen(rel, toks[j].s, toks[j].e); j += toks[j + 1]?.v === '+' ? 2 : 1; }
        }
      }
    }
    // quoted spans, line by line; a JS string's own delimiters are not quotation marks
    const delim = new Set(m.strs.flatMap((x) => [x.s, x.e - 1]));
    for (let li = 0; li < m.lines.length; li++) {
      const L = m.lines[li];
      if (!/\bR\d/.test(L)) continue;
      const off = m.offs[li];
      const straight = [];
      for (let c = 0; c < L.length; c++) {
        if (L[c] === '"' && !delim.has(off + c) && !rel.endsWith('.json')) straight.push(c);
        else if (L[c] === '“') { const e = L.indexOf('”', c + 1); if (e > c) { addFrozen(rel, off + c, off + e + 1); c = e; } }
      }
      for (let q = 0; q + 1 < straight.length; q += 2) addFrozen(rel, off + straight[q], off + straight[q + 1] + 1);
    }
  }
  const polishDecided = (id) => /^polish/.test(String(decisions.get(id)?.unit ?? ''));
  const inFrozen = (rel, o) => (frozenSpans.get(rel) ?? []).some(([a, b]) => a <= o && o < b);
  for (const r of rows) {
    if (!r.line || consumed.has(r.id) || polishDecided(r.id) || !existsSync(join(root, r.file))) continue;
    const m = model(r.file);
    if (inFrozen(r.file, m.offs[r.line - 1] + r.col)) { consumed.add(r.id); report.frozenQuotes++; }
  }

  /* 2. text files: rows → groups → edits */
  const byLine = new Map();
  for (const r of rows) {
    if (r.line === null || r.line === undefined) continue;
    if (consumed.has(r.id)) continue;
    const k = `${r.file}\u0000${r.line}`;
    (byLine.get(k) ?? byLine.set(k, []).get(k)).push(r);
  }
  const G = [];
  for (const [k, rs] of byLine) {
    const [rel, ln] = k.split('\u0000');
    if (!existsSync(join(root, rel))) { report.notFound.push(rel); continue; }
    const m = model(rel);
    const idx = Number(ln) - 1;
    const line = m.lines[idx];
    if (line === undefined) { report.notFound.push(`${rel}:${ln}`); continue; }
    for (const g of groupsOf(line)) {
      const members = g.members.map((t) => ({ t, row: rs.find((r) => r.col === t.a) })).filter((x) => x.row);
      if (!members.length) continue;
      const acts = members.map((x) => ({ ...x, act: actionOf(x.row, decisions) }));
      for (const x of acts) { inc(report.byKind, x.act.kind); inc(report.bySrc, `${x.act.kind}:${x.act.src ?? '-'}`); }
      if (acts.every((x) => x.act.kind === 'skip' || x.act.kind === 'binding')) continue;
      // a group that mixes in a non-citation (fp) token is left whole
      if (members.length < g.members.length || acts.some((x) => x.act.kind === 'skip' || x.act.kind === 'binding')) {
        for (const x of acts) if (!['skip', 'binding'].includes(x.act.kind)) report.leave.push({ id: x.row.id, file: rel, line: Number(ln), why: 'group mixes a non-citation token', text: normLine(line).slice(0, 160) });
        continue;
      }
      // "pre-R154", "post-R200": a time named by the ruling — never a script pick
      if (/\b(?:pre|post|non)-$/i.test(line.slice(Math.max(0, g.a - 5), g.a))) for (const x of acts) if (['unique', 'scored', 'binding', 'process', 'process-obsolete'].includes(x.act.src)) x.act = { kind: 'leave', why: 'historical: a pre-/post- compound (pending a decision)', pending: 'historical', src: 'auto' };
      // a reword with neither words nor a number says nothing the script can apply
      for (const x of acts) if (x.act.kind === 'reword' && !x.act.suggest && !x.act.nums?.length) x.act = { kind: 'leave', why: 'reword with no suggestion', src: x.act.src };
      G.push({ rel, m, idx, ln: Number(ln), line, g, acts, exact: acts.find((x) => x.act.kind === 'exact') ?? null, reword: acts.find((x) => x.act.kind === 'reword' && x.act.suggest) ?? null });
    }
  }
  // an edit may not cross another edit, nor reach into a frozen quotation
  const overlaps = (rel, A, B, polish = false) => (editsOf.get(rel) ?? []).some((e) => A < e.b && e.a < B)
    || (!polish && (frozenSpans.get(rel) ?? []).some(([a, b]) => A < b && a < B));
  // phase A: rewords (they can span lines and cover other citations), then phase B: the rest
  for (const phase of ['exact', 'reword', 'rest']) {
    for (const it of G) {
      const ph = it.exact ? 'exact' : it.reword ? 'reword' : 'rest';
      if (ph !== phase) continue;
      const { rel, m, idx, ln, line, g, acts } = it;
      const pol = acts.some((x) => polishDecided(x.row.id));
      if (acts.some((x) => consumed.has(x.row.id))) continue;
      if (it.exact) {
        // an exact find/replace from a fix-up decision: `find` must hold the citation, once, within ±12 lines
        const lo = m.offs[Math.max(0, idx - 12)], hi = m.offs[Math.min(m.lines.length, idx + 13)] ?? m.text.length;
        const win = m.text.slice(lo, hi), at = m.offs[idx] + g.a;
        const hits = []; let k = -1;
        while ((k = win.indexOf(it.exact.act.find, k + 1)) >= 0) hits.push(lo + k);
        const h = hits.filter((x) => x <= at && at < x + it.exact.act.find.length);
        const lit = strAt(m, at);
        if (h.length !== 1 || overlaps(rel, h[0], h[0] + it.exact.act.find.length, pol)) { report.rewordUnapplied.push({ id: it.exact.row.id, file: rel, line: ln, suggest: it.exact.act.replace, text: normLine(line).slice(0, 200), why: `exact find ${h.length ? 'overlaps' : 'not found around the citation'}` }); continue; }
        // inside one string literal, the replacement may not end the literal early: escape its delimiter
        const litA = strAt(m, h[0]), litB = strAt(m, h[0] + it.exact.act.find.length - 1);
        let repl = it.exact.act.replace;
        if (litA && litA === litB && litA.q !== '`' && h[0] > litA.s && h[0] + it.exact.act.find.length < litA.e - 1) repl = repl.replace(new RegExp(`(?<!\\\\)${litA.q}`, 'g'), `\\${litA.q}`);
        addEdit(rel, { a: h[0], b: h[0] + it.exact.act.find.length, text: repl, why: `exact ${it.exact.row.id}` });
        for (const r2 of rows) if (r2.file === rel && r2.line) { const o = m.offs[r2.line - 1] + r2.col; if (o >= h[0] && o < h[0] + it.exact.act.find.length) consumed.add(r2.id); }
        void lit;
        continue;
      }
      const leave = acts.filter((x) => x.act.kind === 'leave');
      if (leave.length) {
        for (const x of leave) report.leave.push({ id: x.row.id, file: rel, line: ln, why: x.act.why, text: normLine(line).slice(0, 160) });
        continue;
      }
      const abs = m.offs[idx];
      const lit = strAt(m, abs + g.a);
      const title = m.titles.find((t) => t.s <= abs + g.a && abs + g.a < t.e);
      const rw = it.reword;
      let e = null;
      if (rw) {
        const kind = lit ? 'line' : /\.md$/.test(rel) ? 'md' : /^\s*(\/\/|\/\*|\*|#)/.test(line) || line.slice(0, g.a).includes('//') ? 'comment' : 'line';
        const blk = lit ? literalBlock(m, lit) : logicalBlock(m, idx, kind);
        const p = blk.map.indexOf(abs + g.a), q = blk.map.indexOf(abs + g.b - 1) + 1;
        const r = p >= 0 && q > 0 ? anchorReword(blk.logical, p, q, cleanSuggest(rw.act.suggest, lit?.q)) : null;
        if (r) {
          const A = blk.map[r.a], B = r.b >= blk.map.length ? blk.map.at(-1) : (r.b === 0 ? blk.map[0] : blk.map[r.b - 1] + 1);
          const outside = lit && (A <= lit.s || B >= lit.e);
          if (!outside && !overlaps(rel, A, B, pol)) {
            e = { a: A, b: B, text: lit ? esc(r.text, lit.q) : r.text, why: `reword ${rw.row.id}` };
            for (const r2 of rows) if (r2.file === rel && r2.line && r2.id !== rw.row.id && !acts.some((x) => x.row.id === r2.id)) {
              const o = m.offs[r2.line - 1] + r2.col;
              if (o >= A && o < B && !consumed.has(r2.id)) { consumed.add(r2.id); report.coveredByReword++; }
            }
          }
        }
        if (!e) { report.rewordUnapplied.push({ id: rw.row.id, file: rel, line: ln, suggest: rw.act.suggest, text: normLine(line).slice(0, 200), why: r ? 'overlaps another edit or leaves its string' : 'no anchor' }); continue; }
      } else {
        const nums = acts.flatMap((x) => (x.act.kind === 'cite' ? x.act.nums : x.act.kind === 'reword' ? x.act.nums : []));
        const pointers = [...new Set(acts.filter((x) => x.act.kind === 'pointer').map((x) => x.act.pointer))];
        let le = null;
        if (title && abs + g.a <= title.s + 2 && !lit?.q?.match(/`/)) {
          le = titlePrefixEdit(line, g, title.s - abs + 1, nums.length ? [...new Set(nums)] : null);
        }
        if (!le) {
          if (nums.length) le = citeEdit(line, g, nums);
          else if (pointers.length === 1) le = pointerEdit(line, g, pointers[0], rel, lit ? Math.min(line.length, lit.e - 1 - abs) : line.length);
          else if (acts.every((x) => x.act.kind === 'drop' || x.act.kind === 'pointer')) le = dropEdit(line, g);
        }
        if (!le) { for (const x of acts) report.dropUnapplied.push({ id: x.row.id, file: rel, line: ln, kind: x.act.kind, text: normLine(line).slice(0, 200) }); continue; }
        e = { a: abs + le.a, b: abs + le.b, text: lit ? esc(le.text, lit.q) : le.text, why: acts.map((x) => x.act.kind).join('+') };
        if (overlaps(rel, e.a, e.b, pol)) { for (const x of acts) report.dropUnapplied.push({ id: x.row.id, file: rel, line: ln, kind: `${x.act.kind} (overlaps another edit)`, text: normLine(line).slice(0, 200) }); continue; }
      }
      for (const x of acts) consumed.add(x.row.id);
      addEdit(rel, e);
    }
  }
  /* 3. JSON rows (a CR record's text or example text): matched by record, field and leaf text */
  const jsonRows = rows.filter((r) => (r.line === null || r.line === undefined) && !consumed.has(r.id));
  const jsonFiles = new Map();
  for (const r of jsonRows) {
    const act = actionOf(r, decisions);
    if (act.kind === 'skip' || act.kind === 'binding') continue;
    inc(report.byKind, act.kind); inc(report.bySrc, `${act.kind}:${act.src ?? '-'}`);
    if (act.kind === 'leave') { report.leave.push({ id: r.id, file: r.file, field: r.field, why: act.why, text: r.context?.text?.slice(0, 160) }); continue; }
    (jsonFiles.get(r.file) ?? jsonFiles.set(r.file, []).get(r.file)).push({ r, act });
  }

  /* 4. glossary rows: `ruling: ['R13', 'printed']` → `cites: ['<cr key>', 'printed']` (`rule` is taken: the authored sentence), as a positional
   *    edit on the array (a comment elsewhere on the line is recited on its own) */
  const ledger = JSON.parse(readFileSync(join(root, 'data/comprehensive-rules/ledger.json'), 'utf8'));
  const keyOfNum = new Map(ledger.entries.filter((e) => !e.removed).map((e) => [e.num, e.key]));
  if (existsSync(join(root, GLOSSARY_TS))) {
    const m = model(GLOSSARY_TS);
    const rowsByLine = new Map();
    for (const r of rows) if (glossRows.has(r.id)) (rowsByLine.get(r.line) ?? rowsByLine.set(r.line, []).get(r.line)).push(r);
    for (let i = 0; i < m.lines.length; i++) {
      const L = m.lines[i];
      const mm = /\bruling:\s*\[([^\]]*)\]/.exec(L);
      if (!mm || /^\s*(\/\/|\*|\/\*)/.test(L)) continue;
      const rs = rowsByLine.get(i + 1) ?? [];
      const items = [...mm[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]);
      const keys = [];
      let left = false;
      for (const it of items) {
        const c = /^R(\d{1,3})(b?)$/.exec(it);
        if (!c) { keys.push(it); continue; }
        const r = rs.find((x) => x.ruling === `R${Number(c[1])}${c[2]}`);
        let act = r ? actionOf(r, decisions) : { kind: 'leave', why: 'no census row' };
        // an array item is a source list, never a sentence about history: the script's pick stands
        if (act.pending === 'historical' && r.pick) act = { kind: 'cite', nums: [r.pick], src: r.method };
        // an array item has no prose to reword: a reword's numbers are the rule it rests on
        if (act.kind === 'cite' || (act.kind === 'reword' && act.nums?.length)) for (const n of act.nums) { const k = keyOfNum.get(n); if (k) keys.push(k); else { report.glossary.left.push(`line ${i + 1} ${it}: ${n} is no live rule`); left = true; } }
        else if (act.kind === 'drop' || act.kind === 'pointer') { /* the source goes */ }
        else { report.glossary.left.push(`line ${i + 1} ${it}: ${act.why ?? act.kind}`); left = true; }
      }
      if (left) continue;
      const a = m.offs[i] + mm.index;
      addEdit(GLOSSARY_TS, { a, b: a + mm[0].length, text: `cites: [${[...new Set(keys)].map((k) => `'${k}'`).join(', ')}]`, why: 'glossary rule keys' });
      report.glossary.rows++;
    }
  }

  /* apply the text edits (in memory) */
  const before = new Map(), after = new Map();
  for (const [rel, es] of editsOf) {
    const m = model(rel);
    try { after.set(rel, applyEdits(m.text, es)); before.set(rel, m.text); }
    catch (err) { report.notFound.push(`${rel}: ${err.message}`); }
  }
  // tidy what a removal leaves behind, on the touched lines only
  for (const [rel, t] of after) after.set(rel, t);

  /* 5. test titles: old → new, by re-tokenizing each changed test file */
  const titleMap = new Map(); // `${basename}` → [{old, neu}]
  const titleLists = new Map(); // `${basename}` → {olds, news}: every title, before and after
  for (const [rel, t] of after) {
    if (!/\.(ts|mts|mjs|js)$/.test(rel)) continue;
    const olds = model(rel).titles;
    if (!olds.length) continue;
    let news;
    try { news = titlesOf(tokenize(t)); } catch { news = null; }
    if (!news || news.length !== olds.length) { report.notFound.push(`${rel}: title count changed under the rewrite`); continue; }
    const pairs = [];
    olds.forEach((o, i) => { if (o.title !== news[i].title) pairs.push({ old: o.title, neu: news[i].title }); });
    if (pairs.length) { titleMap.set(basename(rel), pairs); report.titles += pairs.length; }
    titleLists.set(basename(rel), { olds: olds.map((o) => o.title), news: news.map((n) => n.title) });
  }
  /** a needle cut from an old title → the same cut of the new title (or null) */
  const recut = (file, needle) => {
    const pairs = titleMap.get(file);
    if (!pairs) return null;
    const p = pairs.find((x) => x.old.includes(needle));
    if (!p) return null;
    const i = p.old.indexOf(needle);
    const e = diffEdits(p.old, p.neu);
    const [a, b] = mapRange(e, i, i + needle.length);
    let out = p.neu.slice(a, b);
    // a needle that started at the title's start keeps starting there; trim a separator the strip left
    out = out.replace(/^\s+/, '');
    if (!out) return null;
    // the cut must find as many titles as the old needle did; when renaming made two titles
    // share it ("R290 Cinder" and "R291 Cinder" both became "CR 900.6 Cinder"), bind the whole title
    const L = titleLists.get(file);
    if (L) {
      const before = L.olds.filter((t) => t.includes(needle)).length;
      const after = L.news.filter((t) => t.includes(out)).length;
      if (after > before) {
        // the shortest word-boundary prefix of the new title that is as unique as the old needle
        // was, stopping short of a quote (a ledger reader compares raw source text), else the title
        out = p.neu;
        const cut = p.neu.search(/['"`\\]/);
        for (const m of p.neu.matchAll(/\s/g)) {
          const pre = p.neu.slice(0, m.index);
          if (cut >= 0 && pre.length > cut) break;
          if (pre.length >= 12 && L.news.filter((t) => t.includes(pre)).length <= before) { out = pre; break; }
        }
      }
    }
    return out;
  };

  /* 6. bindings: every `<file>.test.ts::<needle>` string in client/ code and in the CR records */
  const BIND = /(['"`])(\d{1,3}-[\w.-]+\.test\.ts)::((?:\\.|(?!\1).)*)\1/g;
  const clientFiles = listFiles(root, 'client').filter((f) => /\.(ts|mts|mjs|js|md)$/.test(f) && !f.includes('/node_modules/') && !f.startsWith('client/engine/scripts/cr/migrate/') && f !== 'client/docs/digital-rules.md');
  for (const rel of clientFiles) {
    if (skip.has(rel)) continue;
    const t0 = after.get(rel) ?? readFileSync(join(root, rel), 'utf8');
    if (!/\.test\.ts::/.test(t0)) continue;
    let changed = false;
    // a binding quoted inside frozen evidence is part of the quotation: it stays as it was
    const fz = (frozenSpans.get(rel) ?? []).map(([a, b]) => mapRange(editsOf.get(rel) ?? [], a, b));
    const t1 = t0.replace(BIND, (all, q, file, raw, at) => {
      if (fz.some(([a, b]) => a <= at && at < b)) return all;
      const needle = unescapeJs(raw);
      if (!/\bR\d{1,3}b?\b/.test(needle) && !titleMap.has(file)) return all;
      const neu = recut(file, needle);
      if (neu === null) { if (/\bR\d{1,3}b?\b/.test(needle)) report.bindings.unresolved.push(`${rel}: ${file}::${needle.slice(0, 80)}`); return all; }
      if (neu === needle) return all;
      changed = true; report.bindings.rewritten++;
      return `${q}${file}::${esc(neu, q)}${q}`;
    });
    if (changed) { after.set(rel, t1); if (!before.has(rel)) before.set(rel, t0); }
  }
  const jsonOut = new Map(); // abs → text
  for (const f of readdirSync(join(root, relative(REPO_ROOT, CR_RULES_DIR))).filter((x) => x.endsWith('.json'))) {
    const abs = join(root, relative(REPO_ROOT, CR_RULES_DIR), f);
    const text = readFileSync(abs, 'utf8');
    const j = JSON.parse(text);
    let changed = false;
    for (const rec of j) {
      for (const ex of rec.examples ?? []) {
        if (!ex?.test) continue;
        const [file, ...rest] = ex.test.split('::');
        const needle = rest.join('::');
        if (!titleMap.has(file)) continue;
        const pairs = titleMap.get(file);
        const exact = pairs.find((x) => x.old === needle);
        const neu = exact ? exact.neu : recut(file, needle);
        if (neu && neu !== needle) { ex.test = `${file}::${neu}`; changed = true; report.bindings.rewritten++; }
        else if (!neu && /\bR\d{1,3}b?\b/.test(needle)) report.bindings.unresolved.push(`${f} ${rec.key}: ${ex.test.slice(0, 100)}`);
      }
    }
    /* JSON citation rows in this file (a record's text, an example's text) */
    const rel = relative(root, abs);
    for (const { r, act } of jsonFiles.get(rel) ?? []) {
      const hash = r.id.split('#')[3];
      const rec = Array.isArray(j) ? j[r.jsonRow] : null;
      const leafKey = String(r.field).split('.');
      const cands = [];
      const walk = (o, path) => {
        if (typeof o === 'string') { if (path.join('.') === r.field && sha(normLine(o)) === hash) cands.push({ o, set: null }); return; }
        if (Array.isArray(o)) o.forEach((x, i) => { if (typeof x === 'string') { if (path.join('.') === r.field && sha(normLine(x)) === hash) cands.push({ o: x, set: (v) => { o[i] = v; } }); } else walk(x, path); });
        else if (o && typeof o === 'object') for (const [k2, v] of Object.entries(o)) { if (typeof v === 'string') { if ([...path, k2].join('.') === r.field && sha(normLine(v)) === hash) cands.push({ o: v, set: (nv) => { o[k2] = nv; } }); } else walk(v, [...path, k2]); }
      };
      walk(rec, []);
      void leafKey;
      if (cands.length !== 1 || !cands[0].set) { report.jsonRows.notFound.push(`${rel} #${r.jsonRow} ${r.field}`); continue; }
      const s = cands[0].o;
      const g = groupsOf(s).find((x) => x.members.some((t) => t.a === r.col));
      let le = null;
      if (g && act.kind === 'cite') le = citeEdit(s, g, act.nums);
      else if (g && act.kind === 'drop') le = dropEdit(s, g);
      else if (g && act.kind === 'reword' && act.suggest) { const x = anchorReword(s, g.a, g.b, act.suggest); if (x) le = x; }
      else if (g && act.kind === 'pointer') le = pointerEdit(s, g, act.pointer, rel, s.length);
      if (!le) { report.dropUnapplied.push({ id: r.id, file: rel, kind: act.kind, text: s.slice(0, 160) }); continue; }
      cands[0].set(s.slice(0, le.a) + le.text + s.slice(le.b));
      changed = true; report.jsonRows.applied++;
    }
    if (changed) jsonOut.set(abs, JSON.stringify(j, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : ''));
  }

  /* 7. requote: quotes of files this pass changed */
  const fileEdits = (rel) => editsOf.get(rel) ?? null;
  const requote = (rel, quote) => {
    const es = fileEdits(rel);
    if (!es || !before.has(rel)) return null;
    const old = before.get(rel), neu = after.get(rel);
    const nq = normLine(quote);
    if (neu.replace(/\s+/g, ' ').includes(nq)) return null; // still verbatim
    const lines = old.split('\n');
    let off = 0;
    for (const L of lines) {
      const nl = L.replace(/\s+/g, ' ');
      const at = nl.indexOf(nq);
      if (at >= 0) {
        // map the normalised index back to raw columns
        const map = []; let prevWs = false;
        for (let c = 0; c < L.length; c++) { const ws = /\s/.test(L[c]); if (ws && prevWs) continue; map.push(c); prevWs = ws; }
        map.push(L.length);
        const a = off + map[at], b = off + (map[at + nq.length - 1] ?? L.length - 1) + 1;
        const [na, nb] = mapRange(es, a, b);
        return neu.slice(na, nb).replace(/\n\s*(?:\/\/+|\*)?\s*/g, ' ');
      }
      off += L.length + 1;
    }
    return undefined;
  };
  const norel = (f) => String(f).replace(/^file:\s*/, '').trim();
  for (const [dir, kind] of [[CR_FINDINGS_DIR, 'evidence'], [CR_DISCREPANCIES_DIR, 'sides']]) {
    for (const f of readdirSync(join(root, relative(REPO_ROOT, dir))).filter((x) => x.endsWith('.json'))) {
      const abs = join(root, relative(REPO_ROOT, dir), f);
      const text = jsonOut.get(abs) ?? readFileSync(abs, 'utf8');
      const j = JSON.parse(text);
      let changed = false;
      for (const row of j) {
        const list = kind === 'evidence' ? (row.evidence ?? []).map((e) => [e, e.file]) : (row.sides ?? []).filter((s) => /^file:/.test(s.source ?? '')).map((s) => [s, norel(s.source)]);
        for (const [o, file] of list) {
          const nq = requote(file, o.quote ?? '');
          if (nq === null) continue;
          if (nq === undefined || !nq) { report.requoted.failed.push(`${f} ${row.id}: ${file}: ${String(o.quote).slice(0, 60)}`); continue; }
          o.quote = nq.length > 200 ? nq.slice(0, 200) : nq; changed = true; report.requoted[kind]++;
        }
      }
      if (changed) jsonOut.set(abs, JSON.stringify(j, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : ''));
    }
  }
  // card-todo needles
  for (const [rel, spans] of needleSpans) {
    const t0 = after.get(rel) ?? model(rel).text;
    const m0 = model(rel);
    // a clause the hand step's anchored edits remove (code: a whole still() leg) is theirs, not
    // re-cut here — a re-cut needle whose sentence went would fail the words rule below
    const handSpans = [];
    try {
      const he = JSON.parse(readFileSync(join(HERE, 'hand', 'manifest.json'), 'utf8')).files[rel];
      for (const ed of (he?.op === 'edits' ? he.edits : [])) for (const mm of m0.text.matchAll(new RegExp(ed.find, 'g'))) handSpans.push([mm.index, mm.index + mm[0].length]);
    } catch { /* no manifest: nothing is the hand step's */ }
    const es = [];
    for (const sp of spans) {
      if (sp.fn === 'rx' || sp.tok.t !== 'str') continue;
      if ((editsOf.get(rel) ?? []).some((e) => sp.s < e.b && e.a < sp.e)) continue; // a hand-written edit took this clause
      if (handSpans.some(([a, b]) => sp.s < b && a < sp.e)) continue; // the hand step removes this clause
      const target = `client/${sp.target}`;
      const nq = requote(target, sp.tok.v);
      if (nq === null) continue;
      // a needle that lost its words would make the proof vacuously true (or false): never write it
      const words = (x) => (String(x).match(/[A-Za-z0-9]{3,}/g) ?? []).length;
      if (!nq || words(nq) < Math.max(1, Math.ceil(words(sp.tok.v) / 2))) {
        report.requoted.failed.push(`${rel}: still(${sp.target}, '${sp.tok.v.slice(0, 60)}') would become '${String(nq ?? '').slice(0, 40)}'`);
        report.selfCheck ??= [];
        (report.needleFailures ??= []).push({ file: rel, why: `proof needle lost its words: '${sp.tok.v.slice(0, 60)}' → '${String(nq ?? '').slice(0, 40)}'`, text: sp.tok.v.slice(0, 120) });
        continue;
      }
      const q = m0.text[sp.s];
      es.push({ a: sp.s, b: sp.e, text: `${q}${esc(nq, q)}${q}` });
      report.requoted.needles++;
    }
    if (es.length) {
      // needle edits are on the ORIGINAL text; merge them with this file's own edits
      const all = [...(editsOf.get(rel) ?? []), ...es];
      after.set(rel, applyEdits(m0.text, all)); before.set(rel, m0.text);
      void t0;
    }
  }

  /* 8. the code-shape invariant: only comments and string contents may change (glossary.ts
   *    renames `ruling:` to `rule:`; visible.json edits are string contents too) */
  report.shapeBroken = [];
  for (const [rel, t] of [...after]) {
    if (!/\.(ts|mts|mjs|js)$/.test(rel) || rel === GLOSSARY_TS) continue;
    const x = codeShape(before.get(rel) ?? model(rel).text), y = codeShape(t);
    // and it must still PARSE: a string whose closing quote a rewrite escaped can fool the tokenizer
    let parseError = null;
    if (esbuildTransform && /\.(ts|mts)$/.test(rel)) { try { esbuildTransform(t, { loader: 'ts', logLevel: 'silent' }); } catch (e) { parseError = String(e.message ?? e).split('\n').slice(0, 2).join(' '); } }
    if (parseError) { report.shapeBroken.push({ file: rel, at: `does not parse: ${parseError}` }); after.delete(rel); continue; }
    if (x !== y) {
      let i = 0; while (i < x.length && x[i] === y[i]) i++;
      report.shapeBroken.push({ file: rel, at: `…${x.slice(Math.max(0, i - 80), i + 40)}… ⇒ …${y.slice(Math.max(0, i - 80), i + 40)}…` });
      after.delete(rel);
    }
  }

  /* 9. self-check (orchestrator 2026-10-11): no rewrite may leave a doubled word, a CR number
   *    stated as reversed/superseded, or "CR x = CR x" on a line it changed */
  /* 8a. the deleted file is named nowhere as if it were still there: a markdown link to it becomes a
   *     link into the comprehensive rules (when its text cites a CR number) or plain words; a bare
   *     mention becomes "the retired ruling register". Not in the ledgers (their evidence is quoted
   *     history), the question sheets, files the hand step owns, or a quotation. */
  const CR_DOC_REL = 'data/comprehensive-rules/Algomancy-Comprehensive-Rules.md';
  report.registerMentions = 0;
  const mentionFiles = listFiles(root, 'client').filter((f) => /\.(ts|mts|mjs|md)$/.test(f) && !f.includes('/node_modules/')
    && !f.startsWith('client/ledgers/') && !f.startsWith('client/engine/scripts/cr/migrate/') && !skip.has(f) && !handFiles.has(f)
    && f !== 'client/docs/digital-rules.md' && !/^client\/docs\/questions-round\d+\.md$/.test(f));
  for (const rel of mentionFiles) {
    const t0 = after.get(rel) ?? readFileSync(join(root, rel), 'utf8');
    if (!t0.includes('digital-rules')) continue;
    const crRel = relative(dirname(join(root, rel)), join(root, CR_DOC_REL)).split('\\').join('/');
    const lines = t0.split('\n');
    let ch = false;
    for (let k = 0; k < lines.length; k++) {
      let l = lines[k];
      if (!l.includes('digital-rules')) continue;
      const q = [...l.matchAll(/"[^"]*"|“[^”]*”/g)].map((x) => [x.index, x.index + x[0].length]);
      const quoted = (i) => q.some(([a, b]) => a < i && i < b);
      const n0 = l;
      l = l.replace(/\[([^\]]*)\]\((?:\.\.\/)*(?:docs\/)?digital-rules\.md(?:#[^)]*)?\)/g, (all, text, i) => {
        if (quoted(i)) return all;
        const c = /\bCR ((?:\d{3}|D\d+)(?:\.\d+[a-z]*)?)/.exec(text);
        if (c) return `[${text}](${crRel}#r${c[1]})`;
        if (/digital-rules/.test(text)) return 'the retired ruling register';
        return `${text} (in the retired ruling register)`;
      });
      l = l.replace(/(\b(?:a|an|the|A|An|The)\s+)?`?(?:\.\.\/)?(?:client\/)?(?:docs\/)?digital-rules(?:\.md)?(?::\d+(?:-\d+)?)?`?/g, (all, art, i) => (quoted(i) ? all : `${art && /^[AT]/.test(art) ? 'The' : 'the'} retired ruling register`));
      l = l.replace(/the the retired ruling register/g, 'the retired ruling register');
      if (l !== n0) { lines[k] = l; ch = true; report.registerMentions++; }
    }
    if (ch) { after.set(rel, lines.join('\n')); if (!before.has(rel)) before.set(rel, t0); }
  }

  /* 8b. tidy, on the lines this pass changed: two retired numbers that now read as ONE rule collapse
   *     ("CR 723.5a / CR 723.5a" → "CR 723.5a", "CR X (CR X)" → "CR X"). The same transform runs on
   *     test titles and on the bindings that name them, so a binding still finds its title. */
  const NUM = String.raw`(?:\d{3}|D\d+)(?:\.\d+[a-z]*)?`;
  const SAME_LIST = new RegExp(String.raw`\bCR (${NUM})(?:\s*(?:\/|,|\band\b|&|\+)\s*CR \1(?![\d.a-z]))+`, 'g');
  const SAME_PAREN = new RegExp(String.raw`\bCR (${NUM}) \(CR \1\)`, 'g');
  const tidy = (l) => l.replace(SAME_PAREN, 'CR $1').replace(SAME_LIST, 'CR $1');
  report.tidied = 0;
  for (const [rel, t] of [...after]) {
    const old = new Set((before.get(rel) ?? '').split('\n'));
    const lines = t.split('\n');
    let ch = false;
    for (let k = 0; k < lines.length; k++) { if (old.has(lines[k])) continue; const n = tidy(lines[k]); if (n !== lines[k]) { lines[k] = n; ch = true; report.tidied++; } }
    if (ch) after.set(rel, lines.join('\n'));
  }
  for (const [abs, t] of [...jsonOut]) {
    const j = JSON.parse(t);
    let ch = false;
    const walk = (o) => { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (typeof v === 'string') { const n = tidy(v); if (n !== v) { o[k] = n; ch = true; report.tidied++; } } else walk(v); } };
    walk(j);
    if (ch) jsonOut.set(abs, JSON.stringify(j, null, indentOf(t)) + (t.endsWith('\n') ? '\n' : ''));
  }

  report.selfCheck = [...(report.needleFailures ?? []).map((x) => ({ ...x, line: 0 }))];
  const BADLINE = [/\bCR [\dD][\d.a-z]* (?:is|was) (?:REVERSED|reversed|narrowed|superseded|NARROWED|SUPERSEDED)\b/, /\b(CR [\dD][\d.a-z]*) = \1(?![\d.a-z])/, /\b(?:test|it)\(\s*['"`](?:test|it)\(/];
  const doubles = (l) => [...l.matchAll(/\b([A-Za-z]{2,})\s+\1\b/gi)].map((x) => x[1].toLowerCase()).filter((w) => !['that', 'had', 'is', 'very', 'no'].includes(w) || true);
  for (const [rel, t] of after) {
    const old = new Set((before.get(rel) ?? '').split('\n'));
    const oldText = before.get(rel) ?? '';
    for (const [k, l] of t.split('\n').entries()) {
      if (old.has(l)) continue;
      const phrase = /\b([A-Za-z][\w'-]*(?:\s+[\w'-]+){1,3})\s+\1\b/i.exec(l);
      const sameNum = new RegExp(String.raw`\bCR (${NUM})\b[^.;:\n]{0,60}?\bCR \1(?![\d.a-z])`).exec(l);
      const why = BADLINE.find((re) => re.test(l)) ? 'states a CR number as reversed / equal to itself, or pastes code into a title'
        : doubles(l).filter((w) => !new RegExp(`\\b${w}\\s+${w}\\b`, 'i').test(oldText)).length ? `doubled word: ${doubles(l).join(', ')}`
        : l.includes('((') && !oldText.includes(l.slice(Math.max(0, l.indexOf('((') - 10), l.indexOf('((') + 12)) && !/\(\(\s*$|=>|\(\([a-z_]/.test(l) ? 'a "((" garble'
        : phrase && !oldText.toLowerCase().includes(phrase[0].toLowerCase()) ? `doubled phrase: "${phrase[1]}"`
        : sameNum && !oldText.includes(sameNum[0]) ? `the same rule cited twice in one phrase: CR ${sameNum[1]}`
        : /\bthe rule in\b/.test(l) && !/\bthe rule in\b/.test(oldText) ? '"the rule in" pointer phrasing' : null;
      if (why) report.selfCheck.push({ file: rel, line: k + 1, why, text: l.trim().slice(0, 200) });
    }
  }

  // a phrase printed twice around a reworded span: the suggestion restated words the original kept
  const twice = (x) => { const w = x.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []; const seen = new Set(); for (let i = 0; i + 1 < w.length; i++) for (let j = i + 2; j + 1 < w.length && j <= i + 8; j++) if (w[i] === w[j] && w[i + 1] === w[j + 1]) seen.add(`${w[i]} ${w[i + 1]}`); return seen; };
  for (const [rel, es] of editsOf) {
    const neu = after.get(rel), old = before.get(rel);
    if (!neu || !old) continue;
    for (const e of es) {
      if (!String(e.why).startsWith('reword')) continue;
      // a splice that ate far more of the original than the suggestion says back
      const ow = (old.slice(e.a, e.b).match(/\S+/g) ?? []).length, tw = (e.text.match(/\S+/g) ?? []).length;
      if (ow > tw + 8 && ow > 2 * tw) report.selfCheck.push({ file: rel, line: old.slice(0, e.a).split('\n').length, why: `over-eating splice: ${ow} words replaced by ${tw}`, text: old.slice(e.a, e.b).replace(/\s+/g, ' ').slice(0, 200) });
      const [na, nb] = mapRange(es, e.a, e.b);
      const win = neu.slice(Math.max(0, na - 80), nb + 80), owin = old.slice(Math.max(0, e.a - 80), e.b + 80);
      const was = twice(owin);
      const now = [...twice(win)].filter((p) => !was.has(p) && neu.slice(na, nb).toLowerCase().includes(p.split(' ')[0]));
      if (now.length) (report.warnings ??= []).push({ file: rel, line: neu.slice(0, na).split('\n').length, why: `repeated phrase: ${now.join(', ')}`, text: neu.slice(Math.max(0, na - 60), nb + 60).replace(/\s+/g, ' ').slice(0, 200) });
    }
  }

  /* 10. write */
  report.files = after.size + jsonOut.size;
  report.changed = [...after.keys(), ...[...jsonOut.keys()].map((a) => relative(root, a))].sort();
  if (!dryRun) {
    for (const [rel, t] of after) writeFileSync(join(root, rel), t);
    for (const [abs, t] of jsonOut) writeFileSync(abs, t);
  }
  report.titleMap = Object.fromEntries([...titleMap].map(([k, v]) => [k, v.length]));
  return { report, after, before, titleMap, editsOf, consumed };
}

/** undo a JS string literal's escapes (\u00a7, \x41, \', \\, \n …) */
export function unescapeJs(raw) {
  return raw.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})|\\(.)/g, (all, cp, u, x, c) =>
    cp ? String.fromCodePoint(parseInt(cp, 16)) : u ? String.fromCharCode(parseInt(u, 16)) : x ? String.fromCharCode(parseInt(x, 16))
      : ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' })[c] ?? c);
}

function listFiles(root, dir) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(join(root, d), { withFileTypes: true })) {
      if (n.name === 'node_modules' || n.name.startsWith('.')) continue;
      const p = `${d}/${n.name}`;
      if (n.isDirectory()) walk(p); else out.push(p);
    }
  };
  walk(dir);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { CITES_JSON } = await import('./score.mjs');
  const cites = JSON.parse(readFileSync(CITES_JSON, 'utf8'));
  const di = process.argv.indexOf('--decisions');
  const decisions = loadDecisions(di > 0 ? resolve(process.argv[di + 1]) : DECISIONS_DIR);
  const { report } = recite({ cites, decisions, dryRun: process.argv.includes('--dry-run') });
  const i = process.argv.indexOf('--report');
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(report, null, 1) + '\n');
  const short = { ...report, leave: report.leave.length, dropUnapplied: report.dropUnapplied.length, rewordUnapplied: report.rewordUnapplied.length,
    changed: report.changed.length, bindings: { rewritten: report.bindings.rewritten, unresolved: report.bindings.unresolved.length },
    requoted: { ...report.requoted, failed: report.requoted.failed.length }, jsonRows: { applied: report.jsonRows.applied, notFound: report.jsonRows.notFound.length } };
  console.log(JSON.stringify(short, null, 1));
}
