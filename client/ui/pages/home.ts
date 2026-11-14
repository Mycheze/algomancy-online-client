/* THE HOME SCREEN (client/docs/24-redesign/, the owner's sketch of 2026-11-03).
 *
 * One window, no page scroll: the app shell (components/app-shell.ts) holds a
 * toolbar along the top (Decks · Cards · Metagame | the account | Learn · Test
 * · Rules · Alerts · Report), the main area, and a bottom bar (the client's
 * info on the left, the update log on the right). The main area is two
 * columns: the PLAY card — Draft | Constructed, the room's settings as rows,
 * Join a room and Create room — and three lighter cards beside it, League,
 * Challenge and Matchmaking, each of which opens its page.
 *
 * The Draft tab (owner, 2026-11-14: "That should greatly simplify the Draft Play
 * area"): Rules, Clock, Elements, "Alternate modes" (Standard | Beginner |
 * Cube draft), and last "More settings" — a disclosure over the rarely used
 * Cards, Banned and Game values rows, which says how many of them are changed
 * while it is shut, so a custom game is never hidden. Beginner is the old Mode
 * row's Beginner; Cube draft greys every other row out (a disabled fieldset)
 * and turns Create room into "Host a Cube draft", which opens the cube page on
 * its New event form (docs/25 §10).
 *
 * Everything that used to be a fold or a band is a SHEET now (components/
 * sheet.ts): Join a room, the Game values (the custom rules' numbers), the deck
 * import, Single Card Duel, the client info and the update log. The rest of
 * the custom rules — Beginner, Simple cards only, the card filter, the bans —
 * are rows of the Draft tab itself (owner, 2026-11-03; the last three behind
 * More settings since 2026-11-14). Which sheet is open is this
 * module's state (`homeSheet`), so the home's frequent whole-page repaints
 * (the queue poll, a friend coming online) simply draw it open again.
 *
 * (There was a "Practice demo" button on the home screen until 2026-09-05; the
 * owner had it removed — "It sucks". The `?demo=1` route it opened is still
 * there for the tests and the screenshot rig; it is just not offered.)
 *
 * Split the way docs/23 § Target structure asks: homeView() gathers the state,
 * homeHtml(view) draws it and touches nothing else, paintHome() puts it on the
 * page and wires it. main.ts renderHome() is still the ROUTER — the chain of
 * "does another page own #app right now?" checks — and calls paintHome() when
 * none does.
 *
 * The home screen's buttons (handleHomeButton: eltoggle, elrandom, clockpick,
 * newgame, joincode, deckimport*, the cr- panel's, and the home-mode /
 * home-format / home-els / home-sheet / home-sheet-close / home-more /
 * home-cube / home-cube-host switches) are here
 * too, since BL-63 (2026-11-13), with the element pick they write; main.ts
 * lends them its `uiError` and its repaints (HomeButtonHost).
 *
 * The decisions behind the layout (what moved where, what was dropped) are in
 * var/records/ds-round-2026-11-03-home-decisions.md and the round's record
 * ds-round-2026-11-03-home-page.md; test 1010 pins the shell's no-scroll
 * contract.
 */
import { ALL_ELEMENTS } from '../../engine/src/apply.ts';
import * as acct from '../account.ts';
import * as chal from '../challenge.ts';
import * as crp from '../customrulespanel.ts';
import * as cube from '../cube.ts';
import * as dk from '../decks.ts';
import * as lg from '../league.ts';
import * as mt from '../match.ts';
import * as mm from '../queue.ts';
import * as sc from '../singlecard.ts';
import { footHtml } from '../legal.ts';
import * as inbox from '../inbox.ts';
import { markUpdatesSeen, updatesListHtml, updatesUnseen, wireUpdates } from '../updates.ts';
import { ICON_BASE } from '../assets.ts';
import { artPick, backdropCard, challengeArtCard, LEAGUE_ART, modeArt, QUEUE_ART, type ArtPick } from '../homeart.ts';
import {
  appShell, button, chip, icon, iconButton, iconButtonBadge, installSheetEsc, segmented, settingRow, sheet, shellBar, statusMessage,
} from '../components/index.ts';
import { chosenDeck, elIcon as elIconOf, esc } from '../util.ts';
import { caretIn, restoreCaret } from './caret.ts';
import { TOOL_NAMES, toolsHtml } from './frame.ts';
import {
  CLOCK_DEFAULT_MS, chosenClockMs, clockPickHtml, clockPickView, setMatchClockChoice, type ClockPickView,
} from './clockpick.ts';
import {
  BEGINNER_HINT, bansHtml, cardsHtml, customRulesView, gameValuesHtml, poolLineHtml, type CustomRulesView,
} from './customrules.ts';
import { deckImportHtml, deckPickerHtml, deckPickerView, importDeck, wireDeckPicker, type DeckPickerView } from './deckpicker.ts';
import { singleCardPickerHtml, singleCardPickerView } from './singlecard.ts';
import { ccDeckSelectHtml, competitiveCardView, yourMatchesHtml, yourMatchesView, type CompetitiveCardView } from './match.ts';
import { queueGlanceHtml, queueStripView } from './queue.ts';
import { identityBarView, type IdentityBarView } from './signin.ts';

const elIcon = (name: string): string => elIconOf(name, name);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/* The home screen's typing boxes that no state remembers. The home screen is
 * repainted whole by things the player did not do — the matchmaking count
 * changing (queue.ts's 5s poll), a friend coming online, the profile landing —
 * and each repaint used to rebuild these four empty, mid-word, and drop the
 * focus (found 2026-11-02: all four wiped by one queue poll). Their text is
 * carried across the repaint and the caret put back (caretIn/restoreCaret).
 * Since the redesign (2026-11-03) the room code and the deck import live in
 * sheets; a sheet drawn open again by a repaint gets them back the same way.
 * The other boxes on the page keep their own drafts in state (the Custom rules
 * ban and filter boxes, the single-card search), so only their caret is
 * carried. test/904-home-identity-and-typing.test.ts. */
const HOME_TYPED = ['h-name', 'h-code', 'h-deckurl', 'h-decktext'] as const;
const HOME_CARET: readonly string[] = [...HOME_TYPED, 'cr-ban', 'cr-query', 'sc-q'];

/** the "Your name" box → localStorage, before a game is made or joined */
export const saveHomeName = (): void => {
  // logged in, the name box is not rendered at all — the account name is the
  // one the server files stats under and must not be overwritten by a stale
  // input value
  const inp = document.getElementById('h-name') as HTMLInputElement | null;
  if (inp) localStorage.setItem('algoName', inp.value.trim());
};

/* ── the home's own state: which Play tab, which format, which sheet ───── */

export const HOME_MODES = ['draft', 'constructed'] as const;
export type HomeMode = typeof HOME_MODES[number];
export const HOME_FORMATS = ['casual', 'competitive'] as const;
export type HomeFormat = typeof HOME_FORMATS[number];
export const HOME_SHEETS = ['join', 'info', 'updates', 'rules', 'import', 'single', 'alerts-signin'] as const;
export type HomeSheet = typeof HOME_SHEETS[number];

/** the Play card's tab and Constructed's format are REMEMBERED (legal.ts
 * BROWSER_KEYS lists both): a constructed player should not have to switch
 * tabs every visit. First visit: Draft, Casual. */
const MODE_KEY = 'algoHomeMode';
const FORMAT_KEY = 'algoHomeFormat';

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v !== null && (allowed as readonly string[]).includes(v) ? v as T : fallback;
  } catch { return fallback; }
}
function store(key: string, v: string): void {
  try { localStorage.setItem(key, v); } catch { /* storage blocked: remembered for nothing */ }
}

