/* Two reports about where things are drawn, and the arithmetic behind each.
 *
 * #181 — THE SCRIM BESIDE THE RAIL. `.overlay.mainonly` is the dimming scrim
 * of the dialogs that leave the side rail readable (the bin, the cache, the
 * rules, the judge, the inspector, the log). It must stop exactly at the
 * rail's left edge. It used to stop at a guessed clamp(250px, 24vw, 320px);
 * once the regions board's rail was narrowed (250px, 210px under 1100px)
 * inside the centred max-width #app, a strip of table beside the rail stayed
 * undimmed. The fix computes the edge from the same numbers that place the
 * rail. The defect CLASS is "the rail's width changes and the scrim's
 * arithmetic does not follow", so this test does not pin either number: it
 * resolves BOTH sides out of style.css — the rail's left edge from #app's
 * max-width, centring, padding and grid track, the scrim's `right` from its
 * own rule — at a spread of window widths, for both boards, and asks that
 * they agree.
 *
 * #182 — THE CACHE THUMBS IN THE INFO BLOCK. The cache in `.linfo` once wore
 * the bin's thumbnail class without the bin's size variable, so the thumb
 * width was an undefined var(): the cards drew full size, and on your own
 * side, packed to the block's bottom edge, only a sliver showed. This test
 * renders a real regions board (ui/main.ts through the ui-driver) with a bin
 * and a live cache on both sides, finds every card drawn inside an info
 * block, and resolves each one's width out of style.css at a sweep of block
 * heights: it must be a definite length, smaller than the board's own card
 * size, sized FROM the block (shorter block, smaller thumb), and bounded
 * (it stops growing).
 *
 * HOW. Nothing here lays anything out. A small cascade below (selector
 * matching, specificity, source order, !important, @media, @container,
 * var() with inheritance, calc/min/max/clamp) answers "what is property P on
 * this element at this window size". Anything it cannot evaluate — a :has(),
 * an unknown media feature, an unknown at-rule — that could decide an answer
 * THROWS, naming the selector, rather than being skipped: a resolver that
 * quietly ignored the rule that mattered would make every assertion here
 * blind. One thing is assumed, not derived: 100vw is the layout width (no
 * vertical page scrollbar — #app.board is 100vh with overflow hidden).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { client } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import type { Seat } from '../../engine/src/types.ts';

const CSS_PATH = fileURLToPath(new URL('../style.css', import.meta.url));

/* ═══ a small cascade ══════════════════════════════════════════════════ */

type Tri = boolean | null;               // null: this resolver cannot tell
interface Decl { prop: string; value: string; important: boolean }
interface Compound {
  tag: string | null; id: string | null; classes: string[];
  attrs: { name: string; op: string | null; val: string | null }[];
  pseudos: { name: string; arg: string | null }[]; pseudoEl: boolean;
}
interface Sel { parts: Compound[]; combs: string[]; spec: [number, number, number]; text: string }
interface Rule { sels: Sel[]; decls: Decl[]; media: string[]; container: string[]; order: number }
interface El {
  tag: string; id: string; classes: Set<string>; attrs: Map<string, string>;
  parent: El | null; children: El[];
}
interface Env { vw: number; vh: number; cqh: number }

