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
 * GLIMPSE (Celestial Purge / Oracle of Foretelling / Premonition) is REAL as
 * of the Light & Dark expansion: E.glimpse (R45) reveals the top N, caches
 * exactly ONE of the glimpser's choice and recycles the other N-1 to the
 * bottom of the deck; the cached card is playable until end of turn — pay the
 * mana, ignore affinity, obey timing. It replaced a pre-cache approximation
 * that put the kept card permanently into HAND instead of the cache.
 *
 * PARKED (needs engine primitives that do not exist; subsets implemented):
 *  - Dreadspawn Horror: NO LONGER parked. The self-static (-1/-1 per card in
 *    the controller's hand, computed live in effStats) covers BOTH forms —
 *    mod-carried statics anchor on the host (E.anchored), so the same def
 *    donates correctly (un-parked 2026-08-18). This entry outlived it.
 *  - Lurking Slimebeast: NO LONGER parked. This note used to read "printed.json
 *    has NO ambush field for it — the extractor does not parse the word-form
 *    '[three_blue]' cost". The extractor learned the word forms (the same
 *    COST_WORDS expansion core.py has always used: three_blue -> 3b), so the
 *    Ambush mode is real and needs nothing from this file.
 *  - Amphivore: NO LONGER parked (R110, 2026-08-23). This note used to say
 *    bounded grafts "correctly run once" and targeted grafts could not
 *    collect extra targets. The ruling says the opposite on both counts
 *    ("Any Bounded Grafts will be repeated"; costs are paid thrice), and
 *    composeParts now materializes the copies as separate parts, each with
 *    its own targets and [cost] — see EffectDef.graftCopies.
 */
import type { Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, unitRestrict, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, eraseFromPlay, perSeatRows } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** Glimpse N for a seat (R45) — reveal the top N, cache exactly ONE of the
 * glimpser's choice and recycle the rest to the bottom of the deck; until end
 * of turn the cached card may be played as if in hand, ignoring affinity but
 * still paying the mana and still obeying timing. N > 1 raises the choose-one
 * decision inside E.glimpse, so this CAN suspend. */
function glimpse(g: E, seat: Seat, n: number): void {
  g.glimpse(seat, n);
}

/** life a seat lost in this region's battle — the engine's per-battle ledger
 * (E.loseLife bumps battleCounter `lifeLost:<seat>`; reset per battle, R14) */
const lifeLostThisBattle = (g: E, region: number, seat: Seat): number =>
  g.battleCounter(region, `lifeLost:${seat}`);

// ───────────────────────────── the cards ──────────────────────────────

