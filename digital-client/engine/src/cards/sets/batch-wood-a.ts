/* batch-wood-a — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Wood cards scripted over the printed data in printed.json
 * (never hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (partial resolution / fizzles), R6 (mid-resolution choices via
 * ctx.choose), R9 (bounded budgets per card), R12/R25 (region scoping),
 * R28 (created UNITS arrive in their CONTROLLER'S home region unless the
 * text names a place — Hooba-Nan's "adjacent slots" is battle-local),
 * R31 (triggers between combat damage sub-steps resolve immediately).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - CONTROL CHANGES (Corrupting Blight / Hush Mush / Hexbane Shiitake):
 *    the engine has no control-change primitive, so the batch-local
 *    giveControl() flips entity.controller (and its mods' controller),
 *    removes the unit from any formation (a defector stops fighting), and
 *    logs. The region is left as-is: regroup (R11 step 1) reads controller
 *    and sends it to its new home.
 *  - EARNEST DEFENDER: spell-target 'targeted' events are logged but NOT
 *    dispatched to trigger listeners (engine: "none in pool yet"), so the
 *    trigger listens on 'spellPlayed' and reconstructs the cast's declared
 *    unit targets from the event-log tail (the 'targeted' entries logged by
 *    commitItem immediately before the spellPlayed event). One firing per
 *    enemy spell, even if it targets two allies. Spell tokens count as
 *    spells here (they target like spells; R26's "played" exclusion is
 *    about "you play" triggers).
 *  - FUNGAL GARDENER: a died event carries no token flag and the entity is
 *    already deleted at event time, so nontoken-ness is read from the died
 *    message ("token: erased" = token; Unstable erasure is still a nontoken
 *    death).
 *  - HUSH MUSH: a spell unit spawns AFTER its effect parts (afterParts), so
 *    "its controller gains control of me" is handed off through a per-region
 *    battleCounters ledger read by Hush Mush's own spawn trigger. Two Hush
 *    Mushes resolving in one region before either spawns would share the
 *    ledger (last write wins) — unreachable with one copy per deck pool.
 *  - BURGEON: "double" adds the current EFFECTIVE stat as an until-regroup
 *    bonus (stat layer 3). Under a layer-4 multiplier (Tough/Balanced) the
 *    result overshoots ((base+eff)*2 > eff*2). No pool combo hits this today.
 *  - HOOBA-NAN: edge slots front NEW columns only while no blocks are
 *    declared (b.blocks is keyed by column index, so inserting columns
 *    after blocks would shift the mapping); slots inside existing columns
 *    are always fillable. New columns are only fronted from the front row.
 *  - GLOWHAVEN ELDER / INSPIRATION: statics-only text-box [Augment]s —
 *    `augmentable: true` + statics anchored on the carrier (the host when
 *    donated; "your other units" excludes the anchor by id).
 *
 * PARKED: none — all 16 cards are scripted (some approximated, see above).
 */
import type { Entity, EntityId, Seat, TargetRef } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, effectByKey, type EffectDef } from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

const isEnt = (t: unknown): t is Entity =>
  !!t && typeof t === 'object' && 'id' in (t as object);

/** True while endTurn() is resolving end-of-turn triggers — a ctx.choose
 * suspension there strands the game (batch-fire-a precedent), so
 * choose-based effects reachable then must auto-pick deterministically. */
const inEndOfTurn = (g: E): boolean => g.s.phase === 'deploy' && g.s.deployPlayer === null;

/** create a 1/1 unit token for `seat` (R28: controller's home region unless
 * the caller passes a battle-local region) */
const makeOneOne = (g: E, seat: Seat, region?: number): Entity =>
  g.spawnUnit(seat, 'Unit Token', region ?? g.homeRegion(seat), { token: true, tokenStats: [1, 1] });

/** ⚠ header approximation: no engine control-change primitive. Flip the
 * controller on the unit and its mods, pull it out of any formation, log. */
