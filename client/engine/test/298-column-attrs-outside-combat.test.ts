/* R294 — A UNIT IN A COLUMN *HAS* THE COLUMN'S ATTRIBUTES, for everything it
 * does and not only for the combat damage it deals.
 *
 * PLAYTEST REPORT #166, room BTUX, 2026-09-15, filed by the owner (judge L1)
 * at action [213]: *"My unit has Blessed and I should have gained life from it
 * dealing damage!"*
 *
 * The replay names the moment. Refuse Reclaimer was attacking in a column with
 * Flzzz, which prints {Blessed} — *"(Damage dealt by a blessed source causes
 * its controller to gain that much life.)"* — and carried an augmented Soul
 * Reaver: *"[one], Remove X +1/+1 counters from me: I deal X damage to target
 * unit."* It removed a counter, dealt 1 to a blocking Formless, and its
 * controller gained nothing.
 *
 * ── THE SEAM ─────────────────────────────────────────────────────────
 * `dealEffectDamageAll` read the SOURCE's attributes with `ownAttrs` — the card
 * alone — while reading the RECIPIENT's {Vulnerable} with `effAttrs` and its
 * {Unaware} through `E.unaware`, both column-aware. The doc comment beside it
 * claimed the recipient used `ownAttrs` "because column-sharing is a combat
 * layer (R19)", which was not true of the two lines below it. The Pure read was
 * the only recipient-side question answered off the card alone; the source side
 * was answered that way for every attribute at once.
 *
 * The owner, 2026-09-16: *"The whole card gets the attributes while it's in the
 * column. And so when it activates abilities or whatever, it has that
 * attribute. Combat damage also gets those applied, of course."* The Rules
 * Glossary is unconditional too: *"Creatures in a column (vertically adjacent)
 * share all of their attributes."*
 *
 * ⚠ THIS IS NARROWER THAN IT SOUNDS, and the reason is worth keeping. A COLUMN
 * ONLY EXISTS IN COMBAT — `E.columnOf` reads `s.battle` and answers null
 * without one — so outside battle `effAttrs` IS `ownAttrs` and nothing here
 * changes anything. R294 is not "column sharing applies everywhere"; it is
 * "while the column exists, every question about the unit gets the same
 * answer".
 *
 * ⚠ TWO SITES DELIBERATELY STILL READ `ownAttrs`, on the owner's call, and
 * §4 pins them so nobody "completes" the sweep:
 *
 *   {Feeble} block legality (apply.ts) — the owner, 2026-09-16: *"It won't let
 *   the Feeble unit block, even if it has another unit in the column, which is
 *   correct."*
 *   {Alluring} (apply.ts) — *"it's a single trigger for the column and having
 *   it originate from the actual unit with Alluring is fine."*
 *
 * §5 is the OTHER exception and it is a class, not a list: the attributes that
 * describe the card as an OBJECT rather than how it fights.
 *
 * Seeds 29800-29899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard, allCardNames } from '../src/cards/dsl.ts';
import { absorb, ent, finishBattle, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { EntityId, Seat } from '../src/types.ts';

/** deal effect damage FROM a real entity, the way a card script does (the
 *  shape 290-pure-outside-combat uses) */
function dealFrom(h: Harness, controller: Seat, sourceId: EntityId, targetId: EntityId, n: number): void {
  const g = new E(h.state);
  const src = g.entity(sourceId)!;
  g.dealEffectDamageAll(
    {
      controller, sourceName: src.card, sourceId, region: g.homeRegion(controller),
      targets: [], event: null,
      eraseSelf: () => {},
      choose: () => { throw new Error('no choice expected'); },
    },
    [{ target: g.entity(targetId)!, n }]);
  g.settle();
  h.state = g.s;
  absorb(h, g.events);
}

/** A attacks with ONE column of two, D blocks it with a lone victim — the
 *  smallest board on which a column exists at all */
function columnBoard(seed: number, front: string, back: string, victim: string) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const f = spawn(h, A, front), b = spawn(h, A, back), v = spawn(h, D, victim);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[f, b]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [v] } });
  return { h, A, D, f, b, v };
}

/* ══ §1 — THE REPORT ═════════════════════════════════════════════════ */

