/* 1219 — SENDING A DECK TO A FRIEND, ON SCREEN (owner, #steward 2026-11-10).
 *
 * "When you're on the deck sharing page, there should be way to, basically,
 * send them a notification that they can click on to view the deck you want
 * them to see." The Decks page's Share sheet lists the bell's friends with a
 * Send each (POST /api/inbox/deck); the friend's bell has "<you> sent you a
 * deck: <name>" with View (opens `?deck=<id>`) and Dismiss. The server half
 * is server/test/1218.
 *
 *  §1 drawn: the Share sheet's friend list — Send, Sent ✓, locked while private, none yet, loading
 *  §2 drawn: the bell's line — the sentence, View carrying the deck id, Dismiss; escaped
 *  §3 clicked: Send posts the deck to that friend and the button says Sent ✓
 *  §4 clicked: the bell counts the sent deck; View clears it and opens the shared deck page
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { decksHtml, decksView, type DeckSource, type DecksState } from '../pages/decks.ts';
import { inboxListHtml } from '../pages/inbox.ts';

/* ── §1–2: the markup, no page ───────────────────────────────────────── */

const NAMES = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n));
const deck = (over: Partial<DeckSource> = {}): DeckSource => ({
  id: 'd1', name: 'Deck 1', cards: NAMES.slice(0, 30), maybe: [], sideboard: [], cover: null,
  visibility: 'unlisted', updatedAt: '2026-11-01T10:00:00Z', author: 'you', record: { games: 0, wins: 0, losses: 0, unresolved: 0 }, ...over,
});
const FRIENDS = [
  { id: 'u-r', username: 'Rashi', status: 'online' as const },
  { id: 'u-c', username: 'Cy <b>', status: 'offline' as const },
];
function sheetHtml(over: Partial<DecksState> = {}, d: DeckSource = deck(), withShare = true): string {
  const st: DecksState = {
    signedIn: true, loading: false, decks: [d], openId: 'd1', sort: 'recent', msg: '', descOpen: false,
    chosenId: null, sheet: { kind: 'share' }, history: [], base: 'http://x/', exportBody: '',
    share: { loaded: true, friends: FRIENDS, sentTo: [], msg: '' }, ...over,
  };
  if (!withShare) delete st.share;
  return decksHtml(decksView(st));
}
const sendBtns = (h: string): string[] => [...h.matchAll(/<button[^>]*data-btn="deck-send"[^>]*>[^<]*<\/button>/g)].map(m => m[0]);

test('1219 §1 the Share sheet lists your friends with a Send each', () => {
  const h = sheetHtml();
  assert.match(h, /<h3 class="dksheeth">Send to a friend<\/h3>/);
  const btns = sendBtns(h);
  assert.equal(btns.length, 2);
  assert.match(btns[0]!, /data-id="u-r"/);
  assert.match(btns[0]!, />Send<\/button>/);
  assert.doesNotMatch(btns[0]!, /disabled/);
  assert.match(h, /<span class="rfname">Cy &lt;b&gt;<\/span>\s*<span class="rfstatus">offline<\/span>/, 'offline friends too, escaped');
  // sent from here: the button says so and is spent
  const sent = sendBtns(sheetHtml({ share: { loaded: true, friends: FRIENDS, sentTo: ['u-r'], msg: '' } }));
  assert.match(sent[0]!, /disabled[^>]*>Sent ✓<\/button>/);
  assert.match(sent[1]!, />Send<\/button>/);
  // private: nothing can go, and the sheet says what to do
  const priv = sheetHtml({}, deck({ visibility: 'private' }));
  assert.ok(sendBtns(priv).every(b => /disabled/.test(b)), 'every Send is off on a private deck');
  assert.match(priv, /Private decks cannot be sent: choose Unlisted or Public first\./);
  // a refusal from the server is said
  assert.match(sheetHtml({ share: { loaded: true, friends: FRIENDS, sentTo: [], msg: 'you can only send a deck to a friend' } }),
    /you can only send a deck to a friend/);
  // no friends yet; the poll not back yet; no list at all without one
  assert.match(sheetHtml({ share: { loaded: true, friends: [], sentTo: [], msg: '' } }), /Add friends on your profile and they show up here\./);
  assert.match(sheetHtml({ share: { loaded: false, friends: [], sentTo: [], msg: '' } }), /<div class="dksendlist"><p class="hint">…<\/p>/);
  assert.doesNotMatch(sheetHtml({}, deck(), false), /Send to a friend/);
});

