/**
 * THE BACKLOG HAS TO BE TRUE, OR IT IS A TEXT FILE AGAIN.
 *
 * The owner asked for "a db of things to do with detail" explicitly INSTEAD of
 * a text file, so the thing that separates the two has to be mechanical. A
 * list of intentions rots in exactly three ways, and each one has an assertion
 * here:
 *
 *   1. It points at files that no longer exist. Every `touches` path is
 *      checked against disk — when a file moves, the suite names the entry
 *      that is now lying about where the work is. This is the assertion that
 *      earns its keep; the rest are hygiene.
 *   2. It claims things are done that are not. `done` demands a commit AND a
 *      guard test, the same rule `playtest-ledger.ts` adopted after reports
 *      #10 and #28 showed that "done" in a commit message is not done.
 *   3. It accumulates entries nobody could act on. Every entry must say how a
 *      human would know it is finished, and an entry whose design questions
 *      are still open cannot be marked `active` — you cannot be building
 *      something the owner has not decided yet.
 *
 * A tally prints on every run so the number cannot be quietly ignored, along
 * with the READY list: open, unblocked, no open questions, small enough to
 * finish. That list is the answer to "an agent has down time, what should it
 * do".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKLOG, type Entry } from './backlog.ts';

/** repo root: backlog/ → digital-client/ → the repo */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const byId = new Map(BACKLOG.map(e => [e.id, e]));
const open = BACKLOG.filter(e => e.status === 'open');
const active = BACKLOG.filter(e => e.status === 'active');
const done = BACKLOG.filter(e => e.status === 'done');
const dropped = BACKLOG.filter(e => e.status === 'dropped');

/** an entry a down-time agent can start right now, with nobody to ask */
function isReady(e: Entry): boolean {
  if (e.status !== 'open') return false;
  if (e.asks && e.asks.length) return false;
  if (e.size === 'XL') return false;
  return (e.deps ?? []).every(d => byId.get(d)?.status === 'done');
}

test('ids and slugs are unique and well-formed', () => {
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const e of BACKLOG) {
    assert.match(e.id, /^BL-\d{2}$/, `${e.id}: id must look like BL-07`);
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
    ids.add(e.id);
    assert.match(e.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${e.id}: slug must be kebab-case, got "${e.slug}"`);
    assert.ok(!slugs.has(e.slug), `duplicate slug ${e.slug} (${e.id})`);
    slugs.add(e.slug);
    assert.ok(e.title.trim().length > 0, `${e.id}: needs a title`);
  }
});

test('every entry carries the owner\'s words and the settled reading', () => {
  for (const e of BACKLOG) {
    // `said` is the tiebreaker when an agent disagrees with `means`, so it can
    // never be empty — an entry with no source is an entry somebody invented.
    assert.ok(e.said.trim().length > 0, `${e.id}: \`said\` must quote the owner`);
    assert.ok(e.means.trim().length > 20, `${e.id}: \`means\` must actually explain it`);
  }
});

test('every entry says how a human would know it is finished', () => {
  for (const e of BACKLOG) {
    assert.ok(
      e.doneWhen.length > 0,
      `${e.id} (${e.slug}): no acceptance criteria — that makes it a wish, not a task`,
    );
    for (const d of e.doneWhen) {
      assert.ok(d.trim().length > 0, `${e.id}: empty doneWhen line`);
    }
  }
});

test('every `touches` path still exists on disk', () => {
  // THE ROT DETECTOR. Files move; an entry pointing at a file that is gone is
  // sending the next agent to the wrong place, silently.
  const missing: string[] = [];
  for (const e of BACKLOG) {
    assert.ok(e.touches.length > 0, `${e.id} (${e.slug}): must point at where the work lands`);
    for (const rel of e.touches) {
      assert.ok(!path.isAbsolute(rel), `${e.id}: \`touches\` must be repo-root-relative, got "${rel}"`);
      if (!fs.existsSync(path.join(ROOT, rel))) missing.push(`${e.id} (${e.slug}) → ${rel}`);
    }
  }
  assert.deepEqual(
    missing, [],
    `backlog entries point at files that no longer exist — fix the path or the entry:\n  ${missing.join('\n  ')}`,
  );
});

