/* 1209 · EVERY BOX OVER THE PAGE SAYS IT IS A DIALOG, AND WHICH ONE (BL-10, 2026-11-10)
 *
 * The inventory listed it (docs/23-ui-inventory/05 §18.22): "No `role="dialog"`,
 * `aria-modal`, focus move or focus trap on any overlay here (concede, match
 * found, pick, pick-set, trio reveal, post-game)."
 *
 * It was a class of thirteen boxes, not six: every box drawn on the board's
 * modal scrim (`.overlay`) — a player's bin, erased cards and cache, the card
 * inspector, the judge, the game log, the draft pick, the pick-a-set and
 * pile windows, the draft's element reveal, the concede question, the
 * post-game — plus the queue's "Match found" and the table menu's Past
 * reveals. A screen reader arriving in one read its first line of text and
 * never said a box had opened over the table, or what it was. Each now has
 * role="dialog" and a short name (the box's own title: "Ann's bin", "Concede
 * the game?", "You win!"). The boxes built since (the rules reader, the
 * report and dispute forms, the lesson, the challenge results, the comment
 * sheets, the ui-sheet and ui-dialog components) already had both.
 *
 * Left for the next pass: aria-modal, moving focus into the box when it opens
 * and keeping it there. The board repaints #app wholesale on every state
 * change, so that is behaviour to build and walk with a keyboard, not markup.
 *
 * Which classes are a scrim is read off the stylesheet, not listed here: a
 * single-class rule that covers the window (position: fixed; inset: 0) and
 * takes the pointer (no pointer-events: none). A new scrim is in the census
 * the day its CSS is written.
 *
 *   §0  non-vacuity: the scrims are found, the stories reach them, the detector tells cases apart
 *   §1  every scrim written in the client's source opens onto a named dialog
 *   §2  every scrim a page or component story draws opens onto a named dialog
 *   §3  the six the inventory named, by their own markup
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STORYBOOK_STORIES_DIR, UI_COMPONENTS_DIR, UI_DIR, UI_PAGES_DIR } from '../../engine/scripts/paths.mjs';
import { readStyles } from './read-styles.ts';
import { postGameHtml, type PostGameView } from '../pages/postgame.ts';
import { revealHtml } from '../pages/lobby.ts';
import { helpBoxHtml } from '../rules.ts';
import type { GameOver } from '../postgame.ts';

/** the classes that cover the window and take the pointer: the modal scrims */
function scrimClasses(css: string): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(/(?:^|\n)\.([a-z][\w-]*) \{([^}]*)\}/g)) {
    const body = m[2]!;
    if (/position: fixed/.test(body) && /\binset: 0\b/.test(body) && !/pointer-events: none/.test(body)) out.add(m[1]!);
  }
  return [...out].sort();
}
const SCRIMS = scrimClasses(readStyles());

const TPL = String.raw`\$\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}`;
/** an opening tag, `${…}` inside it taken whole */
const TAG = new RegExp(String.raw`^<([a-z][\w-]*)\b((?:${TPL}|[^>$]|\$(?!\{))*)>`);

