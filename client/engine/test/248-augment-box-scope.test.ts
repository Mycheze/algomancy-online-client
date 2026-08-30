/*
 * 248 · R268 — A MOD RADIATES ITS [Augment] BOX AND NOTHING ELSE
 *
 * A card that is PLAYED reads its whole text box: its body text, and (Manual
 * Q&A, quoted at engine.ts::fireEvent and in the R127 write-up) its own
 * `[Augment]` line too. A card that is APPLIED as an augment reads ONLY the
 * `[Augment]` line. That is the owner's ruling of 2026-08-30, filed as a
 * general rule and not as a card fix:
 *
 *   *"The augmented effect of infernal wispweaver should ONLY be the 'At end
 *   of turn, make a wisp'. But right now, it's granting +2/+1 and the not
 *   sacrifice clause."*
 *
 * The engine already split ABILITIES this way — `def.abilities` vs
 * `def.augmentText`, chosen by `abilityKeyPrefix`. It did not split the
 * seventeen CONTINUOUS channels (`statics`, `costMods`, the seven `replace*`
 * hooks, …): every one of them was declared in one field per card and read
 * through the same `anchored()` walk whether the holder was a unit in play or
 * an augment mod. One field, two jobs. `CardBehavior.augmentBox` is the
 * second field.
 *
 * What this file asserts, all of it derived from printed.json:
 *
 *   §0  non-vacuity — the [Augment] pool and the radiating pool are both real
 *   §1  THE GUARD: a continuous clause printed INSIDE the box is declared in
 *       `augmentBox`; a clause printed in the body is declared at top level.
 *       Partitioned on the printed `[Augment]` marker. No card list is typed.
 *   §2  the converse: `augmentBox` is only declared by cards that print a box
 *   §3  THE GUARD, behaviourally: for every card that prints BOTH a body and a
 *       box, its body clauses do not radiate while it is a mod — with the
 *       same-board positive control that says the probe can see anything at all
 *   §4  pin: a box clause still radiates from a mod (Prickly Protector is a
 *       statics-only text-box augment — this is the half that must NOT change)
 *   §5  pin: and still radiates while the card is a unit in play (Manual Q&A)
 *
 * ⚠ §0 and §3's control are not decoration. §1 quantifies over a partition of
 * the pool and §3 over a set that is one card wide today; both go green by
 * seeing nothing if the derivation breaks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { E } from '../src/engine.ts';
import { Harness } from '../src/harness.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import '../src/cards/registry.ts';
import printed from '../src/cards/printed.json' with { type: 'json' };
import { effStats, ent, spawn, toDeployment, withE } from './util.ts';

const PRINTED = printed as Record<string, { text?: string; type?: string; kind?: string } | undefined>;

/**
 * Every channel that radiates through `E.anchored()` — the walk that reads a
 * card's continuous text off a unit in play AND off an augment mod. Kept as
 * one list because the bug is the same bug in all seventeen; `statics` is
 * merely the one a card in the pool actually stood on.
 */
const RADIANT_CHANNELS = [
  'statics', 'projects', 'costMods', 'effectAttrs', 'amountMods', 'amountMultipliers',
  'modPermissions', 'playPermissions', 'asYouPlay', 'mustBeTargeted',
  'replaceRotDamage', 'replaceCombatDamageToPlayer', 'replaceLifeGain', 'replaceCounters',
  'replaceTokenCreation', 'replaceTokenBatch', 'replaceCardStep',
] as const;

/** channels declared on an untyped view of a behaviour object. Untyped on
 * purpose: this file has to compile and run against the engine BEFORE
 * `augmentBox` exists, or it cannot be shown to be red. */
function declared(obj: unknown): string[] {
  const o = (obj ?? {}) as Record<string, unknown>;
  return RADIANT_CHANNELS.filter(k => {
    const v = o[k];
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== false;
  });
}

function bodyChannels(name: string): string[] {
  return declared(getCard(name));
}
function boxChannels(name: string): string[] {
  return declared((getCard(name) as unknown as Record<string, unknown>).augmentBox);
}

const AUGMENT_MARK = /\[Augment\]/i;

/** the printed text before the `[Augment]` marker, with reminder text
 * (`{i}(…)`) and the line-break marker stripped — what is left is the card's
 * BODY as a player reads it. Air Plant's whole body is one reminder sentence,
 * so it partitions as box-only, which is what its scan looks like. */
