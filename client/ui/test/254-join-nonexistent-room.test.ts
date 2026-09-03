/* R274 / CT-148 — A MISTYPED ROOM CODE MUST SAY SO, NOT "Connecting…".
 *
 * THE REPORT (#135, room ERJZ, 2026-08-30), verbatim:
 *
 *   "When attempting to connect to a room that doesn't exist (putting in the
 *    wrong code, for example), it's not giving the 'Room doesn't exist error'
 *    and NOW says 'connecting to server', which is confusing and not clear."
 *
 * The owner's "now" is the whole of the diagnosis. This was a REGRESSION, and
 * neither half of it is where you would look:
 *
 *   · THE SERVER WAS NEVER WRONG. It answers a join to an unknown code with
 *     `{t:'error', msg:'No game with code ZZZZ. …'}` inside a millisecond —
 *     measured over a real socket before anything here was written.
 *   · THE CLIENT'S DISPLAY PATH WAS NEVER WRONG EITHER. renderConnecting()
 *     has had a `uiError` slot, a `.joinerr` style and a "← Back to the home
 *     screen" button for exactly this message since it was written.
 *
 * What broke sits between them, and it is a THROWN EXCEPTION. Commit 2a715bf
 * (Round 32, R258/CT-123, 2026-08-29 — one day before the report) took the
 * share banner out of the board markup, where it was only ever evaluated with
 * a board on screen, and moved it into `paintLive()`:
 *
 *     function paintLive(): void {
 *       setLiveSlot('paceslot',     paceChipHtml());
 *       setLiveSlot('presenceslot', presenceHtml());
 *       setLiveSlot('shareslot',    shareBannerHtml());   // ← reads h.state
 *     }
 *
 * `setLiveSlot` bails when the node is absent ("not a board screen"), but that
 * guard is INSIDE the callee — the argument is computed first. And
 * `shareBannerHtml()` dereferences `h.state.phase`, while `NetBackend.state`
 * is `null as unknown as GameState` until a `joined` arrives. Meanwhile
 * `paintLive()` is reached from `flushPace()`, which R150 made the FIRST line
 * of the `t === 'error'` handler ("never say no about a board the player
 * cannot see yet — spend the queue first"). So:
 *
 *     onMsg → t==='error' → flushPace() → paintLive() → shareBannerHtml()
 *           → TypeError: Cannot read properties of null (reading 'phase')
 *
 * and the two lines that would have shown the message —
 * `uiError = m.msg; render();` — are three statements further down and never
 * run. The player sits on "Connecting to the server…" forever. Confirmed in
 * headless Chrome against a real server before the fix, with that exact stack.
 *
 * WHAT THIS FILE GUARDS, AND WHY IT IS SHAPED THIS WAY.
 *
 * §1 is the SERVER half, and it is deliberately not a socket test. The
 * sentence the player reads used to exist only as a string literal inside
 * main.ts's `msg.t === 'join'` branch, reachable only by opening a WebSocket —
 * the same trap R204 named for the pacing. It is now `joinRefusal()` in
 * rooms.ts, so it is a value.
 *
 * §2 is the REGRESSION, driven through the real client (test/ui-driver.ts):
 * the refusal the server really sends, delivered on the real socket before any
 * join, must reach the screen. Against HEAD this does not fail an assertion —
 * it THROWS, out of `push()`, which is the honest failure.
 *
 * §3 is why the fix guards on `h.state` and not on `NET.joined`. The
 * constructed/draft waiting room is JOINED and still has no state, so an error
 * arriving there crashes by the identical path. A fix written against §2 alone
 * passes §2 and leaves that one broken.
 *
 * §4 is the non-vacuity check §2 and §3 rest on: the connecting screen must
 * not already contain the sentence, or a green there would mean nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinRefusal, reserveRoomCode } from '../../server/rooms.ts';
import { client } from './ui-driver.ts';

/** the real client, driven — no `join()` anywhere below on purpose */
const ui = await client();

/** a code nothing has minted and nothing has saved */
const BOGUS = 'ZZQX';

// ── §1 the server half: the refusal is a value, not a socket event ────

test('R274 §1 a code the server never minted is refused, and the refusal names it', () => {
  const why = joinRefusal(BOGUS);
  assert.notEqual(why, null, 'an unminted code must be refused — otherwise a typo silently creates an empty game');
  assert.match(why!, /No game with code ZZQX/,
    'the refusal must NAME the code the player typed: it is the only way they can see they mistyped it');
  assert.match(why!, /new game|opponent/i,
    'the refusal must say what to do next — a dead end is what the report is about');
});

test('R274 §1 an empty code and a minted code are the other two answers', () => {
  assert.equal(joinRefusal(''), 'a room code is required');
  reserveRoomCode('QXZZ');
  assert.equal(joinRefusal('QXZZ'), null,
    'a code /api/new reserved must be joinable — joinRefusal decides the CODE only, never the deck or the seat');
});

// ── §4 non-vacuity, asserted BEFORE the two guards that depend on it ──

test('R274 §4 the connecting screen does not already carry the refusal', () => {
  const before = ui.html();
  assert.match(before, /Connecting to the server/,
    'the fixture is not on the connecting screen — §2 would be testing nothing');
  assert.doesNotMatch(before, /No game with code/,
    'the sentence is on screen before the server has said anything: §2 could not tell a fix from a no-op');
});

// ── §2 THE REGRESSION ────────────────────────────────────────────────

test('R274 §2 a refused join reaches the connecting screen instead of Connecting forever', () => {
  const html = ui.push({ t: 'error', msg: joinRefusal(BOGUS)! });
  assert.match(html, /No game with code ZZQX/,
    'the server said the room does not exist and the player was not told — playtest #135/CT-148');
  assert.doesNotMatch(html, /Connecting to the server/,
    'the refusal must REPLACE "Connecting to the server…", not sit under it');
  assert.ok(ui.has({ btn: 'gohome' }),
    'a refused join is a dead end without the way home — the only other exit is editing the URL');
});

// ── §3 the same crash one screen further in ──────────────────────────

test('R274 §3 an error in the constructed waiting room lands too, where there is still no board', () => {
  // the server's waiting-room 'joined': joined === true, and state is STILL
  // null, which is exactly the case a fix guarded on NET.joined would miss
  const waiting = ui.push({
    t: 'joined', seat: 0, room: 'QXZZ', waiting: { have: [true, false] }, peers: [true, false],
    names: ['Ann', 'Bo'],
  });
  assert.match(waiting, /Constructed/, 'the fixture is not in the waiting room — §3 would be testing nothing');
  const html = ui.push({ t: 'error', msg: 'that deck is not playable: 39 cards' });
  assert.match(html, /that deck is not playable/,
    'a refusal in the waiting room must reach the player — the crash path is identical to §2');
});
