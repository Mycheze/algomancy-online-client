/* Light & Dark expansion — batch dark-b (18 cards).
 *
 * Behaviour only; printed data comes from printed.json (never hand-copied).
 * Spec for the expansion's new mechanics: docs/08-light-and-dark.md,
 * rulings R38-R48 in docs/digital-rules.md.
 *
 * Cards in this batch:
 *   Blightmound
 *   Cerebrox
 *   Cthyrian Culler
 *   Dropslime
 *   Fester
 *   Grim Bargain
 *   Hooba-Mon
 *   Legion of the Depths
 *   Muck Rummager
 *   Necromantic Rebuke
 *   Palewing
 *   Plague Ritual
 *   Rotbeast
 *   Sarcophage
 *   Skittering Blight
 *   Thought Extraction
 *   Umbral Decay
 *   Writhing Host
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fizzle vs partial; min:0 = "up to"), R6 (mid-resolution choices via
 * ctx.choose, plan-then-commit), R9 (bounded budgets per card), R12/R25
 * ("each player/opponent" reads the effect region's present seats),
 * R28 (created units arrive in their controller's HOME region), R35
 * (bracketed costs and X are chosen and paid at cast), R38 (rot + the rot
 * damage replacement hook), R40 (trashing; the per-battle trash ledger; the
 * "Discard me" play mode), R47 (the Wight, a.k.a. Wraith), R48 ({Afflicting}
 * fires on -1/-1 counter kills — engine-side, so Umbral Decay only puts the
 * counters on).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - "WHEN I DEAL COMBAT DAMAGE" (Blightmound) is the Flowstone Arcanite
 *    column approximation: combat damage is dealt per COLUMN in this engine,
 *    so "I" is read as "my column, which I contribute nonzero power to".
 *    Blightmound is {Poisonous}, so its unit damage arrives as -1/-1 counters
 *    and not as a 'damage' event — the condition therefore also watches
 *    'countersChanged' during a combat sub-step.
 *  - "A UNIT DEALS COMBAT DAMAGE TO A PLAYER" (Sarcophage) is the same
 *    approximation in reverse: every unit in a column that connected with the
 *    damaged player loses its counters, since the engine cannot attribute
 *    face damage to one unit inside a column.
 *  - "EACH PLAYER/OPPONENT" is region-scoped (R25). Out of battle a home
 *    region lists only its owner, so Cthyrian Culler's life loss and Grim
 *    Bargain's sacrifices reach nobody else during deployment — the standing
 *    R25 behaviour, flagged there, not worked around here.
 *  - MOVING A MOD (Rotbeast) has no engine primitive: the mod entity is
 *    re-parented by hand (modOf/region/controller + the two mods arrays), the
 *    way Reconfigure already does it. No 'modApplied' event fires — moving is
 *    not applying (R37's spirit), so nothing re-triggers off it.
 *  - EXCHANGING A UNIT (Hooba-Mon) likewise: the exchanged unit leaves play
 *    WITHOUT dying (no death trigger, no Unstable erase) straight into its
 *    owner's bin, which is a trash from play (R40). Mods on it are erased,
 *    matching destroy()'s Unstable branch.
 *  - ERASING FROM A BIN (Necromantic Rebuke) takes the most recently binned
 *    cards; the printed text does not say who chooses, and the engine has no
 *    bin-card decision primitive.
 *
 * ⚠ TRANSCRIPTION NOTES (report, do not silently "fix"):
 *  - Necromantic Rebuke prints "[Erase X cards from your bin] Negate up to one
 *    target effect unless its controller erases X cards from their bin" while
 *    its printed cost is a flat `dd`/[2] — nothing on the card ties X to a
 *    mana payment, so X is read as "however many cards you choose to erase"
 *    and is picked at RESOLUTION (the engine's CastCost only knows how to
 *    sacrifice a unit, so a real cast-time [cost] is not expressible). With
 *    X = 0 the ransom is trivially met and the negate never happens; the card
 *    may well be meant to be an X-cost spell.
 *  - Legion of the Depths prints "gain 2 Rot" with no subject; read as its
 *    controller gaining it (the drawback half of a free 8-mana 0/8).
 *  - Dropslime's cost line extracts as `{ cost: '', mana: 1 }` with no timing
 *    marker, while AlgomancyCards/light-and-dark-transcription-notes.json says
 *    the printed line has "its own dark pip". Two consequences: the pip is
 *    missing from printed.json, and with no {Battle} marker the mode is
 *    DEPLOYMENT timing — where the per-battle trash ledger is 0, so playing
 *    Dropslime through its own cost line can never deal damage. Either the
 *    marker was lost in transcription or the card only works when something
 *    else trashes it mid-battle. Not "fixed" here.
 *
 * PARKED:
 *  - Writhing Host ("If I am in your bin, you may play a unit as if it had
 *    [Haste] by erasing me as an additional cost to play that unit") needs
 *    (a) play-timing gating from the BIN and (b) an arbitrary additional cost
 *    on ANOTHER card's play action — both live in apply.ts/legalActions, out
 *    of card code's reach (the Dispatch Courier precedent). Registered as a
 *    plain 3/1 body so it enters DECK_LIST and never crashes.
 */
