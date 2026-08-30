/* R213 / CARD-TODO #82(a) — FOUR PATHS REACH `endBattleRound`, NOT ONE, AND
 * R194 IS CLASS-COMPLETE BY LUCK RATHER THAN BY DESIGN.
 *
 * R194 put the token-loss announcement on the way into Regroup. It reaches
 * every path — but nothing in the repository SAYS every path, and the count
 * everyone was working from was one. CT-82(a) found four:
 *
 *   apply.ts                    a player DECLINES the counterattack
 *   engine.ts (advanceBattleStep)   the ordinary close of `afterWindow`
 *   engine.ts (endBattleRound)  the RECURSIVE call: round 2 opened and the
 *                               defender had sent nobody, so it ends at once
 *   batch-hybrids-wm-b.ts       Temporal Rift — a CARD ending the battle
 *                               mid-resolution
 *
 * The reason R194 is nonetheless correct is that all four funnel through
 * `startRegroup`, which is where the announcement lives. That is a real
 * invariant and it was nobody's stated intention — so this file states it, and
 * fails if a fifth caller appears that does not hold it.
 *
 * ── WHY THE CALLER LIST IS DERIVED AND NOT TYPED ──────────────────────
 *
 * docs/13-assessment.md §7.2: *"a new guard's card list is COMPUTED from
 * printed data, not typed from the cards in the report."* The same rule
 * applies to a call-site list. CT-82(a)'s own four line numbers were ALL WRONG
 * by the time anybody read them (the ticket said apply.ts:1516, engine.ts:9140,
 * engine.ts:10234, batch-hybrids-wm-b.ts:309; they are :1541, :9563, :10749 and
 * :316). A guard that pinned those numbers would have been wrong on arrival.
 * So §1 scans the source and §2 asserts what the scan found, by FILE and by
 * REASON — never by line.
 *
 * ── THE HALF THAT IS A REAL DEFECT ────────────────────────────────────
 *
 * `passEndsBattlePhase` (ui/battle.ts) is the client's "passing now will erase
 * your spell tokens" warning, and its doc comment enumerates the transitions
 * that end a battle. It covers three of the four. It CANNOT cover Temporal
 * Rift, because a card ending the battle mid-resolution is not predictable
 * from the state at the moment priority is passed — and the comment did not
 * say so, which made a documented invariant false. §3 pins the true scope.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCode } from './card-todo.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/** The card set files, listed FROM DISK rather than typed — so a fifth caller
 *  arriving in a new batch file is caught on the day it lands. */
function setFiles(): string[] {
  return readdirSync(join(ROOT, 'src/cards/sets'))
    .filter(f => f.endsWith('.ts'))
    .map(f => `src/cards/sets/${f}`);
}

/** A CALL to endBattleRound(), with comments and strings blanked out first so
 *  the nine prose mentions in batch-hybrids-wm-b's header do not count. */
