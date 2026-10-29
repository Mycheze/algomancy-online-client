/* “How to use the interface” — the second tab of the `? rules` overlay.
 *
 * A walk through every screen, action and setting a player may need, in the
 * order they meet them: getting into a game, reading the board, each phase,
 * the side-rail settings, the keyboard, the clock and connection, and the
 * result screen.
 *
 * ⚠ EVERY BUTTON NAMED HERE IS A REAL ONE. A step that talks about a button
 * lists it in `btns` by its `data-btn` name, and
 * `test/286-rules-reference.test.ts` checks each against the client’s own
 * source — so a button renamed or removed in ui/main.ts turns this guide red
 * rather than leaving it describing a control that is not there. Write the
 * step off the handler, never off memory.
 *
 * Player-facing copy: plain words, numbered where it is a sequence, and no
 * ruling numbers or history — the same rule as ui/rules.ts.
 */

import { iconizeText } from './cardtext.ts';
import { esc } from './util.ts';

export interface TutorialStep {
  /** a short bold lead, when the step is about one control or idea */
  label?: string;
  text: string;
  /** the `data-btn` names of the controls this step describes */
  btns?: readonly string[];
}

export interface TutorialSection {
  id: string;
  title: string;
  blurb?: string;
  /** numbered when the section is a sequence, bulleted when it is a list */
  numbered?: boolean;
  steps: readonly TutorialStep[];
}

