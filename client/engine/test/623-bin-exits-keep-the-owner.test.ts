/**
 * CR 102.4 / CT-344 — A CARD LEAVING A BIN FOR A HAND, A CACHE OR PLAY TAKES ITS
 * OWNER WITH IT.
 *
 * CT-233 (owner, 2026-10-22: "Reset in shared zones") made ownership survive a
 * player's own hand, bin and cache, recorded for a bin in the
 * `PlayerState.foreign` side table. The exits it did not reach still dropped
 * that record on the way out: every card effect that recalls a bin card to a
 * hand ("about fifteen call sites"), and — the same defect one verb over —
 * every effect that puts a bin card into play (Exhume, Resurrect, Necromorph,
 * Uglk…). Collect Remains and Rippleback Skulker reach into the OPPONENT's bin,
 * so they naturalised the other player's card with no theft involved at all.
 * Two raw splices (prophesying from a hand, a {Modular} mod out of a hand or
 * bin) also skipped the choke points and left the table's positions stale.
 *
 * `E.takeFromBin` is the bin exit that returns the owner; §2 holds the pool to
 * it, by sweep, with its own positive control.
 *
 * Seeds: 62300-62399.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Seat } from '../src/types.ts';
import { finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, unitsOf } from './util.ts';

/** put `card` in `seat`'s bin as a card `owner` owns (as a stolen unit that died there would be) */
function binForeign(h: Harness, seat: Seat, card: string, owner: Seat): number {
  const p = h.state.players[seat]!;
  p.bin.push(card);
  const at = p.bin.length - 1;
  p.foreign = [...(p.foreign ?? []), { zone: 'bin', at, card, owner }];
  return at;
}

const handOwner = (h: Harness, seat: Seat, card: string): Seat => {
  const at = h.state.players[seat]!.hand.lastIndexOf(card);
  assert.ok(at >= 0, `${card} is in the hand`);
  return new E(h.state).zoneOwner(seat, 'hand', at);
};

/** A attacks with a vanilla unit, so the battle window is open for A */
function battle(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  return { h, A, D };
}

// ══ §1 · the exits ═════════════════════════════════════════════════════

test('CR 102.4 / CT-344: Collect Remains takes a card out of the opponent bin into your hand still owned by the opponent', () => {
  const { h, A, D } = battle(62301);
  h.state.players[D]!.bin.push('Just a Unit');                 // D's own card, in D's own bin
  giveResources(h, A, 'dark', 2);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Collect Remains') });
  pick(h, { bin: { seat: D, card: 'Just a Unit' } });
  pass(h); pass(h);
  assert.equal(handOwner(h, A, 'Just a Unit'), D,
    'a hand is not a shared zone: the card is D card in A hand (it used to become A card)');
  finishBattle(h);
});

test('CR 102.4 / CT-344: Tilling the Graves recalls a foreign-owned and an own card, each with its own owner', () => {
  const { h, A, D } = battle(62302);
  binForeign(h, A, 'Just a Unit', D);
  h.state.players[A]!.bin.push('Shard Sprite');                // A's own
  give(h, A, 'Unit Token');                                    // something to discard
  giveResources(h, A, 'dark', 4);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Tilling the Graves') });
  pick(h, { bin: { seat: A, card: 'Just a Unit' } });
  if (h.state.decision) pick(h, { bin: { seat: A, card: 'Shard Sprite' } });
  pass(h); pass(h);
  for (let guard = 6; h.state.decision && guard > 0; guard--) pick(h, h.state.decision.options[0]!.value);
  assert.equal(handOwner(h, A, 'Just a Unit'), D, 'the foreign card is still D card');
  assert.equal(handOwner(h, A, 'Shard Sprite'), A, 'and the own card is still A card');
  finishBattle(h);
});

