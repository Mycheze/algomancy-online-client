/* Replay a saved game file through the CURRENT engine and report how
 * faithfully it reproduces — the review/verification tool for game logs.
 *
 *   node replay-room.ts games/GAXG.json          # summary + verdict
 *   node replay-room.ts games/GAXG.json --log    # + the full annotated event log
 *
 * A room file is a CLAIM: seed + actions reproduces this game. Replay is
 * deterministic (the engine is pure — no Math.random, no Date.now), so the
 * claim is checkable, and this is the thing that checks it.
 *
 * There are two completely different reasons a replay can come up short, and
 * telling them apart is the whole point of this tool:
 *
 *   ENGINE DRIFT   the rules changed since the game was played, so the current
 *                  engine refuses moves that were legal at the time. Expected
 *                  after a rules commit. The FILE is fine; it is a true record
 *                  of a game this engine would no longer allow.
 *
 *   FORK           the server restarted mid-game onto a changed engine, could
 *                  not replay part of the log, rebuilt the game without those
 *                  actions, and play then CONTINUED from the rebuilt board.
 *                  The log is two different games end to end. rooms.ts records
 *                  this in the file as it happens (`forks`), so it is a fact
 *                  stated by the file rather than something you have to infer
 *                  from a pile of rejections.
 *
 * Before `forks` existed the two presented identically — a heap of skips —
 * which is exactly how playtest game UZRG came to reject 79 of its 276 actions
 * with nobody noticing for weeks.
 */
import { readFileSync } from 'node:fs';
import type { Action, CardName, Element, EngineEvent, GameMode, Seat } from '../engine/src/types.ts';
import { apply, checkDeck, createGame, sanitizeTrio, IllegalAction } from '../engine/src/apply.ts';
import type { Fork, LostAction } from './rooms.ts';

const file = process.argv[2];
const showLog = process.argv.includes('--log');
if (!file) {
  console.error('usage: node replay-room.ts games/<CODE>.json [--log]');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(file, 'utf8')) as {
  seed: number; mode?: GameMode; els?: Element[]; names?: [string, string]; actions: Action[];
  winner?: number | null; forks?: Fork[];
  decks?: [CardName[] | null, CardName[] | null];
};
const names = raw.names ?? ['Player 1', 'Player 2'];
const mode = raw.mode ?? 'shared';
const els = sanitizeTrio(raw.els);
const declared: Fork[] = Array.isArray(raw.forks) ? raw.forks : [];

/** constructed games are dealt from the two saved decks — replaying one
 * without them is not a replay of the same game at all */
function decksOf(): [CardName[], CardName[]] | undefined {
  if (mode !== 'constructed') return undefined;
  const ok = [0, 1].map(s => checkDeck(raw.decks?.[s as 0 | 1]));
  const a = ok[0]!.ok ? ok[0]!.cards : ok[1]!.ok ? ok[1]!.cards : null;
  const b = ok[1]!.ok ? ok[1]!.cards : a;
  if (!a || !b) throw new Error('constructed game file has no usable deck');
  return [a, b];
}

function run(): { events: EngineEvent[]; skipped: LostAction[]; state: ReturnType<typeof createGame>['state'] } {
  let { state, events } = createGame(raw.seed, names, mode, els, decksOf());
  const all = [...events];
  const skipped: LostAction[] = [];
  raw.actions.forEach((a, i) => {
    try {
      const r = apply(state, a);
      state = r.state;
      all.push(...r.events);
    } catch (err) {
      if (err instanceof IllegalAction) skipped.push({ i, type: a.type, seat: a.seat as Seat, why: err.message });
      else throw err;
    }
  });
  return { events: all, skipped, state };
}

const a = run();
const b = run();   // determinism double-check
const deterministic = JSON.stringify(a.state) === JSON.stringify(b.state);

const declaredLost = declared.flatMap(f => f.lost ?? []);
const declaredIdx = new Set(declaredLost.map(l => l.i));
const todayIdx = new Set(a.skipped.map(l => l.i));
/** a declared fork this engine can no longer reproduce */
const unexplained = [...declaredIdx].filter(i => !todayIdx.has(i));
/** skips beyond what the file already admits to */
const extra = a.skipped.filter(l => !declaredIdx.has(l.i));

