/* batch-hybrids-wm-a — wood/metal-involved dual-element (hybrid) batch,
 * scripted over the printed data in printed.json (never hand-copied).
 * Printed text quoted in comments for review.
 *
 * Owned by one card-scripting agent; see sets/index.ts for ordering rules.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fizzle vs partial), R6 (mid-resolution payments/choices via ctx.choose),
 * R9 (bounded [Switch1]/[once] budgets per card), R12/R25 ("each player/
 * opponent" and "your units" read the region's present seats / unitsOf(region)),
 * R115 (created UNITS spawn where their SOURCE is — ctx.region — exactly as
 * spell tokens always did), R31 (damage-sub-step triggers resolve
 * immediately).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - SPELL COPY (Earthbound Replicator, Maelstrom Charger): no copy machinery
 *    exists, so a "copy" re-runs the copied card's spellEffect in place —
 *    it never touches the stack (no responses to the copy), and a copy only
 *    happens while the original item is still ON the stack (found by id / by
 *    the Origon bottom-most-match pattern) — a deploy-phase spell that
 *    already resolved is not copyable (info line instead). "May choose new
 *    targets" IS supported now (it used to be silently skipped, which was the
 *    engine deciding for the player): before the copy runs, the COPYING
 *    player — Replicator's "they", Charger's "you"; both are the copy's
 *    controller — is offered a mid-resolution choice (R6) to keep the
 *    original targets or re-collect the copy's targets fresh against the
 *    copied spell's own TargetSpec, R64 legality judged AT the re-collection
 *    (chooseCopyTargets). Declining keeps the pre-existing behavior exactly:
 *    the original cast's still-legal targets / the carrier ride, and a
 *    target that has died still fizzles the copy. With no legal candidate at
 *    all the choice is genuinely empty, so no question is asked (not an
 *    auto-pick) and the originals ride with an info line.
 *  - Earthbound Replicator: written when spell-cast 'targeted' events were
 *    logged but never dispatched, so the trigger listens to 'spellPlayed'
 *    instead. Playtest 2026-08-19 FIXED that dispatch (R53) — this card could
 *    now listen to 'targeted' directly, which would be exact rather than
 *    approximate. Left as-is for now: the current path is correct, just
 *    roundabout. The event carries no targets, so it queues
 *    on EVERY nonunit spell in the region and checks "targeting me" at
 *    resolution against the item's collected targets on the stack (no-op
 *    info line when it doesn't target me). "Nonunit" = kind spell/spellToken
 *    (spellUnits and ambushes excluded).
 *  - Ember of Life: FIXED (playtest 2026-08-18) — 'damage' events now carry
 *    the effect's controller and spell-effect damage to PLAYERS emits a
 *    damage event too (engine dealEffectDamage), so "one of YOUR spell
 *    effects deals damage" is exact: my spells only, face hits included.
 *    Combat damage never counts (its event has no source). The 1/1s spawn
 *    in the CARRIER's region (R33, absorbed by R115: everything created
 *    arrives at ctx.region).
 *  - Scrapyard Custodian: 'countersChanged' carries no actor, so "when YOU
 *    put counters on an ally" is read as "counters (either sign) were put on
 *    a unit you control, by anyone". Robots spawning with counters do NOT
 *    fire it (spawn counters are on before the spawn event — engine note).
 *  - Soulforger: "nontoken" is a FACT ON THE DEATH EVENT (R70's `token`,
 *    stamped by E.leftPlayFacts precisely because the entity is erased before
 *    the event fires). This entry used to say the event had no token flag and
 *    the discriminator was the rendered death message; the card reads
 *    ev.data.token.
 *  - Malevolent Machinations: R64 — the "/[Sacrifice X units]" bracket is a
 *    real cast cost (paid before the item reaches the stack, and the units
 *    sacrificed ARE X) and the "up to X target effects" are declared targets.
 *    "Effects" is R60's superset: any un-negated stack item that is an effect,
 *    triggered abilities included.
 *  - Hearthwood Ancient: UN-PARKED (R49). This used to say the sacrifice was
 *    "an activation cost paid at resolution … with no other unit the ability
 *    resolves without effect". `AbilityCost.sacrificeOther` is the real slot:
 *    it gates the activation and is paid in the cast window, before priority.
 *  - Reconfigure: the moved unit leaves play SILENTLY (no died/despawned
 *    event — it is moved, not removed); its mod entities move along with
 *    budgets intact. R64: "the first target must have [Augment]" is a
 *    TARGETING restriction on slot 0 — only augments are offered — and the
 *    resolution check stays for a redirect that lands a non-augment there.
 *  - "your units" amounts (Colossal Construction's greatest defense) and
 *    "each player/opponent" are region-scoped at resolution (R12/R25/R27).
 *
 * PARKED (needs engine machinery that does not exist yet):
 *  - Rook: UN-PARKED (R95). The permission layer it was waiting on exists now
 *    and is `CardBehavior.modPermissions` — CostMod's sibling in shape,
 *    OR-folded rather than summed because a permission is granted or it is
 *    not. `augmentable: true` replaces the inert augmentText stand-in. ⚠ Two
 *    things are open and listed in R95: whether "as if they were [Virus]" also
 *    unlocks R79 STACK hosts (it does, as shipped), and whether the card grants
 *    {Virus} itself or only the timing permission (only the permission, as
 *    shipped). GRAFT is deliberately not covered — the printed word is
 *    "augment", and doGraft is deployment-only.
 *  - The Silent: UN-PARKED (R59), and has been for a while — this entry was
 *    left behind. "Spells cost each player [two] more … per spell their team
 *    played this battle" IS a continuous COST modifier, and CostMod is the
 *    layer; the card is `augmentable: true` + a live `costMods` entry further
 *    down this file, with no inert augmentText anywhere near it.
 */
