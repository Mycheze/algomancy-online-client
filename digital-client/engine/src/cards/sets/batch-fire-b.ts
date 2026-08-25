/* batch-fire-b — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Cards are being scripted here from printed.json data
 * (never hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution —
 * plus the "if I am still in formation" explicit resolution-time recheck),
 * R6 (payments are part of resolution, via ctx.choose), R9 (bounded budgets
 * per card), R12/R25 ("each opponent/player" is region-scoped), R26 ("play"
 * excludes token creation — the nontoken gate doubles as the loop guard).
 *
 * Approximations (existing primitives, semantics slightly reshaped):
 *  - (The "costs the DSL cannot express as costs" bullet that used to head
 *    this list is GONE, and so is its "each flagged ⚠ at the card" promise —
 *    the per-card ⚠ markers it promised never existed anywhere in this file.
 *    All three cards it named carry REAL costs now: Sacrificial Burst
 *    `castCost: { kind: 'sacrificeUnit' }` (R35), Soul Swallower
 *    `cost: { sacrificeOther: 1 }` (R49, see its own UN-PARKED note), and
 *    Wildfire's X is chosen and paid at cast (R35), so `ctx.x` is fixed before
 *    anyone can respond.)
 *  - "target ... in your bin" (Resurrect, Reclaimer of Secrets, Rousing
 *    Spirit) is REAL TARGETING as of R64: TargetSpec has a 'binCard' kind, and
 *    a bin holds names, so naming the card IS the reference (BinRef).
 */
import type { EntityId, Seat } from '../../types.ts';
import { card, getCard, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** "unit with cost 2 or less": unit-kind cards with numeric mana <= 2 */
const isCheapUnit = (name: string): boolean => {
  const c = getCard(name);
  return (c.kind === 'unit' || c.kind === 'spellUnit') && typeof c.mana === 'number' && c.mana <= 2;
};

/** "spell": spell-kind cards (a spell unit is played as a spell) */
const isSpellCard = (name: string): boolean => {
  const k = getCard(name).kind;
  return k === 'spell' || k === 'spellUnit';
};

// ───────────────────────────── the cards ──────────────────────────────

// "When I spawn, create two Fireball 1. [Augment] When I despawn, negate all
// allied spells." — rr/2 3/2 Infernal Horror {Virus} Unit. The spawn trigger
// is a normal ability; the despawn clause is text-box [Augment] (live when
// played normally, donated when it Virus-augments a host — the DOWNSIDE lands
// on the host's controller: "allied" is read from the carrier's side).
// Despawn = ANY leave-play: 'died' + 'despawned' (the Bloated Manablub
// reading). "All allied spells" = every un-negated spell-effect item the
// carrier's controller has on the stack (same kinds as stackSpell targeting).
card('Molten Riftbreaker', {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: 'create two Fireball 1',
    effect: {
      creates: ['Fireball'],
      run: (g, ctx) => {
        for (let i = 0; i < 2; i++) g.createSpellToken(ctx.controller, 'Fireball', 1, ctx.region);
      },
    },
  }],
  augmentText: [{
    type: 'triggered', events: ['died', 'despawned'], self: true,
    label: 'negate all allied spells (when I despawn)',
    effect: {
      run: (g, ctx) => {
        let negated = 0;
        for (const it of [...g.s.stack]) {   // R68: negate() splices
          if ((it.kind === 'spell' || it.kind === 'spellUnit' || it.kind === 'spellToken' || it.kind === 'ambush')
            && it.controller === ctx.controller) { g.negate(it.id); negated++; }
        }
        if (!negated) g.ev('info', 'Molten Riftbreaker: you have no spell on the stack — nothing is negated.');
      },
    },
  }],
});

// "When you play a token spell, [Switch1] Target unit gains +2/+0 and
// {g}flying until regroup." — r/2 2/1. Token-spell gate is the inverse of the
// usual nontoken one (R26 family: the spellPlayed event carries token:true for
// spell tokens). Bounded graft ([Switch1], R9). The flying grant uses
// E.addTempAttr (until-regroup attribute, cleared with temp stats).
const eelBuff: EffectDef = {
  targets: { what: 'unit', prompt: 'Nimbus Eel: target unit gains +2/+0 and flying until regroup' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (isEnt(t)) {
      g.addTemp(t, 2, 0);
      g.addTempAttr(t, 'Flying');
    }
  },
};
card('Nimbus Eel', {
  abilities: [{
    type: 'triggered', events: ['spellPlayed'], bounded: true, graftCause: true,
    label: 'target unit gains +2/+0 and flying until regroup',
    when: (g, self, ev) => ev.data?.seat === self.controller && ev.data?.token === true,
    effect: eelBuff,
  }],
  graftEffect: { bounded: true, effect: eelBuff },
});