test('1219 §2 the bell\'s line: who, which deck, View and Dismiss', () => {
  const h = inboxListHtml({ bellMsg: '', matches: [], invites: [], times: [], requests: [], notes: [],
    decks: [{ id: 's1', from: 'Ben', deck: 'd9', name: 'Tempo <Fire>' }] });
  assert.match(h, /<b>Ben<\/b> sent you a deck: <b>Tempo &lt;Fire&gt;<\/b>\./);
  assert.match(h, /<button class="primary" data-inbox="deck-view" data-id="s1" data-deck="d9">View<\/button>/);
  assert.match(h, /<button data-inbox="deck-clear" data-id="s1">Dismiss<\/button>/);
  assert.doesNotMatch(h, /Nothing new/);
});

/* ── §3–4: the real client ───────────────────────────────────────────── */

const base = { maybe: [], sideboard: [] as string[], cover: null, author: 'you', createdAt: '2026-11-01T00:00:00Z', problems: [], ccProblems: [] };
const A = { ...base, id: 'dA', name: 'Alpha', cards: NAMES.slice(0, 15).flatMap(n => [n, n]), visibility: 'public',
  updatedAt: '2026-11-03T00:00:00Z', record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null } };
const POSTS: { url: string; body: Record<string, unknown> }[] = [];
let SHARES = [{ id: 's1', from: 'Ben', deck: 'dZ', name: 'Ben\'s Brew', at: 1 }];
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't1219' };
g['__UI_DRIVER_FETCH'] = async (url: string, init?: { body?: string }) => {
  if (init?.body) POSTS.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
  if (url === '/api/decks') return { ok: true, status: 200, json: async () => ({ ok: true, decks: [A] }) };
  if (url === '/api/inbox' || url.startsWith('/api/inbox?')) {
    return { ok: true, status: 200, json: async () => ({ ok: true, invites: [], requests: [], league: [], times: [],
      friends: [{ id: 'u-r', username: 'Rashi', favoriteElement: null, status: 'online', invite: null }], decks: SHARES }) };
  }
  if (url === '/api/inbox/deck') return { ok: true, status: 200, json: async () => ({ ok: true }) };
  if (url === '/api/inbox/deck/clear') { SHARES = []; return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
await flush();

test('1219 §3 Send posts the deck to that friend, and the button says Sent', async () => {
  ui.click({ btn: 'deck-openpage' });
  await flush();
  let html = ui.click({ btn: 'deck-share' });
  assert.match(html, /Send to a friend/);
  assert.match(html, /<span class="rfname">Rashi<\/span>/, 'the friends the bell\'s poll brought');
  html = ui.click({ btn: 'deck-send', id: 'u-r' });
  const sent = POSTS.filter(p => p.url === '/api/inbox/deck');
  assert.deepEqual(sent.map(p => p.body), [{ to: 'u-r', deck: 'dA' }]);
  assert.match(html, /disabled[^>]*>Sent ✓<\/button>/);
  await flush();
  assert.match(ui.html(), />Sent ✓<\/button>/, 'and still after the answer');
  ui.click({ btn: 'deck-share-close' });
});

test('1219 §4 the bell counts the sent deck; View clears it and opens the deck', async () => {
  let html = ui.html();
  assert.match(html, /data-inbox="bell"[^>]*>🔔<span class="inboxcount">1<\/span>/, 'the bell counts it');
  html = ui.click({ inbox: 'bell' });
  assert.match(html, /<b>Ben<\/b> sent you a deck: <b>Ben(&#39;|')s Brew<\/b>\./);
  ui.click({ inbox: 'deck-view', id: 's1' });
  assert.deepEqual(POSTS.filter(p => p.url === '/api/inbox/deck/clear').map(p => p.body), [{ id: 's1' }]);
  await flush();
  assert.equal(location.search, '?deck=dZ', 'the shared deck page, as the share link opens it');
});
