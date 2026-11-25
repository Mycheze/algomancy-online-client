/**
 * A page's comments are read as its map: a file they name must exist, and the
 * admin page's head must not deny the way in the profile draws.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = dirname(dirname(fileURLToPath(import.meta.url)));
const CLIENT = dirname(UI);
const ROOT = dirname(CLIENT);
const PAGES = join(UI, 'pages');

/** a path written from the repo root (`client/…`, `data/…`) or from client/ (`ui/…`) */
const PATH = /\b(?:client|data|ui|server|engine|ledgers)\/[A-Za-z0-9_./-]+\.(?:ts|mjs|jsonl|json|md|css)\b/g;
const resolve = (p: string): string =>
  p.startsWith('client/') || p.startsWith('data/') ? join(ROOT, p) : join(CLIENT, p);

test('BL-10: every repo file a page under ui/pages/ names still exists', () => {
  const files = readdirSync(PAGES).filter(f => f.endsWith('.ts'));
  assert.ok(files.length > 20, `reads the pages, not an empty directory (${files.length})`);
  const dead: string[] = [];
  let named = 0;
  for (const f of files) {
    const src = readFileSync(join(PAGES, f), 'utf8');
    for (const p of new Set(src.match(PATH) ?? [])) {
      named++;
      if (!existsSync(resolve(p))) dead.push(`pages/${f}: ${p}`);
    }
  }
  assert.ok(named > 20, `found the paths the pages name (${named})`);
  assert.deepEqual(dead, [], 'a comment points at a file that moved or was removed');
});

test('BL-10: the admin page and main.ts say the profile has the way in', () => {
  const profile = readFileSync(join(PAGES, 'profile.ts'), 'utf8');
  assert.ok(/me\.admin \? button\(\{ label: 'Admin'[^\n]*dataBtn: 'nav-admin'/.test(profile),
    'the profile draws an Admin button for an admin — the claim below is about it');
  const admin = readFileSync(join(PAGES, 'admin.ts'), 'utf8');
  const main = readFileSync(join(UI, 'main.ts'), 'utf8');
  for (const [name, src] of [['pages/admin.ts', admin], ['main.ts', main]] as const) {
    assert.ok(!/no(?:thing)? links? to it/i.test(src), `${name} says nothing links to the admin page`);
  }
  assert.ok(/Admin button on an admin's own profile/.test(admin), 'the admin page names its way in');
  assert.ok(/\?admin=1 or from an admin's own profile/.test(main), 'and so does main.ts where it starts it');
});
