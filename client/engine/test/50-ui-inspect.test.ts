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
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { ALL_ELEMENTS, legalActions } from '../src/apply.ts';
import { createsOf, DECK_LIST } from '../src/cards/registry.ts';
import {
  abilityOf, activatableUnits, activationBadge, activationNeedsConfirm, cacheBlockReason,
  castProbe, costReceipt,
  dismissSeenCard, dismissSeenHand, erasedPileView, waitingNote, watchCast,
  findCardName, growCardLedger, linkCardNames, namesInEvents, namesInState,
  onlyKnownNames, optionPingId, partitionOptions, partText, playableCachedNames,
  seenHandView, shouldAutoYield, stackAbilityRows, stackItemModes, stackItemX, stackXMark, switchClause,
  prismiteClickPlan, resourceMenuElements,
  tokensCreatedBy, tokensNamedIn, transformFaces,
  unitClickOptions,
} from '../../ui/inspect.ts';
import type { CastWatch } from '../../ui/inspect.ts';
import { viewFor } from '../../server/view.ts';
import { ent, give, giveResources, handIdx, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';
import type { Action, CardName, GameState, Seat, StackItem } from '../src/types.ts';

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

/* ── WHY a permitted cache entry will not go (playtest report #78) ──────
 *
 * Room EGCW, actionIndex 82: the cache panel said "not this step" for a
 * {Deployment} unit, during deployment, that was permitted by a live glimpse
 * and short only of MANA. Nothing illegal was offered and nothing legal was
 * refused — the enforcement was right and the LABEL was wrong, because both
 * render sites blamed the whole permitted/playable gap on timing without ever
 * asking whether the timing already matched.
 *
 * cacheBlockReason asks pushCachedPlays' questions in pushCachedPlays' order,
 * so the tests below pin each answer — including the one the bug destroyed AND
 * the one it must not now destroy in the other direction.
 */

test('a permitted cached card blocked only by MANA does not blame the step', () => {
  // the EGCW shape: Gatekeeper of Souls (l/4, {Deployment}), glimpse-cached
  // this turn, in the deployment phase, with 2 open mana against its 4
  const h = new Harness(5041, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  new E(h.state).cacheCard(A, 'Gatekeeper of Souls', 'hand', { playable: true });
  h.state.players[A]!.resources = [];
  giveResources(h, A, 'light', 2);

  const e = new E(h.state);
  assert.equal(e.cachePermission(A, 0), 'glimpse', 'the glimpse is live this turn');
  assert.equal(e.cachedTiming(A, 0), 'deploy', 'and it is a deployment card');
  assert.equal(e.openMana(A), 2);
  assert.equal(e.manaToPlay(A, 'Gatekeeper of Souls'), 4);
  const legal = legalActions(h.state, A);
  assert.equal(legal.some(a => a.type === 'playCached'), false, 'rightly not offered');

  assert.equal(cacheBlockReason(e, A, 0, legal), 'mana',
    'the step was right — only the mana was missing');

  // and the moment the mana is there, nothing is blocking it at all
  giveResources(h, A, 'light', 2);
  assert.equal(cacheBlockReason(new E(h.state), A, 0, legalActions(h.state, A)), 'none');
});

test('and a battle card cached during deployment DOES blame the step', () => {
  // widening a label must not widen it past the truth: when the step really
  // IS the problem, the panel must still say so
  const h = new Harness(5042, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  new E(h.state).cacheCard(A, 'Fight', 'hand', { playable: true });   // Fight is {Battle}
  giveResources(h, A, 'earth', 8);

  const e = new E(h.state);
  assert.equal(e.cachePermission(A, 0), 'glimpse');
  assert.equal(e.canPayManaOnly(A, 'Fight'), true, 'affordable — so mana cannot be the excuse');
  assert.equal(cacheBlockReason(e, A, 0, legalActions(h.state, A)), 'timing');
});

test('a cache entry with no permission at all blames permission, not the step', () => {
  const h = new Harness(5043, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  new E(h.state).cacheCard(A, 'Gatekeeper of Souls', 'hand', {});   // no glimpse, no prophecy
  giveResources(h, A, 'light', 8);

  const e = new E(h.state);
  assert.equal(e.cachePermission(A, 0), null);
  assert.equal(cacheBlockReason(e, A, 0, legalActions(h.state, A)), 'no-permission',
    'being cached is not permission (R41) — and that is not a timing problem');
});

test('a permitted, timely, affordable cached spell with nothing to aim at blames the target', () => {
  // Overbloom is g/2 {Deployment} "target unit gains +7/+7"; on an empty
  // board there is no legal target, and THAT is why it will not go
  const h = new Harness(5044, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  new E(h.state).cacheCard(A, 'Overbloom', 'hand', { playable: true });
  giveResources(h, A, 'wood', 8);

  const e = new E(h.state);
  assert.equal(e.cachePermission(A, 0), 'glimpse');
  assert.equal(e.cachedTiming(A, 0), 'deploy');
  assert.equal(e.canPayManaOnly(A, 'Overbloom'), true);
  assert.equal(Object.values(h.state.entities).filter(x => x.kind === 'unit' && !x.absent).length, 0,
    'no units anywhere — nothing to buff');
  assert.equal(cacheBlockReason(e, A, 0, legalActions(h.state, A)), 'no-target');
});

// ── deployment reveal grouping ────────────────────────────────────────
//
// MOVED. `groupReveal` grouped the reveal by scanning message PROSE for card
// names, and BL-21 replaced it with `ui/reveal.ts`, which reads the events'
// structure instead. Round 8's complaint ("single cards create 5, full sized
// entries") is still live and its fixture moved WITH the tests, to
// `217-reveal-rows.test.ts` §2 — a report does not stop mattering because the
// code that answered it was rewritten.

/* ── playtest round 13 (UZRG/ZQPC) ──────────────────────────────────────
 *
 * Every bug below existed because it was written entirely inside ui/main.ts,
 * the DOM half nothing can test. The fix in each case is a pure function here
 * and painting there. Seeds 5900-5999.
 */

/* ── which units can ACT ────────────────────────────────────────────────── */

/** deployment, one seat, one unit with a mana-only activated ability */
function evokerBoard(seed: number): { h: Harness; seat: Seat; id: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  const id = spawn(h, seat, 'Omniwield Evoker');     // "[three]: put a +1/+1 counter on me"
  return { h, seat, id };
}

test('a unit whose activated ability is payable is in the activatable set', () => {
  const { h, seat, id } = evokerBoard(5900);
  giveResources(h, seat, 'metal', 3);
  assert.ok(activatableUnits(legalActions(h.state, seat)).has(id),
    'the affordance is a read of legalActions, so it fires exactly when the engine would');
});

test('…and drops out the moment the cost is unpayable', () => {
  const { h, seat, id } = evokerBoard(5901);
  // no resources at all: the ability costs [three] and cannot be activated
  assert.equal(activatableUnits(legalActions(h.state, seat)).has(id), false);
  giveResources(h, seat, 'metal', 2);                // still one short
  assert.equal(activatableUnits(legalActions(h.state, seat)).has(id), false);
  giveResources(h, seat, 'metal', 1);
  assert.ok(activatableUnits(legalActions(h.state, seat)).has(id), 'the third mana turns it on');
});

test('…and drops out when R62 switches its abilities off', () => {
  // THE test: highlight and legalActions can never diverge, because the
  // highlight does not know what suppression is — it only knows the list.
  const { h, seat, id } = evokerBoard(5902);
  giveResources(h, seat, 'metal', 3);
  assert.ok(activatableUnits(legalActions(h.state, seat)).has(id));
  h.state.entities[id]!.suppressed = { abilities: 'Suppression Field' };
  assert.equal(activatableUnits(legalActions(h.state, seat)).has(id), false,
    'suppressed abilities are not offered, so they must not glow');
});

test('the badge names the one ability, and counts several', () => {
  const { h, seat, id } = evokerBoard(5903);
  const u = h.state.entities[id]!;
  assert.equal(activationBadge(h.state, u, legalActions(h.state, seat)), null,
    'nothing payable, nothing to say');
  giveResources(h, seat, 'metal', 3);
  const one = activationBadge(h.state, u, legalActions(h.state, seat));
  assert.equal(one, getCard('Omniwield Evoker').abilities![0]!.label);
  // two legal options collapse to a count — a card is 78px wide
  const legal = legalActions(h.state, seat);
  const extra = legal.find((a): a is Extract<Action, { type: 'activateAbility' }> =>
    a.type === 'activateAbility' && a.entityId === id)!;
  assert.equal(activationBadge(h.state, u, [extra, { ...extra, abilityIndex: 1 }]), '2 abilities');
});

test('a unit with BOTH a formation role and an ability offers both', () => {
  // the second half of the UZRG report: main.ts tested the formation branch
  // first, so during your own declare step the ability branch was unreachable
  // and a {Battle}-timed ability had no input path at all.
  const { h, seat, id } = evokerBoard(5904);
  giveResources(h, seat, 'metal', 3);
  const u = h.state.entities[id]!;
  const legal = legalActions(h.state, seat);
  const both = unitClickOptions(h.state, u, legal,
    { step: 'attack', placed: false, carrying: false });
  assert.equal(both.length, 2, 'a menu, not a silent choice');
  assert.equal(both[0]!.kind, 'formation');
  assert.equal(both[1]!.kind, 'activate');
  assert.ok(both[1]!.action, 'the activate option carries the action to fire');

  // one option is not a menu — it just happens
  assert.deepEqual(unitClickOptions(h.state, u, legal, null).map(o => o.kind), ['activate']);
  assert.deepEqual(unitClickOptions(h.state, u, [],
    { step: 'block', placed: true, carrying: false }).map(o => o.kind), ['formation']);
  // and a unit with neither takes no click at all
  assert.deepEqual(unitClickOptions(h.state, u, [], null), []);
});

test('the formation option says which job it is offering', () => {
  const { h, seat, id } = evokerBoard(5905);
  const u = h.state.entities[id]!;
  const label = (f: Parameters<typeof unitClickOptions>[3]): string =>
    unitClickOptions(h.state, u, [], f)[0]!.label;
  assert.match(label({ step: 'attack', placed: false, carrying: false }), /attack column/i);
  assert.match(label({ step: 'block', placed: false, carrying: false }), /block/i);
  assert.match(label({ step: 'attack', placed: true, carrying: false }), /take out/i);
  assert.match(label({ step: 'attack', placed: false, carrying: true }), /put back down/i);
  assert.equal(seat === 0 || seat === 1, true);
});

/* ── the tokens a card creates ──────────────────────────────────────────── */

test('the token scan matches the PLURAL the printed text actually uses', () => {
  // the pinned failure: `\bWraith\b` never matched "Create three Wraiths",
  // which is what five cards in the pool print.
  assert.deepEqual(tokensNamedIn('Create three Wraiths and gain 2 Rot.'), ['Wraith']);
  assert.deepEqual(tokensNamedIn('Create two Wisps.'), ['Wisp']);
  assert.deepEqual(tokensNamedIn('Create a Wraith.'), ['Wraith']);
  assert.deepEqual(tokensNamedIn('nothing is created here'), []);
});

test('Primordial Coalescence shows the Wraiths it creates', () => {
  assert.ok(tokensCreatedBy('Primordial Coalescence').includes('Wraith'),
    'the card the report was filed about');
  for (const n of ['Legion of the Depths', 'Aberrant Populace', 'Spectrogenesis']) {
    assert.ok(tokensCreatedBy(n).length > 0, `${n} names a token and must show it`);
  }
});

test('a DECLARED creates list is always included, whatever the text says', () => {
  // R69: the declaration is the rules answer and the scan is only a safety
  // net, so the declared list can never be dropped. (Vacuous while the
  // per-card `creates` declarations are still being written — it becomes real
  // as they land, which is exactly what it is here for.)
  let checked = 0;
  for (const name of DECK_LIST) {
    const declared = createsOf(name);
    if (!declared.length) continue;
    checked++;
    const shown = tokensCreatedBy(name);
    for (const t of declared) assert.ok(shown.includes(t), `${name} declares ${t}`);
    assert.deepEqual(shown.slice(0, declared.length), declared, 'declared first');
  }
  // Not an assertion about the pool — the sweep is vacuous until the per-card
  // declarations land, and that is fine. What must never be vacuous is the
  // CONTRACT it is sweeping for, which the next test pins outright.
  assert.equal(typeof checked, 'number');
});

test('a declaration is honoured even when the printed text names nothing', () => {
  // The sweep above goes live only when someone writes a `creates` list. This
  // proves the path it sweeps is real TODAY, by writing one: Fight is in
  // DECK_LIST, has a spell effect, and its printed text scans to no token at
  // all — so if a declared token shows up, it can only have come from the
  // declaration. (A wrong declaration is not this test's job: `createsOf` is
  // the rules answer, and the engine's own conformance pass is what checks it
  // against what the effects really spawn.)
  const eff = getCard('Fight').spellEffect!;
  assert.deepEqual(tokensNamedIn(getCard('Fight').text), [], 'nothing to scan');
  assert.deepEqual(tokensCreatedBy('Fight'), [], 'and nothing declared yet');
  const restore = eff.creates;
  try {
    eff.creates = ['Wraith'];
    assert.deepEqual(tokensCreatedBy('Fight'), ['Wraith'],
      'the declared list alone puts a token on the details page');
    // …and it still leads when the scan finds something too
    eff.creates = ['Wisp'];
    assert.deepEqual(tokensCreatedBy('Primordial Coalescence'), ['Wraith'],
      'a declaration on one card never leaks onto another');
  } finally {
    if (restore === undefined) delete eff.creates; else eff.creates = restore;
  }
  assert.deepEqual(tokensCreatedBy('Fight'), [], 'and the pool is left as it was found');
});

test('a live entity is read from its CURRENT box, not the printed string', () => {
  const h = new Harness(5906);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  const id = spawn(h, seat, 'Spectrogenesis');
  const u = h.state.entities[id];
  if (!u) return;                       // not a unit card — the printed path is enough
  const live = tokensCreatedBy('Spectrogenesis', { e: new E(h.state), unit: u });
  assert.deepEqual(live, tokensCreatedBy('Spectrogenesis'),
    'an unmodified unit reads the same as its printed card');
});

test('an unknown card yields no tokens rather than throwing', () => {
  assert.deepEqual(tokensCreatedBy('No Such Card At All'), []);
});

/* ── what a card TRANSFORMS INTO (playtest ledger #24) ──────────────────── */

test('the inspector says what Scholar of the Void transforms into, before the hand is discarded', () => {
  // The report, verbatim (ZQPC, 2026-08-20): "Scholar of the Void doesn't say
  // what the Beyond card it can transform into does". The complaint is about
  // the INSPECTOR, not the transform: the card asks you to discard your entire
  // hand for a face you have never been allowed to read.
  assert.deepEqual(transformFaces('Scholar of the Void'), ['Beyond, Codex Incarnate']);
  // …and the name is enough for the row builder to say what it DOES, which is
  // the actual ask. (ui/main.ts renders it with tokenRowHtml, which prints
  // stats, type line and rules text off exactly this name.)
  const back = getCard('Beyond, Codex Incarnate');
  assert.deepEqual([back.power, back.toughness], [8, 3]);
  assert.match(back.text, /inverted/i, 'the face has real rules text to show');
  assert.equal(back.type, 'Book Token Unit');
  // the 99% case: no row at all
  assert.deepEqual(transformFaces('Good Whale'), []);
  assert.deepEqual(transformFaces('No Such Card At All'), []);
});

test('a card that has already transformed shows no row, and a host wearing the mod shows none either', () => {
  // Both answers come from reading the ENTITY's own card name, and both agree
  // with the engine: Beyond has no back face of its own, and "transform me"
  // donated to a host rebinds to a host that has its own reverse side (which
  // batch-dark-c.ts refuses). The view must not offer an option the unit does
  // not have.
  const h = new Harness(5907);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  const sv = spawn(h, seat, 'Scholar of the Void');
  const unit = h.state.entities[sv]!;
  assert.deepEqual(transformFaces('Scholar of the Void', { e: new E(h.state), unit }),
    ['Beyond, Codex Incarnate'], 'live, still a Scholar: the row is there');
  unit.card = 'Beyond, Codex Incarnate';               // as the transform leaves it
  assert.deepEqual(transformFaces('Scholar of the Void', { e: new E(h.state), unit }), [],
    'spent: nothing left to turn over');

  const host = h.state.entities[spawn(h, seat, 'Good Whale')]!;
  assert.deepEqual(transformFaces('Scholar of the Void', { e: new E(h.state), unit: host }), [],
    'the host has its own back face, so the donated text offers nothing');
});

test('the back face is NOT listed as a token Scholar of the Void creates', () => {
  // Beyond is printed "Book Token Unit" and is a registry card outside
  // DECK_LIST, which is exactly the shape TOKEN_NAMES sweeps up — and Scholar's
  // printed text names it in a perfectly scannable sentence. Left alone, the
  // details page would claim Scholar CREATES a Beyond. It becomes one.
  assert.deepEqual(tokensCreatedBy('Scholar of the Void'), [],
    'transforming into something is not creating it');
  assert.deepEqual(tokensNamedIn(getCard('Scholar of the Void').text), [],
    'and the scan itself must not see it, or every reader inherits the claim');
});

/* ── the erased pile, as it is SHOWN (R69) ──────────────────────────────── */

test('the erased viewer lists the real cards that are out of the game', () => {
  const v = erasedPileView(['Rotling', 'Good Whale', 'Luminous Arc']);
  assert.deepEqual(v.cards, ['Rotling', 'Good Whale', 'Luminous Arc'],
    'in the order they were erased');
  assert.equal(v.tokensOmitted, 0);
  assert.equal(v.note, '', 'nothing hidden, nothing to confess');
  assert.equal(v.countLabel, '3');
});

test('R69: dead tokens are omitted — that is the whole point', () => {
  // every dying token now passes through a bin and is erased by the sweep, so
  // a token-heavy board buries the real cards the viewer exists to show.
  const pile = ['Wisp', 'Rotling', 'Wraith', 'Wisp', 'Fireball', 'Unit Token'];
  const v = erasedPileView(pile);
  assert.deepEqual(v.cards, ['Rotling'], 'only the real card is listed');
  for (const n of ['Wisp', 'Wraith', 'Fireball', 'Unit Token']) {
    assert.ok(!v.cards.includes(n), `${n} is a printed token and is not listed`);
  }
});

test('every entry is accounted for: what is hidden is counted and named', () => {
  const pile = ['Wisp', 'Rotling', 'Wraith', 'Wisp', 'Fireball'];
  const v = erasedPileView(pile);
  assert.equal(v.cards.length + v.tokensOmitted, pile.length, 'nothing vanishes silently');
  assert.equal(v.tokensOmitted, 4);
  assert.equal(v.note, '+4 tokens');
  assert.equal(v.countLabel, '1 +4 tokens', 'the header and the menu label read the same');
  // and the plural is not a lie
  assert.equal(erasedPileView(['Wisp']).note, '+1 token');
});

test('a token identity comes from the registry type line, not a name list', () => {
  // the invariant the filter rests on: every card DECK_LIST omits as a token
  // is hidden, and every deck card is shown. No hardcoded names anywhere.
  for (const n of allCardNames()) {
    const isDeck = DECK_LIST.includes(n);
    const shown = erasedPileView([n]).cards.length === 1;
    if (isDeck) assert.ok(shown, `${n} is a deck card and must be listed`);
    if (/Token/.test(getCard(n).type)) assert.ok(!shown, `${n} is printed as a token and is hidden`);
  }
  // Resource faces are outside DECK_LIST but are NOT tokens — the reason the
  // filter asks the type line and not "is it in DECK_LIST"
  assert.deepEqual(erasedPileView(['Fire Resource']).cards, ['Fire Resource']);
});

test('a token that is ALSO a deck card is SHOWN — the pile records names, not entities', () => {
  // Echo of Despair and Hooba-God spawn token copies of themselves. Once in
  // the pile, the copy and the real card are the same string, so hiding the
  // entry could hide a real card that is genuinely out of the game. Showing
  // it costs at most two rows of noise; hiding it costs the answer.
  for (const n of ['Echo of Despair', 'Hooba-God']) {
    assert.ok(DECK_LIST.includes(n), `${n} is a real deck card as well as a token`);
    const v = erasedPileView([n]);
    assert.deepEqual(v.cards, [n], `${n} is listed`);
    assert.equal(v.tokensOmitted, 0);
  }
});

test('an empty pile — and a pile with nothing but tokens', () => {
  for (const empty of [undefined, [] as string[]]) {
    const v = erasedPileView(empty);
    assert.deepEqual(v.cards, []);
    assert.equal(v.tokensOmitted, 0);
    assert.equal(v.note, '');
    assert.equal(v.countLabel, '0');
  }
  const tokensOnly = erasedPileView(['Wisp', 'Wisp', 'Wraith']);
  assert.deepEqual(tokensOnly.cards, [], 'nothing real to list');
  assert.equal(tokensOnly.countLabel, '0 +3 tokens', 'and it still says so');
});

test('an unknown name is not a token — it is shown rather than swallowed', () => {
  assert.deepEqual(erasedPileView(['No Such Card At All']).cards, ['No Such Card At All']);
});

/* ── X on the stack ─────────────────────────────────────────────────────── */

/** a bare item; the X readers never touch the rest of a StackItem */
const xItem = (over: Partial<StackItem>): StackItem => ({
  id: 1, kind: 'spell', label: 'thing', controller: 0, region: 0,
  negated: false, parts: [], ...over,
});

test('stackItemX keeps the two X\'s apart', () => {
  const it = xItem({
    card: 'Fight', x: 3,
    parts: [
      { effectKey: 'spell:Fight', targets: [] },
      { effectKey: 'graft:Fight', targets: [], costPaid: { x: 7, erased: ['a', 'b'] } },
    ],
  });
  const rows = stackItemX(it);
  assert.equal(rows.length, 2);
  assert.deepEqual({ kind: rows[0]!.kind, x: rows[0]!.x }, { kind: 'cast', x: 3 });
  // R64: a grafted rider's variable cost is its OWN X and is attributed to the
  // part that paid it — one number could not say both things
  assert.equal(rows[1]!.kind, 'cost');
  assert.equal(rows[1]!.x, 7);
  assert.equal(rows[1]!.part, 1);
  assert.equal(rows[1]!.receipt, 'erased 2 cards');
});

test('a declared mode is readable off the stack, so a responder is not blind', () => {
  // R57 / report #81 (EGCW). Choosing the half at cast time is only half the
  // fix — if the opponent cannot READ it while the item sits there, they are
  // still paying for a response without knowing what they are responding to,
  // which is the harm the report described.
  const it = xItem({ card: 'Burgeon', parts: [{ effectKey: 'spell:Burgeon', targets: [], mode: 'defense' }] });
  const rows = stackItemModes(it);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.key, 'stat');
  assert.equal(rows[0]!.part, 0);
  assert.equal(rows[0]!.label, 'defense', 'with no engine to ask, the raw value still tells the truth');
});

test('a part with no mode, and a spent one, contribute no mode row', () => {
  assert.deepEqual(stackItemModes(xItem({ parts: [{ effectKey: 'spell:Fight', targets: [] }] })), [],
    'a non-modal effect has nothing to declare');
  assert.deepEqual(stackItemModes(xItem({
    card: 'Burgeon',
    parts: [{ effectKey: 'spell:Burgeon', targets: [], mode: 'power', spent: true }],
  })), [], 'a spent part resolves to nothing, so its half is not news');
});

test('a spent part\'s X is not shown — it resolves to nothing', () => {
  const it = xItem({ parts: [{ effectKey: 'spell:Fight', targets: [], spent: true, costPaid: { x: 5 } }] });
  assert.deepEqual(stackItemX(it), []);
  assert.equal(stackXMark(it), '');
});

test('the stack card\'s X tag folds duplicates and stays out of the way', () => {
  assert.equal(stackXMark(xItem({})), '', 'no X, no tag');
  assert.equal(stackXMark(xItem({ x: 4 })), 'X=4');
  assert.equal(stackXMark(xItem({
    x: 4, parts: [{ effectKey: 'spell:Fight', targets: [], costPaid: { x: 4 } }],
  })), 'X=4', 'the same number said twice is one tag');
  assert.equal(stackXMark(xItem({
    x: 4, parts: [{ effectKey: 'spell:Fight', targets: [], costPaid: { x: 9 } }],
  })), 'X=4/9');
});

/* R80 — the THIRD X: a triggered ability's amount comes off its event.
 * Playtest VEAV: "Awoken Tomb's trigger, while on the stack, doesn't say what
 * X is equal to." */

const dmgEvent = (n: number, total = n) => ({
  type: 'damage' as const, msg: `Channel Through deals ${n} to Awoken Tomb.`,
  data: { unit: 9, n, total, source: 'Channel Through', controller: 0 },
});

test("a triggered ability's X is the amount its event carried", () => {
  const it = xItem({
    kind: 'triggered', card: 'Awoken Tomb',
    label: 'create an X/X unit (X = the damage dealt)',
    event: dmgEvent(2),
  });
  const rows = stackItemX(it);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.kind, 'event');
  assert.equal(rows[0]!.x, 2);
  assert.match(rows[0]!.from ?? '', /deals 2 to Awoken Tomb/);
  assert.equal(stackXMark(it), 'X=2', 'and the stack card wears it');
});

test("an event X names the whole batch too, when the batch dealt more", () => {
  const it = xItem({
    kind: 'triggered', card: 'Awoken Tomb',
    label: 'create an X/X unit (X = the damage dealt)',
    event: dmgEvent(2, 6),
  });
  assert.match(stackItemX(it)[0]!.from ?? '', /6 in all from that effect/);
});

test('a trigger whose amount is not variable wears no X badge', () => {
  // most damage-fired triggers do not scale with the damage; stamping every
  // one of them with a number would be noise, not information
  const it = xItem({
    kind: 'triggered', card: 'Stoneborn Progenitor',
    label: 'create a 2/2 unit (one of your units survived damage)',
    event: dmgEvent(3),
  });
  assert.deepEqual(stackItemX(it), []);
  assert.equal(stackXMark(it), '');
});

test('a SPELL is never given an event X — only a trigger has an event', () => {
  const it = xItem({ kind: 'spell', card: 'Fireball', label: 'X = the damage dealt', event: dmgEvent(4) });
  assert.deepEqual(stackItemX(it), []);
});

test('the cost receipt says what was actually spent', () => {
  assert.equal(costReceipt(undefined), undefined);
  assert.equal(costReceipt({}), undefined);
  assert.equal(costReceipt({ erased: ['a'] }), 'erased 1 card');
  assert.equal(costReceipt({ erased: ['a', 'b', 'c'] }), 'erased 3 cards');
  assert.equal(costReceipt({ life: 9 }), 'paid 9 life');
  assert.equal(costReceipt({ counters: [{ unit: 1, card: 'x', n: 2 }, { unit: 2, card: 'y', n: 1 }] }),
    'removed 3 counters');
});

test('ability rows carry the X of the clause that paid for it', () => {
  const rows = stackAbilityRows(xItem({
    parts: [
      { effectKey: 'spell:Fight', targets: [] },
      { effectKey: 'graft:Fight', targets: [], costPaid: { x: 2, erased: ['a', 'b'] } },
    ],
  }));
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.x, undefined);
  assert.equal(rows[0]!.part, 0);
  assert.equal(rows[1]!.x, 2);
  assert.equal(rows[1]!.part, 1, 'so the DOM can tell which clause it belongs to');
});

test('Necromantic Rebuke carries its paid X onto the real stack', () => {
  // the UZRG game, end to end: a 10-card variable cost that the client threw
  // away. Two erasures here, but it is the same code path.
  const h = new Harness(5907);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'dark', 2);
  giveResources(h, D, 'fire', 2);
  give(h, A, 'Necromantic Rebuke');
  give(h, D, 'Flame of History');
  h.state.players[A]!.bin.push('Unit Token', 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk, victim]] });
  for (let g = 0; g < 40 && h.state.decision; g++) {
    const d = h.state.decision;
    h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
  }
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Flame of History') });
  pick(h, { unit: victim });
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Necromantic Rebuke') });
  pick(h, { erase: 'Unit Token' });
  pick(h, { erase: 'Unit Token' });                 // bin empty → X closes at 2

  // the target step: the option that names the Flame is a REF, and the only
  // other option is the decline. That is the bar the player lost their bin to.
  const dec = h.state.decision!;
  const split = partitionOptions(dec.options);
  assert.equal(split.refs.length, 1, 'a ref option — and it used to draw no button at all');
  assert.equal(split.decline.length, 1, 'the decline is separated out, to be drawn last');
  assert.equal(split.plain.length + split.cards.length, 0);
  h.do({ type: 'decide', seat: dec.seat, choice: split.refs[0]! });

  const item = h.state.stack.find(i => i.card === 'Necromantic Rebuke')!;
  assert.ok(item, 'it reached the stack');
  const rows = stackItemX(item);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { kind: rows[0]!.kind, x: rows[0]!.x, receipt: rows[0]!.receipt },
    { kind: 'cost', x: 2, receipt: 'erased 2 cards' },
    'X — and the receipt R65 makes public — survive all the way to the board',
  );
  assert.equal(stackXMark(item), 'X=2');
});

