/* 1495 — A PAGE ASKING AGAIN SAYS SO, AND ONLY THE LATEST ANSWER LANDS
 * (BL-10, docs/23-ui-inventory/03 §6.7: "No loading indicator on a refetch").
 *
 * Card stats asks the server again on every format, date and "rated only" /
 * "both signed in" / "my games" change, the metagame's deck list on every
 * re-sort, the card ladder each time it opens. While it waited, the old
 * numbers sat under the new filters with nothing to say they were old: the
 * page drew "loading…" only when it had nothing at all. And a reply that came
 * back late — a quick second click — was painted over the newer one, leaving
 * numbers that answer filters no longer lit.
 *
 *   §1 card stats: a refetch says Updating… where the counts were and marks
 *      the table busy and dimmed; the answer takes both away
 *   §2 card stats: two quick asks, answered out of order — the later ask's
 *      numbers stay
 *   §3 metagame: a re-sort and a reopened ladder say Updating… and dim their
 *      list; a late reply to the older sort is dropped; a deck opened after
 *      another is not overwritten by the first one's reply
 *   §4 the frame's dimmed region has its rule in the stylesheet
 *
 * No browser runs here: the pages are driven through a fake fetch whose
 * replies the test releases one by one, and their real paint() into a
 * stand-in #app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStyles } from './read-styles.ts';

type Reply = { url: string; release: (body: unknown) => void };
const held: Reply[] = [];
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) },
  location: { protocol: 'http:', host: 'x', search: '', href: 'http://x/', origin: 'http://x', pathname: '/' },
  history: { replaceState() {} },
  innerWidth: 1200,
  document: { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {} }), addEventListener() {}, querySelectorAll: () => [] },
  fetch: (url: string) => new Promise(resolve => {
    held.push({ url, release: body => resolve({ status: 200, json: async () => body }) });
  }),
});
const settle = (): Promise<void> => new Promise(r => setTimeout(r, 15));
const btn = (data: Record<string, string>): HTMLElement => ({ dataset: data }) as unknown as HTMLElement;
/** release the held reply whose URL matches, and let the page paint it */
async function answer(match: (url: string) => boolean, body: unknown): Promise<void> {
  const i = held.findIndex(h => match(h.url));
  assert.ok(i >= 0, `a request is waiting for ${match}`);
  held.splice(i, 1)[0]!.release(body);
  await settle();
}

const wr = (n: number, w: number) => ({ n, w });
/** a card stats answer whose game count names it */
const stats = (games: number): unknown => ({
  ok: true, games, seatGames: games * 2, coverage: { open: 1, draws: 1, plays: 1, picks: 1, init: 1 },
  sources: { live: games }, firstPlayed: '2026-10-01T00:00Z', lastPlayed: '2026-11-01T00:00Z',
  cards: [{ card: 'Fight', games, gih: wr(games, 1), oh: wr(1, 1), drawn: wr(1, 1), played: wr(1, 1), gns: wr(1, 0),
    copiesSeen: 1, timesPlayed: 1, recycled: 0, bottomed: 0, gihPlayed: 1, recycledFull: 0, bottomedFull: 0,
    firstTurnSum: 1, firstTurnN: 1, turnHist: [1], offered: 0, picked: 0, pickPosSum: 0, given: 0, deck: wr(0, 0), deckCopies: 0 }],
  elements: [], pairs: {}, trios: {}, onPlay: wr(1, 1), turns: {}, constructedSeatGames: 0, floor: 5,
});
const games = (html: string): string | undefined => html.match(/<b>(\d+)<\/b> games? · /)?.[1];
const UPDATING = /<span class="hint frameupdating" role="status">Updating…<\/span>/;

function stage(): HTMLElement & { innerHTML: string } {
  return { innerHTML: '', classList: { remove() {} } } as unknown as HTMLElement & { innerHTML: string };
}

const meta = await import('../meta.ts');
const app = stage();
meta.initMeta({ app, rerender: () => {} });

test('1495 §1 BL-10: card stats says Updating… while it asks again, and dims the old table', async () => {
  meta.openStats();
  await answer(u => u.startsWith('/api/cardstats'), stats(12));
  assert.equal(games(app.innerHTML), '12', 'positive control: the first answer is drawn');
  assert.doesNotMatch(app.innerHTML, UPDATING);
  assert.doesNotMatch(app.innerHTML, /data-stale/);

  meta.handleButton(btn({ btn: 'meta-cs-rated' }));
  assert.match(app.innerHTML, UPDATING, 'the refetch is said at once');
  assert.equal(games(app.innerHTML), undefined, 'in place of the old answer\'s counts');
  assert.match(app.innerHTML, /class="dkwork cswork" data-stale aria-busy="true"/, 'the old table is busy and dimmed');

  meta.handleButton(btn({ btn: 'meta-cs-section', v: 'elements' }));
  assert.match(app.innerHTML, /class="csscroll" data-scroll="cs-elements" data-stale aria-busy="true"/, 'the other sections too');
  meta.handleButton(btn({ btn: 'meta-cs-section', v: 'cards' }));

  await answer(u => u.includes('rated=1'), stats(7));
  assert.equal(games(app.innerHTML), '7', 'the new answer is drawn');
  assert.doesNotMatch(app.innerHTML, UPDATING);
  assert.doesNotMatch(app.innerHTML, /data-stale|aria-busy/);
});

