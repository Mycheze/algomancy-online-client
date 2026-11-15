/* Stamp bundle.js with its own content hash, written over ui/build.ts's
 * placeholder at the same length so the source map still lines up. The
 * server reads the stamp back out of the file it serves (server/build-stamp.ts).
 * Written beside and renamed over, so a running server never reads half a file. */
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

const FILE = new URL('../bundle.js', import.meta.url);
const PLACEHOLDER = 'algo-build:unstamped-00';
const js = readFileSync(FILE, 'utf8');
if (!js.includes(PLACEHOLDER)) throw new Error(`bundle.js has no ${PLACEHOLDER} to stamp — ui/build.ts lost it`);
const hash = createHash('sha256').update(js).digest('hex').slice(0, 12);
const tmp = new URL('../bundle.js.stamping', import.meta.url);
writeFileSync(tmp, js.replaceAll(PLACEHOLDER, `algo-build:${hash}`));
renameSync(tmp, FILE);
console.log(`  bundle.js      stamped ${hash}`);
