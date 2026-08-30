/* R207 / CT-79 — VOID MANDIBLE NEGATES THE ITEM THE EVENT NAMES.
 *
 * "[Augment] When a nontoken card is played during battle, sacrifice me. If
 * you do, negate that effect." The pronoun is R164/R166's, and three other
 * cards in the pool answer it by matching on the id the play event carries
 * (Earthbound Replicator, R178; Origon and Hexbane Shiitake, R191). This one
 * could not: `spellPlayed` carries `item`, `cardPlayed` did not, and Void
 * Mandible must hear `cardPlayed` because it must see UNITS as well as spells
 * (R129). R207 put the id on `cardPlayed` and converted the card.
 *
 * Every test here drives the REAL stack through `Harness.do` — no hand-built
 * event, no hand-built stack item. That is deliberate: docs/13 §5 records four
 * "fixed" reports whose guards unit-tested the last hop with a fabricated
 * input and could therefore never have failed. Each test below was run against
 * the pre-R207 card and observed to FAIL; the verbatim messages are in the
 * R207 ruling.
 *
 * THE SHARED TRICK, and why it is not a cheat. Void Mandible is single-use by
 * construction — it sacrifices itself on the first play it sees — so a board
 * that has it in play can never reach a SECOND play with an older item still
 * standing. The Mandible therefore arrives MID-BATTLE, as a real augment
 * applied from hand, which R95's permission layer allows: Rook prints "[Augment]
 * You may augment cards from hand and bin during battle as if they were
 * [Virus]", and the owner ruled it confers {Virus} outright (R157 §26 / R161).
 * So the augment below is an ordinary legal action, the mod attaches through
 * `doAugment`'s battle branch, and "me" is then the HOST — which is why the
 * host is what gets sacrificed.
 *
 * Seeds 17800-17809.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../src/harness.ts';
import type { EntityId, Seat } from '../src/types.ts';
import {
  ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle,
} from './util.ts';

/** the ids of the stack items that are copies / originals of a given card */
const itemsOf = (h: Harness, card: string): { id: number; copy: boolean }[] =>
  h.state.stack.filter(i => i.card === card).map(i => ({ id: i.id, copy: i.copy === true }));

/** apply Void Mandible out of `seat`'s hand onto `host`, through the real
 * `augment` action (Rook's R95 permission), and resolve the virus item. */
function augmentMandible(h: Harness, seat: Seat, host: EntityId): void {
  const idx = give(h, seat, 'Void Mandible');
  h.do({ type: 'augment', seat, from: 'hand', index: idx, hostId: host });
  assert.equal(h.state.stack[h.state.stack.length - 1]!.kind, 'virus',
    'R37: applying a mod is not playing a card — it is a virus item, and it fires no play event');
  pass(h); pass(h);                       // the virus resolves and the mod attaches
  assert.ok(ent(h, host)!.mods.some(m => ent(h, m)?.card === 'Void Mandible'),
    'the Mandible is now riding the host');
}

// ── (a) two identical plays: the NEWER is the one the event names ─────────

test('Void Mandible: with two same-card same-seat spells up, it negates THE ONE THE EVENT NAMES', () => {
  const h = new Harness(17800);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, A, 'Rook');                                  // R95: A may augment from hand in battle
  const host = spawn(h, A, 'Unit Token');               // the body that will wear the Mandible
  const atk = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'wood', 8);
  giveResources(h, A, 'light', 4);
  toNextBattle(h, D);                                   // D attacks → the battle is in A's home
  h.do({ type: 'declareAttack', seat: D, columns: [[atk]] });

  // Burgeon #1 — no Mandible anywhere yet, so nothing triggers.
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Burgeon') });
  pick(h, { unit: atk });
  pick(h, 'power');
  assert.equal(h.state.stack.length, 1, 'just the first Burgeon');
  const first = h.state.stack[0]!.id;

  augmentMandible(h, A, host);

  // Burgeon #2 — the play the Mandible actually hears.
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Burgeon') });
  pick(h, { unit: atk });
  pick(h, 'power');
  const second = h.state.stack.find(i => i.card === 'Burgeon' && i.id !== first)!.id;
  assert.equal(h.state.stack.length, 3, 'Burgeon #1, Burgeon #2, and the Mandible trigger above them');
  assert.ok(second > first, 'pushItem appends, so the newer item is LATER in the array');

  pass(h); pass(h);                                     // the trigger resolves first
  assert.ok(!ent(h, host), 'the host was sacrificed — "me" is the host for a donated [Augment]');
  const left = h.state.stack.filter(i => i.card === 'Burgeon').map(i => i.id);
  assert.deepEqual(left, [first],
    'R207: the SECOND Burgeon is negated — the one `cardPlayed` named. '
    + 'A forward .find() from index 0 negates the older one instead.');
  finishBattle(h);
});

