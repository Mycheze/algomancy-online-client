/* The rules glossary, and the scan that finds which of it a card is talking
 * about. DOM-free so it can be unit-tested (see test/52-ui-glossary.test.ts).
 *
 * Two consumers:
 *   - the ? rules overlay prints the whole thing, by section;
 *   - the card inspector prints only the entries the card's own text, its
 *     mods, and its rulings actually REFER to.
 *
 * The second one is the point. Playtest ask (Bena, 2026-08-20): "when viewing
 * the rulings and/or information about a card, all referenced keywords should
 * have their reminder text right there to see." A card that says "gains
 * {Deadly} until regroup" or a ruling that turns on what "trashed" means is
 * unreadable if the reminder text lives behind another button.
 *
 * ⚠ THIS FILE IS A RULES DOCUMENT, NOT UI COPY (R206 / CT-80, 2026-08-26).
 * TEN of the 25 attributes here carry NO printed reminder anywhere in the
 * pool — {Evasive}, {Sneaky}, {Alluring}, {Tough}, {Vulnerable}, {Feeble},
 * {Resonant}, {Thieving}, {Reaping}, {Unaware} — and neither do the four
 * printed markers {Burst}, {Virus}, {Ambush} and {Unstable}. For those the row
 * below is the ONLY statement of the rule the repository has. `engine.ts` says
 * so in as many words on {Reaping}: "none of the four cards carries a reminder at all.
 * ui/glossary.ts is the repo's own statement of it, AND IT IS WHAT R184
 * READ." A wrong row is therefore a rules bug. FIFTEEN of the 43 rows were
 * wrong when R206 read all of them against the engine — 35%, against the
 * four the ticket had found — and FIVE of the fifteen were on a list that
 * said they had already been checked, so "somebody looked at it" is not
 * evidence. `test/177-glossary-conformance.test.ts` is what stands between
 * that and the next fifteen.
 *
 * Two standing rules for editing a row:
 *   1. PRINTED TEXT WINS. Where a card prints a reminder and this file
 *      disagrees, the card is right — that is how the Glimpse bug (report
 *      #106, R190) and the Piercing bug (R206) both went. 177 enforces it
 *      mechanically for the 15 attributes that carry a printed reminder.
 *   2. CITE THE RULING. Every row carries `ruling`, and 177 checks the
 *      citation RESOLVES to a live `## R<n>` in docs/digital-rules.md — a
 *      withdrawn, superseded or narrowed ruling fails, which is what would
 *      have caught {Unaware} still teaching R10 three days after R106.
 */

/** Where a row's sentence comes from. `R<n>` must resolve to a LIVE ruling in
 * docs/digital-rules.md (177 checks it); `'printed'` may only be claimed when
 * the term really carries a printed reminder in printed.json (177 derives that
 * from the pool, so it cannot be used as an escape hatch); the rest are the
 * upstream documents, and 177 pins by name the short list of rows that rest on
 * nothing else. */
export type GlossSource = `R${number}` | 'printed' | 'Rulebook' | 'Manual' | 'docs/08';

export interface GlossEntry {
  /** the word the scan looks for, and the heading it prints */
  term: string;
  /** heading override for the rules overlay (keeps the ☠/⛓/📜 chrome) */
  label?: string;
  /** the reminder text */
  text: string;
  /** R206/CT-76: where this sentence comes from. NOT decoration — every
   * `R<n>` here is asserted to resolve to a ruling that has not been
   * withdrawn, superseded or narrowed. Historical R-numbers (the ruling this
   * row USED to state) belong in a comment, never here.
   *
   * ⚠ OPTIONAL IN THE TYPE, MANDATORY IN FACT. Two callers build a synthetic
   * GlossEntry that is not a glossary row and has no rule behind it —
   * `ui/inspect.ts`'s `matcherFor({ term, text: '' })` and `ui/main.ts`'s
   * "see the rules reference" fallback — so requiring it here would only
   * teach those two to write `ruling: []`, which is worse than nothing. The
   * obligation is enforced where it can actually bite, over the REAL table:
   * `177-glossary-conformance.test.ts` fails on any GLOSSARY row without one. */
  ruling?: readonly GlossSource[];
  /** other spellings the printed text and the rulings corpus actually use */
  alt?: string[];
  /** override the generated matcher entirely — for terms that are also
   * ordinary English and would otherwise fire on every third sentence */
  re?: RegExp;
}

