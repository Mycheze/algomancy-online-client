/* CT-175 / report #157 — EVERY UNTIL-REGROUP FACT HAS TO BE IN THE BOX.
 *
 * THE REPORT, verbatim (HTEW):
 *
 *   "Spell effects that do something to a unit until regroup should be said in
 *    the 'current text' of the card. in this case, I played a spell on one
 *    Prickly Protector, but there's no mention of that effect when I hover
 *    over it"
 *
 * The spell was **Phytochemical Protection** — played at [132], targeted at
 * [133], resolved at [135]: *"Until regroup, prevent all damage that would be
 * dealt to target unit. Put a +1/+1 counter on it for each damage prevented
 * this way."* It sets `Entity.damageShield` and nothing else, and nothing in
 * ui/cardtext.ts read that field. Three actions later ([138]/[139]) it
 * prevented all 8 damage and paid out 8 +1/+1 counters — off a box that had
 * been telling the owner the unit was ordinary.
 *
 * ── THIS IS A CLASS, AND ITS MEMBERSHIP IS DEFINED IN ONE PLACE
 *
 * ui/cardtext.ts's header states the old rule — "an until-regroup change with
 * no card text behind it is not a line: a temp +X/+Y is a term in the stat
 * arithmetic and a temp attribute is a chip in the attribute row" — which is
 * correct about the fields it was written for and silent about the rest.
 *
 * "Until regroup" is not a matter of opinion: it is the R11 step-3 sweep in
 * engine.ts, and WHATEVER THAT BLOCK DELETES IS AN UNTIL-REGROUP FACT. So §1
 * parses the block and §2 requires each field it names to move the box. The
 * list is never typed here — docs/13-assessment.md §7.2, and the CT-161 shape
 * from earlier this round: the field somebody adds to that sweep next round is
 * exactly the one that would otherwise ship invisible.
 *
 * ── AND THE REPRESENTATION HAS TO SURVIVE `compact`
 *
 * The player was HOVERING. main.ts renders the hover tip with
 * `{ compact: true }`, and compact drops the stat arithmetic and the whole
 * `state` note row — so "add it to box.state" would have been invisible on
 * precisely the surface the report is about. §2 therefore compares only the
 * parts compact keeps, and §4 checks that claim against main.ts rather than
 * trusting this comment.
 *
 * §1 the field list, parsed out of the R11 step-3 sweep
 * §2 every field moves the box, in a part `compact` keeps
 * §3 the named case: Phytochemical Protection, cast for real
 * §4 Alluring, and the compact claim measured against main.ts
 * §5 …and the line reaching the real screen, through the real client
 *
 * Seeds 26600-26699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import { entityTextBox } from '../../ui/cardtext.ts';
import type { CardTextBox } from '../../ui/cardtext.ts';
import type { Entity, EntityId, Seat } from '../src/types.ts';
import {
  assignDefault, ent, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle,
} from './util.ts';

const q = (h: Harness): E => new E(h.state);

/** the real client, driven — §5 only; see test/ui-driver.ts */
const ui = await client();

const ENGINE_SRC = readFileSync(new URL('../src/engine.ts', import.meta.url), 'utf8');
const MAIN_SRC = readFileSync(new URL('../../ui/main.ts', import.meta.url), 'utf8');

/* ══ §1 — the field list, derived from the sweep itself ════════════════ */

/** the R11 step-3 loop in engine.ts::startRegroup, brace-matched from its own
 * comment. Anchored on the COMMENT rather than on a line number or on any one
 * field, so the block can grow, shrink or be reformatted freely. */
function sweepBlock(): string {
  const at = ENGINE_SRC.indexOf('// (3) all temporary stat changes are removed');
  assert.ok(at > 0,
    'engine.ts no longer carries the R11 step-3 sweep comment this file anchors on. That '
    + 'sweep IS the definition of "until regroup" — find where it went and re-anchor, do not '
    + 'delete this file.');
  const open = ENGINE_SRC.indexOf('{', ENGINE_SRC.indexOf('for (', at));
  let depth = 0, i = open;
  for (; i < ENGINE_SRC.length; i++) {
    if (ENGINE_SRC[i] === '{') depth++;
    else if (ENGINE_SRC[i] === '}' && --depth === 0) break;
  }
  return ENGINE_SRC.slice(open + 1, i);
}

