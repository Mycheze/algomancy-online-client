/* A CSS SCANNER JUST BIG ENOUGH FOR THE DESIGN-SYSTEM CODEMODS.
 *
 * ui/scripts/tokenize-styles.mjs (and its guard, ui/test/921) need to know,
 * for a stylesheet piece, where every DECLARATION VALUE is — and nothing
 * else: a colour-looking `#add` in a selector is an id, a `#fff` inside a
 * comment or a string is prose. The client takes no dependencies, so this is
 * not postcss; it is a brace walker over a MASKED copy of the text (comments
 * blanked to spaces, string bodies to `_`, newlines kept), so every offset it
 * returns is an offset into the original text and a codemod can splice there.
 *
 * It understands exactly what the client's CSS uses: style rules, the
 * declaration at-rules (@font-face, @page, @property, …), the grouping
 * at-rules (@media, @supports, @container, @keyframes, @layer, …) and
 * statement at-rules (@import). It throws on CSS nesting (a block inside a
 * declaration block) rather than guess — none of the pieces nests today. */

/** at-rules whose block holds declarations, not rules */
const DECL_AT = new Set(['font-face', 'page', 'property', 'counter-style', 'font-palette-values', 'view-transition']);

/** the text with comments blanked to spaces and string bodies to `_` — same length, same newlines */
export function maskCss(text) {
  const out = text.split('');
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      for (let k = i; k < stop; k++) if (out[k] !== '\n') out[k] = ' ';
      i = stop;
    } else if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < text.length && text[k] !== c) { if (text[k] === '\\') k++; k++; }
      for (let j = i + 1; j < k && j < text.length; j++) if (out[j] !== '\n') out[j] = '_';
      i = k + 1;
    } else i++;
  }
  return out.join('');
}

/**
 * Every declaration in `text`: { prop, start, end, selector, at } where
 * text.slice(start, end) is the value (after the colon, up to the `;` or `}`),
 * `selector` the rule's prelude and `at` the enclosing at-rule preludes.
 * Custom properties are included (prop starts with `--`).
 */
export function declarations(text) {
  const m = maskCss(text);
  const out = [];
  const stack = [];   // preludes of the open grouping blocks
  let i = 0;
  let stmt = 0;
  while (i < m.length) {
    const c = m[i];
    if (c === '{') {
      const prelude = m.slice(stmt, i).trim().replace(/\s+/g, ' ');
      const at = /^@([\w-]+)/.exec(prelude);
      if (at && !DECL_AT.has(at[1].toLowerCase())) {
        stack.push(prelude);
        i++; stmt = i;
        continue;
      }
      // a declaration block: read declarations to its closing brace
      i++;
      let depth = 0;
      let d0 = i;
      for (; i < m.length; i++) {
        const ch = m[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === '{') throw new Error(`css-scan: a block inside a declaration block at offset ${i} (${prelude}) — nesting is not supported`);
        else if (depth === 0 && (ch === ';' || ch === '}')) {
          const raw = m.slice(d0, i);
          const colon = raw.indexOf(':');
          if (colon >= 0) {
            out.push({
              prop: raw.slice(0, colon).trim().toLowerCase(),
              start: d0 + colon + 1,
              end: i,
              selector: prelude,
              at: [...stack],
            });
          } else if (raw.trim() !== '') {
            throw new Error(`css-scan: not a declaration at offset ${d0}: ${JSON.stringify(raw.trim().slice(0, 60))}`);
          }
          d0 = i + 1;
          if (ch === '}') break;
        }
      }
      i++; stmt = i;
      continue;
    }
    if (c === '}') { stack.pop(); i++; stmt = i; continue; }
    if (c === ';') { stmt = i + 1; }
    i++;
  }
  if (stack.length) throw new Error(`css-scan: ${stack.length} unclosed block(s): ${stack.join(' | ')}`);
  return { masked: m, decls: out };
}

/* ── colours ─────────────────────────────────────────────────────────── */

