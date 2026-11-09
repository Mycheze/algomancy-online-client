/* 1204 — an instruction a player reads says "Tap" on a finger-first device.
 *
 * BL-10, docs/23-ui-inventory/05 §18.14: "Copy that says 'Click' on touch:
 * 'Click 2 cards to put on the bottom…' (not in .remind, unlike the draft
 * step)". It was one of seven: the draw step's panel and its empty row, the
 * cache's "Glowing cards can be used right now — click one", the stack
 * viewer's mod host, the battle's "Click a spot on the line", the blockers'
 * prompt, the burst token tip (tips open on a tap too), the draft lobby's
 * ranking hint, the card browser's element note and the deck description help.
 * Each now writes its verb through util.ts clickOrTap: the mouse's word in a
 * `.mouseonly` span, the finger's in a `.touchonly` one.
 *
 * §1 is the helper and the two CSS rules it rests on. §2 is the census: every
 * "click" left in the text main.ts and the pages draw is either hover-only (a
 * `title`), already hidden on touch (`.remind`, `.mouseonly`, the deck
 * builder's mouse hint) or one of the few listed below with the reason.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { clickOrTap } from '../util.ts';
import { readStyles } from './read-styles.ts';

test('1204 §1 clickOrTap draws the mouse\'s word and the finger\'s, and html.touch shows only the finger\'s', () => {
  assert.equal(clickOrTap(), '<span class="mouseonly">click</span><span class="touchonly">tap</span>');
  assert.equal(clickOrTap('Click'), '<span class="mouseonly">Click</span><span class="touchonly">Tap</span>');
  assert.equal(clickOrTap('clicking'), '<span class="mouseonly">clicking</span><span class="touchonly">tapping</span>');
  const css = readStyles();
  assert.match(css, /\.touchonly \{ display: none; \}/);
  assert.match(css, /html\.touch \.touchonly \{ display: inline; \}/);
  assert.match(css, /html\.touch \.mouseonly[^{]*\{ display: none; \}/);
});

/** Lines whose "click" is fine, with why. Matched as a substring of the line. */
const ALLOWED: readonly [string, string][] = [
  ['the whole column in one click', "the Default split button's title (btn()'s fourth argument)"],
  ['every line is one click from here', "the log toggle's title=, on the line below `title=\"${…`"],
  ["state === 'off' ? `hiding ${f.label} — click to clear`", "an element chip's title (cardfilters: `const title =`)"],
];

/** Blank out comments, keeping every newline so line numbers still match. */
const uncomment = (src: string): string => src
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, pre: string) => pre + ' '.repeat(m.length - pre.length));

test('1204 §2 census: no bare "click" in the text main.ts and the pages draw', () => {
  const files = ['main.ts', ...readdirSync(new URL('../pages/', import.meta.url))
    .filter(f => f.endsWith('.ts')).map(f => `pages/${f}`)];
  assert.ok(files.length > 20, `expected main.ts and the pages, found ${files.length} files`);
  const bad: string[] = [];
  let checked = 0;
  for (const f of files) {
    const raw = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').split('\n');
    uncomment(raw.join('\n')).split('\n').forEach((code, i) => {
      for (const m of code.matchAll(/\b[Cc]lick(s|ed|ing)?\b/g)) {
        const at = m.index!;
        const near = code.slice(Math.max(0, at - 1), at + 10);
        if (/^\.click\(|^['"`][Cc]lick(ing)?['"`]/.test(near)) continue;  // code, or clickOrTap's argument
        checked++;
        const before = code.slice(0, at);
        if (/\btitle\b/.test(before)) continue;                          // hover text: a finger never sees it
        if (/class="(remind|mouseonly|ttpoolhint--mouse)">[^<]*$/.test(before)) continue;  // hidden on touch
        if (ALLOWED.some(([frag]) => raw[i]!.includes(frag))) continue;
        bad.push(`${f}:${i + 1}: ${raw[i]!.trim().slice(0, 120)}`);
      }
    });
  }
  assert.ok(checked > 10, `the census found only ${checked} uses of "click": did the scan break?`);
  assert.deepEqual(bad, [], 'a player on a tablet reads "click": write the verb with clickOrTap() (util.ts), '
    + 'hide the sentence on touch (.remind), or move it into a title');
});
