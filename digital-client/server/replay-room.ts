/* Replay a saved game file through the CURRENT engine and report how
 * faithfully it reproduces — the review/verification tool for game logs.
 *
 *   node replay-room.ts games/GAXG.json          # summary + verdict
 *   node replay-room.ts games/GAXG.json --log    # + the full annotated event log
 *
 * A room file is {seed, mode, els, names, actions}: the complete game.
 * Replay is deterministic — same file + same engine = same game, always.
 * After ENGINE CHANGES a logged action can become illegal; the server's
 * tolerant restore silently skips those, but THIS tool reports every skip,
 * because a skipped action means the current engine disagrees with the game
 * as it was originally played — exactly what you want surfaced when
 * verifying rules questions after the fact.
 */
import { readFileSync } from 'node:fs';
import type { Action, Element, EngineEvent, GameMode } from '../engine/src/types.ts';
import { apply, createGame, sanitizeTrio, IllegalAction } from '../engine/src/apply.ts';

const file = process.argv[2];
const showLog = process.argv.includes('--log');
if (!file) {
  console.error('usage: node replay-room.ts games/<CODE>.json [--log]');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(file, 'utf8')) as {
  seed: number; mode?: GameMode; els?: Element[]; names?: [string, string]; actions: Action[];
};
const names = raw.names ?? ['Player 1', 'Player 2'];
const mode = raw.mode ?? 'shared';
const els = sanitizeTrio(raw.els);

function run(): { events: EngineEvent[]; skipped: { i: number; action: Action; why: string }[]; state: ReturnType<typeof createGame>['state'] } {
  let { state, events } = createGame(raw.seed, names, mode, els);
  const all = [...events];
  const skipped: { i: number; action: Action; why: string }[] = [];
  raw.actions.forEach((a, i) => {
    try {
      const r = apply(state, a);
      state = r.state;
      all.push(...r.events);
    } catch (err) {
      if (err instanceof IllegalAction) skipped.push({ i, action: a, why: err.message });
      else throw err;
    }
  });
  return { events: all, skipped, state };
}

const a = run();
const b = run();   // determinism double-check
const deterministic = JSON.stringify(a.state) === JSON.stringify(b.state);

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

if (a.skipped.length) {
  console.log('\n⚠ SKIPPED ACTIONS — the current engine rejects moves that were legal when played.');
  console.log('  Either an engine fix changed the rules since, or this log found a regression:');
  for (const sk of a.skipped) {
    console.log(`  [${sk.i}] ${JSON.stringify(sk.action)}\n      → ${sk.why}`);
  }
  process.exit(2);
}
console.log('\n✓ FAITHFUL: every logged action replays cleanly under the current engine.');
