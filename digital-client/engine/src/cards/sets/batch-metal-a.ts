/* batch-metal-a — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Cards are scripted here from printed.json data (never
 * hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fizzle vs partial), R6 (mid-resolution payments via ctx.choose),
 * R8 (control change swaps sides straight up), R9 (bounded budgets per card),
 * R12 (regions exclusive — listeners and effects are region-scoped),
 * R115 (created units arrive where their SOURCE is — ctx.region),
 * R31 (triggers between combat damage sub-steps resolve immediately).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch (metal = copies, transforms
 * and token games; the engine has NO copy/transform machinery):
 *  - TOKEN TARGETING (Arcane Echo / Download): FIXED by R64 — TargetSpec has
 *    a 'token' kind (unit tokens and spell tokens alike), so "target token" is
 *    a real cast-time target on both. It used to be a resolution-time
 *    ctx.choose, which is what the playtest report "Download didn't have me
 *    target anything..." was looking at.
 *  - TOKEN COPIES (Arcane Echo / Automaton of Abundance): a token is fully
 *    described by card + tokenStats/counters/x, so copies are re-created via
 *    spawnUnit/createSpellToken. Mods on the original are not copied.
 *  - X COSTS AT RESOLUTION (Celestial Shifter / Deformant): the engine has no
 *    compound activation costs, so X is chosen and paid (and Deformant's
 *    sacrifices happen) at RESOLUTION, Frosted Denial-style. DISCHARGE IS NO
 *    LONGER ONE OF THEM: R64 made its bracket a real cast cost, paid before
 *    the spell is respondable, and the counters removed ARE X.
 *  - BASE-STAT CHANGES (Aberrant Statweaver / Body Swap / Celestial Shifter /
 *    Borrower of Forms) are real REPLACEMENTS of stat layer 2 — the number on
 *    the card changes — not deltas. The one-shots stamp Entity.baseSet via
 *    E.setBase; Statweaver's continuous "your units are base 3/3" radiates
 *    StaticMod.baseP/baseT. Neither stacks: two Statweavers leave a unit on
 *    3/3, and a later base-setter simply overwrites an earlier one
 *    (E.baseStatsOf resolves the two sources last-wins by timestamp).
 *    Counters and until-regroup deltas still apply on top (layer 3).
 * ✔ AUTOMATON OF ABUNDANCE IS A BATCH REPLACEMENT NOW (R104). It used to fire
 *    per 'spawned', so a batch of N identical tokens yielded N extra copies
 *    instead of one per unique — playtest report #60's example. It now reads
 *    the whole creation (one resolving part = one batch, R80's unit) and adds
 *    one copy per unique token KIND. Nothing reaches the stack, and the
 *    module-level `let aoaCopying` guard is gone with the trigger.
 *  - Borrower of Forms copies base stats, counters and temporary stat changes
 *    of the erased unit (relayed through battle counters into a self-spawn
 *    trigger). Card text, attributes and mods are NOT copied (no transform
 *    machinery) — it stays "Borrower of Forms" with the stolen body.
 *  - Ancient One copies TRIGGERED abilities of adjacent allies only, and only
 *    while a formation exists (adjacency is a battle concept). Copied "when
 *    I ..." abilities read the Ancient One as "I"; bounded copies burn a
 *    per-copy budget on the Ancient One (R9). Activated abilities, statics
 *    and graft composition of neighbours are not copied (see PARKED).
 *  - Biomass Devourer reads "nontoken" off the death event's `token` FACT
 *    (R70 — the dead entity is gone by trigger time, which is why the fact
 *    rides the event; this used to be a match on the rendered message). Still
 *    true: an Unstable-erased card has no bin copy to erase, but the paid
 *    counters land anyway.
 *  - Celestial Fluxmorph's donated "[Augment] when I despawn" does not fire
 *    when the HOST is recalled — E.recall erases mods before firing the
 *    despawn event (engine limitation; death and self-play despawn do fire).
 *  - Download's steal removes the token from its old formation but cannot
 *    slot it into the thief's (no mid-battle formation-join primitive; R8's
 *    "joins the new controller's formations" is otherwise honored: the token
 *    swaps sides, its region and owner unchanged).
 *  - Deformant's "delete all units" is region-scoped (R12) and unit cost is
 *    the printed mana (X-cost cards count as 0).
 *
 * PARKED (needs engine primitives that do not exist; subsets implemented):
 *  - (Dispatch Courier UNPARKED by R97, round 17 — see the card. The play-timing
 *    gating card code could not reach is now `PlayPermission.playAtHaste`,
 *    summed by `E.hastePlayAllowance` and asked at all three gates.)
 *  - (Cosmic Conspirator UNPARKED by R104, BOTH halves — see the card. The
 *    spell-token half never needed an event: a replacement is consulted at the
 *    creation call, so `E.createSpellToken` is a seam without dispatching
 *    anything. The Robot half stopped creating-then-erasing, which is what
 *    playtest report #64 was really about.)
 *  - Ancient One (activated/static half): the gap is NEIGHBOUR projection, not
 *    "own lists only" — this entry used to say apply.ts surfaces activated
 *    abilities from a unit's own lists, which stopped being true when
 *    pushActivatedOptions began offering a card's own augmentText AND every
 *    augment mod's augmentText (apply.ts). What card code still cannot do is
 *    project an ADJACENT ALLY's activated abilities or statics onto the
 *    Ancient One: both are read off the holder's own card definition, and
 *    there is no seam for "borrow that unit's". Triggered abilities are
 *    delivered (above).
 */
