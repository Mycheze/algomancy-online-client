/* THE SCENARIO TESTER — a deterministic board, dealt inside the deal.
 *
 * Commissioned in `docs/14-scenario-tester.md` (round 28). The owner is the
 * rules authority, and his "that's broken" is ground truth in a way no
 * assertion is; this module is the half of that instrument that puts a
 * REPRODUCIBLE board in front of him.
 *
 * ── THE ONE ARCHITECTURAL DECISION (docs/14 §2) ──────────────────────────
 *
 * A room's state is a function of `(seed, mode, els, decks, scenario, actions)`.
 * Injecting a hand-built `GameState` into a room would break `replay-room.ts`,
 * `replay-probe.ts` and the R200 divergence diff permanently, for exactly the
 * games we most want to re-examine. So a scenario is instead a **deterministic
 * mutation applied inside the deal**, and its id is recorded in the room file
 * beside `seed`.
 *
 * ⚠ CORRECTION TO docs/14 §2, found while building this (R216). The doc says
 * "`fresh()` is the single choke point — `rebuild()` calls it — so a scenario
 * room rebuilds, replays, undoes, saves and diffs like any other." That is
 * true of `rooms.ts` and FALSE of the repository. There are four deal sites in
 * `server/`, not one:
 *
 *   rooms.ts:fresh()        the live room (and rebuild(), and restore)
 *   replay-room.ts:runOnce() the forensic replay + the R200 divergence diff
 *   stats.ts:summarizeGame() the post-game screen and the accounts fold
 *   replay-probe.ts          a HISTORICAL engine, dynamically imported
 *
 * Putting the mutation in `fresh()` alone would have left a scenario room
 * replaying, diffing and being counted as if the scenario had never happened
 * — a silent, total divergence in the one tool built to explain divergences.
 * `dealScenario()` below is therefore the choke point, and the first three
 * sites all call it. The fourth CANNOT: it loads `createGame` out of a
 * worktree at an old commit, and this module's mutation is written against
 * TODAY's engine. `replay-probe.ts` refuses a scenario room by name rather
 * than probing it wrong (see `probe()`), which is the R200 lesson exactly —
 * a wrong answer about a divergence is worse than no answer.
 *
 * ── PURITY (docs/14 §2's ⚠, and the reason it is there) ──────────────────
 *
 * Same scenario id + same engine → the same board, every time. No wall clock,
 * no unseeded randomness, no reading the filesystem. `150-registration-order`
 * is the precedent: a batch importing another batch reshuffled every deck and
 * nothing in the suite noticed. `185-scenario-determinism.test.ts` is the
 * positive control for this file — it deals every scenario twice and compares
 * the two states byte for byte, and it breaks that on purpose to prove it can
 * see.
 *
 * ⚠ That file also SCANS THIS ONE — raw, comments included — for the spelling
 * of a clock read or an unseeded random call. The scan is deliberately dumb:
 * docs/13 §5 records `stripCode` going blind three separate times, and every
 * sweep in the repo rests on it, so this one has nothing to go blind about. It
 * costs one thing, and this note is it: do not write those calls out literally
 * in this file's PROSE either. Say what they are instead.
 *
 * ── THE VOCABULARY IS BORROWED, NOT REINVENTED ───────────────────────────
 *
 * `engine/test/util.ts` (`give`, `spawn`, `giveResources`) and `drill.ts` build
 * boards with `E.spawnUnit` / `E.homeRegion` / pushing onto `player.hand` and
 * `player.resources`. So does this. It is deliberately NOT an import of
 * `engine/test/util.ts`: that file imports `server/view.ts`, and a server
 * module reaching into the engine's test tree would make the deploy depend on
 * test code.
 *
 * ── SEATS ────────────────────────────────────────────────────────────────
 *
 * The owner is always SEAT 0 in a scenario room ("you"); seat 1 is "the
 * opponent", driven by the scripted bot in main.ts unless the scenario sets
 * `needsLiveOpponent`. That is a convention, and it is pinned by
 * `186-scenario-library.test.ts` rather than left to memory.
 *
 * ── HOW TO ACTUALLY RUN ONE ──────────────────────────────────────────────
 *
 * The whole feature is gated on ONE environment variable, and without it the
 * routes 404 (see main.ts's TESTER_TOKEN — this is a public deploy). So:
 *
 *     ALGO_TESTER_TOKEN=<a long random string> node main.ts
 *
 * then open, in a browser:
 *
 *     /api/scenario/open?token=<that string>&id=lithoghul-donated
 *
 * which deals the room and 302s straight onto the board. `&json=1` returns the
 * room code instead of redirecting; `&seed=<n>` re-deals with a different
 * library shuffle (the BOARD does not depend on the seed, the deck does).
 * `/api/scenario/list?token=…` says what is in the queue.
 *
 * Verdicts land in `var/verdicts.jsonl`, overridable with
 * ALGO_VERDICTS_FILE. "The link doesn't work" is almost always the token.
 */
