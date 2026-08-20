/* Light & Dark expansion — batch light-b (18 cards).
 *
 * Behaviour only; printed data comes from printed.json (never hand-copied).
 * Spec for the expansion's new mechanics: docs/08-light-and-dark.md,
 * rulings R38-R48 in docs/digital-rules.md.
 *
 * Cards in this batch:
 *   Banishment
 *   Blurf
 *   Debt Blep
 *   Divine Intervention
 *   Flzzz
 *   Glutton of Absolution
 *   Grob
 *   Insatiable Want
 *   Life Channel
 *   Living Vault
 *   Ploosh
 *   Proph
 *   Riftspawn Remnant
 *   Siphon Life
 *   Stellar Fission
 *   The Foretold
 *   Visage of Ruin
 *   Waxen Witness
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 * A [Switch] marker makes the ability a graft CAUSE and its clause the
 * card's transferable graftEffect (the General Smof pattern).
 *
 * A leading `[Augment]` on a text line means the text is live while the card
 * is a unit in play AND transfers when the card is applied as an augment /
 * Virus — that is exactly what `augmentText` / `statics` do, and the engine
 * anchors both on the HOST, so "I" is the host and "you" is the host's
 * controller (which is the whole point of the two Virus cards here).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fizzle vs partial), R6 (mid-resolution payments/choices via ctx.choose),
 * R9 (bounded budgets per card), R12/R25 ("each player" = the seats present in
 * the effect's region), R35 (X paid at cast), R39 (debt), R41-R46 (cache,
 * prophecy, glimpse, mods-don't-follow), R48 ({Blessed} is simultaneous).
 *
 * ⚠ ENGINE GAPS this batch ran into (reported, NOT worked around in engine
 * code — every one of them is a one-liner outside this file's lane):
 *
 * ✔ ALL THREE ENGINE GAPS this batch reported are now closed (R49):
 *  - `lifeGained:<seat>` is the exact mirror of `lifeLost:<seat>`, bumped by
 *    E.gainLife. Life Channel and Riftspawn Remnant were already written to
 *    read it and became correct without a code change: Life Channel counts
 *    every point gained this battle (it reads the ledger BEFORE gaining its
 *    own 3 and adds the 3 back, so nothing is double-counted), and Riftspawn
 *    Remnant's "gained or lost" is live on both halves.
 *  - `Entity.spawnedTurn` unparked Banishment.
 *  - `data.from` on the play events unparked Proph.
 */
import type { Entity, EntityId, Seat, TargetRef } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, effectByKey, getCard, type EffectDef } from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

const isEnt = (t: unknown): t is Entity => !!t && typeof t === 'object' && 'id' in t;

/** "each player" = the seats PRESENT in the effect's region (R12/R25), in
 * presentSeats order (region owner first) — the whole table in 1v1 battle. */
const playersIn = (g: E, region: number): Seat[] =>
  [...(g.s.regions[region]?.presentSeats ?? [])] as Seat[];

/** Erase an entity from play entirely: no bin, no death/despawn triggers, its
 * mods erased with it, and out of any formation column it was fighting in.
 * (E.removeFromFormation is private, hence the local unslot.) */
function eraseFromPlay(g: E, u: Entity): void {
  for (const modId of u.mods) delete g.s.entities[modId];
  delete g.s.entities[u.id];
  const b = g.s.battle;
  if (b) {
    for (const col of [...b.columns, ...Object.values(b.blocks)]) {
      const i = col.indexOf(u.id);
      if (i !== -1) col.splice(i, 1);
    }
    const si = b.sentAttackers.indexOf(u.id);
    if (si !== -1) b.sentAttackers.splice(si, 1);
  }
  g.ev('erased', `${u.card} is ERASED (no bin, no death).`,
    { unit: u.id, card: u.card, seat: u.controller });
}

/** The engine's per-battle life ledgers, read together. `gained` is the
 * counter E.gainLife SHOULD bump (see the header's first engine gap) — it
 * reads 0 today and the cards using it degrade gracefully. */
const lifeLostThisBattle = (g: E, region: number, seat: Seat): number =>
  g.battleCounter(region, `lifeLost:${seat}`);
const lifeGainedThisBattle = (g: E, region: number, seat: Seat): number =>
  g.battleCounter(region, `lifeGained:${seat}`);

