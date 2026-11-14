/* 1340 — THE WAY IN (docs/25 §10, decision 12), DOM-free.
 *
 * §1 the home's fourth card, "Cube draft": the whole card opens the cube page (nav-cube), its glass
 *    lists my events; with none it says what a cube is
 * §2 the Join sheet lists "Your cube events" with their buttons; the code box takes an event code
 * §3 the glance and the rows themselves
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeHtml, type HomeView } from '../pages/home.ts';
import { cubeGlanceHtml, cubeJoinRowsHtml } from '../pages/cube.ts';
import type { CubeMine } from '../../server/cube-types.ts';
import { DEAL_DEFAULTS } from '../../engine/src/draftdeal.ts';
import type { CustomRules } from '../customrules.ts';

const ART = { src: 'a.jpg', card: 'A', focusY: 30 };
function view(over: Partial<HomeView> = {}): HomeView {
  return {
    account: { resolving: false, me: null }, nameBox: '', signedIn: true, mode: 'draft', format: 'casual', sheet: null,
    draft: { k: 3, els: [], fixedOpen: false, setCount: 35, fixedError: undefined, customError: undefined, custom: false,
      rules: { active: null, rules: { v: 1, ...DEAL_DEFAULTS, simpleOnly: false, query: '', bans: [], preset: null } as CustomRules,
        summary: [], values: [], beginner: false, advancedOpen: false, banDraft: '', deckCount: 528, simpleCount: 300,
        suggestions: '', queryNote: '', pool: '' } },
    clock: { mode: 'draft', auto: true, now: 0, byModeMin: 60 }, error: '',
    deckPicker: { current: null, signedIn: false, mine: [], defaults: null, msg: '' }, hasDeck: false,
    competitive: { signedIn: false, decks: null, bestOf: 3, pick: null }, singleCard: null,
    leagueLive: true, challengeLive: true, badges: { alerts: 0, join: 0, updates: 0 },
    slots: { league: '', challenge: '', queue: '', invites: '', yourMatches: '', leagueMatches: '', scpicker: '', info: '', updates: '',
      cube: '<!--SLOT:cube-->', cubeEvents: '<!--SLOT:cubeEvents-->' },
    art: { backdrop: ART, draft: ART, constructed: ART, league: ART, challenge: ART, queue: ART },
    cubeArt: { src: 'cube.jpg', card: 'Prismite', focusY: 30 },
    ...over,
  };
}

const MINE: CubeMine[] = [
  { code: 'QZXV', name: 'Friday <cube>', phase: 'lobby', isHost: true, players: 3, maxPlayers: 8, startAt: null, myMatch: null },
  { code: 'KPLM', name: 'Sunday', phase: 'playing', isHost: false, players: 6, maxPlayers: 8, startAt: null,
    myMatch: { pairing: 'r2p1', round: 2, a: { user: 'u1', name: 'Ann' }, b: { user: 'u2', name: 'Bo' }, status: 'waiting', room: null, score: null, winner: null } },
];

test('1340 §1 the home\'s Cube draft card', () => {
  const html = homeHtml(view());
  const card = /<section class="homeside homeside--cube"[^>]*>[^]*?<\/section>/.exec(html)?.[0] ?? '';
  assert.ok(card, 'a fourth card beside Play');
  assert.match(card, /Cube draft/);
  assert.match(card, /<!--SLOT:cube-->/, 'its glass is the cube glance');
  assert.match(card, /<button class="homesideopen" data-btn="nav-cube" aria-label="[^"]+"><\/button>/, 'the whole card opens the page');
  assert.match(card, /src="cube\.jpg"/, 'on its own painting');
  assert.ok(html.indexOf('homeside--queue') < html.indexOf('homeside--cube'), 'after Matchmaking');
  const none = homeHtml(view({ slots: { ...view().slots, cube: '' } }));
  assert.match(none, /Draft with up to 12 players, then play a tournament\./);
  assert.match(none, /data-btn="nav-cube"/, 'always open: New event lives there');
});

test('1340 §2 the Join sheet', () => {
  const html = homeHtml(view({ sheet: 'join' }));
  assert.match(html, /Room or event code/);
  assert.match(html, /<div class="zonelabel">Your cube events<\/div><!--SLOT:cubeEvents-->/);
  const none = homeHtml(view({ sheet: 'join', slots: { ...view().slots, cubeEvents: '' } }));
  assert.doesNotMatch(none, /Your cube events/);
  assert.match(none, /Nothing waiting for you/);
});

test('1340 §3 the glance and the rows', () => {
  assert.equal(cubeGlanceHtml([]), '');
  const g = cubeGlanceHtml(MINE);
  assert.match(g, /<b>Friday &lt;cube&gt;<\/b> <span class="dim">Waiting to start<\/span>/);
  assert.match(g, /<b>Sunday<\/b> <span class="dim">your match is ready<\/span>/);
  assert.doesNotMatch(g, /data-btn/, 'no buttons of its own: the card is the button');
  assert.match(cubeGlanceHtml([...MINE, ...MINE]), /and 1 more/);
  assert.equal(cubeJoinRowsHtml([]), '');
  const rows = cubeJoinRowsHtml(MINE);
  assert.match(rows, /data-btn="cube-open"[^>]*data-code="QZXV"[^>]*>Open</);
  assert.match(rows, /data-btn="cube-open"[^>]*data-code="KPLM"[^>]*>Play</, 'a match waiting: Play');
  assert.match(rows, /3 of 8 joined/);
});