/* GETD — the X that is not a COUNT. "There's still no way to see the X value
 * for Volatile Toxicity on the stack. All spells with X should be clear what X
 * is when they're cast." Its cost is one sacrifice, a fixed amount, so R64's
 * `costPaid.x` is never written; the X is a stat the receipt snapshotted. */

test('Volatile Toxicity: the X read off its cost RECEIPT reaches the stack', () => {
  const h = new Harness(5911);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');            // 7/5 → X = 5
  giveResources(h, D, 'fire', 1);
  giveResources(h, D, 'wood', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                            // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Volatile Toxicity') });
  pick(h, { unit: whale });                           // the cost, paid at cast

  const item = h.state.stack.find(i => i.card === 'Volatile Toxicity')!;
  assert.ok(item, 'it reached the stack');
  assert.equal(item.x, undefined, 'no mana X…');
  assert.equal(item.parts[0]!.costPaid!.x, undefined, '…and no counted variable cost either');
  const rows = stackItemX(item);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { kind: rows[0]!.kind, x: rows[0]!.x, part: rows[0]!.part, receipt: rows[0]!.receipt },
    { kind: 'cost', x: 5, part: 0, receipt: 'sacrificed Good Whale' },
    "X is the sacrificed unit's defense, snapshotted at payment",
  );
  assert.equal(stackXMark(item), 'X=5', 'and the stack card wears it');
  assert.equal(stackAbilityRows(item)[0]!.x, 5, 'the clause row says it too');
});

