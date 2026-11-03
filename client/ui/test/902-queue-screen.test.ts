/* The matchmaking screen: one card, and a tick that does not rebuild it.
 *
 * Three things a browser showed on 2026-11-02 (agent B, phase 0):
 *
 *  1. The screen's root kept `.joinscreen`'s frame (420px max, border, panel
 *     background) and put a 520px bordered `.queuepanel` inside it, so the
 *     inner card stuck ~125px out of the outer one. The root keeps the class —
 *     report.ts reads the page a report was filed from off it (test 287) — but
 *     `.joinscreen.queuescreen` drops the frame.
 *  2. While searching or holding an offer, a 1s interval repainted the whole
 *     screen. The Accept button was a new node every second, and a press that
 *     straddled a tick never became a click. The tick now rewrites the two
 *     counting texts in place (tickInPlace) and repaints only when they are
 *     not on screen.
 *  3. The offer countdown counted the server's `expiresIn` (what was left when
 *     the message was SENT) from the FIRST offer message's arrival, so the
 *     second message (after Accept) took the elapsed time off twice: 7 → 2.
 *     Every offer message re-bases `offerAt`.
 *
 * The renderers are private, so this reads the source, as 283 does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readStyles } from './read-styles.ts';

// the module (socket, tick, clicks) and its page (pages/queue.ts: what it draws),
// read as one — the drawing left ui/queue.ts in the design-system round, 2026-11-03
const src = readFileSync(new URL('../queue.ts', import.meta.url), 'utf8')
  + readFileSync(new URL('../pages/queue.ts', import.meta.url), 'utf8');
const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
const ruleBody = (sel: string): string => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1]! : '';
};

test('the queue screen is one card, not a card in a card', () => {
  assert.match(src, /<div class="joinscreen home queuescreen">\s*<div class="queuepanel">/, 'positive control: the nesting this is about');
  const outer = ruleBody('.joinscreen.queuescreen');
  assert.ok(outer, 'a rule takes .joinscreen\'s frame off the queue screen');
  assert.match(outer, /border\s*:\s*0/);
  assert.match(outer, /background\s*:\s*none/);
  assert.match(outer, /max-width\s*:\s*none/);
  assert.match(ruleBody('.queuescreen .queuepanel'), /border\s*:\s*1px/, 'the panel is the one frame');
});

test('the 1s tick rewrites the counting texts, it does not repaint the screen', () => {
  const tick = src.slice(src.indexOf('function ensureTick'));
  const interval = tick.slice(tick.indexOf('setInterval('), tick.indexOf('}, 1000)'));
  assert.match(interval, /tickInPlace\(/, 'the interval goes through tickInPlace');
  assert.doesNotMatch(interval, /\{\s*if \(open\) deps\?\.rerender\(\);\s*\}/, 'no unconditional repaint');
  for (const attr of ['data-qwait', 'data-qleft']) {
    assert.ok((src.match(new RegExp(attr, 'g')) ?? []).length >= 3, `${attr} is drawn and read`);
  }
  assert.match(src, /class="cta primary qaccept" data-btn="queue-accept">Accept <span class="qcount" data-qleft>/);
});

test('every offer message re-bases the countdown', () => {
  const onMsg = src.slice(src.indexOf('function onMsg'));
  assert.match(onMsg, /\n\s*if \(next\) offerAt = Date\.now\(\);/, 'offerAt is set for every message carrying an offer');
  assert.doesNotMatch(onMsg.slice(0, onMsg.indexOf('offer = next')),
    /if \(next && !offer\) \{[^}]*offerAt = Date\.now\(\)/, 'not only for the first one');
});
