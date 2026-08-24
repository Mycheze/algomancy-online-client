/* batch-wood-a — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Wood cards scripted over the printed data in printed.json
 * (never hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (partial resolution / fizzles), R6 (mid-resolution choices via
 * ctx.choose), R9 (bounded budgets per card), R12/R25 (region scoping),
 * R115 (created UNITS arrive where their SOURCE is — ctx.region — unless the
 * text names a place; Hooba-Nan's "adjacent slots" already was battle-local),
 * R31 (triggers between combat damage sub-steps resolve immediately).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - CONTROL CHANGES (Corrupting Blight / Hush Mush / Hexbane Shiitake):
 *    UN-PARKED (R112, 2026-08-23). This used to describe a batch-local
 *    giveControl(); the engine now has `E.giveControl(u, to)` — unit AND
 *    mods change controller (Bena's ruling), it leaves any formation
 *    through removeFromFormation (so the R72 collapse happens), and it goes
 *    to the new controller's home now if that controller is not present.
 *  - EARNEST DEFENDER: still the log-tail reconstruction, but NOT for the
 *    reason this note used to give. It said "'targeted' events are logged but
 *    NOT dispatched to trigger listeners"; R53 fixed that — commitItem calls
 *    fireEvent('targeted', …) for every unit target of every stack item, which
 *    is how Mohruung works. What the dispatched event does NOT carry is who is
 *    doing the targeting: its data is { item, unit, region } only, with no
 *    controller and no kind, so "targeted by an ENEMY SPELL" cannot be decided
 *    from it. Until the event carries the item's controller and kind, the
 *    trigger listens on 'spellPlayed' (which does carry the seat) and reads
 *    the 'targeted' entries commitItem logged immediately before it — sound,
 *    because both are emitted synchronously inside one commitItem. Spell
 *    tokens count as spells here, and that is now the whole file's answer
 *    rather than this card's exception — see Hexbane Shiitake, where the
 *    opposite guard was a literal-reading bug. (The old parenthetical said
 *    "R26's 'played' exclusion is about 'you play' triggers"; R26 is about
 *    token CREATION and settles nothing here either way.)
 *    ⚠ OPEN, literal-reading audit 2026-08-24: it is ONE firing per enemy
 *    spell even when that spell targets TWO allies, and the printed text is
 *    "whenever an ALLY becomes the target", which reads per-ally. A Twin
 *    Flame aimed at two of my units should then make two 1/1s, not one.
 *    Unfixed on purpose: trigger MULTIPLICITY is a rules question nobody has
 *    put to the owner, and the honest fix rides on the same engine change the
 *    note above is waiting for ('targeted' carrying the item's controller and
 *    kind), after which this stops being a log-tail scrape at all.
 *  - FUNGAL GARDENER: NO LONGER an approximation. This said "a died event
 *    carries no token flag … so nontoken-ness is read from the died message";
 *    R70 stamps `token` (with `counters`, `verb`, `seat`, `region`) onto every
 *    leave-play event precisely because the entity is gone by trigger time,
 *    and the card reads ev.data.token.
 *  - HUSH MUSH: a spell unit spawns AFTER its effect parts (afterParts), so
 *    "its controller gains control of me" is handed off through a per-region
 *    battleCounters ledger read by Hush Mush's own spawn trigger. Two Hush
 *    Mushes resolving in one region before either spawns would share the
 *    ledger (last write wins) — unreachable with one copy per deck pool.
 *  - BURGEON: "double" adds the current EFFECTIVE stat as an until-regroup
 *    bonus (stat layer 3). Under a layer-4 multiplier (Tough/Balanced) the
 *    result overshoots ((base+eff)*2 > eff*2). No pool combo hits this today.
 *  - HOOBA-NAN: NO LONGER an approximation, and no longer this card's problem.
 *    R75 put "adjacent" in the engine (E.adjacentSlots): sides and
 *    above/below, nothing diagonal, over the slots the formation actually has.
 *    It no longer fronts fresh columns at the edges of the line, so the
 *    "only while no blocks are declared" guard — which existed because
 *    unshifting a column renumbers every b.blocks key — is gone with it.
 *  - GLOWHAVEN ELDER / INSPIRATION: statics-only text-box [Augment]s —
 *    `augmentable: true` + statics anchored on the carrier (the host when
 *    donated; "your other units" excludes the anchor by id).
 *
 * PARKED: none — all 16 cards are scripted (some approximated, see above).
 */
