/* 1207 · A BUTTON THAT SHOWS IT IS CHOSEN SAYS SO TO A SCREEN READER (BL-10, 2026-11-10)
 *
 * The inventory listed it (docs/23-ui-inventory/05 §18.23): "Radio-like
 * groups are plain buttons with `.on`, no `aria-pressed`/`role="radio"`:
 * lobby methods, queue format, ranked/open, rank chips, replay moments". The
 * class is every button whose look changes with a class `on` — the chosen
 * one of a group (a draft method, Ranked or Open, a sort column, a clock, a
 * tab), a filter chip that is in or out, a switch, a button that opens a
 * panel. A sighted player sees the gold `.on`; a screen reader said "button"
 * for all of them alike and never which one was chosen, or whether the panel
 * was open.
 *
 * Each one now carries the state in the attribute its kind takes, and nothing
 * moves on screen:
 *   - aria-pressed  a choice or a switch (the design system's segmented and
 *                   toggle components already do this, components/*.ts)
 *   - aria-expanded a button that opens and closes a panel below it
 *   - aria-current  where you are in a list of places (a rules section, a deck)
 *   - aria-checked / aria-selected where a group already took role="radio"
 *                   or role="option"
 *
 *   §0  non-vacuity: the stories are reached and the detector tells the cases apart
 *   §1  every chosen button a page or component story draws says so
 *   §2  every button in the client's source whose class can be `on` says so
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STORYBOOK_STORIES_DIR, UI_COMPONENTS_DIR, UI_DIR, UI_PAGES_DIR } from '../../engine/scripts/paths.mjs';

const TPL = String.raw`\$\{(?:[^{}]|\{[^{}]*\})*\}`;
const OPEN_TAG = new RegExp(String.raw`<button\b((?:${TPL}|[^>$]|\$(?!\{))*)>`, 'g');
const CLASS_ATTR = new RegExp(String.raw`\bclass="((?:${TPL}|[^"$]|\$(?!\{))*)"`);
const STATE = /\baria-(?:pressed|checked|selected|current|expanded)=/;

/** the opening tag of every <button> in `markup` that can wear `on` and
 * says nothing of it. In rendered HTML that is a class token `on`; in source,
 * a `${…}` in the class that puts the literal 'on' there. The same detector
 * reads both, template attributes stepped over whole. */
function silent(markup: string): string[] {
  const out: string[] = [];
  for (const m of markup.matchAll(OPEN_TAG)) {
    const attrs = m[1]!;
    const cls = attrs.match(CLASS_ATTR)?.[1];
    if (cls === undefined) continue;
    const literal = cls.replace(new RegExp(TPL, 'g'), ' ');
    const templated = [...cls.matchAll(new RegExp(TPL, 'g'))].some(t => /'\s*on\s*'/.test(t[0]));
    if (!templated && !/(?:^|\s)on(?:\s|$)/.test(literal)) continue;
    if (STATE.test(attrs)) continue;
    out.push(`<button${attrs.replace(/\s+/g, ' ').slice(0, 110)}>`);
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
  const chosen = all.reduce((n, [, h]) => n + (h.match(/<button\b[^>]*\bclass="(?:[^"]*\s)?on(?:\s[^"]*)?"/g)?.length ?? 0), 0);
  assert.ok(chosen >= 20, `the stories draw only ${chosen} chosen buttons`);
  const src = SOURCES();
  assert.ok(src.length >= 80, 'the source census reads the client');
  const lobby = src.find(([f]) => f === 'pages/lobby.ts')?.[1] ?? '';
  assert.ok([...lobby.matchAll(OPEN_TAG)].length >= 3, 'the detector reads the draft lobby\'s buttons');
  // source shapes
  assert.equal(silent('<button class="lobbymethod ${m.id === lobby.method ? \'on\' : \'\'}" data-btn="x">').length, 1);
  assert.equal(silent('<button class="qopt${r === pick ? \' on\' : \'\'}"\n  data-btn="queue-ranked">').length, 1, 'across lines');
  assert.equal(silent('<button data-btn="cr-dl" class="${dlOpen ? \'on\' : \'\'}">').length, 1, 'class after other attributes');
  assert.equal(silent('<button class="${on ? \'on\' : armed ? \'danger\' : \'\'}">').length, 1, 'a chained ternary');
  assert.deepEqual(silent('<button class="qopt${r ? \' on\' : \'\'}" aria-pressed="${r}">'), []);
  assert.deepEqual(silent('<button type="button" role="radio" aria-checked="${p}" class="${p ? \'on\' : \'\'}">'), []);
  assert.deepEqual(silent('<button class="x${open ? \' on\' : \'\'}" aria-expanded="${open}">'), []);
  assert.deepEqual(silent('<button class="dkbox${b.on ? \' on\' : \'\'}"${b.on ? \' aria-current="true"\' : \'\'}>'), [], 'a templated attribute');
  assert.deepEqual(silent('<button class="${v.kind}" data-btn="x">'), [], 'a class that is never `on`');
  assert.deepEqual(silent('<button class="online one">'), [], '`on` inside a word');
  // rendered shapes
  assert.equal(silent('<button class="elchip ignis on" data-el="ignis">').length, 1);
  assert.deepEqual(silent('<button class="elchip ignis" data-el="ignis">'), [], 'an unchosen chip in rendered HTML');
  assert.deepEqual(silent('<button class="elchip ignis on" aria-pressed="true">'), []);
});

test('§1 every chosen button a page or component story draws says so', async () => {
  const bad = (await stories()).flatMap(([name, html]) => silent(html).map(c => `${name}: ${c}`));
  assert.deepEqual([...new Set(bad)], [],
    'a button drawn as chosen (class `on`) does not say so to a screen reader. Give it aria-pressed '
    + '(a choice or a switch), aria-expanded (it opens a panel) or aria-current (a place in a list)');
});

test('§2 every button in the client source whose class can be `on` says so', () => {
  const bad = SOURCES().flatMap(([f, src]) => silent(src).map(c => `${f}: ${c}`));
  assert.deepEqual(bad, [], 'a button whose class can be `on` has no aria-pressed / aria-expanded / aria-current');
});
