/* batch-wood-b — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Wood cards scripted over the printed data in printed.json
 * (never hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R6 (mid-resolution payments/choices via ctx.choose), R9 (bounded budgets
 * per card), R12/R25 ("each player/opponent"/"all …" effects read the event
 * region's present seats/units; listeners are region-scoped), R27 (counting
 * amounts are live at resolution), R115 (created UNITS arrive where their
 * SOURCE is — ctx.region — unless the text names a place; that is where spell
 * tokens always appeared).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - MYCELIAL MENTOR "when you create a token": the engine logs
 *    'tokenCreated' for SPELL tokens (createSpellToken) but never runs
 *    triggers off it — only unit-token creation ('spawned' with a token
 *    flag) can fire the trigger today. 'tokenCreated' is still listed in
 *    the events so the card starts hearing spell tokens the moment the
 *    engine fires that event.
 *    ⚠ NEEDS-ESCALATION (2026-08-24 literal-reading sweep). This is NOT a
 *    rules approximation, it is half a printed sentence lying dead — the R125
 *    shape exactly. "A token" carries no qualifier, and the set itself proves
 *    spell tokens are tokens: Cosmic Conspirator prints "if you would create a
 *    Robot, POISON, CRYSTAL or FIREBALL", and this very batch mints Poisons on
 *    four cards. Half the card works (unit tokens), so no sweep can see the
 *    other half. The fix is one line and it is in engine.ts, which this batch
 *    may not touch: in `createSpellToken`, keep the event and dispatch it —
 *        const ev = this.ev('tokenCreated', …);  this.fireEvent('tokenCreated', ev);
 *    'tokenCreated' is already an EventType (types.ts) and the card's `when`
 *    already reads `ev.data?.seat`, so nothing else changes. Ask the owner
 *    whether creating a Poison/Crystal/Fireball is "creating a token" (the
 *    expected answer, per R125's "all the cards are pretty literal"), then
 *    make the engine fire it.
 *  - NOXIOUS DEMISE is printed {Reaping}, but the engine's Reaping rider
 *    lives in dealEffectDamage and this spell kills via a -1/-1 counter —
 *    the "kill → its controller draws" rider is hand-rolled in the effect
 *    (mirrors the engine's own Reaping log line).
 *  - ORGANIC EXCHANGE "swap their positions": position = formation slot
 *    (attacker/blocker grids). Units outside any formation simply trade
 *    controllers (and regions, a no-op for same-region targets); at regroup
 *    everyone returns to their new controller's home region, which is what
 *    a permanent control exchange needs.
 *  - MINDSPORE FIEND "give an opponent control": the opponent is the other
 *    present seat of the effect's region (R25) — resolving with no opponent
 *    present (out-of-battle graft timing) is a no-op, no draw.
 *
 * PARKED (needs engine machinery that does not exist yet):
 *  - (Phytochemical Protection UNPARKED by R98, round 17 — see the card. The
 *    prevention layer it waited on is `E.preventUnitDamage`, the one choke
 *    point both unit-damage commits now pass through, with the shield kept on
 *    `Entity.damageShield` and swept by the R11 regroup cleanup.)
 */
import type { Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, type EffectDef } from '../dsl.ts';
import { isEnt, chooseUnit } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** present seats of a region, initiative player first (stable order) */
const presentSeats = (g: E, region: number): Seat[] => {
  const present = g.s.regions[region]!.presentSeats;
  return [g.initiative, g.nit].filter(s => present.includes(s));
};

// ────────────────────────────── the cards ──────────────────────────────

// "When I attack, [Switch1] Create a Poison 5." — ggg/4 5/3 Blight Beast
// Unit. Attack trigger (self), [Switch1] bounded (R9), graft cause. The
// Poison is a SPELL token — it appears where the effect resolves (the
// battle region, R115), ready to be thrown this battle.
const createPoison5: EffectDef = {
  creates: ['Poison'],
  run: (g, ctx) => { g.createSpellToken(ctx.controller, 'Poison', 5, ctx.region); },
};
card('Megadeath', {
  abilities: [{
    type: 'triggered', events: ['attacked'], self: true, bounded: true, graftCause: true,
    label: 'Create a Poison 5',
    effect: createPoison5,
  }],
  graftEffect: { bounded: true, effect: createPoison5 },
});

