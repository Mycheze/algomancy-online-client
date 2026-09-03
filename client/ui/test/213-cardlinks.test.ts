/**
 * Card names in deck descriptions — ui/cardlinks.ts.
 *
 * A deck description is the first user text this client renders on OTHER
 * people's screens. ui/markdown.ts is safe because its tag set is closed and
 * it emits no attributes at all; this hook emits one, so the argument that it
 * is still safe has to be a test rather than a comment. The sweep below is
 * that argument: whatever goes in, the only tag that comes out is <a> and the
 * only attributes on it are class, data-prev and data-card — and the value of
 * data-prev is always a real card name, never anything the writer typed.
 *
 * Same shape as 95-ui-markdown.test.ts, which sweeps markdown.ts's own closed
 * tag set.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { GLOSSARY } from '../glossary.ts';
import { allRows } from '../cardindex.ts';
import { mdToHtml } from '../markdown.ts';
import { cardLinker, clipDescription, descSummary } from '../cardlinks.ts';

const linkify = cardLinker();
const withBtn = cardLinker({ focusBtn: 'deck-focus' });
/** a real, multi-word, deck-legal card to write about */
const CARD = allRows().find(r => r.playable && r.cls === 'card' && r.name.includes(' '))!.name;

test('a bare card name becomes a hoverable link', () => {
  const out = linkify(`I like ${CARD} a lot.`);
  assert.match(out, new RegExp(`<a class="cardlink" data-prev="${CARD}">${CARD}</a>`));
  assert.match(out, /^I like /);
  assert.match(out, /a lot\.$/);
});

