/**
 * The card query language: the parser, the operators, and the answers it gives
 * over the real pool.
 *
 * WHY THE PINNED COUNTS. Half of this file asserts a parse tree, which proves
 * the grammar. The other half asserts the ANSWER to a query against the actual
 * 536 cards, which is the only thing that proves the operators mean what the
 * help sheet says they mean. A parser test passes happily while `el<=` is
 * implemented as `el>=`; a query test does not.
 *
 * The pinned numbers are the pool as it stands. When the pool grows they will
 * move, and that is the point at which somebody has to look at whether the
 * query still means what it meant — which is cheaper than discovering later
 * that a filter has been quietly wrong for a hundred cards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { allRows, rowFor } from '../ui/cardindex.ts';
import {
  FLAGS, KEYS, chipState, nextChipState, parseElements, parseQuery, search,
  stringifyQuery, withChip, withDisplay,
} from '../ui/cardsearch.ts';

/**
 * `search()` applies an implicit `class:card` unless the query mentions class
 * (see ui/cardsearch.ts). These helpers therefore answer about the 483 CARDS,
 * which is what the browser shows and what most of these tests are about.
 * `allCount`/`allNames` opt out with `class:all` and see the whole 537 — used
 * wherever a test partitions the pool, since a partition of a filtered set is
 * not a partition of the pool.
 */
const names = (src: string): string[] => search(src).rows.map(r => r.name);
const count = (src: string): number => search(src).total;
const allCount = (src: string): number => search(`${src} class:all`).total;
const CARDS = 483;

/* ── the grammar ───────────────────────────────────────────────────────── */

test('a bare word searches name, type and rules text', () => {
  const q = parseQuery('sprite');
  assert.equal(q.hasBare, true);
  assert.deepEqual(q.node, { t: 'term', term: { key: '', op: ':', value: 'sprite', raw: 'sprite', negated: false } });
  const hits = names('sprite');
  assert.ok(hits.includes('Ignis Sprite'), 'by name');
  assert.ok(hits.some(n => rowFor(n)!.typeLc.includes('sprite') && !rowFor(n)!.nameLc.includes('sprite')), 'by type line');
});

test('juxtaposition is AND, and OR is a word', () => {
  assert.equal(parseQuery('a b').node.t, 'and');
  assert.equal(parseQuery('a OR b').node.t, 'or');
  assert.equal(parseQuery('a or b').node.t, 'or');
  assert.equal(parseQuery('a | b').node.t, 'or');
  // AND is accepted and means nothing, because juxtaposition already said it
  assert.equal(parseQuery('a AND b').node.t, 'and');
});

test('a leading - negates a term or a whole group', () => {
  assert.equal(parseQuery('-el:fire').node.t, 'not');
  const grouped = parseQuery('-(el:fire OR el:water)');
  assert.equal(grouped.node.t, 'not');
  assert.equal((grouped.node as { kid: { t: string } }).kid.t, 'or');
});

test('quotes hold a phrase together and regexes are honoured', () => {
  const q = parseQuery('o:"when I die"');
  assert.deepEqual((q.node as { term: { value: string } }).term.value, 'when I die');
  assert.ok(count('o:/^when I (die|spawn)/') > 0);
  assert.ok(count('name:/sprite$/') > 0);
  // regexes fold case like every other matcher, and a written /i is redundant
  assert.equal(count('name:/SPRITE$/'), count('name:/sprite$/'));
  assert.equal(count('name:/sprite$/i'), count('name:/sprite$/'));
  // a regex that will not compile is not an exception; it degrades to a
  // literal search AND says so, because an unexplained empty result is worse
  assert.equal(count('name:/[unclosed/'), 0);
  assert.match(parseQuery('name:/[unclosed/').errors[0]!.message, /not a valid regex/);
});

