/* Build step: pull printed card data for the M1 pool out of
 * AlgomancyCards-OracleText.json into src/cards/printed.json.
 * Printed data is NEVER hand-copied into card definitions (project rule);
 * only behavior is authored by hand in registry.ts.
 *
 * Derived per card:
 *   cost pips (r/b/e/g/m letters), mana (total_cost), stats, kind
 *   (unit | spell | spellUnit | spellToken from the type string),
 *   attrs   — {X} markers in the type line (Piercing, Flying, …),
 *   timing  — {Battle}/{Haste} markers (default: deployment only),
 *   virus   — {Virus} marker,
 *   augmentAttrs — attrs granted when applied as an augment ([Augment]
 *                  prefixing the type line means the attrs transfer).
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
]);

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
  // "[Battle] Ambush [4bb]" in the text = an alternative battle play mode:
  // pay <digits> mana with <pips> affinity (Manual p.40, Ambush)
  const ambushM = (e.text ?? '').match(/\[Battle\]\s*Ambush\s*\[(\d*)([rbegm]*)\]/);
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
    ...(ambushM ? { ambush: { cost: ambushM[2], mana: Number(ambushM[1] || 0) } } : {}),
    text: e.text,
    image: name.replace(/ /g, '-') + '.jpg',
  };
}

if (missing.length) {
  console.error('Missing from oracle JSON:', missing);
  process.exit(1);
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`Wrote ${Object.keys(out).length} cards to src/cards/printed.json`);
