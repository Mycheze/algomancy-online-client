/* THE BOARD ANSWERS THE QUESTION — the owner, 2026-09-30:
 *
 *   "All selections should be done by tapping/clicking the unit or player
 *    that is actually on the board (targeting, choosing a selection) rather
 *    than with a list of buttons in the 'up next' bar. If a selection needs to
 *    be made between cards that aren't in play at all … little
 *    representations/images of the card can appear in the bar. I want to avoid
 *    ever having the player select a card based on card NAME alone … I want
 *    this to be a client wide fix that solves this issue with ALL cards and
 *    makes sure that any cards added in the future correctly have the proper
 *    behavior."
 *
 * ui/boardpick.ts says where every option lives. This file holds it to that,
 * three ways:
 *
 *   §1 THE CENSUS — random games, every decision met, rendered through the
 *      real client from the asking seat's own view. Each option must be drawn
 *      exactly where its subject says (a glowing thing on the board and NOT in
 *      the bar; a scan; a button), and a click on the board element must send
 *      that option's index. And no option may carry a card name the board is
 *      standing on while this module files it as "not on the board" — that is
 *      how a new card with a new spelling of "unit N" announces itself.
 *   §2 EVERY SPELLING THE CENSUS FOUND, built by hand so none of them depends
 *      on a fuzz walk happening to reach it.
 *   §3 THE LINES NOT CROSSED — an ambiguous bare number is not guessed at,
 *      a card out of play is still a scan, "name a card" keeps its search.
 *
 * Seeds 34800-34899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './ui-driver.ts';
import type { Pick } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { apply, createGame, legalActions } from '../../engine/src/apply.ts';
import { IllegalAction } from '../../engine/src/engine.ts';
import { rngNext } from '../../engine/src/rng.ts';
import { viewFor } from '../../server/view.ts';
import { give, spawn, toDeployment } from '../../engine/test/util.ts';
import { boardIndex, isBoard, optionSubjects } from '../boardpick.ts';
import type { Subject } from '../boardpick.ts';
import type { Action, Decision, DecisionOption, Entity, GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();

/** the decide actions a seat may send for this decision */
const decideLegal = (dec: Decision): Action[] => dec.options.map((_o, i) => ({ type: 'decide', seat: dec.seat, choice: i }));

/** the board element a subject is drawn as, as the driver finds it */
function elementOf(s: GameState, sub: Subject): Pick | null {
  switch (sub.at) {
    case 'unit': return s.entities[sub.id]?.kind === 'spellToken' ? { act: 'token', id: sub.id } : { act: 'unit', id: sub.id };
    case 'mod': return { act: 'mod', id: sub.id };
    case 'player': return { act: 'player', p: sub.seat };
    case 'stack': return { act: 'stackitem', id: sub.id };
    case 'hand': return { act: 'hand', p: sub.seat, i: sub.index };
    case 'cache': {
      const i = (s.players[sub.seat]!.cache ?? []).findIndex(c => c.uid === sub.uid);
      return i >= 0 ? { act: 'cache', p: sub.seat, i } : null;
    }
    default: return null;
  }
}

/** the prompt bar's markup alone (the board carries its own data-i's) */
const barOf = (html: string): string => {
  const at = html.indexOf('<div class="promptbar');
  return at < 0 ? '' : html.slice(at, html.indexOf('<div class="side"', at) >>> 0);
};

/** Put the asking seat's own view in front of the client and check every
 * option is drawn where its subject says. Returns the subjects. */
