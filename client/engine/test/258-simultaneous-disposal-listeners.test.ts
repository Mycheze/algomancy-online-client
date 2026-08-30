/**
 * R278 / CT-170 — A BODY THAT DIES IN A BATCH STILL HEARS THE REST OF THE BATCH.
 *
 * Report #155, room ZSPG action 223, the owner as a question: *"Shouldn't Muck
 * Runner's trigger happened here? Her cards were trashed during combat,
 * right?"* The card is Muck Rummager — "When you trash a card during battle,
 * [Switch1] Draw a card." The premise measured out TRUE, but NOT for the
 * reason the wording suggests, and the difference is the whole ruling.
 *
 * The trigger is not deaf to combat. In that same game it fired on a card its
 * controller discarded during the battle phase (ZSPG action 119), and the
 * CONTROL test below fires it on a card killed by combat damage. What it is
 * deaf to is a trash inside the same SIMULTANEOUS DEATH BATCH as its own.
 * ZSPG action 218, one combat-damage step:
 *
 *     Combat damage (simultaneous):
 *     Muck Rummager dies -> bin, then ERASED - Unstable (it and its 3 mod(s)).
 *     Rashi trashes Muck Rummager (from play).
 *     Blightwalker dies -> bin.
 *     Rashi trashes Blightwalker (from play).
 *     Smouldering Inferno dies -> bin.
 *     Rashi trashes Smouldering Inferno (from play).
 *
 * Three cards trashed by Rashi during battle; no draw. `checkDeaths()` collects
 * the whole batch and then calls `destroy()` on each in turn, and `destroy()`s
 * SECOND LINE is `delete this.s.entities[u.id]` while `fireEvent()` scans
 * `s.entities`. So the first corpse out of a batch is not a listener for the
 * rest of it, and R189 — a batch that is simultaneous in the rules must LOOK
 * simultaneous — stopped at the entity table.
 *
 * THE CLASS IS NOT MUCK RUMMAGER, AND IT IS NOT COMBAT. It is every board-scan
 * trigger that listens on a disposal event, and the third test DERIVES that
 * population from the pool rather than typing it, because the repo's signature
 * failure is a one-card fix for a whole family. On the day it was written the
 * derivation found 13 abilities on 13 cards, NINE of which measurably went
 * silent the moment the listener died alongside what it was listening to:
 * Forager of the Fallen, Fungal Gardener, Cthyrian Culler (2 firings to 0),
 * Muck Rummager, Entropic Entity, Murkdrop Distiller, Unrelenting Horror,
 * Murkstalker and Splort.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { ent, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';
import type { EntityId, Seat } from '../src/types.ts';

/** every event a card emits on its way out of play and into a bin */
const DISPOSAL = new Set(['trashed', 'died', 'despawned', 'erased', 'leftBin']);

/** the exact log line `collectTriggersFrom` writes for a board-scan firing —
 * exact, because a card can also carry a `self` ability of the same name and
 * that one reads `… (trashed).` A prefix match would let the dying card's own
 * text stand in for the ally-watching text this file is about. */
const firings = (h: Harness, name: string, label: string, from = 0): string[] =>
  h.events.slice(from)
    .filter(ev => ev.type === 'triggered' && ev.msg === `Trigger: ${name} — ${label}.`)
    .map(ev => ev.msg);

// ── 1 & 2. the report itself, through real combat ─────────────────────

/** answer whatever is pending with its first option — an ordering question
 * (R2) needs a permutation rather than an index, so it gets the identity one */
function answerAll(h: Harness): void {
  for (let guard = 60; guard-- > 0;) {
    const dec = h.state.decision;
    if (!dec) return;
    h.do({ type: 'decide', seat: dec.seat,
      choice: dec.pickOrder ? dec.options.map((_, i) => i) : 0 });
  }
  throw new Error('answerAll did not terminate');
}

/** A attacks with `columns`, D blocks `blocks`, run through combat damage. */
function fight(h: Harness, A: Seat, D: Seat, columns: EntityId[][],
  blocks: Record<number, EntityId[]>): void {
  h.do({ type: 'declareAttack', seat: A, columns });
  answerAll(h);
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks });
  answerAll(h);
  pass(h); pass(h);
}

/** Muck Rummager and one plain ally attacking in their own columns, with two
 * 7/2 blockers waiting — enough power to kill either attacker, little enough
 * defense to die to either. Which columns get blocked is the experiment. */
function muckBoard(seed: number): {
  h: Harness; A: Seat; D: Seat; mr: EntityId; ally: EntityId; w1: EntityId; w2: EntityId;
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const mr = spawn(h, A, 'Muck Rummager');            // 2/3
  const ally = spawn(h, A, 'Tiderunner Initiate');    // 2/2, no disposal text
  const w1 = spawn(h, D, 'Tidal Menace');             // 7/2
  const w2 = spawn(h, D, 'Tidal Menace');
  toNextBattle(h, A);
  return { h, A, D, mr, ally, w1, w2 };
}

