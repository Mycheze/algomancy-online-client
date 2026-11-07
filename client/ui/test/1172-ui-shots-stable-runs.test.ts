/* 1172 — TWO UI-SHOTS RUNS OF ONE BUILD COMPARE CLEAN (BL-64, 2026-11-07).
 *
 * Every stream of the design-system round explained away the same false
 * differences between two runs of one build. Three of them were the tool's,
 * not the build's, and client/server/e2e/ui-shots-stable.mjs says how each
 * is now held still:
 *
 * §1 the origin: share and invite links print location.origin, so a run on
 *    another port differed in every picture that shows one. Chrome browses one
 *    fixed origin (no port in it) mapped to the server's port, treated as
 *    secure like 127.0.0.1; every state runs on it, and a run whose mapping
 *    did not take stops at once rather than failing every state
 * §2 window focus: a focused search box drew its accent border only when the
 *    headless window had focus. Focus is emulated, so it always has
 * §3 "Loading…": a shot under load caught a document not yet drawn. The page
 *    is polled until no visible "Loading…" line is left (the page-side source
 *    runs here on a made-up DOM), and one left after the wait is a failure in
 *    the manifest; a state's `check` is polled too, not tested once
 * §4 the class: every "Loading…" placeholder the client draws is one the
 *    wait recognises — a new one spelled "Loading..." would be shot half-drawn
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { FOCUS_EMULATION, LOADING_RE, SHOTS_HOST, SHOTS_ORIGIN, originFlags, stillLoadingJs } from '../../server/e2e/ui-shots-stable.mjs';

const SHOTS = readFileSync(new URL('../../server/e2e/ui-shots.mjs', import.meta.url), 'utf8');
/** the body of `async function <name>(` up to the next top-level function */
const fn = (name: string): string => {
  const at = SHOTS.indexOf(`async function ${name}(`);
  assert.ok(at >= 0, `ui-shots.mjs has no ${name}()`);
  const end = SHOTS.indexOf('\n}\n', at);
  return SHOTS.slice(at, end);
};

test('1172 §1 one page origin on every port: the host maps to the port, the origin carries none', () => {
  assert.equal(new URL(SHOTS_ORIGIN).port, '', 'the origin has no port in it');
  assert.equal(new URL(SHOTS_ORIGIN).hostname, SHOTS_HOST);
  const [a, b] = [originFlags(5182), originFlags(5183)];
  assert.ok(a.includes(`--host-resolver-rules=MAP ${SHOTS_HOST} 127.0.0.1:5182`), a.join(' '));
  assert.ok(b.includes(`--host-resolver-rules=MAP ${SHOTS_HOST} 127.0.0.1:5183`), b.join(' '));
  // secure like 127.0.0.1 is: the clipboard and crypto.randomUUID stay on
  assert.ok(a.includes(`--unsafely-treat-insecure-origin-as-secure=${SHOTS_ORIGIN}`));
  assert.deepEqual(a.filter(f => !/5182/.test(f)), b.filter(f => !/5183/.test(f)), 'only the port differs between two runs\' flags');
});

