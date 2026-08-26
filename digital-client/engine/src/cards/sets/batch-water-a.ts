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
import type { EffectPart, Entity, FormationSpot, Seat, StackItem, TargetRef } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, isGraftMultiplier, unitRestrict, type EffectCtx, type EffectDef, type ResolvedTarget } from '../dsl.ts';
import { selfOf, isEnt, isUnitCard, inlineMode, eraseFromPlay, perSeatRows } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/**
 * Play a card as part of an effect's resolution — Hooba-Pon's and Insidious
 * Invitation's "play a unit from hand", Tides of the Cosmos' "play them now",
 * Spell Excavation's bin play.
 *
 * ── R198: THIS IS A REAL PLAY, AND A REAL PLAY GOES ON THE STACK ─────────
 *
 * It used to run the played card's effect IN PLACE, inside the resolution that
 * played it, so nobody ever held priority between "you play it" and "it
 * resolves" (divergence inventory §2a, RESPONSE WINDOW MID-RESOLUTION). It
 * does not any more, wherever there is a priority regime to hand a window to:
 * the card is built into a `StackItem`, everything about the play that has to
 * be DECLARED is declared here (its target R67, its mode R57 and — Hooba-Pon —
 * the formation spot it is played into, R29), and `E.commitItem(…, 'push')`
 * puts it on the stack exactly as `playAtTiming` does for a card played out of
 * a hand. The outer resolution finishes, `finishResolutionTail` hands out
 * priority, and the played card is sitting there: respondable, negatable,
 * visible, with its cost already paid.
 *
 * ⚠ WHERE IT STILL RESOLVES IN PLACE, and why that is not an approximation.
 * `then` is chosen by the same rule `playAtTiming` uses: **battle pushes,
 * everything else resolves.** Outside a battle priority window there is nobody
 * to hand priority to — deployment and the haste step are hidden simultaneous
 * segments with no response windows at all, and between combat sub-steps
 * triggers are special actions with no priority (R3). Pushing there would be
 * worse than wrong: nothing drains a planning-phase stack, and
 * `pumpCombatDamage` refuses to run while the stack is non-empty, so an item
 * pushed in either place would strand the game. `inlinePlayGoesToStack` is
 * that gate and it is deliberately narrow.
 *
 * ⚠ HOW THIS CANNOT REPRODUCE THE R85 SNAPSHOT HAZARD. A `'resolve'`
 * suspension carries a whole-`GameState` snapshot and `E.resumeResolve` does
 * `this.s = snap`, so anything a SECOND seat landed while that question was
 * open would be erased by the answer (130-seat-aware-gate §3). Nothing here is
 * ever exposed to that, and the reason is structural rather than defensive:
 * **the window opens only after the resolution has completely finished.** The
 * questions below are asked through `ctx.choose`, which rides the OUTER
 * suspension, and while any of them is open `apply()` refuses every action
 * from both seats (`decisionBlocks`: a battle decision is never inside a
 * hidden segment, and a live resolve-snapshot blocks the other seat even in
 * one). Priority is handed out by `finishResolutionTail`, which runs after
 * `resolveItem` has RETURNED — after the last suspension was answered and
 * cleared. There is no instant at which a snapshot is live and somebody else
 * may act, so nothing done in the window can be rewound by an answer. No gate
 * in `apply.ts` had to change for this, and none should be relaxed for it.
 *
 * `seat` is who is doing the playing (Insidious Invitation walks every seat in
 * turn); it defaults to the effect's controller. `outcome` is:
 *  · `'stacked'` — R198's path. The card is ON THE STACK and the ENGINE owns
 *    everything from here: its resolution, its R5 fizzle, and where its card
 *    goes afterwards (`dischargeItem` — a bin, an "Erase me.", or the R96
 *    Unstable erase). A caller must not bin it, place it or erase it.
 *  · `'unit'` (a plain unit body), `'ok'` (a spell, or a spell unit whose
 *    spell part resolved) or `'fizzled'` (a targeted spell with no candidates
 *    — the body never arrives): the in-place path, unchanged.
 * `unit` is the spawned body when there is one, so a caller that has somewhere
 * to put it (Hooba-Pon's formation) can. Never set on `'stacked'`, where the
 * body does not exist yet and the spot was declared with the play instead.
 *
 * It lives in THIS file, not helpers.ts, because it is card behaviour rather
 * than a shared idiom, and in the water-A batch because index.ts imports this
 * module before batch-water-b — the importing direction that leaves
 * registration order (= deck order) untouched.
 */
