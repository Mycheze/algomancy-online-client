/* batch-fire-a — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Fire cards scripted over the printed data in printed.json
 * (never hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R6 (mid-resolution payments/choices via ctx.choose), R9 (bounded budgets
 * per card), R12/R25 ("each player/opponent" and "your units" are
 * region-scoped via presentSeats / unitsOf(region)).
 *
 * PARKED (needs engine machinery that does not exist yet — each card still
 * registers so nothing crashes, and each has a todo test):
 *  - Abyssal Evocation: "you may play spells from your bin" needs a bin-play
 *    permission in doPlayCard (it only reads the hand) plus an "unstable until
 *    regroup" marker on cards so played. The spell resolves as a no-op (info
 *    event) and is binned normally.
 *  - Cinder Scuttler: UN-PARKED (R51) — "if I am in your bin, recall me" is a
 *    `zone: 'bin'` trigger, dispatched to the card while it sits in a bin on a
 *    detached stand-in owned by that bin's seat.
 *  - Conduit of Pain: "an allied source would deal noncombat damage ... plus 1
 *    instead" is a damage REPLACEMENT; dealEffectDamage has no replacement
 *    hooks. Registered with an inert augmentText entry so the card is still
 *    recognised as an augment (Astralith precedent).
 *  - Emberflame Enlightener (SPELLS half only): the UNITS half is a live
 *    static ({Powerful} to your units in its region) in BOTH forms — this
 *    entry used to add "and the augment-donated form needs mod-carried
 *    statics", which expired when E.anchored() started radiating a mod's
 *    statics from its host. What is still missing is a spell-effect ATTR
 *    projection: "your SPELLS gain Powerful" has to attach an attribute to a
 *    spell EFFECT, and statics project onto in-play UNITS only
 *    (dealEffectDamage reads the source CARD's printed attrs).
 *  - Envoy of Lightning: "your single-target spell effects are Electric" —
 *    still out of reach even with the statics layer: statics project only
 *    onto in-play UNITS, while this must attach {Electric} to spell EFFECTS
 *    (dealEffectDamage reads the source CARD's printed attrs, no seam for
 *    in-play modifiers). Inert augmentText entry only.
 *  - Fire Resource: resource CARDS aren't modelled — resources are plain
 *    ResourceState (no entities) and doActivateResource doesn't fireEvent, so
 *    "when I activate" has nothing to listen to. (The third reason this note
 *    used to give — "there is no 'Shard' resource kind" — is no longer true:
 *    E.createShard and a real 'shard' kind exist.) Registered as printed;
 *    registry.ts keeps every element's Resource face out of DECK_LIST.
 *  - Gravitational Correction (X half): UN-PARKED (R35) — X is now chosen and
 *    paid at cast; item.x is set before the spell hits the stack.
 *  - Harbinger of Immolation (augment half): "your spell tokens stay through
 *    regroup" needs a regroup-replacement hook (startRegroup erases all spell
 *    tokens unconditionally). The end-of-turn Fireball trigger is fully done.
 *  - Infernal Wispweaver: UN-PARKED (R62) — "do not sacrifice themselves after
 *    combat" was waiting on a way to suppress ANOTHER card's trigger, and
 *    StaticMod.suppressAbilities is it. The Wisp has exactly one ability, so
 *    the same static that gives +2/+1 switches the self-sacrifice off.
 */
import type { EntityId, Seat, TargetRef } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, effectByKey, getCard, type EffectDef } from '../dsl.ts';
import { selfOf, inEndOfTurn } from './helpers.ts';

/** a card that is a SPELL for bin purposes — a spell unit is one too (playing
 * it from the bin casts the spell and then spawns the body). */
const isSpellCard = (name: string): boolean => {
  const k = getCard(name).kind;
  return k === 'spell' || k === 'spellUnit';
};

// ─────────────────────────── shared helpers ───────────────────────────

/** "You may sacrifice a unit. If you do, draw a card." — mid-resolution
 * choice (R6 model): the controller picks one of their units in the event
 * region (R12) or declines. Plan-then-commit: the choose happens before any
 * mutation, so replay suspension stays deterministic. */
