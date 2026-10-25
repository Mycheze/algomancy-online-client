/* CR 708.4a — the replacement-order questions of the 2026-10-25 round, on the
 * board (zero-handoff REPLACEMENT-ORDER §4.2 and the owner's answers in §7).
 *
 *  · Automaton of Abundance and Cosmic Conspirator on one creation: "Creating
 *    a Robot 2 — which applies first?". Both glow on the board, each wearing
 *    what a click does (Copy first / Swap first), and neither is a button.
 *  · An Automaton AUGMENTED onto the Conspirator acts from the Conspirator's
 *    body, so both choices would name one unit: the Automaton's choice is the
 *    mod's own badge (`{mod}`), and a click on the shared host asks which.
 *  · An order with one never-worse answer (Proliferating Slime and a Counter
 *    Thief of one player): the owner, 2026-10-25, "Sorta like when blocking,
 *    how it asks 'Choose your split? Or just use default?'" — the default is
 *    the bar's primary button, first, naming what it gives; the other orders
 *    are board clicks that say what they give.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { registerSynthetic, type Printed } from '../../engine/src/cards/dsl.ts';
import { viewFor } from '../../server/view.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, withE } from '../../engine/test/util.ts';
import { boardIndex, isBoard, optionSubjects, pickVerbs } from '../boardpick.ts';
import type { EntityId, GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();

const barOf = (html: string): string => {
  const at = html.indexOf('<div class="promptbar');
  return at < 0 ? '' : html.slice(at, html.indexOf('<div class="side"', at) >>> 0);
};

function show(state: GameState): string {
  const dec = state.decision!;
  ui.join(viewFor(state, dec.seat), dec.seat, legalActions(state, dec.seat));
  ui.sent();
  return ui.html();
}

/** A deploys `cards` and casts Self-Assembly (a Robot X; X = 2 here) */
function selfAssembly(seed: number, cards: string[]) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat;
  const ids = cards.map(c => spawn(h, A, c));
  giveResources(h, A, 'metal', 2);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Self-Assembly') });
  return { h, A, ids };
}

test('CR 708.4a: two token replacements, the question is drawn on the board, says what it asks, and a click on Automaton of Abundance answers it', () => {
  const { h, A, ids: [aoa, cc] } = selfAssembly(70101, ['Automaton of Abundance', 'Cosmic Conspirator']);
  const dec = h.state.decision!;
  assert.equal(dec.seat, A);
  const html = show(h.state);
  const bar = barOf(html);
  assert.match(bar, /Creating a Robot 2 — which applies first\?/, 'the prompt says what is being chosen');
  const view = viewFor(h.state, A);
  const subs = optionSubjects(view.decision!, view);
  subs.forEach((sub, i) => {
    assert.ok(isBoard(sub) && sub.at === 'unit', `option ${i} names a unit on the board`);
    assert.ok(!new RegExp(`data-btn="decide" data-i="${i}"`).test(bar), `option ${i} is not also a button`);
  });
  assert.deepEqual([...pickVerbs(view.decision!, view).values()].sort(), ['Copy first', 'Swap first'],
    'each glowing card says what a click on it does');
  assert.match(html, /<div class="picktag">Copy first<\/div>/);
  ui.click({ act: 'unit', id: aoa! });
  const sent = ui.actions().filter(a => a.type === 'decide');
  const want = dec.options.findIndex(o => (o.value as { unit: number }).unit === aoa);
  assert.deepEqual(sent.map(a => (a as { choice: unknown }).choice), [want], 'the click chooses the Automaton');
  h.do(sent[0]!);
  assert.match(h.state.decision?.prompt ?? '', /instead of the Robot 2\?$/, 'and the engine goes on: the Conspirator asks for the Robot');
  void cc;
});

test('CR 708.4a: the other player sees that a replacement question is open, and not the question', () => {
  const { h, A } = selfAssembly(70102, ['Automaton of Abundance', 'Cosmic Conspirator']);
  const view = viewFor(h.state, (1 - A) as Seat);
  assert.equal(view.decision, null);
  assert.equal(view.pendingAsk?.seat, A);
});