test('a sacrifice cost whose clause names no stat wears no X — Immolate just draws', () => {
  // the receipt is the same shape; only the printed sentence differs. Inventing
  // an X here would put a number on a spell that has none.
  const it = xItem({
    card: 'Immolate',
    parts: [{
      effectKey: 'spell:Immolate', targets: [],
      costPaid: { sacrificed: { card: 'Good Whale', power: 7, defense: 5 } },
    }],
  });
  assert.deepEqual(stackItemX(it), []);
  assert.equal(stackXMark(it), '');
  assert.equal(stackAbilityRows(it)[0]!.x, undefined);
});

test("Structural Collapse's bar is the same snapshot, so it is shown too", () => {
  // "…until their total defense is at least equal to the defense of your
  // sacrificed unit" — the card never writes X, but that number is the whole
  // question a responder has about the spell.
  const it = xItem({
    card: 'Structural Collapse',
    parts: [{
      effectKey: 'graft:Structural Collapse', targets: [],
      costPaid: { sacrificed: { card: 'Good Whale', power: 7, defense: 5 } },
    }],
  });
  assert.deepEqual(stackItemX(it).map(r => [r.kind, r.x]), [['cost', 5]]);
});

/* ── the decision bar's options ─────────────────────────────────────────── */

test('partitionOptions puts every option in exactly one bucket', () => {
  const opts = [
    { label: 'Wraith', value: { unit: 5 } },
    { label: 'the Flame', value: { stack: 96 } },
    { label: 'Rashi', value: { player: 1 } },
    { label: 'Fight', card: 'Fight', value: { bin: { card: 'Fight' } } },
    { label: 'path 7', value: 7 },
    { label: 'No more targets', value: { doneTargets: true } },
  ];
  const s = partitionOptions(opts);
  assert.deepEqual(s.refs, [0, 1, 2], 'board refs get real buttons now');
  assert.deepEqual(s.cards, [3]);
  assert.deepEqual(s.plain, [4], 'an electricPath option is a bare entity id');
  assert.deepEqual(s.decline, [5]);
  const all = [...s.cards, ...s.refs, ...s.plain, ...s.decline].sort((a, b) => a - b);
  assert.deepEqual(all, opts.map((_, i) => i), 'nothing is dropped and nothing is doubled');
});

