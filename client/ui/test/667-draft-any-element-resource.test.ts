/* 667 — BL-44: A DRAFT MAY MAKE A RESOURCE OF ANY ELEMENT, behind "more…".
 *
 * The owner, 2026-09-19: "The 'More' sub menu for a game does need to have all
 * the other elements in it. They're just hidden. But it's technically legal to
 * make a Fire resource, even if you don't have any Fire cards in the deck. […]
 * we should allow any color element to be made via the more menu."
 *
 * A draft deals its trio (`GameState.elements`), but that list no longer limits
 * what a resource may be: the engine accepts and offers all seven (`offElements`
 * in apply.ts, appended after the Shard), and both menus lead with the trio and
 * keep the other four behind the expander — the constructed layout (CR D6.14b),
 * with the trio standing where a constructed deck's own elements stand.
 *
 * Driven through the real client (test/ui-driver.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import type { Seat } from '../../engine/src/types.ts';

const ui = await client();
const me = 0 as Seat;

/** the labels of the open menu, in order */
function menu(html: string): string[] {
  const out: string[] = [];
  const re = /<button data-btn="menuitem" data-i="(\d+)">([\s\S]*?)<\/button>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    out.push(m[2]!.replace(/<[^>]*>/g, '').replace(/&hellip;/g, '…').replace(/\s+/g, ' ').trim());
  }
  return out;
}
const indexOf = (html: string, label: RegExp): number => {
  const i = menu(html).findIndex(l => label.test(l));
  assert.ok(i >= 0, `a menu item matching ${label} (menu: ${menu(html).join(' | ')})`);
  return i;
};

/** a fire-water-earth draft, both packs committed: the resource step is open */
function draftAtResources(seed: number): Harness {
  const h = new Harness(seed, undefined, 'draft');
  assert.deepEqual(h.state.elements, ['fire', 'water', 'earth']);
  for (const seat of [0, 1] as const) {
    const H = h.state.players[seat]!.hand.length;
    h.do({ type: 'draftCommit', seat, packIndices: h.state.packs[seat]!.map((_, i) => H + i) });
  }
  assert.equal(h.state.draftDone, null, 'packs passed');
  return h;
}

test('CR 105.9a / BL-44: the draft recycle menu leads with the trio and keeps the other four elements, then the Shard, behind more', () => {
  const h = draftAtResources(66701);
  ui.join(h.state, me, legalActions(h.state, me));
  const main = ui.click({ act: 'hand', p: me, i: 0 });
  assert.deepEqual(menu(main), [
    'Recycle → fire resource', 'Recycle → water resource', 'Recycle → earth resource',
    'Recycle → Prismite', 'more elements… (4)',
  ], 'the main menu is unchanged: the trio, then a Prismite, then the expander');
  const more = ui.click({ btn: 'menuitem', i: indexOf(main, /^more elements/) });
  assert.deepEqual(menu(more), [
    'Recycle → wood resource', 'Recycle → metal resource', 'Recycle → light resource',
    'Recycle → dark resource', 'Recycle → Shard',
  ], 'the expander: the four elements outside the trio, then a Shard');
  ui.sent();
  ui.click({ btn: 'menuitem', i: indexOf(more, /wood/) });
  const sent = ui.actions();
  assert.deepEqual(sent, [{ type: 'recycleForResource', seat: me, handIndex: 0, element: 'wood' }]);
  // and the engine takes it
  const before = h.state.players[me]!.resources.length;
  h.do(sent[0]!);
  assert.deepEqual(h.state.players[me]!.resources[before], { kind: 'wood', state: 'dormant' });
});

test('CR 106.8d / BL-44: an active Prismite in a draft exchanges into an element outside the trio, through more', () => {
  const h = draftAtResources(66702);
  const P = h.state.players[me]!.resources.findIndex(r => r.kind === 'prismite');
  assert.ok(P >= 0, 'the fixture starts with a Prismite');
  h.do({ type: 'activateResource', seat: me, index: P });
  ui.join(h.state, me, legalActions(h.state, me));
  const main = ui.click({ act: 'res', p: me, i: P });
  assert.deepEqual(menu(main), ['Exchange → fire', 'Exchange → water', 'Exchange → earth', 'more elements… (4)'],
    'the trio leads, as the recycle menu');
  const more = ui.click({ btn: 'menuitem', i: indexOf(main, /^more elements/) });
  assert.deepEqual(menu(more), [
    'Exchange → fire', 'Exchange → water', 'Exchange → earth', 'Exchange → wood',
    'Exchange → metal', 'Exchange → light', 'Exchange → dark', 'Exchange → Shard',
  ], 'expanded: every element, the Shard last');
  ui.sent();
  ui.click({ btn: 'menuitem', i: indexOf(more, /→ dark$/) });
  const sent = ui.actions();
  assert.deepEqual(sent, [{ type: 'exchangePrismite', seat: me, index: P, element: 'dark' }]);
  h.do(sent[0]!);
  assert.equal(h.state.players[me]!.resources[P]!.kind, 'dark', 'a dark resource in a fire-water-earth draft');
});
