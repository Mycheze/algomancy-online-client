/**
 * CT-564 — A CARD PLAYED BY ANOTHER CARD'S EFFECT ASKS ITS OWN "AS I AM
 * PLAYED" QUESTIONS.
 *
 * Reports #399 (QMRP: "The everywhere should name a card when played in any
 * way (e.g. insidious invitation)") and #405 (KNQX: "When playing out
 * Tiderunner Initiate with Insidious Invitation, you should be able to play
 * Tiderunner into an open slot in formation"). Both replayed faithfully: from
 * hand the card named / took its spot; off Insidious Invitation it arrived
 * having done neither.
 *
 * A card played by an effect (Insidious Invitation, Tides of the Cosmos, Wake
 * the Dead, Hooba-Pon) is declared by `declareInlinePlay`, which asked X,
 * targets, mode, costs and — only when the CALLER promised one — a formation
 * spot. It never read the PLAYED card's own cast-window stages:
 *   · `namesAsPlayed`      (CR 702.3g) — The Everywhere
 *   · `playsIntoFormation` (CR 602.7)  — Tiderunner Initiate, Trench Stalker
 * These are plays (CR 701.4), so both apply.
 *
 * §4 is the guard that could have caught it: every stage of the hand-play cast
 * window (`E.collectTargets`) must be accounted for on the inline path.
 *
 * Seeds 148100-148199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { playInline } from '../src/cards/sets/batch-water-a.ts';
import type { Seat } from '../src/types.ts';
import { ent, giveResources, pass, pick, spawn, toDeployment, toNextBattle, unitsOf, withE } from './util.ts';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');

function decide(h: Harness, match: (label: string) => boolean): void {
  const d = h.state.decision;
  assert.ok(d, 'a decision is pending');
  const i = d.options.findIndex(o => match(o.label));
  assert.notEqual(i, -1, `no option matching; menu was [${d.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: d.seat, choice: i });
}

/** pass every window (and order every trigger) until the stack is empty or a
 * real question is pending */
function drain(h: Harness): void {
  for (let guard = 60; guard-- > 0;) {
    const d = h.state.decision;
    if (d?.kind === 'orderTriggers') { h.do({ type: 'decide', seat: d.seat, choice: d.options.map((_, i) => i) }); continue; }
    if (d) return;
    if (h.state.stack.length && h.state.priority !== null) { pass(h); continue; }
    return;
  }
  throw new Error('drain did not terminate');
}

/** A attacks with a Good Whale and casts Insidious Invitation, holding `card`;
 * the Invitation resolves and A picks `card` off its menu. */
function inviteInto(h: Harness, card: string, color: 'water' | 'light', mana: number): { A: Seat; wh: number } {
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const wh = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'water', 1);
  giveResources(h, A, color, mana);
  toNextBattle(h, A);
  h.state.players[A]!.hand = ['Insidious Invitation', card];
  h.state.players[1 - A]!.hand = [];
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  h.do({ type: 'playCard', seat: A, handIndex: 0 });
  pass(h);                                   // the Invitation resolves (and draws 1)
  decide(h, l => l === card);                // "starting with you"
  return { A, wh };
}

/* ═══ §1 THE EVERYWHERE — report #399 ═══════════════════════════════════ */

test('CT-564 #399: The Everywhere played off Insidious Invitation names a card, and the named card loses its abilities', () => {
  const h = new Harness(148101, ['Ben', 'Rashi']);
  const { A, wh } = inviteInto(h, 'The Everywhere', 'light', 4);
  const d = h.state.decision;
  assert.ok(d, 'THE REPORT: the play asks for a name');
  assert.equal(d.seat, A);
  assert.equal(d.prompt, 'The Everywhere: name a card');
  pick(h, 'Good Whale');
  assert.ok(h.events.some(e => e.msg.endsWith(` names Good Whale as The Everywhere is played.`)),
    'the naming is announced as it is for a play from hand');
  drain(h);
  const ev = unitsOf(h, A).find(u => u.card === 'The Everywhere');
  assert.ok(ev, 'The Everywhere arrived');
  assert.equal(ev.named, 'Good Whale', 'it arrives carrying the name');
  assert.ok(h.q.abilitiesSuppressed(ent(h, wh)!), 'and the Good Whale beside it has lost its abilities');
});

