/* The in-game rules reference — the `? rules` overlay.
 *
 * This panel REPLACES the box's help cards. Everything in it is taken from the
 * game's own documents, in this order of preference:
 *
 *   1. the two player help cards (data/cards/Player-Keywords-Card.jpg and
 *      Player-Icons-Card.jpg) and the two turn-structure cards
 *      (Turn-Structure.jpg, 1v1-Turn-Structure.jpg) — quoted verbatim;
 *   2. the reminder text a card prints for an attribute (ui/glossary.ts reads
 *      it out of printed.json — see PRINTED_REMINDERS there);
 *   3. the Algomancy Manual (data/rules/Algomancy-Manual.txt) and the 2023
 *      rulebook, paraphrased only where the source is a diagram or a column
 *      the text extraction interleaved;
 *   4. the designer's own posted wording for the Light & Dark terms
 *      (data/rules/Light-and-Dark-Provisional-Glossary.md).
 *
 * ⚠ THIS IS PLAYER-FACING RULES COPY, NOT ENGINE DOCUMENTATION. Nothing here
 * may cite one of this client's own rulings by number, describe what the
 * client used to do, or explain an implementation. A player has never seen
 * this repository; the panel reads as the printed rules or it is wrong.
 * `test/286-rules-reference.test.ts` sweeps every string in it for both.
 *
 * DOM-free: the renderer returns HTML strings and the search is a pure
 * function, so the whole thing is unit-testable. The one DOM touch —
 * `installRulesOverlay` — wires a delegated listener and is only ever called
 * from ui/main.ts.
 */

import scanJson from './scan-reminders.json' with { type: 'json' };
import {
  KEYWORDS, LIBRARY_REMINDERS, MANUAL_REMINDERS, MECHANICS, PRINTED_REMINDERS, type GlossEntry,
} from './glossary.ts';
import { iconizeText, txtIcon } from './cardtext.ts';
import { esc } from './util.ts';
import { TUTORIAL, tutorialListHtml, tutorialSearch } from './tutorial.ts';

export interface RulesEntry {
  /** the heading — game markup ({Haste}, [Augment]) is drawn as icons */
  title: string;
  /** the rule. An array is a numbered sequence (a phase's steps). */
  body: string | readonly string[];
  /** icon files in data/icons drawn before the title */
  icons?: readonly string[];
  /** other words the search should find this entry under */
  alt?: readonly string[];
  /** where the wording comes from, as a reader would look it up */
  source?: string;
}

export interface RulesSection {
  id: string;
  title: string;
  /** one line under the heading, for the sections that need a frame */
  blurb?: string;
  entries: readonly RulesEntry[];
}

/* ── 1. the turn ─────────────────────────────────────────────────────── */

const TURN: RulesSection = {
  id: 'the-turn',
  title: 'Turn structure',
  blurb: 'Turns are global: both players go through every phase together, and the initiative '
    + 'decides who acts first wherever order matters. After deployment the initiative passes to the other player.',
  entries: [
    {
      title: 'Planning phase',
      body: [
        'Refresh resources — every expended resource is ready again.',
        'Draw 2 cards.',
        'Draft. Live draft: combine your hand with your pack, keep whatever you like, and leave exactly '
          + '10 cards in the pack before passing it. Constructed: draw 2 more and recycle 2.',
        'Gather and activate resources — recycle cards from your hand to create dormant resources, '
          + 'activate up to two resources, and exchange active Prismites.',
        'Haste step — play {Haste} cards. They resolve at once.',
      ],
      alt: ['resource step', 'draw step', 'draft step', 'mana step'],
      source: 'Turn Structure help card; Algomancy Manual, The Planning Phase',
    },
    {
      title: 'Battle phase — part 1, in the non-initiative player’s region',
      body: [
        'The initiative player attacks: units (and spell tokens riding with them) enter the other region in formation.',
        'Priority window.',
        'The non-initiative player declares blocks — and may send units to counterattack. Sent units leave now and fight in part 2.',
        'Priority window.',
        'Combat damage.',
        'After combat — a priority window.',
      ],
      alt: ['attack', 'battle structure', 'initiative attacks'],
      source: '1v1 Turn Structure help card',
    },
    {
      title: 'Battle phase — part 2, in the initiative player’s region',
      body: [
        'The non-initiative player attacks with the units sent in part 1 (or with a fresh attack if part 1 did not happen).',
        'Priority window.',
        'The initiative player declares blocks. There is no second counterattack — each side attacks once per turn.',
        'Priority window.',
        'Combat damage.',
        'After combat — a priority window.',
      ],
      alt: ['counterattack', 'battle structure'],
      source: '1v1 Turn Structure help card',
    },
    {
      title: 'Regroup',
      body: 'Automatic; nobody acts. All units and players return to their own regions, all damage on units is removed, '
        + 'all temporary stat changes are removed, all spell tokens are erased, and all units leave formation. '
        + 'Regroup happens before deployment, so anything you do in deployment lasts until the end of the next battle.',
      source: 'Turn Structure help card; Algomancy Manual, Regroup',
    },
    {
      title: 'Deployment phase',
      body: 'Both players deploy at the same time, each alone in their own region: play units and spells, apply '
        + 'augments and grafts from hand or bin, and activate abilities. There is no interaction with the other '
        + 'player and no priority; the only cards you cannot play are {Battle} cards. When both are done the moves are revealed.',
      alt: ['deploy', 'main phase'],
      source: 'Turn Structure help card; Algomancy Manual, Deployment Phase',
    },
    {
      title: 'End of turn',
      body: 'A short step after deployment where “at the end of the turn” abilities happen. Nothing can be played in '
        + 'it or in response to it. Then the initiative passes to the other player and a new turn begins with planning.',
      source: 'Algomancy Manual, End of Turn',
    },
    {
      title: 'Initiative',
      body: 'The player with the initiative acts first: they draw and draft first, attack first in battle, and receive '
        + 'priority first in every priority window. The other player gets to see what they do before acting. '
        + 'The initiative changes hands at the end of every turn.',
      alt: ['non-initiative', 'IT', 'NIT'],
      source: 'Algomancy Manual, Initiative',
    },
  ],
};

