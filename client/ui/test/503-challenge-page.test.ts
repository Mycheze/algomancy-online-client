/* docs/21 — the weekly challenge PAGE and the home card (ui/challenge.ts).
 *
 * Driven like 482 drives the league: a fresh copy of the module, a fetch that
 * answers as server/api-challenge.ts does, and clicks on the buttons the page
 * actually drew, with the attributes it drew them with.
 *
 *   §1 the home card: goal, time left, best Skill, Play — and nothing at all
 *      when there is no current week or no server
 *   §2 every page has a button: the header offers nav-challenge, and Play on
 *      the home card opens the page with the builder for this week
 *   §3 the page: goal, time left, the par line (higher is better, par = 100),
 *      my best, ONE leaderboard by Skill with the breakdown and no tabs
 *   §4 a closed week: its board names it; Try this deck loads the deck into
 *      that week's builder (one Undo away from the draft it replaced); Watch
 *      goes to the run
 *   §5 a run kept in this browser is submitted once there is a named account,
 *      and dropped when the server takes it
 *   §6 the builder's buttons edit the list in place and keep it per challenge;
 *      Import and Clear are one inline Undo away
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import { goalText, type ChallengeDef, type RunScore } from '../../engine/src/challenge.ts';

interface Call { method: string; url: string; body: Record<string, unknown> | null }

const NOW = Date.UTC(2026, 9, 20, 12);
const DAY = 86_400_000;
const units = DECK_LIST.filter(n => getCard(n).kind === 'unit').slice(0, 6);
const def = (id: string, week: string, n: number): ChallengeDef =>
  ({ id, week, title: `Week ${id}`, blurb: 'A short puzzle.', goal: { kind: 'unitsInPlay', n }, seed: 50300 + n, par: 24 });
const score = (skill: number): RunScore => ({ unique: 2, extra: 1, cards: 3, elements: 2, turns: 4, raw: 24, skill });
const CUR = { ...def('cur', '2026-10-18', 40), opens: NOW - 2 * DAY, closes: NOW + 4 * DAY + 3.5 * 3_600_000, closed: false, entrants: 7 };
const OLD = { ...def('old', '2026-10-11', 12), opens: NOW - 9 * DAY, closes: NOW - 2 * DAY, closed: true, entrants: 3 };
const OLD_DECK = [units[0]!, units[1]!, units[1]!];

interface Rig {
  ch: typeof import('../challenge.ts');
  calls: Call[];
  app: { innerHTML: string };
  store: Map<string, string>;
  rerenders: () => number;
  loc: { search: string; href: string };
}

let fresh = 0;
async function rig(opts: { current?: unknown; down?: boolean; token?: string; search?: string; kept?: unknown[]; submit?: Record<string, unknown> } = {}): Promise<Rig> {
  const store = new Map<string, string>();
  if (opts.token) store.set('algoToken', opts.token);
  if (opts.kept) store.set('algoChallengeDone', JSON.stringify(opts.kept));
  const g = globalThis as Record<string, unknown>;
  g['localStorage'] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) };
  const loc = { search: opts.search ?? '', href: `http://x/${opts.search ?? ''}` };
  g['location'] = loc;
  g['history'] = { replaceState() {} };
  g['innerWidth'] = 1200;
  g['document'] = { getElementById: () => null, createElement: () => ({ style: {} }), addEventListener() {}, querySelectorAll: () => [] };
  const calls: Call[] = [];
  g['fetch'] = async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(init.body) as Record<string, unknown> : null });
    if (opts.down) throw new Error('offline');
    if (url === '/api/challenge/run') return { status: 200, json: async () => opts.submit ?? { ok: true, runId: 'r9', score: score(9), improved: true, rank: 1 } };
    const b = /^\/api\/challenge\/([^/]+)\/board$/.exec(url);
    if (b) {
      const closed = b[1] === 'old';
      return { status: 200, json: async () => ({ id: b[1], closed, rows: [
        { rank: 1, name: 'Ann', score: score(12), at: NOW - DAY, ...(closed ? { runId: 'run-ann-1', deck: OLD_DECK } : {}) },
        { rank: 2, name: 'Bo', score: score(30), at: NOW - DAY, ...(closed ? { runId: 'run-bo-22', deck: [units[2]!] } : {}) },
      ], ...(closed ? { winner: { rank: 1, name: 'Ann', score: score(12), at: NOW - DAY } } : {}) }) };
    }
    return { status: 200, json: async () => ({ now: NOW, current: opts.current === undefined ? CUR : opts.current, past: [OLD],
      ...(opts.token ? { mine: { cur: score(18) } } : {}) }) };
  };
  const ch = await import(`../challenge.ts?fresh=${++fresh}`) as typeof import('../challenge.ts');
  const app = { innerHTML: '', classList: { remove() {} } };
  let n = 0;
  ch.initChallenge({ app: app as unknown as HTMLElement, rerender: () => { n++; } });
  await settle();
  return { ch, calls, app, store, rerenders: () => n, loc };
}
const settle = (): Promise<void> => new Promise(r => setTimeout(r, 15));

/** the button with these data attributes, in some html, as the element the click handler is given */
function button(html: string, want: Record<string, string>): HTMLElement {
  for (const m of html.matchAll(/<button\b([^>]*)>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[1]!.matchAll(/data-([a-z-]+)="([^"]*)"/g)) attrs[a[1]!.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = a[2]!;
    if (Object.entries(want).every(([k, v]) => attrs[k] === v)) return { dataset: attrs } as unknown as HTMLElement;
  }
  assert.fail(`no button ${JSON.stringify(want)} on the page`);
}