test('R294 §1 the report: an ability fired by a unit in a {Blessed} column gains its controller life', () => {
  // Lithoghul stands where Refuse Reclaimer stood; Flzzz is the column-mate
  // that prints {Blessed}; the damage is an effect, not combat.
  const { h, A, f, v } = columnBoard(29801, 'Lithoghul', 'Flzzz', 'Good Whale');
  assert.ok(new E(h.state).ownAttrs(ent(h, f)!).has('Blessed') === false,
    'the source card itself is not Blessed — everything below comes from the column');
  assert.ok(new E(h.state).effAttrs(ent(h, f)!).has('Blessed'),
    'but the COLUMN is, because Flzzz is standing in it');
  const life0 = h.state.players[A]!.life;
  dealFrom(h, A, f, v, 3);
  assert.equal(h.state.players[A]!.life, life0 + 3,
    'THE REPORT: 3 damage dealt by a source in a Blessed column gains its controller 3');
  finishBattle(h);
});

test('R294 §1b the control: the same board with no {Blessed} in the column gains nothing', () => {
  const { h, A, f, v } = columnBoard(29802, 'Lithoghul', 'Geode', 'Good Whale');
  const life0 = h.state.players[A]!.life;
  dealFrom(h, A, f, v, 3);
  assert.equal(h.state.players[A]!.life, life0,
    'no Blessed anywhere in the column, so no life — §1 is not passing on a board that always gains');
  finishBattle(h);
});

/* ══ §2 — IT IS THE LAYER, NOT THE CARD ═════════════════════════════ */

test('R294 §2 every source-side attribute rides the same line: {Powerful} from a column doubles too', () => {
  const { h, A, f, v } = columnBoard(29803, 'Lithoghul', 'Chitin Shredder', 'Good Whale');
  assert.ok(!new E(h.state).ownAttrs(ent(h, f)!).has('Powerful'), 'the source card is not Powerful');
  dealFrom(h, A, f, v, 2);
  assert.equal(ent(h, v)!.damage, 4,
    '2 doubled to 4 — {Powerful} is column-shared for effect damage exactly as {Blessed} is');
  finishBattle(h);
});

/* ══ §3 — OUTSIDE BATTLE THERE IS NO COLUMN, SO NOTHING CHANGES ═════ */

test('R294 §3 outside battle there are no columns at all, so effAttrs IS ownAttrs', () => {
  const h = new Harness(29804);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const src = spawn(h, A, 'Lithoghul');
  spawn(h, A, 'Flzzz');                                  // {Blessed}, standing right beside it
  const victim = spawn(h, D, 'Good Whale');
  const g = new E(h.state);
  assert.equal(g.columnOf(src), null, 'no battle, no column');
  assert.deepEqual([...g.effAttrs(ent(h, src)!)], [...g.ownAttrs(ent(h, src)!)],
    'so the two readers agree, and R294 widens nothing here');
  const life0 = h.state.players[A]!.life;
  dealFrom(h, A, src, victim, 3);
  assert.equal(h.state.players[A]!.life, life0,
    'a Blessed unit merely STANDING nearby shares nothing — a formation is not a column');
});

/* ══ §4 — THE TWO SITES THE OWNER LEFT ALONE ════════════════════════ */

test('R294 §4 {Feeble} block legality is still the unit\'s own question, on the owner\'s call', () => {
  // "It won't let the Feeble unit block, even if it has another unit in the
  // column, which is correct." A test that goes red here is a change to a
  // ruling, not a bug fix.
  const text = readFileSync(new URL('../src/apply.ts', import.meta.url), 'utf8');
  assert.ok(/ownAttrs\(u\)\.has\('Feeble'\)/.test(text),
    'apply.ts still asks Feeble of the UNIT, not of its column');
  assert.ok(!/effAttrs\([a-z]+\)\.has\('Feeble'\)/.test(text),
    'and nobody has quietly widened it to the column');
});

test('R294 §4b {Alluring} still originates from the unit that prints it', () => {
  const text = readFileSync(new URL('../src/apply.ts', import.meta.url), 'utf8');
  assert.ok(/ownAttrs\(e\.entity\(id\)!\)\.has\('Alluring'\)/.test(text),
    "the Alluring source is found by the unit's own attribute — \"a single trigger for the "
    + 'column", originating from the actual unit');
});

