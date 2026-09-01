/* MODE CONFORMANCE — a card that prints a modal bracket picks its half at
 * CAST, not at resolution.
 *
 * The playtest report (Siphon Life, 2026-08-23) is the same shape as R67's
 * targeting report and has the same answer:
 *
 *   "Target player [gains or loses] X life" sat on the stack without saying
 *    WHICH. I spent a card responding to it. The response resolved. Only then
 *    was the caster asked — and the option labels were recomputed off the
 *    board my card had just changed.
 *
 * That is free information the opponent paid for. A response window is only
 * meaningful if what you are responding to is fully declared, which is exactly
 * why X, {Modular} mods, targets and bracketed costs are all settled in the
 * cast window (R35/R57). A MODE is one more of those, and `EffectDef.modes` /
 * `EffectPart.mode` / `E.collectModes` are the seam that makes it one.
 *
 * Six cards moved: Burgeon, Wither and Bloom, Spirit of Nature, Transmutide
 * Enigma, Floral Singularity, Siphon Life. Every one of them used to be a
 * mid-resolution `ctx.choose`; three of them (Burgeon, Wither and Bloom,
 * Spirit of Nature) additionally auto-picked a half FOR you during end-of-turn
 * resolution, which is a silent wrong answer rather than a late one.
 *
 * R157 §21 then added Retribution Thing, and R284 added the eighth and last —
 * Void Memory, which had been going one worse than late: it asked the WRONG
 * PLAYER. *"All modal/additional costs are paid/chosen by the owner of the
 * spell. No exceptions."* (owner, 2026-09-01.) So the pool's eight modal
 * brackets are eight declared modes, `EXEMPT` is empty, and section (f) below
 * pins the half each option stands for, because the UI now prints it.
 *
 * Sibling of 68-target-conformance.test.ts (declaration vs printed text) and
 * 60-cast-time-targets.test.ts (the property, driven over the real action
 * path). Both halves are here, because a declaration is worth exactly as much
 * as the thing that keeps it true.
 *
 * Seeds 9700-9799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { allCardNames, ambushEffect, getCard } from '../src/cards/dsl.ts';
import type { EffectDef } from '../src/cards/dsl.ts';
import { E, Suspended } from '../src/engine.ts';
import { Harness } from '../src/harness.ts';
import { fuzzGame } from './fuzz.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment,
  toNextBattle, tokensOf, unitsOf,
} from './util.ts';
import type { Decision, EntityId, Seat, Suspension } from '../src/types.ts';

/** spawn a REAL token entity with chosen stats — the util spawn() makes
 * nontoken entities, and a stat token is the yardstick with no attributes on
 * it (R106's {Unaware} makes a printed vanilla body a bad ruler). Same local
 * as 23-wood-a's. */
function spawnToken(h: Harness, seat: Seat, p = 1, t = 1): EntityId {
  const e = new E(h.state);
  const u = e.spawnUnit(seat, 'Unit Token', e.homeRegion(seat), { token: true, tokenStats: [p, t] });
  e.settle();
  return u.id;
}

/** run engine mutations white-box; the trigger it causes may suspend, and the
 * suspension is recorded in state and answered via h.do('decide'). Same local
 * as 30-hybrids-wm-b's. */
function whiteBox(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  try {
    f(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
}

/**
 * A printed MODAL bracket: "[power {i1}or defense]", "[gains or loses]",
 * "[Poison {i1}or Crystal]", "[Create X 1/1 units {i1}or your units become
 * base X/X until regroup]".
 *
 * The bracket is what makes it modal — an "or" in running prose is not one
 * ("units you control or control of" …) — and a COST bracket never contains
 * "or": the pool's cost brackets are "[Sacrifice a unit]", "[Remove X +1/+1
 * counters from allies]", "[Discard a card]". Checked against the whole pool,
 * this matches exactly eight cards, and all eight declare `modes`.
 *
 * ui/cardtext.ts's `modalHalves` splits on the same "or" for the same reason,
 * and section (f) is what keeps the two readings of the pool agreeing.
 */
const MODAL = /\[[^\]]*\bor\b[^\]]*\]/i;