function printedBody(name: string): string {
  const t = PRINTED[name]?.text ?? '';
  const i = t.search(AUGMENT_MARK);
  const before = i < 0 ? t : t.slice(0, i);
  return before.replace(/\{i\}\([^)]*\)/g, '').replace(/\{\/?n\}/g, '').trim();
}

function printsBox(name: string): boolean {
  return AUGMENT_MARK.test(PRINTED[name]?.text ?? '');
}

const POOL = allCardNames().filter(n => PRINTED[n] !== undefined);
/** cards whose scan carries an [Augment] line */
const BOXED = POOL.filter(printsBox);
/** …and whose body is empty, so EVERY continuous clause they print is a box clause */
const BOX_ONLY = BOXED.filter(n => printedBody(n) === '');
/** …and which print both halves: the only cards where the split can be got wrong */
const BOTH_HALVES = BOXED.filter(n => printedBody(n) !== '');

/* ════════════════════════════════════════════════════════════════════════
 * 0. NON-VACUITY
 * ════════════════════════════════════════════════════════════════════════ */

test('§0 POSITIVE CONTROL: the partition and the channel scan both see a real pool', () => {
  assert.ok(POOL.length > 400, `only ${POOL.length} registered cards carry printed rows`);
  assert.ok(BOXED.length > 150,
    `only ${BOXED.length} cards print an [Augment] line — §1 quantifies over these`);
  assert.ok(BOX_ONLY.length > 100, `only ${BOX_ONLY.length} box-only cards`);
  assert.ok(BOTH_HALVES.length >= 5,
    `only ${BOTH_HALVES.length} cards print BOTH a body and a box — §3 quantifies over these`);

  // the scan must find channels, or §1 passes by seeing nothing declared
  const radiating = BOXED.filter(n => bodyChannels(n).length || boxChannels(n).length);
  assert.ok(radiating.length >= 30,
    `only ${radiating.length} [Augment] cards declare a continuous channel at all — the channel `
    + 'scan has gone blind and every assertion below would pass while measuring nothing');
});

/* ════════════════════════════════════════════════════════════════════════
 * 1-2. THE GUARD
 * ════════════════════════════════════════════════════════════════════════ */

test('§1 GUARD: a continuous clause printed inside the [Augment] box is declared in augmentBox', () => {
  const wrong = BOX_ONLY.filter(n => bodyChannels(n).length > 0);
  assert.deepEqual(wrong, [],
    'these cards print NOTHING outside their [Augment] box, yet declare a continuous channel '
    + 'in the BODY slot, where the engine radiates it from a unit in play and from an augment '
    + 'mod alike:\n  '
    + wrong.map(n => `${n}: ${bodyChannels(n).join(', ')} — ${JSON.stringify(PRINTED[n]?.text)}`)
      .join('\n  ')
    + '\n\nR268: a mod radiates its [Augment] box and nothing else. Move each of these into '
    + '`augmentBox: { … }` so the box channel is the one the mod reads. (A card whose clause '
    + 'really is body-printed keeps it at top level — and then it must have body text, which '
    + 'these do not.)');
});

test('§2 GUARD: augmentBox is declared only by cards that print an [Augment] box', () => {
  const wrong = POOL.filter(n => !printsBox(n) && boxChannels(n).length > 0);
  assert.deepEqual(wrong, [],
    'these cards declare `augmentBox` channels without printing an [Augment] line — the box '
    + 'text would never be read, because the card can never be applied as an augment for its '
    + 'text:\n  ' + wrong.join('\n  '));
});

/* ════════════════════════════════════════════════════════════════════════
 * 3. THE GUARD, BEHAVIOURALLY
 * ════════════════════════════════════════════════════════════════════════ */

/** the token units in the pool, derived — the cheapest board of plausible
 * static targets there is, and the one Infernal Wispweaver's body clause is
 * printed about ("your wisps"). */
const TOKEN_UNITS = POOL.filter(n => /Token Unit/i.test(PRINTED[n]?.type ?? ''));

/** how many statics `name` is projecting onto anything, anywhere on `h`.
 * EVERY entity, not just units: Harbinger of Immolation's static is about
 * spell tokens, and a probe that only looked at units could not see it. */