const sacrificeToDraw = (source: string): EffectDef => ({
  run: (g, ctx) => {
    const units = g.unitsOf(ctx.controller, ctx.region);
    if (!units.length) { g.ev('info', `${source}: you control no unit here — nothing to sacrifice.`); return; }
    if (inEndOfTurn(g)) {   // "may": auto-decline (no suspensions here)
      g.ev('info', `${source}: auto-declines the sacrifice (end-of-turn resolution).`);
      return;
    }
    const choice = ctx.choose('sac', {
      kind: 'payOrDecline', seat: ctx.controller,
      prompt: `${source}: sacrifice a unit to draw a card?`,
      options: [...units.map(u => ({ label: u.card, value: u.id })), { label: 'Decline', value: false }],
    });
    if (choice === false) { g.ev('info', `${source}: declined — no sacrifice, no draw.`); return; }
    const u = g.entity(choice as EntityId);
    if (!u) { g.ev('info', `${source}: the chosen unit is gone — no draw.`); return; }
    g.destroy(u, 'is sacrificed');
    g.draw(ctx.controller, 1);
  },
});

// ───────────────────────────────────────────────────────────────────────

// "In this battle, you may play spells from your bin. If you do, they gain
// {p}unstable until regroup. (If they would enter a bin, erase them instead.)"
// — rr/4 {Battle} Arcane Occult Spell. PARKED (see header): bin-play is not a
// thing doPlayCard can grant. Resolves as a no-op so the card never crashes.
card('Abyssal Evocation', {
  spellEffect: {
    run: (g, ctx) => {
      g.ev('info', `${ctx.sourceName}: PARKED — playing spells from the bin is not implemented yet; no effect.`);
    },
  },
});

// "[Augment] Your units gain +1/+0 for each nontoken spell you've played in
// this battle." — r/1 0/1 Anima Unit. Text-box [Augment].
// STATIC, not a trigger (playtest fix): the bonus is a live count of the
// battle's nontoken-spell ledger — it never touches the stack, applies to
// units that arrive mid-battle, and drops when the Spark leaves.
card('Animated Spark', {
  augmentable: true,   // text-box [Augment]: the static transfers when augmented
  statics: [{
    affects: (g, self, target) =>
      g.s.phase === 'battle' && target.kind === 'unit' && target.controller === self.controller,
    dp: (g, self) => g.s.battleCounters[self.region]?.[`spellsPlayed:${self.controller}`] ?? 0,
  }],
});

// "When my column deals combat damage to an opponent, [Switch1] You may
// sacrifice a unit. If you do, draw a card." — r/2 1/2 {Flying}. Condition at
// event time (R1) on the 'lifeLost' fired during combat: why === 'combat', the
// victim is an opponent, and my column connects — attacking and unblocked (or
// Piercing), or blocking with Piercing. Approximation: lifeLost is aggregated
// per damage sub-step, so a connecting zero-power column alongside another
// dealing column would also pass; no such column exists in normal play.
const revenantSac = sacrificeToDraw('Bloodwind Revenant');
card('Bloodwind Revenant', {
  abilities: [{
    type: 'triggered', events: ['lifeLost'], bounded: true, graftCause: true,
    label: 'you may sacrifice a unit to draw a card',
    when: (g, self, ev) => {
      if (ev.data?.why !== 'combat') return false;
      const b = g.s.battle;
      if (!b || ev.data?.seat === self.controller) return false;
      const col = g.columnOf(self.id);
      if (!col) return false;
      const ci = b.columns.indexOf(col);
      if (ci >= 0) {   // attacking: connects if never blocked, or Piercing
        return ev.data?.seat === b.defender
          && (b.blocks[ci] === undefined || g.colAttrs(col).has('Piercing'));
      }
      // blocking: only a Piercing blocking column reaches the attacker
      return ev.data?.seat === b.attacker && g.colAttrs(col).has('Piercing');
    },
    effect: revenantSac,
  }],
  graftEffect: { bounded: true, effect: revenantSac },
});

