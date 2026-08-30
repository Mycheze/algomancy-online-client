/* R231 / CT-88 — THE ABSORB RULE LIVES IN ONE PLACE.
 *
 * ── THE GAP
 *
 * `Harness.absorb()` states a rule in its own docstring: **a signal-only event
 * is not a log line.** An event with an empty `msg` ('stackFlash' — a signal
 * for the client, not a line for the reader) goes into `events` and is never
 * logged, because `logTypes` is indexed BY LOG LINE and drifts out of
 * alignment the moment an unlogged event is counted.
 *
 * `absorb` is private. So every test that pokes the engine directly — build an
 * `E` over `h.state`, run something, put the events back — had to re-derive
 * the rule from scratch, and 35 files did. FOUR of them reproduced the guard.
 * ONE kept `logTypes` aligned. Twelve were putting 89 empty strings into
 * `h.log` on every run of the suite: not a hypothetical, measured with the
 * shared helper instrumented. Nothing read them yet, which is the only reason
 * this was minor — a loaded gun, not a firing one.
 *
 * ── WHY THE LINT KEYS ON THE SHAPE AND NOT ON A NAME
 *
 * CT-88's own verify line says "no test file declares its own `withE`". That
 * lint would have found SEVEN of the thirty-five. Twenty-eight of the helpers
 * were called `whiteBox`, and one was called `dealAllFrom`, and one was not a
 * helper at all — a bare loop inlined in a test body. docs/13 §7.2, derive
 * never enumerate: the offence is the SHAPE, `push` into a Harness's `log`,
 * `logTypes` or `events` from a test file, and a rename does not launder it.
 *
 * The `events` half is not decoration. `.log.push(` — CT-88's own definition —
 * misses 136-triggers-and-modes entirely: its `whiteBox` is byte-identical to
 * the shared one except that it drops the log on the floor, so the harness's
 * log silently omits everything that happened in a white-box call. A rule
 * written to the reported symptom would have left it standing.
 *
 * ── WHAT IS HERE
 *
 *  §1  THE INSTRUMENT, and PROOF IT IS NOT BLIND (docs/13 §7.4). Planted
 *      helpers under four different names, the inline form, the events-only
 *      form, and every near miss that must stay legal — including this file's
 *      own fixtures, which are string literals and must not convict it.
 *  §2  THE LINT over the corpus.
 *  §3  THE REACH MEASUREMENT: the corpus, the receiver resolver and the number
 *      of files actually routed through the shared helper, all asserted, so a
 *      green here cannot be vacuous.
 *  §4  THE RULE ITSELF, checked against the source of truth: what `util.ts`
 *      exports must still do what `harness.ts` does.
 *
 * No seeds — this file reads source text and plays no games.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../src/harness.ts';
import { stripCode } from './card-todo.ts';
import { absorb, withE } from './util.ts';
import { E } from '../src/engine.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** THE ONE LEGAL HOME. `util.ts` is where the rule is allowed to be written
 * out; everything else must call it. This is not an exemption list that can
 * grow — it is the single file the lint exists to point at. */
const HOME = 'util.ts';

type Offence = { where: string; why: string };

const lineOf = (code: string, idx: number): number => code.slice(0, idx).split('\n').length;

/** Identifiers this source binds to a `Harness`. Deliberately generous: a
 * false POSITIVE here only means the lint asks a question, while a false
 * negative means it goes blind, and §3 measures that it resolves anything at
 * all. */
function harnessNamesIn(code: string): Set<string> {
  const names = new Set<string>();
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*(?::\s*Harness\s*)?=\s*new\s+Harness\b/g)) {
    names.add(m[1]!);
  }
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*Harness\b/g)) names.add(m[1]!);
  return names;
}

/**
 * Every hand-rolled absorb in one source text.
 *
 * `log` / `logTypes` are flagged on ANY receiver: nothing in this suite has a
 * `.log` that is not a game log, and the strict reading has no blind spot.
 * `events` is flagged only on a resolved Harness, because a plain result
 * object with an `events` array is an ordinary thing to build (drill.ts does).
 */
function offencesIn(raw: string, where: string): Offence[] {
  const code = stripCode(raw);
  const harnesses = harnessNamesIn(code);
  const out: Offence[] = [];
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*\.\s*(log|logTypes|events)\s*\.\s*push\s*\(/g)) {
    const [, recv, field] = m as unknown as [string, string, 'log' | 'logTypes' | 'events'];
    if (recv === 'console') continue;
    if (field === 'events' && !harnesses.has(recv)) continue;
    out.push({
      where: `${where}:${lineOf(code, m.index)}`,
      why: `\`${recv}.${field}.push(\` — a test file writing a Harness's ${field} by hand. That is `
        + '`Harness.absorb()` re-derived, and re-deriving it is how 31 of 35 files lost the rule it '
        + 'states in its own docstring ("a signal-only event is not a log line") and 34 of 35 lost '
        + '`logTypes` alignment. Call `absorb(h, e.events)` or `withE(h, fn)` from test/util.ts.',
    });
  }
  return out;
}

