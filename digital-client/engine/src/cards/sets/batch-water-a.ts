/* batch-water-a — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Cards are scripted here from printed.json data (never
 * hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fizzle vs partial), R6 (mid-resolution payments via ctx.choose),
 * R9 (bounded budgets per card), R12 (regions exclusive — listeners are
 * region-scoped), R14 ("this battle" counters are per region-battle),
 * R22 (ambush details).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - GLIMPSE (Celestial Purge / Oracle of Foretelling / Premonition): the
 *    engine has no cache zone or "play ignoring affinity until end of turn"
 *    machinery. Approximated as: reveal top N (info event), the glimpsing
 *    player CHOOSES one via ctx.choose, it goes to their HAND, the rest are
 *    recycled to the bottom. Slightly stronger (kept past end of turn),
 *    slightly weaker (playing it needs affinity).
 *  - LIFE-LOST-THIS-BATTLE tracking (Echo of Despair / Null Drone): the
 *    engine does not record per-battle life loss. A synchronous bookkeeping
 *    hook (a `when()` that always returns false, shared by Echo of Despair
 *    and Null Drone units) accumulates lifeLost amounts into battleCounters
 *    (`wa:lifeLost:<seat>`, per region, R14) at event time, deduped per
 *    event. Fidelity limit: life loss is only recorded while such a unit is
 *    in play in the battle region.
 *
 * PARKED (needs engine primitives that do not exist; subsets implemented):
 *  - Dreadspawn Horror: "[Augment] I gain -1/-1 for each card in your hand"
 *    is a CONTINUOUS stat modifier; effStats() has no card-text hook (layers
 *    5/6 are seamed but not scriptable). Registered so it plays as a 7/5
 *    Virus augment; the static does nothing.
 *  - Galerider Eel: (a) card draws never reach triggers — E.draw() emits a
 *    'draw' event but never fireEvent()s it, so "cards enter your hand"
 *    only sees battle RECALLS ('despawned' to hand); (b) "gains flying
 *    until regroup" needs a temporary-attribute primitive (Entity has only
 *    tempPower/tempToughness). Subset: +4/+4 on a recall-to-my-hand.
 *  - Protective Adaptations: "gains piercing until regroup" — same missing
 *    temp-attr primitive. Subset: the +1/+1 works.
 *  - Lurking Slimebeast: printed.json has NO ambush field for it — the
 *    extractor does not parse the word-form "[three_blue]" cost (Mirage
 *    Walker's "[4bb]" parses fine). printed.json is not this batch's to
 *    edit. Registered as a plain 8/3 deploy unit; the Ambush mode is dead
 *    until the extractor learns word-form costs.
 *  - Amphivore: "trigger three copies as one single trigger" is composed in
 *    card code: unbounded, UNtargeted graft effects are re-run twice by the
 *    base part (3 copies total); bounded grafts correctly run once ([Switch1]
 *    budget, R9). Extra copies of TARGETED graft effects can't collect extra
 *    targets (composeParts collects one set per part) — those run once.
 *  - Null Drone: full fidelity needs engine-level life-loss tracking (see
 *    above) — with no tracker unit present it sees 0 life lost and negates
 *    nothing.
 */
import type { Entity, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, type Ability, type EffectCtx, type EffectDef } from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

const isEnt = (t: unknown): t is Entity => !!t && typeof t === 'object' && 'id' in t;

/** Glimpse N for a seat — ⚠ approximation, see the header note. */
function glimpse(g: E, ctx: EffectCtx, seat: Seat, n: number): void {
  const count = Math.min(n, g.s.sharedDeck.length);
  if (count <= 0) return;
  const top = g.s.sharedDeck.slice(0, count);
  g.ev('info', `${g.pname(seat)} Glimpses ${count}: ${top.join(', ')}.`);
  const pick = ctx.choose('glimpse', {
    kind: 'payOrDecline', seat,
    prompt: `Glimpse ${count}: choose a card to cache (engine: it goes to your hand)`,
    options: top.map((name, i) => ({ label: name, value: i })),
  }) as number;
  g.s.sharedDeck.splice(0, count);
  const keptIdx = top[pick] !== undefined ? pick : 0;
  const kept = top[keptIdx]!;
  g.player(seat).hand.push(kept);
  top.forEach((name, i) => { if (i !== keptIdx) g.recycleToBottom(name); });
  g.ev('info', `${g.pname(seat)} caches ${kept} and recycles the rest.`);
}

