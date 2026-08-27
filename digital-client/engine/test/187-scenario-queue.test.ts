/* R217 — the scenario queue keeps its properties, and its inputs cannot go
 * blind without saying so.
 *
 * `docs/14-scenario-tester.md` §7. The queue decides what the OWNER spends his
 * hour on, and he can do about 40 cards in one. So the failure that matters
 * here is not "the queue is empty" — that is loud — it is **the queue quietly
 * getting smaller or worse while still looking like a queue.**
 *
 * That already happened once, before this file existed. The ranking scraped
 * `UNREACHED` out of `84-card-semantics.test.ts` and read 32 of 37 keys,
 * because five card names are written as bare identifiers rather than quoted
 * strings. All five were `BOARD` entries — the ones only a human can set up —
 * and two of them rank 3rd and 4th. Nothing failed. The queue just came out
 * five cards shorter, and every one it lost was worth more than the median
 * card it kept.
 *
 * So §1 is not a formality. It is the positive control docs/13-assessment.md
 * §7.4 asks for, applied to the queue's inputs rather than to its output.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/index.ts';
import { allCardNames } from '../src/cards/dsl.ts';
import { UNREACHED_CARDS, UNWITNESSED_CARDS, WITNESSED, unreachedOpener } from './unreached.ts';
import { buildQueue, rankCards, rulingWeight } from './scenario-queue.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTER = readFileSync(join(HERE, '..', '..', 'docs', 'digital-rules.md'), 'utf8');

/* ══ §1 · THE INPUTS CAN SEE ══════════════════════════════════════════ */

test('R217 §1: the UNREACHED ledger is imported whole — 37 cards, not a scrape of 32', () => {
  // The exact number the scrape got wrong. If the ledger legitimately changes,
  // this fails and names it — which is the point: the queue's contents should
  // never move silently.
  // 37 -> 36 on 2026-08-26: SLAG SPEWER LEFT THE LEDGER. It was the sole
  // EVENTLESS entry — "implemented, really happens, and nothing in the game can
  // see it happen" — and R219 (an erased card goes to the erased pile) made its
  // promise observable. The category is now empty and gone from the partition.
  // A card leaving this ledger is the good direction; the assertion exists so
  // it cannot happen SILENTLY, and this is it working.
  assert.equal(UNREACHED_CARDS.length, 36,
    `the UNREACHED ledger now has ${UNREACHED_CARDS.length} cards, not 36. If that is a real `
    + 'change (a card was reached, or a new one went unreached) update this number AND re-read '
    + 'the queue — every entry here is a card only a human can set up. If it is NOT a real '
    + 'change, something is reading the ledger wrongly again.');

  // the five the scrape dropped, by name, because they are the proof
  // ⚠ 'Slag Spewer' is deliberately NOT in this list any more — see above.
  for (const card of ['Worldbender', 'Nothyr', 'Proph', 'Skybreaker', 'Vengeance']) {
    assert.ok(UNREACHED_CARDS.includes(card),
      `${card} is one of the five entries written as a BARE identifier that the original file `
      + 'scrape could not see. If it has left the ledger, say so deliberately — do not let it '
      + 'disappear the way it did the first time.');
  }
});

/**
 * The witness record and the queue must not be able to drift apart. They are
 * one fact expressed twice — `unreached.ts` says who watched what, the queue
 * reports it — and the way that fact rots is somebody adding a card to one and
 * not the other. So: derived, then asserted derived.
 *
 * 21 of the 36 were witnessed in the owner's 2026-08-27 pass (docs/14 §5). The
 * count is asserted for the same reason §1 asserts 36: a witness record that
 * silently shrinks would quietly re-add cards to a queue he has already judged,
 * and he would notice by being asked the same question twice.
 */
test('the witness record and the queue agree on who has been watched', () => {
  const witnessed = Object.keys(WITNESSED);
  assert.equal(witnessed.length, 21,
    'the witness record changed — update this count in the same commit');
  for (const card of witnessed) {
    assert.ok(UNREACHED_CARDS.includes(card),
      `${card} is witnessed but not in UNREACHED — a witness for a card the drill `
      + 'already reaches is a note about nothing');
    assert.ok(!UNWITNESSED_CARDS.includes(card),
      `${card} is in both lists — UNWITNESSED_CARDS is meant to be derived`);
  }
  assert.equal(UNWITNESSED_CARDS.length, UNREACHED_CARDS.length - witnessed.length,
    'the two halves must partition the ledger exactly');

  // and the queue reports it, so the next author does not re-ask a settled card
  const ranked = rankCards(REGISTER);
  for (const card of witnessed) {
    const row = ranked.find(r => r.card === card);
    if (!row) continue;                       // scored zero; nothing to report on
    assert.ok(row.witnessed && row.why.includes('WITNESSED'),
      `${card} has a human verdict but the queue does not say so`);
  }
  for (const card of UNWITNESSED_CARDS) {
    const row = ranked.find(r => r.card === card);
    assert.ok(!row?.witnessed, `${card} is marked witnessed and has no verdict behind it`);
  }
});

