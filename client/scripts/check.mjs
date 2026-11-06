#!/usr/bin/env node
/* THE GATE, RUN SIDE BY SIDE — `npm run check`.
 *
 * WHAT the gate runs is still written in one place: the `check:serial` script
 * in client/package.json, the old && chain, word for word. This file does not
 * have its own list. It flattens that chain — following `npm --prefix <dir>
 * run <x>`, `npm run <x>` and `npm test` through every package.json — into the
 * leaf commands it ends in, and runs them at once instead of one after another.
 * `153-typecheck-reach.test.ts` asserts plan() is exactly that flattening, so
 * a step added to the chain is a step the gate runs, with nothing to keep in
 * step by hand.
 *
 * Why (2026-11-06): the chain took ~12½ min on the dev laptop and ~48 on the
 * steward's box, and every gate minute here is four or five there. Most of
 * the chain is suites that share nothing — engine, ui, server unit, server
 * e2e, ledgers, the bot's Python — so running them together costs the time of
 * the longest, not the sum. And on the steward's box, pinned to two CPUs,
 * `node --test` sizes its pool as CPUs − 1 = ONE file at a time: the chain left
 * half the box idle for the whole gate.
 *
 * Every node process it starts — test workers, and the servers the e2e scripts
 * spawn — loads scripts/ts-cache.mjs (NODE_OPTIONS), so the ~860 engine files
 * are type-stripped once rather than once per test file: 0.8 s of CPU per
 * process, ~850 processes a gate.
 *
 * Two phases, because one dependency is real: the e2e suite serves the UI
 * bundle, so the compile steps (every `typecheck`, the ui `build`) run first —
 * together, ~10 s — and every test step after them, together.
 *
 * Output: each step's whole output, printed when it ends (never interleaved —
 * the steward reads `^not ok` lines out of this log), then one line per step.
 * Exit 1 if any step failed, naming them; unlike the && chain, a red engine
 * suite no longer hides whether the others were green.
 *
 *   npm run check              the gate
 *   node scripts/check.mjs --plan   the steps it would run, and stop (--json: as data, for test 153)
 *   npm run check:serial       the old one-after-another chain, for comparison
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLIENT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHAIN = 'check:serial';
/** every node process the gate starts strips each .ts file once, not once per process — see ts-cache.mjs */
const NODE_OPTIONS = [process.env.NODE_OPTIONS, `--import=${pathToFileURL(join(CLIENT, 'scripts', 'ts-cache.mjs')).href}`].filter(Boolean).join(' ');
/**
 * Test SUITES at once. Each `node --test` already fills every CPU with its own
 * workers, so more suites than this only adds contention — and contention is
 * what turns a server test's "reply within 8 s" into a red gate (measured
 * 2026-11-06: all six at once on the 4-core laptop timed out 486 §4b). Three on
 * the laptop; two on the steward's two-CPU box, where it is what puts the
 * second CPU to work at all (`node --test` alone gives it a one-worker pool).
 */
const LANES = Math.max(2, Math.min(3, Math.floor(availableParallelism() / 2)));
/** the npm scripts that compile rather than test — phase 1 */
const COMPILE = new Set(['typecheck', 'build']);

/**
 * Flatten an npm script into its leaf commands, each with the directory it
 * runs in and the npm script it was written in. Only `&&` is a chain here: a
 * script that uses `||` or `;` would change meaning when its parts run apart,
 * so it is refused rather than guessed at.
 */
