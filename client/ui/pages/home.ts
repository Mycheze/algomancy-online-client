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
 * Everything that used to be a fold or a band is a SHEET now (components/
 * sheet.ts): Join a room, the Game values (the custom rules' numbers), the deck
 * import, Single Card Duel, the client info and the update log. The rest of
 * the custom rules — Beginner, Simple cards only, the card filter, the bans —
 * are rows of the Draft tab itself (owner, 2026-11-03). Which sheet is open is this
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
 * What is still in main.ts: the home screen's buttons (handlePregameButton:
 * eltoggle, elrandom, clockpick, newgame, joincode, deckimport*, and the
 * home-mode / home-format / home-els / home-sheet / home-sheet-close switches,
 * which call the setters below), because they write main.ts state
 * (`ui.homeEls`, `ui.homeFixedTrio`, `uiError`) and open the room.
 * TODO(ds): view/html split: move handlePregameButton here once `uiError` and
 * the element pick have a home outside main.ts's UiState.
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
import * as dk from '../decks.ts';
import * as lg from '../league.ts';
import * as mt from '../match.ts';
import * as mm from '../queue.ts';
import * as sc from '../singlecard.ts';
import { footHtml } from '../legal.ts';
import * as inbox from '../inbox.ts';
import { markUpdatesSeen, updatesListHtml, updatesUnseen, wireUpdates } from '../updates.ts';
import { ICON_BASE } from '../assets.ts';
import {
  appShell, button, chip, icon, iconButton, iconButtonBadge, installSheetEsc, segmented, settingRow, sheet, shellBar, statusMessage,
} from '../components/index.ts';
import { chosenDeck, elIcon as elIconOf, esc } from '../util.ts';
import { caretIn, restoreCaret } from './caret.ts';
import { TOOL_NAMES, toolsHtml } from './frame.ts';
import { clockPickHtml, clockPickView, type ClockPickView } from './clockpick.ts';
import {
  BEGINNER_HINT, bansHtml, cardsHtml, customRulesView, gameValuesHtml, modeHtml, poolLineHtml, type CustomRulesView,
} from './customrules.ts';
import { deckImportHtml, deckPickerHtml, deckPickerView, wireDeckPicker, type DeckPickerView } from './deckpicker.ts';
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
/** home-sheet data-sheet=<name>. Opening the update log marks it seen. */
export function openHomeSheet(name: string | undefined, how: 'click' | 'hover' = 'click'): boolean {
  if (!(HOME_SHEETS as readonly string[]).includes(name ?? '')) return false;
  homeSheet = name as HomeSheet;
  sheetByHover = how === 'hover';
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

/* ── the view ─────────────────────────────────────────────────────────── */

/** what main.ts owns and hands in: the element pick and the last error */
export interface HomeState {
  /** the elements picked for a fixed draft (main.ts `ui.homeEls`) */
  els: readonly string[];
  /** Elements is on "Pick now" (main.ts `ui.homeFixedTrio`) */
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
  };
  /** the clock picker for the tab that is showing — Competitive's is the
   * match clock (`mode: 'competitive'`, its own setting) */
  clock: ClockPickView;
  /** the last refusal (main.ts `uiError`), or '' */
  error: string;
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
  badges: {
    /** the bell's unread count (inbox.ts inboxUnread) — Alerts */
    alerts: number;
    /** invites + your matches + league matches to play — Join a room */
    join: number;
    /** update-log entries since it was last opened — Updates */
    updates: number;
  };
  slots: HomeSlots;
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
  const queue = queueGlanceHtml(queueStripView());
  const invites = inbox.inviteRowsHtml();
  const yourMatches = yourMatchesHtml(yourMatchesView());
  const leagueMatches = lg.joinRowsHtml();
  const join = inbox.inviteCount() + mt.myMatchCount() + lg.joinCount();
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
      rules: rulesView,
    },
    clock: clockPickView(mode === 'constructed' && homeFormat() === 'competitive' ? 'competitive' : mode),
    error: st.error,
    deckPicker: deckPickerView(),
    hasDeck: !!deck,
    competitive: competitiveCardView(signedIn, signedIn ? dk.competitiveDecks() : null),
    singleCard: sc.chosen(),
    leagueLive, challengeLive,
    badges: { alerts: inbox.inboxUnread(), join, updates: updatesUnseen() },
    slots: {
      league, challenge, queue, invites, yourMatches, leagueMatches,
      scpicker: singleCardPickerHtml(singleCardPickerView()),
      info: footHtml(),
      updates: updatesListHtml(),
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
    `<button class="elchip ${el}${d.els.includes(el) ? ' on' : ''}" data-btn="eltoggle" data-el="${el}">${elIcon(el)}${el}</button>`).join('')}
    ${button({ label: '🎲', variant: 'icon', title: `pick at random — any of the ${d.setCount}`, dataBtn: 'elrandom' })}
  </div>`;
}

/** the Create button: the page's one gold action */
const create = (label: string, p: { dataBtn: string; attrs?: Record<string, string | number | boolean | undefined>; disabled?: boolean; title?: string }): string =>
  button({ label, variant: 'action', className: 'homecreate', dataBtn: p.dataBtn, attrs: p.attrs, disabled: p.disabled, title: p.title });

function draftRowsHtml(v: HomeView): { rows: string; go: string } {
  const d = v.draft, k = d.k, r = d.rules;
  const picked = d.els.length === k;
  // Mode first: Beginner sets the elements, the cards and the values below it
  const rows = row('Mode', `<div class="homemode">${modeHtml(r)}${r.beginner ? `<span class="homemodehint">${esc(BEGINNER_HINT)}</span>` : ''}</div>`)
    + row('Clock', clockPickHtml(v.clock, { look: 'segmented' }))
    + row('Elements', segmented({
      ariaLabel: 'Elements', size: 'sm',
      options: [
        { label: 'Choose in the room', value: 'room', on: !d.fixedOpen, dataBtn: 'home-els', attrs: { 'data-pick': 'room' } },
        { label: 'Pick now', value: 'now', on: d.fixedOpen, dataBtn: 'home-els', attrs: { 'data-pick': 'now' } },
      ],
    }) + (d.fixedOpen ? elementPickHtml(d) : ''),
    d.fixedOpen ? '' : `You both pick the ${k === 3 ? 'three' : k === 2 ? 'two' : k} elements in the room.`)
    + row('Cards', cardsHtml(r))
    + row('Banned', bansHtml(r))
    // the numbers alone live in a sheet (owner: the modal is "only reserved
    // for changing the default 'value settings'")
    + row('Game values', `<div class="homerules"><span class="homerulessum">${r.values.length
      ? `<b>${esc(r.values.join(' · '))}</b>` : '<span class="dim">Standard values</span>'}</span>
      ${button({ label: 'Change…', size: 'sm', ...opens('rules') })}</div>`)
    + poolLineHtml(r);
  const custom = d.custom ? 'Create custom room' : 'Create room';
  const go = d.fixedOpen
    ? create(picked ? `${custom} · ${d.els.map(cap).join(' + ')}` : `Pick ${k} elements (${d.els.length}/${k})`, {
      dataBtn: 'newgame', attrs: { 'data-mode': 'draft', 'data-els': '1' },
      disabled: !picked || !!d.fixedError, title: picked && d.fixedError ? d.fixedError : undefined,
    })
    : create(custom, { dataBtn: 'newgame', attrs: { 'data-mode': 'draft' }, disabled: !!d.customError, title: d.customError });
  return { rows, go };
}

function constructedRowsHtml(v: HomeView): { rows: string; go: string } {
  const format = row('Format', segmented({
    ariaLabel: 'Format', size: 'sm',
    options: [
      { label: 'Casual', value: 'casual', on: v.format === 'casual', dataBtn: 'home-format', attrs: { 'data-format': 'casual' } },
      { label: 'Competitive', value: 'competitive', on: v.format === 'competitive', dataBtn: 'home-format', attrs: { 'data-format': 'competitive' } },
    ],
  }), v.format === 'competitive' ? 'A sideboard of up to 7, swapped between games. Players take each step in turn.' : '');
  if (v.format === 'competitive') {
    const c = v.competitive;
    if (!c.signedIn) {
      // it says so instead of disappearing: a match hangs off two accounts
      return {
        rows: format + `<div class="homeneedacct"><p>Competitive matches need an account, so the result can be kept.</p>
          ${button({ label: 'Sign in', variant: 'action', dataBtn: 'acct-open-auth' })}</div>`,
        go: '',
      };
    }
    const rows = format
      + row('Best of', segmented({
        ariaLabel: 'Best of', size: 'sm',
        options: ([1, 3] as const).map(n => ({
          label: `${n} game${n === 1 ? '' : 's'}`, value: String(n), on: c.bestOf === n, dataBtn: 'cc-bo', attrs: { 'data-bo': n },
        })),
      }))
      // docs/22 §6.1: the match clock — Default is the owner's 45 minutes each
      // for the whole match; the creator may override it (owner, 2026-11-03)
      + row('Clock', clockPickHtml(v.clock, { look: 'segmented' }))
      + row('Deck', ccDeckSelectHtml(c.decks, c.pick));
    return { rows, go: create(c.pick ? 'Create match' : 'Pick a deck first', { dataBtn: 'cc-new', disabled: !c.pick }) };
  }
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
      ${segmented({
        ariaLabel: 'Game type', full: true,
        options: [
          { label: 'Draft', value: 'draft', on: v.mode === 'draft', dataBtn: 'home-mode', attrs: { 'data-mode': 'draft' } },
          { label: 'Constructed', value: 'constructed', on: v.mode === 'constructed', dataBtn: 'home-mode', attrs: { 'data-mode': 'constructed' } },
        ],
      })}
      <p class="homeplaysub">${v.mode === 'draft'
        ? 'Draft from shared packs, then play with what you drafted.'
        : 'Bring a deck you built: 30 cards, at most 2 of each.'}</p>
    </div>
    <div class="homerows">${rows}</div>
    <div class="homeplayfoot">
      ${v.nameBox === null
        ? ''
        : `<label class="homename">Your name <input id="h-name" maxlength="24" value="${esc(v.nameBox)}" placeholder="(optional)"></label>`}
      ${v.error ? statusMessage({ tag: 'p', className: 'deckmsg', text: v.error }) : ''}
      <div class="homeactions">${join}${go}</div>
    </div>
  </section>`;
}

