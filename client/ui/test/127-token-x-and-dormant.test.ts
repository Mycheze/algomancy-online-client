/**
 * R151 — two presentation defects from owner playtest reports #99 and #97.
 *
 * CT-33 (#99): *"Tokens should have their X value in their text box modified to
 * say the actual number, rather than X. So a Poison 5 would say 'Put 5 -1/-1
 * counters on target unit'."*
 *
 * CT-31 (#97): *"Dormant resources can misleadingly look like they're active.
 * Maybe have them not show up (or something) during battle/deployment so
 * players don't think they're active. During planning they should show
 * normally tho."*
 *
 * NOT the R134/R141/R142 markup class. Those were each a formatter failing to
 * consume a printed token and emitting it verbatim; here `X` is genuinely the
 * word on the card and what was missing is a live per-instance value. The
 * sweep below is the R141 guard: a fix that reached Poison and not Fireball,
 * or the spell tokens and not Robot, would look green without it.
 *
 * Seeds 5900-5999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { allCardNames, getCard } from '../../engine/src/cards/dsl.ts';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { entityTextBox, liveX, printedTextBox, substituteX } from '../cardtext.ts';
import { emphasisOf, resourceRow } from '../resources.ts';
import type { Entity, Seat } from '../../engine/src/types.ts';
import { ent, giveResources, skipHasteStep, spawn, toDeployment } from '../../engine/test/util.ts';

const q = (h: Harness): E => new E(h.state);
/** the whole text box as one string, the way a player reads it */
const boxText = (e: E, u: Entity): string => entityTextBox(e, u).lines.map(l => l.text).join(' ');
/** an X used as a VALUE — the spelling R151 substitutes (not X/X, not [x]) */
const BARE_X = /(?<![\w+\-/[{])X(?![\w/\]}])/;
/** printed reminder text: it NAMES the variable, so its X legitimately stays */
const stripReminders = (s: string): string => s.replace(/\{i\}[\s\S]*?(?:\{\/i\}|$)/g, '');

/* ── CT-33 · the headline case ──────────────────────────────────────── */

test('R151/CT-33: a Poison created with X=5 says "Put 5 -1/-1 counters", from the engine', () => {
  const h = new Harness(5901);
  const e = q(h);
  const A = 0 as Seat;
  // driven through the engine's own token API, not a hand-built entity
  const tok = e.createSpellToken(A, 'Poison', 5, e.homeRegion(A));
  assert.equal(tok.x, 5, 'the engine stamped the X on the instance');
  const box = entityTextBox(e, ent(h, tok.id)!);
  assert.equal(box.lines[0]!.text, 'Put 5 -1/-1 counters on target unit.');
  assert.ok(!BARE_X.test(box.lines[0]!.text), 'no literal X survives');
  // the -1/-1 stat notation is untouched by the substitution
  assert.ok(box.lines[0]!.text.includes('-1/-1'), 'the counters are still -1/-1');
  // and the printed card, off the table, is still the printed card
  assert.equal(printedTextBox('Poison').lines[0]!.text, 'Put X -1/-1 counters on target unit.');
});

test('R151/CT-33: a token minted by a CARD specialises too (Ignis Sprite → Fireball 1)', () => {
  const h = new Harness(5902);
  const A = 0 as Seat;
  // "When I spawn or die, [Switch] Create a Fireball 1."
  spawn(h, A, 'Ignis Sprite');
  const e = q(h);
  const fb = Object.values(h.state.entities).find(u => u.card === 'Fireball');
  assert.ok(fb, 'the spawn trigger really made one');
  assert.equal(boxText(e, fb!), 'Deal 1 damage to any target.');
});

test('R151/CT-33: a Robot reads its X off its COUNTERS, so it stays true as they change', () => {
  const h = new Harness(5903);
  const e = q(h);
  const A = 0 as Seat;
  const r = e.spawnUnit(A, 'Robot', e.homeRegion(A), { token: true, counters: 3 });
  assert.equal(liveX(r), 3);
  assert.ok(boxText(e, r).startsWith('I spawn with 3 +1/+1 counters on me.'),
    boxText(e, r));
  // "(If the number of counters changes, so does the X value.)" — it does
  e.addCounters(r, 2);
  assert.ok(boxText(e, r).startsWith('I spawn with 5 +1/+1 counters on me.'),
    'a stamped-at-creation X would still be saying 3 here');
  // the reminder keeps its X: that sentence is ABOUT the variable
  assert.ok(boxText(e, r).includes('so does the X value'),
    '"so does the 3 value" would be a broken sentence, not a specialised one');
});

