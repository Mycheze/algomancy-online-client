/* CR 608.2d, 802.25a — an UNBLOCKED Pure column keeps none of its own other
 * attributes when it strikes the player.
 *
 * Just a Unit: "Pure cards and cards they are interacting with ignore all
 * other attributes." Asked (owner-questions §3, D-U12-12) whether a Pure unit
 * in an unblocked column keeps its own Swift, Powerful, Thieving when it
 * strikes the player — a player is not a card, so is there an interaction at
 * all? — the owner chose A on 2026-10-23: No. "An unblocked Pure column
 * strikes in the normal sub-step and does not double or draw." It agrees with
 * 2026-10-22's ruling that a Pure card ignores its own stat attributes
 * everywhere (CR 802.25a; test 584 guards it).
 *
 * The engine already did this when the ruling came in (measured 2026-10-23,
 * every attribute below): an unblocked column is an exchange with an empty
 * blocking half, and CR 802.25b makes any exchange with a Pure card in it
 * attribute-blind. This file pins it, for every attribute in the `Attr` union
 * (derived from types.ts, not typed here), two ways:
 *  - the Pure unit carries the attribute itself;
 *  - a column-mate carries it (CR 802.25k: a unit in a column with a Pure unit
 *    is Pure too, and CR 802.25b blinds the whole exchange, so the mate's
 *    attribute is off as well).
 * Each is compared with the same column carrying NO attribute: the strike on
 * the player must be indistinguishable — same sub-step, same life lost, no
 * gain, no draw, no kill.
 *
 * Seeds 60000-60099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import '../src/apply.ts';
import { E } from '../src/engine.ts';
import { Harness } from '../src/harness.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import type { Attr, EntityId, Seat } from '../src/types.ts';
import { ENGINE_SRC_DIR } from '../scripts/paths.mjs';
import { pass, toDeployment, toNextBattle } from './util.ts';

/** every attribute the engine knows: the `Attr` union, read off types.ts */
const ATTRS: Attr[] = (() => {
  const src = fs.readFileSync(path.join(ENGINE_SRC_DIR, 'types.ts'), 'utf8');
  const decl = /export type Attr =([^;]*);/.exec(src)![1]!;
  return [...decl.matchAll(/'([A-Za-z]+)'/g)].map(m => m[1] as Attr);
})();

function tok(h: Harness, seat: Seat, p: number, t: number, attrs: readonly Attr[]): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  for (const a of attrs) g.addTempAttr(u, a);
  g.settle();
  return u.id;
}

interface Strike { lost: number; gained: number; drew: number; subs: string[]; killed: boolean }
/** one attacking column, unblocked, through combat damage. `col` lists each
 * unit's attributes front to back: the back unit is a 3/20, the rest 1/20. */
function strike(seed: number, col: readonly (readonly Attr[])[]): Strike {
  const h = new Harness(seed, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ids = col.map((a, i) => tok(h, A, i === col.length - 1 ? 3 : 1, 20, a));
  toNextBattle(h, A);
  const lifeA = h.state.players[A]!.life, lifeD = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [ids] });
  for (let i = 0; i < 40 && h.state.battle?.step !== 'blocks'; i++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  const mark = h.events.length;
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  let subs: string[] = [];
  for (let i = 0; i < 12 && h.state.battle && h.state.winner === null; i++) {
    // CR 608.3d: the sub-steps with a strike in them, fixed when the damage step opens
    if (h.state.battle.damageSubs) subs = [...h.state.battle.damageSubs];
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  const evs = h.events.slice(mark);
  return {
    lost: lifeD - h.state.players[D]!.life,
    gained: h.state.players[A]!.life - lifeA,
    drew: evs.filter(e => /^Thieving: /.test(e.msg)).length,
    subs,
    killed: h.state.winner === A,
  };
}

const OTHER: Attr[] = ATTRS.filter(a => a !== 'Pure');
const PLAIN = strike(60001, [[]]);

test('CR 802.25: the attribute list is the Attr union, and every attribute the pool prints is in it', () => {
  assert.ok(ATTRS.includes('Pure') && ATTRS.length >= 20, `read ${ATTRS.length}: ${ATTRS.join(', ')}`);
  for (const n of allCardNames()) {
    for (const a of getCard(n).attrs ?? []) assert.ok(ATTRS.includes(a as Attr), `${n} prints ${a}`);
  }
});

test('CR 608.2d, 802.25c: PREMISE: without Pure, Swift, Sluggish, Powerful, Thieving, Lethal and Blessed each change an unblocked strike on the player', () => {
  assert.deepEqual(PLAIN, { lost: 3, gained: 0, drew: 0, subs: ['normal'], killed: false });
  const acting = OTHER.filter(a => JSON.stringify(strike(60001, [[a]])) !== JSON.stringify(PLAIN));
  for (const a of ['Swift', 'Sluggish', 'Powerful', 'Thieving', 'Lethal', 'Blessed']) {
    assert.ok(acting.includes(a as Attr), `${a} acts on a strike at the player: the scenario reaches it (found: ${acting.join(', ')})`);
  }
});

test('CR 608.2d, 802.25a: an unblocked Pure column strikes in the normal sub-step and does not double or draw — its own attributes are all off', () => {
  // every attribute checked before failing, so a regression names them all
  const kept = OTHER.filter(a => JSON.stringify(strike(60001, [['Pure', a]])) !== JSON.stringify(PLAIN));
  assert.deepEqual(kept, [], 'a Pure unit with any of these, unblocked, strikes the player as a plain one');
  // two at once: Swift and Sluggish is a double strike when it is not Pure (CR 608.2c)
  assert.deepEqual(strike(60002, [['Swift', 'Sluggish']]).subs, ['Swift', 'Sluggish'], 'PREMISE: it strikes twice');
  assert.deepEqual(strike(60002, [['Pure', 'Swift', 'Sluggish']]), PLAIN, 'Pure: once, in the normal sub-step');
});

test('CR 802.25b, 802.25k: in an unblocked column with a Pure unit, a column-mate attributes are off too', () => {
  const base = strike(60003, [['Pure'], []]);
  assert.deepEqual(base, { lost: 4, gained: 0, drew: 0, subs: ['normal'], killed: false });
  const kept = OTHER.filter(a => JSON.stringify(strike(60003, [['Pure'], [a]])) !== JSON.stringify(base));
  assert.deepEqual(kept, [], 'a unit with any of these beside a Pure one strikes the player as a plain one');
});
