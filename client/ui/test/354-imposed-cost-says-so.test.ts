/* CT-181 — AN IMPOSED-COST PICK READS AS A TARGETING MENU.
 *
 * Vengeance: "Cards your opponents play during battle gain '[Sacrifice a
 * unit]'". The engine asks the payer for the unit as `kind: 'targets'` with
 * the prompt "Sudden Bloom: sacrifice a unit (additional cost)". On
 * 2026-08-27 the owner opened `vengeance-taxes-their-play`, took Sudden Bloom
 * for a targeted card and this pick for its targeting menu, and filed
 * Vengeance as broken (CT-177; retracted twenty minutes later).
 *
 * MEASURED AT HEAD before this file, after the 2026-09-30 board-picks round:
 * the bare-name menu is gone (the two units glow on the board), but the bar
 * still said only "Sudden Bloom: sacrifice a unit (additional cost) — click a
 * highlighted card", and the lit units wore nothing — `pickVerbs` draws a word
 * only when the options' verbs DIFFER.
 *
 * The client can tell a cost from a target with no engine change: the
 * question is asked inside the cast window at stage 'itemCost', and the item's
 * pending atom is 'playSacrifice' (ui/boardpick.ts imposedCost says why that
 * atom means exactly "a cost some other card imposed on this play").
 *
 * §1 the owner's board: the bar says what it is, each lit unit — all of them
 *    the payer's own — wears "Sacrifice"
 * §2 the family, DERIVED: CT-177's census of cards that hang a bracketed cost
 *    on somebody else's play, each played under; every one that asks a
 *    question is drawn as §1, and at least one does
 * §3 a real target is not dressed as a cost — the same play's own target,
 *    asked first, keeps the engine's words and no verb
 *
 * Seeds 35400-35499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { apply, legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { give, giveResources, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';
import { imposedCost } from '../boardpick.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const { dealScenario } = await import('../../server/scenarios.ts');

/** the prompt bar's text */
const barOf = (html: string): string =>
  html.slice(html.indexOf('class="actionbar"'), html.indexOf('class="side"')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
/** each unit on screen that is lit for the open question, with the word it wears */
function lit(html: string): { id: number; tag: string | null }[] {
  return [...html.matchAll(/<div class="card candidate[^"]*" data-act="unit" data-id="(\d+)"/g)].map(m => {
    const body = html.slice(m.index!, html.indexOf('</div>\n  </div>', m.index!) + 1 || m.index! + 800);
    return { id: Number(m[1]), tag: /class="picktag">([^<]*)</.exec(body)?.[1] ?? null };
  });
}
/** the payer's screen, on the regions board */
function paint(s: GameState, seat: Seat): string {
  (globalThis as { localStorage: Storage }).localStorage.setItem('algoLayout', '2');
  return ui.join(viewFor(s, seat), seat, legalActions(s, seat));
}
/** everything §1 asserts, for a question that is an imposed cost on `card` */
function drawnAsCost(s: GameState, card: string, where: string): void {
  const dec = s.decision!;
  const html = paint(s, dec.seat);
  const bar = barOf(html);
  assert.match(bar, new RegExp(`Sacrifice one of your units to play ${card}`),
    `${where}: the bar does not say this is the price of playing ${card}: "${bar.slice(0, 200)}"`);
  assert.match(bar, /an extra cost, not a target/, `${where}: …nor that it is not a target`);
  const units = lit(html);
  const options = dec.options.map(o => (o.value as { unit?: number }).unit).filter((u): u is number => u !== undefined);
  assert.deepEqual(units.map(u => u.id).sort(), [...options].sort(), `${where}: exactly the options glow`);
  for (const u of units) {
    assert.equal(u.tag, 'Sacrifice', `${where}: unit ${u.id} glows without saying what clicking it does`);
    assert.equal(s.entities[u.id]?.controller, dec.seat, `${where}: unit ${u.id} is not the payer's — "your units" would be a lie`);
  }
}

