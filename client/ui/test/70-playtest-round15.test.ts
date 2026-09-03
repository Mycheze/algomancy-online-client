/* Playtest round 15 — client-side reports, plus guards for four fixes that
 * were shipped with nothing holding them down.
 *
 * The reports:
 *
 *  [59] "I turned on auto yield to a bunch of triggers and it's working, but
 *       visually I see a flash of the top of the screen that looks like it's
 *       giving me prio for like 1 frame AND I see a 'You do not have priority'
 *       note up at the top."
 *  [08b] "I was able to Prophecy Air Plant without having any Wood resources.
 *       I just wanted to click the card to see what would happen and it just
 *       immediately went to the Cache zone."
 *  [61] "Instead of all the spell tokens stacking up vertically when there are
 *       many of them, their box can expand and they can be grouped
 *       horizontally."
 *
 * And the backfills: [26] arrows run centre to centre, [30] right-click →
 * concede, [31] right-click → view erased cards, [35] the `.activatable`
 * halo's wiring.
 *
 * ui/main.ts is a boot script — it takes the document, the socket and the URL
 * on the way in. Everything with a judgement in it has been pulled out into
 * ui/inspect.ts and ui/anim.ts and is tested directly; the wiring between those
 * answers and the DOM is read as text at the bottom of this file (see the
 * comment there), EXCEPT [59] itself, which is now driven — test/ui-driver.ts
 * gives main.ts the browser it is asking for, so the report can be asserted as
 * what the player sees rather than as the order of three lines inside
 * renderNow. ui/style.css gets the text treatment too, for the two fixes that
 * are literally CSS arithmetic.
 *
 * Seeds 6000-6099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import {
  actionNeedsMenu, activatableUnits, autoPassPlan, boardMenuEntries, cardClasses,
  castableTokens, activationKeys, planOffer, takeAutoPass,
} from '../inspect.ts';
import type { AutoPassArm, BoardMenuEntry, SendLatch } from '../inspect.ts';

/* CT-124 made BoardMenuEntry a UNION: "view game log" is about the table and
 * carries no seat, so `seat` is no longer a property every entry has. A plain
 * `.filter(e => e.kind === 'concede')` does not narrow a union, so the two
 * concede tests below say so with a predicate rather than reaching for a field
 * TypeScript can no longer promise them. */
const isConcede = (e: BoardMenuEntry): e is Extract<BoardMenuEntry, { kind: 'concede' }> =>
  e.kind === 'concede';
