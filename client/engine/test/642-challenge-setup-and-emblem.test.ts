/* WEEKLY CHALLENGES — a row's setup: the dummy's starting life and an emblem
 * (docs/21 "The weeks from 15 Nov"; src/challenge.ts challengeDeal,
 * src/lessondeal.ts `activations`).
 *
 * §1 a row without setup deals exactly what every challenge always dealt —
 *    no `activations` key, the dummy on 99 — so the weeks already played
 *    replay unchanged
 * §2 `setup.dummyLife` is the dummy's starting life, in the game itself
 * §3 the emblem "You may activate any number of dormant resources during your
 *    planning step" lifts the player's cap of 2 (CR 106 resources; the real
 *    game's 2 is ACTIVATIONS_PER_TURN): a third activation is refused on the
 *    standard deal and taken under the emblem, on turn 1 and every turn after;
 *    the dummy keeps the real 2
 * §4 the knob survives sanitizeLessonDeal, and is absent when it was absent
 * §5 the sentences a player reads beside the goal
 *
 * Seeds 64200-64299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { ACTIVATIONS_PER_TURN } from '../src/engine.ts';
import { ANY_ACTIVATIONS, sanitizeLessonDeal } from '../src/lessondeal.ts';
import {
  DUMMY, DUMMY_LIFE, EMBLEM_TEXT, PLAYER, challengeDeal, newChallengeGame, settleDummy, setupLines, type ChallengeDef,
} from '../src/challenge.ts';
import type { Action, CardName } from '../src/types.ts';

const DECK: CardName[] = Array.from({ length: 20 }, () => 'Crumbling Ancient');
const row = (seed: number, setup?: ChallengeDef['setup']): ChallengeDef =>
  ({ id: `s${seed}`, week: '2026-12-27', title: 'T', blurb: '', goal: { kind: 'manaSpent', n: 50 }, seed, par: 1, ...(setup ? { setup } : {}) });

test('§1 a row without setup deals the standard game: no activations key, the dummy on 99', () => {
  const deal = challengeDeal(row(64200));
  assert.equal('activations' in deal, false);
  assert.deepEqual(deal.startingLife, [30, DUMMY_LIFE]);
  assert.equal(DUMMY_LIFE, 99);
  const h = newChallengeGame(row(64200), DECK);
  assert.equal('activations' in (h.state.lesson ?? {}), false, 'and the game state carries none');
  assert.equal(h.state.players[PLAYER]!.activationsLeft, ACTIVATIONS_PER_TURN);
});

test('§2 setup.dummyLife is the dummy starting life', () => {
  const h = newChallengeGame(row(64201, { dummyLife: 60 }), DECK);
  assert.equal(h.state.players[DUMMY]!.life, 60);
  assert.equal(h.state.players[PLAYER]!.life, 30);
});

/** turn 1's planning: open both Prismites, then recycle cards and try to open each */
function activations(def: ChallengeDef): { opened: number; refusedThird: boolean } {
  const h = newChallengeGame(def, DECK);
  const legal = (): Action[] => h.legal(PLAYER);
  const bottom = legal().find(a => a.type === 'bottomCards');
  if (bottom) h.do(bottom);
  let opened = 0;
  for (let i = 0; i < 6; i++) {
    let open = legal().find(a => a.type === 'activateResource');
    if (!open) {
      const rec = legal().find(a => a.type === 'recycleForResource' && a.element === 'earth');
      if (!rec) break;
      h.do(rec);
      open = legal().find(a => a.type === 'activateResource');
    }
    if (!open) break;
    h.do(open);
    opened++;
  }
  // the engine's own refusal of one more, on the state as it stands
  const dormant = h.state.players[PLAYER]!.resources.findIndex(r => r.state === 'dormant');
  let refusedThird = false;
  if (dormant >= 0) {
    try { h.do({ type: 'activateResource', seat: PLAYER, index: dormant }); } catch { refusedThird = true; }
  }
  settleDummy(h);
  return { opened, refusedThird };
}

test('§3 the emblem lifts the activation cap for the player; the standard deal refuses a third', () => {
  const std = activations(row(64202));
  assert.equal(std.opened, 2, 'the real game: two activations');
  assert.equal(std.refusedThird, true, 'and a third is refused');
  const emb = activations(row(64202, { emblem: 'anyActivations' }));
  assert.equal(emb.opened, 6, 'under the emblem: every dormant resource there was');
  const deal = challengeDeal(row(64202, { emblem: 'anyActivations' }));
  assert.deepEqual(deal.activations, [ANY_ACTIVATIONS, ACTIVATIONS_PER_TURN], 'the dummy keeps the real two');
  // and it is every turn, not only the first: the turn's reset reads the deal
  const h = newChallengeGame(row(64203, { emblem: 'anyActivations' }), DECK);
  assert.equal(h.state.players[PLAYER]!.activationsLeft, ANY_ACTIVATIONS);
  for (let i = 0; i < 400 && h.state.turn < 2; i++) {
    settleDummy(h);
    const l = h.legal(PLAYER);
    const a = l.find(x => x.type === 'bottomCards') ?? l.find(x => x.type === 'donePlanning') ?? l.find(x => x.type === 'doneHaste')
      ?? l.find(x => x.type === 'declareAttack' && x.columns.length === 0) ?? l.find(x => x.type === 'passPriority') ?? l.find(x => x.type === 'doneDeploying');
    if (!a) break;
    h.do(a);
  }
  assert.equal(h.state.turn, 2);
  assert.equal(h.state.players[PLAYER]!.activationsLeft, ANY_ACTIVATIONS, 'turn 2 starts with the emblem again');
  assert.equal(h.state.players[DUMMY]!.activationsLeft, ACTIVATIONS_PER_TURN);
});

test('§4 sanitizeLessonDeal keeps the activations knob and adds none where there was none', () => {
  const deal = challengeDeal(row(64204, { emblem: 'anyActivations' }));
  assert.deepEqual(sanitizeLessonDeal(deal)?.activations, [ANY_ACTIVATIONS, 2]);
  assert.equal('activations' in (sanitizeLessonDeal(challengeDeal(row(64204))) ?? {}), false);
  assert.deepEqual(sanitizeLessonDeal({ activations: [500, -3] })?.activations, [99, 0], 'clamped');
});

test('§5 what the challenge page says beside the goal', () => {
  assert.deepEqual(setupLines(undefined), []);
  assert.deepEqual(setupLines({ dummyLife: 99 }), [], 'the standard life is not news');
  assert.deepEqual(setupLines({ dummyLife: 60 }), ['The dummy starts with 60 life.']);
  assert.deepEqual(setupLines({ emblem: 'anyActivations' }), [`You start with an emblem: “${EMBLEM_TEXT.anyActivations}”`]);
  assert.equal(EMBLEM_TEXT.anyActivations, 'You may activate any number of dormant resources during your planning step.');
});
