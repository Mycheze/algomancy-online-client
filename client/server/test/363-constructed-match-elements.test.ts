/* A CONSTRUCTED GAME IS NOT PLAYED WITH A TRIO.
 *
 * Reported 2026-10-03 by the owner: *"ALL my constructed games with Gember
 * are marked as Fire Water Earth, despite us rarely playing that specific
 * combo"*. All twelve constructed rows on the box read fire/water/earth.
 *
 * The mechanism, each step of which looked right on its own:
 *   1. a constructed join carries no `els`, and the room runs what it has
 *      through `sanitizeTrio`, which never returns nothing — it returns
 *      DRAFT_TRIO, fire/water/earth. The engine ignores it outside draft.
 *   2. stats.ts meant to fall through to "the elements the cards belong to"
 *      for a game with no trio — behind `if (els.length) return els`, which
 *      was therefore never false. Dead since the day accounts landed.
 *   3. so every summary, every history row, the account page's Recent games,
 *      the post-game line and the admin table all said fire/water/earth; the
 *      profile's per-element game count counted it; and the "something you
 *      have not played" trio picker was told the pair had just drafted it.
 *
 * The repair asks the MODE, never whether a trio is present, and it asks at
 * READ time, of each seat's `cardElements` — which every stored row already
 * carries — so the twelve rows already written read right without a replay.
 *
 * §1 ⭐ the summary of a real constructed game: two sides, no DRAFT_TRIO.
 * §2 ⭐ the rows already stored: Recent games labels mine vs theirs, the
 *    profile counts only your own colours, and the new row is stored right.
 * §3 ⭐ the trio picker reads draft rows only.
 * §4    the two screens that print it: Recent games and the post-game line.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* THROWAWAY STATE: `register` and `rebuildProfiles` write the account store,
 * which is live data under var/ (statepaths.ts). Set before the imports —
 * accounts.ts captures its file at module scope. */
const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-363-'));
process.env['ALGO_GAMES_DIR'] = join(SCRATCH, 'games');
process.env['ALGO_ACCOUNTS_FILE'] = join(SCRATCH, 'accounts.json');

const { apply, createGame, legalActions, IllegalAction, sanitizeTrio, DRAFT_TRIO, checkDeck } =
  await import('../../engine/src/apply.ts');
const { DECK_LIST } = await import('../../engine/src/cards/registry.ts');
const { factionsOf } = await import('../cardledger.ts');
const { summarizeGame, gameSides, gameElements, seatElements, zeroElements } = await import('../stats.ts');
const accounts = await import('../accounts.ts');
/* The two ui/ renderers (§4), loaded by URL rather than by literal specifier:
 * a literal would pull ui/'s DOM code into the SERVER's typecheck, which has no
 * DOM lib. Both are pure string builders and run fine under node. */
const uiModule = (rel: string): Promise<unknown> => import(new URL(rel, import.meta.url).href);
const { historyRowsHtml } = await uiModule('../../ui/account.ts') as {
  historyRowsHtml: (rows: import('../accounts.ts').MatchRow[]) => string };
const { elementsLine } = await uiModule('../../ui/postgame.ts') as {
  elementsLine: (o: { seat: 0 | 1; els: string[]; sides?: [string[], string[]] }) => string };

type Action = import('../../engine/src/types.ts').Action;
type Element = import('../../engine/src/types.ts').Element;
type RecordedGame = import('../accounts.ts').RecordedGame;
type SeatStats = import('../stats.ts').SeatStats;

/** thirty cards of ONE element, no hybrids — a seat whose colours are beyond doubt */
function monoDeck(el: Element): string[] {
  const pick = DECK_LIST.filter(n => { const f = factionsOf(n); return f.length === 1 && f[0] === el; }).slice(0, 15);
  return [...pick, ...pick];
}

/** Play a constructed game out, leaning on playCard so both seats put cards
 * down. Deterministic: a fixed seed and a fixed walk. */