/** one of the three cards beside Play: the whole card opens its page (a
 * stretched button), and buttons inside it (Matchmaking's Join) still work */
function sideCardHtml(p: { kind: string; title: string; iconName: 'league' | 'challenge' | 'matchmaking'; dataBtn: string;
  live: boolean; bodyHtml: string; empty: string; open: string }): string {
  return `<section class="homeside homeside--${p.kind}${p.live ? '' : ' off'}" aria-label="${esc(p.title)}">
    <h2 class="homesidetitle">${icon(p.iconName)}<span>${esc(p.title)}</span>${p.live ? icon('chevron-right') : ''}</h2>
    <div class="homesidebody">${p.bodyHtml || `<p class="homesideempty">${esc(p.empty)}</p>`}</div>
    ${p.live ? `<button class="homesideopen" data-btn="${esc(p.dataBtn)}" aria-label="${esc(p.open)}"></button>` : ''}
  </section>`;
}

function sideHtml(v: HomeView): string {
  const s = v.slots;
  return `<div class="homesides">
    ${sideCardHtml({ kind: 'league', title: 'League', iconName: 'league', dataBtn: 'nav-league', live: v.leagueLive,
      bodyHtml: s.league, empty: v.leagueLive ? 'Seasons, standings and your matches.' : 'No league running right now.', open: 'Open the League page' })}
    ${sideCardHtml({ kind: 'challenge', title: 'Challenge', iconName: 'challenge', dataBtn: 'nav-challenge', live: v.challengeLive,
      bodyHtml: s.challenge, empty: v.challengeLive ? 'Past weeks and their boards.' : 'No challenge this week.', open: 'Open the weekly challenge' })}
    ${sideCardHtml({ kind: 'queue', title: 'Matchmaking', iconName: 'matchmaking', dataBtn: 'queue-open', live: true,
      bodyHtml: s.queue, empty: 'Find an opponent.', open: 'Open matchmaking' })}
  </div>`;
}

