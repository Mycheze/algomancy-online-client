/* 1376 — EVERY PAGE IN THE FRAME KEEPS ITS PICTURES THROUGH A REPAINT (owner, 2026-11-14: "Fix the
 * painter entirely"): pages/frame.ts paintFrame, driven with real page markup into a stand-in #app
 * whose innerHTML setter makes a new element for every <img> in the markup, as a browser does.
 *
 * §1 a repaint of the same page leaves every picture the element it was (the deck shelf, 5 + 1)
 * §2 a choice that changes one picture (another deck's banner) makes that one new, and only it
 * §3 the scroll regions are still put back after the pictures (paintFrame's other job)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameHtml, paintFrame, type FrameChrome } from '../pages/frame.ts';

type Img = { outerHTML: string; id: number; replaceWith(n: Img): void };
type Region = { scrollTop: number; scrollLeft: number; dataset: Record<string, string> };

function appOf() {
  let made = 0;
  let html = '';
  const a = {
    imgs: [] as Img[],
    region: { scrollTop: 0, scrollLeft: 0, dataset: { scroll: 'shelf' } } as Region,
    classList: { remove() {} },
    get innerHTML() { return html; },
    set innerHTML(v: string) {
      html = v;
      a.region = { scrollTop: 0, scrollLeft: 0, dataset: { scroll: 'shelf' } };   // a new region, at its top
      a.imgs = [...v.matchAll(/<img\b[^>]*>/g)].map(m => {
        const me: Img = { outerHTML: m[0], id: ++made, replaceWith(n: Img) { a.imgs[a.imgs.indexOf(me)] = n; } };
        return me;
      });
    },
    querySelectorAll(sel: string) {
      if (sel === 'img') return a.imgs;
      if (sel === '[data-scroll]') return html.includes('data-scroll="shelf"') ? [a.region] : [];
      return [];
    },
    querySelector(sel: string) { return sel === '[data-scroll="shelf"]' ? a.region : null; },
  };
  return a;
}

const CHROME: FrameChrome = { signedIn: true, alerts: 0 };
const pic = (src: string): string => `<img src="${src}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
/** a shelf: five deck boxes and the chosen deck's banner */
const shelf = (banner: string): string => frameHtml({ page: 'deckspage', title: 'Decks', back: { dataBtn: 'deck-close', label: 'Home' },
  chrome: CHROME, mainHtml: `<div class="dkshelf" data-scroll="shelf">${['a', 'b', 'c', 'd', 'e'].map(n => pic(`/art/${n}.jpg`)).join('')}</div>`
    + `<div class="dkprevbanner">${pic(banner)}</div>` });

test('1376 §1 a repaint of the same page leaves every picture the element it was', () => {
  const app = appOf();
  paintFrame(app as unknown as HTMLElement, shelf('/art/a.jpg'));
  assert.equal(app.imgs.length, 6, 'non-vacuous: the page has its pictures');
  const first = app.imgs.map(i => i.id);
  paintFrame(app as unknown as HTMLElement, shelf('/art/a.jpg'));
  assert.deepEqual(app.imgs.map(i => i.id), first, 'replaced 0 of 6');
});

test('1376 §2 a choice that changes one picture makes that one new, and only it', () => {
  const app = appOf();
  paintFrame(app as unknown as HTMLElement, shelf('/art/a.jpg'));
  const first = app.imgs.map(i => i.id);
  paintFrame(app as unknown as HTMLElement, shelf('/art/x.jpg'));
  assert.deepEqual(app.imgs.slice(0, 5).map(i => i.id), first.slice(0, 5), 'the five boxes are kept');
  assert.ok(app.imgs[5]!.id > Math.max(...first), 'the new banner is a new element');
});

test('1376 §3 the scroll regions are still put back', () => {
  const app = appOf();
  paintFrame(app as unknown as HTMLElement, shelf('/art/a.jpg'));
  app.region.scrollTop = 240;
  paintFrame(app as unknown as HTMLElement, shelf('/art/a.jpg'));
  assert.equal(app.region.scrollTop, 240);
});