import type { CardName, Entity, EntityId, Seat, TargetRef } from '../../types.ts';
import type { E } from '../../engine.ts';
import {
  card, getCard, isAugment, specForSlot,
  type EffectCtx, type EffectDef, type ResolvedTarget,
} from '../dsl.ts';
import { selfOf, isEnt, pickUnit, perSeatRows } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** the stack-item kinds that count as a "nonunit spell" (plain "spell"
 * includes spell tokens — the batch-hybrids-fwe wording precedent; spellUnit
 * and ambush are unit plays and excluded) */
const NONUNIT_SPELL_KINDS = new Set(['spell', 'spellToken']);

/**
 * "…may choose NEW targets for the copy" (Earthbound Replicator, Maelstrom
 * Charger) — the printed choice, asked before runSpellCopy runs the copy.
 *
 * The copying player (`copier` — the copy's controller on both cards) is
 * offered a mid-resolution decision (R6): keep the original cast's targets,
 * or re-collect the copy's targets FRESH against the copied spell's own
 * TargetSpec — slot by slot through E.targetCandidates, so R64 restrictions
 * (and R58 per-slot specs) are judged NOW, at the re-collection, not at the
 * original cast. Declining returns `original` untouched, so the pre-existing
 * behavior — still-legal originals ride, a dead original fizzles the copy —
 * is exactly preserved. If the FIRST slot has no legal candidate at all, the
 * "choose new targets" half would be an empty menu, so no question is asked
 * (a genuinely empty choice is not a choice, and silence here would be an
 * auto-pick): the originals ride, with an info line saying why.
 *
 * Plan-then-commit: nothing here mutates — every pick is a ctx.choose, so a
 * suspension replays the part cleanly (R85) and the picks survive the JSON
 * round trip on the suspension.
 */
function chooseCopyTargets(
  g: E, ctx: EffectCtx, cardName: CardName, copier: Seat,
  x: number | undefined, original: ResolvedTarget[],
): ResolvedTarget[] {
  const spec = getCard(cardName).spellEffect?.targets;
  if (!spec) return original;   // a targetless spell has nothing to re-aim
  // slot arithmetic mirrors E.collectPartTargets: count ('X' = the copy's
  // inherited X) plus R83's fixed extraSlots; min gates the "no more" option
  const counted = spec.count === 'X' ? (x ?? 0) : (spec.count ?? 1);
  const max = counted + (spec.extraSlots ?? 0);
  const min = Math.min(spec.min ?? 1, max);
  if (max <= 0) return original;
  const candsFor = (n: number, chosen: ResolvedTarget[], taken: Set<string>): TargetRef[] =>
    g.targetCandidates(specForSlot(spec, n), ctx.region, undefined, copier,
      undefined, x, chosen, null)
      .filter(c => !taken.has(JSON.stringify(c)));
  if (!candsFor(0, [], new Set()).length) {
    g.ev('info', `${ctx.sourceName}: no legal new target for the copy of ${cardName} — the original targets stand.`);
    return original;
  }
  const fresh = ctx.choose('newTargets', {
    kind: 'payOrDecline', seat: copier,
    prompt: `${ctx.sourceName}: choose new targets for the copy of ${cardName}?`,
    options: [
      { label: 'Choose new targets', value: true },
      { label: `Keep the original target${original.length === 1 ? '' : 's'}`, value: false },
    ],
  }) as boolean;
  if (!fresh) return original;
  const picked: ResolvedTarget[] = [];
  const taken = new Set<string>();
  for (let n = 0; n < max; n++) {
    const cands = candsFor(n, picked, taken);
    if (!cands.length) break;   // a later slot with nothing legal ends the collection
    const options: { label: string; value: unknown }[] =
      cands.map(c => ({ label: g.targetLabel(c), value: c }));
    if (picked.length >= min) options.push({ label: 'No more targets', value: { doneTargets: true } });
    const v = ctx.choose(`newTarget${n}`, {
      kind: 'electricPath', seat: copier,
      prompt: `${ctx.sourceName}: new target for the copy of ${cardName}`
        + (max > 1 ? ` (target ${n + 1} of up to ${max})` : ''),
      options,
    });
    if (!!v && typeof v === 'object' && 'doneTargets' in v) break;
    const ref = v as TargetRef;
    taken.add(JSON.stringify(ref));
    const r = g.resolveTargetRef(ref);
    if (r) picked.push(r);
  }
  return picked;
}

