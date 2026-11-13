/**
 * 1241 — THE LEAGUE AND CHALLENGE PAGES PAINT THEMSELVES (BL-63, line 8: the
 * design-system round's last TODO(ds) splits, 2026-11-13).
 *
 * The league page's paint() and its wiring (the availability grid, the time
 * zone and contact boxes, the time code's time) left ui/league.ts for
 * pages/league.ts paintLeague, which writes the controller's state only
 * through the LeagueHooks it is lent. The challenge page's paint() became
 * pages/challenge.ts paintChallengePage; whether to paint at all (never under
 * the tabletop) stays in ui/challenge.ts.
 *
 *   §1  the source split: the controllers hold no DOM wiring and no paintFrame,
 *       the pages import nothing from them but types
 *   §2  ⭐ through the real controller: a new time zone, a contact typed and a
 *       grid cell painted all reach the Save request, the Save button wakes,
 *       and the painted cell is the grid's tabbable one after a repaint — the
 *       hooks write the state the controller saves and draws
 *   §3  a contact typed does not repaint (the caret would be lost), and the
 *       Save button is woken in place
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');

test('1241 §1 the controllers hold no painting or wiring; the pages import only types from them', () => {
  const lg = read('../league.ts'), lgPage = read('../pages/league.ts');
  const ch = read('../challenge.ts'), chPage = read('../pages/challenge.ts');
  assert.match(lgPage, /export function paintLeague\(app: HTMLElement, v: LeagueView, h: LeagueHooks\): void \{/);
  assert.match(lgPage, /function wireGrid\(/);
  assert.match(lgPage, /function wireStamp\(/);
  for (const gone of ['paintFrame', 'function wireGrid', 'function wireStamp', 'onpointerdown', 'onchange', 'oninput', "getElementById('lg-grid')"]) {
    assert.ok(!lg.includes(gone), `ui/league.ts still has ${gone}`);
  }
  assert.match(lg, /paintLeague\(\$app, leagueView\(\{/);
  assert.match(chPage, /export function paintChallengePage\(app: HTMLElement, v: ChallengePageView\): void \{/);
  assert.ok(!ch.includes('paintFrame'), 'ui/challenge.ts paints through the page');
  assert.match(ch, /if \(tt\.screen\(\)\) return;\n\s*paintChallengePage\(\$app, challengePageView\(\{/, 'never under the tabletop');
  for (const [name, page] of [['league', lgPage], ['challenge', chPage]] as const) {
    assert.doesNotMatch(page, new RegExp(`^import (?!type )[^;]*from '\\.\\./${name}\\.ts'`, 'm'), `pages/${name}.ts imports ui/${name}.ts only as types`);
  }
  for (const page of [lgPage, chPage]) assert.ok(!page.includes('TODO(ds)'), 'the TODO(ds) is done');
});

// ── a fake page: the league's availability tab, its boxes and its grid ──

const TZ = 'America/New_York';
let fresh = 0;

interface Cell { dataset: Record<string, string>; tabIndex: number; on: boolean; selected: string; classList: { toggle: (c: string, v: boolean) => void }; setAttribute: (k: string, v: string) => void; closest: () => Cell; focus: () => void }

async function rig() {
  const store = new Map<string, string>([['algoToken', 'tok']]);
  const g = globalThis as Record<string, unknown>;
  g['localStorage'] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) };
  g['location'] = { search: '', href: 'http://x/', origin: 'https://algomancy.online' };
  g['history'] = { replaceState() {} };
  g['innerWidth'] = 1200;
  const tz = { value: TZ, onchange: null as null | (() => void) };
  const contact = { value: '', oninput: null as null | (() => void) };
  const hours = { textContent: '', classList: { toggle() {} } };
  const save = { disabled: true, textContent: 'Saved' };
  const cell = (i: number): Cell => {
    const c: Cell = {
      dataset: { i: String(i), c: '1', h: '19' }, tabIndex: -1, on: false, selected: 'false',
      classList: { toggle: (_k, v) => { c.on = v; } }, setAttribute: (_k, v) => { c.selected = v; },
      closest: () => c, focus() {},
    };
    return c;
  };
  const grid = {
    onpointerdown: null as null | ((e: unknown) => void), onpointerup: null as null | (() => void),
    querySelectorAll: () => [], querySelector: () => null, setPointerCapture() {}, contains: () => true,
  } as Record<string, unknown>;
  let byId: Record<string, unknown> = {};
  g['document'] = {
    getElementById: (id: string) => byId[id] ?? null,
    createElement: () => ({ style: {} }), addEventListener() {},
    querySelector: (s: string) => (s === '[data-btn="lg-grid-save"]' ? save : null),
  };
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  g['fetch'] = async (path: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') { posts.push({ path, body: JSON.parse(init.body ?? '{}') }); return { status: 200, json: async () => ({ ok: true }) }; }
    return { status: 200, json: async () => ({ ok: true, signedIn: true, season: null, others: [], seasons: [], organizer: false, minHours: 4,
      contact: null, availability: { tz: TZ, grid: '0'.repeat(168) } }) };
  };
  const lg = await import(`../league.ts?c1241=${++fresh}`) as typeof import('../league.ts');
  let paints = 0;
  const app = { classList: { remove() {} } } as Record<string, unknown>;
  let html = '';
  Object.defineProperty(app, 'innerHTML', { get: () => html, set: (v: string) => { html = v; paints++; } });
  lg.initLeague({ app: app as unknown as HTMLElement, rerender: () => {} });
  byId = { 'lg-tz': tz, 'lg-contact': contact, 'lg-grid': grid, 'lg-hours': hours };
  lg.handleButton({ dataset: { btn: 'lg-open' } } as unknown as HTMLElement);
  await settle();
  lg.handleButton({ dataset: { btn: 'lg-section', v: 'avail' } } as unknown as HTMLElement);
  return { lg, app, tz, contact, save, grid, cell, posts, paints: () => paints };
}
const settle = (): Promise<void> => new Promise(r => setTimeout(r, 15));

test('1241 §2 ⭐ the moved wiring writes the state the controller saves and draws', async () => {
  const r = await rig();
  assert.match(r.app['innerHTML'] as string, /id="lg-grid"/, 'positive control: the availability tab is drawn');
  assert.equal(typeof r.tz.onchange, 'function', 'the time zone box is wired');

  // a mouse paints cell 30
  const c30 = r.cell(30);
  (r.grid['onpointerdown'] as (e: unknown) => void)({ pointerType: 'mouse', target: c30, preventDefault() {}, pointerId: 1 });
  (r.grid['onpointerup'] as () => void)();
  assert.equal(c30.on, true, 'the cell is drawn on in place');
  assert.equal(c30.selected, 'true');
  assert.equal(r.save.disabled, false, 'Save wakes');

  // a new zone repaints: the box shows it, Save stays awake, cell 30 is the tabbable one
  r.tz.value = 'Europe/Paris';
  r.tz.onchange!();
  const html = r.app['innerHTML'] as string;
  assert.match(html, /id="lg-tz"[^>]*value="Europe\/Paris"/, '⭐ the zone reached the draft the page draws');
  assert.match(html, /data-btn="lg-grid-save" >Save</, '⭐ dirty reached the controller: Save, not Saved');
  assert.match(html, /tabindex="0" data-i="30"/, '⭐ the painted cell is the grid\'s focus cell after a repaint');
  assert.match(html, /tabindex="-1" data-i="31"/);

  r.contact.value = 'ben#1';
  r.contact.oninput!();
  r.lg.handleButton({ dataset: { btn: 'lg-grid-save' } } as unknown as HTMLElement);
  await settle();
  const sent = r.posts.find(p => p.path === '/api/league/availability');
  assert.ok(sent, 'Save posted');
  assert.equal(sent.body['tz'], 'Europe/Paris', '⭐ the zone');
  assert.equal(sent.body['contact'], 'ben#1', '⭐ the contact');
  assert.equal((sent.body['grid'] as string)[30], '1', '⭐ the painted cell');
  assert.equal((sent.body['grid'] as string).replace(/0/g, '').length, 1, 'and no other');
});

test('1241 §3 typing a contact does not repaint; it wakes Save in place', async () => {
  const r = await rig();
  const before = r.paints();
  r.contact.value = 'someone';
  r.contact.oninput!();
  assert.equal(r.paints(), before, 'no repaint under the caret');
  assert.equal(r.save.disabled, false);
  assert.equal(r.save.textContent, 'Save');
});
