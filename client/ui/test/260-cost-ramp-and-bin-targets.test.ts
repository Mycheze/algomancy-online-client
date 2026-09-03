/* R280 — TWO OWNER REPORTS FROM ROOM ZSPG, both about a thing the client had
 * and did not put where it was needed.
 *
 * ZSPG replays FAITHFULLY at the deployed commit (236/236 actions, 0 refused,
 * no fork, engine e8aed524a8), so both are reproducible rather than reported:
 *   node --experimental-strip-types client/server/replay-room.ts <ZSPG.json> --log
 *
 * ── #147 / CT-162, action 62 — THE PAY-X-LIFE RAMP ────────────────────
 *
 *   "Pay X life effects should also have the up/down arrows and the ability to
 *    type a number. I accidentally went too far and had to hit cancel. Also,
 *    the 'that's enough' button is too hard to see and tell that it's a
 *    button. it should be a full, differently colored button"
 *
 * The log is the proof of the cost. Thirteen consecutive
 * `Ben loses 1 life (Flesh Tithe (cost))` lines, `Flesh Tithe: X = 13`, and a
 * play unwound — because a variable cost is charged AS IT IS CLICKED and the
 * only way back is cancelling the whole cast.
 *
 * The word carrying the report is **also**: R197's numeric entry — the `−10 −
 * [box] + +10` bar with the typed `#num-entry` — already exists, and this
 * question never got it. So §2-§4 are about the SHARE, not about a new
 * control: the box, the arrows, the quick picks, the Enter key and
 * `snapshotViewport`'s caret rescue are R197's, reached by dressing the live
 * cost question as the `NumberDecisionLike` it already knows how to draw.
 *
 * ── #154 / CT-169, action 200 — THE TARGETED BIN CARD ─────────────────
 *
 *   "When a card or effect is targeting something in the bin, have that card
 *    visually surface to the top of the bin so that it's easy to hover over
 *    and see by all players without needing to click into the bin"
 *
 * The live case is ZSPG action 199: a Hooba-Mon trigger on the stack aimed at
 * `Smouldering Inferno` in a bin six deep, while the region strip drew
 * `bin.slice(-3)`. §5-§7.
 *
 * ⚠ MEASURED AND CONTRADICTING THE BRIEF: the opponent CAN open the other
 * seat's bin dialog. `binopen` is on the opponent's region panel for either
 * seat, `binView` takes either seat, and `viewFor` does not redact a bin —
 * §7 asserts it, because a fix argued from "they cannot get in at all" would
 * be argued from something false. What was actually true of BOTH seats is
 * that the strip showed the last three and the target was not among them.
 *
 * Seeds 1900-1949.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { give, giveResources, spawn, toDeployment, toNextBattle, withE } from '../../engine/test/util.ts';
import { viewFor } from '../../server/view.ts';
import { client, zone } from './ui-driver.ts';
import type { Action, Decision } from '../../engine/src/types.ts';

/** the real client, driven — see test/ui-driver.ts */
const ui = await client();

/** the option index whose VALUE carries `key` — the engine's own contract for
 * what an answer means, never the label */
function optIdx(dec: Decision, key: string): number {
  return dec.options.findIndex(o => !!o.value && typeof o.value === 'object' && key in (o.value as object));
}

/**
 * A live "[Pay X life]" cost question: Flesh Tithe, mid-cast, with the cost
 * collector suspended on it. Exactly the shape ZSPG action 62 was.
 */
function payXLife(seed = 1900): Harness {
  const h = new Harness(seed);
  toDeployment(h);
  giveResources(h, 0, 'light', 8);
  h.do({ type: 'playCard', seat: 0, handIndex: give(h, 0, 'Flesh Tithe') });
  return h;
}

/**
 * A Blightwalker trigger on the stack, aimed at a card BURIED in its own
 * controller's bin. The ZSPG shape, built from the same card family the game
 * used (`what: 'binCard'`, R64's declared bin target).
 */
function binTargeted(seed = 1902): { h: Harness; buried: string } {
  const h = new Harness(seed);
  toDeployment(h);
  const bw = spawn(h, 0, 'Blightwalker');
  toNextBattle(h, 1);
  h.state.players[0]!.bin.push('Hooba-Bot', 'Wisp', 'Fireball', 'Prismatic Observer', 'Good Whale');
  withE(h, e => { e.destroy(e.entity(bw)!, 'dies'); });
  return { h, buried: 'Hooba-Bot' };
}

