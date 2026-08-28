/* R131 — "other" / "another" is a DIFFERENT ENTITY, never a different card name.
 *
 * Owner, 2026-08-24: "All other/another cards should work based on 'game state
 * tracking UUID' (or whatever we use). It only cares about the other thing
 * being a different entity."
 *
 * Two cards in the pool read the clause as a card-NAME exclusion, so a second
 * copy of the card was wrongly filtered out along with the one instance the
 * word actually excludes:
 *
 *  · ROTBEAST — "[Augment] After combat, move all my other Augments onto one
 *    or more enemies." The text lives on a MOD, and `ctx.sourceId` names the
 *    HOST, so nothing identified the mod carrying the text. R131 threads the
 *    granting mod's EntityId onto the pending trigger and into the EffectCtx
 *    (`ctx.selfModId`), so "other" excludes exactly ONE entity — itself.
 *
 *  · BLIGHTWALKER — "recall another target unit from your bin". A bin holds
 *    bare card NAMES, so there is no uid to compare. R64/R124 already settled
 *    identity there: a BinRef is (name, nth occurrence), because "copies of one
 *    card there are genuinely indistinguishable". `noteTrashed` now stamps the
 *    trashed copy's `binNth` on the 'trashed' event and `notSelfBinCard` reads
 *    it, so exactly one bin SLOT is excluded rather than every slot holding
 *    that name.
 *
 * Seeds 12100-12199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import {
  ent, give, giveResources, pass, spawn, toDeployment, toNextBattle, withE,
} from './util.ts';
import type { DecisionOption, Entity, EntityId, Seat } from '../src/types.ts';

// ── helpers (same shape as 42-dark-b / 43-dark-c) ─────────────────────

/** drive everything pending to a standstill */
function resolveAll(h: Harness, choose: (o: DecisionOption) => boolean = () => true): void {
  let guard = 120;
  while (guard-- > 0) {
    const dec = h.state.decision;
    if (dec) {
      if (dec.pickOrder) {
        h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
        continue;
      }
      const i = dec.options.findIndex(choose);
      h.do({ type: 'decide', seat: dec.seat, choice: i === -1 ? 0 : i });
      continue;
    }
    if (h.state.phase === 'battle' && h.state.stack.length) { pass(h); continue; }
    return;
  }
  throw new Error('resolveAll did not terminate');
}

const modsOn = (h: Harness, id: EntityId): Entity[] =>
  (ent(h, id)?.mods ?? []).map(m => ent(h, m)!).filter(Boolean);
const bin = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.bin;
const hand = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.hand;