function sourceFiles(): string[] {
  return fs.readdirSync(HERE).filter(f => f.endsWith('.ts') && f !== HOME).sort();
}

/* ── §1 · the instrument, and proof it can see ───────────────────────────── */

test('R231 §1: the lint is not blind — it convicts a local absorb under any name, and acquits every near miss', () => {
  // ⚠ 149-strip-code's question, asked of this checker: what would a BLIND
  // version of this file do? It would return [] for everything and §2 would
  // read clean — which is the state the whole suite was in before this round.
  const one = (body: string): string =>
    "import { Harness } from '../src/harness.ts';\nfunction f(h: Harness, fn: (e: E) => void): void {\n"
    + `  const e = new E(h.state);\n${body}\n}\n`;

  // (a) THE INSTANCE — the exact tail 31 files carried, verbatim
  const caught = offencesIn(one('  h.events.push(...e.events);\n  for (const ev of e.events) h.log.push(ev.msg);'), 'planted');
  assert.equal(caught.length, 2, 'both the events push and the log push are the offence');
  assert.match(caught[0]!.why, /absorb\(h, e\.events\)/, 'and the message must say what to do instead');

  // (b) THE NAME IS NOT THE RULE. CT-88's verify line ("no test file declares
  //     its own `withE`") would have found seven of thirty-five. Each of these
  //     is a real helper name from the population.
  for (const name of ['withE', 'whiteBox', 'dealAllFrom', 'runRaw']) {
    const src = "import { Harness } from '../src/harness.ts';\n"
      + `function ${name}(h: Harness): void {\n  const e = new E(h.state);\n`
      + '  for (const ev of e.events) h.log.push(ev.msg);\n}\n';
    assert.equal(offencesIn(src, 'planted').length, 1, `a local absorb called \`${name}\` walked past the lint`);
  }

  // (c) NOT A HELPER AT ALL — 167-variable-ability-costs inlined the loop in a
  //     test body, with no enclosing function to name
  assert.equal(offencesIn(
    "import { Harness } from '../src/harness.ts';\ntest('t', () => {\n  const h = new Harness(1);\n"
    + '  for (const ev of e.events) h.log.push(ev.msg);\n});\n', 'planted').length, 1,
  'an inlined absorb is the same offence as a named one');

  // (d) THE GUARDED FORM IS STILL AN OFFENCE. Four files got the `if (ev.msg)`
  //     right and only ONE also kept logTypes aligned — a correct copy is a
  //     copy, and it is the copy that diverges next.
  assert.equal(offencesIn(one('  for (const ev of e.events) if (ev.msg) h.log.push(ev.msg);'), 'planted').length, 1,
    'getting the rule right by hand is not the same as not writing it by hand');

  // (e) THE SHAPE CT-88's OWN DEFINITION MISSES: events absorbed, log dropped.
  //     136-triggers-and-modes is this, and `.log.push(` never sees it.
  const eventsOnly = offencesIn(one('  h.events.push(...e.events);'), 'planted');
  assert.equal(eventsOnly.length, 1,
    'a helper that absorbs EVENTS and drops the log is a hand-rolled absorb too — the harness log '
    + 'then omits everything a white-box call did, and a `.log.push(`-keyed lint cannot see it');

  // (f) THE CURE IS NOT FLAGGED — or the lint would forbid its own fix
  assert.deepEqual(offencesIn(one('  absorb(h, e.events);'), 'planted'), []);
  assert.deepEqual(offencesIn("import { withE } from './util.ts';\nwithE(h, e => e.settle());\n", 'planted'), []);

  // (g) NEAR MISSES that must stay legal
  assert.deepEqual(offencesIn("const res = { events: [] as string[] };\nres.events.push('x');\n", 'planted'), [],
    'a plain result object with an `events` array is not a Harness — drill.ts builds one');
  assert.deepEqual(offencesIn("import { Harness } from '../src/harness.ts';\nconst h = new Harness(1);\nconsole.log.push;\n", 'planted'), [],
    'console.log is not a game log');
  assert.deepEqual(offencesIn("import { Harness } from '../src/harness.ts';\nconst h = new Harness(1);\nassert.equal(h.log.length, 3);\n", 'planted'), [],
    'READING the log is not writing it — 167 assertions do, and they are correct as written');

  // (h) PROSE IS NOT CODE — the two blindnesses stripCode has had (149)
  assert.deepEqual(offencesIn(one('  // h.log.push(ev.msg) is what this used to say\n  absorb(h, e.events);'), 'planted'), [],
    'a line comment quoting the old tail is not the old tail');
  assert.deepEqual(offencesIn(one('  /*\n   * h.events.push(...e.events);\n   */\n  absorb(h, e.events);'), 'planted'), [],
    'nor is a block comment');
  assert.deepEqual(offencesIn("import { Harness } from '../src/harness.ts';\nconst h = new Harness(1);\n"
    + "const s = 'h.log.push(ev.msg)';\n", 'planted'), [],
  'nor is a string literal — which is what every fixture in this test is, and why §2 does not '
    + 'convict this file');
});

