/* 1518 · A TABLE'S HEADS START WITH A CAPITAL (BL-10, 2026-11-24)
 *
 * The inventory listed it (docs/23-ui-inventory/02 §8.4 item 15: "admin table
 * headers are lowercase and **not** uppercased, while `.accttable th` are").
 * The class was every header cell outside the game: the admin's five tables,
 * the card search's syntax table, the deck description's syntax table, the
 * deck stats' affinity table, the post-game's stat rows, and, through the
 * table component, the league's and the weekly challenge's "player". Card
 * stats, the profile, the decks sheet and the cube already wrote "Result",
 * "Player", "Win rate". A head the CSS uppercases is written the same way, so
 * a screen reader and the source read one convention.
 *
 * NOT covered, on purpose:
 *   - a head whose words are data: an element's own name (`acctel`), a
 *     player's name, anything whose first word is a `${…}`
 *   - the game table (main.ts's board, its resource and life summaries):
 *     BL-10 is aimed away from the play area
 *
 *   §0  non-vacuity: the stories are reached and the detector catches what it should
 *   §1  every header cell a page or component story draws starts with a capital
 *   §2  every header cell written out in a page or component module starts with a capital
 *   §3  every column given to the table component, and every post-game stat row, starts with a capital
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STORYBOOK_STORIES_DIR, UI_COMPONENTS_DIR, UI_PAGES_DIR } from '../../engine/scripts/paths.mjs';

const TPL = String.raw`\$\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}`;
const TH = new RegExp(String.raw`<th\b((?:${TPL}|[^>$]|\$(?!\{))*)>((?:${TPL}|[^$<]|<(?!/th>)|\$(?!\{))*)</th>`, 'g');
const EXEMPT = /\bacctel\b/;

/** the text's first letter or digit, when it is a lower-case letter */
function lowerStart(text: string): boolean {
  const c = text.match(/[\p{L}\p{N}]/u);
  return !!c && c[0] !== c[0].toUpperCase();
}

/** every <th> in `markup` whose words start lower-case; a head that opens on a `${…}` is data */
function lowerHeads(markup: string): string[] {
  const out: string[] = [];
  for (const m of markup.matchAll(TH)) {
    const attrs = m[1]!, body = m[2]!;
    if (EXEMPT.test(attrs)) continue;
    const text = body.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').trim();
    if (text.startsWith('${')) continue;
    if (lowerStart(text)) out.push(text.slice(0, 40));
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
        // a story with no render of its own is drawn by the file's default render with the args merged, as Storybook does
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

/** the page and component modules, comments stripped */
const SOURCES = (): Array<[string, string]> => {
  const read = (dir: string, prefix: string): Array<[string, string]> => readdirSync(dir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map(f => [`${prefix}${f}`, readFileSync(join(dir, f), 'utf8')] as [string, string]);
  return [...read(UI_PAGES_DIR, 'pages/'), ...read(UI_COMPONENTS_DIR, 'components/')]
    .map(([f, s]) => [f, s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')]);
};

/** every `{ key: '…', label: '…'` column literal whose label starts lower-case */
function lowerColumns(src: string): string[] {
  return [...src.matchAll(/\{\s*key:\s*'[^']*',\s*label:\s*'([^']*)'/g)].map(m => m[1]!).filter(lowerStart);
}

test('§0 non-vacuity: the stories are reached and the detector catches what it should', async () => {
  const all = await stories();
  assert.ok(all.length >= 150, `only ${all.length} stories rendered`);
  const ths = all.reduce((n, [, h]) => n + (h.match(/<th\b/g)?.length ?? 0), 0);
  assert.ok(ths >= 60, `the stories draw only ${ths} header cells`);
  for (const [story, cls] of [['admin', 'admintable'], ['postgame', 'pgtable'], ['league', 'ui-table']] as const) {
    assert.ok(all.some(([n, h]) => n.startsWith(story) && h.includes(`class="${cls}`)), `a ${story} story draws a ${cls}`);
  }
  const src = SOURCES();
  assert.ok(src.some(([f]) => f === 'pages/admin.ts') && src.some(([f]) => f === 'components/table.ts'), 'the source census reads pages and components');
  assert.ok(src.reduce((n, [, s]) => n + [...s.matchAll(TH)].length, 0) >= 40, 'the detector reads the source\'s header cells');
  assert.deepEqual(lowerHeads('<th>account</th><th scope="row" class="pglabel">leaned on</th><th><span class="srname">stat</span></th>'),
    ['account', 'leaned on', 'stat']);
  assert.deepEqual(lowerHeads('<th>Account</th><th>#</th><th>3 games</th><th class="acctel fire">fire</th>'
    + '<th>${esc(o.names[me])}</th><th title="${e}">${elIcon(e, e)}</th><th><img alt="fire"></th>'), []);
  assert.deepEqual(lowerColumns("[{ key: 'rank', label: '#' }, { key: 'player', label: 'player' }, { key: 'x', label: '' }, { key: 'w', label: 'Wins' }]"),
    ['player']);
});

test('§1 every header cell a page or component story draws starts with a capital', async () => {
  const bad = (await stories()).flatMap(([name, html]) => lowerHeads(html).map(t => `${name}: ${t}`));
  assert.deepEqual([...new Set(bad)], [], 'a table head starts lower-case: write it as a sentence, "Last played"');
});

test('§2 every header cell written out in a page or component module starts with a capital', () => {
  const bad = SOURCES().flatMap(([f, s]) => lowerHeads(s).map(t => `${f}: ${t}`));
  assert.deepEqual(bad, [], 'a table head starts lower-case: write it as a sentence, "Last played"');
});

test('§3 every table component column, and every post-game stat row, starts with a capital', () => {
  const bad = SOURCES().flatMap(([f, s]) => lowerColumns(s).map(t => `${f}: ${t}`));
  assert.deepEqual(bad, [], 'a table() column label starts lower-case');
  const post = SOURCES().find(([f]) => f === 'pages/postgame.ts')![1];
  const rows = [...post.matchAll(/\{ label: '([^']*)', get:/g)].map(m => m[1]!);
  assert.ok(rows.length >= 10, 'the post-game stat rows are read');
  assert.deepEqual(rows.filter(lowerStart), [], 'a post-game stat row starts lower-case');
});