/** answer the pending decision with the first option matching `match` */
function pickBy(h: Harness, match: (o: DecisionOption) => boolean): void {
  const dec = h.state.decision!;
  assert.ok(dec, 'a decision was expected');
  const i = dec.options.findIndex(match);
  if (i === -1) throw new Error(`no matching option in [${dec.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: dec.seat, choice: i });
}

// ── Rotbeast: two of the same mod on one host ─────────────────────────

test('R131 Rotbeast: a SECOND Rotbeast augment is "another" — each moves the other', () => {
  const h = new Harness(12100);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const host = spawn(h, A, 'Good Whale');
  const enemy = spawn(h, D, 'Legion of the Depths');       // 0/8: survives the whale
  withE(h, e => {
    e.attachMod(e.entity(host)!, 'Rotbeast', A, 'augment');
    e.attachMod(e.entity(host)!, 'Rotbeast', A, 'augment');
  });
  const [rb1, rb2] = modsOn(h, host).map(m => m.id);
  assert.notEqual(rb1, rb2, 'two Rotbeast augments, two distinct entities');

  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  resolveAll(h);
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [enemy] } });
  resolveAll(h);
  pass(h); pass(h);                                        // combat damage → after combat
  resolveAll(h);

  // Two mods donate two triggers, and each moves everything on the host but
  // ITSELF. Trigger #1 carries Rotbeast #2 onto the enemy; trigger #2 then
  // reads the host live (R1), finds Rotbeast #1 still there — "other" to it —
  // and moves that too. Both end up on the enemy.
  //
  // THE POINT: under the old card-NAME exclusion neither trigger could see
  // anything to move (every entity named Rotbeast was filtered out) and the
  // host kept both augments. Movement at all is the fix.
  const onHost = modsOn(h, host).map(m => m.id);
  const onEnemy = modsOn(h, enemy).map(m => m.id);
  assert.equal(onHost.length + onEnemy.length, 2, 'no mod was lost');
  assert.ok(onEnemy.length >= 1,
    'a second Rotbeast IS "another Augment" and moves (name-filtering moved nothing at all)');
  assert.deepEqual([...onEnemy].sort(), [rb1, rb2].sort(),
    'each trigger moved the augment that was not itself — both land on the enemy');
  assert.deepEqual(onHost, [], 'the host is left bare');
  assert.deepEqual(modsOn(h, enemy).map(m => m.card), ['Rotbeast', 'Rotbeast']);
  assert.ok(modsOn(h, enemy).every(m => m.modOf === enemy), 'and are really re-parented');
});

test('R131 Rotbeast: a SINGLE Rotbeast augment still never moves itself', () => {
  const h = new Harness(12101);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const host = spawn(h, A, 'Good Whale');
  const enemy = spawn(h, D, 'Legion of the Depths');
  withE(h, e => {
    e.attachMod(e.entity(host)!, 'Rotbeast', A, 'augment');
    e.augmentWraith(e.entity(host)!, A);                    // the augment to be dumped
  });
  assert.equal(modsOn(h, host).length, 2);

  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  resolveAll(h);
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [enemy] } });
  resolveAll(h);
  pass(h); pass(h);
  resolveAll(h);

  assert.deepEqual(modsOn(h, host).map(m => m.card), ['Rotbeast'],
    'only the Rotbeast text itself stays — "my OTHER Augments"');
  assert.deepEqual(modsOn(h, enemy).map(m => m.card), ['Wraith'], 'the rest moved');
});

test('R131 Rotbeast: played NORMALLY, no mod carries the text, so every augment is "other"', () => {
  const h = new Harness(12102);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const rb = spawn(h, A, 'Rotbeast');                      // the UNIT — own [Augment] text is live
  const enemy = spawn(h, D, 'Legion of the Depths');
  withE(h, e => e.augmentWraith(e.entity(rb)!, A));
  assert.equal(modsOn(h, rb).length, 1);

  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rb]] });
  resolveAll(h);
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [enemy] } });
  resolveAll(h);
  pass(h); pass(h);
  resolveAll(h);

  assert.deepEqual(modsOn(h, rb).map(m => m.card), [],
    'ctx.selfModId is undefined — the unit is not one of its own Augments');
  assert.deepEqual(modsOn(h, enemy).map(m => m.card), ['Wraith']);
});

// ── Blightwalker: two copies in one bin ───────────────────────────────

test('R131 Blightwalker: a Blightwalker ALREADY in the bin is "another" and is offered', () => {
  const h = new Harness(12110);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'dark', 2);
  bin(h, P).push('Blightwalker');                          // an earlier copy, already there
  const i = give(h, P, 'Blightwalker');
  withE(h, e => e.discardFromHand(P, i));                  // R40: discarding is trashing

  const dec = h.state.decision;
  assert.ok(dec, 'the trash trigger fires from the bin and asks for its target');
  const offered = dec!.options.map(o => String(o.label)).filter(l => l.startsWith('Blightwalker'));
  assert.equal(offered.length, 1,
    'exactly ONE of the two Blightwalkers is excluded — the copy that just landed');
  pickBy(h, o => String(o.label).startsWith('Blightwalker'));
  pickBy(h, o => o.label === 'Pay [2]');
  assert.ok(hand(h, P).includes('Blightwalker'), 'the other copy really comes back to hand');
  assert.equal(bin(h, P).filter(c => c === 'Blightwalker').length, 1,
    'and exactly one Blightwalker — the trashed one — is left in the bin');
});

test('R131 Blightwalker: alone in the bin it is still the only thing excluded', () => {
  const h = new Harness(12111);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'dark', 2);
  const i = give(h, P, 'Blightwalker');
  withE(h, e => e.discardFromHand(P, i));
  assert.equal(h.state.decision, null, 'the bin holds only me — nothing to recall');
  assert.deepEqual(bin(h, P), ['Blightwalker']);
});

test("R131: 'trashed' stamps WHICH copy in the bin was trashed (binNth)", () => {
  const h = new Harness(12112);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  bin(h, P).push('Grox', 'Grox');
  const i = give(h, P, 'Grox');
  withE(h, e => e.discardFromHand(P, i));
  const ev = h.events.filter(e => e.type === 'trashed').pop()!;
  assert.equal(ev.data!['card'], 'Grox');
  assert.equal(ev.data!['binNth'], 2,
    'the third Grox — every trash path pushes into the bin before firing');
});
