/* 339 — THE OWNER'S NOTES (2026-09-28): fewer words on the table, no
 * catching-up chip, the stat plate top-right, and two player reports.
 *
 *   "Text to remove: You are watching them build it … Long text in the 'What
 *    to do next' bar … Nothing is yours to do yet … you are {username} … All
 *    the nonsense in the 'erased cards' panel (and no need to even mention the
 *    number of erased tokens at all) … 'Waiting for Player… to select a unit.
 *    resolve a spell.' Stuff short like that."
 *   "that 'catching up' banner doesn't need to be there at all."
 *   "The power/defense icon on units that are on the field should be in the
 *    top right, to match where Algomancy puts it in the physical cards."
 *
 *   #172 (BZTW): after the game, the attacking units in formation vanished
 *        from the regions board.
 *   #175 (account page): Format Fluent asked for "shared", which is not a
 *        format anyone can pick.
 *
 * §1 the watching view   §2 the prompt bar   §3 the waiting line
 * §4 the room tag        §5 the erased dialog   §6 no catching-up chip
 * §7 the stat plate      §8 #172 the post-game formation   §9 #175
 *
 * Seeds 33900-33999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { viewFor } from '../../server/view.ts';
import { ACHIEVEMENTS } from '../../server/achievements.ts';
import { modeName } from '../account.ts';
import type { EntityId, GameState, Seat } from '../../engine/src/types.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const MAIN = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');
const CSS = readFileSync(fileURLToPath(new URL('../style.css', import.meta.url)), 'utf8');
const store = (globalThis as { localStorage: Storage }).localStorage;
const regions = (on: boolean): void => { store.setItem('algoLayout', on ? '2' : '1'); };

/** the text of the prompt bar, tags stripped */
const bar = (html: string): string => {
  const i = html.indexOf('class="promptbar');
  if (i < 0) return '';
  const end = html.indexOf('</div>', i);
  return html.slice(html.indexOf('>', i) + 1, end).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
};

/* ══ §1 the watching view ══════════════════════════════════════════════ */

test('339 §1 watching an attack being built says live and nothing else', () => {
  regions(true);
  const h = new Harness(33901);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  assert.equal(h.state.battle?.step, 'declare', 'fixture: the attacker is declaring');
  const html = ui.join(viewFor(h.state, D), D, legalActions(h.state, D));
  assert.match(html, /is choosing an attack/, 'positive control: the watching view is drawn');
  assert.match(html, /● live/);
  assert.doesNotMatch(html, /watching them build|nothing is committed/);
});

/* ══ §2 the prompt bar ═════════════════════════════════════════════════ */

test('339 §2 the long how-to sentences are gone from the prompt bars', () => {
  for (const gone of [
    /deploy at the same time — moves stay hidden/,
    /Play cards, mod units \(augment\/graft from hand or bin\)/,
    /it goes past the mark, and is shuffled back in/,
    /Play cards with haste, printed or granted/,
    /play a battle card \/ cast a token \/ virus-augment/,
    /You can keep planning meanwhile/,
    /Combine your hand and pack below/,
    /A back-row unit with nobody in front moves up/,
    /Click cards to move them between hand and pack/,
    /this priority window has already been spent/,
    /so nothing can be confirmed until it is assigned/,
    /your opponent is deploying, hidden until they finish/,
  ]) assert.doesNotMatch(MAIN, gone, `still on screen: ${gone}`);
  // what is left is one short phrase at most
  for (const m of MAIN.matchAll(/<span class="remind">([^<]*)<\/span>/g)) {
    assert.ok(m[1]!.length <= 45, `a reminder is a phrase, not a paragraph: "${m[1]}"`);
  }
  assert.match(MAIN, /`Waiting for \$\{opp\} to deploy`/);
});

test('339 §2 the deployment bar is the heading and the done buttons', () => {
  regions(true);
  const h = new Harness(33902);
  toDeployment(h);
  const html = ui.join(viewFor(h.state, 0), 0, legalActions(h.state, 0));
  const text = bar(html);
  assert.match(text, /^Deployment/, `positive control: the deploy bar is up: ${text}`);
  assert.doesNotMatch(html, /class="promptbar"><span class="who">Deployment<\/span>\s*<span class="remind">/);
  assert.doesNotMatch(text, /at the same time/);
});

