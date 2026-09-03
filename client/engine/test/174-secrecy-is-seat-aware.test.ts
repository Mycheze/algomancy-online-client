/* R203 / CT-84 — A SECRECY ASSERTION MUST BE ABLE TO FAIL.
 *
 * ── THE GAP
 *
 * `Harness.absorb()` pushes every event's `msg` into ONE seatless `log`, and
 * `visibleToSeat` is nowhere near it. So an assertion written against `h.log`
 * reads exactly the same whether the information is public or private.
 * 42-dark-b:1331 asserted
 * `h.log.some(l => l.includes('Thought Extraction reveals'))`; that line
 * published an opponent's ENTIRE HAND to the shared log, and the assertion
 * passed before R197b fixed it and passed after. **Two genuine information
 * leaks survived 153 test files for exactly this reason** — R197b's three
 * "look at a hand" cards and R202's `handEntered` — and both had to reach past
 * the Harness into `server/view.ts` to say anything at all (172, 173).
 * docs/13-assessment.md §5 calls it the highest-value checker gap known.
 *
 * ── WHAT IS HERE
 *
 *  §1  THE POSITIVE CONTROL for the new channel. `util.ts::logFor(h, seat)`
 *      runs `h.events` through server/view.ts's production redactor. docs/13
 *      §7.4: every observation channel needs a control showing it can SEE, so
 *      §1 drives a real private line and asserts the flat log and the seat log
 *      DISAGREE about it. If `logFor` ever silently degrades to `h.log`, §1 is
 *      what reddens.
 *
 *  §2  THE INSTRUMENT, and proof it is not blind. Planted source, matched
 *      directly, including the two evasions that would otherwise walk past it
 *      (a hoisted `const` and a mention inside a comment).
 *
 *  §3  THE LINT: an assertion that names a card and a secret in the same
 *      breath must not be reading the flat log.
 *
 *  §4  THE REACH MEASUREMENT — the derived sets and the corpus, asserted big
 *      enough that a green here cannot be vacuous.
 *
 *  §5  THE CONTROLS the ticket names: Bioremediation and Void Memory are
 *      PUBLIC reveals and must stay legal readers of the shared log.
 *
 * ── WHY BOTH HALVES OF THE RULE ARE DERIVED, AND NOTHING IS ALLOWLISTED
 *
 * CT-83 is an open ticket about prose-reasoned allowlists, so this file has
 * none. The two things it has to know are both computed:
 *
 *   PRIVATE-LOOK CARDS  from PRINTED TEXT — "look at …hand" is a private look,
 *                       "reveals their hand" is a public one. That is R197b's
 *                       partition and 173 §3 already guards the source side of
 *                       it; this is the test side of the same line. A sixth
 *                       card printing the verb joins the set on its own.
 *   PRIVATE FRAGMENTS   from the ENGINE — the static text of every `.ev(` call
 *                       under engine/src that carries `privateTo`. A line the
 *                       engine only ever emits privately is a line no flat-log
 *                       assertion may quote, whether or not it names a card.
 *
 * The two cover each other's blind spot: the card rule catches an assertion
 * about a private-look card that quotes some other line, the fragment rule
 * catches an assertion that quotes a private line without naming its card.
 * Measured on the corpus as it stands, their union flags ONE assertion —
 * 42-dark-b:1331, the instance in the ticket — with zero exemptions.
 *
 * ⚠ A FLAG IS NOT AN ACCUSATION. Reading the flat log for a PUBLIC line of a
 * private-look card (26-metal-a's Dreamtender sacrifice ordering) is not a
 * bug; it is simply weaker than it needs to be, and `logFor(h, seat)` costs
 * nothing and says more. So the fix for a flag is always "use the seat log",
 * never "add an exemption" — which is how this file stays free of the tenth
 * prose allowlist.
 *
 * Seeds 17400-17499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../src/harness.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { stripCode } from './stripcode.ts';
import { finishBattle, give, giveResources, logFor, pick, spawn, toDeployment, toNextBattle } from './util.ts';
import type { Seat } from '../src/types.ts';
import '../src/cards/registry.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'src');

/* ── §1 · the positive control: the new channel can SEE ──────────────────── */

