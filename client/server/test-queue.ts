/* BL-01 — the matchmaking queue (run: node test-queue.ts).
 *
 * Two halves, the same shape as test-lobby.ts:
 *
 *   1. IN-PROCESS, and this is where the rules live. Who may play whom, how
 *      the band widens, who gets served first. All of it is pure — entries in,
 *      pairs out — so every one of these is a question asked directly rather
 *      than a situation arranged over two sockets and hoped for.
 *
 *   2. INTEGRATION: the real server, two real websockets, two real accounts,
 *      and every one of BL-01's `doneWhen` lines driven end to end.
 *
 * ⭐ THE ONE TO READ FIRST is §2's symmetry check. "Ranked" is a promise made
 * to BOTH players, and the natural implementation — check the gap against the
 * searching player's band and pair them — keeps that promise only for whoever
 * has waited longer. The other player, who was just shown "searching ±100",
 * gets handed somebody 400 points away and has no way to know it happened.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RatedMode } from './rating.ts';
import type { QueueEntry } from './queue.ts';
import { spawnServer } from './test-util.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-queue-test-'));
const GAMES = join(SCRATCH, 'games');
process.env['ALGO_ACCOUNTS_FILE'] = join(SCRATCH, 'accounts.json');
process.env['ALGO_GAMES_DIR'] = GAMES;

const {
  band, BAND_STEPS, bandFor, compatible, countsOf, offerExpired, pairUp, survivors, OFFER_MS,
} = await import('./queue.ts');

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const NOW = 1_000_000;
let uid = 0;
const E = (o: Partial<QueueEntry> = {}): QueueEntry => ({
  userId: `u${++uid}`, username: `P${uid}`,
  mode: 'constructed' as RatedMode, ranked: true, rating: 1000, since: NOW,
  ...o,
});

// ── 1. the widening schedule ──────────────────────────────────────────

console.log('\n[the band widens]');
{
  eq(band(0), 100, 'a fresh search is ±100');
  eq(band(29_999), 100, 'and stays there for the first half minute');
  eq(band(30_000), 150, 'then ±150');
  eq(band(60_000), 200, 'then ±200');
  eq(band(120_000), 300, 'then ±300');
  eq(band(180_000), null, '⭐ and at three minutes it stops refusing anybody');
  eq(band(999_999), null, 'and stays there');

  ok(BAND_STEPS.every((s, i) => i === 0 || s.after > BAND_STEPS[i - 1]!.after),
    'the schedule is strictly increasing in time');
  eq(bandFor(E({ ranked: false }), NOW + 999), null,
    '⭐ an OPEN entry never has a limit, however briefly it has waited');
  eq(bandFor(E({ ranked: true, since: NOW }), NOW), 100, 'a ranked one starts narrow');
}

// ── 1b. BL-42: direct challenges ──────────────────────────────────────

console.log('\n[a direct challenge pairs with its target, and nobody else]');
{
  const target = E({ userId: 'ben', rating: 1000 });
  const far = E({ userId: 'stranger', rating: 1900 });
  const challenger = E({ userId: 'rashi', rating: 1900, vs: 'ben' });

  ok(compatible(challenger, target, NOW),
    '⭐ a challenger 900 points away still pairs with the person they clicked — '
    + '"you just click and join" has to be true every time or the invitation lies');
  ok(compatible(target, challenger, NOW), '   …asked from either direction');
  ok(!compatible(challenger, far, NOW),
    '⭐ …and pairs with NOBODY else, however compatible. A targeted entry that '
    + 'fell back into the pool would hand them a stranger while their screen '
    + 'still said whose game they had joined');

  ok(!compatible(E({ userId: 'a', mode: 'draft' as RatedMode, vs: 'b' }),
                 E({ userId: 'b', mode: 'constructed' as RatedMode }), NOW),
    'the FORMAT still has to match — bypassing the band is a promise about who '
    + 'you play; bypassing the format is a different game');

  ok(!compatible(E({ userId: 'x', vs: 'nobody' }), E({ userId: 'y' }), NOW),
    'a challenge aimed at somebody who is not here matches nothing');

  /* ⭐ THE POOL MUST NOT EAT THE TARGET ON THE SAME TICK.
   *
   * Built so that every ordinary heuristic points the OTHER way: `near` has
   * waited a minute longer than the challenger (so longest-wait puts it
   * first), and is 10 points from the target against the challenger's 900 (so
   * "closest rating" prefers it too). The only thing that can pair ben with
   * rashi here is challenges being considered first. */
  const near = E({ userId: 'aaa-near', rating: 1010, since: NOW - 60_000 });
  const pairs = pairUp([target, near, challenger], NOW);
  eq(pairs.length, 1, 'one pair is made');
  const made = new Set([pairs[0]![0].userId, pairs[0]![1].userId]);
  ok(made.has('ben') && made.has('rashi'),
    `⭐ THE CHALLENGE WINS THE TARGET (paired ${[...made].join(' + ')}). Both `
    + 'the longest-wait ordering and the closest-rating tie-break prefer the '
    + 'other player here, so without challenges going first ben is taken and '
    + 'the person who clicked "join Ben\'s game" is left waiting for a game '
    + 'that no longer exists');
}

