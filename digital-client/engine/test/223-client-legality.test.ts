/* R245 — WHERE THE CLIENT AND THE ENGINE DISAGREE ABOUT WHAT IS LEGAL.
 *
 * Three reports from 2026-08-28/29, from two rooms that both replay FAITHFUL
 * at HEAD (VYTV 265/265, DSVQ 174/174). A faithful replay is the evidence: the
 * engine was right at every action, so anything the players saw that the rules
 * do not allow was the CLIENT's own model of legality, and the player is the
 * one who found out.
 *
 *  [127] "why is Rashi able to attack like this? She did not do
 *        counterattackers (just Thoughtripper) but is able to attack with all
 *        her things" — narrowed by the owner 37 seconds later ([128]):
 *        "disregard the last report as an engine bug, it's just a UI bug. She
 *        seemed to be able to attack with the other things, but it didn't let
 *        her."
 *  [122] "I'm getting random 'errors' in the top about not being in the haste
 *        step." Nobody clicked anything: `runAutoPass` generated the refused
 *        `doneHaste` itself.
 *  [123] "Pass All still isn't working right." THE THIRD VISIT (#68 → #123).
 *
 * ── THE ONE SHAPE
 * All three are a client-side answer to a question the engine already answers,
 * kept in a second place and allowed to drift:
 *
 *   #127  "may this unit join the declaration"   vs  apply.ts validFormation
 *   #122  "has my automatic answer been taken"   vs  the server's own state
 *   #123  "what has changed since I last looked" vs  one action type out of six
 *
 * ── HOW THIS FILE MEASURES THAT (docs/13-assessment.md §7.2)
 * §1 never states the attack rule. It SWEEPS every unit the seat controls,
 * asks the ENGINE whether it would take a declaration built out of that unit,
 * and requires the client's affordance to name exactly the set that comes
 * back — so a rule the engine grows tomorrow is covered tonight, and a client
 * that offers what the engine refuses fails by name. §3 does the same to the
 * Pass-all release list: the option set is derived by exclusion and the
 * exclusions are asserted against a real legal list, not typed out.
 *
 * §2 drives the real client over the real wire (test/ui-driver.ts) rather than
 * asserting anything about ui/main.ts as source text — the house rule, and the
 * reason two tests broke on a pure refactor in round 30.
 *
 * Seeds 22300-22399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { apply, legalActions, IllegalAction } from '../src/apply.ts';
import { optionKeys } from '../ui/inspect.ts';
import type { AutoPassArm } from '../ui/inspect.ts';
import {
  armSnapshot, attackFrom, canJoinFormation, formationCandidates, inPassWindow, passAllRelease,
} from '../ui/battle.ts';
import { giveResources, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import { client } from './ui-driver.ts';
import type { Action, EntityId, GameState, Seat } from '../src/types.ts';

/** the six elements, so a fixture can be given mana without naming one */
const ELEMENTS = ['fire', 'water', 'wood', 'metal', 'dark', 'light'] as const;

/** the real client, driven — see test/ui-driver.ts */
const ui = await client();

/** would the engine take this action? The verdict only — the draft is thrown
 * away, so this can be asked of a dozen candidates against one board. */
function engineTakes(s: GameState, a: Action): boolean {
  try { apply(structuredClone(s), a); return true; }
  catch (err) { if (err instanceof IllegalAction) return false; throw err; }
}

/** every unit `seat` controls anywhere, in id order — the set the client's
 * affordance is chosen OUT of, so the sweep has to cover all of it */
const unitsOf = (s: GameState, seat: Seat): EntityId[] =>
  Object.values(s.entities).filter(e => e.kind === 'unit' && e.controller === seat)
    .map(e => e.id).sort((x, y) => x - y);

/** the class attribute of the board tag carrying `data-id="<id>"` */
function classOfUnit(html: string, id: EntityId): string {
  const m = new RegExp(`<[^>]*data-id="${id}"[^>]*>`).exec(html);
  assert.ok(m, `entity ${id} is not on screen at all`);
  return (/class="([^"]*)"/.exec(m[0]) ?? ['', ''])[1]!;
}

