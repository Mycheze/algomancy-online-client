/* R229 — report #108: A COPY IS DRAWN AS THE CARD IT COPIED.
 *
 * Owner, SBCM action 136: *"Borrower of Forms should also copy/borrow the card
 * ART of the thing its copying. Just the little note at the bottom (and the
 * green power/defense) is great to mark it as a copy."*
 *
 * TWO ASKS IN ONE SENTENCE, PULLING OPPOSITE WAYS. The art must follow the
 * face; the markings that say "this is a copy" must NOT. That is why this file
 * asserts both halves of every board card it looks at — a fix that made the
 * copy indistinguishable from the original would satisfy the first sentence
 * and break the second, and only the second sentence can catch it.
 *
 * ── WHY IT WAS WRONG ─────────────────────────────────────────────────────
 *
 * R118 deliberately never rewrites `Entity.card`: the physical card is what
 * bins (ruling 1), and the worn face lives in `Entity.copies` behind
 * `E.nameOf`. ui/cardtext.ts already read the face, so the NAME and the TEXT
 * followed the copy. `ui/main.ts unitHtml` fed `u.card` — the cardboard — to
 * `art()`, so the picture did not. One entity, two answers to "which card is
 * this", and the picture is the one a player reads first.
 *
 * ── THE CLASS, DERIVED TWICE ─────────────────────────────────────────────
 *
 * Only a face carrying the `name` facet (CopyFacet) is an identity, and only
 * an identity changes what the card IS. Two independent derivations agree on
 * which cards make one:
 *
 *  1. CALL SITES. `E.becomeCopy` / `E.prepareCopy` default to FULL_FACETS
 *     (which includes `name`). Across `engine/src/cards/**` there are exactly
 *     two: `batch-hybrids-ld-a.ts` (Apex Prime) and `batch-metal-a.ts`
 *     (Borrower of Forms, prepared for its own `spawnWearing`).
 *  2. PRINTED TEXT. Eleven of the 492 printed cards say "copy". Nine of them
 *     create a TOKEN that is a copy (Echo of Despair, Arcane Echo, Hooba-God,
 *     Swarmling, Automaton of Abundance), copy a SPELL (Earthbound Replicator,
 *     Maelstrom Charger) or copy a TRIGGER (Lost Guardian, Amphivore) — a new
 *     entity, or none, and its `Entity.card` is already the copied card, which
 *     is why those always rendered correctly. The two that make an existing
 *     body wear another card's face are Borrower of Forms and Apex Prime.
 *
 * Apex Prime is here because it hits N units in one resolution: it is what
 * proves the fix is in the renderer and not in one card's special case.
 *
 * ── AND THE ONE THAT MUST NOT MOVE ───────────────────────────────────────
 *
 * §3 is the guard, and it is the reason this file is worth its length. Ancient
 * One `projects` with `facets: ['statics','activated','behavior']` and NO
 * `name` — R127's stated exclusion. It is a copy that deliberately keeps its
 * own face, so it must keep its own PORTRAIT. A fix reaching for `facesOf(u)`,
 * `facesWith(u, …)` or `u.copies[0].card` instead of `E.nameOf` renders an
 * Ancient One as its neighbour and passes §1 and §2 while doing it. §3 makes
 * the projection provably live on the very board it then reads the art off.
 *
 * ⚠ `117-copy-everything.test.ts` is NOT coverage for any of this: it is
 * R127/Ancient One, contains no Borrower and no Apex Prime, and says nothing
 * about rendering.
 *
 * ⚠ HOW THE CLIENT IS DRIVEN. test/ui-driver.ts in hotseat mode — main.ts's
 * own render, main.ts's own `unitHtml`. The assertions are over the markup
 * string the client really produced, which is the same string a browser is
 * handed, so the driver's known DOM/timing gaps (see 199) cannot reach them.
 * Nothing here reads ui/main.ts as source text.
 *
 * Seeds 19800-19899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { entityTextBox } from '../ui/cardtext.ts';
import {
  effStats, ent, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';
import type { EntityId, Seat } from '../src/types.ts';

/* ── the client, hotseat ─────────────────────────────────────────────── */
// set BEFORE the driver is imported, and the import must therefore be dynamic
(globalThis as Record<string, unknown>)['__UI_DRIVER_SEARCH'] = '?hotseat=1';
const { local } = await import('./ui-driver.ts');
const ui = local();

/* ── reading the board ───────────────────────────────────────────────── */