function playConstructed(decks: [string[], string[]], seed: number): Action[] {
  // exactly what a constructed room does with the `els` its join never sent
  let { state } = createGame(seed, ['Mine', 'Theirs'], 'constructed', sanitizeTrio(undefined), decks);
  const actions: Action[] = [];
  let rng = 12345;
  const rand = (): number => { rng = (Math.imul(rng, 1103515245) + 12345) >>> 0; return rng / 2 ** 32; };
  for (let i = 0; i < 600 && state.phase !== 'gameover'; i++) {
    const legal: Action[] = [];
    for (const s of [0, 1] as const) legal.push(...legalActions(state, s));
    if (!legal.length) break;
    const plays = legal.filter(a => a.type === 'playCard');
    const a = plays.length && rand() < 0.7 ? plays[Math.floor(rand() * plays.length)]! : legal[Math.floor(rand() * legal.length)]!;
    try { state = apply(state, a).state; actions.push(a); }
    catch (err) { if (!(err instanceof IllegalAction)) throw err; }
  }
  return actions;
}

const WOOD = monoDeck('wood'), METAL = monoDeck('metal');
const LOG = playConstructed([WOOD, METAL], 7);
/* the record a constructed room saves: no `els` at all */
const SUMMARY = summarizeGame({ code: 'CONS', seed: 7, mode: 'constructed', names: ['Mine', 'Theirs'], actions: LOG, decks: [WOOD, METAL] });

/* ══ §1 — the summary ══════════════════════════════════════════════════ */

test('§1 premise: the room trio a constructed join falls back to is fire water earth', () => {
  assert.deepEqual(sanitizeTrio(undefined), DRAFT_TRIO);
  assert.deepEqual(DRAFT_TRIO, ['fire', 'water', 'earth']);
  assert.ok(checkDeck(WOOD).ok && checkDeck(METAL).ok, 'both test decks are legal constructed decks');
  assert.equal(SUMMARY.skipped, 0, 'the walk replays cleanly');
  assert.ok(SUMMARY.seats[0].cardElements.wood > 0 && SUMMARY.seats[1].cardElements.metal > 0,
    'both seats put cards down, so both have colours to read');
});

test('§1 ⭐ a constructed game of mono wood against mono metal is never labelled with DRAFT_TRIO', () => {
  assert.notDeepEqual(SUMMARY.els, DRAFT_TRIO);
  assert.deepEqual(SUMMARY.els, ['wood', 'metal'], 'the game is the union of what the two sides played');
  for (const el of DRAFT_TRIO) assert.ok(!SUMMARY.els.includes(el), `${el} was never played`);
});

test('§1 ⭐ each seat of a constructed game is its own identity', () => {
  assert.deepEqual(gameSides(SUMMARY), [['wood'], ['metal']]);
  assert.deepEqual(seatElements(SUMMARY, 0), ['wood']);
  assert.deepEqual(seatElements(SUMMARY, 1), ['metal']);
});

test('§1b a draft keeps its trio, and has no sides', () => {
  const d = summarizeGame({ code: 'DRFT', seed: 3, mode: 'draft', els: ['wood', 'metal', 'light'], names: ['a', 'b'], actions: [] });
  assert.deepEqual(d.els, ['wood', 'metal', 'light']);
  assert.equal(gameSides(d), undefined);
  assert.deepEqual(seatElements(d, 1), ['wood', 'metal', 'light'], 'a draft seat’s pool is the trio');
});

test('§1c a constructed game that never got going is labelled with nothing, not a made-up trio', () => {
  const s = summarizeGame({ code: 'IDLE', seed: 7, mode: 'constructed', names: ['a', 'b'], actions: [], decks: [WOOD, METAL] });
  assert.deepEqual(s.els, []);
  assert.deepEqual(gameSides(s), [[], []]);
});

/* ══ §2 — the rows already on the box ═══════════════════════════════════ */