/* ── 2. the icons ────────────────────────────────────────────────────── */

const ICONS: RulesSection = {
  id: 'icons',
  title: 'Icons',
  blurb: 'The timing and mod symbols in a card’s corner and text box, as the player help card explains them.',
  entries: [
    {
      title: 'Battle', icons: ['battle'],
      body: 'Battle cards can only be played during the battle phase.',
      source: 'Player Icons help card',
    },
    {
      title: 'Haste', icons: ['haste'],
      body: 'Haste cards may be played in the planning step in addition to their normal timing — that is the haste step, '
        + 'right after resources. A haste card played there resolves immediately.',
      source: 'Player Icons help card',
    },
    {
      title: 'Augment', icons: ['augment'],
      body: 'Augment. During the deployment phase, this card’s cost including affinity may be paid to apply its text '
        + 'following the augment to target card in play. This may be done from hand or from the bin.',
      source: 'Player Icons help card',
    },
    {
      title: 'Graft', icons: ['graft'],
      body: 'Graft. Has the same timing and application rules as augment, except graft cards can only be applied to '
        + 'other graft cards. Grafted cards add their effects (everything after the graft symbol) to the conditions '
        + 'of other cards. The result is a card with one condition and multiple triggers. This is treated as one '
        + 'effect, it resolves all at once and can be negated as one large ability.',
      alt: ['switch'],
      source: 'Player Icons help card',
    },
    {
      title: 'Bounded graft', icons: ['bounded_graft'],
      body: 'Bounded Graft. This effect only happens once each turn. If the trigger condition is bounded, it will '
        + 'only trigger once each turn (even if it has unbounded grafts or no grafts attached to it).',
      alt: ['switch1', 'limited graft'],
      source: 'Player Icons help card',
    },
    {
      title: 'Virus', icons: ['virus'],
      body: 'Viruses may be grafted or augmented onto any legal target during battle (from hand) in addition to their '
        + 'normal mod timings.',
      source: 'Player Icons help card',
    },
    {
      title: 'Brackets [ ]',
      body: 'What’s between brackets must be completed in order to play a card or trigger an ability. [Sacrifice a '
        + 'unit] is an additional cost. [Power or Health] means a mode must be selected.',
      alt: ['cost', 'mode', 'additional cost'],
      source: 'Player Icons help card',
    },
    {
      title: 'Once', icons: ['once'],
      body: 'Do this only once each turn.',
      alt: ['1x', 'bounded'],
      source: 'Player Icons help card',
    },
    {
      title: 'Mana cost', icons: ['cost_3'],
      body: 'The number in the circle at the top left: this many resources must be expended to play the card. '
        + 'An X is an amount you choose as you play it; a token’s X is set by the card that created it.',
      alt: ['X', 'cost'],
      source: 'Algomancy Manual, Anatomy of an Algomancy Card',
    },
    {
      title: 'Affinity', icons: ['water', 'fire', 'earth', 'wood', 'metal'],
      body: 'The element pips beside the cost. Resource types that must be present among your resources to be '
        + 'able to play the card — each resource you have of that element counts as one, whether or not it is expended. '
        + 'Fire, Water, Earth, Wood, Metal.',
      alt: ['element', 'threshold', 'pip'],
      source: 'Player Keywords help card; Algomancy Manual, Anatomy of an Algomancy Card',
    },
    {
      title: 'Light and Dark', icons: ['light', 'dark'],
      body: 'The two elements of the Light & Dark expansion. They work exactly like the other five: a resource of the '
        + 'element gives one affinity of it and can be expended for mana.',
      alt: ['expansion', 'element'],
    },
    {
      title: 'Set symbol',
      body: 'The symbol at the bottom right indicates the expansion the card came from, and its colour denotes the '
        + 'complexity of the card.',
      alt: ['complexity', 'rarity'],
      source: 'Algomancy Manual, Anatomy of an Algomancy Card',
    },
  ],
};

