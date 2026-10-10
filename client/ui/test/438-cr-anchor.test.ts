/**
 * The rules review page: anchoring, as pure functions (ui/cranchor.ts).
 *
 * A comment on the review page points at a passage by its WORDS (a quote, a
 * little context either side, and where it started), because the document is
 * regenerated after every round and a stored offset alone would point at
 * whatever moved into its place. These are the promises that makes:
 *
 *   §1 a quote is found again when it is unique, and told apart by its
 *      context when it is not;
 *   §2 a whitespace-only change and a curly-to-straight punctuation change
 *      still find it; a changed word does NOT (the thread is shown as
 *      outdated, never silently moved to something it did not say);
 *   §3 a renamed rule key is followed, a removed one is recognised, and a
 *      target that has left the document is an orphan;
 *   §4 a link or a target names the tab and chapter that show it, with the
 *      section read off the number itself;
 *   §5 the margin layout never overlaps two cards and keeps their order.
 *
 * The DOM half (text nodes to offsets, the highlight marks) is crdom.ts and
 * only a browser can prove it; this file is the half a browser cannot lie to.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutMargin, locate, makeAnchor, norm, placer, QUOTE_MAX, sectionOf, targetResolver } from '../cranchor.ts';
import type { CrReviewDoc } from '../crtypes.ts';

const ED = 'Edition 1 (draft)';

/** make an anchor on `text` for the first occurrence of `quote` at or after `from` */
function anchorOn(text: string, quote: string, from = 0): NonNullable<ReturnType<typeof makeAnchor>> {
  const i = text.indexOf(quote, from);
  assert.ok(i >= 0, `fixture: "${quote}" is in the text`);
  const a = makeAnchor(text, i, i + quote.length, ED, '608.2b');
  assert.ok(a, 'fixture: the anchor was made');
  return a;
}

test('§0 norm collapses every whitespace run to one space and trims, and nothing else', () => {
  assert.equal(norm('  a \n\t b  c  '), 'a b c');
  assert.equal(norm('“Curly” — dash'), '“Curly” — dash', 'no typography folding in the text space itself');
  assert.equal(norm('Case Kept'), 'Case Kept');
});

test('§0 makeAnchor keeps 32 characters of context, drops edge spaces, and cuts a long quote', () => {
  const text = norm(`${'x'.repeat(40)} each column deals its damage ${'y'.repeat(40)}`);
  const i = text.indexOf(' each');
  const a = makeAnchor(text, i, i + ' each column deals its damage '.length, ED, '608.2b')!;
  assert.equal(a.quote, 'each column deals its damage', 'the spaces either side of the selection are not part of the quote');
  assert.equal(a.prefix.length, 32);
  assert.equal(a.suffix.length, 32);
  assert.equal(a.start, i + 1);
  assert.equal(a.num, '608.2b');
  assert.equal(a.edition, ED);
  assert.equal(makeAnchor(text, i, i + 1, ED), null, 'a selection of nothing but a space makes no anchor');
  const long = 'z'.repeat(QUOTE_MAX + 50);
  assert.equal(makeAnchor(long, 0, long.length, ED)!.quote.length, QUOTE_MAX, 'cut at the server cap');
});

test('§1 a unique quote is found where it is', () => {
  const text = norm('608.2b Each column deals its damage to the column opposite. Damage is dealt at once.');
  const a = anchorOn(text, 'deals its damage');
  const hit = locate(text, a);
  assert.deepEqual(hit, { start: text.indexOf('deals its damage'), end: text.indexOf('deals its damage') + 'deals its damage'.length });
});

test('§1 a repeated quote is told apart by its context, not by its old position', () => {
  const text = norm('First, the attacker deals damage. Then, after blocks, the defender deals damage.');
  const second = anchorOn(text, 'deals damage', text.indexOf('defender'));
  const first = anchorOn(text, 'deals damage');
  assert.equal(locate(text, second)!.start, text.lastIndexOf('deals damage'));
  assert.equal(locate(text, first)!.start, text.indexOf('deals damage'));
  // the text grows in front of both: positions shift, the context still decides
  const grown = norm(`A new opening sentence that moves everything along. ${text}`);
  assert.equal(locate(grown, second)!.start, grown.lastIndexOf('deals damage'),
    'the second occurrence is still the one meant, although its old offset now points nearer the first');
  assert.equal(locate(grown, first)!.start, grown.indexOf('deals damage'));
});

test('§1 with equal context the old position breaks the tie', () => {
  const text = 'ab ab ab ab';
  const a = { quote: 'ab', prefix: '', suffix: '', start: 6 };
  assert.equal(locate(text, a)!.start, 6);
  assert.equal(locate(text, { ...a, start: 0 })!.start, 0);
});

