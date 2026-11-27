/* CARD NOTATION — Caleb's card fields, FriendlyBot's commands, and our oracle row.
 *
 * One card field has three spellings (client/docs/card-editor.md §5):
 *
 *               on screen                 in the command              in our oracle
 *   affinity    w k  e m r g b p          the same ('' is `empty`)    l d  e m r g b p
 *   text pips   [k] [1wk]                 the same                    [d] [1ld]
 *   unit type   {Haste} Unit — Alien      {Haste} Creature — Alien    {Haste} Alien Unit
 *   other type  {Battle} Nature Spell     the same                    the same
 *
 * "Creature" is FriendlyBot's stored word and never reaches the screen. Pure: no DOM,
 * no fetch, no state; the editor page and the game server run the same functions, so
 * the road the page shows is the road the server takes.
 */

/** A field as Caleb and FriendlyBot spell it (`$modify <card>|<field>|<value>`). */
export type EditorField = 'cost' | 'total cost' | 'power' | 'toughness' | 'type' | 'text' | 'image' | 'complexity';
/** The same field as our oracle row keys it. */
export type OracleField = 'cost' | 'total_cost' | 'power' | 'toughness' | 'type' | 'text' | 'image' | 'complexity';

/** The order fields are shown, diffed and sent in. Complexity goes last: it is its own command. */
export const EDITOR_FIELDS: readonly EditorField[] =
  ['cost', 'total cost', 'power', 'toughness', 'type', 'text', 'image', 'complexity'];

export const ORACLE_FIELD: Readonly<Record<EditorField, OracleField>> = {
  'cost': 'cost', 'total cost': 'total_cost', 'power': 'power', 'toughness': 'toughness',
  'type': 'type', 'text': 'text', 'image': 'image', 'complexity': 'complexity',
};

/** One row of `data/cards/AlgomancyCards-OracleText.json` (each name maps to `[row]`). */
export interface OracleRow {
  readonly [field: string]: unknown;
  name: string;
  power: string;
  toughness: string;
  cost: string;
  total_cost: string;
  type: string;
  text: string;
  image: string;
  complexity: string;
}

/** Field → value; power and toughness are present only for a unit. */
export type EditorFields = { [F in EditorField]?: string };
export type OracleValues = { [F in OracleField]?: string };

/* -- pips ------------------------------------------------------------------ */

/** The one table of letters that differ: [ours, his]. Every other affinity letter is shared. */
const LIGHT_DARK = [['l', 'w'], ['d', 'k']] as const;
const SHARED_PIPS = 'emrgbp';
const OUR_PIPS = SHARED_PIPS + LIGHT_DARK.map(([o]) => o).join('');
const HIS_PIPS = SHARED_PIPS + LIGHT_DARK.map(([, h]) => h).join('');
const TO_HIS: Readonly<Record<string, string>> = Object.fromEntries(LIGHT_DARK.map(([o, h]) => [o, h]));
const TO_OURS: Readonly<Record<string, string>> = Object.fromEntries(LIGHT_DARK.map(([o, h]) => [h, o]));

/** No affinity: FriendlyBot's and our oracle's word for it; the screen shows an empty box. */
const NO_PIPS = 'empty';
const COLOURLESS = 'p';

const FACTION_OF_PIP: Readonly<Record<string, string>> = {
  e: 'earth', m: 'metal', r: 'fire', g: 'wood', b: 'water', l: 'light', d: 'dark', p: 'colorless',
};

const swapLetters = (s: string, map: Readonly<Record<string, string>>): string =>
  [...s].map(c => map[c] ?? c).join('');

const allIn = (letters: string, set: string): boolean => [...letters].every(c => set.includes(c));

/** Swap light/dark letters inside cost brackets only (`[d]`, `[1ld]`, `[3ll]`): a bracket is a
 * cost when every letter in it is a pip of the notation being read, so `[two]` and `[Switch1]`
 * stay as they are. */
function bracketPips(s: string, from: string, map: Readonly<Record<string, string>>): string {
  return s.replace(/\[(\d*)([a-z]+)\]/g, (whole, n: string, letters: string) =>
    allIn(letters, from) ? `[${n}${swapLetters(letters, map)}]` : whole);
}

/* -- the type line --------------------------------------------------------- */

