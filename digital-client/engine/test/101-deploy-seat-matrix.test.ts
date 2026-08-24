/* THE DEPLOYMENT SEAT MATRIX — CARD-TODO #23.
 *
 * `h.state.deployPlayer` appears ~763 times across the suite as "the acting
 * seat", and right after toDeployment() it is always the initiative seat — so
 * every card test habitually drives the one seat a seat-asymmetric deployment
 * bug happens to serve. That is exactly how Mirage Walker (report #86 /
 * CARD-TODO #22) stayed green while buggy: its replacement test had to be
 * parameterised over (card-owner seat × deployPlayer) and was red 4/4 before
 * the fix (commit 0363b6d).
 *
 * This file applies that 4-way shape to EVERY card whose printed text ties a
 * trigger, condition or permission to DEPLOYMENT with a "you"/"your" (or
 * seat-relative "ally") pronoun. For each such card, the card's behaviour is
 * driven from BOTH owner seats × BOTH deployPlayer values, and the test
 * asserts the combination it claims to be exercising actually holds
 * (`deployPlayer === init`) so a fixture drifting back to the convenient seat
 * fails instead of narrowing silently.
 *
 * WHAT EACH FAMILY EXERCISES (the engine predicate that would carry a seat
 * bug — none of these tests can pass vacuously, and re-introducing the
 * classic bug shape `deploying(seat) := seat === deployPlayer` turns the
 * owner≠deployPlayer half of the activated-ability rows red):
 *
 *  - The Bonesculptor / Gridxlan: `E.deploying(seat)` + legalActions'
 *    pushActivatedOptions — a deployment-timed activated ability must be
 *    offered to and work for its OWNER while the other seat is deployPlayer
 *    (deployment is simultaneous; deployDone is the per-seat fact).
 *  - Invasive Species / Scholar of the Void / Wraith: fireEvent's in-play
 *    scan + augmentText dispatch — "your units" / "you may" / "an ally" are
 *    the HOLDER's controller (ctx.controller), never deployPlayer.
 *  - Xzydris: fireZoneTriggers — "YOUR bin" is the bin owner's seat, both
 *    seats' bins are scanned.
 *  - Prediction Prophet: the endOfHaste ask and the startOfDeployment payoff
 *    both belong to the card's controller.
 *  - Slurpr: `ModPermission.applyAtHaste` ("as if it was deployment") belongs
 *    to the grantor's controller whichever seat holds initiative.
 *  - Mirage Walker: EXEMPT — its 4-way matrix already lives in
 *    test/14-water-a.test.ts (report #86); duplicating it here would only
 *    count the same coverage twice.
 *
 * The census test at the bottom keeps this list in sync with printed.json: a
 * NEW card printing a deployment-"you" clause must be added to the matrix or
 * to the exemption list with a written reason.
 *
 * States are built explicitly (give/spawn/giveResources/whiteBox); seeds
 * 9200-9299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import {
  effStats, ent, give, giveResources, pick, skipHasteStep,
  spawn, toDeployment, unitsOf, finishBattle,
} from './util.ts';
import type { DecisionOption, Seat } from '../src/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── helpers ───────────────────────────────────────────────────────────

/** run raw engine calls against the harness state, absorbing a suspension */
function whiteBox(h: Harness, fn: (e: E) => void): void {
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

/** answer the pending decision with the first option matching `match` */
function pickBy(h: Harness, match: (o: DecisionOption) => boolean): void {
  const dec = h.state.decision!;
  assert.ok(dec, 'a decision was expected');
  const i = dec.options.findIndex(match);
  if (i === -1) throw new Error(`no matching option in [${dec.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: dec.seat, choice: i });
}

const hand = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.hand;
const bin = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.bin;

/** the four (card-owner seat × deployPlayer) combinations, Mirage Walker's shape */
const COMBOS: [Seat, Seat][] = [[0, 0], [0, 1], [1, 0], [1, 1]];

/**
 * Roll from the current deployment through a battle into the NEXT start of
 * deployment (where R50's 'startOfDeployment' event fires), PINNING the
 * initiative — and with it the deployPlayer the next deployment opens on —
 * to `init`. The pin happens after the turn flip (which recomputes
 * initiative) and before startDeployment reads it.
 */
function toNextDeploymentAs(h: Harness, init: Seat): void {
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.state.initiative = init;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  finishBattle(h);
  assert.equal(h.state.phase, 'deploy', 'we reached the next deployment');
  assert.equal(h.state.deployPlayer, init, 'the combination under test holds');
}

// ── The Bonesculptor: "You may play one unit with no abilities from your
//    bin each deployment." — a deployment-timed activated ability must be
//    offered to its OWNER whichever seat deployPlayer marks. ──────────────
for (const [owner, init] of COMBOS) {
  test(`The Bonesculptor seat-matrix: the bin play works for its owner (owner=${owner}, deployPlayer=${init})`, () => {
    const h = new Harness(9200 + owner * 2 + init);
    h.state.initiative = init;                  // deployPlayer derives from initiative
    toDeployment(h);
    assert.equal(h.state.deployPlayer, init, 'the combination under test holds');
    const bone = spawn(h, owner, 'The Bonesculptor');
    bin(h, owner).push('Curio Drifter');        // a vanilla unit ({Evasive} is an attr)
    giveResources(h, owner, 'water', 1);        // Curio Drifter: b/1
    assert.ok(legalActions(h.state, owner).some(a =>
      a.type === 'activateAbility' && a.entityId === bone),
      'offered to the OWNER seat — E.deploying() reads per-seat deployDone, not deployPlayer');
    h.do({ type: 'activateAbility', seat: owner, entityId: bone, abilityIndex: 0 });
    pickBy(h, o => o.label === 'Curio Drifter');
    assert.ok(unitsOf(h, owner).some(u => u.card === 'Curio Drifter'), 'played out of the bin');
    assert.ok(!bin(h, owner).includes('Curio Drifter'), 'and it left the bin');
  });
}

// ── Gridxlan: "[Augment] If your hand is empty, you may play one unit from
//    your bin during deployment." — "your hand"/"your bin" are the OWNER's. ─
for (const [owner, init] of COMBOS) {
  test(`Gridxlan seat-matrix: the empty-hand bin play works for its owner (owner=${owner}, deployPlayer=${init})`, () => {
    const h = new Harness(9204 + owner * 2 + init);
    h.state.initiative = init;
    toDeployment(h);
    assert.equal(h.state.deployPlayer, init, 'the combination under test holds');
    const grid = spawn(h, owner, 'Gridxlan');
    hand(h, owner).length = 0;                  // the printed condition — the OWNER's hand
    bin(h, owner).push('Curio Drifter');
    giveResources(h, owner, 'water', 1);
    assert.ok(legalActions(h.state, owner).some(a =>
      a.type === 'activateAbility' && a.entityId === grid),
      'offered to the OWNER seat regardless of deployPlayer');
    h.do({ type: 'activateAbility', seat: owner, entityId: grid, abilityIndex: 0, via: 'augment' });
    pickBy(h, o => o.label === 'Curio Drifter');
    assert.ok(unitsOf(h, owner).some(u => u.card === 'Curio Drifter'), 'played out of the bin');
    assert.ok(!bin(h, owner).includes('Curio Drifter'), 'and it left the bin');
  });
}

// ── Invasive Species: "[Augment] At the start of deployment, recall all
//    your other units." — "your" is the holder's controller. ──────────────
for (const [owner, init] of COMBOS) {
  test(`Invasive Species seat-matrix: recalls the OWNER's other units only (owner=${owner}, deployPlayer=${init})`, () => {
    const h = new Harness(9208 + owner * 2 + init);
    toDeployment(h);
    const inv = spawn(h, owner, 'Invasive Species');
    const mine = spawn(h, owner, 'Curio Drifter');            // owner's ally — recalled
    const theirs = spawn(h, (1 - owner) as Seat, 'Good Whale'); // not the owner's — untouched
    const before = hand(h, owner).filter(c => c === 'Curio Drifter').length;
    toNextDeploymentAs(h, init);
    assert.ok(ent(h, inv), 'Invasive Species itself stays — "your OTHER units"');
    assert.ok(!ent(h, mine), "the OWNER's ally was recalled, deployPlayer or not");
    assert.equal(hand(h, owner).filter(c => c === 'Curio Drifter').length, before + 1,
      "…to the owner's hand");
    assert.ok(ent(h, theirs), "the other seat's unit is untouched");
  });
}

