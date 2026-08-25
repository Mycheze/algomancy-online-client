/**
 * R153 / CARD-TODO #43 — THE DISPOSAL TAIL IS ONE PRIMITIVE.
 *
 * When something leaves PLAY for a bin, exactly one sequence runs: push the
 * nontoken mods into their owners' bins (remembering the slot each landed at),
 * push the body into its bin (same), announce the departure, trash the body and
 * then each mod ANCHORED on the entity it was (R70), sweep the lot back out
 * highest-index-first if the body is {Unstable} (R137/R140/R145) or just the
 * body if it is a token (R69), file the TOKEN mods on the public erased pile
 * (R65) since they never reached a bin to be swept from, and delete the mod
 * entities last so the announce window can still read them.
 *
 * That is `E.disposeToBin`. It exists because the sequence was hand-copied and
 * every copy drifted: Hooba-Mon's `exchangeInPlace` logged a despawn it never
 * fired, deleted its mods with no bin and no trash, and skipped a token body's
 * bin entirely — three separate defects, two repair rounds (R146, R152), one
 * sequence. `E.destroy` and `exchangeInPlace` now call the same method.
 *
 * WHAT THIS FILE IS FOR, and how it differs from 42-dark-b's Hooba-Mon block:
 * 42-dark-b pins the RULINGS (R137/R140/R145/R146/R152) from the card's side
 * and must keep passing untouched. This file pins the SHARING — that there is
 * one implementation and both routes go through it — plus the disposal cases a
 * card-level test reaches most cheaply through Hooba-Mon. Seeds are 12900+, so
 * nothing here can collide with the dark-b batch's 4200 band.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { ent, give, giveResources, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { DecisionOption, EngineEvent, EntityId, Seat } from '../src/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── harness plumbing (same shapes 42-dark-b uses; kept local so this file
//    stands alone and neither file's helpers can drift under the other) ──

/** Run raw engine calls against the harness state, absorbing a suspension and
 * keeping the harness log honest (trash assertions read h.events). */