test('every shape of decline lands in the decline bucket', () => {
  for (const v of [{ doneTargets: true }, { doneCost: true }, { doneMods: true }, { declineCost: true }]) {
    assert.deepEqual(partitionOptions([{ label: 'stop', value: v }]).decline, [0], JSON.stringify(v));
  }
  // …and an affirmative that happens to be an object does NOT
  assert.deepEqual(partitionOptions([{ label: 'pay', value: { payCost: true } }]).plain, [0]);
});

/* ── BL-24: which option values ping a board unit ────────────────────────── */

test('optionPingId: only R4 electric-path numbers are entity ids — a formation-slot index pings NOTHING', () => {
  // R4's electric path really does put raw entity ids in its option values —
  // that contract keeps its ping
  assert.equal(optionPingId(7, 'electricPath'), 7);
  // BL-24: R75's slot options are slot INDEXES 0..n-1. While the ask rode
  // kind 'electricPath', "column 1, behind Hooba-Bot" (value 1) pinged and
  // previewed whichever unit happened to own entity id 1. Under its own kind
  // a bare number names no entity.
  assert.equal(optionPingId(1, 'formationSlot'), null);
  // …and neither does a number under any other kind (X amounts, hand indexes)
  assert.equal(optionPingId(2, 'payOrDecline'), null);
  assert.equal(optionPingId(3, undefined), null);
});

test("optionPingId: a ref value carrying `unit` pings that unit, whatever the kind — R29's behind-slot included", () => {
  // R29 (Tiderunner / Trench Stalker) values are FormationSpot descriptors;
  // the 'behind' one names the unit you would stand behind, which is exactly
  // the right thing to light up on the board
  assert.equal(optionPingId({ kind: 'behind', unit: 5 }, 'formationSlot'), 5);
  assert.equal(optionPingId({ unit: 9 }, 'targets'), 9);
  // spots that name no unit stay dark
  assert.equal(optionPingId({ kind: 'end', end: 'left' }, 'formationSlot'), null);
  assert.equal(optionPingId({ kind: 'out' }, 'formationSlot'), null);
});

/* ── card names inside prose ────────────────────────────────────────────── */

