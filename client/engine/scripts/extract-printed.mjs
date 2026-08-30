/* Build step: pull printed card data out of AlgomancyCards-OracleText.json
 * into TWO files:
 *   src/cards/printed.json    the POOL, the engine's trusted printed data
 *   src/cards/catalogue.json  every oracle name, plus browse-only metadata
 *                             (class/supertype/subtypes/complexity/deck/art)
 * See the catalogue comment above the second pass for why they are two files.
 * Printed data is NEVER hand-copied into card definitions (project rule);
 * only behavior is authored by hand in registry.ts.
 *
 * Derived per card:
 *   cost pips (r/b/e/g/m + Light & Dark's l/d), mana (total_cost), stats, kind
 *   (unit | spell | spellUnit | spellToken from the type string),
 *   attrs   — {X} markers in the type line (Piercing, Flying, …),
 *   timing  — {Battle}/{Haste} markers (default: deployment only),
 *   virus   — {Virus} marker,
 *   augmentAttrs — attrs granted when applied as an augment ([Augment]
 *                  prefixing the type line means the attrs transfer).
 *   ambush  — the alternative battle play mode's cost, either printed order,
 *   prophecy— the Light & Dark banner beneath the title (mana + condition),
 *   gainDebt— a printed "[Gain N debt]" bracketed additional cast cost,
 *   discardMe— a printed "1 Discard me" cost line (an alternative play mode).
 * The banner/cost lines are stripped out of the emitted `text`, which is left
 * holding only the rules text.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { POOL } from './pool.mjs';
import { applyOverride, StaleOverrideError } from './printed-overrides.mjs';
import { ORACLE_JSON, CARDS_DIR } from './paths.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = ORACLE_JSON;
const OUT = join(here, '../src/cards/printed.json');
/* browse-only, read by ui/cardindex.ts and by nothing in src/ — see the
 * catalogue comment further down for why it is a separate file */
const CATALOGUE = join(here, '../src/cards/catalogue.json');
/* the card scans, so the catalogue can say which names have art */
const ART_DIR = CARDS_DIR;

const ATTRS = new Set([
  'Flying', 'Deadly', 'Swift', 'Sluggish', 'Tough', 'Balanced', 'Inverted', 'Unaware',
  'Powerful', 'Vulnerable', 'Feeble', 'Evasive', 'Sneaky', 'Alluring', 'Piercing',
  'Electric', 'Poisonous', 'Resonant', 'Thieving', 'Reaping',
  // Light & Dark
  'Blessed', 'Afflicting', 'Lethal', 'Pure', 'Modular',
]);

/** affinity pip letters, including Light & Dark's l/d */
const PIP = 'rbegmld';

/** Ambush prints in two orders in the transcription:
 *   "[Battle] Ambush [4bb]"  (base set)      and
 *   "[4] Ambush [Battle]"    (L&D: Shib).
 * Both mean the same thing: an alternative battle play mode costing <digits>
 * mana at <pips> affinity (Manual p.40).
 *
 * ONE card spells its amount as a word inside the same token — Lurking
 * Slimebeast's "[three_blue]" — and this used to skip it, which left the card
 * with no ambush field and therefore no Ambush mode at all: a printed play
 * mode that simply did not exist in the client. The expansion is the same one
 * core.py's COST_WORDS has always used ("three_blue" -> "3b"), normalised
 * before the patterns run so there is one place that knows the word forms. */
const COST_WORDS = {
  zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  three_blue: '3b',
};
const COST_WORD_RE = new RegExp(`\\[(${Object.keys(COST_WORDS).join('|')})\\]`, 'gi');
const expandCostWords = text =>
  text.replace(COST_WORD_RE, (_m, w) => `[${COST_WORDS[w.toLowerCase()]}]`);

const AMBUSH_RES = [
  new RegExp(`\\[Battle\\]\\s*Ambush\\s*\\[(\\d*)([${PIP}]*)\\]`),
  new RegExp(`\\[(\\d*)([${PIP}]*)\\]\\s*Ambush\\s*\\[Battle\\]`),
];
function parseAmbush(text) {
  const norm = expandCostWords(text);
  for (const re of AMBUSH_RES) {
    const m = norm.match(re);
    if (m && (m[1] || m[2])) return { cost: m[2], mana: Number(m[1] || 0) };
  }
  return null;
}

