/* Report #218 — THE SWEEP: every card whose printed text says "spell effect(s)",
 * "spell(s)" or "nonspell" treats an Ambush on the stack as NOT a spell.
 *
 * An Ambush is a unit card played during battle, not a spell (_passer
 * 2025-12-13, Caleb deferring: "From 'not spell' you can have
 * Triggered/Activated ability, Ambush or units that can be played during
 * combat"; the owner 2026-10-16: "If Caleb says its not a spell, it's not a
 * spell and we need to fix that"). Six hand-copied kind lists used to say
 * otherwise; they read `isSpellEffect` now, and this file is what keeps a
 * seventh from appearing.
 *
 * The card list is DERIVED from the printed text, never named: a new card that
 * mentions spells lands in one of the buckets below by its WORDS, and a card
 * that fits none fails the census until someone says what it is about.
 *
 *  · "target spell effect"      — the Ambush is never a candidate; a real spell is.
 *  · "target nonspell effect"   — the Ambush IS a candidate; a real spell is not.
 *  · "negate/recall all … spells / spell effects" — run every untargeted
 *    effect the card has: the Ambush stays on the stack; the spell leaves.
 *  · "nontoken spell negated"   — Flame Shield negates every effect, but pays
 *    a Fireball for the spell alone.
 *  · every other UNIT in the list ("when you play a spell", "spells cost …",
 *    "your spells", …) — in play for the ambusher, none of them reacts to the
 *    Ambush or taxes it; the same units DO react to a real spell (non-vacuity).
 *  · the rest are spells whose noun is a card in a BIN, a HAND or the card
 *    itself — named below with the reason, since no stack item is in question.
 *
 * Seeds are 47600-47699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Seat } from '../src/types.ts';
import { allCardNames, getCard, isSpellEffect, specForSlot, type CardDef, type EffectDef } from '../src/cards/dsl.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, withE } from './util.ts';

const MENTIONS_SPELL = /spell effect|nonspell|\bspells?\b/i;
const TARGET_SPELL = /target spell effect/i;
const TARGET_NONSPELL = /target nonspell effect/i;
const SWEEP_SPELLS = /(negate|recall) all (other |allied )?(spell effects|spells)/i;
const NONTOKEN_NEGATED = /nontoken\s*(\{\/n\})?\s*spell negated/i;

/** Non-unit cards whose "spell" is a card somewhere other than the stack. */
const NOT_A_STACK_QUESTION: Record<string, string> = {
  'Abyssal Evocation': 'a permission to play spells from your BIN',
  'Delver of Mysteries': 'recalls a spell CARD in your bin',
  'Spell Excavation': 'targets a spell CARD in your bin',
  'Void Memory': 'a discard of a spell CARD from hand',
  'Download': 'steals a TOKEN in play; "spells controlled this way" are the spell tokens it took',
  'Temporal Rift': '"Erase this spell" is the card itself; its sweep is "all effects"',
};

const passUntil = (h: Harness, seat: Seat) => { let g = 12; while (h.state.priority !== seat && g-- > 0) pass(h); };

function effectsOf(c: CardDef): EffectDef[] {
  const out: EffectDef[] = [];
  if (c.spellEffect) out.push(c.spellEffect);
  if (c.graftEffect) out.push(c.graftEffect.effect);
  for (const a of [...(c.abilities ?? []), ...(c.augmentText ?? [])]) {
    const eff = (a as { effect?: EffectDef }).effect;
    if (eff) out.push(eff);
  }
  return out;
}

const pool = allCardNames().filter(n => MENTIONS_SPELL.test(getCard(n).text ?? ''));

/** A attacks; A casts Flame of History (a real nontoken spell) at D's unit; D
 * answers with a Lurking Slimebeast Ambush recalling that unit. */
