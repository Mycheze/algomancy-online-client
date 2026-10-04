/* R311 — THE CACHE PLAYS LIKE THE HAND, FOR EVERY MODE. The whole-pool sweep.
 *
 * Owner, report #195 (game KEMX, 2026-10-04, marked gamebreaking): *"I'm not
 * able to virus a card from my cached cards. The cache functions 100% like the
 * hand except for the fact that it's not considered your 'hand'. This issue
 * has come up a bunch and I need it to stop being an issue."*
 *
 * It kept coming up because every play MODE had its own hand-only offer loop,
 * and each time a cache route was added it was added for one mode. In KEMX the
 * cache held a glimpsed Möbius's Corruption at a battle priority window and
 * `legalActions` offered nothing for it; the battle Virus window was
 * `from === 'hand'`. Ambush, the R97 haste grant (Dispatch Courier) and the
 * R123 erase-funded play (Writhing Host) were hand-only the same way.
 *
 * This test does not list modes. For EVERY card in the pool, in four windows
 * (deployment; a battle priority window with an enemy unit in the battle and
 * a spell on the stack; the haste step under a Dispatch Courier; the haste
 * step with a Writhing Host in the bin), it asks `legalActions` what the card
 * offers out of the hand, then puts the same card in the cache under a live
 * glimpse stamp and asks again. The two mode sets must be equal, modulo the
 * source. A mode added for the hand and forgotten for the cache goes red here,
 * naming the card, without anyone having to remember this file exists.
 *
 * The exemptions are DERIVED FROM CARD DATA, never a name list:
 *  - "Discard me" (`c.discardMe`) is hand-only: discarding is a hand action.
 *  - R100's "I can't be played from your hand" (`c.noPlayFromHand`) refuses
 *    the hand, exactly as printed — so the cache may play it and the hand not.
 * Grants that print their own zones (Rook's "from hand and bin") are not on
 * the board here, so they do not enter the comparison; 29-hybrids-wm-a pins
 * that Rook still refuses the cache.
 *
 * Every cache offer the sweep sees is also APPLIED, so an offer the reducer
 * refuses (the "legalActions lied" split R97's cache leg had in reverse) is a
 * failure too.
 *
 * Seeds: 3690-3699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import { apply, legalActions } from '../src/apply.ts';
import { IllegalAction } from '../src/engine.ts';
import type { Action, Element, GameState, Seat } from '../src/types.ts';
import { give, giveResources, pick, spawn, toDeployment, toNextBattle } from './util.ts';

const ELEMENTS: Element[] = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];
/** two inert hand cards, so a [Discard a card] cost is payable from both
 * zones alike (a hand card reserves itself; a cached one has nothing to reserve) */
const FILLER = 'The Foretold';

interface Window { name: string; state: GameState; seat: Seat }

/** plenty of every element — enough affinity that the hand's full price and
 * the glimpse's mana-only price are both affordable, so a difference between
 * the two zones can only be a missing MODE, never a price */
function stock(h: Harness, seat: Seat): void {
  for (const el of ELEMENTS) giveResources(h, seat, el, 6);
  h.state.players[seat]!.hand.length = 0;
  give(h, seat, FILLER);
  give(h, seat, FILLER);
}

function sterile(seed: number): Harness {
  const h = new Harness(seed);
  for (const p of h.state.players) p.hand.length = 0;
  h.state.sharedDeck = Array.from({ length: 400 }, () => FILLER);
  return h;
}

function deployWindow(): Window {
  const h = sterile(3690);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, FILLER);   // a host for an augment
  stock(h, P);
  assert.equal(h.state.phase, 'deploy');
  return { name: 'deployment', state: h.state, seat: P };
}

function battleWindow(): Window {
  const h = sterile(3691);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  spawn(h, D, 'The Foretold');                       // an ally to ambush in for
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  giveResources(h, A, 'fire', 4);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Arc Lightning') });
  pick(h, { player: D });
  stock(h, D);
  assert.equal(h.state.priority, D, 'the defender holds priority');
  assert.equal(h.state.stack.length, 1, 'with a spell on the stack');
  const units = h.q.unitsIn(h.state.battle!.region);
  assert.ok(units.some(u => u.controller === A), 'an enemy unit in the battle');
  assert.ok(units.some(u => u.controller === D), 'and an ally of the seat being swept');
  return { name: 'battle priority', state: h.state, seat: D };
}

/** the R18 haste step, with `setup` run on the seat in the deployment before */
function hasteWindow(seed: number, name: string, setup: (h: Harness, P: Seat) => void): Window {
  const h = sterile(seed);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  setup(h, P);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.phase === 'planning' && h.state.hasteDone && !h.state.hasteDone[P], 'in the haste step');
  stock(h, P);
  return { name, state: h.state, seat: P };
}

/** one offer, reduced to its MODE: the source is what the comparison ignores */
function modeOf(a: Action): string | null {
  switch (a.type) {
    case 'playCard': case 'playCached':
      return ['play', a.mode, a.eraseGrant ? 'erase' : undefined].filter(Boolean).join(':');
    case 'augment': return a.hostStack !== undefined ? `augment:stack#${a.hostStack}` : `augment:unit#${a.hostId}`;
    case 'graft': return `graft:#${a.hostId}@${a.position}`;
    case 'prophesy': return 'prophesy';
    default: return null;
  }
}

