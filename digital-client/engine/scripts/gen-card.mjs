/* Card-scripting pipeline (roadmap step 3): oracle JSON → DSL skeleton + test stub.
 *
 *   node scripts/gen-card.mjs "Card Name" ["Another Card" ...]
 *   node scripts/gen-card.mjs --dry "Card Name"     # don't touch pool.mjs / printed.json
 *
 * For each named card this script:
 *   1. verifies the name exists in AlgomancyCards-OracleText.json
 *      (suggesting close matches when it doesn't),
 *   2. appends it to scripts/pool.mjs and re-runs extract-printed.mjs
 *      (printed data is NEVER hand-copied — project rule),
 *   3. writes a behavior skeleton (for src/cards/registry.ts) and a test stub
 *      (for the per-card suite) to scripts/generated/<slug>.ts, and prints both.
 *
 * The skeleton is a REVIEWED DRAFT, not an answer: every guessed piece is
 * marked TODO. Definition of done stays: human review + a real per-card test.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { POOL } from './pool.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, '../../../AlgomancyCards/AlgomancyCards-OracleText.json');
const POOL_FILE = join(here, 'pool.mjs');
const OUT_DIR = join(here, 'generated');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const names = args.filter(a => a !== '--dry');
if (!names.length) {
  console.error('usage: node scripts/gen-card.mjs [--dry] "Card Name" ...');
  process.exit(1);
}

const db = JSON.parse(readFileSync(SOURCE, 'utf8'));

// ── name validation with suggestions ──────────────────────────────────
const bad = names.filter(n => !db[n]);
if (bad.length) {
  for (const n of bad) {
    const needle = n.toLowerCase();
    const close = Object.keys(db)
      .filter(k => k.toLowerCase().includes(needle) || needle.includes(k.toLowerCase()) ||
        overlap(k.toLowerCase(), needle) >= 0.6)
      .slice(0, 5);
    console.error(`Not in oracle JSON: "${n}"${close.length ? ` — did you mean: ${close.join(' | ')}?` : ''}`);
  }
  process.exit(1);
}
function overlap(a, b) {
  const aw = new Set(a.split(/\s+/)), bw = new Set(b.split(/\s+/));
  const both = [...aw].filter(w => bw.has(w)).length;
  return both / Math.max(aw.size, bw.size);
}

// ── grow the pool + re-extract ────────────────────────────────────────
const fresh = names.filter(n => !POOL.includes(n));
if (!dry && fresh.length) {
  const src = readFileSync(POOL_FILE, 'utf8');
  const insert = fresh.map(n => `  '${n.replace(/'/g, "\\'")}',\n`).join('');
  writeFileSync(POOL_FILE, src.replace(/\];\s*$/, insert + '];\n'));
  execFileSync('node', [join(here, 'extract-printed.mjs')], { stdio: 'inherit' });
  console.log(`Added to pool: ${fresh.join(', ')}`);
}

// ── skeleton generation ───────────────────────────────────────────────
const ATTRS = new Set([
  'Flying', 'Deadly', 'Swift', 'Sluggish', 'Tough', 'Balanced', 'Inverted', 'Unaware',
  'Powerful', 'Vulnerable', 'Feeble', 'Evasive', 'Sneaky', 'Alluring', 'Piercing',
  'Electric', 'Poisonous', 'Resonant', 'Thieving', 'Reaping',
]);

/** trigger-phrase → engine EventType guesses (best effort, always TODO-marked) */
const EVENT_GUESSES = [
  [/when i spawn or die/i, ['spawned', 'died'], true],
  [/when i attack, block, or die/i, ['attacked', 'blocked', 'died'], true],
  [/when i attack or block/i, ['attacked', 'blocked'], true],
  [/when i attack/i, ['attacked'], true],
  [/when i block/i, ['blocked'], true],
  [/when i (die|am deleted)/i, ['died'], true],
  [/when i spawn/i, ['spawned'], true],
  [/when i am dealt damage/i, ['damage'], true],
  [/after combat/i, ['afterCombat'], false],
  [/at the end of turn/i, ['endOfTurn'], false],
  [/becomes? the target|when i become targeted/i, ['targeted'], false],
  [/play(s)? a .*spell|plays? a spell/i, ['spellPlayed'], false],
  [/(ally|unit) (spawns|dies)|an ally spawns/i, [], false],   // needs when()
];

