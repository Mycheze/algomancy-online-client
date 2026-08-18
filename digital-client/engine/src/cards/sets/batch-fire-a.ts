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
 *  - Cinder Scuttler (trigger half): "if I am in your bin, recall me" needs
 *    bin-resident trigger listeners — fireEvent only scans in-play units.
 *    The card works fully as a {Haste} 2/1 body.
 *  - Conduit of Pain: "an allied source would deal noncombat damage ... plus 1
 *    instead" is a damage REPLACEMENT; dealEffectDamage has no replacement
 *    hooks. Registered with an inert augmentText entry so the card is still
 *    recognised as an augment (Astralith precedent).
 *  - Emberflame Enlightener: "your units and spells gain Powerful" is a global
 *    attr aura; the engine only reads attrs from a card's own printed data +
 *    its OWN augment mods (no aura layer). Inert augmentText entry only.
 *  - Envoy of Lightning: "your single-target spell effects are Electric" —
 *    same missing aura/replacement layer (dealEffectDamage reads the source
 *    CARD's printed attrs). Inert augmentText entry only.
 *  - Fire Resource: resource cards aren't modelled — resources are plain
 *    ResourceState (no entities), doActivateResource doesn't fireEvent, and
 *    there is no 'Shard' resource kind. Registered as printed (which leaks it
 *    into DECK_LIST as a phantom 2/0 that dies on arrival — flagged for the
 *    maintainer; every element's Resource card shares this).
 *  - Gravitational Correction (X half): there is no cast-time "choose and pay
 *    X" primitive (canPayCard treats X as 0), so item.x is undefined → 0 when
 *    played from hand. The pay-or-retarget machinery is fully implemented and
 *    tested with x set white-box.
 *  - Harbinger of Immolation (augment half): "your spell tokens stay through
 *    regroup" needs a regroup-replacement hook (startRegroup erases all spell
 *    tokens unconditionally). The end-of-turn Fireball trigger is fully done.
 *  - Infernal Wispweaver (static half): "your wisps gain +2/+1 and do not
 *    sacrifice themselves after combat" needs a stat aura layer plus a way to
 *    suppress another card's trigger. The [Augment] end-of-turn wisp is done.
 */
import type { EntityId, Seat, TargetRef } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, effectByKey, type EffectDef } from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** True while endTurn() is resolving end-of-turn triggers (phase is still
 * 'deploy' but nobody is deploying). A ctx.choose suspension in that window
 * STRANDS the game — the engine cannot resume endTurn's tail after a decide —
 * so choose-based effects here (reachable via grafts on end-of-turn graft
 * causes) must fall back to deterministic auto-picks instead of suspending. */
const inEndOfTurn = (g: E): boolean => g.s.phase === 'deploy' && g.s.deployPlayer === null;

/** "You may sacrifice a unit. If you do, draw a card." — mid-resolution
 * choice (R6 model): the controller picks one of their units in the event
 * region (R12) or declines. Plan-then-commit: the choose happens before any
 * mutation, so replay suspension stays deterministic. */
const sacrificeToDraw = (source: string): EffectDef => ({
  run: (g, ctx) => {
    const units = g.unitsOf(ctx.controller, ctx.region);
    if (!units.length) return;
    if (inEndOfTurn(g)) return;   // "may": auto-decline (no suspensions here)
    const choice = ctx.choose('sac', {
      kind: 'payOrDecline', seat: ctx.controller,
      prompt: `${source}: sacrifice a unit to draw a card?`,
      options: [...units.map(u => ({ label: u.card, value: u.id })), { label: 'Decline', value: false }],
    });
    if (choice === false) return;
    const u = g.entity(choice as EntityId);
    if (u) { g.destroy(u, 'is sacrificed'); g.draw(ctx.controller, 1); }
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
// this battle." — r/1 0/1 Anima Unit. Text-box [Augment]. APPROXIMATED as a
// trigger: each nontoken spell the controller plays during battle gives all
// their units in that region (R12) +1/+0 until regroup — cumulatively equal
// to the printed count. Deviations from a true static aura: units arriving
// after a spell miss its increment, spells played before the Spark arrived
// don't count, and the bonus outlives the Spark if it leaves play.
const sparkSurge: EffectDef = {
  run: (g, ctx) => {
    for (const u of g.unitsOf(ctx.controller, ctx.region)) g.addTemp(u, 1, 0);
  },
};
card('Animated Spark', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'],
    label: 'your units gain +1/+0 (per nontoken spell played this battle)',
    when: (g, self, ev) =>
      g.s.phase === 'battle' &&
      ev.data?.seat === self.controller &&
      !ev.data?.token,
    effect: sparkSurge,
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
// me. (Put me into your hand.)" — r/1 2/1 {Haste}. PARKED (see header): the
// recall trigger needs bin listeners. Plays fully as a haste 2/1.
card('Cinder Scuttler', {});

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
    run: (g, ctx) => {
      const bin = g.player(ctx.controller).bin;
      const spells = bin
        .map((n, i) => ({ n, i }))
        .filter(({ n }) => { const k = g.card(n).kind; return k === 'spell' || k === 'spellUnit'; });
      if (!spells.length) return;
      const idx = ctx.choose('recall', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: 'Delver of Mysteries: recall target spell in your bin',
        options: spells.map(s => ({ label: s.n, value: s.i })),
      });
      const name = bin[idx as number];
      if (name !== undefined) {
        bin.splice(idx as number, 1);
        g.player(ctx.controller).hand.push(name);
        g.ev('info', `${name} is recalled to ${g.pname(ctx.controller)}'s hand.`);
      }
    },
  },
});

