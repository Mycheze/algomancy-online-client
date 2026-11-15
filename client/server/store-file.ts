/* Reading and writing a whole-file JSON store (accounts.json, league.json).
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
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class StoreLoadError extends Error {
  constructor(file: string, what: string) {
    const bak = existsSync(`${file}.bak`) ? ` (${file}.bak is the previous generation)` : '';
    super(`refusing to start: ${file} ${what}. Nothing was written; fix or restore it${bak}.`);
    this.name = 'StoreLoadError';
  }
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The parsed file, or undefined when there is no file. Throws StoreLoadError
 * for anything else; `isShape` decides "recognised". */
export function readStoreFile(file: string, isShape: (raw: unknown) => boolean): unknown {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // a store that has been saved twice always has both files: the live one alone going missing is damage
      if (existsSync(`${file}.bak`)) throw new StoreLoadError(file, 'is missing');
      return undefined;
    }
    throw new StoreLoadError(file, `could not be read (${reason(err)})`);
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (err) { throw new StoreLoadError(file, `is not valid JSON (${reason(err)})`); }
  if (!isShape(raw)) throw new StoreLoadError(file, 'is not the shape this store writes');
  return raw;
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
