/* Light & Dark expansion — batch light-a (18 cards).
 *
 * Behaviour only; printed data comes from printed.json (never hand-copied).
 * Spec for the expansion's new mechanics: docs/08-light-and-dark.md,
 * rulings R38-R48 in docs/digital-rules.md.
 *
 * Cards in this batch:
 *   Arbiter of Armistice
 *   Blob of the Dark Order
 *   Colony of the Interworld
 *   Divine Foresight
 *   Flesh Tithe
 *   Glararr
 *   Greed Angel
 *   Hooba-God
 *   Keeper of Tithes
 *   Lifebound Seer
 *   Penance
 *   Prismatic Observer
 *   Retribution Thing
 *   Shard Sprite
 *   Stalwart Sentinel
 *   The Everywhere
 *   Triskaidekaphage
 *   Vroot
 *
 * Mechanics touched: cache (R41), debt (R39), glimpse (R45), prophecy
 * (R42-R44). Graft markers: [Switch] = unbounded graft, [Switch1] = bounded
 * (once per turn, R9). R37: applying a mod is NOT playing a card.
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - LIFE AS A COST (R49). Blob of the Dark Order and Glararr now declare a
 *    real ACTIVATION cost ({ life: n }): it gates the activation and is paid
 *    before the ability reaches the stack. Flesh Tithe's "[Pay X life]" is a
 *    real CAST COST too — `{ kind: 'payLife', n: 'X' }`, paid a point at a time
 *    at cast, and the amount paid IS the spell's X. (This entry used to say it
 *    "stays at resolution … CastCost carries a FIXED amount"; R64 added the
 *    variable form.) It obeys the same R49 ruling either way: each point is
 *    re-checked, so a life cost you cannot survive is never payable.
 *  - "MY COLUMN DEALS COMBAT DAMAGE" (Vroot) is read off the combat events the
 *    way Flowstone Arcanite / Amphivore read it: a 'damage' event with no
 *    `source` tag against the directly opposing column, or the aggregated
 *    combat 'lifeLost' with my column connecting. A column that both kills
 *    blockers and pierces through fires once per damage instance.
 *
 * UNPARKED by the R49/R50 engine wave:
 *  - Stalwart Sentinel reads the play events' new `data.from` zone instead of
 *    scanning this apply() call's log (which was unsound — a cast that
 *    suspends on targets fires 'spellPlayed' in a LATER apply() call).
 *  - Retribution Thing counts life lost PLUS life gained, off the new
 *    `lifeGained:<seat>` battle ledger.
 *  - Keeper of Tithes hears the new 'endOfHaste' event.
 *
 * PARKED (needs primitives that do not exist; each registers crash-free):
 *  - The Everywhere: needs a "name a card" player action. That is the ONLY
 *    thing left — this entry used to add "AND the ability-suppression layer
 *    already parked for Monke / Suppression Field / Transmogrifant", and R62
 *    shipped that layer; all three of those cards use it today.
 */
import type { EngineEvent, Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, eraseFromPlay } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/**
 * Pay `n` life as a COST at resolution (header note). Returns false — having
 * paid nothing — when the payer cannot afford it, which for life means "the
 * payment would not leave them alive": loseLife() ends the game at 0, and no
 * card in this batch is meant to be a suicide button.
 */
function payLife(g: E, seat: Seat, n: number, why: string): boolean {
  if (n <= 0) return true;
  if (g.player(seat).life <= n) {
    g.ev('info', `${g.pname(seat)} cannot pay ${n} life for ${why} — the cost is unpaid.`);
    return false;
  }
  g.loseLife(seat, n, `${why} (cost)`);
  return true;
}

/** R25: "each opponent" is the seats PRESENT IN THE EFFECT'S REGION, not every
 * seat at the table. Vroot only ever fires on combat damage, so its region
 * always holds both players in 1v1 — but the two readings are not the same
 * clause, and every other batch in the expansion uses this one. */
const opponentsOf = (g: E, region: number, seat: Seat): Seat[] =>
  g.s.regions[region]!.presentSeats.filter(s => s !== seat);

/**
 * "My column deals combat damage" (header approximation), evaluated at EVENT
 * time (R1) on the two channels combat damage can take:
 *  - 'damage' with no `source` tag (combat, never effect damage) against a
 *    unit in the column DIRECTLY OPPOSING mine;
 *  - the aggregated combat 'lifeLost' where my column connects to the victim
 *    (attacking unblocked, or blocked/blocking with Piercing).
 * Mirrors Flowstone Arcanite so the two cards read the same combat the same
 * way. Returns false outside battle and for a 0-power column.
 */
