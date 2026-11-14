/*
 * 1221 · THE ACCESSIBLE COLOURS HOLD THEIR NUMBERS (BL-51)
 *
 * Owner, 2026-11-03: "We should certainly make a 'colorblind friendly' version
 * that ignores aesthetics and just makes sure everything is very easy to see and
 * accessible." Settings → Colours → Accessible (ui/prefs.ts) puts
 * data-colors="accessible" on <html>, and tokens.css's theme block re-points the
 * colours that collide. Its comment makes claims in numbers; until this file
 * nothing recomputed them, and one was wrong (the table's roles were said to be
 * 24.1 apart; they were 18.0, and the "in progress" magenta was 2.9:1 as text).
 * 1030 holds the default palette the same way.
 *
 * Colour-vision deficiency is simulated with Machado, Oliveira & Fernandes
 * (2009) at full severity, on linear sRGB; "apart" is CIEDE2000. Under about 10
 * two chip-sized colours are hard to tell apart.
 *
 *   §0 non-vacuity: the maths reproduces CIEDE2000's published pairs and the
 *      standard palette's two known collisions (fire/earth to a protan, the
 *      legal green against the danger red to a deutan)
 *   §1 the seven elements are ≥ 15 apart in every vision; each element's ink
 *      clears 3:1 on it
 *   §2 the table's four roles (legal, targeting, in progress, danger) are ≥ 15
 *      apart in every vision; a win (success) and a loss (danger) ≥ 30 to a deutan
 *   §3 every text colour the mode re-points clears AA (4.5:1) on every surface
 *   §4 a target is told by a MARK as well as hue: a ◎ (not a doubled ring —
 *      the owner turned that look down, test 326), on a card, a player's life
 *      and a stack item, and only in the mode
 *   §5 a PICKED card (your formation, the send list, a ticked pick-a-set card)
 *      wears a ✓ in the mode: its blue ring is the mode's cyan legal ring to a
 *      deutan, though not with the standard green
 *   §6 red TEXT is lifted in the mode (it was 3.95:1 on a raised panel), and
 *      every red FILL under white ink reads --color-danger-fill, which keeps
 *      the standard red so the white stays over 3:1 in both modes
 *   §7 every shape filled with an element colour (a swatch, a share bar, a chip, a
 *      resource pip) has a light inset ring in the mode: earth and wood cannot
 *      clear 3:1 on the panels as colours (BL-51 (a))
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { declarations } from '../scripts/css-scan.mjs';
import { readStyles, readStylePieces } from './read-styles.ts';

/* ── the tokens: :root, with the theme block laid over it ── */
const tokensText = readStylePieces().find(p => /(^|\/)tokens\.css$/.test(p.piece))!.text;
const decls = declarations(tokensText).decls.map(d => ({ ...d, value: tokensText.slice(d.start, d.end).trim().toLowerCase() }));
// declarations() masks a string's letters, so the theme's selector reads :root[data-colors="__________"]
const THEME = /^:root\[data-colors="(accessible|_{10})"\]$/;
const STD = new Map(decls.filter(d => d.selector === ':root').map(d => [d.prop, d.value] as const));
const THEMED = new Map(decls.filter(d => THEME.test(d.selector)).map(d => [d.prop, d.value] as const));
const ACC = new Map([...STD, ...THEMED]);
const tok = (m: Map<string, string>, name: string): string => {
  let v = m.get(name);
  for (let i = 0; v && /^var\(/.test(v) && i < 5; i++) v = m.get(/^var\(\s*(--[\w-]+)/.exec(v)![1]!);
  assert.ok(v && /^#[0-9a-f]{6}$/.test(v), `${name} is not a #rrggbb colour (${v})`);
  return v!;
};

/* ── WCAG contrast ── */
const rgb = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const lin = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lumLin = ([r, g, b]: number[]): number => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
const contrast = (a: string, b: string): number => {
  const [x, y] = [lumLin(rgb(a).map(lin)), lumLin(rgb(b).map(lin))].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

/* ── Machado 2009, severity 1, on linear sRGB ── */
type Vision = 'normal' | 'protan' | 'deutan' | 'tritan';
const VISIONS: Vision[] = ['normal', 'protan', 'deutan', 'tritan'];
const MACHADO: Record<Exclude<Vision, 'normal'>, number[][]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const seen = (hex: string, v: Vision): number[] => {
  const l = rgb(hex).map(lin);
  if (v === 'normal') return l;
  return MACHADO[v].map(r => Math.min(1, Math.max(0, r[0]! * l[0]! + r[1]! * l[1]! + r[2]! * l[2]!)));
};

/* ── CIELAB (D65) and CIEDE2000 ── */
const lab = ([r, g, b]: number[]): [number, number, number] => {
  const X = (0.4124564 * r! + 0.3575761 * g! + 0.1804375 * b!) / 0.95047;
  const Y = 0.2126729 * r! + 0.7151522 * g! + 0.0721750 * b!;
  const Z = (0.0193339 * r! + 0.1191920 * g! + 0.9503041 * b!) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
const RAD = Math.PI / 180;
function ciede2000([L1, a1, b1]: number[], [L2, a2, b2]: number[]): number {
  const C1 = Math.hypot(a1!, b1!), C2 = Math.hypot(a2!, b2!), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1!, ap2 = (1 + G) * a2!;
  const Cp1 = Math.hypot(ap1, b1!), Cp2 = Math.hypot(ap2, b2!);
  const hue = (x: number, y: number): number => { if (x === 0 && y === 0) return 0; const t = Math.atan2(y, x) / RAD; return t < 0 ? t + 360 : t; };
  const hp1 = hue(ap1, b1!), hp2 = hue(ap2, b2!);
  const dL = L2! - L1!, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) { dh = hp2 - hp1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh / 2 * RAD);
  const Lb = (L1! + L2!) / 2, Cpb = (Cp1 + Cp2) / 2;
  let hb = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) hb = Math.abs(hp1 - hp2) > 180 ? (hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2) : (hp1 + hp2) / 2;
  const T = 1 - 0.17 * Math.cos((hb - 30) * RAD) + 0.24 * Math.cos(2 * hb * RAD) + 0.32 * Math.cos((3 * hb + 6) * RAD) - 0.2 * Math.cos((4 * hb - 63) * RAD);
  const dth = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7));
  const Sl = 1 + 0.015 * (Lb - 50) ** 2 / Math.sqrt(20 + (Lb - 50) ** 2), Sc = 1 + 0.045 * Cpb, Sh = 1 + 0.015 * Cpb * T;
  const Rt = -Math.sin(2 * dth * RAD) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}
const apart = (a: string, b: string, v: Vision): number => ciede2000(lab(seen(a, v)), lab(seen(b, v)));

/** the closest pair of a set, in any vision */
function closest(m: Map<string, string>, names: string[]): { d: number; v: Vision; a: string; b: string } {
  let best = { d: Infinity, v: 'normal' as Vision, a: '', b: '' };
  for (const v of VISIONS) for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const d = apart(tok(m, names[i]!), tok(m, names[j]!), v);
    if (d < best.d) best = { d, v, a: names[i]!, b: names[j]! };
  }
  return best;
}
const fmt = (c: ReturnType<typeof closest>): string => `${c.a} / ${c.b} to ${c.v} vision: ${c.d.toFixed(1)}`;

