/* CT-71 / report #104 (GYSR): "Glimpse is supposed to REVEAL the cards, but
 * opponents cannot see them right now."
 *
 * R45 says Glimpse N REVEALS N; R41 says the cache is public. Both of those
 * are claims about what the SEAT THAT IS NOT GLIMPSING is shown, and until
 * this file nothing tested them past the engine's own event list — the
 * existing guards (14-water-a, 36-cache-prophecy, 38-light-a, 41-dark-a,
 * 46-hybrids-ld-c) all stop at `h.events.some(e => e.type === 'glimpsed')`,
 * which proves the event EXISTS and says nothing about who receives it.
 *
 * So every case below reads the reveal the way the wire does, through the
 * three functions `server/main.ts` actually composes for a seat:
 *
 *     sendUpdate  → viewFor(state, seat, …)
 *                 + events.filter(visibleToSeat) .map(redactEvent)
 *     visibleLog  → redactLog(events, seat, names)
 *
 * The events fed to them are the ones the REAL card produced through the real
 * `apply`/Harness — never a hand-rolled `{type:'glimpsed'}` literal. A guard
 * that builds its own input proves only that view.ts copies objects.
 *
 * ── R188 → R235: THE ONE PLACE IT WAS INVISIBLE, AND THE RULING ───────
 *
 * Report #104's moment (GYSR action ~110, Grox's [Battle] glimpse) is NOT
 * broken: the reveal reaches the other seat on the wire and on screen. The
 * one Glimpse card whose reveal really was invisible when it happened is
 * `Oracle of Foretelling`, and only because its printed timing is `deploy`:
 * deployment is a HIDDEN SIMULTANEOUS SEGMENT, so `server/rooms.ts` parked the
 * event in `heldEvents[opponent]` and it surfaced at the barrier instead.
 * R188 left that as a rules question for the owner and this file pinned the
 * behaviour either answer shared, so that the fix would be one test to change.
 *
 * ⚠ THIS IS THAT CHANGE. **R235 (owner, 2026-08-28): immediately — "the card
 * says REVEAL."** The hold is per-event now (`rooms.ts::escapesHold`), so a
 * `glimpsed` event is never parked and the opponent is sent it on the tick it
 * happens. The Oracle case below asserts the ruling; the whole machinery
 * around it — that the rest of the hidden step is still held, that the barrier
 * does not repeat the reveal — is driven end to end through a real `Room` in
 * `203-reveal-escapes-the-hidden-hold.test.ts`, which is where a change to
 * this rule should redden first.
 *
 * Seeds: 15900-15999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { hiddenSegment } from '../../engine/src/apply.ts';
import {
  finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle,
} from '../../engine/test/util.ts';
import { redactEvent, redactLog, viewFor, visibleToSeat } from '../view.ts';
// R235: the per-event exemption from a hidden segment's hold. Importing
// rooms.ts is inert (no room is created here, so nothing is persisted).
import { escapesHold } from '../rooms.ts';
import type { CardName, EngineEvent, Seat } from '../../engine/src/types.ts';

const NAMES: string[] = ['Player 1', 'Player 2'];

/** The batch of events one action produced — `h.events` is cumulative. */
function since(h: Harness, mark: number): EngineEvent[] {
  return h.events.slice(mark);
}

/**
 * Exactly what `server/main.ts::sendUpdate` puts on the wire for `seat`: the
 * redacted view, plus the batch's events after the same two filters. Nothing
 * here is invented — the three callees are view.ts's own exports.
 */
function wireTo(h: Harness, seat: Seat, batch: EngineEvent[]): {
  view: ReturnType<typeof viewFor>; events: EngineEvent[]; lines: string[];
} {
  const events = batch.filter(e => visibleToSeat(e, seat)).map(e => redactEvent(e, seat, NAMES));
  return {
    view: viewFor(h.state, seat, null),
    events,
    lines: events.filter(e => e.msg).map(e => e.msg),
  };
}

