/**
 * "ERASE ME" — the six cards that print a self-erase, and the two mechanisms
 * that honour it. CARD-TODO #15. Seeds 8900-8999.
 *
 * WHAT WAS WRONG
 *
 * Four of the six printed the clause and did nothing about it: Collect Remains
 * ("Put target card in a bin into your hand. Erase me."), Temporal Rift ("End
 * this battle. Erase this spell."), Suspend ("… Erase me.") and Skybreaker
 * ("[Augment] Erase me: Negate all spell effects."). Each had real, working
 * code for its OTHER half, which is exactly why nothing caught it — the shape
 * sweep in 71-card-ledger saw live code and the drill saw the card do
 * something. It was not cosmetic: the erased pile is the zone cards leave the
 * game through (R65), so a spell that should erase itself instead landed in
 * the bin, stayed recurrable, and kept counting toward every "cards in your
 * bin" effect and every "erase X cards from your bin" cost. Collect Remains
 * was the worst of them, being itself a bin-recursion spell.
 *
 * THE TWO MECHANISMS, because the four cards are not one class
 *
 *   SPELLS (Collect Remains, Suspend, Temporal Rift) — a resolving spell is
 *   disposed of by `E.dischargeItem` AFTER its effect has run, so a self-erase
 *   cannot erase a card that is still on the stack; it has to REDIRECT that
 *   disposal. `ctx.eraseSelf()` raises `StackItem.eraseSelf` while the effect
 *   resolves and `dischargeItem` reads it, sending the card to the erased pile
 *   instead of the bin. The flag lives on the ITEM, in GameState, because the
 *   game is `seed + actions` and a resolution can suspend and be replayed.
 *
 *   A UNIT IN PLAY (Skybreaker) — there "Erase me:" is an activation COST, so
 *   it is paid on the way to the stack like any other: `AbilityCost.eraseSelf`,
 *   charged by `E.payActivationCost` through `E.eraseFromPlay`. It used to be
 *   `sacrificeSelf`, which is a real divergence — a sacrifice is a DEATH, so
 *   the card reached a bin, fired death triggers and could be recurred.
 *   (Spore of Regenesis, which already worked, is the same reading of the same
 *   clause one zone over: erasing itself out of the bin as a cost.)
 *
 * HOW THESE TESTS ARE WRITTEN
 *
 * Every one drives the real action path — `playCard` / `activateAbility` /
 * `augment` through `apply()`, with priority passed and decisions answered —
 * and asserts on the engine's own EVENT VOCABULARY (`erased`) and on STATE
 * (absent from every bin, present in `E.erased(seat)`). Never on log prose: a
 * prose-matching test gets deleted the first time somebody improves a
 * sentence. There is no `{ todo: true }` anywhere in this file, deliberately —
 * a todo test can never fail, and that is how this whole class survived two
 * playtest reports and a conceded game while the suite looked green.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { apply } from '../src/apply.ts';
import type { EngineEvent, GameState, Seat, StackItem } from '../src/types.ts';
import {
  ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle,
} from './util.ts';

// ── helpers ──────────────────────────────────────────────────────────────

const binOf = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.bin;
const erasedOf = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.erased ?? [];
const count = (xs: string[], n: string): number => xs.filter(c => c === n).length;

/** every `erased` event that NAMES this card, by either shape the event
 * vocabulary uses: `data.card` (one card) or `data.cards` (a pile). This is
 * the same pair `E.ev` reads to keep R65's public erased pile, so anything
 * that reaches the pile is visible here and vice versa. */
function erasedEvents(h: Harness, name: string): EngineEvent[] {
  return h.events.filter(ev => {
    if (ev.type !== 'erased') return false;
    const d = ev.data ?? {};
    const many = Array.isArray(d['cards']) ? d['cards'] as string[] : [];
    return d['card'] === name || many.includes(name);
  });
}