test('CONTROL: Muck Rummager hears an ally trashed by combat damage it survives', () => {
  const { h, A, D, mr, ally, w1 } = muckBoard(27801);
  assert.equal(h.state.phase, 'battle', 'NON-VACUITY: the trash has to happen during battle (R40)');
  // only the ally is blocked, so only the ally dies
  fight(h, A, D, [[mr], [ally]], { 1: [w1] });
  const trashed = h.events.filter(ev => ev.type === 'trashed');
  assert.ok(trashed.some(ev => ev.data?.['card'] === 'Tiderunner Initiate'
    && ev.data['seat'] === A && ev.data['from'] === 'play'),
  'NON-VACUITY: A really trashed a card from play, by combat damage, during battle');
  assert.ok(ent(h, mr), 'NON-VACUITY: and Muck Rummager was still in play to hear it');
  assert.equal(firings(h, 'Muck Rummager', 'draw a card').length, 1,
    'the trigger fires: the engine is NOT deaf to a trash that happens during combat, '
    + 'so the report premise as worded does not hold');
});

test('R278: Muck Rummager hears an ally trashed in the same combat-damage batch it dies in', () => {
  const { h, A, D, mr, ally, w1, w2 } = muckBoard(27802);
  assert.equal(h.state.phase, 'battle', 'NON-VACUITY: phase is battle, so the when clause can pass');
  assert.equal(ent(h, mr)!.controller, A, 'NON-VACUITY: Muck Rummager is in play and A controls it');
  assert.equal(new E(h.state).abilitiesSuppressed(ent(h, mr)!), false,
    'NON-VACUITY: its abilities are live — nothing has silenced it (R62)');

  // both columns blocked: the two attackers die in ONE damage step
  fight(h, A, D, [[mr], [ally]], { 0: [w1], 1: [w2] });

  const trashed = h.events.filter(ev => ev.type === 'trashed');
  assert.ok(trashed.some(ev => ev.data?.['card'] === 'Muck Rummager' && ev.data['seat'] === A),
    'NON-VACUITY: Muck Rummager itself was trashed, in this very batch');
  assert.ok(trashed.some(ev => ev.data?.['card'] === 'Tiderunner Initiate'
    && ev.data['seat'] === A && ev.data['from'] === 'play'),
  'NON-VACUITY: and so was ANOTHER card of A — the trash the trigger is owed');
  assert.equal(ent(h, mr), undefined, 'NON-VACUITY: both really left play');
  assert.equal(ent(h, ally), undefined);

  assert.equal(firings(h, 'Muck Rummager', 'draw a card').length, 1,
    'R278: dying alongside the card you were watching does not un-see it');
});

// ── 3. the CLASS, derived from the pool ───────────────────────────────

/** every board-scan (non-`self`) triggered ability in the pool that listens on
 * a disposal event. DERIVED: a card added tomorrow joins this guard by being
 * printed, not by being remembered. */
function disposalListeners(): { name: string; label: string }[] {
  const out: { name: string; label: string }[] = [];
  for (const name of allCardNames()) {
    for (const a of getCard(name).abilities ?? []) {
      if (a.type !== 'triggered' || a.self) continue;
      if (!a.events.some(e => DISPOSAL.has(e))) continue;
      out.push({ name, label: a.label ?? '' });
    }
  }
  return out;
}

/**
 * One measurement: put `name` in play beside an allied and an enemy victim, all
 * three in the same region and all three carrying a counter (Entropic Entity
 * asks for one), then kill either the two victims (`killWatcher` false) or all
 * three at once (`killWatcher` true) in a single `checkDeaths` batch — the seam
 * every simultaneous death goes through. Returns the firings of THIS ability.
 */
function batchFirings(name: string, label: string, killWatcher: boolean): number {
  const h = new Harness(2780);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  let watcher = 0, ally = 0, foe = 0;
  withE(h, e => {
    const region = e.homeRegion(A);
    watcher = e.spawnUnit(A, name, region).id;
    const al = e.spawnUnit(A, 'Tiderunner Initiate', region); ally = al.id;
    const fo = e.spawnUnit(D, 'Tiderunner Initiate', region); foe = fo.id;
    e.addCounters(al, 1);
    e.addCounters(fo, 1);
  });
  answerAll(h);   // a spawn may ask a question (Unrelenting Horror does)
  toNextBattle(h, A);
  const from = h.events.length;
  withE(h, e => {
    const ids = killWatcher ? [watcher, ally, foe] : [ally, foe];
    for (const id of ids) { const u = e.entity(id); if (u) u.damage = 999; }
    e.checkDeaths();
  });
  return firings(h, name, label, from).length;
}

test('R278 the class: no disposal listener in the pool goes deaf by dying in the same batch', () => {
  const pop = disposalListeners();
  assert.ok(pop.length >= 10,
    `NON-VACUITY: the derivation found ${pop.length} board-scan disposal listeners; `
    + 'if this ever collapses the guard below is measuring nothing');

  const rows = pop.map(({ name, label }) => ({
    name, label,
    watching: batchFirings(name, label, false),   // it survives the batch
    dying: batchFirings(name, label, true),       // it dies IN the batch
  }));

  // NON-VACUITY, and the point of the differential: a decent slice of the
  // population must actually FIRE while merely watching, or "dying does not
  // change the answer" is a statement about nothing.
  const live = rows.filter(r => r.watching > 0);
  assert.ok(live.length >= 8,
    `NON-VACUITY: only ${live.length} of ${rows.length} disposal listeners fired at all `
    + `while watching: [${rows.map(r => `${r.name}=${r.watching}`).join(', ')}]`);

  const deaf = rows.filter(r => r.dying < r.watching);
  assert.deepEqual(deaf.map(r => `${r.name} (${r.watching} -> ${r.dying})`), [],
    'R278: a trigger that hears a disposal while it stands beside it must still hear it '
    + 'when it is disposed of in the same simultaneous batch');
});