// "[Switch1] Target unit gains +1/+1 for each of your units until regroup."
// — g/2 {Battle} Tree Druid Spell. The whole line is the bounded graftable
// effect. Amount = the caster's units IN THE EFFECT'S REGION, live at
// RESOLUTION (R1/R27); "until regroup" = addTemp (cleared at regroup R11).
const groveMight: EffectDef = {
  targets: { what: 'unit', prompt: 'Might of the Grove: target unit gains +1/+1 for each of your units until regroup' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) {
      g.ev('info', 'Might of the Grove: the target is gone — nothing is buffed.');
      return;
    }
    const n = g.unitsOf(ctx.controller, ctx.region).length;
    if (n <= 0) { g.ev('info', 'Might of the Grove: you control no unit here — +0/+0.'); return; }
    g.addTemp(g.entity(t.id)!, n, n);
  },
};
card('Might of the Grove', {
  spellEffect: groveMight,
  graftEffect: { bounded: true, effect: groveMight },
});

// "After combat, [Switch1] You may give an opponent control of target ally.
// If you do, draw a card." — g/1 1/1 Alien Fungus Unit. NOT self: the
// afterCombat event carries no source unit (Deathglow Strider precedent) —
// region scoping keeps it to the battle I'm in. The ally is the cast-time
// target; "you may" is a mid-resolution decline (R6). ⚠ header note: the
// opponent is the other present seat (R25) — none present → no-op, no draw.
// The unit keeps its formation slot for the (already finished) battle and
// goes to its NEW controller's home region at regroup.
const mindsporeGive: EffectDef = {
  targets: { what: 'allyUnit', prompt: 'Mindspore Fiend: you may give an opponent control of target ally (if you do, draw a card)' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) return;
    const u = g.entity(t.id)!;
    if (u.controller !== ctx.controller) { g.ev('info', `Mindspore Fiend: ${u.card} is no longer an ally — no effect.`); return; }
    const opp = presentSeats(g, ctx.region).find(s => s !== ctx.controller);
    if (opp === undefined) { g.ev('info', 'Mindspore Fiend: no opponent is present (R25) — no effect.'); return; }
    const gives = ctx.choose('give', {
      kind: 'payOrDecline', seat: ctx.controller,
      prompt: `Mindspore Fiend: give ${g.pname(opp)} control of ${u.card} and draw a card?`,
      options: [{ label: 'Give control — draw a card', value: true }, { label: 'Decline', value: false }],
    });
    if (gives !== true) { g.ev('info', 'Mindspore Fiend: declined — no control change, no draw.'); return; }
    u.controller = opp;
    g.ev('info', `Mindspore Fiend: ${g.pname(opp)} gains control of ${u.card}.`);
    g.draw(ctx.controller, 1);
  },
};
card('Mindspore Fiend', {
  abilities: [{
    type: 'triggered', events: ['afterCombat'], bounded: true, graftCause: true,
    label: 'you may give an opponent control of target ally — draw a card',
    effect: mindsporeGive,
  }],
  graftEffect: { bounded: true, effect: mindsporeGive },
});

// "When you create a token, [Switch1] Target ally gains +3/+3 until
// regroup." — g/1 2/1 Fungus Unit. Conditions at event time (R1): a unit
// token I control spawning ('spawned' with the token flag), or — ⚠ header
// approximation — a spell token ('tokenCreated', which the engine logs but
// does not yet fire as a trigger event; listed so the card starts working
// when it does). Region-scoped listener (R12): I only hear tokens made in
// my region. [Switch1] bounded (R9).
const mentorBuff: EffectDef = {
  targets: { what: 'allyUnit', prompt: 'Mycelial Mentor: target ally gains +3/+3 until regroup' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (isEnt(t) && g.entity(t.id)) g.addTemp(g.entity(t.id)!, 3, 3);
  },
};
card('Mycelial Mentor', {
  abilities: [{
    type: 'triggered', events: ['spawned', 'tokenCreated'], bounded: true, graftCause: true,
    label: 'target ally gains +3/+3 until regroup (when you create a token)',
    when: (g, self, ev) =>
      ev.type === 'spawned'
        ? ev.data?.seat === self.controller && !!g.entity(ev.data?.unit as EntityId)?.token
        : ev.data?.seat === self.controller,
    effect: mentorBuff,
  }],
  graftEffect: { bounded: true, effect: mentorBuff },
});

