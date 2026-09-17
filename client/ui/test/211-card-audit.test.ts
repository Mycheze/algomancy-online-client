/**
 * The card-data audit, run as a test so it cannot rot.
 *
 * `scripts/audit-cards.mjs` can be run by hand and prints a report. That is
 * useful and it is not a guard: a script nobody runs is a script that is green
 * because nothing looked. So the same function runs here, on every `npm test`,
 * and the suite fails on a finding that is not declared in
 * `scripts/card-audit-known.mjs`.
 *
 * The most valuable assertion in the file is the dullest one: that
 * `printed.json` and `catalogue.json` are what the CURRENT oracle file
 * produces. Editing the transcription and forgetting to re-extract used to be
 * invisible — the client simply kept showing yesterday's cards — and the card
 * browser makes that worse, because a browser is where you go to check what a
 * card says.
 *
 * The checks that need the REGISTRY (aliases, DECK_LIST, art for every name the
 * client will draw) live here rather than in the .mjs script, because the
 * script cannot import TypeScript.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { allCardNames, canonicalCardName, getCard } from '../../engine/src/cards/dsl.ts';
import { auditReport } from '../../engine/scripts/audit-cards.mjs';
import { KNOWN_FINDINGS } from '../../engine/scripts/card-audit-known.mjs';
import { allRows, rowFor } from '../cardindex.ts';
import { join } from 'node:path';
import { CARDS_DIR } from '../../engine/scripts/paths.mjs';

const ART_DIR = CARDS_DIR;

test('the card audit is clean, or every finding is declared', () => {
  const { ok, text, fresh, stale } = auditReport();
  assert.equal(ok, true, `\n${text}\n`);
  assert.deepEqual(fresh, [], 'undeclared findings');
  assert.deepEqual(stale, [], 'declared findings that no longer fire — delete them');
});

test('every declared finding says who accepted it and why', () => {
  for (const k of KNOWN_FINDINGS) {
    assert.ok(k.check && k.card, 'a finding needs a check and a card');
    assert.ok(k.why.length > 20, `${k.check}/${k.card}: the reason is the point of the entry`);
    assert.match(k.since, /^\d{4}-\d{2}-\d{2}$/, `${k.check}/${k.card}: needs a date`);
  }
});

/* ── the checks that need the registry ─────────────────────────────────── */

test('every name the client can draw has a scan on disk', () => {
  for (const name of allCardNames()) {
    const img = getCard(name).image;
    // '' is the honest answer for an engine-internal marker; a real card that
    // says it has art must have it, because the browser will ask for the file
    if (!img) continue;
    assert.ok(existsSync(join(ART_DIR, img)), `${name}: no ${img} in data/cards/`);
  }
});

test('aliases resolve and never leak into the card list', () => {
  const listed = new Set(allCardNames());
  for (const alias of ['Wight', 'Counter Theif']) {
    const target = canonicalCardName(alias);
    assert.notEqual(target, alias, `${alias} should resolve to something else`);
    assert.ok(listed.has(target), `${alias} resolves to ${target}, which is not registered`);
    assert.ok(!listed.has(alias), `${alias} leaked into allCardNames() — the browser would show it twice`);
  }
});

test('DECK_LIST is the deck-legal subset, and the index agrees', () => {
  const legal = new Set(DECK_LIST);
  assert.equal(legal.size, DECK_LIST.length, 'DECK_LIST has a duplicate');
  for (const n of DECK_LIST) {
    assert.ok(rowFor(n)?.playable, `${n} is deck-legal but the index does not say so`);
    assert.ok(rowFor(n)?.scripted, `${n} is deck-legal but has no printed data`);
  }
  for (const r of allRows()) {
    assert.equal(r.playable, legal.has(r.name), `${r.name}: playable disagrees with DECK_LIST`);
  }
});

test('the index covers the catalogue and the registry, and confuses neither for the other', () => {
  const rows = allRows();
  assert.equal(new Set(rows.map(r => r.name)).size, rows.length, 'a name appears twice');
  // three different questions, three different answers — see ui/cardindex.ts
  assert.equal(rows.length, 539); // +2 on 2026-09-17: Light & Dark Resource
  assert.equal(rows.filter(r => r.scripted).length, 495);
  assert.equal(rows.filter(r => r.playable).length, 483);
  for (const r of rows) {
    if (r.playable) assert.ok(r.scripted, `${r.name}: playable but not scripted`);
    if (r.scripted) assert.ok(allCardNames().includes(r.name), `${r.name}: scripted but not registered`);
  }
});

test('nothing that is not a card is offered as one', () => {
  for (const r of allRows()) {
    if (r.cls === 'card') continue;
    assert.ok(!r.playable, `${r.name} is a ${r.cls} and should never be deck-legal`);
  }
  // and the engine-internal marker in particular, which is the one that got in
  assert.equal(rowFor('Alluring Attribute')?.cls, 'marker');
});