/** ⚠ Synchronous bookkeeping hook (see header): accumulates life lost per
 * seat per region-battle into battleCounters. The when() mutates counters at
 * event time and always returns false, so no trigger ever queues. Deduped
 * per event via a data flag (several carrier units, one bump). */
const lifeLostTracker: Ability = {
  type: 'triggered', events: ['lifeLost'],
  label: '(bookkeeping) track life lost this battle',
  when: (g, _self, ev) => {
    const d = ev.data;
    if (d && typeof d.region === 'number' && typeof d.seat === 'number'
      && typeof d.n === 'number' && !d['waLLTracked']) {
      d['waLLTracked'] = true;
      const c = g.s.battleCounters[d.region] ?? (g.s.battleCounters[d.region] = {});
      const key = `wa:lifeLost:${d.seat}`;
      c[key] = (c[key] ?? 0) + d.n;
    }
    return false;
  },
  effect: { run: () => { /* never queues */ } },
};

const lifeLostThisBattle = (g: E, region: number, seat: Seat): number =>
  g.s.battleCounters[region]?.[`wa:lifeLost:${seat}`] ?? 0;

// ───────────────────────────── the cards ──────────────────────────────

// "When my column deals combat damage to an opponent, [Switch1][Switch1]
// [Switch1] (Trigger three copies of this graft ability as one single
// trigger)." — b/4 2/5 Frog Beast Unit. The cause is bounded (once/turn, R9)
// and provides THREE cause copies in one trigger: composeParts contributes
// each graft once; the base part re-runs unbounded UNtargeted grafts twice
// more (3 copies); bounded grafts stay at one ([Switch1] budget). ⚠ approx:
// "my column deals combat damage to an opponent" is read off the aggregated
// combat lifeLost event — my column counts as connecting if it is attacking
// unblocked, or blocked/blocking with Piercing.
const amphivoreEcho: EffectDef = {
  run: (g, ctx) => {
    const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
    if (!self) return;
    for (const modId of self.mods) {
      const mod = g.entity(modId);
      if (!mod || mod.appliedAs !== 'graft' || mod.card === 'Amphivore') continue;
      const gr = getCard(mod.card).graftEffect;
      if (!gr || gr.bounded || gr.effect.targets) continue;   // see PARKED note
      gr.effect.run(g, { ...ctx, sourceName: mod.card });     // copies 2 and 3
      gr.effect.run(g, { ...ctx, sourceName: mod.card });
    }
  },
};
card('Amphivore', {
  abilities: [{
    type: 'triggered', events: ['lifeLost'], bounded: true, graftCause: true,
    label: 'trigger three copies of the grafted abilities (one single trigger)',
    when: (g, self, ev) => {
      if (g.s.phase !== 'battle' || ev.data?.why !== 'combat' || ev.data?.seat === self.controller) return false;
      const b = g.s.battle;
      if (!b) return false;
      const atkCi = b.columns.findIndex(col => col.includes(self.id));
      if (atkCi !== -1) {
        const alive = b.columns[atkCi]!.filter(id => g.entity(id));
        return b.blocks[atkCi] === undefined || g.colAttrs(alive).has('Piercing');
      }
      const blkCol = Object.values(b.blocks).find(col => col.includes(self.id));
      return !!blkCol && g.colAttrs(blkCol.filter(id => g.entity(id))).has('Piercing');
    },
    effect: amphivoreEcho,
  }],
  // grafted elsewhere, Amphivore contributes its tripling to the host's cause
  graftEffect: { bounded: true, effect: amphivoreEcho },
});

