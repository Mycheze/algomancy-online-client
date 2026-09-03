/*
 * 247 · THE ASSET PATHS RESOLVE, BOTH WAYS
 *
 * The client asks for card art with ONE string, `ui/assets.ts`'s ART_BASE, and
 * that string has to be correct under two different resolvers at once:
 *
 *   file://…/client/ui/index.html  + '../../data/cards/'
 *        → walks two REAL directories up and lands on the scans.
 *   http://host/index.html         + '../../data/cards/'
 *        → the excess `..` clamps at the root, giving '/data/cards/',
 *          which server/main.ts answers with a route.
 *   (Three dots deep until 2026-08-30, when ui/ left engine/; the body below
 *   computes both readings from the constant, so only this prose was stale.)
 *
 * Nothing said so. Before this file, the depth of `ui/` below the repo
 * root was load-bearing, undocumented and untested: move the package one level,
 * or edit the literal, and the HTTP reading goes on working — every served page
 * still renders — while the no-server hotseat rig silently shows broken images.
 * A failure that only appears when a human opens a file by hand is a failure
 * nobody finds for months.
 *
 * So this asserts the REACH of the string, never a rendered pixel:
 *
 *   §0  non-vacuity — the corpus this file quantifies over is not empty
 *   §1  the file:// reading resolves to the real scans directory
 *   §2  the HTTP reading resolves to a prefix server/main.ts actually routes
 *   §3  the same, for ICON_BASE
 *   §4  every path scripts/paths.mjs names exists on disk
 *
 * ⚠ §0 IS NOT DECORATION. Every check below is "the thing I computed matches
 * the thing I read". Two empty sets match. Two missing directories both fail to
 * contain a file. The positive controls are what stop this file passing while
 * measuring nothing — write them first, and never delete one to make a run go
 * green.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ART_BASE, ICON_BASE } from '../assets.ts';
import { CARDS_DIR, ICONS_DIR, ORACLE_JSON, REPO_ROOT, RULES_DIR, MANUAL_TXT } from '../../engine/scripts/paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_DIR = resolve(HERE, '..');
const SERVER_MAIN = resolve(HERE, '..', '..', 'server', 'main.ts');

/** a card whose scan has been in the repo since long before this test */
const KNOWN_SCAN = 'Fireball.jpg';

/* ════════════════════════════════════════════════════════════════════════
 * 0. NON-VACUITY — the things everything below quantifies over
 * ════════════════════════════════════════════════════════════════════════ */

test('§0 POSITIVE CONTROL: the ui directory, the scans and the server source are all really there', () => {
  assert.ok(existsSync(join(UI_DIR, 'index.html')),
    `no ui/index.html at ${UI_DIR} — every path below is resolved against it`);
  assert.ok(statSync(CARDS_DIR).isDirectory(), `${CARDS_DIR} is not a directory`);

  const scans = readdirSync(CARDS_DIR).filter(f => f.endsWith('.jpg'));
  assert.ok(scans.length > 400,
    `only ${scans.length} scans in ${CARDS_DIR} — the pool is ~528; this test is measuring the wrong place`);
  assert.ok(scans.includes(KNOWN_SCAN),
    `${KNOWN_SCAN} is missing from ${CARDS_DIR}; pick a different anchor card`);

  assert.ok(existsSync(SERVER_MAIN), `no server/main.ts at ${SERVER_MAIN} — §2 and §3 would pass vacuously`);
  assert.ok(ART_BASE.length > 0 && ICON_BASE.length > 0, 'an empty base URL matches everything');
});

/* ════════════════════════════════════════════════════════════════════════
 * 1. THE file:// READING
 * ════════════════════════════════════════════════════════════════════════ */

test('§1 ART_BASE resolved from ui/ on disk lands on the real scans directory', () => {
  // exactly what a browser does with a relative src on a file:// page
  const onDisk = resolve(UI_DIR, ART_BASE);
  assert.equal(onDisk, resolve(CARDS_DIR),
    `ART_BASE walks to ${onDisk}, but the scans are at ${resolve(CARDS_DIR)}.\n` +
    'Either the literal in ui/assets.ts is wrong, or ui/ has moved to a different ' +
    'depth below the repo root. The served client will not notice; file:// will.');
  assert.ok(existsSync(join(onDisk, KNOWN_SCAN)),
    `${KNOWN_SCAN} is not under ${onDisk} — the hotseat rig would show broken images`);
});

/* ════════════════════════════════════════════════════════════════════════
 * 2 & 3. THE HTTP READING — the server must route what the client asks for
 * ════════════════════════════════════════════════════════════════════════ */

/** the path a browser requests for `base` from a page served at the root */
const servedPrefix = (base: string): string => new URL(base, 'http://host/index.html').pathname;

test('§2 the URL ART_BASE produces over HTTP is a prefix server/main.ts routes', () => {
  const prefix = servedPrefix(ART_BASE);
  assert.equal(prefix, '/data/cards/',
    'the clamped URL changed; §2 only means anything if it matches the route below');
  const src = readFileSync(SERVER_MAIN, 'utf8');
  assert.ok(src.includes(`path.startsWith('${prefix}')`),
    `the client will request ${prefix}<Name>.jpg and server/main.ts has no route for it. ` +
    'Card art 404s on every served page.');
});

test('§3 the same holds for ICON_BASE', () => {
  const prefix = servedPrefix(ICON_BASE);
  assert.equal(prefix, '/data/icons/', 'the icon URL changed');
  const src = readFileSync(SERVER_MAIN, 'utf8');
  assert.ok(src.includes(`path.startsWith('${prefix}')`),
    `the client will request ${prefix}<name>.webp and server/main.ts has no route for it`);
});

/* ════════════════════════════════════════════════════════════════════════
 * 4. THE FILESYSTEM SIDE
 * ════════════════════════════════════════════════════════════════════════ */

test('§4 every path scripts/paths.mjs names exists', () => {
  const named: Record<string, string> = {
    REPO_ROOT, CARDS_DIR, ORACLE_JSON, ICONS_DIR, RULES_DIR, MANUAL_TXT,
  };
  const missing = Object.entries(named).filter(([, p]) => !existsSync(p));
  assert.deepEqual(missing, [],
    `scripts/paths.mjs names ${missing.length} path(s) that do not exist: ` +
    missing.map(([k, p]) => `${k} -> ${p}`).join(', '));
  // and the shared assets really are shared: the bot names the same five things
  assert.ok(existsSync(join(REPO_ROOT, 'bot', 'paths.py')),
    'bot/paths.py is the Python side of this same question — it names the same ' +
    'shared directories. If it has moved, the two sides can drift apart silently.');
});
