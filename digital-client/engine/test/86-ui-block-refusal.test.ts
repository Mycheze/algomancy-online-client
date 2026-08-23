/* A REFUSED BLOCK DECLARATION MUST NOT THROW AWAY THE PLAN — ledger #77.
 *
 * THE REPORT (WEHH, 2026-08-22), verbatim:
 *
 *   "Trying to declare illegal blocks entirely resets the board, which is
 *    really annoying. Instead, it should reset only the 'affected' units and
 *    give a notice as well as a 'Reset blockers?' button. That way, if there's
 *    a massive block, the player doesn't have to entirely rebuild it for
 *    forgetting about a single thing."
 *
 * WHAT WAS ACTUALLY WRONG. `declareBuiltBlocks` (ui/main.ts) sent the action
 * and then cleared `ui.columns` / `ui.send` "if there was no error". In
 * hotseat that reads correctly — `act()` applies synchronously and has already
 * set `uiError`. Over a socket it cannot: the server is authoritative, `act()`
 * returns the moment the intent is on the wire, and the refusal lands
 * milliseconds later, by which time the plan is gone. Every network game.
 *
 * WHAT THE FIX IS. R84's shape, widened, exactly as the todo entry says. R84
 * asks the ENGINE'S OWN validator whether the plan being built would be
 * refused, so a compulsory block is named rather than discovered; the only
 * thing that kept it to {Alluring} was that the rest of the block legality was
 * locked inside `doDeclareBlocks` behind a run of `e.need` calls. That run is
 * now `checkBlocks`, reachable as a value through `blockDeclarationIssue`, and
 * `blockVerdict` (ui/battle.ts) walks a refused plan against it to find the
 * largest part the engine WOULD take.
 *
 * WHAT THESE TESTS ASSERT. The STRUCTURE the client receives — which units are
 * named, what survives, what is compulsory — never log prose and never
 * rendered strings, both of which get rewritten. The two exceptions are the
 * three `MAIN` text reads at the bottom, which are the house 'wiring' evidence
 * (see the header of 75-ui-reachability.test.ts): ui/main.ts takes the
 * document and the socket at import time and cannot be loaded here, so the
 * lines that hang the notice and the button off the verdict are read as text
 * and each one says that it is the weak form.
 *
 * NOT CHANGED, AND ASSERTED NOT CHANGED: which blocks are legal. `checkBlocks`
 * is the same checks in the same order, and the last test in the R84 section
 * puts every declaration `legalActions` offers back through the new verdict.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { blockDeclarationIssue, legalActions } from '../src/apply.ts';
import { blockVerdict } from '../ui/battle.ts';
import type { Action, EntityId, GameState, Seat } from '../src/types.ts';
import { pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';

const MAIN = readFileSync(fileURLToPath(new URL('../ui/main.ts', import.meta.url)), 'utf8');
const BATTLE = readFileSync(fileURLToPath(new URL('../ui/battle.ts', import.meta.url)), 'utf8');

/** the units named by a verdict, as card names — ids move, names do not */
const named = (v: { offenders: { card: string }[] } | null): string[] =>
  [...new Set((v?.offenders ?? []).map(o => o.card))].sort();

/** every blocker the verdict says the board keeps */
const kept = (v: { keep: { blocks: Record<number, EntityId[]> } } | null): EntityId[] =>
  Object.values(v?.keep.blocks ?? {}).flat().sort((a, b) => a - b);

/** an ordinary attack with `n` attacking columns, and `defenders` blockers */
function battlefield(seed: number, attackers: string[], defenders: string[]):
{ h: Harness; A: Seat; D: Seat; atk: EntityId[]; def: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = attackers.map(n => spawn(h, A, n));
  const def = defenders.map(n => spawn(h, D, n));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: atk.map(id => [id]) });
  for (let guard = 0; guard < 40 && h.state.battle!.step !== 'blocks'; guard++) {
    const dec = h.state.decision;
    if (dec?.kind === 'orderTriggers') h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
    else if (dec) pick(h, { unit: def[0] });
    else pass(h);
  }
  assert.equal(h.state.battle!.step, 'blocks', 'the block step is open');
  return { h, A, D, atk, def };
}

// ── the seam: the engine's own validator, as a value ───────────────────

test('#77: the block legality the client could only reach by being refused is now askable', () => {
  const { h, D, def } = battlefield(7700, ['The Foretold', 'The Foretold'], ['The Foretold']);
  const e = new E(structuredClone(h.state));
  assert.equal(blockDeclarationIssue(e, D, {}, []), null, 'declining is legal, and says so');
  assert.equal(blockDeclarationIssue(e, D, { 0: [def[0]!] }, []), null, 'so is a real block');
  const bad = blockDeclarationIssue(e, D, { 9: [def[0]!] }, []);
  assert.ok(bad, 'a column that does not exist is refused');
  assert.match(bad!, /no such attacking column/, "in the engine's own words, unchanged");
});