/** answer the pending targets decision with the option naming `card` */
function aimAt(h: Harness, card: string): void {
  const dec = h.state.decision!;
  const i = dec.options.findIndex(o => o.card === card);
  assert.ok(i >= 0, `no option names ${card}`);
  h.do({ type: 'decide', seat: dec.seat, choice: i });
}

// ═══ §1 THE PREMISE ═══════════════════════════════════════════════════
//
// FIRST, and deliberately: everything below is about how a particular question
// is DRAWN, and a drawing assertion over the wrong question is a tripwire.

test('R280 §1 the premise: a pay-X-life cost really is one repeatable option and a stop', () => {
  const h = payXLife();
  const d = h.state.decision;
  assert.ok(d, 'playing Flesh Tithe raised no decision at all');
  assert.equal(d.kind, 'targets', 'the cost question is a targets decision, not a numeric one');
  assert.match(d.prompt, /pay X life/, 'this is the pay-X-life question the report is about');
  // the whole reason a ramp is needed: ONE option, offered again and again
  const pays = d.options.filter(o => !!o.value && typeof o.value === 'object' && 'payLife1' in o.value);
  assert.equal(pays.length, 1, 'the engine offers exactly one "pay one more" option');
  assert.match(pays[0]!.label, /Pay 1 more life/);
  assert.ok(optIdx(d, 'doneCost') >= 0, 'R64s "that is enough" is on the menu');
  // …and the point is charged AS IT IS ANSWERED, which is why an overshoot
  // cost the owner a whole play
  const life = h.state.players[0]!.life;
  h.do({ type: 'decide', seat: 0, choice: optIdx(d, 'payLife1') });
  assert.equal(h.state.players[0]!.life, life - 1, 'one answer really is one life, charged on the spot');
  assert.match(h.state.decision!.prompt, /X = 1 so far/, 'and the next question is a fresh one');
});

// ═══ §2 THE ARROWS AND THE BOX ════════════════════════════════════════

test('R280 §2 the pay-X-life bar carries R197s arrows and its typed box', () => {
  const h = payXLife();
  const html = ui.join(h.state, 0, []);
  assert.ok(html.includes('id="num-entry"'),
    'the pay-X-life bar has no typed number box — the report asked for "the ability to type a number"');
  for (const btn of ['numdown10', 'numdown', 'numup', 'numup10', 'numtake']) {
    assert.ok(ui.has({ btn }), `the pay-X-life bar has no ${btn} control`);
  }
  // SHARED, not rebuilt: `#num-entry` is the id snapshotViewport rescues the
  // caret of and rewireInputs binds Enter to, so a second box under a second
  // id would silently lose both.
  assert.equal((html.match(/id="num-entry"/g) ?? []).length, 1,
    'there are two numeric boxes on screen — the ramp built its own instead of sharing R197s');
});

test('R280 §2b the dial goes DOWN as well as up, and never below what is already paid', () => {
  const h = payXLife();
  ui.join(h.state, 0, []);
  // nothing paid: the floor IS the value, so down is dark
  assert.match(ui.html(), /data-btn="numdown"[^>]*disabled/,
    'at X = 0 there is nothing to dial down to');
  ui.click({ btn: 'numup' });
  ui.click({ btn: 'numup' });
  assert.ok(!/data-btn="numdown"[^>]*disabled/.test(ui.html()),
    'having dialled up, down must be live — the whole report is that going too far was unrecoverable');
  assert.ok(ui.html().includes('value="2"'), 'the dial reads 2 after two ups');
  // one point really paid: the floor MOVES, because a paid point cannot come back
  h.do({ type: 'decide', seat: 0, choice: optIdx(h.state.decision!, 'payLife1') });
  const html = ui.update(h.state, []);
  assert.ok(html.includes('min="1"'),
    'with X = 1 already paid the dial must floor at 1 — dialling below it would promise a refund');
});

// ═══ §3 THE COMMIT BUTTON ═════════════════════════════════════════════