import type { Entity, EntityId, Seat, TargetRef } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, effectByKey, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, modeTargetOf } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** create a 1/1 unit token for `seat` in `region`. R115: `region` is REQUIRED
 * and is always the SOURCE's region (`ctx.region`) — the old `?? homeRegion`
 * default is exactly how four cards silently inherited the wrong answer. */
const makeOneOne = (g: E, seat: Seat, region: number): Entity =>
  g.spawnUnit(seat, 'Unit Token', region, { token: true, tokenStats: [1, 1] });

// ────────────────────────────── the cards ──────────────────────────────

// "Create a Poison 1 for each of your units." — gg/4 Ancient Blight Spell
// (deploy timing). "Your units" is region-scoped (R12): the units you have
// where the spell resolves (your home region during deployment). Poison spell
// tokens appear at ctx.region, like everything else created (R115).
card('All-Consuming Blight', {
  spellEffect: {
    creates: ['Poison'],
    run: (g, ctx) => {
      const mine = g.unitsOf(ctx.controller, ctx.region);
      for (const _ of mine) g.createSpellToken(ctx.controller, 'Poison', 1, ctx.region);
      g.ev('info', `All-Consuming Blight: ${mine.length} Poison 1 created.`);
    },
  },
});

// "Target player reveals their hand. You choose a card from it and put it
// into your hand." — ggg/4 {Battle} Fungus Spell. The reveal is an info event
// + seenHand snapshot; the pick is a mid-resolution choice (mandatory — the
// text has no "may"), auto when only one card. "Target player" carries no
// ownership clause, so targeting yourself is legal and just shows you your own
// hand (nothing moves).
card('Bioremediation', {
  spellEffect: {
    // R64: 'player' is the player-only kind. 'any' — the damage kind — offered
    // the region's units too, and a unit has no hand to reveal.
    targets: { what: 'player', prompt: 'Bioremediation: target player reveals their hand — you take a card from it' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('player' in t)) return;
      const who = t.player;
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
      if (name === undefined) { g.ev('info', 'Bioremediation: that card is gone — nothing is taken.'); return; }
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
    targets: { what: 'stackEffect', prompt: 'Boon of Protection: negate target effect that targets an allied effect, player or unit' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) return;
      const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
      if (!item) {
        g.ev('info', 'Boon of Protection: the targeted effect has already left the stack — nothing is negated.');
        return;
      }
      const allied = item.parts.some(p => !p.spent && p.targets.some(tr => {
        if ('unit' in tr) return g.entity(tr.unit)?.controller === ctx.controller;
        if ('player' in tr) return tr.player === ctx.controller;
        if (!('stack' in tr)) return false;   // a cached-card target is nobody's effect
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
// effect ([Switch1], R9). ⚠ header approximation: adds the current EFFECTIVE
// stat as a temp bonus.
//
// R57 — WHICH STAT IS A CAST-TIME DECLARATION (`EffectDef.modes`), asked right
// after the target and before any cost. It used to be a mid-resolution
// ctx.choose, and that is the playtest report this card is famous for: the
// Burgeon sat on the stack with its half UNKNOWN, the opponent spent a card
// answering it, the response resolved, and only then was the caster asked —
// off the POST-response stats. The opponent had paid for information the
// caster then got to use. Two smaller bugs died with it:
//  - the end-of-turn branch auto-picked 'power' FOR you. Its justification
//    ("a suspension in the end-of-turn tail strands the game") went stale when
//    E.finishTurnEnd started resuming out of settle(); the cast window already
//    suspends there for targets, so it may suspend here too.
//  - the option labels were computed at resolution, which is where the free
//    information came from. They are computed in the cast window now.
//
// PLAYTEST FIX (game MNWK: "Burgeon resolving didn't give me the choice to
// double the power or defense. It just did nothing.") — the rest of it stands:
//  - doubling a stat that is 0 is an invisible no-op; addTemp(+0/+0) logs a
//    line that reads like nothing happened because nothing did. Say so.
//  - the gone-target guard was the only one in this file with no info line,
//    unlike its siblings (Reconfigure, Body Swap, Fight).
const burgeonEffect: EffectDef = {
  targets: { what: 'unit', prompt: 'Burgeon: double the power or defense of target unit until regroup' },
  modes: {
    key: 'stat',
    prompt: (g, _item, part) => {
      const u = modeTargetOf(g, part);
      if (!u) return 'Burgeon: double the target\'s power or defense until regroup?';
      const [p, d] = g.effStats(u);
      return `Burgeon: double ${u.card}'s power (${p} → ${p * 2}) or defense (${d} → ${d * 2})?`;
    },
    options: (g, _item, part) => {
      const u = modeTargetOf(g, part);
      const [p, d] = u ? g.effStats(u) : [0, 0];
      return [
        { label: u ? `Power (${p} → ${p * 2})` : 'Power', value: 'power' },
        { label: u ? `Defense (${d} → ${d * 2})` : 'Defense', value: 'defense' },
      ];
    },
  },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) {
      g.ev('info', 'Burgeon: the target is gone — nothing is doubled.');
      return;
    }
    const [p, d] = g.effStats(t);
    // R57: declared at cast, not asked here (see the header).
    const mode = ctx.mode;
    const [stat, was] = mode === 'defense' ? ['defense', d] as const : ['power', p] as const;
    if (was <= 0) {
      g.ev('info', `Burgeon: ${t.card} has ${was} ${stat} — doubling it changes nothing.`);
      return;
    }
    g.ev('info', `Burgeon doubles ${t.card}'s ${stat}: ${was} → ${was * 2} until regroup.`);
    if (stat === 'defense') g.addTemp(t, 0, d);
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
        const me = selfOf(g, ctx);
        if (!me) { g.ev('info', 'Corrupting Blight: the carrier is gone — no control changes.'); return; }
        const candidates = g.s.players.map((_, s) => s as Seat).filter(s => s !== me.controller);
        if (!candidates.length) {
          g.ev('info', `Corrupting Blight: everybody already controls ${me.card} — no control changes.`);
          return;
        }
        const to = candidates.length === 1 ? candidates[0]! : ctx.choose('who', {
          kind: 'electricPath', seat: ctx.controller,
          prompt: `Corrupting Blight: who gains control of ${me.card}?`,
          options: candidates.map(s => ({ label: g.pname(s), value: s })),
        }) as Seat;
        g.giveControl(me, to);
      },
    },
  }],
});