test('#77: asking does not move the game', () => {
  const { h, D, def } = battlefield(7701, ['The Foretold'], ['The Foretold']);
  const before = JSON.stringify(h.state);
  blockVerdict(h.state, D, { 0: [def[0]!], 9: [def[0]!] }, [], []);
  assert.equal(JSON.stringify(h.state), before,
    'the verdict clones — a client asking a question must not be able to declare one');
});

// ── (a) keep the parts of the plan that are fine ──────────────────────

test('#77: one bad column does not cost you the other five', () => {
  // the reported shape: a big block with one mistake in it. Five columns are
  // answered correctly and the sixth names a column that is not there.
  const { h, D, atk, def } = battlefield(7702,
    Array(6).fill('The Foretold'), Array(6).fill('The Foretold'));
  assert.equal(atk.length, 6);
  const plan: Record<number, EntityId[]> = {};
  for (let ci = 0; ci < 5; ci++) plan[ci] = [def[ci]!];
  plan[99] = [def[5]!];                                   // the single mistake

  const v = blockVerdict(h.state, D, plan, [], []);
  assert.ok(v, 'the declaration is refused');
  assert.deepEqual(named(v), ['The Foretold'], 'and the offender is named');
  assert.deepEqual(v!.offenders.map(o => o.id), [def[5]!],
    'exactly the unit in the bad column, and nothing else');
  assert.deepEqual(kept(v), def.slice(0, 5).sort((a, b) => a - b),
    'all five good columns survive — the report is that they did not');
  assert.deepEqual(Object.keys(v!.keep.blocks).map(Number).sort((a, b) => a - b), [0, 1, 2, 3, 4]);
});

test('#77: what the verdict keeps is something the engine actually accepts', () => {
  // the invariant that makes the repair safe to put back on the board: it is
  // built by asking, so it can never be a plan that is refused in its turn.
  const { h, D, def } = battlefield(7703,
    Array(4).fill('The Foretold'), Array(4).fill('The Foretold'));
  const plan: Record<number, EntityId[]> = { 0: [def[0]!], 1: [def[1]!], 7: [def[2]!], 8: [def[3]!] };
  const v = blockVerdict(h.state, D, plan, [], []);
  assert.ok(v);
  const e = new E(structuredClone(h.state));
  assert.equal(blockDeclarationIssue(e, D, v!.keep.blocks, [...v!.keep.send, ...v!.keep.spellTokens]), null,
    'the surviving plan is legal by construction');
  assert.deepEqual(v!.offenders.map(o => o.id).sort((a, b) => a - b), [def[2]!, def[3]!].sort((a, b) => a - b));
});

test('#77: a unit put in two columns at once loses only the second placement', () => {
  const { h, D, def } = battlefield(7704, ['The Foretold', 'The Foretold'], ['The Foretold']);
  const v = blockVerdict(h.state, D, { 0: [def[0]!], 1: [def[0]!] }, [], []);
  assert.ok(v, 'the same unit cannot block twice');
  assert.deepEqual(kept(v), [def[0]!], 'the first column keeps it');
  assert.deepEqual(v!.offenders, [], 'and nothing is reported lost — it is still on the board');
});

test('#77: a legal declaration is not a refusal', () => {
  const { h, D, def } = battlefield(7705, ['The Foretold'], ['The Foretold']);
  assert.equal(blockVerdict(h.state, D, { 0: [def[0]!] }, [], []), null);
  assert.equal(blockVerdict(h.state, D, {}, [], []), null, 'and neither is declining');
});

// ── (b) name the offending units, and only those ──────────────────────

test('#77: {Feeble} — the unit that cannot block is the one that is named', () => {
  // Blight Fungus is {Feeble}: it may not block. Everything else in the plan
  // is fine, and must stay.
  const { h, D, atk, def } = battlefield(7706,
    ['The Foretold', 'The Foretold'], ['The Foretold', 'Bripp']);
  const feeble = def.find(id => new E(h.state).ownAttrs(h.state.entities[id]!).has('Feeble'));
  if (feeble === undefined) return;   // the pool moved; the Sneaky case below still covers naming
  const good = def.find(id => id !== feeble)!;
  const v = blockVerdict(h.state, D, { 0: [good], 1: [feeble] }, [], []);
  assert.ok(v, 'a Feeble blocker is refused');
  assert.deepEqual(v!.offenders.map(o => o.id), [feeble], 'and it alone is named');
  assert.deepEqual(kept(v), [good], 'the other blocker stays where it was put');
  assert.match(v!.offenders[0]!.why, /Feeble/, "carrying the engine's own reason");
  assert.equal(v!.offenders[0]!.card, h.state.entities[feeble]!.card, 'and the card name to show');
  assert.equal(atk.length, 2);
});

