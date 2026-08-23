/* Playtest round 17 — the GETD reports about spell tokens, from the client side.
 *
 *  [66] "The UI is reminding me I have unused tokens at EVERY chance it has.
 *       The intention of the reminder is to only happen if the player is about
 *       to accidentally end the battle before using tokens. Not at every single
 *       point. It should just be right at the end before moving to Regroup."
 *  [68] "I hit pass all, but then it stopped passing all. Why?"
 *  [69] "It's very easy to attack without bringing along any spell tokens into
 *       the new region. Instead of having it be done with attackers, make it a
 *       choice after declaring attackers."
 *  [67] "What happened to Rashi's Poison tokens here? She just wanted to bring
 *       them with her attackers but they somehow went onto the stack, without
 *       any targets or anything??" — the same thing on the COUNTERATTACK side.
 *       The engine grew `declareBlocks.spellTokens` (R87) this round; this file
 *       holds the client's half of it (ui/battle.ts sendableTokens /
 *       splitCounterattack / shouldAskSend).
 *
 * …and R89, R79's missing half: a spell TOKEN is a mod host during deployment
 * (Caleb 2025-03-06). Same exposure, one layer up — the engine names the token
 * in `hostId`, exactly as it names a unit, so nothing on screen had to change
 * for the offer to be silently ignored. modHosts/modHostPhrase now tell the two
 * apart, and spellAugmentNote says what a spell can actually gain BEFORE the
 * card is spent.
 *
 * #66 and #68 turned out to be one bug wearing two coats. The client's whole
 * theory of spell tokens was "you are holding one, therefore shout", with no
 * reference to whether the thing you were about to do actually cost you
 * anything — so the Pass button grew a confirm on every window (#66) and the
 * Pass-all chip released itself on the first window after it was armed, having
 * passed exactly once (#68). The sharper question — "would THIS pass reach
 * Regroup, which is the only step that erases spell tokens (R11)?" — is
 * ui/battle.ts passEndsBattlePhase, and the first section here holds it against
 * the engine's own transition rather than against a description of it.
 *
 * ui/main.ts takes the document and the socket at import time, so it cannot be
 * loaded here; the judgements live in ui/battle.ts and are tested directly, and
 * the one-line wiring between them and the DOM is read as text at the bottom.
 * That is the house pattern (test/70-playtest-round15.test.ts header).
 *
 * Seeds 7700-7799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { apply, legalActions } from '../src/apply.ts';
import { activationKeys } from '../ui/inspect.ts';
import type { AutoPassArm } from '../ui/inspect.ts';
import {
  autoPassDecision, passAllRelease, passEndsBattlePhase, ridableTokens, sendableTokens,
  shouldAskRide, shouldAskSend, splitCounterattack, tokensAtRisk,
} from '../ui/battle.ts';
import { modHostPhrase, modHosts, spellAugmentNote } from '../ui/inspect.ts';
import { give, giveResources, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { Action, EntityId, GameState, Seat } from '../src/types.ts';

const MAIN = readFileSync(new URL('../ui/main.ts', import.meta.url), 'utf8');

/** the engine's own answer to "does passing out of this window leave the
 * battle phase?" — both seats pass, nobody responds, where does the game land */
function passingLeavesBattle(s: GameState): boolean {
  let st = s;
  for (let i = 0; i < 2; i++) {
    if (st.phase !== 'battle' || st.priority === null || st.decision) break;
    st = apply(st, { type: 'passPriority', seat: st.priority }).state;
  }
  return st.phase !== 'battle';
}

/** a battle with one attacker and one defender, parked at the declare step */
function battleWithToken(seed: number): { h: Harness; A: Seat; D: Seat; atk: EntityId; def: EntityId; tok: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  const def = spawn(h, D, 'Conduit of Pain');
  toNextBattle(h, A);
  // the defender's own spell token, standing in their home region — which IS
  // the battle region in round 1, so it is castable in every window. This is
  // the GETD shape: a player holding ammunition through a whole battle.
  const tok = new E(h.state).createSpellToken(D, 'Fireball', 2, new E(h.state).homeRegion(D)).id;
  return { h, A, D, atk, def, tok };
}

