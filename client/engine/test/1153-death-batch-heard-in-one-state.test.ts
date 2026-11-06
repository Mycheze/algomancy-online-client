/**
 * CR 706.8c, 713.6 / CT-532 — A DEATH BATCH MUST BE HEARD THE SAME WHATEVER ORDER IT IS WALKED IN.
 *
 * Report #332 (invi, room CFSG, 2026-11-06): "Cerebrox and the everywhere are
 * in the same fight. combat damage happens, everywhere dies, cerebrox triggers
 * (as it should), but ONLY once, even though 4 cards were trashed during dmg".
 * The Everywhere had named Cerebrox ("Whenever another card is trashed, each
 * other unit gains -1/-1 until regroup"); one combat damage killed Blurf,
 * Prediction Prophet, Flourishing Flora and The Everywhere. `destroyBatch`
 * disposes a batch one body at a time, and each trash asks "is Cerebrox
 * stripped?" of the board AS IT STANDS after the earlier bodies have gone: the
 * three trashes before The Everywhere's find it muted, The Everywhere's own
 * finds it free. Walked the other way round the same batch fires four times.
 * One is right under no reading — the batch is ONE game action (CR 713.6;
 * Caleb, rules-questions 2025-06-02: "Technically it should be within the same
 * game action so I don't think order matters").
 *
 * WHICH single answer — none (the batch is heard as it began, The Everywhere
 * still in play: CR 713.6e's dying Ancient One "still has" its dying
 * neighbour's text) or four (a trash is a card entering a bin, CR 801.2, and
 * by then The Everywhere is not "in that region", CR 712.6; the engine already
 * lets Cerebrox hear a lone The Everywhere's own trash) — is OPEN: it went to
 * the owner on 2026-11-06 (steward handoff report-332). Until he answers, the
 * walk-order dependence is CT-532's live `proof` (83-card-todo runs it), and
 * this file pins only what holds under both readings, plus today's lone-death
 * answer, which the "none" reading would change. The resume run adds the
 * order tests with the number he picks.
 *
 * Seeds 115300-115399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ent } from './util.ts';
import { everywhereBatch } from '../../ledgers/card-todo-helpers.ts';

test('CT-532 control: with The Everywhere naming another card, Cerebrox hears all three trashes of a batch', () => {
  const { h, cerebrox, others, kill } = everywhereBatch(115304, 'Blurf');
  assert.ok(!h.q.abilitiesSuppressed(ent(h, cerebrox)!), 'Cerebrox is not the named card');
  assert.equal(kill(others), 3);
});

test('CT-532 control: The Everywhere naming Cerebrox mutes it for a batch The Everywhere is not in', () => {
  const { h, cerebrox, others, kill } = everywhereBatch(115306);
  assert.ok(h.q.abilitiesSuppressed(ent(h, cerebrox)!), 'setup: The Everywhere has muted Cerebrox');
  assert.equal(kill(others), 0);
});

test('CT-532 pin (open question): today, a lone The Everywhere dying is one trash the Cerebrox it muted hears', () => {
  const { everywhere, kill } = everywhereBatch(115305);
  assert.equal(kill([everywhere]), 1,
    'the strip ends as The Everywhere leaves, before its card is trashed — the "none" reading would make this 0');
});
