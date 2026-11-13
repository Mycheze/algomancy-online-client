/* 1240 — A PAGE'S "COULD NOT LOAD" LINE GOES AWAY WHEN THE PAGE LOADS
 * (BL-10, docs/23-ui-inventory/02 §8.5 item 28: "The league `msg` never
 * clears").
 *
 * The League, Weekly challenge and Metagame pages keep one message line. A
 * load that failed wrote "could not reach the server" into it — and nothing
 * took it away: the bell's refresh, a season switch, a re-sort all loaded the
 * page fine underneath a red line saying it could not. Now a load's own
 * failure is cleared by the next load that works, while a line the player
 * caused (a refusal, a result) is not: it is still true after the reload that
 * follows every action. And switching the League to another season drops a
 * line about the season that was on screen.
 *
 *   §1 league.ts: miss → the bell's refresh loads → gone; a refusal survives
 *      its reload; another season clears the line
 *   §2 challenge.ts: miss → a refresh loads → gone
 *   §3 meta.ts: the deck list's miss → a re-sort loads → gone; the card
 *      ladder the same
 *   §4 the census: in each of the three, every load failure goes through
 *      missed(), every load success through loaded()
 *
 * No browser runs here: the pages are driven through a fake fetch and their
 * real paint() into a stand-in #app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UI_DIR } from '../../engine/scripts/paths.mjs';

const NOW = Date.UTC(2026, 10, 13, 12);
const season = (id: string, name: string): unknown => ({
  id, name, format: 'draft', phase: 0, label: 'Sign-ups', weeks: 4, perWeek: 1, lateUntil: 1,
  signupOpens: '2026-11-01T00:00:00Z', start: '2026-11-15T00:00:00Z',
  phases: [{ phase: 0, label: 'Sign-ups', at: '2026-11-01T00:00:00Z' }, { phase: 1, label: 'Week 1', at: '2026-11-15T00:00:00Z' }],
  auto: true, hold: false, hidden: false, entrants: [], standings: [], matches: [], champion: null,
  me: { entered: false, withdrawn: false, skips: [], joinProblem: null, contact: '', suggestions: [], week0Cap: 3, matches: [] },
});
const S1 = season('s1', 'November League');
const S2 = season('s2', 'October League');

/** the server: up or down, and what each URL answers */
let down = false;
const asked: string[] = [];
function answer(url: string): unknown {
  if (url.startsWith('/api/league/join')) return { ok: false, error: 'Sign-ups are closed.' };
  if (url.startsWith('/api/league')) {
    const s = url.includes('season=s2') ? S2 : S1;
    return { ok: true, season: s, others: [], seasons: [S1, S2], signedIn: true, availability: null, contact: '', minHours: 2, organizer: false };
  }
  if (/^\/api\/challenge\/[^/]+\/board$/.test(url)) {
    return { id: 'w1', closed: false, boards: { fastest: [], leanest: [], purest: [], overall: [] } };
  }
  if (url.startsWith('/api/challenge')) {
    return { now: NOW, current: { id: 'w1', week: '2026-11-09', title: 'Burn it down', blurb: '', goal: { kind: 'win' }, seed: 1, par: 20,
      opens: NOW - 86_400_000, closes: NOW + 86_400_000, closed: false, entrants: 4 }, past: [] };
  }
  if (url.startsWith('/api/deck/meta')) return { ok: true, decks: [], minGames: 5 };
  if (url.startsWith('/api/cardladder')) return { ok: true, cards: [], rankedAfter: 5, duels: 0 };
  assert.fail(`an unexpected request: ${url}`);
}
const store = new Map<string, string>([['algoToken', 'tok']]);
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) },
  location: { protocol: 'http:', host: 'x', search: '', href: 'http://x/' },
  history: { replaceState() {} },
  innerWidth: 1200,
  document: { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {} }), addEventListener() {}, querySelectorAll: () => [] },
  fetch: async (url: string) => {
    asked.push(url);
    if (down) throw new TypeError('Failed to fetch');
    return { status: 200, json: async () => answer(url) };
  },
});
const settle = (): Promise<void> => new Promise(r => setTimeout(r, 15));
const btn = (data: Record<string, string>): HTMLElement => ({ dataset: data }) as unknown as HTMLElement;
const MISS = 'could not reach the server';

