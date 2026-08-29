/* R194 / CARD-TODO #55 — THE ONE TOKEN LOSS NOBODY WAS TOLD ABOUT.
 *
 * ── THE REPORT, AND THE HOLE LEFT IN IT
 *
 * Playtest #66 (GETD): *"The UI is reminding me I have unused tokens at EVERY
 * chance it has. It should only warn right before moving to Regroup ('You're
 * about to move to Regroup which will remove your Spell Tokens. Are you
 * sure?')"* — the owner's own replacement copy.
 *
 * That shipped: `passEndsBattlePhase` (ui/battle.ts) asks the sharp question,
 * derived from the engine's own chain, and 77-playtest-round17.test.ts holds
 * it against that chain at every priority window of a real battle. But a
 * confirm can only hang on a PASS, and #66's own note admitted a case with no
 * pass in it:
 *
 *     if the round-2 attacker DECLINES, `doDeclareAttack` calls
 *     `endBattleRound` directly, so a defender holding castable spell tokens
 *     gets no window to be warned in and loses them silently.
 *
 * A 2026-08-25 guard audit downgraded #66 from `fixed` to `partial` on that
 * sentence and filed the gap as CT-55. *"Cannot be closed CLIENT-side"* is
 * true and is not the same as cannot be closed.
 *
 * ── WHAT THIS FILE PROVES, IN ORDER
 *
 * §1 THE PREMISE, first, because the last round burned itself generalising a
 *    combat seam on a gap that turned out to be unreachable. The state is
 *    reachable and the ammunition is real: round 2's battle region is the
 *    INITIATIVE player's home (`startBattleRound` puts the battle in the
 *    defender's region), so a token standing at home is castable in round 2's
 *    windows and in no round-1 window at all — which makes a round-2 decline
 *    the difference between a live Fireball and nothing.
 *
 * §2 THE GAP, closed. R194 announces the loss inside `startRegroup`, per seat,
 *    before the erase. Route (1) — opening the window the decline skips — was
 *    rejected on measurement, not taste; see docs/digital-rules.md ## R194.
 *
 * §3 THE CONTROLS, which are the ORIGINAL REPORT: the pass confirm still fires
 *    on the pass that reaches Regroup, and on no other window of the same
 *    battle. A fix for the gap that re-armed the old noise would be a
 *    regression to #66 itself.
 *
 * Seeds 1650-1699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import { passEndsBattlePhase, tokensAtRisk } from '../ui/battle.ts';
import { pass, spawn, toDeployment, toNextBattle } from './util.ts';
import { client, closeLog, openLog } from './ui-driver.ts';
import type { EngineEvent, EntityId, Seat } from '../src/types.ts';

/** the real client, driven — see test/ui-driver.ts */
const ui = await client();

/**
 * A battle phase about to begin, with the INITIATIVE player holding spell
 * tokens at home.
 *
 * IT is the round-1 attacker and therefore the round-2 DEFENDER — the seat
 * CT-55 is about. Their tokens stand in their own home region, which is round
 * 2's battle region and is NOT round 1's, so nothing in round 1 can cast them.
 */
function tokensAtHome(seed: number, cards: [string, number][] = [['Fireball', 2]]): {
  h: Harness; A: Seat; D: Seat; atk: EntityId; def: EntityId; toks: EntityId[];
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  const def = spawn(h, D, 'Conduit of Pain');
  toNextBattle(h, A);
  const e = new E(h.state);
  const toks = cards.map(([card, x]) => e.createSpellToken(A, card, x, e.homeRegion(A)).id);
  e.settle();
  assert.equal(h.state.battle!.step, 'declare', 'the fixture really is at round 1s declare step');
  return { h, A, D, atk, def, toks };
}

/** every line R194 wrote into this batch of events */
const lossLines = (evs: readonly EngineEvent[]): EngineEvent[] =>
  evs.filter(e => /unused spell token\(s\) to regroup/.test(e.msg));

/** answer whatever decision is pending, taking every option offered */
function settleDecisions(h: Harness): void {
  while (h.state.decision) {
    const dec = h.state.decision;
    h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
  }
}

/* ── §1. the premise ──────────────────────────────────────────────────── */

