/* EFFECT CONFORMANCE — two standing guarantees about what a card effect does,
 * both enforced by ONE recording wrapper driven over EVERY EffectDef in the
 * registry, deterministically.
 *
 * ── WHY THE DRIVE IS WHAT IT IS (CARD-TODO #61, R182)
 *
 * This file used to be driven by 140 FUZZ GAMES. The two assertions were right
 * and are unchanged; the DRIVE was the defect, and it was a structural one:
 * which branches a random walk reaches is a function of UNRELATED BEHAVIOUR,
 * so a change to one card file reddened this test inside a DIFFERENT card file
 * that nobody had touched. The R166 agent had to edit three files outside its
 * own set for exactly that (Adversary of the Deep, Aethercap Siphoner, Flux
 * Constructor) and wrote "this will recur every round"; Channeled Amalgam's own
 * comment records the same thing happening under R84, and Earthbound
 * Replicator's records it again. It was never one card's bug — it was the fuzz
 * arriving at a pre-existing hole on a schedule nobody chose.
 *
 * So the drive is now a DETERMINISTIC PASS OVER EVERY EFFECT the registry
 * holds: each `EffectDef` is resolved in two fixed board states with a context
 * built from the engine's own machinery. What this file reaches is now a
 * function of THIS FILE and the effect under test, and of nothing else.
 *
 * MEASURED, 2026-08-25, on the same pool (431 EffectDefs over 414 cards):
 *
 *                                     140-game fuzz     this pass
 *     EffectDefs entered                 280 / 431       431 / 431
 *     cards with effects reached         272 / 414       414 / 414
 *     token-making defs seen creating     49 / 84         76 / 84
 *     completed runs that said nothing      0              16
 *     wall clock                          ~45 s           ~2 s
 *
 * The pass is strictly wider on every axis the old drive had, which is the
 * bar this replacement had to clear: a stabler test that reached less would
 * have been a bad trade. The sixteen silent completions it found on its first
 * run are listed in SILENT_KNOWN below, itemised — fifteen of them are one
 * defect shape (R25's "each opponent" over an empty region) that the fuzz had
 * found three instances of and walked past the rest of.
 *
 * WHAT THE CHANGE COSTS, said out loud. The fuzz composed its contexts through
 * a real game; this pass builds them. Four things keep that honest:
 *
 *   · targets come from the engine's own `targetCandidates` + `specForSlot` +
 *     `resolveTargetRef` — the very calls `collectTargets` makes at cast, so a
 *     target this pass supplies is one the cast window would have offered;
 *   · a triggered ability's event is accepted only if the ability's OWN `when`
 *     returns true for it (asked on a throwaway clone, because a `when` may
 *     stamp state — R172's Ancient One does);
 *   · a modal effect's `mode` comes from that effect's own `modes.options`;
 *   · and `81-card-drill` still drives 490/491 cards through the REAL action
 *     path — hand, `legalActions`, `playCard`, priority, resolution — carrying
 *     this same silence assertion. That file is the faithful-but-partial net;
 *     this one is the exhaustive-but-synthetic net. Neither subsumes the other
 *     and both are needed.
 *
 * One observation did not survive: the fuzz occasionally saw the R104
 * REPLACEMENT layer create a token, and printed what it made. This pass never
 * arranges a replacement, so `byReplacement` stays empty here. That coverage
 * lives in `87-replacement-layer` and `88-replacement-conformance`, which test
 * the layer directly; the orphan assertion below is unchanged and still holds.
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
 * the log says nothing, and the player cannot tell a rule from a bug.
 *
 * So: an effect that completes without emitting a single engine event is a
 * FAILURE here. "Nothing happened" is a legitimate outcome; not SAYING so
 * never is. A run that SUSPENDS is not a completed run and is exempt — the
 * engine re-executes it from the top once answered.
 *
 * ── ROUTES. Enumerating the registry by hand rather than watching a game
 * reaches every route a resolution can arrive by, because a route is just
 * which slot the `EffectDef` was read out of: `spellEffect`, `graftEffect`
 * (the graft rider and every composite built on it), `abilities[i]`,
 * `augmentText[i]` (a card's own [Augment] text AND the same object donated to
 * a host by a mod), and `ambushEffect()`. R63's GRANTED text is the same
 * object again — `collectTriggersFrom` looks the granted card's ability up in
 * this very registry — so it is covered by the enumeration, not missed by it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, Suspended } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import { Harness } from '../src/harness.ts';
import {
  allCardNames, ambushEffect, costAmount, getCard, specForSlot,
  type EffectCtx, type EffectDef, type ResolvedTarget,
} from '../src/cards/dsl.ts';
import { createsOf, DECK_LIST } from '../src/cards/registry.ts';
import { giveResources, spawn, toDeployment, toNextBattle } from './util.ts';
import type {
  CardName, EngineEvent, Entity, EntityId, EventType, GameState, Seat, StackItem,
} from '../src/types.ts';

// ── the slots: every effect the registry holds, with the route it came by ──

type Route = 'spell' | 'graft' | 'ability' | 'augment' | 'ambush';
interface Slot { def: EffectDef; card: string; route: Route; index: number; label: string }

const slots: Slot[] = [];
/** the cards each EffectDef belongs to (a shared helper def belongs to all of
 * them — the declaration is shared too, so the assertion is the same) */
