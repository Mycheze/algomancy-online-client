/* The two battle-phase judgements the client keeps getting wrong about spell
 * tokens, as pure functions over a GameState and a legal-action list.
 *
 * Both come out of the GETD playtest, and both are the SAME mistake made twice:
 * the client knew that spell tokens are fragile and shouted about it at every
 * opportunity instead of at the one moment that matters.
 *
 *  [66] "The UI is reminding me I have unused tokens at EVERY chance it has.
 *       The intention of the reminder is to only happen if the player is about
 *       to accidentally end the battle before using tokens. Not at every single
 *       point. It should just be right at the end before moving to Regroup."
 *  [68] "I hit pass all, but then it stopped passing all. Why?"
 *
 * #68 reads like a different bug and is the same one. The Pass-all chip's
 * release list (autoPassPlan in ui/inspect.ts) contained "you hold a castable
 * spell token → disarm", and that is true of nearly every priority window of
 * nearly every battle, so the chip performed exactly ONE pass and switched
 * itself off. Both reports are answered by asking the sharper question below.
 *
 * WHY THESE LIVE HERE AND NOT IN ui/main.ts: main.ts takes the document and the
 * socket at import time, so a test cannot load it. Anything with a judgement in
 * it belongs in a module the suite can hand a real position to (the house
 * pattern — see the header of test/70-playtest-round15.test.ts).
 */
import { E } from '../engine/src/engine.ts';
import { blockDeclarationIssue, compulsoryBlocks } from '../engine/src/apply.ts';
import { activationKeys, castableTokens, optionKeys } from './inspect.ts';
import type { AutoPassArm, AutoPassPlan } from './inspect.ts';
import { autoPassPlan } from './inspect.ts';
import type { Action, Entity, EntityId, GameState, Phase, Seat } from '../engine/src/types.ts';

// ── [66] the pass that costs you your spell tokens ────────────────────

/**
 * Would passing priority RIGHT NOW take the game out of the battle phase and
 * into Regroup — the step that erases spell tokens (R11)?
 *
 * This is derived from the engine's own transition, and it is worth spelling
 * out because the answer is not "the last window I can see":
 *
 *   E.passPriority   a pass with a non-empty stack resolves the top instead of
 *                    advancing anything, so it can never end the battle.
 *   advanceBattleStep only `afterWindow` ends a battle ROUND. `attackWindow`
 *                    hands over to blocks, `blockWindow` to combat damage —
 *                    both of which open another window you can still cast in.
 *   endBattleRound   round 2's end IS Regroup. Round 1's end normally starts
 *                    round 2 (more windows, tokens safe) — EXCEPT when the
 *                    defender already committed at block time (`happened`) and
 *                    sent nobody: `endBattleRound` then declines round 2 on the
 *                    spot and recurses straight into `startRegroup`.
 *
 * ⚠ R213 / CARD-TODO #82(a): THAT LIST IS THREE OF FOUR, AND THE FOURTH IS
 * NOT COVERABLE HERE. `endBattleRound` has a caller that is not the engine
 * deciding anything — **Temporal Rift** (`batch-hybrids-wm-b.ts`), a CARD that
 * ends the battle mid-resolution. This function answers "would passing RIGHT
 * NOW end the battle", and it answers it from the state at pass time; whether
 * some card later on the stack will end the battle cannot be predicted from
 * there. So the warning genuinely cannot fire for that path, and it is not a
 * bug that it does not.
 *
 * It IS a bug to enumerate the transitions as if they were all of them, which
 * is how CT-82(a) came to be filed: the comment read as a complete invariant
 * and was not one. R194's token-loss announcement still reaches all four
 * paths, because every exit from `endBattleRound` funnels through
 * `startRegroup` — that is asserted in `183-end-battle-round-paths.test.ts`,
 * along with the caller count, so a fifth path fails the suite instead of
 * quietly widening this gap.
 *
 * Note what is deliberately NOT required: `s.passes >= 1`, i.e. "mine is the
 * second pass, the one that actually advances the step". Priority in every
 * window opens on the initiative player (E.openPriority), so gating on the
 * closing pass would mean the initiative player — half of all games — is never
 * warned at all. Passing FIRST in this window is not irrevocable (if the
 * opponent responds, the stack grows and priority comes back round), but it is
 * the last window this client is guaranteed to get, and that is what the
 * warning is about. The cost is at most one extra confirm per battle instead of
 * one per priority window, which is the whole of report #66.
 */
