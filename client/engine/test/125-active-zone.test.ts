/* R145 — THE ACTIVE ZONE: in play and the stack.
 *
 * Bena, 2026-08-25: "in play and the stack are active zones (which is relevant
 * for cards that have unstable). When Statweaver, which has Unstable
 * naturally, gets negated from the stack, it should be erased."
 *
 * That sentence supplies the missing half of a definition Caleb wrote and
 * never finished. The rules-bot glossary he posted 2025-03-12 reads:
 *
 *   "Unstable": "If an unstable card would enter a bin from an ACTIVE ZONE,
 *                erase it instead. This attribute is not shared in formation."
 *
 * — and nowhere in the whole rulings corpus does the phrase "active zone"
 * appear again, so nowhere does he say WHICH zones are active. Caleb supplied
 * the PHRASE; Bena supplied the ZONE LIST. Play and the stack are active.
 * Hand, deck, bin, cache and the erased pile are not.
 *
 * The defect: `E.isUnstable(entity)` unions four sources INCLUDING the printed
 * face, so the in-play half was right. The stack had no equivalent —
 * `negate()` and `dischargeItem()` each computed
 * `(augments?.length ?? 0) > 0 || unstable === true` by hand, and the two
 * virus-fizzle sites in `resolveItem` called `toBin(..., 'stack')` raw. Four
 * places, none of which consulted the printed type line, so a printed-Unstable
 * card leaving the stack BINNED.
 *
 * Printed {Unstable} is exactly two cards pool-wide (test 11 pins that):
 * Aberrant Statweaver and Oorblak. Both are `kind:'unit'`, `timing:'deploy'`
 * and both are also {Virus} — and that combination is not a coincidence, it is
 * the ONLY route either card has to the stack. A deploy unit played normally
 * goes through `castChain(..., 'resolve')` with no stack window at all, so the
 * only way to catch one mid-flight is to play it as a battle Virus augment,
 * which builds a `kind:'virus'` StackItem that can be negated or can fizzle.
 *
 * ⚠ BOTH DIRECTIONS MATTER. A naive fix that erases printed-Unstable cards
 * wherever they go is wrong, and tests 5-10 are what catch it: Caleb rules the
 * inactive-zone case the other way, and the whole point of "from an active
 * zone" is that there are zones it does not cover.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { EntityId, Seat } from '../src/types.ts';
import {
  ent, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, absorb,
} from './util.ts';
import '../src/cards/registry.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';

const binOf = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.bin;
const erasedOf = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.erased ?? [];
const count = (xs: string[], n: string): number => xs.filter(c => c === n).length;
const trashesOf = (h: Harness, card: string): unknown[] =>
  h.events.filter(ev => ev.type === 'trashed' && ev.data?.['card'] === card);

/** the house white-box poke: run `fn` against a live E and ABSORB its events
 * back into the harness — several assertions below are about the 'trashed'
 * event, which is invisible if the events are dropped on the floor. */
/** util.ts's withE, WITHOUT the settle(): these cases put a card in a zone and
 *  look at it before any trigger runs. Named so 284-util-is-not-shadowed can
 *  tell a deliberate variant from a stale copy. */
function withEUnsettled(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  fn(e);
  h.state = e.s;
  absorb(h, e.events);
}

/** no card in ANY bin, and no card in ANY erased pile — the two assertions
 * every case below makes, so neither can be forgotten on one side. */
function nowhereBut(h: Harness, card: string, where: 'bin' | 'erased', seat: Seat): void {
  const other = (1 - seat) as Seat;
  if (where === 'erased') {
    assert.equal(count(erasedOf(h, seat), card), 1, `${card} is in ${seat}'s ERASED pile`);
    assert.equal(count(binOf(h, 0), card) + count(binOf(h, 1), card), 0,
      `${card} reached a bin, and an Unstable card leaving an active zone must not`);
  } else {
    assert.equal(count(binOf(h, seat), card), 1, `${card} is in ${seat}'s BIN`);
    assert.equal(count(erasedOf(h, 0), card) + count(erasedOf(h, 1), card), 0,
      `${card} was erased, and a card leaving an INACTIVE zone must not be`);
  }
  assert.equal(count(erasedOf(h, other), card) + count(binOf(h, other), card), 0,
    'R65: it lands in its OWN owner\'s pile, not the opponent\'s');
}

/** A live attack window in `A`'s battle with one vanilla attacker of A's, both
 * seats holding priority in a region with a unit in it. Priority is A's.
 * (Same shape as 67-resolving-and-stack-viruses' helper.) */
