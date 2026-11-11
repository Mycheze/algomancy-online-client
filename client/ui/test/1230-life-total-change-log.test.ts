/* REPORT #380 / BL-75 — HOVERING A LIFE TOTAL LISTS THAT PLAYER'S LIFE CHANGES.
 *
 * The owner, 2026-11-11: "When you hover over a player's life total, it'd be
 * nice to show a simple "log" of the life total changes."
 *
 *   §1 the list is read off the engine's OWN sentences (so a reworded log line
 *      turns this red, not the window blank), with the turn each change came in
 *   §2 a run of one-point costs is one row (the hidden-turn summary's fold)
 *   §3 the window: newest first, the amount, the total after, the cause
 *   §4 through the real client: the life total is a tip target, a tap that
 *      targets nobody opens the list (no hover-only information), a second
 *      tap drops it — and it is built from the log a JOIN carries, so a
 *      reload, a reconnect and a spectator see the same list
 *   §5 two seats with the same name: no list rather than a wrong one
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { amendText } from '../../engine/src/amend.ts';
import { toDeployment } from '../../engine/test/util.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';
import { client } from './ui-driver.ts';
import { lifeHistory, lifeTipHtml, LIFE_ROWS, type LifeRow } from '../lifelog.ts';

const MAIN = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** a game at turn 1, then the engine itself changing both life totals */
function played(): { h: Harness; log: string[] } {
  const h = new Harness(38000, ['Annfield', 'Bostock']);
  toDeployment(h);
  const e = new E(h.state as GameState);
  e.loseLife(1, 3, 'Bloated Manablub');
  e.gainLife(0, 2, 'Good Whale');
  // a variable life cost paid one point at a time, each narrated
  for (let i = 0; i < 4; i++) {
    e.ev('info', `${e.pname(0)} pays 1 life — the cost of Flesh Tithe.`);
    e.loseLife(0, 1, 'Flesh Tithe (cost)');
  }
  e.loseLife(1, 5, 'combat');
  const fix = amendText(h.state as GameState, 0, { kind: 'life', target: 1, life: 25 });
  const log = [...h.log, ...e.events.map(x => x.msg).filter(Boolean),
    `🛠 Agreed fix: ${fix} — proposed by Annfield, agreed by Bostock.`];
  return { h, log };
}

test('§1 the engine life sentences become rows, each with its turn', () => {
  const { h, log } = played();
  const turn = h.state.turn;
  assert.ok(turn >= 1, 'the game is under way');
  const [ann, bos] = lifeHistory(log, ['Annfield', 'Bostock']);
  assert.deepEqual(bos, [
    { turn, delta: -3, after: 27, why: 'Bloated Manablub' },
    { turn, delta: -5, after: 22, why: 'combat' },
    { turn, delta: 3, after: 25, why: 'an agreed fix' },
  ] satisfies LifeRow[]);
  assert.equal(ann![0]!.delta, 2);
  assert.equal(ann![0]!.after, 32);
  assert.equal(ann![0]!.why, 'Good Whale');
});

test('§2 four one-point payments for one cost are one row', () => {
  const [ann] = lifeHistory(played().log, ['Annfield', 'Bostock']);
  assert.equal(ann!.length, 2, 'the gain, then the whole cost');
  assert.deepEqual(ann![1], { turn: ann![1]!.turn, delta: -4, after: 28, why: 'Flesh Tithe (cost)' });
  // two separate hits from one source with something between them stay two
  const two = lifeHistory(['— Turn 5 (initiative: B) —', 'A loses 3 life (Bloated Manablub) → 18.',
    'B plays Something.', 'A loses 3 life (Bloated Manablub) → 15.'], ['A', 'B'])[0]!;
  assert.deepEqual(two.map(r => [r.turn, r.delta, r.after]), [[5, -3, 18], [5, -3, 15]]);
});

test('§3 the window lists newest first: the turn, the amount, the total after and the cause', () => {
  const rows: LifeRow[] = [
    { turn: 2, delta: -6, after: 24, why: 'combat' },
    { turn: 3, delta: 2, after: 26, why: 'Good <Whale>' },
    { turn: 4, delta: -4, after: 22, why: 'Flesh Tithe (cost)' },
  ];
  const html = lifeTipHtml('Bostock', 22, rows, esc);
  assert.match(html, /<div class="tiphead">Bostock · 22 life<\/div>/);
  const trs = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => m[1]!.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  assert.deepEqual(trs, ['turn 4 −4 → 22 paid for Flesh Tithe', 'turn 3 +2 → 26 Good &lt;Whale&gt;', 'turn 2 −6 → 24 combat']);
  assert.match(lifeTipHtml('A', 30, [], esc), /no change to their life yet/);
  const many = Array.from({ length: LIFE_ROWS + 3 }, (_, i): LifeRow => ({ turn: 1, delta: -1, after: 29 - i, why: 'combat' }));
  const long = lifeTipHtml('A', 0, many, esc);
  assert.equal([...long.matchAll(/<tr>/g)].length, LIFE_ROWS);
  assert.match(long, /and 3 earlier changes/);
});

test('§4 a tap on a life total opens the list of that player, built from the log the join carried', async () => {
  const ui = await client();
  const { h, log } = played();
  const s = h.state as GameState, me = 0 as Seat;
  const legal = legalActions(h.state, me) as Action[];
  const html = ui.push({ t: 'joined', seat: me, view: s, log, legal, peers: [true, true], names: ['Annfield', 'Bostock'] });
  for (const p of [0, 1]) {
    assert.match(html, new RegExp(`<span class="life[^"]*" data-act="player" data-p="${p}" data-tip="life"`), `seat ${p}'s life total is a tip target`);
  }
  const theirs = ui.tap({ tip: 'life', p: '1' });
  assert.match(theirs, /<div class="tiphead">Bostock · \d+ life<\/div>/, 'the window names the player');
  assert.match(theirs, /\+3<\/td><td>→ 25<\/td><td class="lifewhy">an agreed fix/, 'newest first');
  assert.match(theirs, /−3<\/td><td>→ 27<\/td><td class="lifewhy">Bloated Manablub/);
  assert.doesNotMatch(theirs, /Flesh Tithe/, 'only that player\'s changes');
  assert.doesNotMatch(ui.tap({ tip: 'life', p: '1' }), /class="lifelog"/, 'a second tap drops it');
  // the hover and the tap ask the same function, and the tap gives way to a live pick
  assert.match(MAIN, /if \(!pickOnBoard\(`player:\$\{Number\(t\.dataset\['p'\]\)\}`\) && !pointerCanHover\(\)\) \{\s*tipToggle\(t, tipFor\);\s*if \(tapGoDropped\) render\(\);\s*return;\s*\}/,
    'a tap that also put away a held Cast button repaints, so the button leaves the board');
  assert.match(MAIN, /if \(el\.dataset\['tip'\] === 'life'\) \{[\s\S]{0,400}lifeHistory\(told,/, 'tipFor reads the told part of the log');
});

test('§5 two seats with the same name: no list rather than a wrong one', () => {
  const rows = lifeHistory(['Sam loses 3 life (combat) → 27.'], ['Sam', 'Sam']);
  assert.deepEqual(rows, [[], []]);
});
