/* R271 — FOUR OWNER REPORTS AND ONE TICKET, ALL ON THE STACK STRIP AND THE
 * FOCUS CARD.
 *
 *  [#140] (ERJZ 234) "There's a weird massive graft icon on Spellbind as it's
 *         on the stack…"
 *  [#141] (ERJZ 235) "Cards on the stack that are modded should show the
 *         little modded effect under them when hovering, just like a modded
 *         unit."
 *  [#143] (QJEY 72)  "Instead of putting Unstable reminder text at the bottom
 *         of a card ('Unstable — it is modded; it is erased instead of binned
 *         (Manual p.35)') put it in it's attribute line"
 *  [#146] (QJEY 334) "In the focus card window, the mods are shown attached to
 *         the unit with a TON of extra space in order to fit the badge. That
 *         extra space/badge isn't needed. Just have the bottom of the card
 *         peek through according to where the augment/graft symbol is"
 *  [CT-142, its no-ruling half] the client labels a FIZZLED stack item
 *         "resolved" — it asserts the opposite of the truth about the very row
 *         the four reports above are about.
 *
 * ── WHAT THE TICKET GOT RIGHT, AND THE ONE THING IT GOT WRONG ────────
 *
 * CT-142 says ui/main.ts "labels a fizzled stack item 'resolved'". True — and
 * only on ONE of the two fizzle paths, which matters because it is the path a
 * fixture is least likely to reach by accident.
 *
 *   · an item nobody may respond to is snapshotted by `stackFlash` BEFORE it
 *     resolves (engine.ts commitItem) and then fizzles inside the same batch.
 *     The client has a copy, draws the beat, finds `negated` false, and prints
 *     "resolved" over a spell that did nothing. That is the ticket's bug.
 *   · an item that fizzles on the REAL stack emits no `stackFlash` at all.
 *     Before R271 the client had no beat to label: the card simply VANISHED
 *     off the strip. Not a lie, but the ticket's own verify line — "fizzle a
 *     spell by removing its only target in response; the stack entry reads
 *     'resolved'" — describes this path, and this path said nothing at all.
 *
 * §1 builds the second one, because it is the one a player meets and the one
 * the ticket tells you to reproduce. §2 pins that the word can never again be
 * one of the other three, in the one place all five are now decided
 * (ui/flash.ts rowState).
 *
 * ── THE HOUSE RULE ABOUT TESTING ui/main.ts (225) ────────────────────
 *
 * §1, §3 and §5d read the markup the REAL client really produced through
 * test/ui-driver.ts; nothing asserts on main.ts as source text except §4b,
 * which is about a class NOT being emitted anywhere and has no other shape.
 * §3's list of chips is derived from that markup rather than typed here, so a
 * chip added tomorrow walks into the guard on its own.
 *
 * Seeds 25100-25199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import { ent, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';
import { HOLD_MS, queueFlashes, rowState, stackRows } from '../../ui/flash.ts';
import type { Flash, RowState, StackRow } from '../../ui/flash.ts';
import { modStrips } from '../../ui/inspect.ts';
import { entityTextBox, printedTextBox } from '../../ui/cardtext.ts';
import { GLOSSARY } from '../../ui/glossary.ts';
import PRINTED from '../src/cards/printed.json' with { type: 'json' };
import type { Action, EngineEvent, GameState, Seat, StackItem } from '../src/types.ts';

const STYLE = readFileSync(new URL('../../ui/style.css', import.meta.url), 'utf8');
const MAIN_SRC = readFileSync(new URL('../../ui/main.ts', import.meta.url), 'utf8');
const CARDS = PRINTED as Record<string, { type?: string; text?: string }>;

/* the client, built once and up front: `client()` is async only because it
 * awaits the import that installs the page, and the stopped clock below cannot
 * span an await. */
const ui = await client();

/* ── the clock (160's, and for 160's reason) ─────────────────────────── */
const REAL_NOW = Date.now;
let base = 25_100_000;
function at<T>(now: number, fn: () => T): T {
  Date.now = () => now;
  try { return fn(); } finally { Date.now = REAL_NOW; }
}

