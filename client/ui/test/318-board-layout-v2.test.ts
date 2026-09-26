/* THE REGIONS BOARD — docs/18-board-layout-v2.md (owner's sketch, 2026-09-22).
 *
 * A second arrangement of the same pieces, behind the ▦ board toggle. The
 * classic board is pinned byte-for-byte by the rest of this suite (it is what
 * every other test renders); this file is the regions board's own census.
 * Everything is asserted on the markup the client really painted, through
 * test/ui-driver.ts, over the same game driven through planning, an invader
 * on the table, a round-1 attack, blocks with a unit sent to counterattack,
 * and the round-2 counterattack.
 *
 * §1  the toggle: off by default (classic), a rail button, a tutorial step
 * §2  every anchor the classic board emits for a state, the regions board
 *     emits for the same state — each exactly once (anim.ts, the arrows and
 *     the hover layer all look anchors up document-wide)
 * §3  no affordance is swallowed: no data-act inside a data-btn, and the
 *     three page columns keep their order (test/273's contract)
 * §4  the battle panel lands in the battle block of the region the battle is
 *     IN — the defender's in round 1, the attacker's in round 2 — and the
 *     idle block shows the counterattackers heading for it
 * §5  invaders stay in the region's Invaders row (never the battle's invader
 *     column); the spell tokens sit in the In Play block
 * §6  the stylesheet: the nine named rows, the no-scroll clip, the stack rule
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { pass, spawn, toDeployment, toNextBattle, giveResources } from '../../engine/test/util.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';
import { affordances, client } from './ui-driver.ts';
import { TUTORIAL } from '../tutorial.ts';

const ui = await client();
const CSS = readFileSync(fileURLToPath(new URL('../style.css', import.meta.url)), 'utf8');
const store = (globalThis as { localStorage: Storage }).localStorage;
const regions = (on: boolean): void => { store.setItem('algoLayout', on ? '2' : '1'); };

/* ── the game, as a list of labelled states ─────────────────────────── */
type Fixture = { label: string; state: GameState; seat: Seat };
/** round 1, seat 1 declaring blocks — kept apart from FIX so its indexes hold */
let BLOCKS: GameState | null = null;
function fixtures(): Fixture[] {
  const out: Fixture[] = [];
  const keep = (label: string, seat: Seat = 0): void => { out.push({ label, state: structuredClone(h.state), seat }); };
  const h = new Harness(31801);
  keep('planning');
  toDeployment(h);
  const a1 = spawn(h, 0, 'Good Whale'), a2 = spawn(h, 0, 'Ephemeral Skywalker');
  const d1 = spawn(h, 1, 'Rune Channeler'), d2 = spawn(h, 1, 'Curio Drifter');
  giveResources(h, 0, 'fire', 4); giveResources(h, 1, 'water', 5);
  h.state.players[0]!.bin.push('Good Whale', 'Rune Channeler');
  {
    const e = new E(h.state);
    const extra = spawn(h, 0, 'Good Whale');
    h.state.entities[extra]!.region = e.homeRegion(1);   // one of mine standing in their region
    e.createSpellToken(1, 'Poison', 2, e.homeRegion(1));  // one of their tokens at home
  }
  keep('deployment with an invader and a token');
  toNextBattle(h, 0);
  keep('round 1 declare');
  h.do({ type: 'declareAttack', seat: 0, columns: [[a1], [a2]] });
  keep('round 1 attack window');
  pass(h); pass(h);
  BLOCKS = structuredClone(h.state);
  h.do({ type: 'declareBlocks', seat: 1, blocks: { 0: [d1] }, send: [d2] });
  keep('round 1 block window with a sent unit');
  let guard = 60;
  while (h.state.phase === 'battle' && h.state.battle!.round === 1 && guard-- > 0) {
    const dec = h.state.decision;
    if (dec) h.do({ type: 'decide', seat: dec.seat, choice: 0 }); else pass(h);
  }
  assert.equal(h.state.battle?.round, 2, 'the fixture reaches round 2');
  keep('round 2 declare');
  const pool = h.state.battle!.attackerPool ?? [];
  assert.ok(pool.length, 'the sent unit is in the round-2 pool');
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [[pool[0]!]] });
  keep('round 2 attack window');
  return out;
}
const FIX = fixtures();
const paint = (f: Fixture, on: boolean): string => { regions(on); return ui.update(f.state, legalActions(f.state, f.seat)); };
const anchors = (html: string): string[] => [...html.matchAll(/data-animzone="([^"]+)"/g)].map(m => m[1]!).sort();

