/* UI REACHABILITY CONFORMANCE — every action the engine will legally accept
 * must have a way in from the player's seat.
 *
 * WHY THIS EXISTS
 *
 * Twice on 2026-08-22 the owner reported that "the game won't let me do X",
 * and both times the ENGINE was right, fully tested, and completely out of
 * reach:
 *
 *  - **R79, viruses on spells on the stack.** `legalActions` had been emitting
 *    `{ type: 'augment', from: 'hand', index, hostStack }` since the rule
 *    landed. `grep -rn hostStack engine/ui/` returned ZERO hits. Not a wrong
 *    affordance — no affordance. The owner asked whether the combo was even
 *    legal, because from the board it behaved as though it wasn't.
 *  - **R84 {Alluring}.** A correct, heavily-tested compulsory-block rule.
 *    `grep -rn Alluring engine/ui/` returned exactly one hit, a glossary entry.
 *    The block bar never named the duty and never gated Confirm, so the only
 *    thing a lured defender ever saw was a red refusal after committing.
 *
 * The engine suite cannot catch either by construction: it drives `apply()`
 * directly and never asks whether a human could have got there. Every test in
 * it would still be green with the whole client deleted. This file is the
 * missing question.
 *
 * WHAT IT ASSERTS
 *
 * A FACET is one distinguishable shape of action — the type, plus the fields
 * that change WHICH affordance or WHICH anchor on screen produces it
 * (`augment:host-unit` and `augment:host-stack` are two facets; `handIndex: 3`
 * and `handIndex: 4` are not). Both real bugs were facets inside a handled
 * type, which is why "every Action type name appears somewhere in ui/" would
 * have caught neither.
 *
 *  1. Real games are played (a curated constructed fuzz, a shared/draft fuzz,
 *     and four scripted positions for facets luck will not reach). Every facet
 *     `legalActions` emits along the way is collected, with the position it
 *     came from.
 *  2. Every collected facet must appear in the REACH ledger below. A facet the
 *     engine grows and nobody wires up fails here.
 *  3. Every ledger entry must have been collected. An entry that stops being
 *     reachable-because-real is as loud as an unreachable action — the house
 *     staleness rule (68-target-conformance, 71-card-ledger).
 *  4. Each entry carries its EVIDENCE, and the evidence runs:
 *       'helper'  — a pure function in ui/inspect.ts (or ui/formation.ts) is
 *                   handed the very legal-action list the client renders from,
 *                   and must surface this action. This is the strong form: it
 *                   executes the client's actual judgement against a real
 *                   position.
 *       'wiring'  — no helper owns it; the affordance is a line or two in
 *                   ui/main.ts, which takes the document and the socket at
 *                   import time and so cannot be loaded here. Those lines are
 *                   read AS TEXT. This is the weak form, and each one says so.
 *       'unoffered' — `legalActions` never emits it (`concede`, and the
 *                   spell-token rider on an attack). Nothing to reach; the
 *                   entry says why, and is asserted to still be absent.
 *  5. Cross-cutting sweeps, run over EVERY position the corpus visits
 *     rather than one sample: every legal mod placement must be a host
 *     `modHosts()` glows, every legal activation must be an entry
 *     `unitClickOptions()` offers and names, every legal cached play must be a
 *     card `playableCachedNames()` lists — and every legal block declaration
 *     must be one `blockPlanIssue()` would let the player Confirm.
 *
 * WHAT IT CANNOT CATCH
 *
 * Only that a path EXISTS. Not that it is discoverable (the affordance may be
 * three clicks deep behind a right-click menu nobody opens), not that it is
 * labelled truthfully, not that it is laid out where a hand goes, and not that
 * the resulting action is the one the player meant. A 'wiring' row is weaker
 * still: it proves a string is in a file, not that the string runs. Both real
 * incidents WOULD have been caught — `hostStack` and any Alluring gate were
 * absent from ui/ entirely — but a future bug that keeps the identifier and
 * breaks the behaviour will walk straight past a 'wiring' row. Where a helper
 * can own the judgement, move the row to 'helper'; that is the direction this
 * file is meant to travel.
 *
 * Seeds 7500-7599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apply, createGame, legalActions, IllegalAction } from '../src/apply.ts';
import { rngNext } from '../src/rng.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  blockPlanIssue, boardMenuEntries, castableTokens, modHostCount, modHostPhrase, modHosts,
  playableCachedNames, unitClickOptions,
} from '../ui/inspect.ts';
import { sendableTokens, shouldAskSend, splitCounterattack } from '../ui/battle.ts';
import { dropIntoRow } from '../ui/formation.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';
import type {
  Action, CardName, Entity, EntityId, GameState, Seat,
} from '../src/types.ts';

/* ── a facet: the part of an action's shape the UI has to answer for ──── */

/**
 * The facets one action exhibits.
 *
 * A field earns a facet when it decides WHICH affordance or WHICH anchor on
 * screen has to produce the action — `from` picks the zone dialog, `hostId`
 * vs `hostStack` picks the thing you click, `mode` picks the menu entry,
 * `via` picks whose ability is being named. A field the client merely carries
 * back to the engine (`handIndex`, `entityId`, `element`, `position`, the
 * contents of `columns`) does not: it is the payload of an affordance that
 * already exists, not a second affordance. `element` is checked separately —
 * see the recycle entry, which asserts the menu's element list covers what
 * the engine actually offers.
 *
 * An action with two independent axes emits one facet per axis rather than
 * their product: what has to be true is "the client can send a `send` list",
 * not "the client can send a `send` list together with two blocks".
 */
/**
 * R89: which KIND of thing an augment's `hostId` names.
 *
 * A spell token in play is an `Entity` exactly as a unit is, and the engine
 * puts both in the same field — so this is the one facet that cannot be read
 * off the action alone. Without the state (the sweep's `note` always has it)
 * it degrades to `host-unit`, which is the pre-R89 answer.
 */
function hostKindOf(a: Extract<Action, { type: 'augment' }>, s?: GameState): string {
  if (a.hostStack !== undefined) return 'host-stack';
  if (a.hostId !== undefined && s?.entities[a.hostId]?.kind === 'spellToken') return 'host-token';
  return 'host-unit';
}

export function facetsOf(a: Action, s?: GameState): string[] {
  switch (a.type) {
    case 'playCard': return [`playCard:${a.mode ?? 'plain'}`];
    case 'prophesy': return [`prophesy:${a.from}`];
    case 'graft': return [`graft:${a.from}`];
    // R89: a spell TOKEN host arrives in `hostId`, the same field a unit host
    // uses, so `host-unit` swallowed it whole and the new ruling passed this
    // sweep in silence — the exact failure mode this file exists to prevent.
    // The kind is not in the action, so the facet needs the state to see it.
    case 'augment':
      return [`augment:${a.from}`, `augment:${hostKindOf(a, s)}`];
    case 'activateAbility':
      return [`activateAbility:${a.via === undefined ? 'own' : a.via === 'augment' ? 'augment' : 'mod'}`];
    case 'declareAttack':
      return [a.columns.length ? 'declareAttack:columns' : 'declareAttack:skip',
        ...(a.spellTokens?.length ? ['declareAttack:spellTokens'] : [])];
    // R87: `spellTokens` is its own axis for the same reason `send` is — the
    // client has to be able to put a token in that field, and folding it into
    // `declareBlocks:send` let the whole rider pass this sweep unguarded.
    case 'declareBlocks':
      return [Object.keys(a.blocks).length ? 'declareBlocks:blocks' : 'declareBlocks:none',
        ...(a.send?.length ? ['declareBlocks:send'] : []),
        ...(a.spellTokens?.length ? ['declareBlocks:spellTokens'] : [])];
    case 'decide': return [`decide:${Array.isArray(a.choice) ? 'order' : 'one'}`];
    default: return [a.type];
  }
}