const owners = new Map<EffectDef, string[]>();

for (const name of allCardNames()) {
  const c = getCard(name);
  const push = (def: EffectDef, route: Route, index: number, label: string): void => {
    slots.push({ def, card: name, route, index, label });
    const l = owners.get(def);
    if (l) { if (!l.includes(name)) l.push(name); } else owners.set(def, [name]);
  };
  if (c.spellEffect) push(c.spellEffect, 'spell', 0, `spell:${name}`);
  if (c.graftEffect) push(c.graftEffect.effect, 'graft', 0, `graft:${name}`);
  (c.abilities ?? []).forEach((a, i) => push(a.effect, 'ability', i, `ability:${name}#${i}`));
  (c.augmentText ?? []).forEach((a, i) => push(a.effect, 'augment', i, `augment:${name}#${i}`));
  if (c.ambush) push(ambushEffect(name), 'ambush', 0, `ambush:${name}`);
}

/** the triggered declaration behind a slot, when it has one — its `events`
 * say what to synthesise and its `when` says which synthesis is FAIR */
function triggeredOf(s: Slot): {
  self?: boolean; events: EventType[]; when?: (g: E, self: Entity, ev: EngineEvent) => boolean;
} | undefined {
  const c = getCard(s.card);
  const a = s.route === 'ability' ? c.abilities?.[s.index]
    : s.route === 'augment' ? c.augmentText?.[s.index] : undefined;
  return a && a.type === 'triggered' ? a : undefined;
}

// ── the recorder ──────────────────────────────────────────────────────

/** token names an EffectDef was actually observed putting onto the board */
const recorded = new Map<EffectDef, Set<string>>();
/** tokens created by the R104 REPLACEMENT LAYER, which is not an effect */
const byReplacement = new Set<string>();
/** a token that reached the board with no effect running — see the test below */
const orphans: string[] = [];

/** the effect currently being driven; null while the boards are being built,
 * which is what keeps the rig's own furniture out of `orphans` */
let frame: EffectDef | null = null;
/** recording is OFF while a board is furnished and ON only inside a run */
let live = false;

/**
 * Attribute one token to the effect being driven.
 *
 * ⚠ R104: a token created while a REPLACEMENT is running belongs to no effect
 * and is exempt from both guarantees below. That is not a hole, it is what a
 * replacement IS: `EffectDef.creates` is a property of an effect (R69 built it
 * for the inspector's "tokens it creates" panel, which shows what a STACK ITEM
 * will do), and a replacement has no `EffectDef`, never reaches the stack and
 * has no item to inspect. The exemption is gated on the engine's own
 * `E.inReplacement`, so it cannot quietly widen: it is true only inside
 * `E.replaceTokenCreation`, `E.replaceCounters` and `E.settleTokenBatch`.
 */
function record(token: string, g: E): void {
  if (!live) return;
  if (g.inReplacement) { byReplacement.add(token); return; }
  if (!frame) { orphans.push(token); return; }
  let set = recorded.get(frame);
  if (!set) { set = new Set(); recorded.set(frame, set); }
  set.add(token);
}

