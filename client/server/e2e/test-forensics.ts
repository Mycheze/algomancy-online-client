/* Are the saved game logs a reliable forensic record? (run: node test-forensics.ts)
 *
 * The playtest loop reviews bugs by replaying server/games/<CODE>.json. That
 * only works if the file's claim — seed + actions reproduces this game — is
 * either true or says why not. Game UZRG rejected 79 of its 276 actions when
 * replayed on the engine it was played on, and nothing in the file explained
 * it. (A restart no longer replays the log: a live room resumes from its
 * stored state, so the log is only ever read by the replay tools.)
 *
 * This drives a clean log, the guarantee that an undo can never quietly cost
 * somebody a move, the replay tool's refusals, and the engine stamps.
 *
 * Runs against a throwaway ALGO_GAMES_DIR — it never touches real games.
 */
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(tmpdir(), `algo-forensics-${process.pid}`);
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
process.env['ALGO_GAMES_DIR'] = DIR;

const { apply, createGame, forcedAction, legalActions, sanitizeTrio, IllegalAction } =
  await import('../../engine/src/apply.ts');
const { applyToRoom, createRoom, getRoom, restoreRooms, undoActionAt } = await import('../rooms.ts');
import type { Action, GameState } from '../../engine/src/types.ts';
// The version stamp (see replay-room.ts) is resolved once per process and cached, so a test
// that wants to pretend the engine moved has to be able to clear it. Imported
// BEFORE rooms.ts so the first stamp any room gets is one this file chose.
process.env['ALGO_ENGINE_VERSION'] = 'e'.repeat(40);
const { resetEngineVersionCache } = await import('../engine-version.ts');
import type { VersionStamp } from '../types.ts';
import type { Room } from '../rooms.ts';

const runningAt = (sha: string): void => {
  process.env['ALGO_ENGINE_VERSION'] = sha;
  resetEngineVersionCache();
};

let failures = 0;
const ok = (cond: unknown, label: string): void => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
};

const SEED = 424242;
const NAMES: [string, string] = ['Player 1', 'Player 2'];
const FILE = join(DIR, 'FORK.json');

/** apply + drain forced steps, exactly like main.ts */
function act(room: Room, a: Action): void {
  applyToRoom(room, a);
  for (let g = 0; g < 8; g++) {
    const f = forcedAction(room.state);
    if (!f) break;
    applyToRoom(room, f);
  }
}

/**
 * CR 504.5: the haste step is ALWAYS offered, so `donePlanning` from both seats
 * lands in it. Nothing closes it automatically — an automatic `doneHaste`
 * would say "this seat holds no haste play", which is the side channel the
 * always-offer-the-step ruling deleted — so a section that wants the next phase says so in both names.
 */
function passHaste(room: Room): void {
  for (const seat of [0, 1] as const) {
    if (room.state.hasteDone && !room.state.hasteDone[seat]) act(room, { type: 'doneHaste', seat });
  }
}

/** the mundane move for whichever step we are in */
function mundane(state: GameState, seat: 0 | 1): Action | null {
  const L = legalActions(state, seat);
  return L.find(x => x.type === 'recycleForResource')
    ?? L.find(x => x.type === 'activateResource')
    ?? L.find(x => x.type === 'donePlanning') ?? L.find(x => x.type === 'doneHaste')
    ?? L.find(x => x.type === 'declareAttack') ?? L.find(x => x.type === 'declareBlocks')
    ?? L.find(x => x.type === 'passPriority') ?? L.find(x => x.type === 'doneDeploying') ?? null;
}

/** replay a log from scratch the way replay-room.ts does */
function replay(actions: Action[]): { skips: number[]; state: GameState } {
  let st = createGame(SEED, NAMES, 'shared', sanitizeTrio(undefined)).state;
  const skips: number[] = [];
  actions.forEach((a, i) => {
    try { st = apply(st, a).state; }
    catch (err) { if (err instanceof IllegalAction) skips.push(i); else throw err; }
  });
  return { skips, state: st };
}

