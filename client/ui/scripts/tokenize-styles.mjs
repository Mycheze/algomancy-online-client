/* THE TOKENS, AND THE CODEMOD THAT PUTS THEM IN — design-system Phase 1b-i.
 *
 * client/docs/23-design-system.md, Phase 1: "tokens written; literals
 * replaced". This script does both, and changes NOTHING ON SCREEN:
 *
 *   1. TOKENS. If styles/tokens.css is still the split's verbatim copy of the
 *      old style.css head (the 40 legacy custom properties, checked one by
 *      one against LEGACY below), it is rewritten as TOKENS_CSS: the role-named
 *      set (--color-*, --font-*, --text-*, --space-*, --radius-*, --shadow-*,
 *      --z-*, --dur-*, --ease-*) whose values are TODAY's most common literals
 *      (the census, client/docs/23-ui-inventory/07-design-foundations.md §11),
 *      with every legacy name still defined — as an alias of its role token
 *      where it has one, as it was where it is a game token. If tokens.css
 *      already holds the role tokens it is left alone: from then on it is
 *      CANONICAL and hand-edited, and the codemod reads it.
 *
 *   2. LITERALS → var(). Over styles/base.css, styles/pages/** and
 *      styles/shared/** — NEVER styles/board/**, the game board is out of
 *      scope (it is allowlisted) — a literal becomes var(--token) ONLY where
 *      it is EXACTLY the token's value as tokens.css defines it:
 *        colour   any declaration value; the same colour after normalising
 *                 (case, #abc vs #aabbcc, hex vs rgb(), alpha) — never a
 *                 literal inside a var() fallback or a url()
 *        --text   `font-size: Npx` exactly (the `font:` shorthand is left: a
 *                 var() in it would turn the four invalid `font: … inherit`
 *                 declarations from dropped-at-parse into unset-at-compute)
 *        --space  padding / margin / gap, when EVERY px in the value is on
 *                 the scale (others may be 0 / auto) — a value is tokenised
 *                 whole or not at all, so no `var(--space-4) 10px` halves
 *        --radius border-radius likewise, whole or not at all
 *        --shadow a box-shadow layer that IS a shadow token, layer for layer
 *      --font-*, --z-*, --dur-*, --ease-* are defined but not codemodded:
 *      a family list, a z-index or a duration that happens to equal a token
 *      is not necessarily that role (the snap report lists them instead).
 *      The computed value of every touched declaration is unchanged: the
 *      token is defined once, on :root, and no new name is redefined in any
 *      scope (checked below — a scoped redefinition would make the var()
 *      resolve differently under it).
 *
 *   3. THE SNAP (Phase 1b-ii, `--snap through`) — a VISIBLE change, small by
 *      design: the snap list's "through" rows, and only those, onto their
 *      token (§3b below says exactly which). Run it only AFTER the exact pass.
 *
 * IDEMPOTENT. A second run finds nothing to do. RE-RUNNABLE after a re-split,
 * in THIS ORDER — each step reads what the one before wrote:
 *
 *   node client/ui/scripts/split-styles.mjs --rev origin/master   # style.css → pieces, word for word
 *   node client/ui/scripts/tokenize-styles.mjs                    # tokens.css + exact literal → var()
 *   node client/ui/scripts/tokenize-styles.mjs --snap through     # the approved near-misses → var()
 *
 * The second alone is zero-change; the third moves pixels (the snap list's
 * "through" rows). ui/test/921's ALLOW is banked after the third.
 *
 * Flags:
 *   --check               write nothing; exit 1 if anything would change
 *   --report <out.md>     also write the per-token / per-file counts there
 *   --changes <out.json>  every touched declaration, before and after (for
 *                         the validity check: CSS.supports on the before)
 *   --snap-report <out.md>  REPORT ONLY, writes no CSS: every literal NEAR a
 *                         token but not equal — what the owner approves
 *                         before Phase 1b-ii snaps anything
 *   --allowlist           print the per-piece colour-literal counts in the
 *                         shape ui/test/921's ALLOW takes
 *   --snap-flagged <out.json>  with --snap-report: the flagged colour and
 *                         radius rows (the owner's to decide) as data
 *   --snap through        also snap the snap list's "through" rows (§3b)
 *   --dir <styles dir>    work on a copy instead of client/ui/styles */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { STYLES_DIR } from '../../engine/scripts/paths.mjs';
import {
  COLOUR_RE, colourKey, colourLiterals, declarations, deltaE, inSpans, parseColour, shieldedSpans,
} from './css-scan.mjs';
import { stylesOrder } from './styles.mjs';

/* ── 1. THE TOKENS ──────────────────────────────────────────────────────── */

/** the split's tokens.css, declaration for declaration: the old style.css's first :root */
const LEGACY = {
  '--bg': '#12151a', '--panel': '#1a1f27', '--panel2': '#20262f', '--line': '#2e3742',
  '--text': '#d6dde6', '--dim': '#8794a3', '--accent': '#d9a441', '--danger': '#d95454',
  '--glow': '#6fc36f', '--target': '#e0b93c', '--pending': '#3fd2c0',
  '--fire': '#d95436', '--water': '#3f8fd9', '--earth': '#8a6b3d', '--wood': '#4e8a3d',
  '--metal': '#9aa5b0', '--light': '#f2ead6', '--dark': '#6a7382',
  '--light-ink': '#2b2417', '--dark-ink': '#ffffff', '--metal-ink': '#222222',
  '--bar-fire': '#821210', '--bar-water': '#1e3463', '--bar-earth': '#824a11', '--bar-wood': '#2f581e',
  '--bar-metal': '#565656', '--bar-light': '#fafafa', '--bar-dark': '#1a1a1a',
  '--card-title': "'Card Title', 'EB Garamond', Garamond, 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  '--cw': '78px', '--gap': '2px', '--gap-tight': '1px', '--ringpad': '5px',
};