/**
 * R142 — LAYOUT ARTIFACTS from the card art, scrubbed once, here.
 *
 * Report #102 was about markup reaching the player. Two of the things that
 * reach the player are not markup at all: they are accidents of the printed
 * card's TYPESETTING that the transcription carried through.
 *
 *  1. A word hyphenated across a printed line. The transcription normally
 *     keeps the line break — "sacri- {/n}fices" — and the renderer's `clean()`
 *     joins hyphen and marker together. But FOUR cards lost their `{/n}` in
 *     transcription and are left holding a bare "adja- cent" (Flamebreath
 *     Initiate) / "oppo- nent" (Cinder Scuttler, Ghord, Molten Tormentor).
 *     Those read as broken words on every surface that shows raw printed text.
 *
 *  2. Runs of whitespace, on 49 cards' text and one type line (Slag Spewer's
 *     leads with a space). Invisible in HTML, visible everywhere else — logs,
 *     the Discord bot, a diff, a test's failure message.
 *
 * ⚠ ANCHORED NARROWLY, because the pool is full of legitimate dashes. The join
 * fires only on letter + "-" + space + LOWERCASE letter. That misses every
 * `-1/-1` (the hyphen follows a space and precedes a digit), every `-X/-X`,
 * every closed compound (`Self-Assembly`, `non-token`), and the em-dash of the
 * prophecy banner ("Prophecy — One Turn Passes"), which is `—`, not `-`. It
 * also deliberately misses "sacri- {/n}fices": a `{/n}` is a real printed line
 * break and the LINE_SEP the banner parser splits on, so joining those away
 * would destroy the text box's line structure to fix a bug `clean()` already
 * handles.
 *
 * ⚠ AND IT DOES NOT FIX SPELLING. (The example: `Linked Extinction` once read
 * "Sacrifce a unit"; it was corrected at source in 0818074, and the rule below
 * is what stopped it being papered over here in the meantime.)
 * `Linked Extinction` read "Sacrifce a unit"
 * — a typo in Caleb's source data, not a layout artifact. Rewriting a
 * designer's words behind their back is the exact quiet lie the card ledger
 * exists to stop, so it is reported and left. If it is ever corrected here it
 * must be a named one-entry override, never a fuzzy spellfix.
 */
const normalisePrinted = s => (typeof s === 'string'
  ? s.replace(/([A-Za-z])-[ \t]+([a-z])/g, '$1$2').replace(/[ \t]+/g, ' ').trim()
  : s);

/**
 * R162/R190 — the NAMED PRINTED-DATA OVERRIDES, the exception
 * `normalisePrinted` above demands: *"If it is ever corrected here it must be a
 * named one-entry override, never a fuzzy spellfix."*
 *
 * R162 shipped this as a `TYPE_OVERRIDES` object literal in this file, keyed by
 * card name and covering the type line only. R190 moved it to
 * `scripts/printed-overrides.mjs` and made it field-general, for two reasons:
 * the next upstream error will not necessarily be on a type line, and a table
 * that a TEST can import is a table whose staleness is checked without running
 * the build. See that file's header for why the correction lives in this
 * package at all rather than in printed.json or in Caleb's oracle file — and
 * for the standing warning that an override here fixes ONE of the three
 * consumers of the oracle data and leaves the Discord bot and the RAG corpus
 * wrong until the source is corrected.
 */
/** The transcription joins the printed lines of a text box with "{/n}". */
const LINE_SEP = '{/n}';
const splitLines = text => text.split(LINE_SEP);
const joinLines = lines => lines.join(LINE_SEP);

/** The Light & Dark "prophecy" banner printed BENEATH THE TITLE, which the
 * transcription put at the start of the text field:
 *   "[2] Prophecy — Two Turns Pass"   (some cards print the mana unbracketed)
 * Only a banner on the very first line counts — rules text that GRANTS a
 * prophecy to another card ("It gains 'Prophecy — One Turn Passes'") is not a
 * printed banner and must not be picked up here. */
const PROPHECY_RE = /^\s*\[?\s*(\d+)\s*\]?\s*Prophecy\s*[—–-]\s*(.*?)\s*$/;

/** A printed "[Gain N debt]" bracketed additional cast cost on its own line. */
const GAIN_DEBT_RE = /^\s*\[\s*Gain\s+(\d+)\s+debt\s*\]\s*$/i;