export const TUTORIAL: readonly TutorialSection[] = [
  {
    id: 'home',
    title: 'Getting into a game',
    blurb: 'Everything starts on the home screen.',
    steps: [
      {
        label: 'Find a game',
        text: 'The strip at the top of the home screen is matchmaking. Open it, choose live draft or constructed and ranked or casual, and '
          + 'search. When a match is found both players have a short countdown to Accept; Stop searching at any time.',
        btns: ['queue-open', 'queue-mode', 'queue-ranked', 'queue-go', 'queue-accept', 'queue-decline', 'queue-cancel'],
      },
      {
        label: 'New live draft',
        text: 'Makes a room and takes you to its lobby, which shows the room code and a link to send. The three elements are chosen there, '
          + 'together: pick a method, make your pick, Lock in — Change my mind unlocks — and Draft! once both of you are locked. '
          + 'To skip the lobby, open “…or fix the trio now” on the home screen, pick three elements (or roll the dice), and start straight away.',
        btns: ['newgame', 'lobby-method', 'lobby-pick', 'lobby-lock', 'lobby-unlock', 'trio-ok', 'eltoggle', 'elrandom'],
      },
      {
        label: 'New constructed game',
        text: 'Pick one of your decks first — the button is disabled until you have. Signed in, the picker lists your saved decks; the '
          + 'My decks page is where you build, import and export them. The room waits until both players have brought a deck.',
        btns: ['newgame', 'deck-openpage', 'deck-new', 'deck-import-open', 'deck-export'],
      },
      {
        label: 'Join a game',
        text: 'Type the four-letter room code your opponent sent and press Join (or Enter). A link they sent opens the room directly.',
        btns: ['joincode'],
      },
      {
        label: 'Clock',
        text: 'The chess clock for a game you start is under Custom rules on the Live draft card, or Options on the Constructed card; '
          + 'whoever joins your room plays the clock you chose. Changing it does not make the game custom. '
          + '“Off” means nobody can lose on time.',
        btns: ['clockpick'],
      },
      {
        label: 'Cards, decks and the metagame',
        text: 'Cards opens the card browser — every card in the box, with a search that understands filters such as “el:wood kind:unit mana:2 '
          + '-kw:virus” (the ? beside the box lists them). My decks is your collection. Metagame lists the decks people have published and '
          + 'how they are doing.',
        btns: ['cards-openpage', 'cards-help', 'deck-openpage', 'meta-openpage'],
      },
      {
        label: 'Your account',
        text: 'Sign in or register from the home screen. Your name opens the account page: results and rating, the ladder, friends, linking '
          + 'Discord, and signing out. Playing signed out works too — start a room and send the code — it just does not count for anything.',
        btns: ['acct-open-auth', 'acct-open-profile', 'acct-logout', 'acct-friend-add', 'acct-discord-link'],
      },
    ],
  },
  {
    id: 'board',
    title: 'Reading the board',
    steps: [
      {
        label: 'The info lines',
        text: 'Your line runs along the bottom, above the prompt bar: your resources, the phase icons with the current one lit (hover or tap them '
          + 'for the phase, step and turn), your bin and cache, then your name and life — ⭐ marks who holds the initiative. Your opponent’s line '
          + 'runs along the top. Hover or tap a name for hand, deck, recycle pile, bin and cache as numbers. When the client is passing for you, '
          + 'a ⏩ stop button appears on the toolbar.',
        btns: ['passallstop'],
      },
      {
        label: 'The prompt bar',
        text: 'At the bottom of the table, just above your hand. It always says whose move it is and what you can do right now, and carries '
          + 'the buttons for this moment — the main one says what it does (To Blockers, End Battle, End Turn), plus every decision. Read it first — it is the one thing that never scrolls away.',
      },
      {
        label: 'Regions',
        text: 'Each player’s region has its own colour: their units in play along the band nearest them and, in a battle, the fight. Units '
          + 'standing in the other player’s region are invaders, drawn as a small pile: hover it, or tap its count, to spread it out. Spell tokens '
          + 'stand at the outer end of their In Play, alike ones stacked under a count; hover the corner for how many of each size. Click a bin on '
          + 'an info line to open it; a card there that glows can be played or applied from the bin right now. A cache, when a player has one, '
          + 'sits beside it — it is public, so either player’s can be opened.',
        btns: ['binopen', 'cacheopen', 'binclose', 'cacheclose'],
      },
      {
        label: 'Your hand',
        text: 'Docked along the bottom with its count. Cards you can act with glow. During the draft and draw steps the dock tucks away so the '
          + 'panel has room; hover it to look.',
      },
      {
        label: 'The toolbar and reading a card',
        text: 'The narrow strip on the right: ☰ table, ↶ undo, ⚖ judge, ? rules, 📝 report and ⋯ settings, with the room and both clocks; hover '
          + 'an icon for its name. To read a card, hover it: it grows where it is, with its current text beside it — what it says now, its '
          + 'attributes, its mods and where its power and defense come from. On a touch screen, press and hold a card, or tap one.',
      },
      {
        label: 'The stack',
        text: 'While effects are waiting to resolve a strip shows them, the one that resolves next on top. Right-click a trigger on it (or tap it and use the buttons '
          + 'that appear under it) to auto-yield to that unit’s triggers.',
      },
      {
        label: 'Card details',
        text: 'Right-click any card you can read for its details page: the text as the game sees it, every attribute with its reminder, the '
          + 'tokens it creates, the rules it refers to, and the recorded rulings — with a button to ask the judge about that card. On a touch '
          + 'screen there is no right-click: tap the card and the same entries are buttons under it.',
        btns: ['inspectclose', 'inspectjudge'],
      },
      {
        label: 'The game log, erased cards, conceding',
        text: 'Right-click bare table, or press ☰ on the toolbar. View game log opens the log; its toggle switches '
          + 'between the story and every bookkeeping line. The same menu shows each player’s erased cards and — with a confirmation — Concede the match.',
        btns: ['logmode', 'logclose', 'erasedclose', 'concedeyes', 'concedeno'],
      },
    ],
  },
  {
    id: 'planning',
    title: 'Planning',
    numbered: true,
    steps: [
      { text: 'Refreshing your resources and drawing happen by themselves.' },
      {
        text: 'Live draft: the draft panel shows your hand and pack as one pile. Click cards to move them between “your hand after drafting” '
          + 'and “left in the pack”. When the pack holds exactly the number it must, press Keep (Enter) to pass it — on the last look at a '
          + 'pack the cards left go to the bottom of the deck instead, and the label says so.',
        btns: ['draftcommit'],
      },
      {
        text: 'Constructed: you drew 4. Click the two cards to put on the bottom of your deck, in that order, then confirm (Enter).',
        btns: ['bottomcommit'],
      },
      {
        text: 'Resources: click a card in your hand and choose Recycle → the element you want (this game’s elements are listed first; '
          + '“more elements…” shows the rest), or Recycle → Prismite to choose later. Click a dormant resource to activate it — two per turn. Click an active Prismite to exchange it '
          + 'for a resource of another element.',
      },
      {
        text: 'Press Done Planning (Enter). If you still have dormant resources and activations left, it asks “Really done” — Go back (Esc) '
          + 'returns you to the step.',
        btns: ['doneplan', 'doneplanconfirm', 'doneplancancel'],
      },
      {
        text: 'The haste step: play any haste cards, then done. Done with a haste play still unmade asks “Done anyway”. '
          + 'If you have nothing playable the client readies you through the step by itself — unless bluff haste is on (see Settings).',
        btns: ['donehaste', 'hasteconfirm', 'hastecancel'],
      },
    ],
  },
  {
    id: 'cards',
    title: 'Playing cards, choosing targets, using abilities',
    numbered: true,
    steps: [
      {
        text: 'Click a glowing card in your hand. If only one thing is possible it happens; if several are — play it, ambush with it, prophecy it, '
          + 'augment or graft it — a menu asks which. On a touch screen a tap only shows the card: drag it onto the table to play or recycle '
          + 'it, or onto a glowing unit to mod it.',
      },
      {
        text: 'A cost with an X offers quick amounts, or type a number and press Enter. A card with modes asks for the mode from a menu.',
        btns: ['numquick', 'numtake'],
      },
      {
        text: 'Targets: the prompt bar names what to pick and the legal targets glow on the board — click one (a unit, a player, a card in a bin or '
          + 'a cache), or click its picture in the bar. Aiming something harmful at your own unit asks “Yes, target my own” first.',
        btns: ['allyconfirm', 'allycancel'],
      },
      {
        text: '✕ Cancel (Esc) takes the whole play back for as long as nothing has resolved. Casting a group of spell tokens, you pick '
          + 'which resolves first, then next: Undo last pick steps back one, Start over (Esc) takes the whole group back.',
        btns: ['castcancel', 'burstundo'],
      },
      {
        text: 'Abilities: click a unit with an activated ability. One ability fires at once; several open a menu. Anything that spends what you '
          + 'cannot get back — sacrificing the unit, erasing a card — asks “Yes, activate” first, except while you can still undo it '
          + '(planning, haste and deployment).',
        btns: ['actconfirm', 'actcancel'],
      },
      {
        text: 'Mods: click the augment or graft card (in hand, bin or cache), choose Augment or Graft, then click the unit to put it under. '
          + '✕ cancel (Esc) drops it.',
        btns: ['modcancel'],
      },
      {
        text: 'From the bin or the cache: open the zone; the cards that glow can be played or applied from there right now, and clicking one '
          + 'does exactly what clicking it in hand would.',
        btns: ['binplay', 'cacheplay'],
      },
      {
        text: 'When several abilities trigger at once the bar asks for their order: click them in the order you want (each gets its number; '
          + 'click a numbered one to take it back), then Confirm order (Enter). Start over (Esc) clears them; auto-stack takes the order shown.',
        btns: ['orderpick', 'orderunpick', 'orderconfirm', 'orderreset', 'orderauto'],
      },
      {
        text: 'A choice too big for a bar — naming a card — gets a search box over what is on the board; “search all” widens it to every card.',
        btns: ['decsearchall'],
      },
    ],
  },
  {
    id: 'battle',
    title: 'Battle',
    numbered: true,
    steps: [
      {
        text: 'Attacking: click one of your units to pick it up, then click a slot in the formation — the front or back row of a column — to put it '
          + 'down. Click a placed unit to take it back out. “Attack with everything” fills one column per unit; then Attack! (Enter), or Don’t attack. '
          + '✕ Clear (Esc) empties the formation.',
        btns: ['attackall', 'confirmattack', 'skipattack', 'clearform'],
      },
      {
        text: 'If spell tokens could come along, the bar asks: click the tokens to bring, then Attack — n tokens riding, or Bring none.',
        btns: ['rideconfirm', 'ridenone', 'ridecancel'],
      },
      {
        text: 'Blocking: pick up a unit and drop it in the slot in front of the attacking column you want to block (front or back row). To send a '
          + 'unit to counterattack instead, drop it on “send”; “Counterattack with the rest” sends every unit left. Confirm (Enter) when the '
          + 'line is set; Reset blockers? or ✕ Clear (Esc) starts over. A block the rules require — an Alluring attacker’s — is named '
          + 'in the bar and must be assigned before you can confirm.',
        btns: ['confirmblocks', 'sendrest', 'resetblocks', 'clearform'],
      },
      {
        text: 'If you confirm with units left over and none sent, the bar asks: click the units to send (or All), then Counterattack, '
          + 'or No counterattack.',
        btns: ['countertoggle', 'counterall', 'counterconfirm', 'counternone', 'countercancel'],
      },
      {
        text: 'Priority windows: the bar says you have priority. Play a battle card, cast a spell token, augment a virus from hand, activate an '
          + 'ability — or pass (Space). The main button names where two passes lead: To Blockers, To Damage, End Battle, or Resolve and the '
          + 'card on top; while yours is the first pass it adds that your opponent can still reply. Pass through stack passes until '
          + 'everything now on the stack has resolved; Pass all gives priority up until the next phase. Either can be stopped with the ⏩ on the toolbar.',
        btns: ['pass', 'passstack', 'passall', 'passallstop', 'passconfirm', 'passcancel'],
      },
      {
        text: 'When both players pass, the top of the stack resolves — or, with nothing on it, the battle moves to its next step. The bar says which.',
      },
      {
        text: 'Combat damage, deaths and the counterattack’s move to the other region are automatic. The log has the arithmetic, column by column.',
      },
    ],
  },
  {
    id: 'deploy',
    title: 'Deployment',
    numbered: true,
    steps: [
      { text: 'Both players deploy at the same time and nothing is shown to the other until both are done. The bar says “Waiting” while your opponent finishes.' },
      { text: 'Play cards, apply mods from hand or bin, activate abilities, and prophecy cards into your cache — all as in the section above.' },
      {
        text: 'Press Done Deploying (Enter) — it reads End Turn when your opponent has already finished. If you have played nothing yet and still could, or cards in your cache could still be played, '
          + 'it asks “End deployment anyway”.',
        btns: ['donedeploy', 'deployconfirm', 'deploycancel'],
      },
      {
        text: 'The reveal: once both are done, what your opponent did is shown card by card. Continue (Enter) dismisses it.',
        btns: ['revealdone'],
      },
      {
        text: 'Undo: ↶ on the toolbar, or Ctrl+Z, takes back your own last action — in planning and deployment only, where the '
          + 'opponent cannot have seen it.',
        btns: ['undo'],
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings behind ⋯',
    steps: [
      {
        label: 'Full control',
        text: 'While it is on nothing acts for you: no auto-pass, no standing Pass all, no auto-yield, and no automatic haste-step ready. You get '
          + 'a window at every point you could legally act, even a trivial one. It overrides the toggles beside it.',
      },
      {
        label: 'auto-pass',
        text: 'When on, the client passes for you whenever passing is your only legal action. The bar still shows what was passed.',
        btns: ['autopasstoggle'],
      },
      {
        label: 'bluff haste',
        text: 'The haste step opens every turn for both players. Off: if you have nothing playable in it you are readied through at once. On: you '
          + 'always sit in the step, so an opponent cannot read anything from how long you take. They are never shown whether you are ready.',
        btns: ['bluffhastetoggle'],
      },
      {
        label: 'motion',
        text: 'Card-movement animations and targeting arrows.',
        btns: ['motiontoggle'],
      },
      {
        label: 'sound',
        text: 'Notification sounds for phase and step changes, priority, decisions — and a nudge if you have not reacted in fifteen seconds.',
        btns: ['soundtoggle'],
      },
      {
        label: 'Auto-yield',
        text: 'Right-click one of your units (or its trigger on the stack) — or tap it and use the buttons under it — and choose Auto-yield to its triggers: windows that open only because '
          + 'of that unit’s triggers are passed for you, and the unit wears a ⏩ badge. The same menu stops it. Not offered under full control.',
      },
      {
        label: '? rules and ⚖ judge',
        text: 'This panel, and the judge: type a rules question in plain words and it is answered from the rulebook and the card rulings, '
          + 'with the cards it cites. Right-clicking a card (or tapping it, on a touch screen) offers to ask about that card.',
        btns: ['helpopen', 'helpclose', 'judgeopen', 'judgeask', 'judgeclose'],
      },
      {
        label: 'Report',
        text: 'Something wrong, confusing or missing? Report it with 📝 on the toolbar. The server keeps this exact game moment with your note, so '
          + 'describe what you expected and what happened.',
        btns: ['reportopen', 'reportsend', 'reportclose'],
      },
    ],
  },
  {
    id: 'keys',
    title: 'Keyboard',
    steps: [
      { label: 'Space', text: 'Pass — the main button of a battle window, named for where it goes.' },
      { label: 'Enter', text: 'The primary confirm of the moment: Done Planning, To Battle, Done Deploying, Attack!, Confirm Blocks, Keep, Continue.' },
      { label: 'Esc', text: 'Close whatever is on top — a menu, a dialog, this panel — and, with nothing open, cancel or go back.' },
      { label: '1–9', text: 'With a unit picked up for an attack or a block, put it in that column: the front if it is free, else the back.' },
      { label: 'S', text: 'Skip ahead when the table is being shown to you a step at a time: it only moves the screen forward, never the game.' },
      { label: 'Ctrl+Z', text: 'Undo your own last action, in planning and deployment.' },
      { text: 'No hotkey fires while you are typing in a box.' },
    ],
  },
  {
    id: 'clock',
    title: 'The clock, the connection, spectators',
    steps: [
      {
        label: 'Clocks',
        text: 'Yours and your opponent’s, at the bottom of the toolbar. A clock runs while it is that player’s move, turns to a warning colour when it is low, '
          + 'and a player whose clock reaches zero loses on time.',
      },
      {
        label: 'Waiting for an opponent',
        text: 'Until they arrive, a bar at the top shows the room code and the link to send.',
        btns: ['copylink'],
      },
      {
        label: 'Disconnected',
        text: 'The page reconnects by itself and says how long until the next try; you come back into your own seat. Reloading the page does '
          + 'the same, and the page reloads itself when the server has restarted.',
      },
      {
        label: 'Spectating',
        text: 'A room link with “&watch=1” on the end opens the game as a spectator: you see both hands and nothing is clickable. The players '
          + 'see how many people are watching.',
      },
    ],
  },
  {
    id: 'end',
    title: 'When the game ends',
    steps: [
      {
        label: 'The result screen',
        text: 'Who won, in how many turns and how long, a table of the game’s numbers for both players, and anything you unlocked. Signed in, '
          + 'it is recorded to your profile; a guest can Keep it by choosing a name and password.',
        btns: ['pg-claim'],
      },
      {
        label: 'Afterwards',
        text: 'Request rematch — it starts when both of you have asked. Return to home, or join the matchmaking queue for another game. '
          + '“view the final board” (or Esc) puts the board back to look at.',
        btns: ['pg-rematch', 'pg-rematch-cancel', 'pg-goto-rematch', 'pg-home', 'pg-queue', 'pg-close'],
      },
      {
        label: 'Leaving early',
        text: 'Right-click bare table, or press ☰ on the toolbar, and choose Concede the match; it asks once before it counts.',
        btns: ['concedeyes', 'concedeno'],
      },
      {
        label: 'Watching a game back',
        text: 'Every finished game in your history has a ▶. It opens a replay of the game as you played it — step an action at '
          + 'a time, scrub, or let it run at up to ten actions a second. 👁 shows both hands. If the rules have changed since '
          + 'you played, the bar says from which action what you are watching stops being the game that happened.',
      },
    ],
  },
];

/* ── search and rendering ────────────────────────────────────────────── */

const words = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);

export function stepHaystack(s: TutorialStep): string {
  return [s.label ?? '', s.text].join(' ').toLowerCase();
}

/** the sections with only the steps matching every word of `q`; empty query = everything */
export function tutorialSearch(q: string, sections: readonly TutorialSection[] = TUTORIAL): TutorialSection[] {
  const ws = words(q);
  if (!ws.length) return [...sections];
  return sections
    .map(s => ({
      ...s,
      steps: s.steps.filter(st => {
        const h = `${s.title} ${stepHaystack(st)}`.toLowerCase();
        return ws.every(w => h.includes(w));
      }),
    }))
    .filter(s => s.steps.length > 0);
}

export function stepHtml(s: TutorialStep): string {
  return `<li>${s.label ? `<b>${esc(s.label)}</b> ` : ''}${iconizeText(s.text)}</li>`;
}

export function tutorialSectionHtml(s: TutorialSection): string {
  const tag = s.numbered ? 'ol' : 'ul';
  return `<section class="rulesec" id="tt-${esc(s.id)}"><h4>${esc(s.title)}</h4>
    ${s.blurb ? `<p class="rulesblurb">${esc(s.blurb)}</p>` : ''}
    <${tag} class="ttsteps">${s.steps.map(stepHtml).join('')}</${tag}></section>`;
}

/** the scrolling body of the guide tab for a query */
export function tutorialListHtml(q: string): string {
  const hits = tutorialSearch(q);
  if (!hits.length) return `<div class="helpempty">Nothing in the guide matches “${esc(q)}”.</div>`;
  return hits.map(tutorialSectionHtml).join('');
}
