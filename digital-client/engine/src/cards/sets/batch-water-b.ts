/* batch-water-b — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Cards are being scripted here from printed.json data
 * (never hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R9 (bounded budgets per card), R12/R25 ("each player/opponent" reads the
 * event region's present seats), R14 ("this battle" counters are per
 * region-battle).
 *
 * PARKED (needs engine machinery that does not exist yet):
 *  - Water Resource: "When I activate, if you have at least [b][b][b], create
 *    a Shard" needs (a) resource cards modelled as playable resources (the
 *    engine's resources are anonymous ResourceState entries made by
 *    recycleForResource), (b) 'resourceActivated' dispatched to trigger
 *    listeners (apply.ts only logs it), and (c) a 'Shard' resource kind.
 *    Registered as printed data only so lookups never crash.
 */
import type { Entity, EntityId, Seat, TargetRef } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, isEntityTarget, getCard, type EffectCtx, type EffectDef } from '../dsl.ts';
import type { ResolvedTarget } from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

const isEnt = (t: unknown): t is Entity =>
  !!t && typeof t === 'object' && 'id' in (t as object);

/** present seats of a region, initiative player first (stable order) */
const presentSeats = (g: E, region: number): Seat[] => {
  const present = g.s.regions[region]!.presentSeats;
  return [g.initiative, g.nit].filter(s => present.includes(s));
};

/** token cards never "enter a hand" — they are erased when they leave play.
 * The despawned event carries no token flag, so the card TYPE is the proxy
 * (every token card's type line contains "Token"). */
const isNontokenCard = (name: unknown): boolean =>
  typeof name === 'string' && !/Token/.test(getCard(name).type);

/** `chooser` picks one of `candidates` (auto-picked when only one). Returns
 * null when there is nothing to pick. Plan-then-commit: call all chooses
 * before mutating (the engine replays the part on suspension). */
const chooseUnit = (
  g: E, ctx: EffectCtx, key: string, chooser: Seat, candidates: Entity[], prompt: string,
): Entity | null => {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0]!;
  const id = ctx.choose(key, {
    kind: 'electricPath', seat: chooser, prompt,
    options: candidates.map(u => ({ label: u.card, value: u.id })),
  }) as EntityId;
  return g.entity(id) ?? null;
};

/** "Each player recalls a unit" (R12/R25: the region's present seats; each
 * player picks their own). All picks are gathered before any recall. */
const planEachPlayerRecall = (g: E, ctx: EffectCtx, tag: string): Entity[] => {
  const picks: Entity[] = [];
  for (const seat of presentSeats(g, ctx.region)) {
    const u = chooseUnit(g, ctx, `${tag}:${seat}`, seat,
      g.unitsOf(seat, ctx.region), `${ctx.sourceName}: choose a unit to recall`);
    if (u) picks.push(u);
  }
  return picks;
};

/**
 * Play a card inline as part of an effect's resolution (Tides of the Cosmos'
 * "play them now", Spell Excavation's bin play). ⚠ approximation: the played
 * spell resolves immediately inside this resolution (no stack entry, no
 * response window) — the closest the engine offers to a mid-resolution play.
 * Units and spell-unit bodies spawn normally (their triggers fire);
 * 'spellPlayed' is fired so play-a-spell triggers count it.
 * Returns 'unit' | 'ok' | 'fizzled' (targeted spell with no candidates).
 * The CALLER decides where the spell card goes afterwards (bin / erased).
 */