/* ── §2 · the lint ───────────────────────────────────────────────────────── */

test('R231 §2: no test source hand-rolls Harness.absorb — the rule lives in test/util.ts alone', () => {
  const offences: Offence[] = [];
  for (const f of sourceFiles()) offences.push(...offencesIn(fs.readFileSync(path.join(HERE, f), 'utf8'), f));
  assert.deepEqual(offences.map(o => `${o.where}  ${o.why}`), [],
    'a hand-rolled absorb. The fix is never an exemption and never a local copy that happens to be '
    + 'correct: import `absorb` or `withE` from test/util.ts, which is the only file allowed to '
    + 'write the rule out. CT-88 is what happens when 35 files each keep their own copy.');
});

/* ── §3 · the reach measurement ──────────────────────────────────────────── */

test('R231 §3: the lint has reach — the corpus, the receiver resolver and the routed files', () => {
  // Every number is asserted because a checker that quietly loses its reach
  // reports clean forever. docs/13 §5 is the catalogue of the ones that did.
  const files = sourceFiles();
  assert.ok(files.length > 150, `only ${files.length} test sources scanned`);
  assert.ok(!files.includes(HOME), 'util.ts must be excluded — it is where the rule is written');

  let harnessFiles = 0, pokes = 0, routed = 0;
  const unresolved: string[] = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(HERE, f), 'utf8');
    const code = stripCode(raw);
    const names = harnessNamesIn(code);
    if (names.size) harnessFiles++;
    if (/\bnew E\(/.test(code)) pokes++;
    // ⚠ the import PATH is a string literal, so `stripCode` has blanked it —
    // ask the raw text for the path and the stripped text for the identifier.
    if (/from '\.\/util\.ts'/.test(raw) && /\b(withE|absorb)\b/.test(code)) routed++;
    // THE RECEIVER MEASUREMENT: an `X.events` this lint cannot tie to a
    // Harness is a hole it reads straight past. Reported, not asserted away.
    for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*\.\s*events\s*\.\s*push\s*\(/g)) {
      if (!names.has(m[1]!)) unresolved.push(`${f}:${lineOf(code, m.index)}  receiver \`${m[1]}\``);
    }
  }
  assert.ok(harnessFiles > 100, `the receiver resolver bound a Harness in only ${harnessFiles} files — `
    + 'it has stopped resolving, and the `events` half of the rule is asserting nothing');
  assert.ok(pokes > 30, `only ${pokes} files build a white-box \`E\` — the population the rule is about`);
  assert.ok(routed > 30, `only ${routed} files import the shared helper; CT-88 routed 36`);
  console.log(`    ${files.length} sources; ${harnessFiles} bind a Harness; `
    + `${pokes} poke a raw E; ${routed} route through test/util.ts`);
  if (unresolved.length) console.log(`    unresolved \`.events.push(\` receivers (not Harnesses):\n      ${unresolved.join('\n      ')}`);
});

/* ── §4 · the rule itself, against its source of truth ───────────────────── */

test('R231 §4: the shared absorb does what Harness.absorb does — the guard, and logTypes alignment', () => {
  // The lint above only proves there is ONE copy. This proves the one copy is
  // right, by behaviour rather than by reading it: a signal-only event must
  // not become a log line, and logTypes must stay index-aligned with log.
  const h = new Harness(19701);
  // ⚠ not `before.log`: 174-secrecy-is-seat-aware measures every `X.log` it cannot
  // tie to a Harness, and a field called `log` on a plain object is one of them.
  const before = { lines: h.log.length, types: h.logTypes.length, events: h.events.length };
  assert.equal(before.lines, before.types, 'the harness starts aligned');

  absorb(h, [
    { type: 'info', msg: 'a real line' },
    { type: 'stackFlash', msg: '' },              // the signal-only event, by name
    { type: 'info', msg: 'another real line' },
  ] as Parameters<typeof absorb>[1]);

  assert.equal(h.events.length, before.events + 3, 'all three events are absorbed');
  assert.equal(h.log.length, before.lines + 2, 'but the empty msg is NOT a log line');
  assert.equal(h.logTypes.length, h.log.length, 'and logTypes is still index-aligned with log');
  assert.ok(!h.log.includes(''), 'no empty string reached the log — the 89 that used to');
  assert.equal(h.logTypes[h.log.length - 1], 'info',
    'the last type names the last MESSAGE, not the last event — that is what alignment means');

  // and `withE` routes through it rather than re-deriving it
  const g = new Harness(19702);
  const mark = g.log.length;
  withE(g, (e: E) => { e.spawnUnit(0, 'Unit Token', e.homeRegion(0)); });
  assert.equal(g.logTypes.length, g.log.length, 'withE keeps the harness aligned');
  assert.ok(g.log.slice(mark).every(l => l !== ''), 'and puts no empty line in the log');
  assert.ok(g.events.length > 0, 'while still feeding the event stream h.do() would have fed');
});
