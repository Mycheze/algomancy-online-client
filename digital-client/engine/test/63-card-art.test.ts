/* Every registered card's `image` must resolve to a real file.
 *
 * The Wraith spent its whole life pointing at 'Generic-Unit.jpg' with a
 * comment claiming there was no printed art for it — there was, and the card
 * rendered as an anonymous generic token in every client for as long as
 * nobody looked. Nothing in the suite could have caught that, because the
 * `image` field is a string and a string is always "valid".
 *
 * So: one test, over the whole registry, that opens the file.
 *
 * Synthetic cards registered by other test files are deliberately NOT a
 * problem here — `node --test` runs each test file in its own process, so
 * this one sees registry.ts's own registrations and nothing else. The two
 * genuine synthetics in the pool (the generic Unit Token) point at real art
 * in the box scans, like everything else.
 *
 * Seeds: none — this is a pure data guard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import '../src/cards/registry.ts';   // side-effect: registers the whole pool

/** the card scans, resolved the same way ui/main.ts's ART and server/main.ts's
 * ART_DIR do — relative to this file, never to the process's cwd */
const ART_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'AlgomancyCards');

test('every registered card names an image that exists under AlgomancyCards/', () => {
  const names = allCardNames();
  // an empty registry would make the loop below vacuously green, which is the
  // one way this guard could go quiet again
  assert.ok(names.length > 400, `the pool is registered (${names.length} cards)`);
  const missing: string[] = [];
  for (const name of names) {
    const img = getCard(name).image;
    if (!img) { missing.push(`${name}: (no image field)`); continue; }
    if (!existsSync(join(ART_DIR, img))) missing.push(`${name}: ${img}`);
  }
  assert.deepEqual(missing, [],
    `card art missing from ${ART_DIR}:\n  ${missing.join('\n  ')}`);
});

// The specific gap this guard was written for.
test('the Wraith token uses its own printed art, not the generic-unit card', () => {
  const img = getCard('Wraith').image;
  assert.equal(img, 'Wraith.jpg', 'extracted from the oracle entry, not hand-written');
  assert.ok(existsSync(join(ART_DIR, img)), 'and the scan is on disk');
});
