/* 1208 · A TABLE'S HEADERS AND A SCREEN'S TITLE SAY WHAT THEY ARE (BL-10, 2026-11-10)
 *
 * The inventory listed it (docs/23-ui-inventory/05 §18.26): "`<em>` with
 * `font-style:normal` as a blurb (lobby.ts:98), `<i>` as a dot, `<b>` as
 * status; post-game title is a `<div>`, not a heading; stat table has an
 * empty `<th>`."
 *
 * The empty header was a class, not one cell: nine columns across the client
 * had a header cell with nothing in it — the post-game's middle column, the
 * profile's Replay and Add friend columns (three tables), card stats' win-rate
 * bar and its colour-pair corner, the board's resource window's corner, and,
 * through the table component's `label: ''`, the deck sheet's replay links and
 * a closed challenge's Try / Watch buttons. A screen reader moving along a row
 * announces each cell's column header, and those said nothing. Each now holds
 * a name drawn nowhere (`.srname`, base.css), so nothing on screen moved; the
 * component takes it as `spokenLabel`.
 *
 * The post-game's title is an <h2>, so a screen reader's "next heading" finds
 * who won, and its stat table's middle column (life left, units played…) is
 * row headers, so each number is read with what it counts. The draft lobby's
 * method blurb is a <span>, not an <em> undone by CSS. Left as they were: the
 * seat dots (an empty <i>, which says nothing and needs to say nothing — the
 * words beside it carry the state) and the "ready" in <b>.
 *
 *   §0  non-vacuity: the stories are reached and the detector tells the cases apart
 *   §1  every header cell a page or component story draws has words
 *   §2  every header cell written out in the client's source has words
 *   §3  every column given to the table component with no label is in a
 *       headless table or has a spokenLabel
 *   §4  the post-game: the title is a heading, the stat rows are row headers
 *   §5  the draft lobby's method blurb is not an <em>
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STORYBOOK_STORIES_DIR, UI_COMPONENTS_DIR, UI_DIR, UI_PAGES_DIR } from '../../engine/scripts/paths.mjs';
import { table } from '../components/table.ts';
import { postGameHtml, type PostGameView } from '../pages/postgame.ts';
import type { GameOver } from '../postgame.ts';
import { readStyles } from './read-styles.ts';

const TPL = String.raw`\$\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}`;
const TH = new RegExp(String.raw`<th\b((?:${TPL}|[^>$]|\$(?!\{))*)>((?:${TPL}|[^$<]|<(?!/th>)|\$(?!\{))*)</th>`, 'g');

/** the opening tag of every <th> in `markup` with nothing a screen reader
 * could say: no letter, digit or "#" in its text (an .srname span counts — it is
 * text), no img alt, no aria-label, and no `${…}` (taken as words). */
