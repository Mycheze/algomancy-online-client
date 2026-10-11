/**
 * The rules review page, after the owner's reading (2026-10-11): "the
 * additional information after each rule is a bit too long", "there's no
 * search bar anywhere", "no easy way to link people to specific places", and
 * Annex P's findings "seem to be super repetitive". What each fix promises:
 *
 *   §1 under a rule a reader sees its words, its examples' words ("Example:",
 *      never "(non-normative)") and the warnings; the basis and verdict chips,
 *      the verification line, test bindings, discrepancy ids and sources are
 *      in the rule's fold, in the review page and the .html edition alike.
 *   §2 an example with no words (a demonstration) prints nothing in the body
 *      of any edition, and its test is listed as "Demonstrated by test".
 *   §3 every rule, section and chapter heading has an id the page reads back
 *      from a link, and the page puts a copy-link button on each; the link is
 *      `?crreview=1&at=<id>`, and a `#<id>` works too.
 *   §4 Annex P lists each divergence once: a finding another lists in its
 *      `dupes` folds into that entry, its id an anchor there, so a rule's
 *      "engine differs, see <dupe>" still lands; a shared CT ticket groups.
 *   §5 the search: a number jumps (802.1 finds 802.1 and 802.1a, not
 *      802.10), words find rules, terms and findings, a folded-in dupe's id
 *      finds its entry, the fold's test bindings are never searched, and
 *      the snippet is escaped text with the words marked.
 *
 * Over the COMMITTED records, built as the server builds them (buildReview),
 * plus a copy with a text-less example planted in it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract } from '../../engine/scripts/cr/extract.mjs';
import { buildReview, loadInputs, render } from '../../engine/scripts/cr/render.mjs';
import { placer } from '../cranchor.ts';
import { asNumber, buildSearchIndex, highlight, searchIndex, snippet } from '../crsearch.ts';
import type { CrReview } from '../crtypes.ts';

const UI = dirname(dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(join(UI, 'crreview.ts'), 'utf8');
const EX = extract();
const R: CrReview = await buildReview({ ex: EX });
const INPUTS = loadInputs();
const FILES = render(INPUTS, EX).files;

/** every rule article in some html, as [number, the article's html] */
const articles = (html: string): [string, string][] =>
  [...html.matchAll(/<article class="rule[^"]*" id="r([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)].map(m => [m[1]!, m[2]!]);
/** what a reader sees of a rule with its fold closed */
const unfolded = (body: string): string => body.replace(/<details class="prov">[\s\S]*?<\/details>/, '');

/** things that belong in the fold and nowhere else under a rule */
const FOLD_ONLY: [RegExp, string][] = [
  [/verified in round|verifier ran|gate test/, 'the verification line'],
  [/\.test\.ts|::/, 'a test binding'],
  [/class="chip b-/, 'the basis chip'],
  [/class="chip v-confirmed"/, 'the verdict chip'],
  [/href="#D-/, 'a discrepancy id'],
  [/class="src"|class="sk"/, 'the sources'],
];

test('§1 a rule body holds no verification line, test binding, chip or source: those are in its fold', () => {
  for (const [where, html] of [['review', R.parts.map(p => p.html).join('\n')], ['.html edition', FILES.html]] as const) {
    const rules = articles(html);
    assert.ok(rules.length > 1700, `${where}: only ${rules.length} rules found`);
    let folds = 0;
    for (const [num, body] of rules) {
      if (/class="rule[^"]*tomb/.test(body) || !/<p class="rt">/.test(body)) continue;
      const n = (body.match(/<details class="prov">/g) ?? []).length;
      if (/\[No record\]/.test(body)) continue;
      assert.equal(n, 1, `${where} ${num}: ${n} folds`);
      folds++;
      const seen = unfolded(body);
      for (const [re, what] of FOLD_ONLY) assert.doesNotMatch(seen, re, `${where} ${num}: ${what} is outside the fold`);
    }
    // positive control: the fold really holds them
    const all = rules.map(([, b]) => b).join('');
    for (const [re, what] of FOLD_ONLY) assert.match(all, re, `${where}: no fold holds ${what} — the check above proves nothing`);
    assert.ok(folds > 1700, `${where}: only ${folds} folds`);
  }
});

test('§1 an example is "Example:" in every edition, never "(non-normative)", and its test is provenance', () => {
  for (const [k, text] of Object.entries(FILES)) assert.doesNotMatch(text, /non-normative/, `${k} still says non-normative`);
  assert.match(FILES.html, /<p class="ex"><span class="exl">Example:<\/span> /);
  assert.match(FILES.doc, /^> \*Example: /m);
  assert.match(FILES.txt, /^ {6}Example: /m);
  // the binding moved out of the body line into the provenance line
  assert.doesNotMatch(FILES.doc, /^> \*Example:.*(?:<sub>|::)/m);
  assert.doesNotMatch(FILES.txt, /^ {6}Example:.*\[test: /m);
  assert.match(FILES.doc, /<sub>[^\n]* · Example tests?: [^\n]*::/);
  // the front matter says, once, what an example is
  assert.match(FILES.doc, /An example illustrates the rule above it: an illustration, never a rule/);
});

test('§2 an example with no words prints nothing in any body, and its test is listed as "Demonstrated by test"', () => {
  const i = loadInputs();
  const withEx = i.records.filter(r => (r.examples ?? []).some(x => x.test) && (r.examples ?? []).length === 1);
  assert.ok(withEx.length > 10, 'positive control: rules with one bound example');
  const [a, b] = [withEx[0]!, withEx[1]!];
  const [ta, tb] = [a.examples![0]!.test!, b.examples![0]!.test!];
  // a text-less example, both ways it may be spelled; the schema is not this test's business
  (a as { examples: unknown[] }).examples = [{ text: null, test: ta }];
  (b as { examples: unknown[] }).examples = [{ text: '', test: tb }];
  const f = render(i, EX).files;
  const num = (k: string): string => R.keys[k]!;
  for (const [rec, t] of [[a, ta], [b, tb]] as const) {
    const n = num(rec.key);
    const html = articles(f.html).find(([x]) => x === n)![1];
    assert.doesNotMatch(unfolded(html), /class="ex"|Example|null/, `${n}: the html body shows the demonstration`);
    assert.ok(html.includes('Demonstrated by test</span> <code>') && html.includes(t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')),
      `${n}: the fold does not name the demonstration`);
    const md = f.doc.slice(f.doc.indexOf(`<a id="r${n}"></a>`), f.doc.indexOf('<a id="r', f.doc.indexOf(`<a id="r${n}"></a>`) + 5));
    assert.doesNotMatch(md, /> \*Example|null/, `${n}: the md body shows the demonstration`);
    assert.ok(md.includes(`Demonstrated by test: ${t}`), `${n}: the md provenance line does not name it`);
    const txtAt = f.txt.search(new RegExp(`^${n.replace(/\./g, '\\.')}\\.? `, 'm'));
    const txt = f.txt.slice(txtAt, f.txt.indexOf('\n\n', txtAt));
    assert.doesNotMatch(txt, /Example:|null/, `${n}: the txt body shows the demonstration`);
    assert.ok(txt.includes('Demonstrated by test: '), `${n}: the txt provenance line does not name it`);
  }
});

test('§3 every rule, section and chapter heading has an id the page reads back, and the page puts a copy-link button on each', () => {
  const p = placer(R);
  const ids: string[] = [];
  for (const part of R.parts) {
    for (const m of part.html.matchAll(/<(?:article class="rule[^"]*"|h3|h2) id="([^"]+)"/g)) ids.push(m[1]!);
  }
  for (const e of R.toc) if (e.sections) ids.push(e.id); // the page paints a chapter's <h2 id="ch6">
  assert.ok(ids.length > 1800, `only ${ids.length} linkable places`);
  assert.equal(new Set(ids).size, ids.length, 'an id is used twice: a link would land on the first');
  for (const id of ids) {
    const at = p.ofRef(id);
    assert.ok(at, `${id}: a link to it would land nowhere`);
    if (/^r/.test(id)) assert.equal(at!.anchor, id);
  }
  // the page: the button goes on exactly these, and copies `?crreview=1&at=`
  const fn = page.slice(page.indexOf('function addShareButtons'), page.indexOf('/** the absolute link a share button copies'));
  assert.match(fn, /querySelectorAll\('article\.rule\[id\], h3\[id\], h2\[id\], article\.fnd\[id\], article\.disc\[id\]'\)/);
  assert.match(fn, /dataset\['btn'\] = 'cr-copylink'/);
  assert.match(fn, /setAttribute\('data-crui', ''\)/, 'a decoration: never part of an item\'s text, removed with the others');
  assert.match(page, /addShareButtons\(col\);/);
  assert.match(page, /`\$\{location\.origin\}\/\?crreview=1&at=\$\{encodeURIComponent\(at\)\}`/);
  assert.match(page, /navigator\.clipboard[\s\S]{0,700}document\.execCommand\('copy'\)/, 'a fallback where there is no clipboard API (http on the LAN)');
  // a part painted alone gets an id on the heading the page draws for it
  assert.match(page, /`<h2 id="\$\{esc\(e\.id\)\}">\$\{esc\(e\.title\)\}<\/h2>\$\{html\}`/);
  // and the link opens the page there: `at`, or the .html edition's own hash
  assert.match(page, /wantAt = q\.get\('at'\) \?\? \(location\.hash\.length > 1 \? decodeURIComponent\(location\.hash\.slice\(1\)\) : null\);/);
});

test('§4 Annex P lists each divergence once; a folded-in dupe\'s id lands on its entry; a shared ticket groups', () => {
  const dupeOf = new Map<string, string>();
  for (const f of INPUTS.findings) for (const d of f.dupes ?? []) dupeOf.set(d, f.id);
  assert.ok(dupeOf.size > 20, `positive control: only ${dupeOf.size} dupes in the committed findings`);
  const annexP = R.parts.find(x => x.id === 'annexP')!.html;
  const entries = [...annexP.matchAll(/<article class="fnd" id="([^"]+)"/g)].map(m => m[1]!);
  assert.equal(entries.length, INPUTS.findings.length - dupeOf.size, 'one entry per divergence');
  for (const [d, primary] of dupeOf) {
    assert.ok(!entries.includes(d), `${d} is listed again`);
    const at = annexP.indexOf(`<article class="fnd" id="${primary}"`);
    const end = annexP.indexOf('</article>', at);
    assert.ok(annexP.slice(at, end).includes(`<span id="${d}"></span>`), `${d} does not land on ${primary}`);
  }
  // every "engine differs, see F-…" a rule prints lands on an element of Annex P, in both html forms
  const cited = new Set(INPUTS.records.flatMap(r => r.engineDiffers ?? []));
  assert.ok(cited.size > 30);
  for (const id of cited) {
    assert.ok(annexP.includes(` id="${id}"`), `${id}: a rule links to it and the page has no such element`);
    assert.ok(FILES.html.includes(` id="${id}"`), `${id}: the .html edition has no such element`);
  }
  // a ticket shared by two or more entries heads a group; every entry still names its rules
  const groups = [...annexP.matchAll(/<div class="fgroup"><p class="fgh"><span class="num">(CT-\d+)<\/span>/g)].map(m => m[1]!);
  assert.ok(groups.length >= 5, `only ${groups.length} shared tickets`);
  assert.equal(new Set(groups).size, groups.length, 'a ticket heads two groups');
  for (const m of annexP.matchAll(/<p class="dh">([\s\S]*?)<\/p>/g)) assert.match(m[1]!, /rules? <a href="#r|no rule of its own/);
  // one line each: the long summary is behind the entry's fold
  for (const m of annexP.matchAll(/<article class="fnd"[^>]*>([\s\S]*?)<\/article>/g)) {
    assert.match(m[1]!, /^(?:<span id="[^"]+"><\/span>)*<p class="dh">[\s\S]*?<\/p><details><summary>/);
  }
  // the .md edition: each id is an anchor exactly once
  for (const f of INPUTS.findings) assert.equal(FILES.doc.split(`<a id="${f.id}"></a>`).length, 2, `${f.id} is not one anchor in the .md`);
});

test('§5 search: a number jumps, words find, dupe ids land, the fold is never searched, snippets are escaped', () => {
  const t0 = performance.now();
  const ix = buildSearchIndex(R);
  const built = performance.now() - t0;
  assert.ok(ix.filter(e => e.kind === 'rule').length > 1700);
  assert.ok(built < 2000, `the index took ${Math.round(built)} ms`);
  // numbers
  assert.equal(asNumber('802.1'), '802.1');
  assert.equal(asNumber('r608.2B'), '608.2b');
  assert.equal(asNumber('d3.1'), 'D3.1');
  assert.equal(asNumber('608.'), '608');
  assert.equal(asNumber('swift'), null);
  const n = searchIndex(ix, '802.1');
  assert.equal(n.hits[0]?.e.at, 'r802.1', 'the exact number first');
  assert.ok(n.hits.every(h => /^802\.1(?![0-9])/.test(h.e.label)), '802.1 finds 802.1a, not 802.10');
  const sec = searchIndex(ix, '608');
  assert.equal(sec.hits[0]?.e.kind, 'section');
  assert.ok(sec.hits.length > 3 && sec.hits.slice(1).every(h => h.e.label.startsWith('608.')));
  // words: a glossary term ranks first by its own name; every word must occur
  const gloss = ix.find(e => e.kind === 'gloss')!;
  assert.ok(gloss, 'positive control: the glossary is indexed');
  assert.equal(searchIndex(ix, gloss.title).hits[0]?.e.at, gloss.at);
  const two = searchIndex(ix, 'damage column');
  assert.ok(two.total > 0 && two.hits.every(h => h.e.hay.includes('damage') && h.e.hay.includes('column')));
  // a finding, and a dupe folded into it
  const dupe = INPUTS.findings.find(f => f.dupes?.length)!;
  assert.equal(searchIndex(ix, dupe.dupes![0]!).hits[0]?.e.at, dupe.id);
  assert.equal(searchIndex(ix, dupe.id).hits[0]?.e.at, dupe.id);
  // the fold (sources, test bindings) is not searched: a test file name finds no rule
  assert.ok(R.parts.some(p => p.html.includes('412-cr-general.test.ts')), 'positive control: the binding is in the page');
  assert.equal(searchIndex(ix, '412-cr-general.test.ts').hits.filter(h => h.e.kind === 'rule').length, 0);
  // fast enough to run per keystroke over the whole document
  const t1 = performance.now();
  for (const q of ['the', 'unit', 'stack priority', 'z', '1']) searchIndex(ix, q);
  assert.ok(performance.now() - t1 < 500, 'five queries took more than half a second');
  // escaped text, words marked
  assert.equal(highlight('a <b> & Swift', ['swift']), 'a &lt;b&gt; &amp; <mark>Swift</mark>');
  assert.equal(highlight('stack the stack', ['stack', 'the']), '<mark>stack</mark> <mark>the</mark> <mark>stack</mark>');
  const sn = snippet(`${'x '.repeat(200)}needle ${'y '.repeat(200)}`, ['needle']);
  assert.match(sn, /^….*<mark>needle<\/mark>.*…$/);
  assert.ok(sn.length < 260);
});