test('§1 the home card shows the week, and nothing when there is none', async () => {
  const r = await rig({ token: 'tok' });
  assert.equal(r.ch.homeCardHtml(), '', 'nothing before the answer');
  await settle();
  assert.ok(r.rerenders() >= 1, 'the answer repaints the home page');
  const card = r.ch.homeCardHtml();
  assert.match(card, new RegExp(goalText(CUR.goal)));
  assert.match(card, /4d 3h left/);
  assert.match(card, /your best: Skill 18/);
  assert.match(card, /data-btn="ch-home-play"/);
  assert.equal(r.calls.filter(c => c.url === '/api/challenge').length, 1, 'asked once');

  const none = await rig({ current: null });
  none.ch.homeCardHtml();
  await settle();
  assert.equal(none.ch.homeCardHtml(), '', 'no current week, no card');
  const down = await rig({ down: true });
  down.ch.homeCardHtml();
  await settle();
  assert.equal(down.ch.homeCardHtml(), '', 'no server, no card');
  assert.equal(down.ch.navButtonHtml(), '', 'and no header button');
});

test('§2 the header button and the home card both lead to the page', async () => {
  const r = await rig();
  r.ch.homeCardHtml();
  await settle();
  assert.match(r.ch.navButtonHtml(), /data-btn="nav-challenge"/);
  assert.equal(r.ch.screen(), null, 'on the home page');
  r.ch.handleButton(button(r.ch.homeCardHtml(), { btn: 'ch-home-play' }));
  await settle();
  assert.equal(r.ch.screen(), 'challenge');
  assert.match(r.app.innerHTML, /Your deck/, 'Play opens the builder for this week');
  assert.match(r.app.innerHTML, /data-btn="ch-browse"/);
  r.ch.handleButton(button(r.app.innerHTML, { btn: 'ch-close' }));
  assert.equal(r.ch.screen(), null, 'Back leaves');
});