function myColumnDealtCombatDamage(g: E, self: Entity, ev: { type: string; data?: Record<string, unknown> }): boolean {
  const b = g.s.battle;
  if (!b) return false;
  const col = g.columnOf(self.id);
  if (!col) return false;
  const alive = col.filter(id => g.entity(id));
  const power = alive.reduce((s, id) => s + Math.max(0, g.effStats(g.entity(id)!)[0]), 0);
  if (power <= 0) return false;
  const ci = b.columns.indexOf(col);
  if (ev.type === 'damage') {
    if (ev.data?.['source'] !== undefined) return false;      // effect damage, not combat
    const uid = ev.data?.['unit'] as EntityId | undefined;
    if (uid === undefined) return false;
    if (ci !== -1) return !!b.blocks[ci]?.includes(uid);       // attacking: hit my blockers
    const entry = Object.entries(b.blocks).find(([, c]) => c === col);
    return !!entry && !!b.columns[Number(entry[0])]?.includes(uid);   // blocking: hit the attackers
  }
  if (ev.data?.['why'] !== 'combat' || ev.data?.['seat'] === self.controller) return false;
  if (ci !== -1) {
    return ev.data?.['seat'] === b.defender
      && (b.blocks[ci] === undefined || g.colAttrs(alive).has('Piercing'));
  }
  return ev.data?.['seat'] === b.attacker && g.colAttrs(alive).has('Piercing');
}

/**
 * Did the play event `ev` come from somewhere OTHER than the player's hand?
 * R49: both play events now carry `data.from` — the zone the card was played
 * out of, stamped on the StackItem by doPlayCard / doPlayCached. A play event
 * with no `from` at all is not a played card (an effect-created token), so it
 * is not "played from elsewhere" either.
 *
 * (This replaces an apply()-local LOG SCAN, which was unsound: a cast that
 * suspends on its targets fires 'spellPlayed' in a LATER apply() call, by
 * which time the cache-release line is in a previous call's event list.)
 */
function playedFromElsewhere(ev: EngineEvent): boolean {
  const from = ev.data?.['from'] as string | undefined;
  return from !== undefined && from !== 'hand';
}

// ───────────────────────────── the cards ──────────────────────────────

// "Cards played during battle gain [Pay 2 life]." — ll/2 2/2 {Haste} {Switch}
// Holy Unit. PARKED (header): a blanket additional cast cost on every card
// played in a phase is the general cost-modifier layer docs/08 puts out of
// scope. Registered bare, so it plays and fights as a printed 2/2 haste unit.
// ⚠ TRANSCRIPTION: the type line carries a bare `{Switch}` — the only card in
// the whole pool that does, and the rules text has no [Switch]/[Switch1]
// marker to go with it. Flagged, not guessed at: no graftEffect is invented.
// "Cards played during battle gain [Pay 2 life]." — ll/2 2/2 {Haste}
// {Switch} Holy Unit. R60: the life half of the cost-modifier layer (R59
// brought the mana half in for Tranquility). Scoped exactly as printed:
//  · "cards", not "spells" — a unit played during battle is taxed too;
//  · "played", so applying a mod is exempt (R37 — purpose 'mod');
//  · "during battle", so the haste step and deployment are free;
//  · everyone's cards, not just the opponent's — including my own.
// Region-scoped like every other cost mod (R12): the Arbiter taxes the
// battle it is standing in, not one happening elsewhere.
card('Arbiter of Armistice', {
  costMods: [{
    life: (g, _self, ctx) =>
      (g.s.phase === 'battle' && ctx.purpose === 'play') ? 2 : 0,
  }],
});

// "[Augment] Pay 1 life: I gain piercing until regroup." — l/3 3/4 Horror
// Unit. An ACTIVATED ability inside the [Augment] text box: usable on the card
// itself when played normally (via 'augment') and on a host when donated
// (via { mod }) — "I" is then the host. R49: the 1 life is a real ACTIVATION
// cost now — it gates the activation (you may not activate at 1 life) and is
// paid before the ability reaches the stack, so it cannot be responded to.
card('Blob of the Dark Order', {
  augmentText: [{
    type: 'activated', cost: { life: 1 },
    label: 'pay 1 life: I gain {Piercing} until regroup',
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) return;
        const live = g.entity(self.id);
        if (live) g.addTempAttr(live, 'Piercing');
      },
    },
  }],
});