/** the role-named tokens.css this script writes over the split's verbatim copy */
export const TOKENS_CSS = `/* Algomancy prototype client — spreadsheet-simulator chic */
/* THE DESIGN TOKENS. CANONICAL; edit by hand.
 *
 * Named by ROLE, not by look: --color-surface, not --grey-2. Every value is
 * the one the client ALREADY used most (the census:
 * client/docs/23-ui-inventory/07-design-foundations.md §11), so putting the
 * tokens in changed nothing on screen; the near-misses that would move
 * when snapped onto them are a list the owner approves first (design-system
 * plan, client/docs/23-design-system.md, Phase 1).
 *
 * ui/scripts/tokenize-styles.mjs wrote this file once (Phase 1b, 2026-11) and
 * replaced, in base.css, pages/ and shared/, every literal that is EXACTLY a
 * --color-*, --text-*, --space-*, --radius-* or --shadow-* value below with
 * its var(). It reads its map from HERE, so a token added here is one the
 * next run can use. The game board (board/) is out of scope.
 *
 * ⚠ A token is defined here, on :root, and NOWHERE ELSE. Redefining one in a
 * scope (as .crdoc does with --accent) makes every var() under that scope
 * paint something else — that is a theme, and it is a decision, not a fix.
 *
 * The legacy names (--bg, --panel, --accent, …) still work: those with a role
 * here are aliases of it; the game's own (elements, inks, printed bars,
 * --target, --pending, --glow, the board's --cw/--gap/--ringpad) are as they
 * were. New CSS uses the role names. */
:root {
  /* ── colour: the neutrals ── */
  --color-bg: #12151a;               /* the page */
  --color-surface-sunken: #0d1014;   /* below the page: wells, inputs (legal.ts's footer today) */
  --color-surface: #1a1f27;          /* a panel */
  --color-surface-raised: #20262f;   /* a panel on a panel; the base button */
  --color-surface-overlay: rgba(20, 24, 30, .9);  /* a translucent floating panel */
  --color-scrim: rgba(6, 8, 11, .72);             /* the dimmer behind a dialog */
  --color-border: #2e3742;
  --color-border-strong: #3b4654;    /* the slate borders (eleven near-copies today) */
  --color-text: #d6dde6;
  --color-text-muted: #8794a3;
  --color-text-on-accent: #12151a;   /* dark ink on a gold or pale fill (the accent, Light's cream) */
  --color-text-on-fill: #ffffff;     /* ink on a saturated or dark fill: element chips, red badges, captions */
  /* ── colour: brand and interaction ── */
  --color-accent: #d9a441;           /* gold: the brand, the page's main action, "on" */
  --color-link: #7fc0ff;
  --color-confirm: #3c5a2f;          /* green: button.primary, "confirm" at the table */
  --color-confirm-border: #5b8747;
  --color-confirm-hover: #476b37;
  /* ── colour: status, each with a tinted background ── */
  --color-success: #6fc36f;          /* the same green as the board's --glow, deliberately not tied to it */
  --color-success-bg: #1d2b1a;
  --color-warning: #e8b64c;          /* what the phantom var(--warn, #e8b64c) has been painting */
  --color-warning-bg: #33270f;
  --color-danger: #d95454;
  --color-danger-bg: #2b1a1a;
  --color-info: #7fb6e0;             /* the rules page's blue */
  --color-info-bg: #1d3142;

  /* ── type ── */
  --font-ui: system-ui, sans-serif;
  --font-mono: ui-monospace, monospace;
  /* the printed title face: EB Garamond Bold (ui/fonts/, SIL OFL — OFL.txt
     beside it), the nearest free cut to the scans' serif */
  --font-display: 'Card Title', 'EB Garamond', Garamond, 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
  /* the scale: seven steps, each the most used size of its band (the body is 13) */
  --text-11: 11px; --text-12: 12px; --text-13: 13px; --text-14: 14px;
  --text-16: 16px; --text-22: 22px; --text-26: 26px;

  /* ── space, radius, elevation ── */
  --space-1: 2px; --space-2: 4px; --space-3: 6px; --space-4: 8px; --space-5: 12px;
  --space-6: 16px; --space-7: 24px; --space-8: 32px; --space-9: 48px;
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-pill: 999px;
  --shadow-1: 0 3px 10px rgba(0, 0, 0, .7);    /* chips, toasts */
  --shadow-2: 0 6px 24px rgba(0, 0, 0, .55);   /* menus, popovers */
  --shadow-3: 0 14px 40px rgba(0, 0, 0, .75);  /* dialogs, the card zoom */

  /* ── layers (today's values; several roles still share one — see the census §6) ── */
  --z-sticky: 30; --z-dock: 55; --z-overlay: 60; --z-menu: 70;
  --z-popover: 90; --z-toast: 90; --z-modal: 95; --z-drag: 95;

  /* ── motion ── */
  --dur-fast: .12s; --dur-base: .18s; --dur-slow: .45s;
  --ease-out: ease-out; --ease-in-out: ease-in-out;
  --ease-std: cubic-bezier(.35, .05, .2, 1);   /* anim.ts's FLIP and flights */

  /* ── the legacy names. Aliases where a role above is the same thing ── */
  --bg: var(--color-bg); --panel: var(--color-surface); --panel2: var(--color-surface-raised);
  --line: var(--color-border); --text: var(--color-text); --dim: var(--color-text-muted);
  --accent: var(--color-accent); --danger: var(--color-danger);
  --card-title: var(--font-display);
  /* …and the game's own, as they were: --glow (green = legal / next) and
     --target (gold = targeting) are table roles, not --color-success and
     --color-accent, even where the values agree. */
  --glow: #6fc36f; --target: #e0b93c;
  /* CR D6.12 "in progress": purple already means resolved, red means answered,
     green means next and gold means targeting — so pending gets the one hue
     none of them use. A teal that is not --water (#3f8fd9) either, because a
     resolving card wears it as a border and the seat hairlines are elemental. */
  --pending: #3fd2c0;
  /* the seven elements, in ALL_ELEMENTS order. Light & Dark are the yin-yang
     pair: Light is a warm cream (12.7:1 against --panel2, so it needs DARK ink
     on it — see --light-ink), Dark is a slate grey, deliberately NOT charcoal,
     because true charcoal on a #20262f panel is invisible. At #6a7382 it still
     reads as "the dark one" next to cream while clearing 3:1 against the panel
     and 4.8:1 for white text on top. */
  --fire: #d95436; --water: #3f8fd9; --earth: #8a6b3d; --wood: #4e8a3d;
  --metal: #9aa5b0; --light: #f2ead6; --dark: #6a7382;
  --light-ink: #2b2417; --dark-ink: #ffffff; --metal-ink: #222222;
  /* the PRINTED name bar, per element — not the UI chips above: the median
     colour of each mono card's bar, read off the scans (2026-09-30, ~56 cards
     an element, the quartiles within a few points). Light is the one white
     bar, and prints black ink. */
  --bar-fire: #821210; --bar-water: #1e3463; --bar-earth: #824a11; --bar-wood: #2f581e;
  --bar-metal: #565656; --bar-light: #fafafa; --bar-dark: #1a1a1a;
  --cw: 78px; /* card thumb width; jpgs are ~63:88 */
  /* board round 8 (owner, 2026-10-27): the game screen's gaps between boxes —
     1–2px, where they were 6–10. ui/layout.ts and ui/fit.ts mirror them. */
  --gap: 2px; --gap-tight: 1px;
  /* …and the buffer inside a region's blocks that keeps a card clear of the
     ring's 2.5px stroke and its glow — padding, not a gap */
  --ringpad: 5px;
}
`;

