/* 1176 — THE POST-GAME SCREEN FITS THE WINDOW (BL-10, 2026-11-08).
 *
 * Principle 2 of the redesign (client/docs/24-redesign/): no page scrolling; a
 * region may scroll inside itself. The post-game box used to be one column
 * that scrolled as a whole: a full stat table plus the four buttons is ~870px,
 * so at 1024x768 the box scrolled and Rematch / Return to home went under the
 * fold — further still with a guest's or a signed-out seat's keep-it form.
 * Now its body is two columns, what happened and what to do next, and from
 * 900px wide only the columns scroll, each inside itself.
 *
 *   §1 the markup: the stats column holds the table and Unlocked; the side
 *      column holds every note, the keep-it forms, the buttons and the peek —
 *      in today's order, every data-btn where it was
 *   §2 the CSS: below 900px the three wrappers stack with the box's own gap
 *      (nothing moves); from 900px the body is a two-column grid in a wider
 *      box, and each column is capped in WINDOW units and scrolls by itself
 *      (a percentage would not resolve against the box's max-height)
 *
 * No browser on the box that wrote this (the home box has none): the layout
 * was reasoned, not looked at. This guard holds the contract; ui-shots has no
 * post-game state (it sits over a finished board).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postGameHtml, type PostGameView } from '../pages/postgame.ts';
import type { GameOver } from '../postgame.ts';
import { readStyles } from './read-styles.ts';

const seat = (name: string): GameOver['seats'][0] => ({
  name, cards: { 'Ignis Sprite': 2 }, unitsPlayed: 5, spellsPlayed: 3, tokensCast: 1, modsApplied: 2,
  cardElements: { fire: 4 }, recycled: {}, resourcesActivated: 6, abilitiesActivated: 1,
  attacksDeclared: 4, unitsAttackedWith: 6, damageDealt: 14, lifeLost: 9,
  unitsLost: 3, unitsKilled: 2, cardsDrafted: 30, lifeLeft: 11,
});
const OVER: GameOver = {
  seat: 0, winner: 0, names: ['Ann', 'Bo'], mode: 'draft', els: ['fire', 'wood', 'water'], turns: 9,
  seats: [seat('Ann'), seat('Bo')], rematch: [false, false], rematchRoom: null, recorded: true,
  unlocked: [{ id: 'first-win', icon: '★', name: 'First win', desc: 'Win a game' }],
  disputable: true, disputed: [false, false],
};
const VIEW: PostGameView = {
  over: OVER, modeLabel: 'live draft', elements: null, guest: true, signup: { form: true }, matchResult: '',
};

/** the inside of the first <div class="NAME"> … its matching </div> */
function region(html: string, cls: string): string {
  const start = html.indexOf(`<div class="${cls}">`);
  assert.ok(start >= 0, `.${cls} is drawn`);
  const re = /<div\b[^>]*>|<\/div>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  assert.fail(`.${cls} is never closed`);
}

test('1176 §1 the stats in one column, everything to do next in the other', () => {
  const html = postGameHtml(VIEW);
  const cols = region(html, 'pgcols');
  const stats = region(cols, 'pgstats');
  const side = region(cols, 'pgside');
  assert.equal(cols.indexOf(stats) < cols.indexOf(side), true, 'stats first, as it was read before');
  assert.match(stats, /<table class="pgtable">/);
  assert.match(stats, /<div class="pgunlocked">/);
  assert.doesNotMatch(stats, /<button|<form/, 'nothing to press in the stats column');
  for (const btn of ['pg-rematch', 'pg-dispute', 'pg-home', 'pg-queue', 'pg-close', 'pg-claim', 'pg-signup']) {
    assert.match(side, new RegExp(`data-btn="${btn}"`), `${btn} is in the side column`);
  }
  assert.match(side, /Recorded to your profile\./);
  // the order inside the side column is today's: notes, the keep-it forms, the buttons, the peek
  const at = (s: string): number => side.indexOf(s);
  assert.ok(at('Recorded to your profile') < at('data-form="pg-claim"'));
  assert.ok(at('data-form="pg-signup"') < at('<div class="pgbtns">'));
  assert.ok(at('<div class="pgbtns">') < at('data-btn="pg-close"'));
  // the head stays above both, and the box closes after them
  assert.ok(html.indexOf('<div class="pghead">') < html.indexOf('<div class="pgcols">'));
  assert.ok(html.trimEnd().endsWith(`${cols}\n  </div></div>`), 'the columns are the last thing in the box');
});

interface Rule { sel: string; body: string; media: string }
function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const walk = (src: string, media: string): void => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const head = src.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; j < src.length && depth; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; }
      const inner = src.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(inner, head);
      else if (!head.startsWith('@')) out.push({ sel: head, body: inner, media });
      i = j;
    }
  };
  walk(text, '');
  return out;
}
const ALL = rules(readStyles());
const subjects = (r: Rule): string[] => r.sel.split(',').map(s => s.trim().split(/\s+/).pop()!);
const about = (cls: string, media: (m: string) => boolean): Rule[] =>
  ALL.filter(r => media(r.media) && subjects(r).includes(`.${cls}`));
const WIDE = (m: string): boolean => /min-width:\s*900px/.test(m);
const TOP = (m: string): boolean => m === '';

test('1176 §2 narrow: the wrappers only stack, with the box\'s own gap', () => {
  const box = about('pgbox', TOP).map(r => r.body).join(';');
  const gap = /gap:\s*([^;]+)/.exec(box)?.[1]?.trim();
  assert.ok(gap, 'the box has a gap');
  for (const cls of ['pgcols', 'pgstats', 'pgside']) {
    const body = about(cls, TOP).map(r => r.body).join(';');
    assert.match(body, /display:\s*flex/, `.${cls} is a flex column at the top level`);
    assert.match(body, /flex-direction:\s*column/);
    assert.match(body, new RegExp(`gap:\\s*${gap!.replace(/[()]/g, '\\$&')}`), `.${cls} keeps the box's gap (${gap})`);
  }
});

test('1176 §2 wide: two columns, each scrolling inside itself, capped in window units', () => {
  const cols = about('pgcols', WIDE).map(r => r.body).join(';');
  assert.match(cols, /display:\s*grid/);
  assert.match(cols, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*\d+px\)/);
  const box = about('pgbox', WIDE).map(r => r.body).join(';');
  const w = /width:\s*min\((\d+)px/.exec(box);
  assert.ok(w && Number(w[1]) >= 860, 'the box is wide enough for the table and the side column');
  for (const cls of ['pgstats', 'pgside']) {
    const body = about(cls, WIDE).map(r => r.body).join(';');
    assert.match(body, /overflow:\s*auto/, `.${cls} scrolls by itself`);
    assert.match(body, /max-height:\s*calc\(100dvh - \d+px\)/, `.${cls} is capped against the window`);
    assert.doesNotMatch(body, /max-height:\s*\d+%/, 'a percentage would not resolve against the box\'s max-height');
  }
});
