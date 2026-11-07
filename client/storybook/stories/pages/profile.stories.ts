/* The profile (ui/pages/profile.ts), drawn from a made-up account: no server,
 * no sign-in. profileView() takes the state account.ts keeps; profileHtml()
 * is pure, so each tab and each state is one object away. */
import { type ProfileState, profileHtml, profileView } from '../../../ui/pages/profile.ts';
import type { LeaderRow, Me } from '../../../ui/account.ts';

const ME: Me = {
  id: 'u1', username: 'Quillon', createdAt: '2026-09-01T00:00:00Z', favoriteElement: 'fire', favoritePicked: null,
  profile: {
    games: 42, wins: 25, losses: 16, unresolved: 1, byMode: { draft: 30, constructed: 12 },
    cardElements: { fire: 40, water: 22, earth: 10, light: 6 }, recycled: { fire: 12, water: 9 }, cards: { Ember: 9, Tide: 4 },
    unitsPlayed: 210, spellsPlayed: 64, tokensCast: 8, modsApplied: 15, cardsDrafted: 900, resourcesActivated: 300,
    abilitiesActivated: 41, attacksDeclared: 150, unitsAttackedWith: 260, damageDealt: 620, lifeLost: 540, unitsLost: 120,
    unitsKilled: 133, turnsPlayed: 520, longestGameTurns: 19, flawlessWins: 1, closeWins: 6, streak: 3, bestStreak: 5,
    rating: { constructed: 1042, draft: 987 }, ratedGames: { constructed: 9, draft: 4 },
    firstPlayed: '2026-09-02T00:00:00Z', lastPlayed: '2026-11-02T00:00:00Z',
  },
  topCards: [{ card: 'Ember Sprite', n: 31 }, { card: 'Tidecaller', n: 22 }, { card: 'Stone Ward', n: 17 }],
  earned: 3,
  opponents: [{ id: 'u2', username: 'Nyar', games: 12, wins: 7, losses: 5 }, { id: 'u3', username: 'Karanda', games: 4, wins: 1, losses: 3 }],
  achievements: [
    { id: 'first', name: 'First blood', desc: 'Win a game.', icon: '🏆', have: 1, need: 1, earned: true, earnedAt: '2026-09-03T00:00:00Z', group: 'Winning' },
    { id: 'c50', name: 'Collector', desc: 'Play 50 different cards.', icon: '🃏', have: 50, need: 50, earned: true, group: 'On the table', tier: { of: 'collector', rung: 1 } },
    { id: 'c150', name: 'Collector II', desc: 'Play 150 different cards.', icon: '🃏', have: 61, need: 150, earned: false, group: 'On the table', tier: { of: 'collector', rung: 2 } },
    { id: 'champ', name: 'League Champion', desc: 'Win a league season.', icon: '🥇', have: 0, need: 1, earned: false, group: 'League' },
    { id: 'secret', name: '???', desc: 'A secret.', icon: '❔', have: 0, need: 1, earned: false, group: 'One-game feats', hidden: true },
  ],
  friends: [
    { id: 'u2', username: 'Nyar', online: true, games: 12, wins: 7, favoriteElement: 'water', lastPlayed: null },
    { id: 'u3', username: 'Karanda', online: false, games: 4, wins: 1, favoriteElement: null, lastPlayed: null },
  ],
  incoming: [{ id: 'u4', username: 'Tomzy', online: true, games: 2, wins: 0, favoriteElement: null, lastPlayed: null }],
  outgoing: [{ id: 'u5', username: 'Fennick', online: false, games: 0, wins: 0, favoriteElement: null, lastPlayed: null }],
  history: [
    { code: 'QXZK', playedAt: '2026-11-02T18:00:00Z', mode: 'constructed', els: [], sides: [['fire', 'earth'], ['water']], turns: 9,
      deckId: null, finished: true, diverged: false, result: 'win', opponent: 'Nyar', opponentId: 'u2', life: [6, 0],
      unitsPlayed: 7, spellsPlayed: 2, damageDealt: 30, favoriteElement: 'fire', match: { id: 'm1', game: 2, bestOf: 3 } },
    { code: 'RRTA', playedAt: '2026-11-01T18:00:00Z', mode: 'draft', els: ['fire', 'water', 'light'], turns: 3,
      deckId: null, finished: true, diverged: false, result: 'loss', opponent: 'Karanda', opponentId: 'u3', life: [0, 20],
      unitsPlayed: 1, spellsPlayed: 0, damageDealt: 2, favoriteElement: 'fire', concession: { turn: 3, weight: 'early', mine: true }, amended: 1 },
  ],
  decks: [
    { id: 'd1', name: 'Ember Rush', cards: Array(30).fill('Ember Sprite'), cover: 'Ember Sprite', record: { games: 9, wins: 6, losses: 3 } } as never,
  ],
  badge: { judge: 2, since: '2026-10-01' },
  trophies: [{ season: 'oct', name: 'October 2026', place: 'finalist', w: 5, l: 2 }],
  admin: true,
};

