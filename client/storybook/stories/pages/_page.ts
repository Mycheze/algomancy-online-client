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

/** The home's slots other modules fill (docs/24, 2026-11-03), as they draw
 * them: the League and Challenge cards' glances, the Matchmaking glance with
 * an open game's Join, and the Join sheet's invites and league matches. */
export const LEAGUE_GLANCE = `<div class="lgglance">
    <div class="lgglname">November Constructed</div>
    <div class="lgglphase">Competitive · Week 2 of 3</div>
    <div class="lgglstate in">✓ you're in</div>
    <div class="lgglnext">Next match: Sun 9 Nov, 18:00</div>
  </div>`;
export const CHALLENGE_GLANCE = `<div class="chglance">
    <div class="chgltitle">Full House</div>
    <div class="chglgoal">Win with five units on the battlefield</div>
    <div class="chglmeta">2 days left · your best: 7 turns (#3 fastest)</div>
  </div>`;
export const QUEUE_GLANCE = `<div class="qglance">
    <span class="qglcount">Nobody is waiting — be the first.</span>
  </div>`;
export const QUEUE_GLANCE_LIVE = `<div class="qglance">
    <span class="qglcount live">1 waiting · Live draft 1</span>
    <ul class="qopen">
    <li class="qopenrow">
      <span class="qopenwho">Rashi</span>
      <span class="qopenwhat">Live draft · ranked · 1490</span>
      <span class="qopenwait">waiting 42s</span>
      <button class="qopenjoin" data-btn="queue-join-open" data-id="g1"
        >Join →</button>
    </li></ul>
  </div>`;
export const INVITES = `<div class="inviterows"><div class="inviterow">
    <span><b>Rashi</b> invites you to a live draft.</span>
    <span class="invbtns">
      <button class="primary" data-inbox="join" data-id="i1">Join</button>
      <button data-inbox="decline" data-id="i1">No thanks</button>
    </span>
  </div></div>`;
export const LEAGUE_MATCHES = `<div class="lgjoinrows"><div class="lgjoinrow">
    <span>vs <b>Cy</b> <span class="dim">· November Constructed · Sun 9 Nov, 18:00 ✓</span></span>
    <button class="primary" data-btn="lg-play" data-season="s1" data-match="m1">Play</button>
  </div></div>`;
export const YOUR_MATCHES = `<div class="ccmine"><div class="zonelabel">Your matches</div>
    <div class="ccmatchrow"><span>vs <b>Rashi</b> · you lead 1–0 · paused 2 days ago</span>
        <button class="primary" data-btn="cc-open" data-room="PAUS" data-seat="1">Resume</button></div>
  </div>`;

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
