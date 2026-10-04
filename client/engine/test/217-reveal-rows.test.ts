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
import { playbackFrames, redactEvent, visibleToSeat } from '../../server/view.ts';
import type { HeldFrame, SegmentClose } from '../../server/view.ts';
import { glimpseNotice, glimpseNoticeUntil, pastTense, revealView, revealWorthShowing, rowId } from '../../ui/reveal.ts';
import type { Action, CardName, EngineEvent, EntityId, Seat } from '../src/types.ts';
import type { Room } from '../../server/rooms.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', '..', 'server');

// rooms.ts persists every room it touches — point it at a throwaway before the
// module loads (the only reason this file has a dynamic import). Same reason
// and same shape as 203-reveal-waits-for-the-barrier.test.ts.
process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-217-'));
const { applyToRoom, createRoom, openSegment, segmentKey } = await import('../../server/rooms.ts');

const NAMES: [string, string] = ['Player 1', 'Player 2'];
const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

/** one tick of main.ts's action handler; `reveal` is the barrier flush, and
 * `frames` / `close` the playback's raw material (2026-10-03), taken before
 * openSegment clears it exactly as main.ts takes it */
function tick(room: Room, a: Action): {
  events: EngineEvent[]; reveal: [EngineEvent[], EngineEvent[]] | null;
  frames: [HeldFrame[], HeldFrame[]]; close: SegmentClose | null;
} {
  const wasKey = room.segKey;
  const events = applyToRoom(room, a);
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    events.push(...applyToRoom(room, f));
  }
  const nowKey = segmentKey(room.state);
  if (wasKey === nowKey && wasKey !== null) return { events, reveal: null, frames: [[], []], close: null };
  const held: [EngineEvent[], EngineEvent[]] = [[], []];
  if (wasKey !== null) {
    held[0] = room.heldEvents[0].filter(e => !events.includes(e));
    held[1] = room.heldEvents[1].filter(e => !events.includes(e));
  }
  const frames = room.heldFrames;
  const close = room.closing;
  openSegment(room);
  return { events, reveal: wasKey !== null ? held : null, frames, close };
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
  assert.deepEqual(view.rows[1]!.lines, [{ text: 'Rashi created a Poison 1.', times: 3 }],
    'three identical sentences are one line and a count — "so much space" was the complaint (past tense: it is what happened)');
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

test('§2e a play is ONE beat: "plays X" then what it did — no "→ stack", no "Resolving X:"', () => {
  // The owner, 2026-09-05: the messages about a card being put onto the stack,
  // then resolving and having an effect "can be shortcut to just 'Plays X and
  // does Y' rather than spelling every tiny thing out". The engine still emits
  // all four (drill.ts parses "Resolving X:"); this surface curtains the two
  // plumbing lines and trims the suffix, the way the log panel already does.
  const view = revealView([
    ev('spellPlayed', 'Rashi plays Fight → stack.', { seat: 1, card: 'Fight', item: 7 }),
    ev('stackPushed', 'Fight → stack.', { id: 7, controller: 1 }),
    ev('resolved', 'Resolving Fight:', { id: 7 }),
    ev('info', 'Fight: Grox deals 3 damage to Bripp.'),
  ], () => null);
  assert.equal(view.rows.length, 1, `one card, one beat — got ${view.rows.length}`);
  assert.equal(view.rows[0]!.card, 'Fight');
  assert.deepEqual(view.rows[0]!.lines.map(l => l.text),
    ['Rashi played Fight.', 'Fight: Grox dealt 3 damage to Bripp.'],
    'the play line, then the effect — and neither plumbing line');
  assert.deepEqual(view.notes, [], 'nothing fell through to the notes');
  // negative control: a `resolved` with a message that is NOT plumbing for a
  // row still never reaches the surface — this is a rule about the TYPE
  const stray = revealView([ev('resolved', 'Resolving Fight:', { id: 7 })], () => null);
  assert.deepEqual(stray.rows.map(r => r.lines), [[]], 'the row opens for the card, with no line');
});

