/* 1486 — BL-10: a Learn to Play start that throws away a game in progress asks
 * twice (docs/23-ui-inventory/04 §L.11: "`Start over` in the learn menu wipes
 * progress with no confirm at all"). There is one saved lesson game, and every
 * new start replaces it: Start over, Client tips only, and Start with another
 * element picked. Each is the press-again pattern of giving up a challenge run.
 *
 * §1 the view: nothing saved asks nothing; a saved game makes the three starts ask
 * §2 armed, the button says what a second press does, in the danger style
 * §3 the layer: one press arms and goes nowhere, the second goes; any other press disarms
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksTwice, learnMenuHtml, learnMenuView } from '../pages/learn.ts';
import type { LearnProgress } from '../learn.ts';

const saved = (element: string, tips = false): LearnProgress =>
  ({ v: 1, element, seen: [], game: { v: 1 }, ...(tips ? { tips } : {}) } as unknown as LearnProgress);
const btnOf = (html: string, lmenu: string): string =>
  html.match(new RegExp(`<button [^>]*data-lmenu="${lmenu}"[^>]*>[^<]*</button>`))?.[0] ?? '';

test('1486 §1 BL-10: only a start over a game in progress asks twice', () => {
  for (const k of ['fresh', 'start', 'tips']) {
    assert.equal(asksTwice(null, k), false, `${k}: nothing saved`);
    assert.equal(asksTwice(saved('fire'), k), true, `${k}: a game in progress`);
  }
  for (const k of ['continue', 'el', 'read', 'close', '']) assert.equal(asksTwice(saved('fire'), k), false, k);
  assert.equal(learnMenuView(null, 'fire', 'start').armed, null, 'nothing to lose: never drawn armed');
});

test('1486 §2 BL-10: armed, the button says what the second press does', () => {
  const fresh = learnMenuHtml(learnMenuView(saved('fire'), 'fire', 'fresh'));
  assert.match(btnOf(fresh, 'fresh'), /ui-button--danger[^>]*>Press again to start over</);
  assert.match(btnOf(fresh, 'continue'), />Continue your Fire game</, 'Continue stays as it was');
  const other = learnMenuHtml(learnMenuView(saved('fire'), 'water', 'start'));
  assert.match(btnOf(other, 'start'), /ui-button--danger[^>]*>Press again to end your Fire game</);
  const tips = learnMenuHtml(learnMenuView(saved('earth', true), 'fire', 'tips'));
  assert.match(btnOf(tips, 'tips'), /ui-button--danger[^>]*>Press again to end your Earth tips game</);
  const calm = learnMenuHtml(learnMenuView(saved('fire'), 'fire'));
  assert.doesNotMatch(calm, /Press again|ui-button--danger/, 'unarmed, nothing changes');
});

test('1486 §3 BL-10: the layer arms on the first press, goes on the second, and any other press disarms', async () => {
  const store = new Map<string, string>();
  const handlers: Record<string, (e: unknown) => void> = {};
  const layer = { id: '', innerHTML: '', contains: () => true };
  const g = globalThis as Record<string, unknown>;
  const was = { document: g['document'], localStorage: g['localStorage'], location: g['location'] };
  g['localStorage'] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  g['location'] = { search: '' };
  g['document'] = {
    body: { appendChild: () => {} },
    createElement: () => layer,
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn; },
  };
  try {
    const { installLearnMenu, openLearnMenu } = await import('../learnmenu.ts');
    const { saveProgress } = await import('../learn.ts');
    installLearnMenu();
    const press = (lmenu: string, data: Record<string, string> = {}): void => {
      const t = { id: '', dataset: { lmenu, ...data }, closest: (sel: string) => (sel === '[data-lmenu]' ? t : null) };
      handlers['click']!({ target: t, preventDefault() {}, stopPropagation() {} });
    };
    const loc = g['location'] as { search: string };

    saveProgress(saved('fire'));
    openLearnMenu();
    press('fresh');
    assert.equal(loc.search, '', 'the first press goes nowhere');
    assert.match(layer.innerHTML, />Press again to start over</);
    press('fresh');
    assert.equal(loc.search, '?learn=play&el=fire&new=1', 'the second press starts over');

    loc.search = '';
    openLearnMenu();
    assert.doesNotMatch(layer.innerHTML, /Press again/, 'opening the menu again starts unarmed');
    press('fresh');
    press('el', { el: 'water' });
    assert.doesNotMatch(layer.innerHTML, /Press again/, 'picking an element disarms');
    press('start');
    assert.equal(loc.search, '', 'Start over another element\'s game asks first');
    assert.match(layer.innerHTML, />Press again to end your Fire game</);
    press('tips');
    assert.equal(loc.search, '', 'a different start re-arms, it does not go');
    assert.match(layer.innerHTML, /data-lmenu="tips">Press again to end your Fire game</);
    press('tips');
    assert.equal(loc.search, '?learn=play&el=water&new=1&tips=1');

    loc.search = '';
    store.clear();
    openLearnMenu();
    press('start');
    assert.equal(loc.search, '?learn=play&el=water', 'nothing saved: one press starts');
  } finally {
    Object.assign(g, was);
  }
});