/**
 * The whole assertion, once, for a card that has just glimpsed: the seat that
 * did NOT glimpse is shown the reveal, and is shown every card in it.
 *
 * `revealed` is read off the deck BEFORE the card resolves, so the expectation
 * is the real top-N and not a restatement of what the event happened to say.
 */
function assertOpponentSeesReveal(
  h: Harness, watcher: Seat, batch: EngineEvent[], revealed: CardName[], label: string,
): void {
  const wire = wireTo(h, watcher, batch);
  const glimpsed = wire.events.filter(e => e.type === 'glimpsed');
  assert.equal(glimpsed.length, 1, `${label}: the non-glimpsing seat receives the 'glimpsed' event`);
  const msg = glimpsed[0]!.msg;
  for (const name of revealed) {
    assert.ok(msg.includes(name), `${label}: the reveal the opponent receives names ${name}`);
  }
  assert.deepEqual(glimpsed[0]!.data?.['cards'], revealed,
    `${label}: …and carries the revealed cards as data, in revealed order`);
  // the resync path (a reconnect, an undo) must say the same thing: redactLog
  // is what `visibleLog` maps the whole history through.
  const full = redactLog(h.events, watcher, NAMES);
  assert.ok(full.some(l => revealed.every(n => l.includes(n))),
    `${label}: and a full log resync still carries the reveal to that seat`);
}

// ── Oracle of Foretelling — Glimpse 5, and the R188 question ─────────────

test('Oracle of Foretelling: the Glimpse 5 reveal is public to the opponent (R41/R45)', () => {
  const h = new Harness(15901);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
  giveResources(h, A, 'water', 3);                    // b/3
  const revealed = h.q.deckOf(A).slice(0, 5);
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Oracle of Foretelling') });
  assertOpponentSeesReveal(h, D, since(h, mark), revealed, 'Oracle of Foretelling');
});

test('Oracle of Foretelling: its reveal is inside the hidden deployment segment, and escapes it (R235)', () => {
  // Its printed timing is `deploy`, so EVERY Oracle reveal is inside a hidden
  // simultaneous segment — this card is never in the easy case. Under R188
  // that meant the opponent's copy was held (rooms.ts heldEvents) until the
  // barrier; under R235 the reveal is public the moment it happens, so the
  // hold lets this one event past. Both halves are asserted here: the segment
  // really is hidden, and the event really does escape it.
  const h = new Harness(15902);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
  giveResources(h, A, 'water', 3);
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Oracle of Foretelling') });
  assert.equal(hiddenSegment(h.state), 'deploy',
    'the Glimpse 5 resolves inside a hidden simultaneous segment');
  const ev = since(h, mark).find(e => e.type === 'glimpsed')!;
  assert.ok(ev, 'the reveal is still produced');
  assert.equal(ev.data?.['privateTo'], undefined,
    'and it is NOT private to the glimpser — redaction never hid it, only the hold did');
  assert.ok(visibleToSeat(ev, D), 'view.ts delivers it to the opponent unchanged');
  // R235: …and the hold no longer keeps it either.
  assert.ok(escapesHold(ev), 'the hidden segment does not park a reveal (R235)');
  for (const sibling of since(h, mark).filter(e => e.type !== 'glimpsed')) {
    assert.ok(!escapesHold(sibling),
      `…and nothing else in the same action escapes with it (${sibling.type})`);
  }
});

// ── Premonition — Glimpse X ({Battle}) ──────────────────────────────────

test('Premonition: the Glimpse X reveal is public to the opponent (R41/R45)', () => {
  const h = new Harness(15903);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 3);                    // b/1, and X = water affinity = 3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Premonition') });
  const revealed = h.q.deckOf(A).slice(0, 3);
  const mark = h.events.length;
  pass(h); pass(h);                                   // resolve
  assertOpponentSeesReveal(h, D, since(h, mark), revealed, 'Premonition');
  assert.equal(h.state.decision!.seat, A, 'the glimpser is the one being asked');
  h.do({ type: 'decide', seat: A, choice: 0 });
  // R41: and the card it caches is public in the OPPONENT's view.
  assert.deepEqual(viewFor(h.state, D, null).players[A]!.cache?.map(c => c.card), [revealed[0]],
    'Premonition: the cached card is public in the opponent\'s view (R41)');
  finishBattle(h);
});