test('R280 §3 that is enough is a full button, and the plain declines stay quiet', () => {
  const h = payXLife();
  const html = ui.join(h.state, 0, []);
  const done = optIdx(h.state.decision!, 'doneCost');
  assert.ok(done >= 0);
  assert.ok(html.includes(`<button class="commitbtn" data-btn="decide" data-i="${done}"`),
    'the "that is enough" option is still drawn as a dashed, transparent .declinebtn');

  // ⚠ THE CONTROL, and it is the expensive half. `partitionOptions` sorts all
  // four DECLINE_KEYS into one bucket, so the cheap fix is to make the bucket
  // loud — and playtest UZRG is what that costs: a player paid a ten-card
  // variable cost and then hit the decline sitting in the same screen position
  // they had just clicked ten times. Backing out must STAY secondary.
  const { h: hb } = binTargeted();
  const dec = hb.state.decision!;
  const stop = optIdx(dec, 'doneTargets');
  assert.ok(stop >= 0, 'the fixture really offers a "no more targets" decline');
  const bhtml = ui.join(hb.state, 0, []);
  assert.ok(bhtml.includes(`<button class="declinebtn" data-btn="decide" data-i="${stop}"`),
    '"No more targets" was promoted too — only doneCost commits; the rest back out');
});

// ═══ §4 ONE CLICK SPENDS THE DIALLED X, AND NO MORE ═══════════════════

test('R280 §4 one confirm walks the ramp to the dialled X and then stops', () => {
  const h = payXLife();
  ui.join(h.state, 0, []);
  ui.actions();                              // drop the join traffic
  for (let k = 0; k < 5; k++) ui.click({ btn: 'numup' });
  assert.ok(ui.html().includes('value="5"'), 'the dial is at 5 before the confirm');
  ui.click({ btn: 'numtake' });

  // the engine takes a variable cost ONE POINT AT A TIME, so the client owes
  // one answer per state — play the server and see what it really sends
  const wire: Action[] = [];
  const seen: string[] = [];
  for (let g = 0; g < 40; g++) {
    const acts = ui.actions();
    if (!acts.length) break;
    for (const a of acts) {
      wire.push(a);
      seen.push(h.state.decision ? JSON.stringify(h.state.decision.options[(a as { choice: number }).choice]?.value) : 'none');
      h.do(a);
    }
    ui.update(h.state, []);
    ui.tick();
  }
  assert.deepEqual(
    seen,
    ['{"payLife1":true}', '{"payLife1":true}', '{"payLife1":true}', '{"payLife1":true}', '{"payLife1":true}',
      '{"doneCost":true}'],
    'one confirm must be five payments and then the stop — nothing else',
  );
  assert.equal(wire.length, 6);
  assert.equal(h.state.players[0]!.life, 25, 'exactly the dialled 5 life was paid');
  assert.equal(h.state.decision, null, 'the cost question is closed');
  // and the ramp does not keep going once nobody is asking
  ui.update(h.state, []);
  assert.deepEqual(ui.actions(), [], 'the ramp kept sending after it was finished');
});

// ═══ §5 THE TARGETED BIN CARD, THE PREMISE ════════════════════════════

test('R280 §5 the premise: a stack item really aims at a card the bin strip hides', () => {
  const { h, buried } = binTargeted();
  assert.ok(h.state.decision, 'the Blightwalker trigger raised no target question');
  aimAt(h, buried);
  const bin = h.state.players[0]!.bin;
  const item = h.state.stack[0];
  assert.ok(item, 'the trigger is not on the stack');
  const targets = item.parts.flatMap(p => p.targets);
  const binTargets = targets.filter(t => 'bin' in t);
  assert.equal(binTargets.length, 1, 'exactly one bin target was declared');
  const i = new E(h.state).binIndexOf((binTargets[0] as { bin: { seat: 0; card: string } }).bin);
  assert.equal(bin[i], buried, 'the engine resolves the ref to the buried card');
  // the hiding, stated as a fact about the strip rather than assumed: the
  // panel draws the last three, and this card is not one of them
  assert.ok(bin.length > 3, `the fixture bin is only ${bin.length} deep — nothing would be hidden`);
  assert.ok(!bin.slice(-3).includes(buried),
    'the targeted card is among the last three, so the strip would have shown it anyway');
});

// ═══ §6 IT SURFACES ═══════════════════════════════════════════════════

