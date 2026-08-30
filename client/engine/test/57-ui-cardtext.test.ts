/* Playtest round 9 — the card-text engine (ui/cardtext.ts).
 *
 * Bena: "cards have their oracle text changed all the time. Mods, grafts,
 * counters, other cards adding or removing rules text. The printed card is
 * hardly ever correct."
 *
 * What is being pinned is that the box a player reads is assembled from the
 * SAME queries the rules run on, so it cannot drift: attribution (which card
 * each clause and each attribute comes from), what is switched off and by
 * whom (R62), what was granted (R63), and stat arithmetic that adds up to the
 * number the engine reports rather than to a number this module invented.
 *
 * Seeds 5700-5799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  attrLines, augmentClause, clean, entityTextBox, graftComposition,
  printedTextBox, statBreakdown, switchClause, textBoxFor,
} from '../ui/cardtext.ts';
import {
  ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment,
  toNextBattle,
} from './util.ts';

const q = (h: Harness): E => new E(h.state);

/* ── clause slicing ─────────────────────────────────────────────────── */

test('clean() joins the scan\'s mid-word line breaks instead of splitting on them', () => {
  // Formless prints "be- {/n}comes" — a hyphenated word broken across two
  // printed lines, which is precisely why {/n} must never be read as a
  // clause separator
  assert.equal(clean('Target unit be- {/n}comes a base 4/4.'),
    'Target unit becomes a base 4/4.');
  assert.equal(clean('  two   spaces {/n} and a break '), 'two spaces and a break');
});

test('switchClause / augmentClause slice on the markers the scans really carry', () => {
  const sw = switchClause('Ignis Sprite');           // "When I spawn or die, [Switch] Create a Fireball 1."
  assert.ok(sw.startsWith('[Switch]'), `sliced at the marker: ${sw}`);
  assert.ok(sw.includes('Fireball'), 'and keeps the effect');
  // a card with no [Augment] in its TEXT donates no text (R55) — the type
  // line carries the grant instead
  assert.equal(augmentClause('Ephemeral Skywalker'), '',
    'type-line [Augment] is not text-box [Augment]');
});

/* ── the printed box ────────────────────────────────────────────────── */

test('a card off the table reads as its printed self', () => {
  const box = printedTextBox('Ephemeral Skywalker');
  assert.equal(box.name, 'Ephemeral Skywalker');
  assert.deepEqual(box.stats?.printed, [3, 1]);
  assert.equal(box.modified, false, 'nothing has happened to it');
  assert.deepEqual(box.attrs.map(a => a.attr), ['Flying']);
  assert.equal(box.attrs[0]!.origin, 'printed');
  assert.equal(box.suppressed.abilities, false);
});

test('a spell has no stat line to show', () => {
  assert.equal(printedTextBox('Suppression Field').stats, null);
});

test('an unknown card degrades to an empty box rather than throwing', () => {
  const box = printedTextBox('Not A Real Card');
  assert.equal(box.lines.length, 0);
  assert.equal(box.stats, null);
});

/* ── a live unit ────────────────────────────────────────────────────── */

test('a plain unit in play reads as printed, and says so', () => {
  const h = new Harness(5701);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const u = spawn(h, A, 'Plodding Pebble');                // 0/4 {Sluggish}, [Switch1] text
  const box = entityTextBox(q(h), ent(h, u)!);
  assert.equal(box.modified, false);
  assert.equal(box.lines.length, 1);
  assert.equal(box.lines[0]!.origin, 'printed');
  assert.equal(box.lines[0]!.active, true);
  assert.ok(box.lines[0]!.text.startsWith('When I am dealt damage'), box.lines[0]!.text);
  assert.deepEqual(box.attrs.map(a => [a.attr, a.origin, a.active]), [['Sluggish', 'printed', true]]);
});

test('counters and damage show up as arithmetic, not just a number', () => {
  const h = new Harness(5702);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const u = spawn(h, A, 'Ephemeral Skywalker');            // 3/1
  ent(h, u)!.counters = 2;
  ent(h, u)!.damage = 1;
  const st = statBreakdown(q(h), ent(h, u)!);
  assert.deepEqual([st.power, st.toughness], [5, 3]);
  assert.deepEqual(st.printed, [3, 1]);
  assert.equal(st.damage, 1);
  assert.ok(st.parts.some(p => p.label.includes('counters') && p.dp === 2 && p.dt === 2));
  assert.equal(st.changed, true);
});

test('the stat parts always add up to the number the engine reports', () => {
  const h = new Harness(5703);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const other = spawn(h, A, 'Ephemeral Skywalker');        // 3/1
  spawn(h, A, 'Transmogrifant');                           // +2/+2 to your others
  ent(h, other)!.counters = 1;
  const st = statBreakdown(q(h), ent(h, other)!);
  const summed = st.parts.reduce<[number, number]>((acc, p) => [acc[0] + p.dp, acc[1] + p.dt],
    [st.printed[0], st.printed[1]]);
  assert.deepEqual(summed, [st.power, st.toughness], 'the breakdown reconciles');
  assert.deepEqual([st.power, st.toughness], [6, 4]);
});

