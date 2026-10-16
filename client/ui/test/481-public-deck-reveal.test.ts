/* CT-302 / report #219 — A CARD THAT REVEALS THE DECK, SHOWN AS CARDS.
 *
 * The report: Tides of the Cosmos ("Reveal the top eight cards of the deck.
 * Choose up to two of them with total cost 8 or less. You may play them now,
 * for free. Recycle the rest.") resolved for one seat, and the other seat was
 * shown the eight as ONE LINE OF PROSE in the log and nothing else. The names
 * did reach that seat (the line was never private); what was missing is the
 * surface. The only opponent-facing reveal widget, `ui/reveal.ts::glimpseNotice`,
 * keyed on the `glimpsed` event, and only the Glimpse keyword (`E.glimpse`)
 * emits that. Big Glimpse Card ("Reveal the top 7 cards of the deck. Target
 * opponent splits them into two piles. Cache one pile.") is the same gap the
 * other way round: the OPPONENT splits with seven scans in front of them, and
 * the CASTER — who then picks a pile — had only the log line.
 *
 * The fix: those cards emit a typed public `revealed` event
 * `{ seat, n, cards, source, chooser? }` with the log line they always printed,
 * and the notice draws it for every seat except the `chooser` (whose decision
 * already shows the scans).
 *
 * Everything below reads the reveal the way the wire does — `visibleToSeat`
 * and `redactEvent`, the two filters `server/main.ts::sendUpdate` applies —
 * and every event comes out of the real card through the real engine; none is
 * hand-built.
 *
 *   §1  Tides of the Cosmos for one seat: the OTHER seat's notice holds all 8.
 *   §2  Big Glimpse Card: the CASTER's notice holds all 7; the splitter's none.
 *   §3  the class, derived from the printed text: every card that reveals
 *       cards off a deck without the Glimpse keyword emits the typed event.
 *   §4  the hidden-step hold is the glimpse's: no runner names either type.
 *
 * Seeds 48100-48199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../engine/src/cards/registry.ts';
import { allCardNames, getCard, type EffectCtx } from '../../engine/src/cards/dsl.ts';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { glimpseHeadline, glimpseNotice } from '../reveal.ts';
import { redactEvent, redactLog, visibleToSeat } from '../../server/view.ts';
import type { CardName, EngineEvent, Seat } from '../../engine/src/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAMES: string[] = ['Player 1', 'Player 2'];

/** what `sendUpdate` ships to `seat` out of one batch of events */
const wireTo = (batch: readonly EngineEvent[], seat: Seat): EngineEvent[] =>
  batch.filter(e => visibleToSeat(e, seat)).map(e => redactEvent(e, seat, NAMES));

/** answer the pending decision by label */
function decide(h: Harness, match: (label: string) => boolean): void {
  const dec = h.state.decision!;
  const idx = dec.options.findIndex(o => match(o.label));
  assert.notEqual(idx, -1, `no option matching in [${dec.options.map(o => o.label)}]`);
  h.do({ type: 'decide', seat: dec.seat, choice: idx });
}

/** a battle with D holding priority after A attacked, D able to pay `res` */
function battleFor(seed: number, res: [string, number][]): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  for (const [k, n] of res) giveResources(h, D, k as never, n);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  assert.equal(h.state.priority, D, 'rig: the defender holds priority');
  return { h, A, D };
}

// ════════════════════════════════════════════════════════════════════════
// §1 — Tides of the Cosmos
// ════════════════════════════════════════════════════════════════════════

