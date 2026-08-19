/* Build step: pull printed card data for the M1 pool out of
 * AlgomancyCards-OracleText.json into src/cards/printed.json.
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
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { POOL } from './pool.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, '../../../AlgomancyCards/AlgomancyCards-OracleText.json');
const OUT = join(here, '../src/cards/printed.json');

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
 * mana at <pips> affinity (Manual p.40). Word-form costs ("[three_blue]" on
 * Lurking Slimebeast) are deliberately not parsed. */
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

const db = JSON.parse(readFileSync(SOURCE, 'utf8'));
const out = {};
const missing = [];

for (const name of POOL) {
  const entries = db[name];
  if (!entries) { missing.push(name); continue; }
  const e = entries[0];
  const type = e.type;
  const markers = [...type.matchAll(/\{([A-Za-z]+)\}/g)].map(m => m[1]);
  const attrs = markers.filter(m => ATTRS.has(m));
  const timing = markers.includes('Battle') ? 'battle' : markers.includes('Haste') ? 'haste' : 'deploy';
  const kind = /Spell Token/.test(type) ? 'spellToken'
    : /Spell Unit/.test(type) ? 'spellUnit'
    : /Spell/.test(type) ? 'spell' : 'unit';
  const cost = e.cost === 'empty' ? '' : e.cost;
  const rawText = e.text ?? '';
  // an alternative battle play mode: pay <digits> mana with <pips> affinity
  // (Manual p.40, Ambush) — printed in either order, see AMBUSH_RES
  const ambush = parseAmbush(rawText);
  // the printed banner / bracketed extra-cost lines, lifted out of the text
  const banners = typeof e.text === 'string' ? parseBanners(rawText) : { text: e.text };
  out[name] = {
    name,
    // element factions from the oracle DB ("fire", or ["fire","water"] for a
    // hybrid; [] for colorless) — drives draft pool construction
    factions: Array.isArray(e.factions) && e.factions[0] !== 'Unknown' && e.factions[0] !== 'colorless'
      ? e.factions : [],
    cost,                                   // affinity pips, e.g. "rr"
    mana: e.total_cost === 'X' ? 'X' : Number(e.total_cost),
    power: Number(e.power) || 0,
    toughness: Number(e.toughness) || 0,
    type,
    kind,
    timing,
    attrs,
    virus: markers.includes('Virus'),
    burst: markers.includes('Burst'),
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

if (missing.length) {
  console.error('Missing from oracle JSON:', missing);
  process.exit(1);
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`Wrote ${Object.keys(out).length} cards to src/cards/printed.json`);