/** printed mana cost as a number ("gain debt equal to its cost", "a card with
 * cost [x]"): an X-cost card has no fixed printed number, so it counts as 0
 * and is never offered as a payable [x]. */
const printedMana = (g: E, name: string): number | null => {
  const m = g.card(name).mana;
  return m === 'X' ? null : m;
};

// ───────────────────────────── the cards ──────────────────────────────

// "Erase all units that spawned this turn. (This includes units that spawned
// during [Haste].)" — l/3 {Battle} Holy Spell.
//
// R49: `Entity.spawnedTurn` is stamped by newEntity, so "spawned this turn" is
// a field read (g.spawnedThisTurn). R12/R25: region-scoped, like every other
// board sweep — the units where the spell is resolving. The parenthetical
// about [Haste] needs no code: a haste-step spawn carries the same turn stamp.
// Erase = out of the game entirely (no bin, no died/despawned, mods erased).
card('Banishment', {
  spellEffect: {
    run: (g, ctx) => {
      const doomed = g.unitsIn(ctx.region).filter(u => g.spawnedThisTurn(u));
      if (!doomed.length) { g.ev('info', 'Banishment: nothing spawned this turn.'); return; }
      for (const u of doomed) { const live = g.entity(u.id); if (live) eraseFromPlay(g, live); }
    },
  },
});

// "[Augment] At the end of turn, cache the top card of the deck. It gains
// 'Prophecy: 1 turn passes'. You gain debt equal to its cost." — lll/5 2/3
// Spirit Unit.
//
// The granted prophecy string is handed over EXACTLY as printed, inconsistent
// transcription and all ("Prophecy: 1 turn passes" against the expansion's
// usual "Prophecy — One Turn Passes"): normalizeProphecy strips the label and
// folds the number words, so both spellings land on the same rule row. That is
// the point of the seam — do not pre-normalise here.
//
// "Its cost" is the cached card's printed mana (an X card counts as 0). The
// debt is paid off automatically at the end of the next resource step (R39).
card('Blurf', {
  augmentText: [{
    type: 'triggered', events: ['endOfTurn'],
    label: "cache the top card with 'Prophecy: 1 turn passes' — gain debt equal to its cost",
    effect: {
      run: (g, ctx) => {
        const [name] = g.cacheTopOfDeck(ctx.controller, 1, { prophecy: 'Prophecy: 1 turn passes' });
        if (name === undefined) {
          g.ev('info', `${ctx.sourceName}: the deck is empty — nothing to cache.`);
          return;
        }
        const cost = printedMana(g, name) ?? 0;
        g.gainDebt(ctx.controller, cost);
      },
    },
  }],
});

// "[Augment][once] Gain 2 debt: I gain +3/+3 until regroup." — l/1 1/1
// Caterpillar Unit. An activated ability whose cost is DEBT rather than mana.
// R49: `cost: { debt: 2 }` is a real activation cost — taken as the ability is
// activated, before it reaches the stack, so a negated pump still cost the
// debt. [once] is the bounded budget: it cannot be pumped twice in a turn.
card('Debt Blep', {
  augmentText: [{
    type: 'activated', cost: { debt: 2 }, bounded: true,
    label: 'Gain 2 debt: I gain +3/+3 until regroup',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (self) g.addTemp(self, 3, 3);
      },
    },
  }],
});

// "You may change the targets of target effect." — ll/5 {Battle} Nature Spell
// with the banner "[1] Prophecy — Your life is 5 or less [Haste]" (the
// trailing [Haste] is a timing marker on the RELEASE, split off by
// normalizeProphecy — engine side, nothing to do here).
//
// Gravitational Correction's shape minus the "unless its controller pays"
// clause, plus the "you may": the caster is asked once whether to change
// anything, then re-picks every declared target of every live part from the
// CURRENT legal candidates. All choices are requested before any mutation
// (the engine rolls back to the part boundary on suspension).
card('Divine Intervention', {
  spellEffect: {
    targets: { what: 'stackEffect', prompt: 'Divine Intervention: change the targets of target effect' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) return;
      const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
      if (!item || item.negated) return;
      const may = ctx.choose('may', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: `Divine Intervention: change ${item.label}'s targets?`,
        options: [{ label: 'Change the targets', value: true }, { label: 'Leave them', value: false }],
      });
      if (may !== true) {
        g.ev('info', `${ctx.sourceName}: ${item.label}'s targets are left alone.`);
        return;
      }
      const picks: [number, number, TargetRef][] = [];
      item.parts.forEach((part, pi) => {
        if (part.spent) return;
        const def = effectByKey(part.effectKey);
        if (!def.targets || !part.targets.length) return;
        part.targets.forEach((_, ti) => {
          const cands = g.targetCandidates(def.targets!, item.region, item.id, item.controller);
          if (!cands.length) return;
          const chosen = ctx.choose(`retarget:${pi}:${ti}`, {
            kind: 'payOrDecline', seat: ctx.controller,
            prompt: `${ctx.sourceName}: choose a new target for ${item.label}`,
            options: cands.map(c => ({ label: g.targetLabel(c), value: c })),
          });
          picks.push([pi, ti, chosen as TargetRef]);
        });
      });
      for (const [pi, ti, ref] of picks) item.parts[pi]!.targets[ti] = ref;
    },
  },
});

