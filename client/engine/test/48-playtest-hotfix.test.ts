/* Playtest round 5 — four bugs Bena hit at the table, plus the guards that
 * stop each CLASS of them recurring rather than just the one card.
 *
 *  1. Cards that "create a Shard" were pushing PRISMITES (R17-exchangeable,
 *     strictly better). Shards are their own ResourceKind: mana only.
 *  2. "When I become targeted" (Mohruung) never fired — commitItem logged the
 *     `targeted` event but never dispatched it.
 *  3. A text-box [Augment] card implemented via `statics` was not recognised
 *     as an augment at all, so it could not be applied from hand OR bin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { fuzzGame } from './fuzz.ts';
import { getCard, isAugment, radiantList, registerSynthetic, type Printed } from '../src/cards/dsl.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { E } from '../src/engine.ts';
import { give, giveResources, pick, spawn, toDeployment, tokensOf } from './util.ts';

/** a free deployment spell whose only job is to AIM at a unit */
const ping: Printed = {
  name: 'Test Ping', cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], text: 'Target a unit.', image: '',
};
registerSynthetic(ping, {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Test Ping: target a unit' },
    run: (g, ctx) => { g.ev('info', `Test Ping aims at ${ctx.targets?.[0] ? 'a unit' : 'nothing'}.`); },
  },
});

/* ── 1. Shards are Shards, not prismites ──────────────────────────────── */

test('Swirling Shardform creates two dormant SHARDS, not prismites', () => {
  // The bug at the table: these were prismites. openMana counts both the same,
  // so the difference is invisible until planning — where a prismite can be
  // traded for a resource of ANY element (R17) and a Shard cannot. Two free
  // prismites is two free element-fixers; two Shards is two generic mana.
  const h = new Harness(4802, ['Ben', 'Rashi']);
  toDeployment(h);
  const before = h.state.players[0]!.resources.length;
  spawn(h, 0, 'Swirling Shardform');

  const made = h.state.players[0]!.resources.slice(before);
  assert.equal(made.length, 2, 'two resources created');
  for (const r of made) {
    assert.equal(r.kind, 'shard', 'a Shard, not a prismite');
    assert.equal(r.state, 'dormant', 'printed "(Dormant)"');
  }
});

test('a Shard gives mana but no affinity and no element exchange', () => {
  const h = new Harness(4803, ['Ben', 'Rashi']);
  toDeployment(h);
  spawn(h, 0, 'Swirling Shardform');
  // activate them the way planning would, then read what they are worth
  for (const r of h.state.players[0]!.resources) if (r.kind === 'shard') r.state = 'open';
  const e = new E(h.state);

  assert.equal(e.openMana(0), 2, 'two generic mana');
  for (const el of ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark']) {
    assert.equal(e.affinity(0, el), 0, `a Shard grants no ${el} affinity`);
  }
  // R17's exchange is the prismite's whole point and a Shard must not have it
  const exchanges = h.legal(0).filter(a => a.type === 'exchangePrismite');
  assert.deepEqual(exchanges, [], 'a Shard can never be exchanged for an element');
});

test('every "create a Shard" card that is live uses E.createShard', async () => {
  // Guard: the failure mode was a card reaching into player.resources itself
  // and pushing the wrong kind. Nothing outside apply.ts's affinity bonus and
  // E.createShard may push a resource.
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../src/cards/sets/', import.meta.url);
  const offenders: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    const src = readFileSync(new URL(f, dir), 'utf8');
    if (/resources\.push\s*\(/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], 'card files must create resources via E.createShard, not resources.push');
});

/* ── 2. "When I become targeted" is dispatched, not merely logged ──────── */

test('Mohruung has a live targeted trigger', () => {
  const c = getCard('Mohruung');
  const ab = (c.abilities ?? []).find(a => a.type === 'triggered' && a.events.includes('targeted'));
  assert.ok(ab, 'Mohruung must listen for the targeted event');
  assert.equal(ab.type === 'triggered' && ab.self, true, 'it is "when I become targeted"');
  assert.equal(ab.bounded, true, '[Switch1] — once per turn (R9)');
});

test('a spell aimed at Mohruung actually creates the Crystal 2', () => {
  // The bug at the table: Ben targeted Mohruung and got nothing. commitItem
  // built the `targeted` event and dropped it on the floor — modding fired it
  // (doAugment/doGraft) but the STACK path never did, so no spell in the game
  // could trigger a "when I become targeted" ability.
  const h = new Harness(4800, ['Ben', 'Rashi']);
  toDeployment(h);
  giveResources(h, 0, 'earth', 6);
  const moh = spawn(h, 0, 'Mohruung');

  const before = tokensOf(h, 0).filter(t => t.card === 'Crystal').length;
  const i = give(h, 0, 'Test Ping');
  h.do({ type: 'playCard', seat: 0, handIndex: i });
  pick(h, { unit: moh });          // aim it at Mohruung

  const after = tokensOf(h, 0).filter(t => t.card === 'Crystal').length;
  assert.equal(after, before + 1, 'becoming targeted must create a Crystal');
  const crystal = tokensOf(h, 0).find(t => t.card === 'Crystal');
  assert.equal(crystal!.x, 2, 'Crystal 2');
});