import type { CardName, EngineEvent, Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, type EffectCtx, type EffectDef } from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

const isEnt = (t: unknown): t is Entity => !!t && typeof t === 'object' && 'id' in t;

/** a card that enters play as a UNIT — a spell unit spawns its body too, so
 * it counts for every bin search (the convention shared by batch-dark-a/c and
 * batch-hybrids-ld-a/b). */
const isUnitCard = (name: CardName): boolean => {
  const k = getCard(name).kind;
  return k === 'unit' || k === 'spellUnit';
};

/** R25: "each player" = the seats present in the effect's region, in
 * initiative order so the log and replay are deterministic. */
const presentSeats = (g: E, region: number): Seat[] => {
  const present = g.s.regions[region]!.presentSeats;
  return [g.initiative, g.nit].filter(s => present.includes(s));
};

/** printed mana of a card name; an X cost counts as 0. */
const manaOf = (name: CardName): number => {
  const m = getCard(name).mana;
  return typeof m === 'number' ? m : 0;
};

/** `chooser` picks one of `pool` (auto when forced); null on an empty pool.
 * Plan-then-commit: callers gather every pick before mutating, because the
 * engine rolls back to the part boundary and replays on suspension. */
const pickUnit = (
  ctx: EffectCtx, key: string, chooser: Seat, pool: Entity[], prompt: string,
): EntityId | null => {
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0]!.id;
  return ctx.choose(key, {
    kind: 'electricPath', seat: chooser, prompt,
    options: pool.map(u => ({ label: u.card, value: u.id, card: u.card })),
  }) as EntityId;
};

/** `seat` discards a card of their own choosing (R40: discarding trashes). */
function discardOne(g: E, ctx: EffectCtx, seat: Seat, source: string, key: string): void {
  const hand = g.player(seat).hand;
  if (!hand.length) { g.ev('info', `${source}: ${g.pname(seat)} has nothing to discard.`); return; }
  const i = hand.length === 1 ? 0 : ctx.choose(key, {
    kind: 'payOrDecline', seat,
    prompt: `${source}: discard a card`,
    options: hand.map((name, idx) => ({ label: name, value: idx, card: name })),
  }) as number;
  g.discardFromHand(seat, i);
}

/** remove an id from every formation column / the sent-attacker list (mirror
 * of the engine's private removeFromFormation) */
function unslot(g: E, id: EntityId): void {
  const b = g.s.battle;
  if (!b) return;
  for (const col of [...b.columns, ...Object.values(b.blocks)]) {
    const i = col.indexOf(id);
    if (i !== -1) col.splice(i, 1);
  }
  const si = b.sentAttackers.indexOf(id);
  if (si !== -1) b.sentAttackers.splice(si, 1);
}

/**
 * "When I deal combat damage" — the Flowstone Arcanite column approximation
 * (⚠ header). True when the event is combat damage my column dealt:
 *  - 'damage' with no `source` tag whose victim sits in the column directly
 *    opposing mine (combat damage is pairwise);
 *  - 'countersChanged' during a combat sub-step on such a victim — the
 *    {Poisonous} channel, where damage is replaced by -1/-1 counters;
 *  - 'lifeLost' why 'combat' where my column connects to the victim
 *    (attacking unblocked/Piercing, or blocking with Piercing).
 * A column I contribute no power to deals nothing, so it never counts.
 */
