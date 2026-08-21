/* batch-metal-b — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Cards are scripted here from printed.json data (never
 * hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fizzle vs partial), R9 (bounded budgets per card), R12 (regions are
 * exclusive — listeners and "each …" clauses are region-scoped), R25 ("each
 * opponent" region-scoped), R28 (created UNITS arrive in their CONTROLLER'S
 * home region unless the text is battle-local — "in my formation" is),
 * R31 (triggers between combat damage sub-steps resolve immediately).
 *
 * GLIMPSE (Foretell) is REAL as of Light & Dark: E.glimpse (R45) reveals the
 * top card, CACHES it, and makes it playable until end of turn ignoring
 * affinity (mana and timing still apply). It replaced an approximation that
 * put the card straight into the glimpser's hand, permanently.
 *
 * ⚠ ENGINE APPROXIMATIONS in this batch:
 *  - Flux Resonator: a REPLACEMENT effect approximated as a post-hoc trigger
 *    on 'countersChanged'. "By an allied source" is unknowable (the event
 *    carries no source) — read as "counters put on an allied unit", positive
 *    counters only. The bonus counter is added SILENTLY (direct mutation, no
 *    countersChanged event) so replacement chains / self-retrigger loops
 *    cannot happen. Spawn-with-X counters (Robot X) fire no countersChanged
 *    → no bonus (spawned with, not "put on").
 *  - Formless: "becomes a base 4/4" REWRITES layer 2 (E.setBase), and the
 *    "loses all attributes until regroup" half is R62's until-regroup
 *    suppression — both cleared at regroup.
 *  - Instrument of Reassignment: the "[x], Sacrifice another nontoken unit"
 *    COSTS are paid at RESOLUTION (the DSL's activated-cost shape has no X
 *    and no sacrifice-another; Frosted Denial precedent for X-at-resolution).
 *    The sacrifice may be any of your nontoken units, not region-limited.
 *  - Invasive Reassignment: the swap freezes the target's EFFECTIVE stats at
 *    resolution as a temp delta (later stat changes shift both sides).
 *    Its printed {Reaping} is honored in card code: the caster draws if the
 *    swap kills the target (the engine's Reaping hook is damage-only).
 *  - Powerforge Synergist: "I spawn with two +1/+1 counters" has no DSL hook
 *    for played cards, and a queued spawn-trigger is TOO LATE — settle()'s
 *    death check erases the 0/0 before any trigger resolves. The counters
 *    are added synchronously in a bookkeeping when() at spawn-event time
 *    (Mirage Walker precedent; silent — no countersChanged event, matching
 *    Robot's spawn-with-counters). "Move my counters": the unit is gone at
 *    resolution, so the amount is snapshotted into the trigger's event
 *    during when().
 *  - Perish / Linked Extinction: sacrifice choices are made seat by seat
 *    (caster first) and committed immediately — deterministic under the
 *    engine's rollback-and-replay choice model. Perish and the opponents'
 *    half of Linked Extinction are region-scoped (R12/R25); the caster's
 *    own Linked Extinction cost may come from any of their units.
 *
 * (Nothing in this batch is parked any more. Flux Constructor used to be, on
 * a "died-event counter snapshot" — but destroy() stamps `counters` onto the
 * event for exactly this reason, and has since Entropic Entity needed it, so
 * the note outlived the problem. It is implemented; see the card.)
 */
import type { Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, type EffectDef } from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

const isEnt = (t: unknown): t is Entity => !!t && typeof t === 'object' && 'id' in t;

/** create a Robot X — a 0/0 Robot token with X +1/+1 counters — in its
 * controller's HOME region (R28; battle-local cards pass their own region) */
const makeRobot = (g: E, seat: Seat, x: number, region?: number): Entity =>
  g.spawnUnit(seat, 'Robot', region ?? g.homeRegion(seat), { token: true, counters: x });

