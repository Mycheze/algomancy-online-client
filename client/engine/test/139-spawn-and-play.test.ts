/* R165 — two halves of one question: WHAT arrives, and HOW it arrived.
 *
 * (a) "I SPAWN WITH N COUNTERS" is a fact about the body, not a trigger.
 *     Powerforge Synergist ("two +1/+1 counters", printed 0/0) and Aethercap
 *     Siphoner ("three -1/-1 counters on me", printed 4/4) both used to bolt
 *     their counters on afterwards — Aethercap through a queued 'spawned'
 *     trigger, which cannot run before the event that raised it (R147), and
 *     Powerforge through a `when()` that wrote `self.counters` RAW and so
 *     walked past R104's amount layer. `CardBehavior.spawnsWithCounters` is
 *     the declaration; `E.spawnUnit` applies it, through `amountDelta`, before
 *     `fireEvent`.
 *
 * (b) "PLAY" IS NOT "PUT INTO PLAY". Four cards print "put into play" (Exhume,
 *     Resurrect, Rousing Spirit, Lurking Dread) and two print "play" — Wake
 *     the Dead and The Bonesculptor. All six were the same call, so R129's
 *     'cardPlayed' never fired for the two that really were plays and every
 *     "whenever you play a card / a unit" watcher was deaf to them.
 *     `spawnUnit`'s `asPlay` (with R49's `from`) is that printed word.
 *
 * Seeds 13901-13999. Each test names its card; each has a positive control
 * next to its negative so a silently dead watcher cannot fake a pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { getCard } from '../src/cards/dsl.ts';
import {
  effStats, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, unitsOf,
  withE as whiteBox,
} from './util.ts';
import type { Seat } from '../src/types.ts';

// ── local rig ────────────────────────────────────────────────────────────

/** answer every pending trigger-ORDER question with the identity order and
 * pass every priority window until the stack is empty. Any OTHER decision is
 * left standing for the test to look at. */
function drainTriggers(h: Harness): void {
  let guard = 40;
  while (guard-- > 0) {
    const dec = h.state.decision;
    if (dec?.kind === 'orderTriggers') {
      h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
      continue;
    }
    if (dec) return;
    if (h.state.stack.length && h.state.priority !== null) { pass(h); continue; }
    return;
  }
  throw new Error('drainTriggers did not terminate');
}

const unitByCard = (h: Harness, name: string) =>
  Object.values(h.state.entities).find(u => u.card === name && !u.absent);

const expended = (h: Harness, seat: Seat): number =>
  h.state.players[seat]!.resources.filter(r => r.state === 'expended').length;

// ═══════════════════════ (a) I SPAWN WITH N COUNTERS ═════════════════════

// ── Powerforge Synergist ─────────────────────────────────────────────────

test('Powerforge Synergist: its two +1/+1 counters are scaled by an allied Flux Resonator, exactly as "Create a Robot 2" is', () => {
  // THE DEFECT: the counters were written straight onto `self.counters` by a
  // bookkeeping when(), which is not a placement anything can replace. So this
  // card entered with 2 under a Flux Resonator ("put that many counters plus
  // one instead") while a Robot 2 — the same printed sentence with a number in
  // it — entered with 3. Two printings of one thing must not disagree about
  // whether a replacement effect touches them.
  const h = new Harness(13901);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Flux Resonator');                       // [Augment] +1 to any counter placement of mine
  const pf = spawn(h, p, 'Powerforge Synergist');      // printed 0/0
  assert.equal(h.state.entities[pf]!.counters, 3,
    'two, plus the Resonator\'s one — the amount layer was consulted');
  assert.deepEqual(effStats(h, pf), [3, 3], 'so the printed 0/0 arrives as a 3/3');

  // the control, and the whole point: the OTHER printing of the same sentence
  whiteBox(h, e => { e.spawnUnit(p, 'Robot', e.homeRegion(p), { token: true, counters: 2 }); });
  const robot = unitByCard(h, 'Robot')!;
  assert.equal(robot.counters, h.state.entities[pf]!.counters,
    '"Create a Robot 2" and "I spawn with two +1/+1 counters" get the SAME answer under a Flux Resonator');
});