function bottomHtml(v: HomeView): string {
  const n = v.badges.updates;
  return shellBar({
    className: 'homebottom',
    startHtml: iconButton({ label: 'Algomancy Online (Unofficial Client)', icon: 'info', layout: 'inline', className: 'homeinfo',
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
    + sec('League matches', s.leagueMatches);
  return `<label class="homecodelabel" for="h-code">Room code</label>
    <div class="joinrow homecode">
      <input id="h-code" placeholder="CODE" maxlength="8" autocapitalize="characters"
        spellcheck="false" style="text-transform:uppercase">
      ${button({ label: 'Join', variant: 'action', dataBtn: 'joincode' })}
    </div>
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
    endHtml: toolsHtml({ signedIn: v.signedIn, alerts: v.badges.alerts }, TOOL_NAMES, {
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
    mainHtml: `<div class="homemain">${playHtml(v)}${sideHtml(v)}</div>${sheetHtml(v)}`,
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

/** Paint the home screen into `app` and wire it. `rerender` is main.ts's
 * renderHome — the router, which comes back here when no other page owns #app. */
export function paintHome(app: HTMLElement, st: HomeState, rerender: () => void): void {
  homeRerender = rerender;
  installHomeListeners();
  const typed = HOME_TYPED.map(id => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value);
  const pasteOpen = (document.querySelector('.homepage .deckpaste') as HTMLDetailsElement | null)?.open ?? false;
  const caret = caretIn(HOME_CARET);
  app.innerHTML = homeHtml(homeView(st));
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
    patchHomeBadges(inbox.inboxUnread(), inbox.inviteCount() + mt.myMatchCount() + lg.joinCount());
  });
  // BL-01: the at-a-glance count. Started HERE rather than at boot because
  // this is the only screen that shows it, and an idle tab on a board should
  // not be asking the server who is queueing every five seconds. Idempotent.
  mm.startCountsPoll();
}