/* ══ §5 — THE ATTRIBUTES THAT DO NOT SHARE ══════════════════════════ */

/**
 * The owner, 2026-09-16, unprompted, on the exception:
 *
 *   > "There's something else about attributes. Specifically Unstable and
 *   > Burst. They *are* attributes, but they're a bit special in that they're
 *   > not applied to other things in the column. So a unit with Unstable from a
 *   > mod doesn't 'give' Unstable to the other units in the column in the way
 *   > that it gives Blessed or Sluggish. They are special attributes."
 *
 * And, asked about a third: *"Modular is also special. But doesn't matter yet
 * cause it's a spell (but so is Burst...)"*
 *
 * THE LINE IS DERIVED, NOT LISTED. The Rules Glossary's own first sentence
 * says what an attribute is: *"Attributes describe any modifications to how the
 * creature engages in combat."* Unstable (how a card LEAVES the game), Burst
 * (how it is PLAYED) and Modular (how it is played) describe the card as an
 * object. Those do not share; the combat ones do.
 *
 * ⚠ THE ENGINE ALREADY DOES THIS AND NOTHING SAID SO. Unstable is
 * `Entity.unstable` + `faceDef().unstable` + the mods derivation, read through
 * `E.isUnstable`; Burst is `CardDef.burst`. Neither is in `ownAttrs`, so
 * neither can union through `colAttrs` — correct by accident of modelling.
 * Modular IS in `attrs` and is harmless only because the one card that prints
 * it is a spell, which never stands in a column. R294 is the change that would
 * tempt someone to "fix" that inconsistency; this is the guard that stops them.
 */
test('R294 §5 Unstable and Burst are not in the attribute set, so a column cannot share them', () => {
  for (const name of allCardNames()) {
    const c = getCard(name) as { attrs?: string[]; augmentAttrs?: string[] };
    for (const a of [...(c.attrs ?? []), ...(c.augmentAttrs ?? [])]) {
      assert.ok(a !== 'Unstable' && a !== 'Burst',
        `${name} prints {${a}} as a shareable attribute — it is an OBJECT attribute and must `
        + 'stay out of attrs/augmentAttrs, or a column-mate will inherit it');
    }
  }
});

test('R294 §5b a modded (therefore Unstable) unit does not make its column-mate Unstable', () => {
  const { h, f, b } = columnBoard(29805, 'Lithoghul', 'Geode', 'Good Whale');
  const g = new E(h.state);
  g.attachMod(g.entity(f)!, 'Smouldering Inferno', g.entity(f)!.controller, 'augment');
  h.state = g.s;
  const g2 = new E(h.state);
  assert.ok(g2.isUnstable(g2.entity(f)!), 'the modded unit is Unstable (R69, by derivation)');
  assert.ok(!g2.isUnstable(g2.entity(b)!),
    'its column-mate is NOT — Unstable is an object attribute and does not travel the column');
  assert.ok(!g2.colAttrs(g2.columnOf(f)!).has('Unstable'),
    'and it is nowhere in the column attribute set at all');
  finishBattle(h);
});

test('R294 §5c {Modular} is an object attribute too, and only a spell prints it', () => {
  // The owner: "Modular is also special. But doesn't matter yet cause it's a
  // spell." That is TRUE TODAY and is the whole of why it is safe — so the
  // guard is on the fact that keeps it safe, not on the behaviour it implies.
  const carriers = allCardNames().filter(n => {
    const c = getCard(n) as { attrs?: string[]; augmentAttrs?: string[] };
    return [...(c.attrs ?? []), ...(c.augmentAttrs ?? [])].includes('Modular');
  });
  assert.ok(carriers.length > 0, 'something still prints {Modular} — the subject set is not empty');
  for (const n of carriers) {
    assert.notEqual((getCard(n) as { kind?: string }).kind, 'unit',
      `${n} prints {Modular} and is a UNIT, so it can stand in a column and share an attribute `
      + 'that describes how a card is PLAYED. Give Modular the Unstable/Burst treatment — out '
      + 'of attrs, into its own predicate — before shipping it on a unit');
  }
});
