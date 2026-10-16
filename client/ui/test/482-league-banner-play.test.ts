/**
 * CT-300 — the home banner's league Play button, pressed by somebody who never
 * opened the League page.
 *
 * The banner is drawn from the home page's own copy of the league (`hint`),
 * but Play read the League page's copy (`data`), which exists only once that
 * page has been opened. So from a fresh home page Play sent nothing and said
 * nothing; it worked only after a visit to the League page and back, and even
 * then it sent whichever season that page last showed. Since launch.
 *
 * These tests drive ui/league.ts itself (no fake DOM reaches the rest of the
 * client): the home page draws the banner, the test presses the buttons the
 * banner actually drew, with the attributes it drew them with, and watches
 * the requests, the navigation and the page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

interface Call { method: string; url: string; body: Record<string, unknown> | null }
interface Rig {
  lg: typeof import('../league.ts');
  calls: Call[];
  app: { innerHTML: string };
  rerenders: () => number;
}

const SEASONS: Record<string, unknown> = {};
function season(id: string, name: string, phase: number, me: unknown): unknown {
  return {
    id, name, phase, weeks: 3, perWeek: 3, lateUntil: 2, label: phase === 0 ? 'Sign-up week' : `Week ${phase} of 3`,
    signupOpens: '2026-10-04T07:00:00Z', start: '2026-10-11T07:00:00Z', auto: true, hold: false, hidden: false,
    phases: [{ phase: 0, label: 'Sign-up week', at: '2026-10-04T07:00:00Z' }, { phase: 1, label: 'Week 1 of 3', at: '2026-10-11T07:00:00Z' }],
    entrants: [], standings: [], matches: [], champion: null, me,
  };
}
const entered = (phase: number): unknown => ({
  entered: true, withdrawn: false, skips: [], joinProblem: null, contact: 'me', suggestions: [], week0Cap: 3,
  matches: [{ id: 'm1', week: phase, final: false, opponent: { id: 'b', name: 'Bob', contact: 'bob#1' },
    windows: [], result: null, won: null, playable: true }],
});
SEASONS['oct26'] = season('oct26', 'October 2026 League', 1, entered(1));
SEASONS['sep26'] = season('sep26', 'September 2026 League', 1,
  { ...(entered(1) as object), matches: [{ id: 'old1', week: 1, final: false, opponent: { id: 'c', name: 'Cy' },
    windows: [], result: null, won: null, playable: true }] });
const SEASON_LIST = [{ id: 'oct26', name: 'October 2026 League', phase: 1, weeks: 3, hidden: false },
  { id: 'sep26', name: 'September 2026 League', phase: 1, weeks: 3, hidden: false }];

let fresh = 0;
/** a home page that has never shown the League page: a fresh copy of the module */
async function rig(opts: { current?: unknown; play?: Record<string, unknown> } = {}): Promise<Rig> {
  const store = new Map<string, string>([['algoToken', 'tok']]);
  const g = globalThis as Record<string, unknown>;
  g['localStorage'] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) };
  g['location'] = { search: '', href: 'http://x/' };
  g['history'] = { replaceState() {} };
  g['innerWidth'] = 1200;
  g['document'] = { getElementById: () => null, createElement: () => ({ style: {} }), addEventListener() {} };
  const calls: Call[] = [];
  const current = opts.current ?? SEASONS['oct26'];
  g['fetch'] = async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(init.body) as Record<string, unknown> : null });
    if (url.startsWith('/api/league/play')) {
      return { status: 200, json: async () => opts.play ?? { ok: true, room: 'ROOM1', seat: 0 } };
    }
    const want = /[?&]season=([^&]+)/.exec(url)?.[1];
    const s = want ? SEASONS[decodeURIComponent(want)] : current;
    return { status: 200, json: async () => ({ ok: true, signedIn: true, seasons: SEASON_LIST, season: s,
      organizer: false, minHours: 4, contact: 'me', availability: null }) };
  };
  const lg = await import(`../league.ts?fresh=${++fresh}`) as typeof import('../league.ts');
  const app = { innerHTML: '', classList: { remove() {} } };
  let n = 0;
  lg.initLeague({ app: app as unknown as HTMLElement, rerender: () => { n++; } });
  lg.homeBannerHtml();          // the home page draws: the banner asks for its season
  await settle();
  return { lg, calls, app, rerenders: () => n };
}
const settle = (): Promise<void> => new Promise(r => setTimeout(r, 15));

