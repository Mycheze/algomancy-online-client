/* 1482 · BL-77: EVERY CARD A PAGE DRAWS ZOOMS THE SAME WAY
 *
 * The owner: "The 'middle click to zoom in' on a card should work in ALL pages
 * that have cards! … We should make it a codified action to 'zoom in' on a
 * card." The action is ui/presszoom.ts: a middle press shows the big zoom at
 * once, a held left button or a held finger after a beat, on any element that
 * wears `data-zoom` and has the card's scan inside. The client installs it at
 * boot, so the attribute is the whole contract.
 *
 *   §0  non-vacuity: the stories are reached, they draw card scans, and the
 *       detector tells a marked scan from an unmarked one
 *   §1  every card scan any page or component story draws sits inside (or is)
 *       a `data-zoom` element, or a board card the hover zoom and the finger's
 *       peek already read — the home's art crops are the one exception
 *   §2  the client installs the gesture at boot, not only on the pages that
 *       first asked for it
 *   §3  a card drawn as a whole button (a ladder row, a deck's cover) still
 *       zooms; a control inside a card tile does not
 *   §4  a thumbnail cropped to a square or a banner grows out of a card-shaped
 *       box inside it, so it zooms as the whole card and at the card's size
 *   §5  a finger held on a card owns its long press (no Android context menu);
 *       a mouse's does not
 *   §6  every card a lesson page draws (Learn to Play, no story reaches them)
 *       zooms too
 *
 * The suites cannot press a real mouse or finger (test 322's header): no
 * browser on the home box looked at it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STORYBOOK_STORIES_DIR, UI_DIR } from '../../engine/scripts/paths.mjs';
import { pressGesture, type PressEvent, type PressIO } from '../presszoom.ts';
import { cardInScan } from '../zoom.ts';
import '../../engine/src/index.ts';
import { pageHtml } from '../lessonlayer.ts';
import { ALL_LESSONS, GAME_LESSONS } from '../lessons.ts';

/** decorative crops of a card's art, not a card to read: the home's backdrop and its Play tiles */
const DECOR = /\bhome(?:art|modeart|sideart|backdrop)\b/;
/** a board card: the hover zoom and the finger's peek read it (ui/zoom.ts CARDISH) */
const BOARD_CARD = /\bclass="(?:[^"]*\s)?(?:card|rescard|stackcard)(?:\s[^"]*)?"/;
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'wbr', 'area', 'col', 'embed', 'track']);
const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