// ── (b) R164: a COPY was never played, so it is never "that effect" ───────

test('Void Mandible: a COPY on the stack is never negated — R164, a copy was not played', () => {
  const h = new Harness(17801);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  // R12: Rook grants the permission in ITS region, and the battle is fought in
  // the DEFENDER's home — so the grantor, the host and the Replicator are all
  // on D's side here. Which seat wears the Mandible does not matter: it fires
  // on any nontoken card played in the battle, its own controller's included.
  spawn(h, D, 'Rook');
  const host = spawn(h, D, 'Unit Token');
  const atk = spawn(h, A, 'Unit Token');
  const repl = spawn(h, D, 'Earthbound Replicator');    // copies a nonunit spell aimed at it
  giveResources(h, A, 'wood', 8);
  giveResources(h, D, 'light', 4);
  giveResources(h, D, 'water', 2); giveResources(h, D, 'metal', 2);
  toNextBattle(h, A);                                   // A attacks → the battle is in D's home
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });

  // Burgeon #1 at the Replicator → the Replicator's trigger makes a COPY.
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Burgeon') });
  pick(h, { unit: repl });
  pick(h, 'power');
  pass(h); pass(h);                                     // the Replicator trigger resolves
  pick(h, false);                                       // keep the declared target
  const orig = h.state.stack.find(i => i.card === 'Burgeon' && !i.copy)!.id;
  const copy = h.state.stack.find(i => i.copy)!.id;
  assert.equal(itemsOf(h, 'Burgeon').length, 2, 'the original and its copy');

  // Dematerialize the ORIGINAL, so the copy is the only Burgeon-shaped item
  // left standing — and it is at index 0, exactly where a forward scan looks.
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Dematerialize') });
  pick(h, { stack: orig });
  pass(h); pass(h);
  pick(h, h.state.decision!.options[0]!.value);         // Dematerialize's Glimpse 3
  assert.deepEqual(itemsOf(h, 'Burgeon'), [{ id: copy, copy: true }],
    'only the copy is left, and it is the bottom of the stack');

  if (h.state.priority !== D) pass(h);
  augmentMandible(h, D, host);

  // Burgeon #2 — a real play, with the copy sitting underneath it.
  if (h.state.priority !== A) pass(h);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Burgeon') });
  pick(h, { unit: atk });
  pick(h, 'power');
  const second = h.state.stack.find(i => i.card === 'Burgeon' && !i.copy)!.id;

  pass(h); pass(h);                                     // the Mandible trigger resolves
  assert.ok(!ent(h, host), 'the host was sacrificed');
  assert.deepEqual(itemsOf(h, 'Burgeon'), [{ id: copy, copy: true }],
    'R164: the COPY survives and the played Burgeon is the one negated. '
    + `(the played item was ${second}.) A scan with no !i.copy guard eats the copy instead.`);
  finishBattle(h);
});

// ── (c) a play that put NO item on the stack negates nothing ─────────────