export function plan(dir = CLIENT, script = CHAIN, seen = new Set()) {
  const key = `${dir}::${script}`;
  if (seen.has(key)) throw new Error(`check: ${key} includes itself`);
  seen.add(key);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const body = pkg.scripts?.[script];
  if (body === undefined) throw new Error(`check: no "${script}" script in ${relative(CLIENT, dir) || '.'}/package.json`);
  if (/\|\||;/.test(body.replace(/'[^']*'/g, ''))) throw new Error(`check: "${script}" in ${relative(CLIENT, dir) || '.'} uses || or ; — only && chains can be split`);
  const out = [];
  let raw = [];   // consecutive plain commands of ONE script stay one step: their order is the script's
  const flush = () => { if (raw.length) out.push({ dir, script, cmd: raw.join(' && ') }); raw = []; };
  for (const seg of body.split('&&').map(s => s.trim()).filter(Boolean)) {
    const prefixed = /^npm\s+--prefix\s+(\S+)\s+(?:run\s+)?(\S+)$/.exec(seg);
    const local = /^npm\s+(?:run\s+)?(\S+)$/.exec(seg);
    if (prefixed) { flush(); out.push(...plan(resolve(dir, prefixed[1]), prefixed[2], new Set(seen))); }
    else if (local) { flush(); out.push(...plan(dir, local[1], new Set(seen))); }
    else raw.push(seg);
  }
  flush();
  return out;
}

const label = s => `${relative(CLIENT, s.dir) || 'client'} ${s.script}`;

/** run one leaf the way npm would: in its directory, with its package's bin on PATH */
function run(step, children) {
  return new Promise(res => {
    const t0 = Date.now();
    const PATH = [join(step.dir, 'node_modules', '.bin'), process.env.PATH].join(delimiter);
    const child = spawn('sh', ['-c', step.cmd], { cwd: step.dir, env: { ...process.env, PATH, NODE_OPTIONS }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    children.add(child);
    const out = [];
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => out.push(d));
    child.on('close', (code, signal) => {
      children.delete(child);
      res({ step, code: code ?? 1, signal, secs: (Date.now() - t0) / 1000, out: Buffer.concat(out).toString() });
    });
  });
}

async function main() {
  const steps = plan();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(steps.map(s => ({ ...s, dir: relative(CLIENT, s.dir), phase: COMPILE.has(s.script) ? 1 : 2 })))); return; }
  if (process.argv.includes('--plan')) {
    for (const s of steps) console.log(`${COMPILE.has(s.script) ? '1' : '2'}  ${label(s)}  —  ${s.cmd}`);
    return;
  }
  const children = new Set();
  const stop = sig => { for (const c of children) try { process.kill(-c.pid, 'SIGKILL'); } catch {} process.exit(sig === 'SIGINT' ? 130 : 143); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);

  const t0 = Date.now(); const results = [];
  const report = r => {
    const mark = r.code === 0 ? 'ok' : `FAILED (exit ${r.code}${r.signal ? `, ${r.signal}` : ''})`;
    process.stdout.write(`\n════ ${label(r.step)}: ${mark} in ${r.secs.toFixed(0)} s — ${r.step.cmd}\n${r.out}`);
    results.push(r); return r;
  };
  /** at most `lanes` steps at once, in plan order (the engine suite, the longest, is first) */
  const phase = async (list, lanes = list.length) => {
    const queue = [...list]; const done = [];
    const lane = async () => { for (let s; (s = queue.shift());) done.push(report(await run(s, children))); };
    await Promise.all(Array.from({ length: Math.min(lanes, list.length) }, lane));
    return done;
  };
  const first = await phase(steps.filter(s => COMPILE.has(s.script)));
  // a compile error makes every test step's verdict noise: stop here, as the chain would have
  if (first.every(r => r.code === 0)) await phase(steps.filter(s => !COMPILE.has(s.script)), LANES);

  const failed = results.filter(r => r.code !== 0);
  const skipped = steps.length - results.length;
  console.log(`\n════ the gate, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  for (const r of results) console.log(`  ${r.code === 0 ? '✓' : '✗'} ${r.secs.toFixed(0).padStart(4)} s  ${label(r.step)}`);
  if (skipped) console.log(`  (${skipped} test steps not run: a compile step failed)`);
  if (failed.length) { console.log(`\nRED: ${failed.map(r => label(r.step)).join(', ')}`); process.exit(1); }
  console.log('\nGREEN');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
