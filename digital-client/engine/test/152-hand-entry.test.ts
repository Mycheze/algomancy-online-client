/* R179 — ONE HAND-ENTRY POINT, AND ONE EVENT PER MOVE.
 *
 * Three cards print "whenever (one or more other) cards enter a player's hand
 * during battle" — Rider of the Tides, Xenopod Progenitor, Galerider Eel.
 * Before this round there was no `E.toHand` and no 'handEntered' event, so all
 * three listened on 'despawned' (a RECALL) and 'draw' (a DRAW), the only two
 * channels that announced anything at all. Every OTHER route into a hand was a
 * bare `player(seat).hand.push(name)` — 18 sites across 11 card files — and
 * announced nothing, so the three cards were blind to most of what their
 * sentence covers: a bin recursion, a pull off the stack, an uncache, and a
 * card taken out of an opponent's hand.
 *
 * ⚠ The three sections below are the three ways this can go wrong, and they
 * are all failures a green suite has hidden before:
 *
 *  §1  THE GAP: each card must fire for a card entering a hand BY A ROUTE THAT
 *      IS NOT A DRAW AND NOT A RECALL. That is the whole defect.
 *  §2  ONE EVENT PER MOVE, and NO DOUBLE-FIRE. A recall and a draw now BOTH go
 *      through `toHand`, so a card still listening on 'despawned' or 'draw'
 *      beside 'handEntered' would fire TWICE for one card entering one hand —
 *      a worse bug than the one being fixed. And a fourteen-card bin recall is
 *      ONE entry, not fourteen, because the text says "one or more".
 *  §3  THE CLASS GUARD: a whole-pool sweep asserting no bare `hand.push`
 *      survives outside the primitive, so a new card cannot reintroduce one
 *      silently. It carries its own positive control — a sweep that cannot
 *      fail is worth nothing (the `stripCode` lesson).
 *  §4  ROT/DEBT REMOVAL: Burn the Blight announces what it removes, and the
 *      removal is NOT scaled by R104's amount layer (owner ruling).
 *
 * Seeds: 15200-15299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import type { EngineEvent, EntityId, Seat } from '../src/types.ts';
import {
  effStats, finishBattle, give, giveResources, ownAttrs, pass, pick, spawn,
  toDeployment, toNextBattle,
} from './util.ts';

/** Run raw engine calls against the harness state, absorbing a suspension
 * (a decision produced mid-settle) and keeping the harness log honest. */