export function passEndsBattlePhase(s: GameState, seat: Seat): boolean {
  if (s.phase !== 'battle') return false;
  const b = s.battle;
  if (!b) return false;
  if (s.decision) return false;
  if (s.priority !== seat) return false;
  // a pass with something on the stack resolves the top — a new window follows
  if (s.stack.length) return false;
  // the only step whose close ends the round
  if (b.step !== 'afterWindow') return false;
  if (s.battleRound === 2) return true;
  // round 1 hands over to round 2 — unless the defender declined the
  // counterattack at block time, in which case round 2 ends the instant it
  // starts and the game falls through into Regroup.
  return b.happened && b.sentAttackers.length === 0;
}

/**
 * The spell tokens `seat` would lose to Regroup if this pass closes the battle:
 * the ones they could still be CASTING (the legal-action list is the authority
 * on that — an uncastable token is not something the player is about to waste).
 */
export function tokensAtRisk(s: GameState, seat: Seat, legal: readonly Action[]): number {
  return passEndsBattlePhase(s, seat) ? castableTokens(legal) : 0;
}

// ── [68] every condition under which Pass-all stops being in effect ───

/**
 * Why an armed pass chip must come off — or null to keep passing.
 *
 * One named place for the whole release list, so the answer to "why did it stop
 * passing?" is a value a test can read rather than a chain of `else if`s inside
 * a bigger decision:
 *
 *   'phase'   the phase the chip was armed in is over. This is 'all''s whole
 *             promise ("no priority until the next phase") and 'stack''s outer
 *             bound, and it is a deliberate release in both.
 *   'stack'   something NEW is on the stack that was not in the armed scope.
 *             Deliberate: it is exactly the thing "gives priority if something
 *             changes" is about.
 *   'ability' the game handed me an option I did not have when the chip was
 *             armed (a negate, typically). Deliberate: it is a new option that
 *             appeared BECAUSE the game moved.
 *             ⚠ R245 / ledger #123 — the name is historical and the CLAUSE IS
 *             NOT ABOUT ABILITIES. It read `activateAbility` alone, which is
 *             one action type out of several a window can hold; measured over
 *             the room the report came from, that list was empty at all 107
 *             pass-windows of the game, while six spell tokens and one castable
 *             card appeared out of resolutions and moved nothing. The set is
 *             derived by exclusion now (ui/inspect.ts `optionKeys`), so a new
 *             kind of option extends the clause without anyone editing it.
 *   'done'    R251 — the stack the player said yes to has resolved. NOT a
 *             change and not a failure: it is "Pass through stack" reaching the
 *             end of its own scope, and it is the reason that mode terminates
 *             at all.
 *   'tokens'  this pass would end the battle and erase castable spell tokens.
 *             Deliberate — and the fix for #68: it used to read "I hold a
 *             castable spell token", with no reference to whether passing cost
 *             anything, which fired on the first window after arming and made
 *             the chip a one-shot.
 *
 * Nothing else releases it. In particular a pass going out, a state arriving,
 * priority bouncing to the opponent and back, and a resolution that grants the
 * OPPONENT something are all non-events for the chip.
 */
export type PassAllRelease = 'phase' | 'stack' | 'ability' | 'done' | 'tokens' | null;