function attackWindow(seed: number): { h: Harness; A: Seat; D: Seat; atk: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');           // 3/3, no attrs, no triggers
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.equal(h.state.decision, null, 'a vanilla attacker asks nothing');
  return { h, A, D, atk };
}

/** D plays `virus` from hand as a battle Virus augment onto the attacker, and
 * A is left holding priority with the virus item on the stack. `mana` is the
 * affinity D is given (every printed Virus here is mono-coloured). */
function virusOnStack(seed: number, virus: string, kind: 'metal' | 'earth'):
{ h: Harness; A: Seat; D: Seat; atk: EntityId; item: number } {
  const w = attackWindow(seed);
  const { h, A, D, atk } = w;
  const mana = getCard(virus).mana;
  assert.notEqual(mana, 'X', `${virus} costs X — this helper pays a fixed cost`);
  giveResources(h, D, kind, mana as number);
  giveResources(h, A, 'wood', 2);                    // Hush Mush gg/2, "negate target effect"
  pass(h);                                           // priority → D
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, virus), hostId: atk });
  const item = h.state.stack.find(i => i.kind === 'virus' && i.card === virus);
  assert.ok(item, `${virus} is on the stack as a kind:'virus' item`);
  return { ...w, item: item.id };
}

/** A negates the item with Hush Mush and both players let it resolve. */
function negateWithHushMush(h: Harness, A: Seat, itemId: number): void {
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Hush Mush') });
  pick(h, { stack: itemId });
  pass(h); pass(h);
  assert.ok(!h.state.stack.some(i => i.id === itemId), 'the negated item left the stack');
}

// ══ POSITIVE: leaving an ACTIVE zone (the stack) erases ═══════════════════

test('R145: Aberrant Statweaver negated off the stack is ERASED, not binned', () => {
  // The owner's own worked example. Caleb rules the general shape directly,
  // rules-questions 2025-09-13, answering "negated spells go to the bin, even
  // if they were played from the bin?" — "Yes, although most ways to play
  // spells from the bin give them unstable", then posting Spell Excavation:
  // "So they would be erased if you used something like this and it got
  // negated." Statweaver does not need the grant; it PRINTS {Unstable}.
  const { h, A, D, item } = virusOnStack(7450, 'Aberrant Statweaver', 'metal');
  negateWithHushMush(h, A, item);
  nowhereBut(h, 'Aberrant Statweaver', 'erased', D);
  assert.ok(h.log.some(l => l.includes('Aberrant Statweaver') && l.includes('erased (Unstable)')),
    'and the negation log says where it actually went');
  assert.equal(trashesOf(h, 'Aberrant Statweaver').length, 0,
    'R40: it came from the stack, so it was never trashed either');
});

test('R145: Oorblak — the other printed {Unstable} card — is erased the same way', () => {
  // Two cards print it; a fix that only reached one of them is a fix that
  // special-cased a name instead of reading the face.
  const { h, A, D, item } = virusOnStack(7451, 'Oorblak', 'earth');
  negateWithHushMush(h, A, item);
  nowhereBut(h, 'Oorblak', 'erased', D);
});

test('R145: a printed-Unstable virus whose HOST DIES fizzles to the erased pile', () => {
  // The second bypass, and the nastier one: `resolveItem`'s two virus-fizzle
  // branches called `toBin(item.controller, item.card!, 'stack')` RAW, so they
  // skipped `dischargeItem` — and therefore the Unstable check — entirely.
  // Manual p.34 ("if a virus is negated or its target becomes invalid, it is
  // placed into the bin") still governs an ordinary virus; see test 5. This
  // one is Unstable in its own right and the stack is an active zone.
  const { h, D, atk, item } = virusOnStack(7452, 'Aberrant Statweaver', 'metal');
  withEUnsettled(h, e => { e.destroy(ent(h, atk)!, 'dies'); e.settle(); });
  assert.equal(ent(h, atk), undefined, 'the host is gone before the virus resolves');
  pass(h); pass(h);                                  // the virus item resolves → fizzles
  assert.ok(!h.state.stack.some(i => i.id === item), 'the fizzled item left the stack');
  assert.ok(h.log.some(l => l.includes('fizzles') && l.includes('erased (Unstable)')),
    'the fizzle names its own destination rather than claiming "→ bin"');
  nowhereBut(h, 'Aberrant Statweaver', 'erased', D);
});