test('1172 §1 ui-shots browses that origin, and stops when it does not reach the server', () => {
  assert.match(SHOTS, /\.\.\.\(port \? originFlags\(port\) : \[\]\)/, 'launch() does not pass the mapping to Chrome');
  const main = fn('main');
  assert.match(main, /const origin = portOrigin \? server\.base : SHOTS_ORIGIN;/);
  assert.match(main, /runState\(P, origin, fx, s\)/, 'the states run on the port\'s own origin');
  assert.doesNotMatch(main, /runState\(P, server\.base/);
  assert.match(main, /port: portOrigin \? null : port/, 'the Chrome that is restarted mid-run maps the port too');
  assert.match(main, /await reachable\(P, origin\);/);
  assert.match(fn('reachable'), /if \(at !== origin\) \{\s*throw new Error/);
  // the server's socket check compares Origin's host with Host's: both are SHOTS_HOST
  const server = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8');
  assert.match(server, /return from === own \|\| \(pub !== null && from === pub\);/, 'the socket origin check changed: does SHOTS_ORIGIN still pass it?');
});

test('1172 §2 the window always has focus', () => {
  assert.deepEqual(FOCUS_EMULATION, ['Emulation.setFocusEmulationEnabled', { enabled: true }]);
  const launch = SHOTS.slice(SHOTS.indexOf('export async function launch('), SHOTS.indexOf('  const P = {'));
  assert.match(launch, /await send\(\.\.\.FOCUS_EMULATION\);/, 'launch() does not turn focus emulation on before the first page');
});

interface Fake { text: string; kids?: Fake[]; hidden?: boolean }
/** run the page-side check over made-up elements under body */
function loadingIn(tree: Fake[]): string[] {
  const all: unknown[] = [];
  const build = (f: Fake): unknown => {
    const kids = (f.kids ?? []).map(build);
    const el = {
      children: kids, textContent: f.text,
      getBoundingClientRect: () => (f.hidden ? { width: 0, height: 0 } : { width: 100, height: 20 }),
    };
    all.push(el);
    return el;
  };
  tree.forEach(build);
  return Array.from(runInNewContext(stillLoadingJs(), { document: { querySelectorAll: () => all } }) as string[]);
}

test('1172 §3 the page is waited on while a "Loading…" line shows', () => {
  assert.deepEqual(loadingIn([{ text: 'Loading the document…' }]), ['Loading the document…'], 'the rules review page, half-drawn');
  assert.deepEqual(loadingIn([{ text: '  Loading…\n' }]), ['Loading…'], 'trimmed');
  assert.deepEqual(loadingIn([{ text: 'Loading the rules…', hidden: true }]), [], 'not on screen: not waited on');
  assert.deepEqual(loadingIn([{ text: 'Loading your decks…', kids: [{ text: 'x' }] }]), [], 'only the line itself, not a box around it');
  assert.deepEqual(loadingIn([{ text: 'Loading screens can be skipped by pressing Escape at any time when the board is drawn…' }]), [], 'prose, not a placeholder');
  assert.deepEqual(loadingIn([{ text: 'Ember Rush' }, { text: '30 cards' }]), [], 'positive control: a drawn page');

  const run = fn('runState');
  const wait = run.indexOf('await P.untilLoaded()');
  assert.ok(wait > 0, 'runState does not wait for the page to finish loading');
  assert.ok(wait < run.indexOf('if (s.check)') && wait < run.indexOf('if (s.css)'), 'the wait comes before the masks and the check');
  assert.match(run, /return loading\.length \? `still loading/, 'a page still loading is not a failure in the manifest');
  assert.match(run, /await P\.until\(`!!document\.querySelector\(\$\{JSON\.stringify\(s\.check\)\}\)`\)/, 'the check is tested once, not waited for');
});

test('1172 §4 every "Loading…" placeholder the client draws is one the wait knows', () => {
  const root = new URL('../', import.meta.url);
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter(f => f.endsWith('.ts') && !/(^|\/)(test|node_modules|storybook)\//.test(f) && !f.endsWith('.d.ts'));
  const found: string[] = [];
  for (const f of files) {
    const src = readFileSync(new URL(f, root), 'utf8');
    for (const m of src.matchAll(/[>'"`]((?:Loading|Fetching|Please wait)[^<'"`\n]*)/g)) found.push(`${f}: ${m[1]}`);
  }
  assert.ok(found.length >= 5, `non-vacuous: ${found.length} placeholders`);
  const missed = found.filter(x => !LOADING_RE.test(x.slice(x.indexOf(': ') + 2).trim()));
  assert.deepEqual(missed, [], 'a placeholder the wait would not recognise: spell it "Loading…" (one ellipsis character) or widen LOADING_RE');
});
