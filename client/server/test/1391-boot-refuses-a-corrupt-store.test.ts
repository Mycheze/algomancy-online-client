// A store file that does not load stops the boot and is left byte-identical; a missing one starts empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverEnv } from '../e2e/test-util.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'boot-refuse-'));
test.after(() => rmSync(root, { recursive: true, force: true }));

/** boot main.ts on a scratch directory holding `files`; `up` when it reached listening */
function boot(name: string, files: Record<string, string>): Promise<{ code: number | null; up: boolean; err: string; dir: string }> {
  const dir = join(root, name);
  mkdirSync(join(dir, 'games'), { recursive: true });
  // a saved game, so a boot that got as far as the history sync would write
  writeFileSync(join(dir, 'games', 'ABCD.json'), JSON.stringify({ code: 'ABCD', seed: 1, actions: [] }));
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
  const env = { ALGO_ACCOUNTS_FILE: join(dir, 'accounts.json'), ALGO_LEAGUE_FILE: join(dir, 'league.json'), ALGO_GAMES_DIR: join(dir, 'games') };
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [join(HERE, '..', 'main.ts')], {
      cwd: join(HERE, '..'), env: serverEnv(env), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '', up = false;
    proc.stdout.on('data', d => { out += String(d); if (/Algomancy server on/.test(out)) { up = true; proc.kill(); } });
    proc.stderr.on('data', d => { err += String(d); });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`no exit\n${out}\n${err}`)); }, 60_000);
    proc.on('exit', code => { clearTimeout(timer); resolve({ code, up, err, dir }); });
  });
}

const BAD: [string, string, string][] = [
  ['accounts-torn', 'accounts.json', '{"version":1,"accounts":[{"id":"u1","key":"ben","hash":"'],
  ['accounts-shape', 'accounts.json', '{"version":1,"accounts":{"a":1},"sessions":[],"history":[]}'],
  ['league-torn', 'league.json', '{"version":1,"seasons":[{"id":"oct"'],
  ['league-shape', 'league.json', '{"seasons":"oct"}'],
  ['accounts-gone-bak-left', 'accounts.json.bak', '{"version":1,"accounts":[],"sessions":[],"history":[]}'],
];

test('⭐ an unparsable, wrong-shape or vanished store: exit 1 naming it, every file byte-identical', async () => {
  for (const [name, file, text] of BAD) {
    const r = await boot(name, { [file]: text });
    assert.equal(r.code, 1, `${name}: the server did not refuse to start\n${r.err}`);
    const live = join(r.dir, file.replace(/\.bak$/, ''));
    assert.ok(r.err.split('\n').some(l => l.includes('[boot]') && l.includes(live)), `${name}: no [boot] line naming ${live}\n${r.err}`);
    assert.equal(readFileSync(join(r.dir, file), 'utf8'), text, `${name}: the file was written over`);
    assert.deepEqual(readdirSync(r.dir).sort(), [file, 'games'].sort(), `${name}: something was written beside it`);
  }
});

test('missing store files are a first boot', async () => {
  const r = await boot('fresh', {});
  assert.ok(r.up, `the server did not start on an empty directory\n${r.err}`);
});
