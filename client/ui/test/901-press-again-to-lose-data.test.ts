/* The two buttons that throw a challenge run away ask twice.
 *
 * Owner, 2026-11-02, on which one-click destructive actions should confirm:
 * "Data-losing only" — Give up on a challenge run (the run is deleted) and ✕
 * on a kept, unsubmitted run. Both use the league's press-again pattern
 * (league.ts `arming`, `button.danger`, "Press again to …"): the first press
 * arms and relabels the button, the second acts, any other button of the same
 * page disarms. Remove friend, make/revoke admin, a league result override
 * and log out stay one click, by the same decision.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readStyles } from './read-styles.ts';

const read = (f: string): string => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const caseBody = (src: string, label: string): string => {
  const i = src.indexOf(label);
  assert.ok(i >= 0, `positive control: ${label}`);
  const next = src.indexOf('\n    case ', i + label.length);
  return src.slice(i, next < 0 ? undefined : next);
};

test('Give up arms first, and only the second press drops the run', () => {
  const src = read('challengerun.ts');
  const body = caseBody(src, "case 'giveup':");
  const arm = body.indexOf("if (arming !== 'giveup') { arming = 'giveup';");
  const act = body.indexOf('saveRun(null)');
  assert.ok(arm > 0 && act > arm, 'arm, return, then act');
  assert.match(body.slice(arm, act), /return; \}/);
  // the meter's markup moved to pages/challengerun.ts in the design-system round (2026-11-03)
  assert.match(read('pages/challengerun.ts'), /<button class="danger" data-chal="giveup">Press again to give up<\/button>/);
  assert.match(src, /armed: arming === 'giveup'/, 'the meter is armed by the run module');
  assert.match(src, /if \(b !== 'giveup' && arming\) \{ arming = null;/, 'any other run button disarms');
});

test('dropping a kept run arms first, and only the second press forgets it', () => {
  const src = read('challenge.ts');
  const body = caseBody(src, "case 'ch-forget':");
  const arm = body.indexOf('if (arming !== key) { arming = key;');
  const act = body.indexOf('forgetDone(');
  assert.ok(arm > 0 && act > arm, 'arm, return, then act');
  // the markup moved to pages/challenge.ts in the design-system round (2026-11-03)
  assert.match(read('pages/challenge.ts'), /<button class="danger" data-btn="ch-forget" data-at="\$\{r\.at\}">Press again to drop this run<\/button>/);
  assert.match(src, /if \(b !== 'ch-forget'\) arming = null;/, 'any other ch- button disarms');
});

test('the armed button is drawn the way the league draws it', () => {
  const css = readStyles();
  const rule = css.match(/([^{}]*\.lgpage button\.danger[^{}]*)\{[^}]*var\(--danger\)/);
  assert.ok(rule, 'positive control: the league rule');
  for (const sel of ['.chmeter button.danger', '.chkeptrow button.danger']) assert.ok(rule![1]!.includes(sel), `${sel} shares it`);
});
