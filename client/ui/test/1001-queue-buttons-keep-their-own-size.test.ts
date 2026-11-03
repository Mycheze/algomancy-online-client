/* 1001 — THE QUEUE SCREEN'S BUTTONS DRAW AT THEIR OWN SIZES
 * (design-system round, 2026-11-03, stream ds-w3b).
 *
 * The queue screen's root keeps `.joinscreen` (report.ts reads the page off
 * it; test 902), and `.joinscreen button { font-size: 16px; padding: 8px }`
 * (0,1,1) outranked every one-class rule for a button in it. So since the
 * queue was built (2026-09-02) its Find button (.qgo, 14px bold), the
 * ranked/open choices (.qopt), the format chips (.elchip), the home link and
 * Stop (ui-back-link / ui-button, small) and the offer's Decline (.qdecline,
 * 12px) all drew at 16px with 8px padding: none of their own sizes ever
 * showed. The join-screen rule now skips the queue screen, at the same
 * specificity (the :not sits in a :where), so every other join screen (the
 * connecting screen, sign-in) is exactly as it was.
 *
 * §1 the rule skips .queuescreen and keeps its specificity
 * §2 no other rule sizes every button under .joinscreen
 * §3 the queue's own rules are there to take over (positive control)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStyles } from './read-styles.ts';

const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
/** every top-level-or-media rule as [selector, body] */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1]!.trim(), m[2]!] as const);

test('1001 §1 the join screen\'s button rule skips the queue screen, at the same specificity', () => {
  const sized = rules.filter(([sel, body]) => /\.joinscreen\b[^,]*\sbutton\s*$/.test(sel) && /font-size|padding/.test(body));
  assert.equal(sized.length, 1, `one rule sizes a join screen's buttons: ${JSON.stringify(sized.map(r => r[0]))}`);
  assert.equal(sized[0]![0], '.joinscreen:where(:not(.queuescreen)) button',
    'it skips .queuescreen, inside :where() so it stays (0,1,1) for the screens it still sizes');
});

test('1001 §2 nothing else sizes every button under .joinscreen', () => {
  for (const [sel, body] of rules) {
    for (const part of sel.split(',').map(s => s.trim())) {
      if (!/^\.joinscreen\S*\s+button$/.test(part)) continue;
      assert.ok(part.includes(':not(.queuescreen)') || !/font-size|padding/.test(body), `${part} { ${body.trim()} } sizes the queue's buttons again`);
    }
  }
});

test('1001 §3 the queue\'s own button rules are there to take over', () => {
  const body = (sel: string): string => rules.find(([s]) => s === sel)?.[1] ?? '';
  assert.match(body('.qgo'), /font-size:\s*var\(--text-14\)/);
  assert.match(body('.qdecline'), /font-size:\s*var\(--text-12\)/);
  assert.match(body('.qopt'), /padding:/);
  assert.match(body('.qaccept'), /font-size:\s*var\(--text-16\)/);
});
