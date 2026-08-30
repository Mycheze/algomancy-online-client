/* R251 — THREE PASS BUTTONS, TWO PROMISES, ONE RELEASE LIST.
 *
 * Ledger #123, "Pass All still isn't working right", is the THIRD visit to
 * this chip (#68 → #123 → here) and the first one that is not a bug report.
 * Round 31 investigated it against room VYTV (265/265 FAITHFUL) and found the
 * code behaving exactly as designed: the chip came off because the opponent
 * put something on the stack, which is what the button said it would do. R245
 * fixed two real derivation defects on the way past — an "ability" clause that
 * was empty at all 107 pass-windows of that game, and a stack clause comparing
 * HEIGHTS so a same-height replacement was invisible — and both of those make
 * the chip stop MORE often, not less. Only the owner could name the narrower
 * promise, and he named three (round-31 sheet Q6, verbatim):
 *
 *   "I think there need to be three options: Pass, Pass through stack, and
 *    Pass all. Pass just does a single effect resolution (as it doesn now).
 *    Pass through the stack assumes a pass is given to all effects that are
 *    currently on the stack, but gives priority if something changes. And Pass
 *    all is the assumption that the player doesn't want priority until the next
 *    phase (which will likely be deployment)."
 *
 * ── WHAT THE OLD CHIP WAS, AND WHICH BUTTON IT BECAME
 *
 * It was named for the third option and behaved like the second: it released
 * on any change, and it ran to the end of the battle. It was neither, because
 * its snapshot was RE-TAKEN at every window it declined (R245, ui/main.ts) —
 * so "new" meant "new since the last window I passed", a running diff with no
 * fixed scope. A running diff cannot express "the effects that are CURRENTLY
 * on the stack": an item that was already there when you armed keeps being
 * compared against a baseline that has moved on, and nothing ever FINISHES,
 * which is why the chip could only stop at the end of the battle.
 *
 * So the chip became "Pass through stack" — it keeps every clause R245 derived
 * and gains the one thing it never had, a scope that can run out ('done') —
 * and "Pass all" is a new, much thinner promise on the same seam: the change
 * clauses are not asked at all.
 *
 * ── WHAT THIS FILE MEASURES
 *
 * §1 asks the release list itself (ui/battle.ts passAllRelease), DIFFERENTIALLY
 * wherever it can: the same board, the same arm, the two modes, and the answer
 * has to differ in exactly the way the two promises differ. A single-mode
 * assertion can pass while the mode is being ignored; a differential one cannot.
 * §2 drives the real client over the real wire (test/ui-driver.ts) rather than
 * reading ui/main.ts as source text — the house rule (223 §2, and the reason
 * two tests broke on a pure refactor in round 30).
 *
 * ── WHAT IS DELIBERATELY NOT HERE
 * The haste-step auto-answer (R245(b), `hasteAutoOut`) is a separate mechanism
 * that happens to ride in the same AutoPassPlan union. Nothing here touches it.
 *
 * Seeds 23000-23099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { armSnapshot, autoPassDecision, passAllRelease, passEndsBattlePhase } from '../ui/battle.ts';
import type { AutoPassArm, PassMode } from '../ui/inspect.ts';
import { pass, spawn, toDeployment, toNextBattle } from './util.ts';
import { client } from './ui-driver.ts';
import type { Action, EntityId, GameState, Seat } from '../src/types.ts';

/** the real client, driven — see test/ui-driver.ts */
const ui = await client();

/** a battle parked in a priority window belonging to the DEFENDER */
function battleWindow(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  spawn(h, D, 'Conduit of Pain');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  if (h.state.priority !== D) pass(h);
  assert.equal(h.state.priority, D, 'the fixture parks the defender in a priority window');
  return { h, A, D };
}

/** put an item on the stack. A real card name, so the board can render it. */
function push(s: GameState, id: number, card = 'Good Whale'): void {
  s.stack.push({
    id, kind: 'spell', card, label: card, controller: s.priority!,
    region: s.battle!.region, negated: false, parts: [],
  });
}

/**
 * The arm ui/main.ts really holds, in the mode named — ONE definition, shared
 * with the client through `armSnapshot`, so this cannot drift from what the
 * board carries (R245).
 */
