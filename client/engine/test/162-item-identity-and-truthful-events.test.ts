/* R191 — THE ITEM THE EVENT NAMES, AND EVENTS THAT TELL THE TRUTH.
 *
 * Two tickets, one class: a record that says something which is not so.
 *
 * CARD-TODO #69 — ORIGON and HEXBANE SHIITAKE located "the spell that was just
 * played" with R166's `[...g.s.stack].reverse().find(i => i.card === name &&
 * i.controller === seat && !i.copy)`, each under a paragraph explaining why a
 * reverse scan happens to be right. It is right only while the push order
 * keeps the played item above every other item with the same (card,
 * controller) — a heuristic, and the paragraph of justification was the tell.
 * `spellPlayed` has carried `item`, the played item's id, since R178, and
 * Earthbound Replicator was converted then; these are the other two.
 *
 *   ⚠ THE `!i.copy` GUARD IS A SEPARATE QUESTION AND IT SURVIVES. R164 makes a
 *   copy a real stack item carrying the ORIGINAL's card name and controller,
 *   and RAQ (_passer, two [Solved] threads) says a copy was not played:
 *   *"he won't make 2nd copy, since 1st copy wasn't 'played'. Sorry. No
 *   infinite loop there."* Switching to an id must not quietly answer that
 *   differently, so it is asserted here from both ends — the cards still skip
 *   a copy, and no play event ever names one for an id lookup to find.
 *
 * CARD-TODO #67 — two of the three truth-in-reporting defects:
 *   (a) WORLDBENDER announced the draw phase it skips as a `draw` EVENT with
 *       no `n`: a draw, in the stream, that moved no cards.
 *   (b) `afterDespawn` recovered the despawn event as
 *       `this.events[this.events.length - 1]`, correct by ORDERING ALONE.
 *       Driven below by appending an event after the despawn line — the exact
 *       future edit the ticket says would break the dispatch silently.
 *   (c) is the server's (a fork that records a silent state change), and its
 *       guard is in `server/test-forensics.ts`: a test in engine/test cannot
 *       import `server/rooms.ts` without dragging `ws` into this project's
 *       typecheck, which is the whole reason `server/types.ts` exists (R181).
 *
 * Seeds 16200-16299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { getCard, type EffectCtx, type EffectDef } from '../src/cards/dsl.ts';
import { E } from '../src/engine.ts';
import { Harness } from '../src/harness.ts';
import { spawn, toDeployment, withE as whiteBox } from './util.ts';
import type { EngineEvent, EventType, Seat, StackItem } from '../src/types.ts';

// ── the rig (140-layers-and-riders', which is where these two cards' other
//    identity tests live) ─────────────────────────────────────────────────

function resolve(
  def: EffectDef, g: E, ctx: Partial<EffectCtx> & { controller: Seat },
  answers: Record<string, unknown> = {},
): void {
  def.run(g, {
    sourceName: 'test',
    region: g.homeRegion(ctx.controller),
    targets: [],
    event: null,
    eraseSelf: () => {},
    choose: (key, dec) => (key in answers ? answers[key] : dec.options[0]!.value),
    ...ctx,
  } as EffectCtx);
}

/** a 'spellPlayed' event as `commitItem` builds it — `item` included, because
 *  commitItem includes it (R178) and these cards read it. */
const played = (card: string, seat: Seat, region: number, item: number): EngineEvent =>
  ({ type: 'spellPlayed', msg: '', data: { card, seat, region, item } });

/** a plain spell item on the stack; `copy` marks an R164 copy of one */
const item = (id: number, seat: Seat, region: number, copy = false): StackItem => ({
  id, kind: 'spell', card: 'Fight', label: copy ? `Fight (copy ${id})` : `Fight (${id})`,
  controller: seat, region, negated: false,
  parts: [{ effectKey: 'spell:Fight', targets: [] }],
  ...(copy ? { copy: true } : {}),
});

// ── ORIGON ───────────────────────────────────────────────────────────────

