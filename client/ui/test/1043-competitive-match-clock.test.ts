/* 1043 — THE COMPETITIVE MATCH CLOCK IS A CHOICE (docs/22 §6.1; owner,
 * 2026-11-03: "Competitive constructed still needs the Clock setting. Yes,
 * the default will usually be used, but it's up to the players if they want to
 * override that").
 *
 * §1 Constructed → Competitive draws a Clock row of its own: Default (on at
 *    first) / Off / 45m / 60m, data-clockfor="competitive", "per player, for
 *    the whole match"
 * §2 its clicks write ITS key (algoMatchClockMs) and never the casual one —
 *    a casual Off is not an untimed match, and back
 * §3 Create match carries the choice on the creating link (`&clock=`), and
 *    nothing on Default (the server's match default decides); Default removes
 *    the key
 * §4 the key is a listed browser key (legal.ts BROWSER_KEYS)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
// a stored session: the Competitive tab draws its rows for a token (pages/match.ts
// competitiveCardView); /api/me is left unanswered, so the account stays resolving
g['__UI_DRIVER_STORE'] = { algoToken: 'a-token' };
g['__UI_DRIVER_FETCH'] = (url: string) => url === '/api/new'
  ? Promise.resolve({ ok: true, json: async () => ({ code: 'MTCH' }) })
  : new Promise(() => {});
const { home } = await import('./ui-driver.ts');
const mt = await import('../match.ts');
const { BROWSER_KEYS } = await import('../legal.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const onChip = (h: string, forWhat: string): string | null =>
  new RegExp(`class="ui-segmented__option on" data-btn="clockpick" type="button" data-value="([^"]+)"[^>]*data-clockfor="${forWhat}"`).exec(h)?.[1] ?? null;

/** cc-new, as the Play card's Create match sends it, with one legal deck; the link it opens */
async function createMatch(): Promise<string> {
  (g['location'] as { search: string }).search = '';
  const btn = { dataset: { btn: 'cc-new' } } as unknown as HTMLElement;
  assert.ok(mt.handleMatchButton(btn, {
    lobby: () => null, seat: () => 0, send: () => {}, register: () => {}, rerender: () => {},
    decks: () => [{ id: 'd1', name: 'Legal', error: null }] as never, fail: m => assert.fail(m),
  }));
  await flush();
  return String((g['location'] as { search: string }).search);
}

const cp = await import('../pages/clockpick.ts');
test('1043 §1 Competitive draws its own Clock row, Default on at first', () => {
  ui.click({ btn: 'home-mode', mode: 'constructed' });
  const html = ui.click({ btn: 'home-format', format: 'competitive' });
  assert.match(html, /data-btn="cc-bo"/, 'positive control: the Competitive rows, for a stored session');
  assert.equal((html.match(/data-btn="clockpick"[^>]*data-clockfor="competitive"/g) ?? []).length, 4, 'Default Off 45m 60m');
  assert.doesNotMatch(html, /data-clockfor="constructed"/, 'not the casual clock');
  assert.equal(onChip(html, 'competitive'), 'auto', 'first visit: Default');
  assert.deepEqual([...html.matchAll(/data-clockfor="competitive">([^<]+)</g)].map(m => m[1]), ['Default', 'Off', '45m', '60m']);
  assert.match(html, /45m per player, for the whole match/);
});

test('1043 §2 the match clock has its own key, apart from the casual clock', () => {
  localStorage.removeItem('algoClockMs');
  ui.click({ btn: 'clockpick', ms: '0', clockfor: 'competitive' });
  assert.equal(localStorage.getItem('algoMatchClockMs'), '0');
  assert.equal(localStorage.getItem('algoClockMs'), null, 'the match clock wrote the casual one');
  const html = ui.html();
  assert.equal(onChip(html, 'competitive'), '0');
  assert.match(html, /no clock — nobody can lose on time/);
  // and the casual clock leaves the match clock alone
  ui.click({ btn: 'home-format', format: 'casual' });
  ui.click({ btn: 'clockpick', ms: String(60 * 60_000), clockfor: 'constructed' });
  assert.equal(localStorage.getItem('algoClockMs'), String(60 * 60_000));
  assert.equal(localStorage.getItem('algoMatchClockMs'), '0', 'the casual clock wrote the match one');
  ui.click({ btn: 'clockpick', ms: 'auto', clockfor: 'constructed' });
  ui.click({ btn: 'home-format', format: 'competitive' });
});

test('1043 §3 Create match carries the choice; Default carries nothing', async () => {
  localStorage.setItem('algoMatchClockMs', '0');
  assert.match(await createMatch(), /[?&]ccdeck=d1&clock=0$/, 'Off rides the creating link');
  localStorage.setItem('algoMatchClockMs', String(60 * 60_000));
  assert.match(await createMatch(), /&clock=3600000$/);
  ui.click({ btn: 'clockpick', ms: 'auto', clockfor: 'competitive' });
  assert.equal(localStorage.getItem('algoMatchClockMs'), null, 'Default removes the key');
  const link = await createMatch();
  assert.match(link, /[?&]ccdeck=d1/, 'positive control: a match link');
  assert.doesNotMatch(link, /clock=/, 'Default sends nothing: the server applies the match default');
});

test('1043 §4 the match clock key is a listed browser key', () => {
  assert.ok(BROWSER_KEYS.some(k => k.covers.includes('algoMatchClockMs')), 'legal.ts BROWSER_KEYS does not list algoMatchClockMs');
  assert.equal(cp.MATCH_CLOCK_KEY, 'algoMatchClockMs');
});