/**
 * The whole claim about one self-erasing card, asserted the same way each
 * time: it is in NOBODY's bin, it is in exactly one player's erased pile
 * exactly once, and exactly one `erased` event announced it.
 *
 * "No bin" is checked on both seats on purpose. A card belongs to its owner
 * (R65), so a bug that binned it to the wrong side would still be a bug, and
 * asserting only on the caster's bin would not see it.
 */
function erasedNotBinned(h: Harness, seat: Seat, name: string): void {
  assert.equal(count(binOf(h, 0), name), 0, `${name} must not be in seat 0's bin`);
  assert.equal(count(binOf(h, 1), name), 0, `${name} must not be in seat 1's bin`);
  assert.equal(count(erasedOf(h, seat), name), 1,
    `${name} must be in ${seat}'s erased pile exactly once`);
  assert.equal(erasedEvents(h, name).length, 1,
    `exactly one 'erased' event must name ${name}`);
}

/** a live attack window with one vanilla attacker (the 67-* pattern) */
function attackWindow(seed: number): { h: Harness; A: Seat; D: Seat; atk: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');            // 3/3, no attrs, no triggers
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.equal(h.state.decision, null, 'a vanilla attacker asks nothing');
  return { h, A, D, atk };
}

/** answer the pending targets decision by the option LABEL (bin picks are
 * offered as card names, and a BinRef is not worth hand-building) */
function pickLabel(h: Harness, startsWith: string): void {
  const dec = h.state.decision!;
  const i = dec.options.findIndex(o => String(o.label).startsWith(startsWith));
  assert.notEqual(i, -1,
    `no option starting "${startsWith}" in [${dec.options.map(o => o.label)}]`);
  h.do({ type: 'decide', seat: dec.seat, choice: i });
}

const onStack = (h: Harness, card: string): StackItem | undefined =>
  h.state.stack.find(i => i.card === card);

/** pass priority until the stack has drained. Two passes are not always
 * enough: a virus augmented onto a spell rides the stack as its own item and
 * resolves first, and a resolution can push triggers behind it. Decisions
 * raised on the way (a Glimpse) are answered with the first option — the
 * tests here never care WHICH card was glimpsed, only where the spell went. */
function drain(h: Harness, guard = 40): void {
  while (h.state.phase === 'battle' && (h.state.stack.length || h.state.decision) && guard-- > 0) {
    const dec = h.state.decision;
    if (dec) {
      h.do({ type: 'decide', seat: dec.seat,
        choice: dec.kind === 'orderTriggers' ? dec.options.map((_, i) => i) : 0 });
      continue;
    }
    pass(h);
  }
  assert.ok(guard > 0, 'the stack never drained');
}

// ── Collect Remains — the card the todo said to do first ─────────────────

test('Collect Remains: it takes the bin card AND leaves the game, instead of joining the bin it just robbed', () => {
  const { h, A, D } = attackWindow(8901);
  giveResources(h, A, 'dark', 2);                     // dd/2
  binOf(h, D).push('Good Whale');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Collect Remains') });
  pickLabel(h, 'Good Whale');                         // R64: targeted at cast
  pass(h); pass(h);

  // the OTHER half still happens — the erase is a second sentence, not a
  // replacement for the first
  assert.ok(h.state.players[A]!.hand.includes('Good Whale'), "the enemy's card is in my hand");
  assert.equal(count(binOf(h, D), 'Good Whale'), 0, 'and out of their bin');
  // …and the spell itself is gone from the game
  erasedNotBinned(h, A, 'Collect Remains');
  finishBattle(h);
});

