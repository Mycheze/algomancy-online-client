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

const HERE = path.dirname(fileURLToPath(import.meta.url));

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
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      // `.bin.splice(` — any player-state bin spliced through its property;
      // `bin.splice(` — a local alias of one; `[from].splice(` — a computed
      // zone access that can reach a bin (the shape bypass A hid behind).
      if (/\.bin\.splice\(|\bbin\.splice\(|\[from\]\.splice\(/.test(line))
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
