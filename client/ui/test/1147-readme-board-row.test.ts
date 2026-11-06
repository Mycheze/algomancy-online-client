/* 1147 · client/README.md DESCRIBES THE BOARD THAT EXISTS (CT-431)
 *
 * The README's row for docs/18-board-layout-v2.md said the regions board was
 * "behind the ▦ board toggle" for six weeks after it became the default
 * (2026-09-26), and for another week after board round 8 deleted the toggle
 * and the classic board altogether (2026-10-29). Nothing read the row.
 *
 * The spec's own status block is the source: while it says the regions board
 * is the only board, the README's row may not send a reader looking for a
 * toggle, a classic board or the `algoLayout` preference.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CLIENT_DOCS_DIR, CLIENT_README } from '../../engine/scripts/paths.mjs';

const SPEC = '18-board-layout-v2.md';

test('client/README.md: the regions board row names no toggle or classic board while the spec says it is the only board', () => {
  const spec = readFileSync(join(CLIENT_DOCS_DIR, SPEC), 'utf8');
  const status = (spec.split('\n## ')[0] ?? '').replace(/\s+/g, ' ');
  assert.match(status, /the only board/, `${SPEC}'s status block no longer says the regions board is the only board — re-read it and update this test`);

  const row = readFileSync(CLIENT_README, 'utf8').split('\n').find(l => l.startsWith(`| [\`${SPEC}\`](docs/${SPEC}) |`));
  assert.ok(row, `client/README.md has no table row linking docs/${SPEC}`);
  assert.match(row, /only board/, `the README row should say the regions board is the only board: ${row}`);
  for (const stale of [/toggle/i, /classic/i, /▦/, /algoLayout/, /default/i]) {
    assert.doesNotMatch(row, stale, `the README row still describes the deleted board choice (${stale}): ${row}`);
  }
});