// "[Augment] When I die, put a -1/-1 counter on each unit." — gg/3 4/2
// Blight Fungus {Virus} Unit. Text-box [Augment]: donated, "I" is the host
// (the Virus points it at an enemy unit); live when played normally
// (Manual Q&A). "Each unit" = every unit in the event's region (R12), both
// sides — the list is snapshotted, then each still-alive unit is hit.
card('Noxious Deathcap', {
  augmentText: [{
    type: 'triggered', events: ['died'], self: true,
    label: 'put a -1/-1 counter on each unit (when I die)',
    effect: {
      run: (g, ctx) => {
        const units = g.unitsIn(ctx.region);
        if (!units.length) { g.ev('info', 'Noxious Deathcap: there is no unit here to poison.'); return; }
        for (const u of units) {
          if (g.entity(u.id)) g.addCounters(u, -1);
        }
      },
    },
  }],
});

// "Put a -1/-1 counter on target unit." — gg/1 {Battle} {Reaping} Arcane
// Blight Spell. ⚠ header note: the printed {Reaping} rider is hand-rolled —
// the counter (not damage) is what kills, so the engine's dealEffectDamage
// Reaping never sees it. Kill at resolution → the caster draws.
card('Noxious Demise', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Noxious Demise: put a -1/-1 counter on target unit' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      const u = g.entity(t.id)!;
      g.addCounters(u, -1);
      if (!g.entity(u.id)) {
        g.ev('info', `Reaping: ${g.pname(ctx.controller)} draws a card.`);
        g.draw(ctx.controller, 1);
      }
    },
  },
});

// "Exchange control of two target units and swap their positions." — gg/3
// {Battle} Fungus Spell. Both units are cast-time targets (count: 2, min: 2);
// the exchange needs both, so a gone target fizzles the whole part
// (allOrNothing). ⚠ header note: position = formation slot — each unit takes
// the other's slot in the attacker/blocker grids (a unit outside any
// formation just trades controller); regions are swapped symmetrically
// (same-region targets: no-op) and regroup sends everyone to their NEW
// controller's home.
card('Organic Exchange', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Organic Exchange: two target units — exchange control and swap positions', count: 2, min: 2 },
    allOrNothing: true,
    run: (g, ctx) => {
      const [ta, tb] = ctx.targets;
      if (!isEnt(ta) || !isEnt(tb) || !g.entity(ta.id) || !g.entity(tb.id)) {
        g.ev('info', 'Organic Exchange: a unit is gone — no exchange.');
        return;
      }
      const a = g.entity(ta.id)!, b = g.entity(tb.id)!;
      const [ca, cb] = [a.controller, b.controller];
      a.controller = cb; b.controller = ca;
      const [ra, rb] = [a.region, b.region];
      a.region = rb; b.region = ra;
      const bt = g.s.battle;
      if (bt) {
        const grids = [...bt.columns, ...Object.values(bt.blocks)];
        let slotA: [EntityId[], number] | null = null;
        let slotB: [EntityId[], number] | null = null;
        for (const col of grids) {
          const ia = col.indexOf(a.id);
          if (ia !== -1) slotA = [col, ia];
          const ib = col.indexOf(b.id);
          if (ib !== -1) slotB = [col, ib];
        }
        if (slotA) slotA[0][slotA[1]] = b.id;
        if (slotB) slotB[0][slotB[1]] = a.id;
      }
      // CARD-TODO #6: two targets under the SAME controller is a legal, useful
      // line (the positions really do swap) — but the two control assignments
      // cancel, and saying "Player 1 takes X, Player 1 takes Y" named the same
      // player twice and read like a bug. Say what actually happened instead.
      if (ca === cb) {
        g.ev('info',
          `Organic Exchange: ${a.card} and ${b.card} are both ${g.pname(ca)}'s — `
          + 'their positions swap and control does not change.');
      } else {
        g.ev('info', `Organic Exchange: ${g.pname(cb)} takes ${a.card}, ${g.pname(ca)} takes ${b.card} — positions swapped.`);
      }
    },
  },
});