function whiteBox(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  try {
    fn(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
  // keep the harness's event stream honest, exactly as h.do() does — several
  // assertions below count events across a white-box call.
  h.events.push(...e.events);
  for (const ev of e.events) if (ev.msg) { h.log.push(ev.msg); h.logTypes.push(ev.type); }
}

const handEntries = (h: Harness, from?: number): EngineEvent[] =>
  h.events.slice(from ?? 0).filter(ev => ev.type === 'handEntered');

/** the trigger items this card has sitting on the stack right now */
const queuedFor = (h: Harness, card: string): number =>
  h.state.stack.filter(it => it.label.includes(card)).length;

// ══ §1 · THE GAP: a route that is neither a draw nor a recall ═══════════

/* Collect Remains ("Put target card in a bin into your hand. Erase me.") is a
 * {Battle} spell whose whole job is to move a card out of a bin and into a
 * hand. It was one of the 18 silent sites. */

test('Rider of the Tides: a BIN recursion (Collect Remains) is a card entering a hand — not a draw, not a recall', () => {
  const h = new Harness(15200);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const rider = spawn(h, A, 'Rider of the Tides');
  h.state.players[A]!.bin.push('Good Whale');
  giveResources(h, A, 'dark', 2);                        // dd/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rider]] });
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Collect Remains') });
  pick(h, { bin: { seat: A, card: 'Good Whale' } });
  pass(h); pass(h);                                      // the spell resolves
  assert.ok(h.state.players[A]!.hand.includes('Good Whale'), 'the bin card reached the hand');
  const entries = handEntries(h, mark);
  assert.equal(entries.length, 1, 'exactly one hand entry was announced');
  assert.equal(entries[0]!.data?.['from'], 'bin', 'and it says WHERE the card came from');
  assert.equal(entries[0]!.data?.['seat'], A, 'seat is the hand that was ENTERED');
  assert.equal(queuedFor(h, 'Rider of the Tides'), 1, 'the Rider heard it, exactly once');
  pass(h); pass(h);                                      // resolve the trigger
  assert.deepEqual(effStats(h, rider), [4, 4], '2/2 + 2/2 = 4/4');
  finishBattle(h);
  assert.deepEqual(effStats(h, rider), [2, 2], 'until regroup');
});

test("Xenopod Progenitor: a card taken out of an OPPONENT's hand (Bioremediation) fires it — not a draw, not a recall", () => {
  const h = new Harness(15201);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const xeno = spawn(h, A, 'Xenopod Progenitor');
  giveResources(h, A, 'wood', 8);                        // ggg + the Xenopod's [1] on top
  toNextBattle(h, A);
  h.state.players[D]!.hand = ['Good Whale'];             // AFTER the turn-start draw: the take is auto
  h.do({ type: 'declareAttack', seat: A, columns: [[xeno]] });
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Bioremediation') });
  pick(h, { player: D });
  pass(h); pass(h);                                      // the spell resolves
  assert.ok(h.state.players[A]!.hand.includes('Good Whale'), "the opponent's card reached my hand");
  const entries = handEntries(h, mark);
  assert.equal(entries.length, 1, 'one hand entry');
  assert.equal(entries[0]!.data?.['from'], 'hand', "out of one hand and into another — from: 'hand'");
  assert.equal(entries[0]!.data?.['seat'], A, 'the hand that was entered, not the one that was emptied');
  assert.equal(queuedFor(h, 'Xenopod Progenitor'), 1, 'the Xenopod heard it, exactly once');
  pass(h); pass(h);                                      // resolve the trigger → the pay-or-decline
  assert.equal(h.state.decision!.kind, 'payOrDecline', 'the [one] is offered (R6)');
  assert.ok(String(h.state.decision!.prompt).includes('Xenopod Progenitor'));
  pick(h, true);
  assert.equal(
    Object.values(h.state.entities).filter(e => e.card === 'Unit Token' && e.controller === A).length,
    1, 'the 2/2 was created');
  finishBattle(h);
});

test('Galerider Eel: a BIN recursion into MY hand fires it — not a draw, not a recall', () => {
  const h = new Harness(15202);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const eel = spawn(h, A, 'Galerider Eel');
  h.state.players[A]!.bin.push('Good Whale');
  giveResources(h, A, 'dark', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[eel]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Collect Remains') });
  pick(h, { bin: { seat: A, card: 'Good Whale' } });
  pass(h); pass(h);
  assert.equal(queuedFor(h, 'Galerider Eel'), 1, 'the Eel heard it, exactly once');
  pass(h); pass(h);                                      // resolve the trigger
  assert.deepEqual(effStats(h, eel), [4, 8], '0/4 + 4/4');
  assert.ok(ownAttrs(h, eel).has('Flying'), 'and flying until regroup');
  finishBattle(h);
});

// The mirror. The Eel prints "enter YOUR hand", and 'handEntered' stamps the
// DESTINATION as `seat` — the field that was got wrong in both directions on
// the old 'despawned' path, where `seat` was the recalled unit's CONTROLLER.
test("Galerider Eel: a card entering the OPPONENT's hand does not fire it (\"your hand\")", () => {
  const h = new Harness(15203);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const eel = spawn(h, A, 'Galerider Eel');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[eel]] });
  const mark = h.events.length;
  whiteBox(h, e => e.toHand(D, 'Good Whale', 'bin'));
  assert.equal(handEntries(h, mark).length, 1, 'the entry was announced');
  assert.equal(queuedFor(h, 'Galerider Eel'), 0, "but it is not MY hand");
  assert.deepEqual(effStats(h, eel), [0, 4], 'no pump');
  finishBattle(h);
});

// ══ §2 · ONE EVENT PER MOVE, AND NO DOUBLE-FIRE ════════════════════════

/* "one or more cards", so a multi-card move is ONE firing — which is the shape
 * 'draw' has always had (`{ seat, n }` for an n-card draw) and the shape a
 * per-card announce would have broken. Tilling the Graves recalls TWO units. */
