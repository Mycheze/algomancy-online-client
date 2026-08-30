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

/** The sections the UI lays the grid out in, in the order it shows them. */
export const GROUPS = [
  'Getting started', 'Winning', 'Elements', 'On the table',
  'Combat', 'One-game feats', 'Formats and people',
] as const;
export type Group = (typeof GROUPS)[number];

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
  /** which section of the grid this belongs to */
  group: Group;
  /**
   * A LADDER: several achievements that are the same feat at rising goals
   * (play 50 / 150 / 300 different cards). `of` is the ladder's name and
   * `rung` its position, 1-based. The UI collapses a ladder to one card
   * showing the next unearned rung, which is the only reason fifty-odd
   * achievements do not read as a wall of fifty-odd separate things.
   *
   * The server still evaluates and emits every rung: collapsing is a
   * rendering decision, so nothing about stickiness, the API or the unlock
   * stamp changes.
   */
  tier?: { of: string; rung: number };
}

export interface AchievementState {
  id: string;
  name: string;
  desc: string;
  icon: string;
  have: number;
  need: number;
  earned: boolean;
  group: Group;
  tier?: { of: string; rung: number };
  /** true when this is an unearned secret: name and desc have been redacted
   * and the client should render it as a mystery rather than a spoiler */
  hidden?: boolean;
}

const distinct = (rec: Record<string, number>): number =>
  Object.values(rec).filter(n => n > 0).length;

/** whole years between two ISO stamps, 0 when either is missing or unparseable —
 * a counter, like everything else here, so "still here a year later" can be a
 * goal of 1 rather than a predicate */
const yearsBetween = (from: string | null, to: string | null): number => {
  if (!from || !to) return 0;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.floor((b - a) / (365.25 * 24 * 60 * 60 * 1000));
};