// "When you deal combat damage to an opponent, if I am in your bin, recall
// me. (Put me into your hand.)" — r/1 2/1 {Haste}. UNPARKED by R51: a
// `zone: 'bin'` trigger is dispatched to the card while it SITS IN A BIN,
// anchored on a detached stand-in entity (id -1) whose controller is the bin's
// owner — so "if I am in YOUR bin" is ctx.controller throughout.
//
// "You deal combat damage to an opponent" is read off the aggregated combat
// 'lifeLost' event, the batch-wide convention (Bloodwind Revenant): why ===
// 'combat' and the seat losing life is NOT the bin's owner. In 1v1 combat
// damage to a player can only come from the other side's columns, so "an
// opponent lost combat life" and "you dealt it" are the same statement — the
// bin has no column to check, and this is as close as a bin-resident card can
// get. ⚠ In a multiplayer game a third player's damage would also fire it.
//
// R51: one firing per zone however many copies sit in the bin — right here,
// since the printed text is a standing "if I am in your bin", not per-copy.
// The recall is unconditional ("recall me", no "may"), so it raises no
// decision; leaving a bin is not trashing (R40), so no trash event fires.
card('Cinder Scuttler', {
  abilities: [{
    type: 'triggered', events: ['lifeLost'], zone: 'bin',
    label: 'recall me from your bin (you dealt combat damage to an opponent)',
    when: (_g, self, ev) =>
      ev.data?.['why'] === 'combat' && ev.data?.['seat'] !== self.controller,
    effect: {
      run: (g, ctx) => {
        const bin = g.player(ctx.controller).bin;
        const i = bin.lastIndexOf('Cinder Scuttler');
        if (i === -1) {   // already recalled by an earlier firing this combat
          g.ev('info', 'Cinder Scuttler: it has already left the bin — nothing to recall.');
          return;
        }
        bin.splice(i, 1);
        g.player(ctx.controller).hand.push('Cinder Scuttler');
        g.ev('info', `Cinder Scuttler is recalled from ${g.pname(ctx.controller)}'s bin to their hand.`);
      },
    },
  }],
});

// "[Augment] If an allied source would deal noncombat damage, it deals that
// much damage plus 1 instead." — rr/2 2/1. PARKED (see header): damage
// replacement hook missing. The inert augmentText entry (events: []) keeps
// the card recognised as an augment; it donates nothing yet.
card('Conduit of Pain', {
  augmentText: [{
    type: 'triggered', events: [],   // PARKED — never fires
    label: 'allied noncombat damage +1 (not implemented)',
    effect: { run: () => { /* PARKED */ } },
  }],
});

// "Recall target spell in your bin. (Put it into your hand.)" — rr/4 2/2
// Arcane Elemental Spell Unit. The bin isn't a target zone in TargetSpec, so
// the pick is a mid-resolution choice by the controller (R6 model) — an
// approximation of targeting (opponents can't respond to the specific pick,
// only to the spell). No spell in the bin → the recall part does nothing and
// the body still spawns.
card('Delver of Mysteries', {
  spellEffect: {
    // R67: "target spell in your bin" is a DECLARED target, chosen as the
    // spell goes on the stack (R64's 'binCard' kind) — it used to be a
    // mid-resolution pick, so the Delver reached the stack aiming at nothing
    // and the opponent could not see what it was about to take back.
    targets: {
      what: 'binCard',
      prompt: 'Delver of Mysteries: recall target spell in your bin',
      restrict: (_g, t) => 'binCard' in t && isSpellCard(t.binCard.card),
    },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('binCard' in t) || t.binCard.index === -1) return;
      const bin = g.player(ctx.controller).bin;
      const [name] = bin.splice(t.binCard.index, 1);
      if (name !== undefined) {
        g.player(ctx.controller).hand.push(name);
        g.ev('info', `${name} is recalled to ${g.pname(ctx.controller)}'s hand.`);
      }
    },
  },
});

// "[Augment] Your units and spells gain {g}powerful. (Powerful sources deal
// double damage)." — rrr/4 0/5. Text-box [Augment].
//
// The UNITS half is a static — your units in its region (itself included) gain
// {Powerful}, which combat reads through ownAttrs/colAttrs so their columns'
// output doubles — and it is live in BOTH forms: mod-carried statics radiate
// from the HOST (E.anchored), so augmenting it donates the same aura. The
// augment-donated form used to be parked here on "statics run only while the
// holder is a unit in play"; that stopped being true, and the inert
// augmentText stand-in it needed is gone with it (`augmentable: true` is what
// keeps the card applicable).
//
// STILL PARKED (see header): the SPELLS half. "Your spells gain Powerful" has
// to attach an attribute to a spell EFFECT, and statics reach in-play UNITS
// only — dealEffectDamage reads the source CARD's printed attrs, with no seam
// for an in-play modifier. Same wall as Envoy of Lightning below.
card('Emberflame Enlightener', {
  augmentable: true,
  statics: [{
    affects: (g, self, t) => t.kind === 'unit' && t.controller === self.controller,
    attrs: ['Powerful'],
  }],
});