test('R280 §6 a targeted bin card surfaces onto the region strip, on top', () => {
  const { h, buried } = binTargeted();
  // the CONTROL first: before anything aims at it, the buried card is not
  // drawn — so §6 is measuring the targeting and not the fixture
  const before = zone(ui.join(viewFor(h.state, 0), 0, []), 'bin:0');
  assert.ok(!before.includes(`data-prev="${buried}"`),
    'the buried card was on the strip before anything targeted it — this test proves nothing');
  assert.ok(!before.includes('data-bintgt'), 'nothing is marked as targeted yet');

  aimAt(h, buried);
  const after = zone(ui.join(viewFor(h.state, 0), 0, []), 'bin:0');
  assert.ok(after.includes(`data-prev="${buried}"`),
    'the targeted card is still not on the strip — the report is that nobody can see what is aimed at');
  assert.ok(/data-bintgt="1"[^>]*data-prev="Hooba-Bot"/.test(after),
    'the targeted card carries no marker saying WHY it is showing');
  // "surface to the top": the fan paints later siblings over earlier ones, so
  // the targeted card must be LAST
  const order = [...after.matchAll(/data-prev="([^"]+)"/g)].map(m => m[1]);
  assert.equal(order[order.length - 1], buried, 'the targeted card is not the topmost thumb');
  // …and the strip is still a three-slot fan: it displaces, it does not grow
  assert.equal(order.length, 3, `the strip grew to ${order.length} thumbs — style.css places three`);
  // hoverable, which is the affordance the report asked for by name
  assert.ok(after.includes(`data-prev="${buried}"`), 'the thumb carries the hover handle');
});

test('R280 §6b the dialog marks it too, so one fact reaches both surfaces', () => {
  const { h, buried } = binTargeted();
  aimAt(h, buried);
  ui.join(viewFor(h.state, 0), 0, []);
  const open = ui.click({ btn: 'binopen', p: 0 });
  assert.ok(open.includes('class="overlaybox binbox"'), 'the bin dialog did not open');
  const entry = /<div class="card[^"]*" data-act="bin" data-p="0" data-i="0"[^>]*>/.exec(open);
  assert.ok(entry, 'the dialog has no entry for bin index 0');
  assert.ok(entry[0].includes('data-bintgt="1"'),
    'the dialog does not mark the targeted entry — the panel and the dialog disagree');
  ui.click({ btn: 'binclose' });
});

// ═══ §7 BOTH SEATS ════════════════════════════════════════════════════

/* ⚠ THE BRIEFED PREMISE, MEASURED — and it is FALSE, which is why it is a test
 * of its own rather than a sentence in a comment. CT-169 and the round brief
 * both say "the opponent cannot open the bin dialog at all", and a fix argued
 * from that would have gone looking for a permission gate that does not exist.
 * This passes identically before and after the fix, deliberately: it is the
 * premise, in the same role as §1 and §5. What WAS wrong is one strip with
 * three slots, and it was wrong for both seats equally. */
test('R280 §7 the premise: either seat can already open the other seats bin, and the decision is what they cannot see', () => {
  const { h, buried } = binTargeted();
  aimAt(h, buried);
  ui.join(viewFor(h.state, 1), 1, []);
  assert.ok(ui.has({ btn: 'binopen', p: 0 }),
    'the opponent really cannot reach the other seats bin dialog — the CT-169 premise would be right');
  assert.equal(viewFor(h.state, 1).players[0]!.bin.length, 6, 'and viewFor redacts no bin');
  // …but the DECISION is theirs to not see, which is exactly why the surfacing
  // has to be derived from the public stack and never from `state.decision`
  assert.equal(viewFor(h.state, 1).decision, null);
});

test('R280 §7b the opponent sees the target too, which is the half the report is really about', () => {
  const { h, buried } = binTargeted();
  aimAt(h, buried);
  // seat 1 is NOT the controller of the trigger and not the owner of the bin.
  // Redacted through the real server view, because that is what they get.
  const strip = zone(ui.join(viewFor(h.state, 1), 1, []), 'bin:0');
  assert.ok(strip.includes(`data-prev="${buried}"`),
    'the opponent still cannot see what the trigger is aiming at');
  assert.ok(strip.includes('data-bintgt="1"'), 'and cannot see that it is the target');
});
