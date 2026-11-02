/* docs/22 §6.1, §5.6, §3.1 — REACHING A MATCH, AND REPLAYING ONE.
 *
 *   §1 the Competitive card: signed out it says so and offers the sign-in;
 *      signed in, Best of 3 first, the decks with an illegal one greyed and
 *      its reason, and New match opens the room as its creator with the Best
 *      of and the deck
 *   §2 "Your matches" (the installed-app rule: no address bar, so a paused
 *      match is one BUTTON away): a row per open match, and its button opens
 *      the match's room as a match room
 *   §3 …and the bell lists it too, one button from any page
 *   §4 a Competitive replay deals with its rules: the chosen initiative and
 *      the steps in turn — without them it is a different game
 *   §5 a watch carries the token (a match room is watched only by a signed-in
 *      player who is not in it — the server must know who is asking)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { createGame } from '../../engine/src/apply.ts';
import type { CardName } from '../../engine/src/types.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 30);
const deck = (id: string, name: string, side: string[]) => ({
  id, name, cards: N.slice(0, 15).flatMap(n => [n, n]), maybe: [], sideboard: side,
  cover: null, author: 'you', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z',
  problems: [], ccProblems: [], record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
});
const LEGAL = deck('dOK', 'Legal deck', N.slice(15, 22));
const BIG_SIDE = deck('dBAD', 'Big side', N.slice(15, 23));
const PAUSED_AT = Date.now() - 2 * 86_400_000;
const MINE = [{ id: 'M839', bestOf: 3, seat: 1, opponent: 'Rashi', score: [0, 1], game: 2, phase: 'paused', room: 'PAUS', pausedAt: PAUSED_AT, until: null, voidAt: PAUSED_AT + 7 * 86_400_000 }];
const FETCHED: string[] = [];
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't839' };
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  FETCHED.push(url);
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [LEGAL, BIG_SIDE] }) };
  if (url === '/api/matches/mine') return { ok: true, status: 200, json: async () => ({ ok: true, matches: MINE }) };
  if (url === '/api/new') return { ok: true, status: 200, json: async () => ({ code: 'NEWC' }) };
  if (url.startsWith('/api/inbox')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const mt = await import('../match.ts');
const { ReplayServer } = await import('../replayserver.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
await flush();

const card = (html: string): string => {
  const at = html.indexOf('class="homecard offer cccard"');
  assert.ok(at >= 0, 'no Competitive card on the home screen');
  return html.slice(at, html.indexOf('</div>\n', html.indexOf('data-btn="cc-new"', at)));
};

test('§1 the Competitive card: sign-in, Best of, the CC-legal picker, New match', async () => {
  const out = mt.competitiveCardHtml(false, null);
  assert.match(out, /Sign in to play a Competitive match\./);
  assert.match(out, /data-btn="acct-open-auth"/);
  assert.doesNotMatch(out, /cc-new/, 'signed out: no New match');

  let html = card(ui.html());
  assert.match(html, /<button class="on" data-btn="cc-bo" data-bo="3" aria-pressed="true">Best of 3/, 'Bo3 first');
  assert.match(html, /<option value="dOK" selected>Legal deck<\/option>/);
  assert.match(html, /<option value="dBAD" disabled>Big side — a sideboard holds at most 7 cards \(got 8\)<\/option>/,
    'the illegal deck is greyed, with its reason');
  html = card(ui.click({ btn: 'cc-bo', bo: '1' }));
  assert.match(html, /<button class="on" data-btn="cc-bo" data-bo="1"/);
  ui.click({ btn: 'cc-new' });
  await flush();
  assert.equal(location.search, '?ws=1&room=NEWC&seat=0&mode=constructed&bo=1&ccdeck=dOK');
  ui.click({ btn: 'cc-bo', bo: '3' });
});

test('§2 Your matches: a row, and one button into the room', () => {
  assert.ok(FETCHED.includes('/api/matches/mine'));
  const html = ui.html();
  const row = /<div class="ccmine">[\s\S]*?<\/div>\s*<\/div>/.exec(html)?.[0] ?? '';
  assert.match(row, /Your matches/);
  assert.match(row, /vs <b>Rashi<\/b> · you lead 1–0 · paused 2 d ago/);
  assert.match(row, /data-btn="cc-open" data-room="PAUS" data-seat="1">Resume</);
  assert.ok(html.indexOf('class="ccmine"') < html.indexOf('class="homegrid"'), 'above the mode cards');
  ui.click({ btn: 'cc-open', room: 'PAUS', seat: '1' });
  assert.equal(location.search, '?ws=1&room=PAUS&seat=1&mode=constructed&cc=1');
});

test('§3 the bell lists the match, with the same button', () => {
  const html = ui.click({ inbox: 'bell' });
  assert.match(html, /Competitive match vs <b>Rashi<\/b>/);
  ui.click({ inbox: 'match-open', room: 'PAUS', seat: '1' });
  assert.equal(location.search, '?ws=1&room=PAUS&seat=1&mode=constructed&cc=1');
});

test('§4 a Competitive replay deals with its rules', async () => {
  const decks: [CardName[], CardName[]] = [DECK_LIST.slice(0, 30), DECK_LIST.slice(30, 60)];
  const seed = 83900;
  const rolled = createGame(seed, ['Ann', 'Bo'], 'constructed', undefined, decks).state.initiative;
  const chosen = rolled === 0 ? 1 : 0;   // the opposite of the roll, so the override shows
  const file = { seed, mode: 'constructed' as const, names: ['Ann', 'Bo'] as [string, string], actions: [], decks, rules: { sequential: true as const, initiative: chosen } };
  const rs = new ReplayServer(file, 0, true);
  const sock = rs.socket();
  const got: Record<string, unknown>[] = [];
  sock.onmessage = e => { got.push(JSON.parse(e.data) as Record<string, unknown>); };
  rs.push();
  await flush();
  const view = got.map(m => m['view'] as { initiative?: number; sequential?: boolean } | undefined).find(v => v);
  assert.ok(view, 'the replay served a board');
  assert.equal(view.initiative, chosen, 'the chosen initiative, not the roll');
  assert.equal(view.sequential, true, 'the steps in turn');
});

test('§5 a watch says who is watching', () => {
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  const fn = main.slice(main.indexOf('  sendWatch(): void {'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /t: 'watch', room: this\.room, \.\.\.\(acct\.token\(\) \? \{ token: acct\.token\(\) \} : \{\}\)/);
});