test('Tides of the Cosmos for one seat shows the other seat all 8 cards in the notice', () => {
  const { h, A, D } = battleFor(48101, [['water', 11]]);
  const eight = [
    'Tidal Menace', 'Curio Drifter', 'Good Whale', 'Jelly', 'Ignis Sprite',
    'Dune Drifter', 'Whispering Mantid', 'Lonely Forager',
  ] as CardName[];
  h.q.deckOf(D).unshift(...eight);
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tides of the Cosmos') });
  pass(h); pass(h);                                    // resolve -> the first pick
  assert.equal(h.state.decision?.seat, D, 'the caster is asked to pick');
  decide(h, l => l === 'Done');
  const batch = h.events.slice(mark);

  const typed = batch.filter(e => e.type === 'revealed');
  assert.equal(typed.length, 1, 'one typed reveal for the whole resolution — not one per re-run');
  assert.equal(typed[0]!.msg, `Tides of the Cosmos reveals: ${eight.join(', ')}.`,
    'the log line is the one the card always printed');
  assert.ok(!batch.some(e => e.type === 'info' && e.msg.startsWith('Tides of the Cosmos reveals')),
    'and it is not ALSO printed as info (it would read twice)');

  const seen = glimpseNotice(wireTo(batch, A), A);
  assert.ok(seen, 'the other seat gets a notice');
  assert.deepEqual(seen!.cards, eight, 'holding all eight cards, in revealed order');
  assert.equal(seen!.seat, D, 'off the caster deck');
  assert.equal(seen!.source, 'Tides of the Cosmos', 'and naming the card that revealed them');
  assert.equal(glimpseHeadline(seen!, NAMES[D]!, A), `${NAMES[D]} revealed 8 — Tides of the Cosmos`);
  assert.equal(glimpseNotice(wireTo(batch, D), D), null,
    'the caster is not popped a second copy: the pick already showed them the eight');
  assert.ok(redactLog(h.events, A, NAMES).includes(typed[0]!.msg),
    'a full log resync still carries the line to the other seat');
});

test('Tides of the Cosmos with nothing it may play shows the caster the cards too', () => {
  // the first pick is not asked at all when no revealed card fits the budget,
  // so the caster has no modal — the notice is then theirs as well
  const { h, A, D } = battleFor(48102, [['water', 11]]);
  const big = allCardNames().filter(n => typeof getCard(n).mana === 'number' && (getCard(n).mana as number) > 8
    && getCard(n).kind === 'unit');
  assert.ok(big.length >= 1, `rig: a unit costing more than 8 exists (${big.length})`);
  const deck = h.q.deckOf(D);
  deck.splice(0, deck.length, ...Array<CardName>(10).fill(big[0]!));
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tides of the Cosmos') });
  pass(h); pass(h);
  assert.ok(!h.state.decision || h.state.decision.seat !== D || !/Tides/.test(h.state.decision.prompt),
    'no pick is asked: nothing fits the budget');
  const batch = h.events.slice(mark);
  for (const seat of [A, D]) {
    const seen = glimpseNotice(wireTo(batch, seat), seat);
    assert.equal(seen?.cards.length, 8, `seat ${seat} is shown the eight`);
  }
});

// ════════════════════════════════════════════════════════════════════════
// §2 — Big Glimpse Card
// ════════════════════════════════════════════════════════════════════════

test('Big Glimpse Card shows the caster all 7 in the notice while the opponent splits', () => {
  const { h, A, D } = battleFor(48103, [['light', 3], ['water', 3]]);
  const seven = ['Gublin', 'Shib', 'Chombot', 'Uglk', 'Bloppert', 'Zephyrzoa', 'Mindburn'] as CardName[];
  h.q.deckOf(D).unshift(...seven);
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Big Glimpse Card') });
  pick(h, { player: A });                              // target opponent
  pass(h); pass(h);                                    // resolve -> the split
  const split = h.state.decision!;
  assert.equal(split.seat, A, 'the opponent splits');
  assert.deepEqual(split.options.filter(o => o.card).map(o => o.card), seven,
    'and their split question already shows the seven as cards');
  const batch = h.events.slice(mark);

  const typed = batch.filter(e => e.type === 'revealed');
  assert.equal(typed.length, 1, 'one typed reveal');
  assert.equal(typed[0]!.msg, `Big Glimpse Card reveals: ${seven.join(', ')}.`, 'the unchanged line');

  const mine = glimpseNotice(wireTo(batch, D), D);
  assert.ok(mine, 'the CASTER gets a notice');
  assert.deepEqual(mine!.cards, seven, 'holding all seven');
  assert.equal(mine!.source, 'Big Glimpse Card');
  assert.equal(glimpseHeadline(mine!, NAMES[D]!, D), 'You revealed 7 — Big Glimpse Card',
    'their own deck reads as theirs');
  assert.equal(glimpseNotice(wireTo(batch, A), A), null,
    'the splitter is not popped a copy of the scans they are choosing from');
});

// ════════════════════════════════════════════════════════════════════════
// §3 — the class, from the printed text
// ════════════════════════════════════════════════════════════════════════

/** "reveal(s) … deck" in one sentence: a reveal of DECK cards (a "reveals
 * their hand" names no deck, and a "look at" is private and never matches) */
const DECK_REVEAL = /\breveals?\b[^.]*\bdeck\b/i;
/** the Glimpse keyword (the claims.ts spelling): those reveal through
 * E.glimpse and its `glimpsed` event, which the notice already drew
 * (159-glimpse-reveal-visibility owns them) */
