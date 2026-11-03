/* 1062 — WHAT THE SIDEBOARDING TABLE SENDS IS WHAT IT SHOWS.
 *
 * The table (pages/match.ts, owner 2026-11-03: "like MTGO") draws the deck as
 * piles and the sideboard as a row, from the draft ui/match.ts keeps while a
 * swap is half made. The server deals what it was last sent (docs/22 §5.2:
 * the lock deals the last legal config). So after any run of taps and drops,
 * the config that went out must be exactly the cards in the two zones — no
 * card a player saw in the deck left out of it, none dealt that was shown in
 * the sideboard. The wire is unchanged: `{t:'cc', op:'config', main, side}`.
 *
 *   §1 a swap by taps: the sent config is the shown zones, as multisets
 *   §2 a swap by drops (the drag's drop): the same
 *   §3 "Back to the registered deck" sends the registration, and the table
 *      shows it once the server has it
 *   §4 the server's push of the config ends the draft: the table shows it as is
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { client, elementFor } from './ui-driver.ts';
import { sideboardDrag } from '../match.ts';

const ui = await client();

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 24);
const MAIN = N.slice(0, 15).flatMap(n => [n, n]);
const SIDE = N.slice(15, 20);
const REG = { main: MAIN, side: SIDE };
const info = (current: { main: string[]; side: string[] } = REG): Record<string, unknown> => ({
  id: 'M1062', bestOf: 3, game: 2, score: [1, 0], names: ['Ann', 'Bo'],
  banks: [38 * 60_000, 41 * 60_000], clockStart: 45 * 60_000,
  phase: 'between', chooser: 1, initiative: null, until: Date.now() + 100_000, locked: false, ready: [false, false],
  mine: { registered: REG, current },
});
const lobby = (current?: { main: string[]; side: string[] }, t = 'update'): string => ui.push({
  t, room: 'UIDRIVER', seat: 0, waiting: { have: [true, true], match: info(current) }, peers: [true, true], names: ['Ann', 'Bo'],
});
const configs = (): Array<{ main: string[]; side: string[] }> =>
  ui.sent().filter(m => m['t'] === 'cc' && m['op'] === 'config') as never;

function zoneCards(html: string, z: 'main' | 'side'): string[] {
  const at = html.indexOf(`data-cc-zone="${z}"`);
  assert.ok(at >= 0, `no ${z} zone on screen`);
  const end = html.indexOf(z === 'main' ? '<footer' : 'data-cc-zone="main"', at);
  return [...html.slice(at, end).matchAll(/data-card="([^"]+)"/g)].map(m => m[1]!);
}
const sorted = (l: readonly string[]): string[] => [...l].sort();
function sameAsShown(html: string, cfg: { main: string[]; side: string[] }): void {
  assert.deepEqual(sorted(cfg.main), sorted(zoneCards(html, 'main')), 'the deck sent = the deck shown');
  assert.deepEqual(sorted(cfg.side), sorted(zoneCards(html, 'side')), 'the sideboard sent = the sideboard shown');
}

lobby(REG, 'joined');
ui.sent();

test('§1 a two-for-two swap by taps: what went out is what is on the table', () => {
  ui.click({ btn: 'cc-move', from: 'main', card: N[0]! });
  ui.tap({ btn: 'cc-move', from: 'main', card: N[1]! });
  ui.click({ btn: 'cc-move', from: 'side', card: N[15]! });
  const html = ui.tap({ btn: 'cc-move', from: 'side', card: N[16]! });
  const sent = configs();
  assert.equal(sent.length, 1, 'only the legal end of the swap went out');
  sameAsShown(html, sent[0]!);
  lobby(sent[0]);
});

test('§2 the same by drops', () => {
  const drop = (from: 'main' | 'side', card: string, onto: { from: 'main' | 'side'; card: string }): string => {
    const html = ui.html();
    const plan = sideboardDrag.plan(elementFor(html, { btn: 'cc-move', from, card }) as unknown as HTMLElement)!;
    const zone = plan.zoneAt(elementFor(html, { btn: 'cc-move', ...onto }) as unknown as Element)!;
    assert.equal(plan.drop(zone, 0, 0), true);
    return ui.html();
  };
  drop('main', N[2]!, { from: 'side', card: N[17]! });
  const html = drop('side', N[17]!, { from: 'main', card: N[3]! });
  const sent = configs();
  assert.equal(sent.length, 1);
  sameAsShown(html, sent[0]!);
  lobby(sent[0]);
});

test('§3 back to the registered deck: the registration goes out, and the table shows it', () => {
  ui.click({ btn: 'cc-reset' });
  const sent = configs();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { t: 'cc', op: 'config', main: MAIN, side: SIDE } as never);
  sameAsShown(lobby(sent[0]), sent[0]!);
});

test('§4 a config the server pushes (another device, a restart) is the table as is', () => {
  const other = { main: [...MAIN.slice(1), N[19]!], side: [...SIDE.slice(0, 4), MAIN[0]!] };
  sameAsShown(lobby(other), other);
});
