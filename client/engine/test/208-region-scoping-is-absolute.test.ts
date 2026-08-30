/**
 * R239 — REGION SCOPING IS ABSOLUTE. THERE IS NO "THE OTHER SEAT".
 *
 * ── THE RULING (owner, 2026-08-28), verbatim
 *
 *   "No. Only players that are in the region as an effect can even see that it
 *    exists. So anything that happens in a region where a player or unit
 *    currently isn't is 100% ignored, as if that effect didn't exist."
 *
 * He was asked whether a region-scoped effect can reach a player who is not in
 * the region. The answer is not "prefer the region and fall back": an effect in
 * a region you are not in DOES NOT EXIST for you.
 *
 * ── THE DEFECT
 *
 * Three cards named an OPPONENT instead of looping over "each opponent", and
 * all three produced that opponent by ARITHMETIC when the region could not
 * supply one:
 *
 *   Uglk              `presentSeats(…).find(s => s !== seat) ?? (1 - seat)`
 *   Big Glimpse Card  `presentSeats(…).find(s => s !== ctl) ?? (1 - ctl)`
 *   Rebalance         `const to = (1 - seat) as Seat`   ← never asked at all
 *
 * The `??` arm handed a bin unit to, and demanded a seven-card split from, a
 * player R25 says is not there. Rebalance's was worse: it never consulted the
 * region on any board. Every other region-scoped card in the pool already did
 * the right thing (R187/CT-70 walked them into announcing it), so the repair
 * is to bring these three INTO LINE with the pool — not to spread the fallback.
 *
 * ⚠ THE QUESTION SHEET GUESSED THIS BACKWARDS. Round-29's sheet suspected "these
 * two are right and everyone else is over-narrow." The owner ruled the opposite,
 * and the sheet's own count (two) was short by one — Rebalance was invisible to
 * a grep for `??` because it carried no fallback, only a hard-coded complement.
 * That is why §3 below is a SWEEP over source and not a list of card names.
 *
 * ── WHAT THIS FILE ASSERTS
 *
 *   §1  each repaired card does NOTHING, and SAYS SO, in a region holding no
 *       opponent — and is never asked to make a decision it cannot honour;
 *   §2  each repaired card still works NORMALLY with an opponent present. A
 *       "does nothing" test alone is passed by a card that has been broken;
 *   §3  the CLASS: no card-behaviour file may derive a seat by complementing
 *       another one. Derived from the source tree, with positive controls, so
 *       a NEW card reintroducing the shape reddens this file.
 *
 * ── ITS NEIGHBOURS
 *
 * `158-silent-region-branches` owns the thirteen "each opponent over an empty
 * region" cards — same ruling, but those never reached anybody; they only went
 * quiet. These three REACHED. The three are added to 158's family so the
 * whole-pool silence nets watch them too.
 *
 * ── STILL OPEN, DELIBERATELY NOT BUILT HERE (reported, R239 report)
 *
 * The ruling says "can even SEE that it exists". The event/log layer has no
 * region dimension at all: `server/view.ts::visibleToSeat` gates only on
 * `data.privateTo`, and `E.ev` does not stamp a region. So a player outside the
 * region still reads every log line the effect emits. That is the seat-redaction
 * layer (two shipped information leaks live in its history, R202) and it is not
 * a change to make on a card agent's reading of one sentence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/cards/registry.ts';
import { getCard, type EffectCtx, type EffectDef } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { toDeployment } from './util.ts';
import type { CardName, EngineEvent, Seat } from '../src/types.ts';

// ── the rig ─────────────────────────────────────────────────────────────

interface Board { g: E; h: Harness; A: Seat; D: Seat; region: number }

/**
 * A real game walked to deployment. `region` is A's HOME region, which out of
 * battle lists only its owner — precisely the R25 situation the ruling is
 * about. D is alive elsewhere with a hand, a bin and his life total intact, so
 * a no-op here can never be blamed on an empty board.
 */
