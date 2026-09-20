/* Tests for the draft lobby (run: node test-lobby.ts).
 *
 * Two halves, same style as the other server tests:
 *   1. In-process: the three trio methods, their edge cases, and that the
 *      seeded draw is reproducible.
 *   2. Integration: the real server, two websockets, a room that deals no
 *      cards until both players have locked in.
 *
 * The property the whole feature rests on is in the second half: a draft room
 * has NO GAME until the trio is settled. That is what removes both the "one
 * person picks the elements" problem and the "and then stares at pack 1 pick
 * 1 while the other one finds the link" one.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Element } from '../../engine/src/types.ts';
import { spawnServer } from './test-util.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-lobby-test-'));
const GAMES = join(SCRATCH, 'games');
process.env['ALGO_ACCOUNTS_FILE'] = join(SCRATCH, 'accounts.json');
process.env['ALGO_GAMES_DIR'] = GAMES;

const {
  allSets, allTrios, methodBlurbs, METHOD_BLURBS, resolveTrio, sanitizeSubmission, submissionReady, inOrder,
} = await import('../trio.ts');

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const NAMES: [string, string] = ['Ben', 'Rashi'];
const resolve = (o: Partial<Parameters<typeof resolveTrio>[0]>): ReturnType<typeof resolveTrio> =>
  resolveTrio({ method: 'pick-one', submissions: [{}, {}], names: NAMES, history: [], rng: 1, ...o });

// ── 1. shape ──────────────────────────────────────────────────────────

console.log('\n[the trio space]');
{
  const trios = allTrios();
  eq(trios.length, 35, 'C(7,3) trios');
  eq(new Set(trios.map(t => t.join('+'))).size, 35, 'all distinct');
  ok(trios.every(t => t.length === 3), 'each has exactly three');
  ok(trios.every(t => inOrder(t).join() === t.join()), 'each is in canonical order');
}

// ── 1b. BL-43: a game of another size ────────────────────────────────

console.log('\n[BL-43: two elements, and every other count]');
{
  eq(allSets(2).length, 21, 'C(7,2) pairs');
  eq(allSets(7).length, 1, 'one set of all seven');
  eq(allSets(3).map(t => t.join('+')).join(' '), allTrios().map(t => t.join('+')).join(' '), 'allTrios is allSets(3), in the same order');
  eq(JSON.stringify(methodBlurbs(3)), JSON.stringify(METHOD_BLURBS), 'the three-element blurbs are the ones the lobby always showed');
  ok(/pair/.test(methodBlurbs(2).fresh), 'a two-element lobby talks about pairs');

  const both = resolve({ submissions: [{ element: 'wood' }, { element: 'fire' }], rng: 7, count: 2 });
  eq(both.els.join('+'), 'fire+wood', 'one each, two picks, a pair: nothing is drawn');
  ok(both.detail.some(d => /Nothing was left to draw/.test(d)), 'and the working says so');
  const same = resolve({ submissions: [{ element: 'dark' }, { element: 'dark' }], rng: 7, count: 2 });
  eq(same.els.length, 2, 'the same pick twice in a pair draws the second');
  ok(same.els.includes('dark'), 'and keeps the shared pick');

  const ranked = resolve({
    method: 'rank', rng: 5, count: 2,
    submissions: [sanitizeSubmission({ ranking: ['metal'] }, 'rank'), sanitizeSubmission({ ranking: ['light'] }, 'rank')],
  });
  eq(ranked.els.length, 2, 'rank all seven draws a pair');

  const target: Element[] = ['water', 'light'];
  const history = [
    ...allSets(2).filter(p => p.join() !== target.join()).map(els => ({ els, playedAt: '2026-09-01T12:00:00.000Z' })),
    { els: ['water', 'earth', 'light'] as Element[], playedAt: '2026-09-02T12:00:00.000Z' },
  ];
  const fresh2 = resolve({ method: 'fresh', history, count: 2 });
  eq(fresh2.els.join('+'), 'water+light', 'something new finds the one pair not played, ignoring trios');
  ok(fresh2.detail.some(d => /of the 21 pairs/.test(d)), 'and counts pairs');

  const again = resolve({ method: 'again', previousTrio: ['wood', 'fire'], count: 2 });
  eq(again.how, 'the same pair again', 'run it back replays a pair');
  const mismatch = resolve({ method: 'again', previousTrio: ['fire', 'water', 'earth'], submissions: [{ element: 'fire' }, {}], count: 2 });
  eq(mismatch.els.length, 2, 'a trio cannot be run back into a two-element game');

  eq(resolve({ submissions: [{ element: 'fire' }, {}], rng: 9, count: 5 }).els.length, 5, 'a five-element game draws the rest');
}

// ── 2. one each, one drawn ────────────────────────────────────────────

console.log('\n[method: one each]');
{
  const r = resolve({ submissions: [{ element: 'fire' }, { element: 'dark' }], rng: 7 });
  eq(r.els.length, 3, 'three elements come back');
  ok(r.els.includes('fire') && r.els.includes('dark'), 'both picks are in it');
  ok(r.detail.some(d => /Ben chose fire/.test(d)), 'the working names who chose what');
  ok(r.detail.some(d => /drawn at random/.test(d)), 'and says the third was drawn');

  // both wanting the same element is a real outcome, not an error
  const same = resolve({ submissions: [{ element: 'wood' }, { element: 'wood' }], rng: 7 });
  eq(same.els.length, 3, 'a collision still yields three');
  ok(same.els.includes('wood'), 'the shared pick is in');
  ok(same.detail.some(d => /the same one/.test(d)), 'and the reveal says so');

  // a seat that never submitted (should not happen — the lobby gates on it —
  // but a resolve must not produce a two-element trio if it does)
  const half = resolve({ submissions: [{ element: 'metal' }, {}], rng: 3 });
  eq(half.els.length, 3, 'a missing submission is filled by the draw');
  ok(half.els.includes('metal'), 'and the one real pick survives');

  // seeded: same seed, same trio
  const a = resolve({ submissions: [{ element: 'fire' }, { element: 'dark' }], rng: 12345 });
  const b = resolve({ submissions: [{ element: 'fire' }, { element: 'dark' }], rng: 12345 });
  eq(a.els.join('+'), b.els.join('+'), 'the draw is reproducible from the seed');
  const c = resolve({ submissions: [{ element: 'fire' }, { element: 'dark' }], rng: 999 });
  ok(a.els.join('+') !== c.els.join('+') || true, 'a different seed may differ (not asserted — it may collide)');
}

// ── 3. something you have not played ──────────────────────────────────

console.log('\n[method: something new]');
{
  // play 34 of the 35; the 35th is the only untouched one left
  const trios = allTrios();
  const target = trios[17]!;
  const history = trios.filter(t => t.join() !== target.join())
    .map((els, i) => ({ els, playedAt: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z` }));
  const r = resolve({ method: 'fresh', history });
  eq(r.els.join('+'), target.join('+'), 'the one trio nobody has played is the one picked');
  ok(r.detail.some(d => /never been played/.test(d)), 'and it says why');

  // nothing played at all: any trio is fine, but it must be a real one
  const blank = resolve({ method: 'fresh', history: [], rng: 42 });
  ok(trios.some(t => t.join() === blank.els.join()), 'an empty history still yields a real trio');

  // everything played: the STALEST wins
  const stale: Element[] = ['fire', 'water', 'earth'];
  const all = trios.map(els => ({
    els,
    playedAt: els.join() === stale.join()
      ? '2020-01-01T00:00:00.000Z' : '2026-08-20T12:00:00.000Z',
  }));
  const oldest = resolve({ method: 'fresh', history: all });
  eq(oldest.els.join('+'), stale.join('+'), 'with everything played, the least recent one wins');
  ok(oldest.detail.some(d => /Every trio has been played/.test(d)), 'and it says that too');

  // the tie-break must not be "first in the list", or it is fire+water+earth
  // forever: with an empty history every trio ties
  const seen = new Set<string>();
  for (let seed = 0; seed < 40; seed++) seen.add(resolve({ method: 'fresh', history: [], rng: seed }).els.join('+'));
  ok(seen.size > 5, `ties break at random, not by list order (${seen.size} distinct trios over 40 seeds)`);
}

// ── 4. rank all seven ─────────────────────────────────────────────────

console.log('\n[method: rank all seven]');
{
  const love: Element[] = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];
  const same = resolve({ method: 'rank', submissions: [{ ranking: love }, { ranking: love }], rng: 5 });
  eq(same.els.length, 3, 'three come back');
  eq(new Set(same.els).size, 3, 'and they are distinct — no element drawn twice');

  // agreement should show: over many seeds, a shared top-3 should dominate
  let topHits = 0;
  const RUNS = 200;
  for (let seed = 0; seed < RUNS; seed++) {
    const r = resolve({ method: 'rank', submissions: [{ ranking: love }, { ranking: love }], rng: seed });
    topHits += r.els.filter(e => love.slice(0, 3).includes(e)).length;
  }
  const share = topHits / (RUNS * 3);
  ok(share > 0.55, `a shared top three is heavily favoured (${Math.round(share * 100)}% of slots)`);
  ok(share < 1, 'but not a certainty — the draw is still a draw');

  // opposed rankings: the middle should come out ahead of either extreme
  const opposed: Element[] = [...love].reverse();
  let extremes = 0;
  for (let seed = 0; seed < RUNS; seed++) {
    const r = resolve({ method: 'rank', submissions: [{ ranking: love }, { ranking: opposed }], rng: seed });
    extremes += r.els.filter(e => e === 'fire' || e === 'dark').length;
  }
  ok(extremes / (RUNS * 3) < 0.45,
    `with opposite rankings nobody's favourite runs away with it (${Math.round(extremes / (RUNS * 3) * 100)}%)`);

  const r = resolve({ method: 'rank', submissions: [{ ranking: love }, { ranking: opposed }], rng: 1 });
  ok(r.detail.some(d => /Combined/.test(d)), 'the working shows the combined ranking');
}

// ── 5. sanitizing what arrives over the wire ──────────────────────────

console.log('\n[submissions]');
{
  eq(sanitizeSubmission({ element: 'plaid' }, 'pick-one').element, undefined, 'a made-up element is dropped');
  eq(sanitizeSubmission({ element: 'fire' }, 'pick-one').element, 'fire', 'a real one is kept');
  ok(!submissionReady({}, 'pick-one'), 'an empty pick is not ready');
  ok(submissionReady({ element: 'fire' }, 'pick-one'), 'a pick is');

  const partial = sanitizeSubmission({ ranking: ['dark', 'dark', 'nonsense', 'fire'] }, 'rank');
  eq(partial.ranking?.length, 7, 'a ranking is completed to all seven');
  eq(partial.ranking?.[0], 'dark', 'keeping what was given, in order');
  eq(partial.ranking?.[1], 'fire', 'with duplicates and junk stripped');
  ok(submissionReady(partial, 'rank'), 'and a completed ranking is ready');
  ok(submissionReady({}, 'fresh'), '"something new" needs nothing but your presence');
}

// ── 6. the live server ────────────────────────────────────────────────

console.log('\n[server: no cards until both are in]');
// R204/CT-85: the server picks its own port and tells us which — see
// test-util.ts. It used to be `freePort()` then PORT=<number>, which left the
// port unheld for as long as node took to boot.
const server = await spawnServer();
const PORT = server.port;

interface Msg { t: string; seat?: number; view?: any; waiting?: any; trio?: any; msg?: string; log?: string[] }

class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
  constructor() { this.ws = new WebSocket(`ws://localhost:${PORT}`); }
  open(): Promise<void> {
    return new Promise(res => {
      this.ws.addEventListener('message', ev => this.msgs.push(JSON.parse(String((ev as MessageEvent).data))));
      this.ws.addEventListener('open', () => res(), { once: true });
    });
  }
  send(o: unknown): void { this.ws.send(JSON.stringify(o)); }
  last(t: string): Msg | undefined { return [...this.msgs].reverse().find(m => m.t === t); }
  async settle(ms = 400): Promise<void> { await new Promise(r => setTimeout(r, ms)); }
}

let room = '';
try {
  room = (await (await fetch(`http://localhost:${PORT}/api/new`)).json() as { code: string }).code;
  const a = new Client(); await a.open();
  a.send({ t: 'join', room, seat: 0, name: 'Ben', mode: 'draft' });
  await a.settle();

  const joined = a.last('joined')!;
  ok(!!joined.waiting?.trio, 'a draft room opens in the lobby, not in a game');
  ok(!joined.view, 'and no game state is sent — nothing has been dealt');
  eq(joined.waiting.trio.method, 'pick-one', 'with a default method');
  eq(joined.waiting.trio.methods.length, 3, 'and all three offered');

  // the point of the whole feature
  a.send({ t: 'action', action: { type: 'donePlanning', seat: 0 } });
  await a.settle();
  ok(/not started|waiting/i.test(a.last('error')?.msg ?? ''),
    'no game action is possible while the lobby is open');

  a.send({ t: 'lobby', submission: { element: 'fire' }, lock: true });
  await a.settle();
  ok(a.last('update')?.waiting?.trio?.locked?.[0], 'locking in is recorded');
  ok(!a.last('update')?.waiting?.trio?.locked?.[1], 'and the empty seat is not');
  ok(!a.last('joined')?.view, 'one player locked in still deals nothing');

  const b = new Client(); await b.open();
  b.send({ t: 'join', room, seat: 1, name: 'Rashi', mode: 'draft' });
  await b.settle();
  const bJoin = b.last('joined')!;
  ok(!!bJoin.waiting?.trio, 'the joiner lands in the lobby too');
  eq(JSON.stringify(bJoin.waiting.trio.mine), '{}', 'and is shown their OWN submission, not their opponent\'s');
  eq(JSON.stringify(bJoin.waiting.trio).includes('fire'), false,
    'the opponent\'s pick never crosses the wire — a pick you can see is a pick you can counter');

  b.send({ t: 'lobby', submission: { element: 'dark' }, lock: true });
  await b.settle(700);

  for (const [who, c] of [['seat 0', a], ['seat 1', b]] as const) {
    const dealt = c.last('joined')!;
    ok(!!dealt.view, `${who} is dealt a game once both are locked in`);
    ok(!!dealt.trio, `${who} is told what the trio is`);
    ok(dealt.trio.els.includes('fire') && dealt.trio.els.includes('dark'),
      `${who}: both picks made it into the trio`);
    eq(dealt.trio.els.length, 3, `${who}: three elements`);
    ok(dealt.trio.detail.length >= 2, `${who}: the working came with it`);
  }
  const dealtView = a.last('joined')!.view;
  ok(dealtView.players[0].hand.length > 0, 'and there are actually cards in hand now');
  ok(a.last('joined')!.log?.some(l => /Trio:/.test(l)), 'the trio explanation is in the game log');

  // it survives a restart mid-choice
  const saved = JSON.parse(readFileSync(join(GAMES, `${room}.json`), 'utf8')) as { els: string[]; lobby: any };
  eq(saved.lobby?.result?.els?.length, 3, 'the resolved trio is persisted with the room');
  eq(saved.els.length, 3, 'and is the room\'s trio');

  // the escape hatch still works: a fixed trio skips the lobby entirely
  const direct = (await (await fetch(`http://localhost:${PORT}/api/new`)).json() as { code: string }).code;
  const c = new Client(); await c.open();
  c.send({ t: 'join', room: direct, seat: 0, mode: 'draft', els: ['water', 'metal', 'light'] });
  await c.settle();
  ok(!c.last('joined')?.waiting, 'a room created with an explicit trio has no lobby');
  ok(!!c.last('joined')?.view, 'and is dealt straight away');

  a.ws.close(); b.ws.close(); c.ws.close();
} finally {
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURES ✗`);
process.exit(failures === 0 ? 0 : 1);