type SpawnOpts = Parameters<E['spawnUnit']>[3];
const origSpawn = E.prototype.spawnUnit;
E.prototype.spawnUnit = function (seat: Seat, name: CardName, region: number, opts: SpawnOpts = {}): Entity {
  // `token: true` is what makes this a CREATION; a plain spawnUnit is a real
  // card being put into play out of a bin or a hand (Exhume, Wake the Dead),
  // which creates nothing.
  if (opts.token) record(name, this);
  return origSpawn.call(this, seat, name, region, opts);
};
const origWraith = E.prototype.createWraith;
E.prototype.createWraith = function (seat: Seat, region?: number): Entity {
  record(E.WRAITH, this);
  return origWraith.call(this, seat, region);
};
const origSpellToken = E.prototype.createSpellToken;
E.prototype.createSpellToken = function (seat: Seat, name: CardName, x: number, region?: number): Entity {
  record(name, this);
  return origSpellToken.call(this, seat, name, x, region);
};
// the FOURTH way a token reaches the board: a Wraith applied as a MOD rather
// than spawned as a body (Blight's End, Plague Ritual, Xzydris, the Wraith's
// own death trigger). It is a token created by that card just as much.
const origAugmentWraith = E.prototype.augmentWraith;
E.prototype.augmentWraith = function (host: Entity, by: Seat): Entity {
  record(E.WRAITH, this);
  return origAugmentWraith.call(this, host, by);
};

// ── the two board states ──────────────────────────────────────────────
//
// Which branch of an effect runs is a property of the BOARD, not of the
// effect (81-card-drill's three scenarios make the same point), and the two
// here are chosen for the one distinction that decides the largest number of
// branches in this pool:
//
//   'home'   — deployment, the caster's own home region. R25: a home region
//              out of battle lists only its OWNER in `presentSeats`, so every
//              "each opponent" loop runs zero times. An ordinary, reachable
//              situation, and the one 85-silent-branches §9 already fixed
//              three cards for.
//   'battle' — an attack declared, so the battle region holds BOTH seats.
//              "each opponent" finds somebody, "target opponent" has a legal
//              target at all, and the battle-only clauses are live.

const BODIES = ['Tidal Menace', 'The Foretold', 'Curio Drifter', 'Bubb'];
const ELS = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'] as const;

/** everything an effect might reach for, on both sides: bodies at four costs
 * and four defences, a unit token, a Wraith, a cached card, a stocked bin and
 * a stocked hand, and every element open. */
function furnish(h: Harness, A: Seat, D: Seat): void {
  for (const seat of [A, D] as Seat[]) for (const k of ELS) giveResources(h, seat, k, 4);
  for (const seat of [A, D] as Seat[]) {
    for (const b of BODIES) { try { spawn(h, seat, b); } catch { /* a spawn trigger suspended */ } }
  }
  const e = new E(h.state);
  for (const seat of [A, D] as Seat[]) {
    try { e.spawnUnit(seat, 'Ignis Sprite' as CardName, e.homeRegion(seat), { token: true }); } catch { /* */ }
    try { e.createWraith(seat, e.homeRegion(seat)); } catch { /* */ }
    try { e.cacheCard(seat, 'Immolate' as CardName, 'hand'); } catch { /* */ }
    const p = h.state.players[seat]!;
    p.bin.push('Tidal Menace', 'The Foretold', 'Immolate', 'Ignis Sprite');
    p.hand.push('Immolate', 'Ignis Sprite', 'Tidal Menace');
  }
  try { e.settle(); } catch { /* a spawn trigger suspended */ }
}

interface Board { name: string; state: GameState; A: Seat; D: Seat; region: number }

function homeBoard(): Board {
  const h = new Harness(9100);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  furnish(h, A, D);
  return { name: 'home', state: h.state, A, D, region: new E(h.state).homeRegion(A) };
}

function battleBoard(): Board {
  const h = new Harness(9100);
  toDeployment(h);
  const first = h.state.deployPlayer!;
  furnish(h, first, (1 - first) as Seat);
  toNextBattle(h);
  const att = h.state.battle!.attacker;
  // the widest attack `legalActions` offers — every eligible column, so the
  // attacker really enters the defender's region and both seats are present
  const declares = legalActions(h.state, att).filter(a => a.type === 'declareAttack');
  h.do(declares[declares.length - 1]!);
  for (const seat of [0, 1] as Seat[]) for (const k of ELS) giveResources(h, seat, k, 4);
  return { name: 'battle', state: h.state, A: att, D: (1 - att) as Seat, region: h.state.battle!.region };
}

const BOARDS: Board[] = [homeBoard(), battleBoard()];

// ── the rig ───────────────────────────────────────────────────────────

