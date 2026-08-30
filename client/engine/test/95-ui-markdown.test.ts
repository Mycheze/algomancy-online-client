/* Report #82 — "the judge's answer still has the asterisks and hashes in it."
 *
 * The rules bot answers in markdown by design (its system prompt asks for
 * "clean markdown"), and the client escaped it and printed it raw. ui/markdown.ts
 * renders the small subset the bot actually emits.
 *
 * The interesting tests here are NOT "does bold work". They are the two
 * structural guarantees, because a markdown renderer is the classic place a
 * client grows an XSS hole:
 *
 *   - the XSS CORPUS: everything an answer could carry that must NOT become
 *     markup — and note the bot's answers quote user questions back, so the
 *     hostile string does not have to come from the bot to reach this code;
 *   - the INVARIANT SWEEP: EVERY '<' in the output must open or close a tag on
 *     the whitelist. That is the assertion that fails when someone later adds
 *     link syntax, or an attribute, without reading the header comment.
 *
 * Both run against the DEFAULT `inline` (esc). The `inline` hook is by design
 * the one place raw text enters the output, and a caller may pass a richer one
 * — main.ts passes iconizeText, which emits real <img> icons. The hook owns its
 * own markup and its own escaping (iconizeText escapes FIRST by construction);
 * what this file pins is that the RENDERER adds nothing beyond the whitelist.
 *
 * Fixtures are two real logged answers from ../../../logs/responses.jsonl,
 * inlined so the test does not depend on a file outside the repo.
 *
 * Seeds: none — this file is pure data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdToHtml, MD_TAGS } from '../../ui/markdown.ts';

/* ── the supported subset, one element at a time ───────────────────────── */

