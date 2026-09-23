/* R170 / CT-46 — THE HOTSEAT DECISION GATE, ONE LAYER ABOVE R154.
 *
 * R154 taught `apply()` and `legalActions()` that a decision belongs to a
 * SEAT: inside a hidden simultaneous segment, and where answering it will not
 * rewind the world, the seat that is NOT being asked may carry on deploying.
 * It stopped, deliberately, at the engine — and said so itself (digital-rules
 * R154 §"FOR THE OWNER" 3): *"The hotseat UI is still gated, one layer above
 * this."*
 *
 * ⚠ THE FIRST THING THIS FILE DOES IS DISBELIEVE ITS OWN TICKET. The last
 * round's near-miss on a client ticket was a brief that said "suspect the
 * presentation layer" when the RULES layer was doing the refusing — un-gating
 * the UI there would have turned a frozen screen into a screen full of
 * refusals. So §0 proves, before anything is un-gated, that the engine really
 * does OFFER and really does ACCEPT the actions the client is about to draw.
 *
 * §0  THE RULES LAYER FIRST. Offered by `legalActions`, accepted by `apply()`.
 * §1  THE BUG, ON SCREEN. The free seat's deployment bar and its "done
 *     deploying" button, and a hand click that actually plays the card.
 *     Measured before the fix: ONE bar (the asker's), no done button anywhere,
 *     and the free seat's hand card still wearing its green `playable` ring —
 *     drawn live, taking clicks, doing nothing.
 * §2  THE ASKER. Still gets its own question, still cannot act around it.
 * §3  THE NEGATIVE CONTROLS — R154's cases 2 and 3 are UI-visible too: a
 *     battle question and a rewinding (snapshot) question still freeze the
 *     whole screen. Widen the gate by accident and these go red.
 * §4  BOTH SEATS AT ONCE. It cannot happen: `GameState.decision` is a single
 *     slot, and R154's after-the-fact fingerprint refuses the action that
 *     would take it. Asserted directly, including what the client says.
 * §5  ONLINE, NOTHING CHANGES. `server/view.ts` nulls a decision that is not
 *     yours, so a net client's `s.decision` is always its own — the online
 *     client never had to make this distinction and still does not. Half of
 *     this is a property of `viewFor`; the other half drives the real online
 *     client (in a child process, because a process gets one ui/main.ts).
 *
 * HOW THE CLIENT IS DRIVEN. test/ui-driver.ts, in its hotseat mode: a fake DOM
 * and NO socket, main.ts's own `Harness`, and clicks through main.ts's own
 * handlers. Nothing here reads ui/main.ts as source text — two tests that did
 * broke last round on a pure refactor while the invariant they were about held
 * perfectly. Every assertion below is about markup the client really produced
 * or a click it really took.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Harness } from '../../engine/src/harness.ts';
import { apply, decisionBlocks, hiddenSegment, legalActions, IllegalAction } from '../../engine/src/apply.ts';
import { registerSynthetic } from '../../engine/src/cards/dsl.ts';
import { viewFor } from '../../server/view.ts';
import { give, spawn } from '../../engine/test/util.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';

/* ── the client, hotseat ─────────────────────────────────────────────── */
// set BEFORE the driver is imported, and the import must therefore be dynamic:
// a static one is hoisted and would run the driver (and ui/main.ts with it)
// before this line ever executed.
const { local } = await import('./ui-driver.ts');
const ui = local();

