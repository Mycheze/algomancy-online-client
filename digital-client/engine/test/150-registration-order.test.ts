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
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import '../src/cards/registry.ts';
import { allCardNames } from '../src/cards/dsl.ts';

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
  assert.equal(names.length, 494, `the pool is ${names.length} cards, not 494`);

  const fingerprint = createHash('sha256').update(names.join('\n')).digest('hex').slice(0, 16);
  assert.equal(fingerprint, '96e1ffbb40fdc926',
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
