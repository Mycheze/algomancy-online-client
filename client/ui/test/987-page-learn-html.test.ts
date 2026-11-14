/* 987 — LEARN TO PLAY'S MENU, DRAWN WITHOUT A PAGE (design-system round,
 * 2026-11-03). The menu's markup left ui/learnmenu.ts for pages/learn.ts:
 * learnMenuView gathers the saved progress, learnMenuHtml draws it.
 *
 * §1 nothing saved: Start, the elements, the picked one on, every lesson
 * §2 a saved game with this element: Continue and Start over; with another: Start
 * §3 a lesson already shown is ticked; every data-lmenu the layer routes is drawn
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnMenuHtml, learnMenuView } from '../pages/learn.ts';
import { LEARN_ELEMENTS } from '../lessondeck.ts';
import { ALL_LESSONS } from '../lessons.ts';
import type { LearnProgress } from '../learn.ts';

const saved = (element: string, seen: string[] = []): LearnProgress =>
  ({ v: 1, element, seen, game: {} } as unknown as LearnProgress);
const lm = (html: string): string[] => [...html.matchAll(/data-lmenu="([^"]+)"/g)].map(m => m[1]!);

test('987 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  // a sheet since 2026-11-04 (components/sheet.ts); the root keeps the layer's learnscrim id and class
  assert.match(learnMenuHtml(learnMenuView(null, 'fire')), /^<div class="ui-sheet ui-sheet--center ui-sheet--md learnscrim learnsheet" id="learnscrim"/);
});

test('987 §1 nothing saved: Start, the elements with the picked one on, every lesson', () => {
  const v = learnMenuView(null, 'water');
  assert.equal(v.saved, false);
  const html = learnMenuHtml(v);
  assert.match(html, /class="ui-button ui-button--primary learngobtn" type="button" data-lmenu="start">Start the Water game</);
  assert.doesNotMatch(html, /data-lmenu="continue"/);
  assert.equal([...html.matchAll(/class="learnel /g)].length, LEARN_ELEMENTS.length);
  assert.match(html, /class="learnel el-water on" aria-pressed="true" data-lmenu="el" data-el="water"/);
  assert.equal([...html.matchAll(/data-lmenu="read"/g)].length, ALL_LESSONS.length);
});

test('987 §2 a saved game: Continue and Start over for its element, Start for another', () => {
  const html = learnMenuHtml(learnMenuView(saved('fire'), 'fire'));
  assert.match(html, /data-lmenu="continue">Continue your Fire game<\/button><button class="ui-button ui-button--secondary learngobtn" type="button" data-lmenu="fresh">Start over</);
  assert.match(learnMenuHtml(learnMenuView(saved('fire'), 'earth')), /data-lmenu="start">Start the Earth game</);
});

test('987 §3 a lesson already shown is ticked; every routed data-lmenu is drawn', () => {
  const first = ALL_LESSONS[0]!;
  const html = learnMenuHtml(learnMenuView(saved('fire', [first.id]), 'fire'));
  assert.equal([...html.matchAll(/class="learnseen"/g)].length, 1);
  assert.match(html, new RegExp(`data-i="0">${first.n}\\. [^<]+</button> <span class="learnseen">✓</span>`));
  for (const k of ['el', 'continue', 'fresh', 'read']) assert.ok(lm(html).includes(k), k);
  // closing is the sheet's: its scrim and its ✕ carry data-sheet-dismiss, which ui/learnmenu.ts closes on
  assert.equal([...html.matchAll(/data-sheet-dismiss/g)].length, 2, 'the scrim and the ✕');
});

test('987 §4 BL-11: "Client tips only" is always offered, and a saved tips game says so', () => {
  const none = learnMenuHtml(learnMenuView(null, 'fire'));
  assert.match(none, /data-lmenu="tips">Client tips only</);
  assert.match(none, /Already know Algomancy\?/);
  const tipsGame = { ...saved('fire'), tips: true } as LearnProgress;
  assert.equal(learnMenuView(tipsGame, 'fire').savedTips, true);
  assert.match(learnMenuHtml(learnMenuView(tipsGame, 'fire')), /data-lmenu="continue">Continue your Fire tips game</);
  assert.equal(learnMenuView(saved('fire'), 'fire').savedTips, false);
  assert.equal(learnMenuView(tipsGame, 'water').savedTips, false, 'another element has no saved game');
  assert.ok(lm(learnMenuHtml(learnMenuView(tipsGame, 'fire'))).includes('tips'));
});
