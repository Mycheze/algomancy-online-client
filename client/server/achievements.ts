/* Achievements: one declarative table, evaluated against a Profile.
 *
 * Every achievement is a COUNTER against a GOAL — never a bespoke predicate —
 * so the UI can show "7 / 10" for all of them without special cases, and so a
 * newly-added achievement is retroactive by construction: profiles are folds
 * over the game record, so the counters already exist for games played before
 * the achievement did.
 *
 * Unlocks are sticky. accounts.ts stamps the date the first time `earned`
 * turns true and never clears it, so tightening a goal later cannot take
 * somebody's badge away.
 */
import type { Account, Profile } from './accounts.ts';
import { ELEMENTS } from './stats.ts';

export interface Achievement {
  id: string;
  name: string;
  /** what you did (or have to do) — shown under the name */
  desc: string;
  icon: string;
  /** progress toward the goal, and the goal */
  count: (p: Profile, a: Account) => number;
  goal: number;
  /** hidden until earned (kept for flavour ones) */
  secret?: boolean;
}

export interface AchievementState {
  id: string;
  name: string;
  desc: string;
  icon: string;
  have: number;
  need: number;
  earned: boolean;
}

const distinct = (rec: Record<string, number>): number =>
  Object.values(rec).filter(n => n > 0).length;

export const ACHIEVEMENTS: Achievement[] = [
  // ── getting started ──
  { id: 'first-game', name: 'First Cast', desc: 'Play your first game.', icon: '🎴',
    count: p => p.games, goal: 1 },
  { id: 'first-win', name: 'Victory', desc: 'Win a game.', icon: '🏆',
    count: p => p.wins, goal: 1 },
  { id: 'regular', name: 'Regular', desc: 'Play 10 games.', icon: '📅',
    count: p => p.games, goal: 10 },
  { id: 'veteran', name: 'Veteran', desc: 'Play 50 games.', icon: '🎖️',
    count: p => p.games, goal: 50 },

  // ── winning ──
  { id: 'streak-3', name: 'On a Roll', desc: 'Win three games in a row.', icon: '🔥',
    count: p => p.bestStreak, goal: 3 },
  { id: 'streak-5', name: 'Unstoppable', desc: 'Win five games in a row.', icon: '☄️',
    count: p => p.bestStreak, goal: 5 },
  { id: 'wins-10', name: 'Champion', desc: 'Win 10 games.', icon: '👑',
    count: p => p.wins, goal: 10 },
  { id: 'flawless', name: 'Untouched', desc: 'Win a game without losing a single life.', icon: '🛡️',
    count: p => p.flawlessWins, goal: 1 },
  { id: 'close-call', name: 'Close Call', desc: 'Win a game with 5 life or less remaining.', icon: '💀',
    count: p => p.closeWins, goal: 1 },

  // ── the five (seven) elements ──
  { id: 'elementalist', name: 'Elementalist', desc: 'Play a game with each of the seven elements.', icon: '🌈',
    count: p => ELEMENTS.filter(e => (p.byElement[e] ?? 0) > 0).length, goal: ELEMENTS.length },
  { id: 'full-spectrum', name: 'Full Spectrum', desc: 'Play at least one card of every element.', icon: '🎨',
    count: p => ELEMENTS.filter(e => (p.cardElements[e] ?? 0) > 0).length, goal: ELEMENTS.length },
  { id: 'recycler', name: 'Recycler', desc: 'Recycle 100 cards for resources.', icon: '♻️',
    count: p => Object.values(p.recycled).reduce((a, b) => a + b, 0), goal: 100 },

  // ── what you put on the table ──
  { id: 'swarm', name: 'Swarm', desc: 'Play 100 units.', icon: '🐝',
    count: p => p.unitsPlayed, goal: 100 },
  { id: 'spellslinger', name: 'Spellslinger', desc: 'Play 50 spells.', icon: '✨',
    count: p => p.spellsPlayed, goal: 50 },
  { id: 'tinkerer', name: 'Tinkerer', desc: 'Slide 25 augments or grafts under a unit.', icon: '🔧',
    count: p => p.modsApplied, goal: 25 },
  { id: 'collector', name: 'Collector', desc: 'Play 50 different cards.', icon: '📚',
    count: p => distinct(p.cards), goal: 50 },
  { id: 'curator', name: 'Curator', desc: 'Play 150 different cards.', icon: '🏛️',
    count: p => distinct(p.cards), goal: 150 },
  { id: 'pack-rat', name: 'Pack Rat', desc: 'Draft 100 cards out of packs.', icon: '📦',
    count: p => p.cardsDrafted, goal: 100 },

  // ── combat ──
  { id: 'aggressor', name: 'Aggressor', desc: 'Deal 100 damage to your opponents.', icon: '⚔️',
    count: p => Math.floor(p.damageDealt), goal: 100 },
  { id: 'warmonger', name: 'Warmonger', desc: 'Deal 500 damage to your opponents.', icon: '🗡️',
    count: p => Math.floor(p.damageDealt), goal: 500 },
  { id: 'slayer', name: 'Slayer', desc: 'Destroy 50 enemy units.', icon: '☠️',
    count: p => p.unitsKilled, goal: 50 },
  { id: 'marathon', name: 'Marathon', desc: 'Play a game that reaches turn 10.', icon: '⏳',
    count: p => p.longestGameTurns, goal: 10 },

  // ── formats and people ──
  { id: 'drafter', name: 'Drafter', desc: 'Play 5 live-draft games.', icon: '🃏',
    count: p => p.byMode.draft ?? 0, goal: 5 },
  { id: 'deckbuilder', name: 'Deckbuilder', desc: 'Play a constructed game.', icon: '🛠️',
    count: p => p.byMode.constructed ?? 0, goal: 1 },
  { id: 'format-fluent', name: 'Format Fluent', desc: 'Play all three formats: shared, live draft, constructed.', icon: '🎲',
    count: p => (['shared', 'draft', 'constructed'] as const).filter(m => (p.byMode[m] ?? 0) > 0).length, goal: 3 },
  { id: 'good-company', name: 'Good Company', desc: 'Make a friend.', icon: '🤝',
    count: (_p, a) => a.friends.length, goal: 1 },
  { id: 'nemesis', name: 'Nemesis', desc: 'Play 10 games against the same opponent.', icon: '🎯',
    count: p => Math.max(0, ...Object.values(p.opponents).map(o => o.games)), goal: 10 },
  { id: 'rivalry', name: 'Rivalry', desc: 'Play 25 games against the same opponent.', icon: '⚡',
    count: p => Math.max(0, ...Object.values(p.opponents).map(o => o.games)), goal: 25 },
];

export function evaluateAchievements(profile: Profile, account: Account): AchievementState[] {
  return ACHIEVEMENTS.map(a => {
    let have = 0;
    try { have = a.count(profile, account); } catch { have = 0; }
    if (!Number.isFinite(have)) have = 0;
    return {
      id: a.id, name: a.name, desc: a.desc, icon: a.icon,
      have: Math.max(0, Math.min(have, a.goal)),
      need: a.goal,
      // sticky: accounts.ts remembers the unlock, so a later goal change can
      // only ever add achievements, never revoke one
      earned: have >= a.goal || !!account.achievements[a.id],
    };
  });
}
