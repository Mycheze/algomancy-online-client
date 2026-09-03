/* BL-18 / CT-183 — FULL CONTROL: nothing acts for you WHILE YOU HOLD CTRL.
 * THE CLIENT'S HALF.
 *
 * ⚠ THIS FILE FIRST SHIPPED AGAINST A PERSISTED TOGGLE, AND THE TOGGLE WAS THE
 * WRONG SHAPE. BL-18's `said` field was the two words *"full control"*;
 * everything else in the entry was an agent's reading of them, and this suite
 * measured the reading. Asked directly (questions-round36 Q5) the owner said:
 *
 *   "I just wanted \"Full control\" so when you're holding control, you will be
 *    given every single stop, regardless of your settings (auto pass) or
 *    yields or the haste step or anything. Even during deployment, nothing
 *    will automatically resolve if you're holding ctrl. When you let go, it
 *    goes right back to the way it was."
 *
 * MOMENTARY, NOT PERSISTENT. Every §1-§3 assertion below survived the change
 * unaltered in meaning, which is the good news and the point: the MACHINERY
 * was right — one master switch over `planAutoPass`'s inputs, relayed per seat
 * and deliberately not persisted — and only the TRIGGER was wrong. §6 is new
 * and is the trigger: the three things a toggle never had to answer.
 *
 * FOUR THINGS ACT FOR YOU and one switch has to turn all of them off:
 *
 *   1. the auto-pass preference          `algoAutopass`
 *   2. the standing Pass-all / Pass-stack promise   `ui.passMode`
 *   3. the right-click auto-yield map     `algoYield:<room>`
 *   4. the server's `forcedAction()` drain          ← NOT this file, see §5
 *
 * …and a fifth the entry does not name, which acts for you exactly as much:
 * the R236 automatic haste-step ready. It goes off with the others.
 *
 * ── WHERE THE SWITCH IS, AND WHY THERE
 *
 * `autoPassDecision` already takes all three client-side automatics as
 * INPUTS, so `planAutoPass` is the one place where switching them off is
 * switching off their inputs — there is no fourth path for one of them to
 * creep back along. The affordances go too: full control does not OFFER a
 * standing pass or an auto-yield, because it would not honour one.
 *
 * ── ⚠ TWO THINGS THIS FILE FOUND THAT THE ENTRY DID NOT SAY
 *
 * §4 measures HOLD PRIORITY rather than assuming it, and the answer is not the
 * one the entry implies. Casting does NOT keep the window in this engine:
 * `engine.ts` hands priority to the other seat the moment an item goes on the
 * stack. What IS true — and what the doneWhen line literally asks for — is
 * that the window does not CLOSE: the opponent gets a look, priority comes
 * back, and the first spell is still on the stack to respond to. MTGO-style
 * retain-priority (two spells with no look in between) would be an ENGINE
 * change to who gets priority after a cast, which is a rules decision and not
 * this lane's. §4 pins what is true today so the difference is visible.
 *
 * §5 is the fourth row, and it is the SERVER's. BL-18's own note records why:
 * `forcedAction()` lives in apply.ts but is drained by the server and the
 * hotseat `act()`, never by the engine, and engine-side auto-skip once broke
 * 242 scripted tests and was reverted. This file asserts only that the client
 * is not a drain site, so the client half can be landed and judged on its own.
 *
 * §1 THE NEGATIVE CONTROL: with the key up, nothing changes
 * §2 with it held, nothing is sent for you — including a promise made earlier
 * §3 …and nothing that acts for you is even offered
 * §4 hold priority, measured
 * §5 the drain-site census — and ⚠ the fourth row is only HALF the server's
 * §6 CT-183: the key itself — chords, blur, and letting go
 *
 * Seeds 27200-27299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();
const STORE = (globalThis as unknown as { localStorage: Storage }).localStorage;

/**
 * CT-183 — RAISE OR DROP THE HOLD, and there is no other way to do it: full
 * control is not in `localStorage` any more and has no button. This presses
 * the real key through ui/main.ts's own listener.
 */
function hold(on: boolean): void {
  ui.key('Control', on ? {} : { up: true });
}

/** set the behaviour preferences this file cares about, explicitly — they are
 * module state in the client and outlive a test */
function prefs(opts: { full: boolean; autopass?: boolean }): void {
  STORE.setItem('algoAutopass', opts.autopass === false ? '0' : '1');
  hold(opts.full);
}