function myColumnDealtCombatDamage(g: E, self: Entity, ev: EngineEvent): boolean {
  const b = g.s.battle;
  if (!b) return false;
  const col = g.columnOf(self.id);
  if (!col) return false;
  if (g.effStats(self)[0] <= 0) return false;
  const alive = col.filter(id => g.entity(id));
  const ci = b.columns.indexOf(col);
  if (ev.type === 'damage' || ev.type === 'countersChanged') {
    if (ev.type === 'damage' && ev.data?.['source'] !== undefined) return false;   // effect damage
    if (ev.type === 'countersChanged'
      && (!b.damageStep || ((ev.data?.['n'] as number | undefined) ?? 0) >= 0)) return false;
    const uid = ev.data?.['unit'] as EntityId | undefined;
    if (uid === undefined) return false;
    if (ci !== -1) return !!b.blocks[ci]?.includes(uid);          // attacking: hit my blockers
    const entry = Object.entries(b.blocks).find(([, c]) => c === col);
    return !!entry && !!b.columns[Number(entry[0])]?.includes(uid);   // blocking: hit the attackers
  }
  if (ev.type !== 'lifeLost') return false;
  if (ev.data?.['why'] !== 'combat' || ev.data?.['seat'] === self.controller) return false;
  if (ci !== -1) {
    return ev.data?.['seat'] === b.defender
      && (b.blocks[ci] === undefined || g.colAttrs(alive).has('Piercing'));
  }
  return ev.data?.['seat'] === b.attacker && g.colAttrs(alive).has('Piercing');
}

/** every unit in a column that connected with `victim` this combat (⚠ header:
 * face damage cannot be attributed to one unit inside a column) */
function unitsThatHit(g: E, victim: Seat): Entity[] {
  const b = g.s.battle;
  if (!b) return [];
  const out: Entity[] = [];
  const live = (ids: EntityId[]): Entity[] =>
    ids.map(id => g.entity(id)).filter((u): u is Entity => !!u);
  if (victim === b.defender) {
    b.columns.forEach((col, ci) => {
      const alive = live(col);
      if (!alive.length) return;
      if (b.blocks[ci] === undefined || g.colAttrs(col).has('Piercing')) out.push(...alive);
    });
  } else if (victim === b.attacker) {
    for (const col of Object.values(b.blocks)) {
      const alive = live(col);
      if (alive.length && g.colAttrs(col).has('Piercing')) out.push(...alive);
    }
  }
  return out;
}

// ───────────────────────────── the cards ──────────────────────────────

// "(Poisonous sources damage units in the form of -1/-1 counters.) When I deal
// combat damage or die, [Switch1] Each opponent gains 1 rot." — d/4 4/3
// {Poisonous} Blight Zombie Unit. One bounded ability covers both causes: the
// death half checks the event's unit against me (an explicit `self` flag would
// also gate the combat-damage half, which is not self-sourced), the combat
// half is the column approximation (⚠ header). "Each opponent" is region
// scoped (R25); the rot lands at resolution (R1).
const blightmoundRot: EffectDef = {
  run: (g, ctx) => {
    for (const s of presentSeats(g, ctx.region)) {
      if (s !== ctx.controller) g.gainRot(s, 1);
    }
  },
};
card('Blightmound', {
  abilities: [{
    type: 'triggered', events: ['damage', 'countersChanged', 'lifeLost', 'died'],
    bounded: true, graftCause: true,
    label: 'each opponent gains 1 rot',
    when: (g, self, ev) => ev.type === 'died'
      ? ev.data?.['unit'] === self.id
      : myColumnDealtCombatDamage(g, self, ev),
    effect: blightmoundRot,
  }],
  graftEffect: { bounded: true, effect: blightmoundRot },
});

// "[Augment] Whenever another card is trashed, each other unit gains -1/-1
// until regroup." — d/5 3/3 Alien Unit. R40: an `events: ['trashed']` ability
// WITHOUT `self` is exactly "when another card is trashed" — it belongs to a
// unit in play and the normal region-scoped scan dispatches it, which also
// excludes the source itself for free (a card being trashed is in a bin, not
// in play). "Each other unit" is every unit in the region but me, both sides;
// "until regroup" is a temp stat change (R11 step 3), and a unit shrunk to 0
// toughness dies on the state check.
card('Cerebrox', {
  augmentText: [{
    type: 'triggered', events: ['trashed'],
    label: 'each other unit gains -1/-1 until regroup',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        for (const u of g.unitsIn(ctx.region)) {
          if (self && u.id === self.id) continue;
          g.addTemp(u, -1, -1);
        }
        g.checkDeaths();
      },
    },
  }],
});

