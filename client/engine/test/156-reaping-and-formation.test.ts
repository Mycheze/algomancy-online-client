/**
 * R184 — TWO PRIMITIVES THE POOL'S PRINTED TEXT WAS ALREADY ASKING FOR.
 *
 * ── 1. {Reaping} IS A KILL RIDER, NOT A DAMAGE RIDER ────────────────────
 *
 * {Reaping} lived in `E.dealEffectDamageAll`, so it could only ever be paid
 * out by damage. Two of the four {Reaping} cards in the pool do not kill with
 * damage at all:
 *
 *   Invasive Reassignment  "Switch the power and defense of target unit
 *                           until regroup."     (a 0/4 becomes a lethal 4/0)
 *   Noxious Demise         "Put a -1/-1 counter on target unit."
 *
 * Both hand-rolled the rider in card code to compensate — which worked, and
 * is exactly the shape this repo keeps paying for: a printed attribute
 * honoured by two cards individually means the THIRD card to want it silently
 * does without. R184 moved the attribute onto the engine's kill diff and
 * deleted both hand-rolls.
 *
 * ⚠ THE SCOPE IS A PRINTED-TEXT QUESTION, and the brief that raised this said
 * to read {Reaping}'s reminder text in `printed.json`. THERE IS NONE — none of
 * the four {Reaping} cards (Flame of History, Seismomancy, Invasive
 * Reassignment, Noxious Demise) prints a reminder at all. `ui/glossary.ts` is
 * the repo's own statement of it and is what R184 read:
 *
 *   {Reaping}     "When it KILLS a unit, its controller draws a card."
 *   {Afflicting}  "When an afflicting source KILLS one or more units, those
 *                  units' controllers gain a rot."   (printed, Umbral Decay)
 *   {Blessed}     "DAMAGE dealt by a blessed source causes its controller to
 *                  gain that much life."             (printed, four cards)
 *
 * One word apart on purpose, exactly as {Deadly}/{Lethal} are in
 * `109-attr-channel-conformance`. So the hook was built ONCE, for the set of
 * attributes the pool describes as firing on a kill — and the last test in
 * this section derives that set from the wording rather than trusting a list.
 *
 * ── 2. "TARGET FORMATION" CAN BE TARGETED ───────────────────────────────
 *
 * Galactic Germination prints "Create a 1/1 unit for each unit in target
 * formation" and `TargetRef` had no formation arm, so the engine proxied it:
 * it targeted a UNIT and took the whole grid side containing it.
 *
 * RULED 2026-08-25 (owner): "target formation" is THE WHOLE SIDE — a player's
 * entire formation in that region, every unit arrayed there. So the proxy's
 * COUNT was right and R184 does not change it; what it changes is that the
 * card no longer lies about what it targets. The arm is real, and the tests
 * below check each consumer that was wired: the candidate list, the label,
 * `targetStillLegal`, the `'targeted'` event (R163's `seat` + `kind`), and
 * retargeting through Gravitational Correction.
 *
 * Seeds 15600-15699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import '../src/cards/registry.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import {
  ent, finishBattle, give, giveResources, offered, pass, pick, spawn, toDeployment,
  toNextBattle, unitsOf,
} from './util.ts';
import { AUTHORED_GLOSSARY } from '../ui/glossary.ts';
import type { EntityId, Seat, TargetRef } from '../src/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** how many {Reaping} payouts the log has seen — the count matters as much as
 * the fact: the diff must not pay for a kill the damage site already paid. */
const reapDraws = (h: Harness): number => h.log.filter(l => l.startsWith('Reaping:')).length;

const rotOf = (h: Harness, seat: Seat): number => h.state.players[seat]!.rot ?? 0;

/** a battle with `atk` attacking, priority with whoever is named, ready for a
 * {Battle} spell to be played. */
function battle(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  return { h, A, D };
}

// ═══════════════════════════════════════════════════════════════════════
// 1. {Reaping} ON A NON-DAMAGE KILL
// ═══════════════════════════════════════════════════════════════════════