const ELEMENTS = ['--fire', '--water', '--earth', '--wood', '--metal', '--light', '--dark'];
const ROLES = ['--glow', '--target', '--pending', '--danger'];
const SURFACES = ['--color-bg', '--color-surface', '--color-surface-raised', '--color-surface-sunken'];

/* ════════════════════════════════════════════════════════════════════════ */

test('1221 §0 non-vacuity: the maths is CIEDE2000\'s and Machado\'s, and finds the standard palette\'s collisions', () => {
  assert.ok(THEMED.size >= 8, `only ${THEMED.size} declarations read from the accessible block`);
  // Sharma, Wu & Dalal (2005), the published test pairs 1, 7 and 17
  assert.equal(ciede2000([50, 2.6772, -79.7751], [50, 0, -82.7485]).toFixed(4), '2.0425');
  assert.equal(ciede2000([50, 0, 0], [50, -1, 2]).toFixed(4), '2.3669');
  assert.equal(ciede2000([50, 2.5, 0], [73, 25, -18]).toFixed(4), '27.1492');
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48');
  // the reason the mode exists: with the standard colours fire and earth are one brown to a
  // protan, and the legal green is the danger red to a deutan
  const el = closest(STD, ELEMENTS), roles = closest(STD, ROLES);
  assert.ok(el.d < 3, `standard elements: ${fmt(el)} — positive control, should collide`);
  assert.ok(roles.d < 5 && roles.v === 'deutan', `standard roles: ${fmt(roles)} — positive control, should collide`);
});

