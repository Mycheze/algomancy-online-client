/**
 * Comprehensive rules — CR example tests for the rules drafted for the live
 * rulings no CR rule cited (the 2026-10-11 coverage round, before the R-ruling
 * register is retired).
 *
 * Each test title starts with `cr:<key>`, and the test backs the rule whose key
 * it names: the rule record in data/comprehensive-rules/rules/<unit>.json lists
 * this file in its sources.tests, and an example may be bound to the test by its
 * title.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 *
 * Seeds 44000-44099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { DecisionOption, Seat } from '../src/types.ts';
import { hiddenSegment, legalActions } from '../src/apply.ts';
import { registerSynthetic } from '../src/cards/dsl.ts';
import { playableCachedIndexes } from '../../ui/inspect.ts';
import { ent, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';

/** the index in the event stream of the first `type` event naming `card` */
const firstAt = (h: Harness, type: string, card: string): number =>
  h.events.findIndex(ev => ev.type === type && ev.data?.['card'] === card);

/** drive everything pending to a standstill (first option, or `choose`) */
function resolveAll(h: Harness, choose: (o: DecisionOption) => boolean = () => true): void {
  for (let guard = 120; guard > 0; guard--) {
    const dec = h.state.decision;
    if (dec) {
      if (dec.pickOrder) { h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) }); continue; }
      const i = dec.options.findIndex(choose);
      h.do({ type: 'decide', seat: dec.seat, choice: i === -1 ? 0 : i });
      continue;
    }
    if (h.state.phase === 'battle' && h.state.stack.length) { pass(h); continue; }
    return;
  }
  throw new Error('resolveAll did not terminate');
}

test('cr:zones.changes.leave-play-order — a unit that dies dies first, and is trashed after', () => {
  const h = new Harness(44000);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const u = spawn(h, A, 'Rune Channeler');
  const from = h.events.length;
  withE(h, e => { e.destroy(e.entity(u)!, 'dies'); });
  resolveAll(h);

  assert.equal(ent(h, u), undefined, 'the unit left play');
  assert.ok(h.state.players[A]!.bin.includes('Rune Channeler'), 'and went to its controller’s bin');
  const died = firstAt(h, 'died', 'Rune Channeler');
  const trashed = firstAt(h, 'trashed', 'Rune Channeler');
  assert.ok(died >= from, 'it died');
  assert.ok(trashed >= from, 'it was trashed');
  assert.ok(died < trashed, `its death (event ${died}) comes before its trash (event ${trashed})`);
});

test('cr:zones.changes.leave-play-order — a unit exchanged out of play despawns first, and is trashed after', () => {
  const h = new Harness(44001);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat;
  // Hooba-Mon's own text-box [Augment] exchanges it for a unit card in A's bin
  const hooba = spawn(h, A, 'Hooba-Mon');
  h.state.players[A]!.bin.push('Skittering Blight');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hooba]] });
  const dec = h.state.decision!;
  const pick = dec.options.findIndex(o =>
    JSON.stringify(o.value) === JSON.stringify({ bin: { seat: A, card: 'Skittering Blight' } }));
  assert.ok(pick >= 0, 'Hooba-Mon offers the bin card');
  h.do({ type: 'decide', seat: dec.seat, choice: pick });
  resolveAll(h);

  assert.equal(ent(h, hooba), undefined, 'Hooba-Mon left play');
  const despawned = firstAt(h, 'despawned', 'Hooba-Mon');
  const trashed = firstAt(h, 'trashed', 'Hooba-Mon');
  assert.ok(despawned >= 0 && trashed >= 0, 'it despawned and was trashed');
  assert.equal(firstAt(h, 'died', 'Hooba-Mon'), -1, 'an exchange is not a death');
  assert.ok(despawned < trashed, `its despawn (event ${despawned}) comes before its trash (event ${trashed})`);
});

// ── Annex D: the cache panel while a decision is open (adopted from the U24 round-4 verifier's probe) ──

const CACHED_NOW = 'CR440 Cached Now';
registerSynthetic({
  name: CACHED_NOW, cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '', text: 'Gain 3 life.',
}, { spellEffect: { run: (g, ctx) => { g.gainLife(ctx.controller, 3, CACHED_NOW); } } });

test('cr:annexd.display.panels.cache-dialog-only — in deployment, the deciding seat gets no one-click cache card; the other seat still does', () => {
  const h = new Harness(44002);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) if (h.state.hasteDone && !h.state.hasteDone[s]) h.do({ type: 'doneHaste', seat: s });
  // three Wraiths: their start-of-deployment "choose an ally" puts a real decision to seat 1
  for (let i = 0; i < 3; i++) spawn(h, 1, 'Wraith');
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  assert.equal(hiddenSegment(h.state), 'deploy', 'deployment: a hidden simultaneous segment');
  assert.equal(h.state.decision?.seat, 1, 'a decision is open for seat 1');

  // both seats hold a castable deploy-timing card glimpsed this turn
  for (const s of [0, 1] as Seat[]) {
    const pl = h.state.players[s]!;
    pl.cache ??= [];
    pl.cache.push({ card: CACHED_NOW, uid: 44090 + s, playableUntilTurn: h.state.turn } as never);
  }
  assert.deepEqual(playableCachedIndexes(legalActions(h.state, 1)), [],
    'the seat whose decision is open: no cache card is promoted, so a click opens the full cache');
  assert.deepEqual(playableCachedIndexes(legalActions(h.state, 0)), [0],
    'the other seat is not stopped by that decision: its cached card still plays on one click');
  h.do({ type: 'playCached', seat: 0, index: 0 } as never);   // throws if refused
  assert.equal(h.state.decision?.seat, 1, 'and seat 1\'s decision is still open after the play');
  assert.equal((h.state.players[0]!.cache ?? []).length, 0, 'the cached card was played: it left the cache');
});