test('parentheses nest, and precedence is OR over AND', () => {
  // "fire units, or any spell at all" — NOT "fire (units or spells)", which is
  // just fire units. Deliberately picked a right-hand side that is disjoint
  // from the left: `attr:flying` looked like the obvious example and is not
  // one, because every card with Flying is already a unit, so both readings
  // return the same 65 cards and the test passed while proving nothing.
  const loose = count('kind:unit el:fire OR kind:spell');
  const tight = count('kind:unit (el:fire OR kind:spell)');
  assert.notEqual(loose, tight);
  assert.equal(tight, count('kind:unit el:fire'), 'a unit is never a spell');
  assert.equal(loose, count('kind:unit el:fire') + count('kind:spell'));
});

/* ── tolerance, because the bar is live ────────────────────────────────── */

test('half-typed queries still answer, and say what was wrong', () => {
  for (const half of ['o:"draw a ca', 'el:fire (kind:unit', 'name:/spr', 'mana>=', '-']) {
    const r = search(half);
    assert.ok(Array.isArray(r.rows), `${half} returned rows`);
    assert.ok(r.query.errors.length > 0 || r.total >= 0, `${half} parsed`);
  }
  assert.match(parseQuery('o:"unclosed').errors[0]!.message, /unclosed quote/);
  assert.match(parseQuery('(el:fire').errors[0]!.message, /unclosed "\("/);
  assert.match(parseQuery('el:fire)').errors[0]!.message, /"\)" with no "\("/);
  assert.match(parseQuery('mana>=').errors[0]!.message, /has nothing after it/);
});

test('an unknown filter is reported and then treated as a bare word', () => {
  const q = parseQuery('manna:2');
  assert.match(q.errors[0]!.message, /unknown filter "manna:"/);
  assert.match(q.errors[0]!.message, /mana:/, 'suggests the near miss');
  assert.equal(q.hasBare, true);
});

test('every key in the help table parses, and its example returns something', () => {
  for (const d of KEYS) {
    if (d.key === 'copies' || d.key === 'in') continue;   // deckbuilding-only, no deck here
    const q = parseQuery(d.example);
    assert.deepEqual(q.errors, [], `${d.key}: ${d.example}`);
    assert.ok(search(d.example).total > 0, `${d.key} example "${d.example}" found nothing`);
    for (const alias of d.aliases) {
      assert.equal(parseQuery(`${alias}:x`).errors.length, 0, `alias ${alias} of ${d.key}`);
    }
  }
});

/* ── the operators, against the real pool ──────────────────────────────── */

test('element operators: inclusive, exclusive, and subset', () => {
  const fire = count('el:fire');
  const exactFire = count('el=fire');
  assert.ok(fire > exactFire, 'el:fire includes hybrids, el=fire does not');

  // every card that is exactly fire+wood
  const both = names('el=fire,wood');
  assert.ok(both.length > 0);
  for (const n of both) assert.deepEqual([...rowFor(n)!.factions].sort(), ['fire', 'wood']);

  // subset: what fits inside a fire/wood deck — the monos plus the pair
  const within = names('el<=fire,wood');
  for (const n of within) {
    for (const f of rowFor(n)!.factions) assert.ok(['fire', 'wood'].includes(f), `${n} has ${f}`);
  }
  assert.ok(within.length > both.length, 'subset includes the monos');
  assert.equal(count('el<=fire,wood el:fire el:wood'), both.length);

  // ':' with two elements means BOTH, which is what makes it inclusive
  assert.equal(count('el:fire,wood'), both.length);

  // and negation, over the whole pool so the two halves really are a partition
  assert.equal(allCount('-el:fire') + allCount('el:fire'), allRows().length);
  assert.equal(count('-el:fire') + fire, CARDS, '…and over the cards alone');
});

test('element values accept names, pip letters and the special words', () => {
  assert.deepEqual(parseElements('fire'), ['fire']);
  assert.deepEqual(parseElements('rg'), ['fire', 'wood']);
  assert.deepEqual(parseElements('fire,wood'), ['fire', 'wood']);
  assert.equal(parseElements('mono'), null);
  assert.equal(count('el:rg'), count('el:fire,wood'));
  assert.equal(allCount('el:mono') + allCount('el:hybrid') + allCount('el:none'), allRows().length);
  // `f` is fire: b and g were taken by water and wood, so fire lost r — but
  // nothing is competing for f, and people reach for it
  assert.equal(count('el:f'), count('el:fire'));
  assert.equal(count('el:fg'), count('el:fire,wood'));
  assert.deepEqual(parseElements('f'), ['fire']);
  // …and w is deliberately NOT an element: water and wood both want it
  assert.deepEqual(parseElements('w'), []);
});

