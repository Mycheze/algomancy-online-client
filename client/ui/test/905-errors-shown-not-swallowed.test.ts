/* Errors are shown, not swallowed and not dressed up as answers.
 *
 * Three places on the account and admin screens lost a failure (found
 * 2026-11-02, each reproduced in a browser):
 *
 *  - Link Discord: the reason went into `authMsg`, which only the SIGN-IN
 *    screen draws, so on the profile the button simply did nothing. It has its
 *    own `linkMsg` now, drawn on the Connections card; a network failure
 *    (post() throws) is caught and says so.
 *  - the Ladder tab: a failed /api/players built an EMPTY ladder, which reads
 *    "nobody has played 5 rated games yet". It is marked `failed` now and the
 *    tab says it could not load, with a Try again.
 *  - the admin page: ANY non-200 set `allowed = false`, so a 500 (or the
 *    proxy's 502 during a restart) blanked the page to "this account is not an
 *    admin". Only 404 — the server's deliberate refusal — means that now.
 *  - the scenario runner (tester tool): "NOT recorded — <why>" was drawn in
 *    the success green (.scnstatus is var(--glow)), so a verdict the server
 *    refused looked exactly like one it kept. A failure carries `.bad` now,
 *    drawn in var(--danger).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readStyles } from './read-styles.ts';

const read = (f: string): string => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const src = read('account.ts');
// the screens' markup is ui/pages/ since the design-system round (2026-11-03)
const profile = read('pages/profile.ts');
const signin = read('pages/signin.ts');
const between = (from: string, to: string): string => {
  const i = src.indexOf(from);
  assert.ok(i >= 0, `positive control: ${from}`);
  return src.slice(i, src.indexOf(to, i + from.length));
};
const fn = (text: string, head: string): string => {
  const i = text.indexOf(head);
  assert.ok(i >= 0, `positive control: ${head}`);
  return text.slice(i, text.indexOf('\n}\n', i));
};

test('the Link Discord handler never writes the sign-in screen\'s message', () => {
  const h = between("case 'acct-discord-link':", "case 'acct-discord-unlink':");
  assert.doesNotMatch(h, /authMsg\s*=/, 'authMsg is drawn only by renderAuth');
  assert.match(h, /linkMsg = body\.error/);
  assert.match(h, /catch \{ linkMsg = 'could not reach the server'; \}/, 'a network failure is said too');
});

test('the Connections card draws linkMsg', () => {
  const at = profile.indexOf('function connectionsHtml');
  assert.ok(at >= 0, 'positive control: connectionsHtml');
  const card = profile.slice(at, profile.indexOf('\n}\n', at));
  assert.match(card, /const linkMsg = c\.linkMsg;/, 'the message the view carries');
  assert.match(card, /\$\{linkMsg \? `<p class="deckmsg">\$\{esc\(linkMsg\)\}<\/p>` : ''\}/);
});

test('authMsg is still drawn only by the sign-in screen (why the old write was invisible)', () => {
  // account.ts hands authMsg to the sign-in page alone; only that page draws a message from it
  assert.match(between('function renderAuth', '\n}\n'), /signinView\(\{ mode: authMode, me, msg: authMsg, busy \}\)/);
  assert.doesNotMatch(between('function renderProfile', '\n}\n'), /authMsg/, 'the profile is never handed it');
  assert.doesNotMatch(profile, /authMsg|v\.msg\b/, 'and the profile page draws no sign-in message');
  assert.equal([...signin.matchAll(/\$\{authMsg \?/g)].length, 1, 'the sign-in page draws it once');
});

test('the ladder: a failed load is marked, and the tab says so', () => {
  const load = fn(src, 'async function loadLadder');
  assert.match(load, /if \(!res\.ok\) throw/, 'a non-200 is a failure, not an empty body');
  assert.match(load, /failed: true/);
  const tab = fn(profile, 'function ladderTab');
  assert.ok(tab.indexOf('if (ladder.failed)') >= 0 && tab.indexOf('if (ladder.failed)') < tab.indexOf('nobody has played'),
    'the failure is drawn before (instead of) the empty-board sentence');
  assert.match(tab, /Could not load the ladder/);
});

test('admin: only a 404 is the refusal', () => {
  const admin = read('pages/admin.ts');
  for (const head of ['async function get<T>', 'async function post(']) {
    const body = fn(admin, head);
    assert.match(body, /if \(res\.status === 404\) \{ allowed = false; return null; \}/, `${head}: 404 refuses`);
    assert.doesNotMatch(body, /if \(!res\.ok\) \{ allowed = false/, `${head}: any other status must not`);
  }
  assert.match(fn(admin, 'export function adminHtml'), /\$\{v\.faultMsg \?/, 'a fault is drawn on the page');
});

// ── the scenario runner ──

const scn = read('scenario.ts');
const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');

test('every NOT recorded also marks the status bad', () => {
  const fails = [...scn.matchAll(/status = `NOT recorded[^\n]*/g)].map(m => m[0]);
  assert.ok(fails.length >= 2, `positive control: ${fails.length} failure paths`);
  for (const line of fails) assert.match(line, /statusBad = true/, line);
});

test('the status line carries .bad and .bad is not green', () => {
  assert.match(scn, /class="scnstatus\$\{statusBad \? ' bad' : ''\}"/);
  const bad = css.match(/\.scnstatus\.bad\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(bad, /color:\s*var\(--danger\)/);
});
