/**
 * CR 720.6c, 722.4, 405.6a / CT-534 (report #338, XWDS) — a GRAFTED
 * Blightwalker's "another target unit from your bin" excludes the HOST, which
 * is in play, so the card whose trashing fired the host's cause is offered.
 *
 * Blightwalker: "When I am trashed, [Switch1] You may pay [2] to recall another
 * target unit from your bin." On its own trigger "me" is the Blightwalker that
 * just landed in the bin, and exactly that slot is excluded (121's two
 * Blightwalker tests; the third test here does the same from play). Grafted
 * under Splort ("When another card is trashed, [Switch1] I deal 2 damage to any
 * target"), the text rides Splort's cause and "me" means Splort (CR 720.6c). In
 * XWDS invi discarded Dropslime, and the composite offered Cthyrian Rector and
 * not Dropslime: the restriction read the firing event's card (Dropslime) as
 * "me".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { ent, give, giveResources, spawn, toDeployment, withE } from './util.ts';
import type { Seat } from '../src/types.ts';

const bin = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.bin;

/** answer decisions until one is Blightwalker's target menu; its option labels */
function blightwalkerMenu(h: Harness): string[] | null {
  for (let guard = 0; guard < 30; guard++) {
    const dec = h.state.decision;
    if (!dec) return null;
    if (/Blightwalker: pay \[2\] to recall another target unit/.test(dec.prompt)) {
      return dec.options.map(o => String(o.label));
    }
    h.do({ type: 'decide', seat: dec.seat, choice: dec.pickOrder ? dec.options.map((_, i) => i) : 0 });
  }
  throw new Error('no Blightwalker target menu');
}

test('CT-534: Splort with Blightwalker grafted offers the discarded Dropslime to recall', () => {
  const h = new Harness(11710);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const splort = spawn(h, P, 'Splort');
  giveResources(h, P, 'dark', 6);
  h.do({ type: 'graft', seat: P, from: 'hand', index: give(h, P, 'Blightwalker'), hostId: splort, position: 0 });
  assert.ok(ent(h, splort)!.mods.some(m => ent(h, m)?.card === 'Blightwalker'), 'setup: Blightwalker is grafted under Splort');
  h.state.players[P]!.bin = ['Cthyrian Rector'];
  const i = give(h, P, 'Dropslime');
  withE(h, e => e.discardFromHand(P, i));                  // CR 801.3: discarding is trashing
  assert.deepEqual(bin(h, P), ['Cthyrian Rector', 'Dropslime']);

  const menu = blightwalkerMenu(h);
  assert.ok(menu, "Splort's composite asks for the grafted Blightwalker's target");
  assert.ok(menu!.some(l => l.startsWith('Cthyrian Rector')), `Cthyrian Rector is offered: [${menu!.join(' | ')}]`);
  assert.ok(menu!.some(l => l.startsWith('Dropslime')),
    `Dropslime is offered — "another" is other than Splort, which is in play: [${menu!.join(' | ')}]`);
});

test('CT-534: the control — Blightwalker trashed FROM PLAY still excludes itself', () => {
  const h = new Harness(11711);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const bw = spawn(h, P, 'Blightwalker');
  giveResources(h, P, 'dark', 2);
  h.state.players[P]!.bin = ['Cthyrian Rector'];
  withE(h, e => e.destroy(e.entity(bw)!, 'dies'));
  assert.ok(bin(h, P).includes('Blightwalker'), 'setup: Blightwalker died into the bin');

  const menu = blightwalkerMenu(h);
  assert.ok(menu, 'its own trash trigger asks for a target');
  assert.ok(menu!.some(l => l.startsWith('Cthyrian Rector')), `Cthyrian Rector is offered: [${menu!.join(' | ')}]`);
  assert.ok(!menu!.some(l => l.startsWith('Blightwalker')), `and not the Blightwalker itself: [${menu!.join(' | ')}]`);
});
