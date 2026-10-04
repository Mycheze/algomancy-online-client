/* R310 (owner, 2026-10-04, report #192) — AN OPPONENT'S GLIMPSE IN A HIDDEN STEP
 * POPS IN THE RECAP, AT THE MOMENT IT HAPPENED.
 *
 * The owner: "Glimpse cards shouldn't be shown to an opponent *during*
 * Deployment. They should be a part of the recap only." The server half — the
 * glimpse is held, flushed once at the barrier, inside the playback frame of
 * the action that made it — is server/test/203-reveal-waits-for-the-barrier.
 * This is the client half, on the real client (test/ui-driver.ts):
 *
 *   §1 the card notice (CT-78's `.glimpsenotice`) appears when the frame
 *      carrying the glimpse PLAYS — not on the frame before it. Until R310 the
 *      playback branch of ui/main.ts applyUpdate returned before the glimpse
 *      absorb, so a glimpse held for the recap would have played with no notice
 *      at all: moving it out of the live path without this would have turned
 *      "revealed too early" into "revealed as one log line".
 *   §2 Learn to Play (ui/solo.ts) holds the bot's glimpse the same way, and its
 *      recap pops the notice through the same branch.
 *
 * The frames are never hand-built: §1's come from a real Room through the
 * server's own builder (server/view.ts playbackFrames), §2's from the
 * in-browser room itself.
 *
 * Seeds 37100-37199.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { client } from './ui-driver.ts';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import { forcedAction, legalActions } from '../../engine/src/apply.ts';
import type { Harness } from '../../engine/src/harness.ts';
import type { Action, CardName, EngineEvent, GameState, Seat } from '../../engine/src/types.ts';
import { playbackFrames, redactEvent, viewFor, visibleToSeat } from '../../server/view.ts';
import type { Room } from '../../server/rooms.ts';
import { CONSTRUCT, fallbackMove, type BotPolicy } from '../bot.ts';
import { SoloServer, type SoloDeal } from '../solo.ts';

// rooms.ts persists every room it touches — point it at a throwaway first
process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-371-'));
const { applyToRoom, createRoom, openSegment, segmentKey } = await import('../../server/rooms.ts');

const ui = await client();
const NAMES: [string, string] = ['Ann', 'Bo'];
const other = (s: Seat): Seat => (s === 0 ? 1 : 0);
const onWire = (evs: EngineEvent[], seat: Seat): EngineEvent[] =>
  evs.filter(e => visibleToSeat(e, seat)).map(e => redactEvent(e, seat, NAMES));
/** the client paces a playback off Date.now (ui/pace.ts paceDue) — a test
 * clock, so a frame is released by `later()` and not by waiting a second */
const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;
const later = (): void => { clock += 10_000; ui.tick(); };
const notice = (html: string): string | null => {
  const at = html.indexOf('class="glimpsenotice"');
  return at < 0 ? null : html.slice(at, at + 4000);
};

/** apply + drain, as main.ts does; on a close, the playback for `seat` */
function act(room: Room, a: Action, seat: Seat) {
  const wasKey = room.segKey;
  const events = applyToRoom(room, a);
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    events.push(...applyToRoom(room, f));
  }
  if (segmentKey(room.state) === wasKey) return null;
  const frames = room.heldFrames, close = room.closing!;
  openSegment(room);
  return playbackFrames({ seat, held: frames[seat]!, tail: events, close, redact: evs => onWire(evs, seat) });
}

test('R310 §1: the opponent\'s glimpse notice pops when its recap frame plays, not before', () => {
  const room = createRoom('R371A', 37101, [...NAMES]);
  act(room, { type: 'donePlanning', seat: 0 }, 0);
  act(room, { type: 'donePlanning', seat: 1 }, 0);
  for (const s of [0, 1] as Seat[]) {
    if (room.state.hasteDone && !room.state.hasteDone[s]) act(room, { type: 'doneHaste', seat: s }, 0);
  }
  for (let g = 0; g < 2 && room.state.phase === 'battle' && room.state.battle; g++) {
    act(room, { type: 'declareAttack', seat: room.state.battle.attacker, columns: [] }, 0);
  }
  assert.equal(room.segKey, 'deploy', 'inside the hidden deployment');
  const A = room.state.deployPlayer! as Seat, D = other(A);

  // the watcher joins on the board the step opened on
  ui.join(viewFor(room.state, D, room.segSnapshot), D, legalActions(room.state, D));
  assert.equal(notice(ui.html()), null, 'no notice to begin with');

  // the deploying seat plays a unit, THEN the glimpse, then answers it
  const give = (name: CardName): number => { room.state.players[A]!.hand.push(name); return room.state.players[A]!.hand.length - 1; };
  for (const [k, n] of [['fire', 1], ['water', 3]] as const) {
    for (let i = 0; i < n; i++) room.state.players[A]!.resources.push({ kind: k, state: 'open' } as never);
  }
  act(room, { type: 'playCard', seat: A, handIndex: give('Ignis Sprite') }, D);
  const revealed = (room.state.decks?.[A] ?? room.state.sharedDeck).slice(0, 5);
  act(room, { type: 'playCard', seat: A, handIndex: give('Oracle of Foretelling') }, D);
  act(room, { type: 'decide', seat: A, choice: 0 }, D);
  act(room, { type: 'doneDeploying', seat: A }, D);
  const pb = act(room, { type: 'doneDeploying', seat: D }, D);
  assert.ok(pb, 'the close of deployment');
  const at = pb!.frames.findIndex(f => f.events.some(e => e.type === 'glimpsed'));
  assert.ok(at > 0, `non-vacuous: the glimpse is in a LATER frame than the first (frame ${at + 1} of ${pb!.frames.length})`);

  ui.push({
    t: 'update', step: 'deploy', view: viewFor(room.state, D, null), legal: legalActions(room.state, D),
    frames: pb!.frames, events: pb!.rest,
  });
  for (let i = 0; i < at; i++) {
    assert.match(ui.html(), /promptbar playbar/, `frame ${i + 1} is on screen as a playback`);
    assert.equal(notice(ui.html()), null, `frame ${i + 1}, before the glimpse, pops no notice`);
    later();
  }
  const shown = notice(ui.html());
  assert.ok(shown, 'the frame carrying the glimpse pops the notice');
  assert.match(shown!, new RegExp(`${NAMES[A]} glimpsed ${revealed.length}`), 'naming the glimpser and the count');
  for (const name of revealed) assert.ok(shown!.includes(name), `and showing ${name}`);
});