/* ── 3. the attributes ───────────────────────────────────────────────── */

/**
 * The reminders printed on the card's TYPE LINE — which the oracle transcription
 * does not carry (its `{i}(…)` italics are the text-box reminders only), so
 * `PRINTED_REMINDERS` from ui/glossary.ts has none of these ten. They were read
 * off the scans by eye and live in ui/scan-reminders.json with the card each
 * came from; the panel shows them verbatim, as it does every other printed one.
 * (Until 2026-09-05 this panel claimed no card prints a reminder for them. The
 * cards do. The owner said so, and the scans agree.)
 */
const SCAN_REMINDERS: ReadonlyMap<string, { text: string; card: string }> =
  new Map(Object.entries(scanJson.reminders as Record<string, { text: string; card: string }>));

/** the attribute rows never printed as attributes: markers with a section of their own */
const NOT_ATTRIBUTES = new Set(['Ambush']);

const attributeEntry = (e: GlossEntry): RulesEntry => {
  const printed = PRINTED_REMINDERS.get(e.term)?.[0] ?? SCAN_REMINDERS.get(e.term);
  const manual = MANUAL_REMINDERS.get(e.term);
  const library = LIBRARY_REMINDERS.get(e.term);
  const body = printed?.text ?? manual?.text ?? library?.text ?? e.text;
  const source = printed ? `printed on ${printed.card}`
    : manual ? `Algomancy Manual, p.${manual.page}`
    : library ? `${library.card} (${library.library})`
    : 'no card prints a reminder for this attribute';
  return { title: e.term, body, source, ...(e.alt ? { alt: e.alt } : {}) };
};

const ATTRIBUTES: RulesSection = {
  id: 'attributes',
  title: 'Attributes',
  blurb: 'The bold words on a unit’s type line. Units in the same column of a formation share attributes — a column '
    + 'with a Flying unit in front and a Deadly unit behind fights as one Flying, Deadly column — and lose the shared '
    + 'ones the moment the unit carrying them leaves. Attributes apply in the order they are listed, top to bottom.',
  entries: KEYWORDS
    .filter(e => !NOT_ATTRIBUTES.has(e.term))
    .map(attributeEntry)
    .sort((a, b) => a.title.localeCompare(b.title)),
};

/* ── 4. the evergreen terms ──────────────────────────────────────────── */

const TERMS: RulesSection = {
  id: 'terms',
  title: 'Terms',
  blurb: 'The words the cards use, as the player help card defines them.',
  entries: [
    { title: 'Adjacent', body: 'Left, right, up, or down relative to a unit in formation. Cards not in formation have no adjacency.', source: 'Player Keywords help card' },
    { title: 'Affinity', body: 'An amount of Water, Fire, Earth, Wood or Metal (or Light or Dark) among your resources.', source: 'Player Keywords help card' },
    { title: 'Ally', body: 'A unit in this region under your control.', alt: ['allied'], source: 'Player Keywords help card' },
    { title: 'Bin', body: 'The zone where un-modded units go after they die, spells go after resolving and cards go when discarded.', alt: ['discard', 'graveyard'], source: 'Player Keywords help card' },
    { title: 'Cache', body: 'Place the card in a temporary zone. Cached cards are public: both players can see them. Being cached is not permission to play a card — only an effect that says so, such as a fulfilled prophecy or a glimpse this turn, lets you. You may augment or graft from the cache.', source: 'Player Keywords help card' },
    { title: 'Delete', body: 'Put into the bin (counts as death).', alt: ['destroy'], source: 'Player Keywords help card' },
    { title: 'Dies', body: 'A unit dies when it has been dealt damage at least equal to its defense, when its defense is 0 or less, or when it is sacrificed or deleted. An un-modded unit that dies goes to the bin; a modded unit is erased with its mods.', alt: ['death', 'die', 'killed', 'kill'], source: 'Algomancy Manual, Units; Stat Changes and Counters; Permadeath' },
    { title: 'Spawn / Despawn', body: 'Enter/leave play.', alt: ['enters play', 'leaves play'], source: 'Player Keywords help card' },
    { title: 'Effect', body: 'A played card, or an activated or triggered ability.', source: 'Player Keywords help card' },
    { title: 'Enemy', body: 'A unit in this region under an opponent’s control.', source: 'Player Keywords help card' },
    { title: 'Erase', body: 'Remove from the game (doesn’t count as death).', source: 'Player Keywords help card' },
    { title: 'Formation', body: 'A collection of units that have been assigned positions in combat. Units attack and block in formations.', source: 'Player Keywords help card' },
    { title: 'Modifications (Mods)', body: 'Grafts and augments applied to a unit.', alt: ['mod'], source: 'Player Keywords help card' },
    { title: 'Negate', body: 'Stop an effect from happening.', alt: ['counter'], source: 'Player Keywords help card' },
    { title: 'Play', body: 'Only units and spells are played. Applying a modification — an augment, a graft or a virus — is not playing a card, so “when you play a card” abilities do not see it.', alt: ['played', 'cast'] },
    { title: 'Recall', body: 'Return to its controller’s hand.', source: 'Player Keywords help card' },
    { title: 'Recycle', body: 'Put on the bottom of its owner’s deck.', source: 'Player Keywords help card' },
    { title: 'Region', body: 'The location each player’s base exists in. Regions are completely isolated from each other. What happens in one region has no impact outside of that region.', source: 'Player Keywords help card' },
    { title: 'Resolve', body: 'An effect resolves when it comes off the top of the stack and happens. A spell goes to the bin as it resolves; a spell unit enters play instead.', source: 'Algomancy Manual, The Stack; Anatomy of an Algomancy Card' },
    { title: 'Sacrifice', body: 'Take a permanent you control and put it into your bin, causing it to die. You cannot sacrifice something you don’t control, and you cannot sacrifice units that are in a different region, even if they are yours.', source: 'Algomancy Manual, Sacrifice' },
    { title: 'Target', body: 'A recipient of your choice for an effect. You can only target what is in your region — outside battle that means only your own things.', source: 'Player Keywords help card; Algomancy Rules Glossary' },
    { title: 'Trashed', body: 'A card entering a bin from anywhere other than the stack is trashed: discarded, sacrificed, milled, or a unit dying. A spell going to the bin as it resolves is not trashed, and an erased card never reaches a bin.', source: 'Light & Dark card text' },
  ],
};

