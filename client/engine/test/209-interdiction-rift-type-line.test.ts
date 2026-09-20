/**
 * R240 — Interdiction Rift's type line, and the exemption that is gone rather
 * than rewritten.
 *
 * The oracle file transcribed the card as `{Battle}AI Cosmic Spell`. R162 saw
 * only half of that: it read the missing space, proposed a whitespace-only
 * repair to `{Battle} AI Cosmic Spell`, and recorded it in the override table
 * the extractor used to carry, marked "⚠ STILL UNRULED" — because it was a
 * guess. The owner ruled on it 2026-08-28, verbatim:
 *
 *   "Correct, that's a typo in the oracle text. {Battle} Cosmic Spell is
 *    correct. AI shouldn't be there."
 *
 * So the `AI` was never a subtype that had lost its space; it was not a subtype
 * at all. The card art agrees — Interdiction Rift's printed type line reads
 * "Cosmic Spell", with the {Battle} carried by the crossed-swords icon in the
 * title bar, which is how every {Battle} spell in the pool is transcribed.
 *
 * ⚠ WHAT THIS FILE IS ACTUALLY GUARDING. The correction landed AT SOURCE — the
 * oracle file now reads "{Battle} Cosmic Spell" — so the override was DELETED,
 * not corrected, per that table's own rule ("If Caleb has corrected the source,
 * DELETE the entry — do not update `from` to make this pass"). That leaves the
 * corrected value with nothing declaring it anywhere, which is exactly the
 * state in which a regression is silent: an upstream re-export that
 * reintroduced the `AI`, or a re-added override, would flow straight through
 * `npm run extract` into printed.json and every guard derived from it. §1–§3
 * pin the line from all three sides — the registered card, the upstream file,
 * and the override table's silence — so any of those three moving fails here.
 *
 * §3 is the generalised half, and it is the reason this is worth a file. The
 * defect had two independent signatures, and BOTH are swept over the whole
 * pool rather than asserted about this one card: a marker brace glued to a
 * letter, and a subtype word appearing on exactly one card. The second is what
 * would have caught the `AI` without anyone noticing the spacing at all.
 *
 * Seeds: none — this file is pure data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import type { CardName } from '../src/types.ts';
// side-effecting: apply.ts is what brings the THIRD synthetic (registry.ts
// registers two, apply.ts the last), so allCardNames() is the full 495 here
// rather than the 494 a registry-only import sees. R209 — an agent got this
// wrong the same day, so the number is asserted below rather than assumed.
import '../src/apply.ts';
import { ORACLE_JSON } from '../scripts/paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const ORACLE = JSON.parse(readFileSync(ORACLE_JSON, 'utf8')) as Record<string, Array<{ type?: string; text?: string }>>;

/** printed.json read as DATA rather than through the registry, so §4's sweeps
 * cover the generated file itself — the artifact every derived guard scrapes. */
const PRINTED = JSON.parse(readFileSync(
  join(HERE, '..', 'src', 'cards', 'printed.json'), 'utf8'),
) as Record<string, { type: string; kind: string; timing: string }>;

/** the extractor's `normalisePrinted`, which runs before anything else reads a
 * printed string (scripts/extract-printed.mjs, R142) */
const normalisePrinted = (s: string): string =>
  s.replace(/([A-Za-z])-[ \t]+([a-z])/g, '$1$2').replace(/[ \t]+/g, ' ').trim();

const RIFT = 'Interdiction Rift' as CardName;
const RULED = '{Battle} Cosmic Spell';

/* ── §1 · the card the client actually resolves ────────────────────────── */

test('§1 Interdiction Rift is "{Battle} Cosmic Spell" — the owner\'s ruling, exactly', () => {
  assert.equal(getCard(RIFT).type, RULED);
  // and each half of the defect named separately, so a failure says WHICH
  assert.doesNotMatch(getCard(RIFT).type, /\bAI\b/,
    'the owner: "AI shouldn\'t be there." It is not a subtype of this card.');
  assert.doesNotMatch(getCard(RIFT).type, /\}[A-Za-z]/,
    'and the brace is not glued to the next word — the half R162 did see');
});

test('§1 the parsed consequences of the line are unchanged by the correction', () => {
  // the type line is not inert: the extractor reads {Battle} for `timing` and
  // the word "Spell" for `kind`. Dropping a subtype must move neither, and
  // this is the assertion that says so rather than leaving it to inspection.
  const c = getCard(RIFT);
  assert.equal(c.timing, 'battle', '{Battle} is still matched brace-to-brace');
  assert.equal(c.kind, 'spell', '"Spell" is still the head word');
  assert.deepEqual(c.attrs, [], 'AI was never an attribute either — it is not in ATTRS');
  assert.equal(c.text, 'Target opponent negates an effect they control.',
    'the text box was never in question and must not have moved');
});

/* ── §2 · the upstream file, where the correction actually landed ──────── */