test('Void Mandible: a play with no stack item (R165 asPlay) negates nothing — not a same-named bystander', () => {
  const h = new Harness(17802);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, A, 'Rook');
  const host = spawn(h, A, 'Unit Token');
  const atk = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'dark', 8);
  giveResources(h, D, 'light', 4);
  giveResources(h, A, 'light', 4);
  h.state.players[D]!.bin.push('Shard Sprite');                // what Wake the Dead will raise
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[atk]] });

  // A {Battle} unit of D's, on the stack, sharing its name with the card in
  // the bin. This is the bystander the old (card, controller) scan reached.
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Shard Sprite') });
  const bystander = h.state.stack.find(i => i.card === 'Shard Sprite')!.id;

  // Wake the Dead, played in response to D's own unit. Its raised units arrive
  // through `spawnUnit({ asPlay: true })` (R165) — a real play that builds NO
  // stack item, which is the whole point of this test.
  if (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wake the Dead') });

  // …and the Mandible arrives while Wake the Dead is still on the stack, so it
  // is not spent on Wake the Dead itself and is live for the raise inside it.
  if (h.state.priority !== A) pass(h);
  augmentMandible(h, A, host);

  if (h.state.priority !== D) pass(h);
  pass(h); pass(h);                                     // Wake the Dead resolves → it PLAYS a unit
  while (h.state.decision) {
    const dec = h.state.decision;
    const i = dec.options.findIndex(o => o.label.includes('Shard Sprite'));
    pick(h, dec.options[i === -1 ? dec.options.length - 1 : i]!.value);   // Shard Sprite, then Done
  }
  assert.ok(h.state.stack.some(i => i.kind === 'triggered' && i.card === 'Void Mandible'),
    'the raise really IS a play (R165) — the Mandible heard it and its trigger is on the stack');
  pass(h); pass(h);                                     // the Mandible trigger resolves

  assert.ok(h.log.some(l => l.includes('Void Mandible: Shard Sprite was played with no effect on the stack')),
    'R207 (c): the raised unit put no effect on the stack, so there is nothing to negate');
  assert.ok(!ent(h, host), 'the sacrifice is still paid — "sacrifice me. If you do, …" (R73)');
  const survivor = h.state.stack.find(i => i.id === bystander);
  assert.ok(survivor && !survivor.negated,
    'and the unrelated same-named item on the stack is UNTOUCHED — the old scan negated it');
  finishBattle(h);
});

// ── the ordinary case, unchanged ─────────────────────────────────────────

test('Void Mandible: the ordinary case still works — one play, sacrificed, negated', () => {
  const h = new Harness(17803);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const vm = spawn(h, A, 'Void Mandible');
  const atk = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'wood', 4);
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[atk]] });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Burgeon') });
  pick(h, { unit: atk });
  pick(h, 'power');
  const played = h.state.stack.find(i => i.card === 'Burgeon')!.id;
  assert.equal(h.state.stack.length, 2, 'the Burgeon and the trigger above it');
  pass(h); pass(h);
  assert.ok(!ent(h, vm), 'played normally, "me" is the Mandible itself');
  assert.ok(!h.state.stack.some(i => i.id === played), 'R68: the negated Burgeon left the stack at once');
  finishBattle(h);
});

/* ══════════════════════════════════════════════════════════════════════════
 * R208 / CT-86 — E.eraseMod, THE CHOKE POINT, AND THE RULING IT KEEPS OPEN.
 *
 * Five sites hand-rolled `host.mods.splice(…)` + `delete s.entities[id]`, each
 * with its own announcement and its own answer to R65's public-erased-pile
 * question. R178 built `E.moveMod`; the ERASE sibling did not exist. It does
 * now, and every one of those sites routes through it.
 *
 * ⚠ WHAT THESE TESTS GUARD IS THAT NOTHING CHANGED. Whether a mod erased as a
 * COST belongs on the public erased pile is round-27's Q3 and it is an OPEN
 * OWNER RULING — the R196 agent left it rather than guess, and so does R208.
 * So each site's CURRENT announcement is pinned here, Slag Spewer's 'info'
 * included, and the pile is asserted in both directions. When the owner
 * answers Q3, exactly these assertions are what should have to be edited —
 * deliberately, in one place, instead of a refactor having quietly answered it.
 * ══════════════════════════════════════════════════════════════════════════ */

/** the R65 public erased pile for a seat */
const erasedPile = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.erased ?? [];
/** every 'erased' EVENT that names a card — the only thing that files the pile */
const erasedEvents = (h: Harness): string[] =>
  h.events.filter(e => e.type === 'erased').flatMap(e => (e.data?.['cards'] ?? []) as string[]);

/** a battle in D's home (A attacks), with A holding priority to play a spell */
function spellBattle(seed: number): { h: Harness; A: Seat; D: Seat; atk: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - (h.state.initiative as Seat)) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  return { h, A, D, atk };
}

