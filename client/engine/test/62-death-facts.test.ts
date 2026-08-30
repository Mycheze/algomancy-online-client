/* R70 — facts about a dying unit ride the EVENT, not a lookup afterwards.
 *
 * destroy() deletes the entity as its second statement, before the 'died'
 * event is even built, so by the time a queued trigger RESOLVES there is no
 * `this.entity(sourceId)` left to ask anything. Everything a listener could
 * want therefore has to be on the event (or, for the region, on the queued
 * trigger). Two live bugs came out of that, and both are pinned here:
 *
 *  1. R12 violation — processTriggerQueue() resolved a trigger in
 *     `entity(sourceId)?.region ?? actionRegion(controller)`. For a death
 *     trigger the entity is ALWAYS gone, so it always took the fallback: the
 *     controller's action region, not the region the unit died in. That
 *     offered a target standing in a different region while withholding the
 *     ally standing beside the corpse.
 *  2. Rules logic read off the LOG MESSAGE — `!ev.msg.includes('token:
 *     erased')` was how four cards asked "was that a nontoken unit?" and
 *     `ev.msg.includes('is sacrificed')` was how Ghord asked for the verb.
 *     A card whose death logs different text walks straight through a string
 *     match. `token`, `verb`, `owner` and `to` are now event data.
 *
 * Seeds 6200-6299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { registerSynthetic, type Printed } from '../src/cards/dsl.ts';
import { ent, offered, spawn, toDeployment, withE as whiteBox } from './util.ts';
import type { EngineEvent } from '../src/types.ts';

const unit = (name: string, power: number, toughness: number, extra: Partial<Printed> = {}): Printed => ({
  name, cost: '', mana: 0, power, toughness, type: 'Test Unit', kind: 'unit',
  timing: 'deploy', attrs: [], virus: false, burst: false,
  augmentAttrs: [], text: '', image: '', ...extra,
});

registerSynthetic(unit('T62 Ally', 2, 2), {});

// "When I die, target ally gains +1/+1 until regroup." The effect is beside
// the point — what matters is WHICH allies the target menu offers, which is
// the region processTriggerQueue() decided to resolve the trigger in.
registerSynthetic(unit('T62 Mourner', 1, 1), {
  abilities: [{
    type: 'triggered', events: ['died'], self: true,
    label: 'target ally gains +1/+1',
    effect: {
      targets: { what: 'allyUnit', prompt: 'T62 Mourner: target ally' },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (t && 'id' in (t as object)) g.addTemp(t as never, 1, 1);
      },
    },
  }],
});

const died = (h: Harness): EngineEvent => h.events.filter(ev => ev.type === 'died').at(-1)!;

// ── 1. the region a unit died in ──────────────────────────────────────

test('R70: a "when I die" trigger resolves in the region the unit DIED in, not the controller\'s', () => {
  const h = new Harness(6200);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const homeR = h.q.homeRegion(P);
  const awayR = 1 - homeR;

  const atHome = spawn(h, P, 'T62 Ally');                   // stands at home
  let away = 0, mourner = 0;
  whiteBox(h, e => {
    away = e.spawnUnit(P, 'T62 Ally', awayR).id;            // …and one over there
    mourner = e.spawnUnit(P, 'T62 Mourner', awayR).id;
  });
  assert.equal(ent(h, away)!.region, awayR);

  whiteBox(h, e => { e.destroy(e.entity(mourner)!, 'dies'); });
  assert.ok(h.state.decision, 'the death trigger is asking for its target');
  // R12: only the ally standing in the region the Mourner died in exists to it
  assert.deepEqual(offered(h), [JSON.stringify({ unit: away })],
    'the ally in the death region — and ONLY it — is on the menu');
  assert.ok(!offered(h).includes(JSON.stringify({ unit: atHome })),
    "the controller's home region is not where this unit died");
});

// ── 2. the facts themselves ───────────────────────────────────────────

test('R70: the death event carries token, verb, owner, region and destination', () => {
  const h = new Harness(6201);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const u = spawn(h, P, 'T62 Ally');
  whiteBox(h, e => { e.destroy(e.entity(u)!, 'is sacrificed'); });
  const ev = died(h);
  assert.equal(ev.data!['card'], 'T62 Ally');
  assert.equal(ev.data!['token'], false, 'a printed card is not a token');
  assert.equal(ev.data!['verb'], 'is sacrificed', 'the verb, so nobody has to read the log line');
  assert.equal(ev.data!['owner'], P);
  assert.equal(ev.data!['seat'], P, 'seat is the CONTROLLER (unchanged)');
  assert.equal(ev.data!['region'], h.q.homeRegion(P));
  assert.equal(ev.data!['to'], 'bin');
});

test('R70: a dying TOKEN says so on the event (it used to be a log-message match)', () => {
  const h = new Harness(6202);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  whiteBox(h, e => {
    const t = e.spawnUnit(P, 'T62 Ally', e.homeRegion(P), { token: true });
    e.destroy(t, 'dies');
  });
  const ev = died(h);
  assert.equal(ev.data!['token'], true);
  assert.equal(ev.data!['to'], 'bin', 'R69: a token does reach a bin before it is erased');
  assert.ok(!ev.msg.includes('token: erased'),
    'and the old string-matched phrase is gone — which is exactly why the flag exists');
});

// R137 (2026-08-24) INVERTS the destination half of this test in place. It
// used to be named "…says its destination was the erased pile" and assert
// `to === 'erased'`, with "nothing reached a bin" as the reason. The owner
// ruled that an Unstable death goes through the bin exactly as a token's does,
// so `to` is 'bin' for EVERY death now — it reports where the card is during
// the event window, which is the only thing a listener can act on. The bin
// assertion below is unchanged and now means something different: not "it
// never went there" but "it does not STAY there".
test('R137: an Unstable death says BIN, like a token, and still DIES (R70 inverted)', () => {
  const h = new Harness(6203);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const u = spawn(h, P, 'T62 Ally');
  whiteBox(h, e => {
    e.attachMod(e.entity(u)!, 'T62 Ally', P, 'augment');
    e.destroy(e.entity(u)!, 'dies');
  });
  const ev = died(h);
  assert.equal(ev.type, 'died', 'Unstable replaces the BIN, not the death (Caleb 2025-04-08)');
  assert.equal(ev.data!['to'], 'bin',
    'R137: the same answer a dying token gives — it really is in a bin while this fires');
  assert.deepEqual(h.state.players[P]!.bin, [], 'and the sweep took it back out again');
  const erased = h.events.filter(x => x.type === 'erased');
  assert.ok(erased.some(x => x.data?.['card'] === 'T62 Ally' && x.data?.['from'] === 'bin'),
    'the erase is recorded against the BIN it was swept out of');
});

// ── 3. the recall side of the same idea ───────────────────────────────

test('R70: a recall event says where the card went', () => {
  const h = new Harness(6204);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const u = spawn(h, P, 'T62 Ally');
  whiteBox(h, e => { e.recall(e.entity(u)!); });
  const ev = h.events.filter(x => x.type === 'despawned').at(-1)!;
  assert.equal(ev.data!['to'], 'hand');
  assert.equal(ev.data!['token'], false);

  const h2 = new Harness(6205);
  toDeployment(h2);
  const Q = h2.state.deployPlayer!;
  whiteBox(h2, e => {
    const t = e.spawnUnit(Q, 'T62 Ally', e.homeRegion(Q), { token: true });
    e.recall(t);
  });
  const ev2 = h2.events.filter(x => x.type === 'despawned').at(-1)!;
  // R69, extended to the hand 2026-08-22: a recalled token REACHES the hand
  // and is erased out of it by the state-based sweep, so `to` is 'hand' for it
  // too — that is the whole point of the ruling ("it would trigger any 'enters
  // hand' stuff").
  assert.equal(ev2.data!['to'], 'hand', 'a recalled token enters the hand before it is erased');
  assert.equal(ev2.data!['token'], true);
  assert.ok(!h2.state.players[Q]!.hand.includes('T62 Ally'),
    'and it does not stay there — the sweep took it back out');
  const erased = h2.events.filter(x => x.type === 'erased').at(-1)!;
  assert.equal(erased.data!['from'], 'hand', 'the erase is recorded against the HAND');
  assert.equal(erased.data!['card'], 'T62 Ally');
});
