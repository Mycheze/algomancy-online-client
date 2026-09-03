/* R197b — "LOOK AT" IS A PRIVATE LOOK. THREE CARDS PUT THE WHOLE HAND IN THE
 * SHARED LOG.
 *
 * ── THE CLASS
 *
 * The pool distinguishes two printed verbs. *"Look at target player's hand"* is
 * a PRIVATE look — you see it, the table does not. *"Target player reveals
 * their hand"* is a PUBLIC reveal — everyone sees it. Five registered cards
 * print the first verb (`allCardNames()` -> printed text, §3 derives the list
 * rather than trusting this comment):
 *
 *   Divine Foresight · Thought Extraction · Eldritch Dreamtender · Bripp ·
 *   Hand Peeper
 *
 * Four of them build a log line naming the whole hand. Only Divine Foresight
 * tagged it `privateTo` (R125's literal-reading audit, batch-light-a:239-247,
 * whose comment names the class outright). Thought Extraction, Eldritch
 * Dreamtender and Bripp carried the IDENTICAL line, untagged. `redactLog`
 * gates on `visibleToSeat`, `visibleToSeat` gates on `data.privateTo`, and an
 * untagged line goes to every seat.
 *
 * ── HOW REACHABLE, HONESTLY (and this is not what the report said)
 *
 * `server/view.ts::other()` is hardcoded 2-seat, so today's game is 1v1. In
 * 1v1 an untagged whole-hand line reaches exactly two seats: the LOOKER and
 * the hand's OWNER — and when the two are different seats, both are already
 * entitled to what it says. So for **Eldritch Dreamtender**, whose `who` is by
 * construction an opponent of `ctx.controller`, the leak is LATENT: real in
 * the code, not observable at a 1v1 table. (The same is true of Divine
 * Foresight, the precedent — it prints "target OPPONENT" and cannot self-aim.)
 *
 * **Thought Extraction and Bripp print "target PLAYER", and both of their
 * targeting comments say in as many words that yourself is a legal choice.**
 * Aim either at your own hand and the looker IS the owner — so the one seat
 * the line reached besides you was your OPPONENT, reading your entire hand.
 * That is materially real, reachable in a shipped 1v1 game, and it is what
 * §1's self-target tests drive. All four are tagged uniformly anyway:
 * `Seat = number` and `players: PlayerState[]` are N-player in the engine's
 * own types, and a `who === ctx.controller ? private : public` test is a
 * denylist of exactly the shape R196 argues against.
 *
 * ── WHY THE ENGINE SUITE COULD NOT SEE IT
 *
 * `Harness` is the HOTSEAT driver: `absorb()` pushes every event's `msg` into
 * one `log`, with no seat separation and no `visibleToSeat` anywhere near it.
 * 42-dark-b asserts `h.log.some(l => l.includes('Thought Extraction reveals'))`
 * and passed before this fix and after it. **So every assertion here goes
 * through `server/view.ts` — `visibleToSeat` for the tag and `redactLog` for
 * the line a seat actually receives.** Asserting on `h.log` cannot fail.
 *
 * ── §2 IS THE CONTROLS, §3 IS THE POINT
 *
 * §2 pins the two shapes a future over-application would break: Hand Peeper
 * (prints "look at", emits NO naming line at all — the private mechanism
 * suffices alone) and Bioremediation (prints "REVEALS their hand", and its
 * untagged line is CORRECT).
 *
 * §3 is the class guard, and it matters more than the three fixes. R196 makes
 * the argument: a per-card fix for a class is this repo's most expensive
 * recurring failure. §3 derives the card list from PRINTED TEXT via
 * `allCardNames()` and sweeps all of `src/` for `.ev(` calls that interpolate
 * hand CONTENTS, then asserts the partition both ways — a "look at" card must
 * tag, a "reveal" card must not. A sixth card added later fails here.
 *
 * Seeds 17300-17399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { allCardNames, getCard } from '../../engine/src/cards/dsl.ts';
import { visibleToSeat } from '../view.ts';
import type { EngineEvent, Seat } from '../../engine/src/types.ts';
import { stripCode } from '../../ledgers/card-todo.ts';
import {
  finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle,
  logFor,
} from '../../engine/test/util.ts';
import '../../engine/src/cards/registry.ts';

/** the one event whose message contains `frag` (asserting there is exactly one) */
function only(h: Harness, frag: string): EngineEvent {
  const hits = h.events.filter(e => e.msg.includes(frag));
  assert.equal(hits.length, 1, `fixture: expected exactly one "${frag}" event, got ${hits.length}`);
  return hits[0]!;
}

/** the private-look contract, said once: the naming line belongs to `looker`
 *  and to nobody else, `secret` never reaches any other seat's log, and the
 *  public "X looks at Y's hand" (if the card writes one) reaches everyone. */