export const homeMode = (): HomeMode => stored(MODE_KEY, HOME_MODES, 'draft');
export const homeFormat = (): HomeFormat => stored(FORMAT_KEY, HOME_FORMATS, 'casual');
/** home-mode: Draft | Constructed (an unknown value changes nothing) */
export function setHomeMode(m: string | undefined): void {
  if ((HOME_MODES as readonly string[]).includes(m ?? '')) store(MODE_KEY, m!);
}
/** home-format: Casual | Competitive */
export function setHomeFormat(f: string | undefined): void {
  if ((HOME_FORMATS as readonly string[]).includes(f ?? '')) store(FORMAT_KEY, f!);
}

/** the sheet drawn open, or null. Module state, so a repaint draws it again. */
let homeSheet: HomeSheet | null = null;
/** the info sheet was opened by a mouse hovering its button: it closes again
 * when the mouse moves off it (a click or tap open stays until dismissed) */
let sheetByHover = false;
/** the sheet the last paint drew — to tell "just opened" from "drawn again" */
let paintedSheet: HomeSheet | null = null;

export const openSheet = (): HomeSheet | null => homeSheet;

/** The Join sheet's line when Join was pressed with the box empty, or ''.
 * BL-10, docs/23-ui-inventory/01 §4 S16: "An empty room code is ignored with
 * no message" — the press did nothing at all. Cleared when a sheet opens. */
let joinMsg = '';
export const EMPTY_CODE_LINE = 'Type the room code first.';
/** joincode: the search string that opens the typed room, or null when the box
 * is empty — and then the Join sheet says so (EMPTY_CODE_LINE) */
export function joinCodeTarget(typed: string): string | null {
  const code = typed.trim().toUpperCase();
  joinMsg = code ? '' : EMPTY_CODE_LINE;
  return code ? `?ws=1&room=${encodeURIComponent(code)}` : null;
}
/** home-sheet data-sheet=<name>. Opening the update log marks it seen. */
export function openHomeSheet(name: string | undefined, how: 'click' | 'hover' = 'click'): boolean {
  if (!(HOME_SHEETS as readonly string[]).includes(name ?? '')) return false;
  homeSheet = name as HomeSheet;
  sheetByHover = how === 'hover';
  joinMsg = '';
  if (homeSheet === 'updates') markSeen();
  return true;
}
/** home-sheet-close, the scrim, the ✕, Esc. True when a sheet was open. */
export function closeHomeSheet(): boolean {
  const was = homeSheet !== null;
  homeSheet = null;
  sheetByHover = false;
  return was;
}

/** the update log's "seen" advances when its sheet OPENS (docs/24), not when the home loads */
function markSeen(): void { markUpdatesSeen(); }

/* ── the element pick for a fixed draft ─────────────────────────────────
 * Was main.ts `ui.homeEls` / `ui.homeFixedTrio` (UiState) until BL-63 moved the
 * home's buttons here, 2026-11-13. Nothing but the home read or wrote either.
 * One difference, unseen: main.ts resetUi() (a deal, a join) used to put both
 * back to their boot values; it cannot reach the home, which is only drawn
 * outside a room, and leaving a room reloads the page (goHome). */

const ELS_KEY = 'algoEls';
/** the persisted trio, filtered against the engine's element list so a stale
 * or hand-edited localStorage entry can never smuggle in a non-element */
const savedEls = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(ELS_KEY) ?? '') as string[];
    const clean = (Array.isArray(raw) ? raw : []).filter(el => (ALL_ELEMENTS as string[]).includes(el));
    // BL-43: kept whole — a custom draft may fix two elements, or five
    return clean.length ? [...new Set(clean)] : ['fire', 'water', 'earth'];
  } catch { return ['fire', 'water', 'earth']; }
};
/** the draft trio being picked (persisted per browser) */
let homeEls: string[] = savedEls();
/** Elements is on "Pick now". Held in state because touching a chip re-renders
 * the whole screen, which would otherwise snap the chips shut under the
 * finger that opened them. */
let homeFixedTrio = false;
const saveEls = (): void => localStorage.setItem(ELS_KEY, JSON.stringify(homeEls));

/** the Draft tab's More settings is open (Cards, Banned, Game values). Module
 * state, not remembered: every visit starts with it shut. */
let homeMore = false;
/** Alternate modes is on Cube draft: the other rows are greyed out and Create
 * room is "Host a Cube draft". Module state, not remembered — Standard and
 * Beginner are the custom rules' own (customrulespanel.ts keeps them). */
let homeCube = false;

/** what paintHome draws of the pick (HomeState's `els` and `fixedOpen`) */
export const homePick = (): { els: readonly string[]; fixedOpen: boolean } => ({ els: homeEls, fixedOpen: homeFixedTrio });

/* ── the view ─────────────────────────────────────────────────────────── */

/** what the view is handed: the element pick (homePick()) and main.ts's last error */
export interface HomeState {
  /** the elements picked for a fixed draft (`homeEls`) */
  els: readonly string[];
  /** Elements is on "Pick now" (`homeFixedTrio`) */
  fixedOpen: boolean;
  /** main.ts `uiError`: a refused New game, shown above the Play card's buttons */
  error: string;
}

/** The markup other modules draw into the page, already drawn. They read their
 * own module state (and some fetch while drawing), so they arrive as strings:
 * a story or a test passes '' or a stub. */
export interface HomeSlots {
  /** league.ts homeGlanceHtml — the League card's body ('' with no season); fetches while drawing */
  league: string;
  /** challenge.ts homeGlanceHtml — the Challenge card's body ('' with no week); fetches while drawing */
  challenge: string;
  /** pages/queue.ts queueGlanceHtml — the Matchmaking card's body, with the open games' Join buttons */
  queue: string;
  /** inbox.ts inviteRowsHtml — the Join sheet's pending friend invites ('' when none) */
  invites: string;
  /** pages/match.ts yourMatchesHtml — paused/running Competitive matches ('' when none) */
  yourMatches: string;
  /** league.ts joinRowsHtml — league matches to play now ('' when none) */
  leagueMatches: string;
  /** cube.ts joinRowsHtml — "Your cube events" in the Join sheet ('' when none) */
  cubeEvents?: string;
  /** pages/singlecard.ts singleCardPickerHtml — the Single Card Duel sheet's picker */
  scpicker: string;
  /** legal.ts footHtml — the client info sheet: buy links, the notice, credits, the legal pages */
  info: string;
  /** updates.ts — the update log's list */
  updates: string;
}

export interface HomeView {
  /** the toolbar's centre: who is signed in (pages/signin.ts identityBarView) */
  account: IdentityBarView;
  /** the "Your name" box's value, or null when it is not drawn — signed in, or
   * a stored token still resolving (it would flash "Playing signed out") */
  nameBox: string | null;
  signedIn: boolean;
  mode: HomeMode;
  format: HomeFormat;
  sheet: HomeSheet | null;
  draft: {
    /** how many elements a fixed pick wants (Custom rules may change it) */
    k: number;
    els: readonly string[];
    /** Elements: "Pick now" (true) or "Choose in the room" */
    fixedOpen: boolean;
    /** how many element sets the 🎲 picks among */
    setCount: number;
    /** the server's verdict on the rules for a FIXED pick, when one is refused */
    fixedError: string | undefined;
    /** …and for a room that chooses its elements in the lobby */
    customError: string | undefined;
    /** custom rules are set: "Create custom room" */
    custom: boolean;
    /** the custom rules as the Draft tab's rows and the Game values sheet draw
     * them (pages/customrules.ts customRulesView) */
    rules: CustomRulesView;
    /** More settings is open: Cards, Banned and Game values are drawn (absent: shut) */
    more?: boolean;
    /** Alternate modes is on Cube draft (absent: off) */
    cube?: boolean;
  };
  /** the clock picker for the tab that is showing — Competitive's is the
   * match clock (`mode: 'competitive'`, its own setting) */
  clock: ClockPickView;
  /** the last refusal (main.ts `uiError`), or '' */
  error: string;
  /** the Join sheet's "type a code" line (joinCodeTarget), or '' */
  joinError?: string;
  deckPicker: DeckPickerView;
  /** a deck is chosen: Create room is live on Casual */
  hasDeck: boolean;
  /** Competitive: Best of, the CC-legal decks, the pick (pages/match.ts) */
  competitive: CompetitiveCardView;
  /** Single Card Duel: the card picked so far (ui/singlecard.ts), or null */
  singleCard: string | null;
  /** the League / Challenge cards open their pages (a season or a week to show) */
  leagueLive: boolean;
  challengeLive: boolean;
  /** the League / Challenge card's data could not be fetched and none is held
   * (league.ts / challenge.ts hintUnreachable): the card says it could not load,
   * not that nothing is running — BL-10, docs/23-ui-inventory/01 §4 S16 */
  leagueMissed?: boolean;
  challengeMissed?: boolean;
  badges: {
    /** the bell's unread count (inbox.ts inboxUnread) — Alerts */
    alerts: number;
    /** the notifications list is open (inbox.ts inboxListOpen): Alerts is drawn pressed */
    alertsOpen?: boolean;
    /** invites + your matches + league matches to play — Join a room */
    join: number;
    /** update-log entries since it was last opened — Updates */
    updates: number;
    /** my cube events (docs/25 §10) — on Alternate modes' Cube draft; absent or 0: no count */
    cube?: number;
  };
  slots: HomeSlots;
  /** the pictures (ui/homeart.ts), as URLs: the page's backdrop, the Draft
   * and Constructed tiles, and the three cards beside Play */
  art: Record<'backdrop' | 'draft' | 'constructed' | 'league' | 'challenge' | 'queue', ArtPick>;
}