const giveControl = (g: E, u: Entity, to: Seat): void => {
  if (u.controller === to || !g.entity(u.id)) return;
  const from = u.controller;
  u.controller = to;
  for (const id of u.mods) { const m = g.entity(id); if (m) m.controller = to; }
  const b = g.s.battle;
  if (b) {
    for (const col of [...b.columns, ...Object.values(b.blocks)]) {
      const i = col.indexOf(u.id);
      if (i !== -1) col.splice(i, 1);
    }
    const si = b.sentAttackers.indexOf(u.id);
    if (si !== -1) b.sentAttackers.splice(si, 1);
  }
  g.ev('info', `${g.pname(to)} gains control of ${u.card} (from ${g.pname(from)}).`);
};

// ────────────────────────────── the cards ──────────────────────────────

// "Create a Poison 1 for each of your units." — gg/4 Ancient Blight Spell
// (deploy timing). "Your units" is region-scoped (R12): the units you have
// where the spell resolves (your home region during deployment). Poison spell
// tokens appear at ctx.region — they are battle materiel, not units (R28).
card('All-Consuming Blight', {
  spellEffect: {
    run: (g, ctx) => {
      const mine = g.unitsOf(ctx.controller, ctx.region);
      for (const _ of mine) g.createSpellToken(ctx.controller, 'Poison', 1, ctx.region);
      g.ev('info', `All-Consuming Blight: ${mine.length} Poison 1 created.`);
    },
  },
});

// "Target player reveals their hand. You choose a card from it and put it
// into your hand." — ggg/4 {Battle} Fungus Spell. Target is a player (spec
// 'any'; a unit target is a no-op — the text only targets players). Bripp
// precedent: the reveal is an info event + seenHand snapshot; the pick is a
// mid-resolution choice (mandatory — the text has no "may"), auto when only
// one card. Targeting yourself just shows you your own hand (nothing moves).
card('Bioremediation', {
  spellEffect: {
    targets: { what: 'any', prompt: 'Bioremediation: target player reveals their hand — you take a card from it' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('player' in (t as object))) return;
      const who = (t as { player: Seat }).player;
      const hand = g.player(who).hand;
      g.ev('info', `Bioremediation reveals ${g.pname(who)}'s hand: ${hand.join(', ') || '(empty)'}.`);
      if (who !== ctx.controller) g.revealHandTo(ctx.controller, who);
      if (who === ctx.controller || !hand.length) return;
      const pick = hand.length === 1 ? 0 : ctx.choose('take', {
        kind: 'electricPath', seat: ctx.controller,
        prompt: `Bioremediation: choose a card from ${g.pname(who)}'s hand`,
        options: hand.map((name, i) => ({ label: name, value: i, card: name })),
      }) as number;
      const [name] = hand.splice(pick, 1);
      if (name === undefined) return;
      g.player(ctx.controller).hand.push(name);
      g.ev('info', `Bioremediation: ${g.pname(ctx.controller)} takes ${name}.`);
    },
  },
});

// "Negate target effect that targets an allied effect, player or unit." —
// gg/1 {Battle} Druid Spell. The restriction is enforced at resolution
// (Graxxlid/Minor Kraken precedent): a target that doesn't aim at anything
// allied (yours, in 1v1) is a no-op. "Allied" checks every declared target:
// units by controller, players by seat, stack items by their controller.
card('Boon of Protection', {
  spellEffect: {
    targets: { what: 'stackSpell', prompt: 'Boon of Protection: negate target effect that targets an allied effect, player or unit' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) return;
      const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
      if (!item || item.negated) return;
      const allied = item.parts.some(p => !p.spent && p.targets.some(tr => {
        if ('unit' in tr) return g.entity(tr.unit)?.controller === ctx.controller;
        if ('player' in tr) return tr.player === ctx.controller;
        const aimed = g.s.stack.find(i => i.id === tr.stack);
        return !!aimed && aimed.controller === ctx.controller;
      }));
      if (!allied) {
        g.ev('info', `Boon of Protection: ${item.label} does not target anything allied — no effect.`);
        return;
      }
      g.negate(item.id);
    },
  },
});