/**
 * Cards that print a modal bracket and correctly DO NOT declare `modes`, each
 * with the reason. Asserted still-needed below: an exempt card that starts
 * declaring modes, or stops printing a bracket, fails there.
 *
 * IT IS EMPTY, AND R284 IS WHY IT SHOULD STAY EMPTY. Two entries have stood
 * here and both were wrong in the same direction — a reason for reading a
 * printed bracket as something other than the caster's own declaration.
 *
 *  · Retribution Thing, deleted by R157 §21 (owner, 2026-08-25): *"All text on
 *    cards that's in [square brackets] like that is either an additional cost
 *    or a modal choice."* The entry had read the bracket as one QUANTITY (lost
 *    PLUS gained) rather than a choice.
 *  · Void Memory, deleted by R284 (owner, 2026-09-01): *"All modal/additional
 *    costs are paid/chosen by the owner of the spell. No exceptions."* The
 *    entry had read "each opponent discards a [unit or spell]" as the
 *    DISCARDING player's pick, under R67's not-a-target carve-out — which made
 *    each victim choose the half while looking at their own hand, so the card
 *    never missed. It is the caster's guess, declared at cast, like every
 *    other one.
 *
 * A new entry here is therefore a claim that the owner's rule has an exception
 * after all. Write down which one, and expect it to be deleted.
 */
const EXEMPT: Record<string, string> = {};

/** the effects a card DECLARES ITSELF — spell, graft rider, abilities and
 * [Augment] text, plus the generated Ambush mode's effect. `modes` is declared
 * PER EFFECT (a graft composite asks per part), so "does this card declare a
 * mode" is "does any of its effects". */
function effectsOf(name: string): EffectDef[] {
  const c = getCard(name);
  const out: EffectDef[] = [];
  if (c.spellEffect) out.push(c.spellEffect);
  if (c.graftEffect) out.push(c.graftEffect.effect);
  for (const a of c.abilities ?? []) out.push(a.effect);
  for (const a of c.augmentText ?? []) out.push(a.effect);
  if (c.ambush) out.push(ambushEffect(name));
  return out;
}

const declaresModes = (name: string): boolean => effectsOf(name).some(e => !!e.modes);
const printsModal = (name: string): boolean => MODAL.test(getCard(name).text ?? '');

/* ── (a) printed ⇒ declared ────────────────────────────────────────────── */

test('R57: a card printing a modal bracket declares EffectDef.modes', () => {
  const late: string[] = [];
  for (const name of allCardNames()) {
    if (!printsModal(name)) continue;
    if (name in EXEMPT) continue;
    if (declaresModes(name)) continue;
    late.push(`${name}: prints "[… or …]" and declares no modes\n      ${getCard(name).text}`);
  }
  assert.deepEqual(late, [],
    'cards that pick their half at RESOLUTION — the opponent responds to an undeclared effect:\n  '
    + late.join('\n  '));
});

/* ── (b) the converse: declared ⇒ printed ──────────────────────────────── */

test('R57: nothing declares a mode it does not print', () => {
  const invented: string[] = [];
  for (const name of allCardNames()) {
    if (!declaresModes(name)) continue;
    if (printsModal(name)) continue;
    invented.push(`${name}: declares modes but prints no "[… or …]"\n      ${getCard(name).text}`);
  }
  assert.deepEqual(invented, [],
    'a mode nobody printed is a question the rules never asked:\n  ' + invented.join('\n  '));
});

/* ── (c) every exemption is still needed ───────────────────────────────── */