test('CT-564: The Everywhere played in place by an effect arrives named', () => {
  const h = new Harness(148102);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const asked: string[] = [];
  withE(h, e => {
    playInline(e, {
      controller: A, sourceName: 'rig', region: e.homeRegion(A), targets: [], event: null,
      choose: (k: string) => { asked.push(k); return 'Curio Drifter'; },
    } as never, 'The Everywhere', 'k', A, { from: 'hand' });
  });
  assert.deepEqual(asked, ['k:named'], 'the one question is the naming');
  const ev = unitsOf(h, A).find(u => u.card === 'The Everywhere');
  assert.equal(ev?.named, 'Curio Drifter', 'the in-place body carries the name too');
});

/* ═══ §2 TIDERUNNER INITIATE — report #405 ══════════════════════════════ */

test('CT-564 CT-568 #405: Tiderunner Initiate played off Insidious Invitation is offered the open spots, and joins the line', () => {
  const h = new Harness(148103, ['Ben', 'Rashi']);
  const { A, wh } = inviteInto(h, 'Tiderunner Initiate', 'water', 1);
  const d = h.state.decision;
  assert.ok(d, 'THE REPORT: the play asks where it goes');
  assert.equal(d.kind, 'formationSlot');
  assert.equal(d.seat, A);
  assert.ok(d.options.some(o => o.label === 'stay out of formation'), 'the text says "may": staying out is offered');
  pick(h, { kind: 'behind', unit: wh });
  drain(h);
  const tr = unitsOf(h, A).find(u => u.card === 'Tiderunner Initiate');
  assert.ok(tr, 'it arrived');
  assert.deepEqual(h.state.battle!.columns[0], [wh, tr.id], 'in the line, behind the whale');
});

test('CT-564: Tiderunner Initiate off Insidious Invitation may stay out of the formation', () => {
  const h = new Harness(148104, ['Ben', 'Rashi']);
  const { A } = inviteInto(h, 'Tiderunner Initiate', 'water', 1);
  decide(h, l => l === 'stay out of formation');
  drain(h);
  const tr = unitsOf(h, A).find(u => u.card === 'Tiderunner Initiate');
  assert.ok(tr, 'it arrived');
  assert.equal(new E(h.state).columnOf(tr.id), null, 'and is in no column');
});

/* ═══ §3 TRENCH STALKER off TIDES OF THE COSMOS ═════════════════════════ */

test('CT-564: Trench Stalker played off Tides of the Cosmos is offered the open spots', () => {
  const h = new Harness(148105, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const wh = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'water', 11);
  toNextBattle(h, A);
  h.state.sharedDeck = [
    'Trench Stalker', 'Curio Drifter', 'Good Whale', 'Jelly', 'Ignis Sprite',
    'Dune Drifter', 'Whispering Mantid', 'Lonely Forager', 'Rune Channeler', 'Rune Channeler',
  ];
  h.state.players[A]!.hand = ['Tides of the Cosmos', 'Jelly', 'Curio Drifter'];
  h.state.players[1 - A]!.hand = [];
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  h.do({ type: 'playCard', seat: A, handIndex: 0 });
  pass(h);
  decide(h, l => l.startsWith('Trench Stalker'));
  decide(h, l => l === 'Done');
  const d = h.state.decision;
  assert.ok(d, 'the play asks where it goes');
  assert.equal(d.kind, 'formationSlot');
  pick(h, { kind: 'behind', unit: wh });
  // "[Discard two cards]" — its own cost, still paid
  for (let i = 0; i < 2 && h.state.decision?.kind !== 'formationSlot' && h.state.decision; i++) {
    h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  }
  drain(h);
  const ts = unitsOf(h, A).find(u => u.card === 'Trench Stalker');
  assert.ok(ts, 'it arrived');
  assert.deepEqual(h.state.battle!.columns[0], [wh, ts.id], 'in the line, behind the whale');
});

/* ═══ §4 THE SWEEP ═══════════════════════════════════════════════════════
 *
 * Why nothing caught it: the inline declaration was written as its own list of
 * questions, and nothing compared it with the cast window's. This does. Every
 * stage `E.collectTargets` runs for a play from hand is named here with how
 * the inline path answers it; a new stage fails until someone says.
 */