/* ── mods ───────────────────────────────────────────────────────────── */

test('an augment mod contributes its own donated clause, attributed to it', () => {
  const h = new Harness(5704);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  {
    const e = q(h);
    e.attachMod(ent(h, host)!, 'Refuse Reclaimer', A, 'augment');   // text-box [Augment]
    e.settle();
  }
  const box = entityTextBox(q(h), ent(h, host)!);
  assert.equal(box.modified, true);
  const donated = box.lines.find(l => l.origin === 'augment');
  assert.ok(donated, 'the donated clause is its own line');
  assert.equal(donated!.from, 'Refuse Reclaimer', 'attributed to the mod, not the host');
  assert.ok(donated!.text.includes('counter'), `reads like the mod: ${donated!.text}`);
  assert.equal(donated!.active, true);
});

test('a type-line augment with no text-box clause still says what it grants', () => {
  const h = new Harness(5705);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  {
    const e = q(h);
    e.attachMod(ent(h, host)!, 'Trashling', A, 'augment');           // donates {Unaware}
    e.settle();
  }
  const box = entityTextBox(q(h), ent(h, host)!);
  const donated = box.lines.find(l => l.origin === 'augment')!;
  assert.ok(donated.text.includes('{Unaware}'), `synthesized: ${donated.text}`);
  const attr = box.attrs.find(a => a.attr === 'Unaware')!;
  assert.equal(attr.origin, 'augment');
  assert.equal(attr.from, 'Trashling', 'the badge names the card that supplies it');
});

test('grafts fold into ONE composed ability, in mod order (Manual p.33)', () => {
  const h = new Harness(5706);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  // Ignis Sprite is a graft CAUSE ("When I spawn or die, [Switch] …")
  const host = spawn(h, A, 'Ignis Sprite');
  {
    const e = q(h);
    e.attachMod(ent(h, host)!, 'Foretell', A, 'graft');
    e.settle();
  }
  const comp = graftComposition(q(h), ent(h, host)!)!;
  assert.ok(comp, 'there is a composition');
  assert.ok(comp.head.startsWith('When I spawn or die'), `the cause: ${comp.head}`);
  assert.deepEqual(comp.parts.map(p => p.from), ['Ignis Sprite', 'Foretell'],
    'the host\'s own effect first, then each graft in mod order');
  const box = entityTextBox(q(h), ent(h, host)!);
  const line = box.lines.find(l => l.composed)!;
  assert.ok(line, 'the box shows it as one line, not two abilities');
  assert.equal(box.lines.filter(l => l.origin === 'graft').length, 1,
    'the graft is not ALSO listed separately');
  assert.ok(line.text.includes('Fireball') && line.text.includes('Glimpse'),
    `both effects are in the one ability: ${line.text}`);
});

test('a bounded ability that already fired this turn says so', () => {
  const h = new Harness(5707);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const se = spawn(h, A, 'Synaptic Energizer');            // [Switch1] afterCombat
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[se]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  pass(h); pass(h);                                        // the trigger resolves
  const box = entityTextBox(q(h), ent(h, se)!);
  const note = box.lines.find(l => l.origin === 'note');
  assert.ok(note, 'the spent budget is on the box');
  assert.ok(note!.text.includes('already used this turn'), note!.text);
  assert.equal(note!.active, false);
  finishBattle(h);
});

/* ── R62: what is switched off, and by whom ─────────────────────────── */