import type {
  Action, CardName, Element, EngineEvent, EntityId, GameMode, GameState, Phase,
  ResourceKind, Seat,
} from '../engine/src/types.ts';
import { apply, createGame, IllegalAction } from '../engine/src/apply.ts';
import { E } from '../engine/src/engine.ts';
import { getCard } from '../engine/src/cards/dsl.ts';

/** The owner's seat in every scenario room. Not configurable: the runner
 * screen, the bot and the verdict record all name "you" and "the opponent",
 * and a per-scenario seat would make those three disagree. */
export const YOU: Seat = 0;
export const OPPONENT: Seat = 1;

/** One unit to stand on the board before the owner touches anything. */
export interface Placed {
  card: CardName;
  /** +1/+1 counters, for making a body survive (or not survive) a known hit */
  counters?: number;
  token?: boolean;
}

/** Resources to hand a seat, all OPEN (a scenario is not a mana puzzle unless
 * it says so — the point is to reach the clause, not to ration). */
export type ResSpec = Partial<Record<ResourceKind, number>>;

export interface ScenarioSide {
  hand: CardName[];
  play: Placed[];
  resources: ResSpec;
}

/** The entity ids the board patch minted, in `play` order, so a prologue can
 * name "my attacker" and "their unit" without guessing at numbers. */
export interface ScenarioIds { you: EntityId[]; opponent: EntityId[] }

/* ⚠ R218 — A BATCH FILE MAY IMPORT ONLY *TYPES* FROM THIS MODULE.
 *
 * `scenarios.ts` imports every batch (see BATCHES above), so a batch importing
 * a VALUE back out of it closes a cycle and the server dies at BOOT with
 * `Cannot access 'YOU' before initialization`. `import type { Scenario }` is
 * fine; `import { YOU, OPPONENT }` is not.
 *
 * It fails at startup, not at typecheck, so `tsc` will not warn you — which is
 * why this warning is here rather than in a lint. Restate the seat constants
 * locally in your batch file; they are two lines and they cannot drift, because
 * `YOU`/`OPPONENT` are 0/1 by the definition of a two-seat game. */
