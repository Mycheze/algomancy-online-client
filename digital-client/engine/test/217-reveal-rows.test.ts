/* BL-21 — WHAT YOUR OPPONENT DID, READ AT A GLANCE.
 *
 * The owner, 2026-08-25, three complaints in one sentence:
 *
 *   "I mean when you see what your opponent did, it's very hard to actually
 *    read. It's getting overly cluttered and verbose and doesn't actually show
 *    the mods they do, that sort of thing. After dismissing it, there's also a
 *    weird flurry of their stack and abilities, which is weird and rudundant
 *    there."
 *
 * ── ⚠ THE MEASUREMENT, because complaint (1) is worse than it sounds ──
 *
 * A real room, driven through `applyToRoom`: a deployment of two Good Whales
 * with a Hooba-Lin augmented onto the FIRST one. What the surface drew:
 *
 *   Good Whale | Player 2 spawns Good Whale, Hooba-Lin targets Good Whale,
 *                Hooba-Lin augments Good Whale (Player 2's) — it is now
 *                Unstable, Player 2 spawns Good Whale.
 *
 * ONE row. The last clause is a DIFFERENT Good Whale folded into the first
 * one's row, so the surface was not merely verbose, it was WRONG. And
 * Hooba-Lin — the mod he is asking to see — had no scan anywhere.
 *
 * Both from one cause: the grouping ran `findCardName` over message PROSE and
 * `findCardName` returns the LONGEST name in the string, so a two-word host
 * outranks a one-word mod every time, and two units sharing a card name are
 * one group by construction.
 *
 * ── ⚠ AND THE OLDER REPORT THAT MUST NOT COME BACK ────────────────────
 *
 * This is the SECOND complaint about this surface. Round 8, with a screenshot
 * of one Biotoxicity filling the whole interstitial: *"single cards create 5,
 * full sized entries […] it's good to show the full chain of events, but they
 * don't need to take up so much space."* `groupReveal` was that fix and it
 * over-corrected into the bug above.
 *
 * So §2 carries round 8's OWN FIXTURE, moved here from
 * `50-ui-inspect.test.ts` when the code it tested was deleted. One row per
 * entity would have failed it — a spell that makes three tokens makes three
 * entities — which is exactly why the merge rule exists. **A report does not
 * stop mattering because the code that answered it was rewritten**, and a file
 * that fixes complaint N by re-opening complaint N-1 is this repo's signature
 * failure (#37 → #76, #46 → #60/#75).
 *
 * ── WHAT IS HERE ──────────────────────────────────────────────────────
 *
 *   §1  THE REPORT ITSELF, against a real Room — two rows, and the mod on the
 *       card it was applied to. Read through the same `visibleToSeat` /
 *       `redactEvent` the wire uses, never off `h.log` (docs/13 §7.4).
 *   §2  ROUND 8, re-run: the chain still collapses, and the merge rule that
 *       makes both reports true at once.
 *   §3  THE FLURRY, and the invariant the fix rests on — asserted against
 *       `server/main.ts`'s own source, not assumed.
 *   §4  NOTHING IS SILENTLY DROPPED. The failure mode of a structured surface
 *       is that it shows less than it was given and looks fine doing it.
 *
 * Seeds 21700-21799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forcedAction } from '../src/apply.ts';
import { redactEvent, visibleToSeat } from '../../server/view.ts';
import { revealView, revealWorthShowing, rowId } from '../ui/reveal.ts';
import type { Action, CardName, EngineEvent, EntityId, Seat } from '../src/types.ts';
import type { Room } from '../../server/rooms.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', '..', 'server');

// rooms.ts persists every room it touches — point it at a throwaway before the
// module loads (the only reason this file has a dynamic import). Same reason
// and same shape as 203-reveal-escapes-the-hidden-hold.test.ts.
process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-217-'));
const { applyToRoom, createRoom, openSegment, segmentKey } = await import('../../server/rooms.ts');

const NAMES: [string, string] = ['Player 1', 'Player 2'];
const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

/** one tick of main.ts's action handler; `reveal` is the barrier flush */
function tick(room: Room, a: Action): { events: EngineEvent[]; reveal: [EngineEvent[], EngineEvent[]] | null } {
  const wasKey = room.segKey;
  const events = applyToRoom(room, a);
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    events.push(...applyToRoom(room, f));
  }
  const nowKey = segmentKey(room.state);
  if (wasKey === nowKey && wasKey !== null) return { events, reveal: null };
  const held: [EngineEvent[], EngineEvent[]] = [[], []];
  if (wasKey !== null) {
    held[0] = room.heldEvents[0].filter(e => !events.includes(e));
    held[1] = room.heldEvents[1].filter(e => !events.includes(e));
  }
  openSegment(room);
  return { events, reveal: wasKey !== null ? held : null };
}

