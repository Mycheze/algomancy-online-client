/* AN ALIASED CARD NAME, AND EVERYTHING ALREADY WRITTEN UNDER IT.
 *
 * `registerAlias(old, now)` makes getCard() resolve a card's other name: the
 * printed misspelling "Counter Theif" (our data says Counter Thief), the
 * retired token name "Wight" (now Wraith), and the next card renamed upstream.
 * That alone covers a LOOKUP; it does not cover the places where a STORED name
 * meets the registry as a value or as text. A pasted list, an older saved deck
 * or game, a stat row or a ruling can hold either spelling, and the rule is the
 * same everywhere: canonicalise ON READ, at the boundary.
 *
 *   §1  deck checks — checkDeck / checkSingleCard / checkSingleDeck refused the
 *       alias outright ("not in the scripted pool")
 *   §2  createGame deals an alias-spelled deck as the same game, in today's names
 *   §3  the deal/ban sanitizers, the pasted-list importer, the stored
 *       collection deck, the profile fold and the card ladder all fold the
 *       alias into the card
 *   §3b the card search (the browser and the bot's /api/cardsearch) finds the
 *       card by the name the card prints and older rulings use
 *   §4  a saved REF spelled the old way is the same ref (zonedelta canonicalRef),
 *       including a zone delta whose entries re-sort under the new name
 *   §6  end to end: a game saved under the alias restores with no drift,
 *       replays as recorded, and its card ledger counts the card once
 *
 * Counter Theif is the alias these cases are written with, and it is honest
 * about one thing: no engine ever wrote "Counter Theif" into a saved game (the
 * state has always stored the canonical name, and the alias predates the
 * board fingerprints). So §6's saved game is a game spelled the old way BY
 * HAND, which is exactly what a game recorded before a future rename would
 * look like. What Counter Theif cannot express:
 *   - the board fingerprint (§5 of the round this came from) — a fingerprint is
 *     a digest, and only a rename made after fingerprints began needs one
 *     spelled the old way; Counter Theif never was, so there is nothing to test
 *   - a delta that RE-SORTS under the new name — no card name sorts between
 *     "Counter Theif" and "Counter Thief". The last test registers a
 *     throwaway alias in this process (nothing else sees it) to reach that
 *     branch; it is the last test in the file on purpose.
 *
 * Nothing under var/ is rewritten, and `referenceKey` / `zoneDelta` /
 * `signature` write what they always wrote.
 *
 * Seeds: 45100-45199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkDeck, checkSingleCard, checkSingleDeck, createGame, forcedAction,
} from '../../engine/src/apply.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { canonicalCardName, registerAlias } from '../../engine/src/cards/dsl.ts';
import { sanitizeDraftDeal } from '../../engine/src/draftdeal.ts';
import type { Action, CardName, GameState, Seat } from '../../engine/src/types.ts';
import { sanitizeCustomRules } from '../../ui/customrules.ts';
import { canonicalRef, zoneDelta } from '../zonedelta.ts';
import { foldCardLadder, singleCardsOf } from '../cardladder.ts';
import { ledgerForFile, type LedgerFile } from '../cardledger.ts';
import { importDeckText } from '../decks.ts';
import { cardSearchPayload } from '../api-cardsearch.ts';
import type { Room } from '../rooms.ts';

const OLD = 'Counter Theif';
const NOW = 'Counter Thief';

/** text in the alias spelling: every NOW spelled OLD */
const respell = (s: string): string => s.split(NOW).join(OLD);
const respelled = <T>(v: T): T => JSON.parse(respell(JSON.stringify(v))) as T;

/** thirty legal cards: two Counter Thieves and fourteen other pairs */
const FILLER = DECK_LIST.filter(n => n !== NOW).slice(0, 14);
const DECK: CardName[] = [NOW, NOW, ...FILLER.flatMap(n => [n, n])];

test('premise: the alias resolves, and is not a deck card of its own', () => {
  assert.equal(canonicalCardName(OLD), NOW);
  assert.ok(DECK_LIST.includes(NOW));
  assert.ok(!DECK_LIST.includes(OLD));
});

// ── §1 deck checks ─────────────────────────────────────────────────────

test('§1 a deck saved under the alias still validates, and comes back in today\'s names', () => {
  const c = checkDeck(respelled(DECK));
  assert.ok(c.ok, `refused: ${!c.ok && c.error}`);
  assert.deepEqual(c.cards, DECK, 'the same deck, position for position, in canonical names');
});