export interface Scenario {
  /** stable forever: a verdict cites it years later */
  id: string;
  /** the card under test */
  card: CardName;
  /** why THIS card is in the queue — the risk it represents */
  why: string;
  /** plain English, shown on screen. THE load-bearing field: it is what lets
   * the owner tell "the card is wrong" from "the setup is wrong", which is
   * what the fourth verdict button exists for (docs/14 §5). */
  expect: string;
  you: ScenarioSide;
  opponent: ScenarioSide;
  /** who has the round-1 attack. Set before the prologue runs; `undefined`
   * leaves whatever the seed dealt, which is NOT deterministic across seeds
   * and so is only right for scenarios that never reach a battle. */
  initiative?: Seat;
  /**
   * Engine actions applied after the board patch to walk the game into the
   * window the scenario is about.
   *
   * ⚠ docs/14 §3 lists `phase` and `priority` as FIELDS of a scenario. They
   * cannot be: `GameState.phase` is not a knob, it is the consequence of the
   * actions taken to reach it, and assigning it directly would leave
   * `battle`, `priority`, `hasteDone` and the segment key describing a game
   * that never happened. So they are DECLARATIONS instead — `phase` and
   * `priority` below are asserted after the prologue, and a scenario whose
   * prologue stops landing where it claims fails loudly rather than opening
   * a board nobody meant.
   *
   * The prologue is the rot surface of this whole design (docs/14 §9). It is
   * a list of real actions through the real `apply`, so a rules change can
   * refuse one — and when that happens the deal throws, by name, rather than
   * dealing half a setup.
   */
  prologue?: (ids: ScenarioIds, state: GameState) => Action[];
  /**
   * R218 — WHAT THE HAND HOLDS ONCE THE PROLOGUE IS DONE, when the prologue
   * SPENDS one.
   *
   * `you.hand` / `opponent.hand` say what the board patch DEALS. Most prologues
   * only pass priority and declare an attack, so the two are the same and this
   * field is omitted — `186 §1` then asserts the dealt hand is still intact,
   * which is the anti-rot check docs/14 §9 asks for.
   *
   * ⚠ But some clauses cannot be reached without spending a card first. A
   * non-`{Virus}` `[Augment]` can only ever attach as a DEPLOYMENT action
   * (`doAugment`: "modding is a deployment action (or a battle Virus)"), so a
   * scenario about donated text on such a card MUST play it in the prologue.
   * Batch A hit exactly this and went red against an undocumented rule.
   *
   * When set, this is asserted instead. It must be a SUBSET of the dealt hand —
   * a prologue may spend cards, never conjure them — and `186 §1` checks that
   * too, so this cannot be used to paper over a prologue that drew.
   */
  handAfterPrologue?: CardName[];
  /** asserted after the prologue */
  phase: Phase;
  /** asserted after the prologue; null = nobody holds priority there */
  priority: Seat | null;
  /**
   * TRUE when the scenario genuinely needs a second human decision (a block,
   * a response, "each player chooses").
   *
   * ⚠ docs/14 §4: getting this wrong in the PERMISSIVE direction is the
   * expensive mistake. A scenario that silently needs an opponent reads as a
   * hung game, and a hung game reads as a bug — which costs a round.
   */
  needsLiveOpponent?: boolean;
}

// ── the library ──────────────────────────────────────────────────────────
//
// ONE scenario. This is the vertical slice (docs/14 §8) and the library is
// deliberately the next agent's job: 20 working scenarios beat 120 unplayable
// ones, and the plumbing is the risky part.

/* R218 — BATCH FILES.
 *
 * Scenarios are authored in parallel, several at a time, and one shared object
 * literal is the worst possible merge surface for that: every author edits the
 * same closing brace. So each batch lives in its own module exporting a
 * `Record<string, Scenario>` and is spread in below. Adding a batch is two
 * lines here and one new file — no author ever edits another author's text.
 *
 * ⚠ A DUPLICATE ID WOULD SILENTLY WIN, because a later spread overwrites an
 * earlier key and nothing would say so. `186-scenario-library.test.ts` sums
 * the batches and asserts the total equals the merged key count, so a
 * collision fails loudly instead of deleting somebody's scenario.
 *
 * ⚠ THIS COMMENT ORIGINALLY CITED `189-scenario-library.test.ts`, WHICH DOES
 * NOT EXIST — two of the four batch authors caught it independently, and one
 * wrote the collision check itself rather than trust the promise. A comment
 * naming a guard that is not there is worse than no comment: it is exactly the
 * `docs/13-assessment.md` §5 shape, a claim of coverage nobody verified, and
 * with four parallel authors on one keyspace it was live. */
import { BATCH_A } from './scenarios-a.ts';
import { BATCH_B } from './scenarios-b.ts';
import { BATCH_C } from './scenarios-c.ts';
import { BATCH_D } from './scenarios-d.ts';
import { BATCH_E } from './scenarios-e.ts';

/** every batch, in registration order — exported so the collision guard can
 *  sum them without re-listing the imports */
export const BATCHES: readonly Record<string, Scenario>[] =
  [BATCH_A, BATCH_B, BATCH_C, BATCH_D, BATCH_E];