test('Suppression Field: the printed line is struck and names the culprit', () => {
  const h = new Harness(5708);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const sprite = spawn(h, D, 'Palewing');                  // 3/4 {Flying}, printed text
  giveResources(h, A, 'metal', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Suppression Field') });
  pick(h, { unit: sprite });
  pass(h); pass(h);
  const box = entityTextBox(q(h), ent(h, sprite)!);
  assert.deepEqual(box.suppressed, { attrs: true, abilities: true, by: ['Suppression Field'] });
  assert.equal(box.lines[0]!.active, false, 'the printed text is doing nothing');
  // the banner above the lines names the culprit once; the struck line does
  // not repeat it (that read as noise the first time it was on screen)
  assert.equal(box.lines[0]!.why, undefined);
  // the attribute is still PRINTED on the card — the box has to show both
  // facts, that it has Flying and that Flying is off
  const flying = box.attrs.find(a => a.attr === 'Flying')!;
  assert.equal(flying.origin, 'printed');
  assert.equal(flying.active, false);
  assert.equal(box.modified, true);
  finishBattle(h);
});

test('Monke: a continuous suppressor is named on every box it reaches', () => {
  const h = new Harness(5709);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  // the defender sits in the battle region already, and its own trigger stays
  // out of the priority dance this test is not about
  const theirs = spawn(h, D, 'Palewing');                  // 3/4 {Flying}
  giveResources(h, A, 'metal', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Monke') });
  pass(h); pass(h);
  const box = entityTextBox(q(h), ent(h, theirs)!);
  assert.deepEqual(box.suppressed.by, ['Monke']);
  assert.equal(box.attrs.find(a => a.attr === 'Flying')!.active, false);
  // and the projection itself is a line, so the box explains WHY
  const proj = box.lines.find(l => l.origin === 'static' && l.from === 'Monke');
  assert.ok(proj, 'the projection is spelled out');
  assert.ok(proj!.text.includes('loses all attributes and abilities'), proj!.text);
  finishBattle(h);
});

test('Transmogrifant: one projection line carries both halves of its sentence', () => {
  const h = new Harness(5710);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const other = spawn(h, A, 'Ephemeral Skywalker');
  spawn(h, A, 'Transmogrifant');
  const box = entityTextBox(q(h), ent(h, other)!);
  const proj = box.lines.find(l => l.origin === 'static')!;
  assert.equal(proj.from, 'Transmogrifant');
  assert.ok(proj.text.includes('+2/+2'), proj.text);
  assert.ok(proj.text.includes('loses all attributes and abilities'), proj.text);
});

test('an augment-donated static is blamed on the MOD, not on the unit wearing it', () => {
  const h = new Harness(5711);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  const other = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 4);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Transmogrifant'), hostId: host });
  const box = entityTextBox(q(h), ent(h, other)!);
  const proj = box.lines.find(l => l.origin === 'static')!;
  assert.equal(proj.from, 'Transmogrifant', 'the text is printed on the mod');
  assert.deepEqual(box.suppressed.by, ['Transmogrifant']);
});

/* ── R63: granted text ──────────────────────────────────────────────── */

test('granted text is its own line, attributed to the card that gave it', () => {
  const h = new Harness(5712);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Reforge the Dead') });
  pass(h); pass(h);
  const box = entityTextBox(q(h), ent(h, tok)!);
  const g = box.lines.find(l => l.origin === 'granted')!;
  assert.ok(g, 'the grant is on the box');
  assert.equal(g.text, 'When I die, create a Robot 3.');
  assert.equal(g.from, 'Reforge the Dead');
  assert.equal(box.modified, true);
  finishBattle(h);
  assert.equal(entityTextBox(q(h), ent(h, tok)!).lines.some(l => l.origin === 'granted'), false,
    'and it is gone at regroup, exactly like the rules say');
});

/* ── attributes shared by a column ──────────────────────────────────── */

test('a column-mate\'s attribute is on the box, flagged as shared', () => {
  const h = new Harness(5713);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const plain = spawn(h, A, 'Unit Token');                 // no attributes
  const flier = spawn(h, A, 'Ephemeral Skywalker');        // {Flying}
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[plain, flier]] });
  const lines = attrLines(q(h), ent(h, plain)!);
  const flying = lines.find(a => a.attr === 'Flying');
  assert.ok(flying, 'combat shares attributes vertically — the box shows it');
  assert.equal(flying!.origin, 'column');
  assert.equal(flying!.from, 'Ephemeral Skywalker');
  assert.equal(flying!.active, true);
  finishBattle(h);
  assert.equal(attrLines(q(h), ent(h, plain)!).some(a => a.attr === 'Flying'), false,
    'out of formation it is not shared any more');
});

/* ── the one entry point the UI uses ────────────────────────────────── */

test('textBoxFor takes the live box when there is an entity, the printed one otherwise', () => {
  const h = new Harness(5714);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const u = spawn(h, A, 'Ephemeral Skywalker');
  ent(h, u)!.counters = 3;
  assert.deepEqual(textBoxFor(q(h), 'Ephemeral Skywalker', u).stats?.power, 6);
  assert.deepEqual(textBoxFor(q(h), 'Ephemeral Skywalker').stats?.power, 3);
  assert.deepEqual(textBoxFor(q(h), 'Ephemeral Skywalker', 9999).stats?.power, 3,
    'a stale id falls back rather than throwing');
  assert.deepEqual(textBoxFor(null, 'Ephemeral Skywalker', u).stats?.power, 3);
});

test('state notes cover the things that are true of the ENTITY, not the card', () => {
  const h = new Harness(5715);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const tok = spawn(h, A, 'Unit Token');
  ent(h, tok)!.damage = 2;
  ent(h, tok)!.token = true;
  const box = entityTextBox(q(h), ent(h, tok)!);
  assert.ok(box.state.some(s => s.includes('token')), box.state.join(' | '));
  // damage lives on the stat line, not in the notes — it was printed twice
  assert.equal(box.state.some(s => s.includes('damage')), false);
  assert.equal(box.stats?.damage, 2);
});