/** ⚠ SPELL COPY approximation (see the batch header): run the copied card's
 * spellEffect in place — off the stack, with the given targets, under the
 * copying player. Nested chooses are namespaced so they can't collide with
 * the caller's own keys. */
function runSpellCopy(
  g: E, ctx: EffectCtx, cardName: CardName, controller: Seat,
  x: number | undefined, targets: ResolvedTarget[],
  costPaid?: EffectCtx['costPaid'], mode?: unknown,
): void {
  const def = getCard(cardName).spellEffect;
  if (!def) { g.ev('info', `${ctx.sourceName}: ${cardName} has no spell effect to copy.`); return; }
  if (def.targets && !targets.length) {
    g.ev('info', `${ctx.sourceName}: the copy of ${cardName} has no target — no effect.`);
    return;
  }
  g.ev('info', `${ctx.sourceName}: ${g.pname(controller)} copies ${cardName}.`);
  def.run(g, {
    controller, sourceName: cardName, sourceId: undefined, region: ctx.region,
    // a COPY is not cast: its cast cost is not paid again — it inherits the
    // original's payment receipt (R35), like it inherits the original's X
    // R57: a copy inherits the ORIGINAL's declared modal half, the same way it
    // inherits its X and its cost receipt. The original said which half it was
    // in its own cast window, in public; the copy is that spell again, not a
    // second chance to pick.
    targets, x, costPaid, mode, event: null,
    // A COPY of a spell is not a card, so a copy of "Erase me" has nothing to
    // erase — and it must not reach for the ORIGINAL's item, which is going to
    // the bin or the erased pile on its own terms.
    eraseSelf: () => {},
    choose: (key, dec) => ctx.choose(`copy:${key}`, dec),
  });
}

// ─────────────────────── EARTH / METAL (em/me) ────────────────────────

// "[Switch1] Create a Robot X, where X is the greatest defense among your
// units." — em/3 2/4 Primordial Technology Spell. X is live at resolution
// (R27): the greatest effStats defense among the controller's units in the
// resolving region (R12). Robot X = the 0/0 Robot token with X +1/+1
// counters (the water-metal batch precedent); a created UNIT spawns where its
// SOURCE is — ctx.region (R115). No unit → X = 0 → no Robot.
const buildRobot: EffectDef = {
  creates: ['Robot'],
  run: (g, ctx) => {
    const x = g.unitsOf(ctx.controller, ctx.region)
      .reduce((m, u) => Math.max(m, g.effStats(u)[1]), 0);
    if (x <= 0) { g.ev('info', 'Colossal Construction: no unit to measure — no Robot.'); return; }
    g.spawnUnit(ctx.controller, 'Robot', ctx.region, { token: true, counters: x });
  },
};
card('Colossal Construction', {
  spellEffect: buildRobot,
  graftEffect: { bounded: true, effect: buildRobot },
  // UI preview (#5): the Robot's size if it resolved right now
  xPreview: (g, seat, region) =>
    g.unitsOf(seat, region).reduce((m, u) => Math.max(m, g.effStats(u)[1]), 0),
});