/** Leading keywords and `[Augment]`, which sit before "Creature —" in his line and before the
 * subtypes in ours. */
const TYPE_PREFIX = /^(?:\s*(?:\{[^{}]*\}|\[Augment\]))*\s*/;
/** His unit line, with either word: `<prefix>Unit — <subtypes>` or `<prefix>Creature — <subtypes>`. */
const HIS_UNIT_LINE = /^(.*?)\b(?:Unit|Creature)\s*[—–-]\s*(.*)$/s;

/** True when our printed type line is a unit's: it ends in the word Unit. */
export function isUnitType(oracleType: string): boolean {
  return /(?:^|\s)Unit$/.test(oracleType);
}

/** Our `{Haste} Alien Unit` → [`{Haste} `, `Alien`], or null when there are no subtypes. */
function unitParts(oracleType: string): [string, string] | null {
  if (!isUnitType(oracleType)) return null;
  const body = oracleType.slice(0, -'Unit'.length);
  const prefix = TYPE_PREFIX.exec(body)?.[0] ?? '';
  const rest = body.slice(prefix.length);
  if (!rest.endsWith(' ') || rest.trim() === '') return null;
  return [prefix, rest.slice(0, -1)];
}

function typeToScreen(oracleType: string): string {
  const parts = unitParts(oracleType);
  const line = parts ? `${parts[0]}Unit — ${parts[1]}` : oracleType;
  return bracketPips(line, OUR_PIPS, TO_HIS);
}

/** His line (`Unit —` on screen, `Creature —` in a command) → ours. */
function typeToOracle(hisType: string): string {
  const line = bracketPips(hisType, HIS_PIPS, TO_OURS);
  const m = HIS_UNIT_LINE.exec(line);
  return m ? `${m[1]}${m[2]} Unit` : line;
}

function typeToCommand(screenType: string): string {
  const m = HIS_UNIT_LINE.exec(screenType);
  return m ? `${m[1]}Creature — ${m[2]}` : screenType;
}

/* -- row ↔ fields ---------------------------------------------------------- */

/** The editor's fields for a row, in his notation. */
export function editorFields(row: OracleRow): EditorFields {
  const unit = isUnitType(row.type);
  return {
    'cost': row.cost === NO_PIPS ? '' : swapLetters(row.cost, TO_HIS),
    'total cost': row.total_cost,
    ...(unit ? { 'power': row.power, 'toughness': row.toughness } : {}),
    'type': typeToScreen(row.type),
    'text': bracketPips(row.text, OUR_PIPS, TO_HIS),
    'image': row.image,
    'complexity': row.complexity,
  };
}

/** One field's value, on screen or as posted in a command, in our notation. */
function oracleValue(field: EditorField, value: string): string {
  switch (field) {
    case 'cost': return value === '' || value === NO_PIPS ? NO_PIPS : swapLetters(value, TO_OURS);
    case 'type': return typeToOracle(value);
    case 'text': return bracketPips(value, HIS_PIPS, TO_OURS);
    default: return value;
  }
}

/** On-screen fields → our oracle row's notation, for the fields given. */
export function oracleValues(fields: EditorFields): OracleValues {
  const out: OracleValues = {};
  for (const f of EDITOR_FIELDS) {
    const v = fields[f];
    if (v !== undefined) out[ORACLE_FIELD[f]] = oracleValue(f, v);
  }
  return out;
}

const SHOWN: readonly (keyof OracleRow & string)[] =
  ['name', 'cost', 'total_cost', 'power', 'toughness', 'type', 'text', 'image', 'complexity'];

/** Null when the editor may change this card, or the reason it opens read-only. */
export function editable(row: OracleRow): string | null {
  if (SHOWN.some(f => typeof row[f] !== 'string')) return "this card's record is incomplete";
  if (row.cost !== NO_PIPS && !affinityOk(row.cost, OUR_PIPS)) return "this card's affinity isn't understood yet";
  if (isUnitType(row.type) && !unitParts(row.type)) return "this card's type line isn't understood yet";
  const back = oracleValues(editorFields(row));
  const unit = isUnitType(row.type);
  for (const f of EDITOR_FIELDS) {
    if ((f === 'power' || f === 'toughness') && !unit) continue;
    const o = ORACLE_FIELD[f];
    if (back[o] !== row[o]) return "this card's notation isn't understood yet";
  }
  return null;
}

