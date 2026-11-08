/* 1177 · A BUTTON ON A PAGE STARTS WITH A CAPITAL (BL-10, 2026-11-08)
 *
 * The rooms before a game set "copy", "start over", "fill the rest in any
 * order" and "finish choosing first" beside "I'm ready", "Change my mind" and
 * "Draft!"; the post-game box put "view the final board" under "Request
 * rematch" and "Return to home"; the card browser's "find similar · rulings ·
 * copy link" and the metagame's "copy · close" sat next to "Export this deck".
 * The inventory listed it as a smell (docs/23-ui-inventory/05 §18.11). The
 * pages the owner has approved (home, profile, decks) already write every
 * label with a capital, so the rest now do too.
 *
 * NOT covered, on purpose:
 *   - a link-style button inside a sentence ("In 3 published decks — metagame",
 *     "see the card ladder", "class:all"): `cblink`, `linkbtn`, `ui-button--link`
 *   - an element chip, whose label is the element's own lower-case name
 *     (`elchip`, `ttelchip`)
 *   - a label whose first letter-or-digit is a digit ("45m", "3 games")
 *   - the game table (main.ts's board, the lesson, the sandbox, the replay bar):
 *     BL-10 is aimed away from the play area
 *
 *   §0  non-vacuity: the stories are reached and the detector catches what it should
 *   §1  every button every page story draws starts with a capital
 *   §2  every button label written out in a page module starts with a capital
 *       (the cards, metagame and league sites no story reaches)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STORYBOOK_STORIES_DIR, UI_DIR, UI_PAGES_DIR } from '../../engine/scripts/paths.mjs';

const EXEMPT = /\b(?:elchip|ttelchip|ui-button--link|cblink|linkbtn)\b/;

/** the label's first letter or digit, when it is a lower-case letter */
function lowerStart(label: string): boolean {
  const c = label.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').match(/[\p{L}\p{N}]/u);
  return !!c && c[0] !== c[0].toUpperCase();
}

/** every `<button …>label</button>` in rendered markup that starts lower-case, as "label (data-btn)" */
function offenders(html: string): string[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter(m => !EXEMPT.test(m[1]!) && lowerStart(m[2]!))
    .map(m => `${m[2]!.replace(/<[^>]*>/g, '').trim()} (${m[1]!.match(/data-btn="([^"]*)"/)?.[1] ?? 'no data-btn'})`);
}

/** every rendered story under stories/pages/: [story, html] */
async function storyPages(): Promise<Array<[string, string]>> {
  const dir = join(STORYBOOK_STORIES_DIR, 'pages');
  const out: Array<[string, string]> = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.stories.ts')).sort()) {
    const mod = await import(join(dir, f)) as Record<string, { render?: (args: object) => unknown }>;
    for (const [name, story] of Object.entries(mod)) {
      if (name === 'default' || typeof story?.render !== 'function') continue;
      let html: string;
      try { html = String(story.render({})); } catch { continue; }   // a story that needs Storybook's args
      out.push([`${f} ${name}`, html]);
    }
  }
  return out;
}

/** labels written out in the source: `<button …>label` up to the first tag or `${`, and `button({ label: '…'` */
function sourceOffenders(source: string): string[] {
  const src = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');   // prose about <button> is not one
  const out: string[] = [];
  // the attributes may hold `${…}` (a data-card, a `disabled` ternary, even a `>`): step over each one whole
  for (const m of src.matchAll(/<button\b((?:\$\{[^}]*\}|[^>$]|\$(?!\{))*)>([^<$`]*)/g)) {
    if (!EXEMPT.test(m[1]!) && lowerStart(m[2]!)) out.push(m[2]!.trim());
  }
  for (const m of src.matchAll(/\bbutton\(\{([^}]*?)\blabel:\s*(['"])([^'"]*)\2([^}]*)\}/g)) {
    if (!EXEMPT.test(m[1]! + m[4]!) && !/variant:\s*'link'/.test(m[1]! + m[4]!) && lowerStart(m[3]!)) out.push(m[3]!);
  }
  return out;
}

const PAGE_SOURCES = (): Array<[string, string]> => [
  ...readdirSync(UI_PAGES_DIR).filter(f => f.endsWith('.ts')).map(f => [`pages/${f}`, readFileSync(join(UI_PAGES_DIR, f), 'utf8')] as [string, string]),
  ['util.ts', readFileSync(join(UI_DIR, 'util.ts'), 'utf8')],   // the share bar every room draws
];

test('§0 non-vacuity: the page stories render, and the detector tells the cases apart', async () => {
  const pages = await storyPages();
  assert.ok(pages.length >= 100, `only ${pages.length} page stories rendered`);
  for (const s of ['lobby.stories.ts Rank', 'postgame.stories.ts Disputed', 'waiting.stories.ts ConstructedAlone']) {
    assert.ok(pages.some(([n]) => n === s), `${s} is not reached`);
  }
  assert.deepEqual(offenders('<button data-btn="copylink">copy</button>'), ['copy (copylink)']);
  assert.deepEqual(offenders('<button data-btn="x"><span class="i"></span> start over</button>'), ['start over (x)'], 'markup before the words is skipped');
  assert.deepEqual(offenders('<button data-btn="copylink">Copy</button>'), []);
  assert.deepEqual(offenders('<button class="elchip fire">fire</button><button>45m</button><button>⏭</button>'), [], 'chips, digits, glyphs');
  assert.deepEqual(offenders('<button class="cblink" data-btn="meta-openpage">metagame</button>'), [], 'a link inside a sentence');
  assert.deepEqual(sourceOffenders("<button data-btn=\"x\">forget</button> ${button({ label: 'start over', dataBtn: 'y' })}"), ['forget', 'start over']);
  assert.deepEqual(sourceOffenders("<button data-btn=\"x\">${esc(n)}</button> ${button({ label: 'card ladder', variant: 'link' })}"), []);
  assert.deepEqual(sourceOffenders('<button data-card="${esc(r.name)}" ${n > 1 ? \'disabled\' : \'\'}>rulings</button>'), ['rulings'], 'templated attributes are stepped over');
  assert.deepEqual(sourceOffenders('/* a bare <button> in a form submits */ <button data-btn="x">Go</button>'), [], 'a comment is not a button');
});

test('§1 every button a page story draws starts with a capital', async () => {
  const bad = (await storyPages()).flatMap(([name, html]) => offenders(html).map(o => `${name}: ${o}`));
  assert.deepEqual([...new Set(bad)], [],
    'a button label starts lower-case beside capitalised ones. Write it with a capital, or, if it is a link inside '
    + 'a sentence, give it the cblink / ui-button--link look');
});

test('§2 every button label written out in a page module starts with a capital', () => {
  const bad = PAGE_SOURCES().flatMap(([f, src]) => sourceOffenders(src).map(l => `${f}: ${JSON.stringify(l)}`));
  assert.deepEqual(bad, [], 'a button label in the page source starts lower-case');
});