/* ══ §1 [127] the units a declaration may be built out of ═══════════════ */

/**
 * DSVQ's shape, exactly: a round-1 battle in which the defender blocks and
 * sends ONE counterattacker, so round 2 opens with them as the attacker and
 * `attackerPool` naming that one unit — while the rest of their army is still
 * standing at home, one region away from the attack.
 */
function roundTwoCounterattack(seed: number): { h: Harness; D: Seat; sent: EntityId[]; home: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  // TWO counterattackers on purpose: with exactly one the client prefills it
  // into a column (main.ts, the round-2 single-counterattacker prefill), which
  // would hide the affordance this section is about behind a helping hand.
  const sent = [spawn(h, D, 'Conduit of Pain'), spawn(h, D, 'Rune Channeler')];
  const home = [spawn(h, D, 'Good Whale'), spawn(h, D, 'Curio Drifter')];
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [...sent] });
  while (h.state.phase === 'battle' && h.state.battle!.round === 1) {
    if (h.state.decision) {
      const dec = h.state.decision;
      h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
    } else if (h.state.priority !== null) pass(h);
    else break;
  }
  assert.equal(h.state.phase, 'battle', 'the fixture reached round 2');
  assert.equal(h.state.battle!.round, 2);
  assert.equal(h.state.battle!.attacker, D, 'the counterattacker is the round-2 attacker');
  assert.deepEqual([...h.state.battle!.attackerPool!].sort(), [...sent].sort(),
    'only the sent units may counterattack');
  return { h, D, sent, home };
}

test('[127] the attack affordance names exactly the units the engine would take', () => {
  const { h, D, sent, home } = roundTwoCounterattack(22300);
  const s = h.state;

  // DERIVED, never enumerated: the client's set is checked against the ENGINE's
  // own verdict on a one-unit declaration, unit by unit, over everything the
  // seat controls. Nothing here restates a region rule or a pool rule.
  const engineWould = unitsOf(s, D)
    .filter(id => engineTakes(s, { type: 'declareAttack', seat: D, columns: [[id]] }));
  assert.deepEqual(formationCandidates(s, D), engineWould,
    '[127] every unit the client offers is one the engine accepts, and no other');

  // the positive control: the sweep is not vacuously agreeing about an empty
  // board. There is something to offer, and something the report was about.
  assert.deepEqual(engineWould, [...sent].sort((x, y) => x - y),
    'the sent counterattackers, and only them');
  for (const id of home) {
    assert.equal(canJoinFormation(s, id), false,
      `[127] the unit at home (${id}) must not be pickupable for the counterattack`);
  }
});

test('[127] a unit the engine would refuse is not ringed and does not pick up on a click', () => {
  const { h, D, sent, home } = roundTwoCounterattack(22301);
  const legal = legalActions(h.state, D);
  ui.join(h.state, D, legal);

  const ineligible = home[0]!, eligible = sent[0]!;
  assert.match(classOfUnit(ui.html(), eligible), /\bplayable\b/,
    'the unit that CAN counterattack still wears the ring');
  assert.doesNotMatch(classOfUnit(ui.html(), ineligible), /\bplayable\b/,
    '[127] "she seemed to be able to attack with the other things" — she must not seem to');

  ui.click({ act: 'unit', id: String(ineligible) });
  assert.doesNotMatch(classOfUnit(ui.html(), ineligible), /\bcarrying\b/,
    '[127] and clicking it does not pick it up into a column either');
  ui.click({ act: 'unit', id: String(eligible) });
  assert.match(classOfUnit(ui.html(), eligible), /\bcarrying\b/,
    'the positive control: the eligible unit still picks up on the same click');
  ui.sent();
});

