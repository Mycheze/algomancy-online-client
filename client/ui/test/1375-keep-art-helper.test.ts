/* 1375 — THE PICTURES SURVIVE A REPAINT: the one helper (owner, 2026-11-14: "clicking something to
 * swap it or make a choice makes all the images on the screen flash for a frame and it's jarring";
 * "Fix the painter entirely"). pages/frame.ts keepArt(root, paint, sel), DOM-free.
 *
 * §1 after the paint, every new <img> whose markup is exactly an old one's is swapped for the old
 *    element — twins (three copies of one card) pair up in order, one old element each
 * §2 a picture whose markup changed (another card, a src, an onerror that hid it) is the new element
 * §3 a picture the paint did not touch (a patch of one region) stays where it is and is nobody's twin
 * §4 `sel` picks the pictures on both sides: one region's pictures inside its parent
 * §5 nothing before the paint: the paint runs and nothing is read back
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepArt } from '../pages/frame.ts';

/** a stand-in root: an ordered list of pictures, each with its markup and a region it sits in */
type Img = { outerHTML: string; id: number; region: string; replaceWith(n: Img): void };
function rootOf() {
  let made = 0;
  const r = {
    imgs: [] as Img[],
    reads: [] as string[],
    img(src: string, region = 'main', extra = ''): Img {
      const me: Img = { outerHTML: `<img src="${src}" alt="" loading="lazy"${extra}>`, id: ++made, region,
        replaceWith(n: Img) { const i = r.imgs.indexOf(me); assert.ok(i >= 0, 'only a picture on the page is swapped'); n.region = me.region; r.imgs[i] = n; } };
      return me;
    },
    /** a paint of these pictures into `region` (the others are left as they are) */
    paintOf(srcs: string[], region = 'main') {
      return (): void => { r.imgs = [...r.imgs.filter(i => i.region !== region), ...srcs.map(s => r.img(s, region))]; };
    },
    querySelectorAll(sel: string) {
      r.reads.push(sel);
      const m = /^\.(\w+) img$/.exec(sel);
      return (m ? r.imgs.filter(i => i.region === m[1]) : r.imgs) as unknown as NodeListOf<Element>;
    },
  };
  return r;
}

test('1375 §1 an unchanged repaint leaves every picture the element it was — twins included', () => {
  const r = rootOf();
  r.paintOf(['a.jpg', 'b.jpg', 'b.jpg', 'b.jpg', 'c.jpg'])();
  const first = r.imgs.map(i => i.id);
  keepArt(r, r.paintOf(['a.jpg', 'b.jpg', 'b.jpg', 'b.jpg', 'c.jpg']));
  assert.deepEqual(r.imgs.map(i => i.id), first);
  // a reorder (a sort) keeps them too: same picture, wherever it now sits
  keepArt(r, r.paintOf(['c.jpg', 'b.jpg', 'a.jpg', 'b.jpg', 'b.jpg']));
  assert.deepEqual(r.imgs.map(i => i.id), [first[4], first[1], first[0], first[2], first[3]]);
});

test('1375 §2 a picture whose markup changed is the new element, and only that one', () => {
  const r = rootOf();
  r.paintOf(['a.jpg', 'b.jpg', 'c.jpg'])();
  const first = r.imgs.map(i => i.id);
  keepArt(r, r.paintOf(['a.jpg', 'x.jpg', 'c.jpg']));
  assert.ok(r.imgs[1]!.id > Math.max(...first), 'another card: a new element');
  assert.deepEqual([r.imgs[0]!.id, r.imgs[2]!.id], [first[0], first[2]]);
  // an onerror that hid the old one wrote its attribute: that old element is never put back
  const hidden = r.imgs[0]!;
  hidden.outerHTML = hidden.outerHTML.replace('>', ' style="visibility: hidden;">');
  keepArt(r, r.paintOf(['a.jpg', 'x.jpg', 'c.jpg']));
  assert.notEqual(r.imgs[0]!.id, hidden.id, 'markup changed since: not the same picture');
  // one copy fewer: the first twins are kept, the extra old one is simply gone
  r.paintOf(['b.jpg', 'b.jpg'])();
  const twins = r.imgs.map(i => i.id);
  keepArt(r, r.paintOf(['b.jpg']));
  assert.deepEqual(r.imgs.map(i => i.id), [twins[0]]);
});

test('1375 §3 a picture the paint did not touch stays put and is nobody\'s twin', () => {
  const r = rootOf();
  r.imgs = [r.img('a.jpg', 'top'), r.img('a.jpg', 'band'), r.img('b.jpg', 'band')];
  const [top, a, b] = r.imgs.map(i => i.id);
  // the band is repainted (an outerHTML patch); the strip above it is not
  keepArt(r, r.paintOf(['a.jpg', 'b.jpg'], 'band'));
  assert.deepEqual(r.imgs.map(i => [i.region, i.id]), [['top', top], ['band', a], ['band', b]],
    'the band\'s a.jpg is the band\'s old element, not the untouched one above it');
  // the band draws a picture it did not have, which the untouched strip below it has: the strip keeps its own
  r.imgs = [r.img('b.jpg', 'band'), r.img('a.jpg', 'foot')];
  const foot = r.imgs[1]!.id;
  keepArt(r, () => { r.imgs = [r.img('a.jpg', 'band'), r.imgs[1]!]; });
  assert.equal(r.imgs[1]!.id, foot, 'the strip\'s picture is still in the strip');
  assert.ok(r.imgs[0]!.id > foot, 'and the band\'s new picture is a new element');
});

test('1375 §4 sel picks one region\'s pictures on both sides of the paint', () => {
  const r = rootOf();
  r.imgs = [r.img('a.jpg', 'side'), r.img('a.jpg', 'cdpack')];
  const [side, band] = r.imgs.map(i => i.id);
  keepArt(r, r.paintOf(['a.jpg'], 'cdpack'), '.cdpack img');
  assert.deepEqual(r.reads, ['.cdpack img', '.cdpack img']);
  assert.deepEqual(r.imgs.map(i => i.id), [side, band]);
});

test('1375 §5 no pictures before the paint: it paints and reads nothing back', () => {
  const r = rootOf();
  let painted = 0;
  keepArt(r, () => { painted++; r.paintOf(['a.jpg'])(); });
  assert.equal(painted, 1);
  assert.deepEqual(r.reads, ['img'], 'one read, before the paint');
  // a root with no querySelectorAll (a test's stand-in #app) still paints
  keepArt({} as Pick<ParentNode, 'querySelectorAll'>, () => { painted++; });
  assert.equal(painted, 2);
});