/** an armed Pass-all chip, as UiState holds it at this instant */
function armedNow(s: GameState, legal: readonly Action[]): AutoPassArm {
  return {
    armed: true, armedStack: s.stack.length, armedSig: activationKeys(legal),
    prefOn: false, yieldIds: new Set<EntityId>(),
  };
}

/* ── [66] which pass actually costs you your spell tokens ─────────────── */

test('[66] passEndsBattlePhase agrees with the engine at every priority window of a battle', () => {
  const { h, A, D, atk, def } = battleWithToken(7700);
  let windows = 0, ends = 0;
  let guard = 200;
  while (h.state.phase === 'battle' && guard-- > 0) {
    const s = h.state, b = s.battle!;
    if (s.decision) {
      const dec = s.decision;
      h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
      continue;
    }
    if (s.priority !== null) {
      windows++;
      const truth = passingLeavesBattle(s);
      if (truth) ends++;
      assert.equal(
        passEndsBattlePhase(s, s.priority), truth,
        `round ${b.round} ${b.step}: the client's answer must be the engine's`,
      );
      // and it is only ever asked about the seat holding priority
      assert.equal(passEndsBattlePhase(s, (1 - s.priority) as Seat), false,
        'a window that is not mine is not a pass I am about to make');
      pass(h);
      continue;
    }
    if (b.step === 'declare') {
      const cols = b.attacker === A ? [[atk]] : [[def]];
      h.do({ type: 'declareAttack', seat: b.attacker, columns: b.round === 1 ? cols : [] });
    } else if (b.step === 'blocks') {
      // no blocks and no counterattackers: round 1 therefore falls straight
      // through round 2 into Regroup, which is the interesting shape
      h.do({ type: 'declareBlocks', seat: b.defender, blocks: {}, send: [] });
    }
  }
  assert.ok(guard > 0, 'the battle walk terminated');
  assert.ok(windows >= 3, `saw ${windows} priority windows — the walk did not cover a battle`);
  assert.ok(ends > 0, 'no window in the walk was the one that reaches Regroup');
  assert.notEqual(h.state.phase, 'battle', 'the walk really did leave the battle phase');
  void D;
});

test('[66] the after-combat window of round 1 does NOT end the battle when counterattackers were sent', () => {
  const { h, A, D, atk, def } = battleWithToken(7701);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                   // through the attack window
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [def] });
  pass(h); pass(h);                                   // through the block window → damage
  const s = h.state;
  assert.equal(s.battle!.step, 'afterWindow', 'parked in the after-combat window');
  assert.equal(s.battleRound, 1);
  assert.deepEqual(s.battle!.sentAttackers, [def], 'a counterattacker is waiting');
  assert.equal(passEndsBattlePhase(s, s.priority!), false,
    'round 2 is still to come — passing here costs no tokens');
  assert.equal(passingLeavesBattle(s), false, '…and the engine agrees');
});

test('[66] tokensAtRisk is zero while the battle still has windows left, and counts them at the end', () => {
  const { h, A, D, atk } = battleWithToken(7702);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // the defender's window inside the attack window: the token is castable…
  pass(h);
  assert.equal(h.state.priority, D);
  const legalMid = legalActions(h.state, D);
  assert.ok(legalMid.some(a => a.type === 'castSpellToken'),
    'the defender really can cast the token here');
  assert.equal(tokensAtRisk(h.state, D, legalMid), 0,
    '[66] …but passing here does not reach Regroup, so there is nothing to warn about');
  // …drive to the after-combat window, where it does
  pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [] });
  pass(h); pass(h);
  while (h.state.decision) {
    const dec = h.state.decision;
    h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
  }
  assert.equal(h.state.battle!.step, 'afterWindow');
  if (h.state.priority !== D) pass(h);
  const legalEnd = legalActions(h.state, D);
  assert.equal(tokensAtRisk(h.state, D, legalEnd), 1,
    '[66] the one pass that erases them is the one that warns');
});

