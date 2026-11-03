/* 952 · ui/components/dialog.ts — native <dialog> markup, and the open/close helpers on fakes */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIALOG_WIDTHS, type DialogLike, closeDialog, dialog, installDialogClose, openDialog } from '../components/dialog.ts';

test('the markup: labelled by its title, the ✕, body and actions; every width', () => {
  const html = dialog({ id: 'rep', title: 'Report <bug>', bodyHtml: '<p>b</p>', actionsHtml: '<button>Send</button>', closeDataBtn: 'rep-x', dataBtn: 'd' });
  assert.match(html, /^<dialog class="ui-dialog ui-dialog--md" data-btn="d" id="rep" aria-labelledby="rep-title">/);
  assert.match(html, /<h3 class="ui-dialog__title" id="rep-title">Report &lt;bug&gt;<\/h3>/);
  assert.match(html, /<button class="ui-button ui-button--icon ui-dialog__close" data-btn="rep-x" type="button" title="Close" aria-label="Close" data-dialog-close>✕<\/button>/);
  assert.match(html, /<div class="ui-dialog__body"><p>b<\/p><\/div><div class="ui-dialog__actions"><button>Send<\/button><\/div><\/dialog>$/);
  for (const width of DIALOG_WIDTHS) assert.match(dialog({ id: 'x', title: 't', width }), new RegExp(`ui-dialog--${width}`));
  assert.ok(!dialog({ id: 'x', title: 't', closable: false }).includes('ui-dialog__close'));
});

const fake = (open = false): DialogLike & { calls: string[] } => {
  const d = { open, calls: [] as string[],
    showModal() { d.calls.push('show'); d.open = true; },
    close(rv?: string) { d.calls.push(`close:${rv ?? ''}`); d.open = false; } };
  return d;
};

test('openDialog / closeDialog: only when it makes a difference', () => {
  const d = fake();
  assert.equal(openDialog(d), true);
  assert.equal(openDialog(d), false);
  assert.equal(closeDialog(d, 'ok'), true);
  assert.equal(closeDialog(d), false);
  assert.deepEqual(d.calls, ['show', 'close:ok']);
  assert.equal(openDialog(null), false);
});

test('installDialogClose closes the dialog around a [data-dialog-close] click, and nothing else', () => {
  let listener: ((e: { target: unknown }) => void) | undefined;
  installDialogClose({ addEventListener: (_t, fn) => { listener = fn; } });
  const d = fake(true);
  const inDialog = { closest: (s: string) => (s === 'dialog' ? d : null) };
  const closeBtn = { closest: (s: string) => (s === '[data-dialog-close]' ? inDialog : null) };
  const other = { closest: () => null };
  listener!({ target: other });
  listener!({ target: 'text node' });
  assert.equal(d.open, true);
  listener!({ target: closeBtn });
  assert.equal(d.open, false);
});
