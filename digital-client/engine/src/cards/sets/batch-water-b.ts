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
 *  - Soul Siphon: "X = the life target player lost in this battle" needs a
 *    per-battle life-loss ledger. loseLife() fires 'lifeLost' but bumps no
 *    battleCounter, and a spell has no in-play listener to keep its own count.
 *    The card reads battleCounter(`lifeLost:<seat>`), which nothing bumps yet
 *    (one-line engine addition in loseLife would light it up) — so today it
 *    resolves cleanly and creates nothing (X = 0).
 *  - Water Resource: "When I activate, if you have at least [b][b][b], create
 *    a Shard" needs (a) resource cards modelled as playable resources (the
 *    engine's resources are anonymous ResourceState entries made by
 *    recycleForResource), (b) 'resourceActivated' dispatched to trigger
 *    listeners (apply.ts only logs it), and (c) a 'Shard' resource kind.
 *    Registered as printed data only so lookups never crash.
 *  - PARTIAL — Rider of the Tides / Xenopod Progenitor: "a card enters a
 *    player's hand during battle" is heard via 'despawned' (recall → hand),
 *    but draw() only logs its event — 'draw' is never dispatched to trigger
 *    listeners, so mid-battle draws don't trigger these two. Engine addition
 *    needed: fireEvent('draw', ...) in E.draw().
 */