// ══ 1. a clean game is a faithful record ══════════════════════════════
console.log('\n[a clean log is a true record]');
const room = createRoom('FORK', SEED);
for (let i = 0; i < 200 && room.actions.length < 60; i++) {
  const a = mundane(room.state, 0) ?? mundane(room.state, 1);
  if (!a) break;
  act(room, a);
}
ok(room.actions.length >= 60, `played a clean game (${room.actions.length} actions, turn ${room.state.turn})`);
ok(replay(room.actions).skips.length === 0, 'every logged action replays');

// ══ 4. an undo can never silently cost somebody a move ════════════════
console.log('\n[undo measures, and rolls itself back]');
const u = createRoom('UNDO', SEED);
act(u, { type: 'donePlanning', seat: 0 });
act(u, { type: 'donePlanning', seat: 1 });
passHaste(u);                           // CR 504.5 — this section is about DEPLOYMENT
for (const s of [0, 1] as const) {
  u.state.players[s]!.resources.push({ kind: 'fire', state: 'open' });
  u.state.players[s]!.resources.push({ kind: 'fire', state: 'open' });
  u.state.players[s]!.hand.push('Ignis Sprite');
}
act(u, { type: 'playCard', seat: 1, handIndex: u.state.players[1]!.hand.length - 1 });
const theirPlay = u.actions.length - 1;
act(u, { type: 'playCard', seat: 0, handIndex: u.state.players[0]!.hand.length - 1 });
const myUnit = Object.values(u.state.entities).find(e => e.controller === 0 && e.kind === 'unit')!;
act(u, { type: 'doneDeploying', seat: 0 });
act(u, { type: 'doneDeploying', seat: 1 });
act(u, { type: 'donePlanning', seat: 0 });
act(u, { type: 'donePlanning', seat: 1 });
passHaste(u);                           // CR 504.5 — and this one about the BATTLE
// an action that names an ENTITY ID — the thing a renumbering breaks
const attack: Action = { type: 'declareAttack', seat: 0, columns: [[myUnit.id]] };
let attacked = false;
try { act(u, attack); attacked = true; } catch { /* not seat 0's declare */ }
ok(attacked, `logged an action naming entity ${myUnit.id} (${myUnit.card})`);
if (attacked) {
  // (the state itself cannot be compared here: this room was set up with
  // test-only injections that are not in the action log, so a rebuild can
  // never reproduce it. The log is what the roll-back has to protect, and the
  // clean-room case below checks state restoration properly.)
  const beforeLog = JSON.stringify(u.actions);
  const refused = undoActionAt(u, theirPlay);
  ok(refused.length > 0,
    'undoing an earlier play that would renumber it is REFUSED, not silently taken');
  ok(JSON.stringify(u.actions) === beforeLog,
    'and the log is put back exactly as it was — nothing was spliced out');
  ok(u.actions[theirPlay]!.type === 'playCard', 'the action it tried to remove is still there');
}

// ══ 5. an ordinary undo keeps the log a true record ═══════════════════
console.log('\n[an accepted undo leaves a replayable log]');
const c = createRoom('CLEAN', SEED);
for (let i = 0; i < 40 && c.actions.length < 12; i++) {
  const a = mundane(c.state, 0) ?? mundane(c.state, 1);
  if (!a) break;
  act(c, a);
}
const beforeLen = c.actions.length;
const beforeState = JSON.stringify(c.state);
const accepted = undoActionAt(c, beforeLen - 1);
ok(accepted.length === 0, 'undoing the tail is accepted');
ok(c.actions.length === beforeLen - 1, 'the action left the log');
ok(JSON.stringify(c.state) !== beforeState, 'and the state moved back with it');
ok(replay(c.actions).skips.length === 0, 'the log still replays with zero skips');

