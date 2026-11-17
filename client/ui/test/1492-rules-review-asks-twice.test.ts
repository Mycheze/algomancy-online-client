/* The rules review page asks twice in the page, never through the browser's
 * own confirm box: Delete on a comment arms on the first press ("Press again
 * to delete", drawn as danger the way the league and challenge pages draw it)
 * and any other button of the page disarms it; a click beside a composer with
 * words in it asks to be clicked again, and typing takes the question back.
 *
 *   §1 the markup: an armed Delete, an unarmed one, and no confirm() in ui/
 *   §2 crreview.ts driven through a stubbed server: one press sends nothing
 *   §3 crlayer.ts driven through a fake document: one click beside keeps the words
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CrComment } from '../crtypes.ts';
import { readStyles } from './read-styles.ts';

const UI = dirname(dirname(fileURLToPath(import.meta.url)));
const g = globalThis as Record<string, unknown>;

const comment = (over: Partial<CrComment> = {}): CrComment => ({
  id: 'c1', target: 'sec:100', parent: null, anchor: null, body: 'words', by: { name: 'Ann' } as CrComment['by'],
  at: '2026-11-17T00:00:00Z', mine: true, canEdit: true, canResolve: false, ...over,
});

test('1492 §1 BL-10: an armed Delete says press again and is drawn as danger; nothing in ui/ calls confirm()', async () => {
  const { commentHtml } = await import('../crreview.ts');
  const calm = commentHtml(comment());
  assert.match(calm, /<button data-btn="cr-delete" data-id="c1">Delete<\/button>/);
  assert.doesNotMatch(calm, /Press again|danger/);
  assert.match(commentHtml(comment(), true), /<button class="danger" data-btn="cr-delete" data-id="c1">Press again to delete<\/button>/);

  const rule = readStyles().match(/([^{}]*\.lgpage button\.danger[^{}]*)\{[^}]*var\(--danger\)/);
  assert.ok(rule?.[1]?.includes('.cracts button.danger'), 'the comment actions share the league\'s danger rule');

  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (f.isDirectory()) { if (!['node_modules', 'test', 'styles'].includes(f.name)) walk(join(dir, f.name)); continue; }
      if (!f.name.endsWith('.ts')) continue;
      const src = readFileSync(join(dir, f.name), 'utf8');
      if (/\b(window\.)?confirm\(\s*['"`]/.test(src)) offenders.push(join(dir, f.name).slice(UI.length + 1));
    }
  };
  walk(UI);
  assert.deepEqual(offenders, [], 'a native confirm box: ask twice in the page instead');
});

test('1492 §2 BL-10: Delete sends nothing on the first press, deletes on the second, and another button disarms', async () => {
  const sent: string[] = [];
  const was = { fetch: g['fetch'], document: g['document'], localStorage: g['localStorage'] };
  const store = new Map<string, string>();
  g['localStorage'] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  g['document'] = { getElementById: () => null };
  const c1 = comment();
  g['fetch'] = async (url: string, init?: { body?: string }) => {
    if (url.startsWith('/api/cr/comments')) {
      return { status: 200, json: async () => ({ ok: true, comments: [c1, comment({ id: 'c2' })], you: { name: 'Ann', canComment: true }, rev: 1 }) };
    }
    sent.push(init?.body ?? '');
    return { status: 200, json: async () => ({ ok: true, comment: { ...c1, deleted: true, body: '' } }) };
  };
  try {
    const { handleButton } = await import('../crreview.ts');
    const press = (btn: string, id = ''): boolean => handleButton({ dataset: { btn, id } } as unknown as HTMLElement);
    press('cr-refresh');
    await new Promise(r => setTimeout(r, 0));

    press('cr-delete', 'c1');
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(sent, [], 'the first press only arms');
    press('cr-delete', 'c2');
    press('cr-delete', 'c1');
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(sent, [], 'pressing another comment\'s Delete moves the question, it does not delete');
    press('cr-expand', 'c1');
    press('cr-delete', 'c1');
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(sent, [], 'any other button disarms');
    press('cr-delete', 'c1');
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(sent.map(b => JSON.parse(b)), [{ op: 'delete', id: 'c1' }], 'the second press deletes');
  } finally {
    Object.assign(g, was);
  }
});

test('1492 §3 BL-10: a click beside the composer asks again before it throws the words away', async () => {
  const handlers: Record<string, (e: unknown) => void> = {};
  const layer = { id: '', innerHTML: '', contains: () => false };
  const box = {
    value: '', on: {} as Record<string, () => void>,
    focus() {}, setSelectionRange() {}, addEventListener(t: string, fn: () => void) { this.on[t] = fn; },
  };
  const type = (v: string): void => { box.value = v; box.on['input']!(); };
  const was = { document: g['document'], window: g['window'] };
  g['window'] = { addEventListener: () => {} };
  g['document'] = {
    body: { appendChild: () => {} },
    createElement: () => layer,
    getElementById: (id: string) => (id === 'cr-draft' ? box : null),
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn; },
  };
  try {
    const cl = await import('../crlayer.ts');
    let submitted = 0;
    cl.setCrLayerHost({
      active: () => true, canComment: () => ({ ok: true }), submit: async () => { submitted++; return null; },
    } as unknown as Parameters<typeof cl.setCrLayerHost>[0]);
    cl.installCrLayer();
    const beside = (): void => {
      const t = { id: 'crscrim', closest: () => null };
      handlers['click']!({ target: t, preventDefault() {}, stopPropagation() {} });
    };
    const c = { mode: 'add' as const, target: 'sec:100', anchor: null, label: '100' };

    cl.openComposer({ ...c, draft: 'half a thought' });
    beside();
    assert.ok(cl.isComposerOpen(), 'the first click beside keeps the box');
    assert.ok(layer.innerHTML.includes(cl.DISCARD_ASK), 'and says what a second click does');
    beside();
    assert.ok(!cl.isComposerOpen(), 'the second click closes it');
    cl.openComposer(c);
    assert.equal(box.value, '', 'and the words are gone');
    assert.ok(!layer.innerHTML.includes(cl.DISCARD_ASK), 'a new box starts unarmed');
    cl.closeComposer();

    cl.openComposer(c);
    type('second thoughts');
    beside();
    type('second thoughts, longer');
    beside();
    assert.ok(cl.isComposerOpen(), 'typing after the question takes it back: the next click asks again');
    assert.ok(layer.innerHTML.includes(cl.DISCARD_ASK));
    cl.closeComposer();
    cl.openComposer(c);
    assert.equal(box.value, 'second thoughts, longer', 'closing with Cancel keeps the words for next time');
    type('');
    cl.closeComposer();
    cl.openComposer(c);

    beside();
    assert.ok(!cl.isComposerOpen(), 'an empty box closes on one click: there is nothing to lose');

    cl.openComposer({ ...c, draft: 'kept' });
    beside();
    cl.closeComposer();
    cl.openComposer(c);
    assert.equal(box.value, 'kept', 'Cancel after the question still keeps the words');
    assert.ok(!layer.innerHTML.includes(cl.DISCARD_ASK), 'and reopening starts unarmed');
    assert.equal(submitted, 0);
    cl.closeComposer();
  } finally {
    Object.assign(g, was);
  }
});
