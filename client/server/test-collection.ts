/* Tests for the saved deck collection (run: node test-collection.ts).
 *
 * Two halves, same harness style as test-accounts.ts:
 *
 *   1. In-process: seeding the starter five, the edits (create / rename /
 *      cut / duplicate / delete), and the fold that turns the game history
 *      into a per-deck win/loss record.
 *   2. Integration: the /api/decks routes against a real server, and the one
 *      property the whole record rests on — a constructed game joined with a
 *      deck id writes that id into the saved room, and a client CANNOT claim
 *      an id that is not its own.
 *
 * §2's spoof check is the load-bearing one. The deck id is what a win is
 * credited to; if the wire could name any id, anybody could inflate any deck's
 * record (including somebody else's). The server re-reads the deck out of the
 * account behind the token and ignores what the client said.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Seat } from '../engine/src/types.ts';
import { gameFile, mintRoom, spawnServer } from './test-util.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-collection-test-'));
const STORE = join(SCRATCH, 'accounts.json');
const GAMES = join(SCRATCH, 'games');
process.env['ALGO_ACCOUNTS_FILE'] = STORE;
process.env['ALGO_GAMES_DIR'] = GAMES;

const { loadAccounts, register, stashHistory, saveAccounts, rebuildProfiles } = await import('./accounts.ts');
const {
  collectionView, createDeck, deckForPlay, deckRecords, decksOf, deleteDeck,
  duplicateDeck, updateDeck, visibilityOf,
} = await import('./collection.ts');
const {
  lineageRoots, metaList, publicDeckCounts, publicDecksOf, sharedDeck, sourceDeck,
} = await import('./publicdecks.ts');
const { defaultDecks } = await import('./decks.ts');

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

// ── 1. the starter five ───────────────────────────────────────────────

console.log('\n[the starter five]');
loadAccounts();
const made = register('Bena', 'a good password');
if (!made.ok) throw new Error(`could not register: ${made.error}`);
const bena = made.account;

{
  ok(bena.decks === undefined, 'a fresh account carries no collection until it is looked at');
  const view = collectionView(bena);
  eq(view.length, 5, 'looking at it seeds the five bundled decks');
  ok(view.every(d => d.cards.length === 30), 'each starter is 30 cards');
  ok(view.every(d => d.problems.length === 0), 'each starter is legal');
  ok(view.every(d => d.author === 'aramsunat'), 'each keeps its algomancer.cc builder');
  ok(view.every(d => d.url?.includes('algomancer.cc')), 'and its link home');
  ok(view.every(d => d.cover && d.cards.includes(d.cover)), 'each gets a cover card out of its own list');
  ok(view.every(d => d.record.games === 0), 'and no record yet');
  ok(new Set(view.map(d => d.id)).size === 5, 'ids are distinct');
  // they are COPIES: editing one must not reach the bundled originals
  const before = defaultDecks()[0]!.cards.length;
  updateDeck(bena, view[0]!.id, { cards: view[0]!.cards.slice(0, 10) });
  eq(defaultDecks()[0]!.cards.length, before, 'editing a starter does not touch the bundled deck');
  updateDeck(bena, view[0]!.id, { cards: view[0]!.cards });
}

console.log('\n[deleting them is a decision, not damage]');
{
  for (const d of [...decksOf(bena)]) deleteDeck(bena, d.id);
  eq(decksOf(bena).length, 0, 'all five can be deleted');
  eq(collectionView(bena).length, 0, 'and looking again does NOT re-seed them');
}

// ── 2. edits ──────────────────────────────────────────────────────────

console.log('\n[edits]');
const fire = defaultDecks()[0]!.cards;
let deckId = '';
{
  const r = createDeck(bena, { name: 'Burn', cards: fire });
  ok(r.ok, 'a deck can be created');
  if (!r.ok) throw new Error('cannot continue');
  deckId = r.deck.id;
  eq(r.deck.cards.length, 30, 'with its cards');
  ok(!!r.deck.cover, 'and a cover chosen for it');

  const dup = createDeck(bena, { name: 'Burn', cards: fire });
  ok(dup.ok && dup.deck.name === 'Burn (2)', 'a name clash is renamed, never refused');
  if (dup.ok) deleteDeck(bena, dup.deck.id);

  const junk = createDeck(bena, { name: 'Junk', cards: ['Ignis Sprite', 'Not A Real Card'] });
  ok(junk.ok && junk.deck.cards.length === 1, 'a card the engine cannot play is left out');
  ok(junk.ok && /not in the scripted pool/.test(junk.note ?? ''), 'and is NAMED rather than dropped silently');
  if (junk.ok) deleteDeck(bena, junk.deck.id);
}

console.log('\n[a patch only touches what it sends]');
{
  const before = decksOf(bena).find(d => d.id === deckId)!;
  const cards = [...before.cards];
  updateDeck(bena, deckId, { name: 'Burn v2' });
  const after = decksOf(bena).find(d => d.id === deckId)!;
  eq(after.name, 'Burn v2', 'a rename renames');
  ok(JSON.stringify(after.cards) === JSON.stringify(cards), 'and does not disturb the card list');

  // the cover follows a cut: a deck must never wear art it no longer plays
  const cover = after.cover!;
  updateDeck(bena, deckId, { cards: after.cards.filter(c => c !== cover) });
  const cut = decksOf(bena).find(d => d.id === deckId)!;
  ok(cut.cover !== cover, 'cutting the cover card picks a new cover');
  ok(cut.cover && cut.cards.includes(cut.cover), 'and the new one is in the deck');
  updateDeck(bena, deckId, { cards: fire });
}

console.log('\n[a half-built deck is saved, and simply says it is not legal]');
{
  const wip = createDeck(bena, { name: 'Work in progress', cards: fire.slice(0, 22) });
  ok(wip.ok, '22 cards saves without complaint');
  const view = collectionView(bena).find(d => d.name === 'Work in progress')!;
  ok(/at least 30/.test(view.problems.join(' ')), 'the shortfall is REPORTED');
  eq(deckForPlay(bena.id, view.id), null, 'and it cannot be brought to a game');
  if (wip.ok) deleteDeck(bena, wip.deck.id);
}

console.log('\n[twenty decks is the limit, and it says so]');
{
  const made: string[] = [];
  while (decksOf(bena).length < 20) {
    const r = createDeck(bena, { name: `filler ${decksOf(bena).length}`, cards: fire });
    if (!r.ok) break;
    made.push(r.deck.id);
  }
  eq(decksOf(bena).length, 20, 'twenty decks fit');
  const over = createDeck(bena, { name: 'the twenty-first', cards: fire });
  ok(!over.ok, 'the twenty-first is refused');
  ok(!over.ok && /limit/.test(over.error) && /delete one/.test(over.error),
    'with a sentence that says what to do, not an error code');
  for (const id of made) deleteDeck(bena, id);
  ok(decksOf(bena).length < 20, 'and deleting one lets the next through');
  const after = createDeck(bena, { name: 'room again', cards: fire });
  ok(after.ok, 'confirmed');
  if (after.ok) deleteDeck(bena, after.deck.id);
}

console.log('\n[duplicate]');
{
  const copy = duplicateDeck(bena, deckId);
  ok(copy.ok, 'a deck can be copied');
  if (copy.ok) {
    ok(copy.deck.id !== deckId, 'the copy is its own deck');
    eq(copy.deck.name, 'Burn v2 copy', 'named as a copy');
    eq(copy.deck.cards.length, 30, 'with the same cards');
    eq(copy.deck.cover, decksOf(bena).find(d => d.id === deckId)!.cover, 'and the same cover');
    deleteDeck(bena, copy.deck.id);
  }
  ok(!duplicateDeck(bena, 'not-an-id').ok, 'copying a deck that is not there fails cleanly');
  ok(!deleteDeck(bena, 'not-an-id').ok, 'and so does deleting one');
}

console.log('\n[bringing a deck to a game]');
{
  const play = deckForPlay(bena.id, deckId);
  ok(!!play && play.cards.length === 30, 'a legal deck of mine resolves for play');
  eq(deckForPlay(null, deckId), null, 'a logged-out seat brings no deck id');
  eq(deckForPlay(bena.id, 'someone-elses-id'), null, 'an id that is not mine resolves to nothing');
}

// ── 3. the record, folded out of the history ──────────────────────────

console.log('\n[the record is a fold, not a counter]');
{
  const seat = (won: boolean): any => ({
    name: 'x', won, lifeLeft: won ? 20 : 0, lifeLost: won ? 10 : 30,
    cardElements: {}, recycled: {}, cards: {},
    unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0, cardsDrafted: 0,
    resourcesActivated: 0, abilitiesActivated: 0, attacksDeclared: 0, unitsAttackedWith: 0,
    damageDealt: 0, unitsLost: 0, unitsKilled: 0,
  });
  const game = (code: string, won: boolean, deckIds: [string | null, string | null]): any => ({
    code, playedAt: `2026-08-2${code.length}T00:00:00.000Z`, recordedAt: new Date().toISOString(),
    mode: 'constructed', els: ['fire'], finished: true, winner: (won ? 0 : 1) as Seat, turns: 9,
    diverged: false, users: [bena.id, null], deckIds, names: ['Bena', 'Guest'],
    seats: [seat(won), seat(!won)],
  });
  stashHistory(game('AAA', true, [deckId, null]));
  stashHistory(game('BBBB', true, [deckId, null]));
  stashHistory(game('CCCCC', false, [deckId, null]));
  // a game the same account played with NO deck id (a draft, or a pasted list)
  stashHistory(game('DDDDDD', true, [null, null]));
  saveAccounts();

  const rec = deckRecords(bena)[deckId]!;
  ok(!!rec, 'the deck has a record');
  eq(rec.games, 3, 'only the games played WITH it count');
  eq(rec.wins, 2, 'wins');
  eq(rec.losses, 1, 'losses');
  ok(rec.lastPlayed === '2026-08-25T00:00:00.000Z', 'and when it last played');
  eq(collectionView(bena).find(d => d.id === deckId)!.record.games, 3,
    'and it reaches the client through the collection view');

  // the point of deriving it: a profile rebuild cannot make the two disagree
  rebuildProfiles();
  eq(deckRecords(bena)[deckId]!.wins, 2, 'a full profile rebuild leaves the deck record intact');

  // an unfinished game is neither a win nor a loss
  stashHistory({ ...game('EEEEEEE', true, [deckId, null]), finished: false, winner: null });
  const after = deckRecords(bena)[deckId]!;
  eq(after.games, 4, 'an unfinished game still counts as played');
  eq(after.unresolved, 1, 'as one with no result');
  eq(after.wins, 2, 'and does not become a win');
  saveAccounts();   // the HTTP half below reads this store back off disk
}

// ── 3b. publishing, lineage, and who may see what ─────────────────────

console.log('\n[private is the default, and nothing publishes itself]');
{
  const mine = decksOf(bena);
  ok(mine.every(d => visibilityOf(d) === 'private'),
    'every deck — the starter five included — starts private');
  eq(sharedDeck(deckId), null, 'a private deck is not shared, even by id');
  eq(sourceDeck(deckId), null, '…and cannot be taken');
  eq(metaList().length, 0, 'and the metagame list is empty');
}

console.log('\n[a private deck and a deck that does not exist answer the same]');
{
  // the property an unlisted link's secrecy rests on: this must not be usable
  // as an oracle for "does this id exist"
  eq(sharedDeck(deckId), sharedDeck('no-such-deck-at-all'),
    'private and nonexistent are indistinguishable from outside');
  eq(sharedDeck(''), null, 'and an empty id is not a deck');
}

console.log('\n[unlisted is the link, public is the list]');
{
  updateDeck(bena, deckId, { visibility: 'unlisted' });
  const unlisted = sharedDeck(deckId);
  ok(!!unlisted, 'an unlisted deck opens for anybody holding the link');
  eq(unlisted!.name, 'Burn v2', 'with its name');
  eq(unlisted!.owner.username, 'Bena', 'and who published it');
  eq(unlisted!.cards.length, 30, 'and the whole list');
  eq(metaList().length, 0, 'but it is NOT on the metagame list');
  eq(publicDecksOf(bena.id).length, 0, 'and not on the profile either');

  updateDeck(bena, deckId, { visibility: 'public' });
  eq(metaList().length, 1, 'public puts it on the list');
  eq(publicDecksOf(bena.id).length, 1, 'and on the profile');
  ok(!!sharedDeck(deckId), 'and the link still works');

  updateDeck(bena, deckId, { visibility: 'nonsense' });
  eq(visibilityOf(decksOf(bena).find(d => d.id === deckId)!), 'private',
    'an unrecognised visibility reads as private — the safe direction');
  eq(sharedDeck(deckId), null, 'so it is unshared again');
  updateDeck(bena, deckId, { visibility: 'public' });
}

console.log('\n[descriptions]');
{
  updateDeck(bena, deckId, { description: '# Burn\n\nIt burns. Lead on the two-drop.' });
  const d = sharedDeck(deckId)!;
  ok(d.description?.startsWith('# Burn'), 'the description rides along, raw');
  ok(!/&lt;|\\/.test(d.description ?? ''),
    'stored VERBATIM — it is markdown, and the client is what renders it');

  updateDeck(bena, deckId, { description: 'x'.repeat(99_999) });
  ok((decksOf(bena).find(x => x.id === deckId)!.description ?? '').length <= 6000,
    'and it is capped, so a stuck client cannot grow accounts.json');
  updateDeck(bena, deckId, { description: 'It burns.' });
}

console.log('\n[a patch still only touches what it sends]');
{
  const before = decksOf(bena).find(d => d.id === deckId)!;
  const cards = [...before.cards];
  updateDeck(bena, deckId, { name: 'Burn v2' });
  const after = decksOf(bena).find(d => d.id === deckId)!;
  eq(visibilityOf(after), 'public', 'renaming does not unpublish');
  eq(after.description, 'It burns.', 'nor blank the description');
  eq(after.cards.length, cards.length, 'nor touch the cards');
}

console.log('\n[taking a copy]');
{
  const rashi = register('Rashi', 'hunter2 hunter2');
  if (!rashi.ok) throw new Error('could not register the second account');
  const them = rashi.account;

  const src = sourceDeck(deckId);
  ok(!!src, 'a public deck can be taken');
  const copy = duplicateDeck(them, deckId, src!);
  ok(copy.ok, 'and the copy lands in the taker\'s collection');
  if (copy.ok) {
    eq(copy.deck.copiedFrom, deckId, 'stamped with where it came from');
    eq(visibilityOf(copy.deck), 'private',
      'A COPY IS NEVER BORN PUBLIC — taking somebody\'s deck must not publish one on your behalf');
    eq(copy.deck.description, 'It burns.', 'the description comes with it');
    eq(copy.deck.cards.length, 30, 'and the list');

    // …and the attribution the shared view prints
    updateDeck(them, copy.deck.id, { visibility: 'public' });
    const view = sharedDeck(copy.deck.id)!;
    eq(view.copiedFrom?.owner, 'Bena', 'the shared view names who it is after');
    eq(view.copiedFrom?.name, 'Burn v2', 'and which deck');

    console.log('\n[the record folds over the whole lineage]');
    // Bena's three games are on the original; the copy has none of its own
    const mineNow = deckRecords(bena)[deckId]!;
    eq(mineNow.games, 4, 'the OWNER\'s record is still only the owner\'s games');
    const meta = metaList();
    const root = meta.find(d => d.id === deckId)!;
    const child = meta.find(d => d.id === copy.deck.id)!;
    eq(root.record.games, 4, 'the lineage record counts the games played with the list');
    eq(child.record.games, 4, 'and a copy shows the SAME lineage record, not an empty one');
    eq(root.copies, 2, 'the lineage has two decks in it');

    console.log('\n[a lineage cannot hang the fold]');
    // hand-edit the store into the shapes nothing should produce
    const orig = decksOf(bena).find(d => d.id === deckId)!;
    orig.copiedFrom = 'a-deck-that-was-deleted';
    ok(metaList().length === 2, 'a missing parent ends the walk rather than dropping the deck');
    orig.copiedFrom = copy.deck.id;              // now root -> child -> root
    const roots = lineageRoots(new Map([[orig.id, orig], [copy.deck.id, copy.deck]]));
    ok(roots.size === 2, 'a cycle resolves rather than looping forever');
    ok(metaList().length === 2, 'and the list still builds');
    delete orig.copiedFrom;
  }

  console.log('\n[what the card browser counts]');
  {
    const counts = publicDeckCounts();
    const some = decksOf(bena).find(d => d.id === deckId)!.cards[0]!;
    ok((counts.get(some) ?? 0) >= 1, 'a card in a public deck is counted');
    // a card counts ONCE per deck however many copies are in it
    const twoOf = [...new Set(decksOf(bena).find(d => d.id === deckId)!.cards)];
    ok(counts.get(twoOf[0]!)! <= 2, 'and once per deck, not once per copy');
  }
  saveAccounts();
}

// ── 4. the HTTP routes and the wire ───────────────────────────────────

console.log('\n[server: /api/decks]');
const server = await spawnServer({ ALGO_ACCOUNTS_FILE: STORE, ALGO_GAMES_DIR: GAMES });
const PORT = server.port;
const base = `http://localhost:${PORT}`;
let ROOM = '';

const call = async (path: string, body?: unknown, token?: string): Promise<Record<string, any>> => {
  const res = await fetch(base + path, {
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  return { ...(await res.json() as Record<string, any>), _status: res.status };
};

try {
  const anon = await call('/api/decks');
  eq(anon['_status'], 401, 'a collection needs a login');

  const login = await call('/api/auth/login', { username: 'Bena', password: 'a good password' });
  const token = login['token'] as string;
  ok(!!token, 'logged in');

  const list = await call('/api/decks', undefined, token);
  ok(list['ok'] && Array.isArray(list['decks']), 'the collection lists');
  const burn = (list['decks'] as any[]).find(d => d.name === 'Burn v2');
  ok(!!burn, 'the deck built in-process is there');
  eq(burn.record.games, 4, 'carrying its record');

  const created = await call('/api/decks/create', { name: 'Over HTTP', cards: fire }, token);
  ok(created['ok'] && created['id'], 'create works over HTTP');
  const newId = created['id'] as string;
  ok((created['decks'] as any[]).some(d => d.id === newId), 'and the whole collection comes back');

  const renamed = await call('/api/decks/update', { id: newId, name: 'Renamed' }, token);
  eq((renamed['decks'] as any[]).find(d => d.id === newId).name, 'Renamed', 'update renames');
  eq((renamed['decks'] as any[]).find(d => d.id === newId).cards.length, 30,
    'and a name-only patch keeps the cards');

  const imported = await call('/api/decks/import',
    { text: fire.map(c => `1 ${c}`).join('\n'), name: 'Pasted' }, token);
  ok(imported['ok'], 'a pasted list imports straight into the collection');
  const pasted = (imported['decks'] as any[]).find(d => d.id === imported['id']);
  eq(pasted.name, 'Pasted', 'under the name asked for');
  eq(pasted.cards.length, 30, 'with its cards');

  const junk = await call('/api/decks/import', { text: '2 Not A Real Card' }, token);
  ok(junk['ok'] && /not in the scripted pool|unknown card/.test(String(junk['note'] ?? '')),
    'an unimportable list still says what went wrong');

  const badLink = await call('/api/decks/import', { url: 'https://example.com/nope' }, token);
  ok(!badLink['ok'] && /algomancer/.test(String(badLink['error'])), 'a link that is not a deck link is refused');

  console.log('\n[server: the published half, with NO login]');
  {
    // These are the only unauthed reads of somebody's deck in the whole API,
    // which is why they live on /api/deck/* and not behind /api/decks' 401.
    const meta = await call('/api/deck/meta');
    eq(meta['_status'], 200, 'the metagame list answers a logged-out visitor');
    ok(meta['ok'] && Array.isArray(meta['decks']), 'with a list');
    ok(typeof meta['minGames'] === 'number',
      'and the floor it ranked by, so the page and the server agree on it');
    ok((meta['decks'] as any[]).every(d => d.visibility === 'public'),
      'and NOTHING on it is private or unlisted');

    const shared = await call(`/api/deck/shared?id=${burn.id}`);
    ok(shared['ok'] && shared['deck'], 'a share link opens without a login');
    eq(shared['deck'].name, 'Burn v2', 'and carries the deck');

    const priv = await call('/api/decks/create', { name: 'Secret', cards: fire }, token);
    const secret = await call(`/api/deck/shared?id=${priv['id']}`);
    ok(!secret['ok'], 'a private deck does not open');
    const nothing = await call('/api/deck/shared?id=not-a-real-id');
    eq(JSON.stringify(secret), JSON.stringify(nothing),
      'and answers exactly as a nonexistent one does — no id oracle');

    const played = await call('/api/deck/played');
    ok(played['ok'] && played['counts'], 'the played-in counts answer too');

    console.log('\n[server: taking a copy]');
    const noAuth = await call('/api/decks/take', { id: burn.id });
    eq(noAuth['_status'], 401, 'taking a copy needs a login — it writes to a collection');

    const rashiLogin = await call('/api/auth/login', { username: 'Rashi', password: 'hunter2 hunter2' });
    const theirToken = rashiLogin['token'] as string;
    const took = await call('/api/decks/take', { id: burn.id }, theirToken);
    ok(took['ok'], 'a public deck can be taken over HTTP');
    const gained = (took['decks'] as any[]).find(d => d.id === took['id']);
    eq(gained.copiedFrom, burn.id, 'stamped with its parent');
    ok(!gained.visibility || gained.visibility === 'private', 'and private');

    const stealPrivate = await call('/api/decks/take', { id: priv['id'] }, theirToken);
    ok(!stealPrivate['ok'], 'a PRIVATE deck cannot be taken, id or no id');

    await call('/api/decks/delete', { id: priv['id'] }, token);
  }

  const gone = await call('/api/decks/delete', { id: newId }, token);
  ok(gone['ok'] && !(gone['decks'] as any[]).some(d => d.id === newId), 'delete deletes');

  // ── the wire: which deck a seat brought ──
  console.log('\n[server: a constructed seat brings a deck id]');
  ROOM = await mintRoom(PORT);
  const wsFor = async (): Promise<WebSocket> => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise<void>(res => ws.addEventListener('open', () => res(), { once: true }));
    return ws;
  };
  const a = await wsFor();
  const b = await wsFor();
  const seen: any[] = [];
  for (const ws of [a, b]) ws.addEventListener('message', ev => seen.push(JSON.parse(String((ev as MessageEvent).data))));

  a.send(JSON.stringify({ t: 'join', room: ROOM, seat: 0, mode: 'constructed', token, deck: fire, deckId: burn.id }));
  await new Promise(res => setTimeout(res, 400));
  // seat 1 is NOT logged in and claims seat 0's deck id — the classic spoof
  b.send(JSON.stringify({ t: 'join', room: ROOM, seat: 1, name: 'Guest', deck: fire, deckId: burn.id }));
  await new Promise(res => setTimeout(res, 700));

  ok(seen.some(m => m.t === 'joined' && m.view), 'both decks are in and the game dealt');
  const saved = JSON.parse(readFileSync(gameFile(ROOM), 'utf8')) as { deckIds?: (string | null)[] };
  eq(saved.deckIds?.[0], burn.id, 'the saved room records the deck seat 0 brought');
  eq(saved.deckIds?.[1], null,
    'and REFUSES the id seat 1 claimed — it is not their deck, so nothing is credited');

  a.close(); b.close();
  console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURES ✗`);
} finally {
  await server.stop();
  if (ROOM) rmSync(gameFile(ROOM), { force: true });
  rmSync(SCRATCH, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