const q = (h: Harness): E => new E(h.state);

/** the whole `<div class="stackcard …">…</div>` for one stack id, or null */
function stackCard(html: string, id: number): string | null {
  const at0 = html.indexOf(`data-act="stackitem" data-id="${id}"`);
  if (at0 < 0) return null;
  const start = html.lastIndexOf('<div', at0);
  let i = html.indexOf('>', at0), depth = 1;
  while (depth > 0 && i >= 0) {
    const open = html.indexOf('<div', i), close = html.indexOf('</div>', i);
    if (close < 0) return null;
    if (open >= 0 && open < close) { depth++; i = open + 4; } else { depth--; i = close + 6; }
  }
  return html.slice(start, i);
}

/* ══ §1 — CT-142: A FIZZLE IS NOT A RESOLUTION ═══════════════════════════
 *
 * 05-rulings' own R5 fixture, which is the ticket's verify line verbatim: a
 * spell unit on the stack, its only target killed under it in response, so it
 * reaches resolution with nothing left to aim at.
 */
interface Fizzle {
  h: Harness;
  seat: Seat;
  /** the state with the doomed item still on the stack */
  before: GameState;
  /** the id of the item that is going to fizzle */
  item: number;
  /** the batch that fizzles it */
  events: EngineEvent[];
}

function jellyFizzle(seed: number): Fizzle {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const target = spawn(h, A, 'Good Whale');
  giveResources(h, D, 'water', 3);
  giveResources(h, A, 'fire', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[target]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Jelly') });
  pick(h, { unit: target });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: target });
  pass(h); pass(h);                                  // the Arc resolves; the whale dies
  assert.ok(!ent(h, target), 'the fixture really removed the only target');
  pass(h);                                           // …and the window that follows it
  const jelly = h.state.stack.find(i => i.card === 'Jelly');
  assert.ok(jelly, 'Jelly really is still on the stack, waiting to fizzle');
  assert.equal(h.state.stack.length, 1, 'and it is the only thing on it');
  // WHOSE SCREEN. Both seats see the same strip, but R150 holds an update the
  // viewer cannot act on, and a held update never reaches the beat queue at
  // all (160 carries the same construction note) — so the fixture is read from
  // the seat that holds priority when the fizzle lands.
  const seat = h.state.priority as Seat;
  const before = structuredClone(h.state) as GameState;
  const mark = h.events.length;
  pass(h);
  const events = h.events.slice(mark).map(e => structuredClone(e));
  return { h, seat, before, item: jelly!.id, events };
}

/** join the pre-fizzle board, then deliver the batch that fizzles it — the
 * shape the server really sends, and the only one in which the client's own
 * memory of the stack (`rememberStack`) has the item in it. */
function showFizzle(f: Fizzle, now: number): string {
  const legal: Action[] = legalActions(f.before, f.seat);
  assert.ok(legal.length, 'the seat can act, so R150 will not hold the update out of reach');
  return at(now, () => {
    ui.join(viewFor(f.before, f.seat), f.seat, legal);
    return ui.update(viewFor(f.h.state, f.seat), legalActions(f.h.state, f.seat), { events: f.events });
  });
}

test('R271 §1a the batch really fizzles it, and says so the way negate says it', () => {
  const f = jellyFizzle(25101);
  // NON-VACUITY FIRST (house rule 5). Everything below is a claim about how
  // the client draws a `fizzled` event; if the engine stopped emitting one
  // with an `id`, every assertion in §1 would pass on an empty set.
  const fizz = f.events.filter(e => e.type === 'fizzled');
  assert.equal(fizz.length, 1,
    `exactly one fizzle in the batch: ${JSON.stringify(f.events.map(e => e.type))}`);
  assert.equal(fizz[0]!.data?.['id'], f.item,
    'and it carries the item id — the same `{ id }` shape the negated event carries, '
    + 'which is the whole reason ui/flash.ts can reuse the negatedFlashItems mechanism');
  assert.ok(!f.h.state.stack.some(i => i.id === f.item), 'the fizzled item left the stack');
  assert.equal(f.events.filter(e => e.type === 'stackFlash').length, 0,
    'and NOTHING snapshotted it — which is why, before R271, the strip had no beat to label');
});

