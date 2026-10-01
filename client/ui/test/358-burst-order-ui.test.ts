/* R309 in the client — the burst is ordered on the board (owner, 2026-10-01,
 * report FXAE a86), and every token wears its X as a die (same day).
 *
 *   §1 clicking a token sends the ORDERED cast, so the first question is which
 *      Fireball resolves first — answered by clicking a token on the board
 *   §2 the bar shows the order built so far: numbered, with each one's aim
 *   §3 a token's X is a die face across its art, not "X=3" in the corner
 *
 * Seeds 35810-35819.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Seat } from '../../engine/src/types.ts';

const { local } = await import('./ui-driver.ts');
const ui = local();

/** a battle where D holds priority with Fireball 1, 3 and 2 at home. D is
 * seat 0 — the seat this client plays — so the first seed from `seed` on
 * whose initiative is seat 1. */
function battle(seed: number): { h: Harness; A: Seat; D: Seat } {
  while (new Harness(seed).state.initiative !== 1) seed++;
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  const r = e.homeRegion(D);
  e.createSpellToken(D, 'Fireball', 1, r);
  e.createSpellToken(D, 'Fireball', 3, r);
  e.createSpellToken(D, 'Fireball', 2, r);
  h.state = e.s;
  pass(h);
  return { h, A, D };
}
const tok = (D: Seat, x: number): number =>
  Object.values(ui.state().entities).find(t => t.kind === 'spellToken' && t.controller === D && t.x === x)!.id;

test('§1 clicking a Fireball asks which resolves first, and a token on the board answers it', () => {
  const { h, D } = battle(35810);
  ui.show(structuredClone(h.state));
  ui.click({ act: 'token', id: tok(D, 1) });
  assert.equal(ui.state().suspension?.type, 'burstPick', 'the ordered cast went out — the order question is up');
  const html = ui.html();
  assert.match(html, /pick the one that resolves first/);
  for (const x of [1, 2, 3]) {
    assert.match(html, new RegExp(`class="card[^"]*candidate[^"]*" data-act="token" data-id="${tok(D, x)}"`),
      `Fireball ${x} lights up on the board as an answer`);
  }
  ui.click({ act: 'token', id: tok(D, 3) });
  assert.equal(ui.state().suspension?.type, 'cast', 'the pick was taken; now it is aimed');
  const sus = ui.state().suspension;
  assert.equal(sus?.type === 'cast' ? sus.item.x : undefined, 3, 'and it is the 3 being aimed');
});

test('§2 the bar numbers the order as it is built, with what each is aimed at', () => {
  const { h, A, D } = battle(35811);
  ui.show(structuredClone(h.state));
  ui.click({ act: 'token', id: tok(D, 2) });
  ui.click({ act: 'token', id: tok(D, 2) });                     // #1: the 2
  let html = ui.html();
  assert.match(html, /class="burststrip"/, 'the strip is up while #1 is aimed');
  assert.match(html, /bursttile now[\s\S]*?class="burstn">1</, 'the one being aimed is #1');
  ui.click({ act: 'player', p: A });                             // aim it
  html = ui.html();
  assert.match(html, new RegExp(`class="burstn">1</span>\\s*<span class="burstaim">→ ${ui.state().players[A]!.name}`),
    '#1 now says where it is going');
  assert.match(html, /2 more to order/);
});

test('§3 a token wears its X as a die face, not "X=n" in the stat corner', () => {
  const { h, D } = battle(35812);
  const html = ui.show(structuredClone(h.state));
  const at = html.indexOf(`data-act="token" data-id="${tok(D, 3)}"`);
  const card = html.slice(at, html.indexOf('data-act=', at + 10));
  assert.match(card, /class="xdie" title="X = 3"/, 'the die');
  assert.equal((card.match(/class="pip p\d"/g) ?? []).length, 3, 'three pips for 3');
  assert.doesNotMatch(card, /class="stats">X=/, 'and no "X=3" in the corner');
});