/**
 * R245 — is this a window the chip is being asked to PASS?
 *
 * Everything the chip declines a window for is a judgement ABOUT that window,
 * and a state where nothing is being asked of this seat is not a window it can
 * decline: the declare step, the block step, the opponent's own priority and
 * the far side of a decision all pass through here on the way to the next real
 * pass. Before R245 the two "something changed" clauses were asked at those
 * states too, so arriving at the block step with a different option list on
 * offer could take the chip off — through no act of the opponent's, and while
 * its own promise ("keep passing until the battle ends") was still standing.
 *
 * Nothing is lost by waiting: the chip's only act is a pass, so a release it
 * defers to the next window it could have passed is a release that lands
 * before anything is passed. The 'phase' clause is asked BEFORE this, because
 * the battle ending is the promise's own terminus and is not about a window.
 */
export function inPassWindow(s: GameState, seat: Seat, legal: readonly Action[]): boolean {
  return !s.decision && s.priority === seat && legal.some(a => a.type === 'passPriority');
}

/**
 * R245/R251 — the snapshot the chip is armed against.
 *
 * ONE definition of "what this window looked like", so arming it and checking
 * it can never drift: `ui/main.ts` arms with this and the suite arms with the
 * very same call. The two legacy scalars ride along so an arm from either
 * source answers whichever pair `passAllRelease` reaches for.
 *
 * ⚠ R251 — IT IS TAKEN ONCE, AT THE ARM, AND NEVER RE-TAKEN. R245 re-took it
 * at every window the chip declined, which made "new" mean "new since the
 * previous window I passed". That is a running diff, and it is neither of the
 * owner's two promises: "a pass is given to all effects that are CURRENTLY on
 * the stack" is a fixed set named at the moment of the click, so an item that
 * was already there when you armed is not a change however many windows later
 * you meet it, and an item that arrived two windows ago has not stopped being
 * one. Re-taking also quietly made the scope unbounded — nothing ever
 * "finished", so the chip ran to the end of the battle in both readings and
 * the middle button could not exist. The re-take is gone from ui/main.ts.
 */
export function armSnapshot(s: GameState, legal: readonly Action[]): {
  armedStack: number; armedSig: string[]; armedItems: EntityId[]; armedOpts: string[];
  armedPhase: Phase;
} {
  return {
    armedStack: s.stack.length,
    armedSig: activationKeys(legal),
    armedItems: s.stack.map(it => it.id),
    armedOpts: optionKeys(s, legal),
    armedPhase: s.phase,
  };
}

/**
 * R251 — ONE RELEASE LIST, TWO PROMISES, AND THE MODE IS THE ONLY DIFFERENCE.
 *
 * The clauses are not per-button: every one of them is computed the same way
 * for both modes, and the mode says which of them the promise HONOURS. That is
 * deliberate — a second copy of "what counts as a change", written for the
 * stronger button, is precisely the second opinion R245 exists to forbid, and
 * it is how #68 and #123 both happened.
 *
 * ── 'stack' (the button reading "Pass through stack")
 * Everything is live: the two change clauses, its own terminus 'done', and the
 * token guard. Its scope is `armedItems`.
 *
 * ── 'all' (the button reading "Pass all")
 * The change clauses are NOT asked. *"Pass all is the assumption that the
 * player doesn't want priority until the next phase"* — a chip that hands
 * priority back because the opponent cast something is the other button, and
 * building it here would leave the owner with two spellings of one feature and
 * still no way to say "I am done acting this battle".
 *
 * ⚠ 'tokens' IS STILL ASKED IN 'all' MODE, and that is not a shortened promise.
 * `passEndsBattlePhase` is true only of the pass that LEAVES the phase — the
 * very boundary 'all' is aiming at — so this fires at the terminus rather than
 * before it, and all it does is make the last step of the promise the player's
 * own click. R11 erases spell tokens at Regroup and there is no undo; #66 fixed
 * the warning to fire exactly there and nowhere else, and a chip that skated
 * past it would re-open the report it closed. A player holding no castable
 * token never sees it.
 */