const BLOCK = sweepBlock();

/** THE DERIVED LIST: every entity field the sweep clears. Two spellings —
 * `e.x = 0` for the numeric pair and `delete e.x` for the rest — and `copies`
 * is reached by both a conditional filter and a `delete` in its else. */
const SWEPT: string[] = [...new Set([
  ...[...BLOCK.matchAll(/\be\.(\w+)\s*=\s*0\b/g)].map(m => m[1]!),
  ...[...BLOCK.matchAll(/\bdelete\s+e\.(\w+)/g)].map(m => m[1]!),
])].sort();

test('CT-175 §1 the until-regroup fields are read out of the R11 sweep, and the read is complete', () => {
  assert.ok(SWEPT.length > 0,
    'the derived field list is EMPTY — a guard over an empty derived set passes forever '
    + '(docs/13-assessment.md §5). The parse above has stopped reading the sweep.');
  assert.ok(SWEPT.length >= 10,
    `only ${SWEPT.length} until-regroup field(s) found; the sweep carried twelve when this was `
    + 'written. If fields were deliberately retired, move this floor with them.');

  // COMPLETENESS, and it is the half that matters: every entity field the
  // block MENTIONS at all must be one this file knows it sweeps. A future
  // `if (e.foo) delete e.bar` adds a name here and reddens rather than
  // slipping past a regex that only understands two spellings.
  const mentioned = [...new Set([...BLOCK.matchAll(/\be\.(\w+)/g)].map(m => m[1]!))].sort();
  assert.deepEqual(mentioned, SWEPT,
    `the sweep touches entity fields this file did not parse as swept: `
    + `${mentioned.filter(f => !SWEPT.includes(f)).join(', ')}. Teach the parse their shape — `
    + 'an unparsed field is an unguarded field.');

  // and the parse is reading FIELDS, not prose: both spellings are present
  assert.ok(BLOCK.includes('= 0') && BLOCK.includes('delete e.'),
    'positive control: the block really contains both forms the parse looks for');
});

/* ══ §2 — every swept field moves the box ══════════════════════════════ */

/**
 * A value for each swept field, plausible enough that the box has something to
 * say about it. The LIST is derived; only the values are written here, and §2
 * requires this table to cover the derived list exactly — so a field added to
 * the sweep arrives as a red test naming it, with an instruction.
 */
const FIXTURE: Record<string, (u: Entity) => void> = {
  tempPower: u => { u.tempPower = 3; },
  tempToughness: u => { u.tempToughness = 3; },
  tempAttrs: u => { u.tempAttrs = ['Flying']; },
  baseSet: u => { u.baseSet = [7, 7]; },
  baseSetSeq: u => { u.baseSetSeq = 42; },
  suppressed: u => { u.suppressed = { abilities: 'Suppression Field' }; },
  unstable: u => { u.unstable = true; },
  damageShield: u => { u.damageShield = 'Phytochemical Protection'; },
  shieldPending: u => { u.shieldPending = 4; },
  granted: u => {
    u.granted = [{
      card: 'Oorblak', via: 'ability', index: 0,
      text: 'I have {Flying} until regroup.', from: 'Oorblak',
    }];
  },
  allured: u => { u.allured = { round: 0, columns: [] }; },
  copies: u => {
    u.copies = [{ card: 'Oorblak', facets: ['name'], until: 'regroup', from: 'Oorblak', seq: 7 }];
  },
};

/**
 * The one field with no representation, and the reason — asserted to be a
 * SUBSET of the derived list, so an exemption that outlives its field fails
 * here instead of quietly excusing a different one.
 *
 * `baseSetSeq` is the timestamp `baseSet` was stamped at, and exists only so
 * two base-setters can be compared last-wins (types.ts). On its own it says
 * nothing a player could act on, and `baseSet` — the thing it dates — is
 * represented in the stat arithmetic.
 */
const NO_REPRESENTATION: Record<string, string> = {
  baseSetSeq: 'a last-wins tiebreak timestamp for baseSet, with no meaning of its own',
};

/** the parts of the box `textBoxHtml` keeps when `compact` is set — i.e.
 * everything the HOVER TIP, which is the surface the report is about, can
 * show. `state` is deliberately NOT here; see §4. */