/** every board card drawn for entity `id`: the opening `<div>` plus its `<img>`
 * and stats, one chunk per place the unit appears (a unit in a declared column
 * is on screen twice — the region row and the battle panel — and BOTH have to
 * agree about which card it is). */
function scansOf(html: string, id: EntityId): string[] {
  const out: string[] = [];
  const needle = `data-previd="${id}"`;
  for (let at = html.indexOf(needle); at >= 0; at = html.indexOf(needle, at + 1)) {
    const start = html.lastIndexOf('<div', at);
    assert.ok(start >= 0, `entity ${id}'s scan has no opening tag`);
    // to the next card scan, or the end — enough to carry the img and the stats
    const next = html.indexOf('data-previd="', at + 1);
    const end = next < 0 ? html.length : html.lastIndexOf('<div', next);
    out.push(html.slice(start, end));
  }
  assert.ok(out.length, `no card on screen for entity ${id}`);
  return out;
}

/** the art file every scan of `id` is showing — one entry per scan, so a board
 * where two views of the same unit disagree fails loudly rather than passing
 * on whichever one `indexOf` happened to find first */
function artOf(html: string, id: EntityId): string[] {
  return scansOf(html, id).map(chunk => {
    const m = /<img src="[^"]*?([^"/]+\.jpg)"/.exec(chunk);
    assert.ok(m, `entity ${id}'s scan has no art: ${chunk.slice(0, 200)}`);
    return m[1]!;
  });
}

/** what the card's own tags claim it is — the alt text, the art fallback (what
 * is on screen when the .jpg 404s) and `data-prev` (what a right-click, the
 * focus rail and the hover tip resolve through) */
function claimsOf(html: string, id: EntityId): { alt: string; fallback: string; prev: string } {
  const chunk = scansOf(html, id)[0]!;
  const alt = /<img [^>]*alt="([^"]*)"/.exec(chunk);
  const fallback = /<div class="artfallback">([^<]*)</.exec(chunk);
  const prev = /data-prev="([^"]*)"/.exec(chunk);
  assert.ok(alt && fallback && prev, `entity ${id}'s scan is missing its name tags`);
  return { alt: alt[1]!, fallback: fallback[1]!, prev: prev[1]! };
}

/** the live stat plate: the effective pair, and the printed pair under it when
 * the client is showing one. `base === null` means it printed a bare "p/t" —
 * which on a copy is the marking having gone missing. */
function statsOf(html: string, id: EntityId): { live: string; base: string | null; cls: string | null } {
  const chunk = scansOf(html, id)[0]!;
  const changed = /<div class="stats"><span class="(statup|statdown)">(\d+\/\d+)<\/span><span class="basestat">(\d+\/\d+)<\/span>/.exec(chunk);
  if (changed) return { live: changed[2]!, base: changed[3]!, cls: changed[1]! };
  const plain = /<div class="stats">(\d+\/\d+)<\/div>/.exec(chunk);
  assert.ok(plain, `entity ${id}'s scan has no stat plate: ${chunk.slice(0, 300)}`);
  return { live: plain[1]!, base: null, cls: null };
}

/** the "little note at the bottom" the owner asked to keep: ui/cardtext.ts's
 * copy line, which is what the focus rail and the long-hover tip print under
 * the borrowed text box */
function copyNote(h: Harness, id: EntityId): string | undefined {
  const e = new E(h.state);
  return entityTextBox(e, ent(h, id)!).lines.find(l => l.origin === 'copy')?.text;
}

/* ═══ §1 BORROWER OF FORMS ════════════════════════════════════════════ */