/**
 * A real battle window in which THIS SEAT's only legal action is to pass — the
 * window the auto-pass preference exists for, built through the engine rather
 * than asserted into being.
 */
function passOnlyWindow(seed: number): { s: GameState; seat: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'Oorblak');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  e.player(0).hand = []; e.player(1).hand = [];
  e.settle();
  const seat = h.state.priority as Seat;
  assert.equal(seat !== null, true, 'fixture: somebody has priority in this window');
  const legal = legalActions(h.state, seat).map(a => a.type);
  assert.deepEqual(legal, ['passPriority'],
    `fixture: passing must be the ONLY legal action here, got ${legal.join(',')}`);
  return { s: h.state, seat };
}

/** put that window in front of the client and let the staggered send fire */
function present(s: GameState, seat: Seat): Action[] {
  ui.sent();                                   // forget the join traffic
  ui.join(viewFor(s, seat), seat, legalActions(s, seat));
  ui.tick();                                   // the auto-pass send is staggered
  return ui.actions();
}

/* ══ §1 — the negative control ═════════════════════════════════════════ */

test('BL-18 §1 with full control OFF, the client still passes for you exactly as before', () => {
  // doneWhen line 4: "with it off, nothing about current behaviour changes."
  // That is a claim about a real send, so it is asserted with a real send —
  // if this ever goes quiet, every "nothing was sent" below is green for the
  // wrong reason and the switch is not a switch.
  prefs({ full: false });
  const { s, seat } = passOnlyWindow(27200);
  assert.deepEqual(present(s, seat), [{ type: 'passPriority', seat }],
    'the auto-pass preference stopped working with full control OFF — either the switch is '
    + 'suppressing something it must not, or nothing here reaches the send at all');
});

/* ══ §2 — with it on, nothing is sent for you ══════════════════════════ */

test('BL-18 §2 with full control ON, the auto-pass preference sends nothing', () => {
  prefs({ full: true });
  const { s, seat } = passOnlyWindow(27201);
  assert.deepEqual(present(s, seat), [],
    'the client passed for you under full control — "never auto-anything, stop at every window '
    + 'I could act in", and this is a window with exactly one legal action, which is the case '
    + 'the entry names');
});

test('BL-18 §2 a standing Pass-all armed BEFORE the switch is not a promise it keeps', () => {
  // The master-switch claim, and the one an opt-out-per-feature design gets
  // wrong: `ui.passMode` is module state that outlives the toggle, so a
  // promise made a minute ago would go on being kept by a client the player
  // has since told to stop acting.
  prefs({ full: false, autopass: false });
  const { s, seat } = passOnlyWindow(27202);
  ui.join(viewFor(s, seat), seat, legalActions(s, seat));
  assert.ok(ui.has({ btn: 'passall' }), 'fixture: the standing-pass button is on offer');
  ui.click({ btn: 'passall' });
  ui.sent(); ui.tick(); ui.sent();
  assert.ok(ui.has({ btn: 'passallstop' }),
    'fixture: the promise is really armed — the chip that offers to stop it is on screen');

  // ⚠ `update`, not `join`: a join runs resetUi() and would wipe `ui.passMode`
  // on its own, which would make this pass without full control doing
  // anything. The arm has to survive the repaint for the drop to mean
  // something.
  prefs({ full: true });
  ui.update(viewFor(s, seat), legalActions(s, seat));
  assert.equal(ui.has({ btn: 'passallstop' }), false,
    'a Pass-all armed before full control was switched on is still armed — the switch has to '
    + 'drop the promise, not merely decline to act on it, or the chip sits there offering to '
    + 'stop something that is already stopped');
  assert.deepEqual(ui.actions(), [],
    'and nothing went out on the wire on the way through');
});

test('BL-18 §2 an auto-yield stored from before the switch does not fire either', () => {
  // the third input, reached the way a player reaches it — the card menu —
  // and then left standing across the switch
  prefs({ full: false, autopass: false });
  const h = new Harness(27204);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  const unit = spawn(h, seat, 'Oorblak');
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  const menu = ui.rightClick({ previd: unit });
  const hit = [...menu.matchAll(/data-btn="menuitem" data-i="(\d+)">([\s\S]*?)<\/button>/g)]
    .filter(m => /auto-yield/i.test(m[2]!.replace(/<[^>]*>/g, '')));
  assert.equal(hit.length, 1, 'fixture: the card menu offers an auto-yield with full control off');
  ui.click({ btn: 'menuitem', i: hit[0]![1]! });

  prefs({ full: true });
  const { s, seat: ps } = passOnlyWindow(27205);
  assert.deepEqual(present(s, ps), [],
    'a stored auto-yield is still answering for you under full control');
});

