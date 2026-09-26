/* R273 — TWO OWNER REPORTS ABOUT WHERE THINGS STAND IN A BATTLE.
 *
 *  [#137] CT-150, room ERJZ (action 100): "The 'live view' of an opponent's
 *         attacks or blocks are showing in the orientation that the opponent
 *         sees, which is to say, mirrored for what the person who's seeing it
 *         should see. The live view should ALSO be mirrored in the way that it
 *         is when blocks/attacks are actually declared (which is done
 *         properly). Right now, when they declare blocks/attacks, the columns
 *         switch around, which is very weird to see."
 *
 *  [#138] CT-151, room ERJZ (action 104): "The Invaders area should probably
 *         be in the attackers window somewhere. Sending counter attackers way
 *         over there is good, but for tokens and things made during combat,
 *         they'd look better in the attacking box area."
 *
 * ── WHAT #137 IS, MEASURED BEFORE ANY EDIT ────────────────────────────
 *
 * THE LIVE VIEW WAS NOT MIRRORED WRONG. IT WAS NOT ORIENTED AT ALL — and it
 * was broken in TWO independent places, which matters because the brief this
 * work started from named only the first.
 *
 *   · THE ATTACK. `battleHtml`'s `declare` branch returned `watchingHtml`
 *     BEFORE the line that computes `flip`. The watcher therefore got a flat
 *     `<div class="cols">` of `.pendingcol` boxes with no `.bhalf`, no `.vs`
 *     line and no halves at all, while the committed view is a two-half table
 *     with the attacker on the far side of the line. Measured at HEAD, the
 *     live markup for a two-column attack contained the string `bhalf` zero
 *     times and the committed markup contained it four times.
 *
 *   · THE BLOCKS. This one is subtler and is the reason the report says
 *     "attacks OR blocks". The committed blockers ARE oriented — they go
 *     through the same `flip`. But `pendingColHtml` wrapped the opponent's
 *     half-built column in a `.pendingcol` div, and `.bhalf.top` is
 *     `flex-direction: column-reverse` (style.css, so that a column's FRONT
 *     unit hugs the vs line however deep the column is). A wrapper is its own
 *     flex context: the reversal stopped at it. So the two units in a pending
 *     block column stood front-on-top, and the instant the declaration
 *     committed they swapped — same DOM order, opposite screen order.
 *
 *     ⚠ THAT SECOND ONE IS INVISIBLE TO A TEST THAT READS DOM ORDER. The DOM
 *     order was already identical before and after; only the CSS box that
 *     governs it changed. §2 therefore asserts the CONTAINER, not the order:
 *     a pending card must be a direct child of the same `.bhalf` a committed
 *     card is a direct child of, because that is the thing that makes one
 *     rule govern both. It is also why the fix deletes the wrapper rather
 *     than adding a second CSS rule beside it.
 *
 * ── THE SHAPE OF THE FIX, AND WHAT THESE GUARDS ARE FOR ───────────────
 *
 * `flip` moved above the `declare` branch and every column in the panel — the
 * committed table, the placement end-columns, `watchingHtml`, and #138's new
 * invader column — is now built by `battleColHtml`, the one function that
 * decides which half is whose. A second `flip` next to the watching view would
 * have made the two agree until the next edit; these guards are written so
 * that a second one cannot pass them.
 *
 * ── NON-VACUITY ───────────────────────────────────────────────────────
 *
 * Every section here asserts FIRST that the two things it is about to compare
 * are describing the same board — same entities, same columns, same order —
 * and §3 asserts against the ENGINE state that the invader really is standing
 * in the battle region and really is in nobody's column. An orientation
 * assertion over two views that disagree about what is on the table would pass
 * for the wrong reason, and an "it is drawn in the battle panel" assertion
 * over an empty invader set would pass for no reason at all.
 *
 * Seeds 25300-25399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import { spawn, toDeployment, toNextBattle, tokensOf } from './util.ts';
import { client } from '../../ui/test/ui-driver.ts';
import type { EntityId, Seat } from '../src/types.ts';

/** the real client, driven — see test/ui-driver.ts */
const ui = await client();
// the CLASSIC board's battle panel is what report #138 was about; the regions
// board (the default since 2026-09-26) draws invaders in its own row, pinned
// by ui/test/318 §5
(globalThis as { localStorage: Storage }).localStorage.setItem('algoLayout', '1');

