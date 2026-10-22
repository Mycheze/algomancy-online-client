/**
 * CR 110.11 / D-U03-14 — a deployment AUGMENT onto a "when I become targeted"
 * unit attaches only after that trigger has resolved, as a graft does (CT-242).
 *
 * The owner, 2026-10-22, answering D-U03-13: the trigger "resolves first" — the
 * Crystal is made, THEN the mod attaches — and the same order for an augment
 * applied in deployment. The listeners are DERIVED, not named: every card with
 * a triggered ability on the 'targeted' event, in its body or its [Augment]
 * text, is put in play and both modded in deployment (an augment always; a
 * graft when it is a graft cause), and wherever its trigger fired, its
 * resolution must come before the mod line.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { ent, give, giveResources, toDeployment, tokensOf } from './util.ts';
import type { Element, EntityId, Seat } from '../src/types.ts';

const ELEMENTS: Element[] = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];

/** every card a 'targeted' trigger is printed on — body, [Augment] box or text */
function targetedListeners(): string[] {
  return allCardNames().filter(n => {
    const c = getCard(n) as unknown as Record<string, unknown>;
    const lists = [c['abilities'], c['augmentText'], (c['augmentBox'] as Record<string, unknown> | undefined)?.['abilities']];
    return lists.some(l => Array.isArray(l) && l.some((a: { type?: string; events?: string[] }) =>
      a.type === 'triggered' && (a.events ?? []).includes('targeted')));
  });
}

function board(seed: number, listener: string): { h: Harness; A: Seat; u: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const g = new E(h.state);
  const u = g.spawnUnit(A, listener, g.homeRegion(A)).id;
  g.settle();
  h.state = g.s;
  for (const el of ELEMENTS) giveResources(h, A, el, 4);
  return { h, A, u };
}

/** drain any decision with its first option */
function drain(h: Harness): void {
  for (let guard = 40; (h.state.decision || h.state.stack.length) && guard > 0; guard--) {
    const d = h.state.decision;
    if (d) h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
    else break;
  }
}

/** [index of the listener's trigger line, its resolution line, the mod line] in what one action logged */
function order(h: Harness, from: number, listener: string, mod: string): [number, number, number] {
  const evs = h.events.slice(from);
  return [
    evs.findIndex(ev => ev.type === 'triggered' && ev.msg.includes(listener)),
    evs.findIndex(ev => ev.type === 'resolved' && ev.msg.includes(listener)),
    evs.findIndex(ev => ev.type === 'modApplied' && ev.msg.startsWith(mod)),
  ];
}

test('CR 110.11 / D-U03-14: the derived targeted listeners are found, and Mohruung is one', () => {
  const ls = targetedListeners();
  assert.ok(ls.includes('Mohruung'), `found: ${ls.join(', ')}`);
  assert.ok(ls.length >= 2, `and not only it: ${ls.join(', ')}`);
});

test('CR 110.11 / D-U03-14: every targeted listener modded in deployment resolves its trigger before the mod attaches', () => {
  const fired: string[] = [];
  const fails: string[] = [];
  targetedListeners().forEach((listener, i) => {
    const kinds: ['augment' | 'graft', string][] = [['augment', 'Reality Bender']];
    if ((getCard(listener).abilities ?? []).some(a => (a as { graftCause?: boolean }).graftCause)) kinds.push(['graft', 'Flame Juggle']);
    for (const [how, mod] of kinds) {
      const { h, A, u } = board(5760 + i * 2 + (how === 'graft' ? 1 : 0), listener);
      const from = h.events.length;
      const index = give(h, A, mod);
      h.do(how === 'graft'
        ? { type: 'graft', seat: A, from: 'hand', index, hostId: u, position: 0 }
        : { type: 'augment', seat: A, from: 'hand', index, hostId: u });
      drain(h);
      const [trig, res, attach] = order(h, from, listener, mod);
      if (attach < 0) { fails.push(`${listener} (${how}): ${mod} never attached`); continue; }
      if (trig < 0) continue;                                  // it did not hear a mod: nothing to order
      fired.push(`${listener} (${how})`);
      if (!(res >= 0 && res < attach)) fails.push(`${listener} (${how}): resolved at ${res}, ${mod} attached at ${attach}`);
      if (h.state.pendingMods) fails.push(`${listener} (${how}): a mod is still waiting`);
    }
  });
  assert.deepEqual(fails, []);
  assert.ok(fired.includes('Mohruung (augment)') && fired.includes('Mohruung (graft)'),
    `positive control: Mohruung heard both (${fired.join(', ')})`);
});

test('CR 110.11 / D-U03-14: an augment onto Mohruung in deployment — the Crystal first, then the augment', () => {
  const { h, A, u } = board(5770, 'Mohruung');
  const from = h.events.length;
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Reality Bender'), hostId: u });
  const evs = h.events.slice(from);
  const crystal = evs.findIndex(ev => /creates a Crystal 2/.test(ev.msg));
  const attach = evs.findIndex(ev => /Reality Bender augments Mohruung/.test(ev.msg));
  assert.ok(crystal >= 0 && crystal < attach, `Crystal at ${crystal}, augment at ${attach}`);
  assert.equal(ent(h, u)!.mods.length, 1);
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Crystal').length, 1);
});
