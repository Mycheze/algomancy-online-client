/* THE CARD-DATA AUDIT.
 *
 * `AlgomancyCards-OracleText.json` is a transcription of physical cards, shared
 * with the rules bot, the RAG corpus and the Discord pipeline. Two files in
 * this package are derived from it, and until now nothing checked either the
 * transcription or the derivation. The card browser makes that expensive: a
 * facet is only as good as the field behind it, and a filter that silently
 * drops a card because its type line lost a space is worse than no filter.
 *
 * So this runs the checks, and `test/210-card-audit.test.ts` runs the same
 * function so they cannot rot. Anything it finds that we have looked at and
 * accepted is named in `scripts/card-audit-known.mjs`; anything else fails.
 *
 *   node scripts/audit-cards.mjs          report, exit non-zero on a new finding
 *   node scripts/audit-cards.mjs --all    also list the accepted findings
 *
 * WHAT IS DELIBERATELY NOT CHECKED, and why, because each of these looked like
 * an obvious check and was wrong:
 *
 *  - "total_cost is at least the pip count". FALSE in Algomancy. Affinity pips
 *    are a REQUIREMENT, not a payment: a card can cost [1] and demand two earth
 *    affinity (Aetherflux Golem, and 50 others). See ui/deckstats.ts's header.
 *  - "a card has rules text". 24 real cards are vanilla. That is a filter
 *    (`is:vanilla`), not a defect.
 *  - "the source has no double spaces". 52 records do, and `normalisePrinted`
 *    exists precisely to fix them on the way out. The check therefore runs on
 *    the EMITTED strings, where the answer should be zero -- checking the
 *    source would report 52 things that are already handled.
 *  - unknown [tokens] in rules text. That vocabulary is open by design: the
 *    pool prints [Sacrifice a unit], [power {i1}or defense], [Pay X life]. Only
 *    the {formatting} vocabulary is closed, so only that is checked.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POOL } from './pool.mjs';
import { PRINTED_OVERRIDES, StaleOverrideError } from './printed-overrides.mjs';
import { partition } from './card-audit-known.mjs';
import { ART_DIR, CATALOGUE, OUT, buildAll, oracle } from './extract-printed.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Element for each affinity pip, plus `p` for the prismite/shard faces, which
 * are colourless and print a pip that is not an element. */
const ELEMENT_OF_PIP = { r: 'fire', b: 'water', e: 'earth', g: 'wood', m: 'metal', l: 'light', d: 'dark' };
const KNOWN_PIPS = new Set([...Object.keys(ELEMENT_OF_PIP), 'p']);

/** The type line's markup vocabulary is CLOSED: an attribute or timing marker
 * in braces, `[Augment]`, or a single cost pip. Anything else is an artifact.
 * (Attribute names themselves are checked against the extractor's ATTRS via
 * the emitted `attrs`, so this only has to recognise the shapes.) */
const TYPE_TOKEN_RE = /^(?:\{[A-Z][A-Za-z]*\}|\[Augment\]|\[[a-z]\])$/;

/** The rules text's {formatting} vocabulary, which IS closed: italics on and
 * off, a printed line break, the one-keyword colouring `{g}`, `{p}` for a
 * prismite pip, and `{i1}` for a one-word italic inside a bracketed choice. */
const TEXT_BRACE_OK = new Set(['{i}', '{/i}', '{/n}', '{g}', '{p}', '{i1}']);

const MARKUP_RE = /\{[^}]*\}|\[[^\]]*\]/g;

/** A word that reads like a printed subtype. Deliberately strict: a subtype is
 * always Capitalised and alphabetic on these cards, so anything else is the
 * transcription leaking. */
