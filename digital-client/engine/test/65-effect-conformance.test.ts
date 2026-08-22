/* EFFECT CONFORMANCE — two standing guarantees about what a card effect does,
 * both enforced by ONE recording wrapper driven over a few hundred fuzz games.
 *
 * The wrapper lives entirely in this file. There is no recording hook in
 * engine.ts, and nothing about the shipped engine knows this test exists: it
 * wraps every registered EffectDef.run in place (the registry stores the very
 * objects effectByKey() hands the engine) and patches the four E methods that
 * put a token onto the board. Every resolution is therefore seen however it
 * was reached — cast, graft rider, donated [Augment] text, granted text (R63),
 * ambush.
 *
 * ── 1. R69: every token an effect creates is DECLARED (`EffectDef.creates`).
 *
 * The inspector's "tokens it creates" panel used to scrape a card's PRINTED
 * text for a registered token name. That was wrong three ways at once: it
 * missed plurals ("Create three Wraiths"), it could never match a token whose
 * card is also in DECK_LIST (Echo of Despair, Hooba-God), and printed text is
 * the card's HISTORY, not its rules — granted, donated and graft-composite
 * text is invisible to it. The panel now reads the declarations, with the scan
 * as a fallback only.
 *
 * A declaration is worth exactly as much as the thing that keeps it true, so
 * this is that thing: what an effect actually spawned must be a subset of what
 * it declared. A card that starts making a token and forgets to say so FAILS
 * here. Without that the declarations would rot exactly the way the scrape did.
 *
 * ── 2. An effect must never RESOLVE INTO SILENCE.
 *
 * The playtest report behind this is "Burgeon resolving didn't give me the
 * choice to double the power or defense. It just did nothing." Whatever the
 * specific cause, the class of defect is an effect that runs to completion and
 * emits no event at all: the item leaves the stack, the board is unchanged,
 * the log says nothing, and the player cannot tell a rule from a bug. Sixty-odd
 * bare `return`s across the card sets could do that.
 *
 * So: an effect that completes without emitting a single engine event is a
 * FAILURE here. "Nothing happened" is a legitimate outcome; not SAYING so
 * never is. A run that suspends on a decision (ctx.choose) is not a completed
 * run and is exempt — the engine re-executes it from the top once answered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E } from '../src/engine.ts';
import { allCardNames, ambushEffect, getCard, type EffectDef } from '../src/cards/dsl.ts';
import { createsOf, DECK_LIST, effectsOf } from '../src/cards/registry.ts';
import { fuzzGame } from './fuzz.ts';
import type { CardName, Entity, Seat } from '../src/types.ts';

// ── the recorder ──────────────────────────────────────────────────────

/** the cards each EffectDef belongs to (a shared helper def belongs to all of
 * them — the declaration is shared too, so the assertion is the same) */
const owners = new Map<EffectDef, string[]>();
/** token names an EffectDef was actually observed putting onto the board */
const recorded = new Map<EffectDef, Set<string>>();
/** EffectDefs whose run() was ENTERED at least once — the drive's reach. Not
 * the same as `completed`: an effect that always suspends on a decision is
 * driven but never completes, and it still counts as covered. */
const attempted = new Set<EffectDef>();
/** EffectDefs whose run() completed at least once (no suspension, no throw) */
const completed = new Set<EffectDef>();
/** how many completed runs of an EffectDef emitted no event at all */
const silent = new Map<EffectDef, number>();
/** a token that reached the board with no effect running — see the test below */
const orphans: string[] = [];

/** the effect currently running; a stack, because an effect may call another */
const frames: EffectDef[] = [];

for (const name of allCardNames()) {
  // effectsOf covers spell / graft / abilities / [Augment] text; the ambush
  // mode's effect is generated per card and only exists for a printed [Ambush]
  const defs = [...effectsOf(name)];
  if (getCard(name).ambush) defs.push(ambushEffect(name));
  for (const def of defs) {
    const list = owners.get(def);
    if (list) { if (!list.includes(name)) list.push(name); } else owners.set(def, [name]);
  }
}

for (const def of owners.keys()) {
  const inner = def.run;
  def.run = (g, ctx) => {
    const eventsBefore = g.events.length;
    attempted.add(def);
    frames.push(def);
    try {
      inner(g, ctx);
    } finally {
      frames.pop();
    }
    // reached only on a COMPLETED run — a Suspended (or any other throw) skips
    // it, because a suspended run is re-executed from the top once answered
    completed.add(def);
    if (g.events.length === eventsBefore) silent.set(def, (silent.get(def) ?? 0) + 1);
  };
}

/** attribute one token to the innermost running effect */
function record(token: string): void {
  const f = frames[frames.length - 1];
  if (!f) { orphans.push(token); return; }
  let set = recorded.get(f);
  if (!set) { set = new Set(); recorded.set(f, set); }
  set.add(token);
}

type SpawnOpts = Parameters<E['spawnUnit']>[3];
const origSpawn = E.prototype.spawnUnit;
E.prototype.spawnUnit = function (seat: Seat, name: CardName, region: number, opts: SpawnOpts = {}): Entity {
  // `token: true` is what makes this a CREATION; a plain spawnUnit is a real
  // card being put into play out of a bin or a hand (Exhume, Wake the Dead),
  // which creates nothing.
  if (opts.token) record(name);
  return origSpawn.call(this, seat, name, region, opts);
};
const origWraith = E.prototype.createWraith;
E.prototype.createWraith = function (seat: Seat, region?: number): Entity {
  record(E.WRAITH);
  return origWraith.call(this, seat, region);
};
const origSpellToken = E.prototype.createSpellToken;
E.prototype.createSpellToken = function (seat: Seat, name: CardName, x: number, region?: number): Entity {
  record(name);
  return origSpellToken.call(this, seat, name, x, region);
};
// the FOURTH way a token reaches the board: a Wraith applied as a MOD rather
// than spawned as a body (Blight's End, Plague Ritual, Xzydris, the Wraith's
// own death trigger). It is a token created by that card just as much.
const origAugmentWraith = E.prototype.augmentWraith;
E.prototype.augmentWraith = function (host: Entity, by: Seat): Entity {
  record(E.WRAITH);
  return origAugmentWraith.call(this, host, by);
};

