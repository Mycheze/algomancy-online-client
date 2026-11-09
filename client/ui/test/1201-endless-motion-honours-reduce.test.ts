/* 1201 · EVERYTHING THAT PULSES FOREVER STOPS FOR "REDUCE MOTION"
 * (BL-10, the visual polish pass, 2026-11-09).
 *
 * The client honours the system's "reduce motion" setting in two ways: the
 * card flights read it in anim.ts, and every CSS animation that loops for as
 * long as the element is on screen is meant to have a
 * `@media (prefers-reduced-motion: reduce)` rule beside it that stops it (or,
 * for the queue's spinner, slows it). Most did — the stack's breathing, the
 * clock warning, the waiting dot, the offline toolbar chip, the glimpse
 * notice. Seven did not (docs/23-ui-inventory/05 §18.27 found the first):
 *
 *   the post-game "X wants a rematch — accept" button · the lesson's anchor
 *   dot and its highlight ring · the "● live" dot · a unit you can activate ·
 *   a unit or a spell you can mod onto (two rules)
 *
 * Each of them still carries its meaning without the pulse — the glow, the
 * outline, the colour stay — so stopping the loop loses nothing but the
 * motion, the same trade the stack's own block spells out ("the breathing
 * goes; the colour and the raised card carry it alone").
 *
 * This is a CENSUS over the whole stylesheet: every rule whose `animation`
 * repeats `infinite` must have its selector named again, word for word,
 * inside a reduced-motion block. A new endless pulse without one goes red here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStyles } from './read-styles.ts';

const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');

/** split a run of CSS into its top-level blocks: [prelude, body] */
function blocks(text: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0, start = 0, open = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') { if (depth === 0) open = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0) { out.push([text.slice(start, open).trim(), text.slice(open + 1, i)]); start = i + 1; }
    }
  }
  return out;
}
const selectors = (prelude: string): string[] =>
  prelude.split(',').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);

const endless: string[] = [];
const stilled = new Set<string>();
for (const [prelude, body] of blocks(css)) {
  if (/^@media[^{]*prefers-reduced-motion:\s*reduce/.test(prelude)) {
    for (const [inner, decl] of blocks(body))
      if (/animation(-name|-duration)?\s*:/.test(decl)) for (const s of selectors(inner)) stilled.add(s);
    continue;
  }
  if (prelude.startsWith('@')) continue;     // keyframes, other media: not a looping rule's home
  if (/animation(-iteration-count)?\s*:[^;]*\binfinite\b/.test(body)) endless.push(...selectors(prelude));
}

test('1201: the census finds the endless animations it is meant to (it is not reading an empty sheet)', () => {
  for (const s of ['.pgwants', '.lhl', '.card.activatable', '.stackcaption .stackwait', '.qspin'])
    assert.ok(endless.includes(s), `${s} should be among the endless animations`);
});

test('1201: every animation that loops forever is stopped or slowed under prefers-reduced-motion', () => {
  const missing = [...new Set(endless)].filter(s => !stilled.has(s));
  assert.deepEqual(missing, [],
    'these rules pulse forever with no @media (prefers-reduced-motion: reduce) rule naming the same selector');
});

test('1201: the post-game rematch answer and the lesson highlights stop pulsing, and keep their colour', () => {
  for (const s of ['.pgwants', '.lanchor.on', '.lhl', '.livedot', '.card.activatable', '.card.modhost', '.stackcard.modhost'])
    assert.ok(stilled.has(s), `${s} is stilled under reduced motion`);
  // the meaning is not in the animation: the rule itself still colours them
  assert.match(css, /\.pgwants \{[^}]*border-color: var\(--glow\)/);
  assert.match(css, /\.lhl \{[^}]*outline: 3px solid/);
  assert.match(css, /\.card\.activatable \{[^}]*box-shadow:/);
});
