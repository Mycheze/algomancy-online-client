/* R263 — WHERE A MID-RESOLUTION PLAY CAME FROM.
 *
 * The owner, answering round-32 Q3 (verbatim): *"I've answered this before.
 * Those cards are still cast. It matters WHERE they come from. If the card
 * originates in the hand, it's played from the hand. If it originates from the
 * cache or bin or somewhere else, it's not played from the hand."*
 *
 * `playInline` (batch-water-a) is the shared helper for a card played during
 * another card's resolution. Under R198 that play reaches the stack properly,
 * but it carried NO R49 `from` marker at all — so Proph and Stalwart Sentinel,
 * which print *"when you play a card from anywhere other than your hand"*,
 * read a blank and fired for NOBODY. Not "from hand" (a correct silence) and
 * not "from elsewhere" (a correct fire): neither.
 *
 * Three cards call it, and the ruling splits them two ways:
 *   · Hooba-Pon          "play a unit FROM YOUR HAND"        → 'hand', silence
 *   · Insidious Invitation "players may play a unit FROM HAND" → 'hand', silence
 *   · Tides of the Cosmos "reveal the top eight … play them"  → 'deck', FIRE
 * The third is the "somewhere else" the ruling reaches without naming: those
 * eight cards were revealed off the top of the deck and were never in a hand.
 *
 * ⚠ THE SUBJECT SET IS DERIVED, NOT TYPED OUT. §1 finds every mid-resolution
 * play by scanning the card sources for the helper itself, and fails if a
 * fourth caller appears without answering the question. The primary guard is
 * stronger still and is the compiler: `InlinePlayOpts.from` is a REQUIRED
 * field of a REQUIRED parameter, so a fourth caller cannot be written at all
 * without naming its zone. §1 is what keeps that true if someone re-adds a
 * default.
 *
 * Seeds 24100-24199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { playInline } from '../src/cards/sets/batch-water-a.ts';
import type { EngineEvent, Seat } from '../src/types.ts';
import {
  ent, give, giveResources, pass, spawn, toDeployment, toNextBattle, unitsOf, withE,
} from './util.ts';

const SETS = join(dirname(fileURLToPath(import.meta.url)), '../src/cards/sets');

/* ── helpers ──────────────────────────────────────────────────────────── */

