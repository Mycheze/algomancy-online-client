/* WHAT A CARD WILL BE WORTH SOMEWHERE IT IS NOT YET.
 *
 * The owner, 2026-08-29, on The Mighty Doot after R243:
 *
 *   "it's correct about the Mighty Doot, but in a 1v1 game, it'd be nice to
 *    show what the value WILL be when you get into combat. They don't get the
 *    bonus in deployment, but it'd help with descision making at least."
 *
 * R243 made "all" mean "all in this region", which is right and which cost the
 * player something real: a static reading the opposition is worth nothing in a
 * home region, where no opponent is standing, and comes alive in battle. The
 * rule does not change; the SCREEN stops being silent about it.
 *
 * ── ⚠ THE TENSION THIS FILE EXISTS TO HOLD ───────────────────────────
 *
 * A preview has to look past the region — which is exactly what R243 forbids a
 * card from doing. So the card does not: `E.seatsInBattleWith` answers "who
 * would be there" once, in the engine, and the seats are HANDED to
 * `previewNote`. §2 asserts the card never goes looking, because a preview
 * that reached around the rule to peek at the table would be the precise hole
 * `219 §1a` exists to keep shut.
 *
 * §4 is the other half: the preview must agree with the rule. The Doot's real
 * static and its note share one arithmetic (`dootBonusFor`) rather than
 * computing the same thing twice, and a preview that disagreed with what the
 * card then did would be worse than no preview at all.
 *
 * Seeds 22100-22199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import { effStats, spawn, toDeployment } from './util.ts';
import type { Entity, Seat } from '../src/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** the Doot on the board, out of battle, with the opponent ahead on life */
function doot(seed: number, lead: number): { h: Harness; e: E; self: Entity; p: Seat; o: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const p = h.state.deployPlayer!, o = (1 - p) as Seat;
  const id = spawn(h, p, 'The Mighty Doot');
  h.state.players[o]!.life = h.state.players[p]!.life + lead;
  return { h, e: new E(h.state), self: h.state.entities[id]!, p, o };
}

const noteOf = (e: E, self: Entity): string | null => {
  const seats = e.seatsInBattleWith(self);
  return seats ? getCard(self.card).previewNote?.(e, self, seats) ?? null : null;
};

/* ══ §1 the note itself ══════════════════════════════════════════════════ */

test('§1a out of battle it says what the bonus WILL be', () => {
  const { e, self, h, p } = doot(22100, 10);
  const ally = spawn(h, p, 'Unit Token');
  assert.deepEqual(effStats(h, ally), [1, 1], 'R243: no bonus here, and that is unchanged');
  assert.equal(noteOf(e, self), '+3/+3 in battle', 'floor(10 / 3)');
});

test('§1b it says nothing when it would say nothing new', () => {
  // in the BATTLE region the bonus is already applying, so a note repeating it
  // is not news — it is a second, dimmer copy of the stats on the card
  const { e, self, h, p, o } = doot(22101, 10);
  h.state.regions[self.region]!.presentSeats = [p, o];
  assert.equal(noteOf(e, self), null, 'the bonus is live here — the card already shows it');
});

test('§1c it says nothing when there is no bonus to come', () => {
  const behind = doot(22102, -10);
  assert.equal(noteOf(behind.e, behind.self), null, 'I am ahead — nothing is coming');
  const level = doot(22103, 0);
  assert.equal(noteOf(level.e, level.self), null, 'level life totals');
  const tiny = doot(22104, 2);
  assert.equal(noteOf(tiny.e, tiny.self), null, 'floor(2 / 3) is 0 — no note for a zero');
});

test('§1d a card with nothing to preview has no note at all', () => {
  const { e, h, p } = doot(22105, 10);
  const plain = h.state.entities[spawn(h, p, 'Good Whale')]!;
  assert.equal(getCard(plain.card).previewNote, undefined, 'the hook is opt-in');
  assert.equal(noteOf(e, plain), null);
});

/* ══ §2 the card never goes looking for the seats ════════════════════════ */

test('§2a the seats are a PARAMETER — the card does not reach for the table', () => {
  // R243 forbids a card reading g.s.players (219 §1a). A preview that peeked
  // around that would be the exact hole that guard keeps shut, so the engine
  // answers "who would be there" once and hands it over.
  const src = readFileSync(join(HERE, '..', 'src', 'cards', 'sets', 'batch-hybrids-ld-a.ts'), 'utf8');
  const from = src.indexOf('previewNote:');
  const body = src.slice(from, src.indexOf('\n  },', from));
  assert.ok(from > 0, 'the Doot really declares one');
  assert.equal(/g\.s\.players|seatsInBattleWith/.test(body), false,
    'the note must use the seats it was given, not fetch its own');
  assert.match(body, /seats/, 'and it must actually use them');
});

test('§2b the one place allowed to look past the region says so, and is not a rule', () => {
  const src = readFileSync(join(HERE, '..', 'src', 'engine.ts'), 'utf8');
  const from = src.indexOf('seatsInBattleWith(');
  assert.ok(from > 0);
  const doc = src.slice(Math.max(0, from - 1400), from);
  assert.match(doc, /PRESENTATION ONLY/, 'it must be marked as not a rule');
});

/* ══ §3 the 1v1 premise, asserted rather than assumed ════════════════════ */

test('§3 with more than two seats "who you will meet" stops being knowable', () => {
  const { e, self, h } = doot(22106, 10);
  assert.deepEqual(e.seatsInBattleWith(self), [0, 1], 'a 1v1 game — the only shape createGame builds');
  // ⚠ this is the guard on the premise, not on the code: the owner asked for
  // this "in a 1v1 game", and a battle between more than two seats has no
  // knowable opposition in advance. The day multiplayer lands, this reddens
  // and whoever ships it has to decide what a forecast means — rather than
  // the client quietly promising a number against the wrong player.
  h.state.players.push({ ...h.state.players[0]! } as never);
  assert.equal(e.seatsInBattleWith(self), null,
    'null, not a guess — and the client shows nothing rather than something wrong');
});

/* ══ §4 the preview agrees with the rule ═════════════════════════════════ */

test('§4a the note is exactly what the card then does', () => {
  // the preview and the static share one arithmetic; this drives BOTH and
  // checks they land on the same number
  for (const lead of [3, 7, 10, 21]) {
    const { e, self, h, p, o } = doot(22110 + lead, lead);
    const ally = spawn(h, p, 'Unit Token');
    const promised = noteOf(e, self);
    assert.ok(promised, `lead ${lead} should promise something`);
    const n = Number(/\+(\d+)/.exec(promised!)![1]);
    // now put them in a battle region together — the promise must come true
    h.state.regions[self.region]!.presentSeats = [p, o];
    assert.deepEqual(effStats(h, ally), [1 + n, 1 + n],
      `lead ${lead}: promised +${n}/+${n} and must deliver exactly that`);
  }
});

test('§4b the client renders the card\'s note and computes nothing itself', () => {
  const src = readFileSync(join(HERE, '..', 'ui', 'main.ts'), 'utf8');
  assert.match(src, /getCard\(faceOf\(u\)\)\.previewNote\?\.\(q\(\), u, seats\)/,
    'the client asks the CARD');
  assert.equal(/life.*\/ 3|Math\.floor\(lead/.test(src), false,
    'and never re-derives a card\'s arithmetic — two projections of one rule is how they drift');
});
