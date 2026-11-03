/* THE HOME SCREEN (docs/07 §2): new game / join / learn.
 *
 * (There was a "Practice demo" button in this row until 2026-09-05; the
 * owner had it removed — "It sucks". The `?demo=1` route it opened is still
 * there for the tests and the screenshot rig; it is just not offered.)
 *
 * Three cards abreast, not one 340px column. The old stack put "join with a
 * code" and the two solo modes below the fold on an ordinary window, and it
 * sat centred in the LEFT half of the board grid with the rail's width blank
 * beside it (playtest 2026-08-21). Abreast, the whole menu is one screenful
 * and each way in states what it is before it asks for anything.
 *
 * Moved out of main.ts in the design-system round, 2026-11-03, and split the
 * way docs/23 § Target structure asks: homeView() gathers the state,
 * homeHtml(view) draws it and touches nothing else, paintHome() puts it on the
 * page and wires it. main.ts renderHome() is still the ROUTER — the chain of
 * "does another page own #app right now?" checks — and calls paintHome() when
 * none does.
 *
 * What is still in main.ts: the home screen's buttons (handlePregameButton:
 * eltoggle, elrandom, clockpick, newgame, joincode, deckimport*, …), because
 * they write main.ts state (`ui.homeEls`, `uiError`) and open the room.
 * TODO(ds): view/html split: move handlePregameButton here once `uiError` and
 * the element pick have a home outside main.ts's UiState.
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
import { updatesHtml, wireUpdates } from '../updates.ts';
import { button, statusMessage } from '../components/index.ts';
import { chosenDeck, elIcon as elIconOf, esc } from '../util.ts';
import { caretIn, restoreCaret } from './caret.ts';
import { chosenClockMs, clockPickHtml, clockPickView, type ClockPickView } from './clockpick.ts';
import { customRulesHtml, customRulesView } from './customrules.ts';
import { deckPickerHtml, deckPickerView, wireDeckPicker, type DeckPickerView } from './deckpicker.ts';
import { singleCardPickerHtml, singleCardPickerView } from './singlecard.ts';
import { competitiveCardHtml, competitiveCardView, yourMatchesHtml, yourMatchesView } from './match.ts';
import { queueStripHtml, queueStripView } from './queue.ts';

const elIcon = (name: string): string => elIconOf(name, name);

/* The home screen's typing boxes that no state remembers. The home screen is
 * repainted whole by things the player did not do — the matchmaking count
 * changing (queue.ts's 5s poll), a friend coming online, the profile landing —
 * and each repaint used to rebuild these four empty, mid-word, and drop the
 * focus (found 2026-11-02: all four wiped by one queue poll). Their text is
 * carried across the repaint and the caret put back (caretIn/restoreCaret).
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

/* ── the Constructed card's Options fold ──────────────────────────────── */

/** #191: the Constructed card's Options fold — the clock, and nothing else
 * yet. Closed by default, like Custom rules on the draft card. */
let homeOptionsOpen = false;

export interface ConstructedOptionsView {
  /** the fold is open (it remembers being opened across repaints) */
  open: boolean;
  /** the bank a constructed game would get, in ms (0 = off) — the summary */
  ms: number;
  clock: ClockPickView;
}

export function constructedOptionsHtml(v: ConstructedOptionsView): string {
  const ms = v.ms;
  return `<details class="fixedtrio homeoptions" data-homeoptions ${v.open ? 'open' : ''}>
    <summary>Options <span class="dim">— clock ${ms ? `${Math.round(ms / 60_000)}m` : 'off'}</span></summary>
    ${clockPickHtml(v.clock)}
  </details>`;
}

/* ── Single Card Duel, tucked under the Constructed card ──────────────── */

/**
 * CR D8.2 — SINGLE CARD DUEL, tucked under the Constructed card.
 *
 * The owner, 2026-09-18: a goofy thought-experiment format that should be "not
 * easy to start. But not tooo hidden" — so it is a closed disclosure at the
 * foot of Constructed rather than a card of its own, and it remembers being
 * opened (a pick repaints the home screen, and must not snap it shut).
 */
let singleDuelOpen = false;

