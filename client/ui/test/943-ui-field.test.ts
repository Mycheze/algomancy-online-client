/* 943 · ui/components/field.ts — label tied to its control, hint and error
 * tied by aria-describedby, every control kind, escaping, data-btn on the control. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_CONTROLS, field } from '../components/field.ts';

test('an input: label for= the control, value escaped, data-btn on the control', () => {
  const html = field({ id: 'nm', label: 'Name <you>', value: '"Bob" & co', dataBtn: 'acct-name', className: 'wide' });
  assert.match(html, /^<div class="ui-field wide"><label class="ui-field__label" for="nm">Name &lt;you&gt;<\/label>/);
  assert.match(html, /<input class="ui-field__control" data-btn="acct-name" type="text" id="nm" value="&quot;Bob&quot; &amp; co">/);
});

test('hint and error: described-by, invalid, the error is an alert', () => {
  const html = field({ id: 'pw', label: 'Password', type: 'password', hint: 'eight or more', error: 'too <short>' });
  assert.match(html, /aria-describedby="pw-hint pw-error" aria-invalid="true"/);
  assert.match(html, /class="ui-field ui-field--invalid"/);
  assert.match(html, /<span class="ui-field__hint" id="pw-hint">eight or more<\/span>/);
  assert.match(html, /<span class="ui-field__error" id="pw-error" role="alert">too &lt;short&gt;<\/span>/);
});

test('every control kind renders', () => {
  assert.deepEqual([...FIELD_CONTROLS], ['input', 'textarea', 'select']);
  assert.match(field({ id: 't', label: 'Deck', control: 'textarea', rows: 4, value: '</textarea><b>' }),
    /<textarea class="ui-field__control" id="t" rows="4">&lt;\/textarea&gt;&lt;b&gt;<\/textarea>/);
  const sel = field({ id: 's', label: 'Zone', control: 'select', value: 'b', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B & C' }] });
  assert.match(sel, /<select class="ui-field__control" id="s"><option value="a">A<\/option><option value="b" selected>B &amp; C<\/option><\/select>/);
});

test('a checkbox: box first, then its label, in the check layout', () => {
  const html = field({ id: 'c', label: 'Rated', type: 'checkbox', checked: true });
  assert.match(html, /^<div class="ui-field ui-field--check"><input class="ui-field__check" type="checkbox" id="c" checked><label/);
});
