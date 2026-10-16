/* Report #208 (HVJE, the owner): "The "attributes off" UI looks like it's
 * covering abilities as well, which it shouldn't be. Attributes and abilities
 * are different things."
 *
 * The engine keeps them apart (E.suppressionOf → { attrs, abilities }); the
 * zoom drew one grey block from the type bar to the bottom whatever was off.
 * inspect.ts suppressionBand now says which band goes grey:
 *  · attributes off (Formless stamping its target's column): the type bar
 *    only, ending at textTop + TYPE_BAR_HEIGHT;
 *  · abilities off (The Everywhere naming a card): from below the bar down;
 *  · both off (Monke): the whole block, as 325 section 5 pins.
 * Driven off real boards, so a change in what the engine suppresses moves the
 * band with it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { suppressionBand, TYPE_BAR_HEIGHT } from '../inspect.ts';
import { rowFor } from '../cardindex.ts';
import { ent, pass, pick, skipHasteStep, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { EntityId, Seat } from '../../engine/src/types.ts';

const MAIN = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');
const CSS = readFileSync(fileURLToPath(new URL('../style.css', import.meta.url)), 'utf8');

function bandOf(h: Harness, id: EntityId) {
  const u = ent(h, id)!;
  const top = rowFor(u.card)?.textTop;
  assert.equal(typeof top, 'number', `${u.card} has a type-bar reading`);
  return { top: top!, sup: new E(h.state).suppressionOf(u), band: suppressionBand(new E(h.state).suppressionOf(u), top!) };
}

test('report 208 - a Formless-stamped unit greys its type bar and not its text box', () => {
  const h = new Harness(2722);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const fl = spawn(h, A, 'Formless');
  const sent = spawn(h, A, 'Recyclable Sentinel');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sent], [fl]] });
  pick(h, { unit: sent });
  pass(h); pass(h);
  const { top, sup, band } = bandOf(h, sent);
  assert.ok(sup.attrs && !sup.abilities, 'the premise: attributes off, abilities kept');
  assert.ok(band, 'something is greyed');
  assert.equal(band!.kind, 'attrs');
  assert.equal(band!.top, top, 'from the top of the type bar');
  assert.ok(band!.bottom !== null && band!.bottom <= top + TYPE_BAR_HEIGHT + 1e-9,
    `and it STOPS at the bar bottom edge (bottom ${band!.bottom}, bar ends ${top + TYPE_BAR_HEIGHT})`);
});

test('report 208 - The Everywhere silencing a unit greys below the type bar and leaves the bar', () => {
  const h = new Harness(3846);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'The Everywhere');
  const trisk = spawn(h, A, 'Triskaidekaphage');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'donePlanning', seat: 0 });
  if (!h.state.decision) h.do({ type: 'donePlanning', seat: 1 });
  if (!h.state.decision) skipHasteStep(h);
  pick(h, 'Triskaidekaphage');
  const { top, sup, band } = bandOf(h, trisk);
  assert.ok(sup.abilities && !sup.attrs, 'the premise: abilities off, attributes kept');
  assert.equal(band!.kind, 'abilities');
  assert.ok(band!.top >= top + TYPE_BAR_HEIGHT - 1e-9,
    `the grey starts BELOW the type bar (top ${band!.top}, bar ends ${top + TYPE_BAR_HEIGHT})`);
  assert.equal(band!.bottom, null, 'and runs to the bottom, over the mod strips');
});

test('report 208 - Monke switching off both greys the bar and the box', () => {
  const h = new Harness(3250);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const mine = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  const monke = spawn(h, A, 'Monke');
  h.state.entities[monke]!.spawnedTurn = h.state.turn;
  const { top, sup, band } = bandOf(h, mine);
  assert.ok(sup.abilities && sup.attrs);
  assert.deepEqual(band, { kind: 'all', top, bottom: null });
});

test('report 208 - the zoom draws the band it is given', () => {
  assert.match(MAIN, /suppressionBand\(sup, rowFor\(u\.card\)\?\.textTop/, 'the zoom asks the helper');
  assert.match(MAIN, /class="zoomsupp band-\$\{band\.kind\}"/, 'and tags the block with the band');
  assert.match(CSS, /#cardzoom \.zoomsupp\.band-attrs \{[^}]*bottom: auto;[^}]*height: calc\(\(var\(--tbbot\) - var\(--tbtop\)\)/,
    'an attributes band stops at --tbbot instead of running to the bottom');
  assert.equal(suppressionBand({ attrs: false, abilities: false }, 0.8), null, 'nothing off, nothing grey');
});
