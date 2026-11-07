/* 1010 — THE HOME SCREEN IS ONE WINDOW: THE CSS CONTRACT (client/docs/24-redesign/, 2026-11-03).
 *
 * Principle 2 of the redesign: no page scrolling; a region may scroll inside
 * itself. The home is drawn in the app shell (components/app-shell.ts), which
 * is exactly the window's height with only its main region scrolling — test
 * 1007 holds the shell to that. This file holds everything AROUND the shell
 * to not adding height to it, read off the real stylesheet without a DOM:
 *
 *   §1 the markup: homeHtml's root is the shell (homepage its LAST class), and
 *      it is the only element homeHtml draws — nothing after it (the Recent
 *      updates band used to follow .homepage and was the first thing a scroll
 *      found; it is the Updates sheet now)
 *   §2 nothing gives the shell root a size of its own: no rule whose subject
 *      is .homepage sets a height, min-height, margin, padding or border;
 *      <body> has no margin and #app (off the board) no padding
 *   §3 the home's own rules never make the main region taller than the shell
 *      leaves it: it keeps scrolling inside itself (no overflow: visible, no
 *      height) outside the phone fallback, and the two columns' min-height is
 *      capped at 100% of it
 *   §4 the layers around #app hide their own furniture on the home screen —
 *      the legal footer and its page floor, and the report pill's clearance on
 *      <body> — so none of them adds a line of height there (their CSS:
 *      pages/48-legal, shared/13-report-and-inbox)
 *
 * The other half of the guard is ui-shots: a home__* state whose document is
 * taller than the window at desktop or tablet fails the run (test 1012).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStyles, readStylePieces } from './read-styles.ts';
import { homeHtml, HOME_SHEETS, type HomeView } from '../pages/home.ts';
import { STANDARD_RULES } from '../customrules.ts';

const STANDARD = { ...STANDARD_RULES, bans: [] };

interface Rule { sel: string; body: string; media: string }

/** every style rule, with the @media it sits in ('' at the top level) */
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
const HOME_PIECE = readStylePieces().find(p => p.piece.startsWith('pages/') && /^\d+-home\.css$/.test(p.piece.split('/').pop()!));
assert.ok(HOME_PIECE, 'no pages/…-home piece');
/** the home screen's own section of the piece (the rest is what other pages borrow, and the updates list) */
const HOME_SECTION = (() => {
  const t = HOME_PIECE.text;
  const from = t.indexOf('── the home screen (client/docs/24-redesign/');
  const to = t.indexOf('── recent updates');
  assert.ok(from > 0 && to > from, 'the home piece lost its section headings');
  return t.slice(t.lastIndexOf('/*', from), t.lastIndexOf('/*', to));
})();
const HOME_RULES = rules(HOME_SECTION);
/** the phone fallback the shell lets go under (components/app-shell.css) */
const PHONE = /max-width:\s*759\.98px|max-height:\s*599\.98px/;
/** the selectors in a list whose SUBJECT (the last compound) is .homepage */
const subjectIsHome = (sel: string): string[] =>
  sel.split(',').map(s => s.trim()).filter(s => /(^|[\s>+~])[^\s>+~]*\.homepage(?![\w-])[^\s>+~]*$/.test(s));
const SIZE = /(^|;|\s)(height|min-height|max-height|margin(-[a-z]+)?|padding(-[a-z]+)?|border(-[a-z]+)?)\s*:/;

function view(): HomeView {
  return {
    account: { resolving: false, me: null }, nameBox: '', signedIn: false, mode: 'draft', format: 'casual', sheet: null,
    draft: { k: 3, els: [], fixedOpen: false, setCount: 35, fixedError: undefined, customError: undefined, custom: false,
      rules: { active: null, rules: STANDARD, summary: [], values: [], beginner: false, advancedOpen: false, banDraft: '',
        deckCount: 528, simpleCount: 300, suggestions: '', queryNote: '', pool: '' } },
    clock: { mode: 'draft', auto: true, now: 0, byModeMin: 60 }, error: '',
    deckPicker: { current: null, signedIn: false, mine: [], defaults: null, msg: '' }, hasDeck: false,
    competitive: { signedIn: false, decks: null, bestOf: 3, pick: null }, singleCard: null,
    leagueLive: false, challengeLive: false, badges: { alerts: 0, join: 0, updates: 0 },
    slots: { league: '', challenge: '', queue: '', invites: '', yourMatches: '', leagueMatches: '', scpicker: '', info: '', updates: '' },
    art: { backdrop: { src: 'b.jpg', card: 'Backdrop Card', focusY: 30 }, draft: { src: 'd.jpg', card: 'Draft Card', focusY: 30 }, constructed: { src: 'c.jpg', card: 'Constructed Card', focusY: 30 }, league: { src: 'l.jpg', card: 'League Card', focusY: 30 }, challenge: { src: 'ch.jpg', card: 'Challenge Card', focusY: 30 }, queue: { src: 'q.jpg', card: 'Queue Card', focusY: 30 } },
  };
}