/** Gather everything the home screen shows. The slot calls run in the order
 * the page draws them (some of them fetch). */
export function homeView(st: HomeState): HomeView {
  const user = acct.currentUser();
  const name = user ? user.username : (localStorage.getItem('algoName') ?? '');
  const deck = chosenDeck();
  const mode = homeMode();
  // BL-43: the Custom rules panel decides how many elements a fixed pick wants,
  // and previews the server's verdict on the rules for both Create buttons
  const k = crp.elementCount();
  const fixedPick = st.fixedOpen && st.els.length === k ? st.els : null;
  const customVerdict = crp.verdict(null);
  const fixedVerdict = crp.verdict(st.els.length === k ? st.els : null);
  const rulesView = customRulesView(fixedPick);
  const signedIn = !!acct.token();
  // the cards beside Play, and what waits behind Join a room (the league and
  // challenge answers are asked for here, once per token, as the banner did)
  const leagueLive = lg.hasLeague();
  const league = lg.homeGlanceHtml();
  const challengeLive = chal.hasChallenge();
  const challenge = chal.homeGlanceHtml();
  const leagueMissed = lg.hintUnreachable();
  const challengeMissed = chal.hintUnreachable();
  const queue = queueGlanceHtml(queueStripView());
  const invites = inbox.inviteRowsHtml();
  const yourMatches = yourMatchesHtml(yourMatchesView());
  const leagueMatches = lg.joinRowsHtml();
  // docs/25 §10: "Your cube events" (my events, cube.ts askList) — one Open/Play per event,
  // so its buttons are the Draft tab's count
  const cubeEvents = cube.joinRowsHtml();
  const cubeCount = (cubeEvents.match(/data-btn="cube-open"/g) ?? []).length;
  const join = inbox.inviteCount() + mt.myMatchCount() + lg.joinCount() + cube.joinCount();
  // report #356: Best of's default follows the rules set until it is chosen
  // (Casual one game, Competitive three, docs/22 §6.1)
  const ccView = { ...competitiveCardView(signedIn, signedIn ? dk.competitiveDecks() : null), bestOf: mt.bestOfFor(homeFormat() === 'casual') };
  return {
    account: identityBarView(user, acct.resolvingUser()),
    nameBox: user || acct.resolvingUser() ? null : name,
    signedIn: !!user,
    mode,
    format: homeFormat(),
    sheet: homeSheet,
    draft: {
      k, els: st.els, fixedOpen: st.fixedOpen, setCount: crp.setCount(),
      fixedError: fixedVerdict.error, customError: customVerdict.error, custom: !!customVerdict.rules,
      rules: rulesView, more: homeMore, cube: homeCube,
    },
    clock: clockPickView(mode === 'constructed' && homeIsMatch({ format: homeFormat(), competitive: ccView }) ? 'competitive' : mode),
    error: st.error,
    joinError: joinMsg,
    deckPicker: deckPickerView(),
    hasDeck: !!deck,
    competitive: ccView,
    singleCard: sc.chosen(),
    leagueLive, challengeLive, leagueMissed, challengeMissed,
    badges: { alerts: inbox.inboxUnread(), alertsOpen: inbox.inboxListOpen(), join, updates: updatesUnseen(), cube: cubeCount },
    slots: {
      league, challenge, queue, invites, yourMatches, leagueMatches, cubeEvents,
      scpicker: singleCardPickerHtml(singleCardPickerView()),
      info: footHtml(),
      updates: updatesListHtml(),
    },
    art: {
      backdrop: artPick(backdropCard(user?.favoriteElement)),
      // a random card each, drawn once per page load (ui/homeart.ts)
      ...modeArt(),
      league: artPick(LEAGUE_ART),
      challenge: artPick(challengeArtCard(chal.currentId() ?? '')),
      queue: artPick(QUEUE_ART),
    },
  };
}

/* ── the pieces ───────────────────────────────────────────────────────── */

/** a sheet opener: `home-sheet` with the sheet's name */
const opens = (name: HomeSheet): { dataBtn: string; attrs: { 'data-sheet': string } } =>
  ({ dataBtn: 'home-sheet', attrs: { 'data-sheet': name } });

/** one settings row of the Play card: the label on the left, the control on
 * the right (components/setting-row.ts, shared with every form since 2026-11-04) */
const row = (label: string, controlHtml: string, hintHtml = ''): string => settingRow({ label, controlHtml, hintHtml });

/** the toolbar's centre: the account (avatar, name, record), or Sign in */
function accountHtml(a: IdentityBarView): string {
  const me = a.me;
  if (!me && a.resolving) {
    // the same shape the signed-out button is, so nothing jumps when it resolves
    return `<div class="homeacct busy" aria-busy="true"><span class="homeav">${icon('account')}</span>
      <span class="homeaccttext"><span class="homeacctname">Signing in…</span></span></div>`;
  }
  if (!me) {
    return `<button class="homeacct out" data-btn="acct-open-auth" title="log in or make an account — signed out, nothing is recorded">
      <span class="homeav">${icon('signin')}</span>
      <span class="homeaccttext"><span class="homeacctname">Sign in</span><span class="homeacctrec">playing as a guest</span></span></button>`;
  }
  const record = me.games
    ? `${me.wins}W–${me.losses}L${me.unresolved ? ` · ${me.unresolved} unrecorded` : ''}`
    : 'no games yet';
  const av = me.favoriteElement
    ? `<span class="homeav el ${esc(me.favoriteElement)}"><img src="${ICON_BASE}${esc(me.favoriteElement)}.webp" alt="" title="favorite element: ${esc(me.favoriteElement)}"></span>`
    : `<span class="homeav">${esc(me.username.charAt(0).toUpperCase())}</span>`;
  return `<button class="homeacct in" data-btn="acct-open-profile" title="your profile, stats and achievements">
    ${av}<span class="homeaccttext"><span class="homeacctname">${esc(me.username)}</span>
    <span class="homeacctrec">${record}${me.streak >= 2 ? ` · 🔥${me.streak}` : ''}</span></span></button>`;
}

/** the element chips and the die, for "Pick now" */
function elementPickHtml(d: HomeView['draft']): string {
  return `<div class="elrow homeels">${ALL_ELEMENTS.map(el =>
    `<button class="elchip ${el}${d.els.includes(el) ? ' on' : ''}" aria-pressed="${d.els.includes(el)}" data-btn="eltoggle" data-el="${el}">${elIcon(el)}${el}</button>`).join('')}
    ${button({ label: '🎲', variant: 'icon', title: `pick at random — any of the ${d.setCount}`, dataBtn: 'elrandom' })}
  </div>`;
}