const CORE: Record<string, Scenario> = {
  /**
   * WHY THIS CARD (R216).
   *
   * `docs/13-assessment.md` §1③ names the biggest hole in the round-28
   * correctness sample by name: "the donated `[Augment]` path for ten of the
   * eleven augment cards in the sample. Only one is checked on a host, and
   * 'me'/'you' resolve differently there under R131." R212 found the same
   * thing independently.
   *
   * Lithoghul is the sharpest case in that family that a human can settle in
   * ninety seconds:
   *
   *  1. Its printed text is "[Augment] Whenever I am dealt damage, I deal that
   *     much damage to you", and `batch-earth-a.ts`'s own comment says the
   *     donated reading is "the whole point of the card" — as a {Virus} on an
   *     ENEMY unit, "you" is the HOST's controller.
   *  2. That path is observed NOWHERE in the suite. `16-earth-a` and
   *     `105-semantics-playwatch` both spawn Lithoghul as its own body.
   *     `112-literal-wood` is the only test that ever augments a host with it
   *     — and its whole point is that the virus gets NEGATED, so it never
   *     attaches and the donated text never runs. Three tests name the card;
   *     zero exercise the clause.
   *  3. The observable is a LIFE TOTAL, and a wrong answer points the other
   *     way. If "you" resolved to the augment's owner instead of the host's
   *     controller, the owner would watch his OWN life drop. There is no
   *     reading of the board where the tester cannot tell.
   *  4. It exercises the whole of the plumbing rather than a corner of it: a
   *     hand, resources, units on both sides, a prologue that walks into a
   *     battle window, a targeted cast, a stack, and a triggered ability.
   *
   * It also sits in `84-card-semantics`'s BOARD category — the 25 unreached
   * promises no fixture can build, because they need a situation rather than
   * an input. That is the category this whole instrument exists for.
   */
  'lithoghul-donated': {
    id: 'lithoghul-donated',
    card: 'Lithoghul',
    why: 'donated [Augment] text on an ENEMY host — R131 "me"/"you", named by '
      + 'docs/13 §1③ and R212 as the single biggest untested hole. Three tests '
      + 'name Lithoghul; none has ever let its donated text resolve.',
    expect:
      // plain English, deliberately: the printed notation is "{Virus}", and the
      // runner escapes what it is given rather than iconizing it, so braces in
      // this field read as a template artifact to somebody skimming in ninety
      // seconds. The clause dropdown carries the printed wording; this line is
      // for the human.
      'Lithoghul is a Virus card, so you can augment it onto THEIR unit during battle.\n'
      + '1. Play Lithoghul onto the enemy Towering Colossus, then pass so it resolves and attaches.\n'
      + '2. Play Luminous Arc at the same Colossus (6 damage), then pass.\n'
      + "3. Lithoghul triggers: “I deal that much damage to you.”\n"
      + 'EXPECTED: the OPPONENT goes 30 → 24. You stay on 30. The augment is worn '
      + "by their unit, so “you” is its controller — not you.",
    initiative: YOU,
    you: {
      hand: ['Lithoghul', 'Luminous Arc'],
      // a body to attack with, so there is a battle to have a window in. It
      // is not part of the clause under test and is expected to do nothing.
      play: [{ card: 'The Foretold' }],
      // Lithoghul is e/1, Luminous Arc is r/2. Deliberately more than enough:
      // a scenario that fails on mana is a `bad scenario` verdict about the
      // wrong thing.
      resources: { earth: 3, fire: 3 },
    },
    opponent: {
      hand: [],
      // 10/15. Its own printed text is an [Augment] box, which does nothing
      // while it is a body in play — so as a host it is inert, and it survives
      // the 6 with room to spare. A host that DIED to the Arc would make the
      // owner adjudicate two clauses at once.
      play: [{ card: 'Towering Colossus' }],
      resources: { earth: 2 },
    },
    prologue: (ids, s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      // The R18 haste step only engages when somebody holds a payable haste
      // card, and neither side does here.
      //
      // ⚠ R218 — THIS COMMENT USED TO CLAIM `dealScenario` SKIPS THE HASTE STEP
      // IF IT IS OPEN. IT DOES NOT. `runPrologue` does no such thing, and batch
      // A hit it: any scenario whose board holds a `{Haste}` card must put its
      // own `doneHaste` in the prologue or the deal throws "not your attack
      // step". This board is safe because of the sentence above, not because
      // anything skips anything — which is exactly the distinction the wrong
      // comment erased. A scenario author reading it would have built a haste
      // board and been told the engine was broken.
      { type: 'declareAttack', seat: s.battle?.attacker ?? YOU, columns: [[ids.you[0]!]] },
    ],
    phase: 'battle',
    priority: YOU,
    // the bot only ever has to pass and decline blocks here — see main.ts's
    // scriptedOpponent, and §4's ⚠ on getting this flag wrong the permissive
    // way. Checked by hand: the whole scenario resolves with seat 1 passing.
    needsLiveOpponent: false,
  },
};