import type { Entity, EntityId, EventType, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, type EffectDef, type TokenRequest } from '../dsl.ts';
import { selfOf, isEnt, unslot, eraseFromPlay } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** all tokens (unit tokens + spell tokens) in a region, absent ones excluded */
function tokensInRegion(g: E, region: number): Entity[] {
  return Object.values(g.s.entities).filter(e =>
    e.region === region && !e.absent &&
    ((e.kind === 'unit' && !!e.token) || e.kind === 'spellToken'));
}

/** "my column deals combat damage to an opponent", read off the aggregated
 * combat lifeLost event (Amphivore's approximation): my column connects if it
 * is attacking unblocked, or blocked/blocking with Piercing. */
function myColumnConnected(g: E, self: Entity, ev: { data?: Record<string, unknown> }): boolean {
  if (g.s.phase !== 'battle' || ev.data?.['why'] !== 'combat' || ev.data?.['seat'] === self.controller) return false;
  const b = g.s.battle;
  if (!b) return false;
  const atkCi = b.columns.findIndex(col => col.includes(self.id));
  if (atkCi !== -1) {
    const alive = b.columns[atkCi]!.filter(id => g.entity(id));
    return b.blocks[atkCi] === undefined || g.colAttrs(alive).has('Piercing');
  }
  const blkCol = Object.values(b.blocks).find(col => col.includes(self.id));
  return !!blkCol && g.colAttrs(blkCol.filter(id => g.entity(id))).has('Piercing');
}

// ───────────────────────────── the cards ──────────────────────────────

// "[Augment] Your units are base 3/3." — mm/3 3/3 {Virus} {Unstable} Luminary
// Unit. A statics-only augment (augmentable) — live when played normally
// (Manual Q&A), donated when applied as an augment/Virus (staticsFor anchors
// mod-carried statics on the host, so "your" reads the host's controller).
// "Base 3/3" is a REPLACEMENT, not a buff: baseP/baseT rewrite stat layer 2 —
// the literal number on the card — so a 1/1 and a 7/5 both land on exactly
// 3/3, two Statweavers do not stack, and counters / until-regroup deltas /
// everyone else's +X/+X still apply on top (layer 3).
card('Aberrant Statweaver', {
  augmentable: true,
  statics: [{
    affects: (_g, self, t) => t.kind === 'unit' && t.controller === self.controller,
    baseP: 3, baseT: 3,
  }],
});

// "[Augment] I have all abilities of adjacent allies. (This includes modded
// abilities.)" — mm/2 1/1 Ancient Mimic Unit. ⚠ approximation (header): a
// bookkeeping when() (always false — Mirage Walker's pattern) scans adjacent
// allies on every dispatched event and queues copies of their matching
// TRIGGERED abilities (own card + augment-donated text) as the Ancient One's
// own triggers. "I" in a copied ability is the Ancient One; ab.when runs with
// the Ancient One as self. Bounded copies burn a per-source budget on the
// Ancient One (R9). Activated abilities / statics: PARKED (header).
const AO_EVENTS: EventType[] = [
  'spawned', 'died', 'despawned', 'draw', 'lifeLost', 'damage',
  'countersChanged', 'modApplied', 'spellPlayed', 'targeted',
  'attackDeclared', 'attacked', 'blocksDeclared', 'blocked',
  'afterCombat', 'endOfTurn',
];
let aoScanning = false;   // reentrancy guard: two adjacent Ancient Ones must not mimic each other
card('Ancient One', {
  augmentText: [{
    type: 'triggered', events: AO_EVENTS,
    label: 'I have all abilities of adjacent allies (triggered abilities)',
    when: (g, self, ev) => {
      if (aoScanning) return false;
      aoScanning = true;
      try {
        const src = ev.data?.['unit'] as EntityId | undefined;
        for (const n of g.adjacentInFormation(self.id)) {
          if (n.controller !== self.controller) continue;
          const sources: { cardName: string; prefix: 'ability' | 'augment' }[] = [
            { cardName: n.card, prefix: 'ability' },
            { cardName: n.card, prefix: 'augment' },
          ];
          for (const modId of n.mods) {
            const m = g.entity(modId);
            if (m && m.appliedAs === 'augment') sources.push({ cardName: m.card, prefix: 'augment' });
          }
          for (const { cardName, prefix } of sources) {
            if (cardName === 'Ancient One') continue;   // no recursive mimicry
            const def = getCard(cardName);
            const list = prefix === 'ability' ? def.abilities : def.augmentText;
            (list ?? []).forEach((ab, idx) => {
              if (ab.type !== 'triggered' || !ab.events.includes(ev.type)) return;
              if (ab.self && src !== self.id) return;       // "when I ...": I = the Ancient One
              if (ab.when && !ab.when(g, self, ev)) return; // conditions read me as "I" (R1: now)
              const key = `ao:${prefix}:${cardName}#${idx}`;
              if (ab.bounded) {
                if ((self.budgets[key] ?? 0) > 0) return;
                self.budgets[key] = 1;
              }
              g.s.triggerQueue.push({
                sourceId: self.id, sourceCard: cardName, controller: self.controller,
                abilityIndex: idx,
                label: `${self.card} (as ${cardName}): ${ab.label}`,
                parts: [{ effectKey: `${prefix}:${cardName}#${idx}`, targets: [] }],
                event: { type: ev.type, msg: ev.msg, ...(ev.data ? { data: ev.data } : {}) },
              });
              g.s.triggerOrderedSeats = [];
            });
          }
        }
      } finally { aoScanning = false; }
      return false;   // the mimic itself never queues — the copies above do
    },
    effect: { run: () => { /* copies are queued in when() — this never runs */ } },
  }],
});