function assertPrivateLook(
  h: Harness, naming: EngineEvent, looker: Seat, others: Seat[], secret: string,
): void {
  assert.ok(naming.msg.includes(secret),
    'fixture: the naming line really does name the planted card — a LOOK still tells the looker');
  assert.equal(visibleToSeat(naming, looker), true,
    'the looker must still get the line: this is a look, not a secret from everyone');
  assert.ok(logFor(h, looker).some(l => l.includes(secret)),
    'and it must survive redactLog into the log the looker is served');
  for (const s of others) {
    assert.equal(visibleToSeat(naming, s), false,
      `server/view.ts::visibleToSeat let the whole hand through to seat ${s}: the line `
      + 'needs { privateTo: <the looker> }, exactly as batch-light-a:246 carries it');
    assert.deepEqual(logFor(h, s).filter(l => l.includes(secret)), [],
      `"${secret}" reached seat ${s}'s log out of a hand server/view.ts::viewFor was `
      + 'serving them as card backs');
  }
}

/* ── §1 · the three defects, one printed clause each ─────────────────────── */

/* "Look at target player's hand and discard a card from it. You gain 1 rot."
 * — Thought Extraction, dd/1 {Battle} Blight Spell. */

test("R197b §1 Thought Extraction: \"Look at target player's hand\" — the hand reaches the LOOKER alone", () => {
  const h = new Harness(17301);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'dark', 2);                             // dd/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // two planted cards: one is discarded (into a PUBLIC bin, where naming it is
  // correct), the other is never touched and is the pure secret.
  h.state.players[D]!.hand = ['Good Whale', 'Shard Sprite'];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Thought Extraction') });
  pick(h, { player: D });
  pass(h); pass(h);                                           // resolve → the discard pick
  pick(h, 0);                                                 // discard 'Good Whale'

  const naming = only(h, 'Thought Extraction reveals');
  assert.ok(naming.msg.includes('Good Whale') && naming.msg.includes('Shard Sprite'),
    'fixture: the line names the WHOLE hand, which is what made it a leak');
  assertPrivateLook(h, naming, A, [D], 'Shard Sprite');

  // and what the table sees instead is E.revealHandTo's line, which names nothing
  const looks = only(h, 'looks at');
  assert.equal(looks.data?.['privateTo'], undefined, 'the "looks at" line is public by design');
  for (const s of [A, D]) {
    assert.ok(logFor(h, s).some(l => l.includes('looks at')),
      `seat ${s} must still be told THAT a look happened — only WHAT was seen is private`);
  }
  assert.ok(!looks.msg.includes('Shard Sprite'), 'and E.revealHandTo names no card');
  assert.ok(h.state.players[D]!.bin.includes('Good Whale'), 'fixture: the discard really happened');
  finishBattle(h);
});

test('R197b §1 Thought Extraction: aimed at YOUR OWN hand, the opponent is the one seat it leaked to', () => {
  const h = new Harness(17302);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'dark', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.hand = ['Good Whale', 'Shard Sprite'];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Thought Extraction') });
  // "target PLAYER" — the targeting comment on this card says the player kind
  // is either seat; aiming at yourself is legal and the printed text allows it.
  pick(h, { player: A });
  pass(h); pass(h);
  pick(h, 0);

  const naming = only(h, 'Thought Extraction reveals');
  // THE REACHABLE CASE. looker === owner, so the only OTHER seat is the
  // opponent — who has no claim on any of it. In 1v1 this is the shape of the
  // class that is not merely latent.
  assertPrivateLook(h, naming, A, [D], 'Shard Sprite');
  assert.deepEqual(logFor(h, D).filter(l => l.includes('Thought Extraction reveals')), [],
    "your opponent read your entire hand off a spell you cast on YOURSELF");
  finishBattle(h);
});

/* "[Augment] When my column deals combat damage to an opponent, sacrifice me.
 * If you do, look at that player's hand and discard a card from it."
 * — Eldritch Dreamtender, m/1 1/1 {Evasive}. */