test('[127] the block step is the same question, asked of the defender', () => {
  const h = new Harness(22302);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  spawn(h, D, 'Conduit of Pain');
  spawn(h, D, 'Rune Channeler');
  // …and one of the defender's units standing somewhere else. A defender's
  // home region IS the battle region in round 1, so without this the fixture
  // has nothing for the region clause to exclude and would agree with a client
  // that had no region clause at all (measured: it did).
  const away = spawn(h, D, 'Curio Drifter');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'blocks');
  const s = h.state;
  s.entities[away]!.region = new E(s).homeRegion(A);
  assert.notEqual(s.entities[away]!.region, s.battle!.region,
    'positive control: it really is in another region');
  // "may this unit be picked up" is either role the declaration has for it —
  // a blocker or a counterattacker. The engine answers both; the client's
  // affordance must be their union and nothing wider.
  const engineWould = unitsOf(s, D).filter(id =>
    engineTakes(s, { type: 'declareBlocks', seat: D, blocks: { 0: [id] }, send: [] })
    || engineTakes(s, { type: 'declareBlocks', seat: D, blocks: {}, send: [id] }));
  assert.deepEqual(formationCandidates(s, D), engineWould);
  assert.ok(engineWould.length >= 2, 'positive control: there is a real block to build');
});

test('[127] the region a formation leaves from has one derivation, not three', () => {
  const { h, D, sent } = roundTwoCounterattack(22303);
  const s = h.state;
  // attackFrom IS doDeclareAttack's fromRegion — measured against the engine
  // rather than restated: the sent unit is standing in it, by construction.
  assert.equal(attackFrom(s), s.entities[sent[0]!]!.region,
    'a counterattack leaves from the region it is already standing in');
  assert.notEqual(attackFrom(s), new E(s).homeRegion(D),
    'positive control: round 2 does NOT leave from home, or this proves nothing');
});

/* ══ §2 [122] the client must not answer twice for one unanswered send ══ */

/** a planning state parked in the open haste step, as the server serves it:
 * `hasteDone` false for me, the opponent's entry redacted (server/view.ts). */
function hasteStep(seed: number, seat: Seat): GameState {
  const h = new Harness(seed);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone, 'the haste step is open');
  assert.equal(h.state.hasteDone![seat], false);
  return h.state;
}

test('[122] one automatic doneHaste per unanswered send, however many states arrive', () => {
  const seat: Seat = 0;
  const s = hasteStep(22310, seat);
  const legal: Action[] = [{ type: 'doneHaste', seat }];
  ui.join(s, seat, legal);
  assert.deepEqual(ui.actions(), [{ type: 'doneHaste', seat }],
    'the first automatic answer goes out — it is legal by construction');

  // The haste step is a HIDDEN SIMULTANEOUS SEGMENT, so every action the
  // OPPONENT takes pushes this seat a fresh actionCount with its own half of
  // the board frozen — and my own doneHaste is in none of them, because it is
  // still on the wire or parked (rooms.ts arrivalVerdict). This is exactly the
  // state that used to earn a second send, and the refusals that followed are
  // report #122.
  for (let i = 1; i <= 3; i++) {
    const later = structuredClone(s);
    later.actionCount += i;
    ui.update(later, legal);
  }
  assert.deepEqual(ui.actions(), [],
    '[122] a new actionCount is not an answer to my send — nothing more goes out');
});

test('[122] the latch comes down when the SERVER says the answer landed', () => {
  const seat: Seat = 0;
  const s = hasteStep(22311, seat);
  const legal: Action[] = [{ type: 'doneHaste', seat }];
  ui.join(s, seat, legal);
  assert.equal(ui.actions().length, 1);

  const taken = structuredClone(s);
  taken.actionCount += 1;
  taken.hasteDone![seat] = true;
  ui.update(taken, []);
  assert.deepEqual(ui.actions(), [], 'nothing to answer once the server records it');

  // a LATER haste step (the next turn) is answered again — the latch is about
  // an outstanding send, not about the game having had one haste step already
  const next = hasteStep(22312, seat);
  next.actionCount = taken.actionCount + 10;
  ui.update(next, legal);
  assert.deepEqual(ui.actions(), [{ type: 'doneHaste', seat }],
    'the next haste step still gets its automatic answer');
});

