/* Playtest round 8 — the DOM-free half of the sound system (ui/sfx.ts).
 * Bena: "notification sounds for changing of subphases or full phases, tiny
 * sound on receiving priority or needing to make a choice."
 *
 * The client re-renders everything after every action, so "the phase just
 * changed" only exists as a diff between two snapshots. These tests pin the
 * two things that decide whether the layer is useful or maddening:
 *
 *   1. that the transitions worth hearing are SEEN (phase, sub-step, priority
 *      arriving, a decision landing on you, the game ending), and
 *   2. that the ones that must stay SILENT are silent — a re-render with
 *      nothing new, a state that arrived wholesale (join/resync), priority you
 *      already held, and the opponent's decision.
 *
 * ── and since 2026-09-20, the life channel ────────────────────────────
 * Life sits OUTSIDE the one-cue contest, because it is the only thing here
 * that never arrives alone: damage lands as the damage sub-step turns, so a
 * life cue made to win a precedence contest would lose it to 'subphase' every
 * time and never once be heard. Its tests are grouped together below, and
 * ui/test/316 covers the seam between them and the screen.
 *
 * Seeds 5400-5499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { armsIdle, audibleLife, CUE_ORDER, diffSfx, lifeChanges, sfxSnap } from '../sfx.ts';
import type { Cue, SfxSnap } from '../sfx.ts';
import { pass, skipHasteStep, toDeployment } from '../../engine/test/util.ts';
import type { Seat } from '../../engine/src/types.ts';

/** a hand-built snapshot — the fields not named are the boring defaults */
const snap = (o: Partial<SfxSnap> = {}): SfxSnap => ({
  phase: 'planning', step: 'plan', mine: false,
  decision: false, decisionId: -1, over: false, life: [30, 30], ...o,
});

/** snapshot a live game as `seat` hears it */
const heard = (h: Harness, seat: Seat): SfxSnap =>
  sfxSnap(h.state, seat, h.legal(seat).length > 0);

/** fresh game → the battle phase (both plan, nobody plays a haste card) */
function toBattle(h: Harness): void {
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
}

/** walk the battle phase to its end, calling `sample` before every action —
 * the same drive util.ts finishBattle uses, opened up so we can listen */
function driveBattle(h: Harness, sample: () => void): void {
  for (let guard = 0; guard < 60 && h.state.phase === 'battle'; guard++) {
    sample();
    const b = h.state.battle!, dec = h.state.decision;
    if (dec) h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
    else if (b.step === 'declare') h.do({ type: 'declareAttack', seat: b.attacker, columns: [] });
    else if (b.step === 'blocks') h.do({ type: 'declareBlocks', seat: b.defender, blocks: {} });
    else pass(h);
  }
  sample();
}

// ── what must be heard ────────────────────────────────────────────────

test('a full phase change is a phase cue', () => {
  assert.equal(diffSfx(snap({ phase: 'planning' }), snap({ phase: 'battle', step: 'b1:declare' })), 'phase');
});

test('a sub-step change inside one phase is the quieter subphase cue', () => {
  const a = snap({ phase: 'battle', step: 'b1:declare' });
  const b = snap({ phase: 'battle', step: 'b1:blocks' });
  assert.equal(diffSfx(a, b), 'subphase');
});

test('no two perceptibly different sub-steps collide', () => {
  // the sub-step string is only ever compared for equality, so the property
  // that matters is injectivity: every combination of round, step and damage
  // sub-step the player can sit through must sound like a NEW one. A collision
  // here is a silently missing cue, which is invisible in play.
  const h = new Harness(5401);
  toBattle(h);
  const b = h.state.battle!;
  const seen = new Map<string, string>();
  const steps = ['declare', 'attackWindow', 'blocks', 'blockWindow', 'afterWindow'] as const;
  const dmg = [null, 'Swift', 'normal', 'Sluggish', 'after'] as const;
  for (const round of [1, 2] as const) {
    for (const st of steps) {
      for (const d of dmg) {
        h.state.battleRound = round;
        b.round = round; b.step = st; b.damageStep = d;
        const key = sfxSnap(h.state, 0, true).step;
        const what = `r${round}/${st}/${d ?? '-'}`;
        // the damage pump ignores `step`, so all five collapse there by design
        const canon = d ? `r${round}/damage/${d}` : what;
        const prev = seen.get(key);
        if (prev !== undefined) assert.equal(prev, canon, `${key} means both ${prev} and ${canon}`);
        seen.set(key, canon);
      }
    }
  }
  assert.equal(seen.size, 2 * (steps.length + dmg.length - 1), `got ${[...seen.keys()]}`);
});