/** the custom properties a :root block of `text` defines, name → value (first :root only) */
export function rootTokens(text) {
  const { decls } = declarations(text);
  const out = {};
  for (const d of decls) {
    if (d.selector !== ':root' || !d.prop.startsWith('--')) continue;
    if (!(d.prop in out)) out[d.prop] = text.slice(d.start, d.end).trim();
  }
  return out;
}

const isRoleTokens = (text) => /--color-bg\s*:/.test(text);

/** step 1: the tokens file, rewritten once. Returns { changed, text } */
export function tokensStep(text) {
  if (isRoleTokens(text)) return { changed: false, text, note: 'tokens.css already holds the role tokens — left as it is (canonical)' };
  const got = rootTokens(text);
  const diff = [];
  for (const [k, v] of Object.entries(LEGACY)) if (got[k] !== v) diff.push(`  ${k}: expected ${v}, found ${got[k] ?? '(absent)'}`);
  for (const k of Object.keys(got)) if (!(k in LEGACY)) diff.push(`  ${k}: new (${got[k]})`);
  if (diff.length) {
    throw new Error('tokens.css is neither the split\'s legacy :root nor the role tokens — the old style.css head changed '
      + 'upstream. Fold the change into LEGACY and TOKENS_CSS in this script, then re-run:\n' + diff.join('\n'));
  }
  // every legacy name must still be defined, and still compute to what it did
  const after = rootTokens(TOKENS_CSS);
  for (const [k, v] of Object.entries(LEGACY)) {
    const a = after[k];
    const ref = /^var\((--[\w-]+)\)$/.exec(a ?? '');
    const resolved = ref ? after[ref[1]] : a;
    if (resolved !== v) throw new Error(`TOKENS_CSS: ${k} resolves to ${resolved}, not its legacy ${v}`);
  }
  return { changed: true, text: TOKENS_CSS };
}

/* ── 2. THE MAP: literal → token, read off tokens.css ───────────────────── */

const TARGET = /^--(color|text|space|radius|shadow)-/;

/** where two colour tokens share a value, the property decides (first match wins; no `props` = the default) */
const PREFER = {
  '--color-text-on-accent': /^color$/,
};