// ───────────────────────────── the cards ──────────────────────────────

// "[Augment] Whenever one of your units with one or more counters on it dies,
// you may put those counters onto another target unit." — m/3 3/3 Alien Robot
// Unit. Text-box [Augment]: live when played normally, donated on augment (so
// "your" is then the HOST's controller).
//
// This was parked on a "died-event counter snapshot" that already exists:
// destroy() stamps `counters` onto the event precisely BECAUSE the entity is
// out of s.entities by the time 'died' fires (it was added for Entropic
// Entity). "One or more counters on it" is a nonzero net, the Entropic Entity
// reading — the engine keeps ONE signed total, so a unit that died holding
// two -1/-1 counters is a unit with counters on it, and moving them keeps
// their sign: you move what was actually there, drawback and all.
//
// R67: "another target unit" is a DECLARED target, chosen as the trigger goes
// on the stack; `min: 0` carries the printed "you may". "Another" needs no
// restriction — the unit that died is already gone, so it cannot be offered.
card('Flux Constructor', {
  augmentText: [{
    type: 'triggered', events: ['died'],
    label: "put a dead ally's counters onto another target unit",
    when: (_g, self, ev) => ev.data?.['seat'] === self.controller
      && ((ev.data?.['counters'] as number | undefined) ?? 0) !== 0,
    effect: {
      targets: {
        what: 'unit', min: 0,
        prompt: 'Flux Constructor: put those counters onto another target unit',
      },
      run: (g, ctx) => {
        const n = (ctx.event?.data?.['counters'] as number | undefined) ?? 0;
        const t = ctx.targets[0];
        if (!n || !isEnt(t)) return;
        const u = g.entity(t.id);
        if (u) g.addCounters(u, n);
      },
    },
  }],
});

// "[Augment] If one or more counters would be put on a unit by an allied
// source, put that many counters plus one instead." — mm/2 2/2 Technology
// Construct Unit. ⚠ header approximation: replacement → post-hoc trigger on
// 'countersChanged' for POSITIVE counters on ALLIED units; the extra counter
// is added silently (no event → no chains, no loops). Text-box [Augment]:
// live when played normally, donated on augment (the host carries it).
card('Flux Resonator', {
  augmentText: [{
    type: 'triggered', events: ['countersChanged'],
    label: 'one more counter (allied +1/+1 counters get +1)',
    when: (g, self, ev) => {
      const n = (ev.data?.n as number | undefined) ?? 0;
      const u = g.entity(ev.data?.unit as EntityId);
      return !!u && n > 0 && u.controller === self.controller;
    },
    effect: {
      run: (g, ctx) => {
        const u = g.entity(ctx.event?.data?.unit as EntityId);
        if (!u) return;
        u.counters += 1;   // silent on purpose — see the header note
        g.ev('info', `Flux Resonator: one more counter on ${u.card} (net ${u.counters}).`);
      },
    },
  }],
});

// "[Switch1] Glimpse 1 (Reveal the top card of the deck and cache it. Until
// end of turn, you may play it as if it was in your hand, ignoring
// affinity.)" — m/1 {Battle} Cosmic Spell. The reminder text IS R45 verbatim,
// and E.glimpse does exactly that. Bounded graft ([Switch1]).
const foretellGlimpse: EffectDef = {
  run: (g, ctx) => { g.glimpse(ctx.controller, 1); },
};
card('Foretell', {
  spellEffect: foretellGlimpse,
  graftEffect: { bounded: true, effect: foretellGlimpse },
});