export interface SingleDuelView {
  open: boolean;
  /** the card picked so far (ui/singlecard.ts), or null */
  card: string | null;
  /** pages/singlecard.ts singleCardPickerHtml() — a slot */
  picker: string;
}

export function singleDuelHtml(v: SingleDuelView): string {
  const card = v.card;
  return `<details class="fixedtrio singleduel" data-singleduel ${v.open ? 'open' : ''}>
    <summary>…or something sillier: <b>Single Card Duel</b></summary>
    <p class="cardsub">Thirty copies of one card. Your opponent picks theirs blind. It rates
      the cards, not you — see the ${button({ label: 'card ladder', variant: 'link', className: 'linkbtn', dataBtn: 'meta-ladder' })}.</p>
    ${v.picker}
    <button data-btn="newgame" data-mode="constructed" data-single="1" ${card ? '' : 'disabled'}>
      ${card ? `New single card duel — ${esc(card)}` : 'pick a card first'}</button>
  </details>`;
}

function wireSingleDuel(): void {
  const root = document.querySelector('[data-singleduel]') as HTMLDetailsElement | null;
  root?.addEventListener('toggle', () => { singleDuelOpen = root.open; });
  sc.wire();
}

/* ── the page ─────────────────────────────────────────────────────────── */

/** what main.ts owns and hands in: the element pick and the last error */
export interface HomeState {
  /** the elements picked for a fixed draft (main.ts `ui.homeEls`) */
  els: readonly string[];
  /** the "pick the trio now" fold is open (main.ts `ui.homeFixedTrio`) */
  fixedOpen: boolean;
  /** main.ts `uiError`: a refused New game, shown on the Live draft card */
  error: string;
}

/** The markup other modules draw into the page, already drawn. They read their
 * own module state (and some fetch while drawing), so they arrive as strings:
 * a story or a test passes '' or a stub. */
export interface HomeSlots {
  acctBar: string;        // account.ts barHtml — the identity bar
  leagueNav: string;      // league.ts navButtonHtml
  challengeNav: string;   // challenge.ts navButtonHtml
  leagueBanner: string;   // league.ts homeBannerHtml — fetches while drawing
  queueStrip: string;     // pages/queue.ts queueStripHtml — the matchmaking strip
  yourMatches: string;    // pages/match.ts yourMatchesHtml — paused/running Competitive matches
  customRules: string;    // pages/customrules.ts customRulesHtml, with the draft clock inside
  competitiveCard: string; // pages/match.ts competitiveCardHtml
  challengeCard: string;  // challenge.ts homeCardHtml — fetches while drawing
  updates: string;        // updates.ts updatesHtml — the Recent updates band, after .homepage
}

export interface HomeView {
  /** the "Your name" box's value, or null when it is not drawn — signed in, or
   * a stored token still resolving (it would flash "Playing signed out") */
  nameBox: string | null;
  /** signed in: the 🗂 My decks button */
  signedIn: boolean;
  draft: {
    /** how many elements a fixed pick wants (Custom rules may change it) */
    k: number;
    els: readonly string[];
    fixedOpen: boolean;
    /** how many element sets the 🎲 picks among */
    setCount: number;
    /** the server's verdict on the rules for a FIXED pick, when one is refused */
    fixedError: string | undefined;
    /** …and for the plain New live draft */
    customError: string | undefined;
    /** custom rules are set: "New custom live draft" */
    custom: boolean;
  };
  /** the last refusal (main.ts `uiError`), or '' */
  error: string;
  deckPicker: DeckPickerView;
  options: ConstructedOptionsView;
  /** a deck is chosen: New constructed game is live */
  hasDeck: boolean;
  singleDuel: SingleDuelView;
  slots: HomeSlots;
}

/** Gather everything the home screen shows. The slot calls run in the order
 * the page used to call them while drawing (some of them fetch). */
