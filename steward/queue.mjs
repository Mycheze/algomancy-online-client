#!/usr/bin/env node
/* The steward's queue — what the night worker may pick, best first.
 *
 *   node steward/queue.mjs            print the queue (one item per line)
 *   node steward/queue.mjs --why      also print what was excluded and why
 *
 * Deterministic on purpose: the agent takes the first line, so the ORDER is a
 * policy, and a policy belongs in code you can read rather than in a prompt.
 *
 *   1. triage #a-#b      report rows the ledger has no entry for yet, or a
 *                        verdict/marks snapshot the fetch just changed. FIRST,
 *                        because an unledgered row turns 70-playtest-ledger red
 *                        and every other item's gate with it.
 *   2. repair <branch>   a staged branch whose gate went red (state/redgate/)
 *   3. resume <item>     the owner answered a handoff (state/answers/)
 *   4. report #N         playtest-ledger entries still live / partial ('agreed-fix'
 *                        is a CLOSED status: a player's take-back, no defect)
 *   5. CT-N              open card-todo entries, high severity first
 *   6. BL-N              the backlog's ready list (open, no asks, deps done), XL never
 *   7. tidy              once per night
 *
 * Excluded: anything in steward/hold.txt (the owner's "leave this alone"), and
 * anything with a journal row that is still waiting on the owner (staged,
 * needs-human) or that was tried in the last 7 days and came back
 * skip / gave-up / not-a-bug.
 *
 * STEWARD_STATE names the state dir (default ~/algomancy-steward/state).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGERS = join(REPO, 'client', 'ledgers');
const STATE = process.env.STEWARD_STATE || join(homedir(), 'algomancy-steward', 'state');
const WHY = process.argv.includes('--why');

const { CARD_TODO } = await import(join(LEDGERS, 'card-todo.ts'));
const { LEDGER } = await import(join(LEDGERS, 'playtest-ledger.ts'));
const { BACKLOG } = await import(join(LEDGERS, 'backlog.ts'));

/** the one spelling of an item in file names, branch names and the journal: '#226' → 'report-226' (run-once.sh and review.sh agree) */
const slug = i => String(i).replace(/^#/, 'report-').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const readLines = p => (existsSync(p) ? readFileSync(p, 'utf8').split('\n') : []);
const ls = p => (existsSync(p) ? readdirSync(p) : []);

/* the owner's hold list: "CT-346  reason…" — first token is the item */
const hold = new Map(
  readLines(join(REPO, 'steward', 'hold.txt'))
    .map(l => l.replace(/#.*/, '').trim()).filter(Boolean)
    .map(l => [l.split(/\s+/)[0], l]),
);

/* the journal: last word per item wins */
const journal = new Map();
for (const l of readLines(join(STATE, 'journal.jsonl'))) {
  if (!l.trim()) continue;
  try { const r = JSON.parse(l); if (r.item) journal.set(slug(r.item), r); } catch { /* a torn line is not fatal */ }
}
// waiting on the owner, or on the runner's own repair/landing loop
const WAITING = new Set(['staged', 'needs-human', 'stage', 'gate-red', 'gate-red-twice', 'approved', 'approved-conflict', 'approved-gate-red', 'rejected']);
// tried recently and came back empty: leave it a week ('rejected-retry' = the owner asked for another go)
const COOLDOWN = new Set(['skip', 'gave-up', 'not-a-bug', 'failed']);
const WEEK = 7 * 864e5;

const answered = new Set(ls(join(STATE, 'answers')).map(f => f.replace(/\.md$/, '')));
const excluded = [];
function blocked(item) {
  item = slug(item);
  if (hold.has(item)) return `held: ${hold.get(item)}`;
  if (answered.has(item)) return null; // an answer reopens it
  const j = journal.get(item);
  if (!j) return null;
  if (WAITING.has(j.outcome)) return `waiting on the owner (${j.outcome}, ${j.ts})`;
  if (COOLDOWN.has(j.outcome) && Date.now() - Date.parse(j.ts) < WEEK) return `cooling down (${j.outcome}, ${j.ts})`;
  return null;
}

const out = [];
const push = (item, line) => {
  const why = blocked(item);
  if (why) excluded.push(`${item}: ${why}`);
  else out.push(line);
};

// 1. reports the ledger has not seen, and snapshots the fetch changed
const snap = readLines(join(LEDGERS, 'playtest-issues.snapshot.jsonl')).filter(l => l.trim());
const ledgered = new Set(LEDGER.map(e => e.id));
const fresh = snap.map((_, i) => i).filter(i => !ledgered.has(i));
const dirty = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--', 'client/ledgers/'], { encoding: 'utf8' })
  .split('\n').filter(l => /snapshot\.jsonl$/.test(l)).map(l => l.slice(3).replace('client/ledgers/', ''));
// never cooled down or held: an unledgered row turns every other item's gate red
if (fresh.length) out.push( `triage #${fresh[0]}-#${fresh.at(-1)}  (${fresh.length} new report row${fresh.length > 1 ? 's' : ''})`);
else if (dirty.length) out.push(`triage snapshots  (${dirty.join(', ')} changed on the fetch)`);

// 2. red staged branches
for (const f of ls(join(STATE, 'redgate'))) {
  const r = JSON.parse(readFileSync(join(STATE, 'redgate', f), 'utf8'));
  out.push(`repair ${r.branch}  (${r.item}; gate log ${r.log})`);
}

// 3. answered handoffs
for (const item of answered) {
  const j = journal.get(slug(item));
  if (j && j.outcome === 'resumed') continue;
  out.push(`resume ${item}  (answer in ${join(STATE, 'answers', item + '.md')})`);
}

// 4. reports agreed but not fixed
for (const e of LEDGER) {
  if (['live', 'partial'].includes(e.status)) push(`#${e.id}`, `report #${e.id}  [${e.status}] ${String(e.report).slice(0, 100)}`);
}

// 5. open CTs, high severity first
// severity first, then the area: card/engine correctness is "the queue that matters"
const SEV = { blocker: 0, major: 1, minor: 2 };
const AREA = { card: 0, attribute: 0, engine: 0, client: 1, coverage: 2 };
const cts = CARD_TODO.filter(e => e.status === 'open')
  .sort((a, b) => (SEV[a.severity] ?? 1) - (SEV[b.severity] ?? 1)
    || (AREA[a.area] ?? 1) - (AREA[b.area] ?? 1) || a.id - b.id);
for (const e of cts) push(`CT-${e.id}`, `CT-${e.id}  [${e.area}/${e.severity}] ${e.title}`);

// 6. the backlog's ready list
const byId = new Map(BACKLOG.map(e => [e.id, e]));
const SIZE = { S: 0, M: 1, L: 2 };
const ready = BACKLOG.filter(e => e.status === 'open' && !(e.asks && e.asks.length) && e.size !== 'XL'
  && (e.deps ?? []).every(d => byId.get(d)?.status === 'done'))
  .sort((a, b) => SIZE[a.size] - SIZE[b.size] || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
for (const e of ready) push(e.id, `${e.id}  [${e.size}] ${e.title}`);

// 7. tidy, once a night (the journal says when it last ran)
const lastTidy = journal.get('tidy');
if (!lastTidy || Date.now() - Date.parse(lastTidy.ts) > 20 * 3600e3) out.push('tidy  (ledger hygiene, once a night)');

console.log(out.join('\n'));
if (WHY && excluded.length) console.error('\nexcluded:\n  ' + excluded.join('\n  '));