// "Whenever a player trashes a card, each opponent loses 1 life. [Augment]
// After combat, each player discards a card." — ddd/4 2/5 Polyform Unit.
// First line: a plain ability (stays with the card), any player's trash, mine
// included. Second line: text-box [Augment] — live when played normally
// (Manual Q&A), donated on augment. Each player picks their own discard, and
// all picks are gathered before any of them commits (R6 plan-then-commit).
card('Cthyrian Culler', {
  abilities: [{
    type: 'triggered', events: ['trashed'],
    label: 'each opponent loses 1 life',
    effect: {
      run: (g, ctx) => {
        for (const s of presentSeats(g, ctx.region)) {
          if (s !== ctx.controller) g.loseLife(s, 1, 'Cthyrian Culler');
        }
      },
    },
  }],
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'each player discards a card',
    effect: {
      run: (g, ctx) => {
        const seats = presentSeats(g, ctx.region);
        const picks: [Seat, number][] = [];
        for (const s of seats) {
          const hand = g.player(s).hand;
          if (!hand.length) continue;
          const i = hand.length === 1 ? 0 : ctx.choose(`cull:${s}`, {
            kind: 'payOrDecline', seat: s,
            prompt: 'Cthyrian Culler: discard a card',
            options: hand.map((name, idx) => ({ label: name, value: idx, card: name })),
          }) as number;
          picks.push([s, i]);
        }
        for (const [s, i] of picks) g.discardFromHand(s, i);   // one each: indices stay valid
      },
    },
  }],
});

// "1 Discard me / When I am trashed, [Switch1] I deal damage equal to the
// number of cards trashed in this battle to any target." — d/2 1/1 Blight
// Unit. The discard-me play mode is entirely engine-side (printed.discardMe,
// R40); this scripts only the trigger, which fires FROM THE BIN however the
// card got there (discard, mill, sacrifice, death). ⚠ the printed cost line
// carries no {Battle} marker, so that mode inherits the card's own DEPLOYMENT
// timing — and the trash ledger is battle-scoped, so discarding it yourself
// always counts 0. See the transcription note in the header.
// ⚠ ctx.sourceId resolves to
// nothing in a trash trigger, so nothing here reads it. The count is the
// engine's per-battle trash ledger (bumped BEFORE the trigger fires, so my own
// trash is included) and is read at resolution (R1); outside battle the ledger
// is 0 by design, so "in this battle" means during one.
const dropslimeZap: EffectDef = {
  targets: { what: 'any', prompt: 'Dropslime: deal damage equal to the cards trashed in this battle to any target' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!t) return;
    const n = g.battleCounter(ctx.region, 'trashed');
    if (n <= 0) { g.ev('info', 'Dropslime: nothing has been trashed in this battle — no damage.'); return; }
    g.dealEffectDamage(ctx, t, n);
  },
};
card('Dropslime', {
  abilities: [{
    type: 'triggered', events: ['trashed'], self: true, bounded: true, graftCause: true,
    label: 'I deal damage equal to the cards trashed in this battle to any target',
    effect: dropslimeZap,
  }],
  graftEffect: { bounded: true, effect: dropslimeZap },
});

// "[Switch1] Target player gains a rot." — d/1 {Battle} Blight Spell. The
// whole spell is the [Switch1]-marked graft effect. "Target player" uses the
// 'any' spec (the engine has no player-only scope — the Bripp precedent); a
// unit target is a printed impossibility and no-ops.
const festerRot: EffectDef = {
  targets: { what: 'any', prompt: 'Fester: target player gains a rot' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (t && 'player' in (t as object)) g.gainRot((t as { player: Seat }).player, 1);
    else g.ev('info', 'Fester: only a player can gain rot — no effect.');
  },
};
card('Fester', {
  spellEffect: festerRot,
  graftEffect: { bounded: true, effect: festerRot },
});