test('§1 the copy cap counts both spellings as one card', () => {
  const c = checkDeck([OLD, NOW, OLD, ...DECK.slice(3)]);
  assert.ok(!c.ok && /max 2 copies/.test(c.error), 'three of one card under two names is still three');
});

test('§1 a single card duel saved under the alias is still a duel of that card', () => {
  const one = checkSingleCard(OLD);
  assert.ok(one.ok && one.cards.every(n => n === NOW), JSON.stringify(one).slice(0, 200));
  const thirty = Array<CardName>(30).fill(OLD);
  const d = checkSingleDeck(thirty);
  assert.ok(d.ok && d.cards[0] === NOW, JSON.stringify(d).slice(0, 200));
  // two spellings in one duel deck are still thirty of one card
  assert.ok(checkSingleDeck([...Array<CardName>(15).fill(OLD), ...Array<CardName>(15).fill(NOW)]).ok);
  assert.deepEqual(singleCardsOf([thirty, Array<CardName>(30).fill('Ignis Sprite')]), [NOW, 'Ignis Sprite']);
});

// ── §2 createGame ──────────────────────────────────────────────────────

test('§2 an alias-spelled constructed deck deals the SAME game, holding only today\'s name', () => {
  for (const seed of [45101, 45102, 45103]) {
    const now = createGame(seed, ['A', 'B'], 'constructed', undefined, [DECK, DECK]).state;
    const old = createGame(seed, ['A', 'B'], 'constructed', undefined, [respelled(DECK), respelled(DECK)]).state;
    assert.deepEqual(old, now, `seed ${seed}: the deal moved`);
    assert.ok(!JSON.stringify(old).includes(OLD), 'the alias never reaches the state');
  }
});

// ── §3 the other stored-name readers ───────────────────────────────────

test('§3 a custom deal / custom rules saved with the alias still leave the card out', () => {
  const deal = sanitizeDraftDeal({ excluded: [OLD] });
  assert.deepEqual(deal?.excluded, [NOW], 'dropping it would re-deal the game from a bigger pool');
  const rules = sanitizeCustomRules({ bans: [OLD, NOW] });
  assert.deepEqual(rules?.bans, [NOW]);
});

test('§3 a pasted list naming the printed spelling imports as Counter Thief', () => {
  const r = importDeckText(`2 ${OLD}\n2 Ignis Sprite`);
  assert.deepEqual(r.cards.filter(n => n === NOW).length, 2, JSON.stringify(r));
  assert.ok(!r.cards.includes(OLD));
});

test('§3 the card ladder folds a duel stamped with the alias into the card\'s one row', () => {
  const g = (single: [string, string], winner: Seat, i: number) => ({
    code: `L${i}`, playedAt: `2026-10-0${i}T00:00:00Z`, finished: true, winner, single,
  });
  const table = foldCardLadder([g([OLD, 'Ignis Sprite'], 0, 1), g([NOW, 'Ignis Sprite'], 0, 2)] as never);
  assert.ok(!table.has(OLD), 'no second row under the alias');
  assert.equal(table.get(NOW)?.games, 2);
  assert.equal(table.get(NOW)?.wins, 2);
});

test('§3 the collection reader spells a stored deck in today\'s names', async () => {
  process.env['ALGO_ACCOUNTS_FILE'] = join(mkdtempSync(join(tmpdir(), 'algo-451-acc-')), 'accounts.json');
  const { decksOf } = await import('../collection.ts');
  const account = {
    id: 'u1', name: 'x',
    decks: [{ id: 'd1', name: 'old', cards: respelled(DECK), maybe: [OLD], cover: OLD, createdAt: '', updatedAt: '' }],
  };
  const [d] = decksOf(account as never);
  assert.deepEqual(d!.cards, DECK);
  assert.deepEqual(d!.maybe, [NOW]);
  assert.equal(d!.cover, NOW);
});