/** Thought Extraction aimed at its own caster: the naming line is `privateTo`
 *  the looker, and the looker IS the hand's owner, so the ONE other seat it
 *  could reach is an opponent with no claim on any of it. R197b's §1 calls
 *  this the reachable shape of the class in a 1v1 game. */
function selfLook(seed: number): { h: Harness; A: Seat; D: Seat; secret: string } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'dark', 2);                             // dd/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.hand = ['Good Whale', 'Shard Sprite'];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Thought Extraction') });
  pick(h, { player: A });
  h.do({ type: 'passPriority', seat: h.state.priority! });
  h.do({ type: 'passPriority', seat: h.state.priority! });
  pick(h, 0);                                                 // discard 'Good Whale'
  // 'Shard Sprite' is never touched, so it exists in no public zone: any seat
  // that can read it read it out of a hand.
  return { h, A, D, secret: 'Shard Sprite' };
}

test('R203 §1: logFor(h, seat) CAN SEE — the flat log and the seat log disagree about a private line', () => {
  const { h, A, D, secret } = selfLook(17401);

  // (a) the old channel is blind, demonstrated rather than asserted about.
  //     `h.log` carries the naming line whether or not it is private — which
  //     is exactly why 42-dark-b's `h.log.some(…'Thought Extraction reveals')`
  //     passed on both sides of the R197b fix.
  //
  //     ⚠ The private line is found through its OWN TAG rather than by quoting
  //     it, and that is not fastidiousness: quoting it here would make this
  //     very assertion an offender under §3, and a lint its own author has to
  //     write around is a lint with an exemption in it.
  const priv = h.events.filter(e => e.msg && e.data?.['privateTo'] !== undefined);
  assert.equal(priv.length, 1, 'fixture: exactly one privately-tagged line was emitted');
  assert.ok(priv[0]!.msg.includes(secret),
    "fixture: it names a card that is in nobody's public zone — a pure secret");
  assert.ok(h.log.includes(priv[0]!.msg),
    'the seatless hotseat log carries it in full, as it always did: THIS is the blindness');

  // (b) the new channel SEES THE SAME LINE — the positive control. A channel
  //     that returns nothing passes every secrecy assertion ever written
  //     against it, so this half is not optional (docs/13 §7.4).
  assert.ok(logFor(h, A).some(l => l.includes('Thought Extraction reveals')),
    'the LOOKER is served the naming line: this is a look, not a secret from everyone');
  assert.ok(logFor(h, A).some(l => l.includes(secret)),
    'and it names the card the looker looked at');

  // (c) and it DISAGREES with the flat log for the other seat. Before R203
  //     nothing in engine/test could express this sentence.
  assert.deepEqual(logFor(h, D).filter(l => l.includes('Thought Extraction reveals')), [],
    'the opponent was served a line naming the whole hand of a spell cast on somebody else');
  assert.deepEqual(logFor(h, D).filter(l => l.includes(secret)), [],
    `"${secret}" is in no public zone, so a seat that reads it read it out of a hand`);

  // (d) the seat log is not "the flat log minus everything". A channel that
  //     returns a stub passes every secrecy assertion ever written against it,
  //     so the public half of the very same resolution must survive: the
  //     discard this spell caused is a PUBLIC bin event and both seats see it,
  //     naming the discarded card.
  for (const s of [A, D] as Seat[]) {
    assert.ok(logFor(h, s).length > 20, `seat ${s}'s log is substantial, not a stub`);
    assert.ok(logFor(h, s).some(l => l.includes('discards Good Whale')),
      `seat ${s} must still see the discard — a bin is public, and only the LOOK is not`);
  }
  assert.equal(logFor(h, A).length, h.log.length,
    'the looker loses nothing: every line in the hotseat log is a line seat A may read');
  assert.equal(logFor(h, D).length, h.log.length - 1,
    'and the opponent loses exactly the one line they were never entitled to');
  finishBattle(h);
});