test('R57: every mode exemption is still needed, and still names a real card', () => {
  const stale: string[] = [];
  // R284 emptied it. The loop below is kept, not deleted, because the day
  // somebody adds an entry is the day it has to be checked.
  assert.deepEqual(Object.keys(EXEMPT), [],
    'a printed bracket is the OWNER\'s declaration, with no exceptions (R284) — a new '
    + 'exemption needs a ruling, not a comment');
  for (const [name, why] of Object.entries(EXEMPT)) {
    assert.ok(why.length > 20, `${name}'s exemption needs a reason, not a shrug`);
    let c;
    try { c = getCard(name); } catch { stale.push(`${name}: no such card any more`); continue; }
    if (!MODAL.test(c.text ?? '')) {
      stale.push(`${name}: prints no modal bracket now — drop the exemption`);
      continue;
    }
    if (declaresModes(name)) {
      stale.push(`${name}: declares modes now — drop the exemption (and check the reason still holds)`);
    }
  }
  assert.deepEqual(stale, [],
    'exemptions that have outlived their reason:\n  ' + stale.join('\n  '));
});

/* ── (d) THE PROPERTY, over the real action path ───────────────────────────
 *
 * Pinned the way 60-cast-time-targets.test.ts pins targets: while the mode
 * decision is pending the item is NOT on state.stack, and once it is on the
 * stack `part.mode` is set and readable — by the opponent, for the whole
 * response window. All six cards, each through the path it is actually played
 * on (a battle spell, a deployment X spell, an after-combat trigger, an
 * on-spawn [Augment] trigger). */

/** the declared modes of everything currently on the stack */
const modesOnStack = (h: Harness): unknown[] =>
  h.state.stack.flatMap(i => i.parts.map(p => p.mode));

test('R57: Burgeon names its half before the stack, and the opponent can read it there', () => {
  const h = new Harness(9700);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawnToken(h, D, 5, 6);
  giveResources(h, D, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Burgeon') });
  pick(h, { unit: whale });
  assert.equal(h.state.decision?.kind, 'mode', 'the half is a cast-time question');
  assert.equal(h.state.stack.length, 0, 'and nothing is on the stack while it is open');
  // R57's ordering, and the reason for it: the mode comes AFTER the target, so
  // the options can name what it is aimed at.
  assert.ok(h.state.decision!.options.some(o => /5 → 10/.test(o.label)),
    'the options read the declared target\'s live stats');
  pick(h, 'defense');
  assert.equal(h.state.stack.length, 1, 'now it lands on the stack');
  assert.deepEqual(modesOnStack(h), ['defense'], 'wearing the half it chose');
  pass(h); pass(h);
  assert.deepEqual(effStats(h, whale), [5, 12], 'and it resolves as the half that was declared');
  finishBattle(h);
});

test('R57: Wither and Bloom declares which half before anyone may respond', () => {
  const h = new Harness(9701);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const a1 = spawn(h, A, 'Unit Token');
  const sentry = spawn(h, D, 'Stasis Sentry');
  giveResources(h, D, 'wood', 2);
  giveResources(h, D, 'metal', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wither and Bloom') });
  assert.equal(h.state.decision?.kind, 'mode');
  assert.equal(h.state.stack.length, 0, 'the modal bracket is settled before the stack');
  pick(h, 'wither');
  assert.equal(h.state.stack.length, 1);
  assert.deepEqual(modesOnStack(h), ['wither']);
  pass(h); pass(h);
  assert.ok(!ent(h, a1), 'the enemy 1/1 withered');
  assert.equal(ent(h, sentry)!.counters, 0, 'and the caster\'s own units were untouched');
  finishBattle(h);
});

test('R57: Siphon Life says whether it is a burn or a heal before the response window', () => {
  const h = new Harness(9702);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 3);
  toNextBattle(h, A);
  const dLife = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Siphon Life') });
  pick(h, 3);                                   // X, first (R57's order)
  pick(h, { player: D });                       // then the target
  assert.equal(h.state.decision?.kind, 'mode', 'then the half');
  assert.equal(h.state.stack.length, 0, 'still nothing on the stack');
  pick(h, 'lose');
  assert.equal(h.state.stack.length, 1);
  assert.deepEqual(modesOnStack(h), ['lose'], 'the opponent can see it is a burn');
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, dLife - 3);
  finishBattle(h);
});

