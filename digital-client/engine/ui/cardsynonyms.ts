/* WHAT A WORD MEANT, offered rather than assumed.
 *
 * Somebody typing "deathtouch" wants Deadly. Somebody typing "graveyard" wants
 * the bin. The Python side has known this for a long time (cards.py's
 * SEARCH_ALIASES / SEARCH_PHRASES / KEYWORD_TEXT) and acts on it: it silently
 * expands the query so the search finds what you meant.
 *
 * THIS FILE DELIBERATELY DOES NOT DO THAT. A query bar that quietly searches
 * for a word you did not type is a query bar you cannot trust to answer "does
 * any card actually SAY trample" — and that question matters here, because the
 * whole point of the browser is reading printed text. So the table is used for
 * two honest things instead:
 *
 *   suggest(query)   the hint line under the bar: "deathtouch -> attr:deadly",
 *                    as a chip you click. You asked for it or it did nothing.
 *   KEYWORD_MEANING  what an attribute DOES, shown beside it in the detail
 *                    pane and searchable through `kw:` — because the only
 *                    {Thieving} card in the game never prints the word "draw",
 *                    so nothing else could ever find it that way.
 *
 * The tables are ported from cards.py rather than re-derived, so the two
 * search surfaces answer the same vocabulary question the same way. When you
 * add an entry here, add it there.
 */

export interface Suggestion {
  /** the word the user typed */
  word: string;
  /** the query fragment to offer instead */
  query: string;
  /** one line of why, for the chip's tooltip */
  why: string;
}

/** Plain English, and other card games' vocabulary, mapped onto the word that
 * is actually printed on an Algomancy card. */
const ALIASES: Record<string, string> = {
  creature: 'unit', creatures: 'unit', minion: 'unit',
  graveyard: 'bin', yard: 'bin',
  destroy: 'delete', destroys: 'delete', kill: 'delete', kills: 'delete',
  // "counterspell"/"cancel" only. Bare "counter" is left alone on purpose: on
  // an Algomancy card it overwhelmingly means a +1/+1 counter, and aliasing it
  // to negate would misdirect every query about counters.
  counterspell: 'negate', cancel: 'negate',
  bounce: 'recall', return: 'recall',
  etb: 'spawn', enters: 'spawn', battlefield: 'play',
  leaves: 'despawn', death: 'die',
  red: 'fire', blue: 'water', green: 'wood', brown: 'earth',
  grey: 'metal', gray: 'metal', silver: 'metal',
};

/** Words that are really a request for an attribute filter. */
const ATTR_WORDS: Record<string, string> = {
  trample: 'Piercing', deathtouch: 'Deadly', unblockable: 'Sneaky',
  flier: 'Flying', flyer: 'Flying', flies: 'Flying', fly: 'Flying',
  firststrike: 'Swift', lifelink: 'Blessed', menace: 'Evasive',
  doublestrike: 'Powerful', defender: 'Feeble', vigilance: 'Balanced',
};

/** Words that are really a request for an element filter. */
const ELEMENT_WORDS: Record<string, string> = {
  red: 'fire', blue: 'water', green: 'wood', brown: 'earth',
  grey: 'metal', gray: 'metal', silver: 'metal', white: 'light', black: 'dark',
};

/** Idioms that only mean something as a phrase — see cards.py on why "counter
 * a spell" is here while the bare word "counter" is not aliased anywhere. */
const PHRASES: Record<string, string> = {
  'counter a spell': 'negate',
  'counter target spell': 'negate',
  'enters the battlefield': 'spawn',
  'enters play': 'spawn',
  'comes into play': 'spawn',
  'leaves play': 'despawn',
  'first strike': 'swift',
  "can't be blocked": 'sneaky',
  'cant be blocked': 'sneaky',
  'double damage': 'powerful',
};

/**
 * What each keyword MEANS, phrased the way a player would describe the effect.
 *
 * This is the difference between a search that matches words and one that
 * finds cards. Verified against core.PRIMER's glossary on the Python side;
 * ui/glossary.ts holds the RULES text for the same terms and is the authority
 * when the two disagree — this is search text, and may be reworded for recall.
 */