test('a multi-card move fires exactly ONE handEntered, like a multi-card draw', () => {
  const h = new Harness(15204);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const rider = spawn(h, A, 'Rider of the Tides');
  h.state.players[A]!.bin.push('Curio Drifter', 'Bumblecrab');
  giveResources(h, A, 'dark', 4);                        // dd/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rider]] });

  // (a) two cards out of a bin in one move
  let mark = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Tilling the Graves') });
  pick(h, { bin: { seat: A, card: 'Curio Drifter' } });
  pick(h, { bin: { seat: A, card: 'Bumblecrab' } });
  pass(h); pass(h);                                      // resolve → "then discard a card"
  pick(h, 0);
  let entries = handEntries(h, mark);
  assert.equal(entries.length, 1, 'TWO cards moved, ONE event');
  assert.equal(entries[0]!.data?.['n'], 2, 'and it carries the count');
  assert.deepEqual(entries[0]!.data?.['cards'], ['Curio Drifter', 'Bumblecrab'], 'and every card');
  assert.equal(queuedFor(h, 'Rider of the Tides'), 1, 'so the Rider queues ONE pump, not two');
  pass(h); pass(h);
  assert.deepEqual(effStats(h, rider), [4, 4], '+2/+2 once — not +4/+4');

  // (b) the same rule on the draw side, which is where the shape came from
  mark = h.events.length;
  whiteBox(h, e => e.draw(A, 3));
  entries = handEntries(h, mark);
  assert.equal(entries.length, 1, 'a three-card draw is ONE hand entry');
  assert.equal(entries[0]!.data?.['n'], 3);
  assert.equal(entries[0]!.data?.['from'], 'deck');
  assert.equal(h.events.slice(mark).filter(ev => ev.type === 'draw').length, 1,
    "and still exactly one 'draw' — the narrow event is not replaced");
  finishBattle(h);
});

/* The double-fire trap, measured on both routes that now pass through
 * `toHand`. Before the rewire each card listened on 'despawned' AND 'draw';
 * leaving either in place alongside 'handEntered' fires the card TWICE for one
 * card entering one hand — a worse bug than the one being fixed.
 *
 * Each listener is measured ALONE in its own game on purpose: two queued
 * triggers under one controller raise an ordering question (R2), and a test
 * that has to answer one cannot count what was queued. */
const LISTENERS = ['Rider of the Tides', 'Galerider Eel', 'Xenopod Progenitor'] as const;

/** stand `card` up alone, attacking, then move ONE card into A's hand by
 * `route`; hand back the harness with the trigger(s) sitting on the stack. */
function oneEntry(seed: number, card: string,
                  route: (e: E, A: Seat, whale: EntityId) => void): Harness {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const self = spawn(h, A, card);
  const whale = spawn(h, A, 'Good Whale');          // the thing that gets recalled
  giveResources(h, A, 'water', 4);                  // the Xenopod's [1], with room to spare
  toNextBattle(h, A);
  // ⚠ THE WHALE MUST ATTACK TOO. `declareAttack` moves attackers into the
  // BATTLE region, and 'despawned' carries the recalled unit's region
  // (leftPlayFacts), so `fireEvent` scopes it. Leaving the whale at home put
  // it in a different region from the listener and the despawn never reached
  // it — which made this test pass with 'despawned' still in the events list,
  // i.e. blind to the exact double-fire it exists to catch. Measured.
  h.do({ type: 'declareAttack', seat: A, columns: [[self], [whale]] });
  h.events.length = 0;                              // measure only what the move does
  whiteBox(h, e => route(e, A, whale));
  return h;
}

test('none of the three double-fires for ONE card entering a hand by RECALL', () => {
  LISTENERS.forEach((card, i) => {
    const h = oneEntry(15205 + i, card, (e, _A, whale) => e.recall(e.entity(whale)!));
    // a recall is BOTH a despawn and a hand entry — two different facts, two
    // events — and the three cards read only the second one.
    assert.equal(h.events.filter(ev => ev.type === 'despawned').length, 1, `${card}: one despawn`);
    assert.equal(handEntries(h).length, 1, `${card}: one hand entry`);
    assert.equal(queuedFor(h, card), 1, `${card} fires ONCE for one recall`);
  });
});

test('none of the three double-fires for ONE card entering a hand by DRAW', () => {
  LISTENERS.forEach((card, i) => {
    const h = oneEntry(15215 + i, card, (e, A) => e.draw(A, 1));
    assert.equal(h.events.filter(ev => ev.type === 'draw').length, 1, `${card}: one draw`);
    assert.equal(handEntries(h).length, 1, `${card}: one hand entry`);
    assert.equal(queuedFor(h, card), 1, `${card} fires ONCE for one draw`);
  });
});

