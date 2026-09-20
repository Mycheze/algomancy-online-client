/* R214 — POOL SIGHT: how big the card pool is, and which files can see it.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────
 *
 * `allCardNames()` returns 495 cards — 492 printed + 3 synthetics — but only
 * if `src/apply.ts` has been imported. There are three `registerSynthetic`
 * calls in the engine and they are not all in the same place:
 *
 *     src/cards/registry.ts:384   Unit Token
 *     src/cards/registry.ts:433   Beyond, Codex Incarnate
 *     src/apply.ts:1830           Alluring Attribute        ← the odd one out
 *
 * `src/cards/registry.ts` is the natural card entry point and it is what a
 * pool-wide sweep reaches for. A file that imports it and nothing else gets
 * **494**, silently. Not one of the eight sweeps that did so asserted a pool
 * size, so eight clean sheets each covered one card fewer than they read as
 * covering, and `150-registration-order.test.ts` — the DETERMINISM test —
 * actively pinned `names.length === 494` as if that were the pool.
 *
 * ── WHAT IT COST, PER SWEEP ────────────────────────────────────────────
 *
 * Measured, by running each of the eight with the import widened:
 *
 *   63-card-art        WAS HIDING A FAILURE. `Alluring Attribute: (no image
 *                      field)`. Correct finding; now exempted with a predicate
 *                      (ART_EXEMPT) rather than by not looking.
 *   71-card-ledger     WAS HIDING TWO. The "no dead cards" ledger and the R155
 *                      inert-shape sweep both flag its `when: () => false`.
 *                      Now in NOT_A_GAP with the reason apply.ts already gave.
 *   68-target-conform. THE WORST ONE, and it failed nothing. `enemyUnit` is
 *                      declared by EXACTLY ONE card in the pool — this one —
 *                      so 68's KIND_PHRASES entry for it had zero live
 *                      subjects and had never once been exercised. Both
 *                      68's own comment ("R84 {Alluring} … prints this") and
 *                      apply.ts's ("its own `text` is the attribute written
 *                      out as rules text, which is what test/68's target
 *                      conformance reads the declared kind off") assert that
 *                      68 checks this card. Neither was true. It passes now.
 *   150-registration   Pinned the wrong number, and the wrong hash with it.
 *   52 / 88 / 109 /    Blind but unharmed: the card declares no glossary term,
 *   142                no replacement clause, no attribute channel and no
 *                      static, so their verdicts were right by luck rather
 *                      than by coverage. They carry the floor anyway — "right
 *                      by luck" is not a property you can keep.
 *
 * ── THE FIX, AND THE FIX THAT IS NOT HERE ──────────────────────────────
 *
 * Every sweep now imports `src/index.ts` (the engine's public API, which
 * re-exports from apply.ts) and asserts a floor, and this file holds the guard
 * that catches the ninth one. That stops the blindness RECURRING.
 *
 * It does not remove the trap. The structural fix is for `registry.ts` to own
 * all three registrations so the import graph stops mattering, and it looks
 * feasible: the Alluring block needs only `E` and `Entity` (registry.ts
 * already imports both as types) and `alluringColumn`, which apply.ts would
 * then import from registry.ts alongside the `DECK_LIST` it already imports —
 * no cycle. It is deal-safe too: `createGame` shuffles `DECK_LIST`, which
 * filters out every Token/Attribute face, so moving where the synthetic
 * registers cannot change a seeded deal. That change belongs to whoever owns
 * `src/apply.ts`; R214 deliberately did not make it from a shared tree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import '../src/index.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '..');
const APPLY = path.join(ENGINE, 'src', 'apply.ts');
const REGISTRY = path.join(ENGINE, 'src', 'cards', 'registry.ts');
const INDEX = path.join(ENGINE, 'src', 'index.ts');

/** the four synthetics, and the module each is registered by */
const SYNTHETICS: { name: string; module: string }[] = [
  { name: 'Unit Token', module: 'src/cards/registry.ts' },
  { name: 'Beyond, Codex Incarnate', module: 'src/cards/registry.ts' },
  // R297: Learn to Play's Tutorial Bot card, lessonOnly (never in a deal but a lesson's)
  { name: 'Training Construct', module: 'src/cards/registry.ts' },
  { name: 'Alluring Attribute', module: 'src/apply.ts' },
];