/** the `.lfight` block for `region`, as the markup between its opening tag
 * and the next block's — enough to ask what it holds */
function fightBlock(html: string, region: number): string {
  const re = new RegExp(`<div class="lfight [^"]*" data-region="${region}"`);
  const m = re.exec(html);
  assert.ok(m, `no .lfight for region ${region}`);
  const from = m.index;
  const next = html.indexOf('<div class="lfight ', from + 10);
  const end = html.indexOf('<div class="linv ', from + 10);
  const stop = [next, end].filter(i => i > from).sort((a, b) => a - b)[0] ?? html.length;
  return html.slice(from, stop);
}

ui.join(FIX[0]!.state, 0, legalActions(FIX[0]!.state, 0));

/* ── §1 the toggle ──────────────────────────────────────────────────── */
test('§1 regions by default; the rail button flips it; the guide has a step', () => {
  // owner, 2026-09-26: regions is everyone's board; classic is one click away,
  // and a browser that chose classic keeps it
  store.removeItem('algoLayout');
  const fresh = ui.update(FIX[1]!.state, legalActions(FIX[1]!.state, 0));
  assert.match(fresh, /class="lboard/);
  assert.doesNotMatch(fresh, /class="player region/);
  assert.ok(ui.has({ btn: 'layouttoggle' }), 'the ▦ board button is in the rail');
  const classic = ui.click({ btn: 'layouttoggle' });
  assert.match(classic, /class="player region/);
  assert.doesNotMatch(classic, /class="lboard/);
  assert.equal(store.getItem('algoLayout'), '1', 'the choice of classic is stored, so it sticks');
  const back = ui.click({ btn: 'layouttoggle' });
  assert.match(back, /class="lboard/);
  assert.equal(store.getItem('algoLayout'), '2');
  const step = TUTORIAL.find(s => s.id === 'settings')!.steps.find(st => st.btns?.includes('layouttoggle'));
  assert.ok(step, 'the settings section of the guide names the button');
});

/* ── §2 the anchors ─────────────────────────────────────────────────── */
test('§2 every anchor, once, in both boards, for every state', () => {
  for (const f of FIX) {
    const a = anchors(paint(f, false)), b = anchors(paint(f, true));
    assert.deepEqual(b, a, `${f.label}: the regions board emits a different set of anchors`);
    assert.deepEqual(b, [...new Set(b)], `${f.label}: an anchor is emitted twice`);
    for (const must of ['field:0', 'field:1', 'life:0', 'life:1', 'res:0', 'res:1', 'deck:0', 'deck:1', 'bin:0', 'bin:1', 'hand:0', 'hand:1']) {
      assert.ok(b.includes(must), `${f.label}: no ${must}`);
    }
  }
});

/* ── §3 nothing swallowed, columns in order ─────────────────────────── */
test('§3 no data-act inside a data-btn; main, actionbar, side in that order', () => {
  let containers = 0;
  for (const f of FIX) {
    const html = paint(f, true);
    const all = affordances(html);
    containers += (html.match(/data-btn="(binopen|cacheopen)"/g) ?? []).length;
    const bad = all.filter(a => a.act !== null && a.enclosingBtn !== null)
      .map(a => `data-act="${a.act}" inside data-btn="${a.enclosingBtn}"`);
    assert.deepEqual(bad, [], `${f.label}: swallowed affordances`);
    const main = html.indexOf('class="main"'), bar = html.indexOf('class="actionbar"'), side = html.indexOf('class="side"');
    assert.ok(main >= 0 && main < bar && bar < side, `${f.label}: column order`);
    assert.match(html, /<div class="stickytop">[\s\S]*?<div class="actionbar">/);
    assert.ok(html.indexOf('class="lboard') > main && html.indexOf('class="lboard') < bar, `${f.label}: the board is inside .main`);
  }
  assert.ok(containers > 0, 'the corpus painted a bin or cache container (a data-btn full of cards), so §3 proved something');
});

/* ── §4 the battle lands in the region it is fought in ──────────────── */
test('§4 round 1 in the defender\'s block, round 2 in the attacker\'s; the idle block shows the incoming', () => {
  const e = new E(FIX[3]!.state);
  const home0 = e.homeRegion(0), home1 = e.homeRegion(1);
  const r1 = paint(FIX[3]!, true);   // seat 0 attacks into seat 1's region
  assert.match(r1, /class="lboard fighting"/);
  assert.match(fightBlock(r1, home1), /class="lfight theirs focus"[\s\S]*class="battle/);
  assert.doesNotMatch(fightBlock(r1, home0), /class="battle/);
  assert.match(fightBlock(r1, home0), /class="lfight mine idle"/);
  const blk = paint(FIX[4]!, true);  // blocks declared, one unit sent to counterattack
  assert.match(fightBlock(blk, home0), /class="lfight mine incoming"[\s\S]*class="sentstrip"/,
    'the counterattacker in transit is drawn in the block it is heading for');
  assert.doesNotMatch(fightBlock(blk, home1), /sentstrip/);
  const r2 = paint(FIX[6]!, true);   // the counterattack, fought in seat 0's region
  assert.equal(FIX[6]!.state.battle?.round, 2);
  assert.match(fightBlock(r2, home0), /class="lfight mine focus"[\s\S]*class="battle/);
  assert.doesNotMatch(fightBlock(r2, home1), /class="battle/);
  // outside a battle both blocks are idle bands
  const idle = paint(FIX[1]!, true);
  assert.match(idle, /class="lboard idle"/);
  assert.equal((idle.match(/class="lfight [a-z]+ idle"/g) ?? []).length, 2);
});

/* ── §5 invaders and tokens ─────────────────────────────────────────── */
test('§5 invaders stay in the Invaders row; spell tokens sit in the In Play block', () => {
  for (const f of [FIX[1]!, FIX[3]!, FIX[4]!]) {
    const html = paint(f, true);
    assert.doesNotMatch(html, /invadercol/, `${f.label}: the battle panel took the invaders`);
    assert.match(html, /<div class="linv [^"]*" data-region="\d"[^>]*>\s*<div class="invaders">/, `${f.label}: the invader is in a .linv row`);
    // the corner is a fit zone of its own (owner, 2026-09-23: the tokens had
    // no height and could not be clicked), so the strip sits in .ltok
    assert.match(html, /<div class="lplay [^"]*"[^>]*>\s*<div class="ltok" data-fit="cards"[^>]*>\s*<div class="tokenstrip">/, `${f.label}: the token strip is in an In Play block`);
  }
  const classic = paint(FIX[3]!, false);
  assert.match(classic, /invadercol/, 'positive control: the classic board does hand a battle its invaders');
});

/* ── §5b the owner's first review (2026-09-23) ─────────────────────── */
test('§5b no zone captions; the send box is in the attacker\'s block; one colour per region; the ring', () => {
  const e = new E(FIX[3]!.state);
  const home0 = e.homeRegion(0), home1 = e.homeRegion(1);
  for (const f of FIX) {
    const html = paint(f, true);
    const board = html.slice(html.indexOf('class="lboard'), html.indexOf('class="actionbar"'));
    assert.doesNotMatch(board, /Region of |invaders in |battle line of /, `${f.label}: a zone caption is back`);
    // region colour follows the REGION, not the viewer
    assert.match(board, new RegExp(`<div class="lback theirs a rc${e.homeRegion(1)}">`), `${f.label}: their tint`);
    assert.match(board, new RegExp(`<div class="lback mine a rc${e.homeRegion(0)}">`), `${f.label}: my tint`);
    assert.match(board, /<svg class="lring rc\d" data-ring="(top|bottom)" data-visit="[01]"/, `${f.label}: no ring`);
  }
  // round 1, seat 0 attacking into seat 1's region: seen from the DEFENDER's
  // seat, the send box is in seat 0's block — where the counterattack will be
  // fought — and no longer in the battle panel
  const blk = BLOCKS!;
  assert.equal(blk.battle?.step, 'blocks');
  regions(true);
  ui.join(blk, 1, legalActions(blk, 1));
  const html = ui.update(blk, legalActions(blk, 1));
  assert.match(fightBlock(html, home0), /class="lfight theirs sendhere"[^>]*data-fit="line"[\s\S]*data-act="sendslot"/,
    'the send box is in the attacker\'s block');
  assert.doesNotMatch(fightBlock(html, home1), /data-act="sendslot"/, 'the send slot left the battle panel');
  assert.match(fightBlock(html, home1), /class="lfight mine focus"/);
  regions(false);
  const classic = ui.update(blk, legalActions(blk, 1));
  assert.match(classic, /<div class="col sendcol"><div class="collabel">send to counterattack<\/div>/,
    'positive control: the classic board keeps its send column');
  ui.join(FIX[0]!.state, 0, legalActions(FIX[0]!.state, 0));
  // the ring is on the focus region, and the visitor's info joins it only once
  // they have ENTERED — declared the attack (owner, 2026-09-26) — not while
  // they are still choosing attackers
  const visitAt = (label: string): string => {
    const f = FIX.find(x => x.label === label);
    assert.ok(f, `no fixture ${label}`);
    // join, not update: at the round-2 declare seat 0 is asked nothing, so the
    // client's pacing (ui/pace.ts) may hold that update back and show the last one
    regions(true);
    const m = /<svg class="lring rc(\d)" data-ring="(?:top|bottom)" data-visit="([01])"/
      .exec(ui.join(f.state, f.seat, legalActions(f.state, f.seat)));
    assert.ok(m, `${label}: no ring`);
    assert.equal(m[1], String(f.state.battle!.region), `${label}: the ring is on the battle's region`);
    return m[2]!;
  };
  assert.equal(visitAt('round 1 declare'), '0', 'choosing attackers is not being there');
  assert.equal(visitAt('round 1 attack window'), '1', 'the declared attacker is in the ring');
  assert.equal(visitAt('round 1 block window with a sent unit'), '1');
  assert.equal(visitAt('round 2 declare'), '0', 'the counterattacker is not there until they declare');
  assert.equal(visitAt('round 2 attack window'), '1', 'the declared counterattacker is in the ring');
  const idle = paint(FIX[1]!, true);
  assert.match(idle, /<svg class="lring rc\d" data-ring="bottom" data-visit="0"/, 'outside a battle your own region is the ring');
});

/* ── §6 the stylesheet ──────────────────────────────────────────────── */
test('§6 the grid, the clip and the stack rule are in style.css', () => {
  const areas = (CSS.match(/\.lboard \{[\s\S]*?grid-template-areas:([\s\S]*?);/) ?? [])[1] ?? '';
  const rows = [...areas.matchAll(/"([^"]+)"/g)].map(m => m[1]!.trim().split(/\s+/));
  assert.equal(rows.length, 9, 'nine rows');
  assert.ok(rows.every(r => r.length === 6), 'six columns each');
  assert.deepEqual(rows[0], ['tinfo', 'tinfo', 'tinfo', 'tplay', 'tplay', 'tplay']);
  assert.deepEqual(rows[2], ['yinv', 'yinv', 'yinv', 'tplay', 'tplay', 'tplay']);
  assert.deepEqual(rows[3], ['yfight', 'yfight', 'yfight', 'tfight', 'tfight', 'tfight']);
  assert.deepEqual(rows[6], ['yplay', 'yplay', 'yplay', 'tinv', 'tinv', 'tinv']);
  assert.deepEqual(rows[8], ['yplay', 'yplay', 'yplay', 'yinfo', 'yinfo', 'yinfo']);
  assert.match(CSS, /#app\.board\.v2 \.main \{[^}]*overflow: hidden/);
  assert.match(CSS, /\.lfight\.focus \.battle \.cols \{[^}]*flex-wrap: nowrap/);
  assert.match(CSS, /#app\.stackfree \.stackboard\.live \{/);
  // test/70 finds the classic strips' rules by a line-anchored selector: no
  // line in the regions block may start with one of them
  const block = CSS.slice(CSS.indexOf('THE REGIONS BOARD'));
  assert.doesNotMatch(block, /^\s*\.(invaders|tokenstrip|sentstrip|regionbin|regioncache|player|zone|card|slot|cols|col|battle)\b[^{]*\{/m,
    'a bare classic selector at the start of a line in the regions block');
});
