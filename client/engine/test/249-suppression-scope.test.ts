/*
 * 249 · R269 — SUPPRESSION IS AS WIDE AS THE CLAUSE THAT PRINTS IT
 *
 * `StaticMod.suppressAbilities` switches off a unit's WHOLE ability layer.
 * That is the right shape for exactly one kind of printed sentence — "…lose
 * all attributes and abilities" (Monke, Transmogrifant), "…loses all
 * abilities" (The Everywhere). It was ALSO used for Infernal Wispweaver's
 * "your wisps … do not sacrifice themselves after combat", on the argument
 * that a Wisp has exactly ONE ability, so switching the layer off and
 * switching that line off name the same behaviour.
 *
 * The owner filed the counterexample: *"Infernal Wispweaver seems to be
 * turning off ALL abilities of wisps, but it should just be their sacrificing
 * ability that is disabled. They can technically have other abilities."* A
 * Wisp gains abilities every time somebody augments one, and Ancient One
 * projects them. The premise was never a fact about the card; it was a fact
 * about the board that happened to be in front of the implementer.
 *
 * This file is the class guard, not the Wispweaver fix:
 *
 *   §0  non-vacuity — the population of blanket-flag users is not empty
 *   §1  THE GUARD: a card that sets the blanket flag must PRINT a blanket
 *       clause. Derived from printed.json; no card list is typed anywhere.
 *   §2  behaviour: a Wisp that has been given a second ability keeps it
 *   §3  behaviour: and still does not sacrifice itself after combat
 *
 * §1 is red against HEAD on Infernal Wispweaver and on nothing else — the
 * other three flag users all print the blanket sentence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Harness } from '../src/harness.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import '../src/cards/registry.ts';
import printed from '../src/cards/printed.json' with { type: 'json' };
import { ent, spawn, toDeployment, withE } from './util.ts';

const PRINTED = printed as Record<string, { text?: string } | undefined>;

/** the printed text of a registered card, reminder markup and all */
function textOf(name: string): string {
  return PRINTED[name]?.text ?? '';
}

/** every StaticMod a card declares, from every channel that can carry one.
 * Read by NAME off an untyped view so this file compiles unchanged before and
 * after R268 adds the augment-box channel — a guard that cannot be run
 * against the code it is guarding proves nothing. */
function staticsOf(name: string): Record<string, unknown>[] {
  const def = getCard(name) as unknown as Record<string, unknown>;
  const box = (def.augmentBox ?? {}) as Record<string, unknown>;
  return [
    ...((def.statics ?? []) as Record<string, unknown>[]),
    ...((box.statics ?? []) as Record<string, unknown>[]),
  ];
}

/** "…lose all attributes and abilities", "…loses all abilities" — the
 * sentence shape that a whole-LAYER veto is the exact implementation of.
 * Derived from the text, so a new card printing it is covered the day it
 * lands and a card that stops printing it fails the day it stops. */
function printsBlanket(name: string, layer: 'abilities' | 'attrs'): boolean {
  const word = layer === 'abilities' ? 'abilit(?:y|ies)' : 'attributes?';
  return new RegExp(String.raw`\blos(?:e|es|ing)\s+all\b[^.]*\b${word}\b`, 'i')
    .test(textOf(name));
}

/** the cards whose behaviour declares each blanket flag, derived */
function flagUsers(flag: 'suppressAbilities' | 'suppressAttrs'): string[] {
  return allCardNames().filter(n => staticsOf(n).some(s => s[flag] === true));
}

/* ════════════════════════════════════════════════════════════════════════
 * 0. NON-VACUITY
 * ════════════════════════════════════════════════════════════════════════ */