const POOL_FLOOR = 496;

// ── §1 · the pool itself ────────────────────────────────────────────────

test('§1 the pool is 496 — 492 printed plus 4 synthetics', () => {
  const names = allCardNames();
  assert.equal(names.length, POOL_FLOOR,
    `the pool is ${names.length}, not ${POOL_FLOOR}. If it is 494 this file has lost its `
    + 'apply.ts import; if it is something else a card was really added or removed and every '
    + 'floor in the eight sweeps needs raising in the same commit.');

  const printed = JSON.parse(fs.readFileSync(
    path.join(ENGINE, 'src', 'cards', 'printed.json'), 'utf8')) as Record<string, unknown>;
  const printedNames = Object.keys(printed);
  assert.equal(printedNames.length, 492,
    `printed.json holds ${printedNames.length} cards, not 492 — the split below no longer adds up`);

  // The arithmetic, asserted rather than asserted-about: printed ∪ synthetics
  // IS the pool, with nothing left over on either side. A fourth synthetic
  // registered anywhere fails here and is named.
  const synthetic = names.filter(n => !(n in printed)).sort();
  assert.deepEqual(synthetic, SYNTHETICS.map(s => s.name).sort(),
    'the set of cards that are registered but NOT in printed.json has changed. Every one of '
    + 'these is hand-written in code rather than extracted from the oracle file, so each needs '
    + 'a row in SYNTHETICS above saying which module registers it — that mapping is the whole '
    + 'subject of this file.');
  assert.equal(printedNames.length + SYNTHETICS.length, names.length, 'and none is registered twice');
});

