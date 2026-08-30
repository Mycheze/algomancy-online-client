/* R177 — card REGISTRATION ORDER is part of the game's determinism.
 *
 * WHAT HAPPENED (2026-08-25). R166 factored `doubleStats` out of
 * `batch-wood-a.ts` so Burgeon and Surly Stalker could share it — the right
 * call, they print the same verb — and `batch-water-b.ts` imported it from
 * there. `sets/index.ts` loads water-b tenth and wood-a much later, so the
 * import PULLED WOOD-A'S MODULE EVALUATION FORWARD. Its sixteen `card()` calls
 * ran early, `allCardNames()` came back in a different order, and every seeded
 * deal in the game changed.
 *
 *     saved game SMVJ: 166 replayable actions -> 65
 *     opening hand at the same seed: completely different from card 3 on
 *
 * Nothing failed. The pool was still exactly 494 cards, `tsc` was clean, and
 * the full suite was green at 2,485 assertions — because every test either
 * spawns cards BY NAME or uses a seed whose deal it does not assert. The only
 * thing that noticed was the end-of-round replay check, and only because it
 * diffs against a pre-round baseline rather than reading a verdict.
 *
 * WHY IT MATTERS BEYOND ONE HELPER. `createGame(seed, …)` deals off the
 * registry, so registration order is an input to every seeded game the same way
 * the seed is. Change it and you invalidate the whole saved-game corpus — which
 * is this repo's primary forensic evidence (CARD-TODO #51) — silently, from an
 * edit that looks like a refactor.
 *
 * THE FIX was structural, not a revert: `doubleStats` moved to `helpers.ts`,
 * which registers no cards. Anything shared between batches belongs there.
 *
 * These tests fail on the CAUSE (a batch importing a later batch) and on the
 * EFFECT (the order itself moving), because either alone is escapable.
 *
 * ── R214 (2026-08-26): THIS FILE WAS PINNING THE WRONG POOL. ───────────
 *
 * It imported `src/cards/registry.ts` alone and asserted `names.length ===
 * 494`. There are THREE `registerSynthetic` calls in the engine and only two
 * of them are in registry.ts; the third — `Alluring Attribute` — is in
 * `src/apply.ts`, so a file that imports the natural card entry point and
 * nothing else sees 494 of 495 cards. The determinism test was pinning a
 * fingerprint over a pool the game never runs with.
 *
 * The import is now `../src/index.ts` — the engine's public API, which pulls
 * `apply.ts` and therefore the whole pool. Eight pool-wide sweeps had the same
 * blindness; `test/180-pool-sight.test.ts` holds the shared floor and the
 * guard that stops a ninth appearing.
 *
 * WHY THIS WAS SAFE TO CHANGE, which is the part that is more than a number.
 * `apply.ts` imports `registry.ts`, so registry's 494 cards are all registered
 * BEFORE apply's module body runs: `Alluring Attribute` is APPENDED at index
 * 494 and nothing reorders. Measured, not assumed — sha256 over the first 494
 * names is still `96e1ffbb40fdc926`, byte-for-byte the hash this file pinned
 * before R214, and the test below re-asserts that on every run. So NO SEEDED
 * DEAL CHANGED and the saved-game corpus is untouched; only the pinned total
 * and the whole-pool hash move.
 *
 * And because "the pool hash" was only ever a proxy for what `createGame`
 * actually deals from, `DECK_LIST` is now pinned directly beside it. A
 * synthetic can join or leave the pool without touching a single deal (they
 * are all filtered out by type), and the two pins now say which of those two
 * things happened instead of leaving it to be worked out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
// R214: the PUBLIC entry point, not `cards/registry.ts` — registry alone is
// 494 of 495 cards. See the header above and test/180-pool-sight.test.ts.
import '../src/index.ts';
import { allCardNames } from '../src/cards/dsl.ts';
import { DECK_LIST } from '../src/cards/registry.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SETS = path.resolve(HERE, '..', 'src', 'cards', 'sets');

/** the batch files, in the order sets/index.ts evaluates them */
const loadOrder = (): string[] => {
  const idx = fs.readFileSync(path.join(SETS, 'index.ts'), 'utf8');
  return [...idx.matchAll(/^import '\.\/(batch-[\w-]+)\.ts';/gm)].map(m => m[1]!);
};

test('no card batch imports a batch that index.ts loads LATER', () => {
  // The exact shape of the R177 bug. An import of an EARLIER batch is
  // harmless today (its cards are already registered by then) but is listed
  // with its reason so the coupling stays visible; an import of a LATER batch
  // reorders the registry and is always wrong.
  const order = loadOrder();
  assert.ok(order.length > 20, `only ${order.length} batches found — the index parse has broken`);
  const pos = new Map(order.map((b, i) => [b, i]));

  const early: string[] = [];
  const late: string[] = [];
  for (const [i, batch] of order.entries()) {
    const src = fs.readFileSync(path.join(SETS, `${batch}.ts`), 'utf8');
    for (const m of src.matchAll(/from '\.\/(batch-[\w-]+)\.ts'/g)) {
      const target = m[1]!;
      const j = pos.get(target);
      if (j === undefined) continue;
      (j < i ? early : late).push(`${batch} imports ${target} (loaded ${j < i ? 'earlier' : 'LATER'})`);
    }
  }

  assert.deepEqual(late, [],
    'a card batch is importing a batch that loads AFTER it. That pulls the later batch\'s '
    + 'module evaluation forward, so its card() calls register early, allCardNames() reorders, '
    + 'and EVERY SEEDED DEAL IN THE GAME CHANGES — silently, with the pool still the right size '
    + 'and the suite still green. Put the shared code in helpers.ts, which registers no cards.\n  '
    + late.join('\n  '));

  // Not a failure, but it is the coupling that produced the failure, so it is
  // held to a known list rather than left to grow.
  assert.deepEqual(early, ['batch-water-b imports batch-water-a (loaded earlier)'],
    'the set of batch-to-batch imports changed. These are safe only because the target loads '
    + 'first, which makes them hostage to the order in index.ts. If you are adding one, prefer '
    + 'helpers.ts; if you are removing one, update this list.\n  ' + early.join('\n  '));
});

