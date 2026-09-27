/* 327 — AN ARROW AT A FORMATION LANDS ON THE FORMATION (report, room RCPN,
 * 2026-09-26, mycheze: "Targeting a formation points to the wrong place on the
 * board").
 *
 * At RCPN action 72 Galactic Germination sat on the stack targeting
 * `{formation: 1}` — Gember's attacking formation, fighting in mycheze's
 * region. The arrow pointed at `field:1`, Gember's HOME In Play zone: on the
 * regions board, the far corner from the fight. A formation had no anchor of
 * its own because it is not one element — it is its player's half of every
 * battle column.
 *
 * §1  every battle column marks whose formation each half is (`data-fside`),
 *     the attacker's half holding the attacker's units, for either viewer
 * §2  the target resolver aims a formation at ALL of that seat's halves, and
 *     keeps the In Play zone only as the fallback
 * The arrow's landing was measured in a browser on the RCPN slice.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Seat } from '../../engine/src/types.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const MAIN = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');

test('§1 each half of each battle column says whose formation it is', () => {
  const h = new Harness(32701);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a1 = spawn(h, A, 'Good Whale'), a2 = spawn(h, A, 'Good Whale');
  const d1 = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1] } });
  for (const viewer of [A, D]) {
    const html = ui.join(h.state, viewer, legalActions(h.state, viewer));
    const halves = [...html.matchAll(/<div class="bhalf (top|bot)[^"]*" data-fside="(\d)">([\s\S]*?)<\/div>\s*(?:<div class="vs"|<\/div>)/g)];
    assert.equal(halves.length, 4, `viewer ${viewer}: two columns, two halves each, all marked`);
    for (const [, , seat, body] of halves) {
      for (const id of [a1, a2]) if (body!.includes(`data-previd="${id}"`)) assert.equal(Number(seat), A, 'an attacker stands in an attacker half');
      if (body!.includes(`data-previd="${d1}"`)) assert.equal(Number(seat), D, 'the blocker stands in a defender half');
    }
    assert.equal(halves.filter(m => Number(m[2]) === A).length, 2);
  }
});

test('§2 a formation target is every half of that seat, then the In Play zone', () => {
  const at = MAIN.indexOf("if ('formation' in t) {");
  assert.ok(at >= 0, 'the formation branch of targetSelectors');
  const ret = MAIN.slice(at, MAIN.indexOf('\n  }', at));
  const every = ret.indexOf('`${ALL_OF}.bhalf[data-fside="${t.formation}"]`');
  const zone = ret.indexOf('field:${t.formation}');
  assert.ok(every > 0, 'every half of that seat is the target');
  assert.ok(zone > every, 'the zone only after it, as the fallback');
});