test('[66] a pass that only resolves the top of the stack never counts as the end', () => {
  const { h, A, D, atk } = battleWithToken(7703);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [] });
  pass(h); pass(h);
  while (h.state.decision) {
    const dec = h.state.decision;
    h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
  }
  assert.equal(h.state.battle!.step, 'afterWindow');
  const withStack = structuredClone(h.state);
  withStack.stack.push({
    id: 900, kind: 'spell', label: 'something', controller: withStack.priority!,
    region: withStack.battle!.region, negated: false, parts: [],
  });
  assert.equal(passEndsBattlePhase(withStack, withStack.priority!), false,
    'this pass resolves the top item; another window follows it');
});

/* ── [68] why Pass-all stopped passing all ────────────────────────────── */

test('[68] Pass-all stays armed through a window where a spell token is merely castable', () => {
  const { h, A, D, atk } = battleWithToken(7710);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                            // the defender's window
  const s = h.state;
  assert.equal(s.priority, D);
  const legal = legalActions(s, D);
  assert.ok(legal.some(a => a.type === 'castSpellToken'), 'the token is castable here');
  assert.equal(passAllRelease(s, D, legal, armedNow(s, legal)), null,
    '[68] "I hit pass all, but then it stopped passing all" — holding a token is not a reason');
  assert.deepEqual(autoPassDecision(s, D, legal, armedNow(s, legal)), { disarm: false, pass: 'passall' },
    '[68] …so the chip passes this window, as it promised');
});

test('[68] Pass-all releases on the pass that would move to Regroup with tokens still castable', () => {
  const { h, A, D, atk } = battleWithToken(7711);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [] });
  pass(h); pass(h);
  while (h.state.decision) {
    const dec = h.state.decision;
    h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
  }
  assert.equal(h.state.battle!.step, 'afterWindow');
  if (h.state.priority !== D) pass(h);
  const s = h.state;
  const legal = legalActions(s, D);
  assert.equal(passAllRelease(s, D, legal, armedNow(s, legal)), 'tokens',
    'the chip hands this window back — it is the pass that erases them');
  assert.equal(autoPassDecision(s, D, legal, armedNow(s, legal)).disarm, true);
  assert.equal(autoPassDecision(s, D, legal, armedNow(s, legal)).pass, null,
    'and it does not pass on its way out');
});

test('[68] the other three releases still release: the battle ending, a new stack item, a new ability', () => {
  const { h, A, D, atk } = battleWithToken(7712);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  const s = h.state;
  const legal = legalActions(s, D);

  // 'stack' — something was played since the chip was armed
  const armedLower = { ...armedNow(s, legal), armedStack: -1 };
  assert.equal(passAllRelease(s, D, legal, armedLower), 'stack');

  // 'ability' — a key that was not in the snapshot when the chip was armed
  // (a resolution granting a negate is the case that matters; any activation
  // the snapshot does not name will do to prove the clause still fires)
  const granted = [...legal,
    { type: 'activateAbility', seat: D, entityId: 999, abilityIndex: 0 } as Action];
  assert.equal(passAllRelease(s, D, granted, armedNow(s, legal)), 'ability');

  // 'phase' — the chip's own promise, "until the battle ends"
  const notBattle = structuredClone(s);
  notBattle.phase = 'deploy';
  assert.equal(passAllRelease(notBattle, D, legal, armedNow(s, legal)), 'phase');

  // and an UNarmed chip is never released, whatever the position
  assert.equal(passAllRelease(s, D, legal, { ...armedNow(s, legal), armed: false }), null);
});

/* ── [69] bringing spell tokens along with an attack ──────────────────── */

