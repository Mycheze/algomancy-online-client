/* DOM-free sound logic: which CUE, if any, a state change has earned.
 *
 * Exactly the split ui/motion.ts uses. The client re-renders everything after
 * every action, so "did the phase just change?" cannot be read off the DOM —
 * we take a SNAPSHOT of the few things worth hearing before and after, diff
 * the two, and hand the DOM layer (ui/audio.ts) at most one cue to play. The
 * hard part — what counts as a change, and which change wins — stays pure and
 * testable; the audio layer stays a dumb sample player.
 *
 * The snapshot is taken FROM THE VIEWER'S VIEW, which in network mode is the
 * redacted state the server sent this seat. That is deliberate: you should
 * hear what you can see, and nothing that would leak the opponent's half.
 *
 * ── the one-cue rule ──────────────────────────────────────────────────
 * A single engine action routinely moves several of these at once — the phase
 * flips, the sub-step flips with it, and priority lands on you. Playing three
 * sounds for one click is the "distracting" failure mode, so a diff yields AT
 * MOST ONE cue, chosen by PRECEDENCE (see CUE_ORDER): the most actionable
 * thing wins, because the cue you actually need is the one that says "it's on
 * you now". Everything quieter is dropped, not queued.
 */
import type { GameState, Seat } from '../src/types.ts';

/** every sound the client can make. One .ogg per cue in ui/sfx/. */
export type Cue = 'gameover' | 'decision' | 'phase' | 'subphase' | 'priority' | 'error' | 'thump';

/** Precedence, most important first. A diff plays the earliest match only.
 * 'error' and 'thump' are never produced by a diff — they are fired directly
 * by main.ts (a rejected action) and by the idle timer (ui/audio.ts). */
export const CUE_ORDER: Cue[] = ['gameover', 'decision', 'phase', 'subphase', 'priority'];

/** The audible shape of a game state, as ONE viewer sees it. Everything here
 * is a scalar so the diff is a handful of !== comparisons — no allocation per
 * render, and nothing that can drift out of sync with the board. */
export interface SfxSnap {
  phase: string;
  /** the sub-step within the phase: haste, draft, battle round + step,
   * damage sub-step. Kept as a STRING because "changed" is the only question
   * ever asked of it, and every sub-step the player can perceive is already
   * spelled out in the phase track (main.ts phaseTrackHtml). */
  step: string;
  /** the viewer owes an action right now (they hold priority, or the game is
   * otherwise waiting on them) */
  mine: boolean;
  /** a decision prompt is open and it belongs to the VIEWER. In network mode
   * the server redacts the opponent's decision to null, so this is only ever
   * true for a decision you can actually answer. */
  decision: boolean;
  /** decision id — a new decision replacing an old one without a gap still
   * counts as "a choice just landed on you" */
  decisionId: number;
  over: boolean;
}

/** the phase's sub-step, in the same vocabulary the phase track shows */
function stepOf(s: GameState): string {
  if (s.phase === 'battle') {
    const b = s.battle;
    if (!b) return 'battle';
    if (b.damageStep) return `b${s.battleRound}:damage:${b.damageStep}`;
    return `b${s.battleRound}:${b.step}`;
  }
  if (s.phase === 'planning') {
    // the draft step and the haste step are the two planning sub-steps a
    // player waits through; both are worth a nudge when they open
    if (s.mode === 'draft' && s.draftDone && !s.draftDone.every(d => d)) return 'draft';
    return s.hasteDone ? 'haste' : 'plan';
  }
  return s.phase;
}

/**
 * Snapshot what `seat` can hear. `canAct` is passed in rather than derived,
 * because in network mode only the server knows the viewer's legal actions
 * (main.ts legalFor) — deriving it here would need the unredacted state.
 */
export function sfxSnap(s: GameState, seat: Seat, canAct: boolean): SfxSnap {
  const dec = s.decision && s.decision.seat === seat ? s.decision : null;
  return {
    phase: s.phase,
    step: stepOf(s),
    mine: canAct || !!dec,
    decision: !!dec,
    decisionId: dec ? dec.id : -1,
    over: s.phase === 'gameover',
  };
}

/**
 * The cue a state change earned, or null for silence.
 *
 * `before` is null on a fresh join, a reconnect resync or a return from the
 * home screen — states that arrive wholesale rather than by an action anyone
 * took. Those are SILENT by construction (main.ts sfxReset), which is what
 * stops a mid-game refresh from firing a phase cue for a phase that changed
 * ten minutes ago.
 */
export function diffSfx(before: SfxSnap | null, after: SfxSnap): Cue | null {
  if (!before) return null;
  // the game ending outranks everything, including the fact that it also
  // takes your priority away
  if (after.over) return before.over ? null : 'gameover';
  // a choice landing on you: either the prompt opened, or one prompt was
  // answered and the next arrived in the same update (a resolution chain
  // asking you two things in a row)
  if (after.decision && after.decisionId !== before.decisionId) return 'decision';
  if (after.phase !== before.phase) return 'phase';
  if (after.step !== before.step) return 'subphase';
  // priority ARRIVING, never priority merely being held — otherwise every
  // re-render during your own planning phase would tick
  if (after.mine && !before.mine) return 'priority';
  return null;
}

/**
 * Should the "you haven't reacted" timer be (re)armed by this change?
 *
 * Only when an obligation NEWLY arrives. Re-arming on every state change would
 * nag you at 15-second intervals through your own planning phase, which
 * inverts the point: the thump exists to catch the case where you looked away
 * and never noticed it became your move, not to hurry you along while you are
 * plainly sitting there thinking. ui/audio.ts disarms it the moment you act.
 *
 * Deliberately reads the SNAPSHOTS rather than the cue diffSfx returned. The
 * two questions are different, and conflating them loses the most important
 * case there is: when the phase turns and your move arrives in the same update
 * — deployment ending into your planning phase is exactly this — the phase cue
 * wins the precedence contest, and keying off the winning cue would leave the
 * thump unarmed on the one transition you are most likely to have wandered off
 * during. Precedence decides what you HEAR; the state decides what you OWE.
 */
export function armsIdle(before: SfxSnap | null, after: SfxSnap): boolean {
  if (!before || after.over) return false;
  if (after.decision && after.decisionId !== before.decisionId) return true;
  return after.mine && !before.mine;
}
