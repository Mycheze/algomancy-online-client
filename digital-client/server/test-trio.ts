/* Trio selection over the wire (run: node test-trio.ts): a join with
 * els creates the room with that trio; persistence records it; a joiner
 * without els lands in the same trio; bad trios sanitize to the default. */
import { readFileSync, rmSync } from 'node:fs';
import { gameFile, mintRoom, spawnServer } from './test-util.ts';

// minted from /api/new once the server is up: only a server-minted code may
// create a room (rooms.ts)
let ROOM = '';
let ROOM2 = '';

let failures = 0;
const ok = (cond: unknown, label: string): void => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
};

function joinRoom(room: string, seat: number, els?: string[]): Promise<any> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'join', room, seat, els, mode: 'draft' })));
    ws.addEventListener('message', ev => {
      const m = JSON.parse(String((ev as MessageEvent).data));
      if (m.t === 'joined') { res({ view: m.view, ws }); }
    });
    setTimeout(() => rej(new Error('join timeout')), 8000);
  });
}

// R204/CT-85: the server picks its own port and tells us which — see
// test-util.ts. It used to be `freePort()` then PORT=<number>, which left the
// port unheld for as long as node took to boot.
const server = await spawnServer();
const PORT = server.port;
ROOM = await mintRoom(PORT);
ROOM2 = await mintRoom(PORT);

try {
  console.log('\n[trio selection]');
  const a = await joinRoom(ROOM, 0, ['metal', 'fire', 'wood']);
  ok(JSON.stringify(a.view.elements) === JSON.stringify(['fire', 'wood', 'metal']),
    `creator's trio honored, canonical order (got ${a.view.elements})`);
  const b = await joinRoom(ROOM, 1);   // no els — room exists
  ok(JSON.stringify(b.view.elements) === JSON.stringify(['fire', 'wood', 'metal']),
    'joiner lands in the same trio');
  const raw = JSON.parse(readFileSync(gameFile(ROOM), 'utf8'));
  ok(JSON.stringify(raw.els) === JSON.stringify(['fire', 'wood', 'metal']), 'room file records els');
  const c = await joinRoom(ROOM2, 0, ['fire', 'fire', 'plasma']);
  ok(JSON.stringify(c.view.elements) === JSON.stringify(['fire', 'water', 'earth']),
    'nonsense trio sanitizes to the default');
  a.ws.close(); b.ws.close(); c.ws.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
} finally {
  await server.stop();
  rmSync(gameFile(ROOM), { force: true });
  rmSync(gameFile(ROOM2), { force: true });
}
process.exit(failures ? 1 : 0);