/** index of `ch` in `s` from `from`, outside quotes and parentheses */
function topIndex(s: string, ch: string, from = 0): number {
  let depth = 0, q = '';
  for (let i = from; i < s.length; i++) {
    const c = s[i]!;
    if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
    if (depth === 0 && c === ch) return i;
    if (c === '"' || c === "'") q = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
  }
  return -1;
}
function splitTop(s: string, ch: string): string[] {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const j = topIndex(s, ch, i);
    if (j < 0) { out.push(s.slice(i)); return out.map(x => x.trim()).filter(Boolean); }
    out.push(s.slice(i, j)); i = j + 1;
  }
}
function matchBrace(s: string, open: number): number {
  let depth = 0, q = '';
  for (let i = open; i < s.length; i++) {
    const c = s[i]!;
    if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error('unbalanced braces in style.css');
}

function parseSelector(text: string): Sel {
  const parts: Compound[] = [], combs: string[] = [];
  const spec: [number, number, number] = [0, 0, 0];
  let i = 0, cur: Compound | null = null, pendingComb: string | null = null;
  const fresh = (): Compound => ({ tag: null, id: null, classes: [], attrs: [], pseudos: [], pseudoEl: false });
  const ident = (): string => {
    const m = /^[\w-]+/.exec(text.slice(i));
    if (!m) throw new Error(`cannot read selector "${text}" at ${i}`);
    i += m[0].length; return m[0];
  };
  const begin = (): Compound => {
    if (cur) return cur;
    if (parts.length) combs.push(pendingComb ?? ' ');
    pendingComb = null;
    cur = fresh(); parts.push(cur); return cur;
  };
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) { if (cur) { cur = null; pendingComb ??= ' '; } i++; continue; }
    if (c === '>' || c === '+' || c === '~') { cur = null; pendingComb = c; i++; continue; }
    const k = begin();
    if (c === '*') { i++; continue; }
    if (c === '#') { i++; k.id = ident(); spec[0]++; continue; }
    if (c === '.') { i++; k.classes.push(ident()); spec[1]++; continue; }
    if (c === '[') {
      const end = topIndex(text, ']', i + 1);
      if (end < 0) throw new Error(`unclosed [ in selector "${text}"`);
      const body = text.slice(i + 1, end).trim();
      const m = /^([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?$/.exec(body);
      if (!m) throw new Error(`cannot read attribute selector [${body}] in "${text}"`);
      k.attrs.push({ name: m[1]!, op: m[2] ?? null, val: m[3] ?? m[4] ?? m[5] ?? null });
      spec[1]++; i = end + 1; continue;
    }
    if (c === ':') {
      if (text[i + 1] === ':') { i += 2; ident(); k.pseudoEl = true; spec[2]++; continue; }
      i++;
      const name = ident();
      let arg: string | null = null;
      if (text[i] === '(') {
        let depth = 0, j = i;
        for (; j < text.length; j++) { if (text[j] === '(') depth++; else if (text[j] === ')' && --depth === 0) break; }
        arg = text.slice(i + 1, j); i = j + 1;
      }
      if (name === 'before' || name === 'after' || name === 'first-line' || name === 'first-letter') {
        k.pseudoEl = true; spec[2]++; continue;                     // legacy single-colon form
      }
      k.pseudos.push({ name, arg });
      if (name === 'where') { /* no specificity */ }
      else if ((name === 'not' || name === 'is' || name === 'has') && arg !== null) {
        const inner = splitTop(arg, ',').map(parseSelector);
        const best = inner.reduce((a, s) => (cmpSpec(s.spec, a) > 0 ? s.spec : a), [0, 0, 0] as [number, number, number]);
        spec[0] += best[0]; spec[1] += best[1]; spec[2] += best[2];
      } else spec[1]++;
      continue;
    }
    if (/[\w-]/.test(c)) { k.tag = ident().toLowerCase(); spec[2]++; continue; }
    throw new Error(`cannot read selector "${text}" at "${text.slice(i)}"`);
  }
  return { parts, combs, spec, text };
}
const cmpSpec = (a: number[], b: number[]): number => (a[0]! - b[0]!) || (a[1]! - b[1]!) || (a[2]! - b[2]!);

function parseDecls(body: string): Decl[] {
  return splitTop(body, ';').flatMap(d => {
    const at = d.indexOf(':');
    if (at < 0) return [];
    let value = d.slice(at + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    return [{ prop: d.slice(0, at).trim().toLowerCase(), value, important }];
  });
}

function parseSheet(css: string): Rule[] {
  const rules: Rule[] = [];
  let order = 0;
  const walk = (src: string, media: string[], container: string[]): void => {
    let i = 0;
    for (;;) {
      const open = topIndex(src, '{', i);
      if (open < 0) {
        assert.equal(src.slice(i).trim(), '', 'style.css: trailing text the resolver did not read');
        return;
      }
      const prelude = src.slice(i, open).trim();
      const close = matchBrace(src, open);
      const body = src.slice(open + 1, close);
      if (prelude.startsWith('@media')) walk(body, [...media, prelude.slice(6).trim()], container);
      else if (prelude.startsWith('@container')) walk(body, media, [...container, prelude.slice(10).trim()]);
      else if (/^@(-webkit-)?keyframes\b|^@font-face\b/.test(prelude)) { /* not element styles */ }
      else if (prelude.startsWith('@')) throw new Error(`style.css: an at-rule this resolver does not read: ${prelude}`);
      else rules.push({ sels: splitTop(prelude, ',').map(parseSelector), decls: parseDecls(body), media, container, order: order++ });
      i = close + 1;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), [], []);
  return rules;
}

/* ── the markup ── */
const VOID = new Set(['img', 'br', 'input', 'hr', 'meta', 'link', 'source', 'wbr', 'area', 'col', 'embed', 'track']);
function mkEl(tag: string, attrs: Map<string, string>, parent: El | null): El {
  const el: El = {
    tag, id: attrs.get('id') ?? '', attrs, parent, children: [],
    classes: new Set((attrs.get('class') ?? '').split(/\s+/).filter(Boolean)),
  };
  parent?.children.push(el);
  return el;
}
/** html > body > div#app.<appClasses> > (the markup) */
function tree(markup: string, appClasses: string): { app: El; all: El[] } {
  const html = mkEl('html', new Map(), null);
  const body = mkEl('body', new Map(), html);
  const app = mkEl('div', new Map([['id', 'app'], ['class', appClasses]]), body);
  const all: El[] = [html, body, app];
  const stack: El[] = [app];
  let i = 0;
  while ((i = markup.indexOf('<', i)) >= 0) {
    if (markup.startsWith('<!--', i)) { i = markup.indexOf('-->', i) + 3; continue; }
    // the tag's end: the first '>' outside quotes
    let j = i + 1, q = '';
    for (; j < markup.length; j++) {
      const c = markup[j]!;
      if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
    }
    const tag = markup.slice(i + 1, j);
    i = j + 1;
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim().toLowerCase();
      for (let k = stack.length - 1; k > 0; k--) if (stack[k]!.tag === name) { stack.length = k; break; }
      continue;
    }
    const m = /^([a-zA-Z][\w-]*)/.exec(tag);
    if (!m) continue;
    const attrs = new Map<string, string>();
    for (const a of tag.slice(m[0].length).matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs.set(a[1]!.toLowerCase(), a[2] ?? a[3] ?? a[4] ?? '');
    }
    const el = mkEl(m[1]!.toLowerCase(), attrs, stack[stack.length - 1]!);
    all.push(el);
    if (!VOID.has(el.tag) && !/\/\s*$/.test(tag)) stack.push(el);
  }
  return { app, all };
}

/* ── matching ── */
const and = (a: Tri, b: Tri): Tri => (a === false || b === false ? false : a === null || b === null ? null : true);
const or = (xs: Tri[]): Tri => (xs.includes(true) ? true : xs.includes(null) ? null : false);
const not = (a: Tri): Tri => (a === null ? null : !a);
const siblingsOf = (el: El): El[] => el.parent?.children ?? [el];

function nth(arg: string, pos: number): Tri {
  const a = arg.replace(/\s+/g, '');
  if (a === 'odd') return pos % 2 === 1;
  if (a === 'even') return pos % 2 === 0;
  if (/^\d+$/.test(a)) return pos === Number(a);
  const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(a);
  if (!m) return null;
  const A = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : Number(m[1]);
  const B = Number(m[2] ?? 0);
  if (A === 0) return pos === B;
  return (pos - B) / A >= 0 && (pos - B) % A === 0;
}

function matchCompound(k: Compound, el: El): Tri {
  if (k.pseudoEl) return false;                          // it styles a ::before/::after, not el
  if (k.tag && k.tag !== el.tag) return false;
  if (k.id && k.id !== el.id) return false;
  for (const c of k.classes) if (!el.classes.has(c)) return false;
  for (const a of k.attrs) {
    const v = el.attrs.get(a.name);
    if (v === undefined) return false;
    if (a.op === null) continue;
    const want = a.val ?? '';
    const ok = a.op === '=' ? v === want : a.op === '^=' ? v.startsWith(want) : a.op === '$=' ? v.endsWith(want)
      : a.op === '*=' ? v.includes(want) : a.op === '~=' ? v.split(/\s+/).includes(want) : null;
    if (ok !== true) return ok;
  }
  let r: Tri = true;
  for (const p of k.pseudos) {
    const sibs = siblingsOf(el), pos = sibs.indexOf(el) + 1;
    const list = (): Sel[] => selList(p.arg ?? '');
    let m: Tri;
    switch (p.name) {
      case 'not': m = not(or(list().map(s => matchSel(s, el)))); break;
      case 'is': case 'where': m = or(list().map(s => matchSel(s, el))); break;
      // nobody is hovering, focusing or pressing anything in this picture
      case 'hover': case 'focus': case 'focus-visible': case 'focus-within': case 'active':
      case 'visited': case 'target': m = false; break;
      case 'link': m = el.tag === 'a' && el.attrs.has('href'); break;
      case 'disabled': m = el.attrs.has('disabled'); break;
      case 'checked': m = el.attrs.has('checked'); break;
      case 'root': m = el.tag === 'html'; break;
      case 'first-child': m = pos === 1; break;
      case 'last-child': m = pos === sibs.length; break;
      case 'only-child': m = sibs.length === 1; break;
      case 'nth-child': m = nth(p.arg ?? '', pos); break;
      case 'nth-last-child': m = nth(p.arg ?? '', sibs.length - pos + 1); break;
      default: m = null;                                 // :has(), :empty, … — cannot tell
    }
    r = and(r, m);
    if (r === false) return false;
  }
  return r;
}

function matchFrom(s: Sel, idx: number, el: El): Tri {
  const here = matchCompound(s.parts[idx]!, el);
  if (here === false || idx === 0) return here;
  const comb = s.combs[idx - 1];
  let up: Tri = false;
  if (comb === '>') up = el.parent ? matchFrom(s, idx - 1, el.parent) : false;
  else if (comb === ' ') {
    for (let a = el.parent; a; a = a.parent) {
      const m = matchFrom(s, idx - 1, a);
      if (m === true) { up = true; break; }
      if (m === null) up = null;
    }
  } else {
    const sibs = siblingsOf(el), at = sibs.indexOf(el);
    const before = comb === '+' ? sibs.slice(Math.max(0, at - 1), at) : sibs.slice(0, at);
    up = or(before.map(b => matchFrom(s, idx - 1, b)));
  }
  return and(here, up);
}
const matchSel = (s: Sel, el: El): Tri => matchFrom(s, s.parts.length - 1, el);
const SEL_LISTS = new Map<string, Sel[]>();
function selList(text: string): Sel[] {
  let got = SEL_LISTS.get(text);
  if (!got) SEL_LISTS.set(text, got = splitTop(text, ',').map(parseSelector));
  return got;
}

/* ── media and container conditions ── */
function mediaOk(cond: string, env: Env): boolean {
  return splitTop(cond, ',').some(alt => {
    const q = alt.replace(/^only\s+/, '').replace(/^screen\s+and\s+/, '').replace(/^screen$/, '').trim();
    if (!q) return true;
    if (/^not\b/.test(q)) throw new Error(`@media ${cond}: "not" is not read here`);
    return q.split(/\s+and\s+/).every(f => feature(f, env, `@media ${cond}`));
  });
}
function feature(f: string, env: Env, where: string, h?: number): boolean {
  const m = /^\(\s*([\w-]+)\s*:\s*([^)]+?)\s*\)$/.exec(f.trim());
  if (!m) throw new Error(`${where}: cannot read "${f}"`);
  const [, name, val] = m as unknown as [string, string, string];
  const px = (): number => { const n = /^(\d+(?:\.\d+)?)px$/.exec(val); if (!n) throw new Error(`${where}: ${val}`); return Number(n[1]); };
  const height = h ?? env.vh;
  switch (name) {
    case 'max-width': return env.vw <= px();
    case 'min-width': return env.vw >= px();
    case 'max-height': return height <= px();
    case 'min-height': return height >= px();
    case 'prefers-reduced-motion': return val === 'no-preference';
    case 'hover': return val === 'hover';
    case 'pointer': case 'any-pointer': return val === 'fine';
    default: throw new Error(`${where}: a media feature this resolver does not read: ${name}`);
  }
}