function board(seed: number): Board {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = (1 - A) as Seat;
  const g = new E(h.state);
  return { g, h, A, D, region: g.homeRegion(A) };
}

/** put a seat into a region, the way E.giveControl does when a unit defects */
function present(g: E, region: number, seat: Seat): void {
  const ps = g.s.regions[region]!.presentSeats;
  if (!ps.includes(seat)) ps.push(seat);
}

/**
 * The precondition, as an assertion. If the rig ever stopped producing "a
 * region holding nobody but the controller", every §1 test would pass for the
 * wrong reason.
 */
function assertAlone(b: Board, card: string): void {
  assert.deepEqual(b.g.s.regions[b.region]!.presentSeats.filter(s => s !== b.A), [],
    `${card}: this test needs a region holding NOBODY but its controller (R25). With an `
    + 'opponent present the payload runs and the test proves nothing.');
}

/** everything a region-scoped effect could move, as one comparable string. */
function snapshot(g: E): string {
  return JSON.stringify({
    players: g.s.players.map(p => ({
      life: p.life, rot: p.rot ?? 0, hand: p.hand, bin: p.bin,
      cache: (p.cache ?? []).map(c => c.card), deck: g.deckOf(p.seat).length,
    })),
    entities: Object.values(g.s.entities)
      .map(e => `${e.id}:${e.card}:${e.controller}:${e.owner}:${e.region}`).sort(),
  });
}

/**
 * Resolve one EffectDef in A's home region. `choose` THROWS: an effect that
 * cannot reach anybody must not put a question to anybody either, and a
 * question asked here would otherwise be silently auto-answered.
 */
function resolveAlone(
  def: EffectDef, b: Board, ctx: Partial<EffectCtx> = {},
): EngineEvent[] {
  const before = b.g.events.length;
  def.run(b.g, {
    sourceName: 'test',
    controller: b.A,
    region: b.region,
    targets: [],
    event: null,
    choose: (key, dec) => {
      throw new Error(`asked "${key}" (${dec.prompt}) of ${b.g.pname(dec.seat)} — an effect `
        + 'that R239 says does not exist for anybody here must not prompt anybody here');
    },
    ...ctx,
  } as EffectCtx);
  return b.g.events.slice(before);
}

/** the point of the whole family: the player was TOLD. (Never the prose.) */
function assertSpoke(evs: EngineEvent[], card: string, clause: string): void {
  assert.ok(evs.length > 0,
    `${card}: "${clause}" resolved in a region holding no opponent (R25/R239) and emitted `
    + 'NOTHING. "Nothing happened" is a legitimate outcome; not SAYING so never is.');
  assert.ok(evs.some(e => e.msg.length > 0),
    `${card}: "${clause}" emitted ${evs.length} event(s) and not one carries a message, so `
    + 'nothing reaches the log and the player still cannot tell a rule from a bug');
}

const spellOf = (card: string): EffectDef => getCard(card as CardName).spellEffect!;
const augmentOf = (card: string, i = 0): EffectDef =>
  getCard(card as CardName).augmentText![i]!.effect;

// ════════════════════════════════════════════════════════════════════════
// §1 — WITH NO OPPONENT IN THE REGION, THE EFFECT DOES NOT EXIST
// ════════════════════════════════════════════════════════════════════════

