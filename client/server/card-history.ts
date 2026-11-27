/* WHICH CARDS HAVE CHANGED SINCE A RECORDED COMMIT?
 *
 * A saved game or a challenge run is replayed with today's cards. Its
 * fingerprints (replay-probe.ts) hold names, damage and counters but no printed
 * power, toughness or cost, so a numbers change can replay as recorded while
 * the board draws today's numbers. This module names those cards, from git:
 * the oracle row at the recorded commit against the running build's row, and
 * the scan in that commit against the scan on disk. Nothing has to log an edit
 * for it to be seen: every road a card change takes ends in a commit.
 *
 * The answer is a list or `null`, and `null` means "can't tell" (an `unknown`
 * stamp, a commit this clone does not have, git missing). Never a guess.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, relative, sep } from 'node:path';
import { CARDS_DIR, ORACLE_JSON, REPO_ROOT } from '../engine/scripts/paths.mjs';
import { canonicalCardName } from '../engine/src/cards/dsl.ts';
import { isEngineVersion, repoDir } from './engine-version.ts';

/** What changed, in the words a player uses for the parts of a card. */
export const CARD_FIELDS = ['name', 'cost', 'power', 'toughness', 'type', 'text', 'art', 'removed'] as const;
export type CardField = typeof CARD_FIELDS[number];

export interface CardChange {
  /** the card's name today (for a removed card, its name then) */
  card: string;
  /** its name at the recorded commit, when it has been renamed since */
  was?: string;
  fields: CardField[];
}

/** The wire form: the list, or this marker when the stamp cannot be read. */
export const CANT_TELL = 'cant-tell';
export type CardsChanged = CardChange[] | typeof CANT_TELL;

/**
 * The oracle fields a player sees on the card, and the word for each. The cost
 * orb carries the affinity pips, so `factions` is part of 'cost'. The rest are
 * bookkeeping that never reaches the table: `revision_date_time`, `source`,
 * `Deck` (a printer artifact), `Num_Copies`, `Side`, `Backside`, `Numeral`,
 * `rulings` and `details` (our annotations), and `complexity` (the glyph is on
 * the scan, so a changed glyph is an 'art' change).
 */
const FIELD_WORD: Readonly<Record<string, CardField>> = {
  cost: 'cost', total_cost: 'cost', factions: 'cost',
  power: 'power', toughness: 'toughness', type: 'type', text: 'text', image: 'art',
};

type Row = Record<string, unknown>;
type Oracle = Record<string, Row[]>;

/** a card's scan file, as extract-printed.mjs names it */
export const scanFileOf = (name: string): string => name.replace(/ /g, '-') + '.jpg';

const valueOf = (rows: Row[], f: string): string => JSON.stringify(rows.map(r => r[f] ?? null));

/**
 * The cards whose rows differ between two oracles. `scans` holds the scan files
 * that differ between the two moments. A name gone from `now` is a rename when
 * the engine resolves it to a card that is there (its alias table), or when
 * exactly one new name carries its upstream image; otherwise it was removed.
 */
export function diffOracles(
  then: Oracle, now: Oracle, scans: ReadonlySet<string>,
  canonical: (name: string) => string = canonicalCardName,
): CardChange[] {
  const added = Object.keys(now).filter(n => !(n in then));
  const byImage = new Map<string, string[]>();
  for (const n of added) {
    const img = valueOf(now[n]!, 'image');
    byImage.set(img, [...(byImage.get(img) ?? []), n]);
  }
  const out: CardChange[] = [];
  for (const [old, oldRows] of Object.entries(then)) {
    let name = old;
    if (!(old in now)) {
      const alias = canonical(old);
      const sameArt = byImage.get(valueOf(oldRows, 'image')) ?? [];
      if (alias !== old && alias in now) name = alias;
      else if (sameArt.length === 1) name = sameArt[0]!;
      else { out.push({ card: old, fields: ['removed'] }); continue; }
    }
    const rows = now[name]!;
    const fields = new Set<CardField>();
    if (name !== old) fields.add('name');
    for (const [f, word] of Object.entries(FIELD_WORD)) {
      if (valueOf(oldRows, f) !== valueOf(rows, f)) fields.add(word);
    }
    if (scans.has(scanFileOf(name)) || scans.has(scanFileOf(old))) fields.add('art');
    if (!fields.size) continue;
    out.push({
      card: name, ...(name !== old ? { was: old } : {}),
      fields: CARD_FIELDS.filter(f => fields.has(f)),
    });
  }
  return out.sort((a, b) => a.card.localeCompare(b.card));
}

/* ── which cards a game shows ─────────────────────────────────────────── */

/** card names are short; anything longer is prose, and is skipped */
const MAX_NAME = 64;

/**
 * Every short string, value or key, anywhere in these values. A card is in a
 * game exactly when its name is a whole string somewhere in its record (a deck
 * list, a zone, an event); a substring of prose does not count.
 */
export function stringsIn(...roots: unknown[]): Set<string> {
  const seen = new Set<string>();
  const stack: unknown[] = [...roots];
  const visited = new Set<object>();
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'string') { if (v.length <= MAX_NAME) seen.add(v); continue; }
    if (!v || typeof v !== 'object' || visited.has(v)) continue;
    visited.add(v);
    if (Array.isArray(v)) { for (const x of v) stack.push(x); continue; }
    for (const [k, x] of Object.entries(v)) {
      if (k.length <= MAX_NAME) seen.add(k);
      stack.push(x);
    }
  }
  return seen;
}