/* ── the corpus: real positions, and where each facet was first seen ────
 * (the sweeps, the scenarios and the corpus itself follow, in that order) */

/** one position in which the engine offered this facet */
interface Sample {
  facet: string;
  /** the state as the client would have it — legalActions is re-read from it */
  state: GameState;
  seat: Seat;
  /** the exact action that carried the facet */
  action: Action;
  /** which game / scenario, for the failure message */
  where: string;
}

/**
 * The constructed deck the fuzz plays with.
 *
 * Random play over the 492-card pool reaches the common facets in every game
 * and the rare ones by luck: `playCard:discardMe`, `prophesy:bin` and
 * `activateAbility:via-a-mod` showed up in none of twelve shared games. A
 * 30-card deck of nothing but the cards that carry the rare shapes turns luck
 * into coverage, and costs less than a second because constructed games are
 * short. Two copies of each is the format's own limit (checkDeck).
 */
const FUZZ_DECK: CardName[] = [
  'The Foretold',           // prophecy banner for [zero] → prophesy, then playCached
  'Angel of Anguish',       // "I can be prophesied from your bin"
  'Dropslime',              // a "Discard me" cost line
  'Mirrorback Ambusher',    // an Ambush mode
  'Astralith',              // an augment whose [Augment] text is an ACTIVATED ability
  'Enigmatic Warder',       // …and one that activates its own text box
  'Chitin Shredder',        // {Virus}
  'Throwing Boulder',
  'Geode',                  // cheap graft + graft cause
  'Bloated Manablub',
  'Oracle of the Flame',    // a plain activated ability
  'Perpetual Construct',
  'Tempest Wrangler',       // {Alluring}
  'Immolate',
  'Arc Lightning',
].flatMap(n => [n, n]);

/* ── the cross-cutting sweeps, run at EVERY position ──────────────────── */

/**
 * The four questions worth asking of every position rather than of one
 * sample, because each is a helper the client renders directly from: if the
 * helper does not surface a legal action, nothing on screen does.
 */
function sweepIssues(s: GameState, seat: Seat, legal: readonly Action[], where: string): string[] {
  const out: string[] = [];
  for (const a of legal) {
    // mods: the glow behind a placement IS modHosts(), and a host that does
    // not glow takes no click (ui/main.ts routes the click through the cache)
    if (a.type === 'augment' || a.type === 'graft') {
      // R89: the state goes in, so a spell-token host is asked for by its own
      // kind rather than being accepted as "a unit". A sweep that cannot tell
      // them apart is a sweep the token host walks straight through.
      const hosts = modHosts(legal, { from: a.from, index: a.index, mode: a.type }, s);
      const kind = a.type === 'augment' ? hostKindOf(a, s) : 'host-unit';
      const found = kind === 'host-stack' ? hosts.stack.has((a as { hostStack: number }).hostStack)
        : kind === 'host-token' ? !!hosts.tokens?.has((a as { hostId: EntityId }).hostId)
          : hosts.units.has((a as { hostId: EntityId }).hostId);
      if (!found) out.push(`${where}: modHosts() does not offer ${JSON.stringify(a)}`);
    }
    // activations: unitClickOptions IS the unit's click menu, and its label is
    // the only thing distinguishing two abilities on one card
    if (a.type === 'activateAbility') {
      const u = s.entities[a.entityId];
      if (!u) { out.push(`${where}: activateAbility names a ghost entity ${a.entityId}`); continue; }
      const opts = unitClickOptions(s, u, legal, null);
      const hit = opts.find(o => o.action && JSON.stringify(o.action) === JSON.stringify(a));
      if (!hit) out.push(`${where}: unitClickOptions() does not offer ${JSON.stringify(a)}`);
      else if (hit.label === '?') out.push(`${where}: ${u.card}'s ability has no name in the menu`);
    }
    // cache: the dialog lists the cards it can play by name
    if (a.type === 'playCached') {
      const cc = (s.players[seat]!.cache ?? [])[a.index];
      const named = playableCachedNames(s.players[seat]!.cache ?? [], legal as Action[]);
      if (!cc) out.push(`${where}: playCached names cache slot ${a.index}, which is empty`);
      else if (!named.includes(cc.card)) {
        out.push(`${where}: playableCachedNames() omits ${cc.card}, which is playable`);
      }
    }
    // R84: the client must never refuse a declaration the engine would take.
    // `blocks` is what the block builder holds; `send` rides along untouched.
    if (a.type === 'declareBlocks') {
      const why = blockPlanIssue(s, seat, a.blocks);
      if (why) out.push(`${where}: blockPlanIssue() would refuse a LEGAL declaration — ${why}`);
    }
    // spell tokens: the count behind the "you still have castable tokens" bar
    if (a.type === 'castSpellToken' && castableTokens(legal) < 1) {
      out.push(`${where}: castableTokens() counts none, with a token cast on offer`);
    }
  }
  return out;
}

/* ── scripted positions for the facets a fuzz will not reliably reach ─── */

interface Position { h: Harness; seat: Seat }

/**
 * R79's exact shape (the same one 74-ui-stack-mod-host builds): a spell on the
 * stack, a unit in the battle region, and the seat holding priority holding a
 * {Virus} it can pay for. Both KINDS of mod host are legal at once.
 */
function virusWindow(): Position {
  const h = new Harness(7540);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  giveResources(h, D, 'fire', 4);                     // Arc Lightning rr/4
  giveResources(h, A, 'earth', 2);                    // Chitin Shredder ee/2
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Arc Lightning') });
  pick(h, { player: A });                             // R67: aimed as it is cast
  give(h, A, 'Chitin Shredder');
  return { h, seat: A };
}

/** an Ambush mode wants a battle window, an ally to displace, and the printed
 * ambush cost rather than the card cost */
function ambushWindow(): Position {
  const h = new Harness(7541);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  spawn(h, D, 'The Foretold');                        // the ally the ambusher recalls
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  giveResources(h, D, 'water', 1);                    // Mirrorback Ambusher ambush be/2
  giveResources(h, D, 'earth', 1);
  give(h, D, 'Mirrorback Ambusher');
  return { h, seat: D };
}

