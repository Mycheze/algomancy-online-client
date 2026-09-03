/* R243 — REGIONS SCOPE "ALL", AND THEY DO NOT SCOPE INFORMATION.
 *
 * Two owner rulings given together, 2026-08-29, answering CARD-TODO #107 and
 * #108 in one sentence:
 *
 *   "Regions do NOT scope information, but they do scope 'global' things
 *    (every card that says 'all' is actually 'all in this region')."
 *
 * They pull in opposite directions and that is the point of holding them in
 * one file: **what an effect may COUNT is narrowed; what a player may READ is
 * not.** A future change that scopes one by scoping the other reddens here.
 *
 * ── §1  "ALL" IS "ALL HERE" (CT-108) ──────────────────────────────────
 *
 * CT-108 named three cards — Bloppert, The Mighty Doot, Finality. The derived
 * class is TEN sites across nine cards, and "The Mighty Doot" was not even
 * among the ones the scan found by name (its global read lives in a shared
 * `dootBonus` helper above the card, which is exactly the kind of thing a
 * typed list misses). docs/13 §7.2: derive the class from the pool, never from
 * the cards in the report.
 *
 * So the rule is enforced structurally rather than card by card: **no file
 * under `src/cards/` may read `g.s.players` at all.** A card reading the whole
 * table is asserting that a player who is not here counts, which is now wrong
 * for every "all", every sweep and every superlative. `E.seatsHere(region)` is
 * the one way to ask.
 *
 * ⚠ NOT AN ALLOWLIST, and deliberately so — CARD-TODO #83 is an open ticket
 * about exactly the failure of prose-reasoned exemption lists. There is no
 * exempt set here: a card that genuinely needs the whole table needs a RULING,
 * and making this test go red is how that conversation starts.
 *
 * ── §2  INFORMATION IS NOT SCOPED (CT-107) ────────────────────────────
 *
 * CT-107 was filed as a possible leak: R239 scoped what an effect may reach,
 * `E.ev` stamps no region, and `server/view.ts::visibleToSeat` gates only on
 * `data.privateTo` — so a player outside a region reads every line of what
 * happened there. **The owner has ruled that this is correct**, so the entry
 * closes with no code change and this section is what stops somebody
 * "fixing" it later: the redactor must keep gating on `privateTo` and on
 * nothing else.
 *
 * The ticket's own worry is worth keeping on the record, because the ruling
 * dissolves it rather than overruling it: a hidden LOG over a visible BOARD
 * would have been incoherent (`viewFor` ships every region's board state to
 * both seats), so "hide the log" was never available without also hiding the
 * board. Answering "no" to both is the coherent pair.
 *
 * Seeds 21900-21999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { visibleToSeat } from '../view.ts';
import type { EngineEvent, Seat } from '../../engine/src/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARDS = join(HERE, '..', '..', 'engine', 'src', 'cards');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** source lines that are real code, not prose */
function codeLines(src: string): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = [];
  let inBlock = false;
  src.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (inBlock) { if (line.includes('*/')) inBlock = false; return; }
    if (line.startsWith('/*')) { if (!line.includes('*/')) inBlock = true; return; }
    if (line.startsWith('//') || line.startsWith('*')) return;
    out.push({ n: i + 1, text: raw });
  });
  return out;
}

/* ══ §1 "all" is "all in this region" ════════════════════════════════════ */