test('linkCardNames reproduces the message exactly', () => {
  for (const msg of [
    'Bena spawns Wraith.', '  leading and trailing  ', 'Primordial Coalescence resolves.',
    'Ben plays Fight (X=3).', '', 'no cards at all here',
  ]) {
    assert.equal(linkCardNames(msg).map(s => s.text).join(''), msg, JSON.stringify(msg));
  }
});

test('a card named in the log becomes its own span, punctuation outside', () => {
  const spans = linkCardNames('Bena spawns Wraith.');
  const named = spans.filter(s => s.name);
  assert.equal(named.length, 1);
  assert.equal(named[0]!.name, 'Wraith');
  assert.equal(named[0]!.text, 'Wraith', 'the full stop stays out of the link');
});

test('the longest name wins over a shorter one starting in the same place', () => {
  const spans = linkCardNames('Primordial Coalescence resolves.');
  assert.deepEqual(spans.filter(s => s.name).map(s => s.name), ['Primordial Coalescence']);
});

test('findCardName is the same matcher, asked for the most specific name', () => {
  assert.equal(findCardName('Primordial Coalescence resolves.'), 'Primordial Coalescence');
  assert.equal(findCardName('Bena spawns Wraith.'), 'Wraith');
  assert.equal(findCardName('nothing here'), null);
  // a short name early must not beat a long name later — the reveal picks ONE
  // scan per row and the most specific one is the right one
  assert.equal(findCardName('Fight resolves. Primordial Coalescence resolves.'),
    'Primordial Coalescence');
});

/* ── UFAB: the log links only the cards this game has shown ─────────────── */

test('the cast list is empty until the game shows something', () => {
  assert.deepEqual([...growCardLedger(new Set(), null)], []);
  assert.deepEqual(namesInEvents([]), []);
});

test('UFAB: "Battle:" is a card name and must NOT link in the phase line', () => {
  // `Battle` is a real card ("Two target units fight"), and the phase line the
  // engine emits every single turn starts with it. This is the whole report.
  const raw = linkCardNames('Battle: Ben may attack.');
  assert.deepEqual(raw.filter(s => s.name).map(s => s.name), ['Battle'],
    'the general matcher still finds it — that is not the bug');

  const h = new Harness(5120);
  toDeployment(h);
  // the case the report is about: nobody has the card. (If somebody DOES have
  // it, linking it in this line too is acceptable and not worth machinery.)
  for (const p of h.state.players) {
    p.hand = p.hand.filter(c => c !== 'Battle');
    p.bin = p.bin.filter(c => c !== 'Battle');
  }
  const known = growCardLedger(new Set(), h.state);
  assert.ok(!known.has('Battle'), 'nobody in this game has the card Battle');
  const spans = onlyKnownNames(raw, known);
  assert.deepEqual(spans.filter(s => s.name), [], 'so the line links nothing');
  assert.equal(spans.map(s => s.text).join(''), 'Battle: Ben may attack.',
    'and the line still reads exactly the way it read');
  assert.equal(spans.length, 1, 'the demoted name is welded back into the prose');
});

test('a card that IS in the game links on its very first mention', () => {
  // The first line about a card is the line announcing it, so the ledger has
  // to grow from the batch and the new state BEFORE those lines are rendered.
  const h = new Harness(5121);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  giveResources(h, seat, 'fire', 6);
  const idx = give(h, seat, 'Ignis Sprite');

  const before = growCardLedger(new Set(), h.state);
  assert.ok(before.has('Ignis Sprite'), 'it is in hand, so it is already known');

  // and the harder case: a card nobody could see in ANY state, because it was
  // created and resolved inside one batch — the client's only witness is the
  // batch's own events
  const fresh = new Set<CardName>();
  const events = h.do({ type: 'playCard', seat, handIndex: idx });
  growCardLedger(fresh, h.state, events);
  assert.ok(fresh.has('Ignis Sprite'));
  const line = events.find(e => /Ignis Sprite/.test(e.msg))!;
  assert.deepEqual(
    onlyKnownNames(linkCardNames(line.msg), fresh).filter(s => s.name).map(s => s.name),
    linkCardNames(line.msg).filter(s => s.name).map(s => s.name),
    'the announcing line links everything the general matcher found',
  );
});

test('a card recalled out of play still links in the older lines', () => {
  const h = new Harness(5122);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  const id = spawn(h, seat, 'Ignis Sprite');
  const known = growCardLedger(new Set(), h.state);
  assert.ok(known.has('Ignis Sprite'));

  // take it off the board entirely — no bin, no cache, nothing left to find
  delete h.state.entities[id];
  growCardLedger(known, h.state);
  assert.ok(known.has('Ignis Sprite'), 'the ledger only ever grows');
  assert.deepEqual(
    onlyKnownNames(linkCardNames('Ignis Sprite attacks.'), known)
      .filter(s => s.name).map(s => s.name),
    ['Ignis Sprite'],
  );
});

test('namesInState reads the zones this client is SHOWN, never the deck', () => {
  const h = new Harness(5123);
  const known = new Set(namesInState(h.state));
  // the hotseat Harness holds the real, unredacted deck. A card nobody has
  // seen is exactly the card the log must not pretend to be talking about.
  const deck = h.state.sharedDeck.filter(c => !known.has(c));
  assert.ok(deck.length > 0, 'the deck is not all in hand');
  for (const c of h.state.players[0]!.hand) assert.ok(known.has(c), c);

  // …and the zones that ARE shown
  h.state.players[0]!.bin.push('Fight');
  h.state.players[1]!.erased = ['Recall'];
  h.state.players[0]!.cache = [{ card: 'Squish' }];
  const grown = new Set(namesInState(h.state));
  for (const c of ['Fight', 'Recall', 'Squish']) assert.ok(grown.has(c), c);
});

test('namesInEvents reads DATA, never the message — that is the bug', () => {
  assert.deepEqual(namesInEvents([{ type: 'phase', msg: 'Battle: Ben may attack.' }]), []);
  assert.deepEqual(namesInEvents([{ type: 'died', msg: 'x', data: { card: 'Fight' } }]), ['Fight']);
  // a stack item's LABEL is prose and must not be scanned as a name
  assert.deepEqual(namesInEvents([{
    type: 'stackFlash', msg: '',
    data: { item: { id: 1, kind: 'spell', label: 'Battle: two units fight', controller: 0, region: 0, negated: false, parts: [] } },
  }]), []);
  // but the item's own card, its riding mods and its parts' sources are names
  assert.deepEqual(new Set(namesInEvents([{
    type: 'stackFlash', msg: '',
    data: {
      item: {
        id: 1, kind: 'spell', card: 'Fight', label: 'Fight', controller: 0, region: 0,
        negated: false, mods: [{ card: 'Squish', from: 'hand' }],
        parts: [{ effectKey: 'spell:Fight', targets: [] }, { effectKey: 'ability:Mohruung#0', targets: [] }],
      },
    },
  }])), new Set(['Fight', 'Squish', 'Mohruung']));
});

test('a card in the game brings the tokens it declares with it', () => {
  // Spirit of Nature's own trigger line reads "create a Poison 2 or a Crystal
  // 2" BEFORE either token exists anywhere — and that line is exactly where a
  // reader wants to hover the word. `createsOf` is declared on the effect and
  // conformance-tested, so this is not a guess.
  const tokens = createsOf('Spirit of Nature');
  assert.ok(tokens.length > 0, 'Spirit of Nature declares its tokens');
  const h = new Harness(5124);
  toDeployment(h);
  spawn(h, h.state.deployPlayer!, 'Spirit of Nature');
  const known = growCardLedger(new Set(), h.state);
  for (const t of tokens) assert.ok(known.has(t as CardName), t);
});

test('onlyKnownNames keeps the line byte-identical whatever it demotes', () => {
  for (const msg of [
    'Battle: Ben may attack.', 'Bena spawns Wraith.', 'Fight targets Wraith (Ben\'s).',
    '', 'no cards at all here', 'Wraith Wraith Wraith',
  ]) {
    const spans = linkCardNames(msg);
    for (const known of [new Set<string>(), new Set(['Wraith'])]) {
      const out = onlyKnownNames(spans, known);
      assert.equal(out.map(s => s.text).join(''), msg, JSON.stringify(msg));
      // no empty spans, and no two prose spans left adjacent
      for (const [i, sp] of out.entries()) {
        assert.ok(sp.text.length > 0);
        if (i > 0 && sp.name === null) assert.notEqual(out[i - 1]!.name, null);
      }
      for (const sp of out) if (sp.name) assert.ok(known.has(sp.name));
    }
  }
});

test('findCardName is untouched by the cast list — a different question', () => {
  // the deployment reveal asks about ONE sentence, not about a game, and it
  // must keep finding the name whether or not any ledger has heard of it
  assert.equal(findCardName('Battle: Ben may attack.'), 'Battle');
});

/* ── R68: nothing on the rules stack is negated any more ────────────────── */