/* ── the cascade ── */
/** the 1–4 value box shorthands: which slot holds the RIGHT side */
const RIGHT_OF: Record<string, string> = { 'padding-right': 'padding', 'margin-right': 'margin', right: 'inset' };
const RULES = parseSheet(readFileSync(CSS_PATH, 'utf8'));
/** the rules that set each property (a shorthand counts for its longhand) */
const BY_PROP = new Map<string, Rule[]>();
for (const r of RULES) {
  for (const p of new Set(r.decls.map(d => d.prop))) {
    for (const key of [p, ...Object.keys(RIGHT_OF).filter(k => RIGHT_OF[k] === p)]) {
      if (!BY_PROP.has(key)) BY_PROP.set(key, []);
      if (BY_PROP.get(key)!.at(-1) !== r) BY_PROP.get(key)!.push(r);
    }
  }
}

/** the nearest ancestor that is a size container, and so what cqh and an
 * @container height query are measured against */
function sizeContainer(el: El, env: Env): El | null {
  for (let a = el.parent; a; a = a.parent) if (cascade(a, 'container-type', env) === 'size') return a;
  return null;
}

function longhandFrom(prop: string, d: Decl): string | null {
  if (d.prop === prop) return d.value;
  if (RIGHT_OF[prop] !== d.prop) return null;
  const v = splitTop(d.value, ' ');
  return v.length === 1 ? v[0]! : v[1]!;
}