test('§0 POSITIVE CONTROL: the blanket suppression flags are in use, and the text pass can read the pool', () => {
  const abilities = flagUsers('suppressAbilities');
  const attrs = flagUsers('suppressAttrs');
  assert.ok(abilities.length >= 3,
    `only ${abilities.length} card(s) declare suppressAbilities — §1 quantifies over this set, `
    + 'and an empty one passes while measuring nothing');
  assert.ok(attrs.length >= 2,
    `only ${attrs.length} card(s) declare suppressAttrs`);

  // the text pass has to actually be reading text: at least one member of the
  // population prints the blanket sentence, or the regex is dead and §1 would
  // fail everywhere for the wrong reason.
  assert.ok(abilities.some(n => printsBlanket(n, 'abilities')),
    'no card in the population prints "loses all abilities" — the derivation is broken, '
    + 'not the pool');
  assert.ok(allCardNames().some(n => textOf(n).length > 20),
    'printed.json is not reaching this file');
});

/* ════════════════════════════════════════════════════════════════════════
 * 1. THE GUARD
 * ════════════════════════════════════════════════════════════════════════ */

test('§1 GUARD: a card that switches off a whole layer must print a whole-layer clause', () => {
  for (const layer of ['abilities', 'attrs'] as const) {
    const flag = layer === 'abilities' ? 'suppressAbilities' : 'suppressAttrs';
    const wrong = flagUsers(flag).filter(n => !printsBlanket(n, layer));
    assert.deepEqual(wrong, [],
      `these cards set StaticMod.${flag} — a veto on the target's ENTIRE ${layer} layer — `
      + 'without printing a sentence that takes the whole layer away:\n  '
      + wrong.map(n => `${n}: ${JSON.stringify(textOf(n))}`).join('\n  ')
      + '\n\nR269: suppression is as wide as the clause that prints it. A card that names ONE '
      + 'behaviour must suppress that behaviour (StaticMod.suppressAbility), not the layer. '
      + 'The blanket flag is for "loses all abilities" and nothing else.');
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * 2-3. THE BEHAVIOUR THE OWNER REPORTED
 * ════════════════════════════════════════════════════════════════════════ */

/** a Wisp under a friendly Infernal Wispweaver, wearing a donated trigger */
function wispUnderWeaver(): { h: Harness; wisp: number } {
  const h = new Harness(4269);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Infernal Wispweaver');
  const wisp = spawn(h, p, 'Wisp');
  // "When another unit dies, put a +1/+1 counter on me" — a SECOND ability on
  // a Wisp, which is the thing the owner says wisps can technically have.
  withE(h, e => { e.attachMod(e.entity(wisp)!, 'Refuse Reclaimer', p, 'augment'); });
  return { h, wisp };
}

test('§2 a Wisp keeps an ability it was given — the weaver takes away one clause, not the layer', () => {
  const { h, wisp } = wispUnderWeaver();
  const p = h.state.deployPlayer!;
  const fodder = spawn(h, p, 'Unit Token');
  withE(h, e => { e.destroy(e.entity(fodder)!, 'dies'); });

  assert.equal(ent(h, wisp)!.counters, 1,
    'the Wisp is wearing Refuse Reclaimer, so another unit dying should put a +1/+1 counter '
    + 'on it. Infernal Wispweaver only says the Wisp does not sacrifice itself after combat — '
    + 'it says nothing about the Wisp\'s other abilities (owner report, 2026-08-30).');
});

test('§3 and the weaver still stops the sacrifice it does print', () => {
  // NEGATIVE CONTROL FIRST. Without it this test asserts "a unit I never
  // killed is still alive", which is true of every board ever built.
  const bare = new Harness(4270);
  toDeployment(bare);
  const q = bare.state.deployPlayer!;
  const lone = spawn(bare, q, 'Wisp');
  withE(bare, e => { e.fireEvent('afterCombat', { type: 'afterCombat', msg: '' } as never); });
  assert.equal(ent(bare, lone), undefined,
    'CONTROL: with no weaver in play a Wisp sacrifices itself after combat. If this passes '
    + 'trivially, the assertion below is measuring nothing.');

  const { h, wisp } = wispUnderWeaver();
  withE(h, e => { e.fireEvent('afterCombat', { type: 'afterCombat', msg: '' } as never); });
  assert.ok(ent(h, wisp),
    'the Wisp sacrificed itself anyway — "your wisps … do not sacrifice themselves after '
    + 'combat" is the half of the clause that IS live');
});
