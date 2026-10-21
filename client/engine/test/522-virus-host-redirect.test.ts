/* CR 110.10a, 723.3 / CT-322 — A VIRUS BEING APPLIED CAN BE REDIRECTED.
 *
 * "A Virus being applied is an effect on the stack that targets its host. It
 * can be redirected" (CR 110.10a); "The Virus goes on the stack as an effect
 * that targets its host, and it can be responded to, redirected and negated"
 * (CR 723.3). Caleb, rules-questions: "You can redirect a virus, it is a
 * targeted effect."
 *
 * Found behind an "oops" rewind (YNKA #262, the board at action 235): an
 * Enigmatic Warder aimed at a Rampart Guardian being applied as a Virus
 * resolved and did nothing. The Virus item is built with `parts: []` and its
 * host in `hostId` / `hostStack`, and every change-the-targets card walked
 * `item.parts` alone — so the Virus was OFFERED as a target and then had no
 * slot to change.
 *
 * §1 is the class: every card whose printed text changes the targets of
 * "target effect" — DERIVED from the registry — answers a battle Virus being
 * applied to a unit by moving it to another unit in the battle's region
 * (CR 723.2), and the Virus lands there. §2 is the other shape (CR 723.4: a
 * Virus aimed at a spell on the stack) for the spell changers. §3 pins the
 * new host's legality: only a unit in the region is offered.
 *
 * Seeds 52200-52299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { HOST_SLOT } from '../src/types.ts';
import type { EntityId, ResourceKind, Seat, StackItem } from '../src/types.ts';
import { give, giveResources, spawn, toDeployment, toNextBattle } from './util.ts';

const key = (r: unknown): string => JSON.stringify(r);
const VIRUS = 'Aberrant Statweaver';   // the vehicle (mm/3 {Virus}), not the class under test

/** DERIVED: every card whose printed text changes the targets of "target effect" */
const CHANGERS = allCardNames().filter(n => /\bchange (?:a|the) targets? of target effect\b/i.test(getCard(n).text ?? ''));

test('CT-322 the change-the-targets cards are derived from the printed text', () => {
  // a cross-check, not the list: the sweep below walks CHANGERS, whatever it holds
  for (const n of ['Enigmatic Warder', 'Gravitational Correction', 'Divine Intervention']) {
    assert.ok(CHANGERS.includes(n), `${n} is found by the derivation`);
  }
  for (const n of CHANGERS) {
    const c = getCard(n);
    const activated = (c.augmentText ?? []).some(a => a.type === 'activated');
    assert.ok(c.spellEffect || activated,
      `${n}: the sweep knows how to cast a spell or activate an [Augment] ability — teach it this shape`);
  }
});

const isSpell = (n: string): boolean => !!getCard(n).spellEffect;

/** a live attack in D's region: A attacks with two vanilla units, D has two
 * vanilla units there and (for a unit changer) the changer itself. A holds
 * priority. */
function board(seed: number, changer: string): {
  h: Harness; A: Seat; D: Seat; region: number; atk: EntityId; own: EntityId; theirs: EntityId; source?: EntityId;
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  const own = spawn(h, A, 'The Foretold');
  const theirs = spawn(h, D, 'The Foretold');
  const source = isSpell(changer) ? undefined : spawn(h, D, changer);
  giveResources(h, A, 'metal', 3);                                  // the Virus, mm/3
  for (const f of getCard(changer).factions!) giveResources(h, D, f as ResourceKind, 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk], [own]] });
  const region = h.state.battle!.region;
  for (const id of [atk, own, theirs, ...(source ? [source] : [])]) {
    assert.equal(h.state.entities[id]?.region, region, `unit ${id} stands in the battle's region`);
  }
  return { h, A, D, region, atk, own, theirs, ...(source ? { source } : {}) };
}

/** D answers the item `target` with `changer`, steering every question
 * toward moving it onto `dest`, then the stack runs out. */
function answerWith(h: Harness, D: Seat, changer: string, target: number, dest: unknown, source?: EntityId): void {
  if (isSpell(changer)) {
    h.do({ type: 'playCard', seat: D, handIndex: give(h, D, changer) });
  } else {
    const ai = getCard(changer).augmentText!.findIndex(a => a.type === 'activated');
    h.do({ type: 'activateAbility', seat: D, entityId: source!, abilityIndex: ai, via: 'augment' });
  }
  for (let n = 0; n < 80; n++) {
    const dec = h.state.decision;
    if (dec) {
      const vals = dec.options.map(o => key(o.value));
      let i = vals.indexOf(key({ stack: target }));                  // cast: aim at the Virus
      if (i < 0) i = vals.indexOf(key(dest));                        // re-choice: the new host
      if (i < 0 && dec.seat !== D) i = vals.indexOf('false');        // its controller: decline to pay
      if (i < 0 && dec.seat === D) i = vals.indexOf('true');         // "you may": yes
      if (i < 0 && dec.options.every(o => typeof o.value === 'number')) i = 0;   // X: the least
      h.do({ type: 'decide', seat: dec.seat, choice: Math.max(i, 0) });
      continue;
    }
    if (!h.state.stack.length) return;
    const seat = ([0, 1] as Seat[]).find(p => legalActions(h.state, p).some(a => a.type === 'passPriority'));
    assert.ok(seat !== undefined, 'somebody can pass');
    h.do({ type: 'passPriority', seat });
  }
  assert.fail('the stack never emptied');
}