function withE(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  try {
    fn(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
  h.events.push(...e.events);
  for (const ev of e.events) h.log.push(ev.msg);
}

/** Drive everything pending to a standstill. */
function resolveAll(h: Harness, choose: (o: DecisionOption) => boolean = () => true): void {
  let guard = 120;
  while (guard-- > 0) {
    const dec = h.state.decision;
    if (dec) {
      if (dec.pickOrder) {
        h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
        continue;
      }
      const i = dec.options.findIndex(choose);
      h.do({ type: 'decide', seat: dec.seat, choice: i === -1 ? 0 : i });
      continue;
    }
    if (h.state.phase === 'battle' && h.state.stack.length) { pass(h); continue; }
    return;
  }
  throw new Error('resolveAll did not terminate');
}

/** answer the pending decision by picking the option matching a target ref */
function pickRef(h: Harness, ref: unknown): void {
  const dec = h.state.decision!;
  const i = dec.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify(ref));
  if (i === -1) throw new Error(`no option matching ${JSON.stringify(ref)}`);
  h.do({ type: 'decide', seat: dec.seat, choice: i });
}

const trashes = (h: Harness): EngineEvent[] => h.events.filter(ev => ev.type === 'trashed');
const trashesOf = (h: Harness, card: string): EngineEvent[] =>
  trashes(h).filter(ev => ev.data!['card'] === card);
const binOf = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.bin;
const erasedOf = (h: Harness, seat: Seat): string[] => new E(h.state).erased(seat);
const countIn = (xs: string[], name: string): number => xs.filter(x => x === name).length;
/** the ordered verbs a single card got, across trash and erase */
const verbsFor = (h: Harness, card: string): string[] => h.events
  .filter(ev => (ev.type === 'trashed' || ev.type === 'erased') && ev.data!['card'] === card)
  .map(ev => ev.type);

/**
 * Attack with `host` and take Hooba-Mon's exchange, swapping the host out for
 * `pick` — a real card seeded into A's bin so the trigger has a legal target.
 * Every case below is this same drive; only the host's build differs.
 */
function exchangeAway(h: Harness, A: Seat, host: EntityId, pick: string): void {
  binOf(h, A).push(pick);          // a real card: a bin never holds a token (R152)
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  pickRef(h, { bin: { seat: A, card: pick } });
  resolveAll(h);
}

// ══════════════════════════════════════════════════════════════════════
// (i) the plain case — no mods, not a token: the body BINS and STAYS
// ══════════════════════════════════════════════════════════════════════
//
// The disposal's default branch, and the control for every sweep below: with
// nothing to make the body {Unstable} and no tokenhood, the tail stops at the
// trash. A test suite that only ever exercised the erase branches would not
// notice a sweep that had started firing unconditionally.
test('R153 (i): a plain exchanged body is binned and trashed, and is NOT swept', () => {
  const h = new Harness(12900);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  // played normally, Hooba-Mon's text-box [Augment] is live on itself, so the
  // exchanging body is Hooba-Mon: no mods, no stamp, no printed {Unstable}
  const hooba = spawn(h, A, 'Hooba-Mon');
  exchangeAway(h, A, hooba, 'Skittering Blight');

  assert.equal(ent(h, hooba), undefined, 'the body left play');
  assert.ok(binOf(h, A).includes('Hooba-Mon'), 'and is sitting in its owner’s bin');
  assert.equal(trashesOf(h, 'Hooba-Mon').length, 1,
    'a bin entered FROM PLAY is a trash, exactly once (R40)');
  assert.equal(countIn(erasedOf(h, A), 'Hooba-Mon'), 0,
    'nothing made it Unstable and it is not a token — the sweep must not run');
  assert.deepEqual(verbsFor(h, 'Hooba-Mon'), ['trashed'], 'trash, and nothing after it');
  assert.ok(Object.values(h.state.entities).some(e => e.card === 'Skittering Blight'),
    'and the exchange itself happened — the picked card is in play');
});

// ══════════════════════════════════════════════════════════════════════
// (ii) NONTOKEN mods — the despawn FIRES, and each mod bins to ITS OWN owner
// ══════════════════════════════════════════════════════════════════════
//
// Two facts a hand-copy got wrong and one it could still get wrong:
//
//  · R152(1) — the despawn used to be LOGGED and never FIRED, so every
//    "whenever a unit despawns" ability in the game was blind to an exchange.
//    A THIRD-PARTY watcher is the only honest proof of firing: a log line is
//    what the broken version already produced.
//  · R137/R70 — a nontoken mod enters a bin from play and is TRASHED there,
//    anchored on the mod entity.
//  · and the bin it enters is ITS OWN OWNER'S, not the body's. The mod here is
//    GRAFTED BY THE OPPONENT, so the two answers are different seats and the
//    assertion can tell them apart.
test('R153 (ii): nontoken mods — the despawn fires, and each mod trashes to its OWN owner’s bin', () => {
  const h = new Harness(12901);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const host = spawn(h, A, 'Rune Channeler');
  giveResources(h, A, 'dark', 6);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hooba-Mon'), hostId: host });
  // an OPPONENT-owned mod on A's unit: `byPlayer` is the owner, and R137 says
  // the mod goes to that owner's bin — not to the body's. Chitin Shredder is
  // chosen for having NO text at all: a mod with a "when I am trashed" trigger
  // (Nothyr negates a nonspell effect) would answer the watcher assertion below
  // by cancelling it, which is a different fact than the one under test.
  withE(h, e => { e.attachMod(e.entity(host)!, 'Chitin Shredder', D, 'graft'); });
  // Demon of the Depths: "[Augment] Whenever one of your units despawns, I deal
  // 1 damage to any target." Its carrier has to stand in the battle region for
  // R12 to let it hear the event, so it attacks in its own column.
  const carrier = spawn(h, A, 'Good Whale');
  withE(h, e => { e.attachMod(e.entity(carrier)!, 'Demon of the Depths', A, 'augment'); });

  binOf(h, A).push('Skittering Blight');
  toNextBattle(h, A);
  const lifeD = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[host], [carrier]] });
  pickRef(h, { bin: { seat: A, card: 'Skittering Blight' } });   // Hooba-Mon's pick
  // …and the Demon's "any target", aimed at the defending player so its 1
  // damage is visible as a life total rather than as a log line
  resolveAll(h, o => JSON.stringify(o.value) === JSON.stringify({ player: D }));

  assert.equal(ent(h, host), undefined, 'the host left play');
  assert.equal(trashesOf(h, 'Chitin Shredder').length, 1,
    'the mod entered a bin FROM PLAY, so R40 trashed it (R137)');
  assert.equal(trashesOf(h, 'Chitin Shredder')[0]!.data!['seat'], D,
    'and the bin it entered is the MOD OWNER’s, not the body owner’s');
  assert.equal(trashesOf(h, 'Hooba-Mon').length, 1,
    'Hooba-Mon is a nontoken mod on this line too and takes the same route');
  // R152(1): FIRED, not merely logged — a log line is what the broken version
  // already produced, so only a listener having run proves anything
  assert.ok(h.events.some(ev => ev.type === 'despawned' && ev.data!['card'] === 'Rune Channeler'),
    'the departure was announced…');
  assert.equal(h.state.players[D]!.life, lifeD - 1,
    '…and a third-party despawn watcher actually RAN. A log line is what the R146 code already '
    + 'produced (it logged the despawn and never fired it), so only a listener having run proves '
    + 'anything here.');
});