test('the explicit form takes any text and resolves the target', () => {
  const out = linkify(`play [the big one](${CARD}) first`);
  assert.match(out, new RegExp(`data-prev="${CARD}"`));
  assert.match(out, />the big one</);
  assert.doesNotMatch(out, /\[/, 'the brackets are consumed, not printed');
});

test('an unresolvable target is left as literal text, not a link', () => {
  const out = linkify('see [this](Not A Real Card At All) instead');
  assert.doesNotMatch(out, /<a/, 'a made-up target must not produce a link');
  assert.match(out, /\[this\]\(Not A Real Card At All\)/);
});

test('the focus button is opt-in, and hovering never needs it', () => {
  assert.doesNotMatch(linkify(CARD), /data-btn/);
  assert.match(withBtn(CARD), /data-btn="deck-focus"/);
  // data-prev is what main.ts's document-level hover keys off, so it is on both
  assert.match(linkify(CARD), /data-prev=/);
  assert.match(withBtn(CARD), /data-prev=/);
});

test('longest name wins — a short name inside a long one does not split it', () => {
  const long = allRows()
    .filter(r => r.playable && r.cls === 'card')
    .map(r => r.name)
    .find(n => allRows().some(o => o.playable && o.cls === 'card'
      && o.name !== n && n.includes(o.name)));
  if (!long) return;                       // no such pair in this pool: nothing to prove
  const out = linkify(long);
  assert.equal((out.match(/<a /g) ?? []).length, 1, `"${long}" was split into two links`);
  assert.match(out, new RegExp(`data-prev="${long.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
});

test('a one-word name that is also a glossary term does not auto-link', () => {
  // DERIVED, not a stoplist: whatever the two tables have in common is what
  // must stay unlinked, so this keeps holding as either table grows.
  const terms = new Set(GLOSSARY.map(g => g.term.toLowerCase()));
  const clashes = allRows()
    .filter(r => r.playable && r.cls === 'card' && !r.name.includes(' ') && terms.has(r.name.toLowerCase()))
    .map(r => r.name);
  assert.ok(clashes.length > 0, 'the pool used to have several of these — has the glossary moved?');
  for (const word of clashes) {
    assert.doesNotMatch(linkify(`you win the ${word} on turn three`), /<a/,
      `"${word}" is a glossary term and must not auto-link`);
    // …and is still reachable when you mean the card
    assert.match(linkify(`[the card](${word})`), /<a/, `"${word}" must still link explicitly`);
  }
});

test('matching is case-sensitive, so ordinary prose is left alone', () => {
  assert.doesNotMatch(linkify(CARD.toLowerCase()), /<a/);
});

/** What is left after the links this module is allowed to emit are removed.
 * Any `<` still in there is markup that escaped, which is the failure. Testing
 * for the word "onerror" would not: it survives as harmless escaped TEXT, and
 * asserting on it would make the test fail for the one reason that is fine. */
const stripLinks = (html: string): string => html.replace(/<a [^>]*>|<\/a>/g, '');

test('nothing the writer types can escape into markup', () => {
  const nasty = '<script>alert(1)</script> & "quoted" <img onerror=x>';
  const out = linkify(nasty);
  assert.doesNotMatch(stripLinks(out), /[<>]/, 'raw markup survived escaping');
  assert.match(out, /&lt;script&gt;/);
  assert.match(out, /&amp;/);
  assert.match(out, /&quot;/);
});

test('a hostile link target cannot become an attribute value', () => {
  for (const target of ['javascript:alert(1)', '" onerror="x', "'>"+'<script>', 'https://evil.example']) {
    const out = linkify(`[click](${target})`);
    assert.doesNotMatch(out, /<a/, `"${target}" produced a link`);
    // it comes back as inert escaped text — the words are still there, and
    // that is fine; what must not be there is a tag or an attribute
    assert.doesNotMatch(out, /[<>]/, `"${target}" left raw markup behind`);
  }
});

test('THE SWEEP: only <a>, and only the four attributes, ever come out', () => {
  const sources = [
    `${CARD} is the whole deck. [Also good](${CARD}).`,
    '<b onclick="x">no</b> [a](Nope) & <a href="javascript:1">z</a>',
    `[${CARD}](${CARD}) [](${CARD}) [x](  ${CARD}  )`,
    'plain prose with no cards in it at all',
  ];
  for (const src of sources) {
    const out = withBtn(src);
    // The tags are exactly the `<...>` runs: everything this module did not
    // emit itself has been escaped, so a `<` in the output IS a tag it emitted.
    // Scanning the whole string instead would read `onclick=` out of the
    // escaped text `&lt;b onclick=&quot;x&quot;&gt;` and call it an attribute.
    for (const tag of out.match(/<[^>]*>/g) ?? []) {
      assert.match(tag, /^<\/?a[ >]/, `unexpected tag ${tag} from: ${src}`);
      for (const attr of tag.match(/\s([a-zA-Z-]+)=/g) ?? []) {
        assert.ok(['class', 'data-prev', 'data-btn', 'data-card'].includes(attr.trim().slice(0, -1)),
          `unexpected attribute ${attr} from: ${src}`);
      }
    }
  }
});

test('every data-prev value is a real card the index knows', () => {
  const names = new Set(allRows().map(r => r.name));
  const out = withBtn(`${CARD} and [something](${CARD}) and Not A Card`);
  for (const m of out.matchAll(/data-prev="([^"]*)"/g)) {
    assert.ok(names.has(m[1]!), `data-prev="${m[1]}" is not a card`);
  }
});

test('it composes with markdown.ts as that module documents', () => {
  const out = mdToHtml(`## The plan\n\n- lead on **${CARD}**\n- then ${CARD}\n`, { inline: linkify });
  assert.match(out, /<h3>The plan<\/h3>/);
  assert.match(out, /<li>/);
  assert.match(out, /<strong>/);
  assert.match(out, /<a class="cardlink"/, 'card names inside markdown blocks still link');
});

test('clipDescription cuts the source, never the markup, and admits what it did', () => {
  const short = 'Two words.';
  assert.deepEqual(clipDescription(short), { text: short, clipped: false });

  const long = 'First sentence here. Second sentence here. ' + 'x'.repeat(400);
  const c = clipDescription(long);
  assert.equal(c.clipped, true);
  assert.ok(c.text.length < long.length);
  assert.ok(long.startsWith(c.text.replace(/…$/, '')), 'the clip must be a prefix of the source');

  // no sentence end to find: it still stops on a word boundary
  const noStop = 'word '.repeat(200);
  const w = clipDescription(noStop);
  assert.equal(w.clipped, true);
  assert.doesNotMatch(w.text.replace(/…$/, ''), /wor$/, 'clipped mid-word');
});

test('descSummary is prose, not markdown, and never markup', () => {
  const src = `## How it works\n\nIt leans on **cheap units**.\n\n- Lead on the two-drop\n- Save [the finisher](${CARD})\n`;
  const out = descSummary(src);
  assert.doesNotMatch(out, /[#*`>_]/, 'the markers are gone');
  assert.doesNotMatch(out, /[<>]/, 'and it is text, never markup — the caller escapes it');
  assert.match(out, /How it works/);
  assert.match(out, /cheap units/);
  assert.match(out, /the finisher/, 'an explicit link reads as its text, the way the rendered one does');
  assert.doesNotMatch(out, /\[|\]|\(/, 'and not as the link syntax');
  assert.doesNotMatch(out, /\n/, 'one line');
});

test('descSummary keeps the card name when the link text is empty', () => {
  assert.match(descSummary(`play [](${CARD}) early`), new RegExp(CARD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('descSummary respects the budget', () => {
  const long = 'word '.repeat(200);
  assert.ok(descSummary(long, 60).length <= 61, 'clipped to the budget (plus the ellipsis)');
  assert.equal(descSummary(''), '', 'and nothing is nothing');
});