// "For each [3] spent to play me, each player sacrifices a unit. Draw a card
// for each nontoken unit you sacrifice this way." — dd/X {Battle} Blight
// Spell. X is chosen and paid AT CAST (R35) and arrives as ctx.x; the number
// of rounds is floor(X / 3) — no xMin, since spending less than [3] is legal
// and simply does nothing. Each round every present player (R25) picks one of
// their own units, in initiative order; every pick is gathered before anything
// dies (R6 plan-then-commit), with earlier picks excluded from later pools.
// The draws count MY sacrifices only, and only nontoken ones.
card('Grim Bargain', {
  spellEffect: {
    run: (g, ctx) => {
      const rounds = Math.floor((ctx.x ?? 0) / 3);
      if (rounds <= 0) { g.ev('info', 'Grim Bargain: less than [3] spent — nothing is sacrificed.'); return; }
      const seats = presentSeats(g, ctx.region);
      const planned: EntityId[] = [];
      for (let r = 0; r < rounds; r++) {
        for (const s of seats) {
          const pool = g.unitsOf(s, ctx.region).filter(u => !planned.includes(u.id));
          const id = pickUnit(ctx, `gb:${r}:${s}`, s, pool,
            `Grim Bargain: sacrifice a unit (${r + 1} of ${rounds})`);
          if (id !== null) planned.push(id);
        }
      }
      let draws = 0;
      for (const id of planned) {
        const u = g.entity(id);
        if (!u) continue;
        if (u.controller === ctx.controller && !u.token) draws++;
        g.destroy(u, 'is sacrificed');
      }
      if (draws > 0) {
        g.ev('info', `Grim Bargain: ${g.pname(ctx.controller)} draws ${draws}.`);
        g.draw(ctx.controller, draws);
      }
    },
  },
});

