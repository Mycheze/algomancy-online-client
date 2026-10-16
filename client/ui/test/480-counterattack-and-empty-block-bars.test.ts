/* 480 — the two combat bars after the owner's rulings of 2026-10-16.
 *
 * CT-298: "if you decide to counterattack with something, it MUST be put into
 * formation, you cannot change your mind and leave a unit off to the side/not
 * attacking in the new region." So a counterattack bar has no "Don't attack",
 * and Attack! stays disabled, with a short hint, until every sent unit is in a
 * column.
 *
 * CT-297: "If there's no attacking formation (everyone died or something), no
 * blocking can occur. It does still need to allow counter attackers, but you
 * can't put something in to block". So the block builder over an emptied
 * attack draws no slot to block in (side-block slots included), says there is
 * nothing to block, and still offers the send.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { apply, legalActions } from '../../engine/src/apply.ts';
import { E } from '../../engine/src/engine.ts';
import { absorb, ent, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { EntityId, GameState, Seat } from '../../engine/src/types.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const store = (globalThis as { localStorage: Storage }).localStorage;

/** the opening tag of the element carrying `marker`, or null */
const tagWith = (html: string, marker: string): string | null => {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};
/** the prompt bar's markup */
const bar = (html: string): string => {
  const at = html.indexOf('class="promptbar');
  assert.ok(at >= 0, 'no prompt bar');
  return html.slice(at, html.indexOf('</div>', at));
};

/** round 2 open, D counterattacking with `k` sent units */
function sentPool(seed: number, k: number): { s: GameState; D: Seat; sent: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  const sent = Array.from({ length: k }, () => spawn(h, D, 'The Foretold'));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (let g = 0; g < 60 && !(h.state.battle?.round === 2 && h.state.battle.step === 'declare'); g++) {
    const b = h.state.battle;
    if (b?.step === 'blocks') { h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: sent }); continue; }
    const dec = h.state.decision;
    if (dec) { h.do({ type: 'decide', seat: dec.seat, choice: 0 }); continue; }
    h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  assert.equal(h.state.battle?.round, 2, 'the premise: round 2 is open');
  assert.equal(h.state.battle?.attacker, D);
  return { s: h.state, D, sent };
}

for (const layout of ['regions', 'classic'] as const) {
  test(`CT-298 ${layout} board: a counterattack has no decline and Attack waits until every sent unit is placed`, () => {
    if (layout === 'classic') store.setItem('algoLayout', '1'); else store.removeItem('algoLayout');
    try {
      const { s, D, sent: [u1, u2] } = sentPool(48001, 2);
      let html = ui.join(s, D, legalActions(s, D));
      assert.equal(tagWith(html, 'data-btn="skipattack"'), null, 'no Don’t attack button');
      assert.match(tagWith(html, 'data-btn="confirmattack"')!, /disabled/, 'nothing placed: Attack! is disabled');
      assert.match(bar(html), /all must attack — 2 to place/);
      ui.click({ act: 'unit', id: String(u1) });
      html = ui.click({ act: 'slot', ci: '0', row: '0' });
      assert.match(tagWith(html, 'data-btn="confirmattack"')!, /disabled/, 'one of two placed: still disabled');
      assert.match(bar(html), /all must attack — 1 to place/);
      ui.click({ act: 'unit', id: String(u2) });
      html = ui.click({ act: 'slot', ci: '1', row: '0' });
      assert.doesNotMatch(tagWith(html, 'data-btn="confirmattack"')!, /disabled/, 'all placed: Attack! is live');
      assert.doesNotMatch(bar(html), /to place/, 'and the hint is gone');
      ui.actions();
      ui.click({ btn: 'confirmattack' });
      const out = ui.actions().filter(a => a.type === 'declareAttack');
      assert.equal(out.length, 1, 'Attack! sent the declaration');
      assert.doesNotThrow(() => apply(s, out[0]!), 'and the engine takes it');
    } finally {
      store.removeItem('algoLayout');
    }
  });
}

test('CT-298 a first-round attack still offers Dont attack', () => {
  const h = new Harness(48002);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  const html = ui.join(h.state, A, legalActions(h.state, A));
  assert.ok(tagWith(html, 'data-btn="skipattack"'), 'declining a fresh attack is still a button');
});

test('CT-297 an emptied attack draws no block slot, says so, and still offers the send', () => {
  const h = new Harness(48003);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  const d1 = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'passPriority', seat: h.state.priority! });
  h.do({ type: 'passPriority', seat: h.state.priority! });
  assert.equal(h.state.battle!.step, 'blocks');
  const e = new E(h.state);
  e.destroy(ent(h, atk)!, 'is deleted'); e.settle(); h.state = e.s; absorb(h, e.events);
  assert.deepEqual(h.state.battle!.columns, [], 'the premise: the attack is empty');
  for (const layout of ['regions', 'classic'] as const) {
    if (layout === 'classic') store.setItem('algoLayout', '1'); else store.removeItem('algoLayout');
    try {
      let html = ui.join(h.state, D, legalActions(h.state, D));
      assert.match(bar(html), /no attackers left to block — you may still send counterattackers/, `${layout}: the bar says so`);
      assert.doesNotMatch(bar(html), /assign blockers/, `${layout}: no block wording`);
      ui.click({ act: 'unit', id: String(d1) });
      html = ui.html();
      assert.doesNotMatch(html, /data-act="slot"/, `${layout}: no slot to block in, not even to the side`);
      assert.match(bar(html), /data-btn="sendrest"/, `${layout}: the send is offered`);
      ui.click({ act: 'unit', id: String(d1) });   // put it down again
    } finally {
      store.removeItem('algoLayout');
    }
  }
});
