/* THE QUERY LANGUAGE, and why the string is the source of truth.
 *
 * The ask was "a scryfall like interface/filtering syntax ... negative
 * filtering, inclusive and exclusive searches". Two ways to build that: chips
 * and dropdowns holding the state, with a text box as a shortcut; or one query
 * STRING holding the state, with chips as an editor for it. This file is the
 * second, and the choice is load-bearing:
 *
 *  - a chip can express `e:fire`, but nothing clickable expresses
 *    `-e:fire (t:sprite OR t:demon) m<=3`, and that is the whole point;
 *  - one representation means the URL is the state, so a search is a link you
 *    can send someone;
 *  - the deck drawer and the browser page run the SAME parser over the SAME
 *    rows, so they cannot disagree about what a query means. The drawer used
 *    to own a private three-control filter (ui/decks.ts, before this); that is
 *    exactly the drift this replaces.
 *
 * TOLERANT ON PURPOSE. The bar is live: it re-runs on every keystroke, so it
 * sees `o:"draw a ca` far more often than it sees a finished query. Unclosed
 * quotes, unclosed parens and a trailing operator are all auto-closed and
 * recorded in `errors` for the UI to mention — never thrown. A query that
 * refuses to answer while you are typing it is a query bar nobody uses.
 *
 * GRAMMAR
 *   query := or
 *   or    := and ( ("OR" | "or" | "|") and )*
 *   and   := unary+                        juxtaposition is AND
 *   unary := "-"? ( "(" or ")" | term )    "-" negates a term OR a group
 *   term  := KEY OP VALUE | BARE
 *   OP    := ":" | "=" | "!=" | ">" | "<" | ">=" | "<="
 *   VALUE := word | "quoted phrase" | /regex/i | comma,separated,list
 *
 * A BARE word searches name, type line and rules text — the owner's call, and
 * what the deck drawer already did, so nothing regresses. `n:` `t:` `o:` narrow
 * it. Bare words are matched LITERALLY: ui/cardsynonyms.ts knows that
 * "deathtouch" means Deadly, but it offers that as a suggestion rather than
 * silently searching for something you did not type.
 */
import type { CardRow } from './cardindex.ts';
import { allRows } from './cardindex.ts';
import { ALL_ELEMENTS } from '../src/apply.ts';
import { ELEMENT_OF_PIP } from '../src/cards/dsl.ts';
import { KEYWORD_MEANING } from './cardsynonyms.ts';

/* ── keys ──────────────────────────────────────────────────────────────
 * One table. The parser validates against it, the facet rail renders from it
 * and the help sheet prints it, so a key can never exist in one and not the
 * others. */

export type FieldKind = 'text' | 'number' | 'enum' | 'list' | 'element' | 'pips' | 'flag';

export interface KeyDef {
  /** the canonical spelling, which is what stringify emits */
  key: string;
  aliases: string[];
  kind: FieldKind;
  /** one line for the help sheet */
  help: string;
  /** an example that actually returns something */
  example: string;
  /** enum/list keys: the values that mean anything */
  values?: readonly string[];
}

export const KEYS: readonly KeyDef[] = [
  { key: 'name', aliases: ['n'], kind: 'text', help: 'the card name', example: 'name:sprite' },
  { key: 'text', aliases: ['o', 'oracle'], kind: 'text', help: 'printed rules text', example: 'o:"when I die"' },
  { key: 'type', aliases: ['t'], kind: 'text', help: 'the whole type line, subtypes included', example: 't:demon' },
  { key: 'sub', aliases: ['st', 'subtype'], kind: 'list', help: 'one printed subtype', example: 'sub:sprite' },
  { key: 'super', aliases: ['supertype'], kind: 'enum', help: 'Unit / Spell / Spell Unit / …', example: 'super:"spell unit"' },
  { key: 'el', aliases: ['e', 'f', 'faction', 'color', 'colour', 'c'], kind: 'element', help: 'element identity — see the operators', example: 'el<=fire,wood' },
  { key: 'pip', aliases: ['pips', 'affinity'], kind: 'pips', help: 'the affinity pips demanded', example: 'pip>=2' },
  { key: 'mana', aliases: ['m', 'mv', 'cmc'], kind: 'number', help: 'printed mana value (or X)', example: 'mana<=2' },
  { key: 'pow', aliases: ['p', 'power'], kind: 'number', help: 'printed power', example: 'pow>=5' },
  { key: 'tou', aliases: ['toughness', 'def'], kind: 'number', help: 'printed toughness', example: 'tou<2' },
  { key: 'pt', aliases: [], kind: 'number', help: 'power plus toughness', example: 'pt>=8' },
  { key: 'kind', aliases: ['k'], kind: 'enum', help: 'unit / spell / spellunit / spelltoken', example: 'kind:spellunit', values: ['unit', 'spell', 'spellunit', 'spelltoken'] },
  { key: 'timing', aliases: [], kind: 'enum', help: 'deploy / battle / haste', example: 'timing:battle', values: ['deploy', 'battle', 'haste'] },
  { key: 'attr', aliases: ['a'], kind: 'list', help: 'a printed attribute', example: 'attr:flying' },
  { key: 'aug', aliases: ['augmentattr'], kind: 'list', help: 'an attribute granted when augmenting', example: 'aug:swift' },
  { key: 'kw', aliases: ['keyword'], kind: 'list', help: 'any keyword: attributes plus mechanics', example: 'kw:virus' },
  { key: 'set', aliases: ['deck', 's'], kind: 'text', help: 'the printed deck a card ships in', example: 'set:"light & dark"' },
  { key: 'rarity', aliases: ['r', 'complexity'], kind: 'enum', help: 'simple / common / complex / glitch', example: 'rarity:complex', values: ['simple', 'common', 'complex', 'glitch'] },
  { key: 'class', aliases: ['cls'], kind: 'enum', help: 'card / token / resource / marker / help / exclusive / all', example: 'class:token', values: ['card', 'token', 'resource', 'marker', 'help', 'exclusive', 'all'] },
  { key: 'creates', aliases: ['makes'], kind: 'list', help: 'a token this card creates', example: 'creates:fireball' },
  { key: 'copies', aliases: [], kind: 'number', help: 'copies in the open deck (deckbuilding)', example: 'copies>=1' },
  { key: 'is', aliases: ['has'], kind: 'flag', help: 'a yes/no property — see the list', example: 'is:vanilla' },
  { key: 'in', aliases: [], kind: 'enum', help: 'deck / maybe (deckbuilding)', example: '-in:deck', values: ['deck', 'maybe', 'any'] },
];

