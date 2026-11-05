/* 1142 · A LONG DECK NAME IS CUT SHORT BEFORE THE COUNT PILL (CT-520, 2026-11-05).
 *
 * Found in real Firefox at 768×1024 (BL-65 W5b): the builder's toolbar title,
 * 'Single-Box Battle Deck - Fire v1.1.0', ran under the count pill. The name
 * button had min-width: 0 and max-width: 32vw, but it was an inline-block
 * with its text loose inside it and nothing clipping it, so the button stopped
 * at 32vw and the name painted on past its edge, over the pill beside it.
 *
 *   §1 the markup: the name is its own span inside the button, before the ✎
 *   §2 the CSS: the button is a shrinking flex row that clips; the name is the
 *      part that gives (min-width 0, nowrap, ellipsis); the ✎ and the pill
 *      never shrink
 *   §3 retyping the name in Deck info retitles that span (decks.ts), not a
 *      text node the span has replaced
 *
 * Seeds: none. No browser runs here; the measurement at 768 is the owner's
 * check (the CT's verify line).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../engine/src/cards/registry.ts';
import { readStyles } from './read-styles.ts';
import { builderHtml, type BuilderView } from '../pages/builder.ts';

const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, ' ');
/** every declaration block whose selector list contains `sel` as one selector */
const decls = (sel: string): string => {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1]!.split(',').map(s => s.trim().replace(/\s+/g, ' ')).includes(sel)) out.push(m[2]!);
  }
  return out.join(';');
};

const V: BuilderView = {
  title: 'Single-Box Battle Deck - Fire v1.1.0', titleBtn: 'deck-settings', backLabel: 'Decks',
  pill: { text: '27 / 30', tone: 'warn', problems: ['3 cards short'] }, stripHtml: '',
  hostToolsHtml: '', canUndo: false, canRedo: false, stats: false,
  note: null, pool: null, split: 0.4, head: null,
  table: { cw: 108, ch: 150, piles: [], newPiles: { emptyText: 'x' } },
  statsStripHtml: '', sheet: null, hostSheetHtml: '', readOnly: false,
  chrome: { signedIn: true, alerts: 0 },
};

test('§1 the name is its own span inside the Deck info button, then the ✎, then the pill', () => {
  const html = builderHtml(V);
  assert.match(html,
    /<button class="[^"]*tttitlebtn"[^>]*data-btn="deck-settings"[^>]*><span class="tttitlename">Single-Box Battle Deck - Fire v1\.1\.0<\/span><svg[\s\S]*?<\/button><button[^>]*ttpill/,
    'button > span.tttitlename + svg, the pill right after');
});

test('§2 the button clips and shrinks, the name ellipsizes, the ✎ and the pill hold', () => {
  const btn = decls('.ttpage .tttitlebtn');
  assert.match(btn, /display:\s*inline-flex/, 'a flex row, so its name can shrink inside it');
  assert.match(btn, /overflow:\s*hidden/, 'nothing of the name paints past the button');
  assert.match(btn, /flex:\s*0 1 auto/, 'it gives way in the title row');
  const base = decls('.tttitlebtn');
  assert.match(base, /min-width:\s*0/, 'the button may go narrower than its name');
  const name = decls('.tttitlename');
  for (const want of [/min-width:\s*0/, /overflow:\s*hidden/, /text-overflow:\s*ellipsis/, /white-space:\s*nowrap/]) {
    assert.match(name, want, `the name: ${want}`);
  }
  assert.match(decls('.tttitlebtn > svg'), /flex:\s*none/, 'the ✎ is never squeezed');
  assert.match(decls('.ttpill'), /flex:\s*none/, 'the pill is never squeezed');
  assert.match(decls('.ttpage .frametitle'), /display:\s*flex/, 'the title is the flex row the button shrinks in');
});

test('§3 retyping the name retitles the span', () => {
  const src = readFileSync(new URL('../decks.ts', import.meta.url), 'utf8');
  assert.match(src, /querySelector\?\.\('\.tttitlebtn \.tttitlename'\)/, 'decks.ts finds the name span');
  assert.doesNotMatch(src, /title\.firstChild\.nodeValue/, 'not the bare text node the span replaced');
});
