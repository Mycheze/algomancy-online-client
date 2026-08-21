/* Per-card tests for batch-water-b (project rule: a test for every card).
 * States are built explicitly (spawn/give/giveResources, and direct
 * sharedDeck/bin setup) so parallel card registration can't shift assertions.
 * Seeds: 1500-1599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import {
  effStats, ent, finishBattle, give, giveResources, handIdx, ownAttrs, pass,
  notOffered, pick, skipHasteStep, spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';

/** answer a pending decision by label or value match */
function decide(h: Harness, match: (label: string, value: unknown) => boolean): void {
  const dec = h.state.decision!;
  const idx = dec.options.findIndex(o => match(o.label, o.value));
  assert.notEqual(idx, -1, `no option matching in [${dec.options.map(o => o.label)}]`);
  h.do({ type: 'decide', seat: dec.seat, choice: idx });
}

test('Pull Under: deletes the target; it and its mods land in YOUR bin (not erased, not owner-binned)', () => {
  const h = new Harness(1500);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Curio Drifter');                // opens the battle
  const whale = spawn(h, D, 'Good Whale');                 // modded victim
  new E(h.state).attachMod(h.state.entities[whale]!, 'Ephemeral Skywalker', D, 'augment');
  const plain = spawn(h, D, 'Curio Drifter');              // unmodded victim
  giveResources(h, A, 'water', 10);                        // two casts: bb + 4 mana each
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // modded: destroy() would ERASE base+mods (Unstable); Pull Under bins them for the caster
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Pull Under') });
  pick(h, { unit: whale });
  pass(h); pass(h);
  assert.ok(!ent(h, whale), 'whale deleted');
  assert.ok(h.state.players[A]!.bin.includes('Good Whale'), "victim → caster's bin");
  assert.ok(h.state.players[A]!.bin.includes('Ephemeral Skywalker'), "its mod → caster's bin");
  assert.ok(!h.state.players[D]!.bin.includes('Good Whale'), "not the owner's bin");
  // unmodded: destroy() bins to the owner; Pull Under reroutes to the caster
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Pull Under') });
  pick(h, { unit: plain });
  pass(h); pass(h);
  assert.ok(!ent(h, plain));
  assert.equal(h.state.players[A]!.bin.filter(c => c === 'Curio Drifter').length, 1, "unmodded victim → caster's bin");
  assert.deepEqual(h.state.players[D]!.bin, [], "owner's bin stays empty");
  finishBattle(h);
});

test('Pull Under: a MODDED victim and its mods are trashed by the CASTER (R40 — the bin they enter is his)', () => {
  const h = new Harness(1550);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Curio Drifter');                // opens the battle
  const whale = spawn(h, D, 'Good Whale');                 // modded victim, owned by D
  new E(h.state).attachMod(h.state.entities[whale]!, 'Ephemeral Skywalker', D, 'augment');
  giveResources(h, A, 'water', 6);                         // bb + 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Pull Under') });
  pick(h, { unit: whale });
  pass(h); pass(h);
  const trashes = h.events.filter(ev => ev.type === 'trashed');
  // before the funnel fix this branch fired NO trash at all: destroy() erases
  // an Unstable modded unit, and Pull Under pushed the cards into the bin by
  // hand. Both now enter through E.toBin(caster, …, 'play').
  const body = trashes.find(ev => ev.data?.['card'] === 'Good Whale');
  const mod = trashes.find(ev => ev.data?.['card'] === 'Ephemeral Skywalker');
  assert.ok(body, 'the victim fires trashed');
  assert.ok(mod, 'its mod fires trashed');
  assert.equal(body!.data!['seat'], A, "trashed by the CASTER — it entered the caster's bin, not D's");
  assert.equal(mod!.data!['seat'], A, "the mod likewise: caster's bin, caster trashes");
  assert.equal(body!.data!['from'], 'play');
  assert.equal(trashes.filter(ev => ev.data?.['card'] === 'Good Whale').length, 1, 'exactly one trash, no double count');
  finishBattle(h);
});