test('Uglk — no opponent in the region: nobody is asked, no bin moves, and it says so', () => {
  const b = board(2081);
  assertAlone(b, 'Uglk');
  b.g.player(b.A).bin.push('Tidal Menace');
  b.g.player(b.D).bin.push('The Foretold');
  assert.ok(b.g.player(b.A).bin.length > 0 && b.g.player(b.D).bin.length > 0,
    'Uglk: both bins HOLD a unit, so a no-op here is R239 and not an empty bin — the '
    + 'empty-bin branch already announced itself and is not what this test is about');
  const before = snapshot(b.g);
  const evs = resolveAlone(augmentOf('Uglk'), b, {
    sourceName: 'Uglk', event: { type: 'afterCombat', msg: '', data: {} },
  });
  assertSpoke(evs, 'Uglk',
    "each player puts a unit from their bin into play under an opponent's control");
  assert.equal(snapshot(b.g), before,
    'Uglk: "under an opponent\'s control" used to read `… ?? (1 - seat)` and revived a bin '
    + 'unit under a seat that is not in the region. R239: an effect in a region you are not '
    + 'in does not exist for you — nothing may leave a bin and nothing may enter play.');
});

test('Big Glimpse Card — no opponent in the region: the seven are not even revealed, and it says so', () => {
  const b = board(2082);
  assertAlone(b, 'Big Glimpse Card');
  const deck = b.g.deckOf(b.A);
  assert.ok(deck.length >= 7,
    'Big Glimpse Card: there ARE seven cards to reveal, so a no-op here is R239 and not an '
    + 'empty deck — the empty-deck branch already announced itself');
  const top7 = deck.slice(0, 7);
  const before = snapshot(b.g);
  const evs = resolveAlone(spellOf('Big Glimpse Card'), b, { sourceName: 'Big Glimpse Card' });
  assertSpoke(evs, 'Big Glimpse Card', 'Target opponent splits them into two piles');
  assert.equal(snapshot(b.g), before,
    'Big Glimpse Card: it used to fall back to `1 - ctx.controller` and demand a seven-card '
    + 'split from a player who is not in the region (R239). Nothing may be cached or recycled.');
  assert.deepEqual(b.g.deckOf(b.A).slice(0, 7), top7,
    'Big Glimpse Card: the top of the deck is where it was — the reveal is part of the effect '
    + 'and the effect did not exist here');
  const names = new Set(top7);
  assert.ok(!evs.some(e => [...names].some(n => e.msg.includes(n))),
    'Big Glimpse Card: no card NAME may appear in the log. A reveal that happens anyway is '
    + 'the effect half-existing, which is exactly what "100% ignored" rules out.');
});

test('Rebalance — no opponent in the region: nobody is asked, no unit changes hands, and it says so', () => {
  const b = board(2083);
  assertAlone(b, 'Rebalance');
  b.g.spawnUnit(b.A, 'Tidal Menace' as CardName, b.region);
  b.g.settle();
  assert.ok(b.g.unitsOf(b.A, b.region).length > 0,
    'Rebalance: the controller HAS a unit here to give, so a no-op is R239 and not an empty '
    + 'board — the empty-board branch already announced itself');
  const before = snapshot(b.g);
  const evs = resolveAlone(spellOf('Rebalance'), b, { sourceName: 'Rebalance' });
  assertSpoke(evs, 'Rebalance', 'Each player gives an opponent control of one of their units');
  assert.equal(snapshot(b.g), before,
    'Rebalance: the recipient used to be `(1 - seat) as Seat`, which never asked the region '
    + 'at all — it handed a unit to a player who was not there. R239: with no opponent in '
    + 'the region there is no recipient and no control changes.');
});

// ════════════════════════════════════════════════════════════════════════
// §2 — AND ALL THREE STILL WORK WITH AN OPPONENT PRESENT
//
// The half that matters. A card broken into permanent silence passes §1.
// ════════════════════════════════════════════════════════════════════════

/** resolve with the opponent standing in the region, answering every prompt. */
function resolveTogether(
  def: EffectDef, b: Board, answers: Record<string, unknown>, ctx: Partial<EffectCtx> = {},
): { asks: string[]; evs: EngineEvent[] } {
  present(b.g, b.region, b.D);
  const asks: string[] = [];
  const before = b.g.events.length;
  def.run(b.g, {
    sourceName: 'test',
    controller: b.A,
    region: b.region,
    targets: [],
    event: null,
    choose: (key, dec) => {
      asks.push(key);
      if (!(key in answers)) {
        throw new Error(`unanswered choose "${key}" (${dec.prompt}) — options `
          + JSON.stringify(dec.options.map(o => o.label)));
      }
      return answers[key];
    },
    ...ctx,
  } as EffectCtx);
  return { asks, evs: b.g.events.slice(before) };
}