test('R57: Spirit of Nature\'s trigger declares Poison-or-Crystal as it goes on the stack', () => {
  const h = new Harness(9703);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Spirit of Nature');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                             // combat → the afterCombat trigger
  assert.equal(h.state.decision?.kind, 'mode', 'a TRIGGERED item is aimed the same way');
  assert.equal(h.state.stack.length, 0, 'and it is not on the stack yet');
  pick(h, 'Crystal');
  assert.deepEqual(modesOnStack(h), ['Crystal']);
  pass(h); pass(h);
  const made = tokensOf(h, D).filter(t => t.card === 'Crystal' || t.card === 'Poison');
  assert.deepEqual(made.map(t => t.card), ['Crystal'], 'the half it declared is the half it made');
  finishBattle(h);
});

test('R57: Transmutide Enigma picks the stat off the pre-response board', () => {
  const h = new Harness(9704);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Transmutide Enigma');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let tok = 0;
  whiteBox(h, e => {
    tok = e.spawnUnit(D, 'Unit Token', e.s.battle!.region, { token: true, tokenStats: [2, 3] }).id;
  });
  assert.equal(h.state.decision?.kind, 'mode');
  assert.equal(h.state.stack.length, 0);
  // the whole point of moving it: the labels are computed HERE, off the board
  // the caster and the opponent are both looking at, not after the answer.
  assert.ok(h.state.decision!.options.some(o => /\+0\/\+3/.test(o.label)),
    'the option shows the stat as it stands now');
  pick(h, 'defense');
  assert.deepEqual(modesOnStack(h), ['defense']);
  pass(h); pass(h);
  assert.deepEqual(effStats(h, tok), [2, 6], 'defense doubled');
  finishBattle(h);
});

test('R57: Floral Singularity settles X and then its half, all before it resolves', () => {
  // A DEPLOY-timing spell resolves without ever touching the stack (there is
  // no response window in deployment), so the property here is the other half
  // of the same statement: the mode is answered while the effect has not run.
  const h = new Harness(9705);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'wood', 4);
  giveResources(h, p, 'metal', 3);
  const before = unitsOf(h, p).length;
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Floral Singularity') });
  pick(h, 2);                                   // X = 2, chosen and paid at cast (R35)
  assert.equal(h.state.decision?.kind, 'mode', 'the half comes next, still in the cast window');
  assert.equal(h.state.stack.length, 0);
  assert.equal(unitsOf(h, p).length, before, 'and NOTHING has resolved yet');
  pick(h, 'create');
  assert.equal(unitsOf(h, p).length, before + 2, 'only now does it make the tokens');
});

/* ── (e) THE NEGATIVE that keeps new cards honest ──────────────────────────
 *
 * A mode is a cast-time question by construction: `E.collectModes` is the only
 * place that raises DecisionKind 'mode', and it runs inside the cast window.
 * This is the guard that says so out loud, so that a future card that reaches
 * for `ctx.choose` with a modal question — or an engine change that lets
 * `collectModes` be called from a resolution — is caught by `npm test` rather
 * than by a player who has just been shown their opponent's spell for free.
 *
 * Driven over fuzz games the way 65-effect-conformance drives the pool: the
 * one chokepoint is `E.suspend`, so it is wrapped here (in this file only —
 * nothing about the shipped engine knows this test exists). */

/** every (suspension type, decision kind) pair the drive raised */
const raised: { type: Suspension['type']; kind: Decision['kind'] }[] = [];
const origSuspend = E.prototype.suspend;
E.prototype.suspend = function (susp: Suspension, dec: Omit<Decision, 'id'>): never {
  raised.push({ type: susp.type, kind: dec.kind });
  return origSuspend.call(this, susp, dec);
};