test('Pull Under: deleting YOUR OWN unmodded unit trashes it in your name, exactly once', () => {
  const h = new Harness(1551);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'Curio Drifter');                // opens the battle
  const mine = spawn(h, A, 'Good Whale');                  // the caster's own victim
  giveResources(h, A, 'water', 6);
  toNextBattle(h, A);
  // send both, so the caster's own unit is in the battle region and targetable
  h.do({ type: 'declareAttack', seat: A, columns: [[atk, mine]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Pull Under') });
  pick(h, { unit: mine });
  pass(h); pass(h);
  assert.ok(!ent(h, mine));
  assert.equal(h.state.players[A]!.bin.filter(c => c === 'Good Whale').length, 1, "one copy, in the caster's bin");
  const trashes = h.events.filter(ev => ev.type === 'trashed' && ev.data?.['card'] === 'Good Whale');
  assert.equal(trashes.length, 1, 'exactly one trash event');
  assert.equal(trashes[0]!.data!['seat'], A);
  assert.equal(trashes[0]!.data!['from'], 'play');
  finishBattle(h);
});

test('Pull Under: an ENEMY unmodded victim is trashed by the CASTER, exactly once (R40, binTo)', () => {
  // R40: the trasher is the owner of the bin the card enters, and Pull Under
  // puts it in the CASTER's bin — so the event must name A, not D.
  //
  // This used to be a KNOWN GAP: destroy() pushed the card into the OWNER's
  // bin and fired trashed(owner) synchronously (queueing that event's
  // triggers, bumping the per-battle ledger) before Pull Under's effect
  // regained control, and card code can neither suppress nor re-attribute an
  // event that has already fired. destroy() now takes a bin-destination
  // override — `destroy(u, verb, { binTo: Seat })` — so the single bin push
  // and the single trash attribution are one decision.
  //
  // The "exactly one trash event" assertion below is the guard against the
  // WRONG fix (a compensating second trashed(caster), which would double-count
  // the ledger and re-fire "when I am trashed"). Keep it.
  const h = new Harness(1552);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Curio Drifter');
  const plain = spawn(h, D, 'Good Whale');                 // unmodded, owned by D
  giveResources(h, A, 'water', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Pull Under') });
  pick(h, { unit: plain });
  pass(h); pass(h);
  assert.ok(h.state.players[A]!.bin.includes('Good Whale'), "the CARD is in the right bin (the caster's)");
  assert.deepEqual(h.state.players[D]!.bin, [], 'and not in the owner\'s');
  const trashes = h.events.filter(ev => ev.type === 'trashed' && ev.data?.['card'] === 'Good Whale');
  assert.equal(trashes.length, 1, 'exactly one trash event — never doubled up to paper over the attribution');
  assert.equal(trashes[0]!.data!['seat'], A,
    "trashed by the CASTER — R40: the trasher is the owner of the bin it entered");
  assert.equal(trashes[0]!.data!['from'], 'play');
  finishBattle(h);
});

test('Pull Under: a TOKEN victim is erased — no bin, no trash (R40 excludes tokens)', () => {
  const h = new Harness(1553);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Curio Drifter');
  const tok = spawn(h, D, 'Unit Token');
  h.state.entities[tok]!.token = true;
  giveResources(h, A, 'water', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Pull Under') });
  pick(h, { unit: tok });
  pass(h); pass(h);
  assert.ok(!ent(h, tok), 'the token is gone');
  assert.ok(!h.state.players[A]!.bin.includes('Unit Token'), 'nothing entered the caster\'s bin');
  assert.ok(!h.state.players[D]!.bin.includes('Unit Token'), 'nor the owner\'s');
  assert.ok(!h.events.some(ev => ev.type === 'trashed' && ev.data?.['card'] === 'Unit Token'),
    'a token is never trashed (R40)');
  finishBattle(h);
});

test('Recall: each player recalls a unit and loses 2 life (region-scoped, R25)', () => {
  const h = new Harness(1501);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const wh = spawn(h, A, 'Good Whale');
  const dr = spawn(h, D, 'Curio Drifter');
  giveResources(h, D, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  pass(h);                                                 // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Recall') });
  pass(h); pass(h);                                        // resolve (single candidates auto-pick)
  assert.ok(!ent(h, wh) && !ent(h, dr), 'both units left play');
  assert.ok(h.state.players[A]!.hand.includes('Good Whale'), "A's unit → A's hand");
  assert.ok(h.state.players[D]!.hand.includes('Curio Drifter'), "D's unit → D's hand");
  assert.equal(h.state.players[A]!.life, 28, 'A lost 2');
  assert.equal(h.state.players[D]!.life, 28, 'D lost 2');
  assert.ok(h.state.players[D]!.bin.includes('Recall'), 'spell → bin');
  finishBattle(h);
});

test('Rider of the Tides: a card entering a hand during battle → +2/+2 until regroup', () => {
  const h = new Harness(1502);
  toDeployment(h);
  const A = h.state.initiative;
  const rider = spawn(h, A, 'Rider of the Tides');
  const wh = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rider], [wh]] });
  // a card enters a hand mid-battle: recall the whale directly
  const e = new E(h.state);
  e.recall(h.state.entities[wh]!);
  e.settle();
  pass(h); pass(h);                                        // resolve the trigger
  assert.ok(h.state.players[A]!.hand.includes('Good Whale'), 'the whale entered a hand');
  assert.deepEqual(effStats(h, rider), [4, 4], '2/2 + 2/2 = 4/4');
  finishBattle(h);
  assert.deepEqual(effStats(h, rider), [2, 2], 'temp change gone at regroup');
});

test('Rider of the Tides: a battle DRAW also triggers the pump', () => {
  const h = new Harness(1522);
  toDeployment(h);
  const A = h.state.initiative;
  const rider = spawn(h, A, 'Rider of the Tides');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rider]] });
  const e = new E(h.state);
  e.draw(A, 1);                                            // battle draws now fire 'draw' events
  e.settle();
  pass(h); pass(h);                                        // resolve the trigger
  assert.deepEqual(effStats(h, rider), [4, 4], '2/2 + 2/2 = 4/4');
  finishBattle(h);
  assert.deepEqual(effStats(h, rider), [2, 2], 'gone at regroup');
});