// ── reading the battle table out of the board ─────────────────────────

/** the balanced `<div …>…</div>` that starts at `at` */
function divAt(html: string, at: number): string {
  let i = html.indexOf('>', at), depth = 1;
  while (depth > 0) {
    const open = html.indexOf('<div', i), close = html.indexOf('</div>', i);
    assert.ok(close >= 0, 'unbalanced markup in the battle panel');
    if (open >= 0 && open < close) { depth++; i = open + 4; } else { depth--; i = close + 6; }
  }
  return html.slice(at, i);
}

/** just the battle panel */
function battlePanel(html: string): string {
  const at = html.indexOf('<div class="battle');
  assert.ok(at >= 0, 'the board is not showing a battle panel at all');
  return divAt(html, at);
}

interface Half { cls: string; body: string }
interface Col { label: string; halves: Half[] }

/**
 * The battle panel as columns, each with the halves it really drew — DERIVED
 * from the markup, so a column shape nobody here anticipated still gets read
 * rather than silently skipped. A column with no `.bhalf` in it (which is what
 * the live view was at HEAD) comes back with an EMPTY halves list, which is
 * the honest answer and the one that makes §1 go red.
 */
function columnsOf(html: string): Col[] {
  const panel = battlePanel(html);
  const out: Col[] = [];
  for (const m of panel.matchAll(/<div class="col(?:| [^"]*)">/g)) {
    const col = divAt(panel, m.index);
    const label = (/<div class="collabel">([\s\S]*?)<\/div>/.exec(col) ?? [])[1] ?? '';
    const halves: Half[] = [];
    for (const hm of col.matchAll(/<div class="(bhalf[^"]*)">/g)) {
      halves.push({ cls: hm[1]!, body: divAt(col, hm.index) });
    }
    out.push({ label: label.replace(/<[^>]*>/g, '').trim(), halves });
  }
  return out;
}

/** the entities in a chunk of board markup, in document order.
 *
 * ⚠ `data-anim`, on the CARD DIV, and neither of the two obvious choices —
 * both of which produce a reader that is blind to exactly the case it is
 * pointed at, and both of which I wrote before measuring:
 *
 *   · `data-id` is absent on an INERT card, which is every card in a live,
 *     uncommitted view. A reader keyed on it sees a full committed view and an
 *     empty live one and reports them equal.
 *   · `data-previd` is emitted by `unitHtml` and NOT by `tokenHtml`, so a
 *     reader keyed on it cannot see a spell token at all — and a riding spell
 *     token is the exact thing report #138 is about.
 *
 * `data-anim` is the client's own motion key and is on every card the board
 * draws, committed or pending, unit or token. It is scoped to the card's
 * opening tag here because a MOD rides on its host as a badge carrying the
 * mod's own `data-anim`, and a mod is not a thing standing in a column. */
