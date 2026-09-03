/* BL-23 / R136 — the corner-chip strip on a card scan is ONE line.
 *
 * Bena's ask was two words: "single line badges". The chips (attributes, the
 * ±N/±N counter, mod chips, "sent", "⏩ auto-yield", 📜 prophesy, the live X
 * preview) are pushed from a dozen call sites in ui/main.ts, none of which can
 * know how many others there will be — so they used to wrap down over the art
 * until the scan was unreadable.
 *
 * The complaint is the WRAPPING, not the count: nothing may be dropped. The
 * fold decision therefore lives in the container (ui/inspect.ts packBadgeLine),
 * and this pins it — main.ts itself runs DOM code on import and no test can
 * reach it, which is exactly the lesson R134 learned about iconizeText.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BADGE_LINE_PX, badgeLabel, badgeWidth, packBadgeLine } from '../inspect.ts';
import type { Badge } from '../inspect.ts';

/** the real chip a mod wears: an icon img plus the mod's first word, and the
 * motion key ui/anim.ts flies the mod card into */
const modBadge = (name: string): Badge => ({
  t: `<span data-anim="e7"><img class="txticon" src="/data/icons/augment.webp" alt="+" onerror="this.outerHTML=this.alt">${name}</span>`,
  mod: true, html: true,
});

const width = (bs: Badge[]): number => bs.reduce((n, b) => n + badgeWidth(b), 0);

/* ── the label behind a chip ───────────────────────────────────────────── */

test('badgeLabel reads a plain chip as itself and a mod chip through its markup', () => {
  assert.equal(badgeLabel({ t: 'flying' }), 'flying');
  assert.equal(badgeLabel(modBadge('Ironhide')), '+Ironhide');
  // esc() ran over the card name on the way in; the label reads it back out
  assert.equal(badgeLabel({ t: '<span>Fire &amp; Ice</span>', html: true }), 'Fire & Ice');
});

/* ── a light strip is left alone ───────────────────────────────────────── */

test('packBadgeLine leaves a strip that already fits completely alone', () => {
  const bs: Badge[] = [{ t: '+1/+1', ctr: true }, { t: 'flying' }];
  const line = packBadgeLine(bs);
  assert.equal(line.more, null, 'nothing to fold');
  assert.equal(line.hidden.length, 0);
  assert.deepEqual(line.shown, bs, 'and the chips are untouched');
  assert.ok(width(line.shown) <= BADGE_LINE_PX);
});

/* ── the overflow folds, it does not vanish ────────────────────────────── */

test('packBadgeLine folds the overflow into a +N chip that names what it hid', () => {
  // a real unit: counters, an activated ability, three attributes, two mods
  const bs: Badge[] = [
    { t: '+2/+2', ctr: true },
    { t: '⚡ Sacrifice me: deal 3 damage', html: true, cls: 'act' },
    { t: 'flying' }, { t: 'deadly' }, { t: 'piercing' },
    modBadge('Ironhide'), modBadge('Wingblade'),
    { t: 'sent', mod: true },
  ];
  const line = packBadgeLine(bs);

  assert.ok(line.more, 'the strip overflowed, so there is a +N chip');
  assert.ok(line.hidden.length > 0);
  assert.equal(line.more!.t, `+${line.hidden.length}`, 'the chip counts what it hid');
  assert.equal(line.more!.cls, 'more');

  // NOTHING is lost — every chip is either drawn or folded, exactly once
  assert.equal(line.shown.length + line.hidden.length, bs.length);
  assert.deepEqual(
    [...line.shown, ...line.hidden].map(badgeLabel).sort(),
    bs.map(badgeLabel).sort(),
  );

  // and every folded chip is reachable by hovering the +N
  for (const h of line.hidden) assert.ok(line.more!.title!.includes(badgeLabel(h)), badgeLabel(h));
  // the strip's own tooltip lists them all, in push order
  assert.equal(line.title, bs.map(badgeLabel).join(' · '));

  // the whole point: what is drawn fits on one line
  assert.ok(width(line.shown) + badgeWidth(line.more!) <= BADGE_LINE_PX,
    `drawn strip is ${width(line.shown) + badgeWidth(line.more!)}px`);
});

test('packBadgeLine draws what stayed in push order, not in fold order', () => {
  const bs: Badge[] = [
    { t: 'flying' }, { t: '+2/+2', ctr: true }, { t: 'deadly' }, { t: 'sent', mod: true },
  ];
  const line = packBadgeLine(bs);
  const order = line.shown.map(b => bs.indexOf(b as Badge));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'folding never shuffles the survivors');
});

/* ── which chip folds first ────────────────────────────────────────────── */

