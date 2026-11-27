/* card-history.ts: which cards have changed since a recorded commit.
 *
 * A replay draws today's cards, and its fingerprints do not hold printed
 * numbers, so a cost change replays as recorded under today's cost. These pin
 * the diff that names such cards: what counts as a change and in which word,
 * what does not count, a rename, a removal, and "can't tell" for a stamp that
 * names no readable commit. The last test reads the real git history.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  CANT_TELL, cardHistory, changedIn, diffOracles, gitHistoryReader, stringsIn, type CardChange, type HistoryReader,
} from '../card-history.ts';
import { repoDir } from '../engine-version.ts';

type Row = Record<string, unknown>;

const row = (name: string, over: Row = {}): Row => ({
  name, power: '2', toughness: '2', cost: 'd', total_cost: '3', type: 'Horror Unit',
  text: 'When I spawn, draw a card.', image: `https://img/${name}.png`, factions: ['dark'],
  revision_date_time: '2026-08-19 00:00:00.000000', source: 'scan', Num_Copies: '1', rulings: [],
  details: '', complexity: 'Simple', Side: 'Front', Backside: 'Cardback', Deck: 'Light & Dark (Dark)',
  ...over,
});
const oracle = (...rows: Row[]): Record<string, Row[]> => Object.fromEntries(rows.map(r => [r.name as string, [r]]));

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

/** a reader over two hand-built oracles, counting how often git is asked */
function fakeReader(then: Record<string, Row[]>, now: Record<string, Row[]>, scans: string[] = []) {
  const calls = { oracleAt: 0, scans: 0 };
  const reader: HistoryReader = {
    async oracleAt(sha) { calls.oracleAt++; return sha === SHA_A ? JSON.stringify(then) : null; },
    async scansChangedSince(sha) { calls.scans++; return sha === SHA_A ? scans : null; },
    oracleNow: () => JSON.stringify(now),
    canonical: n => (n === 'Old Horror' ? 'New Horror' : n),
  };
  return { reader, calls };
}

const byCard = (out: CardChange[]): Map<string, CardChange> => new Map(out.map(c => [c.card, c]));

test('card history: a changed cost is listed as cost, and an unchanged card is not listed', async () => {
  const then = oracle(row('Murkstalker'), row('Fireball'));
  const now = oracle(row('Murkstalker', { total_cost: '2' }), row('Fireball'));
  const { reader } = fakeReader(then, now);
  const out = await cardHistory(reader)(SHA_A);
  assert.ok(Array.isArray(out));
  assert.deepEqual(out, [{ card: 'Murkstalker', fields: ['cost'] }]);
});

test('card history: each printed part has its word, and bookkeeping fields are not changes', () => {
  const then = oracle(row('A'), row('B'), row('C'), row('D'));
  const now = oracle(
    row('A', { power: '3', toughness: '1', factions: ['dark', 'fire'], cost: 'df' }),
    row('B', { type: 'Horror Spell', text: 'Draw two cards.', image: 'https://img/B2.png' }),
    // every field a player never sees, changed at once
    row('C', { revision_date_time: '2026-11-27', source: 'x', Num_Copies: '2', rulings: ['r'],
      details: 'note', complexity: 'Complex', Side: 'Back', Backside: 'x', Deck: 'y', Numeral: '3' }),
    row('D'),
  );
  const out = byCard(diffOracles(then, now, new Set(['D.jpg']), n => n));
  assert.deepEqual(out.get('A')?.fields, ['cost', 'power', 'toughness']);
  assert.deepEqual(out.get('B')?.fields, ['type', 'text', 'art']);
  assert.equal(out.has('C'), false, 'a bookkeeping change is not a change a player can see');
  assert.deepEqual(out.get('D')?.fields, ['art'], 'a replaced scan is new art even when the row is the same');
});

test('card history: a renamed card is listed under its new name with its old one', () => {
  const then = oracle(row('Old Horror', { image: 'https://img/oh.png' }), row('Grim Bargain', { image: 'https://img/gb.png' }),
    row('Gone Card'));
  const now = oracle(
    row('New Horror', { power: '5', image: 'https://img/nh.png' }),
    row('Consuming Mass', { image: 'https://img/gb.png' }),
  );
  const out = byCard(diffOracles(then, now, new Set(), n => (n === 'Old Horror' ? 'New Horror' : n)));
  assert.deepEqual(out.get('New Horror'), { card: 'New Horror', was: 'Old Horror', fields: ['name', 'power', 'art'] },
    'renamed through the engine alias, new art and all');
  assert.deepEqual(out.get('Consuming Mass'), { card: 'Consuming Mass', was: 'Grim Bargain', fields: ['name'] },
    'renamed with no alias: the one new card carrying its upstream image');
  assert.deepEqual(out.get('Gone Card'), { card: 'Gone Card', fields: ['removed'] });
  assert.equal(out.size, 3);
});

