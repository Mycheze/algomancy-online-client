/**
 * The rules review page: its wiring, asserted over the SOURCE (the 301/336
 * style). ui/crreview.ts and ui/crlayer.ts paint strings into the page and no
 * fake DOM here reaches them, so these are the claims a grep could make false
 * that nothing else would notice:
 *
 *   §1 main.ts registers the page four ways (import, init, screen, buttons)
 *      and the layer once; the page is dispatched RIGHT AFTER the account
 *      screen, because "Sign in to comment" goes through that screen and has
 *      to come straight back; and a `?crreview` link is not a game.
 *   §2 every `cr-` button the page or the layer draws has a case, and every
 *      case is drawn — a button with no case falls through to a board repaint.
 *   §3 the layer takes its own clicks in the capture phase and stops them, and
 *      never uses the board's modal class (269 counts it across ui/).
 *   §4 comment text is TEXT: every body, quote and name that reaches a
 *      template goes through esc(), and the highlights are made with DOM
 *      calls, never by splicing strings into the markup.
 *   §5 the page never decides who may do what: edit and resolve buttons are
 *      drawn from the server's own booleans on each comment.
 *   §6 the URL is written with replaceState only.
 *   §7 the way in: one profile button for an owner or judge BADGE (not the
 *      admin flag), a deep link for everyone else, and a sign-in that comes
 *      back to the page.
 *   §8 an owner's answer is not an open thread: answering a question must
 *      not raise "Comments n open", and every open count goes through isOpen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageOf } from '../report.ts';

const UI = dirname(dirname(fileURLToPath(import.meta.url)));
const src = (f: string): string => readFileSync(join(UI, f), 'utf8');
const main = src('main.ts');
const page = src('crreview.ts');
const layer = src('crlayer.ts');
const account = src('account.ts');

/** comments out — a comment that names a thing is documentation, not code */
const code = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('§1 main.ts imports, initialises and dispatches the page, right after the account screen', () => {
  const m = code(main);
  assert.match(m, /import \* as crr from '\.\/crreview\.ts';/);
  assert.match(m, /import \{ installCrLayer \} from '\.\/crlayer\.ts';/);
  assert.match(m, /crr\.initCrReview\(\{ app: \$app, rerender: \(\) => \{ if \(!inGame\) renderHome\(\); \} \}\);/,
    'initialised at boot like the other pages, so ?crreview opens it');
  assert.ok(m.indexOf('installCrLayer();') > m.indexOf('installReport(reportOpenChanged);'),
    'the layer is mounted after the report layer');
  assert.match(m, /if \(acct\.screen\(\)\) \{ acct\.renderScreen\(\); return; \}\s*if \(crr\.screen\(\)\) \{ crr\.renderScreen\(\); return; \}/,
    'the page is dispatched IMMEDIATELY after the account screen: anything between could paint over it '
    + 'while it is open, and anything before it would be painted over by a stale page');
  assert.match(m, /if \(crr\.handleButton\(btn\)\) return;/, 'offered every click');
  assert.match(m, /'nav-crreview'\) \{ acct\.leaveScreen\(\); crr\.openReview\(\); return; \}/, 'the profile button opens it');
  const inGame = /const inGame = [^;]*;/.exec(m)?.[0] ?? '';
  assert.ok(inGame.includes('replay'), 'positive control: the inGame definition was found');
  assert.ok(!/crreview/.test(inGame), 'a review link is not a game: the board must never paint over it');
});

/** every `cr-` button drawn, as markup or as a dataset assignment */
function drawn(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(/data-btn="(cr-[\w-]+)"/g)) out.add(m[1]!);
  for (const m of s.matchAll(/dataset\['btn'\] = '(cr-[\w-]+)'/g)) out.add(m[1]!);
  return out;
}

test('§2 every cr- button the page or the layer draws has a case, and every case is drawn', () => {
  const buttons = new Set([...drawn(code(page)), ...drawn(code(layer))]);
  const fn = page.slice(page.indexOf('export function handleButton'));
  const cases = new Set([...fn.matchAll(/case '(cr-[\w-]+)'/g)].map(m => m[1]!));
  assert.ok(buttons.size >= 15 && cases.size >= 15, `positive control: ${buttons.size} buttons, ${cases.size} cases`);
  assert.deepEqual([...buttons].filter(b => !cases.has(b)).sort(), [], 'drawn with no case: the click would fall through');
  assert.deepEqual([...cases].filter(c => !buttons.has(c)).sort(), [], 'a case nothing draws');
  assert.match(fn, /if \(!b\.startsWith\('cr-'\)\) return false;/, 'it claims its own prefix and nothing else');
});