// "When my column deals combat damage to an opponent, [Switch1][Switch1]
// [Switch1] (Trigger three copies of this graft ability as one single
// trigger)." — b/4 2/5 Frog Beast Unit. The cause is bounded (once/turn, R9).
// R110: a graft MULTIPLIER — `graftCopies: 3` makes composeParts materialize
// every other attached graft three times in the one composite (G1 → G2 → G1
// → G2 → G1 → G2). Per the ruling this card is named in ("Amphivore / Lost
// Guardian. Bounded Grafts and Ralph explained", 2025-03-21) bounded grafts
// ARE repeated, targeted grafts pick a target per copy, and a "[cost]:
// effect" graft pays its cost three times or not at all. ⚠ approx:
// "my column deals combat damage to an opponent" is read off the aggregated
// combat lifeLost event — my column counts as connecting if it is attacking
// unblocked, or blocked/blocking with Piercing.
const amphivoreEcho: EffectDef = {
  graftCopies: 3,
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    const others = self ? self.mods.filter(id => {
      const m = g.entity(id);
      return m && m.appliedAs === 'graft' && m.card !== 'Amphivore';
    }).length : 0;
    if (!others) g.ev('info', `${ctx.sourceName}: no other graft is attached — there is nothing to triple.`);
    else g.ev('info', `${ctx.sourceName}: 3 copies of each grafted ability (${others} graft${others === 1 ? '' : 's'}), one single trigger.`);
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
// {Battle} {Feeble} Spell Unit. The hand is revealed as an info event; the
// caster picks via ctx.choose (or declines).
const brippEffect: EffectDef = {
  // R64: "target player" — the player-only kind, either seat, yourself
  // included. This said 'any', the DAMAGE kind, which also offered every unit
  // in the region; playtest UFAB aimed it at one and the spell was spent on a
  // hand that does not exist.
  targets: { what: 'player', prompt: "Bripp: look at target player's hand" },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!t || !('player' in t)) return;
    const who = t.player;
    const hand = g.player(who).hand;
    g.ev('info', `Bripp reveals ${g.pname(who)}'s hand: ${hand.join(', ') || '(empty)'}.`);
    // the looker keeps what they saw (client-side note-taking strip)
    if (who !== ctx.controller) g.revealHandTo(ctx.controller, who);
    if (!hand.length) return;
    const pick = ctx.choose('brippPick', {
      kind: 'payOrDecline', seat: ctx.controller,
      prompt: `Bripp: recycle a card from ${g.pname(who)}'s hand? (they then draw)`,
      options: [{ label: 'decline', value: -1 }, ...hand.map((name, i) => ({ label: name, value: i, card: name }))],
    }) as number;
    if (pick < 0 || hand[pick] === undefined) {
      g.ev('info', 'Bripp: nothing is recycled.');
      return;
    }
    const [name] = hand.splice(pick, 1);
    g.recycleToBottom(who, name!);
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
// triggers; its mods are erased with it. The Glimpse is real (R45) and goes
// to the ERASED unit's controller — a consolation the opponent usually gets.
card('Celestial Purge', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Celestial Purge: erase target unit (its controller Glimpses 3)' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      const who = t.controller;
      eraseFromPlay(g, t);
      glimpse(g, who, 3);
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
      // R68: removeFromStack() is the bare primitive — the item leaves the
      // stack and the CALLER says where its card goes. This used to rebuild
      // g.s.stack from a `keep` array because that primitive did not exist.
      let recalled = 0;
      for (const it of [...g.s.stack]) {
        if (!recallKinds.has(it.kind)) continue;
        const item = g.removeFromStack(it.id);
        if (!item) continue;
        recalled++;
        if (item.kind === 'spellToken') {
          g.ev('info', `Cosmic Reversal recalls ${item.label} — token: erased.`);
        } else {
          g.player(item.controller).hand.push(item.card!);
          g.ev('info', `Cosmic Reversal recalls ${item.label} to ${g.pname(item.controller)}'s hand.`);
        }
      }
      if (!recalled) g.ev('info', 'Cosmic Reversal: there is no other spell effect on the stack — nothing is recalled.');
      void ctx;
    },
  },
});

// "[Augment] I gain -1/-1 for each card in your hand." — bb/2 7/5 Alien
// Horror {Virus} Unit. Text-box [Augment], live when played normally: a
// self-affecting static whose dp/dt are computed live from the controller's
// hand size (raw hand array — statics must never call effStats, reentrancy
// guard). At 5+ cards in hand its toughness hits 0 and it dies at the next
// death check. The static is HOST-ANCHORED when mod-carried, so the same def
// covers the unit form and the augment-donated form alike (un-parked
// 2026-08-18); `augmentable: true` is what keeps the Virus mode open. (The
// "still PARKED … inert augmentText entry below" sentence that used to sit
// here was left behind by that unpark, and described an entry that no longer
// exists.)
card('Dreadspawn Horror', {
  augmentable: true,
  statics: [{
    affects: (g, self, t) => t.id === self.id,
    dp: (g, self) => -g.player(self.controller).hand.length,
    dt: (g, self) => -g.player(self.controller).hand.length,
  }],
});