/* ── CT-33 · the whole-pool sweep (the R141 guard) ──────────────────── */

test('R151/CT-33 sweep: EVERY token card with an X placeholder renders a number', () => {
  const tokenCards = allCardNames().filter(n => /token/i.test(getCard(n).type ?? ''));
  assert.ok(tokenCards.length >= 6, `the pool's token cards were found: ${tokenCards.length}`);
  const withX = tokenCards.filter(n => BARE_X.test(stripReminders(getCard(n).text ?? '')));
  // Fireball, Robot, Poison, Crystal — Wisp and Wraith print no X
  assert.deepEqual(withX.sort(), ['Crystal', 'Fireball', 'Poison', 'Robot'],
    'the census this fix was written against still holds');

  let checked = 0;
  for (const name of withX) {
    const h = new Harness(5910 + checked);
    const e = q(h);
    const A = 0 as Seat;
    const def = getCard(name);
    const u = def.kind === 'unit'
      ? e.spawnUnit(A, name, e.homeRegion(A), { token: true, counters: 7 })
      : e.createSpellToken(A, name, 7, e.homeRegion(A));
    const txt = boxText(e, u);
    assert.ok(!BARE_X.test(stripReminders(txt)),
      `${name} still prints a literal X: ${txt}`);
    assert.ok(txt.includes('7'), `${name} prints the instance's number: ${txt}`);
    checked++;
  }
  assert.equal(checked, 4, 'all four were actually exercised');
});

/* ── CT-33 · negative controls ──────────────────────────────────────── */

test('R151/CT-33: X/X, +X/+X and -X/-X are STAT notation and never substituted', () => {
  // the three spellings the pool really uses for a stat pair
  assert.equal(substituteX('Create an X/X unit, where X is the mod\'s cost.', 4),
    'Create an X/X unit, where 4 is the mod\'s cost.');
  assert.equal(substituteX('I gain -X/-X, where X is your life total.', 6),
    'I gain -X/-X, where 6 is your life total.');
  assert.equal(substituteX('Target unit gains +X/+X until regroup.', 2),
    'Target unit gains +X/+X until regroup.');
  // a bracketed cost pip is variable MANA, not the token's X, and iconizeText
  // draws it — substituting there would silently pick a different cost icon
  assert.equal(substituteX('The controller may pay [x]. X can\'t be zero.', 3),
    'The controller may pay [x]. 3 can\'t be zero.');
  // and the pool's one piece of arithmetic on the value
  assert.equal(substituteX('create a Fireball X+1', 2), 'create a Fireball 2+1');
});

test('R151/CT-33: a live NON-token card keeps its printed X (nothing has a value)', () => {
  const h = new Harness(5904);
  const A = 0 as Seat;
  // "…create an X/X unit, where X is the damage I am dealt."
  const id = spawn(h, A, 'Awoken Tomb');
  const u = ent(h, id)!;
  assert.equal(liveX(u), undefined, 'a non-token unit has no X to show');
  const txt = boxText(q(h), u);
  assert.ok(txt.includes('X/X'), `stat notation intact: ${txt}`);
  assert.ok(txt.includes('where X is the damage'), `template intact: ${txt}`);
});

test('R151/CT-33: a token whose text has no X renders exactly the printed card', () => {
  const h = new Harness(5905);
  const e = q(h);
  const A = 0 as Seat;
  const w = e.spawnUnit(A, 'Wisp', e.homeRegion(A), { token: true });
  assert.equal(boxText(e, w), printedTextBox('Wisp').lines[0]!.text);
  assert.equal(boxText(e, w), 'After combat, sacrifice me.');
});

/* ── CT-31 · the dormant-resource row ───────────────────────────────── */

