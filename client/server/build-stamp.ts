/* WHICH UI BUNDLE THIS SERVER SERVES NOW: the stamp ui/scripts/stamp-build.mjs
 * wrote into bundle.js. Re-read whenever the file changes, because a
 * client-only deploy replaces it under a running server; a stat otherwise. */
import { readFileSync, statSync } from 'node:fs';

let seen: { file: string; mtimeMs: number; size: number; build: string | null } | null = null;

/** the bundle's stamp, or null for an unstamped or missing bundle */
export function bundleBuild(file: string): string | null {
  try {
    const st = statSync(file);
    if (seen?.file !== file || seen.mtimeMs !== st.mtimeMs || seen.size !== st.size) {
      const m = /["']algo-build:([0-9a-f]{12})["']/.exec(readFileSync(file, 'utf8'));
      seen = { file, mtimeMs: st.mtimeMs, size: st.size, build: m ? m[1]! : null };
    }
    return seen.build;
  } catch { return null; }
}
