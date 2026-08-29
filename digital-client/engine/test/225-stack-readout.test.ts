/* WHAT A STACK ITEM AND A UNIT ARE ALLOWED TO KEEP TO THEMSELVES.
 *
 * Three playtest reports from room DSVQ/YFUE, all from games that replay
 * FAITHFUL at HEAD — so nothing here is an engine bug. In every one of them
 * the engine knows something the board refuses to say.
 *
 *  [131] "Retribution Thing didn't show its X value (not in Rashi's hand nor
 *        on the stack). All cards with an X in them need to show their X value
 *        when on the stack."
 *  [118] "It'd be nice to have some kind of indicator when a unit is
 *        'allured', like a badge."
 *  [127] "there needs to be an 'auto stack triggers' button that you can press
 *        when it doesn't matter what order they go on the stack in. There
 *        should also be a more visual stack chooser rather than the extended
 *        buttons. Clicking cards (MTGO style) would be better UX."
 *
 * ── #131 IS NOT THE X WORK THAT ALREADY SHIPPED, AND THAT IS THE WHOLE POINT
 *
 * It looks identical to UZRG/#43/#45 ("not possible to see the X value for an
 * effect while it's on the stack"), which `ui/inspect.ts stackItemX` answers.
 * It is a different family. `stackItemX` reports the X an item COMMITTED — a
 * paid cast X, a variable additional cost, the `n` off the event that fired a
 * trigger. All three are a number somebody chose, riding on the item.
 * Retribution Thing chooses no X at all: it is read off the battle ledger at
 * resolution, so the item has never held it and `stackItemX` correctly returns
 * nothing. The card DOES have the number — `xPreviewRows`, the hook #85 added
 * for the hand chip — and the fix is to ask it, not to build a second one.
 *
 * §1 therefore does two things a screenshot could not: it BINDS the forecast
 * to the resolution (the number shown is the damage dealt), and it takes the
 * card list from the POOL rather than from a list somebody typed — every card
 * carrying a preview hook, and separately every card whose printed text
 * contains an X.
 *
 * ── THE HOUSE RULE ABOUT TESTING ui/main.ts
 *
 * Not one assertion here reads main.ts as source text. `test/ui-driver.ts`
 * runs the real client over the real handlers and this file reads the markup
 * it really produced — the discipline 223 §2 states and the reason two tests
 * broke on a pure refactor in round 30.
 *
 * Seeds 22500-22599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { apply, legalActions, IllegalAction } from '../src/apply.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import { give, giveResources, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { Action, GameState, Seat, StackItem } from '../src/types.ts';

/** A attacks with a 7/5, D declines to block and loses 7, A then passes so the
 * BLED player holds priority in the after-combat window with a real 7 in the
 * `lifeLost` ledger. The cheapest state in which a derived X is not zero. */
function bledDefenderHasPriority(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, 23, 'the ledger holds a real 7');
  pass(h);                                   // A gives the window to D
  assert.equal(h.state.priority, D);
  return { h, A, D };
}

/** answer every open decision by taking the first option, so a cast that asks
 * for a target and a mode lands on the stack */
function settleDecisions(h: Harness, max = 8): void {
  for (let i = 0; i < max && h.state.decision; i++) {
    h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  }
}

/** what seat `seat` would really be looking at */
const screen = async (s: GameState, seat: Seat): Promise<string> => {
  const ui = await client();
  return ui.join(viewFor(s, seat), seat, legalActions(s, seat));
};

/* ══ §1 — [131] the X a stack item is going to READ ═══════════════════════ */

test('§1a Retribution Thing wears its X on the stack, and it is the number it will deal', async () => {
  const { h, D } = bledDefenderHasPriority(22501);
  giveResources(h, D, 'light', 3);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Retribution Thing') });
  settleDecisions(h);
  const item = h.state.stack.find(i => i.card === 'Retribution Thing');
  assert.ok(item, 'it really is on the stack');
  assert.equal(item!.x, undefined,
    'and it committed NO x — which is exactly why stackItemX had nothing to say');

  const html = await screen(h.state, D);
  assert.match(html, /X=7/,
    'the strip has to name the number — before this the card wore no mark at all');

  // BOUND TO THE TRUTH: resolve it and check the forecast was the damage
  const target = item!.parts.flatMap(p => p.targets).find(t => 'unit' in t)!;
  const before = h.state.entities[(target as { unit: number }).unit]!;
  const hpBefore = before.damage ?? 0;
  pass(h); pass(h);
  const after = h.state.entities[before.id];
  const dealt = after ? (after.damage ?? 0) - hpBefore : 7;
  assert.equal(dealt, 7, 'the 7 the board promised is the 7 the card dealt');
});