import { arrowGeometry, HEAD_INSET } from '../anim.ts';
import { give, giveResources, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { client } from './ui-driver.ts';
import type { Action, EntityId, GameState, Seat } from '../../engine/src/types.ts';

/* ── [59] the automatic pass: one decision, made before the paint ──────── */

/** the real client, driven — see test/ui-driver.ts */
const ui = await client();

/** a battle-ish state with `stack` on it and priority to seat 0 */
function stacked(kinds: { kind: string; sourceId?: EntityId }[]): GameState {
  const h = new Harness(6000);
  toDeployment(h);
  const s = h.state;
  s.priority = 0;
  s.decision = null;
  s.stack = kinds.map((k, i) => ({
    id: 100 + i, kind: k.kind as 'triggered' | 'spell', label: `item ${i}`,
    controller: 0, region: 0, negated: false, parts: [],
    ...(k.sourceId !== undefined ? { sourceId: k.sourceId } : {}),
  }));
  return s;
}

const PASS: Action[] = [{ type: 'passPriority', seat: 0 }];
const arm = (over: Partial<AutoPassArm> = {}): AutoPassArm => ({
  armed: false, armedStack: 0, armedSig: [], prefOn: false, yieldIds: new Set(), ...over,
});

test('[59] the auto-pass toggle and an auto-yielded trigger produce ONE pass, not two', () => {
  // the exact configuration Bena was in: the C4 toggle on, AND a unit whose
  // triggers he had chosen to yield to sitting on top of the stack. The old
  // code asked two independent functions, each with its own one-shot stamp,
  // so both fired for the same server state. The server applied the first and
  // refused the second — "you do not have priority" — and that refusal stuck.
  const s = stacked([{ kind: 'triggered', sourceId: 7 }]);
  const plan = autoPassPlan(s, 0, PASS, arm({ prefOn: true, yieldIds: new Set([7]) }));

  // one plan, one reason, one send. (Which reason wins does not matter to the
  // player — both mean "pass" — only that the answer is singular.)
  assert.equal(plan.pass, 'pref');

  const latch: SendLatch = { autoAt: -1, sentFor: -1 };
  let sends = 0;
  // render() runs many times per server state: a hover, a beat waking the log,
  // the chip disarming and repainting itself. Every one of them re-asks.
  for (let paint = 0; paint < 5; paint++) {
    if (takeAutoPass(plan, s.actionCount, latch)) sends++;
  }
  assert.equal(sends, 1, 'one authoritative state, one intent on the wire');
});

test('[59] the latch releases only when the server state moves on', () => {
  const s = stacked([{ kind: 'triggered', sourceId: 7 }]);
  const plan = autoPassPlan(s, 0, PASS, arm({ yieldIds: new Set([7]) }));
  assert.equal(plan.pass, 'yield');

  const latch: SendLatch = { autoAt: -1, sentFor: -1 };
  assert.equal(takeAutoPass(plan, 40, latch), true);
  assert.equal(takeAutoPass(plan, 40, latch), false, 'still the same state');
  assert.equal(takeAutoPass(plan, 41, latch), true, 'a new state is a new window');
});

test('[59] an intent already on the wire blocks the automatic one too', () => {
  // the shared latch is the point: a manual click and an automatic pass are
  // both intents spending the same state, and only one of them may.
  const s = stacked([{ kind: 'triggered', sourceId: 7 }]);
  const plan = autoPassPlan(s, 0, PASS, arm({ yieldIds: new Set([7]) }));
  const latch: SendLatch = { autoAt: -1, sentFor: 40 };   // NetBackend.do() just fired
  assert.equal(takeAutoPass(plan, 40, latch), false);
  assert.equal(takeAutoPass(plan, 41, latch), true);
});

test('[59] no plan, no send — the window really is mine', () => {
  const quiet = stacked([{ kind: 'triggered', sourceId: 9 }]);   // not a yielded unit
  const plan = autoPassPlan(quiet, 0, PASS, arm({ yieldIds: new Set([7]) }));
  assert.equal(plan.pass, null, 'somebody else’s trigger is worth a look');
  const latch: SendLatch = { autoAt: -1, sentFor: -1 };
  assert.equal(takeAutoPass(plan, 40, latch), false);
  assert.equal(latch.autoAt, -1, 'and nothing is claimed');
});

test('[59] the C4 toggle passes only when passing is the ONLY thing I could do', () => {
  const s = stacked([]);
  const only = autoPassPlan(s, 0, PASS, arm({ prefOn: true }));
  assert.equal(only.pass, 'pref');

  const alsoCast: Action[] = [...PASS, { type: 'castSpellToken', seat: 0, entityId: 5 }];
  assert.equal(autoPassPlan(s, 0, alsoCast, arm({ prefOn: true })).pass, null,
    'something else to do is a window worth keeping');
  assert.equal(autoPassPlan(s, 0, [], arm({ prefOn: true })).pass, null,
    'nothing legal at all is not "pass is my only option"');
  assert.equal(autoPassPlan(s, 0, PASS, arm({ prefOn: false })).pass, null,
    'the toggle is off');
});

test('[59] a pending decision is never passed through, by any of the three', () => {
  const s = stacked([{ kind: 'triggered', sourceId: 7 }]);
  s.decision = { id: 1, seat: 0, kind: 'targets', prompt: 'pick', options: [] };
  const both = arm({ prefOn: true, armed: true, armedStack: 1, yieldIds: new Set([7]) });
  assert.equal(autoPassPlan(s, 0, PASS, both).pass, null);
});

/* The Pass-all release list used to be a branch of autoPassPlan, and this file
 * held the test for it ('[59] Pass-all still disarms on every one of its own
 * conditions'). Report #68 — "I hit pass all, but then it stopped passing all"
 * — was that branch's C5 clause, and the whole list moved to ui/battle.ts
 * `passAllRelease` in round 17. The branch stayed behind for a round, dead,
 * reachable only from that test; both are gone now. The four release reasons
 * are held against REAL battle positions instead, in
 * test/77-playtest-round17.test.ts:
 *   '[68] Pass-all stays armed through a window where a spell token is merely castable'
 *   '[68] Pass-all releases on the pass that would move to Regroup with tokens still castable'
 *   '[68] the other three releases still release: the battle ending, a new stack item, a new ability'
 * autoPassPlan answers for C4 and #2 only, which is what the tests above ask
 * of it. */

test('[59] activationKeys and castableTokens read a legal list, nothing else', () => {
  const legal: Action[] = [
    { type: 'passPriority', seat: 0 },
    { type: 'activateAbility', seat: 0, entityId: 3, abilityIndex: 1 },
    { type: 'activateAbility', seat: 0, entityId: 3, abilityIndex: 1, via: 'augment' },
    { type: 'castSpellToken', seat: 0, entityId: 5 },
    { type: 'castSpellToken', seat: 0, entityId: 5 },   // two ways to cast ONE token
    { type: 'castSpellToken', seat: 0, entityId: 6 },
  ];
  assert.deepEqual(activationKeys(legal), ['3:1:own', '3:1:aug'],
    'the same ability donated a different way is a different key');
  assert.equal(castableTokens(legal), 2, 'distinct tokens, not distinct actions');
});

/* ── [08b] prophesying never fires on the click that reveals it ────────── */

test('[08b] a hand card whose only option is prophesy opens a menu, it does not just fire', () => {
  // Air Plant: lg/[7] {Flying}, banner "[2] Prophecy". During deployment with
  // two mana and no host to augment, prophesying is the ONLY legal thing the
  // card can do — which is exactly when offer() used to fire it on the spot,
  // spending the mana and moving the card to the cache before Bena had seen a
  // single word about what he was agreeing to.
  const h = new Harness(6002);
  toDeployment(h);
  const seat = h.state.deployPlayer ?? 0;
  const i = give(h, seat, 'Air Plant');
  giveResources(h, seat, 'fire', 2);            // plain mana, and NOT wood — R42
  const legal = legalActions(h.state, seat);

  const proph = legal.filter(a => a.type === 'prophesy' && a.from === 'hand' && a.index === i);
  const plays = legal.filter(a => a.type === 'playCard' && a.handIndex === i);
  const mods = legal.filter(a => (a.type === 'augment' || a.type === 'graft')
    && a.from === 'hand' && a.index === i);
  assert.equal(proph.length, 1, 'the banner is payable with plain mana (R42 — this half is correct)');
  assert.equal(plays.length + mods.length, 0, 'and it is the only thing this card can do');

  // the list handleHandClick builds for that click, and what offer() does with it
  const items = proph.map(a => ({ label: 'Prophesy Air Plant…', confirm: actionNeedsMenu(a) }));
  assert.deepEqual(planOffer(items), { kind: 'menu' },
    'one irreversible option is still a menu — the second click is the confirmation');
});

test('[08b] offer still fires a lone harmless option, and still menus a choice', () => {
  assert.deepEqual(planOffer([{ }]), { kind: 'go', index: 0 },
    'one ordinary thing to do just happens — the interaction everyone is used to');
  assert.deepEqual(planOffer([{ }, { }]), { kind: 'menu' });
  assert.deepEqual(planOffer([]), { kind: 'none' }, 'a dead click is a dead click');
  assert.deepEqual(planOffer([{ confirm: true }, { }]), { kind: 'menu' });
});

test('[08b] prophesy is the action that needs the menu; playing a card is not', () => {
  assert.equal(actionNeedsMenu({ type: 'prophesy', seat: 0, from: 'hand', index: 0 }), true);
  assert.equal(actionNeedsMenu({ type: 'prophesy', seat: 0, from: 'bin', index: 0 }), true,
    'R42: the bin is a prophesy source too (Angel of Anguish)');
  assert.equal(actionNeedsMenu({ type: 'playCard', seat: 0, handIndex: 0 }), false,
    'a cast stops to ask for targets and can be cancelled — it is allowed to just go');
  assert.equal(actionNeedsMenu({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' }), false);
});

/* ── [26] the arrows run centre to centre ──────────────────────────────── */

const box = (left: number, top: number, width = 60, height = 84):
  { left: number; top: number; width: number; height: number } => ({ left, top, width, height });

test('[26] an arrow starts at one card’s centre and is aimed at the other’s', () => {
  // ZQPC: "can you make the arrows originate from and point to the middle of
  // the cards? Rather than from the side." The helper this replaced (`edge()`)
  // deliberately stopped at the borders, and a head resting on a border in a
  // tight column belongs to either of two cards.
  const a = box(100, 100), b = box(500, 300);
  const g = arrowGeometry(a, b)!;
  assert.ok(g, 'two boxes that far apart get an arrow');
  assert.deepEqual([g.x1, g.y1], [130, 142], 'the tail is the source box’s exact centre');
  assert.deepEqual([g.x2, g.y2], [530, 342], 'and the target is the destination box’s exact centre');
});

test('[26] only the arrowHEAD is inset, and only by HEAD_INSET', () => {
  const g = arrowGeometry(box(0, 0), box(400, 0))!;
  // the tip stops HEAD_INSET short of the destination centre, along the
  // curve's final tangent — so the triangle sits ON the art, not past it
  assert.equal(Math.round(Math.hypot(g.x2 - g.tx, g.y2 - g.ty)), HEAD_INSET);
  assert.ok(HEAD_INSET < 30, 'an inset that could reach a card border is the old bug again');
  assert.equal(Math.round(Math.hypot(g.ux, g.uy) * 1000) / 1000, 1, 'the tangent is normalised');
});

test('[26] two cards on top of each other get no arrow at all', () => {
  assert.equal(arrowGeometry(box(10, 10), box(12, 12)), null,
    'there is no direction to point in — better nothing than a smudge');
});

/* ── [30]/[31] what the board offers on a right-click ──────────────────── */

const boardState = (): GameState => { const h = new Harness(6003); toDeployment(h); return h.state; };

test('[31] the board menu offers BOTH erased piles, counted', () => {
  const s = boardState();
  s.players[0]!.erased = ['Fight'] as never;
  const entries = boardMenuEntries(s, 0);
  const erased = entries.filter(e => e.kind === 'erased');
  assert.equal(erased.length, 2, 'either pile is public — you may look at both');
  assert.match(erased[0]!.label, /My erased cards \(1\)/, 'mine is named "My", and carries the count');
  assert.match(erased[1]!.label, new RegExp(`${s.players[1]!.name}'s erased cards \\(0\\)`));
  assert.equal(erased.every(e => !e.confirm), true, 'looking at a pile asks nothing');
});

test('[30] the board menu offers concede — and only ever OPENS the question', () => {
  const s = boardState();
  const con = boardMenuEntries(s, 0).filter(isConcede);
  assert.equal(con.length, 1, 'net: my own seat, and nobody else’s');
  assert.equal(con[0]!.seat, 0);
  assert.match(con[0]!.label, /Concede/);
  assert.equal(con[0]!.confirm, true,
    'irreversible: the entry raises the confirmation, it never concedes');
});

test('[30] hotseat offers both seats; a finished game offers neither', () => {
  const s = boardState();
  const both = boardMenuEntries(s, null).filter(isConcede);
  assert.deepEqual(both.map(e => e.seat), [0, 1], 'one person is driving both sides');
  assert.match(both[0]!.label, new RegExp(`Concede as ${s.players[0]!.name}`));

  const over = { ...s, phase: 'gameover' } as GameState;
  assert.equal(boardMenuEntries(over, 0).some(e => e.kind === 'concede'), false,
    'nothing left to concede');
  assert.equal(boardMenuEntries(over, 0).filter(e => e.kind === 'erased').length, 2,
    '…but the piles are still worth reading afterwards');
});

/* ── [35] the .activatable halo ────────────────────────────────────────── */

test('[35] a unit with a legal activated ability is drawn with the .activatable class', () => {
  // UZRG: "units with activated abilities don't get a green highlight around
  // them indicating you can activate their abilities". activatableUnits() has
  // always been guarded; the class it feeds had nothing holding it down, so
  // deleting either end left the halo gone and every test still green.
  const h = new Harness(6004);
  toDeployment(h);
  const seat: Seat = 0;
  const id = spawn(h, seat, 'Omniwield Evoker');   // "[three]: put a +1/+1 counter on me"
  giveResources(h, seat, 'metal', 3);
  const act = activatableUnits(legalActions(h.state, seat));
  assert.ok(act.has(id), 'the engine says this unit can act');

  assert.ok(cardClasses({ activatable: act.has(id) }).includes('activatable'),
    'so the scan wears the class the halo is hung on');
  assert.equal(cardClasses({ activatable: false }).includes('activatable'), false);
  // …and it is its own fact, orthogonal to "can be dragged into a formation"
  assert.deepEqual(cardClasses({ playable: true, activatable: true }),
    ['card', 'playable', 'activatable']);
});

/* ── [61] the strips beside a region expand sideways ───────────────────── */

const CSS = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

/** the declarations of one rule, by exact selector */
function rule(sel: string): string {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = CSS.match(new RegExp(`^\\s*${esc}\\s*\\{([^}]*)\\}`, 'm'));
  assert.ok(m, `ui/style.css has no rule for \`${sel}\``);
  return m![1]!;
}
/** one declaration's value, or null when the rule does not set it */
function decl(sel: string, prop: string): string | null {
  const m = rule(sel).match(new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]*)`));
  return m ? m[1]!.trim() : null;
}
/** the LARGEST px length in a value (a clamp()'s ceiling, a lone number) */
function maxPx(v: string | null): number {
  const all = [...(v ?? '').matchAll(/(-?[\d.]+)px/g)].map(m => Number(m[1]));
  return all.length ? Math.max(...all) : NaN;
}
/** the horizontal padding of a 1-to-4 value shorthand */
function padX(v: string | null): number {
  const parts = (v ?? '').split(/\s+/).filter(Boolean).map(p => Number(p.replace('px', '')));
  return parts.length === 1 ? parts[0]! : parts[1]!;
}
/**
 * How many cards can stand side by side in a strip at its widest.
 *
 * This is the whole of report [61], and it was always arithmetic: `.zone`
 * already sets `flex-wrap: wrap`, so a strip groups horizontally the moment —
 * and only the moment — its content box is wide enough for two cards and the
 * gap between them. `.tokenstrip` was 118px with 6px of padding either side:
 * a 106px content box against 52 + 4 + 52 = 108. Two pixels short, and so a
 * vertical column by construction, growing the whole region panel taller.
 */
function fitsPerRow(strip: string, zone: string): number {
  const wide = maxPx(decl(strip, 'max-width') ?? decl(strip, 'width'));
  const content = wide - 2 * padX(decl(strip, 'padding'));
  const card = maxPx(decl(`${strip} .card`, 'width'));
  const gap = maxPx(decl(`${strip} ${zone}`, 'gap'));
  return Math.floor((content + gap) / (card + gap));
}

for (const [strip, zone] of [['.tokenstrip', '.tokenzone'], ['.invaders', '.invaderzone']]) {
  test(`[61] ${strip} can group its cards horizontally instead of stacking them`, () => {
    assert.ok(fitsPerRow(strip!, zone!) >= 3,
      `${strip} is too narrow to ever put three cards on one row — flex-wrap has nothing to do`);
    assert.equal(decl(strip!, 'width'), 'auto',
      `${strip} must not pin a hard width — that is what stopped it expanding`);
    assert.ok(decl(strip!, 'max-width'), `${strip} needs a ceiling, or it takes the formation's space`);
    assert.ok(decl(strip!, 'min-width'), `${strip} needs a floor, or one token collapses it`);
  });
}

test('[61] the floor still fits two cards abreast', () => {
  // the shrink case: under pressure the strip falls back to min-width, and the
  // 118px it used to sit at was two pixels short of a pair
  const floor = maxPx(decl('.tokenstrip', 'min-width')) - 2 * padX(decl('.tokenstrip', 'padding'));
  const card = maxPx(decl('.tokenstrip .card', 'width'));
  const gap = maxPx(decl('.tokenstrip .tokenzone', 'gap'));
  assert.ok(floor >= card * 2 + gap, `${floor}px of content will not hold two ${card}px cards`);
});

test('[61] .zone still wraps — the strips are relying on it', () => {
  assert.match(rule('.zone'), /flex-wrap:\s*wrap/);
});

test('[35] the halo itself is still in the stylesheet', () => {
  // the other end of the wire: `.activatable` is emitted for nothing else, so
  // deleting this rule removes the feature and breaks not one other test
  assert.match(rule('.card.activatable'), /box-shadow:/);
});

/* ── the wiring in ui/main.ts ───────────────────────────────────────────
 *
 * main.ts takes the document, the socket and the URL at import time, so it
 * cannot be loaded here and its DOM plumbing cannot be exercised. Everything
 * above is the real logic, extracted; what follows checks the four short
 * connections between that logic and the page — the lines whose deletion
 * would otherwise break the feature and no test at all. They are deliberately
 * few, and each names one exact edge. */

const MAIN = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
/** the body of a top-level `function name(...)` in main.ts */
function fn(name: string): string {
  const at = MAIN.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `ui/main.ts has no function ${name}`);
  const end = MAIN.indexOf('\n}\n', at);
  return MAIN.slice(at, end === -1 ? MAIN.length : end);
}