const BY_KEY = new Map<string, KeyDef>();
for (const d of KEYS) {
  BY_KEY.set(d.key, d);
  for (const a of d.aliases) BY_KEY.set(a, d);
}

/** `sort:` / `dir:` / `view:` are parsed but do not filter — the query string
 * carries the whole page's state so a link restores it. */
export const SORTS = ['name', 'mana', 'pow', 'tou', 'element', 'kind', 'set', 'rarity', 'relevance'] as const;
export type SortKey = typeof SORTS[number];
export const VIEWS = ['grid', 'list', 'text'] as const;
export type ViewKey = typeof VIEWS[number];
const DISPLAY_KEYS = new Set(['sort', 'order', 'dir', 'direction', 'view']);

/* ── the yes/no properties ─────────────────────────────────────────────
 * Derived from the row, listed once, so `is:` autocompletes and the help sheet
 * and the facet rail read the same list the evaluator uses. */

export interface FlagDef { flag: string; help: string; test: (r: CardRow, ctx: Ctx) => boolean }

export const FLAGS: readonly FlagDef[] = [
  { flag: 'unit', help: 'a unit', test: r => r.kind === 'unit' },
  { flag: 'spell', help: 'a spell (not a spell unit)', test: r => r.kind === 'spell' },
  { flag: 'spellunit', help: 'both a spell and a unit', test: r => r.kind === 'spellUnit' },
  { flag: 'token', help: 'a token', test: r => r.cls === 'token' },
  { flag: 'resource', help: 'a resource face', test: r => r.cls === 'resource' },
  { flag: 'marker', help: 'an effect or stolen-card marker', test: r => r.cls === 'marker' },
  { flag: 'help', help: 'a reference card from the box', test: r => r.cls === 'help' },
  { flag: 'exclusive', help: 'a Kickstarter exclusive', test: r => r.cls === 'exclusive' },
  { flag: 'playable', help: 'deck-legal: you can build with it', test: r => r.playable },
  { flag: 'scripted', help: 'the engine implements it', test: r => r.scripted },
  { flag: 'mono', help: 'exactly one element', test: r => r.factions.length === 1 },
  { flag: 'hybrid', help: 'two or more elements', test: r => r.factions.length > 1 },
  { flag: 'colorless', help: 'no element at all', test: r => r.factions.length === 0 },
  { flag: 'virus', help: 'printed {Virus}', test: r => r.virus },
  { flag: 'burst', help: 'printed {Burst}', test: r => r.burst },
  { flag: 'unstable', help: 'printed {Unstable}', test: r => r.unstable },
  { flag: 'augment', help: 'an [Augment] card', test: r => r.keywords.includes('augment') },
  { flag: 'graft', help: 'graftable — it prints a [Switch]', test: r => r.keywords.includes('graft') },
  { flag: 'ambush', help: 'has an Ambush play mode', test: r => r.ambush },
  { flag: 'prophecy', help: 'prints a Prophecy banner', test: r => r.prophecy },
  { flag: 'discardme', help: 'has a "Discard me" play mode', test: r => r.discardMe },
  { flag: 'debt', help: 'prints a [Gain N debt] cost', test: r => r.gainDebt },
  { flag: 'battle', help: 'playable during battle', test: r => r.timing === 'battle' },
  { flag: 'haste', help: 'printed {Haste}', test: r => r.timing === 'haste' },
  { flag: 'deploy', help: 'deployment timing only', test: r => r.timing === 'deploy' },
  { flag: 'x', help: 'an X cost', test: r => r.isX },
  { flag: 'vanilla', help: 'no rules text at all', test: r => r.vanilla },
  { flag: 'transform', help: 'transforms into another face', test: r => !!r.transforms },
  { flag: 'tokenmaker', help: 'creates a token', test: r => r.creates.length > 0 },
  { flag: 'provisional', help: 'transcribed from pre-release art', test: r => r.provisional },
  { flag: 'arted', help: 'has a card scan', test: r => r.hasArt },
  { flag: 'rulings', help: 'carries a recorded ruling', test: r => r.rulings > 0 },
  { flag: 'deck', help: 'in the open deck (deckbuilding)', test: (r, c) => (c.copies?.(r.name) ?? 0) > 0 },
  { flag: 'maybe', help: 'on the maybeboard (deckbuilding)', test: (r, c) => (c.maybe?.(r.name) ?? 0) > 0 },
];
const FLAG_BY_NAME = new Map(FLAGS.map(f => [f.flag, f]));