// ── Scholar of the Void: "[Augment] At the start of deployment, you may
//    discard your hand and transform me…" — the "you may" asks the OWNER. ──
for (const [owner, init] of COMBOS) {
  test(`Scholar of the Void seat-matrix: the transform asks its owner (owner=${owner}, deployPlayer=${init})`, () => {
    const h = new Harness(9212 + owner * 2 + init);
    toDeployment(h);
    const sv = spawn(h, owner, 'Scholar of the Void');
    give(h, owner, 'Good Whale');               // a real hand to lose
    toNextDeploymentAs(h, init);
    assert.ok(h.state.decision, 'R50 delivers the event and the "you may" asks');
    assert.equal(h.state.decision!.seat, owner,
      '"you" is the OWNER seat, not deployPlayer — the ask goes to the controller');
    pickBy(h, o => String(o.label).includes('transform into Beyond, Codex Incarnate'));
    assert.equal(ent(h, sv)!.card, 'Beyond, Codex Incarnate', 'turned over');
    assert.equal(hand(h, owner).length, 0, "and the OWNER's whole hand was the cost");
  });
}

// ── Xzydris: "At the start of deployment you may Augment a Wraith onto a
//    unit to recall me from your bin." — a ZONE trigger; "your bin" is the
//    bin owner's, from either seat's bin. ─────────────────────────────────
for (const [owner, init] of COMBOS) {
  test(`Xzydris seat-matrix: the bin recall asks the bin owner (owner=${owner}, deployPlayer=${init})`, () => {
    const h = new Harness(9216 + owner * 2 + init);
    toDeployment(h);
    const host = spawn(h, owner, 'Grox');
    bin(h, owner).push('Xzydris');
    toNextDeploymentAs(h, init);
    assert.ok(h.state.decision, 'the bin-resident start-of-deployment trigger asked');
    assert.equal(h.state.decision!.seat, owner,
      '"YOUR bin" — the bin owner decides, whichever seat deployPlayer marks');
    pickBy(h, o => o.card === 'Grox');
    const mods = ent(h, host)!.mods.map(m => ent(h, m)!);
    assert.equal(mods.length, 1, 'a Wraith was augmented onto the chosen unit');
    assert.equal(mods[0]!.card, 'Wraith');
    assert.ok(!bin(h, owner).includes('Xzydris'), 'it left the bin');
    assert.ok(hand(h, owner).includes('Xzydris'), "…recalled to the OWNER's hand");
  });
}