test('Powerforge Synergist: the two +1/+1 counters are on the body at the moment of the \'spawned\' event', () => {
  const h = new Harness(13902);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Iyngstra');                              // "whenever another ally spawns, gain life equal to their defense"
  const life0 = h.state.players[p]!.life;
  let pf = -1;
  // whiteBox, not the `spawn` helper: `spawn` runs its own E and drops the
  // events on the floor, and the event is the subject of this test
  whiteBox(h, e => { pf = e.spawnUnit(p, 'Powerforge Synergist', e.homeRegion(p)).id; });
  drainTriggers(h);

  // the spawn EVENT itself — the one line every player at the table reads —
  // says what arrived. Before R165 the counters were not part of the spawn at
  // all and this line named a bare Powerforge Synergist.
  const spawnLine = h.events.filter(e => e.type === 'spawned'
    && (e.data?.['card'] as string) === 'Powerforge Synergist').at(-1)!;
  assert.match(spawnLine.msg, /Powerforge Synergist \(2 \+1\/\+1\)/,
    'the spawn event announces the body that actually arrived');
  assert.deepEqual(effStats(h, pf), [2, 2], 'a printed 0/0 that is really a 2/2');
  assert.equal(h.state.players[p]!.life - life0, 2,
    'Iyngstra read the 2/2 — not a 0/0, and not a body that died to the 0 defense');
  assert.ok(h.state.entities[pf], 'and the 0/0 was never briefly a real 0/0 for the death check to find');
});

// ── Aethercap Siphoner ───────────────────────────────────────────────────

test('Aethercap Siphoner: a spawn watcher sees the 1/1 the card prints, not the printed 4/4', () => {
  // THE DEFECT: "I spawn with three -1/-1 counters on me" was an on-spawn self
  // TRIGGER, and a trigger cannot run before the event that raised it (R147).
  // So the card stood there as a 4/4 for the whole of its own spawn: Iyngstra
  // ("gain life equal to their defense") gained 4 for a card that prints 1 —
  // and the caster was stopped and asked to ORDER their own spawn against the
  // card's own arithmetic, a question with no answer.
  const h = new Harness(13903);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Iyngstra');
  const life0 = h.state.players[p]!.life;
  let sip = -1;
  whiteBox(h, e => { sip = e.spawnUnit(p, 'Aethercap Siphoner', e.homeRegion(p)).id; });
  assert.equal(h.state.decision, null,
    'no trigger-order question: there is only ONE trigger here, and it is Iyngstra\'s');
  assert.equal(h.state.entities[sip]!.counters, -3, 'the three -1/-1 counters are on');
  assert.deepEqual(effStats(h, sip), [1, 1], 'a printed 4/4 that is really a 1/1');
  assert.equal(h.state.players[p]!.life - life0, 1,
    'Iyngstra gained 1, the defense the card prints — it used to gain 4');
});

test('Aethercap Siphoner: spawning with counters is not "you put counters on an ally" — the same silence a Robot\'s X keeps', () => {
  // R130: nobody PUTS a spawn's own counters on it — it arrives holding them —
  // so no 'countersChanged' fires and no "when you put a counter" trigger
  // hears a spawn. That was already true of a Robot X and NOT true of this
  // card, whose counters came through addCounters like any other placement.
  const h = new Harness(13904);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Scrapyard Custodian');                   // "When you put one or more counters on an ally, draw"
  const hand0 = h.state.players[p]!.hand.length;
  whiteBox(h, e => { e.spawnUnit(p, 'Aethercap Siphoner', e.homeRegion(p)); });
  drainTriggers(h);
  assert.equal(h.state.players[p]!.hand.length, hand0,
    'the Siphoner\'s own spawn counters are not a placement — no card is drawn');

  // the positive control: a REAL placement on an ally still draws, so the
  // watcher above was alive the whole time
  const ally = unitByCard(h, 'Aethercap Siphoner')!;
  whiteBox(h, e => { e.addCounters(e.entity(ally.id)!, 1, p); });
  drainTriggers(h);
  assert.equal(h.state.players[p]!.hand.length, hand0 + 1,
    'putting a counter on that same ally by hand DOES draw — the Custodian was live');
});

