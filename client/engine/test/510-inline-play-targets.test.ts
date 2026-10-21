/**
 * CT-308, report #238 — a card played in the middle of another effect's
 * resolution declares its targets EXACTLY as the same card played from hand.
 *
 * Room SPVA@348–360: Tides of the Cosmos played Tidal Reversion ("For each
 * player, recall target unit that player controls.") for free and it took ONE
 * target. `playInline` asked a single pick off slot 0 and stopped, so every
 * multi-slot spec, per-slot kind, "up to" / "any number" stop and X-sized
 * count was wrong on that route (Fight was offered enemies for its ally slot,
 * Necromorph never asked for its bin card, Twin Flame and Penance were forced
 * to one). Caleb (RAQ thread 1410252965276684418, reply 1410546587498844203):
 * "You can't play it if one player doesn't have a valid target, but it will
 * still resolve if one of the selected targets is removed." CR 110.7, 702.8.
 *
 * DERIVED, never enumerated: the class is every registered spell whose target
 * spec is more than one plain slot — more than one slot (a count above 1, an
 * X count, extra slots), per-slot kinds or restrictions, or a stated minimum —
 * and that Tides of the Cosmos could pick at all (cost 8 or less; an X card
 * that may be zero). Each one is played twice from the SAME board, once from
 * hand and once by Tides, answering every question by the same index policy:
 *
 *  · Tides offers it exactly when it is legal to play from hand (a card whose
 *    required targets cannot be filled is never offered — the sparse board is
 *    there for that half). This half reaches EVERY targeted spell Tides could
 *    pick, one plain slot included: Download was offered with no token in play;
 *  · both routes ask the same questions, in the same order, with the same
 *    options (a one-option question is a forced move the inline route answers
 *    itself, which saved games depend on — it is left out of both sides);
 *  · both put the same targets on the stack, and never fewer than required.
 *
 * X: a free play is X = 0 (CR 107.4a), so the hand route answers X = 0 and the
 * offer half is compared only for cards without a mana X.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { allCardNames, getCard, targetMinimum, type TargetSpec } from '../src/cards/dsl.ts';
import type { Element, Seat, StackItem } from '../src/types.ts';
import { giveResources, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';

const ELEMENTS: Element[] = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];
const COMMON_HAND = ['Dune Drifter', 'Good Whale'];

/** more than one plain slot: what the old single pick could not ask */
function complex(spec: TargetSpec): boolean {
  return spec.count === 'X' || (spec.count ?? 1) > 1 || (spec.extraSlots ?? 0) > 0
    || !!spec.slots?.length || !!spec.slotRestricts?.length || spec.min !== undefined;
}

/** every targeted spell Tides could pick — `onlyComplex`: just the specs the
 * old inline path got wrong */
function subjects(onlyComplex: boolean): string[] {
  return allCardNames().filter(n => {
    const c = getCard(n);
    const t = c.spellEffect?.targets;
    if (!t || (onlyComplex && !complex(t))) return false;
    if (c.kind !== 'spell' && c.kind !== 'spellUnit') return false;
    if (c.mana === 'X') return (c.xMin ?? 0) === 0;
    return c.mana <= 8;
  });
}

type Scene = 'rich' | 'sparse';
type Route = 'hand' | 'tides';

/** D answers A's attack with `card` — from hand, or off the top of the deck
 * via Tides — on the same board either way. Returns at D's first question
 * about the card (or with the card on the stack). */
function stage(seed: number, scene: Scene, route: Route, card: string): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  if (scene === 'rich') {
    spawn(h, A, 'Molten Tormentor');
    spawn(h, A, 'Bellowing Boulder');
    spawn(h, D, 'Tidal Menace');
    spawn(h, D, 'Towering Colossus');
    withE(h, e => { e.createToken({ form: 'unit', name: 'Wisp', x: 0, seat: A, region: e.homeRegion(A) }); });
    for (const s of [A, D]) h.state.players[s]!.bin.push('Ghord', 'Spawntender', 'Chitin Shredder');
  }
  for (const el of ELEMENTS) giveResources(h, D, el, 5);
  toNextBattle(h, A);
  h.state.players[D]!.hand = [route === 'hand' ? card : 'Tides of the Cosmos', ...COMMON_HAND];
  h.state.sharedDeck = [...(route === 'tides' ? [card] : []), ...Array(8).fill('Good Whale'), 'Dune Drifter'];
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  return { h, A, D };
}

/** the card's own stack item, once it is there */
const itemOf = (h: Harness, card: string): StackItem | undefined =>
  [...h.state.stack].reverse().find(i => i.card === card);

interface Run { offered: boolean; asked: string[]; targets: string[][]; item?: StackItem; h?: Harness }

/** answer the card's questions by `policy` until it reaches the stack */
function drive(h: Harness, D: Seat, card: string, policy: 'first' | 'last', skip: (h: Harness) => boolean): Run {
  const asked: string[] = [];
  for (let k = 0; k < 40 && h.state.decision && !itemOf(h, card); k++) {
    const d = h.state.decision;
    assert.equal(d.seat, D, `${card}: only the player playing it is asked (${d.prompt})`);
    if (skip(h)) continue;
    if (d.options.length > 1) {
      asked.push(`${d.kind} | ${d.prompt.replace(/ \(X=\d+\)/g, '')} | ${d.options.map(o => o.label).join(' / ')}`);
    }
    h.do({ type: 'decide', seat: D, choice: policy === 'first' ? 0 : d.options.length - 1 });
  }
  const item = itemOf(h, card);
  const q = h.q;
  const targets = (item?.parts ?? []).map(p => p.targets.map(r => q.targetLabel(r)));
  return { offered: true, asked, targets, item, h };
}