test('R68: a negated trigger is GONE from the stack, not sitting on it greyed', () => {
  // `shouldAutoYield` guards against a negated top item. That guard is now
  // unreachable from the engine — this is the evidence — but it is kept
  // deliberately (see ui/inspect.ts, and test/53), because ui/flash.ts stamps
  // `negated` on the snapshots it replays and the flag is still on the type.
  // What this pins is the ENGINE half: negate a trigger the seat is yielding
  // to, and the stack does not hold it any more, in any state.
  const h = new Harness(5910);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const heralds = [0, 1].map(() => spawn(h, A, 'Warbloom Herald'));
  giveResources(h, D, 'metal', 3);                       // Containment Protocol mm/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: heralds.map(u => [u]) });
  assert.equal(h.state.stack.length, 2, 'two attack triggers, both yieldable');
  const yielded = new Set(heralds);
  assert.equal(shouldAutoYield(h.state, A, yielded), h.state.priority === A,
    'a live trigger on top is exactly what auto-yield is for');

  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Containment Protocol') });
  pass(h); pass(h);                                      // the Protocol resolves

  assert.deepEqual(h.state.stack.filter(i => i.negated), [],
    'R68: nothing on the stack is ever flagged negated');
  assert.equal(h.state.stack.some(i => heralds.includes(i.sourceId!)), false,
    'the negated triggers are gone, not greyed');
  assert.equal(shouldAutoYield(h.state, A, yielded), false, 'and there is nothing to yield to');
  // …and the guard itself still answers, for the shape ui/flash.ts mints
  const ghost = xItem({ kind: 'triggered', sourceId: heralds[0]!, negated: true });
  assert.equal(
    shouldAutoYield({ ...h.state, priority: A, decision: null, stack: [ghost] }, A, yielded),
    false, 'a negated item is worth seeing, never silently passed through');
});

/* ── round 13: the seen-hand memory aid ─────────────────────────────────
 *
 * "Make it so that clicking a card removes it from the aid / make a button to
 * dismiss the whole aid." `seenHand` is engine state, re-sent whole on every
 * snapshot, so the dismissals are a client-side layer over it — and the
 * interesting question is what happens when the engine sends a NEW look. */

const look = (turn: number, ...cards: string[]): { turn: number; cards: CardName[] } =>
  ({ turn, cards: cards as CardName[] });

test('the aid shows the whole look until something is dismissed', () => {
  const v = seenHandView(look(3, 'Jelly', 'Fight', 'Wraith'), null);
  assert.equal(v.show, true);
  assert.deepEqual(v.cards.map(c => c.name), ['Jelly', 'Fight', 'Wraith']);
  assert.deepEqual(v.cards.map(c => c.index), [0, 1, 2], 'each card knows the index that forgets it');
  assert.equal(v.dismissed, 0);
  // no look at all is not an empty strip, it is no strip
  assert.equal(seenHandView(null, null).show, false);
  assert.equal(seenHandView(undefined, { key: 'x', cards: [0] }).show, false);
});

test('a dismissed card is omitted, and the rest keep their own indexes', () => {
  const seen = look(3, 'Jelly', 'Fight', 'Wraith');
  const d = dismissSeenCard(seen, null, 1);
  const v = seenHandView(seen, d);
  assert.equal(v.show, true, 'two cards are still worth remembering');
  assert.deepEqual(v.cards.map(c => c.name), ['Jelly', 'Wraith'], 'the played card is gone');
  assert.deepEqual(v.cards.map(c => c.index), [0, 2],
    'indexes are the SNAPSHOT’s, not the view’s — dismissing "Wraith" next must not hit "Jelly"');
  assert.equal(v.dismissed, 1);
  // and the second dismissal lands on the card the player actually clicked
  assert.deepEqual(seenHandView(seen, dismissSeenCard(seen, d, 2)).cards.map(c => c.name), ['Jelly']);
});

test('duplicates in a hand are forgotten one at a time', () => {
  const seen = look(4, 'Jelly', 'Jelly');
  const v = seenHandView(seen, dismissSeenCard(seen, null, 0));
  assert.deepEqual(v.cards.map(c => c.index), [1],
    'they are two cards, not one name — dismissing one copy leaves the other');
});

test('dismissing every card collapses the strip', () => {
  const seen = look(3, 'Jelly', 'Fight');
  let d = dismissSeenCard(seen, null, 0);
  assert.equal(seenHandView(seen, d).show, true, 'one left');
  d = dismissSeenCard(seen, d, 1);
  assert.equal(seenHandView(seen, d).show, false, 'nothing left to remember, so no label taking up room');
  assert.equal(seenHandView(seen, d).dismissed, 2);
});

test('the dismiss button hides the whole aid without listing every card', () => {
  const seen = look(3, 'Jelly', 'Fight', 'Wraith');
  const d = dismissSeenHand(seen);
  assert.equal(d.all, true);
  assert.deepEqual(d.cards, [], 'one flag, not a card-by-card record');
  const v = seenHandView(seen, d);
  assert.equal(v.show, false);
  assert.equal(v.dismissed, 3, 'the whole look is what was forgotten');
});

test('a NEW look shows everything again, despite the earlier dismissals', () => {
  const first = look(3, 'Jelly', 'Fight', 'Wraith');
  let d = dismissSeenCard(first, null, 0);
  d = dismissSeenCard(first, d, 1);
  assert.deepEqual(seenHandView(first, d).cards.map(c => c.name), ['Wraith']);

  // turn 6: they reveal again, and this hand is not the one I crossed cards off
  const later = look(6, 'Jelly', 'Fight', 'Godray');
  const v = seenHandView(later, d);
  assert.equal(v.show, true);
  assert.deepEqual(v.cards.map(c => c.name), ['Jelly', 'Fight', 'Godray'],
    'stale dismissals must never hide a card from a look the player has not seen dismissed');
  assert.equal(v.turn, 6);
  assert.equal(v.dismissed, 0);

  // …and dismissing against the new look drops the old record rather than merging
  const d2 = dismissSeenCard(later, d, 2);
  assert.deepEqual(d2.cards, [2], 'no leftovers from turn 3');
  assert.deepEqual(seenHandView(later, d2).cards.map(c => c.name), ['Jelly', 'Fight']);
});

test('a whole-aid dismissal expires with its look too', () => {
  const first = look(3, 'Jelly');
  const d = dismissSeenHand(first);
  assert.equal(seenHandView(first, d).show, false);
  assert.equal(seenHandView(look(5, 'Jelly'), d).show, true,
    'they showed me their hand again — that is new information, not the thing I dismissed');
});

test('two looks in the SAME turn are different looks', () => {
  // E.revealHandTo stamps state.turn, so the turn number alone cannot tell a
  // second reveal from the first. The key folds in the cards.
  const before = look(3, 'Jelly', 'Fight');
  const d = dismissSeenHand(before);
  assert.equal(seenHandView(before, d).show, false);
  const after = look(3, 'Fight', 'Godray');       // they played Jelly, drew Godray, revealed again
  assert.equal(seenHandView(after, d).show, true, 'same turn, different hand — a different look');
  assert.deepEqual(seenHandView(after, d).cards.map(c => c.name), ['Fight', 'Godray']);
  // an identical re-send of the SAME look is not new information, so the
  // dismissals survive the re-render/resync that carried it
  assert.equal(seenHandView(look(3, 'Jelly', 'Fight'), d).show, false);
});

test('the aid is layered over live engine state, whatever revealHandTo wrote', () => {
  // the shape really does come off the engine: reveal a hand, then run the
  // view over exactly what the seat can see.
  const h = new Harness(5099);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  new E(h.state).revealHandTo(A, D);
  const seen = h.state.seenHand[A]!;
  assert.ok(seen, 'the engine recorded the look');
  assert.equal(seen.turn, h.state.turn);
  const v = seenHandView(seen, null);
  assert.deepEqual(v.cards.map(c => c.name), h.state.players[D]!.hand, 'the aid paints what was seen');
  assert.equal(v.turn, h.state.turn, 'and keeps the turn — the one fact that decays');
  const d = dismissSeenCard(seen, null, 0);
  assert.equal(seenHandView(seen, d).cards.length, seen.cards.length - 1);
});

/* ── R78: telling the waiting player WHY nothing is happening ────────────
 *
 * Two holes, one complaint. The engine closed the later one: GameState.resolving
 * names the item that is mid-resolution, so "Opponent is resolving X" is a
 * field read. The EARLIER one has no field at all — a cast-time suspension
 * (R35's X, {Modular} mods, an R49 bracketed cost, R67's targets) happens after
 * the card has left the hand and before the item reaches state.stack, so it
 * lives only in state.suspension, which view.ts nulls for the other seat along
 * with their decision. The opponent gets a frozen board and no explanation.
 *
 * ui/inspect.ts watchCast() infers it from public counts alone, and its whole
 * design constraint is that a WRONG message is worse than none: it says only
 * what it observed, and it re-baselines instead of guessing.
 */

