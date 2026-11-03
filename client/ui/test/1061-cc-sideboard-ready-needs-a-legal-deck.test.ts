/* 1061 — ON THE SIDEBOARDING TABLE, READY WAITS FOR A LEGAL DECK, AND SAYS WHY.
 *
 * docs/22 §5.4: "Ready is disabled while the configuration is illegal", with a
 * live legality line. On the table (owner 2026-11-03, "like MTGO") the bottom
 * bar always shows the counts — "Deck 30 · Sideboard 7/7" — and the verdict
 * beside them: ✓ Legal, or the reason. An in-between step of a swap (a card
 * out before its replacement is in) is illegal, so this is the screen's
 * commonest state, and it must never look like a broken button.
 *
 *   §1 legal: the counts, ✓ Legal, Ready live (both of the loser's)
 *   §2 too few in the deck: the counts in red, the reason, every Ready off
 *   §3 too many in the sideboard: the same, with that reason
 *   §4 legal again: the reason goes and Ready is back
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { client } from './ui-driver.ts';

const ui = await client();

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 26);
// 31 in the deck and a full sideboard: one card can go out without the deck going short
const MAIN = [...N.slice(0, 15).flatMap(n => [n, n]), N[15]!];
const SIDE = N.slice(16, 23);
const info = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'M1061', bestOf: 3, game: 2, score: [0, 1], names: ['Ann', 'Bo'],
  banks: [38 * 60_000, 41 * 60_000], clockStart: 45 * 60_000,
  // seat 0 lost game 1: it readies with the initiative choice (two buttons)
  phase: 'between', chooser: 0, initiative: null, until: Date.now() + 100_000, locked: false, ready: [false, false],
  mine: { registered: { main: MAIN, side: SIDE }, current: { main: MAIN, side: SIDE } },
  ...over,
});
ui.push({ t: 'joined', room: 'UIDRIVER', seat: 0, waiting: { have: [true, true], match: info() }, peers: [true, true], names: ['Ann', 'Bo'] });

/** the bottom bar */
const bar = (html: string): string => html.slice(html.indexOf('<footer class="ccsbbar">'), html.indexOf('</footer>'));
const readies = (html: string): string[] => [...bar(html).matchAll(/<button[^>]*data-btn="cc-ready"[^>]*>[^<]*<\/button>/g)].map(m => m[0]);

test('§1 legal: the counts, ✓ Legal, and both of the loser\'s Ready buttons live', () => {
  const b = bar(ui.html());
  assert.match(b, /Deck <b class="">31<\/b>\s*· Sideboard <b class="">7\/7<\/b>/);
  assert.match(b, /<span class="ccsbok">✓ Legal<\/span>/);
  const r = readies(ui.html());
  assert.equal(r.length, 2);
  for (const t of r) assert.doesNotMatch(t, /disabled/);
});

test('§2 a deck under 30: red count, the reason, every Ready off', () => {
  ui.click({ btn: 'cc-move', from: 'main', card: N[0]! });          // 30 / 8
  let html = ui.click({ btn: 'cc-move', from: 'main', card: N[1]! }); // 29 / 9
  const b = bar(html);
  assert.match(b, /Deck <b class="bad">29<\/b>/);
  assert.match(b, /role="status">Main deck needs 30 — you have 29\.<\/p>/, 'the reason, in the bar beside the counts');
  assert.doesNotMatch(b, /✓ Legal/);
  for (const t of readies(html)) assert.match(t, /disabled/, `${t} is off`);
  assert.match(b, /Fix the deck to ready up\./);
  // put both back
  ui.click({ btn: 'cc-move', from: 'side', card: N[1]! });
  html = ui.click({ btn: 'cc-move', from: 'side', card: N[0]! });
  assert.match(bar(html), /✓ Legal/);
});

test('§3 a sideboard over 7: red count, that reason, every Ready off', () => {
  const html = ui.click({ btn: 'cc-move', from: 'main', card: N[15]! });   // 30 / 8
  const b = bar(html);
  assert.match(b, /Sideboard <b class="bad">8\/7<\/b>/);
  assert.match(b, /role="status">Sideboard holds 7 — you have 8\.<\/p>/);
  assert.match(html, /<b>Sideboard<\/b> <span class="ttpilecount bad">8\/7<\/span>/, 'the zone\'s own header says it too');
  for (const t of readies(html)) assert.match(t, /disabled/);
});

test('§4 legal again: the reason goes, Ready is back', () => {
  const html = ui.click({ btn: 'cc-move', from: 'side', card: N[16]! });  // 31 / 7
  const b = bar(html);
  assert.doesNotMatch(b, /cclegal/);
  assert.match(b, /✓ Legal/);
  for (const t of readies(html)) assert.doesNotMatch(t, /disabled/);
});