// "Augment target unit and all of its mods onto another target unit. (The
// first target must have [Augment] to be able to be augmented.)" — em/4 1/2
// {Battle} Primordial Technology Spell. Two targets collected at cast (the
// multi-target TargetSpec, which picks them distinct): the FIRST pick moves
// onto the SECOND. "Another" is re-checked at RESOLUTION (Minor Kraken
// precedent) — distinctness at cast is NOT an invariant, because Enigmatic
// Warder ("change a target of target effect to me") can redirect a target
// afterwards and can do it twice, collapsing both onto one unit. Resolving
// that augmented the unit onto ITSELF: the entity was deleted and then made a
// mod pointing at its own dead id, an orphan the fuzz caught at seed 1132.
// R64: the printed parenthesis — "the first target must have [Augment] to be
// able to be augmented" — is a TARGETING RESTRICTION, so the first slot now
// offers only cards that have one. It was offering the whole board and doing
// nothing on most of it ("I was allowed to choose illegal targets for
// Reconfigure"). The resolution check stays: a redirect can put a
// non-augment card in that slot after the cast (R56/R58).
// It leaves play silently (⚠ header — moved, not despawned), becomes an
// augment mod on the host via attachMod (modApplied fires), and its existing
// mod entities move along, budgets intact.
card('Reconfigure', {
  spellEffect: {
    targets: {
      what: 'unit', count: 2, min: 2,
      prompt: 'Reconfigure: first pick the unit to move, then the unit to augment it onto',
      slotPrompts: [
        'Reconfigure: which unit moves? (it must have [Augment])',
        'Reconfigure: augment it onto which unit?',
      ],
      slotRestricts: [(_g, t) => 'card' in t && isAugment(t.card), null],
    },
    run: (g, ctx) => {
      if (ctx.targets.length < 2) { g.ev('info', 'Reconfigure: a target is gone — no effect.'); return; }
      const [a, b] = [ctx.targets[0], ctx.targets[1]];
      if (!isEnt(a) || !isEnt(b)) return;
      // "onto ANOTHER target unit" — a redirect can have collapsed the two
      // onto one unit since the cast, and augmenting a unit onto itself would
      // delete the entity and leave its own mod orphaned.
      if (a.id === b.id) {
        g.ev('info', `Reconfigure: both targets are ${a.card} — it cannot augment onto itself, no effect.`);
        return;
      }
      if (!isAugment(a.card)) {
        g.ev('info', `Reconfigure: ${a.card} has no [Augment] — no effect.`);
        return;
      }
      const movedMods = a.mods.map(id => g.entity(id)).filter((m): m is Entity => !!m);
      // the moved unit leaves play WITHOUT dying/despawning (⚠ header)
      delete g.s.entities[a.id];
      // formation cleanup (mirror of the engine's private removeFromFormation)
      const bt = g.s.battle;
      if (bt) {
        for (const col of [...bt.columns, ...Object.values(bt.blocks)]) {
          const i = col.indexOf(a.id);
          if (i !== -1) col.splice(i, 1);
        }
        const si = bt.sentAttackers.indexOf(a.id);
        if (si !== -1) bt.sentAttackers.splice(si, 1);
      }
      g.attachMod(b, a.card, a.owner, 'augment');
      for (const m of movedMods) {
        m.modOf = b.id;
        m.region = b.region;
        m.controller = b.controller;
        b.mods.push(m.id);
      }
      if (movedMods.length) g.ev('info', `Reconfigure: ${movedMods.length} mod(s) move along with ${a.card}.`);
    },
  },
});

// "[Augment] You may augment cards from hand and bin during battle as if
// they were [Virus]." — me/4 4/4 Polyform Crab Unit. Live as of round 17
// (R95); this text is the whole card, and until now it was a vanilla 4/4.
//
// A `modPermissions` mod — CostMod's sibling in shape (same ctx, same
// anchored() radiation from a unit in play or an augment mod reading from its
// HOST, same R12 region scoping) but folded as an OR rather than summed,
// because a permission is granted or it is not and two Rooks are not twice as
// permissive.
//
// The designer names this card as exactly this permission, and names it as
// something that must be OPT-IN. rules-questions:
//   chatt_nooga: "Does Steward of the Plain let me apply a virus from my
//                 discard during combat?"
//   calebgannon: "That's a very interesting question" / "It shouldn't" /
//                "But I can see why it might be interpreted that way"
//   chatt_nooga: "Okay but hear me out: What if it did? Would that be broken?"
//   calebgannon: "Not really I don't think. If it said 'as if it was in your
//                 hand' then it could work" → `$card rook` → "Does do that" /
//                "Steward and rook are good friends"
//
// `augmentable: true` is what keeps the card applicable now that the inert
// augmentText stand-in is gone: isAugment reads
// `augmentAttrs || augmentText || augmentable`, and Rook prints neither of
// the first two. The [Augment] half then costs nothing extra — `self` is the
// ANCHOR, so augmented onto a host the permission belongs to the HOST's
// controller, which is what "[Augment]" means everywhere else in the engine.
//
// `ctx.from` is checked HERE rather than being hardcoded in apply.ts, because
// the printed zone list is this card's, not the rules': Rook says "hand and
// bin", so Rook is what refuses the cache.
card('Rook', {
  augmentable: true,
  modPermissions: [{
    augmentInBattle: (g, self, ctx) =>
      ctx.seat === self.controller && (ctx.from === 'hand' || ctx.from === 'bin'),
  }],
});

// "When you put one or more counters on an ally, [Switch1] Draw a card." —
// me/3 3/3 Robot Druid Unit. 'countersChanged' trigger; the event carries no
// actor (⚠ header: counters put on your ally by anyone count as "you put"),
// either sign counts ("counters"), the amount doesn't matter ("one or
// more"). Bounded graft cause + bounded graft ([Switch1], R9). Region-scoped
// automatically (fireEvent reads the counted unit's region).
const custodianDraw: EffectDef = { run: (g, ctx) => g.draw(ctx.controller, 1) };
card('Scrapyard Custodian', {
  abilities: [{
    type: 'triggered', events: ['countersChanged'], bounded: true, graftCause: true,
    label: 'draw a card (counters were put on an ally)',
    when: (g, self, ev) => {
      const uid = ev.data?.unit as EntityId | undefined;
      const u = uid !== undefined ? g.entity(uid) : undefined;
      return !!u && u.controller === self.controller;
    },
    effect: custodianDraw,
  }],
  graftEffect: { bounded: true, effect: custodianDraw },
});