test('the targeted trigger is bounded — [Switch1] is once per turn', () => {
  const h = new Harness(4801, ['Ben', 'Rashi']);
  toDeployment(h);
  giveResources(h, 0, 'earth', 12);
  const moh = spawn(h, 0, 'Mohruung');

  for (let n = 0; n < 2; n++) {
    const i = give(h, 0, 'Test Ping');
    h.do({ type: 'playCard', seat: 0, handIndex: i });
    pick(h, { unit: moh });
  }
  assert.equal(tokensOf(h, 0).filter(t => t.card === 'Crystal').length, 1,
    'R9: a bounded trigger fires once per turn however many times it is targeted');
});

/* ── 3. Printed [Augment] ⇒ applicable as an augment ───────────────────── */

/** the printed `[Augment]` ability marker: it opens a text segment, so it sits
 * at the start of the text or just after a {/n} line break. A mid-sentence
 * mention inside {i}(reminder text) — Reconfigure — is NOT a marker. */
function hasAugmentMarker(text: string): boolean {
  return /(^|\{\/n\})\s*\[Augment\]/i.test(text);
}

test('every card printing a text-box [Augment] marker is applicable as an augment', () => {
  // The bin bug: Brough prints "[Augment] Everything is balanced" but its
  // behaviour is a `static`, not `augmentText`, so isAugment() was false and
  // it could not be slid under a unit from hand or bin at all. Three more
  // cards in the same batch had the identical hole.
  const missing = DECK_LIST.filter(n => hasAugmentMarker(getCard(n).text ?? '') && !isAugment(n));
  assert.deepEqual(missing, [],
    'these print [Augment] but isAugment() is false — set augmentable: true when the text is a static');
});

test('the four cards from the report are augmentable', () => {
  for (const n of ['Brough', 'Air Plant', 'Life Power Dude', 'The Omniphage']) {
    assert.equal(isAugment(n), true, `${n} must be applicable as an augment`);
    assert.ok(radiantList(n, 'statics').length > 0,   // R268: body + [Augment] box
      `${n}'s [Augment] text is implemented as a static`);
  }
});

test('a spell that merely mentions [Augment] in reminder text is not an augment', () => {
  // Reconfigure: "Augment target unit ... {i}(The first target must have [Augment]...)"
  assert.equal(hasAugmentMarker(getCard('Reconfigure').text ?? ''), false);
  assert.equal(isAugment('Reconfigure'), false);
});

/* ── 4. Reconfigure cannot augment a unit onto itself ──────────────────── */

test('fuzz seed 1132 completes — Reconfigure no longer orphans a mod', () => {
  // Found by the 2000-game fuzz, pre-existing (it reproduces on the code
  // before this round's fixes too) and never reached by the earlier 400- and
  // 625-game runs.
  //
  // Reconfigure collects two DISTINCT targets at cast, and its author took
  // that as an invariant. It isn't: Enigmatic Warder's "[two]: change a target
  // of target effect to me" can redirect a target afterwards, and with two
  // activations it collapses BOTH of Reconfigure's targets onto one unit.
  // Resolving that deleted the entity and then attached it as a mod pointing
  // at its own dead id — an orphan in the entity table.
  const r = fuzzGame(1132, 3000);
  assert.ok(r.actions.length > 0);
});

test('Reconfigure refuses when both targets collapsed onto one unit', () => {
  // The guard itself, independent of the seed: same id in both slots is a
  // no-op, and critically leaves the entity table intact.
  const h = new Harness(4804, ['Ben', 'Rashi']);
  toDeployment(h);
  const u = spawn(h, 0, 'Brough');          // an [Augment] unit, so slot 1 is legal
  const before = Object.keys(h.state.entities).length;

  const eff = getCard('Reconfigure').spellEffect!;
  const target = h.state.entities[u]!;
  eff.run(new E(h.state), {
    controller: 0, region: h.state.entities[u]!.region,
    sourceName: 'Reconfigure', targets: [target, target],
  } as never);

  assert.ok(h.state.entities[u], 'the unit is still in play');
  assert.equal(Object.keys(h.state.entities).length, before, 'no entity created or destroyed');
  const orphans = Object.values(h.state.entities)
    .filter(e => e.kind === 'mod' && (e.modOf === undefined || !h.state.entities[e.modOf]));
  assert.deepEqual(orphans, [], 'no orphan mods');
});