test('R208 Slag Spewer: an erase paid as a COST still announces itself with "info" — Q3 is OPEN', () => {
  const { h, A, D, atk } = spellBattle(17804);
  const spewer = spawn(h, D, 'Slag Spewer');
  const victim = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'water', 3); giveResources(h, D, 'earth', 3); giveResources(h, D, 'fire', 3);
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'A Pile of Runes'), hostId: spewer });
  const modId = ent(h, spewer)!.mods[0]!;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                              // A passes → D may activate

  h.do({ type: 'activateAbility', seat: D, entityId: spewer, abilityIndex: 0, via: 'augment' });
  pick(h, { unit: victim });                            // R57: the target first
  pick(h, { eraseMod: modId });                         // …then the cost

  // the MECHANICAL contract of E.eraseMod, which is all it does
  assert.deepEqual(ent(h, spewer)!.mods, [], 'unlinked from the host');
  assert.equal(ent(h, modId), undefined, 'and deleted from the game');
  assert.ok(!h.state.players[D]!.bin.includes('A Pile of Runes'), 'an erase is not a bin');

  // …and the ANNOUNCEMENT. R219 — ANSWERED, and the question should never have
  // been asked: the card says "erase", which names the destination. The owner,
  // asked it: "Obviously the card says where it should end up. It's erased…
  // It should just end up in the erased zone."
  assert.ok(h.log.some(l => l.startsWith('A Pile of Runes is ERASED off Slag Spewer — the cost of ')),
    'the wording is unchanged — only the event TYPE and the pile moved');
  assert.ok(erasedEvents(h).includes('A Pile of Runes'),
    'a cost-erase emits a real `erased` event, like every other erase in the game');
  assert.deepEqual(erasedPile(h, D), ['A Pile of Runes'],
    'and it reaches the R65 public pile — which exists BECAUSE of the complaint that "there is '
    + 'currently no way to view erased cards". A card erased to nowhere is that bug.');
});

test('R208 Suppression Field: mods leave host and game, the host lives, and the pile is untouched', () => {
  const { h, A, D, atk } = spellBattle(17805);
  const host = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'water', 3); giveResources(h, D, 'earth', 3);
  giveResources(h, A, 'metal', 3);
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'A Pile of Runes'), hostId: host });
  const modId = ent(h, host)!.mods[0]!;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });

  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Suppression Field') });
  pick(h, { unit: host });
  pass(h); pass(h);

  assert.ok(ent(h, host), 'the HOST survives — this is an erase off a living body, not a disposal with it');
  assert.deepEqual(ent(h, host)!.mods, [], 'unlinked');
  assert.equal(ent(h, modId), undefined, 'and deleted');
  assert.ok(h.log.some(l => l === `Suppression Field ERASES 1 mod(s) on ${ent(h, host)!.card}.`),
    'its own summary line is unchanged');
  // R219 — this card was the SECOND live instance of the same defect and was on
  // no ticket: it removes real nontoken mod CARDS from the game, says "ERASES"
  // in its own log line, and filed nothing. It is fixed for free by the ruling,
  // because eraseMod is the choke point every one of these routes through — the
  // whole point of building the primitive before answering the question.
  assert.ok(erasedEvents(h).includes('A Pile of Runes'),
    'a real nontoken mod card leaving the game files the pile, wherever it leaves from');
  assert.deepEqual(erasedPile(h, D), ['A Pile of Runes'], 'and it is visible to both players');
  finishBattle(h);
});

test('R208 Return to Nature: the site that already got R65 right still files the public pile', () => {
  const { h, A, D, atk } = spellBattle(17806);
  const host = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'water', 3); giveResources(h, D, 'earth', 3);
  giveResources(h, A, 'earth', 6);
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'A Pile of Runes'), hostId: host });
  const modId = ent(h, host)!.mods[0]!;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });

  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Return to Nature') });
  pass(h); pass(h);

  assert.equal(ent(h, modId), undefined, 'the mod is erased');
  assert.ok(ent(h, host), 'off a host that survives');
  assert.ok(erasedEvents(h).includes('A Pile of Runes'),
    'R65: this site emits the real "erased" event — it is the template E.eraseMod was written against');
  assert.deepEqual(erasedPile(h, D), ['A Pile of Runes'],
    "and the pile is the MOD OWNER's, not the host controller's");
  finishBattle(h);
});