test('R217 §1: every ledger entry declares an opener the queue can rank on', () => {
  for (const card of UNREACHED_CARDS) {
    const opener = unreachedOpener(card);
    assert.ok(opener && /^[A-Z]+$/.test(opener),
      `${card}'s UNREACHED entry does not open with a category, so the queue cannot say WHY it `
      + 'is unreached and the owner cannot tell a board problem from a vocabulary one');
  }
});

test('R217 §1: the ruling weight ignores short names — a signal that fires on prose is worse than none', () => {
  // "Rook" appears inside ordinary sentences constantly and topped the first
  // draft for no reason. Short names score zero on purpose.
  assert.equal(rulingWeight('Rook', REGISTER), 0, 'a four-letter name must not be counted');
  assert.equal(rulingWeight('Void Mandible', 'R1 Void Mandible does. R2 Void Mandible also.'), 2);
  assert.equal(rulingWeight('Void Mandible', 'nothing here'), 0,
    'the weight must be capable of returning zero, or it is not measuring anything');
  // word boundaries, not substrings
  assert.equal(rulingWeight('Glimpse Card', 'Big Glimpse Cardigan'), 0,
    'a substring match would count an unrelated word — that is how the first draft ranked wrongly');
});

/* ══ §2 · THE QUEUE KEEPS ITS PROPERTIES ══════════════════════════════ */

test('R217 §2: every unreached card is in the queue — they are the reason it exists', () => {
  const queue = buildQueue(REGISTER);
  const inQueue = new Set(queue.map(q => q.card));
  const missing = UNREACHED_CARDS.filter(c => !inQueue.has(c));
  assert.deepEqual(missing, [],
    'a card with a printed promise the drill has NEVER observed is exactly what a human tester '
    + 'is for, and these are not being offered to him');
});

test('R217 §2: the queue is interleaved — no more than two augment cards in a row', () => {
  const queue = buildQueue(REGISTER);
  let run = 0;
  for (const [i, q] of queue.entries()) {
    run = q.augment ? run + 1 : 0;
    assert.ok(run <= 2,
      `positions ${i - 2}..${i} are all [Augment] cards. Ranked by score alone the top of this `
      + 'queue is almost solid augment — spreading it is deliberate, because a session that '
      + 'proves one mechanism deeply is a worse hour than one that spreads (docs/14 §7)');
  }
});

test('R217 §2: the queue is ordered, bounded, and drawn from the real pool', () => {
  const queue = buildQueue(REGISTER, 40);
  assert.equal(queue.length, 40, 'the limit is honoured');
  const pool = new Set(allCardNames());
  for (const q of queue) {
    assert.ok(pool.has(q.card), `${q.card} is not a registered card — the queue has gone stale`);
    assert.ok(q.why.length > 0, `${q.card} is in the queue with no reason recorded`);
  }
});

test('R217 §2: the ranking discriminates — it is not just returning the pool in name order', () => {
  // A ranking that scores everything equally still produces a plausible-looking
  // queue. Assert it actually separates.
  const ranked = rankCards(REGISTER);
  assert.ok(ranked.length > 100, `only ${ranked.length} cards scored above zero — the signals are dead`);
  assert.ok(ranked.length < allCardNames().length,
    'every single card scored — the ranking is not discriminating between them');
  assert.ok(ranked[0]!.score > ranked[ranked.length - 1]!.score * 2,
    'the top of the ranking is barely above the bottom, so the order carries no information');
  // and the top of the list must be dominated by the things we said matter
  const top20 = ranked.slice(0, 20);
  assert.ok(top20.filter(r => r.unreached ?? r.augment).length >= 15,
    'the top of the queue should be unreached and augment cards — if it is not, the weights have '
    + 'drifted away from what docs/14 §7 argues for');
});