/** the Create button: the page's one gold action */
const create = (label: string, p: { dataBtn: string; attrs?: Record<string, string | number | boolean | undefined>; disabled?: boolean; title?: string }): string =>
  button({ label, variant: 'action', className: 'homecreate', dataBtn: p.dataBtn, attrs: p.attrs, disabled: p.disabled, title: p.title });

/**
 * Report #356 (owner, 2026-11-08): Casual and Competitive are the RULES SET —
 * "Casual = simultaneous actions during simultaneous phases, Competitive =
 * entirely turn based, INT while NIT watches, then swap" — on Draft and on
 * Constructed alike, with the difference in a hover tooltip, not a subtext line.
 */
export const RULES_TIPS = {
  casual: 'Casual: both players take the resource step, the haste step and deployment at the same time, and see what the other did once both are done.',
  competitive: 'Competitive: the printed turn order. The initiative player takes the resource step, the haste step and deployment first while the other player watches, then the other player takes them.',
} as const;

function rulesRow(v: HomeView): string {
  return row('Rules', segmented({
    ariaLabel: 'Rules', size: 'sm',
    options: (['casual', 'competitive'] as const).map(f => ({
      label: f === 'casual' ? 'Casual' : 'Competitive', value: f, on: v.format === f,
      dataBtn: 'home-format', attrs: { 'data-format': f }, title: RULES_TIPS[f],
    })),
  }));
}

/** how many of the settings behind More settings are off their standard:
 * Simple cards only, the card filter, the bans (one setting, however many), and
 * each game value that differs. Shut, the disclosure says so (owner 2026-11-03:
 * "Simple cards only" must not be easy to miss). */
export function moreChanged(r: CustomRulesView): number {
  return (r.rules.simpleOnly ? 1 : 0) + (r.rules.query ? 1 : 0) + (r.rules.bans.length ? 1 : 0) + r.values.length;
}