/** R40 — the "Discard me" cost line: an alternative play mode (like Ambush)
 * meaning "pay this, discard me from hand, which TRASHES me and so fires my
 * own 'when I am trashed' trigger". The pool prints three of them, all on the
 * FIRST line of the text box and all in the same shape:
 *   "1 Discard me"                    (Dropslime)
 *   "2 [d] Discard Me. {Battle}"      (Nothyr)
 *   "2 [d] Discard me"                (Sacrifice Dude)
 * i.e. <mana> [<pips>]? Discard me .? {Battle}? — mana unbracketed, affinity
 * pips bracketed, an optional trailing timing marker that belongs to THIS MODE
 * (Nothyr is a deploy unit whose discard-me line is battle timing). */
const DISCARD_ME_RE = new RegExp(
  `^\\s*(\\d+)\\s*(?:\\[\\s*([${PIP}]*)\\s*\\])?\\s*Discard\\s+me\\s*\\.?\\s*(?:\\{(Battle|Haste)\\})?\\s*$`, 'i');

/** Pull the printed banner/extra-cost lines off the front of a text box.
 * Returns { text, prophecy?, gainDebt? } with those lines removed. */
function parseBanners(text) {
  const lines = splitLines(text);
  const out = {};
  const m = lines[0] !== undefined ? lines[0].match(PROPHECY_RE) : null;
  if (m) {
    out.prophecy = { mana: Number(m[1]), condition: m[2].trim() };
    lines.shift();
  }
  const debtIdx = lines.findIndex(l => GAIN_DEBT_RE.test(l));
  if (debtIdx !== -1) {
    out.gainDebt = Number(lines[debtIdx].match(GAIN_DEBT_RE)[1]);
    lines.splice(debtIdx, 1);
  }
  // the "Discard me" cost line — first line only, like the prophecy banner
  const dm = lines[0] !== undefined ? lines[0].match(DISCARD_ME_RE) : null;
  if (dm) {
    out.discardMe = {
      cost: (dm[2] ?? '').toLowerCase(),
      mana: Number(dm[1]),
      ...(dm[3] && dm[3].toLowerCase() === 'battle' ? { timing: 'battle' } : {}),
    };
    lines.shift();
  }
  // nothing stripped => hand back the printed text byte-for-byte
  if (!('prophecy' in out) && !('gainDebt' in out) && !('discardMe' in out)) return { text };
  return { ...out, text: joinLines(lines).trim() };
}

function typeAugmentAttrs(type) {
  const i = type.indexOf('[Augment]');
  if (i === -1) return [];
  return [...type.slice(i + '[Augment]'.length).matchAll(/\{([A-Za-z]+)\}/g)]
    .map(m => m[1]).filter(a => ATTRS.has(a));
}

/** R190: a stale override is a BUILD FAILURE, never a silent no-op. The day
 * Caleb corrects his file, the entry here stops matching and this exits
 * non-zero naming the card, instead of quietly rewriting a field that is
 * already right. See scripts/printed-overrides.mjs. */
function ov(card, field, value) {
  // R240: the throw is NOT swallowed here any more. `buildAll()` is imported by
  // scripts/audit-cards.mjs and by the audit test, and a process.exit in a
  // library function kills the test runner instead of reporting the finding.
  // The script's main guard below turns it into the non-zero exit.
  return applyOverride(card, field, value);
}


/* ── THE CATALOGUE, and why it is a second file ────────────────────────
 *
 * `printed.json` is the ENGINE's file: it holds exactly the POOL, because a
 * name in it that no `card()` call claims is dead weight the engine would
 * still have to trust. The card browser wants the opposite — every name the
 * oracle file knows, including the 42 the engine has never loaded (help cards,
 * intent and effect markers, resource faces, the Stolen Cards, the eleven
 * Kickstarter Glitch cards) — plus the catalogue metadata the engine has no
 * use for and therefore throws away today: complexity, the Deck a card ships
 * in, the subtypes buried in the type line.
 *
 * Putting those on `printed.json` would widen the engine's trust boundary for
 * a UI feature, and `src/cards/dsl.ts` spreads every printed field onto the
 * CardDef. So they go in `catalogue.json`, written from the SAME parse pass in
 * the SAME run — which is the only reason the two cannot drift. A test asserts
 * the containment (`catalogue[name]` ⊇ `printed[name]` for all of POOL); if
 * you ever find yourself generating one without the other, that test is the
 * alarm and the split has failed.
 *
 * ⚠ NOTHING IN THE ENGINE MAY IMPORT catalogue.json. It is browse data. A
 * card the catalogue lists is not thereby playable — `scripted` says whether
 * the engine has printed data for it at all, and DECK_LIST (computed in the
 * registry, at runtime) says whether it is deck-legal. Those are three
 * different questions and the browser asks all three.
 */