// "[Augment] When I attack, you may exchange me for target unit in your bin
// with cost 3 or less." — d/1 1/1 Occult Hooba Unit. Text-box [Augment]: live
// when played normally, donated on augment ("me" = the host). The bin is not a
// targetable zone, so the pick is a resolution-time ctx.choose over the
// eligible unit cards in the controller's bin (⚠ slightly stronger than
// printed: it cannot be responded to). The exchange keeps the formation slot,
// exactly like an Ambush swap, but sends the outgoing unit to its owner's BIN
// — from play, so it is trashed (R40) — without dying (⚠ header).
function exchangeInPlace(g: E, self: Entity, name: CardName, controller: Seat): void {
  const b = g.s.battle;
  let slot: { col: EntityId[]; idx: number } | null = null;
  if (b) {
    for (const col of [...b.columns, ...Object.values(b.blocks)]) {
      const idx = col.indexOf(self.id);
      if (idx !== -1) { slot = { col, idx }; break; }
    }
  }
  const fresh = g.spawnUnit(controller, name, self.region);
  if (slot) slot.col[slot.idx] = fresh.id;   // take the exact position in play
  for (const modId of self.mods) delete g.s.entities[modId];   // mods are erased with it
  delete g.s.entities[self.id];
  unslot(g, self.id);
  g.ev('despawned', `${self.card} is exchanged for ${name}.`,
    { unit: self.id, card: self.card, seat: self.controller, region: self.region });
  if (!self.token) {
    g.player(self.owner).bin.push(self.card);
    g.noteTrashed(self.owner, self.card, 'play');   // R40: a bin, from play
  }
}
card('Hooba-Mon', {
  augmentText: [{
    type: 'triggered', events: ['attacked'], self: true,
    label: 'you may exchange me for a unit in your bin with cost 3 or less',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self) return;
        const bin = g.player(ctx.controller).bin;
        const opts = bin
          .map((name, i) => ({ name, i }))
          // a SPELL UNIT is a unit for bin purposes too (it spawns its body) —
          // the convention every other bin search in the expansion uses
          .filter(o => isUnitCard(o.name) && manaOf(o.name) <= 3);
        if (!opts.length) { g.ev('info', 'Hooba-Mon: no unit with cost 3 or less in your bin.'); return; }
        const pick = ctx.choose('hooba', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Hooba-Mon: exchange ${self.card} for a unit in your bin with cost 3 or less?`,
          options: [
            ...opts.map(o => ({ label: o.name, value: o.i, card: o.name })),
            { label: 'decline', value: -1 },
          ],
        }) as number;
        if (pick < 0) return;
        const name = bin[pick];
        if (name === undefined) return;
        bin.splice(pick, 1);
        exchangeInPlace(g, self, name, ctx.controller);
      },
    },
  }],
});

// "[Augment] When I spawn, attack, block or die, create two Wraiths and gain
// 2 Rot." — ddd/8 0/8 Polyform Unit. Text-box [Augment]: live when played
// normally (so the spawn half fires on its own arrival), donated on augment
// ("I" = the host, which has already spawned — the fight/die halves still
// fire). R47: "create a Wraith" is E.createWraith, and Wraith/Wight are one
// token. R28: created units arrive in their controller's HOME region, even
// when the trigger fires mid-battle. ⚠ "gain 2 Rot" prints no subject — read
// as the controller (the drawback half of a free 8-mana body).
card('Legion of the Depths', {
  augmentText: [{
    type: 'triggered', events: ['spawned', 'attacked', 'blocked', 'died'], self: true,
    label: 'create two Wraiths and gain 2 rot',
    effect: {
      run: (g, ctx) => {
        const home = g.homeRegion(ctx.controller);   // R28
        g.createWraith(ctx.controller, home);
        g.createWraith(ctx.controller, home);
        g.gainRot(ctx.controller, 2);
      },
    },
  }],
});

// "When you trash a card during battle, [Switch1] Draw a card." — d/3 2/3
// Alien Unit. R40: no `self`, so this is the "another card is trashed" scan —
// narrowed at event time (R1) to trashes into MY bin ("you trash a card") and
// to the battle phase.
const muckDraw: EffectDef = {
  run: (g, ctx) => { g.draw(ctx.controller, 1); },
};
card('Muck Rummager', {
  abilities: [{
    type: 'triggered', events: ['trashed'], bounded: true, graftCause: true,
    label: 'draw a card',
    when: (g, self, ev) => g.s.phase === 'battle' && ev.data?.['seat'] === self.controller,
    effect: muckDraw,
  }],
  graftEffect: { bounded: true, effect: muckDraw },
});

// "[Erase X cards from your bin] Negate up to one target effect unless its
// controller erases X cards from their bin." — dd/2 {Battle} Blight Spell.
// ⚠ header: nothing on the card ties X to mana and the engine's CastCost only
// knows how to sacrifice a unit, so X is chosen at RESOLUTION out of the
// caster's own bin. "Up to one target" is min:0 (R5) — the cost is still paid
// with no target, exactly as printed. Both decisions are taken before anything
// is erased (R6 plan-then-commit). Erasing never touches a bin on the way out,
// so it is never a trash (R40).
function eraseFromBin(g: E, seat: Seat, n: number): void {
  for (let i = 0; i < n; i++) {
    const name = g.player(seat).bin.pop();   // ⚠ most recent first (header)
    if (name === undefined) return;
    g.ev('erased', `${name} is ERASED from ${g.pname(seat)}'s bin.`, { card: name, seat });
  }
}
card('Necromantic Rebuke', {
  spellEffect: {
    targets: { what: 'stackSpell', min: 0, prompt: 'Necromantic Rebuke: negate up to one target effect' },
    run: (g, ctx) => {
      const me = ctx.controller;
      const t = ctx.targets[0];
      const item = t && 'stack' in (t as object)
        ? g.s.stack.find(i => i.id === (t as { stack: number }).stack) : undefined;
      const mine = g.player(me).bin.length;
      const xOpts: { label: string; value: number }[] = [];
      for (let x = 0; x <= mine; x++) xOpts.push({ label: `erase ${x}`, value: x });
      const x = mine === 0 ? 0 : ctx.choose('nrX', {
        kind: 'payOrDecline', seat: me,
        prompt: 'Necromantic Rebuke: erase how many cards from your bin? (X)',
        options: xOpts,
      }) as number;
      let ransomed = false;
      if (item && !item.negated) {
        const them = item.controller;
        const theirBin = g.player(them).bin.length;
        if (x === 0) ransomed = true;                 // ⚠ nothing to erase: trivially met
        else if (theirBin >= x) {
          ransomed = ctx.choose('nrPay', {
            kind: 'payOrDecline', seat: them,
            prompt: `Necromantic Rebuke: erase ${x} cards from your bin to save ${item.label}?`,
            options: [{ label: `erase ${x}`, value: 1 }, { label: `let it be negated`, value: 0 }],
          }) as number === 1;
        }
      }
      eraseFromBin(g, me, x);                          // the cost
      if (!item || item.negated) return;
      if (ransomed) {
        eraseFromBin(g, item.controller, x);
        g.ev('info', `${g.pname(item.controller)} erases ${x} — ${item.label} survives.`);
      } else {
        g.negate(item.id);
      }
    },
  },
});

// "When I attack or block, [Switch1] Discard a card." — d/1 3/4 {Flying} Alien
// Anima Unit. A plain (non-[Augment]) ability, so it stays with the card; the
// [Switch1] half is what a graft donates. Discarding is trashing (R40), which
// is the whole point of a 1-mana 3/4 in a trash deck.
const palewingDiscard: EffectDef = {
  run: (g, ctx) => { discardOne(g, ctx, ctx.controller, 'Palewing', 'pw'); },
};
card('Palewing', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    bounded: true, graftCause: true,
    label: 'discard a card',
    effect: palewingDiscard,
  }],
  graftEffect: { bounded: true, effect: palewingDiscard },
});