export function passAllRelease(
  s: GameState, seat: Seat, legal: readonly Action[], arm: AutoPassArm,
): PassAllRelease {
  if (!arm.armed) return null;
  const mode = arm.mode ?? 'stack';
  // the promise's own outer terminus, asked first in both modes because a phase
  // that has turned over is not a judgement about a window (R245)
  if (s.phase !== (arm.armedPhase ?? 'battle')) return 'phase';
  // R245: every clause below is about the window in front of the player
  if (!inPassWindow(s, seat, legal)) return null;
  if (mode === 'stack') {
    // 'stack' — by identity where the arm carries one, by height where it does
    // not. The height is not a second opinion: growth can only happen by
    // gaining an id, so the id question strictly contains it (test/223).
    const fresh = arm.armedItems
      ? s.stack.some(it => !arm.armedItems!.includes(it.id))
      : s.stack.length > arm.armedStack;
    if (fresh) return 'stack';
    // 'ability' — likewise: every option, or the one action type the pre-R245
    // arm knew how to snapshot.
    const gained = arm.armedOpts
      ? optionKeys(s, legal).some(k => !arm.armedOpts!.includes(k))
      : activationKeys(legal).some(k => !arm.armedSig.includes(k));
    if (gained) return 'ability';
    // 'done' — the scope has resolved. The scope IS `armedItems`, so an arm
    // that carries none (a pre-R245 arm, or one taken at an empty stack) has
    // no scope to exhaust and this cannot fire for it. That is not a special
    // case being excused: `ui/main.ts` only offers the button while there is a
    // stack to pass through, so a scopeless 'stack' arm is unreachable from
    // the board, and the two suites that build arms by hand keep meaning what
    // they meant.
    if (arm.armedItems?.length && !s.stack.some(it => arm.armedItems!.includes(it.id))) {
      return 'done';
    }
  }
  if (tokensAtRisk(s, seat, legal) > 0) return 'tokens';
  return null;
}

/**
 * The one automatic-pass decision, [59]'s ordering with #68's release list.
 *
 * ui/inspect.ts owns the auto-pass TOGGLE (C4) and the auto-YIELD (#2), and
 * this defers to it for both — asked with `armed: false`, which used to matter
 * because it had a Pass-all branch of its own. That branch (whose C5 clause is
 * the bug this file replaces) is gone now: `passAllRelease` above is the only
 * answer to "why did pass-all stop", and `autoPassPlan` no longer reads
 * `arm.armed` at all. The `armed: false` is kept as a statement of intent.
 * The ordering is unchanged and still matters: Pass-all, then the toggle, then
 * the yield, so exactly one reason wins per state.
 */
export function autoPassDecision(
  s: GameState, seat: Seat, legal: readonly Action[], arm: AutoPassArm,
): AutoPassPlan {
  const release = passAllRelease(s, seat, legal, arm);
  if (arm.armed && !release && inPassWindow(s, seat, legal)) {
    return { disarm: false, pass: 'passall' };
  }
  const rest = autoPassPlan(s, seat, legal, { ...arm, armed: false });
  return { disarm: release !== null, pass: rest.pass };
}

// ── [127] the units a declaration may actually be built out of ────────

