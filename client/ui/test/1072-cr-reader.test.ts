/* 1072 — THE COMPREHENSIVE RULES, READ IN THE CLIENT: THE WHOLE EDITION
 * (ui/crreader.ts, 2026-11-04).
 *
 * The owner: "the CR are really clunky to read and navigate as a modal", and
 * then "why do we need a Comprehensive Rules and then a Full edition, with
 * sources? … Just the main Comprehensive Rules should be everything". So the
 * reader shows the document render.mjs buildReview() builds — the one the
 * generated page and the review page are drawn from — and nothing less.
 * Driven here with the REAL document and search data, without a DOM:
 *
 * §1 everything is there: the Introduction first, every section, Annex P,
 *    the glossary, the changelog, Annex D, the discrepancy report last; every
 *    rule findable; each rule's sources; no link left that would move the
 *    browser instead of the reader
 * §2 the search: a rule number (a section, the rule, the rules under it),
 *    words (all of them), glossary terms; marked snippets
 * §3 moving: a section, a rule, a link's target, a discrepancy, Back
 * §4 the panes: the contents with the place lit, the search box's ids, loading
 * §5 one edition: the reader's bar links no second one; the search data
 *    carries no provenance (the document does)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CR_JSON } from '../../engine/scripts/paths.mjs';
import { CR_DATA_URL } from '../assets.ts';
import {
  DISC, buildModel, crNavListHtml, crOpenAt, crReaderHtml, crSearch, goBack, goTo, handleCrButton, rewireLinks,
  setCrModel, setCrQuery, type CrData, type CrDoc,
} from '../crreader.ts';
import { rulesBoxHtml } from '../rules.ts';

const DATA = JSON.parse(readFileSync(CR_JSON, 'utf8')) as CrData & { rules: { num: string }[] };
const { buildReview } = await import('../../engine/scripts/cr/render.mjs') as { buildReview: () => Promise<CrDoc> };
const DOC = await buildReview();
const M = buildModel(DATA, DOC);

test('1072 §1 the whole edition is there, in order, every rule with its sources', () => {
  const ids = M.places.map(p => p.id);
  assert.equal(ids[0], 'front', 'the Introduction comes first');
  assert.equal(ids[ids.length - 1], DISC, 'the discrepancy report comes last');
  for (const want of ['s100', 's608', 'annexP', 'glossary', 'changelog', 'sD1']) assert.ok(ids.includes(want), `${want} is a place`);
  assert.match(M.byPlace.get('front')!.html, /UNOFFICIAL/, 'the Introduction says what the document is');
  assert.equal((M.byPlace.get('front')!.html.match(/>Introduction</g) ?? []).length, 1, 'one heading, not two');
  for (const id of ['annexP', 'glossary', 'changelog']) assert.match(M.byPlace.get(id)!.html, /^\s*(?:<div[^>]*>\s*)?<h[23]/, `${id} has its heading`);
  assert.match(M.byPlace.get('sD1')!.html, /annexD|precedence|Annex D/i, 'Annex D\'s lead is drawn before its first section');
  for (const r of [...DATA.rules, ...DATA.annexD]) assert.ok(M.placeOf.has(`r${r.num}`), `rule ${r.num} has a place`);
  assert.match(M.byPlace.get('s608')!.html, /Sources and verification/, 'each rule\'s sources are folded under it');
  for (const p of M.places) assert.doesNotMatch(p.html, /\shref="#/, `${p.id}: a link would move the browser, not the reader`);
  assert.match(rewireLinks('<p>See <a class="num" href="#r104">104</a> and <a href="https://x">x</a></p>'),
    /<a class="num" data-btn="crgo" data-to="r104" role="link" tabindex="0">104<\/a> and <a href="https:\/\/x">/);
});

test('1072 §2 the search: numbers first, then words and glossary terms', () => {
  assert.equal(crSearch(M, '608.2b')[0]!.to, '608.2b');
  const sec = crSearch(M, '608');
  assert.equal(sec[0]!.to, '608', 'a section number finds the section first');
  assert.ok(sec.slice(1).every(h => h.to.startsWith('608')), '…then its rules');
  assert.equal(crSearch(M, 'd3.1')[0]?.to.startsWith('D3'), true, 'an Annex D number in any case');
  const hits = crSearch(M, 'deadly');
  assert.ok(hits.some(h => h.num === 'Glossary' && h.label === 'Deadly'), 'the glossary answers too');
  assert.ok(hits.some(h => /<mark>deadly<\/mark>/i.test(h.snippet)));
  assert.deepEqual(crSearch(M, 'zzqxv nothing'), []);
  assert.deepEqual(crSearch(M, '   '), []);
  assert.ok(crSearch(M, 'the', 5).length <= 5, 'the list is capped');
});

test('1072 §3 moving: a section, a rule, a link, a discrepancy, Back', () => {
  setCrModel(M);
  crOpenAt(null);
  assert.ok(goTo('608'));
  assert.match(crReaderHtml('/x'), /<button class="rdtocsec on" data-btn="crgo" data-to="s608">/);
  assert.ok(goTo('608.2b'), 'a rule number');
  assert.match(crReaderHtml('/x'), /data-btn="crback">← Back to 608</);
  assert.ok(goTo('r104'), 'a link\'s target, as the document spells it');
  assert.match(crReaderHtml('/x'), /data-to="s104"[^>]*>|class="rdtocsec on" data-btn="crgo" data-to="s104"/);
  assert.match(crReaderHtml('/x'), /← Back to 608\.2b</, 'Back names the rule it returns to');
  const d = DOC.disc[0]!.id;
  assert.ok(goTo(d), 'a discrepancy');
  assert.match(crReaderHtml('/x'), /class="rdtocsec on" data-btn="crgo" data-to="disc"/);
  assert.ok(handleCrButton({ dataset: { btn: 'crback' } }), 'Back through the button\'s own handler');
  // four moves were made, so four steps back: the handler's, then three more
  assert.ok(goBack() && goBack() && goBack());
  assert.equal(goBack(), false, 'nowhere further');
  assert.equal(goTo('999.9'), false, 'an unknown rule goes nowhere');
  crOpenAt('608.2b');
  assert.doesNotMatch(crReaderHtml('/x'), /data-btn="crback"/, 'a link opens with no Back');
  assert.match(crReaderHtml('/x'), /class="rdtocsec on" data-btn="crgo" data-to="s608"/);
  assert.equal(handleCrButton({ dataset: { btn: 'helpclose' } }), false);
});

test('1072 §4 the panes: contents, search, loading', () => {
  setCrModel(M);
  crOpenAt('front');
  setCrQuery('');
  const toc = crNavListHtml();
  assert.match(toc, /<div class="rdtoc rdtocone"><button class="rdtocsec on" data-btn="crgo" data-to="front">Introduction<\/button><\/div>/);
  assert.match(toc, /<div class="rdtocchap">6\. Regions, Formations and Battle<\/div>/);
  setCrQuery('608.2b');
  assert.match(crNavListHtml(), /<ol class="rdhits">/);
  setCrQuery('');
  const html = crReaderHtml('/full');
  assert.match(html, /<input id="rules-q" class="rulesq" type="search"/, 'the search box keeps the id the board and the layer wire');
  assert.match(html, /id="cr-nav" data-scroll="cr-nav"/);
  assert.match(html, /id="cr-text" data-scroll="cr-text"/);
  assert.match(html, /<div class="crdoc rddoc">/, 'the document is styled as the review page styles it');
  setCrModel(null);
  assert.match(crReaderHtml('/full'), /Loading the rules…/);
  setCrModel(M);
});

test('1072 §5 one edition: no second one linked, and the search data carries no provenance', () => {
  assert.doesNotMatch(rulesBoxHtml('cr', ''), /Full edition/, 'the reader links a second, fuller edition again');
  assert.equal(CR_DATA_URL, '/comprehensive-rules.json');
  const main = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8');
  assert.match(main, new RegExp(`const CR_DATA_URL = '${CR_DATA_URL.replace(/\./g, '\\.')}';`));
  const lean = main.slice(main.indexOf('const lean = '), main.indexOf('const body = JSON.stringify'));
  assert.ok(lean.length > 50, 'positive control: the lean row is read');
  for (const field of ['discrepancies', 'verdict', 'basis']) assert.doesNotMatch(lean, new RegExp(`\\b${field}:`), `${field} in the search data`);
});
