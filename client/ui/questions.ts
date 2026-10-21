/* THE RULES QUESTION BOARD — a staged position anyone can open from a link.
 *
 * The owner asked (2026-10-21, about report #231) for "a link to a live
 * scenario where people can view the question in the client" to post beside a
 * rules question on Discord. A real game cannot be that link: the replay
 * viewer serves only your own games (the owner chose "no share links" for real
 * games on 2026-09-23), and a real game carries real names. So a question is
 * STAGED instead — a hand-built board with "Player A" and "Player B", then
 * played forward with legal actions through the real engine — and walked in
 * the page by the replay viewer, which is already a read-only board with a
 * transport and the ordinary card zoom.
 *
 * ── A QUESTION IS ONE ENTRY IN `QUESTIONS`, NOT NEW CODE ──────────────
 *
 * id, title, the question, the readings, the board, and the steps. The steps
 * are real engine actions, and a `{ mark }` between them names a moment the
 * page offers as a button ("Before Rebalance", "After Rebalance"). Nothing
 * else has to change: `?question=<id>` opens it, the rules review page lists
 * it, and 527 deals and walks every entry.
 *
 * ── THE SAME ONE ARCHITECTURAL RULE AS THE SCENARIO TESTER ────────────
 *
 * A board is a deterministic mutation of a fresh deal, then real actions
 * through `apply`. Never a hand-written `GameState`. That is what keeps the
 * board honest: every step after the setup is something the engine accepted,
 * and a rules change that refuses one fails 527 by name instead of showing a
 * board that could not happen. The vocabulary is the scenario tester's
 * (`server/scenarios.ts`, whose types this borrows — TYPES only, because a
 * value import would pull every scenario batch into the browser bundle).
 *
 * ── WHAT A QUESTION MUST NOT DO ───────────────────────────────────────
 *
 * Argue. The page and the post are for the community to answer, so the
 * readings are stated side by side with the text each rests on, and the board
 * says which one this client plays today — a fact, which 527 checks against
 * the engine so the caption cannot outlive a ruling change.
 */
import type { Action, CardName, EngineEvent, EntityId, GameState, Seat } from '../engine/src/types.ts';
import { createGame } from '../engine/src/apply.ts';
import { E } from '../engine/src/engine.ts';
import type { Placed, ResSpec } from '../server/scenarios.ts';
import type { ReplayFile } from './replayserver.ts';

/** One seat's board before anything happens. Player A is seat 0, Player B seat 1. */
export interface QuestionSide {
  hand: CardName[];
  play: Placed[];
  resources: ResSpec;
  /** the life total, when the question turns on one (default: the game's) */
  life?: number;
}

/** A named moment between two steps — a button on the page. */
export interface QuestionMark {
  mark: string;
  /** one line: what to look at on the board at this moment */
  note: string;
}

export type QuestionStep = Action | QuestionMark;

export interface QuestionReading {
  /** short: "Piercing stays" */
  name: string;
  /** the reading and the text it rests on, quoted */
  text: string;
}

export interface RulesQuestion {
  /** stable forever — it is the link people post */
  id: string;
  title: string;
  /** the question itself, two or three sentences, neutral */
  asked: string;
  readings: QuestionReading[];
  /** which reading this client plays today, as a sentence. 527 checks it. */
  client: string;
  /** the cards whose printed text the page lists, in reading order */
  cards: CardName[];
  /** the moment the page opens on (a mark's label); default the first mark */
  opensAt?: string;
  /** who attacks first on turn 1 (default: whatever the seed dealt) */
  initiative?: Seat;
  a: QuestionSide;
  b: QuestionSide;
  /** the entity ids the setup minted, in `play` order */
  steps: (ids: { a: EntityId[]; b: EntityId[] }) => QuestionStep[];
}

/** The deal under every question. The board does not depend on it; the decks
 * (and so any card drawn at a turn's start) do, which is why it is fixed. */
export const QUESTION_SEED = 1;
export const QUESTION_NAMES: [string, string] = ['Player A', 'Player B'];

const A: Seat = 0;
const B: Seat = 1;
const isMark = (s: QuestionStep): s is QuestionMark => 'mark' in s;