test('CR 708.4a: an Automaton augmented onto the Conspirator is its own click, on the mod badge', () => {
  const h = new Harness(70103);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat;
  const cc = spawn(h, A, 'Cosmic Conspirator');
  let mod = -1 as EntityId;
  withE(h, e => { mod = e.attachMod(e.entity(cc)!, 'Automaton of Abundance', A, 'augment').id; e.settle(); });
  giveResources(h, A, 'metal', 2);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Self-Assembly') });
  const dec = h.state.decision!;
  assert.match(dec.prompt, /which applies first\?$/, 'both apply: asked');
  const aoaOpt = dec.options.findIndex(o => /^Copy first/.test(o.label));
  assert.deepEqual(dec.options[aoaOpt]!.value, { mod, unit: cc, pick: (dec.options[aoaOpt]!.value as { pick: number }).pick },
    'the Automaton choice carries its mod (its unit is the host it reads from)');
  const view = viewFor(h.state, A);
  const subs = optionSubjects(view.decision!, view);
  assert.deepEqual(subs[aoaOpt], { at: 'mod', id: mod, host: cc }, 'read as the mod badge');
  const idx = boardIndex(view.decision!, view, subs);
  assert.deepEqual(idx.get(`mod:${mod}`), [aoaOpt], 'the badge answers the Automaton choice alone');
  assert.equal(idx.get(`unit:${cc}`)?.length, 2, 'the shared host could mean either, so it asks which');
  show(h.state);
  ui.click({ act: 'mod', id: mod });
  assert.deepEqual(ui.actions().filter(a => a.type === 'decide').map(a => (a as { choice: unknown }).choice), [aoaOpt]);
});

registerSynthetic({
  name: 'T701 Growth', cost: '', mana: 0, power: 0, toughness: 0, type: '{Battle} Test Spell',
  kind: 'spell', timing: 'battle', attrs: [], virus: false, burst: false, augmentAttrs: [],
  text: 'Put two +1/+1 counters on target unit.', image: '',
} as Printed, {
  spellEffect: {
    targets: { what: 'unit', prompt: 'T701 Growth' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      const u = t && 'id' in t ? g.entity(t.id) : undefined;
      if (u) g.addCounters(u, 2, ctx.controller);
    },
  },
});

test('CR 708.7: the default is the bar primary button, first, naming its result, and the board takes the other orders', () => {
  const h = new Harness(70104);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  const slime = spawn(h, A, 'Proliferating Slime');
  void slime;
  const thief = spawn(h, A, 'Counter Thief');
  const mark = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk], [slime], [thief]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'T701 Growth') });
  pick(h, { unit: mark });
  for (let i = 0; i < 8 && h.state.stack.length && !h.state.decision; i++) pass(h);
  const dec = h.state.decision!;
  assert.equal(dec.options[0]!.label, 'Default: 3 counters on Counter Thief (the higher number)');
  const html = show(h.state);
  const bar = barOf(html);
  const btn = /<button class="primary" data-btn="decide" data-i="(\d+)"[^>]*>([^<]*)/.exec(bar);
  assert.ok(btn, 'the default is a primary button in the bar');
  assert.equal(btn![1], '0');
  assert.match(btn![2]!, /^Default: 3 counters on Counter Thief \(the higher number\)/);
  assert.ok(bar.indexOf('data-i="0"') < bar.search(/data-btn="decide" data-i="[12]"|$/), 'and it comes first');
  const view = viewFor(h.state, A);
  assert.deepEqual([...pickVerbs(view.decision!, view).values()].sort(), ['2 counters', '3 counters'],
    'each order on the board wears what it gives');
  ui.click({ btn: 'decide', i: 0 } as never);
  const sent = ui.actions().filter(a => a.type === 'decide');
  assert.deepEqual(sent.map(a => (a as { choice: unknown }).choice), [0], 'one click on the default answers it');
  h.do(sent[0]!);
  assert.equal(h.state.entities[thief]!.counters, 3);
});