// ── 2. who may play whom ──────────────────────────────────────────────

console.log('\n[compatibility]');
{
  const at = (ms: number) => NOW + ms;

  ok(compatible(E({ rating: 1000 }), E({ rating: 1050 }), NOW),
    'two ranked players 50 apart pair immediately');
  ok(!compatible(E({ rating: 1000 }), E({ rating: 1200 }), NOW),
    'two ranked players 200 apart do not, at ±100');
  ok(compatible(E({ rating: 1000 }), E({ rating: 1200 }), at(60_000)),
    'and do once both have waited into ±200');

  // ⭐ the asymmetry trap
  const patient = E({ rating: 1000, since: NOW });            // waited 3 minutes: no limit
  const fresh = E({ rating: 1400, since: at(180_000) });       // just arrived: ±100
  ok(!compatible(patient, fresh, at(180_000)),
    '⭐ a player who has waited out their band cannot drag a NEWCOMER outside theirs');
  ok(!compatible(fresh, patient, at(180_000)),
    '   …and it does not depend which way round they are asked');

  // ⭐ the one-pool argument
  ok(compatible(E({ ranked: true, rating: 1000 }), E({ ranked: false, rating: 1050 }), NOW),
    '⭐ ranked pairs with OPEN when the open player is inside the ranked band');
  ok(!compatible(E({ ranked: true, rating: 1000 }), E({ ranked: false, rating: 1500 }), NOW),
    '   …and not when they are outside it — open costs the ranked player nothing');
  ok(compatible(E({ ranked: false, rating: 1000 }), E({ ranked: false, rating: 1900 }), NOW),
    'two OPEN players pair at any distance — they each said anyone');

  ok(!compatible(E({ mode: 'constructed' }), E({ mode: 'draft' }), NOW),
    'never across formats');
  const same = E();
  ok(!compatible(same, same, NOW), 'and never with yourself');
}

// ── 3. pairing ────────────────────────────────────────────────────────

console.log('\n[pairing]');
{
  const a = E({ userId: 'a', rating: 1000, since: NOW - 5000 });
  const b = E({ userId: 'b', rating: 1010, since: NOW - 4000 });
  const c = E({ userId: 'c', rating: 1002, since: NOW - 1000 });

  const pairs = pairUp([a, b, c], NOW);
  eq(pairs.length, 1, 'three compatible players make one pair and leave one waiting');
  eq(pairs[0]![0]!.userId, 'a', 'the longest wait is served first');
  eq(pairs[0]![1]!.userId, 'c',
    '⭐ …and gets the CLOSEST opponent, not the next one in line');

  // disjoint
  const four = pairUp([a, b, c, E({ userId: 'd', rating: 1001, since: NOW })], NOW);
  eq(four.length, 2, 'four make two pairs');
  const seen = four.flat().map(e => e.userId);
  eq(new Set(seen).size, 4, '⭐ and nobody appears in two of them');

  eq(pairUp([a], NOW).length, 0, 'one player alone pairs with nobody');
  eq(pairUp([], NOW).length, 0, 'and an empty queue does not throw');
  eq(pairUp([E({ rating: 1000 }), E({ rating: 9000 })], NOW).length, 0,
    'two ranked players nowhere near each other wait');

  // deterministic
  const once = JSON.stringify(pairUp([a, b, c], NOW).map(p => p.map(e => e.userId)));
  const twice = JSON.stringify(pairUp([c, b, a], NOW).map(p => p.map(e => e.userId)));
  eq(once, twice, 'the same queue pairs the same way whatever order it is handed in');
}