function fromHand(a: Action, i: number): boolean {
  if (a.type === 'playCard') return a.handIndex === i;
  if (a.type === 'augment' || a.type === 'graft' || a.type === 'prophesy') return a.from === 'hand' && a.index === i;
  return false;
}

function fromCache(a: Action, i: number): boolean {
  if (a.type === 'playCached') return a.index === i;
  if (a.type === 'augment' || a.type === 'graft' || a.type === 'prophesy') return a.from === 'cache' && a.index === i;
  return false;
}

interface Seen { hand: Set<string>; cache: Set<string>; cacheActions: Map<string, Action> }

function offersFor(w: Window, card: string): Seen {
  const inHand = structuredClone(w.state);
  const hand = inHand.players[w.seat]!.hand;
  hand.push(card);
  const hi = hand.length - 1;
  const handModes = new Set(legalActions(inHand, w.seat).filter(a => fromHand(a, hi)).map(modeOf)
    .filter((m): m is string => m !== null));

  const inCache = structuredClone(w.state);
  const cache = (inCache.players[w.seat]!.cache ??= []);
  cache.push({ card, uid: 999_000, playableUntilTurn: inCache.turn });   // a LIVE glimpse stamp
  const ci = cache.length - 1;
  const cacheActions = new Map<string, Action>();
  for (const a of legalActions(inCache, w.seat)) {
    if (!fromCache(a, ci)) continue;
    const m = modeOf(a);
    if (m !== null && !cacheActions.has(m)) cacheActions.set(m, a);
  }
  return { hand: handModes, cache: new Set(cacheActions.keys()), cacheActions };
}

/** the data-derived exemptions, applied to each side before comparing */
function exempt(card: string, seen: Seen): { hand: string[]; cache: string[] } {
  const c = getCard(card);
  const hand = [...seen.hand].filter(m => !(c.discardMe && m === 'play:discardMe'));   // discarding is a hand action
  const cache = [...seen.cache].filter(m => !(c.noPlayFromHand && (m === 'play' || m === 'play:erase')));   // R100 names the hand
  return { hand: hand.sort(), cache: cache.sort() };
}

// ── build the windows once ────────────────────────────────────────────

const WINDOWS: Window[] = [
  deployWindow(),
  battleWindow(),
  hasteWindow(3692, 'haste step under Dispatch Courier', (h, P) => { spawn(h, P, 'Dispatch Courier'); }),
  hasteWindow(3693, 'haste step with Writhing Host in the bin', (h, P) => { h.state.players[P]!.bin.push('Writhing Host'); }),
];

const POOL = allCardNames();

/** what the sweep saw, for the non-vacuity test */
const census = { virusInBattle: new Set<string>(), ambush: new Set<string>(), hasteGrant: new Set<string>(),
  erase: new Set<string>(), compared: 0 };

test('R311: every card in the pool offers the same modes from the cache as from the hand, in every window', () => {
  const mismatches: string[] = [];
  const refusals: string[] = [];
  for (const w of WINDOWS) {
    for (const card of POOL) {
      const seen = offersFor(w, card);
      const { hand, cache } = exempt(card, seen);
      census.compared++;
      if (JSON.stringify(hand) !== JSON.stringify(cache)) {
        mismatches.push(`${card} [${w.name}]: hand offers {${hand.join(', ')}} but the cache offers {${cache.join(', ')}}`);
      }
      for (const [m, a] of seen.cacheActions) {
        if (w.name === 'battle priority' && m.startsWith('augment:stack')) census.virusInBattle.add(card);
        if (m === 'play:ambush') census.ambush.add(card);
        if (w.name.includes('Courier') && m === 'play' && getCard(card).timing !== 'haste') census.hasteGrant.add(card);
        if (m === 'play:erase') census.erase.add(card);
        // and the reducer must accept every cache offer it was shown
        const st = structuredClone(w.state);
        st.players[w.seat]!.cache = [...(st.players[w.seat]!.cache ?? []), { card, uid: 999_000, playableUntilTurn: st.turn }];
        try {
          apply(st, a);
        } catch (err) {
          if (err instanceof IllegalAction) {
            refusals.push(`${card} [${w.name}] ${JSON.stringify(a)}: offered, then refused — ${err.message}`);
          } else throw err;
        }
      }
    }
  }
  assert.deepEqual(mismatches, [], `the cache is not the hand for ${mismatches.length} card/window pair(s):\n  ${mismatches.join('\n  ')}`);
  assert.deepEqual(refusals, [], `legalActions offered cache plays the reducer refused:\n  ${refusals.join('\n  ')}`);
});

test('R311: the sweep is not vacuous: it saw cached Virus, Ambush, haste-grant and erase-grant plays', () => {
  assert.ok(census.compared >= POOL.length * WINDOWS.length, 'the sweep ran first and compared every card in every window');
  assert.ok(census.virusInBattle.has("Möbius's Corruption"),
    `the KEMX card: a cached Möbius's Corruption is offered onto the spell on the stack (saw ${[...census.virusInBattle].slice(0, 5).join(', ')})`);
  assert.ok(census.virusInBattle.size >= 5, `several Virus cards reached the battle window from the cache (${census.virusInBattle.size})`);
  assert.ok(census.ambush.size >= 1, 'at least one Ambush card ambushed out of the cache');
  assert.ok(census.hasteGrant.size >= 5, `the R97 grant reached cached units (${census.hasteGrant.size})`);
  assert.ok(census.erase.size >= 5, `the R123 erase reached cached units (${census.erase.size})`);
});