/** attributes and the named mechanics that behave like them */
export const KEYWORDS: GlossEntry[] = [
  { term: 'Flying', ruling: ['printed', 'Rulebook'], text: 'Its column can only be blocked by a column with Flying.' },
  { term: 'Evasive', ruling: ['Rulebook'], text: 'Needs two blockers — a single unit cannot block it.' },
  { term: 'Sneaky', ruling: ['R20'], text: 'If it is the only attacking unit, it cannot be blocked at all.' },
  // R84 (2026-08-22): it TARGETS. The old wording here — "defenders that are
  // able to block it must block it" — was a rule nobody ever gave.
  { term: 'Alluring', ruling: ['R84'], text: 'Attacking with its column targets one enemy unit, from the stack: that unit cannot attack or counterattack for the rest of the battle, and must block this column if able.' },
  // R206 (2026-08-26), CT-80 (b) — THE GLIMPSE SHAPE AGAIN: the printed card
  // was right and this row was behind it. Protective Adaptations and
  // Pernicious Photosynthesis both print "Excess damage from piercing sources
  // is dealt to the RECIPIENT'S CONTROLLER"; this row said "its BLOCKED
  // COLUMN" → "the DEFENDING PLAYER", which is wrong twice over. R103
  // generalised the attribute off the column onto ALL damage (engine.ts:4085
  // -4119, on the owner's "piercing is done even when its on a non-combat
  // effect"), and combat's own blocker branch (engine.ts:10102) pierces into
  // the ATTACKING player. 177 now derives this row's obligation from the two
  // printed reminders, so the card can never get ahead of it again.
  { term: 'Piercing', ruling: ['R13', 'R103', 'R114', 'printed'], text: 'Excess damage from a piercing source is dealt to the recipient’s controller — automatically, as part of the same damage, never as a separate trigger. In combat that is the player behind the blocked column; a piercing BLOCKER pierces into the attacking player; and it works on non-combat damage too.' },
  // R206, CT-80 (e): the row said "an adjacent unit" and stopped. The engine
  // walks a `visited` chain (engine.ts:4123-4160) and Envoy of Lightning's
  // PRINTED reminder names the recursion outright — "can be directed to an
  // adjacent unit, RECURSIVELY". Printed text wins.
  { term: 'Electric', ruling: ['R4', 'printed'], text: 'Excess damage is directed to an adjacent unit in the formation, recursively: each unit absorbs only enough to destroy it and the rest walks on to a fresh neighbour, never revisiting one. The controller picks the path. When the chain runs out the excess is lost — unless the source is also {Piercing}, which sends it to that unit’s controller.' },
  { term: 'Deadly', ruling: ['R21', 'printed'], text: 'Any amount of damage it deals destroys the damaged unit.' },
  { term: 'Swift', ruling: ['R117', 'printed'], text: 'Its column deals combat damage first, before normal units; triggers from that damage resolve before normal damage.' },
  { term: 'Sluggish', ruling: ['R117', 'printed'], text: 'Its column deals combat damage last, after normal units.' },
  { term: 'Tough', ruling: ['R19', 'Rulebook'], text: 'Its defense is doubled.' },
  { term: 'Balanced', ruling: ['R19', 'printed'], text: 'Its power and defense each become the greater of the two.' },
  { term: 'Powerful', ruling: ['R23', 'printed'], text: 'It deals double damage.' },
  { term: 'Vulnerable', ruling: ['R23'], text: 'It takes double damage.' },
  // R206, CT-80 (g): "It cannot block." — full stop — omitted the exception
  // the engine implements at BOTH block sites, apply.ts:1662 and apply.ts:1902
  // ("R61: a Pure card ignores its OWN other attributes too, so Pure+Feeble
  // blocks"). An omission is a wrong row: {Feeble} carries no printed
  // reminder, so this sentence was the whole rule.
  { term: 'Feeble', ruling: ['R61', 'Rulebook'], text: 'It cannot block — unless it is also {Pure}, which switches off its own other attributes, this one included.' },
  { term: 'Poisonous', ruling: ['printed'], text: 'Damage it deals becomes permanent −1/−1 counters instead of marked damage.' },
  { term: 'Resonant', ruling: ['docs/08'], text: 'When it damages a unit, that unit’s controller also loses that much life.' },
  { term: 'Thieving', ruling: ['R24'], text: 'When its column deals combat damage to a player, its controller draws a card.' },
  // ⚠ DO NOT REWORD WITHOUT READING 156-reaping-and-formation.test.ts. This
  // row is the repo's only statement of {Reaping} — none of its four cards
  // prints a reminder — and 156 DERIVES `E.KILL_RIDERS` by scraping the word
  // "kills … unit" out of it. Losing that phrasing silently changes which
  // attributes ride the kill diff.
  { term: 'Reaping', ruling: ['R184'], text: 'When it kills a unit, its controller draws a card.' },
  { term: 'Inverted', ruling: ['R93', 'printed'], text: 'Its stat CHANGES are reversed (a −7/−7 becomes +7/+7). Base stats and base rewrites are what it inverts FROM, so they never move; it applies once however many sources granted it.' },
  // R206, CT-80 (c): this row carried R10's 2026-07-16 wording — "everything
  // counts as interacting with it" — which R106 replaced on 2026-08-23 and
  // which never stated the operative rule at all. R10's own "everything"
  // included TARGETING, which R106 deliberately does NOT implement
  // (digital-rules.md:5645-5656), so the row was teaching a rule the engine
  // refuses. The rule is a STAT LAYER: engine.ts:1536 `if
  // (statAttrs.includes('Unaware')) return this.printedStats(e)`, and the
  // pairwise half at engine.ts:3976-3977 collapses BOTH sides. Column-shared
  // via `statLayerAttrs` (engine.ts:1666-1675), which is why the vanilla unit
  // standing beside Bubb matters.
  { term: 'Unaware', ruling: ['R106', 'R19'], text: 'When dealing or receiving damage, and in combat, an unaware unit AND everything in that interaction are read at the stats PRINTED on their cards — counters, mods and buffs on either side are ignored, on both sides. Shared down the column, so a plain unit beside it reads that way too. Targeting is not affected.' },
  // R81 (2026-08-22): the group is the tokens of the SAME NAME, not every
  // burst token you control there.
  { term: 'Burst', ruling: ['R16', 'R81'], text: 'Casting one of your burst spell tokens casts every token of the same name you control in that region at once.' },
  // R79 (2026-08-22): a spell carrying a virus is Unstable too, and a spell's
  // way out of the game is the stack rather than a death.
  // R137 (2026-08-24): a dying UNIT is trashed on the way — it passes through
  // the bin (firing "when I am trashed" and every trash watcher) and is erased
  // out of it, exactly as a dying token is. A spell leaving the STACK is not
  // trashed, because nothing coming from the stack ever is (R40).
  // R206, CT-80: two corrections. (1) the row said "a modded card" and stopped,
  // but `isUnstable` (engine.ts:1272-1275) has FOUR ways in — mods, R96's
  // until-regroup stamp, the PRINTED {Unstable} type line (Aberrant
  // Statweaver, Oorblak) and being a copy of something modded — and the row
  // heading a KEYWORDS section for a printed attribute never once said a card
  // can simply print it. (2) it stated the erase unconditionally; R145 scopes
  // it to the ACTIVE ZONES. Hand, deck, bin, cache and the erased pile are
  // INACTIVE, so a card leaving one of those for a bin bins normally, printed
  // {Unstable} or not (engine.ts:1279-1292).
  { term: 'Unstable', ruling: ['R69', 'R96', 'R137', 'R145'], text: 'A card is unstable if it prints the attribute, if it carries mods, or if something stamped it. Leaving an ACTIVE zone — play or the stack — for a bin, it is erased with its mods instead of resting there; leaving hand, deck, bin or cache it bins normally. A unit that dies still passes through the bin first, so it is trashed on the way; a spell leaving the stack carrying a virus is erased without ever being trashed.' },
  // R206, CT-80 (d) — WRONG IN BOTH DIRECTIONS, and the widest-reaching row of
  // the seven: 64 cards mention Virus. It INVENTED a restriction (the battle
  // branch, apply.ts:1412-1418, checks priority and region and NEVER
  // `host.controller` — R157 §26, owner verbatim: "yes it can also go to an
  // enemy. That's the whole point of the card") and OMITTED the real one
  // (`battleAugmentAllowed`, apply.ts:1262-1265, is `c.virus && from ===
  // 'hand'` — a virus in your BIN is not a battle-time augment unless
  // something grants it).
  { term: 'Virus', ruling: ['R79', 'R95', 'R161'], text: 'The one card you may augment DURING BATTLE, and only out of your hand: with priority, onto any unit in the battle’s region — yours or the enemy’s — or onto a spell on the stack, either player’s. (Rook grants the same window to hand and bin cards that are not viruses.)' },
  { term: 'Ambush', ruling: ['R22'], text: 'An alternative battle-time cost: recall a target ally and take its position in play.' },
  // Light & Dark (docs/08). Kept here so the card inspector can explain them
  // instead of falling back to "see the rules reference".
  { term: 'Blessed', ruling: ['R48', 'printed'], text: 'Damage dealt by a blessed source makes its controller gain that much life — simultaneously, so it applies before the lethal check.' },
  // ⚠ "kills one or more units" is load-bearing: 156-reaping-and-formation
  // derives E.KILL_RIDERS from this phrasing. R206 widened only the HOW —
  // R184's diff catches any death the source caused (counters, stat swaps,
  // delete effects), not just the two the row happened to list.
  { term: 'Afflicting', ruling: ['R48', 'R184', 'printed'], text: 'When an afflicting source kills one or more units — however it killed them: damage, −1/−1 counters, a stat swap, an outright delete — those units’ controllers each gain a rot. One rot per controller, however many of their units died.' },
  { term: 'Lethal', ruling: ['printed'], text: 'Any combat damage from a lethal unit kills a player outright.' },
  { term: 'Modular', ruling: ['R105', 'printed'], text: 'You may apply mods from your hand and/or bin to this card as it is played, paying their costs; they ride on the stack with it.' },
  // R61 (2026-08-20) implemented the combat half; this entry still said the
  // attribute did nothing at all.
  //
  // R206, CT-80 (f) — AND THIS ROW WAS ON CT-80's OWN "checked and correct, do
  // not re-audit" LIST. It named three attributes. The engine empties the
  // WHOLE set: engine.ts:9887 `const attrsOf = (ids) => pure ? new
  // Set<string>() : this.colAttrs(ids)`. Its own docstring (engine.ts:1818)
  // names "Piercing / Deadly / Powerful / Swift" as switched off; {Feeble} is
  // switched off at apply.ts:1662 and apply.ts:1902. The printed reminder on
  // Just a Unit says "ignore all OTHER ATTRIBUTES" with no list, so printed
  // text was right and the enumeration was ours. Never enumerate a closed
  // list here — 177 asserts this row does not.
  { term: 'Pure', ruling: ['R61', 'printed'], text: 'A Pure card and whatever it interacts with ignore ALL other attributes — the entire set, for both sides of the exchange, its own included: a Pure {Feeble} unit blocks, and evasion, {Piercing}, {Deadly}, {Powerful} and {Swift} all stop applying. Stat layers are untouched — {Tough}, {Balanced}, {Inverted} and {Unaware} still read. (Outside combat: not implemented yet.)' },
];