test('R151/CT-31: dormant resources are muted in battle and deployment, normal in planning', () => {
  const h = new Harness(5906);
  const A = 0 as Seat;
  // every game opens with two DORMANT prismites (apply.ts), so the row this
  // report is about is the one every player sees on turn 1
  assert.deepEqual(h.state.players[A]!.resources.map(r => r.state), ['dormant', 'dormant']);
  giveResources(h, A, 'fire', 2, 'open');
  giveResources(h, A, 'water', 2, 'dormant');
  const shape = ['dormant', 'dormant', 'open', 'open', 'dormant', 'dormant'];
  assert.deepEqual(h.state.players[A]!.resources.map(r => r.state), shape);

  assert.equal(h.state.phase, 'planning');
  const plan = resourceRow(q(h), A);
  assert.deepEqual(plan.resources.map(r => r.emphasis),
    ['normal', 'normal', 'normal', 'normal', 'normal', 'normal'],
    'planning is the phase you ACT on them in — the row shows normally');

  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  assert.equal(h.state.phase, 'battle');
  const battle = resourceRow(q(h), A);
  assert.deepEqual(battle.resources.map(r => r.emphasis),
    ['muted', 'muted', 'normal', 'normal', 'muted', 'muted'],
    'in battle the four dormant ones stop reading as mana');
  assert.ok(battle.resources[0]!.title.includes('makes no mana'),
    `and say why: ${battle.resources[0]!.title}`);
  assert.equal(battle.resources[2]!.title, 'fire (open)', 'a spendable one is unchanged');

  const h2 = new Harness(5907);
  giveResources(h2, A, 'fire', 2, 'open');
  giveResources(h2, A, 'water', 2, 'dormant');
  toDeployment(h2);
  assert.equal(h2.state.phase, 'deploy');
  assert.deepEqual(resourceRow(q(h2), A).resources.map(r => r.emphasis),
    ['muted', 'muted', 'normal', 'normal', 'muted', 'muted'], 'deployment mutes them too');
});

test('R151/CT-31: only DORMANT is muted — an expended resource is not', () => {
  assert.equal(emphasisOf({ state: 'dormant' }, 'battle'), 'muted');
  assert.equal(emphasisOf({ state: 'dormant' }, 'deploy'), 'muted');
  assert.equal(emphasisOf({ state: 'dormant' }, 'planning'), 'normal');
  assert.equal(emphasisOf({ state: 'dormant' }, 'regroup'), 'normal');
  // spending one is something the player did and remembers; it is drawn
  // turned sideways already and is not what report #97 is about
  assert.equal(emphasisOf({ state: 'expended' }, 'battle'), 'normal');
  assert.equal(emphasisOf({ state: 'open' }, 'battle'), 'normal');
});

test('R151/CT-31: the spendable/dormant split is the ENGINE\'s answer, not the UI\'s', () => {
  const h = new Harness(5908);
  const A = 0 as Seat;
  h.state.players[A]!.resources.length = 0;      // drop the starting prismites
  giveResources(h, A, 'fire', 3, 'open');        // 0,1,2
  giveResources(h, A, 'fire', 2, 'dormant');     // 3,4
  giveResources(h, A, 'water', 1, 'expended');   // 5
  const e = q(h);
  const row = resourceRow(e, A);

  // the count the row prints IS E.openMana
  assert.equal(row.mana, e.openMana(A));
  assert.equal(row.resources.filter(r => r.spendable).length, e.openMana(A));
  assert.equal(row.mana, 3, 'the two dormant ones and the expended one are not mana');
  // and the awake/dormant split IS E.affinity ("dormant gives no affinity";
  // "expended still counts")
  assert.equal(row.resources.filter(r => r.kind === 'fire' && r.active).length,
    e.affinity(A, 'fire'));
  assert.equal(row.resources.filter(r => r.kind === 'water' && r.active).length,
    e.affinity(A, 'water'));
  assert.equal(e.affinity(A, 'fire'), 3, 'the two dormant fires grant nothing');
  assert.equal(e.affinity(A, 'water'), 1, 'the expended water still does');
  assert.equal(row.agreesWithEngine, true,
    'a rules change that moved "spendable" would flip this before it reached the table');

  // wake one and BOTH answers move together, in the same direction
  h.state.players[A]!.resources[3]!.state = 'open';
  const woken = resourceRow(q(h), A);
  assert.equal(woken.mana, 4);
  assert.equal(woken.resources.filter(r => r.spendable).length, 4);
  assert.equal(q(h).affinity(A, 'fire'), 4);
  assert.equal(woken.agreesWithEngine, true);
});