// "[Switch1] Create a copy of target token." — m/2 2/1 {Battle} Arcane Mimic
// Spell. R64: "target token" is a CAST-TIME target — unit tokens and spell
// tokens both, either side's. Both copies are created where the SOURCE is,
// i.e. ctx.region (R115) — cast in the enemy region, the unit copy stays there.
// tokenStats/counters/x are copied; mods are not.
const echoCopy: EffectDef = {
  targets: { what: 'token', prompt: 'Arcane Echo: create a copy of target token' },
  // R69: the token's NAME is the target's — "a copy of target token" can be a
  // Fireball, a Robot, a Wraith, a Hooba-God, anything a token is. No fixed
  // list can be true, so this declares `createsAny` instead of lying with one.
  createsAny: true,
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t)) return;
    const orig = g.entity(t.id);
    if (!orig) {
      g.ev('info', 'Arcane Echo: the token is gone — no copy is created.');
      return;
    }
    if (orig.kind === 'spellToken') {
      g.createSpellToken(ctx.controller, orig.card, orig.x ?? 0, ctx.region);
    } else {
      g.spawnUnit(ctx.controller, orig.card, ctx.region, {
        token: true,
        ...(orig.tokenStats ? { tokenStats: [...orig.tokenStats] as [number, number] } : {}),
        ...(orig.counters ? { counters: orig.counters } : {}),
      });
    }
  },
};
card('Arcane Echo', {
  spellEffect: echoCopy,
  graftEffect: { bounded: true, effect: echoCopy },
});

// "[Augment] If you would create one or more unit tokens, instead create
// those tokens plus an additional copy of each unique token you created." —
// mm/5 2/6 Automaton Construct Unit.
//
// UNPARKED as a real BATCH replacement (R104). It used to be a trigger on
// every unit-token 'spawned' event, and report #60 named exactly what that got
// wrong: "Automaton of Abundance fires per spawn so N identical tokens yield N
// copies instead of one per unique." A trigger cannot see a creation; it only
// ever sees one spawn. `replaceTokenBatch` is handed the WHOLE creation — one
// resolving part, the same unit R80 gave effect damage — so "each unique token
// you created" finally has a creation to be unique across. The module-level
// `let aoaCopying` guard is deleted with the trigger: an extra is not part of
// the batch that produced it, and the engine's own latch says so once.
//
// "UNIQUE" IS BY TOKEN KIND — the card NAME — and the X is not part of it. So
// a batch of three Robots yields ONE extra Robot, and a batch of a Fireball 2
// and a Fireball 5 yields ONE extra Fireball. The basis is the engine's own
// definition of identity: `Entity.card` is what bins, "name a card" effects,
// counters-by-name, DECK_LIST and the inspector all key off (R101 makes the
// argument at length for the transform), and every Robot is the one registered
// card `Robot` whatever number it is wearing. The X is a quantity ON the token,
// not a different token — which is also why Cosmic Conspirator's reminder text
// can say "(With the same X value.)" while swapping the KIND.
//
// THE COPY TAKES THE FIRST OF ITS KIND in the batch. "A copy of each unique
// token you created" has to copy something, and the first is the deterministic
// answer that does not need a ruling (a "largest X" reading would be a strictly
// better card and nothing prints it). Flagged in R104 as the one place the
// uniqueness reading had a choice.
//
// "UNIT TOKENS" only, printed: the batch may contain spell tokens (Biotoxicity's
// Poisons) and this ignores them. "YOU would create": the batch belongs to the
// creating seat, and `self` is the ANCHOR — this card's body, or the HOST when
// the text arrives as an augment mod.
card('Automaton of Abundance', {
  augmentable: true,
  replaceTokenBatch: (_g, self, batch) => {
    const seen = new Set<string>();
    const extra: TokenRequest[] = [];
    for (const r of batch) {
      if (r.form !== 'unit' || r.seat !== self.controller) continue;
      if (seen.has(r.name)) continue;              // one copy per unique KIND
      seen.add(r.name);
      extra.push({ ...r });
    }
    return extra.length ? extra : null;
  },
});

