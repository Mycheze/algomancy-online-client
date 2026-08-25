/* R164 — A COPY OF A SPELL IS A SPELL ON THE STACK.
 *
 * Earthbound Replicator and Maelstrom Charger both print "copy". Until now the
 * engine answered that by re-running the copied card's `spellEffect` IN PLACE,
 * off the stack (`runSpellCopy` → `def.run(...)`). The copy therefore did not
 * exist as far as the rest of the game was concerned: nobody could respond to
 * it, no negate could target it, no stack sweep could see it.
 *
 * Two [Solved] RAQ threads settle the shape, and every test below is one line
 * out of them:
 *
 *   "[Solved] Earthbound Replicator. No, it's not infinity" (_passer)
 *     · "Copy is new spell effect on stack"
 *     · "Copy spell is not a token."
 *     · "He copies only PLAYED non-unit Spells. This means targeting him with
 *        copy he created is possible, but he won't make 2nd copy, since 1st
 *        copy wasn't 'played'. Sorry. No infinite loop there."
 *
 *   "[Solved] Maelstrom Charger - all you need to know." (_passer)
 *     · "put copy of spell effect on stack (above original spell effect)"
 *     · "If original spell have some additional cost (like [Sacrifice a unit])
 *        or any X values (like Wildfire), then you DON'T pay additional cost
 *        again and the X value is the one from original spell."
 *
 * The engine seam is `E.pushSpellCopy` (a `StackItem` clone marked
 * `copy: true`) plus four one-line guards that all say the same thing: a copy
 * has NO CARD, so no disposal path may move one.
 *
 * Seeds 13800-13809.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { EntityId, Seat } from '../src/types.ts';
import {
  ent, effStats, finishBattle, give, giveResources, offered, pass, pick, spawn,
  toDeployment, toNextBattle, tokensOf,
} from './util.ts';

/** A battle with A attacking with one body and D holding an Earthbound
 * Replicator (1/3, its own [Augment] text live). Priority is A's, so A may
 * play a {Battle} spell at the Replicator right away. */
function replicatorBattle(h: Harness): { A: Seat; D: Seat; atk: EntityId; repl: EntityId } {
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const repl = spawn(h, D, 'Earthbound Replicator');
  return { A, D, atk, repl };
}

const copies = (h: Harness) => h.state.stack.filter(i => i.copy);

/** R178: answer the pending decision by option LABEL. Maelstrom Charger's
 * as-you-play option (E.collectAsYouPlay) carries bookkeeping values rather
 * than target refs, so `pick` — which matches on the value — cannot name it. */
function say(h: Harness, label: string): void {
  const dec = h.state.decision;
  if (!dec) throw new Error(`no decision is pending; expected one offering "${label}"`);
  const idx = dec.options.findIndex(o => o.label.includes(label));
  if (idx === -1) throw new Error(`no option labelled "${label}" in [${dec.options.map(o => o.label)}]`);
  h.do({ type: 'decide', seat: dec.seat, choice: idx });
}

// ── the copy is REALLY on the stack ──────────────────────────────────────