// ══ §3 · THE CLASS GUARD ═══════════════════════════════════════════════

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'src');

/** `.hand.push(` in any spacing */
const PUSH = /\.\s*hand\s*\.\s*push\s*\(/;
/** a line that is entirely (or begins as) a comment */
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsFiles(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** every `X.hand.push(` in `src` that is not inside a comment, as file:line */
function rawPushes(): string[] {
  const hits: string[] = [];
  for (const f of tsFiles(SRC)) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (COMMENT.test(line) || !PUSH.test(line)) return;
      hits.push(`${path.relative(SRC, f)}:${i + 1}`);
    });
  }
  return hits.sort();
}

/* ⚠ A SWEEP THAT CANNOT FAIL IS WORSE THAN NO SWEEP — `stripCode` was blind
 * for weeks and everything resting on it was silently green. So the matcher is
 * asked the question directly before it is trusted. */
test('the hand.push sweep is not blind: it flags a planted push and ignores a commented one', () => {
  assert.ok(PUSH.test("        g.player(ctx.controller).hand.push(name);"), 'the ordinary shape');
  assert.ok(PUSH.test("this.player(seat) . hand . push ( c )"), 'and odd spacing');
  assert.ok(!PUSH.test("  g.player(seat).bin.push(name);"), 'a bin push is not a hand push');
  assert.ok(COMMENT.test(" *   `player(seat).hand.push(name)` is a bare array write."), 'a doc line');
  assert.ok(COMMENT.test("  // g.player(seat).hand.push(name);"), 'a commented-out line');
  assert.ok(!COMMENT.test("        g.player(ctx.controller).hand.push(name);"), 'but not real code');
});

/* THE GUARD ITSELF. `E.toHand` is the one hand-entry point; every other push
 * is a card that will be invisible to the three "a card enters a hand" cards,
 * which is exactly the state this ruling found the pool in (18 of them). */
