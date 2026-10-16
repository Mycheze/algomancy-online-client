/* Report D2 (Discord, 2026-10-16) — THE "YES, ACTIVATE" BAR IS MODAL, AND IT
 * IS NOT ASKED WHERE THE ENGINE ALREADY ASKS.
 *
 * The report: "When you are asked a safety question (like "do you really want
 * to do X"), then it should not be possible to do anything else but answer
 * that question. We had it twice that we wanted to choose a target because we
 * did not notice the safety question and ended up (casting / activating) the
 * thing we wanted to choose as a target instead."
 *
 * Reproduced on the real client: Cadaverous Cultivator, "[Battle] Discard a
 * card: [Switch]". Clicking it raised the bar; the player then clicked the
 * hand card they meant to DISCARD, and that click played the card, with the
 * bar still up. Two defects, two fixes:
 *
 *  §1 ui/inspect.ts activationNeedsConfirm counted a discard / sacrifice-
 *     another cost as "nothing will stop to ask". The engine always stops: the
 *     cost is a cancelable "(activation cost)" pick of which card or unit. So
 *     the bar sat exactly where the pick was expected. It is not raised for
 *     those any more; the pick is the moment to notice.
 *  §2 the owner's ruling, verbatim: "The only ways to say "yes, activate"
 *     should be clicking the SAME unit/thing again or clicking the Yes or
 *     hitting enter. Otherwise, it should do nothing." The No button and
 *     Escape still cancel. Everything else is refused and flashes the bar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { allCardNames, getCard } from '../../engine/src/cards/dsl.ts';
import '../../engine/src/cards/registry.ts';
import { viewFor } from '../../server/view.ts';
import { give, giveResources, pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Action, ActivateVia, EntityId, Seat } from '../../engine/src/types.ts';
import { activationNeedsConfirm } from '../inspect.ts';
import { client } from './ui-driver.ts';

const ui = await client();
type Activate = Extract<Action, { type: 'activateAbility' }>;

/** "Sacrifice me: recall up to one target cached card": with an empty cache
 * nothing stops to ask, so this one still raises the bar (373, 50) */
const ASKS = 'Prismatic Observer';
/** "[Battle] Discard a card: fire my grafts" — the reported card */
const PICKS = 'Cadaverous Cultivator';

interface Table { h: Harness; seat: Seat; asks: EntityId; picks: EntityId; hand: number; a: Activate; b: Activate }

/** a battle window where one seat holds priority with both units usable and a
 * card it could play from hand */
function table(seed: number): Table {
  const h = new Harness(seed, ['Ann', 'Bo']);
  toDeployment(h);
  const asks = ([0, 1] as const).map(s => spawn(h, s, ASKS));
  const picks = ([0, 1] as const).map(s => spawn(h, s, PICKS));
  for (const s of [0, 1] as const) { give(h, s, 'Flame of History'); giveResources(h, s, 'fire', 3); }
  toNextBattle(h);
  const usable = (p: Seat, id: EntityId): Activate | undefined => legalActions(h.state, p)
    .find((x): x is Activate => x.type === 'activateAbility' && x.entityId === id);
  let seat: Seat | null = null;
  for (let g = 0; g < 30 && h.state.phase === 'battle'; g++) {
    const p = h.state.priority;
    if (p != null && usable(p, asks[p]!) && usable(p, picks[p]!)
      && legalActions(h.state, p).some(x => x.type === 'playCard')) { seat = p; break; }
    const atk = h.state.battle?.attacker;
    const declare = atk != null && h.state.priority == null
      ? legalActions(h.state, atk).find(x => x.type === 'declareAttack' && x.columns.length > 0) : undefined;
    if (declare) h.do(declare); else if (p != null) pass(h); else break;
  }
  assert.ok(seat !== null, 'reached a battle window with both abilities and a hand card live');
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  ui.sent();
  const hand = h.state.players[seat].hand.indexOf('Flame of History');
  assert.ok(hand >= 0);
  return { h, seat, asks: asks[seat]!, picks: picks[seat]!, hand, a: usable(seat, asks[seat]!)!, b: usable(seat, picks[seat]!)! };
}

/** the bar's nudge class right now ('' when it has not flashed) */
const nudge = (html: string): string => /class="promptbar pending( nudge[ab])?"/.exec(html)?.[1] ?? '';

/** put the bar up over the Observer */
function barUp(seed: number): Table {
  const t = table(seed);
  ui.click({ act: 'unit', id: t.asks });
  assert.ok(ui.has({ btn: 'actconfirm' }), 'the "Yes, activate" bar is up');
  assert.deepEqual(ui.actions(), [], 'and nothing is sent until it is answered');
  assert.equal(nudge(ui.html()), '', 'it has not flashed yet');
  return t;
}

/* ── §1 a cost that is a pick is its own question ──────────────────────── */

test('D2 §1 the reported card raises no bar: its discard is the question, and the click activates', () => {
  const t = table(45601);
  ui.click({ act: 'unit', id: t.picks });
  assert.ok(!ui.has({ btn: 'actconfirm' }), 'no "Yes, activate" in front of the discard pick');
  assert.deepEqual(ui.actions(), [t.b], 'the click sends the activation; the engine asks which card');
  // …and the engine does ask, before anything is paid (and the cast is still cancelable)
  t.h.do(t.b);
  assert.match(t.h.state.decision?.prompt ?? '', /discard a card \(activation cost\)/);
  assert.equal(t.h.state.suspension?.type, 'cast', 'a pre-commit cast: Escape takes it back');
});

