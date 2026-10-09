/**
 * The RAQ register (ledgers/raq.ts) against the committed thread index
 * (ledgers/raq-threads.snapshot.jsonl).
 *
 * The owner, 2026-10-09: "Did we process each of those examples and turn them
 * into tests to ensure that the complex base of the game is being respected
 * as it's supposed to work?" We had not. Every RAQ thread had reached the bot;
 * the engine had been read against a thread only when a bug led there, and 37
 * of 52 were cited nowhere. This file makes a thread nobody has read a red
 * test the day it is exported, the way 70-playtest-ledger does for reports.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RAQ, type RaqEntry } from '../../ledgers/raq.ts';
import { CARD_TODO } from '../../ledgers/card-todo.ts';
import { RAQ_SNAPSHOT } from '../scripts/paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..', '..');

interface ThreadRow { id: string; title: string; marker: string; messages: number }
const rows: ThreadRow[] = fs.readFileSync(RAQ_SNAPSHOT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

/** a guard's file, wherever the ledgers look: engine, ui and server tests */
const sources = new Map<string, string | null>();
function sourceOf(rel: string): string | null {
  if (!sources.has(rel)) {
    const found = [path.join(HERE, rel), path.join(CLIENT, 'ui', 'test', rel), path.join(CLIENT, 'server', 'test', rel)]
      .find(p => fs.existsSync(p));
    sources.set(rel, found ? fs.readFileSync(found, 'utf8') : null);
  }
  return sources.get(rel)!;
}
/** every node:test title in a file, and whether it is {todo:true} */
function testTitles(src: string): { title: string; todo: boolean }[] {
  return [...src.matchAll(/\btest\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1([^)]*)/g)]
    .map(m => ({ title: m[2]!.replace(/\\(['"`\\])/g, '$1'), todo: /todo\s*:\s*true/.test(m[3] ?? '') }));
}

test('every exported rulings thread has a register entry, and every entry is a thread', () => {
  const have = new Set(RAQ.map(e => e.id));
  const missing = rows.filter(r => !have.has(r.id)).map(r => `${r.id} ${r.title}`);
  assert.deepEqual(missing, [],
    'these threads are in the export and nobody has read them against the engine. Add an entry to '
    + 'ledgers/raq.ts for each (status \'unreviewed\' at the least), then read it.');
  const known = new Set(rows.map(r => r.id));
  assert.deepEqual(RAQ.filter(e => !known.has(e.id)).map(e => `${e.id} ${e.title}`), [],
    'entries for threads the index does not hold — a typo, or the index needs `npm run raq:index`');
  const dup = RAQ.map(e => e.id).filter((id, i, a) => a.indexOf(id) !== i);
  assert.deepEqual(dup, [], 'one entry per thread');
});

test('a reviewed thread lists what it settles; a skipped one says why', () => {
  const bad: string[] = [];
  for (const e of RAQ) {
    if (e.status === 'reviewed' && !e.claims?.length) bad.push(`${e.id}: reviewed, but lists no claims`);
    if (e.status === 'skipped' && !e.note?.trim()) bad.push(`${e.id}: skipped with no note saying why`);
    if (e.status === 'unreviewed' && e.claims?.length) bad.push(`${e.id}: has claims, so it was read — mark it reviewed`);
  }
  assert.deepEqual(bad, []);
});

test('every claim carries its source and the evidence its status needs', () => {
  const tickets = new Set(CARD_TODO.map(t => t.id));
  const bad: string[] = [];
  const each = (e: RaqEntry, fn: (c: NonNullable<RaqEntry['claims']>[number], at: string) => void): void =>
    (e.claims ?? []).forEach((c, i) => fn(c, `${e.id} claim ${i + 1}`));
  for (const e of RAQ) {
    each(e, (c, at) => {
      if (!c.claim.trim() || !c.source.trim()) bad.push(`${at}: needs the claim and who said it`);
      if (c.status === 'covered' && !c.guards?.length) bad.push(`${at}: covered by what? name the test`);
      if (c.status === 'broken' && (c.ticket === undefined || !tickets.has(c.ticket))) {
        bad.push(`${at}: broken needs a real CT ticket (got ${c.ticket})`);
      }
      if ((c.status === 'outdated' || c.status === 'untestable') && !c.note?.trim()) {
        bad.push(`${at}: ${c.status} needs a note — what replaced it, or why it cannot be tested`);
      }
    });
  }
  assert.deepEqual(bad, []);
});

test('every guard a claim names is one real test that can fail', () => {
  const bad: string[] = [];
  for (const e of RAQ) {
    for (const c of e.claims ?? []) {
      for (const ref of c.guards ?? []) {
        const [file, needle] = ref.split('::');
        if (!file || !needle) { bad.push(`${e.id}: malformed guard "${ref}"`); continue; }
        const src = sourceOf(file);
        if (src === null) { bad.push(`${e.id}: no such test file "${file}"`); continue; }
        const hits = testTitles(src).filter(t => t.title.includes(needle));
        if (hits.length !== 1) bad.push(`${e.id}: "${needle}" matches ${hits.length} tests in ${file} — it must name exactly one`);
        else if (hits[0]!.todo) bad.push(`${e.id}: "${needle}" is {todo:true}, which cannot fail`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('the register reports honestly on how much is unread', () => {
  const count = (s: RaqEntry['status']): number => RAQ.filter(e => e.status === s).length;
  const claims = RAQ.flatMap(e => e.claims ?? []);
  const by = (s: string): number => claims.filter(c => c.status === s).length;
  console.log(`RAQ register: ${rows.length} threads — ${count('reviewed')} reviewed, ${count('skipped')} skipped, `
    + `${count('unreviewed')} unread · ${claims.length} claims: ${by('covered')} covered, ${by('broken')} broken, `
    + `${by('outdated')} outdated, ${by('untestable')} untestable`);
  assert.equal(count('reviewed') + count('skipped') + count('unreviewed'), RAQ.length);
});
