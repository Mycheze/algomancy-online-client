/* The sign-in screen and the identity bar (ui/pages/signin.ts), from made-up
 * views. The bar is the home screen's slot; it is shown here on its own. */
import { identityBarHtml, type IdentityBarView, signinHtml, type SigninView } from '../../../ui/pages/signin.ts';

export default {
  title: 'Pages/Sign in',
  render: (args: SigninView) => signinHtml(args),
  args: { mode: 'login', username: '', msg: '', busy: false } satisfies SigninView,
};

export const LogIn = { name: 'Log in' };
export const CreateAccount = { name: 'Create an account', args: { mode: 'register' } };
export const Refused = { args: { username: 'Quillon', msg: 'wrong username or password' } };
export const Working = { args: { username: 'Quillon', busy: true } };

const bar = (v: IdentityBarView): string => `<div style="max-width:720px">${identityBarHtml(v)}</div>`;
const ME = { username: 'Quillon', favoriteElement: 'fire', games: 42, wins: 25, losses: 16, unresolved: 1, streak: 3 };
export const BarSignedOut = { name: 'Identity bar, signed out', render: () => bar({ resolving: false, me: null }) };
export const BarResolving = { name: 'Identity bar, signing in', render: () => bar({ resolving: true, me: null }) };
export const BarSignedIn = { name: 'Identity bar, signed in', render: () => bar({ resolving: false, me: ME }) };