test('an empty-board battle is narrated, without inventing steps', () => {
  const h = new Harness(5405);
  toBattle(h);
  const steps: string[] = [];
  driveBattle(h, () => {
    if (h.state.phase === 'battle') steps.push(sfxSnap(h.state, 0, true).step);
  });
  // nothing on the board: both rounds resolve straight through their declare
  assert.deepEqual([...new Set(steps)], ['b1:declare', 'b2:declare']);
});

test('priority ARRIVING is a cue; priority already held is silence', () => {
  assert.equal(diffSfx(snap({ mine: false }), snap({ mine: true })), 'priority');
  assert.equal(diffSfx(snap({ mine: true }), snap({ mine: true })), null);
});

test('a decision landing on you is a decision cue', () => {
  const a = snap({ mine: true });
  const b = snap({ mine: true, decision: true, decisionId: 7 });
  assert.equal(diffSfx(a, b), 'decision');
});

test('one decision replacing another with no gap still cues', () => {
  // a resolution chain that asks you two things in a row never shows a
  // decision-free frame between them; keying on the id catches the second
  const a = snap({ mine: true, decision: true, decisionId: 7 });
  const b = snap({ mine: true, decision: true, decisionId: 8 });
  assert.equal(diffSfx(a, b), 'decision');
  assert.equal(diffSfx(a, snap({ mine: true, decision: true, decisionId: 7 })), null);
});

test('game over outranks everything, and only fires once', () => {
  const a = snap({ phase: 'battle', step: 'b1:declare', mine: true });
  const over = snap({ phase: 'gameover', step: 'gameover', over: true });
  assert.equal(diffSfx(a, over), 'gameover');
  assert.equal(diffSfx(over, over), null);
});

// ── what must stay silent ─────────────────────────────────────────────

test('no baseline = silence (fresh join, reconnect resync, home screen)', () => {
  // the single most important case: a mid-game refresh re-renders a state
  // whose phase turned ten minutes ago, and must not announce it
  assert.equal(diffSfx(null, snap({ phase: 'battle', step: 'b1:blocks', mine: true, over: false })), null);
  assert.equal(diffSfx(null, snap({ over: true })), null);
});

test('a re-render that changed nothing audible is silent', () => {
  const a = snap({ phase: 'battle', step: 'b1:declare', mine: true });
  assert.equal(diffSfx(a, { ...a }), null);
});

test("the opponent's decision is not my decision", () => {
  const h = new Harness(5402);
  // force a decision belonging to seat 0, then listen as seat 1
  h.state.decision = { id: 1, seat: 0, kind: 'targets', prompt: 'pick', options: [] };
  const zero = sfxSnap(h.state, 0, false);
  const one = sfxSnap(h.state, 1, false);
  assert.equal(zero.decision, true, 'seat 0 owns it');
  assert.equal(one.decision, false, "seat 1 must not hear seat 0's prompt");
  assert.equal(diffSfx(snap(), one), null);
});

// ── the one-cue rule ──────────────────────────────────────────────────

test('at most one cue per diff, resolved by precedence', () => {
  // the realistic collision: the phase flips, the sub-step flips with it, and
  // priority lands on you — all from one action. Three sounds for one click is
  // the distracting failure mode; the most actionable one wins.
  const a = snap({ phase: 'planning', step: 'plan', mine: false });
  const b = snap({ phase: 'battle', step: 'b1:declare', mine: true });
  assert.equal(diffSfx(a, b), 'phase');
  // ...and a decision arriving in the same breath outranks the phase, because
  // it is the one that says "do something"
  assert.equal(diffSfx(a, { ...b, decision: true, decisionId: 3 }), 'decision');
});