/** a colour literal in a masked value: hex (3/4/6/8 digits) or rgb()/rgba() */
export const COLOUR_RE = /#[0-9a-fA-F]{3,8}(?![\w-])|\brgba?\([^()]*\)/g;

/** [r, g, b, a] for a colour literal, or null if it is not one we read */
export function parseColour(lit) {
  const s = lit.trim().toLowerCase();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (![3, 4, 6, 8].includes(h.length) || /[^0-9a-f]/.test(h)) return null;
    const full = h.length <= 4 ? h.split('').map(x => x + x).join('') : h;
    const n = [0, 2, 4, 6].map(k => (k < full.length ? parseInt(full.slice(k, k + 2), 16) : 255));
    return [n[0], n[1], n[2], Math.round((n[3] / 255) * 1000) / 1000];
  }
  const fn = /^rgba?\((.*)\)$/.exec(s);
  if (!fn) return null;
  let parts;
  const body = fn[1].trim();
  if (body.includes(',')) parts = body.split(',').map(x => x.trim());
  else {
    const [rgb, alpha] = body.split('/').map(x => x.trim());
    parts = rgb.split(/\s+/);
    if (alpha !== undefined) parts.push(alpha);
  }
  if (parts.length !== 3 && parts.length !== 4) return null;
  const chan = (x) => (x.endsWith('%') ? Math.round(parseFloat(x) * 2.55) : parseFloat(x));
  const rgb = parts.slice(0, 3).map(chan);
  let a = 1;
  if (parts.length === 4) a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  if ([...rgb, a].some(x => !Number.isFinite(x))) return null;
  return [...rgb.map(x => Math.round(x)), Math.round(a * 1000) / 1000];
}

/** a canonical key: two literals with the same key are the same colour */
export const colourKey = (c) => c.join(',');

/** the spans of `value` that sit inside var(…) or url(…) — a fallback or a URL, never repainted */
export function shieldedSpans(value) {
  const spans = [];
  const re = /\b(var|url)\(/gi;
  let mm;
  while ((mm = re.exec(value))) {
    let depth = 0;
    let k = mm.index + mm[0].length - 1;
    for (; k < value.length; k++) {
      if (value[k] === '(') depth++;
      else if (value[k] === ')') { depth--; if (depth === 0) break; }
    }
    spans.push([mm.index, k + 1]);
    re.lastIndex = k + 1;
  }
  return spans;
}

export const inSpans = (spans, a, b) => spans.some(([s, e]) => a >= s && b <= e);

/* ── every colour literal: what ui/test/921 counts ───────────────────── */

/** a colour literal of ANY spelling — hex, the colour functions, a named colour (a working
 *  subset of the 148: every one a stylesheet is likely to reach for) */
export const ANY_COLOUR_RE = /#[0-9a-fA-F]{3,8}(?![\w-])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()]*\)|(?<![\w-])(?:white|black|red|green|blue|yellow|orange|purple|gr[ae]y|silver|gold|pink|cyan|magenta|lime|navy|teal|maroon|olive|aqua|fuchsia|crimson|tomato|coral|salmon|khaki|violet|indigo|brown|beige|ivory|plum|orchid|tan|wheat)(?![\w-])/gi;

/** every colour literal in a stylesheet's declaration VALUES (never a selector, comment,
 *  string or url()), var() fallbacks included — a fallback is a literal the page can paint */
export function colourLiterals(text) {
  const { masked, decls } = declarations(text);
  const out = [];
  for (const d of decls) {
    const v = masked.slice(d.start, d.end);
    const urls = shieldedSpans(v).filter(([s]) => /^url/i.test(v.slice(s)));
    for (const m of v.matchAll(ANY_COLOUR_RE)) {
      if (!inSpans(urls, m.index, m.index + m[0].length)) out.push({ selector: d.selector, prop: d.prop, literal: m[0] });
    }
  }
  return out;
}

/* ── CIE Lab ΔE (CIE76), for the snap report ─────────────────────────── */
function lab([r, g, b]) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
export function deltaE(c1, c2) {
  const a = lab(c1), b = lab(c2);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