test('R203 §1: the seat log is built from EVENTS, so it cannot drift from the log the way logTypes did', () => {
  // harness.ts's own docstring records why `log` and `events` are different
  // lists: an event with an empty `msg` ('stackFlash' — a signal for the
  // client, not a line for a reader) is absorbed and never logged. A seat log
  // built by filtering `log` would have no tag left to filter ON, and one
  // built by index-aligning with `events` would inherit that bug on day one.
  const { h, D } = selfLook(17402);
  assert.ok(h.events.some(e => !e.msg), 'fixture: signal-only events really do occur in this game');
  assert.deepEqual(logFor(h, D).filter(l => l === ''), [],
    'a signal-only event became an empty line in the seat log — the logTypes drift, re-made');
  assert.ok(logFor(h, D).length < h.events.length,
    'and the seat log is a filtered view of the events, not a copy of them');
  finishBattle(h);
});

/* ── §2 · the instrument, and proof it is not blind ──────────────────────── */

/** Files the lint reads. Every test in the suite, including this one. */
function testFiles(): string[] {
  return fs.readdirSync(HERE).filter(f => f.endsWith('.test.ts')).sort();
}

function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? tsFiles(path.join(dir, d.name))
      : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []);
}

/** The balanced call starting at the `(` at `open`, over the STRIPPED text.
 *
 * ⚠ STRIPPED, never raw — 154-guard-shape learned this the expensive way: an
 * apostrophe in a comment ("the attacker's screen") opens a string that closes
 * thousands of characters later, and one small assertion swallows the rest of
 * the file. §2 plants that exact shape. */
function balanced(code: string, open: number): number {
  let i = open, depth = 0;
  for (; i < code.length; i++) {
    const c = code[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (!depth) return i + 1; }
  }
  return i;
}

interface Frag { line: number; raw: string; code: string }

/** every `assert…( … )` call, with its RAW text (strings intact, which is
 *  where the card names and the quoted fragments live) and its STRIPPED text
 *  (where the `.log` reads live). `stripCode` BLANKS rather than deletes
 *  (149-strip-code's first invariant), so the two share offsets exactly — the
 *  only reason a span found in one can index into the other. */
function assertionsIn(raw: string, code: string): Frag[] {
  const out: Frag[] = [];
  for (const m of code.matchAll(/\bassert\b[\w.]*\s*\(/g)) {
    const end = balanced(code, m.index + m[0].length - 1);
    out.push({ line: raw.slice(0, m.index).split('\n').length, raw: raw.slice(m.index, end), code: code.slice(m.index, end) });
  }
  return out;
}

/** identifiers this file binds to a Harness — the only receivers whose `.log`
 *  is the seatless firehose. Derived rather than listed, so `quiet`, `draft`,
 *  `con`, `h2`, `a`, `b` are all covered without a name list; §4 asserts that
 *  NO receiver escapes, which is what keeps the derivation honest. */
function harnessNamesIn(code: string): Set<string> {
  const out = new Set<string>();
  //   const h = new Harness(…)   ·   function f(h: Harness)   ·   (h: Harness) =>
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*(?::\s*Harness\s*)?=\s*new\s+Harness\b/g)) out.add(m[1]!);
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*Harness\b/g)) out.add(m[1]!);
  // …and a Harness that arrives from a local helper: `const con =
  // constructedGame(2820)` (28-metal-c:716), `const a = run(), b = run()`
  // (64-formation-collapse:185). Without this arm three real flat-log readers
  // are invisible to the lint, which §4's receiver measurement catches.
  const fns = new Set<string>();
  for (const m of code.matchAll(/(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=)\s*(?:\([^()]*\))\s*:\s*Harness\b/g)) {
    fns.add((m[1] ?? m[2])!);
  }
  if (fns.size) {
    const re = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*=\\s*(?:${[...fns].join('|')})\\s*\\(`, 'g');
    for (const m of code.matchAll(re)) out.add(m[1]!);
  }
  return out;
}

const logRead = (names: Set<string>): RegExp =>
  new RegExp(`\\b(?:${[...names].map(n => n.replace(/\$/g, '\\$')).join('|')})\\s*\\.\\s*log\\b`);

/** identifiers bound to a flat-log read: `const iPay = h.log.findIndex(…)`.
 *
 * ⚠ Without this the lint is trivially evaded — hoist the read into a `const`
 * on the line above and the assertion itself no longer mentions `.log`. The
 * evasion is not hypothetical: 26-metal-a:1230 has that exact shape today,
 * written for entirely innocent reasons. §2 plants it. */
function logConstsIn(raw: string, code: string, names: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  if (!names.size) return out;
  const re = new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=`, 'g');
  for (const m of code.matchAll(re)) {
    const semi = code.indexOf(';', m.index);
    const end = semi === -1 ? code.length : semi;
    if (logRead(names).test(code.slice(m.index, end))) out.set(m[1]!, raw.slice(m.index, end));
  }
  return out;
}

