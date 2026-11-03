/* 998 — A PAGE'S RULES LIVE IN ITS OWN PIECE, AND A HEADER NAMES REAL FILES
 * (design-system round, 2026-11-03, stream ds-w3b).
 *
 * The 2026-11-02 split cut style.css where its sections ended, and two Single
 * Card Duel rules (.scdraw, .scwarn) had been written at the end of the card
 * stats section, so they landed in 34-cardstats.css. A card stats change would
 * never look for them there. .scdraw moved in wave 2; .scwarn moved here.
 *
 * §1 the Single Card Duel's own classes are in 33-single-card-duel.css, and
 *    34-cardstats.css holds none of them (no .sc* class at all)
 * §2 crreview.ts's header names its sibling pages where they are (it said
 *    admin.ts after admin moved to pages/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const UI = new URL('../', import.meta.url);
const read = (f: string): string => readFileSync(new URL(f, UI), 'utf8');
const noComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** every class a piece's selectors name (not its declarations) */
function selectorClasses(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of noComments(css).matchAll(/([^{}]+)\{/g)) {
    if (m[1]!.trim().startsWith('@')) continue;
    for (const c of m[1]!.matchAll(/\.([a-zA-Z][\w-]*)/g)) out.add(c[1]!);
  }
  return out;
}

test('998 §1 the Single Card Duel\'s rules are in its own piece, not card stats\'', () => {
  const duel = selectorClasses(read('styles/pages/33-single-card-duel.css'));
  const stats = selectorClasses(read('styles/pages/34-cardstats.css'));
  for (const c of ['scwarn', 'scdraw']) {
    assert.ok(duel.has(c), `.${c} is in 33-single-card-duel.css`);
    assert.ok(!stats.has(c), `.${c} is not in 34-cardstats.css`);
  }
  // positive control: the parse reads card stats' own rules
  assert.ok(stats.has('cstable') && stats.has('cspage'), 'the parse sees .cstable and .cspage');
  // derived, not listed: no Single Card Duel class (.sc*) at all in card stats' piece
  assert.deepEqual([...stats].filter(c => /^sc[a-z]/.test(c)), [], 'a .sc* rule in 34-cardstats.css belongs in 33');
});

test('998 §2 crreview.ts\'s header names its sibling pages where they are', () => {
  const head = read('crreview.ts').slice(0, 600);
  const named = /Same contract as ([^,]+), ([^ ]+) and ([^,]+),/.exec(head);
  assert.ok(named, 'positive control: the header still says which pages share its contract');
  for (const f of named.slice(1)) assert.ok(existsSync(new URL(f, UI)), `crreview.ts names ${f}, which is not a file in client/ui/`);
});