test('R229 §1: a Borrower of Forms is DRAWN as the card it borrowed', () => {
  const h = new Harness(19801);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');                   // 7/5 {Piercing}
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  giveResources(h, A, 'metal', 7);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
  pick(h, { unit: whale });
  pass(h); pass(h);                                          // R147: one resolution

  const bof = unitsOf(h, A).find(u => u.card === 'Borrower of Forms')!;
  // disbelieve the ticket first: the engine really has put a face on this body
  assert.ok(bof, 'the Borrower body spawned');
  assert.equal(new E(h.state).nameOf(bof), 'Good Whale', 'and it really is wearing the face');
  assert.equal(bof.card, 'Borrower of Forms', 'R118 ruling 1: the cardboard is untouched');
  assert.ok(!ent(h, whale), 'the original was erased, so any Whale art on screen is the copy');

  const html = ui.show(structuredClone(h.state));

  // THE ASK: the picture follows the face.
  for (const file of artOf(html, bof.id)) {
    assert.equal(file, 'Good-Whale.jpg',
      'the board draws the borrowed card, not the cardboard (#108)');
  }
  const claims = claimsOf(html, bof.id);
  assert.equal(claims.alt, 'Good Whale', 'and says so to a screen reader');
  assert.equal(claims.fallback, 'Good Whale', 'and in the art fallback, when the .jpg is missing');
  assert.equal(claims.prev, 'Good Whale',
    'and the hover/right-click hook resolves to the card that is on screen');
  assert.ok(!html.includes('Borrower-of-Forms.jpg'),
    'the cardboard\'s own art is nowhere on the board');

  // THE OTHER HALF OF THE ASK: the markings that say it is a copy survive.
  const st = statsOf(html, bof.id);
  assert.deepEqual(effStats(h, bof.id), [7, 5], 'the borrowed body');
  assert.equal(st.live, '7/5', 'the live pair is the borrowed one');
  assert.equal(st.cls, 'statup', 'and it is COLOURED — the green the owner asked to keep');
  assert.equal(st.base, '2/2',
    'over Borrower of Forms\' own printed 2/2 — the plate is what marks it as a copy');
  assert.match(copyNote(h, bof.id) ?? '', /copy of Good Whale.*card itself is Borrower of Forms/,
    'and the little note at the bottom still names the card that will bin');
});

/* ═══ §2 APEX PRIME — N BODIES, ONE RESOLUTION ════════════════════════ */

test('R229 §2: Apex Prime redraws EVERY unit it copied onto, in one resolution', () => {
  const h = new Harness(19802);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ap = spawn(h, A, 'Apex Prime');                      // 4/4
  const t1 = spawn(h, A, 'Unit Token');                      // 1/1
  const t2 = spawn(h, A, 'Unit Token');                      // 1/1
  const whale = spawn(h, D, 'Good Whale');                   // 7/5
  h.state.players[A]!.life = 29;                             // "if your life total is odd"
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ap, t1], [t2]] });   // R72: 2 per column
  pick(h, { unit: whale });                                  // R67: declared at cast
  pass(h); pass(h);
  pick(h, true);                                             // "you MAY"

  const e = new E(h.state);
  for (const id of [ap, t1, t2]) {
    assert.equal(e.nameOf(ent(h, id)!), 'Good Whale', `entity ${id} really wears the face`);
  }
  const html = ui.show(structuredClone(h.state));

  for (const id of [ap, t1, t2]) {
    for (const file of artOf(html, id)) {
      assert.equal(file, 'Good-Whale.jpg', `entity ${id} is drawn as the copied card`);
    }
  }
  assert.ok(!html.includes('Apex-Prime.jpg'),
    'including Apex Prime itself, which copies onto ALL of your units — itself included');
  // the ORIGINAL is still on the board and still itself: the fix follows faces,
  // it does not repaint every card that shares a name
  assert.deepEqual(artOf(html, whale), ['Good-Whale.jpg'], 'the real Whale is unchanged');

  // and the markings: an until-regroup face over three different cardboards
  assert.deepEqual(statsOf(html, ap), { live: '7/5', base: '4/4', cls: 'statup' },
    'Apex Prime\'s own printed 4/4 still shows under the borrowed body');
  assert.deepEqual(statsOf(html, t1), { live: '7/5', base: '1/1', cls: 'statup' },
    'and a token\'s 1/1 under its');
  for (const id of [ap, t1, t2]) {
    assert.match(copyNote(h, id) ?? '', /copy of Good Whale until regroup/,
      'each note says how long the face lasts');
  }
});

/* ═══ §3 THE GUARD: ANCIENT ONE MUST NOT MOVE ═════════════════════════ */