test('R164 Earthbound Replicator: the copy is a real stack item, pushed ABOVE the original', () => {
  const h = new Harness(13800);
  const { A, D, atk, repl } = replicatorBattle(h);
  giveResources(h, A, 'wood', 2);                             // Burgeon: g, mana 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Burgeon') });
  pick(h, { unit: repl });                                    // Burgeon targets the Replicator
  pick(h, 'power');                                           // R57: the half, declared at cast
  assert.equal(h.state.stack.length, 2, 'the Burgeon, and the Replicator trigger above it');
  pass(h); pass(h);                                           // resolve the Replicator trigger
  pick(h, false);                                             // keep the declared target

  assert.equal(h.state.stack.length, 2, 'the trigger resolved and left a COPY behind it');
  const [orig, copy] = h.state.stack;
  assert.ok(!orig!.copy, 'the original is not flagged');
  assert.equal(copy!.copy, true, 'RAQ: "Copy is new spell effect on stack"');
  assert.equal(copy!.card, 'Burgeon', 'it is a copy of the spell that was played');
  assert.equal(copy!.kind, 'spell', 'RAQ: "Copy spell is not a token." — it keeps the original\'s kind');
  assert.notEqual(copy!.id, orig!.id, 'and it is a distinct item, not the original re-listed');
  assert.ok(copy!.label.includes('(copy)'), 'the log and the stack say which one it is');
  // "above original spell effect" — so it resolves FIRST
  assert.ok(h.state.stack.indexOf(copy!) > h.state.stack.indexOf(orig!),
    'RAQ: the copy goes ON TOP of the original');
  // and a fresh priority window is open on it: it is respondable, which is
  // the whole point. (`finishResolutionTail` restarts the window from the
  // initiative player after any resolution, so the seat is A here rather than
  // D; what matters is that the round is open and the copy is still on the
  // stack when it opens.)
  assert.equal(h.state.passes, 0, 'a full response round is open on the copy');
  assert.notEqual(h.state.priority, null, 'somebody has priority — the copy can be answered');
  pass(h);
  assert.equal(copies(h).length, 1, 'ONE pass does not resolve it: both seats get a say');
  assert.equal(h.state.priority, D, 'and the second seat is the one that has not acted');
  finishBattle(h);
});

test('R164 Earthbound Replicator: the copy is offered as a "target effect" and Dematerialize negates it', () => {
  const h = new Harness(13801);
  const { A, D, atk, repl } = replicatorBattle(h);
  giveResources(h, A, 'wood', 2);                             // Burgeon: g, mana 2
  giveResources(h, D, 'water', 1); giveResources(h, D, 'metal', 1);   // Dematerialize: bm
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Burgeon') });
  pick(h, { unit: repl });
  pick(h, 'power');
  pass(h); pass(h);
  pick(h, false);                                             // keep the declared target
  const copy = copies(h)[0]!;

  pass(h);                                                    // priority → D, with the copy on the stack
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Dematerialize') });
  assert.ok(offered(h).includes(JSON.stringify({ stack: copy.id })),
    'the COPY is a legal "target effect" — every stack sweep can see it now');
  pick(h, { stack: copy.id });
  // R178: Dematerialize targets an EFFECT, not the Replicator, so the
  // Replicator's trigger no longer queues at all — "targeting me" is asked in
  // `when`, at the moment of the play. It used to queue on every nonunit spell
  // and print a no-op line at resolution, which is the pair of passes that
  // used to be here.
  pass(h); pass(h);                     // Dematerialize resolves
  assert.equal(copies(h).length, 0, 'R68: the negated copy left the stack at once');
  assert.ok(h.log.some(l => l.includes('Burgeon (copy) is negated')), 'and the negation is announced');
  assert.ok(!h.log.some(l => l.includes('Burgeon (copy) is negated → bin')),
    'a copy has NO CARD — negating it must not conjure one into a bin');
  pick(h, h.state.decision!.options[0]!.value);               // Dematerialize's Glimpse 3

  pass(h); pass(h);                                           // the ORIGINAL Burgeon still resolves
  assert.equal(effStats(h, repl)[0], 2, 'only the original doubled it: 1 → 2, not 1 → 2 → 4');
  assert.equal(h.state.players[A]!.bin.filter(c => c === 'Burgeon').length, 1,
    'exactly ONE Burgeon card exists and exactly one reached a bin');
  finishBattle(h);
});