// ══════════════════════════════════════════════════════════════════════
// (iii) an {Unstable} body — swept with its mods, HIGHEST INDEX FIRST
// ══════════════════════════════════════════════════════════════════════
//
// A body wearing mods is {Unstable} by derivation (R69/R79), so R137's sweep
// takes it and every nontoken mod back out of the bin it was just trashed in.
//
// R140 is why the order is descending, and TWO MODS OF THE SAME CARD is the
// only shape that can tell the difference — the case this test exists for.
// They land at consecutive slots in one bin. Erase the LOWER one first and the
// higher one slides down under the index recorded for it; the sweep then finds
// a named slot that no longer holds that card, treats it as already gone (it
// deliberately does not fall back to a name search, because falling back is how
// an innocent older copy gets eaten) and the second mod SURVIVES in the bin,
// recurrable. Descending order never disturbs an index still to be used.
test('R153 (iii): an Unstable body is swept with its mods — including TWO MODS OF ONE CARD in one bin', () => {
  const h = new Harness(12902);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Rune Channeler');
  giveResources(h, A, 'dark', 6);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hooba-Mon'), hostId: host });
  // TWO copies of ONE card, both owned by A, so both land in A's bin at
  // consecutive slots — the only configuration the descending order is for
  withE(h, e => {
    e.attachMod(e.entity(host)!, 'Nothyr', A, 'augment');
    e.attachMod(e.entity(host)!, 'Nothyr', A, 'augment');
  });

  exchangeAway(h, A, host, 'Skittering Blight');

  const bin = binOf(h, A), erased = erasedOf(h, A);
  assert.equal(countIn(bin, 'Nothyr'), 0,
    'BOTH copies left the bin — erasing the lower slot first would strand the second one here');
  assert.equal(countIn(erased, 'Nothyr'), 2, 'and both reached the public erased pile (R65)');
  assert.equal(countIn(bin, 'Rune Channeler'), 0, 'the Unstable body is not left in the bin either');
  assert.ok(erased.includes('Rune Channeler'), 'it reached the erased pile');
  assert.ok(!bin.includes('Hooba-Mon') && erased.includes('Hooba-Mon'),
    'and so did the mod that did the exchanging');
  // ORDER is the other half: each was trashed on the way IN and swept
  // afterwards, never "skipped the trash"
  assert.deepEqual(verbsFor(h, 'Rune Channeler'), ['trashed', 'erased'],
    'R137 ordering for the body: bin → trashed → swept');
  assert.deepEqual(verbsFor(h, 'Nothyr'), ['trashed', 'trashed', 'erased', 'erased'],
    'and for both mods: both trashed in the bin, then both swept out of it');
});

