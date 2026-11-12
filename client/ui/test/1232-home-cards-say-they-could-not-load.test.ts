/* 1232 — THE HOME'S LEAGUE AND CHALLENGE CARDS SAY WHEN THEY COULD NOT LOAD
 * (BL-10, docs/23-ui-inventory/01 §4 S16: "The league and challenge fetch
 * failures render nothing at all").
 *
 * league.ts and challenge.ts ask the server once per sign-in for the home's
 * League and Challenge cards (askHint). A failed ask was swallowed — and worse
 * than nothing, the card then read "No league running right now." / "No
 * challenge this week.", a guess written as a fact, and never asked again
 * until the player signed in or out. Now a miss is remembered: the card says
 * it could not load, the next home draw 15s on asks again, and the first
 * answer puts the card back.
 *
 * §1 the drawing: the cards' empty line says it could not load
 * §2 league.ts through a fake fetch: miss → no re-ask at once → re-ask later → answer
 * §3 challenge.ts, the same
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/* ── the globals the modules read at import ──────────────────────────── */

type Reply = 'ok' | 'down' | 'not-json';
const replies: Record<string, Reply> = { '/api/league': 'down', '/api/challenge': 'down' };
const asked: string[] = [];
const store = new Map<string, string>();
let now = 1_800_000_000_000;
const realNow = Date.now;
Date.now = () => now;
const SEASON = {
  id: 's1', name: 'November League', format: 'draft', phase: 0, label: 'Sign-ups', weeks: 4, perWeek: 1, lateUntil: 1,
  signupOpens: '2026-11-01T00:00:00Z', start: '2026-11-15T00:00:00Z',
  phases: [{ phase: 0, label: 'Sign-ups', at: '2026-11-01T00:00:00Z' }, { phase: 1, label: 'Week 1', at: '2026-11-15T00:00:00Z' }],
  auto: true, hold: false, hidden: false, entrants: [], standings: [], matches: [], champion: null, me: null,
};
const answer = (url: string): unknown => url === '/api/league'
  ? { ok: true, season: SEASON, others: [], seasons: [], signedIn: false, availability: null, contact: '', minHours: 2, organizer: false }
  : { now, current: { id: 'w1', title: 'Burn it down', goal: { kind: 'win' }, opens: now - 1000, closes: now + 86_400_000, entrants: 4 }, past: [], mine: {} };
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  location: { protocol: 'http:', host: 'x', search: '', href: 'http://x/' },
  fetch: async (url: string) => {
    asked.push(url);
    const r = replies[url];
    assert.ok(r, `an unexpected request: ${url}`);
    if (r === 'down') throw new TypeError('Failed to fetch');
    return { json: async () => {
      if (r === 'not-json') throw new SyntaxError('Unexpected token < in JSON');   // Caddy's 502 page
      return answer(url);
    } };
  },
});
const settle = (): Promise<void> => new Promise(r => setImmediate(r));
const count = (url: string): number => asked.filter(u => u === url).length;

test('1232 §1 the League and Challenge cards say they could not load, not that nothing is running', async () => {
  const home = await import('../pages/home.ts');
  const stories = await import('../../storybook/stories/pages/home.stories.ts');
  const missed = stories.SidesNotAnswering.render();
  assert.ok(missed.includes(home.LEAGUE_MISSED), 'the League card says it could not load');
  assert.ok(missed.includes(home.CHALLENGE_MISSED), 'the Challenge card says it could not load');
  assert.doesNotMatch(missed, /No league running|No challenge this week/, 'and does not claim there is none');
  // positive control: answered with nothing, the cards say there is nothing
  const none = stories.NothingRunning.render();
  assert.match(none, /No league running right now\./);
  assert.match(none, /No challenge this week\./);
  assert.doesNotMatch(none, /Could not load/);
});

for (const [n, mod, url, glance] of [
  ['§2', '../league.ts', '/api/league', /November League/],
  ['§3', '../challenge.ts', '/api/challenge', /Burn it down/],
] as const) {
  test(`1232 ${n} ${url}: a miss is said, asked again later, and an answer brings the card back`, async () => {
    const m = await import(mod) as {
      hintUnreachable: () => boolean; homeGlanceHtml: () => string; HINT_RETRY_MS: number;
    } & Record<string, (o: { app: HTMLElement; rerender: () => void }) => void>;
    let repaints = 0;
    (m['initLeague'] ?? m['initChallenge'])!({ app: {} as HTMLElement, rerender: () => { repaints++; } });

    replies[url] = 'down';
    assert.equal(m.hintUnreachable(), false, 'not before the ask has failed');
    await settle();
    assert.equal(count(url), 1);
    assert.equal(m.hintUnreachable(), true, 'the failed ask is remembered');
    assert.equal(repaints, 1, 'the flip repaints the home once');
    assert.equal(m.homeGlanceHtml(), '', 'nothing made up to show');

    // every home draw asks for it; a down server must not be asked on each one
    now += 1000;
    m.hintUnreachable(); m.homeGlanceHtml(); await settle();
    assert.equal(count(url), 1, 'no re-ask inside the retry window');

    now += m.HINT_RETRY_MS;
    replies[url] = 'not-json';
    m.hintUnreachable(); await settle();
    assert.equal(count(url), 2, 'asked again once the window is over');
    assert.equal(m.hintUnreachable(), true, 'a reply that is not an answer is a miss too');
    assert.equal(repaints, 1, 'staying down does not repaint again');

    now += m.HINT_RETRY_MS;
    replies[url] = 'ok';
    m.hintUnreachable(); await settle();
    assert.equal(count(url), 3);
    assert.equal(m.hintUnreachable(), false, 'the answer clears it');
    assert.equal(repaints, 2, 'and repaints the card back');
    assert.match(m.homeGlanceHtml(), glance, 'positive control: the answer is drawn');

    // answered: the home's draws ask no more
    now += m.HINT_RETRY_MS * 4;
    m.hintUnreachable(); m.homeGlanceHtml(); await settle();
    assert.equal(count(url), 3, 'an answered card is not asked again');
  });
}

test('1232 restore the clock', () => { Date.now = realNow; });