// "Whenever you play a nontoken spell, [Switch] I gain +1/-1 until regroup."
// — rr/4 4/3. Unbounded graft; grafted onto a host, "I" = the host
// (ctx.sourceId is the composite's source). The -1 side can kill (state-based
// check runs after the part).
const slingerSurge: EffectDef = {
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    if (self) g.addTemp(self, 1, -1);
  },
};
card('Ravenous Fireslinger', {
  abilities: [{
    type: 'triggered', events: ['spellPlayed'], graftCause: true,
    label: 'I gain +1/-1 until regroup',
    when: (g, self, ev) => ev.data?.seat === self.controller && !ev.data?.token,
    effect: slingerSurge,
  }],
  graftEffect: { bounded: false, effect: slingerSurge },
});

// "When I die, you may pay [two] to recall target spell in your bin." — rr/2
// 4/1. R64: "target spell in your bin" is a declared target, chosen as the
// trigger goes on the stack (min 0 for the "you may"); the [two] stays a
// resolution-time pay-or-decline — it is optional mana, not a cost of using
// the ability. Its own card is already in the bin when the trigger resolves
// (destroy bins before firing 'died') but it is a unit, so it is never a
// legal target.
card('Reclaimer of Secrets', {
  abilities: [{
    type: 'triggered', events: ['died'], self: true,
    label: 'you may pay [two] to recall a spell from your bin',
    effect: {
      targets: {
        what: 'binCard', min: 0,
        prompt: 'Reclaimer of Secrets: pay [two] to recall target spell in your bin',
        restrict: (_g, t) => 'binCard' in t && isSpellCard(t.binCard.card),
      },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!t || !('binCard' in t) || t.binCard.index === -1) {
          g.ev('info', 'Reclaimer of Secrets: no bin spell is targeted (or it has left) — nothing is recalled.');
          return;
        }
        if (g.openMana(ctx.controller) < 2) { g.ev('info', 'Reclaimer of Secrets: cannot pay [two].'); return; }
        const pays = ctx.choose('pay', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Reclaimer of Secrets: pay [two] to recall ${t.binCard.card} from your bin?`,
          options: [{ label: 'Pay [two]', value: true }, { label: 'Decline', value: false }],
        });
        if (!pays) { g.ev('info', 'Reclaimer of Secrets: the [two] is declined — nothing is recalled.'); return; }
        g.payMana(ctx.controller, 2);
        const name = g.removeFromBin(ctx.controller, t.binCard.index, 'recalled');   // R124
        if (name !== undefined) {
          g.player(ctx.controller).hand.push(name);
          g.ev('info', `Reclaimer of Secrets: ${name} recalled to ${g.pname(ctx.controller)}'s hand.`);
        }
      },
    },
  }],
});

// "[Switch1] Put target unit with cost 2 or less from your bin into play." —
// r/2 Occult Spell. R64: the card in the bin is a REAL TARGET, declared at
// cast — "target" is printed, and it used to be a mid-resolution pick, so the
// spell went on the stack with nobody able to see what it was reaching for.
// A bin holds names, so naming the card IS the reference (BinRef); it is
// looked up again at resolution and fizzles if it has left. spawnUnit fires
// the unit's spawn triggers, exactly as if it entered play. Bounded graft
// ([Switch1], R9).
const resurrectEffect: EffectDef = {
  targets: {
    what: 'binCard', prompt: 'Resurrect: put target unit with cost 2 or less from your bin into play',
    restrict: (_g, t) => 'binCard' in t && isCheapUnit(t.binCard.card),
  },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!t || !('binCard' in t) || t.binCard.index === -1) return;
    const name = g.removeFromBin(ctx.controller, t.binCard.index, 'revived');   // R124
    if (name !== undefined) g.spawnUnit(ctx.controller, name, ctx.region);
  },
};
card('Resurrect', {
  spellEffect: resurrectEffect,
  graftEffect: { bounded: true, effect: resurrectEffect },
});