// "(Damage dealt by a blessed source causes its controller to gain that much
// life.) [Augment] Whenever you gain life, each opponent loses that much
// life." — lll/4 1/3 {Blessed} Horror Unit, banner "[2] Prophecy — Two Turns
// Pass".
//
// {Blessed} itself is engine-side (R48: simultaneous, not a trigger) and the
// banner is engine-side too; the scripted half is the drain. "You" is the
// holder's controller — on a host, the HOST's controller — so the `when`
// compares the lifeGained event's seat against the anchor's controller (R1:
// condition at event time), and "that much" is read from the event snapshot.
card('Flzzz', {
  augmentText: [{
    type: 'triggered', events: ['lifeGained'],
    when: (_g, self, ev) => ev.data?.['seat'] === self.controller && (ev.data?.['n'] as number) > 0,
    label: 'each opponent loses that much life (whenever you gain life)',
    effect: {
      run: (g, ctx) => {
        const n = (ctx.event?.data?.['n'] as number | undefined) ?? 0;
        if (n <= 0) return;
        // R25: "each opponent" reads the effect region's PRESENT seats, like
        // every other "each opponent" in the expansion. Out of battle a home
        // region lists only its owner, so a deployment-phase life gain drains
        // nobody — the standing R25 behaviour, not a Flzzz special case.
        for (const seat of playersIn(g, ctx.region)) {
          if (seat === ctx.controller) continue;
          g.loseLife(seat, n, `${ctx.sourceName}'s drain`);
        }
      },
    },
  }],
});

// "When I attack or block, [Switch1] You gain 3 debt." — l/3 7/7 Horror Unit.
// A 3-mana 7/7 whose whole cost is deferred: three debt every time it fights
// is three mana off next turn's resource step (R39). [Switch1] = bounded and
// a graft cause; the marked clause is also the transferable graft effect.
const gluttonDebt: EffectDef = {
  run: (g, ctx) => { g.gainDebt(ctx.controller, 3); },
};
card('Glutton of Absolution', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    bounded: true, graftCause: true,
    label: 'you gain 3 debt',
    effect: gluttonDebt,
  }],
  graftEffect: { bounded: true, effect: gluttonDebt },
});

// "When I attack, [Switch1] Up to one target unit's controller caches it. It
// gains 'Prophecy — One Battle Passes'." — lll/4 5/3 Spirit Unit.
//
// "Up to one" is min: 0, so declaring no target is legal and the part still
// resolves (with an empty ctx.targets). E.cacheUnit does the R46 work: the
// unit leaves play, its mods stay behind and go to their owners' bins (which
// trashes them, R40), and the CARD lands in its owner's cache carrying the
// granted prophecy. Note the printed text says the controller caches it while
// the card can only go to its OWNER's cache — they differ only after a
// control change (R8), and a stolen card returning to its owner's cache is
// the same call the base rules make for every other zone change.
const grobCache: EffectDef = {
  targets: { what: 'unit', min: 0, count: 1, prompt: "Grob: up to one unit — its controller caches it" },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t)) return;
    g.cacheUnit(t, { prophecy: 'Prophecy — One Battle Passes' });
  },
};
card('Grob', {
  abilities: [{
    type: 'triggered', events: ['attacked'], self: true,
    bounded: true, graftCause: true,
    label: "cache up to one target unit with 'Prophecy — One Battle Passes'",
    effect: grobCache,
  }],
  graftEffect: { bounded: true, effect: grobCache },
});