// "When you gain or lose life during battle, [Switch1] Put three +1/+1
// counters on me." — ll/3 2/2 Spirit Unit. Both life channels, either
// direction, but only YOUR life and only during battle (R1: the condition is
// checked at event time). [Switch1] = bounded (R9, one firing per turn however
// often life moves) and a graft cause.
const colonyCounters: EffectDef = {
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    if (self) g.addCounters(self, 3);
  },
};
card('Colony of the Interworld', {
  abilities: [{
    type: 'triggered', events: ['lifeGained', 'lifeLost'], bounded: true, graftCause: true,
    label: 'put three +1/+1 counters on me',
    when: (g, self, ev) => g.s.phase === 'battle' && ev.data?.['seat'] === self.controller,
    effect: colonyCounters,
  }],
  graftEffect: { bounded: true, effect: colonyCounters },
});

// "Look at target opponent's hand and choose a card from it. They cache that
// card. It gains 'Prophecy — Three Turns Pass'." — ll/1 {Battle} Cosmic Spell.
// Target is a PLAYER, and not you — the 'opponent' kind says exactly that, so
// no unit is ever on the menu. The card leaves their hand for THEIR cache
// with a granted prophecy (R42/R43: normalizeProphecy handles the wording, and
// the three-turn clock starts counting forward from now). They are the ones
// who may eventually release it — this is a delay, not a steal.
card('Divine Foresight', {
  spellEffect: {
    // R64: "target opponent" — a player, and not you
    targets: { what: 'opponent', prompt: "Divine Foresight: look at target opponent's hand" },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('player' in (t as object))) return;
      const who = (t as { player: Seat }).player;
      if (who === ctx.controller) {
        g.ev('info', 'Divine Foresight: the target must be an opponent — no effect.');
        return;
      }
      const hand = g.player(who).hand;
      g.ev('info', `Divine Foresight reveals ${g.pname(who)}'s hand: ${hand.join(', ') || '(empty)'}.`);
      g.revealHandTo(ctx.controller, who);
      if (!hand.length) return;
      const pick = ctx.choose('foresee', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: `Divine Foresight: ${g.pname(who)} caches which card? (it gains Prophecy — Three Turns Pass)`,
        options: hand.map((name, i) => ({ label: name, value: i, card: name })),
      }) as number;
      if (hand[pick] === undefined) return;
      g.cacheFromHand(who, pick, { prophecy: 'Three Turns Pass' });
    },
  },
});

// "[Switch1] [Pay X life], create an X/X unit." — l/4 Horror Spell (deploy).
// The leading [Switch1] makes the whole text a bounded graft as well as the
// spell's own effect (Arcane Echo's shape). R64: the bracket is an ADDITIONAL
// COST — the life is paid at cast, a point at a time, and X is however much
// was paid. R49 is re-asked before each point, so the cost can never be lethal
// and no cap has to be computed up front.
const fleshTithe: EffectDef = {
  castCost: { kind: 'payLife', n: 'X' },
  xZeroWarning: 'X = 0 creates no unit',   // R74
  creates: ['Unit Token'],
  run: (g, ctx) => {
    const x = ctx.x ?? 0;
    if (x <= 0) { g.ev('info', 'Flesh Tithe: X = 0 — no life paid, no unit.'); return; }
    // R52: a created unit arrives in its CONTROLLER's home region
    g.spawnUnit(ctx.controller, 'Unit Token', g.homeRegion(ctx.controller),
      { token: true, tokenStats: [x, x] });
  },
};
card('Flesh Tithe', {
  spellEffect: fleshTithe,
  graftEffect: { bounded: true, effect: fleshTithe },
});