test('R271 §1b THE REPORT: the strip says the spell fizzled, not that it resolved', () => {
  const f = jellyFizzle(25102);
  const html = showFizzle(f, (base += 100_000));
  const card = stackCard(html, f.item);
  assert.ok(card,
    'the fizzled spell got NO beat at all — it vanished off the strip. A player who '
    + 'removed the only target in response is entitled to see that it worked.');
  assert.match(card!, /\bfizzled\b/,
    `the beat must say the item fizzled. It drew: ${card!.replace(/\s+/g, ' ')}`);
  assert.doesNotMatch(card!, />\s*resolved\s*</,
    'and must never say "resolved" — CT-142: the client asserting the opposite of the truth');
  assert.doesNotMatch(card!, /class="[^"]*\bnegated\b/,
    'a fizzle is not a negation: nobody answered this spell, it ran out of targets');
});

test('R271 §1c the caption under the strip agrees with the chip on it', () => {
  const f = jellyFizzle(25103);
  const html = showFizzle(f, (base += 100_000));
  const at0 = html.indexOf('class="stackcaption');
  assert.ok(at0 > 0, 'the strip has a caption');
  const cap = html.slice(at0, html.indexOf('</div>', html.indexOf('</span>', at0)) + 6);
  assert.match(cap, /fizzled/,
    `the one line of prose about the lead row must not call a fizzle a resolution: ${
      cap.replace(/\s+/g, ' ').trim()}`);
});

/* ══ §2 — the states are exclusive BY CONSTRUCTION ════════════════════════
 *
 * CT-142 asks for "a guard that the states stay mutually exclusive". Three
 * nested ternaries in three places cannot have that property; a function with
 * one return can, and `rowState` is that function. So the guard is over the
 * function, on every combination of the flags a row can carry — including the
 * combinations nothing can currently produce, because "it cannot happen" is
 * exactly what the old code assumed about a fizzle.
 */
const ROW = (o: Partial<StackRow>): StackRow => ({
  item: {
    id: 1, kind: 'spell', label: 'X', controller: 0 as Seat, region: 0,
    negated: false, parts: [],
  } as StackItem,
  flashing: false, top: false, resolving: false, fizzled: false, detached: false, ...o,
});

test('R271 §2a every row has exactly one state, and every state is reachable', () => {
  const ALL: RowState[] = ['answered', 'fizzled', 'resolved', 'resolving', 'waiting'];
  const seen = new Set<RowState>();
  for (const flashing of [false, true]) {
    for (const resolving of [false, true]) {
      for (const negated of [false, true]) {
        for (const fizzled of [false, true]) {
          const row = ROW({ flashing, resolving, fizzled });
          row.item = { ...row.item, negated };
          const st = rowState(row);
          seen.add(st);
          assert.ok(ALL.includes(st), `rowState invented a sixth state: ${st}`);
          // the ORDER is the one the board depends on: R78's "still going"
          // outranks every replay, because it is the answer to "why has
          // nothing happened yet?", and a negation outranks a fizzle because
          // an item somebody answered never reached the resolution that could
          // fizzle it.
          if (resolving) assert.equal(st, 'resolving', 'a resolving row is never a replay');
          else if (!flashing) assert.equal(st, 'waiting', 'a row still on the stack is waiting');
          else if (negated) assert.equal(st, 'answered');
          else assert.equal(st, fizzled ? 'fizzled' : 'resolved');
        }
      }
    }
  }
  assert.deepEqual([...seen].sort(), ALL,
    'all five states are reachable from some row — one nothing can produce is dead code');
});