/** how many prompt bars the board is showing */
const bars = (html: string): number => (html.match(/<div class="promptbar/g) ?? []).length;

/* ── fixtures ────────────────────────────────────────────────────────── */

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

/** A free deployment spell, so "seat 1 can still deploy" is a real play and
 * not a resource fixture that might drift. Gaining life is the receipt. */
const FREE = 'R170 Free Deploy';
registerSynthetic({
  name: FREE, cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Gain 1 life.',
}, { spellEffect: { run: (g, ctx) => { g.gainLife(ctx.controller, 1, FREE); } } });

/** …and one that ASKS, for §3's rewind control and §4's clobber. */
const ASKS = 'R170 Halt And Ask';
registerSynthetic({
  name: ASKS, cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Gain 1 life, then ask.',
}, {
  spellEffect: {
    run: (g, ctx) => {
      g.gainLife(ctx.controller, 1, ASKS);
      ctx.choose('halt', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: `${ASKS}: carry on?`, options: [{ label: 'yes', value: 0 }],
      });
    },
  },
});

/** A unit with a FREE activated ability, for the other input path a hidden
 * segment has: the board. Clicking a unit is how an ability is used, and it
 * was gated by the same pre-R154 `!s.decision`. */
const PUMP = 'R170 Free Pump';
registerSynthetic({
  name: PUMP, cost: '', mana: 0, power: 1, toughness: 4,
  type: 'Test Unit', kind: 'unit', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: ': Gain 1 life.',
}, {
  abilities: [{
    type: 'activated', cost: {}, label: 'gain 1 life',
    effect: { run: (g, ctx) => { g.gainLife(ctx.controller, 1, PUMP); } },
  }],
});

/** …and a BATTLE-timed one that asks in the CAST window, i.e. the same
 * suspension kind §1 lets straight through in deployment. §3's battle control
 * needs that: with a mid-resolution suspension instead it would pass for the
 * wrong reason (blocked by the rewind rule, not the phase rule) and stay green
 * if the phase rule were deleted. */
const BATTLE_ASKS = 'R170 Battle Ask';
registerSynthetic({
  name: BATTLE_ASKS, cost: '', mana: 0, power: 0, toughness: 0,
  type: 'Test Spell', kind: 'spell', timing: 'battle', attrs: [],
  virus: false, burst: false, augmentAttrs: [], image: '',
  text: 'Choose a half. [Battle]',
}, {
  spellEffect: {
    modes: {
      key: 'mode',
      prompt: () => `${BATTLE_ASKS}: which half?`,
      options: () => [{ label: 'left', value: 'l' }, { label: 'right', value: 'r' }],
    },
    run: () => { /* the question is the whole point */ },
  },
});

/** Turn 1 into DEPLOYMENT with `n` Wraiths on `seat` — their start-of-
 * deployment triggers are what raises a real question for that seat, with more
 * of the pile still queued behind it. Same fixture shape as R154's own tests
 * (130-seat-aware-gate), deliberately: this file is about the layer above it. */
function deployment(seat: Seat, n: number): Harness {
  const h = new Harness(424242);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) {
    if (h.state.hasteDone && !h.state.hasteDone[s]) h.do({ type: 'doneHaste', seat: s });
  }
  for (let i = 0; i < n; i++) spawn(h, seat, 'Wraith');
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') {
    h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  }
  return h;
}

/** the state §1/§2 are about: seat 0 suspended on its own trigger pile inside
 * deployment, seat 1 free and holding one free thing to play */
function askedSeat0(): { state: GameState; hand1: number; hand0: number } {
  const h = deployment(0, 3);
  const hand1 = give(h, 1, FREE);
  const hand0 = give(h, 0, FREE);
  assert.equal(h.state.phase, 'deploy');
  assert.equal(hiddenSegment(h.state), 'deploy');
  assert.equal(h.state.decision?.seat, 0, 'the fixture really does suspend seat 0');
  assert.equal(h.state.suspension?.type, 'cast', 'and on a cast-time suspension (no R85 snapshot)');
  return { state: h.state, hand1, hand0 };
}

/* ═══ §0 THE RULES LAYER FIRST ════════════════════════════════════════ */