/** a battle, both seats able to act, with `me` holding priority */
function battleReady(seed: number): { h: Harness; me: Seat; opp: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (let g = 0; g < 40 && h.state.decision; g++) {
    const d = h.state.decision!;
    h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
  }
  const me = h.state.priority!;
  return { h, me, opp: (1 - me) as Seat };
}

test('castProbe counts the hand, and everywhere a card out of one could be', () => {
  const { h, me } = battleReady(5090);
  const base = castProbe(h.state, me);
  assert.equal(base.hand, h.state.players[me]!.hand.length);
  // both seats' piles, on purpose: a card belongs to its OWNER, so an enemy
  // spell is binned/erased onto the owner's pile. Over-counting can only cost
  // the hint, never fabricate one.
  h.state.players[(1 - me) as Seat]!.bin.push('Fight');
  assert.equal(castProbe(h.state, me).shown, base.shown + 1);
  assert.equal(castProbe(h.state, me).hand, base.hand, 'the other seat\'s bin is not my hand');
});

test('a cast-time suspension is seen as a card out of the hand with nothing to show', () => {
  const { h, me, opp } = battleReady(5091);
  giveResources(h, me, 'fire', 8);
  const idx = give(h, me, 'Fireball');            // mana X: suspends before it pays
  // the watcher's view, which is where the hole is: view.ts has nulled the
  // caster's decision and suspension, so nothing in it names the cast
  let w: CastWatch | null = watchCast(null, viewFor(h.state, opp), me, false);
  assert.equal(w.casting, false, 'a fresh join has nothing to diff and says nothing');

  const events = h.do({ type: 'playCard', seat: me, handIndex: idx });
  const view = viewFor(h.state, opp) as GameState;
  assert.equal(view.decision, null, 'the caster\'s decision is redacted…');
  assert.equal(view.suspension, null, '…and so is the item they are holding');
  assert.equal(view.stack.length, 0, 'and it has not reached the stack');
  assert.equal(view.resolving ?? null, null, 'R78 cannot help this far back');
  const quiet = !events.some(e => e.msg);
  assert.equal(quiet, true, 'a cast-time suspension is silent — that is the honesty gate');

  w = watchCast(w, view, me, quiet);
  assert.equal(w.casting, true, 'the one thing that IS public: their hand is short');
  assert.match(waitingNote(view, w.casting), /left their hand/);
});

test('the guess survives the caster\'s own answers, and clears when the spell lands', () => {
  const { h, me, opp } = battleReady(5092);
  giveResources(h, me, 'fire', 8);
  const idx = give(h, me, 'Fireball');
  let w = watchCast(null, viewFor(h.state, opp), me, false);
  const step = (evs: readonly { msg: string }[]): void => {
    w = watchCast(w, viewFor(h.state, opp), me, !evs.some(e => e.msg));
  };
  step(h.do({ type: 'playCard', seat: me, handIndex: idx }));
  assert.equal(w.casting, true);

  // paying X changes their RESOURCES, not their hand — a per-update diff would
  // blink the hint out on the caster's very first click. The baseline freezes.
  let guard = 0;
  while (h.state.decision && h.state.stack.length === 0 && guard++ < 8) {
    const d = h.state.decision;
    step(h.do({ type: 'decide', seat: d.seat, choice: 0 }));
    if (h.state.stack.length === 0) {
      assert.equal(w.casting, true, `still mid-cast after "${d.prompt}"`);
    }
  }
  assert.equal(h.state.stack.length, 1, 'the spell reached the stack');
  assert.equal(w.casting, false, 'and the shortfall is explained — the hint goes');
  assert.match(waitingNote(viewFor(h.state, opp), w.casting), /on the stack/);
});

test('the shortfall is held until it is EXPLAINED, not until the next update', () => {
  // The caster answers their own cast questions, and those answers change
  // things that are not their hand — paying X expends resources, picking a
  // {Modular} mod moves a card they already took. A per-update diff would
  // blink the hint out on their very first click, so the baseline freezes for
  // as long as the shortfall lasts. `quiet` is deliberately false throughout:
  // once the watch is on, only an EXPLANATION turns it off.
  const { h, me, opp } = battleReady(5095);
  const view = (): GameState => viewFor(h.state, opp);
  let w = watchCast(null, view(), me, false);

  h.state.players[me]!.hand.pop();                     // the card leaves the hand
  w = watchCast(w, view(), me, true);
  assert.equal(w.casting, true);

  giveResources(h, me, 'fire', 3);                     // …they pay for it
  w = watchCast(w, view(), me, false);
  assert.equal(w.casting, true, 'still short, still nothing to show for it');
  h.state.players[me]!.resources.pop();
  w = watchCast(w, view(), me, false);
  assert.equal(w.casting, true, 'and again — the baseline does not drift');

  h.state.stack.push({
    id: 99, kind: 'spell', card: 'Fireball', label: 'Fireball', controller: me,
    region: 0, negated: false, parts: [],
  });
  w = watchCast(w, view(), me, false);
  assert.equal(w.casting, false, 'the card turned up: explained, and the hint goes');
  // …and having re-baselined, the next shortfall is seen afresh
  h.state.players[me]!.hand.pop();
  assert.equal(watchCast(w, view(), me, true).casting, true);
});

test('a cancelled cast puts the card back, and the hint goes with it', () => {
  // R67 gave the cast window a Cancel button. The card returns to the hand, so
  // the shortfall simply stops being one — no special case needed.
  const { h, me, opp } = battleReady(5096);
  const view = (): GameState => viewFor(h.state, opp);
  let w = watchCast(null, view(), me, false);
  const held = h.state.players[me]!.hand.pop()!;
  w = watchCast(w, view(), me, true);
  assert.equal(w.casting, true);
  h.state.players[me]!.hand.push(held);
  w = watchCast(w, view(), me, false);
  assert.equal(w.casting, false, 'nothing is missing any more');
});

test('an update that says anything at all is never read as a silent cast', () => {
  const { h, me, opp } = battleReady(5093);
  giveResources(h, me, 'fire', 8);
  const idx = give(h, me, 'Fireball');
  let w = watchCast(null, viewFor(h.state, opp), me, false);
  h.do({ type: 'playCard', seat: me, handIndex: idx });
  // same board, but the update carried a log line: every OTHER way a hand
  // shrinks in battle writes one (a "Discard me" mode, a discard cost, a mod
  // applied from hand), so silence is what excludes them.
  w = watchCast(w, viewFor(h.state, opp), me, false);
  assert.equal(w.casting, false, 'noisy: explained by the log, not by a guess');
  assert.equal(waitingNote(viewFor(h.state, opp), w.casting), 'nothing is yours to do yet');
});

test('waitingNote prefers the fact it can prove over the one it inferred', () => {
  const { h, me } = battleReady(5094);
  const s = h.state;
  assert.equal(waitingNote(s, false), 'nothing is yours to do yet');
  assert.match(waitingNote(s, true), /left their hand/);
  s.stack.push({
    id: 1, kind: 'spell', card: 'Fireball', label: 'Fireball', controller: me,
    region: 0, negated: false, parts: [],
  });
  assert.match(waitingNote(s, false), /answering something on the stack/);
  // R78's marker is a real field and names the effect, so it wins over both
  s.resolving = { ...s.stack[0]!, id: 2, label: 'Recall' };
  assert.match(waitingNote(s, true), /resolving Recall/);
  assert.match(waitingNote(s, true), /can no longer be answered/,
    'and it must not imply a response window that closed');
});

/* ── R247: the waiting bar names the effect, from the SERVER's stub ──────
 *
 * Playtest #117: *"opponent's should see the same effect like thing on the
 * stack that's lightly flashing to indicate when an opponent is choosing
 * targets for a trigger (like here with the Alluring trigger). Show me that
 * Rashi is choosing that."*
 *
 * The client cannot do this alone and the measurement is why: at the moment an
 * {Alluring} target is chosen the other seat holds `decision: null`,
 * `stack: []`, `resolving: null` and nothing legal. `server/view.ts` publishes
 * a two-field stub — the asking seat, and an entity id that seat ALREADY has —
 * and `waitingNote` reads the name off its own board.
 *
 * ⚠ THIS TEST IS THE SEAM. `ui/inspect.ts` redeclares `PendingAsk`
 * structurally because server/ is not on the client's import path (same as
 * PackInfo in ui/main.ts), and server/tsconfig.json has no DOM lib so the
 * server suite cannot import ui/. This is the one place both halves can be in
 * the same process: the assertion below feeds a REAL redacted view straight
 * into the client function, with nothing hand-built in between. The leak half
 * — that the stub carries nothing new — lives in server/test-pending-ask.ts.
 */