test('R271 §2b a fizzle and a negation are never the same beat', () => {
  const f = jellyFizzle(25104);
  const seen = new Map<number, StackItem>(
    f.before.stack.map(i => [i.id, structuredClone(i) as StackItem]));
  const queue: Flash[] = queueFlashes([], f.events, 1_000_000, seen);
  const mine = queue.filter(x => x.item.id === f.item);
  assert.equal(mine.length, 1, 'one beat for the fizzled item, drawn from `seen`');
  assert.equal(mine[0]!.fizzled, true, 'and it is marked as a fizzle');
  assert.equal(mine[0]!.item.negated, false, 'and NOT as a negation');
  assert.equal(mine[0]!.detached, true,
    'and as DETACHED — the card really left the stack, so it must not get a phantom '
    + 'census slot or it would pop into the bin instead of flying there');

  const rows = stackRows(f.h.state.stack, queue, 1_000_000 + HOLD_MS / 2, null);
  const row = rows.find(r => r.item.id === f.item);
  assert.ok(row, 'the beat is on the visual stack while it lasts');
  assert.equal(rowState(row!), 'fizzled');
});

/* ══ §3 — [#140] a 15px game icon in an 8px chip ══════════════════════════
 *
 * `img.txticon` is 15px square and its selector is (0,1,1), so it beats every
 * bare-class rule and there is no font-size for it to inherit. Every small
 * chip in the client therefore has to name itself — `.card .badge .txticon`
 * and `.zonelabel .txticon` already do — and the stack strip never did.
 *
 * THE LIST OF CHIPS IS DERIVED FROM THE MARKUP THE CLIENT REALLY DREW, not
 * typed here: whatever element the board puts a `txticon` inside of, inside a
 * `.stackcard`, is what has to be sized.
 */
function moddedSpellOnStack(seed: number): { h: Harness; seat: Seat; item: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const atk = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const seat = h.state.priority as Seat;
  for (const kind of ['dark', 'wood'] as const) giveResources(h, seat, kind, 8);
  give(h, seat, 'Pernicious Photosynthesis');
  h.do({ type: 'playCard', seat, handIndex: give(h, seat, 'Spellbind') });
  // {Modular} collects its mods at cast, one at a time, until the caster says
  // no more: take the offer that names THIS mod while there is one, then stop.
  for (let i = 0; i < 16 && h.state.decision; i++) {
    const d = h.state.decision;
    const opts = d.options.map(o => JSON.stringify(o));
    const wants = opts.findIndex(o => o.includes('Pernicious'));
    const done = opts.findIndex(o => o.includes('doneMods'));
    h.do({ type: 'decide', seat: d.seat, choice: wants >= 0 ? wants : done >= 0 ? done : 0 });
  }
  const it = h.state.stack.find(i => i.card === 'Spellbind');
  assert.ok(it, 'Spellbind reached the stack');
  assert.equal((it!.mods ?? []).length, 1,
    `and it is carrying its {Modular} mod — report #140 is about a modded stack card: ${
      JSON.stringify(it!.mods)}`);
  return { h, seat, item: it!.id };
}

test('R271 §3 no game icon on the stack strip is drawn at its full size', () => {
  const base15 = /img\.txticon\s*\{[^}]*width:\s*(\d+)px/.exec(STYLE);
  assert.ok(base15, 'style.css still states one base size for a text icon');
  const full = Number(base15![1]);

  const f = moddedSpellOnStack(25105);
  const html = at((base += 100_000), () =>
    ui.join(viewFor(f.h.state, f.seat), f.seat, legalActions(f.h.state, f.seat)));
  const card = stackCard(html, f.item);
  assert.ok(card, 'the modded Spellbind is on the strip');

  // DERIVED: every element inside the stack card that contains a txticon
  const chips = [...card!.matchAll(/<div class="(stack[a-z]+)"[^>]*>((?:(?!<\/div>)[\s\S])*)<\/div>/g)]
    .filter(m => m[2]!.includes('class="txticon"'))
    .map(m => m[1]!);
  assert.ok(chips.length,
    'report #140 is about a game icon inside a stack chip and the fixture drew none — '
    + `the strip's card was: ${card!.replace(/\s+/g, ' ')}`);

  for (const chip of [...new Set(chips)]) {
    const rule = new RegExp(`\\.${chip}\\s+\\.txticon[^{]*\\{[^}]*width:\\s*(\\d+)px`).exec(STYLE);
    assert.ok(rule,
      `.${chip} draws a game icon and style.css gives it no size of its own, so it renders `
      + `at ${full}px inside an 8px chip — report #140's "weird massive graft icon"`);
    assert.ok(Number(rule[1]) < full,
      `.${chip}'s icon is ${rule[1]}px, no smaller than the ${full}px default`);
  }
});