const playInline = (g: E, ctx: EffectCtx, name: string, key: string): 'unit' | 'ok' | 'fizzled' => {
  const def = getCard(name);
  if (def.kind === 'unit') {
    g.spawnUnit(ctx.controller, name, ctx.region);
    return 'unit';
  }
  const ev = g.ev('spellPlayed',
    `${g.pname(ctx.controller)} plays ${name} (via ${ctx.sourceName}).`,
    { seat: ctx.controller, card: name, token: false, region: ctx.region });
  g.fireEvent('spellPlayed', ev);
  const eff = def.spellEffect;
  let fizzled = false;
  if (eff) {
    let targets: ResolvedTarget[] = [];
    if (eff.targets) {
      const cands = g.targetCandidates(eff.targets, ctx.region, undefined, ctx.controller);
      if (!cands.length) fizzled = true;
      else {
        const ref = (cands.length === 1 ? cands[0]! : ctx.choose(`${key}:t`, {
          kind: 'electricPath', seat: ctx.controller, prompt: eff.targets.prompt,
          options: cands.map(c => ({ label: g.targetLabel(c), value: c })),
        })) as TargetRef;
        const r = g.resolveTargetRef(ref);
        if (r) targets = [r];
        else fizzled = true;
      }
    }
    if (!fizzled) {
      eff.run(g, {
        controller: ctx.controller, sourceName: name, region: ctx.region,
        targets, event: null,
        choose: (k, d) => ctx.choose(`${key}:${k}`, d),
      });
    }
  }
  if (fizzled) return 'fizzled';
  if (def.kind === 'spellUnit') g.spawnUnit(ctx.controller, name, ctx.region);
  return 'ok';
};

// ────────────────────────────── the cards ──────────────────────────────

// "Delete target unit. If you do, put it and all of its mods into your bin."
// bb/4 — {Battle} Maelstrom Spell. Overrides the normal destinations: a
// nontoken victim goes to the CASTER's bin (not its owner's), and a modded
// victim's card + mods land in the caster's bin instead of being erased
// (Unstable). destroy() is still used so death triggers / battle counters /
// formation cleanup all behave; the unmodded case is redirected AT SOURCE with
// destroy()'s `binTo`, the modded case is binned here. A token victim — and a
// token MOD — is simply erased (there is no card to move).
//
// R40 (trashing) is satisfied by `destroy(u, verb, { binTo })`, which routes
// the single bin push AND the single trash attribution at the caster in one
// decision — a card is trashed by the owner of the bin it enters:
//
//  - unmodded victim, whoever owns it: destroy({ binTo: caster }) puts the card
//    in the CASTER's bin and fires exactly one trashed(caster). No reroute.
//    (Rerouting after the fact was impossible: destroy() fires 'trashed'
//    synchronously — queueing its triggers and bumping the per-battle ledger —
//    before card code regains control, and a compensating second
//    trashed(caster) would double-count the ledger and double-fire "when I am
//    trashed".)
//  - modded victim: destroy() erases everything (Unstable) and bins nothing, so
//    `binTo` never applies and Pull Under owns the whole move. It uses
//    E.toBin(caster, …, 'play'), which trashes each card by the caster.
//  - token victim (or a token MOD): erased, no bin, no trash.
card('Pull Under', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Pull Under: delete target unit — it and its mods go to your bin' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t)) return;
      const u = g.entity(t.id);
      if (!u) return;
      const wasToken = !!u.token;
      const name = u.card;
      // R40: a token mod has no card and is never trashed — it is erased with
      // the body, exactly as recall()/cacheUnit() erase one.
      const modCards = u.mods
        .map(id => g.entity(id))
        .filter((m): m is Entity => !!m && !m.token)
        .map(m => m.card);
      const hadMods = u.mods.length > 0;
      g.destroy(u, 'is deleted', { binTo: ctx.controller });
      if (wasToken) return;   // erased — nothing enters a bin
      if (hadMods) {
        // destroy() erased base + mods (Unstable) and fired no trash, so the
        // whole move is ours: everything enters the CASTER's bin from play,
        // and R40 trashes each one in the caster's name.
        g.toBin(ctx.controller, name, 'play');
        for (const m of modCards) g.toBin(ctx.controller, m, 'play');
      }
      g.ev('info', `Pull Under: ${name}${modCards.length ? ` and ${modCards.length} mod(s)` : ''} → ${g.pname(ctx.controller)}'s bin.`);
    },
  },
});