/** answer the pending decision by option LABEL predicate */
function decide(h: Harness, match: (label: string) => boolean): void {
  const d = h.state.decision;
  assert.ok(d, 'a decision is pending');
  const i = d.options.findIndex(o => match(o.label));
  assert.notEqual(i, -1, `no option matching; menu was [${d.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: d.seat, choice: i });
}

/** every 'spellPlayed' / 'spawned' / 'cardPlayed' event naming `card`, with
 * the zone it reported. `undefined` is the BLANK this ruling is about. */
function playZones(h: Harness, card: string): { type: string; from: string | undefined }[] {
  return h.events
    .filter((e: EngineEvent) =>
      (e.type === 'spellPlayed' || e.type === 'spawned' || e.type === 'cardPlayed')
      && e.data?.['card'] === card)
    .map((e: EngineEvent) => ({ type: e.type, from: e.data?.['from'] as string | undefined }));
}

/** cards `seat` has DRAWN so far, counted off the events.
 *
 * ⚠ NOT `hand.length`. Half the plays in this file take the played card OUT of
 * the hand on the way past (that is what "from your hand" means), so a hand
 * that stayed the same size is a hand that drew one and lost one — which reads
 * exactly like the silence these tests are trying to prove. */
const draws = (h: Harness, seat: Seat): number =>
  h.events
    .filter((e: EngineEvent) => e.type === 'draw' && e.data?.['seat'] === seat)
    .reduce((n, e) => n + (e.data?.['n'] as number ?? 0), 0);

/** answer every pending trigger-ORDER question with the identity order and pass
 * every priority window until the stack is empty. Both watchers here fire on
 * the same event, so EVERY play in this file raises one — a test that forgets
 * to drain reads a hand that has not been drawn into yet and calls it silence. */
function drain(h: Harness): void {
  let guard = 60;
  while (guard-- > 0) {
    const d = h.state.decision;
    if (d?.kind === 'orderTriggers') {
      h.do({ type: 'decide', seat: d.seat, choice: d.options.map((_, i) => i) });
      continue;
    }
    if (d) return;
    if (h.state.stack.length && h.state.priority !== null) { pass(h); continue; }
    return;
  }
  throw new Error('drain did not terminate');
}

/** put a unit in the CURRENT BATTLE's region, where a battle trigger can see it */
function spawnInBattle(h: Harness, seat: Seat, name: string): number {
  let id = -1;
  withE(h, e => { id = e.spawnUnit(seat, name, e.s.battle!.region).id; });
  return id;
}

/* ═══ §1 THE DERIVED SUBJECT SET ═════════════════════════════════════════
 *
 * Derive, never enumerate (docs/13-assessment §7.2). A hand-typed list of the
 * three cards that call `playInline` today is exactly the guard that stops
 * working the day a fourth is added and nobody notices.
 */

/** every `playInline(` call site in the card sources, with its argument text */
function inlinePlayCallSites(): { file: string; args: string }[] {
  const out: { file: string; args: string }[] = [];
  for (const f of readdirSync(SETS).filter(n => n.endsWith('.ts'))) {
    const src = readFileSync(join(SETS, f), 'utf8');
    const re = /\bplayInline\(/g;   // NO space: `playInline (` in prose is not a call
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      // walk to the balanced close paren so nested calls and object literals
      // in the argument list are read whole
      let depth = 0, i = m.index + m[0].length - 1;
      const start = i;
      for (; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') { depth--; if (depth === 0) break; }
      }
      out.push({ file: f, args: src.slice(start + 1, i) });
    }
  }
  return out;
}

test('R263 §1: every mid-resolution play names the zone it came out of', () => {
  const sites = inlinePlayCallSites();
  // POSITIVE CONTROL. A scan that matched nothing passes forever and looks
  // exactly like one that works.
  assert.ok(sites.length >= 3,
    `expected at least the three known mid-resolution players; found ${sites.length}`);
  const zones = new Set<string>();
  for (const s of sites) {
    const m = /\bfrom:\s*'([a-z]+)'/.exec(s.args);
    assert.ok(m, `a playInline call in ${s.file} names no source zone: playInline(${s.args})`);
    zones.add(m[1]!);
  }
  // and every zone named is a real one — a typo is a silent "not the hand"
  for (const z of zones) {
    assert.ok(['hand', 'cache', 'bin', 'deck'].includes(z), `${z} is not a zone`);
  }
  assert.ok(zones.size >= 2,
    'the pool splits both ways — if every caller says the same thing, one of them is wrong');
});

test('R263 §1: the zone is REQUIRED, so the compiler asks the question first', () => {
  const src = readFileSync(join(SETS, 'batch-water-a.ts'), 'utf8');
  assert.ok(/export type InlinePlayOpts = \{[\s\S]*?\n  from: InlinePlayZone;/.test(src),
    'InlinePlayOpts.from must be non-optional — `from?:` lets a caller stay silent');
  assert.ok(!/opts: InlinePlayOpts = \{\}/.test(src),
    'playInline must not default its opts — a default is a fourth caller that never answers');
});

/* ═══ §2 THE POSITIVE CONTROL FOR THE WATCHERS ═══════════════════════════
 *
 * Before asserting that Proph and Stalwart Sentinel stay quiet on a hand play,
 * prove they are alive at all — a dead watcher is indistinguishable from a
 * correctly silent one.
 */

test('R263 §2 control: Proph and Stalwart Sentinel do fire on an ordinary play from elsewhere', () => {
  const h = new Harness(24100);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Proph');
  const sentinel = spawn(h, A, 'Stalwart Sentinel');
  giveResources(h, A, 'light', 12);

  // a HAND play feeds neither
  let drew = draws(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'The Foretold') });
  drain(h);
  assert.equal(draws(h, A), drew, 'a hand play draws nothing');
  assert.equal(ent(h, sentinel)!.counters, 0, 'and puts no counters on the Sentinel');

  // a CACHE play feeds both
  h.state.sharedDeck.unshift('The Foretold');
  withE(h, e => { e.cacheTopOfDeck(A, 1, { playable: true }); });
  drew = draws(h, A);
  h.do({ type: 'playCached', seat: A, index: 0 });
  drain(h);
  assert.equal(draws(h, A), drew + 1, 'Proph drew on the cache play');
  assert.equal(ent(h, sentinel)!.counters, 2, 'and the Sentinel took its two counters');
});

/* ═══ §3 HOOBA-PON — "from your hand", so a correct SILENCE ══════════════ */

test('R263 §3: Hooba-Pon plays from the hand, so Proph and Stalwart Sentinel stay quiet', () => {
  const h = new Harness(24101, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const pon = spawn(h, A, 'Hooba-Pon');
  giveResources(h, A, 'water', 2);                 // the second Hooba-Pon: bb/2
  toNextBattle(h, A);
  const proph = spawnInBattle(h, A, 'Proph');
  const sentinel = spawnInBattle(h, A, 'Stalwart Sentinel');
  give(h, A, 'Hooba-Pon');
  h.do({ type: 'declareAttack', seat: A, columns: [[pon]] });
  pass(h); pass(h);                                // the attack trigger resolves
  const drew = draws(h, A);
  decide(h, l => l === 'Hooba-Pon');               // pay for the unit in hand
  if (h.state.decision) decide(h, () => true);     // R29: where it is played into
  drain(h);                                        // R198's window, then it lands

  assert.ok(ent(h, proph) && ent(h, sentinel), 'both watchers are still on the board');
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Hooba-Pon').length, 2,
    'the play really happened — otherwise the silence below proves nothing');
  assert.deepEqual(playZones(h, 'Hooba-Pon').filter(z => z.type !== 'spawned'),
    [{ type: 'cardPlayed', from: 'hand' }],
    'R49: the play announced the hand as its zone');
  assert.equal(draws(h, A), drew, 'Proph did NOT draw — the card came out of the hand');
  assert.equal(ent(h, sentinel)!.counters, 0, 'and the Sentinel took no counters');
});

/* ═══ §4 INSIDIOUS INVITATION — "from hand", the same silence ════════════ */

test('R263 §4: Insidious Invitation plays from each seat own hand, so neither watcher fires', () => {
  const h = new Harness(24102, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 5);                 // Invitation b/1 + Echo of Despair b/4
  toNextBattle(h, A);
  const proph = spawnInBattle(h, A, 'Proph');
  const sentinel = spawnInBattle(h, A, 'Stalwart Sentinel');
  h.state.players[A]!.hand = ['Insidious Invitation', 'Echo of Despair'];
  h.state.players[1 - A]!.hand = [];
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: 0 });
  pass(h); pass(h);                                // the Invitation resolves (and draws 1)
  const drew = draws(h, A);
  decide(h, l => l === 'Echo of Despair');         // "starting with you"
  drain(h);                                        // the window, then the body lands

  assert.ok(ent(h, proph), 'Proph is still there');
  assert.ok(unitsOf(h, A).some(u => u.card === 'Echo of Despair'), 'the play really happened');
  assert.deepEqual(playZones(h, 'Echo of Despair').filter(z => z.type !== 'spawned'),
    [{ type: 'cardPlayed', from: 'hand' }],
    'R49: out of the playing seat own hand');
  assert.equal(draws(h, A), drew, 'Proph did NOT draw');
  assert.equal(ent(h, sentinel)!.counters, 0, 'and the Sentinel took no counters');
});

/* ═══ §5 TIDES OF THE COSMOS — the fifth zone, so a correct FIRE ═════════
 *
 * "Reveal the top eight cards of the deck … You may play them now, for free."
 * Those cards came off the DECK. By the ruling that is "somewhere else", so
 * both watchers fire — and this is the one mid-resolution play that feeds them.
 */

test('R263 §5: Tides of the Cosmos plays off the top of the deck, so Proph draws and the Sentinel grows', () => {
  const h = new Harness(24103, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  giveResources(h, D, 'water', 11);                // bbb / 8
  toNextBattle(h, A);
  const proph = spawnInBattle(h, D, 'Proph');
  const sentinel = spawnInBattle(h, D, 'Stalwart Sentinel');
  h.state.sharedDeck = [
    'Tidal Menace', 'Curio Drifter', 'Good Whale', 'Jelly', 'Ignis Sprite',
    'Dune Drifter', 'Whispering Mantid', 'Lonely Forager',
    'Rune Channeler', 'Rune Channeler',
  ];
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tides of the Cosmos') });
  pass(h); pass(h);                                // resolve → pick #1
  const drew = draws(h, D);
  decide(h, l => l.startsWith('Tidal Menace'));    // cost 3
  decide(h, l => l === 'Done');                    // one pick is enough
  drain(h);                                        // the window, then it lands

  assert.ok(ent(h, proph), 'Proph is still there');
  assert.ok(unitsOf(h, D).some(u => u.card === 'Tidal Menace'), 'the free play really landed');
  assert.deepEqual(playZones(h, 'Tidal Menace').filter(z => z.type !== 'spawned'),
    [{ type: 'cardPlayed', from: 'deck' }],
    'the fifth zone: revealed off the top of the deck, never in a hand');
  assert.equal(draws(h, D), drew + 1, 'Proph drew — this play was NOT from the hand');
  assert.equal(ent(h, sentinel)!.counters, 2, 'and the Sentinel took its two counters');
});

/* ═══ §6 THE IN-PLACE PATH ══════════════════════════════════════════════
 *
 * `playInline` has TWO paths, and the marker has to ride both. R198's push
 * path (§3-§5 above) builds a StackItem and lets `commitItem` / `resolveItem`
 * carry `from` onto the events. Outside a priority window there is no stack to
 * push to and the play happens in place, announcing itself on a hand-rolled
 * 'spellPlayed' or on the body's own 'spawned' — which is precisely the pair
 * Proph and Stalwart Sentinel listen to, so a marker missing HERE would make
 * the whole fix invisible.
 */

/** ⚠ THE REGION IS LOAD-BEARING. A trigger only hears what happens where it is
 * standing (R12), so a rig that plays into region 0 while the watchers stand
 * in their home region proves nothing and looks like a clean pass. */
const inlineCtx = (e: E, seat: Seat) => ({
  controller: seat,
  sourceName: 'R263 test rig',
  region: e.homeRegion(seat),
  targets: [],
  event: null,
  choose: () => { throw new Error('the in-place unit path must ask nothing'); },
});

test('R263 §6: the in-place path stamps the zone on the body own spawn event', () => {
  const h = new Harness(24104);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const proph = spawn(h, A, 'Proph');
  const sentinel = spawn(h, A, 'Stalwart Sentinel');
  assert.notEqual(h.state.phase, 'battle', 'this is the NON-stack path by construction');

  // from the hand: silence
  let drew = draws(h, A);
  withE(h, e => {
    playInline(e, inlineCtx(e, A) as never, 'Curio Drifter', 'k1', A, { from: 'hand' });
  });
  drain(h);
  assert.ok(unitsOf(h, A).some(u => u.card === 'Curio Drifter'), 'the body arrived');
  assert.deepEqual(playZones(h, 'Curio Drifter'), [{ type: 'spawned', from: 'hand' }],
    'the spawn carried the zone — the event Proph and the Sentinel read for a unit');
  assert.equal(draws(h, A), drew, 'Proph did NOT draw on a hand play');
  assert.equal(ent(h, sentinel)!.counters, 0, 'nor did the Sentinel grow');

  // from the deck: both fire
  drew = draws(h, A);
  withE(h, e => {
    playInline(e, inlineCtx(e, A) as never, 'Tidal Menace', 'k2', A, { from: 'deck' });
  });
  drain(h);
  assert.deepEqual(playZones(h, 'Tidal Menace'), [{ type: 'spawned', from: 'deck' }],
    'and the fifth zone survives the in-place path too');
  assert.ok(ent(h, proph), 'Proph is still there');
  assert.equal(draws(h, A), drew + 1, 'Proph drew');
  assert.equal(ent(h, sentinel)!.counters, 2, 'and the Sentinel grew');
});

test('R263 §6: an in-place SPELL play stamps the zone on its hand-rolled spellPlayed', () => {
  const h = new Harness(24105);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Proph');
  const sentinel = spawn(h, A, 'Stalwart Sentinel');
  const drew = draws(h, A);
  withE(h, e => {
    playInline(e, inlineCtx(e, A) as never, 'Flame Shield', 'k3', A, { from: 'deck' });
  });
  drain(h);
  const spellEvents = playZones(h, 'Flame Shield').filter(z => z.type === 'spellPlayed');
  assert.deepEqual(spellEvents, [{ type: 'spellPlayed', from: 'deck' }],
    'the hand-rolled event carries the zone, exactly as commitItem own does');
  assert.equal(draws(h, A), drew + 1, 'Proph heard the spell play and drew');
  assert.equal(ent(h, sentinel)!.counters, 2, 'and so did the Sentinel');
});

/* ═══ §7 A TOKEN IS NOT A CARD ══════════════════════════════════════════
 *
 * R129: `token: false` is a stated fact on a play event, not a default, and a
 * created token is not a played card at all. It must never carry a `from` —
 * that is what keeps "played from anywhere other than your hand" off every
 * effect-created body, and it is the assertion that makes §5's fire mean
 * something narrower than "any arrival".
 */

test('R263 §7: an effect-created token carries no zone at all, so neither watcher fires', () => {
  const h = new Harness(24106);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Proph');
  const sentinel = spawn(h, A, 'Stalwart Sentinel');
  const drew = draws(h, A);
  withE(h, e => { e.spawnUnit(A, 'Unit Token', e.homeRegion(A), { token: true }); });
  drain(h);
  assert.ok(unitsOf(h, A).some(u => u.card === 'Unit Token'), 'the token arrived');
  assert.deepEqual(playZones(h, 'Unit Token').map(z => z.from), [undefined],
    'no zone: it was never in one');
  assert.equal(draws(h, A), drew, 'Proph stayed quiet — a token is not a played card');
  assert.equal(ent(h, sentinel)!.counters, 0, 'and so did the Sentinel');
});
