/* 1537 · A PAGE'S CAPTIONS START WITH A CAPITAL (BL-10)
 *
 * A `.zonelabel` caption is uppercased by the CSS, so on screen "format" and
 * "Format" look alike; a screen reader and the source do not. Every other
 * caption outside the game is written as a sentence ("Your matches", "Custom
 * rules"), as the buttons (1177) and table heads (1518) are.
 *
 * NOT covered, on purpose: a caption that opens on a `${…}` (its words are
 * data); the component stories' showcase labels, which name a prop's value
 * (`md`, `tag`); and main.ts's board captions — BL-10 is aimed away from the play area.
 *
 *   §0  non-vacuity: the stories and sources are reached and the detector catches what it should
 *   §1  every caption a page story draws starts with a capital
 *   §2  every caption written out in a page or component module starts with a capital
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STORYBOOK_STORIES_DIR, UI_COMPONENTS_DIR, UI_PAGES_DIR } from '../../engine/scripts/paths.mjs';

const CAPTION = /<(div|span)\b[^>]*\bclass="zonelabel"[^>]*>([^<]*)/g;

/** the text's first letter or digit, when it is a lower-case letter */
function lowerStart(text: string): boolean {
  const c = text.match(/[\p{L}\p{N}]/u);
  return !!c && c[0] !== c[0].toUpperCase();
}

/** every caption in `markup` whose words start lower-case; one that opens on a `${…}` is data */
function lowerCaptions(markup: string): string[] {
  return [...markup.matchAll(CAPTION)].map(m => m[2]!.trim())
    .filter(t => !t.startsWith('$') && lowerStart(t)).map(t => t.slice(0, 40));
}

/** every rendered page story: [story, html] */
async function stories(): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  {
    const dir = join(STORYBOOK_STORIES_DIR, 'pages');
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

/** the page and component modules, comments stripped */
const SOURCES = (): Array<[string, string]> => {
  const read = (dir: string, prefix: string): Array<[string, string]> => readdirSync(dir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map(f => [`${prefix}${f}`, readFileSync(join(dir, f), 'utf8')] as [string, string]);
  return [...read(UI_PAGES_DIR, 'pages/'), ...read(UI_COMPONENTS_DIR, 'components/')]
    .map(([f, s]) => [f, s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')]);
};

test('§0 BL-10: the captions census reaches the stories and sources, and catches a lower-case caption', async () => {
  const all = await stories();
  assert.ok(all.length >= 60, `only ${all.length} stories rendered`);
  const drawn = all.reduce((n, [, h]) => n + [...h.matchAll(CAPTION)].length, 0);
  assert.ok(drawn >= 20, `the stories draw only ${drawn} captions`);
  assert.ok(all.some(([n, h]) => n.startsWith('cardstats') && h.includes('class="zonelabel">Format<')), 'a card stats story draws its Format caption');
  const src = SOURCES();
  assert.ok(src.some(([f]) => f === 'pages/meta.ts') && src.some(([f]) => f === 'pages/cardstats.ts'), 'the source census reads the pages');
  assert.ok(src.reduce((n, [, s]) => n + [...s.matchAll(CAPTION)].length, 0) >= 15, 'the detector reads the source\'s captions');
  assert.deepEqual(lowerCaptions('<span class="zonelabel">group by</span><div class="zonelabel" style="x">min games</div>'), ['group by', 'min games']);
  assert.deepEqual(lowerCaptions('<span class="zonelabel">Export</span><div class="zonelabel">${label}</div><div class="zonelabel">3 left</div>'), []);
});

test('§1 BL-10: every caption a page story draws starts with a capital', async () => {
  const bad = (await stories()).flatMap(([name, html]) => lowerCaptions(html).map(t => `${name}: ${t}`));
  assert.deepEqual([...new Set(bad)], [], 'a caption starts lower-case: write it as a sentence, "Group by"');
});

test('§2 BL-10: every caption written out in a page or component module starts with a capital', () => {
  const bad = SOURCES().flatMap(([f, s]) => lowerCaptions(s).map(t => `${f}: ${t}`));
  assert.deepEqual(bad, [], 'a caption starts lower-case: write it as a sentence, "Group by"');
});
