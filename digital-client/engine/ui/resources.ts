/* R151 (CT-31) — the resource row, as a view model.
 *
 * DOM-free, like ui/cardtext.ts and ui/inspect.ts: main.ts renders the answer
 * and test/127-token-x-and-dormant.test.ts checks it.
 *
 * Report #97, Bena: *"Dormant resources can misleadingly look like they're
 * active. Maybe have them not show up (or something) during battle/deployment
 * so players don't think they're active. During planning they should show
 * normally tho."*
 *
 * A dormant resource cannot be spent — it makes no mana and grants no affinity
 * (`E.affinity`: "dormant gives no affinity") — but on the board it is a card
 * in the same row as the ones that can, and a player totting up mana mid-
 * battle counts cards, not states. This is presentation only; nothing here
 * changes what may be paid.
 *
 * ── why the split is a value in the model, not a colour in the stylesheet ──
 *
 * "Draw it dimmer" is a CSS rule and a CSS rule cannot fail a test, which is
 * how a presentation bug comes back. `emphasis` is a discrete state on a pure
 * function's output, so the phase rule is pinned by a test that would go red
 * if the rule were dropped or inverted, and the stylesheet is then free to
 * express it however it likes.
 *
 * ── why it asks the engine what is spendable ──────────────────────────
 *
 * R132 just reversed R116 (a Prismite DOES activate its new resource), so what
 * counts as spendable is live rules surface. If the row re-derived it, the row
 * would drift the next time the rule moved. `spendable` is therefore checked
 * against the engine's OWN two answers — `E.openMana` for the count and
 * `E.affinity` per element for the dormant/active split — and `agreesWith
 * Engine` carries the result of that check into the model, so a desync is a
 * failing assertion rather than a wrong number on the table.
 */
import type { E } from '../src/engine.ts';
import type { Phase, ResourceKind, Seat } from '../src/types.ts';

/** the opponent's dormant resources arrive with their element redacted
 * (server/view.ts) — the row still has to draw the card */
export type ShownKind = ResourceKind | 'hidden';

/** how prominently the row draws one resource */
export type ResourceEmphasis = 'normal' | 'muted';

export interface ResourceView {
  /** position in `PlayerState.resources` — the index every action keys on */
  index: number;
  kind: ShownKind;
  state: 'dormant' | 'open' | 'expended';
  /** can a cost be paid with it RIGHT NOW (E.openMana counts exactly these) */
  spendable: boolean;
  /** does it grant affinity (E.affinity counts exactly these) */
  active: boolean;
  emphasis: ResourceEmphasis;
  /** the hover text, here rather than in the renderer so it is testable */
  title: string;
}

export interface ResourceRow {
  seat: Seat;
  phase: Phase;
  resources: ResourceView[];
  /** E.openMana(seat) — the engine's own number, and the one the row prints */
  mana: number;
  /** false when the per-resource flags no longer add up to the engine's
   * answers. Never expected to be false; it exists so that if the rules move
   * under this file the test says so instead of the table quietly lying. */
  agreesWithEngine: boolean;
}

/**
 * The phases a dormant resource is de-emphasised in.
 *
 * The owner's own scoping, verbatim: battle and deployment, "during planning
 * they should show normally tho" — and planning is the right exception for a
 * reason beyond taste, because planning is the phase you ACT on a dormant
 * resource in (activating it is a planning action, and the row is where you
 * click). Dimming the thing you are being asked to click would be worse than
 * the bug. Regroup and gameover are left alone: nothing is being spent and
 * nobody is counting mana against a clock.
 */
const MUTED_PHASES: ReadonlySet<Phase> = new Set<Phase>(['battle', 'deploy']);

export const mutesDormant = (phase: Phase): boolean => MUTED_PHASES.has(phase);

/**
 * How one resource should be drawn, given the phase.
 *
 * Only DORMANT is muted. An expended resource is already drawn turned sideways
 * and is not what report #97 is about — it was spent, which is a thing the
 * player did and remembers, rather than a thing that never woke up.
 */
export function emphasisOf(
  r: { state: 'dormant' | 'open' | 'expended' }, phase: Phase,
): ResourceEmphasis {
  return r.state === 'dormant' && mutesDormant(phase) ? 'muted' : 'normal';
}

const titleOf = (v: { kind: ShownKind; state: string; emphasis: ResourceEmphasis }): string => {
  const what = v.kind === 'hidden' ? 'dormant (element hidden)' : `${v.kind} (${v.state})`;
  return v.emphasis === 'muted'
    ? `${what} — dormant: it makes no mana and grants no affinity until you activate it during planning`
    : what;
};

/** The whole row for one seat, as the UI should draw it. */
export function resourceRow(e: E, seat: Seat): ResourceRow {
  const phase = e.s.phase;
  const resources: ResourceView[] = e.player(seat).resources.map((r, index) => {
    const kind = r.kind as ShownKind;
    const emphasis = emphasisOf(r, phase);
    const v: ResourceView = {
      index, kind, state: r.state,
      spendable: r.state === 'open',
      active: r.state !== 'dormant',
      emphasis,
      title: '',
    };
    v.title = titleOf(v);
    return v;
  });
  const mana = e.openMana(seat);
  return { seat, phase, resources, mana, agreesWithEngine: agrees(e, seat, resources) };
}

/**
 * Does the row's own split still match what the engine says?
 *
 * Two independent engine queries, because they disagree about `expended` and
 * that disagreement is exactly the seam a future rules change would land on:
 * `openMana` counts what can still be SPENT, `affinity` counts what is AWAKE
 * (an expended resource still grants affinity — engine.ts: "expended still
 * counts"). A Prismite grants no affinity at all, so it is checked only
 * against the spend count.
 */
function agrees(e: E, seat: Seat, views: ResourceView[]): boolean {
  if (views.filter(v => v.spendable).length !== e.openMana(seat)) return false;
  for (const kind of new Set(views.map(v => v.kind))) {
    if (kind === 'hidden' || kind === 'prismite' || kind === 'shard') continue;
    const mine = views.filter(v => v.kind === kind && v.active).length;
    if (mine !== e.affinity(seat, kind)) return false;
  }
  return true;
}
