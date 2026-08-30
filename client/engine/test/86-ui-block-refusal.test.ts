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
 * rendered strings, both of which get rewritten.
 *
 * …and then the WIRING, which used to be three `assert.match(MAIN, /…/)` reads
 * of ui/main.ts because "main.ts takes the document and the socket at import
 * time and cannot be loaded here". It can: test/ui-driver.ts gives it a small
 * browser and a socket we hold the far end of, so the report is now asserted
 * by placing a blocker, pressing Confirm and looking at the board. Exactly one
 * source read survives, on the one branch no sequence of clicks can reach (the
 * post-send verdict — see the comment on that test), and it is written without
 * an indent or a line-break anchor so a reformat cannot quietly delete it.
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
import { blockVerdict } from '../../ui/battle.ts';
import type { Action, EntityId, GameState, Seat } from '../src/types.ts';
import { finishBattle, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';
import { client, idsIn, zone } from './ui-driver.ts';

const MAIN = readFileSync(fileURLToPath(new URL('../../ui/main.ts', import.meta.url)), 'utf8');
const BATTLE = readFileSync(fileURLToPath(new URL('../../ui/battle.ts', import.meta.url)), 'utf8');

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

/* ── the wiring, driven ────────────────────────────────────────────────
 *
 * These three used to be `assert.match(MAIN, /…/)` reads of ui/main.ts, and
 * two of them were anchored on FORMATTING — `/^  resetblocks: \(\) =>/m`
 * demanded a two-space indent, and one demanded a statement stay on a single
 * line. That is a guard that breaks on a reformat and holds while the
 * behaviour rots, which is what commit e43e51a repaired two of elsewhere.
 *
 * ui/main.ts can in fact be driven — see test/ui-driver.ts. So the report is
 * now asserted the way a player would find it: place a blocker, press Confirm,
 * and look at the board.
 */

const ui = await client();

/** put the board in front of seat D at the block step, as the server does */
const seated = (h: Harness, D: Seat): string => ui.join(h.state, D, legalActions(h.state, D));

/** place `blocker` into the front row of attacking column `ci` by clicking */
function placeBlocker(blocker: EntityId, ci: number): string {
  ui.click({ act: 'unit', id: String(blocker) });
  return ui.click({ act: 'slot', ci: String(ci), row: '0' });
}

test('#77: a sent block declaration leaves the plan standing on the board', () => {
  // THE REPORT. Over a socket, `act()` returns the moment the intent is on the
  // wire — the old code cleared ui.columns right there, so the whole plan was
  // gone before the server had said anything about it at all.
  const { h, D, def } = battlefield(7720, ['The Foretold', 'The Foretold'], ['The Foretold']);
  seated(h, D);
  ui.sent();                                        // drop the 'building' relay
  placeBlocker(def[0]!, 0);
  const board = ui.click({ btn: 'confirmblocks' });

  const acts = ui.actions();
  assert.equal(acts.length, 1, 'exactly one declaration went out');
  assert.equal(acts[0]!.type, 'declareBlocks');
  assert.deepEqual((acts[0] as { blocks: Record<number, EntityId[]> }).blocks, { 0: [def[0]!] });

  // …and the plan is STILL on the board. A placed blocker is out of its
  // region (it is standing in the column), so finding it back home is exactly
  // the reported symptom — the board reset itself.
  assert.ok(!idsIn(zone(board, `field:${D}`)).includes(def[0]!),
    'the blocker fell back into its region the instant Confirm was pressed — the plan was wiped '
    + 'before the server ever answered, which is ledger #77 verbatim');
  assert.ok(ui.has({ btn: 'clearform' }),
    'and the board still knows it is holding a declaration being built');
});

test('#77: …and drops it only when an authoritative state says the declaration landed', () => {
  // the other half: holding the plan for ever would be its own bug of exactly
  // the same shape. A unit the board still believes is placed is filtered out
  // of its region (it is supposed to be standing in a column), so a survivor
  // that never comes home is what a plan outliving its declaration looks like.
  const { h, D, def } = battlefield(7721, ['The Foretold'], ['Towering Colossus']);
  seated(h, D);
  placeBlocker(def[0]!, 0);
  ui.click({ btn: 'confirmblocks' });
  ui.sent();

  // the server applies it, plays the battle out, and pushes the state back
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [def[0]!] }, send: [] });
  finishBattle(h);
  assert.notEqual(h.state.phase, 'battle', 'the fixture really got past the battle');
  assert.ok(h.state.entities[def[0]!], 'and the blocker survived it, so it has a region to be in');

  const after = ui.update(h.state, legalActions(h.state, D));
  assert.ok(idsIn(zone(after, `field:${D}`)).includes(def[0]!),
    'the blocker never came home: the board is still holding a build the engine consumed a whole '
    + 'battle ago, so the unit is filtered out of its own region for ever');
});