test('R247: the pause bar names the effect an opponent is answering, off the server stub', () => {
  const h = new Harness(5095);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const allurer = spawn(h, A, 'Tempest Wrangler');   // the pool's one {Alluring}
  spawn(h, D, 'Bumblecrab');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[allurer]] });

  const asker = h.state.decision!.seat;
  const watcher = (1 - asker) as Seat;
  assert.equal(h.state.stack.length, 0, 'the report measured this: nothing on the stack');
  assert.equal(h.state.resolving, null, 'and nothing resolving, so R78 has no answer here');

  const view = viewFor(h.state, watcher, null) as GameState;
  assert.equal(view.decision, null, 'the watcher still gets no decision');
  const note = waitingNote(view);
  assert.match(note, /Tempest Wrangler/, `the bar names the effect: ${note}`);
  assert.ok(!note.includes(h.state.decision!.prompt),
    'and never the prompt, which is not on the wire at all');
  assert.ok(!note.includes('Bumblecrab'), 'nor the candidate it is about to be pointed at');

  // and with no stub it falls back to what it can stand behind — the same
  // sentence it gave before the server had anything to say
  const blind = structuredClone(view) as GameState & { pendingAsk?: unknown };
  delete blind.pendingAsk;
  assert.equal(waitingNote(blind), 'nothing is yours to do yet');
});

/* ── which elements a resource menu SHOWS (playtest ledger #63) ─────────── */

/** the 30 cheapest mono-light cards in the pool — a legal constructed deck
 * whose `deckElements` is exactly ['light'] (test/34-constructed uses the same
 * recipe for the engine half) */
const monoLightDeck = (): CardName[] => DECK_LIST
  .filter(n => { const f = getCard(n).factions ?? []; return f.length === 1 && f[0] === 'light'; })
  .slice(0, 30);

test('the resource menu leads with your own decks elements and keeps the rest behind an expander', () => {
  // The report, verbatim (GETD, 2026-08-22): "In constructed, the resource
  // options from recycling and prismites should be limited just to the elements
  // that are in your deck. No need to put the whole list for every single game
  // when they're not relevant."
  const h = new Harness(5081, undefined, 'constructed', undefined,
    [monoLightDeck(), DECK_LIST.slice(30, 60)]);
  const s = h.state;
  assert.deepEqual(s.deckElements![0], ['light'], 'the fixture really is mono-light');

  const mine = resourceMenuElements(s, 0, s.elements);
  assert.deepEqual(mine.show, ['light'], 'seat 0 leads with light and nothing else');
  assert.deepEqual([...mine.show, ...mine.hidden].sort(), [...ALL_ELEMENTS].sort(),
    'and NOTHING is dropped — all seven are still reachable, because Reap the Due is '
    + 'mono-light and scales off DARK affinity');
  assert.equal(mine.hidden.length, 6, 'six of them behind the expander');

  // always the ASKING seat's own entry, never the opponent's and never the union
  const theirs = resourceMenuElements(s, 1, s.elements);
  assert.deepEqual(theirs.show, s.deckElements![1], 'seat 1 reads seat 1');
  assert.notDeepEqual(theirs.show, mine.show, 'the two seats do not share a menu');

  // the expander itself: one click and the whole list is there
  const opened = resourceMenuElements(s, 0, s.elements, true);
  assert.deepEqual(opened.show, s.elements, 'expanded shows every element the game offers');
  assert.deepEqual(opened.hidden, [], 'and has nothing left to expand');
});

test('a mono element deck still gets a prismite MENU rather than a silent auto exchange', () => {
  // THE HAZARD. An ACTIVE prismite offers seven exchanges and no activate, so
  // for a mono-element deck the display list narrows to exactly one — and the
  // click handler has always auto-fired on a single option. Filter first and
  // count second and the prismite is silently spent on light, with no menu, no
  // way to reach the other six, and no way back.
  const h = new Harness(5082, undefined, 'constructed', undefined,
    [monoLightDeck(), DECK_LIST.slice(30, 60)]);
  for (const seat of [0, 1] as Seat[]) {
    if (h.state.bottomDone && !h.state.bottomDone[seat]) {
      h.do({ type: 'bottomCards', seat, handIndices: [0, 1] });
    }
  }
  h.do({ type: 'activateResource', seat: 0, index: 0 });   // now it is a live prismite
  const opts = legalActions(h.state, 0).filter(a =>
    (a.type === 'activateResource' && a.index === 0) ||
    (a.type === 'exchangePrismite' && a.index === 0));
  assert.equal(opts.length, 7, 'seven exchanges and no activate — the shape that bites');

  const plan = prismiteClickPlan(h.state, 0, opts);
  assert.equal(plan.kind, 'menu', 'a menu, NOT an auto-fire: the count is over legal actions');
  assert.ok(plan.kind === 'menu');
  assert.deepEqual(plan.actions.map(a => (a as { element: string }).element), ['light'],
    'it still leads with the deck element');
  assert.equal(plan.hidden, 6, 'and says how many are behind the expander');
  assert.equal(plan.actions.length + 1, 2,
    'so the player is shown a real choice, never one option masquerading as none');

  // the expander reaches every one of the seven, unchanged
  const opened = prismiteClickPlan(h.state, 0, opts, true);
  assert.ok(opened.kind === 'menu');
  assert.deepEqual(opened.actions, opts, 'expanded is the engine list verbatim');
  assert.equal(opened.hidden, 0);

  // and the auto-fire it is allowed to keep: exactly one LEGAL action
  const one = prismiteClickPlan(h.state, 0, [opts[3]!]);
  assert.equal(one.kind, 'auto', 'one legal thing to do is still one click');
  assert.equal(prismiteClickPlan(h.state, 0, []).kind, 'none');
});

test('outside constructed the resource menu falls back to every element the game offers', () => {
  // deckElements is absent in shared and draft, and absent on every game saved
  // before R99. An empty menu would read as "you may not do this", which is a
  // rules claim and a false one.
  const shared = new Harness(5083).state;
  assert.equal(shared.deckElements, undefined);
  assert.deepEqual(resourceMenuElements(shared, 0, shared.elements).show, shared.elements);
  assert.deepEqual(resourceMenuElements(shared, 0, shared.elements).hidden, []);

  const draft = new Harness(5084, undefined, 'draft', ['fire', 'water', 'earth']).state;
  assert.deepEqual(resourceMenuElements(draft, 0, draft.elements).show, draft.elements,
    'draft already narrowed `elements` to its trio — a second narrowing would be noise');

  // a seat entry that is missing or empty falls back the same way
  const odd = { elements: shared.elements, deckElements: [[], ['fire']] } as Pick<
    GameState, 'elements' | 'deckElements'>;
  assert.deepEqual(resourceMenuElements(odd, 0, shared.elements).show, shared.elements,
    'an empty seat entry is a fallback, not an empty menu');
  assert.deepEqual(resourceMenuElements(odd, 1, ['light', 'dark']).show, ['light', 'dark'],
    'and neither is a deck that shares nothing with what is on offer');
});

/* ── R284: a declared mode reads as the half it declared ───────────────────
 *
 * Owner, 2026-09-01: *"when it's put onto the stack, the non chosen mode
 * vanishes, making the card read how it will function. (This part is purely
 * visual, to help the player.)"*
 *
 * The choice happened in the cast window (R57) and the stack is where the
 * OPPONENT prices their response, so a card still printing both halves there
 * is asking them to hold two readings of an effect that only has one. The
 * `Mode: …` badge already named the answer; this makes the sentence agree
 * with it.
 */

test('R284: a modal stack item reads as the half it declared, and both halves without the engine', () => {
  const h = new Harness(5040, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, D, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Void Memory') });
  pick(h, 'spell');

  const item = h.state.stack.find(i => i.card === 'Void Memory')!;
  const text = stackAbilityRows(item, new E(h.state))[0]!.text;
  assert.match(text, /discards a \/\[spell\] if/, `the declared half survives: ${text}`);
  assert.doesNotMatch(text, /unit/, 'and the one it did not pick is gone');
  assert.match(text, /\[Switch1\]/, 'the graft marker is not a half and is untouched');

  // WITHOUT the engine there is no way to recover which half a stored value
  // stands for, so the row falls back to the printed sentence rather than
  // guessing — a redacted client view must cost the reader nothing else.
  assert.match(stackAbilityRows(item)[0]!.text, /unit \{i1\}or spell/,
    'no engine, no narrowing — and no wrong half either');
});

test('R284: Siphon Life narrows to the printed half, not to the option order', () => {
  // THE CASE THAT MAKES `half` A DECLARATION. The card prints "[gains {i1}or
  // loses]" and offers Lose FIRST, so an index-based mapping would have shown
  // every burn as a heal and nobody would have noticed until a game.
  const h = new Harness(5041, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Siphon Life') });
  pick(h, 3);
  pick(h, { player: D });
  assert.equal(h.state.decision!.options[0]!.value, 'lose', 'Lose really is offered first');
  pick(h, 'lose');

  const item = h.state.stack.find(i => i.card === 'Siphon Life')!;
  const text = stackAbilityRows(item, new E(h.state))[0]!.text;
  assert.match(text, /player \/\[loses\] X life/, `the printed half, not options[0]: ${text}`);
});
