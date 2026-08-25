/**
 * HOW DEEPLY IS EACH CARD ACTUALLY TESTED? — CARD-TODO #9.
 *
 * The complaint this file answers, measured 2026-08-23: 121 of the pool's
 * registered cards were named exactly ONCE across every file in test/. That
 * shape is the registration smoke check — spawn the body, assert the printed
 * power/toughness — and it passes for a card whose rules text does nothing at
 * all. It is what let three silent cards (Abduct, Divine Intervention,
 * Immolate) sit behind a green suite through a whole playtest round.
 *
 * The fix for that is not one number, it is a PROGRAM: per-card assertions
 * that the card does the specific thing it prints. A program needs a
 * scoreboard, and a scoreboard that nobody can see is a comment. So this file
 * measures the pool's coverage in four bands, prints them on every run, and
 * floors each one so it cannot silently go backwards.
 *
 * THE FOUR BANDS, weakest to strongest:
 *
 *   1. REGISTERED    the card exists. Every card is here.
 *   2. DRIVEN        81-card-drill plays it through the real action path in
 *                    three board states and it resolves without crashing and
 *                    changes the game state. A behavioural floor, and it is
 *                    only a floor: it does not check WHAT changed.
 *   3. PROMISED      84-card-semantics extracts a typed promise from its
 *                    printed text and observes the promise being delivered.
 *                    Only unconditional promises count.
 *   4. NAMED         a human wrote a test about this specific card, by name,
 *                    outside the sweep files. This is the only band that can
 *                    assert the card does the RIGHT thing rather than A thing.
 *
 * Band 4 is the one #9 is about, and the honest read of the number is that it
 * counts ATTENTION, not correctness — a card named ten times can still be
 * wrong, and a card named twice can be perfect. What it cannot be is a card
 * nobody has looked at, and that is the population this file exists to keep
 * visible.
 *
 * ⚠ The sweep files are excluded on purpose. Their mentions are exemption
 * lists and ledger rows — a card named in `KNOWN_UNMET` or in card-ledger.ts is
 * named because it does NOT work, and counting that as coverage would invert
 * the measurement. The exclusion list is checked against reality below, so a
 * new sweep file cannot quietly inflate the number.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/cards/registry.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import { stripCode } from './card-todo.ts';   // R148, appended block at the end of this file

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ════════════════════════════════════════════════════════════════════════
// R153 / CT-43 — what the two BIN sweeps in this file read.
// ════════════════════════════════════════════════════════════════════════
//
// R124's sweep (bin EXIT) and R145's sweep (bin ENTRY) are source-reading
// assertions, and a source-reading assertion has exactly two ways to lie.
// Both helpers below exist to close both of them, for both sweeps.
//
// (1) COMMENTS. Both sweeps used to read RAW lines, so a comment that merely
//     MENTIONS `.bin.push(` — this paragraph, for instance — failed the suite
//     for no reason. That is a false positive that punishes writing the rule
//     down next to the code it governs, which is most of what this repo does.
//
// (2) ALIASING. Both matched `<expr>.bin.push(` and a local literally NAMED
//     `bin`, so `const mb = g.player(m.owner).bin; mb.push(m.card);` walked
//     straight past — and Hooba-Mon's `exchangeInPlace` contained exactly that
//     shape until R153 (only its BODY push was caught, which is why the old
//     BIN_PUSH_EXEMPT waived one line of three). A sweep that a local variable
//     steps around measures its own regex, not the codebase.

/**
 * A file's lines with comments and string bodies removed, ONE LINE AT A TIME,
 * so line `n` of the result is still line `n` of the file.
 *
 * ⚠ `stripCode` (card-todo.ts, shared with the R148 sweep below) is the
 * codebase's stripper and it is what does the work here — but it CANNOT be
 * applied to a whole file for this job, and both reasons are live in this repo:
 *
 *  · it deletes a block comment outright, newlines and all, so every line
 *    number after the first block comment would name the wrong line; and
 *  · its string arm has no notion of a REGEX LITERAL, so the lone `'` inside
 *    `/[[\]().,;:!?'"]/g` at src/engine.ts:175 pairs with the next quote in the
 *    file and everything between is deleted. Whole-file, that swallows 742
 *    quote-free lines of engine.ts — including all three of its `bin.push`
 *    lines, which would leave the R145 sweep below measuring nothing at all.
 *
 * Per line neither can happen: a runaway quote cannot leave the line it opened
 * on, and the line count is preserved by construction. Block comments are
 * blanked to SPACES first (rather than removed) for the same reason.
 */
function codeLines(src: string): string[] {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' '))
    .split('\n')
    .map(stripCode);
}

/**
 * The local names bound DIRECTLY to a player's bin in this file — one level of
 * aliasing, which is what the two sweeps follow.
 *
 * The initializer must END at `.bin`: `const n = p.bin.length` binds a number,
 * not a bin, and treating `n.push(` as a bin write would false-positive in a
 * dozen card files (`n`, `i`, `idx`, `name`, `gone`, `options` are all bound
 * off a bin somewhere in src/).
 *
 * ⚠ STILL OPEN, stated rather than hidden: a CONDITIONAL binding is not
 * followed — `const zone = from === 'bin' ? e.player(seat).bin : …hand;`
 * (src/apply.ts:634). There is exactly one in the codebase and it is NOT a
 * bypass: its `zone.splice` branch is unreachable when the zone is a bin,
 * because the line above it routes that case through `E.removeFromBin` (R124).
 * Checked by hand on 2026-08-25. A SECOND one would be invisible here.
 */