export const ACHIEVEMENTS: Achievement[] = [
  // ── getting started ──
  { id: 'first-game', name: 'First Cast', desc: 'Play your first game.', icon: '🎴',
    group: 'Getting started', count: p => p.games, goal: 1 },
  { id: 'first-win', name: 'Victory', desc: 'Win a game.', icon: '🏆',
    group: 'Getting started', count: p => p.wins, goal: 1 },
  { id: 'regular', name: 'Regular', desc: 'Play 10 games.', icon: '📅',
    group: 'Getting started', tier: { of: 'Games played', rung: 1 }, count: p => p.games, goal: 10 },
  { id: 'veteran', name: 'Veteran', desc: 'Play 50 games.', icon: '🎖️',
    group: 'Getting started', tier: { of: 'Games played', rung: 2 }, count: p => p.games, goal: 50 },

  // ── winning ──
  { id: 'streak-3', name: 'On a Roll', desc: 'Win three games in a row.', icon: '🔥',
    group: 'Winning', tier: { of: 'Win streak', rung: 1 }, count: p => p.bestStreak, goal: 3 },
  { id: 'streak-5', name: 'Unstoppable', desc: 'Win five games in a row.', icon: '☄️',
    group: 'Winning', tier: { of: 'Win streak', rung: 2 }, count: p => p.bestStreak, goal: 5 },
  { id: 'wins-10', name: 'Champion', desc: 'Win 10 games.', icon: '👑',
    group: 'Winning', count: p => p.wins, goal: 10 },
  { id: 'flawless', name: 'Untouched', desc: 'Win a game without losing a single life.', icon: '🛡️',
    group: 'Winning', count: p => p.flawlessWins, goal: 1 },
  { id: 'close-call', name: 'Close Call', desc: 'Win a game with 5 life or less remaining.', icon: '💀',
    group: 'Winning', count: p => p.closeWins, goal: 1 },

  // ── the five (seven) elements ──
  { id: 'elementalist', name: 'Elementalist', desc: 'Play a game with each of the seven elements.', icon: '🌈',
    group: 'Elements', count: p => ELEMENTS.filter(e => (p.byElement[e] ?? 0) > 0).length, goal: ELEMENTS.length },
  { id: 'full-spectrum', name: 'Full Spectrum', desc: 'Play at least one card of every element.', icon: '🎨',
    group: 'Elements', count: p => ELEMENTS.filter(e => (p.cardElements[e] ?? 0) > 0).length, goal: ELEMENTS.length },
  { id: 'recycler', name: 'Recycler', desc: 'Recycle 100 cards for resources.', icon: '♻️',
    group: 'Elements', count: p => Object.values(p.recycled).reduce((a, b) => a + b, 0), goal: 100 },

  // ── what you put on the table ──
  { id: 'swarm', name: 'Swarm', desc: 'Play 100 units.', icon: '🐝',
    group: 'On the table', count: p => p.unitsPlayed, goal: 100 },
  { id: 'spellslinger', name: 'Spellslinger', desc: 'Play 50 spells.', icon: '✨',
    group: 'On the table', count: p => p.spellsPlayed, goal: 50 },
  { id: 'tinkerer', name: 'Tinkerer', desc: 'Slide 25 augments or grafts under a unit.', icon: '🔧',
    group: 'On the table', tier: { of: 'Mods applied', rung: 1 }, count: p => p.modsApplied, goal: 25 },
  { id: 'collector', name: 'Collector', desc: 'Play 50 different cards.', icon: '📚',
    group: 'On the table', tier: { of: 'Different cards', rung: 1 }, count: p => distinct(p.cards), goal: 50 },
  { id: 'curator', name: 'Curator', desc: 'Play 150 different cards.', icon: '🏛️',
    group: 'On the table', tier: { of: 'Different cards', rung: 2 }, count: p => distinct(p.cards), goal: 150 },
  { id: 'pack-rat', name: 'Pack Rat', desc: 'Draft 100 cards out of packs.', icon: '📦',
    group: 'On the table', count: p => p.cardsDrafted, goal: 100 },

  // ── combat ──
  { id: 'aggressor', name: 'Aggressor', desc: 'Deal 100 damage to your opponents.', icon: '⚔️',
    group: 'Combat', tier: { of: 'Damage dealt', rung: 1 }, count: p => Math.floor(p.damageDealt), goal: 100 },
  { id: 'warmonger', name: 'Warmonger', desc: 'Deal 500 damage to your opponents.', icon: '🗡️',
    group: 'Combat', tier: { of: 'Damage dealt', rung: 2 }, count: p => Math.floor(p.damageDealt), goal: 500 },
  { id: 'slayer', name: 'Slayer', desc: 'Destroy 50 enemy units.', icon: '☠️',
    group: 'Combat', count: p => p.unitsKilled, goal: 50 },
  { id: 'marathon', name: 'Marathon', desc: 'Play a game that reaches turn 10.', icon: '⏳',
    group: 'Combat', tier: { of: 'Long games', rung: 1 }, count: p => p.longestGameTurns, goal: 10 },

  // ── formats and people ──
  { id: 'drafter', name: 'Drafter', desc: 'Play 5 live-draft games.', icon: '🃏',
    group: 'Formats and people', count: p => p.byMode.draft ?? 0, goal: 5 },
  { id: 'deckbuilder', name: 'Deckbuilder', desc: 'Play a constructed game.', icon: '🛠️',
    group: 'Formats and people', count: p => p.byMode.constructed ?? 0, goal: 1 },
  { id: 'format-fluent', name: 'Format Fluent', desc: 'Play all three formats: shared, live draft, constructed.', icon: '🎲',
    group: 'Formats and people', count: p => (['shared', 'draft', 'constructed'] as const).filter(m => (p.byMode[m] ?? 0) > 0).length, goal: 3 },
  { id: 'good-company', name: 'Good Company', desc: 'Make a friend.', icon: '🤝',
    group: 'Formats and people', tier: { of: 'Friends', rung: 1 }, count: (_p, a) => a.friends.length, goal: 1 },
  { id: 'nemesis', name: 'Nemesis', desc: 'Play 10 games against the same opponent.', icon: '🎯',
    group: 'Formats and people', tier: { of: 'Head to head', rung: 1 },
    count: p => Math.max(0, ...Object.values(p.opponents).map(o => o.games)), goal: 10 },
  { id: 'rivalry', name: 'Rivalry', desc: 'Play 25 games against the same opponent.', icon: '⚡',
    group: 'Formats and people', tier: { of: 'Head to head', rung: 2 },
    count: p => Math.max(0, ...Object.values(p.opponents).map(o => o.games)), goal: 25 },

  // ══ BL-31: the one-game feats ═══════════════════════════════════════
  //
  // Everything above this line is a CAREER SUM. Everything below is "the most
  // you ever did in a single game", which a sum cannot answer — each one
  // reads a per-game highlight that stats.ts takes while the board is still
  // in front of it and accounts.ts keeps a running max of. See the
  // retroactivity note on Profile: these read 0 for games recorded before the
  // counters existed, until `seed-accounts.ts --force` re-reads their logs.

  { id: 'grafter', name: 'Grand Design', desc: 'Trigger a graft effect with 5 or more parts.', icon: '🧬',
    group: 'One-game feats', count: p => p.bestGraftParts, goal: 5 },
  { id: 'big-hit', name: 'Alpha Strike', desc: 'Deal 30 damage with a single non-combat effect.', icon: '💥',
    group: 'One-game feats', count: p => Math.floor(p.bestSingleHit), goal: 30 },
  { id: 'big-combat', name: 'Total War', desc: 'Deal 100 damage in a single combat.', icon: '🌋',
    group: 'One-game feats', count: p => Math.floor(p.bestCombatDamage), goal: 100 },
  { id: 'kaiju', name: 'Kaiju', desc: 'Have a 20/20 (or larger) unit in play.', icon: '🦖',
    group: 'One-game feats', tier: { of: 'Biggest unit', rung: 1 }, count: p => p.biggestUnit, goal: 20 },
  { id: 'titan', name: 'Titan', desc: 'Have a 50/50 (or larger) unit in play.', icon: '🗿',
    group: 'One-game feats', tier: { of: 'Biggest unit', rung: 2 }, count: p => p.biggestUnit, goal: 50 },
  { id: 'horde', name: 'Horde', desc: 'Have at least 25 units in play at once.', icon: '🐜',
    group: 'One-game feats', count: p => p.mostUnitsInPlay, goal: 25 },
  { id: 'pacifist', name: 'Pacifist', desc: 'Win a game without dealing combat damage to any opponent.', icon: '🕊️',
    group: 'One-game feats', count: p => p.pacifistWins, goal: 1 },
  { id: 'broken-record', name: 'Broken Record', desc: 'Play the same named spell 5 times in a single game.', icon: '🔁',
    group: 'One-game feats', count: p => p.bestSameSpell, goal: 5 },
  { id: 'ascetic', name: 'Ascetic', desc: 'Win a game past turn 3 with 3 or fewer resources in play.', icon: '🪷',
    group: 'One-game feats', count: p => p.asceticWins, goal: 1 },
  { id: 'engine', name: 'Well Oiled', desc: 'Have 12 or more resources in a single game.', icon: '⚙️',
    group: 'One-game feats', count: p => p.mostResources, goal: 12 },
  { id: 'decked', name: 'Last Card', desc: 'Win a game with 0 cards left in your deck.', icon: '🕳️',
    group: 'One-game feats', count: p => p.deckedWins, goal: 1 },
  { id: 'rainbow', name: 'Play the Rainbow', desc: 'Win a game playing cards from 4 or more elements.', icon: '🔮',
    group: 'One-game feats', count: p => p.bestElementsInAWin, goal: 4 },

  // ── the flavour ones: hidden until you stumble into them ──
  { id: 'monochrome', name: 'Monochrome', desc: 'Win a game playing cards of exactly one element.', icon: '⬛',
    group: 'One-game feats', secret: true, count: p => p.monoWins, goal: 1 },
  { id: 'culling', name: 'The Culling', desc: 'Destroy 10 enemy units in a single game.', icon: '🌾',
    group: 'One-game feats', count: p => p.bestUnitsKilled, goal: 10 },
  { id: 'comeback', name: 'Comeback Kid', desc: 'Win a game on more than 5 life after dropping to 5 or less.', icon: '🫀',
    group: 'One-game feats', secret: true, count: p => p.comebackWins, goal: 1 },
  { id: 'blitz', name: 'Blitz', desc: 'Win a game by turn 5.', icon: '🚀',
    group: 'One-game feats', secret: true, count: p => p.blitzWins, goal: 1 },
  { id: 'full-house', name: 'Full House', desc: 'Hold 15 cards in hand at once.', icon: '🖐️',
    group: 'One-game feats', secret: true, count: p => p.mostCardsInHand, goal: 15 },
  { id: 'pyrrhic', name: 'Pyrrhic Victory', desc: 'Win a game in which you lost 15 or more units.', icon: '⚰️',
    group: 'One-game feats', secret: true, count: p => p.bestUnitsLostInAWin, goal: 15 },

  // ══ further rungs on the career ladders ═════════════════════════════
  { id: 'endurance', name: 'Endurance', desc: 'Play a game that reaches turn 20.', icon: '🐢',
    group: 'Combat', tier: { of: 'Long games', rung: 2 }, count: p => p.longestGameTurns, goal: 20 },
  { id: 'archivist', name: 'Archivist', desc: 'Play 300 different cards.', icon: '🗃️',
    group: 'On the table', tier: { of: 'Different cards', rung: 3 }, count: p => distinct(p.cards), goal: 300 },
  { id: 'frankenstein', name: 'Frankenstein', desc: 'Slide 100 augments or grafts under a unit.', icon: '🧟',
    group: 'On the table', tier: { of: 'Mods applied', rung: 2 }, count: p => p.modsApplied, goal: 100 },
  { id: 'prismatic', name: 'Prismatic Engine', desc: 'Recycle a card for every one of the seven elements.', icon: '💎',
    group: 'Elements', count: p => ELEMENTS.filter(e => (p.recycled[e] ?? 0) > 0).length, goal: ELEMENTS.length },
  { id: 'butterfly', name: 'Social Butterfly', desc: 'Play against 5 different opponents.', icon: '🦋',
    group: 'Formats and people', count: p => Object.keys(p.opponents).length, goal: 5 },
  { id: 'inner-circle', name: 'Inner Circle', desc: 'Make 5 friends.', icon: '👥',
    group: 'Formats and people', tier: { of: 'Friends', rung: 2 }, count: (_p, a) => a.friends.length, goal: 5 },
  { id: 'anniversary', name: 'Anniversary', desc: 'Play games a year or more apart.', icon: '🎂',
    group: 'Formats and people', secret: true, count: p => yearsBetween(p.firstPlayed, p.lastPlayed), goal: 1 },
];

export function evaluateAchievements(profile: Profile, account: Account): AchievementState[] {
  return ACHIEVEMENTS.map(a => {
    let have = 0;
    try { have = a.count(profile, account); } catch { have = 0; }
    if (!Number.isFinite(have)) have = 0;
    // sticky: accounts.ts remembers the unlock, so a later goal change can
    // only ever add achievements, never revoke one
    const earned = have >= a.goal || !!account.achievements[a.id];
    // A secret is redacted HERE, at the only place that turns a definition
    // into something shippable, so no caller can leak one by forgetting to.
    // The progress goes too: "4 / 5" on a hidden row gives away both that it
    // is close and roughly what it counts.
    const hidden = !!a.secret && !earned;
    return {
      id: a.id,
      name: hidden ? '???' : a.name,
      desc: hidden ? 'A secret achievement.' : a.desc,
      icon: hidden ? '❔' : a.icon,
      have: hidden ? 0 : Math.max(0, Math.min(have, a.goal)),
      need: hidden ? 1 : a.goal,
      earned,
      group: a.group,
      ...(a.tier ? { tier: a.tier } : {}),
      ...(hidden ? { hidden: true } : {}),
    };
  });
}