test('Origon negates the item the play event NAMES, with a second identical spell above it on the stack', () => {
  // THE CASE THE REVERSE SCAN GETS WRONG. Two spells, one card name, one
  // controller, and the one this trigger is about is NOT the top one — a
  // response, a cast chain or any future change to the push order puts it
  // there. `[...stack].reverse().find(card, controller)` answers with the top
  // match whatever the event said; an id answers with the spell that was
  // played.
  const h = new Harness(16200);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const g = new E(h.state);
  const region = g.homeRegion(A);
  g.s.stack.push(item(8201, A, region));   // the one the event names
  g.s.stack.push(item(8202, A, region));   // a second, identical, ABOVE it
  resolve(getCard('Origon').augmentText![0]!.effect, g, {
    controller: D, sourceName: 'Origon', region,
    event: played('Fight', A, region, 8201),
  });
  assert.deepEqual(g.s.stack.map(i => i.id), [8202],
    '"negate IT" is the item the event names — not whichever identical item is on top');
  assert.ok(g.events.some(e => e.type === 'negated' && e.data?.['id'] === 8201),
    'and the negation says so by id');
});

test('Origon: an R164 copy on top of the played spell is still not what "negate it" points at', () => {
  // The `!i.copy` guard, kept as an assertion when the scan went. The copy
  // carries the original's card name and controller and sits above it, so it
  // was reachable by (card, controller); it must stay unreachable.
  const h = new Harness(16201);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const g = new E(h.state);
  const region = g.homeRegion(A);
  g.s.stack.push(item(8211, A, region));            // played
  g.s.stack.push(item(8212, A, region, true));      // its copy, on top
  resolve(getCard('Origon').augmentText![0]!.effect, g, {
    controller: D, sourceName: 'Origon', region,
    event: played('Fight', A, region, 8211),
  });
  assert.deepEqual(g.s.stack.map(i => i.id), [8212],
    'RAQ: "the 1st copy wasn\'t \'played\'" — the copy is left standing');
});

// ── HEXBANE SHIITAKE ─────────────────────────────────────────────────────

test('Hexbane Shiitake exchanges for the item the play event NAMES, with a second identical spell above it', () => {
  // The same stack the Origon case builds, against the other card that used to
  // scan for (card, controller). "Exchange control of me for THAT spell" —
  // that spell is the one the play event named.
  const h = new Harness(16202);
  toDeployment(h);
  const A = h.state.deployPlayer!;      // plays the spells
  const D = (1 - A) as Seat;            // holds the Shiitake
  const hex = spawn(h, D, 'Hexbane Shiitake');
  const g = new E(h.state);
  const region = g.homeRegion(A);
  g.s.stack.push(item(8221, A, region));   // the one the event names
  g.s.stack.push(item(8222, A, region));   // a second, identical, ABOVE it
  resolve(getCard('Hexbane Shiitake').augmentText![0]!.effect, g, {
    controller: D, sourceId: hex, sourceName: 'Hexbane Shiitake', region,
    event: played('Fight', A, region, 8221),
  }, { swap: true });
  assert.equal(g.s.stack.find(i => i.id === 8221)!.controller, D,
    'the exchange is for the spell the event named');
  assert.equal(g.s.stack.find(i => i.id === 8222)!.controller, A,
    'and the identical spell above it was never in question');
});

test('Hexbane Shiitake: an R164 copy on top is never what the exchange is for', () => {
  const h = new Harness(16203);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const hex = spawn(h, D, 'Hexbane Shiitake');
  const g = new E(h.state);
  const region = g.homeRegion(A);
  g.s.stack.push(item(8231, A, region));            // played
  g.s.stack.push(item(8232, A, region, true));      // its copy, on top
  resolve(getCard('Hexbane Shiitake').augmentText![0]!.effect, g, {
    controller: D, sourceId: hex, sourceName: 'Hexbane Shiitake', region,
    event: played('Fight', A, region, 8231),
  }, { swap: true });
  assert.equal(g.s.stack.find(i => i.id === 8231)!.controller, D,
    '"that spell" is the one that was played');
  assert.equal(g.s.stack.find(i => i.id === 8232)!.controller, A,
    'a copy was not played, so it is not what is exchanged for (RAQ, R164)');
});

test('no play event ever names a COPY, so an identity lookup cannot reach one', () => {
  // The other end of the same guard, and the reason switching to an id did not
  // quietly answer the copy question differently: `pushSpellCopy` deliberately
  // does not go through `commitItem`, so a copy raises no 'spellPlayed' at all
  // and there is no event whose `item` could be a copy's id.
  const h = new Harness(16204);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const g = new E(h.state);
  const region = g.homeRegion(A);
  const orig = item(8241, A, region);
  g.s.stack.push(orig);
  const before = g.events.length;
  const copy = g.pushSpellCopy(orig);
  assert.ok(copy && copy.copy === true && copy.id !== orig.id,
    'a copy is a real stack item with an id of its own');
  assert.ok(!g.events.slice(before).some(e => e.type === 'spellPlayed'),
    'and making one plays nothing: no play event, so no `item` id naming a copy');
});