test('[69] ridableTokens lists exactly the tokens declareAttack will accept', () => {
  const { h, A, D, atk, def, tok } = battleWithToken(7720);
  // a token of the ATTACKER's, at home, is a rider; the defender's is not mine,
  // and the attacker cannot bring a token that is not in the region they leave
  const mine = new E(h.state).createSpellToken(A, 'Fireball', 3, new E(h.state).homeRegion(A)).id;
  const stranded = new E(h.state).createSpellToken(A, 'Fireball', 1, new E(h.state).homeRegion(D)).id;
  assert.deepEqual(ridableTokens(h.state, A), [mine],
    'mine, at home — and neither the opponent’s nor one standing somewhere else');
  assert.ok(!ridableTokens(h.state, A).includes(tok));
  // the engine agrees, in both directions
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]], spellTokens: [mine] });
  assert.equal(h.state.entities[mine]!.region, h.state.battle!.region, 'the rider travelled');
  assert.throws(
    () => apply(h.state, { type: 'declareAttack', seat: A, columns: [[atk]], spellTokens: [stranded] }),
    'a token the client would not list is one the engine refuses',
  );
  void def;
});

test('[69] ridableTokens is empty outside my own declare step', () => {
  const { h, A, D, atk } = battleWithToken(7721);
  new E(h.state).createSpellToken(A, 'Fireball', 3, new E(h.state).homeRegion(A));
  assert.equal(ridableTokens(h.state, D).length, 0, 'not the defender’s question');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.equal(h.state.battle!.step, 'attackWindow');
  assert.equal(ridableTokens(h.state, A).length, 0, 'the attack is already declared');
});

test('[69] the ride-along dialogue is interposed only when a choice is being silently defaulted', () => {
  const { h, A, atk } = battleWithToken(7722);
  // no tokens of my own: the report is explicit that this must not be noise
  assert.equal(shouldAskRide(h.state, A, [], false), false,
    'nothing to bring — Attack! stays a single click');
  const mine = new E(h.state).createSpellToken(A, 'Fireball', 3, new E(h.state).homeRegion(A)).id;
  assert.equal(shouldAskRide(h.state, A, [], false), true,
    '[69] a token could ride and none was picked — ask');
  assert.equal(shouldAskRide(h.state, A, [mine], false), false,
    'the player has already used the affordance; do not second-guess them');
  assert.equal(shouldAskRide(h.state, A, [], true), false,
    'and once answered for this attack it never asks again');
  void atk;
});

/* ── [67] R87: bringing spell tokens along with a COUNTERATTACK ────────── */

/**
 * Round 1 stopped at the block step: A attacking with one unit, D holding a
 * free counterattacker and a Poison 1 standing beside it in the contested
 * region — the GETD shape from report #67.
 */
function blockWithToken(seed: number): {
  h: Harness; A: Seat; D: Seat; ctr: EntityId; tok: EntityId;
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  const ctr = spawn(h, D, 'Conduit of Pain');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const tok = new E(h.state).createSpellToken(D, 'Fireball', 2, h.state.battle!.region).id;
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'blocks', 'stopped at the block step');
  return { h, A, D, ctr, tok };
}

test('[67] sendableTokens lists exactly the tokens a counterattack will accept', () => {
  const { h, A, D, tok } = blockWithToken(7730);
  const e = new E(h.state);
  // a token of mine, standing where the counterattack leaves from, is a rider.
  // One in another region is not — doDeclareBlocks refuses it by name.
  const elsewhere = e.createSpellToken(D, 'Fireball', 1, e.homeRegion(A) === h.state.battle!.region
    ? e.homeRegion(D) : e.homeRegion(A)).id;
  assert.deepEqual(sendableTokens(h.state, D), [tok],
    'mine, in the contested region — and not one standing somewhere else');
  assert.equal(sendableTokens(h.state, A).length, 0, 'and never the attacker’s question');
  assert.notEqual(elsewhere, tok);
});

test('[67] sendableTokens is empty outside the round-1 block step', () => {
  const { h, A, D, ctr, tok } = blockWithToken(7731);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [ctr], spellTokens: [tok] });
  assert.notEqual(h.state.battle!.step, 'blocks', 'the declaration is in');
  assert.equal(sendableTokens(h.state, D).length, 0, 'nothing left to ask about');
  void A;
});