export const KEYWORD_MEANING: Record<string, string> = {
  flying: 'flying flier can only be blocked by other flying units',
  piercing: 'excess combat damage beyond a blocked unit carries over to the defending player trample',
  electric: 'excess damage is redirected to an adjacent unit and chains across a row',
  deadly: 'any amount of combat damage it deals deletes the unit it hits deathtouch',
  poisonous: 'damages units with -1/-1 counters instead of ordinary combat damage',
  swift: 'deals its combat damage first strike',
  sluggish: 'deals its combat damage last',
  tough: 'its defense toughness is doubled',
  haste: 'may be played during the haste step at instant speed',
  virus: 'may be applied as a modification augment from your hand during battle',
  burst: 'can be cast any time but all burst spells of the same type are played at once',
  unstable: 'if it would go to the bin it is erased instead',
  battle: 'can only be used during a fight after attackers are declared',
  ambush: 'played during battle recalling one of your units and taking its position',
  powerful: 'deals double damage',
  reaping: 'when it kills one or more units its controller draws a card',
  thieving: 'when it deals combat damage to an opponent that player draws a card',
  resonant: "when it damages a unit it also deals that much damage to that unit's controller",
  vulnerable: 'receives double damage',
  feeble: 'cannot block',
  sneaky: 'cannot be blocked if it is attacking alone unblockable',
  evasive: 'requires two blockers to block it',
  alluring: 'the targeted enemy cannot attack and must block it this combat',
  unaware: 'ignores all stat changes',
  balanced: 'power and defense both become the greater of the two',
  inverted: 'reverses stat changes so a -7/-7 effect instead gives +7/+7',
  blessed: 'its controller gains that much life when it deals damage',
  afflicting: 'the opposing player loses life when it deals damage',
  lethal: 'deletes what it damages outright',
  pure: 'cannot be modified',
  modular: 'can be reconfigured between battles',
  augment: 'a modification attached from your bin onto any unit adding its text',
  graft: 'a modification attached under a unit that carries the graft symbol',
  prophecy: 'a cheaper alternative cost once a printed condition has come true',
  debt: 'a printed additional cost paid in debt rather than mana',
};

const words = (s: string): string[] => s.toLowerCase().match(/[a-z']+/g) ?? [];

/**
 * What the typed query might have meant, as clickable fragments.
 *
 * Only BARE words are considered: if someone wrote `o:trample` they have said
 * they want the literal text, and second-guessing that is the behaviour this
 * file exists to avoid. At most three suggestions, because a hint line longer
 * than the query is noise.
 */
export function suggest(src: string): Suggestion[] {
  // strip keyed terms and quoted phrases -- what is left is what was typed bare
  const bare = src
    .replace(/[A-Za-z]+(>=|<=|!=|:|=|>|<)(("[^"]*")|(\/[^/]*\/[a-z]*)|(\S+))/g, ' ')
    .toLowerCase();
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const push = (word: string, query: string, why: string): void => {
    if (seen.has(word) || out.length >= 3) return;
    seen.add(word);
    out.push({ word, query, why });
  };

  for (const [phrase, printed] of Object.entries(PHRASES)) {
    if (bare.includes(phrase)) push(phrase, `o:${printed}`, `Algomancy prints that as "${printed}"`);
  }
  for (const w of words(bare)) {
    const attr = ATTR_WORDS[w];
    if (attr) { push(w, `attr:${attr.toLowerCase()}`, `${w} is ${attr} here`); continue; }
    const el = ELEMENT_WORDS[w];
    if (el) { push(w, `el:${el}`, `${w} is the ${el} element`); continue; }
    const alias = ALIASES[w];
    if (alias && alias !== w) push(w, `o:${alias}`, `cards say "${alias}", not "${w}"`);
  }
  return out;
}

/** The meaning of a keyword, if we have one — for the detail pane and `kw:`. */
export const meaningOf = (term: string): string | null => KEYWORD_MEANING[term.toLowerCase()] ?? null;