test('CUE_ORDER lists every cue a diff can produce, most important first', () => {
  const produced = new Set<Cue>();
  const a = snap({ phase: 'planning', step: 'plan' });
  produced.add(diffSfx(a, snap({ over: true, phase: 'gameover', step: 'gameover' }))!);
  produced.add(diffSfx(a, snap({ decision: true, decisionId: 1 }))!);
  produced.add(diffSfx(a, snap({ phase: 'battle', step: 'b1:declare' }))!);
  produced.add(diffSfx(a, snap({ step: 'haste' }))!);
  produced.add(diffSfx(a, snap({ mine: true }))!);
  assert.deepEqual([...produced].sort(), [...CUE_ORDER].sort());
});

// ── the idle thump ────────────────────────────────────────────────────

test('the thump arms only when an obligation newly ARRIVES', () => {
  // the whole point: it catches "you looked away and missed your turn", and
  // must not nag you every 15s while you sit there thinking through a phase
  const idle = snap({ mine: false });
  assert.equal(armsIdle(idle, snap({ mine: true })), true, 'your move arrived');
  assert.equal(armsIdle(idle, snap({ mine: true, decision: true, decisionId: 2 })), true);
  assert.equal(armsIdle(snap({ mine: true }), snap({ mine: true })), false,
    'priority you already held must not re-arm — that is the nag');
  assert.equal(armsIdle(snap({ mine: true }), snap({ mine: false })), false, 'not your move');
  assert.equal(armsIdle(null, snap({ mine: true })), false, 'no baseline = no arming');
});

test('a phase change that BRINGS your move still arms the thump', () => {
  // the case that made armsIdle read the snapshots instead of the winning cue:
  // deployment ending into your planning phase moves the phase AND hands you
  // the game. 'phase' wins the precedence contest, so keying the thump off the
  // cue would leave it unarmed on the transition you are likeliest to have
  // wandered off during.
  const before = snap({ phase: 'deploy', step: 'deploy', mine: false });
  const after = snap({ phase: 'planning', step: 'plan', mine: true });
  assert.equal(diffSfx(before, after), 'phase', 'you hear the phase');
  assert.equal(armsIdle(before, after), true, '...and you still owe a move');
});

// ── the life channel ──────────────────────────────────────────────────
//
// Owner, three reports over: "it's too hard to see the life totals — it's
// small and you can't tell when it changes". Life sits OUTSIDE the one-cue
// contest above, and the tests that matter are about why.

test('a life change is not a diffSfx cue at all', () => {
  // the whole design in one assertion: diffSfx must stay blind to life, or
  // the life cue would join the precedence contest and start losing it
  const a = snap({ life: [30, 30] });
  const b = snap({ life: [23, 30] });
  assert.equal(diffSfx(a, b), null, 'the main channel hears nothing');
  assert.deepEqual(lifeChanges(a, b), [{ seat: 0, delta: -7 }]);
});

test('the life channel survives the cue that would have drowned it', () => {
  // THE CASE THE CHANNEL EXISTS FOR. Damage lands as the damage sub-step
  // turns, so a life change and a 'subphase' cue arrive in the same render,
  // every time. In one contest 'subphase' wins and the life cue is never
  // heard in the entire game.
  const a = snap({ phase: 'battle', step: 'b1:normal', life: [30, 30] });
  const b = snap({ phase: 'battle', step: 'b1:damage:normal', life: [30, 21] });
  assert.equal(diffSfx(a, b), 'subphase', 'the main channel still says what it always said');
  assert.deepEqual(lifeChanges(a, b), [{ seat: 1, delta: -9 }], '...and the life change is heard anyway');
});

test('both directions, and gains are not losses', () => {
  assert.deepEqual(lifeChanges(snap({ life: [30, 30] }), snap({ life: [33, 30] })),
    [{ seat: 0, delta: 3 }]);
  assert.deepEqual(lifeChanges(snap({ life: [30, 30] }), snap({ life: [30, 28] })),
    [{ seat: 1, delta: -2 }]);
});

test('a symmetrical trade is TWO changes, not one', () => {
  // two units trading, or an attack answered by a Resonant blocker: both
  // totals move in the same render, and both pills must flash. (Only one of
  // them is HEARD — main.ts audibleLife picks it, because two tones in one
  // breath leave you working out which was yours.)
  assert.deepEqual(lifeChanges(snap({ life: [30, 30] }), snap({ life: [26, 23] })),
    [{ seat: 0, delta: -4 }, { seat: 1, delta: -7 }]);
});

