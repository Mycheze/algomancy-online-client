/* 1205 · EVERY TEXT BOX, MENU AND WRITING AREA HAS A NAME (BL-10, 2026-11-10)
 *
 * The inventory listed it (docs/23-ui-inventory/05 §18.24): "Unlabelled
 * inputs: share link, deck <select>, #h-deckurl, #sc-q, post-game claim
 * inputs (placeholder-only)". The class was 51 controls across the client:
 * the room link every waiting room draws, the deck menu on home and in every
 * room, every search box (cards, metagame, card stats, rules, deck builder,
 * sandbox, single-card duel), every username and password box outside the
 * sign-in screen, the report and dispute boxes, the take-back form, the
 * league's forms, the judge boxes. A screen reader announced each as "edit
 * text" or "combo box" and nothing else: a placeholder is not a name (it is
 * gone once the box has text, and a <select> has none), and the setting
 * row's label column is a <div>, tied to nothing.
 *
 * A control is named when it carries aria-label / aria-labelledby / title,
 * when a `<label for="its id">` is in the same markup, or when it sits inside
 * a <label>. Hidden controls need none. Each one fixed got an aria-label, so
 * nothing moved on screen.
 *
 *   §0  non-vacuity: the stories are reached and the detector tells the cases apart
 *   §1  every control every page and component story draws has a name
 *   §2  every control written out in the client's source has a name (the
 *       board, the sandbox, the league and the rules pages no story reaches)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STORYBOOK_STORIES_DIR, UI_COMPONENTS_DIR, UI_DIR, UI_PAGES_DIR } from '../../engine/scripts/paths.mjs';

/** the attributes of every <input>/<select>/<textarea> in `markup` with no
 * name. Template attributes (`${…}`, even one holding a `>`) are stepped over
 * whole, so the same detector reads rendered HTML and source. */
function unnamed(markup: string): string[] {
  const out: string[] = [];
  for (const m of markup.matchAll(/<(input|select|textarea)\b((?:\$\{[^}]*\}|[^>$]|\$(?!\{))*)>/g)) {
    const attrs = m[2]!;
    if (/\baria-label(?:ledby)?=|\btitle=|\bhidden\b|type="hidden"/.test(attrs)) continue;
    const id = attrs.match(/\bid="([^"]*)"/)?.[1];
    if (id && markup.includes(`for="${id}"`)) continue;
    const before = markup.slice(0, m.index);
    if (before.lastIndexOf('<label') > before.lastIndexOf('</label>')) continue;
    out.push(`<${m[1]}${attrs.replace(/\s+/g, ' ').slice(0, 80)}>`);
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
        try { html = String(render({ ...(story.render ? {} : meta?.args), ...story.args })); } catch { continue; }   // a story that needs Storybook's args
        out.push([`${f} ${name}`, html]);
      }
    }
  }
  return out;
}

/** the client's own modules: ui/*.ts, pages/*.ts, components/*.ts. field.ts
 * is left to §1: its <label for> is built from `p.id`, which no source scan
 * can match to the control's id, and its stories render it. */
const SOURCES = (): Array<[string, string]> => {
  const read = (dir: string, prefix: string): Array<[string, string]> => readdirSync(dir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map(f => [`${prefix}${f}`, readFileSync(join(dir, f), 'utf8')] as [string, string]);
  return [...read(UI_DIR, ''), ...read(UI_PAGES_DIR, 'pages/'), ...read(UI_COMPONENTS_DIR, 'components/')]
    .filter(([f]) => f !== 'components/field.ts')
    .map(([f, s]) => [f, s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')]);
};

test('§0 non-vacuity: the stories are reached and the detector tells the cases apart', async () => {
  const all = await stories();
  assert.ok(all.length >= 150, `only ${all.length} stories rendered`);
  const controls = all.reduce((n, [, h]) => n + (h.match(/<(?:input|select|textarea)\b/g)?.length ?? 0), 0);
  assert.ok(controls >= 40, `the stories draw only ${controls} controls`);
  for (const s of ['waiting.stories.ts ConstructedAlone', 'field.stories.ts Select']) {
    assert.ok(all.some(([n]) => n === s), `${s} is not reached`);
  }
  assert.ok(SOURCES().length >= 80, 'the source census reads the client');
  assert.deepEqual(unnamed('<input class="sharelink" readonly value="x">'), ['<input class="sharelink" readonly value="x">']);
  assert.deepEqual(unnamed('<select id="h-deck"><option>a</option></select>').length, 1, 'a select has no placeholder to lean on');
  assert.deepEqual(unnamed('<input placeholder="find a card">').length, 1, 'a placeholder is not a name');
  assert.deepEqual(unnamed('<input aria-label="Room link"><select title="which clause"></select><input type="hidden" name="x">'), []);
  assert.deepEqual(unnamed('<label for="a-user">Username</label><input id="a-user">'), [], 'a label pointing at it');
  assert.deepEqual(unnamed('<label>Best of <select id="bo"></select></label>'), [], 'a label around it');
  assert.deepEqual(unnamed('<label>x</label><input id="q">').length, 1, 'a closed label is not around it');
  assert.deepEqual(unnamed('<input id="lg-stamp-${st}" class="${a > b ? \'x\' : \'\'}" readonly>').length, 1, 'templated attributes are stepped over');
});

test('§1 every control a page or component story draws has a name', async () => {
  const bad = (await stories()).flatMap(([name, html]) => unnamed(html).map(c => `${name}: ${c}`));
  assert.deepEqual([...new Set(bad)], [],
    'a text box, menu or writing area has no name a screen reader can say. Give it aria-label (the words a '
    + 'sighted player reads beside it, or what goes in it); a placeholder is not a name');
});

test('§2 every control written out in the client source has a name', () => {
  const bad = SOURCES().flatMap(([f, src]) => unnamed(src).map(c => `${f}: ${c}`));
  assert.deepEqual(bad, [], 'a text box, menu or writing area in the source has no aria-label, title or <label>');
});
