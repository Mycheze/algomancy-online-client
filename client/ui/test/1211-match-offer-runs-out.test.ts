/* 1211 — A MATCH OFFER AT 0 SAYS IT IS OVER (docs/23-ui-inventory/05 §18.20:
 * "Match-found countdown at 0 has no expired state").
 *
 * The Match found box counted down to 0 and stayed there: a live "Accept 0",
 * or "Waiting for Rashi… 0", until the server's 1s sweep pushed the lapse —
 * and for ever if the socket had dropped. The local count starts when the
 * offer ARRIVED, so it reaches 0 after the server's own clock has: an Accept
 * pressed then is too late, and the box should not ask for one.
 *
 * §1 pages/queue.ts at 0: no Accept, no count; a status line, and one way out
 * §2 queue.ts tickInPlace: at 0 it repaints once into that box, then leaves it
 *    (the 1s tick must not rebuild the page every second — test 902)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueHtml, type QueueView } from '../pages/queue.ts';
import type { QueueDeps } from '../queue.ts';

const view = (over: Partial<QueueView>): QueueView => ({
  pickMode: 'constructed', pickRanked: true, signedIn: true, counts: null, error: '',
  blocker: null, rating: null, deckPicker: '', searching: null, offer: null, chrome: { signedIn: true, alerts: 0 },
  ...over,
});
const O = { opponent: 'Rashi', opponentRating: 1490, mode: 'constructed' as const, accepted: false, expiresIn: 0 };
const btns = (html: string): string[] =>
  [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!).filter(b => b.startsWith('queue-') && b !== 'queue-home');

test('1211 §1 at 0 the box says time ran out, with no Accept and no count', () => {
  const live = queueHtml(view({ offer: { ...O, left: 1 } }));
  assert.match(live, /data-btn="queue-accept">Accept <span class="qcount" data-qleft>1</, 'positive control: at 1 it still asks');

  const out = queueHtml(view({ offer: { ...O, left: 0 } }));
  assert.doesNotMatch(out, /queue-accept/, 'no Accept once the offer is over');
  assert.doesNotMatch(out, /data-qleft/, 'no count left to tick');
  assert.match(out, /<p class="qwaiting qexpired" role="status" data-qexpired>Time ran out, so the game was not started\.<\/p>/);
  assert.deepEqual(btns(out), ['queue-decline']);
  assert.match(out, /data-btn="queue-decline">Close</, 'nothing left to decline');
  assert.match(out, /role="dialog" aria-label="Match found"/, 'still the same named dialog');

  const waited = queueHtml(view({ offer: { ...O, accepted: true, left: 0 } }));
  assert.doesNotMatch(waited, /Waiting for Rashi…|data-qleft/);
  assert.match(waited, /data-qexpired>Rashi did not answer in time\. You go back to the front of the queue\.<\/p>/);
  assert.match(waited, /data-btn="queue-decline">Cancel</);
  assert.doesNotMatch(waited, /If they do not answer in time/, 'the "if" has happened');
  assert.doesNotMatch(queueHtml(view({ offer: { ...O, opponent: '<Eve>', accepted: true, left: 0 } })), /<Eve>/);
});

/* §2 drives the real module: a fake socket hands it an offer, and a fake page
 * root stands in for #app. */
type Listener = (ev: { data?: string }) => void;
class FakeSocket {
  static OPEN = 1; static CONNECTING = 0; static last: FakeSocket | null = null;
  readyState = 0;
  private ls: Record<string, Listener[]> = {};
  constructor() { FakeSocket.last = this; }
  addEventListener(t: string, f: Listener): void { (this.ls[t] ??= []).push(f); }
  send(): void { /* the server is not here */ }
  fire(t: string, ev: { data?: string } = {}): void { if (t === 'open') this.readyState = 1; for (const f of this.ls[t] ?? []) f(ev); }
}
const store = new Map<string, string>();
Object.assign(globalThis, {
  WebSocket: FakeSocket,
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  location: { protocol: 'http:', host: 'x', search: '' },
  window: Object.assign(globalThis.window ?? {}, { setInterval: () => 1 }),
});

const root = (html: string) => {
  const qleft = [...html.matchAll(/data-qleft>(\d+)</g)].map(m => ({ textContent: m[1] }));
  return {
    qleft,
    querySelectorAll: (sel: string) => (sel === '[data-qleft]' ? qleft : []),
    querySelector: (sel: string) => (sel === '[data-qexpired]' && html.includes('data-qexpired') ? {} : null),
  } as unknown as ParentNode & { qleft: { textContent: string }[] };
};

test('1211 §2 the tick repaints once into the expired box, then leaves it alone', async () => {
  const q = await import('../queue.ts');
  let repaints = 0;
  q.initQueue({ app: {} as HTMLElement, rerender: () => { repaints++; }, chosenDeck: () => null, token: () => 'tok', rating: () => null, onGuest: () => {} } as QueueDeps);
  q.handleButton({ dataset: { btn: 'queue-accept' } } as unknown as HTMLElement);   // opens the socket
  const sock = FakeSocket.last!;
  assert.ok(sock, 'the module opened a socket');
  sock.fire('open');
  const offerMsg = (expiresIn: number) => sock.fire('message', { data: JSON.stringify({ t: 'queue', searching: null, offer: { ...O, expiresIn } }) });

  offerMsg(9000);
  const live = root('<b data-qleft>9</b>');
  assert.equal(q.tickInPlace(live), true, 'positive control: with time left the count is rewritten in place');
  assert.equal(live.qleft[0]!.textContent, '9');

  offerMsg(0);
  assert.equal(q.queueSnapshot().offerLeft, 0);
  assert.equal(q.tickInPlace(root('<button data-btn="queue-accept">Accept <span data-qleft>1</span></button>')), false,
    'at 0 a box still showing Accept 1 is repainted, not left counting');
  assert.equal(q.tickInPlace(root(queueHtml(view({ offer: { ...O, left: 0 } })))), true,
    'once the expired box is drawn, the tick leaves it alone');
  assert.ok(repaints > 0);
});