// "[Switch1] Look at target player's hand. You may choose a card from it and
// recycle that card. If you do, that player draws a card." — bb/3 4/2
// {Battle} {Feeble} Spell Unit. Target is a player (spec 'any'; a unit target
// is a no-op — the text only targets players). The hand is revealed as an
// info event; the caster picks via ctx.choose (or declines).
const brippEffect: EffectDef = {
  targets: { what: 'any', prompt: "Bripp: look at target player's hand" },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!t || !('player' in (t as object))) return;
    const who = (t as { player: Seat }).player;
    const hand = g.player(who).hand;
    g.ev('info', `Bripp reveals ${g.pname(who)}'s hand: ${hand.join(', ') || '(empty)'}.`);
    if (!hand.length) return;
    const pick = ctx.choose('brippPick', {
      kind: 'payOrDecline', seat: ctx.controller,
      prompt: `Bripp: recycle a card from ${g.pname(who)}'s hand? (they then draw)`,
      options: [{ label: 'decline', value: -1 }, ...hand.map((name, i) => ({ label: name, value: i }))],
    }) as number;
    if (pick < 0 || hand[pick] === undefined) return;
    const [name] = hand.splice(pick, 1);
    g.recycleToBottom(name!);
    g.ev('info', `Bripp recycles ${name} from ${g.pname(who)}'s hand.`);
    g.draw(who, 1);
  },
};
card('Bripp', {
  spellEffect: brippEffect,
  graftEffect: { bounded: true, effect: brippEffect },
});

// "Erase target unit. Its controller Glimpses 3." — bb/1 {Battle} Cosmic
// Spell. Erase = remove from the game entirely: no bin, no died/despawned
// triggers; its mods are erased with it. Glimpse: ⚠ header approximation.
card('Celestial Purge', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Celestial Purge: erase target unit (its controller Glimpses 3)' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      const who = t.controller;
      for (const modId of t.mods) delete g.s.entities[modId];
      delete g.s.entities[t.id];
      const b = g.s.battle;
      if (b) {
        for (const col of [...b.columns, ...Object.values(b.blocks)]) {
          const i = col.indexOf(t.id);
          if (i !== -1) col.splice(i, 1);
        }
        const si = b.sentAttackers.indexOf(t.id);
        if (si !== -1) b.sentAttackers.splice(si, 1);
      }
      g.ev('erased', `${t.card} is ERASED (no bin, no death).`, { unit: t.id, card: t.card, seat: who });
      glimpse(g, ctx, who, 3);
    },
  },
});

// "Recall all other spell effects and spell units. (Negate them and put them
// into their controller's hands.)" — bb/2 {Battle} Cosmic Maelstrom Spell.
// All other stack items that are spell effects (spell / spellUnit / ambush /
// spellToken) leave the stack; real cards go to their controller's hand,
// spell tokens are erased. Triggered/activated abilities and viruses stay
// (they are not "spell effects").
card('Cosmic Reversal', {
  spellEffect: {
    run: (g, ctx) => {
      const recallKinds = new Set(['spell', 'spellUnit', 'spellToken', 'ambush']);
      const keep: typeof g.s.stack = [];
      for (const item of g.s.stack) {
        if (!recallKinds.has(item.kind)) { keep.push(item); continue; }
        if (item.kind === 'spellToken') {
          g.ev('info', `Cosmic Reversal recalls ${item.label} — token: erased.`);
        } else {
          g.player(item.controller).hand.push(item.card!);
          g.ev('info', `Cosmic Reversal recalls ${item.label} to ${g.pname(item.controller)}'s hand.`);
        }
      }
      g.s.stack = keep;
      void ctx;
    },
  },
});

// "[Augment] I gain -1/-1 for each card in your hand." — bb/2 7/5 Alien
// Horror {Virus} Unit. PARKED: a continuous stat modifier (see header) —
// effStats() has no card-text hook. The augmentText entry below never fires
// (no events); it exists so isAugment() is true and the Virus mode works.
card('Dreadspawn Horror', {
  augmentText: [{
    type: 'triggered', events: [],
    label: 'I gain -1/-1 for each card in your hand (PARKED: continuous modifier)',
    effect: { run: () => { /* PARKED — see batch header */ } },
  }],
});