test('§3 the page: goal, time left, the par line, my best, one leaderboard', async () => {
  const r = await rig({ token: 'tok', search: '?challenge' });
  await settle();
  const html = r.app.innerHTML;
  assert.match(html, /Weekly challenge/);
  assert.match(html, new RegExp(goalText(CUR.goal)));
  assert.match(html, /4d 3h left · 7 entrants/);
  assert.match(html, /Higher Skill is better\. Par scores 100\./, 'one line says which way Skill goes');
  assert.match(html, /This week's par is 24/, 'the par number is in its tooltip');
  assert.match(html, /<h4>Your best<\/h4>.*<div class="statval">18<\/div><div class="statlab">Skill<\/div>/s);
  assert.match(html, /<h3>Leaderboard<\/h3>/);
  assert.doesNotMatch(html, /ch-tab|data-cat=/, 'no category tabs');
  assert.match(html, /<th>Skill<\/th><th>Cards<\/th><th>Elements<\/th><th>Turns<\/th>/);
  assert.match(html, /<td>Ann<\/td><td><b>12<\/b><\/td><td>3 <span class="dim">\(1 extra\)<\/span><\/td><td>2<\/td><td>4<\/td>/,
    'a row: Skill, then cards (with the extra copies), elements and turns');
  assert.doesNotMatch(html, /data-btn="ch-try" data-id="cur"/, 'an open week shows no decks');
  assert.ok(r.calls.some(c => c.url === '/api/challenge/cur/board'), 'the one board, no category asked');
});

test('§4 a closed week: Try this deck loads it into the builder, Watch goes to the run', async () => {
  const r = await rig({ search: '?challenge' });
  assert.match(r.app.innerHTML, /data-btn="ch-past" data-id="old">Leaderboard<\/button>/, 'a past week opens its leaderboard');
  r.ch.handleButton(button(r.app.innerHTML, { btn: 'ch-past', id: 'old' }));
  await settle();
  const html = r.app.innerHTML;
  assert.match(html, /Winner: <b>Ann<\/b>/);
  assert.match(html, /<h3>Week old <span class="dim">· week of 2026-10-11<\/span><\/h3>/, 'a past board names its week');
  r.store.set('algoChallengeDecks', JSON.stringify({ old: [units[3]!] }));
  r.ch.handleButton(button(html, { btn: 'ch-try', id: 'old', run: 'run-ann-1' }));
  assert.deepEqual([...r.ch.builderList()], OLD_DECK);
  assert.match(r.app.innerHTML, /This week is closed/);
  assert.deepEqual(JSON.parse(r.store.get('algoChallengeDecks')!)['old'], OLD_DECK, 'kept as the draft for that week');
  // the draft it replaced is one Undo away
  assert.match(r.app.innerHTML, /Loaded Ann&#39;s deck\.|Loaded Ann's deck\./);
  r.ch.handleButton(button(r.app.innerHTML, { btn: 'ch-undo' }));
  assert.deepEqual([...r.ch.builderList()], [units[3]!], 'Undo puts the old draft back');
  assert.doesNotMatch(r.app.innerHTML, /data-btn="ch-undo"/, 'one step only');
  r.ch.handleButton(button(r.app.innerHTML, { btn: 'ch-watch', run: 'run-bo-22' }));
  assert.equal(r.loc.search, '?challenge=watch&run=run-bo-22');
});

test('§5 a kept run is submitted once signed in, and dropped when taken', async () => {
  const kept = { challengeId: 'cur', title: 'Week cur', deck: [units[0]!], actions: [{ type: 'donePlanning', seat: 1 }], score: score(5), at: 123 };
  const guest = await rig({ search: '?challenge', kept: [kept] });
  assert.match(guest.app.innerHTML, /Finished runs/);
  assert.match(guest.app.innerHTML, /Skill 5 · 3 cards \(1 extra\) · 2 elements · 4 turns/, 'the kept run shows its Skill');
  assert.match(guest.app.innerHTML, /data-btn="ch-signin"/, 'signed out: the way to sign in');
  assert.ok(!guest.calls.some(c => c.method === 'POST'), 'nothing sent without an account');

  const r = await rig({ search: '?challenge', kept: [kept], token: 'tok' });
  await settle();
  const posts = r.calls.filter(c => c.method === 'POST');
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0]!.body, { challengeId: 'cur', deck: kept.deck, actions: kept.actions }, 'exactly what the server wants');
  assert.equal(r.store.get('algoChallengeDone'), undefined, 'taken, so forgotten');

  const refused = await rig({ search: '?challenge', kept: [kept], token: 'tok', submit: { ok: false, error: 'not the dummy\'s move', at: 3 } });
  await settle();
  assert.match(refused.app.innerHTML, /not the dummy&#39;s move|not the dummy's move/);
  assert.ok(refused.store.get('algoChallengeDone'), 'a refused run is kept');
});

test('§6 the builder edits in place and keeps a draft per challenge', async () => {
  const r = await rig({ search: '?challenge=cur' });
  r.ch.handleButton(button(r.app.innerHTML, { btn: 'ch-import' }));
  // no collection: the deck chosen on the home page is offered
  r.store.set('algoDeck', JSON.stringify({ name: 'Chosen', author: 'me', cards: [units[0], units[1], units[2]] }));
  r.ch.handleButton(button(r.app.innerHTML, { btn: 'ch-import' }));
  r.ch.handleButton(button(r.app.innerHTML, { btn: 'ch-import' }));
  r.ch.handleButton(button(r.app.innerHTML, { btn: 'ch-importdeck', id: '__chosen' }));
  assert.deepEqual([...r.ch.builderList()], [units[0], units[1], units[2]]);
  assert.match(r.app.innerHTML, /Imported Chosen\. <button data-btn="ch-undo">/);
  r.ch.handleButton(button(r.app.innerHTML, { btn: 'ch-down', b: '0' }));
  assert.deepEqual([...r.ch.builderList()], [units[1], units[0], units[2]]);
  assert.doesNotMatch(r.app.innerHTML, /data-btn="ch-undo"/, 'an ordinary edit ends the undo');
  r.ch.handleButton(button(r.app.innerHTML, { btn: 'ch-more', b: '2' }));
  r.ch.handleButton(button(r.app.innerHTML, { btn: 'ch-cut', b: '0' }));
  assert.deepEqual([...r.ch.builderList()], [units[0], units[2], units[2]]);
  assert.match(r.app.innerHTML, /class="chpos">2–3</, 'the two copies are one row');
  assert.deepEqual(JSON.parse(r.store.get('algoChallengeDecks')!)['cur'], [units[0], units[2], units[2]]);
  r.ch.handleButton(button(r.app.innerHTML, { btn: 'ch-clear' }));
  assert.deepEqual([...r.ch.builderList()], []);
  r.ch.handleButton(button(r.app.innerHTML, { btn: 'ch-undo' }));
  assert.deepEqual([...r.ch.builderList()], [units[0], units[2], units[2]], 'Clear is one Undo away');
  r.ch.handleButton(button(r.app.innerHTML, { btn: 'ch-play' }));
  assert.equal(r.loc.search, '?challenge=play&id=cur', 'Play goes to the run');
  const run = JSON.parse(r.store.get('algoChallengeRun')!) as { def: ChallengeDef; deck: string[]; actions: unknown[] };
  assert.deepEqual(run.deck, [units[0], units[2], units[2]]);
  assert.deepEqual(run.def, def('cur', '2026-10-18', 40), 'the challenge itself (its par too), no page furniture');
  assert.deepEqual(run.actions, []);
});