/** `sendReveal`'s own filter, for `seat` — what really goes on the wire */
const onWire = (evs: EngineEvent[], seat: Seat): EngineEvent[] =>
  evs.filter(e => visibleToSeat(e, seat)).map(e => redactEvent(e, seat, NAMES));

const give = (room: Room, seat: Seat, name: CardName): number => {
  room.state.players[seat]!.hand.push(name);
  return room.state.players[seat]!.hand.length - 1;
};
const giveRes = (room: Room, seat: Seat, kind: string, n: number): void => {
  for (let i = 0; i < n; i++) room.state.players[seat]!.resources.push({ kind, state: 'open' } as never);
};
/** enough of every element that no fixture here is ever about affordability */
const giveEverything = (room: Room, seat: Seat): void => {
  for (const kind of ['fire', 'water', 'wood', 'metal', 'earth', 'light', 'dark']) {
    giveRes(room, seat, kind, 8);
  }
};

/** the client's own lookup: name an entity out of the live state */
const cardOf = (room: Room) => (id: EntityId): CardName | null =>
  room.state.entities[id]?.card ?? null;

/** both seats through planning, haste and the battle into the hidden deploy segment */
function toDeployment(room: Room): void {
  tick(room, { type: 'donePlanning', seat: 0 });
  tick(room, { type: 'donePlanning', seat: 1 });
  for (const seat of [0, 1] as Seat[]) {
    if (room.state.hasteDone && !room.state.hasteDone[seat]) tick(room, { type: 'doneHaste', seat });
  }
  if (room.state.battle) tick(room, { type: 'declareAttack', seat: room.state.battle.attacker, columns: [] });
  if (room.state.phase === 'battle' && room.state.battle) {
    tick(room, { type: 'declareAttack', seat: room.state.battle.attacker, columns: [] });
  }
}

/* ══ §1 the report itself, on a real room ════════════════════════════════ */

/** the measured fixture: two Good Whales, a Hooba-Lin on the first */
function twoWhalesOneMod(code: string, seed: number): { reveal: EngineEvent[]; room: Room; D: Seat } {
  const room = createRoom(code, seed, [...NAMES]);
  toDeployment(room);
  assert.equal(room.segKey, 'deploy', 'the room is inside the hidden deployment segment');
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveEverything(room, A);
  tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Good Whale') });
  const host = Object.values(room.state.entities).find(e => e.card === 'Good Whale')!;
  tick(room, { type: 'augment', seat: A, from: 'hand', index: give(room, A, 'Hooba-Lin'), hostId: host.id });
  tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Good Whale') });
  tick(room, { type: 'doneDeploying', seat: A });
  const t = tick(room, { type: 'doneDeploying', seat: D });
  assert.ok(t.reveal, 'the barrier really flushed a reveal');
  const held = t.reveal![D]!;
  return { reveal: onWire(held, D), room, D };
}

test('§1a two units of the same card are TWO rows — the folding is gone', () => {
  const { reveal, room } = twoWhalesOneMod('BL21A', 21700);
  const view = revealView(reveal, cardOf(room));
  assert.equal(view.rows.length, 2,
    'the measured defect drew ONE row containing both Good Whales and the mod between them');
  assert.deepEqual(view.rows.map(r => r.card), ['Good Whale', 'Good Whale']);
  const [first, second] = view.rows;
  assert.notDeepEqual(first!.ids, second!.ids, 'and they are genuinely different entities');
});

test('§1b the MOD is on the surface, on the card it was applied to', () => {
  const { reveal, room } = twoWhalesOneMod('BL21B', 21701);
  const view = revealView(reveal, cardOf(room));
  assert.deepEqual(view.rows[0]!.mods, [{ card: 'Hooba-Lin', how: 'augment' }],
    '"doesn\'t actually show the mods they do" — it is a card, so it is drawn as one');
  assert.deepEqual(view.rows[1]!.mods, [],
    'and it is on the WHALE IT WAS APPLIED TO, not on both. A chip on the wrong copy is the '
    + 'same misinformation the folding produced, arriving by another door.');
  // the mod's own sentence is not ALSO printed — the chip says host, mod and how
  const lines = view.rows.flatMap(r => r.lines.map(l => l.text));
  assert.equal(lines.some(l => /augments/.test(l)), false, 'the chip replaces the sentence');
});

test('§1c the mod is named from the EVENT, not from the prose that outranked it', () => {
  // findCardName returns the LONGEST card name in a message, so "Hooba-Lin
  // augments Good Whale" has always resolved to Good Whale. This is the
  // regression test for the actual cause, not just for the symptom.
  const { reveal } = twoWhalesOneMod('BL21C', 21702);
  const modEv = reveal.find(e => e.type === 'modApplied')!;
  assert.ok(/Hooba-Lin/.test(modEv.msg) && /Good Whale/.test(modEv.msg),
    'the message really does name both, which is what made the prose ambiguous');
  assert.equal(typeof modEv.data?.['mod'], 'number', 'and the event says which one is the MOD');
});