// "[Augment] Whenever a nontoken unit dies, you may pay [two] to erase it and
// put two +1/+1 counters on me." — m/2 3/2 Alien Robot Unit. Text-box
// [Augment]: live when played normally, donated on augment ("me" = the host).
// 'died' listeners are region-scoped (R12). R70: "nontoken" is read off the
// death event's token flag; the erase removes the card from its owner's bin.
card('Biomass Devourer', {
  augmentText: [{
    type: 'triggered', events: ['died'],
    label: 'you may pay [two] to erase the dead unit — I get two +1/+1 counters',
    when: (_g, _self, ev) => ev.data?.token !== true,
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) { g.ev('info', 'Biomass Devourer: the carrier is gone — no counters.'); return; }
        if (g.openMana(ctx.controller) < 2) { g.ev('info', 'Biomass Devourer: cannot pay [two] — no counters.'); return; }
        const name = ctx.event?.data?.['card'] as string | undefined;
        if (!name) { g.ev('info', 'Biomass Devourer: the death event names no card — nothing to erase.'); return; }
        const pay = ctx.choose('devour', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Biomass Devourer: pay [two] to erase ${name} and get two +1/+1 counters?`,
          options: [{ label: 'pay 2', value: 1 }, { label: 'decline', value: 0 }],
        }) as number;
        if (!pay) { g.ev('info', 'Biomass Devourer: the [two] is declined — no erase, no counters.'); return; }
        g.payMana(ctx.controller, 2);
        const seats: Seat[] = [];
        const evSeat = ctx.event?.data?.['seat'] as Seat | undefined;
        if (evSeat !== undefined) seats.push(evSeat);
        for (const p of g.s.players) if (!seats.includes(p.seat)) seats.push(p.seat);
        for (const s of seats) {
          const bin = g.player(s).bin;
          const i = bin.lastIndexOf(name);
          if (i !== -1) {
            bin.splice(i, 1);
            g.ev('erased', `${name} is ERASED from ${g.pname(s)}'s bin.`, { card: name, seat: s });
            break;
          }
        }
        g.addCounters(self, 2);
      },
    },
  }],
});

// "[Switch1] Exchange the base stats of two target units until regroup.
// (With each other.)" — m/2 2/1 {Battle} Arcane Spell. Two targets collected
// at cast (count/min 2). The exchange REWRITES each unit's base (layer 2, see
// E.setBase) rather than adding a delta: it is "exchange the base stats", so
// counters and temp changes keep applying on top, a later base-setter
// overwrites it rather than compounding with it, and the log says what
// happened ("base becomes 4/4") instead of a misleading -X/+X. Regroup clears
// it (R11 step 3). Needs both targets alive at resolution.
const bodySwap: EffectDef = {
  targets: { what: 'unit', prompt: 'Body Swap: exchange the base stats of two target units until regroup', count: 2, min: 2 },
  run: (g, ctx) => {
    const a = ctx.targets[0];
    const b = ctx.targets[1];
    if (!isEnt(a) || !isEnt(b) || !g.entity(a.id) || !g.entity(b.id)) {
      g.ev('info', 'Body Swap: needs both targets — no effect.');
      return;
    }
    const [ap, at] = g.baseStatsOf(a);
    const [bp, bt] = g.baseStatsOf(b);
    g.setBase(a, bp, bt);
    g.setBase(b, ap, at);
  },
};
card('Body Swap', {
  spellEffect: bodySwap,
  graftEffect: { bounded: true, effect: bodySwap },
});

// "Erase target unit. I become an exact copy of that unit. (I copy all stat
// changes, counters, card text and mods)." — mmm/7 2/2 {Battle} Squid Mimic
// Spell Unit. ⚠ header: stats/counters/temp copy only, no text/mods (no
// transform machinery). The spell erases the target and relays its body
// through battle counters; the spell unit's own spawn trigger claims it.
// Target gone at resolution → the spell fizzles and Borrower is binned (R5).
card('Borrower of Forms', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Borrower of Forms: erase target unit — I become a copy of it' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) {
        g.ev('info', 'Borrower of Forms: the target is gone — there is no form to borrow.');
        return;
      }
      // the base it HAS (layer 2 included — a Formless'd or Statweavered
      // body is the body you are borrowing), not the one it was printed with
      const [p, dt] = g.baseStatsOf(t);
      const r = ctx.region;
      g.bumpBattleCounter(r, 'bof:pending', 1);
      g.bumpBattleCounter(r, 'bof:p', p);
      g.bumpBattleCounter(r, 'bof:t', dt);
      g.bumpBattleCounter(r, 'bof:c', t.counters);
      g.bumpBattleCounter(r, 'bof:tp', t.tempPower);
      g.bumpBattleCounter(r, 'bof:tt', t.tempToughness);
      eraseFromPlay(g, t);
    },
  },
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: 'I become a copy of the erased unit (stats, counters, temp changes)',
    when: (g, self) => g.battleCounter(self.region, 'bof:pending') > 0,
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) return;
        const r = ctx.region;
        const take = (k: string): number => {
          const v = g.battleCounter(r, k);
          if (v) g.bumpBattleCounter(r, k, -v);
          return v;
        };
        const pending = take('bof:pending');
        const p = take('bof:p'); const t = take('bof:t');
        const c = take('bof:c');
        const tp = take('bof:tp'); const tt = take('bof:tt');
        if (!pending) return;
        self.tokenStats = [p, t];
        g.ev('info', `${self.card} takes the erased unit's form: base ${p}/${t}.`);
        if (c) g.addCounters(self, c);
        if (tp || tt) g.addTemp(self, tp, tt);
      },
    },
  }],
});