export const SCENARIOS: Record<string, Scenario> =
  Object.assign({}, CORE, ...BATCHES) as Record<string, Scenario>;

export type ScenarioId = string;

export const isScenarioId = (x: unknown): x is ScenarioId =>
  typeof x === 'string' && Object.prototype.hasOwnProperty.call(SCENARIOS, x);

/* ── BL-06: TEST MODE IS A SECOND KIND OF DEAL, NOT A SCENARIO ───────────
 *
 * A sandbox room is a scenario-SHAPED room and it lives here on purpose. The
 * header above lists the four deal sites and the reason the mutation has to be
 * one function all of them call; a sandbox has exactly the same problem, and
 * solving it a second way would have meant answering all four again — and
 * getting one of them wrong, silently, in the mode most likely to be used to
 * reproduce a bug. So `dealScenario` is its choke point too, and a sandbox
 * room rides on `Room.scenario` the whole way: it rebuilds, replays, restores,
 * and is refused by `replay-probe.ts` and skipped by `history.ts` and
 * `main.ts:recordFinishedGame` — every one of those for free, because each of
 * them already asks "was this room dealt with an id".
 *
 * ⚠ IT IS NOT IN `SCENARIOS`, and that is deliberate rather than tidy. Every
 * member of that record is a CARD UNDER TEST with an `expect` line, a verdict
 * bar and a place in the queue; `185`/`186` walk it and assert exactly that.
 * A sandbox has no card, no expectation and no verdict, so putting it in the
 * library would have meant a fake `card`, a fake `expect`, and a verdict panel
 * painted over a mode that has nothing to judge. Keeping it out costs one
 * thing — `isScenarioId` is no longer the whole of "ids a room may be dealt
 * with" — and `isDealId` below is that, named so a reader can see the two
 * questions are different.
 */
export const SANDBOX_ID = 'sandbox';

/** Was this room dealt as a test-mode sandbox? */
export const isSandboxId = (x: unknown): x is string => x === SANDBOX_ID;

/**
 * Every id `dealScenario` accepts — a scenario, or the sandbox.
 *
 * `rooms.ts`'s restore validation asks THIS, not `isScenarioId`: a saved
 * sandbox room must load, and the check it fails would otherwise refuse it
 * with "this build does not define that scenario", which is both wrong and
 * the kind of wrong that reads as data loss. The scenario tester's admin route
 * still asks `isScenarioId`, because `?id=sandbox` is not a scenario to open.
 */
export const isDealId = (x: unknown): x is string => isSandboxId(x) || isScenarioId(x);

/** BL-06's dealt board: 1000 life a side, empty hands, no mana, nothing in
 * play — and `state.sandbox`, which is the only thing that makes the four
 * `sandbox*` engine actions legal.
 *
 * Mutates `state`, like `patchSide`. Deliberately does NOT touch the deck or
 * the RNG: `185 §2` holds `dealScenario` to handing back the stream
 * `createGame` produced, and a sandbox that drew or reshuffled would move
 * every later draw in the game. */
