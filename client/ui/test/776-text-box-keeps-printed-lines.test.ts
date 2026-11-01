/* REPORT #316 (the owner, room EMNR, 2026-11-01) — the text box keeps the
 * card's own new lines.
 *
 * "Some of the rendered text boxes when hovering units don't show their
 * actual correct 'line breaks' on the card, putting everything on one line."
 *
 * Powerforge Synergist prints two paragraphs — "I spawn with two +1/+1
 * counters." and, on its own line, "[Augment] When I despawn…". The oracle
 * marks the line with `{/n}`, but the box (cardtext.ts `printedBoxText`, the
 * text the unit zoom, the hover tip, the inspector and the card panel all
 * draw) went through `clean`, which flattens every `{/n}` to a space. It has
 * to: `{/n}` also marks the scan's hyphenated words ("sacri- {/n}fices") and
 * its plain mid-sentence wraps ("you {/n}may put"), and neither is a line in
 * a box of another width.
 *
 * `boxClean` tells them apart from the text: a `{/n}` after the end of a
 * sentence is a new line (drawn `<br>`); every other one joins, the hyphen
 * with no space. Checked here on the reported card in play, then over the
 * whole pool, so a new card is held to the same reading without a list.
 *
 * Seeds 77600-77699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../../engine/src/cards/sets/index.ts';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import printedJson from '../../engine/src/cards/printed.json' with { type: 'json' };
import { boxClean, clean, entityTextBox, iconizeText, printedTextBox } from '../cardtext.ts';
import { spawn, toDeployment, withE } from '../../engine/test/util.ts';

const PRINTED = printedJson as unknown as Record<string, { text?: string }>;
const MAIN = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');
const tbtext = (html: string): string => html.replace(/<img[^>]*>/g, '□');

test('report #316: Powerforge Synergist in play — the zoom box breaks where the card does', () => {
  const h = new Harness(77601);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const pf = spawn(h, A, 'Powerforge Synergist');
  const box = entityTextBox(new E(h.state), h.state.entities[pf]!);
  const printed = box.lines.find(l => l.origin === 'printed');
  assert.ok(printed, 'the printed line');
  const html = tbtext(iconizeText(printed!.text));
  assert.match(html, /I spawn with two \+1\/\+1 counters\.<br>□ When I despawn, you may move my counters onto target unit\./);
  assert.equal(html.match(/<br>/g)?.length, 1, 'one new line, the printed one');
});

test('report #316: the unit zoom and the hover tip draw this box', () => {
  // the hover surfaces read the box, never the raw oracle text
  assert.match(MAIN, /function zoomPanelHtml[\s\S]{0,700}textBoxHtml\(entityTextBox\(q\(\), u\)\)/);
  assert.match(MAIN, /function hoverTipHtml[\s\S]{0,500}textBoxHtml\(box, \{ compact: true \}\)/);
  assert.match(MAIN, /<span class="tbtext">\$\{iconizeText\(l\.text\)\}<\/span>/, 'the box line is iconized, so {/n} draws <br>');
});

test('report #316: a mod donating its [Augment] text keeps its new line too (Ancient One under a unit)', () => {
  const h = new Harness(77602);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Good Whale');
  withE(h, e => { e.attachMod(e.entity(host)!, 'Ancient One', A, 'augment'); });
  const box = entityTextBox(new E(h.state), h.state.entities[host]!);
  const line = box.lines.find(l => l.from === 'Ancient One');
  assert.ok(line, 'the donated line');
  assert.match(iconizeText(line!.text), /adjacent allies\.<br>/, 'its reminder sits on its own line, as printed');
});

test('report #316: hyphenated and mid-sentence wraps still join — no "sacri-<br>fices"', () => {
  const read = (n: string): string => tbtext(iconizeText(printedTextBox(n).lines[0]!.text));
  assert.match(read('Structural Collapse'), /Each opponent sacrifices units until their total defense is at least equal/);
  assert.match(read('Arcane Concentrator'), /create an X\/X unit/);
  assert.match(read('Formless'), /becomes a base 4\/4/);
  assert.match(read('Rousing Spirit'), /you may put target unit with cost 2 or less from your bin into the empty slot/);
  for (const n of ['Structural Collapse', 'Arcane Concentrator', 'Formless', 'Rousing Spirit', 'Phytochemical Protection']) {
    assert.doesNotMatch(read(n), /<br>/, `${n}: every {/n} it prints is a wrap, not a line`);
  }
});

test('report #316, whole pool: no word lost, a break kept exactly where a sentence ends, no broken word', () => {
  const ENDS = /[.)\]!?]["'\u201d\u2019]*(?:\{\/i\})?\s*$/;
  const bad: string[] = [];
  let kept = 0, cards = 0;
  for (const [name, c] of Object.entries(PRINTED)) {
    const t = c.text ?? '';
    if (!t.includes('{/n}')) continue;
    cards++;
    const b = boxClean(t);
    // the same words as the one-line reading: only some spaces became lines
    if (b.replace(/\{\/n\}/g, ' ') !== clean(t)) bad.push(`${name}: words changed`);
    const segs = t.split('{/n}');
    const ends = segs.slice(0, -1).filter((_, i) => ENDS.test(segs.slice(0, i + 1).join('{/n}'))).length;
    const breaks = (b.match(/\{\/n\}/g) ?? []).length;
    if (breaks !== ends) bad.push(`${name}: ${breaks} lines kept, ${ends} breaks after a sentence end`);
    for (const line of b.split('{/n}')) {
      if (/[A-Za-z]-$/.test(line) || line !== line.trim() || !line) bad.push(`${name}: bad line "${line}"`);
    }
    kept += breaks;
  }
  assert.deepEqual(bad, []);
  assert.ok(cards >= 60, `the pool's {/n} cards were read (${cards})`);
  assert.ok(kept >= 25 && kept < cards, `some breaks are lines and some are wraps (${kept} kept)`);
});