// ══════════════════════════════════════════════════════════════════════
// (iv) a TOKEN body with NO mods — the `else if (token)` branch on its own
// ══════════════════════════════════════════════════════════════════════
//
// The one way to reach the token sweep WITHOUT the Unstable sweep: a token
// carrying no mod at all, whose FACE is Hooba-Mon (R118 layer 0) so its own
// text-box [Augment] is what exchanges. A token host WEARING Hooba-Mon as a
// real mod is Unstable by derivation and takes the branch above instead — which
// is why 42-dark-b's token-host test does not reach this branch and this one
// does. Modelled directly: a unit token whose card IS Hooba-Mon.
//
// R152, Bena 2026-08-25: "a token is a normal thing that just ceases to exist
// in all zones other than in play/stack whenever SBAs are checked." A normal
// thing that CEASES TO EXIST, in that order — bin, trash, THEN removal. It is
// not a thing that was never in the bin.
test('R153 (iv): a TOKEN body with no mods takes the token sweep — binned, trashed, then erased', () => {
  const h = new Harness(12903);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let host = -1;
  withE(h, e => {
    host = e.spawnUnit(A, 'Hooba-Mon', e.homeRegion(A), { token: true }).id;
  });
  assert.equal(ent(h, host)!.mods.length, 0,
    'the branch under test needs a token with NO mods — otherwise it is Unstable by derivation');
  assert.ok(!new E(h.state).isUnstable(ent(h, host)!),
    'and genuinely not Unstable by any of the four routes (R96/R118)');

  exchangeAway(h, A, host, 'Skittering Blight');

  assert.equal(ent(h, host), undefined, 'the token host left play');
  assert.equal(trashesOf(h, 'Hooba-Mon').length, 1,
    'it really was in the bin, so R40 trashed it there (destination, not object — R133)');
  assert.ok(!binOf(h, A).includes('Hooba-Mon'), 'and then ceased to exist there');
  assert.ok(erasedOf(h, A).includes('Hooba-Mon'), 'the sweep files it on the erased pile (R65)');
  assert.deepEqual(verbsFor(h, 'Hooba-Mon'), ['trashed', 'erased'],
    'THE ORDER IS THE RULING: bin → trashed → swept, exactly as a dying token');
});

// ══════════════════════════════════════════════════════════════════════
// (v) TOKEN mods — the erased pile with no bin visit at all
// ══════════════════════════════════════════════════════════════════════
//
// R69: a token mod has no card of its own, so it never enters a bin and there
// is nothing to trash. It therefore has no `eraseFromZone` to announce it, and
// R65 still requires it to be VISIBLE somewhere — which is the single bulk
// 'erased' event at the bottom of the disposal. This test asserts that event
// specifically (by its reason), not merely that the name turned up on the pile:
// the body's own sweep would put a name there too, and a "the pile mentions
// Wraith" assertion cannot tell the two apart.
test('R153 (v): a TOKEN mod reaches the erased pile through the bulk event, never a bin', () => {
  const h = new Harness(12904);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Rune Channeler');
  giveResources(h, A, 'dark', 3);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hooba-Mon'), hostId: host });
  withE(h, e => { e.augmentWraith(e.entity(host)!, A); });   // a TOKEN mod

  exchangeAway(h, A, host, 'Skittering Blight');

  assert.ok(!binOf(h, A).includes('Wraith'),
    'a token mod has no card of its own, so no bin entry (R69)');
  assert.equal(trashesOf(h, 'Wraith').length, 0, 'and therefore nothing to trash');
  assert.ok(erasedOf(h, A).includes('Wraith'),
    'it still has to be visible somewhere — the erased pile (R65)');
  const bulk = h.events.filter(ev => ev.type === 'erased'
    && (ev.data!['cards'] as string[] | undefined)?.includes('Wraith'));
  assert.equal(bulk.length, 1,
    'and it got there through the disposal’s own bulk erased event, exactly once');
  assert.match(bulk[0]!.msg, /token mod has no card to bin/,
    'announced with the reason that distinguishes it from a bin sweep');
});