// "Pay 9 life: [Switch1] Erase target unit." — l/5 4/5 Horror Unit. An
// activated ability with a life cost and a bounded graft cause. Erase = out of
// the game entirely: no bin, no died/despawned triggers, mods erased with it.
// R49: the 9 life is a real ACTIVATION cost — it GATES the activation (at 9
// life or less the ability is not offered and apply() refuses it) and is paid
// as the ability is activated, before it reaches the stack.
//
// The [Switch1] is both a graft CAUSE and the card's transferable
// `graftEffect` (the Sprouter pattern), which was missing. As a RIDER the 9
// life rides along as a bracketed cast cost (R35/R49): a grafted rider pays in
// the cast window and may be declined, so the erase can never happen unpaid.
const glararrErase = (castCost?: { kind: 'payLife'; n: number }): EffectDef => ({
  targets: { what: 'unit', prompt: 'Glararr: pay 9 life — erase target unit' },
  ...(castCost ? { castCost } : {}),
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) return;
    const live = g.entity(t.id);
    if (live) eraseFromPlay(g, live);
  },
});
card('Glararr', {
  abilities: [{
    // on the card itself the 9 life is the ACTIVATION cost, so the effect
    // carries no castCost — it would otherwise be charged twice
    type: 'activated', cost: { life: 9 }, bounded: true, graftCause: true,
    label: 'pay 9 life: erase target unit',
    effect: glararrErase(),
  }],
  graftEffect: { bounded: true, effect: glararrErase({ kind: 'payLife', n: 9 }) },
});

// "(Only flying units can block flying units.) When I spawn, you gain 3 debt
// and draw a card." — ll/2 3/4 {Flying} Horror Unit. R39: debt is paid
// automatically at the very end of your next resource step, 1 mana each, and
// the remainder carries over — gaining it costs nothing right now, which is
// exactly why the card is a 3/4 flier plus a card for [2].
card('Greed Angel', {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: 'you gain 3 debt and draw a card',
    effect: {
      run: (g, ctx) => {
        g.gainDebt(ctx.controller, 3);
        g.draw(ctx.controller, 1);
      },
    },
  }],
});

// "When I attack or block, create a token that's a copy of me in my
// formation." — lll/8 2/2 Hooba God Unit. The copy is a Hooba-God unit token;
// "in my formation" is R75 — the controller chooses the slot at resolution
// rather than the copy silently taking my own column's back slot (and getting
// nothing at all when that slot was full). The copy is created after
// attackers/blockers are declared, so it never re-triggers this on its own.
card('Hooba-God', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: "create a token that's a copy of me in my formation",
    effect: {
      creates: ['Hooba-God'],
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) { g.ev('info', 'Hooba-God: it is no longer in play — no copy is created.'); return; }
        const copy = g.spawnUnit(ctx.controller, 'Hooba-God', self.region, { token: true });
        g.placeInFormation(copy, ctx, { key: 'hoobaGodSlot', source: 'Hooba-God' });
      },
    },
  }],
});

// "[Augment] At the end of [Haste], if X is not 0, create an X/X unit, where X
// is the number of expended resources you have." — l/5 3/3 Horror Unit.
// R50: the haste step now ends with an 'endOfHaste' event fired inside a
// settle() window, so this is an ordinary triggered ability. Text-box
// [Augment], so "you" is the HOLDER's controller — the host when donated.
// R1/R27: X is counted at RESOLUTION, off the live resource list; a resource
// spent DURING the haste step is expended by then and counts, which is the
// whole point of the card.
card('Keeper of Tithes', {
  augmentText: [{
    type: 'triggered', events: ['endOfHaste'],
    label: 'at the end of [Haste], create an X/X unit for your expended resources',
    effect: {
      creates: ['Unit Token'],
      run: (g, ctx) => {
        const x = g.player(ctx.controller).resources.filter(r => r.state === 'expended').length;
        if (x <= 0) { g.ev('info', 'Keeper of Tithes: no expended resources — X is 0, no unit.'); return; }
        // R52: a created unit arrives in its CONTROLLER's home region
        g.spawnUnit(ctx.controller, 'Unit Token', g.homeRegion(ctx.controller),
          { token: true, tokenStats: [x, x] });
      },
    },
  }],
});

// "When I attack or block, [Switch1] Glimpse 2." — l/2 2/1 Spirit Unit.
// R45: glimpse reveals the top 2, caches ONE of the glimpser's choice and
// recycles the rest to the bottom of the deck; the cached card is playable
// until end of turn, ignoring affinity but still paying its mana and obeying
// its timing. E.glimpse() raises the choose-one decision itself.
// [Switch1] = bounded (R9) and a graft cause.
const seerGlimpse: EffectDef = {
  run: (g, ctx) => { g.glimpse(ctx.controller, 2); },
};
card('Lifebound Seer', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    bounded: true, graftCause: true,
    label: 'Glimpse 2',
    effect: seerGlimpse,
  }],
  graftEffect: { bounded: true, effect: seerGlimpse },
});