test('[CT-55] the premise: a round-2 defender really is holding castable tokens when the attacker declines', () => {
  const { h, A, D, atk, def, toks } = tokensAtHome(1650);
  const home = new E(h.state).homeRegion(A);

  // round 1 is fought in the DEFENDER's region, so IT's tokens are out of play
  assert.equal(h.state.battle!.region, new E(h.state).homeRegion(D));
  assert.equal(h.state.entities[toks[0]!]!.region, home);

  // …and the whole of round 1 confirms it: not one window can cast them
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let round1Windows = 0;
  let guard = 40;
  while (h.state.phase === 'battle' && h.state.battleRound === 1 && guard-- > 0) {
    const s = h.state;
    if (s.decision) { settleDecisions(h); continue; }
    if (s.priority !== null) {
      round1Windows++;
      assert.equal(legalActions(s, A).filter(a => a.type === 'castSpellToken').length, 0,
        'a token at home is not castable in a battle fought in the other region');
      pass(h);
      continue;
    }
    if (s.battle!.step === 'blocks') {
      h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [def] });
      continue;
    }
    break;
  }
  assert.ok(round1Windows >= 4, `only ${round1Windows} round-1 windows — the walk did not cover round 1`);

  // round 2: the NIT is the attacker, the battle is in IT's home region, and
  // the tokens are ammunition again — this is the state CT-55 is about
  const s = h.state;
  assert.equal(s.battleRound, 2);
  assert.equal(s.battle!.step, 'declare');
  assert.equal(s.battle!.attacker, D, 'round 2 belongs to the non-initiative player');
  assert.equal(s.battle!.defender, A);
  assert.equal(s.battle!.region, home, 'and it is fought where the defender keeps their tokens');
  assert.equal(s.priority, null, 'the declare step opens no priority window');

  // the counterfactual, on the same position: if the attacker ATTACKS, the
  // defender is offered the cast and is warned on the pass that ends it
  const attacked = new Harness(0);
  attacked.state = structuredClone(s);
  attacked.do({ type: 'declareAttack', seat: D, columns: [[def]] });
  let castable = 0, warned = 0, windows = 0;
  guard = 40;
  while (attacked.state.phase === 'battle' && guard-- > 0) {
    const t = attacked.state;
    if (t.decision) { settleDecisions(attacked); continue; }
    if (t.priority !== null) {
      windows++;
      if (legalActions(t, A).some(a => a.type === 'castSpellToken')) castable++;
      if (t.priority === A && tokensAtRisk(t, A, legalActions(t, A)) > 0) warned++;
      pass(attacked);
      continue;
    }
    if (t.battle!.step === 'blocks') {
      attacked.do({ type: 'declareBlocks', seat: A, blocks: {}, send: [] });
      continue;
    }
    break;
  }
  assert.ok(castable >= 3, `the token was castable in only ${castable} of ${windows} round-2 windows`);
  assert.equal(warned, 1, 'and exactly one of those windows is the one that warns');

  // …which is the whole point: the decline takes all of that away
  h.do({ type: 'declareAttack', seat: D, columns: [] });
  assert.notEqual(h.state.phase, 'battle', 'a declined round 2 goes straight to regroup');
  assert.equal(h.state.entities[toks[0]!], undefined, 'and the token is gone');
});

/* ── §2. the gap ──────────────────────────────────────────────────────── */

test('[CT-55] a round-2 attacker who declines no longer erases the defenders spell tokens in silence', () => {
  const { h, A, D, atk, def, toks } = tokensAtHome(1651, [['Fireball', 2], ['Poison', 1]]);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let guard = 40;
  while (h.state.battleRound === 1 && guard-- > 0) {
    const s = h.state;
    if (s.decision) { settleDecisions(h); continue; }
    if (s.priority !== null) { pass(h); continue; }
    if (s.battle!.step === 'blocks') { h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [def] }); continue; }
    break;
  }
  assert.equal(h.state.battleRound, 2);
  assert.equal(h.state.battle!.attacker, D);

  // the decline, through the real action — no hand-built state, no direct
  // call to startRegroup
  const at = h.log.length;
  h.do({ type: 'declareAttack', seat: D, columns: [] });
  const said = h.log.slice(at);

  const line = said.find(l => /unused spell token\(s\) to regroup/.test(l));
  assert.ok(line,
    'CT-55: the defender lost two castable tokens on a path with no priority window in it — '
    + `the log must say so. It said:\n  ${said.join('\n  ')}`);
  assert.equal(line,
    `${h.state.players[A]!.name} loses 2 unused spell token(s) to regroup: Fireball 2, Poison 1.`);
  assert.equal(h.state.entities[toks[0]!], undefined, 'the tokens really did go');
  assert.equal(h.state.entities[toks[1]!], undefined);
});