test('CR 102.4 / CT-344: Exhume puts a foreign-owned bin card into play still owned by its owner', () => {
  const h = new Harness(62303);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  h.state.players[A]!.bin.length = 0;
  binForeign(h, A, 'Just a Unit', D);
  giveResources(h, A, 'dark', 3);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Exhume') });
  for (let guard = 6; (h.state.decision || h.state.stack.length) && guard > 0; guard--) {
    if (h.state.decision) pick(h, h.state.decision.options[0]!.value); else pass(h);
  }
  const u = unitsOf(h, A).find(x => x.card === 'Just a Unit');
  assert.ok(u, 'it is in play under A');
  assert.equal(u!.owner, D, 'and owned by D (it used to be A)');
});

test('CR 102.4 / CT-344: prophesying from the hand keeps the owner of a foreign card behind it', () => {
  const h = new Harness(62304);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  h.state.players[A]!.hand.length = 0;
  delete h.state.players[A]!.foreign;
  giveResources(h, A, 'light', 1);
  give(h, A, 'The Foretold');                                  // index 0, prophesied away
  const at = give(h, A, 'Just a Unit');                        // index 1, D's card
  h.state.players[A]!.foreign = [{ zone: 'hand', at, card: 'Just a Unit', owner: D }];
  h.do({ type: 'prophesy', seat: A, from: 'hand', index: 0 });
  assert.equal(h.state.players[A]!.hand.indexOf('Just a Unit'), 0, 'it moved down a slot');
  assert.equal(handOwner(h, A, 'Just a Unit'), D, 'and its owner moved with it (the raw splice left it behind)');
});

test('CR 102.4 / CT-344: a foreign-owned card prophesied out of the hand keeps its owner in the cache', () => {
  const h = new Harness(62305);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  giveResources(h, A, 'light', 1);
  const at = give(h, A, 'The Foretold');
  h.state.players[A]!.foreign = [{ zone: 'hand', at, card: 'The Foretold', owner: D }];
  h.do({ type: 'prophesy', seat: A, from: 'hand', index: at });
  const cc = new E(h.state).cache(A).find(c => c.card === 'The Foretold');
  assert.ok(cc, 'it is cached');
  assert.equal(cc!.owner, D);
});

test('CR 102.4 / CT-344: a foreign-owned spell recalled off the stack (Cosmic Reversal) is still its owner card in the hand', () => {
  const { h, A, D } = battle(62306);
  giveResources(h, A, 'water', 1);
  giveResources(h, D, 'water', 2);
  const at = give(h, A, 'Premonition');
  h.state.players[A]!.foreign = [{ zone: 'hand', at, card: 'Premonition', owner: D }];
  h.do({ type: 'playCard', seat: A, handIndex: at });
  assert.equal(h.state.stack.at(-1)?.owner, D, 'the item carries its owner');
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Cosmic Reversal') });
  pass(h); pass(h);                                            // Cosmic Reversal resolves
  assert.equal(handOwner(h, A, 'Premonition'), D, 'back in the hand of its controller, still D card');
  finishBattle(h);
});