function radiatedBy(h: Harness, name: string): number {
  const e = new E(h.state);
  let n = 0;
  for (const u of Object.values(h.state.entities)) {
    if (u.kind === 'mod' || u.absent) continue;
    n += e.projections(u).filter(p => p.from === name).length;
  }
  return n;
}

/** a board of token units and a spell token, plus `name` either played as a
 * unit or stapled to a host as an augment mod */
function boardWith(name: string, as: 'unit' | 'mod'): Harness {
  const h = new Harness(2680);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  for (const t of TOKEN_UNITS) spawn(h, p, t);
  const host = spawn(h, p, 'Unit Token');
  withE(h, e => { e.createSpellToken(p, 'Fireball', 1, e.homeRegion(p)); });
  if (as === 'unit') spawn(h, p, name);
  else withE(h, e => { e.attachMod(e.entity(host)!, name, p, 'augment'); });
  return h;
}

test('§3 GUARD: a card that prints both halves radiates its body clause from play, never from a mod', () => {
  // the derived population: cards printing BOTH a body and a box, whose BODY
  // declares a continuous channel. That is the whole set in which R268 can be
  // observed at all, and it is computed, never typed.
  const population = BOTH_HALVES.filter(n => bodyChannels(n).includes('statics'));
  assert.ok(population.length >= 1,
    'no card prints a body static beside an [Augment] box — either the pool changed or the '
    + 'partition broke. Either way §3 below is measuring nothing; find out which before '
    + 'deleting this line.');

  for (const name of population) {
    assert.equal(PRINTED[name]?.kind, 'unit', `${name} is not a unit — this probe plays it`);

    // CONTROL, on the same board: played normally, the body clause DOES reach
    // something. Without this the assertion below is "a static I could not
    // observe did not happen".
    const inPlay = radiatedBy(boardWith(name, 'unit'), name);
    assert.ok(inPlay > 0,
      `CONTROL FAILED: ${name} played as a unit radiates nothing onto a board of `
      + `${TOKEN_UNITS.join(', ')}. The probe cannot see this card's static at all, so the `
      + 'mod-mode assertion below proves nothing.');

    // and now the ruling
    const asMod = radiatedBy(boardWith(name, 'mod'), name);
    const expected = boxChannels(name).includes('statics') ? undefined : 0;
    if (expected === 0) {
      assert.equal(asMod, 0,
        `${name} declares its static in the BODY — outside its [Augment] box — and it is still `
        + `radiating (${asMod} projection(s)) while the card is an augment mod. R268: applying a `
        + 'card as an augment brings ONLY its [Augment] box; the body text does nothing.');
    }
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * 4-5. THE HALF THAT MUST NOT CHANGE (pins, not guards)
 * ════════════════════════════════════════════════════════════════════════ */

test('§4 PIN: a text-box [Augment] static still transfers to the host it is applied to', () => {
  // Prickly Protector — "[Augment] I gain +1/+1 for each other ally" — is the
  // reason `staticsFor` reads statics off mods in the first place. R268 moves
  // where the clause is DECLARED; it must not change what it does.
  const h = new Harness(2681);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const host = spawn(h, p, 'Unit Token');          // 1/1
  spawn(h, p, 'Unit Token');
  spawn(h, p, 'Unit Token');
  withE(h, e => { e.attachMod(e.entity(host)!, 'Prickly Protector', p, 'augment'); });
  assert.deepEqual(effStats(h, host), [3, 3],
    'the mod-carried box static stopped radiating: host 1/1 plus +2/+2 for its two other allies');
});

test('§5 PIN: a card played normally still reads its own [Augment] box', () => {
  // The Manual Q&A the whole ruling hangs off: R268 is NOT symmetric. The box
  // is live in both modes; only the BODY is mod-silent.
  const h = new Harness(2682);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const prick = spawn(h, p, 'Prickly Protector');   // 0/1
  spawn(h, p, 'Unit Token');
  spawn(h, p, 'Unit Token');
  assert.ok(ent(h, prick), 'the Prickly Protector is in play');
  assert.deepEqual(effStats(h, prick), [2, 3],
    'a card in play reads its own [Augment] line (Manual Q&A) — 0/1 plus +2/+2 for two allies');
});