// "[Switch1] Target unit gains +7/+7 until regroup." — g/2 Flower Spell
// (deploy timing). The whole line is the bounded graftable effect.
const overbloomBuff: EffectDef = {
  targets: { what: 'unit', prompt: 'Overbloom: target unit gains +7/+7 until regroup' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (isEnt(t) && g.entity(t.id)) g.addTemp(g.entity(t.id)!, 7, 7);
  },
};
card('Overbloom', {
  spellEffect: overbloomBuff,
  graftEffect: { bounded: true, effect: overbloomBuff },
});

// "[Augment] [two]: Create a 1/1 unit." — gg/6 4/4 Plant Unit. An ACTIVATED
// ability in the [Augment] text box: live when played normally
// (via: 'augment') and donated to hosts (via: { mod }). The created unit
// arrives where the carrier is (R115: ctx.region) — activate it while Pack
// Leader is attacking and the 1/1 is minted in the enemy region, in no column
// and unable to block the counterattack. Unbounded (no [once]).
card('Pack Leader', {
  augmentText: [{
    type: 'activated', cost: { mana: 2 },
    label: '[two]: create a 1/1 unit',
    effect: {
      creates: ['Unit Token'],
      run: (g, ctx) => {
        g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [1, 1] });
      },
    },
  }],
});

// "When I spawn, create two 1/1 units. [Augment] When I despawn, delete all
// token allies." — gg/2 2/3 Fungus Parasite {Virus} Unit. The spawn clause
// is a normal ability (created units arrive at ctx.region, R115). The despawn clause
// is text-box [Augment] — as a Virus on an enemy unit, "allies" are the
// HOST's controller's units, which is the whole point of the card. DESPAWN
// = ANY leave-play: 'died' + 'despawned' (the Bloated Manablub precedent).
// "All token allies" is region-scoped (R12): tokens in the event's region.
card('Pathogenic Enclave', {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: 'create two 1/1 units',
    effect: {
      creates: ['Unit Token'],
      run: (g, ctx) => {
        for (let i = 0; i < 2; i++) {
          g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [1, 1] });
        }
      },
    },
  }],
  augmentText: [{
    type: 'triggered', events: ['died', 'despawned'], self: true,
    label: 'delete all token allies (when I despawn)',
    effect: {
      run: (g, ctx) => {
        const toks = g.unitsOf(ctx.controller, ctx.region).filter(u => u.token);
        if (!toks.length) { g.ev('info', 'Pathogenic Enclave: there is no token ally here to delete.'); return; }
        for (const u of toks) {
          if (g.entity(u.id)) g.destroy(u, 'is deleted');
        }
      },
    },
  }],
});

// "[Switch1] Your units gain +2/+2 and {Piercing} until regroup." — gg/4
// Alien Druid Spell (deploy timing). The whole line is the bounded graftable
// effect. "Your units" = the caster's units in the effect's region (R12),
// snapshotted at resolution; addTemp + addTempAttr both clear at regroup.
const photosynthesis: EffectDef = {
  run: (g, ctx) => {
    const mine = g.unitsOf(ctx.controller, ctx.region);
    if (!mine.length) { g.ev('info', `${ctx.sourceName}: you control no unit here — nothing gains +2/+2.`); return; }
    for (const u of mine) {
      g.addTemp(u, 2, 2);
      g.addTempAttr(u, 'Piercing');
    }
  },
};
card('Pernicious Photosynthesis', {
  spellEffect: photosynthesis,
  graftEffect: { bounded: true, effect: photosynthesis },
});