export type InlinePlay = {
  outcome: 'unit' | 'ok' | 'fizzled' | 'stacked';
  unit?: Entity;
  /**
   * R146(b): the resolving effect raised **"Erase me."** (`ctx.eraseSelf()`).
   * There is still no stack item to flag — `playInline` is the whole point of
   * not making one — so the request is RECORDED here and the CALLER, which is
   * the thing that decides where the card goes, honours it by erasing instead
   * of binning. That mirrors `E.dischargeItem`, where the same flag rides
   * `StackItem.eraseSelf` and the same single site reads it.
   *
   * Never true on `'fizzled'`: a fizzle means `eff.run` never ran, so nothing
   * could have raised it (the same reason a negated spell never self-erases).
   */
  eraseSelf?: boolean;
};

/** What a caller may ask a mid-resolution play to carry onto its stack item. */
export type InlinePlayOpts = {
  /**
   * R96: the play makes the card {Unstable} — Spell Excavation's bin play,
   * *"it will be erased, not binned"*. On the stack that is a STAMP, read by
   * the one predicate every stack exit shares (`E.itemIsUnstable`), so the
   * erase happens at `dischargeItem` on resolution, on an R5 fizzle and on a
   * NEGATION alike. That last one is new and is the point: an excavated spell
   * answered by Dematerialize is now erased rather than falling into a bin the
   * card says it never reaches.
   */
  unstable?: boolean;
  /**
   * R29: the card is played INTO the player's formation (Hooba-Pon's "into an
   * open position in my formation"), so WHERE is part of the play and is
   * declared here, before anyone may respond — never afterwards, which is what
   * `E.placeInFormation` is for and why the two are different rules.
   */
  intoFormation?: boolean;
};

/**
 * R198 — is there a priority window to hand this play to?
 *
 * The same test `playAtTiming` makes, written once: a card played during
 * BATTLE goes on the stack ('push'), and a card played anywhere else resolves
 * where it stands ('resolve'). `priority !== null` and the damage-step
 * exclusion are the two ways a battle can be running with no window open — a
 * combat sub-step (R3: triggers there are special actions) and the interval
 * `advanceBattleStep` nulls priority in. Pushing in either would strand the
 * item: `pumpCombatDamage` will not run with a non-empty stack, and nothing
 * outside `settle`'s deployment drain resolves one.
 */
export const inlinePlayGoesToStack = (g: E): boolean =>
  g.s.phase === 'battle' && g.s.priority !== null && !g.s.battle?.damageStep;

/**
 * R198's push path: declare the play, then put it on the stack.
 *
 * Everything asked here is asked with `ctx.choose`, so it rides the OUTER
 * resolution's suspension exactly as the in-place path's questions always did
 * — no nested `'cast'` suspension, which `GameState.decision`'s single slot
 * could not hold anyway. That is also what keeps R35/R57/R67's rule true for a
 * mid-resolution play: X, mode, target and formation spot are all fixed before
 * the opponent sees the item, so nobody responds to an undeclared spell.
 *
 * NOT hand-rolled past the choke point: `E.commitItem` fires 'spellPlayed' and
 * R129's 'cardPlayed', bumps the two `spellsPlayed:` ledgers, dispatches
 * 'targeted' and pushes. The in-place path fires a hand-rolled 'spellPlayed'
 * and none of the rest, which is a second divergence this closes on the way
 * past — a mid-resolution play is a play, and Void Mandible's "when a card is
 * played" could never see one.
 */