function body(src: string, head: RegExp): string {
  const m = head.exec(src);
  assert.ok(m, `found ${head}`);
  let i = src.indexOf('{', m.index + m[0].length - 1), depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

/** stage → the text in `declareInlinePlay` that asks it, or why it is not a
 * question of a card being played by an effect, or the open ticket for it */
const STAGES: Record<string, { inline: string } | { notACardPlay: string } | { gap: string }> = {
  gateCompoundCost: { notACardPlay: 'CR 111.6a: a compound ACTIVATION cost — abilities, not cards' },
  gateGraftCosts: { notACardPlay: 'CR 722.6a: a graft composite — a modded spell, which an inline play never carries' },
  collectX: { gap: 'CT-571' },
  collectCastCosts: { inline: 'collectInlineCastCosts' },
  collectModular: { gap: 'CT-571' },
  collectPartTargets: { inline: 'collectInlineTargets' },
  collectModes: { inline: 'inlineMode(' },
  collectFormationSpot: { inline: 'def.playsIntoFormation' },
  payActivationCost: { notACardPlay: 'CR 705.3d: an activated ability\'s cost' },
  collectItemCosts: { notACardPlay: 'CR 705.3: an activated ability\'s cost' },
  collectAsPlayedNaming: { inline: 'namesAsPlayed' },
  collectAsYouPlay: { gap: 'CT-571' },
};

test('CT-564: every stage of the cast window is answered on the inline-play path, or names its ticket', () => {
  const engine = readFileSync(join(SRC, 'engine.ts'), 'utf8');
  const water = readFileSync(join(SRC, 'cards/sets/batch-water-a.ts'), 'utf8');
  const stages = [...body(engine, /\n  collectTargets\(item: StackItem[^)]*\): void \{/).matchAll(/this\.((?:collect|gate|pay)\w+)\(/g)]
    .map(m => m[1]!);
  assert.ok(stages.length >= 10, `read the cast window (${stages.join(', ')})`);
  const declare = body(water, /const declareInlinePlay = \([^]*?\): StackItem => \{/);
  for (const s of new Set(stages)) {
    const how = STAGES[s];
    assert.ok(how, `the cast window runs ${s}: say how a card played by an effect answers it`);
    if ('inline' in how) assert.ok(declare.includes(how.inline), `${s}: declareInlinePlay asks it (${how.inline})`);
  }
  for (const s of Object.keys(STAGES)) assert.ok(stages.includes(s), `${s} is no longer a cast-window stage: drop it here`);
});

test('CT-564: every card printing its own play-time question asks it when Insidious Invitation plays it', () => {
  const subjects = allCardNames().filter(n => {
    const c = getCard(n);
    return c.kind === 'unit' && (c.namesAsPlayed || c.playsIntoFormation);
  });
  assert.ok(subjects.includes('The Everywhere') && subjects.includes('Tiderunner Initiate')
    && subjects.includes('Trench Stalker'), `the subjects are derived (${subjects.join(', ')})`);
  for (const [i, name] of subjects.entries()) {
    const h = new Harness(148150 + i, ['Ben', 'Rashi']);
    toDeployment(h);
    const A = h.state.initiative as Seat;
    const wh = spawn(h, A, 'Good Whale');
    for (const el of ['water', 'light', 'dark', 'fire', 'earth'] as const) giveResources(h, A, el, 4);
    toNextBattle(h, A);
    h.state.players[A]!.hand = ['Insidious Invitation', name, 'Jelly', 'Jelly'];
    h.state.players[1 - A]!.hand = [];
    h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
    h.do({ type: 'playCard', seat: A, handIndex: 0 });
    pass(h);
    decide(h, l => l === name);
    const asked: string[] = [];
    for (let g = 0; g < 8 && h.state.decision; g++) {
      const d = h.state.decision;
      asked.push(d.kind === 'formationSlot' ? 'spot' : d.prompt);
      h.do({ type: 'decide', seat: d.seat, choice: 0 });
    }
    const c = getCard(name);
    if (c.playsIntoFormation) assert.ok(asked.includes('spot'), `${name}: asked for its spot (asked: ${asked.join(' / ')})`);
    if (c.namesAsPlayed) assert.ok(asked.includes(c.namesAsPlayed.prompt), `${name}: asked to name (asked: ${asked.join(' / ')})`);
  }
});