/* ── the AST ───────────────────────────────────────────────────────────── */

export type Op = ':' | '=' | '!=' | '>' | '<' | '>=' | '<=';

export interface Term { key: string; op: Op; value: string; raw: string; negated: boolean }

export type Node =
  | { t: 'all' }
  | { t: 'term'; term: Term }
  | { t: 'and'; kids: Node[] }
  | { t: 'or'; kids: Node[] }
  | { t: 'not'; kid: Node };

export interface SearchError { at: number; message: string }

export interface Query {
  src: string;
  node: Node;
  sort: SortKey;
  dir: 'asc' | 'desc';
  view: ViewKey;
  /** display terms as typed, so stringify can put them back */
  display: string[];
  errors: SearchError[];
  /** true when any bare word was used — relevance sorting only means something then */
  hasBare: boolean;
}

/** What the deck page lends the evaluator so `in:` / `copies:` can answer. */
export interface Ctx {
  copies?: (name: string) => number;
  maybe?: (name: string) => number;
}

/* ── tokenizer ─────────────────────────────────────────────────────────── */

interface Tok { t: 'word' | 'or' | 'lparen' | 'rparen' | 'not'; s: string; at: number }

/** Read one token's worth of text, respecting "quotes" and /regexes/ so a
 * phrase with spaces is one token. Returns the raw slice and where it ended. */
function readWord(src: string, i: number, errors: SearchError[]): { s: string; end: number } {
  let out = '';
  let quote: '"' | "'" | null = null;
  let regex = false;
  const start = i;
  while (i < src.length) {
    const ch = src[i]!;
    if (quote) {
      if (ch === quote) { quote = null; i++; continue; }
      out += ch; i++; continue;
    }
    if (regex) {
      out += ch;
      if (ch === '/' && src[i - 1] !== '\\') { regex = false; }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
    if (ch === '/' && (out === '' || /[:=<>!]$/.test(out))) { regex = true; out += ch; i++; continue; }
    if (/\s/.test(ch) || ch === '(' || ch === ')') break;
    out += ch;
    i++;
  }
  if (quote) errors.push({ at: start, message: 'unclosed quote — closed it for you' });
  if (regex) errors.push({ at: start, message: 'unclosed /regex/ — closed it for you' });
  return { s: out, end: i };
}

function tokenize(src: string, errors: SearchError[]): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(') { toks.push({ t: 'lparen', s: '(', at: i }); i++; continue; }
    if (ch === ')') { toks.push({ t: 'rparen', s: ')', at: i }); i++; continue; }
    if (ch === '|') { toks.push({ t: 'or', s: 'OR', at: i }); i++; continue; }
    // a leading "-" negates whatever comes next, term or group
    if (ch === '-' && i + 1 < src.length && !/[\s)]/.test(src[i + 1]!)) {
      toks.push({ t: 'not', s: '-', at: i });
      i++;
      continue;
    }
    const at = i;
    const { s, end } = readWord(src, i, errors);
    i = end === i ? i + 1 : end;
    if (!s) continue;
    if (/^(or)$/i.test(s)) { toks.push({ t: 'or', s: 'OR', at }); continue; }
    if (/^(and)$/i.test(s)) continue;      // juxtaposition already means AND
    toks.push({ t: 'word', s, at });
  }
  return toks;
}

const TERM_RE = /^([A-Za-z]+)(>=|<=|!=|:|=|>|<)([\s\S]*)$/;

function toTerm(word: string, at: number, errors: SearchError[]): Term | null {
  const m = TERM_RE.exec(word);
  if (!m) return { key: '', op: ':', value: word, raw: word, negated: false };
  const [, rawKey, op, value] = m as unknown as [string, string, Op, string];
  const key = rawKey.toLowerCase();
  if (DISPLAY_KEYS.has(key)) return null;      // handled by the caller
  const def = BY_KEY.get(key);
  if (!def) {
    errors.push({ at, message: `unknown filter "${rawKey}:" — try ${nearestKey(key)}` });
    // treat it as a bare word rather than dropping the user's typing on the floor
    return { key: '', op: ':', value: word, raw: word, negated: false };
  }
  if (value === '') {
    errors.push({ at, message: `"${rawKey}${op}" has nothing after it` });
    return null;
  }
  // A value that LOOKS like a regex and will not compile falls through to a
  // literal substring search, which finds nothing and explains nothing. Say so
  // here, at parse time, rather than leaving an empty result to be puzzled at.
  if (/^\/.*\/[a-z]*$/s.test(value) && asRegex(value) === null) {
    errors.push({ at, message: `${JSON.stringify(value)} is not a valid regex — searching for it literally` });
  }
  return { key: def.key, op, value, raw: word, negated: false };
}