test('§3 a profile folds history rows stamped with the alias into the card\'s one key', async () => {
  process.env['ALGO_ACCOUNTS_FILE'] = join(mkdtempSync(join(tmpdir(), 'algo-451-prof-')), 'accounts.json');
  const accounts = await import(`../accounts.ts?r451=${Math.random()}`) as typeof import('../accounts.ts');
  const { summarizeGame } = await import('../stats.ts');
  accounts.loadAccounts();
  const me = accounts.register('Renamer', 'a good password');
  if (!me.ok) throw new Error('could not register');
  const seatWith = (cards: Record<string, number>) =>
    ({ ...summarizeGame({ code: 'X', seed: 1, mode: 'shared', names: ['Renamer', 'x'], actions: [] }).seats[0], name: 'Renamer', won: true, cards });
  const row = (code: string, day: number, cards: Record<string, number>) => ({
    code, playedAt: `2026-10-0${day}T12:00:00.000Z`, recordedAt: '2026-10-09T12:00:00.000Z',
    mode: 'shared' as const, els: ['fire', 'water', 'earth'] as never, finished: true, winner: 0 as Seat, turns: 9, diverged: false,
    users: [me.account.id, null] as [string | null, string | null], names: ['Renamer', 'x'] as [string, string],
    seats: [seatWith(cards), seatWith({})] as never,
  });
  accounts.stashHistory(row('CTA1', 1, { [OLD]: 2, 'Ignis Sprite': 1 }));
  accounts.stashHistory(row('CTA2', 2, { [NOW]: 1 }));
  accounts.rebuildProfiles();
  const cards = accounts.accountById(me.account.id)!.profile.cards;
  assert.equal(cards[NOW], 3, 'both rows count toward Counter Thief');
  assert.ok(!(OLD in cards), '"Different cards" must not count the alias as a second card');
});

test('§3b a search for the printed spelling finds Counter Thief — first, by name and as bare words', () => {
  for (const q of [OLD, `name:"${OLD}"`, 'counter theif', `name="${OLD.toLowerCase()}"`, 'theif']) {
    const r = cardSearchPayload(q, { limit: 5 });
    assert.equal(r.cards[0]?.name, NOW, `${q} -> ${r.cards.map(c => c.name).join(', ')}`);
  }
  // a negated name match reads the card's real name only: "not named Theif"
  // is every card, Counter Thief included, because nothing is named that
  const neg = cardSearchPayload(`name!=theif name:counter`, { limit: 50 });
  assert.ok(neg.cards.some(c => c.name === NOW), neg.cards.map(c => c.name).join(', '));
});

// ── §4 refs ────────────────────────────────────────────────────────────

test('§4 canonicalRef respells the resolved slots, the labels and the zone delta', () => {
  // a delta as zoneDelta writes one: entries sorted by zone and name
  const now = `draftCommit|0:"${NOW}",1:"Nullbringer"|-1h:${NOW},+1h:Ignis Sprite,-1h:Nullbringer`;
  assert.equal(canonicalRef(respell(now)), now);
  assert.equal(canonicalRef(now), now, 'a ref already in today\'s names is left alone');
  // a decision label, a cache entry, and an untouched ref
  assert.equal(canonicalRef(`decide|number|0|${OLD}: steal/|+1c:{"card":"${OLD}"}`),
    `decide|number|0|${NOW}: steal/|+1c:{"card":"${NOW}"}`);
  const plain = 'playCard|0:"Ignis Sprite"|-|-1h:Ignis Sprite';
  assert.equal(canonicalRef(plain), plain);
  // whole words only: an alias inside a longer word is not a card name
  assert.equal(canonicalRef('x|-|+1h:Counter Theifs'), 'x|-|+1h:Counter Theifs');
});

test('§4 the respelled delta is exactly what zoneDelta writes today', () => {
  const before = { players: [{ hand: [NOW, 'Nullbringer', 'Ignis Sprite', 'Pallid Gorger'], bin: [] }] } as unknown as GameState;
  const after = { players: [{ hand: ['Ignis Sprite'], bin: [NOW, 'Nullbringer', 'Pallid Gorger'] }] } as unknown as GameState;
  const today = zoneDelta(before, after, 0);
  const then = zoneDelta(respelled(before), respelled(after), 0);
  assert.ok(then.includes(OLD), 'premise: the old delta spells the alias');
  assert.equal(canonicalRef(`playCard|0:"${OLD}"|-|${then}`), `playCard|0:"${NOW}"|-|${today}`);
});

// ── §6 end to end: a saved game spelled the old way ───────────────────

type Rooms = typeof import('../rooms.ts');
async function processAt(dir: string): Promise<Rooms> {
  process.env['ALGO_GAMES_DIR'] = dir;
  return import(`../rooms.ts?r451=${Math.random()}`) as Promise<Rooms>;
}
function tick(mod: Rooms, room: Room, a: Action): void {
  const was = room.segKey;
  mod.applyToRoom(room, a);
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    mod.applyToRoom(room, f);
  }
  if (mod.segmentKey(room.state) !== was) mod.openSegment(room);
}

interface SavedFile extends LedgerFile { posRefs?: string[]; refs?: string[]; sigs?: string[] }