test('1221 §1 accessible: the seven elements are at least 15 apart in every vision, and each ink reads on its element', () => {
  const el = closest(ACC, ELEMENTS);
  assert.ok(el.d >= 15, `the closest elements: ${fmt(el)}`);
  // light and metal print dark ink, dark its own white; the others take the white of a chip
  const ink: Record<string, string> = { '--light': '--light-ink', '--metal': '--metal-ink', '--dark': '--dark-ink' };
  const fails = ELEMENTS.map(e => {
    const inkHex = ink[e] ? tok(ACC, ink[e]!) : tok(ACC, '--color-text-on-fill');
    const c = contrast(inkHex, tok(ACC, e));
    return c >= 3 ? '' : `${e} ${tok(ACC, e)} under ${inkHex}: ${c.toFixed(2)}`;
  }).filter(Boolean);
  assert.deepEqual(fails, [], 'an element\'s ink under 3:1');
});

test('1221 §2 accessible: legal, targeting, in progress and danger are at least 15 apart in every vision; a win is not a loss', () => {
  const roles = closest(ACC, ROLES);
  assert.ok(roles.d >= 15, `the closest table roles: ${fmt(roles)}`);
  const winLoss = apart(tok(ACC, '--color-success'), tok(ACC, '--color-danger'), 'deutan');
  assert.ok(winLoss >= 30, `success / danger to a deutan: ${winLoss.toFixed(1)}`);
});

test('1221 §3 accessible: every text colour the mode re-points clears AA on every surface', () => {
  const texts = [...THEMED.keys()].filter(k => ['--glow', '--target', '--pending'].includes(k) || /^--color-(success|warning|info|danger|text|accent|link)$/.test(k));
  assert.ok(texts.includes('--pending') && texts.includes('--color-success'), `texts read: ${texts.join(', ')}`);
  const fails: string[] = [];
  for (const fg of texts) for (const bg of SURFACES) {
    const c = contrast(tok(ACC, fg), tok(ACC, bg));
    if (c < 4.5) fails.push(`${fg} ${tok(ACC, fg)} on ${bg}: ${c.toFixed(2)}`);
  }
  for (const s of ['success', 'danger']) {
    const c = contrast(tok(ACC, `--color-${s}`), tok(ACC, `--color-${s}-bg`));
    if (c < 4.5) fails.push(`--color-${s} on --color-${s}-bg: ${c.toFixed(2)}`);
  }
  assert.deepEqual(fails, [], 'a re-pointed text colour under 4.5:1:\n  ' + fails.join('\n  '));
});