const SUBTYPE_RE = /^[A-Z][A-Za-z'-]*$/;

/** Layout artifacts the emitted strings must not still carry. */
const HYGIENE = [
  [/ {2,}/, 'a run of spaces'],
  [/^\s|\s$/, 'a leading or trailing space'],
  [/[A-Za-z]-[ \t]+[a-z]/, 'a hyphen-space line-wrap artifact'],
];

/**
 * Run every check. Returns a flat list of findings, each `{ check, card,
 * detail }`, plus the counts the report prints. Pure: reads the files, writes
 * nothing.
 */
export function auditCards() {
  const findings = [];
  const add = (check, card, detail) => findings.push({ check, card, detail });

  /* -- 1. freshness ---------------------------------------------------
   * The single most valuable check here, and the one nothing did before: are
   * the committed derived files what the current oracle file produces? An
   * edit to the transcription with no re-extract leaves the client showing
   * yesterday's cards, and until now nothing said so. */
  let built;
  try {
    built = buildAll();
  } catch (err) {
    if (!(err instanceof StaleOverrideError)) throw err;
    add('override-stale', '*', err.message);
    return { findings, cards: 0 };
  }
  const { printed, catalogue, missing } = built;

  for (const name of missing) add('pool-missing', name, 'in scripts/pool.mjs but not in the oracle file');

  for (const [file, want] of [[OUT, printed], [CATALOGUE, catalogue]]) {
    const rel = file.slice(file.indexOf('src/'));
    if (!existsSync(file)) { add('stale-derived-file', '*', `${rel} does not exist -- run npm run extract`); continue; }
    const have = JSON.parse(readFileSync(file, 'utf8'));
    const names = new Set([...Object.keys(have), ...Object.keys(want)]);
    for (const n of names) {
      if (JSON.stringify(have[n]) !== JSON.stringify(want[n])) {
        add('stale-derived-file', n, `${rel} disagrees with a fresh extract -- run npm run extract`);
      }
    }
  }

  /* -- 2. the pool and the overrides ---------------------------------- */
  const inPool = new Set(POOL);
  if (inPool.size !== POOL.length) add('pool-duplicate', '*', 'scripts/pool.mjs lists a name twice');
  for (const name of Object.keys(printed)) {
    if (!inPool.has(name)) add('pool-missing', name, 'in printed.json but not in scripts/pool.mjs');
  }
  for (const o of PRINTED_OVERRIDES) {
    if (!oracle[o.card]) add('override-orphan', o.card, 'PRINTED_OVERRIDES names a card the oracle file does not have');
  }

  /* -- 3. per-card checks over the whole catalogue --------------------- */
  const subtypeUse = new Map();

  for (const [name, c] of Object.entries(catalogue)) {
    const src = oracle[name][0];

    // the type line's markup vocabulary
    for (const m of c.type.match(MARKUP_RE) ?? []) {
      if (!TYPE_TOKEN_RE.test(m)) add('type-markup', name, `unknown type-line token ${JSON.stringify(m)} in ${JSON.stringify(c.type)}`);
    }
    if (!c.supertype) add('type-supertype', name, `no printed supertype in ${JSON.stringify(c.type)}`);
    for (const s of c.subtypes) {
      if (!SUBTYPE_RE.test(s)) add('type-subtype', name, `${JSON.stringify(s)} does not read as a subtype, in ${JSON.stringify(c.type)}`);
      if (!subtypeUse.has(s)) subtypeUse.set(s, []);
      subtypeUse.get(s).push(name);
    }

    // the rules text's closed {formatting} vocabulary, and balanced brackets
    for (const m of c.text.match(/\{[^}]*\}/g) ?? []) {
      if (!TEXT_BRACE_OK.has(m)) add('text-markup', name, `unknown text token ${JSON.stringify(m)}`);
    }
    const opens = (c.text.match(/\[/g) ?? []).length;
    const closes = (c.text.match(/\]/g) ?? []).length;
    if (opens !== closes) add('text-brackets', name, `${opens} "[" against ${closes} "]"`);

    // hygiene, on the EMITTED strings -- see the header for why not the source
    for (const [re, what] of HYGIENE) {
      for (const [field, v] of [['type', c.type], ['text', c.text]]) {
        if (re.test(v)) add('hygiene', name, `emitted ${field} still has ${what}: ${JSON.stringify(v)}`);
      }
    }

    // elements: the oracle's own field, and its agreement with the cost pips
    if (!Array.isArray(src.factions)) {
      add('factions-not-a-list', name, `factions is ${JSON.stringify(src.factions)}, not a list`);
    }
    const bad = [...c.cost].filter(p => !KNOWN_PIPS.has(p));
    if (bad.length) add('pip-unknown', name, `cost ${JSON.stringify(c.cost)} uses ${bad.join(', ')}`);
    const fromPips = [...new Set([...c.cost].map(p => ELEMENT_OF_PIP[p]).filter(Boolean))].sort();
    const declared = [...c.factions].sort();
    if (fromPips.join() !== declared.join()) {
      add('faction-pip-disagreement', name, `factions [${declared}] against cost ${JSON.stringify(c.cost)} which implies [${fromPips}]`);
    }

    // stats, as the source prints them
    for (const f of ['power', 'toughness']) {
      if (!/^(-?\d+|X|\*)?$/.test(String(src[f] ?? ''))) add('stats', name, `${f} is ${JSON.stringify(src[f])}`);
    }

    // art. Every name the ENGINE knows must have a scan, because the client
    // will draw it; a catalogue-only name may legitimately have none.
    if (!c.hasArt) {
      add('art-missing', name, `no ${c.image} in data/cards/${c.scripted ? ' (and the engine scripts this card)' : ''}`);
    }

    // the one misspelling class we can check for mechanically: a printed word
    // that no other card in the pool spells that way. Kept narrow on purpose.
    if (/\bSacrifce\b/.test(c.text)) add('text-misspelling', name, 'text reads "Sacrifce"');
  }

  /* -- 4. subtypes only one card prints -------------------------------- */
  for (const [s, users] of [...subtypeUse].sort()) {
    if (users.length === 1) add('subtype-singleton', s, `printed only by ${users[0]}`);
  }

  return { findings, cards: Object.keys(catalogue).length };
}