const compactVisible = (b: CardTextBox): string => JSON.stringify({
  stats: b.stats, attrs: b.attrs, lines: b.lines, suppressed: b.suppressed,
});

/** a plain unit of this seat's, in play */
function subject(h: Harness, seat: Seat): EntityId {
  return spawn(h, seat, 'Oorblak');
}

test('CT-175 §2 the fixture table covers the derived field list exactly', () => {
  const covered = [...new Set([...Object.keys(FIXTURE), ...Object.keys(NO_REPRESENTATION)])].sort();
  assert.deepEqual(covered, SWEPT,
    'the R11 sweep and this file disagree about what "until regroup" means.\n'
    + `  swept but not covered here: ${SWEPT.filter(f => !covered.includes(f)).join(', ') || 'none'}\n`
    + `  covered here but not swept: ${covered.filter(f => !SWEPT.includes(f)).join(', ') || 'none'}\n`
    + 'A NEW FIELD IN THE SWEEP IS A NEW UNTIL-REGROUP EFFECT: add a fixture for it above and '
    + 'give it a representation in ui/cardtext.ts. Only exempt it (NO_REPRESENTATION) if there '
    + 'is genuinely nothing a player could act on.');

  for (const f of Object.keys(NO_REPRESENTATION)) {
    assert.ok(SWEPT.includes(f),
      `${f} is excused from having a representation and the sweep no longer clears it — `
      + 'a stale exemption is an excuse pointing at nothing');
  }
});

test('CT-175 §2 every until-regroup field changes the box, in a part the hover tip keeps', () => {
  const missing: string[] = [];
  for (const field of SWEPT) {
    if (field in NO_REPRESENTATION) continue;
    const h = new Harness(26600);
    toDeployment(h);
    const seat = h.state.deployPlayer!;
    const id = subject(h, seat);
    const before = compactVisible(entityTextBox(q(h), ent(h, id)!));
    FIXTURE[field]!(ent(h, id)!);
    const after = compactVisible(entityTextBox(q(h), ent(h, id)!));
    if (before === after) missing.push(field);
  }
  assert.deepEqual(missing, [],
    `these until-regroup effects are INVISIBLE in the card's current text: ${missing.join(', ')}. `
    + 'That is report #157 — the owner played a spell on a unit and the box said nothing had '
    + 'happened to it. Give each one a representation in ui/cardtext.ts; a `state` note is not '
    + 'one, because the hover tip renders compact and compact drops the state row (§4).');
});

test('CT-175 §2 …and the sweep can see a failure: the box is unchanged by a field it ignores', () => {
  // POSITIVE CONTROL on the instrument, not on the product. `compactVisible`
  // has to be capable of reporting "no change" — otherwise the loop above
  // passes for every field whatever the box does. The exempt field is the
  // honest example: it really does change nothing, by design.
  const h = new Harness(26601);
  toDeployment(h);
  const id = subject(h, h.state.deployPlayer!);
  const before = compactVisible(entityTextBox(q(h), ent(h, id)!));
  ent(h, id)!.baseSetSeq = 42;
  assert.equal(compactVisible(entityTextBox(q(h), ent(h, id)!)), before,
    'the comparison reports a change for a field that produces none — it cannot fail, so §2 '
    + 'proves nothing');
});

/* ══ §3 — the named case, cast for real ════════════════════════════════ */