test('[67] the counterattack ride dialogue respects "they always need a unit to take them"', () => {
  const { h, D, ctr, tok } = blockWithToken(7732);
  // a unit is being sent and a token could come — the one case worth asking
  assert.equal(shouldAskSend(h.state, D, [ctr], false), true,
    '[67] "she just wanted to bring them with her attackers"');
  // …and the three cases that must stay silent
  assert.equal(shouldAskSend(h.state, D, [], false), false,
    'a block-only declaration cannot carry a token at all — _passer 2025-05-10: '
    + '"In order to attack opponent Region, you must send atleast 1 of your unit"');
  assert.equal(shouldAskSend(h.state, D, [ctr, tok], false), false,
    'the player has already picked one; do not second-guess them');
  assert.equal(shouldAskSend(h.state, D, [ctr], true), false,
    'and once answered for this declaration it never asks again');
});

test('[67] a defender with no spell tokens is never interrupted', () => {
  const h = new Harness(7733);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  const ctr = spawn(h, D, 'Conduit of Pain');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'blocks');
  assert.equal(sendableTokens(h.state, D).length, 0);
  assert.equal(shouldAskSend(h.state, D, [ctr], false), false,
    'nothing to bring — Confirm stays a single click, exactly as report #66 insists');
});

test('[67] splitCounterattack puts each id in the field the action names, and the engine takes it', () => {
  const { h, D, ctr, tok } = blockWithToken(7734);
  // the board holds ONE list; the action has two fields
  const split = splitCounterattack(h.state, [ctr, tok]);
  assert.deepEqual(split, { send: [ctr], spellTokens: [tok] });
  assert.deepEqual(splitCounterattack(h.state, []), { send: [], spellTokens: [] });
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: split.send, spellTokens: split.spellTokens });
  assert.ok(h.state.entities[tok]!.absent, 'the token left with the counterattacker');
  assert.deepEqual(h.state.battle!.sentAttackers, [ctr, tok],
    'unit and token are one movement, and the engine takes the split the client made');
});

test('[67] a token-only counterattack is refused by the engine, so the client never builds one', () => {
  const { h, D, tok } = blockWithToken(7735);
  assert.throws(
    () => apply(h.state, { type: 'declareBlocks', seat: D, blocks: {}, send: [], spellTokens: [tok] }),
    /spell tokens travel only with units/,
    'the rule the dialogue gate mirrors');
  assert.equal(shouldAskSend(h.state, D, [tok], false), false,
    'and the gate never offers the shape the engine refuses');
});

/* ── R89: a SPELL TOKEN as a mod host during deployment ───────────────── */

/** Deployment, with a Fireball 3 in the home region, a unit beside it, and an
 * augment in hand that can go on either. */
function tokenDeployment(seed: number, card = 'Chitin Shredder'): {
  h: Harness; seat: Seat; tok: EntityId; unit: EntityId; legal: Action[]; index: number;
} {
  const h = new Harness(seed);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  const unit = spawn(h, seat, 'Geode');
  giveResources(h, seat, 'earth', 8);
  giveResources(h, seat, 'dark', 8);
  const e = new E(h.state);
  const tok = e.createSpellToken(seat, 'Fireball', 3, e.homeRegion(seat)).id;
  give(h, seat, card);
  const index = h.state.players[seat]!.hand.indexOf(card);
  return { h, seat, tok, unit, legal: legalActions(h.state, seat), index };
}

test('R89: modHosts picks the spell token out of the engine’s offer instead of calling it a unit', () => {
  const { h, tok, unit, legal, index } = tokenDeployment(7740);
  const pick = { from: 'hand' as const, index, mode: 'augment' as const };
  // without the state there is nothing to tell the two apart — the engine
  // names both in `hostId`, which is exactly why this facet could ship blind
  const blind = modHosts(legal, pick);
  assert.ok(blind.units.has(tok), 'the pre-R89 answer: a token host reads as a unit host');
  // with it, the token is its own kind, and the banner says so
  const hosts = modHosts(legal, pick, h.state);
  assert.ok(hosts.tokens?.has(tok), 'the Fireball is a host the board must glow');
  assert.ok(hosts.units.has(unit), 'and the Geode is still a unit host');
  assert.equal(hosts.units.has(tok), false, 'the token is not counted twice');
  assert.equal(modHostPhrase(hosts), 'unit, or a spell token',
    'the bar names both kinds — "a unit" over a spell token is how R79 stayed invisible');
});