test('§1b the declared mode narrows the forecast to the half that was chosen', async () => {
  // R57 fixes the bracket at cast, so on the stack "lost 7 / gained 0" is no
  // longer a choice — one of them is what this item will do, and showing both
  // would be showing a number nobody can now cast for.
  const { h, D } = bledDefenderHasPriority(22502);
  giveResources(h, D, 'light', 3);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Retribution Thing') });
  settleDecisions(h);
  const item = h.state.stack.find(i => i.card === 'Retribution Thing')!;
  assert.equal(item.parts[0]!.mode, 'lost', 'the fixture picked the LOST bracket');
  const html = await screen(h.state, D);
  assert.match(html, /X=7/);
  assert.equal(/X=7\/0|X=0\/7/.test(html), false,
    'the bracket it did NOT declare is not a number this item can produce');
});

test('§1c a paid X still wins — the forecast never doubles it', async () => {
  // `stackItemX` answers first for anything that committed a number, and the
  // forecast declines whenever it does: two answers to one question, one of
  // them already true, is worse than the silence this replaced.
  const { h, D } = bledDefenderHasPriority(22503);
  giveResources(h, D, 'light', 3);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Retribution Thing') });
  settleDecisions(h);
  const s = structuredClone(h.state);
  s.stack.find(i => i.card === 'Retribution Thing')!.x = 3;   // as if it had been paid for
  const html = await screen(s, D);
  assert.match(html, /X=3/, 'the paid number is the one shown');
  assert.equal(/X=7/.test(html), false, 'and the forecast stands down beside it');
});

test('§1d CENSUS — every card that can forecast an X forecasts it ON THE STACK too', async () => {
  /* The list is the POOL, not a list typed here: every card carrying #5's
   * `xPreview` or #85's `xPreviewRows`. The hand chip has read these since
   * #85; the stack read none of them, which is the report. A card that grows
   * a hook tomorrow is covered tonight. */
  const hooked = allCardNames().filter(n => {
    const c = getCard(n) as unknown as Record<string, unknown>;
    return c['xPreview'] !== undefined || c['xPreviewRows'] !== undefined;
  });
  assert.ok(hooked.length >= 8, `the pool really has previewable cards (${hooked.length})`);

  const { h, D } = bledDefenderHasPriority(22504);
  const g = new E(h.state);
  const region = h.state.battle!.region;
  const silent: string[] = [];
  for (const name of hooked) {
    // does the hook have a number to say at all in THIS position? A card whose
    // forecast is empty here is not a bug — it is a card with nothing to show.
    const c = getCard(name);
    const rows = c.xPreviewRows?.(g, D, region)?.filter(r => Number.isFinite(r.x)) ?? [];
    const one = c.xPreview?.(g, D, region);
    if (!rows.length && !(typeof one === 'number' && Number.isFinite(one))) continue;

    const s = structuredClone(h.state);
    const item: StackItem = {
      id: 9000, kind: 'spell', card: name, label: name,
      controller: D, region, negated: false, parts: [],
    };
    s.stack.push(item);
    const html = await screen(s, D);
    if (!/X=/.test(html)) silent.push(name);
  }
  assert.deepEqual(silent, [],
    'these cards can say what their X is and the stack does not print it');
});

/* The printed-text class the owner actually quantified over — "ALL cards with
 * an X in them" — is 45 cards, and most of their X's are not a forecast at
 * all. Four channels carry a number to the screen already, and every one of
 * them is read off the CARD DATA rather than guessed from prose:
 *
 *   c.mana === 'X'      a variable CAST cost. The caster picks it, `doDecide`
 *                       writes it to `StackItem.x`, and stackItemX prints it.
 *   castCost.n === 'X'  a variable ADDITIONAL cost (remove X counters, discard
 *                       X cards, sacrifice X units) — `partCostX` on the part.
 *   kind spellToken     the token IS its X; it wears it as an entity.
 *   xPreview(Rows)      the forecast §1d just swept.
 *
 * What is left — 18 cards — is the group where X is READ FROM THE BOARD at
 * resolution and only a card hook could know it in advance. They show nothing,
 * and nothing in the repo knew that until this list. It is an INVENTORY, not
 * an excuse: a new card that reads the board for its X and ships without a
 * hook fails here until somebody decides which side it is on. */
