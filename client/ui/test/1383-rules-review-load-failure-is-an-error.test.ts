/* 1383 · THE RULES REVIEW SAYS ITS DOCUMENT DID NOT LOAD AS AN ERROR
 * (BL-10, the visual polish pass, 2026-11-15).
 *
 * Inventory 04 §L.7: "CR document load error uses dim `.crnote`
 * (crreview.ts:680) while comment errors use red `.crmsg`". When the rules
 * review could not fetch its document, the page's whole column was "could not
 * reach the server" in the small grey of a side note, with no way to ask again
 * but reloading the page.
 *
 *   §1 a failure is the boxed error tone (red on the danger tint,
 *      role="alert") saying what did not load, with a Try again button;
 *      loading is still the dim note, and has no button
 *   §2 the page draws that column through docMissingHtml, and Try again
 *      loads the document again
 *
 * Reasoned, not looked at (no browser on the box).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { docMissingHtml } from '../crreview.ts';

const SRC = readFileSync(fileURLToPath(new URL('../crreview.ts', import.meta.url)), 'utf8');

test('§1 a document that did not load is drawn as an error, with Try again', () => {
  const failed = docMissingHtml('could not reach the server');
  assert.match(failed, /<div class="ui-status ui-status--error ui-status--boxed crdocerr" role="alert">The rules document could not load: could not reach the server<\/div>/);
  assert.doesNotMatch(failed, /class="crnote"/, 'not the dim note');
  assert.match(failed, /<button data-btn="cr-retry">Try again<\/button>/);
  assert.match(docMissingHtml('<b>x</b>'), /could not load: &lt;b&gt;x&lt;\/b&gt;/, 'the server\'s words are escaped');
  const loading = docMissingHtml('');
  assert.match(loading, /<p class="crnote">Loading the document…<\/p>/);
  assert.doesNotMatch(loading, /ui-status--error|cr-retry/);
});

test('§2 the page uses it, and Try again loads the document again', () => {
  assert.match(SRC, /const body = !doc\s*\? docMissingHtml\(docErr\)/);
  assert.match(SRC, /case 'cr-retry': void loadDoc\(\); paint\(\); return true;/);
});