// "[Augment] Spells cost each player [two] more to play for each spell their
// team has previously played in this battle." — em/3 3/4 Cosmic Arcane Unit.
// LIVE as of the R59 cost-modifier layer (it was parked for want of one).
//
//  - "each player … their team": 1v1, so a team is one seat. The count is the
//    payer's OWN spells, which is why the tax is asymmetric — the player who
//    has been slinging spells pays, their opponent does not.
//  - "previously played in this battle" is exactly the spellsPlayed:<seat>
//    battle counter, bumped by commitItem for nontoken spells and reset with
//    battleCounters each battle phase. It is bumped when the spell commits, so
//    at the moment THIS spell's cost is read the counter still holds only the
//    earlier ones — "previously" is right without an off-by-one correction.
//  - "Spells … to play": spell card kinds played from hand, never a mod
//    application (R37) and never a spell token cast from play.
//  - No "during battle" clause, but the counter only exists during a battle,
//    so a deployment cast is naturally untaxed.
card('The Silent', {
  augmentable: true,
  costMods: [{
    delta: (g, self, ctx) => {
      if (ctx.purpose !== 'play') return 0;
      if (ctx.card.kind !== 'spell' && ctx.card.kind !== 'spellUnit') return 0;
      return 2 * g.battleCounter(self.region, `spellsPlayed:${ctx.seat}`);
    },
  }],
  // #85: the tax is ASYMMETRIC — each player pays 2 per spell THEY have
  // already played this battle — so it genuinely differs by player, and
  // neither number is on the board. The rows are the surcharge itself, not the
  // raw counter, because the surcharge is what a player is deciding about.
  xPreviewRows: (g, seat, region) =>
    perSeatRows(g, seat, s2 => 2 * g.battleCounter(region, `spellsPlayed:${s2}`)),
});

// ─────────────────────── EARTH / WOOD (eg/ge) ─────────────────────────

// "[Augment] Whenever another nontoken ally spawns, create a Crystal 1." —
// eg/2 2/3 Plant Primordial Unit. Text-box [Augment], live when played
// normally. 'spawned' fires with the entity already in play, so token-ness
// and controller are read live at event time (R1). "Another" excludes the
// carrier itself (when donated: the host). Spell tokens appear where the
// effect resolves (R115).
card('Aether Channeler', {
  augmentText: [{
    type: 'triggered', events: ['spawned'],
    label: 'create a Crystal 1 (another nontoken ally spawned)',
    when: (g, self, ev) => {
      const uid = ev.data?.unit as EntityId | undefined;
      const u = uid !== undefined ? g.entity(uid) : undefined;
      return !!u && u.id !== self.id && u.controller === self.controller && !u.token;
    },
    effect: { creates: ['Crystal'], run: (g, ctx) => { g.createSpellToken(ctx.controller, 'Crystal', 1, ctx.region); } },
  }],
});

// "[Switch1] Create a Crystal 1 and a Poison 1." — eg/1 0/7 Arcane Blight
// Crystal Spell. Both spell tokens appear where the effect resolves (R115).
// Bounded graft ([Switch1], R9).
const alchemyTokens: EffectDef = {
  creates: ['Crystal', 'Poison'],
  run: (g, ctx) => {
    g.createSpellToken(ctx.controller, 'Crystal', 1, ctx.region);
    g.createSpellToken(ctx.controller, 'Poison', 1, ctx.region);
  },
};
card('Corroded Alchemy', {
  spellEffect: alchemyTokens,
  graftEffect: { bounded: true, effect: alchemyTokens },
});

// "[Augment] Whenever I am dealt damage, put that many -1/-1 counters on
// target unit." — eg/4 0/7 {Haste} Primordial Blight Unit. Text-box
// [Augment]. Fires on the 'damage' event (self; combat damage included);
// "that many" is the event snapshot's amount (R1 — the event IS the amount's
// definition, the Mirrorback Ambusher precedent). Targeted trigger.
card('Decay Distributor', {
  augmentText: [{
    type: 'triggered', events: ['damage'], self: true,
    label: 'put that many -1/-1 counters on target unit',
    effect: {
      targets: { what: 'unit', prompt: 'Decay Distributor: put that many -1/-1 counters on target unit' },
      run: (g, ctx) => {
        const n = (ctx.event?.data?.n as number | undefined) ?? 0;
        const t = ctx.targets[0];
        if (isEnt(t) && n > 0) g.addCounters(t, -n);
      },
    },
  }],
});