// "[Augment] Your units and spells gain {g}powerful. (Powerful sources deal
// double damage)." — rrr/4 0/5. PARKED (see header): global attr aura layer
// missing. Inert augmentText keeps it recognised as an augment.
card('Emberflame Enlightener', {
  augmentText: [{
    type: 'triggered', events: [],   // PARKED — never fires
    label: 'your units and spells gain Powerful (not implemented)',
    effect: { run: () => { /* PARKED */ } },
  }],
});

// "[Augment] Your spell effects with a single target are {g}Electric." —
// rr/2 3/2. PARKED (see header): same missing aura/replacement layer.
card('Envoy of Lightning', {
  augmentText: [{
    type: 'triggered', events: [],   // PARKED — never fires
    label: 'your single-target spell effects are Electric (not implemented)',
    effect: { run: () => { /* PARKED */ } },
  }],
});

// "When I activate, if you have at least [r][r][r], create a Shard. (It
// spawns dormant.)" — [r] Fire Resource, 2/0. PARKED (see header): the
// resource-card model doesn't exist. Registered so the name resolves.
card('Fire Resource', {});

// "Negate all other effects. For each nontoken spell negated this way,
// create a Fireball 1." — rr/4 {Battle} Arcane Spell. At resolution Flame
// Shield is already off the stack, so "all other effects" = every remaining
// un-negated stack item (spells, spell units, spell tokens, triggered/
// activated abilities, viruses, ambushes — R22 counts them all as negatable
// effects). Only nontoken SPELLS (kind spell / spellUnit) pay out Fireballs.
card('Flame Shield', {
  spellEffect: {
    run: (g, ctx) => {
      let fireballs = 0;
      for (const it of g.s.stack) {
        if (it.negated) continue;
        g.negate(it.id);
        if (it.kind === 'spell' || it.kind === 'spellUnit') fireballs++;
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
      ev.data?.seat === self.controller && ev.msg.includes('is sacrificed'),
    effect: ghordSacrifice,
  }],
  graftEffect: { bounded: true, effect: ghordSacrifice },
});

// "Change the targets of target effect unless its controller pays [x]." —
// rr/X 2/1 {Battle} Temporal Cosmic Spell. R6 payment: the targeted item's
// controller pays x mid-resolution (offered only if affordable) or the
// Correction's controller re-picks every declared target from the current
// legal candidates. All choices happen before any mutation. PARKED half (see
// header): no cast-time X primitive, so x is 0 unless set white-box.
card('Gravitational Correction', {
  spellEffect: {
    targets: { what: 'stackSpell', prompt: 'Gravitational Correction: change the targets of target effect' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) return;
      const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
      if (!item || item.negated) return;
      const x = ctx.x ?? 0;
      const payOptions = [{ label: 'Decline', value: false }];
      if (g.openMana(item.controller) >= x) payOptions.unshift({ label: `Pay [${x}]`, value: true });
      const pays = ctx.choose('pay', {
        kind: 'payOrDecline', seat: item.controller,
        prompt: `Pay [${x}] to keep ${item.label}'s targets?`, options: payOptions,
      });
      if (pays === true) { g.payMana(item.controller, x); return; }
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
// to a host. "In my formation": the token joins my column's free back slot,
// or opens a new attacking column beside it.
card('Hooba-Lin', {
  augmentText: [{
    type: 'triggered', events: ['attacked'], self: true,
    label: 'create a 1/1 unit in my formation',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self) return;
        const u = g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [1, 1] });
        const b = g.s.battle;
        if (!b) return;
        const col = g.columnOf(self.id);
        if (col && b.columns.includes(col)) {
          if (col.length < 2) col.push(u.id);
          else b.columns.push([u.id]);
        }
      },
    },
  }],
});

// "[Switch1] /[Sacrifice a unit]: Draw a card." — r/1 {Battle} Occult Spell.
// The bracketed cost is paid at resolution as a mid-resolution choice (an
// approximation: strictly a cost would be paid before responses). Shares the
// sacrifice-to-draw machinery with Bloodwind Revenant; bounded graft (R9).
const immolateEffect = sacrificeToDraw('Immolate');
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
// [Augment] At the end of turn, create a wisp." — rr/2 2/1. The static first
// line is PARKED (see header). The [Augment] end-of-turn wisp is implemented:
// live normally and donated to hosts.
card('Infernal Wispweaver', {
  augmentText: [{
    type: 'triggered', events: ['endOfTurn'],
    label: 'create a Wisp (end of turn)',
    effect: {
      run: (g, ctx) => { g.spawnUnit(ctx.controller, 'Wisp', ctx.region, { token: true }); },
    },
  }],
});