/* ── the two derived sets ────────────────────────────────────────────────── */

const printedOf = (n: string): string => getCard(n).text ?? '';

/** R197b's partition, re-derived here rather than imported from 173 (which
 *  derives it for the SOURCE side): a card printing "look at …hand" produces a
 *  line that belongs to one seat. "Reveals their hand" is the public verb and
 *  is deliberately NOT in this set — Bioremediation and Void Memory are §5. */
const PRIVATE_LOOK_CARDS = allCardNames().filter(n =>
  /look(s|ed|ing)?\s+at\b/i.test(printedOf(n)) && /\bhand\b/i.test(printedOf(n)));

/** the static text of a `.ev(` call — the parts a reader will actually see
 *  either side of the interpolations. */
function staticChunks(callRaw: string): string[] {
  const tpl = callRaw.match(/`((?:\\.|[^`\\])*)`/s);
  if (!tpl) return [];
  const s = tpl[1]!;
  const out: string[] = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '$' && s[i + 1] === '{') {                    // step over ${ … }
      out.push(buf); buf = '';
      let d = 1; i += 2;
      for (; i < s.length && d; i++) { if (s[i] === '{') d++; else if (s[i] === '}') d--; }
      i--; continue;
    }
    buf += s[i];
  }
  out.push(buf);
  return out;
}

/** Text the engine only ever emits on a `privateTo` event. Derived from
 *  engine/src, so a new private line joins the set the day it is written.
 *  Chunks shorter than 12 characters are dropped: the four instances all
 *  render as `<Card> reveals ${who}'s hand: ${cards}.`, whose middle chunk
 *  ("'s hand: ") is generic prose that would match half the suite. */