/* ── 5. combat ───────────────────────────────────────────────────────── */

const COMBAT: RulesSection = {
  id: 'combat',
  title: 'Combat',
  entries: [
    {
      title: 'Attacking',
      body: 'To interact with the other player you enter their region. During the attack step you choose the units (and spell tokens) you '
        + 'bring, set them in formation, and they are in that region until regroup. Units cannot enter combat without being in a formation.',
      alt: ['attack', 'attacker'],
      source: 'Algomancy Rulebook, Attacking',
    },
    {
      title: 'Formations and columns',
      body: 'A formation can be any number of columns wide but only two units deep: a front row and a back row. The front row of a column '
        + 'must be filled before a unit can be placed behind it. If a unit is removed, the unit behind it moves to the front; if the last unit '
        + 'in an attacking column is removed before blocks, the columns beside it close in to fill the gap. Once set, units are locked in '
        + 'position and are adjacent to their left, right, front and back neighbours until regroup.',
      alt: ['column', 'front row', 'back row', 'hold the line'],
      source: 'Algomancy Rulebook, Combat Formations',
    },
    {
      title: 'Blocking',
      body: 'The defender places units in front of the attacking columns. Once a defending unit has been placed in front of an attacking '
        + 'column, that entire column is blocked: blocked units won’t deal combat damage to you, even if the units blocking them are removed. '
        + 'A defending formation can have missing columns.',
      alt: ['block', 'blocker'],
      source: 'Algomancy Rulebook, Blocking',
    },
    {
      title: 'Combat damage',
      body: 'All combat damage happens at once. Each attacking column deals damage equal to the combined power of its units: unblocked damage '
        + 'goes to the defending player’s life, blocked damage goes to the blocking column. Each blocking column deals its combined power to the '
        + 'column it blocks. A column takes damage front to back — enough to kill the front unit carries on to the back unit, and no further, '
        + 'unless the source is Piercing. A unit with negative power deals 0. All damage on units goes away at regroup.',
      alt: ['damage step', 'power', 'defense', 'health'],
      source: 'Algomancy Rulebook, Damage; Algomancy Manual, Q&A',
    },
    {
      title: 'Counterattack',
      body: 'When the non-initiative player declares blocks they may also send units to attack the initiative player’s region. Those units '
        + 'leave with the blocks and fight in the second part of the battle, after the first has fully resolved. Each side attacks once per turn.',
      alt: ['send', 'sent'],
      source: 'Algomancy Rulebook, Attacking in Teams',
    },
    {
      title: 'Spell tokens in battle',
      body: 'A spell token is cast from play, and only in the region it is in. It can be brought into another region with your attacking '
        + 'units during the attack step. That move is not reversible, and any spell token left over is erased at regroup.',
      alt: ['token', 'ride', 'riding'],
      source: 'Algomancy Rulebook, Spell Tokens',
    },
    {
      title: 'Life',
      body: 'Each player begins with 30 life. Bring an opponent to 0 to eliminate them.',
      alt: ['win', 'lose', 'eliminated'],
      source: 'Algomancy Manual, How to Win',
    },
  ],
};

/* ── 6. the stack and priority ───────────────────────────────────────── */