test('R145 keeps R79: a MODDED ordinary spell negated off the stack is still erased', () => {
  // The regression pin. The old expression that missed the printed face got
  // this case RIGHT, and the whole change is a widening of it — if sharing the
  // predicate broke the derived case, the sharing is what is wrong.
  const { h, A, D } = attackWindow(7453);
  giveResources(h, D, 'fire', 4);                    // Arc Lightning rr/4
  giveResources(h, D, 'earth', 2);                   // Chitin Shredder ee/2
  giveResources(h, A, 'wood', 2);
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Arc Lightning') });
  pick(h, { player: A });
  pass(h);                                           // A declines to answer
  const carrier = h.state.stack.find(i => i.card === 'Arc Lightning')!;
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Chitin Shredder'), hostStack: carrier.id });
  pass(h); pass(h);                                  // the virus attaches
  assert.deepEqual(h.state.stack.find(i => i.card === 'Arc Lightning')!.augments,
    [{ card: 'Chitin Shredder', by: D }]);
  negateWithHushMush(h, A, carrier.id);
  nowhereBut(h, 'Arc Lightning', 'erased', D);
  nowhereBut(h, 'Chitin Shredder', 'erased', D);
});

// ══ NEGATIVE: the guards against over-reach ══════════════════════════════

test('R145 negative control: a NON-Unstable virus negated off the stack still BINS', () => {
  // Caleb, rules-questions 2025-03-31: Q "Negating an augment puts it in the
  // bin or erase?" → A "Into the bin". This is the case that makes the printed
  // check a CHECK: if leaving the stack erased everything, this answer would
  // be wrong and R79's Manual p.34 line would have no cases left at all.
  const { h, A, D, item } = virusOnStack(7454, 'Chitin Shredder', 'earth');
  assert.equal(getCard('Chitin Shredder').unstable ?? false, false, 'it prints no {Unstable}');
  negateWithHushMush(h, A, item);
  nowhereBut(h, 'Chitin Shredder', 'bin', D);
  assert.equal(trashesOf(h, 'Chitin Shredder').length, 0,
    'R40: still not a trash — the bin entry came from the stack');
});

test('R145: a printed-Unstable card DISCARDED FROM HAND bins and TRASHES — hand is inactive', () => {
  // The question playtest-ledger #89 left explicitly open ("whether a
  // printed-Unstable card discarded from hand is also erased is unsourced and
  // deliberately unchanged"). "From an active zone" is the source, and it
  // settles it in the direction of "no": the hand is not an active zone, so
  // nothing replaces the bin entry, and R40 trashes it like any other discard.
  const h = new Harness(7455);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const idx = give(h, P, 'Aberrant Statweaver');
  withEUnsettled(h, e => { e.discardFromHand(P, idx); });
  nowhereBut(h, 'Aberrant Statweaver', 'bin', P);
  assert.equal(trashesOf(h, 'Aberrant Statweaver').length, 1, 'and it was trashed (R40)');
});

test('R145: a printed-Unstable card MILLED from the deck bins and trashes — deck is inactive', () => {
  const h = new Harness(7456);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  withEUnsettled(h, e => { e.deckOf(P).unshift('Oorblak'); e.mill(P, 1); });
  nowhereBut(h, 'Oorblak', 'bin', P);
  assert.equal(trashesOf(h, 'Oorblak').length, 1, 'R40: from the deck, so trashed');
});

test('R145: a printed-Unstable card binned from the CACHE bins and trashes (R41) — cache is inactive', () => {
  const h = new Harness(7457);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  withEUnsettled(h, e => {
    e.cacheCard(P, 'Aberrant Statweaver', 'effect');
    const taken = e.uncache(P, 0)!;
    e.toBin(P, taken.card, 'cache');
  });
  nowhereBut(h, 'Aberrant Statweaver', 'bin', P);
  assert.equal(trashesOf(h, 'Aberrant Statweaver').length, 1, 'R41/R40: from the cache, so trashed');
});

test('R145: RECALLING an Unstable unit puts the CARD IN HAND — Unstable never fires', () => {
  // Caleb, 2025-04-16: "unstable doesn't stop recalling. So you could recall
  // aberrant statweaver for example if it was in play." Which follows from the
  // glossary without needing a second ruling: Unstable replaces a BIN entry,
  // and a hand is not a bin, so play → hand is untouched however active the
  // origin zone is. The active-zone list changes nothing here, and this is the
  // pin that says so.
  const h = new Harness(7458);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const u = spawn(h, P, 'Aberrant Statweaver');
  assert.ok(h.q.isUnstable(ent(h, u)!), 'it is Unstable in play, off the printed face');
  withEUnsettled(h, e => { e.recall(ent(h, u)!); });
  assert.equal(count(h.state.players[P]!.hand, 'Aberrant Statweaver'), 1, 'the card is in hand');
  assert.equal(count(binOf(h, P), 'Aberrant Statweaver'), 0);
  assert.equal(count(erasedOf(h, P), 'Aberrant Statweaver'), 0, 'nothing was erased');
});