test('R57: no \'mode\' decision is ever raised mid-resolution', () => {
  for (let seed = 9700; seed <= 9759; seed++) fuzzGame(seed, 2500);
  for (let seed = 9760; seed <= 9779; seed++) fuzzGame(seed, 2500, 'draft');

  // the guard is only worth something if the drive actually reached a mode
  const modes = raised.filter(r => r.kind === 'mode');
  assert.ok(modes.length > 0,
    'the fuzz never raised a mode decision at all — this test proved nothing. '
    + 'Widen the seeds before trusting it.');

  const wrong = modes.filter(r => r.type !== 'cast');
  assert.deepEqual(wrong, [],
    'a modal question asked outside the cast window is the whole defect: the item is already '
    + 'on the stack, the opponent has already paid to respond to it, and the answer they get '
    + 'to see comes too late to matter.\n  '
    + [...new Set(wrong.map(r => r.type))].join(', '));

  // and specifically: never under a 'resolve' suspension, which is the shape
  // `ctx.choose` produces (engine.ts's PartChoice → resolveParts).
  assert.equal(raised.some(r => r.kind === 'mode' && r.type === 'resolve'), false,
    'a mode reached the mid-resolution ctx.choose path');
});

/* ── the auto-picks that are GONE, and the claim that let them go ──────────
 *
 * Wither and Bloom, Spirit of Nature and Burgeon each carried an
 * `inEndOfTurn(g) ? <a half> : ctx.choose(…)` — a SILENT wrong answer rather
 * than a late one: a grafted Burgeon riding an end-of-turn cause picked
 * 'power' for you and said nothing about it. Their shared justification
 * (helpers.ts: "a ctx.choose suspension there strands the game") went stale
 * when `E.finishTurnEnd` started resuming out of `settle()` — the turn flip is
 * owed as a flag and closed at the first safe point, so a suspension raised
 * inside the end-of-turn window is answered and the flip happens on the way
 * back. The cast window already suspends there for TARGETS.
 *
 * This is that claim, checked rather than believed. If it ever stops holding,
 * this goes red and the auto-picks — or a better fix — have to come back. */
test('R57: a modal effect resolving in the END-OF-TURN window asks, and the turn still flips', () => {
  const h = new Harness(9706);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const walker = spawn(h, p, 'Mirage Walker');   // "at the end of turn, [Switch1] …"
  giveResources(h, p, 'wood', 2);
  giveResources(h, p, 'metal', 1);
  // Wither and Bloom rides the Walker's end-of-turn cause as a graft (R9/R110)
  h.do({
    type: 'graft', seat: p, from: 'hand',
    index: give(h, p, 'Wither and Bloom'), hostId: walker, position: 0,
  });
  // …but grafting IS a deployment action, and the Walker's cause is "if you
  // took no actions during deployment". So run the turn out and come back to
  // the NEXT one, where the seat does nothing at all.
  toNextBattle(h, p);
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') {
    h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  }
  const turn = h.state.turn;
  // both seats finish deploying → endTurn() → the graft composite resolves
  for (const seat of [0, 1] as const) {
    if (!h.state.deployDone?.[seat]) h.do({ type: 'doneDeploying', seat });
  }
  assert.equal(h.state.decision?.kind, 'mode',
    'the end-of-turn window ASKS now — it used to pick a half for you in silence');
  pick(h, 'bloom');
  assert.equal(h.state.decision, null, 'the question is answered');
  assert.equal(h.state.turn, turn + 1,
    'and E.finishTurnEnd resumed out of settle() — the turn flipped, nothing stranded');
});

/* ── (f) R284: every option says WHICH PRINTED HALF it is ──────────────────
 *
 * The UI narrows a declared item's printed text down to the half that was
 * picked — "Each opponent discards a [unit] if able" — which needs a mapping
 * from the stored `value` to the printed words. `ModeOption.half` is that
 * mapping, and it has to be DECLARED rather than derived, twice over:
 *
 *  · not from the option's INDEX. Siphon Life prints "[gains {i1}or loses]"
 *    and offers Lose first, because losing is what it is usually cast for.
 *  · not from the option's WORDS. Wither and Bloom's values are 'wither' and
 *    'bloom', and neither word appears anywhere on the card.
 *
 * Both of those are shortcuts that LOOK right on six of the eight cards, which
 * is exactly how they would have shipped. This is the check that makes the
 * seventh and eighth fail loudly instead.
 */