const armFor = (s: GameState, legal: readonly Action[], mode: PassMode): AutoPassArm => ({
  armed: true, mode, prefOn: false, yieldIds: new Set<EntityId>(), ...armSnapshot(s, legal),
});

/* ══ §1 — the two promises, as a release list ═══════════════════════════ */

test('[123] an item that was on the stack when the chip was armed is never a change', () => {
  const { h, D } = battleWindow(23000);
  const s = h.state;
  push(s, 900); push(s, 901);
  const arm = armFor(s, legalActions(s, D), 'stack');
  assert.equal(passAllRelease(s, D, legalActions(s, D), arm), null,
    'the window it was armed in is not a change');

  // 901 resolves. 900 was in the scope the player said yes to, and it is still
  // the whole of the stack — "a pass is given to all effects that are currently
  // on the stack" means this one too.
  const later = structuredClone(s);
  later.stack = later.stack.filter(it => it.id === 900);
  assert.equal(passAllRelease(later, D, legalActions(later, D), arm), null,
    'the stack shrank towards the scope, which is the promise being KEPT');
});

test('[123] pass through stack finishes when the stack it was armed on has resolved', () => {
  const { h, D } = battleWindow(23001);
  const s = h.state;
  push(s, 900);
  const arm = armFor(s, legalActions(s, D), 'stack');
  const drained = structuredClone(s);
  drained.stack = [];
  assert.equal(passAllRelease(drained, D, legalActions(drained, D), arm), 'done',
    'the scope ran out — the promise is spent, and this is the terminus the old chip never had');
  // …and it is a release like any other: the chip comes off and passes nothing
  // on its way out.
  const plan = autoPassDecision(drained, D, legalActions(drained, D), arm);
  assert.deepEqual(plan, { disarm: true, pass: null },
    'a finished promise hands the window back rather than passing one more time');
});

test('[123] a stack item outside the armed scope hands priority back', () => {
  const { h, D } = battleWindow(23002);
  const s = h.state;
  push(s, 900);
  const arm = armFor(s, legalActions(s, D), 'stack');
  // the VYTV shape: the top resolves and something new goes on in the same
  // server batch, so the HEIGHT never moves. R245 made the clause ask by id.
  const swapped = structuredClone(s);
  swapped.stack = [];
  push(swapped, 901);
  assert.equal(swapped.stack.length, s.stack.length, 'the height is identical — that is the trap');
  assert.equal(passAllRelease(swapped, D, legalActions(swapped, D), arm), 'stack',
    'an id outside the scope is the "something changes" the button promises');
});

test('[123] pass all does not hand priority back for a new item or a new option', () => {
  const { h, D } = battleWindow(23003);
  const s = h.state;
  push(s, 900);
  const legal = legalActions(s, D);
  const scoped = armFor(s, legal, 'stack');
  const all = armFor(s, legal, 'all');

  // DIFFERENTIAL: one board, one snapshot, two promises. A single-mode
  // assertion can pass while the mode is being ignored entirely.
  const newItem = structuredClone(s);
  push(newItem, 901);
  assert.equal(passAllRelease(newItem, D, legalActions(newItem, D), scoped), 'stack');
  assert.equal(passAllRelease(newItem, D, legalActions(newItem, D), all), null,
    '"the player doesn t want priority until the next phase" — an opponent casting is not the next phase');

  const newOption = structuredClone(s);
  new E(newOption).createSpellToken(D, 'Fireball', 2, newOption.battle!.region);
  const optLegal = legalActions(newOption, D);
  assert.ok(optLegal.some(a => a.type === 'castSpellToken'), 'positive control: the option really appeared');
  assert.equal(passAllRelease(newOption, D, optLegal, scoped), 'ability');
  assert.equal(passAllRelease(newOption, D, optLegal, all), null,
    'nor is a new option of my own the next phase');

  // …and the drained scope is not a terminus for a promise that was never
  // scoped to a stack.
  const drained = structuredClone(s);
  drained.stack = [];
  assert.equal(passAllRelease(drained, D, legalActions(drained, D), scoped), 'done');
  assert.equal(passAllRelease(drained, D, legalActions(drained, D), all), null,
    'pass all is scoped to the PHASE, so an empty stack is just another window');
});