/** the index just past the element that opens at 0 (its matching close) */
function endOfFirstElement(html: string): number {
  const re = /<(\/?)(div|section|main|header|footer)\b[^>]*>/g;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

test('1010 §0 positive control: the parser sees the shell and the home rules', () => {
  assert.ok(ALL.some(r => r.sel === '.ui-app-shell' && /100dvh/.test(r.body)), 'the shell rule is not read');
  assert.ok(HOME_RULES.some(r => r.sel.includes('.homemain')), 'the home piece is not read');
  assert.deepEqual(subjectIsHome('#app > .homepage, .homepage .x, .a .homepage:hover'), ['#app > .homepage', '.a .homepage:hover']);
  assert.ok(SIZE.test(' min-height: 1px') && SIZE.test('padding-top:0') && !SIZE.test('overflow: auto'));
});

test('1010 §1 the root is the shell, homepage last, and nothing is drawn after it', () => {
  for (const sheet of [null, ...HOME_SHEETS]) {
    for (const mode of ['draft', 'constructed'] as const) {
      const html = homeHtml({ ...view(), sheet, mode });
      // `apppage`: the mark every page in the app frame carries (pages/frame.ts, 2026-11-04)
      assert.match(html, /^<div class="ui-app-shell ui-app-shell--contained apppage homepage">/, 'the root must be the (contained) app shell, with homepage as its LAST class (287)');
      assert.equal(endOfFirstElement(html), html.length, `${sheet ?? 'no sheet'}/${mode}: something is drawn after the shell`);
    }
  }
});

test('1010 §2 nothing gives the shell root a size of its own; body and #app add none', () => {
  const bad = ALL.filter(r => subjectIsHome(r.sel).length && SIZE.test(r.body)).map(r => `${r.media} ${r.sel} { ${r.body.trim()} }`);
  assert.deepEqual(bad, [], 'a rule sizes .homepage itself — the shell is the window, and this adds to it');
  const body = ALL.find(r => r.sel === 'body' && !r.media);
  assert.match(body?.body ?? '', /margin:\s*0/, '<body> has a margin');
  const app = ALL.filter(r => r.sel === '#app:not(.board)' && !r.media).map(r => r.body).join(';');
  assert.match(app, /padding:\s*0/, '#app off the board is padded');
  assert.match(app, /display:\s*block/);
});

test('1010 §3 the home main region keeps scrolling inside itself; the columns never outgrow it', () => {
  const desk = HOME_RULES.filter(r => !PHONE.test(r.media));
  const main = desk.filter(r => r.sel.split(',').some(s => /\.ui-app-shell__main\s*$/.test(s.trim())));
  assert.ok(main.length, 'positive control: the home styles its main region');
  for (const r of main) {
    assert.doesNotMatch(r.body, /overflow[^:]*:\s*visible|(^|;|\s)height\s*:/, `${r.sel} lets the main region grow: ${r.body}`);
  }
  for (const r of desk) {
    assert.doesNotMatch(r.body, /\b100d?vh\b/, `${r.sel} sizes itself by the window — the shell does that, once`);
    // the columns and their cards: the boxes that make the main region's height
    if (!/\.home(main|play|sides?|rows)(?![\w-])/.test(r.sel)) continue;
    const mh = /(?:^|;|\s)min-height\s*:\s*([^;]+)/.exec(r.body)?.[1]?.trim();
    if (mh && !/^0(px)?$/.test(mh)) assert.match(mh, /^min\(100%,/, `${r.sel} has a min-height that can outgrow the main region: ${mh}`);
  }
  const grid = desk.find(r => r.sel === '.homemain');
  assert.match(grid?.body ?? '', /min-height:\s*min\(100%,/, '.homemain is capped at its region');
});

test('1010 §4 the layers hide their furniture on the home screen, so neither adds height there', () => {
  // read off `.apppage`, which the home's root carries and every page in the
  // app frame does too (pages/frame.ts, 2026-11-04): what holds for the home
  // holds for them. The legal footer: hidden whenever #app holds such a page
  assert.ok(ALL.some(r => /#app:has\(> \.apppage\) \+ #legalfoot/.test(r.sel) && /display:\s*none/.test(r.body)),
    '#legalfoot shows under the home — the page scrolls by the footer\'s height');
  // the off-board page floor (min-height: 100dvh - 128px on #app's first child) passes over the home
  const floors = ALL.filter(r => /#app[^{]*>\s*:first-child/.test(r.sel) && /min-height/.test(r.body));
  assert.ok(floors.length, 'positive control: the off-board floor rule is read');
  for (const f of floors) assert.match(f.sel, /:not\(:has\(> \.apppage\)\)/, `the page floor applies to the home: ${f.sel}`);
  // the report pill's clearance on <body> (64px of padding) is not kept on the home
  const clear = ALL.filter(r => /reportfab/.test(r.sel) && />\s*body/.test(r.sel) && /padding-bottom/.test(r.body));
  assert.ok(clear.length, 'positive control: the pill clearance rule is read');
  for (const c of clear) assert.match(c.sel, /:not\(:has\(#app > \.apppage\)\)/, `the pill's clearance pads the home: ${c.sel}`);
});
