/* 1516 · A GAME'S FORMAT IS SAID IN A PLAYER'S WORDS WHEREVER IT IS DRAWN (BL-10)
 *
 * The wire's mode names ('shared', 'draft') and a single card duel's mode
 * ('constructed', CR D8.2) are turned into words in one place, formatName /
 * modeName. The profile and the post-game used them; the admin's Games and
 * Live rooms tables printed the raw mode.
 *
 *   §1 the helper: sandbox, live draft, constructed, single card duel
 *   §2 the admin Games and Live rooms tables say each mode in words, under a
 *      "format" head, and a single card duel's cards are its tooltip
 *   §3 a census of the ui sources: no template draws a `.mode` raw
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { formatName } from '../account.ts';
import { adminHtml, type AdminView, type GameRow, type RoomRow } from '../pages/admin.ts';

const UI = join(import.meta.dirname, '..');

test('1516 §1 formatName says each format as a player reads it', () => {
  assert.equal(formatName('shared', undefined), 'sandbox');
  assert.equal(formatName('draft', false), 'live draft');
  assert.equal(formatName('constructed', undefined), 'constructed');
  assert.equal(formatName('constructed', true), 'single card duel');
  assert.equal(formatName('constructed', ['Mindburn', 'Fight']), 'single card duel');
});

const game = (code: string, mode: string, extra: Partial<GameRow> = {}): GameRow => ({
  code, playedAt: '2026-11-01T10:00:00Z', mode, els: [], finished: true, diverged: false, winner: 0, turns: 8,
  minutes: 20, players: ['Ann', 'Bo'], known: [true, true], rated: false, custom: false, ...extra,
});
const room = (code: string, mode: string, extra: Partial<RoomRow> = {}): RoomRow => ({
  code, mode, names: ['Ann', 'Bo'], connected: [true, true], users: [null, null], turn: 1, phase: 'main',
  winner: null, actions: 3, minutes: 1, watchers: 0, rated: false, ...extra,
});
function view(current: AdminView['current']): AdminView {
  return {
    access: true, current, isLoading: false, actionMsg: '', faultMsg: '', overview: null,
    accountRows: [], reportRows: [],
    gameRows: [game('G1', 'shared'), game('G2', 'draft'), game('G3', 'constructed'),
      game('G4', 'constructed', { single: ['Mindburn', 'Fight <x>'] })],
    roomRows: [room('RMAA', 'shared'), room('RMBB', 'draft'), room('RMCC', 'constructed'), room('RMDD', 'constructed', { single: true })],
    calendar: { now: 0, rows: [], runsOutAt: null, weeksLeft: 0, upcoming: 0 },
    onlyUnmarked: false, chrome: { signedIn: true, alerts: 0 },
  };
}
/** the format cell (column `at`) of the row whose first cell carries `code` */
function cell(html: string, code: string, at: number): string {
  const row = html.split('<tr>').find(r => r.includes(`>${code}<`) || r.includes(`▶ ${code}<`));
  assert.ok(row, `positive control: row ${code} is drawn`);
  const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]!);
  return cells[at]!;
}

test('1516 §2 the admin tables say the format in words', () => {
  const games = adminHtml(view('games'));
  assert.match(games, /<th>played<\/th><th>format<\/th>/);
  assert.match(cell(games, 'G1', 2), /^sandbox/);
  assert.match(cell(games, 'G2', 2), /^live draft/);
  assert.match(cell(games, 'G3', 2), /^constructed/);
  assert.match(cell(games, 'G4', 2), /^<span title="Mindburn vs Fight &lt;x&gt;">single card duel<\/span>/);
  assert.doesNotMatch(games, /<td>(shared|draft)\b/);

  const rooms = adminHtml(view('rooms'));
  assert.match(rooms, /<th>room<\/th><th>format<\/th>/);
  assert.match(cell(rooms, 'RMAA', 1), /^sandbox/);
  assert.match(cell(rooms, 'RMBB', 1), /^live draft/);
  assert.match(cell(rooms, 'RMCC', 1), /^constructed/);
  assert.match(cell(rooms, 'RMDD', 1), /^single card duel/);
  assert.doesNotMatch(rooms, /<td>(shared|draft)\b/);
});

test('1516 §3 census: no ui template draws a mode raw', () => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (f === 'node_modules' || f === 'test' || f.startsWith('bundle')) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.ts')) files.push(p);
    }
  };
  walk(UI);
  assert.ok(files.length > 50, 'positive control: the walk found the ui sources');
  // text off a row's mode: escaped into a cell. A mod's mode (graft / augment)
  // and a URL's mode= parameter are not a game's format, and are not escaped.
  const raw = /esc\(\s*[\w.?]*\.mode\s*\)/;
  assert.ok(raw.test('<td>${esc(g.mode)}</td>') && raw.test('esc(r?.mode)'), 'positive control: the pattern sees a raw mode');
  const hits: string[] = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (raw.test(line)) hits.push(`${f.slice(UI.length + 1)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], 'a mode is drawn through formatName (pages/profile.ts)');
});