// "[Switch1] Each player recalls a unit and loses 2 life." — b/1, {Battle}
// Maelstrom Spell. "Each player" = the region's present seats (R12/R25); each
// player picks their own unit (auto when only one). The life loss is
// unconditional per player — a player with no unit to recall still loses 2.
const recallSpellEffect: EffectDef = {
  run: (g, ctx) => {
    const picks = planEachPlayerRecall(g, ctx, 'rc');
    const seats = presentSeats(g, ctx.region);
    for (const u of picks) g.recall(u);
    for (const seat of seats) g.loseLife(seat, 2, ctx.sourceName);
  },
};
card('Recall', {
  spellEffect: recallSpellEffect,
  graftEffect: { bounded: true, effect: recallSpellEffect },
});

// "[Augment] Whenever a card enters a player's hand during battle, I gain
// +2/+2 until regroup." — b/1 2/2 Fish Unit. Text-box [Augment]. Cards enter
// hands mid-battle via recall ('despawned', nontoken → owner's hand; a token
// recall is erased instead, filtered by card type — see isNontokenCard) or a
// battle DRAW (E.draw fires 'draw' during battle only; drawn cards are deck
// cards, always nontoken; the event carries no region, so the when() pins the
// listener to the battle region, R12).
card('Rider of the Tides', {
  augmentText: [{
    type: 'triggered', events: ['despawned', 'draw'],
    label: 'I gain +2/+2 until regroup (a card entered a hand)',
    when: (g, self, ev) =>
      g.s.phase === 'battle' &&
      (ev.type === 'draw' ? g.s.battle?.region === self.region
        : isNontokenCard(ev.data?.card)),
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (self) g.addTemp(self, 2, 2);
      },
    },
  }],
});

// "[Augment] Whenever my column deals combat damage to a player, put target
// card from that player's bin into your hand." — b/2 2/1 {Evasive}. Text-box
// [Augment]. The engine's combat lifeLost event ({ why: 'combat' }) doesn't
// attribute columns, so when() reconstructs "my column connected" at event
// time: I'm in a column with power, and it reaches the player (attacking and
// unblocked, or Piercing — ⚠ approximation: a Piercing column whose overflow
// was fully absorbed can misfire). The bin pick happens at RESOLUTION from
// the live bin (R1).
card('Rippleback Skulker', {
  augmentText: [{
    type: 'triggered', events: ['lifeLost'],
    label: "put target card from that player's bin into your hand",
    when: (g, self, ev) => {
      if (ev.data?.why !== 'combat' || ev.data?.seat === self.controller) return false;
      const b = g.s.battle;
      if (!b) return false;
      const col = g.columnOf(self.id);
      if (!col) return false;
      const alive = col.filter(id => g.entity(id));
      const power = alive.reduce((s, id) => s + Math.max(0, g.effStats(g.entity(id)!)[0]), 0);
      if (power <= 0) return false;
      const ci = b.columns.indexOf(col);
      if (ci !== -1) return b.blocks[ci] === undefined || g.colAttrs(alive).has('Piercing');
      return g.colAttrs(alive).has('Piercing');   // blocking column: only Piercing connects
    },
    effect: {
      // R67: "target card from that player's bin" is a DECLARED target,
      // chosen as the trigger goes on the stack. "That player" is the one the
      // column just damaged, which only the EVENT knows — so the restriction
      // reads `tc.event`, the same snapshot run() sees as ctx.event. The kind
      // is 'anyBinCard' (it reaches a bin that is not mine) narrowed by the
      // restriction to exactly the victim's.
      targets: {
        what: 'anyBinCard', min: 0,
        prompt: "Rippleback Skulker: put target card from that player's bin into your hand",
        restrict: (_g, t, tc) => 'binCard' in t && t.binCard.seat === tc.event?.data?.seat,
      },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!t || !('binCard' in t) || t.binCard.index === -1) return;
        const [taken] = g.player(t.binCard.seat).bin.splice(t.binCard.index, 1);
        if (taken !== undefined) {
          g.player(ctx.controller).hand.push(taken);
          g.ev('info', `Rippleback Skulker: ${taken} → ${g.pname(ctx.controller)}'s hand.`);
        }
      },
    },
  }],
});