function guessEvents(clause) {
  for (const [re, events, self] of EVENT_GUESSES) {
    if (re.test(clause)) return { events, self };
  }
  return { events: [], self: false };
}

function cleanText(text) {
  return (text ?? '')
    .replace(/\{i\}\(.*?\)(\{\/i\})?/gs, '')   // strip reminder text
    .replace(/\{\/?n\}/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function skeleton(name) {
  const e = db[name][0];
  const type = e.type;
  const markers = [...type.matchAll(/\{([A-Za-z]+)\}/g)].map(m => m[1]);
  const attrs = markers.filter(m => ATTRS.has(m));
  const kind = /Spell Token/.test(type) ? 'spellToken'
    : /Spell Unit/.test(type) ? 'spellUnit'
    : /Spell/.test(type) ? 'spell' : 'unit';
  const text = cleanText(e.text);
  const quoted = (e.text ?? '').trim().replace(/\s+/g, ' ');
  const lines = [];
  const todos = [];

  lines.push(`// "${quoted || type}"`);
  lines.push(`// ${e.cost === 'empty' ? '' : e.cost}/${e.total_cost} ${e.power}/${e.toughness} — ${type}`);

  const body = [];

  // Ambush mode (behavior is engine-level; cost comes from printed.json)
  if (/\[Battle\]\s*Ambush/.test(e.text ?? '')) {
    lines.push('// has [Battle] Ambush — handled by the engine via printed.ambush; no behavior needed for the mode itself');
  }

  // pull the [Augment] text-box paragraph out (text transfer only, never attrs)
  let rest = text;
  const augMatch = rest.match(/\[Augment\]\s*(\[once\]\s*)?(.+)$/);
  let augmentPart = null;
  if (augMatch && !type.includes('[Augment]')) {
    augmentPart = { bounded: !!augMatch[1], text: augMatch[2] };
    rest = rest.slice(0, augMatch.index).trim();
  }

  const graftM = rest.match(/^(.*?)\[(Switch1?)\]\s*(.+)$/);
  const activatedM = !graftM && rest.match(/^([^.:]{1,60}):\s*(.+)$/);

  if (kind !== 'unit' && (rest || graftM)) {
    // spell-likes: the text is the spell effect (maybe [Switch]-marked = graftable)
    const effText = graftM ? graftM[3] : rest;
    const bounded = graftM?.[2] === 'Switch1';
    body.push(`  spellEffect: {`);
    body.push(`    // TODO: ${effText}`);
    if (/target/i.test(effText)) body.push(`    targets: { what: 'unit', prompt: '${name}: ${effText.replace(/'/g, "\\'")}' },   // TODO check what: unit|any|stackSpell`);
    body.push(`    run: (g, ctx) => { /* TODO */ },`);
    body.push(`  },`);
    if (graftM) {
      body.push(`  graftEffect: { bounded: ${bounded}, effect: /* TODO: share the spellEffect const */ undefined as never },`);
      todos.push('graftEffect shares the [Switch] effect — hoist it into a const');
    }
  } else if (graftM && kind === 'unit') {
    // "When ..., [Switch] effect" — triggered graft cause
    const clause = graftM[1].trim().replace(/,$/, '');
    const effText = graftM[3];
    const bounded = graftM[2] === 'Switch1';
    const { events, self } = guessEvents(clause);
    body.push(`  abilities: [{`);
    body.push(`    type: 'triggered', events: [${events.map(x => `'${x}'`).join(', ')}],${self ? ' self: true,' : ''}${bounded ? ' bounded: true,' : ''} graftCause: true,`);
    if (!events.length) todos.push(`could not guess events for "${clause}" — fill them in`);
    body.push(`    label: '${effText.replace(/'/g, "\\'").slice(0, 60)}',`);
    body.push(`    // TODO trigger clause: "${clause}" — add when() if it has a condition (R1: checked at event time)`);
    body.push(`    effect: { run: (g, ctx) => { /* TODO: ${effText} */ } },`);
    body.push(`  }],`);
    body.push(`  graftEffect: { bounded: ${bounded}, effect: /* TODO: share the effect const */ undefined as never },`);
    todos.push('hoist the effect into a shared const for ability + graftEffect');
  } else if (activatedM) {
    body.push(`  abilities: [{`);
    body.push(`    type: 'activated', cost: { /* TODO: "${activatedM[1]}" */ },`);
    body.push(`    label: '${activatedM[2].replace(/'/g, "\\'").slice(0, 60)}',`);
    body.push(`    effect: { run: (g, ctx) => { /* TODO: ${activatedM[2]} */ } },`);
    body.push(`  }],`);
  } else if (rest) {
    const { events, self } = guessEvents(rest);
    body.push(`  abilities: [{`);
    body.push(`    type: 'triggered', events: [${events.map(x => `'${x}'`).join(', ')}],${self ? ' self: true,' : ''}`);
    if (!events.length) todos.push(`could not guess events for "${rest.slice(0, 50)}…" — fill them in`);
    body.push(`    label: 'TODO',`);
    body.push(`    effect: { run: (g, ctx) => { /* TODO: ${rest} */ } },`);
    body.push(`  }],`);
  }

  if (augmentPart) {
    const { events, self } = guessEvents(augmentPart.text);
    body.push(`  augmentText: [{   // text-box [Augment]: transfers TEXT only, never attrs`);
    body.push(`    type: 'triggered', events: [${events.map(x => `'${x}'`).join(', ')}],${self ? ' self: true,' : ''}${augmentPart.bounded ? ' bounded: true,   // [once]' : ''}`);
    if (!events.length) todos.push(`could not guess events for augment text "${augmentPart.text.slice(0, 50)}…"`);
    body.push(`    label: '${augmentPart.text.replace(/'/g, "\\'").slice(0, 60)}',`);
    body.push(`    effect: { run: (g, ctx) => { /* TODO: ${augmentPart.text} */ } },`);
    body.push(`  }],`);
  }

  if (type.includes('[Augment]') && !text) {
    lines.push(`// type-line [Augment]: augmenting grants {${attrs.join('}, {')}} — printed.augmentAttrs handles it, no behavior needed`);
  }

  lines.push(`card('${name.replace(/'/g, "\\'")}', {${body.length ? '\n' + body.join('\n') + '\n' : ''}});`);
  if (todos.length) lines.push(...todos.map(t => `// TODO(review): ${t}`));

  // ── test stub ──
  const stub = [
    `test('${name.replace(/'/g, "\\'")}: TODO — ${text ? text.slice(0, 60).replace(/'/g, "\\'") : `${attrs.join('/') || 'vanilla'} ${e.power}/${e.toughness}`}', () => {`,
    `  const h = new Harness(TODO_SEED);`,
    `  toDeployment(h);`,
    `  // TODO: exercise the printed behavior end-to-end, then assert on state + log.`,
    `  // Oracle text: ${quoted || '(vanilla)'}`,
    `  assert.fail('unwritten per-card test — definition of done');`,
    `});`,
  ];

  return { skeleton: lines.join('\n'), stub: stub.join('\n') };
}

mkdirSync(OUT_DIR, { recursive: true });
for (const name of names) {
  const { skeleton: sk, stub } = skeleton(name);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const out = `// generated by scripts/gen-card.mjs — move the pieces, then DELETE this file\n\n`
    + `// ── registry.ts skeleton ──────────────────────────────────────────\n${sk}\n\n`
    + `// ── per-card test stub ────────────────────────────────────────────\n${stub}\n`;
  writeFileSync(join(OUT_DIR, `${slug}.ts`), out);
  console.log(`\n${'─'.repeat(70)}\n${out}`);
}
console.log(`\nWrote ${names.length} skeleton(s) to scripts/generated/. Next steps:`);
console.log('  1. move each skeleton into src/cards/registry.ts and finish the TODOs');
console.log('  2. move each test stub into the per-card suite and make it real');
console.log('  3. add nontoken cards to DECK_LIST in registry.ts');
console.log('  4. npm run check');