test('R170 §0: the rules layer really does offer AND accept what the client is about to draw', () => {
  const { state, hand1 } = askedSeat0();

  // OFFERED. If this were empty the ticket would be mis-filed and the fix
  // would be a screen full of refusals, not a screen that works.
  const legal = legalActions(state, 1);
  assert.ok(legal.some(a => a.type === 'doneDeploying'),
    'seat 1 is offered its own end-of-deployment while seat 0 is mid-pile');
  assert.ok(legal.some(a => a.type === 'playCard' && a.handIndex === hand1),
    'and the play of a card from its own hand');

  // ACCEPTED. Both halves, in that order — either alone is a half-fix.
  const r = apply(state, { type: 'playCard', seat: 1, handIndex: hand1 });
  assert.equal(r.state.players[1]!.life, state.players[1]!.life + 1, 'apply() really ran it');
  assert.equal(r.state.decision?.seat, 0, "and left seat 0's question exactly where it was");

  // and the other side of the same coin: the ASKING seat is still gated
  assert.ok(decisionBlocks(state, 0) && !decisionBlocks(state, 1),
    'the engine gate is seat-aware — which is the whole premise of this file');
});

/* ═══ §1 THE BUG, ON SCREEN ═══════════════════════════════════════════ */

test('R170 §1: with both seats on screen the seat NOT being asked is offered its deployment affordances', () => {
  const { state, hand1 } = askedSeat0();
  const html = ui.show(structuredClone(state));

  // BEFORE THE FIX this was 1: `promptHtml` returned the pending decision's
  // bar whenever ANY decision was open, whoever owned it, and the deployment
  // bar — the one carrying "done deploying" — was simply never reached.
  assert.equal(bars(html), 2,
    'the question is on top and the free seat\'s own bar is under it, not instead of it');
  assert.match(html, /Deployment/, 'and the bar under it really is the deployment bar');

  assert.ok(ui.has({ btn: 'donedeploy', p: 1 }),
    'seat 1 is offered its "done deploying" button — the affordance R154 made legal');
  assert.ok(ui.has({ act: 'hand', p: 1, i: hand1 }),
    'and its hand card is on the board');
});

test('R170 §1: and the affordance is real — the free seat\'s hand click plays the card', () => {
  const { state, hand1 } = askedSeat0();
  ui.show(structuredClone(state));
  const life = ui.state().players[1]!.life;

  // ⚠ THE WORST HALF OF THE BUG, and the reason "is it on screen" is not
  // enough on its own: `handHtml` draws playability from `legalFor`, which was
  // never gated, so the card kept its green `playable` ring the whole time.
  // The click handler was the thing that returned on a bare `s.decision`. A
  // live-looking card that silently eats clicks is worse than a dead one.
  assert.match(ui.html(), /class="card playable" data-act="hand" data-p="1"/,
    'the card is drawn playable…');
  ui.click({ act: 'hand', p: 1, i: hand1 });
  assert.equal(ui.state().players[1]!.life, life + 1, '…and clicking it PLAYS it');
  assert.equal(ui.state().decision?.seat, 0, "while seat 0's question stands untouched");
});

test('R170 §1: ending the free seat\'s deployment goes through, from the button on screen', () => {
  const { state } = askedSeat0();
  ui.show(structuredClone(state));
  ui.click({ btn: 'donedeploy', p: 1 });
  assert.equal(ui.state().deployDone?.[1], true, 'seat 1 really is done deploying');
  assert.equal(ui.state().decision?.seat, 0, 'and seat 0 is still being asked');
});

test('R170 §1: the free seat\'s other two deployment inputs work too — its board and its cache', () => {
  // The hand is not the only way to spend a deployment. Both of these were
  // gated on the same pre-R154 "any decision at all", and both are things a
  // player does every single deployment step.
  const h = deployment(0, 3);
  const unit = spawn(h, 1, PUMP);
  // R45 glimpse: a cached card playable this turn, for its (zero) mana
  h.state.players[1]!.cache = [{ card: FREE, uid: 90001, playableUntilTurn: h.state.turn }];
  assert.equal(h.state.decision?.seat, 0, 'seat 0 is the one being asked');

  ui.show(structuredClone(h.state));
  const life = ui.state().players[1]!.life;
  ui.click({ act: 'unit', id: unit });
  assert.equal(ui.state().players[1]!.life, life + 1,
    'the ability on seat 1\'s own unit fires from a click on the board');

  ui.click({ btn: 'cacheopen', p: 1 });   // the cache is played from its dialog
  ui.click({ act: 'cache', p: 1, i: 0 });
  assert.equal(ui.state().players[1]!.life, life + 2,
    'and the glimpsed card in seat 1\'s cache can still be played out of it');
  assert.equal(ui.state().decision?.seat, 0, 'with seat 0 still holding the only open question');
});

