/* REPORT #315 (owner, room EMNR, 2026-11-01): "many elements are overlapping
 * with the border of their section by a pixel or two, cutting off the very
 * edge and it looks a bit strange."
 *
 * Measured in headless Chrome on slices of EMNR (both seats, every 5th
 * action, 1367x911 — the owner's window): a card's ring is painted OUTSIDE
 * its box (an outline, or a 0-blur box-shadow), and the zones that hold the
 * cards clip at their own edge, with the first card flush against it. So the
 * ring lost the side that touched the edge:
 *
 *   - In Play (`.lplay .regionmain .zone`, overflow hidden): a playable or
 *     activatable unit's green ring cut on its top and left, 2px
 *   - the hand (`.handdock .zone`, a scroller): every playable card's ring
 *     cut along the top, the first card's along its left too, 2px
 *   - the resources (`.linfo .lres`, overflow clip): the first card's 1px
 *     hairline edge gone on the left on every board; a dormant card you can
 *     wake (outline 2px + offset 1px) lost 3px of its ring
 *
 * The fix gives each zone room for the widest hard ring without moving a
 * card: `overflow-clip-margin` where the zone only clips, and an inset paid
 * back by a negative margin in the hand, which scrolls (a scroller clips at
 * its padding box; the clip margin does not apply to it).
 *
 * SOURCE-LEVEL, on purpose: test/ui-driver.ts paints with no layout — no box
 * has a size — and the defect is a property of the sheet (how far a ring
 * reaches past a card versus how far its zone lets it paint). The widest ring
 * is DERIVED from the sheet's own ring rules, so a thicker ring added later
 * reddens this until its zone has room for it too. Blurred glows (the
 * activatable pulse, the ping highlight's halo) fade out and are not counted:
 * the hard edge is what read as "cut off".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** every rule at the top level of the sheet (not inside an @-block), in order */
function topRules(): Array<{ sels: string[]; body: string }> {
  const out: Array<{ sels: string[]; body: string }> = [];
  let depth = 0, start = 0;
  for (let i = 0; i < CSS.length; i++) {
    const c = CSS[i];
    if (c === '{') {
      if (depth === 0) {
        const head = CSS.slice(start, i).trim();
        const end = CSS.indexOf('}', i);
        if (!head.startsWith('@') && CSS.slice(i + 1, end).indexOf('{') < 0) {
          out.push({ sels: head.split(',').map(s => s.trim()), body: CSS.slice(i + 1, end) });
          i = end; start = i + 1; continue;
        }
      }
      depth++;
    } else if (c === '}') { depth--; start = i + 1; }
  }
  return out;
}
const RULES = topRules();