/** Format a report. Returns { text, ok } so the test can assert on `ok`. */
export function auditReport({ all = false } = {}) {
  const { findings, cards } = auditCards();
  const { fresh, stale, accepted } = partition(findings);
  const lines = [];
  const group = list => {
    const by = new Map();
    for (const f of list) {
      if (!by.has(f.check)) by.set(f.check, []);
      by.get(f.check).push(f);
    }
    for (const [check, fs] of [...by].sort()) {
      lines.push(`  ${check} (${fs.length})`);
      for (const f of fs) lines.push(`    ${f.card}: ${f.detail}`);
    }
  };

  lines.push(`card audit: ${cards} catalogue entries, ${POOL.length} scripted, ${findings.length} findings`);
  lines.push(`  ${accepted} accepted (scripts/card-audit-known.mjs), ${fresh.length} new, ${stale.length} stale`);

  if (fresh.length) { lines.push('', 'NEW FINDINGS'); group(fresh); }
  if (stale.length) {
    lines.push('', 'STALE ENTRIES in scripts/card-audit-known.mjs -- delete them, the cause is gone:');
    for (const k of stale) lines.push(`    ${k.check} / ${k.card} (accepted ${k.since})`);
  }
  if (all && accepted) {
    lines.push('', 'ACCEPTED');
    group(findings.filter(f => !fresh.includes(f)));
  }
  if (!fresh.length && !stale.length) lines.push('', 'clean.');

  return { text: lines.join('\n'), ok: !fresh.length && !stale.length, fresh, stale, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { text, ok } = auditReport({ all: process.argv.includes('--all') });
  console.log(text);
  process.exit(ok ? 0 : 1);
}

export { here, ART_DIR, join };