/** The printed noun tail that says what KIND OF OBJECT a card is, longest
 * first so "Spell Unit" is not read as "Unit" with a "Spell" subtype. */
const SUPERTYPES = ['Spell Unit', 'Spell Token', '!Resource', 'Unit', 'Spell', 'Resource', 'Card', 'Token'];

/** Every {…} / […] markup token, whatever it says. The type line's vocabulary
 * is open — attributes, timing markers, cost pips, [Augment] — and the point
 * here is only to remove it, so this deliberately does not enumerate it. */
const MARKUP_RE = /\{[^}]*\}|\[[^\]]*\]/g;

/** Split a type line into its printed parts. Derived, never enumerated: what
 * is left after the markup and the supertype tail come off IS the subtype
 * list, so a subtype nobody has seen before needs no code change here. */
function parseTypeLine(type) {
  const augment = /\[Augment\]/i.test(type);
  const bare = type.replace(MARKUP_RE, ' ').replace(/\s+/g, ' ').trim();
  const supertype = SUPERTYPES.find(s => bare === s || bare.endsWith(' ' + s)) ?? '';
  const rest = supertype ? bare.slice(0, bare.length - supertype.length).trim() : bare;
  return { augment, supertype, subtypes: rest ? rest.split(' ') : [] };
}

/**
 * What KIND of thing this is, for a browser that must show everything without
 * pretending a Cardback is a card you could play.
 *
 * The owner's call, verbatim: *"Everything, but treat tokens, resources and
 * the 'help' cards as special, non-card cards"*. So this is a classification,
 * not a filter — every one of the 534 names gets a class and none is dropped.
 */
function classOf(type, deck) {
  const { supertype } = parseTypeLine(type);
  if (supertype === 'Card') return 'help';        // every "… Help Card" in the file
  if (supertype === '!Resource') return 'marker'; // Stolen Cards, Trigger 1-3
  if (supertype === 'Resource') return 'resource';
  if (/\bToken\b/.test(type)) return 'token';
  if (deck === 'Kickstarter Exclusive') return 'exclusive';
  return 'card';
}

const db = JSON.parse(readFileSync(SOURCE, 'utf8'));

/** The printed record for one oracle face — the whole of `printed.json`'s
 * per-card shape, factored out so the catalogue pass below builds on exactly
 * the same parse rather than a lookalike. */
function printedOf(name, e) {
  // R142: layout artifacts out before anything reads the strings — the banner,
  // ambush and attribute parsers all see the normalised form, so there is one
  // spelling of the printed text in the whole pipeline
  // R162/R190: the named corrections go on FIRST, so every parser below
  // (markers, attrs, timing, kind, [Augment] attrs, banners, ambush) sees the
  // corrected string rather than the one the oracle file got wrong
  const type = ov(name, 'type', normalisePrinted(e.type));
  const markers = [...type.matchAll(/\{([A-Za-z]+)\}/g)].map(m => m[1]);
  const attrs = markers.filter(m => ATTRS.has(m));
  const timing = markers.includes('Battle') ? 'battle' : markers.includes('Haste') ? 'haste' : 'deploy';
  const kind = /Spell Token/.test(type) ? 'spellToken'
    : /Spell Unit/.test(type) ? 'spellUnit'
    : /Spell/.test(type) ? 'spell' : 'unit';
  const cost = e.cost === 'empty' ? '' : (e.cost ?? '');
  const rawText = ov(name, 'text', normalisePrinted(e.text ?? ''));
  // an alternative battle play mode: pay <digits> mana with <pips> affinity
  // (Manual p.40, Ambush) — printed in either order, see AMBUSH_RES
  const ambush = parseAmbush(rawText);
  // the printed banner / bracketed extra-cost lines, lifted out of the text
  const banners = typeof e.text === 'string' ? parseBanners(rawText) : { text: e.text };
  return {
    name,
    // element factions from the oracle DB ("fire", or ["fire","water"] for a
    // hybrid; [] for colorless) — drives draft pool construction
    factions: Array.isArray(e.factions) && e.factions[0] !== 'Unknown' && e.factions[0] !== 'colorless'
      ? e.factions : [],
    cost,                                   // affinity pips, e.g. "rr"
    mana: e.total_cost === 'X' ? 'X' : (Number(e.total_cost) || 0),
    power: Number(e.power) || 0,
    toughness: Number(e.toughness) || 0,
    type,
    kind,
    timing,
    attrs,
    virus: markers.includes('Virus'),
    burst: markers.includes('Burst'),
    // {Unstable} printed on the type line (Aberrant Statweaver, Oorblak). Not
    // an ATTR on purpose (it is a bin replacement, not a combat attribute —
    // see types.ts on Entity.unstable), so it gets its own flag, like virus.
    // Emitted only when present so the two cards that print it are the whole
    // diff. Read by E.isUnstable (report #89).
    ...(markers.includes('Unstable') ? { unstable: true } : {}),
    // [Augment] on the type line => the attrs after it transfer when augmenting
    // (mirrors mods.py: text-box [Augment] transfers text only, never attrs)
    augmentAttrs: typeAugmentAttrs(type),
    ...(ambush ? { ambush } : {}),
    ...(banners.prophecy ? { prophecy: banners.prophecy } : {}),
    ...(banners.gainDebt !== undefined ? { gainDebt: banners.gainDebt } : {}),
    ...(banners.discardMe ? { discardMe: banners.discardMe } : {}),
    text: banners.text,
    image: name.replace(/ /g, '-') + '.jpg',
  };
}