test('Collect Remains: having erased itself, it is not there for the next copy to recur', () => {
  // The consequence that made this a MAJOR item rather than a cosmetic one:
  // the printed card cannot be fished back out of the bin by a second copy,
  // and while it was binned it could be, forever.
  const { h, A, D } = attackWindow(8902);
  giveResources(h, A, 'dark', 4);                     // two casts at dd/2
  // TWO cards in the bin, so that the second cast has a legal target that is
  // not the first Collect Remains — otherwise the cast is refused for having
  // no target at all and the menu assertion below would never be reached.
  binOf(h, D).push('Good Whale', 'Curio Drifter');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Collect Remains') });
  pickLabel(h, 'Good Whale');
  pass(h); pass(h);
  assert.equal(count(binOf(h, A), 'Collect Remains'), 0);

  // cast a second copy: the first is not on the menu, because it is not in a
  // bin to be targeted
  while (h.state.priority !== A) pass(h);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Collect Remains') });
  const menu = h.state.decision!.options.map(o => String(o.label));
  assert.ok(!menu.some(l => l.startsWith('Collect Remains')),
    `an erased card is not a legal "target card in a bin"; menu was [${menu}]`);
  assert.ok(menu.length > 0, 'and there is still something else to take, so this is a real menu');
  h.do({ type: 'decide', seat: h.state.decision!.seat, choice: 0 });
  drain(h);
  assert.equal(count(erasedOf(h, A), 'Collect Remains'), 2, 'both copies erased themselves');
  assert.equal(count(binOf(h, A), 'Collect Remains'), 0, 'and neither is in a bin');
  finishBattle(h);
});

// ── Suspend ──────────────────────────────────────────────────────────────

test('Suspend: the life lock lands for the battle and the spell erases itself on the way out', () => {
  const { h, A, D } = attackWindow(8903);
  giveResources(h, A, 'light', 2);                    // ll/2
  const lifeD = h.state.players[D]!.life;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Suspend') });
  pick(h, { player: D });
  pass(h); pass(h);

  // the OTHER half (R104's replacement layer) still works
  const g = new E(h.state);
  g.loseLife(D, 7, 'test');
  assert.equal(g.s.players[D]!.life, lifeD, "the target's life total can't change");
  // and the spell is out of the game rather than sitting in a bin, recurrable
  erasedNotBinned(h, A, 'Suspend');
  finishBattle(h);
});

// ── Temporal Rift — the ordering case ────────────────────────────────────

test('Temporal Rift: ending the battle does not carry off its own disposal — it still erases itself', () => {
  // The ordering worry, settled by measurement: the Rift's effect negates the
  // whole stack and then ends the battle, which in round 1 with no sent
  // counterattackers cascades straight through round 2 into deployment. Its
  // OWN item is not on the stack while that happens (resolveTop popped it), so
  // neither the negate sweep nor endBattleRound can dispose of it, and
  // afterParts → dischargeItem runs after the cascade with the flag already up.
  const h = new Harness(8904);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, D, 'water', 2);
  giveResources(h, D, 'metal', 2);                    // bmm/4
  giveResources(h, A, 'fire', 2);                     // Luminous Arc r/2, the victim
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const whale = spawn(h, D, 'Good Whale');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: whale });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Temporal Rift') });
  pass(h); pass(h);

  // the OTHER half: everything negated, the battle over, the cascade run
  assert.equal(h.state.stack.length, 0, 'the stack is wiped');
  assert.equal(h.state.battle, null, 'the battle is over');
  assert.equal(h.state.phase, 'deploy', 'and it cascaded through round 2 into deployment');
  assert.ok(ent(h, whale), 'the negated Arc never dealt its damage');
  // R68 is unchanged: what the Rift NEGATES is binned, exactly once
  assert.equal(count(binOf(h, A), 'Luminous Arc'), 1, 'the negated Arc is binned once');
  // and the Rift itself took the other exit
  erasedNotBinned(h, D, 'Temporal Rift');
});

// ── Skybreaker — the odd one out: a COST, not a disposal ─────────────────