// ── Learn to Play ────────────────────────────────────────────────────────

const fire = DECK_LIST.filter(n => getCard(n).kind === 'unit' && (getCard(n).factions ?? []).join() === 'fire');
const DEAL: SoloDeal = {
  seed: 37102,
  names: ['Learner', 'Tutorial Bot'],
  decks: [Array.from({ length: 30 }, (_, i) => fire[i % fire.length]!) as CardName[], Array(40).fill(CONSTRUCT)],
  lesson: {
    openingHand: [4, 1], drawPerTurn: [2, 1], stacked: [false, false],
    shardsPerTurn: [0, 1], firstShardTurn: 1, shardState: 'open',
    prismites: [2, 0], startingLife: [30, 30],
  },
};
/** a bot that plays the Oracle the moment it may, and is passive otherwise */
const oracleBot: BotPolicy = {
  id: 'oracle-test', name: 'Tutorial Bot',
  choose(state: GameState, seat: Seat, legal: readonly Action[]): Action | null {
    const play = legal.find(a => a.type === 'playCard' && state.players[seat]!.hand[a.handIndex] === 'Oracle of Foretelling');
    return play ?? legal.find(a => a.type === 'decide') ?? fallbackMove(legal) ?? null;
  },
};
interface Msg { t: string; view?: GameState; legal?: Action[]; events?: EngineEvent[]; step?: string; frames?: { view: GameState; events: EngineEvent[]; kind: string }[] }

test('R310 §2: Learn to Play holds the bot\'s glimpse for the recap, and the recap pops it', () => {
  const s = new SoloServer(DEAL, oracleBot);
  const msgs: Msg[] = [];
  const sock = s.socket();
  sock.deliver = (m: Record<string, unknown>) => { msgs.push(JSON.parse(JSON.stringify(m)) as Msg); };
  s.receive(JSON.stringify({ t: 'join' }));
  // the bot holds an Oracle and the mana for it from the start (the private
  // harness is reached the way a room test mutates room.state)
  const h = (s as unknown as { h: Harness }).h;
  h.state.players[1]!.hand.push('Oracle of Foretelling');
  for (let i = 0; i < 3; i++) h.state.players[1]!.resources.push({ kind: 'water', state: 'open' } as never);

  const glimpsedYet = () => s.events.some(e => e.type === 'glimpsed' && e.data?.['seat'] === 1);
  for (let i = 0; i < 200 && !glimpsedYet(); i++) {
    const last = [...msgs].reverse().find(m => m.legal)!;
    const a = fallbackMove(last.legal!);
    if (!a) break;
    s.act(a);
  }
  assert.ok(glimpsedYet(), 'non-vacuous: the bot glimpsed');
  assert.equal(s.state.phase, 'deploy', 'inside the bot\'s deployment, with the step still open');
  const revealed = s.events.find(e => e.type === 'glimpsed' && e.data?.['seat'] === 1)!.data!['cards'] as CardName[];
  assert.ok(!msgs.some(m => (m.events ?? []).some(e => e.type === 'glimpsed')),
    'no message the learner has been sent carries the glimpse');
  assert.ok(!s.log().some(l => l.includes('glimpses')), 'nor does the log a reload would show them');

  // the learner joins the client on the board as they see it, then finishes deploying
  ui.join(s.view(), 0, s.legal());
  const before = msgs.length;
  for (let i = 0; i < 10 && s.state.phase === 'deploy'; i++) {
    const last = [...msgs].reverse().find(m => m.legal)!;
    s.act(fallbackMove(last.legal!)!);
  }
  const close = msgs.slice(before).find(m => m.frames?.length);
  assert.ok(close, 'the close of deployment is a playback');
  const withIt = close!.frames!.filter(f => f.events.some(e => e.type === 'glimpsed'));
  assert.equal(withIt.length, 1, 'and exactly one of its frames carries the glimpse');
  assert.equal(withIt[0]!.kind, 'opp', 'one of the bot\'s moves');
  assert.ok(!(close!.events ?? []).some(e => e.type === 'glimpsed'), 'not repeated after the frames');

  const at = close!.frames!.indexOf(withIt[0]!);
  ui.push(close as unknown as Record<string, unknown>);
  for (let i = 0; i < at; i++) later();
  const shown = notice(ui.html());
  assert.ok(shown, 'the recap frame pops the notice in Learn to Play too');
  for (const name of new Set(revealed)) assert.ok(shown!.includes(name), `showing ${name}`);
});

after(() => { Date.now = realNow; });