const px = (v: string | undefined): number => (v ? parseFloat(v) || 0 : 0);
const decl = (body: string, prop: string): string | undefined => {
  let last: string | undefined;
  for (const m of body.matchAll(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`, 'g'))) last = m[1]!.trim();
  return last;
};
/** how far a rule's hard ring reaches past the box: an outline (width +
 * offset) or a 0-blur, non-inset box-shadow (offset + spread) */
function ringOf(body: string): number {
  let r = 0;
  const ol = decl(body, 'outline');
  const olw = decl(body, 'outline-width') ?? (ol && ol !== 'none' ? ol.split(/\s+/).find(t => /^\d/.test(t)) : undefined);
  if (olw) r = Math.max(r, px(olw) + px(decl(body, 'outline-offset')));
  const bs = decl(body, 'box-shadow');
  if (bs && bs !== 'none') {
    for (const sh of bs.split(/,(?![^(]*\))/)) {
      if (/inset/.test(sh)) continue;
      const n = sh.replace(/(rgba?|color-mix|var)\([^)]*\)/g, '').trim().split(/\s+/).filter(t => /^-?[\d.]/.test(t)).map(px);
      const [x = 0, y = 0, blur = 0, spread = 0] = n;
      if (blur === 0) r = Math.max(r, Math.max(Math.abs(x), Math.abs(y)) + spread);
    }
  }
  return r;
}
/** the widest ring among the rules any selector of which `match`es */
const widest = (match: (sel: string) => boolean): { ring: number; from: string } => {
  let best = { ring: 0, from: '' };
  for (const r of RULES) {
    const s = r.sels.find(match);
    if (!s) continue;
    const ring = ringOf(r.body);
    if (ring > best.ring) best = { ring, from: s };
  }
  return best;
};
/** the merged declarations of every top-level rule with exactly this selector */
const bodyOf = (sel: string): string => {
  const b = RULES.filter(r => r.sels.includes(sel)).map(r => r.body).join(';');
  assert.ok(b, `no rule for ${sel}`);
  return b;
};

/** a ring every card wears wherever it is: `.card.playable`, `.card[data-bintgt]`… */
const CARD = widest(s => /^\.card(?:\.[\w-]+|\[[^\]]+\])+$/.test(s));
/** a resource card's ring, or its scan's edge, in the info line */
const RES = widest(s => /^(?:\.linfo [^,]*)?\.rescard(?:\.[\w-]+|:not\([^)]*\))*(?: img)?$/.test(s));

test('the widest rings are read off the sheet (sanity: the ones measured on EMNR)', () => {
  assert.ok(CARD.ring >= 3, `a card's ring: ${CARD.ring}px from ${CARD.from}`);
  assert.ok(RES.ring >= 3, `a resource's ring: ${RES.ring}px from ${RES.from}`);
});

/** a zone that only clips must let `ring` px paint past its edge */
function roomOf(sel: string, ring: number, what: string): void {
  const b = bodyOf(sel);
  assert.equal(decl(b, 'overflow'), 'clip', `${sel}: overflow-clip-margin works only with overflow: clip`);
  const m = px(decl(b, 'overflow-clip-margin'));
  assert.ok(m >= ring, `${sel} clips ${what} ${ring - m}px inside its ring (clip margin ${m}px, ring ${ring}px)`);
}

test('In Play: a unit flush against the zone keeps its whole ring', () => {
  roomOf('.lplay .regionmain .zone', CARD.ring, `a unit's ${CARD.from} ring`);
});

test('the resources: the first card keeps its edge and its wake ring', () => {
  roomOf('.linfo .lres', RES.ring, `a resource's ${RES.from} ring`);
});

test('the hand: the dock\'s scroller is inset by the ring, and no card moves', () => {
  const sel = '#app.board.v2 .handdock:not(.tucked) > .zone';
  const b = bodyOf(sel);
  const pad = (decl(b, 'padding') ?? '').split(/\s+/).map(px);
  const mar = (decl(b, 'margin') ?? '').split(/\s+/).map(px);
  assert.equal(pad.length, 4, `${sel}: padding as four sides`);
  assert.equal(mar.length, 4, `${sel}: margin as four sides`);
  const [pt, pr, pb, pl] = pad as [number, number, number, number];
  const [mt, mr, , ml] = mar as [number, number, number, number];
  for (const [side, p] of [['top', pt], ['right', pr], ['left', pl]] as const) {
    assert.ok(p >= CARD.ring, `the hand's scroller clips a card's ${CARD.from} ring on the ${side}: inset ${p}px, ring ${CARD.ring}px`);
  }
  // the cards stand where they stood: the inset is paid back by the margin
  const zoneTop = px(decl(bodyOf('.zone'), 'margin-top'));
  assert.equal(mt + pt, zoneTop, 'the first row of the hand does not move down');
  assert.equal(ml, -pl, 'the hand does not move right');
  assert.equal(mr, -pr, 'the hand keeps its width');
  assert.equal(pb, px(decl(bodyOf('.handdock .zone'), 'padding-bottom')), 'the room under the cards (the scrollbar\'s) is as it was');
  // an empty hand keeps the dock one card tall, as before: the inset rides on top
  const mh = decl(bodyOf('#app.board.v2 .handdock:not(.tucked) > .zone'), 'min-height') ?? '';
  assert.ok(mh.includes(`${pt}px`), `the one-card floor counts the ${pt}px inset: ${mh}`);
});