test('[122] a refusal of an action the CLIENT chose to send is not the player refusal', () => {
  const seat: Seat = 0;
  const s = hasteStep(22313, seat);
  ui.join(s, seat, [{ type: 'doneHaste', seat }]);
  assert.equal(ui.actions().length, 1, 'an automatic intent is outstanding');

  const html = ui.push({ t: 'error', msg: 'not the haste step' });
  assert.doesNotMatch(html, /✗ not the haste step/,
    '[122] the player never took this action, so it must not wear their error bar');
  assert.match(html, /the client answered for you/,
    '…and it is not swallowed either — silence would hide the next #122');
  ui.sent();
});

test('[122] a refusal that follows a real click is still the player refusal', () => {
  // the negative control for the clause above: `autoOutstanding` is reset by
  // any human intent, so a refusal after a click is attributed to the click.
  const seat: Seat = 0;
  const s = hasteStep(22314, seat);
  ui.join(s, seat, [{ type: 'doneHaste', seat }]);
  ui.sent();
  const taken = structuredClone(s);
  taken.actionCount += 1;
  taken.hasteDone![seat] = true;
  ui.update(taken, []);
  ui.click({ btn: 'helpopen' });
  ui.click({ btn: 'helpclose' });
  ui.push({ t: 'joined', seat, view: taken, log: [], legal: [], peers: [true, true], names: ['Ann', 'Bo'] });
  const html = ui.push({ t: 'error', msg: 'you do not have priority' });
  assert.match(html, /✗ you do not have priority/,
    'a refusal with no automatic intent behind it is the player and says so');
  ui.sent();
});

/* ══ §3 [123] the Pass-all release set, derived ═════════════════════════ */

/** a battle parked in a priority window belonging to `D`, with a stack */
function battleWindow(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  spawn(h, D, 'Conduit of Pain');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  if (h.state.priority !== D) pass(h);
  assert.equal(h.state.priority, D);
  return { h, A, D };
}

/** an arm holding the snapshot the CLIENT holds — one definition, shared with
 * ui/main.ts, so this cannot drift from what the board really carries */
const armFor = (s: GameState, legal: readonly Action[]): AutoPassArm => ({
  armed: true, prefOn: false, yieldIds: new Set<EntityId>(), ...armSnapshot(s, legal),
});

/** the pre-R245 arm: the two scalars, and no snapshot at all */
const oldArmFor = (s: GameState, legal: readonly Action[]): AutoPassArm => {
  const { armedStack, armedSig } = armSnapshot(s, legal);
  return { armed: true, prefOn: false, yieldIds: new Set<EntityId>(), armedStack, armedSig };
};

/** put a fake item on the stack, the way ui/flash.ts mints one */
function push(s: GameState, id: number): void {
  s.stack.push({
    id, kind: 'spell', label: `item ${id}`, controller: s.priority!,
    region: s.battle!.region, negated: false, parts: [],
  });
}

test('[123] a stack item that replaces another at the same height is still new', () => {
  const { h, D } = battleWindow(22320);
  const s = h.state;
  push(s, 900);
  const legal = legalActions(s, D);
  const arm = armFor(s, legal);
  const old = oldArmFor(s, legal);
  assert.equal(passAllRelease(s, D, legal, arm), null, 'nothing has changed yet');

  // one server batch: the top resolves and its own trigger goes straight back
  // on. Room VYTV does this three times to seat 0 alone, and every time the
  // chip passed through an item it had promised to hand back.
  const moved = structuredClone(s);
  moved.stack = [];
  push(moved, 901);
  const legalAfter = legalActions(moved, D);
  assert.equal(moved.stack.length, s.stack.length, 'the HEIGHT is identical — that is the trap');
  assert.equal(passAllRelease(moved, D, legalAfter, arm), 'stack',
    '[123] an id the chip has not seen is the "something new was played" it promises');
  assert.equal(passAllRelease(moved, D, legalAfter, old), null,
    'the positive control: a height could not see it, which is why #123 came back');
});