test('Invasive Reassignment: a kill by a STAT SWAP pays {Reaping} — off the printed attribute, not card code', () => {
  const { h, A, D } = battle(15600);
  const atk = spawn(h, A, 'Unit Token');
  const eel = spawn(h, D, 'Galerider Eel');                   // 0/4 → swapped to a lethal 4/0
  giveResources(h, A, 'metal', 2);                            // mm / 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Invasive Reassignment') });
  pick(h, { unit: eel });
  const hand = h.state.players[A]!.hand.length;
  pass(h); pass(h);
  assert.ok(!ent(h, eel), 'the swapped 4/0 died at the death check — no damage was dealt to it');
  assert.equal(h.state.players[A]!.hand.length, hand + 1, '{Reaping}: the kill drew the caster a card');
  assert.equal(reapDraws(h), 1, 'exactly one payout — the kill diff, not a hand-rolled rider as well');
  // the claim the fix rests on: nothing about this is scripted on the card
  assert.deepEqual(getCard('Invasive Reassignment').attrs, ['Reaping'],
    'the draw is the printed attribute; the card def carries no draw of its own');
  finishBattle(h);
});

test('Noxious Demise: a kill by a -1/-1 COUNTER pays {Reaping} — off the printed attribute, not card code', () => {
  const { h, A, D } = battle(15601);
  const atk = spawn(h, A, 'Unit Token');                      // 1/1 — one counter is lethal
  giveResources(h, D, 'wood', 2);                             // gg / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                    // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Noxious Demise') });
  pick(h, { unit: atk });
  const hand = h.state.players[D]!.hand.length;
  pass(h); pass(h);
  assert.ok(!ent(h, atk), 'the 1/1 died to the counter — no damage was dealt to it');
  assert.equal(h.state.players[D]!.hand.length, hand + 1, '{Reaping}: the caster drew');
  assert.equal(reapDraws(h), 1, 'exactly once');
  assert.deepEqual(getCard('Noxious Demise').attrs, ['Reaping'],
    'the draw is the printed attribute; the card def carries no draw of its own');
  finishBattle(h);
});

