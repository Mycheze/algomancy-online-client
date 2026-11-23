/* 1515 · AN ACHIEVEMENT'S ICON IS ESCAPED AND SILENT WHEREVER IT IS DRAWN (BL-10)
 *
 * The icon is a string off the server, drawn beside the achievement's name. It
 * goes into the markup only through esc(), and it is aria-hidden: the name
 * beside it says what it is.
 *
 *   §1 the profile's Achievements tab and the post-game's Unlocked list draw a
 *      hostile icon as text, and an emoji as itself
 *   §2 a census of the ui sources: every `achicon` writes its icon through esc()
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { profileHtml, profileView, type ProfileState } from '../pages/profile.ts';
import { postGameHtml } from '../pages/postgame.ts';
import type { GameOver } from '../postgame.ts';
import type { Me, Profile } from '../account.ts';

const UI = join(import.meta.dirname, '..');
const BAD = '<img src=x onerror=alert(1)>';

const PROFILE = {
  games: 1, wins: 1, losses: 0, unresolved: 0, byMode: { draft: 1 }, cardElements: {}, recycled: {}, cards: {},
  unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0, cardsDrafted: 0, resourcesActivated: 0,
  abilitiesActivated: 0, attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0, unitsLost: 0,
  unitsKilled: 0, turnsPlayed: 1, longestGameTurns: 1, flawlessWins: 0, closeWins: 0, streak: 1, bestStreak: 1,
  rating: {}, ratedGames: {}, firstPlayed: null, lastPlayed: null,
} as unknown as Profile;

function profile(icon: string): string {
  const me = {
    id: 'u1', username: 'Ann', createdAt: '2026-09-01T00:00:00Z', favoriteElement: null, profile: PROFILE,
    topCards: [], earned: 1, opponents: [], friends: [], incoming: [], outgoing: [], history: [], decks: [],
    badge: null, admin: false,
    achievements: [{ id: 'a', name: 'First win', desc: 'Win a game.', icon, have: 1, need: 1, earned: true, group: 'Winning' }],
  } as unknown as Me;
  const s: ProfileState = {
    me, tab: 'achievements', discordLinking: false, linkCode: null, linkMsg: '', friendMsg: '', pwMsg: null, favMsg: '',
    claimMsg: '', leaders: null, leadersFailed: false, board: 'constructed', ladder: null,
    prefs: { colours: 'standard', sound: true, motion: true, autoPass: false, bluffHaste: false },
    artFor: c => `art/${c}.webp`,
  };
  return profileHtml(profileView(s, 0));
}

function postgame(icon: string): string {
  const seat = (name: string): GameOver['seats'][0] => ({
    name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0, cardElements: {}, recycled: {},
    resourcesActivated: 0, abilitiesActivated: 0, attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
    unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 10,
  });
  const over: GameOver = {
    seat: 0, winner: 0, names: ['Ann', 'Bo'], mode: 'draft', els: ['fire'], turns: 5,
    seats: [seat('Ann'), seat('Bo')], rematch: [false, false], rematchRoom: null, recorded: true,
    unlocked: [{ id: 'first-win', icon, name: 'First win', desc: 'Win a game.' }],
    disputed: [false, false],
  };
  return postGameHtml({ over, modeLabel: 'live draft', elements: null, guest: false, signup: null, matchResult: '' });
}

const SITES: [string, (icon: string) => string][] = [
  ['the profile\'s Achievements tab', profile],
  ['the post-game\'s Unlocked list', postgame],
];

test('1515 §1 BL-10: an achievement icon off the server is drawn as text, and hidden from a screen reader', () => {
  for (const [name, draw] of SITES) {
    const plain = draw('🏆');
    assert.match(plain, /class="achicon" aria-hidden="true">🏆</, `${name}: the emoji is drawn as itself`);
    const html = draw(BAD);
    assert.doesNotMatch(html, /<img src=x/, `${name}: the icon became markup`);
    assert.match(html, /class="achicon" aria-hidden="true">&lt;img src=x onerror=alert\(1\)&gt;</, name);
  }
});

test('1515 §2 BL-10: every achicon in the ui sources writes its icon through esc()', () => {
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
  const sites: string[] = [];
  const bare: string[] = [];
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/class="achicon"[^>]*>(\$\{[^}]*\})/g)) {
      sites.push(f);
      if (!m[1]!.startsWith('${esc(')) bare.push(`${f}: ${m[1]}`);
    }
  }
  assert.ok(sites.length >= 2, `positive control: the profile and the post-game draw an achicon (${sites.length})`);
  assert.deepEqual(bare, []);
});
