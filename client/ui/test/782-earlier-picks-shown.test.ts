/* 782 — THE EARLIER CHOOSER'S OPEN PICK IS ON SCREEN, FOR BOTH PLAYERS.
 *
 * Report #317 (EMNR) and the rules channel's answer, relayed by the owner on
 * 2026-11-01: "So the INT player picks their thing and, if it's open
 * information, it should be highlighted and clear what they've chosen, then
 * NIT picks their thing. If it's hidden information, no indication needs to
 * be given, other than who's turn it is to pick."
 *
 * CR 102.3b. Driven through the real client (ui-driver) on the real redacted
 * views (server/view.ts viewFor), General Smof (units in play: open) and
 * Cthyrian Culler (cards in hand: hidden):
 *
 *   §1 the second sacrificer's bar says what the first chose, and the unit wears the mark
 *   §2 the waiting first sacrificer sees whose turn it is, and its own pick marked
 *   §3 a hidden pick: "has chosen", no card named, nothing marked
 *
 * Seeds 78200-78299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { give, pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { EntityId, Seat } from '../../engine/src/types.ts';
import { viewFor } from '../../server/view.ts';

const ANVIL = 'Triskaidekaphage';

function smofAsked(): { h: Harness; A: Seat; D: Seat; picked: EntityId; label: string } {
  const h = new Harness(78201);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const general = spawn(h, A, 'General Smof');
  const fodder = spawn(h, A, 'Conduit of Pain');
  spawn(h, D, 'Good Whale'); spawn(h, D, ANVIL);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[general], [fodder]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h); pass(h); pass(h);
  const dec = h.state.decision!;
  assert.equal(dec.seat, A, 'the initiative player is asked first');
  const opt = dec.options[1]!;
  h.do({ type: 'decide', seat: A, choice: 1 });
  assert.equal(h.state.decision?.seat, D);
  return { h, A, D, picked: opt.value as EntityId, label: opt.label };
}

/** the markup of one unit on the board, by id */
function unitChunk(html: string, id: EntityId): string {
  const at = html.indexOf(`data-act="unit" data-id="${id}"`);
  assert.ok(at > 0, `unit ${id} is on the board`);
  const open = html.lastIndexOf('<div class="', at);
  const next = html.indexOf('data-act="unit"', at + 20);
  return html.slice(open, next > 0 ? next : at + 3000);
}

test('§1 the second sacrificer is told what the first chose, and the unit is marked', async () => {
  const ui = await client();
  const { h, A, D, picked, label } = smofAsked();
  const html = ui.join(viewFor(h.state, D), D, legalActions(h.state, D));
  const name = h.state.players[A]!.name;
  assert.ok(html.includes(`<span class="earlier">${name} chose ${label}</span>`),
    'the bar says who chose what');
  const chunk = unitChunk(html, picked);
  assert.match(chunk, /class="[^"]*\bchosen\b/, 'the picked unit wears the mark');
  assert.match(chunk, new RegExp(`class="picktag">${name}(&#39;|&#x27;|')s pick<`), 'and says whose pick it is');
});

test('§2 the waiting first sacrificer sees whose turn it is, and its own pick marked', async () => {
  const ui = await client();
  const { h, A, D, picked, label } = smofAsked();
  const html = ui.join(viewFor(h.state, A), A, legalActions(h.state, A));
  assert.ok(html.includes(`Waiting for ${h.state.players[D]!.name}`), 'whose turn it is to pick');
  assert.ok(html.includes(`<span class="earlier">You chose ${label}</span>`));
  assert.match(unitChunk(html, picked), /class="[^"]*\bchosen\b/);
});

test('§3 a hidden pick: the next chooser is told only that it was made', async () => {
  const ui = await client();
  const h = new Harness(78203);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const culler = spawn(h, A, 'Cthyrian Culler');
  spawn(h, D, ANVIL);
  toNextBattle(h, A);
  for (const s of [A, D]) {
    h.state.players[s]!.hand = [];
    give(h, s, 'Immolate'); give(h, s, 'Tidal Menace'); give(h, s, 'Bubb');
  }
  h.do({ type: 'declareAttack', seat: A, columns: [[culler]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  for (let guard = 0; guard < 12 && !h.state.decision; guard++) pass(h);
  assert.equal(h.state.decision?.seat, A);
  h.do({ type: 'decide', seat: A, choice: 2 });   // Bubb
  const html = ui.join(viewFor(h.state, D), D, legalActions(h.state, D));
  assert.ok(html.includes(`<span class="earlier">${h.state.players[A]!.name} has chosen</span>`));
  assert.doesNotMatch(html, /class="[^"]*\bchosen\b/, 'nothing is marked');
});