// "[Augment] When I attack or block, you and target opponent each draw a
// card." — b/2 2/2 {Flying} Cloud Sprite Unit. Text-box [Augment]; live when
// played normally (Manual Q&A). Targeted trigger (spec 'any' — pick the
// opponent; a unit target degrades to "only you draw", R5 partial).
card('Dreamfloat Drifter', {
  augmentText: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: 'you and target opponent each draw a card',
    effect: {
      targets: { what: 'any', prompt: 'Dreamfloat Drifter: target opponent (you both draw)' },
      run: (g, ctx) => {
        g.draw(ctx.controller, 1);
        const t = ctx.targets[0];
        if (t && 'player' in (t as object) && (t as { player: Seat }).player !== ctx.controller) {
          g.draw((t as { player: Seat }).player, 1);
        }
      },
    },
  }],
});

// "After combat, if a player lost life in this battle, create a copy of me."
// — b/4 3/2 Mimic Horror Unit. The condition is checked at event time (R1)
// against the batch's life-loss counters (⚠ header approximation; R14:
// per-region battle scope). "Create" = a token copy (erased on leaving play,
// survives regroup); the copy carries the same abilities.
card('Echo of Despair', {
  abilities: [
    lifeLostTracker,
    {
      type: 'triggered', events: ['afterCombat'],
      label: 'create a copy of me (a player lost life this battle)',
      when: (g, _self, ev) => {
        const region = ev.data?.region as number | undefined;
        if (region === undefined) return false;
        return g.s.players.some(p => lifeLostThisBattle(g, region, p.seat) > 0);
      },
      effect: {
        run: (g, ctx) => {
          const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
          if (self) g.spawnUnit(ctx.controller, 'Echo of Despair', ctx.region, { token: true });
        },
      },
    },
  ],
});

// "Recall target unit in your bin. (Put it into your hand.)" — bb/4 4/2
// Fish Horror Spell Unit. Bin cards are not stack-targetable (TargetSpec has
// no bin scope) — the pick is a resolution-time ctx.choose over the unit
// cards in the caster's bin. Empty bin → the spell still resolves and the
// 4/2 spawns (nothing to recall).
card('Eldritch Reclaimer', {
  spellEffect: {
    run: (g, ctx) => {
      const bin = g.player(ctx.controller).bin;
      const options = bin
        .map((name, i) => ({ label: name, value: i }))
        .filter(o => { const k = getCard(o.label).kind; return k === 'unit' || k === 'spellUnit'; });
      if (!options.length) { g.ev('info', 'Eldritch Reclaimer: no unit in the bin.'); return; }
      const pick = ctx.choose('reclaim', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: 'Eldritch Reclaimer: recall a unit from your bin to your hand',
        options,
      }) as number;
      const name = bin[pick];
      if (name === undefined) return;
      bin.splice(pick, 1);
      g.player(ctx.controller).hand.push(name);
      g.ev('info', `${name} is recalled from ${g.pname(ctx.controller)}'s bin to their hand.`);
    },
  },
});