/** The closest key by shared prefix, for the error message. Cheap and enough. */
function nearestKey(key: string): string {
  let best = KEYS[0]!.key;
  let bestScore = -1;
  for (const d of KEYS) {
    for (const cand of [d.key, ...d.aliases]) {
      let n = 0;
      while (n < cand.length && n < key.length && cand[n] === key[n]) n++;
      if (n > bestScore) { bestScore = n; best = d.key; }
    }
  }
  return `${best}:`;
}

/* ── parser ────────────────────────────────────────────────────────────── */

export function parseQuery(src: string): Query {
  const errors: SearchError[] = [];
  const display: string[] = [];
  let sort: SortKey | null = null;
  let dir: 'asc' | 'desc' | null = null;
  let view: ViewKey = 'grid';
  let hasBare = false;

  const toks = tokenize(src, errors);
  let p = 0;

  const parseOr = (): Node => {
    const kids = [parseAnd()];
    while (p < toks.length && toks[p]!.t === 'or') { p++; kids.push(parseAnd()); }
    return kids.length === 1 ? kids[0]! : { t: 'or', kids };
  };

  const parseAnd = (): Node => {
    const kids: Node[] = [];
    while (p < toks.length && toks[p]!.t !== 'or' && toks[p]!.t !== 'rparen') {
      const n = parseUnary();
      if (n) kids.push(n);
    }
    if (!kids.length) return { t: 'all' };
    return kids.length === 1 ? kids[0]! : { t: 'and', kids };
  };

  const parseUnary = (): Node | null => {
    const tok = toks[p]!;
    if (tok.t === 'not') {
      p++;
      if (p >= toks.length) { errors.push({ at: tok.at, message: 'a "-" with nothing after it' }); return null; }
      const kid = parseUnary();
      return kid ? { t: 'not', kid } : null;
    }
    if (tok.t === 'lparen') {
      p++;
      const inner = parseOr();
      if (p < toks.length && toks[p]!.t === 'rparen') p++;
      else errors.push({ at: tok.at, message: 'unclosed "(" — closed it at the end' });
      return inner;
    }
    p++;
    // display terms come out of the stream entirely
    const m = TERM_RE.exec(tok.s);
    if (m && DISPLAY_KEYS.has(m[1]!.toLowerCase())) {
      const k = m[1]!.toLowerCase();
      const v = m[3]!.toLowerCase();
      if (k === 'sort') {
        if ((SORTS as readonly string[]).includes(v)) { sort = v as SortKey; display.push(tok.s); }
        else errors.push({ at: tok.at, message: `sort: must be one of ${SORTS.join(', ')}` });
      } else if (k === 'view') {
        if ((VIEWS as readonly string[]).includes(v)) { view = v as ViewKey; display.push(tok.s); }
        else errors.push({ at: tok.at, message: `view: must be one of ${VIEWS.join(', ')}` });
      } else {
        if (v === 'asc' || v === 'desc') { dir = v; display.push(tok.s); }
        else errors.push({ at: tok.at, message: 'dir: must be asc or desc' });
      }
      return null;
    }
    const term = toTerm(tok.s, tok.at, errors);
    if (!term) return null;
    if (!term.key) hasBare = true;
    return { t: 'term', term };
  };

  const node = toks.length ? parseOr() : { t: 'all' as const };
  if (p < toks.length) errors.push({ at: toks[p]!.at, message: 'a ")" with no "(" before it' });

  return {
    src,
    node,
    sort: sort ?? (hasBare ? 'relevance' : 'name'),
    dir: dir ?? 'asc',
    view,
    display,
    errors,
    hasBare,
  };
}

/* ── evaluation ────────────────────────────────────────────────────────── */