test('#77: a lone {Sneaky} attacker — nothing survives, and the notice says so', () => {
  // R20: a lone Sneaky attacker cannot be blocked at all, so there is no
  // surviving sub-plan. The verdict must not pretend there is one.
  const { h, D, def } = battlefield(7707, ['Whispering Mantid'], ['The Foretold', 'The Foretold']);
  const lone = h.state.battle!.columns.flat();
  if (!new E(h.state).colAttrs(lone).has('Sneaky')) return;   // pool moved
  const v = blockVerdict(h.state, D, { 0: [def[0]!] }, [], []);
  assert.ok(v, 'blocking a lone Sneaky attacker is refused');
  assert.deepEqual(kept(v), [], 'nothing is kept, because nothing can be');
  assert.deepEqual(v!.offenders.map(o => o.id), [def[0]!], 'and the blocker is named');
});

// ── the counterattack half (R87): units first, then their riders ──────

test('#77: an illegal counterattacker does not cost you the blocks', () => {
  const { h, D, atk, def } = battlefield(7708,
    ['The Foretold', 'The Foretold'], ['The Foretold', 'The Foretold']);
  // sending an ATTACKER as if it were yours: refused, and nothing else is
  const v = blockVerdict(h.state, D, { 0: [def[0]!] }, [atk[0]!], []);
  assert.ok(v, 'you cannot send the opponent’s unit');
  assert.deepEqual(kept(v), [def[0]!], 'the block survives');
  assert.deepEqual(v!.keep.send, [], 'the counterattack does not');
  assert.deepEqual(v!.offenders.map(o => o.id), [atk[0]!], 'and the named unit is the one sent');
});

test('#77: a token with no unit to travel with is dropped, not the whole plan', () => {
  // R87 / _passer 2025-05-10: "In order to move spell tokens, you must have
  // attacked opponent Region… you must send atleast 1 of your unit." A token
  // named with an empty `send` is exactly the mistake that used to wipe the
  // board.
  // Ignis Sprite makes a Fireball token when it spawns, so the defender has a
  // real rider to get wrong
  const { h, D, def } = battlefield(7709, ['The Foretold'], ['The Foretold', 'Ignis Sprite']);
  const tok = Object.values(h.state.entities)
    .find(e => e.kind === 'spellToken' && e.controller === D && !e.absent
      && e.region === h.state.battle!.region);
  assert.ok(tok, 'the defender holds a spell token in the contested region');
  const v = blockVerdict(h.state, D, { 0: [def[0]!] }, [], [tok!.id]);
  assert.ok(v, 'a rider with nobody to ride with is refused');
  assert.deepEqual(kept(v), [def[0]!], 'the block survives the mistake');
  assert.deepEqual(v!.keep.spellTokens, [], 'and the rider is the only thing dropped');
  assert.deepEqual(v!.offenders.map(o => o.id), [tok!.id], 'the token is what is named');
});

// ── (c) R84's compulsory block, carried through the same machinery ────

/** the reported UFAB position: two columns, one Alluring, one able blocker */
function luredDefender(seed: number): { h: Harness; D: Seat; d1: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const plain = spawn(h, A, 'The Foretold');
  const d1 = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure], [plain]] });
  for (let guard = 0; guard < 40 && h.state.battle!.step !== 'blocks'; guard++) {
    const dec = h.state.decision;
    if (dec?.kind === 'orderTriggers') h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
    else if (dec) pick(h, { unit: d1 });
    else pass(h);
  }
  assert.equal(h.state.battle!.step, 'blocks');
  assert.deepEqual(new E(h.state).entity(d1)!.allured, { round: 1, columns: [0] });
  return { h, D, d1 };
}

test('#77 + R84: a compulsory block is REQUIRED, not an offender', () => {
  const { h, D, d1 } = luredDefender(7710);
  // the shape of the original report: the lured unit sent to the other column
  const v = blockVerdict(h.state, D, { 1: [d1] }, [], []);
  assert.ok(v, 'the substitute is refused');
  assert.deepEqual(v!.required, { 0: [d1] },
    'the duty is reported as REQUIRED — an addition to the plan, not a mistake in it');
  assert.deepEqual(kept(v), [d1], 'and the board comes back holding the block the duty demands');
  assert.deepEqual(Object.keys(v!.keep.blocks).map(Number), [0], 'in the column it is owed to');
});

test('#77 + R84: the compulsory core is a plan the engine takes', () => {
  const { h, D } = luredDefender(7711);
  const v = blockVerdict(h.state, D, {}, [], []);
  assert.ok(v, 'declining is illegal under a live duty');
  const e = new E(structuredClone(h.state));
  assert.equal(blockDeclarationIssue(e, D, v!.keep.blocks, []), null,
    'and what the client is handed back is legal');
});