/**
 * R245 — WHICH OF MY THINGS MAY JOIN THE DECLARATION I AM BEING ASKED FOR.
 *
 * THE REPORT (ledger #127, room DSVQ, action 92): *"why is Rashi able to
 * attack like this? She did not do counterattackers (just Thoughtripper) but
 * is able to attack with all her things"* — and, 37 seconds later, #128:
 * *"disregard the last report as an engine bug, it's just a UI bug. She seemed
 * to be able to attack with the other things, but it didn't let her."*
 *
 * WHAT REALLY HAPPENED. DSVQ replays 174/174 FAITHFUL, so the engine refused
 * every one of those attacks; what offered them was the client. At action 84
 * she declared blocks sending exactly one unit (entity 4), so round 2's
 * `battle.attackerPool` is `[4]` and every other unit of hers is standing in
 * her HOME region rather than the battle's. `ui/main.ts` decided a unit was
 * clickable from `step === 'declare' && controller === attacker` and nothing
 * else — no region, no pool, no {Alluring} — so the whole army picked up, went
 * into columns, and the refusal arrived only on "Attack!".
 *
 * THE RULE, which is the engine's and is not restated here as a second
 * opinion: `validFormation` (src/apply.ts) asks four things of every unit in
 * every column — mine and present, standing in the region the formation leaves
 * FROM, in `attackerPool` when there is one, and not {Alluring}-lured. The
 * "leaves from" is `doDeclareAttack`'s own `fromRegion`, which `ridableTokens`
 * below already derives for the token half of the same declaration; the two
 * now read it from one place, because an attack and its riders leave the same
 * region by definition and it was written out twice.
 *
 * THE BLOCK STEP is the same question asked of the defender, and its shared
 * clause is `checkBlocks`'s: mine, present, standing in `battle.region`. The
 * per-ROLE attribute rules on top of that, and the compulsory duty, are
 * deliberately NOT restated here — a unit one of them refuses still belongs in
 * the declaration being built, and naming which part of a plan the engine will
 * not take is `blockVerdict`'s job, asked of the engine itself (test/86 guards
 * that no block attribute is ever named in this file). This is only "may this
 * thing be picked up at all", which is the affordance the report is about.
 */
export function formationCandidates(s: GameState, seat: Seat): EntityId[] {
  const b = s.battle;
  if (!b || s.phase !== 'battle') return [];
  const mine = (e: Entity): boolean => e.controller === seat && !e.absent;
  if (b.step === 'declare' && b.attacker === seat) {
    const from = attackFrom(s);
    return Object.values(s.entities)
      .filter(e => e.kind === 'unit' && mine(e) && e.region === from
        && (!b.attackerPool || b.attackerPool.includes(e.id))
        // R84: a lured unit cannot attack for the rest of this battle phase
        && !e.allured)
      .map(e => e.id).sort((x, y) => x - y);
  }
  if (b.step === 'blocks' && b.defender === seat) {
    return Object.values(s.entities)
      .filter(e => e.kind === 'unit' && mine(e) && e.region === b.region)
      .map(e => e.id).sort((x, y) => x - y);
  }
  return [];
}

/** may this entity be picked up into the declaration being built? */
export const canJoinFormation = (s: GameState, id: EntityId): boolean => {
  const e = s.entities[id];
  return !!e && formationCandidates(s, e.controller).includes(id);
};

/**
 * The region a formation `battle.attacker` declares now would leave FROM —
 * `doDeclareAttack`'s own `fromRegion`, in one place.
 *
 * Round 1, and a round 2 that follows a round 1 nobody fought (`attackerPool`
 * null), attack out of home; a real counterattack leaves from the region it is
 * already standing in.
 */
export function attackFrom(s: GameState): number {
  const b = s.battle!;
  return b.round === 1 || b.attackerPool === null ? new E(s).homeRegion(b.attacker) : b.region;
}

// ── [69] the spell tokens that could ride along with an attack ────────

/**
 * The spell tokens `seat` could bring into the region they are attacking.
 *
 * Mirrors the engine's own acceptance test in doDeclareAttack (src/apply.ts):
 * a token of mine, standing in the region the attack leaves FROM, and — in a
 * round-2 counterattack — one of the ids that were actually sent out at block
 * time. Returned in entity-id order so the dialogue lists them the same way
 * twice running.
 *
 * [69] "It's very easy to attack without bringing along any spell tokens into
 * the new region." Of the eleven attacks declared in GETD, exactly one carried
 * a token. The affordance was there (click the token while building) and was
 * simply never seen, so the client now asks.
 */