const entsIn = (chunk: string): EntityId[] =>
  [...chunk.matchAll(/<div class="card\b[^"]*"[^>]*\bdata-anim="e(\d+)"/g)].map(m => Number(m[1]));

/** for every entity in the panel: the column label and the half class it
 * stands in — i.e. WHERE ON SCREEN it is, which is the whole of #137.
 *
 * `pending` is dropped: it is the dashed not-committed-yet TREATMENT, and a
 * live view is entitled to wear it. Where the units stand is the question
 * here; that the marker is worn as an extra class rather than instead of the
 * half is asserted on its own below. */
function placement(html: string): Map<EntityId, string> {
  const out = new Map<EntityId, string>();
  for (const col of columnsOf(html)) {
    for (const half of col.halves) {
      const where = `${col.label} / ${half.cls.replace(/\s*\bpending\b/, '')}`;
      for (const id of entsIn(half.body)) out.set(id, where);
    }
  }
  return out;
}

/** every entity the battle panel drew ANYWHERE, halves or not — the
 * non-vacuity reader, and the one that must agree between the two views */
const inPanel = (html: string): EntityId[] => entsIn(battlePanel(html));

// ── fixtures ──────────────────────────────────────────────────────────

/**
 * ⚠ `NET.building` IS MODULE STATE IN ui/main.ts AND OUTLIVES A FIXTURE.
 * Entity ids restart at 1 for every fresh `Harness`, so a formation left
 * published by the previous test names ids that exist in THIS one — and
 * `inFormationIds` then holds them out of the region panels for a formation
 * nobody is building. That is not a hypothetical: it is what made §3 fail
 * against the finished fix, because the invading token happened to reuse an id
 * a §2 block preview had left behind.
 */
function clearBuilding(): void { ui.push({ t: 'building', seat: 0, cols: [], send: [] }); }

/** a battle stopped at the `declare` step, A attacking, with `n` spare
 * attackers and one defender */
function declareStep(seed: number, n: number): { h: Harness; A: Seat; D: Seat; atk: EntityId[] } {
  clearBuilding();
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk: EntityId[] = [];
  for (let i = 0; i < n; i++) atk.push(spawn(h, A, 'The Foretold'));
  spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  assert.equal(h.state.battle!.step, 'declare', 'the attack declaration is open');
  return { h, A, D, atk };
}

/** …and on to the block step, with `n` free defenders */
function blockStep(seed: number, cols: number, n: number):
{ h: Harness; A: Seat; D: Seat; def: EntityId[] } {
  const { h, A, D, atk } = declareStep(seed, cols);
  const def: EntityId[] = [];
  for (let i = 0; i < n; i++) def.push(spawn(h, D, 'The Foretold'));
  h.do({ type: 'declareAttack', seat: A, columns: atk.map(id => [id]) });
  for (let guard = 0; guard < 40 && h.state.battle!.step !== 'blocks'; guard++) {
    const dec = h.state.decision;
    if (dec) h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
    else h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  assert.equal(h.state.battle!.step, 'blocks', 'the block step is open');
  return { h, A, D, def };
}

// ── §1 — #137, the ATTACK live view ───────────────────────────────────

test('the live attack and the declared attack put the same units in the same halves', () => {
  const { h, A, D, atk } = declareStep(25301, 3);
  const cols: EntityId[][] = [[atk[0]!, atk[1]!], [atk[2]!]];

  ui.join(h.state, D, legalActions(h.state, D));
  const live = ui.push({ t: 'building', seat: A, cols, send: [] });
  h.do({ type: 'declareAttack', seat: A, columns: cols });
  const done = ui.update(h.state, legalActions(h.state, D));

  // NON-VACUITY FIRST: the two views are of the SAME board. Without this the
  // orientation assertion below is satisfied by two empty maps.
  assert.deepEqual(inPanel(live), atk,
    'the live view is not showing the three units being placed — the fixture never reached '
    + 'the watching view, so nothing below is about anything');
  assert.deepEqual(inPanel(done), inPanel(live),
    'the two views disagree about which units are in the attack — they are not two pictures of '
    + 'one board and cannot be compared');
  assert.deepEqual(columnsOf(live).map(c => c.label), columnsOf(done).map(c => c.label),
    'the columns are not even named the same in the two views');

  // …and now the report.
  assert.deepEqual(placement(live), placement(done),
    'the live view puts the opponent’s units somewhere other than where the declaration '
    + 'puts them, so everything moves the instant they confirm — report #137');
});

test('the live attack view draws the vs line and both halves of every column', () => {
  // the shape underneath the placement equality: at HEAD the live view had no
  // halves at all, so `placement` was empty and would have compared equal to
  // any other empty map had the non-vacuity check above not existed. This
  // asserts the structure directly, so the failure names the cause.
  const { h, A, D, atk } = declareStep(25302, 2);
  ui.join(h.state, D, legalActions(h.state, D));
  const live = ui.push({ t: 'building', seat: A, cols: [[atk[0]!], [atk[1]!]], send: [] });
  const cols = columnsOf(live);
  assert.equal(cols.length, 2, 'two columns are being built and two are being watched');
  for (const c of cols) {
    assert.deepEqual(c.halves.map(x => x.cls.replace(/ pending$/, '')), ['bhalf top', 'bhalf bot'],
      `the live column "${c.label}" is not a two-half table — it is the flat strip the declarer `
      + 'sees, which is exactly what report #137 says is wrong');
  }
  assert.ok(battlePanel(live).includes('class="vs"'),
    'the live view has no vs line, so there is nothing for the units to be on a side OF');
});

test('the live attack view reserves the same row height the declaration will', () => {
  // the fronts have to meet on one line before AND after, or the whole column
  // hops the moment it commits even with every unit in the right half
  const { h, A, D, atk } = declareStep(25303, 3);
  const cols: EntityId[][] = [[atk[0]!, atk[1]!], [atk[2]!]];
  ui.join(h.state, D, legalActions(h.state, D));
  const live = ui.push({ t: 'building', seat: A, cols, send: [] });
  h.do({ type: 'declareAttack', seat: A, columns: cols });
  const done = ui.update(h.state, legalActions(h.state, D));
  const rows = (s: string): string =>
    (/<div class="cols" style="([^"]*)"/.exec(battlePanel(s)) ?? [])[1] ?? 'none';
  assert.equal(rows(live), rows(done),
    'the two views reserve different row heights, so the shared front line moves on commit');
  assert.notEqual(rows(live), 'none', 'the live view sets no row heights at all');
});

// ── §2 — #137, the BLOCKS live view ───────────────────────────────────

test('a pending blocker sits in the same container a committed blocker sits in', () => {
  /* THE HALF THE BRIEF DID NOT NAME. `.bhalf.top` is column-reverse; a
   * wrapper div inside it is its own flex context and stops the reversal
   * dead. Two pending blockers therefore stood front-on-top and swapped
   * places the moment the block declaration landed — with the DOM order
   * identical throughout, which is why this asserts the CONTAINER. */
  const { h, A, D, def } = blockStep(25311, 1, 2);
  const built: EntityId[][] = [[def[0]!, def[1]!]];

  // the ATTACKER watches the defender build blocks
  ui.join(h.state, A, legalActions(h.state, A));
  const live = ui.push({ t: 'building', seat: D, cols: built, send: [] });
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: built[0]! } });
  const done = ui.update(h.state, legalActions(h.state, A));

  // NON-VACUITY FIRST
  const liveHalf = columnsOf(live)[0]!.halves.find(x => entsIn(x.body).length === 2);
  const doneHalf = columnsOf(done)[0]!.halves.find(x => entsIn(x.body).length === 2);
  assert.ok(liveHalf, 'the live view is not showing the two blockers being placed');
  assert.ok(doneHalf, 'the declared view is not showing the two blockers');
  assert.deepEqual(entsIn(liveHalf.body), entsIn(doneHalf.body),
    'the two views disagree about which blockers are in the column');
  assert.equal(liveHalf.cls.replace(/ pending$/, ''), doneHalf.cls,
    'the blockers are not even in the same half before and after');

  // …and the report: nothing may stand between the half and its cards, because
  // the half is what carries the ordering rule.
  const firstCard = (body: string): string => {
    const at = body.indexOf('<div class="card');
    assert.ok(at > 0, 'no card in this half');
    return body.slice(body.indexOf('>') + 1, at);
  };
  assert.ok(!firstCard(doneHalf.body).includes('<div'),
    'the premise: a COMMITTED blocker is a direct child of its .bhalf');
  assert.ok(!firstCard(liveHalf.body).includes('<div'),
    'a PENDING blocker is wrapped in a box of its own inside the half, so .bhalf.top’s '
    + 'column-reverse stops at the wrapper and the column’s front and back swap on screen '
    + 'the instant the block is declared — report #137, its "blocks" half');
});