import type { Entity, EntityId, Seat, TargetRef } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, type EffectCtx, type EffectDef } from '../dsl.ts';
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
// formation cleanup all behave; the cards are rerouted afterwards. A token
// victim is simply erased (there is no card to move).
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
      const owner = u.owner;
      const modCards = u.mods
        .map(id => g.entity(id)?.card)
        .filter((n): n is string => n !== undefined);
      g.destroy(u, 'is deleted');
      if (wasToken) return;   // erased — nothing enters a bin
      if (modCards.length === 0) {
        // destroy() binned it to its owner — reroute to the caster's bin
        const ob = g.player(owner).bin;
        const i = ob.lastIndexOf(name);
        if (i !== -1) ob.splice(i, 1);
        g.player(ctx.controller).bin.push(name);
      } else {
        // destroy() erased base + mods (Unstable); Pull Under bins them all
        g.player(ctx.controller).bin.push(name, ...modCards);
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
// hands mid-battle via recall ('despawned', nontoken → owner's hand); a token
// recall is erased instead, filtered by card type (see isNontokenCard).
// ⚠ PARTIAL: 'draw' events are not dispatched to listeners (see header), so
// mid-battle draws don't trigger this yet.
card('Rider of the Tides', {
  augmentText: [{
    type: 'triggered', events: ['despawned'],
    label: 'I gain +2/+2 until regroup (a card entered a hand)',
    when: (g, self, ev) =>
      g.s.phase === 'battle' && isNontokenCard(ev.data?.card),
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
      run: (g, ctx) => {
        const victim = ctx.event?.data?.seat as Seat | undefined;
        if (victim === undefined) return;
        const bin = g.player(victim).bin;
        if (!bin.length) return;
        const idx = bin.length === 1 ? 0 : ctx.choose('pick', {
          kind: 'electricPath', seat: ctx.controller,
          prompt: `Rippleback Skulker: put a card from ${g.pname(victim)}'s bin into your hand`,
          options: bin.map((n, i) => ({ label: n, value: i })),
        }) as number;
        const [taken] = bin.splice(idx, 1);
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
// this battle." — b/2, {Battle} Occult Horror Spell.
// PARKED (see header): the engine keeps no per-battle life-loss counter. The
// effect reads battleCounter(`lifeLost:<seat>`) — the key a future one-line
// loseLife() addition would bump — so today X is always 0 and the spell
// resolves without creating anything.
const soulSiphonMake: EffectDef = {
  run: (g, ctx) => {
    const seats = presentSeats(g, ctx.region);
    if (!seats.length) return;
    const seat = (seats.length === 1 ? seats[0]! : ctx.choose('who', {
      kind: 'electricPath', seat: ctx.controller,
      prompt: 'Soul Siphon: target player (X = life they lost this battle)',
      options: seats.map(s => ({ label: g.pname(s), value: s })),
    })) as Seat;
    const x = g.battleCounter(ctx.region, `lifeLost:${seat}`);   // PARKED: never bumped yet
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
card('Spell Excavation', {
  spellEffect: {
    run: (g, ctx) => {
      const bin = g.player(ctx.controller).bin;
      const playable = (n: string): boolean => {
        const d = getCard(n);
        if (d.kind !== 'spell' && d.kind !== 'spellUnit') return false;
        if (!g.canPayCard(ctx.controller, n)) return false;
        if (d.spellEffect?.targets
          && !g.targetCandidates(d.spellEffect.targets, ctx.region, undefined, ctx.controller).length) return false;
        return true;
      };
      const opts = bin
        .map((n, i) => ({ label: n, value: i }))
        .filter(o => playable(bin[o.value]!));
      if (!opts.length) return;
      const pick = ctx.choose('pick', {
        kind: 'electricPath', seat: ctx.controller,
        prompt: 'Spell Excavation: play a spell from your bin (it will be erased, not binned)',
        options: [...opts, { label: 'Decline', value: -1 }],
      }) as number;
      if (pick < 0) return;
      const name = bin[pick];
      if (name === undefined || !playable(name)) return;
      bin.splice(pick, 1);
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
    run: (g, ctx) => {
      const picks: Entity[] = [];
      for (const seat of presentSeats(g, ctx.region)) {
        const u = chooseUnit(g, ctx, `tr:${seat}`, ctx.controller,
          g.unitsOf(seat, ctx.region),
          `Tidal Reversion: recall which of ${g.pname(seat)}'s units?`);
        if (u) picks.push(u);
      }
      for (const u of picks) g.recall(u);
    },
  },
});

// "When a player is dealt combat damage, [Switch1] Create a 2/2 unit." —
// bb/3 1/4. Fires on 'lifeLost' with why 'combat' (ANY player; the event is
// region-scoped in battle, R12). Bounded (R9); the 2/2 is the bounded graft.
const makeTwoTwo: EffectDef = {
  run: (g, ctx) => {
    g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [2, 2] });
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
const tiderunnerOpenSpots = (g: E, seat: Seat): { col: EntityId[]; label: string }[] => {
  const b = g.s.battle;
  if (!b) return [];
  const grid = seat === b.attacker ? b.columns
    : seat === b.defender ? Object.values(b.blocks) : [];
  const out: { col: EntityId[]; label: string }[] = [];
  grid.forEach((col, i) => {
    const alive = col.filter(id => g.entity(id));
    if (alive.length === 1) {
      out.push({ col, label: `column ${i + 1}, behind ${g.entity(alive[0]!)?.card ?? '?'}` });
    }
  });
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
        s.col.push(self.id);
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
      const top = g.s.sharedDeck.slice(0, 8);
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
          .map((n, i) => ({ label: `${n} [${manaOf(n)}]`, value: i }))
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
      g.s.sharedDeck.splice(0, top.length);
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
        if (!picks.includes(i)) g.recycleToBottom(top[i]!);
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
// [Augment]. Same 'despawned' channel as Rider of the Tides ("other" excludes
// the carrier's own recall; ⚠ PARTIAL: draws not dispatched — see header).
// The [one] payment is a mid-resolution pay-or-decline (R6), skipped outright
// when the controller cannot pay.
card('Xenopod Progenitor', {
  augmentText: [{
    type: 'triggered', events: ['despawned'],
    label: 'you may pay [one] to create a 2/2 unit (a card entered a hand)',
    when: (g, self, ev) =>
      g.s.phase === 'battle' &&
      ev.data?.unit !== self.id &&
      isNontokenCard(ev.data?.card),
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
