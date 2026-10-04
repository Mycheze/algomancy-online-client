/* An ABILITY on the stack is not a card (owner, 2026-09-29): "a unit's
 * triggered effect looks the same as if that unit was on the stack itself".
 * ui/effectface.ts decides what shape each stack item is drawn in; this pins
 * every shape the owner approved off the mockups — the plain slice, the graft
 * strips hanging below it, the augment Franken-card, and the cards that stay
 * cards — plus the two engine facts it rests on, read off the source because
 * nothing else would notice them change.
 *
 * Seeds 34200-34299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import type { EffectPart, EntityId, Seat, StackItem } from '../../engine/src/types.ts';
import { spawn, withE } from '../../engine/test/util.ts';
import { rowFor } from '../cardindex.ts';
import { EFFECT_ART_TOP, effectFace, lostTargets, lostTargetsForRow } from '../effectface.ts';

const A: Seat = 0;

/** a stack item shaped the way engine.ts stackPendingTrigger / apply.ts
 * activateAbility build one: `card` is the text's card, `sourceId` the body */
function item(kind: StackItem['kind'], card: string | undefined, sourceId: EntityId | undefined,
  parts: EffectPart[] = [{ effectKey: 'x', targets: [] }]): StackItem {
  return {
    id: 900, kind, ...(card !== undefined ? { card } : {}), label: `${card ?? 'Someone'}: does a thing`,
    controller: A, region: 0, negated: false, parts,
    ...(sourceId !== undefined ? { sourceId } : {}),
  } as StackItem;
}

test('a unit\'s own trigger is a slice of its own scan, named "Chombot · trigger"', () => {
  const h = new Harness(34200, ['Ben', 'Rashi']);
  const chombot = spawn(h, A, 'Chombot');
  const f = effectFace(item('triggered', 'Chombot', chombot), h.state)!;
  assert.ok(f, 'a trigger is drawn as an effect, not as the card');
  assert.equal(f.name, 'Chombot');
  assert.equal(f.word, 'trigger');
  assert.deepEqual(f.art, { card: 'Chombot', to: 1 }, 'its own art, down to the bottom of its own rules box');
  assert.equal(f.text, undefined, 'nothing is spliced in — it is its own text');
  assert.equal(f.from, undefined);
  assert.deepEqual(f.grafts, []);
  assert.deepEqual(f.tint, ['metal', 'dark'], 'the name bar is the printed one: a metal/dark hybrid\'s two colours');
  assert.ok(EFFECT_ART_TOP > 0.11,
    'the cut is deeper than the printed bar (~5.5% of the scan, cleared at ~11%) — the owner '
    + 'chose the deeper cut off the mockups because the bar alone reads as no shorter at all');
});

test('an activated ability says "ability"', () => {
  const h = new Harness(34201, ['Ben', 'Rashi']);
  const u = spawn(h, A, 'Chombot');
  assert.equal(effectFace(item('activated', 'Chombot', u), h.state)!.word, 'ability');
});

test('a grafted trigger hangs one strip per live graft part, cut where the field cuts it', () => {
  const h = new Harness(34202, ['Ben', 'Rashi']);
  const chombot = spawn(h, A, 'Chombot');
  let parts = null as EffectPart[] | null;
  withE(h, e => {
    e.attachMod(e.entity(chombot)!, 'Fight', A, 'graft');
    e.attachMod(e.entity(chombot)!, 'Squish', A, 'graft');
    // the ENGINE composes the parts — this is the list a real trigger carries
    parts = e.composeParts(e.entity(chombot)!, 0, 'ability', 'Chombot');
  });
  assert.ok(parts, 'Chombot\'s attack trigger composes');
  assert.deepEqual(parts!.map(p => p.effectKey).filter(k => k.startsWith('graft:')),
    ['graft:Fight', 'graft:Squish'], 'both grafts ride Chombot\'s [Switch] trigger');
  const f = effectFace(item('triggered', 'Chombot', chombot, parts!), h.state)!;
  assert.deepEqual(f.grafts.map(g => g.card), ['Fight', 'Squish'], 'two grafts, two strips, in part order');
  assert.equal(f.grafts[0]!.peek, rowFor('Fight')!.modPeek!,
    'the same measured peek the field strip uses (ui/inspect.ts modStrips)');

  // a spent part does nothing when it resolves, so it does not hang a strip
  parts![1]!.spent = true;
  assert.deepEqual(effectFace(item('triggered', 'Chombot', chombot, parts!), h.state)!.grafts.map(g => g.card),
    ['Squish']);
});

test('an augment\'s ability is a Franken-card: the host\'s art, the mod\'s rules box, named after the host', () => {
  const h = new Harness(34203, ['Ben', 'Rashi']);
  const sky = spawn(h, A, 'Skybreaker');
  withE(h, e => { e.attachMod(e.entity(sky)!, 'Graxxlid', A, 'augment'); });
  // apply.ts activateAbility via an augment mod: card = the mod's, sourceId = the host
  const f = effectFace(item('activated', 'Graxxlid', sky), h.state)!;
  assert.equal(f.name, 'Skybreaker', 'named after the unit that was clicked (owner, 2026-09-29)');
  assert.deepEqual(f.art, { card: 'Skybreaker', to: rowFor('Skybreaker')!.textTop! },
    'the host\'s art, cut off where the host\'s own rules box starts');
  assert.deepEqual(f.text, { card: 'Graxxlid', from: rowFor('Graxxlid')!.textTop! },
    'the donor\'s rules box, from its type bar down');
  assert.equal(f.from, 'from Graxxlid, augmented under Skybreaker');
  assert.deepEqual(f.tint, rowFor('Skybreaker')!.factions.slice(0, 2),
    'the bar is the HOST\'s, since it wears the host\'s name');
  assert.deepEqual(f.grafts, []);
});