/* ══ §3 — nothing that acts for you is offered ═════════════════════════ */

test('BL-18 §3 full control offers no standing pass and no auto-yield', () => {
  const { s, seat } = passOnlyWindow(27206);

  prefs({ full: false, autopass: false });
  ui.join(viewFor(s, seat), seat, legalActions(s, seat));
  assert.ok(ui.has({ btn: 'passall' }),
    'positive control: the standing-pass button IS offered with the switch off, or the check '
    + 'below is about a button that never existed');

  prefs({ full: true });
  ui.join(viewFor(s, seat), seat, legalActions(s, seat));
  assert.equal(ui.has({ btn: 'passall' }), false,
    'full control offers a standing pass it would refuse to keep');
  assert.equal(ui.has({ btn: 'passstack' }), false, '…and the stack-scoped one too');

  // the auto-yield entry, from the menu it lives on
  const h = new Harness(27207);
  toDeployment(h);
  const ys = h.state.deployPlayer!;
  const unit = spawn(h, ys, 'Oorblak');
  ui.join(viewFor(h.state, ys), ys, legalActions(h.state, ys));
  const menu = ui.rightClick({ previd: unit });
  const items = [...menu.matchAll(/data-btn="menuitem" data-i="\d+">([\s\S]*?)<\/button>/g)]
    .map(m => m[1]!.replace(/<[^>]*>/g, ''));
  assert.ok(items.length, 'fixture: the card menu opened at all');
  assert.deepEqual(items.filter(l => /auto-yield/i.test(l)), [],
    'full control offers an auto-yield it would not honour');
});

test('BL-18 §3 the chip is on screen and says whether it is held right now', () => {
  const { s, seat } = passOnlyWindow(27208);
  prefs({ full: false });
  const off = ui.join(viewFor(s, seat), seat, legalActions(s, seat));
  assert.ok(ui.has({ chip: 'fullcontrol' }),
    'there is nothing on screen that says the feature exists — a held key with no readout is '
    + 'a feature nobody discovers');
  assert.match(off, /full control: hold Ctrl/,
    'CT-183: it says how to get it, because there is no longer anything to click');

  prefs({ full: true });
  const on = ui.join(viewFor(s, seat), seat, legalActions(s, seat));
  assert.match(on, /full control: HELD/, 'and it says so while the key is down');
  assert.match(on, /auto-pass: off \(full control\)/,
    'the auto-pass button still reads "on" while full control is overriding it — a toggle that '
    + 'reports a setting it is not honouring is worse than no toggle');
  hold(false);
});

test('BL-18 §3 the switch reaches the SERVER, on the join and on every change', () => {
  // The fourth row is drained on the server, so the server has to be told.
  // This is the client end of that wire; server/test-full-control.ts is the
  // other end. Without this the two halves could drift apart with both suites
  // green — the server honouring a flag nothing ever sets.
  prefs({ full: true });
  const { s, seat } = passOnlyWindow(27210);
  ui.sent();
  ui.join(viewFor(s, seat), seat, legalActions(s, seat));
  // (the driver's join is a server->client message; what we want is what the
  // CLIENT sends, which is its own re-join)
  ui.sent();
  hold(false);                                   // -> released
  hold(true);                                    // -> held again
  const sent = ui.sent().filter(m => m['t'] === 'fullcontrol');
  assert.deepEqual(sent.map(m => m['on']), [false, true],
    'the key put nothing on the wire — the server\'s drainForced would go on stepping the '
    + 'board along for a player who is holding Ctrl to stop it, and no test on either side '
    + 'would notice');

  // …AND ON THE JOIN, which is the half the server leans on: its copy is not
  // persisted, so a reconnect, a seat takeover or a restart re-establishes it
  // only because every join carries it. Driven through the real `sendJoin`,
  // off the waiting room's own "here is my deck now" button.
  ui.push({
    // `have: [false, …]` — this seat has NOT handed its deck in yet, which is
    // the only state in which the waiting room draws the re-join button
    t: 'joined', seat, room: 'QXZZ', waiting: { have: [false, false] },
    peers: [true, false], names: ['Ann', 'Bo'],
  });
  ui.sent();
  assert.ok(ui.has({ btn: 'deckjoin' }), 'fixture: the waiting room offers a re-join');
  ui.click({ btn: 'deckjoin' });
  const joins = ui.sent().filter(m => m['t'] === 'join');
  assert.equal(joins.length, 1, 'the re-join went out');
  assert.equal(joins[0]!['on'], true,
    'the join does not carry the switch. The server holds an UNPERSISTED copy precisely because '
    + 'the browser re-asserts it here — without this line a reconnect silently drops it and the '
    + 'board starts stepping itself along again mid-game.');
});

