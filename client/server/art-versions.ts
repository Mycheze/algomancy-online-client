/* CARD ART THAT CAN CHANGE — a content hash in every scan's URL.
 *
 * main.ts serves the scans `immutable` for a year, which was right while a
 * scan never changed in place. Light & Dark broke that: the set is still in
 * development, and the first official scans replaced generated placeholders
 * under the SAME filenames — so every browser that had ever drawn the old
 * Light-Resource.jpg went on drawing it, with no way to tell it otherwise.
 *
 * So the version lives in the URL instead of the cache policy:
 *
 *   /art-versions.js   `window.ALGO_ART_VERSIONS = {"Fireball.jpg":"3f9a…",…}`,
 *                      computed from the files on disk and served no-cache.
 *                      index.html loads it before bundle.js; ui/assets.ts
 *                      `artUrl` appends `?v=<hash>`.
 *   /data/cards/X?v=H  immutable ONLY when H is X's current hash. Anything
 *                      else — no v (the bot, a file:// page, an old tab), a
 *                      stale v — is served revalidate, so it can never pin a
 *                      stale scan for a year again.
 *
 * Replacing a scan on disk is the whole deploy: the next page load hashes it
 * afresh (a file is re-read only when its size or mtime moved) and asks for a
 * URL no browser has cached. No rebuild, no restart. */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** hex chars of sha1 kept — collisions only matter per filename, not across the pool */
export const HASH_LENGTH = 10;

type Entry = { size: number; mtimeMs: number; hash: string };

export function artVersions(dir: string) {
  const known = new Map<string, Entry>();

  /** the current hash of one file, or null when it is not a scan in `dir` */
  async function versionOf(file: string): Promise<string | null> {
    let info;
    try { info = await stat(join(dir, file)); } catch { return null; }
    if (!info.isFile()) return null;
    const had = known.get(file);
    if (had && had.size === info.size && had.mtimeMs === info.mtimeMs) return had.hash;
    const hash = createHash('sha1').update(await readFile(join(dir, file))).digest('hex').slice(0, HASH_LENGTH);
    known.set(file, { size: info.size, mtimeMs: info.mtimeMs, hash });
    return hash;
  }

  /** every image in `dir`, filename → hash; a deleted file drops out */
  async function all(): Promise<Record<string, string>> {
    const names = (await readdir(dir)).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();
    for (const f of known.keys()) if (!names.includes(f)) known.delete(f);
    const out: Record<string, string> = {};
    for (const f of names) {
      const h = await versionOf(f);
      if (h) out[f] = h;
    }
    return out;
  }

  /** the script index.html loads before the bundle */
  async function script(): Promise<string> {
    return `window.ALGO_ART_VERSIONS=${JSON.stringify(await all())};\n`;
  }

  return { versionOf, all, script };
}