// "[Switch1] Double the power or defense of target unit until regroup." —
// g/2 {Battle} Druid Spell. The whole sentence is the bounded graftable
// effect ([Switch1], R9). The stat is a mid-resolution pick by the caster
// (R6; deterministic auto-pick of power during end-of-turn resolution).
// ⚠ header approximation: adds the current EFFECTIVE stat as a temp bonus.
const burgeonEffect: EffectDef = {
  targets: { what: 'unit', prompt: 'Burgeon: double the power or defense of target unit until regroup' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) return;
    const [p, d] = g.effStats(t);
    const mode = inEndOfTurn(g) ? 'power' : ctx.choose('stat', {
      kind: 'electricPath', seat: ctx.controller,
      prompt: `Burgeon: double ${t.card}'s power (${p} → ${p * 2}) or defense (${d} → ${d * 2})?`,
      options: [{ label: `Power (${p} → ${p * 2})`, value: 'power' }, { label: `Defense (${d} → ${d * 2})`, value: 'defense' }],
    });
    if (mode === 'defense') g.addTemp(t, 0, d);
    else g.addTemp(t, p, 0);
  },
};
card('Burgeon', {
  spellEffect: burgeonEffect,
  graftEffect: { bounded: true, effect: burgeonEffect },
});

// "[Augment] After combat, a player of your choice who doesn't control me
// gains control of me." — g/1 4/4 Blight Parasite {Virus} Unit. Text-box
// [Augment]: live when played normally (the 4/4-for-1 drawback — it defects
// after combat) and donated as a Virus on an enemy unit (their unit defects
// to you). "You" = the carrier's controller; in 1v1 the only legal choice is
// the opponent, so the pick is automatic (ctx.choose if ever multiplayer).
card('Corrupting Blight', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: "a player who doesn't control me gains control of me (after combat)",
    effect: {
      run: (g, ctx) => {
        const me = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!me) return;
        const candidates = g.s.players.map((_, s) => s as Seat).filter(s => s !== me.controller);
        if (!candidates.length) return;
        const to = candidates.length === 1 || inEndOfTurn(g) ? candidates[0]! : ctx.choose('who', {
          kind: 'electricPath', seat: ctx.controller,
          prompt: `Corrupting Blight: who gains control of ${me.card}?`,
          options: candidates.map(s => ({ label: g.pname(s), value: s })),
        }) as Seat;
        giveControl(g, me, to);
      },
    },
  }],
});

// "[Augment] Whenever an ally becomes the target of an enemy spell, create
// a 1/1 unit." — g/3 1/3 {Haste} Flower Guardian Unit. ⚠ header
// approximation: listens on 'spellPlayed' and reconstructs the cast's unit
// targets from the event-log tail (spell-target 'targeted' events are not
// dispatched). "Ally" = a unit my controller controls (me included).
// R28: the 1/1 arrives in the controller's home region.
card('Earnest Defender', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'],
    label: 'create a 1/1 unit (an ally was targeted by an enemy spell)',
    when: (g, self, ev) => {
      if (ev.data?.seat === self.controller) return false;     // enemy spells only
      // walk the log tail backwards: skip anything logged after this
      // spellPlayed (other listeners' 'triggered' entries), then collect the
      // consecutive 'targeted' entries commitItem logged just before it.
      const targets: EntityId[] = [];
      let sawSpell = false;
      for (let i = g.events.length - 1; i >= 0; i--) {
        const e2 = g.events[i]!;
        if (e2 === ev) { sawSpell = true; continue; }
        if (!sawSpell) continue;
        if (e2.type === 'targeted' && e2.data?.item !== undefined) {
          targets.push(e2.data.unit as EntityId);
          continue;
        }
        break;
      }
      return targets.some(id => g.entity(id)?.controller === self.controller);
    },
    effect: {
      run: (g, ctx) => { makeOneOne(g, ctx.controller); },
    },
  }],
});