test("R197b §1 Eldritch Dreamtender: \"look at that player's hand\" — the damaged player's hand is not published", () => {
  const h = new Harness(17303);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
  const dt = spawn(h, A, 'Eldritch Dreamtender');             // 1/1 {Evasive}
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dt]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  h.state.players[D]!.hand = ['Good Whale', 'Shard Sprite'];
  pass(h); pass(h);                                           // combat damage → the trigger (R31)
  pass(h); pass(h);   // R261: it is stacked in the after-combat window; this resolves it
  assert.equal(h.state.decision!.seat, A, 'fixture: the attacker is being asked for the discard');
  pick(h, 0);                                                 // discard 'Good Whale'

  const naming = only(h, 'Eldritch Dreamtender reveals');
  assert.ok(naming.msg.includes('Good Whale') && naming.msg.includes('Shard Sprite'),
    'fixture: the whole hand is in the line');
  // ⚠ 1v1 caveat, stated where it can be read: `who` here is by construction
  // an opponent of `ctx.controller`, so the two seats this untagged line
  // reached were the looker and the owner — both already entitled. The leak is
  // LATENT, and the assertion below is about the line's SCOPE, not about news
  // D did not have: "look at" makes this the looker's line, not the table's.
  assertPrivateLook(h, naming, A, [D], 'Shard Sprite');
  for (const s of [A, D]) {
    assert.ok(logFor(h, s).some(l => l.includes('looks at')),
      `seat ${s} still sees THAT the Dreamtender looked`);
  }
  assert.ok(h.state.players[D]!.bin.includes('Good Whale'), 'fixture: the discard really happened');
  finishBattle(h);
});

/* "[Switch1] Look at target player's hand. You may choose a card from it and
 * recycle that card. If you do, that player draws a card."
 * — Bripp, bb/3 4/2 {Battle} {Feeble} Spell Unit. */

test("R197b §1 Bripp: \"Look at target player's hand\" — and the card it recycles is not named to the table either", () => {
  const h = new Harness(17304);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 5);                            // bb/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Bripp') });
  pick(h, { player: D });
  h.state.players[D]!.hand = ['Good Whale', 'Shard Sprite'];
  pass(h); pass(h);                                           // resolve → the recycle pick
  assert.ok(h.state.decision!.options.some(o => o.value === -1),
    'fixture: "decline" is on the menu — the printed "you MAY"');

  const naming = only(h, 'Bripp reveals');
  assert.ok(naming.msg.includes('Good Whale') && naming.msg.includes('Shard Sprite'),
    'fixture: the line names the WHOLE hand');
  assertPrivateLook(h, naming, A, [D], 'Shard Sprite');
  for (const s of [A, D]) {
    assert.ok(logFor(h, s).some(l => l.includes('looks at')), `seat ${s} sees THAT a look happened`);
  }

  pick(h, 0);                                                 // recycle 'Good Whale'
  // THE SECONDARY LEAK, same card, and the seat it is withheld from is the
  // card's OWNER — deliberately. The name is the LOOKER's because the looker
  // chose it; D needs no log line to learn what left their own hand, which the
  // state channel serves them in full. `redactEvent`'s `recycle` arm is not
  // the route: it keys on `ev.type === 'recycle'`, rewrites the message to
  // "…for a dormant resource" (the resource-step recycle, the wrong reason
  // here), and blurs for every seat BUT the owner — the exact inverse of what
  // is wanted. `E.recycleToBottom` emits no event to piggyback on either.
  const recycles = only(h, 'Bripp recycles Good Whale');
  assert.equal(visibleToSeat(recycles, A), true, 'the looker chose it and is told what it was');
  assert.equal(visibleToSeat(recycles, D), false,
    'a card that went from a hidden hand to the hidden bottom of a deck was named in the '
    + 'shared log, and nothing Bripp prints says "reveal"');
  assert.ok(logFor(h, D).some(l => /Bripp recycles a card from .*; they draw\./.test(l)),
    'what the table gets instead: a card moved, and who drew — never which card');
  assert.equal(h.q.deckOf(D)[h.q.deckOf(D).length - 1], 'Good Whale',
    'fixture: it really is on the bottom of a deck viewFor serves as card backs');
  finishBattle(h);
});

test('R197b §1 Bripp: aimed at YOUR OWN hand, both the hand and the recycled card leaked to the opponent', () => {
  const h = new Harness(17305);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 5);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Bripp') });
  pick(h, { player: A });                                     // "target player" includes yourself
  h.state.players[A]!.hand = ['Good Whale', 'Shard Sprite'];
  pass(h); pass(h);                                           // resolve → the recycle pick

  const naming = only(h, 'Bripp reveals');
  assert.ok(naming.msg.includes('Good Whale') && naming.msg.includes('Shard Sprite'),
    'fixture: the whole of YOUR hand is in the line');
  assertPrivateLook(h, naming, A, [D], 'Shard Sprite');

  pick(h, 0);                                                 // recycle 'Good Whale'
  // THE SECONDARY LEAK, same card. The recycled card went out of a HIDDEN hand
  // and onto the HIDDEN bottom of a deck — `viewFor` maps every entry of both
  // to HIDDEN_CARD — and nothing Bripp prints says "reveal". So the NAME is the
  // looker's; the table gets a line that says a card moved without saying which.
  const recycles = only(h, 'Bripp recycles Good Whale');
  assert.equal(visibleToSeat(recycles, A), true, 'the looker chose it and is told what it was');
  assert.equal(visibleToSeat(recycles, D), false,
    'the opponent was told the name of a card that never left a hidden zone');
  assert.deepEqual(logFor(h, D).filter(l => l.includes('Good Whale')), [],
    'and no line seat D receives names it');
  assert.ok(logFor(h, D).some(l => /Bripp recycles a card from .* they draw\./.test(l)),
    'what the table gets instead: a card moved, and who drew — never which card');
  assert.ok(logFor(h, D).some(l => l.includes('draws 1')),
    "E.draw's own public line still completes the public story");
  assert.equal(h.q.deckOf(A)[h.q.deckOf(A).length - 1], 'Good Whale',
    'fixture: it really is on the bottom of the deck, which viewFor hides');
  finishBattle(h);
});

