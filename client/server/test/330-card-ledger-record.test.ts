/* CARD STATS §1 — THE CARD LOG IS A RECORD, TAKEN AS THE GAME IS PLAYED.
 *
 * The Card Stats page folds, per game and per seat, which cards were held,
 * drawn, picked, passed, played, recycled and bottomed. The obvious source is
 * a replay, and for an old DRAFT game it is the one source that is certainly
 * wrong: a draft deal is a function of the card registry, so a card added
 * since the game was played reshuffles its packs and hands, and the replay
 * describes a game nobody played — refusing nothing, saying nothing.
 *
 * So rooms.ts writes the card facts down as each action is applied
 * (`Room.cardLog`, `Room.cardOpen`), exactly as it writes the board
 * fingerprints (`Room.sigs`, 317), and under the same rule:
 *
 *   ⚠ A RECORDED ENTRY IS NEVER RECOMPUTED.
 *
 *   §1  a played game records one fact per action and its opening, and persists them
 *   §2  the record round-trips a restore unchanged
 *   §3  a RECORDED entry beats the rebuilding engine's own answer
 *   §4  a file that predates the record gets null slots, never invented ones
 *   §5  an undo rewrites the tail and keeps the prefix
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legalActions } from '../../engine/src/apply.ts';
import type { Action } from '../../engine/src/types.ts';
import type { Room } from '../rooms.ts';
import { ledgerForFile, type LedgerFile } from '../cardledger.ts';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'cardlog-'));
}

/** a fresh copy of rooms.ts pointed at `dir` — see 317's roomsAt */
async function roomsAt(dir: string): Promise<typeof import('../rooms.ts')> {
  process.env['ALGO_GAMES_DIR'] = dir;
  return import(`../rooms.ts?cardlog=${Math.random()}`) as Promise<typeof import('../rooms.ts')>;
}

/** Walk a real game forward with a SEEDED random player, so the draft steps
 * actually take cards (the first legal commit is the one that takes none). */
export function playRandom(mod: typeof import('../rooms.ts'), room: Room, n: number, seed = 1): void {
  let x = seed >>> 0 || 1;
  const rnd = (k: number): number => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x % k; };
  for (let i = 0; i < n; i++) {
    if (room.state.winner !== null) return;
    const legal: Action[] = [...legalActions(room.state, 0), ...legalActions(room.state, 1)]
      .filter(a => a.type !== 'concede');
    if (!legal.length) return;
    // a uniform pick recycles every card it holds and never plays one, so
    // playing is weighted up and recycling down — a game that tests nothing
    // about plays would pass every assertion about them
    const weighted = legal.flatMap(a => Array<Action>(WEIGHT[a.type] ?? 2).fill(a));
    mod.applyToRoom(room, weighted[rnd(weighted.length)]!);
  }
}

const WEIGHT: Partial<Record<Action['type'], number>> = { playCard: 12, augment: 6, graft: 6, recycleForResource: 1 };

const TRIO = ['fire', 'water', 'earth'] as const;

