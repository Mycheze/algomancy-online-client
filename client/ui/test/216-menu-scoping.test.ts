/* R241 (BL-20) — A CARD MENU CARRIES CARD THINGS. And BL-32, the hand dock.
 *
 * Two owner-filed QoL asks about the same thing: the client putting something
 * in front of you that is not what you are looking at.
 *
 * ── BL-20, and why it is a REVERSAL rather than a fix ─────────────────
 *
 * The owner, 2026-08-25:
 *
 *   "I was referring to the concede and view erased menu items. Those are for
 *    ONLY when right clicking the field. Righclicking a card should only show
 *    things related to that card"
 *
 * R65 put them on every card menu ON PURPOSE — *"so you never have to hunt for
 * bare table"* — because the original playtest asks were that neither was
 * reachable AT ALL ("We need a way to right click -> concede match :(", "I
 * dont think there's currently a way to view erased cards"). So this file has
 * to hold BOTH ends: §1 is the new rule, and §2 is the old complaint, which
 * must not come back. A change that made §1 pass by making the entries
 * unreachable would be a worse bug than the one being fixed, and §2 is the
 * only thing standing between us and it.
 *
 * §3 is the card BACK, which the entry asked to be decided deliberately rather
 * than left to fall out. The call: an unreadable card is not a card, for menu
 * purposes — it offers no card things, so there is no scope to confuse, and it
 * gets the table's menu rather than being a dead click.
 *
 * ── BL-32 / report #113, the hand dock ────────────────────────────────
 *
 *   "when drafting or choosing which 2 (in contructed) to put on the bottom,
 *    make the 'hand' along the bottom of the screen slide down to not show.
 *    Since you can see your hand in the draft/recycle area, it's just
 *    duplicated and moving it off screen would let you more easily survey the
 *    battlefield at the same time"
 *
 * §4 measures the duplication he is describing, then measures that the dock is
 * TUCKED and not UNMOUNTED — which is the trap the entry names by hand:
 * `data-animzone="hand:N"` exists only on the dock in net mode, and
 * `ui/anim.ts` drops any flight whose endpoint does not measure `real()`. A
 * dock that is gone, or clipped to nothing, silently kills every card flight
 * into and out of your hand.
 *
 * Seeds 21600-21699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { boardMenuEntries } from '../inspect.ts';
import { client } from './ui-driver.ts';
import { nameKeys } from '../motion.ts';
import { spawn, toDeployment } from '../../engine/test/util.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();

/** every label in the open right-click menu, as the client really painted it.
 * Read off `data-btn="menuitem"`, which is what menuHtml emits — the labels go
 * through `iconizeText`, so the tags come back out before comparing. */
function menuLabels(html: string): string[] {
  assert.ok(html.includes('class="menu"'), 'a right-click opened no menu at all');
  return [...html.matchAll(/data-btn="menuitem" data-i="\d+">([\s\S]*?)<\/button>/g)]
    .map(m => m[1]!.replace(/<[^>]*>/g, '').trim());
}

/** the two field entries, named the way boardMenuEntries names them — DERIVED,
 * so renaming an entry cannot quietly make this file stop looking for it */
function fieldLabels(s: GameState, seat: Seat): string[] {
  return boardMenuEntries(s, seat).map(e => e.label);
}

