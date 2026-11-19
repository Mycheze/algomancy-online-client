/* 1501 — THE LESSON WINDOW AND THE BOARD DO NOT SHARE A CLASS NAME (BL-10;
 * docs/23-ui-inventory/04 §L.2: "`.lplay` is both the lesson slideshow ▶
 * button and the regions board's play-zone … `.lres` is both the lesson
 * stack's \"resolved\" row and the board's resource cell").
 *
 * Both are drawn over the same page and name their parts with an `l` prefix,
 * so a name in one is a rule in the other. The board's bare `.lplay` (a flex
 * row that clips) reached the lesson's play button, which drew its ▶ off
 * centre beside a centred ⏮ and ⏭; the lesson's bare `.lres` (centre, wrap,
 * a gap) reached the board's resource cell.
 *
 * §1 the census, lesson → board: no class the lesson layer writes is named by
 *    a board rule
 * §2 the census, board → lesson: no class the board writes is named by a
 *    Learn to Play rule
 * §3 rendered: every lesson page, and the two figures that carried the
 *    shared names, draw only lesson classes
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { UI_DIR } from '../../engine/scripts/paths.mjs';
import { readStylePieces } from './read-styles.ts';
import '../../engine/src/index.ts';
import { figureHtml, pageHtml } from '../lessonlayer.ts';
import { ALL_LESSONS, GAME_LESSONS, CLIENT_TIPS } from '../lessons.ts';

/** state modifiers every part of the client uses, never styled alone; the
 * lesson's pill, which the lesson layer draws ON the board toolbar; and the
 * rules text's inline icon, drawn everywhere by one helper (cardtext.ts) */
const SHARED = new Set(['on', 'mine', 'theirs', 'dim', 'lessonpill', 'txticon']);

const LESSON_SOURCES = ['lessonlayer.ts', 'lessons.ts', 'learnmenu.ts', 'pages/learn.ts'];
const BOARD_SOURCES = ['main.ts', 'ressum.ts', 'layout.ts'];

/** the plain class names in a `class="…"` attribute, with any `${…}` taken out */
const classesIn = (html: string): Set<string> => {
  const out = new Set<string>();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const t of m[1]!.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (/^[a-z][\w-]*$/.test(t)) out.add(t);
  }
  return out;
};
const sourceClasses = (files: string[]): Set<string> =>
  new Set(files.flatMap(f => [...classesIn(readFileSync(join(UI_DIR, f), 'utf8'))]));

/** every class a group of stylesheet pieces names in a selector, with the piece */
const styledBy = (pick: (piece: string, text: string) => boolean): Map<string, string> => {
  const out = new Map<string, string>();
  for (const { piece, text } of readStylePieces().filter(p => pick(p.piece, p.text))) {
    const bare = text.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of bare.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      for (const c of m[1]!.matchAll(/\.([a-zA-Z][\w-]*)/g)) if (!out.has(c[1]!)) out.set(c[1]!, piece);
    }
  }
  return out;
};
const BOARD_CSS = styledBy(p => p.startsWith('board/'));
/** the Learn to Play piece: the one off the board that lays out the lesson's frame buttons */
const LEARN_CSS = styledBy((p, text) => !p.startsWith('board/') && /\.lframebtns\s*\{/.test(text));

const clashes = (written: Set<string>, styled: Map<string, string>): string[] =>
  [...written].filter(c => !SHARED.has(c) && styled.has(c)).map(c => `.${c} (${styled.get(c)})`);

test('1501 §1 no class the lesson window writes is styled by a board rule', () => {
  const lesson = sourceClasses(LESSON_SOURCES);
  assert.ok(lesson.has('lframebtns') && lesson.has('lstackpile'), 'positive control: the lesson sources are read');
  assert.ok(BOARD_CSS.has('lplay') && BOARD_CSS.has('linfo'), 'positive control: the board rules are read');
  assert.deepEqual(clashes(lesson, BOARD_CSS), [], 'a lesson class the board styles takes the board\'s rule');
});

test('1501 §2 no class the board writes is styled by a Learn to Play rule', () => {
  const board = sourceClasses(BOARD_SOURCES);
  assert.ok(board.has('lres') && board.has('lplay'), 'positive control: the board sources are read');
  assert.ok(LEARN_CSS.has('lframebtns') && LEARN_CSS.has('lstackpile'), 'positive control: the Learn rules are read');
  assert.deepEqual(clashes(board, LEARN_CSS), [], 'a board class the Learn page styles takes the Learn rule');
});

test('1501 §3 every lesson page, and the frames and resolved figures, draw no board class', () => {
  const frames = figureHtml({ kind: 'frames', play: 'loop', frames: [{ figure: { kind: 'cards', cards: ['Prismite'] }, caption: 'a' }] });
  assert.match(frames, /data-lbtn="frame-play"[^>]*class="lframeplay"/, 'the play button carries its own class');
  const pages = [...ALL_LESSONS, ...GAME_LESSONS, ...CLIENT_TIPS].flatMap(l => l.pages.map((p, i) => [`${l.id ?? l.title} p${i + 1}`, pageHtml(p, null)] as const));
  const resolved = pages.filter(([, h]) => h.includes('lresolved'));
  assert.ok(resolved.length > 0, 'positive control: some lesson draws the stack with what resolved beside it');
  for (const [, h] of resolved) assert.match(h, /class="lresolvedcards"/, 'the resolved row carries its own class');
  const bad = [[ 'frames figure', frames ] as const, ...pages]
    .flatMap(([name, html]) => clashes(classesIn(html), BOARD_CSS).map(c => `${name}: ${c}`));
  assert.deepEqual(bad, [], 'a lesson page draws a class the board styles');
});