/* ══ §4 — [#141] + [#146] the mods peeking out from under a card ══════════ */

test('R271 §4a a modded stack item composes the same picture as a modded unit', () => {
  const f = moddedSpellOnStack(25106);
  const it = f.h.state.stack.find(i => i.id === f.item)!;
  const stackStrips = modStrips(it.mods ?? []);
  assert.equal(stackStrips.length, (it.mods ?? []).length,
    '#141: one strip per mod, on the stack too — R35/R105, the mods ride WITH the card');
  assert.match(stackStrips[0]!.title, /Pernicious Photosynthesis/,
    'and the strip still names the card: #146 takes the printed badge off the picture, '
    + 'not the fact off the page');

  const h = new Harness(25107);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  {
    const e = q(h);
    e.attachMod(ent(h, host)!, 'Refuse Reclaimer', A, 'augment');
    e.settle();
  }
  const u = ent(h, host)!;
  assert.ok(u.mods.length, 'the unit really is modded');
  const unitStrips = modStrips(u.mods.map(id => {
    const m = h.state.entities[id]!;
    return { card: m.card, ...(m.appliedAs ? { appliedAs: m.appliedAs } : {}) };
  }));
  assert.equal(unitStrips.length, u.mods.length,
    'one strip per mod on a unit too — the two surfaces cannot drift, because they are '
    + 'one function');
  assert.match(unitStrips[0]!.title, /augmenting/,
    'a unit mod knows HOW it was applied and says so');
});