// "[Augment] Whenever an ally becomes the target of an enemy spell, create
// a 1/1 unit." — g/3 1/3 {Haste} Flower Guardian Unit. ⚠ header
// approximation: listens on 'spellPlayed' and reads the 'targeted' entries
// commitItem logged immediately before it. ('targeted' IS dispatched now —
// R53 — but its data is { item, unit, region }, with no controller and no
// kind, so an "enemy SPELL" cannot be recognised from it alone; see header.)
// "Ally" = a unit my controller controls (me included).
// R115: the 1/1 arrives where the source is (ctx.region).
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
      creates: ['Unit Token'],
      run: (g, ctx) => { makeOneOne(g, ctx.controller, ctx.region); },
    },
  }],
});

// "Whenever a nontoken enemy dies, [Switch] Create a 1/1 unit." — gg/2 1/2
// Fungus Druid Unit. Died trigger, region-scoped by fireEvent; "enemy" =
// the dead unit's controller differs from mine (R1: checked at event time).
// R70: nontoken-ness is a FACT ON THE EVENT (ev.data.token) — it used to be a
// string match on the death message. The creation is the unbounded graftable
// piece ([Switch]); R115: the 1/1 arrives at the source's region (ctx.region).
const gardenerSprout: EffectDef = {
  creates: ['Unit Token'],
  run: (g, ctx) => { makeOneOne(g, ctx.controller, ctx.region); },
};
card('Fungal Gardener', {
  abilities: [{
    type: 'triggered', events: ['died'], graftCause: true,
    label: 'create a 1/1 unit (a nontoken enemy died)',
    when: (g, self, ev) =>
      ev.data?.seat !== undefined && ev.data.seat !== self.controller
        && ev.data?.token !== true,   // R70: the fact rides the event
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
// carrier to the spell's owner (E.giveControl, R112).
//
// LITERAL-READING AUDIT (2026-08-24): SPELL TOKENS COUNT. This used to carry
// `ev.data?.token !== true` and the note "spell tokens are not 'played'
// (R26)", and both were wrong:
//  · R26 is about token CREATION ("the created 1/1 is a token and can't
//    re-trigger"), and R59's "a spell token is cast from play, not played" is
//    about what a COST modifier may tax. Neither is about this trigger.
//  · The engine's own answer is the opposite: `commitItem` fires 'spellPlayed'
//    for a spell token with `token: true` — Nimbus Eel's printed "When you
//    play a TOKEN spell" is built on exactly that event, so the SET calls
//    casting a token "playing a spell".
//  · Every other `token !== true` guard on 'spellPlayed' in the whole pool
//    belongs to a card that PRINTS "nontoken" (Ravenous Fireslinger,
//    Stormsowing Nimbus, Unstable Apparition, Channeled Amalgam, Arcane
//    Concentrator, Seabed Shellcaster, Aethercap Siphoner, Void Mandible).
//    This card prints "a spell", like Sparkwraith and Voltwrath Behemoth,
//    which both count tokens. The set says "nontoken" when it means it.
// So the guard is gone and 'spellToken' joins the kinds the exchange can find
// on the stack — without that second half the trigger would fire and then
// report "no longer on the stack", which is the dead-clause shape (R125).
card('Hexbane Shiitake', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'], bounded: true,   // [once]
    label: 'exchange control of me for that spell (you may)',
    when: (g, self, ev) => ev.data?.seat !== self.controller,
    effect: {
      run: (g, ctx) => {
        const me = selfOf(g, ctx);
        // R113: the ability IS the offer to exchange. Where the offer cannot
        // be put to the player at all — no carrier, no spell left to swap for —
        // the use is not spent, exactly as an outright decline is not.
        if (!me) { ctx.refundBudget?.(); g.ev('info', 'Hexbane Shiitake: the carrier is gone — no exchange.'); return; }
        const cardName = ctx.event?.data?.card as string | undefined;
        const seat = ctx.event?.data?.seat as Seat | undefined;
        if (cardName === undefined || seat === undefined) { ctx.refundBudget?.(); return; }
        const spellKinds = new Set(['spell', 'spellUnit', 'spellToken']);
        const item = [...g.s.stack].reverse().find(i =>
          i.card === cardName && i.controller === seat && spellKinds.has(i.kind));
        if (!item) { ctx.refundBudget?.(); g.ev('info', `Hexbane Shiitake: ${cardName} is no longer on the stack — no exchange.`); return; }
        // plan: every choice before any mutation (the part replays on suspension)
        //
        // CARD-TODO #18: the offer is put to the player WHEREVER this resolves,
        // the end-of-turn window included. A ctx.choose suspension raised there
        // is answered like any other and E.finishTurnEnd closes the owed turn
        // flip on the way back out of settle() (R85), so there is no longer a
        // "cannot be asked" branch — `pays` is the answer and nothing else.
        const pays = ctx.choose('swap', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Hexbane Shiitake: exchange control of ${me.card} for ${item.label}?`,
          options: [{ label: `Exchange (${g.pname(seat)} gets ${me.card})`, value: true }, { label: 'Decline', value: false }],
        }) === true;
        if (!pays) {
          // CARD-TODO #18, and the case that raised it. The owner's ruling
          // (2026-08-23) — "a [once] is spent only when the ability actually
          // does something" — means an outright decline hands the budget back,
          // so the same trigger may ask again later the same turn.
          ctx.refundBudget?.();
          g.ev('info', `Hexbane Shiitake: ${item.label} is left alone — no exchange.`);
          return;
        }
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
        g.giveControl(me, seat);
      },
    },
  }],
});

// "[Augment] When I attack, if I am still in formation, create a 1/1 unit
// in all my empty adjacent slots." — ggg/4 5/4 Hooba Banana Unit. Text-box
// [Augment]; live when played normally. "Still in formation" is checked at
// RESOLUTION (R27-style).
//
// R75: the slot set is the ENGINE's now (E.adjacentSlots) — "sides and
// above/below, nothing diagonal", over the slots the formation actually has.
// This card does NOT get the placement choice that "in my formation" cards
// get: it names its own slots, so there is nothing to choose.
//
// Two behaviour changes fall out of the ruling, both deliberate:
//  · it no longer opens FRESH COLUMNS at the edges of the line. Adjacent slots
//    "only exist if it's in a formation", so a unit in the leftmost column has
//    no left-adjacent slot rather than an implicit one.
//  · with that gone, so is the `Object.keys(b.blocks).length === 0` guard this
//    card used to need — it existed only because unshifting a new column at
//    index 0 renumbers every block key by hand. That re-key now has exactly one
//    owner (E.rekeyColumns) and this card never triggers it.
card('Hooba-Nan', {
  augmentText: [{
    type: 'triggered', events: ['attacked'], self: true,
    label: 'create a 1/1 unit in all my empty adjacent slots',
    effect: {
      creates: ['Unit Token'],
      run: (g, ctx) => {
        const me = selfOf(g, ctx);
        if (!me || !g.s.battle) { g.ev('info', 'Hooba-Nan: no formation to fill — no units.'); return; }
        if (!g.columnOf(me.id)) { g.ev('info', `${me.card}: no longer in formation — no units.`); return; }
        const slots = g.adjacentSlots(me.id);
        if (!slots.length) { g.ev('info', `${me.card}: every adjacent slot is already taken — no units.`); return; }
        for (const s of slots) s.col.push(makeOneOne(g, ctx.controller, ctx.region).id);
        g.ev('info', `${me.card}: ${slots.length} 1/1 unit(s) fill the empty adjacent slots `
          + `(${slots.map(s => s.label).join('; ')}).`);
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
    targets: { what: 'stackEffect', prompt: 'Hush Mush: negate target effect (its controller gains control of me)' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) {
        g.ev('info', 'Hush Mush: no effect is targeted — nothing is negated.');
        return;
      }
      const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
      if (!item) {
        g.ev('info', 'Hush Mush: the targeted effect has already left the stack.');
        return;
      }
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
        const me = selfOf(g, ctx);
        if (!me) { g.ev('info', 'Hush Mush: the body is gone — no handover.'); return; }
        const c = g.s.battleCounters[ctx.region];
        const v = c?.[HUSH_KEY] ?? 0;
        if (!c || v <= 0) { g.ev('info', 'Hush Mush: nothing was negated — nobody gains control of me.'); return; }
        c[HUSH_KEY] = 0;
        g.giveControl(me, (v - 1) as Seat);
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
// the event snapshot (R1, Lithoghul precedent). R115: the 1/1s arrive where
// Jollyglop is — take damage while attacking and they are minted in the enemy
// region, in no column. Poisonous damage becomes counters and never
// fires 'damage' (earth-c precedent, noted).
card('Jollyglop', {
  augmentText: [{
    type: 'triggered', events: ['damage'], self: true, bounded: true,   // [once]
    label: 'create that many 1/1 units (I was dealt damage)',
    effect: {
      creates: ['Unit Token'],
      run: (g, ctx) => {
        const n = (ctx.event?.data?.n as number | undefined) ?? 0;
        for (let i = 0; i < n; i++) makeOneOne(g, ctx.controller, ctx.region);
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