/* ══ §3 the waiting line ═══════════════════════════════════════════════ */

test('339 §3 the waiting line is one short line naming who', () => {
  regions(true);
  const h = new Harness(33903);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // a seat the server publishes nothing for (146 #18's shape)
  const html = ui.join(viewFor(h.state, D), D, []);
  const text = bar(html);
  const opp = h.state.players[A]!.name;
  assert.match(text, new RegExp(`^● Waiting for ${opp}`), `the line: ${text}`);
  assert.doesNotMatch(text, /nothing is yours|can no longer be answered|you will see what/);
  assert.ok(text.length <= 60, `one short line: "${text}"`);
});

/* ══ §4 the room tag ═══════════════════════════════════════════════════ */

test('339 §4 the rail says the room, not who you are', () => {
  const h = new Harness(33904);
  toDeployment(h);
  const html = ui.join(viewFor(h.state, 0), 0, legalActions(h.state, 0));
  assert.match(html, /<span class="init">room UIDRIVER/, 'positive control: the room tag is drawn');
  const tag = (html.match(/<span class="init">room UIDRIVER[\s\S]*?<\/span>/) ?? [''])[0];
  assert.doesNotMatch(tag, /you are/i, `the tag: ${tag}`);
  assert.doesNotMatch(html, new RegExp(`you are ${h.state.players[0]!.name}`), 'nor anywhere on the board');
  assert.match(MAIN, /`<span class="init spectating">▶ replay \$\{esc\(NET\.room\)\}<\/span>`/);
  assert.match(MAIN, /`<span class="init spectating">👁 spectating \$\{esc\(NET\.room\)\}<\/span>`/);
  assert.doesNotMatch(MAIN, /SPECTATING\. You are watching this|a finished game\. Nothing here is clickable/);
});

/* ══ §5 the erased dialog ══════════════════════════════════════════════ */

function openErased(): string {
  const menu = ui.rightClick({ act: 'player', p: 0 });
  const hit = [...menu.matchAll(/data-btn="menuitem" data-i="(\d+)">([\s\S]*?)<\/button>/g)]
    .find(m => /erased/i.test(m[2]!.replace(/<[^>]*>/g, '')));
  assert.ok(hit, 'the bare-table menu offers an erased pile');
  return ui.click({ btn: 'menuitem', i: hit[1]! });
}

test('339 §5 the erased dialog is the title and the cards, and tokens are not counted', () => {
  regions(true);
  const h = new Harness(33905);
  toDeployment(h);
  h.state.players[0]!.erased = ['Fight', 'Wisp', 'Wisp'] as never;
  h.state.players[1]!.erased = ['Fight', 'Wisp', 'Wisp'] as never;
  ui.join(viewFor(h.state, 0), 0, legalActions(h.state, 0));
  const html = openErased();
  const box = html.slice(html.indexOf('overlaybox binbox'));
  const dlg = box.slice(0, box.indexOf('erasedclose'));
  assert.match(dlg, /erased cards \(1\)<\/h3>/, 'the count is cards only');
  assert.doesNotMatch(dlg, /token/i, 'erased tokens are not mentioned at all');
  assert.doesNotMatch(dlg, /binmodbanner|out of the game — no bin/, 'no banner sentence');
  ui.key('Escape');
});

/* ══ §6 no catching-up chip ════════════════════════════════════════════ */

test('339 §6 the board carries no catching-up chip or its slot, and S still skips', () => {
  assert.doesNotMatch(MAIN, /id="paceslot"|data-btn="paceskip"|function paceChipHtml/);
  assert.match(MAIN, /if \(overlayUp \|\| !pacedAhead\(\)\) return;[\s\S]{0,120}skipPacing\(\);/,
    'the S key is the way out of the pacing');
});

/* ══ §7 the stat plate ═════════════════════════════════════════════════ */

