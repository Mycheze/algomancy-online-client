/* R197 — THREE ROWS OF THE DIVERGENCE INVENTORY (§2b), ONE CARD EACH.
 *
 * `docs/09-divergence-inventory.md` §2 is what CARD-TODO #50 means. Three of
 * its remaining rows are one card each, and each gets a NAMED test here that
 * quotes the printed clause it is about, so the card cannot lose the behaviour
 * again quietly.
 *
 * §1  PREDICTION CAP — Prediction Prophet, "predict your life total".
 *     The menu ran `0 … life + 5`. Any number is legal on the card, and the
 *     owner's standing steer (2026-08-24) is that cards are literal and open:
 *     *"Don't assume that cards are limited, they're designed to be open
 *     ended… It's not on rails."* So the fix is a REAL numeric entry —
 *     `DecisionKind` grew `'number'`, whose `choice` is the value and whose
 *     `options` is empty — and the client renders it, which §1c drives through
 *     the client's own markup and the client's own handlers.
 *
 * §2  UNTIL-REGROUP PLAY WINDOW — Spell Excavation, "You may play target spell
 *     from your bin until regroup". It was collapsed to "right now": the spell
 *     was played INLINE during the Excavation's own resolution. The window is
 *     real now (`E.grantBinCardPlay`, R96's single-card sibling), and — the
 *     part that had to be got right — R157 §12 says **a bin-play grant does
 *     not waive printed timing**, so §2c pins that the window is a permission
 *     to play and nothing more.
 *
 * §3  MULTIPLAYER ATTRIBUTION — Cinder Scuttler, "if I am in your bin and you
 *     deal combat damage to an opponent, recall me".
 *     ⚠ THE PREMISE OF THIS ROW IS UNREACHABLE and §3a measures it rather than
 *     asserting it: the engine is 1v1 BY CONSTRUCTION — `createGame` takes a
 *     two-tuple of names and builds exactly two players and two regions, and
 *     `other(seat)` is the literal `1 - seat`, which answers -1 for a third
 *     seat. There is no board on which a third player's damage can fire this
 *     card, so **nothing was built for it**. §3b/§3c pin the 1v1 reading that
 *     IS reachable, which is what the row itself calls "in 1v1 exact".
 *     (See the final report for the ONE reachable 1v1 gap this measurement
 *     turned up — a fully REPLACED combat hit — which belongs to the per-column
 *     face-damage seam and was deliberately not built here.)
 *
 * Seeds 16800-16899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended, other } from '../src/engine.ts';
import { createGame, legalActions } from '../src/apply.ts';
import { getCard } from '../src/cards/dsl.ts';
import {
  finishBattle, give, giveResources, pass, skipHasteStep, spawn, toDeployment,
  toNextBattle, unitsOf,
} from './util.ts';
import { numberEntry, numberEntrySubmit, stepNumberEntry } from '../ui/inspect.ts';
import type { Seat } from '../src/types.ts';

/* ── the client, hotseat (R170/CT-46) ─────────────────────────────────── */
// set BEFORE the driver is imported, and the import must therefore be dynamic:
// a static one is hoisted and would run the driver (and ui/main.ts with it)
// before this line ever executed.
(globalThis as Record<string, unknown>)['__UI_DRIVER_SEARCH'] = '?hotseat=1';
const { local } = await import('./ui-driver.ts');

/** run raw engine calls against the harness state, absorbing a suspension and
 * keeping the harness log honest (40-light-c's `whiteBox`, verbatim in shape:
 * E may REPLACE its state object on a mid-part rollback) */
function whiteBox(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  try {
    fn(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
  h.events.push(...e.events);
  for (const ev of e.events) h.log.push(ev.msg);
}

/** roll into the endOfHaste window and stop the moment the prediction is asked
 * for — R50's settle window, before skipHasteStep has anything left to do */
function toPrediction(h: Harness): void {
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'donePlanning', seat: 0 });
  if (!h.state.decision) h.do({ type: 'donePlanning', seat: 1 });
  if (!h.state.decision) skipHasteStep(h);
}