/**
 * One deployment window stocked with every zone the rules make a source.
 *
 * R41 ("you CAN augment or graft from cache", Caleb 2024-12-02) and R42 ("I
 * can be prophesied from your bin", Angel of Anguish) both put ordinary
 * actions behind zones a random game rarely fills. Cards reach the cache by
 * being prophesied and no card in the pool carries both a prophecy banner and
 * a mod line, so the zone is stocked directly — which is what a Glimpse effect
 * does to it anyway.
 *
 * It also holds the two donated-ability shapes: Astralith's [Augment] text is
 * an ACTIVATED ability, live on the card when it is played normally
 * (via: 'augment') and again on any host it is augmented onto (via: { mod }).
 */
function deployBench(): Position {
  const h = new Harness(7542);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  const host = spawn(h, seat, 'Geode');               // a host, and a graft cause
  spawn(h, seat, 'Astralith');                        // its own [Augment] text is live
  giveResources(h, seat, 'metal', 1);                 // the mod cost, m/1
  h.do({ type: 'augment', seat, from: 'hand', index: give(h, seat, 'Astralith'), hostId: host });
  h.state.players[seat]!.cache = [
    { card: 'Astralith', uid: 9001 },                 // m/1 augment
    { card: 'Bloated Manablub', uid: 9002 },          // b/1 graft
  ];
  h.state.players[seat]!.bin.push('Angel of Anguish');
  give(h, seat, 'The Foretold');                      // a prophecy banner for [zero]
  giveResources(h, seat, 'metal', 4);                 // the donated ability costs [three]
  giveResources(h, seat, 'water', 2);
  return { h, seat };
}

/**
 * Two DIFFERENT on-attack triggers landing together is an ordering decision —
 * the one decision kind whose answer is a LIST rather than an index, and a
 * different affordance (pick them one at a time) for it. Two copies of the
 * same trigger are deliberately NOT asked about (E.sameTrigger: the choice
 * could not even be expressed), so the two attackers have to differ.
 */
function orderingDecision(): Position {
  const h = new Harness(7543);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');       // {Alluring}
  const other = spawn(h, A, 'Formless');              // "when I attack or block…"
  spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure], [other]] });
  const dec = h.state.decision;
  assert.equal(dec?.kind, 'orderTriggers', 'two unlike triggers arrive together');
  assert.equal(dec!.pickOrder, true, 'and the answer is an ORDER, not an index');
  return { h, seat: dec!.seat };
}

/**
 * R87, playtest report #67 (GETD): the block step of round 1, with a free
 * counterattacker AND a spell token of the defender's standing in the
 * contested region. `legalActions` offers the rider on top of each unit send,
 * and no fuzz game reliably arrives here with a token in the right place.
 */
function counterattackRide(): Position {
  const h = new Harness(7544);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  spawn(h, D, 'The Foretold');                        // free to counterattack
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // created where the defender stands, which is where a counterattack leaves
  // from — the only place doDeclareBlocks will accept a rider from
  new E(h.state).createSpellToken(D, 'Poison', 1, h.state.battle!.region);
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'blocks', 'stopped at the block step');
  return { h, seat: D };
}

/**
 * R89: a deployment window with a spell TOKEN in the home region and an
 * attribute-granting augment in hand. Spell tokens exist in the deployment
 * phase only when something made one and regroup has not erased it yet, which
 * a random game does not arrange.
 */
function tokenModHost(): Position {
  const h = new Harness(7545);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  const e = new E(h.state);
  spawn(h, seat, 'Geode');                            // a unit host, for contrast
  giveResources(h, seat, 'earth', 8);                 // Chitin Shredder, ee/2
  e.createSpellToken(seat, 'Fireball', 3, e.homeRegion(seat));
  give(h, seat, 'Chitin Shredder');                   // "[Augment] {Powerful} …"
  return { h, seat };
}

const SCENARIOS: Record<string, () => Position> = {
  virusWindow, ambushWindow, deployBench, orderingDecision, counterattackRide, tokenModHost,
};

const corpus = (() => {
  const samples = new Map<string, Sample>();
  /** every complaint the cross-cutting sweeps raised, over every position */
  const sweep: string[] = [];
  let positions = 0;

  const note = (state: GameState, seat: Seat, legal: readonly Action[], where: string): void => {
    positions++;
    for (const a of legal) {
      for (const f of facetsOf(a, state)) {
        if (samples.has(f)) continue;
        samples.set(f, { facet: f, state: structuredClone(state), seat, action: a, where });
      }
    }
    sweep.push(...sweepIssues(state, seat, legal, where));
  };

  /** play one game, recording every facet offered along the way */
  const playOut = (state0: GameState, seed: number, maxActions: number, where: string): void => {
    let rng = (seed * 2654435761) >>> 0;
    const rand = (): number => { const [v, next] = rngNext(rng); rng = next; return v; };
    let state = state0;
    for (let i = 0; i < maxActions && state.phase !== 'gameover'; i++) {
      const all: { seat: Seat; a: Action }[] = [];
      for (const seat of [0, 1] as Seat[]) {
        const legal = legalActions(state, seat);
        if (legal.length) note(state, seat, legal, `${where}@${i}`);
        for (const a of legal) all.push({ seat, a });
      }
      if (!all.length) break;
      const chosen = all[Math.floor(rand() * all.length)]!;
      try { state = apply(state, chosen.a).state; } catch (err) {
        // fuzz.ts owns "legalActions lied"; here a refusal just ends the game
        if (err instanceof IllegalAction) break;
        throw err;
      }
    }
  };

  // 1. constructed, curated deck — the rare shapes, cheaply
  for (let seed = 7500; seed < 7508; seed++) {
    playOut(createGame(seed, undefined, 'constructed', undefined, [FUZZ_DECK, FUZZ_DECK]).state,
      seed, 400, `constructed/${seed}`);
  }
  // 2. shared and draft over the whole pool — the breadth, and the net that
  //    catches a facet nobody thought to curate for
  for (let seed = 7520; seed < 7532; seed++) {
    const mode = seed % 3 === 0 ? 'draft' : 'shared';
    playOut(createGame(seed, undefined, mode).state, seed, 300, `${mode}/${seed}`);
  }
  // 3. the positions luck does not reach
  for (const [name, build] of Object.entries(SCENARIOS)) {
    const { h, seat } = build();
    note(h.state, seat, legalActions(h.state, seat), `scenario:${name}`);
  }
  return { samples, sweep, positions };
})();

/* ── reading ui/main.ts as text ────────────────────────────────────────
 *
 * main.ts takes the document, the socket and the URL at import time, so it
 * cannot be imported here. A 'wiring' row names the lines that connect a
 * tested helper (or a bare `legal.filter`) to something clickable; deleting
 * one puts the action out of reach with every other test in the suite green.
 * A board button's handler is its entry in the BOARD_BTNS table (matched as
 * `^  name: … =>` at the table's indent), so a deleted handler fails here.
 * That is the whole strength of the check and also its whole weakness — see
 * the header. */
const MAIN = readFileSync(new URL('../ui/main.ts', import.meta.url), 'utf8');

/* ── the ledger ────────────────────────────────────────────────────────── */

type Evidence =
  | { via: 'helper'; anchor: string; why: string; check: (s: Sample) => void; needs?: RegExp[] }
  | { via: 'wiring'; anchor: string; why: string; needs: RegExp[] }
  | { via: 'unoffered'; why: string; needs?: RegExp[] };