/** A pip string: only this notation's letters, and colourless never mixed with a colour. */
function affinityOk(pips: string, set: string): boolean {
  return pips !== '' && allIn(pips, set) && (!pips.includes(COLOURLESS) || allIn(pips, COLOURLESS));
}

/** The fields of `screen` that differ from what the row shows. */
export function changedFields(row: OracleRow, screen: EditorFields): EditorFields {
  const now = editorFields(row);
  const out: EditorFields = {};
  for (const f of EDITOR_FIELDS) {
    const v = screen[f];
    if (v !== undefined && v !== now[f]) out[f] = v;
  }
  return out;
}

/* -- commands -------------------------------------------------------------- */

export interface Command { text: string; field: EditorField }

/** FriendlyBot's commands for the changed fields, in field order: one `$modify` per field, and
 * complexity as `$simple`/`$complex` (it has no command for Common or Glitch). The name goes lower-case, as Caleb types it; FriendlyBot
 * matches names loosely. */
export function commandsFor(card: string, changed: EditorFields): Command[] {
  const name = card.toLowerCase();
  const out: Command[] = [];
  for (const field of EDITOR_FIELDS) {
    const v = changed[field];
    if (v === undefined) continue;
    if (field === 'complexity') {
      if (v === 'Simple' || v === 'Complex') out.push({ text: `$${v.toLowerCase()} ${name}`, field });
      continue;
    }
    const value = field === 'cost' && v === '' ? NO_PIPS : field === 'type' ? typeToCommand(v) : v;
    out.push({ text: `$modify ${name}|${field}|${value}`, field });
  }
  return out;
}

export interface ParsedCommand {
  verb: 'modify' | 'simple' | 'complex';
  /** as typed, spaces included: FriendlyBot echoes it that way */
  name: string;
  /** folded by foldField */
  field: string;
  value: string;
}

/** A field name as FriendlyBot reads it: case-insensitive, an underscore the same as a space. */
export function foldField(field: string): string {
  return field.toLowerCase().replace(/_/g, ' ');
}

/** A posted message as FriendlyBot reads it, or null for one it ignores. The verb is lower-case
 * and followed by one space (`$Modify`, `$modify|card|…` and `$modifycard|…` all go unanswered),
 * and a `$modify` has exactly three parts: nothing escapes a `|`. */
export function parseCommand(text: string): ParsedCommand | null {
  const complexity = /^\$(simple|complex) (.+)$/s.exec(text);
  if (complexity) {
    const verb = complexity[1] as 'simple' | 'complex';
    const name = complexity[2]!;
    if (name.trim() === '') return null;
    return { verb, name, field: 'complexity', value: verb === 'simple' ? 'Simple' : 'Complex' };
  }
  if (!text.startsWith('$modify ')) return null;
  const parts = text.slice('$modify '.length).split('|');
  if (parts.length !== 3) return null;
  const [name, field, value] = parts as [string, string, string];
  if (name.trim() === '' || field === '') return null;
  return { verb: 'modify', name, field: foldField(field), value };
}

/** The editor field a folded command field names, or null for one the editor does not show. */
export function editorFieldOf(field: string): EditorField | null {
  const f = foldField(field);
  return (EDITOR_FIELDS as readonly string[]).includes(f) ? f as EditorField : null;
}

/** A posted command's value in our notation, or null for a field the editor does not show. */
export function valueFromCommand(field: string, value: string): { field: OracleField; value: string } | null {
  const f = editorFieldOf(field);
  return f ? { field: ORACLE_FIELD[f], value: oracleValue(f, value) } : null;
}

/** Discord's limit on one message. */
export const MAX_COMMAND_CHARS = 2000;

const LABEL: Readonly<Record<EditorField, string>> = {
  'cost': 'Affinity', 'total cost': 'Cost', 'power': 'Power', 'toughness': 'Toughness',
  'type': 'Type', 'text': 'Text', 'image': 'Art', 'complexity': 'Complexity',
};

/** What is wrong with submitting `changed` (on-screen fields) against `row`, in a few words
 * each; empty when it may be submitted. */