test('§6 a game saved under the alias restores with no drift, replays as recorded, and its ledger counts Counter Thief', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'algo-451-'));
  const A = await processAt(dir);
  const room = A.createRoom('CTRN', 45150, ['Rashi', 'Bena'], 'shared', undefined, undefined, 'sandbox');
  tick(A, room, { type: 'sandboxSpawn', seat: 0, card: NOW, to: 'hand' });
  tick(A, room, { type: 'sandboxSpawn', seat: 0, card: 'Nullbringer', to: 'hand' });
  tick(A, room, { type: 'sandboxSpawn', seat: 1, card: NOW, to: 'bin' });
  const hand = room.state.players[0]!.hand;
  tick(A, room, { type: 'recycleForResource', seat: 0, handIndex: hand.indexOf(NOW), element: 'light' });
  const recycle = room.actions.length - 1;
  assert.equal(room.lost.length, 0, 'premise: every action was accepted');

  // the file as it would read with every name in the alias spelling
  const path = join(dir, 'CTRN.json');
  const nowText = readFileSync(path, 'utf8');
  assert.ok(nowText.includes(NOW), 'premise: the game names the card');
  writeFileSync(path, respell(nowText));
  const file = JSON.parse(readFileSync(path, 'utf8')) as SavedFile;
  assert.match(file.posRefs![recycle]!, new RegExp(`0:"${OLD}"`), 'premise: the recycle names the alias');

  // restore: the comparison that used to call this "changed"
  const B = await processAt(dir);
  B.restoreRooms();
  const back = B.getRoom('CTRN');
  assert.ok(back, 'the room came back');
  assert.equal(back.lost.length, 0, 'nothing refused');
  assert.notEqual(back.segPosRefs[recycle], file.posRefs![recycle], 'premise: the raw text DID differ');
  assert.deepEqual(back.drifted, [], 'no action reported as changed');
  assert.equal(back.forks.length, 0, 'no fork recorded');

  // the replay viewer's comparison: this engine's fingerprints vs the recorded
  // ones (the state only ever holds the canonical name, so they agree)
  const { analyze } = await import('../replay-room.ts');
  const an = analyze(file as never);
  assert.equal(an.refusals.length, 0);
  file.sigs!.forEach((sig, i) => {
    if (sig) assert.equal(an.sigs[i], sig, `the replay parts from the record at action ${i}`);
  });

  // the card ledger, on every rung that reads the file
  const live = ledgerForFile(file);
  const strip = (f: SavedFile): SavedFile => ({ ...f, cardLog: undefined, cardOpen: undefined });
  const sigRung = ledgerForFile(strip(file));
  const refRung = ledgerForFile({ ...strip(file), sigs: undefined });
  for (const [name, L, source] of [['live', live, 'live'], ['sigs', sigRung, 'replay-sigs'], ['refs', refRung, 'replay-refs']] as const) {
    assert.equal(L.audit.source, source, `${name}: ${L.audit.why}`);
    assert.equal(L.audit.validUpTo, file.actions.length, `${name}: ${L.audit.why}`);
    const keys = JSON.stringify(L.ledger.seats);
    assert.ok(!keys.includes(OLD), `${name}: the ledger keeps a row under the alias`);
    assert.equal(L.ledger.seats[0]!.recycled[NOW], 1, `${name}: the recycle counts toward Counter Thief`);
  }
});

// ── LAST: the re-sort branch, through a throwaway alias ────────────────

test('§4b a delta whose entries sort to a new place under the new name is re-sorted', () => {
  // No real card name sorts between "Counter Theif" and "Counter Thief", so
  // this registers a name that sorts BEFORE Ignis Sprite as an alias of
  // Nullbringer, which sorts after it. Only this process sees it, and no test
  // runs after this one.
  const ALIAS = 'Aardvark Test Alias';
  registerAlias(ALIAS, 'Nullbringer');
  const before = { players: [{ hand: ['Nullbringer', 'Ignis Sprite'], bin: [] }] } as unknown as GameState;
  const after = { players: [{ hand: [], bin: ['Nullbringer', 'Ignis Sprite'] }] } as unknown as GameState;
  const spell = (s: GameState): GameState => JSON.parse(JSON.stringify(s).split('Nullbringer').join(ALIAS)) as GameState;
  const today = zoneDelta(before, after, 0);
  const then = zoneDelta(spell(before), spell(after), 0);
  assert.notEqual(then.split(ALIAS).join('Nullbringer'), today, 'premise: the entries sort to different places under the two names');
  assert.equal(canonicalRef(`x|-|${then}`), `x|-|${today}`);
});
