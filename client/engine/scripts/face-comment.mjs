/**
 * The face a card definition quotes above itself, against printed.json.
 *
 * A `card('<Name>', …)` in src/cards/sets/ usually carries, in the comment
 * block directly above it, the card's printed face: its text in quotes, then
 * `— <pips>/<mana> [<power>/<toughness>] <type line>`:
 *
 *   // "[Augment] …" — ee/2 2/3 Golem Beast Unit.
 *   // "Delete target unit. …"
 *   // bb/4 — {Battle} Maelstrom Spell.
 *
 * The engine never reads it (card() spreads printed.json into every
 * definition), so nothing else notices when it goes stale. A plain spell prints
 * no stats (extract-printed.mjs zeroes the transcription's), so a spell's face
 * that states some disagrees. A unit's face that omits them states nothing.
 *
 *   node client/engine/scripts/face-comment.mjs --check            list every disagreement; exit 1 on any
 *   node client/engine/scripts/face-comment.mjs --rewrite "<Name>" rewrite that card's face from printed.json
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ENGINE_SRC_DIR, REPO_ROOT } from './paths.mjs';
import { OUT as PRINTED_JSON } from './extract-printed.mjs';

export const SETS_DIR = join(ENGINE_SRC_DIR, 'cards', 'sets');

/** a comment line's lead-in, where a face may continue onto the next line */
const CONT = String.raw`[ \t]*\n[ \t]*(?:\/\/|\*)[ \t]*`;
const PIPS = String.raw`([rbegmld]+)\/(\d+|X)\b`;
const STATS = String.raw`(?<![+\-\w/])(\d+|X)\/(\d+|X)(?![\w/])`;
/** `— pips/mana [P/T]`: the dash may end the line and the stats may start the next */
const AFTER_DASH = new RegExp(String.raw`(—(?:${CONT}|[ \t]*))${PIPS}(?:(${CONT}|[ \t]+)${STATS})?`, 'g');
/** `pips/mana — …` at the start of a comment line, the stats never given in this order */
const BEFORE_DASH = new RegExp(String.raw`(?<=^[ \t]*(?:\/\/|\*)[ \t]*)${PIPS}(?= —)`, 'gm');

const sortPips = (s) => [...String(s ?? '')].sort().join('');
/** the kinds that print power and toughness, as dsl.ts printsStats says */
const printsStats = (kind) => kind === 'unit' || kind === 'spellUnit';

/**
 * Every `card('<Name>'` in one source, with the faces its comment block states.
 * A face: {start, end} offsets of the whole match in `src`, `lead` (the dash
 * and what follows it, '' when the dash comes after), pips, mana, and `stats`
 * {p, t, sep} when it states them (`sep`: what lies between mana and stats).
 */
export function parseFaces(src) {
  const out = [];
  const lines = src.split('\n');
  const offsets = [];
  for (let i = 0, o = 0; i < lines.length; i++) { offsets.push(o); o += lines[i].length + 1; }
  for (let i = 0; i < lines.length; i++) {
    const m = /^card\('((?:[^'\\]|\\.)+)'/.exec(lines[i]);
    if (!m) continue;
    let s = i;
    while (s > 0 && /^\s*(?:\/\/|\/\*|\*)/.test(lines[s - 1])) s--;
    const base = offsets[s], block = src.slice(base, offsets[i]);
    const faces = [];
    for (const f of block.matchAll(AFTER_DASH)) {
      faces.push({
        start: base + f.index, end: base + f.index + f[0].length, lead: f[1], pips: f[2], mana: f[3],
        ...(f[5] !== undefined ? { stats: { p: f[5], t: f[6], sep: f[4] } } : {}),
      });
    }
    for (const f of block.matchAll(BEFORE_DASH)) faces.push({ start: base + f.index, end: base + f.index + f[0].length, lead: '', pips: f[1], mana: f[2] });
    out.push({ name: m[1].replace(/\\(.)/g, '$1'), line: i + 1, faces: faces.sort((a, b) => a.start - b.start) });
  }
  return out;
}