test('a source that has left play is drawn from the text\'s own card', () => {
  const h = new Harness(34204, ['Ben', 'Rashi']);
  // "when I die": sourceId names an entity that is gone
  const f = effectFace(item('triggered', 'Graxxlid', 99999), h.state)!;
  assert.deepEqual({ name: f.name, art: f.art, text: f.text }, { name: 'Graxxlid', art: { card: 'Graxxlid', to: 1 }, text: undefined });
});

test('an ability with no card at all is a name line alone', () => {
  const h = new Harness(34205, ['Ben', 'Rashi']);
  const f = effectFace(item('triggered', undefined, undefined), h.state)!;
  assert.equal(f.art, undefined);
  assert.equal(f.name, 'Someone: does a thing', 'the label stands in for the name');
});

test('only abilities change shape — everything that was played stays a card', () => {
  const h = new Harness(34206, ['Ben', 'Rashi']);
  for (const kind of ['unit', 'spell', 'spellUnit', 'spellToken', 'virus', 'ambush'] as const) {
    assert.equal(effectFace(item(kind, 'Fight', undefined), h.state), null, `${kind} stays a card`);
  }
  const copy = { ...item('spell', 'Fight', undefined), copy: true } as StackItem;
  assert.equal(effectFace(copy, h.state), null,
    'a COPY stays a card too — the owner chose "abilities only" over "abilities + copies"');
});

test('the engine facts this rests on: text card in `card`, body in `sourceId`, grafts keyed by name', () => {
  const engine = readFileSync(new URL('../../engine/src/engine.ts', import.meta.url), 'utf8');
  const apply = readFileSync(new URL('../../engine/src/apply.ts', import.meta.url), 'utf8');
  assert.match(engine, /kind: 'triggered', card: next\.sourceCard/,
    'a trigger\'s card is the PendingTrigger\'s sourceCard…');
  assert.match(engine, /collectTriggersFrom\(u, mod\.card, 'augment'/,
    '…which, for an augment mod\'s text, is the MOD\'s card while the host is the source');
  assert.match(apply, /kind: 'activated', card: srcCard/,
    'an activation\'s card is `viaCard ?? faceCard` — the mod\'s, when used through one');
  assert.match(apply, /sourceId: u\.id/, 'and its source is the unit that was clicked');
  assert.match(engine, /effectKey: `graft:\$\{mod\.card\}`/, 'a graft part names its card in its key');
});

test('TARGET MISSING is the engine\'s own R5 test, not a guess (owner, 2026-09-30)', () => {
  const h = new Harness(34210, ['Ben', 'Rashi']);
  const a = spawn(h, A, 'Bubb');
  const b = spawn(h, A, 'Chombot');
  const it = item('spell', 'Fight', undefined, [{ effectKey: 'x', targets: [{ unit: a }, { unit: b }] }]);
  assert.deepEqual(lostTargets(it, h.state), [], 'both still in play: nothing is missing');
  withE(h, e => { e.destroy(e.entity(b)!, 'dies'); });
  assert.deepEqual(lostTargets(it, h.state), [{ unit: b }], 'the one that died, and only it');
  // a spent part is not going to hit anything anyway, and a negated item is
  // off the stack — neither is "missing a target"
  const spent = item('spell', 'Fight', undefined, [{ effectKey: 'x', targets: [{ unit: b }], spent: true }]);
  assert.deepEqual(lostTargets(spent, h.state), []);
  assert.deepEqual(lostTargets({ ...it, negated: true }, h.state), []);
  // a target named twice is one target, missing once
  const twice = item('spell', 'Fight', undefined,
    [{ effectKey: 'x', targets: [{ unit: b }] }, { effectKey: 'y', targets: [{ unit: b }] }]);
  assert.equal(lostTargets(twice, h.state).length, 1);
  // the player is always there (engine targetStillLegal)
  const face = item('spell', 'Fight', undefined, [{ effectKey: 'x', targets: [{ player: 1 as Seat }] }]);
  assert.deepEqual(lostTargets(face, h.state), []);
});

test('TARGET MISSING is judged per row: a waiting row and a fizzled beat lose targets, a resolving row and a resolved beat do not (#189)', () => {
  const h = new Harness(34211, ['Ben', 'Rashi']);
  const b = spawn(h, A, 'Chombot');
  const it = item('spell', 'Fight', undefined, [{ effectKey: 'x', targets: [{ unit: b }] }]);
  withE(h, e => { e.destroy(e.entity(b)!, 'dies'); });
  const row = (o: { resolving?: boolean; flashing?: boolean; fizzled?: boolean }) =>
    ({ item: it, resolving: false, flashing: false, fizzled: false, ...o });
  assert.deepEqual(lostTargetsForRow(row({}), h.state), [{ unit: b }], 'still waiting: its target has gone');
  assert.deepEqual(lostTargetsForRow(row({ resolving: true }), h.state), [],
    'resolving: it removed the target itself, and nobody else can act during the suspension');
  assert.deepEqual(lostTargetsForRow(row({ flashing: true }), h.state), [], 'a beat that resolved hit what it hit');
  assert.deepEqual(lostTargetsForRow(row({ flashing: true, fizzled: true }), h.state), [{ unit: b }],
    'a fizzle did nothing because its target had gone first');
});