/* ── §2 · the controls — a private look needs no line, a REVEAL keeps its ─── */

/* "[Augment] Pay 3 life: Look at target player's hand." — Hand Peeper, l/1.
 * Prints the same verb and emits NO naming line at all: `E.revealHandTo` puts
 * the hand in `seenHand[viewer]` (the client's note-taking strip) and writes
 * only the public "X looks at Y's hand". This is the control that shows the
 * private mechanism suffices ALONE — the naming line is a convenience, and a
 * convenience is exactly what must not be public. */

test('R197b §2 control — Hand Peeper: the same printed verb with NO naming line at all, and it still works', () => {
  const h = new Harness(17306);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
  const hp = spawn(h, A, 'Hand Peeper');
  const raider = spawn(h, D, 'Unit Token');
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  pass(h);                                                    // initiative (D) passes → A acts
  h.state.players[D]!.hand = ['Good Whale', 'Shard Sprite'];
  h.do({ type: 'activateAbility', seat: A, entityId: hp, abilityIndex: 0, via: 'augment' });
  pick(h, { player: D });
  pass(h); pass(h);                                           // resolve

  assert.deepEqual(h.state.seenHand[A]!.cards, ['Good Whale', 'Shard Sprite'],
    'the look really happened — seenHand is the private channel that carries it');
  for (const s of [A, D]) {
    assert.deepEqual(logFor(h, s).filter(l => l.includes('Shard Sprite')), [],
      `no line at all names the hand to seat ${s} — not even to the looker`);
    assert.ok(logFor(h, s).some(l => l.includes('looks at')), `and seat ${s} sees THAT it happened`);
  }
  finishBattle(h);
});

/* "Target player reveals their hand. You choose a card from it and put it into
 * your hand." — Bioremediation, ggg/4. A printed REVEAL is PUBLIC, and its
 * untagged line is CORRECT. This is the control a future over-application of
 * `privateTo` reddens against. */

test('R197b §2 control — Bioremediation: a printed REVEAL is public, and its untagged line must stay untagged', () => {
  const h = new Harness(17307);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, D, 'wood', 4);                             // ggg/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                    // priority → D
  h.state.players[A]!.hand = ['Good Whale', 'Shard Sprite'];
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Bioremediation') });
  pick(h, { player: A });
  pass(h); pass(h);                                           // resolve → the take
  pick(h, 0);                                                 // take 'Good Whale'

  const naming = only(h, 'Bioremediation reveals');
  assert.equal(naming.data?.['privateTo'], undefined,
    'REVEALS is the other printed verb: the table is entitled to this line, and tagging '
    + 'it privateTo would be over-applying R197b to the card it does not cover');
  for (const s of [A, D]) {
    assert.equal(visibleToSeat(naming, s), true, `a public reveal reaches seat ${s}`);
    assert.ok(logFor(h, s).some(l => l.includes('Shard Sprite')),
      `including the card that was NOT taken — "reveals their hand" means all of it, to seat ${s}`);
  }
  finishBattle(h);
});

/* ── §3 · THE CLASS GUARD ─────────────────────────────────────────────────
 *
 * Derived from `allCardNames()` + printed text, never hand-typed. Every `.ev(`
 * call anywhere in `src/` that interpolates hand CONTENTS is attributed to the
 * card it names, and the printed verb decides the verdict:
 *
 *   printed "look at …hand"   -> the line MUST carry privateTo
 *   printed "reveals …hand"   -> the line must NOT carry privateTo
 *   printed neither           -> FAIL: decide which verb the card is, in the
 *                                printed text, before it can log a hand
 *
 * ⚠ WHAT THIS SWEEP CANNOT SEE, said plainly rather than left to be
 * discovered. It matches an `\bhand\b` IDENTIFIER surviving `stripCode` inside
 * the call — i.e. an interpolated `${hand.join(…)}` / `${p.hand[i]}`. It is
 * therefore blind to (a) a line naming ONE card taken out of a hand through a
 * local like `${name}` (Bripp's recycle line — no `hand` token survives there,
 * and it is §1's job, not this one's), and (b) a hand published through a
 * helper that takes the names as an argument. (a) is not statically
 * expressible; the runtime invariant that covers it is R196 §2. (b) has no
 * instance in the pool today and would need this sweep widened the day it
 * does. Neither hole is a reason to skip the part that IS expressible.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..', 'engine', 'src');

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsFiles(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

interface EvCall { where: string; code: string; raw: string }

/** every `.ev( … )` call in `raw`, paren-balanced over the STRIPPED text so
 *  that a paren inside a string or a comment cannot unbalance it. */