// ══ §2 · THE CLASS GUARD ═══════════════════════════════════════════════

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'src');
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsFiles(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** a `removeFromBin(` CALL (not the declaration) and the reason it names */
const REMOVE = /\.removeFromBin\(\s*[^,]+,\s*[^,]+,\s*('[^']*'|[^,)]+)/;
/** the two exits that may drop the owner: the card leaves the game, or enters a shared pile */
const DROPS_OWNER = new Set(["'erased'", "'recycled'"]);
/** a `toHand(` call whose zone is a bin or the stack (a card that was the player's own) */
const TO_HAND_FROM_BIN = /\btoHand\([^;]*'(bin|stack)'/;
/** a raw hand/bin splice */
const RAW_SPLICE = /\b(hand|bin|zone)\.splice\(/;

interface Hit { at: string; line: string; next: string }

function sweep(re: RegExp, keep: (h: Hit, m: RegExpMatchArray) => boolean): Hit[] {
  const out: Hit[] = [];
  for (const f of tsFiles(SRC)) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (COMMENT.test(line)) return;
      const m = line.match(re);
      if (!m) return;
      const h = { at: `${path.relative(SRC, f)}:${i + 1}`, line: line.trim(), next: lines.slice(i, i + 12).join('\n') };
      if (keep(h, m)) out.push(h);
    });
  }
  return out;
}

test('the bin-exit sweep is not blind: it flags planted exits and passes the right shapes', () => {
  const r1 = "        const name = g.removeFromBin(ctx.controller, t.binCard.index, 'recalled');".match(REMOVE);
  assert.ok(r1 && !DROPS_OWNER.has(r1[1]!), 'a recall through removeFromBin is flagged');
  const r2 = "      g.removeFromBin(seat, i, 'erased');".match(REMOVE);
  assert.ok(r2 && DROPS_OWNER.has(r2[1]!), 'an erase is allowed');
  assert.ok(!REMOVE.test('  removeFromBin(seat: Seat, binIndex: number, reason: string): CardName | undefined {'),
    'the declaration is not a call');
  assert.ok(TO_HAND_FROM_BIN.test("g.toHand(ctx.controller, name, 'bin');"), 'a bin recall to a hand is seen');
  assert.ok(TO_HAND_FROM_BIN.test("g.toHand(it.controller, it.card!, 'stack');"), 'and a stack recall');
  assert.ok(!/owner/.test("g.toHand(ctx.controller, name, 'bin');"), 'and has no owner');
  assert.ok(RAW_SPLICE.test('    zone.splice(index, 1);'), 'a raw splice is seen');
  assert.ok(COMMENT.test("  // g.removeFromBin(seat, i, 'recalled');"), 'a commented line is skipped');
});

test('CR 102.4 / CT-344 class guard: every bin exit that keeps the card in the game goes through takeFromBin', () => {
  const bad = sweep(REMOVE, (h, m) => {
    if (DROPS_OWNER.has(m[1]!)) return false;
    // the choke point's own call, inside takeFromBin
    return !(h.at.startsWith('engine.ts:') && /this\.removeFromBin\(seat, at, reason, opts\)/.test(h.line));
  });
  assert.deepEqual(bad.map(b => `${b.at}  ${b.line}`), [],
    'a recall, a revival, a play, a cache or an agreed-fix move out of a bin must keep the owner (E.takeFromBin)');
});

/**
 * Does a `takeFromBin(` call at the head of `next` use the owner it returns?
 * Only the RESULT's `.owner` counts — never the bare word, which a local named
 * `owner` (Necromorph has one) would satisfy while the result's owner is dropped:
 *  · chained on the call: `takeFromBin(…)!.owner`;
 *  · bound to a name: `const took = …takeFromBin(` and then `took.owner` / `took!.owner`;
 *  · collected into a list (`push`/`unshift`, of the call or of its name) and
 *    read off the elements: some `.owner` property read follows.
 */
function usesTakenOwner(next: string): boolean {
  const line = next.split('\n')[0]!;
  if (/takeFromBin\([^)]*\)[!?]*\.owner/.test(line)) return true;
  const bound = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*[\w.!]*takeFromBin\(/)?.[1];
  if (bound && new RegExp(`\\b${bound}[!?]*\\.owner\\b`).test(next)) return true;
  const collected = /\.(push|unshift)\([^)]*takeFromBin\(/.test(line)
    || (bound !== undefined && new RegExp(`\\.(push|unshift)\\(${bound}\\)`).test(next));
  return collected && /\w[!?]*\.owner\b/.test(next.split('\n').slice(1).join('\n'));
}

test('the takeFromBin-owner check is not blind: a same-named local does not satisfy it', () => {
  assert.ok(usesTakenOwner("const took = g.takeFromBin(s, i, 'revived');\n g.spawnUnit(s, took.card, r, { owner: took.owner });"));
  assert.ok(usesTakenOwner("if (bi !== -1) owner = g.takeFromBin(seat, bi, 'revived')!.owner;"));
  assert.ok(usesTakenOwner("while (b.length) moved.unshift(g.takeFromBin(s, b.length - 1, 'recalled')!);\n g.toHand(s, moved.map(m => m.card), 'bin', { owner: moved.map(m => m.owner) });"));
  assert.ok(!usesTakenOwner("const took = g.takeFromBin(owner, i, 'revived');\n g.exchangeInPlace(victim, name, owner);"),
    'Necromorph with its owner dropped: the local `owner` must not count');
  assert.ok(!usesTakenOwner("const took = g.takeFromBin(s, i, 'revived');\n g.spawnUnit(opp, took.card, r, { owner: seat });"),
    'Uglk with its owner dropped');
});

test('CR 102.4 / CT-344 class guard: every takeFromBin in a card file uses the owner it returns', () => {
  const unused = sweep(/\btakeFromBin\(/, h => h.at.startsWith('cards') && !usesTakenOwner(h.next));
  assert.deepEqual(unused.map(b => `${b.at}  ${b.line}`), []);
});

test('CR 102.4 / CT-344 class guard: every recall from a bin or the stack to a hand passes the owner', () => {
  // a token has no owner to keep (it is erased from the hand), so `token: true` passes too
  const bare = sweep(TO_HAND_FROM_BIN, h => !/owner|token: true/.test(h.line));
  assert.deepEqual(bare.map(b => `${b.at}  ${b.line}`), []);
});

test('CR 102.4 / CT-344 class guard: no raw hand or bin splice skips the foreign-owner bookkeeping', () => {
  const bad = sweep(RAW_SPLICE, h => !/foreignSpliced\(/.test(h.next));
  assert.deepEqual(bad.map(b => `${b.at}  ${b.line}`), []);
});

// ══ §3 · CT-367: every stack item a card file builds carries the owner ══

/**
 * The text of each `StackItem = {` literal in a file: from that line to the
 * first line closing the object (`};`), plus the line after it, where an
 * owner assigned just after the literal would sit.
 */
function stackItemLiterals(rel: string, text: string): Hit[] {
  const lines = text.split('\n');
  const out: Hit[] = [];
  lines.forEach((line, i) => {
    if (COMMENT.test(line) || !/\bStackItem = \{/.test(line)) return;
    let j = i;
    while (j < lines.length && !/^\s*\};/.test(lines[j]!)) j++;
    out.push({ at: `${rel}:${i + 1}`, line: line.trim(), next: lines.slice(i, j + 2).join('\n') });
  });
  return out;
}

/** the one literal a card file may build without an owner: inlineMode's stand-in
 * (helpers.ts), which only `modes.options` reads and never reaches the stack */
const STAND_IN = /id: -1, kind: 'spell', label: o\.card \?\? ctx\.sourceName/;

test('the stack-item owner sweep is not blind: it flags an item with no owner and passes the right shapes', () => {
  const bare = "    const item: StackItem = {\n      id: g.s.nextId++, kind: 'virus', card: name, controller: seat,\n      parts: [], hostId: host.id,\n    };\n    g.pushItem(item);";
  const hits = stackItemLiterals('x.ts', bare);
  assert.equal(hits.length, 1, 'the literal is found');
  assert.ok(!/\bowner\b/.test(hits[0]!.next), 'and has no owner');
  const owned = bare.replace("hostId: host.id,", "hostId: host.id,\n      ...(owner !== undefined && owner !== seat ? { owner } : {}),");
  assert.ok(/\bowner\b/.test(stackItemLiterals('x.ts', owned)[0]!.next), 'an owner spread passes');
  const after = bare.replace('g.pushItem(item);', 'if (owner !== seat) item.owner = owner;');
  assert.ok(/\bowner\b/.test(stackItemLiterals('x.ts', after)[0]!.next), 'an owner set on the next line passes');
});

test('CR 102.4 / CT-367 class guard: every stack item a card file builds for a card carries its owner', () => {
  const cards = path.join(SRC, 'cards');
  const found: Hit[] = [];
  for (const f of tsFiles(cards)) found.push(...stackItemLiterals(path.relative(SRC, f), fs.readFileSync(f, 'utf8')));
  assert.ok(found.some(h => h.at.startsWith('cards/sets/batch-water-a.ts')),
    'positive control: the inline plays (batch-water-a) build stack items');
  const bare = found.filter(h => !STAND_IN.test(h.next) && !/\bowner\b/.test(h.next));
  assert.deepEqual(bare.map(b => `${b.at}  ${b.line}`), [],
    'a card played out of a hand or a bin in any mode is still its owner card on the stack (StackItem.owner)');
});