// ═══ §1 — PREDICTION CAP ══════════════════════════════════════════════════
//
// "During [Haste], predict your life total. At the start of deployment, create
// a 5/5 unit if you matched the prediction."

test('R197 §1a Prediction Prophet: "predict your life total" is UNCAPPED — the '
  + 'question carries no options and no ceiling', () => {
  const h = new Harness(16800);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Prediction Prophet');
  toPrediction(h);
  const dec = h.state.decision!;
  assert.equal(dec.kind, 'number', 'a numeric entry, not a menu');
  assert.deepEqual(dec.options, [],
    'THE CONTRACT: `kind: "number"` carries no options, because `choice` is the value itself');
  assert.ok(dec.numeric, 'and the range travels with the question');
  assert.equal(dec.numeric!.max, null,
    'NO CEILING. "Any number" is what the card says, and `life + 5` was the engine talking');
  assert.equal(dec.numeric!.min, 0);
  assert.equal(dec.numeric!.suggest, h.state.players[A]!.life, 'the dial opens where you stand');
  // and every one of those values is really answerable — legalActions must
  // never be empty for a question only this seat can answer
  const legal = legalActions(h.state, A).filter(a => a.type === 'decide');
  assert.ok(legal.length > 0, 'the seat being asked is offered representatives, not an empty list');
  finishBattle(h);
});

test('R197 §1b Prediction Prophet: a prediction ABOVE `life + 5` is accepted and '
  + 'pays out the 5/5 — the old cap would not have offered it', () => {
  const h = new Harness(16801);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Prediction Prophet');
  toPrediction(h);
  const life = h.state.players[A]!.life;
  const want = life + 9;                      // FOUR above the old `life + 5` ceiling
  h.do({ type: 'decide', seat: A, choice: want });
  assert.ok(h.log.some(l => l.includes(`predicts ${want}`)), 'the prediction is on the record');
  // and it is a reachable board, not a hypothetical: gaining nine life across a
  // battle is ordinary, and the card is about predicting where you WILL be
  whiteBox(h, e => e.gainLife(A, 9, 'test'));
  finishBattle(h);
  assert.equal(h.state.phase, 'deploy');
  assert.equal(h.state.players[A]!.life, want, 'the board really arrived at the predicted total');
  assert.ok(h.log.some(l => l.includes(`the prediction of ${want} was matched`)));
  const made = unitsOf(h, A).filter(u => u.token && u.tokenStats?.[0] === 5);
  assert.equal(made.length, 1, 'the match the old menu could not express pays its 5/5');
});

test('R197 §1c Prediction Prophet: THE CLIENT CAN EXPRESS IT — the numeric bar '
  + 'dials past the old cap and puts the VALUE on the wire, not an index', () => {
  const h = new Harness(16802);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Prediction Prophet');
  toPrediction(h);
  const life = h.state.players[A]!.life;

  // (i) the judgement, on its own: the dial clamps to the range, refuses what
  // the engine would refuse, and — the whole point — has no ceiling to hit
  const dec = h.state.decision!;
  assert.equal(numberEntry(dec, life).value, life);
  assert.equal(numberEntry(dec, -4).value, 0, 'below the floor is clamped to it');
  assert.ok(numberEntry(dec, life + 40).canUp, 'there is always another rung: no ceiling');
  assert.equal(numberEntrySubmit(dec, life + 40).choice, life + 40,
    'the submitted choice IS the number — never an option index');
  assert.equal(numberEntrySubmit(dec, -1).ok, false, 'and the floor is enforced client-side too');
  assert.equal(stepNumberEntry(dec, life, 'up10').count, life + 10);

  // (ii) the real client: real markup, real handlers, real engine underneath
  const ui = local();
  ui.show(h.state);
  assert.ok(ui.has({ btn: 'numtake' }), 'the numeric bar is on screen for the seat being asked');
  assert.ok(ui.has({ btn: 'numup10' }), 'and it can move ten at a time');
  ui.click({ btn: 'numup10' });
  ui.click({ btn: 'numup10' });               // life + 20 — far past the old cap
  ui.click({ btn: 'numtake' });
  const after = ui.state();
  assert.equal(after.decision, null, 'the click answered the question');
  const prophet = Object.values(after.entities).find(x => x.card === 'Prediction Prophet')!;
  assert.equal(prophet.budgets['predictedLife'], life + 20 + 1,
    'the client sent the NUMBER, not an index: the card stored prediction+1 for life+20');
});

