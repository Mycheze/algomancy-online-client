/**
 * THE CARD IS STANDING IN THE BATTLE — R199, CARD-TODO #49.
 *
 * The owner's standing requirement, and the reason this file exists rather than
 * a bumped number in `84-card-semantics`:
 *
 *   "For each bug that has to do with certain cards, design a new test which
 *    will be run during testing to ensure the card retains the intended
 *    functionality in that case."
 *
 * `84-card-semantics` counts. An aggregate that goes up while no INDIVIDUAL
 * card can go red is exactly the failure this repo keeps rediscovering, so
 * every card R199 newly reached gets a named assertion here quoting the clause
 * it prints. Delete the implementation of any one of them and this file names
 * that card and that clause; the aggregate would only wobble by one.
 *
 * ── WHAT WAS ACTUALLY WRONG ──────────────────────────────────────────────
 *
 * R180 left 52 printed promises never observed, and named REGION (R12) as the
 * biggest remaining family: six cards whose clause is scoped to the region its
 * event fires in. The brief for this round said those cards needed
 * "an attacking position with the card actually in the battle".
 *
 * THE DRILL ALREADY HAD ONE. `progressAction` declares the fullest attack on
 * offer and `doDeclareAttack` moves every attacker into the defender's region,
 * so the card marches every game. Traced on Galerider Eel: `subjReg=1,
 * battleReg=1` from step 37 onward — a textbook attacking position, reached and
 * then ignored. What was missing was a BEAT that waits for it. All seven
 * `@battle` repeats fired at steps 29–35, every one of them in the DECLARE
 * step, where the battle phase has begun and no attack has been declared yet:
 * `battleReg=1, subjReg=0`. The world acted at home, the card was at home too,
 * and the clause that reads `g.s.battle?.region === self.region` was correctly
 * silent about a battle neither of them was in.
 *
 * So `Fixture.phase` gained a third, strictly narrower pin — `inBattle`, which
 * fires only while the subject stands in the battle's region — and the beats
 * behind it aim at THAT region instead of at home.
 *
 * ── WHAT A BLIND CHECKER WOULD PRINT ─────────────────────────────────────
 *
 * The ticket's standing warning is that a coverage number going UP is the
 * direction that flatters, so the honest thing to say first is what R199 did
 * NOT touch: it adds no evidence channel at all. Attribution is still
 * `ownResolution` — a slice of the event stream bounded by the engine's own
 * stack-item label — and the continuous-layer reading is still `staticBite`,
 * both built and blind-checked in R180 and both unchanged here. R199 changes
 * only WHEN and WHERE the world acts. That is why the two failure modes here
 * are not the ones that flatter:
 *
 *   ALWAYS TRUE (`standingInBattle()` hard-wired to true) — the beats would
 *     fire at any quiescent window, including deployment, and would then act at
 *     `subject.region`, which at home is the home region. Every clause in the
 *     family tests the battle region explicitly, so they would stay dark: the
 *     blindness would show up as coverage FALLING, plus beats burned early.
 *     Loud. `a card with no body on the board never reports a battle position`
 *     below pins it anyway, and the recorded `home=/at=/battle=` triple is what
 *     makes "the card marched" a fact a test can read rather than an assumption.
 *   ALWAYS FALSE — no beat ever fires in battle, the six cards go dark again,
 *     and `84-card-semantics`'s per-gate floors catch it.
 *
 * MEASURED, at this commit: 264/316 gated promises observed before R199,
 * 278/316 after. The one card that came out of it in the OTHER direction is
 * Slag Spewer, and it is a REAL DEFECT this round found rather than a
 * regression — see `84-card-semantics`'s UNREACHED entry.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import { drillCard, type DrillResult } from './drill.ts';

/** one press run per (card, mode) — a press run walks a whole game and there
 *  are a dozen cards below, so the runs are shared rather than repeated. */
const runs = new Map<string, DrillResult>();
function pressed(card: string, augment = false): DrillResult {
  const key = `${card}:${augment ? 'augment' : 'cast'}`;
  let r = runs.get(key);
  if (!r) {
    r = drillCard(card, 900_000, augment ? { augment: true, press: true } : { press: true });
    runs.set(key, r);
  }
  return r;
}

/**
 * THE CLAUSE THIS TEST IS ABOUT IS STILL PRINTED ON THIS CARD.
 *
 * Every assertion below quotes printed text in its title. A card whose text is
 * re-worded, or a card renamed out from under a test, would otherwise leave an
 * assertion that still passes while testing a promise nobody makes any more —
 * this repo's cheapest way to accumulate a green test that means nothing.
 */