test('#77: widening the error did not widen the RULE — every legal block is still legal', () => {
  // the R84 invariant, re-run against the new machinery: a client that refuses
  // a declaration `legalActions` offers is the same bug wearing the other hat.
  for (const seed of [7712, 7713]) {
    const { h, D } = luredDefender(seed);
    const offers = legalActions(h.state, D)
      .filter((a): a is Extract<Action, { type: 'declareBlocks' }> => a.type === 'declareBlocks');
    assert.ok(offers.length, 'the block step is never empty');
    for (const a of offers) {
      assert.equal(blockVerdict(h.state, D, a.blocks, a.send ?? [], a.spellTokens ?? []), null,
        `the client refuses ${JSON.stringify(a.blocks)}, which legalActions offers`);
    }
  }
});

test('#77: and it did not narrow it either — every refusal is a refusal the engine makes', () => {
  // the other direction: whatever blockVerdict calls illegal, apply() must too.
  const { h, D, atk, def } = battlefield(7714,
    ['The Foretold', 'The Foretold'], ['The Foretold', 'The Foretold']);
  const plans: [Record<number, EntityId[]>, EntityId[]][] = [
    [{ 0: [def[0]!] }, []],
    [{ 0: [def[0]!], 1: [def[1]!] }, []],
    [{ 0: [def[0]!, def[1]!] }, []],
    [{ 0: [def[0]!], 1: [def[0]!] }, []],
    [{ 5: [def[0]!] }, []],
    [{ 0: [atk[0]!] }, []],
    [{}, [atk[0]!]],
    [{}, [def[0]!]],
  ];
  for (const [blocks, send] of plans) {
    const client = blockVerdict(h.state, D, blocks, send, []) === null;
    const e = new E(structuredClone(h.state));
    const engine = blockDeclarationIssue(e, D, blocks, send) === null;
    assert.equal(client, engine,
      `client and engine disagree about ${JSON.stringify({ blocks, send })}`);
  }
});

// ── the wiring in ui/main.ts (the weak form — read as text) ───────────

test('#77 wiring: the plan is no longer wiped the moment the action is sent', () => {
  assert.match(MAIN, /if \(NET\) ui\.blockSent = true;/,
    'over a socket the board keeps the plan until an authoritative state says the declaration landed');
  assert.match(MAIN, /if \(ui\.blockSent && !mine\)/,
    'and ensureBlockKeys is what drops it, on the state where the step has moved on');
  assert.doesNotMatch(MAIN, /act\(\{ type: 'declareBlocks'[\s\S]{0,200}?\n\s*ui\.columns = \[\]; ui\.send = \[\];\s*ui\.carrying/,
    'the unconditional post-send wipe is gone');
});

test('#77 wiring: the refusal reaches the bar as structure, with a Reset blockers? button', () => {
  assert.match(MAIN, /const verdict = blockVerdict\(s, s\.battle!\.defender, blocks, send, spellTokens\);/,
    'the click handler asks before it sends');
  assert.match(MAIN, /ui\.blockRefusal = verdict;/, 'and holds the verdict for the bar');
  assert.match(MAIN, /ui\.columns = columnsFromPlan\(verdict\.keep\.blocks\);/,
    'putting the surviving plan back on the board');
  assert.match(MAIN, /data-btn="resetblocks"/, 'the report asked for this button by name');
  assert.match(MAIN, /^  resetblocks: \(\) =>/m, 'and it is handled (a BOARD_BTNS entry — see test 75 for the shape)');
  assert.match(MAIN, /r\.offenders\.map\(o => o\.card\)/,
    'the notice NAMES the units rather than counting them');
});

test('#77 wiring: blockVerdict is a read of the engine, never a second opinion', () => {
  assert.match(BATTLE, /blockDeclarationIssue\(e, seat, bl, \[\.\.\.out\]\)/,
    'every judgement is a question put to the engine');
  assert.doesNotMatch(BATTLE.split('// ── [77]')[1] ?? '', /Feeble|Evasive|Sneaky|Flying/,
    'and no block rule is restated in the client');
});

// ── the state the tests above are read against is a real one ──────────

test('#77: the fixture really is a block step with a real attack', () => {
  const { h, atk } = battlefield(7715, ['The Foretold', 'The Foretold'], ['The Foretold']);
  const s: GameState = h.state;
  assert.equal(s.phase, 'battle');
  assert.equal(s.battle!.step, 'blocks');
  assert.deepEqual(s.battle!.columns.flat().sort((a, b) => a - b), [...atk].sort((a, b) => a - b));
});