/** the Light & Dark zone/counter concepts */
export const EXPANSION_GUIDE: GlossEntry[] = [
  {
    term: 'Rot', label: 'Rot ☠', ruling: ['R38'],
    text: 'A counter on the PLAYER. At the start of every deployment you take damage equal to your rot. It never decreases on its own.',
  },
  {
    term: 'Debt', label: 'Debt ⛓', ruling: ['R39'],
    text: 'A counter on the PLAYER. At the very end of your next resource step you must pay 1 mana per debt; each mana removes one. Anything you cannot pay carries over, and the mana spent is gone for the turn.',
  },
  {
    term: 'Cache', label: 'Cache 📜', alt: ['cached'], ruling: ['R41', 'R51'],
    text: 'A fourth zone beside hand, bin and deck — and a PUBLIC one: you both see every cached card. Being cached is not permission to play it.',
  },
  // R206, CT-80: "normal timing still applies" was flatly false for a banner
  // ending in [Haste]. `cachedTiming` (engine.ts:2801-2806) returns the
  // BANNER's release timing in preference to the card's own, and
  // `startHasteStep` opens a step for it (engine.ts:10650-10656) — Divine
  // Intervention prints "Your life is 5 or less [Haste]". The source zone was
  // missing too: hand only, unless the card prints that it may be prophesied
  // from a bin (apply.ts:780, Angel of Anguish).
  {
    term: 'Prophecy', alt: ['prophesy', 'prophesied', 'prophesies'],
    ruling: ['R42', 'R43', 'R44', 'R111'],
    text: 'During DEPLOYMENT, pay a card’s banner cost — out of your hand, or your bin if the card says it may be — to cache it with its condition attached. Once the condition has been met it stays met, and you may play (or graft/augment) the card for free, ignoring affinity. Its printed timing still applies, unless the banner itself ends in [Haste]: then the release happens in the haste step instead.',
  },
  // R190 (2026-08-26), report #106 — "the reminder text for Glimpsing is wrong,
  // it does not mention that the other cards not chosen are recycled". THIS
  // entry is the reminder text a player reads: the inspector prints it under
  // every card whose text says Glimpse. It still described R45 as it read
  // BEFORE the 2026-08-19 correction ("cache them", all N) and never mentioned
  // the recycle at all — so it contradicted E.glimpse, and it contradicted the
  // four cards that print "Recycle the rest" in the panel directly above it.
  // Reworded off R45 as corrected and off what E.glimpse actually does.
  {
    term: 'Glimpse', ruling: ['R45', 'R190'],
    text: 'Reveal the top N cards of your deck and cache exactly ONE of your choice; the rest are recycled to the bottom of your deck. Until end of turn you may play the cached card as if it were in hand, ignoring affinity but still paying its mana and obeying its timing. Afterwards the permission lapses and it just sits in the cache — public, targetable, and still moddable out of the zone at full price.',
  },
  // R206, CT-80 (a): the row said "a NONTOKEN card". `E.toBin`
  // (engine.ts:1950-1954) has no token check at all, and its docstring
  // (engine.ts:1965-1972) says why: "trashing is defined by WHERE something
  // goes, not by what it is". R133 records that the one printed "nontoken"
  // wording came from Void Scavenger, A CARD CUT FROM THE SET — so the row was
  // quoting a card that does not exist against an engine that never agreed.
  // Reach: 14 cards. 177 re-derives this from `toBin`'s own body.
  {
    term: 'Trash', ruling: ['R40', 'R133', 'R137'],
    text: 'ANY card entering a bin from anywhere but the stack is trashed — tokens included, because trashing is defined by the destination, not by the object. Discarding, sacrificing, milling and dying in combat all count; a resolved spell going to the bin does not. An {Unstable} unit that dies is trashed on its way through the bin, then erased out of it.',
  },
];