test("Rippleback Skulker: my column connects to a player → take a card from that player's bin", () => {
  const h = new Harness(1503);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sk = spawn(h, A, 'Rippleback Skulker');
  h.state.players[D]!.bin.push('Good Whale', 'Jelly');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sk]] });
  pass(h); pass(h);                                        // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);   // combat: unblocked, D loses 2 → trigger resolves at once → bin pick
  const dec = h.state.decision!;
  assert.equal(dec.kind, 'targets', 'R67: a declared target, not a mid-resolution pick');
  assert.equal(dec.seat, A, 'the ability controller picks');
  // only the DAMAGED player's bin is offered — the restriction reads the event
  assert.ok(dec.options.every(o => /No more targets|Player 1's bin/.test(o.label)),
    `only that player's bin: [${dec.options.map(o => o.label)}]`);
  decide(h, l => l.startsWith('Jelly'));
  assert.ok(h.state.players[A]!.hand.includes('Jelly'), "picked card → my hand");
  assert.deepEqual(h.state.players[D]!.bin, ['Good Whale'], 'only the picked card left the bin');
  assert.equal(h.state.players[D]!.life, 28, 'combat damage happened');
  finishBattle(h);
});

test('Seabed Shellcaster: SECOND nontoken spell this battle → each player recalls a unit (R14, [Switch1])', () => {
  const h = new Harness(1504);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Curio Drifter');
  const sc = spawn(h, D, 'Seabed Shellcaster');
  const d2 = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'fire', 6);                          // two Channeled Boons (rr / 2 each)
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // first nontoken spell: no trigger
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: d2 });
  pass(h); pass(h);
  assert.deepEqual(effStats(h, d2), [11, 9], 'Boon #1 resolved, no Shellcaster trigger');
  assert.ok(ent(h, sc) && ent(h, atk), 'nothing recalled yet');
  // second nontoken spell: trigger goes on the stack above it
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: d2 });
  pass(h); pass(h);                                        // resolve the trigger first
  const dec = h.state.decision!;
  assert.equal(dec.seat, D, 'D picks which of their two units to recall');
  decide(h, l => l === 'Seabed Shellcaster');
  assert.ok(h.state.players[D]!.hand.includes('Seabed Shellcaster'), "D's pick → hand");
  assert.ok(!ent(h, atk) && h.state.players[A]!.hand.includes('Curio Drifter'),
    "A's only unit auto-recalled");
  pass(h); pass(h);                                        // Boon #2 still resolves
  assert.deepEqual(effStats(h, d2), [15, 13], 'Boon #2 resolved after the trigger');
  finishBattle(h);
});

