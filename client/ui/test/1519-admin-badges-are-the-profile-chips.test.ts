/* 1519 · THE ADMIN PAGE'S BADGE CHIPS ARE THE PROFILE'S (BL-10)
 *
 * A judge's chip is drawn by badgeChipsHtml, which names the level on hover.
 * The admin page drew its own copy, with no hover text; its owner and admin
 * chips, which only that page draws, had none either.
 *
 *   §1 the accounts and reports tables draw the profile's judge chip verbatim,
 *      and the owner and admin chips say what they are, with a capital
 *   §2 a census of the ui sources: only the profile writes a judge chip
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { badgeChipsHtml } from '../account.ts';
import { adminHtml, type AdminView } from '../pages/admin.ts';

const UI = join(import.meta.dirname, '..');

function view(over: Partial<AdminView>): AdminView {
  return {
    access: true, current: 'accounts', isLoading: false, actionMsg: '', faultMsg: '', overview: null,
    accountRows: [], reportRows: [], gameRows: [], roomRows: [],
    calendar: { now: 0, rows: [], runsOutAt: null, weeksLeft: 0, upcoming: 0 },
    onlyUnmarked: false, chrome: { signedIn: true, alerts: 0 },
    ...over,
  };
}

const chips = (html: string): string[] => [...html.matchAll(/<span class="badgechip [^"]*"[^>]*>[^<]*<\/span>/g)].map(m => m[0]);

test('1519 §1 BL-10: the admin tables draw the profile\'s judge chip, and every chip says what it is', () => {
  const accounts = adminHtml(view({
    accountRows: [{ id: 'a', username: 'Ops', createdAt: '2026-10-01T00:00:00Z', admin: true, badge: { owner: true, judge: 2, since: 'x' },
      games: 3, wins: 1, lastPlayed: null, friends: 0, decks: 0, discord: null }],
  }));
  const reports = adminHtml(view({
    current: 'reports',
    reportRows: [{ id: 7, ledgerId: 7, ts: '2026-11-01T10:00:00Z', room: 'QXZK', seat: 0, note: 'n', actionIndex: 3,
      kind: 'bug', severity: 'minor', by: { name: 'Kim', judge: 3 }, status: 'fixed', ledgerNote: null, mark: null, markedBy: null }],
  }));
  assert.ok(accounts.includes(badgeChipsHtml({ judge: 2 })), 'the account row\'s judge chip is the profile\'s');
  assert.ok(reports.includes(badgeChipsHtml({ judge: 3 })), 'the report filer\'s judge chip is the profile\'s');
  const drawn = [...chips(accounts), ...chips(reports)];
  assert.equal(drawn.length, 4, drawn.join('\n'));
  for (const c of drawn) {
    assert.match(c, / title="[^"]+"/, `a chip with no hover text: ${c}`);
    assert.match(c, />[A-Z][^<]*<\/span>$/, `a chip that starts lower-case: ${c}`);
  }
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'test' || n === 'node_modules' ? [] : sources(p);
    return n.endsWith('.ts') ? [p] : [];
  });
}

test('1519 §2 BL-10: only the profile writes a judge chip', () => {
  const writers = sources(UI).filter(p => readFileSync(p, 'utf8').includes('badgechip judge')).map(p => relative(UI, p));
  assert.deepEqual(writers, ['pages/profile.ts']);
});
