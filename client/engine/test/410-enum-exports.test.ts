/**
 * The turn-structure unions, exported as runtime arrays (types.ts: PHASES,
 * BATTLE_STEPS, DAMAGE_SUBSTEPS, DECISION_KINDS, ZONES).
 *
 * WHY THEY EXIST. A TS union is erased at runtime, so the comprehensive-rules
 * export (data/comprehensive-rules/) cannot ask the engine "what are the
 * phases?" — and a document that copies the list by hand goes stale the day
 * the engine grows a member. The arrays are that list; nothing in the engine
 * reads them, so adding them changed no behaviour.
 *
 * WHAT IS PROVEN WHERE.
 *  · types.ts `EnumArraysAreExhaustive` (compile time): array ⊆ union by
 *    `satisfies`, union ⊆ array by `Exhaustive<Exclude<…>>`. A union member
 *    with no array entry is a TYPE ERROR, so `npm run typecheck` is the guard
 *    for that direction, not this file.
 *  · here, §1: what the compiler cannot see — an empty array, a duplicate.
 *  · here, §2: each value is really USED by the engine where it should be, so
 *    a member that the engine stopped producing is noticed (cheap source
 *    reads, comments stripped).
 *  · here, §3 (compile time): the zone movers in engine.ts accept only ZONES,
 *    once their two non-zone origins ('sandbox', 'effect') are set aside.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  BATTLE_STEPS, DAMAGE_SUBSTEPS, DECISION_KINDS, PHASES, ZONES,
  type EnumArraysAreExhaustive, type Zone,
} from '../src/types.ts';
import type { E } from '../src/engine.ts';

const ARRAYS: Record<string, readonly string[]> = {
  PHASES, BATTLE_STEPS, DAMAGE_SUBSTEPS, DECISION_KINDS, ZONES,
};

/** engine source with comments removed, so a value mentioned only in prose
 *  does not count as used */
function code(rel: string): string {
  return readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}
const ENGINE = code('engine.ts');
const APPLY = code('apply.ts');
/** every source file under src/, comments removed — a decision can be raised
 *  by a card's own effect (Prediction Prophet raises the only 'number') */
const ALL_SRC = (readdirSync(new URL('../src/', import.meta.url), { recursive: true }) as string[])
  .filter(f => f.endsWith('.ts')).map(code).join('\n');

/* ══ §1 · THE ARRAYS ARE WELL-FORMED ══════════════════════════════════ */

test('§1 every enum array is non-empty and duplicate-free', () => {
  for (const [name, arr] of Object.entries(ARRAYS)) {
    assert.ok(arr.length > 0, `${name} is empty`);
    assert.equal(new Set(arr).size, arr.length, `${name} has a duplicate: ${arr.join(', ')}`);
  }
});

test('§1 the compile-time proof is wired: one row per checked union or zone field', () => {
  // Referencing the tuple keeps it from being an orphan export, and pins its
  // width: a row deleted from types.ts is a guard deleted, and lands here.
  const rows: EnumArraysAreExhaustive['length'] = 7;
  assert.equal(rows, 7);
});

/* ══ §2 · THE ENGINE REALLY USES EACH VALUE ════════════════════════════ */

test('§2 every PHASE is entered somewhere: `phase = \'<p>\'` in engine.ts', () => {
  const missing = PHASES.filter(p => !new RegExp(`\\.phase = '${p}'`).test(ENGINE));
  assert.deepEqual(missing, [], `phases the engine never enters: ${missing.join(', ')}`);
});

test('§2 every BATTLE_STEP is spelled as a literal in engine.ts or apply.ts', () => {
  const missing = BATTLE_STEPS.filter(s => !ENGINE.includes(`'${s}'`) && !APPLY.includes(`'${s}'`));
  assert.deepEqual(missing, [], `battle steps the engine never names: ${missing.join(', ')}`);
});

test('§2 every runtime sub-step list in engine.ts is DAMAGE_SUBSTEPS, in the same order', () => {
  // The engine keeps its own `['Swift', 'normal', 'Sluggish'] as const` lists
  // (subStepsWithStrikes, the R295 split check, the R320 strike filter). They
  // were left in place — replacing them would be an engine change — so this
  // is what keeps them and the export from disagreeing about the order.
  const lists = [...ENGINE.matchAll(/\[\s*('(?:Swift|normal|Sluggish)'(?:\s*,\s*'[A-Za-z]+')*)\s*\]\s*as const/g)]
    .map(m => m[1]!.split(',').map(x => x.trim().replace(/'/g, '')));
  assert.ok(lists.length >= 3, `found only ${lists.length} sub-step lists in engine.ts — the read has gone blind`);
  for (const l of lists) assert.deepEqual(l, [...DAMAGE_SUBSTEPS]);
});

test('§2 every DECISION_KIND is raised: `kind: \'<k>\'` somewhere in src/', () => {
  const missing = DECISION_KINDS.filter(k => !ALL_SRC.includes(`kind: '${k}'`));
  assert.deepEqual(missing, [], `decision kinds nothing raises: ${missing.join(', ')}`);
});

test('§2 ZONES holds places, not origins: no "sandbox", no "effect"', () => {
  for (const notAZone of ['sandbox', 'effect']) {
    assert.ok(!(ZONES as readonly string[]).includes(notAZone), `${notAZone} is an origin with no pile`);
  }
});

/* ══ §3 · THE MOVERS NAME ONLY ZONES (compile time) ═════════════════════ */

type Exhaustive<T extends never> = T;
type NotAZone = 'sandbox' | 'effect';
type MoverRows = [
  Exhaustive<Exclude<Parameters<E['toHand']>[2], Zone | NotAZone>>,
  Exhaustive<Exclude<Parameters<E['toBin']>[2], Zone | NotAZone>>,
  Exhaustive<Exclude<Parameters<E['noteTrashed']>[2], Zone>>,
  Exhaustive<Exclude<Parameters<E['cacheCard']>[2], Zone | NotAZone>>,
  Exhaustive<Exclude<Parameters<E['eraseFromZone']>[2], Zone>>,
  Exhaustive<Exclude<NonNullable<NonNullable<Parameters<E['spawnUnit']>[3]>['from']>, Zone>>,
];

test('§3 the engine.ts movers accept only ZONES (checked by tsc; this pins the row count)', () => {
  const rows: MoverRows['length'] = 6;
  assert.equal(rows, 6);
});