function ambushOverASpell(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const raider = spawn(h, A, 'Unit Token');
  const ally = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'fire', 1);
  giveResources(h, D, 'water', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[raider]] });
  passUntil(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Flame of History') });
  pick(h, { unit: ally });
  passUntil(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Lurking Slimebeast'), mode: 'ambush' });
  pick(h, { unit: ally });
  const flame = h.state.stack.find(i => i.card === 'Flame of History')!;
  const amb = h.state.stack.find(i => i.kind === 'ambush')!;
  assert.ok(flame && amb && h.state.stack.length === 2, 'the premise: exactly a spell and an Ambush on the stack');
  return { h, A, D, flame, amb };
}

test('the predicate: an Ambush is not a spell effect, a spell unit and a spell token are', () => {
  assert.equal(isSpellEffect('ambush'), false);
  for (const k of ['spell', 'spellUnit', 'spellToken'] as const) assert.equal(isSpellEffect(k), true, k);
  for (const k of ['unit', 'virus', 'triggered', 'activated'] as const) assert.equal(isSpellEffect(k), false, k);
});

test('census: every card whose text mentions spells lands in a bucket', () => {
  assert.ok(pool.length >= 40, `non-vacuity: the pool's spell-text cards were found (${pool.length})`);
  const unplaced = pool.filter(n => {
    const c = getCard(n), t = c.text;
    return !(TARGET_SPELL.test(t) || TARGET_NONSPELL.test(t) || SWEEP_SPELLS.test(t) || NONTOKEN_NEGATED.test(t)
      || c.kind === 'unit' || n in NOT_A_STACK_QUESTION);
  });
  assert.deepEqual(unplaced, [], 'a card mentions spells and no bucket says how it reads an Ambush');
  for (const n of Object.keys(NOT_A_STACK_QUESTION)) assert.ok(pool.includes(n), `${n} is still in the pool`);
});

test('target spell effect never offers an Ambush; target nonspell effect always does', () => {
  const cards = pool.filter(n => TARGET_SPELL.test(getCard(n).text) || TARGET_NONSPELL.test(getCard(n).text));
  assert.ok(cards.length >= 4, `non-vacuity: Dreadwave, Null Drone, Dream Lapse, Nothyr at least (${cards})`);
  for (const n of cards) {
    const nonspell = TARGET_NONSPELL.test(getCard(n).text);
    const { h, A, D, flame, amb } = ambushOverASpell(47601);
    const specs = effectsOf(getCard(n)).map(e => e.targets).filter(s => s && /^stack/.test(specForSlot(s, 0).what));
    assert.ok(specs.length, `${n}: a stack target spec`);
    const e = new E(h.state);
    for (const seat of [A, D]) {
      for (const s of specs) {
        const cands = e.targetCandidates(specForSlot(s!, 0), amb.region, undefined, seat).map(t => JSON.stringify(t));
        const hasAmb = cands.includes(JSON.stringify({ stack: amb.id }));
        const hasSpell = cands.includes(JSON.stringify({ stack: flame.id }));
        assert.equal(hasAmb, nonspell, `${n}: an Ambush is ${nonspell ? '' : 'not '}a candidate (seat ${seat})`);
        assert.equal(hasSpell, !nonspell, `${n}: a real spell is ${nonspell ? 'not ' : ''}a candidate (seat ${seat})`);
      }
    }
  }
});

test('negate or recall all spells leaves the Ambush on the stack and takes the spell', () => {
  const cards = pool.filter(n => SWEEP_SPELLS.test(getCard(n).text));
  assert.ok(cards.length >= 3, `non-vacuity: Cosmic Reversal, Skybreaker, Molten Riftbreaker at least (${cards})`);
  for (const n of cards) {
    const effs = effectsOf(getCard(n)).filter(e => !e.targets);
    let spellTaken = false;
    for (const ctl of [0, 1] as Seat[]) {
      const { h, flame, amb } = ambushOverASpell(47602);
      withE(h, (e) => {
        for (const eff of effs) {
          eff.run(e, {
            controller: ctl, sourceName: n, region: amb.region, targets: [], x: undefined, event: null,
            choose: () => 0,
          } as never);
        }
      });
      assert.ok(h.state.stack.some(i => i.id === amb.id && !i.negated),
        `${n} (controller seat ${ctl}): the Ambush is still on the stack — it is not a spell`);
      if (!h.state.stack.some(i => i.id === flame.id)) spellTaken = true;
    }
    assert.ok(spellTaken, `${n}: non-vacuity — the real spell left the stack for at least one controller`);
  }
});

test('Flame Shield negates the Ambush as an effect but pays no Fireball for it', () => {
  const cards = pool.filter(n => NONTOKEN_NEGATED.test(getCard(n).text));
  assert.ok(cards.length >= 1, 'non-vacuity: Flame Shield');
  for (const n of cards) {
    const { h, A, amb } = ambushOverASpell(47603);
    const before = Object.values(h.state.entities).filter(x => x.kind === 'spellToken' && x.controller === A).length;
    withE(h, (e) => {
      getCard(n).spellEffect!.run(e, {
        controller: A, sourceName: n, region: amb.region, targets: [], x: undefined, event: null, choose: () => 0,
      } as never);
    });
    assert.equal(h.state.stack.length, 0, `${n}: every other effect was negated, the Ambush included`);
    const made = Object.values(h.state.entities).filter(x => x.kind === 'spellToken' && x.controller === A).length - before;
    assert.equal(made, 1, `${n}: one Fireball, for Flame of History alone — the Ambush is not a nontoken spell`);
  }
});

test('the spell-text units in play do not react to an Ambush, and do react to a spell', () => {
  const units = pool.filter(n => getCard(n).kind === 'unit');
  assert.ok(units.length >= 25, `non-vacuity: the units (${units.length})`);
  const h = new Harness(47604);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const raider = spawn(h, A, 'Unit Token');
  const ally = spawn(h, D, 'Unit Token');
  for (const n of units) spawn(h, D, n);
  h.state.triggerQueue.length = 0;      // spawn-time chatter is not the question
  giveResources(h, D, 'water', 12);     // room for any tax a wrong reading would add
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[raider]] });
  passUntil(h, D);
  if (h.state.decision) assert.fail(`a decision is pending before the Ambush: ${h.state.decision.prompt}`);
  const expended = () => h.state.players[D]!.resources.filter(r => r.state === 'expended').length;
  const spent0 = expended();
  const ev0 = h.events.length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Lurking Slimebeast'), mode: 'ambush' });
  pick(h, { unit: ally });
  assert.equal(expended() - spent0, 3, 'the Ambush cost its printed [3b] — no "spells cost more" tax reached it');
  assert.deepEqual(h.state.stack.map(i => i.kind), ['ambush'], 'nothing reacted: the Ambush is alone on the stack');
  assert.equal(h.state.triggerQueue.length, 0, 'and no trigger is waiting');
  assert.ok(!h.state.decision, 'and nobody is being asked');
  assert.ok(!h.events.slice(ev0).some(e => e.type === 'spellPlayed'), 'an Ambush fires no spellPlayed');
  // non-vacuity: the same units hear a real spell
  giveResources(h, D, 'fire', 4);
  passUntil(h, D);
  const ev1 = h.events.length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Flame of History') });
  // the first thing to speak up is an as-you-play offer (Maelstrom Charger) or
  // the cast's own target menu, then the units that hear the play
  let reacted = false;
  const pending = () => h.state.decision;   // re-read: the asserts above narrowed it
  for (let g = 0; g < 30 && pending() && !reacted; g++) {
    const d = pending()!;
    if (!/^Flame of History/.test(d.prompt)) { reacted = true; break; }
    if (d.kind === 'targets') pick(h, { player: A }); else h.do({ type: 'decide', seat: d.seat, choice: 0 });
  }
  reacted ||= h.state.stack.length > 2 || h.state.triggerQueue.length > 0
    || h.events.slice(ev1).some(e => e.type === 'spellPlayed');
  assert.ok(reacted, 'and the spell-text units do hear a real spell (non-vacuity)');
});