export function validateEdit(row: OracleRow, changed: EditorFields): string[] {
  const locked = editable(row);
  if (locked) return [locked.replace(/^./, c => c.toUpperCase()) + '.'];
  const problems: string[] = [];
  const real = changedFields(row, changed);
  if (!EDITOR_FIELDS.some(f => real[f] !== undefined)) return ['Nothing changed.'];
  const unit = isUnitType(oracleValue('type', real.type ?? editorFields(row).type ?? ''));
  for (const f of EDITOR_FIELDS) {
    const v = real[f];
    if (v === undefined) continue;
    const label = LABEL[f];
    if (v.includes('|')) problems.push(`${label} can't contain |.`);
    if (/[\r\n]/.test(v)) problems.push(`${label} can't hold a line break: use {/n}.`);
    if ((f === 'total cost' || f === 'power' || f === 'toughness') && !/^(?:\d+|X)$/.test(v)) {
      problems.push(`${label} must be a number or X.`);
    }
    if ((f === 'power' || f === 'toughness') && !unit) problems.push('Only units have power and toughness.');
    if (f === 'cost' && v !== '' && !affinityOk(v, HIS_PIPS)) {
      problems.push(`Affinity takes only the letters ${[...HIS_PIPS].join(' ')}, and p alone.`);
    }
    if ((f === 'type' || f === 'image') && v.trim() === '') problems.push(`${label} can't be empty.`);
    if (f === 'complexity' && v !== 'Simple' && v !== 'Complex') problems.push('Complexity is Simple or Complex.');
  }
  for (const c of commandsFor(row.name, real)) {
    if (c.text.length > MAX_COMMAND_CHARS) problems.push(`${LABEL[c.field]} is too long for one Discord message.`);
  }
  return [...new Set(problems)];
}

/* -- the diff and the road ------------------------------------------------- */

export type OracleValue = string | readonly string[];

/** One field of our row that an edit changes. `to: null` is a value that cannot be worked out. */
export interface DiffEntry { field: string; from: OracleValue | null; to: OracleValue | null }

/** The row's `factions` for a pip string: each element once, in pip order, as the oracle keeps it. */
export function factionsFor(cost: string): readonly string[] | 'Unknown' {
  if (cost === NO_PIPS) return 'Unknown';
  return [...new Set([...cost].map(p => FACTION_OF_PIP[p] ?? p))];
}

const BASE_DECKS = ['Earth', 'Metal', 'Fire', 'Wood', 'Water'];
const LD_DECK = /^Light & Dark \((?:Light|Dark)(?:\/[A-Z][a-z]+)?\)$/;
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The row's `Deck` after its pips become `cost`, or null when no rule gives it. A base-set
 * card stays in one element's deck; a Light & Dark card is "Light & Dark (Light/Water)", Light
 * then Dark then the other element. "Hybrid", tokens, resources and the rest are not derived. */
export function deckFor(oldDeck: unknown, cost: string): string | null {
  const f = factionsFor(cost);
  if (f === 'Unknown' || f.includes('colorless')) return null;
  if (typeof oldDeck === 'string' && BASE_DECKS.includes(oldDeck)) {
    const only = f[0];
    return f.length === 1 && only && BASE_DECKS.includes(capital(only)) ? capital(only) : null;
  }
  if (typeof oldDeck === 'string' && LD_DECK.test(oldDeck)) {
    const rank = (e: string): number => e === 'light' ? 0 : e === 'dark' ? 1 : 2;
    const sorted = [...f].sort((a, b) => rank(a) - rank(b));
    if (sorted.length > 2 || rank(sorted[0]!) === 2) return null;
    return `Light & Dark (${sorted.map(capital).join('/')})`;
  }
  return null;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What an edit changes in our row: `after` is in our notation, so notation alone never shows.
 * An affinity change carries the new `factions` and `Deck`, which must agree with the pips. */
export function diffRow(base: OracleRow, after: OracleValues & { name?: string }): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const field of ['name', ...EDITOR_FIELDS.map(f => ORACLE_FIELD[f])] as const) {
    const to = after[field];
    const from = base[field];
    if (to !== undefined && to !== from) out.push({ field, from: typeof from === 'string' ? from : null, to });
  }
  if (after.cost !== undefined && after.cost !== base.cost) {
    const factions = factionsFor(after.cost);
    if (!same(factions, base['factions'])) {
      out.push({ field: 'factions', from: asValue(base['factions']), to: factions });
      const deck = deckFor(base['Deck'], after.cost);
      if (deck !== base['Deck']) out.push({ field: 'Deck', from: asValue(base['Deck']), to: deck });
    }
  }
  return out;
}