test('339 §7 the stat plate sits top-right, and the badge strip stops short of it', () => {
  const rule = /^\.card \.stats \{ position: absolute; top: 2px; right: 2px;/m;
  assert.match(CSS, rule, 'the plate is pinned to the top-right corner');
  const body = (CSS.match(/^\.card \.stats \{([^}]*)\}/m) ?? [])[1] ?? '';
  assert.doesNotMatch(body, /bottom:/, 'and not to the bottom any more');
  assert.match(CSS, /^\.card:has\(> \.stats\) > \.badges \{ right: 32px; \}/m,
    'a card with a plate reserves the plate\'s lane in the badge strip');
  assert.match(CSS, /^\.lboard \.lfight\.focus \.linvside \.card:has\(> \.stats\) > \.badges \{ right: calc\(/m,
    'and the smaller invader cards reserve a smaller lane');
  assert.match(CSS, /^\.card \.dmg \{ position: absolute; bottom: 2px; left: 2px;/m, 'damage stays bottom-left');
});

/* ══ §8 #172 the post-game formation ═══════════════════════════════════ */

/** a game that ends in combat damage with the attack still in formation */
function lethalAttack(seed: number): { s: GameState; A: Seat; D: Seat; atk: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = [spawn(h, A, 'Good Whale'), spawn(h, A, 'Good Whale')];
  toNextBattle(h, A);
  h.state.players[D]!.life = 1;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk[0]!], [atk[1]!]] });
  let guard = 80;
  while (h.state.phase === 'battle' && guard-- > 0) {
    const dec = h.state.decision;
    if (dec) h.do({ type: 'decide', seat: dec.seat, choice: 0 });
    else if (h.state.battle?.step === 'blocks') h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [] });
    else pass(h);
  }
  assert.equal(h.state.phase, 'gameover', 'fixture: the attack was lethal');
  assert.ok(h.state.battle, 'fixture: the battle is still on the state at game over');
  const cols = h.state.battle!.columns.flat();
  for (const id of atk) assert.ok(cols.includes(id), `fixture: attacker ${id} is in the formation`);
  return { s: h.state, A, D, atk };
}

test('339 §8 #172 the regions board still draws the formation after the game', () => {
  regions(true);
  const { s, A, D, atk } = lethalAttack(33908);
  for (const seat of [A, D]) {
    const html = ui.join(viewFor(s, seat), seat, []);
    assert.match(html, /class="lboard/, 'positive control: this is the regions board');
    for (const id of atk) {
      assert.match(html, new RegExp(`data-id="${id}"`), `seat ${seat}: attacker ${id} is on the board`);
    }
    // the fight is drawn, and nothing in it can be pressed
    const at = html.indexOf('lfight');
    const fightStart = html.lastIndexOf('<div', html.indexOf(' focus"', at));
    assert.ok(fightStart >= 0, 'the fight block is drawn in focus');
    assert.doesNotMatch(html.slice(fightStart, html.indexOf('class="linv', fightStart)), /data-btn="/,
      'no button in the post-game fight');
    assert.doesNotMatch(html, /class="card[^"]*\b(playable|activatable)\b/, 'and no card offers a click');
  }
});

test('339 §8 #172 …and so does the classic board', () => {
  regions(false);
  const { s, A, atk } = lethalAttack(33909);
  const html = ui.join(viewFor(s, A), A, []);
  assert.doesNotMatch(html, /class="lboard/, 'positive control: this is the classic board');
  for (const id of atk) assert.match(html, new RegExp(`data-id="${id}"`), `attacker ${id} is on the board`);
  regions(true);
});

/* ══ §9 #175 Format Fluent ═════════════════════════════════════════════ */

test('339 §9 #175 Format Fluent asks for the two formats a player can pick', () => {
  const a = ACHIEVEMENTS.find(x => x.id === 'format-fluent')!;
  assert.ok(a, 'the achievement exists');
  assert.equal(a.desc, 'Play both formats: live draft and constructed.');
  assert.equal(a.goal, 2);
  assert.doesNotMatch(a.desc, /shared/);
  const count = (byMode: Record<string, number>): number =>
    a.count({ byMode } as never, { friends: [] } as never);
  assert.equal(count({ draft: 1, constructed: 1 }), 2, 'both formats earn it');
  assert.equal(count({ shared: 9, draft: 1 }), 1, 'sandbox games do not count toward it');
});

test('339 §9 #175 the internal sandbox mode is never shown as "shared"', () => {
  assert.equal(modeName('shared'), 'sandbox');
  assert.equal(modeName('draft'), 'live draft');
  assert.equal(modeName('constructed'), 'constructed');
});