/** More settings: the disclosure, and under it, when open, Cards, Banned and Game values */
function moreHtml(d: HomeView['draft']): string {
  const r = d.rules, open = !!d.more, n = moreChanged(r);
  const toggle = button({
    labelHtml: `<span>More settings</span>${icon(open ? 'chevron-down' : 'chevron-right')}${n > 0
      ? chip({ label: `${n} changed`, tone: 'accent', shape: 'pill', className: 'homemorecount' }) : ''}`,
    variant: 'link', className: 'homemore', dataBtn: 'home-more',
    attrs: { 'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'home-more-rows' },
    title: n > 0 && r.summary.length ? r.summary.join(' · ') : undefined,
  });
  // one group, a little tighter than the rows around it: what opens reads as the toggle's
  if (!open) return `<div class="homemoregroup"><div class="homemorerow">${toggle}</div></div>`;
  return `<div class="homemoregroup"><div class="homemorerow">${toggle}</div><div class="homemorerows" id="home-more-rows">`
    + row('Cards', cardsHtml(r))
    + row('Banned', bansHtml(r))
    // the numbers alone live in a sheet (owner: the modal is "only reserved
    // for changing the default 'value settings'")
    + row('Game values', `<div class="homerules"><span class="homerulessum">${r.values.length
      ? `<b>${esc(r.values.join(' · '))}</b>` : '<span class="dim">Standard values</span>'}</span>
      ${button({ label: 'Change…', size: 'sm', ...opens('rules') })}</div>`)
    + '</div></div>';
}

/** Alternate modes: Standard | Beginner (the custom rules' cr-beginner, as the
 * Mode row was) | Cube draft (home-cube), with my cube events' count */
function altModesHtml(v: HomeView): string {
  const d = v.draft, r = d.rules, cubeOn = !!d.cube, n = v.badges.cube ?? 0;
  const control = segmented({
    ariaLabel: 'Alternate modes', size: 'sm',
    options: [
      { label: 'Standard', value: 'standard', on: !cubeOn && !r.beginner, dataBtn: 'cr-beginner', attrs: { 'data-on': '0' },
        title: r.beginner ? 'back to the standard game' : 'the full game' },
      { label: 'Beginner', value: 'beginner', on: !cubeOn && r.beginner, dataBtn: 'cr-beginner', attrs: { 'data-on': '1' },
        title: 'the rulebook’s Quick Start: two elements (Fire + Wood suggested), simple cards only, packs of 5' },
      // my cube events' count rides on the option, as text (a segmented option's label is text)
      { label: n > 0 ? `Cube draft · ${n}` : 'Cube draft', value: 'cube', on: cubeOn, dataBtn: 'home-cube',
        title: n > 0 ? `draft with a group, then play a tournament · ${n} of your events` : 'draft with a group, then play a tournament' },
    ],
  });
  return row('Alternate modes', `<div class="homemode">${control}${!cubeOn && r.beginner ? `<span class="homemodehint">${esc(BEGINNER_HINT)}</span>` : ''}</div>`);
}

function draftRowsHtml(v: HomeView): { rows: string; go: string } {
  const d = v.draft, k = d.k, r = d.rules;
  const picked = d.els.length === k;
  const rules = v.format === 'competitive' ? { 'data-rules': 'competitive' } : {};
  // Cube draft: the rest is greyed out and inert, not hidden — a disabled
  // fieldset disables every control inside it (buttons, the ban box, the chips).
  // Two of them, because Alternate modes sits between Elements and More settings
  // (owner, 2026-11-14: "More settings should be below the Alt modes")
  const set = (html: string): string => `<fieldset class="homerowsset"${d.cube ? ' disabled' : ''}>${html}</fieldset>`;
  const rows = set(rulesRow(v)
    + row('Clock', clockPickHtml(v.clock, { look: 'segmented' }))
    + row('Elements', segmented({
      ariaLabel: 'Elements', size: 'sm',
      options: [
        { label: 'Choose in the room', value: 'room', on: !d.fixedOpen, dataBtn: 'home-els', attrs: { 'data-pick': 'room' } },
        { label: 'Pick now', value: 'now', on: d.fixedOpen, dataBtn: 'home-els', attrs: { 'data-pick': 'now' } },
      ],
    }) + (d.fixedOpen ? elementPickHtml(d) : '')))
    + altModesHtml(v)
    + set(moreHtml(d) + poolLineHtml(r));
  if (d.cube) {
    return { rows, go: create('Host a Cube draft', { dataBtn: 'home-cube-host', title: 'draft with a group, then play a tournament' }) };
  }
  const custom = d.custom ? 'Create custom room' : 'Create room';
  const go = d.fixedOpen
    ? create(picked ? `${custom} · ${d.els.map(cap).join(' + ')}` : `Pick ${k} elements (${d.els.length}/${k})`, {
      dataBtn: 'newgame', attrs: { 'data-mode': 'draft', 'data-els': '1', ...rules },
      disabled: !picked || !!d.fixedError, title: picked && d.fixedError ? d.fixedError : undefined,
    })
    : create(custom, { dataBtn: 'newgame', attrs: { 'data-mode': 'draft', ...rules }, disabled: !!d.customError, title: d.customError });
  return { rows, go };
}

/** report #356: a Constructed game is a MATCH (accounts, a sideboard, the
 * match clock) unless it is a Casual single game — Best of is apart from the
 * rules set, so a Competitive single game is a Best of 1 match, as it was */
export const homeIsMatch = (v: Pick<HomeView, 'format' | 'competitive'>): boolean =>
  v.format === 'competitive' || v.competitive.bestOf === 3;

function constructedRowsHtml(v: HomeView): { rows: string; go: string } {
  const c = v.competitive;
  const choices = rulesRow(v)
    + row('Best of', segmented({
      ariaLabel: 'Best of', size: 'sm',
      options: ([1, 3] as const).map(n => ({
        label: `${n} game${n === 1 ? '' : 's'}`, value: String(n), on: c.bestOf === n, dataBtn: 'cc-bo', attrs: { 'data-bo': n },
      })),
    }), c.bestOf === 3 ? 'A sideboard of up to 7, swapped between games.' : '');
  if (homeIsMatch(v)) {
    if (!c.signedIn) {
      // it says so instead of disappearing: a match hangs off two accounts
      return {
        rows: choices + `<div class="homeneedacct"><p>${v.format === 'competitive' ? 'Competitive matches' : 'Matches of three games'} need an account, so the result can be kept.</p>
          ${button({ label: 'Sign in', variant: 'action', dataBtn: 'acct-open-auth' })}</div>`,
        go: '',
      };
    }
    const rows = choices
      // docs/22 §6.1: the match clock — Default is the owner's 45 minutes each
      // for the whole match; the creator may override it (owner, 2026-11-03)
      + row('Clock', clockPickHtml(v.clock, { look: 'segmented' }))
      + row('Deck', ccDeckSelectHtml(c.decks, c.pick));
    return { rows, go: create(c.pick ? 'Create match' : 'Pick a deck first', { dataBtn: 'cc-new', attrs: { 'data-rules': v.format }, disabled: !c.pick }) };
  }
  const format = choices;
  const importBtn = v.deckPicker.signedIn ? '' : button({ label: 'Import a deck…', variant: 'link', className: 'homeimport', ...opens('import') });
  const rows = format
    + row('Clock', clockPickHtml(v.clock, { look: 'segmented' }))
    + row('Deck', deckPickerHtml(v.deckPicker, { importHtml: importBtn }))
    + `<div class="homesilly">${button({ labelHtml: '…or something sillier: <b>Single Card Duel</b>', variant: 'link', className: 'homesillybtn', ...opens('single') })}</div>`;
  return {
    rows,
    go: create(v.hasDeck ? 'Create room' : 'Pick a deck first', { dataBtn: 'newgame', attrs: { 'data-mode': 'constructed' }, disabled: !v.hasDeck }),
  };
}

/** Draft | Constructed as two picture tiles, the chosen one lit (owner,
 * 2026-11-07, after Caleb's mockups: each choice shows a painting) */
function modeTilesHtml(v: HomeView): string {
  const tile = (mode: HomeMode, label: string): string => {
    const on = v.mode === mode;
    return `<button class="homemodetile${on ? ' on' : ''}" data-btn="home-mode" type="button" aria-pressed="${on}" data-mode="${mode}">
      ${artHtml(v.art[mode], 'homemodeart')}<span class="homemodelabel">${label}</span></button>`;
  };
  return `<div class="homemodes" role="group" aria-label="Game type">${tile('draft', 'Draft')}${tile('constructed', 'Constructed')}</div>`;
}

function playHtml(v: HomeView): string {
  const { rows, go } = v.mode === 'draft' ? draftRowsHtml(v) : constructedRowsHtml(v);
  const join = button({
    labelHtml: `Join a room${v.badges.join > 0 ? ` ${chip({ label: String(v.badges.join), tone: 'accent', shape: 'pill', solid: true, className: 'homejoinbadge' })}` : ''}`,
    className: 'homejoin', ...opens('join'),
    title: 'a room code, a friend’s invite, a paused match or a league match',
  });
  return `<section class="homeplay" aria-labelledby="home-play-h">
    <div class="homeplayhead">
      <h1 id="home-play-h">Play</h1>
      ${modeTilesHtml(v)}
      ${v.mode === 'draft' ? '' : '<p class="homeplaysub">Bring a deck you built: 30 cards, at most 2 of each.</p>'}
    </div>
    <div class="homerows">${rows}</div>
    <div class="homeplayfoot">
      ${v.nameBox === null
        ? ''
        : `<label class="homename">Your name <input id="h-name" maxlength="24" value="${esc(v.nameBox)}" placeholder="(optional)"></label>`}
      ${v.error ? statusMessage({ tag: 'p', tone: 'error', className: 'pageerr', text: v.error }) : ''}
      <div class="homeactions">${join}${go}</div>
    </div>
  </section>`;
}

/** one of the three cards beside Play: the whole card opens its page (a
 * stretched button), and buttons inside it (Matchmaking's Join) still work */
/** a card's painting behind a panel: decoration only, so no alt, and a scan
 * that fails to load just leaves the panel's own colour. The crop is centred
 * on the painting (ArtPick.focusY). */
const artHtml = (a: ArtPick, cls: string): string =>
  `<span class="homeart ${cls}" aria-hidden="true"><img src="${esc(a.src)}" alt="" loading="lazy" style="object-position:50% ${a.focusY}%" onerror="this.remove()"></span>`;

function sideCardHtml(p: { kind: string; title: string; iconName: 'league' | 'challenge' | 'matchmaking'; dataBtn: string;
  live: boolean; bodyHtml: string; empty: string; open: string; art: ArtPick }): string {
  return `<section class="homeside homeside--${p.kind}${p.live ? '' : ' off'}" aria-label="${esc(p.title)}">
    ${artHtml(p.art, 'homesideart')}
    <h2 class="homesidetitle">${icon(p.iconName)}<span>${esc(p.title)}</span>${p.live ? icon('chevron-right') : ''}</h2>
    <div class="homesidebody">${p.bodyHtml || `<p class="homesideempty">${esc(p.empty)}</p>`}</div>
    ${p.live ? `<button class="homesideopen" data-btn="${esc(p.dataBtn)}" aria-label="${esc(p.open)}"></button>` : ''}
  </section>`;
}

/** What the League / Challenge card says when its data never came: before
 * these, it said "No league running right now" / "No challenge this week",
 * a guess written as a fact (docs/23-ui-inventory/01 §4 S16). */
export const LEAGUE_MISSED = 'Could not load the league just now.';
export const CHALLENGE_MISSED = 'Could not load this week’s challenge just now.';

function sideHtml(v: HomeView): string {
  const s = v.slots;
  const leagueEmpty = v.leagueLive ? 'Seasons, standings and your matches.' : v.leagueMissed ? LEAGUE_MISSED : 'No league running right now.';
  const challengeEmpty = v.challengeLive ? 'Past weeks and their boards.' : v.challengeMissed ? CHALLENGE_MISSED : 'No challenge this week.';
  return `<div class="homesides">
    ${sideCardHtml({ kind: 'league', title: 'League', iconName: 'league', dataBtn: 'nav-league', live: v.leagueLive,
      bodyHtml: s.league, empty: leagueEmpty, open: 'Open the League page',
      art: v.art.league })}
    ${sideCardHtml({ kind: 'challenge', title: 'Challenge', iconName: 'challenge', dataBtn: 'nav-challenge', live: v.challengeLive,
      bodyHtml: s.challenge, empty: challengeEmpty, open: 'Open the weekly challenge',
      art: v.art.challenge })}
    ${sideCardHtml({ kind: 'queue', title: 'Matchmaking', iconName: 'matchmaking', dataBtn: 'queue-open', live: true,
      bodyHtml: s.queue, empty: 'Find an opponent.', open: 'Open matchmaking', art: v.art.queue })}
  </div>`;
}

function bottomHtml(v: HomeView): string {
  const n = v.badges.updates;
  return shellBar({
    className: 'homebottom',
    startHtml: iconButton({ label: 'Algomancy Online (Unofficial Client)', labelHtml: '<span class="homewordmark">Algomancy</span> Online <span class="homewordsub">(Unofficial Client)</span>', icon: 'info', layout: 'inline', className: 'homeinfo',
      on: v.sheet === 'info', ...opens('info'), title: 'about this client: the game, the notice, buying it, privacy' }),
    endHtml: iconButton({ label: n > 0 ? `Updates · ${n} new` : 'Updates', icon: 'updates', layout: 'inline', badge: n > 0 ? 'dot' : undefined,
      className: 'homeupdates', on: v.sheet === 'updates', ...opens('updates'),
      title: n > 0 ? `${n} new since you last looked` : 'what changed, newest first' }),
  });
}

/* ── the sheets ───────────────────────────────────────────────────────── */

function joinBody(v: HomeView): string {
  const s = v.slots;
  const sec = (label: string, html: string): string =>
    html ? `<section class="homejoinsec"><div class="zonelabel">${esc(label)}</div>${html}</section>` : '';
  // yourMatchesHtml carries its own "Your matches" heading
  const waiting = sec('Invites', s.invites) + (s.yourMatches ? `<section class="homejoinsec">${s.yourMatches}</section>` : '')
    + sec('League matches', s.leagueMatches) + sec('Your cube events', s.cubeEvents ?? '');
  return `<label class="homecodelabel" for="h-code">Room or event code</label>
    <div class="joinrow homecode">
      <input id="h-code" placeholder="CODE" maxlength="8" autocapitalize="characters"
        spellcheck="false" style="text-transform:uppercase">
      ${button({ label: 'Join', variant: 'action', dataBtn: 'joincode' })}
    </div>
    ${v.joinError ? statusMessage({ tag: 'p', tone: 'error', className: 'pageerr', text: v.joinError }) : ''}
    ${waiting || '<p class="homejoinnone">Nothing waiting for you — ask for a code.</p>'}`;
}

/** each sheet's id on the page (the root's; its title is `<id>-title`) */
const SHEET_IDS: Record<HomeSheet, string> = {
  join: 'home-join', info: 'home-info', updates: 'home-updates', rules: 'home-rules', import: 'home-import',
  single: 'home-single', 'alerts-signin': 'home-alerts',
};

function sheetHtml(v: HomeView): string {
  const s = v.slots;
  const base = { open: true, dismissBtn: 'home-sheet-close', attrs: { 'data-home-sheet': v.sheet ?? '' } } as const;
  switch (v.sheet) {
    case 'join':
      return sheet({ ...base, id: SHEET_IDS.join, title: 'Join a room', className: 'homesheet', bodyHtml: joinBody(v) });
    case 'rules':
      // the Game values: the numbers only (the cards rules are on the Draft tab)
      return sheet({ ...base, id: SHEET_IDS.rules, title: 'Game values', width: 'md', className: 'homesheet',
        bodyHtml: `<p class="homesheetnote">Change a value and the room is a custom game: it counts toward no stats or rating.</p>${gameValuesHtml(v.draft.rules)}`,
        footerHtml: button({ label: 'Done', variant: 'action', dataBtn: 'home-sheet-close' }) });
    case 'import':
      return sheet({ ...base, id: SHEET_IDS.import, title: 'Import a deck', className: 'homesheet',
        bodyHtml: `<p class="homesheetnote">An algomancer.cc deck link, or a pasted list. Sign in to keep decks of your own.</p>
          ${deckImportHtml()}
          ${v.deckPicker.msg ? statusMessage({ tone: 'note', className: 'deckmsg', text: v.deckPicker.msg }) : ''}` });
    case 'single':
      return sheet({ ...base, id: SHEET_IDS.single, title: 'Single Card Duel', className: 'homesheet singleduel',
        bodyHtml: `<p class="cardsub">Thirty copies of one card. Your opponent picks theirs blind. It rates
          the cards, not you — see the ${button({ label: 'card ladder', variant: 'link', className: 'linkbtn', dataBtn: 'meta-ladder' })}.</p>
          ${s.scpicker}`,
        footerHtml: create(v.singleCard ? `Create duel · ${v.singleCard}` : 'Pick a card first', {
          dataBtn: 'newgame', attrs: { 'data-mode': 'constructed', 'data-single': '1' }, disabled: !v.singleCard,
        }) });
    case 'info':
      return sheet({ ...base, id: SHEET_IDS.info, title: 'Algomancy Online (Unofficial Client)', width: 'lg',
        placement: 'anchor-bottom-left', className: 'homesheet homeinfosheet', bodyHtml: s.info });
    case 'updates':
      return sheet({ ...base, id: SHEET_IDS.updates, title: 'Updates', placement: 'anchor-bottom-right', width: 'lg',
        className: 'homesheet homeupdsheet', bodyHtml: s.updates });
    case 'alerts-signin':
      return sheet({ ...base, id: SHEET_IDS['alerts-signin'], title: 'Alerts', width: 'sm', placement: 'anchor-top-right', className: 'homesheet',
        bodyHtml: '<p>Sign in to get friend invites, match alerts and league notices here.</p>',
        footerHtml: button({ label: 'Sign in', variant: 'action', dataBtn: 'acct-open-auth' }) });
    default:
      return '';
  }
}

/** The home screen's markup. Pure: no DOM, no globals, no module state —
 * everything it shows comes in through `v`. The root is the app shell, with
 * `apppage` (pages/frame.ts) and `homepage` as its LAST class: report.ts names the page from the last class
 * of #app's first element (test 287), and the layers hide their own pill, bell
 * and footer when `#app > .homepage` is on screen. */
export function homeHtml(v: HomeView): string {
  // the toolbar: Decks Cards Metagame · the account · Learn Test Rules Alerts Report.
  // The five tools are the frame's (pages/frame.ts toolsHtml), shared with
  // every other page; only the home's signed-out Alerts is its own (a sheet).
  const top = shellBar({
    className: 'hometools',
    startHtml: iconButton({ label: 'Decks', icon: 'decks', dataBtn: 'deck-openpage', title: 'your decks: build, import, export' })
      + iconButton({ label: 'Cards', icon: 'cards', dataBtn: 'cards-openpage', title: 'every card, with a search' })
      + iconButton({ label: 'Metagame', icon: 'stats', dataBtn: 'meta-openpage', title: 'published decks, card stats, the card duel ladder' }),
    centerHtml: accountHtml(v.account),
    endHtml: toolsHtml({ signedIn: v.signedIn, alerts: v.badges.alerts, alertsOpen: v.badges.alertsOpen === true }, TOOL_NAMES, {
      alertsSignedOutHtml: iconButton({ label: 'Alerts', icon: 'alerts', className: 'homealerts', ...opens('alerts-signin'), on: v.sheet === 'alerts-signin' }),
    }),
  });
  return appShell({
    // one centred column for the bars' content and the main region (owner,
    // 2026-11-03: the toolbar sat hard in the window's corners on a laptop)
    contained: true,
    // `apppage`: the page carries its own Report, Alerts and footer (pages/frame.ts)
    className: 'apppage homepage',
    topHtml: top,
    mainHtml: `${artHtml(v.art.backdrop, 'homebackdrop')}<div class="homemain">${playHtml(v)}${sideHtml(v)}</div>${sheetHtml(v)}`,
    bottomHtml: bottomHtml(v),
  });
}

/* ── painting and wiring ──────────────────────────────────────────────── */

/** the last pointer that pressed anything: a finger, a pen or a mouse */
let lastPointer = 'mouse';
let installed = false;
/** the rerender the document-level listeners call (main.ts renderHome) */
let homeRerender: (() => void) | null = null;

/** Buttons inside an open sheet that keep it open: the sheet's own controls.
 * Anything else in a sheet leads somewhere — another page (the card ladder, a
 * paused match), a layer (About, Privacy …) — and closes the sheet first, so
 * coming back to home does not find it still up, and a layer opened from the
 * info sheet is not drawn UNDER it. */
const KEEPS_SHEET = /^(home-|cr-|sc-|deckimport|joincode$|newgame$)/;

function installHomeListeners(): void {
  if (installed || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  installed = true;
  document.addEventListener('pointerdown', e => { lastPointer = (e as PointerEvent).pointerType || 'mouse'; }, true);
  // capture: before the layers' own capture listeners act on the click and
  // before main.ts's delegator repaints
  document.addEventListener('click', e => {
    if (!homeSheet) return;
    const t = e.target as HTMLElement | null;
    const hit = t?.closest?.('[data-btn], [data-legal], [data-help], [data-learn], [data-report], [data-inbox]') as HTMLElement | null;
    if (!hit) return;
    // inside an open sheet: its root carries data-home-sheet (sheetHtml)
    if (!hit.closest('[data-home-sheet]')) return;
    const b = hit.dataset['btn'];
    if (b !== undefined && KEEPS_SHEET.test(b)) return;
    if (hit.dataset['inbox'] === 'decline') return;
    closeHomeSheet();
    // a data-btn's own handler repaints (or navigates); a layer button opens
    // its layer and nothing repaints #app, so take the sheet down here
    if (b === undefined) homeRerender?.();
  }, true);
  // Esc closes the open sheet — only while the home screen is what #app shows
  installSheetEsc(document, () => {
    if (!homeSheet || !document.getElementById(SHEET_IDS[homeSheet])) return false;
    closeHomeSheet();
    homeRerender?.();
    return true;
  });
}

/** the info sheet opens on a MOUSE resting on its button (a finger's tap is a
 * click), and a sheet opened that way closes when the mouse leaves it */
function wireInfoHover(app: HTMLElement): void {
  const btn = app.querySelector('.homeinfo') as HTMLElement | null;
  if (!btn || typeof btn.addEventListener !== 'function') return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  btn.addEventListener('pointerenter', e => {
    if ((e as PointerEvent).pointerType !== 'mouse' || homeSheet) return;
    timer = setTimeout(() => { timer = null; if (!homeSheet && openHomeSheet('info', 'hover')) homeRerender?.(); }, 250);
  });
  btn.addEventListener('pointerleave', () => { if (timer) { clearTimeout(timer); timer = null; } });
  if (homeSheet !== 'info' || !sheetByHover) return;
  const scrim = app.querySelector('#home-info .ui-sheet__scrim') as HTMLElement | null;
  const panel = app.querySelector('#home-info .ui-sheet__panel') as HTMLElement | null;
  scrim?.addEventListener('pointermove', e => {
    const pe = e as PointerEvent;
    if (pe.pointerType !== 'mouse' || !panel) return;
    // the mouse is free to cross from the button up to the panel: the box
    // around the two of them is "still hovering"
    const a = btn.getBoundingClientRect(), b = panel.getBoundingClientRect();
    const inside = pe.clientX >= Math.min(a.left, b.left) && pe.clientX <= Math.max(a.right, b.right)
      && pe.clientY >= Math.min(a.top, b.top) && pe.clientY <= Math.max(a.bottom, b.bottom);
    if (!inside) { closeHomeSheet(); homeRerender?.(); }
  });
}

/** The Alerts and Join badges, patched in place when the inbox's counts move
 * (no whole-page repaint for a count). */
function patchHomeBadges(alerts: number, join: number): void {
  const bell = document.querySelector('#app > .homepage .homealerts .ui-icon-button__icon');
  if (bell) {
    bell.querySelector('.ui-icon-button__badge')?.remove();
    bell.insertAdjacentHTML('beforeend', iconButtonBadge(alerts));
  }
  const joinBtn = document.querySelector('#app > .homepage .homejoin');
  if (joinBtn) {
    joinBtn.querySelector('.homejoinbadge')?.remove();
    if (join > 0) joinBtn.insertAdjacentHTML('beforeend', ` ${chip({ label: String(join), tone: 'accent', shape: 'pill', solid: true, className: 'homejoinbadge' })}`);
  }
}

/** The pictures survive a repaint (owner, 2026-11-14: "clicking something to swap it or make a
 * choice makes all the images on the screen flash for a frame and it's jarring"). Every choice
 * repaints the whole page through innerHTML, which made a new <img> for each painting — the
 * backdrop, the Draft and Constructed tiles, the three cards beside Play — and a new image, lazy
 * and decoded off the main thread, is drawn empty for a frame even from the cache. So the old
 * element goes back in place of its new twin (same markup: same picture, same crop) before the
 * browser draws anything; a picture that did change is the new element. Measured in Chrome: 6 of
 * 6 replaced per click before, 0 after. test/1370 §7. */
export const ART_IMGS = '.homeart img';
export function keepArt(app: Pick<ParentNode, 'querySelectorAll'>, paint: () => void): void {
  const old = new Map<string, Element[]>();
  for (const img of Array.from(app.querySelectorAll?.(ART_IMGS) ?? [])) {
    const twins = old.get(img.outerHTML);
    if (twins) twins.push(img); else old.set(img.outerHTML, [img]);
  }
  paint();
  for (const img of Array.from(app.querySelectorAll?.(ART_IMGS) ?? [])) {
    const same = old.get(img.outerHTML)?.shift();
    if (same) img.replaceWith(same);
  }
}

/** Paint the home screen into `app` and wire it. `rerender` is main.ts's
 * renderHome — the router, which comes back here when no other page owns #app. */
export function paintHome(app: HTMLElement, st: HomeState, rerender: () => void): void {
  homeRerender = rerender;
  installHomeListeners();
  const typed = HOME_TYPED.map(id => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value);
  const pasteOpen = (document.querySelector('.homepage .deckpaste') as HTMLDetailsElement | null)?.open ?? false;
  const caret = caretIn(HOME_CARET);
  keepArt(app, () => { app.innerHTML = homeHtml(homeView(st)); });
  const justOpened = homeSheet !== paintedSheet ? homeSheet : null;
  paintedSheet = homeSheet;
  const codeInput = document.getElementById('h-code') as HTMLInputElement | null;
  codeInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') (document.querySelector('[data-btn="joincode"]') as HTMLElement).click();
  });
  wireDeckPicker(rerender);
  mt.wireDeckSelect(rerender);   // docs/22 §6.1: Competitive's deck picker
  // docs/22 §5.6: a paused or running match is always one button away (the Join sheet)
  mt.loadMyMatches(acct.token() ? acct.authHeaders(false) : null, rerender);
  crp.wirePanel();   // BL-43: the Draft tab's ban and filter boxes
  sc.wire();         // CR D8.2 (the Single Card Duel sheet)
  // what was typed, and where, survives the repaint (HOME_TYPED)
  HOME_TYPED.forEach((id, i) => {
    const box = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (box && typed[i] !== undefined) box.value = typed[i]!;
  });
  if (pasteOpen) { const d = document.querySelector('.homepage .deckpaste') as HTMLDetailsElement | null; if (d) d.open = true; }
  restoreCaret(caret);
  // a sheet that holds a text box hands it the focus as it opens — with a
  // mouse; a finger would get the on-screen keyboard over the sheet
  if (justOpened === 'join' && lastPointer === 'mouse') codeInput?.focus?.();
  wireInfoHover(app);
  wireUpdates();
  // the inbox's counts move on its own poll: badge them in place, no repaint
  // for a count — but an open Join sheet lists the invites, so it is redrawn
  inbox.onInboxChange(() => {
    if (!document.getElementById(SHEET_IDS.join) && !document.querySelector('#app > .homepage')) return;
    if (homeSheet === 'join') { homeRerender?.(); return; }
    patchHomeBadges(inbox.inboxUnread(), inbox.inviteCount() + mt.myMatchCount() + lg.joinCount() + cube.joinCount());
  });
  // BL-01: the at-a-glance count. Started HERE rather than at boot because
  // this is the only screen that shows it, and an idle tab on a board should
  // not be asking the server who is queueing every five seconds. Idempotent.
  mm.startCountsPoll();
}

