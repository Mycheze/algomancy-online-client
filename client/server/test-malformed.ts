/* HOSTILE INPUT: the server must survive what a stranger can send it. (run: node test-malformed.ts)
 *
 * Every other script in this directory drives the server the way the client
 * does. None of them ever sent it something WRONG, and three one-line ways to
 * end the process from an anonymous connection sat in code the suite exercises
 * on every run:
 *
 *   - a WebSocket frame containing `null` — JSON.parse succeeds, `msg.t` throws
 *     inside a 'message' listener, and that is an uncaughtException
 *   - `GET /%` — decodeURIComponent throws URIError inside an async request
 *     handler with nothing around it, and that is an unhandled rejection
 *   - a Host header with a space — `new URL()` throws the same way
 *
 * The assertion that matters in every section is the last one: THE PROCESS IS
 * STILL THERE. Everything else is the shape of the refusal.
 *
 * §1 WebSocket frames that are not a message object
 * §2 an oversize frame is closed, not parsed
 * §3 HTTP requests the URL parser rejects
 * §4 a foreign Origin may not open a socket; no Origin at all may
 */
import { connect } from 'node:net';
import { spawnServer } from './test-util.ts';

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

const server = await spawnServer();
const PORT = server.port;
const alive = (): boolean => server.proc.exitCode === null && server.proc.signalCode === null;

async function httpOk(): Promise<boolean> {
  try { return (await fetch(`http://localhost:${PORT}/api/queue`)).status === 200; }
  catch { return false; }
}

interface Msg { t: string; [k: string]: unknown }
function openSocket(headers?: Record<string, string>): Promise<{ ws: WebSocket; msgs: Msg[]; closed: Promise<number> }> {
  return new Promise((res, rej) => {
    // Node's WebSocket cannot set Origin; ws's client can, and it is already a
    // dependency here
    const ws = new WebSocket(`ws://localhost:${PORT}`, headers ? { headers } as never : undefined);
    const msgs: Msg[] = [];
    const closed = new Promise<number>(r => ws.addEventListener('close', ev => r((ev as CloseEvent).code)));
    ws.addEventListener('message', ev => msgs.push(JSON.parse(String((ev as MessageEvent).data)) as Msg));
    ws.addEventListener('open', () => res({ ws, msgs, closed }), { once: true });
    ws.addEventListener('error', () => rej(new Error('socket refused')), { once: true });
  });
}

function rawHttp(request: string): Promise<string> {
  return new Promise(res => {
    const sock = connect(PORT, 'localhost', () => sock.write(request));
    let out = '';
    sock.on('data', d => { out += d; });
    sock.on('close', () => res(out));
    sock.on('error', () => res(out));
    setTimeout(() => sock.destroy(), 2000);
  });
}

try {
  ok(await httpOk(), 'fixture: the server answers before anything hostile is sent');

  // ── §1 ──────────────────────────────────────────────────────────────
  console.log('\n[frames that are not a message]');
  const { ws, msgs } = await openSocket();
  for (const frame of ['null', '[]', '1', '"x"', '{}', '{"t":5}', 'not json', '']) {
    msgs.length = 0;
    ws.send(frame);
    await sleep(150);
    ok(msgs.length === 1 && msgs[0]!.t === 'error',
      `${JSON.stringify(frame)} is answered with an error (got ${JSON.stringify(msgs)})`);
    ok(alive(), `…and the process is still there after ${JSON.stringify(frame)}`);
  }
  ok(ws.readyState === WebSocket.OPEN, 'the socket itself stays open — a bad frame is not a hangup');

  // ── §2 ──────────────────────────────────────────────────────────────
  console.log('\n[an oversize frame]');
  const big = await openSocket();
  big.ws.send('{"t":"join","room":"' + 'A'.repeat(300 * 1024) + '"}');
  const code = await Promise.race([big.closed, sleep(3000).then(() => -1)]);
  ok(code === 1009, `a 300 KB frame closes the socket with 1009 "message too big" (got ${code})`);
  ok(alive() && await httpOk(), '…and the server is still serving');
  ws.close();

  // ── §3 ──────────────────────────────────────────────────────────────
  console.log('\n[requests the URL parser rejects]');
  const bad = await fetch(`http://localhost:${PORT}/%`);
  ok(bad.status === 400, `GET /% is a 400 (got ${bad.status})`);
  ok(alive(), '…and the process survived decodeURIComponent throwing');

  const badHost = await rawHttp('GET / HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n');
  ok(/^HTTP\/1\.1 400/.test(badHost), `a Host header with a space is a 400 (got ${badHost.split('\r\n')[0]})`);
  ok(alive(), '…and the process survived new URL() throwing');

  const trav = await fetch(`http://localhost:${PORT}/..%2f..%2f..%2fetc%2fpasswd`);
  ok(trav.status === 404 || trav.status === 200, `a traversal path does not escape (got ${trav.status})`);
  ok(!(await trav.text()).includes('root:'), '…and nothing outside the served roots comes back');

  ok(await httpOk(), 'the server still answers a normal request after all of that');

  // ── §4 ──────────────────────────────────────────────────────────────
  console.log('\n[Origin]');
  const foreign = await openSocket({ origin: 'https://evil.example' }).then(() => 'opened', () => 'refused');
  ok(foreign === 'refused', `a socket from a foreign Origin is refused at the upgrade (got ${foreign})`);
  const own = await openSocket({ origin: `http://localhost:${PORT}` }).then(s => { s.ws.close(); return 'opened'; }, () => 'refused');
  ok(own === 'opened', `a socket from the server's own Origin opens (got ${own})`);
  const none = await openSocket().then(s => { s.ws.close(); return 'opened'; }, () => 'refused');
  ok(none === 'opened', `a socket with NO Origin opens — that is every non-browser caller (got ${none})`);
  ok(alive(), 'and the process is still there at the end');
} finally {
  server.stop();
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
process.exit(failures ? 1 : 0);