test('§2 a whitespace-only change still locates', () => {
  const before = norm('Each column\n  deals its   damage to the column opposite.');
  const a = anchorOn(before, 'column deals its damage');
  const after = norm('Each   column deals\n\tits damage to the column opposite.');
  const hit = locate(after, a);
  assert.ok(hit, 'found after the line breaks moved');
  assert.equal(after.slice(hit.start, hit.end), 'column deals its damage');
});

test('§2 a curly or straight quote change, and a dash change, still locate through the fold', () => {
  const before = norm('The card says “Swift” — it acts first.');
  const a = anchorOn(before, 'says “Swift” — it');
  const after = norm('The card says "Swift" - it acts first.');
  const hit = locate(after, a);
  assert.ok(hit, 'curly to straight, em dash to hyphen');
  assert.equal(after.slice(hit.start, hit.end), 'says "Swift" - it');
  // and the other way round
  const b = anchorOn(after, "acts first");
  assert.ok(locate(before, b));
  const c = anchorOn(norm("the player's unit"), "player's unit");
  assert.ok(locate(norm('the player’s unit'), c), 'apostrophe, straight to curly');
});

test('§2 a changed word does not locate: the thread is outdated, never moved', () => {
  const before = norm('Each column deals its damage to the column opposite.');
  const a = anchorOn(before, 'deals its damage');
  assert.equal(locate(norm('Each column deals all its damage to the column opposite.'), a), null);
  assert.equal(locate(norm('Each column assigns its damage to the column opposite.'), a), null);
  assert.equal(locate('', a), null);
  assert.equal(locate(before, { ...a, quote: '' }), null, 'an empty quote never matches everywhere');
});

/* ── targets and places ─────────────────────────────────────────────────── */

const DOC: Pick<CrReviewDoc, 'toc' | 'parts' | 'disc' | 'keys' | 'aliases' | 'removed' | 'targets'> = {
  toc: [
    { id: 'front', title: 'Introduction' },
    { id: 'ch6', title: '6. Combat', sections: [{ num: '608', title: 'Combat damage', part: 's608' }] },
    { id: 'chD', title: 'Annex D', sections: [{ num: 'D3', title: 'Clocks', part: 'sD3' }] },
    { id: 'annexP', title: 'Annex P' }, { id: 'glossary', title: 'Glossary' }, { id: 'changelog', title: 'Changelog' },
  ],
  parts: [
    { id: 'front', kind: 'front', title: 'Introduction', html: '' },
    { id: 's608', kind: 'section', num: '608', chapter: '6', title: 'Combat damage', html: '' },
    { id: 'sD3', kind: 'section', num: 'D3', chapter: 'D', title: 'Clocks', html: '' },
    { id: 'annexP', kind: 'annexP', title: 'Annex P', html: '' },
    { id: 'glossary', kind: 'glossary', title: 'Glossary', html: '' },
    { id: 'changelog', kind: 'changelog', title: 'Changelog', html: '' },
  ],
  disc: [{ id: 'D-U12-3', tier: 1, rule: '608.2b', html: '' }],
  keys: { 'combat.damage': '608', 'combat.damage.columns': '608.2b', 'combat.damage.old': '608.9', 'digital.clock': 'D3.1' },
  removed: { 'combat.damage.old': '608.9' },
  aliases: { 'combat.cols': 'combat.damage.cols-tmp', 'combat.damage.cols-tmp': 'combat.damage.columns', 'loop.a': 'loop.b', 'loop.b': 'loop.a' },
  targets: ['front', 'sec:608', 'rule:combat.damage.columns', 'rule:combat.damage.old', 'disc:D-U12-3', 'gloss:swift'],
};

test('§3 a renamed key is followed, a removed one is recognised, an unknown target is an orphan', () => {
  const r = targetResolver(DOC);
  assert.deepEqual(r('rule:combat.damage.columns'), { target: 'rule:combat.damage.columns', state: 'live' });
  assert.deepEqual(r('rule:combat.cols'), { target: 'rule:combat.damage.columns', state: 'live' },
    'a chain of two renames is followed to the live key');
  assert.deepEqual(r('rule:combat.damage.old'), { target: 'rule:combat.damage.old', state: 'removed' });
  assert.deepEqual(r('disc:D-U99-1'), { target: 'disc:D-U99-1', state: 'orphan' }, 'a discrepancy merged away');
  assert.deepEqual(r('gloss:swift'), { target: 'gloss:swift', state: 'live' });
  assert.equal(r('rule:loop.a').state, 'orphan', 'a rename loop ends instead of spinning');
});

