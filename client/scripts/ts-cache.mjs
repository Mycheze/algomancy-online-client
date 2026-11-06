/* A SHARED CACHE OF TYPE-STRIPPED SOURCE for the test processes. The gate
 * (scripts/check.mjs) loads it into every node process it starts, through
 * NODE_OPTIONS=--import, so it also reaches the real servers the e2e scripts
 * spawn. Running a suite by hand works without it, just slower.
 *
 * `node --test` runs each of the ~850 test files in a process of its own, and
 * every one of them type-strips the same ~860 engine files from scratch:
 * ~0.2 s of CPU each (2026-11-06 profile: the wasm stripper and its load were
 * most of an engine import; the engine's own top-level code was noise). That
 * is ~3 CPU-minutes a gate on the laptop, and the steward's box runs the gate
 * on two slow cores where CPU-minutes are the whole cost.
 *
 * So: strip each file once, keyed by a hash of its SOURCE, and let every later
 * process read the result. The stripping is Node's own
 * (`module.stripTypeScriptTypes`, the function `--experimental-strip-types`
 * uses), in the same strip-only mode, which blanks types with spaces and so
 * keeps every line and column — stack traces point where they always did.
 * A changed file has a new hash and is stripped afresh; nothing is ever
 * invalidated by hand. The cache lives in the OS temp dir and can be deleted
 * at any time.
 *
 * Node's V8 compile cache is turned on beside it: with the hook handing V8
 * plain JavaScript, the bytecode can be cached too. Measured 2026-11-06,
 * importing the engine: 0.8 s of CPU cold → 0.06 s warm.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import module from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(tmpdir(), `algomancy-ts-cache-${process.versions.node}`);
mkdirSync(DIR, { recursive: true });
module.enableCompileCache?.(join(DIR, 'v8'));

/** Node's own stripper, minus its one-time "experimental" warning: a test that
 *  reads a child's stderr must not see a line the cache put there */
function strip(source) {
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => { if (!/stripTypeScriptTypes/.test(String(w?.message ?? w))) emit.call(process, w, ...rest); };
  try { return module.stripTypeScriptTypes(source, { mode: 'strip' }); } finally { process.emitWarning = emit; }
}

module.registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return nextLoad(url, context);
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const file = join(DIR, createHash('sha1').update(source).digest('hex') + '.js');
    let js;
    try { js = readFileSync(file, 'utf8'); } catch {
      js = strip(source);
      const tmp = `${file}.${process.pid}`;           // write-then-rename: a reader never sees half a file
      writeFileSync(tmp, js); renameSync(tmp, file);
    }
    return { format: 'module', source: js, shortCircuit: true };
  },
});