test('Shoreline Specter: after combat, may recall target ally → each opponent loses 2', () => {
  const h = new Harness(1505);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sp = spawn(h, A, 'Shoreline Specter');             // [Augment] text live when played normally
  const wh = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sp], [wh]] });
  pass(h); pass(h);                                        // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                        // combat (D takes 10) + afterCombat trigger
  assert.equal(h.state.decision!.kind, 'targets', 'trigger asks for its ally target');
  pick(h, { unit: wh });
  pass(h); pass(h);                                        // resolve → the "may" decision
  assert.equal(h.state.decision!.kind, 'payOrDecline');
  decide(h, (_, v) => v === true);
  assert.ok(!ent(h, wh) && h.state.players[A]!.hand.includes('Good Whale'), 'ally recalled');
  assert.equal(h.state.players[D]!.life, 30 - 10 - 2, 'combat 10 + Specter 2');
  finishBattle(h);
});

test('Soul Siphon: no life lost yet → X = 0, resolves cleanly, no unit', () => {
  const h = new Harness(1506);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Curio Drifter');
  giveResources(h, D, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Soul Siphon') });
  decide(h, (_, v) => JSON.stringify(v) === JSON.stringify({ player: A }));   // R67: at cast
  pass(h); pass(h);                                        // then it resolves
  assert.ok(!unitsOf(h, D).some(u => u.card === 'Unit Token'), 'X = 0 → no unit created');
  assert.ok(h.state.players[D]!.bin.includes('Soul Siphon'), 'spell → bin');
  assert.ok(h.log.some(l => l.includes('X = 0')), 'logged the empty result');
  finishBattle(h);
});

test('Soul Siphon: X = life the target player lost THIS battle (engine lifeLost ledger)', () => {
  const h = new Harness(1516);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Good Whale');                   // 7/5
  giveResources(h, D, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                        // combat: D loses 7 (ledgered by loseLife)
  assert.equal(h.state.players[D]!.life, 23);
  pass(h);                                                 // afterWindow: A passes → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Soul Siphon') });
  decide(h, (_, v) => JSON.stringify(v) === JSON.stringify({ player: D }));   // R67: at cast
  pass(h); pass(h);                                        // X = life D lost this battle
  const made = unitsOf(h, D).filter(u => u.card === 'Unit Token');
  assert.equal(made.length, 1, 'a unit was created');
  assert.deepEqual(effStats(h, made[0]!.id), [7, 7], 'X = 7 → a 7/7');
  assert.ok(h.state.players[D]!.bin.includes('Soul Siphon'), 'spell → bin');
  finishBattle(h);
});

test('Spawntender: creates an 8/8, then its own 2/2 body spawns (spell unit)', () => {
  const h = new Harness(1507);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Curio Drifter');
  giveResources(h, D, 'water', 10);                        // bbb / 7
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Spawntender') });
  pass(h); pass(h);
  const big = unitsOf(h, D).filter(u => u.card === 'Unit Token' && u.tokenStats?.[0] === 8);
  assert.equal(big.length, 1, 'one 8/8 token');
  assert.deepEqual(effStats(h, big[0]!.id), [8, 8]);
  const body = unitsOf(h, D).filter(u => u.card === 'Spawntender');
  assert.equal(body.length, 1, 'the spell unit body spawned');
  assert.deepEqual(effStats(h, body[0]!.id), [2, 2]);
  finishBattle(h);
});

test('Spell Excavation: plays a spell from your bin (cost paid); it is ERASED, not re-binned', () => {
  const h = new Harness(1508);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Curio Drifter');                // Arc's 2/2 victim
  h.state.players[D]!.bin.push('Luminous Arc');
  giveResources(h, D, 'water', 2);                         // Excavation: bb / 1
  giveResources(h, D, 'fire', 2);                          // Arc: r / 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Spell Excavation') });
  decide(h, l => l.startsWith('Luminous Arc'));            // R67: declared at cast
  pass(h); pass(h);                                        // Arc auto-targets the only unit
  assert.ok(!ent(h, atk), 'Luminous Arc dealt its 6 — the 2/2 died');
  assert.ok(!h.state.players[D]!.bin.includes('Luminous Arc'), 'unstable: erased, not binned');
  assert.ok(h.state.players[D]!.bin.includes('Spell Excavation'), 'Excavation itself → bin');
  assert.ok(h.log.some(l => l.includes('unstable — erased')), 'erase logged');
  finishBattle(h);
});

test('Surly Stalker: attacking ALONE doubles it until regroup; with company it does not', () => {
  const h = new Harness(1509);
  toDeployment(h);
  const A = h.state.initiative;
  const st = spawn(h, A, 'Surly Stalker');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[st]] });
  pass(h); pass(h);                                        // resolve the trigger
  assert.deepEqual(effStats(h, st), [8, 8], '4/4 doubled (amount live at resolution, R1)');
  finishBattle(h);
  assert.deepEqual(effStats(h, st), [4, 4], 'back to printed after regroup');

  const h2 = new Harness(1519);
  toDeployment(h2);
  const A2 = h2.state.initiative;
  const st2 = spawn(h2, A2, 'Surly Stalker');
  const ally = spawn(h2, A2, 'Curio Drifter');
  toNextBattle(h2, A2);
  h2.do({ type: 'declareAttack', seat: A2, columns: [[st2], [ally]] });
  pass(h2); pass(h2);
  assert.deepEqual(effStats(h2, st2), [4, 4], 'not alone → no trigger');
  finishBattle(h2);
});