test('a live block column is marked pending without changing where it stands', () => {
  // the dashed "not committed yet" treatment had to move off the deleted
  // wrapper and onto the half — but only ever as an EXTRA class, or moving it
  // would be a second way to lose the orientation
  const { h, A, D, def } = blockStep(25312, 1, 1);
  ui.join(h.state, A, legalActions(h.state, A));
  const live = ui.push({ t: 'building', seat: D, cols: [[def[0]!]], send: [] });
  const half = columnsOf(live)[0]!.halves.find(x => entsIn(x.body).length === 1)!;
  assert.ok(half.cls.split(/\s+/).includes('pending'),
    'the opponent’s uncommitted blockers are not marked as uncommitted at all');
  assert.ok(/^bhalf (top|bot)\b/.test(half.cls),
    'the pending marker replaced the half rather than dressing it');
});

// ── §3 — #138, the invaders ───────────────────────────────────────────

/** A attacks D with one unit and brings a Poison token along for the ride.
 * The token stands in the contested region and is in NO column — which is
 * exactly the "tokens and things made during combat" the report is about. */
function ridingToken(seed: number): { h: Harness; A: Seat; D: Seat; atk: EntityId; tok: EntityId } {
  const { h, A, D, atk } = declareStep(seed, 1);
  const e = new E(h.state);
  e.createSpellToken(A, 'Poison', 1, e.homeRegion(A));
  const tok = tokensOf(h, A).find(t => t.card === 'Poison')!.id;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk[0]!]], spellTokens: [tok] });
  return { h, A, D, atk: atk[0]!, tok };
}