test('R208 Reclaim the Fallen: leavesGame:false — the mod entity dies, the CARD does not leave the game', () => {
  const { h, A, D, atk } = spellBattle(17807);
  const host = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'water', 3); giveResources(h, D, 'earth', 3);
  giveResources(h, A, 'earth', 3); giveResources(h, A, 'dark', 3);
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'A Pile of Runes'), hostId: host });
  const modId = ent(h, host)!.mods[0]!;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });

  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Reclaim the Fallen') });
  pick(h, { unit: host });
  pass(h); pass(h);

  assert.equal(ent(h, modId), undefined, 'the MOD entity is gone');
  assert.deepEqual(ent(h, host)!.mods, [], 'and unlinked from its host');
  assert.ok(Object.values(h.state.entities).some(e => e.kind === 'unit' && e.card === 'A Pile of Runes'),
    'because the CARD is standing in play as a unit — this is not an erase at all');
  assert.ok(!erasedEvents(h).includes('A Pile of Runes'),
    '⚠ and it must NEVER reach the erased pile, whatever Q3 answers: nothing left the game. '
    + 'That is the whole reason E.eraseMod takes `leavesGame`.');
  finishBattle(h);
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE CLASS GUARD — so a FIFTH card fails on arrival instead of being found.
 *
 * "The item the play event names" has been closed ONE CARD AT A TIME across
 * three tickets: CT-58 → CT-69 (Origon, Hexbane Shiitake) → CT-79 (Void
 * Mandible), each closure naming the next remainder, with Earthbound
 * Replicator (R178) as the precedent that started it. docs/13 §4 names that
 * exact failure — a one-card fix for a whole class — as recurring.
 *
 * This is the derived guard that ends it. It is COMPUTED over the card files
 * rather than typed from a list: any lookup on `s.stack` that matches a stack
 * item by CARD NAME instead of by ID fails here, wherever it is written and
 * whoever writes it. The three fixed cards are its live negative controls
 * (they all match on `.id ===`), and a synthetic snippet is its positive one —
 * docs/13 §5's rule that a guard which cannot fail is not a guard.
 * ══════════════════════════════════════════════════════════════════════════ */

/** every `s.stack.find/filter/some(...)` in `src` whose predicate keys on a
 *  CARD NAME and not on an item id. Returns 1-based line numbers. */
function stackNameScans(src: string): number[] {
  // the CODE view: a `//` line and a block comment are prose, and R166's
  // superseded scan is quoted verbatim in two of these files.
  const code = src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const hits: number[] = [];
  const re = /\bs\.stack\b[\s\S]{0,40}?\.(?:find|filter|some)\s*\(/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    let depth = 0, end = code.length;
    for (let i = m.index + m[0].length - 1; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')' && --depth === 0) { end = i; break; }
    }
    const body = code.slice(m.index, end);
    if (/\.card\s*===/.test(body) && !/\.id\s*===/.test(body)) {
      hits.push(code.slice(0, m.index).split('\n').length);
    }
  }
  return hits;
}

test('R207 class guard: no card file finds a stack item by CARD NAME — it is always by id', () => {
  const dir = fileURLToPath(new URL('../src/cards/sets/', import.meta.url));
  const files = readdirSync(dir).filter(f => f.endsWith('.ts')).sort();
  assert.ok(files.length >= 30, `the sweep must see the whole set directory (saw ${files.length})`);

  const offenders: string[] = [];
  for (const f of files) {
    for (const line of stackNameScans(readFileSync(join(dir, f), 'utf8'))) {
      offenders.push(`${f}:${line}`);
    }
  }
  assert.deepEqual(offenders, [],
    'A stack lookup keyed on a card name negates/copies/steals the WRONG item as soon as two '
    + 'same-card same-seat items are up, and reaches a COPY that was never played (R164). '
    + 'The play events carry `item` — `spellPlayed` since R178, `cardPlayed` since R207 — so '
    + 'match on that id and keep the kind/`!i.copy` tests as assertions about it. '
    + 'Precedents: Earthbound Replicator (R178), Origon and Hexbane Shiitake (R191), '
    + 'Void Mandible (R207).');

  // POSITIVE CONTROL: the detector can see the shape it exists for — this is
  // Void Mandible's pre-R207 line, verbatim.
  assert.deepEqual(stackNameScans(
    'const it = g.s.stack.find(i =>\n'
    + '  i.card === name && i.controller === seat && CARD_PLAY_KINDS.has(i.kind));'), [1],
  'the sweep must be able to fail');
  // …and R166's reverse-scan shape, which is the same bug one order later.
  assert.deepEqual(stackNameScans(
    'const it = [...g.s.stack].reverse().find(i => i.card === n && !i.copy);'), [1],
  'including through a `[...].reverse()`');
  // NEGATIVE CONTROL: an id match is what the fix looks like.
  assert.deepEqual(stackNameScans(
    'const it = g.s.stack.find(i => i.id === itemId && i.card === name && !i.copy);'), [],
  'an id match is not a name scan, even when it also asserts the name');
  // …and prose is not code: R191's comment quotes the old scan in two files.
  assert.deepEqual(stackNameScans(
    '// const item = g.s.stack.find(i => i.card === cardName && i.controller === seat);'), [],
  'a superseded scan quoted in a COMMENT is history, not a hit');
});