const STACK: RulesSection = {
  id: 'stack',
  title: 'The stack and priority',
  entries: [
    {
      title: 'Priority',
      body: 'Priority is the ability to perform game actions: play cards and activate abilities. A player with priority may do these things; '
        + 'a player without it may not.',
      source: 'Algomancy Manual, Priority',
    },
    {
      title: 'Priority window',
      body: 'In each region, the attack, block, damage and after-combat steps are each followed by a priority window, and so is the resolution of '
        + 'every effect. The initiative player receives priority first; if they decline, it passes to the other player. A player who takes an '
        + 'action keeps priority to take more; once they pass, the other player receives priority to respond. When both pass in a row, the top of '
        + 'the stack resolves — or, if the stack is empty, the step ends. You cannot respond to a pass: once both have passed there is no second chance.',
      alt: ['pass', 'response', 'respond'],
      source: 'Algomancy Manual, Priority Window',
    },
    {
      title: 'The stack',
      body: 'First in, last out. Whenever a card is played or an ability is activated or triggered during battle, it is added to the stack as an '
        + 'effect and does not resolve immediately, so the other player has a chance to respond. New effects go on top; when it is time to resolve, '
        + 'the top effect resolves first. New effects can be added on top of an active stack even after it has started resolving.',
      alt: ['first in last out', 'in response'],
      source: 'Algomancy Manual, The Stack',
    },
    {
      title: 'No priority outside battle',
      body: 'Planning, regroup and deployment have no priority windows: cards and abilities there happen at once, and end-of-turn triggers '
        + 'cannot be responded to. Interaction between players happens in battle.',
      source: 'Algomancy Manual, Regroup; End of Turn',
    },
    {
      title: 'Fizzle',
      body: 'If some but not all of a spell’s targets are removed before it resolves, it does as much as it can. If all of its targets are '
        + 'removed, the effect will not happen and the spell is placed into the bin.',
      alt: ['targets removed', 'illegal target'],
      source: 'Algomancy Manual, Q&A',
    },
  ],
};

/* ── 7. resources ────────────────────────────────────────────────────── */

/** the manual’s Shard sentence, as ui/glossary.ts reads it */
const shardText = MECHANICS.find(e => e.term === 'Shard')?.text
  ?? 'Shards are a resource that adds no affinity, but can still be expended for mana like all other resources.';

const RESOURCES: RulesSection = {
  id: 'resources',
  title: 'Resources',
  entries: [
    {
      title: 'Resources',
      body: 'Resources are how you play your cards. Each one gives one affinity of its element, and all resources can be expended for 1 mana once '
        + 'per turn to pay for the mana cost of cards and abilities. Expended resources still count towards affinity and refresh at the beginning '
        + 'of the turn.',
      alt: ['mana', 'expend', 'expended', 'refresh'],
      source: 'Algomancy Manual, Expended Resources',
    },
    {
      title: 'Dormant and active',
      body: 'To create a resource, recycle a card from your hand during the resource step. All resources spawn dormant. Dormant resources provide '
        + 'no affinity or mana. You may activate up to two resources each turn during the resource step, flipping them over permanently.',
      alt: ['activate', 'activation', 'recycle for a resource'],
      source: 'Dormant Resource card',
    },
    {
      title: 'Shard',
      body: shardText,
      alt: ['affinity bonus'],
      source: 'Algomancy Manual, Shards and Affinity Bonuses',
    },
    {
      title: 'Prismite',
      body: 'Each player begins the game with two dormant Prismites, which usually receive the two activations of the first turn. A Prismite has no '
        + 'element and gives no affinity, but it can be expended for mana like any resource. Its card reads: “Erase me: Create a non-prismite '
        + 'resource, then activate it. Do this only during the mana step. (This does not use one of your activations for turn.)” — so an active '
        + 'Prismite can be exchanged for a resource of any element.',
      alt: ['exchange', 'mana converter'],
      source: 'Prismite card; Algomancy Manual, The Planning Phase',
    },
  ],
};

/* ── 8. drafting and formats ─────────────────────────────────────────── */

const FORMATS: RulesSection = {
  id: 'formats',
  title: 'Drafting and formats',
  entries: [
    {
      title: 'Live draft',
      body: 'Both players share one deck and draft from it during the game. Each is dealt a pack of 10 face-down cards. In the draft step you combine '
        + 'your hand with your pack, keep whatever you want, and must leave exactly 10 cards in the pack before passing it — so you leave the step with '
        + 'as many cards as you entered it with. In 1v1 you draft from the same pack for three turns; then both packs are recycled into the deck and '
        + 'fresh ones are dealt.',
      alt: ['pack'],
      source: 'Algomancy Manual, Draw and Draft Step',
    },
    {
      title: 'Constructed',
      body: 'Each player brings a deck of at least 30 cards with at most 2 copies of any card. There is no shared deck or pack: in the draft step you '
        + 'draw 2 cards from your own deck and recycle 2 from your hand, which is usually done as drawing 4 and then putting 2 on the bottom.',
      alt: ['deck'],
      source: 'Algomancy Manual, Drafting in Constructed',
    },
    {
      title: 'Elements',
      body: 'A live draft is played with three elements: the shared deck is built from the cards of those three, and it is the only place cards come from.',
      alt: ['trio'],
      source: 'Algomancy Manual, Element Selection',
    },
  ],
};

/* ── 9. modifications ────────────────────────────────────────────────── */