// ═══ §2 — UNTIL-REGROUP PLAY WINDOW ══════════════════════════════════════
//
// "You may play target spell from your bin until regroup. It gains {p}unstable
// until regroup. (If it would enter a bin, erase it instead.)"

/** play Spell Excavation in the round-1 attack window, aiming at `name` in the
 * caster's own bin; returns the two seats */
function excavate(h: Harness, seed: number, name: string): { A: Seat; D: Seat } {
  const A = h.state.initiative as Seat, D = other(A);
  const atk = spawn(h, A, 'Curio Drifter');
  h.state.players[D]!.bin.push(name);
  giveResources(h, D, 'water', 2);                     // Excavation: bb / 1
  giveResources(h, D, 'fire', 4);                      // whatever it grants, paid later
  giveResources(h, D, 'wood', 4);                      // …and §2c's fixture is affordable too
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Spell Excavation') });
  return { A, D };
}

/** every `playFromBin` this seat is offered right now */
const binPlays = (h: Harness, seat: Seat): number[] =>
  legalActions(h.state, seat).flatMap(a => a.type === 'playFromBin' ? [a.binIndex] : []);

test('R197 §2a Spell Excavation: "you may play target spell from your bin" is a '
  + 'GRANT — the spell stays in the bin, unpaid for, until you take it up', () => {
  const h = new Harness(16810);
  toDeployment(h);
  const { D } = excavate(h, 16810, 'Luminous Arc');
  const dec = h.state.decision!;
  h.do({
    type: 'decide', seat: dec.seat,
    choice: dec.options.findIndex(o => o.label.startsWith('Luminous Arc')),
  });
  const mana = new E(h.state).openMana(D);
  pass(h); pass(h);                                    // the Excavation resolves
  assert.ok(h.state.players[D]!.bin.includes('Luminous Arc'),
    'the spell is STILL IN THE BIN — the effect was a permission, not a play');
  assert.equal(new E(h.state).openMana(D), mana,
    'and nothing was paid for it: you pay when you play, which is later');
  assert.ok(h.log.some(l => l.includes('until regroup')), 'the window is announced');
  // and the play is really on offer, at the seat's own next window
  if (h.state.priority !== D) pass(h);
  assert.ok(binPlays(h, D).includes(h.state.players[D]!.bin.indexOf('Luminous Arc')),
    'the grant is a legal action, not just a log line');
  finishBattle(h);
});

