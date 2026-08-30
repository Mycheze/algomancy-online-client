/* Every registered card's `image` must resolve to a real file.
 *
 * The Wraith spent its whole life pointing at 'Generic-Unit.jpg' with a
 * comment claiming there was no printed art for it — there was, and the card
 * rendered as an anonymous generic token in every client for as long as
 * nobody looked. Nothing in the suite could have caught that, because the
 * `image` field is a string and a string is always "valid".
 *
 * So: one test, over the whole registry, that opens the file.
 *
 * Synthetic cards registered by other test files are deliberately NOT a
 * problem here — `node --test` runs each test file in its own process, so
 * this one sees only what this file's imports register.
 *
 * ── R214: WHICH SYNTHETICS, AND THE ONE THAT HAS NO ART ────────────────
 *
 * The line above used to read "the two genuine synthetics in the pool (the
 * generic Unit Token)" — a count of two with one name after it, written when
 * there were two and never corrected when a third arrived. There are THREE,
 * and this file could only ever see two of them: it imported
 * `src/cards/registry.ts`, which owns `Unit Token` and `Beyond, Codex
 * Incarnate`, while `Alluring Attribute` is registered by `src/apply.ts`.
 *
 * Widening the import to `src/index.ts` made this test FAIL, immediately and
 * correctly — `Alluring Attribute: (no image field)`. That is a real finding
 * and not a false positive: the card has `image: ''` on purpose, because it is
 * a RULES-OWNED EFFECT HOLDER rather than anything a player sees. It exists so
 * `effectByKey` can resolve `ability:Alluring Attribute#0` when Divine
 * Intervention or Hexbane Shiitake retargets an {Alluring} trigger.
 *
 * So it is exempted — with a reason the machine re-checks (`ART_EXEMPT`
 * below), not a sentence. The three things that make it unrenderable are all
 * checkable and all checked: it is not a deck card, no card `creates` it, and
 * its `image` is deliberately EMPTY rather than a path that happens to be
 * broken. If any of those stops holding, something can now put it on screen
 * and it needs art like everything else.
 *
 * Seeds: none — this is a pure data guard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
// R214: the PUBLIC entry point, not `cards/registry.ts`. registry.ts registers
// only 494 of the 495 cards — the third synthetic (`Alluring Attribute`) is
// registered by `src/apply.ts`, which index.ts pulls. See the pool-sight floor
// at the foot of this file and test/180-pool-sight.test.ts.
import '../src/index.ts';
import { join } from 'node:path';
import { CARDS_DIR } from '../scripts/paths.mjs';

/** the card scans, resolved the same way ui/main.ts's ART and server/main.ts's
 * ART_DIR do — relative to this file, never to the process's cwd */
const ART_DIR = CARDS_DIR;

/** R214 — cards with no art because NOTHING CAN RENDER THEM. The reason is a
 * predicate, not a sentence: the staleness test below runs it, so an entry
 * whose card becomes renderable fails here instead of quietly waiving art for
 * a card a player can now see. */
const ART_EXEMPT: { name: string; why: string; unrenderable: (name: string) => string | null }[] = [
  {
    name: 'Alluring Attribute',
    why: 'R84/R214. Not a card: the {Alluring} attribute registered as one so that '
       + '`effectByKey` can resolve `ability:Alluring Attribute#0` — a rules-owned effect '
       + 'has to BE a registered card or Divine Intervention / Gravitational Correction / '
       + 'Hexbane Shiitake throw when they retarget an {Alluring} trigger. The queued '
       + 'trigger carries `sourceCard: <the allurer>` (apply.ts::queueAlluringTriggers), '
       + 'so ui/main.ts\'s `art()` is never called with this name.',
    unrenderable: name => {
      const c = getCard(name);
      if (c.image !== '') return `its image is ${JSON.stringify(c.image)}, not '' — somebody `
        + 'gave it art, which means somebody expects it on screen. Drop the exemption.';
      if (DECK_LIST.includes(name)) return 'it is in DECK_LIST now — it is dealt, drafted and '
        + 'shown in the card browser, so it needs art.';
      const creator = allCardNames().find(n => {
        const d = getCard(n);
        const effs = [d.spellEffect, d.graftEffect?.effect,
          ...(d.abilities ?? []).map(a => a.effect), ...(d.augmentText ?? []).map(a => a.effect)];
        return effs.some(e => e?.creates?.includes(name));
      });
      if (creator) return `${creator} now \`creates\` it, so it can reach play as a token and `
        + 'be rendered. It needs art.';
      return null;
    },
  },
];