export function homeView(st: HomeState): HomeView {
  const user = acct.currentUser();
  const name = user ? user.username : (localStorage.getItem('algoName') ?? '');
  const deck = chosenDeck();
  // BL-43: the Custom rules panel decides how many elements a fixed pick wants,
  // and previews the server's verdict on the rules for both Create buttons
  const k = crp.elementCount();
  const fixedPick = st.fixedOpen && st.els.length === k ? st.els : null;
  const customVerdict = crp.verdict(null);
  const fixedVerdict = crp.verdict(st.els.length === k ? st.els : null);
  const acctBar = acct.barHtml();
  const leagueNav = lg.navButtonHtml();
  const challengeNav = chal.navButtonHtml();
  const leagueBanner = lg.homeBannerHtml();
  const queueStrip = queueStripHtml(queueStripView());
  const yourMatches = yourMatchesHtml(yourMatchesView());
  const setCount = crp.setCount();
  const customRules = customRulesHtml(customRulesView(fixedPick, clockPickHtml(clockPickView('draft'))));
  const deckPicker = deckPickerView();
  const options: ConstructedOptionsView = {
    open: homeOptionsOpen, ms: chosenClockMs('constructed'), clock: clockPickView('constructed'),
  };
  const singleDuel: SingleDuelView = { open: singleDuelOpen, card: sc.chosen(), picker: singleCardPickerHtml(singleCardPickerView()) };
  const competitiveCard = competitiveCardHtml(competitiveCardView(!!acct.token(), acct.token() ? dk.competitiveDecks() : null));
  const challengeCard = chal.homeCardHtml();
  const updates = updatesHtml();
  return {
    nameBox: user || acct.resolvingUser() ? null : name,
    signedIn: !!user,
    draft: {
      k, els: st.els, fixedOpen: st.fixedOpen, setCount,
      fixedError: fixedVerdict.error, customError: customVerdict.error, custom: !!customVerdict.rules,
    },
    error: st.error,
    deckPicker,
    options,
    hasDeck: !!deck,
    singleDuel,
    slots: {
      acctBar, leagueNav, challengeNav, leagueBanner, queueStrip, yourMatches,
      customRules, competitiveCard, challengeCard, updates,
    },
  };
}

/** The home screen's markup. Pure: no DOM, no globals, no module state —
 * everything it shows comes in through `v`. The Recent updates band is drawn
 * AFTER .homepage, never inside it (test 323 §5). */
