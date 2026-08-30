/**
 * R249 — THE SPENT-BUDGET MARKER FOLLOWS THE ABILITY, NOT THE CLIENT.
 *
 * Playtest report #120, and it is a RE-REPORT of the one R135 answered:
 *
 *   "The UI bug I reported about the 'once' effects showing the wrong icon
 *    once expended has now flip flopped. The [Switch1] and [once] effects are
 *    DIFFERENT, despite being very similar functionally. The game should use
 *    the one actually relevant to the unit to show expended/used 'once per
 *    turn' effects."
 *
 * ── the shape ────────────────────────────────────────────────────────
 *
 * Before R135 the note said `[Switch1]` for every spent budget; R135 made it
 * say `[Once]` for every spent budget. Two constants, one report each, and
 * the second report is the first one with the sides swapped — the #46 → #60 →
 * #75 shape this repo keeps catching. Neither fix was ever ABOUT the card: a
 * marker that does not read the card cannot be right on both halves of a pool
 * where 64 cards print one marker and 22 print the other.
 *
 * So the guards here are not "it says [Once] on this card". They are:
 *
 *   * one live board per marker, spent by the ENGINE and read off the box;
 *   * the same for the graft and augment-donated notes, whose markers come
 *     from the MOD and not from the host;
 *   * a WHOLE-POOL sweep: all 88 cards with a bounded ability, every one of
 *     them actually spent through `E.composeParts` (the engine's own budget
 *     reservation — never a hand-written key), each note compared against an
 *     expectation derived through a DIFFERENT channel than the one under test;
 *   * the two pool invariants that make a per-clause read exact, so that a
 *     future card which breaks either one fails here instead of silently
 *     going back to a coin flip.
 *
 * ── what R249 did NOT overturn ───────────────────────────────────────
 *
 * R135 said three things and only one of them moved. The note is still SHORT
 * (it does not restate `ab.label`), the augment and graft lines still do not
 * repeat the icon their own tag shows, and {Unstable} still rides in `state` —
 * all still guarded in test/122. What moved is the claim that the note is
 * tagged `[Once]` ALWAYS. See `ui/cardtext.ts budgetMarker` for why that claim
 * does not survive the `note` tag as it is actually rendered ("⏳ spent", which
 * carries no symbol for the text to duplicate).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { ent, spawn, toDeployment } from './util.ts';
import {
  augmentClause, budgetMarker, entityTextBox, iconizeText, ownClause, switchClause,
} from '../../ui/cardtext.ts';
import type { CardName, Entity, Seat } from '../src/types.ts';

function board(seed: number): { e: E; h: Harness; A: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  return { e: new E(h.state), h, A };
}

/** the one `note` line on a unit box, or a readable failure */
function spentNote(e: E, u: Entity): string {
  const notes = entityTextBox(e, u).lines.filter(l => l.origin === 'note');
  assert.equal(notes.length, 1, `exactly one spent note on ${u.card}: ${JSON.stringify(notes)}`);
  assert.equal(notes[0]!.active, false, 'a spent budget is always struck through');
  return notes[0]!.text;
}

/**
 * The marker a clause SHOWS, measured through the renderer rather than
 * through the regex `budgetMarker` uses.
 *
 * This is the second channel the pool sweep needs: `iconizeText` resolves a
 * bracket token through `TEXT_ICON`, so it answers "which icon does the player
 * see on this clause" by a completely different route from "does this string
 * match /\[switch1\]/". A change that broke only one of the two shows up as a
 * disagreement instead of as two tests moving together.
 */
function markerShownBy(clause: string): '[Switch1]' | '[Once]' {
  return iconizeText(clause).includes('data/icons/bounded_graft.webp') ? '[Switch1]' : '[Once]';
}