test('a re-render that did not move life is silent', () => {
  const a = snap({ life: [17, 4] });
  assert.deepEqual(lifeChanges(a, { ...a }), []);
  // ...including one where everything ELSE moved
  assert.deepEqual(lifeChanges(a, snap({ life: [17, 4], phase: 'battle', step: 'b1:declare', mine: true })), []);
});

test('no baseline = no flash: a rejoin at 12 life must not announce the 18 you missed', () => {
  // the same rule diffSfx has, and for a sharper reason: a join, a resync or
  // an undo's full-log replay would otherwise flash — and SOUND — every point
  // of damage taken before this client was watching
  assert.deepEqual(lifeChanges(null, snap({ life: [12, 30] })), []);
});

test('life is PUBLIC — the snapshot carries both seats, unlike everything else in it', () => {
  // every other field in SfxSnap is the viewer's half of the state. Life is
  // printed in both identity rows, so the flash is shown for both players and
  // the two viewers' snapshots of it agree.
  const h = new Harness(5406);
  h.state.players[0]!.life = 22;
  h.state.players[1]!.life = 5;
  assert.deepEqual(sfxSnap(h.state, 0, false).life, [22, 5]);
  assert.deepEqual(sfxSnap(h.state, 1, false).life, [22, 5], 'both viewers see both totals');
});

test('a real game moves life, and the channel sees every move of it', () => {
  // against the engine rather than hand-built snapshots: whatever the damage
  // model does, a total that ends lower than it started was SEEN falling.
  const h = new Harness(5407);
  let prev = heard(h, 0);
  const seen = new Map<Seat, number>([[0, 0], [1, 0]]);
  const start = [h.state.players[0]!.life, h.state.players[1]!.life];
  const step = (): void => {
    const now = heard(h, 0);
    for (const c of lifeChanges(prev, now)) seen.set(c.seat, (seen.get(c.seat) ?? 0) + c.delta);
    prev = now;
  };
  toBattle(h); step();
  driveBattle(h, step);
  for (const seat of [0, 1] as const) {
    assert.equal(start[seat]! + seen.get(seat)!, h.state.players[seat]!.life,
      `seat ${seat}: every point the total moved was reported`);
  }
});

test('online, you hear YOUR life and nobody else\'s', () => {
  const trade = [{ seat: 0 as Seat, delta: -4 }, { seat: 1 as Seat, delta: -7 }];
  assert.deepEqual(audibleLife(trade, 0, true), { seat: 0, delta: -4 });
  assert.deepEqual(audibleLife(trade, 1, true), { seat: 1, delta: -7 });
  // the opponent's total falling is THEIR news — you see it flash, you do not
  // hear it, and this is the assertion that keeps the two apart
  assert.equal(audibleLife([{ seat: 1, delta: -9 }], 0, true), null);
  assert.equal(audibleLife([], 0, true), null);
});

test('in hotseat both seats are one human, so the biggest change is the one heard', () => {
  // silence would be wrong (both totals are yours) and two tones in one breath
  // would be noise, so: one sound, for the swing that mattered
  const lopsided = [{ seat: 0 as Seat, delta: -1 }, { seat: 1 as Seat, delta: 12 }];
  assert.deepEqual(audibleLife(lopsided, 0, false), { seat: 1, delta: 12 });
  // ...and a symmetrical trade sounds like it hit the hand on the mouse
  const even = [{ seat: 0 as Seat, delta: -5 }, { seat: 1 as Seat, delta: -5 }];
  assert.deepEqual(audibleLife(even, 1, false), { seat: 1, delta: -5 });
  assert.deepEqual(audibleLife(even, 0, false), { seat: 0, delta: -5 });
  assert.equal(audibleLife([], 0, false), null);
});

test('one sound per render, however many pills flashed', () => {
  // the contract between the two halves, stated once: lifeChanges drives the
  // FLASHES and may return both seats; audibleLife picks at most one of them
  // to be HEARD. Nothing else in the client may play a life cue.
  const both = lifeChanges(snap({ life: [30, 30] }), snap({ life: [18, 26] }));
  assert.equal(both.length, 2, 'two pills flash');
  for (const online of [true, false]) {
    const heardOne = audibleLife(both, 0, online);
    assert.ok(heardOne && both.includes(heardOne), 'and exactly one of them is heard');
  }
});