const MODS: RulesSection = {
  id: 'mods',
  title: 'Modifications',
  entries: [
    {
      title: 'Augment', icons: ['augment'],
      body: 'The Augment mechanic allows players to take all of the text in the paragraph following the augment symbol and add it onto other cards. '
        + 'Pay the card’s mana cost, meet its affinity, and choose a unit you control to slide it under. It can be applied from your hand or your '
        + 'bin, during deployment — and during battle only as a virus. There is no limit to how many augments a card can carry.',
      source: 'Algomancy Manual, Augment',
    },
    {
      title: 'Graft', icons: ['graft'],
      body: 'Every graft card reads “cause → effect”. Grafting adds another card’s effect to a unit’s cause, so the unit reads “cause → effect 1 AND '
        + 'effect 2 …”. Both cards must carry the graft symbol. The new effect may be inserted at any position below the original card, but the rest '
        + 'may not be reordered. The result is one ability: it resolves all at once, top to bottom, and a single negate stops the whole of it. '
        + 'A bounded effect happens once per turn; a bounded cause bounds the whole ability.',
      alt: ['switch'],
      source: 'Algomancy Manual, Graft',
    },
    {
      title: 'Control of a modded card',
      body: 'A modified card is treated as a single card with all of the additional text. If you augment a card onto an opponent’s unit, they control '
        + 'that modification and all of its text applies to their card as if it were their own.',
      source: 'Algomancy Rulebook, Control and Language',
    },
    {
      title: 'Permadeath',
      body: 'As long as a card is modded it has the Unstable attribute: when it dies or is erased, the card and all of its mods are erased — permanently '
        + 'removed from the game. If a modded card would leave play without dying or being erased (for example, it is returned to your hand), its mods '
        + 'go to the bin while the card goes where it was sent.',
      alt: ['unstable', 'erased with its mods'],
      source: 'Algomancy Manual, Permadeath',
    },
    {
      title: 'Viruses', icons: ['virus'],
      body: 'Virus cards can also be applied as augments from your hand during battle, onto any legal target — yours or the enemy’s. Applying a virus '
        + 'uses the stack, so it can be responded to and negated; if it is negated or its target becomes invalid, it goes to the bin. A virus in a bin '
        + 'can be applied as normal during deployment but cannot be used as a mod during battle: the virus ability only works from hand.',
      source: 'Algomancy Manual, Viruses',
    },
  ],
};

/* ── 10. cards and effects ───────────────────────────────────────────── */

const CARDS: RulesSection = {
  id: 'cards',
  title: 'Cards and effects',
  entries: [
    {
      title: 'Units',
      body: 'Units are permanents: when played they stay in play until removed. A unit’s power is the damage it deals in combat and its defense is '
        + 'how much damage it can take in a battle before dying. When a unit dies or is deleted, it goes to the bin.',
      alt: ['unit', 'permanent', 'stats'],
      source: 'Algomancy Manual, Units',
    },
    {
      title: 'Spells',
      body: 'Spells provide one-time effects. When a spell resolves it goes directly to the bin. A spell unit has a one-time effect like a spell but '
        + 'also has stats, and enters play as it resolves rather than going to the bin.',
      alt: ['spell', 'spell unit'],
      source: 'Algomancy Manual, Spells',
    },
    {
      title: 'Tokens',
      body: 'Tokens are temporary cards created directly into play. If a token leaves play it is erased. Many tokens have an X value, set by the card '
        + 'that created them — “Create a Crystal 3” makes a Crystal with X = 3. A spell token is put into play in the region it was created in and is '
        + 'cast from there; Burst spell tokens with the same name are all cast at once.',
      alt: ['token', 'spell token', 'unit token', 'burst'],
      source: 'Algomancy Manual, Tokens',
    },
    {
      title: 'Stat changes and counters',
      body: '+1/+1 or -1/-1 as an effect is a temporary change to a unit’s power and defense — it lasts until regroup, or for as long as the static '
        + 'ability giving it is in play. A +1/+1 or -1/-1 counter is a permanent change; a +1/+1 counter and a -1/-1 counter on the same unit cancel '
        + 'out and are both removed. A unit with 0 or less defense immediately dies.',
      alt: ['counter', 'counters', 'buff', 'until regroup'],
      source: 'Algomancy Manual, Stat Changes and Counters',
    },
    {
      title: 'Order of stat effects',
      body: 'Stats are applied in layers: printed stats; then base stats (“base 3/3” replaces the printed numbers); then stat changes and counters; '
        + 'then attributes like Tough; then Inverted; then Unaware. So a 0/4 Tough unit with a -1/-1 counter is a -1/6.',
      alt: ['base', 'layers', 'tough', 'balanced'],
      source: 'Algomancy Manual, Q&A',
    },
    {
      title: 'Triggered abilities',
      body: '“When” and “Whenever” denote triggered abilities: effects that happen when something else happens. They may also be tied to a moment, '
        + 'like “After combat” or “At the end of the turn”. During battle a trigger goes on the stack; outside battle it happens at once.',
      alt: ['trigger', 'when', 'whenever'],
      source: 'Algomancy Manual, Triggered Abilities',
    },
    {
      title: 'Activated abilities',
      body: 'An activated ability has a colon. Everything before the colon is a cost that must be paid to activate the ability; the effect is what '
        + 'follows it. Activated abilities can be used whenever you have priority during battle, and during deployment, as many times as you can pay.',
      alt: ['activate', 'ability', 'cost'],
      source: 'Algomancy Manual, Activated Abilities',
    },
    {
      title: 'Static and replacement abilities',
      body: 'A static ability declares a change that a card is continuously making to the game as long as it is in play. An ability using the word '
        + '“instead” is a replacement effect: it modifies an event as it happens rather than responding to it, and it never uses the stack.',
      alt: ['static', 'instead', 'replacement'],
      source: 'Algomancy Manual, Static Abilities; Replacement Effects',
    },
    {
      title: 'Ambush', icons: ['battle'],
      body: 'The ambush ability allows a unit to be played as an effect during battle that recalls an allied unit, placing the ambushing unit directly '
        + 'into its position in play. A card in the way of a removal spell can be saved this way — the spell does not change targets and fizzles. '
        + 'Ambush is itself a targeted effect: if the target is removed, the ambush fizzles and the ambushing unit goes to the bin.',
      source: 'Algomancy Manual, Ambush',
    },
    {
      title: 'Prophecy',
      body: 'A second cost on a banner beneath the title, “Prophecy — condition”. To prophecy, cache this card during deployment by paying its prophecy '
        + 'cost. You may play it for free, as if it were in your hand, if the prophecy has been fulfilled. The condition counts from the moment you '
        + 'prophecy; a fulfilled prophecy also lets you augment or graft the card for free.',
      alt: ['prophesy', 'fulfilled'],
      source: 'printed prophecy reminder text',
    },
    {
      title: 'Glimpse',
      body: 'Reveal the top X cards of the deck and cache one. Until end of turn, you may play it as if it was in your hand, ignoring affinity. '
        + 'Recycle the rest.',
      source: 'printed on Premonition',
    },
    {
      title: 'Rot',
      body: 'A counter on a player. At the start of deployment, you take damage equal to the number of rot you have. Rot does not go away.',
      source: 'Rot Counter card (the designer’s card library)',
    },
    {
      title: 'Debt',
      body: 'A counter on a player. After the resources step, for each debt you have, you must pay 1 mana and the debt is removed. If you cannot pay '
        + 'for all of the debt, then only what you can pay for is removed; the rest stays.',
      source: 'the designer’s Light element announcement',
    },
  ],
};