// "When the second nontoken spell is played in this battle, [Switch1] Each
// player recalls a unit." — b/3 2/3. The engine keeps no global spells-played
// counter, so the listener maintains a per-INSTANCE battle counter (R14: per
// region-battle, reset at battle-phase start), bumped inside when() — which
// fireEvent evaluates exactly once per event per listener, so the count is
// exact even with multiple Shellcasters in play. Condition at event time
// (R1); [Switch1] bounded (R9); the recall effect is the bounded graft.
const eachPlayerRecalls: EffectDef = {
  run: (g, ctx) => {
    for (const u of planEachPlayerRecall(g, ctx, 'ssc')) g.recall(u);
  },
};
card('Seabed Shellcaster', {
  abilities: [{
    type: 'triggered', events: ['spellPlayed'], bounded: true, graftCause: true,
    label: 'each player recalls a unit (second nontoken spell this battle)',
    when: (g, self, ev) =>
      g.s.phase === 'battle' &&
      !ev.data?.token &&
      g.bumpBattleCounter((ev.data?.region as number | undefined) ?? self.region, `sscSpells:${self.id}`) === 2,
    effect: eachPlayerRecalls,
  }],
  graftEffect: { bounded: true, effect: eachPlayerRecalls },
});

// "[Augment] After combat, you may recall target ally. If you do, each
// opponent loses 2 life." — bb/2 3/2 Spirit Unit. Text-box [Augment]. The
// target is declared when the trigger goes on the stack; the "may" is a
// mid-resolution decline (R6 pattern). "Each opponent" region-scoped (R25).
card('Shoreline Specter', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'you may recall target ally — each opponent loses 2 life',
    effect: {
      targets: { what: 'allyUnit', prompt: 'Shoreline Specter: recall target ally? (each opponent then loses 2 life)' },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!isEnt(t)) return;
        const u = g.entity(t.id);
        if (!u) return;
        const yes = ctx.choose('doIt', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Shoreline Specter: recall ${u.card}? (each opponent loses 2 life)`,
          options: [{ label: `Recall ${u.card}`, value: true }, { label: 'Decline', value: false }],
        });
        if (!yes) return;
        const opponents = presentSeats(g, ctx.region).filter(s => s !== ctx.controller);
        g.recall(u);
        for (const s of opponents) g.loseLife(s, 2, 'Shoreline Specter');
      },
    },
  }],
});

// "[Switch1] Create an X/X unit, where X is the life target player lost in
// this battle." — b/2, {Battle} Occult Horror Spell. X reads the engine's
// per-battle life-loss ledger (E.loseLife bumps battleCounter
// `lifeLost:<seat>`; reset per battle, R14; amount at resolution, R1).
const soulSiphonMake: EffectDef = {
  // R67: "target player" is a DECLARED target, chosen as the item goes on the
  // stack. R64's 'player' kind is the one with no ownership clause — the card
  // says "target player", not "target opponent", so aiming it at YOURSELF is
  // legal (and is what you do when you are the one who has been bled).
  targets: { what: 'player', prompt: 'Soul Siphon: target player (X = the life they lost this battle)' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!t || !('player' in t)) return;
    const seat = t.player;
    const x = g.battleCounter(ctx.region, `lifeLost:${seat}`);   // engine ledger (loseLife)
    if (x > 0) g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [x, x] });
    else g.ev('info', 'Soul Siphon: X = 0 — no unit created.');
  },
};
card('Soul Siphon', {
  spellEffect: soulSiphonMake,
  graftEffect: { bounded: true, effect: soulSiphonMake },
});

// "[Switch1] Create an 8/8 unit." — bbb/7 2/2 {Battle} Alien Spell Unit. The
// spell part makes the 8/8; the 2/2 body then spawns (spellUnit). Bounded
// graft shares the effect.
const makeEightEight: EffectDef = {
  run: (g, ctx) => {
    g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [8, 8] });
  },
};
card('Spawntender', {
  spellEffect: makeEightEight,
  graftEffect: { bounded: true, effect: makeEightEight },
});

// "You may play target spell from your bin until regroup. It gains unstable
// until regroup. (If it would enter a bin, erase it instead.)" — bb/1,
// {Battle} Arcane Spell. ⚠ approximations: "until regroup" play-permission
// windows don't exist, so the chosen spell is played immediately as part of
// resolution (cost still paid normally — canPayCard/payCard); the unstable
// clause is applied by ERASING the spell instead of binning it after it
// resolves. A spell unit played this way spawns its body; the body's own
// later bin-entry is not tracked as unstable (edge, noted for review).
/**
 * The restriction Spell Excavation aims under: a spell in the bin that could
 * actually be played right now — affordable, and, if it targets, able to find
 * a target. Asked at CAST as part of what makes a target legal (R64), and
 * again in run(), because the board may have moved in between (R56).
 *
 * The "can it find a target" probe asks targetCandidates about ANOTHER card's
 * spec, which is a nested query — and a Spell Excavation sitting in the bin
 * makes that nesting self-referential (its own restriction scans the bin,
 * finds itself, and asks again). `probing` is the reentrancy guard, the same
 * shape as E.inStatics: a re-entered probe answers on kind and affordability
 * alone. That can only make the outer menu MORE permissive, and run() re-asks
 * the full question before it commits to anything.
 */
let probing = false;
const excavatable = (g: E, seat: Seat, region: number, n: string): boolean => {
  const d = getCard(n);
  if (d.kind !== 'spell' && d.kind !== 'spellUnit') return false;
  if (!g.canPayCard(seat, n)) return false;
  if (probing || !d.spellEffect?.targets) return true;
  probing = true;
  try {
    return g.targetCandidates(d.spellEffect.targets, region, undefined, seat).length > 0;
  } finally {
    probing = false;
  }
};
card('Spell Excavation', {
  spellEffect: {
    // R67: "target spell from your bin" is a DECLARED target, chosen as the
    // Excavation goes on the stack (R64's 'binCard'), not a mid-resolution
    // pick. min 0 carries the "You may".
    targets: {
      what: 'binCard', min: 0,
      prompt: 'Spell Excavation: play target spell from your bin (it will be erased, not binned)',
      restrict: (g, t, tc) => 'binCard' in t && tc.ally !== undefined
        && excavatable(g, tc.ally, tc.region, t.binCard.card),
    },
    run: (g, ctx) => {
      const bin = g.player(ctx.controller).bin;
      const t = ctx.targets[0];
      if (!t || !('binCard' in t) || t.binCard.index === -1) return;
      const name = bin[t.binCard.index];
      if (name === undefined || !excavatable(g, ctx.controller, ctx.region, name)) return;
      bin.splice(t.binCard.index, 1);
      g.payCard(ctx.controller, name);
      playInline(g, ctx, name, 'x');
      // unstable: the spell card is erased instead of returning to a bin
      g.ev('info', `${name} was unstable — erased instead of binned.`);
    },
  },
});

// "When I attack or block alone, [Switch1] Double my power and defense until
// regroup." — bb/4 4/4 {Battle} Manatee Unit. "Alone" = the only living unit
// in my whole formation grid (attackers when attacking, blockers when
// blocking — the R20 Sneaky reading), checked at event time (R1). The DOUBLE
// amount is my effective stats at RESOLUTION (R1), added as a temp change.
const doubleSelf: EffectDef = {
  run: (g, ctx) => {
    const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
    if (!self) return;
    const [p, t] = g.effStats(self);
    g.addTemp(self, p, t);
  },
};
card('Surly Stalker', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    bounded: true, graftCause: true,
    label: 'double my power and defense until regroup (attacking/blocking alone)',
    when: (g, self, ev) => {
      const b = g.s.battle;
      if (!b) return false;
      const grid = ev.type === 'attacked' ? b.columns : Object.values(b.blocks);
      const alive = grid.flat().filter(id => g.entity(id));
      return alive.length === 1 && alive[0] === self.id;
    },
    effect: doubleSelf,
  }],
  graftEffect: { bounded: true, effect: doubleSelf },
});

// "[Augment] {Haste} {Alluring} Eel Unit" — b/1 1/3. Type-line [Augment]
// grants {Alluring}; printed.augmentAttrs carries it, and printed.attrs keeps
// it live when played normally ({Haste}: playable in the haste step, R18).
card('Tempest Wrangler', {});

// "{Haste} Lizard Fish Beast Unit" — b/3 7/2 vanilla haste beater (R18).
card('Tidal Menace', {});

// "For each player, recall target unit that player controls." — bb/2,
// {Battle} Mystic Spell. ⚠ the engine's cast-time targeting holds one target
// per part, so the CASTER picks both units mid-resolution instead (auto when
// a player controls exactly one unit in the region). Region-scoped (R12).
card('Tidal Reversion', {
  spellEffect: {
    // R67: "recall target unit that player controls" is a DECLARED target —
    // one per player, all chosen as the spell goes on the stack rather than
    // mid-resolution. Expressed as two unrestricted-`what` slots with a
    // one-per-CONTROLLER restriction rather than ['allyUnit','enemyUnit'],
    // because a fixed slot order aborts the whole collection when the first
    // slot has no candidate: a player with an empty board must not stop the
    // spell from reaching the other player's unit. min 0 for the same reason.
    targets: {
      what: 'unit', count: 2, min: 0,
      prompt: 'Tidal Reversion: recall target unit (one per player)',
      restrict: (_g, t, tc) => !isEntityTarget(t)
        || !(tc.chosen ?? []).some(c => isEntityTarget(c) && c.controller === t.controller),
    },
    run: (g, ctx) => {
      for (const t of ctx.targets) {
        if (!isEntityTarget(t)) continue;
        const u = g.entity(t.id);
        if (u) g.recall(u);
      }
    },
  },
});

// "When a player is dealt combat damage, [Switch1] Create a 2/2 unit." —
// bb/3 1/4. Fires on 'lifeLost' with why 'combat' (ANY player; the event is
// region-scoped in battle, R12). Bounded (R9); the 2/2 is the bounded graft.
// The 2/2 is created in its CONTROLLER'S region, not the battle region
// (playtest ruling: a token minted while Tidelurker attacks must be home to
// block the counterattack — created units default to your region unless the
// card says "in my formation" or similar).
const makeTwoTwo: EffectDef = {
  run: (g, ctx) => {
    g.spawnUnit(ctx.controller, 'Unit Token', g.homeRegion(ctx.controller), { token: true, tokenStats: [2, 2] });
  },
};
card('Tidelurker', {
  abilities: [{
    type: 'triggered', events: ['lifeLost'], bounded: true, graftCause: true,
    label: 'create a 2/2 unit (a player was dealt combat damage)',
    when: (g, self, ev) => ev.data?.why === 'combat',
    effect: makeTwoTwo,
  }],
  graftEffect: { bounded: true, effect: makeTwoTwo },
});

// "You may play me into an open spot in your formation." — b/1 2/2 {Battle}
// Fish Unit. Modelled as a spawn trigger: played during battle it spawns into
// the region, then may slide into an open BACK slot of one of its
// controller's existing formation columns (attacking columns as the
// attacker, blocking columns as the defender). ⚠ reading: "open spot" = the
// empty second slot of a column that has exactly one living unit; it does not
// open brand-new columns. Declining is allowed ("you may").
// An "open spot in your formation": any of your formation columns with fewer
// than 2 living members (join behind the survivor / take over an emptied
// column), plus — provisional ruling — a fresh column alongside an EXISTING
// formation. No formation at all (nothing declared) = nothing to join.
const tiderunnerOpenSpots = (g: E, seat: Seat): { col: EntityId[] | null; label: string }[] => {
  const b = g.s.battle;
  if (!b) return [];
  const attacker = seat === b.attacker;
  const grid = attacker ? b.columns
    : seat === b.defender ? Object.values(b.blocks) : [];
  const anyAlive = grid.some(col => col.some(id => g.entity(id)));
  if (!anyAlive) return [];
  const out: { col: EntityId[] | null; label: string }[] = [];
  grid.forEach((col, i) => {
    const alive = col.filter(id => g.entity(id));
    if (alive.length === 1) {
      out.push({ col, label: `column ${i + 1}, behind ${g.entity(alive[0]!)?.card ?? '?'}` });
    } else if (alive.length === 0) {
      out.push({ col, label: `column ${i + 1} (emptied)` });
    }
  });
  // the attacker's formation can widen by a column; a blocker grid is keyed
  // to attacking columns, so no new columns there
  if (attacker) out.push({ col: null, label: 'a new column' });
  return out;
};
card('Tiderunner Initiate', {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: 'you may join an open spot in your formation',
    when: (g, self) =>
      g.s.phase === 'battle' && tiderunnerOpenSpots(g, self.controller).length > 0,
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        const b = g.s.battle;
        if (!self || !b || self.region !== b.region || g.columnOf(self.id)) return;
        const spots = tiderunnerOpenSpots(g, self.controller);
        if (!spots.length) return;
        const pick = ctx.choose('spot', {
          kind: 'electricPath', seat: ctx.controller,
          prompt: 'Tiderunner Initiate: join an open formation spot?',
          options: [
            ...spots.map((s, i) => ({ label: s.label, value: i })),
            { label: 'Stay out of formation', value: -1 },
          ],
        }) as number;
        const s = pick >= 0 ? spots[pick] : undefined;
        if (!s) return;
        if (s.col) s.col.push(self.id);
        else b.columns.push([self.id]);   // a fresh column alongside the formation
        g.ev('info', `Tiderunner Initiate joins the formation (${s.label}).`);
      },
    },
  }],
});

// "Reveal the top eight cards of the deck. Choose up to two of them with
// total cost 8 or less. You may play them now, for free. Recycle the rest."
// — bbb/8, {Battle} Cosmic Spell. Picks are sequential ("Done" stops early);
// free plays go through playInline (units spawn, spells resolve immediately —
// ⚠ see playInline; a played spell is then binned as usual). The rest recycle
// to the bottom in revealed order.
card('Tides of the Cosmos', {
  spellEffect: {
    run: (g, ctx) => {
      const top = g.deckOf(ctx.controller).slice(0, 8);
      if (!top.length) return;
      g.ev('info', `Tides of the Cosmos reveals: ${top.join(', ')}.`);
      const manaOf = (n: string): number => {
        const m = getCard(n).mana;
        return m === 'X' ? 0 : m;
      };
      const picks: number[] = [];
      let budget = 8;
      for (let k = 0; k < 2; k++) {
        const opts = top
          .map((n, i) => ({ label: `${n} [${manaOf(n)}]`, value: i, card: n }))
          .filter(o => !picks.includes(o.value) && manaOf(top[o.value]!) <= budget);
        if (!opts.length) break;
        const pick = ctx.choose(`pick${k}`, {
          kind: 'electricPath', seat: ctx.controller,
          prompt: `Tides of the Cosmos: play a revealed card for free (${budget} total cost left), or Done`,
          options: [...opts, { label: 'Done', value: -1 }],
        }) as number;
        if (pick < 0) break;
        picks.push(pick);
        budget -= manaOf(top[pick]!);
      }
      // commit: remove the revealed cards, play the picks, recycle the rest
      g.deckOf(ctx.controller).splice(0, top.length);
      for (const i of picks) {
        const name = top[i]!;
        g.ev('info', `Tides of the Cosmos: ${g.pname(ctx.controller)} plays ${name} for free.`);
        const r = playInline(g, ctx, name, `play${i}`);
        // a played spell card is binned as normal; a fizzled spell unit never
        // spawns and is binned too; units stay in play
        const kind = getCard(name).kind;
        if (kind === 'spell' || (kind === 'spellUnit' && r === 'fizzled')) {
          g.player(ctx.controller).bin.push(name);
        }
      }
      for (let i = 0; i < top.length; i++) {
        if (!picks.includes(i)) g.recycleToBottom(ctx.controller, top[i]!);
      }
    },
  },
});

// "Each player recalls two units. If four or more units were recalled this
// way, repeat this." — b/4, {Battle} Bedlam Maelstrom Spell. Per iteration
// each present player recalls two of their units (all of them when they have
// two or fewer — no choice needed then); 4+ recalls repeat the whole thing.
// Terminates naturally (recalled units leave play); iteration cap as a belt.
card('Upheaval', {
  spellEffect: {
    run: (g, ctx) => {
      for (let iter = 0; iter < 20; iter++) {
        const picks: Entity[] = [];
        for (const seat of presentSeats(g, ctx.region)) {
          const pool = g.unitsOf(seat, ctx.region);
          if (pool.length <= 2) { picks.push(...pool); continue; }
          const chosen: Entity[] = [];
          for (let k = 0; k < 2; k++) {
            const u = chooseUnit(g, ctx, `up${iter}:${seat}:${k}`, seat,
              pool.filter(x => !chosen.includes(x)),
              `Upheaval: choose a unit to recall (${2 - k} to go)`);
            if (u) chosen.push(u);
          }
          picks.push(...chosen);
        }
        for (const u of picks) g.recall(u);
        if (picks.length < 4) break;
        g.ev('info', `Upheaval: ${picks.length} units recalled — repeat.`);
      }
    },
  },
});

// "[zero]: [Switch1] Recall me." — bb/3 4/3 Cloud Spirit Unit. A zero-mana
// activated ability; the [Switch1] recall is the bounded graft (on a host it
// recalls the host). Bounded once per turn (R9).
const recallSelf: EffectDef = {
  run: (g, ctx) => {
    const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
    if (self) g.recall(self);
  },
};
card('Vaporweave Eidolon', {
  abilities: [{
    type: 'activated', cost: { mana: 0 }, bounded: true, graftCause: true,
    label: '[zero]: recall me',
    effect: recallSelf,
  }],
  graftEffect: { bounded: true, effect: recallSelf },
});

// "When I activate, if you have at least [b][b][b], create a Shard.
// (It spawns dormant.)" — b/0 2/0, [b] Water Resource.
// PARKED (see header): resource cards, activation triggers and the Shard
// resource kind are all missing engine primitives. Registered on printed data
// only so lookups never crash. (Note: printed.kind is 'unit', so the shared
// deck legally contains it; played, its 0 toughness kills it immediately —
// harmless until resource-card play is modelled.)
card('Water Resource', {});

// "[Augment] Whenever one or more other cards enter a player's hand during
// battle, you may pay [one] to create a 2/2 unit." — b/5 3/3. Text-box
// [Augment]. Same channels as Rider of the Tides: recall ('despawned' — where
// "other" excludes the carrier's own recall) and battle DRAWS ('draw', fired
// by E.draw during battle only; a drawn card is never the carrier, and a
// multi-card draw is ONE event, matching "one or more"). The [one] payment is
// a mid-resolution pay-or-decline (R6), skipped outright when the controller
// cannot pay.
card('Xenopod Progenitor', {
  augmentText: [{
    type: 'triggered', events: ['despawned', 'draw'],
    label: 'you may pay [one] to create a 2/2 unit (a card entered a hand)',
    when: (g, self, ev) =>
      g.s.phase === 'battle' &&
      (ev.type === 'draw' ? g.s.battle?.region === self.region
        : ev.data?.unit !== self.id && isNontokenCard(ev.data?.card)),
    effect: {
      run: (g, ctx) => {
        if (g.openMana(ctx.controller) < 1) return;
        const pay = ctx.choose('pay', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Xenopod Progenitor: pay [1] to create a 2/2 unit?',
          options: [
            { label: 'Pay [1] — create a 2/2 unit', value: true },
            { label: 'Decline', value: false },
          ],
        });
        if (!pay) return;
        g.payMana(ctx.controller, 1);
        g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [2, 2] });
      },
    },
  }],
});