const num = (s: string): number | null => {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function cmp(op: Op, a: number, b: number): boolean {
  switch (op) {
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '!=': return a !== b;
    default: return a === b;
  }
}

/**
 * `/re/` as typed, or null when the value is a plain string.
 *
 * ALWAYS CASE-INSENSITIVE, and the trailing flags are accepted and ignored:
 * every other matcher here folds case, and a regex that alone respected it
 * would make `name:/sprite/` and `name:sprite` disagree for no reason a user
 * could see. Writing `/i` is therefore allowed and redundant rather than
 * wrong. (This started as `flags.includes('i') ? 'i' : 'i'`, which read like
 * it honoured the flag and did not.)
 */
function asRegex(value: string): RegExp | null {
  const m = /^\/(.*)\/([a-z]*)$/s.exec(value);
  if (!m) return null;
  try { return new RegExp(m[1]!, 'i'); } catch { return null; }
}

function textMatch(op: Op, hayLc: string, hayRaw: string, value: string): boolean {
  const re = asRegex(value);
  if (re) return op === '!=' ? !re.test(hayRaw) : re.test(hayRaw);
  const v = value.toLowerCase();
  switch (op) {
    case '=': return hayLc === v;
    case '!=': return hayLc !== v;
    default: return hayLc.includes(v);
  }
}

function listMatch(op: Op, list: string[], value: string): boolean {
  const re = asRegex(value);
  const v = value.toLowerCase();
  const hit = re
    ? list.some(x => re.test(x))
    : op === '='
      ? list.includes(v)
      // a prefix match so `attr:fly` finds Flying while you are still typing
      : list.some(x => x === v || x.startsWith(v));
  return op === '!=' ? !hit : hit;
}

/**
 * The element a single letter names.
 *
 * The seven PRINTED pips first (`ELEMENT_OF_PIP`), then the letters a person
 * reaches for that no pip uses. Only `f` for fire so far, and the owner's
 * reason is the general rule: *"Making wood/water into G and B makes sense,
 * but fire doesn't need to just be 'r'."* — b and g are taken by water and
 * wood, so fire had to give up r, but nothing is competing for f.
 *
 * ⚠ `w` IS NOT HERE, and must not be: water and wood both want it, and a
 * letter that silently picks one of two elements is worse than a letter that
 * does nothing. Write the word.
 */
const EXTRA_LETTERS: Record<string, string> = { f: 'fire' };
export const elementForLetter = (ch: string): string | undefined =>
  (ELEMENT_OF_PIP as Record<string, string>)[ch] ?? EXTRA_LETTERS[ch];

/** Element words, pip letters, or a comma list of either. Returns null when
 * the value is one of the special words (mono/hybrid/none), which the caller
 * turns into a flag instead. */
export function parseElements(value: string): string[] | null {
  const v = value.toLowerCase().trim();
  if (['mono', 'hybrid', 'multi', 'none', 'colorless', 'colourless'].includes(v)) return null;
  const parts = v.includes(',') ? v.split(',') : [v];
  const out: string[] = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if ((ALL_ELEMENTS as readonly string[]).includes(p)) { out.push(p); continue; }
    // not an element name — read it as a run of pip letters ("rg", "ll")
    for (const ch of p) {
      const el = elementForLetter(ch);
      if (el) out.push(el);
    }
  }
  return [...new Set(out)];
}

/**
 * Element identity, with Scryfall's operators, because they are the vocabulary
 * that makes this useful for deckbuilding:
 *
 *   el:fire        has fire
 *   el:fire,wood   has fire AND wood
 *   el=fire,wood   is exactly fire+wood
 *   el<=fire,wood  fits inside a fire/wood deck  (the deckbuilding one)
 *   el>=fire       superset of fire  (same as `:`)
 */
function elementMatch(op: Op, have: string[], value: string): boolean {
  const v = value.toLowerCase().trim();
  if (v === 'mono') return have.length === 1;
  if (v === 'hybrid' || v === 'multi') return have.length > 1;
  if (v === 'none' || v === 'colorless' || v === 'colourless') return have.length === 0;
  const want = parseElements(value) ?? [];
  const has = new Set(have);
  switch (op) {
    case '=': return have.length === want.length && want.every(e => has.has(e));
    case '!=': return !want.every(e => has.has(e));
    case '<': return have.every(e => want.includes(e)) && have.length < want.length;
    case '<=': return have.every(e => want.includes(e));
    default: return want.every(e => has.has(e));   // ':' and '>=' and '>'
  }
}

/** Pips, over the same operators: a count when the value is a number, a
 * multiset of pip letters otherwise. `pip<=rrg` is "castable off two fire and
 * one wood". */
function pipMatch(op: Op, row: CardRow, value: string): boolean {
  const n = num(value);
  if (n !== null) return cmp(op, row.pipCount, n);
  const want: Record<string, number> = {};
  for (const el of parseElements(value) ?? []) want[el] = 0;
  for (const ch of value.toLowerCase()) {
    const el = elementForLetter(ch);
    if (el) want[el] = (want[el] ?? 0) + 1;
  }
  const have = row.pips;
  const els = new Set([...Object.keys(want), ...Object.keys(have)]);
  switch (op) {
    case '=': return [...els].every(e => (have[e] ?? 0) === (want[e] ?? 0));
    case '!=': return ![...els].every(e => (have[e] ?? 0) >= (want[e] ?? 0));
    case '<':
    case '<=': return [...els].every(e => (have[e] ?? 0) <= (want[e] ?? 0));
    default: return [...els].every(e => (have[e] ?? 0) >= (want[e] ?? 0));
  }
}

/**
 * `kw:` asks about keywords by NAME first, and only falls back to what they
 * MEAN when the name matches nothing.
 *
 * `kw:virus` is a name and answers exactly. `kw:trample` is not a keyword this
 * game has, so it searches the meanings and finds Piercing — which is also the
 * only way to find the one {Thieving} card by "draws a card", since that card
 * never prints the word "draw". The order matters: meanings first would make
 * `kw:damage` return half the pool.
 */