// "[Augment] Whenever one or more -1/-1 counters are put on a unit, each
// opponent loses 1 life." — gg/2 1/3 {Poisonous} Blight Unit. Text-box
// [Augment]; live when played normally (Manual Q&A) — its own Poisonous
// damage lands as -1/-1 counters and feeds the trigger. Condition at event
// time (R1): the countersChanged batch was negative ("one or more" = one
// firing per batch). "Each opponent" is region-scoped (R25), read from the
// carrier's controller at resolution.
card('Pestilent Mycelion', {
  augmentText: [{
    type: 'triggered', events: ['countersChanged'],
    label: 'each opponent loses 1 life (when -1/-1 counters land on a unit)',
    when: (g, self, ev) => ((ev.data?.n as number) ?? 0) < 0,
    effect: {
      run: (g, ctx) => {
        for (const seat of presentSeats(g, ctx.region)) {
          if (seat !== ctx.controller) g.loseLife(seat, 1, 'Pestilent Mycelion');
        }
      },
    },
  }],
});

// "Until regroup, prevent all damage that would be dealt to target unit.
// Put a +1/+1 counter on it for each damage prevented this way." — gg/2
// {Battle} Plant Spell. UNPARKED by R98 (report #72, GETD 2026-08-22:
// "Phytochemical Protection is entirely non functional. Needs to work like the
// text says."). It was: the spell targeted, logged and did nothing, because
// there was no "damage would be dealt to a UNIT" hook anywhere in the engine.
//
// R98 built the three things the park named: `E.preventUnitDamage`, the one
// choke point both unit-damage commits now pass through; `Entity.damageShield`
// (the CARD that shielded, like `suppressed`), swept by the R11 regroup
// cleanup; and `Entity.shieldPending` + `E.settleDamagePrevention`, the running
// per-unit total that pays out "a +1/+1 counter for each damage prevented".
//
// PREVENTED MEANS NOT DEALT, and that is the whole card. RAQ "[Solved]
// Poisonous vs 'Whenever I am dealt damage' vs Phytochemical Protection":
//   Q: "Does Poisonous bypass Phytochemical Protection?"
//   A: "No it doesn't. As said above, damage is dealt in the form of -1/-1
//       counters, which means if there is not damage being dealt, then no
//       counters are placed."
//   "Then Sporebloom Siren deals 2 damage to Jollyglop, but damage is
//    prevented. Jollyglop doesn't trigger, won't get -2/-2 from Poisonous but
//    will receive +2/+2 counters from Phytochemical Protection."
// So no 'damage' event fires, "whenever I am dealt damage" stays silent, and
// {Deadly}, {Resonant}, {Blessed} and Poisonous all have nothing to key on.
// ⚠ This is the OPPOSITE of the R38 replacement hooks, where "replacing the
// damage does NOT unmake it" (Caleb 2024-10-24) and {Lethal} still kills
// through. Prevention unmakes it; replacement does not.
//
// ASSIGNMENT IS UNTOUCHED. RAQ "[Solved] Excessive Combat Damage & interaction
// with Piercing, Deadly and Phytochemical Protection", on a shielded 0/5 Awoken
// Tomb in front of a 5/6 Bubb: "You must assign atleast 5 damage to Awoken
// before you can start assigning damage to Bubb in the back. Awoken will get
// atleast +5/+5 counters, but won't make 5/5 unit." With Deadly: "Atleast 1 dmg
// to Awoken (gets +1/+1, won't create 1/1 unit), rest of the damage can go to
// Bubb." With Piercing: "Atleast 5 damage to Awoken … atleast 6 damage to Bubb,
// rest can go to Opponent HP." The shield is a COMMIT-time layer for exactly
// that reason — it must not make the attacker assign differently.
//
// ⚠ OPEN, and deliberately answered the simple way: two Phytochemical
// Protections on ONE unit. The shield is a single named flag, so the second
// spell re-stamps it and the unit still gets ONE counter per damage prevented,
// not two. Nothing in the corpus addresses it; flagged in R98.
//   AUDITED 2026-08-24 (literal-reading sweep) and left alone: here the simple
//   answer and the literal reading coincide. "Put a +1/+1 counter on it for
//   each damage prevented THIS WAY" is paid by the prevention that did the
//   preventing, and once the first shield has prevented all the damage there
//   is no damage the second one "would" prevent — so a second copy pays for
//   nothing however the flag is stored. The note's REASONING is still
//   mechanism-shaped (one flag → one payout), which is the R125 smell; the
//   ANSWER is not. Left open in case the owner rules preventions stack.
//
// ⚠ WHAT THE SAME SWEEP DID FIND: "prevent ALL damage that would be dealt to
// target unit" carries no qualifier, so it has to reach every unit-damage
// commit — and there were THREE, not the two R98 counted. Oorblak
// (batch-earth-b) is a card-side commit: its replacement hook wrote
// `self.damage` directly and never asked `preventUnitDamage`, so redirected
// combat damage went through a shielded Oorblak. Fixed in the hook, which is
// where the extra commit lives; tests in 112-literal-wood.
card('Phytochemical Protection', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Phytochemical Protection: prevent all damage to target unit until regroup' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      const u = isEnt(t) ? g.entity(t.id) : undefined;
      if (!u) {
        g.ev('info', 'Phytochemical Protection: the target is gone — no shield is applied.');
        return;
      }
      u.damageShield = 'Phytochemical Protection';
      g.ev('info',
        `Phytochemical Protection: all damage to ${u.card} is prevented until regroup `
        + '(it gets a +1/+1 counter for each damage prevented).',
        { unit: u.id });
    },
  },
});