/** every section, in the order the panel prints them */
export const RULES_SECTIONS: readonly RulesSection[] =
  [TURN, ICONS, ATTRIBUTES, TERMS, COMBAT, STACK, RESOURCES, FORMATS, MODS, CARDS];

/* ── search ──────────────────────────────────────────────────────────── */

/** the words of a query, lower-cased, with the game markup a player might paste stripped */
const words = (q: string): string[] =>
  q.toLowerCase().replace(/[{}[\]()]/g, ' ').split(/\s+/).filter(Boolean);

/** a query word without its English ending, so "erased" finds Erase, "blockers"
 * finds Blocking and "prophesied" finds Prophecy; short words are left alone */
function stem(w: string): string {
  const m = /^(.{4,}?)(?:ing|ies|ied|ers|ed|es|s|d|y)$/.exec(w);
  return m ? m[1]! : w;
}

/** does the haystack contain the word, or the stem of it? */
const hasWord = (hay: string, w: string): boolean => hay.includes(w) || hay.includes(stem(w));

/** everything the search may match an entry on, as one lower-cased string */
export function entryHaystack(e: RulesEntry): string {
  const body = Array.isArray(e.body) ? e.body.join(' ') : String(e.body);
  return [e.title, body, ...(e.alt ?? [])].join(' ').toLowerCase();
}

/**
 * The sections with only the entries matching `q` — every word of the query
 * must occur somewhere in the entry’s title, body or alternate spellings. An
 * empty query is every section, untouched; a section with nothing left is
 * dropped rather than printed as an empty heading.
 */
export function rulesSearch(q: string, sections: readonly RulesSection[] = RULES_SECTIONS): RulesSection[] {
  const ws = words(q);
  if (!ws.length) return [...sections];
  return sections
    .map(s => ({ ...s, entries: s.entries.filter(e => { const h = entryHaystack(e); return ws.every(w => hasWord(h, w)); }) }))
    .filter(s => s.entries.length > 0);
}

/* ── rendering ───────────────────────────────────────────────────────── */

export type HelpTab = 'rules' | 'tutorial';

/** one entry as a reference row */
export function entryHtml(e: RulesEntry): string {
  const icons = (e.icons ?? []).map(i => txtIcon(i, '')).join('');
  const body = Array.isArray(e.body)
    ? `<ol>${e.body.map(step => `<li>${iconizeText(step)}</li>`).join('')}</ol>`
    : iconizeText(String(e.body));
  const src = e.source ? `<em class="rulesrc">${esc(e.source)}</em>` : '';
  return `<div class="helprow"><b>${icons}${iconizeText(e.title)}</b><span>${body}${src}</span></div>`;
}

