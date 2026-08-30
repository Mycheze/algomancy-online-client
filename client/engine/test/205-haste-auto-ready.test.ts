/* R236 (owner ruling, 2026-08-28) — READY AND PASS THROUGH THE HASTE STEP.
 *
 * ── THE INSTRUCTION
 *
 * *"If the player doesn't have a haste card or doesn't have haste bluff
 * enabled, they should auto 'ready and pass' through haste, which will make it
 * happen very very quickly."*
 *
 * ── WHAT IT IS PAYING OFF
 *
 * R224/R228 made the haste step UNCONDITIONAL: it opens every turn for both
 * seats, `canHaste` was deleted, and nobody is pre-marked done — because a
 * step that only appeared when somebody COULD act published "I am holding
 * something haste-playable" out of a hand `viewFor` redacts to `__HIDDEN__`.
 * R224 recorded the debt that left behind, in as many words: **an always-open
 * window is a tax on every turn unless passing through it is cheap.** This is
 * the client-side answer that makes it cheap. The ENGINE is untouched: the
 * step's presence still depends on nothing.
 *
 * ── ⚠ THE TRAP, WHICH IS WHAT MOST OF THIS FILE IS ABOUT
 *
 * A client that readies INSTANTLY moves the leak from the step's PRESENCE to
 * its TIMING. `hasteDone` was served live and public, the client paints it
 * `ready ✓` versus `…`, and an opponent watching that flip within
 * milliseconds learns exactly what the old skipped step told them. The bluff
 * toggle would then protect only the player who found it and everybody else
 * would leak by default — which is the reverse of a default-safe design.
 *
 * So R236 stops serving the OTHER seat's haste readiness while the step is
 * open (`server/view.ts`). The step's END stays public: it ends by `hasteDone`
 * going null, which no seat masks. §3 is that claim, read seat-aware off the
 * production redactor, with positive controls so a green cannot mean "the
 * assertion cannot fail".
 *
 * ── WHAT IS HERE
 *
 *   §1  THE PREDICATE. `autoHasteDone` is a READ of `legalActions`, never a
 *       re-derivation of it — R228 deleted the last hand-maintained copy of
 *       "can this player act at haste" and this must not rebuild it. §1.5
 *       proves the read by measurement over the whole card pool.
 *   §2  THE CLIENT, end to end through test/ui-driver.ts: it really sends
 *       `doneHaste`, exactly once per state, only with the preference OFF, and
 *       never when anything at all is playable.
 *   §3  THE TIMING CHANNEL, seat-aware — `viewFor` / `logFor`, never `h.log`
 *       — plus what the OPPONENT'S SCREEN really paints, and the residual this
 *       measure does NOT close (§3d, named and measured rather than assumed).
 *
 * Seeds 20500-20599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { autoHasteDone } from '../../ui/inspect.ts';
import { giveResources, logFor } from './util.ts';
import { client } from './ui-driver.ts';
import { viewFor } from '../../server/view.ts';
import type { Action, GameState, Seat } from '../src/types.ts';

/** the real client, driven — see test/ui-driver.ts (online, seat set by join) */
const ui = await client();

const A: Seat = 0, D: Seat = 1;
const PREF = 'algoBluffHaste';
const store = (globalThis as unknown as { localStorage: Storage }).localStorage;
const setBluff = (on: boolean): void => { store.setItem(PREF, on ? '1' : ''); };

/* ── the fixture ──────────────────────────────────────────────────────
 *
 * One board at the haste step, one knob per seat: what that seat is holding.
 * Resources are abundant on both sides so "can I act here" is only ever about
 * the CARD, never about the mana.
 *
 * 'Cinder Scuttler' is a printed {Haste} unit (r/1) — the one thing that is
 * playable in this step. 'Monke' is {Battle}: no timing and no grant makes it
 * playable here, which is precisely 200-haste-step-is-unconditional's pair.
 */
function board(hand0: string[], hand1: string[] = ['Monke'], seed = 20500): Harness {
  const h = new Harness(seed);
  for (const seat of [A, D]) {
    giveResources(h, seat, 'fire', 6);
    giveResources(h, seat, 'water', 6);
    giveResources(h, seat, 'metal', 6);
  }
  h.state.players[A]!.hand = [...hand0];
  h.state.players[D]!.hand = [...hand1];
  h.do({ type: 'donePlanning', seat: A });
  h.do({ type: 'donePlanning', seat: D });
  assert.deepEqual(h.state.hasteDone, [false, false],
    'the fixture is INSIDE the haste step, and R228 says it opens for both seats regardless');
  return h;
}

const legal = (h: Harness, seat: Seat): Action[] => legalActions(h.state, seat);