function checkDrawn(state: GameState, where: string): Subject[] {
  const dec = state.decision!;
  const view = viewFor(state, dec.seat);
  const html = ui.join(view, dec.seat, legalActions(state, dec.seat));
  const bar = barOf(html);
  const subs = optionSubjects(view.decision!, view);
  // the counter stepper and the ramp dial answer by their own controls
  const dialled = dec.options.some(o => o.value && typeof o.value === 'object' && ('counterFrom' in o.value || 'payLife1' in o.value || 'payMana1' in o.value));
  subs.forEach((sub, i) => {
    const inBar = new RegExp(`data-btn="decide" data-i="${i}"`).test(bar);
    const o = dec.options[i]!;
    if (sub.at === 'mod') {
      // a mod has no card of its own on the table: its picture is in the bar
      // from the start, AND its badge / host take the click (owner, 2026-09-30)
      assert.ok(inBar, `${where}: option ${i} "${o.label}" is a mod — its picture belongs in the bar`);
    } else if (isBoard(sub)) {
      assert.ok(!inBar, `${where}: option ${i} "${o.label}" is on the board (${JSON.stringify(sub)}) but is ALSO in the bar`);
      const el = elementOf(view, sub);
      assert.ok(el && ui.has(el), `${where}: option ${i} "${o.label}" is on the board but nothing there carries ${JSON.stringify(el)}`);
    } else if (sub.at === 'card' && !dialled && dec.kind !== 'orderTriggers' && !dec.pickSet) {
      // a card out of play: a scan (or, past a bar's worth, the search's list)
      assert.ok(inBar || /class="decsearch"/.test(bar),
        `${where}: option ${i} "${o.label}" is a card out of play and has no scan in the bar`);
    }
  });
  return subs;
}

/** click the board element for every board option, and see what goes out */
function checkClicks(state: GameState, subs: Subject[], where: string): void {
  const dec = state.decision!;
  const view = viewFor(state, dec.seat);
  const board = boardIndex(view.decision!, view, subs);
  for (const [key, idx] of board) {
    const sub = subs[idx[0]!]!;
    // a mod's badge may be folded into the host's "+N" when the chip line is
    // full; then the host's key (which lists every mod on it) is the way in
    if (key.startsWith('mod:') && !ui.has(elementOf(view, sub)!)) continue;
    const el: Pick = key.startsWith('unit:') && sub.at === 'mod' ? { act: 'unit', id: sub.host } : elementOf(view, sub)!;
    if (dec.options[idx[0]!]!.value && typeof dec.options[idx[0]!]!.value === 'object'
      && 'counterFrom' in (dec.options[idx[0]!]!.value as object)) continue;   // the stepper's own test (124)
    ui.join(view, dec.seat, legalActions(state, dec.seat));
    ui.sent();
    ui.click(el);
    const sent = ui.actions().filter(a => a.type === 'decide');
    if (idx.length > 1) {
      assert.equal(sent.length, 0, `${where}: ${key} names ${idx.length} options — the click must ask which, not guess`);
      assert.ok(ui.has({ btn: 'boardpickback' }), `${where}: ${key}: and the bar asks which`);
      ui.click({ btn: 'boardpickback' });
    } else if (dec.options[idx[0]!]!.confirm) {
      assert.ok(ui.has({ btn: 'allyconfirm' }), `${where}: ${key}: R288 asks before a likely misclick`);
      ui.click({ btn: 'allycancel' });
    } else {
      assert.deepEqual(sent.map(a => (a as { choice: unknown }).choice), [idx[0]],
        `${where}: clicking ${key} must answer option ${idx[0]} ("${dec.options[idx[0]!]!.label}")`);
    }
  }
}

/** an option this module could not place although the card it names is
 * standing on the board under an id its value mentions — a new spelling */
function unplaced(state: GameState, o: DecisionOption, sub: Subject): string | null {
  if (sub.at !== 'card' && sub.at !== 'button') return null;
  const card = o.card;
  if (!card) return null;
  const ids: number[] = [];
  const v = o.value;
  if (typeof v === 'number') ids.push(v);
  else if (typeof v === 'string') { const m = /(\d+)/.exec(v); if (m) ids.push(Number(m[1])); }
  else if (v && typeof v === 'object') for (const x of Object.values(v)) if (typeof x === 'number') ids.push(x);
  const hit = ids.find(id => { const e = state.entities[id]; return e && !e.absent && e.kind !== 'mod' && e.card === card; });
  return hit === undefined ? null : `entity ${hit} (${card}) is on the board and ${JSON.stringify(v)} names it`;
}

/* ═══ §1 THE CENSUS ════════════════════════════════════════════════════ */