test('§2b under 1180px the contents drawer covers the toolbar, so it draws its own close button', () => {
  const p = code(page);
  assert.match(p, /<button class="crtocclose" data-btn="cr-toc">/, 'the drawer carries a cr-toc button');
  assert.match(p, /function tocHtml\(\): string \{\s*const entries = tocEntriesHtml\(\);/, 'on every paint of the rail');
  const css = src('style.css');
  assert.match(css, /\.crtoc \.crtocclose \{ display: none; \}/, 'hidden where the rail is a column');
  assert.match(css, /@media \(max-width: 1179px\) \{[^@]*\.crtoc \.crtocclose \{ display: block;/, 'shown where it is a drawer');
});

test('§3 the layer takes its own clicks in capture and stops them, with its own scrim', () => {
  const l = code(layer);
  assert.match(l, /document\.addEventListener\('click', [\s\S]*?\}, \{ capture: true \}\);/);
  assert.match(l, /document\.addEventListener\('keydown', [\s\S]*?\}, \{ capture: true \}\);/);
  assert.ok((l.match(/stopPropagation\(\)/g) ?? []).length >= 3, 'its clicks, its scrim and its Escape stop where they land');
  assert.match(l, /closest\?\.\('\[data-crl\]'\)/, 'its own attribute, never data-btn, for its own controls');
  assert.match(l, /class="crscrim"/);
  for (const f of ['crlayer.ts', 'crreview.ts', 'cranchor.ts', 'crdom.ts']) {
    assert.ok(!src(f).includes('class="overlay'), `${f} mentions the board modal class, even in a comment: 269 counts it`);
  }
  // every text box of the page is in the layer, so no #app repaint can eat a draft
  assert.ok(!/<textarea|<input/.test(code(page)), 'the page itself holds no inputs');
  assert.match(code(layer), /<textarea id="cr-draft"/);
});

/**
 * Every `.body`, `.quote` or `.name` read inside a `${ … }` must be inside an
 * esc( call opened in the same interpolation. Line by line: each of these
 * templates keeps an interpolation on one line.
 */
function unescaped(s: string): { bad: string[]; seen: number } {
  const bad: string[] = [];
  let seen = 0;
  code(s).split('\n').forEach((line, n) => {
    for (const m of line.matchAll(/\.(body|quote|name)\b/g)) {
      const pre = line.slice(0, m.index);
      const j = pre.lastIndexOf('${');
      if (j < 0) continue;
      const inner = pre.slice(j + 2);
      if ((inner.match(/\{/g) ?? []).length < (inner.match(/\}/g) ?? []).length) continue;
      seen++;
      const k = pre.lastIndexOf('esc(');
      const open = k > j ? 1 + (pre.slice(k + 4).match(/\(/g) ?? []).length - (pre.slice(k + 4).match(/\)/g) ?? []).length : 0;
      if (open <= 0) bad.push(`${n + 1}: ${line.trim()}`);
    }
  });
  return { bad, seen };
}

test('§4 every comment body, quote and name reaches the markup through esc()', () => {
  const p = unescaped(page);
  const l = unescaped(layer);
  assert.ok(p.seen >= 8, `positive control: ${p.seen} interpolations of a body, quote or name in crreview.ts`);
  assert.ok(l.seen >= 1, `positive control: ${l.seen} in crlayer.ts`);
  assert.deepEqual([...p.bad, ...l.bad], [], 'interpolated without esc()');
  // the highlights split text nodes: no string of comment text is ever spliced into HTML
  const dom = code(src('crdom.ts'));
  assert.match(dom, /splitText\(/);
  assert.ok(!/innerHTML/.test(dom.replace(/t\.innerHTML = html;/, '')),
    'crdom.ts writes no innerHTML except parsing render\'s own fragment into an inert template');
  assert.match(dom, /createElement\('template'\)/);
});

test('§5 the page draws edit and resolve from the server, and reads no local claim of who you are', () => {
  const p = code(page);
  assert.match(p, /c\.canEdit && !c\.deleted/, 'Edit and Delete come from the comment\'s canEdit');
  assert.match(p, /r\.canResolve && !r\.deleted/, 'Resolve and Reopen come from the comment\'s canResolve');
  assert.ok(!/currentUser\(\)/.test(p), 'the page never asks the local profile who it is');
  const admins = [...p.matchAll(/(\w+)\??\.admin\b/g)].map(m => m[1]);
  assert.ok(admins.length >= 2, 'positive control: the admin-only controls were found');
  assert.deepEqual([...new Set(admins)], ['you'], 'admin-only controls are drawn from the server\'s own `you`, nothing else');
  assert.ok(!/localStorage|sessionStorage/.test(p + code(layer)), 'no browser storage (267 would need a line for it)');
});

test('§5b the admin journal goes out with the token: a bare link would carry none and the server 404s it', () => {
  const p = code(page);
  // the server reads the bearer header only (api-util tokenOf), so an <a href>
  // to the journal 404s for the admin too: found driving the page, 2026-10-10
  assert.ok(!/a\('comments', 'jsonl'\)|fmt=jsonl[^']*" download/.test(p), 'no plain link to the jsonl');
  assert.match(p, /data-btn="cr-dljsonl"/, 'a button draws it');
  assert.match(p, /fetch\('\/api\/cr\/download\?part=comments&fmt=jsonl', \{ headers: acct\.authHeaders\(false\) \}\)/,
    'and the button fetches it with the account\'s headers');
});

test('§6 the URL is written with replaceState, never pushState', () => {
  assert.match(code(page), /history\.replaceState\(/);
  assert.ok(!/pushState/.test(page + layer));
});

test('§7 the way in: a profile button for an owner or judge badge, and a sign-in that comes back', () => {
  const a = code(account);
  const btns = a.match(/[^\n]*data-btn="nav-crreview"[^\n]*/g) ?? [];
  assert.equal(btns.length, 1, 'one Rules review button, on the profile');
  // run the line's own condition over four profiles the server could send
  const cond = /\$\{([^?]*(?:\?\.[^?]*)*)\? '<button data-btn="nav-crreview"/.exec(btns[0]!)?.[1];
  assert.ok(cond && /\bme\b/.test(cond), `positive control: the condition was found (${cond})`);
  const drawnFor = new Function('me', `return !!(${cond});`) as (me: unknown) => boolean;
  assert.equal(drawnFor({ admin: false, badge: null }), false, 'a plain account: no button');
  assert.equal(drawnFor({ admin: true, badge: null }), false, 'the admin flag alone is not a badge: no button');
  assert.equal(drawnFor({ admin: true }), false, 'an admin with no badge field at all: no button');
  assert.equal(drawnFor({ admin: false, badge: { since: '2026-10-01' } }), false, 'a badge record with neither mark: no button');
  assert.equal(drawnFor({ admin: false, badge: { judge: 2, since: '2026-10-01' } }), true, 'a judge badge draws it');
  assert.equal(drawnFor({ admin: false, badge: { owner: true, since: '2026-10-01' } }), true, 'an owner badge draws it');
  assert.ok(!/\badmin\b/.test(cond!), 'the admin flag plays no part in it');
  assert.ok(!/nav-crreview/.test(code(['league.ts', 'lobby.ts', 'legal.ts', 'report.ts', 'admin.ts'].map(src).join('\n'))),
    'no other page offers it');
  assert.match(a, /export function signInThenReturn\(\): void \{/);
  assert.match(a, /if \(returnAfterAuth\) \{ returnAfterAuth = false; view = null; rerenderHost\(\); return; \}/,
    'a sign-in from the page returns to the page, not to the profile');
  assert.match(code(page), /acct\.signInThenReturn\(\)/);
  // the deep link is read at boot
  assert.match(code(page), /q\.get\('crreview'\)/);
  // and a report filed from the page says where it came from
  assert.match(page, /app\.innerHTML = `<div class="crpage">/);
  assert.equal(pageOf('<div class="crpage"><div class="crbar"></div></div>'), 'cr');
});

test('§8 an owner\'s answer is not an open thread, and every open count goes through isOpen', () => {
  const p = code(page);
  const m = /const isOpen = \(th: Thread\): boolean => ([^;]+);/.exec(p);
  assert.ok(m, 'isOpen is one arrow expression');
  // run the page's own predicate (it has no TS syntax past the signature)
  const isOpen = new Function('th', `return ${m![1]};`) as (th: unknown) => boolean;
  const th = (root: Record<string, unknown>): unknown => ({ root: { ...root }, replies: [] });
  assert.equal(isOpen(th({})), true, 'positive control: a plain comment is open');
  assert.equal(isOpen(th({ kind: 'answer', reading: 'A' })), false, 'an answer settles a question; it is not open');
  assert.equal(isOpen(th({ resolved: { by: 'x', at: '' } })), false);
  assert.equal(isOpen(th({ deleted: true })), false);
  // the tab's count, the rail's counts and the ＋ counts all read it
  assert.match(p, /const n = threads\(\)\.filter\(isOpen\)\.length;/);
  assert.ok(!/root\.resolved && !th\.root\.deleted(?! && th\.root\.kind)/.test(p), 'no second, answer-blind copy of the test');
});