const BAIT_ID = 4242;
/** a real, resolvable opponent item on the stack, so "negate target effect"
 * and "change the targets of target effect" have something to aim at */
function bait(g: E, id: number, controller: Seat, region: number, victim: EntityId): void {
  g.s.stack.push({
    id, kind: 'spell', card: 'Overbloom' as CardName, label: 'Overbloom',
    controller, region, negated: false,
    parts: [{ effectKey: 'spell:Overbloom', targets: [{ unit: victim }] }],
  } as StackItem);
}

/** an event to hand a triggered ability. Every field a trigger in this pool
 * reads is populated; which of the variants is USED is decided by the
 * ability's own `when`, not here. */
function synthEvent(
  type: EventType, region: number, seat: Seat, src: EntityId | undefined, n: number, why?: string,
): EngineEvent {
  return {
    type, msg: '(conformance drive)',
    data: {
      seat, by: seat, n, amount: n, life: n, card: 'Overbloom', region,
      mod: 9_999_003, item: BAIT_ID, binNth: 0, power: 2, defense: 2,
      ...(why !== undefined ? { why } : {}),
      ...(src !== undefined ? { unit: src, source: src } : {}),
    },
  };
}

interface Run {
  label: string; board: string;
  /** the run completed (no suspension, no throw) */
  completed: boolean;
  /** completed and emitted no event at all */
  silent: boolean;
  /** the rig could give this effect everything it declares it needs. A run
   * that is NOT fair cannot convict: an effect handed no target, or an event
   * its own `when` rejects, is being asked a question a game never asks. */
  fair: boolean;
  why: string;
}

const runs: Run[] = [];