test('pips count and pips compare', () => {
  assert.equal(count('pip:2'), count('pip=2'));
  for (const n of names('pip>=3')) assert.ok(rowFor(n)!.pipCount >= 3);
  // "castable off two fire and one wood"
  for (const n of names('pip<=rrg')) {
    const p = rowFor(n)!.pips;
    assert.ok((p['fire'] ?? 0) <= 2 && (p['wood'] ?? 0) <= 1 && Object.keys(p).every(e => ['fire', 'wood'].includes(e)), n);
  }
  for (const n of names('pip:rr')) assert.ok((rowFor(n)!.pips['fire'] ?? 0) >= 2, n);
});

test('numeric operators, and X costs staying out of them', () => {
  for (const n of names('mana<=2')) assert.ok(!rowFor(n)!.isX && rowFor(n)!.mana <= 2, n);
  assert.equal(allCount('mana<=2') + allCount('mana>2') + allCount('mana:X'), allRows().length);
  assert.ok(count('mana:X') > 0);
  for (const n of names('pt>=10')) assert.ok(rowFor(n)!.power + rowFor(n)!.toughness >= 10, n);
});

test('list fields prefix-match so a half-typed attribute still finds things', () => {
  assert.deepEqual(names('attr:flying').sort(), names('attr:fly').sort());
  assert.ok(names('attr:flying').every(n => rowFor(n)!.attrs.includes('Flying')));
  assert.equal(count('attr=fly'), 0, '= is exact');
  assert.ok(count('sub:sprite') > 0);
  assert.ok(names('kw:virus').every(n => rowFor(n)!.virus));
});

test('is: covers every declared flag and nothing else', () => {
  // asked with class:all, because a flag is part of the LANGUAGE and the
  // implicit card filter is part of the browser. `is:colorless` is the case
  // that makes the distinction real — see the assertion below it.
  for (const f of FLAGS) {
    if (f.flag === 'deck' || f.flag === 'maybe') continue;    // need an open deck
    const r = search(`is:${f.flag} class:all`);
    assert.deepEqual(r.query.errors, [], `is:${f.flag}`);
    assert.ok(r.total > 0, `is:${f.flag} found nothing`);
  }
  // EVERY colourless thing in the box is a non-card: the turn-structure charts,
  // the intent tokens, the resource faces, the Kickstarter Glitch cards and the
  // three synthetics. So `is:colorless` is genuinely empty among cards, and the
  // count line's "class:all to include them" is the whole explanation.
  assert.equal(count('is:colorless'), 0);
  assert.equal(allCount('is:colorless'), 43);
  assert.equal(count('is:notathing'), 0);
  // the three the client scripts but the oracle file does not carry are the
  // check that `is:scripted` is not just "is in the catalogue"
  assert.equal(allCount('is:scripted'), 495, 'the 492 printed cards plus the three synthetics');
  assert.equal(allCount('is:playable'), CARDS);
  assert.equal(count('class:card'), CARDS);
});

test('the classes partition the pool', () => {
  const total = ['card', 'token', 'resource', 'marker', 'help', 'exclusive']
    .reduce((n, c) => n + count(`class:${c}`), 0);
  assert.equal(total, allRows().length);
});

test('an empty box means the cards, and saying anything about class turns that off', () => {
  // the owner's call: clearing the box must actually clear it, and the 54
  // non-cards are what you want roughly never
  assert.equal(count(''), CARDS);
  assert.equal(search('').implicitCards, true);
  assert.ok(!names('').includes('Alluring Attribute'));

  // any mention of class, in any shape, and the implicit term is not added —
  // otherwise a question ABOUT classes would be silently intersected with one
  for (const src of ['class:all', 'class:token', '-class:card', 'is:help', 'el:fire OR class:marker']) {
    assert.equal(search(src).implicitCards, false, src);
  }
  assert.equal(count('class:all'), allRows().length);
  assert.equal(count('-class:card'), allRows().length - CARDS);
  assert.equal(count('is:help'), 12);

  // …and it narrows a real query the same way
  assert.equal(count('is:vanilla'), allCount('is:vanilla class:card'));
  assert.ok(count('is:vanilla') < allCount('is:vanilla'));

  // the caller can always ask for the literal reading
  assert.equal(search('', { implicit: false }).total, allRows().length);
});

