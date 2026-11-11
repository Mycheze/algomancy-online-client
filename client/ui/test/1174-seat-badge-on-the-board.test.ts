/* BL-17 — "An account can hold a badge level and it is visible on their
 * profile and in game." The board half: the server's `badges` (each seat's
 * mark, absent when nobody has one — server/test/1173) is drawn as the
 * profile's own chip beside that player's name, through the real client.
 *
 *   §1 a judge's badge beside the judge's name, and nothing beside the other
 *   §2 the next push without `badges` takes the badge away (absent ⇒ nobody)
 *   §3 the board draws ICONS, not the profile's worded chip, and styles them
 *      (owner, 2026-11-10, #steward: "I don't like how long they are. Instead
 *      of printing the text, I'd rather display a little icon of some kind")
 *   §5 a league champion's trophy is drawn too ("champions should have their
 *      badges displayed! That's the whole point of the badges existing")
 *   §6 hovering (or tapping) the icons gives the full words and what each
 *      badge is from — its own info tip, not the name's pile counts
 *   §7 the marks are the client's own SVG icons, never emoji — not the badges,
 *      not their tip, not the initiative star (owner, report #379: "Are they
 *      just raw emojis? … Better to find actual assets that look good and
 *      render the same on all devices")
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { toDeployment } from '../../engine/test/util.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';
import { client } from './ui-driver.ts';
import { readStyles } from './read-styles.ts';
import { badgeChipsHtml, seatBadgeHtml, seatBadgeTipHtml } from '../pages/profile.ts';
import { icon } from '../components/icon.ts';

/** the three marks as the icon set draws them (report #379: SVG, never emoji) */
const JUDGE = icon('judge'), TROPHY = icon('league'), STAR = icon('star');

const ui = await client();
const h = new Harness(7, ['Annfield', 'Bostock']);
toDeployment(h);
const s = h.state as GameState, me = 0 as Seat;
const legal = legalActions(h.state, me) as Action[];

/** the `.pname` span holding `name`, as drawn, up to the initiative star */
function nameplate(html: string, name: string): string {
  const at = html.indexOf(`<span class="pname">${name}`);
  assert.ok(at >= 0, `${name}'s name is on the board`);
  return html.slice(at, html.indexOf('<span class="linit', at));
}

test('1174 §1: a judge\'s badge is drawn beside their name on the board, and nothing beside the other player', () => {
  ui.join(s, me, legal);
  const html = ui.update(s, legal, { badges: [null, { judge: 2 }] });
  const plate = nameplate(html, 'Bostock');
  assert.match(plate, /<span class="seatbadge" data-tip="badge" data-btn="infotip" data-p="1"[^>]*><span class="sbicon judge"><svg/);
  assert.ok(plate.includes(`<span class="sbicon judge">${JUDGE}<span class="sblevel">2</span></span></span>`), 'the scales, then the level');
  assert.doesNotMatch(nameplate(html, 'Annfield'), /seatbadge/);
  const owner = ui.update(s, legal, { badges: [{ owner: true, judge: 1 }, null] });
  assert.ok(nameplate(owner, 'Annfield').includes(`sbicon judge">${JUDGE}<span class="sblevel">1<`));
  assert.doesNotMatch(nameplate(owner, 'Bostock'), /seatbadge/);
});

test('1174 §4: the owner\'s mark is never drawn — not at the table, not on a profile (owner, 2026-11-08: "it seems pretensious")', () => {
  const html = ui.update(s, legal, { badges: [{ owner: true }, null] });
  assert.doesNotMatch(nameplate(html, 'Annfield'), /seatbadge|badgechip|Owner/);
  assert.equal(badgeChipsHtml({ owner: true }), '');
  assert.equal(seatBadgeHtml({ owner: true }), '');
  assert.equal(badgeChipsHtml({ owner: true, judge: 2 }), badgeChipsHtml({ judge: 2 }));
});

test('1174 §2: a push without badges clears them', () => {
  ui.update(s, legal, { badges: [null, { judge: 3 }] });
  const html = ui.update(s, legal);
  assert.doesNotMatch(html, /seatbadge/);
});

test('1174 §3: the board draws icons, not the profile\'s worded chip, and the board styles them', () => {
  assert.equal(seatBadgeHtml(null), '');
  assert.equal(seatBadgeHtml({}), '');
  const judge = seatBadgeHtml({ judge: 1 }, 1);
  assert.doesNotMatch(judge, /badgechip|Judge L1</, 'no worded chip at the table');
  assert.equal(judge.replace(/<[^>]*>/g, '').trim(), '1', 'what shows is an icon and its level, nothing longer');
  assert.ok(judge.includes(`<span class="sbicon judge">${JUDGE}`), 'the icon is the scales');
  assert.match(judge, /aria-label="Judge level 1"/, 'the words are still there for a screen reader');
  assert.match(readStyles(), /\.pname \.seatbadge \.sbicon \{[^}]*font-size/);
});