// "The controller of target enemy effect may pay [x]. If they do, you draw a
// card. Otherwise, negate that effect. X can't be zero." — b/X {Battle} Ice
// Spell. R6: the payment is a mid-resolution decision. ⚠ approximation: the
// engine has no X-at-cast collection for played cards (item.x is only set
// for spell tokens), so the caster picks X (1..their open mana) and pays it
// at RESOLUTION; with no open mana X can't be nonzero → no effect. If the
// target's controller cannot pay X, it is negated without a decision.
card('Frosted Denial', {
  spellEffect: {
    targets: { what: 'stackSpell', prompt: 'Frosted Denial: target enemy effect (its controller may pay X)' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) return;
      const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
      if (!item) return;
      if (item.controller === ctx.controller) { g.ev('info', 'Frosted Denial: not an enemy effect — no effect.'); return; }
      const me = ctx.controller;
      const myOpen = g.openMana(me);
      if (myOpen < 1) { g.ev('info', "Frosted Denial: X can't be zero and no mana is open — no effect."); return; }
      const xOpts = [];
      for (let x = 1; x <= myOpen; x++) xOpts.push({ label: `X = ${x}`, value: x });
      const x = ctx.choose('fdX', {
        kind: 'payOrDecline', seat: me,
        prompt: 'Frosted Denial: choose X (paid now — engine approximation)',
        options: xOpts,
      }) as number;
      const opp = item.controller;
      let paid = false;
      if (g.openMana(opp) >= x) {
        paid = ctx.choose('fdPay', {
          kind: 'payOrDecline', seat: opp,
          prompt: `Frosted Denial: pay ${x} to save ${item.label}? (else it is negated)`,
          options: [{ label: `pay ${x}`, value: 1 }, { label: 'decline', value: 0 }],
        }) as number === 1;
      }
      g.payMana(me, x);
      if (paid) {
        g.payMana(opp, x);
        g.ev('info', `${g.pname(opp)} pays ${x} — ${item.label} survives.`);
        g.draw(me, 1);
      } else {
        g.negate(item.id);
      }
    },
  },
});

// "Whenever one or more other cards enter your hand during battle, [Switch]
// I gain +4/+4 and flying until regroup." — bb/3 0/4 Eel Unit. PARKED
// subsets (see header): draws are invisible to triggers, so only battle
// RECALLS to my hand fire it; the flying grant needs a temp-attr primitive.
// The recalled card goes to its OWNER's hand — the event only carries the
// controller (≈ owner in this pool). Token recalls are erased, not handed:
// filtered on the event message (the data carries no token flag).
const galeriderSurge: EffectDef = {
  run: (g, ctx) => {
    const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
    if (self) g.addTemp(self, 4, 4);   // PARKED: "+ flying until regroup"
  },
};
card('Galerider Eel', {
  abilities: [{
    type: 'triggered', events: ['despawned'], graftCause: true,
    label: 'I gain +4/+4 (and flying — parked) until regroup',
    when: (g, self, ev) =>
      g.s.phase === 'battle' &&
      ev.data?.seat === self.controller &&
      ev.data?.unit !== self.id &&
      ev.msg.includes('hand'),
    effect: galeriderSurge,
  }],
  graftEffect: { bounded: false, effect: galeriderSurge },
});

// "[Augment] When I attack or block, you may play a unit from your hand into
// an open position in my formation. (You still pay the cost.)" — bb/2 2/2.
// Text-box [Augment], live when played normally. The unit is paid for
// (canPayCard/payCard), spawns into the battle region and slots into my own
// column if open, else the first open column on my side of the formation.
card('Hooba-Pon', {
  augmentText: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: 'you may play a unit from your hand into an open formation position',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        const b = g.s.battle;
        if (!self || !b) return;
        const grid = b.columns.some(col => col.includes(self.id))
          ? b.columns : Object.values(b.blocks);
        const myCol = grid.find(col => col.includes(self.id));
        const hasRoom = (col: number[]) => col.filter(id => g.entity(id)).length < 2;
        if (!grid.some(hasRoom)) return;   // no open position
        const seat = ctx.controller;
        const hand = g.player(seat).hand;
        const options = [{ label: 'decline', value: -1 }];
        hand.forEach((name, i) => {
          if (getCard(name).kind === 'unit' && g.canPayCard(seat, name)) {
            options.push({ label: name, value: i });
          }
        });
        if (options.length === 1) return;
        const pick = ctx.choose('hoobaPlay', {
          kind: 'payOrDecline', seat,
          prompt: 'Hooba-Pon: play a unit from your hand into an open position in my formation? (you pay its cost)',
          options,
        }) as number;
        const name = pick >= 0 ? hand[pick] : undefined;
        if (name === undefined) return;
        hand.splice(pick, 1);
        g.payCard(seat, name);
        const u = g.spawnUnit(seat, name, ctx.region);
        const col = (myCol && hasRoom(myCol)) ? myCol : grid.find(hasRoom);
        if (col) col.push(u.id);
      },
    },
  }],
});