test('the registration order of the whole pool is unchanged', () => {
  // The effect, pinned directly — because the import rule above is not the only
  // way to reorder a registry, and this is the property that actually matters.
  const names = allCardNames();
  assert.equal(names.length, 495,
    `the pool is ${names.length} cards, not 495 (492 printed + 3 synthetics: Unit Token and `
    + 'Beyond, Codex Incarnate from cards/registry.ts, Alluring Attribute from apply.ts). '
    + 'If this reads 494 the import at the top of this file has been narrowed back to '
    + 'cards/registry.ts and the pool has gone half-visible — see R214.');

  // R214 — the APPEND-NOT-REORDER invariant, asserted rather than remembered.
  // apply.ts imports registry.ts, so every registry card is registered before
  // apply's synthetic is. If that ever stops holding, the 495-hash below moves
  // AND this fails, which is what tells the two apart: a hash change with this
  // still green is a card added at the end (no deal changes); a hash change
  // with this red is a genuine reorder (every deal changes).
  const first494 = createHash('sha256').update(names.slice(0, 494).join('\n')).digest('hex').slice(0, 16);
  assert.equal(first494, '96e1ffbb40fdc926',
    'THE FIRST 494 REGISTRATIONS HAVE MOVED. This hash predates R214 and is the one this file '
    + 'pinned when it could only see cards/registry.ts, so it is the direct evidence that '
    + 'widening the import in R214 appended a card rather than reordering the pool. It failing '
    + 'means a REAL reorder, not a synthetic arriving late.');

  const fingerprint = createHash('sha256').update(names.join('\n')).digest('hex').slice(0, 16);
  assert.equal(fingerprint, '56c28b04d213f284',
    'THE CARD REGISTRATION ORDER HAS CHANGED, and that is an input to every seeded game exactly '
    + 'as the seed is. Every saved game in server/games/ now deals differently and replays '
    + 'against a board it never had; the saved-game corpus is this repo\'s primary forensic '
    + 'evidence (CARD-TODO #51).\n\n'
    + 'If this was ACCIDENTAL — almost always a batch file importing another batch file — fix '
    + 'the import and the order comes back on its own.\n\n'
    + 'If it was DELIBERATE (a card really was added or removed), update this hash IN THE SAME '
    + 'COMMIT and say so in the message, because every replay-based conclusion drawn before it '
    + 'is void.');
});

test('R214: the DEAL LIST — what createGame actually shuffles — is unchanged', () => {
  // The pool hash above was always a PROXY. `createGame` deals off `DECK_LIST`
  // and `draftDeckList`, never off `allCardNames()`, and DECK_LIST filters out
  // every Token and Resource face — so all three synthetics are absent from it
  // by construction. That is why R214 could add a card to the pool without
  // moving a single deal, and pinning the proxy alone could not have said so.
  //
  // Pin the thing itself. A change HERE is a genuine deal change; a change to
  // the pool hash above with this still green is not.
  assert.equal(DECK_LIST.length, 483, `the deal list is ${DECK_LIST.length} cards, not 483`);
  for (const synthetic of ['Unit Token', 'Beyond, Codex Incarnate', 'Alluring Attribute']) {
    assert.ok(allCardNames().includes(synthetic), `${synthetic} is not registered at all`);
    assert.ok(!DECK_LIST.includes(synthetic),
      `${synthetic} has leaked into DECK_LIST — a synthetic in the deal list changes every seeded `
      + 'game and puts an unplayable card in hands');
  }

  const fingerprint = createHash('sha256').update(DECK_LIST.join('\n')).digest('hex').slice(0, 16);
  assert.equal(fingerprint, '8aa69af98fafda61',
    'THE DEAL LIST HAS CHANGED. Unlike the pool hash above this is not a proxy: every saved game '
    + 'in server/games/ now deals differently. Same rules as the pool hash — if a batch file is '
    + 'importing another batch file, fix that and it comes back; if a DECK card really was added '
    + 'or removed, update this hash in the same commit and say so, because every replay-based '
    + 'conclusion drawn before it is void.');
});

test('every batch listed in index.ts exists, and every batch file is listed', () => {
  // A batch that exists but is not imported registers nothing, and its cards
  // are simply absent from the game — the failure the fingerprint above would
  // report as a count change without saying why.
  const listed = new Set(loadOrder());
  const onDisk = new Set(fs.readdirSync(SETS)
    .filter(f => /^batch-[\w-]+\.ts$/.test(f))
    .map(f => f.replace(/\.ts$/, '')));

  const missing = [...listed].filter(b => !onDisk.has(b));
  const unlisted = [...onDisk].filter(b => !listed.has(b));
  assert.deepEqual(missing, [], `index.ts imports a batch file that does not exist: ${missing}`);
  assert.deepEqual(unlisted, [],
    `these batch files exist but nothing imports them, so their cards are not in the game: ${unlisted}`);
});
