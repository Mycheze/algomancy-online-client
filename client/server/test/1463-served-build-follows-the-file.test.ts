/* 1463 — the server reports the bundle it serves NOW: replace bundle.js under it, no
 * restart, and the next answer carries the new stamp (server/build-stamp.ts). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleBuild } from '../build-stamp.ts';

test('a bundle replaced on disk is reported by its new stamp', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'algo-1463-')), 'bundle.js');
  writeFileSync(file, '(()=>{var s="algo-build:aaaaaaaaaaaa";})();');
  assert.equal(bundleBuild(file), 'aaaaaaaaaaaa');
  // the same length, so only the file's time says it changed
  writeFileSync(file, '(()=>{var s="algo-build:bbbbbbbbbbbb";})();');
  utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal(bundleBuild(file), 'bbbbbbbbbbbb');
});