test('R179 class guard: no bare hand.push survives outside E.toHand', () => {
  const hits = rawPushes();
  assert.equal(hits.length, 1,
    `exactly one hand push may exist — the primitive's own. Found: [${hits.join(', ')}]`);
  assert.equal(hits[0]!.split(':')[0], 'engine.ts', 'and it lives in the engine, not a card file');
  // …and it is really inside `toHand`, not some new site in the same file
  const engine = fs.readFileSync(path.join(SRC, 'engine.ts'), 'utf8').split('\n');
  const line = Number(hits[0]!.split(':')[1]) - 1;
  const above = engine.slice(Math.max(0, line - 8), line).join('\n');
  assert.ok(/toHand\(seat: Seat/.test(above),
    `the surviving push must be inside toHand; context was:\n${above}`);
});

/* The same class one field over: Burn the Blight used to write `p.rot = 0` /
 * `p.debt = 0` raw, and those were the only writes to either field outside the
 * gain/lose primitives. R179 gave them a primitive, so nothing needs to. */
test('R179 class guard: no card writes a player\'s rot or debt directly', () => {
  const hits: string[] = [];
  for (const f of tsFiles(path.join(SRC, 'cards'))) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (COMMENT.test(line)) return;
      if (/\.\s*(rot|debt)\s*(\+|-)?=[^=]/.test(line)) hits.push(`${path.relative(SRC, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [],
    `rot/debt move through gainRot/gainDebt/loseRot/loseDebt. Found: [${hits.join(', ')}]`);
});

/* A REWIRE CAN TAKE SOMETHING AWAY. Ancient One mimics an adjacent ally's
 * triggered abilities, and it only scans on the events in its own `AO_EVENTS`
 * list. All three cards listened on 'despawned'+'draw', both of which are in
 * that list; moving them to 'handEntered' would have silently taken them away
 * from the Ancient One unless the list moved too. This asserts the invariant
 * rather than the one edit, so the next card to move events cannot lose it. */
test('Ancient One can still mimic the three hand-entry cards (AO_EVENTS covers their events)', () => {
  const src = fs.readFileSync(path.join(SRC, 'cards', 'sets', 'batch-metal-a.ts'), 'utf8');
  const block = /const AO_EVENTS: EventType\[\] = \[([\s\S]*?)\n\];/.exec(src);
  assert.ok(block, "AO_EVENTS is still a literal array — if it moved, this guard needs rewriting");
  // ⚠ COMMENT LINES FIRST. The array carries a prose comment that NAMES the
  // very events being checked, so matching over the raw block made this guard
  // pass with the entry deleted. Measured: it stayed green under mutation.
  const code = block![1]!.split('\n').filter(L => !COMMENT.test(L)).join('\n');
  const listed = new Set([...code.matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1]!));
  assert.ok(listed.has('despawned') && listed.has('draw'),
    'the guard reads the right array (both pre-existing entries are there)');
  for (const card of LISTENERS) {
    const def = getCard(card);
    const abilities = [...(def.abilities ?? []), ...(def.augmentText ?? [])];
    const events = abilities.flatMap(a => ('events' in a ? a.events : []));
    assert.ok(events.length, `${card} still declares triggered events`);
    for (const ev of events) {
      assert.ok(listed.has(ev), `${card} listens on '${ev}', which AO_EVENTS must scan`);
    }
  }
});

// ══ §4 · ROT / DEBT REMOVAL ════════════════════════════════════════════

test('Burn the Blight ANNOUNCES the rot and debt it removes (rotLost / debtLost)', () => {
  const h = new Harness(15207);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  whiteBox(h, e => { e.gainRot(A, 2); e.gainRot(D, 1); e.gainDebt(D, 2); });
  giveResources(h, A, 'dark', 3);                        // dd/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Burn the Blight') });
  pass(h); pass(h);                                      // resolve
  assert.equal(h.q.rot(A), 0);
  assert.equal(h.q.rot(D), 0);
  assert.equal(h.q.debt(D), 0);
  const rotLost = h.events.slice(mark).filter(ev => ev.type === 'rotLost');
  const debtLost = h.events.slice(mark).filter(ev => ev.type === 'debtLost');
  assert.equal(rotLost.length, 2, 'both players lost rot, and both were announced');
  assert.deepEqual(rotLost.map(ev => [ev.data?.['seat'], ev.data?.['n'], ev.data?.['total']]).sort(),
    [[A, 2, 0], [D, 1, 0]].sort(), 'each says who, how much, and what is left');
  assert.equal(debtLost.length, 1, 'only D had debt');
  assert.deepEqual([debtLost[0]!.data?.['seat'], debtLost[0]!.data?.['n']], [D, 2]);
  finishBattle(h);
});

/* OWNER RULING, 2026-08-25, asked whether an AmountMod should scale a removal:
 *   "Resonater says 'put on' so this question is irrelevant. Removing counters
 *    isn't 'putting on'."
 * The generalisable half: THE SCOPE OF A LAYER IS READ OFF THE PRINTED TEXT OF
 * THE CARD THAT DEFINES IT. Flux Resonator and Proliferating Slime both print
 * "put on", so a removal is not a quantity they have an opinion about. This
 * was not a policy call about removals in general. */
test('a counter-amount replacement does NOT scale a REMOVAL (Proliferating Slime says "put on")', () => {
  const h = new Harness(15208);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, A, 'Proliferating Slime');                    // D is its enemy
  whiteBox(h, e => e.gainRot(D, 2));
  assert.equal(h.q.rot(D), 3, 'putting rot ON an enemy IS scaled — 2 arrives as 3');
  whiteBox(h, e => e.gainDebt(D, 2));
  assert.equal(h.q.debt(D), 3, 'and debt the same');
  // the removal side of the same board
  whiteBox(h, e => e.loseRot(D, 2));
  assert.equal(h.q.rot(D), 1, 'removing 2 removes exactly 2 — a scaled removal would leave 0');
  whiteBox(h, e => e.loseDebt(D, 2));
  assert.equal(h.q.debt(D), 1, 'and debt the same');
  // and the clamp: you cannot remove counters that are not there
  whiteBox(h, e => assert.equal(e.loseRot(D, 99), 1, 'only what was there actually goes'));
  assert.equal(h.q.rot(D), 0);
  whiteBox(h, e => assert.equal(e.loseRot(D, 5), 0, 'and nothing at all from zero'));
  assert.equal(h.events.filter(ev => ev.type === 'rotLost').length, 2,
    'no event for a removal that removed nothing');
});

