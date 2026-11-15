/* Reading and writing a JSON store: a whole file (accounts.json, league.json)
 * or JSON lines appended one write at a time (the match history).
 *
 * A store is the only copy of what it holds, so the two rules are:
 *  - LOAD: an absent file is a new, empty store. A file that is present but
 *    cannot be read, parsed or recognised throws StoreLoadError — never an
 *    empty store, which the next persist would write over the real one. The
 *    boot sequence turns that into a refusal to start.
 *  - WRITE: temp file + rename, and the generation being replaced is kept as
 *    `<file>.bak`. The .bak is a HARD LINK to the old file made before the
 *    rename, so `<file>` itself is present at every instant (renaming it
 *    aside first would leave a window where a crash boots an empty store).
 */
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class StoreLoadError extends Error {
  constructor(file: string, what: string) {
    const bak = existsSync(`${file}.bak`) ? ` (${file}.bak is the previous generation)` : '';
    super(`refusing to start: ${file} ${what}. Nothing was written; fix or restore it${bak}.`);
    this.name = 'StoreLoadError';
  }
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function readBytes(file: string): Buffer | undefined {
  try {
    return readFileSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // a store that has been saved twice always has both files: the live one alone going missing is damage
      if (existsSync(`${file}.bak`)) throw new StoreLoadError(file, 'is missing');
      return undefined;
    }
    throw new StoreLoadError(file, `could not be read (${reason(err)})`);
  }
}

function parse(file: string, text: string, isShape: (raw: unknown) => boolean, where = ''): unknown {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (err) { throw new StoreLoadError(file, `${where}is not valid JSON (${reason(err)})`); }
  if (!isShape(raw)) throw new StoreLoadError(file, `${where}is not the shape this store writes`);
  return raw;
}

/** The parsed file, or undefined when there is no file. Throws StoreLoadError
 * for anything else; `isShape` decides "recognised". */
export function readStoreFile(file: string, isShape: (raw: unknown) => boolean): unknown {
  const bytes = readBytes(file);
  return bytes && parse(file, bytes.toString('utf8'), isShape);
}

/** Every line of a JSON-lines store, parsed, or undefined when there is no
 * file. A last line without its newline is a crash mid-append: dropped, and
 * (`repair`) cut off the file once every other line has parsed. */
export function readStoreLines(file: string, isShape: (raw: unknown) => boolean, repair = true): unknown[] | undefined {
  const bytes = readBytes(file);
  if (!bytes) return undefined;
  const end = bytes.lastIndexOf(0x0a) + 1;
  const rows = bytes.subarray(0, end).toString('utf8').split('\n').slice(0, -1)
    .map((line, i) => parse(file, line, isShape, `line ${i + 1} `));
  if (end < bytes.length && repair) truncateSync(file, end);
  return rows;
}

export const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
/** absent, or an array of objects */
export const arrayOfRecords = (x: unknown): boolean => x === undefined || (Array.isArray(x) && x.every(isRecord));

/** Write `text` to `file` atomically, keeping the old file as `<file>.bak`. */
export function writeStoreFile(file: string, text: string, mode?: number): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text, mode === undefined ? undefined : { mode });
  // a leftover tmp keeps its old mode; writeFileSync's mode applies only on create
  if (mode !== undefined) chmodSync(tmp, mode);
  if (existsSync(file)) {
    const bak = `${file}.bak`;
    rmSync(bak, { force: true });
    try { linkSync(file, bak); } catch { copyFileSync(file, bak); }
  }
  renameSync(tmp, file);
}