// "When I attack or block, [Switch] Target unit becomes a base 4/4 and loses
// all attributes until regroup. (This removes attributes from its column.)"
// — mm/3 2/2 {Flying} Cloud Avatar Unit. The base-4/4 half REWRITES layer 2
// (E.setBase): "becomes a base 4/4" replaces the base, so it does not compound
// with a base already rewritten by Body Swap — doing it with addTemp is how a
// swapped Bloated Manablub came out a 6/9 instead of a 4/4 (playtest
// 2026-08-20). The attribute-loss half is live too (R62), and the printed
// reminder is the reason it has to be a real layer rather than a subtraction:
// switching the target's attribute layer off removes what it was SHARING into
// its column, which E.colAttrs gets for free by unioning ownAttrs.
// Unbounded graft cause ([Switch]).
const formlessReshape: EffectDef = {
  targets: { what: 'unit', prompt: 'Formless: target unit becomes a base 4/4 until regroup' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) return;
    g.setBase(t, 4, 4);
    g.suppress(t, 'Formless', { attrs: true });   // R62 — abilities are untouched
    g.checkDeaths();
  },
};
card('Formless', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true, graftCause: true,
    label: 'target unit becomes a base 4/4 until regroup',
    effect: formlessReshape,
  }],
  graftEffect: { bounded: false, effect: formlessReshape },
});

// "[Augment] When I attack or block, create a Robot 2 in my formation." —
// mm/3 1/2 Hooba Robot Unit. Text-box [Augment]; live when played normally
// (Manual Q&A). "In my formation" is battle-local (R28 exception): the Robot
// spawns in the battle region and joins my column if open, else the first
// open column on my side; with no room it stays in the region unslotted.
card('Hooba-Bot', {
  augmentText: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: 'create a Robot 2 in my formation',
    effect: {
      run: (g, ctx) => {
        const robot = makeRobot(g, ctx.controller, 2, ctx.region);
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        const b = g.s.battle;
        if (!self || !b) return;
        const grid = b.columns.some(col => col.includes(self.id))
          ? b.columns : Object.values(b.blocks);
        const myCol = grid.find(col => col.includes(self.id));
        const hasRoom = (col: EntityId[]) => col.filter(id => g.entity(id)).length < 2;
        const col = (myCol && hasRoom(myCol)) ? myCol : grid.find(hasRoom);
        if (col) col.push(robot.id);
        else g.ev('info', 'Hooba-Bot: no open position — the Robot stays in the region, outside the formation.');
      },
    },
  }],
});

// "[Augment] [x], Sacrifice another nontoken unit: Create a Robot X. X can't
// be 0." — mm/2 3/1 Spirit Construct Unit. An ACTIVATED ability in the
// [Augment] text box: live when played normally (via: 'augment') and donated
// to hosts (via: { mod }). ⚠ header approximation: both costs are paid at
// RESOLUTION — X is chosen (1..open mana) and paid there, and the sacrifice
// is any of your nontoken units other than the carrier. No mana or no victim
// → no effect. The Robot arrives at home (R28).
card('Instrument of Reassignment', {
  augmentText: [{
    type: 'activated', cost: {},   // [x] + the sacrifice, paid at resolution
    label: '[x], sacrifice another nontoken unit: create a Robot X',
    effect: {
      run: (g, ctx) => {
        const open = g.openMana(ctx.controller);
        if (open < 1) { g.ev('info', "Instrument of Reassignment: X can't be 0 and no mana is open — no effect."); return; }
        const victims = g.unitsOf(ctx.controller).filter(u => !u.token && u.id !== ctx.sourceId);
        if (!victims.length) { g.ev('info', 'Instrument of Reassignment: no other nontoken unit to sacrifice — no effect.'); return; }
        const xOpts: { label: string; value: unknown }[] = [];
        for (let x = 1; x <= open; x++) xOpts.push({ label: `X = ${x}`, value: x });
        const x = ctx.choose('iorX', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Instrument of Reassignment: choose X (paid now — engine approximation)',
          options: xOpts,
        }) as number;
        const sacId = ctx.choose('iorSac', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Instrument of Reassignment: sacrifice another nontoken unit',
          options: victims.map(u => ({ label: u.card, value: u.id, card: u.card })),
        }) as EntityId;
        const victim = g.entity(sacId);
        if (!victim) return;
        g.payMana(ctx.controller, x);
        g.destroy(victim, 'is sacrificed');
        makeRobot(g, ctx.controller, x);
      },
    },
  }],
});