test('[CT-55] a battle both players decline opens no priority window at all, and the loss is still announced', () => {
  const { h, A, D, toks } = tokensAtHome(1652);
  const at = h.log.length;

  // the starkest shape, and the one #66's note did not reach: round 1 is
  // declined too, so the whole battle phase contains zero priority windows
  h.do({ type: 'declareAttack', seat: A, columns: [] });
  assert.equal(h.state.battleRound, 2);
  assert.equal(h.state.priority, null);
  h.do({ type: 'declareAttack', seat: D, columns: [] });

  assert.notEqual(h.state.phase, 'battle');
  assert.equal(h.state.entities[toks[0]!], undefined);
  assert.ok(h.log.slice(at).includes(
    `${h.state.players[A]!.name} loses 1 unused spell token(s) to regroup: Fireball 2.`),
  'no window ever opened, so the announcement is the only thing that can tell them');
});

test('[CT-55] the announcement is per seat, in a fixed order, and silent when there is nothing to lose', () => {
  // both seats holding, so the ordering and the addressing both have to be right
  const { h, A, D } = tokensAtHome(1653, [['Fireball', 2]]);
  const e = new E(h.state);
  e.createSpellToken(D, 'Poison', 1, e.homeRegion(D));
  e.settle();
  const at = h.log.length;
  h.do({ type: 'declareAttack', seat: A, columns: [] });
  h.do({ type: 'declareAttack', seat: D, columns: [] });
  const lines = h.log.slice(at).filter(l => /unused spell token\(s\) to regroup/.test(l));
  assert.equal(lines.length, 2, 'one line each — a seat is told about its own tokens, not the pile');
  const card = (seat: Seat): string => (seat === A ? 'Fireball 2' : 'Poison 1');
  assert.deepEqual(lines, ([0, 1] as Seat[]).map(seat =>
    `${h.state.players[seat]!.name} loses 1 unused spell token(s) to regroup: ${card(seat)}.`),
  'seat 0 before seat 1, every time');

  // …and a regroup with no tokens in it says nothing. #66 is a report about
  // being told the same thing too often; a line per regroup forever would be
  // the same mistake in the log.
  const quiet = new Harness(1654);
  toDeployment(quiet);
  toNextBattle(quiet, quiet.state.initiative);
  const at2 = quiet.log.length;
  quiet.do({ type: 'declareAttack', seat: quiet.state.battle!.attacker, columns: [] });
  quiet.do({ type: 'declareAttack', seat: quiet.state.battle!.attacker, columns: [] });
  assert.equal(quiet.state.phase === 'battle', false);
  assert.deepEqual(quiet.log.slice(at2).filter(l => /unused spell token/.test(l)), [],
    'nothing was lost, so nothing is said');
});

test('[CT-55] the client puts the announcement in front of the player who lost the tokens', () => {
  const { h, A, D, toks } = tokensAtHome(1655, [['Fireball', 2]]);
  // the defender is watching the round-2 declare step with no window of their
  // own — exactly what the seat CT-55 is about sees
  h.do({ type: 'declareAttack', seat: A, columns: [] });
  ui.join(h.state, A, legalActions(h.state, A));

  const evs: EngineEvent[] = [];
  const before = h.log.length;
  h.do({ type: 'declareAttack', seat: D, columns: [] });
  for (let i = before; i < h.log.length; i++) evs.push({ type: 'info', msg: h.log[i]! });
  assert.ok(lossLines(evs).length === 1, 'the fixture produced the line to deliver');

  // …delivered the way the server delivers a batch, and read off the screen.
  //
  // ⚠ CT-124/#131 — AND THIS IS NOW BEHIND A CLICK. CT-55's whole point was
  // "put the announcement in front of the player who lost the tokens", and the
  // only surface it was ever put on was the game log, which report #131 has
  // just hidden by default. The line still reaches the screen and this guard
  // still holds it down; what it no longer holds down is the word IN FRONT OF.
  // Flagged for the owner in R253 rather than papered over here: a second
  // surface for it (a toast, the way CT-78's glimpse got its own notice) is a
  // product call, not a refactor.
  ui.update(h.state, legalActions(h.state, A), { events: evs });
  const html = openLog(ui);
  assert.ok(html.includes(`${h.state.players[A]!.name} loses 1 unused spell token(s) to regroup`),
    'the announcement has to reach the screen, not just the event stream');
  assert.equal(h.state.entities[toks[0]!], undefined);
  closeLog(ui);
});