function board(seed: number): { h: Harness; A: Seat; unit: number } {
  const h = new Harness(seed, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const unit = spawn(h, A, 'Good Whale');
  return { h, A, unit };
}

/* ── §1 the new rule ────────────────────────────────────────────────────── */

test('§1 right-clicking a CARD shows card things, and nothing about the field', () => {
  const { h, A, unit } = board(21600);
  ui.join(h.state as GameState, A, legalActions(h.state, A) as Action[]);
  const labels = menuLabels(ui.rightClick({ previd: unit }));
  assert.ok(labels.length, 'the card menu is not empty');
  assert.ok(labels.some(l => /details, attributes/.test(l)),
    'positive control: it really is the card menu, and it really opened');
  const field = fieldLabels(h.state as GameState, A);
  assert.ok(field.length, 'positive control: there ARE field entries to have leaked');
  const leaked = labels.filter(l => field.includes(l));
  assert.deepEqual(leaked, [],
    'R241: "Righclicking a card should only show things related to that card"');
});

/* ── §2 the ORIGINAL complaint, which must not come back ────────────────── */

test('§2 both field entries are still reachable — from bare table', () => {
  const { h, A } = board(21601);
  ui.join(h.state as GameState, A, legalActions(h.state, A) as Action[]);
  // a right-click that lands on nothing inspectable IS the bare-table click:
  // the handler's own test is `closest('[data-prev], [data-previd]')`
  const labels = menuLabels(ui.rightClick({ act: 'player', p: A }));
  const field = fieldLabels(h.state as GameState, A);
  for (const want of field) {
    assert.ok(labels.includes(want),
      `"${want}" must stay reachable — R65 exists because it was reachable from NOWHERE, and `
      + 'narrowing the card menu must not re-create that');
  }
  assert.ok(field.some(l => /Concede/.test(l)), 'and concede is one of them');
});

/* ── §3 the card back — the deliberate call ─────────────────────────────── */

test('§3 a card BACK is not a dead click: an unreadable card gets the table menu', () => {
  const { h, A } = board(21602);
  // what the OPPONENT's hand really is on a redacted view — the shape
  // `server/view.ts` serves, so this is the back the owner would actually
  // right-click rather than a fixture invented to be right-clicked
  const D = (1 - A) as Seat;
  const view = { ...h.state, players: h.state.players.map((p, i) =>
    i === D ? { ...p, hand: p.hand.map(() => '__HIDDEN__') } : p) } as GameState;
  ui.join(view, A, []);
  const key = nameKeys(view.players[D]!.hand, `h${D}:`)[0]!;
  const labels = menuLabels(ui.rightClick({ anim: key }));
  assert.deepEqual(labels, fieldLabels(view, A),
    'the table menu exactly — no card entries, because there is no card to ask about, and not '
    + 'an empty menu either, because that is the dead click BL-20 said to avoid');
});

/* ── §4 BL-32: the dock is tucked, and it is still there ────────────────── */

/** the client's own markup for a state, joined fresh */
const paint = (s: GameState, seat: Seat): string => ui.join(s, seat, []);

test('§4a the duplication the report describes is real, and measured', () => {
  const h = new Harness(21603, ['Ben', 'Rashi'], 'draft');
  const drafting = h.state as GameState;
  assert.equal(drafting.mode, 'draft', 'the fixture really is a draft');
  const seat = drafting.initiative;
  const html = paint(drafting, seat);
  const packCards = (html.match(/data-act="draftcard"/g) ?? []).length;
  assert.ok(packCards > 0, 'the draft panel is on screen');
  assert.ok(/class="handdock tucked"/.test(html),
    'and the dock showing the same cards a second time is tucked out of the way');
});

test('§4b TUCKED, NOT UNMOUNTED — the flight anchor survives', () => {
  const h = new Harness(21604, ['Ben', 'Rashi'], 'draft');
  const seat = h.state.initiative;
  const html = paint(h.state as GameState, seat);
  assert.ok(html.includes(`data-animzone="hand:${seat}"`),
    'ui/anim.ts resolves every card flight into or out of your hand against this anchor, and in '
    + 'net mode the DOCK is the only element that carries it — removing the dock would drop the '
    + 'animation silently, which is exactly what the entry warned about');
  assert.ok(/class="handdock tucked"[\s\S]*?data-animzone/.test(html),
    'and the anchor is INSIDE the tucked dock, not somewhere else that happens to still exist');
});

test('§4c the dock comes back the moment the choice ends', () => {
  const { h, A } = board(21605);
  // toDeployment has run: no draft pack open, no bottoming pending
  const html = paint(h.state as GameState, A);
  assert.ok(/class="handdock"/.test(html),
    'no draft and no bottom choice — the dock is a plain dock again');
  assert.equal(/class="handdock tucked"/.test(html), false);
});