const pushInlinePlay = (
  g: E, ctx: EffectCtx, name: string, key: string, seat: Seat, opts: InlinePlayOpts,
): InlinePlay => {
  const def = getCard(name);
  const eff = def.spellEffect;
  const parts: EffectPart[] = eff ? [{ effectKey: `spell:${name}`, targets: [] }] : [];
  const part = parts[0];
  if (eff?.targets && part) {
    // R67: declared as the card is played, like every other target. An empty
    // candidate list is NOT special-cased into an early bin here — the item is
    // pushed with no target and `resolveItem`'s R5 branch fizzles it and
    // discharges its card, which is the same destination the caller used to
    // hand-roll plus a real 'fizzled' event for the reader.
    const cands = g.targetCandidates(eff.targets, ctx.region, undefined, seat);
    if (cands.length) {
      part.targets = [(cands.length === 1 ? cands[0]! : ctx.choose(`${key}:t`, {
        kind: 'electricPath', seat, prompt: eff.targets.prompt,
        options: cands.map(c => ({ label: g.targetLabel(c), value: c })),
      })) as TargetRef];
    }
  }
  if (eff && part) {
    // R57: the modal half, declared before the item is respondable — which is
    // what collectModes does for a card played from a hand, and what the
    // in-place path could only approximate.
    const mode = inlineMode(g, ctx, eff, `${key}:mode`, { card: name, targets: part.targets });
    if (mode !== undefined) part.mode = mode;
  }
  let spot: FormationSpot | undefined;
  if (opts.intoFormation && (def.kind === 'unit' || def.kind === 'spellUnit')) {
    const slots = g.formationSlots(seat);
    if (slots.length) {
      // BL-24: kind 'formationSlot', never 'electricPath' — an electricPath's
      // numeric values are entity ids by contract (R4) and the client pings
      // them on the board. These are placements. Same kind, and the same
      // opaque `FormationSpot` values, that R29's own cast-window ask uses.
      spot = (slots.length === 1 ? slots[0]!.spot : ctx.choose(`${key}:spot`, {
        kind: 'formationSlot', seat,
        prompt: `${ctx.sourceName}: where does ${name} join the formation?`,
        options: slots.map(s => ({ label: s.label, value: s.spot })),
      })) as FormationSpot;
    }
  }
  // The id is taken LAST, after every question: `ctx.choose` throws, R85 rewinds
  // `nextId` to the part boundary and the part replays from the top, so an id
  // spent before a question is spent again on every attempt.
  const item: StackItem = {
    id: g.s.nextId++, kind: def.kind, card: name, label: name,
    controller: seat, region: ctx.region, negated: false, parts,
    ...(spot ? { formationSpot: spot } : {}),
    ...(opts.unstable ? { unstable: true } : {}),
  };
  g.commitItem(item, 'push');
  return { outcome: 'stacked' };
};

