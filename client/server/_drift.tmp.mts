const WT = '/home/bena/Documents/Algomancy/.claude/worktrees/replay';
process.env['ALGO_GAMES_DIR'] = `${WT}/var/dev/games`;
import { readFileSync } from 'node:fs';
const raw = JSON.parse(readFileSync(`${WT}/var/dev/games/OLDG.json`, 'utf8')) as
  { refs?: string[]; actions: unknown[] };
console.log('saved refs:', raw.refs?.length, 'actions:', raw.actions.length);
const { restoreRooms, getRoom } = await import('./rooms.ts');
restoreRooms();
const r = getRoom('OLDG')!;
console.log('drifted entries:', r.drifted.length, 'lost:', r.lost.length);
for (const d of r.drifted.slice(0, 3)) console.log('  ', JSON.stringify(d));
const saved = raw.refs ?? [];
const now = r.segRefs;
for (let i = 0; i < Math.min(saved.length, now.length); i++) {
  if (saved[i] !== now[i]) {
    console.log(`first differing ref at [${i}] (${(r.actions[i] as {type:string}).type}):`);
    console.log('  saved:', saved[i]);
    console.log('  now  :', now[i]);
    break;
  }
}