function keywordMatch(op: Op, r: CardRow, value: string): boolean {
  const v = value.toLowerCase();
  const isAKeywordName = Object.keys(KEYWORD_MEANING).some(k => k === v || k.startsWith(v));
  if (isAKeywordName || asRegex(value)) return listMatch(op, r.keywords, value);
  const hit = r.keywords.some(k => (KEYWORD_MEANING[k] ?? '').includes(v));
  return op === '!=' ? !hit : hit;
}

function numberField(key: string, r: CardRow): number {
  switch (key) {
    case 'mana': return r.mana;
    case 'pow': return r.power;
    case 'tou': return r.toughness;
    case 'pt': return r.power + r.toughness;
    default: return 0;
  }
}

function termMatch(term: Term, r: CardRow, ctx: Ctx): boolean {
  const { key, op, value } = term;
  switch (key) {
    case '':
      // a bare word: name, type line, or rules text
      return textMatch(op, r.nameLc, r.name, value)
        || textMatch(op, r.typeLc, r.type, value)
        || textMatch(op, r.textLc, r.text, value);
    case 'name': return textMatch(op, r.nameLc, r.name, value);
    case 'text': return textMatch(op, r.textLc, r.text, value);
    case 'type': return textMatch(op, r.typeLc, r.type, value);
    case 'sub': return listMatch(op, r.subtypesLc, value);
    case 'super': return textMatch(op === ':' ? '=' : op, r.supertype.toLowerCase(), r.supertype, value);
    case 'el': return elementMatch(op, r.factions, value);
    case 'pip': return pipMatch(op, r, value);
    case 'mana': {
      if (/^x$/i.test(value)) return op === '!=' ? !r.isX : r.isX;
      const n = num(value);
      // an X card has no mana value; it must not sneak into `mana<=2`
      if (n === null) return false;
      return !r.isX && cmp(op, r.mana, n);
    }
    case 'pow':
    case 'tou':
    case 'pt': {
      const n = num(value);
      return n === null ? false : cmp(op, numberField(key, r), n);
    }
    case 'kind': {
      const v = value.toLowerCase().replace(/[\s_-]/g, '');
      const have = r.kind.toLowerCase();
      return op === '!=' ? have !== v : have === v;
    }
    case 'timing': {
      const v = value.toLowerCase();
      return op === '!=' ? r.timing !== v : r.timing === v;
    }
    case 'attr': return listMatch(op, r.attrsLc, value);
    case 'aug': return listMatch(op, r.augmentAttrsLc, value);
    case 'kw': return keywordMatch(op, r, value);
    case 'set': return textMatch(op, r.setLc, r.set, value);
    case 'rarity': return textMatch(op === ':' ? '=' : op, r.complexityLc, r.complexity, value);
    // `class:all` is the OFF SWITCH for the implicit filter below, so it has to
    // be a term that matches everything rather than a class nothing has
    case 'class': return value.toLowerCase() === 'all' ? op !== '!=' : textMatch(op === ':' ? '=' : op, r.cls, r.cls, value);
    case 'creates': return listMatch(op, r.creates.map(c => c.toLowerCase()), value);
    case 'copies': {
      const n = num(value);
      return n === null ? false : cmp(op, ctx.copies?.(r.name) ?? 0, n);
    }
    case 'in': {
      const v = value.toLowerCase();
      const inDeck = (ctx.copies?.(r.name) ?? 0) > 0;
      const inMaybe = (ctx.maybe?.(r.name) ?? 0) > 0;
      const hit = v === 'deck' ? inDeck : v === 'maybe' ? inMaybe : inDeck || inMaybe;
      return op === '!=' ? !hit : hit;
    }
    case 'is': {
      const f = FLAG_BY_NAME.get(value.toLowerCase().replace(/[\s_-]/g, ''));
      if (!f) return false;
      const hit = f.test(r, ctx);
      return op === '!=' ? !hit : hit;
    }
    default: return false;
  }
}

export function matches(node: Node, r: CardRow, ctx: Ctx = {}): boolean {
  switch (node.t) {
    case 'all': return true;
    case 'term': return termMatch(node.term, r, ctx);
    case 'not': return !matches(node.kid, r, ctx);
    case 'and': return node.kids.every(k => matches(k, r, ctx));
    case 'or': return node.kids.some(k => matches(k, r, ctx));
  }
}

/* ── sorting ───────────────────────────────────────────────────────────── */

const ELEMENT_ORDER = new Map<string, number>(ALL_ELEMENTS.map((e, i) => [e as string, i]));
const KIND_ORDER = new Map([['unit', 0], ['spellUnit', 1], ['spell', 2], ['spellToken', 3]]);
const RARITY_ORDER = new Map([['common', 0], ['simple', 1], ['complex', 2], ['glitch', 3]]);

/** How well a row answers the BARE words in a query: an exact name beats a
 * name that starts with it, which beats a name that contains it, which beats
 * a hit that is only in the type line or the rules text. Ties fall back to
 * name, so the order is total and a result list never shuffles under you. */
export function relevance(q: Query, r: CardRow): number {
  let score = 0;
  for (const w of bareWords(q.node)) {
    const v = w.toLowerCase();
    if (r.nameLc === v) score += 100;
    else if (r.nameLc.startsWith(v)) score += 60;
    else if (r.nameLc.includes(v)) score += 40;
    else if (r.typeLc.includes(v)) score += 15;
    else if (r.textLc.includes(v)) score += 5;
  }
  // a card you can actually build with is a better answer than a token
  if (r.playable) score += 2;
  return score;
}