test('R197 §2b Spell Excavation: the window SURVIVES to regroup — the grant is '
  + 'still live in a later battle window — and EXPIRES there', () => {
  const h = new Harness(16811);
  toDeployment(h);
  const { A, D } = excavate(h, 16811, 'Luminous Arc');
  const dec = h.state.decision!;
  h.do({
    type: 'decide', seat: dec.seat,
    choice: dec.options.findIndex(o => o.label.startsWith('Luminous Arc')),
  });
  pass(h); pass(h);
  const arc = h.state.players[D]!.bin.indexOf('Luminous Arc');
  // walk the rest of the battle WITHOUT taking the grant up, and check it in
  // every window the seat is offered one. "Right now" was the whole defect:
  // a window that closes the instant the Excavation resolves is not a window.
  let sawLater = 0;
  let guard = 40;
  while (h.state.phase === 'battle' && guard-- > 0) {
    const b = h.state.battle!;
    if (h.state.decision) {
      const d = h.state.decision;
      h.do({ type: 'decide', seat: d.seat, choice: d.kind === 'orderTriggers' ? d.options.map((_, i) => i) : 0 });
      continue;
    }
    if (h.state.priority === D && binPlays(h, D).includes(arc)) sawLater++;
    if (b.step === 'declare') h.do({ type: 'declareAttack', seat: b.attacker, columns: [] });
    else if (b.step === 'blocks') h.do({ type: 'declareBlocks', seat: b.defender, blocks: {} });
    else pass(h);
  }
  assert.ok(sawLater >= 2,
    `the grant outlived the window it was made in (offered in ${sawLater} later windows)`);
  assert.equal(h.state.phase, 'deploy', 'regroup has come and gone');
  // EXPIRY. Regroup ends the battle phase, and `finishHasteEnd` wipes the
  // battleCounters the grant lives in on the way into the NEXT one — so the
  // permission cannot be carried into another turn's battle.
  assert.ok(h.state.players[D]!.bin.includes('Luminous Arc'), 'never played, still binned');
  toNextBattle(h, A);
  const e = new E(h.state);
  assert.equal(e.mayPlayCardFromBin(D, h.state.battle!.region, 'Luminous Arc'), false,
    'the grant did not survive regroup into the next turn');
  assert.deepEqual(binPlays(h, D), [], 'and nothing in the bin is on offer any more');
  finishBattle(h);
});

test('R197 §2c Spell Excavation: the grant does NOT waive printed timing '
  + '(R157 §12) — a deploy-timing spell in the bin is not a legal target, and '
  + 'a grant forced onto one is still refused', () => {
  const h = new Harness(16812);
  toDeployment(h);
  // a deploy-timing spell: playable from hand in deployment, never in battle
  const DEPLOY = 'Sylvan Sprouting';
  assert.notEqual(getCard(DEPLOY).timing, 'battle', 'the fixture is a non-battle spell');
  assert.equal(getCard(DEPLOY).kind, 'spell');
  const { D } = excavate(h, 16812, DEPLOY);
  // the fixture is AFFORDABLE — the only thing standing between it and being
  // played is its printed timing, which is precisely what is under test
  assert.ok(new E(h.state).canPayCard(D, DEPLOY), 'the seat can pay for it');
  const dec = h.state.decision;
  // R64: an illegal target is not something you pick and have refused, it is
  // something you were never shown — and with nothing legal at all and `min 0`
  // carrying the "You may", the question is not even raised.
  if (dec) {
    assert.equal(dec.kind, 'targets');
    assert.ok(!dec.options.some(o => o.label.startsWith(DEPLOY)),
      'a spell whose printed timing can never be met before regroup is not offered: '
      + 'the grant would be dead on arrival');
    h.do({ type: 'decide', seat: dec.seat, choice: dec.options.length - 1 });   // decline (min 0)
  }
  pass(h); pass(h);
  assert.ok(h.state.players[D]!.bin.includes(DEPLOY),
    'THE WAIVER THAT USED TO HAPPEN: a deploy-timing spell was played out of the '
    + 'bin in the middle of a battle, because an inline play never asks the timing');
  assert.equal(unitsOf(h, D).length, 0, 'and nothing it would have created exists');
  // …and even handed the permission directly, the play is refused on TIMING.
  // This is the half that matters: the window governs WHEN YOU MAY PLAY IT,
  // and the card's own printed timing still applies inside that window.
  whiteBox(h, e => e.grantBinCardPlay(D, DEPLOY));
  if (h.state.priority !== D) pass(h);
  assert.deepEqual(binPlays(h, D), [],
    'legalActions offers nothing — a bin-play grant is not a timing waiver');
  assert.throws(
    () => h.do({ type: 'playFromBin', seat: D, binIndex: h.state.players[D]!.bin.indexOf(DEPLOY) }),
    /only battle cards can be played now/,
    'and apply refuses it on TIMING — not on money, not on the permission');
  finishBattle(h);
});