/** what a face says that the card does not print: [] when they agree */
export function faceDisagrees(face, card) {
  const bad = [];
  if (sortPips(face.pips) !== sortPips(card.cost)) bad.push(`pips ${face.pips}, printed ${card.cost}`);
  if (String(face.mana) !== String(card.mana)) bad.push(`cost ${face.mana}, printed ${card.mana}`);
  if (face.stats) {
    if (!printsStats(card.kind)) bad.push(`stats ${face.stats.p}/${face.stats.t} on a ${card.kind}, which prints none`);
    else if (`${face.stats.p}/${face.stats.t}` !== `${card.power}/${card.toughness}`) bad.push(`stats ${face.stats.p}/${face.stats.t}, printed ${card.power}/${card.toughness}`);
  }
  return bad;
}

/** the source with every face of `name` restated from `card`; unchanged when they agree or there is none */
export function rewriteFaces(src, name, card) {
  const def = parseFaces(src).find((d) => d.name === name);
  if (!def) return src;
  let out = src;
  // right to left, so earlier offsets stay valid
  for (const f of [...def.faces].reverse()) {
    if (!faceDisagrees(f, card).length) continue;
    let next = `${f.lead}${card.cost}/${card.mana}`, end = f.end;
    if (f.stats && printsStats(card.kind)) next += `${f.stats.sep}${card.power}/${card.toughness}`;
    // stats a spell does not print go; on the next line, so does the space after them
    else if (f.stats && f.stats.sep.includes('\n')) { next += f.stats.sep; if (out[end] === ' ') end++; }
    out = out.slice(0, f.start) + next + out.slice(end);
  }
  return out;
}

export function loadPrinted() {
  return new Map(Object.values(JSON.parse(readFileSync(PRINTED_JSON, 'utf8'))).map((c) => [c.name, c]));
}

export const setFiles = () => readdirSync(SETS_DIR).filter((f) => f.endsWith('.ts')).sort().map((f) => join(SETS_DIR, f));

/** every face in every set file: {file, line, name, face, bad[]} (bad empty when it agrees) */
export function allFaces(printed = loadPrinted()) {
  const rows = [];
  for (const file of setFiles()) {
    for (const d of parseFaces(readFileSync(file, 'utf8'))) {
      const card = printed.get(d.name);
      if (!card) continue;
      for (const face of d.faces) rows.push({ file, line: d.line, name: d.name, face, bad: faceDisagrees(face, card) });
    }
  }
  return rows;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { check: { type: 'boolean' }, rewrite: { type: 'string' } } });
  const printed = loadPrinted();
  if (values.rewrite !== undefined) {
    const name = values.rewrite, card = printed.get(name);
    if (!card) { console.error(`${name} is not in printed.json`); process.exit(1); }
    const file = setFiles().find((f) => parseFaces(readFileSync(f, 'utf8')).some((d) => d.name === name));
    if (!file) { console.log(`${name}: no card() definition in src/cards/sets, nothing to rewrite`); process.exit(0); }
    const src = readFileSync(file, 'utf8'), next = rewriteFaces(src, name, card);
    const faces = parseFaces(src).find((d) => d.name === name).faces.length;
    if (next === src) console.log(`${name}: ${faces ? 'its face comment already agrees' : 'no parseable face comment, left alone'} (${relative(REPO_ROOT, file)})`);
    else { writeFileSync(file, next); console.log(`${name}: face comment rewritten to ${card.cost}/${card.mana}${printsStats(card.kind) ? ` ${card.power}/${card.toughness}` : ''} (${relative(REPO_ROOT, file)})`); }
    process.exit(0);
  }
  const rows = allFaces(printed), bad = rows.filter((r) => r.bad.length);
  for (const r of bad) console.log(`${relative(REPO_ROOT, r.file)}:${r.line} ${r.name}: ${r.bad.join('; ')}`);
  console.log(`${rows.length} face comment(s), ${bad.length} disagree with printed.json`);
  process.exit(values.check && bad.length ? 1 : 0);
}