function printsClause(card: string, phrase: string): void {
  const text = (getCard(card).text ?? '')
    .replace(/\{\/?[a-z0-9]+\}/gi, ' ').replace(/\s+/g, ' ').toLowerCase();
  assert.ok(text.includes(phrase.toLowerCase()),
    `${card} no longer prints "${phrase}" — its text now reads "${text}". The assertion below `
    + 'quotes a promise this card does not make, so it is testing nothing. Re-read the card.');
}

/** the beats that fired while the card stood in the battle, as regions */
function positions(r: DrillResult): { beat: string; home: number; at: number; battle: number }[] {
  return r.inBattleBeats.map(s => {
    const m = /^(.*):home=(\d+):at=(\d+):battle=(\d+)$/.exec(s)!;
    return { beat: m[1]!, home: Number(m[2]), at: Number(m[3]), battle: Number(m[4]) };
  });
}

// ── the position itself, measured in both directions ────────────────────

test('the drill reaches a real battle position: the card leaves home and stands where the battle is', () => {
  const r = pressed('Galerider Eel');
  const pos = positions(r);
  assert.ok(pos.length >= 5,
    `only ${pos.length} beats fired while the card stood in the battle — the inBattle pin has `
    + 'stopped firing and every named assertion below is passing for the wrong reason');
  // `at === battle` is the pin and proves nothing on its own. `at !== home` is
  // the fact: the card LEFT ITS OWN REGION and was standing in the defender's.
  for (const p of pos) {
    assert.equal(p.at, p.battle, `${p.beat} fired outside the battle region`);
  }
  assert.ok(pos.some(p => p.at !== p.home),
    'every in-battle beat fired in the card\'s OWN home region. That is a legitimate position — '
    + 'the battle can come to you — but it is not the one this family needs, and if it is the '
    + 'only one the drill ever reaches then no attacker was ever built and the pin is measuring '
    + 'the declare step by another name.');
});

test('a card with no body on the board never reports a battle position — the pin can say NO', () => {
  // THE ALWAYS-TRUE CONTROL. Immolate is a spell: it is cast, it resolves, it
  // goes to the bin, and it never stands anywhere. A `standingInBattle()` that
  // had been hard-wired true — or one that read the PHASE instead of the
  // card's region, which is exactly the bug R199 fixed — would report beats
  // here, because the battle phase happens in every game whether or not the
  // card under test has a body in it.
  const r = pressed('Immolate');
  assert.deepEqual(r.inBattleBeats, [],
    'Immolate has no body and cannot stand in a battle, yet the drill reported in-battle beats '
    + 'for it. The position pin has gone always-true and the whole family below is unearned.');
  // …and the run is otherwise a real one, so the empty list above is a
  // distinction and not a dead observation.
  assert.ok(r.fired.length >= 20,
    `only ${r.fired.length} beats fired on Immolate at all — the press run itself has stopped, so `
    + 'the empty in-battle list above proves nothing');
});

// ── REGION (R12): the six cards CARD-TODO #49 named ─────────────────────

test('Galerider Eel delivers "I gain +4/+4 and flying until regroup" once it stands in the battle', () => {
  printsClause('Galerider Eel', 'cards enter your hand during battle');
  const r = pressed('Galerider Eel');
  assert.ok(r.inBattleBeats.some(b => b.startsWith('draw@inBattle')),
    'the beat this clause listens for — a card entering a hand while the Eel is in the battle — '
    + 'never fired, so the assertion below would be measuring nothing');
  assert.ok(r.ownTypes.includes('statChanged'),
    'Galerider Eel prints "Whenever one or more other cards enter your hand during battle, I gain '
    + '+4/+4 and {g}flying until regroup" and its own resolution granted no stats. Its when() is '
    + '`g.s.battle?.region === self.region` — either that guard or the +4/+4 has stopped working. '
    + `Its own window saw: ${[...new Set(r.ownTypes)].join(', ') || '(nothing)'}`);
});

test('Colony of the Interworld delivers "Put three +1/+1 counters on me" when life moves in battle', () => {
  printsClause('Colony of the Interworld', 'when you gain or lose life during battle');
  const r = pressed('Colony of the Interworld');
  assert.ok(r.inBattleBeats.some(b => b.startsWith('life@inBattle')),
    'the life beat never fired in the battle, so the assertion below measures nothing');
  assert.ok(r.ownTypes.includes('countersChanged'),
    'Colony of the Interworld prints "When you gain or lose life during battle, [Switch1] Put '
    + 'three +1/+1 counters on me" and put none on. `E.loseLife` stamps the event with the '
    + 'battle region (R12), so only a unit standing in the battle can hear it — this run put it '
    + `there. Its own window saw: ${[...new Set(r.ownTypes)].join(', ') || '(nothing)'}`);
});