/* ── the home screen's buttons ───────────────────────────────────────────
 * Moved out of main.ts handlePregameButton by BL-63 (2026-11-13), the bodies
 * as they were; only the names changed: `ui.homeEls`/`ui.homeFixedTrio` are
 * this module's state above, main.ts's `uiError` and its repaints come in as
 * the host. The waiting rooms' buttons (deckjoin, singlejoin, gohome,
 * copylink) stayed in main.ts (handleRoomButton): they drive the connection. */

/** what main.ts lends the home's buttons */
export interface HomeButtonHost {
  /** main.ts renderHome — the router, which comes back to paintHome */
  rerender(): void;
  /** main.ts `uiError`: the line drawn above Create room ('' clears it) */
  setError(msg: string): void;
  /** the deck import's repaint: main.ts render in a room, renderHome outside one */
  readonly importRepaint: () => void;
}

/** A home-screen button: true when it was one (it repainted the home itself,
 * navigated away, or fired a request whose reply does the painting), so the
 * caller stops there. */
export function handleHomeButton(b: string | undefined, btn: HTMLElement, host: HomeButtonHost): boolean {
  const renderHome = host.rerender;
  // BL-43: the custom rules' buttons (the Draft tab's rows, the Game values sheet)
  const wasBeginner = crp.beginnerOn();
  if (crp.handlePanelButton(b, btn)) {
    // Beginner (the Mode row, or the preset) SUGGESTS the rulebook's pair, as
    // a fixed pick the player can see and change — not a choice made for them
    if ((b === 'cr-preset' && btn.dataset['preset'] === 'beginner') || (b === 'cr-beginner' && btn.dataset['on'] === '1')) {
      homeEls = ['fire', 'wood'];
      homeFixedTrio = true;
      saveEls();
    }
    // …and Standard, from Beginner, is the standard game again: the elements
    // go back to being chosen in the room
    if (b === 'cr-beginner' && btn.dataset['on'] !== '1' && wasBeginner) homeFixedTrio = false;
    // Standard and Beginner share Alternate modes with Cube draft: either one leaves it
    if (b === 'cr-beginner') homeCube = false;
    renderHome();
    return true;
  }
  // the new home (docs/24, 2026-11-03): the Play card's tabs and switches and
  // the sheets. Each is home state (above) and a repaint.
  if (b === 'home-mode') { setHomeMode(btn.dataset['mode']); renderHome(); return true; }
  if (b === 'home-format') { setHomeFormat(btn.dataset['format']); renderHome(); return true; }
  if (b === 'home-els') { homeFixedTrio = btn.dataset['pick'] === 'now'; renderHome(); return true; }
  if (b === 'home-sheet') { openHomeSheet(btn.dataset['sheet']); renderHome(); return true; }
  if (b === 'home-sheet-close') { closeHomeSheet(); renderHome(); return true; }
  // the Draft tab's More settings, and Alternate modes' Cube draft (owner, 2026-11-14)
  if (b === 'home-more') { homeMore = !homeMore; renderHome(); return true; }
  if (b === 'home-cube') { homeCube = true; renderHome(); return true; }
  if (b === 'home-cube-host') {
    // the cube page, straight onto its New event form; signed out it says to
    // sign in first (its list does), so there is no form to open
    cube.openCubeNew();
    return true;
  }
  if (b === 'eltoggle') {
    homeFixedTrio = true;
    const el = btn.dataset['el']!;
    if (homeEls.includes(el)) homeEls = homeEls.filter(x => x !== el);
    else if (homeEls.length < crp.elementCount()) homeEls.push(el);
    else { homeEls.shift(); homeEls.push(el); }   // full: rotate the oldest out
    homeEls = homeEls.slice(-crp.elementCount());   // BL-43: a smaller set drops the oldest
    saveEls();
    renderHome();
    return true;
  }
  if (b === 'elrandom') {
    homeFixedTrio = true;
    // every element the ENGINE knows about, so the die reaches all C(n,3)
    // trios — 35 of them with Light & Dark in
    homeEls = [];
    while (homeEls.length < crp.elementCount()) {
      const pick = ALL_ELEMENTS[Math.floor(Math.random() * ALL_ELEMENTS.length)]!;
      if (!homeEls.includes(pick)) homeEls.push(pick);
    }
    saveEls();
    renderHome();
    return true;
  }
  if (b === 'clockpick' && btn.dataset['clockfor'] === 'competitive') {
    // docs/22 §6.1: a Competitive match's clock is its own setting (a match
    // bank, not a per-game one) — pages/clockpick.ts MATCH_CLOCK_KEY
    setMatchClockChoice(btn.dataset['ms']);
    renderHome();
    return true;
  }
  if (b === 'clockpick') {
    // BL-26: "Default" is the ABSENCE of the key, not a number written into
    // it — that is what lets the mode decide, and what makes a player who
    // never touched this picker get 45m for constructed and 60m for a draft.
    const ms = btn.dataset['ms'];
    if (ms === 'auto') localStorage.removeItem('algoClockMs');
    else localStorage.setItem('algoClockMs', String(Number(ms ?? CLOCK_DEFAULT_MS)));
    renderHome();
    return true;
  }
  if (b === 'newgame') {
    saveHomeName();
    const m = btn.dataset['mode'];
    const mode = m === 'draft' ? 'draft' : m === 'constructed' ? 'constructed' : 'shared';
    // CR D8.2: a single card duel is a constructed room that brings a card, not a deck
    const single = mode === 'constructed' && btn.dataset['single'] === '1';
    if (single ? !sc.chosen() : mode === 'constructed' && !chosenDeck()) return true;   // button is disabled anyway
    // a draft with NO els opens the lobby and chooses the trio there; passing
    // els is the deliberate escape hatch that skips it
    const fixed = mode === 'draft' && btn.dataset['els'] && homeEls.length === crp.elementCount() ? homeEls : null;
    const els = fixed ? `&els=${encodeURIComponent(fixed.join(','))}` : '';
    // BL-26: the chosen bank rides the CREATING join. ⚠ It is appended HERE
    // and nowhere else — in particular NOT to the share link the waiting
    // screen hands the opponent (see `shareBannerHtml` and the two lobby
    // links). By then the room exists and the server ignores the field, so
    // appending it would change nothing except what the joiner believes they
    // are choosing.
    // BL-26: the MODE is known here and nowhere earlier, which is the whole
    // reason the default is resolved at this line rather than in the picker.
    const clock = `&clock=${chosenClockMs(mode)}`;
    // BL-43: custom rules ride a POST — the server resolves and checks them and
    // keeps them with the reserved code. A standard game is the GET it always was.
    const payload = mode === 'draft' ? crp.createPayload(fixed) : null;
    const made = payload
      ? fetch('/api/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      : fetch('/api/new');
    made.then(async r => {
      const j = await r.json() as { code?: string; error?: string };
      if (!r.ok || !j.code) { host.setError(j.error ?? 'the server refused these rules'); renderHome(); return; }
      host.setError('');
      // report #356: a Competitive draft says so on the creating link
      const rules = mode === 'draft' && btn.dataset['rules'] === 'competitive' ? '&rules=competitive' : '';
      location.search = `?ws=1&room=${encodeURIComponent(j.code)}&seat=0&mode=${mode}${single ? '&single=1' : ''}${els}${clock}${rules}`;
    }).catch(() => { host.setError('could not reach the server'); renderHome(); });
    return true;
  }
  if (b === 'deckimporturl') {
    const inp = document.getElementById('h-deckurl') as HTMLInputElement | null;
    // an empty box is said, not ignored (importDeck)
    importDeck({ url: inp?.value ?? '' }, host.importRepaint);
    return true;
  }
  if (b === 'deckimporttext') {
    const ta = document.getElementById('h-decktext') as HTMLTextAreaElement | null;
    importDeck({ text: ta?.value ?? '' }, host.importRepaint);
    return true;
  }
  if (b === 'joincode') {
    saveHomeName();
    const box = document.getElementById('h-code') as HTMLInputElement | null;
    const target = joinCodeTarget(box?.value ?? '');
    // an empty box: the Join sheet says so, and the box takes the typing
    if (!target) { renderHome(); (document.getElementById('h-code') as HTMLInputElement | null)?.focus?.(); return true; }
    // docs/25 §3: events and rooms share one code space — an event's code opens the event
    cube.tryEvent(box?.value ?? '', () => { location.search = target; });
    return true;
  }
  return false;
}
