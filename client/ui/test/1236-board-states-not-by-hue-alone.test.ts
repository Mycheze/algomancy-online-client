/* 1236 · THE BOARD'S DANGER AND IN-PROGRESS LINES ARE NOT TOLD BY HUE ALONE (BL-51, 2026-11-12)
 *
 * BL-51's third finish line: "the board's state outlines (targeting, legal,
 * pending, danger) are told apart by line style or a mark, not hue alone".
 * Targeting wears a ◎ in the accessible mode and a picked card a ✓ (1221 §4,
 * §5); legal is the one plain solid ring. This file is the audit of the other
 * two, and the guard that keeps it true:
 *
 *   IN PROGRESS. The teal (--pending) left the board on 2026-09-30, when the
 *   stack went to four colours: what says "in progress" now is the chip that
 *   READS "resolving…" and breathes. No board rule draws a line in --pending but
 *   the practice-scenario panel's frame, which is a panel with a heading, not a
 *   state. tokens.css still said "a resolving card wears it as a border"; that
 *   comment was wrong and is corrected.
 *
 *   DANGER. Every red line the board draws comes with a word, a chip or a
 *   dash: target missing has its "⊘ target gone" chip, a suppressed text box
 *   its "⊘" banner, the incoming strip is dashed and labelled, an expired clock
 *   says "expired", an offline opponent "offline", a replay past its record the
 *   chip that says so. The invader strip is told by being a strip of its own
 *   beside the formation; a life change by the number and its delta; the red
 *   flash round a unit that took damage is an event, not a state — its numbers
 *   change, and in the mode it is ≥ 15 from the buff flash in every vision
 *   (1221 §2).
 *
 *   §1 the census: every rule in a board piece that draws a line (outline,
 *      border, box-shadow) in red or the in-progress colour is one this file
 *      audited, with its cue written down — a new one fails until it is
 *   §2 the cues the census leans on are really there, in the markup or the CSS
 *   §3 in progress is the chip's word and its motion, not a colour
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readStylePieces, readStyles } from './read-styles.ts';

const UI = join(import.meta.dirname, '..');
const src = (f: string): string => readFileSync(join(UI, f), 'utf8');

/** red, or the in-progress colour — the tokens and the literals the board still spells */
const HUE = /var\(--(color-)?danger\)|var\(--pending\)|rgba\(217,\s*84,\s*84|#3fd2c0/i;
const LINE = /^(outline(-color)?|border(-(top|right|bottom|left))?(-color)?|box-shadow)$/;

/** every (selector, property) in a board piece that draws a line in one of those colours;
 *  a keyframe step is filed under its `@keyframes name` */
function lines(): Map<string, string> {
  const found = new Map<string, string>();
  for (const { piece, text } of readStylePieces()) {
    if (!piece.startsWith('board/')) continue;
    const t = text.replace(/\/\*[\s\S]*?\*\//g, '');
    const stack: string[] = [];
    let buf = '';
    for (const ch of t) {
      if (ch === '{') { stack.push(buf.trim().replace(/\s+/g, ' ')); buf = ''; continue; }
      if (ch !== '}') { buf += ch; continue; }
      const sel = stack.pop() ?? '';
      const key = stack.find(s => s.startsWith('@keyframes')) ?? sel;
      for (const decl of buf.split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        if (LINE.test(decl.slice(0, i).trim()) && HUE.test(decl.slice(i + 1))) found.set(key, piece);
      }
      buf = '';
    }
  }
  return found;
}

/** the audit: each red or in-progress line on the board, and what tells it apart besides its hue */
const AUDITED: Record<string, string> = {
  '.stackcard.lost': 'word — the "⊘ target gone" chip on the card\'s left edge',
  '.tbsupp': 'word — the text box\'s "⊘ …" banner, a sentence',
  '.sentstrip': 'dash and word — a dashed frame, labelled "incoming — <name>"',
  '.clocktime.exp': 'word — "expired" after the time',
  '#app.board.v2 > .toolbar > .tbstat:has(.presence.off)': 'word — "offline" under the dot',
  '@keyframes tboffline': 'word — the same "offline" tile, breathing',
  '.replaybar.parted': 'word — the replay chip says "reconstruction from action N"',
  '.replaychip.bad': 'word — the chip is its own sentence',
  '.barnotice': 'word — a notice line, a sentence',
  '.scnwarn': 'word — "This one needs a live opponent."',
  '.scnbtn.scn-broken': 'word — a verdict button with its own label',
  '.scnpanel': 'not a state — the practice-scenario panel\'s frame, under its "🧪 Scenario" heading',
  'button.declinebtn:hover': 'word — a button\'s own label, on hover',
  '.invaders': 'place — the invaders are a strip of their own, beside the formation',
  '.invaders .card img': 'place — a hairline on the cards inside that strip',
  '@keyframes lifedown': 'number — the life total changes and a delta rises off it',
  '@keyframes animhurt': 'event, not a state — the unit\'s numbers change; ≥ 15 from the buff flash in every vision in the mode',
};

test('1236 §1 every red or in-progress line on the board is one the audit wrote a cue for', () => {
  const found = lines();
  assert.ok(found.size >= 12, `only ${found.size} red or in-progress lines found on the board — the census is reading nothing`);
  const unaudited = [...found].filter(([sel]) => !(sel in AUDITED)).map(([sel, piece]) => `${piece}: ${sel}`);
  assert.deepEqual(unaudited, [],
    'a board rule draws a red or in-progress line the audit has not seen. Give it a word, a chip, a dash or a mark '
    + '(not a second colour), then add it to AUDITED with that cue');
  const gone = Object.keys(AUDITED).filter(sel => !found.has(sel));
  assert.deepEqual(gone, [], 'an audited line is no longer drawn in red: take it out of AUDITED');
});

test('1236 §2 the words, chips and dashes the audit leans on are there', () => {
  const main = src('main.ts'), css = readStyles();
  // target missing: the class and the chip come from the same items
  assert.match(main, /lost\.length \? 'lost' : ''/, 'the stack card takes .lost from the lost targets');
  assert.match(main, /lost\.length \? `<div class="stacklost">⊘ \$\{.*'target'\} gone<\/div>`/, 'and says "target gone" when it does');
  assert.match(main, /<div class="tbsupp">⊘ /, 'the suppressed text box is a ⊘ banner with words');
  assert.match(css, /\.sentstrip \{[^}]*border: 1px dashed var\(--danger\)/, 'the incoming strip is dashed');
  assert.match(main, /<div class="sentstrip"[^>]*>\s*<div class="zonelabel">\$\{txtIcon\('battle', '\[battle\]'\)\} incoming — /, 'and labelled "incoming"');
  assert.match(css, /\.clocktime\.exp::after \{ content: " expired"/, 'an expired clock says so');
  assert.match(main, /<span class="presence off"[^>]*>●<span class="tbsub">offline<\/span>/, 'an offline opponent says so');
  assert.match(src('replaybar.ts'), /cls: 'bad', text: `reconstruction from action \$\{m\.partedAt\}`/, 'a replay past its record says so');
  assert.match(src('scenario.ts'), /<div class="scnwarn"><b>This one needs a live opponent\.<\/b>/);
  assert.match(src('scenario.ts'), /<div class="scnpanel">\s*<div class="scnhead">🧪 Scenario/, 'the scenario panel has its heading');
});

test('1236 §3 in progress on the board is the "resolving…" chip and its motion, not a teal ring', () => {
  const main = src('main.ts'), css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(main, /'<div class="stackbolt pending">resolving…<\/div>'/, 'the resolving item wears a chip that reads "resolving…"');
  assert.match(css, /\.stackcard \.stackbolt\.pending \{\s*animation: stackpending/, 'and the chip breathes');
  const resolving = [...css.matchAll(/\.stackcard\.resolving \{([^}]*)\}/g)].map(m => m[1]).join(';');
  assert.ok(resolving.length > 0, 'the .stackcard.resolving rule is read');
  assert.doesNotMatch(resolving, HUE, 'the resolving card carries no in-progress colour of its own');
  // the token's own comment says what it is used for, and must not claim a border it lost
  const tokens = readStylePieces().find(p => /(^|\/)tokens\.css$/.test(p.piece))!.text;
  assert.doesNotMatch(tokens, /resolving card wears it as a border/, 'tokens.css claims a resolving card wears --pending');
});