test('[123] the stack clause by identity contains the old one by height', () => {
  // growth can only happen by gaining an id, so nothing the height clause
  // caught is lost — asserted rather than argued.
  const { h, D } = battleWindow(22321);
  const s = h.state;
  const legal = legalActions(s, D);
  const arm = armFor(s, legal);
  const old = oldArmFor(s, legal);
  const grown = structuredClone(s);
  push(grown, 910);
  const legalAfter = legalActions(grown, D);
  assert.ok(grown.stack.length > s.stack.length, 'positive control: it really grew');
  assert.equal(passAllRelease(grown, D, legalAfter, old), 'stack');
  assert.equal(passAllRelease(grown, D, legalAfter, arm), 'stack');
});

test('[123] an option that is not an activated ability releases the chip too', () => {
  const { h, D } = battleWindow(22322);
  const s = h.state;
  const legal = legalActions(s, D);
  const arm = armFor(s, legal);
  const old = oldArmFor(s, legal);
  assert.equal(passAllRelease(s, D, legal, arm), null);

  // a spell token created by a resolution — the option that really appeared,
  // six times, in the room #123 was filed from, and moved nothing
  const after = structuredClone(s);
  new E(after).createSpellToken(D, 'Fireball', 2, after.battle!.region);
  const legalAfter = legalActions(after, D);
  assert.ok(legalAfter.some(a => a.type === 'castSpellToken'), 'the token is castable here');
  assert.equal(passAllRelease(after, D, legalAfter, arm), 'ability',
    '[123] "a new option that appeared because the game moved" is not one action type');
  assert.equal(passAllRelease(after, D, legalAfter, old), null,
    'the positive control: activationKeys alone could not see it');
});

test('[123] the option set is derived by exclusion, and the exclusions are the three named', () => {
  const { h, D } = battleWindow(22323);
  const s = h.state;
  // a window with something of every shape in it: mana to cast with, a mod to
  // apply, and a spell token to fire. A sweep over one narrow window would
  // prove nothing about exclusion.
  for (const k of ELEMENTS) giveResources(h, D, k, 4);
  new E(s).createSpellToken(D, 'Fireball', 2, s.battle!.region);
  const legal = legalActions(s, D);
  const kinds = [...new Set(legal.map(a => a.type))].sort();
  const keyed = new Set(optionKeys(s, legal).map(k => k.slice(0, k.indexOf(':'))));
  assert.ok(kinds.length >= 4,
    `positive control: this window offers several kinds of action (${kinds.join(', ')})`);
  assert.deepEqual(kinds.filter(t => !keyed.has(t)), ['passPriority'],
    'every legal action here is an option except the ones that are not a choice to weigh');

  // …and the keys survive the renumbering a zone edit causes: an index shifts,
  // the card standing in the slot does not. Without this, playing one card
  // would read as several new options and take the chip off for bookkeeping.
  const shifted = structuredClone(s);
  shifted.players[D]!.hand.unshift('Good Whale');
  const before = optionKeys(s, legal);
  const after = optionKeys(shifted, legalActions(shifted, D));
  for (const k of before) {
    assert.ok(after.includes(k), `an index moved and "${k}" must not read as a new option`);
  }
  assert.ok(before.some(k => k.startsWith('playCard:')),
    'positive control: there were index-carrying options to shift in the first place');
});

test('[123] a state this seat is not being asked to pass never releases the chip', () => {
  const { h, A, D } = battleWindow(22324);
  const s = h.state;
  const legal = legalActions(s, D);
  const arm = armFor(s, legal);
  // the opponent's window: not mine to decline, so nothing about my options
  // can take the chip off in it
  const theirs = structuredClone(s);
  theirs.priority = A;
  push(theirs, 920);
  assert.equal(inPassWindow(theirs, D, legalActions(theirs, D)), false);
  assert.equal(passAllRelease(theirs, D, legalActions(theirs, D), arm), null,
    'the release is a judgement about the window in front of me');
  // …and it lands the moment the window IS mine again
  const mine = structuredClone(theirs);
  mine.priority = D;
  assert.equal(passAllRelease(mine, D, legalActions(mine, D), arm), 'stack',
    'nothing is lost by waiting — the chip passes nothing in between');
  // the battle ending is not about a window and is answered before the scope
  const over = structuredClone(theirs);
  over.phase = 'deploy';
  assert.equal(passAllRelease(over, D, legalActions(over, D), arm), 'phase');
});