// "Draw a card. [Switch1] Starting with you, players may play a unit from
// hand as if it were [Battle]. (The unit's costs still need to be paid.)"
// — b/1 {Battle} Bedlam Occult Spell. The [Switch1] sentence is the bounded
// graftable effect; each player in turn (caster first) may pay for and play
// one unit-kind card from hand, spawning into the effect's region.
const insidiousInvite: EffectDef = {
  run: (g, ctx) => {
    const seats: Seat[] = [ctx.controller, ...g.s.players.map(p => p.seat).filter(s => s !== ctx.controller)];
    for (const seat of seats) {
      const hand = g.player(seat).hand;
      const options = [{ label: 'decline', value: -1 }];
      hand.forEach((name, i) => {
        if (getCard(name).kind === 'unit' && g.canPayCard(seat, name)) {
          options.push({ label: name, value: i });
        }
      });
      if (options.length === 1) continue;
      const pick = ctx.choose(`invite:${seat}`, {
        kind: 'payOrDecline', seat,
        prompt: 'Insidious Invitation: play a unit from your hand as if it were [Battle]? (costs still paid)',
        options,
      }) as number;
      const name = pick >= 0 ? hand[pick] : undefined;
      if (name === undefined) continue;
      hand.splice(pick, 1);
      g.payCard(seat, name);
      g.spawnUnit(seat, name, ctx.region);
    }
  },
};
card('Insidious Invitation', {
  spellEffect: {
    run: (g, ctx) => {
      g.draw(ctx.controller, 1);
      insidiousInvite.run(g, ctx);
    },
  },
  graftEffect: { bounded: true, effect: insidiousInvite },
});

// "[Battle] Ambush [three_blue]" — bb/4 8/3 Slime Beast Unit. PARKED: the
// printed-data extractor does not parse the word-form "[three_blue]" ambush
// cost, so printed.json carries no ambush field and the engine's Ambush mode
// (R22) never offers it. Plays as a vanilla 8/3 deploy unit meanwhile.
card('Lurking Slimebeast', {});

// "When I attack, [Switch1] Recall up to one target unit with 5 or less
// defense." — bbb/4 5/3 Kraken Unit. Bounded graft cause (R9). ⚠ approx:
// TargetSpec cannot filter by stats or express "up to one" — candidates are
// all units; the "5 or less defense" gate is enforced at resolution (an
// over-tough pick is a no-op).
const krakenRecall: EffectDef = {
  targets: { what: 'unit', prompt: 'Minor Kraken: recall up to one target unit with 5 or less defense' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) return;
    const [, def] = g.effStats(t);
    if (def <= 5) g.recall(t);
    else g.ev('info', `Minor Kraken: ${t.card} has ${def} defense (> 5) — not recalled.`);
  },
};
card('Minor Kraken', {
  abilities: [{
    type: 'triggered', events: ['attacked'], self: true, bounded: true, graftCause: true,
    label: 'recall up to one target unit with 5 or less defense',
    effect: krakenRecall,
  }],
  graftEffect: { bounded: true, effect: krakenRecall },
});

// "[Battle] Ambush [4bb] … At the end of turn, if you took no actions during
// deployment, [Switch1] Create a 3/3 unit." — bb/3 2/4 Arcane Lizard Unit.
// The Ambush mode is engine-level (printed.ambush, R22). ⚠ approx: the
// engine keeps no per-seat deployment-action record; a bookkeeping when()
// (always false) marks a per-turn flag in my budgets when my controller
// takes a deployment action that fires spawned/spellPlayed/modApplied
// (playCard, castSpellToken, augment, graft — pure activations with silent
// effects can slip through). Budgets reset at startTurn, so the flag is
// naturally per-turn.
card('Mirage Walker', {
  abilities: [
    {
      type: 'triggered', events: ['spawned', 'spellPlayed', 'modApplied'],
      label: '(bookkeeping) note deployment actions',
      when: (g, self) => {
        if (g.s.phase === 'deploy' && g.s.deployPlayer === self.controller) {
          self.budgets['mw:acted'] = 1;
        }
        return false;
      },
      effect: { run: () => { /* never queues */ } },
    },
    {
      type: 'triggered', events: ['endOfTurn'], bounded: true, graftCause: true,
      label: 'create a 3/3 unit (you took no actions during deployment)',
      when: (_g, self) => !(self.budgets['mw:acted'] ?? 0),
      effect: {
        run: (g, ctx) => { g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [3, 3] }); },
      },
    },
  ],
  graftEffect: {
    bounded: true,
    effect: { run: (g, ctx) => { g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [3, 3] }); } },
  },
});

