/* 1198 · EVERY PAGE'S TITLE BAR AND FOOTER IN THE HOME'S BRAND FACE
 * (report #361, CT-550, 2026-11-09).
 *
 * mycheze: "We should use the same font from the homepage in the headers and
 * footers of all pages." The home sets its headings and its footer's
 * "Algomancy" in the brand's wide face (styles/pages/54-home-art.css, "the
 * brand face"); every other page is drawn in the app frame (pages/frame.ts),
 * whose title and footer button used the plain body face.
 *
 *   §1 the markup: the frame's footer button carries the home's label — the
 *      wordmark span, then "Online", then the muted "(Unofficial Client)" —
 *      and its accessible name is unchanged
 *   §2 the CSS: the frame's title takes the brand face, as the home's headings
 *      do; what rides beside the name (the subtitle, the deck's pill and
 *      summary, a league tag) keeps the plain face; the wordmark rule is not
 *      scoped to the home, so it reaches the frame's footer
 *
 * No browser runs here; seeing it is the CT's verify line.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStyles } from './read-styles.ts';
import { CLIENT_INFO, frameHtml } from '../pages/frame.ts';

const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, ' ');
/** every declaration block whose selector list contains `sel` as one selector */
const decls = (sel: string): string => {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1]!.split(',').map(s => s.trim().replace(/\s+/g, ' ')).includes(sel)) out.push(m[2]!);
  }
  return out.join(';');
};

test(`1198 §1 the frame's footer says "Algomancy" in the wordmark, as the home's does`, () => {
  assert.match(CLIENT_INFO, /aria-label="Algomancy Online \(Unofficial Client\)"/, 'the accessible name is unchanged');
  assert.match(CLIENT_INFO,
    /<span class="homewordmark">Algomancy<\/span> Online <span class="homewordsub">\(Unofficial Client\)<\/span>/);
  const html = frameHtml({ page: 'p', title: 'Decks', back: { dataBtn: 'b', label: 'Home' }, chrome: { signedIn: false, alerts: 0 }, mainHtml: '' });
  assert.match(html, /<footer class="ui-app-shell__bottom">[\s\S]*frameinfo[\s\S]*class="homewordmark"/, 'every framed page draws it');
});

test("1198 §2 the frame's title takes the brand face; what rides beside it does not", () => {
  const title = decls('.frametitle');
  assert.match(title, /font-family:\s*var\(--font-brand\)/, 'the page name is in the brand face');
  assert.match(title, /text-transform:\s*uppercase/, 'set as the home sets its headings');
  for (const sel of ['.frametitle small', '.frametitle .ttpill', '.frametitle .ttsummary', '.frametitle .lgtag']) {
    assert.match(decls(sel), /font-family:\s*var\(--font-ui\)/, `${sel} keeps the plain face`);
    assert.match(decls(sel), /text-transform:\s*none/, `${sel} is not uppercased`);
  }
  assert.match(decls('.homewordmark'), /font-family:\s*var\(--font-brand\)/,
    'the wordmark rule stands on its own, not under the home\'s root, so it reaches the frame');
});