test('§2f the Flesh Tithe screenshot: eleven pay/lose pairs and an X line are two sentences', () => {
  // the owner, 2026-09-05: "That's unreadable. It can't just be a log. It has
  // to be 'mycheze played Flesh Tithe (X = 11). mycheze lost 11 life -> 8 life
  // remaining'." — the events exactly as engine.ts emits them for a
  // [Pay X life] cost paid one point at a time
  const evs: EngineEvent[] = [ev('spellPlayed', 'mycheze plays Flesh Tithe → stack.', { seat: 1, card: 'Flesh Tithe', item: 3 })];
  for (let life = 18, k = 0; k < 11; k++, life--) {
    evs.push(ev('info', 'mycheze pays 1 life — the cost of Flesh Tithe.'));
    evs.push(ev('lifeLost', `mycheze loses 1 life (Flesh Tithe (cost)) → ${life}.`, { seat: 1, n: 1, why: 'Flesh Tithe (cost)' }));
  }
  evs.push(ev('info', 'Flesh Tithe: X = 11 (pay X life).'));
  evs.push(ev('stackPushed', 'Flesh Tithe → stack.', { id: 3, controller: 1 }));
  evs.push(ev('resolved', 'Resolving Flesh Tithe:', { id: 3 }));
  const view = revealView(evs, () => null);
  assert.equal(view.rows.length, 1);
  assert.deepEqual(view.rows[0]!.lines.map(l => `${l.text}${l.times > 1 ? ` ×${l.times}` : ''}`), [
    'mycheze played Flesh Tithe (X = 11).',
    'mycheze lost 11 life → 8 life remaining.',
  ]);
  assert.deepEqual(view.notes, []);
  // a single loss from somebody else's source keeps its reason
  const one = revealView([ev('lifeLost', 'Rashi loses 2 life (rot) → 20.', { seat: 0, n: 2, why: 'rot' })], () => null);
  assert.deepEqual(one.notes, ['Rashi lost 2 life (rot) → 20 life remaining.']);
});