/** a seat as the box stores it — only cardElements matters here */
function seat(name: string, played: Partial<Record<Element, number>>, won: boolean): SeatStats {
  const s = summarizeGame({ code: 'X', seed: 1, mode: 'shared', names: [name, 'x'], actions: [] }).seats[0];
  return { ...s, name, won, cardElements: { ...zeroElements(), ...played } };
}
/** a stored history row written before the fix: fire/water/earth on a constructed game */
function storedRow(code: string, mode: 'constructed' | 'draft', users: [string | null, string | null], names: [string, string],
  played: [Partial<Record<Element, number>>, Partial<Record<Element, number>>], els: Element[] = ['fire', 'water', 'earth'],
  extra: Partial<RecordedGame> = {}): RecordedGame {
  return {
    code, playedAt: `2026-10-0${code.length}T12:00:00.000Z`, recordedAt: '2026-10-03T12:00:00.000Z',
    mode, els, finished: true, winner: 0, turns: 9, diverged: false,
    users, names, seats: [seat(names[0], played[0], true), seat(names[1], played[1], false)], ...extra,
  };
}

accounts.loadAccounts();
const me = accounts.register('Mycheze', 'a good password');
const them = accounts.register('Gember', 'a good password');
if (!me.ok || !them.ok) throw new Error('could not register the test accounts');
const MY = me.account.id, THEIR = them.account.id;

// TVXN, as the box has it: mycheze played water, Karanda fire with a dark lean
accounts.stashHistory(storedRow('TVXN', 'constructed', [MY, THEIR], ['Mycheze', 'Gember'],
  [{ water: 12 }, { fire: 3.5, dark: 4.5 }]));
// QGUM: a 1/33 metal splash is not a colour
accounts.stashHistory(storedRow('QGUM', 'constructed', [THEIR, MY], ['Gember', 'Mycheze'],
  [{ earth: 13, wood: 1 }, { metal: 1, light: 19, dark: 13 }]));
accounts.rebuildProfiles();

test('§2 ⭐ a stored constructed row reads mine vs theirs from the side of whoever is looking', () => {
  const mine = accounts.recentGames(MY).find(g => g.code === 'TVXN')!;
  assert.deepEqual(mine.sides, [['water'], ['fire', 'dark']]);
  const theirs = accounts.recentGames(THEIR).find(g => g.code === 'TVXN')!;
  assert.deepEqual(theirs.sides, [['fire', 'dark'], ['water']], 'the other seat sees the same game the other way round');
  assert.deepEqual(mine.els, ['fire', 'water', 'dark'], 'the union, in wheel order — not the stored fire water earth');
  const q = accounts.recentGames(MY).find(g => g.code === 'QGUM')!;
  assert.deepEqual(q.sides, [['light', 'dark'], ['earth']], 'a splash under a quarter is not a colour');
});

test('§2 ⭐ the profile counts a constructed game by your own colours, not the stored trio', () => {
  const p = accounts.accountById(MY)!.profile;
  assert.equal(p.byElement.water, 1, 'TVXN: I played water');
  assert.equal(p.byElement.light, 1, 'QGUM: I played light');
  assert.equal(p.byElement.dark, 1, 'QGUM: and dark');
  assert.equal(p.byElement.earth, 0, 'earth was never mine — only the stored label said so');
  assert.equal(p.byElement.fire, 0, 'fire was the opponent in TVXN, not me');
});

test('§2b a draft row still reads its trio, with no sides', () => {
  accounts.stashHistory(storedRow('DRAFTD', 'draft', [MY, THEIR], ['Mycheze', 'Gember'],
    [{ wood: 5 }, { light: 5 }], ['wood', 'light', 'dark']));
  const d = accounts.recentGames(MY).find(g => g.code === 'DRAFTD')!;
  assert.deepEqual(d.els, ['wood', 'light', 'dark']);
  assert.equal(d.sides, undefined);
});

test('§2c a newly recorded constructed game is stored with its real colours', () => {
  const out = accounts.recordGame({ ...SUMMARY, code: 'LIVE' }, [MY, THEIR]);
  assert.ok(out.recorded);
  assert.deepEqual(out.game.els, ['wood', 'metal']);
  assert.deepEqual(gameElements(out.game), ['wood', 'metal']);
});

