/* 325 — THE ZOOM'S LIVE P/D PLATE FOLLOWS THE PRINTED PAIR (owner, 2026-09-27).
 *
 * *"Virus/battle icon makes the power/defense render wrong on hover (icons
 * push the p/d over, but our drawing of the p/d doesn't get moved)."*
 *
 * A {Virus}, {Battle} or {Haste} glyph at the end of the name bar pushes the
 * printed pair ~52 scan px left. The plate was pinned where the pair sits on a
 * plain card, so on those cards it covered the glyph and half the printed
 * pair, and the printed digits left showing read as part of the live number.
 *
 * §1  nameBarIcon: derived from the printed flags — the glyph cards say yes,
 *     plain cards say no, Nothyr ({Battle} on a text line) says no, and
 *     Debt Blep (whose scan prints the Virus glyph; its type line was
 *     transcribed without it) says yes
 * §2  the stylesheet moves the plate for an `nbicon` copy
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getCard } from '../../engine/src/cards/dsl.ts';
import { nameBarIcon } from '../inspect.ts';

const CSS = readFileSync(fileURLToPath(new URL('../style.css', import.meta.url)), 'utf8');

test('§1 nameBarIcon: a Virus, Battle or Haste glyph on the name bar, and nothing else', () => {
  for (const n of ['Dune Drifter', 'Jelly', 'Cinder Scuttler', 'Debt Blep']) {
    assert.equal(nameBarIcon(n), true, `${n} prints a glyph at the end of its name bar`);
  }
  for (const n of ['Ignis Sprite', 'Nothyr']) {
    assert.equal(nameBarIcon(n), false, `${n}'s printed P/D is where a plain card's is`);
  }
  assert.equal(nameBarIcon('No Such Card'), false, 'an unknown name is not a crash');
});

test('§1 Debt Blep is a Virus card: its scan prints the glyph', () => {
  assert.equal(getCard('Debt Blep').virus, true);
});

test('§2 the plate moves left on a copy marked nbicon', () => {
  const m = /#cardzoom > \.zoomcopy\.nbicon \.stats \{ right: ([\d.]+)cqw; \}/.exec(CSS);
  assert.ok(m, 'the nbicon rule is there');
  const base = /#cardzoom > \.zoomcopy \.stats \{ top: [\d.]+cqw; right: ([\d.]+)cqw;/.exec(CSS);
  assert.ok(base, 'the plain plate rule is there');
  assert.ok(Number(m[1]) > Number(base[1]) + 6, 'the plate moves by about the glyph width (7.2cqw)');
});