test('1174 §5: a league champion wears a trophy at the table, with a count once they have won more than one season', () => {
  const html = ui.update(s, legal, { badges: [{ champion: ['October 2026 pilot'] }, null] });
  assert.ok(nameplate(html, 'Annfield').includes(`<span class="sbicon champion">${TROPHY}</span>`));
  assert.doesNotMatch(nameplate(html, 'Bostock'), /seatbadge/);
  const twice = seatBadgeHtml({ judge: 3, champion: ['November 2026', 'October 2026 pilot'] }, 0);
  assert.equal(twice.replace(/<[^>]*>/g, '').trim(), '32');
  assert.ok(twice.includes(`${JUDGE}<span class="sblevel">3</span></span><span class="sbicon champion">${TROPHY}<span class="sblevel">2</span>`));
  assert.equal(seatBadgeHtml({ champion: [] }), '', 'no seasons won, no trophy');
});

test('1174 §6: hovering the badge icons says each badge in full and what it is from — a tip of its own', () => {
  const tip = seatBadgeTipHtml({ judge: 2, champion: ['November 2026', 'October 2026 pilot'] });
  assert.match(tip, /Judge L2/);
  assert.match(tip, /level 2 of 3/);
  assert.match(tip, /League champion/);
  assert.match(tip, /won the November 2026 league/);
  assert.match(tip, /won the October 2026 pilot league/);
  assert.equal(seatBadgeTipHtml({ owner: true }), '', 'the owner\'s mark says nothing here either');
  assert.match(seatBadgeTipHtml({ champion: ['<b>'] }), /won the &lt;b&gt; league/, 'a season name is escaped');
  // its own tip target, inside the name's (whose tip is the pile counts)
  const html = ui.update(s, legal, { badges: [null, { judge: 2 }] });
  assert.match(html, /<span class="lname" data-tip="counts"[^>]*><span class="pname">Bostock <span class="seatbadge" data-tip="badge" data-btn="infotip" data-p="1"/);
  // and a tap (no hover on a finger) opens the badge's words, through the client
  const tapped = ui.tap({ tip: 'badge', p: '1' });
  assert.ok(tapped.includes(`<div class="tiphead">${JUDGE} Judge L2</div>`), 'headed by the same scales');
  assert.doesNotMatch(tapped, /class="tiptab"/, 'not the name\'s pile counts');
  assert.doesNotMatch(ui.tap({ tip: 'badge', p: '1' }), /Judge L2/, 'a second tap drops it');
});

test('1174 §7: the badges, their tip and the initiative star are SVG icons from the icon set, never emoji', () => {
  const EMOJI = /[\u{2696}\u{1F3C6}\u{2B50}\u{1F31F}\u{2605}]/u; // ⚖ 🏆 ⭐ 🌟 ★
  const both = { judge: 3 as const, champion: ['November 2026', 'October 2026 pilot'] };
  const html = ui.update(s, legal, { badges: [both, both] });
  for (const name of ['Annfield', 'Bostock']) {
    const at = html.indexOf(`<span class="pname">${name}`);
    assert.ok(at >= 0, `${name}'s name is on the board`);
    const star = html.indexOf('<span class="linit', at);
    const plate = html.slice(at, html.indexOf('</span>', html.indexOf('</svg>', star)) + 7);
    assert.doesNotMatch(plate, EMOJI, `${name}'s nameplate draws no emoji`);
    assert.ok(plate.includes(JUDGE) && plate.includes(TROPHY), `${name}'s badges are SVG icons`);
    assert.ok(plate.endsWith(`> ${STAR}</span>`), `${name}'s initiative slot holds the SVG star`);
  }
  assert.equal((html.match(/<span class="linit off">/g) ?? []).length, 1, 'one seat has the initiative, the other keeps the slot');
  const tip = seatBadgeTipHtml(both);
  assert.doesNotMatch(tip, EMOJI, 'the tip heads draw the same icons');
  assert.ok(tip.includes(`<div class="tiphead">${TROPHY} League champion</div>`));
  // the colours now take: an emoji ignored them, an SVG is drawn in currentColor
  const css = readStyles();
  assert.match(css, /\.pname \.seatbadge \.sbicon\.judge \{ color: var\(--accent\); \}/);
  assert.match(css, /\.linfo \.linit \{ color: [^;]+; \}/);
});