export function homeHtml(v: HomeView): string {
  const s = v.slots, d = v.draft;
  const k = d.k;
  return `<div class="homepage">
    <div class="homehead">
      <h1 class="homelogo">ALGOMANCY</h1>
      <div class="homeident">
        ${v.nameBox === null
          ? ''
          : `<label class="namerow">Your name <input id="h-name" maxlength="24" value="${esc(v.nameBox)}" placeholder="(optional)"></label>`}
        ${s.acctBar}
        ${v.signedIn ? button({ label: '🗂 My decks', className: 'homedecks', dataBtn: 'deck-openpage' }) : ''}
        ${button({ label: '📖 How to play', className: 'homedecks', attrs: { 'data-help': 'rules' } })}
        ${button({ label: '🔍 Cards', className: 'homedecks', dataBtn: 'cards-openpage' })}
        ${button({ label: '🏆 Metagame', className: 'homedecks', dataBtn: 'meta-openpage' })}
        ${s.leagueNav}
        ${s.challengeNav}
      </div>
    </div>

    ${s.leagueBanner}

    ${s.queueStrip}

    ${s.yourMatches}

    <div class="homegrid">
      <div class="homecard offer">
        <h2>Live draft</h2>
        <p class="cardsub">Draft from shared packs, then play. You pick the ${k === 3 ? 'three' : k}
          elements together once you are both in the room.</p>
        <details class="fixedtrio" ${d.fixedOpen ? 'open' : ''}>
          <summary>…or pick the ${k === 3 ? 'trio' : 'elements'} now and skip the lobby</summary>
          <div class="elrow">${ALL_ELEMENTS.map(el =>
            `<button class="elchip ${el}${d.els.includes(el) ? ' on' : ''}" data-btn="eltoggle" data-el="${el}">${elIcon(el)}${el}</button>`).join('')}
            ${button({ label: '🎲', variant: 'icon', title: `pick at random — any of the ${d.setCount}`, dataBtn: 'elrandom' })}
          </div>
          <button data-btn="newgame" data-mode="draft" data-els="1" ${d.els.length === k && !d.fixedError ? '' : 'disabled'}
            ${d.fixedError && d.els.length === k ? `title="${esc(d.fixedError)}"` : ''}>
            ${d.els.length === k ? `Start with ${d.els.join(' + ')}` : `pick ${k} of the ${ALL_ELEMENTS.length} (${d.els.length}/${k})`}</button>
        </details>
        ${s.customRules}
        <div class="spacer"></div>
        ${v.error ? statusMessage({ tag: 'p', className: 'deckmsg', text: v.error }) : ''}
        <button class="cta primary" data-btn="newgame" data-mode="draft" ${d.customError ? `disabled title="${esc(d.customError)}"` : ''}>
          ${d.custom ? 'New custom live draft' : 'New live draft'}</button>
      </div>

      <div class="homecard offer deckpicker">
        <h2>Constructed</h2>
        <p class="cardsub">A deck you built: 30 cards, max 2 of each.</p>
        ${deckPickerHtml(v.deckPicker)}
        ${constructedOptionsHtml(v.options)}
        <div class="spacer"></div>
        <button class="cta primary" data-btn="newgame" data-mode="constructed" ${v.hasDeck ? '' : 'disabled'}>
          New constructed game${v.hasDeck ? '' : ' — pick a deck first'}</button>
        ${singleDuelHtml(v.singleDuel)}
      </div>

      ${s.competitiveCard}

      <div class="homecard">
        <h2>Join a game</h2>
        <p class="cardsub">Enter the room code you were sent.</p>
        <div class="joinrow">
          <input id="h-code" placeholder="CODE" maxlength="8" autocapitalize="characters"
            spellcheck="false" style="text-transform:uppercase">
          ${button({ label: 'Join', dataBtn: 'joincode' })}
        </div>
        <div class="spacer"></div>
        <div class="homesep">
          <div class="zonelabel">On your own</div>
          <div class="homesolo">
            ${button({ label: 'Learn to play', attrs: { 'data-learn': 'menu' } })}
          </div>
        </div>
      </div>
      ${s.challengeCard}
    </div>

    <p class="homefoot">To play a friend, start a game and invite them, or send them the code.</p>
  </div>
  ${s.updates}`;
}

/** Paint the home screen into `app` and wire it. `rerender` is main.ts's
 * renderHome — the router, which comes back here when no other page owns #app. */
export function paintHome(app: HTMLElement, st: HomeState, rerender: () => void): void {
  const typed = HOME_TYPED.map(id => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value);
  const pasteOpen = (document.querySelector('.homepage .deckpaste') as HTMLDetailsElement | null)?.open ?? false;
  const caret = caretIn(HOME_CARET);
  app.innerHTML = homeHtml(homeView(st));
  const codeInput = document.getElementById('h-code') as HTMLInputElement | null;
  codeInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') (document.querySelector('[data-btn="joincode"]') as HTMLElement).click();
  });
  wireDeckPicker(rerender);
  mt.wireDeckSelect(rerender);   // docs/22 §6.1: the Competitive card's picker
  // docs/22 §5.6: a paused or running match is always one button away
  mt.loadMyMatches(acct.token() ? acct.authHeaders(false) : null, rerender);
  crp.wirePanel();   // BL-43
  wireSingleDuel();  // CR D8.2
  // what was typed, and where, survives the repaint (HOME_TYPED)
  HOME_TYPED.forEach((id, i) => {
    const box = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (box && typed[i] !== undefined) box.value = typed[i]!;
  });
  if (pasteOpen) { const d = document.querySelector('.homepage .deckpaste') as HTMLDetailsElement | null; if (d) d.open = true; }
  restoreCaret(caret);
  const opts = document.querySelector('[data-homeoptions]') as HTMLDetailsElement | null;
  opts?.addEventListener('toggle', () => { homeOptionsOpen = opts.open; });   // #191
  wireUpdates();
  // BL-01: the at-a-glance count. Started HERE rather than at boot because
  // this is the only screen that shows it, and an idle tab on a board should
  // not be asking the server who is queueing every five seconds. Idempotent.
  mm.startCountsPoll();
}