function evCalls(raw: string, where: string): EvCall[] {
  const code = stripCode(raw);
  const out: EvCall[] = [];
  const re = /\.ev\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    let i = m.index + m[0].length, depth = 1;
    while (i < code.length && depth > 0) {
      const c = code[i];
      if (c === '(') depth++; else if (c === ')') depth--;
      i++;
    }
    const line = raw.slice(0, m.index).split('\n').length;
    out.push({ where: `${where}:${line}`, code: code.slice(m.index, i), raw: raw.slice(m.index, i) });
  }
  return out;
}

/** does this call interpolate hand CONTENTS? `hand.length` is a COUNT and is
 *  already public from the card backs `viewFor` serves, so it is excluded. */
const namesHand = (call: EvCall): boolean =>
  /\bhand\b/.test(call.code.replace(/\bhand\s*\.\s*length\b/g, ''));

const tagged = (call: EvCall): boolean => /\bprivateTo\b/.test(call.code);

/* ⚠ A SWEEP THAT CANNOT FAIL IS WORSE THAN NO SWEEP (R176 / 149-strip-code:
 * `stripCode` has gone blind twice and every sweep resting on it stayed green
 * while it was). So the matcher is asked the question directly, on planted
 * source, before anything is trusted to it. */
test('R197b §3: the hand-naming sweep is not blind — it flags a planted leak and ignores the near misses', () => {
  const one = (src: string): EvCall => {
    const cs = evCalls(src, 'planted');
    assert.equal(cs.length, 1, `fixture: expected one .ev( in ${JSON.stringify(src)}, got ${cs.length}`);
    return cs[0]!;
  };
  const leak = one("g.ev('info', `Foo reveals ${g.pname(w)}'s hand: ${hand.join(', ')}.`);");
  assert.ok(namesHand(leak), 'the ordinary shape — an interpolated hand');
  assert.ok(!tagged(leak), 'and it is untagged');

  const fixed = one("g.ev('info', `Foo reveals ${hand.join(', ')}.`, { privateTo: ctx.controller });");
  assert.ok(namesHand(fixed) && tagged(fixed), 'the same line, tagged, is seen AND seen as tagged');

  // the multi-line shape every real instance actually has
  const wrapped = one("      g.ev('info', `Foo: ${hand.join(', ') || '(empty)'}.`,\n"
    + '        { privateTo: ctx.controller });');
  assert.ok(namesHand(wrapped) && tagged(wrapped),
    'the paren balance must span newlines, or every real instance reads as untagged');

  // near misses that must NOT be flagged
  assert.ok(!namesHand(one("g.ev('info', `${g.pname(w)} has ${g.player(w).hand.length} cards in hand.`);")),
    'a COUNT is not contents — hand size is already public from the card backs');
  assert.ok(!namesHand(one("g.ev('info', `${g.pname(v)} looks at ${g.pname(o)}'s hand.`);")),
    "E.revealHandTo's own public line names nothing: 'hand' there is prose, not an identifier");
  assert.deepEqual(
    evCalls("      // g.ev('info', `Foo reveals ${hand.join(', ')}.`);", 'planted'), [],
    'a commented-out call is not a call');
  assert.deepEqual(
    evCalls("/*\n * a doc line mentioning g.ev('info', `${hand.join(', ')}`) in prose\n */", 'planted')
      .filter(namesHand), [],
    'nor is a line inside a block comment — every real one carries its `/*`, and without '
    + 'the opener stripCode has no way to know it is prose (measured: it does not)');
});