// "When I spawn or become modded, put a +1/+1 counter on each of your units.
// [Augment] When I despawn, remove all counters from your units." — m/2 1/1
// Cosmic Spirit {Virus} Unit. The first sentence stays with the card (plain
// ability); the [Augment] sentence transfers ("I" = the host). "Your units"
// is region-scoped (R12/R25). Despawn = ANY leave-play (died + despawned —
// Bloated Manablub's precedent); ⚠ header: the donated form misses host
// RECALLS (mods are erased before the despawn event fires).
card('Celestial Fluxmorph', {
  abilities: [{
    type: 'triggered', events: ['spawned', 'modApplied'],
    label: 'put a +1/+1 counter on each of your units',
    when: (_g, self, ev) =>
      (ev.type === 'spawned' && ev.data?.['unit'] === self.id) ||
      (ev.type === 'modApplied' && ev.data?.['host'] === self.id),
    effect: {
      run: (g, ctx) => {
        const mine = g.unitsOf(ctx.controller, ctx.region);
        if (!mine.length) { g.ev('info', 'Celestial Fluxmorph: you control no unit here — no counters.'); return; }
        for (const u of mine) g.addCounters(u, 1);
      },
    },
  }],
  augmentText: [{
    type: 'triggered', events: ['died', 'despawned'], self: true,
    label: 'when I despawn, remove all counters from your units',
    effect: {
      run: (g, ctx) => {
        let stripped = 0;
        for (const u of g.unitsOf(ctx.controller, ctx.region)) {
          if (u.counters) { g.addCounters(u, -u.counters); stripped++; }
        }
        if (!stripped) g.ev('info', 'Celestial Fluxmorph: none of your units carries a counter — nothing to remove.');
      },
    },
  }],
});

// "[Augment] [x]: I become base X/X until regroup." — m/2 2/2 {Haste} Cosmic
// Alien Unit. An activated ability inside the [Augment] box: usable on the
// card itself when played normally (via 'augment') and on a host when
// donated (via { mod }). ⚠ header: X is chosen and paid at RESOLUTION
// (Frosted Denial's pattern); "base X/X" is a temp delta from the base, so
// counters stay on top and regroup restores the printed body.
card('Celestial Shifter', {
  augmentText: [{
    type: 'activated', cost: {},
    label: '[x]: I become base X/X until regroup',
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) { g.ev('info', 'Celestial Shifter: the carrier is gone — no re-base.'); return; }
        const open = g.openMana(ctx.controller);
        const opts = [];
        for (let x = 0; x <= open; x++) opts.push({ label: `X = ${x}`, value: x });
        const x = ctx.choose('shiftX', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Celestial Shifter: choose X (paid now — engine approximation); I become base X/X until regroup',
          options: opts,
        }) as number;
        g.payMana(ctx.controller, x);
        if (x === 0) g.ev('info', `Celestial Shifter: X = 0 — ${self.card} becomes base 0/0.`);
        g.setBase(self, x, x);   // layer 2: "become base X/X", not +X/+X
      },
    },
  }],
});

// "Negate all activated and triggered effects." — mm/3 4/1 {Battle}
// Technology Spell. Every triggered/activated item on the stack (any
// controller) is negated; spells, viruses and ambushes are untouched.
card('Containment Protocol', {
  spellEffect: {
    run: (g, _ctx) => {
      const hits = g.s.stack.filter(i => i.kind === 'triggered' || i.kind === 'activated');
      if (!hits.length) { g.ev('info', 'Containment Protocol: no activated or triggered effects to negate.'); return; }
      for (const i of hits) g.negate(i.id);
    },
  },
});