test('R284: every modal option declares which printed half it is, and the halves are 0 and 1', () => {
  const bad: string[] = [];
  for (const name of allCardNames()) {
    if (!printsModal(name)) continue;
    for (const def of effectsOf(name)) {
      const spec = def.modes;
      if (!spec) continue;
      // `options` is pure and reads the item, so it cannot be called for real
      // here; what is asserted is the DECLARATION, over a synthetic call with
      // a bare item. Any card whose options throw on one is exercised by its
      // own literal test — the point here is the shape of what comes back.
      let opts;
      try {
        opts = spec.options(
          undefined as never,
          { parts: [], x: 3, controller: 0, region: 0 } as never,
          {} as never,
        );
      } catch { continue; }
      if (opts.length < 2) continue;
      const halves = opts.map(o => o.half);
      if (halves.some(h => h === undefined)) {
        bad.push(`${name} (${spec.key}): an option declares no half — the stack cannot narrow the text`);
        continue;
      }
      if ([...halves].sort().join(',') !== '0,1') {
        bad.push(`${name} (${spec.key}): halves are [${halves.join(', ')}], not one 0 and one 1`);
      }
    }
  }
  assert.deepEqual(bad, [],
    'a mode whose options do not name their printed half:\n  ' + bad.join('\n  '));
});

/* ── (g) R284: Void Memory — the CASTER guesses, the victims answer ────────
 *
 * The defect, in the owner's words (2026-09-01): *"Void Memory (and maybe
 * more) improperly has the OPPONENT choose the mode when discarding, making it
 * much better than it should be. It's supposed to have the caster make a
 * choice, guessing which mode will be more likely to hit."*
 *
 * Both halves of that are pinned here: the caster declares at cast like the
 * other seven (the property section (d) checks), and a guess that MISSES gets
 * the "otherwise" branch off a hand that is not empty — which the old reading
 * could never reach, because it let the discarding player pick the half.
 */

test('R284: Void Memory declares its half at cast, and a hand with no card of that type reveals', () => {
  const h = new Harness(9707);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, D, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  // the attacker's hand is ALL SPELLS, and nothing about that is visible to
  // the caster — which is the point of the guess.
  h.state.players[A]!.hand = ['Burgeon', 'Siphon Life'];
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Void Memory') });
  assert.equal(h.state.decision?.kind, 'mode', 'the half is a cast-time question');
  assert.equal(h.state.decision!.seat, D, 'and it is the CASTER who is asked, not the victim');
  assert.equal(h.state.stack.length, 0, 'nothing is on the stack while it is open');
  pick(h, 'unit');
  assert.equal(h.state.stack.length, 1);
  assert.deepEqual(modesOnStack(h), ['unit'], 'the opponent can read the guess off the stack');
  pass(h); pass(h);
  assert.deepEqual(h.state.players[A]!.hand, ['Burgeon', 'Siphon Life'],
    'the guess missed: a hand of spells discards no unit, and the old reading — where the '
    + 'DISCARDING player picked the half — could never have missed at all');
  assert.ok(h.events.some(e => /no unit in hand/.test(e.msg)), 'and the miss is announced');
  finishBattle(h);
});

test('R284: Void Memory\'s victim still picks WHICH card, among the ones the half admits', () => {
  const h = new Harness(9708);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, D, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.state.players[A]!.hand = ['Burgeon', 'Ignis Sprite', 'Wraith'];
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Void Memory') });
  pick(h, 'unit');
  pass(h); pass(h);
  assert.equal(h.state.decision?.seat, A, 'the discard is the HAND OWNER\'s pick');
  const offered = h.state.decision!.options.map(o => o.label).sort();
  assert.deepEqual(offered, ['Ignis Sprite', 'Wraith'],
    'and the menu is the units only — Burgeon is a spell, and the declared half is what '
    + '"if able" is measured against');
  // `pick` matches on VALUE, and this menu's values are HAND INDICES — the
  // whole point of filtering by half is that they are no longer 0..n.
  pick(h, h.state.decision!.options.find(o => o.label === 'Wraith')!.value);
  assert.deepEqual(h.state.players[A]!.hand, ['Burgeon', 'Ignis Sprite']);
  finishBattle(h);
});
