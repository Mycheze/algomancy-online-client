/* The admin dashboard's Challenges tab (ui/admin.ts), page half. Owner,
 * 2026-10-24: "I'd like to be able to see the upcoming challenges in an
 * admin tab." The server half — the 404 to anybody but an admin — is
 * server/test/607-admin-challenges.test.ts.
 *
 * Driven as 503 drives the challenge page: a fresh copy of the module, a
 * fetch that answers as server/api-admin.ts does, and clicks on the buttons
 * the page actually drew.
 *
 * §1 the tab is there, asks /api/admin/challenges, and draws every row: its
 *    status (open now / upcoming with "opens in N days" / closed), title,
 *    the goal in the challenge page own words, the UTC window, seed, par, the
 *    reference run numbers and the board counts — and when the calendar runs out
 * §2 a reference run still being walked, or one that no longer verifies, says so
 * §3 a refused fetch draws no row at all
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalText, type ChallengeDef } from '../../engine/src/challenge.ts';

const NOW = Date.UTC(2026, 9, 28, 12);
const at7 = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d, 7);

const def = (id: string, week: string, title: string, n: number): ChallengeDef =>
  ({ id, week, title, blurb: `The ${title} blurb.`, goal: { kind: 'unitsPlayed', n }, seed: 600 + n, par: 10 * n });
const OPEN = def('wk-open', '2026-10-25', 'Open Week', 50);
const SOON = def('wk-soon', '2026-11-01', 'Soon Week', 60);
const OLD = def('wk-old', '2026-10-18', 'Old Week', 40);
const okRef = { state: 'ok', score: { unique: 9, extra: 1, cards: 10, elements: 2, turns: 7, raw: 140, skill: 100 }, actions: 321 };

function body(refs: { open?: unknown; soon?: unknown } = {}): unknown {
  return {
    ok: true, now: NOW, runsOutAt: at7(2026, 11, 8), weeksLeft: 2, upcoming: 1,
    rows: [
      { ...OPEN, opens: at7(2026, 10, 25), closes: at7(2026, 11, 1), status: 'open', ref: refs.open ?? okRef, runs: 7, players: 3 },
      { ...SOON, opens: at7(2026, 11, 1), closes: at7(2026, 11, 8), status: 'upcoming', opensInDays: 4, ref: refs.soon ?? okRef },
      { ...OLD, opens: at7(2026, 10, 18), closes: at7(2026, 10, 25), status: 'closed', ref: okRef, runs: 31, players: 12 },
    ],
  };
}

interface Rig { admin: typeof import('../admin.ts'); app: { innerHTML: string; className: string }; urls: string[] }

let fresh = 0;
async function rig(opts: { refused?: boolean; refs?: { open?: unknown; soon?: unknown } } = {}): Promise<Rig> {
  const store = new Map<string, string>([['algoToken', 'tok']]);
  const g = globalThis as Record<string, unknown>;
  g['localStorage'] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) };
  g['location'] = { search: '?admin=1', href: 'http://x/?admin=1' };
  g['history'] = { replaceState() {} };
  g['document'] = { getElementById: () => null, createElement: () => ({ style: {} }), addEventListener() {}, querySelectorAll: () => [] };
  const urls: string[] = [];
  g['fetch'] = async (url: string) => {
    urls.push(url);
    if (opts.refused) return { ok: false, status: 404, json: async () => ({}) };
    const reply = url === '/api/admin/challenges' ? body(opts.refs)
      : url === '/api/admin/overview' ? { ok: true, me: 'ops', admins: 1, accounts: 3, games: 0, rooms: 0, reports: { total: 0, unmarked: 0, real: 0, not: 0, live: 0, unfetched: 0 } }
        : { ok: true, reports: [] };
    return { ok: true, status: 200, json: async () => reply };
  };
  const admin = await import(`../admin.ts?fresh=${++fresh}`) as typeof import('../admin.ts');
  const app = { innerHTML: '', className: '' };
  admin.initAdmin({ app: app as unknown as HTMLElement, rerender: () => {} });
  await settle();
  return { admin, app, urls };
}
const settle = (): Promise<void> => new Promise(r => setTimeout(r, 15));

function button(html: string, want: Record<string, string>): HTMLElement {
  for (const m of html.matchAll(/<button\b([^>]*)>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[1]!.matchAll(/data-([a-z-]+)="([^"]*)"/g)) attrs[a[1]!] = a[2]!;
    if (Object.entries(want).every(([k, v]) => attrs[k] === v)) return { dataset: attrs } as unknown as HTMLElement;
  }
  assert.fail(`no button ${JSON.stringify(want)} on the page`);
}

async function openTab(r: Rig): Promise<string> {
  r.admin.handleButton(button(r.app.innerHTML, { btn: 'admin-tab', tab: 'challenges' }));
  await settle();
  return r.app.innerHTML;
}

/** the table row that names this challenge id */
const rowOf = (html: string, id: string): string =>
  [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map(m => m[0]).find(t => t.includes(id)) ?? assert.fail(`no row for ${id}`);

test('§1 the Challenges tab draws every calendar row, the upcoming one included', async () => {
  const r = await rig();
  assert.equal(r.admin.screen(), 'admin');
  const html = await openTab(r);
  assert.ok(r.urls.includes('/api/admin/challenges'), 'the tab asks the admin route');
  assert.match(html, /admintab on" data-btn="admin-tab" data-tab="challenges">Challenges</, 'the tab is drawn, and on');

  const ids = [...html.matchAll(/class="unk">(wk-[a-z]+)</g)].map(m => m[1]);
  assert.deepEqual(ids, ['wk-open', 'wk-soon', 'wk-old'], 'every row, in the order the server sent');

  const open = rowOf(html, 'wk-open'), soon = rowOf(html, 'wk-soon'), old = rowOf(html, 'wk-old');
  assert.match(open, /open now/);
  assert.match(soon, /upcoming<\/span> <span class="unk">opens in 4 days/);
  assert.match(old, /closed/);
  assert.match(old, /<tr class="dim">/, 'a closed week is dimmed');
  for (const [tr, d] of [[open, OPEN], [soon, SOON], [old, OLD]] as const) {
    assert.ok(tr.includes(`<b>${d.title}</b>`), `${d.id}: its title`);
    assert.ok(tr.includes(goalText(d.goal)), `${d.id}: the goal as the challenge page words it`);
    assert.ok(tr.includes(d.blurb), `${d.id}: its blurb`);
    assert.ok(tr.includes(`<td class="num">${d.seed}</td>`) && tr.includes(`<td class="num">${d.par}</td>`), `${d.id}: seed and par`);
    assert.match(tr, /7 turns · 10 cards · 2 elements/, `${d.id}: the reference run numbers`);
  }
  assert.match(soon, /Sun 1 Nov 2026 07:00 UTC<br>Sun 8 Nov 2026 07:00 UTC/, 'the window, in UTC');
  assert.match(open, /7 runs<br>3 players/, 'the open board counts');
  assert.match(old, /31 runs<br>12 players/);
  assert.match(soon, /<td class="num">—<\/td>/, 'an upcoming row has no board');
  assert.match(html, /The calendar runs out Sun 8 Nov 2026 07:00 UTC<\/b> — 2 weeks from now/, 'when new challenges are due');
});

test('§2 a reference run being walked, or one that no longer verifies, says so', async () => {
  const r = await rig({ refs: { open: { state: 'pending' }, soon: { state: 'failed', error: 'the goal was not met', at: 140 } } });
  const html = await openTab(r);
  assert.match(rowOf(html, 'wk-open'), /being walked/);
  assert.match(rowOf(html, 'wk-soon'), /no longer verifies<\/span> the goal was not met \(action 140\)/);
});

test('§3 a refused fetch draws no row at all', async () => {
  const r = await rig({ refused: true });
  assert.match(r.app.innerHTML, /not an admin/);
  assert.ok(!/wk-/.test(r.app.innerHTML), 'nothing about any challenge');
  assert.ok(!r.urls.includes('/api/admin/challenges'), 'and the calendar is never asked for');
});