test('R271 §4b [#146] the strip carries no badge, and its peek is one named number', () => {
  assert.doesNotMatch(STYLE, /\.modtag\b/,
    '#146: "That extra space/badge isn\'t needed" — the .modtag rule is what the band '
    + 'was made tall enough to fit');
  assert.ok(!MAIN_SRC.includes('modtag'),
    'and nothing emits the class any more — deleting a rule out from under live markup '
    + 'is a half-fix, and this repo has paid for that shape before');

  const peek = [...STYLE.matchAll(/--modpeek:\s*([.\d]+)/g)];
  assert.equal(peek.length, 1,
    'the peek is ONE number, named once: the band height and the image offset are the '
    + 'same fraction and cannot be allowed to disagree');
  const v = Number(peek[0]![1]);
  assert.ok(v > 0 && v < 0.26,
    `#146 asks for LESS of the card, not more: ${v} is not below the 0.26 it was`);
  assert.match(STYLE, /aspect-ratio:\s*calc\([^;]*var\(--modpeek\)/,
    'the band derives its height from that one number');
  assert.match(STYLE, /translateY\(calc\([^;]*var\(--modpeek\)/,
    '…and so does the slice of the scan it shows');
});

/* ══ §5 — [#143] {Unstable} on the attribute line ═════════════════════════ */

test('R271 §5a a printed-Unstable card wears it on the attribute line', () => {
  // DERIVED: whichever cards print the marker, not the two a comment knows
  const printers = Object.entries(CARDS)
    .filter(([, d]) => /\{Unstable\}/.test(d.type ?? '')).map(([n]) => n);
  assert.ok(printers.length, 'the pool still prints {Unstable} on somebody');

  for (const name of printers) {
    const box = printedTextBox(name);
    assert.ok(box.attrs.some(a => a.attr === 'Unstable' && a.origin === 'printed'),
      `#143: ${name} prints {Unstable} on its type line and the box must show it there, `
      + `not in a footnote. Its attribute line was: ${JSON.stringify(box.attrs)}`);
    assert.equal(box.attrs.filter(a => a.attr === 'Unstable').length, 1,
      `${name} says it once`);
    assert.ok(!box.state.some(s => /Unstable/.test(s)),
      `and NOT also at the bottom — ${name} would then say it twice: ${JSON.stringify(box.state)}`);
  }
  assert.deepEqual(printedTextBox('Ignis Sprite').attrs.filter(a => a.attr === 'Unstable'), [],
    'a card that is not Unstable says nothing — this is not a banner on every box');
});

test('R271 §5b the acquired kind says WHICH way in, on the same line', () => {
  const h = new Harness(25108);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  const before = entityTextBox(q(h), ent(h, host)!);
  assert.ok(!before.attrs.some(a => a.attr === 'Unstable'), 'unmodded: nothing to say');
  assert.ok(!before.state.some(s => /Unstable/.test(s)), 'and nothing at the bottom either');

  {
    const e = q(h);
    e.attachMod(ent(h, host)!, 'Refuse Reclaimer', A, 'augment');
    e.settle();
  }
  const after = entityTextBox(q(h), ent(h, host)!);
  const row = after.attrs.find(a => a.attr === 'Unstable');
  assert.ok(row,
    '#143: a modded card is Unstable (Manual p.35) and the attribute line must say so. '
    + `It said: ${JSON.stringify({ attrs: after.attrs, state: after.state })}`);
  assert.equal(row!.origin, 'augment',
    'and the ORIGIN carries the reason the prose used to spell out — "from a mod"');
  assert.equal(row!.from, 'Refuse Reclaimer', 'naming the mod that did it');
  assert.ok(!after.state.some(s => /Unstable|Manual p\.35/.test(s)),
    `the hand-typed footnote is gone with it: ${JSON.stringify(after.state)}`);
});

test('R271 §5c the sentence a player reads there is the POOLs, not ours', () => {
  // The payoff of moving the word onto the attribute line: main.ts's inspector
  // looks every attribute up in the glossary, and R267 made the glossary's
  // {Unstable} text a reminder PRINTED on a real card. Nothing here types the
  // sentence — it is read back out of printed.json, which is what makes this a
  // guard rather than a second copy of the string.
  const g = GLOSSARY.find(x => x.term === 'Unstable');
  assert.ok(g, 'the attribute the box now names has a glossary row to explain it');
  const tidy = (s: string): string => s.replace(/\{\/?[a-z0-9]+\}/gi, '').replace(/\s+/g, ' ').trim();
  const said = tidy(g!.text);
  const printers = Object.entries(CARDS)
    .filter(([, d]) => tidy(d.text ?? '').includes(said)).map(([n]) => n);
  assert.ok(printers.length,
    '{Unstable}\'s reminder is authored prose, not the game\'s: no card in the pool prints '
    + `"${said}". R267 sourced it from Spell Excavation; if that has changed, the attribute `
    + 'row is back to showing our words for the game\'s rule.');
});

test('R271 §5d the inspector really draws that row for a modded unit', () => {
  const h = new Harness(25109);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  {
    const e = q(h);
    e.attachMod(ent(h, host)!, 'Refuse Reclaimer', A, 'augment');
    e.settle();
  }
  at((base += 100_000), () => {
    ui.join(viewFor(h.state, A), A, legalActions(h.state, A));
    const menu = ui.rightClick({ previd: host });
    const items = [...menu.matchAll(/data-btn="menuitem" data-i="(\d+)">([\s\S]*?)<\/button>/g)]
      .map(m => ({ i: m[1]!, label: m[2]!.replace(/<[^>]*>/g, '').trim() }));
    const open = items.find(x => /details, attributes/i.test(x.label));
    assert.ok(open,
      `the unit menu offers no way into the inspector: ${items.map(x => x.label).join(' | ')}`);
    const html = ui.click({ btn: 'menuitem', i: open!.i });
    const sec = /<h4>Attributes[\s\S]*?(?=<h4>)/.exec(html);
    assert.ok(sec, 'the inspector has an Attributes section');
    assert.match(sec[0], /Unstable/,
      '#143: the modded unit is Unstable and the attribute section is where a player now '
      + 'reads it — and where the pool\'s own reminder text is attached to it');
    ui.click({ btn: 'inspectclose' });
  });
});