/** every card in the pool with at least one bounded ability, and where it is */
function boundedPool(): { name: CardName; ability: number[]; augment: number[] }[] {
  const out: { name: CardName; ability: number[]; augment: number[] }[] = [];
  for (const name of allCardNames()) {
    const def = getCard(name);
    const ability = (def.abilities ?? []).flatMap((a, i) => (a.bounded ? [i] : []));
    const augment = (def.augmentText ?? []).flatMap((a, i) => (a.bounded ? [i] : []));
    if (ability.length || augment.length) out.push({ name, ability, augment });
  }
  return out;
}

// ── 1. the two live boards, one per marker ───────────────────────────
//
// Both spend their budget by PLAYING, not by poking `budgets`: the whole
// failure mode being guarded is a display that does not read the card, and a
// test that stamps its own key would be free to be wrong about the key too.

test('R249: a spent bounded GRAFT ability wears the [Switch1] its own card prints', () => {
  const { e, h, A } = board(22800);
  // "After combat, [Switch1] Put a +1/+1 counter on each of your units."
  const se = spawn(h, A, 'Synaptic Energizer');
  assert.ok(/\[switch1\]/i.test(getCard('Synaptic Energizer').text ?? ''),
    'the card prints [Switch1] — that is the premise of this guard');
  e.composeParts(ent(h, se)!, 0, 'ability');          // the engine reserves it

  const note = spentNote(e, ent(h, se)!);
  assert.ok(note.startsWith('[Switch1]'), `the marker the card prints: ${note}`);
  assert.ok(!/\[once\]/i.test(note), `and not the other one: ${note}`);
  assert.ok(iconizeText(note).includes('data/icons/bounded_graft.webp'),
    'so the player sees the bounded-graft symbol, which is what the ability is');
});

test('R249: a spent [once] ability wears [Once] — the same code, the other card', () => {
  const { e, h, A } = board(22801);
  // "[once] When another ally with greater defense than power spawns, draw a
  // card." — fired for real by spawning a 2/3 next to it, so the budget below
  // is the one the ENGINE wrote in play and not one this test invented.
  const oracle = spawn(h, A, 'Nectar Ridge Oracle');
  spawn(h, A, 'Bumblecrab');
  assert.deepEqual(Object.values(ent(h, oracle)!.budgets), [1],
    'the trigger really fired and really spent its budget');

  const note = spentNote(e, ent(h, oracle)!);
  assert.ok(note.startsWith('[Once]'), `the marker THIS card prints: ${note}`);
  assert.ok(!/\[switch1\]/i.test(note), `and not the other one: ${note}`);
  assert.ok(iconizeText(note).includes('data/icons/once.webp'), 'rendered as the once symbol');
});

// ── 2. the notes whose marker belongs to a MOD, not to the host ──────

test('R249: a spent bounded graft rider takes its marker from the mod, not the host', () => {
  const { e, h, A } = board(22802);
  // Spewing Mushroom prints an UNBOUNDED [Switch] cause, so the only spent
  // budget on this board belongs to the rider — and the rider is a different
  // card from the host, which is the whole point of this site.
  const host = spawn(h, A, 'Spewing Mushroom');
  assert.equal(getCard('Spewing Mushroom').abilities![0]!.bounded, undefined,
    'the host is unbounded — it contributes no note of its own');
  assert.equal(getCard('Recall').graftEffect!.bounded, true, 'the rider is the bounded half');
  e.attachMod(ent(h, host)!, 'Recall', A, 'graft');
  e.settle();
  e.composeParts(ent(h, host)!, 0, 'ability');

  const note = spentNote(e, ent(h, host)!);
  assert.ok(note.startsWith('[Switch1]'), `the RIDER prints [Switch1]: ${note}`);
  assert.ok(note.includes('Recall'), 'and the note names which mod is spent');
  assert.equal(budgetMarker(switchClause('Recall')), '[Switch1]',
    'read off the transferred half of the mod card, which is what a graft IS');
});