const X_NOT_FORECAST_YET: Record<string, string> = {
  'Channeled Amalgam': 'X is the cost of the spell that triggered it — the trigger carries it '
    + 'as the event `n` that stackItemX already reads, so the stack is not silent about it',
  'Arcane Concentrator': 'same shape as Channeled Amalgam: X is the triggering spell cost, '
    + 'carried on the trigger event',
  'Unstable Apparition': 'same shape as Channeled Amalgam: X is the triggering spell cost',
  'Flamebreath Initiate': 'X is the number of allies adjacent to me — a formation fact that '
    + 'only exists once the columns do, and the card is a unit on the board while it is true',
  'Embermaw Fledgling': 'X is the number of attacking units in my formation — same family',
  'Harbinger of Immolation': 'X is one plus my spell tokens, at the END OF TURN — outside any '
    + 'battle, which is exactly where the xPreview hooks have no region to be asked about',
  'Static Courier': 'X is my power, and the power is printed on the unit itself',
  'Perpetual Construct': 'X is the cost of the mod that was just applied — known only from the '
    + 'event that triggered it',
  'A Pile of Runes': 'X is my defense, printed on the unit itself',
  'Spewing Mushroom': 'X is my power, printed on the unit itself',
  'Volatile Toxicity': 'X is the defense of the unit sacrificed to pay for it, so the number is '
    + 'settled by the cost before the item ever reaches the stack',
  'Keeper of Tithes': 'X is your expended resources at the end of [Haste] — outside battle',
  Exhume: 'X is your [d], which is the resource row on your own side of the screen',
  'Burden of Life': 'X is your life total, which is on the screen already, twice',
  'Prophecy Bug': 'X is half the cost of a card that has not been chosen yet — it is picked '
    + 'during the resolution this forecast would have to precede',
  'Awoken Tomb': 'X is the damage I was dealt — the event `n` stackItemX already reads',
  'Cosmic Conspirator': 'it has no X of its own: the reminder text is about the token it swaps',
  Robot: 'the token IS its X — it spawns with that many counters and draws them',
};

/** does anything reachable on this card declare a variable additional cost? */
function hasVariableCost(v: unknown, depth = 0): boolean {
  if (depth > 8 || v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if ('kind' in o && o['n'] === 'X') return true;
  return Object.values(o).some(x => hasVariableCost(x, depth + 1));
}

test('§1e INVENTORY — every printed X is paid, worn by a token, forecast, or listed here', () => {
  const unaccounted: string[] = [];
  let seen = 0;
  for (const name of allCardNames()) {
    const c = getCard(name) as unknown as Record<string, unknown>;
    if (!/\bX\b/.test(String(c['text'] ?? ''))) continue;
    seen++;
    if (c['mana'] === 'X') continue;                     // paid at cast
    if (c['kind'] === 'spellToken') continue;            // the token wears it
    if (c['xPreview'] !== undefined || c['xPreviewRows'] !== undefined) continue;
    if (hasVariableCost(c)) continue;                    // paid as a cost
    if (X_NOT_FORECAST_YET[name]) continue;
    unaccounted.push(name);
  }
  assert.ok(seen >= 40, `the printed-X class is real and large (${seen} cards)`);
  assert.deepEqual(unaccounted, [],
    'these print an X the board never shows: give the card an xPreviewRows, or add it to '
    + 'X_NOT_FORECAST_YET with the reason its X is not a forecast');
});

test('§1e the inventory is live — every entry still names a real card that still prints an X', () => {
  for (const [name, why] of Object.entries(X_NOT_FORECAST_YET)) {
    assert.ok(allCardNames().includes(name), `${name} is not a card any more — drop the entry`);
    const c = getCard(name) as unknown as Record<string, unknown>;
    assert.match(String(c['text'] ?? ''), /\bX\b/, `${name} no longer prints an X — drop the entry`);
    assert.equal(c['xPreview'] ?? c['xPreviewRows'], undefined,
      `${name} has a forecast hook now — drop the entry rather than carrying both`);
    assert.ok(why.length > 30, `${name} needs a real reason, not a shrug`);
  }
});

/* ══ §2 — [118] a lured unit says so ══════════════════════════════════════ */

/** the one {Alluring} unit in the pool, found rather than named */
function anAllurer(): string {
  const hit = allCardNames().filter(n => {
    const c = getCard(n) as unknown as Record<string, unknown>;
    return c['kind'] === 'unit' && (c['attrs'] as string[] | undefined)?.includes('Alluring');
  });
  assert.ok(hit.length, 'the pool has an {Alluring} unit at all');
  return hit[0]!;
}

/** an {Alluring} attack that has resolved its trigger, so somebody is lured */
function lured(seed: number): { h: Harness; A: Seat; D: Seat; victim: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, anAllurer());
  const vic = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  settleDecisions(h);                        // the {Alluring} target question
  pass(h); pass(h);                          // let the trigger resolve
  assert.ok(h.state.entities[vic]!.allured, 'the fixture really lured something');
  return { h, A, D, victim: vic };
}

