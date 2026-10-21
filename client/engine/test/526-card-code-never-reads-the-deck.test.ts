/* CR 408.2b — NO CARD READS THE DECK ITSELF (report #268, CT-312).
 *
 * The owner, 2026-10-21: "So ANYTHING that uses the deck should be able to
 * trigger the reshuffle." The recycle pile sits under the deck past a mark,
 * and the only code that knows how to cross it is the engine's
 * `refillFromRecycled`, reached through `draw`, `mill`, `cacheTopOfDeck`,
 * `glimpse`, and — for card code — `revealTop` / `takeTop`.
 *
 * Report #268 happened because two cards (Tides of the Cosmos, Big Glimpse
 * Card) sliced `g.deckOf(…)` themselves and never reached the pile. This
 * sweep is over the SOURCE TREE, not a list of cards: any file under
 * engine/src/cards that touches a deck or pile backing field directly is
 * convicted, so the next card written that way reddens here instead of in a
 * player's game. Writers that go past the mark (`recycleToBottom`) are fine
 * and are not matched.
 *
 * ALLOWED — none. Add a file here only with the reason it cannot use the
 * engine's primitives.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = path.join(HERE, '..', 'src', 'cards');
const ALLOWED: Record<string, string> = {};

function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsFiles(p);
    return e.name.endsWith('.ts') ? [p] : [];
  }).sort();
}

/** CODE only: comments and string/template literals blanked, line numbers kept */
function codeLines(src: string): string[] {
  const out: string[] = [];
  let block = false;
  for (const raw of src.split('\n')) {
    let res = '';
    for (let i = 0; i < raw.length; i++) {
      if (block) { if (raw.startsWith('*/', i)) { block = false; i++; } continue; }
      if (raw.startsWith('/*', i)) { block = true; i++; continue; }
      if (raw.startsWith('//', i)) break;
      res += raw[i];
    }
    out.push(res.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, "''"));
  }
  return out;
}

/** every direct way at a deck or a recycle pile */
const DIRECT = /\bdeckOf\s*\(|\brecycleOf\s*\(|\bsharedDeck\b|\bsharedRecycled\b|\.decks\b|\.recycled\b/;

function convict(src: string): { line: number; code: string }[] {
  return codeLines(src).flatMap((code, i) => (DIRECT.test(code) ? [{ line: i + 1, code: code.trim() }] : []));
}

test('the sweep convicts the shapes report 268 was made of (positive controls)', () => {
  for (const bad of [
    '      const top = g.deckOf(ctx.controller).slice(0, 8);',
    '      const deck = g.deckOf(ctx.controller);',
    '  const n = g.s.sharedDeck.length;',
    '  const d = g.s.decks![seat]!;',
    '  g.recycleOf(seat).length',
    '  g.s.sharedRecycled!.splice(0)',
  ]) assert.equal(convict(bad).length, 1, `not convicted: ${bad}`);
  for (const fine of [
    '      const top = g.revealTop(ctx.controller, 8);',
    '      g.recycleToBottom(ctx.controller, n);',
    '  // g.deckOf(seat) in a comment',
    "  g.ev('info', 'the sharedDeck is empty');",
  ]) assert.equal(convict(fine).length, 0, `wrongly convicted: ${fine}`);
});

test('CR 408.2b no card code reads a deck or a recycle pile directly — it asks revealTop or takeTop', () => {
  const files = tsFiles(CARDS_DIR);
  assert.ok(files.filter(f => f.includes(`${path.sep}sets${path.sep}`)).length >= 20,
    `the sweep found only ${files.length} file(s) under ${CARDS_DIR}: a sweep over nothing passes forever`);
  const hits = files.flatMap(f => {
    const rel = path.relative(CARDS_DIR, f);
    if (rel in ALLOWED) return [];
    return convict(fs.readFileSync(f, 'utf8')).map(h => `${rel}:${h.line}  ${h.code}`);
  });
  assert.deepEqual(hits, [],
    'card code read the deck (or the pile) itself, so it cannot reach the mark and reshuffle the '
    + 'recycle pile in (owner, 2026-10-21: "ANYTHING that uses the deck should be able to trigger '
    + 'the reshuffle"). Use g.revealTop(seat, n) to look and g.takeTop(seat, n) to take:\n  '
    + hits.join('\n  '));
});