test('a token that rode in with the attack is drawn in the battle panel, not off to the side', () => {
  const { h, D, tok } = ridingToken(25321);
  const b = h.state.battle!;

  // NON-VACUITY, AGAINST THE ENGINE: it really is an invader, and it really is
  // in nobody's column. Both halves matter — a token still at home, or one the
  // client counts as part of the formation, would be drawn in the battle panel
  // for reasons that have nothing to do with this report.
  assert.equal(h.state.entities[tok]!.region, b.region,
    'the premise: the token travelled into the contested region');
  assert.notEqual(h.state.entities[tok]!.controller, h.state.regions[b.region]!.owner,
    'the premise: it does not belong to whoever owns that region — it is an invader');
  assert.ok(!b.columns.flat().includes(tok),
    'the premise: it is in no attacking column, so nothing else would draw it in the line');

  const board = ui.join(h.state, D, legalActions(h.state, D));
  assert.ok(inPanel(board).includes(tok),
    'the riding token is still parked in the region panel’s side strip rather than in the '
    + 'fight it is part of — report #138');
});

test('the invaders are drawn once, by the battle panel or the region panel and never both', () => {
  // the failure mode a two-panel move creates, in both directions: drawn
  // twice, or dropped by each panel in the belief that the other has it
  const { h, D, tok } = ridingToken(25322);
  const board = ui.join(h.state, D, legalActions(h.state, D));
  const drawn = entsIn(board).filter(id => id === tok);
  assert.equal(drawn.length, 1,
    `the riding token is drawn ${drawn.length} times on the board — a panel that hands the `
    + 'invaders over has to be the only one that stops drawing them');
  assert.ok(inPanel(board).includes(tok), 'and the one place it is drawn is the battle panel');
});