test('Boreal Wanderer delivers "I deal 2 damage to each opponent" when an ally spawns in the battle', () => {
  printsClause('Boreal Wanderer', 'when another ally spawns during battle');
  const r = pressed('Boreal Wanderer');
  assert.ok(r.inBattleBeats.some(b => b.startsWith('allySpawn@inBattle')),
    'no ally spawned in the battle region, so the assertion below measures nothing');
  assert.ok(r.ownTypes.includes('damage'),
    'Boreal Wanderer prints "When another ally spawns during battle, [Switch1] I deal 2 damage to '
    + 'each opponent" and dealt none. Its payload loops `regions[ctx.region].presentSeats`, so it '
    + 'needs BOTH the spawn and an opponent in the same region — and its [Switch1] gives it one '
    + 'bounded use per turn (R9), which is why `allySpawn@battle` waits for `battle.happened` '
    + 'rather than spending that use on a home-region spawn. '
    + `Its own window saw: ${[...new Set(r.ownTypes)].join(', ') || '(nothing)'}`);
});

test('Rider of the Tides delivers its [Augment] "I gain +2/+2 until regroup" on a host in the battle', () => {
  printsClause('Rider of the Tides', "a card enters a player's hand");
  const r = pressed('Rider of the Tides', true);
  assert.ok(r.attached, 'the augment never landed on a host — nothing below is being measured');
  assert.ok(r.inBattleBeats.some(b => b.startsWith('draw@inBattle')),
    'no card entered a hand while the HOST stood in the battle');
  assert.ok(r.ownTypes.includes('statChanged'),
    'Rider of the Tides prints "[Augment] Whenever a card enters a player\'s hand during battle, '
    + 'I gain +2/+2 until regroup" and granted nothing. The clause is live only on a host, and '
    + `its when() pins it to the battle region. Its own window saw: ${[...new Set(r.ownTypes)].join(', ') || '(nothing)'}`);
});

test('Xenopod Progenitor delivers its [Augment] "create a 2/2 unit" on a host in the battle', () => {
  printsClause('Xenopod Progenitor', "cards enter a player's hand during battle");
  const r = pressed('Xenopod Progenitor', true);
  assert.ok(r.attached, 'the augment never landed on a host — nothing below is being measured');
  assert.ok(r.ownTypes.includes('spawned'),
    'Xenopod Progenitor prints "[Augment] Whenever one or more other cards enter a player\'s hand '
    + 'during battle, you may pay [one] to create a 2/2 unit" and created nothing. Three things '
    + 'have to hold: the host stands in the battle, a card enters a hand, and the payOrDecline is '
    + `answered PAY. Its own window saw: ${[...new Set(r.ownTypes)].join(', ') || '(nothing)'}`);
});

// ── the six was five: the one the position could NOT reach ───────────────

test('Bloated Manablub is still unreached, and it is the POSITION it lacks — not an implementation', () => {
  // The honest half of the tally. This card is the sixth of the REGION family
  // and R199 did NOT reach it; the entry that says so lives in
  // 84-card-semantics' UNREACHED list, and this assertion is what keeps that
  // entry truthful rather than stale. It asserts the CAUSE, not the failure:
  // the trigger fires and resolves, and the payload finds nobody to hit.
  printsClause('Bloated Manablub', 'when i despawn');
  const r = pressed('Bloated Manablub');
  assert.ok(r.fired.includes('despawn') && r.fired.includes('die'),
    'the beats that make this card leave play never fired, so the diagnosis below is not the one '
    + 'this run supports');
  assert.ok(r.events.some(m => m.startsWith('Resolving Bloated Manablub: ')),
    'Bloated Manablub\'s "When I despawn" did not even TRIGGER. That is a different and worse '
    + 'finding than the one recorded — it would mean the ability is broken, not merely standing '
    + 'in the wrong region. Open a CARD-TODO item.');
  assert.deepEqual(r.inBattleBeats, [],
    'Bloated Manablub now DOES reach a battle position. Delete its UNREACHED entry in '
    + '84-card-semantics and this test with it — the reason it was recorded no longer holds.');
});

// ── the board preconditions the same position unlocked ──────────────────

test('Spiteful Shadow delivers "Each player sacrifices a unit" — the die beat now reaches it', () => {
  printsClause('Spiteful Shadow', 'when i die');
  const r = pressed('Spiteful Shadow');
  assert.ok(r.fired.includes('die'),
    'the `die` beat never became eligible. It was recorded UNREACHED for exactly this reason '
    + 'before R199 — the run ended with two of the beats unfired because the seeded board killed '
    + 'the game before two battles had finished.');
  assert.ok(r.ownTypes.includes('died') || r.ownTypes.includes('trashed'),
    'Spiteful Shadow prints "When I die, [Switch] Each player sacrifices a unit" and nothing was '
    + `sacrificed inside its own resolution. Its window saw: ${[...new Set(r.ownTypes)].join(', ') || '(nothing)'}`);
});