/* ══ §4 — hold priority, measured ══════════════════════════════════════ */

test('BL-18 §4 you can respond to your own spell with the first still on the stack', () => {
  // doneWhen line 3, and ⚠ IT IS NOT WHAT IT LOOKS LIKE. Casting does not keep
  // the window here: `engine.ts` hands priority to the other seat as soon as
  // an item goes on the stack, so "cast two in a row with nobody looking in
  // between" is FALSE today and would be an engine change. What the line
  // literally asks for is true — the window does not close, the first spell is
  // still there to respond to — and that is what is pinned here, so the
  // difference is on the record rather than in somebody's head.
  const h = new Harness(27209);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Oorblak');
  const wall = spawn(h, D, 'Prickly Protector');
  giveResources(h, D, 'wood', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  assert.equal(h.state.priority, D, 'fixture: the defender holds the window');

  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Phytochemical Protection') });
  pick(h, { unit: wall });
  assert.equal(h.state.stack.length, 1, 'the first spell is on the stack');
  assert.equal(h.state.priority, A,
    'MEASURED, and it is the finding: casting hands priority to the OPPONENT here. If this ever '
    + 'becomes D, the engine has been given MTGO retain-priority and BL-18 line 3 means something '
    + 'stronger than this test asserts');

  h.do({ type: 'passPriority', seat: A });
  assert.equal(h.state.priority, D, 'the window comes back');
  assert.equal(h.state.stack.length, 1, 'with the first spell STILL UNRESOLVED — it did not close');
  const second = give(h, D, 'Phytochemical Protection');
  assert.ok(legalActions(h.state, D).some(a => a.type === 'playCard'),
    'and a second cast is legal in it');

  h.do({ type: 'playCard', seat: D, handIndex: second });
  pick(h, { unit: wall });
  assert.equal(h.state.stack.length, 2,
    'you responded to your own spell and both are on the stack — which is the doneWhen line');
});

/* ══ §5 — the fourth row is the server's ═══════════════════════════════ */

test('BL-18 §5 both drain sites are known, and the one in this lane is guarded', () => {
  // ⚠ THE ENTRY SAYS THE FOURTH ROW IS THE SERVER'S AND IT IS ONLY HALF THE
  // SERVER'S. `forcedAction()` has TWO drain sites — BL-18's own note names
  // them both, "the SERVER and the hotseat act()" — and the hotseat one is in
  // client/ui/main.ts, i.e. in this lane. It is switched off with the rest;
  // 273 drives it. The network one is server/main.ts's `drainForced` and is
  // NOT touched here, which is why this file can land on its own.
  //
  // This section is a CENSUS, so a third drain site cannot appear unnoticed.
  const UI = new URL('../', import.meta.url);
  const uiDrains = readdirSync(UI).filter(f => f.endsWith('.ts'))
    .filter(f => /\bforcedAction\(/.test(readFileSync(new URL(f, UI), 'utf8')));
  assert.deepEqual(uiDrains, ['main.ts'],
    `the client's forced-action drain sites are now ${uiDrains.join(', ') || 'none'}. A new one `
    + 'is a new thing acting for the player, and full control has to reach it too.');

  // positive control on the name: the OTHER drain really is where the note
  // says, so "not touched here" is a statement about something that exists
  const server = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8');
  assert.match(server, /forcedAction\(/,
    'server/main.ts no longer drains forcedAction — the fourth row has moved, and this file is '
    + 'declining to touch something that is no longer there');
});

/* ══ §6 — CT-183: THE KEY ITSELF ══════════════════════════════════════ */

test('CT-183 §6 letting go goes right back to the way it was — in one keyup', () => {
  // The owner's own last sentence, and the whole difference between this and a
  // toggle: "When you let go, it goes right back to the way it was."
  prefs({ full: true });
  const a = passOnlyWindow(27211);
  assert.deepEqual(present(a.s, a.seat), [], 'held: nothing is sent for you');

  hold(false);
  const b = passOnlyWindow(27212);
  assert.deepEqual(present(b.s, b.seat), [{ type: 'passPriority', seat: b.seat }],
    'released: the auto-pass preference is back, with nothing to un-set and nothing to '
    + 'remember. A toggle needed the player to remember; a key cannot be left on');
});

test('CT-183 §6 (c) Ctrl+Z is undo, not full control — a chord does not hold', () => {
  // Control is a modifier. This client's own undo is Ctrl+Z, and the browser
  // owns Ctrl+C / Ctrl+T / Ctrl+Tab. A held-key feature that fires on all of
  // them would suppress the player's automatics every time they copied a room
  // code — invisibly, because there is nothing to un-click.
  prefs({ full: false, autopass: true });
  const { s, seat } = passOnlyWindow(27213);
  ui.join(viewFor(s, seat), seat, legalActions(s, seat));

  ui.key('Control');                       // Control goes down…
  ui.key('z', { ctrl: true });             // …and is then used as a modifier
  assert.match(ui.html(), /full control: hold Ctrl/,
    'the chord dropped the hold — Ctrl+Z is an undo, not a request for every stop');

  // …and it stays dropped while Control is still physically down, because the
  // player has not let go and pressed it again
  ui.key('Control', { repeat: true });
  assert.match(ui.html(), /full control: hold Ctrl/,
    'the auto-repeat of the still-held Control revived it: a chord latch that decays is not '
    + 'a latch, and the very next repeat would turn full control on mid-shortcut');

  ui.key('Control', { up: true });          // let go
  ui.key('Control');                        // press again, alone
  assert.match(ui.html(), /full control: HELD/,
    'and a fresh press, on its own, is the feature working');
  hold(false);
});

test('CT-183 §6 (b) alt-tabbing away is letting go — the stuck-on state a toggle cannot have', () => {
  // The browser stops sending keyup the moment the window loses focus. Without
  // this the flag sticks on forever and the player has no way at all to clear
  // it: there is no button, and pressing Control again is a no-op because it
  // is already true.
  prefs({ full: false });
  const { s, seat } = passOnlyWindow(27214);
  ui.join(viewFor(s, seat), seat, legalActions(s, seat));

  for (const leave of ['blur', 'pagehide'] as const) {
    ui.key('Control');
    assert.match(ui.html(), /full control: HELD/, `fixture: it is held before the ${leave}`);
    ui.fire(leave);
    assert.match(ui.html(), /full control: hold Ctrl/,
      `${leave} left the hold on — alt-tab away holding Ctrl and the client stops acting for `
      + 'you forever, with nothing on screen to switch off');
  }

  // the third door: the tab is hidden without the window blurring
  const doc = (globalThis as unknown as { document: { hidden: boolean } }).document;
  ui.key('Control');
  assert.match(ui.html(), /full control: HELD/, 'fixture: held');
  doc.hidden = true;
  try { ui.fire('visibilitychange'); } finally { doc.hidden = false; }
  assert.match(ui.html(), /full control: hold Ctrl/, 'a hidden tab is not a held key either');

  // NEGATIVE CONTROL: a visibilitychange that makes the tab VISIBLE must not
  // drop a hold the player is legitimately keeping
  ui.key('Control');
  ui.fire('visibilitychange');
  assert.match(ui.html(), /full control: HELD/,
    'coming back to a visible tab released it — the guard is on `hidden`, not on the event');
  hold(false);
});

test('CT-183 §6 the hold is not written to the browser, and legal.ts agrees', () => {
  // A held key has no state to remember between sessions, and a leftover
  // `algoFullControl` in storage would be a switch nothing can turn off. The
  // privacy page lists what the browser keeps and 267 derives that list from
  // these files, so the key had to leave both or neither.
  prefs({ full: true });
  assert.equal(STORE.getItem('algoFullControl'), null,
    'the hold was persisted — a browser refresh would come back with full control on and no '
    + 'way to see it, let alone clear it');
  hold(false);

  // the same two shapes 267 derives its list from — a comment saying the key
  // is gone is fine and is in fact where the reason is written down
  const src = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  assert.equal(/localStorage\.\w+\(\s*'algoFullControl'/.test(src), false,
    'ui/main.ts still reads or writes the key');
  assert.equal(/^const \w+ = 'algoFullControl';/m.test(src), false,
    '…or hoists it to a constant');
  const legal = readFileSync(new URL('../legal.ts', import.meta.url), 'utf8');
  assert.equal(/algoFullControl/.test(legal), false,
    'the privacy page still tells people the browser keeps a key it no longer keeps');
});
