/* Literal-reading audit, batch earth-c + metal-a/b/c (2026-08-24).
 *
 * The owner's Rotspore ruling (CR 707.7) — "all the cards in Algomancy are pretty
 * literal" — applied to the four batches above. These tests PIN the literal
 * reading of two printed clauses whose code carried a qualifier the card does
 * not print. Seeds 11300-11399.
 *
 *  1. The Bonesculptor — "play one unit with NO ABILITIES from your bin".
 *     The eligibility test looked at four behaviour channels (`abilities`,
 *     `augmentText`, `spellEffect`, `graftEffect`) and no others, so any card
 *     whose text is a static, a cost modifier, a permission or a replacement
 *     counted as ability-free: 44 of the pool's cards, Sandstone Defender and
 *     Towering Colossus among them. The engine's own suppression note (now CR 712.1a) settles it — "a
 *     static IS an ability" — so the test is now "no behaviour at all", with
 *     attributes and type-line [Augment] grants still excused by the card's
 *     own reminder text.
 *
 *  2. Powerforge Synergist — "[Augment] When I despawn, you may move MY
 *     COUNTERS onto target unit." The trigger was gated on `counters > 0`.
 *     Counters are one SIGNED net in this engine, and both of this batch's
 *     other counter-movers (Flux Constructor, Scrap For Parts) move a negative
 *     net deliberately and say so. The donated form is where it bites: "I" is
 *     the host, and a host can sit on a net -3 and live.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import type { Seat } from '../src/types.ts';
import {
  effStats, ent, give, giveResources, pick, spawn, toDeployment, unitsOf,
  withE,
} from './util.ts';

/** raw engine calls against the harness state, absorbing a mid-settle
 * suspension (26-metal-a's helper, verbatim in behaviour). */

// ── The Bonesculptor: "a unit with no abilities" ─────────────────────────
//
// CT-255 (CR 707.10): the permission is a standing play option now — each
// eligible card is offered as its own `playFromBin` in deployment — so "what is
// offered" is read off legalActions rather than off an activation's menu.

/** the bin cards The Bonesculptor's permission offers `p` right now */
const binOffer = (h: Harness, p: Seat): string[] =>
  legalActions(h.state, p).flatMap(a => a.type === 'playFromBin' ? [h.state.players[p]!.bin[a.binIndex]!] : []);

test('The Bonesculptor: a statics-only [Augment] card is NOT "a unit with no abilities"', () => {
  const h = new Harness(11301);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const bone = spawn(h, p, 'The Bonesculptor');
  // Curio Drifter is genuinely vanilla ({Evasive} is an attribute).
  // Sandstone Defender prints "[Augment] Your other units gain +0/+2" — a text
  // box, implemented as a `statics` entry and nothing else.
  h.state.players[p]!.bin.push('Curio Drifter', 'Sandstone Defender');
  giveResources(h, p, 'water', 1);                  // Curio Drifter: b/1
  giveResources(h, p, 'earth', 2);                  // Sandstone Defender: e/2 — affordable
  void bone;
  const labels = binOffer(h, p);
  assert.ok(labels.includes('Curio Drifter'), 'the genuinely ability-free unit is still offered');
  assert.ok(!labels.includes('Sandstone Defender'),
    '"[Augment] Your other units gain +0/+2" is an ability — CR 712.1a: a static IS an ability');
});

test('The Bonesculptor: cost-modifier, permission and replacement text all count as abilities', () => {
  const h = new Harness(11302);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const bone = spawn(h, p, 'The Bonesculptor');
  h.state.players[p]!.bin.push(
    'Curio Drifter',            // vanilla — the control
    'Tranquility',              // "[Augment] Spells cost [one] more…" — a costMod
    'Dispatch Courier',         // "[Augment] Each turn, you may play a unit…" — a playPermission
    'Automaton of Abundance',   // "If you would create…" — a token-batch replacement
    'Monke',                    // "…other units lose all attributes and abilities…" — a static
  );
  giveResources(h, p, 'water', 1);
  giveResources(h, p, 'earth', 3);                  // Tranquility ee/3
  giveResources(h, p, 'metal', 5);                  // Courier mm/2, Automaton mm/5, Monke m/1
  void bone;
  assert.deepEqual(binOffer(h, p), ['Curio Drifter'],
    'every card with a text box is refused, whichever channel carries it');
});

test('The Bonesculptor: the apply gate refuses a text-bearing card too', () => {
  const h = new Harness(11303);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'The Bonesculptor');
  h.state.players[p]!.bin.push('Curio Drifter', 'Towering Colossus');
  giveResources(h, p, 'water', 1);
  giveResources(h, p, 'earth', 5);                  // Towering Colossus: ee/5 — affordable
  // the offer never lists it, and `doPlayFromBin` has to refuse it independently
  // of the offer (the fuzzer's "legalActions lied" check holds the two together)
  assert.ok(!binOffer(h, p).includes('Towering Colossus'), 'a 10/15 statics card is not ability-free');
  assert.throws(() => h.do({ type: 'playFromBin', seat: p, binIndex: 1 }), /no permission/);
  assert.ok(!unitsOf(h, p).some(u => u.card === 'Towering Colossus'), 'nothing came out of the bin');
  assert.ok(h.state.players[p]!.bin.includes('Towering Colossus'), 'it is still there');
});

// ── Powerforge Synergist: "move MY counters" ─────────────────────────────

test('Powerforge Synergist: the donated "move my counters" moves a NEGATIVE net too', () => {
  const h = new Harness(11310);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const host = spawn(h, p, 'Good Whale');            // 7/5
  const ally = spawn(h, p, 'Good Whale');            // 7/5 — survives a net -3
  giveResources(h, p, 'metal', 2);                   // Powerforge Synergist: m/2
  h.do({
    type: 'augment', seat: p, from: 'hand',
    index: give(h, p, 'Powerforge Synergist'), hostId: host,
  });
  withE(h, e => { e.addCounters(e.entity(host)!, -3); });
  assert.equal(ent(h, host)!.counters, -3, 'the host carries a net -3 and lives');
  assert.deepEqual(effStats(h, host), [4, 2], '7/5 with -3 counters');
  // "[Augment] When I despawn, you may move my counters onto target unit" —
  // "I" is the HOST, and it has counters. This produced no trigger at all
  // while the gate read `counters > 0`.
  withE(h, e => { e.destroy(e.entity(host)!, 'is deleted'); });
  assert.ok(h.state.decision, 'the despawn trigger fired and is asking for a target');
  pick(h, { unit: ally });
  assert.equal(ent(h, ally)!.counters, -3, 'the counters moved WITH their sign');
  assert.deepEqual(effStats(h, ally), [4, 2], '7/5 with the -3 counters on it now');
});

test('Powerforge Synergist: a positive net still moves exactly as before', () => {
  const h = new Harness(11311);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const pf = spawn(h, p, 'Powerforge Synergist');     // 0/0 + two counters = 2/2
  const ally = spawn(h, p, 'Unit Token');
  assert.equal(ent(h, pf)!.counters, 2);
  withE(h, e => { e.destroy(e.entity(pf)!, 'is deleted'); });
  assert.ok(h.state.decision, 'the despawn trigger fired');
  pick(h, { unit: ally });
  assert.equal(ent(h, ally)!.counters, 2, 'both counters moved');
  assert.deepEqual(effStats(h, ally), [3, 3]);
});
