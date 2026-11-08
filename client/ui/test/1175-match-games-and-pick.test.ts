/* BL-55 — two of the Competitive match screens' leftovers:
 *
 *   §1 the match result lists each game's winner under a Bo3's score
 *      ("Game 1: you won · Game 2: Bo won (conceded)"), and says nothing more
 *      for a Bo1 or for an older server that sends no `games`
 *   §2 the deck picked for Competitive survives a reload: the pick is kept in
 *      localStorage, read back when the module loads, and pickOf() still falls
 *      back to the first legal deck when the remembered one is gone or illegal
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// a localStorage the module reads at load — set before the import
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};
store.set('algoCcDeck', 'd2');

const mt = await import('../match.ts');
const { matchResultHtml } = await import('../pages/match.ts');

const names: [string, string] = ['Ann', 'Bo'];
const over = {
  id: 'M1', bestOf: 3 as const, score: [2, 1] as [number, number], game: 3, phase: 'over' as const, room: '',
  result: { winner: 0 as const, how: 'games' as const, at: 1 },
  games: [
    { winner: 0 as const, how: 'played' as const },
    { winner: 1 as const, how: 'conceded' as const },
    { winner: 0 as const, how: 'played' as const },
  ],
};

test('1175 §1 a Bo3 result lists each game\'s winner, from the reader\'s side', () => {
  const mine = matchResultHtml(over, 0, names);
  assert.match(mine, /<b>You win the match 2–1\.<\/b>/);
  assert.match(mine, /<div class="ccgames dim">Game 1: you won · Game 2: Bo won \(conceded\) · Game 3: you won<\/div>/);
  const theirs = matchResultHtml(over, 1, names);
  assert.match(theirs, /Game 1: Ann won · Game 2: you won \(conceded\) · Game 3: Ann won/);
  const flagged = matchResultHtml({ ...over, score: [1, 0], result: { winner: 1, how: 'time', at: 1 }, games: [{ winner: 0, how: 'played' }, { winner: 1, how: 'time' }] }, 0, names);
  assert.match(flagged, /Game 1: you won · Game 2: Bo won \(on time\)/);
  const closed = matchResultHtml({ ...over, games: [{ winner: null, how: 'closed' }] }, 0, names);
  assert.match(closed, /Game 1: no result</);
  const esc = matchResultHtml(over, 0, ['Ann', '<i>Bo</i>']);
  assert.match(esc, /Game 2: &lt;i&gt;Bo&lt;\/i&gt; won/);
});

test('1175 §1 nothing more for a Bo1, an older server, or a void match', () => {
  const bo1 = matchResultHtml({ ...over, bestOf: 1, score: [1, 0], games: [{ winner: 0, how: 'played' }] }, 0, names);
  assert.doesNotMatch(bo1, /ccgames/);
  const { games: _, ...old } = over;
  assert.doesNotMatch(matchResultHtml(old, 0, names), /ccgames/);
  assert.match(matchResultHtml(old, 0, names), /You win the match 2–1/);
  assert.doesNotMatch(matchResultHtml({ ...over, phase: 'void' }, 0, names), /ccgames/);
});

test('1175 §2 the Competitive deck pick is remembered across a reload', () => {
  const decks = [{ id: 'd1', name: 'One', error: null }, { id: 'd2', name: 'Two', error: null }, { id: 'd3', name: 'Three', error: 'no sideboard' }];
  assert.equal(mt.pickOf(decks)?.id, 'd2', 'the stored pick, read when the module loaded');
  assert.equal(mt.PICK_KEY, 'algoCcDeck');
  // the picker's change handler writes it back
  const sel = { value: 'd1', listener: null as null | (() => void), addEventListener(_: string, f: () => void) { this.listener = f; } };
  const g = globalThis as { document?: unknown };
  const had = g.document;
  g.document = { getElementById: (id: string) => (id === 'cc-deck' ? sel : null) };
  try {
    let painted = 0;
    mt.wireDeckSelect(() => { painted++; });
    sel.listener!();
    assert.equal(store.get('algoCcDeck'), 'd1', 'stored');
    assert.equal(painted, 1);
    assert.equal(mt.pickOf(decks)?.id, 'd1');
    sel.value = 'd3';
    sel.listener!();
    assert.equal(mt.pickOf(decks)?.id, 'd1', 'an illegal remembered deck falls back to the first legal one');
    sel.value = '';
    sel.listener!();
    assert.equal(store.has('algoCcDeck'), false, 'an empty pick forgets');
  } finally { g.document = had; }
  assert.equal(mt.pickOf([{ id: 'd9', name: 'Nine', error: null }])?.id, 'd9', 'a deck no longer in the collection falls back');
});
