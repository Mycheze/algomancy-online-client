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
import { E } from '../src/engine.ts';
import { activationKeys, castableTokens } from './inspect.ts';
import type { AutoPassArm, AutoPassPlan } from './inspect.ts';
import { autoPassPlan } from './inspect.ts';
import type { Action, EntityId, GameState, Seat } from '../src/types.ts';

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
 * Why the "Pass all" chip must come off — or null to keep passing.
 *
 * One named place for the whole release list, so the answer to "why did it stop
 * passing all?" is a value a test can read rather than a chain of `else if`s
 * inside a bigger decision:
 *
 *   'phase'   the battle is over. The chip's own promise ("keep passing until
 *             the battle ends") — a deliberate release.
 *   'stack'   something NEW is on the stack since the last paint. Deliberate:
 *             the chip exists to skip through empty windows, and a new item is
 *             exactly the thing you armed it not to miss.
 *   'ability' a resolution granted me an activateAbility that was not legal
 *             when the chip was armed (a negate, typically). Deliberate: it is
 *             a new option that appeared BECAUSE the game moved.
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
export type PassAllRelease = 'phase' | 'stack' | 'ability' | 'tokens' | null;

export function passAllRelease(
  s: GameState, seat: Seat, legal: readonly Action[], arm: AutoPassArm,
): PassAllRelease {
  if (!arm.armed) return null;
  if (s.phase !== 'battle' || !s.battle) return 'phase';
  if (s.stack.length > arm.armedStack) return 'stack';
  if (activationKeys(legal).some(k => !arm.armedSig.includes(k))) return 'ability';
  // the window has to be MINE before anything about my options can release it
  if (!s.decision && s.priority === seat && tokensAtRisk(s, seat, legal) > 0) return 'tokens';
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
  if (arm.armed && !release && !s.decision && s.priority === seat
    && legal.some(a => a.type === 'passPriority')) {
    return { disarm: false, pass: 'passall' };
  }
  const rest = autoPassPlan(s, seat, legal, { ...arm, armed: false });
  return { disarm: release !== null, pass: rest.pass };
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
  // round 1, and a round 2 that follows a round 1 nobody fought, attack out of
  // home; a real counterattack leaves from the region it is already standing in
  const from = b.round === 1 || b.attackerPool === null
    ? new E(s).homeRegion(seat) : b.region;
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