test('Skybreaker: "Erase me" is paid as the activation cost, and an erase is not a death', () => {
  const h = new Harness(8905);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const sky = spawn(h, D, 'Skybreaker');              // [Augment] text is live when played normally
  giveResources(h, A, 'fire', 3);                    // Channeled Boon r/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: atk });                            // +4/+4 unless negated

  // the new cost kind must not fall out of the legality layer: an ability
  // whose cost `canPayAbilityCost` does not recognise would simply stop being
  // offered, and the card would be dead in a different way
  assert.ok(h.legal(D).some(a => a.type === 'activateAbility' && a.entityId === sky),
    'the ability is still OFFERED with an eraseSelf cost');

  const before = h.events.length;
  h.do({ type: 'activateAbility', seat: D, entityId: sky, abilityIndex: 0, via: 'augment' });
  // the cost is paid on the way to the stack, before anybody may respond
  assert.ok(!ent(h, sky), 'Skybreaker left play as the cost');
  erasedNotBinned(h, D, 'Skybreaker');
  // AN ERASE IS NOT A DEATH — this is the whole difference from the
  // `sacrificeSelf` stand-in it replaced, and it is what makes the card
  // unrecurrable. R40 cannot reach it either: nothing entered a bin to trash.
  //
  // ⚠ NARROWED BY R172 (2026-08-25). This assertion used to include
  // `'despawned'` and expect the empty list. That was the engine's silence,
  // not a ruling: R157 §3 says an erase is *"not a death, but it IS a
  // despawn"*, and `E.eraseFromPlay` now fires one — see
  // 145-erase-routes.test.ts. The two halves R157 §3 actually states are
  // still pinned here, and they are the halves this test was about.
  const since = h.events.slice(before);
  assert.deepEqual(
    since.filter(ev => (ev.type === 'died' || ev.type === 'trashed')
      && ev.data?.['card'] === 'Skybreaker'),
    [], 'no death and no trash — an erase is neither of those');
  assert.equal(
    since.filter(ev => ev.type === 'despawned' && ev.data?.['card'] === 'Skybreaker').length, 1,
    'but it IS a despawn, and fires exactly one (R157 §3 / R172)');

  pass(h); pass(h);                                  // the ability resolves
  assert.equal(h.state.stack.length, 0, 'R68: the negated Boon left the stack at once');
  assert.ok(binOf(h, A).includes('Channeled Boon'), 'the negated spell is binned as usual');
  finishBattle(h);
});

test('Skybreaker donated as a Virus: "me" is the HOST, so the host is what leaves the game', () => {
  // The [Augment] reading the batch header states: donated, "me" is the host.
  // An erase takes the host's mods with it, so the Virus goes too — and both
  // reach the public pile rather than either bin.
  const h = new Harness(8906);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const host = spawn(h, D, 'Good Whale');
  const e = new E(h.state);
  e.attachMod(e.entity(host)!, 'Skybreaker', D, 'augment');
  e.settle();
  h.state = e.s;
  assert.equal(ent(h, host)!.mods.length, 1, 'the Virus is attached');
  const mod = ent(h, host)!.mods[0]!;

  const before = h.events.length;
  // `via: { mod }` is how a DONATED [Augment] ability is activated — `via:
  // 'augment'` would read the host's own text box, which Good Whale has not got
  h.do({ type: 'activateAbility', seat: D, entityId: host, abilityIndex: 0, via: { mod } });
  assert.ok(!ent(h, host), 'the HOST is what "Erase me" erases');
  assert.equal(count(binOf(h, D), 'Good Whale'), 0, 'no bin for the host');
  assert.equal(count(binOf(h, D), 'Skybreaker'), 0, 'and none for the Virus riding it');
  assert.equal(count(erasedOf(h, D), 'Good Whale'), 1, 'the host is in the erased pile');
  assert.equal(count(erasedOf(h, D), 'Skybreaker'), 1, 'and so is the mod that left with it');
  assert.deepEqual(
    h.events.slice(before).filter(ev => ev.type === 'died' && ev.data?.['card'] === 'Good Whale'),
    [], 'the host did not die — nothing may trigger off this');
});

// ── NEGATION: the ruling, pinned ─────────────────────────────────────────