/* ═══ §1 — the predicate is a read of legalActions ═══════════════════ */

test('R236 §1a: preference OFF and `doneHaste` is the only legal action → ready', () => {
  const h = board(['Monke']);
  const mine = legal(h, A);
  assert.deepEqual(mine.map(a => a.type), ['doneHaste'],
    'the premise: with nothing hasteable the engine offers exactly one action');
  assert.equal(autoHasteDone(h.state, A, mine, false), true);
});

test('R236 §1b: preference ON → never, even with nothing to do', () => {
  const h = board(['Monke']);
  assert.equal(autoHasteDone(h.state, A, legal(h, A), true), false,
    'bluff haste is the player saying "I intend to sit in this step" — it outranks everything');
});

test('R236 §1c: one playable card anywhere in the list → never', () => {
  const h = board(['Cinder Scuttler']);
  const mine = legal(h, A);
  assert.ok(mine.some(a => a.type === 'playCard'),
    'the premise: a printed {Haste} unit with the mana for it is offered here');
  assert.equal(autoHasteDone(h.state, A, mine, false), false,
    'a window that offers a real choice is never answered without the player');
});

test('R236 §1d: not the haste step, or already done, or an empty list → never', () => {
  const h = board(['Monke']);
  const mine = legal(h, A);

  // already finished: the engine offers nothing and the flag says so
  const done = structuredClone(h.state);
  done.hasteDone = [true, false];
  assert.equal(autoHasteDone(done, A, [], false), false, 'nothing to answer once you are done');
  assert.equal(autoHasteDone(done, A, mine, false), false,
    'and not even a stale legal list may re-answer a step this seat has left');

  // the step is over: hasteDone is null and the phase has moved on
  const battle = structuredClone(h.state);
  battle.hasteDone = null;
  assert.equal(autoHasteDone(battle, A, mine, false), false);
  const deploying = structuredClone(h.state);
  deploying.phase = 'deploy';
  assert.equal(autoHasteDone(deploying, A, mine, false), false,
    'deployment offers plenty — this must not answer a step it is not about');

  // an empty list is "nothing here is mine", not "pass for me": R197's rule
  assert.equal(autoHasteDone(h.state, A, [], false), false);
});

test('R236 §1e: any other action alongside `doneHaste` switches it off — over the whole shape of the list', () => {
  const h = board(['Monke']);
  const base = legal(h, A);
  // Derived, not typed: every action type legalHasteActions can push, planted
  // one at a time next to the doneHaste that is always there. A new route into
  // the step (a new grant, a new cache release) is a new TYPE here and this
  // stays right without being edited.
  for (const type of ['playCard', 'applyMod', 'activateAbility', 'decide'] as const) {
    const planted = [...base, { type, seat: A } as unknown as Action];
    assert.equal(autoHasteDone(h.state, A, planted, false), false,
      `a legal ${type} in the haste step is a real choice and must reach the player`);
  }
});

test('R236 §1.5: the ONLY thing that keeps a seat in the step is a legal action — measured over the pool', () => {
  /* THE ANTI-DUPLICATION MEASUREMENT. `autoHasteDone` must agree with the
   * engine about every card in the game without knowing anything about cards.
   * So: for every printed timing in the pool, deal the card into a hand with
   * the mana to pay for it and require the client's answer to be the exact
   * negation of "the engine offered me something other than doneHaste".
   *
   * If somebody ever reintroduces a hand-maintained "is this hasteable?"
   * predicate, this is where the two copies part company. */
  const byTiming = new Map<string, string[]>();
  for (const name of allCardNames()) {
    const c = getCard(name);
    if (c.noPlayFromHand) continue;
    const list = byTiming.get(c.timing) ?? [];
    if (list.length < 6) list.push(name);           // a sample per timing, not the pool
    byTiming.set(c.timing, list);
  }
  assert.ok(byTiming.has('haste'), 'the pool really does contain printed {Haste} cards');
  let checked = 0, engaged = 0;
  for (const [, names] of byTiming) {
    for (const name of names) {
      const h = board([name], ['Monke'], 20510);
      const mine = legal(h, A);
      const engineOffers = mine.some(a => a.type !== 'doneHaste');
      assert.equal(autoHasteDone(h.state, A, mine, false), !engineOffers,
        `${name}: the client's answer must be the engine's list, negated — nothing else`);
      checked++;
      if (engineOffers) engaged++;
    }
  }
  assert.ok(checked >= 12, `only ${checked} cards sampled — the measurement has lost its reach`);
  assert.ok(engaged > 0,
    'not one sampled card kept a seat in the step: the measurement would pass on a client that '
    + 'readied through EVERYTHING, which is the failure it exists to catch');
  console.log(`    §1.5: ${checked} cards across ${byTiming.size} timings; ${engaged} keep the seat in the step`);
});