export function ridableTokens(s: GameState, seat: Seat): EntityId[] {
  const b = s.battle;
  if (!b || b.step !== 'declare' || b.attacker !== seat) return [];
  // R245: the region a formation leaves from is `attackFrom` above — one
  // derivation for the units and their riders, which leave together
  const from = attackFrom(s);
  return Object.values(s.entities)
    .filter(e => e.kind === 'spellToken' && e.controller === seat && !e.absent
      && e.region === from && (!b.attackerPool || b.attackerPool.includes(e.id)))
    .map(e => e.id)
    .sort((x, y) => x - y);
}

/**
 * Should the "bring your spell tokens?" dialogue be interposed between the
 * Attack! button and the declaration?
 *
 * Only when there is a real choice being silently defaulted: an attack is being
 * declared, tokens COULD come along, and none have been picked. Nothing to ask
 * about when there are no tokens (the report is explicit that this must not
 * become modal noise), and nothing to ask about when the player has already
 * chosen some — they have demonstrably seen the affordance.
 *
 * `answered` is the once-per-attack latch: the dialogue's own buttons set it,
 * so confirming "Bring none" declares the attack instead of asking again.
 */
export function shouldAskRide(
  s: GameState, seat: Seat, picked: readonly EntityId[], answered: boolean,
): boolean {
  if (answered) return false;
  if (picked.length) return false;
  return ridableTokens(s, seat).length > 0;
}

// ── [67] R87: the same question, asked of a COUNTERATTACK ─────────────

/**
 * The spell tokens `seat` could send out with their counterattackers.
 *
 * [67] "What happened to Rashi's Poison tokens here? She just wanted to bring
 * them with her attackers but they somehow went onto the stack, without any
 * targets or anything??" — game GETD, action 94. `declareBlocks` had no
 * `spellTokens` field at all until R87, so the only thing left to do with a
 * token at block time was fire it where it stood.
 *
 * Mirrors `doDeclareBlocks`'s own acceptance test for a `send` entry of kind
 * `spellToken` (src/apply.ts, via `needRidingToken`): mine, not absent, and
 * standing in `battle.region` — which is where a counterattack leaves from,
 * for a unit and a token alike. Round 1 only, because round 2 is the
 * counter-counterattack the rules do not have. Sorted by id so the dialogue
 * lists them the same way twice running.
 *
 * Deliberately NOT a re-derivation of the "at least one unit" rule: that one
 * is about the DECLARATION, not about which tokens are eligible, and it lives
 * in `shouldAskSend` / `splitCounterattack` below.
 */
export function sendableTokens(s: GameState, seat: Seat): EntityId[] {
  const b = s.battle;
  if (!b || b.step !== 'blocks' || b.round !== 1 || b.defender !== seat) return [];
  return Object.values(s.entities)
    .filter(e => e.kind === 'spellToken' && e.controller === seat && !e.absent
      // R84 {Alluring}: doDeclareBlocks refuses any lured entity in `send`
      && e.region === b.region && !e.allured)
    .map(e => e.id)
    .sort((x, y) => x - y);
}

/** a counterattack declaration, split into the two fields the action names */
export interface Counterattack {
  /** units — `declareBlocks.send` */
  send: EntityId[];
  /** spell tokens riding with them — `declareBlocks.spellTokens` (R87) */
  spellTokens: EntityId[];
}

/**
 * Split the one list the board holds (`ui.send`, everything dropped in the
 * counterattack slot or clicked in the strip) into the two fields the action
 * has.
 *
 * `apply` concatenates them straight back together, so this is not arithmetic
 * the engine needs — it is what makes the token rider VISIBLE, in the log line
 * ("2 counterattacker(s) with 1 spell token(s)") and to the reachability
 * ledger. An id that names nothing is left in `send`, where the engine's own
 * "cannot send that" refusal will name it.
 */
export function splitCounterattack(s: GameState, picked: readonly EntityId[]): Counterattack {
  const out: Counterattack = { send: [], spellTokens: [] };
  for (const id of picked) {
    if (s.entities[id]?.kind === 'spellToken') out.spellTokens.push(id);
    else out.send.push(id);
  }
  return out;
}