// "Any number of target players each lose 1 life. Draw a card." — l/1
// {Battle} Nature Spell. "Any number" in 1v1 is up to both players, so
// count 2 / min 0 — and min 0 genuinely means "up to", so the draw still
// happens when no player is targeted at all. R64: the kind is 'player', which
// offers the present seats and nothing else — 'any' let a unit fill one of the
// two slots, and that slot then lost no life.
card('Penance', {
  spellEffect: {
    targets: { what: 'player', prompt: 'Penance: any number of target players each lose 1 life', count: 2, min: 0 },
    run: (g, ctx) => {
      for (const t of ctx.targets) {
        if (!('player' in t)) continue;                 // narrowing; the kind guarantees it
        g.loseLife(t.player, 1, 'Penance');
      }
      g.draw(ctx.controller, 1);
    },
  },
});

// "Sacrifice me: [Switch1] Recall up to one target cached card. You gain 3
// life." — l/1 3/1 Cosmic Unit. R41: the cache is PUBLIC, so BOTH caches are
// legal targets — the card exists to answer an opponent's nearly-fulfilled
// prophecy (Caleb 2025-12-06). "Recall" puts the card in its owner's HAND, so
// the entry (and any prophecy stamped on it) is gone. "Up to one" is min 0:
// with no target — or none left at resolution — the 3 life still happens.
//
// The [Switch1] does two jobs, as everywhere else in the pool: it makes the
// ability a bounded graft CAUSE *and* makes the marked clause the card's
// transferable `graftEffect` (the Sprouter pattern — "Sacrifice me: [Switch]
// …" declares both). It was missing the second half, which made this one of
// only two [Switch]-printed cards in the whole pool that could not be grafted.
const observerRecall: EffectDef = {
  targets: { what: 'cachedCard', prompt: 'Prismatic Observer: recall up to one target cached card', count: 1, min: 0 },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (t && 'cached' in (t as object)) {
      const { seat, uid } = (t as { cached: { seat: Seat; uid: number } }).cached;
      const i = g.cacheIndexOf(seat, uid);
      const cc = i === -1 ? undefined : g.uncache(seat, i);
      if (cc) {
        g.player(seat).hand.push(cc.card);
        g.ev('info', `${cc.card} is recalled from ${g.pname(seat)}'s cache to their hand.`);
      }
    }
    g.gainLife(ctx.controller, 3, 'Prismatic Observer');
  },
};
card('Prismatic Observer', {
  abilities: [{
    type: 'activated', cost: { sacrificeSelf: true }, bounded: true, graftCause: true,
    label: 'recall up to one target cached card; you gain 3 life',
    effect: observerRecall,
  }],
  graftEffect: { bounded: true, effect: observerRecall },
});

// "I deal X damage to target unit, where X is the life you've [lost or gained]
// in this battle." — l/1 {Battle} Nature Spell.
// ⚠ TRANSCRIPTION: "[lost or gained]" is bracketed like a symbol but is not
// one — the printed text was read off card images. Taken at its word: X is the
// life you have lost PLUS the life you have gained this battle, read off the
// engine's two per-battle ledgers (`lifeLost:<seat>` from E.loseLife and,
// since R49, `lifeGained:<seat>` from E.gainLife; both reset each battle
// phase, R14). R1: the amount is computed at RESOLUTION.
card('Retribution Thing', {
  spellEffect: {
    targets: { what: 'unit', prompt: "Retribution Thing: deal damage equal to the life you've lost this battle" },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      const x = g.battleCounter(ctx.region, `lifeLost:${ctx.controller}`)
        + g.battleCounter(ctx.region, `lifeGained:${ctx.controller}`);
      if (x <= 0) { g.ev('info', "Retribution Thing: your life has not moved this battle — X is 0."); return; }
      g.dealEffectDamage(ctx, t, x);
    },
  },
  // playtest #5 UI badge: what X would be if it resolved right now
  xPreview: (g, seat, region) =>
    g.battleCounter(region, `lifeLost:${seat}`) + g.battleCounter(region, `lifeGained:${seat}`),
});

// "When I spawn, [Switch1] You gain 3 life." — l/1 2/1 {Battle} Friend Unit.
// A battle-timed 2/1 that pays for itself; [Switch1] = bounded (R9) and a
// graft cause, so grafts hung on it ride the spawn.
const sprintLife: EffectDef = {
  run: (g, ctx) => { g.gainLife(ctx.controller, 3, 'Shard Sprite'); },
};
card('Shard Sprite', {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true, bounded: true, graftCause: true,
    label: 'you gain 3 life',
    effect: sprintLife,
  }],
  graftEffect: { bounded: true, effect: sprintLife },
});