test('§1 each synthetic is registered by the module this file says it is', () => {
  // The provenance is the load-bearing part — "there are three synthetics" was
  // never the problem, "the third is somewhere else" was. Read it off the
  // source so the table cannot drift from the code.
  for (const s of SYNTHETICS) {
    const src = fs.readFileSync(path.join(ENGINE, s.module), 'utf8');
    const re = new RegExp(String.raw`registerSynthetic\(\{[\s\S]{0,400}?name:\s*(?:'${
      s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'|[A-Z_]+_CARD)`);
    assert.match(src, re,
      `${s.module} no longer registers ${s.name}. If the registration MOVED, that is very likely `
      + 'the good news — see the header: registry.ts owning all three is the structural fix. '
      + 'Update this table and the header in the same commit.');
    assert.ok(allCardNames().includes(s.name), `${s.name} is not in the pool at all`);
  }

  // …and the count is pinned at the source too, so a FOURTH registerSynthetic
  // appearing in a third module is a failure here rather than a surprise later.
  const calls: string[] = [];
  for (const rel of ['src/apply.ts', 'src/engine.ts', 'src/cards/registry.ts', 'src/cards/dsl.ts']) {
    const src = fs.readFileSync(path.join(ENGINE, rel), 'utf8');
    for (const _ of src.matchAll(/^registerSynthetic\(/gm)) calls.push(rel);
  }
  assert.deepEqual(calls.sort(), ['src/apply.ts', 'src/cards/registry.ts', 'src/cards/registry.ts', 'src/cards/registry.ts'],
    'the top-level registerSynthetic calls in the engine have changed. Each one is a card that '
    + 'exists only if its module was imported, which is the trap this whole file is about.');
});

// ── §2 · the trap, executed ─────────────────────────────────────────────

/** run a throwaway module in a child process and return what it prints */
function probe(body: string): string {
  return execFileSync(process.execPath,
    ['--experimental-strip-types', '--input-type=module', '--eval', body],
    { cwd: ENGINE, encoding: 'utf8' }).trim();
}

test('§2 importing cards/registry.ts alone really does see 495, not 496', () => {
  // Not an argument about the import graph — the two processes, run for real.
  // This is the ground truth the static walker in §3 is checked against, and
  // it is the fact the eight sweeps were built on without knowing it.
  const viaRegistry = probe(
    `import '${REGISTRY}'; const { allCardNames } = await import('${path.join(ENGINE, 'src/cards/dsl.ts')}');`
    + 'console.log(allCardNames().length + " " + allCardNames().includes("Alluring Attribute"));');
  assert.equal(viaRegistry, '495 false',
    'importing src/cards/registry.ts alone no longer yields 495 without Alluring Attribute. If '
    + 'it now yields "496 true", the structural fix landed — registry.ts owns all three '
    + 'registrations, the trap is GONE, and this test should be retired along with the eight '
    + 'per-sweep floors. Say so explicitly rather than deleting it quietly.');

  const viaIndex = probe(
    `import '${INDEX}'; const { allCardNames } = await import('${path.join(ENGINE, 'src/cards/dsl.ts')}');`
    + 'console.log(allCardNames().length + " " + allCardNames().includes("Alluring Attribute"));');
  assert.equal(viaIndex, '496 true',
    'src/index.ts — the engine\'s public API and the entry point every pool sweep now uses — '
    + 'no longer pulls apply.ts. Every floor in the eight sweeps is about to fail.');
});

// ── §3 · the guard: no ninth blind sweep ────────────────────────────────

const BARE_IMPORT = /^\s*import\s+['"](\.[^'"]+)['"]/gm;
const FROM_IMPORT = /\sfrom\s+['"](\.[^'"]+)['"]/g;

/** Where a guard file may live. Tests moved out of engine/test on 2026-09-03:
 *  the ui-only ones to ui/test, the server-only ones to server/test. A bare
 *  filename is looked up in all three, so a ledger row written before the
 *  move still resolves and a row written after it need not say which. */
const TEST_DIRS = [HERE, path.resolve(HERE, '..', '..', 'ui', 'test'), path.resolve(HERE, '..', '..', 'server', 'test')];
const testFile = (f: string): string => TEST_DIRS.map(d => path.join(d, f)).find(p => fs.existsSync(p)) ?? path.join(HERE, f);

const importCache = new Map<string, string[]>();

/** the relative imports of one file, resolved to absolute paths.
 *
 * TWO patterns, not one. A single regex with an optional `… from` clause is
 * wrong in a way that is easy to miss and cost this round an hour: the lazy
 * `from` scan runs past the end of a BARE side-effect import onto the next
 * line's `from`, swallowing exactly the `import '../src/index.ts';` lines this
 * guard exists to find. Bare imports are matched line-anchored, on their own.
 */
function importsOf(file: string): string[] {
  const hit = importCache.get(file);
  if (hit) return hit;
  let src = '';
  try { src = fs.readFileSync(file, 'utf8'); } catch { /* not a file we own */ }
  const out: string[] = [];
  for (const m of [...src.matchAll(BARE_IMPORT), ...src.matchAll(FROM_IMPORT)]) {
    const p = path.resolve(path.dirname(file), m[1]!);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) out.push(p);
  }
  importCache.set(file, out);
  return out;
}

/** does `start`'s STATIC import closure reach `target`? */
function reaches(start: string, target: string): boolean {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === target) return true;
    for (const next of importsOf(cur)) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return false;
}

/**
 * The one pool-touching test file that is BLIND ON PURPOSE, with the reason
 * re-checked rather than believed.
 *
 * `161-glimpse-reminders.test.ts` (R209) is the only file in the suite
 * that already knew about the 494/495 split: it pins `POOL === 494` and its
 * comment names all three `registerSynthetic` sites. Its subject is the eleven
 * cards whose printed text says "Glimpse", and its argument for not caring is
 * that no synthetic is one of them — which is a fact about the pool, so it is
 * asserted here instead of taken on the comment's word.
 */
