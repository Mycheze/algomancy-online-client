/* 1382 · A JUDGE THAT DID NOT ANSWER IS DRAWN AS AN ERROR, NOT AS AN ANSWER
 * (BL-10, the visual polish pass, 2026-11-15).
 *
 * Inventory 04 §L.7: "judge failures and lesson-judge failures look exactly
 * like answers". Both judge boxes — the table's (⚖ on the toolbar, main.ts
 * judgeOverlayHtml) and the lesson's (lessonlayer.ts windowHtml) — drew "could
 * not reach the judge: TypeError…", the daily limit, "busy" and "sign in" in
 * the same grey answer box as a real ruling. The table's log already knew
 * (`failed`, which keeps the refusal out of the conversation it sends back,
 * CT-470); nothing drew it. The lesson's log did not know at all.
 *
 *   §1 the lesson's box: a failed turn is the error tone, boxed (red, on the
 *      danger tint, role="alert"), and not an answer box; a real one is
 *      still an answer box
 *   §2 the lesson's host and its own catch mark a failure: the guest-sign-in
 *      miss, a reply that is not ok, an unreachable judge
 *   §3 the table's box draws `failed` with the same error tone
 *
 * Reasoned, not looked at (no browser on the box).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../../engine/src/index.ts';
import { windowHtml } from '../lessonlayer.ts';
import { GAME_LESSONS } from '../lessons.ts';

const src = (f: string): string => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8');
const MAIN = src('main.ts');
const LAYER = src('lessonlayer.ts');
const model = (judge: { q: string; a: string; cards: string[]; failed?: boolean }[]) =>
  ({ lesson: GAME_LESSONS[0]!, page: 0, ctx: null, judge, judgeBusy: false, judgeDraft: '' });

const ERROR_BOX = /<div class="ui-status ui-status--error ui-status--boxed judgefail" role="alert">/;

test('§1 the lesson box draws a failed judge turn as an error, and an answer as an answer', () => {
  const failed = windowHtml(model([{ q: 'Can I attack?', a: 'could not reach the judge: TypeError: Failed to fetch', cards: [], failed: true }]));
  assert.match(failed, ERROR_BOX);
  assert.match(failed, /could not reach the judge: TypeError: Failed to fetch<\/div>/);
  assert.doesNotMatch(failed, /class="lja"/, 'a failure is not drawn in the answer box');
  const ok = windowHtml(model([{ q: 'Can I attack?', a: 'Yes, in your battle phase.', cards: [] }]));
  assert.match(ok, /class="lja"/);
  assert.doesNotMatch(ok, /ui-status--error/);
});

test('§2 every way the lesson judge can fail is marked failed', () => {
  assert.match(MAIN, /return \{ answer: 'The judge is not available right now — try again in a moment\.', cards: \[\], failed: true \};/,
    'the guest sign-in miss');
  assert.match(MAIN, /return \{ answer: r\.answer, cards: r\.cards\.map\(c => c\.title\), \.\.\.\(r\.ok \? \{\} : \{ failed: true \}\) \};/,
    'a reply that is not ok (busy, the daily limit)');
  assert.match(LAYER, /log\.push\(\{ q, a: r\.answer, cards: r\.cards, \.\.\.\(r\.failed \? \{ failed: true \} : \{\}\) \}\)/,
    'the layer carries the host\'s flag into its log');
  assert.match(LAYER, /a: `could not reach the judge: \$\{err\}`, cards: \[\], failed: true \}/, 'an unreachable judge');
});

test('§3 the table judge box draws a failed exchange with the error tone', () => {
  const box = MAIN.slice(MAIN.indexOf('function judgeOverlayHtml'), MAIN.indexOf('function judgeOverlayHtml') + 1500);
  assert.match(box, /judgeLog\.map\(e => e\.failed \? `[\s\S]*?statusMessage\(\{ tone: 'error', boxed: true, className: 'judgefail', text: e\.a \}\)/);
});
