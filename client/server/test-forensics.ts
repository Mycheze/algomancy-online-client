/* Are the saved game logs a reliable forensic record? (run: node test-forensics.ts)
 *
 * The playtest loop reviews bugs by replaying server/games/<CODE>.json. That
 * only works if the file's claim — seed + actions reproduces this game — is
 * either true or says why not. Game UZRG rejected 79 of its 276 actions when
 * replayed on the engine it was played on, and nothing in the file explained
 * it.
 *
 * This drives the whole failure: a live room restored onto a changed engine,
 * the cascade one skip causes, the fork record that now marks it, and the
 * guarantee that an undo can never quietly cost somebody a move.
 *
 * Runs against a throwaway ALGO_GAMES_DIR — it never touches real games.
 */
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DECK_LIST } from '../engine/src/cards/registry.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(tmpdir(), `algo-forensics-${process.pid}`);
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
process.env['ALGO_GAMES_DIR'] = DIR;

const { apply, createGame, forcedAction, legalActions, sanitizeTrio, IllegalAction } =
  await import('../engine/src/apply.ts');
const { applyToRoom, createRoom, getRoom, restoreRooms, undoActionAt } = await import('./rooms.ts');
import type { Action, GameState } from '../engine/src/types.ts';
// R200: the version stamp is resolved once per process and cached, so a test
// that wants to pretend the engine moved has to be able to clear it. Imported
// BEFORE rooms.ts so the first stamp any room gets is one this file chose.
process.env['ALGO_ENGINE_VERSION'] = 'e'.repeat(40);
const { resetEngineVersionCache } = await import('./engine-version.ts');
import type { VersionStamp } from './types.ts';
import type { Room } from './rooms.ts';

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
 * R228: the haste step is ALWAYS offered, so `donePlanning` from both seats
 * lands in it. Nothing closes it automatically — an automatic `doneHaste`
 * would say "this seat holds no haste play", which is the side channel R224
 * deleted — so a section that wants the next phase says so in both names.
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
ok(room.forks.length === 0 && room.lost.length === 0, 'and the room declares no fork');
ok(!('forks' in JSON.parse(readFileSync(FILE, 'utf8'))), 'the file carries no fork field');
const cleanTurn = room.state.turn, cleanLen = room.actions.length;

// ══ 2. a rules change under a LIVE room: the cascade ══════════════════
console.log('\n[a rules change under a live room]');
// simulate one action becoming illegal — which is all an engine change looks
// like from rebuild()'s side: apply() throws IllegalAction at some index
const raw = JSON.parse(readFileSync(FILE, 'utf8')) as { actions: Action[] };
const victim = raw.actions.findIndex(a => a.type === 'donePlanning');
raw.actions[victim] = { type: 'activateResource', seat: raw.actions[victim]!.seat, index: 99 };
writeFileSync(FILE, JSON.stringify(raw));
const cascade = replay(raw.actions).skips.length;
ok(cascade > 1, `ONE action becoming illegal cascades into ${cascade} of ${cleanLen} rejections`);

console.log('\n[the restore records the fork instead of degrading quietly]');
restoreRooms();
const r2 = getRoom('FORK')!;
ok(!!r2, 'the live game SURVIVED the restart — it is not lost, which is the point');
ok(r2.actions.length === cleanLen, 'nothing was pruned: the log is still the whole record');
ok(r2.lost.length === cascade, `the room knows it lost ${r2.lost.length} actions`);
ok(r2.state.turn < cleanTurn, `and that the game rolled back (turn ${cleanTurn} → ${r2.state.turn})`);
ok(r2.forks.length === 1, 'exactly one fork was recorded');
ok(r2.forks[0]!.lost.length === cascade && r2.forks[0]!.turn === r2.state.turn,
  'the fork records what was lost and where the game resumed');
ok(typeof r2.forks[0]!.at === 'string' && !Number.isNaN(Date.parse(r2.forks[0]!.at)),
  'stamped with when it happened');
const saved = JSON.parse(readFileSync(FILE, 'utf8')) as { forks?: unknown[] };
ok(Array.isArray(saved.forks) && saved.forks.length === 1, 'and it is in the FILE, not just in memory');
ok(r2.events.some(e => /could not be fully restored/.test(e.msg)),
  'the players are told, in the game log they can actually see');

console.log('\n[play continues, and the boundary is marked]');
const next = mundane(r2.state, 0) ?? mundane(r2.state, 1);
ok(!!next, 'the rebuilt board is playable');
if (next) {
  act(r2, next);
  ok(r2.actions.length === cleanLen + 1, 'the new action was accepted and logged');
  const after = JSON.parse(readFileSync(FILE, 'utf8')) as { actions: Action[]; forks: unknown[] };
  ok(after.actions.length === cleanLen + 1 && after.forks.length === 1,
    'the file holds both halves AND the record of where they join');
}

