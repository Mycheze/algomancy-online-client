/**
 * CR 601.2a, 101.6, 110.5a, 703.7 / CT-234 — each region has its own stack, and a
 * player's bin is reached only where that player is present.
 *
 * The owner, 2026-10-11: each region has its own stack, owned by nobody and
 * shared by the players present in it, and only they can put effects on it or
 * respond to it; a player's bin (like the cache, CR 403.6) is reachable only in a
 * region where that player is present. And 2026-10-22: a stack in a region where
 * only ONE player is present "drains on its own — like a deployment stack: it
 * resolves in order without a priority window, since nobody else is there to
 * respond".
 *
 * The engine kept one stack for battle and walked all of it: a Molten
 * Riftbreaker dying at home negated its controller's spell on the battle stack
 * in the other region (verifier probe F-U01-4).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Harness } from '../src/harness.ts';
import { finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, withE } from './util.ts';
import type { EntityId, Seat } from '../src/types.ts';

/** A attacks D with a token, then casts Twin Flame at D's unit: it waits on the battle stack */
function twinFlameOnTheStack(seed: number): { h: Harness; A: Seat; D: Seat; home: EntityId; battle: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const home = spawn(h, A, 'Molten Riftbreaker');                // stays home, out of the battle
  const foe = spawn(h, D, 'Curio Drifter');
  giveResources(h, A, 'fire', 3);
  toNextBattle(h, A);
  // its spawn trigger (two Fireballs) resolved in deployment, long ago
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Twin Flame') });
  pick(h, { unit: foe });
  if (h.state.decision) pick(h, { doneTargets: true });
  assert.ok(h.state.stack.some(i => i.card === 'Twin Flame'), 'setup: Twin Flame waits on the battle stack');
  return { h, A, D, home, battle: h.state.battle!.region };
}

test('CR 601.2a / CT-234: Molten Riftbreaker dying in the other region does not negate a spell on the battle stack', () => {
  const { h, A, home, battle } = twinFlameOnTheStack(5780);
  assert.notEqual(h.state.entities[home]!.region, battle, 'setup: the Riftbreaker is in the other region');
  const priority = h.state.priority, passes = h.state.passes;
  const n = h.events.length;
  withE(h, e => e.destroy(e.entity(home)!, 'dies'));
  assert.ok(h.state.stack.some(i => i.card === 'Twin Flame' && i.controller === A),
    'Twin Flame is still on the battle stack: the Riftbreaker reached only its own region stack');
  assert.ok(h.events.slice(n).some(ev => /Molten Riftbreaker: you have no spell on the stack/.test(ev.msg)),
    'its trigger resolved, in its own region, and found nothing there');
  // CR 703.7: only A is present at home, so that stack drained on its own
  assert.ok(!h.state.stack.some(i => i.region !== battle), 'nothing is left on the home stack');
  assert.equal(h.state.priority, priority, 'the battle window priority was not touched');
  assert.equal(h.state.passes, passes, 'nor its passes');
  pass(h); pass(h);
  finishBattle(h);
});

test('CR 601.2a / CT-234: the control — the same Riftbreaker dying in the battle region does negate it', () => {
  const { h, A, home, battle } = twinFlameOnTheStack(5781);
  withE(h, e => { e.entity(home)!.region = battle; });           // white-box: it stands in the battle now
  withE(h, e => e.destroy(e.entity(home)!, 'dies'));
  // the trigger is on the battle stack, in the window: pass it through
  for (let k = 0; k < 6 && h.state.stack.some(i => i.label.startsWith('Molten Riftbreaker')); k++) pass(h);
  assert.ok(!h.state.stack.some(i => i.card === 'Twin Flame' && i.controller === A),
    'negated: the allied spell was on the same region stack');
  finishBattle(h);
});

test('CR 403.6 / CT-234: in deployment a bin card target reaches only the bin of the player present', () => {
  const h = new Harness(5782);
  toDeployment(h);
  const p = h.state.deployPlayer!, q = (1 - p) as Seat;
  h.state.players[p]!.bin.push('Twin Flame');
  h.state.players[q]!.bin.push('Overbloom');
  let mine: string[] = [], theirs: string[] = [];
  withE(h, e => {
    const region = e.homeRegion(p);
    mine = e.targetCandidates({ what: 'anyBinCard' } as never, region, undefined, p).map(r => JSON.stringify(r));
    theirs = e.targetCandidates({ what: 'binCard' } as never, region, undefined, q).map(r => JSON.stringify(r));
  });
  assert.ok(mine.some(r => r.includes('Twin Flame')), `own bin: ${mine.join(' ')}`);
  assert.ok(!mine.some(r => r.includes('Overbloom')), `not the absent player bin: ${mine.join(' ')}`);
  assert.deepEqual(theirs, [], 'and an absent player own bin is not reached for them there either');
});

test('CR 601.2a / CT-234: no card file walks the whole stack — every sweep reads E.stackIn(region)', () => {
  // derived over every set file: a by-id lookup (find/some on i.id) is fine — the
  // id came from a region-scoped target or event — but a wholesale walk is not
  const dir = new URL('../src/cards/sets/', import.meta.url);
  const bad: string[] = [];
  const walk = /\[\.\.\.g\.s\.stack\]|g\.s\.stack\.(filter|length|map|forEach|reduce|slice)\b|for \(const \w+ of g\.s\.stack\)/;
  for (const f of readdirSync(dir).filter(n => n.endsWith('.ts'))) {
    readFileSync(new URL(f, dir), 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(code)) return;
      if (walk.test(code)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, []);
});