test('§1d a line belonging to no card is kept as a note, not dropped', () => {
  const { reveal, room } = twoWhalesOneMod('BL21D', 21703);
  const view = revealView(reveal, cardOf(room));
  assert.ok(view.notes.some(n => /is done deploying/i.test(n)),
    'it is not a card row, and it is still on screen');
  assert.equal(revealWorthShowing({ rows: [], notes: view.notes }), false,
    '…but a segment whose ONLY content is "is done deploying" still opens no interstitial');
  assert.equal(revealWorthShowing(view), true, 'this one has real rows, so it does');
});

/* ══ §2 round 8, re-run — the complaint this must not re-open ════════════ */

const ev = (type: string, msg: string, data?: Record<string, unknown>): EngineEvent =>
  ({ type, msg, ...(data ? { data } : {}) }) as EngineEvent;

test('§2a round 8 fixture: one card\'s chain is still one row, and repeats still count', () => {
  // the exact screenshot, as prose-only events — the shape an event with no
  // structured subject still arrives in
  const view = revealView([
    ev('cardPlayed', 'Rashi plays Biotoxicity.'),
    ev('info', 'Biotoxicity resolves.'),
    ev('spawned', 'Rashi creates a Poison 1.'),
    ev('spawned', 'Rashi creates a Poison 1.'),
    ev('spawned', 'Rashi creates a Poison 1.'),
  ], () => null);
  assert.equal(view.rows.length, 2, `five events should read as two beats, got ${view.rows.length}`);
  assert.deepEqual(view.rows.map(r => r.card), ['Biotoxicity', 'Poison']);
  assert.deepEqual(view.rows[1]!.lines, [{ text: 'Rashi creates a Poison 1.', times: 3 }],
    'three identical sentences are one line and a count — "so much space" was the complaint');
});

test('§2b the same chain WITH entity ids still reads as two rows', () => {
  // three tokens are three entities, so one-row-per-entity would be round 8
  // filed again. The merge rule is what makes both reports true at once.
  const names: Record<number, CardName> = { 1: 'Poison', 2: 'Poison', 3: 'Poison' };
  const view = revealView([
    ev('cardPlayed', 'Rashi plays Biotoxicity.'),
    ev('spawned', 'Rashi creates a Poison 1.', { unit: 1 }),
    ev('spawned', 'Rashi creates a Poison 1.', { unit: 2 }),
    ev('spawned', 'Rashi creates a Poison 1.', { unit: 3 }),
  ], id => names[id] ?? null);
  assert.equal(view.rows.length, 2);
  assert.equal(view.rows[1]!.count, 3, 'three entities, counted rather than repeated');
  assert.deepEqual(view.rows[1]!.ids, [1, 2, 3], 'and it remembers which — the scan previews one');
});

test('§2c a modded copy NEVER merges with a plain one', () => {
  const names: Record<number, CardName> = { 1: 'Good Whale', 2: 'Good Whale', 9: 'Hooba-Lin' };
  const view = revealView([
    ev('spawned', 'spawns Good Whale.', { unit: 1 }),
    ev('modApplied', 'Hooba-Lin augments Good Whale.', { host: 1, mod: 9, appliedAs: 'augment' }),
    ev('spawned', 'spawns Good Whale.', { unit: 2 }),
  ], id => names[id] ?? null);
  assert.equal(view.rows.length, 2,
    'merging them would draw the chip over both copies — the misinformation this file removes');
  assert.deepEqual(view.rows[0]!.mods.map(m => m.card), ['Hooba-Lin']);
  assert.deepEqual(view.rows[1]!.mods, []);
});

test('§2d a card that comes BACK later is a new beat, not a tally', () => {
  const names: Record<number, CardName> = { 1: 'Good Whale', 2: 'Bripp', 3: 'Good Whale' };
  const view = revealView([
    ev('spawned', 'a.', { unit: 1 }), ev('spawned', 'b.', { unit: 2 }), ev('spawned', 'c.', { unit: 3 }),
  ], id => names[id] ?? null);
  assert.deepEqual(view.rows.map(r => r.card), ['Good Whale', 'Bripp', 'Good Whale'],
    'the chain stays in the order it happened — this is compression, not a count of the segment');
});

/* ══ §3 the flurry, and the invariant the fix rests on ═══════════════════ */