/* ── the replay tool must REFUSE a file it cannot faithfully reproduce ──
 *
 * Two silent substitutions used to make `replay-room.ts` answer confidently
 * about a game nobody had played. Both are the same shape and both are the
 * worst possible failure in a forensics tool, because this repo settles real
 * playtest reports by replaying these files.
 *
 *  (a) `decksOf` fell back to the OTHER SEAT'S DECK when one failed checkDeck.
 *      One card rename away from firing: checkDeck rejects unknown names, and
 *      3063f2b renamed "Counter Theif" -> "Counter Thief". A stored deck with
 *      the old spelling would have replayed all eight constructed logs with
 *      BOTH SEATS ON ONE DECK, reported as a mystery midgame divergence.
 *  (b) a draft file with no recorded `els` got `sanitizeTrio`'s default trio,
 *      so the whole deal was guessed. GAXG and HDGG (saved before a890788) are
 *      in this state; GAXG dies at [10] blaming the engine for a missing field.
 */
/** a deck the real `checkDeck` accepts: 30+ cards from the scripted pool, no
 *  more than 2 of any one. Built from the pool rather than hand-listed so a
 *  pool change cannot silently turn this control into an invalid deck. */
function validDeck(): string[] {
  const out: string[] = [];
  for (const n of DECK_LIST) { out.push(n, n); if (out.length >= 30) break; }
  return out;
}

console.log('\n[the replay tool refuses a file it cannot reproduce]');
{
  const rr = join(HERE, '..', 'replay-room.ts');
  const run = (file: string): { code: number | null; err: string } => {
    const r = spawnSync(process.execPath, [rr, file], { encoding: 'utf8' });
    return { code: r.status, err: (r.stderr ?? '') + (r.stdout ?? '') };
  };
  const write = (name: string, obj: unknown): string => {
    const f = join(DIR, name); writeFileSync(f, JSON.stringify(obj)); return f;
  };

  // (a) seat 0's deck is junk, seat 1's is fine — the substitution case.
  // ⚠ The first version of this fixture used 30 copies of one card, which fails
  // checkDeck's max-2-copies rule — so BOTH decks were bad, the old code threw
  // on that path anyway, and the red-check refused to go red. The fixture was
  // wrong, not the fix. A valid deck has to come from the real pool.
  const goodDeck = validDeck();
  const badDecks = run(write('BADDECK.json', {
    seed: 1, mode: 'constructed', names: ['A', 'B'], actions: [],
    decks: [['No Such Card Exists'], goodDeck],
  }));
  ok(badDecks.code !== 0, 'a constructed file with one unusable deck is REFUSED, not substituted');
  ok(/seat 0/.test(badDecks.err), 'and the refusal names WHICH seat has the bad deck');

  // (b) a draft file with no recorded trio — the guessed-deal case
  const noTrio = run(write('NOTRIO.json', { seed: 1, mode: 'draft', names: ['A', 'B'], actions: [] }));
  ok(noTrio.code !== 0, 'a draft file with no recorded element trio is REFUSED, not guessed');
  ok(/els/.test(noTrio.err), 'and the refusal names the missing field rather than blaming the engine');

  // THE CONTROL. A well-formed file must still be ANALYSED — that is what
  // makes the two refusals above targeted rather than the tool having stopped
  // working. Asserted on the report, not on the exit code, which says whether
  // the replay is faithful — a different question.
  const fine = run(FILE);
  ok(/actions logged/.test(fine.err),
    'a well-formed game file is still analysed and reported on — the refusals are targeted');
  ok(!/cannot be replayed|recorded no element trio/.test(fine.err),
    'and it is not caught by either refusal');
}

/* ── CT-66 (see replay-room.ts): the file names the engine that recorded it ──────────
 *
 * The corpus's problem is not that the logs are wrong. Every divergence anyone
 * has chased is a DELIBERATE rules change and none is a regression — the logs
 * are sound and the READER moved. A file that does not say which engine wrote
 * it cannot say that for itself, so replaying it months later reports the
 * difference as if the file were at fault.
 *
 * ⚠ ONE STAMP PER FILE IS NOT ENOUGH. A forked file is two games recorded
 * against two engines (game VEAV is exactly this), so the stamp is a LEDGER:
 * one entry per engine, each naming the action index it took over at.
 */