const GLIMPSE_KEYWORD = /\bglimpses?\s+(\d+|x)\b/i;
const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

test('every card that reveals deck cards without the Glimpse keyword emits the typed reveal', () => {
  const textOf = (n: string): string => getCard(n).text ?? '';
  const revealers = allCardNames().filter(n => DECK_REVEAL.test(textOf(n)));
  const glimpsers = revealers.filter(n => GLIMPSE_KEYWORD.test(textOf(n)));
  const raw = revealers.filter(n => !GLIMPSE_KEYWORD.test(textOf(n)));
  // positive controls: the derivation sees both families, and the two named cards
  assert.ok(glimpsers.length >= 5, `the Glimpse family is matched and set aside (${glimpsers.join(', ')})`);
  for (const n of ['Tides of the Cosmos', 'Big Glimpse Card']) {
    assert.ok(raw.includes(n), `${n} is derived as a raw deck reveal (got ${raw.join(', ')})`);
  }
  assert.ok(!revealers.includes('Bioremediation'), 'a hand reveal is not a deck reveal');

  for (const [k, name] of raw.entries()) {
    const m = /reveal the top (\w+) cards?/i.exec(textOf(name));
    assert.ok(m, `${name}: the sweep reads "reveal the top N cards" — extend it for "${textOf(name)}"`);
    const n = WORDS[m![1]!.toLowerCase()] ?? Number(m![1]);
    assert.ok(Number.isInteger(n) && n > 0, `${name}: a count was read (${m![1]})`);
    const def = getCard(name).spellEffect;
    assert.ok(def, `${name}: this sweep resolves a spell effect — extend the rig for this card`);

    const h = new Harness(48110 + k);
    toDeployment(h);
    const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
    const g = new E(h.state);
    const region = g.homeRegion(A);
    const ps = g.s.regions[region]!.presentSeats;
    if (!ps.includes(D)) ps.push(D);                   // an opponent to split, if asked
    const top = g.deckOf(A).slice(0, n);
    assert.equal(top.length, n, `${name}: rig: the deck holds ${n}`);
    const before = g.events.length;
    // decline whatever is asked: the reveal comes first and is what is measured
    const choose: EffectCtx['choose'] = (_key, dec) => {
      const out = dec.options.find(o => o.value === -1 || o.value === false || o.value === 'Done');
      return (out ?? dec.options[0]!).value;
    };
    def!.run(g, {
      sourceName: name, controller: A, region, targets: [], event: null, choose,
    } as unknown as EffectCtx);
    const typed = g.events.slice(before).filter(e => e.type === 'revealed');
    assert.equal(typed.length, 1, `${name}: emits one typed 'revealed' event`);
    const d = typed[0]!.data ?? {};
    assert.deepEqual(d['cards'], top, `${name}: carrying the top ${n}, in order`);
    assert.equal(d['seat'], A, `${name}: off the controller deck`);
    assert.equal(d['source'], name, `${name}: naming itself as the source`);
    assert.ok(visibleToSeat(typed[0]!, D), `${name}: and it is public`);
    assert.ok(glimpseNotice([typed[0]!], d['chooser'] === D ? A : D),
      `${name}: the seat that is not choosing gets a notice`);
  }
});

// ════════════════════════════════════════════════════════════════════════
// §4 — the hidden-step hold is the glimpse's
// ════════════════════════════════════════════════════════════════════════

test('no hidden-step runner treats a glimpse or a reveal specially', () => {
  // CR D6.2: inside a hidden step a glimpse is held for the recap like every
  // other event — the runners hold an action's events WHOLE, by no type. So a
  // `revealed` is deferred exactly as a `glimpsed` is, as long as no runner
  // learns either name. 203-reveal-waits-for-the-barrier drives the hold.
  const runners = [
    ['server', 'rooms.ts'], ['server', 'main.ts'], ['server', 'seatmsg.ts'],
    ['ui', 'solo.ts'], ['ui', 'replayserver.ts'],
  ];
  for (const [dir, f] of runners) {
    const src = readFileSync(join(HERE, '..', '..', dir!, f!), 'utf8');
    assert.ok(src.length > 1000, `positive control: ${dir}/${f} was read`);
    assert.equal(/'(glimpsed|revealed)'/.test(src), false,
      `${dir}/${f} names a reveal event type — a per-type hold or exemption would let it out early`);
  }
});