// "Each player with an even life total sacrifices a unit. Each player with an
// odd life total draws a card." — l/1 {Battle} Nature Spell.
//
// Parity is snapshotted for every player BEFORE anything happens, so the
// sacrifices cannot flip anyone's branch mid-resolution. "Each player" is the
// seats present in the region (R12/R25); each even-life player picks their own
// sacrifice (R6 model), and all picks are gathered before any destruction.
card('Insatiable Want', {
  spellEffect: {
    run: (g, ctx) => {
      const seats = playersIn(g, ctx.region);
      const even = seats.filter(s => g.player(s).life % 2 === 0);
      const odd = seats.filter(s => g.player(s).life % 2 !== 0);
      const picks: EntityId[] = [];
      for (const seat of even) {
        const units = g.unitsOf(seat, ctx.region);
        if (!units.length) continue;
        const chosen = ctx.choose(`sac:${seat}`, {
          kind: 'payOrDecline', seat,
          prompt: 'Insatiable Want: your life total is even — sacrifice a unit',
          options: units.map(u => ({ label: u.card, value: u.id, card: u.card })),
        });
        picks.push(chosen as EntityId);
      }
      for (const id of picks) {
        const u = g.entity(id);
        if (u) g.destroy(u, 'is sacrificed');
      }
      for (const seat of odd) g.draw(seat, 1);
    },
  },
});

// "You gain 3 life, then [Switch1] Target unit gains +X/+X until regroup,
// where X is the life you've gained in this battle." — l/2 {Battle} Nature
// Spell.
//
// ⚠ X depends on the missing `lifeGained:<seat>` battle ledger (header gap 1).
// The spell reads the ledger BEFORE gaining its own 3 and adds the 3 itself,
// so the number is right in both worlds: with the ledger it is "everything
// gained this battle, this spell included", and without it, it is exactly the
// 3 this spell just gained — correct whenever Life Channel is the battle's
// only life gain, low otherwise. The [Switch1] GRAFT rider is the buff clause
// alone (no "gain 3 life" rides along), so it reads the ledger straight and
// today always sees 0 — that half is effectively parked on the same one-liner.
card('Life Channel', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Life Channel: target unit gains +X/+X until regroup' },
    run: (g, ctx) => {
      // read the ledger BEFORE the gain, then add this spell's own 3 back in
      const before = lifeGainedThisBattle(g, ctx.region, ctx.controller);
      g.gainLife(ctx.controller, 3, 'Life Channel');
      const t = ctx.targets[0];
      if (!isEnt(t)) return;
      const x = before + 3;
      g.addTemp(t, x, x);
    },
  },
  graftEffect: {
    bounded: true,
    effect: {
      targets: { what: 'unit', prompt: 'Life Channel: target unit gains +X/+X until regroup' },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!isEnt(t)) return;
        const x = lifeGainedThisBattle(g, ctx.region, ctx.controller);
        if (x <= 0) {
          g.ev('info', `Life Channel (grafted): X is 0 — ${t.card} gains nothing.`);
          return;
        }
        g.addTemp(t, x, x);
      },
    },
  },
});

// "[Augment] At the end of turn, you may pay [x] and cache a card in your hand
// with cost [x]. It gains 'Prophecy — One Turn Passes'." — ll/2 2/2 Alien
// Unit. The banked card comes back FREE (and affinity-free, R42) one turn
// later, so this is a mana-for-tempo bank rather than card advantage.
//
// [x] is the chosen card's own printed cost, so only hand cards whose printed
// mana the holder can still afford at end of turn are offered (an X-cost card
// has no fixed [x] and is never offered). "You may" → a decline option. The
// choice is requested before any mutation; end-of-turn suspensions resume
// through GameState.turnEnding, so this asks for real rather than auto-picking.
card('Living Vault', {
  augmentText: [{
    type: 'triggered', events: ['endOfTurn'],
    label: "pay [x] and cache a hand card with cost [x], with 'Prophecy — One Turn Passes'",
    effect: {
      run: (g, ctx) => {
        const seat = ctx.controller;
        const open = g.openMana(seat);
        const options = g.player(seat).hand
          .map((name, i) => ({ name, i, cost: printedMana(g, name) }))
          .filter((o): o is { name: string; i: number; cost: number } => o.cost !== null && o.cost <= open)
          .map(o => ({ label: `${o.name} — pay [${o.cost}]`, value: o.i, card: o.name }));
        if (!options.length) return;
        const chosen = ctx.choose('bank', {
          kind: 'payOrDecline', seat,
          prompt: 'Living Vault: pay [x] to cache a hand card with cost [x]?',
          options: [...options, { label: 'Decline', value: -1 }],
        }) as number;
        if (chosen < 0) return;
        const name = g.player(seat).hand[chosen];
        const cost = name === undefined ? null : printedMana(g, name);
        if (name === undefined || cost === null || cost > g.openMana(seat)) return;
        g.payMana(seat, cost);
        g.cacheFromHand(seat, chosen, { prophecy: 'Prophecy — One Turn Passes' });
      },
    },
  }],
});