test('Invasive Reassignment: a swap that kills NOBODY draws nothing — the diff is a kill diff', () => {
  const { h, A, D } = battle(15602);
  const atk = spawn(h, A, 'Unit Token');
  const big = spawn(h, D, 'Lurking Slimebeast');              // 8/3 → 3/8, survives
  giveResources(h, A, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Invasive Reassignment') });
  pick(h, { unit: big });
  const hand = h.state.players[A]!.hand.length;
  pass(h); pass(h);
  assert.ok(ent(h, big), 'a 3/8 is very much alive');
  assert.equal(h.state.players[A]!.hand.length, hand, 'nothing died, so nothing was reaped');
  assert.equal(reapDraws(h), 0);
  finishBattle(h);
});

test('Seismomancy: a kill by DAMAGE still pays {Reaping} exactly once — the diff never double-pays', () => {
  // The regression the fix could most easily have introduced: the damage-site
  // rider and the kill diff both firing for one dead unit.
  const { h, A, D } = battle(15603);
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Unit Token');                   // 1/1, 3 damage kills it
  giveResources(h, A, 'earth', 3);                            // ee / 3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Seismomancy') });
  pick(h, { unit: victim });
  const hand = h.state.players[A]!.hand.length;
  pass(h); pass(h);
  assert.ok(!ent(h, victim), 'killed by damage');
  assert.equal(h.state.players[A]!.hand.length, hand + 1, 'ONE card, not two');
  assert.equal(reapDraws(h), 1, 'one payout for one kill, however it was reached');
  finishBattle(h);
});

// ── the negative controls ───────────────────────────────────────────────
//
// Without these you cannot tell a GENERAL hook from a PERMISSIVE one: a diff
// that paid every rider on every kill would pass every test above.

test('{Blessed} does not fire on a non-damage kill — Noxious Demise carrying a Blessed Thing virus', () => {
  // The sharpest control available in the pool: ONE source, ONE kill, two
  // attributes whose reminders are one word apart. Blessed Thing is a
  // {Virus} [Augment] {Blessed}, so R79 lets it donate {Blessed} to a spell
  // sitting on the stack — and the spell kills with a counter, not damage.
  const { h, A, D } = battle(15604);
  const atk = spawn(h, A, 'Unit Token');                      // 1/1
  giveResources(h, D, 'wood', 2);                             // Noxious Demise gg/1
  giveResources(h, D, 'light', 2);                            // Blessed Thing l/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Noxious Demise') });
  pick(h, { unit: atk });
  const item = h.state.stack.find(i => i.card === 'Noxious Demise')!;
  pass(h);                                                    // A declines to answer
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Blessed Thing'), hostStack: item.id });
  pass(h); pass(h);                                           // the virus resolves onto the spell
  // the control is only worth anything if the attribute really is ON the item
  const live = new E(h.state);
  const attrs = live.itemAttrs(live.s.stack.find(i => i.card === 'Noxious Demise')!);
  assert.ok(attrs.has('Blessed'), 'R79: the virus donated {Blessed} to the spell');
  assert.ok(attrs.has('Reaping'), 'and the spell still prints {Reaping}');
  const hand = h.state.players[D]!.hand.length;
  const life = h.state.players[D]!.life;
  pass(h); pass(h);
  assert.ok(!ent(h, atk), 'killed by the counter');
  assert.equal(h.state.players[D]!.hand.length, hand + 1,
    '{Reaping} is KILL-scoped ("when it kills a unit") — it fires');
  assert.equal(h.state.players[D]!.life, life,
    '{Blessed} is DAMAGE-scoped ("damage dealt by a blessed source") — a kill that dealt '
    + 'no damage gains nothing, and a hook that paid every rider on every kill would gain here');
  finishBattle(h);
});

test('Umbral Decay: an {Afflicting} counter-kill rots and draws NOTHING — the diff is attribute-gated', () => {
  const { h, A, D } = battle(15605);
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Unit Token');                   // 1/1: two counters kill it
  giveResources(h, A, 'dark', 1);                             // d / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Umbral Decay') });
  pick(h, { unit: victim });
  const hand = h.state.players[A]!.hand.length;
  pass(h); pass(h);
  assert.ok(!ent(h, victim), 'killed purely by counters');
  assert.equal(rotOf(h, D), 1, 'R48: {Afflicting} rides the same diff and still fires');
  assert.equal(h.state.players[A]!.hand.length, hand,
    'Umbral Decay is not {Reaping} — the hook pays only the riders the SOURCE carries');
  assert.equal(reapDraws(h), 0);
  finishBattle(h);
});

test('Noxious Demise: {Reaping} without {Afflicting} draws and rots NOBODY — the other half of the gate', () => {
  const { h, A, D } = battle(15606);
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, D, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Noxious Demise') });
  pick(h, { unit: atk });
  pass(h); pass(h);
  assert.ok(!ent(h, atk));
  assert.equal(reapDraws(h), 1, '{Reaping} fired');
  assert.equal(rotOf(h, A), 0, 'and {Afflicting} did not — Noxious Demise does not carry it');
  assert.equal(rotOf(h, D), 0);
  finishBattle(h);
});

test('the KILL-scoped attribute set is DERIVED from the pool wording, not hardcoded (R184)', () => {
  // The same derivation 109-attr-channel-conformance does for the source/unit
  // split, one question over: does the reminder say the attribute fires when
  // its source KILLS ("kills"), or when it DAMAGES?
  //
  // ⚠ {Reaping} has no PRINTED reminder — none of its four cards carries one —
  // so `ui/glossary.ts` is scraped alongside printed.json. That is not a
  // shortcut: the glossary is what the client shows a player who asks what
  // {Reaping} does, so it is the statement of the attribute this repo has.
  // the ATTRIBUTES, taken off the card pool exactly as 109 takes them, so a
  // glossary entry that is not an attribute (Rot, Debt, Cache) cannot be swept
  // in and a new attribute needs no edit here.
  const known = new Set<string>();
  for (const name of allCardNames()) {
    const def = getCard(name);
    for (const a of def.attrs ?? []) known.add(a);
    for (const a of def.augmentAttrs ?? []) known.add(a);
    for (const m of def.statics ?? []) for (const a of m.attrs ?? []) known.add(a);
  }
  const printed = JSON.parse(fs.readFileSync(
    path.join(HERE, '..', 'src', 'cards', 'printed.json'), 'utf8')) as
    Record<string, { text?: string }>;
  const reminders: string[] = [];
  for (const c of Object.values(printed)) {
    for (const m of (c.text ?? '').matchAll(/\{i\}\(([^)]*)\)/g)) reminders.push(m[1]!);
  }
  // ⚠ THE AUTHORED TABLE, IMPORTED — not the source file, REGEXED.
  //
  // This used to read ui/glossary.ts as text and pull `term: 'X' … text: '…'`
  // back out with a pattern, which made a comment in that file's own header
  // ("do not reword without reading 156") the only thing standing between a
  // tidy-up and a silent behaviour change here. R248 then split every row in
  // two, and the regex survived purely because the authored literals happened
  // not to move; R252 added a second displacing channel and it survived again
  // for the same accidental reason. `AUTHORED_GLOSSARY` is exported precisely
  // so this can ask for the thing it wants — the COMPLETE rule, before any
  // printed or manual reminder displaces it, which is what E.KILL_RIDERS has
  // to be derived from — instead of pattern-matching the file that holds it.
  const byTerm = new Map<string, string[]>();
  for (const e of AUTHORED_GLOSSARY) if (known.has(e.term)) byTerm.set(e.term, [e.text]);
  for (const r of reminders) {
    for (const [term, texts] of byTerm) {
      if (new RegExp(`\\b${term}\\b`, 'i').test(r)) texts.push(r);
    }
  }
  // the scrape itself, asserted first: if it silently found nothing, every
  // classification below would be vacuously "damage-scoped".
  assert.ok(byTerm.has('Reaping') && byTerm.has('Afflicting') && byTerm.has('Blessed'),
    'the glossary scrape found no attributes at all — the derivation is broken, not the pool');
  assert.ok(byTerm.get('Afflicting')!.some(t => t.includes('afflicting source')),
    "Afflicting's PRINTED reminder (Umbral Decay) was not picked up");
  assert.equal(byTerm.get('Reaping')!.length, 1,
    '{Reaping} has NO printed reminder on any of its four cards — if that ever changes, '
    + 'the printed text is the spec and this derivation should be reading it');

  // The classification, one word at a time:
  //   "kills … unit"  — the SOURCE is the subject and a UNIT is the object.
  // {Deadly} says "will KILL a unit" (a damage modifier, not a rider on a
  // kill) and {Lethal} says "KILLS a PLAYER" — neither is this.
  const KILL_TRIGGER = /\bkills\b(?:(?!\bkills\b)[^.]){0,60}?\bunits?\b/i;
  const killScoped = [...byTerm].filter(([, texts]) => texts.some(t => KILL_TRIGGER.test(t)))
    .map(([term]) => term).sort();
  assert.deepEqual(killScoped, ['Afflicting', 'Reaping'],
    'the attributes whose reminder says its SOURCE "kills" — one hook serves exactly these');
  assert.deepEqual([...E.KILL_RIDERS].sort(), killScoped,
    'E.KILL_RIDERS must BE that derived set: an attribute the pool describes as firing on a '
    + 'kill and that is not on the kill diff is another Noxious Demise waiting to be '
    + 'hand-rolled, and one on the diff that the pool does not describe that way is the '
    + 'permissive hook these tests exist to rule out');
  for (const damageScoped of ['Blessed', 'Resonant', 'Deadly']) {
    assert.ok(!killScoped.includes(damageScoped),
      `{${damageScoped}} reads as damage-scoped and must stay at the damage site`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 2. "TARGET FORMATION" AS A REAL TARGET
// ═══════════════════════════════════════════════════════════════════════

/**
 * A battle with a three-unit ATTACKING formation ([u1,u2] and [u3] — two
 * columns, three units) and a one-unit BLOCKING formation, so "the whole side"
 * and "a column" and "a unit" are three different numbers and the count can
 * only come out right for one reading of the ruling.
 */
function formations(seed: number): {
  h: Harness; A: Seat; D: Seat; atkUnits: EntityId[]; blocker: EntityId;
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const u1 = spawn(h, A, 'Unit Token');
  const u2 = spawn(h, A, 'Unit Token');
  const u3 = spawn(h, A, 'Unit Token');
  const blocker = spawn(h, D, 'Good Whale');                  // 7/5, survives everything here
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[u1, u2], [u3]] });
  pass(h); pass(h);                                           // through the attack window
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  return { h, A, D, atkUnits: [u1, u2, u3], blocker };
}

const germ = (h: Harness, seat: Seat): void => {
  giveResources(h, seat, 'water', 1);
  giveResources(h, seat, 'wood', 2);                          // bg / 3
  h.do({ type: 'playCard', seat, handIndex: give(h, seat, 'Galactic Germination') });
};

const oneOnes = (h: Harness, seat: Seat): number =>
  unitsOf(h, seat).filter(u => u.token && u.card === 'Unit Token'
    && u.region === h.state.battle!.region).length;

test('Galactic Germination: "target formation" is THE WHOLE SIDE — three units across two columns, three 1/1s', () => {
  const { h, A } = formations(15610);
  germ(h, A);
  const before = oneOnes(h, A);
  pick(h, { formation: A });
  pass(h); pass(h);
  assert.equal(oneOnes(h, A) - before, 3,
    "the owner ruled (2026-08-25) that a formation is a player's ENTIRE side: 3 units in "
    + '2 columns is 3, not the 2 of the column that was aimed at and not 1');
  finishBattle(h);
});

test('Galactic Germination: the OTHER formation is the blocking side, counted the same way', () => {
  const { h, A, D } = formations(15611);
  germ(h, A);
  const before = oneOnes(h, A);
  pick(h, { formation: D });
  pass(h); pass(h);
  assert.equal(oneOnes(h, A) - before, 1, "one blocker in D's formation, one 1/1");
  finishBattle(h);
});

test('Galactic Germination: the formation is read LIVE at resolution — a mid-battle JOIN is counted', () => {
  // R27/R72: the ref names the SEAT, never a grid snapshot, precisely because
  // the grid moves between cast and resolution. Both directions in one board:
  // one attacker dies (the second column empties and closes up) and two more
  // join in new columns, the way card code that splices `b.columns` does it.
  // Three at cast, four at resolution — a number no frozen list could give,
  // and not the size of any one column either.
  const { h, A, atkUnits } = formations(15612);
  germ(h, A);
  const before = oneOnes(h, A);
  assert.equal(new E(h.state).formationUnits(A).length, 3, 'three in the formation at CAST');
  pick(h, { formation: A });
  const e = new E(h.state);
  e.destroy(e.entity(atkUnits[2]!)!, 'dies');                 // the second column empties
  const j1 = e.spawnUnit(A, 'Unit Token', e.s.battle!.region);
  const j2 = e.spawnUnit(A, 'Unit Token', e.s.battle!.region);
  e.s.battle!.columns.push([j1.id, j2.id]);                   // …and a new column joins
  e.settle();
  h.state = e.s;
  assert.equal(new E(h.state).formationUnits(A).length, 4, 'four in it at RESOLUTION');
  pass(h); pass(h);
  assert.equal(oneOnes(h, A) - before, 4,
    'four 1/1s — one per unit in the formation AS IT STANDS AT RESOLUTION, not the '
    + 'three that were in it when the spell was cast (the joiners are spawned nontoken, '
    + 'so only the created 1/1s are counted here)');
  finishBattle(h);
});

test('Galactic Germination: the target IS a formation — the menu offers formations, and nothing else', () => {
  const { h, A, D } = formations(15613);
  germ(h, A);
  assert.deepEqual(offered(h).map(s => JSON.parse(s) as TargetRef),
    [{ formation: A }, { formation: D }],
    'two sides, attacker first — and NOT the four units the unit-proxy used to offer');
  const e = new E(h.state);
  assert.match(e.targetLabel({ formation: A }), /formation \(attacking\)/,
    'the option says which side it is, because that is the whole choice');
  assert.match(e.targetLabel({ formation: D }), /formation \(blocking\)/);
  assert.ok(e.targetStillLegal({ formation: A }), 'a formation is legal while its battle runs');
  pick(h, { formation: A });
  pass(h); pass(h);
  finishBattle(h);
});

test("Galactic Germination: the 'targeted' event names the formation, carrying R163's seat and kind", () => {
  const { h, A } = formations(15614);
  germ(h, A);
  pick(h, { formation: A });
  const evs = h.events.filter(e => e.type === 'targeted');
  assert.equal(evs.length, 1, 'one target, one dispatch — a formation target IS dispatched');
  assert.equal(evs[0]!.data!['formation'], A, 'the event says WHICH formation');
  assert.equal(evs[0]!.data!['seat'], A, "R163: and whose item did it…");
  assert.equal(evs[0]!.data!['kind'], 'spell', '…and what kind of item it was');
  assert.equal(evs[0]!.data!['unit'], undefined,
    'DELIBERATELY no `unit`: what was targeted is the formation, not each unit standing in '
    + "it, so a `self: true` \"when I become targeted\" listener must not match");
  assert.match(evs[0]!.msg, /targets .*'s formation/, 'and the log says so in words');
  pass(h); pass(h);
  finishBattle(h);
});

test('Gravitational Correction: a formation target can be REDIRECTED to the other formation', () => {
  // The consumer the ticket was most worried about. It is fully generic — it
  // re-derives the slot's candidates and labels them — so the arm works there
  // the moment `targetCandidates` and `targetLabel` know about it.
  const { h, A, D } = formations(15615);
  germ(h, A);
  pick(h, { formation: A });                                  // aimed at the 3-unit side
  const gid = h.state.stack.find(i => i.card === 'Galactic Germination')!.id;
  giveResources(h, D, 'fire', 4);                             // rr / X
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Gravitational Correction') });
  pick(h, 0);                                                 // X = 0
  pick(h, { stack: gid });
  const before = oneOnes(h, A);
  pass(h); pass(h);                                           // resolve the Correction
  assert.equal(h.state.decision?.kind, 'payOrDecline');
  pick(h, false);                                             // A declines to keep its target
  assert.deepEqual(offered(h).map(s => JSON.parse(s) as TargetRef), [{ formation: A }, { formation: D }],
    'the retarget menu is formations too — the slot is judged by the same spec');
  pick(h, { formation: D });                                  // moved to the 1-unit side
  pass(h); pass(h);
  assert.equal(oneOnes(h, A) - before, 1,
    "redirected: the Germination counted D's blocking formation (1), not A's attacking one (3)");
  finishBattle(h);
});

test('Gatekeeper of Souls cannot compel a formation target — "if able", and it is not able', () => {
  // The consumer deliberately left UNABLE to take the new arm, asserted rather
  // than assumed. "I must be targeted if able" narrows a candidate list to the
  // Gatekeeper; a formation is not a unit, so no list of formations can ever
  // contain it and the compulsion correctly leaves the list alone.
  const { h, A, D } = formations(15616);
  spawn(h, D, 'Gatekeeper of Souls');                         // 0/7, in the battle region
  germ(h, A);
  assert.deepEqual(offered(h).map(s => JSON.parse(s) as TargetRef), [{ formation: A }, { formation: D }],
    'both formations still offered — a Gatekeeper cannot make a formation-targeting spell '
    + 'aim at a unit, because there is no unit slot to aim');
  pick(h, { formation: A });
  pass(h); pass(h);
  finishBattle(h);
});

test('Galactic Germination: an EMPTY formation is still a formation — it creates nothing, and says so', () => {
  const { h, A, D, blocker } = formations(15617);
  germ(h, A);
  pick(h, { formation: D });
  const e = new E(h.state);
  e.destroy(e.entity(blocker)!, 'dies');                      // D's whole formation empties
  e.settle();
  h.state = e.s;
  const before = oneOnes(h, A);
  pass(h); pass(h);
  assert.equal(oneOnes(h, A) - before, 0, 'nobody in it, nothing created');
  assert.ok(h.log.some(l => /Galactic Germination: there is nobody in .*'s formation/.test(l)),
    'an effect that resolves into silence is indistinguishable from a bug (65-effect-conformance)');
  finishBattle(h);
});