/** The changes to cards that appear among `seen`, under either name. */
export function changedIn(changes: CardChange[], seen: ReadonlySet<string>): CardChange[];
export function changedIn(changes: CardsChanged, seen: ReadonlySet<string>): CardsChanged;
export function changedIn(changes: CardsChanged, seen: ReadonlySet<string>): CardsChanged {
  if (changes === CANT_TELL) return CANT_TELL;
  return changes.filter(c => seen.has(c.card) || (c.was !== undefined && seen.has(c.was)));
}

/* ── reading the history ──────────────────────────────────────────────── */

export interface HistoryReader {
  /** the oracle's text at a commit, or null when git cannot show it */
  oracleAt(sha: string): Promise<string | null>;
  /** scan basenames that differ between a commit and the files on disk, or null */
  scansChangedSince(sha: string): Promise<string[] | null>;
  /** the running build's oracle text, or null when it cannot be read */
  oracleNow(): string | null;
  /** the name an old card name resolves to today */
  canonical?(name: string): string;
}

const git = (args: string[], cwd: string): Promise<string | null> => new Promise(done => {
  execFile('git', ['--no-optional-locks', ...args], {
    cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 * 1024,
  }, (err, out) => done(err ? null : out));
});

const posix = (p: string): string => p.split(sep).join('/');

/** The running build's oracle, read when the server loads. The engine's
 * printed pool is loaded at the same moment, so this is the oracle it plays. */
let oracleAtLoad: string | null = null;
try { oracleAtLoad = readFileSync(ORACLE_JSON, 'utf8'); } catch { oracleAtLoad = null; }

/**
 * The real reader: git in this checkout. The oracle has lived at more than one
 * path; every path it has had comes from `git log --follow`, so a commit from
 * before a move is read at the path it had then.
 */
export function gitHistoryReader(repo: string = repoDir()): HistoryReader {
  const here = posix(relative(REPO_ROOT, ORACLE_JSON));
  let paths: Promise<string[]> | null = null;
  const oraclePaths = (): Promise<string[]> => paths ??= git(
    ['log', '--follow', '--name-only', '--format=', '--', here], repo,
  ).then(out => [...new Set([here, ...(out ?? '').split('\n').map(s => s.trim()).filter(Boolean)])]);

  return {
    async oracleAt(sha) {
      for (const p of await oraclePaths()) {
        const text = await git(['show', `${sha}:${p}`], repo);
        if (text !== null) return text;
      }
      return null;
    },
    async scansChangedSince(sha) {
      const dirs = [...new Set([posix(relative(REPO_ROOT, CARDS_DIR)), ...(await oraclePaths()).map(p => dirname(p))])];
      const out = await git(['diff', '-z', '--name-status', '-M', sha, '--', ...dirs], repo);
      if (out === null) return null;
      // -z: status, path[, new path] — NUL-separated, so no quoting to undo
      const parts = out.split('\0');
      const files: string[] = [];
      for (let i = 0; i < parts.length;) {
        const status = parts[i++] ?? '';
        if (!status) continue;
        const two = status[0] === 'R' || status[0] === 'C';
        const a = parts[i++] ?? '';
        const b = two ? parts[i++] ?? '' : a;
        const moved = two && status !== `${status[0]}100`;
        if (status === 'M' || moved) files.push(basename(b));
      }
      return files.filter(f => /\.(jpe?g|png|webp)$/i.test(f));
    },
    oracleNow: () => oracleAtLoad,
    canonical: canonicalCardName,
  };
}

const parse = (text: string | null): Oracle | null => {
  if (text === null) return null;
  try {
    const o = JSON.parse(text) as unknown;
    return o && typeof o === 'object' && !Array.isArray(o) ? o as Oracle : null;
  } catch { return null; }
};

/** `cardsChangedSince`, over a reader; one answer per sha for the process's life. */
export function cardHistory(reader: HistoryReader): (sha: string) => Promise<CardsChanged> {
  const cache = new Map<string, Promise<CardsChanged>>();
  let now: Oracle | null | undefined;
  return (sha: string) => {
    if (!isEngineVersion(sha)) return Promise.resolve(CANT_TELL);
    const hit = cache.get(sha);
    if (hit) return hit;
    const p = (async (): Promise<CardsChanged> => {
      if (now === undefined) now = parse(reader.oracleNow());
      const [then, scans] = await Promise.all([reader.oracleAt(sha).then(parse), reader.scansChangedSince(sha)]);
      if (!now || !then || !scans) return CANT_TELL;
      return diffOracles(then, now, new Set(scans), reader.canonical ?? canonicalCardName);
    })();
    cache.set(sha, p);
    return p;
  };
}

/**
 * The cards whose oracle row or scan differs between this commit and the
 * running build, or CANT_TELL. Cached per sha: the running build cannot change
 * under a running process, and a commit never changes at all.
 */
export const cardsChangedSince: (sha: string) => Promise<CardsChanged> = cardHistory(gitHistoryReader());
