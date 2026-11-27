/**
 * A shared deck's link-preview picture is drawn once into var/og-cache under a
 * key and kept, so the key must move when the art does: it is made of the
 * three scans AND their art versions (art-versions.ts). The fan's cost
 * tiebreak reads the card's printed mana, not its affinity pips.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artVersions } from '../art-versions.ts';
import { deckPictureKey, deckTrio, trioFacts } from '../linkpreview.ts';
import { rowFor } from '../../ui/cardindex.ts';

test('deck picture key: the same scans at the same versions give the same key', () => {
  const files = ['A.jpg', 'B.jpg', 'C.jpg'];
  assert.equal(deckPictureKey(files, ['1', '2', '3']), deckPictureKey([...files], ['1', '2', '3']));
  assert.match(deckPictureKey(files, ['1', '2', '3']), /^[0-9a-f]{12}$/);
  assert.notEqual(deckPictureKey(files, ['1', '2', '3']), deckPictureKey(files, ['1', '9', '3']), 'a new version of one scan');
  assert.notEqual(deckPictureKey(files, ['1', '2', '3']), deckPictureKey(['A.jpg', 'C.jpg', 'B.jpg'], ['1', '3', '2']), 'another order');
  assert.notEqual(deckPictureKey(files, [null, null, null]), deckPictureKey(files, ['1', '2', '3']));
});

test('deck picture key: new art under the same filename gets a new key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'algo-1502-'));
  try {
    const files = ['Good-Whale.jpg', 'Murkstalker.jpg', 'Vroot.jpg'];
    for (const f of files) writeFileSync(join(dir, f), `old ${f}`);
    const av = artVersions(dir);
    const key = async () => deckPictureKey(files, await Promise.all(files.map((f) => av.versionOf(f))));
    const before = await key();
    assert.equal(await key(), before, 'nothing changed, so the cached picture still holds');
    writeFileSync(join(dir, 'Murkstalker.jpg'), 'new art, a different size');
    assert.notEqual(await key(), before, 'the cached picture would show the old art');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deck picture fan: the cost tiebreak reads printed mana, so the dearer card leads a tie', () => {
  const whale = rowFor('Good Whale'), drifter = rowFor('Dune Drifter');
  assert.ok(whale && drifter);
  assert.equal(trioFacts(whale, true).cost, 6);
  assert.ok(whale.mana > drifter.mana);
  const facts = (n: string) => { const r = rowFor(n); return r ? trioFacts(r, true) : null; };
  // one copy each, no cover: the dearer card leads, whatever the alphabet says
  assert.deepEqual(deckTrio(['Dune Drifter', 'Good Whale'], null, facts)[0], 'Good Whale');
});
