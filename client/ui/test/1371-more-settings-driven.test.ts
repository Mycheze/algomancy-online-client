/* 1371 — MORE SETTINGS, DRIVEN (owner, 2026-11-14: "'Cards', 'Banned' and 'Game values' should
 * actually be under a 'More settings' since they're hardly ever used"). The real ui/main.ts paints
 * the home and its real handler takes the clicks (test/ui-driver.ts).
 *
 * §1 it starts shut; home-more opens it in place and shuts it again; a repaint the player did not
 *    ask for (a clock click) keeps it the way it was
 * §2 a setting changed inside it is counted on it once it is shut again, and the count goes when
 *    the setting does — the ban box, typed into, works with it open
 * §3 Create room still sends the rules set behind it
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
const asked: { url: string; init?: { method?: string; body?: string } }[] = [];
g['__UI_DRIVER_FETCH'] = (url: string, init?: { method?: string; body?: string }) => {
  asked.push({ url, init });
  if (url === '/api/new') return Promise.resolve({ ok: true, json: async () => ({ code: 'NEWR' }) });
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const crp = await import('../customrulespanel.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const moreBtn = (h: string): string => /<button[^>]*data-btn="home-more"[^>]*>[^]*?<\/button>/.exec(h)?.[0] ?? '';

test('1371 §1 shut first; it opens in place, survives a repaint, shuts again', () => {
  let html = ui.html();
  assert.match(moreBtn(html), /aria-expanded="false"/, 'positive control: shut on a first visit');
  assert.doesNotMatch(html, /data-btn="cr-simple"/);
  html = ui.click({ btn: 'home-more' });
  assert.match(moreBtn(html), /aria-expanded="true"/);
  assert.match(html, /data-btn="cr-simple"/);
  assert.match(html, /<input id="cr-ban" /);
  html = ui.click({ btn: 'clockpick', ms: 'auto', clockfor: 'draft' });
  assert.match(html, /data-btn="cr-simple"/, 'a repaint shut it');
  html = ui.click({ btn: 'home-more' });
  assert.doesNotMatch(html, /data-btn="cr-simple"/, 'it did not shut');
});

test('1371 §2 what is changed inside it is counted on it', () => {
  ui.click({ btn: 'home-more' });
  ui.click({ btn: 'cr-simple' });
  // a ban, the way a player bans: type in the box, click the suggestion
  const card = DECK_LIST[0]!;
  ui.type('cr-ban', card);
  // the suggestions are patched in place while typing, which the driver's page does not see;
  // a repaint draws them from the same draft (as 1042 does) — and keeps More settings open
  ui.click({ btn: 'clockpick', ms: 'auto', clockfor: 'draft' });
  ui.click({ btn: 'cr-ban', name: card });
  assert.deepEqual(crp.activeRules()?.bans, [card], 'positive control: the ban box works with it open');
  let html = ui.click({ btn: 'home-more' });
  assert.doesNotMatch(html, /data-btn="cr-simple"/, 'shut');
  assert.match(moreBtn(html), />2 changed<\/span><\/button>$/, 'Simple cards only and the ban');
  html = ui.click({ btn: 'home-more' });
  ui.click({ btn: 'cr-unban', name: card });
  ui.click({ btn: 'cr-simple' });
  html = ui.click({ btn: 'home-more' });
  assert.equal(crp.activeRules(), null);
  assert.doesNotMatch(moreBtn(html), /changed/, 'back to standard: no count');
});

test('1371 §3 Create room sends what is set behind it', async () => {
  ui.click({ btn: 'home-more' });
  ui.click({ btn: 'cr-simple' });
  const html = ui.click({ btn: 'home-more' });
  assert.match(html, /data-btn="newgame"[^>]*data-mode="draft">Create custom room</);
  asked.length = 0;
  ui.click({ btn: 'newgame', mode: 'draft' });
  await flush();
  const req = asked.find(a => a.url === '/api/new');
  assert.equal(req?.init?.method, 'POST', 'a custom room');
  assert.equal((JSON.parse(req!.init!.body!) as { rules: { simpleOnly: boolean } }).rules.simpleOnly, true);
});