test('§1 every decision a random game meets is drawn where its subject says, and the board answers it', () => {
  const seen = new Map<string, number>();
  const suspects: string[] = [];
  let checked = 0;
  for (let seed = 34800; seed < 34830; seed++) {
    let rng = (seed * 2654435761) >>> 0;
    const rand = (): number => { const [v, n] = rngNext(rng); rng = n; return v; };
    let { state } = createGame(seed, undefined, seed % 3 === 0 ? 'draft' : 'shared');
    for (let i = 0; i < 1500 && state.phase !== 'gameover'; i++) {
      const dec = state.decision;
      if (dec) {
        const view = viewFor(state, dec.seat);
        const subs = optionSubjects(view.decision!, view);
        dec.options.forEach((o, k) => {
          const why = unplaced(view, o, subs[k]!);
          if (why) suspects.push(`${dec.prompt} :: ${o.label} — ${why}`);
        });
        // render a few of each shape: the kind and the subjects it produced
        const shape = `${dec.kind}|${[...new Set(subs.map(s => s.at))].sort().join(',')}`;
        if ((seen.get(shape) ?? 0) < 4) {
          seen.set(shape, (seen.get(shape) ?? 0) + 1);
          const where = `seed ${seed} #${i} "${dec.prompt}"`;
          const drawn = checkDrawn(state, where);
          checkClicks(state, drawn, where);
          checked++;
        }
      }
      const legal = [...legalActions(state, 0), ...legalActions(state, 1)];
      if (!legal.length) break;
      try { state = apply(state, legal[Math.floor(rand() * legal.length)]!).state; } catch (e) { if (!(e instanceof IllegalAction)) throw e; }
    }
  }
  assert.ok(checked > 20, `the census really rendered decisions (${checked}; shapes: ${[...seen.keys()].join(' ')})`);
  assert.ok([...seen.keys()].some(k => k.includes('unit')), 'and some of them were answered on the board');
  assert.deepEqual(suspects, [],
    'an option names a card standing on the board, in a spelling ui/boardpick.ts cannot read — teach it the shape');
});

/* ═══ §2 EVERY SPELLING, BY HAND ═══════════════════════════════════════ */

/** a board with two units a side and a hand, and a decision grafted onto it.
 * The decision is the engine's own SHAPE (the census found each one); what is
 * under test is only where the client draws it and what a click sends. */