test('§2a a lured unit wears a badge, and an unlured one does not', async () => {
  const { h, D, victim } = lured(22510);
  const free = spawn(h, D, 'Unit Token');
  const html = await screen(h.state, D);
  assert.match(html, /lured/, 'the board says it out loud');
  // and it is ABOUT the lured unit: strip the victim from the state and the
  // word has to go with it
  const s = structuredClone(h.state);
  delete s.entities[victim]!.allured;
  assert.equal(/lured/.test(await screen(s, D)), false,
    'the badge follows Entity.allured and nothing else');
  assert.ok(free, 'and a unit that was never lured is on the board to contrast with');
});

test('§2b the badge marks exactly the units the ENGINE would refuse to attack with', async () => {
  /* The client may not hold a second opinion (R245), so the set is asked of
   * the engine and never restated here: sweep every unit the seat controls,
   * offer the engine a declaration built out of that ONE unit, and count the
   * refusals that name {Alluring}. The badge count on screen has to match, at
   * every size — which is what makes it a measurement and not a spot check. */
  /* A plain board at the attacker's own declare step, where a `declareAttack`
   * built out of one unit is a question the engine will actually answer. The
   * marks are FORGED here on purpose: a real {Alluring} trigger produces
   * exactly one, and the point of this test is to vary the SIZE of the set —
   * a badge that appeared once for any reason would satisfy a spot check. */
  const h = new Harness(22511);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const army = [spawn(h, A, 'Good Whale'), spawn(h, A, 'Unit Token'), spawn(h, A, 'Unit Token')];
  giveResources(h, A, 'water', 2);
  toNextBattle(h, A);
  assert.equal(h.state.battle?.step, 'declare');
  assert.equal(h.state.battle?.attacker, A);

  /** which ENTITIES are wearing `marker` on screen. A unit card carries
   * `data-previd="<id>"` and its badges sit inside that same element, so the
   * slice from one such attribute to the next belongs to exactly one card —
   * which is what lets this be a SET comparison rather than a head count.
   * (A unit is drawn on more than one surface, so a count alone is not one.) */
  const wearing = (html: string, marker: string): Set<number> => {
    const out = new Set<number>();
    const parts = html.split('data-previd="');
    for (const p of parts.slice(1)) {
      const id = Number(/^(\d+)/.exec(p)?.[1]);
      if (Number.isFinite(id) && p.includes(marker)) out.add(id);
    }
    return out;
  };

  for (const n of [0, 1, 2, 3]) {
    const s = structuredClone(h.state);
    const mine = army.map(id => s.entities[id]!);
    mine.forEach((u, i) => {
      if (i < n) u.allured = { round: s.battle!.round, columns: [] };
      else delete u.allured;
    });
    // ASK THE ENGINE: offer it a declaration built out of each unit on its own
    const refused = new Set(mine.filter(u => {
      try {
        apply(s, { type: 'declareAttack', seat: A, columns: [[u.id]] } as Action);
        return false;
      } catch (e) { return e instanceof IllegalAction && /Alluring/.test(e.message); }
    }).map(u => u.id));
    assert.equal(refused.size, n, `the engine refuses exactly the ${n} lured units`);
    // …and require the board to have marked that exact set. The CHIP, not the
    // word: the tooltip that explains the rule says "lured" too.
    const marked = wearing(await screen(s, A), '🪝 lured');
    assert.deepEqual([...marked].sort(), [...refused].sort(),
      `the board marks exactly the units the engine refuses (n = ${n})`);
  }
});