const PRIVATE_FRAGMENTS: string[] = (() => {
  const out = new Set<string>();
  for (const f of tsFiles(SRC)) {
    const raw = fs.readFileSync(f, 'utf8');
    const code = stripCode(raw);
    for (const m of code.matchAll(/\.ev\s*\(/g)) {
      const end = balanced(code, m.index + m[0].length - 1);
      if (!/\bprivateTo\b/.test(code.slice(m.index, end))) continue;
      for (const chunk of staticChunks(raw.slice(m.index, end))) {
        const t = chunk.trim();
        if (t.length >= 12) out.add(t);
      }
    }
  }
  return [...out];
})();

/* ── the rule ────────────────────────────────────────────────────────────── */

interface Offence { where: string; why: string }

/**
 * THE RULE, as a pure function so §2 can plant source at it.
 *
 * An assertion offends when it READS THE FLAT LOG (directly, or through an
 * identifier bound to a flat-log read) and, in the same breath, names a
 * private-look card or quotes a line the engine only emits privately.
 */
function offencesIn(raw: string, where: string): Offence[] {
  const code = stripCode(raw);
  const names = harnessNamesIn(code);
  if (!names.size) return [];
  const flat = logRead(names);
  const consts = logConstsIn(raw, code, names);
  const out: Offence[] = [];
  for (const a of assertionsIn(raw, code)) {
    const via = [...consts.keys()].filter(k => new RegExp(`\\b${k}\\b`).test(a.code));
    if (!flat.test(a.code) && !via.length) continue;
    const text = [a.raw, ...via.map(k => consts.get(k)!)].join('\n');
    const cards = PRIVATE_LOOK_CARDS.filter(n => text.includes(n));
    const frags = PRIVATE_FRAGMENTS.filter(f => text.includes(f));
    if (!cards.length && !frags.length) continue;
    const reason = cards.length
      ? `${cards.join(', ')} prints "look at …hand", so its lines are one seat's`
      : `it quotes "${frags[0]}", which the engine only emits with privateTo`;
    out.push({
      where: `${where}:${a.line}`,
      why: `${reason} — but this reads the SEATLESS ${via.length ? `log (via \`${via[0]}\`)` : 'h.log'}, `
        + 'which cannot fail whether the line is public or private. Use `logFor(h, seat)` '
        + '(test/util.ts) and say which seat.',
    });
  }
  return out;
}

test('R203 §2: the lint is not blind — it names a planted leak and ignores every near miss', () => {
  // ⚠ 149-strip-code's rule, applied to this checker: ask "what would this look
  // like if it were blind?" and measure it. A blind version of this file
  // returns [] for everything and the suite reads clean — which is precisely
  // the state CT-84 describes.
  const one = (body: string): string =>
    `import { Harness } from '../src/harness.ts';\ntest('t', () => {\n  const h = new Harness(1);\n${body}\n});\n`;

  // (a) THE INSTANCE. This is 42-dark-b:1331 verbatim.
  const caught = offencesIn(one("  assert.ok(h.log.some(l => l.includes('Thought Extraction reveals')), 'the hand was revealed');"), 'planted');
  assert.equal(caught.length, 1, 'the reported instance must be flagged');
  assert.match(caught[0]!.why, /logFor/, 'and the message must say what to do instead');

  // (b) the hoist evasion — the read moved one line up, out of the assertion
  const hoisted = offencesIn(one(
    "  const seen = h.log.filter(l => l.includes('Thought Extraction reveals'));\n"
    + "  assert.equal(seen.length, 1, 'the hand was revealed');"), 'planted');
  assert.equal(hoisted.length, 1,
    'a flat-log read hoisted into a const walked straight past the lint — which is the shape '
    + '26-metal-a:1230 already has, written innocently');

  // (c) the fragment rule alone, with no card name anywhere in the assertion
  const byFragment = offencesIn(one("  assert.ok(h.log.some(l => l.includes('Bripp recycles')), 'it recycled');"), 'planted');
  assert.equal(byFragment.length, 1, 'a privately-emitted line is off limits even unattributed');

  // (d) the CURE is not flagged — or the lint would forbid its own fix
  assert.deepEqual(offencesIn(one("  assert.ok(logFor(h, A).some(l => l.includes('Thought Extraction reveals')), 'the looker saw it');"), 'planted'), []);

  // (e) near misses that must stay legal
  assert.deepEqual(offencesIn(one("  assert.ok(h.log.some(l => l.includes('Bioremediation reveals')), 'a PUBLIC reveal');"), 'planted'), [],
    'a printed REVEAL belongs to the table — §5');
  assert.deepEqual(offencesIn(one("  assert.ok(h.log.some(l => l.includes('hand is empty — revealed')));"), 'planted'), [],
    "Void Memory's empty-hand reveal is public, and 'hand' + 'revealed' is not a secret");
  assert.deepEqual(offencesIn(one("  assert.ok(h.log.some(l => l.includes('does not look at their pack')));"), 'planted'), [],
    'Worldbender: "look at" as PROSE about a public fact. A vocabulary rule flags this; a rule '
    + 'derived from printed card text does not, which is why the rule is derived');
  assert.deepEqual(offencesIn(one("  assert.ok(console.log !== undefined);"), 'planted'), [],
    'console.log is not a game log');
  assert.deepEqual(offencesIn(one("  assert.ok(h.logTypes.length > 0);"), 'planted'), [],
    'logTypes is a type list, not the log');

  // (f) prose is not code — the two blindnesses stripCode has had
  assert.deepEqual(offencesIn(one("  // h.log.some(l => l.includes('Thought Extraction reveals')) is what this used to say\n  assert.ok(true);"), 'planted'), [],
    'a line comment quoting the old assertion is not an assertion (149-strip-code failure mode 2)');
  assert.deepEqual(offencesIn(one("  /*\n   * h.log.some(l => l.includes('Thought Extraction reveals'))\n   */\n  assert.ok(true);"), 'planted'), [],
    'nor is a block comment');

  // (g) 154-guard-shape's blindness, planted at this file's own parser: an
  //     apostrophe inside a comment must not run one assertion into the next
  const runaway = offencesIn(
    "import { Harness } from '../src/harness.ts';\n"
    + "test('a', () => {\n  const h = new Harness(1);\n"
    + "  // exactly what reaches the attacker's screen\n"
    + '  assert.ok(true);\n});\n'
    + "test('b', () => {\n  const h2 = new Harness(2);\n"
    + "  assert.ok(h2.log.some(l => l.includes('Thought Extraction reveals')));\n});\n", 'planted');
  assert.equal(runaway.length, 1,
    "the apostrophe in \"attacker's\" swallowed the rest of the file — brace/paren matching must "
    + 'run over the STRIPPED text (154-guard-shape §2 had this exact defect)');
  assert.match(runaway[0]!.where, /:9$/, 'and the offence is reported at the line it is on');
});

/* ── §3 · the lint ───────────────────────────────────────────────────────── */

test('R203 §3: no assertion names a card and a secret in the same breath while reading the seatless log', () => {
  const offences: Offence[] = [];
  for (const f of testFiles()) offences.push(...offencesIn(fs.readFileSync(path.join(HERE, f), 'utf8'), f));
  assert.deepEqual(offences.map(o => `${o.where}  ${o.why}`), [],
    'a secrecy assertion that cannot fail. `h.log` is the hotseat firehose — every seat\'s lines '
    + 'in one array — so an assertion on it reads the same whether the information is public or '
    + 'private, which is how two real leaks survived 153 test files (R197b, R202). The fix is '
    + 'never an exemption: `logFor(h, seat)` costs one import and says which seat.');
});

/* ── §4 · the reach measurement ──────────────────────────────────────────── */

test('R203 §4: the lint has reach — the corpus, the receivers and both derived sets', () => {
  // Every number below is asserted because a checker that quietly loses its
  // reach reports clean forever. docs/13 §5: six checkers in one round reported
  // more sight than they had, and every one had made a number go UP.
  const files = testFiles();
  assert.ok(files.length > 150, `only ${files.length} test files scanned`);

  let flatReads = 0, assertions = 0, harnessFiles = 0;
  const unreadable: string[] = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(HERE, f), 'utf8');
    const code = stripCode(raw);
    const names = harnessNamesIn(code);
    if (names.size) harnessFiles++;
    const flat = names.size ? logRead(names) : null;
    for (const a of assertionsIn(raw, code)) {
      assertions++;
      if (flat?.test(a.code)) flatReads++;
    }
    // THE RECEIVER MEASUREMENT: an `X.log` whose X this file cannot resolve to
    // a Harness is a hole the lint reads straight past.
    for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*\.\s*log\b/g)) {
      if (m[1] === 'console' || names.has(m[1]!)) continue;
      unreadable.push(`${f}:${code.slice(0, m.index).split('\n').length}  receiver \`${m[1]}\``);
    }
  }
  assert.ok(assertions > 4000, `only ${assertions} assertions parsed — the parser has lost its reach`);
  // R203 measured 167 of these, and exactly ONE of them was a secrecy claim
  // (42-dark-b:1331). The other 166 assert on public events and are correct as
  // written — CT-84's "153 files still asserting against the flat log" is the
  // size of the CAPABILITY gap, not the number of unfalsifiable assertions.
  assert.ok(flatReads > 100, `only ${flatReads} assertions read a flat Harness log — R203 measured 167`);
  assert.ok(harnessFiles > 100, `only ${harnessFiles} files bind a Harness`);
  assert.deepEqual(unreadable, [],
    'a `.log` on a receiver this lint cannot tie to a Harness. Either it is not a game log, or '
    + `the lint is blind to it:\n  ${unreadable.join('\n  ')}`);
  console.log(`    ${assertions} assertions across ${files.length} files; `
    + `${flatReads} read a seatless Harness log`);

  // the derived sets
  assert.ok(PRIVATE_LOOK_CARDS.length >= 4,
    `only ${PRIVATE_LOOK_CARDS.length} cards print "look at …hand" — the printed data or the `
    + 'matcher moved, and the card half of the rule is asserting almost nothing');
  for (const n of ['Thought Extraction', 'Bripp', 'Eldritch Dreamtender', 'Divine Foresight', 'Hand Peeper']) {
    assert.ok(PRIVATE_LOOK_CARDS.includes(n), `${n} must be derived into the private-look set`);
  }
  assert.ok(PRIVATE_FRAGMENTS.length >= 4,
    `only ${PRIVATE_FRAGMENTS.length} privately-emitted fragments found under engine/src — the `
    + '`.ev(` sweep has lost its reach, and the fragment half of the rule is empty');
  assert.ok(PRIVATE_FRAGMENTS.includes('Thought Extraction reveals'),
    'the fragment the ticket is about must be in the derived set');
  console.log(`    ${PRIVATE_LOOK_CARDS.length} private-look cards, `
    + `${PRIVATE_FRAGMENTS.length} privately-emitted fragments: ${PRIVATE_FRAGMENTS.join(' · ')}`);
});

