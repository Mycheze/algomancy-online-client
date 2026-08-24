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
 */

export interface GlossEntry {
  /** the word the scan looks for, and the heading it prints */
  term: string;
  /** heading override for the rules overlay (keeps the ☠/⛓/📜 chrome) */
  label?: string;
  /** the reminder text */
  text: string;
  /** other spellings the printed text and the rulings corpus actually use */
  alt?: string[];
  /** override the generated matcher entirely — for terms that are also
   * ordinary English and would otherwise fire on every third sentence */
  re?: RegExp;
}

/** attributes and the named mechanics that behave like them */
export const KEYWORDS: GlossEntry[] = [
  { term: 'Flying', text: 'Its column can only be blocked by a column with Flying.' },
  { term: 'Evasive', text: 'Needs two blockers — a single unit cannot block it.' },
  { term: 'Sneaky', text: 'If it is the only attacking unit, it cannot be blocked at all.' },
  // R84 (2026-08-22): it TARGETS. The old wording here — "defenders that are
  // able to block it must block it" — was a rule nobody ever gave.
  { term: 'Alluring', text: 'Attacking with its column targets one enemy unit, from the stack: that unit cannot attack or counterattack for the rest of the battle, and must block this column if able.' },
  { term: 'Piercing', text: 'Excess damage from its blocked column carries through to the defending player (automatic).' },
  { term: 'Electric', text: 'Excess damage arcs to an adjacent unit in the formation — the controller picks the path.' },
  { term: 'Deadly', text: 'Any amount of damage it deals destroys the damaged unit.' },
  { term: 'Swift', text: 'Its column deals combat damage before normal units; triggers from that damage resolve before normal damage.' },
  { term: 'Sluggish', text: 'Its column deals combat damage after normal units.' },
  { term: 'Tough', text: 'Its defense is doubled.' },
  { term: 'Balanced', text: 'Its power and defense each become the higher of the two.' },
  { term: 'Powerful', text: 'It deals double damage.' },
  { term: 'Vulnerable', text: 'It takes double damage.' },
  { term: 'Feeble', text: 'It cannot block.' },
  { term: 'Poisonous', text: 'Damage it deals becomes permanent −1/−1 counters instead of marked damage.' },
  { term: 'Resonant', text: 'When it damages a unit, that unit’s controller also loses that much life.' },
  { term: 'Thieving', text: 'When its column deals combat damage to a player, its controller draws a card.' },
  { term: 'Reaping', text: 'When it kills a unit, its controller draws a card.' },
  { term: 'Inverted', text: 'Its stat CHANGES are reversed (a −7/−7 becomes +7/+7).' },
  { term: 'Unaware', text: 'Everything counts as interacting with it.' },
  // R81 (2026-08-22): the group is the tokens of the SAME NAME, not every
  // burst token you control there.
  { term: 'Burst', text: 'Casting one of your burst spell tokens casts every token of the same name you control in that region at once.' },
  // R79 (2026-08-22): a spell carrying a virus is Unstable too, and a spell's
  // way out of the game is the stack rather than a death.
  // R137 (2026-08-24): a dying UNIT is trashed on the way — it passes through
  // the bin (firing "when I am trashed" and every trash watcher) and is erased
  // out of it, exactly as a dying token is. A spell leaving the STACK is not
  // trashed, because nothing coming from the stack ever is (R40).
  { term: 'Unstable', text: 'A modded card ends up erased with its mods instead of resting in a bin. A unit that dies still passes through the bin first, so it is trashed on the way; a spell leaving the stack carrying a virus is erased without ever being trashed.' },
  { term: 'Virus', text: 'May be augmented during battle onto an ENEMY unit — or onto a spell on the stack, either player’s.' },
  { term: 'Ambush', text: 'An alternative battle-time cost: recall a target ally and take its position in play.' },
  // Light & Dark (docs/08). Kept here so the card inspector can explain them
  // instead of falling back to "see the rules reference".
  { term: 'Blessed', text: 'Damage dealt by a blessed source makes its controller gain that much life — simultaneously, so it applies before the lethal check.' },
  { term: 'Afflicting', text: 'When an afflicting source kills one or more units — by damage OR by −1/−1 counters — those units’ controllers each gain a rot.' },
  { term: 'Lethal', text: 'Any combat damage from a lethal unit kills a player outright.' },
  { term: 'Modular', text: 'You may apply mods from your hand and/or bin to this card as it is played, paying their costs; they ride on the stack with it.' },
  // R61 (2026-08-20) implemented the combat half; this entry still said the
  // attribute did nothing at all.
  { term: 'Pure', text: 'A Pure card and whatever it interacts with ignore all other attributes — in combat that switches off Flying, Evasive and Sneaky for both sides. (Outside combat: not implemented yet.)' },
];

