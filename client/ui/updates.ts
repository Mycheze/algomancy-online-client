/*
 * RECENT UPDATES — the changelog on the home page, one line per push.
 *
 * The owner, 2026-09-23: "a little area on the homepage, above the footer …
 * a 'recent updates' log that shows what's been added/fixed/changed with each
 * new push". Every push that reaches algomancy.online adds an entry at the TOP
 * of `UPDATES`, in the same commit as the change it describes (CLAUDE.md §
 * Deploy, "Every push players can see gets an update line") — not
 * reconstructed afterwards.
 *
 * WHAT AN ENTRY IS. One or two plain sentences a player would care about, the
 * length of a short tweet (`MAX_UPDATE_CHARS`). Say what changed for someone
 * playing, not how: no ruling numbers, no ticket ids, no file names. A push
 * with nothing a player can see (a test, a ledger row, a deploy script) gets
 * no entry. A push that does three unrelated visible things can take three.
 *
 * `323-recent-updates.test.ts` holds the list to that shape: newest first, a
 * real date not in the future, a known kind, and short.
 *
 * Drawn by the home screen only: `updatesHtml` is the whole band (a
 * `section.updates` with its heading), `updatesListHtml` the list alone, for
 * a sheet that has a heading of its own (docs/24's Updates sheet, opened from
 * the home's bottom bar). `updatesUnseen()` is that button's "N new" badge
 * and `markUpdatesSeen()` is called when the list is OPENED.
 */
import { esc } from './util.ts';

export type UpdateKind = 'new' | 'fix' | 'change';

export interface Update {
  /** ISO day the push went live, `YYYY-MM-DD` */
  date: string;
  kind: UpdateKind;
  /** plain text — escaped when painted, so no markup */
  text: string;
}

/** a short tweet's worth */
export const MAX_UPDATE_CHARS = 240;

/** how many show before "Older updates" */
export const SHOWN_UPDATES = 6;

const KIND_LABEL: Record<UpdateKind, string> = { new: 'New', fix: 'Fix', change: 'Change' };