test('R249: an augment-donated bounded ability takes the marker of the donor', () => {
  const { e, h, A } = board(22803);
  // "[Augment][once] Gain 2 debt: I gain +3/+3 until regroup." on a host that
  // prints the OTHER marker. The two cards disagree on purpose: a note that
  // read the host, or the whole box, or anything but the donated clause, comes
  // out [Switch1] here.
  const host = spawn(h, A, 'Synaptic Energizer');
  assert.equal(budgetMarker(ownClause('Synaptic Energizer')), '[Switch1]',
    'the host prints the marker this note must NOT use');
  e.attachMod(ent(h, host)!, 'Debt Blep', A, 'augment');
  e.settle();
  e.composeParts(ent(h, host)!, 0, 'augment', 'Debt Blep');

  const note = spentNote(e, ent(h, host)!);
  assert.ok(note.startsWith('[Once]'), `the DONOR prints [once]: ${note}`);
  assert.ok(note.includes('Debt Blep'), 'and the note names which mod is spent');
  assert.equal(budgetMarker(augmentClause('Debt Blep')), '[Once]',
    'read off the donated half of the mod card, which is what an augment IS');
});

test('R249: a card whose OWN augment box is spent reads that box, not its type line', () => {
  // The fourth emit site: `augment:<this card>#i` on the card's own budgets.
  // It is the rarest of the four and the easiest to leave behind on a sweep
  // that only counted the obvious three, which is exactly why it is here.
  const { e, h, A } = board(22804);
  const blep = spawn(h, A, 'Debt Blep');
  e.composeParts(ent(h, blep)!, 0, 'augment');
  const note = spentNote(e, ent(h, blep)!);
  assert.ok(note.startsWith('[Once]'), `its own [Augment][once] box: ${note}`);
});

// ── 3. the whole pool, spent for real, one card at a time ────────────

test('R249: every card in the pool with a bounded ability gets the marker it prints', () => {
  // 88 cards, each spawned and each budget reserved through E.composeParts —
  // the engine's own reservation, so the budget KEY is never something this
  // test knows how to spell. The expectation comes back through iconizeText,
  // a different channel from the regex under test.
  const { e, A } = board(22805);
  const wrong: string[] = [];
  const tally: Record<string, number> = { '[Switch1]': 0, '[Once]': 0 };
  let covered = 0;

  for (const { name, ability, augment } of boundedPool()) {
    const u = e.spawnUnit(A, name, e.homeRegion(A));
    for (const i of ability) e.composeParts(u, i, 'ability');
    for (const i of augment) e.composeParts(u, i, 'augment');
    const note = entityTextBox(e, u).lines.find(l => l.origin === 'note');
    if (!note) { wrong.push(`${name}: spent its budget and showed no note at all`); continue; }
    // which half of the printed text this budget belongs to — the same split
    // the box makes, and the reason a card could never lend the wrong marker
    // to its other half
    const clause = ability.length ? ownClause(name) : augmentClause(name);
    const want = markerShownBy(clause);
    const got = (/^\[(?:Once|Switch1)\]/.exec(note.text) ?? [])[0];
    if (got !== want) wrong.push(`${name}: note says ${got}, its clause shows ${want}`);
    else tally[want] = (tally[want] ?? 0) + 1;
    covered++;
  }

  assert.deepEqual(wrong, [], 'every note wears the marker its own clause shows');
  assert.equal(covered, 88,
    `the pool has 88 cards with a bounded ability and all 88 were spent here (got ${covered})`);
  // and BOTH markers are genuinely in use — a regression that collapses the
  // two back to one constant passes every card-by-card check above by
  // agreeing with itself, and is caught only here
  assert.ok(tally['[Switch1]']! > 0 && tally['[Once]']! > 0,
    `both markers reach the screen: ${JSON.stringify(tally)}`);
  assert.deepEqual(tally, { '[Switch1]': 64, '[Once]': 24 },
    'the split today: 64 print [Switch1], 22 print [once], and 2 spell their '
    + 'budget in prose and fall back to [Once]');
});