function callSites(rel: string): number {
  const code = stripCode(read(rel));
  return (code.match(/\bendBattleRound\s*\(/g) ?? []).length;
}

/* ══ §1 · THE SCAN CAN SEE ═════════════════════════════════════════════ */

test('R213 §1: the call-site scan is not reading an empty population', () => {
  // The positive control docs/13 §7.4 asks for. A scan that matches nothing
  // reports "one caller" just as cheerfully as a correct one does.
  const decl = stripCode(read('src/engine.ts'));
  assert.match(decl, /\bendBattleRound\s*\(\)\s*:\s*void\s*\{/,
    'endBattleRound is declared in engine.ts — if this fails the scan is looking at the wrong file');
  assert.ok(callSites('src/engine.ts') >= 2,
    'engine.ts must show at least the declaration and one call; the matcher is broken otherwise');
});

test('R213 §1: stripCode really is blanking the prose mentions', () => {
  // batch-hybrids-wm-b.ts names endBattleRound five times in its header
  // comment and calls it ONCE. If stripCode ever goes blind again (it has,
  // three times — R201), this file would report six callers in one card.
  const raw = read('src/cards/sets/batch-hybrids-wm-b.ts');
  const rawMentions = (raw.match(/\bendBattleRound\b/g) ?? []).length;
  assert.ok(rawMentions > 1, 'the header comment mentions it more than once — that is the point');
  assert.equal(callSites('src/cards/sets/batch-hybrids-wm-b.ts'), 1,
    `stripCode must reduce ${rawMentions} raw mentions to the ONE real call — see R201`);
});

/* ══ §2 · FOUR PATHS, DERIVED, EACH WITH ITS REASON ═══════════════════ */

/** Why each caller exists. The KEY is a file; the VALUE is what that call
 *  means. A new entry here is a deliberate act; a new caller without one
 *  fails §2. */
const KNOWN_CALLERS: Record<string, string> = {
  'src/apply.ts':
    'a player DECLINES the counterattack, so the round ends without a battle',
  'src/engine.ts':
    'the ordinary close of `afterWindow`, PLUS the recursive call when round 2 '
    + 'opens to a defender who sent no counterattackers',
  'src/cards/sets/batch-hybrids-wm-b.ts':
    'Temporal Rift — a CARD ending the battle mid-resolution. The only caller '
    + 'that is not the engine deciding, and the one passEndsBattlePhase cannot see',
};

test('R213 §2: exactly four call sites reach endBattleRound, in exactly three files', () => {
  const found = new Map<string, number>();
  for (const rel of ['src/apply.ts', 'src/engine.ts', ...setFiles()]) {
    const n = callSites(rel);
    // engine.ts's count includes the declaration itself
    const calls = rel === 'src/engine.ts' ? n - 1 : n;
    if (calls > 0) found.set(rel, calls);
  }

  assert.deepEqual([...found.keys()].sort(), Object.keys(KNOWN_CALLERS).sort(),
    'the set of files calling endBattleRound has changed. If that is deliberate, add the new '
    + 'file to KNOWN_CALLERS with the REASON it ends a battle — and check §3, because a caller '
    + 'the client cannot predict is a hole in the token-loss warning');

  const total = [...found.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, 4,
    `CT-82(a) counted four paths into Regroup; this run found ${total} `
    + `(${[...found].map(([f, n]) => `${f}×${n}`).join(', ')})`);
});

test('R213 §2: every path funnels through startRegroup — which is WHY R194 is class-complete', () => {
  // This is the invariant nobody had written down. R194's token-loss
  // announcement lives in startRegroup; it reaches all four callers only
  // because endBattleRound's every exit leads there. Assert the structure,
  // not the line: round 1 recurses (and the recursion lands in the else), and
  // the else branch calls startRegroup unconditionally.
  const code = stripCode(read('src/engine.ts'));
  const body = /endBattleRound\s*\(\)\s*:\s*void\s*\{([\s\S]*?)\n  \}/.exec(code);
  assert.ok(body, 'could not isolate endBattleRound — the scan, not the engine, is what failed');
  const b = body[1]!;
  assert.match(b, /\bthis\.startRegroup\s*\(\)/,
    'endBattleRound must reach startRegroup, or R194 announces nothing on this path');
  assert.match(b, /\bthis\.endBattleRound\s*\(\)/,
    'the round-1 recursion is one of the four paths — CT-82(a) named it and it must stay named');
  // there is no other exit: no return before the branch
  assert.doesNotMatch(b.split('if (this.s.battleRound === 1)')[0] ?? '', /\breturn\b/,
    'an early return would give endBattleRound a fifth path that never reaches Regroup, and '
    + 'the token-loss announcement would silently stop firing on it');
});

/* ══ §3 · THE DEFECT: passEndsBattlePhase COVERS THREE OF FOUR ═════════ */

test('R213 §3: passEndsBattlePhase names Temporal Rift as the path it cannot predict', () => {
  // CT-82(a): "passEndsBattlePhase covers 10234 but NOT Temporal Rift, and its
  // documented invariant is false for it." The function is CORRECT — a card
  // ending the battle mid-resolution genuinely cannot be predicted from the
  // state at pass time. What was wrong was the comment, which enumerated the
  // transitions as if they were all of them.
  const doc = read('ui/battle.ts');
  assert.match(doc, /Temporal Rift/,
    'ui/battle.ts enumerates every transition that ends a battle. A CARD is one of them, and '
    + 'leaving it out makes a documented invariant false — which is how CT-82(a) was filed');
  assert.match(doc, /mid-resolution|cannot be predicted|cannot see/,
    'the comment must say WHY the card path is excluded, not merely mention the card — an '
    + 'unexplained exception reads as an oversight and gets "fixed" by the next reader');
});