// ── Celestial Purge — the OPPONENT of the caster glimpses ───────────────

test('Celestial Purge: the victim\'s Glimpse 3 reveal is public to the caster (R41/R45)', () => {
  const h = new Harness(15904);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
  const tok = spawn(h, A, 'Unit Token');
  const slime = spawn(h, D, 'Lurking Slimebeast');
  giveResources(h, A, 'water', 3);                    // bb/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Celestial Purge') });
  pick(h, { unit: slime });
  const revealed = h.q.deckOf(D).slice(0, 3);
  const mark = h.events.length;
  pass(h); pass(h);                                   // resolve → erase + glimpse
  // here the GLIMPSER is D, so the seat that must be shown the reveal is A —
  // the caster, who is the one pricing what they just did.
  assertOpponentSeesReveal(h, A, since(h, mark), revealed, 'Celestial Purge');
  assert.equal(h.state.decision!.seat, D, 'the victim chooses (R45)');
  h.do({ type: 'decide', seat: D, choice: 1 });
  assert.deepEqual(viewFor(h.state, A, null).players[D]!.cache?.map(c => c.card), [revealed[1]],
    'Celestial Purge: the victim\'s cached card is public in the caster\'s view (R41)');
  finishBattle(h);
});

// ── Dematerialize — negate, then the negated item's controller glimpses ──

test('Dematerialize: the negated controller\'s Glimpse 3 reveal is public to the opponent (R41/R45)', () => {
  const h = new Harness(15905);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
  const tok = spawn(h, A, 'Unit Token');
  const wall = spawn(h, D, 'Lurking Slimebeast');
  giveResources(h, A, 'water', 1);                    // Overwhelm: b/1
  giveResources(h, D, 'water', 2);                    // Dematerialize: bm/2
  giveResources(h, D, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Overwhelm') });
  pick(h, { unit: wall });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Dematerialize') });
  pick(h, { stack: h.state.stack.find(it => it.controller === A)!.id });
  const revealed = h.q.deckOf(A).slice(0, 3);
  const mark = h.events.length;
  pass(h); pass(h);                                   // resolve Dematerialize
  // A's spell is negated and A glimpses 3 — D, who cast Dematerialize, must
  // see what their own spell revealed.
  assertOpponentSeesReveal(h, D, since(h, mark), revealed, 'Dematerialize');
  assert.equal(h.state.decision!.seat, A, 'the negated item\'s controller chooses (R45)');
  h.do({ type: 'decide', seat: A, choice: 2 });
  assert.deepEqual(viewFor(h.state, D, null).players[A]!.cache?.map(c => c.card), [revealed[2]],
    'Dematerialize: the cached card is public in the opponent\'s view (R41)');
  finishBattle(h);
});

// ── Foretell — Glimpse 1 (no decision to raise) ─────────────────────────

test('Foretell: the Glimpse 1 reveal is public to the opponent (R41/R45)', () => {
  const h = new Harness(15906);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 2);                    // m/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Foretell') });
  const revealed = h.q.deckOf(A).slice(0, 1);
  const mark = h.events.length;
  pass(h); pass(h);                                   // resolve — N=1 raises no decision
  assertOpponentSeesReveal(h, D, since(h, mark), revealed, 'Foretell');
  assert.equal(h.state.decision, null, 'Glimpse 1 asks nothing (R45)');
  assert.deepEqual(viewFor(h.state, D, null).players[A]!.cache?.map(c => c.card), revealed,
    'Foretell: the cached card is public in the opponent\'s view (R41)');
  finishBattle(h);
});
