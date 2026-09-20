/* R255 / CT-126 — report #133: "When an effect is targeting a player, the
 * arrow covers up their life total, making it impossible to read."
 *
 * The report names the life pill; the CLASS is every endpoint that shows text
 * where the arrowhead lands. [26] aims both ends at the exact centre of their
 * boxes (ZQPC: "point to the middle of the cards"), and the head's opaque
 * triangle then occupies the band HEAD_INSET..HEAD_INSET+HEAD_SIZE back from
 * that centre. A card's middle is ART and survives it. Four destinations put
 * something legible there instead:
 *
 *   .life                 ♥ 30, centred in a 70x35 pill        (the report)
 *   .artfallback          a no-art card shows its NAME, centred
 *   .stackface            an ability has no scan, so its name IS the tile
 *   .promptbar            mostly text, end to end
 *
 * THE FIXTURES BELOW ARE MEASURED, NOT INVENTED. Every box and every text
 * rect in this file was read out of headless Chrome (CDP) against the real
 * ui/style.css and the real bundle on ?demo=1, with Range.getClientRects()
 * per text node and elementFromPoint to drop text that is painted over —
 * which is exactly how ui/anim.ts visibleTextBoxes() reads them at paint
 * time. The rects are stored relative to each element's centre, because that
 * is the only thing the geometry cares about.
 *
 * WHAT THIS FILE HOLDS DOWN, in both directions:
 *  - the head clears the text at every endpoint kind, from every direction;
 *  - the fixtures flagged `occluding` really DO collide at the old inset, so
 *    the subject set cannot quietly empty out and keep passing;
 *  - an endpoint with nothing legible in the middle — every card whose art is
 *    showing — is not moved by so much as a pixel. That is [26] itself, and
 *    the reason R255 is not "point at the edge again".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrowGeometry, borderDistance, headStop,
  HEAD_INSET, HEAD_SIZE, HEAD_HALFWIDTH, HEAD_SLACK,
} from '../anim.ts';
import type { ArrowBox } from '../anim.ts';
import type { TargetRef } from '../../engine/src/types.ts';

/* ── the measured endpoints ────────────────────────────────────────────── */

/** every shape a TargetRef can take, distributed out of the union — add a
 * variant to TargetRef and this file stops compiling until it is measured */
type TargetKind = TargetRef extends infer T ? (T extends unknown ? keyof T : never) : never;

interface Endpoint {
  what: string;
  /** the element's box, measured */
  box: ArrowBox;
  /** the text it actually shows, measured, as offsets from its centre */
  text: ArrowBox[];
  /** does the head at the old inset land on that text, from some direction?
   * asserted below rather than trusted */
  occluding: boolean;
}

const CX = 1000, CY = 700;
const boxOf = (w: number, h: number): ArrowBox => ({ left: CX - w / 2, top: CY - h / 2, width: w, height: h });
const rel = (dx: number, dy: number, w: number, h: number): ArrowBox =>
  ({ left: CX + dx, top: CY + dy, width: w, height: h });

/** a card with its scan loaded: the only text is a badge at the top and the
 * stats plate at the bottom-right, both far outside the head's band */
const CARD_WITH_ART: Endpoint = {
  what: 'a unit whose scan has loaded — badge top-left, 7/5 bottom-right',
  box: boxOf(78, 108.3),
  text: [rel(-33, -52.2, 34.1, 13), rel(14.3, 34.4, 18.7, 17)],
  occluding: false,
};