test('§2c the must-block half is only claimed for the round that lured it', async () => {
  const { h, D, victim } = lured(22512);
  const s = structuredClone(h.state);
  const mark = s.entities[victim]!.allured!;
  // an older round: the can't-attack half survives, the duty does not
  s.entities[victim]!.allured = { round: mark.round - 1, columns: mark.columns };
  const old = await screen(s, D);
  assert.match(old, /lured/, 'it still cannot attack');
  assert.equal(/must block/.test(old), false,
    'but the duty belonged to the round that lured it and is over');
});

/* ══ §3 — [127] the stack chooser ═════════════════════════════════════════ */

/**
 * A state holding a real `orderTriggers` question.
 *
 * Ancient One "has the triggered abilities of adjacent allies", so standing it
 * beside a Minor Kraken and attacking queues TWO on-attack triggers for one
 * seat that are not `sameTrigger` — which is exactly the condition
 * `processTriggerQueue` raises the question on. Lifted from
 * `26-metal-a.test.ts`, which pins the same fixture for the engine side.
 *
 * It THROWS rather than returning null. A fixture that quietly stops producing
 * the question turns every test built on it into a green no-op, which is the
 * failure mode 143 §fixtures wrote its own loud version of.
 */
function orderingQuestion(seed: number): { h: Harness; seat: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat;
  const D = (1 - A) as Seat;
  const kraken = spawn(h, A, 'Minor Kraken');
  const ancient = spawn(h, A, 'Ancient One');
  spawn(h, D, 'Unit Token');
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[kraken, ancient]] });
  assert.equal(h.state.decision?.kind, 'orderTriggers',
    'the Minor Kraken / Ancient One fixture no longer queues two orderable triggers — '
    + 'find a fresh one rather than letting these tests pass on an absent question');
  return { h, seat: A };
}

test('§3a the ordering bar offers auto-stack, and it sends the order the game listed', async () => {
  const { h, seat } = orderingQuestion(22520);
  const dec = h.state.decision!;
  const ui = await client();
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  ui.sent();
  assert.ok(ui.has({ btn: 'orderauto' }), 'the button the report asked for is there');
  ui.click({ btn: 'orderauto' });
  const outs = ui.actions().filter(a => a.type === 'decide');
  assert.equal(outs.length, 1, 'one answer, once');
  assert.deepEqual((outs[0] as { choice: unknown }).choice, dec.options.map((_o, i) => i),
    'the identity permutation — the order the game itself listed');
  // and the ENGINE takes it, which is the only thing that makes it an answer
  const after = apply(h.state, outs[0]!);
  assert.ok(after.state, 'the engine accepted the auto order');
});

test('§3b auto-stack is opt-in — nothing goes out until it is clicked', async () => {
  const { h, seat } = orderingQuestion(22521);
  const ui = await client();
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  assert.deepEqual(ui.actions().filter(a => a.type === 'decide'), [],
    'BL-18: the client never takes a trigger order for you');
});

test('§3c the ordering options are drawn as the cards they came from', async () => {
  const { h, seat } = orderingQuestion(22522);
  const mine = h.state.triggerQueue.filter(t => t.controller === seat);
  const ui = await client();
  const html = ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  assert.ok(mine.length >= 2, 'two orderable triggers');
  for (const t of mine) {
    // the SCAN, tied to the source entity — not the card name, which the plain
    // label carries too ("Trigger: Minor Kraken — …") and which therefore
    // cannot tell a real picture apart from the button it replaced
    assert.ok(ui.has({ btn: 'orderpick', previd: t.sourceId }),
      `${t.sourceCard} is drawn as its own card, clickable, pointing at entity ${t.sourceId}`);
    assert.ok(html.includes(t.sourceCard), `and it names ${t.sourceCard}`);
  }
});
