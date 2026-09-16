/**
 * BL-16 — the operator dashboard's wiring, asserted over the SOURCE.
 *
 * ui/admin.ts is a painting layer like ui/cards.ts and ui/meta.ts: it builds
 * strings and hands them to `$app.innerHTML`, and no fake DOM in this repo
 * reaches it. So the claims worth guarding here are the ones a grep could make
 * false and nothing else would notice — and for THIS page one of them is a
 * security property rather than a design one.
 *
 *   1. THE PAGE NEVER DECIDES WHO IS AN ADMIN. Every gate is the server's; the
 *      client's only input is whether a fetch came back 200. A check written
 *      against a field on the local profile would look identical, work in
 *      testing, and be walked around by anybody who can edit localStorage.
 *   2. IT IS REGISTERED IN main.ts three ways — init, screen, handleButton —
 *      because a page registered twice and dispatched never is a page that
 *      silently does not exist.
 *   3. STATUS IS READ-ONLY. The ledger is committed source; a control that
 *      wrote it would write to a file on the deploy box and be destroyed by
 *      the next `git pull`. There is no such control, and this is what says so.
 *   4. NOTHING LINKS TO IT. `?admin=1` is the only way in. A menu entry would
 *      tell every player the page exists, which is not a vulnerability but is
 *      an invitation to try.
 *
 * The server-side half of all this — the 404s themselves — is
 * server/test-admin.ts, which asks a real server four ways. This file cannot
 * prove a gate; it proves the client is not carrying a second one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = dirname(dirname(fileURLToPath(import.meta.url)));
const admin = readFileSync(join(UI, 'admin.ts'), 'utf8');
const main = readFileSync(join(UI, 'main.ts'), 'utf8');

test('BL-16 §1 the page asks the SERVER who is an admin, and carries no check of its own', () => {
  // the only thing that sets `allowed` is an HTTP status
  const sets = admin.match(/allowed = (true|false|null)/g) ?? [];
  assert.ok(sets.length >= 2, 'the flag is set from more than one place, or this is measuring nothing');
  assert.ok(/if \(!res\.ok\) \{ allowed = false/.test(admin),
    'a non-200 is what makes the page refuse — that is the server speaking');
  // and NOTHING reads a local claim of adminness
  assert.ok(!/currentUser\(\)[^\n]*\.admin/.test(admin),
    'the page must not read an admin flag off the locally cached profile: /api/me does not '
    + 'carry one, and a client-side check is one localStorage edit from being bypassed');
  assert.ok(!/\.admin\s*===\s*true/.test(admin.replace(/a\.admin/g, '')),
    'no client-side adminness test beyond painting somebody ELSE\'s row');
});

test('BL-16 §2 main.ts registers the page: init, screen and handleButton', () => {
  assert.ok(/import \* as admin from '\.\/admin\.ts';/.test(main), 'imported');
  assert.ok(/admin\.initAdmin\(\{/.test(main), 'initialised at boot, so ?admin=1 opens it');
  assert.ok(/if \(admin\.screen\(\)\) \{ admin\.renderScreen\(\); return; \}/.test(main),
    'dispatched in render, so it owns the page when open');
  assert.ok(/if \(admin\.handleButton\(btn\)\) return;/.test(main),
    'offered every click, so its buttons do something');
});

test('BL-16 §3 a report\'s implementation status is read-only — no control writes the ledger', () => {
  // the three writes this page is allowed to make, and no more
  const posts = [...admin.matchAll(/post\('([^']+)'/g)].map(m => m[1]).sort();
  assert.deepEqual([...new Set(posts)], ['/api/admin/mark', '/api/admin/setadmin', '/api/admin/setbadge'],
    'exactly three writes: the triage mark, a judge badge and the admin flag. A fourth that '
    + 'set a ledger STATUS would be writing to committed source on the deploy box, and the '
    + 'next git pull would destroy it');
  assert.ok(/read-only/i.test(admin), 'and the page says so where an operator will read it');
});

/** strip comments — a comment that MENTIONS ?admin=1 is documentation, and the
 *  claim here is about what the client BUILDS. Without this the test fails on
 *  the line in main.ts that explains why nothing links to the page. */
const code = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('BL-16 §4 nothing in the client links to the dashboard', () => {
  const others = code(['home', 'lobby', 'account', 'legal', 'helplayer', 'report']
    .map(f => {
      try { return readFileSync(join(UI, `${f}.ts`), 'utf8'); } catch { return ''; }
    }).join('\n') + main.replace(/admin\.(initAdmin|screen|renderScreen|handleButton)/g, ''));
  assert.ok(!/\?admin=1/.test(others),
    'no page builds a link to ?admin=1 — you reach it by typing it, and what decides whether '
    + 'you see anything is the server');
  assert.ok(!/openAdmin\(\)/.test(others),
    'and nothing outside the module opens it either');
});

test('BL-16 §5 the marks journal is append-only on this side too — the page never rewrites a report', () => {
  assert.ok(!/issues\.jsonl/.test(admin),
    'the page has no business naming the reports journal at all; it talks to routes');
  // the clear path exists, because a mark you cannot take back is a mark you
  // hesitate to make
  assert.ok(/mark: cur === mark \? null : mark/.test(admin),
    'clicking the mark a report already carries clears it — one control for both directions');
});