console.log(`\n═ ${file}`);
console.log(`  mode ${mode}${mode === 'draft' ? ` · trio ${els.join('+')}` : ''} · seed ${raw.seed} · ${names.join(' vs ')}`);
console.log(`  ${raw.actions.length} actions logged, ${raw.actions.length - a.skipped.length} replayed, ${a.skipped.length} skipped`);
console.log(`  determinism: ${deterministic ? 'OK (two runs identical)' : '⚠ DIVERGED — engine bug, report this'}`);

if (showLog) {
  console.log('\n── game log ──');
  for (const ev of a.events) console.log('  ' + ev.msg);
}

const s = a.state;
console.log('\n── final position ──');
console.log(`  turn ${s.turn} · phase ${s.phase}${s.winner !== null ? ` · WINNER: ${names[s.winner]}` : ''}`);
s.players.forEach(p => console.log(
  `  ${p.name}: ${p.life} life · ${p.hand.length} in hand · ${p.bin.length} in bin · ${p.resources.length} resources`));
const units = Object.values(s.entities).filter(e => e.kind === 'unit');
console.log(`  units in play: ${units.map(u => `${u.card} (${names[u.controller]})`).join(', ') || 'none'}`);

// ── what the file says about itself ──────────────────────────────────
if (declared.length) {
  console.log('\n── this file declares that it FORKED ──');
  console.log('  The server restarted mid-game onto an engine that could not replay');
  console.log('  part of the log, rebuilt the game without those actions, and play');
  console.log('  continued from there. The log below is not one game end to end.');
  for (const f of declared) {
    console.log(`  · ${f.at}: ${f.lost.length} of ${f.logged} actions could not be replayed;`);
    console.log(`      the game resumed at turn ${f.turn} ${f.phase}`);
    const byType = new Map<string, number>();
    for (const l of f.lost) byType.set(l.type, (byType.get(l.type) ?? 0) + 1);
    console.log(`      lost: ${[...byType].map(([t, n]) => `${n}× ${t}`).join(', ')}`);
    console.log(`      first at action ${f.lost[0]?.i} — "${f.lost[0]?.why}"`);
  }
}

// ── the verdict ──────────────────────────────────────────────────────
console.log('\n── verdict ──');

function listSkips(list: LostAction[], limit = 20): void {
  for (const sk of list.slice(0, limit)) {
    console.log(`  [${sk.i}] ${sk.type} (seat ${sk.seat})\n      → ${sk.why}`);
  }
  if (list.length > limit) console.log(`  … and ${list.length - limit} more`);
}

let exit = 0;

if (unexplained.length) {
  // The file claims actions could not be replayed that THIS engine accepts.
  // Nothing the server does can produce that: it means the engine moved back
  // under the file (a rules commit reverted), or the file has been edited.
  console.log('  ⚠ INCONSISTENT — the file declares forks this engine cannot reproduce.');
  console.log(`    ${unexplained.length} action(s) recorded as unreplayable now replay fine:`);
  console.log(`    indices ${unexplained.slice(0, 20).join(', ')}${unexplained.length > 20 ? ' …' : ''}`);
  console.log('    Either a rules change was reverted (re-check the fork against the');
  console.log('    engine it was recorded on) or this file has been hand-edited.');
  exit = 3;
} else if (declared.length && !extra.length) {
  console.log('  ⚠ FORKED, and the file\'s own account of itself checks out.');
  console.log(`    Every one of the ${a.skipped.length} skips above is a fork this file already`);
  console.log('    declares. Not a server bug: the game was interrupted by a rules');
  console.log('    change and rebuilt. Read the two halves as separate games.');
  exit = 2;
} else if (declared.length && extra.length) {
  console.log('  ⚠ FORKED, and the engine has drifted FURTHER since.');
  console.log(`    ${declaredLost.length} skip(s) are declared forks; ${extra.length} more are new:`);
  listSkips(extra);
  exit = 2;
} else if (a.skipped.length) {
  console.log('  ⚠ ENGINE DRIFT — the current engine rejects moves that were legal');
  console.log('    when this game was played. The FILE is fine: it is a true record');
  console.log('    of the game, and the rules have changed under it since. Expected');
  console.log('    after a rules commit; a surprise otherwise, and then this log has');
  console.log('    found you a regression.');
  console.log(`    ${a.skipped.length} of ${raw.actions.length} actions:`);
  listSkips(a.skipped);
  exit = 2;
} else {
  console.log('  ✓ FAITHFUL — every logged action replays cleanly under the current');
  console.log('    engine, and the file declares no forks. seed + actions reproduces');
  console.log('    this game exactly.');
}

if (!deterministic) exit = 3;
process.exit(exit);