test('Uglk — with the opponent in the region, both bins still feed play under the OTHER seat', () => {
  const b = board(2084);
  b.g.player(b.A).bin.push('Tidal Menace');
  b.g.player(b.D).bin.push('The Foretold');
  resolveTogether(augmentOf('Uglk'), b, {}, {
    sourceName: 'Uglk', event: { type: 'afterCombat', msg: '', data: {} },
  });
  const mine = b.g.unitsIn(b.region).find(u => u.card === 'Tidal Menace');
  const theirs = b.g.unitsIn(b.region).find(u => u.card === 'The Foretold');
  assert.ok(mine && theirs, 'Uglk: both bin units entered play — the R239 guard must not eat '
    + 'the ordinary case, which is the whole card');
  assert.equal(mine.controller, b.D, "Uglk: A's card is controlled by the opponent PRESENT here");
  assert.equal(mine.owner, b.A, '…and is still A\'s card (R65/CT-17)');
  assert.equal(theirs.controller, b.A, "Uglk: D's card is controlled by A");
  assert.equal(theirs.owner, b.D, '…and is still D\'s card');
  assert.deepEqual([b.g.player(b.A).bin, b.g.player(b.D).bin], [[], []],
    'Uglk: both bins gave up their unit');
});

test('Big Glimpse Card — with the opponent in the region, the OPPONENT splits and the caster caches', () => {
  const b = board(2085);
  const seven = ['Gublin', 'Shib', 'Chombot', 'Uglk', 'Bloppert', 'Zephyrzoa', 'Mindburn'];
  const deck = b.g.deckOf(b.A);
  deck.unshift(...(seven as CardName[]));
  const deckBefore = deck.length;
  const { asks } = resolveTogether(spellOf('Big Glimpse Card'), b,
    { 'split:0': 0, 'split:1': 1, 'split:2': false, pile: 'a' },
    { sourceName: 'Big Glimpse Card' });
  assert.deepEqual(asks, ['split:0', 'split:1', 'split:2', 'pile'],
    'Big Glimpse Card: three split prompts and the pile prompt — the R239 guard must not '
    + 'short-circuit the ordinary case');
  assert.deepEqual((b.g.player(b.A).cache ?? []).map(c => c.card), ['Gublin', 'Shib'],
    'Big Glimpse Card: the chosen pile is cached');
  assert.equal(b.g.deckOf(b.A).length, deckBefore - 7 + 5,
    'Big Glimpse Card: all seven left the top and the other five were recycled');
});

test('Big Glimpse Card — a DECLARED target still splits: the engine only ever offers a present seat', () => {
  // R67: "target opponent" is declared at cast. R239 needs no second guard on
  // that arm — `E.pushPlayerTargets` builds the 'opponent' candidate list out
  // of `regions[region].presentSeats`, so a target the cast window offered is
  // by construction a seat that was in the region. This pins the DECLARED path
  // so that removing the fallback did not quietly break it.
  const b = board(2086);
  present(b.g, b.region, b.D);
  const seven = ['Gublin', 'Shib', 'Chombot', 'Uglk', 'Bloppert', 'Zephyrzoa', 'Mindburn'];
  b.g.deckOf(b.A).unshift(...(seven as CardName[]));
  const { asks } = resolveTogether(spellOf('Big Glimpse Card'), b,
    { 'split:0': 0, 'split:1': false, pile: 'a' },
    { sourceName: 'Big Glimpse Card', targets: [{ player: b.D }] });
  assert.deepEqual(asks, ['split:0', 'split:1', 'pile'],
    'Big Glimpse Card: the declared opponent still does the splitting');
  assert.deepEqual((b.g.player(b.A).cache ?? []).map(c => c.card), ['Gublin'],
    'Big Glimpse Card: and the caster still caches the pile he chose');
});