// "If you would create a Robot, Poison, Crystal or Fireball, you may instead
// create a token of any of these types. (With the same X value.)" — m/3 3/3
// Luminary Unit.
//
// FULLY UNPARKED (R104), and it is the card playtest report #64 was filed
// against: "Biotoxicity didn't give me the choice of what kinds of tokens I
// wanted even though I had Cosmic Conspirator." Two defects, both structural:
//
//  1. THE SPELL-TOKEN HALF WAS COMPLETELY DEAD. The old implementation was a
//     'spawned' trigger, and `E.createSpellToken` fires no dispatchable event
//     at all — so a Poison, Crystal or Fireball creation could never be heard.
//     Biotoxicity creates three Poisons; the card saw none of them. A
//     replacement is CONSULTED at the call, so it needs no event: the seam is
//     the creation itself, in both directions.
//  2. THE ROBOT HALF ASKED TOO LATE. The trigger really created the Robot,
//     fired a `spawned` for it, asked, and then ERASED it — so a token that
//     "was never created" was on the board and in the event stream, and every
//     spawn listener in the region heard about it. `replaceTokenCreation` runs
//     BEFORE anything exists, which is what "you would create" means.
//
// AND IT IS ASKED ONCE PER TOKEN. Biotoxicity's three Poisons are one batch of
// three requests, each offered separately, so the player picks a kind for each
// — which is the shape the report describes wanting.
//
// THE CHOICE IS RAISED WITH `E.askInResolution`, the seam `E.glimpse` uses:
// `partChoose` is non-null only inside a resolving part, which is where token
// creation lives. The decision suspends the whole part and replays it (R85) —
// which is exactly why the substitution must happen before any state is
// mutated, and it is. Outside a resolving part (an engine-internal creation, a
// direct call from a test) there is nothing to hang a decision on, so this
// declines and SAYS SO, the way glimpse's "no decision window" branch does: a
// silent default is what produces playtest reports.
//
// "WITH THE SAME X VALUE" is `TokenRequest.x`, which is one field for a spell
// token's X and a unit token's spawn counters (Robot X is "I spawn with X
// +1/+1 counters on me"). That is what lets the number survive a swap in
// either direction.
//
// NOT AN [Augment] card, unlike the other six in this class: the text sits in
// the main box, so it is live only while this card is a unit in play.
const CONSPIRATOR_KINDS = ['Robot', 'Poison', 'Crystal', 'Fireball'] as const;
card('Cosmic Conspirator', {
  replaceTokenCreation: (g, self, req) => {
    if (req.seat !== self.controller) return null;               // "if YOU would create"
    if (!(CONSPIRATOR_KINDS as readonly string[]).includes(req.name)) return null;
    const pick = g.askInResolution('conspire', {
      kind: 'payOrDecline', seat: self.controller,
      prompt: `Cosmic Conspirator: create a token of another type instead of the ${req.name} ${req.x}?`,
      options: [
        { label: `keep the ${req.name} ${req.x}`, value: 'keep' },
        ...CONSPIRATOR_KINDS.filter(k => k !== req.name)
          .map(k => ({ label: `${k} ${req.x}`, value: k, card: k })),
      ],
    });
    if (pick === null) {
      g.ev('info',
        `Cosmic Conspirator: the ${req.name} is created outside a resolution window, so there `
        + 'is nowhere to ask — it is kept as printed.');
      return null;
    }
    if (pick === 'keep' || typeof pick !== 'string') return null;
    // Robot is the only unit token of the four; the other three are spell
    // tokens. The form travels with the kind, so the caller never has to know.
    return { ...req, name: pick, form: pick === 'Robot' ? 'unit' : 'spell' };
  },
});

// "Sacrifice me and another ally: Delete all units with cost equal to the
// total number of counters on us." — m/2 2/2 Robot Spirit Unit.
//
// ⚠ STILL PARKED, and the missing piece is named by a { todo: true } test in
// test/26-metal-a.test.ts: `AbilityCost` has no COMPOUND shape, so "me AND
// another ally" cannot be expressed as one cost and is still paid at
// RESOLUTION. `sacrificeSelf` and `sacrificeOther` exist separately and cannot
// be combined — paying them independently would let the first half resolve
// when the second cannot.
//
// R77 does fix the offer half: "another ally" is a board condition, so the
// ability is no longer OFFERED when this is the only unit you have. It used to
// activate, print "no other ally to sacrifice", and do nothing.
card('Deformant', {
  abilities: [{
    type: 'activated', cost: {},
    label: 'sacrifice me and another ally: delete all units with cost equal to our counters',
    usableWhen: (g, self, seat) =>
      g.unitsOf(seat, self.region).some(u => u.id !== self.id),
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) { g.ev('info', 'Deformant: the carrier is gone — no effect.'); return; }
        const allies = g.unitsOf(ctx.controller, ctx.region).filter(u => u.id !== self.id);
        if (!allies.length) { g.ev('info', 'Deformant: no other ally to sacrifice — no effect.'); return; }
        const pick = ctx.choose('deform', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Deformant: sacrifice which other ally?',
          options: allies.map(u => ({ label: u.card, value: u.id, card: u.card })),
        }) as EntityId;
        const ally = g.entity(pick);
        if (!ally) return;
        const total = self.counters + ally.counters;
        g.destroy(self, 'is sacrificed');
        g.destroy(ally, 'is sacrificed');
        g.ev('info', `Deformant: deleting all units with cost ${total}.`);
        for (const u of g.unitsIn(ctx.region)) {
          const m = getCard(u.card).mana;
          if ((m === 'X' ? 0 : m) === total) g.destroy(u, 'is deleted');
        }
      },
    },
  }],
});