/** the cascaded value of `prop` on `el`, or undefined when no rule sets it */
function cascade(el: El, prop: string, env: Env): string | undefined {
  type Cand = { m: Tri; important: boolean; spec: number[]; order: number; di: number; value: string; sel: string };
  const cands: Cand[] = [];
  for (const r of BY_PROP.get(prop) ?? []) {
    let hits: { value: string; important: boolean; di: number }[] = [];
    r.decls.forEach((d, di) => { const v = longhandFrom(prop, d); if (v !== null) hits.push({ value: v, important: d.important, di }); });
    if (!hits.length) continue;
    if (!r.media.every(c => mediaOk(c, env))) continue;
    if (r.container.length) {
      const box = sizeContainer(el, env);
      if (!box) continue;
      if (!r.container.every(c => feature(c, env, `@container ${c}`, env.cqh))) continue;
    }
    for (const s of r.sels) {
      const m = matchSel(s, el);
      if (m === false) continue;
      for (const h of hits) cands.push({ m, ...h, spec: s.spec, order: r.order, sel: s.text });
    }
    hits = [];
  }
  const inline = el.attrs.get('style');
  if (inline) parseDecls(inline).forEach((d, di) => {
    const v = longhandFrom(prop, d);
    if (v !== null) cands.push({ m: true, value: v, important: d.important, di, spec: [9, 9, 9], order: 1e9, sel: '[style]' });
  });
  cands.sort((a, b) => (Number(a.important) - Number(b.important)) || cmpSpec(a.spec, b.spec) || (a.order - b.order) || (a.di - b.di));
  for (let i = cands.length - 1; i >= 0; i--) {
    const c = cands[i]!;
    if (c.m === null) throw new Error(`cannot tell whether "${c.sel}" applies to <${el.tag} class="${[...el.classes].join(' ')}">, and it would decide ${prop}`);
    return c.value;
  }
  return undefined;
}