function board(seed: number): { h: Harness; me: Seat; them: Seat; mine: number[]; theirs: number[]; hand: number[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const me = 0 as Seat, them = 1 as Seat;
  const mine = [spawn(h, me, 'Wraith'), spawn(h, me, 'Good Whale')];
  const theirs = [spawn(h, them, 'Palewing'), spawn(h, them, 'Wisp')];
  const hand = [give(h, me, 'Fireball'), give(h, me, 'Recall')];
  return { h, me, them, mine, theirs, hand };
}

function ask(h: Harness, dec: Omit<Decision, 'id'>): GameState {
  const s = structuredClone(h.state);
  s.decision = { id: 9000 + dec.options.length, ...dec } as Decision;
  return s;
}

/** show it, then click `el` and expect option `i` sent */
function clickSends(s: GameState, el: Pick, i: number, why: string): void {
  const dec = s.decision!;
  ui.join(viewFor(s, dec.seat), dec.seat, decideLegal(dec));
  ui.sent();
  ui.click(el);
  assert.deepEqual(ui.actions().filter(a => a.type === 'decide').map(a => (a as { choice: number }).choice), [i], why);
}

const unitOpt = (h: Harness, id: number, value: unknown, label?: string): DecisionOption =>
  ({ label: label ?? h.state.entities[id]!.card, value, card: h.state.entities[id]!.card });

test('§2a a bare entity id (Wraith\'s ally, Torrential Reclamation\'s sacrifice): the units glow, the bar is empty', () => {
  const { h, me, mine } = board(34801);
  for (const withCard of [true, false]) {
    const s = ask(h, {
      seat: me, kind: 'electricPath', prompt: 'sacrifice a unit',
      options: mine.map(id => withCard ? unitOpt(h, id, id) : { label: h.state.entities[id]!.card, value: id }),
    });
    const subs = checkDrawn(s, `electricPath, card ${withCard}`);
    assert.deepEqual(subs.map(x => x.at), ['unit', 'unit']);
    assert.doesNotMatch(barOf(ui.html()), /data-btn="decide"/, 'no name buttons, and no scans of units that are standing right there');
    clickSends(s, { act: 'unit', id: mine[1]! }, 1, 'clicking the second unit sends the second option');
  }
});

test('§2b the cost spellings: {recall}, {unit} on a payOrDecline, Mindburn\'s "u:"', () => {
  const { h, me, mine, theirs } = board(34802);
  const shapes: [string, (id: number) => unknown, Decision['kind']][] = [
    ['recall', id => ({ recall: id }), 'targets'],
    ['payOrDecline unit', id => ({ unit: id }), 'payOrDecline'],
    ['mindburn', id => `u:${id}`, 'electricPath'],
  ];
  for (const [name, val, kind] of shapes) {
    const pool = name === 'payOrDecline unit' ? theirs : mine;
    const s = ask(h, { seat: me, kind, prompt: name, options: pool.map(id => unitOpt(h, id, val(id))) });
    checkDrawn(s, name);
    clickSends(s, { act: 'unit', id: pool[0]! }, 0, `${name}: the board answers`);
  }
});

test('§2c a hand card: {discard}, Mindburn\'s "h:", a {Modular} mod from hand, a bare hand index', () => {
  const { h, me, hand } = board(34803);
  const cards = hand.map(i => h.state.players[me]!.hand[i]!);
  const shapes: [string, (i: number) => unknown, Decision['kind']][] = [
    ['discard', i => ({ discard: i }), 'targets'],
    ['mindburn', i => `h:${i}`, 'electricPath'],
    ['modular', i => ({ modFrom: 'hand', index: i }), 'targets'],
    ['bare index', i => i, 'payOrDecline'],
  ];
  for (const [name, val, kind] of shapes) {
    const s = ask(h, {
      seat: me, kind, prompt: name,
      options: hand.map((i, k) => ({ label: cards[k]!, value: val(i), card: cards[k]! })),
    });
    const subs = checkDrawn(s, name);
    assert.ok(subs.every(x => x.at === 'hand'), `${name}: read as the hand (${JSON.stringify(subs)})`);
    assert.match(ui.html(), new RegExp(`class="card[^"]*\\bcandidate\\b[^"]*" data-act="hand" data-p="${me}" data-i="${hand[1]}"`),
      `${name}: the hand card glows`);
    clickSends(s, { act: 'hand', p: me, i: hand[1]! }, 1, `${name}: clicking the hand card answers`);
  }
});

test('§2d "erase one of my mods": the mod\'s badge is clicked, and its host asks which with scans', () => {
  const { h, me, mine } = board(34804);
  const host = mine[1]!;
  // two mods on the host, the way the engine lays them out (modOf / mods)
  const s0 = structuredClone(h.state);
  const base = s0.entities[host]!;
  const mods = [7001, 7002];
  mods.forEach((id, k) => {
    s0.entities[id] = { ...structuredClone(base), id, card: k ? 'Slag Spewer' : 'Hooba-Lin', kind: 'mod', modOf: host, mods: [] } as Entity;
  });
  base.mods = [...mods];
  const s = structuredClone(s0);
  s.decision = {
    id: 9100, seat: me, kind: 'targets', prompt: 'erase one of my mods',
    options: mods.map(id => ({ label: `Erase ${s0.entities[id]!.card}`, value: { eraseMod: id }, card: s0.entities[id]!.card })),
  };
  checkDrawn(s, 'eraseMod');
  // two long chips do not fit one line: the first stays (a pickable chip is
  // the last to fold), the second folds into "+N" and is reached by the host
  assert.match(ui.html(), /data-act="mod" data-id="7001" class="modpick"/, 'the badge takes the click and glows');
  assert.match(ui.html(), new RegExp(`class="card[^"]*\\bcandidate\\b[^"]*" data-act="unit" data-id="${host}"`), 'and so does its host');
  clickSends(s, { act: 'mod', id: 7001 }, 0, 'clicking the badge erases that mod');

  ui.join(viewFor(s, me), me, decideLegal(s.decision));
  ui.sent();
  ui.click({ act: 'unit', id: host });
  assert.deepEqual(ui.actions(), [], 'the host names two options: nothing is guessed');
  const bar = barOf(ui.html());
  assert.match(bar, /which one\?/);
  assert.equal((bar.match(/class="card[^"]*" data-btn="decide"/g) ?? []).length, 2, 'the two mods, as scans');
  ui.click({ btn: 'decide', i: 0 });
  assert.deepEqual(ui.actions().map(a => (a as { choice: number }).choice), [0]);
});

test('§2e a player, a stack item and a spell token are all answered where they stand', () => {
  const { h, me, them } = board(34805);
  const s = ask(h, {
    seat: me, kind: 'targets', prompt: 'any target',
    options: [{ label: 'Player 2', value: { player: them } }, { label: 'Player 1', value: { player: me } }],
  });
  checkDrawn(s, 'players');
  assert.doesNotMatch(barOf(ui.html()), /data-btn="decide"/, 'no player buttons in the bar');
  clickSends(s, { act: 'player', p: them }, 0, 'clicking a life total picks the player');
});

/* ═══ §3 THE LINES NOT CROSSED ═════════════════════════════════════════ */

test('§3a numbers that are deck positions (a glimpse) stay scans — and an ambiguous namespace is not guessed', () => {
  const { h, me, mine } = board(34806);
  // deck positions 0..2 carrying card names that are NOT the entities 0..2
  const glimpse = ask(h, {
    seat: me, kind: 'payOrDecline', prompt: 'cache one',
    options: ['Sarcophage', 'Wisp', 'Fireball'].map((c, i) => ({ label: c, value: i, card: c })),
  });
  const subs = checkDrawn(glimpse, 'glimpse');
  assert.ok(subs.every(x => x.at === 'card'), `deck tops are cards out of play: ${JSON.stringify(subs)}`);
  assert.equal((barOf(ui.html()).match(/class="card[^"]*" data-btn="decide"/g) ?? []).length, 3, 'three scans');

  // one number reads as a unit, the other as nothing on the board: the
  // question does not agree on a namespace, so neither is lit
  const mixed = ask(h, {
    seat: me, kind: 'payOrDecline', prompt: 'mixed',
    options: [unitOpt(h, mine[0]!, mine[0]!), { label: 'Sarcophage', value: 999, card: 'Sarcophage' }],
  });
  assert.ok(checkDrawn(mixed, 'mixed').every(x => x.at === 'card'), 'a disagreeing question falls back to scans');
});

test('§3b buttons stay buttons: no more targets, decline, a mode, an amount', () => {
  const { h, me, theirs } = board(34807);
  const s = ask(h, {
    seat: me, kind: 'targets', prompt: 'up to one',
    options: [unitOpt(h, theirs[0]!, { unit: theirs[0] }), { label: 'No more targets', value: { doneTargets: true } }],
  });
  checkDrawn(s, 'up to one');
  assert.match(barOf(ui.html()), /<button class="declinebtn" data-btn="decide" data-i="1"/, '"No more targets" is a button');
  const mode = ask(h, {
    seat: me, kind: 'mode', prompt: 'gain or lose?',
    options: [{ label: 'Lose 3', value: 'lose' }, { label: 'Gain 3', value: 'gain' }],
  });
  const subs = checkDrawn(mode, 'mode');
  assert.ok(subs.every(x => x.at === 'button'));
  assert.equal((barOf(ui.html()).match(/<button data-btn="decide"/g) ?? []).length, 2);
});

test('§3c the board hint is only there when something on the board answers', () => {
  const { h, me, theirs } = board(34808);
  ui.join(viewFor(ask(h, { seat: me, kind: 'targets', prompt: 't', options: [unitOpt(h, theirs[0]!, { unit: theirs[0] })] }), me), me, []);
  assert.match(barOf(ui.html()), /class="pickhint"/);
  ui.join(viewFor(ask(h, { seat: me, kind: 'mode', prompt: 'm', options: [{ label: 'a', value: 'a' }, { label: 'b', value: 'b' }] }), me), me, []);
  assert.doesNotMatch(barOf(ui.html()), /class="pickhint"/);
});

test('§3d the census would notice a new spelling: an unknown shape naming a unit on the board is flagged', () => {
  const { h, me, mine } = board(34809);
  const s = ask(h, { seat: me, kind: 'targets', prompt: 'x', options: [unitOpt(h, mine[0]!, { sacrifice: mine[0] })] });
  const sub = optionSubjects(s.decision!, s)[0]!;
  assert.equal(sub.at, 'card', 'the module cannot read a shape it was never taught…');
  assert.match(unplaced(s, s.decision!.options[0]!, sub) ?? '', /is on the board/,
    '…and §1 would say so, naming the entity, instead of quietly drawing a scan');
});

/* ═══ §4 THE OWNER'S BOARDS (server/scenarios-g.ts) ════════════════════
 *
 * Each scenario the owner is handed is played here to the question it is
 * about, and that question is drawn and clicked through the real client —
 * so a scenario that stops reaching its question, or a question whose shape
 * moved, fails here before it wastes a look. */

const { dealScenario } = await import('../../server/scenarios.ts');

function deal(id: string): GameState {
  return dealScenario(216216216, ['You', 'Tester Bot'], 'shared', undefined as never, undefined, id).state;
}
/** apply the first legal action for `seat` matching `pred` */
function take(s: GameState, seat: Seat, pred: (a: Action) => boolean, why: string): GameState {
  const a = legalActions(s, seat).find(pred);
  assert.ok(a, `${why}: no such legal action (decision: ${s.decision?.prompt ?? 'none'})`);
  return apply(s, a).state;
}
/** answer the open decision with the first option matching `pred` */
function answer(s: GameState, pred: (o: DecisionOption) => boolean, why: string): GameState {
  const dec = s.decision;
  assert.ok(dec, `${why}: no question open`);
  const i = dec.options.findIndex(pred);
  assert.ok(i >= 0, `${why}: no such option in "${dec.prompt}": ${dec.options.map(o => o.label).join(' | ')}`);
  return apply(s, { type: 'decide', seat: dec.seat, choice: i }).state;
}
/** pass priority (and let the bot answer its own questions with option 0,
 * as the scenario runner's does) until seat 0 is asked something */
function untilAsked(s: GameState, why: string): GameState {
  for (let n = 0; n < 40; n++) {
    if (s.decision?.seat === 0) return s;
    if (s.decision) { s = apply(s, { type: 'decide', seat: s.decision.seat, choice: 0 }).state; continue; }
    const seat = ([0, 1] as Seat[]).find(p => legalActions(s, p).some(a => a.type === 'passPriority'));
    assert.ok(seat !== undefined, `${why}: nobody can pass and nobody is asked`);
    s = apply(s, { type: 'passPriority', seat }).state;
  }
  assert.fail(`${why}: seat 0 was never asked`);
}
const hand = (s: GameState, name: string): number => s.players[0]!.hand.indexOf(name);
/** the question is drawn right and the board answers it; returns its subjects */
function judge(s: GameState, where: string): Subject[] {
  const subs = checkDrawn(s, where);
  checkClicks(s, subs, where);
  return subs;
}

test('§4a board-pick-targets: Torrential Reclamation\'s sacrifice is a click on your own unit', () => {
  let s = deal('board-pick-targets');
  s = apply(s, { type: 'playCard', seat: 0, handIndex: hand(s, 'Torrential Reclamation') }).state;
  // X, then the recall target
  s = answer(s, o => o.value === 1 || /X = 1/.test(o.label), 'X = 1');
  assert.ok(judge(s, 'recall target').some(x => x.at === 'unit'), 'the ally to recall glows');
  s = answer(s, o => (o.value as { unit?: number })?.unit !== undefined, 'recall an ally');
  s = untilAsked(s, 'the sacrifice');
  const subs = judge(s, 'each player sacrifices');
  assert.ok(subs.length && subs.every(x => x.at === 'unit'), `every sacrifice option is a unit on the board: ${JSON.stringify(subs)}`);
});

test('§4b board-pick-costs: Pallid Gorger lights your hand AND your units; Auric Ascendant\'s recall is a click', () => {
  const s0 = deal('board-pick-costs');
  const host = (card: string): number => Object.values(s0.entities).find(e => e.controller === 0 && e.card === card && e.kind !== 'mod'
    && e.mods.some(m => s0.entities[m]?.card === 'Pallid Gorger'))?.id ?? -1;
  let s = take(s0, 0, a => a.type === 'activateAbility' && a.entityId === host('Good Whale'), 'Pallid Gorger on the Whale');
  const subs = judge(s, 'discard or sacrifice');
  assert.ok(subs.some(x => x.at === 'hand') && subs.some(x => x.at === 'unit'), `both kinds glow: ${JSON.stringify(subs)}`);

  const auric = Object.values(s0.entities).find(e => e.card === 'Auric Ascendant')!.id;
  s = take(s0, 0, a => a.type === 'activateAbility' && a.entityId === auric, 'Auric Ascendant');
  for (let n = 0; n < 4 && s.decision && !judge(s, 'auric').some(x => x.at === 'unit'); n++) s = answer(s, () => true, 'pay the [one]');
  assert.ok(optionSubjects(s.decision!, s).some(x => x.at === 'unit'), 'the ally to recall is on the board');
});

test('§4c board-pick-erase-mod: the mods are the choice, on the Whale', () => {
  const s0 = deal('board-pick-erase-mod');
  let s = take(s0, 0, a => a.type === 'activateAbility', 'Slag Spewer\'s donated ability');
  for (let n = 0; n < 4 && s.decision && !optionSubjects(s.decision, s).some(x => x.at === 'mod'); n++) s = answer(s, () => true, 'pay the [one]');
  const subs = judge(s, 'erase a mod');
  assert.ok(subs.length && subs.every(x => x.at === 'mod'), `the mods are the options: ${JSON.stringify(subs)}`);
});

test('§4d board-pick-each-player: Mindburn asks for a unit or a hand card, both on the table', () => {
  let s = deal('board-pick-each-player');
  s = apply(s, { type: 'playCard', seat: 0, handIndex: hand(s, 'Mindburn') }).state;
  s = answer(s, o => o.value === 2 || /X = 2/.test(o.label), 'X = 2');
  s = untilAsked(s, 'Mindburn');
  const subs = judge(s, 'mindburn');
  assert.ok(subs.some(x => x.at === 'hand') && subs.some(x => x.at === 'unit'), JSON.stringify(subs));
});

test('§4e board-pick-stack: Divine Intervention targets the stack card, then a unit', () => {
  let s = deal('board-pick-stack');
  s = apply(s, { type: 'playCard', seat: 0, handIndex: hand(s, 'Divine Intervention') }).state;
  const first = judge(s, 'target effect');
  assert.ok(first.some(x => x.at === 'stack'), `the Twin Flame on the stack is the target: ${JSON.stringify(first)}`);
  s = answer(s, o => (o.value as { stack?: number })?.stack !== undefined, 'target Twin Flame');
  s = untilAsked(s, '"change its targets?"');
  assert.ok(judge(s, 'change targets?').every(x => x.at === 'button'), 'yes / no are plain buttons');
  s = answer(s, o => o.value === true, 'change the targets');
  const second = judge(s, 'new target');
  assert.ok(second.every(x => x.at === 'unit'), `the new target is a unit on the board: ${JSON.stringify(second)}`);
  // "Keep Bubb" is the unit already targeted: it glows like the rest, so it
  // wears the word that says what clicking it does
  const keep = s.decision!.options.findIndex(o => /^Keep /.test(o.label));
  const kept = (second[keep] as { id: number }).id;
  const html = ui.html(), at = html.indexOf(`data-act="unit" data-id="${kept}"`);
  const card = html.slice(at, html.indexOf('data-act="unit"', at + 10) >>> 0);
  assert.match(card, /class="picktag">Keep</, 'the kept target says "Keep"');
  const other = (second.find((x, i) => i !== keep) as { id: number }).id;
  const at2 = html.indexOf(`data-act="unit" data-id="${other}"`);
  assert.doesNotMatch(html.slice(at2, html.indexOf('data-act="unit"', at2 + 10) >>> 0), /picktag/,
    'and a plain new target wears nothing');
});

test('§4f board-pick-out-of-play: a glimpse keeps its pictures', () => {
  let s = deal('board-pick-out-of-play');
  s = apply(s, { type: 'playCard', seat: 0, handIndex: hand(s, 'Premonition') }).state;
  s = untilAsked(s, 'the glimpse');
  const subs = judge(s, 'glimpse');
  assert.ok(subs.some(x => x.at === 'card') && !subs.some(isBoard), `deck tops are scans: ${JSON.stringify(subs)}`);
});

/* ═══ §5 THE CARD BEING CAST STAYS IN SIGHT ════════════════════════════
 *
 * The owner, 2026-09-30: *"while casting/choosing targets, the card is no
 * longer visible … put it sorta visually below the stack, while choices are
 * being made. If cancelled, it goes back to hand. If finished … it goes onto
 * the stack."* */

const castingOf = (html: string): string | null =>
  /class="stackcard casting[^"]*" data-anim="s\d+" data-prev="([^"]+)"/.exec(html)?.[1] ?? null;

test('§5 the card under construction is drawn under the stack, and leaves it for the stack or the hand', () => {
  let s = deal('board-pick-targets');
  s = apply(s, { type: 'playCard', seat: 0, handIndex: hand(s, 'Twin Flame') }).state;
  assert.equal(s.suspension?.type, 'cast', 'the premise: Twin Flame is waiting on its targets');
  assert.equal(hand(s, 'Twin Flame'), -1, 'the premise: the engine has taken it out of the hand');
  const html = ui.join(viewFor(s, 0), 0, legalActions(s, 0));
  assert.equal(castingOf(html), 'Twin Flame', 'so the stack window shows it, marked as being cast');
  assert.equal(castingOf(ui.join(viewFor(s, 1), 1, legalActions(s, 1))), null,
    'the opponent is not shown the caster\'s half-made choices');

  // finished: onto the stack, and out of the casting row
  let done = answer(s, o => (o.value as { unit?: number })?.unit !== undefined, 'first target');
  done = answer(done, o => (o.value as { doneTargets?: boolean })?.doneTargets === true, 'no more targets');
  assert.ok(done.stack.some(i => i.card === 'Twin Flame'), 'the premise: it is on the stack');
  const after = ui.join(viewFor(done, 0), 0, legalActions(done, 0));
  assert.equal(castingOf(after), null, 'the casting row is gone once it is on the stack');
  assert.match(after, /class="stackcard[^"]*" [^>]*data-prev="Twin Flame"/, 'and the card is on the stack strip');

  // cancelled: the client takes a cast back by UNDO (startCastCancel), so the
  // state it lands on is the one before the play — the card in the hand
  const back = deal('board-pick-targets');
  assert.ok(hand(back, 'Twin Flame') >= 0, 'the premise: it is in the hand');
  assert.equal(castingOf(ui.join(viewFor(back, 0), 0, legalActions(back, 0))), null, 'and not under the stack');
});

test('§5b over a stack that already holds something, the card being cast sits below it', () => {
  let s = deal('board-pick-stack');
  s = apply(s, { type: 'playCard', seat: 0, handIndex: hand(s, 'Divine Intervention') }).state;
  const html = ui.join(viewFor(s, 0), 0, legalActions(s, 0));
  assert.equal(castingOf(html), 'Divine Intervention');
  const row = html.indexOf('class="stackrow"'), cast = html.indexOf('class="stackcastrow"');
  assert.ok(row >= 0 && cast > row, 'in the same window, after the stack row');
  assert.ok(html.slice(row, cast).includes('data-prev="Twin Flame"'), 'with Twin Flame still on the stack above it');
});