// ── Wraith: "[Augment] At the start of deployment, put a -1/-1 counter on
//    an ally." — "an ally" is relative to the HOLDER's controller. ─────────
for (const [owner, init] of COMBOS) {
  test(`Wraith seat-matrix: the -1/-1 counter lands on the OWNER's ally (owner=${owner}, deployPlayer=${init})`, () => {
    const h = new Harness(9220 + owner * 2 + init);
    toDeployment(h);
    const host = spawn(h, owner, 'Curio Drifter');
    const ally = spawn(h, owner, 'Good Whale');               // a second candidate → a real choice
    spawn(h, (1 - owner) as Seat, 'Good Whale');              // NOT an ally — never a candidate
    whiteBox(h, e => e.augmentWraith(e.entity(host)!, owner));
    toNextDeploymentAs(h, init);
    assert.ok(h.state.decision, 'two candidates → the controller picks the ally');
    assert.equal(h.state.decision!.seat, owner,
      'the pick belongs to the holder\'s CONTROLLER, not deployPlayer');
    assert.ok(h.state.decision!.options.every(o =>
      ent(h, o.value as number)?.controller === owner),
      "only the OWNER's units are allies — the other seat's Whale is not on the menu");
    pickBy(h, o => o.label === 'Good Whale');
    assert.equal(ent(h, ally)!.counters, -1, 'the -1/-1 counter landed');
    assert.deepEqual(effStats(h, ally), [6, 4], 'a 7/5 at -1/-1');
  });
}

// ── Prediction Prophet: "During [Haste], predict your life total. At the
//    start of deployment, create a 5/5 unit if you matched the prediction."
//    — both halves belong to the card's controller. ───────────────────────
for (const [owner, init] of COMBOS) {
  test(`Prediction Prophet seat-matrix: the prediction and the 5/5 are the OWNER's (owner=${owner}, deployPlayer=${init})`, () => {
    const h = new Harness(9224 + owner * 2 + init);
    toDeployment(h);
    spawn(h, owner, 'Prediction Prophet');
    // roll into the endOfHaste window with the initiative pinned; stop the
    // moment the prediction is asked for (40-light-c's toPrediction, seatable)
    h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
    h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
    h.state.initiative = init;
    h.do({ type: 'donePlanning', seat: 0 });
    if (!h.state.decision) h.do({ type: 'donePlanning', seat: 1 });
    if (!h.state.decision) skipHasteStep(h);
    assert.ok(h.state.decision, 'the prediction is asked for during [Haste]');
    assert.equal(h.state.decision!.seat, owner,
      '"your life total" — the OWNER predicts, whichever seat holds initiative');
    const life = h.state.players[owner]!.life;
    pick(h, life);                              // nothing will change it
    skipHasteStep(h);
    finishBattle(h);
    assert.equal(h.state.phase, 'deploy');
    assert.equal(h.state.deployPlayer, init, 'the combination under test holds');
    const made = unitsOf(h, owner).filter(u => u.token && u.tokenStats?.[0] === 5);
    assert.equal(made.length, 1, 'the match pays the OWNER a 5/5, deployPlayer or not');
    assert.deepEqual(effStats(h, made[0]!.id), [5, 5]);
  });
}