/**
 * Should the "bring your spell tokens?" dialogue be interposed between Confirm
 * and the block declaration?
 *
 * The `shouldAskRide` rule with one extra clause, and the extra clause is a
 * real rule rather than politeness: "In order to move spell tokens, you must
 * have attacked opponent Region. In order to attack opponent Region, you must
 * send atleast 1 of your unit" (_passer 2025-05-10). A block-only declaration
 * with an empty `send` cannot carry a token at all, so offering one there
 * would be offering something the engine refuses — the mirror image of the
 * bug this whole file exists for.
 */
export function shouldAskSend(
  s: GameState, seat: Seat, picked: readonly EntityId[], answered: boolean,
): boolean {
  if (answered) return false;
  const { send, spellTokens } = splitCounterattack(s, picked);
  if (spellTokens.length) return false;      // the affordance has demonstrably been seen
  if (!send.length) return false;            // "they always need a unit to take them with them"
  return sendableTokens(s, seat).length > 0;
}

// ── [77] a refused block declaration must not throw away the plan ─────

/**
 * THE REPORT (ledger #77, WEHH 2026-08-22): *"Trying to declare illegal blocks
 * entirely resets the board, which is really annoying. Instead, it should
 * reset only the 'affected' units and give a notice as well as a 'Reset
 * blockers?' button. That way, if there's a massive block, the player doesn't
 * have to entirely rebuild it for forgetting about a single thing."*
 *
 * WHY THE BOARD USED TO EMPTY. `declareBuiltBlocks` (ui/main.ts) sent the
 * action and then cleared `ui.columns` / `ui.send` "if there was no error".
 * In hotseat that reads correctly, because `act()` applies synchronously and
 * has already set `uiError`. Over a socket it cannot: the server is
 * authoritative, `act()` returns the moment the intent is on the wire, and the
 * refusal arrives some milliseconds later — by which time the plan is gone.
 * So the whole plan was discarded on every refused declaration in every
 * network game, which is every real game.
 *
 * WHAT THIS IS. R84's shape, widened. R84 asks the engine's own validator
 * whether the plan being built would be refused (`blockPlanIssue`), so a
 * compulsory block is NAMED rather than discovered; the only thing that kept
 * it to {Alluring} was that the rest of the legality was locked inside
 * `doDeclareBlocks`. `blockDeclarationIssue` (src/apply.ts) is that same run
 * of checks as a value, and this walks a refused plan against it to work out
 * the largest part of it the engine WOULD take.
 *
 * It is never a second opinion: every judgement below is the engine's own
 * answer to a plan actually put to it. Restating any block rule here is how a
 * client ends up refusing a block the engine would have accepted, which is the
 * same bug wearing the other hat (the header of test/75-ui-reachability).
 *
 * THE WALK. One clone, then pure probes against it:
 *
 *  1. Ask about the whole plan. Accepted → nothing to report.
 *  2. Establish a BASE. Normally the empty declaration, which is always legal;
 *     when it is not, the board is under a compulsory duty, and R84's own
 *     `compulsoryBlocks` is the assignment that duty demands — legal by
 *     construction, so it is what the rebuild starts from and what the notice
 *     names as REQUIRED.
 *  3. Add the player's columns one at a time, in column order. A column that
 *     the engine still accepts stays; one it refuses is dropped, and its units
 *     become offenders carrying the engine's own reason for them.
 *  4. Then the counterattackers, then the spell tokens riding with them — in
 *     that order, because "spell tokens travel only with them" is a rule about
 *     the units being there first.
 *
 * Greedy rather than exhaustive, deliberately: the alternative is a subset
 * search over a plan that can hold two dozen units, and a player who is told
 * "these three are the problem" and finds a fourth still there is far better
 * served than one who waits for a minimal answer. Every step is a real
 * question put to the engine, so what comes back is always a declaration the
 * engine will take.
 */
export interface BlockOffender {
  id: EntityId;
  /** the card, so a notice can name it without the caller re-reading state */
  card: string;
  /** the engine's own refusal for the part this unit was in */
  why: string;
}