// ── 4. the invariants that make a per-CLAUSE read exact ──────────────

test('R249: no card prints both markers, and none has two bounded abilities', () => {
  // Both of these are what let one clause answer for one budget. If a future
  // card breaks either, the marker becomes a guess again — and the box has now
  // been wrong in both directions once each, so a guess is not acceptable.
  const both: string[] = [];
  const two: string[] = [];
  for (const { name, ability, augment } of boundedPool()) {
    const text = getCard(name).text ?? '';
    if (/\[switch1\]/i.test(text) && /\[once\]/i.test(text)) both.push(name);
    if (ability.length + augment.length > 1) two.push(`${name} (${ability.length}+${augment.length})`);
  }
  assert.deepEqual(both, [],
    'a card printing both markers would need its clauses split before the note can name one');
  assert.deepEqual(two, [],
    'a card with two bounded abilities would need the note to say WHICH, which R135 '
    + 'removed on the grounds that no card has two');

  // the graft half of the same invariant: a bounded rider always prints
  // [Switch1] and an unbounded one never does, so the graft note can read the
  // mod card and be sure of the answer
  const odd: string[] = [];
  for (const name of allCardNames()) {
    const g = getCard(name).graftEffect;
    if (!g) continue;
    const prints = /\[switch1\]/i.test(getCard(name).text ?? '');
    if (!!g.bounded !== prints) odd.push(`${name}: bounded=${!!g.bounded} prints[Switch1]=${prints}`);
  }
  assert.deepEqual(odd, [], 'bounded graft donors are exactly the ones printing [Switch1]');
});

test('R249: the fallback is [Once], and only two cards in the pool reach it', () => {
  // The Bonesculptor ("each deployment") and Gridxlan ("during deployment")
  // spell their budget in prose. R135s answer is kept for exactly these: with
  // nothing printed to follow, the note names the budget.
  const prose = boundedPool()
    .map(b => b.name)
    .filter(n => !/\[switch1\]|\[once\]/i.test(getCard(n).text ?? ''));
  assert.deepEqual(prose.sort(), ['Gridxlan', 'The Bonesculptor'],
    'the two cards with a budget and no printed marker');
  assert.equal(budgetMarker('You may play one unit from your bin each deployment.'), '[Once]',
    'an unmarked clause falls back to the budget symbol');
  assert.equal(budgetMarker(''), '[Once]', 'and so does an empty one');
});

test('R249: the two halves of a printed card are read separately', () => {
  // `ownClause` is the complement of `augmentClause`. ⚠ SWAPPING THE TWO AT
  // the host emit site is a NO-OP against today's pool — no card has both a
  // bounded `abilities[]` and an `[Augment]` box, so both scopes return the
  // same marker on all 88 cards and no board-level test can tell them apart.
  // That is not a reason to drop the split; it is a reason for THIS test,
  // which pins the fact the split rests on, so a card that ends the coincidence
  // fails here rather than quietly making the host site a guess again.
  const mixedPool = boundedPool()
    .filter(b => b.ability.length && /\[augment\]/i.test(getCard(b.name).text ?? ''))
    .map(b => b.name);
  assert.deepEqual(mixedPool, [],
    'no card in the pool has a bounded abilities[] AND a donated [Augment] box');

  const mixed = 'When I attack, [Switch1] Draw a card. [Augment][once] Gain 2 debt: I gain +3/+3.';
  assert.equal(budgetMarker(mixed.slice(0, mixed.indexOf('[Augment]'))), '[Switch1]');
  assert.equal(ownClause('Debt Blep'), '',
    'a card that opens with [Augment] has no clause of its own');
  assert.ok(augmentClause('Debt Blep').includes('[once]'),
    'and its whole budget lives in the donated box');
  assert.ok(!/\[augment\]/i.test(ownClause('Graxxlid')),
    'the [Augment] box never leaks into the half the abilities[] implement');
});