test('D2 §1 over the pool: every pick-cost ability with nothing charged first skips the bar, every unasked cost still asks', () => {
  const picked: string[] = [], asked: string[] = [];
  for (const name of allCardNames()) {
    const def = getCard(name) as unknown as Record<string, unknown>;
    for (const [list, via] of [['abilities', undefined], ['augmentText', 'augment']] as const) {
      const abs = def[list];
      if (!Array.isArray(abs)) continue;
      abs.forEach((ab: { type?: string; cost?: Record<string, unknown>; effect?: { targets?: unknown } }, i) => {
        if (ab?.type !== 'activated' || ab.effect?.targets) return;
        const c = ab.cost ?? {};
        const unasked = !!(c['sacrificeSelf'] || c['life'] || c['debt']);
        const pick = !!(c['discard'] || c['sacrificeOther'] || c['discardOrSacrifice']);
        if (!unasked && !pick) return;
        const h = new Harness(45602, ['Ann', 'Bo']);
        toDeployment(h);
        const id = spawn(h, 0, name);
        const a: Activate = { type: 'activateAbility', seat: 0, entityId: id, abilityIndex: i,
          ...(via ? { via: via as ActivateVia } : {}) };
        const got = activationNeedsConfirm(new E(h.state), h.state.entities[id]!, a);
        if (unasked) { asked.push(name); assert.equal(got, true, `${name} [${list} ${i}] spends ${JSON.stringify(c)} unasked — it must still ask`); }
        else { picked.push(name); assert.equal(got, false, `${name} [${list} ${i}] costs ${JSON.stringify(c)}: the engine asks which, so the bar must not`); }
      });
    }
  }
  assert.ok(picked.length >= 7, `the sweep found ${picked.length} pick-cost abilities (7 when this was written)`);
  assert.ok(asked.length >= 5, `and ${asked.length} unasked ones`);
});

/* ── §2 the bar is modal ────────────────────────────────────────────────── */

test('D2 §2 with the bar up a hand click sends nothing, and the bar flashes', () => {
  const t = barUp(45611);
  const html = ui.click({ act: 'hand', p: t.seat, i: t.hand });
  assert.deepEqual(ui.actions(), [], 'the card is NOT played — the reported bug');
  assert.ok(ui.has({ btn: 'actconfirm' }), 'the bar is still asking');
  assert.notEqual(nudge(html), '', 'and it flashed so the player sees it');
});

test('D2 §2 with the bar up a click on another unit sends nothing', () => {
  const t = barUp(45612);
  const html = ui.click({ act: 'unit', id: t.picks });
  assert.deepEqual(ui.actions(), [], 'the other unit does not activate');
  assert.ok(ui.has({ btn: 'actconfirm' }));
  assert.match(html, /activate <b>Prismatic Observer<\/b>/, 'and the bar is still about the first one');
});

test('D2 §2 with the bar up a board button, Space, a number key and a right-click do nothing but flash it', () => {
  const t = barUp(45613);
  ui.click({ btn: 'settingsmenu' });
  const first = nudge(ui.html());
  assert.notEqual(first, '', 'a board button is refused');
  ui.key(' ');
  const second = nudge(ui.html());
  assert.ok(second && second !== first, 'Space is refused (the flash restarts)');
  ui.key('1');
  assert.ok(nudge(ui.html()) !== second, 'a number key is refused');
  const menu = ui.rightClick({ act: 'unit', id: t.picks });
  assert.ok(!/class="menu"/.test(menu), 'no card menu opens — its entries act');
  assert.deepEqual(ui.actions(), []);
  assert.ok(ui.has({ btn: 'actconfirm' }));
});

test('D2 §2 clicking the same unit again says yes', () => {
  const t = barUp(45614);
  ui.click({ act: 'unit', id: t.asks });
  assert.deepEqual(ui.actions(), [t.a], 'the second click on the unit that asked is the yes');
  assert.ok(!ui.has({ btn: 'actconfirm' }));
});

test('D2 §2 Enter says yes', () => {
  const t = barUp(45615);
  ui.key('Enter');
  assert.deepEqual(ui.actions(), [t.a], 'Enter is one of the three ways to say yes');
  assert.ok(!ui.has({ btn: 'actconfirm' }));
});

test('D2 §2 the Yes button says yes, and No and Escape still cancel', () => {
  let t = barUp(45616);
  ui.click({ btn: 'actconfirm' });
  assert.deepEqual(ui.actions(), [t.a]);
  t = barUp(45617);
  ui.click({ btn: 'actcancel' });
  assert.ok(!ui.has({ btn: 'actconfirm' }), 'No takes the bar down');
  ui.click({ act: 'hand', p: t.seat, i: t.hand });
  assert.equal(ui.actions()[0]?.type, 'playCard', 'and the board is live again');
  barUp(45618);
  ui.key('Escape');
  assert.ok(!ui.has({ btn: 'actconfirm' }), 'Escape takes it down');
  assert.deepEqual(ui.actions(), [], 'sending nothing');
});
