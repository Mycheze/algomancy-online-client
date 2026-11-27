/* 1508 — the designer flag: who may use the card editor (server/designer.ts).
 *
 * §1 designerFor / designerForToken: designer, admin, both → the account;
 *    neither, no token, a logged-out token, an expired one → undefined
 * §2 setDesigner grants and revokes, independent of admin and badge, and the
 *    flag survives a reload of the accounts file (and is gone from it when revoked)
 * §3 the account's own view carries designer, only when true; nobody's public view does
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import {
  SESSION_IDLE_MS, accountByName, logout, privateView, publicView, register, setAdmin, setBadge, setDesigner,
  useAccountsFile,
} from '../accounts.ts';
import { designerFor, designerForToken } from '../designer.ts';

const dir = mkdtempSync(join(tmpdir(), 'designer-flag-'));
const file = join(dir, 'accounts.json');
const restoreAccounts = useAccountsFile(file);
test.after(() => { restoreAccounts(); rmSync(dir, { recursive: true, force: true }); });

function account(name: string): string {
  const r = register(name, 'correct horse battery');
  assert.ok(r.ok, `could not register ${name}`);
  return r.token;
}
const T = {
  designer: account('Desi'), admin: account('Adam'), both: account('Bea'), neither: account('Nell'),
  gone: account('Gonzo'), stale: account('Stella'),
};
setDesigner(accountByName('Desi')!, true);
setAdmin(accountByName('Adam')!, true);
setDesigner(accountByName('Bea')!, true); setAdmin(accountByName('Bea')!, true);
setDesigner(accountByName('Gonzo')!, true);
setDesigner(accountByName('Stella')!, true);
const bearer = (token: string | null): IncomingMessage =>
  ({ headers: token ? { authorization: `Bearer ${token}` } : {} }) as unknown as IncomingMessage;

test('1508 §1 designer or admin may edit cards; neither, no token and a dead token may not', () => {
  for (const [who, name] of [['designer', 'Desi'], ['admin', 'Adam'], ['both', 'Bea']] as const) {
    const token = T[who];
    assert.equal(designerForToken(token)?.username, name, `${who}: by token`);
    assert.equal(designerFor(bearer(token))?.username, name, `${who}: by bearer header`);
  }
  assert.equal(designerForToken(T.neither), undefined, 'a plain player');
  assert.equal(designerFor(bearer(T.neither)), undefined, 'a plain player, by header');
  assert.equal(designerForToken(null), undefined, 'no token');
  assert.equal(designerForToken(''), undefined, 'an empty token');
  assert.equal(designerFor(bearer(null)), undefined, 'no header');
  assert.equal(designerForToken('not-a-session'), undefined, 'a made-up token');
  // a badge is a display mark, not the permission
  setBadge(accountByName('Nell')!, { owner: true, judge: 3 });
  assert.equal(designerForToken(T.neither), undefined, 'an owner and judge badge is not the permission');
  logout(T.gone);
  assert.equal(designerForToken(T.gone), undefined, 'a logged-out session');
  assert.equal(designerForToken(T.stale)?.username, 'Stella', 'positive control: live until it idles out');
  mock.timers.enable({ apis: ['Date'], now: Date.now() + SESSION_IDLE_MS + 60_000 });
  try {
    assert.equal(designerForToken(T.stale), undefined, 'an expired session');
  } finally {
    mock.timers.reset();
  }
});

test('1508 §2 setDesigner round trip: independent of admin and badge, and persisted', () => {
  const nell = accountByName('Nell')!;
  assert.equal(setDesigner(nell, true), true);
  assert.equal(nell.designer, true);
  assert.equal(nell.admin, undefined, 'granting designer grants no admin');
  assert.equal(nell.badge?.judge, 3, 'and leaves the badge alone');
  assert.equal(setDesigner(nell, true), true, 'granting twice is harmless');
  // the last designer may be revoked: an admin can always grant it again
  for (const n of ['Desi', 'Bea', 'Gonzo', 'Stella']) setDesigner(accountByName(n)!, false);
  assert.equal(setDesigner(nell, false), false, 'the last designer can be revoked');
  assert.ok(!('designer' in nell), 'revoked is absent, not false');
  setDesigner(nell, true);
  useAccountsFile(file);
  assert.equal(accountByName('Nell')!.designer, true, 'survives a reload from disk');
  assert.equal(accountByName('Adam')!.designer, undefined, 'an admin was never given it');
  setDesigner(accountByName('Nell')!, false);
  useAccountsFile(file);
  assert.equal(accountByName('Nell')!.designer, undefined, 'and the revoke survives too');
  assert.ok(!/"designer"/.test(readFileSync(file, 'utf8')), 'nobody holds it, so the file never names it');
  // admin is untouched by any of this, and revoking admin leaves designer
  const bea = accountByName('Bea')!;
  setDesigner(bea, true);
  setAdmin(bea, false);
  assert.equal(bea.designer, true, 'revoking admin leaves designer');
  assert.equal(designerForToken(T.both)?.username, 'Bea', 'and the designer flag alone still admits');
});

test('1508 §3 the own view carries designer only for itself, only when true', () => {
  const desi = accountByName('Desi')!;
  setDesigner(desi, true);
  const online = () => false;
  assert.equal(privateView(desi, online).designer, true, 'a designer is told so about themselves');
  assert.equal(privateView(accountByName('Nell')!, online).designer, undefined, 'a player is not');
  assert.ok(!('designer' in JSON.parse(JSON.stringify(privateView(accountByName('Nell')!, online)))),
    'and the key is not on the wire at all');
  assert.equal(privateView(accountByName('Adam')!, online).designer, undefined,
    'an admin sees the flag it holds, not the permission admin implies');
  assert.ok(!('designer' in publicView(desi)), 'the public view never carries it');
});