function driveOne(board: Board, s: Slot): void {
  const g = new E(structuredClone(board.state) as GameState);
  const { A, D, region } = board;
  const card = getCard(s.card);

  // a carrier for anything that is not a spell: "me" has to be somebody
  let sourceId: EntityId | undefined;
  if (s.route !== 'spell' && (card.kind === 'unit' || card.kind === 'spellUnit')) {
    try {
      sourceId = g.spawnUnit(A, s.card as CardName, region).id;
      try { g.settle(); } catch { /* a spawn trigger suspended */ }
    } catch { /* not spawnable here */ }
  }
  const enemy = g.unitsOf(D, region)[0] ?? g.unitsOf(D, g.homeRegion(D))[0];
  if (enemy) bait(g, BAIT_ID, D, region, enemy.id);
  // a second bait aimed at the carrier, for "target effect TARGETING ME"
  if (sourceId !== undefined) bait(g, BAIT_ID + 1, D, region, sourceId);

  let fair = true, why = '';

  // ── targets, through the engine's own cast-time machinery ───────────
  let x = 2;
  let targets: ResolvedTarget[] = [];
  if (s.def.targets) {
    const spec = s.def.targets;
    let want = 0;
    // X is not free: a `count: 'X'` spec asks for X targets and a `restrict`
    // may read `ctx.x` (Abduct's "cost [x] or less"). Try a fixed ladder and
    // keep the first X that fills every slot — deterministic, and the same
    // ladder for every effect.
    for (const xx of [2, 5, 9, 1, 0]) {
      const w = Math.max(1, spec.count === 'X' ? xx : (spec.count ?? 1)) + (spec.extraSlots ?? 0);
      const got: ResolvedTarget[] = [];
      const taken = new Set<string>();
      for (let i = 0; i < w; i++) {
        let refs;
        try {
          refs = g.targetCandidates(specForSlot(spec, i), region, undefined, A, sourceId, xx, got, null)
            .filter(c => !taken.has(JSON.stringify(c)));
        } catch { break; }
        const ref = refs[0];
        if (!ref) break;
        taken.add(JSON.stringify(ref));
        const r = g.resolveTargetRef(ref);
        if (r) got.push(r);
      }
      want = w;
      if (got.length >= w) { targets = got; x = xx; break; }
      if (got.length > targets.length) { targets = got; x = xx; }
    }
    if (targets.length < want) { fair = false; why = `targets ${targets.length}/${want}`; }
  }

  // ── the triggering event, gated by the ability's own `when` ─────────
  const trig = triggeredOf(s);
  let event: EngineEvent | null = null;
  if (trig?.events.length) {
    const ally = g.unitsOf(A, region).find(u => u.id !== sourceId);
    const foe = g.unitsOf(D, region)[0];
    const sources: (EntityId | undefined)[] = trig.self ? [sourceId] : [sourceId, ally?.id, foe?.id];
    const shapes = [[3, 'combat'], [-3, 'combat'], [3, undefined], [-3, undefined]] as const;
    outer:
    for (const type of trig.events) {
      for (const seat of [A, D] as Seat[]) {
        for (const src of sources) {
          for (const [n, w] of shapes) {
            const cand = synthEvent(type, region, seat, src, n, w);
            if (!trig.when) { event = cand; break outer; }
            // ⚠ a `when` may MUTATE — R172's Ancient One stamps a scan budget
            // on itself — so it is asked on a throwaway clone and the board
            // the effect actually runs on is never touched by the search.
            const probe = new E(structuredClone(g.s) as GameState);
            const pself = sourceId !== undefined ? probe.entity(sourceId) : undefined;
            try { if (pself && trig.when(probe, pself, cand)) { event = cand; break outer; } } catch { /* */ }
          }
        }
      }
    }
    if (!event) {
      fair = false;
      why = `${why ? `${why}; ` : ''}no event this ability's own \`when\` accepts`;
      event = synthEvent(trig.events[0]!, region, D, sourceId, 3, 'combat');
    }
  }

  // ── the receipt for a bracketed cast cost (R35) ─────────────────────
  const costPaid = s.def.castCost ? ((): EffectCtx['costPaid'] => {
    const cc = s.def.castCost!;
    const amt = costAmount(cc) ?? x;
    switch (cc.kind) {
      case 'sacrificeUnit':
        return { sacrificed: { card: 'Tidal Menace' as CardName, power: 2, defense: 2 } };
      case 'sacrificeUnits':
        return {
          sacrificedUnits: [{
            unit: 9_999_004 as EntityId, card: 'Tidal Menace' as CardName,
            power: 2, defense: 2, counters: 0,
          }], x: amt, xDone: true,
        };
      case 'payLife': return { life: amt, x: amt, xDone: true };
      case 'discardCard': return { discarded: ['Immolate' as CardName], x: amt, xDone: true };
      case 'gainDebt': return { debt: amt };
      case 'removeCounters':
        return {
          counters: [{ unit: sourceId ?? (9_999_004 as EntityId), card: s.card as CardName, n: amt }],
          x: amt, xDone: true,
        };
      case 'eraseBin': return { erased: ['Immolate' as CardName], x: amt, xDone: true };
      default: return undefined;
    }
  })() : undefined;

  // ── the declared mode (R57) and subject (R144), from their own specs ─
  const item = {
    id: 7777, kind: 'spell', card: s.card as CardName, label: s.card, controller: A,
    region, negated: false, x, parts: [{ effectKey: `${s.route}:${s.card}`, targets: [] }],
  } as unknown as StackItem;
  let mode: unknown;
  if (s.def.modes) {
    try { mode = s.def.modes.options(g, item, item.parts[0]!)[0]?.value ?? null; } catch { mode = null; }
  }
  let subject: Entity | null = null;
  if (s.def.subject) {
    subject = g.unitsOf(A, region).find(u => u.id !== sourceId) ?? g.unitsOf(A, region)[0] ?? null;
  }

  const ctx = {
    controller: A, sourceName: s.card, region, targets, x,
    ...(sourceId !== undefined ? { sourceId } : {}),
    ...(costPaid ? { costPaid } : {}),
    ...(s.def.modes ? { mode } : {}),
    ...(s.def.subject ? { subject } : {}),
    event,
    eraseSelf: () => {}, spawnUnder: () => {}, spawnWearing: () => {}, refundBudget: () => {},
    // answer every mid-resolution question with its first option, exactly as
    // 85-silent-branches' rig does. Answering inline rather than suspending is
    // what lets a run REACH COMPLETION, which is what the silence check is
    // about.
    choose: (_k: string, dec: { options: { value: unknown }[] }) => dec.options[0]?.value,
  } as unknown as EffectCtx;

  const before = g.events.length;
  let completed = false;
  live = true; frame = s.def;
  try {
    s.def.run(g, ctx);
    completed = true;
  } catch (err) {
    // a Suspended is not a completed run and never was — the engine replays a
    // suspended run from the top once the decision is answered. Anything else
    // rethrows: a card that throws is a defect this file must not swallow.
    if (!(err instanceof Suspended)) throw err;
  } finally {
    live = false; frame = null;
  }
  runs.push({
    label: s.label, board: board.name, completed,
    silent: completed && g.events.length === before, fair, why,
  });
}

