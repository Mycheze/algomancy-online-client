/* WEEKLY CHALLENGES — the reference-run solver (docs/21 "Reference runs").
 *
 * Plays a challenge with a scripted greedy policy for the player and the
 * real `dummyMove` (via `settleDummy`) for the dummy, then proves the log
 * with `verifyRun`. What it writes is `challenge-runs/<id>.json`, the row's
 * reference run, whose raw score is the row's par (test 506 pins it). Run by
 * hand; nothing on a request path imports it.
 *
 *   node server/challenge-solve.ts <id>                 every policy for the row's goal kind; prints each score
 *   node server/challenge-solve.ts <id> --write         …and writes the best (lowest raw) as challenge-runs/<id>.json
 *        (2026-11-29-hundred: --policy tithe-loop — prickly reaches 100/100 only near 51 units,
 *         where the engine takes seconds an action and a solve takes hours)
 *        [--policy NAME] [--n N] [--turns T] [--trace]  one policy / another n (never written) / a turn cap / every move
 *   node server/challenge-solve.ts --measure [--kind K] [--policy NAME] [--turns 12] [--ns 20,40,100]
 *        each policy with the goal out of reach: its best progress by turn 8 / 12 / 20,
 *        and the score the same log would earn at each n in --ns
 *
 * ⚠ SLOW ON A BIG BOARD. The engine's per-action cost grows with the units in
 * play (the statics are recomputed per query); at ~90 units one action takes
 * seconds, so a measure to turn 20 of a token deck takes hours. --turns 12.
 *
 * THE POLICY IS DATA. A `Policy` is an ordered deck plus a few knobs: the
 * element it recycles into, which names it plays (in priority order), which
 * activated abilities and spell tokens it uses, which cards wait for a crowd
 * (`hold`) or for the moment they finish the goal (`finish`), and whether it
 * attacks. The player loop is generic:
 *   · bottom step: put back the two lowest-priority cards (free — a bottomed
 *     card is never "used")
 *   · planning: activate dormant elements first (from the 3rd one the
 *     affinity bonus mints a dormant Shard), then Prismites, then Shards;
 *     turn active Prismites into the policy's element; recycle ONE card (the
 *     least wanted) at a time while an activation is left — so from turn 2
 *     one recycled card buys two mana
 *   · a window with a play in it: the highest-priority allowed play, then a
 *     mod, then an allowed activation / token cast, else finish the step
 *   · a question: a number at its largest; a variable cost paid in full
 *     unless that ends the game; anything else by what the effect will have
 *     done once it has resolved (a rollout: the player's questions, the
 *     dummy's moves and the player's passes, until the table is quiet)
 *   · combat: no attack unless the policy says 'probe' (the weakest unit, so
 *     battle-speed cards get a window) or 'all'; never a block
 *   · a policy's `pick` hook, when it has one, is asked first and may name
 *     the move itself (a scripted line: the puzzles whose order is the point)
 * Before each move it looks for a move that meets the goal outright and takes
 * it — the run ends on that action.
 *
 * The scripted logic lives here on purpose: the engine knows nothing of
 * policies.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import '../engine/src/cards/registry.ts';
import { apply, createGame, legalActions } from '../engine/src/apply.ts';
import { E } from '../engine/src/engine.ts';
import {
  DUMMY, DUMMY_DECK, PLAYER, challengeDeal, dummyMove, foldRun, progress, newChallengeGame, newRun, scoreRun, settleDummy, verifyRun,
  type ChallengeDef, type Goal, type RunAcc, type RunScore,
} from '../engine/src/challenge.ts';
import type { Action, CardName, EngineEvent, GameState, ResourceKind } from '../engine/src/types.ts';
import { CHALLENGES, REFERENCE_RUNS_DIR, challengeById } from './challenges.ts';

/** what a policy's `pick` hook sees: the state, the player's legal moves (no
 * concede), the player, the run so far, and the row */
export interface PickCtx { s: GameState; legal: Action[]; p: GameState['players'][number]; acc: RunAcc; def: ChallengeDef;
  /** the card a hand/bin/cache index names, for the move given */
  cardOf: (a: Action) => CardName | undefined }

export interface Policy {
  name: string;
  /** asked before the generic loop: a move, or undefined to let the loop choose */
  pick?: (c: PickCtx) => Action | undefined;
  deck: CardName[];
  /** the element every recycle and every Prismite turns into, or one per resource in order (the last repeats) */
  element: ResourceKind | ResourceKind[];
  /** stop recycling once the player has this many resources (Shards and Prismites included) */
  maxResources?: number;
  /** the names played, highest priority first; nothing else is ever played */
  play: CardName[];
  /** names applied as a mod (augment), with the host picked by lookahead */
  augment?: CardName[];
  /** names whose activated abilities are used as often as the engine allows (30 a turn each) */
  activate?: CardName[];
  /** names whose activated abilities are used only when the played-out result moves the goal or the board */
  activateIfGain?: CardName[];
  /** a variable cost ("pay X") is paid in full unless this is false */
  more?: boolean;
  /** spell tokens cast (by name), e.g. Crystal */
  cast?: CardName[];
  /** 'probe': attack with the one unit with the least power (a battle, so battle-speed cards get a
   * window, for a point or two of the dummy's 99); 'all': attack with everything; default: never attack */
  attack?: 'probe' | 'all';
  /** names recycled before anything else; otherwise the lowest-priority card goes */
  fodder?: CardName[];
  /** names played only when the played-out result meets the goal (a pump that lasts until regroup) */
  finish?: CardName[];
  /** never play a card over one of the player's own effects: let the stack resolve first (a
   * Life Channel cast over Equilibriate would count the life before Equilibriate gave it) */
  resolveFirst?: boolean;
  /** names never recycled (the one card the deck is built around) */
  neverRecycle?: CardName[];
  /** activateIfGain counts only the goal moving, not a better board */
  goalOnly?: boolean;
  /** names in `play` played only while the player controls none of that name (a single host) */
  single?: boolean;
  /** names grafted (from hand or bin) onto the player's `graftHost`, when no gainful activation is left */
  graft?: CardName[];
  graftHost?: CardName;
  /** names never recycled or bottomed while another card will do (cards the policy plays some
   * other way than `play`: a `finish`, a combo piece) */
  keep?: CardName[];
  /** a name held until the player controls at least this many units (All-Consuming Blight waits for a crowd) */
  hold?: Record<CardName, number>;
}