export interface BlockVerdict {
  /** the engine's refusal for the plan AS SUBMITTED */
  why: string;
  /** the units cleared out of the plan, and why each one went */
  offenders: BlockOffender[];
  /** the largest part of the plan the engine accepts — what the board keeps */
  keep: { blocks: Record<number, EntityId[]>; send: EntityId[]; spellTokens: EntityId[] };
  /** R84: blockers the plan was rebuilt ON because the board compels them.
   * Added, never removed — the notice names these as required, not as errors. */
  required: Record<number, EntityId[]>;
}

/**
 * `null` when the engine would accept this declaration; otherwise what it
 * refused, which units to clear, and the plan that survives.
 *
 * `blocks` / `send` / `spellTokens` are exactly the three fields of the
 * `declareBlocks` action, and the two id lists are concatenated on the way in
 * the same way `apply` concatenates them.
 */
export function blockVerdict(
  s: GameState, seat: Seat,
  blocks: Record<number, EntityId[]>, send: readonly EntityId[], spellTokens: readonly EntityId[],
): BlockVerdict | null {
  // ONE clone for the whole walk: checkBlocks only reads, and cloning per
  // probe would put a dozen deep copies of a battle state on one click.
  const e = new E(structuredClone(s));
  const ask = (bl: Record<number, EntityId[]>, out: readonly EntityId[]): string | null =>
    blockDeclarationIssue(e, seat, bl, [...out]);

  const all = [...send, ...spellTokens];
  const why = ask(blocks, all);
  if (why === null) return null;

  // the base: nothing, unless the board compels something (R84)
  const required: Record<number, EntityId[]> = ask({}, []) === null ? {} : compulsoryBlocks(e, seat);
  const keep: Record<number, EntityId[]> = {};
  for (const [ci, col] of Object.entries(required)) keep[Number(ci)] = [...col];
  const offenders: BlockOffender[] = [];
  const name = (id: EntityId): string => s.entities[id]?.card ?? `unit ${id}`;
  const blame = (ids: readonly EntityId[], reason: string): void => {
    for (const id of ids) {
      if (Object.values(keep).some(c => c.includes(id))) continue;   // it survived elsewhere
      if (offenders.some(o => o.id === id)) continue;
      offenders.push({ id, card: name(id), why: reason });
    }
  };

  // …if even the compulsory core is refused, there is nothing to keep. Say so
  // with the refusal for the plan as submitted rather than inventing one.
  if (ask(keep, []) !== null) {
    return { why, offenders: [...Object.values(blocks).flat(), ...all].map(id => ({ id, card: name(id), why })), keep: { blocks: {}, send: [], spellTokens: [] }, required: {} };
  }

  const keptSend: EntityId[] = [];
  for (const ci of Object.keys(blocks).map(Number).sort((a, b) => a - b)) {
    const col = blocks[ci] ?? [];
    if (!col.length) continue;
    // the player's column merged onto whatever the duty already put there,
    // and — if that is what the engine dislikes — the player's column alone
    const merged = [...(keep[ci] ?? []), ...col.filter(id => !(keep[ci] ?? []).includes(id))];
    let reason: string | null = null;
    for (const candidate of [merged, col]) {
      const trial = { ...keep, [ci]: candidate };
      reason = ask(trial, keptSend);
      if (reason === null) { keep[ci] = candidate; break; }
    }
    if (reason !== null) blame(col, reason);
  }
  for (const id of send) {
    const reason = ask(keep, [...keptSend, id]);
    if (reason === null) keptSend.push(id); else blame([id], reason);
  }
  const keptTokens: EntityId[] = [];
  for (const id of spellTokens) {
    const reason = ask(keep, [...keptSend, ...keptTokens, id]);
    if (reason === null) keptTokens.push(id); else blame([id], reason);
  }

  return { why, offenders, keep: { blocks: keep, send: keptSend, spellTokens: keptTokens }, required };
}