// "[Augment] After combat, you gain 3 life and draw a card if your life total
// is odd. Otherwise, sacrifice me and you lose 3 life." — l/2 2/2 {Virus}
// Horror Unit.
//
// Read as: odd → gain 3 and draw; even → sacrifice me and lose 3. The whole
// text is [Augment], which is what makes it a real Virus: stuck on an enemy
// unit, "you" is the HOST's controller and "me" is the HOST, so an even life
// total kills the thing it is attached to and drains its owner. 'afterCombat'
// carries no source unit, so the ability deliberately does not set `self` —
// each holder in the region fires its own copy, anchored on itself.
card('Ploosh', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'odd life: gain 3 and draw — otherwise sacrifice me and lose 3',
    effect: {
      run: (g, ctx) => {
        const seat = ctx.controller;
        if (g.player(seat).life % 2 !== 0) {
          g.gainLife(seat, 3, 'Ploosh (odd life)');
          g.draw(seat, 1);
          return;
        }
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (self) g.destroy(self, 'is sacrificed');
        g.loseLife(seat, 3, 'Ploosh (even life)');
      },
    },
  }],
});

// "When you play a card from anywhere other than your hand, [Switch1] Draw a
// card." — ll/2 2/1 Horror Unit.
//
// R49: both play events now carry `data.from`, the ZONE the card was played
// out of (doPlayCard stamps 'hand', doPlayCached 'cache'), so this is exact.
// A play event with NO `from` is not a played card at all (an effect-created
// token), and R37 keeps mods out — applying a mod from bin or cache is not
// playing a card and fires no play event in the first place.
//
// Heard on BOTH channels so every card type counts exactly once: a unit
// released from cache fires only 'spawned', a spell only 'spellPlayed', and a
// SPELL UNIT fires both — hence the kind check, which mirrors Stalwart
// Sentinel's.
const prophDraw: EffectDef = {
  run: (g, ctx) => { g.draw(ctx.controller, 1); },
};
card('Proph', {
  abilities: [{
    type: 'triggered', events: ['spellPlayed', 'spawned'],
    bounded: true, graftCause: true,
    label: 'draw a card',
    when: (g, self, ev) => {
      if (ev.data?.['seat'] !== self.controller) return false;
      const from = ev.data?.['from'] as string | undefined;
      if (from === undefined || from === 'hand') return false;
      const name = ev.data?.['card'] as string | undefined;
      if (!name) return false;
      // a spell unit fires both events; count it on 'spellPlayed' only
      if (ev.type === 'spawned' && getCard(name).kind !== 'unit') return false;
      return true;
    },
    effect: prophDraw,
  }],
  graftEffect: { bounded: true, effect: prophDraw },
});

// "[Augment] If you have gained or lost life in this battle, I gain +4/-4." —
// l/1 0/5 {Virus} Cosmic Nebula Sprite Unit.
//
// A live conditional static rather than a one-shot: "if <state>, I gain" reads
// as a continuous modification, so the 0/5 wall becomes a 4/1 beater exactly
// while the condition holds and reverts if it stops holding. Anchored on the
// holder (self === the host when it rides as a Virus), so "you" is the host's
// controller — pinning a fragile 4/1 body onto an enemy unit is the point.
//
// ⚠ The life-GAINED half is dead until `lifeGained:<seat>` exists (header gap
// 1); the life-LOST half works today off E.loseLife's ledger. `affects` reads
// battle counters only — never effStats (statics reentrancy guard).
// `augmentable` because the card's [Augment] text is implemented as a static
// and a Virus still has to qualify as an augment to be applied.
card('Riftspawn Remnant', {
  augmentable: true,
  statics: [{
    affects: (g, self, target) => {
      if (target.id !== self.id) return false;
      if (g.s.phase !== 'battle') return false;
      return lifeLostThisBattle(g, self.region, self.controller) > 0
        || lifeGainedThisBattle(g, self.region, self.controller) > 0;
    },
    dp: 4,
    dt: -4,
  }],
});