// "Target opponent negates an effect they control." — mm/2 {Battle} AI Cosmic
// Spell. Target is a player (spec 'any'; a unit pick is a no-op — the text
// only targets players). THE OPPONENT chooses which of their stack items to
// negate (any un-negated effect they control); exactly one → automatic;
// none → nothing happens.
card('Interdiction Rift', {
  spellEffect: {
    // R64: "target OPPONENT" is a player-only, opponent-only kind — 'any'
    // offered every unit on the board and the caster themself.
    targets: { what: 'opponent', prompt: 'Interdiction Rift: target opponent negates an effect they control' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('player' in (t as object))) return;
      const who = (t as { player: Seat }).player;
      if (who === ctx.controller) { g.ev('info', 'Interdiction Rift: you are not an opponent — no effect.'); return; }
      const theirs = g.s.stack.filter(i => i.controller === who && !i.negated);
      if (!theirs.length) { g.ev('info', `Interdiction Rift: ${g.pname(who)} controls no effect — nothing to negate.`); return; }
      const id = theirs.length === 1 ? theirs[0]!.id : ctx.choose('rift', {
        kind: 'payOrDecline', seat: who,
        prompt: 'Interdiction Rift: negate an effect you control',
        options: theirs.map(i => ({ label: i.label, value: i.id })),
      }) as number;
      g.negate(id);
    },
  },
});

// "Switch the power and defense of target unit until regroup." — mm/2
// {Battle} {Reaping} Occult Technology Spell. ⚠ header approximation: the
// EFFECTIVE stats at resolution are swapped via a temp delta (cleared at
// regroup). If the swap kills (a 0-power unit becomes X/0), the printed
// {Reaping} draws the caster a card (the engine's Reaping hook is
// damage-only, so it is honored here in card code).
card('Invasive Reassignment', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Invasive Reassignment: switch the power and defense of target unit until regroup' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      const [p, d] = g.effStats(t);
      g.addTemp(t, d - p, p - d);
      g.checkDeaths();
      if (!g.entity(t.id)) {
        g.ev('info', `Reaping: ${g.pname(ctx.controller)} draws a card.`);
        g.draw(ctx.controller, 1);
      }
    },
  },
});

// "[Switch1] /[Sacrifice a unit]: Each opponent sacrifices a unit." — m/1
// {Battle} Technology Spell. The slash cost is a CAST COST (R35): the
// caster's sacrifice is chosen and paid before the spell reaches the stack —
// no unit of yours IN THE REGION, no cast (R35 scopes cast costs to the
// item's region, superseding this batch's old any-region note). "Each
// opponent" is region-scoped (R25): opponents present in the effect's region
// sacrifice one of their units THERE (none there → nothing for them).
// Bounded graft ([Switch1], R9) — the rider pays (or declines) at composite
// cast time.
const linkedExtinction: EffectDef = {
  castCost: { kind: 'sacrificeUnit' },
  run: (g, ctx) => {
    if (!ctx.costPaid?.sacrificed) return;   // rider declined / unpayable
    for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
      if (seat === ctx.controller) continue;
      const units = g.unitsOf(seat, ctx.region);
      if (!units.length) { g.ev('info', `Linked Extinction: ${g.pname(seat)} has no unit here.`); continue; }
      const id = units.length === 1 ? units[0]!.id : ctx.choose(`leOpp:${seat}`, {
        kind: 'payOrDecline', seat,
        prompt: 'Linked Extinction: sacrifice a unit',
        options: units.map(u => ({ label: u.card, value: u.id, card: u.card })),
      }) as EntityId;
      const u = g.entity(id);
      if (u) g.destroy(u, 'is sacrificed');
    }
  },
};
card('Linked Extinction', {
  spellEffect: linkedExtinction,
  graftEffect: { bounded: true, effect: linkedExtinction },
});