test('§2g the tense table is a table: a verb it does not know is left alone', () => {
  assert.equal(pastTense('mycheze plays Flesh Tithe.'), 'mycheze played Flesh Tithe.');
  assert.equal(pastTense('Hooba-God is released from mycheze\'s cache for FREE (prophecy fulfilled).'),
    'Hooba-God was released from mycheze\'s cache for FREE (prophecy fulfilled).');
  assert.equal(pastTense('Player 2 is done deploying.'), 'Player 2 is done deploying.', 'not a verb in the table, not touched');
  assert.equal(pastTense('spawns Good Whale.'), 'spawns Good Whale.', 'no actor before the verb: left alone');
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

/* ══ §3 the flurry, and the invariant the fix rests on ═══════════════════
 *
 * BL-21's third complaint was "a weird flurry of their stack and abilities"
 * after dismissing the reveal: the client held the reveal's own events and
 * replayed them as beats once the surface that had told you about them was
 * gone. The fix was a slice — hold only `events.slice(reveal.length)` — and
 * §3 used to pin the composition that slice rested on.
 *
 * 2026-10-03: the interstitial is gone (the owner: "I've basically started
 * just ignoring it"), replaced by a PLAYBACK — the board after each of the
 * opponent's moves, then each resolution of the closing action
 * (server/view.ts playbackFrames). There is no slice left to protect, and the
 * invariant is now the plain one the slice was approximating: EVERY EVENT
 * THE SEAT MAY SEE GOES OUT EXACTLY ONCE, IN ORDER — in the frame it belongs
 * to, or in the update the playback ends on. A flurry is an event told twice;
 * a gap is one never told. §3b measures both on a real barrier flush. */

test('§3a sendReveal sends a haste or deploy close as frames, and the rest after them', () => {
  const src = readFileSync(join(SERVER, 'main.ts'), 'utf8');
  assert.match(src, /playbackFrames\(\{ seat, held: playback\.held, tail: tailEvents, close: playback\.close, redact \}\)/,
    'the frames are built from the held moves and the tail, for this seat, through its redactor');
  assert.match(src, /frames: pb\.frames, events: pb\.rest/,
    '…and `events` is only what the frames did not carry — §3b is why that matters');
  assert.match(src, /if \(playback && step !== 'plan'\)/,
    'a resource-step close is not played back (the owner: planning is fine as it is)');
});

test('§3b every event goes out exactly once — measured on a real barrier flush', () => {
  const room = createRoom('BL21E', 21704, [...NAMES]);
  toDeployment(room);
  const A = room.state.deployPlayer! as Seat, D = other(A);
  giveEverything(room, A);
  tick(room, { type: 'playCard', seat: A, handIndex: give(room, A, 'Good Whale') });
  tick(room, { type: 'doneDeploying', seat: A });
  const t = tick(room, { type: 'doneDeploying', seat: D });
  const held = t.reveal![D]!;
  assert.ok(onWire(held, D).length > 0, 'positive control: D has a hidden move of A\'s to be told');
  assert.ok(t.close, 'the closing action was recorded');
  // heldFrames[D] = the frames held FROM D, i.e. A's moves (server/main.ts)
  const pb = playbackFrames({ seat: D, held: t.frames[D]!, tail: t.events, close: t.close!, redact: evs => onWire(evs, D) });
  assert.ok(pb.frames.length >= 1 && pb.frames[0]!.kind === 'opp', 'A\'s move is a frame of its own');
  assert.ok(Object.values(pb.frames[0]!.view.entities).some(en => en.card === 'Good Whale' && en.controller === A),
    'and that frame shows the Whale on A\'s side — the board, not a list');
  const told = [...pb.frames.flatMap(f => f.events), ...pb.rest];
  const owed = onWire([...held, ...t.events], D);
  assert.deepEqual(told.map(e => `${e.type}|${e.msg}`), owed.map(e => `${e.type}|${e.msg}`),
    'the frames and the update together tell D every visible event of the step and of its close, '
    + 'once each, in the order they happened');
});

test('§3c ui/main.ts plays the frames and has no interstitial to hold beats behind', () => {
  const src = readFileSync(join(HERE, '..', '..', 'ui', 'main.ts'), 'utf8');
  assert.match(src, /if \(m\.frames\?\.length && m\.view\) \{/, 'a message with frames is a playback');
  assert.match(src, /paceSequence\(this\.paced, steps, playbackGaps\(steps\), Date\.now\(\)\)/,
    '…queued a frame at a time on the pace queue, the real update last');
  assert.doesNotMatch(src, /pendingReveal|heldFlashes|revealOverlayHtml/,
    'the interstitial and the beats it held back are gone, not bypassed');
  // (2026-10-03: the call also passes what the update put on the table, so a
  // beat can hold its own result back — test/359. The events are still all of
  // them: with no interstitial, nothing is held back from the beats.)
  assert.match(src, /absorbFlashes\(m\.events \?\? \[\](, [^;]*)?\);/,
    'the update a playback ends on — and a resource-step close — plays its own beats');
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

/* ══ §5 CT-78: a reveal the opponent NOTICES ═════════════════════════════
 *
 * Report #104: *"Glimpse is supposed to REVEAL the cards, but opponents cannot
 * see them right now."*
 *
 * ⚠ THE REPORTED MOMENT IS NOT BROKEN and that was established by LOOKING, not
 * by reading: R188 drove a restored game in a real browser as the opponent
 * seat and the names arrive, render, and are inspectable (R222/R235 made them
 * arrive immediately inside a hidden segment; R310 moved them back to the
 * recap, where the notice pops in the playback frame). The gap is ATTENTION —
 * the glimpser gets N card scans in a modal, the opponent gets one line of
 * prose in an 80-line log — which is exactly why the report was easy to close
 * with the complaint still standing.
 *
 * ⚠ AND IT IS A MOMENT, NOT A PIECE OF STATE. `E.glimpse` writes no structured
 * record into GameState, so there is nothing to re-render from. §5f pins the
 * consequences that follow from that, including the residual it leaves.
 */

const glimpseEv = (seat: number, cards: string[]): EngineEvent =>
  ({ type: 'glimpsed', msg: `P${seat} glimpses ${cards.length}: ${cards.join(', ')}`,
     data: { seat, n: cards.length, cards } }) as EngineEvent;

test('§5a the OPPONENT glimpse becomes a surface; your own does not', () => {
  const evs = [glimpseEv(1, ['Grox', 'Palewing'])];
  assert.deepEqual(glimpseNotice(evs, 0), { seat: 1, cards: ['Grox', 'Palewing'] },
    'seat 0 is shown what seat 1 looked at');
  assert.equal(glimpseNotice(evs, 1), null,
    'and seat 1 is not — they already have a modal full of these exact scans');
});

test('§5b an empty glimpse is not a reveal — in BOTH shapes it can arrive in', () => {
  // "glimpses 3 — the deck is empty" carries no cards, and a card-sized
  // surface showing no cards would be a worse lie than the log line.
  // ⚠ TWO SHAPES, and the second is here because a break-test found the guard
  // could not tell them apart: the engine emits `{seat, n: 0}` with the key
  // ABSENT today, so a test using only that shape passes on `Array.isArray`
  // alone and says nothing about the emptiness check. An engine that starts
  // sending `cards: []` — the more obvious spelling — would walk straight
  // through. Both are asserted so neither can regress silently.
  const absent = { type: 'glimpsed', msg: 'P1 glimpses 3 — the deck is empty.',
    data: { seat: 1, n: 0 } } as EngineEvent;
  const empty = { type: 'glimpsed', msg: 'P1 glimpses 3 — the deck is empty.',
    data: { seat: 1, n: 0, cards: [] } } as EngineEvent;
  assert.equal(glimpseNotice([absent], 0), null, 'the shape the engine emits today');
  assert.equal(glimpseNotice([empty], 0), null, 'and the one it might emit tomorrow');
});

test('§5c the newest glimpse in a batch wins', () => {
  const evs = [glimpseEv(1, ['Grox']), glimpseEv(1, ['Palewing', 'Bripp'])];
  assert.deepEqual(glimpseNotice(evs, 0)!.cards, ['Palewing', 'Bripp'],
    'two in one batch is a cascade, and the board is now sitting on the newest');
});

test('§5d the client does not re-decide what is public', () => {
  // The server already made the whole privacy decision (visibleToSeat,
  // redactEvent, R310's hold). A client filtering on its own opinion
  // would be a second, quieter redactor — this repo has shipped two
  // information leaks that way (docs/13 §7.4). Whatever arrived, is shown.
  const src = readFileSync(join(HERE, '..', '..', 'ui', 'reveal.ts'), 'utf8');
  const from = src.indexOf('export function glimpseNotice(');
  const body = src.slice(from, src.indexOf('\n}', from));
  assert.equal(/privateTo|visibleToSeat|redact/.test(body), false,
    'glimpseNotice must not second-guess the redactor');
});

test('§5e how long it stays up scales with the tempo, not a number of its own', () => {
  // R242: one opinion about how fast a human reads, and a reveal is not exempt
  const one = glimpseNoticeUntil(0, 1, 1200, 1000);
  const five = glimpseNoticeUntil(0, 5, 1200, 1000);
  assert.ok(five > one, 'five cards get longer than one');
  assert.equal(five - one, 4000, 'one tempo-step per extra card');
  assert.equal(glimpseNoticeUntil(0, 0, 1200, 1000), 2200, 'never zero-length');
});

test('§5f a MOMENT: non-modal, self-expiring, and gone on a resync', () => {
  const src = readFileSync(join(HERE, '..', '..', 'ui', 'main.ts'), 'utf8');
  assert.match(src, /class="glimpsenotice"/, 'positive control: the surface is really drawn');
  assert.equal(/glimpsenotice[^`]*\boverlay\b/.test(src), false,
    'a glimpse can land in a battle window you still have to act in — it must never be '
    + 'something to dismiss before you may play');
  assert.match(src, /const glimpse = glimpseUp && glimpseUp\.until > now \? glimpseUp\.until : null;/,
    'it expires on scheduleFlashWake timer, or it would sit there until the next paint');
  assert.match(src, /glimpseUp = null;\s+\/\/ CT-78: a resync is not somebody glimpsing at you/,
    'a wholesale state is not something somebody just did — flashReset own rule');
});
