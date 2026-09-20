/* R298 — SINGLE CARD DUEL, end to end.
 *
 *   1. the engine: thirty of one deck card is a deck; nothing else new is
 *   2. the room: the flag, the rematch, the file
 *   3. the card ladder fold: mirrors, walkovers, early concessions, order
 *   4. the stats: recorded and tagged, counted in no player fold
 *   5. the real server: a card rides the join, a deck cannot, the pick is BLIND,
 *      the game deals thirty of each, and it all survives a restart
 *
 * Run: node test-single-card.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnServer } from './test-util.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-single-test-'));
const GAMES = join(SCRATCH, 'games');
process.env['ALGO_ACCOUNTS_FILE'] = join(SCRATCH, 'accounts.json');
process.env['ALGO_GAMES_DIR'] = GAMES;
mkdirSync(GAMES, { recursive: true });

const { apply, checkDeck, checkSingleCard, checkSingleDeck, createGame, legalActions, makesUnits, SINGLE_CARD_COPIES } = await import('../../engine/src/apply.ts');
const { createsOf } = await import('../../engine/src/cards/registry.ts');
const { getCard } = await import('../../engine/src/cards/dsl.ts');
const { defaultDecks } = await import('../decks.ts');
const { DECK_LIST } = await import('../../engine/src/cards/registry.ts');
const { createRematch, createRoom, roomWaiting, setRoomDeck, singleCards } = await import('../rooms.ts');
const { matchLengths, recordLiveGame } = await import('../history.ts');
const { accountById, gameHistory, recentGames, register } = await import('../accounts.ts');
const { isRated, K_PROVISIONAL, START_RATING } = await import('../rating.ts');
const { cardLadder, foldCardLadder, singleCardsOf } = await import('../cardladder.ts');
const { analyze } = await import('../replay-room.ts');

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const X = DECK_LIST[0]!, Y = DECK_LIST[1]!;
const thirty = (n: string): string[] => Array.from({ length: SINGLE_CARD_COPIES }, () => n);

// ── 1. the engine ─────────────────────────────────────────────────────

console.log('\n[R298: thirty of one deck card is a deck]');
{
  eq(SINGLE_CARD_COPIES, 30, 'thirty copies');
  const c = checkSingleCard(X);
  ok(c.ok && c.cards.length === 30 && c.cards.every(n => n === X), 'a deck card makes a thirty-card deck');
  ok(!checkSingleCard('Earth Resource').ok, 'a resource face is not a deck card');
  ok(!checkSingleCard('No Such Card').ok && !checkSingleCard(42).ok && !checkSingleCard('').ok, 'nor is junk');
  ok(checkSingleDeck(thirty(X)).ok, 'thirty of one is a single-card deck');
  ok(!checkSingleDeck(thirty(X).slice(1)).ok, 'twenty-nine is not');
  ok(!checkSingleDeck([...thirty(X).slice(1), Y]).ok, 'nor is twenty-nine and a stranger');
  ok(!checkDeck(thirty(X)).ok, 'control: an ordinary constructed deck still may not hold thirty of one');
  const g = createGame(7, ['A', 'B'], 'constructed', undefined, [thirty(X), thirty(Y)]);
  ok(g.state.decks!.every(d => d.length > 0), 'createGame deals it');
  ok([...g.state.decks![0]!, ...g.state.players[0]!.hand].every(n => n === X), 'and seat 0 holds nothing but its card');
  ok(g.state.singleCard === true, 'two single-card decks make a duel');
  ok(g.state.bottomDone == null && g.state.players.every(p => p.hand.length === 6),
    'no draw phase: turn 1 is the opening 4 and a flat 2 — six cards, nothing to put back');
  const both = (st: typeof g.state) => [...legalActions(st, 0), ...legalActions(st, 1)];
  ok(!both(g.state).some(a => a.type === 'bottomCards'), 'and nobody is asked to bottom anything');
  const ord = defaultDecks().find(d => checkDeck(d.cards).ok)!.cards;
  const plainGame = createGame(7, ['A', 'B'], 'constructed', undefined, [ord, ord]);
  ok(!plainGame.state.singleCard && plainGame.state.bottomDone != null && plainGame.state.players[0]!.hand.length === 8,
    'control: an ordinary constructed game still draws 4 and bottoms 2');
  // …and every later turn: planning through to turn 2, passing everything
  let st = g.state;
  for (let i = 0; i < 400 && st.turn < 2 && st.winner === null; i++) {
    const acts = both(st);
    const DONE = ['donePlanning', 'doneHaste', 'passPriority', 'doneDeploying'];
    const pick = acts.find(a => DONE.includes(a.type)) ?? acts.find(a => a.type !== 'playCard' && a.type !== 'concede') ?? acts[0];
    if (!pick) break;
    st = apply(st, pick).state;
  }
  eq(st.turn, 2, 'the duel reaches turn 2');
  eq(st.players.map(p => p.hand.length), [8, 8], 'where each seat drew its flat 2 (nothing was played)');
  ok(st.bottomDone == null && !both(st).some(a => a.type === 'bottomCards'), 'and turn 2 has no draw phase either');
  let threw = '';
  try { createGame(7, ['A', 'B'], 'constructed', undefined, [thirty(X).slice(1), thirty(Y)]); } catch (err) { threw = String(err); }
  ok(/at least 30/.test(threw), `a short deck is still refused, with checkDeck's reason (${threw.slice(0, 60)})`);
  eq(singleCardsOf([thirty(X), thirty(Y)]), [X, Y], 'singleCardsOf reads the pair');
  eq(singleCardsOf([thirty(X), null]), null, 'and not half of one');
}

// ── 1b. the draw: two cards that can never make a unit ──────────────

// derived, not named: a spell that makes nothing, one that makes a unit token, a unit
const SPELL = DECK_LIST.find(n => getCard(n).kind === 'spell' && !createsOf(n).length)!;
const SPELL2 = DECK_LIST.find(n => n !== SPELL && getCard(n).kind === 'spell' && !createsOf(n).length)!;
const MAKER = DECK_LIST.find(n => getCard(n).kind === 'spell' && createsOf(n).some(t => getCard(t).kind === 'unit'))!;
const UNIT = DECK_LIST.find(n => getCard(n).kind === 'unit')!;

console.log('\n[R298: two cards that make no units are a draw]');
{
  ok(SPELL && SPELL2 && MAKER && UNIT, `non-vacuous: ${SPELL}, ${SPELL2}, ${MAKER}, ${UNIT}`);
  ok(!makesUnits(SPELL) && !makesUnits(SPELL2), 'a spell that creates nothing makes no units');
  ok(makesUnits(MAKER), `a spell that creates a unit token does (${MAKER}: ${createsOf(MAKER).join(', ')})`);
  ok(makesUnits(UNIT), 'and so, of course, does a unit');
  const spellUnit = DECK_LIST.find(n => getCard(n).kind === 'spellUnit');
  ok(!spellUnit || makesUnits(spellUnit), 'a spell that becomes a unit does too');

  const room = createRoom('SCDD', 4, ['Ann', 'Bob'], 'constructed', undefined, thirty(SPELL), undefined, null, undefined, true);
  setRoomDeck(room, 0, thirty(SPELL));
  const dealt = setRoomDeck(room, 1, thirty(SPELL2));
  ok(!dealt && roomWaiting(room), 'spell against spell is not dealt');
  eq(room.singleDraw, [SPELL, SPELL2], 'the room keeps the pair it drew on');
  eq(room.decks, [null, null], 'and both cards are cleared, so both choose again');
  const saved = JSON.parse(readFileSync(join(GAMES, 'SCDD.json'), 'utf8'));
  eq(saved.singleDraw, [SPELL, SPELL2], 'the draw survives in the room file');
  setRoomDeck(room, 0, thirty(SPELL));
  ok(setRoomDeck(room, 1, thirty(MAKER)), 'the same spell against one that makes units IS dealt');
  ok(!room.singleDraw, 'and the draw notice goes with the deal');

  const mirror = createRoom('SCDE', 4, ['Ann', 'Bob'], 'constructed', undefined, thirty(SPELL), undefined, null, undefined, true);
  setRoomDeck(mirror, 0, thirty(SPELL));
  ok(!setRoomDeck(mirror, 1, thirty(SPELL)), 'a no-unit mirror is a draw too');
}

// ── 2. the room ───────────────────────────────────────────────────────

console.log('\n[R298: the room keeps the flag, and so do its rematch and its file]');
const duel = (() => {
  const room = createRoom('SCDA', 3, ['Ann', 'Bob'], 'constructed', undefined, thirty(X), undefined, null, undefined, true);
  ok(room.single === true, 'a single-card room is flagged');
  eq(singleCards(room), null, 'and has no pair until both cards are in');
  room.decks = [thirty(X), thirty(Y)];
  eq(singleCards(room), [X, Y], 'then it has both');
  const plain = createRoom('SCDB', 3, undefined, 'draft', undefined, undefined, undefined, null, undefined, true);
  ok(!plain.single, 'createRoom will not flag a draft');
  const again = createRematch(room, 'SCDC');
  ok(again.single === true, 'the rematch is a duel too');
  eq(singleCards(again), [X, Y], 'with the same two cards');
  const saved = JSON.parse(readFileSync(join(GAMES, 'SCDC.json'), 'utf8'));
  ok(saved.single === true, 'the room file says so');
  const an = analyze(saved);
  ok(an.refusals.length === 0, 'and replay-room can deal it');
  return again;
})();

// ── 3. the card ladder ────────────────────────────────────────────────

console.log('\n[R298: the card ladder fold]');
{
  const game = (code: string, a: string, b: string, winner: 0 | 1, extra: object = {}) => ({
    code, playedAt: `2026-09-18T10:00:${code.slice(-2)}Z`, finished: true, winner, single: [a, b] as [string, string], ...extra,
  });
  const one = foldCardLadder([game('G01', 'Alpha', 'Beta', 0)]);
  eq(one.get('Alpha')?.rating, START_RATING + K_PROVISIONAL / 2, 'an even duel moves the winner half of K');
  eq(one.get('Beta')?.rating, START_RATING - K_PROVISIONAL / 2, 'and the loser the same the other way');
  eq([one.get('Alpha')?.wins, one.get('Beta')?.losses], [1, 1], 'and records the W and the L');

  const mirror = foldCardLadder([game('G02', 'Alpha', 'Alpha', 1)]);
  eq(mirror.get('Alpha'), { card: 'Alpha', rating: START_RATING, games: 0, wins: 0, losses: 0, mirrors: 1 }, 'a mirror moves nothing and is counted as a mirror');

  const walk = foldCardLadder([game('G03', 'Alpha', 'Beta', 0, { concession: { seat: 1, turn: 1 } })]);
  eq(walk.size, 0, 'a walkover is no result at all');
  const early = foldCardLadder([game('G04', 'Alpha', 'Beta', 0, { concession: { seat: 1, turn: 2 } })]);
  eq(early.get('Alpha')?.rating, START_RATING + K_PROVISIONAL / 4, 'an early concession moves half as much');
  eq(foldCardLadder([{ ...game('G05', 'Alpha', 'Beta', 0), finished: false }]).size, 0, 'an unfinished duel is no result');
  eq(foldCardLadder([{ code: 'G06', playedAt: '2026', finished: true, winner: 0 as const }]).size, 0, 'nor is a game that was not a duel');
  eq(foldCardLadder([game('G07', '', '', 0)]).size, 0, 'nor a duel whose cards could not be read');

  const many = [game('H01', 'A', 'B', 0), game('H02', 'B', 'C', 0), game('H03', 'C', 'A', 1), game('H04', 'A', 'C', 1), game('H05', 'B', 'A', 1)];
  const fwd = JSON.stringify(cardLadder(many));
  ok(fwd === JSON.stringify(cardLadder([...many].reverse())), 'the ladder does not depend on the order it was handed');
  eq(cardLadder(many)[0]!.card, 'A', 'A, 3–1, tops it');
}

// ── 4. the stats ──────────────────────────────────────────────────────

console.log('\n[R298: recorded and tagged, counted in no player fold]');
{
  const reg = register('singletester', 'a long enough password 42');
  ok(reg.ok, 'an account to record against');
  const id = reg.ok ? reg.account.id : '';
  const game = {
    code: 'SCDH', seed: duel.seed, mode: 'constructed' as const, els: duel.els, names: ['singletester', 'Other'] as [string, string],
    users: [id, null] as [string | null, string | null], winner: 0 as const, actions: [], decks: duel.decks, matchMs: 600_000,
  };
  recordLiveGame({ ...game, single: true });
  const row = gameHistory().find(g => g.code === 'SCDH');
  eq(row?.single, [X, Y], 'the duel is in the history, tagged with both cards');
  eq(accountById(id)?.profile.games, 0, 'and counted in no profile total');
  eq(recentGames(id).find(g => g.code === 'SCDH')?.single, [X, Y], 'the match history row names your card first');
  recordLiveGame({ ...game, code: 'SCDI', names: ['Other', 'singletester'], users: [null, id], decks: [thirty(Y), thirty(X)], single: true });
  eq(recentGames(id).find(g => g.code === 'SCDI')?.single, [X, Y], '…from either seat');
  ok(!isRated({ code: 'Z', playedAt: '2026', mode: 'constructed', finished: true, winner: 0, users: ['a', 'b'], rated: true, single: [X, Y] }),
    'a duel never moves a player rating');
  eq(matchLengths(gameHistory().filter(g => g.code === 'SCDH')).n, 0, 'nor the average game length');
  eq(cardLadder(gameHistory()).map(c => c.card).sort(), [X, Y].sort(), 'it is on the card ladder');
}

// ── 5. the real server ────────────────────────────────────────────────

console.log('\n[R298: the server end to end]');

interface Msg { t: string; view?: any; waiting?: any; single?: unknown; msg?: string; winner?: number }

let server = await spawnServer();
let PORT = server.port;

class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
  raw: string[] = [];
  constructor() { this.ws = new WebSocket(`ws://localhost:${PORT}`); }
  open(): Promise<void> {
    return new Promise(res => {
      this.ws.addEventListener('message', ev => {
        this.raw.push(String((ev as MessageEvent).data));
        this.msgs.push(JSON.parse(String((ev as MessageEvent).data)));
      });
      this.ws.addEventListener('open', () => res(), { once: true });
    });
  }
  send(o: unknown): void { this.ws.send(JSON.stringify(o)); }
  last(t: string): Msg | undefined { return [...this.msgs].reverse().find(m => m.t === t); }
  async settle(ms = 400): Promise<void> { await new Promise(r => setTimeout(r, ms)); }
}

const newCode = async (): Promise<string> =>
  ((await (await fetch(`http://localhost:${PORT}/api/new`)).json()) as { code: string }).code;

// a card Bob will pick that Ann's messages must never mention before the deal
const Z = DECK_LIST.find(n => n !== X && n !== Y && !X.includes(n) && !Y.includes(n) && !n.includes(X))!;

try {
  const ladder = await (await fetch(`http://localhost:${PORT}/api/cardladder`)).json() as { ok: boolean; cards: { card: string }[]; duels: number };
  ok(ladder.ok && ladder.cards.some(c => c.card === X) && ladder.duels === 2, '/api/cardladder serves the history it booted with');

  const bad = new Client(); await bad.open();
  bad.send({ t: 'join', room: await newCode(), seat: 0, name: 'Ann', mode: 'constructed', single: 'Earth Resource' });
  await bad.settle();
  ok(/cannot be a deck/.test(bad.last('error')?.msg ?? ''), 'a creating join with a card that is not a deck card is refused');
  bad.ws.close();

  const code = await newCode();
  const a = new Client(); await a.open();
  // Ann's saved deck rides along too, as the real client's would — ignored
  a.send({ t: 'join', room: code, seat: 0, name: 'Ann', mode: 'constructed', single: X, deck: thirty(Y) });
  await a.settle();
  const aw = a.last('joined')?.waiting;
  ok(aw?.single === true, 'the waiting room knows it is a duel');
  eq(aw?.have, [true, false], 'and Ann\'s card is in');

  const b = new Client(); await b.open();
  // Bob arrives by code with his saved deck, the way a plain join does
  b.send({ t: 'join', room: code, seat: 1, name: 'Bob', mode: 'constructed', deck: [...thirty(Y).slice(0, 15), ...thirty(Z).slice(0, 15)] });
  await b.settle();
  eq(b.last('joined')?.waiting?.have, [true, false], 'a DECK does not register in a duel');
  ok(b.last('joined')?.waiting?.single === true, 'Bob is asked for a card');
  ok(!b.raw.some(r => r.includes(X)), `BLIND: nothing Bob has been sent names Ann's card (${X})`);

  b.send({ t: 'join', room: code, seat: 1, name: 'Bob', mode: 'constructed', single: Z });
  await b.settle(700);
  const bv = b.last('joined')?.view;
  ok(!!bv && bv.players?.[1]?.hand?.every((n: string) => n === Z), 'the game is dealt, and Bob\'s hand is all his card');
  eq(bv?.players?.[1]?.hand?.length, 6, 'six cards, with no bottoming to do');
  ok(b.last('joined')?.single === true, 'every push says it is a duel');

  b.send({ t: 'action', action: { type: 'concede', seat: 1 } });
  await b.settle(700);
  const over = a.last('gameover');
  eq(over?.single, [X, Z], 'the post-game screen names both cards');

  // restart: the room, its flag and its decks come back
  a.ws.close(); b.ws.close();
  await server.stop();
  const history = JSON.parse(readFileSync(join(SCRATCH, 'accounts.json'), 'utf8')).history as { code: string; single?: string[] }[];
  eq(history.find(g => g.code === code)?.single, [X, Z], 'the history row carries the pair, though nobody was signed in');
  server = await spawnServer();
  PORT = server.port;
  const back = new Client(); await back.open();
  back.send({ t: 'join', room: code, seat: 0, name: 'Ann', mode: 'constructed' });
  await back.settle(700);
  ok(back.last('joined')?.single === true, 'after a restart the room is still a duel');
  const after = await (await fetch(`http://localhost:${PORT}/api/cardladder`)).json() as { cards: { card: string }[] };
  ok(!after.cards.some(c => c.card === Z), 'a turn-1 concession put nothing on the ladder');
  back.ws.close();

  // a DRAW, over the wire: both seats are told both cards, and choose again
  const dcode = await newCode();
  const c = new Client(); await c.open();
  c.send({ t: 'join', room: dcode, seat: 0, name: 'Ann', mode: 'constructed', single: SPELL });
  await c.settle();
  const d = new Client(); await d.open();
  d.send({ t: 'join', room: dcode, seat: 1, name: 'Bob', mode: 'constructed', single: SPELL2 });
  await d.settle(700);
  eq(d.last('joined')?.waiting?.drawn, { mine: SPELL2, theirs: SPELL }, 'the joiner is told the draw, from their side');
  eq(c.last('update')?.waiting?.drawn, { mine: SPELL, theirs: SPELL2 }, 'and so is the creator, from theirs');
  eq(c.last('update')?.waiting?.have, [false, false], 'both are asked to choose again');
  ok(!c.msgs.some(m => m.view) && !d.msgs.some(m => m.view), 'and no game was dealt');
  c.send({ t: 'join', room: dcode, seat: 0, name: 'Ann', mode: 'constructed', single: SPELL });
  d.send({ t: 'join', room: dcode, seat: 1, name: 'Bob', mode: 'constructed', single: UNIT });
  await d.settle(700);
  ok(!!d.last('joined')?.view && !d.last('joined')?.waiting, 'choosing again with a unit deals the game');
  c.ws.close(); d.ws.close();
} finally {
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURES ✗`);
process.exit(failures === 0 ? 0 : 1);