// ═══ §3 — MULTIPLAYER ATTRIBUTION ════════════════════════════════════════
//
// "If I am in your bin and you deal combat damage to an opponent, recall me."

test('R197 §3a Cinder Scuttler: the MULTIPLAYER premise is UNREACHABLE — the '
  + 'engine is 1v1 by construction, so no third player\'s damage exists to '
  + 'be misattributed', () => {
  // MEASURED, not assumed. This is the whole deliverable for the row: a fix
  // for an unreachable state is a fix no test can redden (the {Reaping} row of
  // the same inventory cost exactly that).
  const g = createGame(16820, ['A', 'B']);
  assert.equal(g.state.players.length, 2, 'createGame builds exactly two players…');
  assert.equal(g.state.regions.length, 2, '…and exactly two regions');
  assert.equal(other(0), 1);
  assert.equal(other(1), 0);
  assert.equal(other(2), -1,
    '`other()` is the literal `1 - seat`: a third seat is not representable at all');
  const e = new E(g.state);
  assert.equal(e.nit, other(e.initiative), 'and the turn order is the same two seats');
});

test('R197 §3b Cinder Scuttler: "YOU deal combat damage to an OPPONENT" — the '
  + 'attacker\'s bin copy recalls and the victim\'s does not', () => {
  const h = new Harness(16821);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const atk = spawn(h, A, 'Curio Drifter');            // 2/2, unblocked
  h.state.players[A]!.bin.push('Cinder Scuttler');     // the one that should recall
  h.state.players[D]!.bin.push('Cinder Scuttler');     // the one that must not
  toNextBattle(h, A);
  const lifeD = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  finishBattle(h);
  assert.ok(h.state.players[D]!.life < lifeD, 'combat damage really reached the face');
  assert.ok(h.state.players[A]!.hand.includes('Cinder Scuttler'),
    'the seat that DEALT it recalls its bin copy');
  assert.ok(!h.state.players[A]!.bin.includes('Cinder Scuttler'), 'and it left the bin');
  assert.ok(h.state.players[D]!.bin.includes('Cinder Scuttler'),
    'the seat that TOOK it does not: "you deal" is not "you were dealt"');
  assert.ok(!h.state.players[D]!.hand.includes('Cinder Scuttler'));
});

test('R197 §3c Cinder Scuttler: NONCOMBAT life loss never recalls it — the '
  + '"why" on the event is doing real work', () => {
  const h = new Harness(16822);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = other(A);
  const atk = spawn(h, A, 'Curio Drifter');            // opens the battle, never connects
  spawn(h, D, 'Curio Drifter');                        // Recall needs a unit each to recall
  h.state.players[A]!.bin.push('Cinder Scuttler');
  giveResources(h, A, 'water', 2);                     // Recall: b / 1
  toNextBattle(h, A);
  const lifeD = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // "Each player recalls a unit and loses 2 life" — a REAL life loss, in a real
  // battle, that is not combat damage. A's Cinder Scuttler must sit still.
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Recall') });
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, lifeD - 2, 'the opponent really lost life…');
  // Recall took the only attacker home with it, so NO combat damage follows —
  // the noncombat loss above is the only thing this battle offers the card.
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, lifeD - 2, 'and no combat damage followed it');
  assert.ok(h.state.players[A]!.bin.includes('Cinder Scuttler'),
    '…and it is not "you deal combat damage to an opponent", so nothing is recalled');
  assert.ok(!h.state.players[A]!.hand.includes('Cinder Scuttler'));
});
