/* docs/22 — the over-the-wire half of the Competitive Constructed server tests
 * (818, 820, 821). Not a test. Builds a throwaway var/ (games, matches,
 * accounts), signs three players up IN-PROCESS (their session tokens are in the
 * accounts file the spawned server boots from), saves each a CC deck with a
 * sideboard (and `swap`, a legal between-games configuration of it: two out,
 * two in), and drives the real server over raw WebSockets
 * the way 520 does.
 *
 * The decks are disjoint slices of the pool, so a card's name says whose it is.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CardName } from '../../engine/src/types.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { spawnServer, mintRoom, type ServerHandle } from '../e2e/test-util.ts';

export interface Msg { t: string; msg?: string; [k: string]: any }

export class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
  private waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  constructor(port: number) {
    this.ws = new WebSocket(`ws://localhost:${port}`);
    this.ws.addEventListener('message', ev => {
      const m = JSON.parse(String((ev as MessageEvent).data)) as Msg;
      this.msgs.push(m);
      const i = this.waiters.findIndex(w => w.pred(m));
      if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(m);
    });
  }
  open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise(res => this.ws.addEventListener('open', () => res(), { once: true }));
  }
  next(pred: (m: Msg) => boolean, after = 0, timeoutMs = 10_000): Promise<Msg> {
    const past = this.msgs.findIndex((m, i) => i >= after && pred(m));
    if (past >= 0) return Promise.resolve(this.msgs[past]!);
    return new Promise((res, rej) => {
      const w = { pred, resolve: res };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) { this.waiters.splice(i, 1); rej(new Error(`timeout waiting for a message; last: ${JSON.stringify(this.msgs.at(-1)).slice(0, 300)}`)); }
      }, timeoutMs);
    });
  }
  send(obj: unknown): void { this.ws.send(JSON.stringify(obj)); }
  ask(obj: unknown, pred: (m: Msg) => boolean): Promise<Msg> {
    const mark = this.msgs.length;
    this.send(obj);
    return this.next(pred, mark);
  }
  close(): void { try { this.ws.close(); } catch { /* closing */ } }
}

const pool = DECK_LIST as CardName[];
const twice = (names: CardName[]): CardName[] => names.flatMap(n => [n, n]);

export async function ccWire(tag: string) {
  const DIR = mkdtempSync(join(tmpdir(), `algo-${tag}-`));
  const env = {
    ALGO_GAMES_DIR: join(DIR, 'games'), ALGO_MATCHES_DIR: join(DIR, 'matches'),
    ALGO_ACCOUNTS_FILE: join(DIR, 'accounts.json'), ALGO_ISSUES_FILE: join(DIR, 'issues.jsonl'),
  };
  const A = await import('../accounts.ts');
  const C = await import('../collection.ts');
  const restore = A.useAccountsFile(env.ALGO_ACCOUNTS_FILE);
  const people = ['Ann', 'Bo', 'Cy'].map((n, i) => {
    const r = A.register(`${n}${tag}`, 'correct horse battery');
    if (!r.ok) throw new Error(r.error);
    const main = twice(pool.slice(i * 15, i * 15 + 15));
    const side = pool.slice(60 + i * 5, 60 + i * 5 + 3);
    const made = C.createDeck(r.account, {
      name: `${n} CC`, cards: main, sideboard: side,
    });
    if (!made.ok) throw new Error(made.error);
    const swap = { main: [...main.slice(2), ...side.slice(0, 2)], side: [...side.slice(2), ...main.slice(0, 2)] };
    return { name: `${n}${tag}`, token: r.token, id: r.account.id, deckId: made.deck!.id, swap, main, side };
  });
  restore();
  let server: ServerHandle = await spawnServer(env);
  const clients: Client[] = [];
  const client = async (): Promise<Client> => { const c = new Client(server.port); clients.push(c); await c.open(); return c; };
  return {
    DIR, env, people, pool,
    get port() { return server.port; },
    client,
    mint: () => mintRoom(server.port),
    async restart(): Promise<void> {
      for (const c of clients) c.close();
      clients.length = 0;
      await server.stop();
      server = await spawnServer(env);
    },
    async stop(): Promise<void> {
      for (const c of clients) c.close();
      await server.stop();
    },
  };
}

/** both players into a fresh Bo3: the creator registers by deck id, the
 * joiner too; resolves once game 1 is dealt on both sockets */
export async function startWireMatch(w: Awaited<ReturnType<typeof ccWire>>, bestOf: 1 | 3 = 3) {
  const [ann, bo] = w.people;
  const code = await w.mint();
  const a = await w.client(), b = await w.client();
  a.send({ t: 'join', room: code, seat: 0, mode: 'constructed', cc: { bestOf }, deckId: ann!.deckId, token: ann!.token, name: 'x' });
  const lobby = await a.next(m => m.t === 'joined');
  const markA = a.msgs.length;
  b.send({ t: 'join', room: code, deckId: bo!.deckId, token: bo!.token, pick: true });
  const jb = await b.next(m => m.t === 'joined' && !!m['view']);
  const ja = await a.next(m => m.t === 'joined' && !!m['view'], markA);
  return { code, a, b, lobby, ja, jb };
}

/** both seats join `room` (a match's next room) and the lobby is up on both */
export async function joinNext(a: Client, b: Client, room: string, ann: { token: string }, bo: { token: string }): Promise<[Msg, Msg]> {
  a.send({ t: 'join', room, token: ann.token });
  const ja = await a.next(m => m.t === 'joined' && m['room'] === room);
  b.send({ t: 'join', room, token: bo.token });
  const jb = await b.next(m => m.t === 'joined' && m['room'] === room);
  return [ja, jb];
}