/** the marked mechanics a card's text box carries as icons */
export const MECHANICS: GlossEntry[] = [
  // R206, CT-80: the row never said WHEN. Modding is a DEPLOYMENT action —
  // apply.ts:1457 `e.illegal('modding is a deployment action (or a battle
  // Virus)')`, plus `e.deploying(seat)` and a host in your own region at
  // apply.ts:1433-1434. And "under a unit" is not the whole host list: R89
  // made your own SPELL TOKEN in play a legal deployment host (apply.ts:1407
  // -1410), attributes only.
  {
    term: 'Augment', ruling: ['R55', 'R79', 'R89', 'R95'],
    text: 'A deployment action: slide it out of your hand, bin or cache under one of your own units — or, in deployment, under your own spell token. It donates its type-line attributes and its text-box [Augment] text to the host. A host that is a SPELL, on the stack, reached during battle by a {Virus}, takes the attributes only; so does a spell token.',
  },
  {
    // "switch" is also the ordinary English verb — Riftwalker's "Switch my
    // position with another target ally" is not the graft keyword. Card text
    // always MARKS the keyword, so match the bracket, not the word.
    //
    // R206, CT-80: "[Switch1] is bounded — once per turn per card" was flatly
    // contradicted by R110. A multiplier in the composite ("Trigger two copies
    // of this graft ability") re-pushes every other graft part N times,
    // "bounded grafts included" — engine.ts:9092-9105. The deployment gate
    // (apply.ts:1473) was missing too, exactly as it was on Augment.
    term: 'Graft', ruling: ['R110', 'R113'], re: /\bgraft(?:s|ed|ing)?\b|[[{]switch1?[\]}]/i,
    text: 'A deployment action: insert it from your hand, bin or cache into a graft-cause unit’s stack. The [Switch] effects join that unit’s trigger and resolve as ONE composed ability. [Switch1] is bounded — once per turn per mod — but a multiplier in the composite ("trigger two copies of this graft ability") repeats even a bounded graft.',
  },
  {
    // same reasoning: "battle" is in half the rulings in the corpus as plain
    // English. The MARKER is the thing worth explaining — and it is written
    // both ways: {Battle} on a type line, [Battle] in a text box.
    // R206 checked this row against apply.ts:710/716-724 and the two haste
    // grant refusals (engine.ts:5844, engine.ts:5893, both citing the RAQ
    // "[Solved] Dispatch Courier vs Battle Timing"): correct as written,
    // including the haste step it does not mention because it cannot reach it.
    term: 'Battle', ruling: ['R97'], re: /[[{]battle[\]}]/i,
    text: 'A battle-timing card: playable only during a battle, in a response window. It cannot be played during planning, deployment or the haste step.',
  },
  // R206, CT-80: both halves of the second sentence were too narrow.
  // `startHasteStep`'s `canHaste` (engine.ts:10599-10657) opens the step on
  // FIVE conditions, only the first of which is a payable haste card in hand:
  // an R97 grant from a unit in play (Dispatch Courier), an R123 grantor in a
  // BIN (Writhing Host), an R95 mod window (Slurpr), and a cached release
  // timed [Haste] (Divine Intervention). Each of those four is report #74's
  // fatal gate in a different form — miss it and the step is skipped outright.
  // And a {Haste} card is playable in DEPLOYMENT as well (apply.ts:566).
  {
    term: 'Haste', ruling: ['R18', 'R50', 'R95', 'R97', 'R123'],
    text: 'A haste card is playable in the haste step, before the battle — and in deployment too. In the haste step it resolves immediately, without going on the stack. The step happens at all only if somebody can act in it: a payable haste card in hand, a cached card whose release is marked [Haste], a granting card in play or in a bin, or a mod applied under such a grant.',
  },
  {
    // "once" is ordinary English ("once per turn", "once you have…") — only the
    // bracketed marker means the bounded-ability keyword
    // R206: per turn and per card confirmed (engine.ts:10446 wipes every
    // entity's budgets in startTurn; the holder is the entity instance,
    // engine.ts:9046). Added R113's half, which the row omitted: the use is
    // spent by USING it, working or not — but a DECLINE is refunded
    // (engine.ts:8561-8598), so a player reading the old sentence over-counted.
    term: 'Once', ruling: ['R9', 'R113'], re: /[[{]once[\]}]/i,
    text: 'Bounded: this ability may be used only once per turn, tracked per card in play. It is spent when you use it, whether or not it ends up working; declining a "you may" costs nothing.',
  },
  // R190: fixed alongside Glimpse, because the two rows print TOGETHER on the
  // four cards that say "Recycle the rest" and this one used to deny what that
  // one now says. Recycling has exactly ONE meaning in Algomancy — put a card
  // on the bottom of the deck (Rulebook 2023-07: "recycling a card in your hand
  // (putting it on the bottom of the deck)"; Manual: "recycled (put on the
  // bottom of the deck)") — and `doRecycle` in apply.ts calls
  // `e.recycleToBottom` on the line before it pushes the dormant resource. The
  // old text said the card was "gone for the rest of the game", which is the
  // one thing recycling never does.
  {
    term: 'Recycle', alt: ['recycled', 'recycles'], ruling: ['R45', 'R190', 'Rulebook'],
    text: 'Put a card on the bottom of its owner’s deck. During planning you may recycle a card from your hand to gain a dormant resource of an element — one of THIS game’s elements, which in a draft is its trio, not all seven. The card goes to the bottom of the deck, not out of the game. Glimpse recycles the revealed cards it did not cache the same way.',
  },
  // R206, CT-80: "whenever you activate" was one caller short. R132 reversed
  // R116 on the owner's own reading of the card ("create a non-prismite
  // resource, THEN ACTIVATE IT"), so `maybeGrantShard` is called from
  // `doExchangePrismite` too (apply.ts:527 as well as apply.ts:463). Shard was
  // on CT-80's "checked and correct" list; it was not.
  {
    term: 'Shard', ruling: ['R54', 'R132'],
    text: 'A resource that makes mana but grants NO affinity. Granted free (dormant) whenever you bring an element resource up at 3+ affinity of that element — by activating a dormant one, or by exchanging a prismite into it.',
  },
  {
    term: 'Prismite', ruling: ['R17', 'R132'],
    text: 'A colourless resource: 1 mana, and 1 affinity of every element at once for cost-paying. During planning you may exchange an ACTIVE prismite for a resource of any of this game’s elements — and that counts as activating it, so the 3+ affinity Shard is owed.',
  },
];