function nameless(markup: string): string[] {
  const out: string[] = [];
  for (const m of markup.matchAll(TH)) {
    const attrs = m[1]!, body = m[2]!;
    if (/\baria-label(?:ledby)?=/.test(attrs)) continue;
    if (new RegExp(TPL).test(body)) continue;
    const alts = [...body.matchAll(/\balt="([^"]*)"/g)].map(a => a[1]).join(' ');
    const text = body.replace(/<[^>]*>/g, '').replace(/&[a-z]+;|&#\d+;/gi, '') + alts;
    if (/[\p{L}\p{N}#]/u.test(text)) continue; // "#" is read out as "number"
    out.push(`<th${attrs.replace(/\s+/g, ' ').slice(0, 80)}>${body.trim().slice(0, 30)}</th>`);
  }
  return out;
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

/** the client's own modules: ui/*.ts, pages/*.ts, components/*.ts, comments stripped */
const SOURCES = (): Array<[string, string]> => {
  const read = (dir: string, prefix: string): Array<[string, string]> => readdirSync(dir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map(f => [`${prefix}${f}`, readFileSync(join(dir, f), 'utf8')] as [string, string]);
  return [...read(UI_DIR, ''), ...read(UI_PAGES_DIR, 'pages/'), ...read(UI_COMPONENTS_DIR, 'components/')]
    .map(([f, s]) => [f, s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')]);
};

/** column literals `{ key: …, label: '' … }` with no spokenLabel, each with
 * the name of the const array it sits in (null when it is written inline) */
function unspokenColumns(src: string): Array<{ literal: string; array: string | null }> {
  const out: Array<{ literal: string; array: string | null }> = [];
  for (const m of src.matchAll(/\{\s*key:\s*'[^']*',\s*label:\s*''[^{}]*\}/g)) {
    if (/\bspokenLabel:/.test(m[0])) continue;
    const line = src.slice(src.lastIndexOf('\n', m.index!) + 1, m.index!);
    out.push({ literal: m[0], array: /\bconst\s+(\w+)\s*(?::[^=]*)?=\s*\[/.exec(line)?.[1] ?? null });
  }
  return out;
}

/** every `table({ … columns: NAME` call naming this array is headless */
function onlyHeadless(src: string, array: string): boolean {
  const uses = [...src.matchAll(new RegExp(String.raw`table\(\{([^}]*?)columns:\s*(?:[\w.]+\s*\?\s*)?(?:\w+\s*:\s*)?\b${array}\b`, 'g'))];
  return uses.length > 0 && uses.every(u => /\bheadless:\s*true\b/.test(u[1]!));
}

test('§0 non-vacuity: the stories are reached and the detector tells the cases apart', async () => {
  const all = await stories();
  assert.ok(all.length >= 150, `only ${all.length} stories rendered`);
  const ths = all.reduce((n, [, h]) => n + (h.match(/<th\b/g)?.length ?? 0), 0);
  assert.ok(ths >= 60, `the stories draw only ${ths} header cells`);
  assert.ok(all.some(([n, h]) => /^postgame/.test(n) && /class="pgtable"/.test(h)), 'a post-game story draws the stat table');
  const src = SOURCES();
  assert.ok(src.length >= 80, 'the source census reads the client');
  assert.ok(src.reduce((n, [, s]) => n + [...s.matchAll(TH)].length, 0) >= 40, 'the detector reads the source\'s header cells');
  assert.equal(nameless('<th></th>').length, 1);
  assert.equal(nameless('<th class="pfnum"> </th>').length, 1, 'whitespace is not a name');
  assert.equal(nameless('<th title="the bar">&nbsp;</th>').length, 1, 'a title is not a name');
  assert.equal(nameless('<th><img src="x.webp" alt=""></th>').length, 1, 'an image with empty alt');
  assert.deepEqual(nameless('<th>Win rate</th><th>#</th><th scope="col"><span class="srname">Stat</span></th>'), [], 'words, a hidden name, and "#" (read as "number")');
  assert.deepEqual(nameless('<th title="${e}">${elIcon(e, e)}</th><th class="${a ? \'x\' : \'\'}">${esc(n)}</th><th aria-label="Replay"></th>'), []);
  assert.deepEqual(nameless('<th><img src="x.webp" alt="fire"></th><th>1</th>'), []);
  assert.deepEqual(unspokenColumns("const A = [{ key: 'a', label: '' }, { key: 'b', label: '', spokenLabel: 'B' }];")
    .map(c => c.array), ['A']);
  assert.ok(onlyHeadless("table({ className: 'x', headless: true, columns: A, rows })", 'A'));
  assert.ok(!onlyHeadless("table({ className: 'x', columns: A, rows })", 'A'));
  assert.ok(!onlyHeadless('', 'A'), 'an array no table names is not proven headless');
});

test('§1 every header cell a page or component story draws has words', async () => {
  const bad = (await stories()).flatMap(([name, html]) => nameless(html).map(c => `${name}: ${c}`));
  assert.deepEqual([...new Set(bad)], [],
    'a column header with nothing in it: a screen reader names each cell by its column, and this says nothing. '
    + 'Put the column\'s name in <span class="srname">…</span> (drawn nowhere), or a spokenLabel on a table() column');
});

test('§2 every header cell written out in the client source has words', () => {
  const bad = SOURCES().flatMap(([f, src]) => nameless(src).map(c => `${f}: ${c}`));
  assert.deepEqual(bad, [], 'an empty <th> in the source — give it <span class="srname">the column\'s name</span>');
});

test('§3 a table() column with no label is headless or has a spokenLabel', () => {
  const bad: string[] = [];
  let seen = 0;
  for (const [f, src] of SOURCES()) {
    for (const c of unspokenColumns(src)) {
      seen++;
      if (!c.array || !onlyHeadless(src, c.array)) bad.push(`${f}: ${c.array ?? '(inline)'} ${c.literal}`);
    }
  }
  assert.ok(seen >= 10, `the census finds the league's headless columns (${seen})`);
  assert.deepEqual(bad, [], 'a column with label \'\' under a drawn header row: give it a spokenLabel');
  // and the component draws it, out of sight
  const html = table({ columns: [{ key: 'a', label: 'Played' }, { key: 'b', label: '', spokenLabel: 'Replay' }], rows: [] });
  assert.match(html, /<th scope="col">Played<\/th><th scope="col"><span class="srname">Replay<\/span><\/th>/);
  assert.match(table({ columns: [{ key: 'a', label: 'Seen', spokenLabel: 'x' }], rows: [] }), /<th scope="col">Seen<\/th>/,
    'a drawn label wins');
  // .srname is drawn nowhere and is not scoped away from the board
  const rule = /(^|\n)\.srname \{([^}]*)\}/.exec(readStyles());
  assert.ok(rule, '.srname has a rule of its own, outside :where()');
  assert.match(rule[2]!, /position: absolute/);
  assert.match(rule[2]!, /clip-path: inset\(50%\)/);
  assert.match(rule[2]!, /width: 1px/);
});

const seat = (name: string, over: Partial<GameOver['seats'][0]> = {}): GameOver['seats'][0] => ({
  name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 0, ...over,
});

test('§4 the post-game: the title is a heading, each stat row is headed by what it counts', () => {
  const v: PostGameView = {
    over: {
      seat: 0, winner: 0, names: ['Ann', 'Bo'], mode: 'draft', els: ['fire', 'wood', 'water'], turns: 7,
      seats: [seat('Ann', { lifeLeft: 12, unitsPlayed: 5, cardElements: { fire: 4 } }), seat('Bo', { unitsPlayed: 7 })],
      rematch: [false, false], rematchRoom: null, recorded: true,
    },
    modeLabel: 'live draft', elements: null, guest: false, signup: null, matchResult: '',
  };
  const html = postGameHtml(v);
  assert.match(html, /<h2 class="pgtitle">You win!<\/h2>/);
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(r => r[1]!).filter(r => /<td/.test(r));
  assert.ok(rows.length >= 4, 'life left, units played, leaned on, most played');
  for (const r of rows) assert.match(r, /<th scope="row" class="pglabel">[^<]+<\/th>/, `a stat row with no row header: ${r.trim().slice(0, 80)}`);
  assert.match(html, /<th scope="row" class="pglabel">life left<\/th>/);
  // the row headers look as the cells they replaced did: the head's bold and padding stay on the head
  const css = readStyles();
  assert.match(css, /\.pgtable thead th \{ padding/);
  assert.match(css, /\.pgtable tbody :is\(td, th\) \{ padding: var\(--space-1\) var\(--space-4\); border-top: 1px dotted/);
  assert.match(css, /\.pglabel \{[^}]*font-weight: 400/);
  assert.match(css, /\.pgtitle \{ margin: 0;/, 'an h2 brings the browser\'s margins; the old div had none');
});

test('§5 the draft lobby\'s method blurb is not an <em> undone by CSS', () => {
  const src = readFileSync(join(UI_PAGES_DIR, 'lobby.ts'), 'utf8');
  assert.match(src, /<span class="lobbyblurb">\$\{esc\(m\.blurb\)\}<\/span>/);
  assert.doesNotMatch(src, /<em>/);
  assert.doesNotMatch(readStyles(), /\.lobbymethod em\b/);
});