/** split a value at its top-level commas: [[start, end], …] */
function layers(v) {
  const out = [];
  let depth = 0;
  let s = 0;
  for (let i = 0; i <= v.length; i++) {
    const ch = v[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if ((ch === ',' && depth === 0) || i === v.length) { out.push([s, i]); s = i + 1; }
  }
  return out;
}

/** a shadow layer's canonical form: whitespace collapsed, colours as keys */
const shadowKey = (s) => s.trim().replace(/\s+/g, ' ').replace(COLOUR_RE, (m) => {
  const c = parseColour(m);
  return c ? `rgba(${colourKey(c)})` : m;
});

export function buildMap(tokensText) {
  const toks = rootTokens(tokensText);
  const colour = new Map();   // key → [{ name, props }]
  const px = { text: new Map(), space: new Map(), radius: new Map() };   // number → name
  const shadow = new Map();   // shadowKey → name
  for (const [name, value] of Object.entries(toks)) {
    if (!TARGET.test(name) || /var\(/.test(value)) continue;
    const kind = TARGET.exec(name)[1];
    if (kind === 'color') {
      const c = parseColour(value);
      if (!c) throw new Error(`tokens.css: ${name} is not a colour we read: ${value}`);
      const k = colourKey(c);
      if (!colour.has(k)) colour.set(k, []);
      colour.get(k).push({ name, props: PREFER[name] ?? null });
    } else if (kind === 'shadow') {
      shadow.set(shadowKey(value), name);
    } else {
      const m = /^(\d+(?:\.\d+)?)px$/.exec(value);
      if (!m) throw new Error(`tokens.css: ${name} is not a px length: ${value}`);
      const n = Number(m[1]);
      if (px[kind].has(n)) throw new Error(`tokens.css: ${name} and ${px[kind].get(n)} are both ${value}`);
      px[kind].set(n, name);
    }
  }
  for (const [k, list] of colour) {
    if (list.filter(t => !t.props).length > 1) {
      throw new Error(`tokens.css: ${list.map(t => t.name).join(' and ')} are the same colour (${k}) — give all but one a PREFER rule`);
    }
  }
  return { tokens: toks, colour, px, shadow };
}

const colourToken = (map, key, prop) => {
  const list = map.colour.get(key);
  if (!list) return null;
  return (list.find(t => t.props && t.props.test(prop)) ?? list.find(t => !t.props))?.name ?? null;
};

/* ── 3. THE CODEMOD ─────────────────────────────────────────────────────── */

/** the pieces the codemod may touch: base.css, pages/**, shared/** — never board/**, never tokens.css */
export const inScope = (piece) => piece === 'base.css' || piece.startsWith('pages/') || piece.startsWith('shared/');

const SPACE_PROP = /^(padding|margin)(-(top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?$|^(row-|column-)?gap$/;
const RADIUS_PROP = /^border(-(top|bottom)-(left|right)|-(start|end)-(start|end))?-radius$/;

/**
 * Declarations the codemod leaves as they are, and why. Keyed by the piece's
 * NAME without its cascade number (a re-split may renumber), the rule's
 * selector, and the property.
 */
export const SKIP = [
  // (filled in as tests that read a literal out of the CSS are found — each with its reason)
];

const pieceName = (piece) => piece.replace(/(^|\/)\d+-/, '$1');
const skipped = (piece, selector, prop) => SKIP.find(s => s.piece === pieceName(piece) && s.selector === selector && s.prop === prop);

/** whole-value px tokenising: every px atom has a token (`resolve(n)` → name or null), the rest
 *  0/auto. Returns the new value or null. `resolve` may be a Map (exact) or a function (a snap). */
function pxWhole(value, resolve) {
  const look = resolve instanceof Map ? (n) => resolve.get(n) : resolve;
  const imp = /\s*!important\s*$/i.exec(value);
  const core = imp ? value.slice(0, imp.index) : value;
  const atoms = core.trim().split(/\s+/);
  if (atoms.length === 0 || atoms[0] === '') return null;
  let hit = false;
  const out = [];
  for (const a of atoms) {
    const m = /^(\d+(?:\.\d+)?)px$/.exec(a);
    if (m) {
      const name = look(Number(m[1]));
      if (!name) return null;
      out.push(`var(${name})`);
      hit = true;
    } else if (a === '0' || a === 'auto') out.push(a);
    else return null;
  }
  if (!hit) return null;
  // keep the original whitespace around the value
  const lead = /^\s*/.exec(core)[0];
  const trail = /\s*$/.exec(core)[0];
  return lead + out.join(' ') + trail + (imp ? imp[0] : '');
}

/* ── 3b. THE SNAP (Phase 1b-ii, `--snap through`) ───────────────────────
 * The rows of the snap list the plan lets through without the owner
 * (client/docs/23-design-system.md, "The snap list": "flag anything over 2px
 * or a visible colour shift; the rest goes through"):
 *   colour   a --color-* token at the same alpha, CIE76 ΔE < JND (2.3)
 *   --text   `font-size: Npx` within 2px of a step
 *   --space  padding / margin / gap within 2px of the scale — whole value or nothing
 *   --radius within 2px of its band's radius (≤4 sm, 5–7 md, 8–99 lg, ≥100 pill),
 *            whole value or nothing
 * A TIE (10px between 8 and 12, 15px between 14 and 16) goes to the SMALLER
 * step: a snap grows a box only where the larger step is strictly nearer, so
 * a tie never makes a line wrap that did not. NEVER snapped: shadows (nor a
 * colour inside a box-shadow), z-index, and a token's colour at another
 * alpha — they wait for Phase 5.
 *
 * SCOPE: pages/ ONLY. base.css and shared/ style the game table too (the
 * base `button` is every button on the board; shared/ holds the touch prompt
 * bar, the pick dialogs, the element chips), and the board is out of the
 * design system's scope. Their exact matches are tokenised (zero change);
 * their near-misses wait for Phase 2 (base) and the components (shared). */

/** where a snap may land: the non-game pages */
export const inSnapScope = (piece) => piece.startsWith('pages/');

/** rules in a pages/ piece that style the GAME TABLE all the same — exact matches are tokenised, never snapped */
export const SNAP_SKIP = [
  { piece: 'pages/joinscreen.css', selector: '.card.back', reason: 'the face-down card back, drawn on the board too' },
];
const snapSkipped = (piece, selector) => SNAP_SKIP.some(s => s.piece === pieceName(piece) && s.selector === selector);

const JND = 2.3;   // ΔE76 just-noticeable difference

/** the nearest step of `scale` (Map value → name) within `max` px; a tie to the smaller */
function nearestStep(n, scale, max) {
  let best = null;
  for (const [v, name] of [...scale].sort((a, b) => a[0] - b[0])) {
    const d = Math.abs(v - n);
    if (d <= max + 1e-9 && (!best || d < best.d - 1e-9)) best = { d, v, name };
  }
  return best;
}

const RADIUS_BAND = (n) => (n <= 4 ? '--radius-sm' : n <= 7 ? '--radius-md' : n < 100 ? '--radius-lg' : '--radius-pill');

function snapRadius(n, map) {
  const name = RADIUS_BAND(n);
  const v = [...map.px.radius].find(([, nm]) => nm === name)?.[0];
  return v !== undefined && Math.abs(v - n) <= 2 ? name : null;
}

/** the --color-* token a literal snaps to (same alpha, ΔE < JND), the property choosing between equals */
function snapColour(c, prop, map) {
  let best = null;
  for (const key of map.colour.keys()) {
    const t = key.split(',').map(Number);
    if (Math.abs(t[3] - c[3]) > 1e-6) continue;
    const de = deltaE(c, t);
    if (de < JND && (!best || de < best.de)) best = { de, key };
  }
  if (!best) return null;
  const name = colourToken(map, best.key, prop);
  return name ? { name, de: best.de } : null;
}

/**
 * Tokenise one piece. Returns { text, changes: [{ token, prop, selector, before, after }] }.
 * Only ever touches declaration VALUES (never selectors, comments or strings).
 */
export function tokenizePiece(piece, text, map, opts = {}) {
  const snap = opts.snap === 'through' && inSnapScope(piece);
  const { masked, decls } = declarations(text);
  const edits = [];   // [start, end, replacement]
  const changes = [];
  for (const d of decls) {
    if (skipped(piece, d.selector, d.prop)) continue;
    const snapHere = snap && !snapSkipped(piece, d.selector);
    const vMasked = masked.slice(d.start, d.end);
    const vText = text.slice(d.start, d.end);
    const local = [];   // [s, e, rep, token] within the value
    const note = (s, e, rep, token) => local.push([s, e, rep, token]);

    if (d.prop === 'font-size') {
      const m = /^(\s*)(\d+(?:\.\d+)?)px(\s*(?:!important)?\s*)$/i.exec(vMasked);
      const name = m && (map.px.text.get(Number(m[2])) ?? (snapHere ? nearestStep(Number(m[2]), map.px.text, 2)?.name : null));
      if (name) note(m[1].length, m[1].length + m[2].length + 2, `var(${name})`, name);
    } else if (SPACE_PROP.test(d.prop) || RADIUS_PROP.test(d.prop)) {
      // whole value or nothing; a value with a comment in it (masked ≠ text) is left alone
      if (!vMasked.includes('/') && vMasked === vText) {
        const space = SPACE_PROP.test(d.prop);
        const scale = space ? map.px.space : map.px.radius;
        const resolve = !snapHere ? scale
          : space ? (n) => scale.get(n) ?? nearestStep(n, scale, 2)?.name ?? null
            : (n) => scale.get(n) ?? snapRadius(n, map);
        const rep = pxWhole(vMasked, resolve);
        if (rep !== null) {
          const names = [...rep.matchAll(/var\((--[\w-]+)\)/g)].map(t => t[1]);
          local.push([0, vMasked.length, rep, names]);
        }
      }
    } else if (d.prop === 'box-shadow') {
      for (const [s, e] of layers(vMasked)) {
        const raw = vMasked.slice(s, e);
        const imp = /\s*!important\s*$/i.exec(raw);
        const core = imp ? raw.slice(0, imp.index) : raw;
        const name = map.shadow.get(shadowKey(core));
        if (name) {
          const lead = /^\s*/.exec(core)[0].length;
          const trail = /\s*$/.exec(core)[0].length;
          note(s + lead, s + core.length - trail, `var(${name})`, name);
        }
      }
    }
    // colours, outside whatever the passes above already replaced
    const shield = shieldedSpans(vMasked);
    for (const m of vMasked.matchAll(COLOUR_RE)) {
      const a = m.index;
      const b = a + m[0].length;
      if (inSpans(shield, a, b)) continue;
      if (local.some(([s, e]) => a < e && b > s)) continue;
      const c = parseColour(m[0]);
      if (!c) continue;
      const name = colourToken(map, colourKey(c), d.prop)
        ?? (snapHere && d.prop !== 'box-shadow' ? snapColour(c, d.prop, map)?.name : null);
      if (name) note(a, b, `var(${name})`, name);
    }
    if (!local.length) continue;
    local.sort((x, y) => x[0] - y[0]);
    let after = '';
    let at = 0;
    for (const [s, e, rep] of local) { after += vText.slice(at, s) + rep; at = e; }
    after += vText.slice(at);
    edits.push([d.start, d.end, after]);
    const tokens = local.flatMap(l => (Array.isArray(l[3]) ? l[3] : [l[3]]));
    changes.push({ piece, selector: d.selector, prop: d.prop, before: vText.trim(), after: after.trim(), tokens });
  }
  let out = '';
  let at = 0;
  for (const [s, e, rep] of edits) { out += text.slice(at, s) + rep; at = e; }
  out += text.slice(at);
  return { text: out, changes };
}

/** no target token may be (re)defined anywhere but tokens.css's :root — or a var() would resolve differently under that scope */
export function scopedRedefinitions(pieces) {
  const bad = [];
  for (const [piece, text] of pieces) {
    for (const d of declarations(text).decls) {
      if (!/^--(color|text|space|radius|shadow|font|z|dur|ease)-/.test(d.prop)) continue;
      if (piece === 'tokens.css' && d.selector === ':root') continue;
      if (d.prop === '--font-mono' && /\.crdoc/.test(d.selector)) continue;   // .crdoc's own mono stack; --font-mono is not codemodded
      bad.push(`${piece}: ${d.selector} { ${d.prop} }`);
    }
  }
  return bad;
}

/* ── 4. THE SNAP REPORT (report only) ───────────────────────────────────── */

const NEAR_DE = 6;

export function snapReport(pieces, map) {
  const toks = map.tokens;
  const colourToks = Object.entries(toks)
    .filter(([n, v]) => /^--color-/.test(n) && !/var\(/.test(v))
    .map(([n, v]) => ({ name: n, c: parseColour(v) }));
  // every colour-valued token (role AND game), for "a tint of a token's RGB"
  const allColour = Object.entries(toks)
    .map(([n, v]) => {
      const ref = /^var\((--[\w-]+)\)$/.exec(v);
      return { name: n, c: parseColour(ref ? toks[ref[1]] ?? '' : v) };
    })
    .filter(t => t.c);
  const rows = { colour: new Map(), tint: new Map(), text: new Map(), space: new Map(), radius: new Map(), shadow: new Map(), z: new Map(), far: new Map() };
  let where = { selector: '', prop: '' };   // the declaration being read, for the rows' `uses`
  const bump = (group, key, info, piece) => {
    const g = rows[group];
    if (!g.has(key)) g.set(key, { ...info, n: 0, files: new Map(), uses: [] });
    const r = g.get(key);
    r.n++;
    r.files.set(piece, (r.files.get(piece) ?? 0) + 1);
    r.uses.push({ piece, ...where });
  };
  const nearest = (n, scale) => {
    let best = null;
    for (const [v, name] of scale) {
      const d = Math.abs(v - n);
      if (!best || d < best.d - 1e-9) best = { d, v, name, tie: null };
      else if (Math.abs(d - best.d) < 1e-9) best.tie = name;
    }
    return best;
  };
  const zToks = Object.entries(toks).filter(([n]) => /^--z-/.test(n)).map(([n, v]) => [Number(v), n]);

  for (const [piece, text] of pieces) {
    const { masked, decls } = declarations(text);
    for (const d of decls) {
      where = { selector: d.selector, prop: d.prop };
      if (d.prop.startsWith('--') && piece === 'tokens.css') continue;
      const v = masked.slice(d.start, d.end);
      const shield = shieldedSpans(v);
      // colours (a box-shadow's colours belong to its layer, banded below)
      for (const m of d.prop === 'box-shadow' ? [] : v.matchAll(COLOUR_RE)) {
        if (inSpans(shield, m.index, m.index + m[0].length)) continue;
        const c = parseColour(m[0]);
        if (!c) continue;
        if (colourToken(map, colourKey(c), d.prop)) continue;   // exact: the codemod's job
        let best = null;
        for (const t of colourToks) {
          if (Math.abs(t.c[3] - c[3]) > 1e-6) continue;
          const de = deltaE(c, t.c);
          if (!best || de < best.de) best = { de, t };
        }
        if (best && best.de < NEAR_DE) {
          bump('colour', `${best.t.name}|${m[0].toLowerCase()}`, { token: best.t.name, literal: m[0].toLowerCase(), de: best.de }, piece);
          continue;
        }
        const tint = allColour.find(t => t.c[0] === c[0] && t.c[1] === c[1] && t.c[2] === c[2] && t.c[3] !== c[3]);
        if (tint) bump('tint', `${tint.name}|${c[3]}`, { token: tint.name, literal: m[0], alpha: c[3] }, piece);
        else bump('far', `colour|${m[0].toLowerCase()}`, { kind: 'colour', literal: m[0].toLowerCase() }, piece);
      }
      // font sizes
      if (d.prop === 'font-size') {
        const m = /^\s*(\d+(?:\.\d+)?)px\s*(!important)?\s*$/.exec(v);
        if (m && !map.px.text.has(Number(m[1]))) {
          const b = nearest(Number(m[1]), map.px.text);
          if (b.d <= 2) bump('text', `${b.name}|${m[1]}`, { token: b.name, literal: `${m[1]}px`, d: b.d, tie: b.tie }, piece);
          else bump('far', `font-size|${m[1]}`, { kind: 'font-size', literal: `${m[1]}px` }, piece);
        }
      }
      // spacing and radius atoms
      const spacing = SPACE_PROP.test(d.prop);
      const radius = RADIUS_PROP.test(d.prop);
      if ((spacing || radius) && pxWhole(v, spacing ? map.px.space : map.px.radius) === null) {
        for (const a of v.replace(/!important/i, '').trim().split(/[\s/]+/)) {
          const m = /^(\d+(?:\.\d+)?)px$/.exec(a);
          if (!m) continue;
          const n = Number(m[1]);
          const scale = spacing ? map.px.space : map.px.radius;
          if (scale.has(n)) continue;
          if (radius) {
            const name = RADIUS_BAND(n);
            const tv = Number(/\d+/.exec(toks[name])[0]);
            bump('radius', `${name}|${n}`, { token: name, literal: `${n}px`, d: Math.abs(tv - n) }, piece);
          } else {
            const b = nearest(n, scale);
            if (b.d <= 2) bump('space', `${b.name}|${n}`, { token: b.name, literal: `${n}px`, d: b.d, tie: b.tie }, piece);
            else bump('far', `space|${n}`, { kind: 'spacing', literal: `${n}px` }, piece);
          }
        }
      }
      // drop shadows (black, not inset) that are not a token
      if (d.prop === 'box-shadow') {
        for (const [s, e] of layers(v)) {
          const layer = v.slice(s, e).replace(/!important/i, '').trim().replace(/\s+/g, ' ');
          if (/inset|var\(/.test(layer) || !/rgba?\(\s*0\s*,\s*0\s*,\s*0\b/.test(layer)) continue;
          if (map.shadow.has(shadowKey(layer))) continue;
          const len = layer.replace(COLOUR_RE, '').trim().split(/\s+/);   // x y blur [spread]
          const num = (a) => (/^-?[\d.]+(px)?$/.test(a ?? '') ? Math.abs(parseFloat(a)) : NaN);
          const off = Math.max(num(len[0]), num(len[1]));   // a side panel's shadow is offset in x
          const name = !Number.isFinite(off) ? '--shadow-?' : off <= 3 ? '--shadow-1' : off <= 8 ? '--shadow-2' : '--shadow-3';
          bump('shadow', `${name}|${layer}`, { token: name, literal: layer }, piece);
        }
      }
      if (d.prop === 'z-index') {
        const n = Number(v.trim());
        if (Number.isFinite(n) && n >= 10) {
          const exact = zToks.filter(([zv]) => zv === n).map(([, nm]) => nm);
          let best = null;
          for (const [zv, nm] of zToks) { const dd = Math.abs(zv - n); if (!best || dd < best.d) best = { d: dd, nm, zv }; }
          bump('z', `${n}`, { literal: n, exact, nearest: best }, piece);
        }
      }
    }
  }
  return rows;
}

/** the FLAGGED colour and radius rows — the ones that wait for the owner — as data */
export function snapFlagged(rows, map) {
  const out = [];
  for (const r of rows.colour.values()) {
    if (r.de < JND) continue;
    out.push({ kind: 'colour', literal: r.literal, token: r.token, tokenValue: map.tokens[r.token], deltaE: Math.round(r.de * 10) / 10,
      uses: r.n, files: [...r.files.keys()], selectors: r.uses.map(u => `${u.piece}: ${u.selector} { ${u.prop} }`) });
  }
  for (const r of rows.radius.values()) {
    if (r.d <= 2) continue;
    out.push({ kind: 'radius', literal: r.literal, token: r.token, tokenValue: map.tokens[r.token], deltaPx: r.d,
      uses: r.n, files: [...r.files.keys()], selectors: r.uses.map(u => `${u.piece}: ${u.selector} { ${u.prop} }`) });
  }
  return out;
}

function snapMarkdown(rows, map, pieces) {
  const files = (r) => [...r.files].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}${n > 1 ? ` ×${n}` : ''}`).join(', ');
  const total = (g) => [...rows[g].values()].reduce((s, r) => s + r.n, 0);
  const L = [];
  L.push('# Snap list — design-system Phase 1b (REPORT ONLY; nothing here has been applied)');
  L.push('');
  L.push('Generated by `node client/ui/scripts/tokenize-styles.mjs --snap-report <out.md>` over base.css, pages/ and shared/ ' +
    '(the board is out of scope), AFTER the exact-match codemod. Every row is a literal that is NEAR a token but not equal: ' +
    'snapping it onto the token is a visible change, however small, and waits for the owner. The plan\'s default ' +
    '(client/docs/23-design-system.md, "The snap list"): **flag anything over 2px or a visible colour shift; the rest goes through.** ' +
    `Colour distance is CIE76 ΔE; under ${JND} is below the just-noticeable difference.`);
  L.push('');
  const flagC = (de) => (de >= JND ? '**flag**' : 'through');
  const flagPx = (d) => (d > 2 ? '**flag**' : 'through');
  L.push('## Headline');
  L.push('');
  L.push('| group | distinct | uses | flagged (uses) |');
  L.push('|---|---|---|---|');
  const fl = (g, f) => [...rows[g].values()].filter(f).reduce((s, r) => s + r.n, 0);
  L.push(`| colours within ΔE ${NEAR_DE} of a colour token | ${rows.colour.size} | ${total('colour')} | ${fl('colour', r => r.de >= JND)} |`);
  L.push(`| a token's RGB at another alpha (→ color-mix) | ${rows.tint.size} | ${total('tint')} | ${total('tint')} |`);
  L.push(`| font sizes within 2px of a step | ${rows.text.size} | ${total('text')} | 0 |`);
  L.push(`| spacing px within 2px of the scale | ${rows.space.size} | ${total('space')} | 0 |`);
  L.push(`| radii onto sm/md/lg/pill | ${rows.radius.size} | ${total('radius')} | ${fl('radius', r => r.d > 2)} |`);
  L.push(`| drop shadows onto --shadow-1/2/3 | ${rows.shadow.size} | ${total('shadow')} | ${total('shadow')} |`);
  L.push(`| z-index (≥10) onto a layer | ${rows.z.size} | ${total('z')} | ${fl('z', r => !r.exact.length)} |`);
  L.push(`| no token near (left as literals) | ${rows.far.size} | ${total('far')} | — |`);
  L.push('');
  const byToken = (g) => {
    const m = new Map();
    for (const r of rows[g].values()) { if (!m.has(r.token)) m.set(r.token, []); m.get(r.token).push(r); }
    return [...m].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
  };
  const tokVal = (n) => map.tokens[n] ?? '?';

  L.push('## Colours near a token');
  L.push('');
  for (const [tok, rs] of byToken('colour')) {
    L.push(`### \`${tok}\` = \`${tokVal(tok)}\``);
    L.push('');
    L.push('| literal | ΔE | uses | snap? | files |');
    L.push('|---|---|---|---|---|');
    for (const r of rs.sort((a, b) => a.de - b.de)) L.push(`| \`${r.literal}\` | ${r.de.toFixed(1)} | ${r.n} | ${flagC(r.de)} | ${files(r)} |`);
    L.push('');
  }
  L.push('## A token\'s colour at another alpha');
  L.push('');
  L.push('Hand-written `rgba(<token rgb>, α)`. Not a snap: the proposal (07 §11a) is `color-mix(in srgb, var(--token) N%, transparent)` on a fixed ladder, which is a visible change wherever α is off the ladder. Listed so the ladder can be chosen from the alphas in use.');
  L.push('');
  L.push('| token | α | uses | files |');
  L.push('|---|---|---|---|');
  for (const [tok, rs] of byToken('tint')) for (const r of rs.sort((a, b) => a.alpha - b.alpha)) L.push(`| \`${tok}\` | ${r.alpha} | ${r.n} | ${files(r)} |`);
  L.push('');
  const pxSection = (g, title, flag) => {
    L.push(`## ${title}`);
    L.push('');
    L.push('| token | literal | Δ px | uses | snap? | files |');
    L.push('|---|---|---|---|---|---|');
    for (const [tok, rs] of byToken(g)) {
      for (const r of rs.sort((a, b) => parseFloat(a.literal) - parseFloat(b.literal))) {
        L.push(`| \`${tok}\` (${tokVal(tok)})${r.tie ? ` or \`${r.tie}\` (${tokVal(r.tie)})` : ''} | ${r.literal} | ${r.d} | ${r.n} | ${flag(r.d)} | ${files(r)} |`);
      }
    }
    L.push('');
  };
  pxSection('text', 'Font sizes within 2px of a step', flagPx);
  pxSection('space', 'Spacing within 2px of the scale (values the whole-declaration codemod could not take)', flagPx);
  pxSection('radius', 'Radii onto the four (bands: ≤4 sm, 5–7 md, 8–99 lg, ≥100 pill)', flagPx);
  L.push('## Drop shadows (black, not inset) onto the three elevations');
  L.push('');
  L.push('Banded by offset (the larger of x and y): ≤3px → 1, 4–8px → 2, more → 3. Every one of these is a visible change.');
  L.push('');
  L.push('| token | layer | uses | files |');
  L.push('|---|---|---|---|');
  for (const [tok, rs] of byToken('shadow')) for (const r of rs) L.push(`| \`${tok}\` (\`${tokVal(tok)}\`) | \`${r.literal}\` | ${r.n} | ${files(r)} |`);
  L.push('');
  L.push('## z-index (≥10) against the layers');
  L.push('');
  L.push('Not codemodded even where equal: a value that happens to equal a layer is not necessarily that layer.');
  L.push('');
  L.push('| z | equals | nearest | uses | files |');
  L.push('|---|---|---|---|---|');
  for (const r of [...rows.z.values()].sort((a, b) => a.literal - b.literal)) {
    L.push(`| ${r.literal} | ${r.exact.map(n => `\`${n}\``).join(' ') || '—'} | \`${r.nearest.nm}\` (${r.nearest.zv}) | ${r.n} | ${files(r)} |`);
  }
  L.push('');
  L.push('## Left as literals: no token near');
  L.push('');
  L.push('| kind | literal | uses | files |');
  L.push('|---|---|---|---|');
  for (const r of [...rows.far.values()].sort((a, b) => b.n - a.n || a.literal.localeCompare(b.literal))) L.push(`| ${r.kind} | \`${r.literal}\` | ${r.n} | ${files(r)} |`);
  L.push('');
  return L.join('\n');
}

/* ── main ───────────────────────────────────────────────────────────────── */

function main(argv) {
  const flag = (f) => argv.includes(f);
  const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const check = flag('--check');
  const dir = arg('--dir') ?? STYLES_DIR;
  const snapMode = arg('--snap');
  if (snapMode !== null && snapMode !== 'through') throw new Error(`--snap takes one value, "through" (got ${snapMode})`);
  const opts = { snap: snapMode };
  const order = stylesOrder(dir);
  const read = (p) => readFileSync(join(dir, p), 'utf8');
  const tokPath = join(dir, 'tokens.css');
  if (!existsSync(tokPath)) throw new Error('styles/tokens.css is missing');

  // 1. tokens
  const tok = tokensStep(read('tokens.css'));
  if (tok.note) console.log(`tokenize-styles: ${tok.note}`);
  const map = buildMap(tok.text);

  // 2. pieces
  const pieces = order.filter(inScope);
  const outText = new Map([['tokens.css', tok.text]]);
  const allChanges = [];
  for (const p of pieces) {
    const before = read(p);
    const { text, changes } = tokenizePiece(p, before, map, opts);
    if (text !== before) outText.set(p, text);
    allChanges.push(...changes);
  }

  // the invariant that makes var() == the literal: no target token defined in any scope but tokens.css :root
  const everything = order.map(p => [p, outText.get(p) ?? read(p)]);
  const redefs = scopedRedefinitions(everything);
  if (redefs.length) throw new Error(`a design token is (re)defined outside tokens.css :root — a var() would resolve differently under it:\n  ${redefs.join('\n  ')}`);

  // idempotence: a second pass over the result changes nothing
  for (const p of pieces) {
    const t = outText.get(p) ?? read(p);
    if (tokenizePiece(p, t, map, opts).changes.length) throw new Error(`not idempotent: a second pass still changes ${p}`);
    if (tokenizePiece(p, t, map).changes.length) throw new Error(`an exact pass after this one still changes ${p}`);
  }

  // counts
  const perToken = new Map();
  const perFile = new Map();
  for (const c of allChanges) {
    for (const t of c.tokens) perToken.set(t, (perToken.get(t) ?? 0) + 1);
    perFile.set(c.piece, (perFile.get(c.piece) ?? 0) + c.tokens.length);
  }
  const nRep = [...perToken.values()].reduce((a, b) => a + b, 0);
  const tokChanged = tok.changed;
  const changedFiles = [...outText.keys()].filter(p => p !== 'tokens.css' || tokChanged);
  console.log(`tokenize-styles: ${tokChanged ? 'tokens.css rewritten as the role tokens; ' : ''}`
    + `${nRep} literal(s) → var() in ${allChanges.length} declaration(s) across ${perFile.size} piece(s)`
    + (snapMode ? ` (exact AND --snap ${snapMode})` : ''));
  if (nRep) {
    for (const [t, n] of [...perToken].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${t}`);
  }

  if (arg('--report')) {
    const L = ['# tokenize-styles — what this run replaced', '', `${nRep} literals → var() in ${allChanges.length} declarations.`, '',
      '## Per token', '', '| token | value | replaced |', '|---|---|---|',
      ...[...perToken].sort((a, b) => b[1] - a[1]).map(([t, n]) => `| \`${t}\` | \`${map.tokens[t]}\` | ${n} |`), '',
      '## Per piece', '', '| piece | replaced |', '|---|---|',
      ...[...perFile].sort((a, b) => b[1] - a[1]).map(([f, n]) => `| ${f} | ${n} |`), '',
      '## Every declaration', '', '| piece | selector | property | before | after |', '|---|---|---|---|---|',
      ...allChanges.map(c => `| ${c.piece} | \`${c.selector.replace(/\|/g, '\\|')}\` | ${c.prop} | \`${c.before.replace(/\|/g, '\\|')}\` | \`${c.after.replace(/\|/g, '\\|')}\` |`), ''];
    writeFileSync(arg('--report'), L.join('\n'));
  }
  if (arg('--changes')) writeFileSync(arg('--changes'), JSON.stringify(allChanges, null, 1));

  if (flag('--allowlist')) {
    const after = (p) => outText.get(p) ?? read(p);
    console.log('// ui/test/921 ALLOW — colour literals per piece (name without its cascade number or .css)');
    for (const p of pieces) {
      const n = colourLiterals(after(p)).length;
      if (n) console.log(`  '${pieceName(p).replace(/\.css$/, '')}': ${n},`);
    }
  }

  if (arg('--snap-report')) {
    const after = order.filter(inScope).map(p => [p, outText.get(p) ?? read(p)]);
    const rows = snapReport(after, map);
    writeFileSync(arg('--snap-report'), snapMarkdown(rows, map, after));
    if (arg('--snap-flagged')) writeFileSync(arg('--snap-flagged'), JSON.stringify(snapFlagged(rows, map), null, 1));
    console.log(`tokenize-styles: snap list → ${arg('--snap-report')} (report only; no snap applied)`);
  }

  if (check) {
    if (changedFiles.length) {
      console.error(`tokenize-styles --check: would change ${changedFiles.join(', ')}`);
      process.exit(1);
    }
    return;
  }
  for (const p of changedFiles) writeFileSync(join(dir, p), outText.get(p));
  if (changedFiles.length) console.log(`tokenize-styles: wrote ${changedFiles.length} file(s)`);
}

export { pieceName };

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`tokenize-styles: ${e.message}`);
    process.exit(1);
  }
}