/** NEWEST FIRST. Add the next push's line at the top. */
export const UPDATES: readonly Update[] = [
  { date: '2026-11-06', kind: 'fix', text: 'Reloading into a game that has ended brings its Game summary back at once. It used to be worked out all over again on every reload, which on a crowded board held up every game on the server for a few seconds.' },
  { date: '2026-11-06', kind: 'change', text: 'The Everywhere has its new printing: it names a card as it is played, or when it or the unit it is on is modded, instead of during Haste.' },
  { date: '2026-11-06', kind: 'change', text: 'Murkstalker and Seer of Empty Spaces have their new printings: Murkstalker costs 2 and drains 1 life instead of 3, and Seer costs 2.' },
  { date: '2026-11-06', kind: 'change', text: 'Mindburn\'s card picture is now its new printing, with the new art and the new text on the card itself.' },
  { date: '2026-11-06', kind: 'change', text: 'Mindburn now has its new text: each player sacrifices a nontoken unit, gains a rot or discards a card, X times. Gaining a rot is always an option, so nobody runs out of choices.' },
  { date: '2026-11-06', kind: 'new', text: 'Four or more identical units in one region, like a crowd of Robots, now stand as one overlapping stack with a count on it. Hover the stack, or tap its count, to fan them all out.' },
  { date: '2026-11-06', kind: 'fix', text: 'During a battle, when the board is short on room, your opponent\'s units no longer spread far apart across the screen, and the last of them no longer slips out of sight. They stand side by side, overlapping only when there are too many.' },
  { date: '2026-11-06', kind: 'fix', text: 'Games with a crowded board, like a field full of Robots, run much faster, and the Game summary now shows up when the game ends instead of half a minute later.' },
  { date: '2026-11-06', kind: 'fix', text: 'After you reconnect or reload mid-game, the table no longer flashes back to an older board for a moment before it catches up.' },
  { date: '2026-11-06', kind: 'fix', text: 'In a deck description, writing a card as [[Card Name]] now makes it a card link you can hover, without the brackets showing.' },
  { date: '2026-11-05', kind: 'fix', text: 'When several units die at once, a "whenever a unit dies" ability a dying unit got from an augment or a graft, like Refuse Reclaimer\'s, now still sees the others die, whichever order they go in.' },
  { date: '2026-11-05', kind: 'fix', text: 'After a game lost on time, "view the final board" no longer strands you: the bar says who won and has Post-game summary and Home, and the table menu no longer offers to concede a finished game.' },
  { date: '2026-11-05', kind: 'change', text: 'Casting a group of Burst tokens: the one you click now resolves first, so you no longer click it twice. You pick the rest in order, the last one too, instead of having it placed for you.' },
  { date: '2026-11-05', kind: 'fix', text: 'A trigger you may pay for, like Thoughtripper\'s, no longer reads on the stack as if it will surely happen: its line now ends "if you pay 2" until you decide.' },
  { date: '2026-11-05', kind: 'fix', text: 'On the deck table, letting go of a card over the "Main deck" row at the top no longer makes a new pile at the end: the card goes back where it came from.' },
  { date: '2026-11-05', kind: 'fix', text: 'On the deck table, a long deck name is now cut short with "…" instead of running under the card count beside it on narrower screens.' },
  { date: '2026-11-05', kind: 'fix', text: 'A deck exported as a card list now includes its sideboard, and pasting that list back in puts the sideboard and the maybeboard where they belong instead of into the deck.' },
  { date: '2026-11-05', kind: 'fix', text: 'The soft green pulse round a unit whose ability you can use now stays whole at the edge of the table, instead of being cut off on the side that touches it.' },
  { date: '2026-11-05', kind: 'fix', text: 'A spell on the stack no longer drops the "s" from "pays" or "gains" when a player\'s or unit\'s name ends in 1, e.g. "unless Player 1 pays 5".' },
  { date: '2026-11-05', kind: 'fix', text: 'Units sacrificed together to pay one cost (Infernal Cultivator, Malevolent Machinations, Deformant) now die at the same moment, so each one sees the others die and the order you pick them in no longer matters.' },
  { date: '2026-11-05', kind: 'fix', text: 'The rules reference now says Reaping right: killing one or more units draws one card, not a card for each unit killed.' },
  { date: '2026-11-05', kind: 'fix', text: 'Life Channel now counts the life you actually gained: under Arbiter of Vitality its 3 becomes 6 and the unit gets +6/+6, and if the gain is stopped the unit gets nothing extra. The number shown in your hand agrees.' },
  { date: '2026-11-05', kind: 'fix', text: 'If all your blockers die after blocks, you can still play a unit like Tiderunner Initiate into the column they were blocking, and it blocks there. Before, you were offered only the unblocked columns.' },
  { date: '2026-11-05', kind: 'fix', text: 'A column that gains Swift after Swift damage now deals its normal damage, and one that loses Sluggish before Sluggish damage still strikes then. Before, either one dealt no combat damage at all.' },
  { date: '2026-11-04', kind: 'fix', text: 'When several units die at once, the game log now puts each "Deadly" or "Unaware" reason right before that unit\'s own death line, instead of listing all the reasons first.' },
  { date: '2026-11-04', kind: 'fix', text: 'Automaton of Abundance and Cosmic Conspirator: when you choose the Automaton first, that choice now holds for every token the effect makes, so a Poison the Conspirator later turns into a Robot is no longer copied.' },
  { date: '2026-11-04', kind: 'fix', text: 'On the deck table, the bar between the card pool and your piles can always be dragged back down, even after shrinking the pool all the way.' },
  { date: '2026-11-04', kind: 'new', text: 'Decks are rebuilt: your decks sit on a shelf you pick from, and building is one table — every card above, your piles below, the sideboard and maybe beside them. Drag or tap, with undo and redo.' },
  { date: '2026-11-04', kind: 'fix', text: 'You can always get back home: leaving a test game shows its end screen right away, and a finished game, a game you are watching, or a room that closed while you were away all have a Home button.' },
  { date: '2026-11-04', kind: 'change', text: 'The rules open full screen. The comprehensive rules read like a book: contents on the side, one section at a time, a search that finds rules and jumps to a number like 608.2b, and every rule number a link with a Back button.' },
  { date: '2026-11-04', kind: 'change', text: 'Every page now shares the home screen’s look and fits on one screen: Cards, Metagame, Matchmaking, your profile, sign-in, League, the weekly challenge, the rooms and Admin. Each has the same toolbar, and its lists scroll by themselves.' },
  { date: '2026-11-03', kind: 'change', text: 'Sideboarding between Competitive games happens on the deck table: your deck below, your sideboard above. Tap a card or drag it across.' },
  { date: '2026-11-03', kind: 'fix', text: 'The board is easier to read: tooltips fit their text, card text sits in one box, the action bar keeps one height and shows its notices instead of popping them up, and empty block slots and live counts lose their clutter.' },
  { date: '2026-11-03', kind: 'change', text: 'A new look: the site now uses the colours of the official rulebook, deep purple with orange highlights, and the comprehensive rules are dark like everything else.' },
  { date: '2026-11-03', kind: 'change', text: 'A new home screen that fits on one screen: one Play card for drafts and constructed games (Competitive included), with Beginner mode, bans and the card filter right on it, and League, Challenge and Matchmaking beside it.' },
  { date: '2026-11-03', kind: 'new', text: 'Competitive matches, best of 1 or 3: a sideboard of up to 7 to swap between games, 45 minutes each for the whole match unless you pick another clock, and players plan and deploy in turn. A match can be paused between games.' },
  { date: '2026-11-03', kind: 'fix', text: 'The Report button no longer covers the bottom of a page or a button like the League page’s “Suggest a time”: pages now leave room for it.' },
  { date: '2026-11-03', kind: 'fix', text: 'League page: on a touch screen the availability help says to tap the hours, and on a phone the “Suggest a time” box fits the screen.' },
  { date: '2026-11-03', kind: 'fix', text: 'Your profile now says when something did not work: the Friends list failing to load (with a Try again button), picking a favourite element, unlinking Discord, or a ladder that will not load.' },
  { date: '2026-11-03', kind: 'change', text: 'Tidier buttons on the Find a game screen, and on the signed-out home page the Challenge button no longer drops onto a row of its own.' },
  { date: '2026-11-03', kind: 'fix', text: 'Search boxes and form fields that showed up as white boxes now match the dark theme, helper text is a quieter grey everywhere, and keyboard focus shows a clear ring.' },
  { date: '2026-11-03', kind: 'fix', text: 'League sign-up on a phone: swiping over the hours grid scrolls the page again, and a tap marks or clears one hour. The grid also works from the keyboard: Tab to it, move with the arrow keys, press Space to mark.' },
  { date: '2026-11-03', kind: 'change', text: 'Giving up a weekly challenge run, or dropping a finished run you have not submitted, now asks you to press again first.' },
  { date: '2026-11-03', kind: 'fix', text: 'Custom rules on the home page work again: banning cards, the + and − steppers, Simple cards only and the Beginner preset had stopped doing anything. Banned cards now sit in a tidy row instead of piling on top of each other.' },
  { date: '2026-11-03', kind: 'fix', text: 'Find a game is one clean card again instead of a box hanging out of another box, and the Accept button no longer misses a click when the countdown ticks. The countdown no longer jumps ahead after you accept.' },
  { date: '2026-11-03', kind: 'fix', text: 'The home page no longer wipes what you are typing (your name, a room code, a deck link or list) when someone joins the queue, and signed-in players no longer see “Playing signed out” flash up while the page loads.' },
  { date: '2026-11-03', kind: 'fix', text: 'Watching a replay, typing in the judge or report box no longer pauses or steps the game, and Escape closes the box instead of leaving the replay.' },
  { date: '2026-11-03', kind: 'fix', text: 'Hovering a card on your deck page, in the card search or on the metagame pages shows its text again. Return to Lobby works when you opened your decks from a waiting room.' },
  { date: '2026-11-03', kind: 'fix', text: 'Deck names are big and bold again at the top of the deck page, and card names in the list view are bold. The ladder and the Link Discord button now say when something went wrong instead of showing nothing.' },
  { date: '2026-11-01', kind: 'change', text: 'When a card has each player choose (General Smof, Perish, Rockfall…), the player with initiative now always picks first. A unit they pick is marked for the other player before their turn to pick; a card picked from a hand stays secret.' },
  { date: '2026-11-01', kind: 'fix', text: 'Glowing card outlines are no longer cut off at the edge of the hand, the play area and the resource row.' },
  { date: '2026-11-01', kind: 'fix', text: 'Card text when you hover or zoom a unit keeps the card’s own line breaks, so a second ability starts on its own line again.' },
  { date: '2026-11-01', kind: 'fix', text: 'Abduct and Gravitational Correction on the stack now say how much the opponent has to pay, e.g. “unless Gember pays 5”.' },
  { date: '2026-11-01', kind: 'fix', text: 'An opponent’s unit carrying several mods no longer jumps to the far left of their side on some screen sizes. It stays where their units start, and you click it where you see it.' },
  { date: '2026-11-01', kind: 'change', text: 'Weekly challenges: debt now counts. Debt you still owe when you meet the goal adds the turns it would take to pay off, so borrowing your way to a turn-2 finish no longer pays. Past runs have been re-scored.' },
  { date: '2026-11-01', kind: 'new', text: 'Every card now has a link of its own. Pin a card in the card search and press “copy link”; the link opens the search with that card pinned, and shows the card in a Discord preview.' },
  { date: '2026-11-01', kind: 'new', text: 'You can now read the full comprehensive rules in How to play, under the new Comprehensive rules tab. A link can also take someone straight to a single rule.' },
  { date: '2026-11-01', kind: 'new', text: 'When you paste a link to the site into Discord, the preview now matches the page: the league, this week’s challenge, the card search, a deck, a card, a rule or a game invite, each with its own picture and description.' },
  { date: '2026-11-01', kind: 'fix', text: 'The judge now remembers the conversation, so a follow-up question like "and what if it has Flying?" is answered with your earlier questions in mind.' },
  { date: '2026-11-01', kind: 'fix', text: 'Gravitational Correction and Divine Intervention can now move a target onto themselves as they resolve: point a Null Drone at the Correction and it negates nothing. An effect still can never target itself.' },
  { date: '2026-11-01', kind: 'change', text: 'A trigger that reads a spell’s cost, like Death Greeter’s, now names that spell on the stack too: “costing 2 or less (Squish)”.' },
  { date: '2026-11-01', kind: 'new', text: 'The League page has a Discord time code maker: pick a time in your own zone and copy a code that shows it in each reader’s zone when you paste it into Discord.' },
  { date: '2026-11-01', kind: 'new', text: "Sign-ups are open for the November league: casual constructed. Bring any deck, and change it every game if you like. Week 1 starts Sunday 8 November." },
  { date: '2026-11-01', kind: 'change', text: 'While the October final is on, the home page and the League page show it next to the November sign-ups, so finalists can play the final and sign up in the same week.' },
  { date: '2026-11-01', kind: 'fix', text: 'Stasis Sentry no longer forces an X spell to X = 3 or more. You choose X freely, and an X of 3 or less costs 3 to play during battle: Torrential Reclamation for X = 2 takes two targets and costs 3.' },
  { date: '2026-11-01', kind: 'change', text: "Death Greeter's trigger on the stack now says how cheap the sacrificed unit must be, such as 'a unit costing 4 or less', even after the spell that set it off has left the stack." },
  { date: '2026-11-01', kind: 'fix', text: 'A unit that is erased when it dies (an Unstable unit, or one carrying a mod) is no longer trashed. It still dies, but cards that care about trashing no longer see it.' },
  { date: '2026-11-01', kind: 'new', text: 'You can change your password from your profile page.' },
  { date: '2026-10-29', kind: 'new', text: 'A bigger table. Your resources, the phase, your bin and cache and your life now sit on one line just above your hand, the side panel is a slim toolbar on the right, and the gaps between the boxes are thinner.' },
  { date: '2026-10-29', kind: 'change', text: "Hover or tap a player's name to see how many cards are in their hand, deck, recycle pile, bin and cache. Hover or tap the phase icons by your hand to see the phase, step and turn." },
  { date: '2026-10-29', kind: 'change', text: 'The main button now says where it takes the game: To Blockers, To Damage, End Battle, End Turn and so on, with a note when your opponent can still respond.' },
  { date: '2026-10-29', kind: 'new', text: 'Hover any card to read it big, with its current text beside it: what it says right now, its attributes, its mods, and where its power and defense come from. On a tablet, press and hold a card.' },
  { date: '2026-10-29', kind: 'change', text: 'Invaders are a small pile now: hover it, or tap its count, to spread it out. Spell tokens of the same size stack under a count, biggest first, at the far end of your units. Hover them for a summary.' },
  { date: '2026-10-29', kind: 'change', text: 'The classic board is gone: everyone plays on the regions board.' },
  { date: '2026-10-27', kind: 'new', text: 'Forgot to counterattack? If you confirm your blocks with units left over and none sent, the game now asks: pick the units to send (or All), or choose No counterattack. Send while blocking, as before, and it never asks.' },
  { date: '2026-10-25', kind: 'fix', text: 'Automaton of Abundance and Cosmic Conspirator: when you make a token you now choose which applies first, so you can copy a Robot and then swap both. Automaton copies each kind of token once per effect, grafted cards included.' },
  { date: '2026-10-25', kind: 'change', text: 'If the order of two effects only changes how big a number gets (Conduit of Pain with Powerful or Arbiter of Vitality, Proliferating Slime with Counter Thief), the bigger result is a one-click default; you can still pick the other order.' },
  { date: '2026-10-25', kind: 'change', text: "When both players have effects that could change the same thing, the initiative player's now apply first and nobody is asked. With a Counter Thief on each side, the other player's thief ends up with the counters." },
  { date: '2026-10-25', kind: 'fix', text: 'Units killed by Deadly, and units sacrificed by the same card (Perish, Cull and the rest), now die at the same moment as the others, so cards that react to deaths see all of them.' },
  { date: '2026-10-25', kind: 'change', text: 'If one card drops your opponent to 0 and also makes you draw from an empty deck, the game now waits for the card to finish, and then the higher life total wins.' },
  { date: '2026-10-25', kind: 'change', text: 'A Virus played by Tides of the Cosmos can now go onto a spell on the stack or a spell token in play, just like a Virus played from your hand.' },
  { date: '2026-10-25', kind: 'fix', text: 'Biomass Devourer, Cthyrian Rector and Murkdrop Distiller no longer lose track of their card when another copy of it leaves the bin first.' },
  { date: '2026-10-25', kind: 'fix', text: "The line under a spell on the stack now counts Arbiter of Vitality, Flux Resonator, Proliferating Slime and damage shields. On a touch screen, a bin card's Play button now works on the first tap." },
  { date: '2026-10-25', kind: 'fix', text: "Watching a game, the top player's hand no longer disappears when they have a lot of resources, and it is drawn bigger on smaller screens." },
  { date: '2026-10-25', kind: 'new', text: "The Learn to Play tutorial now ends with links to buy Algomancy or its print-and-play edition from the creator's shop." },
  { date: '2026-10-25', kind: 'fix', text: 'Torrential Reclamation now shows its current card text and image: for each ally recalled, each player sacrifices a unit and you lose 1 life. How it plays has not changed.' },
  { date: '2026-10-25', kind: 'change', text: 'If one effect drops both players to 0 life, the higher life total wins, even below 0. On an exact tie the player with initiative loses.' },
  { date: '2026-10-25', kind: 'change', text: 'Running out of cards now ends the game. In constructed, the player who has to draw from an empty deck and recycle pile loses. In live draft the game ends and the higher life total wins.' },
  { date: '2026-10-25', kind: 'fix', text: 'Inverted now reverses base stat changes too: a 7/5 made a 3/3 by Aberrant Statweaver is an 11/7 while Inverted. Ruinbringer and the other "delete all" cards now delete everything at once, so death triggers hear every unit.' },
  { date: '2026-10-25', kind: 'change', text: "In battle you can now apply a Virus to a spell token in play, yours or your opponent's. Giving a unit Sluggish after Swift damage now opens a chance to respond before its Sluggish strike." },
  { date: '2026-10-25', kind: 'change', text: 'In a draft you can now recycle a card for, or turn a Prismite into, a resource of any element. The elements outside your draft are under "more…".' },
  { date: '2026-10-25', kind: 'new', text: 'While you declare blockers, a card placed where it cannot block (a Feeble unit, a non-flyer against a flyer, an unmet Alluring duty) now shows a red (!), and the bar says why.' },
  { date: '2026-10-25', kind: 'change', text: 'On a touch screen, tapping your own spell token or a resource now shows the card first. Tap the Cast or Activate button that appears to use it.' },
  { date: '2026-10-25', kind: 'fix', text: "Clicking a card in your hand that you can't play now says why, and on the classic board hovering does too. The damage a spell on the stack says now counts Conduit of Pain and a Vulnerable target." },
  { date: '2026-10-25', kind: 'fix', text: 'Report works during a draft pick, a big counterattack no longer stretches the classic board, a second quick play flies from your hand, and a spectated top hand shows whole cards. Rewinding to the step before really goes back a step.' },
  { date: '2026-10-25', kind: 'fix', text: "League: sitting out a week now takes two presses, so a stray tap can't take you out of it. Sat out a week by mistake and its pairings are already up? The organizer can put you back in." },
  { date: '2026-10-25', kind: 'fix', text: "Proph and Stalwart Sentinel now trigger when you play a unit, not when it enters play. Their ability resolves before the unit arrives, and still happens if the unit is negated." },
  { date: '2026-10-25', kind: 'fix', text: "The deployment stack now resolves in the same order as the battle stack. An ability you activate goes on it like a card you play, so anything it triggers (a unit sacrificed to pay for it, say) resolves first." },
  { date: '2026-10-24', kind: 'new', text: "League achievements: play in a league season to earn League Regular (with rungs for 3 and 6 seasons), and win one for League Champion. They unlock when the season closes." },
  { date: '2026-10-24', kind: 'fix', text: "Playing without an account? When a game ends you can sign up right there and keep that game as your first. A name typed into a game no longer puts it on someone else's profile." },
  { date: '2026-10-24', kind: 'fix', text: "On a touch screen, tapping a card in your bin now just shows it instead of playing it. To use it, open your bin and tap the button under the card." },
  { date: '2026-10-24', kind: 'fix', text: "The glossary now explains Electric, Glimpse, Graft and Pure the way the game plays them: Electric excess is never lost, an expired glimpse can't be modded, and Pure switches off Tough, Balanced, Inverted and Unaware." },
  { date: '2026-10-24', kind: 'fix', text: 'Torrential Reclamation no longer makes anyone sacrifice a unit when it recalls nothing.' },
  { date: '2026-10-24', kind: 'fix', text: 'Balanced now always applies after Tough, whatever gave each one, so a Balanced unit always has equal power and defense. A 3/8 given a Balanced augment and then a Tough one is now 16/16, not 8/16.' },
  { date: '2026-10-24', kind: 'fix', text: 'The Everywhere names a card, and a token is not a card: Unit Tokens, Robots, Wisps and other tokens are no longer on its list.' },
  { date: '2026-10-24', kind: 'new', text: 'Finished a league season? Your place (Champion, Finalist or Participant) now shows as a trophy on your profile, and the final standings mark the champion and finalist.' },
  { date: '2026-10-24', kind: 'fix', text: 'Weekly challenges: a run whose last action both meets the goal and ends the game now counts, instead of failing to submit.' },
  { date: '2026-10-24', kind: 'new', text: "Hover or tap a card in your hand that you can't play and it now says why: not enough mana, the wrong step, or nothing to aim it at." },
  { date: '2026-10-24', kind: 'fix', text: 'A spell on the stack now shows the damage it will really deal, so a Powerful Fireball shows the doubled number.' },
  { date: '2026-10-24', kind: 'change', text: "When every unit an \"up to one\" ability can hit is your own, like Minor Kraken's recall, the game now asks before you pick one." },
  { date: '2026-10-24', kind: 'fix', text: 'Opening the link of a finished game now says the game is over and who won, instead of claiming there is no such game.' },
  { date: '2026-10-24', kind: 'fix', text: "Ancient One now borrows only the augment text of a neighbour's mod, and keeps its neighbours' \"when I leave\" abilities when it is recalled, cached or dies alongside them." },
  { date: '2026-10-24', kind: 'new', text: 'Card search now has is:bounded and is:unbounded, to find just the once-per-turn grafts or just the unlimited ones.' },
  { date: '2026-10-23', kind: 'change', text: 'Weekly challenges now have three leaderboards, each with its own winner: Fastest (fewest turns), Leanest (fewest cards) and Purest (fewest elements), plus an Overall view. Skill is gone.' },
  { date: '2026-10-23', kind: 'fix', text: "Ancient One beside Echo of Despair now makes copies of Ancient One. It also borrows its neighbours' grafted and granted abilities, two Ancient Ones side by side share everything, and a dying one has its neighbours' when-I-die abilities." },
  { date: '2026-10-23', kind: 'fix', text: "Paying X life is now one loss of X life, not X losses of 1. Life Plant with Flesh Tithe for 29 makes 29 units, not 1, and the same goes for Torrential Reclamation's life loss." },
  { date: '2026-10-23', kind: 'new', text: "A bug report sent from a weekly challenge or Learn to Play now includes your game, so we can replay exactly what happened." },
  { date: '2026-10-23', kind: 'new', text: "Watch on a closed challenge week now says whether the rules have changed since the run was played. A run that would no longer play out the same is marked \"played on older rules\"; its score and rank stand." },
  { date: '2026-10-23', kind: 'fix', text: "Vroot, Flowstone Arcanite and Blightmound now trigger on all combat damage their column deals, including damage that goes into Oorblak instead of the player." },
  { date: '2026-10-23', kind: 'fix', text: "Card Stats now count cards played from the cache, and mods applied from it." },
  { date: '2026-10-23', kind: 'new', text: "In battle you can now keep priority after you act and do something else before your opponent can answer: hold Ctrl as you play, or turn on the new Hold priority button next to Pass. Nobody can hold priority in deployment." },
  { date: '2026-10-23', kind: 'fix', text: "Wake the Dead now plays its units onto the stack, where they can be answered, and a spell unit casts its spell first. The Bonesculptor and Gridxlan simply let you play a unit from your bin, with nothing on the stack." },
  { date: '2026-10-23', kind: 'change', text: "Pure now ignores all other attributes, as printed: Tough, Balanced, Inverted and Unaware do not apply on a Pure unit, or on a unit in a fight or damage exchange with one. That includes a hit redirected into Oorblak." },
  { date: '2026-10-23', kind: 'fix', text: "A Lethal attack that goes entirely into Oorblak no longer kills the player, and a Thieving column draws nothing from it. Damage that gets past Oorblak still counts." },
  { date: '2026-10-23', kind: 'fix', text: "Gatekeeper of Souls only forces targets during a battle in its own region, and a Virus applied in that battle has to go on it too." },
  { date: '2026-10-23', kind: 'change', text: "Each region now has its own stack: an effect in one region can no longer answer a spell in the other region, or reach the bin of a player who is not there." },
  { date: '2026-10-23', kind: 'fix', text: "Blockers on either side of an unblocked column are no longer neighbours. A lone Hooba that dies before its attack trigger resolves still puts its unit into its formation." },
  { date: '2026-10-23', kind: 'fix', text: "An Ambush now pays costs other cards add to plays, like Arbiter of Armistice's life and Vengeance's sacrifice. A card played for free in the middle of an effect pays its own extra costs and debt too." },
  { date: '2026-10-23', kind: 'fix', text: "Copies of a unit, and Ancient One, now get a once-a-turn use for each ability they copy or borrow. A Prismite can be exchanged into a Shard, and tokens no longer appear on the erased pile." },
  { date: '2026-10-23', kind: 'fix', text: "Two copies of the same once-per-turn ability on one unit now each work once a turn. A Jollyglop wearing another Jollyglop makes units from both when it is dealt damage." },
  { date: '2026-10-21', kind: 'new', text: "Build on the table: a deck builder page with your cards in piles, and a challenge deck as a row in deal order. Drag cards from a binder of every card, around or back out. On a tablet, hold a card to lift it, or tap it, then where it goes." },
  { date: '2026-10-21', kind: 'new', text: "Weekly challenges: a new puzzle every Sunday. Build a deck in the exact order you want it dealt, reach the goal with as few cards, elements and turns as you can, and climb the leaderboard. Last week's decks open when the week ends." },
  { date: '2026-10-21', kind: 'fix', text: "Watching a game or a replay no longer shows the player's draw-phase prompt over the replay controls." },
  { date: '2026-10-21', kind: 'fix', text: "Tides of the Cosmos and Big Glimpse Card now shuffle your recycled cards in when the deck is short, so you see the full number of cards. Anything that reaches the bottom of your deck does the same." },
  { date: '2026-10-21', kind: 'fix', text: "A card played for free in the middle of an effect, as with Tides of the Cosmos, now asks for every target it needs, just as from hand. Tidal Reversion takes one unit of each player." },
  { date: '2026-10-21', kind: 'fix', text: "When the player with the initiative attacks or blocks and that sets off one of their own abilities, they now get to act first." },
  { date: '2026-10-21', kind: 'change', text: "Void Mandible, Eldritch Dreamtender and Cthyrian Rector are now sacrificed as their ability resolves, not when it goes on the stack. Kill one in response and its ability does nothing." },
  { date: '2026-10-21', kind: 'fix', text: "Enigmatic Warder, Gravitational Correction and Divine Intervention can now redirect a Virus being applied. Aimed at an effect with no targets, the two spells ask first; Warder only aims where it could be a target." },
  { date: '2026-10-21', kind: 'change', text: "Abilities that say you may target something now offer No targets at the first choice, instead of making you pick a target and decline later." },
  { date: '2026-10-21', kind: 'new', text: "Pressing Done in deployment or the haste step now asks first if you have not played anything but could have." },
  { date: '2026-10-21', kind: 'new', text: "Finished games have a Dispute game button next to Rematch, for when a bug decided the result. It files a report and tags the game; in a league, the organizer sees it." },
  { date: '2026-10-21', kind: 'change', text: "When you propose a take-back, each option now says what it takes back, and nothing is picked for you. In a hidden step you can only take back your own moves." },
  { date: '2026-10-21', kind: 'fix', text: "The card panel no longer crosses out an attribute a unit still has, such as Piercing gained after Transmogrifant started applying." },
  { date: '2026-10-18', kind: 'fix', text: "Scrapyard Custodian now draws when you create a Robot. Anything that arrives with counters counts as having them put on it, so Pestilent Mycelion triggers too, and in battle a Counter Thief takes them." },
  { date: '2026-10-18', kind: 'new', text: "Cards revealed to you now stay on screen until you close them or something new is revealed, and they no longer cover your hand. Right-click the table (or tap ☰) for Past reveals." },
  { date: '2026-10-18', kind: 'change', text: "In planning, drafting, choosing cards for the bottom and recycling no longer swap the card in the right-hand panel. Cards you play still show there." },
  { date: '2026-10-18', kind: 'fix', text: "The rot and debt counters next to a player's life are plain words now, without the little icons." },
  { date: '2026-10-18', kind: 'new', text: "League news now arrives in the bell: pairings, results, an opponent waiting. On the League page, suggest a time for a match; your opponent sees it in their own time zone, and you both get a reminder 15 minutes before." },
  { date: '2026-10-18', kind: 'new', text: "Invite your friends to a game. Make a room and your friends are listed under the room code, online ones first. Click one and they get a popup that takes them straight to your table. The new bell holds invites and friend requests." },
  { date: '2026-10-18', kind: 'change', text: "Augmented and grafted units now show each mod peeking out underneath, like on a real table, so you can see a mod land without hovering. Click the unit to see its mods' names; hover a name to see the card." },
  { date: '2026-10-18', kind: 'fix', text: "Meteor Shower now plays as its current card: it costs two Earth, and when you play it, it copies itself twice, so three separate Meteor Showers fall one after another." },
  { date: '2026-10-17', kind: 'new', text: "Beta: if the game gets something wrong, propose a fix from the table menu. When your opponent agrees you can set a life total, draw a missed card, move a card, or rewind a few actions." },
  { date: '2026-10-17', kind: 'change', text: "Units and spell tokens you send to counterattack now have to go: there is no \"Don't attack\" in a counterattack, and a lone unit forms by itself. If every attacker is gone before blocks, nothing can block, but you can still counterattack." },
  { date: '2026-10-17', kind: 'fix', text: "An Ambush is no longer treated as a spell: Cosmic Reversal, Dreadwave Devourer and other spell-only effects leave it alone, and Nothyr can now negate one." },
  { date: '2026-10-17', kind: 'fix', text: "Cards that say \"target\" now need their targets: Tilling the Graves needs two units in your bin, and X spells like Blight's End only let you pick an X you can fill." },
  { date: '2026-10-17', kind: 'new', text: "Ordering triggers: each pick shows its number, click one to take it back or Start over, then Confirm. Casting a group of spell tokens has an Undo last pick button." },
  { date: '2026-10-17', kind: 'fix', text: "When Tides of the Cosmos or Big Glimpse Card reveals cards, the other player now sees the cards themselves, not just a line in the log." },
  { date: '2026-10-17', kind: 'fix', text: "The Play button on the home page's league banner opens your match even if you haven't visited the League page. If the match can't start, the League page opens and says why." },
  { date: '2026-10-16', kind: 'new', text: 'Prediction Prophet\'s prediction now shows on the card, for both players.' },
  { date: '2026-10-16', kind: 'fix', text: 'Vroot\'s stack shows its own column\'s damage, not the whole attack\'s. A zoomed card greys only its type bar when attributes are off, and only its text box when abilities are off.' },
  { date: '2026-10-16', kind: 'fix', text: 'When nothing is picked yet for an "up to" target, the button reads "No targets" and is a normal button. An "up to" choice ends by itself once you have picked the most it allows.' },
  { date: '2026-10-16', kind: 'fix', text: 'Typing in the Report form no longer reaches the game: Enter, Ctrl+Z and Ctrl stay in the form, and the board waits a moment after you send.' },
  { date: '2026-10-16', kind: 'fix', text: '"Yes, activate?" now waits for an answer: only clicking the same unit again, Yes or Enter confirms, and other clicks do nothing. Discard and sacrifice costs skip the question and go straight to the pick.' },
  { date: '2026-10-16', kind: 'change', text: 'When several replacement effects apply at once they all apply, one after another, and when the order matters (two Oorblaks, two Counter Thieves) you choose it. Oorblak always takes a hit before Blightsea Polyp can turn it into rot.' },
  { date: '2026-10-16', kind: 'change', text: 'Wraiths choose which ally to shrink or augment as each one resolves, so a pile of Wraiths no longer fizzles while you still have an ally.' },
  { date: '2026-10-16', kind: 'fix', text: 'A unit that loses its abilities to Transmogrifant, Monke or The Everywhere now stops giving its other effects too. With two Transmogrifants in play, only the newer one works.' },
  { date: '2026-10-16', kind: 'fix', text: 'Automaton of Abundance copies a 3/3 or X/X token at its full size instead of as a 1/1, and two Automatons each add a copy.' },
  { date: '2026-10-16', kind: 'fix', text: 'Poisonous combat damage now counts as counters you put, so Wandering Blightshell draws. Removing counters no longer counts as putting them on.' },
  { date: '2026-10-16', kind: 'fix', text: 'Abduct can be played in battle against units that cost 1 or more, and its X menu offers only values that can take something.' },
  { date: '2026-10-13', kind: 'fix', text: 'Counter Thief is printed "Counter Theif": a deck or search using that spelling now finds the card, and so do saved decks, custom games and card stats.' },
  { date: '2026-10-12', kind: 'change', text: 'The game log and card details no longer show internal ruling numbers, and the About page now describes the comprehensive rules the client follows.' },
  { date: '2026-10-12', kind: 'new', text: 'The judge now answers from the full rules document as well, says when an answer rests on an unofficial ruling or on how the online client plays, and lists its sources under each answer with a link to the rule it rests on.' },
  { date: '2026-10-11', kind: 'change', text: 'In a battle the units grow into the room there is and stand in the middle of the fight, which widens only when a big attack needs it. Units waiting to block match the size of their slots, and on a small screen every rank now fits.' },
  { date: '2026-10-11', kind: 'fix', text: 'Life gained or lost from a trigger, such as Iyngstra\'s, now shows and sounds when the trigger resolves on the stack, not the moment you play the card.' },
  { date: '2026-10-11', kind: 'change', text: 'The game toggles (auto-pass, bluff haste, motion, board, sound) now sit behind "⋯ more" on a computer too, as they already did on a tablet. Rules and the judge stay where they were.' },
  { date: '2026-10-11', kind: 'fix', text: 'The tilted dice and chips on a zoomed card no longer have their corners cut off.' },
  { date: '2026-10-11', kind: 'fix', text: 'A card never triggers on its own play: Stalwart Sentinel and Proph played from your cache, bin or deck, and Bloomcaster or Void Mandible brought back by Wake the Dead, no longer count themselves.' },
  { date: '2026-10-10', kind: 'fix', text: 'Casting a spell token such as a Fireball now counts as playing a spell from outside your hand, so Stalwart Sentinel and Proph trigger on it.' },
  { date: '2026-10-10', kind: 'change', text: 'Piercing is a choice outside combat too: when a Piercing unit deals damage through Squish, Fight, Battle or an ability, its controller may keep the excess on the unit instead of sending it to the player.' },
  { date: '2026-10-10', kind: 'fix', text: 'Borrower of Forms now gets the augments of the unit it copies: a copied virus or other augment works on the copy, not just in its text.' },
  { date: '2026-10-10', kind: 'fix', text: 'Side-blocks can now be placed to the left of the attack as well as the right, and placement buttons number columns the same way the board does.' },
  { date: '2026-10-10', kind: 'new', text: 'Side-blocks: you can block where no attacker stands, with any number of units, each as its own column. A unit played in front of an unblocked attacker after blocks now blocks it.' },
  { date: '2026-10-10', kind: 'change', text: 'Piercing is now a choice: when your Piercing unit is blocked you split its damage yourself, and may keep the excess on the blocker instead of sending it to the player.' },
  { date: '2026-10-10', kind: 'fix', text: 'Resonant now deals damage, so Conduit of Pain and Powerful apply to it and Crevice Lurker taxes it. Conduit of Pain adds its 1 before Powerful doubles.' },
  { date: '2026-10-10', kind: 'change', text: 'A unit\'s effect still resolves after the unit dies, using how it last was: Bellowing Boulder stays Deadly, Flamebreath Initiate still makes a Fireball, and the Hoobas remember their formation.' },
  { date: '2026-10-10', kind: 'change', text: 'Ability stripping (Monke, Transmogrifant, Suppression Field, Formless) removes what a unit has when it applies; anything it gains afterwards still works. Suppression Field takes the whole column.' },
  { date: '2026-10-10', kind: 'fix', text: 'A spell needs every target it asks for before you can cast it (Fight, Tidal Reversion), and a target that stops being legal before it resolves is skipped.' },
  { date: '2026-10-10', kind: 'change', text: 'Tides of the Cosmos can play a card as a Virus, an Ambush or a Prophecy, and a card played mid-spell pays its extra costs. Under Stasis Sentry, X spells start at X = 3.' },
  { date: '2026-10-10', kind: 'fix', text: 'Copies such as Borrower of Forms use the copied card\'s cost and grafts and are not Unstable. A grafted cost can no longer be declined. Reconfigure keeps a once-per-turn ability used.' },
  { date: '2026-10-10', kind: 'change', text: 'On a phone or tablet, tapping a card in your hand now just shows it, so you can read it without playing it. Drag the card onto the table to play it.' },
  { date: '2026-10-10', kind: 'change', text: 'The deployment recap now waits for you: it stops after your opponent\'s moves and again after the end of turn. Press Space or Continue to go on; Skip jumps to the next stop. The haste step works the same way.' },
  { date: '2026-10-10', kind: 'fix', text: 'Twin Flame and other spells with two targets can now hit Gatekeeper of Souls and something else. Before, Gatekeeper of Souls took the only target.' },
  { date: '2026-10-10', kind: 'fix', text: 'While your opponent builds a counterattack, their units show at a readable size instead of squeezed and cut off at the edge of the fight.' },
  { date: '2026-10-06', kind: 'fix', text: 'You can counterattack with any number of units: the counterattack box wraps onto more rows instead of running off the edge, and Counterattack with the rest sends every unit you have left in one click.' },
  { date: '2026-10-06', kind: 'fix', text: 'A unit that drops to 0 defense outside combat now dies straight away. Dreadspawn Horror could sit at 0 defense after the turn\'s draw and survive the whole turn.' },
  { date: '2026-10-04', kind: 'change', text: 'The league banner is shorter: its How it works list folds away, and starts folded once you have joined.' },
  { date: '2026-10-04', kind: 'change', text: 'The league is a button away: look for League on the home page and on your profile, even with the league banner folded.' },
  { date: '2026-10-04', kind: 'new', text: 'The October League is open! Sign up from the home page, mark when you can play, and this week play anyone free when you are. Weekly pairings start Sunday 11 October, with a final in November.' },
  { date: '2026-10-04', kind: 'fix', text: 'Cached cards now work exactly like cards in your hand: a cached Virus can be applied in battle, and a cached Ambush card can ambush.' },
  { date: '2026-10-04', kind: 'change', text: 'A Glimpse during deployment or the haste step stays hidden from your opponent until the recap, where it pops up. Once a Glimpse has shown you cards, undo cannot take it back.' },
  { date: '2026-10-04', kind: 'change', text: 'Activating an ability no longer asks you to confirm while you can still undo it (planning, haste and deployment). In battle it still asks.' },
  { date: '2026-10-04', kind: 'change', text: 'The deployment recap now pauses a moment before the next turn starts.' },
  { date: '2026-10-04', kind: 'fix', text: 'A server update no longer warns that your game was restored onto changed rules when nothing changed.' },
  { date: '2026-10-04', kind: 'fix', text: 'Unstable Apparition now makes its Fireball when you play an X spell, sized to the X you paid. It used to count the spell as costing 0, make nothing, and still use up its once-per-turn trigger.' },
  { date: '2026-10-04', kind: 'new', text: 'Spells on the stack now show their attributes as chips, the way units do, including ones another card gives them, like the Powerful your Fireballs get from Emberflame Enlightener.' },
  { date: '2026-10-04', kind: 'fix', text: 'A spell that removes its own target and is still resolving, like Celestial Purge mid-Glimpse, no longer says its target is gone.' },
  { date: '2026-10-04', kind: 'fix', text: 'Constructed games now show the elements each side played, yours first, instead of always reading fire, water and earth.' },
  { date: '2026-10-04', kind: 'change', text: 'The clock setting moved off the top of the home page: it is under Custom rules on Live draft and under Options on Constructed. Changing it does not make a game custom.' },
  { date: '2026-10-04', kind: 'change', text: 'Games nobody is in now close on their own: an hour after the last move if fewer than five moves were made, otherwise twelve hours. A closed game has no winner and is not rated.' },
  { date: '2026-10-03', kind: 'new', text: 'No more pop-up list of your opponent\'s deployment: their moves now play back on the board one at a time, then the end of turn does the same. Your clock is paused while it plays, and Space skips it.' },
  { date: '2026-10-03', kind: 'fix', text: 'A card you play now makes one smooth trip, from your hand to the stack and then onto the board, and tokens fly out of the card that made them. No more copies flickering in two places, and the stack window stays put.' },
  { date: '2026-10-01', kind: 'new', text: 'Casting a group of Burst tokens lets you choose their order: click the one that should resolve first and aim it, then the next. The first one you pick resolves first.' },
  { date: '2026-10-01', kind: 'change', text: 'Spell tokens show their X as a big die face on the card, so a Fireball 3 and a Fireball 5 are easy to tell apart.' },
  { date: '2026-10-01', kind: 'change', text: 'The cache is redone: each cached card shows on the table with a chip that says where it stands, such as a prophecy count that ticks up, "free" once fulfilled, or "turn" for a glimpse.' },
  { date: '2026-10-01', kind: 'fix', text: 'Your cache shows a whole card again beside your bin instead of a sliver, and the dimmed background behind a window no longer leaves a bright strip beside the side panel.' },
  { date: '2026-10-01', kind: 'change', text: 'Interdiction Rift now says plainly that you target an opponent, who then chooses which of their own effects is negated.' },
  { date: '2026-10-01', kind: 'fix', text: 'A card you glimpsed can now be prophesied from your cache during deployment, just as it could from your hand.' },
  { date: '2026-09-30', kind: 'fix', text: 'The card you are playing now waits beside the stack, over the region not in use, and neither it nor the stack window sits on top of units or labels any more: each takes the nearest empty spot.' },
  { date: '2026-09-30', kind: 'new', text: 'Building a counterattack has its own layout: the units you sent wait full-size beside the fight, every slot is drawn, and "One column" or "Pairs" builds a shape in one click.' },
  { date: '2026-09-30', kind: 'fix', text: 'Divine Intervention, Gravitational Correction and Hexbane Shiitake can no longer aim two targets of one spell at the same unit, and each new target must be one that spell could have chosen.' },
  { date: '2026-09-30', kind: 'fix', text: 'A column whose blocker was removed now says "blocker gone" instead of "unblocked". It always stayed blocked; the board just said otherwise.' },
  { date: '2026-09-30', kind: 'fix', text: 'An opponent\'s revealed hand stays on screen during a battle, over the region not being fought in.' },
  { date: '2026-09-30', kind: 'change', text: 'While the report form is open, nothing passes for you, so the moment you are reporting stays put. An extra sacrifice cost now says it is a cost, not a target.' },
  { date: '2026-09-30', kind: 'change', text: 'The card you are playing now waits at the bottom-left of the table while you make its choices, with its arrows coming from it, instead of vanishing from your hand. Cancel and it goes back.' },
  { date: '2026-09-30', kind: 'change', text: 'You now choose by clicking the card or player on the table: targets, sacrifices, discards, a mod to erase. The bar keeps plain buttons, and pictures only for cards not in play. A glowing card says "Keep" or "Discard" when it matters.' },
  { date: '2026-09-30', kind: 'new', text: 'The stack now says what each spell and ability will do, in one short line with the real names: "Negate Twin Flame. Rashi draws a card." Amounts show as a number, or as "X (currently 4)" when checked on resolve.' },
  { date: '2026-09-30', kind: 'change', text: 'The stack speaks in fewer colours: yours, theirs, grey for anything that fizzled, and red for an effect whose target has gone. Hovering a stack card now shows what it does and when it resolves.' },
  { date: '2026-09-30', kind: 'change', text: 'Abilities on the stack no longer look like cards: they are shorter, with a printed-style name bar, and a grafted or augmented ability shows the text it is carrying. Reconfigure, Fight and friends now say which target does what.' },
  { date: '2026-09-28', kind: 'change', text: 'Spell tokens now count as spells you play: The Silent and Tranquility make them cost more, Stasis Sentry makes them cost 3 in battle, and casting one counts toward spells played this battle.' },
  { date: '2026-09-28', kind: 'change', text: 'A token dying is no longer a card being trashed. Dropslime, Splort, Muck Rummager and the other trash cards count only real cards now.' },
  { date: '2026-09-28', kind: 'new', text: 'Wake the Dead and Tides of the Cosmos open a picker: their bin and yours side by side, click up to two cards, and the mana left is shown as you go.' },
  { date: '2026-09-28', kind: 'fix', text: 'While you have Pass all on, your clock no longer runs. When one card triggers several times in a row, the triggers now resolve three times as fast.' },
  { date: '2026-09-28', kind: 'change', text: 'Unit power and defence now sit in the top-right corner, as on the printed cards. The prompt bar, the waiting line and the erased cards window say much less, and the catching-up counter is gone.' },
  { date: '2026-09-28', kind: 'fix', text: 'After a game ends, the last attack stays on the board, so you can see how it finished. Inexorable Miasma no longer asks when no unit has a -1/-1 counter, and Cosmic Conspirator shows the kept token as a card.' },
  { date: '2026-09-28', kind: 'fix', text: 'Format Fluent now asks for the two formats you can actually play: live draft and constructed.' },
  { date: '2026-09-27', kind: 'new', text: 'Metagame has a Card Stats tab: win rates in hand, in the opening hand and when played, pick rates, how often each card is main-decked, and how every element and colour pair is doing — from every game played here.' },
  { date: '2026-09-27', kind: 'new', text: 'You can now drag cards: drag a card from your hand onto the table to play it, onto a unit to augment or graft it, or onto a formation slot to build an attack or blocks. Clicking works as before.' },
  { date: '2026-09-27', kind: 'new', text: 'On a tablet or phone, press and hold any card to read it up close. Letting go does nothing, so you can look without playing.' },
  { date: '2026-09-27', kind: 'change', text: 'Better on tablets and foldables: on a narrow screen the side panel slides in from a ☰ button, buttons are easier to tap, and the long how-to sentences are gone from the prompt bar.' },
  { date: '2026-09-27', kind: 'change', text: 'On a tablet or phone the side panel is compact: table, report and undo are icons, and the rules, the judge and the game settings are behind a "more" button. Computers keep the full panel.' },
  { date: '2026-09-27', kind: 'change', text: 'The draft step and choosing cards to put on the bottom now open in their own window. Press "look at the board" to check the table, and "back to the draft" to carry on.' },
  { date: '2026-09-27', kind: 'new', text: 'Building an attack or blocks? Click a unit, then press a number key to put it in that column: the front if it is free, otherwise the back.' },
  { date: '2026-09-27', kind: 'fix', text: 'A spell or ability that targets a formation now points its arrow at that formation in the battle, not at the player\'s side of the board.' },
  { date: '2026-09-27', kind: 'new', text: 'A unit whose abilities or attributes have been switched off now shows it: a ⊘ marker on the card, and when you zoom in, its rules are greyed out with a note saying what turned them off.' },
  { date: '2026-09-27', kind: 'change', text: 'Keyword reminders like Unaware, Feeble and Sneaky now use the short sentence printed on the cards. The full explanation stays in the rules reference.' },
  { date: '2026-09-27', kind: 'change', text: 'Face-down cards, like your opponent\'s hand, now show the real Algomancy card back.' },
  { date: '2026-09-27', kind: 'fix', text: 'Cards in your hand that can be used more than one way have a single green border again, and their label says play instead of cast.' },
  { date: '2026-09-27', kind: 'change', text: 'In a battle, spell tokens and other invaders now stand small down the right of the fight instead of in a row above it, so the columns get more room. Columns sit closer together, and the bin no longer runs into its border.' },
  { date: '2026-09-27', kind: 'fix', text: 'Cards like Soul Siphon now show a single X on your hand card: the best you can get right now. The side panel lists each option and keeps it up to date, so it no longer sticks at 0.' },
  { date: '2026-09-27', kind: 'change', text: 'Clicking a dormant resource to activate it no longer puts its card in the side panel.' },
  { date: '2026-09-27', kind: 'fix', text: 'Debt Blep is a Virus card, as its printed card shows, so it can now be played as a virus.' },
  { date: '2026-09-27', kind: 'fix', text: 'On a zoomed card with a Virus, Battle or Haste symbol by its name, the live power and defense now sit over the printed numbers instead of covering the symbol.' },
  { date: '2026-09-26', kind: 'change', text: 'The regions board is now the default for everyone. Prefer the original layout? The ▦ board button in the side panel switches back to classic, and remembers your choice.' },
  { date: '2026-09-26', kind: 'fix', text: 'A unit whose only ability is Unaware now shows a one-line reminder instead of a whole paragraph. The full explanation is in the rules reference.' },
  { date: '2026-09-26', kind: 'change', text: 'On the new board layout, the bar with your prompt and buttons is only as tall as it needs to be, so a battle gets its room back.' },
  { date: '2026-09-26', kind: 'change', text: 'On the new board layout, the glowing border takes you into your opponent\'s region only once you attack, not while you are still choosing attackers. When you commit, it grows to take you in.' },
  { date: '2026-09-26', kind: 'change', text: 'On the new board layout, names and life totals stay put in their corners. Resources have clear edges and counts, hovering them shows your mana at a glance, and dormant ones spread out when you can activate them.' },
  { date: '2026-09-26', kind: 'fix', text: 'A mod tucked under a card now shows the right slice on cards with a light text box, like Murkstalker, Proph and Flzzz. Some showed a line that does not transfer, or missed the symbol entirely.' },
  { date: '2026-09-26', kind: 'change', text: 'On the new board layout, a zoomed card now shows its mods underneath, its counters as dice, and its live power/defense where the card prints it. It keeps its highlight, and stays put while its menu is open.' },
  { date: '2026-09-25', kind: 'fix', text: 'A mod tucked under a unit now shows exactly the part it gives. Cards that give their attributes from the type line, like Resonant Form, used to have that line cut off.' },
  { date: '2026-09-25', kind: 'fix', text: 'Gublin, Its Dark Bubb and Just a Unit now give their attribute when you augment with them, as printed. They gave nothing before.' },
  { date: '2026-09-25', kind: 'fix', text: 'Hooba-Nan now also makes a 1/1 in the empty column past each end of your line. On the edge it makes two, and on its own it makes three.' },
  { date: '2026-09-25', kind: 'change', text: 'While you set up an attack or block, you can put a unit in a back slot before the front one is filled. If the front is still empty when you confirm, it moves up.' },
  { date: '2026-09-24', kind: 'new', text: 'This list. Every update to the site adds a line here, and the lines added since your last visit are marked.' },
  { date: '2026-09-23', kind: 'new', text: 'Watch a finished game back, one action at a time. Press ▶ on any game in your match history or on a deck’s games.' },
  { date: '2026-09-23', kind: 'new', text: 'Try the new regions board: ▦ in the side rail switches layouts. Each player’s region gets its own colour. The classic board is still the default.' },
  { date: '2026-09-23', kind: 'change', text: '“Local hotseat” is gone from the home screen. It was a test rig, not a way to play.' },
  { date: '2026-09-21', kind: 'fix', text: 'Caught up with Caleb’s errata to ten Light & Dark cards, including Deathcoil Construct, Blob of the Dark Order, Greed Angel and Tithe Enforcer.' },
  { date: '2026-09-20', kind: 'change', text: 'Life totals are bigger and flash red or green, with the amount, every time they change.' },
  { date: '2026-09-20', kind: 'fix', text: 'An expired glimpse is gone for good: a cached card can no longer be grafted or augmented after its window closes.' },
  { date: '2026-09-20', kind: 'fix', text: 'Eleven Light & Dark cards had lost affinity pips from their alternative costs, and two had lost the cost altogether. Fixed from the card scans.' },
  { date: '2026-09-20', kind: 'fix', text: 'Bin and cache abilities no longer fire while the card is on the battlefield. Cinder Scuttler can’t return itself from a fight it died in.' },
  { date: '2026-09-20', kind: 'change', text: 'Card panels show one short sentence per keyword. The full rule is in the Rules reference.' },
  { date: '2026-09-20', kind: 'new', text: 'New decks are shared by default. The Metagame list shows legal decks that people have actually played, and a deck exports as a full file with its description and cover.' },
  { date: '2026-09-20', kind: 'change', text: 'Deck builder tidy-up: Play and settings buttons at the side, fewer banners, and pressing ? while writing a description no longer erases it.' },
  { date: '2026-09-19', kind: 'new', text: 'You can recycle for a Prismite and choose its element later. Recycling for a Shard is at the bottom of “more…”.' },
  { date: '2026-09-18', kind: 'new', text: 'Single Card Duel: each player blind-picks one card and plays thirty copies of it. Find it under Constructed, and see which cards win on the Metagame page’s card ladder.' },
  { date: '2026-09-18', kind: 'new', text: 'Learn to Play: a guided game against a tutorial bot, with a short lesson each time something new comes up. Under “On your own” on the home page.' },
  { date: '2026-09-17', kind: 'fix', text: 'Light and Dark Resource cards show their official art and turn up in card search.' },
  { date: '2026-09-16', kind: 'change', text: 'Recycled cards now go past a mark at the bottom of your deck and are shuffled back in when the deck runs out. The deck counter shows how many.' },
  { date: '2026-09-16', kind: 'fix', text: 'Three bugs you reported: Sluggish now holds its triggers between split damage steps, units in a column share its attributes for effect damage, and Formless strips the whole column.' },
  { date: '2026-09-15', kind: 'new', text: 'How to play and the full Rulebook open from the home page, and the footer links the Algomancy Discord. A background tab’s title flashes when a match is found or it’s your move.' },
  { date: '2026-09-14', kind: 'new', text: 'Custom rules for live drafts: pack size, number of elements, Simple cards only, bans, starting life, hand size and draws. Custom games are kept out of your stats.' },
  { date: '2026-09-14', kind: 'change', text: 'The site moved to algomancy.online. Old links, room links included, redirect here.' },
  { date: '2026-09-05', kind: 'change', text: 'Better on an iPad: no hover popup after a tap, card menus in the side rail, and Pass and Confirm at the bottom of the screen for everyone.' },
  { date: '2026-09-05', kind: 'new', text: 'Choose your favourite element on your stats tab. It shows as its icon on your profile and friends list.' },
  { date: '2026-09-05', kind: 'change', text: 'A turn-1 concede no longer counts as a game, and a concede by turn 2 moves ratings by half.' },
  { date: '2026-09-05', kind: 'change', text: 'The opponent’s turn summary reads like a sentence: “played Flesh Tithe (X = 11), lost 11 life”, not a log.' },
  { date: '2026-09-05', kind: 'new', text: 'The Rules reference reads like the printed rules: the help cards, the manual and the card reminders, with a search box.' },
  { date: '2026-09-05', kind: 'new', text: 'The Report button is on every page. Pick bug, UX issue or feature request, say how bad it is, and add a note.' },
  { date: '2026-09-05', kind: 'new', text: 'Algomancy Online opens to players: live drafts, constructed games, accounts and stats.' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "23 Sep" */
export function updateDay(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

/*
 * NEW SINCE YOU LAST LOOKED. The browser keeps how many entries it had shown
 * (`SEEN_KEY`); the ones above that count are new. A COUNT, not a date: two
 * pushes on one day are two lines, and a date would call the second one seen.
 * The list only ever grows at the top, so the count is exact.
 *
 * Since 2026-11-03 (docs/24) the list is behind a button, so "seen" means the
 * list was OPENED (`markUpdatesSeen`), not that the home page loaded — until
 * then the first home paint of each page load advanced it. A first visit
 * (nothing stored) badges nothing, since everything is new to them, and
 * records today's count, so the NEXT entry is the first one badged.
 *
 * The open list marks the rows that were new when it was first opened in
 * this page load (`markedFrom`), so opening it does not wipe the marks off
 * the very list being read; the badge, read from storage, clears at once.
 */
const SEEN_KEY = 'algoUpdatesSeen';

/** the count stored, or null on a first visit (or with storage blocked) */
function storedSeen(): number | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  } catch { return null; }
}
function storeSeen(n: number): void {
  try { localStorage.setItem(SEEN_KEY, String(n)); } catch { /* storage blocked, or no DOM: nothing remembered */ }
}

/** what the stored count was when the list was first opened this page load; undefined = not opened yet */
let markedFrom: number | null | undefined;

/** How many entries are newer than the last time the list was opened: the
 * Updates button's badge. 0 on a first visit, which records the count. */
export function updatesUnseen(list: readonly Update[] = UPDATES): number {
  const seen = storedSeen();
  if (seen === null) { storeSeen(list.length); return 0; }
  return Math.max(0, list.length - seen);
}

/** The list was opened: everything in it is seen now. */
export function markUpdatesSeen(list: readonly Update[] = UPDATES): void {
  if (markedFrom === undefined) markedFrom = storedSeen();
  storeSeen(list.length);
}

/** the count the drawn list marks rows from (null: mark nothing) */
const seenForList = (): number | null => (markedFrom !== undefined ? markedFrom : storedSeen());

/** one row; `showDate` is false for a second entry on the same day */
function rowHtml(u: Update, showDate: boolean, unseen: boolean): string {
  return `<li class="upd ${u.kind}${unseen ? ' unseen' : ''}">
      <time datetime="${u.date}">${showDate ? updateDay(u.date) : ''}</time>
      <span class="updkind">${KIND_LABEL[u.kind]}</span>
      <p>${esc(u.text)}</p>
    </li>`;
}

/** `unseen` rows are marked; `from` is the first row's index in the whole list */
function listHtml(list: readonly Update[], prevDate: string | null, unseen: number, from = 0): string {
  return list.map((u, i) => rowHtml(u, u.date !== (i ? list[i - 1]!.date : prevDate), from + i < unseen)).join('');
}

/** whether "Older updates" is open — kept across home repaints, which rebuild it */
let olderOpen = false;

const unseenOf = (list: readonly Update[], seen: number | null): number =>
  (seen === null ? 0 : Math.max(0, list.length - seen));

/**
 * The list alone — the newest SHOWN_UPDATES open, the rest under "Older
 * updates (n)" — for a sheet with its own heading. Empty when there is
 * nothing to say. `seen` as for updatesHtml.
 */
export function updatesListHtml(list: readonly Update[] = UPDATES, seen: number | null = seenForList()): string {
  if (!list.length) return '';
  const unseen = unseenOf(list, seen);
  const shown = list.slice(0, SHOWN_UPDATES);
  const older = list.slice(SHOWN_UPDATES);
  return `<ol class="updlist">${listHtml(shown, null, unseen)}</ol>
    ${older.length ? `<details class="updolder"${olderOpen ? ' open' : ''}>
      <summary>Older updates (${older.length})</summary>
      <ol class="updlist">${listHtml(older, shown[shown.length - 1]!.date, unseen, SHOWN_UPDATES)}</ol>
    </details>` : ''}`;
}

/**
 * The band: the heading, its "N new" note and the list. Empty when there is
 * nothing to say. `seen` is how many entries this browser had already seen
 * (null: a first visit) — by default the count when the list was opened.
 */
export function updatesHtml(list: readonly Update[] = UPDATES, seen: number | null = seenForList()): string {
  if (!list.length) return '';
  const unseen = unseenOf(list, seen);
  return `<section class="updates" aria-labelledby="upd-h">
    <h2 id="upd-h">Recent updates${unseen ? `<span class="updnew">${unseen} new since your last visit</span>` : ''}</h2>
    ${updatesListHtml(list, seen)}
  </section>`;
}

/** after a paint that drew the list: remember the disclosure, since the next paint rebuilds it */
export function wireUpdates(): void {
  const d = document.querySelector?.('.updolder') as HTMLDetailsElement | null;
  d?.addEventListener?.('toggle', () => { olderOpen = d.open; });
}