// "[Augment] Your spell effects with a single target are {g}Electric." —
// rr/2 3/2. PARKED (see header): even the statics layer can't reach this —
// statics project onto in-play UNITS only, while this must make spell
// EFFECTS Electric (dealEffectDamage reads the source CARD's printed attrs).
card('Envoy of Lightning', {
  augmentText: [{
    type: 'triggered', events: [],   // PARKED — never fires
    label: 'your single-target spell effects are Electric (not implemented)',
    effect: { run: () => { /* PARKED */ } },
  }],
});

// "When I activate, if you have at least [r][r][r], create a Shard. (It
// spawns dormant.)" — [r] Fire Resource, 2/0. PARKED (see header) on the
// resource-CARD model and the missing 'when I activate' event — NOT on the
// Shard, which E.createShard makes for real. Registered so the name resolves.
card('Fire Resource', {});

// "Negate all other effects. For each nontoken spell negated this way,
// create a Fireball 1." — rr/4 {Battle} Arcane Spell. At resolution Flame
// Shield is already off the stack, so "all other effects" = every remaining
// un-negated stack item (spells, spell units, spell tokens, triggered/
// activated abilities, viruses, ambushes — R22 counts them all as negatable
// effects). Only nontoken SPELLS (kind spell / spellUnit) pay out Fireballs.
card('Flame Shield', {
  spellEffect: {
    creates: ['Fireball'],
    run: (g, ctx) => {
      let fireballs = 0;
      // R68: negate() splices, so the sweep runs over a COPY — and the count
      // is taken off the copy's own entries, never off the live stack.
      for (const it of [...g.s.stack]) {
        g.negate(it.id);
        if (it.kind === 'spell' || it.kind === 'spellUnit') fireballs++;
      }
      if (!g.s.stack.length && !fireballs) {
        g.ev('info', 'Flame Shield: there is no other effect on the stack — nothing is negated.');
      }
      for (let i = 0; i < fireballs; i++) g.createSpellToken(ctx.controller, 'Fireball', 1, ctx.region);
    },
  },
});

// "After combat, [Switch1] Each player sacrifices a unit." — r/2 2/2.
// "Each player" = the seats present in the battle region (R12/R25), in
// presentSeats order (region owner first); each picks their own sacrifice
// (mid-resolution choices, R6 model). All choices are gathered before any
// destruction (plan-then-commit), then committed together.
const smofSacrifice: EffectDef = {
  run: (g, ctx) => {
    const picks: EntityId[] = [];
    for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
      const units = g.unitsOf(seat as Seat, ctx.region);
      if (!units.length) continue;
      if (inEndOfTurn(g)) {   // mandatory: deterministic auto-pick, no suspension
        g.ev('info', `General Smof: ${units[0]!.card} is auto-picked (end-of-turn resolution).`);
        picks.push(units[0]!.id);
        continue;
      }
      const c = ctx.choose(`sac:${seat}`, {
        kind: 'payOrDecline', seat: seat as Seat,
        prompt: 'General Smof: sacrifice a unit',
        options: units.map(u => ({ label: u.card, value: u.id })),
      });
      picks.push(c as EntityId);
    }
    if (!picks.length) g.ev('info', 'General Smof: nobody here has a unit to sacrifice.');
    for (const id of picks) {
      const u = g.entity(id);
      if (u) g.destroy(u, 'is sacrificed');
    }
  },
};
card('General Smof', {
  abilities: [{
    type: 'triggered', events: ['afterCombat'], bounded: true, graftCause: true,
    label: 'each player sacrifices a unit',
    effect: smofSacrifice,
  }],
  graftEffect: { bounded: true, effect: smofSacrifice },
});

