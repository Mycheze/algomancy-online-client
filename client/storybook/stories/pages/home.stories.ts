import { homeHtml, type HomeView } from '../../../ui/pages/home.ts';
import { clockPickHtml } from '../../../ui/pages/clockpick.ts';
import { customRulesHtml } from '../../../ui/pages/customrules.ts';
import { singleCardPickerHtml } from '../../../ui/pages/singlecard.ts';
import { footHtml } from '../../../ui/legal.ts';
import { updatesListHtml, UPDATES } from '../../../ui/updates.ts';
import {
  CHALLENGE_GLANCE, DECKS, INVITES, LEAGUE_GLANCE, LEAGUE_MATCHES, page, QUEUE_GLANCE, QUEUE_GLANCE_LIVE, RULES_STANDARD,
  YOUR_MATCHES,
} from './_page.ts';

/* The home screen (client/docs/24-redesign/, 2026-11-03): one window, a
 * toolbar, the Play card with three lighter cards beside it, a bottom bar,
 * and the sheets. Each story is a made-up HomeView; the slots other modules
 * fill are stand-ins from _page.ts. */

const ME = { username: 'Quillon', favoriteElement: 'water', games: 6, wins: 4, losses: 2, unresolved: 0, streak: 2 };
const CC_DECKS = [
  { id: 'd1', name: 'Ember Rush (Competitive)', error: null },
  { id: 'd2', name: 'Tidal Control', error: 'a sideboard holds at most 7 cards (got 9)' },
];

/** the home screen as a signed-out visitor first sees it */
function view(over: Partial<HomeView> = {}): HomeView {
  return {
    account: { resolving: false, me: null },
    nameBox: '',
    signedIn: false,
    mode: 'draft',
    format: 'casual',
    sheet: null,
    draft: {
      k: 3, els: [], fixedOpen: false, setCount: 35, fixedError: undefined, customError: undefined, custom: false, rulesSummary: [],
    },
    clock: { mode: 'draft', auto: true, now: 60 * 60_000, byModeMin: 60 },
    error: '',
    deckPicker: { current: DECKS[0]!, signedIn: false, mine: [], defaults: DECKS, msg: '' },
    hasDeck: true,
    competitive: { signedIn: false, decks: null, bestOf: 3, pick: null },
    singleCard: null,
    leagueLive: true,
    challengeLive: true,
    badges: { alerts: 0, join: 0, updates: 2 },
    slots: {
      league: LEAGUE_GLANCE, challenge: CHALLENGE_GLANCE, queue: QUEUE_GLANCE,
      invites: '', yourMatches: '', leagueMatches: '',
      customRules: customRulesHtml(RULES_STANDARD, { bare: true }),
      scpicker: singleCardPickerHtml({ card: null, art: '', makesUnits: true, copies: 30, draft: '', suggestions: '', deckCount: 528 }),
      info: footHtml(),
      updates: updatesListHtml(UPDATES, UPDATES.length - 2),
    },
    ...over,
  };
}

/** signed in, on Draft, with a paused match and an invite waiting */
function signedIn(over: Partial<HomeView> = {}): HomeView {
  const v = view();
  return {
    ...v,
    account: { resolving: false, me: ME },
    nameBox: null, signedIn: true,
    deckPicker: { current: DECKS[0]!, signedIn: true, mine: DECKS, defaults: null, msg: '' },
    competitive: { signedIn: true, decks: CC_DECKS, bestOf: 3, pick: CC_DECKS[0]! },
    badges: { alerts: 3, join: 3, updates: 2 },
    slots: { ...v.slots, queue: QUEUE_GLANCE_LIVE, invites: INVITES, yourMatches: YOUR_MATCHES, leagueMatches: LEAGUE_MATCHES },
    ...over,
  };
}

const constructed = (v: HomeView, format: HomeView['format']): HomeView =>
  ({ ...v, mode: 'constructed', format, clock: { mode: 'constructed', auto: true, now: 45 * 60_000, byModeMin: 45 } });

export default {
  title: 'Pages/Home',
  parameters: { layout: 'fullscreen' },
};

