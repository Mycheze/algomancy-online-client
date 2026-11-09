/* CT-191 / report #177 — "THEIR HAND, SEEN" IS CLIPPED OUT OF SIGHT IN A BATTLE.
 *
 * The owner (XSEN, Bripp revealed the hand at [135], mid-battle): *"With the
 * new regions layout, the hand viewer reminder list thing is totally broken
 * and can't be seen when in combat. It's fine to sorta hover over the
 * inactive region, like how the stack can be on either side."*
 *
 * The strip was a full-width row of the opponent's info block. That block is
 * `overflow: hidden` and `container-type: size`; `.lboard.fighting` gives the
 * battle rows 1.5fr, the block drops into its two-line layout, and the strip's
 * row falls below the clip. `container-type: size` also makes the block the
 * containing block of anything positioned inside it, so the strip could not be
 * let out by CSS alone — it has to be RENDERED somewhere else in a battle.
 *
 * What the driver can see is the markup (it has no layout), so that is what
 * is asserted: where the strip is painted, and that its three controls are
 * still there to click. The placement itself is the stylesheet's (§3).
 *
 * §1 outside a battle the strip stays where it was, in the info block
 * §2 in a battle it leaves the info block and floats over the In Play block
 *    of the region that is NOT the focus — whichever side that is
 * §3 the stylesheet places the float by grid area, above the ring
 * §4 CT-552 / report #365 — while the attacker picks attackers, the float is
 *    NOT over their own In Play: that is where they pick from (mycheze, TUDN:
 *    "The revealed hand zone covers your units when declaring an attack. I
 *    can't see my units here!"). It stands over the other In Play instead,
 *    where it stands outside a battle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';
import { client } from './ui-driver.ts';
import { readStyles } from './read-styles.ts';

const ui = await client();
const CSS = readStyles();
const ME: Seat = 0, THEM: Seat = 1;

/** deployment with my look at their hand recorded, and then a battle —
 * `attacker` says whose region it is fought in (the defender's) */
function game(seed: number, attacker: Seat): { deploy: GameState; declare: GameState; battle: GameState; fought: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const a = spawn(h, attacker, 'Good Whale');
  spawn(h, (1 - attacker) as Seat, 'Rune Channeler');
  const e = new E(h.state);
  e.revealHandTo(ME, THEM);
  e.settle();
  const deploy = structuredClone(h.state);
  toNextBattle(h, attacker);
  const declare = structuredClone(h.state);
  h.do({ type: 'declareAttack', seat: attacker, columns: [[a]] });
  assert.equal(h.state.phase, 'battle', 'fixture: a battle is on');
  return { deploy, declare, battle: structuredClone(h.state), fought: h.state.battle!.region };
}

function paint(s: GameState): string {
  return ui.join(viewFor(s, ME), ME, legalActions(s, ME));
}

/** the markup of one info block: from its opening tag to the next block */
function infoBlock(html: string, side: 'theirs' | 'mine'): string {
  const from = html.indexOf(`<div class="linfo ${side}`);
  assert.ok(from >= 0, `no .linfo ${side}`);
  const next = html.indexOf(side === 'theirs' ? '<div class="lplay theirs' : '<svg class="lring', from);
  assert.ok(next > from, `no block after .linfo ${side}`);
  return html.slice(from, next);
}
/** the floating strip's markup, from the lseen div to the lboard's end */
function floats(html: string): { side: string; region: number; body: string }[] {
  return [...html.matchAll(/<div class="lseen (theirs|mine)" data-region="(\d+)">/g)].map(m => ({
    side: m[1]!, region: Number(m[2]), body: html.slice(m.index!, m.index! + 4000),
  }));
}

test('CT-191 outside a battle the seen strip floats over their region (board round 8: the info is one line)', () => {
  const { deploy } = game(35201, ME);
  const html = paint(deploy);
  assert.match(html, /Their hand, seen turn/, 'fixture: the aid is on screen');
  assert.doesNotMatch(infoBlock(html, 'theirs'), /class="seenhand/, 'the one-line info has no row for it');
  const f = floats(html);
  assert.equal(f.length, 1, 'it floats');
  assert.equal(f[0]!.side, 'theirs', 'outside a battle your region is the focus, so it floats over theirs');
});

for (const [attacker, label] of [[ME, 'I attack, so the fight is in their region'], [THEM, 'they attack, so the fight is in mine']] as const) {
  test(`CT-191 in a battle the seen strip floats over the region not being fought in: ${label}`, () => {
    const { battle, fought } = game(35202 + attacker, attacker);
    const html = paint(battle);
    assert.match(html, /class="lboard fighting"/, 'fixture: the regions board, fighting');
    assert.doesNotMatch(infoBlock(html, 'theirs'), /seenhand/,
      'the strip is still inside the info block, which clips it in a battle (report #177)');
    const f = floats(html);
    assert.equal(f.length, 1, 'exactly one floating strip');
    assert.notEqual(f[0]!.region, fought, 'it floats over the region that is NOT the focus');
    assert.equal(f[0]!.side, attacker === ME ? 'mine' : 'theirs',
      'over the inactive region, whichever side of the table that is');
    assert.match(f[0]!.body, /Their hand, seen turn/);
    for (const btn of ['seenhideall', 'seendrop']) {
      assert.match(f[0]!.body, new RegExp(`data-btn="${btn}"`), `its ${btn} control is there to click`);
    }
    // …and a click on it still works where it now is
    const i = /data-btn="seendrop" data-i="(\d+)"/.exec(f[0]!.body)![1]!;
    const after = ui.click({ btn: 'seendrop', i });
    assert.match(floats(after)[0]?.body ?? '', /1 crossed off/, 'crossing a card off from the float');
    ui.click({ btn: 'seenrestore' });
  });
}

test('CT-191 the stylesheet places the float by grid area, at the In Play\'s outer corner', () => {
  assert.match(CSS, /\.lboard > \.lseen \{ position: absolute; z-index: 4;/);
  assert.match(CSS, /\.lboard > \.lseen\.theirs \{ grid-area: tplay; top: 4px; right: 8px; \}/);
  assert.match(CSS, /\.lboard > \.lseen\.mine \{ grid-area: yplay; bottom: 4px; left: 8px; \}/);
  // later than the rule that makes every board block `position: relative`
  assert.ok(CSS.indexOf('.lboard > .lseen {') > CSS.indexOf('.lboard > :not(.lback) {'),
    'the float rule comes after the blanket position: relative, so it wins');
});

for (const [attacker, label] of [[ME, 'I am choosing my attackers'], [THEM, 'they are choosing theirs']] as const) {
  test(`CT-552 report 365 - while attackers are chosen the seen strip is not over the attacker's own units: ${label}`, () => {
    const { declare } = game(35204 + attacker, attacker);
    assert.equal(declare.phase, 'battle', 'fixture: a battle is on');
    assert.equal(declare.battle!.step, 'declare', 'fixture: attackers are being chosen');
    assert.equal(declare.battle!.attacker, attacker, 'fixture: the attacker');
    const html = paint(declare);
    const f = floats(html);
    assert.equal(f.length, 1, 'exactly one floating strip');
    // my In Play is the bottom one (`mine`); I pick my attackers from it
    assert.equal(f[0]!.side, 'theirs',
      attacker === ME
        ? 'it floats over THEIR In Play while I pick attackers from mine (report 365)'
        : 'they attack, the fight is in my region, so it floats over theirs as before');
    assert.match(f[0]!.body, /data-btn="seenhideall"/, 'its controls are still there to click');
  });
}