test('Rebalance — with the opponent in the region, control still changes both ways', () => {
  const b = board(2087);
  present(b.g, b.region, b.D);
  const mine = b.g.spawnUnit(b.A, 'Tidal Menace' as CardName, b.region);
  const theirs = b.g.spawnUnit(b.D, 'The Foretold' as CardName, b.region);
  b.g.settle();
  resolveTogether(spellOf('Rebalance'), b, {}, { sourceName: 'Rebalance' });
  assert.equal(b.g.entity(mine.id)!.controller, b.D,
    "Rebalance: A's only unit went to the opponent PRESENT in the region — the R239 guard "
    + 'must not eat the ordinary case');
  assert.equal(b.g.entity(theirs.id)!.controller, b.A,
    "Rebalance: and D's only unit came the other way");
});

// ════════════════════════════════════════════════════════════════════════
// §3 — THE CLASS: NO CARD MAY DERIVE A SEAT BY COMPLEMENTING ANOTHER
//
// The sheet said "two cards". A sweep said three, and found the third
// (Rebalance) in a different file, in a shape no grep for `??` could see.
// docs/13 §7.2: derive the list, never type it.
// ════════════════════════════════════════════════════════════════════════

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = path.join(HERE, '..', 'src', 'cards');

/** every .ts file under engine/src/cards, recursively. */
function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsFiles(p);
    return e.name.endsWith('.ts') ? [p] : [];
  }).sort();
}

/**
 * Line-by-line CODE view: comments and string/template literals removed, so
 * this file's own prose (`?? (1 - seat)` appears in three headers) and a card's
 * printed text (`-1/-1-countered units` reads as `1-c…`) cannot be convicted.
 * Line numbers are preserved.
 */
function codeLines(src: string): string[] {
  const out: string[] = [];
  let block = false;
  for (const raw of src.split('\n')) {
    let res = '';
    for (let i = 0; i < raw.length; i++) {
      if (block) { if (raw.startsWith('*/', i)) { block = false; i++; } continue; }
      if (raw.startsWith('/*', i)) { block = true; i++; continue; }
      if (raw.startsWith('//', i)) break;
      res += raw[i];
    }
    out.push(res.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, "''"));
  }
  return out;
}