export const SignedOut = { name: 'Signed out', render: () => page(homeHtml(view())) };
export const SigningIn = {
  name: 'Signing in (a stored token resolving)',
  render: () => page(homeHtml(view({ account: { resolving: true, me: null }, nameBox: null }))),
};
export const SignedIn = { name: 'Signed in (Draft)', render: () => page(homeHtml(signedIn())) };
export const PickNow = {
  name: 'Draft: elements picked now',
  render: () => {
    const v = signedIn();
    return page(homeHtml({ ...v, draft: { ...v.draft, fixedOpen: true, els: ['fire', 'wood', 'water'] } }));
  },
};
export const PickNowCustom = {
  name: 'Draft: custom rules, two elements picked now',
  render: () => {
    const v = signedIn();
    return page(homeHtml({
      ...v, draft: { ...v.draft, k: 2, fixedOpen: true, els: ['fire'], custom: true, rulesSummary: ['2 elements', 'Simple cards only', 'Packs of 5'] },
    }));
  },
};
export const ConstructedCasual = { name: 'Constructed: casual', render: () => page(homeHtml(constructed(signedIn(), 'casual'))) };
export const ConstructedCasualSignedOut = {
  name: 'Constructed: casual, signed out (the bundled decks)',
  render: () => page(homeHtml(constructed(view(), 'casual'))),
};
export const ConstructedCompetitive = {
  name: 'Constructed: competitive',
  render: () => page(homeHtml(constructed(signedIn(), 'competitive'))),
};
export const CompetitiveSignedOut = {
  name: 'Constructed: competitive, signed out',
  render: () => page(homeHtml(constructed(view(), 'competitive'))),
};
export const NothingRunning = {
  name: 'No league, no challenge, nobody queueing',
  render: () => page(homeHtml(view({ leagueLive: false, challengeLive: false, slots: { ...view().slots, league: '', challenge: '' } }))),
};
export const Refused = {
  name: 'A refused Create room',
  render: () => page(homeHtml(signedIn({ error: 'the server refused these rules: 2 elements, packs of 15 leaves too few cards' }))),
};

export const JoinSheet = {
  name: 'Sheet: Join a room (invites, your matches, league)',
  render: () => page(homeHtml(signedIn({ sheet: 'join' }))),
};
export const JoinSheetEmpty = {
  name: 'Sheet: Join a room, nothing waiting',
  render: () => page(homeHtml(view({ sheet: 'join' }))),
};
export const InfoSheet = { name: 'Sheet: the client info', render: () => page(homeHtml(view({ sheet: 'info' }))) };
export const UpdatesSheet = { name: 'Sheet: updates', render: () => page(homeHtml(signedIn({ sheet: 'updates' }))) };
export const CustomRulesSheet = { name: 'Sheet: custom rules', render: () => page(homeHtml(signedIn({ sheet: 'rules' }))) };
export const ImportSheet = {
  name: 'Sheet: import a deck (signed out)',
  render: () => page(homeHtml(constructed(view({ sheet: 'import' }), 'casual'))),
};
export const SingleDuelSheet = {
  name: 'Sheet: Single Card Duel',
  render: () => page(homeHtml(constructed(signedIn({
    sheet: 'single', singleCard: 'Ignis Sprite',
    slots: { ...signedIn().slots, scpicker: singleCardPickerHtml({ card: 'Ignis Sprite', art: '', makesUnits: true, copies: 30, draft: '', suggestions: '', deckCount: 528 }) },
  }), 'casual'))),
};
export const AlertsSignIn = { name: 'Sheet: alerts, signed out', render: () => page(homeHtml(view({ sheet: 'alerts-signin' }))) };

/** the clock picker in both its looks: the Play card's segmented row, and the
 * chips the picker draws anywhere else */
export const ClockPicker = {
  name: 'Clock picker: the Play card row, and the chips',
  render: () => page(`<div style="padding:24px;display:flex;flex-direction:column;gap:16px;max-width:560px">
    ${clockPickHtml({ mode: 'draft', auto: true, now: 60 * 60_000, byModeMin: 60 }, { look: 'segmented' })}
    ${clockPickHtml({ mode: 'constructed', auto: false, now: 0, byModeMin: 45 }, { look: 'segmented' })}
    ${clockPickHtml({ mode: 'constructed', auto: false, now: 45 * 60_000, byModeMin: 45 })}
  </div>`),
};
