/* BL-26 — the game clock a player asks for on a room they CREATE: the banks the
 * home screen offers, the default per mode, and the picker drawn on the Live
 * draft card (inside Custom rules) and the Constructed card (in its Options
 * fold).
 *
 * Moved out of main.ts in the design-system round (2026-11-03) with the home
 * screen. main.ts still imports `chosenClockMs` and `CLOCK_DEFAULT_MS` for the
 * two buttons that use them (`newgame`, `clockpick`, in handlePregameButton).
 * The server keeps its own copy of the per-mode table (server/rooms.ts
 * MATCH_CLOCK_MS); engine test 279 locks the two together by reading this file. */
import { segmented } from '../components/index.ts';
import { esc } from '../util.ts';

/**
 * BL-26 — THE BANKS THE HOME SCREEN OFFERS for a game you START.
 *
 * ⚠ THIS WAS A PLACEHOLDER SET AND IS NOT ANY MORE. The list was six evenly
 * spaced numbers with a comment saying which presets to show was the owner's
 * call, open as Q4 in docs/questions-round36.md. He answered:
 *
 *   "45m and 60m. Constructed games are shorter, so I'd say the default for
 *    constructed is 45m and the default for live draft is 60m."
 *
 * So there are three chips, not six, and the DEFAULT is not a constant any
 * more — it is a function of the mode, which is the part a single
 * `CLOCK_DEFAULT_MS` could not express. The SERVER still validates a RANGE
 * rather than a list (`sanitizeClock`: anything between MIN_CLOCK_MS and
 * MAX_CLOCK_MS, with 0 / 'off' meaning no clock), so this is what the screen
 * offers and not a rule about what a room may be — an old link with
 * `clock=90m` on it is still honoured.
 */
export const CLOCK_PRESETS: readonly { ms: number; label: string; why: string }[] = [
  { ms: 0, label: 'Off', why: 'no clock at all — nobody can lose on time' },
  { ms: 45 * 60_000, label: '45m', why: '45 minutes each — the constructed default' },
  { ms: 60 * 60_000, label: '60m', why: '60 minutes each — the live-draft default' },
];

/**
 * BL-26 — THE DEFAULT BANK PER MODE, the owner's answer in one place.
 *
 * A draft game includes the draft, which a constructed game does not, so it
 * gets the longer bank. `shared` is the quick shared-pool game and takes the
 * constructed number: it deals rather than drafts, so it is the SHORT shape.
 */
export const CLOCK_DEFAULT_BY_MODE: Record<string, number> = {
  constructed: 45 * 60_000,
  shared: 45 * 60_000,
  draft: 60 * 60_000,
};
/** what "Default" means with no mode in hand — the picker's own highlight, and
 * the fallback for a stored value that is not a number */
export const CLOCK_DEFAULT_MS = CLOCK_DEFAULT_BY_MODE['constructed']!;

/**
 * The bank this browser will ask for on the next room it CREATES.
 *
 * ⚠ NOTHING STORED IS NOT THE SAME AS A STORED DEFAULT. The picker's fourth
 * state is "Default", which REMOVES the key — so the mode decides, and a
 * player who never touches the picker gets 45m for constructed and 60m for a
 * draft without having to know that. A player who picks a number gets that
 * number in every mode, because they asked for it.
 */
export function chosenClockMs(mode?: string): number {
  const raw = localStorage.getItem('algoClockMs');
  const byMode = (mode !== undefined && CLOCK_DEFAULT_BY_MODE[mode]) || CLOCK_DEFAULT_MS;
  if (raw === null) return byMode;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : byMode;
}
/** BL-26: is the picker on "Default" (i.e. let the mode decide)? */
export const clockIsAuto = (): boolean => localStorage.getItem('algoClockMs') === null;

export interface ClockPickView {
  /** which card the picker sits on — written to data-clockpick / data-clockfor */
  mode: 'draft' | 'constructed';
  /** the picker is on "Default" (nothing stored: the mode decides) */
  auto: boolean;
  /** the stored bank in ms (0 = no clock); only read when not `auto` */
  now: number;
  /** what "Default" means on this card, in whole minutes */
  byModeMin: number;
}

/** gather the picker's state (localStorage) for the card `mode` */
export function clockPickView(mode: 'draft' | 'constructed'): ClockPickView {
  return {
    mode,
    auto: clockIsAuto(),
    now: chosenClockMs(),
    byModeMin: Math.round(chosenClockMs(mode) / 60_000),
  };
}

/** BL-26: the picker — the clock for a game you START, so it applies to the
 * New buttons on the card it sits on and to neither of the ways you JOIN a
 * room somebody else made.
 *
 * #191 (owner): "The clock setting should be in the custom rules area, not
 * taking up space up above." So it is drawn TWICE, once per card that starts
 * a game: inside Custom rules on the Live draft card and in a small Options
 * fold on the Constructed card. Both copies read and write the one
 * `algoClockMs` setting.
 *
 * ⚠ It sits INSIDE the custom rules panel but is NOT a custom rule: a custom
 * game counts toward nothing, and the clock must not make a game custom. It is
 * handed to the panel as markup and stays out of the rules object, so
 * `createPayload` and the panel's "— none set" summary never see it.
 *
 * Pure: everything it shows comes in through `v` (clockPickView). */
export function clockPickHtml(v: ClockPickView, o: { look?: 'chips' | 'segmented' } = {}): string {
  const { mode, auto, now } = v;
  const byMode = v.byModeMin;
  const hint = auto
    ? `${byMode}m each`
    : now ? 'running out of time loses the game'
    : 'no clock — nobody can lose on time';
  // the new home (docs/24, 2026-11-03): the same four choices as one segmented
  // control in the Play card's Clock row, which carries its own label. Same
  // data-btn, data-ms and data-clockfor; `.on` marks the choice as before.
  if (o.look === 'segmented') {
    return `<div class="clockpick clockpick--seg" data-clockpick="${mode}">${segmented({
      ariaLabel: 'Clock', size: 'sm',
      options: [
        { label: 'Default', value: 'auto', on: auto, dataBtn: 'clockpick', title: '45 min constructed · 60 min live draft',
          attrs: { 'data-ms': 'auto', 'data-clockfor': mode } },
        ...CLOCK_PRESETS.map(c => ({ label: c.label, value: String(c.ms), on: !auto && c.ms === now, dataBtn: 'clockpick', title: c.why,
          attrs: { 'data-ms': c.ms, 'data-clockfor': mode } })),
      ],
    })}<span class="clockpickhint">${hint}</span></div>`;
  }
  return `<div class="clockpick" data-clockpick="${mode}" title="the clock for games you start">
    <span class="clockpicklabel">⏱ Clock</span>
    <button class="elchip${auto ? ' on' : ''}" data-btn="clockpick" data-ms="auto" data-clockfor="${mode}"
      title="45 min constructed · 60 min live draft">Default</button>
    ${CLOCK_PRESETS.map(c => `<button class="elchip${!auto && c.ms === now ? ' on' : ''}"
      data-btn="clockpick" data-ms="${c.ms}" data-clockfor="${mode}" title="${esc(c.why)}">${esc(c.label)}</button>`).join('')}
    <span class="clockpickhint">${auto
      ? `${byMode}m each`
      : now ? 'running out of time loses the game'
      : 'no clock — nobody can lose on time'}</span>
  </div>`;
}