function viaHand(seed: number, scene: Scene, card: string, policy: 'first' | 'last'): Run {
  const { h, D } = stage(seed, scene, 'hand', card);
  const def = getCard(card);
  // Tides ignores timing; the hand route is compared at the same moment, so
  // the card is let into the battle window for the length of this play.
  const was = def.timing;
  def.timing = 'battle';
  try {
    const legal = h.legal(D).some(a => a.type === 'playCard' && h.state.players[D]!.hand[a.handIndex] === card);
    if (!legal) return { offered: false, asked: [], targets: [] };
    h.do({ type: 'playCard', seat: D, handIndex: 0 });
    // CR 107.4a: a free play is X = 0 — the hand route declares the same X
    return drive(h, D, card, policy, g => {
      if (g.state.suspension?.type !== 'cast' || g.state.suspension.stage !== 'x') return false;
      const i = g.state.decision!.options.findIndex(o => o.value === 0);
      assert.notEqual(i, -1, `${card}: X = 0 is on the hand menu`);
      g.do({ type: 'decide', seat: D, choice: i });
      return true;
    });
  } finally {
    def.timing = was;
  }
}

function viaTides(seed: number, scene: Scene, card: string, policy: 'first' | 'last'): Run {
  const { h, D } = stage(seed, scene, 'tides', card);
  h.do({ type: 'playCard', seat: D, handIndex: 0 });
  pass(h); pass(h);
  const d = h.state.decision;
  assert.ok(d?.pickSet, `${card}: Tides asks for its first pick`);
  const i = d.options.findIndex(o => (o as { card?: string }).card === card);
  if (i < 0) return { offered: false, asked: [], targets: [] };
  h.do({ type: 'decide', seat: D, choice: i });
  return drive(h, D, card, policy, g => {
    const q = g.state.decision!;
    // Tides' own questions — the second pick and the play mode — are not the card's
    const done = q.pickSet ? q.options.findIndex(o => o.value === -1)
      : q.prompt.startsWith('Tides of the Cosmos: how do you play') ? 0 : -1;
    if (done < 0) return false;
    g.do({ type: 'decide', seat: D, choice: done });
    return true;
  });
}

const SUBJECTS = subjects(true);
/** the offer half reaches every targeted spell: Download's one plain slot was offered with no token in play */
const OFFER_SUBJECTS = subjects(false);
const SCENES: [Scene, number][] = [['rich', 51001], ['sparse', 51002]];

test('the class is derived from the registry and holds the report cards', () => {
  for (const n of ['Tidal Reversion', 'Fight', 'Squish', 'Necromorph', 'Twin Flame', 'Penance',
    'Malevolent Machinations', 'Torrential Reclamation', 'Channel Through', 'Tilling the Graves']) {
    assert.ok(SUBJECTS.includes(n), `${n} is in the derived class`);
  }
});

for (const [scene, seed] of SCENES) {
  test(`CR 110.7: on the ${scene} board Tides offers a targeted spell exactly when it could be played from hand`, () => {
    const wrong: string[] = [];
    for (const card of OFFER_SUBJECTS) {
      if (getCard(card).mana === 'X') continue;   // hand X is free; Tides X is 0
      const hand = viaHand(seed, scene, card, 'first').offered;
      const tides = viaTides(seed, scene, card, 'first').offered;
      if (hand !== tides) wrong.push(`${card}: hand ${hand ? 'legal' : 'illegal'}, Tides ${tides ? 'offers' : 'withholds'}`);
    }
    assert.deepEqual(wrong, []);
  });

  for (const policy of ['first', 'last'] as const) {
    test(`CR 702.3c: on the ${scene} board a Tides play asks and declares what a hand play does (answering ${policy})`, () => {
      const wrong: string[] = [];
      let compared = 0;
      for (const card of SUBJECTS) {
        const t = viaTides(seed, scene, card, policy);
        if (!t.offered) continue;
        const spec = getCard(card).spellEffect!.targets!;
        const part = t.item?.parts[0];
        const x = part?.costPaid?.x ?? t.item?.x ?? 0;
        const need = targetMinimum(spec, spec.count === 'X' ? x : (spec.count ?? 1));
        if (!t.item) { wrong.push(`${card}: never reached the stack`); continue; }
        if ((part?.targets.length ?? 0) < need) wrong.push(`${card}: declared ${part?.targets.length} of ${need} required`);
        const h = viaHand(seed, scene, card, policy);
        if (!h.offered) continue;   // an X card legal only at another X (offer half above)
        compared++;
        try {
          assert.deepEqual(t.asked, h.asked, 'questions');
          assert.deepEqual(t.targets, h.targets, 'targets');
        } catch (err) {
          wrong.push(`${card}: ${(err as Error).message.split('\n').slice(0, 12).join(' ')}`);
        }
      }
      assert.deepEqual(wrong, []);
      if (scene === 'rich') assert.ok(compared >= 10, `the rich board compares most of the class (${compared})`);
    });
  }
}

test('CT-308: Tidal Reversion under Tides takes one unit of each player', () => {
  const t = viaTides(51001, 'rich', 'Tidal Reversion', 'first');
  assert.equal(t.item?.parts[0]?.targets.length, 2, `declared ${JSON.stringify(t.targets)}`);
  const owners = t.item!.parts[0]!.targets.map(r => t.h!.state.entities[(r as { unit: number }).unit]?.controller);
  assert.deepEqual([...new Set(owners)].sort(), [0, 1], 'one unit each player controls');
  assert.equal(viaTides(51002, 'sparse', 'Tidal Reversion', 'first').offered, false,
    'with one side empty it is not offered');
});