function dealSandbox(state: GameState, events: EngineEvent[]): void {
  const e = new E(state);
  state.sandbox = true;
  for (const p of state.players) {
    p.hand = [];
    p.resources = [];
    // BL-06's own words: "no opponent, 1000 life". Both seats, because the
    // second seat is a real seat somebody can open in another tab and stock
    // the same way — the two-sidedness is not optional.
    p.life = 1000;
  }
  e.ev('info', 'Test mode: a sandbox board. Summon any card, mint any mana, '
    + 'and it all behaves under the normal rules from there.', { sandbox: 'deal' });
  events.push(...e.events);
}

/** Every scenario id, sorted — for the admin index and for the sweeps. */
export const scenarioIds = (): string[] => Object.keys(SCENARIOS).sort();

// ── the mutation ─────────────────────────────────────────────────────────

/** A scenario that cannot be dealt is a loud failure, never a quiet half-board.
 * It carries the id so a room-restore log line names the scenario, not just a
 * stack. */
export class ScenarioError extends Error {
  /** the scenario that could not be dealt. A plain field, not a parameter
   * property: node's type-stripping loader runs this file directly and refuses
   * `constructor(public …)` outright. */
  scenario: string;
  constructor(scenario: string, msg: string) {
    super(`scenario '${scenario}': ${msg}`);
    this.name = 'ScenarioError';
    this.scenario = scenario;
  }
}

/** Put a side's hand, resources and units on the board. Mutates `state`.
 *
 * The hand and the resource pool are REPLACED, not appended to: a scenario
 * says what the board is, and seven random opening cards beside two named ones
 * is noise the owner has to read past on every single card. The deck is left
 * exactly as the seed dealt it — draws still work and still replay. */
function patchSide(e: E, seat: Seat, side: ScenarioSide, out: EntityId[]): void {
  const p = e.player(seat);
  p.hand = [...side.hand];
  p.resources = [];
  // ordered by the ResSpec's own key order so two runs push the same pool in
  // the same order — an object literal's key order is stable in JS, and the
  // resource ARRAY is indexed by actions, so its order is part of the board.
  for (const [kind, n] of Object.entries(side.resources)) {
    for (let i = 0; i < (n ?? 0); i++) p.resources.push({ kind: kind as ResourceKind, state: 'open' });
  }
  for (const placed of side.play) {
    const u = e.spawnUnit(seat, placed.card, e.homeRegion(seat), {
      ...(placed.token ? { token: true } : {}),
      ...(placed.counters ? { counters: placed.counters } : {}),
    });
    out.push(u.id);
  }
}

/**
 * R228: the haste step is ALWAYS offered now, so it stands between
 * `donePlanning` and every battle action in every prologue ever written.
 *
 * Before R228 the step only appeared when somebody held a payable haste card,
 * which made its presence a property of the SCENARIO — so R218 made each
 * scenario put its own `doneHaste` in, and warned (correctly, at the time)
 * that `runPrologue` skips nothing. That reasoning is now inverted: the step
 * is unconditional, so a `doneHaste` in a prologue carries no information
 * about the board at all, and requiring 32 prologues to each write two of
 * them would be boilerplate whose only job is to be forgotten.
 *
 * So the SETUP closes it — and only the setup. This is not the engine
 * skipping a step; the step happens, exactly as it does in a real game, and
 * `dealScenario` walks through it the way it walks through everything else on
 * the way to the position the scenario declares. A prologue that closes the
 * step itself still works: this only finishes the seats it left open, and
 * only when the next setup action is something other than `doneHaste`.
 */
function closeHasteStep(s: GameState, events: EngineEvent[]): GameState {
  let out = s;
  while (out.hasteDone) {
    const seat = out.hasteDone.findIndex(d => !d);
    if (seat < 0) break;   // cannot happen: an all-done array is nulled by the engine
    const r = apply(out, { type: 'doneHaste', seat: seat as Seat });
    out = r.state;
    events.push(...r.events);
  }
  return out;
}