// "[Augment] [three]: Create a Robot 2." — mm/4 2/4 Robot Unit. An ACTIVATED
// ability in the [Augment] text box: live when played normally
// (via: 'augment') and donated to hosts (via: { mod }). The Robot arrives in
// its controller's home region (R28).
card('Living Forge', {
  augmentText: [{
    type: 'activated', cost: { mana: 3 },
    label: '[three]: create a Robot 2',
    effect: { run: (g, ctx) => { makeRobot(g, ctx.controller, 2); } },
  }],
});

// "[Switch1] Create a Robot 3, a Robot 2 and a Robot 1." — mmm/6 Robot
// Spell (deploy timing). All three arrive in the controller's home region
// (R28). Bounded graft ([Switch1], R9).
const manufactureRobots: EffectDef = {
  run: (g, ctx) => { for (const x of [3, 2, 1]) makeRobot(g, ctx.controller, x); },
};
card('Manufacture', {
  spellEffect: manufactureRobots,
  graftEffect: { bounded: true, effect: manufactureRobots },
});

// "If I spawned this turn, other units lose all attributes and abilities
// during battle." — m/1 1/1 {Battle} Bedlam Alien Monkey Unit. R62's
// continuous suppression, with both of the printed conditions read live
// (a static is re-evaluated every time anybody asks, so "if I spawned this
// turn" stops being true the moment the turn rolls over, and the whole thing
// switches off outside battle):
//   - "other units": every unit in the region but Monke itself, BOTH sides'
//     — the text says units, not your units, and this one is symmetrical on
//     purpose (it is a 1/1 that turns the battle vanilla for everyone).
//   - region scope is the engine's (R12), as for every other static.
// Two Monkes do not silence each other: staticsFor's suppression check is the
// entity flag only, so simultaneous static-vs-static suppression resolves in
// one pass and both keep radiating (R62).
card('Monke', {
  statics: [{
    affects: (g, self, t) => t.kind === 'unit' && t.id !== self.id
      && g.s.phase === 'battle' && g.spawnedTurn(self) === g.s.turn,
    suppressAttrs: true, suppressAbilities: true,
  }],
});

// "[Augment] {Flying} Alien Cloud {Virus} Unit" — m/1 1/1. Type-line
// [Augment] grants {Flying} (printed.augmentAttrs); {Virus} lets it augment
// from hand during battle. No text — nothing to script.
card('Nebula Drifter', {});

// "[three]: [Switch] Put a +1/+1 counter on me." — mmm/3 2/1 Cosmic Robot
// Unit. An activated graft CAUSE (3 mana): grafted effects ride each
// activation; its own [Switch]-marked effect is unbounded when grafted
// elsewhere. "Me" = the ability's carrier (the host when grafted).
const evokerCounter: EffectDef = {
  run: (g, ctx) => {
    const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
    if (self) g.addCounters(self, 1);
  },
};
card('Omniwield Evoker', {
  abilities: [{
    type: 'activated', cost: { mana: 3 }, graftCause: true,
    label: '[three]: put a +1/+1 counter on me',
    effect: evokerCounter,
  }],
  graftEffect: { bounded: false, effect: evokerCounter },
});