/* ── the library ────────────────────────────────────────────────────── */

export const QUESTIONS: RulesQuestion[] = [
  /**
   * Report #231 (room ZKKX, 2026-10-18), staged. In the real game the Robot
   * had 72 power after Technological Superiority and Burgeon; here it is
   * placed with 30 counters, which asks the same question with fewer cards.
   */
  {
    id: 'transmogrifant-control-change',
    title: 'Transmogrifant changes sides: does Piercing granted earlier survive?',
    asked: 'Transmogrifant was attached to Player B\'s The Bonesculptor first. Later, Pernicious '
      + 'Photosynthesis gave Player A\'s units Piercing until regroup. Then Rebalance gave The '
      + 'Bonesculptor to Player A, so Transmogrifant\'s "your other units" now means Player A\'s '
      + 'units. Do those units lose the Piercing they got before the control change?',
    readings: [
      {
        name: 'Piercing stays',
        text: 'Transmogrifant\'s effect dates from when it was attached, which is before the Piercing. '
          + 'Rules: "a mod\'s [effect] has the time it was applied"; "An attribute or ability the object '
          + 'gains afterwards is not removed." RAQ (_passer): "if any unit in play later gains Attribute or '
          + 'Ability, then timestamps takes precedence and this new Attribute/Ability is NOT affected by '
          + 'Monke or Transmogrifant."',
      },
      {
        name: 'Piercing goes',
        text: 'Transmogrifant only began to apply to Player A\'s units at the control change, which is '
          + 'after the Piercing. Rules: "An effect\'s timestamp is when it began to apply"; "A strip takes '
          + 'what the unit has when the strip applies."',
      },
    ],
    client: 'Answered (Passer, 2026-10-21): Rebalance does not refresh Transmogrifant\'s timestamp, so the Piercing '
      + 'stays. This client keeps the Piercing: the Robot pierces past Restitution.',
    opensAt: 'Before the switch',
    cards: ['Transmogrifant', 'The Bonesculptor', 'Pernicious Photosynthesis', 'Rebalance', 'Restitution', 'Bubb', 'Robot'],
    initiative: B,
    a: {
      life: 9,
      hand: ['Pernicious Photosynthesis'],
      play: [{ card: 'Robot', token: true, counters: 30 }, { card: 'Bubb' }, { card: 'Earnest Defender' }],
      resources: { wood: 4 },
    },
    b: {
      life: 17,
      hand: ['Rebalance'],
      play: [{ card: 'The Bonesculptor', mods: [{ card: 'Transmogrifant', as: 'augment' }] }, { card: 'Restitution' }],
      resources: { wood: 2 },
    },
    steps: ids => {
      const [robot, bubb, defender] = ids.a;
      const [, restitution] = ids.b;
      return [
        { mark: 'Start', note: 'Transmogrifant is already on Player B\'s The Bonesculptor, so Player B\'s Restitution is 6/6 with no abilities.' },
        { type: 'donePlanning', seat: A }, { type: 'donePlanning', seat: B },
        { type: 'doneHaste', seat: A }, { type: 'doneHaste', seat: B },
        { type: 'declareAttack', seat: B, columns: [] },
        { type: 'declareAttack', seat: A, columns: [] },
        { type: 'playCard', seat: A, handIndex: 0 },
        { mark: 'Piercing granted', note: 'Pernicious Photosynthesis resolved: Player A\'s units are +2/+2 with Piercing until regroup. Transmogrifant still covers only Player B\'s units.' },
        { type: 'doneDeploying', seat: A }, { type: 'doneDeploying', seat: B },
        { type: 'donePlanning', seat: A }, { type: 'donePlanning', seat: B },
        { type: 'doneHaste', seat: A }, { type: 'doneHaste', seat: B },
        { type: 'declareAttack', seat: A, columns: [[robot!], [bubb!], [defender!]] },
        { type: 'passPriority', seat: A },
        { type: 'playCard', seat: B, handIndex: 0 },
        { type: 'passPriority', seat: A }, { type: 'passPriority', seat: B },
        { type: 'decide', seat: A, choice: 2 },   // Player A gives Earnest Defender
        { mark: 'Before the switch', note: 'Rebalance is resolving and Player B is about to give away The Bonesculptor. Player A\'s units still have Piercing; Restitution still has no abilities.' },
        { type: 'decide', seat: B, choice: 0 },   // Player B gives The Bonesculptor
        { mark: 'After the switch', note: 'Player A now controls The Bonesculptor, so Transmogrifant covers Player A\'s other units. Bubb has lost its printed Unaware; this client kept the Piercing. Restitution has its ability back.' },
        { type: 'passPriority', seat: A }, { type: 'passPriority', seat: B },
        { type: 'declareBlocks', seat: B, blocks: { 0: [restitution!] } },
        { type: 'passPriority', seat: A }, { type: 'passPriority', seat: B },
        { type: 'decide', seat: A, choice: 0 },   // the default split: lethal, then the rest pierces
        { mark: 'Combat damage', note: 'This client: Restitution is dealt 4 and the other 30 pierces to Player B. Without Piercing, Restitution would be dealt all 34 and deal 34 to Player A.' },
      ];
    },
  },
];

