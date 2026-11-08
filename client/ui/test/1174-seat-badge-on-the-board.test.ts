/* BL-17 — "An account can hold a badge level and it is visible on their
 * profile and in game." The board half: the server's `badges` (each seat's
 * mark, absent when nobody has one — server/test/1173) is drawn as the
 * profile's own chip beside that player's name, through the real client.
 *
 *   §1 a judge's chip beside the judge's name, and nothing beside the other
 *   §2 the next push without `badges` takes the chip away (absent ⇒ nobody)
 *   §3 the chip is the profile's chip, and the board styles it
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { toDeployment } from '../../engine/test/util.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';
import { client } from './ui-driver.ts';
import { readStyles } from './read-styles.ts';
import { badgeChipsHtml, seatBadgeHtml } from '../pages/profile.ts';

const ui = await client();
const h = new Harness(7, ['Annfield', 'Bostock']);
toDeployment(h);
const s = h.state as GameState, me = 0 as Seat;
const legal = legalActions(h.state, me) as Action[];

/** the `.lname` identity span holding `name`, as drawn */
function nameplate(html: string, name: string): string {
  const at = html.indexOf(`<span class="pname">${name}`);
  assert.ok(at >= 0, `${name}'s name is on the board`);
  return html.slice(at, html.indexOf('</span></span>', at) + 14);
}

test('1174 §1: a judge\'s badge is drawn beside their name on the board, and nothing beside the other player', () => {
  ui.join(s, me, legal);
  const html = ui.update(s, legal, { badges: [null, { judge: 2 }] });
  assert.match(nameplate(html, 'Bostock'), /<span class="seatbadge"><span class="badgechip judge"[^>]*>Judge L2<\/span><\/span>/);
  assert.doesNotMatch(nameplate(html, 'Annfield'), /badgechip/);
  const owner = ui.update(s, legal, { badges: [{ owner: true, judge: 1 }, null] });
  assert.match(nameplate(owner, 'Annfield'), /badgechip judge[^>]*>Judge L1</);
  assert.doesNotMatch(nameplate(owner, 'Bostock'), /badgechip/);
});

test('1174 §4: the owner\'s mark is never drawn — not at the table, not on a profile (owner, 2026-11-08: "it seems pretensious")', () => {
  const html = ui.update(s, legal, { badges: [{ owner: true }, null] });
  assert.doesNotMatch(nameplate(html, 'Annfield'), /badgechip|Owner/);
  assert.equal(badgeChipsHtml({ owner: true }), '');
  assert.equal(seatBadgeHtml({ owner: true }), '');
  assert.equal(badgeChipsHtml({ owner: true, judge: 2 }), badgeChipsHtml({ judge: 2 }));
});

test('1174 §2: a push without badges clears them', () => {
  ui.update(s, legal, { badges: [null, { judge: 3 }] });
  const html = ui.update(s, legal);
  assert.doesNotMatch(html, /seatbadge/);
});

test('1174 §3: the board chip is the profile chip, and the board sizes it', () => {
  assert.equal(seatBadgeHtml(null), '');
  assert.equal(seatBadgeHtml({}), '');
  assert.equal(seatBadgeHtml({ judge: 1 }), ` <span class="seatbadge">${badgeChipsHtml({ judge: 1 })}</span>`);
  assert.match(readStyles(), /\.pname \.seatbadge \.badgechip \{[^}]*font-size/);
});
