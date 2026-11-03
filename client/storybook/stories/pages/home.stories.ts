import { homeHtml, type HomeView } from '../../../ui/pages/home.ts';
import { customRulesHtml } from '../../../ui/pages/customrules.ts';
import { clockPickHtml } from '../../../ui/pages/clockpick.ts';
import { competitiveCardHtml, yourMatchesHtml } from '../../../ui/pages/match.ts';
import { queueStripHtml } from '../../../ui/pages/queue.ts';
import { singleCardPickerHtml } from '../../../ui/pages/singlecard.ts';
import { updatesHtml, UPDATES } from '../../../ui/updates.ts';
import { ACCT_IN, ACCT_OUT, CHALLENGE_NAV, DECKS, LEAGUE_NAV, page, RULES_STANDARD } from './_page.ts';

/** the home screen as a signed-out visitor first sees it */
function view(over: Partial<HomeView> = {}): HomeView {
  return {
    nameBox: '',
    signedIn: false,
    draft: { k: 3, els: [], fixedOpen: false, setCount: 35, fixedError: undefined, customError: undefined, custom: false },
    error: '',
    deckPicker: { current: null, signedIn: false, mine: [], defaults: DECKS, msg: '' },
    options: { open: false, ms: 45 * 60_000, clock: { mode: 'constructed', auto: true, now: 45 * 60_000, byModeMin: 45 } },
    hasDeck: false,
    singleDuel: { open: false, card: null, picker: '' },
    slots: {
      acctBar: ACCT_OUT, leagueNav: LEAGUE_NAV, challengeNav: CHALLENGE_NAV, leagueBanner: '',
      queueStrip: queueStripHtml({ counts: { total: 0, byMode: { constructed: 0, draft: 0 } }, openGames: [] }),
      yourMatches: '',
      customRules: customRulesHtml({ ...RULES_STANDARD, extra: clockPickHtml({ mode: 'draft', auto: true, now: 60 * 60_000, byModeMin: 60 }) }),
      competitiveCard: competitiveCardHtml({ signedIn: false, decks: null, bestOf: 3, pick: null }),
      challengeCard: '',
      updates: updatesHtml(UPDATES, UPDATES.length - 2),
    },
    ...over,
  };
}

const signedIn = (): HomeView => {
  const v = view();
  const decks = [{ id: 'd1', name: 'Ember Rush (Competitive)', error: null }];
  return {
    ...v, nameBox: null, signedIn: true,
    deckPicker: { current: DECKS[0]!, signedIn: true, mine: DECKS, defaults: null, msg: '' },
    hasDeck: true,
    slots: {
      ...v.slots, acctBar: ACCT_IN,
      queueStrip: queueStripHtml({
        counts: { total: 1, byMode: { constructed: 0, draft: 1 } },
        openGames: [{ id: 'g1', username: 'Rashi', mode: 'draft', ranked: true, rating: 1490, waitedMs: 42_000 }],
      }),
      yourMatches: yourMatchesHtml({ rows: [{ room: 'PAUS', seat: 1, text: 'vs <b>Rashi</b> · you lead 1–0 · paused 2 days ago', button: 'Resume' }] }),
      competitiveCard: competitiveCardHtml({ signedIn: true, decks, bestOf: 3, pick: decks[0]! }),
    },
  };
};

export default {
  title: 'Pages/Home',
  parameters: { layout: 'fullscreen' },
};

export const SignedOut = { render: () => page(homeHtml(view())) };
export const SignedIn = { render: () => page(homeHtml(signedIn())) };
export const FoldsOpen = {
  name: 'Folds open (fixed trio, options, single card duel)',
  render: () => {
    const v = signedIn();
    return page(homeHtml({
      ...v,
      draft: { ...v.draft, fixedOpen: true, els: ['fire', 'wood', 'water'] },
      options: { ...v.options, open: true },
      singleDuel: {
        open: true, card: 'Ignis Sprite',
        picker: singleCardPickerHtml({ card: 'Ignis Sprite', art: '', makesUnits: true, copies: 30, draft: '', suggestions: '', deckCount: 528 }),
      },
    }));
  },
};
export const Refused = {
  name: 'A refused New game',
  render: () => page(homeHtml(view({ error: 'the server refused these rules: 2 elements, packs of 15 leaves too few cards' }))),
};