// "[Augment] Whenever a player plays a nonunit spell targeting me, they copy
// it and may choose new targets for the copy." — ge/2 1/3 Primordial
// Elemental Unit. Text-box [Augment]. ⚠ SPELL COPY approximation (header):
// a 'spellPlayed' trigger (the cast-time targeted events never reach
// listeners); "targeting me" is checked at RESOLUTION against the un-negated
// item's collected targets on the stack (the Origon bottom-most-match
// pattern — my trigger sits above the spell, so the copy resolves first).
// The copy is controlled by the spell's player ("THEY copy it"), and that
// player "may choose new targets for the copy": chooseCopyTargets asks them
// to keep the carrier as the copy's target or re-aim it fresh (R64 legality
// at the re-collection). Declining keeps the old behavior exactly — the copy
// runs against the carrier itself.
card('Earthbound Replicator', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'],
    label: 'the player copies their nonunit spell targeting me',
    when: (g, self, ev) => {
      const name = ev.data?.card;
      if (typeof name !== 'string') return false;
      try { return NONUNIT_SPELL_KINDS.has(getCard(name).kind); } catch { return false; }
    },
    effect: {
      run: (g, ctx) => {
        const name = ctx.event?.data?.card as CardName | undefined;
        const seat = ctx.event?.data?.seat as Seat | undefined;
        const self = selfOf(g, ctx);
        // R84 surfaced this one: the Alluring trigger changed what the
        // conformance drive reaches, and this guard aborted in silence.
        // ("A guard that aborts an effect must LOG why" — test/65.)
        if (name === undefined || seat === undefined || !self) {
          g.ev('info', 'Earthbound Replicator: the spell or my body is gone — no copy.');
          return;
        }
        const it = g.s.stack.find(i =>
          i.card === name && i.controller === seat && NONUNIT_SPELL_KINDS.has(i.kind));
        const targetsMe = !!it &&
          it.parts.some(p => p.targets.some(t => 'unit' in t && t.unit === self.id));
        if (!it || !targetsMe) {
          g.ev('info', `Earthbound Replicator: ${name} does not target me (or already left the stack) — no copy.`);
          return;
        }
        // "may choose new targets for the copy" — THEY (the spell's player)
        // choose; declining keeps the carrier as the copy's target, as ever
        const targets = chooseCopyTargets(g, ctx, name, seat, it.x, [self]);
        runSpellCopy(g, ctx, name, seat, it.x, targets, it.parts[0]?.costPaid, it.parts[0]?.mode);
      },
    },
  }],
});

// "After combat, [Switch1] Create a [Poison or Crystal] 2." — eg/3 2/3 Plant
// Crystal Unit. afterCombat trigger (no source unit — the Unfinished
// Creation precedent; region-scoped by the event). R57 — the printed
// "[Poison or Crystal]" is declared in the CAST window (`EffectDef.modes`), so
// the trigger sits on the stack already saying which token it will make and
// the opponent responds to a fully declared effect. It used to be a
// mid-resolution ctx.choose with a silent auto-pick of Crystal during
// end-of-turn resolution; that auto-pick is gone, because E.finishTurnEnd
// resumes out of settle() and the cast window already suspends there.
// Spell token appears where the effect resolves. Bounded cause + bounded graft
// ([Switch1], R9) — `modes` is per EFFECT, so a graft composite asks per part.
const conjureTwo: EffectDef = {
  creates: ['Poison', 'Crystal'],
  modes: {
    key: 'tok',
    prompt: () => 'Spirit of Nature: create a Poison 2 or a Crystal 2?',
    options: () => [
      { label: 'Poison 2', value: 'Poison' },
      { label: 'Crystal 2', value: 'Crystal' },
    ],
  },
  run: (g, ctx) => {
    const kind = ctx.mode;   // R57: declared at cast
    g.createSpellToken(ctx.controller, kind === 'Poison' ? 'Poison' : 'Crystal', 2, ctx.region);
  },
};
card('Spirit of Nature', {
  abilities: [{
    type: 'triggered', events: ['afterCombat'], bounded: true, graftCause: true,
    label: 'create a Poison 2 or a Crystal 2 (after combat)',
    effect: conjureTwo,
  }],
  graftEffect: { bounded: true, effect: conjureTwo },
});

// ─────────────────────── FIRE / METAL (rm/mmr/rrm) ────────────────────