/** the opening tag of every card scan in `html` that nothing around it lets a player zoom */
export function unzoomable(html: string): string[] {
  const out: string[] = [];
  const stack: Array<{ name: string; ok: boolean }> = [];
  for (const m of html.matchAll(TAG)) {
    const [, close, rawName, attrs = ''] = m;
    const name = rawName!.toLowerCase();
    if (close) {
      const at = stack.map(s => s.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
      continue;
    }
    const ok = /\sdata-zoom(?=[\s=>]|$)/.test(attrs) || BOARD_CARD.test(attrs) || DECOR.test(attrs);
    if (name === 'img') {
      if (/\bsrc="[^"]*data\/cards\//.test(attrs) && !ok && !stack.some(s => s.ok)) out.push(`<img${attrs.replace(/\s+/g, ' ').slice(0, 110)}>`);
      continue;
    }
    if (VOID.has(name) || attrs.trimEnd().endsWith('/')) continue;
    stack.push({ name, ok });
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

const SCAN = '<img src="../../data/cards/Ignis-Sprite.jpg" alt="">';

test('BL-77 §0 non-vacuity: the stories draw card scans and the detector tells them apart', async () => {
  const all = await stories();
  assert.ok(all.length >= 150, `only ${all.length} stories rendered`);
  const scans = all.reduce((n, [, h]) => n + (h.match(/<img\b[^>]*data\/cards\//g)?.length ?? 0), 0);
  assert.ok(scans >= 200, `the stories draw only ${scans} card scans`);
  const pages = new Set(all.filter(([, h]) => /<img\b[^>]*data\/cards\//.test(h)).map(([n]) => n.split(' ')[0]));
  for (const p of ['cards.stories.ts', 'meta.stories.ts', 'cardstats.stories.ts', 'decks.stories.ts', 'profile.stories.ts'])
    assert.ok(pages.has(p), `${p} draws a card scan in some story`);
  assert.equal(unzoomable(`<div class="tile">${SCAN}</div>`).length, 1, 'a bare scan');
  assert.equal(unzoomable(`<div class="tile" data-zoom><span>${SCAN}</span></div>`).length, 0, 'inside a data-zoom tile');
  assert.equal(unzoomable(`<div data-zoom></div><div>${SCAN}</div>`).length, 1, 'a closed data-zoom sibling does not count');
  assert.equal(unzoomable(`<span data-zoomclear>${SCAN}</span>`).length, 1, 'data-zoomclear is not data-zoom');
  assert.equal(unzoomable(`<div class="card unit">${SCAN}</div>`).length, 0, 'a board card');
  assert.equal(unzoomable('<img src="/data/icons/fire.webp" alt="">').length, 0, 'an icon is not a card');
});

test('BL-77 #404 §1 every card scan a page or component story draws can be zoomed', async () => {
  const bad = (await stories()).flatMap(([name, html]) => unzoomable(html).map(c => `${name}: ${c}`));
  assert.deepEqual([...new Set(bad)], [],
    'a card drawn here has no zoom: put `data-zoom` on the element that holds its scan (ui/presszoom.ts)');
});

const code = (f: string): string => readFileSync(join(UI_DIR, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('BL-77 §2 the client installs the press zoom at boot, for every page', () => {
  assert.match(code('main.ts'), /^installPressZoom\(\);$/m, 'main.ts calls installPressZoom() at the top level');
});

/** a stub element: `chain` is its ancestors, nearest first, by the selector each answers */
function el(chain: Array<{ is: string; zoom?: boolean }>): Element {
  const made = new Map<number, Element>();
  const at = (k: number): Element => made.get(k) ?? made.set(k, {
    closest(sel: string) {
      for (let i = k; i < chain.length; i++) {
        const n = chain[i]!;
        if (sel === '[data-zoom]' ? n.zoom : sel.split(/,\s*/).includes(n.is)) return at(i);
      }
      return null;
    },
    contains(o: Element) { return (o as unknown as { depth: number }).depth <= k; },
    depth: k,
    isConnected: true,
  } as unknown as Element).get(k)!;
  return at(0);
}

function harness(): { io: PressIO; shown: Element[] } {
  const shown: Element[] = [];
  const io: PressIO = {
    target: e => e?.closest('[data-zoom]') ?? null,
    under: () => null,
    show: e => { shown.push(e); return true; },
    showing: () => shown.length > 0,
    end: () => {},
    swallow: () => {},
    dragging: () => false,
    later: () => 0,
    cancel: () => {},
  };
  return { io, shown };
}

const middle = (target: Element): PressEvent => ({
  pointerId: 1, pointerType: 'mouse', button: 1, buttons: 4, isPrimary: true, clientX: 0, clientY: 0,
  target, preventDefault() {},
});

test('BL-77 §3 a card drawn as a button zooms; a control inside a card tile does not', () => {
  const rowCover = harness();
  // <button class="metarow"><span class="metacover" data-zoom><img></span></button>
  pressGesture(rowCover.io).down(middle(el([{ is: 'img' }, { is: 'span', zoom: true }, { is: 'button' }])));
  assert.equal(rowCover.shown.length, 1, 'a scan inside a row button zooms');
  const wholeButton = harness();
  pressGesture(wholeButton.io).down(middle(el([{ is: 'img' }, { is: 'button', zoom: true }])));
  assert.equal(wholeButton.shown.length, 1, 'a button that is the card zooms');
  const plus = harness();
  // <div class="ttpooltile" data-zoom><button>+</button><img></div>
  pressGesture(plus.io).down(middle(el([{ is: 'button' }, { is: 'div', zoom: true }])));
  assert.equal(plus.shown.length, 0, 'a tile\'s own + button is a button, not the card');
});

test('BL-77 §4 a cropped thumbnail zooms from a card-shaped box inside it', () => {
  // a 46×46 cover of a 720×1000 scan: the card is 33.12 wide, centred
  const sq = cardInScan({ left: 100, top: 200, width: 46, height: 46 }, 720, 1000);
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
  assert.ok(near(sq.width, 33.12) && near(sq.height, 46) && near(sq.left, 106.44) && near(sq.top, 200), JSON.stringify(sq));
  // a 400×116 banner: as tall as the banner, not as wide
  const ban = cardInScan({ left: 0, top: 0, width: 400, height: 116 }, 720, 1000);
  assert.ok(near(ban.width, 83.52) && near(ban.height, 116), JSON.stringify(ban));
  const whole = { left: 5, top: 5, width: 72, height: 100 };
  assert.deepEqual(cardInScan(whole, 720, 1000), whole, 'an uncropped scan is its own box');
  assert.deepEqual(cardInScan(whole, 0, 0), whole, 'not loaded yet: the drawn box');
});

test('BL-77 §5 a finger held on a card owns its long press; a mouse does not', () => {
  const finger = harness();
  const g = pressGesture(finger.io);
  const card = el([{ is: 'img' }, { is: 'div', zoom: true }]);
  g.down({ ...middle(card), pointerType: 'touch', button: 0, buttons: 1 });
  assert.equal(g.fingerDown(), true, 'held: the context menu is cancelled');
  g.up({ ...middle(card), pointerType: 'touch', button: 0, buttons: 0 });
  assert.equal(g.fingerDown(), false, 'lifted: the page has its menu back');
  g.down({ ...middle(card), button: 0, buttons: 1 });
  assert.equal(g.fingerDown(), false, 'a mouse press leaves the right button alone');
  assert.match(code('presszoom.ts'), /addEventListener\('contextmenu', e => \{ if \(g\.fingerDown\(\)\) \{ e\.preventDefault\(\);/,
    'the installed gesture cancels the menu while a finger is down');
});

test('BL-77 §6 every card a lesson page draws can be zoomed', () => {
  const pages = [...ALL_LESSONS, ...GAME_LESSONS].flatMap(l => l.pages.map((p, i) => [`${l.id ?? l.title} p${i + 1}`, pageHtml(p, null)] as const));
  const scans = pages.reduce((n, [, h]) => n + (h.match(/<img\b[^>]*data\/cards\//g)?.length ?? 0), 0);
  assert.ok(scans >= 20, `the lessons draw only ${scans} card scans`);
  const bad = pages.flatMap(([name, html]) => unzoomable(html).map(c => `${name}: ${c}`));
  assert.deepEqual([...new Set(bad)], [], 'a lesson figure\'s card has no zoom');
});