// ── Slurpr: "You can apply other mods during [Haste] as if it was
//    deployment." — the permission belongs to the grantor's controller,
//    whichever seat holds initiative. ─────────────────────────────────────
for (const [owner, init] of COMBOS) {
  test(`Slurpr seat-matrix: the haste-mod permission is the grantor's controller's (owner=${owner}, initiative=${init})`, () => {
    const h = new Harness(9228 + owner * 2 + init);
    toDeployment(h);
    spawn(h, owner, 'Slurpr');                  // the grantor, in the owner's region
    const host = spawn(h, owner, 'Rune Channeler');
    h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
    h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
    h.state.initiative = init;                  // pin before the haste step is decided
    hand(h, 0).length = 0;
    hand(h, 1).length = 0;
    giveResources(h, owner, 'fire', 4);
    give(h, owner, 'Ephemeral Skywalker');      // a plain [Deployment] augment
    h.do({ type: 'donePlanning', seat: 0 });
    h.do({ type: 'donePlanning', seat: 1 });
    assert.equal(h.state.initiative, init, 'the combination under test holds');
    assert.equal(h.state.hasteDone![owner], false,
      "the haste step opens for the grantor's CONTROLLER, initiative or not");
    const idx = hand(h, owner).indexOf('Ephemeral Skywalker');
    h.do({ type: 'augment', seat: owner, from: 'hand', index: idx, hostId: host });
    assert.equal(ent(h, host)!.mods.length, 1, 'the augment landed during [Haste]');
    h.do({ type: 'doneHaste', seat: owner });
    assert.equal(h.state.phase, 'battle', 'the step closes normally afterwards');
    finishBattle(h);
  });
}

// ── the census: this matrix grows with the pool instead of rotting ────────

/** every card in the matrix above (each is driven 4-way, from both seats) */
const MATRIX_CARDS: string[] = [
  'The Bonesculptor', 'Gridxlan', 'Invasive Species', 'Prediction Prophet',
  'Scholar of the Void', 'Slurpr', 'Wraith', 'Xzydris',
];

/** deployment-"you" cards deliberately NOT re-driven here, each with a reason */
const EXEMPT: Record<string, string> = {
  'Mirage Walker':
    'its (owner seat × deployPlayer) 4-way lives in test/14-water-a.test.ts '
    + '(report #86, commit 0363b6d — the precedent this file copies); '
    + 'duplicating the matrix here would count the same coverage twice',
};

test('deployment seat-matrix census: every deployment-"you" card in printed.json is in the matrix or exempt with a reason', () => {
  const printed = JSON.parse(fs.readFileSync(
    path.join(HERE, '../src/cards/printed.json'), 'utf8')) as
    Record<string, { name: string; text?: string }>;
  // the net: printed text that ties something to DEPLOYMENT and says whose it
  // is with a seat-relative pronoun ("you", "your", or "ally" — Wraith's
  // clause is seat-relative without ever printing "you")
  const deploymentYou = Object.values(printed)
    .filter(c => /deploy/i.test(c.text ?? '')
      && /\b(you|your|ally|allies)\b/i.test(c.text ?? ''))
    .map(c => c.name)
    .sort();
  const covered = new Set([...MATRIX_CARDS, ...Object.keys(EXEMPT)]);
  const missing = deploymentYou.filter(n => !covered.has(n));
  assert.deepEqual(missing, [],
    'these cards print a deployment clause with a "you"/"your"/"ally" pronoun but are in '
    + 'neither MATRIX_CARDS nor EXEMPT. A deployment-"you" card whose behaviour is only ever '
    + 'driven from the deployPlayer seat is exactly how Mirage Walker #86 stayed green while '
    + 'buggy — add a 4-way (owner seat × deployPlayer) matrix for it in this file, or an '
    + 'EXEMPT entry with a written reason (CARD-TODO #23).');
  const stale = [...covered].filter(n => !deploymentYou.includes(n));
  assert.deepEqual(stale, [],
    'these matrix/exemption entries no longer match any deployment-"you" text in '
    + 'printed.json — the card was renamed, reworded or removed. Keep the list honest: '
    + 'update or delete the entry.');
  // and the exemptions carry their reasons — an empty excuse is no excuse
  for (const [name, why] of Object.entries(EXEMPT)) {
    assert.ok(why.length >= 20, `the exemption for ${name} needs a real written reason`);
  }
});