/** does unit `id` carry `card` as a mod? */
const carries = (h: Harness, id: EntityId, card: string): boolean =>
  (h.state.entities[id]?.mods ?? []).some(m => h.state.entities[m]?.card === card);

/* ═══ §1 THE CLASS: A BATTLE VIRUS ON A UNIT, EVERY CHANGER ═══════════════ */

for (const [k, changer] of CHANGERS.entries()) {
  test(`CT-322 ${changer} moves a battle Virus being applied onto another unit in the region, and it lands there`, () => {
    const { h, A, D, atk, theirs, source } = board(52200 + k, changer);
    h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, VIRUS), hostId: atk });
    const item = h.state.stack.find(i => i.kind === 'virus' && i.card === VIRUS);
    assert.ok(item, 'the Virus is on the stack, aimed at the attacker');
    assert.equal(item.hostId, atk);

    // Warder moves the target to ITSELF; every other changer re-chooses, and
    // takes D's own unit — a unit the Virus did not target, in the region
    const dest = source ?? theirs;
    answerWith(h, D, changer, item.id, { unit: dest }, source);

    assert.ok(carries(h, dest, VIRUS), `${VIRUS} landed on the new host (${changer})`);
    assert.ok(!carries(h, atk, VIRUS), `and not on the attacker it was first aimed at (${changer})`);
    assert.ok(h.log.some(l => l.includes(`${VIRUS} augments`) && l.includes(h.state.entities[dest]!.card)),
      'the log says where it went');
  });
}

/* ═══ §2 THE OTHER SHAPE: A VIRUS AIMED AT A SPELL ON THE STACK ═════════ */

for (const [k, changer] of CHANGERS.filter(isSpell).entries()) {
  test(`CT-322 ${changer} moves a Virus aimed at a spell on the stack onto another spell there`, () => {
    const { h, A, D, atk, own, region } = board(52250 + k, changer);
    let first = -1, second = -1;
    // two of A's spells on the stack in the region, hand-built so neither asks anything
    const e = new E(h.state);
    for (const n of [0, 1]) {
      const it: StackItem = {
        id: e.s.nextId++, kind: 'spell', card: 'Fireball', label: `Fireball ${n}`, controller: A, region,
        negated: false, parts: [{ effectKey: 'spell:Fireball', targets: [{ unit: n ? own : atk }] }],
      };
      e.s.stack.push(it);
      if (n) second = it.id; else first = it.id;
    }
    h.state = e.s;
    h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, VIRUS), hostStack: first });
    const item = h.state.stack.find(i => i.kind === 'virus');
    assert.ok(item, 'the Virus is on the stack, aimed at the first spell');
    const g = new E(structuredClone(h.state));
    assert.deepEqual(g.slotCandidates(item, HOST_SLOT, 0).map(key).sort(),
      [key({ stack: first }), key({ stack: second })].sort(),
      'its host slot offers the spells on the stack in the region, never a unit or the Virus itself');
    answerWith(h, D, changer, item.id, { stack: second });
    assert.ok(h.log.some(l => l.includes(`${VIRUS} augments Fireball 1`)),
      `${VIRUS} went onto the second spell (${changer})`);
    assert.ok(!h.log.some(l => l.includes(`${VIRUS} augments Fireball 0`)),
      `and not onto the spell it was first aimed at (${changer})`);
  });
}

/* ═══ §3 THE NEW HOST MUST BE LEGAL ═════════════════════════════════════ */

test('CT-322 a Virus host slot offers exactly the units in the battle region, either side', () => {
  const { h, A, atk } = board(52290, 'Divine Intervention');
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, VIRUS), hostId: atk });
  const item = h.state.stack.find(i => i.kind === 'virus')!;
  const g = new E(structuredClone(h.state));
  const want = g.unitsIn(item.region).map(u => key({ unit: u.id })).sort();
  assert.deepEqual(g.slotCandidates(item, HOST_SLOT, 0).map(key).sort(), want,
    'CR 723.2: any unit in the battle region, its current host included');
  assert.deepEqual(g.targetSlots(item), [{ pi: HOST_SLOT, ti: 0, ref: { unit: atk } }],
    'the Virus has exactly one target slot: its host');
  const elsewhere = Object.values(h.state.entities).find(u => u.kind === 'unit' && u.region !== item.region);
  if (elsewhere) {
    assert.equal(g.canFillSlot(item, HOST_SLOT, 0, { unit: elsewhere.id }), false,
      'a unit in another region is not a legal host');
  }
});