/* [59] "I see a flash of the top of the screen that looks like it's giving me
 * prio for like 1 frame AND I see a 'You do not have priority' note."
 *
 * This used to be asserted as SOURCE ORDER inside renderNow — three
 * `indexOf`s and two `<` comparisons. Source order is not execution order:
 * wrapping `planAutoPass()` in `if (false)` keeps every one of those
 * comparisons true, and hoisting the decision into a helper makes them
 * falsely red. Neither of those is what the report is about.
 *
 * What the report is about is what the player SEES, so that is what these
 * assert now, by driving the real client (test/ui-driver.ts): on a window
 * that is going to be given away automatically, the board must never paint
 * the claim that the window is yours — and the pass must actually go out. */

/** a real priority window, with the seat that holds it */
function priorityWindow(seed: number): { h: Harness; seat: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (let guard = 0; guard < 40 && h.state.priority === null; guard++) {
    const dec = h.state.decision;
    if (dec) h.do({ type: 'decide', seat: dec.seat, choice: 0 });
    else break;
  }
  assert.notEqual(h.state.priority, null, 'the fixture really opened a priority window');
  return { h, seat: h.state.priority! };
}

test('[59] a window that is being auto-passed is never painted as yours to spend', () => {
  const { h, seat } = priorityWindow(6010);
  const passOnly: Action[] = [{ type: 'passPriority', seat }];

  // …with the preference OFF, this is an ordinary window: the board offers
  // the button and sends nothing on its own.
  ui.join(h.state, seat, passOnly);
  const manual = ui.html();
  assert.ok(ui.has({ btn: 'pass' }), 'the control case: a live window offers a Pass button');
  assert.deepEqual(ui.actions(), [], 'and nothing has been sent for it');
  assert.doesNotMatch(manual, /Auto-passing…/);

  // …and with it ON, the very same window paints as already given away.
  ui.click({ btn: 'autopasstoggle' });
  ui.sent();
  const auto = ui.join(h.state, seat, passOnly);
  assert.match(auto, /Auto-passing…/,
    'the bar has to say the window is being spent for you');
  assert.ok(!ui.has({ btn: 'pass' }),
    'the board painted "you have priority — Pass" over a window a pass was already scheduled for. '
    + 'That is the flash in the report, and clicking that button is the second pass that came '
    + 'back "you do not have priority".');
});