test('R89: the modding bar names only the kinds really on offer, and never widens', () => {
  const empty = { units: new Set<EntityId>(), stack: new Set<number>() };
  assert.equal(modHostPhrase({ ...empty, tokens: new Set([1]) }), 'spell token');
  assert.equal(modHostPhrase({ units: new Set([1]), stack: new Set([2]), tokens: new Set([3]) }),
    'unit, or a spell token, or a spell on the stack');
  // R79's two-kind wording is unchanged — 74-ui-stack-mod-host pins it too
  assert.equal(modHostPhrase({ units: new Set([1]), stack: new Set([2]) }),
    'unit, or a spell on the stack');
  for (const hosts of [empty, { ...empty, tokens: new Set([1]) },
    { units: new Set([1]), stack: new Set([2]), tokens: new Set([3]) }]) {
    assert.doesNotMatch(`a ${modHostPhrase(hosts)}`, /^a (a|an) /, 'it follows the article "a"');
  }
});

test('R89: "you can only do this with attributes" is said before the card is spent', () => {
  // Caleb 2025-03-06, and the corollary: a mod whose whole payload is rules
  // text is legal on a spell token and donates nothing at all. The engine says
  // so in the log AFTER the card is gone; the bar has to say it before.
  assert.match(spellAugmentNote('Chitin Shredder'), /\{Powerful\}/,
    'an attribute-granting augment names what the spell would gain');
  assert.match(spellAugmentNote('Graxxlid'), /NOTHING/,
    'and a text-only one says the spell gains nothing — "only attributes"');
  assert.match(spellAugmentNote('Graxxlid'), /ATTRIBUTES/, 'in the ruling’s own words');
});

test('R89: the augment the client offers on a token is one the engine really takes', () => {
  const { h, seat, tok, legal, index } = tokenDeployment(7741);
  const hosts = modHosts(legal, { from: 'hand', index, mode: 'augment' }, h.state);
  assert.ok(hosts.tokens?.has(tok));
  h.do({ type: 'augment', seat, from: 'hand', index, hostId: tok });
  assert.equal(h.state.entities[tok]!.mods.length, 1, 'the mod is on the token');
});

/* ── the wiring in ui/main.ts, read as text ───────────────────────────── */

test('[66] the pass confirm is wired to the end-of-battle question, not to holding a token', () => {
  assert.match(MAIN, /passEndsBattlePhase\(s, s\.priority\)\s+&& castableTokenCount\(s\.priority\) > 0\)/,
    'the C5 guard must fire on the pass that reaches Regroup');
  assert.doesNotMatch(MAIN, /s\.phase === 'battle' && s\.priority !== null && castableTokenCount\(s\.priority\) > 0/,
    'the old "any castable token, any pass" trigger must be gone');
  assert.match(MAIN, /You're about to move to Regroup, which will remove your spell tokens\./,
    'the owner wrote this copy — use it');
  // the confirm bar must also go stale on the same question it was raised on
  assert.match(MAIN, /!passEndsBattlePhase\(h\.state, h\.state\.priority\)/);
});