// "When I attack, if I am still in formation, you may put target unit with
// cost 2 or less from your bin into the empty slot behind me." — rrr/4 4/3
// {Haste}. "If I am still in formation" is the R1 explicit exception: a
// RESOLUTION-time recheck, encoded per card. "The empty slot behind me" =
// I am the front unit of my column and its back slot is free (columns hold
// 1-2 units). R64: the bin card is a declared target ("target unit … from
// your bin" is printed), min 0 for the "you may".
card('Rousing Spirit', {
  abilities: [{
    type: 'triggered', events: ['attacked'], self: true,
    label: 'put a unit with cost 2 or less from your bin into the slot behind me',
    effect: {
      targets: {
        what: 'binCard', min: 0,
        prompt: 'Rousing Spirit: put target unit with cost 2 or less from your bin behind me',
        restrict: (_g, t) => 'binCard' in t && isCheapUnit(t.binCard.card),
      },
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) { g.ev('info', 'Rousing Spirit: the carrier is gone — nothing is put into play.'); return; }
        const col = g.columnOf(self.id);            // R1 recheck: still in formation?
        if (!col || col.indexOf(self.id) !== 0 || col.length !== 1) {
          g.ev('info', 'Rousing Spirit: there is no empty slot behind me — nothing is put into play.');
          return;
        }
        const t = ctx.targets[0];
        if (!t || !('binCard' in t) || t.binCard.index === -1) {
          g.ev('info', 'Rousing Spirit: no bin unit is targeted (or it has left) — nothing is put into play.');
          return;
        }
        const name = g.removeFromBin(ctx.controller, t.binCard.index, 'revived');   // R124
        if (name === undefined) { g.ev('info', 'Rousing Spirit: the card left the bin — nothing is put into play.'); return; }
        const u = g.spawnUnit(ctx.controller, name, ctx.region);
        col.push(u.id);                             // straight into the slot behind me
      },
    },
  }],
});

// "[Switch] /[Sacrifice a unit]: I deal 4 damage to any target." — r/1
// {Battle} Occult Spell. The sacrifice is a CAST COST (R35): chosen and paid
// before the spell reaches the stack — no unit, no cast. Unbounded graft
// ([Switch]) — the grafted rider's cost is paid (or declined) when the
// composite collects its cast-time decisions.
const burstEffect: EffectDef = {
  castCost: { kind: 'sacrificeUnit' },
  targets: { what: 'any', prompt: 'Sacrificial Burst deals 4 damage to any target' },
  run: (g, ctx) => {
    if (!ctx.costPaid?.sacrificed) {
      g.ev('info', 'Sacrificial Burst: no unit was sacrificed — no damage.');
      return;   // rider declined / unpayable
    }
    g.dealEffectDamage(ctx, ctx.targets[0]!, 4);
  },
};
card('Sacrificial Burst', {
  spellEffect: burstEffect,
  graftEffect: { bounded: false, effect: burstEffect },
});

// "[Augment] Sacrifice another unit: I gain +2/+2 until regroup." — r/2 2/1.
// An ACTIVATED ability inside the [Augment] text box: activatable on the card
// played normally (via 'augment') and on a host it augments (via {mod}).
//
// UN-PARKED (R49). The note here used to read "the DSL's activated costs are
// mana/sacrificeSelf only, so the victim is the ability's TARGET and dies at
// resolution instead (picking the carrier itself — not 'another' — no-ops)".
// `AbilityCost.sacrificeOther` is exactly the missing slot: it GATES the
// activation (no other unit ⇒ the ability is not offered, and apply() refuses
// it), it rides as a `pendingCost` chosen in the cast window — before anyone
// gets priority, so the sacrifice is no longer respondable-after-activation —
// and it can only ever offer units OTHER than the carrier, which retires the
// self-pick no-op the approximation had to carry.
const swallowerFeast: EffectDef = {
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    if (!self) { g.ev('info', 'Soul Swallower: the carrier is gone — no +2/+2.'); return; }
    g.addTemp(self, 2, 2);
  },
};
card('Soul Swallower', {
  augmentText: [{
    type: 'activated', cost: { sacrificeOther: 1 },
    label: 'Sacrifice another unit: I gain +2/+2 until regroup',
    effect: swallowerFeast,
  }],
});

// "The controller of target effect may pay [one]. If they don't, negate that
// effect and draw a card." — r/1 {Battle} Arcane Spell. The exact R6 pattern:
// the payment is part of resolution (pay-or-decline for the TARGET's
// controller, no priority window); decline → negate + Soul Tithe's controller
// draws. Paying is only offered when they have the mana.
card('Soul Tithe', {
  spellEffect: {
    targets: { what: 'stackEffect', prompt: "Soul Tithe: target effect is negated unless its controller pays [one]" },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) {
        g.ev('info', 'Soul Tithe: no effect is targeted — nothing is negated.');
        return;
      }
      const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
      if (!item) {
        g.ev('info', 'Soul Tithe: the targeted effect has already left the stack.');
        return;
      }
      const options = [{ label: "Don't pay", value: false }];
      if (g.openMana(item.controller) >= 1) options.unshift({ label: 'Pay [one]', value: true });
      const pays = ctx.choose('pay', {
        kind: 'payOrDecline', seat: item.controller,
        prompt: `Soul Tithe: pay [one] or ${item.label} is negated`,
        options,
      });
      if (pays) {
        g.payMana(item.controller, 1);
        g.ev('info', `${g.pname(item.controller)} pays [one] — ${item.label} survives.`);
        return;
      }
      g.negate(item.id);
      g.draw(ctx.controller, 1);
    },
  },
});