test('[59] …and the pass it painted really does go out, exactly once per state', () => {
  const { h, seat } = priorityWindow(6011);
  const passOnly: Action[] = [{ type: 'passPriority', seat }];
  ui.join(h.state, seat, passOnly);
  if (!/Auto-passing…/.test(ui.html())) ui.click({ btn: 'autopasstoggle' });
  ui.join(h.state, seat, passOnly);
  ui.sent();
  assert.match(ui.html(), /Auto-passing…/, 'the fixture really armed the automatic pass');

  // the send is held until the story on screen has finished telling itself —
  // sendAutoPass books it rather than firing it, so this is where it goes out
  ui.tick();
  assert.deepEqual(ui.actions(), [{ type: 'passPriority', seat }],
    'painting the window is not enough — the intent has to reach the wire, or the board sits '
    + 'saying "Auto-passing…" for ever');

  // the board is repainted many times per authoritative state (a hover, a
  // beat waking the log, the chip disarming). One state, one pass.
  ui.click({ btn: 'soundtoggle' });
  ui.click({ btn: 'motiontoggle' });
  ui.tick();
  assert.deepEqual(ui.actions().filter(a => a.type === 'passPriority'), [],
    'a repaint of the SAME state sent a second pass — the one the server refuses');
});

/* R170: this used to be three `indexOf`s into the SOURCE of `promptHtml` —
 * "is the autoPassing guard above the Pass button, is the sentFor guard above
 * it". Which is the very thing the block above this file's driver tests
 * complains about, one layer along: it asserts WHERE code sits. It went red
 * the moment `promptHtml` was split in two (R170/CT-46 — a hotseat decision
 * bar now has the phase bar UNDER it, so the phase bar had to become a
 * function of its own), while the property it was about held perfectly. The
 * second time this repo has paid that bill.
 *
 * So it asks the board instead. Both halves are the same claim — a window
 * that has already been given away must not be painted as yours to spend —
 * and the second half had no behavioural coverage at all before this. */