function stage(): { app: HTMLElement & { innerHTML: string } } {
  return { app: { innerHTML: '', classList: { remove() {} } } as unknown as HTMLElement & { innerHTML: string } };
}

test('1240 §1 League: the bell\'s reload clears its miss, a refusal survives its reload, another season clears the line', async () => {
  const lg = await import('../league.ts');
  const { app } = stage();
  lg.initLeague({ app, rerender: () => {} });

  down = true;
  lg.openLeague();
  await settle();
  assert.ok(app.innerHTML.includes(MISS), 'the failed load is said');

  down = false;
  lg.refresh();   // the bell heard of a change: the page asks again
  await settle();
  assert.match(app.innerHTML, /November League/, 'positive control: the page loaded');
  assert.ok(!app.innerHTML.includes(MISS), 'and no longer says it could not');

  // a refusal the player caused is still true after the reload behind it
  lg.handleButton(btn({ btn: 'lg-join' }));
  await settle();
  assert.ok(asked.includes('/api/league'), 'reloaded after the action');
  assert.ok(app.innerHTML.includes('Sign-ups are closed.'), 'the refusal stays through the reload that follows it');

  // another season: the line was about the one on screen
  lg.handleButton(btn({ btn: 'lg-season', id: 's2' }));
  await settle();
  assert.match(app.innerHTML, /October League/, 'positive control: the other season is drawn');
  assert.ok(!app.innerHTML.includes('Sign-ups are closed.'), 'and the last season\'s refusal is gone');
});

test('1240 §2 Weekly challenge: a reload that works clears its miss', async () => {
  const ch = await import('../challenge.ts');
  const { app } = stage();
  ch.initChallenge({ app, rerender: () => {} });

  down = true;
  ch.openChallenge();
  await settle();
  assert.ok(app.innerHTML.includes(MISS), 'the failed load is said');

  down = false;
  ch.refresh();
  await settle();
  assert.match(app.innerHTML, /Burn it down/, 'positive control: the page loaded');
  assert.ok(!app.innerHTML.includes(MISS), 'and no longer says it could not');
});

test('1240 §3 Metagame: the deck list\'s re-sort and the card ladder clear their miss', async () => {
  const meta = await import('../meta.ts');
  const { app } = stage();
  meta.initMeta({ app, rerender: () => {} });

  down = true;
  meta.openMeta();
  await settle();
  assert.ok(app.innerHTML.includes(MISS), 'the deck list\'s failed load is said');
  down = false;
  meta.handleButton(btn({ btn: 'meta-sort', sort: 'games' }));
  await settle();
  assert.ok(asked.some(u => u.startsWith('/api/deck/meta?sort=games')), 'positive control: the re-sort asked again');
  assert.ok(!app.innerHTML.includes(MISS), 'and the list no longer says it could not load');

  down = true;
  meta.openLadder();
  await settle();
  assert.ok(app.innerHTML.includes(MISS), 'the card ladder\'s failed load is said');
  down = false;
  meta.openLadder();
  await settle();
  assert.ok(!app.innerHTML.includes(MISS), 'and a ladder that loads does not say it');
});

test('1240 §4 census: each page\'s load failure goes through missed(), its success through loaded()', () => {
  for (const [f, loads] of [['league.ts', 1], ['challenge.ts', 1], ['meta.ts', 2]] as const) {
    const src = readFileSync(join(UI_DIR, f), 'utf8');
    assert.match(src, /const missed = \(text: string\): void => \{ say\(text, 'error'\); loadMissed = true; \};/, `${f} has missed()`);
    assert.match(src, /const say = \(text: string, tone: StatusTone\): void => \{ msg = text; msgTone = tone; loadMissed = false; \};/,
      `${f}: anything else said is not a load's miss`);
    const loadedCalls = src.match(/\bloaded\(\);/g) ?? [];
    assert.equal(loadedCalls.length, loads, `${f}: ${loads} load(s) clear their miss on success`);
    assert.doesNotMatch(src, /loading = false; say\(|say\('could not load/,
      `${f}: no load failure said around missed()`);
  }
});