export const playInline = (
  g: E, ctx: EffectCtx, name: string, key: string, seat: Seat = ctx.controller,
  opts: InlinePlayOpts = {},
): InlinePlay => {
  if (inlinePlayGoesToStack(g)) return pushInlinePlay(g, ctx, name, key, seat, opts);
  const def = getCard(name);
  if (def.kind === 'unit') {
    return { outcome: 'unit', unit: g.spawnUnit(seat, name, ctx.region) };
  }
  const ev = g.ev('spellPlayed',
    `${g.pname(seat)} plays ${name} (via ${ctx.sourceName}).`,
    { seat, card: name, token: false, region: ctx.region });
  g.fireEvent('spellPlayed', ev);
  const eff = def.spellEffect;
  let fizzled = false;
  let eraseSelf = false;
  if (eff) {
    let targets: ResolvedTarget[] = [];
    let refs: TargetRef[] = [];
    if (eff.targets) {
      const cands = g.targetCandidates(eff.targets, ctx.region, undefined, seat);
      if (!cands.length) fizzled = true;
      else {
        const ref = (cands.length === 1 ? cands[0]! : ctx.choose(`${key}:t`, {
          kind: 'electricPath', seat, prompt: eff.targets.prompt,
          options: cands.map(c => ({ label: g.targetLabel(c), value: c })),
        })) as TargetRef;
        const r = g.resolveTargetRef(ref);
        if (r) { targets = [r]; refs = [ref]; }
        else fizzled = true;
      }
    }
    if (!fizzled) {
      // R57: a modal card played inline has no cast window to declare its half
      // in — it never reaches the stack — so it is asked here, through
      // ctx.choose, exactly as it was before the mode moved. See inlineMode.
      const mode = inlineMode(g, ctx, eff, `${key}:mode`, { card: name, targets: refs });
      eff.run(g, {
        controller: seat, sourceName: name, region: ctx.region,
        targets, event: null, mode,
        // R146(b): an inline run has no stack item to flag — but "Erase me."
        // is a printed sentence (Collect Remains, Suspend, Temporal Rift) and
        // swallowing it left those spells BINNED and recurrable when they were
        // played for free. Record it; the caller honours it. This used to be
        // `() => {}` with the comment "an inline mod run has no stack item to
        // erase", which described the mechanism and mistook it for the answer.
        eraseSelf: () => { eraseSelf = true; },
        choose: (k, d) => ctx.choose(`${key}:${k}`, d),
      });
    }
  }
  if (fizzled) return { outcome: 'fizzled' };
  if (def.kind === 'spellUnit') {
    return { outcome: 'ok', unit: g.spawnUnit(seat, name, ctx.region), eraseSelf };
  }
  return { outcome: 'ok', eraseSelf };
};

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
// effect" graft pays its cost three times or not at all.
//
// R195 — "MY COLUMN DEALS COMBAT DAMAGE TO AN OPPONENT" is the ONE shared
// engine predicate now, `E.columnDealtCombatDamage`, on the 'face' channel
// alone ("to an opponent" is what excludes the unit channels). This card used
// to hand-roll the reconstruction and was the last copy carrying neither of
// the two gates the shared one has: R117's sub-step gate (it fired on a
// {Swift} column's hit while standing in a normal column) and R157 §4's power
// gate (a 0-power column "connected"). Measured before the fix, it also fired
// off a second column's hit while its own {Piercing} pool was absorbed whole
// by the blockers — that is the attribution R195 added, and it is why the
// predicate is asked rather than re-derived here.
const amphivoreEcho: EffectDef = {
  graftCopies: 3,
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    const others = self ? self.mods.filter(id => {
      const m = g.entity(id);
      // R131: NOT a card-name exclusion — the grafts this multiplier has
      // nothing to do with are the OTHER MULTIPLIERS (composeParts never
      // multiplies a multiplier), whatever they are called. A second copy
      // of this very card grafted here is one of them; a different multiplier
      // grafted alongside is too.
      return m && m.appliedAs === 'graft' && !isGraftMultiplier(m.card);
    }).length : 0;
    if (!others) g.ev('info', `${ctx.sourceName}: no other graft is attached — there is nothing to triple.`);
    else g.ev('info', `${ctx.sourceName}: 3 copies of each grafted ability (${others} graft${others === 1 ? '' : 's'}), one single trigger.`);
  },
};
card('Amphivore', {
  abilities: [{
    type: 'triggered', events: ['lifeLost'], bounded: true, graftCause: true,
    label: 'trigger three copies of the grafted abilities (one single trigger)',
    when: (g, self, ev) => g.columnDealtCombatDamage(self, ev, ['face']),
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
// Spell. Erase = remove from the game entirely: no bin, no 'died' trigger and
// (R40) no trash; its mods are erased with it. The Glimpse is real (R45) and
// goes to the ERASED unit's controller — a consolation the opponent usually
// gets.
//
// R172: it DOES fire 'despawned' — "not a death, but it is a despawn"
// (R157 §3) — and reaches that by going through the engine choke point. ⚠ The
// divergence inventory listed Celestial Purge as a THIRD hand-rolled erase
// beside helpers.ts and batch-hybrids-ld-a. It never was one: it has always
// CALLED the helpers copy, which is now a shim over `E.eraseFromPlay`.
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
          // R179: off the STACK and into a hand — `from: 'stack'`
          g.toHand(item.controller, item.card!, 'stack');
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
      g.removeFromBin(ctx.controller, t.binCard.index, 'recalled');   // R124
      g.toHand(ctx.controller, name, 'bin');                          // R179
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
// I gain +4/+4 and flying until regroup." — bb/3 0/4 Eel Unit. Flying via
// E.addTempAttr (until regroup).
//
// R179 CLOSED THE ESCALATION THIS BLOCK USED TO CARRY. A recall and a draw
// were the only two channels there were; every other route into a hand was a
// bare `hand.push` that announced nothing, so half this sentence was dead.
// `E.toHand` is now the one hand-entry point and fires 'handEntered' — ONCE
// per move, however many cards moved, which is what "one or more" asks for —
// and this card listens on that ALONE. Keeping 'draw' or 'despawned' beside
// it would double-fire, because both of those routes go through `toHand` now.
//
// "YOUR hand" is the DESTINATION, and `handEntered`'s `seat` is the hand that
// was entered — never the card's owner and never the mover. That distinction
// was won the hard way on the old 'despawned' path, where `seat` was the
// recalled unit's CONTROLLER (leftPlayFacts) and the destination hand was
// stamped separately as `hand`: reading `seat` was wrong in both directions
// once owner ≠ controller (Ralph, Corrupting Blight, Hush Mush, Organic
// Exchange, Rebalance, Stellarspore Harvester, Mindspore Fiend all produce
// it). One field, one meaning, and that whole class is gone.
// "OTHER" excludes the carrier's own card via `ev.data.unit`, which `toHand`
// stamps on the recall route. (Rider of the Tides and Xenopod Progenitor
// print "a player's hand" and are right to ignore `seat` entirely.)
// R69, 2026-08-22: a recalled TOKEN visits the hand too, so it counts here —
// Caleb was asked this about Rider of the Tides ("Oh dang yeah it should also
// trigger it", 2025-04-24). A CACHED unit still does not: it goes to the
// cache, not a hand, and never reaches `toHand`.
// The event carries no region (like 'draw'), so the when() pins the listener
// to the battle region itself (R12).
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
    type: 'triggered', events: ['handEntered'], graftCause: true,
    label: 'I gain +4/+4 and flying until regroup',
    when: (g, self, ev) =>
      g.s.phase === 'battle' && g.s.battle?.region === self.region
      && ev.data?.seat === self.controller      // "YOUR hand" — the destination
      && ev.data?.unit !== self.id,             // "OTHER cards"
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
//
// "A UNIT" INCLUDES A SPELL UNIT, and the RAQ that says so is about THIS CARD:
// "[Solved] Spell Units played when you can 'play a unit from hand'" — *"Q: If
// you decide to use Hooba-Pon Effect to play Spell-Unit, does that units
// 'spell' part happens? A: Yes, the spell part happens and if it resolves, the
// unit will spawn into formation"*, and *"Q: Does that count as 'playing a
// spell' for some triggers? A: Yes."* (docs/digital-rules, R97/R123 sections;
// the same ruling is why Dispatch Courier and Writhing Host both read
// `kind === 'unit' || kind === 'spellUnit'`.) This used to filter the hand on
// `getCard(name).kind === 'unit'` alone, so a spell unit could not even be
// offered — half the printed noun, and the half the designer was asked about.
// It now goes through `playInline`: the spell part resolves, 'spellPlayed'
// fires, and the body — if the spell part did not fizzle — takes the slot.
// A fizzled spell unit spawns nothing and its card is binned, exactly as a
// fizzled spell unit played normally is.
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
          if (isUnitCard(name) && g.canPayCard(seat, name)) {
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
        // R198 `intoFormation`: in battle this play goes on the stack, so
        // "into an open position in my formation" is declared WITH the play
        // (R29's `formationSpot`, taken atomically with the spawn) rather than
        // chosen afterwards — the same distinction `E.placeInFormation`'s own
        // note draws, and the same UFAB report: a card played into the line was
        // never in the region to be answered.
        const played = playInline(g, ctx, name, 'hoobaPlay', seat, { intoFormation: true });
        if (played.unit) g.placeInFormation(played.unit, ctx, { key: 'hoobaPonSlot', source: 'Hooba-Pon' });
        else if (played.outcome === 'fizzled') {
          // a spell unit whose spell part found no target: no body, and the
          // card is binned like any fizzled spell unit.
          // R146(b): no `eraseSelf` check here, and that is not an oversight —
          // this branch is reached only on `outcome: 'fizzled'`, where the
          // effect never ran and so cannot have asked to be erased. (The menu
          // is `isUnitCard`-filtered anyway, and none of the three "Erase me."
          // cards is a unit or a spell unit.)
          g.toBin(seat, name, 'stack');
          g.ev('info', `Hooba-Pon: ${name}'s spell part fizzled — no body joins the formation.`);
        }
      },
    },
  }],
});