test('#82: each supported markdown element produces its own tag', () => {
  assert.match(mdToHtml('**bold**'), /<strong>bold<\/strong>/);
  assert.match(mdToHtml('*slanted*'), /<em>slanted<\/em>/);
  assert.match(mdToHtml('__bold__'), /<strong>bold<\/strong>/);
  assert.match(mdToHtml('a _slanted_ word'), /<em>slanted<\/em>/);
  assert.match(mdToHtml('`[Augment] I gain +2/+2.`'), /<code>\[Augment\] I gain \+2\/\+2\.<\/code>/);
  assert.match(mdToHtml('## Piercing'), /<h3>Piercing<\/h3>/);
  assert.match(mdToHtml('### Key Rules'), /<h4>Key Rules<\/h4>/);
  assert.match(mdToHtml('- one\n- two'), /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(mdToHtml('1. one\n2. two'), /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  assert.match(mdToHtml('> quoted'), /<blockquote><p>quoted<\/p><\/blockquote>/);
  assert.match(mdToHtml('plain'), /<p>plain<\/p>/);
  assert.match(mdToHtml('one\ntwo'), /<p>one<br>two<\/p>/);
});

test('#82: `##` is h3 and `###` is h4 — the overlay owns the h3 above them', () => {
  // the judge box titles itself with <h3>, so an answer's top heading must not
  // outrank it; h1/h2 are never emitted at all
  const out = mdToHtml('# One\n\n## Two\n\n### Three\n\n#### Four');
  assert.equal(out, '<h3>One</h3><h3>Two</h3><h4>Three</h4><h4>Four</h4>');
  assert.doesNotMatch(out, /<h[125-9]/);
});

test('#82: bold nests emphasis, and the plain text around a run survives', () => {
  assert.equal(
    mdToHtml('say **very *loudly* now** please'),
    '<p>say <strong>very <em>loudly</em> now</strong> please</p>',
  );
});

test('#82: unrecognised syntax falls through as literal escaped text', () => {
  // zero logged answers use links, tables, fenced code, --- or ~~strike~~, and
  // NOT implementing them is the security decision (see ui/markdown.ts). They
  // must degrade to the pre-#82 behaviour: visible, inert, escaped.
  for (const src of [
    '[label](https://example.com)',
    '| a | b |\n| - | - |',
    '~~struck~~',
    '---',
    '```js\ncode\n```',
    '![alt](x.png)',
  ]) {
    const out = mdToHtml(src);
    assert.doesNotMatch(out, /<a\b|href|<img|<table/, `${src} must not become markup`);
  }
});

/* ── the real logged answers ───────────────────────────────────────────── */

/** logs/responses.jsonl line 62 — headings, blockquote, bullets, bold, italic */
const FIXTURE_A = `## Vaporweave Eidolon

**Vaporweave Eidolon** is a **Cloud Spirit Unit** with cost **bb** (total 3), power/toughness **4/3**, and belongs to the **Water** faction.

Its ability is:

> **[zero]: [Switch1] Recall me.** *(Put me into your hand.)*

Key points about this card:

- **The [zero] is a cost** — you must expend 0 resources (no mana cost) to activate the ability.
- **The [Switch1] is the bounded graft symbol** — this means the ability can trigger at most **once per turn**.

### Interaction with Gravitational Correction

Per a definitive Discord ruling [ruling:discord-718], **Gravitational Correction can be used to change the target** — for example, redirecting the ability, in order to prevent the effect from fizzling.`;

/** logs/responses.jsonl line 49 — a LOOSE ordered list (blank lines between
 * items). The first cut of the renderer split it into four <ol>s each
 * restarting at "1.", which is why this fixture is here. */
const FIXTURE_B = `## How Piercing Excess Damage Works

**Piercing** is an attribute that causes excess combat damage to carry over [card:Pernicious Photosynthesis].

### Key Rules:

1. **Normal combat damage flow**: When a column takes damage, it's applied front-to-back [manual:0023].

2. **With Piercing**: excess damage beyond the back row unit's health carries over.

3. **Distinction from Electric**: Piercing sends excess to the *player*, while Electric redirects excess to *adjacent creatures* [glossary:electric].`;

/* ── the two guarantees ────────────────────────────────────────────────── */

/** everything a hostile or merely awkward answer could carry */
const XSS_CORPUS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '[x](javascript:alert(1))',
  '**<b>bold</b>**',
  '## <script>h</script>',
  '- <img onerror="alert(1)" src=y>',
  '> <iframe src="javascript:alert(1)"></iframe>',
  '`<script>in code</script>`',
  'raw & ampersand and " quote and <angle>',
  '*<svg/onload=alert(1)>*',
  '<a href="javascript:alert(1)">click</a>',
  '1. <object data="javascript:alert(1)">',
];

test('#82: the XSS corpus produces no script, no event handler, no href', () => {
  // The dangerous-substring checks are scoped to TAG INTERIORS. Correct
  // behaviour leaves `onerror=` and `javascript:` in the output as VISIBLE
  // ESCAPED TEXT — that is the renderer working, not failing — so a flat
  // string search would fail on a passing renderer. What must never happen is
  // one of those substrings landing inside a `<...>`.
  for (const src of XSS_CORPUS) {
    const out = mdToHtml(src);
    const inTags = [...out.matchAll(/<[^>]*>/g)].map(m => m[0]).join(' ');
    assert.doesNotMatch(out, /<script/i, `<script survived: ${src}`);
    assert.doesNotMatch(inTags, /\son\w+\s*=/i, `event handler survived: ${src}`);
    assert.doesNotMatch(inTags, /href/i, `href survived: ${src}`);
    assert.doesNotMatch(inTags, /javascript:/i, `live javascript: survived: ${src}`);
    assert.doesNotMatch(out, /<(img|iframe|svg|object|a)\b/i, `raw tag survived: ${src}`);
  }
  // and the text is still READABLE — inert is not the same as swallowed
  assert.match(mdToHtml('raw & ampersand'), /&amp; ampersand/);
  assert.match(mdToHtml('<script>alert(1)</script>'), /&lt;script&gt;/);
});

/** every '<' in `html`, as the tag name it opens or closes */
const tagsIn = (html: string): string[] =>
  [...html.matchAll(/<([^>]*)>/g)].map(m => m[1]!.replace(/^\//, ''));

test('#82: INVARIANT — every tag emitted is on the whitelist, and none has an attribute', () => {
  // This is the guard against a careless future addition. If someone adds link
  // syntax, or a class, or a style, this fails before it ships.
  const corpus = [...XSS_CORPUS, FIXTURE_A, FIXTURE_B,
    '**a** *b* `c`\n\n## d\n\n### e\n\n- f\n\n1. g\n\n> h\n\ni\nj'];
  const whitelist = new Set<string>(MD_TAGS);
  for (const src of corpus) {
    const out = mdToHtml(src);
    // every '<' that appears must have been consumed as a tag — a stray one
    // would mean unescaped text got through
    assert.equal((out.match(/</g) ?? []).length, (out.match(/<[^>]*>/g) ?? []).length,
      `stray '<' in output for: ${src.slice(0, 40)}`);
    for (const tag of tagsIn(out)) {
      assert.ok(whitelist.has(tag), `tag <${tag}> is not on the whitelist (from: ${src.slice(0, 40)})`);
      assert.doesNotMatch(tag, /[\s=]/, `<${tag}> carries an attribute — this renderer emits none`);
    }
  }
});

test('#82: a real logged judge answer renders as structure, not as asterisks', () => {
  const out = mdToHtml(FIXTURE_A);
  assert.match(out, /<h3>Vaporweave Eidolon<\/h3>/);
  assert.match(out, /<h4>Interaction with Gravitational Correction<\/h4>/);
  assert.match(out, /<blockquote><p><strong>\[zero\]: \[Switch1\] Recall me\.<\/strong> <em>\(Put me into your hand\.\)<\/em><\/p><\/blockquote>/);
  assert.match(out, /<ul><li>.*<\/li><li>.*<\/li><\/ul>/);
  // no markdown punctuation survives as literal text
  assert.doesNotMatch(out, /\*\*|^## |\n## /);
  // the un-rendered [card:…]/[ruling:…] citation tokens stay visible and inert
  assert.match(out, /\[ruling:discord-718\]/);
});

test('#82: a loose numbered list is ONE <ol>, not one per item', () => {
  const out = mdToHtml(FIXTURE_B);
  assert.equal((out.match(/<ol>/g) ?? []).length, 1, 'blank lines between items must not split the list');
  assert.equal((out.match(/<li>/g) ?? []).length, 3);
  assert.match(out, /<em>player<\/em>/);
  assert.match(out, /<h4>Key Rules:<\/h4>/);
});

/* ── the inline hook ───────────────────────────────────────────────────── */

/* main.ts passes `iconizeText`, which no test can import (it lives in main.ts,
 * which needs a DOM). This stub has its two load-bearing properties: it escapes
 * FIRST, and it turns a game token into an <img class="txticon">. What is being
 * pinned is that the hook composes THROUGH the block and emphasis structure —
 * an icon inside a bold bullet must reach the output as an icon inside
 * <strong> inside <li>. */
const escFirst = (s: string): string =>
  String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const iconize = (raw: string): string =>
  escFirst(raw).replace(/\[Switch1\]/g, '<img class="txticon" src="/data/icons/graft1.webp" alt="[Switch1]">');

test('#82: an icon token inside **bold** reaches the output as an icon inside <strong>', () => {
  const out = mdToHtml('- **[Switch1] Recall me.**', { inline: iconize });
  assert.match(out, /<li><strong><img class="txticon"[^>]*> Recall me\.<\/strong><\/li>/);
  // and the hook still escaped — it is the ONLY place raw text enters
  assert.match(mdToHtml('**<b>x</b>**', { inline: iconize }), /<strong>&lt;b&gt;x&lt;\/b&gt;<\/strong>/);
});

test('#82: the default inline hook is esc — nothing renders unescaped without one', () => {
  assert.equal(mdToHtml('a < b & c'), '<p>a &lt; b &amp; c</p>');
});

/* ── purity ────────────────────────────────────────────────────────────── */

test('#82: mdToHtml is pure — same input, same output, no state between calls', () => {
  const a = mdToHtml(FIXTURE_A);
  mdToHtml(FIXTURE_B);
  assert.equal(mdToHtml(FIXTURE_A), a);
  assert.equal(mdToHtml(''), '');
  assert.equal(mdToHtml('\n\n  \n'), '');
});