/* ── the whole point: a query with all three shapes in it ──────────────── */

test('negation, grouping and a range together', () => {
  const src = '-el:fire (sub:sprite OR sub:demon) mana<=3';
  const hits = names(src);
  assert.ok(hits.length > 0);
  for (const n of hits) {
    const r = rowFor(n)!;
    assert.ok(!r.factions.includes('fire'), `${n} is fire`);
    assert.ok(r.subtypesLc.some(s => s.startsWith('sprite') || s.startsWith('demon')), `${n} is neither`);
    assert.ok(!r.isX && r.mana <= 3, `${n} costs too much`);
  }
});

test('two-mana wood units that are not virus and mention counters', () => {
  const hits = names('el:wood kind:unit mana:2 -kw:virus o:counter');
  for (const n of hits) {
    const r = rowFor(n)!;
    assert.ok(r.factions.includes('wood') && r.kind === 'unit' && r.mana === 2);
    assert.ok(!r.virus && r.textLc.includes('counter'));
  }
});

/* ── sorting ───────────────────────────────────────────────────────────── */

test('sort: is a display term — it orders, it does not filter', () => {
  assert.equal(count('el:fire'), count('el:fire sort:mana'));
  const q = parseQuery('el:fire sort:mana dir:desc view:list');
  assert.equal(q.sort, 'mana');
  assert.equal(q.dir, 'desc');
  assert.equal(q.view, 'list');
  const asc = search('el:fire -mana:X sort:mana').rows.map(r => r.mana);
  assert.deepEqual(asc, [...asc].sort((a, b) => a - b));
  // X is excluded on purpose: an X card sorts as the most expensive thing in
  // the deck (it can be), but its `mana` reads 0, so a naive descending check
  // over the raw field sees 0s at the front and calls it unsorted.
  const desc = search('el:fire -mana:X sort:mana dir:desc').rows.map(r => r.mana);
  assert.deepEqual(desc, [...desc].sort((a, b) => b - a));
  assert.equal(search('el:fire sort:mana dir:desc').rows[0]!.isX, true, 'X sorts as the priciest');
});

test('a bare word sorts by relevance, an exact name first', () => {
  const hits = names('jelly');
  assert.equal(hits[0], 'Jelly', 'the card actually called Jelly leads');
  assert.equal(parseQuery('jelly').sort, 'relevance');
  assert.equal(parseQuery('el:fire').sort, 'name', 'no bare word, no relevance to sort by');
});

test('sorting is total, so a result list never shuffles', () => {
  const a = names('kind:unit sort:mana');
  const b = names('kind:unit sort:mana');
  assert.deepEqual(a, b);
});

/* ── chips: the facet rail is an editor for the string ─────────────────── */

test('a chip round-trips through the query string', () => {
  let src = '';
  assert.equal(chipState(src, 'el', 'fire'), null);
  src = withChip(src, 'el', 'fire', 'on');
  assert.equal(src, 'el:fire');
  assert.equal(chipState(src, 'el', 'fire'), 'on');
  src = withChip(src, 'el', 'fire', 'off');
  assert.equal(src, '-el:fire');
  assert.equal(chipState(src, 'el', 'fire'), 'off');
  src = withChip(src, 'el', 'fire', null);
  assert.equal(src, '');
});

test('chips cycle nothing -> include -> exclude -> nothing', () => {
  assert.equal(nextChipState(null), 'on');
  assert.equal(nextChipState('on'), 'off');
  assert.equal(nextChipState('off'), null);
});