const INVALID = 'INVALID (an undefined var() with no fallback)';
/** custom properties inherit: the nearest element that sets one */
function customProp(el: El, name: string, env: Env): string | undefined {
  for (let a: El | null = el; a; a = a.parent) {
    const v = cascade(a, name, env);
    if (v !== undefined) return v;
  }
  return undefined;
}
function substitute(value: string, el: El, env: Env): string {
  for (let guard = 0; guard < 20; guard++) {
    const at = value.lastIndexOf('var(');
    if (at < 0) return value;
    let depth = 0, end = at + 3;
    for (; end < value.length; end++) { if (value[end] === '(') depth++; else if (value[end] === ')' && --depth === 0) break; }
    const [name, ...fb] = splitTop(value.slice(at + 4, end), ',');
    const got = customProp(el, name!.trim(), env) ?? (fb.length ? fb.join(',') : undefined);
    if (got === undefined || got === INVALID) return INVALID;
    value = value.slice(0, at) + substitute(got, el, env) + value.slice(end + 1);
  }
  throw new Error(`var() nesting too deep: ${value}`);
}
/** the value of `prop` on `el` with every var() substituted */
const resolved = (el: El, prop: string, env: Env): string | undefined => {
  const v = cascade(el, prop, env);
  return v === undefined ? undefined : substitute(v, el, env);
};