/* ── §4: the rules, as selector → bodies (comments out; nothing here is inside an @media) ── */
const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = new Map<string, string[]>();
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  for (const sel of m[1]!.split(',')) {
    const s = sel.trim().replace(/\s+/g, ' ');
    if (!RULES.has(s)) RULES.set(s, []);
    RULES.get(s)!.push(m[2]!);
  }
}
const body = (sel: string): string => (RULES.get(sel) ?? []).join(';');
const A = ':root[data-colors="accessible"]';

test('1221 §4 accessible: a target wears a ◎ mark, on a card, a life and a stack item; off, there is no mark', () => {
  for (const sel of ['.card.candidate', '.life.candidate', '.stackcard.candidate']) {
    // the gold ring is still there in both modes; the mark is added, only in the mode
    assert.match(body(sel), /outline:\s*\d+px solid var\(--target\)/, `${sel}: the gold ring`);
    const mark = body(`${A} ${sel}::after`);
    assert.match(mark, /content:\s*'◎'/, `${sel}: the ◎ mark in the accessible mode`);
    assert.match(mark, /position:\s*absolute/, `${sel}: the mark sits on the card, out of the layout`);
    assert.match(mark, /pointer-events:\s*none/, `${sel}: the mark never takes the click`);
    assert.equal(body(`${sel}::after`), '', `${sel}: no mark without the mode`);
  }
  // each mark's frame is positioned, and nothing else draws ::after on one
  for (const sel of ['.card', '.stackcard', '.life']) assert.match(body(sel), /position:\s*relative/, `${sel} is the mark's frame`);
  const others = [...RULES.keys()].filter(s => /\.(stack)?card\b[^ ]*::?after|\.life\b[^ ]*::?after/.test(s) && !s.startsWith(A));
  assert.deepEqual(others, [], 'another ::after on a card or a life would fight the mark');
  // the legal ring is not marked, so the two differ by more than hue
  assert.equal(body(`${A} .card.playable::after`), '', 'the legal ring carries no mark');
  assert.match(body('.card.playable'), /outline:\s*2px solid var\(--glow\)/);
});

