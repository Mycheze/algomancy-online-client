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
 *
 * …and the second zoom item of the same list: *"Units that have their
 * abilities removed or turned off don't visually show it in the new zoom
 * view."* The only marker was a line in the rail's text box.
 *
 * §3  suppressionNote words it — the chip on the unit, the banner on the
 *     zoom — and says nothing when nothing is off
 * §4  a real suppression (Monke) reaches the unit's chips
 * §5  the rules box's top, read off every scan (bot/pipeline/
 *     read_text_boxes.py), reaches the catalogue; the zoom greys from there
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getCard } from '../../engine/src/cards/dsl.ts';
import { nameBarIcon, suppressionNote } from '../inspect.ts';
import { rowFor } from '../cardindex.ts';
import { E } from '../../engine/src/engine.ts';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { client } from './ui-driver.ts';

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

test('§3 suppressionNote: what is off, and what did it', () => {
  assert.equal(suppressionNote({ attrs: false, abilities: false, by: [] }), null);
  const ab = suppressionNote({ attrs: false, abilities: true, by: ['Formless'] })!;
  assert.equal(ab.badge.t, '⊘ abilities off');
  assert.match(ab.badge.title!, /abilities switched off by Formless/);
  assert.equal(ab.banner, '⊘ Abilities off — Formless');
  const both = suppressionNote({ attrs: true, abilities: true, by: ['Monke'] })!;
  assert.equal(both.badge.t, '⊘ all off');
  assert.equal(both.banner, '⊘ Abilities and attributes off — Monke');
});

test('§4 a unit Monke switched off wears the chip on the table', async () => {
  const ui = await client();
  const h = new Harness(3250);
  toDeployment(h);
  const A = h.state.initiative as 0 | 1;
  const mine = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  // Monke: "If I spawned this turn, other units lose all attributes and
  // abilities during battle." — so it spawns in THIS turn's battle (the
  // test helper places a unit without the spawn stamp; say when it came)
  // (its own side: a static reaches the units in its region, and "other
  // units" is everyone else there)
  const monke = spawn(h, A, 'Monke');
  h.state.entities[monke]!.spawnedTurn = h.state.turn;
  const sup = new E(h.state).suppressionOf(h.state.entities[mine]!);
  assert.ok(sup.abilities && sup.attrs, 'the premise: Monke has switched the whale off in battle');
  const html = ui.join(h.state, A, legalActions(h.state, A));
  const at = html.indexOf(`data-previd="${mine}"`);
  const card = html.slice(html.lastIndexOf('<div class="card', at), at + 2000);
  assert.match(card, /class="badge supp"[^>]*title="abilities and attributes switched off by Monke"[^>]*>⊘ all off</);
});

test('§5 the rules box\'s top is on file for the pool, and the zoom greys from it', () => {
  const tops = ['Debt Blep', 'Dematerialize', 'Tithe Enforcer', 'Monke', 'Conduit of Pain']
    .map(n => [n, rowFor(n)?.textTop] as const);
  for (const [n, t] of tops) {
    assert.equal(typeof t, 'number', `${n} has a reading`);
    assert.ok(t! > 0.6 && t! < 0.95, `${n}: ${t} is inside the card's lower half`);
  }
  // measured, not assumed: the box sits at very different heights
  assert.ok(rowFor('Tithe Enforcer')!.textTop! - rowFor('Dematerialize')!.textTop! > 0.15);
  assert.match(CSS, /#cardzoom \.zoomsupp \{[^}]*top: calc\(var\(--tbtop/);
  // …and runs to the bottom of the copy, over the mod strips hanging under
  // the card: an augment's text and attributes are off with the rest (owner,
  // 2026-09-27: "The Unaware mod is half visible")
  assert.match(CSS, /#cardzoom \.zoomsupp \{[^}]*bottom: 0;/);
  assert.doesNotMatch(/#cardzoom \.zoomsupp \{[^}]*\}/.exec(CSS)![0], /\bheight:/, 'no fixed height to stop it at the card\'s edge');
});
