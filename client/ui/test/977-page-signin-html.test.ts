/* 977 — THE SIGN-IN SCREEN AND THE IDENTITY BAR, DRAWN WITHOUT A PAGE
 * (design-system round, 2026-11-03).
 *
 * Their markup left ui/account.ts for ui/pages/signin.ts: account.ts keeps the
 * state and hands it over; signinHtml / identityBarHtml draw it. No DOM here.
 *
 * §1 log in and create: the heading, the button, and the no-reset warning on
 *    the CREATE screen only
 * §2 every data-btn the account handler routes on, and busy disables the submit
 * §3 the message line and the username are escaped
 * §4 the identity bar: resolving says "Signing in…", signed out offers a way
 *    in, signed in is one button with the record
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identityBarHtml, signinHtml, type IdentityBarView, type SigninView } from '../pages/signin.ts';

const view = (over: Partial<SigninView> = {}): SigninView => ({ mode: 'login', username: '', msg: '', busy: false, chrome: { signedIn: false, alerts: 0 }, ...over });
const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);

test('977 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  // the app frame (pages/frame.ts, 2026-11-04): its page class last, what report.ts reads (pageOf → "acct")
  assert.match(signinHtml(view()), /^<div class="ui-app-shell ui-app-shell--contained apppage acctscreen">/);
});

test('977 §1 log in and create, and the warning only where an account is made', () => {
  const login = signinHtml(view());
  assert.match(login, /<h1 class="frametitle">Log in<\/h1>/, 'the heading is the toolbar\'s title');
  assert.match(login, /data-btn="acct-submit" >\s*Log in<\/button>/);
  assert.match(login, /autocomplete="current-password"/);
  assert.doesNotMatch(login, /nopwreset/, 'no warning on the log-in screen');
  const create = signinHtml(view({ mode: 'register' }));
  assert.match(create, /<h1 class="frametitle">Create an account<\/h1>/);
  assert.match(create, /<p class="pwwarn" data-warn="nopwreset"><b>DO NOT FORGET YOUR PASSWORD\.\s+THERE IS NO PASSWORD RESET\.<\/b>/);
  assert.match(create, /autocomplete="new-password"/);
});

test('977 §2 every data-btn, and a sign-in in flight disables the submit', () => {
  // Back is the frame's back button (first, in the toolbar), still acct-close
  assert.deepEqual(btns(signinHtml(view())), ['acct-close', 'acct-submit', 'acct-toggle-mode']);
  const busy = signinHtml(view({ busy: true }));
  assert.match(busy, /data-btn="acct-submit" disabled>\s*working…/);
});

test('977 §3 the message line and the username are escaped', () => {
  const html = signinHtml(view({ msg: 'no such <user>', username: 'a"b' }));
  assert.match(html, /<p class="deckmsg">no such &lt;user&gt;<\/p>/);
  assert.match(html, /value="a&quot;b"/);
  assert.doesNotMatch(signinHtml(view()), /deckmsg/, 'no message, no line');
});

test('977 §4 the identity bar: resolving, signed out, signed in', () => {
  const me: NonNullable<IdentityBarView['me']> = { username: 'Ann<', favoriteElement: 'water', games: 5, wins: 3, losses: 2, unresolved: 1, streak: 2 };
  assert.match(identityBarHtml({ resolving: true, me: null }), /aria-busy="true"><span class="accthint">Signing in…/);
  const out = identityBarHtml({ resolving: false, me: null });
  assert.deepEqual(btns(out), ['acct-open-auth']);
  assert.match(out, /Playing signed out/);
  const signed = identityBarHtml({ resolving: true, me });
  assert.match(signed, /^<button class="acctbar in" data-btn="acct-open-profile"/, 'a known account wins over resolving');
  assert.match(signed, /<span class="acctname">Ann&lt;<\/span><span class="acctel icon water"/);
  assert.match(signed, /3W–2L · 1 unrecorded · 🔥2/);
  assert.match(identityBarHtml({ resolving: false, me: { ...me, games: 0, streak: 0 } }), /no games yet<\/span>/);
});