test('a chip click keeps what was typed by hand', () => {
  const src = 'o:"when I die"   mana<=3';
  const out = withChip(src, 'kind', 'unit', 'on');
  assert.ok(out.startsWith('o:"when I die"   mana<=3'), out);
  assert.equal(chipState(out, 'kind', 'unit'), 'on');
  // …and removing it puts the text back, minus the term
  assert.equal(withChip(out, 'kind', 'unit', null), 'o:"when I die" mana<=3');
});

test('a chip added to a top-level OR wraps it rather than binding to one branch', () => {
  const src = 'el:fire OR el:water';
  const out = withChip(src, 'kind', 'unit', 'on');
  assert.equal(out, '(el:fire OR el:water) kind:unit');
  assert.equal(count(out), count('kind:unit (el:fire OR el:water)'));
  // and it is NOT the sum of the two halves, because fire/water hybrids are in
  // both — which is exactly the mistake an un-wrapped append would make
  assert.ok(count(out) < count('kind:unit el:fire') + count('kind:unit el:water'));
});

test('chips do not reach inside a group the user built', () => {
  const src = 'mana:2 (el:fire OR sub:sprite)';
  assert.equal(chipState(src, 'el', 'fire'), null, 'the nested term is not a chip');
  const out = withChip(src, 'el', 'fire', 'on');
  assert.equal(out, 'mana:2 (el:fire OR sub:sprite) el:fire');
});

test('an alias in the box is recognised by the chip for its canonical key', () => {
  assert.equal(chipState('e:fire', 'el', 'fire'), 'on');
  assert.equal(chipState('-f:fire', 'el', 'fire'), 'off');
});

test('a chip is key:value — a range or an exact-match term is not that chip', () => {
  // `mana<=3` used to light the "3" chip, which said the range was an equality
  // and would have deleted the range on the next click
  assert.equal(chipState('mana<=3', 'mana', '3'), null);
  assert.equal(chipState('mana:3', 'mana', '3'), 'on');
  assert.equal(chipState('el=fire', 'el', 'fire'), null, '= is a different question from :');
  // …and setting the chip leaves the range alone, so the two AND together
  assert.equal(withChip('mana<=3', 'mana', '3', 'on'), 'mana<=3 mana:3');
  assert.equal(search('mana<=3 mana:3').total, search('mana:3').total);
});

test('display terms replace rather than accumulate', () => {
  let src = withDisplay('el:fire', 'sort', 'mana');
  assert.equal(src, 'el:fire sort:mana');
  src = withDisplay(src, 'sort', 'pow');
  assert.equal(src, 'el:fire sort:pow');
  assert.equal(withDisplay(src, 'sort', 'name'), 'el:fire', 'the default is written as absence');
});

test('stringify round-trips a query through its own parser', () => {
  for (const src of ['el:fire', '-el:fire kind:unit', 'el:fire OR el:water', '-(el:fire OR el:water) mana<=2', 'jelly sort:mana']) {
    const once = stringifyQuery(parseQuery(src));
    const twice = stringifyQuery(parseQuery(once));
    assert.equal(twice, once, src);
    assert.equal(search(once).total, search(src).total, src);
  }
});

/* ── deckbuilding context ──────────────────────────────────────────────── */

test('in: and copies: answer from the open deck, and are empty without one', () => {
  const deck = new Map([['Ignis Sprite', 2], ['Jelly', 1]]);
  const ctx = { copies: (n: string) => deck.get(n) ?? 0, maybe: () => 0 };
  const pool = allRows();
  assert.deepEqual(search('in:deck', { pool, ctx }).rows.map(r => r.name).sort(), ['Ignis Sprite', 'Jelly']);
  assert.deepEqual(search('copies>=2', { pool, ctx }).rows.map(r => r.name), ['Ignis Sprite']);
  assert.equal(search('-in:deck class:all', { pool, ctx }).total, pool.length - 2);
  assert.equal(search('in:deck', { pool }).total, 0, 'no deck open, nothing is in it');
});

test('the pool can be narrowed by the caller without the query knowing', () => {
  const pool = allRows().filter(r => r.playable);
  assert.equal(search('', { pool }).total, 483);
  assert.equal(search('class:token', { pool }).total, 0);
});