test('packBadgeLine folds printed attributes before live state', () => {
  // the attributes are also on the card's own text box; the counter, the mod
  // and the "sent" flag are on the scan or nowhere
  const bs: Badge[] = [
    { t: 'flying' }, { t: 'deadly' }, { t: 'piercing' }, { t: 'inverted' },
    { t: '+3/+3', ctr: true }, modBadge('Ironhide'), { t: 'sent', mod: true },
  ];
  // a strip with room for the live chips but not for everything: the four
  // attributes are what folds, and they fold whole
  const line = packBadgeLine(bs, 130);
  assert.deepEqual(line.shown.map(badgeLabel), ['+3/+3', '+Ironhide', 'sent']);
  assert.deepEqual(line.hidden.map(badgeLabel), ['flying', 'deadly', 'piercing', 'inverted']);

  // and squeezed down to the real 78px board budget, the counter is the chip
  // still standing — never an attribute the text box already prints
  const tight = packBadgeLine(bs);
  assert.deepEqual(tight.shown.map(badgeLabel), ['+3/+3']);
  assert.equal(tight.more!.t, '+6');
});

/* ── one chip too wide for the strip ───────────────────────────────────── */

test('packBadgeLine truncates a lone over-long label instead of letting it run', () => {
  const long: Badge = { t: '👁 until end of turn', cls: 'glimpse on' };
  const line = packBadgeLine([long]);
  assert.equal(line.more, null, 'one chip cannot overflow into a +N — it is the only chip');
  const chip = line.shown[0]!;
  assert.notEqual(chip.t, long.t, 'it was cut');
  assert.ok(chip.t.endsWith('…'));
  assert.ok(badgeWidth(chip) <= BADGE_LINE_PX, 'and now it fits the line');
  assert.equal(chip.title, long.t, 'the full text stays on its own tooltip');
});

test('packBadgeLine never draws an empty strip for a badged card', () => {
  const huge: Badge[] = [
    { t: '📜 prophesy from bin', cls: 'proph on' },
    { t: '▶ playable from bin', cls: 'proph on' },
  ];
  const line = packBadgeLine(huge);
  assert.ok(line.shown.length >= 1, 'at least one chip is always drawn');
  assert.equal(line.shown.length + line.hidden.length, huge.length);
});

/* ── it holds at the SMALL card sizes too ──────────────────────────────── */

test('packBadgeLine holds one line at every card width in style.css', () => {
  // every card width style.css sets, less the strip's 2px insets: 40px
  // .sentstrip, 44px .seenhand, 46px .regionbinthumbs, 52px .invaders and
  // .tokenstrip, 56px .ridecol, 58px .binzone, 78px board, 92px .handdock and
  // .bindialog, 116px .cacheentry
  const widths = [36, 40, 42, 48, 52, 54, 74, 88, 112];
  const sets: Badge[][] = [
    [{ t: 'sent', mod: true }],
    [{ t: '+1/+1', ctr: true }, { t: 'flying' }],
    [{ t: 'X=3 now', ctr: true }, { t: '📜 prophesy [2]', cls: 'proph on' }],
    [{ t: '✓ fulfilled', cls: 'proph on' }, { t: '👁 until end of turn', cls: 'glimpse on' },
      { t: 'FREE', cls: 'free' }],
    [{ t: '+2/+2', ctr: true }, { t: '⏩ auto-yield', mod: true }, { t: 'sent', mod: true },
      modBadge('Ironhide'), { t: 'flying' }, { t: 'deadly' }, { t: 'piercing' }],
  ];
  for (const px of widths) {
    for (const bs of sets) {
      const line = packBadgeLine(bs, px);
      const drawn = width(line.shown) + (line.more ? badgeWidth(line.more) : 0);
      assert.ok(line.shown.length >= 1, `nothing drawn at ${px}px`);
      assert.equal(line.shown.length + line.hidden.length, bs.length,
        `a chip went missing at ${px}px`);
      if (line.shown.length > 1) {
        assert.ok(drawn <= px, `${drawn}px drawn into a ${px}px strip`);
      }
      if (line.hidden.length) {
        assert.ok(line.more, `${line.hidden.length} folded with no +N at ${px}px`);
        for (const h of line.hidden) {
          assert.ok(line.more!.title!.includes(badgeLabel(h)),
            `"${badgeLabel(h)}" unreachable at ${px}px`);
        }
      }
    }
  }
});

test('packBadgeLine keeps the +N reachable — it is budgeted before the chips', () => {
  // the failure this guards: fitting chips first and appending the +N would
  // push the affordance off the end of the strip, stranding the folded chips
  const bs: Badge[] = [
    { t: 'flying' }, { t: 'deadly' }, { t: 'piercing' }, { t: 'inverted' }, { t: 'unstable' },
  ];
  const line = packBadgeLine(bs);
  assert.ok(line.more);
  assert.ok(width(line.shown) + badgeWidth(line.more!) <= BADGE_LINE_PX);
});
