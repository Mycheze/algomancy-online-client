/* 953 · ui/components/toast.ts — the markup, and showToast() on a fake document:
 * one region, made once, reused; a second toast replaces the first; it hides. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOAST_REGION_ID, TOAST_TONES, type ToastDoc, type ToastEl, showToast, toastHtml } from '../components/toast.ts';

test('toastHtml: every tone, escaped, on by default; danger is an alert', () => {
  for (const tone of TOAST_TONES) assert.match(toastHtml({ text: 'x', tone }), new RegExp(`^<div class="ui-toast ui-toast--${tone} on"`));
  assert.equal(toastHtml({ text: 'saved <deck>', dataBtn: 't' }),
    '<div class="ui-toast ui-toast--success on" data-btn="t" role="status" aria-live="polite">saved &lt;deck&gt;</div>');
  assert.match(toastHtml({ text: 'x', tone: 'danger', on: false }), /^<div class="ui-toast ui-toast--danger" role="alert" aria-live="assertive">/);
});

function fakeDoc(): ToastDoc & { made: ToastEl[] } {
  const made: ToastEl[] = [];
  return {
    made,
    getElementById: id => made.find(e => e.id === id) ?? null,
    createElement: () => {
      const el: ToastEl & { attrs: Record<string, string> } = { id: '', className: '', textContent: '', attrs: {},
        setAttribute(n, v) { el.attrs[n] = v; } };
      return el;
    },
    body: { appendChild: (el: ToastEl) => made.push(el) },
  };
}

test('showToast: one region, text as text, replaced by the next, hidden on dismiss', () => {
  const doc = fakeDoc();
  const d1 = showToast('Deck <saved>', { doc, ms: 60_000 });
  assert.equal(doc.made.length, 1);
  const el = doc.made[0]!;
  assert.equal(el.id, TOAST_REGION_ID);
  assert.equal(el.textContent, 'Deck <saved>', 'textContent, never innerHTML: the text cannot become markup');
  assert.equal(el.className, 'ui-toast ui-toast--success on');
  const d2 = showToast('Gone', { doc, tone: 'danger', ms: 60_000 });
  assert.equal(doc.made.length, 1, 'the second toast reuses the region');
  assert.equal(el.className, 'ui-toast ui-toast--danger on');
  d1();
  d2();
  assert.equal(el.className, 'ui-toast ui-toast--danger');
});

test('showToast hides itself after ms', async () => {
  const doc = fakeDoc();
  showToast('brief', { doc, ms: 5 });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(doc.made[0]!.className, 'ui-toast ui-toast--success');
});

test('showToast without a document does nothing', () => {
  assert.equal(typeof showToast('x', { doc: undefined }), 'function');
});