export function sectionHtml(s: RulesSection): string {
  return `<section class="rulesec" id="rs-${esc(s.id)}"><h4>${esc(s.title)}</h4>
    ${s.blurb ? `<p class="rulesblurb">${iconizeText(s.blurb)}</p>` : ''}
    ${s.entries.map(entryHtml).join('')}</section>`;
}

/** the scrolling body of the rules tab for a query — what the search patches in place */
export function rulesListHtml(q: string): string {
  const hits = rulesSearch(q);
  if (!hits.length) return `<div class="helpempty">Nothing in the rules matches “${esc(q)}”.</div>`;
  return hits.map(sectionHtml).join('');
}

/** the jump bar: one chip per section on screen */
function jumpHtml(tab: HelpTab, q: string): string {
  const secs = tab === 'rules' ? rulesSearch(q) : tutorialSearch(q).map(s => ({ id: s.id, title: s.title }));
  if (!secs.length) return '';
  return `<div class="rulesjump">${secs.map(s =>
    `<button data-btn="helpjump" data-sec="${esc(tab === 'rules' ? `rs-${s.id}` : `tt-${s.id}`)}">${esc(s.title)}</button>`).join('')}</div>`;
}

/** the overlay's box: tabs, the search box, the jump bar, the list. The
 * modal scrim around it is ui/main.ts's, like every other board overlay's. */
export function rulesBoxHtml(tab: HelpTab, q: string): string {
  const tabBtn = (t: HelpTab, label: string): string =>
    `<button class="helptab${tab === t ? ' on' : ''}" data-btn="helptab" data-tab="${t}">${label}</button>`;
  const placeholder = tab === 'rules'
    ? 'search the rules — an attribute, an icon, a phase, a word on a card…'
    : 'search the guide — a button, a setting, a screen…';
  return `<div class="overlaybox helpbox">
    <div class="helphead">
      <h3>${tab === 'rules' ? 'Rules reference' : 'How to use the interface'}</h3>
      <div class="helptabs">${tabBtn('rules', 'Rules')}${tabBtn('tutorial', 'How to use the interface')}</div>
    </div>
    <input id="rules-q" class="rulesq" type="search" spellcheck="false" autocomplete="off"
      placeholder="${placeholder}" value="${esc(q)}">
    ${jumpHtml(tab, q)}
    <div class="helpscroll" id="rules-list">${tab === 'rules' ? rulesListHtml(q) : tutorialListHtml(q)}</div>
    <button data-btn="helpclose">Close</button>
  </div>`;
}

/* ── the one DOM touch ───────────────────────────────────────────────── */

let query = '';
let tab: HelpTab = 'rules';

// (no getters: nothing reads the query or the tab back — the box is redrawn
// from them by helpBoxHtml below, which is the only consumer)
export function setHelpTab(t: string | undefined): void { tab = t === 'tutorial' ? 'tutorial' : 'rules'; }

/** the box as ui/main.ts draws it, off the tab and query kept here */
export const helpBoxHtml = (): string => rulesBoxHtml(tab, query);

/** the list, repainted in place for the current query — never a board repaint */
function patchList(): void {
  const list = document.getElementById('rules-list');
  if (list) list.innerHTML = tab === 'rules' ? rulesListHtml(query) : tutorialListHtml(query);
}

/** put the caret in the search box once the overlay is on screen */
export function focusRulesSearch(): void {
  setTimeout(() => {
    const el = document.getElementById('rules-q') as HTMLInputElement | null;
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, 0);
}

/** scroll one section into view inside the list */
export function jumpToSection(id: string | undefined): void {
  if (!id) return;
  const el = document.getElementById(id);
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
}

/**
 * The delegated listeners the search box needs. Delegated — on `document` —
 * because the board is repainted wholesale on every update and a listener on
 * the input itself would not survive the paint. Escape in the box clears the
 * query first; a second Escape reaches ui/main.ts’s own handler, which closes
 * the overlay like any other.
 */
export function installRulesOverlay(): void {
  document.addEventListener('input', e => {
    const el = e.target as HTMLInputElement | null;
    if (!el || el.id !== 'rules-q') return;
    query = el.value;
    patchList();
    // the jump bar shrinks with the results; cheap to redraw, so redraw it
    const jump = document.querySelector('.helpbox .rulesjump');
    const fresh = jumpHtml(tab, query);
    if (jump) { if (fresh) jump.outerHTML = fresh; else jump.remove(); }
    else if (fresh) document.getElementById('rules-q')?.insertAdjacentHTML('afterend', fresh);
  });
  document.addEventListener('keydown', e => {
    const el = e.target as HTMLInputElement | null;
    if (!el || el.id !== 'rules-q' || e.key !== 'Escape' || !query) return;
    query = '';
    el.value = '';
    patchList();
    e.preventDefault();
    e.stopImmediatePropagation();
  });
}

/** the tutorial’s sections, re-exported so the panel’s two tabs are read from one place */
export { TUTORIAL };