test('a NEGATED self-erase spell is binned, not erased — the effect it was printed in never happened', () => {
  // THE RULING. R68: a negated effect does nothing, and "Erase me." is a
  // sentence of the effect — so it is not owed. Mechanically this is not a
  // special case anywhere: the flag is raised by `run()`, a negated item never
  // runs its parts, so `dischargeItem` finds nothing raised and takes the bin
  // branch it always took.
  //
  // The contrast that shows this is a decision and not an accident is R79's
  // {Unstable}, one branch up in the same function: a virus-carrying spell IS
  // erased on negation, because Unstable is a stamp on the CARD rather than an
  // instruction in the effect. The next test asserts that half.
  const { h, A, D } = attackWindow(8907);
  giveResources(h, A, 'dark', 2);                     // Collect Remains dd/2
  giveResources(h, D, 'water', 1);
  giveResources(h, D, 'metal', 1);                    // Dematerialize bm/2
  binOf(h, D).push('Good Whale');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Collect Remains') });
  pickLabel(h, 'Good Whale');
  const victim = onStack(h, 'Collect Remains')!;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Dematerialize') });
  pick(h, { stack: victim.id });
  drain(h);       // Dematerialize resolves, negates, and Glimpses 3 (a decision)

  assert.ok(!h.state.players[A]!.hand.includes('Good Whale'), 'the negated spell did nothing');
  assert.equal(count(binOf(h, A), 'Collect Remains'), 1,
    'a negated "Erase me" spell goes to the bin like any other negated card (R68)');
  assert.equal(count(erasedOf(h, A), 'Collect Remains'), 0, 'and NOT to the erased pile');
  assert.deepEqual(erasedEvents(h, 'Collect Remains'), [], 'nothing announced an erase');
  finishBattle(h);
});

test('a FIZZLED self-erase spell is binned too — its target went, so its text never ran', () => {
  // R5's other half of the same ruling, and it is reachable with nothing but
  // legal actions: two Collect Remains aimed at the SAME bin card. The second
  // one cast resolves first (LIFO) and takes the card; the first then has no
  // surviving target, fizzles, and — having never run — is binned.
  const { h, A, D } = attackWindow(8908);
  giveResources(h, A, 'dark', 4);
  binOf(h, D).push('Good Whale');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Collect Remains') });
  pickLabel(h, 'Good Whale');
  while (h.state.priority !== A) pass(h);             // back round to the caster
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Collect Remains') });
  pickLabel(h, 'Good Whale');
  assert.equal(h.state.stack.length, 2, 'both copies are waiting, aimed at the same card');
  drain(h);                                           // top resolves, bottom fizzles

  assert.ok(h.state.players[A]!.hand.includes('Good Whale'), 'one copy got the card');
  assert.equal(count(erasedOf(h, A), 'Collect Remains'), 1, 'the copy that RESOLVED erased itself');
  assert.equal(count(binOf(h, A), 'Collect Remains'), 1, 'the copy that FIZZLED was binned');
  finishBattle(h);
});

// ── the virus / {Unstable} interaction ───────────────────────────────────

test('a virus rides a self-erasing spell: it is erased ONCE, announced as Unstable, with the virus alongside', () => {
  // R79 and "Erase me" want the same destination, so the risk here is not the
  // outcome but the BOOKKEEPING: two branches both firing would double-log and
  // push the card to the public pile twice. They are exclusive, and Unstable
  // is announced, because Unstable is the stronger fact — it would have erased
  // the card even if the spell had been negated.
  const { h, A, D } = attackWindow(8909);
  giveResources(h, A, 'dark', 2);                     // Collect Remains dd/2
  giveResources(h, D, 'earth', 2);                    // Chitin Shredder ee/2, a Virus
  binOf(h, D).push('Good Whale');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Collect Remains') });
  pickLabel(h, 'Good Whale');
  const item = onStack(h, 'Collect Remains')!;
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Chitin Shredder'), hostStack: item.id });
  drain(h);       // the virus item resolves onto the spell, then the spell resolves

  assert.ok(h.state.players[A]!.hand.includes('Good Whale'), 'the spell still resolved');
  // ONE erase of the card, one entry in the pile — not two of either
  erasedNotBinned(h, A, 'Collect Remains');
  // the virus is its APPLIER's card, so it reaches THEIR pile (R65), never a bin
  assert.equal(count(erasedOf(h, D), 'Chitin Shredder'), 1, "the virus goes to its owner's pile");
  assert.equal(count(binOf(h, D), 'Chitin Shredder'), 0, 'and to no bin');
  finishBattle(h);
});

