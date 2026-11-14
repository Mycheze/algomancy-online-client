/* 1245 — LEARN AND RULES WORDS NAME THE BUTTONS AS THEY ARE DRAWN (BL-10,
 * 2026-11-14; docs/23-ui-inventory/04 §L.13 "Copy inconsistencies").
 *
 * §1 the Learn menu says the element as its button does: "Continue your Fire
 *    game" beside the Fire button, not "Continue your fire game"
 * §2 a lesson points at a toolbar button by the glyph the toolbar draws. The
 *    toolbar's ?, ⚖ and 📝 are bare glyphs; "**? rules** (on the toolbar)",
 *    "**⚖ judge**" and "the **📝 Report** button" named labels no button has.
 *    A census: every bare-glyph toolbar button in main.ts, and no bold run in
 *    lessons.ts that puts a word after one of those glyphs.
 * §3 the rules review's ← Close says what it does: it said "back to the
 *    lobby", a screen it never went to (close() hands the page back to
 *    whatever was under it). No title in ui/, pages/ or components/ names
 *    the lobby.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { learnMenuHtml, learnMenuView } from '../pages/learn.ts';
import { LEARN_ELEMENTS } from '../lessondeck.ts';
import type { LearnProgress } from '../learn.ts';

const UI = fileURLToPath(new URL('..', import.meta.url));
const read = (f: string): string => readFileSync(UI + f, 'utf8');
const saved = (element: string, tips = false): LearnProgress =>
  ({ v: 1, element, seen: [], game: {}, tips } as unknown as LearnProgress);

test('1245 §1 the Learn menu writes the element as its button does', () => {
  for (const e of LEARN_ELEMENTS) {
    const cap = `${e[0]!.toUpperCase()}${e.slice(1)}`;
    const start = learnMenuHtml(learnMenuView(null, e));
    assert.match(start, new RegExp(`data-el="${e}">[^<]*(?:<[^>]*>[^<]*)*${cap}</button>`), `${e}: its button`);
    assert.match(start, new RegExp(`data-lmenu="start">Start the ${cap} game<`), `${e}: Start`);
    assert.match(learnMenuHtml(learnMenuView(saved(e), e)), new RegExp(`data-lmenu="continue">Continue your ${cap} game<`), `${e}: Continue`);
    assert.match(learnMenuHtml(learnMenuView(saved(e, true), e)), new RegExp(`data-lmenu="continue">Continue your ${cap} tips game<`), `${e}: Continue tips`);
  }
});

test('1245 §2 a lesson names a toolbar button by the glyph the toolbar draws', () => {
  // every toolbar button whose whole content is a glyph (no letters)
  const main = read('main.ts');
  const glyphs = [...main.matchAll(/<button data-btn="(?:judgeopen|helpopen|reportopen|tablemenu|undo|settingsmenu)"[^>]*>([^<]+)<\/button>/g)]
    .map(m => m[1]!.trim());
  for (const g of ['⚖', '?', '📝', '☰', '↶', '⋯']) assert.ok(glyphs.includes(g), `positive control: the toolbar draws a bare ${g}`);
  for (const g of glyphs) assert.doesNotMatch(g, /[A-Za-z]/, `${g} is a bare glyph`);
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = new RegExp(`\\*\\*(?:${glyphs.map(esc).join('|')}) +[A-Za-z][^*]*\\*\\*`, 'gu');
  const offenders = [...read('lessons.ts').matchAll(named)].map(m => m[0]);
  assert.deepEqual(offenders, [], 'a bold toolbar glyph with a word after it names a label the button does not have');
  // the census can see the old wording
  assert.equal('**? rules** (on the toolbar)'.match(named)?.length, 1);
  assert.equal('the **📝 Report** button'.match(named)?.length, 1);
});

test('1245 §3 the rules review Close button does not promise the lobby', () => {
  assert.match(read('crreview.ts'), /data-btn="cr-close" title="close the rules review">← Close</);
  const files = ['', 'pages/', 'components/'].flatMap(d =>
    readdirSync(UI + d).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).map(f => d + f));
  assert.ok(files.length > 50, 'positive control: the sources were read');
  const bad = files.flatMap(f => [...read(f).matchAll(/title(?:="|: ')[^"']*\blobby\b[^"']*/gi)].map(m => `${f}: ${m[0]}`));
  assert.deepEqual(bad, []);
});