test('every registered card names an image that exists under AlgomancyCards/', () => {
  const names = allCardNames();
  // an empty registry would make the loop below vacuously green, which is the
  // one way this guard could go quiet again
  assert.ok(names.length > 400, `the pool is registered (${names.length} cards)`);
  const exempt = new Set(ART_EXEMPT.map(e => e.name));
  const missing: string[] = [];
  for (const name of names) {
    if (exempt.has(name)) continue;                       // see ART_EXEMPT, and its staleness test
    const img = getCard(name).image;
    if (!img) { missing.push(`${name}: (no image field)`); continue; }
    if (!existsSync(join(ART_DIR, img))) missing.push(`${name}: ${img}`);
  }
  assert.deepEqual(missing, [],
    `card art missing from ${ART_DIR}:\n  ${missing.join('\n  ')}\n\n`
    + 'If the card genuinely cannot be rendered, add it to ART_EXEMPT — but the entry has to '
    + 'pass its own `unrenderable` predicate, so "it is never shown" has to be true of the '
    + 'code and not just of the comment.');
});

test('R214: every ART_EXEMPT entry still names an unrenderable card', () => {
  // The CT-83 shape: an exemption is a claim about the code as of the day it
  // was written, and unchecked it outlives the code. This one is re-derived
  // from the registry on every run rather than re-read from its own prose.
  const stale: string[] = [];
  for (const e of ART_EXEMPT) {
    if (!allCardNames().includes(e.name)) {
      stale.push(`ART_EXEMPT waives ${e.name}, which is not a registered card any more — `
        + `delete the entry. (Was: ${e.why})`);
      continue;
    }
    const broke = e.unrenderable(e.name);
    if (broke) stale.push(`ART_EXEMPT waives ${e.name}, but ${broke} (Was: ${e.why})`);
  }
  assert.deepEqual(stale, [],
    'an art exemption that outlives its reason is a card rendering as a broken image:\n  '
    + stale.join('\n  '));
});

// The specific gap this guard was written for.
test('the Wraith token uses its own printed art, not the generic-unit card', () => {
  const img = getCard('Wraith').image;
  assert.equal(img, 'Wraith.jpg', 'extracted from the oracle entry, not hand-written');
  assert.ok(existsSync(join(ART_DIR, img)), 'and the scan is on disk');
});

// ── R214 · POOL SIGHT ───────────────────────────────────────────────────
//
// This file sweeps the WHOLE card pool. `src/cards/registry.ts` is the natural
// card entry point and it registers 494 of the 495 cards: two of the three
// `registerSynthetic` calls are its own, and the third — `Alluring Attribute`
// — is in `src/apply.ts`. Eight sweeps imported registry.ts alone, saw 494,
// and NOT ONE OF THEM ASSERTED A POOL SIZE, so every clean sheet they produced
// silently covered one card fewer than it claimed.
//
// The floor is what stops that being reintroduced by an import change nobody
// reads as a behaviour change. `test/180-pool-sight.test.ts` holds the same
// floor for the whole suite and the guard that catches a ninth sweep.
test('R214: this sweep sees the whole card pool', () => {
  const n = allCardNames().length;
  assert.ok(n >= 495,
    `this sweep sees ${n} cards, not the full 495 — its imports reach src/cards/registry.ts `
    + 'but not src/apply.ts, so the synthetic Alluring Attribute is invisible to it and every '
    + 'verdict above covers one card fewer than it says. Import ../src/index.ts.');
  assert.ok(allCardNames().includes('Alluring Attribute'),
    'the pool is big enough but Alluring Attribute is not in it — the count floor above has '
    + 'been satisfied by some other card, which is not the thing being guarded');
});