/* ── §1 the owner's board ─────────────────────────────────────────────── */
test('CT-181 vengeance-taxes-their-play: the bar says it is the price of the play and the units say Sacrifice', () => {
  let s = dealScenario(216216216, ['You', 'Tester Bot'], 'shared', undefined as never, undefined, 'vengeance-taxes-their-play').state;
  s = apply(s, legalActions(s, 1).find(a => a.type === 'playCard')!).state;
  assert.equal(s.decision?.kind, 'targets', 'premise: the engine asks the cost as a targets question');
  assert.ok(imposedCost(s.decision!, s), 'the client recognises it as an imposed cost');
  drawnAsCost(s, 'Sudden Bloom', 'the owner\'s board');
});

/* ── §2 the family, derived from CT-177's census ──────────────────────── */
test('CT-181 every card that imposes a bracketed cost on another play is drawn as a cost when it asks', () => {
  const printed = JSON.parse(readFileSync(fileURLToPath(new URL('../../engine/src/cards/printed.json', import.meta.url)), 'utf8')) as
    Record<string, { name: string; text?: string }>;
  // the census of 45-hybrids-ld-b (CT-177), the same derivation: a printed
  // bracket whose body is a cost verb, in a sentence about cards being played,
  // on a card that is not talking about its own play
  const imposers = Object.values(printed)
    .filter(c => /\[(Pay|Sacrifice|Discard|Erase|Gain)[^\]]*\]/i.test(c.text ?? '')
      && /\bcards?\b[^.]*\bplay(ed|s)?\b/i.test(c.text ?? '')
      && !/\bI can be played\b/i.test(c.text ?? ''))
    .map(c => c.name);
  assert.ok(imposers.length >= 2, `fixture: the census found ${imposers.join(', ')}`);
  let asked = 0;
  for (const [n, name] of imposers.entries()) {
    const h = new Harness(35400 + n);
    toDeployment(h);
    const A = h.state.deployPlayer!, D = (1 - A) as Seat;
    spawn(h, A, name);
    toNextBattle(h, D);                       // fought in A's region, where the imposer stands
    const atk = spawn(h, D, 'Good Whale');
    spawn(h, D, 'Unit Token');
    h.do({ type: 'declareAttack', seat: D, columns: [[atk]] });
    giveResources(h, D, 'wood', 4);
    const idx = give(h, D, 'Sudden Bloom');   // targetless: any question is the cost
    const play = legalActions(h.state, D).find(a => a.type === 'playCard' && a.handIndex === idx);
    assert.ok(play, `${name}: fixture: the taxed play is on offer`);
    const s = apply(h.state, play).state;
    if (!s.decision) continue;                // a cost with no choice (life, mana) asks nothing
    asked++;
    assert.ok(imposedCost(s.decision, s),
      `${name} asks a question about the play it taxes that the client does not recognise as a cost: `
      + `"${s.decision.prompt}" — teach ui/boardpick.ts imposedCost its shape`);
    drawnAsCost(s, 'Sudden Bloom', name);
  }
  assert.ok(asked >= 1, 'no imposer in the census asks a question — this test would be vacuous');
});

/* ── §3 a target stays a target ───────────────────────────────────────── */
test('CT-181 the taxed play keeps its own target question as a target', () => {
  const h = new Harness(35450);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, A, 'Vengeance');
  toNextBattle(h, D);
  const atk = spawn(h, D, 'Good Whale');
  spawn(h, D, 'Unit Token');
  h.do({ type: 'declareAttack', seat: D, columns: [[atk]] });
  giveResources(h, D, 'fire', 4);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Flame of History') });
  const dec = h.state.decision!;
  assert.equal(dec.kind, 'targets', 'fixture: the spell\'s own target is asked first (R57)');
  assert.equal(imposedCost(dec, h.state), null, 'a real target is not taken for a cost');
  const html = paint(h.state, D);
  assert.doesNotMatch(barOf(html), /extra cost/, 'the target question is not dressed as a cost');
  assert.ok(lit(html).every(u => u.tag !== 'Sacrifice'), 'and nothing it lights says Sacrifice');
  // …and the cost that follows it is
  const i = dec.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ player: A }));
  h.do({ type: 'decide', seat: D, choice: i >= 0 ? i : 0 });
  drawnAsCost(h.state, 'Flame of History', 'the second question');
});
