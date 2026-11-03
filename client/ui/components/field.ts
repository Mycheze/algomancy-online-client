/* Field — a label, one control, and the hint and error under it.
 *
 * The client has no input rule today: the recipe (raised surface, hairline
 * border, 5px radius, 6px 8px) is written out ~15 times (census §8b), and the
 * one labelled-form layout is the league's `.lgform label` (a column, 12px
 * muted label over the control). This is both, once. A checkbox is laid out in
 * a row with its label after it, as `.lgform label:has(input[type=checkbox])`
 * does.
 *
 * `id` is required: the label points at the control by it, and the hint and
 * the error are tied to the control with aria-describedby (`<id>-hint`,
 * `<id>-error`). A pure function cannot invent unique ids, so the page names
 * them. `dataBtn`, `attrs` go on the CONTROL (that is the element a page reads
 * or listens to); `className` goes on the wrapper. */
import { type Attrs, type Common, attrsHtml, classes, esc, rootAttrs } from './_shared.ts';

export const FIELD_CONTROLS = ['input', 'textarea', 'select'] as const;
export type FieldControl = typeof FIELD_CONTROLS[number];

export interface FieldOption { value: string; label: string; disabled?: boolean }

export interface FieldProps extends Common {
  id: string;
  label: string;
  control?: FieldControl;
  /** for an input: text (default), number, password, search, email, checkbox, … */
  type?: string;
  name?: string;
  value?: string | number;
  /** a checkbox's state */
  checked?: boolean;
  placeholder?: string;
  hint?: string;
  error?: string;
  /** a select's options; the one whose value equals `value` is selected */
  options?: FieldOption[];
  rows?: number;
  required?: boolean;
  disabled?: boolean;
}

export function field(p: FieldProps): string {
  const control = p.control ?? 'input';
  const check = control === 'input' && (p.type === 'checkbox' || p.type === 'radio');
  const describedBy = [p.hint ? `${p.id}-hint` : '', p.error ? `${p.id}-error` : ''].filter(Boolean).join(' ');
  const shared: Attrs = {
    id: p.id, name: p.name, required: p.required, disabled: p.disabled,
    'aria-describedby': describedBy || undefined, 'aria-invalid': p.error ? 'true' : undefined,
  };
  const ctlCommon = { dataBtn: p.dataBtn, attrs: p.attrs };
  let ctl: string;
  if (control === 'textarea') {
    ctl = `<textarea${rootAttrs('ui-field__control', ctlCommon, { ...shared, rows: p.rows, placeholder: p.placeholder })}>${
      p.value === undefined ? '' : esc(p.value)}</textarea>`;
  } else if (control === 'select') {
    const opts = (p.options ?? []).map(o => `<option${attrsHtml({
      value: o.value, selected: p.value !== undefined && String(p.value) === o.value, disabled: o.disabled,
    })}>${esc(o.label)}</option>`).join('');
    ctl = `<select${rootAttrs('ui-field__control', ctlCommon, shared)}>${opts}</select>`;
  } else {
    ctl = `<input${rootAttrs(check ? 'ui-field__check' : 'ui-field__control', ctlCommon, {
      type: p.type ?? 'text', ...shared, value: p.value, checked: p.checked, placeholder: p.placeholder,
    })}>`;
  }
  const label = `<label class="ui-field__label" for="${esc(p.id)}">${esc(p.label)}</label>`;
  const hint = p.hint ? `<span class="ui-field__hint" id="${esc(p.id)}-hint">${esc(p.hint)}</span>` : '';
  const error = p.error ? `<span class="ui-field__error" id="${esc(p.id)}-error" role="alert">${esc(p.error)}</span>` : '';
  const cls = classes('ui-field', check && 'ui-field--check', p.error && 'ui-field--invalid', p.className);
  return `<div class="${cls}">${check ? ctl + label : label + ctl}${hint}${error}</div>`;
}