// "[Augment] Whenever you play a spell, put a +1/+1 counter on me." — r/1
// 0/1. Text-box [Augment]. "A spell" has no nontoken qualifier, so token
// spells count too (only the when-seat gate applies). "Me" = the carrier
// (the host when donated).
card('Sparkwraith', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'],
    label: 'put a +1/+1 counter on me',
    when: (g, self, ev) => ev.data?.seat === self.controller,
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) { g.ev('info', 'Sparkwraith: the carrier is gone — no counter.'); return; }
        g.addCounters(self, 1);
      },
    },
  }],
});

// "[Augment] Whenever a unit dies, I deal 1 damage to each opponent." — rr/2
// 2/1. Text-box [Augment]. ANY unit death (either side, tokens included, its
// own death included) — region-scoped by fireEvent (R12). "Each opponent" is
// the region's present seats minus the controller (R25).
card('Spirit of Vengeance', {
  augmentText: [{
    type: 'triggered', events: ['died'],
    label: 'I deal 1 damage to each opponent',
    effect: {
      run: (g, ctx) => {
        const foes = g.s.regions[ctx.region]!.presentSeats.filter(s => s !== ctx.controller);
        if (!foes.length) { g.ev('info', 'Spirit of Vengeance: no opponent is present here — no damage.'); return; }
        g.dealEffectDamageAll(ctx, foes.map(s => ({ target: { player: s as Seat }, n: 1 })));   // R80
      },
    },
  }],
});

// "When I die, [Switch] Each player sacrifices a unit." — r/1 0/1 {Haste}.
// "Each player" is region-scoped (R25): every seat present in the event's
// region with a unit there picks one and it dies — all picks are made first
// (choose-before-mutate), then all sacrifices happen. A seat with exactly one
// unit has no choice to make. Unbounded graft ([Switch]).
const eachPlayerSacrifices: EffectDef = {
  run: (g, ctx) => {
    const picks: EntityId[] = [];
    for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
      const mine = g.unitsOf(seat as Seat, ctx.region);
      if (!mine.length) continue;
      const id = mine.length === 1 ? mine[0]!.id : ctx.choose(`sac:${seat}`, {
        kind: 'payOrDecline', seat: seat as Seat,
        prompt: 'Spiteful Shadow: sacrifice which unit?',
        options: mine.map(u => ({ label: u.card, value: u.id })),
      }) as EntityId;
      picks.push(id);
    }
    if (!picks.length) g.ev('info', 'Spiteful Shadow: nobody here has a unit to sacrifice.');
    for (const id of picks) {
      const u = g.entity(id);
      if (u) g.destroy(u, 'is sacrificed');
    }
  },
};
card('Spiteful Shadow', {
  abilities: [{
    type: 'triggered', events: ['died'], self: true, graftCause: true,
    label: 'each player sacrifices a unit',
    effect: eachPlayerSacrifices,
  }],
  graftEffect: { bounded: false, effect: eachPlayerSacrifices },
});

// "[Augment] When I die, create a Fireball X, where X is my power." — r/3
// 3/2. Text-box [Augment]. R1 nuance: a dead unit has no live state to read
// at resolution, so "my power" is its LAST-KNOWN value — captured into the
// event snapshot by when() (which runs at event time, while the dying entity
// is still readable: counters/temp stats included).
card('Static Courier', {
  augmentText: [{
    type: 'triggered', events: ['died'], self: true,
    label: 'create a Fireball X (X = my power)',
    when: (g, self, ev) => {
      (ev.data ?? (ev.data = {})).courierPower = g.effStats(self)[0];
      return true;
    },
    effect: {
      creates: ['Fireball'],
      run: (g, ctx) => {
        const x = (ctx.event?.data?.courierPower as number | undefined) ?? 0;
        if (x <= 0) { g.ev('info', 'Static Courier: its power was 0 — no Fireball.'); return; }
        g.createSpellToken(ctx.controller, 'Fireball', x, ctx.region);
      },
    },
  }],
});