test('CT-175 §3 Phytochemical Protection says so on the unit it shielded (report #157)', () => {
  // The report's own spell, put up the way HTEW put it up — played from a
  // hand, targeted, resolved off the stack — rather than by writing the field.
  const h = new Harness(26602);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Oorblak');
  const prot = spawn(h, D, 'Prickly Protector');
  giveResources(h, D, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Phytochemical Protection') });
  pick(h, { unit: prot });
  pass(h); pass(h);
  assert.equal(ent(h, prot)!.damageShield, 'Phytochemical Protection',
    'fixture: the shield really went up, through the real card');

  const box = entityTextBox(q(h), ent(h, prot)!);
  const line = box.lines.find(l => l.origin === 'until');
  assert.ok(line,
    'the shielded unit\'s box has no until-regroup line — this is #157 exactly: "there\'s no '
    + 'mention of that effect when I hover over it"');
  assert.match(line!.text, /prevent/i, 'and it says what the effect DOES');
  assert.equal(line!.from, 'Phytochemical Protection',
    'and names the card that did it — the spell has left play, so the box is the only place '
    + 'the player can still read it');
  assert.ok(box.modified,
    'a shielded unit is not simply the printed card, so the box wears the "current text" badge');

  // and it is still true after the damage it prevented has been paid out —
  // the shield lasts until regroup, not until the first hit
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [prot] } });
  pass(h); pass(h);
  assignDefault(h);
  assert.equal(ent(h, prot)!.damage, 0, 'fixture: the shield really prevented the combat damage');
  assert.ok(entityTextBox(q(h), ent(h, prot)!).lines.some(l => l.origin === 'until'),
    'the line lasts as long as the effect does');
});

/* ══ §4 — Alluring, and the compact claim ══════════════════════════════ */

test('CT-175 §4 a lured unit says it cannot attack, and says whether it still owes a block', () => {
  const h = new Harness(26603);
  toDeployment(h);
  const id = subject(h, h.state.deployPlayer!);
  ent(h, id)!.allured = { round: 0, columns: [] };
  const bare = entityTextBox(q(h), ent(h, id)!).lines.find(l => l.origin === 'until');
  assert.ok(bare, 'a lured unit reads as an ordinary unit');
  assert.match(bare!.text, /cannot attack/i,
    'the can\'t-attack half is the bare presence of the field (apply.ts: need(!u.allured, …))');
  assert.doesNotMatch(bare!.text, /must block/i,
    'and with no columns left there is no duty to claim — the badge (#117) draws the same '
    + 'distinction, and the two must not disagree');
});

test('CT-175 §4 the hover tip drops the state row, which is why none of this is a state note', () => {
  // The reason §2 compares only `stats`/`attrs`/`lines`/`suppressed`. This is
  // the one claim in this file that lives in main.ts, so it is read from
  // main.ts: if the hover tip ever starts showing the state row, this line is
  // what tells the next author that §2 may be relaxed.
  assert.match(MAIN_SRC, /!opts\.compact && box\.state\.length/,
    'ui/main.ts no longer gates the state row on `compact` — re-derive what the hover tip '
    + 'shows before trusting §2\'s comparison');
  assert.match(MAIN_SRC, /textBoxHtml\(box, \{ compact: true \}\)/,
    'and the hover tip no longer renders compact — the surface report #157 is about has moved');
});

/* ══ §5 — and it reaches the screen ════════════════════════════════════ */

/**
 * The three sections above are about `entityTextBox`, which is DOM-free. This
 * one drives the real client (test/ui-driver.ts) and reads the markup, because
 * a `LineOrigin` the box emits and the renderer has no tag for would render as
 * a blank label — the box would be right and the screen would still say
 * nothing, which is the report all over again.
 *
 * The route is the player's: right-click the card, take the details entry.
 * That is the same box the hover tip builds, minus `compact`.
 */
test('CT-175 §5 the until-regroup line renders on the real client, tagged with its duration', () => {
  const h = new Harness(26604);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  const id = spawn(h, seat, 'Prickly Protector');
  ent(h, id)!.damageShield = 'Phytochemical Protection';

  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  const menu = ui.rightClick({ previd: id });
  const entry = [...menu.matchAll(/data-btn="menuitem" data-i="(\d+)">([\s\S]*?)<\/button>/g)]
    .filter(m => /details/i.test(m[2]!));
  assert.equal(entry.length, 1,
    'the card right-click menu no longer offers exactly one details entry — the route into the '
    + 'box has moved');
  const html = ui.click({ btn: 'menuitem', i: entry[0]![1]! });

  assert.match(html, /class="tbline tb-until"/,
    'the until-regroup line is not in the markup — ui/main.ts is dropping the origin the box '
    + 'emits');
  assert.match(html, /until regroup — Phytochemical Protection/,
    'and its tag says both halves: how long it lasts, and what put it there');
  assert.match(html, /damage that would be dealt to me is prevented/i,
    'and the effect itself is on screen, in words');
  ui.click({ btn: 'inspectclose' });
});