/* ── §5 · the controls: a PUBLIC reveal keeps the shared log ─────────────── */

test('R203 §5 control: Bioremediation and Void Memory print REVEALS, and stay legal readers of h.log', () => {
  // CT-84 names these two, and they are the reason the rule is derived from
  // printed text instead of from vocabulary. Both say "hand" and "reveal" in
  // as many words; both are public; a lint keyed on those words needs an
  // exemption for each, and an exemption reasoned in prose is CT-83.
  for (const n of ['Bioremediation', 'Void Memory']) {
    assert.ok(allCardNames().includes(n), `${n} is still a registered card`);
    assert.ok(!PRIVATE_LOOK_CARDS.includes(n),
      `${n} was derived into the PRIVATE-LOOK set. It prints a public reveal, so the partition `
      + 'R197b drew has moved and §3 is now flagging the table\'s own business.');
  }
  assert.match(printedOf('Bioremediation'), /reveals?\s+their\s+hand/i,
    'the control rests on the printed verb — if the card is reworded, re-derive before trusting §3');

  // and the real assertion each control carries today is untouched by §3
  const check = (file: string, needle: string): void => {
    const raw = fs.readFileSync(path.join(HERE, file), 'utf8');
    assert.ok(raw.includes(needle), `${file} no longer contains the control assertion "${needle}"`);
    assert.deepEqual(offencesIn(raw, file).filter(o => o.why.includes(needle.slice(0, 20))), []);
  };
  check('28-metal-c.test.ts', "h.log.some(l => l.includes('hand is empty — revealed'))");
  // Bioremediation's own test asserts on `state.seenHand`, not on any log at
  // all — so it is a control for the PARTITION (§5's first half) and not for
  // the flat-log reader the ticket describes. Named rather than assumed.
  const bio = fs.readFileSync(path.join(HERE, '23-wood-a.test.ts'), 'utf8');
  assert.ok(bio.includes("assert.ok(h.state.seenHand[D], 'D keeps the hand snapshot (revealHandTo)')"),
    "Bioremediation's test reads seenHand, not the log — if that changes, re-check §5");
});