/* ── §2b. THE REGRESSION R194 ALMOST SHIPPED ───────────────────────────
 *
 * `ev()` keeps the R65 erased pile centrally: ANY `'erased'` event carrying a
 * numeric `seat` has its `cards` (or `card`) pushed onto that seat's public
 * erased list. R194's announcement is an `'erased'` event with a `seat`, so
 * passing `cards` put every unused spell token into the pile.
 *
 * That reverses a rule stated TEN LINES BELOW the announcement, in the R89
 * block: *"The augment reaches the public erased pile (R65) exactly as it
 * would if the token had been cast and discharged; the TOKEN itself does not,
 * because a spell token is not a card and has never been recorded there."*
 *
 * The log line already names the tokens as text and `ids` carries them for the
 * client, so the payload key was pure leakage into a zone query. Found by the
 * round-27 class-widening audit, hours after R194 landed — the announcement
 * was correct and its PAYLOAD was not.
 */
test('[CT-55] the announcement does not put spell tokens into the public erased pile (R65)', () => {
  const { h, A, D, toks } = tokensAtHome(1661);
  assert.equal(h.state.entities[toks[0]!]!.kind, 'spellToken', 'fixture: a token to lose');
  const before = [...(h.state.players[A]!.erased ?? [])];
  h.do({ type: 'declareAttack', seat: A, columns: [] });
  h.do({ type: 'declareAttack', seat: D, columns: [] });
  assert.equal(h.state.entities[toks[0]!], undefined, 'fixture: the token really was erased');
  assert.deepEqual(h.state.players[A]!.erased ?? [], before,
    'a spell token is not a card and has never been recorded in the erased pile — '
    + 'the R89 block ten lines below startRegroup says so');
});

/* ── §3. the controls: report #66 itself, still fixed ─────────────────── */

test('[66] control: the Regroup confirm still fires on the pass that reaches Regroup', () => {
  const { h, A, D, def, toks } = tokensAtHome(1656);
  h.do({ type: 'declareAttack', seat: A, columns: [] });      // round 1 declined
  h.do({ type: 'declareAttack', seat: D, columns: [[def]] }); // round 2 is fought
  let guard = 40;
  while (h.state.phase === 'battle' && h.state.battle!.step !== 'afterWindow' && guard-- > 0) {
    const s = h.state;
    if (s.decision) { settleDecisions(h); continue; }
    if (s.priority !== null) { pass(h); continue; }
    if (s.battle!.step === 'blocks') { h.do({ type: 'declareBlocks', seat: A, blocks: {}, send: [] }); continue; }
    break;
  }
  settleDecisions(h);
  assert.equal(h.state.battle!.step, 'afterWindow', 'parked in the last window of the battle');
  if (h.state.priority !== A) pass(h);
  const s = h.state;
  assert.equal(passEndsBattlePhase(s, A), true);
  assert.equal(tokensAtRisk(s, A, legalActions(s, A)), 1,
    '[66] the one pass that erases them is still the one that warns');
  assert.equal(h.state.entities[toks[0]!]!.kind, 'spellToken', 'and the token is still there to lose');
});

test('[66] control: …and on no other window of the same battle', () => {
  const { h, A, atk, def } = tokensAtHome(1657);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let windows = 0, warned = 0;
  let guard = 60;
  while (h.state.phase === 'battle' && guard-- > 0) {
    const s = h.state;
    if (s.decision) { settleDecisions(h); continue; }
    if (s.priority !== null) {
      if (s.priority === A) {
        windows++;
        if (tokensAtRisk(s, A, legalActions(s, A)) > 0) warned++;
      }
      pass(h);
      continue;
    }
    if (s.battle!.step === 'declare') {
      h.do({ type: 'declareAttack', seat: s.battle!.attacker, columns: [[def]] });
      continue;
    }
    if (s.battle!.step === 'blocks') {
      // R87: only round 1 has a counterattack to send anybody out with
      h.do({ type: 'declareBlocks', seat: s.battle!.defender, blocks: {},
        send: s.battle!.round === 1 ? [def] : [] });
      continue;
    }
    break;
  }
  assert.ok(windows >= 5, `only ${windows} windows belonged to the token holder — walk too short`);
  assert.equal(warned, 1,
    `[66] "reminding me I have unused tokens at EVERY chance it has" — ${warned} of ${windows} `
    + 'windows may warn, and it must be the last one');
});