function binAliases(lines: string[]): string[] {
  const out = new Set<string>();
  const decl = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*[^;]*\.bin\s*;/g;
  for (const line of lines) {
    let m: RegExpExecArray | null;
    decl.lastIndex = 0;
    while ((m = decl.exec(line)) !== null) out.add(m[1]!);
  }
  return [...out];
}

/** `X.push(` / `X.splice(` for every alias `X`, or null when the file has none */
function aliasCall(aliases: string[], verb: 'push' | 'splice'): RegExp | null {
  if (!aliases.length) return null;
  return new RegExp(`(?:^|[^\\w$.])(?:${aliases.join('|')})\\.${verb}\\(`);
}

/**
 * Files whose card mentions are NOT evidence that anyone tested the card.
 * Each carries its reason; the test below fails if one stops existing, so the
 * list cannot outlive its cause the way the old PARKED notes did.
 */
const SWEEPS: Record<string, string> = {
  '63': 'printed-data conformance — names every card by construction',
  '65': 'effect conformance — its lists are exemptions, not behaviour',
  '68': 'target conformance — same',
  '71': 'the card ledger sweep — every name in it is a card that does NOT work',
  '81': 'the whole-pool drill — names every card by construction',
  '83': 'the todo list — names cards that are broken',
  '84': 'the semantic sweep — its KNOWN_UNMET is a list of failures',
  '88': 'replacement conformance — exemption lists',
  '31': 'trio/deck sweeps',
  '34': 'constructed deck lists',
  '52': 'the UI glossary sweep',
  '57': 'the card-text sweep',
  '70': 'the playtest ledger',
  '75': 'UI reachability',
};

function testFiles(): string[] {
  return fs.readdirSync(HERE).filter(f => f.endsWith('.test.ts'));
}

/** how many times each card is named in NON-sweep test files */
function namedCounts(): Map<string, number> {
  const counts = new Map(allCardNames().map(n => [n, 0]));
  for (const f of testFiles()) {
    if (SWEEPS[f.slice(0, 2)]) continue;
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    for (const name of counts.keys()) {
      // both quote styles: `card("Blight's End", …)` is written with doubles.
      // Title-style mentions count too (`test('Name: what it does', …)`) —
      // exact-quote-only counting put 97 cards in the "named once" band on
      // 2026-08-24, and a full audit of all 97 found 96 of them already
      // carried real behavior tests whose TITLES named the card: the band was
      // measuring the regex, not the coverage.
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const n = (src.match(new RegExp(`(['"])${esc}(?:\\1|: )`, 'g')) ?? []).length;
      if (n) counts.set(name, counts.get(name)! + n);
    }
  }
  return counts;
}

/* ── R155: THE HARBINGER TRAP IS BOLTED SHUT ──────────────────────────────
 *
 * The count of `{ todo: true }` tests in test/ is ZERO, and this is what keeps
 * it there.
 *
 * WHY IT IS A HARD ZERO AND NOT A FLOOR. A todo can never fail. That single
 * property is this repo's founding incident: Harbinger of Immolation's printed
 * second half was dead for two days behind a fully green suite because it was
 * "tracked" by a batch comment and a todo, and neither of those can contradict
 * anything. Every other census in this file is a floor that may drift; a todo
 * is not a weak test, it is a test-shaped hole, so the only honest number is
 * none. The last one — Its Dark Bubb's {Inverted}, parked on a stat layer that
 * had shipped two engine waves earlier — was promoted to four real tests in
 * 43-dark-c on 2026-08-25.
 *
 * A gap still gets tracked, just not by something that cannot fail:
 *   · a card half that does nothing → test/card-ledger.ts, checked in both
 *     directions by 71-card-ledger (which now also reads statics, cost mods
 *     and trigger guards — R155);
 *   · anything else → test/card-todo.ts, whose entries are asserted to still
 *     be true (83-card-todo).
 *
 * WHY IT LIVES HERE and not in 71-card-ledger. 71 is about the CARD POOL: its
 * sweep reads card definitions and its exemption lists are card names, so a
 * todo about the client, the server or the stack would be out of its scope
 * entirely. This ban is over test/ as a corpus, which is the population this
 * file already enumerates, prints and floors.
 *
 * ⚠ TWO false-positive traps, both hit while writing this:
 *
 *  1. A dozen files in test/ MENTION `{ todo: true }` in prose — the paragraph
 *     you are reading does it twice — so the decision has to be made on CODE.
 *     That is `stripCode` (R148), applied to each `test(` HEADER rather than
 *     to the whole file, because:
 *  2. `stripCode` is not sound over a whole test file. A REGEX LITERAL
 *     containing a quote character — `/(['"`])…/`, which 71-card-ledger uses
 *     to parse test titles — opens a string as far as the stripper is
 *     concerned and desynchronises everything after it. Whole-file stripping
 *     turned that file into garbage that contained a stray `todo: true`, and
 *     the first draft of this check reported it as a violation. A `test(`
 *     header is a title and an options object: no regex literals, so the
 *     stripper is sound over one.
 *
 * And headers are found line-anchored (`^\s*test(`), which is how all 2228 of
 * them are written — that alone drops `re.test(…)`, the other thing a bare
 * `\btest\s*\(` matches.
 */

