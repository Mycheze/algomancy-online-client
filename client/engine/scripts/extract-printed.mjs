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
 *   prophecy— the banner beneath the title (mana + affinity + condition),
 *   gainDebt— a printed "[Gain N debt]" bracketed additional cast cost,
 *   discardMe— a printed "1 Discard me" cost line (an alternative play mode).
 * The banner/cost lines are stripped out of the emitted `text`, which is left
 * holding only the rules text.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { POOL } from './pool.mjs';
import { ORACLE_JSON, CARDS_DIR, COMPLEXITY_OVERRIDES, MOD_ANCHORS } from './paths.mjs';

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

/** Ambush is printed in two orders on the physical cards, and the
 * transcription keeps each card's order:
 *   "[Battle] Ambush [4bb]"  in the text box (base set: Good Whale)
 *   "[4] Ambush [Battle]"    under the title (Light & Dark: Shib)
 * Both mean the same thing: an alternative battle play mode costing <digits>
 * mana at <pips> affinity (Manual p.40). */
const AMBUSH_RES = [
  new RegExp(`\\[Battle\\]\\s*Ambush\\s*\\[(\\d*)([${PIP}]*)\\]`),
  new RegExp(`\\[(\\d*)([${PIP}]*)\\]\\s*Ambush\\s*\\[Battle\\]`),
];
function parseAmbush(text) {
  for (const re of AMBUSH_RES) {
    const m = text.match(re);
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
 * ⚠ AND IT DOES NOT FIX SPELLING. A typo in the transcription (`Linked
 * Extinction` once read "Sacrifce a unit") is corrected in the oracle file
 * itself, never papered over here: a fuzzy spellfix in a build step is a
 * correction nobody can see.
 */
const normalisePrinted = s => (typeof s === 'string'
  ? s.replace(/([A-Za-z])-[ \t]+([a-z])/g, '$1$2').replace(/[ \t]+/g, ' ').trim()
  : s);

/** The transcription joins the printed lines of a text box with "{/n}". */
const LINE_SEP = '{/n}';
const splitLines = text => text.split(LINE_SEP);
const joinLines = lines => lines.join(LINE_SEP);

/** The "prophecy" banner printed BENEATH THE TITLE, which the transcription
 * puts at the start of the text field:
 *   "[1ld] Prophecy — Two Turns Pass"  (mana then affinity pips, one bracket)
 *   "[2] Prophecy — Two Turns Pass"    (a banner that demands no affinity)
 *   "2 Prophecy — Two Turns Pass"      (some rows print the mana unbracketed)
 * Only a banner on the very first line counts — rules text that GRANTS a
 * prophecy to another card ("It gains 'Prophecy — One Turn Passes'") is not a
 * printed banner and must not be picked up here.
 *
 * ⚠ The pips were added on 2026-09-20. Every one of the ten printed banners
 * carries them on the scan and NOT ONE survived transcription, so until that
 * date this regex had no pip group at all and `prophecy` had nowhere to put
 * an affinity requirement — see bot/pipeline/read_card_faces.py. The shape is
 * deliberately AMBUSH_RES's and DISCARD_ME_RE's: one bracket, mana first. */
const PROPHECY_RE = new RegExp(
  `^\\s*\\[?\\s*(\\d+)\\s*([${PIP}]*)\\s*\\]?\\s*Prophecy\\s*[—–-]\\s*(.*?)\\s*$`);

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
    out.prophecy = { cost: (m[2] ?? '').toLowerCase(), mana: Number(m[1]), condition: m[3].trim() };
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

/** A generated-input entry that no longer matches the oracle file. Raised by
 * `complexityOf` below; the script's main guard turns it into a non-zero exit
 * naming the card, and the audit reports it as a finding. */
export class StaleOverrideError extends Error {}


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

/* ── THE COMPLEXITY THE ORACLE FILE DOES NOT HAVE ──────────────────────
 *
 * Every Light & Dark row in the oracle file carries `complexity: "Common"` —
 * a value the printed cards do not have (they are Simple or Complex, like the
 * base game; the Kickstarter cards are Glitch). Owner, 2026-09-05: "The rarity
 * of Light v Dark cards is all wrong. They're all in there as 'Common'."
 *
 * The answer is printed on the scan — a silver or gold glyph on the type bar —
 * and `bot/pipeline/classify_complexity.py` reads it off every scan into
 * `data/cards/complexity-overrides.json` (generated; see its `_what`). This is
 * the one direction the Python side FEEDS the client rather than the reverse:
 * Pillow is over there, and so is the other scan-reading script.
 *
 * An entry names the oracle value it replaces (`from`), and if the oracle
 * file no longer says that — someone filled the field in by hand — the build
 * FAILS and names the card, instead of quietly overwriting a value that is
 * already right. Re-run the classifier and the stale entries vanish, since
 * it only ever emits the placeholder rows.
 *
 * An absent file is not an error: the catalogue then carries the oracle's own
 * value, "Common" and all, and the browser shows what it always did. */
const complexityOverrides = existsSync(COMPLEXITY_OVERRIDES)
  ? JSON.parse(readFileSync(COMPLEXITY_OVERRIDES, 'utf8')).cards ?? {}
  : {};

function complexityOf(name, value) {
  const o = complexityOverrides[name];
  if (!o) return value;
  if (value !== o.from) {
    throw new StaleOverrideError(
      `complexity-overrides.json is stale for ${name}: expected `
      + `${JSON.stringify(o.from)}, oracle now has ${JSON.stringify(value)}. `
      + 'Re-run bot/pipeline/classify_complexity.py.');
  }
  return o.to;
}

/* ── HOW FAR A MOD PEEKS OUT FROM UNDER ITS HOST ───────────────────────
 *
 * A mod under a host shows only its bottom edge, and that edge has to start
 * where the ability that TRANSFERS starts — the line the [Augment] or
 * [Switch] icon opens. That line is somewhere different on every card. On a
 * card whose [Augment] heads its TYPE LINE (Resonant Form, Tempest Wrangler)
 * it is the type bar, which rides on top of the rules box and so sits anywhere
 * from ~20% to ~10% up the card. A fixed 16% slice cut through the type bar
 * on half of those cards and showed only the reminder text beneath it, the
 * [Augment] and its attributes sliced off.
 *
 * `bot/pipeline/build_anchors.py` already finds the icon in every scan and
 * records `cut`, the gap above its line — the bot's stacked-card images are
 * sliced there. This carries the same number to the browser as a fraction
 * of the scan's height, clamped the way `bot/mods.py peek_height` clamps it
 * (never under 40px of a 1000px scan). A card with no anchor gets no
 * `modPeek`, and the strip keeps the stylesheet's fixed fallback. */
const SCAN_H = 1000;
const modAnchors = existsSync(MOD_ANCHORS)
  ? JSON.parse(readFileSync(MOD_ANCHORS, 'utf8'))
  : {};

function modPeekOf(name) {
  const a = modAnchors[name];
  if (!a || typeof a.cut !== 'number') return undefined;
  const px = Math.max(40, Math.min(SCAN_H, SCAN_H - a.cut));
  return Math.round(px / SCAN_H * 1000) / 1000;
}

/** The printed record for one oracle face — the whole of `printed.json`'s
 * per-card shape, factored out so the catalogue pass below builds on exactly
 * the same parse rather than a lookalike. */
function printedOf(name, e) {
  // R142: layout artifacts out before anything reads the strings — the banner,
  // ambush and attribute parsers all see the normalised form, so there is one
  // spelling of the printed text in the whole pipeline
  // layout normalised first, so every parser below (markers, attrs, timing,
  // kind, [Augment] attrs, banners, ambush) sees one spacing
  const type = normalisePrinted(e.type);
  const markers = [...type.matchAll(/\{([A-Za-z]+)\}/g)].map(m => m[1]);
  const attrs = markers.filter(m => ATTRS.has(m));
  const timing = markers.includes('Battle') ? 'battle' : markers.includes('Haste') ? 'haste' : 'deploy';
  const kind = /Spell Token/.test(type) ? 'spellToken'
    : /Spell Unit/.test(type) ? 'spellUnit'
    : /Spell/.test(type) ? 'spell' : 'unit';
  const cost = e.cost === 'empty' ? '' : (e.cost ?? '');
  const rawText = normalisePrinted(e.text ?? '');
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
      complexity: complexityOf(name, typeof e.complexity === 'string' ? e.complexity : ''),
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
      ...(modPeekOf(name) !== undefined ? { modPeek: modPeekOf(name) } : {}),
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
