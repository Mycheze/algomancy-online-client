/* 1514 · A FAVOURITE ELEMENT'S ICON SAYS SO ONE WAY, AND ESCAPES WHAT IT IS GIVEN (BL-10)
 *
 * Every place that draws a player's favourite element as its icon carries the
 * same tooltip, spelled as the profile's picker spells it ("favourite"), and
 * puts the element string into a class, a URL and an attribute only escaped.
 *
 *   §1 the identity bar's chip, the profile's friend and ladder rows (elChip),
 *      the home's avatar and the waiting room's Invite a friend row all say
 *      "favourite element: water"
 *   §2 an element string that is not a word comes out escaped from each
 *   §3 a census of the ui sources: no "favorite" in anything a player reads
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { elChip, identityBarHtml, type IdentityBarView } from '../pages/signin.ts';
import { roomFriendsBodyHtml } from '../pages/inbox.ts';
import { homeHtml, type HomeView } from '../pages/home.ts';
import { STANDARD_RULES } from '../customrules.ts';

const UI = join(import.meta.dirname, '..');
const ME: NonNullable<IdentityBarView['me']> = { username: 'Ann', favoriteElement: 'water', games: 5, wins: 3, losses: 2, unresolved: 0, streak: 0 };

function home(el: string): string {
  const v: HomeView = {
    account: { resolving: false, me: { ...ME, favoriteElement: el } }, nameBox: '', signedIn: true, mode: 'draft', format: 'casual', sheet: null,
    draft: { k: 3, els: [], fixedOpen: false, setCount: 35, fixedError: undefined, customError: undefined, custom: false,
      rules: { active: null, rules: { ...STANDARD_RULES, bans: [] }, summary: [], values: [], beginner: false, advancedOpen: false, banDraft: '',
        deckCount: 528, simpleCount: 300, suggestions: '', queryNote: '', pool: '' } },
    clock: { mode: 'draft', auto: true, now: 0, byModeMin: 60 }, error: '',
    deckPicker: { current: null, signedIn: true, mine: [], defaults: null, msg: '' }, hasDeck: false,
    competitive: { signedIn: true, decks: null, bestOf: 3, pick: null }, singleCard: null,
    leagueLive: false, challengeLive: false, badges: { alerts: 0, join: 0, updates: 0 },
    slots: { league: '', challenge: '', queue: '', invites: '', yourMatches: '', leagueMatches: '', scpicker: '', info: '', updates: '' },
    art: { backdrop: { src: 'b.jpg', card: 'B', focusY: 30 }, draft: { src: 'd.jpg', card: 'D', focusY: 30 }, constructed: { src: 'c.jpg', card: 'C', focusY: 30 }, league: { src: 'l.jpg', card: 'L', focusY: 30 }, challenge: { src: 'ch.jpg', card: 'Ch', focusY: 30 }, queue: { src: 'q.jpg', card: 'Q', focusY: 30 } },
  };
  return homeHtml(v);
}
const room = (el: string): string => roomFriendsBodyHtml({
  loaded: true, msg: '', friends: [{ id: 'u2', username: 'Bo', favoriteElement: el, status: 'online', invite: null }],
} as Parameters<typeof roomFriendsBodyHtml>[0]);

const SITES: [string, (el: string) => string][] = [
  ['the profile rows (elChip)', el => elChip(el)],
  ['the identity bar', el => identityBarHtml({ resolving: false, me: { ...ME, favoriteElement: el } })],
  ['the home avatar', home],
  ['the waiting room\'s Invite a friend row', room],
];

test('1514 §1 BL-10: every favourite-element icon says "favourite element: water"', () => {
  for (const [name, draw] of SITES) {
    const html = draw('water');
    assert.match(html, /title="favourite element: water"/, name);
    assert.doesNotMatch(html, /favorite/i, name);
  }
});

test('1514 §2 BL-10: an element string is escaped in its class, URL and tooltip', () => {
  const bad = 'x"><b>y';
  for (const [name, draw] of SITES) {
    const html = draw(bad);
    assert.doesNotMatch(html, /<b>y/, `${name}: the string broke out of its attribute`);
    assert.match(html, /favourite element: x&quot;&gt;&lt;b&gt;y"/, name);
  }
});

test('1514 §3 BL-10: no ui source says "favorite" in a string a player reads', () => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (f === 'node_modules' || f === 'test' || f.startsWith('bundle')) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.ts')) files.push(p);
    }
  };
  walk(UI);
  assert.ok(files.length > 50, 'positive control: the walk found the ui sources');
  const hits: string[] = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      // identifiers (favoriteElement, acct-favorite, /api/me/favorite) are code, not words
      const words = line.replace(/\/\/.*$|^\s*\*.*$|\/\*.*?\*\//g, '').match(/[`'"][^`'"]*\bfavorite\b[^`'"]*[`'"]/gi) ?? [];
      for (const w of words) if (/favorite[ :]/i.test(w) && !/[-/]favorite/.test(w)) hits.push(`${f.slice(UI.length)}:${i + 1} ${w}`);
    });
  }
  assert.deepEqual(hits, []);
});