test('Mindwarp Sporefrog delivers its [Augment] "target opponent gains control of me"', () => {
  printsClause('Mindwarp Sporefrog', 'whenever you are dealt combat damage');
  const r = pressed('Mindwarp Sporefrog', true);
  assert.ok(r.attached, 'the augment never landed on a host');
  assert.ok(r.ownTypes.includes('controlChanged'),
    'Mindwarp Sporefrog prints "[Augment] Whenever you are dealt combat damage, target opponent '
    + 'gains control of me" and control never moved. It was recorded UNREACHED because the host '
    + 'was an attacker in every battle the drill reached and only the DEFENDER takes face damage. '
    + `Its own window saw: ${[...new Set(r.ownTypes)].join(', ') || '(nothing)'}`);
});

test('Ploosh delivers the EVEN branch: "Otherwise, sacrifice me and you lose 3 life"', () => {
  printsClause('Ploosh', 'if your life total is odd');
  const r = pressed('Ploosh', true);
  assert.ok(r.attached, 'the augment never landed on a host');
  assert.ok(r.ownTypes.includes('died') || r.ownTypes.includes('trashed'),
    'Ploosh prints "[Augment] After combat, you gain 3 life and draw a card if your life total is '
    + 'odd. Otherwise, sacrifice me and you lose 3 life." The ODD branch was always observed; the '
    + 'even branch — the sacrifice — is the half that was not, and it needs the run to survive '
    + 'long enough for the life total to land on both parities. '
    + `Its own window saw: ${[...new Set(r.ownTypes)].join(', ') || '(nothing)'}`);
  assert.ok(r.ownTypes.includes('lifeGained'),
    'and the ODD branch must still be observed too — losing it while gaining the even one would '
    + 'be a trade, not a gain');
});

// ── the continuous [Augment] layers, read by taking the mod out of the game ──

/**
 * `staticBit` and not `attachChanged`, deliberately.
 *
 * A continuous `[Augment]` emits no event ever — it is a layer, not an action —
 * so its only possible evidence is that removing the mod changes somebody's
 * effective power/defence. `attachChanged` carries that reading, but it also
 * carries the coarse attach delta AND the "the host died of it" push, so a test
 * written against it would accept a dead host as proof of a pump. `staticBit`
 * has one writer.
 */
const LAYERS: [string, string, string][] = [
  // ⚠ the printed text carries a line-break marker mid-word ("non- {/n}token"),
  // so the phrase quoted here starts after it. `printsClause` strips the markup
  // but cannot close the gap it left.
  ['Animated Spark', "token spell you've played in this battle",
    'Your units gain +1/+0 for each nontoken spell you have played IN THIS BATTLE. The augment is '
    + 'applied in deployment; before R199 the press run\'s spell landed in a different battle, so '
    + 'the count was 0 and the layer was a no-op that changed no stat.'],
  ['Riftspawn Remnant', 'if you have gained or lost life in this battle',
    'I gain +4/-4 IF YOU HAVE GAINED OR LOST LIFE IN THIS BATTLE — the same shape: before R199 '
    + 'the life beats and the attach did not share a battle.'],
  ['Inspiration', 'your units adjacent to me gain +2/+2',
    'Your units ADJACENT TO ME gain +2/+2 — it needs neighbours, and an attacking formation is '
    + 'where the drill builds one.'],
];

for (const [card, phrase, why] of LAYERS) {
  test(`${card}'s [Augment] layer bites: removing the mod changes somebody's power/defence`, () => {
    printsClause(card, phrase);
    const r = pressed(card, true);
    assert.ok(r.attached, `${card} never landed on a host — nothing below is being measured`);
    assert.ok(r.staticBit,
      `${card} prints "${phrase}" and taking its mod out of the game changes nobody's effective `
      + `power or defence. ${why}`);
  });
}

test('a triggered [Augment] box must NOT read as a continuous layer', () => {
  // The blind-check on the three assertions above, in the direction that
  // flatters. `staticBite` compares per-entity NUMBERS on purpose: every
  // augment makes its host {Unstable} (R79) and lengthens its counters array,
  // so an attribute-aware or array-aware comparison reads as true for every
  // augment in the pool whatever its box says. A Pile of Rubbish's box is a
  // TRIGGER ("when I die, draw a card") and grants no stats at all.
  const r = pressed('A Pile of Rubbish', true);
  assert.ok(r.attached, 'A Pile of Rubbish never landed on a host — the control measures nothing');
  assert.equal(r.staticBit, false,
    "A Pile of Rubbish's [Augment] box is a trigger and grants no stats, yet the continuous "
    + 'reading says it changes somebody\'s power/defence. It has gone always-true, and the three '
    + 'layer assertions above are unearned.');
});