// ══════════════════════════════════════════════════════════════════════
// CONFORMANCE — one implementation, and it is the one both routes call
// ══════════════════════════════════════════════════════════════════════
//
// The per-case tests above all pass against a faithful hand-copy. That is
// exactly the state CT-43 was filed about: `exchangeInPlace` was CORRECT and
// fully pinned by 42-dark-b, and it was still a defect, because a copy that is
// right today drifts tomorrow and the tests that pin it are written from the
// card's side where the divergence is invisible. So the sharing itself has to
// be the assertion.
//
// This is behavioural, not a source scan: the method is replaced with a
// counting wrapper and both routes are driven. Re-inline the sequence at either
// call site — even perfectly — and the counter for that route stays at zero.
test('R153 conformance: BOTH destroy() and Hooba-Mon’s exchange go through E.disposeToBin', () => {
  const real = E.prototype.disposeToBin;
  let calls = 0;
  const wrapped = function (this: E, ...args: Parameters<E['disposeToBin']>): void {
    calls++;
    real.apply(this, args);
  };
  try {
    // ── route 1: a death ────────────────────────────────────────────
    (E.prototype as { disposeToBin: E['disposeToBin'] }).disposeToBin = wrapped;
    const h1 = new Harness(12905);
    toDeployment(h1);
    const A1 = h1.state.deployPlayer!;
    const victim = spawn(h1, A1, 'Rune Channeler');
    calls = 0;
    withE(h1, e => { e.destroy(e.entity(victim)!, 'dies'); });
    assert.equal(ent(h1, victim), undefined, 'the unit really died');
    assert.equal(calls, 1,
      'E.destroy must run its disposal through E.disposeToBin — it looks like the tail has been '
      + 're-inlined into destroy(). There is one implementation (R153/CT-43); call it.');

    // ── route 2: Hooba-Mon's exchange ───────────────────────────────
    const h2 = new Harness(12906);
    toDeployment(h2);
    const A2 = h2.state.deployPlayer!;
    const hooba = spawn(h2, A2, 'Hooba-Mon');
    calls = 0;
    exchangeAway(h2, A2, hooba, 'Skittering Blight');
    assert.equal(ent(h2, hooba), undefined, 'the exchange really happened');
    assert.equal(calls, 1,
      'E.exchangeInPlace (Hooba-Mon, Necromorph) must run its disposal through '
      + 'E.disposeToBin. A hand-copy of the sequence is what R146 and R152 each spent a round '
      + 'repairing — push/announce/trash/sweep/erased-pile/delete has eight ordering constraints '
      + 'and not one of them is visible from a call site.');
  } finally {
    (E.prototype as { disposeToBin: E['disposeToBin'] }).disposeToBin = real;
  }
});

