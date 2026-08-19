/* Playtest round 6 — the view logic behind three of Bena's UI asks. These are
 * the DOM-free halves (ui/inspect.ts), so they get real coverage instead of a
 * browser eyeball:
 *
 *  - a stack item must show the ABILITY that is resolving, not the whole card
 *    ("especially important for grafted abilities, which can get crazy");
 *  - an irreversible activation that will not stop to ask for a target must
 *    ask "are you sure?" first;
 *  - ending deployment with playable cached cards must warn, by name.
 *
 * Seeds 5000-5099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import { legalActions } from '../src/apply.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import {
  abilityOf, activationNeedsConfirm, partText, playableCachedNames,
  stackAbilityRows, switchClause,
} from '../ui/inspect.ts';
import { ent, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';
import type { Action, Seat } from '../src/types.ts';

/* ── the ability text behind a stack item ──────────────────────────────── */

test('partText resolves each effect-key shape to its own clause', () => {
  const spell = partText('spell:Fight');
  assert.equal(spell?.source, 'Fight');
  assert.match(spell!.text, /fight/i);

  const ab = partText('ability:Mohruung#0');
  assert.equal(ab?.source, 'Mohruung');
  assert.equal(ab!.text, getCard('Mohruung').abilities![0]!.label);

  const graft = partText('graft:Fight');
  assert.equal(graft?.graft, true, 'a graft part is tagged as one');
  assert.match(graft!.text, /^\[Switch/i, 'and starts at the [Switch] marker');
});

test('partText returns null rather than throwing on junk', () => {
  for (const k of ['', 'nonsense', 'spell:No Such Card', 'ability:Mohruung#99',
    'ability:Mohruung#notanumber', 'augment:Mohruung#0']) {
    assert.equal(partText(k), null, k);
  }
});

test('switchClause takes the transferred half, not the whole card', () => {
  const full = getCard('Fight').text;
  const clause = switchClause('Fight');
  assert.ok(clause.length > 0);
  assert.ok(clause.length <= full.length);
  assert.match(clause, /\[Switch/i);
});

test('a spell on the stack shows its own text', () => {
  const h = new Harness(5000, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const ally = spawn(h, D, 'Bubb');
  giveResources(h, D, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Fight') });
  pick(h, { unit: ally });
  pick(h, { unit: atk });

  const item = h.state.stack.find(i => i.card === 'Fight')!;
  const rows = stackAbilityRows(item);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.source, 'Fight');
  assert.match(rows[0]!.text, /fight/i);
});

test('a GRAFT stack lists every contributing card in resolution order', () => {
  // This is the case that motivated the ask. A graft-cause host plus grafted
  // [Switch] cards resolve as ONE composed ability (Manual p.33) — previewing
  // the host card alone tells you nothing about the grafted riders.
  const h = new Harness(5001, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Mohruung');             // graft cause: "when I become targeted"
  const e = new E(h.state);
  e.attachMod(ent(h, host)!, 'Fight', A, 'graft');  // Fight is graftable ([Switch1])
  e.settle();
  assert.equal(ent(h, host)!.mods.length, 1, 'the graft landed');

  // the composed item the engine builds for that trigger, previewed the way
  // the focus viewer previews it
  const composed = { id: 0, kind: 'triggered' as const, label: 'x', controller: A, region: 0,
    negated: false, parts: [{ effectKey: 'ability:Mohruung#0', targets: [] },
      { effectKey: 'graft:Fight', targets: [] }] };
  const rows = stackAbilityRows(composed);
  assert.deepEqual(rows.map(r => r.source), ['Mohruung', 'Fight']);
  assert.equal(rows[1]!.graft, true, 'the grafted rider is marked as grafted');
});

test('spent parts are dropped — they will do nothing', () => {
  const item = { id: 0, kind: 'triggered' as const, label: 'x', controller: 0 as Seat, region: 0,
    negated: false, parts: [
      { effectKey: 'ability:Mohruung#0', targets: [], spent: true },
      { effectKey: 'graft:Fight', targets: [] }] };
  assert.deepEqual(stackAbilityRows(item).map(r => r.source), ['Fight']);
});

test('every live card in the pool yields renderable stack text for its own keys', () => {
  // guard: previewStackHtml must never blow up on a real effect key
  let checked = 0;
  for (const name of DECK_LIST) {
    const c = getCard(name);
    if (c.spellEffect) { assert.doesNotThrow(() => partText(`spell:${name}`)); checked++; }
    if (c.graftEffect) { assert.doesNotThrow(() => partText(`graft:${name}`)); checked++; }
    (c.abilities ?? []).forEach((_, i) => {
      assert.doesNotThrow(() => partText(`ability:${name}#${i}`)); checked++;
    });
    (c.augmentText ?? []).forEach((_, i) => {
      assert.doesNotThrow(() => partText(`augment:${name}#${i}`)); checked++;
    });
  }
  assert.ok(checked > 500, `sanity: checked ${checked} effect keys`);
});

/* ── the "are you sure?" gate on irreversible activations ──────────────── */

test('a sacrifice-me ability with nothing to target asks first', () => {
  const h = new Harness(5002, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const obs = spawn(h, A, 'Prismatic Observer');   // "Sacrifice me: recall up to one target cached card"
  const act: Extract<Action, { type: 'activateAbility' }> =
    { type: 'activateAbility', seat: A, entityId: obs, abilityIndex: 0 };
  // empty cache → no candidates → the engine will NOT stop to ask, so the
  // click would sacrifice the unit outright. That is the trap; confirm it.
  assert.equal(activationNeedsConfirm(new E(h.state), ent(h, obs)!, act), true);
});

test('the same ability does NOT ask once there is something to target', () => {
  const h = new Harness(5003, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const obs = spawn(h, A, 'Prismatic Observer');
  new E(h.state).cacheCard(A, 'Shard Sprite', 'hand', {});
  const act: Extract<Action, { type: 'activateAbility' }> =
    { type: 'activateAbility', seat: A, entityId: obs, abilityIndex: 0 };
  assert.equal(activationNeedsConfirm(new E(h.state), ent(h, obs)!, act), false,
    'the target decision is itself the moment to notice — and R57 puts it before the cost');
});

test('a mana-only ability never asks', () => {
  const h = new Harness(5004, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  giveResources(h, A, 'earth', 4);
  const w = spawn(h, A, 'Enigmatic Warder');       // "[two]: change a target…" — mana only
  const act: Extract<Action, { type: 'activateAbility' }> =
    { type: 'activateAbility', seat: A, entityId: w, abilityIndex: 0, via: 'augment' };
  assert.equal(activationNeedsConfirm(new E(h.state), ent(h, w)!, act), false,
    'mana is not irreversible in the sense that matters — nothing is destroyed');
});

test('abilityOf resolves all three via shapes and survives a bad one', () => {
  const h = new Harness(5005, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const obs = spawn(h, A, 'Prismatic Observer');
  const u = ent(h, obs)!;
  assert.ok(abilityOf(h.state, u, { type: 'activateAbility', seat: A, entityId: obs, abilityIndex: 0 }));
  assert.equal(abilityOf(h.state, u,
    { type: 'activateAbility', seat: A, entityId: obs, abilityIndex: 99 }), undefined);
  assert.equal(abilityOf(h.state, u,
    { type: 'activateAbility', seat: A, entityId: obs, abilityIndex: 0, via: { mod: 9999 } }), undefined,
    'a mod that is not there resolves to nothing rather than throwing');
});

test('the confirm gate never fires on a unit with no activated abilities', () => {
  const h = new Harness(5006, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const b = spawn(h, A, 'Bubb');
  assert.equal(activationNeedsConfirm(new E(h.state), ent(h, b)!,
    { type: 'activateAbility', seat: A, entityId: b, abilityIndex: 0 }), false);
});

/* ── the end-of-deployment cache reminder ──────────────────────────────── */

test('playableCachedNames names exactly what is releasable now', () => {
  const h = new Harness(5007, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const e = new E(h.state);
  // one released by a glimpse (playable now), one merely sitting there
  e.cacheCard(A, 'Bubb', 'deck', { playable: true });
  e.cacheCard(A, 'Mohruung', 'hand', {});
  giveResources(h, A, 'earth', 8);

  const cache = new E(h.state).cache(A);
  const names = playableCachedNames(cache, legalActions(h.state, A));
  assert.deepEqual(names, ['Bubb'], 'only the permitted-and-timely one');
});

test('an empty cache warns about nothing', () => {
  const h = new Harness(5008, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  assert.deepEqual(playableCachedNames([], legalActions(h.state, A)), []);
});

test('a permitted card that misses its TIMING is not reported as playable', () => {
  // R42: "for free, as if it were in your hand" still obeys normal timing, so
  // a {Battle} card released into deployment must NOT show up in the reminder
  const h = new Harness(5009, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  new E(h.state).cacheCard(A, 'Fight', 'hand', { playable: true });   // Fight is {Battle}
  giveResources(h, A, 'earth', 8);
  const cache = new E(h.state).cache(A);
  assert.deepEqual(playableCachedNames(cache, legalActions(h.state, A)), [],
    'not this step — the reminder must not cry wolf');
});

test('duplicate offers of one entry collapse to a single name', () => {
  const legal: Action[] = [
    { type: 'playCached', seat: 0, index: 1 } as Action,
    { type: 'playCached', seat: 0, index: 1 } as Action,
    { type: 'playCached', seat: 0, index: 0 } as Action,
  ];
  assert.deepEqual(playableCachedNames([{ card: 'A' }, { card: 'B' }], legal), ['A', 'B'],
    'index order, deduped');
});