/* ══ §3 — the trio picker ═══════════════════════════════════════════════ */

test('§3 ⭐ the trio history for the something-not-played picker holds draft rows only', () => {
  const rows = accounts.trioHistoryRows(accounts.gameHistory(), [MY, null], ['Mycheze', 'someone']);
  assert.ok(rows.length > 0, 'the draft row is there');
  const keys = rows.map(r => r.els.join('+'));
  assert.ok(keys.includes('wood+light+dark'), 'the draft trio counts as played');
  assert.ok(!keys.includes('fire+water+earth'), 'no constructed row marks fire water earth as played');
  assert.equal(rows.length, accounts.gameHistory().filter(g => g.mode === 'draft').length,
    'every row it returns is a draft');
});

test('§3b a custom draft is still left out, and a signed-out seat still matches by name', () => {
  const custom = storedRow('CUSTOM', 'draft', [THEIR, MY], ['Gember', 'Mycheze'], [{}, {}], ['fire', 'wood'],
    { custom: { elements: 2 } as never });
  const named = storedRow('NAMED', 'draft', [null, null], ['Mycheze', 'nobody'], [{}, {}], ['earth', 'metal', 'dark']);
  const rows = accounts.trioHistoryRows([custom, named], [null, null], ['  mycheze ', 'x']);
  assert.deepEqual(rows.map(r => r.els), [['earth', 'metal', 'dark']]);
});

/* ══ §4 — the screens ═══════════════════════════════════════════════════ */

test('§4 Recent games prints mine vs theirs for a constructed row and the trio for a draft', () => {
  const rows = accounts.recentGames(MY);
  const html = historyRowsHtml(rows.filter(r => r.code === 'TVXN'));
  assert.match(html, /water<\/span><span class="hint"> vs <\/span><span class="acctel fire">fire<\/span><span class="acctel dark">dark/);
  assert.doesNotMatch(html, /earth/);
  const draft = historyRowsHtml(rows.filter(r => r.code === 'DRAFTD'));
  assert.doesNotMatch(draft, / vs /);
});

test('§4b the post-game line puts the viewer side first', () => {
  const sides = gameSides(SUMMARY)!;
  const asSeat1 = elementsLine({ seat: 1, els: SUMMARY.els, sides });
  assert.match(asSeat1, /metal<\/span><span class="hint"> vs <\/span><span class="acctel wood">/);
  const asSeat0 = elementsLine({ seat: 0, els: SUMMARY.els, sides });
  assert.match(asSeat0, /wood<\/span><span class="hint"> vs <\/span><span class="acctel metal">/);
});

test('§4c the admin games table carries each seat of a stored constructed row', async () => {
  const { gameRows } = await import('../admin.ts');
  const row = gameRows().find(g => g.code === 'TVXN')!;
  assert.deepEqual(row.sides, [['water'], ['fire', 'dark']], 'by seat, as the players column is');
  assert.ok(!row.els.includes('earth'), 'the stored fire water earth never reaches the page');
  assert.equal(gameRows().find(g => g.code === 'DRAFTD')!.sides, undefined, 'a draft row has its trio and no sides');
});

test('§4d main.ts reads both of its consumers through the derivation, not the stored label', () => {
  // main.ts starts a server on import, so its two call sites are held by source
  const src = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  const trio = src.slice(src.indexOf('function trioHistoryFor('), src.indexOf('function trioHistoryFor(') + 400);
  assert.match(trio, /trioHistoryRows\(gameHistory\(\)/, 'the trio picker reads the draft-only rows');
  assert.doesNotMatch(trio, /\.filter\(/, 'and keeps no filter of its own to drift from the tested one');
  assert.doesNotMatch(src, /els: row\.els/, 'the post-game message never sends a stored row label raw');
  assert.match(src, /els: gameElements\(row\)/);
});