/** is this opening tag's attribute text a dialog with a name? */
const namedDialog = (tag: string, attrs: string): boolean =>
  (tag === 'dialog' || /\brole="dialog"/.test(attrs))
  && /\baria-labelledby="[^"]+"|\baria-label="(?:[^"$]|\$\{)[^"]*"/.test(attrs);

/** the scrims in `markup` that do not open onto a named dialog. `follow` reads
 * a `${fn(…)}` that stands where the box should be (source only). */
function unnamed(markup: string, follow?: (fn: string) => string | null): string[] {
  const out: string[] = [];
  const opener = new RegExp(String.raw`<([a-z][\w-]*)\s[^>]*?\bclass="(${SCRIMS.join('|')})(?=[\s"$])`, 'g');
  for (const m of markup.matchAll(opener)) {
    const from = markup.slice(m.index!);
    const own = TAG.exec(from);
    if (!own) { out.push(`${m[2]}: an opening tag this census cannot read`); continue; }
    if (namedDialog(own[1]!, own[2]!)) continue;
    let rest = from.slice(own[0].length).replace(/^\s+/, '');
    // the ui-sheet's tap-off scrim sits first, hidden from a screen reader
    rest = rest.replace(/^<div\b[^>]*\baria-hidden="true"[^>]*><\/div>\s*/, '');
    const box = TAG.exec(rest);
    if (box && namedDialog(box[1]!, box[2]!)) continue;
    const call = /^\$\{\s*([A-Za-z_$][\w$]*)\(/.exec(rest);
    if (call && follow) {
      const first = follow(call[1]!);
      if (first !== null) {
        const t = TAG.exec(first);
        if (t && namedDialog(t[1]!, t[2]!)) continue;
      }
    }
    out.push(`.${m[2]}: ${(box?.[0] ?? rest).replace(/\s+/g, ' ').slice(0, 100)}`);
  }
  return out;
}

/** the client's own modules: ui/*.ts, pages/*.ts, components/*.ts, comments stripped */
const SOURCES: Array<[string, string]> = (() => {
  const read = (dir: string, prefix: string): Array<[string, string]> => readdirSync(dir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map(f => [`${prefix}${f}`, readFileSync(join(dir, f), 'utf8')] as [string, string]);
  return [...read(UI_DIR, ''), ...read(UI_PAGES_DIR, 'pages/'), ...read(UI_COMPONENTS_DIR, 'components/')]
    .map(([f, s]) => [f, s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')]);
})();
const ALL_SRC = SOURCES.map(([, s]) => s).join('\n');

/** the markup a function returns first: its first `return \`<…`, or, for a
 * one-line arrow or `return other(…)`, what that function returns (3 deep) */
function firstMarkupOf(fn: string, depth = 0): string | null {
  if (depth > 3) return null;
  const arrow = new RegExp(String.raw`\bconst ${fn}\s*=\s*\([^)]*\)(?:\s*:\s*\w+)?\s*=>\s*([^;]*);`).exec(ALL_SRC);
  if (arrow) {
    const body = arrow[1]!.trim();
    if (body.startsWith('`')) return body.slice(1);
    const inner = /^([A-Za-z_$][\w$]*)\(/.exec(body);
    return inner ? firstMarkupOf(inner[1]!, depth + 1) : null;
  }
  const at = ALL_SRC.search(new RegExp(String.raw`\bfunction ${fn}\(`));
  if (at < 0) return null;
  const body = ALL_SRC.slice(at, ALL_SRC.indexOf('\n}\n', at));
  const ret = /\breturn\s+(`|([A-Za-z_$][\w$]*)\()/.exec(body);
  if (!ret) return null;
  return ret[1] === '`' ? body.slice(ret.index! + ret[0].length) : firstMarkupOf(ret[2]!, depth + 1);
}

/** every rendered story, pages and components: [story, html] */
async function stories(): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for (const dir of [join(STORYBOOK_STORIES_DIR, 'pages'), STORYBOOK_STORIES_DIR]) {
    for (const f of readdirSync(dir).filter(f => f.endsWith('.stories.ts')).sort()) {
      type Story = { render?: (args: object) => unknown; args?: object };
      const mod = await import(join(dir, f)) as Record<string, Story>;
      const meta = mod['default'];
      for (const [name, story] of Object.entries(mod)) {
        const render = story?.render ?? meta?.render;
        if (name === 'default' || typeof render !== 'function') continue;
        let html: string;
        try { html = String(render({ ...(story.render ? {} : meta?.args), ...story.args })); } catch { continue; }
        out.push([`${f} ${name}`, html]);
      }
    }
  }
  return out;
}

test('§0 non-vacuity: the scrims are found, reached, and the detector tells the cases apart', async () => {
  for (const c of ['overlay', 'helpscrim', 'revealscrim', 'reportscrim', 'lessonscrim', 'chscrim', 'ui-sheet']) {
    assert.ok(SCRIMS.includes(c), `the stylesheet census lost .${c} (found: ${SCRIMS.join(' ')})`);
  }
  for (const c of ['animlayer', 'arrowlayer', 'ui-sheet__scrim']) assert.ok(!SCRIMS.includes(c), `.${c} is not a modal scrim`);
  const inSource = SOURCES.reduce((n, [, s]) =>
    n + [...s.matchAll(new RegExp(String.raw`\bclass="(?:${SCRIMS.join('|')})(?=[\s"$])`, 'g'))].length, 0);
  assert.ok(inSource >= 20, `the source census reads only ${inSource} scrims`);
  const all = await stories();
  assert.ok(all.length >= 150, `only ${all.length} stories rendered`);
  const drawn = all.filter(([, h]) => new RegExp(String.raw`class="(?:${SCRIMS.join('|')})(?=[\s"])`).test(h));
  assert.ok(drawn.length >= 10, `only ${drawn.length} stories draw a scrim`);
  assert.ok(drawn.some(([n]) => /^postgame/.test(n)) && drawn.some(([n]) => /^queue/.test(n)), 'the post-game and the queue offer are among them');

  assert.equal(unnamed('<div class="overlay x"><div class="overlaybox">hi</div></div>').length, 1, 'a bare box');
  assert.equal(unnamed('<div class="overlay"><div class="overlaybox" role="dialog">hi</div></div>').length, 1, 'a dialog with no name');
  assert.equal(unnamed('<div class="overlay"><div class="overlaybox" aria-label="Bin">hi</div></div>').length, 1, 'a name with no role');
  assert.equal(unnamed('<div class="overlay"><div class="overlaybox" role="dialog" aria-label="">x</div></div>').length, 1, 'an empty name');
  assert.deepEqual(unnamed('<div class="overlay mainonly"><div class="overlaybox" role="dialog" aria-label="${esc(n)}\'s bin">'), [], 'a templated name');
  assert.deepEqual(unnamed('<div class="reportscrim" id="r"><div class="overlaybox" role="dialog" aria-label="Report">'), []);
  assert.deepEqual(unnamed('<div class="ui-sheet ui-sheet--md"><div class="ui-sheet__scrim" data-btn="x" aria-hidden="true"></div>'
    + '<section class="ui-sheet__panel" role="dialog" aria-labelledby="t">'), [], 'the sheet: hidden tap-off, then the panel');
  assert.deepEqual(unnamed('<div class="lessonscrim${c ? \' compact\' : \'\'}" id="l"><div class="lessonbox" role="dialog" aria-label="L">'), [],
    'a templated class');
  assert.equal(unnamed('<div class="overlay">${helpBoxHtml()}</div>').length, 1, 'a call it may not follow is not proven');
  assert.deepEqual(unnamed('<div class="overlay">${helpBoxHtml()}</div>', firstMarkupOf), [], 'a call it follows');
  assert.match(firstMarkupOf('helpBoxHtml') ?? '', /^<div class="overlaybox helpbox/, 'follows an arrow through to rulesBoxHtml');
});

test('§1 every scrim written in the client source opens onto a named dialog', () => {
  const bad = SOURCES.flatMap(([f, src]) => unnamed(src, firstMarkupOf).map(c => `${f}: ${c}`));
  assert.deepEqual(bad, [],
    'a box over the page that a screen reader does not announce: give the box role="dialog" and an aria-label '
    + '(its own title, in words)');
});

test('§2 every scrim a page or component story draws opens onto a named dialog', async () => {
  const bad = (await stories()).flatMap(([name, html]) => unnamed(html).map(c => `${name}: ${c}`));
  assert.deepEqual([...new Set(bad)], [], 'a story draws a box over the page that is not a named dialog');
});

const seat = (name: string): GameOver['seats'][0] => ({
  name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 0,
});

test('§3 the six the inventory named, by their own markup', () => {
  const main = SOURCES.find(([f]) => f === 'main.ts')![1];
  // concede: the name is the question, in each of its three forms
  assert.match(main, /const title = concedeMatchAsk \? 'Concede the match\?' : h\.state\.sandbox \? 'Leave the match\?' : 'Concede the game\?';/);
  assert.match(main, /<div class="overlaybox" role="dialog" aria-label="\$\{title\}">\$\{body\}<\/div>/);
  assert.equal((main.match(/<h3>\$\{title\}<\/h3>/g) ?? []).length, 3, 'the drawn title is the same words');
  // the draft pick
  assert.match(main, /<div class="overlaybox pickbox" role="dialog" aria-label="Draft pick">/);
  // match found
  const queue = SOURCES.find(([f]) => f === 'pages/queue.ts')![1];
  assert.match(queue, /<div class="overlaybox qofferbox" role="dialog" aria-label="Match found">/);
  // pick-a-set and the piles: the card's own title
  const pickset = SOURCES.find(([f]) => f === 'pickset.ts')![1];
  assert.match(pickset, /<div class="overlaybox psbox" role="dialog" aria-label="\$\{esc\(pv \? pv\.title : v!\.title\)\}">/);
  // the trio reveal
  assert.match(revealHtml({ els: ['fire', 'wood', 'water'], how: 'You both ranked fire first', detail: [] }),
    /^<div class="trioreveal" role="dialog" aria-label="This draft's elements">/);
  // the post-game: named by who won, the words of its heading
  const v = (winner: 0 | 1 | null): PostGameView => ({
    over: {
      seat: 0, winner, names: ['Ann', 'Bo <b>'], mode: 'draft', els: ['fire', 'wood', 'water'], turns: 7,
      seats: [seat('Ann'), seat('Bo')], rematch: [false, false], rematchRoom: null, recorded: true,
    },
    modeLabel: 'live draft', elements: null, guest: false, signup: null, matchResult: '',
  });
  assert.match(postGameHtml(v(0)), /^<div class="overlay pgover"><div class="pgbox won" role="dialog" aria-label="You win!">/);
  assert.match(postGameHtml(v(1)), /<div class="pgbox lost" role="dialog" aria-label="Bo &lt;b&gt; wins">/, 'a name is escaped');
  assert.match(postGameHtml(v(null)), /<div class="pgbox " role="dialog" aria-label="Game over">/);
  // the board's rules reader was already one, and the census follows into it
  assert.match(helpBoxHtml(), /^<div class="overlaybox helpbox[^"]*" role="dialog" aria-label="[^"]+">/);
});
