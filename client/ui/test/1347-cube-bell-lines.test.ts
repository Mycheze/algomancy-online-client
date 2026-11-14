/* 1347 — THE BELL'S CUBE LINES (docs/25), DRAWN WITHOUT A PAGE.
 *
 * /api/inbox sends a player's cube-event news under `cube` (server/cube-store.ts cubeNotesFor).
 * The same discipline as the league's lines (491): every kind the server can send has its own
 * line in ui/cubenotes.ts, read off the server's `CubeNoteKind` union, never a list kept here.
 *
 *   §1 ⭐ every server kind has a line, not the fallback a kind newer than the page gets
 *   §2 the words: plain and short, each case of `round` (Swiss, a bye, round robin's schedule)
 *   §3 what a player typed (the event's name, an opponent's name) is never markup
 *   §4 drawn in the bell: a "Cube draft" group, unread marked, one Open button carrying the event
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LEAGUE_STORE_TS } from '../../engine/scripts/paths.mjs';
import { CUBE_NOTE_KINDS, cubeNoteLine } from '../cubenotes.ts';
import { inboxListHtml } from '../pages/inbox.ts';
import type { CubeNote, CubeNoteKind } from '../../server/cube-types.ts';

/** the server's union, off its source (cube-types.ts sits beside league-store.ts) */
function serverKinds(): string[] {
  const src = readFileSync(join(dirname(LEAGUE_STORE_TS), 'cube-types.ts'), 'utf8');
  const union = /export type CubeNoteKind =([^;]*);/.exec(src);
  assert.ok(union, 'CubeNoteKind not found in cube-types.ts');
  return [...union[1]!.replace(/\/\/[^\n]*/g, '').matchAll(/'([a-z-]+)'/g)].map(m => m[1]!);
}

const note = (kind: string, over: Partial<CubeNote> = {}): CubeNote =>
  ({ id: 'QZXV:1', event: 'QZXV', eventName: 'Friday cube', kind: kind as CubeNoteKind, at: 1000, read: false, ...over });
const text = (html: string): string => html.replace(/<[^>]+>/g, '');

test('1347 §1 ⭐ every cube message the server can send has a line in the bell', () => {
  const kinds = serverKinds();
  assert.ok(kinds.length >= 4 && kinds.includes('starting') && kinds.includes('done'), `found ${kinds.join(', ')}`);
  assert.deepEqual([...CUBE_NOTE_KINDS].sort(), [...kinds].sort(), 'the page knows exactly the server\'s kinds');
  const fallback = cubeNoteLine(note('a-kind-from-the-future'));
  assert.match(text(fallback), /Friday cube/, 'a newer kind is still a line');
  for (const k of kinds) {
    const html = cubeNoteLine(note(k, { round: 2, opponent: 'Sim Ada' }));
    assert.notEqual(html, fallback, `${k} falls through to the fallback line`);
    assert.ok(text(html).length > 10, `${k} says something`);
  }
});

test('1347 §2 the words', () => {
  assert.equal(text(cubeNoteLine(note('starting'))), 'The draft is starting — Friday cube.');
  assert.equal(text(cubeNoteLine(note('round', { round: 2, opponent: 'Sim Ada' }))), 'Round 2 is up: you play Sim Ada.');
  assert.equal(text(cubeNoteLine(note('round', { round: 3, opponent: null }))), 'Bye this round — Friday cube.');
  assert.equal(text(cubeNoteLine(note('round'))), 'The schedule is posted — Friday cube.', 'round robin: no round, no opponent');
  assert.equal(text(cubeNoteLine(note('match', { opponent: 'Bo' }))), 'Your match is ready: Bo.');
  assert.equal(text(cubeNoteLine(note('done'))), 'Friday cube is over.');
});

test('1347 §3 typed names are escaped', () => {
  const evil = '<img src=x onerror=alert(1)>';
  for (const k of [...CUBE_NOTE_KINDS, 'future']) {
    const html = cubeNoteLine(note(k, { eventName: evil, round: 1, opponent: evil }));
    assert.ok(!html.includes('<img'), `${k}: a typed name is escaped`);
  }
});

test('1347 §4 drawn in the bell', () => {
  const empty = { bellMsg: '', matches: [], invites: [], times: [], requests: [], notes: [] };
  assert.doesNotMatch(inboxListHtml({ ...empty, cube: [] }), /Cube draft/, 'none: no group');
  assert.match(inboxListHtml({ ...empty, cube: [] }), /Nothing new/);
  const h = inboxListHtml({ ...empty, cube: [
    { event: 'QZXV', read: false, html: cubeNoteLine(note('starting')) },
    { event: 'AB12', read: true, html: cubeNoteLine(note('done', { event: 'AB12' })) },
  ] });
  assert.match(h, /<div class="zonelabel">Cube draft<\/div>/);
  assert.doesNotMatch(h, /Nothing new/);
  const cards = [...h.matchAll(/<div class="invitecard leaguenote( unread)?">([\s\S]*?)<\/div>\s*<\/div>/g)];
  assert.equal(cards.length, 2);
  assert.ok(cards[0]![1], 'an unread line is marked');
  assert.ok(!cards[1]![1], 'a read one is not');
  assert.match(cards[0]![2]!, /<button data-inbox="cube" data-event="QZXV">Open<\/button>/);
  assert.match(cards[1]![2]!, /data-event="AB12"/);
});