/* ═══ §2 — the client really sends it ════════════════════════════════ */

test('R236 §2a: with the preference OFF and nothing hasteable, the client sends doneHaste by itself', () => {
  setBluff(false);
  const h = board(['Monke']);
  ui.join(viewFor(h.state, A), A, legal(h, A));
  assert.deepEqual(ui.actions(), [{ type: 'doneHaste', seat: A }],
    'exactly one intent, and it is the ready — this is the whole owner instruction');
});

test('R236 §2b: it is not sent twice for the same state, and a refusal cannot loop it', () => {
  setBluff(false);
  const h = board(['Monke']);
  ui.join(viewFor(h.state, A), A, legal(h, A));
  assert.equal(ui.actions().length, 1, 'the first paint sends it');

  // the same authoritative state again (a resync, a repaint, a held update
  // surfacing): render() runs many times per server state and must not send
  // per paint
  ui.update(viewFor(h.state, A), legal(h, A));
  assert.deepEqual(ui.actions(), [], 'a second paint of the SAME state sends nothing');

  // …and the error path, which is the one that could loop: it deliberately
  // clears ui.autoAt/ui.sentFor so a HUMAN gets their refused window back.
  // An automatic answer that retried a refusal would re-send for ever.
  ui.push({ t: 'error', msg: 'you already finished the haste step' });
  ui.update(viewFor(h.state, A), legal(h, A));
  assert.deepEqual(ui.actions(), [],
    'a refusal must not re-arm the automatic ready — that is a loop, not a retry');
});

test('R236 §2c: with the preference ON the client sits in the step and offers the button', () => {
  setBluff(true);
  try {
    const h = board(['Monke']);
    const html = ui.join(viewFor(h.state, A), A, legal(h, A));
    assert.deepEqual(ui.actions(), [], 'bluff haste ON: nothing goes out on its own');
    assert.ok(ui.has({ btn: 'donehaste', p: A }),
      'and the step is the player\'s to end, with the button really on screen');
    assert.match(html, /Haste step/, 'the haste bar itself is what is painted');
  } finally { setBluff(false); }
});

test('R236 §2d: with something playable the client never answers, preference or not', () => {
  setBluff(false);
  const h = board(['Cinder Scuttler']);
  ui.join(viewFor(h.state, A), A, legal(h, A));
  assert.deepEqual(ui.actions(), [],
    'a haste card in hand is a real choice: the window stays the player\'s');
  assert.ok(ui.has({ btn: 'donehaste', p: A }), 'and they can still end the step by hand');
});

test('R236 §2e: the preference is persisted the way the client persists its others', () => {
  setBluff(false);
  const h = board(['Monke']);
  ui.join(viewFor(h.state, A), A, legal(h, A));
  ui.actions();
  // the toggle is a real affordance in the side panel, and clicking it writes
  // the same kind of localStorage entry `algoAutopass` uses
  assert.ok(ui.has({ btn: 'bluffhastetoggle' }), 'the toggle is on screen in a net game');
  ui.click({ btn: 'bluffhastetoggle' });
  assert.equal(store.getItem(PREF), '1', 'ON is persisted');
  ui.click({ btn: 'bluffhastetoggle' });
  assert.equal(store.getItem(PREF), '', 'and OFF again — one key, toggled, like algoAutopass');
  assert.equal(autoHasteDone(h.state, A, legal(h, A), false), true,
    'default (absent/empty) is OFF, which is what makes the step cheap by default');
});

/* ═══ §3 — the timing channel ════════════════════════════════════════
 *
 * ⚠ EVERY ASSERTION IN THIS SECTION IS SEAT-AWARE. Nothing reads `h.log`:
 * `Harness.absorb()` flattens every event into one seatless array, and two
 * real leaks survived 153 test files because secrecy assertions were written
 * against it (R203 / 174-secrecy-is-seat-aware). `viewFor` and `logFor` are
 * the production redactor and the production log.
 */

/** the whole of what `seat` is served, as one comparable string */
const served = (s: GameState, seat: Seat): string => JSON.stringify(viewFor(s, seat));

/** the top-level fields of the served view that differ between two boards */
function viewDiff(a: GameState, b: GameState, seat: Seat): string[] {
  const va = viewFor(a, seat) as unknown as Record<string, unknown>;
  const vb = viewFor(b, seat) as unknown as Record<string, unknown>;
  return [...new Set([...Object.keys(va), ...Object.keys(vb)])]
    .filter(k => JSON.stringify(va[k]) !== JSON.stringify(vb[k])).sort();
}