const ENDPOINTS: Record<TargetKind, Endpoint[]> = {
  unit: [
    CARD_WITH_ART,
    {
      what: 'a unit with NO scan — .artfallback centres the card NAME',
      box: boxOf(78, 108.9),
      text: [rel(-19.9, -7, 39.8, 14)],
      occluding: true,
    },
  ],
  player: [
    {
      // RE-MEASURED 2026-09-20 (twice — see below), when the life meter was
      // rebuilt: the pill was 52x24 with one 13px text node, and is now
      // 69.8x35.1 with the heart and the total as separate spans, the total
      // at 21px. Re-read out of headless Chrome rather than scaled, and that
      // paid: the first cut of the redesign put a 36px glyph box in a 34.6px
      // pill, which leaves the head nowhere to stop, so headStop fell back to
      // resting ON the number — R255's own report, reintroduced by a CSS
      // tweak, caught here from 135deg. The pill's padding is what buys the
      // room back, at any font size.
      what: 'the life pill at 30 life — the report',
      box: boxOf(69.8, 35.1),
      text: [rel(-18.9, -9.2, 7.7, 18), rel(-5.2, -14.5, 24, 28)],
      occluding: true,
    },
  ],
  stack: [
    {
      what: 'a stack item whose scan is showing — .stackface is behind the art',
      box: boxOf(81.9, 114.4),
      text: [rel(-10.4, -65.2, 22.9, 11)],
      occluding: false,
    },
    {
      what: 'a stack item with no card of its own — .stackface IS its label',
      box: boxOf(81.9, 114.4),
      text: [rel(-7.4, -7.3, 16.8, 13), rel(-34.9, 44, 36.7, 11), rel(-10.4, -65.2, 22.9, 11)],
      occluding: true,
    },
  ],
  // a cached card is drawn as a .card and targetSelectors reaches for that
  // card FIRST; the cache zone is only its fallback, and ?demo=1 had no
  // cached cards to measure one from
  cached: [CARD_WITH_ART],
  bin: [
    {
      what: 'an empty bin whose label ends 7px above the middle',
      box: boxOf(96, 95.4),
      text: [rel(-39, -39.7, 41.2, 15), rel(-39, -22.3, 32.8, 15)],
      occluding: true,
    },
    {
      what: 'the same bin in a taller region — the label clears the band',
      box: boxOf(96, 137.7),
      text: [rel(-39, -60.9, 41.2, 15), rel(-39, -43.5, 32.8, 15)],
      occluding: false,
    },
  ],
  formation: [
    {
      what: 'a region row — its nearest text is a badge 380px out',
      box: boxOf(947, 108.3),
      text: [rel(-383.5, -52.2, 30.9, 13)],
      occluding: false,
    },
  ],
};

/** not a TargetRef, but pendingAimArrows aims at it: the prompt bar, two
 * lines of prose plus a row of option buttons */
const PROMPT_BAR: Endpoint = {
  what: 'the prompt bar as an arrow destination',
  box: boxOf(1071, 78.4),
  text: [
    rel(-522.5, -30.2, 55.5, 18), rel(-455, -30.2, 556.2, 18),
    rel(-509.5, 6, 143.3, 18), rel(-334.2, 6, 199, 18), rel(-103.2, 6, 166.5, 18),
    rel(95.3, 6, 144.9, 18), rel(272.2, 6, 48.7, 18), rel(352.9, 6, 48.7, 18),
  ],
  occluding: true,
};

const ALL: Endpoint[] = [...Object.values(ENDPOINTS).flat(), PROMPT_BAR];

/* ── the oracle: does the painted triangle sit on a glyph? ─────────────── */

type Pt = [number, number];

/** the head exactly as draw() builds it: tip `inset` back from the centre
 * along -u, base HEAD_SIZE further back and HEAD_HALFWIDTH to either side */
function headTriangle(inset: number, ux: number, uy: number): [Pt, Pt, Pt] {
  const tx = CX - ux * inset, ty = CY - uy * inset;
  const bx = tx - ux * HEAD_SIZE, by = ty - uy * HEAD_SIZE;
  return [[tx, ty],
    [bx - uy * HEAD_HALFWIDTH, by + ux * HEAD_HALFWIDTH],
    [bx + uy * HEAD_HALFWIDTH, by - ux * HEAD_HALFWIDTH]];
}

/** sampled, deliberately NOT the slab arithmetic headStop uses — a second
 * method, so a bug in the first one cannot certify itself */
function coversText(inset: number, ux: number, uy: number, text: readonly ArrowBox[]): boolean {
  const [p0, p1, p2] = headTriangle(inset, ux, uy);
  const N = 24;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N - i; j++) {
    const a = i / N, b = j / N, c = 1 - a - b;
    const x = a * p0[0] + b * p1[0] + c * p2[0];
    const y = a * p0[1] + b * p1[1] + c * p2[1];
    for (const r of text) {
      if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) return true;
    }
  }
  return false;
}

/** 16 approach directions — twice as many as the browser sweep, because a
 * bowed arrow can arrive from anywhere */
const DIRS: [number, number][] = Array.from({ length: 16 }, (_, k) => {
  const a = k * Math.PI / 8;
  return [Math.cos(a), Math.sin(a)] as [number, number];
});

/* ── the guards ────────────────────────────────────────────────────────── */

test('[R255] the fixtures are the bug: at the old inset the head sits on their text', () => {
  // THE POSITIVE CONTROL. Every assertion below is about arrowheads that no
  // longer cover text; a fixture table that had quietly stopped occluding
  // anything would satisfy all of them and prove nothing. So first: the ones
  // marked `occluding` really do collide, and the ones marked clear really do
  // not, at the inset the client shipped with.
  for (const e of ALL) {
    const hit = DIRS.some(([ux, uy]) => coversText(HEAD_INSET, ux, uy, e.text));
    assert.equal(hit, e.occluding, `${e.what}: measured occlusion at HEAD_INSET`);
  }
  const occluding = ALL.filter(e => e.occluding);
  assert.ok(occluding.length >= 4,
    'at least four measured endpoints are occluded — the report is a class, not one pill');
  for (const kind of ['player', 'unit', 'stack', 'bin'] as const) {
    assert.ok(ENDPOINTS[kind].some(e => e.occluding),
      `${kind} is one of the kinds that buries its own text under the head`);
  }
});