test('card stats §1 a played game records one fact per action and its opening, and writes them down', async () => {
  const dir = scratch();
  try {
    const mod = await roomsAt(dir);
    const room = mod.createRoom('CL1', 4242, ['A', 'B'], 'draft', [...TRIO]);
    playRandom(mod, room, 120, 7);

    assert.ok(room.actions.length >= 40, `wanted a real game, got ${room.actions.length} actions`);
    assert.equal(room.cardLog.length, room.actions.length, 'the record is indexed BY ACTION');
    assert.ok(room.cardLog.every(f => f !== null && typeof f.t === 'number'));
    assert.ok(room.cardOpen, 'the opening was not stamped on the first action');
    assert.equal(room.cardOpen.hands[0].length, 6, 'a draft opens on 6 cards (4 + turn 1\'s 2)');
    assert.equal(room.cardOpen.hands[1].length, 6);

    const picks = room.cardLog.flatMap(f => f?.pk ? [f] : []);
    assert.ok(picks.length >= 2, 'no draft step was recorded');
    assert.ok(room.cardLog.some(f => f?.m?.some(([, , from, to]) => from === 'P' && to === 'H')),
      'the random player never took a card out of a pack — the case is untested');

    const file = JSON.parse(readFileSync(join(dir, 'CL1.json'), 'utf8')) as LedgerFile & { cardLog: unknown[] };
    assert.equal(file.cardLog.length, file.actions.length, 'persisted, and persisted whole');
    assert.deepEqual(file.cardOpen, room.cardOpen);
    const { ledger, audit } = ledgerForFile(file);
    assert.equal(audit.source, 'live', `a freshly played file must read as its own record, got ${audit.source}: ${audit.why}`);
    assert.deepEqual(ledger.coverage, { open: true, draws: true, plays: true, picks: true, turns: true, init: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('card stats §2 the record round-trips a restore unchanged', async () => {
  const dir = scratch();
  try {
    const one = await roomsAt(dir);
    const room = one.createRoom('CL2', 909, ['A', 'B'], 'draft', [...TRIO]);
    playRandom(one, room, 80, 3);
    const recorded = structuredClone(room.cardLog);
    const opened = structuredClone(room.cardOpen);

    const two = await roomsAt(dir);
    two.restoreRooms();
    const back = two.getRoom('CL2');
    assert.ok(back, 'the room did not come back off disk');
    assert.deepEqual(back.cardLog, recorded);
    assert.deepEqual(back.cardOpen, opened);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('card stats §3 a RECORDED entry beats the rebuilding engine — the whole point', async () => {
  const dir = scratch();
  try {
    const one = await roomsAt(dir);
    const room = one.createRoom('CL3', 31337, ['A', 'B'], 'draft', [...TRIO]);
    playRandom(one, room, 60, 11);
    const path = join(dir, 'CL3.json');
    const file = JSON.parse(readFileSync(path, 'utf8')) as { cardLog: unknown[]; cardOpen: { hands: string[][] } };

    // stand in for "the registry moved since this game was dealt": the file
    // says one thing, and no engine would ever say it
    const TAMPERED = { t: 99, m: [[0, 'Not A Card', 'D', 'H']] };
    file.cardLog[10] = TAMPERED;
    file.cardOpen.hands[0] = ['Also Not A Card'];
    writeFileSync(path, JSON.stringify(file));

    const two = await roomsAt(dir);
    two.restoreRooms();
    const back = two.getRoom('CL3')!;
    assert.deepEqual(back.cardLog[10], TAMPERED,
      'the restore recomputed a recorded card fact. For an old draft that replaces what '
      + 'was in the hands with what a reshuffled deal would have put there. See Room.cardLog.');
    assert.deepEqual(back.cardOpen?.hands[0], ['Also Not A Card'], 'and the opening likewise');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('card stats §4 a file that predates the record gets NULL slots, never invented ones', async () => {
  const dir = scratch();
  try {
    const one = await roomsAt(dir);
    const room = one.createRoom('CL4', 5150, ['A', 'B'], 'draft', [...TRIO]);
    playRandom(one, room, 40, 5);
    const path = join(dir, 'CL4.json');
    const file = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    delete file['cardLog'];
    delete file['cardOpen'];
    writeFileSync(path, JSON.stringify(file));

    const two = await roomsAt(dir);
    two.restoreRooms();
    const back = two.getRoom('CL4')!;
    assert.equal(back.cardLog.length, back.actions.length, 'still indexed by action');
    assert.ok(back.cardLog.every(f => f === null), 'the restore INVENTED card facts for a game that recorded none');
    assert.equal(back.cardOpen, null, 'and an opening');

    // play on: the new actions are recorded, the old ones stay unrecorded,
    // and the file is then NOT a complete record — the ledger says so
    playRandom(two, back, 5, 9);
    const after = JSON.parse(readFileSync(path, 'utf8')) as LedgerFile & { cardLog: unknown[] };
    assert.ok(after.cardLog.slice(0, 40).every(f => f === null));
    assert.ok(after.cardLog.slice(40).every(f => f !== null));
    assert.notEqual(ledgerForFile(after).audit.source, 'live');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('card stats §5 an undo rewrites the tail and keeps the prefix', async () => {
  const dir = scratch();
  try {
    const mod = await roomsAt(dir);
    const room = mod.createRoom('CL5', 8080, ['A', 'B'], 'draft', [...TRIO]);
    playRandom(mod, room, 50, 13);
    const before = structuredClone(room.cardLog);
    const n = room.actions.length;
    let undone = -1;
    for (let i = n - 1; i >= 0 && undone < 0; i--) {
      if (mod.undoActionAt(room, i).length === 0) undone = i;
    }
    assert.ok(undone >= 0, 'no action in this game could be undone — the case is untested');
    assert.equal(room.cardLog.length, room.actions.length);
    assert.deepEqual(room.cardLog.slice(0, undone), before.slice(0, undone));
    assert.ok(room.cardLog.slice(undone).every(f => f !== null));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