test('[68] planAutoPass asks ui/battle.ts for the release list', () => {
  assert.match(MAIN, /const plan = autoPassDecision\(s, NET\.seat, NET\.legal, \{/);
  assert.doesNotMatch(MAIN, /autoPassPlan\(/,
    'main.ts must not reach past the release list to the raw plan');
});

test('[69] the Attack! button holds the declaration until the ride question is answered', () => {
  assert.match(MAIN, /if \(shouldAskRide\(s, atk, ui\.spellTokens, ui\.rideAnswered\)\) \{/,
    'the interposition itself');
  assert.match(MAIN, /columns: cols, spellTokens: ui\.spellTokens\.slice\(\)/,
    'and the declaration still carries the riders (75-ui-reachability depends on this line)');
  assert.match(MAIN, /Select the spell tokens you wish to bring into the attacked region, or select Bring none\./,
    'the report wrote this copy too');
  for (const b of ['ridenone', 'rideconfirm', 'ridecancel']) {
    // a handler of its own in the BOARD_BTNS table (handleButton dispatches by data-btn name)
    assert.match(MAIN, new RegExp(`^  ${b}: \\(\\) =>`, 'm'), `${b} must be handled`);
  }
  for (const b of ['ridenone', 'rideconfirm']) {
    assert.ok(MAIN.includes(`data-btn="${b}"`), `${b} must be reachable from the bar`);
  }
  assert.ok(MAIN.includes('\'[data-btn="rideconfirm"]\''), 'Enter sends the attack you picked riders for');
  assert.ok(!MAIN.includes('\'[data-btn="ridenone"]\''),
    'and Enter must NOT be able to decline for you — that is the accident being fixed');
  assert.match(MAIN, /data-act="token" data-id="\$\{t\.id\}"/,
    'each chip is the same clickable token as the one in the strip');
  assert.match(MAIN, /if \(ui\.confirmRide !== null\) \{ ui\.confirmRide = null; render\(\); return; \}/,
    'Esc is its "Go back", like every other confirm bar');
});

test('[67] the Confirm button holds the block declaration until the ride question is answered', () => {
  assert.match(MAIN, /if \(shouldAskSend\(s, def, ui\.send, ui\.rideAnswered\)\) \{/,
    'the interposition itself, on the counterattack side');
  assert.match(MAIN, /const \{ send, spellTokens \} = splitCounterattack\(s, ui\.send\);/,
    'one list on the board, two fields in the action');
  assert.match(MAIN, /act\(\{ type: 'declareBlocks', seat: s\.battle!\.defender, blocks, send, spellTokens \}\)/,
    'and the declaration carries the riders (75-ui-reachability depends on this line)');
  assert.match(MAIN, /sendableTokens\(s, ui\.confirmRide\)/,
    'the chips are the tokens the ENGINE would accept, not a second opinion');
  assert.match(MAIN, /sendableTokens\(s, b\.defender\)\.includes\(t\.id\)/,
    'and so is the click that toggles one in the strip (tokenToggleMode)');
  // the same asymmetry [69] fixed: Enter confirms a ride, Enter never declines
  assert.ok(MAIN.includes('\'[data-btn="rideconfirm"]\''), 'Enter sends the counterattack you picked riders for');
  assert.ok(!MAIN.includes('\'[data-btn="ridenone"]\''),
    'and Enter must NOT be able to decline for you — that is the accident being fixed');
  // the block bar reuses the [69] copy, chips and all
  assert.match(MAIN, /Counterattack — \$\{n\} token/,
    'the confirm button says how many are riding');
  assert.match(MAIN, /h\.state\.battle\?\.step !== 'declare' && h\.state\.battle\?\.step !== 'blocks'/,
    'and the question is cleared when BOTH steps it belongs to are over');
});

/* ── the dead code report #68 left behind (round 17 cleanup) ───────────── */

const INSPECT = readFileSync(new URL('../ui/inspect.ts', import.meta.url), 'utf8');

test('[68] passAllRelease is the ONE answer to "why did pass-all stop"', () => {
  // autoPassPlan's own Pass-all branch survived report #68's fix as dead code,
  // reachable only from its own test in 70-playtest-round15. Two release lists
  // is one release list too many: the C5 clause that WAS the bug lived in the
  // dead one, and a future edit could have revived it.
  const plan = INSPECT.slice(INSPECT.indexOf('export function autoPassPlan'));
  const body = plan.slice(0, plan.indexOf('\n}\n'));
  assert.doesNotMatch(body, /arm\.armed\b/,
    'autoPassPlan must not read the Pass-all chip at all — ui/battle.ts owns it');
  assert.doesNotMatch(body, /passall/,
    'and must never return the Pass-all reason');
  assert.doesNotMatch(body, /castableTokens\(/,
    'the C5 clause that made the chip a one-shot is gone from here');
  // …and ui/battle.ts still owns every one of the four
  assert.match(readFileSync(new URL('../ui/battle.ts', import.meta.url), 'utf8'),
    /export function passAllRelease\(/, 'the one release list is still exported');
});
