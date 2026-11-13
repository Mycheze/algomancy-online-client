/**
 * 1214 — shipping an item does not take it off the steward's queue; closing it does, so the queue
 * has to stop re-offering what already had its turn.
 *
 * 2026-11-08..10: BL-10 (polish, open-ended by its own text) sat first in the backlog. Each run
 * shipped one improvement and left it open, as told, so the next tick offered it again: 16 runs in a
 * row, every other BL waiting behind it, and `shipped` counts as progress to the loop breaker. Same
 * week: `tidy`, last in the queue, never ran once, and every item staged or red before a later run
 * shipped it left its `steward/<item>` branch behind (13 of them).
 *
 * The queue runs over a FIXTURE tree — a copy of `steward/queue.mjs` beside three small ledgers —
 * not the live ledgers. Until 2026-11-13 it read the live ones and needed two open items in them:
 * closing BL-63 left only BL-10, and the order test went red on a ledger change that broke nothing.
 * The live run is kept as a smoke check (the real ledgers still load).
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STEWARD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'steward');
const src = readFileSync(join(STEWARD, 'run-once.sh'), 'utf8');

function fn(name: string): string {
  const one = src.match(new RegExp(`^${name}\\(\\) \\{.*\\}$`, 'm'));
  if (one) return one[0];
  const many = src.match(new RegExp(`^${name}\\(\\) \\{[^\\n]*\\n[\\s\\S]*?^\\}$`, 'm'));
  assert.ok(many, `run-once.sh has no function ${name}()`);
  return many[0];
}

/** a repo-shaped tree the queue can run in: its own copy of queue.mjs, and ledgers with two open
 *  backlog items and nothing else (queue.mjs finds the ledgers beside itself, and asks git for HEAD) */
function fixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'steward-1214-repo-'));
  mkdirSync(join(root, 'steward'));
  copyFileSync(join(STEWARD, 'queue.mjs'), join(root, 'steward', 'queue.mjs'));
  const led = join(root, 'client', 'ledgers');
  mkdirSync(led, { recursive: true });
  writeFileSync(join(led, 'card-todo.ts'), 'export const CARD_TODO = [];\n');
  writeFileSync(join(led, 'playtest-ledger.ts'), 'export const LEDGER = [];\n');
  writeFileSync(join(led, 'backlog.ts'), `export const BACKLOG = [
  { id: 'BL-901', status: 'open', size: 'S', title: 'the first open item' },
  { id: 'BL-902', status: 'open', size: 'S', title: 'the second open item' },
];\n`);
  execFileSync('bash', ['-c', 'git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base'], { cwd: root });
  return root;
}
const FIXTURE = fixtureRepo();
after(() => rmSync(FIXTURE, { recursive: true, force: true }));

/** the queue this journal produces: its lines, and what it says it left out */
function queue(rows: Array<Record<string, string>>, repo = FIXTURE): { lines: string[]; excluded: string } {
  const dir = mkdtempSync(join(tmpdir(), 'steward-1214-'));
  try {
    writeFileSync(join(dir, 'journal.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    const r = spawnSync(process.execPath, [join(repo, 'steward', 'queue.mjs'), '--why'], {
      encoding: 'utf8', env: { ...process.env, STEWARD_STATE: dir },
    });
    assert.equal(r.status, 0, r.stderr);
    return { lines: r.stdout.split('\n').filter(l => l.trim()), excluded: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const shipped = (item: string, hoursAgo: number, outcome = 'shipped') =>
  ({ ts: new Date(Date.now() - hoursAgo * 3600e3).toISOString(), item, outcome });
/** the queue lines a shipped-but-open item can be: what steward/queue.mjs offers off the ledgers */
const worked = (l: string) => /^(BL-\d+|CT-\d+)\s/.test(l);
const idOf = (l: string) => l.split(/\s+/)[0]!;

test('1214 an item that shipped today and is still open goes behind everything else', () => {
  const base = queue([]).lines.filter(worked);
  assert.deepEqual(base.map(idOf), ['BL-901', 'BL-902'], 'the fixture offers its two items, in order');
  const first = idOf(base[0]!);
  const after = queue([shipped(first, 1)]).lines;
  assert.equal(idOf(after.at(-1)!), first, `${first} should be last; queue: ${after.map(idOf).join(' ')}`);
});

test('1214 the queue still runs over the live ledgers', () => {
  // queue() asserts the exit status: the real ledgers import and the queue prints
  queue([], join(STEWARD, '..'));
});

test('1214 three ships in a day is an item\'s share; it comes back when they age out', () => {
  const first = idOf(queue([]).lines.filter(worked)[0]!);
  const spent = queue([shipped(first, 3), shipped(first, 2), shipped(first, 1, 'landed')]);
  assert.ok(!spent.lines.some(l => idOf(l) === first), `${first} still offered after three ships`);
  assert.match(spent.excluded, new RegExp(`${first}: shipped 3 times in a day`));
  const aged = queue([shipped(first, 49), shipped(first, 48), shipped(first, 47)]);
  assert.equal(idOf(aged.lines.filter(worked)[0]!), first, 'ships older than a day do not count');
});

test('1214 tidy is reached: ahead of the long queues, and once a day', () => {
  const { lines } = queue([]);
  const tidy = lines.findIndex(l => l.startsWith('tidy'));
  assert.ok(tidy >= 0, 'tidy is offered when it has never run');
  assert.ok(tidy < lines.findIndex(worked), `tidy sits below the ledgers: ${lines.map(idOf).join(' ')}`);
  assert.ok(!queue([shipped('tidy', 2)]).lines.some(l => l.startsWith('tidy')), 'tidy twice in a day');
});

test('1214 a shipped item\'s staged branch is archived and deleted, and a dry run touches nothing', () => {
  assert.match(src, /shipped\|already-fixed\|not-a-bug\)[^\n]*retire_branch "\$item"/, 'the verdict path must call it');
  const dir = mkdtempSync(join(tmpdir(), 'steward-1214-git-'));
  const sh = (cmd: string) => execFileSync('bash', ['-c', cmd], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    sh(`git init -q --bare o.git && git clone -q o.git w 2>/dev/null && cd w && git config user.email t@t && git config user.name t
      git commit -q --allow-empty -m base && git push -q origin HEAD:refs/heads/master
      git commit -q --allow-empty -m staged && git push -q origin HEAD:refs/heads/steward/report-9
      git fetch -q --prune origin '+refs/heads/*:refs/remotes/origin/*'`);
    const retire = (mode: string) => sh(`REPO=${JSON.stringify(join(dir, 'w'))}; STEWARD_MODE=${mode}
      g() { git -C "$REPO" "$@"; }; log() { echo "LOG $*"; }
      ${fn('slug')}
      ${fn('retire_branch')}
      retire_branch '#9'; retire_branch 'BL-99'`);
    const refs = () => sh('git --git-dir=o.git for-each-ref --format="%(refname)"');
    retire('dry');
    assert.match(refs(), /refs\/heads\/steward\/report-9/, 'a dry run must leave the branch');
    assert.equal(retire('live'), '', 'an item with no branch is not an error');
    assert.doesNotMatch(refs(), /refs\/heads\/steward\/report-9/);
    assert.match(refs(), /refs\/archive\/steward\/report-9/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