test('R229 §3: an Ancient One keeps its OWN art — a projection is not an identity', () => {
  const h = new Harness(19803);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ancient = spawn(h, A, 'Ancient One');                // 1/1
  const whale = spawn(h, A, 'Good Whale');                   // 7/5 {Piercing}
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  // adjacent in ONE column, so the projection is live
  h.do({ type: 'declareAttack', seat: A, columns: [[ancient, whale]] });

  const e = new E(h.state);
  // ⚠ the projection has to be REALLY RUNNING or this guard proves nothing
  assert.ok(e.adjacentInFormation(ancient).map(u => u.id).includes(whale),
    'the Whale is adjacent — the Ancient One is projecting from it right now');
  assert.ok(e.facesWith(ent(h, ancient)!, 'statics').includes('Good Whale'),
    'and the face really is in `facesWith`, which is what an over-broad fix would read');
  assert.equal(e.nameOf(ent(h, ancient)!), 'Ancient One',
    'but `nameOf` is unmoved: R127 omits the `name` facet on purpose');

  const html = ui.show(structuredClone(h.state));
  for (const file of artOf(html, ancient)) {
    assert.equal(file, 'Ancient-One.jpg',
      'so the Ancient One keeps its own portrait — a fix reading facesOf/facesWith fails here');
  }
  assert.equal(claimsOf(html, ancient).alt, 'Ancient One', 'and its own name');
  assert.deepEqual(statsOf(html, ancient), { live: '1/1', base: null, cls: null },
    'and a bare 1/1: nothing about it is a copy, so nothing about it is marked as one');
  assert.ok(!scansOf(html, ancient)[0]!.includes('⧉'),
    'and no copy chip either — see §3b, which is where that chip is earned');
});

/* ═══ §3b THE HOLE THE ART FIX OPENS, AND THE CHIP THAT CLOSES IT ═════ */

test('R229 §3b: a copy is marked even when the borrowed body matches its own', () => {
  /* The green plate marks a copy only when the numbers CHANGED. Borrower of
   * Forms prints 2/2 and Sporebloom Siren is a 2/2, so with the art now
   * following the face there was nothing left on the board to tell the copy
   * from the original — found in a real browser, not in this file. The ⧉ chip
   * is keyed on the one fact that is always true of a copy and never true of
   * anything else: the card on screen is not the cardboard.
   *
   * ⚠ And it must NOT appear on an Ancient One, for the same reason §3 exists:
   * a projection leaves `nameOf` alone, so the two names still agree. */
  const h = new Harness(19805);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const siren = spawn(h, D, 'Sporebloom Siren');             // 2/2 — Borrower prints 2/2 too
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  giveResources(h, A, 'metal', 7);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
  pick(h, { unit: siren });
  pass(h); pass(h);
  const bof = unitsOf(h, A).find(u => u.card === 'Borrower of Forms')!;

  const html = ui.show(structuredClone(h.state));
  assert.deepEqual(artOf(html, bof.id), ['Sporebloom-Siren.jpg'], 'drawn as the borrowed card');
  // the stat plate cannot mark this one: both cards are 2/2
  assert.deepEqual(statsOf(html, bof.id), { live: '2/2', base: null, cls: null },
    'nothing changed, so there is no green plate — this is the case the chip is for');
  const chunk = scansOf(html, bof.id)[0]!;
  assert.match(chunk, /class="badge mod[^"]*" title="a copy — the card itself is Borrower of Forms/,
    'the ⧉ chip says which cardboard it is, whatever the numbers do');

  // and the guard: no chip where no identity was replaced
  assert.ok(!scansOf(html, atk)[0]!.includes('⧉'), 'an ordinary unit carries no copy chip');
});

/* ═══ §4 THE PHYSICAL CARD IS STILL THE PHYSICAL CARD ═════════════════ */

test('R229 §4: the borrowed face is a PICTURE — the bin still shows the cardboard', () => {
  // R118 ruling 1 in the one place a player can check it without hovering: a
  // Borrower that died bins as Borrower of Forms, and the bin draws that card.
  // If the art fix had been done by rewriting `Entity.card` — the shortcut R118
  // forbids — this is what would have broken.
  const h = new Harness(19804);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  giveResources(h, A, 'metal', 7);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
  pick(h, { unit: whale });
  pass(h); pass(h);
  const bof = unitsOf(h, A).find(u => u.card === 'Borrower of Forms')!;

  const before = ui.show(structuredClone(h.state));
  assert.deepEqual(artOf(before, bof.id), ['Good-Whale.jpg'], 'alive: it is a Whale');

  const e = new E(h.state);
  e.destroy(e.entity(bof.id)!, 'dies');
  e.settle();
  h.state = e.s;
  assert.ok(h.state.players[A]!.bin.includes('Borrower of Forms'),
    'R118 ruling 1: the card that bins is the one that came out of the deck');

  const after = ui.show(structuredClone(h.state));
  assert.ok(after.includes('data-prev="Borrower of Forms"'),
    'and the bin draws THAT card — the face never touched Entity.card');
  assert.ok(!after.includes('data-previd="' + bof.id + '"'), 'the body is off the board');
});