/** every `test(` header in `src`, bounded at the callback's `=>` or at the
 *  next `test(`, whichever comes first — a `function () {}` callback has no
 *  `=>` of its own and would otherwise swallow the file down to the next one. */
function testHeaders(src: string): string[] {
  const starts = [...src.matchAll(/^[ \t]*test\s*\(/gm)].map(m => m.index);
  return starts.map((at, i) => {
    const arrow = src.indexOf('=>', at);
    const next = starts[i + 1] ?? src.length;
    return src.slice(at, Math.min(arrow < 0 ? src.length : arrow, next));
  });
}
/** the title, for a header that has one — every string literal in it, joined,
 *  because titles here are routinely concatenations */
const titleOf = (header: string) =>
  [...header.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(x => x[2]!).join('');

test('R155: not one test in test/ is `{ todo: true }` — a todo can never fail (the Harbinger trap)', () => {
  // every .ts, not just *.test.ts: a `test()` called from an imported helper
  // registers exactly the same way, and card-todo.ts / card-ledger.ts are the
  // two files most likely to grow one.
  const files = fs.readdirSync(HERE).filter(f => f.endsWith('.ts')).sort();
  const offenders: string[] = [];
  let scanned = 0;
  for (const f of files) {
    const headers = testHeaders(fs.readFileSync(path.join(HERE, f), 'utf8'));
    scanned += headers.length;
    const todos = headers.filter(h => /todo\s*:\s*true/.test(stripCode(h)));
    if (todos.length) offenders.push(`${f}: ${todos.length} — ${todos.map(titleOf).join(' | ')}`);
  }

  console.log(
    `    todo census: ${scanned} tests across ${files.length} files in test/ · `
    + `${offenders.length} files carry a { todo: true }`);

  assert.deepEqual(offenders, [],
    'these files contain a { todo: true } test:\n  ' + offenders.join('\n  ')
    + '\n\nA { todo: true } test CANNOT FAIL, so it tracks nothing — it only makes the '
    + 'suite report a number nobody has to act on. That is exactly how Harbinger of '
    + "Immolation's second half stayed dead through two playtest reports and a conceded "
    + 'game. Write the real test (it may fail — that is the point), or, if the gap is '
    + 'genuinely not buildable yet, declare it where declarations get checked: '
    + 'test/card-ledger.ts for a dead card half, test/card-todo.ts for anything else. '
    + 'Both are asserted against reality on every run; a todo is asserted against nothing.');

  // and the scan itself must not go blind: if `test(` stops being how a test
  // is written here, this whole check silently passes over an empty set.
  assert.ok(scanned > 1500,
    `only ${scanned} test() headers found across test/ — the scan has stopped seeing the `
    + 'suite, so its zero means nothing (measured 2026-08-25: comfortably above this).');
});

test('every excluded sweep file still exists — an exclusion cannot outlive its cause', () => {
  const present = new Set(testFiles().map(f => f.slice(0, 2)));
  const gone = Object.keys(SWEEPS).filter(p => !present.has(p));
  assert.deepEqual(gone, [],
    'these prefixes are excluded from the coverage census but no longer name a test file. '
    + 'Excluding a file that is not there inflates the "named by a human" band for free.');
});

test('the pool coverage census — printed on every run so CARD-TODO #9 cannot rot', () => {
  const counts = namedCounts();
  const total = counts.size;
  const never = [...counts].filter(([, n]) => n === 0).map(([c]) => c).sort();
  const once = [...counts].filter(([, n]) => n === 1).map(([c]) => c).sort();
  const many = total - never.length - once.length;

  console.log(`    pool coverage: ${total} cards registered`);
  console.log(
    `      band 4 (a human wrote a test naming it): ${many} named more than once · `
    + `${once.length} named exactly once · ${never.length} never named outside a sweep`);
  console.log(
    '      bands 2-3 (drill + semantics) are reported by 81-card-drill and '
    + '84-card-semantics on their own runs');
  if (never.length) console.log(`      never named: ${never.join(', ')}`);

  // The bar is that the WEAK band does not grow. Adding cards is fine; adding
  // cards nobody writes a test for is the thing this catches. Absolute, not a
  // percentage, so a bigger pool cannot dilute it.
  assert.ok(once.length + never.length <= 8,
    `${once.length + never.length} cards have at most one human-written mention `
    + `(${never.length} have none). Measured 1 (Slink, whose {Thieving} is pinned through `
    + 'it in 09-attrs) on 2026-08-24, after the CARD-TODO #9 audit of the whole band and '
    + 'title-aware counting — the floor is set just above the real number ON PURPOSE, so '
    + 'the next card added without a test of its own trips it. A registration smoke check '
    + 'passes for a card whose rules text does nothing at all, which is the whole of '
    + 'CARD-TODO #9.');
});

// ── CARD-TODO #21: bounded+zone has a real budget holder now (R124) ──────
//
// R51 dispatches a zone trigger through `E.standIn`, a detached entity with a
// THROWAWAY `budgets: {}` — so this census used to assert that NO ability was
// both `bounded` and zone-dispatched: a [once] written onto the ghost bounded
// nothing, and the honest fix while zero cards needed the combination was to
// keep it out of the pool.
//
// R124 answered the design question the old census was holding open ("what is
// a per-card budget (R9) for a card that is not in play?"): PER SEAT PER CARD
// NAME, in `GameState.zoneBudgets` — real, serialized state, written by
// composeParts' stand-in branch, refunded by refundPart's (R113), cleared by
// startTurn beside the Entity.budgets wipe. A bin holds bare names, not
// instances, so the name in that seat's zone IS the card as far as the rules
// can see — the same reading R51 already used to give three copies one firing.
//
// WHY THE CHANGED PREMISE IS STILL HONEST: the old test's claim was "the
// ghost budget is a silent lie, so the shape is banned". The ghost budget is
// gone — a bounded zone firing reserves in real state, and the BEHAVIOUR is
// pinned by the Rotling tests in 43-dark-c (bounds once per turn, R113
// refund on decline, survives a JSON round-trip, wiped by startTurn). What
// this census still holds is the POPULATION: per-seat-per-name is a design
// decision with a written rationale (R124), not a universal truth about every
// printed text — so a new bounded+zone ability must arrive HERE, be checked
// against that rationale, and be added deliberately rather than slipping in
// because the combination stopped failing.
test('no ability is both bounded and zone-dispatched without a real budget holder — the population is enumerated (CARD-TODO #21/R124)', () => {
  const found: string[] = [];
  for (const name of allCardNames()) {
    const def = getCard(name);
    for (const ab of [...(def.abilities ?? []), ...(def.augmentText ?? [])]) {
      const a = ab as { bounded?: boolean; zone?: string };
      if (a.bounded && a.zone) found.push(`${name} (zone '${a.zone}')`);
    }
  }
  assert.deepEqual(found.sort(), ["Rotling (zone 'bin')"],
    'a bounded ability dispatched from a zone keeps its [once] in GameState.zoneBudgets, '
    + 'per (seat, card name), per turn — R124 / CARD-TODO #21. That is a design decision '
    + "with a rationale, not a default: check the new card's printed text against it "
    + '(is per-seat-per-name what IT means?), then add it to this list on purpose.');
});

// ── R124: the choke point stays the ONLY way out of a bin (CARD-TODO #26) ──
//
// R124's claim — every removal of a card from a player's bin goes through
// `E.removeFromBin`, which fires 'leftBin' once per card — is a GUARD
// property, not a status: it was found violated twice AFTER being declared
// solved (zoneTake's mod-from-bin branch and the R123 grantor erase both
// spliced bins directly, firing nothing). At the time nothing reachable
// broke, and the reason recorded here was that Rotling — the only 'leftBin'
// listener — had no augment/graft symbol. That was a fact about the code, not
// about the card: Rotling prints [Switch1] and IS graftable, which the
// literal-reading audit fixed hours later. The bypass is reachable by a real
// card now (graft a Rotling out of your bin), so this guard is load-bearing
// rather than precautionary.
// So this scans the guard itself: a NEW direct bin splice anywhere in src/
// fails here. If that is you, route the removal through
// `E.removeFromBin(seat, index, reason)` instead — that is what fires
// 'leftBin' — and announce the removal in your own words at the call site
// (the choke point is deliberately signal-only).
test('R124 stays solved: the only direct bin splice in src is inside removeFromBin', () => {
  const SRC = path.resolve(HERE, '..', 'src');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(SRC);
  const hits: string[] = [];
  for (const file of files) {
    // R153: comments stripped (a comment naming `.bin.splice(` is not a splice)
    // and one level of ALIASING followed — see codeLines / binAliases above.
    const lines = codeLines(fs.readFileSync(file, 'utf8'));
    const alias = aliasCall(binAliases(lines), 'splice');
    lines.forEach((line, i) => {
      // `.bin.splice(` — any player-state bin spliced through its property;
      // `bin.splice(` — a local alias of one; `[from].splice(` — a computed
      // zone access that can reach a bin (the shape bypass A hid behind);
      // `alias` — a local bound to a bin under ANY name (R153).
      if (/\.bin\.splice\(|\bbin\.splice\(|\[from\]\.splice\(/.test(line)
        || (alias !== null && alias.test(line)))
        hits.push(`${path.basename(file)}:${i + 1}`);
    });
  }
  assert.equal(hits.length, 1,
    `direct bin splices at [${hits.join(', ')}] — every bin removal must go through `
    + "E.removeFromBin so 'leftBin' fires (R124, CARD-TODO #26)");
  assert.ok(hits[0]!.startsWith('engine.ts:'), `the one legal site lives in engine.ts, not ${hits[0]}`);
  const engineLines = fs.readFileSync(path.join(SRC, 'engine.ts'), 'utf8').split('\n');
  const n = Number(hits[0]!.split(':')[1]) - 1;
  assert.ok(engineLines.slice(Math.max(0, n - 8), n).join('\n').includes('removeFromBin('),
    'the one direct bin splice is no longer inside removeFromBin itself');
});

// ── R140: a bin-index event's responder never re-finds its card by NAME ────
//
// R131 fixed identity in a bin as (card NAME, nth occurrence), because a bin
// holds bare names and "copies of one card there are genuinely
// indistinguishable". Two events carry that index today: 'trashed' (R131,
// stamped by `E.noteTrashed`) and 'died' (R140, stamped by `E.destroy`, which
// also stamps `binSeat` — a death event's `seat` is the CONTROLLER while the
// card bins to its OWNER).
//
// A card that RESPONDS to one of those and then reaches into the bin must
// resolve that pair — `eventBinSlot` in dsl.ts — and treat a miss as GONE.
// `bin.lastIndexOf(name)` answers a different question, "the last copy of that
// name in the bin right now", and the two answers diverge the instant the
// event's copy has left: the trigger goes on the stack, the state-based sweep
// takes the copy (a token — R69; an {Unstable} death — R137), and on
// resolution the name search lands on an INNOCENT older copy. Cthyrian Rector
// recalled it to hand having already paid a sacrifice; Murkdrop Distiller
// cached it out of the bin; Biomass Devourer ERASED it out of the game.
//
// So this scans the REGISTRY, not the text: every triggered ability listening
// on a bin-index event whose run() still contains the name search. Three cards
// were found by hand on 2026-08-24 and fixed; this is what stops the fourth
// from having to be found by hand.
const BIN_INDEX_EVENTS = new Set(['trashed', 'died']);

/**
 * The cards that use `bin.lastIndexOf` CORRECTLY, each with its reason. All
 * five ask "is MY OWN name in a bin" — a question about a card name, where the
 * copies really are interchangeable and the last one is as good as any other.
 * None of them is reaching for the particular copy somebody else's event named.
 *
 * Only an entry whose trigger listens on a BIN_INDEX_EVENT can be reached by
 * the scan below; the other four hang off zone triggers ('afterCombat',
 * 'startOfDeployment') that carry no bin index at all. They are listed anyway,
 * because the classification is the load-bearing half of this ruling and it
 * belongs in one place — and the staleness check below keeps every entry
 * honest, reachable or not.
 */
const SELF_LOCATING_IN_BIN: Record<string, string> = {
  'Spore of Regenesis':
    "'died' + self:true — the dying card is ITSELF, and it asks whether its own name reached "
    + 'a bin. Any copy of that name answers it; it is not fetching a particular one.',
  'Lurking Dread':
    "zone triggers on 'afterCombat' — \"if I am in your bin/cache, …\". It locates its own name "
    + 'to put that body into play, and one copy is as good as another (R51 fires once per zone).',
  Xzydris:
    "zone trigger on 'startOfDeployment' — the same shape: its own name in its own bin.",
  'Cinder Scuttler':
    "zone:'bin' trigger — its own name in its own bin, to bring itself back.",
  'Inexorable Miasma':
    "zone:'bin' trigger — its own name in its own bin, to bring itself back.",
};

/** every function body reachable from a card definition, concatenated, with
 * COMMENTS STRIPPED. Reading SOURCE is the point: JSON.stringify drops
 * functions, which is how the first draft of CARD-TODO #27's own proof
 * silently answered "no problem here". Comments have to go because
 * `Function.prototype.toString` keeps them, and the three cards R140 FIXED all
 * explain in a comment what they no longer do — a scan that reads those would
 * report the bug it just watched being removed. (A `//` inside a string
 * literal would swallow the rest of that line; nothing in the pool does that,
 * and the cost of the miss is one un-flagged line, not a false alarm.) */
function fnSource(v: unknown, depth = 0): string {
  if (depth > 6 || v === null || v === undefined) return '';
  if (typeof v === 'function') {
    return (v as () => void).toString().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  }
  if (Array.isArray(v)) return v.map(x => fnSource(x, depth + 1)).join('\n');
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>)
    .map(x => fnSource(x, depth + 1)).join('\n');
  return '';
}

test('R140: no card responding to a bin-index event re-finds its card by lastIndexOf', () => {
  const offenders: string[] = [];
  for (const name of allCardNames()) {
    const def = getCard(name);
    const triggers = [...(def.abilities ?? []), ...(def.augmentText ?? [])]
      .filter(a => a.type === 'triggered' && a.events.some(e => BIN_INDEX_EVENTS.has(e)));
    for (const t of triggers) {
      if (fnSource(t).includes('lastIndexOf')) { offenders.push(name); break; }
    }
  }
  const unexplained = offenders.filter(n => !(n in SELF_LOCATING_IN_BIN));
  assert.deepEqual(unexplained, [],
    `${unexplained.join(', ')} responds to a 'trashed'/'died' event and then re-finds its card `
    + 'with bin.lastIndexOf(name). That search cannot tell two copies of one card apart, so once '
    + "the event's copy has been swept out of the bin it silently acts on an INNOCENT older copy "
    + "(R140, CARD-TODO #27). Resolve the event's (binSeat, binNth) stamp with `eventBinSlot` "
    + 'from dsl.ts and treat index === -1 as GONE — never as "take the other one". If the card '
    + 'genuinely asks about its OWN NAME rather than a particular copy, add it to '
    + 'SELF_LOCATING_IN_BIN above with that reason.');

  // and the allowlist cannot outlive its cause: an entry whose card stopped
  // using the idiom (or stopped existing) is a stale exemption, which is how
  // an allowlist quietly turns back into a blanket.
  for (const [name, why] of Object.entries(SELF_LOCATING_IN_BIN)) {
    assert.ok(allCardNames().includes(name), `SELF_LOCATING_IN_BIN names ${name}, which is not a card`);
    assert.ok(fnSource(getCard(name)).includes('lastIndexOf'),
      `${name} no longer uses bin.lastIndexOf, so its exemption is stale — drop it. (Was: ${why})`);
  }
});

// ── R145: the bin-ENTRY choke point (the twin of R124's bin-EXIT sweep) ────
//
// R145 defines the ACTIVE ZONES — in play and the stack — and {Unstable}
// replaces a bin entry with an erase exactly when a card leaves one of them.
// Every bin entry therefore has to be a decision made somewhere that KNOWS
// which zone the card came from, and there are exactly three such places:
//
//   · `E.toBin(seat, name, from)`  — the general entry, and the only one that
//     classifies the R40 trash, because `from` IS the zone.
//   · `E.disposeToBin`             — R153, the LEAVE-PLAY-FOR-A-BIN disposal
//     tail. It pushes the body and its nontoken mods itself so it can remember
//     the slots R140's sweep needs, and then runs R137's bin → trash →
//     Unstable-erase in that order. `E.destroy` used to hold this code; it is
//     the primitive now, and Hooba-Mon's exchange calls the same one (CT-43).
//   · `E.leavePlay`                — the documented MODS line: a nontoken mod
//     of a unit leaving play enters its OWNER's bin, before the caller decides
//     where the body goes (R69/R137).
//
// A fourth `bin.push` anywhere else is a bypass: it cannot be Unstable-aware
// and it cannot be trash-aware. R145 was itself exactly that — negate() and
// dischargeItem() each rebuilt the Unstable predicate by hand and neither
// consulted the printed face, and resolveItem's two virus-fizzle branches
// called toBin raw. So this is the ENTRY-side twin of R124's EXIT-side splice
// sweep above, and it exists for the same reason: the next bypass should fail
// a test rather than wait to be found by a playtester.
//
// The exemption list is EMPTY, and that is the point. It briefly held two
// entries on 2026-08-25 — Hooba-Mon's exchange (batch-dark-b.ts) and Tides of
// the Cosmos (batch-water-b.ts), both of which pushed into a bin by hand —
// while R146 was fixing them in a parallel worktree. R146 landed (commit
// 8377b26) and the stale-entry assert below is what forced the waivers out
// again the moment it did. Keep it empty: a dated waiver that outlives its
// cause is how a two-line exemption quietly becomes a blanket.
//
// R153 (CT-43) emptied it AGAIN, and this time removed the reason to refill it.
// It held one dated waiver for `exchangeInPlace` (batch-dark-b.ts), a fourth
// hand-copy of destroy()'s disposal tail that could not use `E.toBin` because
// toBin takes neither R70's `anchor` nor reports the SLOT R140's sweep needs.
// The answer was not a waiver: the tail is `E.disposeToBin` now and the card
// calls it, so there is no bin push in card code left to waive. ⚠ If you are
// about to add an entry here, the odds are you are re-inlining a sequence that
// already exists one layer down. Read E.disposeToBin first.
const BIN_PUSH_EXEMPT: Record<string, string> = {};

// R153: this sweep FOLLOWS ONE LEVEL OF ALIASING and strips comments — see
// codeLines / binAliases at the top of this file, and the two ways a
// source-reading assertion lies that they close. The blind spot that used to be
// declared here (`const mb = g.player(m.owner).bin; mb.push(m.card);` walks
// past a `\bbin\.push\(` regex, and exchangeInPlace contained exactly that
// shape) is closed: a local bound to a bin under ANY name is a hit now.
// ⚠ THE NAME IS PINNED. CARD-TODO #42's `guard` field names this test by the
// substring 'every bin ENTRY goes through toBin / destroy / the leavePlay mods
// line', and 83-card-todo asserts that a real test carries it — so renaming
// the `destroy` in it is a hard failure in another file. R153 moved that half
// of the work into E.disposeToBin; the addition below says so without breaking
// the pin. Rename it properly when CT-42 is next edited, not before.
test('R145: every bin ENTRY goes through toBin / destroy / the leavePlay mods line'
  + ' (R153: the destroy half is E.disposeToBin now)', () => {
  const SRC = path.resolve(HERE, '..', 'src');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(SRC);
  // `.bin.push(` — a player-state bin pushed through its property, which is
  // every form the codebase actually uses; the bare `bin.push(` arm catches a
  // local alias NAMED `bin`; and `alias` (R153) catches one under any other
  // name, which is how the last bypass in card code hid.
  const hits: { at: string; file: string; line: number }[] = [];
  for (const file of files) {
    const lines = codeLines(fs.readFileSync(file, 'utf8'));
    const alias = aliasCall(binAliases(lines), 'push');
    lines.forEach((line, i) => {
      if (/\.bin\.push\(|\bbin\.push\(/.test(line)
        || (alias !== null && alias.test(line))) {
        hits.push({ at: `${path.basename(file)}:${i + 1}`, file, line: i + 1 });
      }
    });
  }
  const engineLines = fs.readFileSync(path.join(SRC, 'engine.ts'), 'utf8').split('\n');
  /** the nearest `methodName(` header above `line` in engine.ts — the sweep
   * asks WHICH METHOD a push sits in, not merely that it is in engine.ts. */
  const enclosing = (line: number): string => {
    for (let i = line - 1; i >= 0; i--) {
      const m = /^ {2}(?:private |public |protected )?([A-Za-z_$][\w$]*)\(/.exec(engineLines[i]!);
      if (m) return m[1]!;
    }
    return '(top level)';
  };
  // R153: `destroy` is no longer one of them — its tail moved WHOLESALE into
  // `disposeToBin`, which is now the only method that pushes a leaving-play
  // body (and its mods) into a bin, for a death and for an exchange alike.
  const LEGAL = new Set(['toBin', 'disposeToBin', 'leavePlay']);
  const bypasses: string[] = [];
  for (const h of hits) {
    if (h.at in BIN_PUSH_EXEMPT) continue;
    if (path.basename(h.file) !== 'engine.ts') { bypasses.push(`${h.at} (not in engine.ts)`); continue; }
    const fn = enclosing(h.line);
    if (!LEGAL.has(fn)) bypasses.push(`${h.at} (inside ${fn})`);
  }
  assert.deepEqual(bypasses, [],
    `a card reaches a bin at [${bypasses.join(', ')}] without going through E.toBin, E.disposeToBin `
    + 'or the leavePlay mods line. Those three are the only places that know which ZONE the card '
    + 'came from, and R145 makes that the question {Unstable} turns on (in play and the stack are '
    + 'ACTIVE zones — leaving one for a bin erases instead), while R40 makes it the question '
    + 'trashing turns on. Route the push through E.toBin(seat, name, from).');

  // the exemption cannot outlive its cause — a stale entry is how a two-line
  // dated waiver quietly becomes a blanket
  const seen = new Set(hits.map(h => h.at));
  for (const [at, why] of Object.entries(BIN_PUSH_EXEMPT)) {
    assert.ok(seen.has(at),
      `BIN_PUSH_EXEMPT still waives ${at}, but there is no bin.push there any more — delete the `
      + `entry, the exemption has done its job. (Was: ${why})`);
  }

  // and all three legal sites must still exist, or the sweep has quietly
  // stopped measuring anything at all
  const legalHits = hits.filter(h => path.basename(h.file) === 'engine.ts').map(h => enclosing(h.line));
  for (const fn of LEGAL) {
    assert.ok(legalHits.includes(fn), `no bin.push left inside E.${fn} — the sweep's premise moved`);
  }
});

// ════════════════════════════════════════════════════════════════════════
// R148 / CT-38 — the CONTROL-CHANGE choke point stays the only way to
// change a controller. (Appended as one self-contained block; nothing above
// this line is touched.)
// ════════════════════════════════════════════════════════════════════════
//
// Exactly R124's shape, one zone over. `E.giveControl` is the single primitive
// for "this seat now controls that unit": it carries the unit's MODS across,
// unslots it from a formation its new controller does not own, applies R112
// region exclusivity, and (R148) fires the `controlChanged` event. A card that
// assigns `u.controller` by hand gets none of that, and the failure is SILENT
// — the unit does change sides, so every test that only checks `.controller`
// still passes. Three cards did exactly that (Mindspore Fiend, Organic
// Exchange, Download) and nothing caught them for a day; it took a hand sweep.
// So the sweep is a test now.
//
// ⚠ THE TWO TRAPS this repo has hit with code-reading assertions, both real,
// both inside one day, both avoided here by reading FILE SOURCE through
// `stripCode`:
//   · JSON.stringify on a card definition drops functions — a check written
//     that way reads nothing and answers "clean".
//   · Function.prototype.toString keeps comments and strings — a comment that
//     merely mentions the idiom (usually the one explaining that the card no
//     longer uses it) holds the check true.
// `stripCode` is card-todo.ts's own helper, deliberately shared rather than
// re-rolled: one copy of those regexes, one place to be wrong.

/**
 * `.controller =` sites in src/cards/ that are NOT a unit changing hands, each
 * with the reason it is not. Keyed by file, matched as an exact statement in
 * the STRIPPED source, so an entry cannot quietly cover a line it was not
 * written for. Two shapes qualify and no third has come up:
 *
 *  · a MOD being re-parented onto a new host, taking that host's controller.
 *    The mod is not changing hands, it is changing HOSTS; giveControl is about
 *    units and would unslot and relocate the wrong thing entirely.
 *  · a STACK ITEM's controller — "gain control of target effect" is a
 *    different object (StackItem, not Entity) with no mods, no formation slot
 *    and no region.
 *
 * If you are adding a third: it is far likelier that you want giveControl.
 */
const CONTROLLER_ASSIGN_OK: { file: string; stmt: string; why: string }[] = [
  {
    file: 'batch-hybrids-wm-a.ts', stmt: 'm.controller = b.controller;',
    why: 'Reconfigure moves the mods off one unit onto another — a mod re-parenting to a new host, not a unit changing hands',
  },
  {
    file: 'batch-dark-b.ts', stmt: 'mod.controller = host.controller;',
    why: "Rotbeast moves its own mods onto enemy units — same re-parenting shape as Reconfigure's",
  },
  {
    file: 'batch-wood-a.ts', stmt: 'item.controller = ctx.controller;',
    why: 'Hexbane Shiitake takes control of an ITEM ON THE STACK (a StackItem, not an Entity); its own body goes through g.giveControl on the next line',
  },
];

/** every .ts file under src/cards/, source stripped of comments and strings */
function cardSources(): { file: string; src: string }[] {
  const root = path.resolve(HERE, '..', 'src', 'cards');
  const out: { file: string; src: string }[] = [];
  const walk = (dir: string): void => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.ts')) out.push({ file: f.name, src: stripCode(fs.readFileSync(p, 'utf8')) });
    }
  };
  walk(root);
  return out;
}

/** assignments to a `.controller` property, one `file:line stmt` per hit.
 * `=` only — `===` and `!==` are questions, not assignments. */
function controllerAssignments(file: string, src: string): string[] {
  const hits: string[] = [];
  src.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/[A-Za-z_$][\w$]*\.controller\s*=(?!=)/g)) {
      hits.push(`${file}:${i + 1} ${line.slice(m.index).trim()}`);
    }
  });
  return hits;
}

test('R148 stays solved: no card in src/cards/ assigns a unit\'s .controller — E.giveControl is the only way', () => {
  const unexplained: string[] = [];
  for (const { file, src } of cardSources()) {
    for (const hit of controllerAssignments(file, src)) {
      const stmt = hit.slice(hit.indexOf(' ') + 1);
      if (CONTROLLER_ASSIGN_OK.some(e => e.file === file && stmt.startsWith(e.stmt))) continue;
      unexplained.push(hit);
    }
  }
  assert.deepEqual(unexplained, [],
    `raw controller assignments in src/cards/ at [${unexplained.join(' | ')}]. A control change is `
    + '`E.giveControl(unit, seat)` — it carries the unit\'s MODS across (a stolen unit whose '
    + 'augments still answer to the old seat is CT-38, and it was invisible for a day because the '
    + 'unit does change sides), unslots it from a formation its new controller does not own, '
    + 'applies R112 region exclusivity and fires `controlChanged` (R148/CT-39). An exchange that '
    + 're-slots both units itself passes `{ keepFormation: true }`. If the thing you are assigning '
    + 'is genuinely NOT a unit changing hands — a mod moving to a new host, a StackItem — add it '
    + 'to CONTROLLER_ASSIGN_OK with that reason.');

  // and the allowlist cannot outlive its cause (the SELF_LOCATING_IN_BIN rule
  // above, for the same reason): an entry whose line has moved on is a stale
  // exemption, which is how an allowlist quietly turns back into a blanket.
  const sources = new Map(cardSources().map(s => [s.file, s.src]));
  for (const e of CONTROLLER_ASSIGN_OK) {
    const src = sources.get(e.file);
    assert.ok(src !== undefined, `CONTROLLER_ASSIGN_OK names ${e.file}, which is not a file in src/cards/`);
    assert.ok(src.includes(e.stmt),
      `${e.file} no longer contains \`${e.stmt}\`, so its exemption is stale — drop it. (Was: ${e.why})`);
  }
});

test('R148: the only .controller assignments in engine.ts are inside giveControl', () => {
  const SRC = path.resolve(HERE, '..', 'src');
  const stripped = stripCode(fs.readFileSync(path.join(SRC, 'engine.ts'), 'utf8'));
  const lines = stripped.split('\n');
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (/[A-Za-z_$][\w$]*\.controller\s*=(?!=)/.test(line)) hits.push(i);
  });
  assert.ok(hits.length > 0, 'the primitive itself must still assign a controller somewhere');

  /**
   * Named exemptions, each carrying its reason — and each asserted below to
   * still be PRESENT, so an exemption cannot outlive its cause (the same rule
   * the exemption list above this test runs on).
   *
   * R148/R112's choke point is about an ENTITY IN PLAY changing hands, which is
   * a real game event with triggers hanging off it. A `StackItem`'s controller
   * is a different field on a different type: it records who is casting this
   * item, it is written once while the item is being BUILT, and nothing
   * observes a change to it because there is no change — the item did not
   * exist a statement earlier.
   */
  const STACKITEM_CONTROLLER_EXEMPT: Record<string, string> = {
    'copy.controller = opts.controller ?? orig.controller;':
      'R164 pushSpellCopy — stamping the controller onto a freshly structuredClone\'d '
      + 'StackItem, not moving an entity between players. A spell copy is cast by whoever the '
      + 'copying card says casts it (Earthbound Replicator: "for any player targeting him"), so '
      + 'the field has to be settable at construction. Routing this through giveControl would be '
      + 'a category error — giveControl takes an Entity.',
  };

  for (const n of hits) {
    const stmt = lines[n]!.trim();
    if (stmt in STACKITEM_CONTROLLER_EXEMPT) continue;
    // `giveControl(` opens within a few lines above every legal assignment —
    // the same proximity read R124 uses for its one bin splice.
    assert.ok(lines.slice(Math.max(0, n - 8), n + 1).join('\n').includes('giveControl('),
      `engine.ts:${n + 1} assigns a controller outside giveControl: ${stmt}. `
      + 'The choke point is the whole point (R112/R148) — route it through giveControl, or, if '
      + 'this really is a new primitive, say so here and widen this test on purpose.');
  }

  // An exemption that no longer names real code is a hole nobody is watching.
  const present = new Set(hits.map(n => lines[n]!.trim()));
  for (const [stmt, why] of Object.entries(STACKITEM_CONTROLLER_EXEMPT)) {
    assert.ok(present.has(stmt),
      `engine.ts no longer contains \`${stmt}\`, so its exemption is stale — drop it. `
      + `(Was: ${why})`);
  }
});