test('Tempest Wrangler: {Alluring} 1/3; type-line [Augment] donates Alluring to a host', () => {
  const h = new Harness(1510);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const tw = spawn(h, p, 'Tempest Wrangler');
  assert.ok(ownAttrs(h, tw).has('Alluring'), 'played normally: Alluring');
  assert.deepEqual(effStats(h, tw), [1, 3]);
  assert.equal(getCard('Tempest Wrangler').timing, 'haste', '{Haste}: playable in the haste step');
  const host = spawn(h, p, 'Curio Drifter');
  giveResources(h, p, 'water', 1);                         // b / 1
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Tempest Wrangler'), hostId: host });
  assert.ok(ownAttrs(h, host).has('Alluring'), 'type-line [Augment] donates Alluring');
});

test('Tidal Menace: {Haste} 7/2 — playable in the haste step, resolves immediately (R18)', () => {
  const h = new Harness(1511);
  give(h, 0, 'Tidal Menace');
  giveResources(h, 0, 'water', 3);                         // b / 3
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone, 'haste step engaged (seat 0 holds a payable haste card)');
  h.do({ type: 'playCard', seat: 0, handIndex: handIdx(h, 0, 'Tidal Menace') });
  const tm = unitsOf(h, 0).find(u => u.card === 'Tidal Menace');
  assert.ok(tm, 'resolved immediately — no stack in the haste step');
  assert.deepEqual(effStats(h, tm!.id), [7, 2]);
  skipHasteStep(h);
  assert.equal(h.state.phase, 'battle');
});

test('Tidal Reversion: recalls one unit per player (no life loss)', () => {
  const h = new Harness(1512);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const wh = spawn(h, A, 'Good Whale');
  const dr = spawn(h, D, 'Curio Drifter');
  giveResources(h, D, 'water', 2);                         // bb / 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tidal Reversion') });
  // R67: both targets are declared at cast, one per player
  pick(h, { unit: wh });
  notOffered(h, { unit: wh }, 'already chosen');
  pick(h, { unit: dr });
  pass(h); pass(h);
  assert.ok(!ent(h, wh) && !ent(h, dr), 'one unit per player recalled');
  assert.ok(h.state.players[A]!.hand.includes('Good Whale'));
  assert.ok(h.state.players[D]!.hand.includes('Curio Drifter'));
  assert.equal(h.state.players[A]!.life, 30);
  assert.equal(h.state.players[D]!.life, 30);
  finishBattle(h);
});