test('R197b §3 class guard: a card that PRINTS "look at …hand" and logs the hand must tag it privateTo', () => {
  const printedOf = (n: string): string => getCard(n).text ?? '';
  // derived from the registry, never hand-typed — `allCardNames()` and not
  // printed.json, because printed.json alone misses `registerSynthetic` cards.
  const LOOKERS = allCardNames().filter(n => /look(s|ed|ing)?\s+at\b/i.test(printedOf(n))
    && /\bhand\b/i.test(printedOf(n)));
  const REVEALERS = allCardNames().filter(n => /reveals?\s+(their|his|her|its)\s+hand/i.test(printedOf(n)));
  assert.ok(LOOKERS.length >= 4,
    `fixture: the printed-text sweep found only ${LOOKERS.length} "look at …hand" cards, which `
    + 'means the matcher or the printed data moved — re-derive before trusting a green');
  assert.ok(REVEALERS.length >= 1, 'fixture: at least one printed public REVEAL must exist as the control');
  assert.deepEqual(LOOKERS.filter(n => REVEALERS.includes(n)), [],
    'a card printing BOTH verbs would need a per-line ruling, not a per-card one');

  // longest-first so "Bripp" can never win over a longer name containing it
  const NAMES = allCardNames().slice().sort((a, b) => b.length - a.length);
  const offenders: string[] = [];
  const seen: string[] = [];
  for (const f of tsFiles(SRC)) {
    const rel = path.relative(SRC, f);
    for (const call of evCalls(fs.readFileSync(f, 'utf8'), rel)) {
      if (!namesHand(call)) continue;
      const owner = NAMES.find(n => call.raw.includes(n));
      if (owner === undefined) {
        offenders.push(`${call.where}: a log line names hand CONTENTS but names no registered card, `
          + 'so this guard cannot tell which printed verb governs it. Put the card name in the line.');
        continue;
      }
      seen.push(owner);
      if (LOOKERS.includes(owner) && !tagged(call)) {
        offenders.push(`${call.where}: ${owner} prints "look at …hand" — a PRIVATE look — and this `
          + 'line publishes the whole hand to every seat. Add { privateTo: <the looker> }, as '
          + 'batch-light-a:246 does (server/view.ts::visibleToSeat is what reads it).');
      }
      if (REVEALERS.includes(owner) && tagged(call)) {
        offenders.push(`${call.where}: ${owner} prints "reveals their hand" — a PUBLIC reveal — so `
          + 'this line belongs to the table. Tagging it privateTo over-applies R197b.');
      }
      if (!LOOKERS.includes(owner) && !REVEALERS.includes(owner)) {
        offenders.push(`${call.where}: ${owner} logs a hand's CONTENTS but its printed text says `
          + 'neither "look at …hand" nor "reveals their hand". Decide which verb it is on the '
          + 'CARD, then tag or do not tag accordingly.');
      }
    }
  }
  assert.deepEqual(offenders, [],
    'the "look at" / "reveals" partition broke. R196: a per-card fix for a class is this '
    + "repo's most expensive recurring failure — fix the class.");

  // and the guard really did look at the cards it claims to cover
  for (const n of ['Divine Foresight', 'Thought Extraction', 'Eldritch Dreamtender', 'Bripp']) {
    assert.ok(seen.includes(n), `${n} must have been reached by the sweep, not silently skipped`);
  }
  assert.ok(seen.some(n => REVEALERS.includes(n)),
    'and at least one public REVEAL must have been reached, or the untagged half of the '
    + 'partition is asserting nothing');
});

/* ── §4 · CT-174(b) / owner report #156 — WHEN THE SNAPSHOT IS TAKEN ───────
 *
 * > *"It'd also be nice if it showed the cards at the END of the 'revealing'
 * > moment so that if they are forcing the opponent to discard a card, that
 * > card isn't included in the list. But be careful with things like Bripp to
 * > make sure that it doesn't include the drawn card."*
 * >                                    — owner report #156, DQVZ, action 119
 *
 * `E.revealHandTo` snapshotted `[...player(owner).hand]` at CALL TIME, and in
 * five of the pool's seven look-at-a-hand sites the very next thing the effect
 * does is take a card out of that hand. DQVZ's own strip still lists the
 * Aberrant Statweaver Rashi was then MADE to trash.
 *
 * ⚠ THE SECOND SENTENCE IS THE SPECIFICATION AND IT RULES OUT THE OBVIOUS FIX.
 * "The hand when the moment ends" is wrong: Bripp recycles a card and the owner
 * then DRAWS, so that hand holds a card the looker never saw. "The hand at the
 * start minus a discard" is a special case pretending to be a rule. The rule is
 * WHAT YOU SAW, MINUS WHAT HAS SINCE LEFT — an intersection, never an addition
 * — and both halves the owner named fall out of it. `E.settleSeenHands`,
 * called once from `settle()` when no question is open.
 *
 * Fixed in the ENGINE and not at the five call sites deliberately: moving each
 * call below its discard satisfies the first sentence and silently fails the
 * second on Bripp, and there would be five chances to get it wrong again plus
 * one more for every site nobody has written yet. §4e is the census that
 * notices the eighth.
 *
 * Seeds 17310-17316.
 */

/** the finished list `viewer` is being shown */
const seen = (h: Harness, viewer: Seat): string[] => h.state.seenHand[viewer]?.cards ?? [];
/** true while the revealing moment is still running */
const provisional = (h: Harness, viewer: Seat): boolean =>
  h.state.seenHand[viewer]?.pending !== undefined;