// "[Switch1] /[Remove X +1/+1 counters from allies]: I deal X damage to
// target unit." — m/1 {Battle} Elemental Technology Spell. The removal is
// the effect's own cost, chosen counter by counter at resolution
// (plan-then-commit: the picks are tallied first, then committed together
// with the damage). "Allies" = your units in this region (R12).
const dischargeZap: EffectDef = {
  // R64: the bracket is an ADDITIONAL COST, so it is paid at cast, before the
  // item is on the stack and before anyone can respond — and the counters
  // removed ARE X. It used to be a mid-resolution ctx.choose loop, which meant
  // Rashi's opponent got to answer a Discharge whose size was still unchosen,
  // and a negate would have refunded a cost that had never been paid.
  castCost: { kind: 'removeCounters', from: 'allies', n: 'X' },
  xZeroWarning: 'X = 0 deals no damage',   // R74
  targets: { what: 'unit', prompt: 'Discharge: I deal X damage to target unit' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) return;
    const x = ctx.x ?? 0;
    if (x > 0) g.dealEffectDamage(ctx, g.entity(t.id)!, x);
    else g.ev('info', 'Discharge: X is 0 — no damage.');
  },
};
card('Discharge', {
  spellEffect: dischargeZap,
  graftEffect: { bounded: true, effect: dischargeZap },
});

// "[Augment] Each turn, you may play a unit during the mana step as if it had
// [Haste]." — mm/2 2/1 Robot Horse Unit. UNPARKED by R97 (report #74, WEHH
// 2026-08-22: "Dispatch Courier didn't give me the option to play a card with
// haste"). It did not, because nothing anywhere asked: play-timing gating
// lives in apply.ts and had no seam card code could reach.
//
// The rules half was already settled, and settles what "the mana step" means.
// Caleb's Discord, rules-questions: "that symbol is haste, meaning you can
// play it during the mana step", and "There is no priority during the mana
// step, but you can play haste cards and resources as special actions"; asked
// what the mana step is, nyarlathotep8457: "Yes the Mana step is the resources
// step of the planning phase". So the printed "during the mana step" IS this
// engine's R18 haste step.
//
// R97 added the seam: `PlayPermission.playAtHaste` (dsl.ts), gathered and
// SUMMED by `E.hastePlayAllowance`, asked through `E.mayPlayAtHaste` at the
// three gates that have to agree — `startHasteStep`'s canHaste (which skips
// the step outright, so it is the one that made the card invisible),
// `legalActions`' haste branch, and `playAtTiming`'s planning branch — and
// charged against `s.hastePlaysUsed`, the per-seat sibling of R43's
// `hasteManaSpent` (a PLAY is not an ability activation, so `Entity.budgets`
// never sees one). The haste step happens once a turn, so its window IS the
// printed "Each turn".
//
// WHAT THIS CARD DECIDES, and what it does not:
//  · "a UNIT" — so `kind` must be a unit. A SPELL UNIT counts: RAQ "[Solved]
//    Spell Units played when you can 'play a unit from hand'" — "Q: If you
//    decide to use Hooba-Pon Effect to play Spell-Unit, does that units
//    'spell' part happens? A: Yes, the spell part happens and if it resolves,
//    the unit will spawn into formation", and "Q: Does that count as 'playing
//    a spell' for some triggers? A: Yes."
//  · "Each turn" — an allowance of exactly 1. Two Couriers are two plays,
//    which is why R97 sums grantors instead of OR-folding them.
//  · [Augment] — the grant belongs to the ANCHOR's controller, so augmented
//    onto a host it is the host's controller who may play the unit. Same rule
//    as R95's Rook and every other anchored text.
//  · It does NOT decide the zone. The printed line says "play a unit" with no
//    zone in it, so any zone `playAtTiming` reaches in the haste step is fair
//    — hand today, and a cache release already had its own [Haste] route (R42).
//  · It does NOT get to say yes to a {Battle} card. RAQ "[Solved] Dispatch
//    Courier vs Battle Timing": "No, despite gaining :haste: they can still
//    only be played during :battle:." That refusal is general, so it lives in
//    `E.hastePlayAllowance` above every grantor, not here.
//
// ⚠ STILL PARKED, and NOT unparked by this: Writhing Host ("If I am in your
// bin, you may play a unit as if it had [Haste] by erasing me as an additional
// cost") — the grantor is a card in the BIN, which `anchored()` does not walk,
// and the grant carries an additional COST, which `PlayCtx` has no room for.
// Slurpr ("You can apply other mods during [Haste] as if it was deployment")
// is the MOD-timing twin and belongs to R95's family, not this one. Rook is
// already live on R95.
card('Dispatch Courier', {
  augmentable: true,
  playPermissions: [{
    playAtHaste: (_g, self, ctx) =>
      (ctx.seat === self.controller
        && (ctx.card.kind === 'unit' || ctx.card.kind === 'spellUnit'))
        ? 1 : 0,
  }],
});