test('deps resolve, and there are no cycles', () => {
  for (const e of BACKLOG) {
    for (const d of e.deps ?? []) {
      assert.ok(byId.has(d), `${e.id}: depends on ${d}, which does not exist`);
      assert.notEqual(d, e.id, `${e.id}: depends on itself`);
    }
  }
  // plain DFS — the graph is tiny and an explicit walk names the cycle
  const state = new Map<string, 'visiting' | 'done'>();
  const walk = (id: string, trail: string[]): void => {
    if (state.get(id) === 'done') return;
    assert.notEqual(state.get(id), 'visiting', `dependency cycle: ${[...trail, id].join(' → ')}`);
    state.set(id, 'visiting');
    for (const d of byId.get(id)?.deps ?? []) walk(d, [...trail, id]);
    state.set(id, 'done');
  };
  for (const e of BACKLOG) walk(e.id, []);
});

test('nothing is done without a commit and a guard', () => {
  for (const e of done) {
    assert.ok(e.evidence, `${e.id} (${e.slug}): marked done with no evidence`);
    assert.match(e.evidence.commit, /^[0-9a-f]{7,40}$/, `${e.id}: evidence.commit must be a real sha`);
    assert.ok(
      e.evidence.guards.length > 0,
      `${e.id}: done needs a test that would fail if it regressed — "done" in a commit message is not done`,
    );
    for (const g of e.evidence.guards) {
      const file = g.split('::')[0]!;
      assert.match(file, /\.test\.ts$/, `${e.id}: guard "${g}" must name a .test.ts file`);
      const hits = fs.existsSync(path.join(ROOT, file))
        || fs.existsSync(path.join(ROOT, 'digital-client/engine/test', file))
        || fs.existsSync(path.join(ROOT, 'digital-client/server', file));
      assert.ok(hits, `${e.id}: guard "${g}" names a test file that does not exist`);
    }
  }
  for (const e of BACKLOG) {
    if (e.status !== 'done') {
      assert.ok(!e.evidence, `${e.id}: has evidence but is not marked done`);
    }
  }
});

test('an entry with open questions is not being built', () => {
  for (const e of active) {
    assert.ok(
      !(e.asks && e.asks.length),
      `${e.id} (${e.slug}): active with unanswered questions — get them answered or move it back to open`,
    );
    assert.ok(
      (e.notes ?? '').trim().length > 0,
      `${e.id}: active entries must say in \`notes\` who is on it and since when`,
    );
  }
});

test('a dropped entry says why', () => {
  for (const e of dropped) {
    assert.ok(
      (e.notes ?? '').trim().length > 0,
      `${e.id} (${e.slug}): dropped with no reason recorded — that loses the decision`,
    );
  }
});

test('the tally, and what is ready to pick up', () => {
  const ready = BACKLOG.filter(isReady);
  const blocked = open.filter(e => !isReady(e));
  const size = (s: string): number => BACKLOG.filter(e => e.size === s).length;

  console.log(
    `\nBACKLOG: ${BACKLOG.length} entries — ${open.length} open, ${active.length} active, `
    + `${done.length} done, ${dropped.length} dropped`
    + `\n  by size: S ${size('S')}  M ${size('M')}  L ${size('L')}  XL ${size('XL')}`
    + `\n  by track: qol ${BACKLOG.filter(e => e.track === 'qol').length}, `
    + `feature ${BACKLOG.filter(e => e.track === 'feature').length}`
    + `\n\n  READY (open, unblocked, no open questions, not XL) — ${ready.length}:`
    + (ready.length
      ? '\n' + ready.map(e => `    ${e.id} [${e.size}] ${e.title}`).join('\n')
      : '\n    (none — every open entry is blocked or waiting on an answer)')
    + `\n\n  waiting on the owner or on a dependency — ${blocked.length}:`
    + '\n' + blocked.map(e => {
      const why = e.size === 'XL'
        ? 'XL — needs a design pass, not a down-time slot'
        : (e.asks && e.asks.length)
          ? `${e.asks.length} open question${e.asks.length === 1 ? '' : 's'}`
          : `blocked on ${(e.deps ?? []).filter(d => byId.get(d)?.status !== 'done').join(', ')}`;
      return `    ${e.id} [${e.size}] ${e.title} — ${why}`;
    }).join('\n')
    + '\n',
  );

  // Not an assertion about the numbers — only that the list is not empty, which
  // would mean the backlog has stopped being a queue and become an archive.
  assert.ok(BACKLOG.length > 0, 'the backlog is empty');
});