// "[Switch1] Each player discards a card, gains a rot and Augments a Wraith on
// one of their units." — dd/1 {Battle} Blight Spell. Symmetrical, so every
// present player (R25) makes their own two choices, in initiative order, and
// all of them are gathered before anything commits (R6 plan-then-commit).
// R47: "Augment a Wraith on a unit" is E.augmentWraith — the same token as
// "create a Wraith", applied rather than spawned. A player with no units in
// the region simply skips that clause.
const plagueRitual: EffectDef = {
  run: (g, ctx) => {
    const plan: { seat: Seat; discard: number | null; host: EntityId | null }[] = [];
    for (const s of presentSeats(g, ctx.region)) {
      const hand = g.player(s).hand;
      const discard = !hand.length ? null : (hand.length === 1 ? 0 : ctx.choose(`pr:d:${s}`, {
        kind: 'payOrDecline', seat: s,
        prompt: 'Plague Ritual: discard a card',
        options: hand.map((name, idx) => ({ label: name, value: idx, card: name })),
      }) as number);
      const host = pickUnit(ctx, `pr:w:${s}`, s, g.unitsOf(s, ctx.region),
        'Plague Ritual: augment a Wraith onto one of your units');
      plan.push({ seat: s, discard, host });
    }
    for (const p of plan) {
      if (p.discard !== null) g.discardFromHand(p.seat, p.discard);
      g.gainRot(p.seat, 1);
      const host = p.host !== null ? g.entity(p.host) : undefined;
      if (host) g.augmentWraith(host, p.seat);
      else if (p.host !== null) g.ev('info', 'Plague Ritual: the chosen unit is gone — no Wraith.');
    }
  },
};
card('Plague Ritual', {
  spellEffect: plagueRitual,
  graftEffect: { bounded: true, effect: plagueRitual },
});

// "[Augment] After combat, move all my other Augments onto one or more
// enemies." — dd/2 1/4 {Virus} Blight Unit. Text-box [Augment]: live when
// played normally, donated on augment ("my" = the host). "My other Augments"
// excludes the mod carrying this very text, identified by card name. ⚠ header:
// mods are re-parented by hand and no 'modApplied' fires — moving is not
// applying. Every destination is picked before anything moves (R6).
card('Rotbeast', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'move all my other Augments onto one or more enemies',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self) return;
        const movable = self.mods
          .map(id => g.entity(id))
          .filter((m): m is Entity => !!m && m.appliedAs === 'augment' && m.card !== 'Rotbeast');
        if (!movable.length) return;
        const enemies = g.unitsIn(ctx.region).filter(u => u.controller !== self.controller);
        if (!enemies.length) { g.ev('info', 'Rotbeast: no enemy to move my augments onto.'); return; }
        const picks: [EntityId, EntityId][] = [];
        for (const m of movable) {
          const to = pickUnit(ctx, `rb:${m.id}`, ctx.controller, enemies,
            `Rotbeast: move ${m.card} onto which enemy?`);
          if (to !== null) picks.push([m.id, to]);
        }
        for (const [modId, hostId] of picks) {
          const mod = g.entity(modId);
          const host = g.entity(hostId);
          if (!mod || !host) continue;
          const i = self.mods.indexOf(modId);
          if (i !== -1) self.mods.splice(i, 1);
          mod.modOf = host.id;
          mod.region = host.region;
          mod.controller = host.controller;
          host.mods.push(mod.id);
          g.ev('info', `Rotbeast moves ${mod.card} from ${self.card} onto ${host.card}.`);
        }
        g.checkDeaths();
      },
    },
  }],
});