console.log('\n[a new game is stamped with the engine that is recording it]');
const ENGINE_1 = 'e'.repeat(40);
const ENGINE_2 = 'f'.repeat(40);
{
  runningAt(ENGINE_1);
  const v = createRoom('VSTAMP', SEED);
  ok(v.versions.length === 1, 'a new room carries exactly one version stamp');
  ok(v.versions[0]!.sha === ENGINE_1, 'and it names the engine the server is running');
  ok(v.versions[0]!.from === 0, 'covering the log from action 0 — the whole game so far');
  const onDisk = JSON.parse(readFileSync(join(DIR, 'VSTAMP.json'), 'utf8')) as { versions?: VersionStamp[] };
  ok(Array.isArray(onDisk.versions) && onDisk.versions.length === 1,
    'and it is in the FILE, not just in memory — a stamp that never persists decodes nothing');
  ok(onDisk.versions![0]!.sha === ENGINE_1, 'with the same commit on disk as in the room');
}

console.log('\n[a redeploy under a LIVE game stamps the boundary, whether or not anything was lost]');
{
  runningAt(ENGINE_1);
  const g = createRoom('VLIVE', SEED);
  for (let i = 0; i < 60 && g.actions.length < 20; i++) {
    const a = mundane(g.state, 0) ?? mundane(g.state, 1);
    if (!a) break;
    act(g, a);
  }
  const played = g.actions.length;
  ok(played >= 20, `played ${played} actions under ${ENGINE_1.slice(0, 6)}`);

  // the server restarts on the SAME commit: that is not a boundary
  restoreRooms();
  ok(getRoom('VLIVE')!.versions.length === 1,
    'restarting on the same commit does NOT add a stamp — the deploy box restarts constantly');

  // now it restarts on a DIFFERENT commit, losing nothing at all. This is the
  // case that used to leave no trace whatsoever: a rules change that costs no
  // action still changes what every action after it means.
  runningAt(ENGINE_2);
  restoreRooms();
  const v2 = getRoom('VLIVE')!;
  ok(v2.versions.length === 2, 'and the engine change is STILL stamped, because play continues under it');
  ok(v2.versions[1]!.sha === ENGINE_2, 'naming the new commit');
  ok(v2.versions[1]!.from === played,
    `and the exact action the new engine took over at (${played})`);
  const disk = JSON.parse(readFileSync(join(DIR, 'VLIVE.json'), 'utf8')) as { versions?: VersionStamp[] };
  ok(disk.versions?.length === 2, 'persisted, so the boundary survives the next restart');

  restoreRooms();
  ok(getRoom('VLIVE')!.versions.length === 2,
    'and restarting again on the same commit does not add a third — idempotent');
}

console.log('\n[a file written before the stamp existed still loads — the deploy is additive]');
{
  runningAt(ENGINE_1);
  const o = createRoom('VOLD', SEED);
  for (let i = 0; i < 60 && o.actions.length < 12; i++) {
    const a = mundane(o.state, 0) ?? mundane(o.state, 1);
    if (!a) break;
    act(o, a);
  }
  const beforeLen = o.actions.length;
  // strip the field, exactly as every file on the deploy box looks today
  const raw2 = JSON.parse(readFileSync(join(DIR, 'VOLD.json'), 'utf8')) as Record<string, unknown>;
  delete raw2['versions'];
  writeFileSync(join(DIR, 'VOLD.json'), JSON.stringify(raw2));

  restoreRooms();
  const o2 = getRoom('VOLD');
  ok(!!o2, 'a room file with no `versions` field restores exactly as it always did');
  ok(o2!.actions.length === beforeLen, 'with its whole log intact');
  // ⚠ AND IT IS NOT BACKDATED. Stamping the CURRENT commit at `from: 0` over a
  // log an older engine wrote would send --as-recorded to the wrong rules and
  // report the mismatch as a rules change. The truthful statement is "from
  // HERE on, this engine".
  ok(o2!.versions.length === 1 && o2!.versions[0]!.from === beforeLen,
    'and its first stamp starts where the unstamped log ENDS — never backdated to action 0');
}


console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
rmSync(DIR, { recursive: true, force: true });
void HERE;
process.exit(failures ? 1 : 0);