// ═══════════════════ (b) PLAY vs PUT INTO PLAY ═══════════════════════════

// ── Wake the Dead ────────────────────────────────────────────────────────

test('Wake the Dead: the units it plays out of a bin are PLAYED — Bloomcaster and Stalwart Sentinel both hear them', () => {
  // "Play up to two units in any bin with total cost [8] or less now, for
  // free." The printed verb is PLAY. It used to be an ordinary spawnUnit, i.e.
  // exactly what Exhume ("put a unit … into play") does, so nothing in the
  // pool could tell the two cards apart.
  const h = new Harness(13905);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const bloom = spawn(h, A, 'Bloomcaster');             // "whenever you PLAY a unit, create a 1/1 unit"
  const sent = spawn(h, A, 'Stalwart Sentinel');        // "[once] when you play a unit or spell from anywhere other than your hand"
  h.state.players[A]!.bin.push('Good Whale');           // cost 6, my bin
  h.state.players[D]!.bin.push('Curio Drifter');        // cost 1, the OPPONENT's bin
  giveResources(h, A, 'dark', 8);                       // ddd/8
  toNextBattle(h, A);
  // R12: the raised units arrive in the BATTLE region (ctx.region), so the two
  // watchers have to be there to hear anything — they attack alongside.
  h.do({ type: 'declareAttack', seat: A, columns: [[atk, bloom], [sent]] });
  const tokens0 = unitsOf(h, A).filter(u => u.card === 'Unit Token').length;

  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Wake the Dead') });
  pass(h); pass(h);
  pick(h, `${A}:0`);
  pick(h, `${D}:0`);
  drainTriggers(h);

  assert.equal(unitsOf(h, A).filter(u => u.card === 'Unit Token').length, tokens0 + 2,
    'Bloomcaster paid out once per unit PLAYED — two units, two 1/1s');
  // ERRATA 2026-09-21: Stalwart Sentinel's printed text gained `[once]`, so it
  // now pays out ONCE per turn however many cards are played. That is the whole
  // reason the two watchers stand on the same board in this test — Bloomcaster
  // is unbounded and answers both raises, the Sentinel is bounded and answers
  // one, and before the errata the two were indistinguishable here at 4 and 2.
  assert.equal(h.state.entities[sent]!.counters, 2,
    'Stalwart Sentinel: [once] — two cards played from a bin, but only one payout of two counters');
  // the R49 half, and the reason each watcher heard each unit exactly ONCE
  const played = h.events.filter(e => e.type === 'cardPlayed'
    && ['Good Whale', 'Curio Drifter'].includes(e.data?.['card'] as string));
  assert.equal(played.length, 2, 'one \'cardPlayed\' per raised unit');
  assert.ok(played.every(e => e.data?.['from'] === 'bin' && e.data?.['seat'] === A),
    'played out of a bin, by the CASTER — a borrowed card is still played by you');
  // …and being played did not naturalise the borrowed one (CARD-TODO #17)
  const drifter = unitByCard(h, 'Curio Drifter')!;
  assert.equal(drifter.controller, A, 'the caster controls it');
  assert.equal(drifter.owner, D, 'the opponent still owns it');
});

test('Wake the Dead: being a PLAY is free — the raised units still cost nothing', () => {
  const h = new Harness(13906);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const atk = spawn(h, A, 'Unit Token');
  h.state.players[A]!.bin.push('Good Whale');           // b/6 — and A has no water at all
  giveResources(h, A, 'dark', 10);                      // 8 for the spell, 2 to spare
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Wake the Dead') });
  const spent = expended(h, A);
  assert.equal(spent, 8, 'the spell itself cost 8');
  pass(h); pass(h);
  pick(h, `${A}:0`);
  drainTriggers(h);
  assert.ok(unitByCard(h, 'Good Whale'), 'a b/6 unit is in play for a caster with no water');
  assert.equal(expended(h, A), spent, 'and not one further resource was spent — "for free"');
  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'open').length, 2,
    'the two spare dark are still open');
});

// ── The Bonesculptor ─────────────────────────────────────────────────────

