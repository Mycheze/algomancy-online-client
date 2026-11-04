/* The sign-in / create-account screen, and the identity bar that leads to it
 * (the home screen's slot) — DRAWN.
 *
 * Split out of ui/account.ts in the design-system round (2026-11-03) under the
 * page contract (pages/README.md), with one difference from a page: the
 * account's state (the token, the profile, the screen that is open, the
 * sign-in message) stays in ui/account.ts, which nearly every module imports
 * for authHeaders() and currentUser(). So account.ts hands its state to
 * signinView() / identityBarView(), these functions draw it, and account.ts
 * paints #app through paintSignin(). Nothing here imports account.ts except
 * its types, so there is no import cycle.
 *
 * The sign-in screen is drawn in the app frame since 2026-11-04 (one card,
 * the heading in the toolbar, the frame's Back); tests 267 and 905 read its
 * warning and its message line. The buttons stay the page's `.homebtns`. The
 * identity bar is the home's slot and is drawn exactly as it was. */
import { esc } from '../util.ts';
import { ICON_BASE } from '../assets.ts';
import type { Me } from '../account.ts';
import { settingRow } from '../components/index.ts';
import { frameChromeView, frameHtml, paintFrame, type FrameChrome } from './frame.ts';

// ── the identity bar (the home screen's slot) ─────────────────────────

export interface IdentityBarView {
  /** a stored token is being checked and has not answered yet */
  resolving: boolean;
  /** the signed-in account's line, or null when signed out */
  me: { username: string; favoriteElement: string | null; games: number; wins: number; losses: number;
    unresolved: number; streak: number } | null;
}

export function identityBarView(me: Me | null, resolving: boolean): IdentityBarView {
  return {
    resolving,
    me: me && {
      username: me.username, favoriteElement: me.favoriteElement, games: me.profile.games, wins: me.profile.wins,
      losses: me.profile.losses, unresolved: me.profile.unresolved, streak: me.profile.streak,
    },
  };
}

/** the favourite element as its icon (owner, 2026-09-05: "instead of using
 * just text, use the actual element icon") — the same data/icons file the
 * card text draws for a pip; the word stays as the title and the alt */
export const elChip = (el: string | null): string =>
  el ? `<span class="acctel icon ${el}" title="favorite element: ${el}"><img src="${ICON_BASE}${el}.webp" alt="${el}"></span>` : '';

/** The account line that sits above the home screen's buttons.
 *
 * T17/T20 (2026-09-05): signed in, it is ONE box and the whole box is the
 * button that opens the account page — "Playing as" used to sit beside it as
 * a separate label with the same name in it. The logout button that lived
 * here is gone: logging out is on the account page and nowhere else.
 *
 * test/904: a token being checked is drawn as signing in, never as signed out. */
export function identityBarHtml(v: IdentityBarView): string {
  const me = v.me;
  if (!me && v.resolving) {
    // the same box the signed-out bar is, so nothing jumps when it resolves
    return `<div class="acctbar out" aria-busy="true"><span class="accthint">Signing in…</span></div>`;
  }
  if (!me) {
    return `<div class="acctbar out">
      <span class="accthint">Playing signed out — nothing is recorded.</span>
      <button data-btn="acct-open-auth">Log in / Sign up</button>
    </div>`;
  }
  const record = me.games
    ? `${me.wins}W–${me.losses}L${me.unresolved ? ` · ${me.unresolved} unrecorded` : ''}`
    : 'no games yet';
  return `<button class="acctbar in" data-btn="acct-open-profile" title="your profile, stats and achievements">
    <span class="acctwho">Playing as <span class="acctname">${esc(me.username)}</span>${elChip(me.favoriteElement)}</span>
    <span class="acctrec">${record}${me.streak >= 2 ? ` · 🔥${me.streak}` : ''}</span>
  </button>`;
}

// ── the sign-in screen ────────────────────────────────────────────────

export interface SigninView {
  mode: 'login' | 'register';
  /** the username box's starting value (the account last signed in, if any) */
  username: string;
  /** the screen's message line: the server's refusal, or what is missing */
  msg: string;
  /** a sign-in is in flight */
  busy: boolean;
  /** the toolbar's account and bell (pages/frame.ts) */
  chrome: FrameChrome;
}

export function signinView(s: { mode: 'login' | 'register'; me: Me | null; msg: string; busy: boolean }): SigninView {
  return { mode: s.mode, username: s.me?.username ?? '', msg: s.msg, busy: s.busy, chrome: frameChromeView() };
}

/** The screen, in the app frame (pages/frame.ts, 2026-11-04): one card in the
 * middle of the window, as matchmaking's is. The heading is the toolbar's
 * title, and Back is the frame's — `acct-close`, as the old Back button was. */
export function signinHtml(v: SigninView): string {
  // the two screens are one function with one flag: test 267 holds the
  // no-reset warning to the `isRegister` arm
  const isRegister = v.mode === 'register';
  const authMsg = v.msg;
  return frameHtml({
    page: 'acctscreen', title: isRegister ? 'Create an account' : 'Log in',
    back: { dataBtn: 'acct-close', label: 'Back', icon: 'back' },
    chrome: v.chrome,
    mainHtml: `<section class="acctform" aria-label="${isRegister ? 'Create an account' : 'Log in'}">
    <p class="hint">${isRegister
      ? 'A username and a password, nothing else — no email, no recovery.'
      : 'Signed in, every game you play is recorded to your profile.'}</p>
    ${isRegister ? `<p class="pwwarn" data-warn="nopwreset"><b>DO NOT FORGET YOUR PASSWORD.
      THERE IS NO PASSWORD RESET.</b> There is no email address on this account to send one to.
      Write it down.</p>` : ''}
    <div class="acctrows">
    ${settingRow({ label: 'Username', controlHtml: `<input id="a-user" maxlength="20" autocomplete="username"
      spellcheck="false" value="${esc(v.username)}" aria-label="Username">` })}
    ${settingRow({ label: 'Password', controlHtml: `<input id="a-pass" type="password" maxlength="200"
      autocomplete="${isRegister ? 'new-password' : 'current-password'}" aria-label="Password">` })}
    </div>
    ${authMsg ? `<p class="deckmsg">${esc(authMsg)}</p>` : ''}
    <div class="homebtns">
      <button class="primary" data-btn="acct-submit" ${v.busy ? 'disabled' : ''}>
        ${v.busy ? 'working…' : isRegister ? 'Create account' : 'Log in'}</button>
      <button data-btn="acct-toggle-mode">${isRegister
        ? 'I already have an account' : "I'm new here — create an account"}</button>
    </div>
    ${isRegister ? `<p class="hint">Sign up with a name you have played under here and those games
      come with it.</p>` : ''}
  </section>`,
  });
}

/** paint the screen, then wire Enter to submit and put the caret in the box being asked for */
export function paintSignin(app: HTMLElement, v: SigninView): void {
  paintFrame(app, signinHtml(v));
  const submit = (): void => (document.querySelector('[data-btn="acct-submit"]') as HTMLElement | null)?.click();
  for (const id of ['a-user', 'a-pass']) {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if ((e as KeyboardEvent).key === 'Enter') submit();
    });
  }
  // login prefills the username, so the password is the field being asked for
  (document.getElementById(v.mode === 'register' ? 'a-user' : 'a-pass') as HTMLInputElement | null)?.focus();
}