/** the legal-action list a sample's client would be rendering from */
const legalAt = (s: Sample): Action[] => legalActions(s.state, s.seat);

/** the mod-placement helper check both augment and graft rows use */
const modReach = (kind: 'augment' | 'graft', want: 'units' | 'stack' | 'tokens') => (s: Sample): void => {
  const a = s.action as Extract<Action, { type: 'augment' | 'graft' }>;
  const hosts = modHosts(legalAt(s), { from: a.from, index: a.index, mode: kind }, s.state);
  assert.ok(modHostCount(hosts) > 0, `nothing glows for ${JSON.stringify(a)} (${s.where})`);
  const id = want === 'stack'
    ? (a as { hostStack?: number }).hostStack : (a as { hostId?: EntityId }).hostId;
  assert.ok(id !== undefined, 'the sample carries the host the facet is about');
  assert.ok(hosts[want]?.has(id!), `modHosts().${want} does not include ${id} (${s.where})`);
  // …and the zone banner, which asks the same question before a card is picked
  const zone = modHosts(legalAt(s), { from: a.from, mode: kind }, s.state);
  assert.ok(modHostCount(zone) > 0, `the ${a.from} banner offers no host at all (${s.where})`);
  // R89: and it must NAME the kind. "a unit" over a spell token is how a
  // ruling stays invisible while every test stays green.
  if (want === 'tokens') {
    assert.match(modHostPhrase(hosts), /spell token/,
      `the bar calls a spell-token host "${modHostPhrase(hosts)}" (${s.where})`);
  }
};

/**
 * WHERE EVERY LEGAL ACTION COMES FROM, and what proves it.
 *
 * Every entry's `why` says what the player is actually doing. An entry may not
 * be removed just because it is inconvenient: rule 3 above fails when a listed
 * facet stops being offered, and rule 2 fails when an offered facet is not
 * listed, so the ledger and the engine are pinned to each other.
 */