test('Tidelurker: a player dealt combat damage → create a 2/2 ([Switch1])', () => {
  const h = new Harness(1513);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const tl = spawn(h, D, 'Tidelurker');
  const wh = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  finishBattle(h);                                         // unblocked: D takes 7 → trigger
  assert.equal(h.state.players[D]!.life, 23, 'combat damage landed');
  const made = unitsOf(h, D).filter(u => u.card === 'Unit Token' && u.tokenStats?.[0] === 2);
  assert.equal(made.length, 1, 'one 2/2 created');
  assert.deepEqual(effStats(h, made[0]!.id), [2, 2]);
  assert.ok(ent(h, tl), 'Tidelurker still in play');
});

test('Tiderunner Initiate: played during battle, may join an open formation spot', () => {
  const h = new Harness(1514);
  toDeployment(h);
  const A = h.state.initiative;
  const wh = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'water', 1);                         // b / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Tiderunner Initiate') });
  pass(h); pass(h);                                        // unit resolves, spawns → trigger stacked
  pass(h); pass(h);                                        // resolve trigger → spot pick
  const dec = h.state.decision!;
  assert.equal(dec.seat, A);
  decide(h, l => l.includes('behind Good Whale'));
  const tid = unitsOf(h, A).find(u => u.card === 'Tiderunner Initiate')!;
  assert.ok(h.state.battle!.columns[0]!.includes(tid.id), 'joined column 1 behind the whale');
  finishBattle(h);
  assert.equal(h.state.players[1 - A]!.life, 30 - 9, 'the joined column dealt 7+2');
});

test('Tides of the Cosmos: reveal 8, play up to two with total cost ≤ 8 for free, recycle the rest', () => {
  const h = new Harness(1515);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Curio Drifter');
  giveResources(h, D, 'water', 11);                        // bbb / 8
  toNextBattle(h, A);
  // a known deck (set after all draws so nothing shifts it)
  h.state.sharedDeck = [
    'Tidal Menace', 'Curio Drifter', 'Good Whale', 'Jelly', 'Ignis Sprite',
    'Dune Drifter', 'Whispering Mantid', 'Lonely Forager',
    'Rune Channeler', 'Rune Channeler',
  ];
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tides of the Cosmos') });
  pass(h); pass(h);                                        // resolve → pick #1
  decide(h, l => l.startsWith('Tidal Menace'));            // cost 3
  const dec2 = h.state.decision!;                          // pick #2: budget 5 left
  assert.ok(!dec2.options.some(o => o.label.startsWith('Good Whale')),
    'Good Whale [6] exceeds the remaining budget of 5');
  decide(h, l => l.startsWith('Curio Drifter'));           // cost 1
  assert.ok(unitsOf(h, D).some(u => u.card === 'Tidal Menace'), 'played free');
  assert.ok(unitsOf(h, D).some(u => u.card === 'Curio Drifter'), 'played free');
  assert.deepEqual(h.state.sharedDeck, [
    'Rune Channeler', 'Rune Channeler',                    // untouched remainder
    'Good Whale', 'Jelly', 'Ignis Sprite', 'Dune Drifter', // the six unchosen, recycled
    'Whispering Mantid', 'Lonely Forager',
  ], 'the rest recycled to the bottom in revealed order');
  assert.ok(h.state.players[D]!.bin.includes('Tides of the Cosmos'), 'spell → bin');
  finishBattle(h);
});