test('The Bonesculptor: the unit it plays from your bin is PLAYED — Bloomcaster and Stalwart Sentinel hear it, and a put-into-play does not', () => {
  // "You may play one unit with no abilities from your bin each deployment."
  // The card's own log line has said "plays … from the bin" all along while
  // the engine put the unit into play in silence.
  const h = new Harness(13907);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const bone = spawn(h, p, 'The Bonesculptor');
  spawn(h, p, 'Bloomcaster');
  const sent = spawn(h, p, 'Stalwart Sentinel');

  // the NEGATIVE control first: putting a unit into play is not playing one
  spawn(h, p, 'Curio Drifter');
  drainTriggers(h);
  const tokens0 = unitsOf(h, p).filter(u => u.card === 'Unit Token').length;
  assert.equal(tokens0, 0, 'a unit PUT into play makes no 1/1 (Exhume, Resurrect, …)');
  assert.equal(h.state.entities[sent]!.counters, 0, 'and no counters on the Sentinel');

  h.state.players[p]!.bin.push('Curio Drifter');
  giveResources(h, p, 'water', 1);                      // Curio Drifter is b/1 — "you still pay the cost"
  h.do({ type: 'activateAbility', seat: p, entityId: bone, abilityIndex: 0 });
  const dec = h.state.decision!;
  h.do({ type: 'decide', seat: dec.seat, choice: dec.options.findIndex(o => o.label === 'Curio Drifter') });
  drainTriggers(h);

  assert.equal(unitsOf(h, p).filter(u => u.card === 'Unit Token').length, 1,
    'Bloomcaster: playing a unit makes a 1/1');
  assert.equal(h.state.entities[sent]!.counters, 2,
    'Stalwart Sentinel: a card played from anywhere other than your hand is two +1/+1 counters');
  const played = h.events.filter(e => e.type === 'cardPlayed' && e.data?.['card'] === 'Curio Drifter');
  assert.equal(played.length, 1, 'exactly one \'cardPlayed\' — the bin play, not the put-into-play above it');
  assert.equal(played[0]!.data?.['from'], 'bin', 'R49: out of the bin');
});

// ── the third defect the inventory row did not name ──────────────────────

test('Powerforge Synergist / Aethercap Siphoner: "I spawn with N counters" never reaches the stack — a card\'s own size is not respondable', () => {
  // Aethercap's clause was a REAL triggered ability, so in battle it pushed a
  // stack item: an opponent could respond to — or negate — a card's own printed
  // arrival size. Powerforge's, which prints the same kind of sentence, never
  // queued at all. Two mechanisms, and the worse of the two was negatable.
  //
  // "I spawn with N counters" is a statement about what the card IS on arrival,
  // not an effect aimed at it. Neither should ever be on the stack, and above
  // all the two must not differ.
  const h = new Harness(13908);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const battleRegion = h.state.battle!.region;
  assert.equal(h.state.stack.length, 0, 'a clean stack to start from');

  let sip = -1, pf = -1;
  whiteBox(h, e => { sip = e.spawnUnit(A, 'Aethercap Siphoner', battleRegion).id; });
  assert.equal(h.state.stack.length, 0,
    'Aethercap Siphoner put nothing on the stack — there is nothing to negate');
  assert.equal(h.state.entities[sip]!.counters, -3, 'and the counters are already on');

  whiteBox(h, e => { pf = e.spawnUnit(A, 'Powerforge Synergist', battleRegion).id; });
  assert.equal(h.state.stack.length, 0, 'and neither did Powerforge Synergist');
  assert.equal(h.state.entities[pf]!.counters, 2, 'its two are on too');

  // the MECHANISM, not just this board: neither card declares a 'spawned'
  // ability at all any more, so there is nothing that could queue on any board
  for (const name of ['Aethercap Siphoner', 'Powerforge Synergist']) {
    const spawnAbilities = (getCard(name).abilities ?? [])
      .filter(a => a.type === 'triggered' && a.events.includes('spawned'));
    assert.equal(spawnAbilities.length, 0,
      `${name}: its arrival size is a declaration (spawnsWithCounters), not an ability`);
    assert.equal(getCard(name).spawnsWithCounters !== undefined, true,
      `${name}: …and it is declared`);
  }
});