test('R145: Unstable is NOT shared in formation — a modded unit\'s column-mate still bins', () => {
  // Printed rules, Algomancy-Manual.txt, the NON-COMBAT ATTRIBUTES sidebar:
  // "Some attributes, like burst and unstable, are written in a purple text.
  // These attributes are referred to as non-combat attributes… These
  // attributes ARE NOT SHARED IN FORMATION, and simply exist to modify cards."
  // Caleb's glossary line says the same thing in its second sentence.
  //
  // The engine gets this right STRUCTURALLY — Unstable is deliberately not an
  // `Attr`, so `colAttrs`/`effAttrs` have no way to carry it (test 11 pins
  // that end). This is the behavioural end: two units in one attacking column,
  // one of them modded and therefore Unstable (R69), and the mate that dies
  // does NOT inherit the erase.
  const h = new Harness(7459);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  // two of the pool's ONE fully vanilla unit (no attrs, no text, no triggers),
  // so the column holds nothing that could confuse the answer. Only the mate
  // dies, so the single bin entry below is unambiguously its.
  const modded = spawn(h, P, 'The Foretold');
  const mate = spawn(h, P, 'The Foretold');
  giveResources(h, P, 'earth', 2);
  h.do({ type: 'augment', seat: P, from: 'hand', index: give(h, P, 'Chitin Shredder'), hostId: modded });
  toNextBattle(h, P);
  h.do({ type: 'declareAttack', seat: P, columns: [[modded, mate]] });
  const q = h.q;
  assert.ok(q.isUnstable(ent(h, modded)!), 'the modded unit IS Unstable (R69)');
  assert.ok(!q.isUnstable(ent(h, mate)!), 'its column-mate is NOT');
  assert.deepEqual(q.columnOf(modded), q.columnOf(mate), 'and they really are column-mates');
  const shared = q.effAttrs(ent(h, mate)!);
  assert.ok(!shared.has('Unstable') && !shared.has('Burst'),
    'no non-combat attribute is in the shared column set');
  withEUnsettled(h, e => { e.destroy(ent(h, mate)!, 'dies'); e.settle(); });
  assert.ok(ent(h, modded), 'the modded unit is still standing — only the mate died');
  nowhereBut(h, 'The Foretold', 'bin', P);
  assert.equal(trashesOf(h, 'The Foretold').length, 1,
    'R137: it binned and TRASHED from play like any non-Unstable death');
});

// ══ CONFORMANCE ══════════════════════════════════════════════════════════

test('R145 census: printed {Unstable} is exactly two cards, and no non-combat attribute is an Attr', () => {
  const printed = allCardNames().filter(n => getCard(n).unstable === true).sort();
  assert.deepEqual(printed, ['Aberrant Statweaver', 'Oorblak'],
    'the printed-{Unstable} population — if this changed, every stack/death path above '
    + 'needs re-reading against the new card, and docs/digital-rules.md R145 needs updating');
  // The structural half of "not shared in formation" (Manual sidebar): the
  // column-sharing layer projects `Attr`s and nothing else, so keeping
  // Unstable and Burst OUT of `attrs` is what makes sharing impossible rather
  // than merely absent. Today that is true only by construction — `unstable`
  // and `burst` are their own boolean fields on CardDef — and this is the pin
  // that stops a future extractor from "tidying" them into the attrs array.
  const offenders: string[] = [];
  for (const n of allCardNames()) {
    const c = getCard(n);
    for (const a of c.attrs) {
      if (/^(unstable|burst)$/i.test(a)) offenders.push(`${n}: ${a}`);
    }
    if (c.unstable !== undefined) assert.equal(typeof c.unstable, 'boolean', `${n}.unstable`);
    assert.equal(typeof c.burst, 'boolean', `${n}.burst`);
  }
  assert.deepEqual(offenders, [],
    'a NON-COMBAT attribute reached the attrs array, where colAttrs would share it up the '
    + 'column — the Manual says non-combat attributes are not shared in formation');
});