test('Upheaval: each player recalls two units; 4+ recalled → it repeats (then stops)', () => {
  const h = new Harness(1517);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const a1 = spawn(h, A, 'Good Whale');
  const a2 = spawn(h, A, 'Whispering Mantid');
  const d1 = spawn(h, D, 'Curio Drifter');
  const d2 = spawn(h, D, 'Dune Drifter');
  giveResources(h, D, 'water', 4);                         // b / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Upheaval') });
  pass(h); pass(h);                                        // resolve (≤2 units each: no choices)
  assert.ok(!ent(h, a1) && !ent(h, a2) && !ent(h, d1) && !ent(h, d2), 'all four recalled');
  assert.ok(h.state.players[A]!.hand.includes('Good Whale'));
  assert.ok(h.state.players[A]!.hand.includes('Whispering Mantid'));
  assert.ok(h.state.players[D]!.hand.includes('Curio Drifter'));
  assert.ok(h.state.players[D]!.hand.includes('Dune Drifter'));
  assert.ok(h.log.some(l => l.includes('repeat')), '4 recalls → repeated (and found nothing more)');
  finishBattle(h);
});

test('Vaporweave Eidolon: [zero]: recall me — a free activated self-recall', () => {
  const h = new Harness(1518);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const ve = spawn(h, p, 'Vaporweave Eidolon');
  assert.deepEqual(effStats(h, ve), [4, 3]);
  h.do({ type: 'activateAbility', seat: p, entityId: ve, abilityIndex: 0 });
  assert.ok(!ent(h, ve), 'left play');
  assert.ok(h.state.players[p]!.hand.includes('Vaporweave Eidolon'), 'back to hand');
});

test('Water Resource: registered on printed data (2/0, [b]); behavior parked', () => {
  const def = getCard('Water Resource');
  assert.equal(def.power, 2);
  assert.equal(def.toughness, 0);
  assert.equal(def.cost, 'b');
  assert.equal(def.mana, 0);
  // it never crashes the engine: spawned (until resource-card play exists),
  // its 0 defense kills it via the state-based check
  const h = new Harness(1520);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const e = new E(h.state);
  const u = e.spawnUnit(p, 'Water Resource', e.homeRegion(p));
  e.settle();
  assert.ok(!ent(h, u.id), '0-toughness body dies immediately');
  assert.ok(h.state.players[p]!.bin.includes('Water Resource'));
});

test('Water Resource: activation trigger + Shard (PARKED: resource cards / activation events / Shard kind missing)', { todo: true }, () => {
  // needs: resource cards playable as resources, 'resourceActivated' dispatched
  // to trigger listeners, and a 'Shard' resource kind ("spawns dormant").
});

test('Xenopod Progenitor: another card enters a hand in battle → may pay [1] for a 2/2', () => {
  const h = new Harness(1521);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const xp = spawn(h, D, 'Xenopod Progenitor');
  const dr = spawn(h, D, 'Curio Drifter');
  const wh = spawn(h, A, 'Good Whale');
  giveResources(h, D, 'water', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  // a card enters D's hand mid-battle
  const e = new E(h.state);
  e.recall(h.state.entities[dr]!);
  e.settle();
  pass(h); pass(h);                                        // resolve the trigger
  assert.equal(h.state.decision!.kind, 'payOrDecline');
  assert.equal(h.state.decision!.seat, D);
  decide(h, (_, v) => v === true);
  const made = unitsOf(h, D).filter(u => u.card === 'Unit Token' && u.tokenStats?.[0] === 2);
  assert.equal(made.length, 1, 'paid [1] → a 2/2');
  assert.equal(new E(h.state).openMana(D), 0, 'the [1] was paid');
  assert.ok(ent(h, xp), 'Xenopod still in play');
  finishBattle(h);
});

test('Xenopod Progenitor: a battle DRAW also triggers it (pay [1] → 2/2)', () => {
  const h = new Harness(1523);
  toDeployment(h);
  const A = h.state.initiative;
  const xp = spawn(h, A, 'Xenopod Progenitor');
  giveResources(h, A, 'water', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[xp]] });
  const e = new E(h.state);
  e.draw(A, 1);                                            // a drawn card is never the carrier
  e.settle();
  pass(h); pass(h);                                        // resolve the trigger
  assert.equal(h.state.decision!.kind, 'payOrDecline');
  decide(h, (_, v) => v === true);
  const made = unitsOf(h, A).filter(u => u.card === 'Unit Token' && u.tokenStats?.[0] === 2);
  assert.equal(made.length, 1, 'paid [1] → a 2/2');
  finishBattle(h);
});