// "[Augment] When I attack or block, you and target opponent each draw a
// card." — b/2 2/2 {Flying} Cloud Sprite Unit. Text-box [Augment]; live when
// played normally (Manual Q&A). Targeted trigger; the 'opponent' kind offers
// the other seats and nothing else, so the draw always has someone to go to.
card('Dreamfloat Drifter', {
  augmentText: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: 'you and target opponent each draw a card',
    effect: {
      // R64: "target opponent" — a player, and not you
      targets: { what: 'opponent', prompt: 'Dreamfloat Drifter: target opponent (you both draw)' },
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
// against the engine's per-battle life-loss ledger (E.loseLife → battleCounter
// `lifeLost:<seat>`; R14: per-region battle scope). "Create" = a token copy
// (erased on leaving play, survives regroup); the copy carries the same
// abilities.
card('Echo of Despair', {
  abilities: [
    {
      type: 'triggered', events: ['afterCombat'],
      label: 'create a copy of me (a player lost life this battle)',
      when: (g, _self, ev) => {
        const region = ev.data?.region as number | undefined;
        if (region === undefined) return false;
        return g.s.players.some(p => lifeLostThisBattle(g, region, p.seat) > 0);
      },
      effect: {
        creates: ['Echo of Despair'],
        run: (g, ctx) => {
          const self = selfOf(g, ctx);
          if (!self) { g.ev('info', 'Echo of Despair: the original is gone — there is nothing to copy.'); return; }
          g.spawnUnit(ctx.controller, 'Echo of Despair', ctx.region, { token: true });
        },
      },
    },
  ],
});

// "Recall target unit in your bin. (Put it into your hand.)" — bb/4 4/2
// Fish Horror Spell Unit. R64: a real cast-time target ('binCard'). min 0
// because it is a SPELL UNIT — an empty bin must not make the 4/2 uncastable,
// and with nothing to recall the body still arrives.
card('Eldritch Reclaimer', {
  spellEffect: {
    targets: {
      what: 'binCard', min: 0,
      prompt: 'Eldritch Reclaimer: recall target unit in your bin',
      restrict: (_g, t) => {
        if (!('binCard' in t)) return false;
        const k = getCard(t.binCard.card).kind;
        return k === 'unit' || k === 'spellUnit';
      },
    },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('binCard' in t) || t.binCard.index === -1) {
        g.ev('info', 'Eldritch Reclaimer: no unit in the bin.');
        return;
      }
      const bin = g.player(ctx.controller).bin;
      const name = bin[t.binCard.index];
      if (name === undefined) return;
      bin.splice(t.binCard.index, 1);
      g.player(ctx.controller).hand.push(name);
      g.ev('info', `${name} is recalled from ${g.pname(ctx.controller)}'s bin to their hand.`);
    },
  },
});

// "The controller of target enemy effect may pay [x]. If they do, you draw a
// card. Otherwise, negate that effect. X can't be zero." — b/X {Battle} Ice
// Spell. X is chosen and paid AT CAST (R35); "X can't be zero" → xMin 1, so
// the cast is illegal with no open mana. R6: the target's controller's
// ransom payment stays a mid-resolution decision, skipped (→ negated) when
// they cannot pay X.
card('Frosted Denial', {
  xMin: 1,   // "X can't be zero."
  spellEffect: {
    // R64: "target ENEMY effect" — your own effects were being offered and
    // then refused at resolution
    targets: {
      what: 'stackEffect', prompt: 'Frosted Denial: target enemy effect (its controller may pay X)',
      restrict: (g, t, ctx) => 'stack' in t
        && g.s.stack.find(i => i.id === t.stack)?.controller !== ctx.ally,
    },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) return;
      const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
      if (!item) {
        g.ev('info', 'Frosted Denial: the targeted effect has already left the stack — no ransom, no negate.');
        return;
      }
      if (item.controller === ctx.controller) { g.ev('info', 'Frosted Denial: not an enemy effect — no effect.'); return; }
      const me = ctx.controller;
      const x = ctx.x ?? 0;
      if (x < 1) { g.ev('info', "Frosted Denial: X can't be zero — no effect."); return; }
      const opp = item.controller;
      let paid = false;
      if (g.openMana(opp) >= x) {
        paid = ctx.choose('fdPay', {
          kind: 'payOrDecline', seat: opp,
          prompt: `Frosted Denial: pay ${x} to save ${item.label}? (else it is negated)`,
          options: [{ label: `pay ${x}`, value: 1 }, { label: 'decline', value: 0 }],
        }) as number === 1;
      }
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
// I gain +4/+4 and flying until regroup." — bb/3 0/4 Eel Unit. Cards enter
// my hand mid-battle via recall ('despawned' to hand) or a battle DRAW
// (E.draw fires 'draw' during battle only — a multi-card draw is ONE event,
// matching "one or more"). Flying via E.addTempAttr (until regroup).
// Recall path: the recalled card goes to its OWNER's hand — the event only
// carries the controller (≈ owner in this pool). R70 says where it went ON THE
// EVENT: the despawn carries `to` ('hand' | 'cache'), which is what the when()
// below reads. (It used to be a match on the rendered message, "the data
// carries no token flag" — which also read a unit going to a CACHE as one
// entering a hand.) R69, extended to the hand 2026-08-22: a recalled TOKEN
// visits the hand too, so it counts here; a CACHED unit still does not.
// Draw path: the 'draw' event carries no region, so the when() pins the
// listener to the battle region itself (R12).
const galeriderSurge: EffectDef = {
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    if (!self) { g.ev('info', 'Galerider Eel: the carrier is gone — no +4/+4 and no flying.'); return; }
    g.addTemp(self, 4, 4);
    g.addTempAttr(self, 'Flying');
  },
};
card('Galerider Eel', {
  abilities: [{
    type: 'triggered', events: ['despawned', 'draw'], graftCause: true,
    label: 'I gain +4/+4 and flying until regroup',
    when: (g, self, ev) => {
      if (g.s.phase !== 'battle' || ev.data?.seat !== self.controller) return false;
      if (ev.type === 'draw') return g.s.battle?.region === self.region;
      // R70: the despawn event says where the card WENT; this used to match
      // the word "hand" in the log message
      return ev.data?.unit !== self.id && ev.data?.to === 'hand';
    },
    effect: galeriderSurge,
  }],
  graftEffect: { bounded: false, effect: galeriderSurge },
});

// "[Augment] When I attack or block, you may play a unit from your hand into
// an open position in my formation. (You still pay the cost.)" — bb/2 2/2.
// Text-box [Augment], live when played normally. The unit is paid for
// (canPayCard/payCard), spawns into the battle region, and R75 asks the
// controller WHICH open position — "an open position in my formation" names a
// kind of slot, not a particular one, so it is the same choice every other
// "in my formation" card now makes.
card('Hooba-Pon', {
  augmentText: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: 'you may play a unit from your hand into an open formation position',
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        const b = g.s.battle;
        if (!self || !b) { g.ev('info', 'Hooba-Pon: no formation to play into.'); return; }
        if (!g.formationSlots(ctx.controller).length) {
          g.ev('info', 'Hooba-Pon: there is no open position in the formation — nothing is played.');
          return;
        }
        const seat = ctx.controller;
        const hand = g.player(seat).hand;
        const options: { label: string; value: number; card?: string }[] = [{ label: 'decline', value: -1 }];
        hand.forEach((name, i) => {
          if (getCard(name).kind === 'unit' && g.canPayCard(seat, name)) {
            options.push({ label: name, value: i, card: name });
          }
        });
        if (options.length === 1) {
          g.ev('info', 'Hooba-Pon: no unit in hand you can pay for — nothing is played.');
          return;
        }
        const pick = ctx.choose('hoobaPlay', {
          kind: 'payOrDecline', seat,
          prompt: 'Hooba-Pon: play a unit from your hand into an open position in my formation? (you pay its cost)',
          options,
        }) as number;
        const name = pick >= 0 ? hand[pick] : undefined;
        if (name === undefined) { g.ev('info', 'Hooba-Pon: declined — nothing is played.'); return; }
        hand.splice(pick, 1);
        g.payCard(seat, name);
        const u = g.spawnUnit(seat, name, ctx.region);
        g.placeInFormation(u, ctx, { key: 'hoobaPonSlot', source: 'Hooba-Pon' });
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
      const options: { label: string; value: number; card?: string }[] = [{ label: 'decline', value: -1 }];
      hand.forEach((name, i) => {
        if (getCard(name).kind === 'unit' && g.canPayCard(seat, name)) {
          options.push({ label: name, value: i, card: name });
        }
      });
      if (options.length === 1) {
        g.ev('info', `Insidious Invitation: ${g.pname(seat)} has no unit they can pay for.`);
        continue;
      }
      const pick = ctx.choose(`invite:${seat}`, {
        kind: 'payOrDecline', seat,
        prompt: 'Insidious Invitation: play a unit from your hand as if it were [Battle]? (costs still paid)',
        options,
      }) as number;
      const name = pick >= 0 ? hand[pick] : undefined;
      if (name === undefined) {
        g.ev('info', `Insidious Invitation: ${g.pname(seat)} declines.`);
        continue;
      }
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

// "[Battle] Ambush [three_blue]" — bb/4 8/3 Slime Beast Unit. No behaviour of
// its own: the whole card is the printed body plus R22's Ambush mode, which
// the engine generates from printed.ambush (3 mana at one water pip, the
// word-form cost the extractor now expands). The generated mode is the
// standard one — "Recall target ally, put me into their position in play".
card('Lurking Slimebeast', {});

// "When I attack, [Switch1] Recall up to one target unit with 5 or less
// defense." — bbb/4 5/3 Kraken Unit. Bounded graft cause (R9). ⚠ approx:
// TargetSpec cannot filter by stats or express "up to one" — candidates are
// all units; the "5 or less defense" gate is enforced at resolution (an
// over-tough pick is a no-op).
const krakenRecall: EffectDef = {
  // R64: "with 5 or less defense" is a targeting restriction.
  targets: {
    what: 'unit', prompt: 'Minor Kraken: recall up to one target unit with 5 or less defense',
    restrict: unitRestrict((g, u) => g.effStats(u)[1] <= 5),
  },
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
        creates: ['Unit Token'],
        run: (g, ctx) => { g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [3, 3] }); },
      },
    },
  ],
  graftEffect: {
    bounded: true,
    effect: { creates: ['Unit Token'], run: (g, ctx) => { g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [3, 3] }); } },
  },
});