test('§4a CT-174(b) Eldritch Dreamtender: the card they are MADE to discard is not in the list — the reported case', () => {
  const h = new Harness(17310);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
  const dt = spawn(h, A, 'Eldritch Dreamtender');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dt]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  // TWO copies of one name, which is DQVZ's own shape: being made to discard
  // one must leave the other standing, so the reconciliation is multiset
  // arithmetic and not a set difference.
  h.state.players[D]!.hand = ['Shard Sprite', 'Good Whale', 'Shard Sprite'];
  pass(h); pass(h);                                           // combat damage → the trigger
  pass(h); pass(h);                                           // R261: resolved in the after-combat window

  assert.ok(provisional(h, A),
    'while the discard is still being ASKED the snapshot is not finished — a list settled '
    + 'here would be the bug, and settle() must not reconcile under an open question');
  assert.deepEqual(seen(h, A), ['Shard Sprite', 'Good Whale', 'Shard Sprite'],
    'fixture: the look really did see all three');
  pick(h, 0);                                                 // discard the FIRST Shard Sprite

  assert.equal(provisional(h, A), false, 'the moment ended, so the snapshot is finished');
  assert.deepEqual(seen(h, A), ['Shard Sprite', 'Good Whale'],
    'ONE Shard Sprite left, not both and not neither: the discarded copy is gone and the '
    + 'duplicate the looker also saw is still there');
  assert.ok(h.state.players[D]!.bin.includes('Shard Sprite'), 'fixture: the discard happened');
  assert.deepEqual([...h.state.players[D]!.hand].sort(), ['Good Whale', 'Shard Sprite'],
    'fixture: and the hand agrees with the list');
  finishBattle(h);
});

test('§4b CT-174(b) Bripp: the recycled card goes, and the card they DRAW never appears — the owner\'s own control', () => {
  const h = new Harness(17311);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 5);                            // bb/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Bripp') });
  pick(h, { player: D });
  h.state.players[D]!.hand = ['Good Whale', 'Shard Sprite'];
  h.q.deckOf(D).unshift('Bubb');                              // what they will draw
  pass(h); pass(h);
  assert.deepEqual(seen(h, A), ['Good Whale', 'Shard Sprite'], 'fixture: the look saw both');
  pick(h, 0);                                                 // recycle 'Good Whale' → D draws

  assert.deepEqual(h.state.players[D]!.hand, ['Shard Sprite', 'Bubb'],
    'fixture: the recycled card left and the drawn one arrived — the hand at the END of the '
    + 'moment is NOT the answer, which is exactly what the owner\'s second sentence says');
  assert.deepEqual(seen(h, A), ['Shard Sprite'],
    '"be careful with things like Bripp to make sure that it doesn\'t include the drawn '
    + 'card": Good Whale is gone because it left, and Bubb is absent because it was never '
    + 'seen. An intersection gives both; re-reading the hand gives neither');
  assert.ok(!seen(h, A).includes('Bubb'), 'said once more, plainly: the drawn card is not listed');
  finishBattle(h);
});

test('§4c CT-174(b) Thought Extraction: the same rule on a spell that discards, and the list is FROZEN afterwards', () => {
  const h = new Harness(17312);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'dark', 4);                             // dd/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[D]!.hand = ['Good Whale', 'Shard Sprite', 'Bubb'];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Thought Extraction') });
  pick(h, { player: D });
  pass(h); pass(h);
  pick(h, 0);                                                 // discard 'Good Whale'
  assert.deepEqual(seen(h, A), ['Shard Sprite', 'Bubb'], 'the discarded card is not in the list');

  // ⚠ AND IT STOPS THERE. The snapshot is finished ONCE. A list that kept
  // following the hand would tell the looker about every later discard and
  // play — a live readout of a hidden zone rather than a memory aid, and a
  // strictly worse bug than the one being fixed.
  const before = [...seen(h, A)];
  h.state.players[D]!.hand = [];                              // they play everything
  finishBattle(h);
  assert.deepEqual(seen(h, A), before,
    'their hand emptied and the list did not move: it records what was SEEN, and the moment '
    + 'it was seen in is over');
});