test('[123] pass all ends at the phase it was armed in, and the phase is read off the arm', () => {
  const { h, D } = battleWindow(23004);
  const s = h.state;
  const all = armFor(s, legalActions(s, D), 'all');
  assert.equal(all.armedPhase, 'battle', 'the arm records where it was made');

  const gone = structuredClone(s);
  gone.phase = 'deploy';
  assert.equal(passAllRelease(gone, D, legalActions(gone, D), all), 'phase',
    'the promise reached its own terminus');

  // DERIVED, NOT WRITTEN DOWN: the clause compares against the arm, so an arm
  // made in another phase releases in battle. A hard-coded `!== "battle"` —
  // which is what it was — cannot tell these two apart.
  const elsewhere: AutoPassArm = { ...all, armedPhase: 'deploy' };
  assert.equal(passAllRelease(s, D, legalActions(s, D), elsewhere), 'phase',
    '"until the next phase" is the arm s own answer, not a phase name in the client');
});

test('[123] pass all still stops on the one pass that would erase castable spell tokens', () => {
  const { h, D } = battleWindow(23005);
  // the GETD shape: ammunition held through the whole battle, standing in the
  // region the battle is being fought in, so it is castable in every window
  new E(h.state).createSpellToken(D, 'Fireball', 2, h.state.battle!.region);

  // …and walk the battle to the window whose pass leaves the phase, counting
  // how many windows of it a pass-all chip would have passed on the way. The
  // count is the argument: this clause fires AT the terminus, not before it.
  let passedThrough = 0;
  for (let i = 0; i < 40 && h.state.phase === 'battle'; i++) {
    if (passEndsBattlePhase(h.state, D)) break;
    const b = h.state.battle!;
    if (h.state.decision) {
      const dec = h.state.decision;
      h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, j) => j) });
    } else if (b.step === 'blocks' && b.defender === D) {
      // no blockers and nobody sent: round 1 ends the phase outright (R11 path)
      h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [] });
    } else if (h.state.priority === D) {
      const legal = legalActions(h.state, D);
      assert.equal(passAllRelease(h.state, D, legal, armFor(h.state, legal, 'all')), null,
        'no window before the last one is a reason for pass all to hand priority back');
      passedThrough++;
      pass(h);
    } else if (h.state.priority !== null) pass(h);
    else break;
  }
  assert.ok(passEndsBattlePhase(h.state, D), 'the fixture reached the pass that leaves the battle');
  assert.ok(passedThrough >= 2, `positive control: it passed real windows on the way (${passedThrough})`);

  const end = h.state;
  const legal = legalActions(end, D);
  assert.ok(legal.some(a => a.type === 'castSpellToken'), 'positive control: a token is still castable');
  for (const mode of ['stack', 'all'] as const) {
    assert.equal(passAllRelease(end, D, legal, armFor(end, legal, mode)), 'tokens',
      `${mode}: R11 erases them at Regroup and there is no undo`);
  }
});

test('[123] a promise with no scope cannot finish, so an arm naming no stack never says done', () => {
  const { h, D } = battleWindow(23006);
  const s = h.state;
  assert.equal(s.stack.length, 0, 'the fixture window really has an empty stack');
  const arm = armFor(s, legalActions(s, D), 'stack');
  assert.deepEqual(arm.armedItems, [], 'so the arm names no scope at all');
  assert.equal(passAllRelease(s, D, legalActions(s, D), arm), null,
    'a scope that was empty at the arm was never a promise, and cannot be spent');
  // the pre-R245 arm (no snapshot fields at all) is the same case, and the
  // suites that build one by hand — 77, 223 — go on meaning what they meant.
  const legacy: AutoPassArm = {
    armed: true, armedStack: 0, armedSig: [], prefOn: false, yieldIds: new Set<EntityId>(),
  };
  assert.equal(passAllRelease(s, D, legalActions(s, D), legacy), null,
    'an arm that carries no scope is not a finished one');
});

