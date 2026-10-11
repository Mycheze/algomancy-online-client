/* Report #202 (HPTR, owner, 2026-10-10): "The dice and counters on units,
 * which are slightly skewed, actually still get their corners cut off. I think
 * their visual space is just a straightly aligned square."
 *
 * Right. The card zoom unfolds a unit's chips as tumbled dice inside
 * `#cardzoom .zoomdice`, a straight box with `overflow: hidden` (a long list
 * has to stop above the type line). A chip rotated by a degree or two reaches
 * past its own rectangle, and its drop shadow reaches further, so every chip on
 * the box's edge lost its corners and the bottom row lost its shadow.
 *
 * The fix pads the box by that reach and grows it outward by the same amount.
 * This file derives the reach from ui/style.css's OWN numbers — every tilt the
 * dice rules set, the outer shadow, the chip sizes — so a steeper tumble or a
 * longer shadow re-checks itself rather than trusting a constant written down
 * here. It cannot see a browser; the numbers it reads are the ones the browser
 * lays out (checked over CDP against the zoom on ?demo=1 when it was written).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

/** the body of the rule whose selector list is exactly `sel` */
const rule = (sel: string): string => {
  const at = css.indexOf(`${sel} {`);
  assert.ok(at >= 0, `style.css has no rule ${sel}`);
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
};
const prop = (body: string, name: string): string => {
  const m = new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*([^;]+);`).exec(body);
  assert.ok(m, `no ${name} in ${body}`);
  return m[1]!.trim();
};
const cqw = (v: string): number => {
  if (v === '0') return 0;
  const m = /^(-?[\d.]+)cqw$/.exec(v);
  assert.ok(m, `expected a cqw length, got ${v}`);
  return Number(m[1]);
};
/** CSS padding shorthand → [top, right, bottom, left] */
const box4 = (v: string): [number, number, number, number] => {
  const p = v.split(/\s+/).map(cqw);
  const t = p[0] ?? 0, r = p[1] ?? t, b = p[2] ?? t, l = p[3] ?? r;
  return [t, r, b, l];
};

const dice = rule('#cardzoom .zoomdice');
const chip = rule('#cardzoom .zoomdice .badge');
const square = rule('#cardzoom .zoomdice .badge.ctr,\n#cardzoom .zoomdice .badge.dmg');

/** every tilt a chip can be given, from every `.zoomdice .badge…` rule */
const tilts = (): number[] => {
  const out: number[] = [];
  const re = /#cardzoom \.zoomdice \.badge[^{]*\{[^}]*?rotate\((-?[\d.]+)deg\)/g;
  for (let m; (m = re.exec(css));) out.push(Math.abs(Number(m[1])));
  return out;
};

/** the outer (non-inset) shadow: [dx, dy, blur] */
const outerShadow = (): [number, number, number] => {
  const layers = prop(chip, 'box-shadow').split(/,(?![^(]*\))/).map(s => s.trim());
  const outer = layers.filter(l => !l.startsWith('inset'));
  assert.equal(outer.length, 1, 'one outer shadow on a die');
  const [dx = 0, dy = 0, blur = 0] = outer[0]!.split(/\s+/).slice(0, 3).map(cqw);
  return [dx, dy, blur];
};

test('the dice box still clips and the dice still sit where they did', () => {
  assert.equal(prop(dice, 'overflow'), 'hidden', 'the cap above the type line is the design');
  const [pt, pr, pb, pl] = box4(prop(dice, 'padding'));
  // the CONTENT box — where the chips lay out — is the one the owner signed off
  // on in round 4: 21cqw down, 5cqw in from each side, 60cqw tall at most
  assert.ok(Math.abs(cqw(prop(dice, 'top')) + pt - 21) < 1e-9, 'content top 21cqw');
  assert.ok(Math.abs(cqw(prop(dice, 'left')) + pl - 5) < 1e-9, 'content left 5cqw');
  assert.ok(Math.abs(cqw(prop(dice, 'right')) + pr - 5) < 1e-9, 'content right 5cqw');
  // border-box everywhere (style.css `* { box-sizing }`), so max-height counts the padding
  assert.ok(Math.abs(cqw(prop(dice, 'max-height')) - pt - pb - 60) < 1e-9, 'content 60cqw tall');
});

test('a tilted die and its shadow fit inside the clip on every side', () => {
  const [pt, pr, pb, pl] = box4(prop(dice, 'padding'));
  const angles = tilts();
  assert.ok(angles.length >= 3, `found the tumble rules (${angles})`);
  const [dx, dy, blur] = outerShadow();
  assert.ok(blur > 0, 'the shadow the report saw cut');

  // the two extreme chips: the widest a text chip can be (max-width 100% of the
  // content width) and the literal die (min 12cqw square)
  const contentW = 100 - cqw(prop(dice, 'left')) - cqw(prop(dice, 'right')) - pl - pr;
  const font = cqw(prop(chip, 'font-size'));
  const [padY = 0] = prop(chip, 'padding').split(/\s+/).map(cqw);
  const border = cqw(prop(chip, 'border-width'));
  const textH = font * Number(prop(chip, 'line-height')) + 2 * padY + 2 * border;
  const die = cqw(prop(square, 'min-width'));
  const chips: Array<[number, number]> = [[contentW, textH], [die, die]];

  for (const deg of angles) {
    const t = (deg * Math.PI) / 180;
    for (const [w, h] of chips) {
      // how far the rotated rectangle's bounding box sticks out past the
      // unrotated one, per side
      const ox = (w / 2) * Math.cos(t) + (h / 2) * Math.sin(t) - w / 2;
      const oy = (w / 2) * Math.sin(t) + (h / 2) * Math.cos(t) - h / 2;
      const need = { top: oy + blur - dy, bottom: oy + blur + dy, left: ox + blur - dx, right: ox + blur + dx };
      const have = { top: pt, bottom: pb, left: pl, right: pr };
      for (const side of ['top', 'bottom', 'left', 'right'] as const) {
        assert.ok(have[side] >= need[side],
          `a ${w.toFixed(1)}x${h.toFixed(1)}cqw chip tilted ${deg}deg reaches ${need[side].toFixed(2)}cqw past the ${side}, `
          + `the box pads ${have[side]}cqw — its corner or shadow is cut`);
      }
    }
  }
});