export function questionById(id: string | null | undefined): RulesQuestion | undefined {
  return QUESTIONS.find(q => q.id === id);
}

/* ── staging ────────────────────────────────────────────────────────── */

export interface StagedQuestion {
  /** the board before the first step */
  dealt: { state: GameState; events: EngineEvent[] };
  /** the steps as a replay log — what `ReplayServer` walks */
  file: ReplayFile;
  /** each named moment and the number of actions before it */
  marks: { label: string; note: string; at: number }[];
  /** where the page opens: `opensAt`'s mark, else the first */
  opens: number;
}

/** Put one seat's hand, resources and units on the board (the scenario
 * tester's `patchSide`, plus a life total). Mutates the state behind `e`. */
function stageSide(e: E, seat: Seat, side: QuestionSide): EntityId[] {
  const p = e.player(seat);
  p.hand = [...side.hand];
  p.resources = [];
  for (const [kind, n] of Object.entries(side.resources)) {
    for (let i = 0; i < (n ?? 0); i++) p.resources.push({ kind: kind as keyof ResSpec, state: 'open' });
  }
  if (side.life !== undefined) p.life = side.life;
  const ids: EntityId[] = [];
  for (const placed of side.play) {
    const u = e.spawnUnit(seat, placed.card, e.homeRegion(seat), {
      ...(placed.token ? { token: true } : {}),
      ...(placed.counters ? { counters: placed.counters } : {}),
    });
    for (const m of placed.mods ?? []) e.attachMod(u, m.card, seat, m.as);
    ids.push(u.id);
  }
  return ids;
}

/** Deal a question's board and split its steps into a log and its moments.
 * Pure: the same question gives the same board every time. Throws, by id, on
 * a board that leaves a question open before the first step. */
export function stageQuestion(q: RulesQuestion): StagedQuestion {
  const base = createGame(QUESTION_SEED, QUESTION_NAMES, 'shared');
  const state = base.state;
  const events = [...base.events];
  const e = new E(state);
  if (q.initiative !== undefined) state.initiative = q.initiative;
  const ids = { a: stageSide(e, A, q.a), b: stageSide(e, B, q.b) };
  e.settle();
  events.push(...e.events);
  if (state.decision) throw new Error(`question '${q.id}': the board left a decision open (${state.decision.prompt})`);
  const actions: Action[] = [];
  const marks: StagedQuestion['marks'] = [];
  for (const s of q.steps(ids)) {
    if (isMark(s)) marks.push({ label: s.mark, note: s.note, at: actions.length });
    else actions.push(s);
  }
  const opens = marks.find(k => k.label === q.opensAt) ?? marks[0];
  if (q.opensAt !== undefined && opens?.label !== q.opensAt) throw new Error(`question '${q.id}': no moment called '${q.opensAt}'`);
  return {
    dealt: { state, events },
    file: { seed: QUESTION_SEED, mode: 'shared', names: QUESTION_NAMES, actions },
    marks,
    opens: opens?.at ?? 0,
  };
}

/** The link a question is shared by. */
export const questionUrl = (origin: string, id: string): string =>
  `${origin}/?question=${encodeURIComponent(id)}`;