test('R164 Earthbound Replicator: an unanswered copy resolves too — the spell happens twice', () => {
  const h = new Harness(13802);
  const { A, atk, repl } = replicatorBattle(h);
  giveResources(h, A, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Burgeon') });
  pick(h, { unit: repl });
  pick(h, 'power');
  pass(h); pass(h);
  pick(h, false);
  pass(h); pass(h);                                           // the copy resolves (it is on top)
  pass(h); pass(h);                                           // then the original
  assert.equal(effStats(h, repl)[0], 4, 'copy then original: 1 → 2 → 4');
  assert.equal(h.state.players[A]!.bin.filter(c => c === 'Burgeon').length, 1,
    'and still exactly one Burgeon card in the bin — the copy binned nothing');
  finishBattle(h);
});

// ── a copy was not PLAYED ────────────────────────────────────────────────

test('R164 Earthbound Replicator: a copy is not PLAYED, so it fires no play event and copies nothing ("No, it\'s not infinity")', () => {
  const h = new Harness(13803);
  const { A, atk, repl } = replicatorBattle(h);
  giveResources(h, A, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Burgeon') });
  pick(h, { unit: repl });
  pick(h, 'power');
  pass(h); pass(h);
  pick(h, false);
  // RAQ: "he won't make 2nd copy, since 1st copy wasn't 'played'". The copy
  // targets the Replicator exactly as the original did, so the ONLY thing
  // keeping this finite is that a copy fires no 'spellPlayed'.
  assert.equal(copies(h).length, 1, 'one copy, and the copy did not copy itself');
  assert.equal(h.state.stack.length, 2, 'nothing else was added to the stack');
  assert.equal(h.log.filter(l => l.includes('plays Burgeon')).length, 1,
    "the copy announced no PLAY — only the real cast did (so Proph, Stalwart Sentinel, "
    + 'Dragnol, Death Greeter, The Silent and Void Mandible, which all print "play", '
    + 'correctly do not see it)');
  assert.equal(h.log.filter(l => l.includes('copies Burgeon')).length, 1, 'and exactly one copy was made');
  pass(h); pass(h); pass(h); pass(h);                         // both resolve, still finite
  assert.equal(h.state.stack.length, 0, 'the stack drains');
  finishBattle(h);
});

// ── what the copy INHERITS: R57's mode, R35's receipt ────────────────────

test('R164 Earthbound Replicator: the copy inherits the declared mode (R57) and is never asked again', () => {
  const h = new Harness(13804);
  const { A, atk, repl } = replicatorBattle(h);
  giveResources(h, A, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Burgeon') });
  pick(h, { unit: repl });
  assert.equal(h.state.decision?.kind, 'mode', "Burgeon's half is a CAST-window question");
  pick(h, 'defense');                                         // declare DEFENSE this time
  pass(h); pass(h);
  pick(h, false);
  const copy = copies(h)[0]!;
  assert.equal(copy.parts[0]?.mode, 'defense',
    'R57: the original said which half it was, in public, in its own cast window — '
    + 'the copy is that spell again, not a second chance to pick');
  assert.ok(!h.state.decision || h.state.decision.kind !== 'mode', 'and nobody is re-asked');
  pass(h); pass(h);                                           // the copy resolves
  pass(h); pass(h);                                           // then the original
  assert.equal(effStats(h, repl)[1], 12, 'defense doubled TWICE: 3 → 6 → 12');
  assert.equal(effStats(h, repl)[0], 1, 'and the power was never touched');
  finishBattle(h);
});

test('R164 Maelstrom Charger: the copy inherits the cast-cost receipt (R35) — Volatile Toxicity is not re-paid', () => {
  const h = new Harness(13805);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const chg = spawn(h, D, 'Maelstrom Charger');
  const food = spawn(h, D, 'Rampart Guardian');               // the unit the cast cost eats
  giveResources(h, D, 'fire', 1); giveResources(h, D, 'wood', 1);   // Volatile Toxicity: rg/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const defense = effStats(h, food)[1];
  assert.ok(defense > 0, 'the sacrifice has a defense worth measuring');
  pass(h);                                                    // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Volatile Toxicity') });
  pick(h, { unit: food });                                    // R35: the bracket is paid AT CAST
  assert.ok(!ent(h, food), 'the cast cost was paid once, on the way to the stack');
  // R178: the Charger's option is a stage of the CAST WINDOW now, not a
  // trigger — so it is asked here, before anyone has priority, rather than
  // after a pair of passes resolves a trigger off the stack.
  say(h, 'Sacrifice Maelstrom Charger');
  assert.ok(!ent(h, chg), 'the Charger is gone');
  // no second sacrifice is asked for, and none is possible: D has no unit left
  assert.ok(!h.state.decision, 'RAQ: "you DON\'T pay additional cost again" — nothing is asked'); 
  pass(h); pass(h);                                           // the copy resolves
  pass(h); pass(h);                                           // then the original
  const toks = tokensOf(h, D);
  const poisons = toks.filter(t => t.card === 'Poison');
  const fireballs = toks.filter(t => t.card === 'Fireball');
  assert.equal(poisons.length, 2, 'two Poisons — one from the copy, one from the original');
  assert.equal(fireballs.length, 2, 'and two Fireballs');
  assert.deepEqual(poisons.map(t => t.x), [defense, defense],
    'RAQ: "the X value is the one from original spell" — the copy read the same receipt');
  finishBattle(h);
});

// ── what the copy TARGETS ────────────────────────────────────────────────

test('R164 Earthbound Replicator: the copy keeps EVERY target the spell declared, not only me (Fight)', () => {
  const h = new Harness(13806);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const ally = spawn(h, A, 'Rampart Guardian');               // A's ally, Fight's slot 0
  const repl = spawn(h, D, 'Earthbound Replicator');          // 1/3, Fight's slot 1
  giveResources(h, A, 'earth', 1);                            // Fight: e, mana 1
  toNextBattle(h, A);
  // both of A's bodies attack, so both are in the battle region and both are
  // legal for Fight's "target ally" slot
  h.do({ type: 'declareAttack', seat: A, columns: [[atk], [ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Fight') });
  pick(h, { unit: ally });                                    // slot 0: A's ally
  pick(h, { unit: repl });                                    // slot 1: the Replicator
  pass(h); pass(h);                                           // resolve the Replicator trigger
  pick(h, false);                                             // keep the declared targets
  const copy = copies(h)[0]!;
  const declared = copy.parts.flatMap(p => p.targets);
  assert.equal(declared.length, 2,
    '"they COPY IT" copies the spell as it was declared — both slots, not just the carrier. '
    + 'This used to pass [self] and silently throw the ally slot away, so the copy of a '
    + 'two-target spell did nothing at all.');
  assert.ok(declared.some(t => 'unit' in t && t.unit === ally), 'slot 0 survived the copy');
  assert.ok(declared.some(t => 'unit' in t && t.unit === repl), 'slot 1 survived the copy');
  pass(h); pass(h);                                           // the copy resolves: a real fight
  assert.ok(!h.log.some(l => l.includes('Fight: a target is gone')),
    'the copy fought — it did not bail out for want of a second target');
  finishBattle(h);
});

// ── the copy has no card: every disposal path ────────────────────────────

test('R164 Maelstrom Charger: a resolved copy bins nothing, and "Erase me." on a copy erases nothing (Suspend)', () => {
  const h = new Harness(13807);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Maelstrom Charger');
  giveResources(h, D, 'light', 2);                            // Suspend: ll, mana 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                    // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Suspend') });
  pick(h, { player: A });                                     // "target player's life can't change"
  say(h, 'Sacrifice Maelstrom Charger');                      // R178: in the cast window
  say(h, 'Keep the original targets');
  pass(h); pass(h);                                           // the COPY resolves — "Erase me."
  const erasedSuspends = () => (h.state.players[D]!.erased ?? []).filter(c => c === 'Suspend').length;
  assert.equal(erasedSuspends(), 0,
    'a copy is not a card, so its "Erase me." has nothing to erase');
  assert.equal(h.state.players[D]!.bin.filter(c => c === 'Suspend').length, 0,
    'and it certainly does not conjure the card into a bin instead');
  pass(h); pass(h);                                           // then the ORIGINAL resolves
  assert.equal(erasedSuspends(), 1,
    'the ORIGINAL still erases itself, exactly once — its card is real');
  finishBattle(h);
});