/** every lg-* button in some html, as the element the click handler is given */
function buttons(html: string): { btn: string; dataset: Record<string, string> }[] {
  return [...html.matchAll(/<button\b([^>]*)>/g)].flatMap(([, attrs]) => {
    const dataset: Record<string, string> = {};
    for (const [, k, v] of attrs!.matchAll(/data-([a-z]+)="([^"]*)"/g)) dataset[k!] = v!;
    return dataset['btn']?.startsWith('lg-') ? [{ btn: dataset['btn'], dataset }] : [];
  });
}
const press = (r: Rig, dataset: Record<string, string>): boolean =>
  r.lg.handleButton({ dataset } as unknown as HTMLElement);

test('CT-300 the banner Play works on a home page that never opened the League page', async () => {
  const r = await rig();
  const play = buttons(r.lg.homeBannerHtml()).find(b => b.btn === 'lg-play');
  assert.ok(play, 'an entrant with an open match this week sees Play on the banner');
  assert.equal(play.dataset['season'], 'oct26', 'the button says which season it plays');
  r.calls.length = 0;
  assert.equal(press(r, play.dataset), true);
  await settle();
  const posts = r.calls.filter(c => c.method === 'POST');
  assert.deepEqual(posts.map(c => [c.url, c.body]), [['/api/league/play', { season: 'oct26', match: 'm1' }]],
    'pressing Play asks the server to open that match');
  assert.equal((globalThis as unknown as { location: { search: string } }).location.search,
    '?ws=1&room=ROOM1&seat=0&mode=draft', 'and goes into the match room');
});

test('CT-300 the banner Play sends the banner season after the League page showed another', async () => {
  const r = await rig();
  press(r, { btn: 'lg-open' });
  await settle();
  press(r, { btn: 'lg-season', id: 'sep26' });   // look at last month, then go home
  await settle();
  assert.match(r.app.innerHTML, /September 2026 League/, 'the League page showed the old season');
  press(r, { btn: 'lg-close' });
  const play = buttons(r.lg.homeBannerHtml()).find(b => b.btn === 'lg-play');
  assert.ok(play, 'the banner still shows this month and its Play');
  r.calls.length = 0;
  press(r, play.dataset);
  await settle();
  assert.deepEqual(r.calls.filter(c => c.method === 'POST').map(c => c.body), [{ season: 'oct26', match: 'm1' }],
    'the banner match is in the current season, whatever the League page last showed');
});

test('CT-300 a refused banner Play opens the League page saying why', async () => {
  const r = await rig({ play: { ok: false, error: 'that match is not open yet' } });
  const play = buttons(r.lg.homeBannerHtml()).find(b => b.btn === 'lg-play')!;
  assert.equal(r.lg.screen(), null, 'on the home page');
  press(r, play.dataset);
  await settle();
  assert.equal(r.lg.screen(), 'league', 'the refusal takes the player to the League page');
  assert.match(r.app.innerHTML, /that match is not open yet/, 'which shows the server reason');
  assert.equal((globalThis as unknown as { location: { search: string } }).location.search, '', 'and goes nowhere else');
});

test('CT-300 every lg button the home banner can draw does something a player can see', async () => {
  const states: [string, unknown][] = [
    ['week 1, entered', SEASONS['oct26']],
    ['sign-up week, entered', season('oct26', 'October 2026 League', 0, entered(0))],
    ['sign-up week, not entered', season('oct26', 'October 2026 League', 0, { entered: false, withdrawn: false, skips: [],
      joinProblem: null, contact: 'me', suggestions: [], week0Cap: 3, matches: [] })],
  ];
  const seen = new Set<string>();
  for (const [what, current] of states) {
    for (const folded of [false, true]) {
      const probe = await rig({ current });
      if (folded) press(probe, { btn: 'lg-banner' });
      for (const { btn, dataset } of buttons(probe.lg.homeBannerHtml())) {
        seen.add(btn);
        const r = await rig({ current });   // each press on a fresh home page
        if (folded) press(r, { btn: 'lg-banner' });
        const before = r.lg.homeBannerHtml();
        const rerenders = r.rerenders();
        r.calls.length = 0;
        assert.equal(press(r, dataset), true, `${what}: ${btn} is handled`);
        await settle();
        const visible = r.calls.length > 0 || r.lg.screen() !== null
          || (r.rerenders() > rerenders && r.lg.homeBannerHtml() !== before)
          || (globalThis as unknown as { location: { search: string } }).location.search !== '';
        assert.ok(visible, `${what}${folded ? ' (folded)' : ''}: pressing ${btn} ${JSON.stringify(dataset)} changed nothing`);
      }
    }
  }
  for (const b of ['lg-play', 'lg-open', 'lg-banner', 'lg-how']) {
    assert.ok(seen.has(b), `the states above draw ${b}, or this test is not measuring it`);
  }
});
