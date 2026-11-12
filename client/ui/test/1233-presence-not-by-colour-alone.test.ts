/* 1233 · A PLAYER'S ONLINE DOT IS NOT TOLD BY ITS COLOUR ALONE (BL-10, 2026-11-12)
 *
 * The inventory listed it (docs/23-ui-inventory/02 §8.6 item 38): "Online
 * status is colour-only. The ladder rows' `.fdot` has no title at all." On the
 * profile's Players tab a friend's dot and every board row's dot (Constructed,
 * Live draft, Everyone) were a green or a grey disc: a player who cannot tell
 * the two apart, or who is listening, could not tell who was on. The friends
 * rows had a hover title; the boards had nothing.
 *
 * And a neighbour of the same dot: the friend lists that do write the state
 * ("in a game", the waiting room's Invite a friend and the deck's Send to a
 * friend) drew a friend in a game with the gold `.fdot.busy` — except that it
 * sat in a piece that loads BEFORE `.fdot.on`'s, so the green won and "in a
 * game" looked exactly like "online".
 *
 *   §1 the friends rows and every board row: the dot names itself on hover, and the state is spoken after the name
 *   §2 the stylesheet: offline is a hollow ring, online a filled disc, and the gold comes after the green
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileHtml, profileView, type ProfileState } from '../pages/profile.ts';
import type { FriendView, LeaderRow, Me, Profile } from '../account.ts';
import { readStyles } from './read-styles.ts';

const PROFILE = {
  games: 1, wins: 1, losses: 0, unresolved: 0, byMode: {}, cardElements: {}, recycled: {}, cards: {}, unitsPlayed: 0,
  spellsPlayed: 0, tokensCast: 0, modsApplied: 0, cardsDrafted: 0, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0, unitsLost: 0, unitsKilled: 0, turnsPlayed: 1,
  longestGameTurns: 1, flawlessWins: 0, closeWins: 0, streak: 0, bestStreak: 0, rating: {}, ratedGames: {},
  firstPlayed: null, lastPlayed: null,
} as unknown as Profile;

const friend = (id: string, username: string, online: boolean): FriendView =>
  ({ id, username, online, games: 0, wins: 0, favoriteElement: null, lastPlayed: null });
const leader = (id: string, username: string, online: boolean): LeaderRow =>
  ({ id, username, online, games: 3, wins: 2, losses: 1, streak: 0, bestStreak: 1, favoriteElement: null, earned: 0,
    lastPlayed: null, rating: 1010, ratedGames: 5, listed: true }) as LeaderRow;

const ME: Me = {
  id: 'me', username: 'Quill', createdAt: '2026-09-01T00:00:00Z', favoriteElement: null, profile: PROFILE,
  topCards: [], earned: 0, opponents: [], achievements: [],
  friends: [friend('f1', 'Nyar', true), friend('f2', 'Bo', false)],
  incoming: [friend('f3', 'Cy', true)], outgoing: [friend('f4', 'Dee', false)], history: [], decks: [],
};
const ROWS = [leader('f1', 'Nyar', true), leader('s1', 'Sol', false)];

function html(over: Partial<ProfileState>): string {
  return profileHtml(profileView({
    me: ME, tab: 'players', discordLinking: false, linkCode: null, linkMsg: '', friendMsg: '', pwMsg: null, favMsg: '', claimMsg: '',
    leaders: null, leadersFailed: false, board: 'all', ladder: null,
    prefs: { colours: 'standard', sound: true, motion: true, autoPass: false, bluffHaste: false }, artFor: c => c, ...over,
  }, 0));
}

const ON = (name: string) => `<span class="fdot on" aria-hidden="true" title="Online now"></span><span class="pfopp">${name}</span><span class="srname">, online now</span>`;
const OFF = (name: string) => `<span class="fdot" aria-hidden="true" title="Offline"></span><span class="pfopp">${name}</span><span class="srname">, offline</span>`;

test('§1 every presence dot on the Players tab names itself, and the state is spoken after the name', () => {
  const pages = {
    everyone: html({ board: 'all', leaders: ROWS }),
    constructed: html({ board: 'constructed', ladder: { mode: 'constructed', players: ROWS, you: null, rated: 2, publicAfter: 5 } }),
    draft: html({ board: 'draft', ladder: { mode: 'draft', players: ROWS, you: null, rated: 2, publicAfter: 5 } }),
  };
  for (const [board, page] of Object.entries(pages)) {
    const table = page.match(/<table class="pftable pfboard">[\s\S]*?<\/table>/)?.[0] ?? '';
    assert.ok(table.includes(ON('Nyar')), `${board}: an online row says so`);
    assert.ok(table.includes(OFF('Sol')), `${board}: an offline row says so`);
    assert.equal((table.match(/class="fdot/g) ?? []).length, 2, `${board}: one dot a row`);
  }
  const friends = pages.everyone.match(/<ul class="pflist">[\s\S]*<\/ul>/)?.[0] ?? '';
  for (const s of [ON('Nyar'), OFF('Bo'), ON('Cy'), OFF('Dee')]) assert.ok(friends.includes(s), `friends column: ${s}`);
  // the class: no dot anywhere on the tab without its name and its words
  for (const page of Object.values(pages)) {
    for (const m of page.matchAll(/<span class="fdot[^"]*"[^>]*><\/span>/g)) {
      assert.match(m[0], /aria-hidden="true" title="(Online now|Offline)"/, m[0]);
      assert.match(page.slice(m.index! + m[0].length), /^<span class="pfopp">[^<]*<\/span><span class="srname">, (online now|offline)<\/span>/, m[0]);
    }
  }
});

/** every rule whose selector list names exactly `selector`, in cascade order, as [index, body] */
function rules(css: string, selector: string): [number, string][] {
  const out: [number, string][] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.split(',').some(s => s.trim() === selector)) out.push([m.index!, m[2]!]);
  }
  return out;
}

test('§2 offline is a hollow ring and online a filled disc; a friend in a game stays gold', () => {
  const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
  const dot = rules(css, '.fdot').map(r => r[1]).join(';');
  assert.match(dot, /border:\s*2px solid/, 'offline: a ring');
  assert.match(dot, /background:\s*transparent/, 'offline: hollow');
  const on = rules(css, '.fdot.on'), busy = rules(css, '.fdot.busy');
  assert.equal(on.length, 1); assert.equal(busy.length, 1);
  assert.match(on[0]![1], /border-width:\s*0/, 'online: a filled disc, not a ring');
  assert.match(busy[0]![1], /background:\s*var\(--accent\)/);
  assert.ok(busy[0]![0] > on[0]![0], '.fdot.busy comes after .fdot.on (same weight: the later one wins), or "in a game" is drawn green');
});
