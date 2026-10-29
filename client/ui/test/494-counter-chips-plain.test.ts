/* 494 — THE PLAYER'S COUNTER CHIPS ARE PLAIN WORDS (report #221, 2026-10-18).
 *
 * The rot and debt chips beside a player's life used to lead with a pictograph
 * (☠ rot, ⛓ debt). The owner: "they're weird" — take them off. Both boards
 * draw the same `counters` markup (main.ts regionParts), so both are read
 * here, through the real client, and EVERY `.pcount` chip is checked, not just
 * the two that exist today: a chip added later with a pictograph on it goes
 * red here too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';

const ui = await client();
/** the pictograph blocks — symbols, dingbats, emoji (286's EMOJI, widened to the arrows/misc-technical block ⛓ is not in) */
const PICTO = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE0F}]/u;

const chips = (html: string): string[] =>
  [...html.matchAll(/<span class="pcount [^"]*"[^>]*>([^<]*)<\/span>/g)].map(m => m[1]!);

function plainOn(): void {
  const h = new Harness(49401);
  h.state.players[0]!.rot = 3;
  h.state.players[1]!.debt = 2;
  const html = ui.join(h.state, 0, legalActions(h.state, 0));
  const got = chips(html);
  assert.deepEqual(got.map(t => t.trim()).sort(), ['debt 2', 'rot 3'], `the chips: ${JSON.stringify(got)}`);
  for (const t of got) assert.doesNotMatch(t, PICTO, `a pictograph on a counter chip: "${t}"`);
}

// literal names: the playtest ledger cites them, and its resolver reads titles off the source
test('regions board: rot and debt read as words, with no pictograph', () => plainOn());

test('a player with no rot and no debt has no chip at all', () => {
  const h = new Harness(49402);
  assert.deepEqual(chips(ui.join(h.state, 0, legalActions(h.state, 0))), []);
});