// "Whenever a nontoken enemy dies, [Switch] Create a 1/1 unit." — gg/2 1/2
// Fungus Druid Unit. Died trigger, region-scoped by fireEvent; "enemy" =
// the dead unit's controller differs from mine (R1: checked at event time).
// ⚠ header approximation: nontoken-ness read from the died message. The
// creation is the unbounded graftable piece ([Switch]); R28: the 1/1
// arrives in the controller's home region.
const gardenerSprout: EffectDef = {
  run: (g, ctx) => { makeOneOne(g, ctx.controller); },
};
card('Fungal Gardener', {
  abilities: [{
    type: 'triggered', events: ['died'], graftCause: true,
    label: 'create a 1/1 unit (a nontoken enemy died)',
    when: (g, self, ev) =>
      ev.data?.seat !== undefined && ev.data.seat !== self.controller
        && !ev.msg.includes('token: erased'),
    effect: gardenerSprout,
  }],
  graftEffect: { bounded: false, effect: gardenerSprout },
});

// "[Augment] Your other units gain +1/+1." — gg/3 3/3 Mystic Tree {Virus}
// Unit. Statics-only text-box [Augment] (⚠ header): the aura is anchored on
// the carrier — the host when donated — and "other" excludes the anchor by
// id. Live when played normally (the Elder buffs everyone but itself);
// region-scoped by the statics layer (R12).
card('Glowhaven Elder', {
  augmentable: true,
  statics: [{
    affects: (g, self, t) =>
      t.kind === 'unit' && t.controller === self.controller && t.id !== self.id,
    dp: 1, dt: 1,
  }],
});

// "When I spawn, draw a card. [Augment] When I despawn, each other player
// draws two cards." — g/2 2/1 Alien Slime Parasite {Virus} Unit. The spawn
// draw is main text (never donated; a Virus attach is not a spawn). Despawn
// = ANY leave-play: 'died' + 'despawned', self-filtered (Bloated Manablub
// precedent — a donated copy fires for the HOST leaving play, the mod scan
// runs before mods are erased). "Each other player" is region-scoped (R25):
// the present seats of the event region except the carrier's controller.
card('Growing Plague', {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: 'draw a card',
    effect: { run: (g, ctx) => g.draw(ctx.controller, 1) },
  }],
  augmentText: [{
    type: 'triggered', events: ['died', 'despawned'], self: true,
    label: 'each other player draws two cards (I despawned)',
    effect: {
      run: (g, ctx) => {
        for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
          if (seat !== ctx.controller) g.draw(seat as Seat, 2);
        }
      },
    },
  }],
});