// ── back to the idle thump ────────────────────────────────────────────

test('the game ending never arms the thump', () => {
  // nothing is owed any more; a nudge here would never stop
  const before = snap({ mine: false });
  assert.equal(armsIdle(before, snap({ phase: 'gameover', step: 'gameover', mine: true, over: true })), false);
});

// ── against a real game ───────────────────────────────────────────────

test('a real game is audibly narrated, and never twice for one change', () => {
  const h = new Harness(5403);
  const seat: Seat = 0;
  let prev = heard(h, seat);
  const cues: Cue[] = [];
  const step = (): void => {
    const now = heard(h, seat);
    const c = diffSfx(prev, now);
    prev = now;
    if (c) cues.push(c);
  };
  toBattle(h); step();
  driveBattle(h, step);
  assert.ok(cues.includes('phase'), `expected a phase cue, got ${cues}`);
  assert.ok(cues.length <= 14, `too chatty: ${cues.length} cues — ${cues}`);
  // and re-snapshotting without touching the game says nothing
  assert.equal(diffSfx(prev, heard(h, seat)), null);
});

test('the deployment phase is a phase cue, not a burst', () => {
  const h = new Harness(5404);
  const seat: Seat = 0;
  const before = heard(h, seat);
  toDeployment(h);
  const after = heard(h, seat);
  assert.equal(after.phase, 'deploy');
  assert.equal(diffSfx(before, after), 'phase');
  assert.equal(diffSfx(after, heard(h, seat)), null);
});

// ── the playback half (ui/audio.ts) ───────────────────────────────────
//
// audio.ts is DOM code, but the two things that can actually go wrong in it
// are pure timing: the thump escalating and, far more importantly, the thump
// STOPPING. A stuck timer would nudge you every 15 seconds for the rest of the
// game. Stub the two browser globals it touches and drive its real timers.

test('the idle thump escalates, holds, and stops dead when you act', async t => {
  const played: { cue: string; vol: number }[] = [];
  class FakeAudio {
    src: string; volume = 1; currentTime = 0; preload = '';
    constructor(src: string) { this.src = src; }
    load(): void {}
    play(): Promise<void> { played.push({ cue: this.src, vol: this.volume }); return Promise.resolve(); }
  }
  const store = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  g['Audio'] = FakeAudio;
  g['localStorage'] = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });   // playCue throttles on Date.now()
  // imported HERE so the stubs are in place when the module body runs
  const { armIdle, disarmIdle, idleArmed, playCue, setSoundOn } = await import('../audio.ts');

  armIdle();
  assert.equal(idleArmed(), true);
  t.mock.timers.tick(14_000);
  assert.equal(played.length, 0, 'must not thump before 15s');

  t.mock.timers.tick(1_100);
  assert.equal(played.length, 1, 'first thump at 15s');
  assert.equal(played[0]!.cue, 'sfx/thump.ogg');
  assert.equal(played[0]!.vol, 0.20);

  t.mock.timers.tick(15_000);
  assert.equal(played[1]!.vol, 0.26, 'second thump is louder');
  t.mock.timers.tick(15_000);
  assert.equal(played[2]!.vol, 0.32, 'third louder still');
  t.mock.timers.tick(15_000);
  assert.equal(played[3]!.vol, 0.32, 'and then it HOLDS — escalating forever is nagging');

  // acting disarms it permanently; only a newly arriving obligation re-arms
  disarmIdle();
  assert.equal(idleArmed(), false);
  const n = played.length;
  t.mock.timers.tick(60_000);
  assert.equal(played.length, n, 'a disarmed thump must never fire again');

  // re-arming starts the escalation over, not where it left off
  armIdle();
  t.mock.timers.tick(15_100);
  assert.equal(played[played.length - 1]!.vol, 0.20, 're-arm restarts quiet');

  // and the toggle silences it outright
  setSoundOn(false);
  assert.equal(idleArmed(), false, 'turning sound off disarms the pending thump');
  const m = played.length;
  armIdle();
  t.mock.timers.tick(60_000);
  playCue('phase');
  assert.equal(played.length, m, 'sound off = nothing plays, nothing is scheduled');
});