const REACH: Record<string, Evidence> = {

  // ── planning ──────────────────────────────────────────────────────────
  recycleForResource: {
    via: 'helper', anchor: 'a card in your hand, during planning',
    why: 'clicking a hand card opens one "Recycle → <element> resource" entry per element in play',
    // the menu is built from `s.elements`, NOT from the legal list, so the two
    // can drift: a game whose element list is narrower than what the engine
    // offers has entries with no menu item. That is the real question here.
    // R101/#63: `s.elements` now goes through resourceMenuElements, which only
    // ever decides which of them to draw FIRST — every element it holds back is
    // behind the "more elements…" expander, so this question is unchanged.
    check: s => {
      const offered = new Set(legalAt(s).filter(a => a.type === 'recycleForResource').map(a => a.element));
      const inMenu = new Set(s.state.elements);
      for (const el of offered) {
        assert.ok(inMenu.has(el as never),
          `the engine offers a recycle into ${el}, which the hand menu (built from state.elements: `
          + `${[...inMenu].join(', ')}) never lists`);
      }
      const a = s.action as Extract<Action, { type: 'recycleForResource' }>;
      assert.ok(a.handIndex < s.state.players[s.seat]!.hand.length, 'and there is a card to click');
    },
    needs: [/const \{ show, hidden \} = resourceMenuElements\(s, p, s\.elements, expanded\);/,
      /const items: MenuItem\[\] = show\.map\(el => \(\{/,
      /type: 'recycleForResource', seat: p, handIndex: i, element: el/],
  },
  activateResource: {
    via: 'wiring', anchor: 'a dormant resource chip',
    why: 'clicking the chip fires it, or opens a menu when the chip can also be exchanged',
    needs: [/a\.type === 'activateResource' && a\.index === i/, /label: a\.type === 'activateResource' \? 'Activate'/],
  },
  exchangePrismite: {
    via: 'wiring', anchor: 'an active Prismite chip',
    why: 'R17: the same chip menu, one entry per element the Prismite may become',
    // the label reads a.element — without it every entry would read the same
    needs: [/a\.type === 'exchangePrismite' && a\.index === i/, /Exchange → \$\{\(a as \{ element: string \}\)\.element\}/],
  },
  donePlanning: {
    via: 'wiring', anchor: 'the "done planning" button in the prompt bar',
    why: 'with a second confirm bar when activations are still unspent',
    needs: [/act\(\{ type: 'donePlanning', seat: Number\(btn\.dataset\['p'\]\) \}\)/, /data-btn="doneplan"/],
  },
  doneHaste: {
    via: 'wiring', anchor: 'the "done" button in the haste step (R18)',
    why: 'the haste step only appears when someone holds a payable {Haste} card',
    needs: [/^  donehaste: btn =>/m, /act\(\{ type: 'doneHaste', seat: Number\(btn\.dataset\['p'\]\) \}\)/],
  },
  draftCommit: {
    via: 'wiring', anchor: 'the draft panel: build the merge, then Commit',
    why: 'legalActions offers only single swaps; the panel builds any merge and apply() validates it',
    needs: [/^  draftcommit: btn => \{\n    if \(!ui\.draftPack\) return;/m, /packIndices: ui\.draftPack\.slice\(\)/],
  },
  bottomCards: {
    via: 'helper', anchor: 'pick two hand cards, then the Commit button',
    why: 'the constructed draw phase — click to pick, click again to unpick, capped at two',
    check: s => {
      const a = s.action as Extract<Action, { type: 'bottomCards' }>;
      const hand = s.state.players[s.seat]!.hand.length;
      for (const i of a.handIndices) assert.ok(i < hand, `hand index ${i} has no card to click`);
      assert.ok(a.handIndices.length <= 2, 'the picker caps at two, so the engine must not want more');
    },
    needs: [/kind === 'bottomcard'/, /ui\.bottomPick\.length < 2/, /handIndices: ui\.bottomPick\.slice\(\)/],
  },

  // ── playing a card ────────────────────────────────────────────────────
  'playCard:plain': {
    via: 'wiring', anchor: 'a card in your hand',
    why: 'the hand click filters the legal list by handIndex and offers "Play <card>"',
    needs: [/const playActions = legal\.filter\(a => a\.type === 'playCard' && a\.handIndex === i\)/,
      /`Play \$\{name\}`/],
  },
  'playCard:ambush': {
    via: 'wiring', anchor: 'the same hand menu, as a separate entry',
    why: 'an Ambush is a whole other play mode at a whole other cost, so it needs its own line',
    // without reading `mode` both entries would read "Play X" and one of the
    // two modes would be indistinguishable from the other
    needs: [/mode === 'ambush' \? `Ambush with \$\{name\}`/],
  },
  'playCard:discardMe': {
    via: 'wiring', anchor: 'the same hand menu, as a separate entry',
    why: 'R40: paying a "1 Discard me" line is a play mode that TRASHES the card, and says so',
    needs: [/mode === 'discardMe' \? discardMeLabel\(name\)/, /function discardMeLabel/],
  },
  'prophesy:hand': {
    via: 'wiring', anchor: 'a card in your hand, at deployment',
    why: 'R42: an entry naming the banner cost and the condition — and it never fires on the '
      + 'click that revealed it (actionNeedsMenu)',
    needs: [/a\.type === 'prophesy' && a\.from === 'hand' && a\.index === i/,
      /confirm: actionNeedsMenu\(a\)/],
  },
  'prophesy:bin': {
    via: 'wiring', anchor: 'a card in the bin dialog',
    why: '"I can be prophesied from your bin" (Angel of Anguish) — the bin is a second source',
    needs: [/a\.type === 'prophesy' && a\.from === 'bin' && a\.index === i/,
      /binView = null; act\(proph\[0\]!\)/],
  },
  playCached: {
    via: 'helper', anchor: 'a card in the cache dialog',
    why: 'R42/R45: free on a fulfilled prophecy, or for its mana on a live glimpse',
    check: s => {
      const a = s.action as Extract<Action, { type: 'playCached' }>;
      const cache = s.state.players[s.seat]!.cache ?? [];
      const names = playableCachedNames(cache, legalAt(s));
      assert.ok(cache[a.index], 'the cached card the engine names is really there');
      assert.ok(names.includes(cache[a.index]!.card),
        `the cache banner does not list ${cache[a.index]!.card} as playable (${s.where})`);
    },
    needs: [/a\.type === 'playCached' && a\.index === i/, /cacheView = null; act\(a\)/],
  },
  castSpellToken: {
    via: 'helper', anchor: 'a spell token on the board',
    why: 'clicking the token casts it; the count also gates the "you still have castable tokens" bar',
    check: s => {
      const a = s.action as Extract<Action, { type: 'castSpellToken' }>;
      assert.ok(s.state.entities[a.entityId], 'the token is a real entity, so it has a scan on screen');
      assert.ok(castableTokens(legalAt(s)) > 0, 'and the confirm bar knows it is castable');
    },
    needs: [/kind === 'token'/, /type: 'castSpellToken', seat: tok\.controller, entityId: tok\.id/],
  },

  // ── activated abilities ───────────────────────────────────────────────
  // one helper answers all three: the difference between them is only whose
  // text is being activated, which is exactly what the LABEL has to say.
  'activateAbility:own': {
    via: 'helper', anchor: 'the unit itself',
    why: "the printed abilities list — one entry means clicking the unit just does it, "
      + 'several open the menu at the cursor',
    check: activationReach,
  },
  'activateAbility:augment': {
    via: 'helper', anchor: 'the unit itself',
    why: "the card's own text-box [Augment] clause, which is live when the card was played "
      + 'normally rather than as a mod (Manual Q&A)',
    check: activationReach,
  },
  'activateAbility:mod': {
    via: 'helper', anchor: 'the unit itself',
    why: 'an ability donated by an augment mod slid under the unit; the menu entry has to name '
      + 'the MOD, or two donated abilities read identically',
    check: activationReach,
  },

  // ── mods ──────────────────────────────────────────────────────────────
  'augment:hand': {
    via: 'helper', anchor: 'a hand card → "Augment …" → click a glowing host',
    why: 'the ordinary path — pick the card, pick one of the hosts the board lights up',
    check: modReach('augment', 'units'),
    needs: [/const modActions = legal\.filter\(a => \(a\.type === 'augment' \|\| a\.type === 'graft'\) && a\.from === 'hand'/],
  },
  'augment:bin': {
    via: 'helper', anchor: 'a card in the bin dialog',
    why: 'the bin is a mod source; the dialog closes so the host pick is visible',
    check: modReach('augment', 'units'),
    needs: [/a\.from === 'bin' && a\.index === i\)/, /if \(mods\.length\) binView = null;/],
  },
  'augment:cache': {
    via: 'helper', anchor: 'a card in the cache dialog',
    why: 'R41: "you CAN augment or graft from cache" — free when its prophecy is fulfilled',
    check: modReach('augment', 'units'),
    needs: [/modMenuItems\(p, 'cache', i, cc\.card, mods,/],
  },
  'augment:host-unit': {
    via: 'helper', anchor: 'a glowing unit on the board',
    why: 'the host kind that always existed',
    check: modReach('augment', 'units'),
    needs: [/modhost: !opts\.inert && modHostCache\.units\.has\(u\.id\)/, /applyMod\(m, \{ unit: id \}, e\)/],
  },
  'augment:host-stack': {
    via: 'helper', anchor: 'a glowing SPELL on the stack',
    why: 'R79 — the incident. A StackItem is not an Entity, the host cache was a Set<EntityId>, '
      + 'and so the whole ruling was unreachable from the board',
    check: modReach('augment', 'stack'),
    needs: [/modHostCache\.stack\.has\(it\.id\)/, /modHostCache\.stack\.has\(id\)/,
      /applyMod\(m, \{ stack: id \}, e\)/, /hostStack: host\.stack/],
  },
  'augment:host-token': {
    via: 'helper', anchor: 'a glowing SPELL TOKEN in the region strip, during your deployment',
    why: 'R89 — R79\'s missing half, and the same shape of exposure. Caleb 2025-03-06: "You can '
      + 'augment spells during deployment but currently that would only be possible with spell '
      + 'tokens." The engine names the token in `hostId`, exactly as it names a unit, so this '
      + 'facet used to be indistinguishable from augment:host-unit and the ruling could have '
      + 'shipped unreachable with this whole file green',
    check: modReach('augment', 'tokens'),
    needs: [/modHostCache\.tokens\?\.has\(t\.id\)/, /modHostCache\.tokens\?\.has\(tok\.id\)/,
      /applyMod\(m, \{ unit: tok\.id \}, e\)/, /modHosts\(m \? legalFor\(m\.seat\) : \[\], m, h\.state\)/,
      // "you can only do this with attributes" — said before the card is spent
      /spellAugmentNote\(card\)/],
  },
  'graft:hand': {
    via: 'helper', anchor: 'a hand card → "Graft …" → a glowing host → a slot in its mod stack',
    why: 'the position menu is the second click; position 0 goes straight in when it is the only one',
    check: modReach('graft', 'units'),
    needs: [/type: 'graft', seat: m\.seat, from: m\.from, index: m\.index, hostId, position: pos/],
  },
  'graft:bin': {
    via: 'helper', anchor: 'a card in the bin dialog',
    why: 'the same two clicks — glowing host, then slot — starting from the bin dialog instead',
    check: modReach('graft', 'units'),
  },
  'graft:cache': {
    via: 'helper', anchor: 'a card in the cache dialog',
    why: 'R41 again: the cache is a mod source for grafts as well as augments, and a fulfilled '
      + 'prophecy makes the graft free',
    check: modReach('graft', 'units'),
  },

  // ── the battle line ───────────────────────────────────────────────────
  'declareAttack:skip': {
    via: 'wiring', anchor: 'the "Don\'t attack" button',
    why: 'always offered, and always legal — the one action that is never a formation',
    needs: [/^  skipattack: \(\) =>/m, /data-btn="skipattack"/],
  },
  'declareAttack:columns': {
    via: 'helper', anchor: 'pick a unit up, drop it in a column slot, then "Attack!"',
    why: 'legalActions offers a representative set; the builder composes any shape and apply() '
      + 'validates it',
    check: s => {
      const a = s.action as Extract<Action, { type: 'declareAttack' }>;
      for (const id of a.columns.flat()) {
        const u = s.state.entities[id];
        assert.ok(u && !u.absent, `column names ${id}, which is not on the board to pick up`);
      }
      // the drop itself is ui/formation.ts, tested in 55-ui-formation
      assert.deepEqual(dropIntoRow([], 0, a.columns[0]![0]!), [a.columns[0]![0]!]);
    },
    needs: [/^  confirmattack: \(\) =>/m, /columns: cols, spellTokens: ui\.spellTokens\.slice\(\)/,
      /ui\.columns\[ci\] = dropIntoRow\(/],
  },
  'declareAttack:spellTokens': {
    via: 'unoffered',
    why: 'legalActions never emits a spellTokens rider — it enumerates attack SHAPES, and a token '
      + 'sent out with the attack is a payload the builder adds. The button sends ui.spellTokens '
      + 'on every declaration and apply() validates it, so the path exists; there is simply no '
      + 'engine offer for this test to match against.',
    needs: [/spellTokens: ui\.spellTokens\.slice\(\)/],
  },
  'declareBlocks:none': {
    via: 'helper', anchor: 'Confirm with nothing assigned',
    why: 'declining to block is a declaration like any other — unless a duty says otherwise',
    check: blockGateReach,
    needs: [/^  confirmblocks: \(\) =>/m, /const duty = blockPlanIssue\(s, s\.battle!\.defender, blocks\)/],
  },
  'declareBlocks:blocks': {
    via: 'helper', anchor: 'pick a unit up, drop it in a column slot, then Confirm',
    why: 'the row you drop into is the row it stands in (playtest BRDM: "I was forced to do '
      + 'creature B as a blocker before creature A")',
    check: blockGateReach,
    needs: [/function blockPlan\(\)/, /ui\.columns\[ci\] = dropIntoRow\(/],
  },
  'declareBlocks:send': {
    via: 'wiring', anchor: 'the counterattack slot beside the line',
    why: 'the 1v1 battle rule: units that are not blocking may be sent out with the declaration',
    needs: [/kind === 'sendslot' && ui\.carrying !== null/,
      /act\(\{ type: 'declareBlocks', seat: s\.battle!\.defender, blocks, send, spellTokens \}\)/],
  },
  'declareBlocks:spellTokens': {
    via: 'helper', anchor: 'click your spell token (strip or chip), then Confirm',
    why: 'R87, playtest report #67: "What happened to Rashi\'s Poison tokens here? She just '
      + 'wanted to bring them with her attackers but they somehow went onto the stack." '
      + '`declareBlocks` had no such field until R87, so the tokens had nowhere to go; folding '
      + 'this into declareBlocks:send would have let the new field ship unreachable too',
    check: counterattackRideReach,
    needs: [/if \(shouldAskSend\(s, def, ui\.send, ui\.rideAnswered\)\) \{/,
      /const \{ send, spellTokens \} = splitCounterattack\(s, ui\.send\);/,
      /sendableTokens\(s, ui\.confirmRide\)/],
  },
  passPriority: {
    via: 'wiring', anchor: 'the Pass button (or the space bar)',
    why: 'with a confirm bar when passing would waste a castable token',
    needs: [/^  pass: \(\) => passClick\('pass'\)/m, /act\(\{ type: 'passPriority', seat: s\.priority! \}\)/],
  },

  // ── deployment ────────────────────────────────────────────────────────
  doneDeploying: {
    via: 'wiring', anchor: 'the "done deploying" button',
    why: 'with a confirm bar naming the cached cards you would be walking away from',
    needs: [/act\(\{ type: 'doneDeploying', seat \}\)/, /data-btn="donedeploy"/],
  },

  // ── decisions ─────────────────────────────────────────────────────────
  'decide:one': {
    via: 'helper', anchor: 'a button in the decision panel — or the thing itself, on the board',
    why: 'a target is picked by clicking the unit, the player, the stack item or the cached card, '
      + 'which is the same decision index the panel button carries',
    check: s => {
      const dec = s.state.decision!;
      assert.ok(dec, 'a decide action means a decision is open');
      assert.ok(dec.options.length, 'with something to click');
      for (const o of dec.options) assert.ok(o.label?.length, 'and every option is named in the panel');
    },
    needs: [/^  decide: btn =>/m, /choice: Number\(btn\.dataset\['i'\]\)/, /function decisionOptionIndex/],
  },
  'decide:order': {
    via: 'wiring', anchor: 'the ordering panel: click the options one at a time',
    why: 'a pickOrder decision wants a LIST, so the panel collects clicks until it has them all',
    needs: [/^  orderpick: btn =>/m, /ui\.orderPicked\.length === s\.decision!\.options\.length/,
      /act\(\{ type: 'decide', seat: s\.decision!\.seat, choice \}\)/],
  },

  // ── never offered ─────────────────────────────────────────────────────
  concede: {
    via: 'unoffered',
    why: 'R65 keeps concede out of legalActions on purpose — "it is never a move to consider, '
      + 'only one to choose, and the fuzzer must never wander into it". It is reachable all the '
      + 'same, from the board right-click menu (boardMenuEntries), and the entry only OPENS the '
      + 'question rather than resigning the game.',
    needs: [/act\(\{ type: 'concede', seat \}\)/],
  },
};

/** the shared activation check: the unit's own click menu must offer this
 * exact action, and must be able to NAME it */
function activationReach(s: Sample): void {
  const a = s.action as Extract<Action, { type: 'activateAbility' }>;
  const u = s.state.entities[a.entityId] as Entity | undefined;
  assert.ok(u, 'the ability names a unit that is really on the board');
  const opts = unitClickOptions(s.state, u!, legalAt(s), null);
  const hit = opts.find(o => o.action && JSON.stringify(o.action) === JSON.stringify(a));
  assert.ok(hit, `clicking ${u!.card} does not offer ${JSON.stringify(a)} (${s.where})`);
  assert.notEqual(hit!.label, '?',
    `${u!.card}'s ability is offered with no name — two abilities on one card would be `
    + 'indistinguishable in the menu');
}

/**
 * R87: the rider the counterattack carries, from the client's own two helpers.
 *
 * The board holds ONE list (`ui.send` — everything dropped in the counterattack
 * slot or clicked in the strip) and the action has two fields, so both halves
 * have to hold: `sendableTokens` must offer every token the engine will accept,
 * and `splitCounterattack` must put each id back in the field it came from.
 */
function counterattackRideReach(s: Sample): void {
  const a = s.action as Extract<Action, { type: 'declareBlocks' }>;
  const listed = sendableTokens(s.state, s.seat);
  for (const id of a.spellTokens ?? []) {
    assert.ok(listed.includes(id),
      `sendableTokens() does not offer token ${id}, which declareBlocks accepts (${s.where})`);
  }
  const split = splitCounterattack(s.state, [...(a.send ?? []), ...(a.spellTokens ?? [])]);
  assert.deepEqual(split.send, a.send ?? [], 'the units go back to `send`');
  assert.deepEqual(split.spellTokens, a.spellTokens ?? [], 'and the tokens to `spellTokens`');
  assert.ok(split.send.length,
    '"they always need a unit to take them with them" — a token-only counterattack is refused');
  // and the dialogue is offered for exactly this shape: a unit picked, tokens
  // available, none taken
  assert.equal(shouldAskSend(s.state, s.seat, split.send, false), true,
    `the client would send this counterattack without ever mentioning the tokens (${s.where})`);
  assert.equal(shouldAskSend(s.state, s.seat, [], false), false,
    'and never asks about a block-only declaration, which cannot carry a token at all');
}

/**
 * R84: the Confirm gate must agree with the engine, in BOTH directions.
 *
 * The incident was one-directional — the client knew nothing, so it let the
 * player build a declaration the engine would refuse and only said so after
 * the fact. Fixing that by refusing more than the engine does would be the
 * same bug wearing the other hat: an unreachable legal block. So:
 *
 *  - every declaration `legalActions` offers must pass the gate (this also
 *    runs at every position in the corpus, via sweepIssues), and
 *  - when a duty is live, the gate must actually SAY so: an assignment the
 *    engine refuses must be one the client refuses first, in words.
 */
function blockGateReach(s: Sample): void {
  const legal = legalAt(s);
  const blocks = legal.filter((a): a is Extract<Action, { type: 'declareBlocks' }> =>
    a.type === 'declareBlocks');
  assert.ok(blocks.length, 'the block step always has something to offer');
  for (const a of blocks) {
    assert.equal(blockPlanIssue(s.state, s.seat, a.blocks), null,
      `the client would refuse ${JSON.stringify(a.blocks)}, which the engine offers (${s.where})`);
  }
}

/* ── the assertions ────────────────────────────────────────────────────── */

test('the corpus reaches real positions and the helpers agree with the engine everywhere', () => {
  assert.ok(corpus.positions > 2000,
    `only ${corpus.positions} positions visited — the corpus has stopped playing games`);
  // the four sweeps, over every position: a helper that fails to surface a
  // legal action here is an action nothing on screen can produce
  assert.deepEqual(corpus.sweep.slice(0, 12), [],
    `${corpus.sweep.length} position(s) where a client helper does not surface a legal action`);
  console.log(`    ui reachability: ${corpus.positions} positions · `
    + `${corpus.samples.size} distinct action facets`);
});

test('every action shape the engine offers is in the reachability ledger', () => {
  const unlisted = [...corpus.samples.values()]
    .filter(s => !(s.facet in REACH))
    .map(s => `${s.facet} — first seen at ${s.where}: ${JSON.stringify(s.action)}`);
  assert.deepEqual(unlisted, [],
    'these action shapes are legal and are not accounted for anywhere in ui/. Either wire an '
    + 'affordance to them and add a ledger row, or add an \'unoffered\' row saying why nobody '
    + 'should be able to reach them:\n  ' + unlisted.join('\n  '));
});

test('every ledger row is still a shape the engine really offers', () => {
  const stale: string[] = [];
  for (const [facet, ev] of Object.entries(REACH)) {
    const seen = corpus.samples.has(facet);
    if (ev.via === 'unoffered') {
      if (seen) {
        stale.push(`${facet}: listed as never offered, but legalActions offered it at `
          + `${corpus.samples.get(facet)!.where} — it needs a real affordance and a real row`);
      }
      continue;
    }
    if (!seen) {
      stale.push(`${facet}: no position in the corpus offers it. Either the engine stopped `
        + 'emitting this shape (drop the row) or the corpus stopped reaching it (add a scenario '
        + `to SCENARIOS — there are ${Object.keys(SCENARIOS).length} already)`);
    }
  }
  assert.deepEqual(stale, [], `ledger rows that have outlived their reason:\n  ${stale.join('\n  ')}`);
});

test('every ledger row states an anchor and a reason a person can check', () => {
  for (const [facet, ev] of Object.entries(REACH)) {
    assert.ok(ev.why.length > 30, `${facet} needs a reason, not a shrug`);
    if (ev.via !== 'unoffered') {
      assert.ok(ev.anchor.length > 5, `${facet} must say WHAT the player clicks`);
    }
  }
});

test('the affordance for every offered shape is really in ui/main.ts', () => {
  // the 'wiring' half of the ledger, and the wiring that hangs off the
  // 'helper' half. A missing pattern is a line that was refactored away; if the
  // line moved, move the pattern with it — do not delete the row.
  const missing: string[] = [];
  for (const [facet, ev] of Object.entries(REACH)) {
    for (const re of ev.needs ?? []) {
      if (!re.test(MAIN)) missing.push(`${facet}: ui/main.ts no longer contains ${re}`);
    }
  }
  assert.deepEqual(missing, [], `affordances that have gone missing:\n  ${missing.join('\n  ')}`);
});

test('every offered shape passes its own reachability evidence', () => {
  const failures: string[] = [];
  for (const [facet, ev] of Object.entries(REACH)) {
    if (ev.via !== 'helper') continue;
    const sample = corpus.samples.get(facet);
    if (!sample) continue;                      // the staleness test owns this
    try { ev.check(sample); } catch (err) {
      failures.push(`${facet} (${sample.where}): ${(err as Error).message}`);
    }
  }
  assert.deepEqual(failures, [], `unreachable actions:\n  ${failures.join('\n  ')}`);
});

test('R65: concede stays out of legalActions and stays in the board menu', () => {
  // the one 'unoffered' row with a real affordance behind it — asserted from
  // the helper rather than from main.ts, because boardMenuEntries owns it
  for (const s of [...corpus.samples.values()].slice(0, 4)) {
    assert.equal(legalAt(s).some(a => a.type === 'concede'), false,
      'the fuzzer must never be able to wander into a concession');
    const menu = boardMenuEntries(s.state, s.seat);
    const quit = menu.find(m => m.kind === 'concede');
    assert.ok(quit, 'and the player must always be able to choose one');
    assert.equal(quit!.confirm, true, 'behind a confirm — it ends the game');
  }
});

/* ── R84 {Alluring}: the block duty, from the player's seat ──────────────
 *
 * The second incident, and the one the facet ledger alone does NOT catch: a
 * lured defender can reach every legal declaration, so nothing above would
 * fail. What was missing was the other half — the client had no idea the duty
 * existed, so it let you build a declaration the engine would refuse and told
 * you only after you committed, in the tone of a mistake you had made.
 *
 * blockPlanIssue (ui/inspect.ts) reads the engine's own validator. These tests
 * are the reason it is not allowed to become a second opinion. */

/** the reported UFAB position: two columns, one Alluring, one able blocker */
function luredDefender(seed: number): { h: Harness; D: Seat; d1: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lure = spawn(h, A, 'Tempest Wrangler');
  const plain = spawn(h, A, 'The Foretold');
  const d1 = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lure], [plain]] });
  for (let guard = 0; guard < 40 && h.state.battle!.step !== 'blocks'; guard++) {
    const dec = h.state.decision;
    if (dec?.kind === 'orderTriggers') h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
    else if (dec) pick(h, { unit: d1 });
    else pass(h);
  }
  assert.equal(h.state.battle!.step, 'blocks');
  assert.deepEqual(new E(h.state).entity(d1)!.allured, { round: 1, columns: [0] });
  return { h, D, d1 };
}

test('R84: the client names the compulsory block instead of letting you find out', () => {
  const { h, D, d1 } = luredDefender(7550);
  // an empty board, and the block bar has something to say about it
  const empty = blockPlanIssue(h.state, D, {});
  assert.ok(empty, 'declining is illegal here, and the bar has to say so BEFORE Confirm');
  assert.match(empty!, /Alluring/, 'in the engine\'s own words');
  assert.match(empty!, /The Foretold/, 'naming the unit that is under the duty');
  assert.match(empty!, /Tempest Wrangler/, 'and the attacker that lured it');
  // and the substitute the rule refuses
  assert.ok(blockPlanIssue(h.state, D, { 1: [d1] }),
    'sending the lured unit to the other column is the shape of the original report');
  // …discharged, and the gate opens
  assert.equal(blockPlanIssue(h.state, D, { 0: [d1] }), null);
});

test('R84: the gate never refuses a block the engine would take', () => {
  const { h, D } = luredDefender(7551);
  const offers = legalActions(h.state, D)
    .filter((a): a is Extract<Action, { type: 'declareBlocks' }> => a.type === 'declareBlocks');
  assert.ok(offers.length, 'the block step is never empty');
  for (const a of offers) {
    assert.equal(blockPlanIssue(h.state, D, a.blocks), null,
      `the client refuses ${JSON.stringify(a.blocks)}, which legalActions offers — an unreachable `
      + 'legal block is the same bug wearing the other hat');
  }
});

test('R84: no lure on the board, no gate — the ordinary block step is untouched', () => {
  const h = new Harness(7552);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  const d1 = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                   // through the attack window
  assert.equal(h.state.battle!.step, 'blocks');
  assert.equal(blockPlanIssue(h.state, D, {}), null, 'declining is fine');
  assert.equal(blockPlanIssue(h.state, D, { 0: [d1] }), null, 'and so is blocking');
});

test('R84: the block bar and the Confirm button read the same plan, and both gate on it', () => {
  // one reader of ui.columns (blockPlan) feeding both, or the bar can promise
  // what the button refuses
  assert.match(MAIN, /const duty = blockPlanIssue\(s, b\.defender, blockPlan\(\)\);/,
    'the bar must ask before it draws Confirm');
  assert.match(MAIN, /data-btn="confirmblocks" \$\{duty \? 'disabled' : ''\}/,
    'and a live duty must disable the button — Enter honours `disabled`');
  assert.match(MAIN, /const duty = blockPlanIssue\(s, s\.battle!\.defender, blocks\);\s*\n\s*if \(duty\)/,
    'the click handler checks again, so no path can send a refused declaration');
  assert.match(MAIN, /const blocks = blockPlan\(\);/,
    'and both read the SAME plan');
});

/* ── round 18: the wiring for #24, #63 and the haste bar, read as text ──── */

test('the details page really renders the Transforms into row for the back face', () => {
  // Ledger #24 (ZQPC, 2026-08-20): "Scholar of the Void doesn't say what the
  // Beyond card it can transform into does". transformFaces (ui/inspect.ts) has
  // been right about the DATA and is tested for real in test/50-ui-inspect; the
  // report stays open until the inspector draws it, because the alternative way
  // to find out what you become is discarding your entire hand.
  assert.match(MAIN, /const transformRows = transformFaces\(name, u \? \{ e: q\(\), unit: u \} : undefined\)/,
    'the row must be built, and with the LIVE entity — a Scholar that already '
    + 'transformed, and a host merely wearing the mod, must show nothing');
  assert.match(MAIN, /\.map\(tokenRowHtml\)\.join\(''\);\s*\n\s*\/\/ Ledger #24/,
    'built with the same row builder the tokens use — it prints stats, type line '
    + 'and rules text off a bare name, which is what "say what it does" means');
  assert.match(MAIN, /\$\{transformRows \? `<h4>Transforms into<\/h4>\$\{transformRows\}` : ''\}/,
    'and really placed in the overlay, beside the token rows');
  assert.match(MAIN, /\btransformFaces\b[\s\S]*?\} from '\.\/inspect\.ts';/,
    'imported from ui/inspect.ts rather than re-derived here');
});

test('both resource menus default to the deck elements through the one shared helper', () => {
  // Ledger #63 (GETD, 2026-08-22). A PRESENTATION default: the engine still
  // offers all seven and both menus keep all seven reachable.
  assert.match(MAIN, /const \{ show, hidden \} = resourceMenuElements\(s, p, s\.elements, expanded\);/,
    'the recycle menu asks the helper');
  assert.doesNotMatch(MAIN, /items: s\.elements\.map\(el => \(\{/,
    'the old unfiltered recycle list must be gone');
  assert.match(MAIN, /const plan = prismiteClickPlan\(s, p, opts, expanded\);/,
    'and the prismite site goes through the plan, so both share one judgement');
  // every element stays one click away, at BOTH sites
  assert.equal((MAIN.match(/more elements…/g) ?? []).length, 2,
    'an expander at the recycle menu and an expander at the prismite menu');
  assert.match(MAIN, /go: \(\) => \{ openRecycle\(true\); render\(\); \}/,
    'the recycle expander reopens with everything');
  assert.match(MAIN, /go: \(\) => \{ openRes\(true\); render\(\); \}/,
    'and so does the prismite one');
});

test('the prismite click never counts the shortened list when it decides to auto fire', () => {
  // THE HAZARD, and it is silent: an active prismite offers seven exchanges and
  // no activate, so a mono-element deck's display list is exactly one — and
  // this handler has always acted immediately on a single option. The count
  // belongs to prismiteClickPlan, over the LEGAL actions, before any filtering
  // (test/50-ui-inspect proves it with a real mono-light constructed game).
  assert.doesNotMatch(MAIN, /if \(opts\.length === 1\) act\(opts\[0\]!\);/,
    'main.ts must not keep its own count beside a filtered list');
  assert.doesNotMatch(MAIN, /if \(show\.length === 1\)|if \(plan\.actions\.length === 1\)/,
    'and must never count the DISPLAY');
  assert.match(MAIN, /if \(plan\.kind === 'auto'\) \{ act\(plan\.action\); return; \}/,
    'the auto-fire arrives as a decision the helper made');
});

test('the haste bar no longer claims only printed haste cards may be played', () => {
  // R97 (Dispatch Courier): "Each turn, you may play a unit during the mana
  // step as if it had [Haste]" — so a card with no [Haste] symbol can be
  // playable in the haste step because something granted it, and the status
  // bar was telling the player otherwise.
  assert.match(MAIN, /Play cards with haste, printed or granted \(they resolve immediately\)\./,
    'the prompt must be true in both cases');
  assert.doesNotMatch(MAIN, /Play haste cards \(they resolve immediately\)\./,
    'the old incomplete copy must be gone');
});
