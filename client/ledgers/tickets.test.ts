/* The work queue's three locks: every report is accounted for, every open proof
 * still holds, and every settled fix is claimed by a test carrying its tag.
 *
 * Reports live on the game server; the snapshot is the committed copy, and a
 * report it does not hold does not exist here. Refresh it before triage:
 *   npm --prefix client run reports
 *   (scp algomancy-vps:/home/bena/Documents/Algomancy/var/issues.jsonl client/ledgers/playtest-issues.snapshot.jsonl)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ENGINE_TEST_DIR, ISSUES_JSONL, ISSUES_SNAPSHOT, OPEN_TICKETS_DIR, SERVER_E2E_DIR, SERVER_TEST_DIR,
  SETTLED_JSONL, UI_TEST_DIR, remote,
} from '../engine/scripts/paths.mjs';
import { nextIds, openIds, openTickets, settled, settledRows, ticketId, type CardTicket } from './tickets.ts';

const REFRESH = `npm --prefix client run reports   (i.e. scp ${remote(ISSUES_JSONL)} client/ledgers/playtest-issues.snapshot.jsonl)`;
const rows = settledRows();
const last = settled();
const open = new Set(openIds());
const reports = readFileSync(ISSUES_SNAPSHOT, 'utf8').split('\n').filter(l => l.trim())
  .map(l => JSON.parse(l) as { ts: string; room: string; note: string; fix?: unknown });
const ID = /^(#\d+|CT-\d+|BL-\d+|verdict:\S+)$/;
const AS: Record<string, string[]> = {
  '#': ['ticket', 'partial', 'fixed', 'by-design', 'wontfix', 'agreed-fix'],
  'C': ['done', 'wontfix'], 'B': ['done', 'wontfix', 'dropped'], 'v': ['ticket'],
};

test('every settled line is a row with an id and an outcome its kind allows', () => {
  const lines = readFileSync(SETTLED_JSONL, 'utf8').split('\n').filter(l => l.trim());
  assert.equal(lines.length, rows.length, 'a line of settled.jsonl is not JSON');
  const bad = rows.filter(r => !ID.test(r.id) || !AS[r.id[0]!]!.includes(r.as)).map(r => JSON.stringify(r).slice(0, 120));
  assert.deepEqual(bad, []);
});

test('1. every report has a row, and every row it points at is real', () => {
  const missing = reports.map((r, i) => (last.has(`#${i}`) ? '' : `#${i} (${r.room}, ${r.ts.slice(0, 10)}): ${JSON.stringify(r.note).slice(0, 100)}`)).filter(Boolean);
  assert.deepEqual(missing, [], 'reports with no row in settled.jsonl. Triage each: append {"id":"#N","as":…}');
  const beyond = [...last.keys()].filter(id => id.startsWith('#') && Number(id.slice(1)) >= reports.length);
  assert.deepEqual(beyond, [], `rows for reports the snapshot does not have; it is stale:\n  ${REFRESH}`);

  const problems: string[] = [];
  for (const r of last.values()) {
    for (const t of r.to ?? []) if (!open.has(t) && !last.has(t)) problems.push(`${r.id} points at ${t}, which is neither open nor settled`);
    // a report is open until its outcome row; a verdict stays answered by its ticket once that closes
    if (r.id.startsWith('#') && (r.as === 'ticket' || r.as === 'partial') && !(r.to ?? []).some(t => open.has(t))) {
      problems.push(`${r.id} is '${r.as}' but none of ${JSON.stringify(r.to ?? [])} is open any more: append its outcome row`);
    }
    if (['by-design', 'wontfix', 'agreed-fix', 'partial', 'dropped'].includes(r.as) && !r.note?.trim()) problems.push(`${r.id} is '${r.as}' and says nothing about why`);
    // by-design tells the owner his report was wrong, so it needs a source he can check
    if (r.as === 'by-design' && !/\bCR (?:\d{3}|D\d)|Manual|ruling|oracle|printed/i.test(r.note ?? '')) problems.push(`${r.id} is by-design and cites no source`);
    if (r.as === 'agreed-fix' && (!reports[Number(r.id.slice(1))]?.fix || (r.note ?? '').trim().length < 60)) {
      problems.push(`${r.id} is agreed-fix: its report must be one an agreed fix filed, and the note must say what was taken back and why that is no defect`);
    }
  }
  assert.deepEqual(problems, []);
});

test('2. every open proof still holds; an open file is never a settled id', async () => {
  const problems: string[] = [];
  for (const f of readdirSync(OPEN_TICKETS_DIR)) if (!/^(CT|BL)-\d+\.ts$/.test(f)) problems.push(`open/${f} is not named CT-n.ts or BL-n.ts`);
  for (const t of await openTickets()) {
    const id = ticketId(t);
    if (!open.has(id)) problems.push(`a file in open/ holds ${id}, which is not its name`);
    if (last.has(id)) problems.push(`${id} is open and also settled (${last.get(id)!.as}): ids are never reused; the next free is ${nextIds()[id.slice(0, 2) as 'CT' | 'BL']}`);
    const proof = (t as CardTicket).proof;
    if (typeof proof !== 'function') continue;
    let holds: boolean;
    try { holds = proof(); } catch (e) { problems.push(`${id}: its proof threw (${(e as Error).message}); repair it or close the ticket`); continue; }
    if (!holds) problems.push(`${id} "${(t as CardTicket).title}": the proof no longer holds, so it looks FIXED. Delete open/${id}.ts and append its settled row (and its reports' rows).`);
  }
  assert.deepEqual(problems, []);
  const by = (p: string) => [...open].filter(id => id.startsWith(p)).length;
  console.log(`    open: ${by('CT')} CT · ${by('BL')} BL · next free: ${nextIds().CT} ${nextIds().BL}`);
});

/** every runnable node:test title in the test trees, {todo:true} left out */
function titles(): string[] {
  const out: string[] = [];
  for (const dir of [ENGINE_TEST_DIR, UI_TEST_DIR, SERVER_TEST_DIR, SERVER_E2E_DIR]) {
    for (const f of readdirSync(dir).filter(f => /\.[cm]?ts$/.test(f))) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const m of src.matchAll(/\btest\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1([^)]*)/g)) {
        if (!/todo\s*:\s*true/.test(m[3] ?? '')) out.push(m[2]!);
      }
    }
  }
  return out;
}

test('3. every fix settled since the switch is claimed by a test carrying its tag', () => {
  const all = titles();
  const tag = (id: string) => new RegExp(`${id}(?!\\d)`);
  assert.ok(all.filter(t => /\b(CT|BL)-\d+|#\d+/.test(t)).length > 500, 'the title scan found almost no tagged tests; it is not reading the test trees');
  const unclaimed = [...last.values()]
    .filter(r => (r.as === 'done' || r.as === 'fixed') && !r.legacy)
    .filter(r => !all.some(t => tag(r.id).test(t)))
    .map(r => r.id);
  assert.deepEqual(unclaimed, [],
    'settled as done/fixed, but no test title carries the tag. Put the id in the title of the test '
    + 'that fails when this regresses (a {todo:true} test does not count).');
});