// "[Augment] Whenever you play a nontoken spell, create a 1/1 unit." — rr/3
// 2/3. Text-box [Augment]; the Bloomcaster family (R26): the nontoken gate is
// on the SPELL (token spells don't count), and the created 1/1 is a unit
// token whose spawn is not a "play" — no loop.
card('Stormsowing Nimbus', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'],
    label: 'create a 1/1 unit',
    when: (g, self, ev) => ev.data?.seat === self.controller && !ev.data?.token,
    effect: {
      creates: ['Unit Token'],
      run: (g, ctx) => {
        g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [1, 1] });
      },
    },
  }],
});

// "[Switch1] I deal 2 damage to each of up to two target units." — rr/3
// {Battle} Mystic Elemental Spell. Both targets are chosen AT CAST TIME
// (count: 2, min: 1); each surviving target takes 2. Bounded graft
// ([Switch1], R9).
//
// R126 — "UP TO" MEANS YOU MAY DECLARE NONE. `min: 1` forced the caster to
// shoot whenever any unit was legal, their own board included. Declaring
// nothing is a legal declaration for an "up to" spell, and `min: 0` is this
// repo's own spelling of it on every other card that prints the words
// (Prismatic Observer, Necromantic Rebuke, Grob, Nothyr, Lumengrove Lurker,
// Delver of the Ephemeral, Malevolent Machinations). `min` defaults to 1, so
// only an "up to" card overrides it — and the two that print the words and
// did NOT override it were this card and Minor Kraken, both fixed together.
const twinFlame: EffectDef = {
  targets: { what: 'unit', prompt: 'Twin Flame deals 2 damage to each of up to two target units', count: 2, min: 0 },
  run: (g, ctx) => {
    // R126: "up to two" — declaring none is legal, and a cast that shot
    // nothing must still SAY so (65-effect-conformance: no effect resolves
    // into silence). The same line covers every target having died before
    // resolution.
    const live = ctx.targets.filter(t => isEnt(t) && g.entity(t.id));
    if (!live.length) {
      g.ev('info', 'Twin Flame resolves with no target to damage.');
      return;
    }
    for (const t of live) {
      if (isEnt(t)) g.dealEffectDamage(ctx, t, 2);
    }
  },
};
card('Twin Flame', {
  spellEffect: twinFlame,
  graftEffect: { bounded: true, effect: twinFlame },
});

// "[Augment][once] When you play a nontoken spell, create a Fireball X, where
// X is the spell's cost." — rr/3 3/3. Text-box [Augment], [once] = bounded
// (R9). X = the played spell's mana cost, read from the event snapshot (R1);
// 'X'-cost spells report 0 → no Fireball.
card('Unstable Apparition', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'], bounded: true,   // [once]
    label: "create a Fireball X (X = the spell's cost)",
    when: (g, self, ev) => ev.data?.seat === self.controller && !ev.data?.token,
    effect: {
      creates: ['Fireball'],
      run: (g, ctx) => {
        const name = ctx.event?.data?.card as string | undefined;
        const mana = name ? getCard(name).mana : 0;
        const x = typeof mana === 'number' ? mana : 0;
        if (x <= 0) { g.ev('info', 'Unstable Apparition: that spell costs 0 — no Fireball.'); return; }
        g.createSpellToken(ctx.controller, 'Fireball', x, ctx.region);
      },
    },
  }],
});

// "[Augment] Whenever you play a spell, I deal 1 damage to any target." —
// rr/6 5/4. Text-box [Augment]; "a spell" includes token spells (no nontoken
// qualifier). A TARGETED trigger: the controller picks any target when the
// trigger goes to resolve.
card('Voltwrath Behemoth', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'],
    label: 'I deal 1 damage to any target',
    when: (g, self, ev) => ev.data?.seat === self.controller,
    effect: {
      targets: { what: 'any', prompt: 'Voltwrath Behemoth deals 1 damage to any target' },
      run: (g, ctx) => { g.dealEffectDamage(ctx, ctx.targets[0]!, 1); },
    },
  }],
});

// "I deal X damage to any target." — rr/X {Battle} Infernal Spell. X is
// chosen AND paid AT CAST (R35): the caster picks an affordable X before the
// spell reaches the stack, it is stored on the item, and responses happen
// with X already fixed (the playtest "paid 0" confusion is impossible now).
card('Wildfire', {
  spellEffect: {
    targets: { what: 'any', prompt: 'Wildfire deals X damage to any target' },
    run: (g, ctx) => {
      const x = ctx.x ?? 0;
      if (x <= 0) { g.ev('info', 'Wildfire: X = 0 — no damage.'); return; }
      g.dealEffectDamage(ctx, ctx.targets[0]!, x);
    },
  },
});