test('1221 §5 accessible: a picked card wears a ✓, because its blue ring is the mode\'s legal cyan to a deutan', () => {
  // why: the mode moves the legal ring from green to cyan, onto the picked blue
  const blue = /outline:\s*3px solid (#[0-9a-f]{6})/i.exec(body('.card.selected'))?.[1]?.toLowerCase();
  assert.ok(blue, 'the picked ring is a solid #rrggbb outline');
  const std = apart(blue!, tok(STD, '--glow'), 'deutan'), acc = apart(blue!, tok(ACC, '--glow'), 'deutan');
  assert.ok(std >= 30, `picked / legal with the standard colours, to a deutan: ${std.toFixed(1)}`);
  assert.ok(acc < 15, `picked / legal in the mode, to a deutan: ${acc.toFixed(1)} — if this clears 15, the mark may be unneeded`);
  const sel = `${A} .card.selected:not(.candidate)::after`;
  const mark = body(sel);
  assert.match(mark, /content:\s*'✓'/, 'the ✓ mark in the accessible mode');
  assert.match(mark, /position:\s*absolute/, 'the mark sits on the card, out of the layout');
  assert.match(mark, /pointer-events:\s*none/, 'the mark never takes the click');
  assert.equal(body('.card.selected::after'), '', 'no mark without the mode');
  // a picked target keeps the ◎: the ✓ stands aside rather than fight it for the one ::after
  assert.ok(/:not\(\.candidate\)/.test(sel) && body(`${A} .card.candidate::after`).includes('◎'));
});

test('1221 §6 accessible: red text is lifted to AA on a raised panel; a red fill under white ink keeps a red white reads on', () => {
  // why: the standard red is 3.95:1 as text on a raised panel (a danger button's label), and it
  // cannot be lifted while white sits on it as a fill (the bell's count, a damage chip)
  const std = contrast(tok(STD, '--color-danger'), tok(STD, '--color-surface-raised'));
  assert.ok(std < 4.5, `standard red text on a raised panel: ${std.toFixed(2)} — if this clears 4.5, the split may be unneeded`);
  assert.ok(THEMED.has('--color-danger'), 'the mode re-points red text (§3 then holds it to AA on every surface)');
  assert.ok(!THEMED.has('--color-danger-fill'), 'the fill keeps the standard red in the mode');
  assert.equal(tok(STD, '--color-danger-fill'), tok(STD, '--color-danger'), 'with the standard colours, a fill and text are one red');
  for (const [name, m] of [['standard', STD], ['accessible', ACC]] as const) {
    const c = contrast(tok(m, '--color-text-on-fill'), tok(m, '--color-danger-fill'));
    assert.ok(c >= 3, `${name}: white on the red fill ${c.toFixed(2)}`);
  }
  // white on the mode's lifted red would not read: that is why a fill must take the fill token
  assert.ok(contrast(tok(ACC, '--color-text-on-fill'), tok(ACC, '--color-danger')) < 3);
  // the census: no rule paints a background with the TEXT red (a color-mix tint is not a fill)
  const fills = [...RULES.entries()]
    .filter(([, bodies]) => bodies.some(b => /background(-color)?\s*:\s*var\(--(color-)?danger\)/.test(b)))
    .map(([sel]) => sel);
  assert.deepEqual(fills, [], 'a red background reads --color-danger / --danger; use --color-danger-fill');
  const users = [...RULES.values()].flat().filter(b => /background(-color)?\s*:\s*var\(--color-danger-fill\)/.test(b)).length;
  assert.ok(users >= 9, `only ${users} rules read the fill red — the census is reading nothing`);
});

test('1221 §7 accessible: every shape filled with an element colour has a light edge that clears AA on every surface', () => {
  // why: earth, wood and dark as fills are under 3:1 on a raised panel in the mode, and no
  // colour can fix that while white ink stays readable on them — so the shape needs an edge
  const weak = ELEMENTS.filter(e => SURFACES.some(s => contrast(tok(ACC, e), tok(ACC, s)) < 3));
  assert.ok(weak.includes('--earth') && weak.includes('--wood'), `elements under 3:1 on some surface: ${weak.join(', ')} — if none, the ring may be unneeded`);
  // the ring's colour clears AA on every surface
  for (const s of SURFACES) {
    const c = contrast(tok(ACC, '--color-text'), tok(ACC, s));
    assert.ok(c >= 4.5, `the ring (--color-text) on ${s}: ${c.toFixed(2)}`);
  }
  // the census: every rule that fills a shape with an element's colour names a class the mode rings
  const RING = /box-shadow:\s*inset 0 0 0 1px var\(--color-text\)/;
  const fills = [...RULES.entries()]
    .filter(([sel, bodies]) => !sel.startsWith(A) && bodies.some(b => /background(-color)?\s*:[^;]*var\(--(fire|water|earth|wood|metal|light|dark)\)/.test(b)))
    .map(([sel]) => sel);
  assert.ok(fills.length >= 30, `only ${fills.length} element fills found — the census is reading nothing`);
  // a fill is ringed through one of its classes, or through its own whole selector (card stats'
  // `.csbarfill.el-fire`, scoped so the Learn menu's `el-fire` buttons are not painted — 1244)
  const bare = fills.filter(sel => !RING.test(body(`${A} ${sel}`)) && !(sel.match(/\.[\w-]+/g) ?? []).some(c => RING.test(body(`${A} ${c}`))));
  assert.deepEqual(bare, [], 'an element-coloured shape with no ring in the accessible mode');
  // only in the mode: the standard look has no ring
  for (const c of ['.pfswatch', '.elbarseg', '.acctel', '.reschip', '.csbarfill.el-earth']) assert.doesNotMatch(body(c), RING, `${c}: no ring without the mode`);
});
