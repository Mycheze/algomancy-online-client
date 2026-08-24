/**
 * R125's BUG SHAPE, GENERALISED — the two attribute channels.
 *
 * Rotspore Herald printed "Everything is {deadly}" and was implemented as
 * ONE `statics` mod filtered to `t.kind === 'unit'`. Half its sentence was
 * therefore dead, and nothing in the suite could see it, because the half
 * that DID work worked. The owner ruled it literal on 2026-08-24 ("all the
 * cards in Algomancy are pretty literal") and it became R125.
 *
 * THE STRUCTURAL FACT BEHIND IT, which outlives that one card:
 * `dealEffectDamageAll` reads a damage source's attributes two different
 * ways, and a card that grants attributes outward has to reach both.
 *
 *   source                          | attrs read from        | channel
 *   --------------------------------|------------------------|--------------
 *   unit / spell token (an Entity)  | live `ownAttrs`        | `statics`
 *   a resolving SPELL (no entity)   | printed + grantedAttrs | `effectAttrs`
 *
 * WHICH ATTRIBUTES CARE is not a judgement call — the CARDS SAY SO, and this
 * file reads it off them rather than hardcoding a list. Every attribute's
 * printed reminder text names what it applies to, and the set is careful
 * about the distinction:
 *
 *   {Deadly}  "(Any damage from a deadly SOURCE will kill a unit.)"
 *   {Lethal}  "(Any combat damage from a lethal UNIT will kill a player.)"
 *
 * Deadly says "source" and omits "combat"; Lethal says "unit" and says
 * "combat". They are one word apart on purpose. So the rule is derived: an
 * attribute whose reminder says SOURCE can be carried by a spell, and a card
 * that grants it outward must reach the spell channel too.
 *
 * A card that grants such an attribute only to ITSELF is exempt and the
 * exemption is written down — The Omniphage ("I gain all attributes of units
 * in your bin") lands them on its own entity, which `ownAttrs` already reads
 * when it deals effect damage. That is a real distinction, not a loophole,
 * and the second test below fails if an exemption stops being true.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/cards/registry.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

interface Printed { name: string; text?: string }

function printedCards(): Printed[] {
  const raw = JSON.parse(
    fs.readFileSync(path.join(HERE, '..', 'src', 'cards', 'printed.json'), 'utf8')) as
    Printed[] | Record<string, Printed>;
  return Array.isArray(raw) ? raw : Object.values(raw);
}

/**
 * The attributes the POOL ITSELF describes as belonging to a "source" rather
 * than to a "unit", read out of the printed reminder texts. Derived, so a new
 * attribute (or a reworded reminder) moves this set without anyone editing a
 * list here.
 */
function sourceScopedAttrs(): Set<string> {
  const known = new Set<string>();
  for (const name of allCardNames()) {
    for (const a of getCard(name).attrs ?? []) known.add(a);
    for (const a of getCard(name).augmentAttrs ?? []) known.add(a);
    for (const m of getCard(name).statics ?? []) for (const a of m.attrs ?? []) known.add(a);
  }
  const out = new Set<string>();
  for (const c of printedCards()) {
    for (const m of (c.text ?? '').matchAll(/\{i\}\(([^)]*)\)/g)) {
      const reminder = m[1]!.toLowerCase();
      if (!reminder.includes('source')) continue;
      for (const a of known) if (reminder.includes(a.toLowerCase())) out.add(a);
    }
  }
  return out;
}

/**
 * Cards that grant a source-scoped attribute through `statics` and do NOT
 * declare the matching `effectAttrs` — each with the reason that is allowed.
 * A row here is a claim that the grant can never need the spell channel.
 */
const EXEMPT: Record<string, string> = {
  'The Omniphage':
    '"I gain all attributes of units in your bin" — the grant lands on its OWN entity, '
    + 'and a unit dealing effect damage is read through ownAttrs (which includes its '
    + 'statics) by dealEffectDamageAll. There is no outward grant, so no spell can '
    + 'ever be the source that needs it.',
};

test('a card granting a SOURCE-scoped attribute reaches the spell channel too (R125)', () => {
  const scoped = sourceScopedAttrs();
  // sanity on the derivation itself: if the reminder-text scrape silently
  // stopped working, every assertion below would pass vacuously.
  assert.ok(scoped.has('Deadly'),
    'the reminder-text scrape found no {Deadly} — it says "Any damage from a deadly '
    + 'SOURCE will kill a unit", so the derivation is broken, not the pool');
  assert.ok(!scoped.has('Lethal'),
    '{Lethal} reads "Any combat damage from a lethal UNIT will kill a player" — it is '
    + 'unit-scoped by its own reminder and must not be swept in');

  const gaps: string[] = [];
  for (const name of allCardNames()) {
    const def = getCard(name);
    const viaStatics = new Set((def.statics ?? []).flatMap(m => m.attrs ?? []));
    const viaEffect = new Set((def.effectAttrs ?? []).flatMap(m => m.attrs ?? []));
    for (const a of viaStatics) {
      if (!scoped.has(a) || viaEffect.has(a) || EXEMPT[name]) continue;
      gaps.push(`${name} grants {${a}} through 'statics' only`);
    }
  }
  assert.deepEqual(gaps, [],
    'These cards grant an attribute the pool describes as belonging to a SOURCE, but '
    + 'only through the `statics` channel — which a resolving SPELL never passes '
    + 'through, because it has no entity to hang statics on. Half the printed sentence '
    + 'is therefore dead, exactly as Rotspore Herald\'s was before R125. Either add an '
    + '`effectAttrs` mod granting the same attribute, or add the card to EXEMPT with '
    + 'the reason its grant can never land on a spell.');
});

test('every attribute-channel exemption is still doing a job — none outlives its cause', () => {
  const scoped = sourceScopedAttrs();
  const stale: string[] = [];
  for (const name of Object.keys(EXEMPT)) {
    const def = getCard(name);
    if (!def) { stale.push(`${name}: no longer a registered card`); continue; }
    const viaStatics = (def.statics ?? []).flatMap(m => m.attrs ?? []);
    if (!viaStatics.some(a => scoped.has(a))) {
      stale.push(`${name}: no longer grants any source-scoped attribute through statics`);
    }
  }
  assert.deepEqual(stale, [],
    'An exemption that no longer describes the card is the shape this repo keeps '
    + 'relearning: a park note is a claim about the engine on the day it was written. '
    + 'Delete the row.');
});