/**
 * Build both files in memory. Exported so `scripts/audit-cards.mjs` can
 * re-derive them from the oracle file and compare against what is committed —
 * a freshness check that is only worth anything if it runs the SAME code, not
 * a lookalike of it.
 */
export function buildAll() {
  const printed = {};
  const missing = [];

  for (const name of POOL) {
    const entries = db[name];
    if (!entries) { missing.push(name); continue; }
    printed[name] = printedOf(name, entries[0]);
  }

  const inPool = new Set(POOL);
  const catalogue = {};

  for (const [name, entries] of Object.entries(db)) {
    const e = entries?.[0];
    if (!e) continue;
    const rec = printed[name] ?? printedOf(name, e);
    const { augment, supertype, subtypes } = parseTypeLine(rec.type);
    const deck = typeof e.Deck === 'string' ? e.Deck : '';
    catalogue[name] = {
      ...rec,
      text: rec.text ?? '',
      class: classOf(rec.type, deck),
      supertype,
      subtypes,
      augment,
      complexity: typeof e.complexity === 'string' ? e.complexity : '',
      deck,
      numCopies: Number(e.Num_Copies) || 1,
      side: e.Side === 'Back' ? 'Back' : 'Front',
      backside: typeof e.Backside === 'string' ? e.Backside : '',
      hasArt: existsSync(join(ART_DIR, rec.image)),
      scripted: inPool.has(name),
      // the Light & Dark transcriptions carry a `source` line saying they are
      // read off pre-release art rather than off a printed card
      provisional: typeof e.source === 'string' && e.source.length > 0,
      ...(Array.isArray(e.rulings) && e.rulings.length ? { rulings: e.rulings } : {}),
    };
  }

  return { printed, catalogue, missing };
}

/** The raw oracle file, for the audit's source-level checks. */
export const oracle = db;
export { parseTypeLine, classOf, normalisePrinted, PIP, ATTRS, OUT, CATALOGUE, ART_DIR };

/* Writing is the SCRIPT's job, not the module's: the audit imports this file
 * and must not have a build's side effects. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let built;
  try {
    built = buildAll();
  } catch (err) {
    if (!(err instanceof StaleOverrideError)) throw err;
    console.error(err.message);
    process.exit(1);
  }
  const { printed, catalogue, missing } = built;
  if (missing.length) {
    console.error('Missing from oracle JSON:', missing);
    process.exit(1);
  }
  writeFileSync(OUT, JSON.stringify(printed, null, 1));
  console.log(`Wrote ${Object.keys(printed).length} cards to src/cards/printed.json`);
  writeFileSync(CATALOGUE, JSON.stringify(catalogue, null, 1));
  console.log(`Wrote ${Object.keys(catalogue).length} cards to src/cards/catalogue.json`);
}