// "Negate target spell effect if its cost is less than or equal to the
// greatest amount of life lost by a player in this battle." — b/2 2/1
// {Battle} Sprite Horror Spell Unit. Cost = printed mana (a token's is 0; an
// X spell's is its X). Life lost read from the batch counters at resolution
// (R1 amount; R14 region scope) — PARKED fidelity limit, see header: only
// tracked while a tracker unit (Echo of Despair / Null Drone) was in play
// in-region; otherwise 0 → nothing negated.
card('Null Drone', {
  spellEffect: {
    targets: { what: 'stackSpell', prompt: 'Null Drone: negate target spell effect (cost ≤ greatest life lost this battle)' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) return;
      const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
      if (!item || !item.card) return;
      const m = getCard(item.card).mana;
      const cost = m === 'X' ? (item.x ?? 0) : m;
      const lost = Math.max(0, ...g.s.players.map(p => lifeLostThisBattle(g, ctx.region, p.seat)));
      if (cost <= lost) g.negate(item.id);
      else g.ev('info', `Null Drone: ${item.label} costs ${cost} > ${lost} life lost — not negated.`);
    },
  },
  abilities: [lifeLostTracker],   // the unit tracks life loss once in play
});

// "Glimpse 5" — b/3 4/1 Polyform Oracle Spell Unit. ⚠ header approximation.
card('Oracle of Foretelling', {
  spellEffect: { run: (g, ctx) => glimpse(g, ctx, ctx.controller, 5) },
});

// "[Switch1] Target unit gains -1/-1 until regroup for each card in your
// hand." — b/1 {Battle} Mystic Spell. R1: the amount is the caster's hand
// size at RESOLUTION. Bounded graft ([Switch1], R9).
const overwhelmShrink: EffectDef = {
  targets: { what: 'unit', prompt: 'Overwhelm: target unit gains -1/-1 for each card in your hand' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) return;
    const n = g.player(ctx.controller).hand.length;
    if (n > 0) { g.addTemp(t, -n, -n); g.checkDeaths(); }
  },
};
card('Overwhelm', {
  spellEffect: overwhelmShrink,
  graftEffect: { bounded: true, effect: overwhelmShrink },
});

// "Glimpse X, where X is your [b]." — b/1 {Battle} Mystic Spell. X = water
// affinity at resolution (R1); expended resources still count, prismites
// don't (R17). ⚠ Glimpse: header approximation.
card('Premonition', {
  spellEffect: {
    run: (g, ctx) => {
      const x = g.affinity(ctx.controller, 'water');
      if (x <= 0) { g.ev('info', 'Premonition: no water affinity — Glimpse 0.'); return; }
      glimpse(g, ctx, ctx.controller, x);
    },
  },
});

// "[Switch1] Target unit gains +1/+1 and piercing until regroup." — b/1
// {Battle} Druid Spell. Bounded graft. PARKED: the piercing grant needs a
// temporary-attribute primitive (see header); the +1/+1 works.
const protectiveBuff: EffectDef = {
  targets: { what: 'unit', prompt: 'Protective Adaptations: target unit gains +1/+1 (piercing grant parked) until regroup' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (isEnt(t) && g.entity(t.id)) g.addTemp(t, 1, 1);   // PARKED: "+ piercing"
  },
};
card('Protective Adaptations', {
  spellEffect: protectiveBuff,
  graftEffect: { bounded: true, effect: protectiveBuff },
});