/** a CSS length expression → px, or null when it is not a definite length
 * (auto, none, 1fr, a percentage, …) */
function px(expr: string, env: Env): number | null {
  const toks = expr.match(/-?\d*\.?\d+(?:[a-z%]+)?|[a-z-]+\(|[()+*/,-]/gi) ?? [];
  if (toks.join('').replace(/\s/g, '') !== expr.replace(/\s/g, '')) return null;
  let i = 0;
  const unit: Record<string, number> = { px: 1, '': 1, vw: env.vw / 100, vh: env.vh / 100, dvh: env.vh / 100, cqh: env.cqh / 100, rem: 16 };
  const num = (t: string): number | null => {
    const m = /^(-?\d*\.?\d+)([a-z%]*)$/i.exec(t);
    if (!m || !(m[2]!.toLowerCase() in unit)) return null;
    return Number(m[1]) * unit[m[2]!.toLowerCase()]!;
  };
  const sum = (): number | null => {
    let v = prod();
    while (v !== null && (toks[i] === '+' || toks[i] === '-')) { const op = toks[i++]; const r = prod(); v = r === null ? null : op === '+' ? v + r : v - r; }
    return v;
  };
  const prod = (): number | null => {
    let v = atom();
    while (v !== null && (toks[i] === '*' || toks[i] === '/')) { const op = toks[i++]; const r = atom(); v = r === null ? null : op === '*' ? v * r : v / r; }
    return v;
  };
  const atom = (): number | null => {
    const t = toks[i++];
    if (t === undefined) return null;
    if (t === '(') { const v = sum(); return toks[i++] === ')' ? v : null; }
    if (t === '-') { const v = atom(); return v === null ? null : -v; }
    const fn = /^(calc|min|max|clamp)\($/i.exec(t);
    if (fn) {
      const args: (number | null)[] = [sum()];
      while (toks[i] === ',') { i++; args.push(sum()); }
      if (toks[i++] !== ')' || args.includes(null)) return null;
      const a = args as number[];
      switch (fn[1]!.toLowerCase()) {
        case 'calc': return a.length === 1 ? a[0]! : null;
        case 'min': return Math.min(...a);
        case 'max': return Math.max(...a);
        default: return a.length === 3 ? Math.max(a[0]!, Math.min(a[1]!, a[2]!)) : null;
      }
    }
    return num(t);
  };
  const v = sum();
  return i === toks.length ? v : null;
}

/* ═══ the board, rendered ══════════════════════════════════════════════ */

const ui = await client();
const store = (globalThis as { localStorage: Storage }).localStorage;

/** a game in planning with three cards in each bin and two live cards in
 * each cache — both zones drawn in both info blocks */
function game(): Harness {
  const h = new Harness(36801);
  for (const s of [0, 1] as Seat[]) {
    const pl = h.state.players[s]!;
    pl.bin.push('Good Whale', 'Rune Channeler', 'Curio Drifter');
    pl.cache ??= [];
    pl.cache.push({ card: 'Wildfire', uid: 36800 + 2 * s, playableUntilTurn: h.state.turn });
    pl.cache.push({ card: 'Good Whale', uid: 36801 + 2 * s, playableUntilTurn: h.state.turn });
  }
  return h;
}
const H = game();
/** main.ts: `$app.classList.add('board'); $app.classList.toggle('v2', regionsBoard())`
 * — the driver's root has no classList, so the root's classes are restated */
const APP_CLASSES = { regions: 'board v2', classic: 'board' } as const;
type Board = keyof typeof APP_CLASSES;
function paint(board: Board, withScrim: boolean): string {
  store.setItem('algoLayout', board === 'regions' ? '2' : '1');
  ui.join(H.state, 0, legalActions(H.state, 0));
  return withScrim ? ui.click({ btn: 'binopen', p: 0 }) : ui.html();
}

/* ═══ #181 the scrim stops at the rail ═════════════════════════════════ */

const WIDTHS = [2560, 1920, 1600, 1501, 1500, 1440, 1280, 1101, 1100, 1000, 901, 900, 800, 700];

interface Edge { vw: number; scrim: number | null; railLeft: number; rail: number; how: string }
/** at window width `vw`: the scrim's right edge and the rail's left edge,
 * both as a distance from the window's right edge */
const TREES = new Map<Board, ReturnType<typeof tree>>();
function edges(board: Board, vw: number): Edge {
  if (!TREES.has(board)) TREES.set(board, tree(paint(board, true), APP_CLASSES[board]));
  const { app, all } = TREES.get(board)!;
  const env: Env = { vw, vh: 900, cqh: 0 };
  const scrimEl = all.find(e => e.classes.has('overlay') && e.classes.has('mainonly'));
  assert.ok(scrimEl, `${board}: the bin dialog did not open a .overlay.mainonly — nothing to measure`);
  const side = all.find(e => e.classes.has('side') && e.parent === app);
  assert.ok(side, `${board}: no .side rail directly inside #app`);
  // `right` is measured from the WINDOW only while the scrim is fixed
  assert.equal(resolved(scrimEl, 'position', env), 'fixed', `${board} @${vw}: the scrim is not position: fixed`);
  const right = resolved(scrimEl, 'right', env);
  const scrim = right === undefined ? null : px(right, env);

  const pos = resolved(side, 'position', env) ?? 'static';
  if (pos === 'fixed' || pos === 'absolute') {
    // out of the grid: the rail is a drawer over the table, not a column
    // beside it, and the table runs to the window's edge
    return { vw, scrim, railLeft: 0, rail: 0, how: `rail is ${pos} (a drawer)` };
  }
  const tracks = splitTop(resolved(app, 'grid-template-columns', env) ?? 'none', ' ');
  const col = Number(resolved(side, 'grid-column', env) ?? NaN);
  assert.ok(Number.isInteger(col), `${board} @${vw}: the rail's grid-column is not a single track`);
  assert.equal(col, tracks.length, `${board} @${vw}: the rail is not the last track of [${tracks.join(' | ')}], so the edge needs more than this derivation`);
  const rail = px(tracks[col - 1]!, env);
  assert.ok(rail !== null, `${board} @${vw}: the rail track "${tracks[col - 1]}" is not a fixed length`);
  const maxW = px(resolved(app, 'max-width', env) ?? 'none', env) ?? Infinity;
  const marginR = resolved(app, 'margin-right', env);
  const margin = marginR === 'auto' ? Math.max(0, (vw - Math.min(vw, maxW)) / 2) : px(marginR ?? '0', env);
  assert.ok(margin !== null, `${board} @${vw}: #app's right margin "${marginR}" is not a length`);
  const pad = px(resolved(app, 'padding-right', env) ?? '0', env);
  assert.ok(pad !== null, `${board} @${vw}: #app's right padding is not a length`);
  return { vw, scrim, railLeft: margin + pad + rail, rail, how: `margin ${margin} + padding ${pad} + rail ${rail}` };
}

const table = (es: Edge[]): string => es.map(e => `${e.vw}px: scrim ${e.scrim} vs rail ${e.railLeft} (${e.how})`).join('\n  ');
const misses = (es: Edge[]): Edge[] => es.filter(e => e.scrim === null || Math.abs(e.scrim - e.railLeft) > 0.5);

test('the dialog scrim stops exactly at the rail on the regions board, at every window width', () => {
  const es = WIDTHS.map(w => edges('regions', w));
  // not blind: the widths really do move the rail (else the media queries
  // were never read and every row compares one number with itself)
  assert.ok(new Set(es.map(e => e.rail)).size >= 3, `the rail never changed width across the sweep:\n  ${table(es)}`);
  assert.deepEqual(misses(es), [], `scrim right != rail left:\n  ${table(es)}`);
});

/** KNOWN GAP, declared here and checked against reality (not a todo — a
 * todo can never fail). Under 1100px the classic board's rail is
 * `#app { grid-template-columns: 1fr 220px }`, but `.overlay.mainonly` has no
 * classic rule at those widths: down to 901px the scrim keeps the desktop
 * 298px and leaves a 70px undimmed strip of table; at 900px and under it goes
 * to 0 and covers the rail, which on the classic board is still a column
 * (only the regions board turns it into a drawer). The second half of the
 * test below fails the day style.css is fixed — then empty this list. */
const CLASSIC_KNOWN_GAP = [1100, 1000, 901, 900, 800, 700];

test('the dialog scrim stops exactly at the rail on the classic board (narrow widths a declared gap)', () => {
  const es = WIDTHS.map(w => edges('classic', w));
  const regions = WIDTHS.map(w => edges('regions', w));
  // not blind: the two boards are resolved differently (else #app.board.v2
  // never matched and this compares the classic board with itself twice)
  assert.notDeepEqual(es.map(e => e.rail), regions.map(e => e.rail), 'the classic and regions rails resolved the same');
  const held = es.filter(e => !CLASSIC_KNOWN_GAP.includes(e.vw));
  assert.deepEqual(misses(held), [], `scrim right != rail left:\n  ${table(held)}`);
  const gap = es.filter(e => CLASSIC_KNOWN_GAP.includes(e.vw));
  assert.deepEqual(gap.filter(e => !misses([e]).length).map(e => e.vw), [],
    `the classic scrim now meets the rail at these declared-gap widths — remove them from CLASSIC_KNOWN_GAP:\n  ${table(gap)}`);
});

/* ═══ #182 the thumbs in the info block ════════════════════════════════ */

/** container heights swept: from a squeezed battle block to a roomy one */
const HEIGHTS = Array.from({ length: 37 }, (_, k) => 40 + 10 * k);   // 40..400

test('every bin and cache thumb in the info block has a definite width sized from the block and bounded', () => {
  const { all } = tree(paint('regions', false), APP_CLASSES.regions);
  const inside = (e: El, cls: string): boolean => { for (let a = e.parent; a; a = a.parent) if (a.classes.has(cls)) return true; return false; };
  const thumbs = all.filter(e => e.classes.has('card') && inside(e, 'linfo')
    && (inside(e, 'regionbin') || inside(e, 'regioncache')));
  // not blind: both zones, on both sides, really were drawn in the blocks
  for (const zone of ['regionbin', 'regioncache']) {
    const n = thumbs.filter(e => inside(e, zone)).length;
    assert.ok(n >= 4, `only ${n} card(s) drawn inside .linfo .${zone} — expected both sides (the fixture holds 3 bin and 2 cache cards each)`);
  }
  const fails: string[] = [];
  for (const vw of [1440, 1000]) {
    for (const el of thumbs) {
      const what = `${inside(el, 'regioncache') ? 'cache' : 'bin'} thumb "${el.attrs.get('data-prev') ?? '?'}" @${vw}`;
      const box = sizeContainer(el, { vw, vh: 900, cqh: 100 });
      if (!box?.classes.has('linfo')) { fails.push(`${what}: its size container is not the info block`); continue; }
      const widths = HEIGHTS.map(cqh => {
        const env: Env = { vw, vh: 900, cqh };
        const v = resolved(el, 'width', env);
        return { cqh, v, w: v === undefined ? null : px(v, env), cw: px(substitute('var(--cw)', el, env), env) };
      });
      const bad = widths.find(x => x.w === null);
      if (bad) { fails.push(`${what}: width "${bad.v}" at a ${bad.cqh}px block is not a definite length`); continue; }
      const ws = widths.map(x => x.w!);
      if (widths.some(x => x.cw === null)) { fails.push(`${what}: the board's own card width (--cw) did not resolve`); continue; }
      const big = widths.find(x => x.w! >= x.cw!);
      if (big) fails.push(`${what}: ${big.w}px at a ${big.cqh}px block is not a thumb (the board's card is ${big.cw}px)`);
      if (Math.min(...ws) < 12) fails.push(`${what}: shrinks to ${Math.min(...ws)}px`);
      if (!(Math.min(...ws) < Math.max(...ws))) fails.push(`${what}: ${ws[0]}px at every block height — not sized from the block`);
      if (ws.some((w, k) => k > 0 && w < ws[k - 1]!)) fails.push(`${what}: a taller block gives a smaller thumb`);
      const huge = px(resolved(el, 'width', { vw, vh: 900, cqh: 4000 }) ?? '', { vw, vh: 900, cqh: 4000 });
      if (huge !== ws[ws.length - 1]) fails.push(`${what}: still growing past a 400px block (${ws[ws.length - 1]}px → ${huge}px at 4000px) — unbounded`);
    }
  }
  assert.deepEqual(fails, []);
});