// "[Augment] [three]: Each opponent chooses one of their units. Put a -1/-1
// counter on each of the chosen units." — g/2 2/2 Insect Plant Unit. An
// ACTIVATED ability in the [Augment] text box. "Each opponent" = the event
// region's present seats other than mine (R25) — activated at home during
// deployment it affects nobody. Each opponent picks their OWN unit (auto when
// they have only one); all picks are gathered before any counter lands
// (plan-then-commit), then each chosen unit gets a -1/-1 counter.
card('Plague Bellower', {
  augmentText: [{
    type: 'activated', cost: { mana: 3 },
    label: '[three]: each opponent picks a unit — a -1/-1 counter on each',
    effect: {
      run: (g, ctx) => {
        const picks: Entity[] = [];
        for (const seat of presentSeats(g, ctx.region)) {
          if (seat === ctx.controller) continue;
          const units = g.unitsOf(seat, ctx.region);
          if (!units.length) continue;
          const u = chooseUnit(g, ctx, `pb:${seat}`, seat, units,
            'Plague Bellower: choose one of your units (it gets a -1/-1 counter)');
          if (u) picks.push(u);
        }
        if (!picks.length) g.ev('info', 'Plague Bellower: no opponent here has a unit — no counters.');
        for (const u of picks) {
          if (g.entity(u.id)) g.addCounters(u, -1);
        }
      },
    },
  }],
});

// "[Augment] I gain +1/+1 for each other ally." — g/1 0/1 Plant Beast Unit.
// A statics-only text-box [Augment]: the continuous buff is a StaticMod that
// affects only its carrier ("I" = the host when donated, itself when played
// normally — statics radiate from augment mods anchored on their host).
// `augmentable` marks it as an augment despite having no augmentAttrs and no
// augmentText. Amount is live: allies counted per evaluation, region-scoped,
// excluding the carrier (raw unit counts only — no effStats reentrancy).
const otherAllies = (g: E, self: Entity): number =>
  g.unitsOf(self.controller, self.region).filter(u => u.id !== self.id).length;
card('Prickly Protector', {
  augmentable: true,
  statics: [{
    affects: (g, self, t) => t.id === self.id,
    dp: otherAllies,
    dt: otherAllies,
  }],
});