// "Draw a card. [Switch1] Starting with you, players may play a unit from
// hand as if it were [Battle]. (The unit's costs still need to be paid.)"
// — b/1 {Battle} Bedlam Occult Spell. The [Switch1] sentence is the bounded
// graftable effect; each player in turn (caster first) may pay for and play
// one unit-kind card from hand, spawning into the effect's region.
//
// "A UNIT" INCLUDES A SPELL UNIT — the same RAQ Hooba-Pon is quoted under
// ("[Solved] Spell Units played when you can 'play a unit from hand'"), and the
// same reading Dispatch Courier and Writhing Host already take. This used to
// filter on `kind === 'unit'` alone; the spell part now happens through
// `playInline` and the body follows it into the region, which is what the
// designer answered.
const insidiousInvite: EffectDef = {
  run: (g, ctx) => {
    const seats: Seat[] = [ctx.controller, ...g.s.players.map(p => p.seat).filter(s => s !== ctx.controller)];
    for (const seat of seats) {
      const hand = g.player(seat).hand;
      const options: { label: string; value: number; card?: string }[] = [{ label: 'decline', value: -1 }];
      hand.forEach((name, i) => {
        if (isUnitCard(name) && g.canPayCard(seat, name)) {
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
      const played = playInline(g, ctx, name, `invite:${seat}`, seat);
      if (played.outcome === 'fizzled') {
        // R146(b): 'fizzled' means the effect never ran, so `played.eraseSelf`
        // cannot be set here — same confirmation as Hooba-Pon above.
        g.toBin(seat, name, 'stack');   // a fizzled spell unit: no body, card to bin
        g.ev('info', `Insidious Invitation: ${name}'s spell part fizzled — no body arrives.`);
      }
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
    // R126: "up to one" — declaring none is legal, so min is 0, not the
    // default 1. Without it an attacking Kraken was forced to recall
    // something whenever any unit in reach was legal, including your own.
    what: 'unit', prompt: 'Minor Kraken: recall up to one target unit with 5 or less defense',
    min: 0,
    restrict: unitRestrict((g, u) => g.effStats(u)[1] <= 5),
  },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) {
      // R126: "up to one" — none declared (or the pick died first) still
      // announces, per 65-effect-conformance.
      g.ev('info', 'Minor Kraken recalls nothing.');
      return;
    }
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
// The Ambush mode is engine-level (printed.ambush, R22). Report #86: "you
// took no actions" is a REDUCER fact — deployment is simultaneous, so the old
// event bookkeeping here (spawned/spellPlayed/modApplied gated on
// `deployPlayer`, a derived initiative marker) could not tell whose action it
// was and misfired both ways. The reducer now stamps `deployActed[seat]` for
// every deployment action except Done and `decide` (owner's ruling: plays,
// mods and ability activations all count), and this trigger just reads it at
// end of turn — after deployment ended, before the next one zeroes the flag.
card('Mirage Walker', {
  abilities: [
    {
      type: 'triggered', events: ['endOfTurn'], bounded: true, graftCause: true,
      label: 'create a 3/3 unit (you took no actions during deployment)',
      when: (g, self) => !(g.s.deployActed?.[self.controller] ?? false),
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
//
// R157 §1 CONFIRMS THIS READING and makes it the pool-wide one: *"Pips aren't
// a relevant part of looking at the cost of a card in Algomancy. And paying X
// replaces the letter X on the printed card temporarily."* `item.x` is the
// paid X and it is the whole cost — not the pips, not pips-plus-X. This card
// was the only one already right; nothing here changes.
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