const BLIND_ON_PURPOSE: { file: string; why: string; harmless: () => string | null }[] = [
  {
    file: '161-glimpse-reminders.test.ts',
    why: 'R209 pins POOL === 494 deliberately and says why in a comment that names all three '
       + 'registerSynthetic sites. Its derivation filters the pool for printed "Glimpse", and '
       + 'the card it cannot see prints no such word, so 494 and 495 give the same eleven.',
    harmless: () => {
      const unseen = SYNTHETICS.filter(s => s.module === 'src/apply.ts');
      const glimpsing = unseen.filter(s => /Glimpse/i.test(getCard(s.name).text ?? ''));
      return glimpsing.length
        ? `${glimpsing.map(s => s.name).join(', ')} now prints "Glimpse", so 161's derived list `
          + 'is short by that many and its 494 pin is hiding it'
        : null;
    },
  },
];

test('§3 every test file that sweeps the card pool can see all of it', () => {
  // A ninth sweep is one `import '../src/cards/registry.ts'` away, and nothing
  // about writing it feels like a decision. This is the assertion that makes
  // it one.
  const files = fs.readdirSync(path.join(HERE)).filter(f => f.endsWith('.test.ts')).sort();
  assert.ok(files.length > 150, `only ${files.length} test files found — the scan has gone blind`);

  const exempt = new Map(BLIND_ON_PURPOSE.map(e => [e.file, e]));
  const sweeps: string[] = [];
  const blind: string[] = [];
  for (const f of files) {
    const abs = path.join(HERE, f);
    if (!/allCardNames\s*\(/.test(fs.readFileSync(abs, 'utf8'))) continue;
    sweeps.push(f);
    if (exempt.has(f)) continue;
    if (!reaches(abs, APPLY)) {
      blind.push(`${f} — asks allCardNames() but its imports never reach src/apply.ts, so it `
        + 'sees 494 of 495 cards');
    }
  }

  assert.ok(sweeps.length >= 25,
    `only ${sweeps.length} test files call allCardNames() — the scan has gone blind, and a `
    + 'guard over an empty set is worse than no guard');

  assert.deepEqual(blind, [],
    'these test files ask the registry for the whole card pool and are shown 494 of 495:\n  '
    + blind.join('\n  ')
    + '\n\nImport `../src/index.ts` (the public API — it pulls apply.ts and therefore the third '
    + 'synthetic) and add the pool floor the other sweeps carry. If the file genuinely does not '
    + 'care, put it in BLIND_ON_PURPOSE above WITH A PREDICATE that re-checks why not — a '
    + 'sentence is what let this happen the first time.');
});

test('§3 every BLIND_ON_PURPOSE entry still names a file, and its reason still holds', () => {
  // CT-83's shape, applied to this file's own exemption list on the day it was
  // written rather than the round after somebody notices.
  const stale: string[] = [];
  for (const e of BLIND_ON_PURPOSE) {
    const abs = testFile(e.file);
    if (!fs.existsSync(abs)) {
      stale.push(`${e.file} does not exist any more — delete the entry. (Was: ${e.why})`);
      continue;
    }
    if (reaches(abs, APPLY)) {
      stale.push(`${e.file} reaches src/apply.ts now, so it sees the whole pool and needs no `
        + `exemption — delete the entry. (Was: ${e.why})`);
      continue;
    }
    const broke = e.harmless();
    if (broke) stale.push(`${e.file}: ${broke}`);
  }
  assert.deepEqual(stale, [], 'blind-on-purpose entries that have outlived their reason:\n  '
    + stale.join('\n  '));
});

// ── §4 · positive controls ──────────────────────────────────────────────

test('§4 the import walker finds a blind file, a sighted one, and a bare import', () => {
  // §3's whole verdict rests on `reaches`, and the honest question about any
  // "nothing is blind" answer is whether it could still say that if the walker
  // were broken. Three cases over a synthetic corpus, all three of which the
  // FIRST version of this walker got wrong: it used one regex with an optional
  // `from` clause, whose lazy scan ran past a bare side-effect import onto the
  // next line — so `import '../src/index.ts';` was invisible and all eight
  // freshly-fixed sweeps still read as blind.
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'poolsight-'));
  try {
    const write = (name: string, body: string): string => {
      const p = path.join(dir, name);
      fs.writeFileSync(p, body);
      return p;
    };
    const target = write('target.ts', 'export const x = 1;\n');
    write('mid.ts', `export { x } from './target.ts';\n`);

    const bare = write('bare.ts', `import './mid.ts';\nimport { y } from './other.ts';\n`);
    const named = write('named.ts', `import { x } from './mid.ts';\n`);
    const neither = write('neither.ts', `import { z } from './target-ish.ts';\n// './mid.ts'\n`);

    importCache.clear();
    assert.ok(reaches(bare, target),
      'a BARE side-effect import followed by another import line is invisible to the walker — '
      + 'this is the exact bug, and it makes every fixed sweep read as still broken');
    assert.ok(reaches(named, target), 'a named import through a re-export is not followed');
    assert.ok(!reaches(neither, target),
      'the walker follows a path that is only mentioned in a comment — it would acquit a '
      + 'genuinely blind sweep');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    importCache.clear();
  }
});