/* ═══ §2 THE ASKER ════════════════════════════════════════════════════ */

test('R170 §2: the seat being asked still gets its own decision bar, and no way around it', () => {
  const { state, hand0 } = askedSeat0();
  const html = ui.show(structuredClone(state));

  assert.match(html, /data-btn="decide"/, 'seat 0 is shown its question, with answers to click');
  assert.match(html, /Wraith/, 'and the bar names what is asking');
  assert.ok(!ui.has({ btn: 'donedeploy', p: 0 }),
    'but NOT a "done deploying" button — R65: only decide and concede get past your own '
    + 'question, and a button apply() would throw on is the refusal-screen half-fix');

  const life = ui.state().players[0]!.life;
  ui.click({ act: 'hand', p: 0, i: hand0 });
  assert.equal(ui.state().players[0]!.life, life,
    'and its own hand is still inert — the gate did not simply come off');
});

/* ═══ §3 NEGATIVE CONTROLS — R154's other two cases, on screen ════════ */

test('R170 §3: a rewinding (snapshot) question still freezes the whole screen', () => {
  // R154 case 3: a 'resolve' suspension carries an R85 whole-GameState
  // snapshot and answering it does `this.s = snap`, so anything the other seat
  // did in that window is ERASED. The engine keeps the full gate there — and
  // so must the screen, or it offers a move that later un-happens.
  const h = deployment(1, 0);
  assert.equal(h.state.decision, null, 'no Wraiths, so deployment opens quietly');
  h.do({ type: 'playCard', seat: 1, handIndex: give(h, 1, ASKS) });
  const sus = h.state.suspension as { type: string; snapshot?: GameState };
  assert.equal(sus.type, 'resolve', 'seat 1 stopped HALFWAY through a resolution');
  assert.ok(sus.snapshot, 'carrying the snapshot that makes this case different');
  assert.ok(decisionBlocks(h.state, 0), 'so the ENGINE still refuses seat 0');

  const html = ui.show(structuredClone(h.state));
  assert.equal(bars(html), 1, 'and the screen shows the question alone, as before R154');
  assert.ok(!ui.has({ btn: 'donedeploy', p: 0 }),
    'seat 0 is offered nothing the engine would refuse');
});

test('R170 §3: a BATTLE question still freezes the whole screen', () => {
  // R154 case 2: in battle priority is sequential and an opponent
  // mid-resolution genuinely does hold the game. A real battle, a real
  // priority window, and the same CAST-time suspension §1 lets straight
  // through in deployment — so the only thing that can differ is the phase.
  const h = new Harness(424242);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  for (const s of [0, 1] as Seat[]) {
    if (h.state.hasteDone && !h.state.hasteDone[s]) h.do({ type: 'doneHaste', seat: s });
  }
  assert.equal(h.state.phase, 'battle');
  const atk = h.state.battle!.attacker;
  h.do({ type: 'declareAttack', seat: atk, columns: [[spawn(h, atk, 'Wraith')]] });
  const caster = h.state.priority!;
  h.do({ type: 'playCard', seat: caster, handIndex: give(h, caster, BATTLE_ASKS) });
  assert.equal(h.state.phase, 'battle');
  assert.equal(h.state.decision?.seat, caster);
  assert.equal(h.state.suspension?.type, 'cast', 'on a cast-time suspension, as in §1');
  assert.equal(hiddenSegment(h.state), null, 'battle is no hidden simultaneous segment');
  assert.ok(decisionBlocks(h.state, other(caster)), 'so the engine blocks the idle seat');

  const html = ui.show(structuredClone(h.state));
  assert.equal(bars(html), 1, 'one bar: the question, and nothing offered underneath it');
  assert.ok(!ui.has({ btn: 'pass' }),
    'the idle seat gets no Pass button — the priority bar is exactly what R154 case 2 keeps shut');
});