const rep = (name: CardName, n: number): CardName[] => Array<CardName>(n).fill(name);
const interleave = (...lists: CardName[][]): CardName[] => {
  const out: CardName[] = [];
  for (let i = 0; lists.some(l => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
};

// ── the policies ──────────────────────────────────────────────────────

/** a deck written as runs of copies, top first: seq(['A', 2], ['B', 1]) = A A B */
const seq = (...runs: [CardName, number][]): CardName[] => runs.flatMap(([n, k]) => rep(n, k));

/** wood cards that are only ever recycled: two of each, so a pair costs one card */
const WOOD_FODDER = seq(['Sprouter', 2], ['Ralph', 2], ['Warbloom Herald', 2], ['Guardian of the Grotto', 2], ['Mycelial Mentor', 2], ['Spawning Ground', 2], ['Mindspore Fiend', 2], ['Corrupting Blight', 2]);

export const POLICIES: Record<Goal['kind'], Policy[]> = {
  unitsInPlay: [
    {
      name: 'grove2',
      deck: interleave(
        seq(['Pathogenic Enclave', 2], ['Pack Leader', 2], ['Bloomcaster', 2], ['Sylvan Sprouting', 2], ['Accelerated Germination', 2]),
        WOOD_FODDER,
      ),
      element: 'wood', fodder: WOOD_FODDER,
      play: ['Pack Leader', 'Sylvan Sprouting', 'Pathogenic Enclave', 'Bloomcaster', 'Accelerated Germination'],
      activate: ['Pack Leader'],
    },
    {
      name: 'wisps',
      deck: interleave(rep('Infernal Wispweaver', 20), rep('Spectrogenesis', 20)),
      element: 'fire', play: ['Spectrogenesis', 'Infernal Wispweaver'],
    },
  ],
  spellTokens: [
    {
      name: 'blight4',
      deck: interleave(
        seq(['Pathogenic Enclave', 2], ['Pack Leader', 2], ['Bloomcaster', 2], ['Sylvan Sprouting', 2], ['All-Consuming Blight', 10]),
        WOOD_FODDER, WOOD_FODDER,
      ),
      element: 'wood', fodder: WOOD_FODDER, hold: { 'All-Consuming Blight': 16 },
      play: ['All-Consuming Blight', 'Pack Leader', 'Sylvan Sprouting', 'Pathogenic Enclave', 'Bloomcaster'],
      activate: ['Pack Leader'],
    },
    {
      name: 'fireballs',
      deck: interleave(
        seq(['Flame Juggle', 2], ['Molten Riftbreaker', 2], ['Harbinger of Immolation', 2], ['Ignis Sprite', 2], ['Spectrogenesis', 2]),
        seq(['Infernal Cultivator', 2], ['Oracle of the Flame', 2], ['Molten Upheaval', 2], ['Animated Spark', 2], ['Sparkwraith', 2]),
        seq(['Cinder Scuttler', 2], ['Spiteful Shadow', 2], ['Infernal Wispweaver', 2], ['Hooba-Lin', 2], ['Static Courier', 2]),
      ),
      element: 'fire',
      play: ['Harbinger of Immolation', 'Flame Juggle', 'Molten Riftbreaker', 'Infernal Cultivator', 'Spectrogenesis', 'Ignis Sprite', 'Oracle of the Flame', 'Molten Upheaval'],
      activate: ['Oracle of the Flame', 'Infernal Cultivator'],
    },
  ],
  unitSize: [
    {
      name: 'prickly',
      deck: interleave(
        seq(['Pathogenic Enclave', 2], ['Prickly Protector', 2], ['Pack Leader', 2], ['Might of the Grove', 2], ['Sylvan Sprouting', 2], ['Bloomcaster', 2], ['Accelerated Germination', 2]),
        WOOD_FODDER,
      ),
      element: 'wood', fodder: WOOD_FODDER,
      play: ['Prickly Protector', 'Pack Leader', 'Might of the Grove', 'Sylvan Sprouting', 'Pathogenic Enclave', 'Bloomcaster', 'Accelerated Germination'],
      activate: ['Pack Leader'], attack: 'probe', finish: ['Might of the Grove'],
    },
    {
      name: 'tithe',
      deck: seq(['Vroot', 2], ['Flesh Tithe', 2], ['Debt Blep', 2], ['Stalwart Sentinel', 2], ['Hand Peeper', 2], ['Riftspawn Remnant', 2], ['Prismatic Observer', 2]),
      element: 'light', play: ['Flesh Tithe'],
    },
    {
      name: 'shifter',
      deck: seq(['Celestial Shifter', 2], ['Nebula Drifter', 2], ['Recyclable Sentinel', 2], ['Refuse Reclaimer', 2], ['Astralith', 2], ['Monke', 2], ['Eldritch Dreamtender', 2], ['Self-Assembly', 2], ['Body Swap', 2], ['Unmake', 2], ['Unstable Refactor', 2], ['Discharge', 2], ['Worldbender', 2], ['A Pile of Rubbish', 2], ['Biomass Devourer', 2]),
      element: 'metal', play: ['Celestial Shifter'], activateIfGain: ['Celestial Shifter'],
    },
    {
      // Something Big at 80/80: Equilibriate lifts 30 to 64 (the dummy's 99
      // pulls it up), Flesh Tithe pays 63 of it for a 63/63, and the next
      // battle's second Equilibriate and two Life Channels pump it past 80
      // before combat damage. Solve with --policy tithe-loop: prickly reaches
      // 80/80 only on turn 11, on a board whose replay takes 14 s
      name: 'tithe-loop',
      deck: [
        'Hand Peeper', ...rep('Seer of Empty Spaces', 2), 'Reap the Due',
        'Equilibriate', 'Reap the Due', ...rep('Retribution Thing', 2),
        ...rep('Insatiable Want', 2), ...rep('Divine Foresight', 2),
        'Equilibriate', ...rep('Penance', 2), 'Hand Peeper',
        'Flesh Tithe', ...rep('Life Channel', 2), 'Flesh Tithe',
        ...rep('Shard Sprite', 2), ...rep('Prismatic Observer', 2),
      ],
      element: ['light', 'wood', 'light'],
      fodder: seq(['Seer of Empty Spaces', 2], ['Reap the Due', 2], ['Retribution Thing', 2], ['Insatiable Want', 2], ['Divine Foresight', 2], ['Penance', 2], ['Shard Sprite', 2], ['Prismatic Observer', 2]),
      play: ['Equilibriate', 'Life Channel', 'Flesh Tithe', 'Hand Peeper'], attack: 'all', resolveFirst: true,
    },
  ],
  counters: [
    {
      name: 'flora',
      deck: interleave(
        seq(['Flourishing Flora', 2], ['Pathogenic Enclave', 2], ['Pack Leader', 2], ['Bloomcaster', 2], ['Sylvan Sprouting', 2], ['Accelerated Germination', 2]),
        WOOD_FODDER,
      ),
      element: 'wood', fodder: WOOD_FODDER,
      play: ['Flourishing Flora', 'Pack Leader', 'Sylvan Sprouting', 'Bloomcaster', 'Pathogenic Enclave', 'Accelerated Germination'],
      activate: ['Pack Leader'],
    },
    {
      name: 'robots',
      deck: interleave(
        seq(['Powerforge Synergist', 2], ['Self-Assembly', 2], ['Living Forge', 2], ['Synaptic Energizer', 2], ['Celestial Fluxmorph', 2], ['Manufacture', 2]),
        seq(['Recyclable Sentinel', 2], ['Construct Overseer', 2], ['Nebula Drifter', 2], ['Refuse Reclaimer', 2], ['Astralith', 2], ['Monke', 2]),
        seq(['Eldritch Dreamtender', 2], ['Body Swap', 2], ['Unmake', 2], ['Unstable Refactor', 2], ['Worldbender', 2], ['A Pile of Rubbish', 2]),
      ),
      element: 'metal',
      play: ['Manufacture', 'Living Forge', 'Synaptic Energizer', 'Self-Assembly', 'Celestial Fluxmorph', 'Powerforge Synergist', 'Construct Overseer', 'Recyclable Sentinel'],
      activate: ['Living Forge'],
    },
  ],
  unitsPlayed: [
    {
      name: 'species',
      deck: interleave(
        seq(['Invasive Species', 2], ['Sprouter', 2], ['Mycelial Mentor', 2], ['Ralph', 2], ['Warbloom Herald', 2]),
        seq(['Tidepool Terror', 2], ['Bloated Manablub', 2], ['Curio Drifter', 2], ['Whispering Mantid', 2], ['Rider of the Tides', 2]),
        seq(['Guardian of the Grotto', 2], ['Mindspore Fiend', 2], ['Prickly Protector', 2], ['Flourishing Flora', 2], ['Corrupting Blight', 2]),
      ),
      element: ['water', 'wood'],
      play: ['Invasive Species', 'Sprouter', 'Mycelial Mentor', 'Warbloom Herald', 'Tidepool Terror', 'Bloated Manablub', 'Curio Drifter', 'Whispering Mantid', 'Rider of the Tides', 'Guardian of the Grotto', 'Mindspore Fiend', 'Prickly Protector', 'Flourishing Flora', 'Corrupting Blight'],
    },
    {
      name: 'wood-swarm',
      deck: interleave(
        seq(['Sprouter', 2], ['Mycelial Mentor', 2], ['Ralph', 2], ['Warbloom Herald', 2], ['Guardian of the Grotto', 2]),
        seq(['Growing Plague', 2], ['Mindspore Fiend', 2], ['Prickly Protector', 2], ['Flourishing Flora', 2], ['Corrupting Blight', 2]),
      ),
      element: 'wood',
      play: ['Growing Plague', 'Sprouter', 'Mycelial Mentor', 'Warbloom Herald', 'Guardian of the Grotto', 'Prickly Protector', 'Flourishing Flora'],
    },
  ],
  tokenSet: [
    {
      // the grove crowd, then Cosmic Conspirator ("if you would create a
      // Robot, Poison, Crystal or Fireball, you may instead create a token of
      // any of these types") under one All-Consuming Blight: a Poison for each
      // unit, each one asked which of the four it should be
      name: 'conspiracy',
      deck: [
        ...interleave(
          seq(['Pathogenic Enclave', 2], ['Pack Leader', 2], ['Bloomcaster', 2], ['Sylvan Sprouting', 2], ['Accelerated Germination', 2], ['Cosmic Conspirator', 1], ['All-Consuming Blight', 2]),
          WOOD_FODDER,
        ),
      ],
      element: ['wood', 'metal', 'wood'], fodder: WOOD_FODDER,
      play: ['Pack Leader', 'Cosmic Conspirator', 'Sylvan Sprouting', 'Pathogenic Enclave', 'Bloomcaster', 'Accelerated Germination'],
      single: true, finish: ['All-Consuming Blight'], keep: ['All-Consuming Blight'],
      activate: ['Pack Leader'],
    },
  ],
  drawsInTurn: [
    {
      // a board that draws when it attacks: four Luminary Leaders ("when I
      // attack in a formation of four or more units, draw") and four
      // Dreamfloat Drifters ("when I attack, you and target opponent each
      // draw"); the turn they all attack, the card step's 4 and three
      // Invigorates held for that battle make 15
      name: 'draw-attack',
      deck: [
        ...interleave(
          seq(['Luminary Leader', 4], ['Dreamfloat Drifter', 4]),
          seq(['Sprouter', 2], ['Ralph', 2], ['Warbloom Herald', 2], ['Tidepool Terror', 2], ['Curio Drifter', 2], ['Mycelial Mentor', 2], ['Whispering Mantid', 2]),
        ),
        ...interleave(rep('Invigorate', 3), seq(['Guardian of the Grotto', 2], ['Mindspore Fiend', 2], ['Rider of the Tides', 2], ['Bloated Manablub', 2])),
        ...seq(['Sprouter', 2], ['Ralph', 2], ['Warbloom Herald', 2], ['Tidepool Terror', 2]),
      ],
      element: ['wood', 'water', 'wood'],
      fodder: seq(['Sprouter', 2], ['Ralph', 2], ['Warbloom Herald', 2], ['Tidepool Terror', 2], ['Curio Drifter', 2], ['Mycelial Mentor', 2], ['Whispering Mantid', 2],
        ['Guardian of the Grotto', 2], ['Mindspore Fiend', 2], ['Rider of the Tides', 2], ['Bloated Manablub', 2]),
      play: ['Luminary Leader', 'Dreamfloat Drifter'], keep: ['Invigorate'], attack: 'all',
      // the Invigorates wait for the battle that can reach the goal with them
      pick: ({ s, legal, acc, def, cardOf }) => {
        if (def.goal.kind !== 'drawsInTurn' || !s.battle) return undefined;
        const inv = legal.filter(a => a.type === 'playCard' && cardOf(a) === 'Invigorate');
        if (!inv.length) return undefined;
        const now = acc.draws && acc.draws.turn === s.turn ? acc.draws.n : 0;
        const held = s.players[PLAYER]!.hand.filter(n => n === 'Invigorate').length;
        return now + held >= def.goal.n && s.stack.length === 0 ? inv[0] : undefined;
      },
    },
  ],
  manaSpent: [
    {
      // the emblem lets every recycled card be opened the turn it is
      // recycled; Celestial Shifter's "[x]: I become base X/X" drinks
      // whatever is open, as often as there is mana
      name: 'shifter-sink',
      deck: [
        'Celestial Shifter',
        ...seq(['Nebula Drifter', 2], ['Refuse Reclaimer', 2], ['Astralith', 2], ['Monke', 2], ['Eldritch Dreamtender', 2],
          ['A Pile of Rubbish', 2], ['Unmake', 2], ['Recyclable Sentinel', 2], ['Construct Overseer', 2], ['Synaptic Energizer', 2],
          ['Void Memory', 2], ['Technological Superiority', 2], ['Body Swap', 2], ['Scrap For Parts', 2], ['Worldbender', 2]),
      ],
      element: 'metal',
      fodder: seq(['Nebula Drifter', 2], ['Refuse Reclaimer', 2], ['Astralith', 2], ['Monke', 2], ['Eldritch Dreamtender', 2],
        ['A Pile of Rubbish', 2], ['Unmake', 2], ['Recyclable Sentinel', 2], ['Construct Overseer', 2], ['Synaptic Energizer', 2],
        ['Void Memory', 2], ['Technological Superiority', 2], ['Body Swap', 2], ['Scrap For Parts', 2], ['Worldbender', 2]),
      play: ['Celestial Shifter'], single: true, activateIfGain: ['Celestial Shifter'], goalOnly: true, neverRecycle: ['Celestial Shifter'],
    },
  ],
  life: [
    {
      // Equilibriate lifts 30 to 64 (the dummy's 99 pulls it up), Flesh Tithe
      // pays 63 for a 63/63, and Stellar Fission erases it in the next battle:
      // "its controller gains life equal to its power plus its defense"
      name: 'fission',
      deck: [
        'Hand Peeper', ...rep('Seer of Empty Spaces', 2), 'Reap the Due',
        'Equilibriate', 'Reap the Due', ...rep('Retribution Thing', 2),
        ...rep('Insatiable Want', 2), ...rep('Divine Foresight', 2),
        'Stellar Fission', ...rep('Penance', 2), 'Hand Peeper',
        'Flesh Tithe', 'Stellar Fission', ...rep('Shard Sprite', 2), 'Flesh Tithe',
        ...rep('Prismatic Observer', 2),
      ],
      element: ['light', 'wood', 'light'],
      fodder: seq(['Seer of Empty Spaces', 2], ['Reap the Due', 2], ['Retribution Thing', 2], ['Insatiable Want', 2], ['Divine Foresight', 2], ['Penance', 2], ['Shard Sprite', 2], ['Prismatic Observer', 2]),
      play: ['Equilibriate', 'Flesh Tithe', 'Hand Peeper'], finish: ['Stellar Fission'], keep: ['Stellar Fission'],
      attack: 'all', resolveFirst: true,
    },
  ],
  stackDepth: [
    {
      // a crowd of 30, one All-Consuming Blight (a Poison for each unit),
      // then every Poison cast in one battle window, each over the last:
      // the dummy passes and nothing resolves until the player passes too
      name: 'poison-stack',
      deck: interleave(
        seq(['Pathogenic Enclave', 2], ['Pack Leader', 2], ['Bloomcaster', 2], ['Sylvan Sprouting', 2], ['All-Consuming Blight', 2]),
        WOOD_FODDER,
      ),
      element: 'wood', fodder: WOOD_FODDER, hold: { 'All-Consuming Blight': 30 },   // the goal's 30 (a Poison a unit)
      play: ['All-Consuming Blight', 'Pack Leader', 'Sylvan Sprouting', 'Pathogenic Enclave', 'Bloomcaster'],
      activate: ['Pack Leader'], attack: 'probe', keep: ['All-Consuming Blight'],
      pick: ({ s, legal, def }) => {
        const want = def.goal.kind === 'stackDepth' ? def.goal.n : 30;
        if (s.decision?.seat === PLAYER && /Poison/.test(s.decision.prompt) && s.decision.options.length) {
          return { type: 'decide', seat: PLAYER, choice: 0 };
        }
        if (!s.battle) return undefined;
        // the Poisons ride the attack into the battle's region (a spell token is
        // cast where it is), beside the weakest unit, once there are enough
        if (legal.some(a => a.type === 'declareAttack')) {
          const poisons = Object.values(s.entities).filter(e => e && e.kind === 'spellToken' && e.card === 'Poison' && e.controller === PLAYER);
          const unit = Object.values(s.entities).find(e => e && e.kind === 'unit' && e.controller === PLAYER
            && legal.some(a => a.type === 'declareAttack' && a.columns.length === 1 && a.columns[0]![0] === e.id));
          if (poisons.length >= want && unit) return { type: 'declareAttack', seat: PLAYER, columns: [[unit.id]], spellTokens: poisons.map(e => e.id) };
          return undefined;
        }
        return legal.find(a => a.type === 'castSpellToken' && s.entities[a.entityId]?.card === 'Poison');
      },
    },
  ],
  dummyWins: [
    {
      // Spirit of Vengeance ("whenever a unit dies, I deal 1 damage to each
      // opponent") attacks beside a Sprouter; Rebalance hands the Spirit to
      // the dummy, and the Sprouter sacrifices itself — at 1 life (Flesh
      // Tithe paid the rest), the dummy's Spirit deals the last point
      name: 'vengeance',
      deck: [
        'Spirit of Vengeance', 'Sprouter', ...rep('Ignis Sprite', 2),
        'Flesh Tithe', 'Rebalance', ...rep('Cinder Scuttler', 2),
        ...rep('Seer of Empty Spaces', 2), ...rep('Reap the Due', 2), ...rep('Retribution Thing', 2),
        ...rep('Insatiable Want', 2), ...rep('Divine Foresight', 2), ...rep('Penance', 2),
      ],
      element: ['fire', 'fire', 'light', 'wood', 'light'],
      fodder: seq(['Ignis Sprite', 2], ['Cinder Scuttler', 2], ['Seer of Empty Spaces', 2], ['Reap the Due', 2], ['Retribution Thing', 2], ['Insatiable Want', 2], ['Divine Foresight', 2], ['Penance', 2]),
      play: ['Spirit of Vengeance', 'Sprouter', 'Flesh Tithe'], keep: ['Rebalance'],
      pick: ({ s, legal, p, cardOf }) => {
        const mine = (card: CardName) => Object.values(s.entities).find(e => e && e.kind === 'unit' && e.card === card && e.controller === PLAYER);
        const theirs = (card: CardName) => Object.values(s.entities).find(e => e && e.kind === 'unit' && e.card === card && e.controller === DUMMY);
        const sov = mine('Spirit of Vengeance'), sprout = mine('Sprouter');
        // a question: hand over the Spirit
        if (s.decision?.seat === PLAYER && /Rebalance/.test(s.decision.prompt)) {
          const i = s.decision.options.findIndex(o => /Spirit of Vengeance/.test(o.label));
          if (i >= 0) return { type: 'decide', seat: PLAYER, choice: i };
        }
        if (legal.some(a => a.type === 'declareAttack')) {
          const go = sov && sprout && p.life <= 1 && p.hand.includes('Rebalance');
          return go ? { type: 'declareAttack', seat: PLAYER, columns: [[sov!.id], [sprout!.id]] }
            : legal.find(a => a.type === 'declareAttack' && a.columns.length === 0 && !a.spellTokens?.length);
        }
        if (s.battle && s.stack.length === 0) {
          // the Spirit is still ours: Rebalance; it is the dummy's: the Sprouter dies
          if (sov) return legal.find(a => a.type === 'playCard' && cardOf(a) === 'Rebalance');
          if (theirs('Spirit of Vengeance') && sprout) return legal.find(a => a.type === 'activateAbility' && a.entityId === sprout.id);
        }
        return undefined;
      },
    },
  ],
  oneShot: [
    {
      // Flesh Tithe pays 29 for a 29/29; it attacks alone, Life Channel makes
      // it 32/32 and Burgeon doubles its power: one hit of 64 into 60
      name: 'tithe-burgeon',
      deck: [
        'Flesh Tithe', ...rep('Seer of Empty Spaces', 2), 'Reap the Due',
        'Life Channel', 'Burgeon', 'Reap the Due', ...rep('Retribution Thing', 2),
        ...rep('Insatiable Want', 2), ...rep('Divine Foresight', 2), ...rep('Penance', 2),
        ...rep('Shard Sprite', 2), ...rep('Prismatic Observer', 2),
      ],
      element: ['light', 'wood', 'light'],
      fodder: seq(['Seer of Empty Spaces', 2], ['Reap the Due', 2], ['Retribution Thing', 2], ['Insatiable Want', 2], ['Divine Foresight', 2], ['Penance', 2], ['Shard Sprite', 2], ['Prismatic Observer', 2]),
      play: ['Flesh Tithe', 'Life Channel', 'Burgeon'], keep: ['Life Channel', 'Burgeon'], resolveFirst: true,
      // attack only with the Tithe's unit, and only when both pumps are in hand
      pick: ({ s, legal, p }) => {
        if (!legal.some(a => a.type === 'declareAttack')) return undefined;
        const big = Object.values(s.entities).find(e => e && e.kind === 'unit' && e.controller === PLAYER && e.card !== 'Seer of Empty Spaces');
        const ready = big && p.hand.includes('Life Channel') && p.hand.includes('Burgeon')
          && legal.some(a => a.type === 'declareAttack' && a.columns.length === 1 && a.columns[0]![0] === big.id);
        return ready ? { type: 'declareAttack', seat: PLAYER, columns: [[big!.id]] }
          : legal.find(a => a.type === 'declareAttack' && a.columns.length === 0 && !a.spellTokens?.length);
      },
    },
  ],
  graftLadder: [
    {
      // an Omniwield Evoker ("[three]: [Switch] put a +1/+1 counter on me") is
      // a graft cause that fires on demand: fire it, graft one more, fire
      // again. A bounded graft (Recyclable Sentinel's [Switch1]) joins only the
      // first firing of a turn (CR 722.5a), so a turn can fire two sizes
      name: 'evoker-ladder',
      deck: [
        ...interleave(
          seq(['Omniwield Evoker', 1], ['Sprouter', 2], ['Guardian of the Grotto', 2], ['Warbloom Herald', 2], ['Sudden Bloom', 3], ['Construct Overseer', 2]),
          seq(['Nebula Drifter', 2], ['Refuse Reclaimer', 2], ['Astralith', 2], ['Monke', 2], ['Eldritch Dreamtender', 2], ['A Pile of Rubbish', 2], ['Unmake', 2], ['Body Swap', 2]),
        ),
        ...seq(['Void Memory', 2], ['Worldbender', 2], ['Scrap For Parts', 2], ['Technological Superiority', 2]),
      ],
      element: ['metal', 'metal', 'wood', 'metal'], maxResources: 10,
      fodder: seq(['Nebula Drifter', 2], ['Refuse Reclaimer', 2], ['Astralith', 2], ['Monke', 2], ['Eldritch Dreamtender', 2], ['A Pile of Rubbish', 2], ['Unmake', 2], ['Body Swap', 2],
        ['Void Memory', 2], ['Worldbender', 2], ['Scrap For Parts', 2], ['Technological Superiority', 2]),
      play: ['Omniwield Evoker'], single: true,
      neverRecycle: ['Omniwield Evoker', 'Sprouter', 'Guardian of the Grotto', 'Warbloom Herald', 'Sudden Bloom', 'Construct Overseer'],
      keep: ['Sprouter', 'Guardian of the Grotto', 'Warbloom Herald', 'Sudden Bloom', 'Construct Overseer'],
      pick: ({ s, legal, acc, def, cardOf }) => {
        if (def.goal.kind !== 'graftLadder' || s.phase !== 'deploy' || s.decision) return undefined;
        const top = def.goal.n;
        const host = Object.values(s.entities).find(e => e && e.kind === 'unit' && e.controller === PLAYER && e.card === 'Omniwield Evoker');
        if (!host) return undefined;
        const have = new Set(acc.graftSizes ?? []);
        const fresh = (r: Sim | null): number | null => {
          const k = (r?.acc.graftSizes ?? []).find(n => !have.has(n) && n <= top);
          return k ?? null;
        };
        const fireIn = (st: GameState) => legalActions(st, PLAYER).find(x => x.type === 'activateAbility' && x.entityId === host.id);
        const fire = legal.find(x => x.type === 'activateAbility' && x.entityId === host.id);
        if (fire && fresh(trySim(acc, s, fire)) !== null) return fire;
        // a graft (or two: a spent bounded graft leaves one more graft at the
        // size already fired) whose next firing is a new size: the smallest
        // such size. Where a graft sits in the composite does not change its
        // size, so one position per card name is enough
        const grafts = (st: GameState): Action[] => {
          const seen = new Set<string>();
          const pl = st.players[PLAYER]!;
          return legalActions(st, PLAYER).filter(x => {
            if (x.type !== 'graft' || x.hostId !== host.id) return false;
            const name = x.from === 'bin' ? pl.bin[x.index] : x.from === 'hand' ? pl.hand[x.index] : pl.cache?.[x.index]?.card;
            const key = `${x.from}:${name}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        };
        let best: Action | undefined, bestK = Infinity;
        for (const g of grafts(s)) {
          const r = trySim(acc, s, g);
          if (!r) continue;
          const f = fireIn(r.state);
          let k = f ? fresh(trySim(r.acc, r.state, f)) : null;
          if (k === null) {
            for (const g2 of grafts(r.state)) {
              const r2 = trySim(r.acc, r.state, g2);
              const f2 = r2 && fireIn(r2.state);
              const k2 = f2 ? fresh(trySim(r2!.acc, r2!.state, f2)) : null;
              if (k2 !== null && (k === null || k2 < k)) k = k2;
            }
          }
          if (k !== null && k < bestK) { bestK = k; best = g; }
        }
        if (best) return best;
        // fire for nothing new, when the firing after it is new (a bounded graft spent)
        if (fire) {
          const r = trySim(acc, s, fire);
          const f2 = r && fireIn(r.state);
          if (f2 && fresh(trySim(r!.acc, r!.state, f2)) !== null) return fire;
        }
        void cardOf;
        return undefined;
      },
    },
  ],
};

// ── the player ────────────────────────────────────────────────────────

const myUnits = (s: GameState) => Object.values(s.entities).filter(e => e && e.kind === 'unit' && e.controller === PLAYER);

/** the board's secondary score, for the lookahead's tie-breaks */
function boardScore(s: GameState): number {
  const q = new E(s);
  let best = 0, sum = 0;
  for (const u of myUnits(s)) {
    let st: [number, number];
    try { st = q.effStats(u); } catch { continue; }
    best = Math.max(best, Math.min(st[0], st[1]));
    sum += st[0] + st[1];
  }
  return best * 1000 + sum + myUnits(s).length;
}

interface Sim { acc: RunAcc; state: GameState }
/** how good a simulated result is: the goal first, then the board; a game
 * that ends is the worst result there is (a dead dummy fails the run) */
function rate(r: Sim): number {
  if (r.state.phase === 'gameover') return -Infinity;
  return r.acc.value * 1e6 + boardScore(r.state);
}
function trySim(acc: RunAcc, s: GameState, a: Action): Sim | null {
  try {
    const r = apply(s, a);
    return { acc: foldRun(acc, s, a, r.state, r.events), state: r.state };
  } catch { return null; }
}

/**
 * The player's answer to its own open question.
 *   · a number: the largest value apply accepts that does not end the game
 *   · a variable cost ("Pay 1 more … / That's enough"): keep paying while it
 *     neither fails nor ends the game (the engine closes it when nothing more
 *     can be paid) — unless the policy says `more: false`
 *   · anything else: one ply of lookahead, first option on a tie
 */
function answer(s: GameState, acc: RunAcc, policy: Policy, deep = false): Action | undefined {
  const d = s.decision;
  if (!d || d.seat !== PLAYER) return undefined;
  if (d.numeric) {
    const hi = d.numeric.max ?? Math.max(d.numeric.suggest, 60);
    for (let x = hi; x >= d.numeric.min && x >= hi - 120; x--) {
      const a: Action = { type: 'decide', seat: PLAYER, choice: x };
      const r = trySim(acc, s, a);
      if (r && rate(r) > -Infinity) return a;
    }
  }
  // an ordering (simultaneous triggers): as offered
  if (d.pickOrder) return { type: 'decide', seat: PLAYER, choice: d.options.map((_, i) => i) };
  const opts: Action[] = d.options.map((_, i) => ({ type: 'decide', seat: PLAYER, choice: i }));
  if (!opts.length) return undefined;
  const done = d.options.findIndex(o => !!o.value && typeof o.value === 'object' && 'doneCost' in (o.value as object));
  if (done >= 0) {
    if (policy.more !== false) {
      for (const [i, a] of opts.entries()) {
        if (i === done) continue;
        const r = trySim(acc, s, a);
        if (r && rate(r) > -Infinity) return a;
      }
    }
    return opts[done];
  }
  // at the top, a target is judged by what the effect will have done once it
  // has resolved (a pump lands later); inside a rollout, one ply is enough
  let best: Action | undefined, bestV = -Infinity;
  for (const a of opts) {
    const r = deep && opts.length > 1 ? rollout(acc, s, a, policy) : trySim(acc, s, a);
    if (!r) continue;
    const v = rate(r);
    if (best === undefined || v > bestV) { bestV = v; best = a; }
  }
  return best ?? opts[0];
}

/** Apply `a`, then play it out: the player's questions answered by
 * `answer`, the dummy's by `dummyMove`, the player passing while the stack
 * holds something — until the table is quiet. What a play or an activation
 * will have done once it has resolved, which a one-ply look cannot see. */
function rollout(acc: RunAcc, s0: GameState, a: Action, policy: Policy, deepFirst = false): Sim | null {
  let r = trySim(acc, s0, a);
  let deep = deepFirst;
  for (let i = 0; r && i < 300 && r.state.phase !== 'gameover'; i++) {
    const s = r.state;
    let next: Action | undefined;
    // deepFirst: the play's own first question (its target) is judged by
    // what the effect will have done, as a top-level answer is
    if (s.decision?.seat === PLAYER) { next = answer(s, r.acc, policy, deep); deep = false; }
    else if (s.decision || s.stack.length) {
      const dl = legalActions(s, DUMMY);
      if (dl.length) next = dummyMove(s, dl);
      else if (s.stack.length) next = legalActions(s, PLAYER).find(x => x.type === 'passPriority');
    }
    if (!next) break;
    const n = trySim(r.acc, s, next);
    if (!n) break;
    r = n;
  }
  return r;
}

export interface Played {
  actions: Action[];
  acc: RunAcc;
  /** the best progress seen during each turn (index = turn) */
  byTurn: number[];
  error?: string;
}

/**
 * Play `policy` against `def`'s goal until it is met, `maxTurns` passes, or
 * the game ends. Returns the whole log (both seats, as the Harness recorded
 * it) and the fold over it.
 */
export function play(def: ChallengeDef, policy: Policy, maxTurns = 30, trace = false): Played {
  const h = newChallengeGame(def, policy.deck);
  // newChallengeGame settled the dummy before handing the harness over:
  // fold those recorded moves from the bare deal
  let acc = foldLog(def, policy.deck, h.actions);
  const rank = new Map<CardName, number>();
  policy.play.forEach((n, i) => rank.set(n, 100 - i));
  for (const n of policy.augment ?? []) if (!rank.has(n)) rank.set(n, 50);
  for (const n of policy.keep ?? []) if (!rank.has(n)) rank.set(n, 60);
  for (const n of policy.graft ?? []) if (!rank.has(n)) rank.set(n, 50);
  const fodder = new Set(policy.fodder ?? []);
  const value = (n: CardName): number => fodder.has(n) ? 0 : (rank.get(n) ?? 1);
  const elementFor = (k: number): ResourceKind => {
    const els = Array.isArray(policy.element) ? policy.element : [policy.element];
    return els[Math.min(k, els.length - 1)]!;
  };
  const byTurn: number[] = [];
  const note = (): void => {
    const t = h.state.turn;
    while (byTurn.length <= t) byTurn.push(byTurn.length ? byTurn[byTurn.length - 1]! : 0);
    byTurn[t] = Math.max(byTurn[t]!, acc.value);
  };
  let uses = new Map<string, number>();
  let useTurn = 0;
  const out = (error?: string): Played => ({ actions: h.actions, acc, byTurn, ...(error ? { error } : {}) });

  const doAct = (a: Action): void => {
    const before = h.state;
    const ev: EngineEvent[] = h.do(a);
    acc = foldRun(acc, before, a, h.state, ev);
    note();
  };

  for (let step = 0; step < 20000 && !acc.met && h.state.phase !== 'gameover'; step++) {
    // the dummy: settleDummy, then its moves folded on the saved state
    const before = h.state;
    const n0 = h.actions.length;
    settleDummy(h);
    if (h.actions.length > n0) {
      let st = before;
      for (const a of h.actions.slice(n0)) {
        const r = apply(st, a);
        acc = foldRun(acc, st, a, r.state, r.events);
        st = r.state;
      }
      note();
      if (acc.met || (h.state.phase as string) === 'gameover') break;
    }
    const s = h.state;
    if (s.turn > maxTurns) break;
    if (s.turn !== useTurn) { useTurn = s.turn; uses = new Map(); }
    const legal = h.legal(PLAYER).filter(a => a.type !== 'concede');
    if (!legal.length) return out(`the player has no move (turn ${s.turn}, ${s.phase})`);
    const p = s.players[PLAYER]!;

    // anything that meets the goal right now
    const cheap = legal.filter(a => a.type === 'playCard' || a.type === 'activateAbility' || a.type === 'castSpellToken'
      || a.type === 'decide' || a.type === 'passPriority' || a.type === 'doneDeploying' || a.type === 'augment');
    const finishers = legal.filter(a => a.type === 'playCard' && (policy.finish ?? []).includes(p.hand[a.handIndex]!));
    // (a measuring run's goal is out of reach: no need to look)
    const reachable = progress(acc).target < 10000;
    const winning = !reachable ? undefined : cheap.find(a => trySim(acc, s, a)?.acc.met)
      ?? finishers.find(a => rollout(acc, s, a, policy, true)?.acc.met);
    const cardOf = (a: Action): CardName | undefined => {
      if ('handIndex' in a) return p.hand[a.handIndex];
      if (a.type === 'augment' || a.type === 'graft' || a.type === 'prophesy') {
        return a.from === 'bin' ? p.bin[a.index] : a.from === 'cache' ? p.cache?.[a.index]?.card : p.hand[a.index];
      }
      if (a.type === 'playFromBin') return p.bin[a.binIndex];
      if (a.type === 'playCached') return p.cache?.[a.index]?.card;
      return undefined;
    };
    const pick = winning ?? policy.pick?.({ s, legal, p, acc, def, cardOf }) ?? choose();
    if (!pick) return out(`no pick (turn ${s.turn}, ${s.phase}): ${[...new Set(legal.map(a => a.type))].join(' ')}`);
    if (trace && pick.type !== 'passPriority') {
      const card = 'handIndex' in pick ? p.hand[pick.handIndex] : pick.type === 'activateAbility' || pick.type === 'castSpellToken' ? s.entities[pick.entityId]?.card : '';
      console.log(`t${s.turn} ${s.phase} ${JSON.stringify(pick)} ${card ?? ''} | value ${acc.value}${s.decision ? ' | Q ' + s.decision.prompt : ''}`);
    }
    try { doAct(pick); }
    catch (err) { return out(`refused (turn ${s.turn}, ${s.phase}) ${JSON.stringify(pick)}: ${(err as Error).message}`); }

    function choose(): Action | undefined {
      const by = (t: Action['type']) => legal.find(a => a.type === t);
      // bottom step: the two least wanted
      if (by('bottomCards')) {
        const idx = p.hand.map((n, i) => [value(n), i] as const).sort((x, y) => x[0] - y[0] || y[1] - x[1]).slice(0, 2).map(x => x[1]).sort((a, b) => a - b);
        return legal.find(a => a.type === 'bottomCards' && a.handIndices.join() === idx.join()) ?? by('bottomCards');
      }
      if (s.decision?.seat === PLAYER) return answer(s, acc, policy, true) ?? by('decide');
      // planning: resources
      if (s.phase === 'planning' && by('donePlanning')) {
        const dormant = p.resources.map((r, i) => [r, i] as const).filter(([r]) => r.state === 'dormant');
        const act = (pred: (k: ResourceKind) => boolean) => {
          const d = dormant.find(([r]) => pred(r.kind));
          return d ? legal.find(a => a.type === 'activateResource' && a.index === d[1]) : undefined;
        };
        const activation = act(k => k !== 'shard' && k !== 'prismite') ?? act(k => k === 'prismite') ?? act(k => k === 'shard');
        if (activation) return activation;
        const elementals = p.resources.filter(r => r.kind !== 'prismite' && r.kind !== 'shard').length;
        const exch = p.resources.findIndex(r => r.kind === 'prismite' && r.state !== 'dormant');
        if (exch >= 0) {
          const a = legal.find(x => x.type === 'exchangePrismite' && x.index === exch && x.element === elementFor(elementals));
          if (a) return a;
        }
        if (p.activationsLeft > 0 && !dormant.length && p.resources.length < (policy.maxResources ?? Infinity) && p.hand.length) {
          const order = p.hand.map((n, i) => [value(n), i] as const)
            .filter(([, i]) => !(policy.neverRecycle ?? []).includes(p.hand[i]!)).sort((x, y) => x[0] - y[0]);
          const i = order[0]?.[1];
          const a = i === undefined ? undefined : legal.find(x => x.type === 'recycleForResource' && x.handIndex === i && x.element === elementFor(elementals));
          if (a) return a;
        }
        return by('donePlanning');
      }
      // plays, in priority order
      const units = myUnits(s).length;
      const plays = legal.filter(a => a.type === 'playCard' && !a.mode && policy.play.includes(p.hand[a.handIndex]!)
        && units >= (policy.hold?.[p.hand[a.handIndex]!] ?? 0) && !(policy.finish ?? []).includes(p.hand[a.handIndex]!)
        && !(policy.single && myUnits(s).some(u => u.card === p.hand[a.handIndex])))
        .sort((x, y) => value(p.hand[(y as { handIndex: number }).handIndex]!) - value(p.hand[(x as { handIndex: number }).handIndex]!));
      const mineOnTop = policy.resolveFirst && s.stack.length > 0 && s.stack[s.stack.length - 1]!.controller === PLAYER;
      if (!mineOnTop) for (const a of plays) if (trySim(acc, s, a)) return a;
      // mods: the host chosen by what the mod does once it has resolved
      const mods = legal.filter(a => a.type === 'augment' && a.from === 'hand' && (policy.augment ?? []).includes(p.hand[a.index]!));
      if (mods.length) {
        let best: Action | undefined, bestV = -Infinity;
        for (const a of mods) {
          const r = rollout(acc, s, a, policy);
          if (!r) continue;
          const v = rate(r);
          if (v > bestV) { bestV = v; best = a; }
        }
        if (best) return best;
      }
      // activated abilities and spell-token casts: the always-list freely, the
      // rest only when the played-out result moves the goal
      const now = rate({ acc, state: s });
      for (const a of legal) {
        let key: string | null = null, always = false;
        if (a.type === 'activateAbility') {
          const e = s.entities[a.entityId];
          if (!e || e.controller !== PLAYER) continue;
          if ((policy.activate ?? []).includes(e.card)) { key = `a${a.entityId}:${a.abilityIndex}:${a.via ?? ''}`; always = true; }
          else if ((policy.activateIfGain ?? []).includes(e.card)) key = `a${a.entityId}:${a.abilityIndex}:${a.via ?? ''}`;
        } else if (a.type === 'castSpellToken') {
          const e = s.entities[a.entityId];
          if (e && (policy.cast ?? []).includes(e.card)) key = `c${a.entityId}`;
        }
        if (!key || (uses.get(key) ?? 0) >= 30) continue;
        const r = always ? trySim(acc, s, a) : rollout(acc, s, a, policy);
        if (!r || r.state.phase === 'gameover') continue;
        // goalOnly: also worth it when firing AGAIN this turn moves the goal — a
        // graft composite's second firing leaves its spent bounded grafts out
        // (CR 722.5a), so the second is a different size
        const again = (): boolean => {
          if (!policy.goalOnly || !r) return false;
          const a2 = legalActions(r.state, PLAYER).find(x => x.type === 'activateAbility' && x.entityId === (a as { entityId: number }).entityId);
          const r2 = a2 ? rollout(r.acc, r.state, a2, policy) : null;
          return !!r2 && r2.acc.value > acc.value;
        };
        if (!always && !(r.acc.value > acc.value || (!policy.goalOnly && rate(r) > now) || again())) continue;
        uses.set(key, (uses.get(key) ?? 0) + 1);
        return a;
      }
      // grafts: onto the named host, the one with the most grafts already —
      // under goalOnly, only when the host can still fire after it this turn
      // (a size skipped is a size to come back for)
      const graftThenFire = (a: Action): boolean => {
        const r = trySim(acc, s, a);
        if (!r) return false;
        if (!policy.goalOnly) return true;
        const hostId = (a as { hostId: number }).hostId;
        return legalActions(r.state, PLAYER).some(x => x.type === 'activateAbility' && x.entityId === hostId);
      };
      if (policy.graft?.length && policy.graftHost) {
        const hosts = myUnits(s).filter(u => u.card === policy.graftHost).sort((x, y) => y.mods.length - x.mods.length);
        for (const host of hosts) {
          const g = legal.find(a => a.type === 'graft' && a.hostId === host.id
            && policy.graft!.includes((a.from === 'bin' ? p.bin[a.index] : a.from === 'hand' ? p.hand[a.index] : undefined)!)
            && graftThenFire(a));
          if (g) return g;
        }
      }
      if (by('doneHaste')) return by('doneHaste');
      if (s.battle && legal.some(a => a.type === 'declareAttack')) {
        if (policy.attack) {
          const q = new E(s);
          const pow = (u: { id: number }): number => { try { return q.effStats(s.entities[u.id]!)[0]; } catch { return Infinity; } };
          const ready = myUnits(s).filter(u => s.battle!.round === 1 || u.region === s.battle!.region);
          // 'probe': the one unit with the least power — a battle window for
          // battle-speed cards at the cost of a point or two of the dummy's 99
          const ids = policy.attack === 'all' ? ready.map(u => u.id)
            : ready.map(u => [pow(u), u.id] as const).sort((x, y) => x[0] - y[0]).slice(0, 1).map(x => x[1]);
          for (const cols of [ids.map(id => [id]), ...ids.slice(1).map((_, k) => ids.slice(0, ids.length - 1 - k).map(id => [id]))]) {
            if (!cols.length) continue;
            const a: Action = { type: 'declareAttack', seat: PLAYER, columns: cols };
            if (trySim(acc, s, a)) return a;
          }
        }
        return legal.find(a => a.type === 'declareAttack' && a.columns.length === 0 && !a.spellTokens?.length) ?? legal.find(a => a.type === 'declareAttack');
      }
      if (legal.some(a => a.type === 'declareBlocks')) {
        return legal.find(a => a.type === 'declareBlocks' && Object.keys(a.blocks).length === 0 && !a.send?.length) ?? legal.find(a => a.type === 'declareBlocks');
      }
      return by('passPriority') ?? by('doneDeploying') ?? by('donePlanning') ?? by('decide') ?? legal[0];
    }
  }
  note();
  return out();
}

/** fold a whole log from the bare deal */
function foldLog(def: ChallengeDef, deck: CardName[], actions: Action[]): RunAcc {
  let state = createGame(def.seed, ['Challenger', 'Dummy'], 'constructed', undefined, [deck, [...DUMMY_DECK]], undefined, challengeDeal(def)).state;
  let acc = newRun(def.goal, deck);
  for (const a of actions) {
    const r = apply(state, a);
    acc = foldRun(acc, state, a, r.state, r.events);
    state = r.state;
  }
  return acc;
}

/** the score a recorded log would earn against goal `goal` (the policy did not look at n) */
export function scoreAt(def: ChallengeDef, deck: CardName[], actions: Action[], goal: Goal): RunScore | null {
  let state = createGame(def.seed, ['Challenger', 'Dummy'], 'constructed', undefined, [deck, [...DUMMY_DECK]], undefined, challengeDeal(def)).state;
  let acc = newRun(goal, deck);
  for (const a of actions) {
    const r = apply(state, a);
    acc = foldRun(acc, state, a, r.state, r.events);
    state = r.state;
    if (acc.met) return scoreRun(acc, def.par);
  }
  return null;
}

// ── the command line ──────────────────────────────────────────────────

function withN(goal: Goal, n: number): Goal {
  if (goal.kind === 'unitSize') return { kind: 'unitSize', p: n, t: n };
  if (goal.kind === 'tokenSet') return { kind: 'tokenSet', tokens: Object.fromEntries(Object.keys(goal.tokens).map(k => [k, n])) };
  if (goal.kind === 'dummyWins' || goal.kind === 'oneShot') return goal;
  return { ...goal, n };
}

function main(): void {
  const argv = process.argv.slice(2);
  const opt = (name: string): string | undefined => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes('--measure')) {
    const turns = Number(opt('--turns') ?? 20);
    const only = opt('--kind');
    for (const def of CHALLENGES) {
      if (only && def.goal.kind !== only) continue;
      for (const pol of POLICIES[def.goal.kind]) {
        if (opt('--policy') && pol.name !== opt('--policy')) continue;
        const t0 = Date.now();
        const open = { ...def, goal: withN(def.goal, 100000) };
        const r = play(open, pol, turns, argv.includes('--trace'));
        const at = (t: number) => Math.max(0, ...r.byTurn.slice(0, t + 1));
        console.log(`${def.goal.kind.padEnd(12)} ${pol.name.padEnd(20)} t8=${at(8)} t12=${at(12)} t20=${at(20)}  (${r.actions.length} actions, ${Date.now() - t0} ms)${r.error ? '  ERROR ' + r.error : ''}`);
        console.log(`   by turn: ${r.byTurn.join(' ')}`);
        const ns = (opt('--ns') ?? '').split(',').filter(Boolean).map(Number);
        for (const n of ns) {
          const sc = scoreAt(def, pol.deck, r.actions, withN(def.goal, n));
          console.log(`   n=${n}: ${sc ? `turn ${sc.turns}, cards ${sc.cards} (${sc.unique}+${sc.extra}), elements ${sc.elements}, raw ${sc.raw}` : 'not reached'}`);
        }
      }
    }
    return;
  }
  const id = argv.find(a => !a.startsWith('--'));
  const row = challengeById(id);
  // --n N: try the row at another n (nothing is written for it)
  const def = row && opt('--n') ? { ...row, goal: withN(row.goal, Number(opt('--n'))) } : row;
  if (!def) { console.error(`unknown challenge ${id}; one of: ${CHALLENGES.map(c => c.id).join(', ')}`); process.exitCode = 1; return; }
  const pols = POLICIES[def.goal.kind].filter(p => !opt('--policy') || p.name === opt('--policy'));
  let best: { pol: Policy; actions: Action[]; score: RunScore } | null = null;
  for (const pol of pols) {
    const r = play(def, pol, Number(opt('--turns') ?? 30), argv.includes('--trace'));
    if (!r.acc.met) { console.log(`${pol.name}: not met (${r.acc.value}/${JSON.stringify(def.goal)} by turn ${r.acc.turn})${r.error ? ' ' + r.error : ''}`); continue; }
    const t0 = Date.now();
    const v = verifyRun(def, pol.deck, r.actions);
    const ms = Date.now() - t0;
    if (!v.ok) { console.log(`${pol.name}: met but verifyRun refuses: ${v.error}`); continue; }
    console.log(`${pol.name}: ${JSON.stringify(v.score)} — ${v.actions.length} actions, verify ${ms} ms`);
    if (!best || v.score.raw < best.score.raw) best = { pol, actions: v.actions, score: v.score };
  }
  if (best && argv.includes('--write') && !opt('--n')) {
    mkdirSync(REFERENCE_RUNS_DIR, { recursive: true });
    const file = join(REFERENCE_RUNS_DIR, `${def.id}.json`);
    writeFileSync(file, JSON.stringify({ challengeId: def.id, deck: best.pol.deck, actions: best.actions }) + '\n');
    console.log(`wrote ${file} (${best.pol.name}, raw ${best.score.raw}: the row's par in challenges.ts must be ${best.score.raw})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