// "[Augment] When you play a card from anywhere other than your hand, put two
// +1/+1 counters on me." — l/1 1/1 Nature Unit. Text-box [Augment]: live when
// played normally, donated on augment ("me" = the host, "you" = the host's
// controller). R37: applying a mod is NOT playing a card, so grafting or
// augmenting out of the cache deliberately does not feed this.
// R49: the play events carry the source ZONE (`data.from`), so this is an
// exact read rather than the old log scan. A unit play is heard on 'spawned'
// (its own spawn, never a token), everything else on 'spellPlayed' — so a
// spell unit is counted exactly once.
card('Stalwart Sentinel', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed', 'spawned'],
    label: 'put two +1/+1 counters on me',
    when: (g, self, ev) => {
      if (ev.data?.['seat'] !== self.controller) return false;
      const name = ev.data?.['card'] as string | undefined;
      if (!name) return false;
      if (ev.type === 'spawned') {
        if (getCard(name).kind !== 'unit') return false;      // spellUnits are heard on 'spellPlayed'
        const u = g.entity(ev.data?.['unit'] as EntityId);
        if (!u || u.token) return false;                      // created tokens are not played cards
      }
      return playedFromElsewhere(ev);
    },
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (self) g.addCounters(self, 2);
      },
    },
  }],
});

// "[Augment] During [Haste] name a card. My last named card loses all
// abilities. (As long as I am in their region.)" — l/4 3/3 {Haste} Spirit
// Unit. PARKED (header) on ONE missing primitive: a "name a card" player
// action. The suppression half is done — R62's StaticMod.suppressAbilities is
// exactly "loses all abilities", region-scoped and radiating, and Monke,
// Suppression Field and Transmogrifant all use it; with a naming action this
// becomes a static whose `affects` matches the named card. The inert
// augmentText keeps isAugment() true so the card plays and attaches
// crash-free.
card('The Everywhere', {
  augmentText: [{
    type: 'triggered', events: [],
    label: '(parked) during [Haste] name a card — my last named card loses all abilities',
    effect: { run: () => { /* PARKED: needs a name-a-card action + suppression layer */ } },
  }],
});

// "[Augment] When I attack or block, your life total becomes 13." — lll/3 0/13
// {Virus} Horror Unit. Text-box [Augment], so as a Virus it reads from the
// HOST: "your" is the host's controller, which is the point — a 0/13 wall you
// can also staple onto an enemy attacker to drag them down to 13 (or, less
// happily for you, up to 13). Expressed as a life move, so it is a real gain
// or a real loss and everything that watches life hears it.
card('Triskaidekaphage', {
  augmentText: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: 'your life total becomes 13',
    effect: {
      run: (g, ctx) => {
        const life = g.player(ctx.controller).life;
        if (life > 13) g.loseLife(ctx.controller, life - 13, 'Triskaidekaphage');
        else if (life < 13) g.gainLife(ctx.controller, 13 - life, 'Triskaidekaphage');
        else g.ev('info', `${g.pname(ctx.controller)} is already at 13 life.`);
      },
    },
  }],
});

// "[Augment] When my column deals combat damage, each opponent gains that much
// life." — l/1 4/4 {Virus} Cosmic Unit. A 4/4 for [1] with a drawback you are
// meant to hand to somebody else: as a Virus the text reads from the HOST, so
// "my column" is the host's column and "each opponent" is the host
// controller's opponent. ⚠ header: the column-connect test and the amount come
// off the combat events (Flowstone Arcanite's reading); a column that both
// kills blockers and pierces through pays out once per damage instance.
card('Vroot', {
  augmentText: [{
    type: 'triggered', events: ['damage', 'lifeLost'],
    label: 'each opponent gains that much life',
    when: (g, self, ev) => myColumnDealtCombatDamage(g, self, ev),
    effect: {
      run: (g, ctx) => {
        const n = Number(ctx.event?.data?.['n'] ?? 0);
        if (n <= 0) return;
        for (const s of opponentsOf(g, ctx.region, ctx.controller)) g.gainLife(s, n, 'Vroot');
      },
    },
  }],
});