// ── WORLDBENDER ──────────────────────────────────────────────────────────

/** empty battle, empty deployment — the turn rolls over, which is where the
 *  card step (and Worldbender's replacement of it) happens. 137's helper. */
function rollTurn(h: Harness): void {
  toDeployment(h);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
}

test('Worldbender: the skipped draw phase is announced, not FAKED — every draw event in the stream moved cards', () => {
  // The line saying the draw phase is skipped used to be typed 'draw'. It is
  // an announcement of a draw three lines below it, not a draw, and typed that
  // way it put a draw event with no `n` into the stream — a draw that moved
  // nothing, for the log, a replay, or any consumer of the event type.
  const h = new Harness(16205);
  const A: Seat = 0;
  spawn(h, A, 'Worldbender');
  const handBefore = h.state.players[A]!.hand.length;
  const from = h.events.length;
  rollTurn(h);

  const stream = h.events.slice(from);
  const draws = stream.filter(e => e.type === 'draw' && e.data?.['seat'] === A);
  assert.ok(draws.length > 0, 'the seat really did draw, so there is a draw event to check');
  for (const d of draws) {
    assert.equal(typeof d.data?.['n'], 'number',
      `a 'draw' event has to say how many: ${JSON.stringify(d.msg)}`);
  }
  const moved = h.state.players[A]!.hand.length - handBefore;
  assert.equal(draws.reduce((n, d) => n + (d.data!['n'] as number), 0), moved,
    'the draw events in the stream account for exactly the cards that moved — no phantom draw');
  const note = stream.find(e => e.msg.includes('skips the draw phase'));
  assert.ok(note, 'the skip is still announced — the fix is the TYPE, never the silence');
  assert.notEqual(note!.type, 'draw' as EventType,
    'and it is announced as what it is: a note about a draw that is not happening');
});

// ── afterDespawn ─────────────────────────────────────────────────────────

test('afterDespawn dispatches the DESPAWN event even when another event is appended after it', () => {
  // CARD-TODO #67(b). The despawn dispatch used to pick its event up as
  // `this.events[this.events.length - 1]`, which is correct by ORDERING ALONE:
  // it holds only while nothing appends an event between the 'despawned' line
  // and the dispatch. Nothing enforced that, and nothing would have failed
  // loudly if a future edit broke it — the wrong event reaches every
  // `[Augment] When I despawn` listener, and one that reads the event's DATA
  // simply stops firing.
  //
  // So: drive that edit. `g.ev` is wrapped to append one unrelated line
  // immediately after the despawn announcement, which is exactly the shape the
  // ticket predicts, and the listener is Entropic Entity — "draw a card when a
  // unit with counters despawns", whose `when` reads `ev.data.counters` off
  // the event (the unit is out of `s.entities` by then, so the event is the
  // only place that fact exists). A card in hand is proof the right event was
  // dispatched.
  const h = new Harness(16206);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Entropic Entity');
  const marked = spawn(h, P, 'Good Whale');
  whiteBox(h, e => { e.addCounters(e.entity(marked)!, 1); });

  const handBefore = h.state.players[P]!.hand.length;
  whiteBox(h, e => {
    const real = E.prototype.ev.bind(e);
    (e as unknown as { ev: E['ev'] }).ev = (type, msg, data) => {
      const out = real(type, msg, data);
      // the future edit, made here on purpose: one more line, appended after
      // the despawn announcement and before the dispatch reads for it
      if (type === 'despawned') real('info', 'R191 test: an unrelated line, appended after the despawn');
      return out;
    };
    e.recall(e.entity(marked)!);
  });

  assert.equal(h.state.players[P]!.hand.length, handBefore + 2,
    'the recalled card AND the card Entropic Entity drew: the despawn listener saw the '
    + 'despawn event, not the line appended after it');
  assert.ok(h.log.some(l => l.includes('R191 test: an unrelated line')),
    'and the decoy really was appended — otherwise this test proves nothing');
});