/* ══ §2 — the three buttons, on the real board ══════════════════════════ */

/** what seat `seat` is really looking at, over the real wire */
const show = (s: GameState, seat: Seat): string =>
  ui.join(viewFor(s, seat), seat, legalActions(s, seat));

/**
 * The NEXT authoritative state, as an update rather than a join.
 *
 * ⚠ A JOIN IS NOT A LATER WINDOW. ui/main.ts calls `resetUi()` on every
 * 'joined' — correctly: a (re)join is a fresh session and must not inherit an
 * arm nobody can see any more. So a test that shows the next state with `join`
 * watches the chip vanish for the wrong reason and passes whatever the release
 * list says. (It did, before this comment existed.)
 *
 * R150 then paces updates while a standing pass is armed (`holdable`), which
 * is exactly the case every test below is in, so the throttle is drained
 * through its own skip affordance rather than by waiting a real second.
 */
function arrive(s: GameState, seat: Seat): string {
  ui.update(viewFor(s, seat), legalActions(s, seat));
  // ⚠ WAS TRUE UNTIL R258, AND IS NOT ANY MORE: "a HELD update paints nothing
  // at all, so the skip chip is not on screen until something else repaints."
  // The chip is now a LIVE SLOT — a node `render()` leaves empty and
  // `paintLive()` fills from `pumpPace`, which is also where an arrival lands
  // — so it is normally on screen from the moment the hold starts. The two
  // harmless repaints below (the rules overlay, open and shut) stay because
  // they cost nothing and this fixture is about the pass buttons, not the
  // throttle; they are no longer load-bearing.
  ui.click({ btn: 'helpopen' }); ui.click({ btn: 'helpclose' });
  if (ui.has({ btn: 'paceskip' })) ui.click({ btn: 'paceskip' });
  const html = ui.html();
  assert.equal(/catching up \(/.test(html), false,
    'the throttle is still holding this state — the assertions below would be about the previous one');
  return html;
}

test('[123] the battle bar offers pass through stack only while there is a stack', () => {
  const { h, D } = battleWindow(23010);
  const empty = show(h.state, D);
  assert.ok(/data-btn="pass"/.test(empty), 'the plain Pass is always there');
  assert.equal(ui.has({ btn: 'passstack' }), false,
    'there is nothing on the stack to pass through — the affordance would be a lie');
  assert.ok(ui.has({ btn: 'passall' }), 'pass all is about the phase and needs no stack');

  const withStack = structuredClone(h.state);
  push(withStack, 900);
  show(withStack, D);
  assert.ok(ui.has({ btn: 'passstack' }), 'now there is a stack to pass through');
  assert.ok(ui.has({ btn: 'passall' }));
});

test('[123] each pass button arms a chip that names its own promise, and one stop drops it', () => {
  const { h, D } = battleWindow(23011);
  const s = structuredClone(h.state);
  push(s, 900);
  show(s, D);
  ui.sent();

  const armed = ui.click({ btn: 'passstack' });
  assert.deepEqual(ui.actions(), [{ type: 'passPriority', seat: D }],
    'arming a standing pass IS the pass for this window');
  assert.match(armed, /passing through the stack/,
    'the chip says which promise is running, because #123 is a player unable to predict it');
  assert.doesNotMatch(armed, /passing until the next phase/);

  const stopped = ui.click({ btn: 'passallstop' });
  assert.doesNotMatch(stopped, /passing through the stack/,
    'BL-18: whatever the client does for you, the stop is one click and always on screen');

  show(s, D);
  const all = ui.click({ btn: 'passall' });
  assert.match(all, /passing until the next phase/,
    'the other button makes the other promise, and says so');
  assert.doesNotMatch(all, /passing through the stack/);
  ui.click({ btn: 'passallstop' });
  ui.sent();
});

test('[123] pass through stack hands the window back once that stack has resolved', () => {
  const { h, D } = battleWindow(23012);
  const s = structuredClone(h.state);
  push(s, 900);
  show(s, D);
  ui.sent();
  assert.match(ui.click({ btn: 'passstack' }), /passing through the stack/);
  ui.sent();

  // the item resolved and the window came back round. Under the pre-R251 chip
  // this was a window like any other: the snapshot was re-taken, nothing was
  // "new", and it passed straight through into the rest of the battle.
  const after = structuredClone(s);
  after.stack = [];
  after.actionCount += 1;
  const back = arrive(after, D);
  assert.doesNotMatch(back, /passing through the stack/,
    'the effects the player said yes to are gone — the promise is spent');
  ui.tick();
  assert.deepEqual(ui.actions().filter(a => a.type === 'passPriority'), [],
    'and nothing was passed on the way out of it');
  assert.match(back, /data-btn="pass"/, 'the window is the player s again');
});

test('[123] an option that was on offer at the arm is not news several windows later', () => {
  /*
   * THE ONE BOUNDARY THE OTHER TESTS CANNOT SEE, and it is the R245 behaviour
   * this ruling removes: `ui/main.ts` used to RE-TAKE the snapshot at every
   * window the chip declined, so "what I had when I armed" quietly became
   * "what I had at the previous window".
   *
   * Almost everywhere the two agree, because any change releases the chip at
   * the window it appears in and there is no later window to disagree about.
   * They part company on an option that GOES AWAY and COMES BACK: the moving
   * baseline forgets it, so its return reads as something the game handed the
   * player, and the chip drops for an option they were already holding when
   * they clicked. A fixed scope — the owner s "effects that are CURRENTLY on
   * the stack", named once at the click — cannot make that mistake.
   *
   * The disappearance is arranged rather than played out (a spell token off
   * the board and back), because the PROPERTY is the promise and the route to
   * it is not: R213 made the point that a client judgement must be tested for
   * what it answers, not for the one story that produced it.
   */
  const { h, D } = battleWindow(23014);
  const s = structuredClone(h.state);
  push(s, 900);
  const tok = new E(s).createSpellToken(D, 'Fireball', 2, s.battle!.region).id;
  assert.ok(legalActions(s, D).some(a => a.type === 'castSpellToken'),
    'positive control: the option is on offer at the moment of the click');
  show(s, D);
  ui.sent();
  assert.match(ui.click({ btn: 'passstack' }), /passing through the stack/);
  ui.sent();

  // window 2: the option is gone. Nothing NEW appeared, so the chip is untouched
  // — and the moving baseline quietly forgets the option here.
  const gone = structuredClone(s);
  gone.entities[tok]!.absent = true;
  gone.actionCount += 1;
  assert.equal(legalActions(gone, D).some(a => a.type === 'castSpellToken'), false,
    'positive control: it really is off the table at this window');
  assert.match(arrive(gone, D), /passing through the stack/,
    'losing an option is not a reason to hand priority back');

  // window 3: it is back. It was in the armed scope, so it is not news.
  const back = structuredClone(gone);
  back.entities[tok]!.absent = false;
  back.actionCount += 1;
  assert.match(arrive(back, D), /passing through the stack/,
    'an option the player already had when they clicked is not something the game handed them');
  ui.click({ btn: 'passallstop' });
  ui.sent();
});

test('[123] pass all keeps passing through a window pass through stack would hand back', () => {
  const { h, D } = battleWindow(23013);
  const s = structuredClone(h.state);
  push(s, 900);
  show(s, D);
  ui.sent();
  ui.click({ btn: 'passall' });
  ui.sent();

  // the same arrival as the test above: the armed stack has resolved. The
  // stronger promise is not about the stack, so it is still running.
  const after = structuredClone(s);
  after.stack = [];
  after.actionCount += 1;
  const back = arrive(after, D);
  assert.match(back, /passing until the next phase/,
    'an empty stack is not the next phase');
  ui.tick();
  assert.deepEqual(ui.actions(), [{ type: 'passPriority', seat: D }],
    'and it really passes: the promise is kept by acting, not by sitting there');

  // …and it ends where it said it would.
  const nextPhase = structuredClone(after);
  nextPhase.phase = 'deploy';
  nextPhase.actionCount += 1;
  assert.doesNotMatch(arrive(nextPhase, D), /passing until the next phase/,
    'the phase turned over, which is the whole of what the button promised');
  ui.sent();
});
