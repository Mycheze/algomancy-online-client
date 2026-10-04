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
 * Painted by `renderHome()` as a SIBLING after `.homepage`, inside `#app`:
 * the home menu keeps its one-screenful floor (legal.ts's `100dvh - 128px`
 * applies to `#app`'s first child) and this band sits between it and the
 * footer. It exists on the home screen only.
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
 * NEW SINCE YOUR LAST VISIT. The browser keeps how many entries it had shown
 * (`SEEN_KEY`); the ones above that count are marked. A COUNT, not a date:
 * two pushes on one day are two lines, and a date would call the second one
 * seen. The list only ever grows at the top, so the count is exact. Read and
 * advanced once per page load, at the first home paint — the home repaints
 * often, and advancing on every paint would clear the mark as it appeared. A
 * first visit (nothing stored) marks nothing: everything is new to them.
 */
const SEEN_KEY = 'algoUpdatesSeen';
let seenCount: number | null | undefined;

/** how many of `list` this browser had seen before this page load; null on a first visit */
function seenBefore(list: readonly Update[]): number | null {
  if (seenCount !== undefined) return seenCount;
  seenCount = null;
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw !== null && /^\d+$/.test(raw)) seenCount = Number(raw);
    localStorage.setItem(SEEN_KEY, String(list.length));
  } catch { /* storage blocked, or no DOM: mark nothing */ }
  return seenCount;
}

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

/**
 * The band under the home menu. Empty when there is nothing to say. `seen` is
 * how many entries this browser had already shown (null: a first visit).
 */
export function updatesHtml(list: readonly Update[] = UPDATES, seen: number | null = seenBefore(list)): string {
  if (!list.length) return '';
  const unseen = seen === null ? 0 : Math.max(0, list.length - seen);
  const shown = list.slice(0, SHOWN_UPDATES);
  const older = list.slice(SHOWN_UPDATES);
  return `<section class="updates" aria-labelledby="upd-h">
    <h2 id="upd-h">Recent updates${unseen ? `<span class="updnew">${unseen} new since your last visit</span>` : ''}</h2>
    <ol class="updlist">${listHtml(shown, null, unseen)}</ol>
    ${older.length ? `<details class="updolder"${olderOpen ? ' open' : ''}>
      <summary>Older updates (${older.length})</summary>
      <ol class="updlist">${listHtml(older, shown[shown.length - 1]!.date, unseen, SHOWN_UPDATES)}</ol>
    </details>` : ''}
  </section>`;
}

/** after `renderHome()` paints: remember the disclosure, since the next paint rebuilds it */
export function wireUpdates(): void {
  const d = document.querySelector?.('.updates .updolder') as HTMLDetailsElement | null;
  d?.addEventListener?.('toggle', () => { olderOpen = d.open; });
}