// "When you sacrifice a unit, [Switch1] Each opponent sacrifices a nontoken
// unit." — rr/3 4/3. Sacrifice detection: 'died' events carry no verb in
// data, but destroy() renders it into the message — the when() reads it from
// the event snapshot (R1: event-time condition). "Each opponent" is
// region-scoped (R25); their picks are mid-resolution choices, gathered
// before committing. Note the recursion guard is the condition itself: the
// opponents' sacrifices have seat !== my controller, so Ghord can't loop.
const ghordSacrifice: EffectDef = {
  run: (g, ctx) => {
    const picks: EntityId[] = [];
    for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
      if (seat === ctx.controller) continue;
      const units = g.unitsOf(seat as Seat, ctx.region).filter(u => !u.token);
      if (!units.length) continue;
      if (inEndOfTurn(g)) {   // mandatory: deterministic auto-pick, no suspension
        g.ev('info', `Ghord: ${units[0]!.card} is auto-picked (end-of-turn resolution).`);
        picks.push(units[0]!.id);
        continue;
      }
      const c = ctx.choose(`sac:${seat}`, {
        kind: 'payOrDecline', seat: seat as Seat,
        prompt: 'Ghord: sacrifice a nontoken unit',
        options: units.map(u => ({ label: u.card, value: u.id })),
      });
      picks.push(c as EntityId);
    }
    if (!picks.length) g.ev('info', 'Ghord: no opponent here has a nontoken unit to sacrifice.');
    for (const id of picks) {
      const u = g.entity(id);
      if (u) g.destroy(u, 'is sacrificed');
    }
  },
};
card('Ghord', {
  abilities: [{
    type: 'triggered', events: ['died'], bounded: true, graftCause: true,
    label: 'each opponent sacrifices a nontoken unit',
    when: (g, self, ev) =>
      // R70: the death event carries the VERB; this used to match the log text
      ev.data?.seat === self.controller && ev.data?.verb === 'is sacrificed',
    effect: ghordSacrifice,
  }],
  graftEffect: { bounded: true, effect: ghordSacrifice },
});

// "Change the targets of target effect unless its controller pays [x]." —
// rr/X 2/1 {Battle} Temporal Cosmic Spell. X is chosen and paid AT CAST
// (R35) and stored on the item. R6 payment: the targeted item's controller
// pays x mid-resolution (offered only if affordable) or the Correction's
// controller re-picks every declared target from the current legal
// candidates. All choices happen before any mutation.
card('Gravitational Correction', {
  spellEffect: {
    targets: { what: 'stackEffect', prompt: 'Gravitational Correction: change the targets of target effect' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) {
        g.ev('info', 'Gravitational Correction: no effect is targeted — nothing is retargeted.');
        return;
      }
      const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
      if (!item) {
        g.ev('info', 'Gravitational Correction: the targeted effect has already left the stack.');
        return;
      }
      const x = ctx.x ?? 0;
      const payOptions = [{ label: 'Decline', value: false }];
      if (g.openMana(item.controller) >= x) payOptions.unshift({ label: `Pay [${x}]`, value: true });
      const pays = ctx.choose('pay', {
        kind: 'payOrDecline', seat: item.controller,
        prompt: `Pay [${x}] to keep ${item.label}'s targets?`, options: payOptions,
      });
      if (pays === true) {
        g.payMana(item.controller, x);
        g.ev('info', `${g.pname(item.controller)} pays [${x}] — ${item.label} keeps its targets.`);
        return;
      }
      // change the targets: the Correction's controller re-picks each one
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
      if (!picks.length) g.ev('info', `Gravitational Correction: ${item.label} has no target to change.`);
      for (const [pi, ti, ref] of picks) item.parts[pi]!.targets[ti] = ref;
    },
  },
});

// "At the end of turn, create a Fireball X, where X is one plus the number of
// spell tokens you control. [Augment] Your spell tokens stay through regroup."
// — rr/4 2/4. X is read at RESOLUTION from live state (R1). The trigger fires
// after regroup wiped the battle's tokens, so X counts tokens made since
// (e.g. during deployment) — exactly what "stay through regroup" would feed.
// The [Augment] half is PARKED (see header): inert entry only.
card('Harbinger of Immolation', {
  abilities: [{
    type: 'triggered', events: ['endOfTurn'],
    label: 'create a Fireball X (X = 1 + your spell tokens)',
    effect: {
      creates: ['Fireball'],
      run: (g, ctx) => {
        const x = 1 + g.tokensOf(ctx.controller).length;
        g.createSpellToken(ctx.controller, 'Fireball', x, ctx.region);
      },
    },
  }],
  augmentText: [{
    type: 'triggered', events: [],   // PARKED — never fires
    label: 'your spell tokens stay through regroup (not implemented)',
    effect: { run: () => { /* PARKED */ } },
  }],
});

// "[Augment] When I attack, create a 1/1 unit in my formation." — rr/1 1/1
// {Haste}. Text-box [Augment]: live on the card played normally and donated
// to a host. "In my formation": R75 — the controller of the effect chooses the
// slot at resolution (either end of the line, or the back slot of a one-unit
// column). It used to silently take my own column's back slot, or open one on
// the right.
card('Hooba-Lin', {
  augmentText: [{
    type: 'triggered', events: ['attacked'], self: true,
    label: 'create a 1/1 unit in my formation',
    effect: {
      creates: ['Unit Token'],
      run: (g, ctx) => {
        const u = g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [1, 1] });
        g.placeInFormation(u, ctx, { key: 'hoobaLinSlot', source: 'Hooba-Lin' });
      },
    },
  }],
});