test('§2 the oracle file itself carries the corrected line — no override needed', () => {
  const entry = ORACLE['Interdiction Rift']?.[0];
  assert.ok(entry, 'Interdiction Rift is not in AlgomancyCards-OracleText.json at all');
  assert.equal(normalisePrinted(String(entry.type ?? '')), RULED,
    'The correction was made AT SOURCE, which is what makes the override deletable. '
    + 'If this fails the oracle file has regressed (or been re-exported over) and the '
    + 'fix is an edit to the oracle file — NOT a hand-edit of the generated printed.json.');
});

test('§2 printed.json agrees with upstream, i.e. the extractor changed nothing here', () => {
  // the generated file and its source must now say the same thing. This is the
  // assertion that would fail if someone hand-edited printed.json instead of
  // fixing the source, or re-added an override that rewrote a correct value.
  assert.equal(PRINTED['Interdiction Rift']!.type,
    normalisePrinted(String(ORACLE['Interdiction Rift']![0]!.type)));
});

/* ── §3 · the two signatures, swept over the whole pool ────────────────── */

/** R209/CT-81(a): the pool is 495 — 492 printed + 3 synthetics — and ONLY when
 * apply.ts is in the import graph. Pinned so a sweep below cannot quietly run
 * against a smaller pool than it believes it has. */
test('§3 the sweeps below run against the whole registered pool, all 496', () => {
  assert.equal(allCardNames().length, 496,
    'this file imports src/apply.ts, which registers the third synthetic. 494 means that '
    + 'import was dropped and the sweeps below are one card short; anything else means '
    + 'the pool moved and the counts want re-deriving.');
  assert.equal(Object.keys(PRINTED).length, 492, 'printed.json is the 492 transcribed cards');
  assert.equal(allCardNames().filter(n => !(n in PRINTED)).length, 4,
    'and exactly four registered cards are synthetic, with no upstream printed data');
});

test('§3 signature one: no type line in the pool glues a marker to the next word', () => {
  // the defect R162 DID see, generalised. This sweeps `getCard`, the value the
  // client resolves; the next test sweeps the oracle file itself.
  const glued = allCardNames()
    .map(n => ({ n, t: getCard(n).type ?? '' }))
    .filter(({ t }) => /\}[A-Za-z]|[A-Za-z]\{/.test(t))
    .map(({ n, t }) => `${n}: ${t}`);
  assert.deepEqual(glued, [],
    'a {Marker} must be separated from the word after it. Two cards printed this defect '
    + '(Might of the Grove, Interdiction Rift); both are corrected at source.');
});

test('§3 signature one, upstream: the oracle file is clean too', () => {
  // the same sweep over the oracle file. A NEW one appearing there shows up
  // here rather than being discovered by a player.
  const glued: string[] = [];
  for (const [name, rows] of Object.entries(ORACLE)) {
    const t = normalisePrinted(String(rows[0]?.type ?? ''));
    if (/\}[A-Za-z]|[A-Za-z]\{/.test(t)) glued.push(`${name}: ${t}`);
  }
  assert.deepEqual(glued, [],
    'Interdiction Rift and Might of the Grove used to be listed here and were both '
    + 'corrected at source. A new glued type line needs a ruling, then the same fix.');
});

test('§3 signature two: no subtype word appears on exactly one card unexplained', () => {
  // THE SWEEP THAT WOULD HAVE CAUGHT "AI" ON ITS OWN, without anyone looking at
  // the spacing: a spurious token is, by construction, a subtype with a
  // population of one. Twenty real subtypes legitimately have that population
  // (Kraken, Alpaca, Banana …) so the list cannot be "must be empty" — it is
  // pinned instead, which makes a NEW singleton a deliberate decision rather
  // than a silent arrival. DERIVED from the type lines, never typed.
  const HEADS = new Set(['Unit', 'Spell', 'Token', 'Resource']);
  const population = new Map<string, string[]>();
  for (const [name, c] of Object.entries(PRINTED)) {
    const words = (c.type.match(/\[[^\]]*\]|\{[^}]*\}|[A-Za-z'-]+/g) ?? [])
      .filter(w => !/^[[{]/.test(w) && !HEADS.has(w));
    for (const w of new Set(words)) population.set(w, [...(population.get(w) ?? []), name]);
  }
  const singletons = [...population].filter(([, v]) => v.length === 1).map(([w]) => w).sort();
  assert.ok(!singletons.includes('AI'),
    '"AI" is back as a one-card subtype — the owner ruled it is not a subtype at all');
  assert.deepEqual(singletons, [
    'Alpaca', 'Angel', 'Apple', 'Banana', 'Cat', 'Caterpillar', 'Clam', 'Earth', 'Fire',
    'Friend', 'Horse', 'Ice', 'Kraken', 'Monkey', 'Nebula', 'Porcupine', 'Slag', 'Squid',
    'Water', 'Whale',
  ], 'these are the pool\'s twenty real one-card subtypes. A NEW name in this list is '
    + 'either a genuinely unique creature type or a transcription artifact like "AI" — '
    + 'check the card art before adding it here.');
});