// "Each player sacrifices half of their units, rounded up." — mm/4 {Battle}
// Occult Spell. Region-scoped (R12/R25 — header): each player present in the
// effect's region sacrifices ceil(their units there / 2), choosing which,
// caster first. The count is read per player as their picks begin (R1).
card('Perish', {
  spellEffect: {
    run: (g, ctx) => {
      const present = g.s.regions[ctx.region]!.presentSeats.slice();
      const seats = [
        ...present.filter(s => s === ctx.controller),
        ...present.filter(s => s !== ctx.controller),
      ];
      for (const seat of seats) {
        const units = () => g.unitsOf(seat, ctx.region);
        const n = Math.ceil(units().length / 2);
        for (let i = 0; i < n; i++) {
          const pool = units();
          if (!pool.length) break;
          const id = pool.length === 1 ? pool[0]!.id : ctx.choose(`perish:${seat}:${i}`, {
            kind: 'payOrDecline', seat,
            prompt: `Perish: sacrifice a unit (${n - i} to go)`,
            options: pool.map(u => ({ label: u.card, value: u.id, card: u.card })),
          }) as EntityId;
          const u = g.entity(id);
          if (u) g.destroy(u, 'is sacrificed');
        }
      }
    },
  },
});

// "I spawn with two +1/+1 counters. [Augment] When I despawn, you may move
// my counters onto target unit." — m/2 0/0 Robot Unit. ⚠ header
// approximations: the spawn counters are added synchronously in a
// bookkeeping when() at spawn-event time (a queued trigger is too late —
// the 0/0 would die to settle()'s death check first); the despawn amount is
// snapshotted into the event during when() (the unit is gone at
// resolution). Despawn = ANY leave-play ('died' + 'despawned', Bloated
// Manablub precedent). "You may": min 0 lets the chooser decline. The first
// sentence sits above the [Augment] marker → `abilities` (it does NOT
// transfer); the move-my-counters text transfers with the augment.
card('Powerforge Synergist', {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: '(bookkeeping) I spawn with two +1/+1 counters',
    when: (_g, self) => {
      self.counters += 2;   // synchronous, before any death check; silent
      return false;         // never queues — the when() IS the effect
    },
    effect: { run: () => { /* never queues */ } },
  }],
  augmentText: [{
    type: 'triggered', events: ['died', 'despawned'], self: true,
    label: 'move my counters onto target unit',
    when: (_g, self, ev) => {
      if (self.counters <= 0 || !ev.data) return false;
      ev.data['pfCounters'] = self.counters;   // snapshot: I am gone at resolution
      return true;
    },
    effect: {
      targets: { what: 'unit', min: 0, prompt: 'Powerforge Synergist: move my counters onto target unit (or decline)' },
      run: (g, ctx) => {
        const n = (ctx.event?.data?.['pfCounters'] as number | undefined) ?? 0;
        const t = ctx.targets[0];
        if (n > 0 && isEnt(t) && g.entity(t.id)) g.addCounters(t, n);
      },
    },
  }],
});

// "Your units gain \"When I die, create a Robot 3.\" until regroup." — mm/3
// {Battle} Occult Technology Spell. R63: the granted clause is authored HERE,
// as this card's own abilities[0], and handed to each unit as a reference.
// Nothing else can ever fire it — a spell is never a unit in play, so
// fireEvent's scan reaches abilities[0] only through the grants below.
//
// "Your units" is region-scoped (R12, the Flowstone Arcanite precedent): the
// units with you where the spell is cast. The grant is a snapshot of that
// moment, exactly as the printed text reads — a unit that arrives afterwards
// was not one of "your units" when the spell resolved and gets nothing.
const REFORGED = 'When I die, create a Robot 3.';
card('Reforge the Dead', {
  abilities: [{
    type: 'triggered', events: ['died'], self: true,
    label: 'create a Robot 3 (granted by Reforge the Dead)',
    effect: {
      run: (g, ctx) => { makeRobot(g, ctx.controller, 3, ctx.region); },
    },
  }],
  spellEffect: {
    run: (g, ctx) => {
      const units = g.unitsOf(ctx.controller, ctx.region);
      for (const u of units) {
        g.grantText(u, {
          card: 'Reforge the Dead', via: 'ability', index: 0,
          text: REFORGED, from: 'Reforge the Dead',
        });
      }
      if (!units.length) g.ev('info', 'Reforge the Dead: no units to grant it to.');
    },
  },
});
