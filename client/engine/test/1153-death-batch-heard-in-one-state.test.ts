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
 * WHICH single answer went to the owner (steward handoff report-332,
 * 2026-11-06), and he answered on 2026-11-07: "A - none". The departure is
 * heard as it began, with The Everywhere still in play, so the Cerebrox it
 * muted hears none of the four (CR 713.6f) — the reading CR 713.6e's dying
 * Ancient One already takes for abilities a batch-mate lends. The same holds
 * for a lone The Everywhere leaving play: its own trash is not heard either,
 * which changed the engine's answer there from 1 to 0.
 *
 * Seeds 115300-115399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ent, withE } from './util.ts';
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

test('CR 713.6f / CT-532: The Everywhere dying last in the batch with three other cards — the Cerebrox it muted hears none of the four', () => {
  const { others, everywhere, kill } = everywhereBatch(115307);
  assert.equal(kill([...others, everywhere]), 0);
});

test('CR 713.6f / CT-532: the same batch with The Everywhere first — still none, the walk order does not matter', () => {
  const { others, everywhere, kill } = everywhereBatch(115308);
  assert.equal(kill([everywhere, ...others]), 0);
});

test('CR 713.6f / CT-532: a muted Cerebrox dying in the batch alongside The Everywhere hears none of its batch-mates', () => {
  const { cerebrox, others, everywhere, kill } = everywhereBatch(115309);
  assert.equal(kill([everywhere, cerebrox, ...others]), 0);
});

test('CR 713.6f / CT-532: a lone The Everywhere dying is not heard by the Cerebrox it muted', () => {
  const { everywhere, kill } = everywhereBatch(115305);
  assert.equal(kill([everywhere]), 0);
});

test('CR 713.6f / CT-532: nor when it leaves play on its own outside any batch (deleted by an effect)', () => {
  const { h, cerebrox, everywhere } = everywhereBatch(115310);
  let n = -1;
  withE(h, e => {
    const queued = () => e.s.triggerQueue.filter(t => t.sourceCard === 'Cerebrox').length;
    const before = queued();
    e.destroy(e.entity(everywhere)!, 'is deleted');
    n = queued() - before;
  });
  assert.equal(n, 0);
  assert.ok(!h.q.abilitiesSuppressed(ent(h, cerebrox)!), 'and once it is gone, Cerebrox has its ability back');
});

test('CR 713.6f / CT-532: once The Everywhere has gone, Cerebrox hears the next trash again', () => {
  const { others, everywhere, kill } = everywhereBatch(115311);
  assert.equal(kill([everywhere]), 0);
  assert.equal(kill([others[0]!]), 1);
});