// "Gain control of target token. You may choose new targets for spells
// controlled this way." — mm/1 4/3 {Battle} Technology Spell.
// (This note used to read "⚠ the token is picked at resolution (not
// stack-targetable)" — six lines above the R64 spec that makes it a cast-time
// target. It had outlived its own code; corrected here.)
// The steal is R8's straight swap: controller flips (owner and region stay),
// the token leaves its old formation. A stolen spell token is cast fresh by
// its new controller, so "choose new targets" is automatic.
card('Download', {
  spellEffect: {
    // R64: "target token" is a CAST-TIME target — the playtest report was
    // "Download didn't have me target anything…", and it did not: the token
    // was picked at resolution, so the opponent responded to a theft with no
    // victim named and Mohruung-style "when I become targeted" never fired.
    targets: {
      what: 'token', prompt: 'Download: gain control of target token',
      restrict: (_g, t, ctx) => 'controller' in t && t.controller !== ctx.ally,
    },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t)) { g.ev('info', 'Download: no token is targeted — nothing changes hands.'); return; }
      const tok = g.entity(t.id);
      if (!tok || tok.controller === ctx.controller) {
        g.ev('info', 'Download: the token is gone or already yours — nothing changes hands.');
        return;
      }
      tok.controller = ctx.controller;
      unslot(g, tok.id);   // R8: it swaps sides — out of its old formation
      g.ev('info', `${g.pname(ctx.controller)} gains control of ${tok.card}.`);
    },
  },
});

// "[Augment] When my column deals combat damage to an opponent, sacrifice me.
// If you do, look at that player's hand and discard a card from it." — mm/1
// 1/1 {Haste} {Evasive} Cosmic Alien Unit. Text-box [Augment]: live when
// played normally, donated on augment ("me" = the host). Fires between combat
// damage sub-steps and resolves immediately (R31). ⚠ column-connect read off
// the aggregated combat lifeLost event (Amphivore's approximation).
//
// R73 (Bena's ruling, 2026-08-22): "sacrifice me" is a CAST COST. The report
// was "Technically, Eldritch Dreamtender needs to be sacrificed for its ability
// to go on the stack, but it's still visually in play while resolving its
// trigger" — and it is right. The sacrifice used to be a g.destroy() inside
// effect.run, at RESOLUTION, so the unit sat on the board through a whole
// priority window first.
//
// Both halves are in place now. R64/R67 settle bracketed costs in the cast
// window for spells, activated AND triggered items alike (buildTriggerItem ->
// collectTargets -> collectCastCosts), and R73 added the one cost this card
// needed: `sacrificeUnits` with `from: 'self'`, resolved through item.sourceId
// exactly as `removeCounters`' own `from: 'self'` is.
//
// ⚠ The consequences are understood and INTENDED, not side effects: the
// sacrifice is now mandatory (no "if you do" to decline), unrespondable (a
// choice-free cost is charged with no decision and no suspension), and the
// whole trigger is skipped when the source is already dead by settle time
// (an unpayable cost sets part.spent — R5). That is what "sacrificed for its
// ability to go on the stack" means. The printed line is effect prose with an
// if-you-do rider rather than a printed [cost]; the ruling reads it as a cost
// anyway.
card('Eldritch Dreamtender', {
  augmentText: [{
    type: 'triggered', events: ['lifeLost'],
    label: "sacrifice me — look at that player's hand and discard a card",
    when: (g, self, ev) => myColumnConnected(g, self, ev),
    effect: {
      // R73: paid on the way to the stack, not here. By the time run() is
      // called the Dreamtender is already in its owner's bin — so there is no
      // selfOf() to read, and there deliberately is no "if you do" check
      // either: an unpaid cost means this run() never happens at all.
      castCost: { kind: 'sacrificeUnits', from: 'self', n: 1 },
      run: (g, ctx) => {
        const who = ctx.event?.data?.['seat'] as Seat | undefined;
        if (who === undefined) return;
        const hand = g.player(who).hand;
        g.ev('info', `Eldritch Dreamtender reveals ${g.pname(who)}'s hand: ${hand.join(', ') || '(empty)'}.`);
        if (who !== ctx.controller) g.revealHandTo(ctx.controller, who);
        if (!hand.length) return;
        const pick = ctx.choose('dream', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Eldritch Dreamtender: discard a card from ${g.pname(who)}'s hand`,
          options: hand.map((name, i) => ({ label: name, value: i, card: name })),
        }) as number;
        if (hand[pick] === undefined) return;
        // R40: discarding from hand is TRASHING, and the trasher is the owner
        // of the bin the card enters — `who`, not the Dreamtender's controller.
        g.discardFromHand(who, pick);
      },
    },
  }],
});

// "[Augment] Whenever I am modded or applied as a mod, put two +1/+1 counters
// on me." — m/2 0/1 Technology Strider {Virus} Unit. One trigger covers both
// halves: as a unit in play, 'modApplied' with me as the host; donated as a
// mod, the SAME event fires the transferred text with "me" = the host — and
// the application that attached it is itself such an event (attachMod fires
// after the mod joins the host, so its own arrival counts).
card('Evolutionary Experiment', {
  augmentText: [{
    type: 'triggered', events: ['modApplied'],
    label: 'put two +1/+1 counters on me',
    when: (_g, self, ev) => ev.data?.['host'] === self.id,
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (self) g.addCounters(self, 2);
      },
    },
  }],
});
