/* A hover (`title`) is plain text: the browser draws it as written, so a card
 * text token in one — `{Battle}`, `[Switch1]` — shows its braces instead of
 * the icon the card text draws. A hover names the icon in words.
 *
 *   §0  non-vacuity: the stories are reached, the deck stats' battle cell among them
 *   §1  no hover a page or component story draws carries a token
 *   §2  no hover written out in the client's sources carries a token
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { STORYBOOK_STORIES_DIR, UI_DIR } from '../../engine/scripts/paths.mjs';

/** `{Battle}`, `{Haste}`, `[Switch1]`, `[Augment]`: a word in braces or brackets, capitalised as the card text writes it */
const TOKEN = /\{[A-Z][a-z]+\d?\}|\[[A-Z][a-z]+\d?\]/;

const tokenHovers = (html: string): string[] =>
  [...html.matchAll(/\btitle="([^"]*)"/g)].map(m => m[1]!).filter(t => TOKEN.test(t));

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

const SKIP = new Set(['node_modules', 'test', 'storybook-static']);
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return SKIP.has(f) ? [] : sources(p);
    return f.endsWith('.ts') && !f.endsWith('.d.ts') ? [p] : [];
  });
}

/** a hover written as a literal: `title: '…'` or `title="…"`, the literal's text */
const HOVER_LITERAL = /\btitle\s*(?::|=)\s*(?:\{\s*)?(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;

test('BL-10: §0 the detector sees a token hover, and the stories draw the deck stats', async () => {
  assert.deepEqual(tokenHovers('<div title="cards printed {Battle} — x"></div><img title="a [Switch1] line">'),
    ['cards printed {Battle} — x', 'a [Switch1] line']);
  assert.deepEqual(tokenHovers('<div title="cards with the Battle icon"></div>'), []);
  const all = await stories();
  assert.ok(all.length > 100, `draws the stories, not an empty directory (${all.length})`);
  assert.ok(all.some(([, html]) => /title="[^"]*"><div class="statval">\d+<\/div><div class="statlab">battle cards</.test(html)),
    'a story draws the deck stats\' battle cell with its hover');
});

test('BL-10: §1 no story draws a hover with a card text token in it', async () => {
  const bad = (await stories()).flatMap(([name, html]) => tokenHovers(html).map(t => `${name}: ${t}`));
  assert.deepEqual(bad, []);
});

test('BL-10: §2 no hover written in the client carries a card text token', () => {
  const files = sources(UI_DIR);
  assert.ok(files.length > 100, `reads the client (${files.length})`);
  const bad: string[] = [];
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(HOVER_LITERAL)) {
      if (TOKEN.test(m[2]!)) bad.push(`${relative(UI_DIR, f)}: ${m[2]!.slice(0, 80)}`);
    }
  }
  assert.deepEqual(bad, []);
});