// ── serialisation & replay ───────────────────────────────────────────────

test('the erase survives a save/load: a spell mid-flight is serialised and still erases itself', () => {
  // The flag lives on the StackItem, inside GameState, precisely so that this
  // holds. A flag parked anywhere else — a field on the engine, a module-level
  // set, a closure over the cast — would be gone the moment a game was saved,
  // sent over the wire, or rolled back and replayed by a mid-resolution
  // suspension (R85), and the card would silently go back to binning itself.
  //
  // So this drives the spell onto the stack, ROUND-TRIPS THE WHOLE STATE
  // THROUGH JSON — which is exactly what a saved game and a server message
  // both are — and finishes the game from the deserialised copy. Nothing that
  // did not survive `JSON.parse(JSON.stringify(state))` is available to it.
  const { h, A, D } = attackWindow(8910);
  giveResources(h, A, 'dark', 2);
  binOf(h, D).push('Good Whale');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Collect Remains') });
  pickLabel(h, 'Good Whale');
  assert.ok(onStack(h, 'Collect Remains'), 'it is waiting on the stack, targeted');

  const wire = JSON.parse(JSON.stringify(h.state)) as GameState;
  assert.notEqual(wire, h.state, 'a genuinely separate object');
  let s: GameState = wire;
  for (let i = 0; i < 10 && s.stack.length; i++) {
    s = apply(s, { type: 'passPriority', seat: s.priority! }).state;
  }

  assert.equal(s.stack.length, 0, 'the reloaded game resolved it');
  assert.ok(s.players[A]!.hand.includes('Good Whale'), 'and it did its other half');
  assert.equal(count(s.players[A]!.bin, 'Collect Remains'), 0, 'no bin, after a full save/load');
  assert.equal(count(s.players[A]!.erased ?? [], 'Collect Remains'), 1, 'the erased pile');
  // and nothing is left holding a raised flag once the item has been discharged
  assert.ok(!s.stack.some(it => it.eraseSelf), 'no stale flag on the stack');
});

// ── the class is closed ──────────────────────────────────────────────────

test('every card in the pool that prints a self-erase reaches the erased pile in a real game', () => {
  // 84-card-semantics asserts the CODE-level version of this (nobody prints
  // the clause without an erase anywhere in their run or their costs). This is
  // the behavioural counterpart for the four that CARD-TODO #15 named, so a
  // change that keeps the word "erase" in the source while breaking the wiring
  // — the seam renamed, the flag never read, dischargeItem's branch reordered
  // — fails here even though the source scan is satisfied.
  //
  // The other two, Spore of Regenesis and Zephyrzoa, are covered where they
  // live (43-* and 46-*): both erase from a zone rather than through the stack
  // and neither shares a line of this machinery.
  const seen: string[] = [];
  for (const [seed, run] of [
    [8920, (h: Harness, A: Seat, D: Seat) => {
      giveResources(h, A, 'dark', 2); binOf(h, D).push('Good Whale');
      h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Collect Remains') });
      pickLabel(h, 'Good Whale'); pass(h); pass(h);
      return 'Collect Remains';
    }],
    [8921, (h: Harness, A: Seat, D: Seat) => {
      giveResources(h, A, 'light', 2);
      h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Suspend') });
      pick(h, { player: D }); pass(h); pass(h);
      return 'Suspend';
    }],
    [8922, (h: Harness, A: Seat, _D: Seat) => {
      giveResources(h, A, 'water', 2); giveResources(h, A, 'metal', 2);
      h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Temporal Rift') });
      pass(h); pass(h);
      return 'Temporal Rift';
    }],
  ] as [number, (h: Harness, A: Seat, D: Seat) => string][]) {
    const { h, A, D } = attackWindow(seed);
    const name = run(h, A, D);
    erasedNotBinned(h, A, name);
    seen.push(name);
  }
  assert.deepEqual(seen.sort(), ['Collect Remains', 'Suspend', 'Temporal Rift'],
    'all three spell-side self-erasers were driven');
});