test('[59] the prompt bar checks the plan before it offers a Pass button', () => {
  const { h, seat } = priorityWindow(6012);
  const passOnly: Action[] = [{ type: 'passPriority', seat }];

  // the control: a live window really does offer the button. (The auto-pass
  // preference lives in localStorage, which outlives a test — an earlier one
  // in this file turns it on, so put it back before asking about the manual
  // button at all.)
  ui.join(h.state, seat, passOnly);
  if (/Auto-passing…/.test(ui.html())) ui.click({ btn: 'autopasstoggle' });
  ui.join(h.state, seat, passOnly);
  ui.sent();
  assert.ok(ui.has({ btn: 'pass' }), 'the control case: a live window offers a Pass button');

  // …and the moment it is spent BY HAND, the same bar stops claiming it. The
  // manual handler's trailing render() repaints this bar over a state whose
  // priority has already gone to the socket; without the latch the button it
  // draws sends the second pass that comes back "you do not have priority".
  const after = ui.click({ btn: 'pass' });
  assert.deepEqual(ui.actions(), [{ type: 'passPriority', seat }], 'the pass went out');
  assert.match(after, /Sent — waiting for the server…/,
    'the bar has to say the window is already spent');
  assert.ok(!ui.has({ btn: 'pass' }),
    'and must not offer a second Pass for the same window');

  // the other half of the same claim, on the AUTOMATIC pass
  ui.join(h.state, seat, passOnly);
  if (!/Auto-passing…/.test(ui.html())) ui.click({ btn: 'autopasstoggle' });
  ui.join(h.state, seat, passOnly);
  ui.sent();
  assert.match(ui.html(), /Auto-passing…/, 'the fixture really armed the automatic pass');
  assert.ok(!ui.has({ btn: 'pass' }),
    'a window a pass is already scheduled for is not offered a Pass button either');
});