// "[Augment][once] Whenever another player plays a spell, you may exchange
// control of me for that spell. If you do, you may choose new targets for
// that spell." — g/4 3/3 Arcane Fungus Unit. [once] = bounded (R9). The
// trigger stacks above the spell and resolves first; the spell is found by
// card+controller on the stack (batch-hybrids-fwe precedent). All choices
// are gathered before mutating (plan-then-commit, R6): the exchange
// (pay-or-decline), then a new-target pick per declared target (keep is
// always offered). Committing flips item.controller to me and hands the
// carrier to the spell's owner (⚠ header giveControl). Spell tokens are not
// "played" (R26) and don't trigger this.
card('Hexbane Shiitake', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'], bounded: true,   // [once]
    label: 'exchange control of me for that spell (you may)',
    when: (g, self, ev) => ev.data?.seat !== self.controller && ev.data?.token !== true,
    effect: {
      run: (g, ctx) => {
        const me = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!me) return;
        const cardName = ctx.event?.data?.card as string | undefined;
        const seat = ctx.event?.data?.seat as Seat | undefined;
        if (cardName === undefined || seat === undefined) return;
        const spellKinds = new Set(['spell', 'spellUnit']);
        const item = [...g.s.stack].reverse().find(i =>
          i.card === cardName && i.controller === seat && !i.negated && spellKinds.has(i.kind));
        if (!item) { g.ev('info', `Hexbane Shiitake: ${cardName} is no longer on the stack — no exchange.`); return; }
        // plan: every choice before any mutation (the part replays on suspension)
        const pays = inEndOfTurn(g) ? false : ctx.choose('swap', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Hexbane Shiitake: exchange control of ${me.card} for ${item.label}?`,
          options: [{ label: `Exchange (${g.pname(seat)} gets ${me.card})`, value: true }, { label: 'Decline', value: false }],
        });
        if (pays !== true) return;
        const retargets: { pi: number; ti: number; ref: TargetRef }[] = [];
        item.parts.forEach((p, pi) => {
          if (p.spent) return;
          const spec = effectByKey(p.effectKey).targets;
          if (!spec) return;
          p.targets.forEach((cur, ti) => {
            const cands = g.targetCandidates(spec, item.region, item.id, ctx.controller);
            if (!cands.length) return;
            const pick = ctx.choose(`rt:${pi}:${ti}`, {
              kind: 'electricPath', seat: ctx.controller,
              prompt: `Hexbane Shiitake: new target for ${item.label}?`,
              options: [
                { label: `Keep (${g.targetLabel(cur)})`, value: { keep: true } },
                ...cands.map(c => ({ label: g.targetLabel(c), value: c })),
              ],
            });
            if (pick && typeof pick === 'object' && !('keep' in (pick as object))) {
              retargets.push({ pi, ti, ref: pick as TargetRef });
            }
          });
        });
        // commit
        item.controller = ctx.controller;
        for (const r of retargets) item.parts[r.pi]!.targets[r.ti] = r.ref;
        g.ev('info', `Hexbane Shiitake: ${g.pname(ctx.controller)} gains control of ${item.label}.`);
        giveControl(g, me, seat);
      },
    },
  }],
});

// "[Augment] When I attack, if I am still in formation, create a 1/1 unit
// in all my empty adjacent slots." — ggg/4 5/4 Hooba Banana Unit. Text-box
// [Augment]; live when played normally. "Still in formation" is checked at
// RESOLUTION (R27-style). Slots are battle-local (overrides R28): the
// vertical slot in my column, the same-row slots of adjacent columns, and —
// while no blocks are declared and I'm in the front row — fresh columns at
// the formation edges (⚠ header). The tokens join the attack.
card('Hooba-Nan', {
  augmentText: [{
    type: 'triggered', events: ['attacked'], self: true,
    label: 'create a 1/1 unit in all my empty adjacent slots',
    effect: {
      run: (g, ctx) => {
        const me = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        const b = g.s.battle;
        if (!me || !b) return;
        let ci = -1, ri = -1;
        for (let i = 0; i < b.columns.length; i++) {
          const r = b.columns[i]!.indexOf(me.id);
          if (r !== -1) { ci = i; ri = r; break; }
        }
        if (ci === -1) { g.ev('info', `${me.card}: no longer in formation — no units.`); return; }
        const canExtend = ri === 0 && Object.keys(b.blocks).length === 0;
        let n = 0;
        // vertical slot in my column
        if (b.columns[ci]!.length < 2) { b.columns[ci]!.push(makeOneOne(g, ctx.controller, ctx.region).id); n++; }
        // same-row slot of the right neighbor (or a fresh edge column)
        if (ci + 1 < b.columns.length) {
          if (b.columns[ci + 1]!.length <= ri) { b.columns[ci + 1]!.push(makeOneOne(g, ctx.controller, ctx.region).id); n++; }
        } else if (canExtend) { b.columns.push([makeOneOne(g, ctx.controller, ctx.region).id]); n++; }
        // same-row slot of the left neighbor (or a fresh edge column) — last,
        // an unshift renumbers columns (safe: blocks are empty by the guard)
        if (ci - 1 >= 0) {
          if (b.columns[ci - 1]!.length <= ri) { b.columns[ci - 1]!.push(makeOneOne(g, ctx.controller, ctx.region).id); n++; }
        } else if (canExtend) { b.columns.unshift([makeOneOne(g, ctx.controller, ctx.region).id]); n++; }
        g.ev('info', `${me.card}: ${n} 1/1 unit(s) fill the empty adjacent slots.`);
      },
    },
  }],
});

// "Negate target effect. Its controller gains control of me." — gg/2 3/1
// {Battle} Arcane Fungus Spell Unit. The spell part negates; the handoff is
// deferred through a battleCounters ledger to my own spawn trigger, because
// the spell unit spawns only after the effect parts run (⚠ header). A gone
// target fizzles the whole spell — the unit never spawns and is binned (R5).
const HUSH_KEY = 'hushMushGiveTo';
card('Hush Mush', {
  spellEffect: {
    targets: { what: 'stackSpell', prompt: 'Hush Mush: negate target effect (its controller gains control of me)' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) return;
      const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
      if (!item) return;
      g.negate(item.id);
      // handoff for my spawn trigger (see header): seat+1; 0 = nothing owed
      const c = g.s.battleCounters[ctx.region] ?? (g.s.battleCounters[ctx.region] = {});
      c[HUSH_KEY] = item.controller + 1;
    },
  },
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: "the negated effect's controller gains control of me",
    when: (g, self) => (g.s.battleCounters[self.region]?.[HUSH_KEY] ?? 0) > 0,
    effect: {
      run: (g, ctx) => {
        const me = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!me) return;
        const c = g.s.battleCounters[ctx.region];
        const v = c?.[HUSH_KEY] ?? 0;
        if (!c || v <= 0) return;
        c[HUSH_KEY] = 0;
        giveControl(g, me, (v - 1) as Seat);
      },
    },
  }],
});

// "[Augment] Your units adjacent to me gain +2/+2." — gg/2 3/2 Mystic
// Flower {Virus} Unit. Statics-only text-box [Augment] (⚠ header):
// adjacency exists only inside a formation (adjacentInFormation — vertical
// neighbor + same-row horizontal neighbors), so the aura is live only while
// the carrier fights. Anchored on the host when donated.
card('Inspiration', {
  augmentable: true,
  statics: [{
    affects: (g, self, t) =>
      t.kind === 'unit' && t.controller === self.controller
        && g.adjacentInFormation(self.id).some(u => u.id === t.id),
    dp: 2, dt: 2,
  }],
});

// "Target unit gains +0/+1 until regroup. Draw a card." — g/1 {Battle}
// Mystic Druid Spell. Single part: if the target is gone at resolution the
// part fizzles and nothing happens, draw included (R5 — the clauses are one
// part). Otherwise: temp toughness + a draw.
card('Invigorate', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Invigorate: target unit gains +0/+1 until regroup (then draw a card)' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (isEnt(t) && g.entity(t.id)) g.addTemp(t, 0, 1);
      g.draw(ctx.controller, 1);
    },
  },
});

// "[Augment][once] When I am dealt damage, create that many 1/1 units." —
// gg/3 0/4 Alien Insect Plant Unit. [once] = bounded (R9). Both damage
// channels fire 'damage' with the amount in data.n; "that many" is read from
// the event snapshot (R1, Lithoghul precedent). R28: the 1/1s arrive in the
// controller's home region. Poisonous damage becomes counters and never
// fires 'damage' (earth-c precedent, noted).
card('Jollyglop', {
  augmentText: [{
    type: 'triggered', events: ['damage'], self: true, bounded: true,   // [once]
    label: 'create that many 1/1 units (I was dealt damage)',
    effect: {
      run: (g, ctx) => {
        const n = (ctx.event?.data?.n as number | undefined) ?? 0;
        for (let i = 0; i < n; i++) makeOneOne(g, ctx.controller);
      },
    },
  }],
});

// "When I attack in a formation of four or more units, [Switch1] Draw a
// card." — g/3 3/3 Plant Luminary Unit. Condition at event time (R1):
// the attacking formation (b.columns, all mine — I just attacked) holds 4+
// living units. The draw is the bounded graftable piece ([Switch1], R9).
const leaderDraw: EffectDef = {
  run: (g, ctx) => g.draw(ctx.controller, 1),
};
card('Luminary Leader', {
  abilities: [{
    type: 'triggered', events: ['attacked'], self: true, bounded: true, graftCause: true,
    label: 'draw a card (attacking in a formation of 4+ units)',
    when: (g) => {
      const b = g.s.battle;
      return !!b && b.columns.flat().filter(id => g.entity(id)).length >= 4;
    },
    effect: leaderDraw,
  }],
  graftEffect: { bounded: true, effect: leaderDraw },
});