console.log('\n[restarting again does not invent a second fork]');
restoreRooms();
const r3 = getRoom('FORK')!;
ok(r3.forks.length === 1, 'the same loss under the same engine is ONE fork, not one per boot');

// ══ 3. a FINISHED game is left alone ══════════════════════════════════
console.log('\n[a finished game is read-only forensics, not a fork]');
// (the ~650 "replay skipped" warnings on a real boot are these; recording a
// fork for each would rewrite hundreds of settled files every restart)
const done = createRoom('DONE', SEED);
act(done, { type: 'concede', seat: 1 });
const doneRaw = JSON.parse(readFileSync(join(DIR, 'DONE.json'), 'utf8')) as { actions: Action[] };
doneRaw.actions.unshift({ type: 'activateResource', seat: 0, index: 99 });
writeFileSync(join(DIR, 'DONE.json'), JSON.stringify(doneRaw));
restoreRooms();
const d2 = getRoom('DONE')!;
ok(d2.lost.length > 0, 'its log does not fully replay');
ok(d2.forks.length === 0, 'but no fork is recorded — nobody is going to play into it');
ok(!('forks' in (JSON.parse(readFileSync(join(DIR, 'DONE.json'), 'utf8')) as object)),
  'and its file was not rewritten');

// ══ 4. an undo can never silently cost somebody a move ════════════════
console.log('\n[undo measures, and rolls itself back]');
const u = createRoom('UNDO', SEED);
act(u, { type: 'donePlanning', seat: 0 });
act(u, { type: 'donePlanning', seat: 1 });
passHaste(u);                           // R228 — this section is about DEPLOYMENT
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
passHaste(u);                           // R228 — and this one about the BATTLE
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
  ok(u.forks.length === 0, 'no fork: nothing was lost, because nothing was dropped');
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
ok(c.lost.length === 0 && c.forks.length === 0, 'and the room is still fork-free');

/* ── R186: the replay tool must REFUSE a file it cannot faithfully reproduce ──
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
  const rr = join(HERE, 'replay-room.ts');
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

  // THE CONTROL, and it took two goes to state correctly. A well-formed file
  // must still be ANALYSED — that is what makes the two refusals above targeted
  // rather than the tool having stopped working. It must NOT be "exit code 0":
  // FORK.json is deliberately divergent, so a non-zero exit is the right answer
  // for it, and asserting 0 made this control fail for the one reason that has
  // nothing to do with what it is controlling for.
  const fine = run(FILE);
  ok(/actions logged/.test(fine.err),
    'a well-formed game file is still analysed and reported on — the refusals are targeted');
  ok(!/cannot be replayed|recorded no element trio/.test(fine.err),
    'and it is not caught by either refusal');
}

/* ── R191 (CARD-TODO #67c): THE FORK THAT REFUSES NOTHING ─────────────────
 *
 * Everything above this line is about a restore that LOSES actions. The
 * quieter half had no record at all: an engine that ACCEPTS every logged
 * action while producing a different board leaves a skip list of length zero,
 * so `recordFork` declined to record anything and the file went on claiming to
 * be a straight-through account of a game it no longer describes. That is the
 * worse of the two, because a refusal at least announces itself.
 *
 * `LostAction.kind` has always had a `'changed'` arm for it and the restore
 * path only ever pushed `'lost'`. It is measured now, the same way
 * `undoActionAt` measures its own splice: `persist` writes each action's
 * REFERENCE KEY (what it referred to when it was taken) and a restore compares.
 *
 * THE FIXTURE. A different deal is what a rules change looks like from an
 * action log's side — the actions are all still legal (hand indices, resource
 * indices, "done" barriers), they simply name other cards. Re-seeding the file
 * is the cheapest honest way to produce exactly that: nothing is refused, and
 * everything means something else. If the re-seed ever starts REFUSING an
 * action, the first assertion below fails and says so rather than passing for
 * the wrong reason.
 */
console.log('\n[a restart that changes the board without refusing an action]');
const DRIFT_FILE = join(DIR, 'DRIFT.json');
const drift = createRoom('DRIFT', SEED);
for (let i = 0; i < 200 && drift.actions.length < 40; i++) {
  const a = mundane(drift.state, 0) ?? mundane(drift.state, 1);
  if (!a) break;
  act(drift, a);
}
ok(drift.actions.length >= 40, `played a clean game (${drift.actions.length} actions)`);
ok(drift.drifted.length === 0 && drift.forks.length === 0, 'nothing has drifted yet');
{
  const rawD = JSON.parse(readFileSync(DRIFT_FILE, 'utf8')) as { seed: number; refs?: unknown };
  ok(Array.isArray(rawD.refs) && rawD.refs.length === drift.actions.length,
    'the file records what each action MEANT when it was taken — one key per action');
  rawD.seed = SEED + 1;                       // the same log, a different board
  writeFileSync(DRIFT_FILE, JSON.stringify(rawD));
}
restoreRooms();
const d3 = getRoom('DRIFT')!;
ok(d3.lost.length === 0,
  'the rebuild refused NOTHING — every logged action still replays (the premise of this case)');
