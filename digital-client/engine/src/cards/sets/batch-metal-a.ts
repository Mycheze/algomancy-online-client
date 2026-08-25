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
 *  - X COSTS AT RESOLUTION (Celestial Shifter / Deformant): X is chosen and
 *    paid (and Deformant's sacrifices happen) at RESOLUTION, Frosted
 *    Denial-style. DISCHARGE IS NO LONGER ONE OF THEM: R64 made its bracket a
 *    real cast cost, paid before the spell is respondable, and the counters
 *    removed ARE X. ⚠ The old reason given here — "the engine has no compound
 *    activation costs" — was STALE for Deformant: one `AbilityCost` carries
 *    `sacrificeSelf` and `sacrificeOther` together and both are paid in the
 *    one cast window. What blocks Deformant is the RECEIPT (its effect needs
 *    the sacrificed units' COUNTERS and neither writer records them), plus
 *    two engine edits on the `CastCost` route. Spelled out on the card.
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
 *    one copy per unique token — which R157 §24 defines as the (name, X) PAIR,
 *    so a Robot 2 and a Robot 5 are two of them. Nothing reaches the stack,
 *    and the module-level `let aoaCopying` guard is gone with the trigger.
 *  - Borrower of Forms copies base stats, counters and temporary stat changes
 *    of the erased unit. UNPARKED by R118 (the COPY LAYER): card text,
 *    attributes, statics and activated abilities all copy now, via a permanent
 *    FACE. It still BINS as "Borrower of Forms" — that is the owner's
 *    split-identity ruling, not a gap: the game name is the face, the physical
 *    card is not.
 *    ✔ R147 CHANGED HOW THE FACE ARRIVES. It used to be relayed through battle
 *    counters and a region ledger into a SELF-SPAWN TRIGGER, so the body
 *    entered play as a plain 2/2 Borrower of Forms and became the copy one
 *    resolution later — every spawn watcher in the region read the wrong body,
 *    and two Borrowers in one region ate each other's answer. The face now
 *    rides the spell's own stack item (`ctx.spawnWearing`) and is worn AS the
 *    body spawns. The trigger and the ledger are gone.
 *  - Ancient One copies TRIGGERED abilities of adjacent allies only, and only
 *    while a formation exists (adjacency is a battle concept). Copied "when
 *    I ..." abilities read the Ancient One as "I"; bounded copies burn a
 *    per-copy budget on the Ancient One (R9). UNPARKED by R118: activated
 *    abilities and statics now project too, through `projects` + E.facesWith.
 *  - Biomass Devourer reads "nontoken" off the death event's `token` FACT
 *    (R70 — the dead entity is gone by trigger time, which is why the fact
 *    rides the event; this used to be a match on the rendered message).
 *    ✔ R140 CHANGED THE REST OF THIS ENTRY. It used to read "an Unstable-erased
 *    card has no bin copy to erase, but the paid counters land anyway". Two
 *    things are different now: the card is told WHICH bin copy died (the
 *    'died' event carries `binSeat`/`binNth`), so it can no longer erase an
 *    innocent same-named copy instead; and with nothing to erase it makes no
 *    offer at all — the printed text is one package, so there is no [two] to
 *    pay and no counters.
 *  - (Celestial Fluxmorph's donated "[Augment] when I despawn" NO LONGER
 *    misses a recall. This entry used to read "E.recall erases mods before
 *    firing the despawn event (engine limitation)"; R167 moved that deletion
 *    to the bottom of afterDespawn, so the donated sentence now fires on a
 *    recall and a cache exactly as it does on a death — and R172 adds the
 *    third route, an ERASE. Not an approximation any more.)
 *  - (Download's steal was listed here as "removes the token from its old
 *    formation but cannot slot it into the thief's (no mid-battle
 *    formation-join primitive)". IT IS NOT AN APPROXIMATION — R172: the owner
 *    ruled on 2026-08-25 that a unit stolen mid-battle SITS OUT UNTIL REGROUP,
 *    which is precisely what the engine does. See the ⚠ on E.giveControl and
 *    the two Download cases in 145-erase-routes.test.ts. R8's "joins the new
 *    controller's formations" is honored AT REGROUP, which is when formations
 *    are next built; the token swaps sides immediately, owner unchanged.)
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
 *  - (Ancient One UNPARKED by R118, 2026-08-23 — both halves. Neighbour
 *    projection is `CardDef.projects`, and pushActivatedOptions /
 *    activationSource now read `E.facesWith(u, 'activated')` rather than
 *    `getCard(u.card).abilities`, so a projected ability is OFFERED and
 *    ACCEPTED, with its R9 budget keyed by FACE. Triggered abilities keep the
 *    bookkeeping when() — it labels each mimicked trigger "Ancient One (as X)",
 *    which the generic face machinery cannot do.)
 */
import type { EngineEvent, Entity, EntityId, EventType, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, eventBinSlot, getCard, type EffectDef, type TokenRequest } from '../dsl.ts';
import { selfOf, isEnt, eraseFromPlay } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/* R181: `tokensInRegion(g, region)` lived here — "all tokens (unit tokens +
 * spell tokens) in a region, absent ones excluded" — with zero call sites.
 * Deleted rather than wired up: nothing in this batch counts tokens by region.
 * A dead helper's doc comment is a confident description of machinery nobody
 * runs (`batch-light-a::payLife` asserted a life-cost model all three life-cost
 * cards had abandoned). `noUnusedLocals` is on now, so the next one reddens
 * `tsc` instead of ageing in place. */

/** "my column deals combat damage TO AN OPPONENT": the shared engine
 * predicate, E.columnDealtCombatDamage, on the FACE channel only — the "to an
 * opponent" narrowing is exactly what excludes the unit-damage channels, so
 * this hears the aggregated combat 'lifeLost' and nothing else. My column
 * connects if it is attacking unblocked, or blocked/blocking with {Piercing},
 * and the sub-step now running has to be one MY column strikes in (R117, and
 * R157 §5 for the {Swift}{Sluggish} column that strikes in two of them).
 *
 * R157 §4 (owner, 2026-08-25) is what changed here: this copy carried NO POWER
 * GATE AT ALL, so a 0-power column read another column's aggregated `lifeLost`
 * as its own. The gate is the LIVE COLUMN's total power — never the anchor's
 * own, which is what Blightmound wrongly read: "0 power units do no damage.
 * But the other thing in the column can still contribute to the shared column
 * power." So a 0-power Dreamtender beside a 2-power ally still fires. */
function myColumnConnected(g: E, self: Entity, ev: EngineEvent): boolean {
  return g.columnDealtCombatDamage(self, ev, ['face']);
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

// "[Augment] I have all abilities of adjacent allies. {/n}{i}(This includes
// modded abilities.)" — mm/2 1/1 Ancient Mimic Unit.
//
// R118 — the ADDITIVE, CONTINUOUS half of the copy layer, and the reason the
// layer could not be a stamp: adjacency changes inside a single combat (R72
// column collapse, a neighbour dying, blockers being declared), so "all
// abilities of adjacent allies" has to be re-asked every time it is read. That
// is exactly `CardDef.projects`, which radiates through E.anchored() the way
// StaticMod does — so the [Augment] form projects onto the HOST and "I" is the
// host, for free.
//
// TWO HALVES, deliberately built two different ways:
//
//  · STATICS and ACTIVATED abilities are the `projects` declaration below.
//    They are read off the holder's FACES now (E.facesWith), so a neighbour's
//    "your units are base 3/3" really radiates from the Ancient One too.
//    The ACTIVATED half is OFFERED and ACCEPTED as of R118's second half:
//    pushActivatedOptions and activationSource both read
//    `E.facesWith(u, 'activated')`, and `Action.via` gained a {face} arm so
//    composeParts keys the R9 budget by the face rather than the body.
//
//  · TRIGGERED abilities stay with the bookkeeping when() below, which
//    predates R118 and does something the generic face machinery cannot: it
//    labels each mimicked trigger "Ancient One (as Minor Kraken)", so the
//    ordering UI says WHOSE trigger it is. `PROJECTED_FACETS` is overridden to
//    ['statics', 'activated'] for exactly that reason — leaving 'triggered' in
//    would queue every mimicked trigger TWICE.
//
// A bookkeeping when() (always false — Mirage Walker's pattern) scans adjacent
// allies on every dispatched event and queues copies of their matching
// TRIGGERED abilities (own card + augment-donated text) as the Ancient One's
// own triggers. "I" in a copied ability is the Ancient One; ab.when runs with
// the Ancient One as self. Bounded copies burn a per-source budget on the
// Ancient One (R9).
const AO_EVENTS: EventType[] = [
  'spawned', 'died', 'despawned', 'draw', 'lifeLost', 'damage',
  // R129: 'cardPlayed' rides beside 'spellPlayed' because Void Mandible's
  // augment text moved onto it — an adjacent ally wearing one must still be
  // mimicked ("it explicitly includes modded abilities").
  'countersChanged', 'modApplied', 'spellPlayed', 'cardPlayed', 'targeted',
  'attackDeclared', 'attacked', 'blocksDeclared', 'blocked',
  'afterCombat', 'endOfTurn',
];
/**
 * R172 — the reentrancy guard, and the last of the module-level latches
 * playtest report #60 named (R104 removed the other five).
 *
 * It used to be `let aoScanning = false` at module scope. Two things were
 * wrong with that, and only one of them was visible:
 *
 *  · **Not serialised.** `GameState` is the whole of the game; a module-level
 *    `let` is not in it, so a JSON round trip (save, replay, the playtest
 *    report loop) silently resets it. A flag whose value cannot survive a
 *    reload is a flag whose value nothing may depend on.
 *  · **Global, when the thing it guards is per-unit.** Its comment said "two
 *    adjacent Ancient Ones must not mimic each other" — but `fireEvent`
 *    dispatches to listeners SEQUENTIALLY, so a second Ancient One's `when()`
 *    runs strictly after the first one's `finally` has cleared the flag, and
 *    the global never saw that case at all. What actually stops mutual mimicry
 *    is the `cardName === 'Ancient One'` skip inside the loop.
 *
 * MEASURED, not argued — "what would this look like if it were blind?" asked
 * and answered. Instrumented across all 135 test files, the guard is hit
 * **0 times**, while the `when()` body it guards runs **64 times in
 * 26-metal-a alone** and 191 times in the largest single run: the probe is not
 * blind, it is reporting a real zero. The reason is structural. The body below
 * is one synchronous pass whose only card-authored call is a neighbour's
 * `ab.when(g, self, ev)`, and no `when` in the pool dispatches an event —
 * none of the 72 of them calls `g.fireEvent`, `g.ev`, `g.destroy`,
 * `g.spawnUnit` or `g.dealDamage` (R1 wants conditions pure: they read state
 * at event time and answer a boolean). `g.s.triggerQueue.push` only queues.
 * So there is no nesting today and the guard is dead code.
 *
 * It is kept anyway, because "no `when` in the pool fires an event" is a fact
 * about today's pool and not an invariant the engine enforces — but kept on
 * the ENTITY, in `budgets`, which IS part of GameState and therefore survives
 * a round trip. Set and cleared inside one call, so it is never observable
 * between actions; entity-scoped, which is the true scope of reentrancy.
 */
const AO_SCAN_KEY = 'ao:scanning';
/** the FACES an Ancient One (or its host) borrows right now: every adjacent
 * ally's own face plus every card augmented onto it ("this includes modded
 * abilities"). Geometry and raw fields only — R118 forbids reading a number
 * from here, because `projects` runs underneath effStats. */
function aoBorrowedFaces(g: E, self: Entity): string[] {
  const out: string[] = [];
  for (const n of g.adjacentInFormation(self.id)) {
    if (n.controller !== self.controller) continue;
    out.push(g.nameOf(n));
    for (const modId of n.mods) {
      const m = g.entity(modId);
      if (m && m.appliedAs === 'augment') out.push(m.card);
    }
  }
  return out;
}
card('Ancient One', {
  // R118: the statics/activated half. 'triggered' is deliberately excluded —
  // the when() below already delivers it, with its own attribution label.
  //
  // R127 adds 'behavior' — the owner: "it basically just copies the whole text
  // box of adjacent allies … the only thing it doesn't are attributes". So the
  // neighbour's costMods / effectAttrs / amountMods / modPermissions /
  // playPermissions / mustBeTargeted / replace* hooks all radiate from the
  // Ancient One too. 'attrs' is STILL absent, and that is the whole of the
  // stated exclusion: a neighbour's {Piercing} or {Unstable} does not ride
  // along.
  projects: [{ faces: aoBorrowedFaces, facets: ['statics', 'activated', 'behavior'] }],
  augmentText: [{
    type: 'triggered', events: AO_EVENTS,
    label: 'I have all abilities of adjacent allies (triggered abilities)',
    when: (g, self, ev) => {
      if (self.budgets[AO_SCAN_KEY]) return false;   // R172: see AO_SCAN_KEY
      self.budgets[AO_SCAN_KEY] = 1;
      try {
        const src = ev.data?.['unit'] as EntityId | undefined;
        for (const n of g.adjacentInFormation(self.id)) {
          if (n.controller !== self.controller) continue;
          // R118: a neighbour that is itself a COPY donates the face it wears
          const face = g.nameOf(n);
          const sources: { cardName: string; prefix: 'ability' | 'augment' }[] = [
            { cardName: face, prefix: 'ability' },
            { cardName: face, prefix: 'augment' },
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
      } finally { delete self.budgets[AO_SCAN_KEY]; }
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
// "UNIQUE" IS THE (NAME, X) PAIR — R157 §24 / R161, owner 2026-08-25,
// verbatim: *"'Unique' means unique (name, X) pair — you get two extras."*
// So a Robot 2 and a Robot 5 in one batch are TWO unique tokens and yield two
// extras, one of each; three Robot 2s are one and yield one.
//
// This is a reversal, and it is the reading R104 flagged as the one place the
// uniqueness question had a choice. The old key was `r.name` alone, on the
// argument that `Entity.card` is the engine's definition of identity (it is
// what bins, what "name a card" effects match, what counters-by-name and
// DECK_LIST and the inspector key off) and that X is a quantity ON a token
// rather than a different token. The owner's answer says the X is part of
// WHICH TOKEN IT IS for this card's purposes, and the standing steer says to
// take the reading that lets more happen when both are available.
//
// It does NOT redefine identity anywhere else, and nothing here asks it to:
// Manufacture's Robot 3/2/1 now pays out three extras, a Fireball 2 and a
// Fireball 5 pay out two, and every other card that matches on `Entity.card`
// is untouched. Cosmic Conspirator's "(With the same X value.)" is the same
// fact from the other side — the X travels with the token, so a swap that
// keeps it is worth saying out loud.
//
// THE COPY IS OF THE FIRST REQUEST WITH THAT (name, X), which is now a
// distinction without a difference for unit tokens — two requests with the
// same name AND the same X are identical requests — and stays deterministic
// if a request ever grows a third field.
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
      const key = `${r.name} #${r.x}`;         // R157 §24: the (name, X) pair
      if (seen.has(key)) continue;                 // one copy per unique pair
      seen.add(key);
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
        // R140: "erase IT" is the copy this death put into a bin, named by the
        // (binSeat, binNth) stamp `E.destroy` writes onto the 'died' event —
        // R131's bin identity, the same pair 'trashed' already carried. The old
        // code searched by name (`bin.lastIndexOf(name)`, controller's bin
        // first, then everyone's), which is a different question: once the dead
        // copy has been swept out — a token, or an {Unstable} death under R137
        // — the last copy of that name is an INNOCENT older one, and this card
        // ERASES what it finds. That is a card leaving the game permanently by
        // mistake, the worst of the three misses R140 closes, so the miss is
        // "gone" and nothing at all happens.
        const slot = eventBinSlot(g, ctx.event);
        if (!slot) { g.ev('info', 'Biomass Devourer: the death event names no card — nothing to erase.'); return; }
        const name = slot.card;
        // Guarded BEFORE the offer, like the two guards above it: the printed
        // text is one package ("pay [two] to erase it AND put two counters on
        // me"), so with nothing to erase there is no bargain to offer and the
        // mana is not asked for.
        if (slot.index === -1) {
          g.ev('info', `Biomass Devourer: ${name} is no longer in the bin — nothing to erase, no counters.`);
          return;
        }
        const pay = ctx.choose('devour', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Biomass Devourer: pay [two] to erase ${name} and get two +1/+1 counters?`,
          options: [{ label: 'pay 2', value: 1 }, { label: 'decline', value: 0 }],
        }) as number;
        if (!pay) { g.ev('info', 'Biomass Devourer: the [two] is declined — no erase, no counters.'); return; }
        g.payMana(ctx.controller, 2);
        // `ctx.choose` throws and re-enters this run from the top, so the slot
        // above was resolved against the live bin on the pass that got the
        // answer — one lookup, no second search.
        g.removeFromBin(slot.seat, slot.index, 'erased');   // R124
        g.ev('erased', `${name} is ERASED from ${g.pname(slot.seat)}'s bin.`, { card: name, seat: slot.seat });
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

// "Erase target unit. I become an exact copy of that unit. {i}(I copy all stat
// changes, counters, card text and mods)." — mmm/7 2/2 {Battle} Squid Mimic
// Spell Unit.
//
// R118 — the COPY LAYER, and this card is the PERMANENT case: "I BECOME an
// exact copy" prints no duration, so the face is stamped `until: 'permanent'`
// and survives regroup (there is a live test that says so).
//
// R147 — and it is ONE RESOLUTION. The spell erases the target, prepares the
// face, and hands it to its OWN stack item (`ctx.spawnWearing`); `E.afterParts`
// spawns the body already wearing it, before the `spawned` event fires. What
// travels:
//   · the NAME, and with it the type line, the printed text, the statics and
//     the triggered text — one `E.becomeCopy` face, not four grants;
//   · the STAT CHANGES, verbatim from the reminder text. The face carries an
//     explicit layer-1 override (`CopyRef.printedStats`) snapshotted at the
//     target's BASE stats (layers 1-2), so a Formless'd or Statweavered body
//     is the body you borrow — the one card in the pool that overrides layer 1
//     rather than reading the copied card's printed pair, and it does so
//     because its reminder text says "I copy all stat changes";
//   · the COUNTERS, as real counters on the Borrower (facts about the unit);
//   · the MODS, as R118 ruling 2 rules them — the owner, verbatim: "Inherit
//     the mods text, but it IS Unstable. Anything that's modded is unstable
//     and the copy is still considered modded." So no mod ENTITY is cloned
//     (`Entity.mods` stays empty), the mods' text rides on the face, and the
//     Borrower is {Unstable}: it is ERASED instead of binned when it dies.
//
// ⚠ What does NOT travel, by R118 ruling 1: the PHYSICAL card. A Borrower that
// became a Good Whale and then dies puts **Borrower of Forms** in the bin.
// `Entity.card` is never rewritten, which is the whole reason this is a layer
// in front of the identity and not R101's in-place transform.
//
// ⚠ The old `self.tokenStats = [p, t]` write is GONE. tokenStats is LAYER 1
// ("what a token was created as") and the Borrower is not a token, so the
// write made R106 {Unaware} read the BORROWED numbers as printed. The face
// carries them now, at layer 0, where {Unaware} reads them correctly.
//
// Target gone at resolution → the spell fizzles and Borrower is binned (R5),
// and no body spawns at all, so there is nothing to dress.
//
// ⚠ R147 (CARD-TODO #37) — WHAT THIS USED TO BE, and why it is not that.
// The face was parked on a per-region ledger (`copyParks`) with the copied
// numbers spread across `bof:*` battle counters, and a `spawned` trigger on
// the body claimed them. The body therefore ENTERED as a plain 2/2 Borrower of
// Forms and became the copy one resolution later. Two things followed, both
// wrong:
//   · Anything watching the spawn read the wrong body. Nectar Ridge Oracle —
//     "when another ally with greater defense than power spawns" — is R1's own
//     worked example and it read 2/2 instead of the borrowed body; and the
//     caster was stopped and asked to ORDER the copy trigger against whatever
//     else the spawn had triggered, a question with no answer worth giving.
//   · The ledger was keyed by REGION, not by caster. Two Borrowers resolving
//     in one region before the first's trigger resolved shared one slot: the
//     second wore the first's face-slot and took BOTH sets of copied counters,
//     and the first body stayed a Borrower of Forms permanently. That is not
//     a theoretical worry — one Borrower each in a two-player region reaches
//     it, and 26-metal-a pins it.
// The trigger and the ledger are both gone. R143's shape, one question over:
// `spawnUnder` says whose the body is when it arrives, `spawnWearing` says
// what it is.
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
      // "I become an exact copy": one PERMANENT face, every facet, with the
      // borrowed base as its layer-1 numbers ("I copy all stat changes"), plus
      // the three per-unit facts a face cannot carry. Prepared HERE, while the
      // target still exists, and worn by the body as it spawns — the target is
      // erased on the very next line and could not be read again.
      ctx.spawnWearing?.({
        copy: g.prepareCopy(t, {
          from: 'Borrower of Forms', until: 'permanent', printedStats: [p, dt],
        }),
        counters: t.counters,
        tempPower: t.tempPower,
        tempToughness: t.tempToughness,
      });
      eraseFromPlay(g, t);
    },
  },
});

// "When I spawn or become modded, put a +1/+1 counter on each of your units.
// [Augment] When I despawn, remove all counters from your units." — m/2 1/1
// Cosmic Spirit {Virus} Unit. The first sentence stays with the card (plain
// ability); the [Augment] sentence transfers ("I" = the host). "Your units"
// is region-scoped (R12/R25). Despawn = ANY leave-play (died + despawned —
// Bloated Manablub's precedent). ⚠ This used to end "the donated form misses
// host RECALLS (mods are erased before the despawn event fires)" — R167 fixed
// that, and R172 added the third route: the donated sentence now fires on a
// death, a recall, a cache, an exchange and an ERASE alike.
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
// LIVE, and on the effect-level `CastCost` route. The cost is paid IN THE CAST
// WINDOW — both sacrifices, before the item reaches the stack — so there is no
// priority window between paying and deleting, and a Deformant whose only ally
// is removed in response never half-pays.
//
// WHY NOT `AbilityCost`, which is where an activation cost normally lives:
// `collectItemCosts` carries a documented latent half-pay bug (engine.ts, the
// "⚠ LATENT (2026-08-23 audit)" note) — the choice-free half of a compound
// cost is charged one call EARLIER than the choice-bearing half, so the first
// card to combine them arrives at the collector with its mana already spent.
// Deformant would have been exactly that first card. `castCost` is one
// collector, one window, and it is what `abilityUnusable` already gates the
// OFFER on.
//
// `includeSelf: true` is the engine shape "me AND another ally" needed, and it
// is not "any two units": the source is mandatory and choice-free (charged
// through the same branch R73's "[Sacrifice me]" uses) and is EXCLUDED from
// the menu the second one is chosen from. `canPayCastCost` demands both halves
// up front, so the Deformant never dies for a cost whose remainder cannot be
// paid — the all-or-nothing rule R110 applies to a multiplied graft cost.
//
// THE TOTAL COMES FROM THE RECEIPT, not from the board: both units are already
// dead when `run` executes, so `costPaid.sacrificedUnits` carries their
// counters snapshotted AT PAYMENT. Those are the RAW `Entity.counters`,
// because Caleb rules that counters NET and that temporary buffs are not
// counters at all — "if I have +1/+1 and -1/-1 on the 2 cards, what's the
// total number?" -> "0, they cancel out"; of an until-regroup buff, "oh, no
// those are not counters" — so `effStats` cannot reconstruct the number.
//
// ⚠ THERE IS NO `ctx.choose` HERE ANY MORE, AND NONE MUST BE RESTORED. The
// ally used to be picked mid-RESOLUTION, which opened a response window
// between the cost and the effect that the printed card does not have (the
// ledger entry called it out as exactly that). The pick is a COST now.
//
// ⚠ AND NO `usableWhen`. It is not missing, it is redundant: R77's board
// condition ("another ally") is precisely what `canPayCastCost` answers for
// `sacrificeUnits` + `includeSelf`, and `abilityUnusable` asks it before the
// ability is ever offered. A `usableWhen` restating it would be a second
// implementation of the same gate — the class of split the fuzzer's
// "legalActions lied" check exists to catch.
card('Deformant', {
  abilities: [{
    type: 'activated', cost: {},
    label: 'sacrifice me and another ally: delete all units with cost equal to our counters',
    effect: {
      castCost: { kind: 'sacrificeUnits', includeSelf: true, n: 2 },
      run: (g, ctx) => {
        const paid = ctx.costPaid?.sacrificedUnits ?? [];
        const total = paid.reduce((n, r) => n + r.counters, 0);
        g.ev('info', `Deformant: ${paid.map(r => r.card).join(' and ')} were sacrificed with `
          + `${total} counter${total === 1 ? '' : 's'} between them — deleting all units with cost ${total}.`);
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
// Writhing Host ("If I am in your bin, you may play a unit as if it had
// [Haste] by erasing me as an additional cost") stayed parked through this —
// the grantor is a card in the BIN, which `anchored()` does not walk, and the
// grant carries an additional COST, which `PlayCtx` has no room for — until
// R123 gave it its own seam: `CardBehavior.binPlayPermissions`, gathered by
// `E.binHasteGrantorIndex` over the owner's bin, with the erase paid beside
// the play's other costs. Slurpr ("You can apply other mods during [Haste] as
// if it was deployment") is the MOD-timing twin and belongs to R95's family,
// not this one. Rook is already live on R95.
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
// The steal is R8's straight swap: controller flips (owner stays), and the
// token leaves its old formation. A stolen spell token is cast fresh by its
// new controller, so "choose new targets" is automatic.
//
// R148/CT-38: the swap is E.giveControl, not a raw `tok.controller = …` plus a
// local unslot. "Target token" reaches UNIT tokens as well as spell tokens
// (pushUnitTargets offers both), and a unit token can be augmented or grafted
// — so the hand-rolled version stole a modded Robot and left its mods behind,
// still answering to the seat it was taken from. The choke point also owns the
// region: R112 exclusivity applies here too (a spell token has no mods to
// carry, and `mods` is [] on one, so the same call is correct for both kinds).
//
// ⚠ R172 — MID-BATTLE, THE STOLEN TOKEN SITS OUT UNTIL REGROUP, AND THAT IS
// THE RULE, NOT A GAP. Download is a {Battle} spell, so it can steal a Robot
// with the formations already declared. Owner, 2026-08-25: *it sits out until
// regroup* — controller changes at once, the unit is OUT of the formation for
// the rest of this battle (it attacks for nobody and blocks for nobody), and
// it joins its new controller's side at regroup, which is when formations are
// next built. `E.giveControl`'s unslot is what delivers that; it must NOT grow
// a re-slot. The engine has done this since R148 by accident of having no
// formation-join primitive — R172 only writes the decision down and pins it,
// so the next reader does not "repair" a correct behaviour.
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
      // R8: it swaps sides — mods, formation slot and region all handled by
      // the choke point, which announces the handover itself.
      g.giveControl(tok, ctx.controller);
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