/** Apply the prologue, refusing to hand back a half-built board. */
function runPrologue(sc: Scenario, ids: ScenarioIds, state: GameState, events: EngineEvent[]): GameState {
  let s = state;
  if (!sc.prologue) return s;
  for (const a of sc.prologue(ids, s)) {
    try {
      // R228, above: the unconditional haste step is walked through here
      if (a.type !== 'doneHaste') s = closeHasteStep(s, events);
      const r = apply(s, a);
      s = r.state;
      events.push(...r.events);
    } catch (err) {
      if (err instanceof IllegalAction) {
        // SCENARIO ROT, caught at the deal (docs/14 §9). A rules change that
        // makes a setup step illegal must not be discoverable as "the board
        // looks odd" — it is a broken scenario and it says so.
        throw new ScenarioError(sc.id,
          `setup action ${a.type} (seat ${a.seat}) was refused by this engine: ${err.message}`
          + ' — the scenario no longer describes a legal game');
      }
      throw err;
    }
  }
  // R228 again, for the prologue that simply ENDS in the haste step: a
  // scenario that declares a battle or deployment position must be left in
  // one, and the last thing between `donePlanning` and that position is now
  // always this step. A scenario that declares `phase: 'planning'` is left
  // exactly where its prologue put it.
  if (sc.phase !== 'planning') s = closeHasteStep(s, events);
  return s;
}

/**
 * Deal a game and apply a scenario to it. THE choke point.
 *
 * Same arguments as `createGame`, plus the scenario id. Returns the same shape,
 * so every deal site is a one-word change.
 *
 * `id` undefined → a plain `createGame`, byte for byte. That matters more than
 * it looks: every ordinary room in `var/games/` goes through this function
 * once `rooms.ts` adopts it, and an ordinary game must be unchanged by the
 * existence of the tester.
 */
export function dealScenario(
  seed: number,
  names: [string, string],
  mode: GameMode,
  els: Element[],
  decks: [CardName[], CardName[]] | undefined,
  id?: string,
  /** BL-43: a live draft's custom deal, passed straight through to createGame */
  deal?: import('../engine/src/draftdeal.ts').DraftDeal,
): { state: GameState; events: EngineEvent[] } {
  const base = createGame(seed, names, mode, els, decks, deal);
  if (id === undefined) return { state: base.state, events: base.events };
  // BL-06 — the second kind of deal (see SANDBOX_ID above). Before the
  // SCENARIOS lookup, so a sandbox never falls into "no such scenario".
  if (isSandboxId(id)) {
    const events = [...base.events];
    dealSandbox(base.state, events);
    return { state: base.state, events };
  }
  const sc = SCENARIOS[id];
  if (!sc) throw new ScenarioError(id, 'no such scenario');

  let state = base.state;
  const events = [...base.events];

  const e = new E(state);
  if (sc.initiative !== undefined) state.initiative = sc.initiative;
  const ids: ScenarioIds = { you: [], opponent: [] };
  patchSide(e, YOU, sc.you, ids.you);
  patchSide(e, OPPONENT, sc.opponent, ids.opponent);
  e.settle();
  e.ev('info', `Scenario ${sc.id} — ${sc.card}. ${sc.expect.split('\n')[0]}`,
    { scenario: sc.id, card: sc.card });
  events.push(...e.events);

  // a spawn trigger that opened a question would make the prologue's first
  // action illegal for a reason that has nothing to do with the prologue —
  // say so here, where the cause is
  if (state.decision) {
    throw new ScenarioError(sc.id,
      `the board patch left a decision open (${state.decision.prompt}); a scenario board must settle`);
  }

  state = runPrologue(sc, ids, state, events);

  // THE DECLARATIONS (see `Scenario.prologue`). These are the anti-rot guard:
  // a scenario claims where it lands, and lands there or fails.
  if (state.phase !== sc.phase) {
    throw new ScenarioError(sc.id,
      `declares phase '${sc.phase}' and the setup landed in '${state.phase}'`);
  }
  const prio = state.priority ?? null;
  if (prio !== (sc.priority ?? null)) {
    throw new ScenarioError(sc.id,
      `declares priority ${sc.priority ?? 'nobody'} and the setup landed on ${prio ?? 'nobody'}`);
  }
  return { state, events };
}

// ── what the runner screen is told ───────────────────────────────────────