/* ═══ §4 BOTH SEATS AT ONCE ═══════════════════════════════════════════ */

test('R170 §4: both seats can never have a question open — the slot is single, and the second is refused', () => {
  // The brief asked what happens if both seats have a decision open. Nothing
  // does: `GameState.decision` is ONE SLOT and `E.suspend` writes it
  // unconditionally, which is precisely why R154 pairs its permissive gate
  // with an after-the-fact fingerprint — without it seat 1's play would
  // OVERWRITE seat 0's open question and take the suspension with it.
  const { state } = askedSeat0();
  const h = new Harness(424242);
  h.state = structuredClone(state);
  const asked = structuredClone(h.state.decision!);
  const idx = give(h, 1, ASKS);

  assert.throws(() => h.do({ type: 'playCard', seat: 1, handIndex: idx }),
    (e: unknown) => e instanceof IllegalAction && /disturb the decision pending/.test(e.message),
    'the engine refuses by name rather than clobbering');
  assert.deepEqual(h.state.decision, asked, "seat 0's question is untouched");

  // …and the client says so, without losing either bar. `act()` catches
  // IllegalAction into `uiError`, so the refusal is TOLD, never silent.
  ui.show(structuredClone(h.state));
  ui.click({ act: 'hand', p: 1, i: idx });
  const html = ui.html();
  assert.match(html, /disturb the decision pending/,
    'the screen names the refusal instead of just doing nothing');
  assert.equal(bars(html), 2, 'both bars survive it');
  assert.equal(ui.state().decision?.seat, 0, 'and there is still exactly one open question');
});

/* ═══ §5 ONLINE, NOTHING CHANGES ══════════════════════════════════════ */

test('R170 §5: ONLINE the state that drives this branch cannot even reach the client', () => {
  // THE REASON the whole change is a no-op online, and the reason the online
  // client never had to make this distinction: server/view.ts nulls a decision
  // that is not yours before it goes on the wire. HOTSEAT is the only caller
  // that can see both seats at once.
  const { state } = askedSeat0();
  const theirs = viewFor(state, 1);
  assert.equal(theirs.decision, null, 'seat 1 is never shown seat 0\'s question…');
  assert.equal(theirs.suspension, null, '…nor the suspension carrying its private options');
  const mine = viewFor(state, 0);
  assert.equal(mine.decision?.seat, 0, 'while the seat being asked still gets it');
});

test('R170 §5: ONLINE the real client still draws exactly one bar over its own question', () => {
  // A process gets one ui/main.ts (module cache) and this one is hotseat, so
  // the online client is driven in a child. It is the SAME driver and the same
  // main.ts — only the URL differs, which is the only thing that differs
  // between the two callers in the first place.
  const { state } = deployment(0, 3) as unknown as { state: GameState };
  const view = viewFor(state, 0);
  const legal = legalActions(state, 0);
  const src = `
    import { readFileSync } from 'node:fs';
    const { view, legal } = JSON.parse(readFileSync(0, 'utf8'));
    const { client } = await import('./ui-driver.ts');
    const ui = await client();
    const html = ui.join(view, 0, legal);
    process.stdout.write('###' + JSON.stringify({
      bars: (html.match(/<div class="promptbar/g) || []).length,
      decide: /data-btn="decide"/.test(html),
      done0: /data-btn="donedeploy" data-p="0"/.test(html),
      done1: /data-btn="donedeploy" data-p="1"/.test(html),
    }));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', src], {
    cwd: import.meta.dirname, input: JSON.stringify({ view, legal }), encoding: 'utf8',
  });
  const got = JSON.parse(out.slice(out.indexOf('###') + 3)) as Record<string, unknown>;
  assert.equal(got['bars'], 1,
    'ONE bar, exactly as before R170 — the online client is handed only its own question, '
    + 'so it must never grow the second bar hotseat grew');
  assert.equal(got['decide'], true, 'and that bar is the question, with answers to click');
  assert.equal(got['done0'], false, 'no done-deploying button for the seat being asked…');
  assert.equal(got['done1'], false, '…and none for the opponent either (never was, net mode)');
});