test('§4 the pool floor the eight sweeps carry can actually fail', () => {
  // The floor is `allCardNames().length >= 496`. Proving it can go red means
  // proving it is evaluated against a pool that CAN be 495 (R297 put a fourth
  // synthetic in registry.ts, so a blind sweep now sees 495, not 494) — which §2 already
  // showed is one import line away. Here it is as the assertion itself, run
  // against the number a blind sweep really sees.
  const blindPool = 495;
  assert.throws(
    () => assert.ok(blindPool >= POOL_FLOOR,
      `this sweep sees ${blindPool} cards, not the full ${POOL_FLOOR}`),
    /sees 495 cards, not the full 496/,
    'the floor does not fail on the number a registry-only sweep really reports');

  // and it does NOT fire on the number a sighted one reports
  assert.doesNotThrow(() => assert.ok(allCardNames().length >= POOL_FLOOR));
});

test('§4 every one of the eight fixed sweeps carries the floor', () => {
  // The floors are eight copies of the same three lines in eight files, which
  // is exactly the shape that survives in seven of them after somebody tidies
  // the eighth. Named here so that deletion is a failure.
  const FIXED = [
    '52-ui-glossary.test.ts', '63-card-art.test.ts', '68-target-conformance.test.ts',
    '71-card-ledger.test.ts', '88-replacement-conformance.test.ts',
    '109-attr-channel-conformance.test.ts', '142-static-conformance.test.ts',
    '150-registration-order.test.ts',
  ];
  const missing: string[] = [];
  for (const f of FIXED) {
    const abs = testFile(f);
    assert.ok(fs.existsSync(abs), `${f} is gone — R214's eight sweeps have been renamed`);
    const src = fs.readFileSync(abs, 'utf8');
    const floored = /allCardNames\(\)\.length,?\s*(?:>=\s*496|496)/.test(src)
      || /n >= 496/.test(src) || /names\.length, 496/.test(src);
    if (!floored) missing.push(`${f} no longer asserts a pool size of 496`);
  }
  assert.deepEqual(missing, [],
    'a pool-size floor has been removed:\n  ' + missing.join('\n  ')
    + '\n\nThat sweep is now free to go back to covering 494 cards while reading as though it '
    + 'covers the pool, which is the state R214 found all eight of them in.');
});
