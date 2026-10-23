/* CT-296 follow-on — a combat hit WHOLLY redirected into Oorblak dealt the
 * player nothing.
 *
 * Oorblak: "If combat damage would be dealt to you, that damage is dealt to me
 * instead." The owner, 2026-10-16: "The column doesn't even get to deal damage
 * to the player. It gets redirected to the Oorblak instead." And on
 * 2026-10-22, asked whether that also means no {Thieving} draw and no "when my
 * column deals combat damage to a player" payout: "Yes, none of them". A
 * PARTIAL redirect (a {Piercing} excess that gets past Oorblak) still counts,
 * and it counts as what got past (CR 608.8c: "the other 6 are dealt to the
 * player").
 *
 * The listener family is DERIVED: every card with a triggered ability on
 * 'combatFaceDamage', the event that carries "my column dealt combat damage
 * to a player". Each one is run three ways — unredirected (it fires: the
 * scenario really reaches it), wholly redirected (it does not), and partly
 * redirected (it fires).
 *
 * Seeds 58101-58199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/apply.ts';
import { E } from '../src/engine.ts';
import { Harness } from '../src/harness.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import type { Attr, EngineEvent, EntityId, Seat } from '../src/types.ts';
import { pass, spawn, toDeployment, toNextBattle } from './util.ts';

function listensOnFaceDamage(v: unknown, seen = new Set<unknown>()): boolean {
  if (!v || typeof v !== 'object' || seen.has(v)) return false;
  seen.add(v);
  const o = v as Record<string, unknown>;
  if (o['type'] === 'triggered' && Array.isArray(o['events'])
    && (o['events'] as string[]).includes('combatFaceDamage')) return true;
  return Object.values(o).some(x => listensOnFaceDamage(x, seen));
}
// Ancient One listens on EVERY event a card in the pool listens on, to lend its
// neighbours' triggers (report 271); alone in a column it has nothing to lend
// and never fires. 588 covers it borrowing Bloodwind Revenant and Amphivore.
const LISTENERS = allCardNames().filter(n => n !== 'Ancient One' && listensOnFaceDamage(getCard(n)));
/** a listener that hears it from the BIN, not from the column (CR 400.5) */
const fromBin = (n: string): boolean => JSON.stringify(getCard(n), (_k, v) => typeof v === 'function' ? undefined : v)
  .includes('"zone":"bin"');

function tok(h: Harness, seat: Seat, p: number, t: number, attrs: Attr[] = []): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  for (const a of attrs) g.addTempAttr(u, a);
  g.settle();
  return u.id;
}

type Redirect = 'none' | 'whole' | 'partial';
/** attack with one column into a defender with (or without) Oorblak, no blocks,
 * through combat damage; returns the events from the block declaration on */
function hit(seed: number, column: (h: Harness, A: Seat) => EntityId[], redirect: Redirect,
  setup?: (h: Harness, A: Seat) => void): { h: Harness; A: Seat; D: Seat; evs: EngineEvent[] } {
  const h = new Harness(seed, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const col = column(h, A);
  // CR 608.8c: a column is Piercing when one of its units is, and only the
  // excess past Oorblak's 4 reaches the player
  if (redirect === 'partial') col.push(tok(h, A, 6, 20, ['Piercing']));
  if (redirect !== 'none') spawn(h, D, 'Oorblak');
  setup?.(h, A);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [col] });
  for (let i = 0; i < 40 && h.state.battle?.step !== 'blocks'; i++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  const mark = h.events.length;
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  for (let i = 0; i < 12 && h.state.battle && h.state.winner === null; i++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  return { h, A, D, evs: h.events.slice(mark) };
}

const fired = (evs: EngineEvent[], name: string): boolean =>
  evs.some(e => e.msg.startsWith(name) && e.msg.includes('→ stack'));

test('CT-296: the face-damage listener family is derived from the registry, and it is not empty', () => {
  assert.ok(LISTENERS.length >= 10, `found ${LISTENERS.length}: ${LISTENERS.join(', ')}`);
  for (const n of ['Vroot', 'Rippleback Skulker', 'Zephyrzoa', 'Sarcophage', 'Cinder Scuttler']) {
    assert.ok(LISTENERS.includes(n), `${n} is in the family`);
  }
});

for (const [i, name] of LISTENERS.entries()) {
  const column = (h: Harness, A: Seat): EntityId[] => fromBin(name) ? [tok(h, A, 1, 20)] : [spawn(h, A, name)];
  const setup = fromBin(name) ? (h: Harness, A: Seat): void => { h.state.players[A]!.bin.push(name); } : undefined;
  test(`CT-296 / CR 608.8c: ${name} hears an unredirected hit, not one wholly redirected into Oorblak, and does hear a Piercing excess`, () => {
    assert.ok(fired(hit(58110 + 3 * i, column, 'none', setup).evs, name), `${name}: the plain hit fires it — the scenario reaches it`);
    assert.ok(!fired(hit(58111 + 3 * i, column, 'whole', setup).evs, name), `${name}: the column dealt the player nothing`);
    assert.ok(fired(hit(58112 + 3 * i, column, 'partial', setup).evs, name), `${name}: the excess past Oorblak was dealt`);
  });
}

test('CR 608.8c / CT-296: a wholly redirected hit raises no face-damage event and no combat life loss', () => {
  const { evs, h, D } = hit(58101, (h, A) => [tok(h, A, 3, 20)], 'whole');
  assert.equal(evs.filter(e => e.type === 'combatFaceDamage').length, 0, 'no column dealt the player combat damage');
  assert.equal(evs.filter(e => e.type === 'lifeLost' && e.data?.['why'] === 'combat').length, 0);
  assert.equal(h.state.players[D]!.life, 30);
});

test('CR 608.8c / CT-296: a partly redirected hit is dealt as what got past Oorblak', () => {
  const { evs } = hit(58102, () => [], 'partial');          // one 6-power Piercing column
  const face = evs.filter(e => e.type === 'combatFaceDamage');
  assert.equal(face.length, 1);
  const hits = face[0]!.data?.['hits'] as { dealt: number; amount: number }[];
  assert.equal(hits[0]!.dealt, 2, 'Oorblak took 4 of the 6; the 2 that got past were dealt');
  assert.equal(hits[0]!.amount, 2);
});

test('CR 802.20 / CT-296: a Thieving column wholly redirected into Oorblak draws no card', () => {
  const draws = (r: Redirect, seed: number): number => {
    const { h, A } = hit(seed, (h, A) => [tok(h, A, 3, 20, ['Thieving'])], r);
    return h.events.filter(e => /^Thieving: .* draws a card/.test(e.msg) && e.msg.includes(h.state.players[A]!.name)).length;
  };
  assert.equal(draws('none', 58103), 1, 'an unredirected Thieving hit draws');
  assert.equal(draws('whole', 58104), 0, 'a wholly redirected one does not');
  assert.equal(draws('partial', 58105), 1, 'a Piercing excess that got past does');
});