ok(d3.drifted.length > 0,
  `and yet ${d3.drifted.length} of them no longer mean what they meant — the silent divergence`);
ok(d3.drifted.every(l => l.kind === 'changed'),
  "recorded under kind 'changed', which is the arm that had never been reachable");
ok(d3.forks.length === 1, 'a fork IS recorded for a restore that refused nothing');
ok(!!d3.forks[0]?.lost.some(l => l.kind === 'changed'),
  'and the fork carries the changed entries, so the file admits to them');
ok(d3.events.some(e => /refer to something else/.test(e.msg) && !/no longer replay/.test(e.msg)),
  'the players are told the truth about it: not "actions were dropped", but "they mean something else"');
{
  const savedD = JSON.parse(readFileSync(DRIFT_FILE, 'utf8')) as { forks?: unknown[] };
  ok(Array.isArray(savedD.forks) && savedD.forks.length === 1,
    'and it is in the FILE, not just in memory');
}
restoreRooms();
ok(getRoom('DRIFT')!.forks.length === 1,
  'restoring again does not invent a second fork — the keys were rewritten with the record');

console.log('\n[a file that never recorded what its actions meant is not accused of drift]');
{
  // The additive-field case, and the one that must stay silent: every game
  // saved before R191 has no `refs`, and "I cannot tell" is not "it drifted".
  const old = JSON.parse(readFileSync(join(DIR, 'CLEAN.json'), 'utf8')) as { refs?: unknown };
  delete old.refs;
  writeFileSync(join(DIR, 'CLEAN.json'), JSON.stringify(old));
  restoreRooms();
  const c2 = getRoom('CLEAN')!;
  ok(c2.drifted.length === 0, 'no keys on disk, no drift reported');
  ok(c2.forks.length === 0, 'and no fork invented for a file that simply predates the field');
}

/* ── R200 / CT-66: the file names the engine that recorded it ──────────
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
console.log('\n[R200: a new game is stamped with the engine that is recording it]');
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

console.log('\n[R200: a redeploy under a LIVE game stamps the boundary, whether or not anything was lost]');
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
  ok(v2.lost.length === 0, 'this rebuild lost nothing — every logged action still replays');
  ok(v2.versions.length === 2, 'and the engine change is STILL stamped, because play continues under it');
  ok(v2.versions[1]!.sha === ENGINE_2, 'naming the new commit');
  ok(v2.versions[1]!.from === played,
    `and the exact action the new engine took over at (${played})`);
  const disk = JSON.parse(readFileSync(join(DIR, 'VLIVE.json'), 'utf8')) as { versions?: VersionStamp[] };
  ok(disk.versions?.length === 2, 'persisted, so the boundary survives the next restart');

  restoreRooms();
  ok(getRoom('VLIVE')!.versions.length === 2,
    'and restarting again on the same commit does not add a third — idempotent, like recordFork');
}

console.log('\n[R200: a FORK names the engine that refused, so the fork record reads standalone]');
{
  runningAt(ENGINE_1);
  const f = createRoom('VFORK', SEED);
  for (let i = 0; i < 200 && f.actions.length < 40; i++) {
    const a = mundane(f.state, 0) ?? mundane(f.state, 1);
    if (!a) break;
    act(f, a);
  }
  const len = f.actions.length;
  // one action becomes illegal, which is all an engine change looks like from
  // rebuild()'s side
  const fRaw = JSON.parse(readFileSync(join(DIR, 'VFORK.json'), 'utf8')) as { actions: Action[] };
  const vict = fRaw.actions.findIndex(a => a.type === 'donePlanning');
  fRaw.actions[vict] = { type: 'activateResource', seat: fRaw.actions[vict]!.seat, index: 99 };
  writeFileSync(join(DIR, 'VFORK.json'), JSON.stringify(fRaw));

  runningAt(ENGINE_2);
  restoreRooms();
  const f2 = getRoom('VFORK')!;
  ok(f2.forks.length === 1, 'the restore recorded a fork');
  ok(f2.forks[0]!.engineVersion === ENGINE_2,
    'and the fork names the engine that REFUSED those actions — not the one that wrote them');
  const stamp = f2.versions[f2.versions.length - 1]!;
  ok(stamp.sha === ENGINE_2 && stamp.from === f2.forks[0]!.logged,
    'and the version stamp and the fork agree on where the join is, so nothing has to be inferred');
  ok(len === f2.forks[0]!.logged, `both point at action ${len}`);
}

console.log('\n[R200: a file written before the stamp existed still loads — the deploy is additive]');
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