test('#77: a plan the engine would refuse never reaches the wire at all', () => {
  // The R84 pre-gate is why the post-send verdict branch is belt to braces
  // rather than the main road: an illegal declaration is named in the bar and
  // Confirm is turned off BEFORE anything is sent. Asserted here by pressing
  // it anyway, which is what Enter would do.
  const { h, D, def } = battlefield(7722, ['The Foretold', 'Tempest Wrangler'], ['The Foretold']);
  const board = seated(h, D);
  assert.ok(/Alluring/.test(board), 'the fixture really raises a compulsory block');
  ui.sent();
  placeBlocker(def[0]!, 0);                    // block the plain column, not the lure
  const bar = ui.html();
  assert.match(bar, /data-btn="confirmblocks" disabled/,
    'Confirm must be off while the plan is one the engine has already said it will refuse');
  assert.match(bar, /Alluring: The Foretold was lured by Tempest Wrangler/,
    'and the duty is NAMED — the report is that you found out only after committing');
  ui.click({ btn: 'confirmblocks' });
  assert.deepEqual(ui.actions(), [],
    'pressing it anyway (which is what Enter does) must still send nothing');
});

test('#77 wiring: the post-send verdict branch is still there for what the pre-gate cannot see', () => {
  // ⚠ THE ONE THING THAT CANNOT BE DRIVEN, and why. `blockVerdict` only fires
  // on a plan `blockPlanIssue` let through, and both ask the same engine
  // validator — so by construction no sequence of clicks reaches this branch.
  // It exists for the network race the report was actually about (a state that
  // changed under the plan between build and send). These reads are therefore
  // the honest weak form: they name the seam, and NOT its indentation or its
  // line breaks, so a reformat cannot delete a guard by accident.
  assert.match(MAIN, /blockVerdict\(\s*s,\s*s\.battle!\.defender,\s*blocks,\s*send,\s*spellTokens\s*\)/,
    'the click handler asks the verdict before it sends');
  assert.match(MAIN, /ui\.blockRefusal\s*=\s*verdict;/, 'and holds the verdict for the bar');
  assert.match(MAIN, /ui\.columns\s*=\s*columnsFromPlan\(\s*verdict\.keep\.blocks\s*\)/,
    'putting the surviving plan back on the board rather than clearing it');
  assert.match(MAIN, /data-btn="resetblocks"/, 'the report asked for this button by name');
  assert.match(MAIN, /\bresetblocks\s*:\s*\(\s*\)\s*=>/,
    'and it is handled — a BOARD_BTNS entry (unanchored: WHERE the table sits is not the claim)');
  assert.match(MAIN, /offenders\.map\(o => o\.card\)/,
    'the notice NAMES the units rather than counting them');
});

test('#77 wiring: blockVerdict is a read of the engine, never a second opinion', () => {
  assert.match(BATTLE, /blockDeclarationIssue\(e, seat, bl, \[\.\.\.out\]\)/,
    'every judgement is a question put to the engine');
  // was: BATTLE.split('// ── [77]')[1] — a slice taken on a COMMENT BANNER, so
  // renaming the banner silently emptied the haystack and the assertion passed
  // over nothing. The claim is about the whole file: no block rule is restated
  // in the client, anywhere.
  assert.doesNotMatch(BATTLE, /\b(Feeble|Evasive|Sneaky|Flying)\b/,
    'ui/battle.ts must not name a block attribute — every block rule belongs to the engine');
});

// ── the state the tests above are read against is a real one ──────────

test('#77: the fixture really is a block step with a real attack', () => {
  const { h, atk } = battlefield(7715, ['The Foretold', 'The Foretold'], ['The Foretold']);
  const s: GameState = h.state;
  assert.equal(s.phase, 'battle');
  assert.equal(s.battle!.step, 'blocks');
  assert.deepEqual(s.battle!.columns.flat().sort((a, b) => a - b), [...atk].sort((a, b) => a - b));
});
