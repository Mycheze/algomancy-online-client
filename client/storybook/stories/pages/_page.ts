import { DEAL_DEFAULTS } from '../../../engine/src/draftdeal.ts';
import type { CustomRules } from '../../../ui/customrules.ts';
import type { CustomRulesView } from '../../../ui/pages/customrules.ts';

/* What the page stories share: the frame a page is drawn in, and the made-up
 * markup for the slots other modules fill on the live site (the account bar,
 * the league and challenge buttons). A story drives a page's pure `…Html(view)`
 * with a made-up view; nothing here reads the account, the server or storage.
 *
 * Not a story (the leading `_`): Storybook's glob wants `*.stories.ts`. */

/** a page as #app holds it off the board: plain block flow, the page owns its width */
export const page = (html: string): string => `<div id="app">${html}</div>`;

/** an overlay (position: fixed) kept inside its story, at the height it needs */
export const overlay = (html: string, height = 760): string =>
  `<div style="transform:translateZ(0);height:${height}px;position:relative">${html}</div>`;

/** the account bar (account.ts barHtml), signed out and signed in */
export const ACCT_OUT = `<div class="acctbar out">
      <span class="accthint">Playing signed out — nothing is recorded.</span>
      <button data-btn="acct-open-auth">Log in / Sign up</button>
    </div>`;
export const ACCT_IN = `<button class="acctbar in" data-btn="acct-open-profile" title="your profile, stats and achievements">
    <span class="acctwho">Playing as <span class="acctname">Quillon</span></span>
    <span class="acctrec">4W–2L</span>
  </button>`;

/** the nav buttons league.ts and challenge.ts draw */
export const LEAGUE_NAV = '<button class="homedecks" data-btn="nav-league">🏅 League</button>';
export const CHALLENGE_NAV = '<button class="homedecks" data-btn="nav-challenge">🧩 Challenge</button>';

/** inbox.ts roomFriendsHtml stands in as a hint line */
export const FRIENDS = '<p class="hint">(the Invite a friend panel — ui/inbox.ts)</p>';

/** a share link, as the rooms build it */
export const LINK = 'https://algomancy.online/?ws=1&room=QXZZ&seat=1&mode=constructed';

/** a few decks, as the deck picker lists them */
export const DECKS = [
  { id: 'd1', name: 'Ember Rush', author: 'Caleb', url: 'https://algomancer.cc/d/1', cards: Array(30).fill('Ignis Sprite') },
  { id: 'd2', name: 'Tidal Control', author: 'you', cards: Array(30).fill('Ignis Sprite') },
];

/** a standard game's rules, as the Custom rules panel holds them */
export const STANDARD_RULES = { ...DEAL_DEFAULTS, simpleOnly: false, query: '', bans: [], preset: null } as unknown as CustomRules;

/** the Custom rules panel closed, with nothing set — what the home screen draws by default */
export const RULES_STANDARD: CustomRulesView = {
  open: false, active: null, rules: STANDARD_RULES, summary: [], advancedOpen: false, banDraft: '',
  deckCount: 528, simpleCount: 312, suggestions: '', queryNote: 'Same syntax as the 🔍 Cards page.', pool: '', extra: '',
};