/** the body of a CLASS METHOD (fn() only finds free functions) */
function method(name: string): string {
  // anchored at a two-space indent so `this.applyUpdate(` at a CALL SITE cannot
  // be mistaken for the declaration — it appears ~140 lines earlier than one
  const at = MAIN.search(new RegExp(`\\n  (private )?${name}\\(`));
  assert.notEqual(at, -1, `ui/main.ts has no method ${name}`);
  const end = MAIN.indexOf('\n  }\n', at);
  return MAIN.slice(at, end === -1 ? MAIN.length : end);
}

test('[59] a fresh authoritative state clears the error from the previous one', () => {
  // uiError was cleared in act() and nowhere on the way IN, and the auto-pass
  // paths never go through act() — so a refusal one of them earned stayed on
  // screen for the rest of the game.
  //
  // ⚠ REWRITTEN 2026-08-25. This used to slice MAIN between "m.t === 'update'"
  // and "m.t === 'kicked'" and look for the assignment inside that window. R150
  // put every inbound update through a pacing queue and moved the clear into
  // applyUpdate — the ONE funnel the queue drains into — so the invariant was
  // intact and the test failed anyway. It was asserting WHERE the line sat.
  // It now asserts the shape that actually protects #59: updates funnel, the
  // funnel clears, and no release path skips the funnel. That is three claims
  // instead of one, and none of them cares about layout.
  const handler = MAIN.slice(MAIN.indexOf("m.t === 'update'"), MAIN.indexOf("m.t === 'kicked'"));
  assert.match(handler, /this\.paced = pace\(/,
    "the 'update' handler must hand the message to the pacing queue (R150), not apply it inline");
  assert.match(method('applyUpdate'), /uiError = '';/,
    'applyUpdate is the one funnel every update reaches — it must clear uiError');
  for (const release of ['pumpPace', 'flushPace']) {
    assert.match(method(release), /this\.applyUpdate\(/,
      `${release} must release through applyUpdate, or an update reaches the screen `
      + 'without clearing the previous state\'s error — which is #59 exactly');
  }
});

test('[59] every intent latches the state it spends, and a refusal releases it', () => {
  // bounded to do()'s own body — undo() latches a few lines below it
  const doBody = MAIN.slice(MAIN.indexOf('do(a: Action): void {'), MAIN.indexOf("t: 'action'"));
  assert.match(doBody, /this\.latch\(\);/, 'NetBackend.do() takes the latch');
  // \s* rather than a literal space: this asserted single-LINE formatting until
  // R150 wrapped the method, and a reformat is not a regression (2026-08-25).
  assert.match(MAIN, /undo\(\): void \{\s*this\.latch\(\);/, '…and so does undo()');
  assert.match(MAIN, /ui\.sentFor = -1; ui\.autoAt = -1;/,
    'a refused action leaves actionCount alone — the latch must be let go by hand');
  assert.match(fn('act'), /if \(ui\.sentFor === h\.state\.actionCount\) return;/,
    'act() must not spend a state that is already on the wire');
  assert.match(fn('sendAutoPass'), /if \(ui\.sentFor === at\) return;/,
    'the pass is scheduled, so it must re-check the latch at fire time too — a click '
    + 'during the wait spends the state without moving actionCount');
});

test('[08b] the click path routes prophesy through planOffer with the flag set', () => {
  assert.match(fn('offer'), /planOffer\(items\)/, 'offer() must ask, not count');
  const proph = [...MAIN.matchAll(/prophesyLabel\(name\)/g)];
  assert.equal(proph.length, 2, 'the hand and the bin both offer prophesy');
  for (const m of proph) {
    assert.match(MAIN.slice(m.index!, m.index! + 200), /confirm: actionNeedsMenu\(/,
      'both entries must carry the flag that stops a lone one firing');
  }
});

test('[30]/[31] the board menu hangs the two behaviours on boardMenuEntries', () => {
  const body = fn('boardMenuItems');
  assert.match(body, /boardMenuEntries\(h\.state, NET \? NET\.seat : null\)/);
  assert.match(body, /erasedView = entry\.seat/, '[31] the erased entry opens the pile dialog');
  assert.match(body, /concedeAsk = entry\.seat/, '[30] the concede entry opens the CONFIRMATION');
  assert.equal(/act\(\s*\{\s*type: 'concede'/.test(body), false,
    'the menu item must never concede on its own');
  assert.match(MAIN, /^  concedeyes: \(\) =>/m, 'only the confirmed button concedes');
});

test('[35] unitHtml passes its activatable fact into the class list', () => {
  assert.match(fn('unitHtml'), /activatable: canAct/, 'the scan is told');
  assert.match(fn('cardHtml'), /cardClasses\(opts\)/, 'and the class list is the tested one');
});
