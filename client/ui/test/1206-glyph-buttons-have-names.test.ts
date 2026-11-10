/* 1206 · A BUTTON DRAWN AS A SYMBOL HAS A NAME A SCREEN READER CAN SAY (BL-10, 2026-11-10)
 *
 * The inventory listed it (docs/23-ui-inventory/05 §18.25): "Transport
 * buttons are glyphs with `title` only (replaybar.ts:183–188)". The class was
 * 33 buttons across the client whose only content is a symbol: the replay's
 * ⏮ ◀ ⏸/▶ ▶| ⏭ and its ×, the lesson frames' ⏮ ▶ ⏭, the table toolbar's
 * 📘 🧪 ☰ ↶ ⚖ ? 📝 ⋯, the seen-hand strip's ✕, every close × / ✕ (card
 * panel, scenario, notifications, a challenge run), the card search's × and ?,
 * the sandbox's − / +, the rules review's ↻, the bell, the admin report
 * marks. A button's spoken name is its content before its title, so a screen reader said "black right-pointing
 * triangle" or "question mark", and nothing about what pressing it does.
 *
 * A button is named when it carries aria-label / aria-labelledby, or when its
 * content (text, an <img alt>) has a letter or a digit in it. A `${…}` in the
 * content counts as words unless it is a ternary of two quoted literals (the
 * play/pause swap), whose literals are read instead. Each one fixed kept its
 * title (the hover hint) and got a short aria-label, the way the design
 * system's icon button already does (components/button.ts), so nothing moved
 * on screen.
 *
 *   §0  non-vacuity: the stories are reached and the detector tells the cases apart
 *   §1  every button every page and component story draws has a name
 *   §2  every button written out in the client's source has a name (the board,
 *       the replay bar, the lessons and the sandbox no story reaches)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STORYBOOK_STORIES_DIR, UI_COMPONENTS_DIR, UI_DIR, UI_PAGES_DIR } from '../../engine/scripts/paths.mjs';

const TPL = String.raw`\$\{(?:[^{}]|\{[^{}]*\})*\}`;
const BUTTON = new RegExp(String.raw`<button\b((?:${TPL}|[^>$]|\$(?!\{))*)>((?:${TPL}|[^$<]|<(?!/button>)|\$(?!\{))*)</button>`, 'g');
const LITERAL_SWAP = /^\s*[\w.!=&|' ()]+\?\s*'([^']*)'\s*:\s*'([^']*)'\s*$/;

/** the opening tag of every <button> in `markup` whose name would be a bare
 * symbol. Template attributes are stepped over whole, so the same detector
 * reads rendered HTML and source. */
function unnamed(markup: string): string[] {
  const out: string[] = [];
  for (const m of markup.matchAll(BUTTON)) {
    const attrs = m[1]!;
    if (/\baria-label(?:ledby)?=/.test(attrs)) continue;
    let words = false;
    const body = m[2]!.replace(new RegExp(TPL, 'g'), t => {
      const swap = t.slice(2, -1).match(LITERAL_SWAP);
      if (swap) return swap[1]! + swap[2]!;
      words = true;
      return '';
    });
    if (words) continue;
    const alts = [...body.matchAll(/\balt="([^"]*)"/g)].map(a => a[1]).join(' ');
    const text = body.replace(/<[^>]*>/g, '').replace(/&[a-z]+;|&#\d+;/gi, '') + alts;
    if (/[\p{L}\p{N}]/u.test(text)) continue;
    out.push(`<button${attrs.replace(/\s+/g, ' ').slice(0, 90)}>${m[2]!.trim().slice(0, 30)}`);
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

test('§0 non-vacuity: the stories are reached and the detector tells the cases apart', async () => {
  const all = await stories();
  assert.ok(all.length >= 150, `only ${all.length} stories rendered`);
  const buttons = all.reduce((n, [, h]) => n + (h.match(/<button\b/g)?.length ?? 0), 0);
  assert.ok(buttons >= 300, `the stories draw only ${buttons} buttons`);
  const src = SOURCES();
  assert.ok(src.length >= 80, 'the source census reads the client');
  const replay = src.find(([f]) => f === 'replaybar.ts')?.[1] ?? '';
  assert.ok([...replay.matchAll(BUTTON)].length >= 8, 'the detector reads the replay bar\'s buttons');
  assert.equal(unnamed('<button data-replay="start" title="back to the beginning">⏮</button>').length, 1, 'a title is not the name');
  assert.equal(unnamed('<button class="cbclose" title="close">×</button>').length, 1);
  assert.equal(unnamed('<button>&times;</button>').length, 1, 'an entity glyph is still a glyph');
  assert.equal(unnamed('<button data-x="${a ? \'on\' : \'\'}">${playing ? \'⏸\' : \'▶\'}</button>').length, 1, 'a swap of two glyphs');
  assert.equal(unnamed('<button>📝<span class="tbsub">stop</span></button>').length, 0, 'a glyph with a caption');
  assert.deepEqual(unnamed('<button aria-label="Undo" title="undo">↶</button><button>Copy</button><button>All 5</button>'), []);
  assert.deepEqual(unnamed('<button title="Ignis"><img src="x.webp" alt="Ignis Sprite"></button>'), [], 'an image with alt text');
  assert.equal(unnamed('<button><img src="x.webp" alt=""></button>').length, 1, 'an image with empty alt');
  assert.deepEqual(unnamed('<button>${esc(o.label)}</button><button>${n ? `Play ${n}` : \'Play none\'}</button>'), [], 'templated words');
});

test('§1 every button a page or component story draws has a name', async () => {
  const bad = (await stories()).flatMap(([name, html]) => unnamed(html).map(c => `${name}: ${c}`));
  assert.deepEqual([...new Set(bad)], [],
    'a button drawn as a bare symbol has no name a screen reader can say (its title is only a hover hint). '
    + 'Give it a short aria-label: what pressing it does');
});

test('§2 every button written out in the client source has a name', () => {
  const bad = SOURCES().flatMap(([f, src]) => unnamed(src).map(c => `${f}: ${c}`));
  assert.deepEqual(bad, [], 'a button in the source is only a symbol and has no aria-label');
});