test('the invaders stand on the side of the line the seat that controls them is on', () => {
  // the reason this is a COLUMN and not a strip pinned to the top of the row:
  // a strip reads as "on the attacker's side" for one seat and "on the
  // defender's side" for the other, which is report #137 inside a fix for #138
  const { h, A, D, tok } = ridingToken(25323);

  const asDefender = ui.join(h.state, D, legalActions(h.state, D));
  const defSide = placement(asDefender).get(tok);
  const asAttacker = ui.join(h.state, A, legalActions(h.state, A));
  const atkSide = placement(asAttacker).get(tok);

  assert.ok(defSide, 'the defender is not shown the invading token in the battle table at all');
  assert.ok(atkSide, 'nor is the attacker, who owns it');
  // NON-VACUITY: the two seats are looking at the same column of the same
  // table, so the only thing that may differ is which half of it.
  assert.equal(defSide.split(' / ')[0], atkSide.split(' / ')[0],
    'the two seats are not even looking at the same column');
  assert.notEqual(defSide, atkSide,
    'both seats see the invaders in the SAME half — one of them is being shown their '
    + 'opponent’s units on their own side of the vs line');
  const half = (s: string): string => s.split(' / ')[1]!.replace(/ pending$/, '');
  assert.equal(half(defSide), 'bhalf top', 'the defender sees the invaders across the line');
  assert.equal(half(atkSide), 'bhalf bot', 'the attacker sees his own, on his own side');
});

test('while an attack is only being declared the region panel still draws the invaders', () => {
  /* THE OTHER DIRECTION OF THE HAND-OFF, and the one the fix creates rather
   * than cures. `battleHtml`'s `declare` branch draws a BUILDER, not the
   * two-half table — it returns long before there is any column for an
   * invader to stand beside — so a "the battle is in this region" test would
   * take the invaders off the region panel and hand them to a panel that is
   * not drawing any. They would be on the board one paint and gone the next.
   *
   * ⚠ THE FIRST TWO VERSIONS OF THIS TEST ASSERTED NOTHING, and both looked
   * fine. After the battle phase there ARE no invaders: R11 regroup sends
   * every unit home and erases every spell token, so a version written on the
   * riding token short-circuited on a card that no longer existed, and a
   * version written on the attacking unit found it standing back in its own
   * region. The one moment an invader really is on the board with no committed
   * line to stand in is a ROUND-2 declaration: the counterattackers have
   * arrived in the region they were sent to, and nobody has placed them yet.
   * That is what this builds, and the premise is asserted against the engine.
   *
   * Green against HEAD, which has only ever had one drawer. */
  const { h, A, D, atk } = declareStep(25331, 1);
  const ctr = spawn(h, D, 'The Foretold');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk[0]!]] });
  for (let g = 0; g < 40 && h.state.battle!.step !== 'blocks'; g++) {
    const dec = h.state.decision;
    if (dec) h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
    else h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [ctr] });
  for (let g = 0; g < 60 && !(h.state.battle?.round === 2 && h.state.battle.step === 'declare'); g++) {
    const dec = h.state.decision;
    if (dec) h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
    else if (h.state.priority !== null) h.do({ type: 'passPriority', seat: h.state.priority });
    else break;
  }
  const b = h.state.battle;
  assert.equal(b?.round, 2, 'the premise: the counterattack round');
  assert.equal(b.step, 'declare', 'the premise: nothing is declared yet, so there is no line');
  const c = h.state.entities[ctr]!;
  assert.ok(!c.absent && c.region === b.region,
    'the premise: the counterattacker has arrived in the contested region');
  assert.notEqual(c.controller, h.state.regions[b.region]!.owner,
    'the premise: which is not its own, so it is an invader');
  assert.ok(!b.columns.flat().includes(ctr), 'the premise: and it is in no column');

  for (const seat of [A, D] as Seat[]) {
    const board = ui.join(h.state, seat, legalActions(h.state, seat));
    assert.equal(entsIn(board).filter(id => id === ctr).length, 1,
      `seat ${seat} is shown the arrived counterattacker either twice or not at all — the `
      + 'region panel handed the invaders to a battle panel that is still only a builder');
  }
});