test('§1a no card reads the whole table — it asks the region', () => {
  const offenders: string[] = [];
  for (const file of walk(CARDS)) {
    for (const { n, text } of codeLines(readFileSync(file, 'utf8'))) {
      if (/\bg\.s\.players\b|\bstate\.players\b/.test(text)) {
        offenders.push(`${relative(CARDS, file)}:${n}  ${text.trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    'R243: "every card that says \'all\' is actually \'all in this region\'". A card reading '
    + 'g.s.players asserts that a player who is not here counts. Use E.seatsHere(region).\n  '
    + offenders.join('\n  '));
});

test('§1b the derivation really had teeth — the scan finds the sites, not a list', () => {
  // positive control: the guard above can fail. Without this, "no offenders"
  // could just as well mean the scan reads nothing at all — which is the
  // failure mode docs/13 names (a scrape that reads less than it should).
  const planted = codeLines('const x = 1;\nfor (const p of g.s.players) {}\n// g.s.players in prose\n');
  assert.equal(planted.filter(l => /\bg\.s\.players\b/.test(l.text)).length, 1,
    'one real line, and the commented one is not counted');
});

test('§1c seatsHere is the region\'s seats, in a stable order', () => {
  const h = new Harness(21900);
  const e = new E(h.state);
  const region = h.state.regions.findIndex(r => r.presentSeats.length > 0);
  assert.ok(region >= 0, 'some region holds somebody');
  const seats = e.seatsHere(region);
  for (const s of seats) {
    assert.ok(h.state.regions[region]!.presentSeats.includes(s), 'only seats really present');
  }
  assert.deepEqual(seats, e.seatsHere(region), 'and the same answer every time it is asked');
  // a region nobody is in names nobody, rather than throwing
  const empty = h.state.regions.findIndex(r => r.presentSeats.length === 0);
  if (empty >= 0) assert.deepEqual(e.seatsHere(empty), []);
});

test('§1d a seat that is not in the region is not counted', () => {
  const h = new Harness(21901);
  const e = new E(h.state);
  const region = h.state.regions.findIndex(r => r.presentSeats.length > 0);
  const before = e.seatsHere(region);
  assert.ok(before.length >= 1);
  // take one out and it stops existing for anything that counts
  const gone = before[before.length - 1]!;
  h.state.regions[region]!.presentSeats =
    h.state.regions[region]!.presentSeats.filter(s => s !== gone);
  assert.equal(e.seatsHere(region).includes(gone), false,
    'this is the whole of CT-108: a player who is not here cannot define the outcome here');
});

test('§1e ONE helper for the pool — the local copies are gone', () => {
  // two batch files had grown their own `presentSeats`, with DIFFERENT orders.
  // That is the same "one concept, several spellings" shape R242 removed from
  // the tempo, and it is how two cards come to disagree about who is present.
  const bodies: string[] = [];
  for (const file of walk(CARDS)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/const presentSeats = \([^)]*\)[^=]*=>\s*([\s\S]{0,200}?);\n/g)) {
      bodies.push(`${relative(CARDS, file)}: ${m[1]!.replace(/\s+/g, ' ').trim()}`);
    }
  }
  for (const b of bodies) {
    assert.match(b, /g\.seatsHere\(region\)/,
      `a local presentSeats must delegate to the one helper, got — ${b}`);
  }
});

/* ══ §2 information is NOT scoped ════════════════════════════════════════ */

test('§2a the log redactor gates on privateTo, and on nothing else', () => {
  const src = readFileSync(join(HERE, '..', 'view.ts'), 'utf8');
  const from = src.indexOf('export function visibleToSeat');
  const body = src.slice(from, src.indexOf('\n}', from));
  assert.match(body, /privateTo/, 'positive control: it does gate on that');
  assert.equal(/region/i.test(body), false,
    'R243: "Regions do NOT scope information." CT-107 was filed as a possible leak and the '
    + 'owner ruled the current behaviour correct — a region test appearing here would be '
    + 'somebody fixing what was ruled not to be broken.');
});

test('§2b an event from a region you are not in is still yours to read', () => {
  const ev: EngineEvent = { type: 'info', msg: 'something happened over there', data: { region: 3 } };
  for (const seat of [0, 1] as Seat[]) {
    assert.equal(visibleToSeat(ev, seat), true,
      'no region field gates a line — a player reads the whole table\'s story');
  }
});

test('§2c privateTo still hides what it always hid', () => {
  // the ruling narrowed nothing about genuine privacy, and a green §2a/§2b
  // would be worthless if this had quietly stopped working
  const secret: EngineEvent = { type: 'info', msg: 'only for seat 1', data: { privateTo: 1 } };
  assert.equal(visibleToSeat(secret, 1), true);
  assert.equal(visibleToSeat(secret, 0), false);
});