test('§4 a link names the tab, the chapter and the element, reading the section off the number', () => {
  const p = placer(DOC);
  assert.deepEqual(p.ofRef('#r608.2b'), { tab: 'doc', view: 'ch6', anchor: 'r608.2b' });
  assert.deepEqual(p.ofRef('r608'), { tab: 'doc', view: 'ch6', anchor: 'r608' });
  assert.deepEqual(p.ofRef('#rD3.1a'), { tab: 'annexD', view: 'chD', anchor: 'rD3.1a' });
  assert.deepEqual(p.ofRef('#D-U12-3'), { tab: 'disc', view: null, anchor: 'D-U12-3' });
  assert.deepEqual(p.ofRef('#D-U02-9'), { tab: 'disc', view: null, anchor: 'D-U02-9' }, 'an also-filed-as id lives in the same list');
  assert.deepEqual(p.ofRef('#F-U12-3'), { tab: 'doc', view: 'annexP', anchor: 'F-U12-3' });
  assert.deepEqual(p.ofRef('#ch6'), { tab: 'doc', view: 'ch6', anchor: null });
  assert.deepEqual(p.ofRef('#intro'), { tab: 'doc', view: 'front', anchor: null });
  assert.deepEqual(p.ofRef('#annex-d'), { tab: 'annexD', view: 'chD', anchor: null });
  assert.equal(p.ofRef('#r701.1'), null, 'a section this document does not have');
  assert.equal(p.ofRef('#nonsense'), null);
});

test('§4 a comment target names where it is shown', () => {
  const p = placer(DOC);
  assert.deepEqual(p.ofTarget('rule:combat.damage.columns'), { tab: 'doc', view: 'ch6', anchor: 'r608.2b' });
  assert.deepEqual(p.ofTarget('rule:combat.cols'), { tab: 'doc', view: 'ch6', anchor: 'r608.2b' }, 'through the renames');
  assert.deepEqual(p.ofTarget('rule:digital.clock'), { tab: 'annexD', view: 'chD', anchor: 'rD3.1' });
  assert.deepEqual(p.ofTarget('sec:608'), { tab: 'doc', view: 'ch6', anchor: 'r608' });
  assert.deepEqual(p.ofTarget('disc:D-U12-3'), { tab: 'disc', view: null, anchor: 'D-U12-3' });
  assert.deepEqual(p.ofTarget('finding:F-U12-3'), { tab: 'doc', view: 'annexP', anchor: 'F-U12-3' });
  assert.deepEqual(p.ofTarget('gloss:swift'), { tab: 'doc', view: 'glossary', anchor: null });
  assert.deepEqual(p.ofTarget('front'), { tab: 'doc', view: 'front', anchor: null });
  assert.equal(p.ofTarget('rule:no.such.key'), null);
});

test('§4 sectionOf reads the leading three digits or the D number', () => {
  assert.equal(sectionOf('608.2b'), '608');
  assert.equal(sectionOf('608'), '608');
  assert.equal(sectionOf('D3.1'), 'D3');
  assert.equal(sectionOf('D12'), 'D12');
  assert.equal(sectionOf('6081'), null);
  assert.equal(sectionOf('x608'), null);
});

/* ── the margin ─────────────────────────────────────────────────────────── */

test('§5 layoutMargin never overlaps two cards and keeps them in passage order', () => {
  // a seeded walk over many random margins, not one hand-picked case
  let seed = 43800;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let round = 0; round < 200; round++) {
    const n = 1 + Math.floor(rnd() * 12);
    const items = Array.from({ length: n }, (_, i) => ({ id: `c${i}`, y: Math.floor(rnd() * 600), h: 20 + Math.floor(rnd() * 120) }));
    const tops = layoutMargin(items, 8);
    assert.equal(tops.size, n, 'every card is placed');
    const order = [...items].map((it, i) => ({ ...it, i })).sort((a, b) => a.y - b.y || a.i - b.i);
    for (let k = 0; k < order.length; k++) {
      const it = order[k]!;
      const t = tops.get(it.id)!;
      assert.ok(t >= it.y, 'a card never sits above its own passage');
      if (k > 0) {
        const prev = order[k - 1]!;
        assert.ok(t >= tops.get(prev.id)! + prev.h + 8, `round ${round}: card ${it.id} overlaps ${prev.id}`);
      }
    }
  }
  // the plain case: nothing in the way, nothing moves
  assert.deepEqual([...layoutMargin([{ id: 'a', y: 0, h: 10 }, { id: 'b', y: 100, h: 10 }])], [['a', 0], ['b', 100]]);
  // a tie keeps the input order
  assert.deepEqual([...layoutMargin([{ id: 'x', y: 5, h: 10 }, { id: 'y', y: 5, h: 10 }], 0)], [['x', 5], ['y', 15]]);
});