// "Negate target spell effect if its cost is less than or equal to the
// greatest amount of life lost by a player in this battle." — b/2 2/1
// {Battle} Sprite Horror Spell Unit. Cost = printed mana (a token's is 0; an
// X spell's is its X). Life lost read at resolution from the engine's
// per-battle ledger (E.loseLife → battleCounter `lifeLost:<seat>`; R1 amount,
// R14 region scope).
card('Null Drone', {
  spellEffect: {
    targets: { what: 'stackSpell', prompt: 'Null Drone: negate target spell effect (cost ≤ greatest life lost this battle)' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) return;
      const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
      if (!item || !item.card) {
        g.ev('info', 'Null Drone: the targeted spell effect has already left the stack — nothing is negated.');
        return;
      }
      const m = getCard(item.card).mana;
      const cost = m === 'X' ? (item.x ?? 0) : m;
      const lost = Math.max(0, ...g.s.players.map(p => lifeLostThisBattle(g, ctx.region, p.seat)));
      if (cost <= lost) g.negate(item.id);
      else g.ev('info', `Null Drone: ${item.label} costs ${cost} > ${lost} life lost — not negated.`);
    },
  },
  // #85: the negate threshold is "the GREATEST life lost by A player", so the
  // useful preview is both seats AND the max it actually takes — a player
  // holding this needs to know the ceiling before committing the cast, and the
  // ceiling is invisible on the board. Three rows, not one.
  xPreviewRows: (g, seat, region) => [
    ...perSeatRows(g, seat, s2 => lifeLostThisBattle(g, region, s2)),
    { label: 'greatest — the cost it can negate up to',
      x: Math.max(0, ...g.s.players.map(p => lifeLostThisBattle(g, region, p.seat))) },
  ],
});

