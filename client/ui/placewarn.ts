/* BL-50 / CT-410 — THE (!) ON A CARD PLACED WHERE SUBMIT WILL BE REFUSED.
 *
 * Report #284 (invi, room VRRS, 2026-10-24): "bripp can be moved to a block
 * column during declare blockers". The engine was right — Bripp may not block,
 * and a declaration naming it is refused — but the board let the drag happen
 * and said nothing until Confirm. The owner, 2026-10-25: keep the drag, and
 * "add a sorta (!) icon onto cards (in the same place the big die is for token
 * spells) when there's a card in a formation in an illegal way (a way that the
 * engine won't allow upon submission)".
 *
 * THIS IS A READ OF THE ENGINE'S OWN VALIDATOR, NEVER A SECOND OPINION — the
 * same contract as `blockPlanIssue` (ui/inspect.ts) and `blockVerdict`
 * (ui/battle.ts). Nothing here knows a block rule. The whole judgement is:
 *
 *  1. Ask the engine whether it would take the declaration the board is
 *     holding (`blockDeclarationIssue`, the first question `blockVerdict` puts). Accepted → no card is marked. That one
 *     question is what makes "the badge shows exactly when submitting would be
 *     refused" true by construction rather than by agreement.
 *  2. Refused → `blockVerdict`'s walk, which is a run of further questions put
 *     to the same validator, names the cards Confirm would take back out
 *     (its `offenders`, each with the engine's own reason).
 *  3. A compulsory duty can be broken by a card's ABSENCE from a column rather
 *     than its presence somewhere: the lured unit left at home, or blocking
 *     elsewhere. The walk rebuilds the plan ON the engine's compulsory core, so
 *     the unit it had to add (`required`) and that the plan does not already
 *     hold in that column is the card whose placement breaks the duty.
 *  4. If neither step found a card — a refusal the walk cannot pin on any one
 *     placement — every card in the plan carries it, so a refused plan is never
 *     drawn as a clean one.
 *
 * WHICH DECLARATIONS. Only the block step has a formation the board lets you
 * build in an illegal shape: the attack builder places only
 * `formationCandidates`, which are exactly `validFormation`'s per-unit
 * clauses, and its remaining refusals (a counterattack's sent units and riders
 * not all placed) are not a card's placement — the bar already holds Attack!
 * back for those. Deployment places one card at a time from the engine's own
 * slot options. So the block step is the whole of it.
 */
import { blockVerdict } from './battle.ts';
import { esc } from './util.ts';
import type { EntityId, GameState, Seat } from '../engine/src/types.ts';

/**
 * Every card `seat`'s block declaration-in-progress marks, with the engine's
 * reason — empty exactly when the engine would accept the declaration.
 *
 * `blocks` / `send` / `spellTokens` are the three fields of the `declareBlocks`
 * action, as the board's Confirm would send them (main.ts blockPlan and
 * splitCounterattack). Empty outside `seat`'s own block step.
 */
export function placementWarnings(
  s: GameState, seat: Seat,
  blocks: Record<number, EntityId[]>, send: readonly EntityId[], spellTokens: readonly EntityId[],
): Map<EntityId, string> {
  const out = new Map<EntityId, string>();
  const b = s.battle;
  if (s.phase !== 'battle' || !b || b.step !== 'blocks' || b.defender !== seat) return out;
  // 1. the one question that decides whether anything is marked at all —
  // blockVerdict's first act is to put the whole plan to blockDeclarationIssue
  // and return null when it is accepted, so this is that question, asked once
  const v = blockVerdict(s, seat, blocks, send, spellTokens);
  if (v === null) return out;
  // 2. the cards Confirm would take back out, each in the engine's own words
  for (const o of v.offenders) out.set(o.id, o.why);
  // 3. a duty broken by where a card is NOT
  for (const [ci, col] of Object.entries(v.required)) {
    const have = blocks[Number(ci)] ?? [];
    for (const id of col) if (!have.includes(id) && !out.has(id)) out.set(id, v.why);
  }
  // 4. a refusal no single placement explains still marks the plan
  if (!out.size) for (const id of [...Object.values(blocks).flat(), ...send, ...spellTokens]) out.set(id, v.why);
  return out;
}

/** the badge itself, centred where a spell token's X die sits (style.css
 * `.placewarn`). It takes no click of its own — a click on it is a click on the
 * card under it, so the card can still be picked up and moved out — and its
 * title carries the engine's reason for a mouse. */
export function placeWarnHtml(why: string): string {
  return `<div class="placewarn" title="${esc(why)}" aria-label="${esc(`will be refused: ${why}`)}"><span>!</span></div>`;
}
