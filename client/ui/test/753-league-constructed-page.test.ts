/**
 * 753 — THE LEAGUE PAGE AND BANNER FOR A CONSTRUCTED SEASON, BESIDE THE OLD
 * SEASON'S FINAL.
 *
 * The owner, 2026-11-01: November is "casual constructed" — bring any deck,
 * change it every game if you like — and its sign-up week is October's final
 * week. So for seven days the home page and the League page show two seasons:
 * the current one (November) in full, and October on one line with the
 * finalist's Play button.
 *
 *   §1  ⭐ a constructed season says "casual constructed … any deck … every
 *       game" on the banner, the page and the Discord post; a draft one still
 *       says "live draft"; neither mentions December
 *   §2  ⭐ the other live season is on the banner and the page, with the
 *       finalist's Play, which opens THAT season's match as a draft room; a
 *       November Play goes in as constructed
 *   §3  the organizer's form offers the format and sends it
 *
 * Drives ui/league.ts itself, as 482 does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

interface Call { method: string; url: string; body: Record<string, unknown> | null }

const phases = (open: string, start: string) => {
  const t0 = Date.parse(start), W = 7 * 864e5;
  return [{ phase: 0, label: 'Sign-up week', at: open }, ...[1, 2, 3].map(k => ({ phase: k, label: `Week ${k} of 3`, at: new Date(t0 + (k - 1) * W).toISOString() })),
    { phase: 4, label: 'The final', at: new Date(t0 + 3 * W).toISOString() }, { phase: 5, label: 'Finished', at: new Date(t0 + 4 * W).toISOString() }];
};
const NOV = {
  id: '2026-11', name: 'November 2026 League', format: 'constructed', phase: 0, label: 'Sign-up week', weeks: 3, perWeek: 3, lateUntil: 2,
  signupOpens: '2026-11-01T15:00:00Z', start: '2026-11-08T07:00:00Z', auto: true, hold: false, hidden: false,
  phases: phases('2026-11-01T15:00:00Z', '2026-11-08T07:00:00Z'),
  entrants: [{ id: 'me', name: 'Me', joinedPhase: 0, withdrawn: false, skips: [] }], standings: [], champion: null,
  matches: [{ id: '2026-11-w0-1', week: 0, final: false, a: { id: 'me', name: 'Me' }, b: { id: 'cy', name: 'Cy' }, result: null, room: null }],
  me: { entered: true, withdrawn: false, skips: [], joinProblem: null, contact: 'me', suggestions: [], week0Cap: 3,
    matches: [{ id: '2026-11-w0-1', week: 0, final: false, opponent: { id: 'cy', name: 'Cy' }, windows: [], result: null,
      won: null, playable: true, time: null }] },
};
const OCT = {
  id: '2026-10', name: 'October 2026', phase: 4, label: 'The final', weeks: 3, perWeek: 3, lateUntil: 2,
  signupOpens: '2026-10-04T10:17:00Z', start: '2026-10-11T07:00:00Z', auto: true, hold: false, hidden: false,
  phases: phases('2026-10-04T10:17:00Z', '2026-10-11T07:00:00Z'),
  entrants: [], standings: [{ id: 'me', name: 'Me', w: 6, l: 1, unplayed: 0, points: 18, omw: 0.5, rank: 1 }], champion: null,
  matches: [{ id: '2026-10-final', week: 4, final: true, a: { id: 'me', name: 'Me' }, b: { id: 'bo', name: 'Bo' }, result: null, room: null }],
  me: { entered: true, withdrawn: false, skips: [], joinProblem: null, contact: 'me', suggestions: [], week0Cap: 3,
    matches: [{ id: '2026-10-final', week: 4, final: true, opponent: { id: 'bo', name: 'Bo' }, windows: [], result: null,
      won: null, playable: true, time: null }] },
};
const NOT_FINALIST = { ...OCT, me: { ...OCT.me, matches: [] },
  matches: [{ id: '2026-10-final', week: 4, final: true, a: { id: 'an', name: 'Ann' }, b: { id: 'bo', name: 'Bo' }, result: null, room: null }] };

let fresh = 0;
async function rig(opts: { season?: unknown; others?: unknown[]; organizer?: boolean } = {}) {
  const store = new Map<string, string>([['algoToken', 'tok']]);
  const g = globalThis as Record<string, unknown>;
  g['localStorage'] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) };
  g['location'] = { search: '', href: 'http://x/', origin: 'https://algomancy.online' };
  g['history'] = { replaceState() {} };
  g['innerWidth'] = 1200;
  const fields: Record<string, { value: string; checked?: boolean }> = {};
  g['document'] = { getElementById: (id: string) => fields[id] ?? null, createElement: () => ({ style: {} }), addEventListener() {}, querySelector: () => null };
  const calls: Call[] = [];
  const season = opts.season ?? NOV;
  const others = opts.others ?? [OCT];
  g['fetch'] = async (url: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ method: init?.method ?? 'GET', url, body });
    if (url.startsWith('/api/league/play')) {
      const mode = body?.['season'] === '2026-11' ? 'constructed' : 'draft';
      return { status: 200, json: async () => ({ ok: true, room: 'ROOM9', seat: 1, mode }) };
    }
    if (url.startsWith('/api/league/admin/')) return { status: 200, json: async () => ({ ok: true, id: '2026-11' }) };
    const want = /[?&]season=([^&]+)/.exec(url)?.[1];
    const s = want === '2026-10' ? OCT : season;
    return { status: 200, json: async () => ({ ok: true, signedIn: true, season: s, others: want === '2026-10' ? [NOV] : others,
      seasons: [{ id: '2026-10', name: 'October 2026', format: 'draft', phase: 4, weeks: 3, hidden: false },
        { id: '2026-11', name: 'November 2026 League', format: 'constructed', phase: 0, weeks: 3, hidden: false }],
      organizer: opts.organizer ?? false, minHours: 4, contact: 'me', availability: null }) };
  };
  const lg = await import(`../league.ts?c753=${++fresh}`) as typeof import('../league.ts');
  const app = { innerHTML: '', classList: { remove() {} } };
  lg.initLeague({ app: app as unknown as HTMLElement, rerender: () => {} });
  lg.homeBannerHtml();
  await settle();
  return { lg, calls, app, fields };
}
const settle = (): Promise<void> => new Promise(r => setTimeout(r, 15));
const loc = (): string => (globalThis as unknown as { location: { search: string } }).location.search;
function buttons(html: string): Record<string, string>[] {
  return [...html.matchAll(/<button\b([^>]*)>/g)].map(([, attrs]) => {
    const d: Record<string, string> = {};
    for (const [, k, v] of attrs!.matchAll(/data-([a-z]+)="([^"]*)"/g)) d[k!] = v!;
    return d;
  }).filter(d => d['btn']?.startsWith('lg-'));
}
const press = (lg: typeof import('../league.ts'), dataset: Record<string, string>): boolean =>
  lg.handleButton({ dataset } as unknown as HTMLElement);
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('753 §1 ⭐ a constructed season says casual constructed — banner, page, Discord post', async () => {
  const r = await rig();
  assert.match(text(r.lg.homeBannerHtml()), /November 2026 League Constructed · Sign-up week/, '⭐ the banner head says it, even folded');
  press(r.lg, { btn: 'lg-how' });   // an entrant's "How it works" starts folded
  const banner = text(r.lg.homeBannerHtml());
  assert.match(banner, /Casual constructed: bring any deck, and change it every game if you like/, '⭐ and How it works says what that means');
  assert.doesNotMatch(banner.split('October 2026')[0]!, /live draft/i, 'and not that it is a draft');
  press(r.lg, { btn: 'lg-open' });
  await settle();
  const page = text(r.app.innerHTML);
  assert.match(page, /A month of casual constructed/, '⭐ the page subtitle says it');
  assert.match(page, /bring any deck, and change it every game/, 'the season card says it');
  assert.doesNotMatch(page, /December|competitive/i, 'the page does not mention December');
  const post = r.lg.postText(NOV as never, 'https://algomancy.online');
  assert.match(post, /Casual constructed: bring any deck/, 'the Discord post says it');
  assert.doesNotMatch(post, /December|live draft/i);
  // and the October season reads as it always did
  const octPost = r.lg.postText({ ...OCT, phase: 0 } as never, 'https://algomancy.online');
  assert.doesNotMatch(octPost, /constructed/i, 'a draft season’s post is unchanged');
  const d = await rig({ season: { ...OCT, phase: 1, label: 'Week 1 of 3', format: undefined, me: { ...OCT.me, matches: [] } }, others: [] });
  d.lg.handleButton({ dataset: { btn: 'lg-how' } } as unknown as HTMLElement);
  assert.match(text(d.lg.homeBannerHtml()), /one live draft with random elements/, 'a season with no format is a draft');
});

test('753 §2 ⭐ October’s final sits beside November, and each Play goes in its own format', async () => {
  const r = await rig();
  const html = r.lg.homeBannerHtml();
  assert.match(text(html), /October 2026 The final/, '⭐ the other live season is on the home page');
  const plays = buttons(html).filter(b => b['btn'] === 'lg-play');
  const fin = plays.find(b => b['season'] === '2026-10');
  assert.ok(fin, '⭐ with the finalist’s Play for the October final');
  assert.equal(fin['match'], '2026-10-final');
  r.calls.length = 0;
  press(r.lg, fin);
  await settle();
  assert.deepEqual(r.calls.filter(c => c.method === 'POST').map(c => c.body), [{ season: '2026-10', match: '2026-10-final' }]);
  assert.equal(loc(), '?ws=1&room=ROOM9&seat=1&mode=draft', 'the final is a draft room');

  const r2 = await rig();
  press(r2.lg, { btn: 'lg-open' });
  await settle();
  const nov = buttons(r2.app.innerHTML).find(b => b['btn'] === 'lg-play' && b['season'] === '2026-11');
  assert.ok(nov, 'November’s own Play is on the page');
  assert.ok(buttons(r2.app.innerHTML).some(b => b['btn'] === 'lg-play' && b['season'] === '2026-10'),
    '⭐ and so is October’s, on the page as well');
  press(r2.lg, nov);
  await settle();
  assert.equal(loc(), '?ws=1&room=ROOM9&seat=1&mode=constructed', '⭐ a November Play goes in as constructed');

  // a non-finalist sees the final as a line, and a way to its page
  const r3 = await rig({ others: [NOT_FINALIST] });
  const h3 = r3.lg.homeBannerHtml();
  assert.match(text(h3), /Ann vs Bo/, 'the final, named');
  assert.ok(!buttons(h3).some(b => b['btn'] === 'lg-play' && b['season'] === '2026-10'), 'no Play for somebody not in it');
  const open = buttons(h3).find(b => b['btn'] === 'lg-open' && b['season'] === '2026-10');
  assert.ok(open, 'a button to the October page');
  r3.calls.length = 0;
  press(r3.lg, open);
  await settle();
  assert.equal(r3.lg.screen(), 'league');
  assert.ok(r3.calls.some(c => c.url === '/api/league?season=2026-10'), 'which opens October, not the current season');
});

test('753 §3 the organizer chooses the format when creating a season', async () => {
  const r = await rig({ organizer: true });
  press(r.lg, { btn: 'lg-open' });
  await settle();
  assert.match(r.app.innerHTML, /id="lg-new-format"/, 'the form has a format');
  assert.match(r.app.innerHTML, /<option value="constructed">/);
  assert.match(text(r.app.innerHTML), /November 2026 League \(casual constructed\) is at/, 'the panel says which format this one is');
  Object.assign(r.fields, {
    'lg-new-id': { value: '2026-11' }, 'lg-new-name': { value: 'November 2026 League' },
    'lg-new-open': { value: '2026-11-01T10:00' }, 'lg-new-start': { value: '2026-11-08T07:00' },
    'lg-new-weeks': { value: '3' }, 'lg-new-per': { value: '3' }, 'lg-new-format': { value: 'constructed' },
    'lg-new-auto': { value: '', checked: true }, 'lg-new-hidden': { value: '', checked: false },
  });
  r.calls.length = 0;
  press(r.lg, { btn: 'lg-create' });
  await settle();
  const create = r.calls.find(c => c.url === '/api/league/admin/create');
  assert.equal(create?.body?.['format'], 'constructed', '⭐ the chosen format is sent');
});