// "[Switch1] /[Sacrifice a unit]: Draw a card." — r/1 {Battle} Occult Spell.
// The bracketed sacrifice is a CAST COST (R35): chosen and paid before the
// spell reaches the stack — no unit, no cast. Grafted, the rider's cost is
// paid (or declined) when the composite collects its cast-time decisions,
// exactly where graft targeting happens. Bounded graft ([Switch1], R9).
const immolateEffect: EffectDef = {
  castCost: { kind: 'sacrificeUnit' },
  run: (g, ctx) => {
    if (!ctx.costPaid?.sacrificed) return;   // rider declined / unpayable
    g.draw(ctx.controller, 1);
  },
};
card('Immolate', {
  spellEffect: immolateEffect,
  graftEffect: { bounded: true, effect: immolateEffect },
});

// "[Augment] [once] Sacrifice X units: Create X Fireball 1." — rrr/3 4/3.
// An ACTIVATED ability in the [Augment] text box: live when played normally
// (via: 'augment') and donated to hosts (via: { mod }) — apply.ts activates
// augmentText abilities directly. X = however many of your in-region units
// you pick (sequential choices, then 'Done'); the sacrifices happen at
// resolution (approximation of a true activation cost). [once] = bounded (R9).
card('Infernal Cultivator', {
  augmentText: [{
    type: 'activated', cost: {}, bounded: true,   // [once]
    label: 'Sacrifice X units: create X Fireball 1',
    effect: {
      creates: ['Fireball'],
      run: (g, ctx) => {
        const picks: EntityId[] = [];
        for (let i = 0; ; i++) {
          const units = g.unitsOf(ctx.controller, ctx.region).filter(u => !picks.includes(u.id));
          if (!units.length) break;
          const c = ctx.choose(`sac:${i}`, {
            kind: 'payOrDecline', seat: ctx.controller,
            prompt: `Infernal Cultivator: sacrifice units (${picks.length} picked so far)`,
            options: [...units.map(u => ({ label: u.card, value: u.id })), { label: 'Done', value: false }],
          });
          if (c === false) break;
          picks.push(c as EntityId);
        }
        if (!picks.length) g.ev('info', 'Infernal Cultivator: no unit is sacrificed — X = 0, no Fireballs.');
        for (const id of picks) {
          const u = g.entity(id);
          if (u) g.destroy(u, 'is sacrificed');
        }
        for (let i = 0; i < picks.length; i++) g.createSpellToken(ctx.controller, 'Fireball', 1, ctx.region);
      },
    },
  }],
});

// "Your wisps gain +2/+1 and do not sacrifice themselves after combat.
// [Augment] At the end of turn, create a wisp." — rr/2 2/1.
//
// ONE sentence, one static. The +2/+1 and the no-sacrifice clause are the same
// continuous effect on the same units, so they are the same StaticMod: main
// text, so unit-form only (correct — only the [Augment] line transfers to
// hosts), and region-scoped like every static (R12).
//
// R62 UNPARKED (playtest: "I have infernal wispweaver, but my wisps sacrificed
// themselves anyway!!!"). This was parked on "there is no way to suppress
// ANOTHER card's trigger". `StaticMod.suppressAbilities` is exactly that way:
// a continuous, radiating flag that switches the target's whole ability layer
// off, read as a veto (E.abilitiesSuppressed) on every path that would fire
// one. It is an EXACT implementation here rather than an approximation because
// the Wisp has exactly ONE ability — "After combat, sacrifice me" — so
// "switch its abilities off" and "it does not sacrifice itself after combat"
// name the same set of behaviour. Being continuous, it is also right in both
// directions: kill the weaver mid-combat and the Wisps sacrifice themselves
// again in the same instant, which is what a printed static means.
card('Infernal Wispweaver', {
  statics: [{
    affects: (g, self, t) =>
      t.kind === 'unit' && t.card === 'Wisp' && t.controller === self.controller,
    dp: 2, dt: 1,
    suppressAbilities: true,
  }],
  augmentText: [{
    type: 'triggered', events: ['endOfTurn'],
    label: 'create a Wisp (end of turn)',
    effect: {
      creates: ['Wisp'],
      run: (g, ctx) => { g.spawnUnit(ctx.controller, 'Wisp', ctx.region, { token: true }); },
    },
  }],
});