// "[Augment] Whenever a unit deals combat damage to a player, remove all
// counters from it." — d/3 2/4 {Virus} Alien Unit. Unowned wording: BOTH
// sides' units are stripped, whoever is hit. ⚠ header: the engine deals
// combat damage per column, so "it" is every unit in a column that connected
// with the damaged player. Counters are net (+1/+1 and -1/-1 cancel), so
// "remove all" is a single cancelling delta.
card('Sarcophage', {
  augmentText: [{
    type: 'triggered', events: ['lifeLost'],
    label: 'remove all counters from the units that dealt that combat damage',
    when: (_g, _self, ev) => ev.data?.['why'] === 'combat',
    effect: {
      run: (g, ctx) => {
        const victim = ctx.event?.data?.['seat'] as Seat | undefined;
        if (victim === undefined) return;
        for (const u of unitsThatHit(g, victim)) {
          if (u.counters !== 0) g.addCounters(u, -u.counters);
        }
      },
    },
  }],
});

// "When I spawn, gain a rot. [Augment] If rot would deal damage to you,
// instead put that many +1/+1 counters on me." — d/1 1/1 Blight Unit. The
// first sentence is a plain ability; the second is R38's one replacement hook,
// declared in the behavior and asked by E.rotDamage() at the start of
// deployment. The engine anchors it on the HOST when the text arrives via an
// augment, so "counters on me" lands correctly either way — but the printed
// [Augment] grants no attributes and has no transferable ability list, so the
// card needs `augmentable` to be applicable as an augment at all.
card('Skittering Blight', {
  augmentable: true,
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: 'gain a rot',
    effect: { run: (g, ctx) => { g.gainRot(ctx.controller, 1); } },
  }],
  replaceRotDamage: (g, self, _seat, amount) => {
    g.addCounters(self, amount);
    return true;
  },
});

// "Look at target player's hand and discard a card from it. You gain 1 rot." —
// dd/1 {Battle} Blight Spell. Player target via the 'any' spec (the Bripp
// precedent); the caster picks the discard. The rot is a separate sentence and
// happens whatever the target turned out to be.
card('Thought Extraction', {
  spellEffect: {
    targets: { what: 'any', prompt: "Thought Extraction: look at target player's hand and discard a card from it" },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (t && 'player' in (t as object)) {
        const who = (t as { player: Seat }).player;
        const hand = g.player(who).hand;
        g.ev('info', `Thought Extraction reveals ${g.pname(who)}'s hand: ${hand.join(', ') || '(empty)'}.`);
        if (who !== ctx.controller) g.revealHandTo(ctx.controller, who);
        if (hand.length) {
          const i = hand.length === 1 ? 0 : ctx.choose('te', {
            kind: 'payOrDecline', seat: ctx.controller,
            prompt: `Thought Extraction: discard a card from ${g.pname(who)}'s hand`,
            options: hand.map((name, idx) => ({ label: name, value: idx, card: name })),
          }) as number;
          g.discardFromHand(who, i);
        }
      } else {
        g.ev('info', 'Thought Extraction: only a player has a hand to look at.');
      }
      g.gainRot(ctx.controller, 1);
    },
  },
});

// "(When an afflicting source kills one or more units, those units'
// controllers gain a rot.) Put two -1/-1 counters on target unit." — d/1
// {Battle} {Afflicting} Blight Spell. {Afflicting} is engine-side (R48: the
// resolution-time diff catches -1/-1 counter kills, which is the only way this
// card kills anything), so the behaviour is just the counters.
card('Umbral Decay', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Umbral Decay: put two -1/-1 counters on target unit' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (isEnt(t) && g.entity(t.id)) g.addCounters(t, -2);
    },
  },
});

// "If I am in your bin, you may play a unit as if it had [Haste] by erasing me
// as an additional cost to play that unit." — d/1 3/1 Horror Unit. PARKED
// (header): granting haste timing to ANOTHER card, plus an arbitrary
// additional cost on that other card's play action, both live in
// apply.ts/legalActions and cannot be reached from card code (the Dispatch
// Courier precedent). Registered as its printed body so it enters DECK_LIST,
// plays normally and never crashes.
card('Writhing Host', {});
