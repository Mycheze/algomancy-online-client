/**
 * BL-70 — a replaced card scan must not leave the data read off it stale.
 *
 * Four scripts read the card scans and write what they saw:
 * `bot/pipeline/build_anchors.py` (mod_anchors.json — the mod strip's peek),
 * `classify_complexity.py` (complexity-overrides.json — Simple/Complex),
 * `read_text_boxes.py` (text-boxes.json — where the zoom greys the rules box)
 * and `read_card_faces.py` (card-faces.json — the symbol report). Swapping a
 * scan re-runs none of them. Until 2026-11-06 every scan replacement had left
 * its rows the OLD picture's: re-reading for Mindburn's new scan moved rows for
 * six other cards whose scans had been replaced weeks earlier (Torrential
 * Reclamation's type bar 785 → 781 px; five complexity scores) — and nothing
 * could tell.
 *
 * Now each reader, when it writes, records in `data/cards/scan-reads.json` the
 * sha256 of every scan it opened (`bot/pipeline/scan_reads.py`), templates
 * included. This test hashes the scans on disk the same way and fails naming
 * the card and the reader to re-run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CARDS_DIR, ORACLE_JSON, SCAN_READS } from '../scripts/paths.mjs';

/** every reader that must have a section — the four that read the scans */
export const SCAN_READERS = ['build_anchors', 'classify_complexity', 'read_card_faces', 'read_text_boxes'] as const;

type ScanReads = { readers?: Record<string, Record<string, string>> };

/** the same hash scan_reads.py writes: sha256, first 16 hex digits */
export function scanHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

/** → one line per stale reading; empty when every reader read today's scans.
 * `cardScans`: the scan files of the oracle's cards. Each of those must have
 * been read by some reader; a scan that is no oracle row's (a back face,
 * Beyond-Codex-Incarnate.jpg) is read by none of them, and only needs
 * re-reading if one already did. */
export function staleScanReads(cardsDir: string, reads: ScanReads, cardScans: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const readers = reads.readers ?? {};
  const card = (file: string) => file.replace(/\.jpg$/, '').replace(/-/g, ' ');
  const rerun = (r: string) => `re-run .venv/bin/python bot/pipeline/${r}.py`;
  for (const r of SCAN_READERS) if (!readers[r]) out.push(`${r} has recorded no scans — ${rerun(r)}`);
  const onDisk = readdirSync(cardsDir).filter(f => f.endsWith('.jpg')).sort();
  const hash = new Map(onDisk.map(f => [f, scanHash(join(cardsDir, f))]));
  for (const [r, files] of Object.entries(readers)) {
    for (const [file, h] of Object.entries(files)) {
      const now = hash.get(file);
      if (now === undefined) out.push(`${card(file)} (${file}): ${r} read a scan that is gone — ${rerun(r)}`);
      else if (now !== h) out.push(`${card(file)} (${file}): the scan was replaced after ${r} read it — ${rerun(r)}`);
    }
  }
  // an oracle card's scan no reader has ever opened is a new card nobody read
  for (const f of onDisk) {
    if (cardScans.has(f) && !Object.values(readers).some(files => f in files)) {
      out.push(`${card(f)} (${f}): no scan reader has read this scan — re-run all four (CLAUDE.md's generated table)`);
    }
  }
  return out;
}

test('1159: every scan reader read the scans that are on disk now', () => {
  assert.ok(existsSync(SCAN_READS), 'data/cards/scan-reads.json is missing — the scan readers write it');
  const reads = JSON.parse(readFileSync(SCAN_READS, 'utf8')) as ScanReads;
  const oracle = JSON.parse(readFileSync(ORACLE_JSON, 'utf8')) as Record<string, unknown>;
  const cardScans = new Set(Object.keys(oracle).map(n => `${n.replace(/ /g, '-')}.jpg`));
  const stale = staleScanReads(CARDS_DIR, reads, cardScans);
  assert.deepEqual(stale, [], `scan-read data is stale:\n  ${stale.join('\n  ')}`);
});

test('1159: a replaced scan names its card and the reader to re-run; a new card\'s scan nobody read is named too, a back face is not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'algo-scan-reads-'));
  try {
    writeFileSync(join(dir, 'Mindburn.jpg'), 'old printing');
    writeFileSync(join(dir, 'Torrential-Reclamation.jpg'), 'tr');
    const reads: ScanReads = { readers: Object.fromEntries(SCAN_READERS.map(r => [r, {
      'Mindburn.jpg': scanHash(join(dir, 'Mindburn.jpg')),
      'Torrential-Reclamation.jpg': scanHash(join(dir, 'Torrential-Reclamation.jpg')),
    }])) };
    const cards = new Set(['Mindburn.jpg', 'Torrential-Reclamation.jpg', 'Seer-of-Empty-Spaces.jpg']);
    assert.deepEqual(staleScanReads(dir, reads, cards), [], 'the readers read exactly these files');

    writeFileSync(join(dir, 'Mindburn.jpg'), 'new printing');
    const stale = staleScanReads(dir, reads, cards);
    assert.equal(stale.length, SCAN_READERS.length, stale.join('\n'));
    for (const r of SCAN_READERS) {
      assert.ok(stale.some(l => l.startsWith('Mindburn (Mindburn.jpg)') && l.includes(`bot/pipeline/${r}.py`)), `${r} named:\n${stale.join('\n')}`);
    }
    assert.ok(!stale.some(l => l.includes('Torrential')), 'an unchanged scan is not named');

    writeFileSync(join(dir, 'Mindburn.jpg'), 'old printing');
    writeFileSync(join(dir, 'Seer-of-Empty-Spaces.jpg'), 'brand new card');
    writeFileSync(join(dir, 'Beyond-Codex-Incarnate.jpg'), 'a back face, no oracle row');
    assert.deepEqual(staleScanReads(dir, reads, cards), [
      'Seer of Empty Spaces (Seer-of-Empty-Spaces.jpg): no scan reader has read this scan — re-run all four (CLAUDE.md\'s generated table)',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