function asValue(v: unknown): OracleValue | null {
  return typeof v === 'string' || (Array.isArray(v) && v.every(x => typeof x === 'string')) ? v as OracleValue : null;
}

/** The fields the fast path may write without a model: numbers, affinity with its colours, art. */
const FAST_FIELDS = new Set(['power', 'toughness', 'total_cost', 'cost', 'factions', 'Deck', 'image']);

const STEWARD_WHY: Readonly<Record<string, string>> = {
  text: 'the text changed', type: 'the type line changed', name: 'the name changed',
  complexity: 'the complexity changed',
};

export type Road = 'fast' | 'steward';

/** Which road an edit takes (card-editor.md §5), with the steward's reasons. */
export function road(diff: readonly DiffEntry[]): { road: Road; why: string[] } {
  const why: string[] = [];
  for (const d of diff) {
    if (d.to === null) why.push(d.field === 'Deck' ? "its deck can't be worked out from the new affinity" : `its ${d.field} can't be worked out`);
    else if (!FAST_FIELDS.has(d.field)) why.push(STEWARD_WHY[d.field] ?? `the ${d.field} changed`);
  }
  return { road: why.length ? 'steward' : 'fast', why: [...new Set(why)] };
}

/* -- the update line -------------------------------------------------------- */

/** Our pips in words: `l` "light", `ld` "light and dark", `llr` "2 light and 1 fire". */
function affinityWords(cost: string): string {
  if (cost === NO_PIPS) return 'no';
  const counts = new Map<string, number>();
  for (const p of cost) {
    const name = p === COLOURLESS ? 'colourless' : FACTION_OF_PIP[p] ?? p;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const many = [...counts.values()].some(n => n > 1);
  return andList([...counts].map(([name, n]) => many ? `${n} ${name}` : name));
}

function andList(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** The home page's line for a fast-path edit: "Murkstalker now costs 2 (was 3)." Numbers and
 * plain words only, never an id or a path. */
export function updateLine(card: string, diff: readonly DiffEntry[]): string {
  const by = new Map(diff.map(d => [d.field, d]));
  const s = (f: string, end: 'from' | 'to'): string => String(by.get(f)?.[end] ?? '');
  const said: string[] = [];
  if (by.has('total_cost')) said.push(`now costs ${s('total_cost', 'to')} (was ${s('total_cost', 'from')})`);
  if (by.has('cost')) said.push(`now has ${affinityWords(s('cost', 'to'))} affinity (was ${affinityWords(s('cost', 'from'))})`);
  if (by.has('power') && by.has('toughness')) {
    said.push(`is now ${s('power', 'to')}/${s('toughness', 'to')} (was ${s('power', 'from')}/${s('toughness', 'from')})`);
  } else {
    for (const f of ['power', 'toughness']) if (by.has(f)) said.push(`now has ${s(f, 'to')} ${f} (was ${s(f, 'from')})`);
  }
  if (by.has('image')) said.push('has new card art');
  return said.length ? `${card} ${andList(said)}.` : `${card} has changed.`;
}

/* -- FriendlyBot's attachments -------------------------------------------- */

const ATTACHMENT_PREFIX = 'CUsersCalebPycharmProjectscardgamebot_library';

/** The stem FriendlyBot names a card's picture with: spaces as `_`, punctuation but `-` dropped
 * (`Blight's End` → `Blights_End`). Its reply names the card it changed only here. */
export function friendlyBotFileKey(card: string): string {
  return card.replace(/ /g, '_').replace(/[^A-Za-z0-9_-]/g, '');
}

/** The stem of a FriendlyBot picture's file name, or null for any other file. */
export function attachmentFileKey(filename: string): string | null {
  if (!filename.startsWith(ATTACHMENT_PREFIX) || !filename.endsWith('.jpg')) return null;
  return filename.slice(ATTACHMENT_PREFIX.length, -'.jpg'.length) || null;
}