// "Glimpse 5" — b/3 4/1 Polyform Oracle Spell Unit. R45: five are revealed,
// ONE is cached (playable this turn ignoring affinity) and four are recycled;
// the body still spawns.
card('Oracle of Foretelling', {
  spellEffect: { run: (g, ctx) => glimpse(g, ctx.controller, 5) },
});

// "[Switch1] Target unit gains -1/-1 until regroup for each card in your
// hand." — b/1 {Battle} Mystic Spell. R1: the amount is the caster's hand
// size at RESOLUTION. Bounded graft ([Switch1], R9).
const overwhelmShrink: EffectDef = {
  targets: { what: 'unit', prompt: 'Overwhelm: target unit gains -1/-1 for each card in your hand' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) {
      g.ev('info', 'Overwhelm: the target is gone — nothing is shrunk.');
      return;
    }
    const n = g.player(ctx.controller).hand.length;
    if (n <= 0) { g.ev('info', 'Overwhelm: your hand is empty — -0/-0, nothing changes.'); return; }
    g.addTemp(t, -n, -n);
    g.checkDeaths();
  },
};
card('Overwhelm', {
  spellEffect: overwhelmShrink,
  graftEffect: { bounded: true, effect: overwhelmShrink },
});

// "Glimpse X, where X is your [b]." — b/1 {Battle} Mystic Spell. X = water
// affinity at resolution (R1); expended resources still count, prismites
// don't (R17). Glimpse is real (R45).
card('Premonition', {
  spellEffect: {
    run: (g, ctx) => {
      const x = g.affinity(ctx.controller, 'water');
      if (x <= 0) { g.ev('info', 'Premonition: no water affinity — Glimpse 0.'); return; }
      glimpse(g, ctx.controller, x);
    },
  },
  // UI preview (#5): the Glimpse depth if it resolved right now
  xPreview: (g, seat) => g.affinity(seat, 'water'),
});

// "[Switch1] Target unit gains +1/+1 and piercing until regroup." — b/1
// {Battle} Druid Spell. Bounded graft. Piercing via E.addTempAttr (until
// regroup, cleared with the temp stats).
const protectiveBuff: EffectDef = {
  targets: { what: 'unit', prompt: 'Protective Adaptations: target unit gains +1/+1 and piercing until regroup' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (isEnt(t) && g.entity(t.id)) { g.addTemp(t, 1, 1); g.addTempAttr(t, 'Piercing'); }
  },
};
card('Protective Adaptations', {
  spellEffect: protectiveBuff,
  graftEffect: { bounded: true, effect: protectiveBuff },
});