test('R236 §3a: the opponent is not served my haste readiness while the step is open', () => {
  const h = board(['Monke'], ['Cinder Scuttler']);
  const before = structuredClone(h.state);
  const logBefore = logFor(h, D);

  h.do({ type: 'doneHaste', seat: A });   // the automatic ready, at machine speed

  assert.deepEqual(h.state.hasteDone, [true, false],
    'the ENGINE knows perfectly well — nothing about the rules has changed');
  assert.equal(h.state.phase, 'planning', 'and the step is still open, because seat 1 has not finished');

  // ⚠ THE ASSERTION THIS FILE EXISTS FOR
  assert.deepEqual(viewFor(h.state, D).hasteDone, [false, false],
    'seat 1 is served "nobody is ready yet" — how fast seat 0 answered is not theirs to read');
  assert.deepEqual(logFor(h, D), logBefore,
    'and not a line of it reaches their log either');

  // POSITIVE CONTROLS: the instrument can see the thing it is claiming is
  // hidden, so a green here cannot mean "this assertion cannot fail".
  assert.deepEqual(viewFor(h.state, A).hasteDone, [true, false],
    'seat 0 still sees their OWN flag — you must be able to tell that you are done');
  assert.notEqual(served(h.state, A), served(before, A),
    'seat 0\'s own served view really did change, so the comparison is not a board against itself');
});

test('R236 §3b: the step\'s END is still public — that is what must never be hidden', () => {
  const h = board(['Monke'], ['Monke']);
  h.do({ type: 'doneHaste', seat: A });
  assert.deepEqual(viewFor(h.state, D).hasteDone, [false, false], '…while it is open');
  h.do({ type: 'doneHaste', seat: D });
  assert.equal(h.state.hasteDone, null, 'both done: the engine ends the step');
  assert.equal(viewFor(h.state, D).hasteDone, null,
    'and BOTH seats are served the end of it — the redaction hides who finished first, never that '
    + 'the step is over');
  assert.equal(viewFor(h.state, A).hasteDone, null);
  assert.equal(viewFor(h.state, D).phase, 'battle', 'the phase moved on, in public');
});

test('R236 §3c: and the opponent\'s SCREEN never paints my readiness during the step', () => {
  setBluff(false);
  const h = board(['Monke'], ['Cinder Scuttler']);
  h.do({ type: 'doneHaste', seat: A });      // seat 0 readied instantly

  // seat 1 holds a haste card, so their client sits in the step and paints the
  // per-seat ready row — the row that used to carry the tell
  const redacted = ui.join(viewFor(h.state, D), D, legal(h, D));
  ui.actions();
  assert.match(redacted, /Haste step/, 'seat 1 really is looking at the haste bar');
  assert.ok(!/ready ✓/.test(redacted),
    'THE LEAK: nobody on seat 1\'s screen is marked ready while the step is open');

  // POSITIVE CONTROL — the same client, the same markup path, handed the
  // UNREDACTED state. If `ready ✓` does not appear here then the assertion
  // above is passing for the wrong reason and proves nothing.
  const raw = ui.join(h.state, D, legal(h, D));
  ui.actions();
  assert.match(raw, /ready ✓/,
    'the client paints the tell the moment it is served one — server/view.ts is what removes it, '
    + 'not the markup');
});

test('R236 §3d: the residual, named and measured — actionCount, and nothing else', () => {
  /* ⚠ WHAT R236 DOES **NOT** CLOSE, recorded as an executable fact rather than
   * a paragraph nobody re-checks.
   *
   * `GameState.actionCount` is served live to both seats (the client's "my
   * action landed" latch depends on it — engine.ts:8888), and it increments on
   * EVERY action, so a modified client can still see that its opponent did
   * SOMETHING, and when. That channel:
   *   · is not haste-specific — it is identical in the resource step and in
   *     deployment, every hidden simultaneous segment there is;
   *   · predates R236 — a player who clicked "done" the instant the step
   *     opened already produced it;
   *   · is invisible in the shipped client, which renders nothing from it.
   * Closing it needs a per-seat action counter in the engine or in
   * server/rooms.ts (freezing it wholesale would jam the client's own latch,
   * which is measured, not guessed: `ui.sentFor` is stamped with it).
   *
   * This assertion pins the SIZE of the hole. If a future change starts
   * leaking a second field, this reddens. If somebody closes actionCount, this
   * reddens too — and the right fix then is to delete the expectation, not the
   * test. */
  const h = board(['Monke'], ['Cinder Scuttler']);
  const before = structuredClone(h.state);
  h.do({ type: 'doneHaste', seat: A });
  assert.deepEqual(viewDiff(before, h.state, D), ['actionCount'],
    'seat 1\'s served view must differ by the counter and NOTHING else while the step is open');
});