test('§3a sendReveal really does put the reveal events in BOTH fields', () => {
  // This is the cause of "a weird flurry of their stack and abilities" after
  // dismissing: the client held `events` and replayed them as board beats, and
  // `events` BEGINS with everything the surface had just finished telling you.
  const src = readFileSync(join(SERVER, 'main.ts'), 'utf8');
  assert.match(src, /reveal:\s*revealEvents\.filter\(e => visibleToSeat\(e, seat\)\)/,
    'reveal = revealEvents, filtered for this seat');
  assert.match(src, /events:\s*\[\.\.\.revealEvents,\s*\.\.\.tailEvents\]\.filter\(e => visibleToSeat\(e, seat\)\)/,
    'events = [reveal, ...tail], filtered THE SAME WAY and in that order — which is the whole '
    + 'reason ui/main.ts may take the tail as `events.slice(reveal.length)`. If this composition '
    + 'changes, that slice silently starts cutting in the wrong place.');
});

test('§3b the client holds only the TAIL — measured on a real barrier flush', () => {
  const room = createRoom('BL21E', 21704, [...NAMES]);
  toDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveEverything(room, A);
  tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Good Whale') });
  tick(room, { type: 'doneDeploying', seat: A });
  const t = tick(room, { type: 'doneDeploying', seat: D });
  const held = t.reveal![D]!;
  const revealPart = onWire(held, D);
  // sendReveal's own composition, rebuilt here exactly as §3a pins it
  const wire = onWire([...held, ...t.events], D);
  assert.ok(revealPart.length > 0, 'positive control: there is a reveal to be redundant about');
  const tail = wire.slice(revealPart.length);
  assert.equal(wire.length - tail.length, revealPart.length,
    'everything the surface already showed is exactly the prefix the client now skips');
  for (const e of tail) {
    assert.equal(revealPart.includes(e), false,
      'and nothing in the tail was part of the reveal — the beats that still play are the ones '
      + 'that happened AFTER the barrier, which nobody has been shown');
  }
});

test('§3c ui/main.ts really takes the slice, and only while a reveal is up', () => {
  const src = readFileSync(join(HERE, '..', 'ui', 'main.ts'), 'utf8');
  assert.match(src, /if \(pendingReveal\) heldFlashes\.push\(\.\.\.\(m\.events \?\? \[\]\)\.slice\(\(m\.reveal \?\? \[\]\)\.length\)\);/,
    'held: the tail only');
  assert.match(src, /else absorbFlashes\(m\.events \?\? \[\]\);/,
    'and with no interstitial up, nothing changes — a "plan" close has no overlay, so its '
    + 'beats ARE the telling and must still play');
});

/* ══ §4 nothing is silently dropped ═════════════════════════════════════ */

test('§4a every event carrying a message reaches the surface somewhere', () => {
  // The failure mode of a structured surface is that it shows LESS than it was
  // given and looks fine doing it — you cannot tell a quiet segment from one
  // the reader could not parse. So: everything in, everything out.
  const names: Record<number, CardName> = { 1: 'Good Whale', 9: 'Hooba-Lin' };
  const events = [
    ev('spawned', 'spawns Good Whale.', { unit: 1 }),
    ev('modApplied', 'Hooba-Lin augments Good Whale.', { host: 1, mod: 9, appliedAs: 'augment' }),
    ev('info', 'something nobody has thought about.'),
    ev('stackFlash', ''),                                    // signal-only, no line
    ev('phase', 'Player 2 is done deploying.'),
    ev('info', 'a line about a card that is gone.', { unit: 404 }),
  ];
  const view = revealView(events, id => names[id] ?? null);
  const shown = new Set([
    ...view.rows.flatMap(r => r.lines.map(l => l.text)),
    ...view.notes,
    // the mod's line is represented by its chip rather than repeated
    ...view.rows.flatMap(r => r.mods.map(() => 'Hooba-Lin augments Good Whale.')),
  ]);
  for (const e of events) {
    if (!e.msg) continue;
    assert.ok(shown.has(e.msg), `dropped: "${e.msg}"`);
  }
  assert.ok(view.notes.includes('a line about a card that is gone.'),
    'an entity the client cannot name falls back to a note rather than a blank scan');
});

test('§4b an empty reveal produces nothing, and opens no interstitial', () => {
  const view = revealView([], () => null);
  assert.deepEqual(view.rows, []);
  assert.deepEqual(view.notes, []);
  assert.equal(revealWorthShowing(view), false);
});

test('§4c rowId names an entity for a unit row and nothing for a spell row', () => {
  const view = revealView([
    ev('cardPlayed', 'Rashi plays Biotoxicity.'),
    ev('spawned', 'spawns Good Whale.', { unit: 1 }),
  ], id => (id === 1 ? 'Good Whale' : null));
  assert.equal(rowId(view.rows[0]!), undefined, 'a spell is not an entity — nothing to preview');
  assert.equal(rowId(view.rows[1]!), 1, 'a unit row previews the LIVE entity, not the cardboard');
});