// ── 4. counts and offers ──────────────────────────────────────────────

console.log('\n[counts and offers]');
{
  const c = countsOf([E({ mode: 'draft' }), E({ mode: 'draft' }), E({ mode: 'constructed' })]);
  eq(c.total, 3, 'three waiting');
  eq(c.byMode.draft, 2, 'two of them for draft');
  eq(c.byMode.constructed, 1, 'one for constructed');
  eq(countsOf([]).total, 0, 'and an empty queue counts zero, not undefined');

  const offer = { id: 'o1', entries: [E(), E()] as [QueueEntry, QueueEntry], accepted: [true, false] as [boolean, boolean], made: NOW };
  ok(!offerExpired(offer, NOW + OFFER_MS - 1), 'an offer is live right up to the deadline');
  ok(offerExpired(offer, NOW + OFFER_MS), 'and lapses on it');

  const back = survivors(offer);
  eq(back.length, 1, '⭐ only the player who ACCEPTED goes back in the queue');
  eq(back[0]!.since, NOW,
    '⭐ …carrying their ORIGINAL wait, so somebody else\'s flake does not reset their band');
}

// ── 5. the real server ────────────────────────────────────────────────

const server = await spawnServer();
const PORT = server.port;

interface Msg { t: string; [k: string]: any }
class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
  token = '';
  constructor() { this.ws = new WebSocket(`ws://localhost:${PORT}`); }
  open(): Promise<void> {
    return new Promise(res => {
      this.ws.addEventListener('message', ev => this.msgs.push(JSON.parse(String((ev as MessageEvent).data))));
      this.ws.addEventListener('open', () => res(), { once: true });
    });
  }
  send(o: unknown): void { this.ws.send(JSON.stringify(o)); }
  last(t: string): Msg | undefined { return [...this.msgs].reverse().find(m => m.t === t); }
  settle(ms = 400): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
  queue(o: Record<string, unknown>): void { this.send({ t: 'queue', token: this.token, ...o }); }
}

