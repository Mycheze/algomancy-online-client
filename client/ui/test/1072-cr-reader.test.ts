/* 1072 — THE COMPREHENSIVE RULES, READ IN THE CLIENT (ui/crreader.ts, 2026-11-04).
 *
 * The owner: "the CR are really clunky to read and navigate as a modal". The
 * tab framed the generated page; it reads the rules' data now. Driven here
 * with the REAL generated .json, without a DOM:
 *
 * §1 the model: every rule and Annex D rule under its section, in document
 *    order, then the glossary
 * §2 the search: a rule number (exact first, then the rules under it), a
 *    section number, words (all of them), glossary terms; marked snippets
 * §3 a rule's words: icons drawn, rule numbers linked — dotted ones, "rule
 *    104", "(111)" — and never a number that is not a rule ("100 life")
 * §4 moving: a section, a rule (picked out, its section on screen), Back
 * §5 the panes: the contents with the section lit, loading, failing (with the
 *    full edition's link), and the buttons it answers
 * §6 the server serves the data without provenance at the URL the browser asks
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CR_JSON } from '../../engine/scripts/paths.mjs';
import { CR_DATA_URL } from '../assets.ts';
import {
  GLOSSARY, buildModel, crNavListHtml, crOpenAt, crReaderHtml, crSearch, crTextHtml, goBack, goTo, handleCrButton,
  setCrModel, setCrQuery, type CrData,
} from '../crreader.ts';

const DATA = JSON.parse(readFileSync(CR_JSON, 'utf8')) as CrData;
const M = buildModel(DATA);

test('1072 §1 the model holds every rule under its section, in order, then the glossary', () => {
  assert.ok(DATA.rules.length > 1000 && DATA.glossary.length > 100, 'the generated rules are read');
  assert.equal(M.byNum.size, DATA.rules.length + DATA.annexD.length);
  assert.equal(M.sections[0]!.num, '100');
  assert.equal(M.sections[M.sections.length - 1]!.num, GLOSSARY);
  assert.ok(M.bySection.get('608')!.rules.some(r => r.num === '608.2b'));
  assert.ok(M.sections.some(s => s.num.startsWith('D')), 'Annex D is in the contents');
  const nums = M.sections.flatMap(s => s.rules.map(r => r.num));
  assert.deepEqual(nums, [...DATA.rules, ...DATA.annexD].map(r => r.num), 'document order');
});

test('1072 §2 the search: numbers first, then words and glossary terms', () => {
  const exact = crSearch(M, '608.2b');
  assert.equal(exact[0]!.to, '608.2b');
  const sec = crSearch(M, '608');
  assert.equal(sec[0]!.to, '608', 'a section number finds the section first');
  assert.ok(sec.slice(1).every(h => h.to.startsWith('608')), '…then its rules');
  const words = crSearch(M, 'deadly source');
  assert.ok(words.length > 0);
  for (const h of words.filter(h => h.num !== 'Glossary')) {
    const r = M.byNum.get(h.to)!;
    assert.match(`${r.title ?? ''} ${r.text} ${r.examples.join(' ')}`.toLowerCase(), /deadly[\s\S]*|source/);
  }
  assert.ok(crSearch(M, 'deadly').some(h => h.num === 'Glossary' && h.label === 'Deadly'), 'the glossary answers too');
  assert.match(crSearch(M, 'deadly')[0]!.snippet, /<mark>deadly<\/mark>/i);
  assert.deepEqual(crSearch(M, 'zzqxv nothing'), []);
  assert.deepEqual(crSearch(M, '   '), []);
  assert.ok(crSearch(M, 'the', 5).length <= 5, 'the list is capped');
});

test('1072 §3 a rule\'s words: rule numbers are links, other numbers are not', () => {
  const link = (n: string) => `<button class="rdref" data-btn="crgo" data-to="${n}">${n}</button>`;
  assert.ok(crTextHtml(M, 'as 608.2b says').includes(link('608.2b')));
  assert.ok(crTextHtml(M, 'see rule 104 for more').includes(`rule ${link('104')}`));
  assert.ok(crTextHtml(M, 'cannot be paid at all (111).').includes(`(${link('111')})`));
  assert.equal(crTextHtml(M, 'start at 100 life'), 'start at 100 life', 'a bare number is not a rule');
  assert.equal(crTextHtml(M, 'rule 999.9z'), 'rule 999.9z', 'a number that names no rule is text');
  assert.doesNotMatch(crTextHtml(M, '<script>'), /<script>/, 'the words are escaped');
  assert.match(crTextHtml(M, 'no {Battle} icon'), /<img|txticon/, 'the game\'s icons are drawn');
});

test('1072 §4 moving: a section, a rule, Back', () => {
  setCrModel(M);
  crOpenAt(null);
  assert.ok(goTo('608'));
  let html = crReaderHtml('/x');
  assert.match(html, /<h2><span class="rdnum">608\.<\/span> /);
  assert.ok(goTo('104.1a'));
  html = crReaderHtml('/x');
  assert.match(html, /<article class="rdrule sub at" id="cr-r-104\.1a">/, 'the rule is picked out');
  assert.match(html, /data-btn="crback">← Back to 608</);
  // Back through the button's own handler, as the board and the layer route it
  assert.ok(handleCrButton({ dataset: { btn: 'crback' } }));
  assert.doesNotMatch(crReaderHtml('/x'), /class="rdrule[^"]* at"/, 'back at the section, nothing picked out');
  assert.equal(goBack(), true, 'and once more, to where the walk began');
  assert.equal(goBack(), false, 'nowhere further');
  assert.equal(goTo('999.9'), false, 'an unknown rule goes nowhere');
  crOpenAt('608.2b');
  assert.match(crReaderHtml('/x'), /id="cr-r-608\.2b"/);
  assert.doesNotMatch(crReaderHtml('/x'), /data-btn="crback"/, 'a link opens with no Back');
  assert.ok(handleCrButton({ dataset: { btn: 'crgo', to: GLOSSARY } }));
  assert.match(crReaderHtml('/x'), /<dl class="rdgloss">/);
  assert.equal(handleCrButton({ dataset: { btn: 'helpclose' } }), false);
});

test('1072 §5 the panes: contents, search, loading and failing', () => {
  setCrModel(M);
  crOpenAt('101');
  setCrQuery('');
  assert.match(crNavListHtml(), /<button class="rdtocsec on" data-btn="crgo" data-to="101">/);
  setCrQuery('608.2b');
  assert.match(crNavListHtml(), /<ol class="rdhits">/);
  setCrQuery('');
  const html = crReaderHtml('/full');
  assert.match(html, /<input id="rules-q" class="rulesq" type="search"/, 'the search box keeps the id the board and the layer wire');
  assert.match(html, /id="cr-nav" data-scroll="cr-nav"/);
  assert.match(html, /id="cr-text" data-scroll="cr-text"/);
  setCrModel(null);
  assert.match(crReaderHtml('/full'), /Loading the rules…/);
  setCrModel(M);
});

test('1072 §6 the server serves the rules without provenance, where the browser asks', () => {
  assert.equal(CR_DATA_URL, '/comprehensive-rules.json');
  const main = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8');
  assert.match(main, new RegExp(`const CR_DATA_URL = '${CR_DATA_URL.replace(/\./g, '\\.')}';`));
  const lean = main.slice(main.indexOf('const lean = '), main.indexOf('const body = JSON.stringify'));
  assert.ok(lean.length > 50, 'positive control: the lean row is read');
  for (const field of ['discrepancies', 'verdict', 'basis', 'key']) assert.doesNotMatch(lean, new RegExp(`\\b${field}:`), `${field} reaches the player`);
});