function bareWords(node: Node, out: string[] = []): string[] {
  if (node.t === 'term') { if (!node.term.key) out.push(node.term.value); }
  else if (node.t === 'not') bareWords(node.kid, out);
  else if (node.t === 'and' || node.t === 'or') for (const k of node.kids) bareWords(k, out);
  return out;
}

export function sortRows(q: Query, rows: CardRow[]): CardRow[] {
  const sign = q.dir === 'desc' ? -1 : 1;
  const byName = (a: CardRow, b: CardRow): number => a.name.localeCompare(b.name);
  const key = (r: CardRow): number => {
    switch (q.sort) {
      case 'mana': return r.isX ? 99 : r.mana;
      case 'pow': return r.power;
      case 'tou': return r.toughness;
      case 'element': return r.factions.length === 0 ? 99
        : r.factions.length > 1 ? 50 + (ELEMENT_ORDER.get(r.factions[0]!) ?? 0)
          : (ELEMENT_ORDER.get(r.factions[0]!) ?? 0);
      case 'kind': return KIND_ORDER.get(r.kind) ?? 9;
      case 'rarity': return RARITY_ORDER.get(r.complexityLc) ?? 9;
      case 'relevance': return -relevance(q, r);
      default: return 0;
    }
  };
  const out = [...rows];
  if (q.sort === 'name') return out.sort((a, b) => sign * byName(a, b));
  if (q.sort === 'set') return out.sort((a, b) => sign * (a.set.localeCompare(b.set) || byName(a, b)));
  return out.sort((a, b) => sign * (key(a) - key(b)) || byName(a, b));
}

/* ── the implicit class filter ─────────────────────────────────────────
 *
 * 483 of the 537 printed things are cards you could put in a deck. The other
 * 54 are help charts, resource faces, effect markers and one engine-internal
 * attribute carrier, and they are what you want roughly never — so the browser
 * filters to `class:card` unless you say otherwise.
 *
 * IT IS NOT IN THE QUERY BOX. It was, and the owner's call on 2026-08-28 was
 * that it should not be: *"I expect people to want to see that list 95% of the
 * time. Then changing the search will be how they show the other stuff. It's
 * also annoying that clearing the search needs to put it back in."* Clearing
 * the box now means "the cards", which is what clearing a card search should
 * mean.
 *
 * SAYING OTHERWISE means mentioning class at all, anywhere in the query:
 * `class:token`, `-class:card`, `class:all`, or the `is:` flag for a class
 * (`is:help`). Any of those and the implicit term is not added — so a query
 * about classes is never silently intersected with one particular class, which
 * is the failure mode that makes a hidden default infuriating.
 */
const CLASS_FLAGS = new Set(['card', 'token', 'resource', 'marker', 'help', 'exclusive']);

const IMPLICIT_CARDS: Node = {
  t: 'term',
  term: { key: 'class', op: ':', value: 'card', raw: 'class:card', negated: false },
};

/** Does this query say anything about class? */
export function mentionsClass(node: Node): boolean {
  switch (node.t) {
    case 'term':
      return node.term.key === 'class'
        || (node.term.key === 'is' && CLASS_FLAGS.has(node.term.value.toLowerCase()));
    case 'not': return mentionsClass(node.kid);
    case 'and':
    case 'or': return node.kids.some(k => mentionsClass(k));
    default: return false;
  }
}

/** The node actually evaluated: the query, plus the implicit filter when the
 * query has not opinion about class. `matches()` stays literal on purpose —
 * the default belongs to the BROWSER, not to the language. */
export function effectiveNode(q: Query): Node {
  if (mentionsClass(q.node)) return q.node;
  return q.node.t === 'all' ? IMPLICIT_CARDS : { t: 'and', kids: [q.node, IMPLICIT_CARDS] };
}

/* ── the one entry point ───────────────────────────────────────────────── */

export interface SearchResult {
  query: Query;
  rows: CardRow[];
  /** true when the implicit `class:card` was applied — the UI mentions it in
   * one dim line so a narrowed count is never a silent one */
  implicitCards: boolean;
  /** how many rows matched, which is `rows.length` — kept because the UI says
   * it out loud and a caller that slices must not report the slice */
  total: number;
}

/**
 * Run a query string over the pool.
 *
 * `pool` defaults to everything the index knows. The implicit `class:card`
 * above is applied here unless the query mentions class; pass
 * `implicit: false` to evaluate the query exactly as written.
 */
export function search(
  src: string,
  opts: { pool?: CardRow[]; ctx?: Ctx; implicit?: boolean } = {},
): SearchResult {
  const query = parseQuery(src);
  const pool = opts.pool ?? allRows();
  const ctx = opts.ctx ?? {};
  const implicitCards = opts.implicit !== false && !mentionsClass(query.node);
  const node = implicitCards ? effectiveNode(query) : query.node;
  const hits = pool.filter(r => matches(node, r, ctx));
  return { query, rows: sortRows(query, hits), total: hits.length, implicitCards };
}

