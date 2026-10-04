/* #188 (owner, room UVYZ): "The Fireballs on the stack don't actually say
 * 'Powerful' like the units do."
 *
 * Emberflame Enlightener grants your spells {Powerful} — spell tokens too
 * (R157 §13) — and the engine applied it, but only inside resolution, where
 * the grant is assembled per part. Nothing on the strip asked for it, so no
 * stack item ever showed a granted attribute: not Emberflame's Powerful, not
 * Envoy of Lightning's Electric, not a virus's (R79) or a {Modular} mod's
 * (R105). A printed spell attribute was on the scan only.
 *
 * The owner chose CHIPS ONLY: the stack card and its zoom wear the chips a
 * unit does; the does-line wording is left alone. The chips read
 * `E.stackItemAttrs`, which calls the very `stackItemGrants` resolution hands
 * to each part, so a chip cannot claim what the damage will not do.
 *
 * The board runs the engine on its SEAT'S VIEW (server/view.ts), so the query
 * is asked of the redacted state too, from both seats.
 *
 * ui/main.ts is a boot script with no DOM harness, so the wiring is read as
 * text at the bottom.
 *
 * Seeds 36500-36599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import type { GameState, Seat, StackItem } from '../../engine/src/types.ts';
import { ent, giveResources, give, pass, pick, spawn, toDeployment, toNextBattle, tokensOf } from '../../engine/test/util.ts';
import { viewFor } from '../../server/view.ts';
import { stackBadges } from '../effectface.ts';

const labels = (it: StackItem, s: GameState): string[] => stackBadges(it, s).map(b => b.t);

test('a Fireball token cast under Emberflame Enlightener wears a Powerful chip on the stack, in both seat views', () => {
  const h = new Harness(36500);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const victim = spawn(h, A, 'The Foretold');               // 3/3, no attrs
  spawn(h, D, 'Emberflame Enlightener');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[victim]] });
  new E(h.state).createSpellToken(D, 'Fireball', 1, h.state.battle!.region);
  while (h.state.priority !== D) pass(h);
  h.do({ type: 'castSpellToken', seat: D, entityId: tokensOf(h, D)[0]!.id });
  pick(h, { unit: victim });
  const fireball = h.state.stack.find(i => i.controller === D)!;
  assert.deepEqual(labels(fireball, h.state), ['Powerful']);
  for (const seat of [A, D]) {
    const v = viewFor(h.state, seat) as GameState;
    const seen = v.stack.find(i => i.id === fireball.id)!;
    assert.ok(seen, `seat ${seat} sees the Fireball`);
    assert.deepEqual(labels(seen, v), ['Powerful'], `seat ${seat}: the view carries what the query needs`);
  }
  pass(h); pass(h);
  assert.equal(ent(h, victim)!.damage, 2, 'and it resolves as the chip says: 1 doubled');
});

test('a spell shows its printed attribute, a virus riding it adds its attribute and its own chip', () => {
  const h = new Harness(36501);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  giveResources(h, D, 'fire', 4);                           // Arc Lightning rr/4
  giveResources(h, A, 'earth', 2);                          // Chitin Shredder ee/2
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Arc Lightning') });
  pick(h, { player: A });
  const arc = h.state.stack.find(i => i.card === 'Arc Lightning')!;
  assert.deepEqual(labels(arc, h.state), ['Electric'], 'its printed attribute, which was on the scan alone');
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Chitin Shredder'), hostStack: arc.id });
  pass(h); pass(h);                                         // the virus resolves onto the spell
  const ridden = h.state.stack.find(i => i.id === arc.id)!;
  assert.deepEqual(ridden.augments?.map(a => a.card), ['Chitin Shredder'], 'the fixture: a virus rides the spell');
  const chips = stackBadges(ridden, h.state);
  assert.deepEqual(chips.map(b => b.t), ['Electric', 'Powerful', '+Chitin']);
  assert.equal(chips[2]!.mod, true, 'the virus chip is drawn as a mod chip, as on a unit');
  assert.match(chips[2]!.title!, /Chitin Shredder/);
});

test('the stack card and its zoom draw the chips, and the stack card styles them', () => {
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(main, /const chips = stackBadges\(it, h\.state\);/, 'stackBoardHtml asks for them');
  assert.match(main, /<div class="badges stackchips"[^`]*\$\{\s*chips\.map\(badgeSpan\)/,
    'and draws them in the class the zoom swaps for its dice');
  assert.match(main, /if \(sit\) badges = stackBadges\(sit, h\.state\);/, 'the zoom unfolds them');
  assert.match(css, /\.stackcard \.stackchips \{/);
  assert.match(css, /\.stackcard \.badge \{/, 'a stack card is not a .card, so its chips need their own plate');
});
