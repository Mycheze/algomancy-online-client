/**
 * CR 710.5, 710.7a / report 270 — "A COPY OF ME" IN A BORROWED ABILITY IS A COPY
 * OF THE UNIT THAT HAS IT.
 *
 * Tomzy (report 270): "Ancient one copying echo of despair should make copies
 * of itself and not echo of despair copies". The designer, verbatim: "If
 * Ancient One is adjacent to 3 copies of Echo of Despair and a player loses
 * life during battle … 3 Ancient Ones are created". CR 710.7a: in text a unit
 * gets this way, "I" and "me" mean the unit that has the text; CR 710.5: the
 * token is a copy of what that unit currently is.
 *
 * Echo of Despair and Swarmling spelled their own NAME into the token they
 * made, so an Ancient One borrowing either made Echoes and Swarmlings.
 * Hooba-God already read the face (E.nameOf) and is guarded here with them.
 *
 * DERIVED, NOT LISTED: the cards are every card whose printed text says "a
 * copy of me" AND that a unit in play can lend (a triggered or activated
 * ability that is not zone text). Each must have a scenario below; a new card
 * that joins the class fails the coverage test until it gets one.
 *
 * Seeds 58700-58799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import type { Seat } from '../src/types.ts';
import { finishBattle, giveResources, pass, spawn, toDeployment, toNextBattle, unitsOf, withE } from './util.ts';

/** the copy-of-me cards an adjacent Ancient One can borrow from, read off the pool */
function copyOfMeCards(): string[] {
  return allCardNames().filter(n => {
    const d = getCard(n);
    if (!/\bcopy of me\b/i.test(d.text ?? '')) return false;
    return [...d.abilities ?? [], ...d.augmentText ?? []]
      .some(ab => (ab.type === 'activated' || !ab.zone) && (ab.effect.creates ?? []).includes(n));
  }).sort();
}

const tokens = (h: Harness, seat: Seat, name: string): number =>
  unitsOf(h, seat).filter(u => u.token && u.card === name).length;

/** one scenario per card: an Ancient One beside it, the ability borrowed and
 * resolved; returns the attacker */
const SCENARIOS: Record<string, (h: Harness) => Seat> = {
  'Echo of Despair': h => {
    toDeployment(h);
    const A = h.state.initiative;
    const echo = spawn(h, A, 'Echo of Despair');
    const ancient = spawn(h, A, 'Ancient One');
    toNextBattle(h, A);
    h.do({ type: 'declareAttack', seat: A, columns: [[echo], [ancient]] });
    finishBattle(h);                                  // unblocked: the defender loses life
    assert.equal(tokens(h, A, 'Echo of Despair'), 1, 'the Echo copies itself');
    return A;
  },
  'Hooba-God': h => {
    toDeployment(h);
    const A = h.state.initiative;
    const god = spawn(h, A, 'Hooba-God');
    const ancient = spawn(h, A, 'Ancient One');
    toNextBattle(h, A);
    h.do({ type: 'declareAttack', seat: A, columns: [[god], [ancient]] });
    finishBattle(h);                                  // each slot question takes its first answer
    assert.equal(tokens(h, A, 'Hooba-God'), 1, 'the Hooba-God copies itself');
    return A;
  },
  'Swarmling': h => {
    toDeployment(h);
    const A = h.state.initiative;
    const swarm = spawn(h, A, 'Swarmling');
    const ancient = spawn(h, A, 'Ancient One');
    spawn(h, (1 - A) as Seat, 'Unit Token');
    toNextBattle(h, A);
    h.do({ type: 'declareAttack', seat: A, columns: [[swarm], [ancient]] });
    giveResources(h, A, 'wood', 4);
    withE(h, e => { e.player(A).hand.push('Overwhelm'); e.discardFromHand(A, e.player(A).hand.length - 1); });
    // "you may pay [1]": take the first answer (pay) every time it is asked
    for (let guard = 40; (h.state.stack.length || h.state.decision) && guard-- > 0;) {
      const d = h.state.decision;
      if (d) h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
      else pass(h);
    }
    assert.equal(tokens(h, A, 'Swarmling'), 1, 'the Swarmling copies itself');
    finishBattle(h);
    return A;
  },
};

test('CR 710.7a / report 270: every borrowable copy-of-me card has a scenario here', () => {
  const cards = copyOfMeCards();
  assert.ok(cards.includes('Echo of Despair'), 'the sweep finds the reported card');
  assert.deepEqual(cards, Object.keys(SCENARIOS).sort(),
    'a card whose printed text makes "a copy of me" joined or left the pool — give it a scenario');
});

for (const name of Object.keys(SCENARIOS)) {
  test(`CR 710.5, 710.7a / report 270: an Ancient One borrowing ${name} copies itself, not ${name}`, () => {
    const h = new Harness(58700 + Object.keys(SCENARIOS).indexOf(name));
    const A = SCENARIOS[name]!(h);
    assert.equal(tokens(h, A, 'Ancient One'), 1,
      `the Ancient One's borrowed "${name}" text made a copy of the Ancient One (the designer: "3 Ancient Ones are created")`);
  });
}

test('CR 710.5 / report 270: three Echoes beside an Ancient One make three Ancient Ones (the designer)', () => {
  const h = new Harness(58710);
  toDeployment(h);
  const A = h.state.initiative;
  const e1 = spawn(h, A, 'Echo of Despair');
  const ancient = spawn(h, A, 'Ancient One');
  const e2 = spawn(h, A, 'Echo of Despair');
  const e3 = spawn(h, A, 'Echo of Despair');
  toNextBattle(h, A);
  // the Ancient One in front of the third Echo: three neighbours, two beside and one behind
  h.do({ type: 'declareAttack', seat: A, columns: [[e1], [ancient, e3], [e2]] });
  finishBattle(h);
  assert.equal(tokens(h, A, 'Ancient One'), 3, '"3 Ancient Ones are created"');
  assert.equal(tokens(h, A, 'Echo of Despair'), 3, 'and each Echo copies itself');
});