test('effect conformance: drive every effect in the registry', () => {
  for (const board of BOARDS) for (const s of slots) driveOne(board, s);
  assert.equal(runs.length, slots.length * BOARDS.length,
    'every effect must be driven in every board state');
});

/** the verdict per slot: judged on its FAIR runs where it has any, and on all
 * of them where it has none (so a slot the rig cannot furnish is still seen). */
function verdicts(): Map<string, { silent: boolean; fair: boolean; where: string[]; why: string }> {
  const out = new Map<string, { silent: boolean; fair: boolean; where: string[]; why: string }>();
  const byLabel = new Map<string, Run[]>();
  for (const r of runs) (byLabel.get(r.label) ?? byLabel.set(r.label, []).get(r.label)!).push(r);
  for (const [label, rs] of byLabel) {
    const fair = rs.filter(r => r.fair);
    const judged = fair.length ? fair : rs;
    const sil = judged.filter(r => r.silent);
    out.set(label, {
      silent: sil.length > 0, fair: fair.length > 0,
      where: sil.map(r => r.board),
      why: rs.map(r => `${r.board}: ${r.why || 'ok'}`).join('; '),
    });
  }
  return out;
}

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

test('a token never reaches the board outside an effect or a replacement', () => {
  // If this ever fires, some engine path creates a token with no EffectDef
  // running — and no declaration could ever describe it. Worth knowing about.
  //
  // Recording is live only INSIDE a driven run, so the rig's own furniture
  // (the token and the Wraith `furnish` puts on each side) can never be
  // mistaken for one.
  assert.deepEqual([...new Set(orphans)], []);
  if (byReplacement.size) {
    console.log('    R104: tokens created by a REPLACEMENT (no EffectDef to declare them): '
      + `${[...byReplacement].sort().join(', ')}`);
  }
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

/**
 * Effects that COMPLETE A RUN AND SAY NOTHING, each with the reason it is
 * tolerated for now. Every one of these was found by the deterministic pass on
 * the day it replaced the fuzz (R182); the fuzz had reached three members of
 * the first family and walked past the other twelve for weeks.
 *
 * It is deliberately not a `{ todo: true }` test — a todo can never fail,
 * which is exactly how a dead card survived two playtest reports (see the head
 * of card-ledger.ts). The self-invalidation test below fails the moment one of
 * these starts announcing itself, so an entry cannot outlive its cause and a
 * fix cannot land without the entry coming off.
 *
 * ⚠ THIS LIST MUST ONLY SHRINK. A new silent branch is a defect to fix in the
 * card, not an entry to add here.
 */
const SILENT_KNOWN: Record<string, string> = {
  // ── R25's "each opponent" over a region that holds nobody else.
  //
  // "Each opponent" reads the EFFECT REGION's `presentSeats`, and a home
  // region out of battle lists only its owner — so the loop runs zero times,
  // nothing happens, and nothing is said. 85-silent-branches §9 fixed exactly
  // this for Restitution, Vroot and Flzzz; these are the rest of the family,
  // and the fuzz never reached one of them in that situation.
  'ability:Bloated Manablub#0':
    'R25 family — `eachOpponentLoses3` loops over presentSeats and says nothing when the '
    + 'region holds no opponent. Same shape as 85-silent-branches §9 (Restitution/Vroot/Flzzz).',
  'graft:Bloated Manablub':
    'R25 family — the same `eachOpponentLoses3` object, reached as the graft rider.',
  'ability:Blightmound#0':
    'R25 family — `blightmoundRot` gains each opponent 1 rot over presentSeats; with no '
    + 'opponent present the loop is empty and silent.',
  'graft:Blightmound':
    'R25 family — the same `blightmoundRot` object, reached as the graft rider.',
  'spell:Linked Extinction':
    'R25 family — the cost-declined branch announces itself, but the "each opponent '
    + 'sacrifices" loop below it says nothing when no opponent is present.',
  'graft:Linked Extinction':
    'R25 family — the same `linkedExtinction` object, reached as the graft rider.',
  'spell:Void Memory':
    'R25 family — its own comment cites R25 ("grafted onto a deployment-firing cause it '
    + 'reaches nobody who is not there") and then does not say so when that happens.',
  'graft:Void Memory':
    'R25 family — the same `voidMemory` object, reached as the graft rider.',
  'augment:Growing Plague#0':
    'R25 family — "each other player draws two cards" over presentSeats; alone in a home '
    + 'region the loop is empty and silent.',
  'augment:Malicious Hardware#0':
    'R25 family — "each opponent sacrifices a unit" collects picks per present seat; with '
    + 'no opponent present there is no pick and no announcement.',
  'augment:Pestilent Mycelion#0':
    'R25 family — "each opponent loses 1 life" over presentSeats, silent when empty.',
  'augment:Rotwall#0':
    'R25 family — `opponentsIn(...)` yields nobody in a home region and the rot loop is silent.',
  'augment:Verdant Necrophage#0':
    'R25 family — the per-opponent branch announces an empty bin, but the loop itself says '
    + 'nothing when there is no opponent to loop over.',

  // ── a quantity counted at resolution that may be none.
  'augment:Stellarspore Harvester#0':
    'The non-opponent guard announces itself, but "each of your units with a -1/-1 counter" '
    + 'is counted at RESOLUTION (its own comment, R157 §15/R161, says so) and gives nothing '
    + 'away and says nothing when the count is zero.',

  // ── not a gap: an effect that exists only to carry a cost.
  'spell:Trench Stalker':
    "R123 — `run: () => {}` BY CONSTRUCTION. The spellEffect exists solely to hang the "
    + '"[Discard two cards]" cast cost on; a `kind: \'unit\'` StackItem resolves by spawning '
    + 'and `resolveItem` returns before parts ever run, so this run is unreachable in a game. '
    + "Already declared in 71-card-ledger's NOT_A_GAP for the same reason.",
};

test('no effect resolves into silence — every completed run says something', () => {
  // The fix for "it just did nothing". A guard that aborts an effect must LOG
  // why: `g.ev('info', '<Card>: <why> — nothing happens.')`.
  const problems: string[] = [];
  for (const [label, v] of verdicts()) {
    if (!v.silent || !v.fair) continue;
    if (label in SILENT_KNOWN) continue;
    problems.push(`${label} completed a run and emitted nothing (board: ${v.where.join(', ')})`);
  }
  problems.sort();
  assert.deepEqual(problems, [],
    'these effects ran to completion and emitted nothing — the player sees the card leave '
    + `the stack with no indication of what it did:\n  ${problems.join('\n  ')}\n\n`
    + "Add a g.ev('info', '<Card>: <why> — nothing happens.') to that path. "
    + '"Nothing happened" is a legitimate outcome; not SAYING so never is.');
});

test('the known-silent list is still accurate — tick an entry off when it is fixed', () => {
  const v = verdicts();
  const stale: string[] = [];
  for (const [label, why] of Object.entries(SILENT_KNOWN)) {
    assert.ok(why.length > 40, `${label}: a known-silent entry needs a reason, not a shrug`);
    const seen = v.get(label);
    if (!seen) { stale.push(`${label}: no such effect any more — delete the entry`); continue; }
    if (!seen.silent) stale.push(`${label} no longer resolves silently — delete its SILENT_KNOWN entry`);
  }
  assert.deepEqual(stale, [],
    `known-silent entries that have outlived their cause:\n  ${stale.join('\n  ')}`);
});

// ── coverage: the drive's reach, stated and pinned ────────────────────

/**
 * THE RESIDUE — the effects this pass drives but cannot CONVICT.
 *
 * Every effect in the registry is driven (the equality above), and most are
 * driven FAIRLY: the rig gave them every target their spec declares and, for a
 * triggered ability, an event its own `when` accepts. A few cannot be
 * furnished that way, and of those, the ones that then said nothing are the
 * only ones that matter — an effect handed a context a real game would never
 * hand it is being asked the wrong question, so its silence proves nothing
 * either way.
 *
 * They are listed here INDIVIDUALLY, with the board shape each one needs that
 * this rig does not build. Not a count: a count is how a hole becomes
 * invisible. Same house rule as 68-target-conformance's exemptions — an entry
 * that stops being needed fails just as loudly as a new one appearing.
 */
const UNJUDGED: Record<string, string> = {
  'augment:Ancient One#0':
    'R118/R127 — its `when` grants a neighbour\'s triggered text and returns true only when '
    + '`adjacentInFormation` finds an ally next to it. The rig spawns its carrier straight into '
    + 'a region rather than into a formation column, so it never has a neighbour and its own '
    + '`when` never accepts an event. 117-copy-everything drives the mimicry directly.',
  'augment:Riftwalker#0':
    'R64 — "another target ally IN MY FORMATION": the restrict demands that some battle grid '
    + '(`battle.columns` or a block) holds both the carrier and the target. The rig spawns the '
    + 'carrier into the region after the attack is declared, so it is in no grid and the target '
    + 'menu is empty.',
  'augment:Roving Quillback#0':
    "R13 — its `when` demands at least one BLOCKED COLUMN (`battle.blocks` non-empty). The "
    + "rig's battle board stops at the attack declaration and never walks to the blocking step, "
    + 'so no event it can synthesise is one this ability would ever be handed.',
};

// The title keeps the substring CT-7's guard names ("the drive actually covers
// the pool"), because the claim is the same one made harder: the pass no
// longer COVERS the pool, it exhausts it.
test('the drive actually covers the pool — every effect in the registry is driven', () => {
  // The point of the whole rewrite, as one assertion. The old fuzz drive
  // reached 280 of these and the number moved whenever an unrelated card
  // changed; this is an equality, and it can only fail by an effect throwing.
  const driven = new Set(runs.map(r => r.label));
  const missing = slots.map(s => s.label).filter(l => !driven.has(l));
  assert.deepEqual(missing, [], `effects the deterministic pass did not reach:\n  ${missing.join('\n  ')}`);
  assert.equal(driven.size, slots.length);
});

test('the residue is named individually, and an entry that stops being needed fails', () => {
  const v = verdicts();
  const stale: string[] = [];
  const surprise: string[] = [];
  for (const [label, why] of Object.entries(UNJUDGED)) {
    assert.ok(why.length > 60, `${label}: an exemption needs a reason, not a shrug`);
    const seen = v.get(label);
    if (!seen) { stale.push(`${label}: no such effect any more — delete the entry`); continue; }
    if (seen.fair) stale.push(`${label} IS furnishable now (${seen.why}) — delete its UNJUDGED entry`);
    else if (!seen.silent) stale.push(`${label} speaks now even unfurnished — delete its UNJUDGED entry`);
  }
  for (const [label, seen] of v) {
    if (seen.fair || !seen.silent || label in UNJUDGED) continue;
    surprise.push(`${label} (${seen.why})`);
  }
  assert.deepEqual(stale, [], `UNJUDGED entries that have outlived their reason:\n  ${stale.join('\n  ')}`);
  assert.deepEqual(surprise.sort(), [],
    'these effects said nothing, and the rig could not give them what they declare they need, '
    + `so the silence cannot be judged:\n  ${surprise.join('\n  ')}\n\nEither widen the rig (a new `
    + 'board state, a richer event) or add the name WITH ITS REASON — never a count.');
});

// CT-7's other guard names this title; the reach it reports is now exhaustive
// in cards and in defs, and a floor only where a floor still means something.
test('the drive states its reach in CARDS, not only in EffectDefs (and in token-makers)', () => {
  const withEffects = new Set<string>();
  for (const s of slots) withEffects.add(s.card);
  const declaring = [...owners.keys()].filter(d => (d.creates?.length ?? 0) > 0 || d.createsAny);
  const seen = declaring.filter(d => recorded.has(d));
  console.log(`    deterministic reach: ${owners.size}/${owners.size} EffectDefs over `
    + `${withEffects.size} cards, ${BOARDS.length} board states, ${runs.length} runs`);
  console.log(`    token-making effects observed creating: ${seen.length}/${declaring.length}`);
  console.log(`    (the 140-game fuzz this replaced reached 280/431 defs, 272/${withEffects.size} `
    + 'cards and 49 token-makers, in ~45s — see the header)');

  // ABSOLUTE floors, not percentages: adding cards must not lower the bar.
  // The def and card numbers are pinned by the equality test above; this is
  // the one number that is a genuine floor, because whether an effect gets far
  // enough to make its token depends on the board the rig builds.
  assert.ok(seen.length >= 70,
    `only ${seen.length}/${declaring.length} token-making effects were observed creating `
    + 'anything — the rig has lost reach the R182 pass had (76). Find out what stopped being '
    + 'furnishable rather than lowering this number.');
});