// ── the drive ─────────────────────────────────────────────────────────

/** Seeds chosen for breadth, not for a number: shared-deck games see the whole
 * pool, draft games see the element subsets. Raise this if a card ever slips
 * through uncovered — coverage is asserted below so it cannot quietly fall. */
test('effect conformance: drive the pool', () => {
  for (let seed = 1; seed <= 90; seed++) fuzzGame(seed, 2500);
  for (let seed = 1001; seed <= 1050; seed++) fuzzGame(seed, 2500, 'draft');
  assert.ok(attempted.size > 0, 'the fuzz drove no card effects at all');
});

// ── 1. the `creates` declarations ─────────────────────────────────────

test('every token an effect creates is declared in EffectDef.creates', () => {
  const problems: string[] = [];
  for (const [def, tokens] of recorded) {
    const cards = owners.get(def)!;
    if (def.createsAny) {
      // the name is computed (Arcane Echo copies target token) — it may be
      // anything, but it must still be a real registered card
      for (const t of tokens) {
        try { getCard(t); } catch {
          problems.push(`${cards.join('/')}: spawned unregistered "${t}"`);
        }
      }
      continue;
    }
    const declared = new Set(def.creates ?? []);
    for (const t of tokens) {
      if (declared.has(t)) continue;
      problems.push(
        `${cards.join('/')}: creates "${t}" but its EffectDef declares [${[...declared].join(', ') || '—'}]`);
    }
  }
  assert.deepEqual(problems, [],
    `undeclared token creations — add them to that EffectDef's \`creates\`:\n  ${problems.join('\n  ')}`);
});

test('createsOf() reports every token the card was seen making', () => {
  // the card-level view the inspector actually reads: what createsOf(name)
  // returns must cover everything any of that card's effects spawned.
  const problems: string[] = [];
  for (const [def, tokens] of recorded) {
    if (def.createsAny) continue;
    for (const name of owners.get(def)!) {
      const declared = createsOf(name);
      for (const t of tokens) {
        if (!declared.includes(t)) problems.push(`createsOf(${name}) is missing "${t}"`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('a token never reaches the board outside an effect', () => {
  // If this ever fires, some engine path creates a token with no EffectDef
  // running — and no declaration could ever describe it. Worth knowing about.
  assert.deepEqual([...new Set(orphans)], []);
});

test('every declared token name is a registered card', () => {
  const problems: string[] = [];
  for (const name of allCardNames()) {
    for (const t of createsOf(name)) {
      try { getCard(t); } catch { problems.push(`${name} declares unknown token "${t}"`); }
    }
  }
  assert.deepEqual(problems, []);
});

test('tokens are the only thing declared: no deck card is listed as created', () => {
  // "Create a copy of me" tokens (Echo of Despair, Hooba-God, Swarmling) are
  // deck cards spawned WITH token: true — legitimately declared. Anything else
  // in DECK_LIST would mean a declaration confused "put into play" (Exhume,
  // Wake the Dead — not creations) with "create".
  const copyTokens = new Set(['Echo of Despair', 'Hooba-God', 'Swarmling']);
  const playable = new Set(DECK_LIST);
  for (const name of allCardNames()) {
    for (const t of createsOf(name)) {
      if (playable.has(t) && !copyTokens.has(t)) {
        assert.fail(`${name} declares deck card "${t}" as a token it creates`);
      }
    }
  }
});

// ── 2. no effect resolves into silence ────────────────────────────────

test('no effect resolves into silence — every completed run says something', () => {
  // The fix for "it just did nothing". A guard that aborts an effect must LOG
  // why: `g.ev('info', '<Card>: <why> — nothing happens.')`. Sixty-odd bare
  // `return`s across the card sets were fixed to satisfy this, and it is the
  // assertion that keeps the next one from being written.
  const problems: string[] = [];
  for (const [def, n] of silent) {
    problems.push(`${owners.get(def)!.join('/')} resolved silently ${n}× — add a g.ev('info', …) to that path`);
  }
  problems.sort();
  assert.deepEqual(problems, [],
    `effects that ran to completion and emitted nothing:\n  ${problems.join('\n  ')}`);
});

// ── coverage: neither guarantee may quietly lose its reach ────────────

test('the drive actually covers the pool (the guarantees cannot rot unseen)', () => {
  // Both assertions above are one-directional: an effect that never runs can
  // never be caught lying, and one that never runs can never be caught silent.
  // Absolute floors, not percentages — adding cards must not lower the bar.
  const total = owners.size;
  assert.ok(attempted.size >= 260,
    `only ${attempted.size}/${total} effects were driven — the conformance pass has lost its reach`);
  assert.ok(completed.size >= 245,
    `only ${completed.size}/${total} effects ran to completion — the silence check has lost its reach`);

  const declaring = [...owners.keys()].filter(d => (d.creates?.length ?? 0) > 0 || d.createsAny);
  const seen = declaring.filter(d => recorded.has(d));
  assert.ok(seen.length >= 45,
    `only ${seen.length}/${declaring.length} token-making effects were observed creating anything`);
});