// "As you play a nonunit spell, you may sacrifice me. If you do, copy that
// spell and you may choose new targets for the copy." — rm/3 4/2 Elemental
// Maelstrom Unit. ⚠ SPELL COPY approximation (header): a 'spellPlayed'
// trigger (your spell, kind spell/spellToken); at resolution the original is
// found on the stack (the Origon bottom-most-match pattern) — my trigger
// sits above it, so the copy resolves first. The sacrifice is a
// mid-resolution pay-or-decline (R6) and is offered wherever this resolves,
// the end-of-turn window included (R85). "YOU may choose new targets for the
// copy": chooseCopyTargets asks the controller — keep the original cast's
// still-legal targets, or re-aim the copy fresh (R64 legality at the
// re-collection). All choices come before the sacrifice commits
// (plan-then-commit), so the Charger is still standing while it is asked.
card('Maelstrom Charger', {
  abilities: [{
    type: 'triggered', events: ['spellPlayed'],
    label: 'you may sacrifice me to copy your nonunit spell',
    when: (g, self, ev) => {
      if (ev.data?.seat !== self.controller) return false;
      const name = ev.data?.card;
      if (typeof name !== 'string') return false;
      try { return NONUNIT_SPELL_KINDS.has(getCard(name).kind); } catch { return false; }
    },
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) { g.ev('info', 'Maelstrom Charger: the carrier is gone — no copy.'); return; }
        const name = ctx.event?.data?.card as CardName | undefined;
        const seat = ctx.event?.data?.seat as Seat | undefined;
        if (name === undefined || seat === undefined) return;
        const it = g.s.stack.find(i =>
          i.card === name && i.controller === seat && NONUNIT_SPELL_KINDS.has(i.kind));
        if (!it) { g.ev('info', `Maelstrom Charger: ${name} already left the stack — no copy.`); return; }
        const pay = ctx.choose('sac', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Maelstrom Charger: sacrifice me to copy ${name}?`,
          options: [
            { label: `Sacrifice — copy ${name}`, value: true },
            { label: 'Decline', value: false },
          ],
        });
        if (!pay) {
          g.ev('info', `Maelstrom Charger: the sacrifice is declined — ${name} is not copied.`);
          return;
        }
        // the original cast's still-legal targets — the "keep" half of the
        // printed choice below
        const original: ResolvedTarget[] = [];
        for (const part of it.parts) {
          for (const t of part.targets) {
            const r = g.resolveTargetRef(t);
            if (r) original.push(r);
          }
        }
        // "you may choose new targets for the copy" — asked BEFORE the
        // sacrifice commits (plan-then-commit: every choose precedes the
        // mutation, so a suspension replays cleanly). Targets are resolved at
        // choice time, exactly as the keep-path always resolved them.
        const targets = chooseCopyTargets(g, ctx, name, seat, it.x, original);
        g.destroy(self, 'is sacrificed');
        runSpellCopy(g, ctx, name, seat, it.x, targets, it.parts[0]?.costPaid, it.parts[0]?.mode);
      },
    },
  }],
});

// "/[Sacrifice X units]: Negate up to X target effects." — rrm/2 5/3
// {Battle} Occult Technology Spell. R64, un-parked: the bracket is an
// ADDITIONAL COST, paid at cast — the units are sacrificed before the spell is
// on the stack, X is fixed by how many, and the up-to-X effects it negates are
// declared targets that everyone can see it aiming at. It used to do all of
// that mid-resolution: the opponent answered a negate-spell of unknown size
// aimed at nothing in particular, and could respond by adding an effect it was
// then free to point at.
card('Malevolent Machinations', {
  spellEffect: {
    castCost: { kind: 'sacrificeUnits', n: 'X' },
    xZeroWarning: 'X = 0 negates nothing — "up to X effects" is up to none',   // R74
    targets: {
      what: 'stackEffect', count: 'X', min: 0,
      prompt: 'Malevolent Machinations: negate up to X target effects',
    },
    run: (g, ctx) => {
      if (!ctx.targets.length) { g.ev('info', 'Malevolent Machinations: nothing to negate.'); return; }
      for (const t of ctx.targets) if ('stack' in t) g.negate(t.stack);
    },
  },
});

// "[Augment] Whenever one of your units dies, each opponent sacrifices a
// unit." — mmr/5 5/6 Robot Insect Horror Unit. Text-box [Augment]. "One of
// your units" = same controller (tokens count, the carrier itself counts —
// a dying unit sees its own death). "Each opponent" is region-scoped (R25);
// each picks their own unit, plan-then-commit.
card('Malicious Hardware', {
  augmentText: [{
    type: 'triggered', events: ['died'],
    label: 'each opponent sacrifices a unit (one of your units died)',
    when: (g, self, ev) => ev.data?.seat === self.controller,
    effect: {
      run: (g, ctx) => {
        const picks: EntityId[] = [];
        for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
          if (seat === ctx.controller) continue;
          const pool = g.unitsOf(seat as Seat, ctx.region).filter(u => !picks.includes(u.id));
          const id = pickUnit(ctx, `sac:${seat}`, seat as Seat, pool,
            'Malicious Hardware: sacrifice a unit');
          if (id !== null) picks.push(id);
        }
        for (const id of picks) {
          const u = g.entity(id);
          if (u) g.destroy(u, 'is sacrificed');
        }
      },
    },
  }],
});

// "Each player sacrifices two units. If four or more units were sacrificed
// this way, repeat this." — rm/4 5/3 {Battle} Bedlam Maelstrom Spell.
// "Each player" = the region's present seats (R25); each picks two of their
// units (as many as able). Per round: all picks are planned, then committed;
// 4+ actual sacrifices repeat the round (fresh pools — replay after a
// suspension is deterministic given the stored answers, so the round-wise
// interleaving of chooses and commits is sound).
card('Maw of Damnation', {
  spellEffect: {
    run: (g, ctx) => {
      for (let round = 0; round < 20; round++) {
        const picks: EntityId[] = [];
        for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
          for (let k = 0; k < 2; k++) {
            const pool = g.unitsOf(seat as Seat, ctx.region).filter(u => !picks.includes(u.id));
            const id = pickUnit(ctx, `sac:${round}:${seat}:${k}`, seat as Seat, pool,
              `Maw of Damnation: sacrifice two units (pick ${k + 1} of 2)`);
            if (id === null) break;
            picks.push(id);
          }
        }
        for (const id of picks) {
          const u = g.entity(id);
          if (u) g.destroy(u, 'is sacrificed');
        }
        if (picks.length < 4) break;
        g.ev('info', 'Maw of Damnation: four or more units were sacrificed — it repeats.');
      }
    },
  },
});

// "[Augment] Whenever one of your nontoken units dies, create a Fireball 1."
// — rrm/2 2/2 Demon Robot Unit. Text-box [Augment]. Nontoken-ness is read off
// the death event's token flag (R70 — the entity is gone before the event
// fires, so the fact rides the event). Spell token at the resolving region
// (R115).
card('Soulforger', {
  augmentText: [{
    type: 'triggered', events: ['died'],
    label: 'create a Fireball 1 (one of your nontoken units died)',
    when: (g, self, ev) =>
      ev.data?.seat === self.controller && ev.data?.token !== true,
    effect: { creates: ['Fireball'], run: (g, ctx) => { g.createSpellToken(ctx.controller, 'Fireball', 1, ctx.region); } },
  }],
});

// ─────────────────────── FIRE / WOOD (rg) ─────────────────────────────

// "[Augment][once] When one of your spell effects deals damage, create that
// many 1/1 units." — rg/4 2/2 Plant Elemental Unit. Text-box [Augment].
// Damage events now carry the effect's CONTROLLER (dealEffectDamage), so
// "one of YOUR spell effects" = the event's controller is my controller —
// an opponent's spell never fires me. Spell-effect damage to a PLAYER also
// emits a damage event (face hits count; "deals damage" is unqualified);
// combat damage never counts (no source on the event). Created UNITS spawn in
// the CARRIER's region (R33, now just R115: ctx.region, which for a carrier
// trigger IS where the carrier is).
//
// R80: "that many" is what the SPELL EFFECT dealt, not what one victim took.
// Playtest VEAV: "I only made 2 units from my Channel Through, but it dealt 6
// damage to my allies and 6 to my opponent's units, so I should have made 12
// units." Effect damage is one batch (E.dealEffectDamageAll), and every event
// in it carries the batch `total` — so this reads `total`, and [once] means
// the whole spell pays out once. Sourced the other way too, Caleb 2025-03-20
// on Meteor Shower's several Rockfalls: "each copy of Rockfall is a separate
// source, so Ember of Life triggers separately for each copy rather than
// combining them into one bigger trigger." One source, one number.
card('Ember of Life', {
  augmentText: [{
    type: 'triggered', events: ['damage'], bounded: true,   // [once]
    label: 'create that many 1/1 units (one of your spell effects dealt damage)',
    when: (g, self, ev) => {
      if (ev.data?.controller !== self.controller) return false;   // "one of YOUR spell effects"
      const src = ev.data?.source;
      if (typeof src !== 'string') return false;   // combat damage has no source
      try {
        const k = getCard(src).kind;
        return k === 'spell' || k === 'spellUnit' || k === 'spellToken';
      } catch { return false; }
    },
    effect: {
      creates: ['Unit Token'],
      run: (g, ctx) => {
        const d = ctx.event?.data;
        // `total` is the whole batch; `n` is this victim's share, and is the
        // fallback for an event minted before R80 (a replayed saved game)
        const n = (d?.total as number | undefined) ?? (d?.n as number | undefined) ?? 0;
        if (n <= 0) { g.ev('info', 'Ember of Life: no damage was dealt — no units.'); return; }
        for (let i = 0; i < n; i++) {
          g.spawnUnit(ctx.controller, 'Unit Token', ctx.region,
            { token: true, tokenStats: [1, 1] });
        }
      },
    },
  }],
});

// "[Augment] Sacrifice another unit: Your units gain +1/+1 until regroup."
// — rg/4 0/4 Ancient Tree Structure Unit. An ACTIVATED ability in the
// [Augment] text box (the Slag Spewer precedent): live when played normally
// (via: 'augment') and donated to hosts (via: { mod }). The sacrifice is
// paid at resolution (⚠ header); "another" excludes the activating unit
// (the carrier / the host when donated). The buff lands after the sacrifice
// (the sacrificed unit never benefits), on the controller's units in the
// region, until regroup (addTemp).
card('Hearthwood Ancient', {
  augmentText: [{
    // R49 UN-PARKED: a real activation cost (gates the activation, paid in the
    // cast window) rather than a resolution-time pick
    type: 'activated', cost: { sacrificeOther: 1 },
    label: 'sacrifice another unit: your units gain +1/+1 until regroup',
    effect: {
      run: (g, ctx) => {
        // the sacrifice is already paid; "your units" is the survivors (R12)
        const mine = g.unitsOf(ctx.controller, ctx.region);
        if (!mine.length) {
          g.ev('info', 'Hearthwood Ancient: you control no unit here — nothing gains +1/+1.');
          return;
        }
        for (const u of mine) g.addTemp(u, 1, 1);
      },
    },
  }],
});
