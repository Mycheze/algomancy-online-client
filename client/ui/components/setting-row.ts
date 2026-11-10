/* Setting row — one setting of a form laid out as a row: its name on the
 * left, the control on the right, and a line of hint under the control.
 *
 * The home's Play card drew these by hand (`.homerow`, 2026-11-03: Mode,
 * Clock, Elements, Cards, Banned, Game values, Format, Best of, Deck); the
 * matchmaking page has the same shape (Format, Who you play, Deck). One
 * component since 2026-11-04, so a change to how a setting reads changes it
 * on every form. The label column's width is a token (--setting-row-label);
 * below a tablet the row stacks.
 *
 * `controlHtml` and `hintHtml` are trusted markup (usually a segmented
 * control, a picker, a sentence with a link in it).
 *
 * ⚠ The label column is a <div>, not a <label>: it names nothing. A text box
 * or a <select> passed as the control carries its own aria-label (the same
 * words as `label`), or a screen reader calls it "edit text" and no more
 * (ui/test/1205). */
import { type Common, esc, rootAttrs } from './_shared.ts';

export interface SettingRowProps extends Common {
  label: string;
  /** trusted markup: the control */
  controlHtml: string;
  /** trusted markup: a line under the control ('' or absent: none) */
  hintHtml?: string;
}

export function settingRow(p: SettingRowProps): string {
  return `<div${rootAttrs('ui-setting-row', p)}><div class="ui-setting-row__label">${esc(p.label)}</div>
    <div class="ui-setting-row__control">${p.controlHtml}${p.hintHtml ? `<div class="ui-setting-row__hint">${p.hintHtml}</div>` : ''}</div></div>`;
}