/** the Light & Dark zone/counter concepts */
export const EXPANSION_GUIDE: GlossEntry[] = [
  {
    term: 'Rot', label: 'Rot ☠',
    text: 'A counter on the PLAYER. At the start of every deployment you take damage equal to your rot. It never decreases on its own.',
  },
  {
    term: 'Debt', label: 'Debt ⛓',
    text: 'A counter on the PLAYER. At the very end of your next resource step you must pay 1 mana per debt; each mana removes one. Anything you cannot pay carries over, and the mana spent is gone for the turn.',
  },
  {
    term: 'Cache', label: 'Cache 📜', alt: ['cached'],
    text: 'A fourth zone beside hand, bin and deck — and a PUBLIC one: you both see every cached card. Being cached is not permission to play it.',
  },
  {
    term: 'Prophecy', alt: ['prophesy', 'prophesied', 'prophesies'],
    text: 'During DEPLOYMENT, pay a card’s banner cost to cache it with its condition attached. Once the condition has been met it stays met, and you may play (or graft/augment) the card for free, ignoring affinity — normal timing still applies.',
  },
  {
    term: 'Glimpse',
    text: 'Reveal the top N cards of your deck and cache them. Until end of turn you may play them as if they were in hand, ignoring affinity but still paying their mana. Afterwards they stay cached, inert.',
  },
  {
    term: 'Trash',
    text: 'A nontoken card entering a bin from anywhere but the stack is trashed — discarding, sacrificing, milling and dying in combat all count. A resolved spell going to the bin does not.',
  },
];

/** the marked mechanics a card's text box carries as icons */
export const MECHANICS: GlossEntry[] = [
  {
    term: 'Augment',
    text: 'Slide under a unit from hand, bin or cache: donates its type-line attributes and its text-box [Augment] text to the host. A Virus may go onto a spell on the stack instead, which takes the attributes only.',
  },
  {
    // "switch" is also the ordinary English verb — Riftwalker's "Switch my
    // position with another target ally" is not the graft keyword. Card text
    // always MARKS the keyword, so match the bracket, not the word.
    term: 'Graft', re: /\bgraft(?:s|ed|ing)?\b|[[{]switch1?[\]}]/i,
    text: 'Insert into a graft-cause unit’s stack: the [Switch] effects join that unit’s trigger and resolve as ONE composed ability. [Switch1] is bounded — once per turn per card.',
  },
  {
    // same reasoning: "battle" is in half the rulings in the corpus as plain
    // English. The MARKER is the thing worth explaining — and it is written
    // both ways: {Battle} on a type line, [Battle] in a text box.
    term: 'Battle', re: /[[{]battle[\]}]/i,
    text: 'A battle-timing card: playable only during a battle, in a response window. It cannot be played during planning or deployment.',
  },
  {
    term: 'Haste',
    text: 'Playable in the haste step, before the battle. It resolves immediately, and the step only happens at all when somebody holds a payable haste card.',
  },
  {
    // "once" is ordinary English ("once per turn", "once you have…") — only the
    // bracketed marker means the bounded-ability keyword
    term: 'Once', re: /[[{]once[\]}]/i,
    text: 'Bounded: this ability may be used only once per turn, tracked per card.',
  },
  {
    term: 'Recycle', alt: ['recycled', 'recycles'],
    text: 'Turn a card from hand face-down into a dormant resource of an element you choose. Planning only, and the card is gone for the rest of the game.',
  },
  {
    term: 'Shard',
    text: 'A resource that makes mana but grants NO affinity. Granted free (dormant) whenever you activate an element resource at 3+ affinity of that element.',
  },
  {
    term: 'Prismite',
    text: 'A colourless resource: 1 mana, and 1 affinity of every element at once for cost-paying. During planning you may exchange an ACTIVE prismite for a resource of any element.',
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