/**
 * The printed clauses of a card, DERIVED from `printed.json` (docs/13 §7.2's
 * standing rule: derive, never enumerate).
 *
 * This is what fills the runner's "which clause was off" dropdown. The owner
 * has ~90 seconds per card and typing must never be required to advance
 * (docs/14 §5), so the clauses have to come from the card rather than from
 * him — and hand-typing them per scenario is the enumeration the rule exists
 * to stop: a card whose text is edited would keep the old dropdown forever.
 *
 * Splitting is on sentence boundaries, after the printed markup is stripped:
 * `{i}(…)` is reminder text, `{/n}` is a line break in the card frame, and
 * `{Braced}` terms are attribute keywords that read fine inline.
 */
export function printedClauses(card: CardName): string[] {
  const def = getCard(card);
  const raw = (def.text ?? '')
    .replace(/\{\/n\}/g, ' ')
    .replace(/\{i\}\([^)]*\)/g, ' ')
    .replace(/\{([^}]*)\}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return [];
  // keep the terminator, so a clause reads the way it is printed
  return raw.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

// ── the scripted opponent's rule ─────────────────────────────────────────

/**
 * The action TYPES the scripted opponent will take, most passive first
 * (docs/14 §4).
 *
 * It lives here rather than in main.ts — where the bot itself runs — for one
 * reason: `186-scenario-library.test.ts` asserts, for every scenario in the
 * library, that this rule can always answer for seat 1. A second copy of the
 * order in the test would make that guard a check on the copy, which is the
 * `stripCode`/`65-effect-conformance` shape docs/13 §5 lists twice.
 *
 * Within a type it takes the FIRST offer, and that is not an accident of
 * ordering: `legalActions` pushes `declareAttack {columns: []}` and
 * `declareBlocks {blocks: {}}` before any real formation, so "the first one"
 * IS the declining one.
 *
 * `decide` is last and is the only entry that is not a decline. A decision has
 * no null answer, and a bot that refused to answer one would hang the table —
 * which docs/14 §4 names as the expensive failure ("a hung game looks like a
 * bug"). It takes option 0, and the runner screen says so on screen.
 */
export const PASSIVE_ORDER: readonly string[] = [
  'passPriority',      // the answer to every window
  'declareBlocks',     // first offer = block nothing
  'declareAttack',     // first offer = attack with nobody
  'donePlanning', 'doneHaste', 'doneDeploying',
  'decide',            // last resort — see above
];

/** The bot's move, given what the seat may legally do. `undefined` means the
 * board is asking seat 1 for a real decision this bot has no business
 * inventing — the caller stops, and the runner's "open the other seat" notice
 * does its job. */
export function passiveMove(legal: readonly Action[]): Action | undefined {
  for (const type of PASSIVE_ORDER) {
    const hit = legal.find(a => a.type === type);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The four buttons (docs/14 §5), in the order the runner shows them.
 *
 * FOUR, not three. `bad-scenario` is not optional: without it a wrong SETUP
 * becomes a card bug report, and an agent spends a round chasing it — which is
 * the failure `docs/13-assessment.md` §6 records three times (#15, #104 and
 * #106 were all presentation problems misdiagnosed as rules problems).
 *
 * `slightly-off` is the other one people would cut: right outcome, wrong
 * amount / timing / wording / feel. Collapsing it into `broken` loses the
 * distinction that decides whether a fix is a rules change or a polish item.
 */
export const VERDICTS = ['works', 'broken', 'slightly-off', 'bad-scenario'] as const;
export type Verdict = typeof VERDICTS[number];

/** Everything the runner screen needs. Sent on join and on every update for a
 * scenario room; `null` for every ordinary room, which is what keeps the
 * tester out of normal play. */
export interface ScenarioBrief {
  id: string;
  card: CardName;
  why: string;
  expect: string;
  clauses: string[];
  needsLiveOpponent: boolean;
}

export function scenarioBrief(id: string): ScenarioBrief | null {
  const sc = SCENARIOS[id];
  if (!sc) return null;
  return {
    id: sc.id, card: sc.card, why: sc.why, expect: sc.expect,
    clauses: printedClauses(sc.card),
    needsLiveOpponent: sc.needsLiveOpponent === true,
  };
}