test('[R255] every measured endpoint has an arrowhead that clears its text', () => {
  for (const e of ALL) {
    for (const [ux, uy] of DIRS) {
      const inset = headStop(e.box, e.text, ux, uy);
      assert.ok(!coversText(inset, ux, uy, e.text),
        `${e.what}: head still covers text coming in at ${Math.round(Math.atan2(uy, ux) * 180 / Math.PI)}deg (inset ${inset})`);
      assert.ok(inset >= HEAD_INSET, `${e.what}: the head never moves FORWARD of HEAD_INSET`);
    }
  }
});

test('[R255] an endpoint with nothing legible in the middle is not moved at all', () => {
  // [26] is intact where it was asked for: ZQPC wanted the head on the middle
  // of a CARD, and a card whose scan is showing keeps exactly that.
  const untouched = ALL.filter(e => !e.occluding);
  assert.ok(untouched.length >= 4, 'there are endpoints in this table that must not move');
  for (const e of untouched) {
    for (const [ux, uy] of DIRS) {
      assert.equal(headStop(e.box, e.text, ux, uy), HEAD_INSET,
        `${e.what}: nothing to clear, so the head sits where [26] put it`);
    }
  }
  // and an endpoint with no text at all short-circuits to the same place
  assert.equal(headStop(boxOf(78, 108), [], 1, 0), HEAD_INSET);
});

test('[R255] the head stops just short of the label, never far from the thing it points at', () => {
  for (const e of ALL) {
    for (const [ux, uy] of DIRS) {
      const inset = headStop(e.box, e.text, ux, uy);
      assert.ok(inset <= borderDistance(e.box, ux, uy) + HEAD_SLACK,
        `${e.what}: the tip stays on (or within ${HEAD_SLACK}px of) the element it is aimed at`);
    }
  }
  // the life pill is the tightest case in the game: its 21px total is a 29px
  // glyph box in a 35.1px pill, so from straight above there is no inset
  // INSIDE the element that clears the digits — the top of the text is 14.5px
  // up and half the pill is 17.6px, and the head needs HEAD_SIZE behind its
  // tip. So the tip has to leave the pill, and HEAD_SLACK is what says how
  // far it may go and still be unmistakably pointing at it.
  const pill = ENDPOINTS.player[0]!;
  const fromAbove = headStop(pill.box, pill.text, 0, 1);
  assert.ok(fromAbove > pill.box.height / 2, 'it had to leave the pill to clear the number');
  assert.ok(fromAbove < pill.box.height / 2 + HEAD_SLACK, 'and it stopped as soon as it had');
});

test('[R255] a label too big to clear keeps the old inset rather than parking outside', () => {
  // the fallback matters: an endpoint plastered edge to edge in text has no
  // clear spot, and an arrow that stops 200px short of it is worse than one
  // resting on a word. Pointing at the right thing wins.
  const smothered: ArrowBox[] = [rel(-400, -12, 800, 24)];
  const box = boxOf(60, 84);
  assert.equal(headStop(box, smothered, 1, 0), HEAD_INSET);
});

test('[R255] arrowGeometry keeps aiming at the exact centre, and reports its own inset', () => {
  const a: ArrowBox = { left: 100, top: 100, width: 60, height: 84 };
  const pill = ENDPOINTS.player[0]!;
  const plain = arrowGeometry(a, pill.box)!;
  assert.deepEqual([plain.x2, plain.y2], [CX, CY], 'the aim is the destination centre — [26], untouched');
  assert.equal(plain.inset, HEAD_INSET, 'and with no text passed in, nothing changes at all');

  const aware = arrowGeometry(a, pill.box, pill.text)!;
  assert.deepEqual([aware.x2, aware.y2], [plain.x2, plain.y2], 'R255 moves the head, never the aim');
  assert.ok(aware.inset > plain.inset, 'the head backed off the life total');
  assert.equal(Math.round(Math.hypot(aware.x2 - aware.tx, aware.y2 - aware.ty) * 100) / 100,
    Math.round(aware.inset * 100) / 100, 'the tip really is `inset` short of the centre');
  assert.ok(!coversText(aware.inset, aware.ux, aware.uy, pill.text), 'and the life total is readable');
});