test('§4d CT-174(b) the other two shapes — a card TAKEN out of the hand (Bioremediation) and one CACHED (Divine Foresight)', () => {
  // a TAKE: the card leaves their hand for the looker's own, so it must drop
  // out of the list — the looker is holding it and needs no reminder.
  const h = new Harness(17313);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, D, 'wood', 4);                             // ggg/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                    // priority → D
  h.state.players[A]!.hand = ['Good Whale', 'Shard Sprite'];
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Bioremediation') });
  pick(h, { player: A });
  pass(h); pass(h);
  pick(h, 0);                                                 // take 'Good Whale'
  assert.deepEqual(seen(h, D), ['Shard Sprite'],
    'the taken card left their hand, so it leaves the list — it is in the looker\'s hand now');
  assert.ok(h.state.players[D]!.hand.includes('Good Whale'), 'fixture: the take happened');
  finishBattle(h);

  // a CACHE: same rule, a third exit from the hand
  const g2 = new Harness(17314);
  toDeployment(g2);
  const B = g2.state.initiative as Seat, E = (1 - B) as Seat;
  const a2 = spawn(g2, B, 'Unit Token');
  giveResources(g2, B, 'light', 4);                           // ll/1
  toNextBattle(g2, B);
  g2.do({ type: 'declareAttack', seat: B, columns: [[a2]] });
  g2.state.players[E]!.hand = ['Good Whale', 'Shard Sprite'];
  g2.do({ type: 'playCard', seat: B, handIndex: give(g2, B, 'Divine Foresight') });
  pick(g2, { player: E });
  pass(g2); pass(g2);
  pick(g2, 0);                                                // they cache 'Good Whale'
  assert.deepEqual(seen(g2, B), ['Shard Sprite'],
    'a cached card has left the hand too — the list is about the HAND, not about what the '
    + 'looker happens to know');
  finishBattle(g2);
});

test('§4e CT-174(b) census: every look-at-a-hand site in the pool is drilled above, or says why it needs no fix', () => {
  // Derived from SOURCE, not from a list: every `g.revealHandTo(` call in
  // src/cards/sets, attributed to the nearest enclosing `card('…')` or
  // `const <effect>` above it. Adding an eighth site and forgetting the
  // reconciliation is exactly how report #156 would come back.
  const SETS = path.join(HERE, '../../engine/src/cards/sets');
  const sites = new Map<string, string>();          // owner → file
  for (const f of fs.readdirSync(SETS).filter(n => n.endsWith('.ts'))) {
    let owner = `(file scope of ${f})`;
    for (const line of fs.readFileSync(path.join(SETS, f), 'utf8').split('\n')) {
      const m = /^card\('([^']+)'/.exec(line) ?? /^const (\w+)/.exec(line);
      if (m) owner = m[1]!;
      if (/\bg\.revealHandTo\(/.test(line)) sites.set(owner, f);
    }
  }
  // the two sites that sit inside a named effect const rather than directly in
  // a card() block — spelled out so a MOVED site fails loudly instead of
  // quietly renaming itself into the exempt list
  const ALIAS: Record<string, string> = { brippEffect: 'Bripp', voidMemory: 'Void Memory' };
  const cards = [...sites.keys()].map(k => ALIAS[k] ?? k).sort();

  /** the sites that need no reconciliation, each with the reason it does not */
  const NOTHING_LEAVES: Record<string, string> = {
    'Hand Peeper':
      '"[Augment] Pay 3 life: Look at target player\'s hand." — the whole card is the look. '
      + 'Nothing else happens inside the moment, so the snapshot and the reconciliation '
      + 'agree by construction.',
    'Void Memory':
      '"Each opponent discards a [unit or spell] if able. OTHERWISE, they reveal their '
      + 'hand." — the reveal is in the `!able.length` branch, i.e. the branch reached only '
      + 'when that opponent CANNOT discard, and it `continue`s straight past the discard. '
      + 'The discarding branch never calls revealHandTo at all (R284/batch-metal-c), so no '
      + 'card can leave a hand this card has snapshotted.',
  };
  /** the sites §4a-§4d drive, each through the real card */
  const DRILLED = ['Bioremediation', 'Bripp', 'Divine Foresight', 'Eldritch Dreamtender',
    'Thought Extraction'];

  assert.deepEqual(cards, [...DRILLED, ...Object.keys(NOTHING_LEAVES)].sort(),
    'a look-at-a-hand site in src/cards/sets is neither drilled in §4a-§4d nor listed in '
    + 'NOTHING_LEAVES with a reason. Do not add it to the exempt list to make this pass: '
    + 'the question is whether anything leaves that hand inside the effect, and if it does, '
    + 'the card belongs in the drill.');
  assert.equal(cards.length, 7, 'seven sites — the number report #156 was measured against');
  for (const [name, why] of Object.entries(NOTHING_LEAVES)) {
    assert.ok(why.length >= 40, `the exemption for ${name} needs a real written reason`);
  }
  // ⚠ docs/13 §5: a census that covers seven sites and meaningfully checks one
  // is the failure this repo has already paid for. FIVE of the seven are driven
  // through the real card above, and they are five DIFFERENT exits from a hand
  // — discard (two cards), recycle-and-draw, take, cache.
  assert.ok(DRILLED.length >= 5, 'the drill must cover every site where a card can leave');
});