test('card history: an unknown or unreadable stamp is cant-tell, never a guess', async () => {
  const { reader, calls } = fakeReader(oracle(row('A')), oracle(row('A', { power: '9' })));
  const since = cardHistory(reader);
  assert.equal(await since('unknown'), CANT_TELL);
  assert.equal(await since('abc123'), CANT_TELL, 'an abbreviated sha is not a stamp');
  assert.equal(calls.oracleAt, 0, 'an invalid stamp never reaches git');
  assert.equal(await since(SHA_B), CANT_TELL, 'a commit git cannot show');
  const broken: HistoryReader = { ...reader, oracleNow: () => null };
  assert.equal(await cardHistory(broken)(SHA_A), CANT_TELL, 'no running oracle');
  const noScans: HistoryReader = { ...reader, scansChangedSince: async () => null };
  assert.equal(await cardHistory(noScans)(SHA_A), CANT_TELL, 'a scan diff git refused');
});

test('card history: one answer per sha, read from git once', async () => {
  const { reader, calls } = fakeReader(oracle(row('A')), oracle(row('A', { power: '9' })));
  const since = cardHistory(reader);
  const [x, y] = await Promise.all([since(SHA_A), since(SHA_A)]);
  await since(SHA_A);
  assert.deepEqual(x, y);
  assert.equal(calls.oracleAt, 1);
  assert.equal(calls.scans, 1);
});

test('card history: only the cards a game shows, under either name', () => {
  const changes: CardChange[] = [
    { card: 'Murkstalker', fields: ['cost'] },
    { card: 'Consuming Mass', was: 'Grim Bargain', fields: ['name'] },
    { card: 'Fireball', fields: ['text'] },
  ];
  const seen = stringsIn({ decks: [['Murkstalker', 'Grim Bargain'], null], names: ['alice', 'bob'],
    log: 'Fireball was mentioned in prose only' });
  assert.deepEqual(changedIn(changes, seen).map(c => c.card), ['Murkstalker', 'Consuming Mass']);
  assert.equal(changedIn(CANT_TELL, seen), CANT_TELL);
});

test('card history: the real history names the cards of a real card update', async () => {
  // 26e536f0 changed Murkstalker (cost 3 to 2, drains 1), Seer of Empty Spaces
  // (cost 1 to 2) and The Everywhere (text). The running oracle is pinned to that
  // commit so a later card edit cannot move this answer; the scans are read
  // against the files on disk, as the server reads them.
  const sha = (r: string): string => execFileSync('git', ['-C', repoDir(), 'rev-parse', r], { encoding: 'utf8' }).trim();
  const real = gitHistoryReader();
  const after = await real.oracleAt(sha('26e536f0'));
  assert.ok(after, 'git could not show 26e536f0: this checkout needs its full history');
  const since = cardHistory({ ...real, oracleNow: () => after });
  const out = await since(sha('26e536f0^'));
  assert.ok(Array.isArray(out), 'the parent commit is readable');
  const got = byCard(out);
  assert.deepEqual(got.get('Murkstalker')?.fields.filter(f => f !== 'art'), ['cost', 'text']);
  assert.deepEqual(got.get('Seer of Empty Spaces')?.fields.filter(f => f !== 'art'), ['cost']);
  assert.deepEqual(got.get('The Everywhere')?.fields.filter(f => f !== 'art'), ['text']);
  assert.ok(got.get('Murkstalker')?.fields.includes('art'), 'its scan was replaced in that commit');
  const rowChanges = out.filter(c => c.fields.some(f => f !== 'art')).map(c => c.card).sort();
  assert.deepEqual(rowChanges, ['Murkstalker', 'Seer of Empty Spaces', 'The Everywhere'],
    'nothing else in the oracle changed in that commit');
  // 1562a1b5 moved the oracle into data/cards: a commit before it is read at the old path
  assert.ok(await real.oracleAt(sha('1562a1b5^')), 'a stamp from before the oracle moved is still readable');
});