test('1495 §2 BL-10: card stats keeps the answer to the latest ask when replies come back out of order', async () => {
  meta.handleButton(btn({ btn: 'meta-cs-mode', v: 'draft' }));
  meta.handleButton(btn({ btn: 'meta-cs-mode', v: 'constructed' }));
  assert.equal(held.length, 2, 'two asks in flight');
  await answer(u => u.includes('mode=constructed'), stats(30));
  assert.equal(games(app.innerHTML), '30', 'the latest ask is drawn');
  await answer(u => u.includes('mode=draft'), stats(99));
  assert.equal(games(app.innerHTML), '30', 'a late reply to the older ask is dropped');
  assert.doesNotMatch(app.innerHTML, UPDATING);
});

const deck = (id: string, name: string): unknown => ({
  id, name, owner: { id: 'u1', name: 'Rashi' }, cards: [], description: '', updated: '2026-11-01T00:00Z',
  record: { wins: 3, losses: 1, games: 4 }, cover: null,
});

test('1495 §3 BL-10: the metagame\'s re-sort and the card ladder say Updating…, and a late reply is dropped', async () => {
  meta.openMeta();
  await answer(u => u.startsWith('/api/deck/meta?sort=winrate'), { ok: true, decks: [], minGames: 5 });
  assert.match(app.innerHTML, /Nothing on the list yet/, 'positive control: the list is drawn');
  assert.doesNotMatch(app.innerHTML, UPDATING);

  meta.handleButton(btn({ btn: 'meta-sort', sort: 'games' }));
  meta.handleButton(btn({ btn: 'meta-sort', sort: 'name' }));
  assert.match(app.innerHTML, UPDATING, 'a re-sort is said');
  assert.match(app.innerHTML, /class="framelist" data-scroll="meta-decks" data-stale aria-busy="true"/, 'and the list dimmed');
  await answer(u => u.includes('sort=name'), { ok: true, decks: [deck('d1', 'Newest answer')], minGames: 5 });
  await answer(u => u.includes('sort=games'), { ok: true, decks: [deck('d2', 'Stale answer')], minGames: 5 });
  assert.match(app.innerHTML, /Newest answer/);
  assert.doesNotMatch(app.innerHTML, /Stale answer/, 'the reply to the older sort is dropped');
  assert.doesNotMatch(app.innerHTML, UPDATING);
  assert.doesNotMatch(app.innerHTML, /data-stale/);

  meta.openLadder();
  assert.doesNotMatch(app.innerHTML, UPDATING, 'the first ladder has nothing old to mark');
  await answer(u => u.startsWith('/api/cardladder'), { ok: true, cards: [], rankedAfter: 5, duels: 2 });
  assert.match(app.innerHTML, /2 duels · 0 cards rated/, 'positive control: the ladder is drawn');
  meta.openLadder();
  assert.match(app.innerHTML, UPDATING, 'a reopened ladder says it is asking again');
  assert.match(app.innerHTML, /class="framelist" data-scroll="meta-ladder" data-stale aria-busy="true"/);
  await answer(u => u.startsWith('/api/cardladder'), { ok: true, cards: [], rankedAfter: 5, duels: 3 });
  assert.match(app.innerHTML, /3 duels · 0 cards rated/);
  assert.doesNotMatch(app.innerHTML, UPDATING);

  meta.handleButton(btn({ btn: 'meta-open', id: 'a' }));
  meta.handleButton(btn({ btn: 'meta-open', id: 'b' }));
  await answer(u => u.includes('id=b'), { ok: true, deck: deck('b', 'Second deck') });
  await answer(u => u.includes('id=a'), { ok: true, deck: deck('a', 'First deck') });
  assert.match(app.innerHTML, /Second deck/, 'the deck opened last stays');
  assert.doesNotMatch(app.innerHTML, /First deck/);
  assert.equal(held.length, 0, 'every ask was answered');
});

test('1495 §4 BL-10: the dimmed region has its rule', () => {
  assert.match(readStyles(), /\.apppage \[data-stale\] \{ opacity: \.5; \}/);
});