const LEADERS: LeaderRow[] = [
  { id: 'u2', username: 'Nyar', online: true, games: 60, wins: 38, losses: 22, streak: 2, bestStreak: 7, favoriteElement: 'water', earned: 21, lastPlayed: null, rating: 1100, ratedGames: 30, listed: true },
  { id: 'u1', username: 'Quillon', online: true, games: 42, wins: 25, losses: 16, streak: 3, bestStreak: 5, favoriteElement: 'fire', earned: 3, lastPlayed: null, rating: 1042, ratedGames: 9, listed: true },
];

const base: ProfileState = {
  me: ME, tab: 'overview', discordLinking: true, linkCode: null, linkMsg: '', friendMsg: '', pwMsg: null, favMsg: '', claimMsg: '',
  leaders: LEADERS, leadersFailed: false, board: 'constructed',
  ladder: { mode: 'constructed', players: LEADERS, you: { ...LEADERS[1]!, rank: 2 }, rated: 14, publicAfter: 5 },
  prefs: { colours: 'standard', sound: true, motion: true, autoPass: false, bluffHaste: false },
  // no art server in Storybook: the cover falls back to its hidden image
  artFor: card => `../../ui/cards/${encodeURIComponent(card)}.webp`,
};

export default {
  title: 'Pages/Profile',
  render: (args: ProfileState) => profileHtml(profileView(args)),
  args: base,
};

export const Overview = {};
export const OverviewNewPlayer = { name: 'Overview, a new player (no badge, not admin)', args: { me: { ...ME, admin: undefined, badge: null, trophies: [], opponents: [], topCards: [], decks: [] } } };
export const Achievements = { args: { tab: 'achievements' } };
export const Games = { args: { tab: 'games' } };
export const GamesEmpty = { name: 'Games, none yet', args: { tab: 'games', me: { ...ME, history: [] } } };
export const Players = { args: { tab: 'players', friendMsg: 'request sent to Fennick' } };
export const PlayersLoading = { name: 'Players, the ladder loading', args: { tab: 'players', ladder: null } };
export const PlayersFailed = { name: 'Players, the ladder failed', args: { tab: 'players', ladder: { ...base.ladder!, failed: true } } };
export const PlayersEveryone = { name: 'Players, Everyone', args: { tab: 'players', board: 'all' } };
export const PlayersEveryoneFailed = { name: 'Players, Everyone failed', args: { tab: 'players', board: 'all', leaders: null, leadersFailed: true } };
export const Settings = { args: { tab: 'settings' } };
export const SettingsFailures = { name: 'Settings, a favourite and an unlink that did not take', args: { tab: 'settings', favMsg: 'could not reach the server', linkMsg: 'could not unlink', me: { ...ME, discord: 'quill' } } };
export const SettingsAccessible = { name: 'Settings, accessible colours on', args: { tab: 'settings', prefs: { ...base.prefs, colours: 'accessible' } } };
export const Guest = { name: 'Settings, a guest (name the account)', args: { tab: 'settings', me: { ...ME, provisional: true } } };
export const DiscordCode = { name: 'Settings, Discord link code showing', args: { tab: 'settings', linkCode: { code: 'K7Q2', expiresAt: Number.MAX_SAFE_INTEGER } } };