// The structural half of the same claim, and the reason it is worth having as
// well: the spy above proves the primitive RUNS, not that it is the only thing
// that runs. A re-inlined copy that ALSO called disposeToBin — the most likely
// shape of a bad merge — would satisfy the spy and double every trash. So each
// call site is also read for the parts of the tail that must not be there.
test('R153 conformance: neither call site keeps a second copy of the tail', () => {
  const src = (p: string): string => fs.readFileSync(path.resolve(HERE, '..', p), 'utf8');

  // destroy(): its own source, taken off the prototype so a moved method or a
  // renamed file cannot make this silently stop measuring
  const destroySrc = E.prototype.destroy.toString();
  assert.match(destroySrc, /disposeToBin\(/, 'E.destroy no longer calls the primitive at all');
  for (const banned of ['eraseFromZone(', 'noteTrashed(', 'bin.push(']) {
    assert.ok(!destroySrc.includes(banned),
      `E.destroy contains \`${banned}\` again — that is the disposal tail coming back into it. `
      + 'It belongs in E.disposeToBin (R153/CT-43), which destroy() already calls.');
  }

  // exchangeInPlace(): R157 §3 moved it out of batch-dark-b.ts and onto E, so
  // that Necromorph could stop calling destroy() and share it. It is a real
  // method now, so it is read off the prototype exactly as destroy() is —
  // which is strictly better than the file slice this used to take: a moved
  // method or a renamed file cannot make the check silently stop measuring.
  const exchangeSrc = E.prototype.exchangeInPlace.toString();
  assert.match(exchangeSrc, /disposeToBin\(/, 'E.exchangeInPlace no longer calls the primitive');
  for (const banned of ['eraseFromZone(', 'noteTrashed(', '.bin']) {
    assert.ok(!exchangeSrc.includes(banned),
      `E.exchangeInPlace contains \`${banned}\` again — the hand-copy of destroy()'s disposal tail `
      + 'is back. R146 and R152 were two rounds of repairing that copy; R153 removed it. '
      + 'Everything it did lives in E.disposeToBin.');
  }

  // and NEITHER card may grow one back. Both exchanges are one call to the
  // primitive now (R157 §3); the file slices below are what would catch a
  // "just this once" re-inline at either call site.
  for (const rel of ['src/cards/sets/batch-dark-b.ts', 'src/cards/sets/batch-dark-c.ts']) {
    const code = src(rel)
      // comments out: both files document the tail they no longer implement,
      // and the census sweep's own fixture line names `.bin.push(` on purpose
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.match(code, /g\.exchangeInPlace\(/, `${rel} no longer calls E.exchangeInPlace`);
    assert.ok(!code.includes('disposeToBin('),
      `${rel} calls E.disposeToBin directly — an exchange is E.exchangeInPlace, which does the `
      + 'slot swap, the despawn and the disposal together (R157 §3).');
  }
});

// ── and the primitive's own guarantee, stated where a reader will find it ──
//
// `E.leavePlay` / `E.afterDespawn` (recall, cache) are deliberately NOT folded
// into disposeToBin: they run the MODS half and nothing else, because their
// body goes to a hand or a cache rather than a bin. The one thing that must
// stay true across that split is the R137 principle it was created for — the
// same mod card behaves the same however its host left play — so it is
// asserted rather than assumed.
test('R153: a nontoken mod is binned and trashed the same whether its host dies or is exchanged', () => {
  const shape = (seed: number, leave: (h: Harness, host: EntityId, A: Seat) => void) => {
    const h = new Harness(seed);
    toDeployment(h);
    const A = h.state.deployPlayer!;
    const host = spawn(h, A, 'Rune Channeler');
    giveResources(h, A, 'dark', 6);
    h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hooba-Mon'), hostId: host });
    leave(h, host, A);
    return {
      trashed: trashesOf(h, 'Hooba-Mon').length,
      erased: countIn(erasedOf(h, A), 'Hooba-Mon'),
      leftInBin: countIn(binOf(h, A), 'Hooba-Mon'),
      verbs: verbsFor(h, 'Hooba-Mon'),
    };
  };
  const died = shape(12907, (h, host) => {
    withE(h, e => { e.destroy(e.entity(host)!, 'dies'); });
    resolveAll(h);
  });
  const exchanged = shape(12908, (h, host, A) => exchangeAway(h, A, host, 'Skittering Blight'));

  assert.deepEqual(exchanged, died,
    'the mod must not care HOW its host left play (R137). If these differ, one of the two routes '
    + 'has stopped using E.disposeToBin — which is the whole defect CT-43 is about.');
  assert.deepEqual(died.verbs, ['trashed', 'erased'], 'and the shared answer is bin → trash → sweep');
});

// Guard on the guard: the primitive has to still BE the shape these tests
// assume, or every assertion above degrades into "some method ran".
test('R153: E.disposeToBin exists and takes (entity, mods, announce, opts)', () => {
  assert.equal(typeof E.prototype.disposeToBin, 'function', 'the primitive is gone');
  assert.equal(E.prototype.disposeToBin.length, 3,
    'disposeToBin(u, mods, announce, opts = {}) — three required parameters. The `announce` '
    + 'callback is held to the MIDDLE of the sequence on purpose: after every push, before every '
    + 'trash. Changing that signature changes when a death or despawn listener sees the board.');
  const body = E.prototype.disposeToBin.toString();
  for (const required of ['noteTrashed(', 'eraseFromZone(', 'announce(']) {
    assert.ok(body.includes(required),
      `E.disposeToBin no longer contains \`${required}\` — part of the tail has moved back out `
      + 'of the primitive, which is how the copies drifted the first three times.');
  }
});

// ── R65, the branch that never had an announcement ─────────────────────────
//
// Found 2026-08-25 while closing CT-43: the R65 rule is that EVERY erase
// reaches the public erased pile, and a TOKEN mod is erased whichever way its
// host leaves play (R69 — it has no card of its own, so it can never bin).
// `disposeToBin` says so for a death and for Hooba-Mon's exchange. `leavePlay`
// deleted it in total silence, so the SAME Wraith on the SAME host was public
// when the host died and invisible when the host was recalled or cached —
// R137's defect one object over.
//
// This is deliberately asserted over all three routes together: a per-route
// test would have passed on `destroy` alone, which is exactly how the gap
// survived. Nothing about zones, entities or timing changed with the fix; it
// only announces what was already happening.
test('R65: a TOKEN mod reaches the erased pile however its host leaves play', () => {
  const seen: Record<string, { pile: number; events: number }> = {};
  for (const how of ['destroy', 'recall', 'cache'] as const) {
    const h = new Harness(99);
    toDeployment(h);
    const P = h.state.deployPlayer!;
    const hostId = spawn(h, P, 'Tidal Menace');
    withE(h, e => {
      const host = e.entity(hostId)!;
      e.attachMod(host, E.WRAITH, P, 'augment', undefined, { token: true });
      const pileBefore = (h.state.players[P]!.erased ?? []).length;
      const evBefore = e.events.length;
      if (how === 'destroy') e.destroy(host, 'dies');
      else if (how === 'recall') e.recall(host);
      else e.cacheUnit(host);
      seen[how] = {
        pile: (h.state.players[P]!.erased ?? []).length - pileBefore,
        events: e.events.slice(evBefore).filter(v => v.type === 'erased').length,
      };
    });
  }
  // recall and cache each announce exactly the token mod; a death also erases
  // the Unstable body it was riding (a modded card is Unstable — R69/R96), so
  // it legitimately files two.
  assert.equal(seen['recall']!.pile, 1, 'a RECALLED host left its token mod off the erased pile');
  assert.equal(seen['cache']!.pile, 1, 'a CACHED host left its token mod off the erased pile');
  assert.ok(seen['destroy']!.pile >= 1, 'a dying host must still file its token mod');
  for (const how of ['destroy', 'recall', 'cache'] as const) {
    assert.ok(seen[how]!.events >= 1,
      `${how} produced no 'erased' event at all — R65 is about the ERASE, not the verb that `
      + 'caused it, so every route has to say so out loud.');
  }
});

// ── the log has to agree with the board ────────────────────────────────────
//
// `keepBinned` (Pull Under: "put it and all of its mods into your bin") is the
// one card that overrides the Unstable sweep. The 'died' message used to pick
// its wording from `erasedByUnstable` while the SWEEP ran on
// `unstable && !keepBinned` — two different questions — so Pull Under on a
// modded victim announced `, then ERASED — Unstable (it and its 1 mod(s)).`
// with both cards sitting in the caster's bin and the erased pile empty.
//
// Asserted against the BOARD rather than against a fixed string: the point is
// agreement between the two, not any particular phrasing.
test('R156: a keepBinned death does not claim an erase that never happened', () => {
  const h = new Harness(99);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const O = (1 - P) as Seat;
  const victim = spawn(h, O, 'Tidal Menace');
  withE(h, e => {
    const u = e.entity(victim)!;
    e.attachMod(u, 'Nothyr', O, 'augment');           // nontoken mod ⇒ Unstable (R69)
    assert.ok(e.isUnstable(u), 'the premise: a modded body is Unstable');
    const at = e.events.length;
    e.destroy(u, 'is deleted', { binTo: P, keepBinned: true });   // Pull Under's own call
    const died = e.events.slice(at).find(v => v.type === 'died');
    assert.ok(died, 'a death was logged');

    const bin = h.state.players[P]!.bin;
    const pile = h.state.players[P]!.erased ?? [];
    const reallyErased = pile.includes('Tidal Menace');
    const reallyInBin = bin.includes('Tidal Menace');

    assert.ok(reallyInBin && !reallyErased,
      'the premise of this test: keepBinned leaves the body in the bin and off the erased pile');
    assert.ok(!/ERASED/.test(died!.msg ?? ''),
      `the log claims an erase that did not happen: ${JSON.stringify(died!.msg)} — but the bin `
      + `holds ${JSON.stringify(bin)} and the erased pile is ${JSON.stringify(pile)}. Whether a `
      + 'card is recoverable from a bin is a real play decision, and the log is where a player '
      + 'reads it. The message must ask the SWEEP condition (unstable && !keepBinned), not '
      + '`unstable` alone.');
  });
});

// the negative control: WITHOUT keepBinned the same board really is erased, so
// the test above cannot pass by the message simply never saying ERASED again.
test('R156 control: the same death WITHOUT keepBinned still reports the erase', () => {
  const h = new Harness(99);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const victim = spawn(h, P, 'Tidal Menace');
  withE(h, e => {
    const u = e.entity(victim)!;
    e.attachMod(u, 'Nothyr', P, 'augment');
    const at = e.events.length;
    e.destroy(u, 'dies');
    const died = e.events.slice(at).find(v => v.type === 'died');
    assert.match(died!.msg ?? '', /ERASED/,
      'an ordinary Unstable death must still announce its erase — otherwise the keepBinned test '
      + 'above is satisfied by a message that never mentions an erase at all');
    assert.ok((h.state.players[P]!.erased ?? []).includes('Tidal Menace'),
      'and the board agrees with it');
  });
});