/** every entry, in the order the inspector prints them */
export const GLOSSARY: GlossEntry[] = [...KEYWORDS, ...EXPANSION_GUIDE, ...MECHANICS];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The matcher for one entry: the term and its alternates, tolerating the
 * regular English endings the rulings corpus uses ("trashed", "caches"). Word
 * boundaries on both sides, so "Rot" does not fire inside "protect".
 */
export function matcherFor(e: GlossEntry): RegExp {
  if (e.re) return e.re;
  const words = [e.term, ...(e.alt ?? [])].map(escapeRe).join('|');
  return new RegExp(`\\b(?:${words})(?:s|es|ed|ing)?\\b`, 'i');
}

/**
 * Which glossary entries the given texts refer to, in glossary order.
 *
 * `skip` drops terms that are already explained elsewhere on screen — the
 * inspector lists the card's OWN attributes in their own section, and
 * repeating them underneath would be noise.
 */
export function glossaryHits(
  texts: (string | undefined | null)[],
  opts: { skip?: Iterable<string>; glossary?: GlossEntry[] } = {},
): GlossEntry[] {
  const hay = texts.filter(Boolean).join('\n');
  if (!hay) return [];
  const skip = new Set([...(opts.skip ?? [])].map(s => s.toLowerCase()));
  return (opts.glossary ?? GLOSSARY)
    .filter(e => !skip.has(e.term.toLowerCase()))
    .filter(e => matcherFor(e).test(hay));
}