/* ── writing a query back out ──────────────────────────────────────────── */

/** Quote a value if it needs it, so round-tripping a chip is stable. */
export const quoteValue = (v: string): string => (/[\s()"]/.test(v) ? `"${v}"` : v);

export function stringifyNode(node: Node): string {
  switch (node.t) {
    case 'all': return '';
    case 'term': return node.term.raw;
    case 'not': {
      const inner = stringifyNode(node.kid);
      return node.kid.t === 'and' || node.kid.t === 'or' ? `-(${inner})` : `-${inner}`;
    }
    case 'and': return node.kids.map(k => (k.t === 'or' ? `(${stringifyNode(k)})` : stringifyNode(k))).join(' ');
    case 'or': return node.kids.map(stringifyNode).join(' OR ');
  }
}

export function stringifyQuery(q: Query): string {
  return [stringifyNode(q.node), ...q.display].filter(Boolean).join(' ').trim();
}

/* ── chips: editing the string without losing what was typed ───────────── */

export type ChipState = 'on' | 'off' | null;

/** Where a `key:value` sits in the source, at the TOP level of the query.
 * Nested terms are deliberately invisible to the chips: a chip that silently
 * reached inside a parenthesised OR would rewrite a query the user built by
 * hand into one that means something else. */
function findTopLevel(src: string, key: string, value: string): { start: number; end: number; negated: boolean } | null {
  const def = BY_KEY.get(key);
  const canon = def?.key ?? key;
  const errors: SearchError[] = [];
  const toks = tokenize(src, errors);
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i]!;
    if (tk.t === 'lparen') { depth++; continue; }
    if (tk.t === 'rparen') { depth--; continue; }
    if (depth !== 0 || tk.t !== 'word') continue;
    const m = TERM_RE.exec(tk.s);
    if (!m) continue;
    if ((BY_KEY.get(m[1]!.toLowerCase())?.key ?? m[1]!.toLowerCase()) !== canon) continue;
    // THE OPERATOR HAS TO MATCH TOO. A chip writes `key:value` and means
    // exactly that; `mana<=3` is a different question, and lighting the "3"
    // chip for it told the user their range filter was an equality filter —
    // and clicking it would then have deleted the range.
    if (m[2] !== ':') continue;
    if (m[3]!.replace(/^["']|["']$/g, '').toLowerCase() !== value.toLowerCase()) continue;
    const neg = i > 0 && toks[i - 1]!.t === 'not';
    return { start: neg ? toks[i - 1]!.at : tk.at, end: tk.at + tk.s.length, negated: neg };
  }
  return null;
}

export function chipState(src: string, key: string, value: string): ChipState {
  const at = findTopLevel(src, key, value);
  return at ? (at.negated ? 'off' : 'on') : null;
}

/** True when the query has a top-level OR, in which case appending a term has
 * to wrap what is there or the AND would bind to the last branch only. */
function hasTopLevelOr(src: string): boolean {
  let depth = 0;
  for (const tk of tokenize(src, [])) {
    if (tk.t === 'lparen') depth++;
    else if (tk.t === 'rparen') depth--;
    else if (tk.t === 'or' && depth === 0) return true;
  }
  return false;
}

/**
 * Set a chip and hand back the new query string.
 *
 * Works on the SOURCE TEXT, not on a rebuilt AST, so everything the user typed
 * by hand — their spacing, their quoting, their parens — survives a chip click.
 * Rebuilding from the AST was the obvious implementation and it reformats the
 * whole box under the cursor every time you tick a box.
 */
export function withChip(src: string, key: string, value: string, state: ChipState): string {
  const def = BY_KEY.get(key);
  const canon = def?.key ?? key;
  const term = `${canon}:${quoteValue(value)}`;
  const at = findTopLevel(src, key, value);
  if (at) {
    const cut = (src.slice(0, at.start) + src.slice(at.end)).replace(/\s{2,}/g, ' ').trim();
    if (state === null) return cut;
    return cut ? `${cut} ${state === 'off' ? '-' : ''}${term}` : `${state === 'off' ? '-' : ''}${term}`;
  }
  if (state === null) return src.trim();
  const base = hasTopLevelOr(src) ? `(${src.trim()})` : src.trim();
  return base ? `${base} ${state === 'off' ? '-' : ''}${term}` : `${state === 'off' ? '-' : ''}${term}`;
}

/** Cycle a chip: nothing -> include -> exclude -> nothing. */
export const nextChipState = (s: ChipState): ChipState => (s === null ? 'on' : s === 'on' ? 'off' : null);

/** Replace a display term (`sort:`/`dir:`/`view:`), which is not a filter. */
export function withDisplay(src: string, key: 'sort' | 'dir' | 'view', value: string): string {
  const stripped = src.replace(new RegExp(`(^|\\s)${key}:\\S+`, 'gi'), ' ').replace(/\s{2,}/g, ' ').trim();
  const dflt = (key === 'sort' && value === 'name') || (key === 'dir' && value === 'asc') || (key === 'view' && value === 'grid');
  if (dflt) return stripped;
  return stripped ? `${stripped} ${key}:${value}` : `${key}:${value}`;
}