async function signUp(username: string): Promise<string> {
  const res = await fetch(`http://localhost:${PORT}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'hunter2' }),
  });
  const body = await res.json() as { ok: boolean; token?: string; error?: string };
  if (!body.ok || !body.token) throw new Error(`register ${username} failed: ${body.error}`);
  return body.token;
}

try {
  const benToken = await signUp('Ben');
  const rashiToken = await signUp('Rashi');

  console.log('\n[server: signed out is refused with a reason]');
  {
    const anon = new Client(); await anon.open();
    anon.send({ t: 'queue', q: 'join', mode: 'draft' });
    await anon.settle();
    const err = anon.last('error');
    ok(!!err, '⭐ queueing signed out is REFUSED, not silently ignored');
    ok(/sign in/i.test(String(err?.['msg'])), `   …and says why: "${err?.['msg']}"`);
    ok(!anon.last('queue'), 'and it does not put them in the queue anyway');
    anon.ws.close();
  }

  console.log('\n[server: the counts everybody can see]');
  {
    const before = await (await fetch(`http://localhost:${PORT}/api/queue`)).json() as any;
    eq(before.counts.total, 0, 'an empty queue reads 0 over HTTP, signed in or not');

    const ben = new Client(); await ben.open(); ben.token = benToken;
    ben.queue({ q: 'join', mode: 'draft', ranked: true });
    await ben.settle();

    const during = await (await fetch(`http://localhost:${PORT}/api/queue`)).json() as any;
    eq(during.counts.total, 1, '⭐ one player waiting shows up in the at-a-glance count');
    eq(during.counts.byMode.draft, 1, 'under the format they picked');
    eq(during.counts.byMode.constructed, 0, 'and not the other one');

    const mine = ben.last('queue');
    eq(mine?.['searching']?.['mode'], 'draft', 'and the searcher is told what they are searching for');
    eq(mine?.['searching']?.['band'], 100, '⭐ …including the band, sent by the server, not guessed');
    eq(mine?.['offer'], null, 'with nobody to offer yet');

    console.log('\n[server: leaving]');
    ben.queue({ q: 'leave' });
    await ben.settle();
    const after = await (await fetch(`http://localhost:${PORT}/api/queue`)).json() as any;
    eq(after.counts.total, 0, 'leaving takes you out');
    eq(ben.last('queue')?.['searching'], null, 'and says so');

    console.log('\n[server: ⭐ disconnecting leaves no ghost]');
    ben.queue({ q: 'join', mode: 'draft' });
    await ben.settle();
    eq(((await (await fetch(`http://localhost:${PORT}/api/queue`)).json()) as any).counts.total, 1, 'back in');
    ben.ws.close();
    await new Promise(r => setTimeout(r, 500));
    eq(((await (await fetch(`http://localhost:${PORT}/api/queue`)).json()) as any).counts.total, 0,
      '⭐ closing the tab removes you — no ghost entry pairing with nobody');
  }

  console.log('\n[server: two players land in one room, no link passed]');
  {
    const ben = new Client(); await ben.open(); ben.token = benToken;
    const rashi = new Client(); await rashi.open(); rashi.token = rashiToken;

    ben.queue({ q: 'join', mode: 'draft', ranked: true });
    await ben.settle(200);
    rashi.queue({ q: 'join', mode: 'draft', ranked: true });
    await ben.settle(600);

    const bOffer = ben.last('queue')?.['offer'];
    const rOffer = rashi.last('queue')?.['offer'];
    ok(!!bOffer && !!rOffer, 'both are offered the match');
    eq(bOffer?.['opponent'], 'Rashi', 'and each is told who');
    eq(rOffer?.['opponent'], 'Ben', 'from the other side too');
    eq(bOffer?.['mode'], 'draft', 'in the format they queued for');
    ok((bOffer?.['expiresIn'] ?? 0) > 0 && (bOffer?.['expiresIn'] ?? 0) <= OFFER_MS,
      'with a countdown on it');
    ok(!ben.last('queue')?.['matched'], '⭐ and NOT dropped straight in — the offer waits for a click');

    ben.queue({ q: 'accept' });
    await ben.settle();
    eq(rashi.last('queue')?.['offer']?.['accepted'], false,
      'one side accepting does not start the game');
    ok(!ben.msgs.some(m => m['matched']), 'nor does it move anybody');

    rashi.queue({ q: 'accept' });
    await ben.settle(700);

    const bm = [...ben.msgs].reverse().find(m => m['matched'])?.['matched'];
    const rm = [...rashi.msgs].reverse().find(m => m['matched'])?.['matched'];
    ok(!!bm && !!rm, '⭐ both sides are pushed into a game');
    eq(bm.room, rm.room, '⭐ …and it is THE SAME ROOM, with no link sent between them');
    ok(bm.seat !== rm.seat, 'on opposite seats');
    eq(bm.mode, 'draft', 'in the format they asked for');

    // and the room on disk is a rated draft room with both accounts on it
    await ben.settle(300);
    const saved = JSON.parse(readFileSync(join(GAMES, `${bm.room}.json`), 'utf8'));
    eq(saved.rated, true, '⭐ the saved room is stamped RATED — this is what moves ratings');
    eq(saved.mode, 'draft', 'and is a draft room');
    ok(!!saved.lobby, '…which opened a trio lobby, so neither stranger picked the elements');
    eq(saved.users.filter((u: unknown) => u !== null).length, 2,
      '⭐ both accounts are on it BEFORE either client has joined');
    eq(saved.clockStart, 60 * 60 * 1000,
      '⭐ the clock is the FORMAT default (60m draft), not either player\'s picker');

    eq(((await (await fetch(`http://localhost:${PORT}/api/queue`)).json()) as any).counts.total, 0,
      'and the queue is empty again');
    ben.ws.close(); rashi.ws.close();
  }

  console.log('\n[server: a decline puts the other one back]');
  {
    const ben = new Client(); await ben.open(); ben.token = benToken;
    const rashi = new Client(); await rashi.open(); rashi.token = rashiToken;
    ben.queue({ q: 'join', mode: 'constructed' });
    await ben.settle(200);
    // ⚠ Ben has no saved deck, so constructed must have refused him outright
    ok(/deck/i.test(String(ben.last('error')?.['msg'])),
      '⭐ constructed without a deck is refused with a reason, not a broken game');
    eq(((await (await fetch(`http://localhost:${PORT}/api/queue`)).json()) as any).counts.total, 0,
      'and he is not in the queue');

    ben.queue({ q: 'join', mode: 'draft' });
    await ben.settle(200);
    rashi.queue({ q: 'join', mode: 'draft' });
    await ben.settle(600);
    ok(!!ben.last('queue')?.['offer'], 'they are offered each other');

    ben.queue({ q: 'accept' });
    await ben.settle(200);
    rashi.queue({ q: 'decline' });
    await ben.settle(600);

    eq(ben.last('queue')?.['offer'], null, 'the offer is gone');
    ok(!!ben.last('queue')?.['searching'],
      '⭐ the player who accepted is back in the queue, not dropped');
    const counts = (await (await fetch(`http://localhost:${PORT}/api/queue`)).json()) as any;
    eq(counts.counts.total, 1, '⭐ …and the one who declined is out — they must re-join');
    ben.ws.close(); rashi.ws.close();
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\n[server: an unanswered offer lapses]');
  {
    const ben = new Client(); await ben.open(); ben.token = benToken;
    const rashi = new Client(); await rashi.open(); rashi.token = rashiToken;
    ben.queue({ q: 'join', mode: 'draft' });
    await ben.settle(200);
    rashi.queue({ q: 'join', mode: 'draft' });
    await ben.settle(500);
    ok(!!ben.last('queue')?.['offer'], 'offered');
    ben.queue({ q: 'accept' });
    // …and nobody answers for Rashi. OFFER_MS is 10s and the sweep is 1s.
    await ben.settle(OFFER_MS + 2000);
    eq(ben.last('queue')?.['offer'], null, 'the offer lapsed on its own — nothing had to be clicked');
    ok(!!ben.last('queue')?.['searching'],
      '⭐ and the player who did accept is searching again, not stuck on a dead countdown');
    ben.ws.close(); rashi.ws.close();
  }
  console.log('\n[server: a constructed match deals both decks immediately]');
  {
    await new Promise(r => setTimeout(r, 600));
    // Reading the collection seeds the starter five (collection.ts), which is
    // exactly what a real player's first visit to the decks page does.
    const decksOf = async (token: string): Promise<{ id: string; cards: string[] }[]> => {
      const res = await fetch(`http://localhost:${PORT}/api/decks`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await res.json() as { ok: boolean; decks?: { id: string; cards: string[] }[] };
      return body.decks ?? [];
    };
    const benDecks = await decksOf(benToken);
    const rashiDecks = await decksOf(rashiToken);
    ok(benDecks.length > 0 && rashiDecks.length > 0, 'both players have saved decks');

    const ben = new Client(); await ben.open(); ben.token = benToken;
    const rashi = new Client(); await rashi.open(); rashi.token = rashiToken;

    ben.queue({ q: 'join', mode: 'constructed', deckId: benDecks[0]!.id, ranked: false });
    await ben.settle(200);
    rashi.queue({ q: 'join', mode: 'constructed', deckId: rashiDecks[1]!.id, ranked: false });
    await ben.settle(600);
    ok(!!ben.last('queue')?.['offer'], 'they are offered each other');
    eq(ben.last('queue')?.['offer']?.['mode'], 'constructed', 'for constructed');

    ben.queue({ q: 'accept' });
    rashi.queue({ q: 'accept' });
    await ben.settle(800);

    const m = [...ben.msgs].reverse().find(x => x['matched'])?.['matched'];
    ok(!!m, 'both are pushed into a room');
    const saved = JSON.parse(readFileSync(join(GAMES, `${m.room}.json`), 'utf8'));
    eq(saved.mode, 'constructed', 'a constructed room');
    eq(saved.rated, true, 'stamped rated');
    ok(Array.isArray(saved.decks?.[0]) && Array.isArray(saved.decks?.[1]),
      '⭐ BOTH decks are in it — a matchmade constructed game deals rather than opening a deck picker');
    ok(saved.decks[0].length > 0 && saved.decks[1].length > 0, 'and both are real lists');
    eq(saved.deckIds?.[0] !== null && saved.deckIds?.[1] !== null, true,
      'each seat\'s COLLECTION deck id is recorded, so the deck\'s record can be folded out later');
    ok(saved.deckIds[0] !== saved.deckIds[1],
      '⭐ …and they are the two players\' OWN decks, not one copied onto both seats');
    ok(saved.actions.length === 0, 'no actions yet — the game is dealt and waiting');
    eq(saved.clockStart, 45 * 60 * 1000,
      '⭐ 45m: the CONSTRUCTED default, and a different number from the draft room above');

    ben.ws.close(); rashi.ws.close();
  }
} finally {
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall queue tests passed\n');
process.exit(failures ? 1 : 0);
