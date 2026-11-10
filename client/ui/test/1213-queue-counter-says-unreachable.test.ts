/* 1213 — THE MATCHMAKING COUNTER SAYS WHEN THE SERVER STOPS ANSWERING (BL-10,
 * docs/23-ui-inventory/01 §4 S16: "No 'can't reach the server' state for the
 * matchmaking strip: it keeps the last number, or 'checking…' for ever when
 * offline").
 *
 * ui/queue.ts polls /api/queue every 5s. A failed poll used to be swallowed
 * ("keep the last number rather than blanking it"), so with the server down
 * the home's Matchmaking card kept a lit "2 waiting" and the open games' Join
 * buttons for as long as it stayed down. Now two misses in a row put
 * `unreachable` in the snapshot; the view drops the stale count and the Join
 * buttons, and the first answer brings them back.
 *
 * §1 the pure drawing: the strip, the home glance and the queue page say it
 * §2 the real poll through a fake fetch: answer → two misses → answer
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueGlanceHtml, queueHtml, queueStripHtml, type QueueView } from '../pages/queue.ts';
import type { QueueDeps } from '../queue.ts';

const COUNTS = { total: 2, byMode: { constructed: 1, draft: 1 } };
const OPEN = [{ id: 'g1', username: 'Rashi', mode: 'draft' as const, ranked: true, rating: 1490, waitedMs: 42_000 }];

test('1213 §1 the strip, the home card and the queue page say the server is not answering', async () => {
  const { UNREACHABLE_LINE } = await import('../queue.ts');
  assert.match(UNREACHABLE_LINE, /could not reach the server/);
  const strip = queueStripHtml({ counts: null, openGames: [], unreachable: true });
  assert.ok(strip.includes(`<span class="qstripcount">${UNREACHABLE_LINE}</span>`), strip);
  const glance = queueGlanceHtml({ counts: null, openGames: [], unreachable: true });
  assert.ok(glance.includes(`<span class="qglcount">${UNREACHABLE_LINE}</span>`), 'not lit');
  assert.doesNotMatch(glance, /queue-join-open|<b>\d/, 'no Join, no per-format number');
  const page = queueHtml({
    counts: null, unreachable: true, error: '', pickMode: 'draft', pickRanked: true, signedIn: true,
    blocker: null, rating: null, deckPicker: '', searching: null, offer: null,
    chrome: { account: '', bell: '' },
  } as unknown as QueueView);
  assert.ok(page.includes(`<div class="qcounts">${UNREACHABLE_LINE}</div>`));
  // positive control: answered, the line is the count
  assert.doesNotMatch(queueGlanceHtml({ counts: COUNTS, openGames: OPEN }), /could not reach/);
});

/* ── §2: the module itself ─────────────────────────────────────────── */

type Reply = 'ok' | 'down' | 'not-json';
let reply: Reply = 'ok';
let tick: (() => void) | null = null;
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  location: { protocol: 'http:', host: 'x', search: '' },
  window: Object.assign(globalThis.window ?? {}, { setInterval: (f: () => void) => { tick = f; return 1; } }),
  fetch: async (url: string) => {
    assert.equal(url, '/api/queue');
    if (reply === 'down') throw new TypeError('Failed to fetch');
    return { json: async () => {
      if (reply === 'not-json') throw new SyntaxError('Unexpected token < in JSON');   // Caddy's 502 page
      return { ok: true, counts: COUNTS, open: OPEN };
    } };
  },
});
const settle = (): Promise<void> => new Promise(r => setImmediate(r));

test('1213 §2 two unanswered polls hide the last count and the Join buttons; an answer brings them back', async () => {
  const q = await import('../queue.ts');
  const pq = await import('../pages/queue.ts');
  let repaints = 0;
  q.initQueue({ app: {} as HTMLElement, rerender: () => { repaints++; }, chosenDeck: () => null, token: () => null, rating: () => null, onGuest: () => {} } as QueueDeps);

  q.startCountsPoll();   // polls once at once
  await settle();
  assert.ok(tick, 'the poll armed its interval');
  assert.equal(q.queueSnapshot().unreachable, false);
  assert.match(pq.queueGlanceHtml(pq.queueStripView()), /<span class="qglcount live">2 waiting/, 'positive control: the answer is drawn');
  assert.match(pq.queueGlanceHtml(pq.queueStripView()), /queue-join-open/);

  reply = 'down';
  tick!(); await settle();
  assert.equal(q.queueSnapshot().unreachable, false, 'one miss is a blip, not a verdict');
  const before = repaints;
  reply = 'not-json';
  tick!(); await settle();
  assert.equal(q.queueSnapshot().unreachable, true, 'two misses in a row');
  assert.equal(repaints, before + 1, 'the flip repaints once');
  const down = pq.queueGlanceHtml(pq.queueStripView());
  assert.match(down, /could not reach the server/);
  assert.doesNotMatch(down, /2 waiting|queue-join-open|qglcount live/, 'the frozen count and its Join buttons are gone');
  assert.match(pq.queueHtml(pq.queueView()), /<div class="qcounts">could not reach the server/);
  tick!(); await settle();
  assert.equal(repaints, before + 1, 'staying down does not repaint every poll');

  reply = 'ok';
  tick!(); await settle();
  assert.equal(q.queueSnapshot().unreachable, false, 'the first answer brings it back');
  assert.match(pq.queueGlanceHtml(pq.queueStripView()), /<span class="qglcount live">2 waiting.*queue-join-open/s);
  assert.equal(repaints, before + 2);
});