// "Target player [gains or loses] X life." — ll/X {Battle} Nature Spell.
// X is chosen and PAID AT CAST (R35). No xMin: the card does not print "X
// can't be zero" (the batch convention is to set xMin only when it does), so
// a pointless X = 0 cast is legal and simply does nothing. The bracketed
// "[gains or loses]" is the caster's choice, made at resolution. Target spec
// 'any' is the engine's only player-reaching scope — a unit target is a no-op,
// exactly like Bripp's "target player's hand".
card('Siphon Life', {
  spellEffect: {
    targets: { what: 'any', prompt: 'Siphon Life: target player gains or loses X life' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('player' in (t as object))) return;
      const who = (t as { player: Seat }).player;
      const x = ctx.x ?? 0;
      if (x <= 0) return;
      const mode = ctx.choose('mode', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: `Siphon Life: does ${g.pname(who)} gain or lose ${x} life?`,
        options: [{ label: `Lose ${x}`, value: 'lose' }, { label: `Gain ${x}`, value: 'gain' }],
      });
      if (mode === 'gain') g.gainLife(who, x, 'Siphon Life');
      else g.loseLife(who, x, 'Siphon Life');
    },
  },
});

// "Erase target unit. Its controller gains life equal to its power plus its
// defense." — lll/3 {Battle} Cosmic Spell. Erasing is the hard removal: no
// bin, no death trigger, no trash (R40), and the unit's mods go with it. The
// consolation life is read from the unit's EFFECTIVE stats an instant before
// it stops existing (R1: amounts at resolution), and a negative total simply
// gains nothing.
card('Stellar Fission', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Stellar Fission: erase target unit (its controller gains power + defense life)' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t)) return;
      const [p, d] = g.effStats(t);
      const who = t.controller;
      const name = t.card;
      eraseFromPlay(g, t);
      g.gainLife(who, p + d, `${name} was erased by Stellar Fission`);
    },
  },
});

// "" — l/3 3/3 Primordial Alien Horror Unit, banner "[0] Prophecy — One Turn
// Passes". No rules text at all: a vanilla 3/3 that can be banked for free
// during deployment and cast for free (ignoring affinity) a turn later. The
// registration exists so the card enters DECK_LIST; the prophecy machinery is
// entirely engine-side.
card('The Foretold', {});

// "[Augment] When I attack or block, each player loses half of their life
// total, rounded up." — lll/6 4/5 Spirit Anima Unit. Symmetrical, which is
// why it is playable: at 20 life it is a 10-point swing both ways, and the
// halving never quite kills (except from 1). "Each player" is the seats
// present in the region (R12/R25), in presentSeats order for determinism —
// and a lethal halving ends the game mid-loop, which is correct.
card('Visage of Ruin', {
  augmentText: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: 'each player loses half of their life, rounded up',
    effect: {
      run: (g, ctx) => {
        for (const seat of playersIn(g, ctx.region)) {
          const life = g.player(seat).life;
          if (life <= 0) continue;
          g.loseLife(seat, Math.ceil(life / 2), `${ctx.sourceName} halves their life`);
        }
      },
    },
  }],
});

// "[Switch1] Cache target unit. It gains 'Prophecy — One Battle Passes'." —
// lll/4 3/3 {Battle} Spirit Horror Spell Unit. The spell effect resolves
// first, then the 3/3 body spawns (spellUnit), so a battle-speed removal that
// leaves a blocker behind. The victim's owner keeps the card and gets it back
// for free one battle later — in 1v1 both the initiative battle and the
// counterattack tick "One Battle Passes" (R43), so it is genuinely one round.
// [Switch1] makes the clause the bounded graft rider too.
const waxenCache: EffectDef = {
  targets: { what: 'unit', prompt: "Waxen Witness: cache target unit with 'Prophecy — One Battle Passes'" },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t)) return;
    g.cacheUnit(t, { prophecy: 'Prophecy — One Battle Passes' });
  },
};
card('Waxen Witness', {
  spellEffect: waxenCache,
  graftEffect: { bounded: true, effect: waxenCache },
});
