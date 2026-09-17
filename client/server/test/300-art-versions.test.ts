/* CARD ART THAT CAN CHANGE — server/art-versions.ts.
 *
 * The scans were served immutable for a year under a bare filename, so when the
 * official Light & Dark Resource scans replaced the placeholders in place, every
 * browser that had seen a placeholder kept it. The version now lives in the URL.
 *
 * §1 ⭐ a file replaced IN PLACE, same name, gets a new hash — the whole point
 * §2 an unchanged file keeps its hash; a deleted one drops out; non-images are ignored
 * §3 a name that is not a file is null, not a throw (the route asks for anything)
 * §4 the real scans directory: every scan is published, as the script the page loads
 *
 * The HTTP half (which hash earns `immutable`) is test-malformed.ts §6, against
 * the real server. The UI half (every card image goes through artUrl) is
 * ui/test/247-asset-paths.test.ts §5.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artVersions, HASH_LENGTH } from '../art-versions.ts';
import { CARDS_DIR } from '../../engine/scripts/paths.mjs';

const scratch = (): string => mkdtempSync(join(tmpdir(), 'algo-artver-'));

test('§1 a scan replaced in place under the same name gets a new hash', async () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'Light-Resource.jpg'), 'placeholder');
    const v = artVersions(dir);
    const before = await v.versionOf('Light-Resource.jpg');
    assert.equal(before?.length, HASH_LENGTH);
    writeFileSync(join(dir, 'Light-Resource.jpg'), 'the official scan');
    // a copy can land inside the same mtime tick; the size moving is enough
    const after = await v.versionOf('Light-Resource.jpg');
    assert.notEqual(after, before, 'the replaced scan must be asked for under a URL no browser has cached');
    // …and even when size AND mtime happen to match, a fresh process sees the truth
    writeFileSync(join(dir, 'Light-Resource.jpg'), 'the official scaN');
    utimesSync(join(dir, 'Light-Resource.jpg'), 1, 1);
    assert.notEqual(await artVersions(dir).versionOf('Light-Resource.jpg'), after);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('§2 unchanged keeps its hash; deleted drops out; non-images are not published', async () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'A.jpg'), 'a');
    writeFileSync(join(dir, 'B.jpg'), 'b');
    writeFileSync(join(dir, 'notes.json'), '{}');
    const v = artVersions(dir);
    const first = await v.all();
    assert.deepEqual(Object.keys(first), ['A.jpg', 'B.jpg']);
    assert.equal((await v.all())['A.jpg'], first['A.jpg']);
    unlinkSync(join(dir, 'B.jpg'));
    assert.deepEqual(Object.keys(await v.all()), ['A.jpg']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('§3 a name that is not a file answers null', async () => {
  const dir = scratch();
  try {
    const v = artVersions(dir);
    assert.equal(await v.versionOf('Nope.jpg'), null);
    assert.equal(await v.versionOf('.'), null, 'a directory is not a scan');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('§4 every real scan is in the script the page loads', async () => {
  const scans = readdirSync(CARDS_DIR).filter(f => f.endsWith('.jpg'));
  assert.ok(scans.length > 400, `only ${scans.length} scans — measuring the wrong place`);
  const body = await artVersions(CARDS_DIR).script();
  const m = /^window\.ALGO_ART_VERSIONS=(\{.*\});\n$/.exec(body);
  assert.ok(m, 'the script assigns one object literal');
  const published = JSON.parse(m[1]!) as Record<string, string>;
  assert.deepEqual(scans.filter(f => !published[f]), []);
});