/** `1 - x` / `1-x` — the only way to name "the other seat" without a region. */
const COMPLEMENT = /(?:^|[^\w.$])1\s*-\s*\(?\s*[A-Za-z_$][\w$.]*/;
/** a value import of engine.ts's `other()`, the same thing under a name. */
const OTHER_CALL = /(?:^|[^\w.$])other\s*\(/;
/** the region lookups a card uses to find who is here. */
const REGION_LOOKUP = /presentSeats|opponentsIn|presentOpponents/;

interface Hit { file: string; line: number; code: string; why: string }

/**
 * Convict a source file.
 *
 * A seat complement is a bug precisely when THERE IS A REGION TO ASK INSTEAD.
 * So the rule is scoped by what the enclosing declaration can see: a file that
 * registers cards always has `ctx.region` in hand and is convicted outright; a
 * shared helper is convicted only when a `region` is in its own signature or
 * body above the hit. (That is what keeps `helpers.ts::perSeatRows` — a pure,
 * region-less, UI-only X-preview row builder — out, without naming it.)
 */
function convict(file: string, src: string): Hit[] {
  const lines = codeLines(src);
  const registersCards = /^card\(/m.test(src);
  const hits: Hit[] = [];
  lines.forEach((code, i) => {
    // how much of the enclosing declaration this line can see
    let start = i;
    while (start > 0 && !/^(?:export\s+)?(?:const|let|function|async function|class)\b/.test(lines[start]!)) start--;
    const scope = lines.slice(start, i + 1).join('\n');
    const regionInScope = registersCards || /\bregion\b/.test(scope);
    if (COMPLEMENT.test(code) && regionInScope) {
      hits.push({ file, line: i + 1, code: code.trim(), why: 'seat complement `1 - x`' });
    }
    if (OTHER_CALL.test(code) && regionInScope) {
      hits.push({ file, line: i + 1, code: code.trim(), why: "engine's `other(seat)`" });
    }
    if (REGION_LOOKUP.test(code) && /\?\?|\|\|/.test(code)) {
      const rhs = code.split(/\?\?|\|\|/)[1]?.trim() ?? '';
      if (!rhs.startsWith('[]')) {
        hits.push({ file, line: i + 1, code: code.trim(), why: 'a fallback on a region lookup' });
      }
    }
  });
  return hits;
}

test('R239 §3 — no card effect derives an opponent from arithmetic instead of the region', () => {
  const files = tsFiles(CARDS_DIR);
  assert.ok(files.length >= 25,
    `the sweep found only ${files.length} source file(s) under ${CARDS_DIR}. A sweep over an `
    + 'empty subject set passes forever and looks identical to one that works (docs/13 §5).');
  const behaviour = files.filter(f => /^card\(/m.test(fs.readFileSync(f, 'utf8')));
  assert.ok(behaviour.length >= 25,
    `only ${behaviour.length} of them register any card behaviour — the sweep has gone blind `
    + 'to the batch files, which is where every card in the pool lives');
  for (const repaired of ['batch-hybrids-ld-a.ts', 'batch-wood-c.ts']) {
    assert.ok(behaviour.some(f => f.endsWith(repaired)),
      `${repaired} — a file R239 actually repaired — is not in the swept set, so a regression `
      + 'in the very code this test exists for would go unseen');
  }

  const hits = files.flatMap(f => convict(path.relative(CARDS_DIR, f), fs.readFileSync(f, 'utf8')));
  assert.deepEqual(hits.map(h => `${h.file}:${h.line}  ${h.why}\n      ${h.code}`), [],
    'R239 (owner, 2026-08-28): "Only players that are in the region as an effect can even see '
    + 'that it exists. So anything that happens in a region where a player or unit currently '
    + "isn't is 100% ignored, as if that effect didn't exist.\"\n\n"
    + 'A card effect may name its opponent ONLY by asking the region who is present. There is '
    + 'no fallback to the other seat, and no `1 - seat`: with nobody there, announce it and '
    + 'return. Uglk, Big Glimpse Card and Rebalance all did this and all three were repaired; '
    + 'the line(s) above are a fourth.');
});

test('R239 §3 — the sweep convicts a deliberately reintroduced fallback (positive control)', () => {
  // docs/13 §7.4: a checker with no subjects is indistinguishable from a
  // working one. These are the THREE REAL PRE-FIX LINES, verbatim, plus the
  // two other ways the same seat could be conjured.
  const cases: [string, string, string][] = [
    ['Uglk, as shipped', 'batch.ts',
      "card('X', {});\nconst f = (g, ctx) => {\n"
      + '  const opp = presentSeats(g, ctx.region).find(s => s !== seat) ?? (1 - seat);\n};'],
    ['Big Glimpse Card, as shipped', 'batch.ts',
      "card('X', {});\nconst f = (g, ctx) => {\n"
      + '  const opp = presentSeats(g, ctx.region).find(s => s !== ctx.controller) ?? (1 - ctx.controller);\n};'],
    ['Rebalance, as shipped', 'batch.ts',
      "card('X', {});\nconst f = (g, ctx) => {\n  const to = (1 - seat) as Seat;\n};"],
    ['the same thing via engine.ts::other', 'batch.ts',
      "card('X', {});\nconst f = (g, ctx) => {\n"
      + '  const opp = presentSeats(g, ctx.region).find(s => s !== seat) ?? other(seat);\n};'],
    ['the same thing in a shared helper that HAS a region', 'helpers.ts',
      'export const oppIn = (g, region, seat) =>\n'
      + '  g.s.regions[region].presentSeats.find(s => s !== seat) ?? (1 - seat);'],
  ];
  for (const [label, file, src] of cases) {
    assert.ok(convict(file, src).length > 0,
      `the sweep did NOT convict ${label}:\n${src}\nA guard that cannot see the exact defect `
      + 'it was written for is worse than no guard, because it reports sight it does not have.');
  }
});

test('R239 §3 — the sweep acquits the repaired shape and the region-less UI helper (negative control)', () => {
  // The other half of §7.4: a checker that convicts everything is switched off
  // within a round. These must all come back CLEAN.
  const clean: [string, string, string][] = [
    ['the repaired shape', 'batch.ts',
      "card('X', {});\nconst f = (g, ctx) => {\n"
      + '  const here = presentSeats(g, ctx.region);\n'
      + '  const opp = here.find(s => s !== ctx.controller);\n'
      + "  if (opp === undefined) { g.ev('info', 'nobody here'); return; }\n};"],
    ['an empty-region guard falling back to []', 'batch.ts',
      "card('X', {});\nconst f = (g, region) =>\n"
      + '  [...(g.s.regions[region]?.presentSeats ?? [])];'],
    ['a region-less UI preview builder', 'helpers.ts',
      'export const perSeatRows = (g, seat, f) =>\n'
      + '  ([seat, (1 - seat) as Seat]).map(s => ({ label: s, x: f(s) }));'],
    ['printed text that merely LOOKS like a complement', 'batch.ts',
      "card('X', {});\n"
      + "const t = { what: 'opponent', prompt: 'X: target opponent takes your -1/-1-countered units' };"],
    ['a comment quoting the defect it repaired', 'batch.ts',
      "card('X', {});\n// this used to read `?? (1 - seat)` before R239\n/* and `other(seat)` too */"],
  ];
  for (const [label, file, src] of clean) {
    assert.deepEqual(convict(file, src).map(h => `${h.why}: ${h.code}`), [],
      `the sweep FALSE-POSITIVED on ${label}. A guard that fires on legitimate work gets `
      + 'switched off within a round, and then the real case walks through (R202\'s lesson).');
  }
});

// ════════════════════════════════════════════════════════════════════════
// §4 — THE THREE ARE PART OF THE R25 FAMILY, NOT A SIDECAR
// ════════════════════════════════════════════════════════════════════════

test('R239 — the three repaired cards announce the same way 158\'s thirteen do', () => {
  // 158-silent-region-branches owns "each opponent over an empty region". The
  // R239 three are the same ruling with a different failure — they REACHED
  // rather than going quiet — and their repair leaves them in exactly 158's
  // shape. Asserted here so the two files cannot drift into two different
  // answers to one ruling.
  const three: [string, EffectDef, Partial<EffectCtx>][] = [
    ['Uglk', augmentOf('Uglk'), { event: { type: 'afterCombat', msg: '', data: {} } }],
    ['Big Glimpse Card', spellOf('Big Glimpse Card'), {}],
    ['Rebalance', spellOf('Rebalance'), {}],
  ];
  for (const [card, def, extra] of three) {
    const b = board(2090);
    assertAlone(b, card);
    b.g.player(b.A).bin.push('Tidal Menace');
    b.g.spawnUnit(b.A, 'Tidal Menace' as CardName, b.region);
    b.g.settle();
    const before = snapshot(b.g);
    const evs = resolveAlone(def, b, { sourceName: card, ...extra });
    assertSpoke(evs, card, 'the R239 clause');
    assert.equal(snapshot(b.g), before, `${card}: and the board did not move`);
  }
});
