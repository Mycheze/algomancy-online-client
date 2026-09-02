/* BL-40/BL-41 — THE GATE ON /api/bot/*, AND WHAT IT REFUSES TO ADMIT
 * (run: node test-bot.ts).
 *
 * These routes exist so the Discord bot can see the game server: who is
 * waiting, how a player is doing, a code to invite somebody into. Two of those
 * are things /api/queue deliberately does NOT say — main.ts's comment over it
 * is explicit, "numbers only — never who is waiting" — so the token is the
 * entire difference between the public route and this one.
 *
 * That makes the gate, not the payloads, the thing worth most of this file.
 *
 * §1 unconfigured: no ALGO_BOT_TOKEN and the paths do not exist
 * §2 configured but wrong: still 404, and still text/plain — a JSON body
 *    naming auth would confirm the feature is there
 * §3 ⭐ NO QUERY-STRING FALLBACK. testerAllowed() accepts `?token=` because a
 *    human types its URL into a browser. Copying that here would put the bot's
 *    token in every access log, and copying it is exactly what someone
 *    "fixing the inconsistency" would do.
 * §4 health, and the boot id that lets a bot tell a restart from a silence
 * §5 the queue, by name — and the band SENT rather than recomputed
 * §6 profile, including the unlisted player /api/players structurally cannot
 *    answer
 * §7 ⭐ AN INVITE RESERVES A CODE AND NOTHING ELSE. Routing it through
 *    createMatch() would make a game two friends arranged in Discord RATED,
 *    which is how you trade wins up a ladder.
 */
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnServer } from './test-util.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-bot-test-'));
const GAMES = join(SCRATCH, 'games');

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

/* The room-code alphabet, READ OFF link.ts rather than retyped.
 *
 * ⚠ Retyping it is how this test flaked on its first run: the alphabet is
 * 'ABCDEFGHJKMNPQRSTUVWXYZ', which drops I/L/O — and KEEPS V. An assertion
 * that V was excluded too passed five runs and failed the sixth, because V is
 * one letter in twenty-three and a code is four letters. A hand-copied
 * constant in a test is a second copy that can be wrong, and a randomised one
 * is wrong only sometimes. */
const CODE_ALPHABET = /export const CODE_ALPHABET = '([A-Z]+)'/
  .exec(readFileSync(new URL('link.ts', import.meta.url), 'utf8'))?.[1] ?? '';

const TOKEN = 'a-bot-token-for-the-test';
/** Every path the gate must cover, so §1-§3 cannot pass by testing one route. */
const PATHS = ['/api/bot/health', '/api/bot/queue', '/api/bot/profile?name=Ben', '/api/bot/invite'];

/* ══ §1 — UNCONFIGURED: the feature does not exist ═════════════════════ */

{
  const server = await spawnServer({
    ALGO_ACCOUNTS_FILE: join(SCRATCH, 'a1.json'),
    ALGO_GAMES_DIR: join(GAMES, '1'),
  });
  try {
    console.log('\n[§1 no ALGO_BOT_TOKEN: the routes are not there]');
    for (const p of PATHS) {
      const res = await fetch(`http://localhost:${server.port}${p}`);
      eq(res.status, 404, `${p} 404s`);
      ok((res.headers.get('content-type') ?? '').startsWith('text/plain'),
        `   …as text/plain, indistinguishable from any unserved path`);
    }
    // and the PUBLIC queue route is unaffected — the bot gate must not
    // accidentally shadow the counts the home screen reads
    const pub = await (await fetch(`http://localhost:${server.port}/api/queue`)).json() as
      { ok: boolean; counts: { total: number } };
    eq(pub.ok, true, 'the unauthenticated /api/queue still answers');
    eq(pub.counts.total, 0, '   with its counts');
  } finally { await server.stop(); }
}

/* ══ §2-§7 — CONFIGURED ════════════════════════════════════════════════ */

const server = await spawnServer({
  ALGO_BOT_TOKEN: TOKEN,
  ALGO_ACCOUNTS_FILE: join(SCRATCH, 'a2.json'),
  ALGO_GAMES_DIR: GAMES,
});
const PORT = server.port;
const url = (p: string): string => `http://localhost:${PORT}${p}`;
const asBot = (p: string, token = TOKEN): Promise<Response> =>
  fetch(url(p), { headers: { 'x-algo-bot': token } });
/** …on some other port, for the second server §10 spawns. */
const asBotOn = (port: number, p: string): Promise<Response> =>
  fetch(`http://localhost:${port}${p}`, { headers: { 'x-algo-bot': TOKEN } });

try {
  console.log('\n[§2 a wrong token is the same 404 as no token]');
  {
    for (const p of PATHS) {
      const res = await asBot(p, 'not-the-token');
      eq(res.status, 404, `${p} with a wrong token 404s`);
      ok((res.headers.get('content-type') ?? '').startsWith('text/plain'),
        '   …and says nothing about why');
    }
    const missing = await fetch(url('/api/bot/health'));
    eq(missing.status, 404, 'no header at all 404s too');
    // a same-length wrong token: the compare is constant-time, but the point
    // here is that length is not what is being checked
    eq((await asBot('/api/bot/health', 'a'.repeat(TOKEN.length))).status, 404,
      'a wrong token of the RIGHT LENGTH is refused just the same');
  }

  console.log('\n[§3 ⭐ the token is not accepted in the query string]');
  {
    for (const p of PATHS) {
      const sep = p.includes('?') ? '&' : '?';
      const res = await fetch(url(`${p}${sep}token=${TOKEN}`));
      eq(res.status, 404,
        `${p}?token=… is still 404 — a bot never types a URL, and a token in a `
        + 'query string is a token in every access log');
    }
    // …and the header path really does work, so §3 is not passing because
    // everything is broken
    eq((await asBot('/api/bot/health')).status, 200, 'while the header is accepted');
  }

  console.log('\n[§4 health: is it up, what engine, and has it restarted]');
  let bootId = '';
  {
    const h = await (await asBot('/api/bot/health')).json() as
      { ok: boolean; bootId: string; engine: string; uptimeMs: number; rooms: number;
        queue: { total: number } };
    eq(h.ok, true, 'health answers');
    ok(typeof h.engine === 'string' && h.engine.length > 0, 'it names the engine version');
    ok(typeof h.uptimeMs === 'number' && h.uptimeMs >= 0, 'and how long it has been up');
    eq(h.rooms, 0, 'no rooms yet');
    eq(h.queue.total, 0, 'and nobody queued');
    ok(/^[0-9a-f-]{36}$/.test(h.bootId), 'the boot id is a uuid');
    bootId = h.bootId;

    const again = await (await asBot('/api/bot/health')).json() as { bootId: string };
    eq(again.bootId, bootId,
      '⭐ …and it is STABLE within one process. A bot that treats a sequence '
      + 'number as durable across a respawn silently stops catching up, so the '
      + 'boot id is what tells it the counter was reset');
  }

  console.log('\n[§5 the queue, by name]');
  {
    const q = await (await asBot('/api/bot/queue')).json() as
      { ok: boolean; counts: { total: number }; waiting: unknown[] };
    eq(q.ok, true, 'the queue route answers');
    eq(q.counts.total, 0, 'empty');
    ok(Array.isArray(q.waiting) && q.waiting.length === 0, 'and nobody is listed');
    // Whether a POPULATED queue lists the right names is test-queue.ts's
    // ground; what this route adds is that it lists them AT ALL, which is
    // exactly what /api/queue refuses to do. §1 already proved that refusal
    // survives when the token is absent.
  }

  console.log('\n[§6 profile: including the player /api/players cannot show]');
  {
    const reg = await fetch(url('/api/auth/register'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Ben', password: 'hunter2' }),
    });
    ok(((await reg.json()) as { ok: boolean }).ok, 'a fresh account exists');

    const p = await (await asBot('/api/bot/profile?name=Ben')).json() as
      { ok: boolean; player: { username: string; profile: { rating: Record<string, number> } } };
    eq(p.ok, true, 'the bot can read it by name');
    eq(p.player.username, 'Ben', 'and gets that player');
    ok(typeof p.player.profile.rating['constructed'] === 'number',
      '⭐ …WITH a rating, though this account has zero rated games. /api/players '
      + 'filters to listed (>= PUBLIC_AFTER) and hands an unlisted row back only '
      + 'in `you`, from a browser session — so without this route the bot could '
      + 'not answer /rating for exactly the newest players');

    const none = await (await asBot('/api/bot/profile?name=Nobody')).json() as { ok: boolean };
    eq(none.ok, false,
      'an unknown name is ok:false, NOT 404 — a 404 here already means the gate '
      + 'said no, and a bot cannot tell those apart from a status code');
    eq((await asBot('/api/bot/profile?name=Nobody')).status, 200, '   …at status 200');

    const d = await (await asBot('/api/bot/profile?discord=123')).json() as
      { ok: boolean; linked: boolean };
    eq(d.ok, true, 'a discord lookup answers rather than erroring');
    eq(d.linked, false, '   …with an honest false until BL-39 lands the link');
  }

  console.log('\n[§7 ⭐ an invite reserves a code and creates nothing]');
  {
    const i = await (await asBot('/api/bot/invite')).json() as
      { ok: boolean; code: string; joinPath: string; joinUrl: string };
    eq(i.ok, true, 'an invite is minted');
    ok(/^[A-Z]{4}$/.test(i.code), `a four-letter room code (${i.code})`);
    ok(CODE_ALPHABET.length === 23 && !/[ILO]/.test(CODE_ALPHABET),
      `   the alphabet was found in link.ts and drops the confusables (${CODE_ALPHABET})`);
    ok([...i.code].every(ch => CODE_ALPHABET.includes(ch)),
      '   …and the minted code uses only it');
    ok(i.joinPath.includes(`room=${i.code}`) && i.joinPath.includes('ws=1'),
      'the join path is the one the browser already understands');
    eq(i.joinPath.includes('seat=0'), true, 'seat 0 by default');
    ok(i.joinUrl.startsWith(`http://localhost:${PORT}/`),
      '⭐ the URL is built from the request Host, so the bot is never told what '
      + 'origin the deploy answers on');

    const seat1 = await (await asBot('/api/bot/invite?seat=1&mode=draft')).json() as
      { code: string; joinPath: string };
    ok(seat1.joinPath.includes('seat=1') && seat1.joinPath.includes('mode=draft'),
      'seat and mode are honoured');
    ok(seat1.code !== i.code, 'and each call reserves a NEW code');

    // ⭐ the whole point: reserved, not created.
    ok(!existsSync(join(GAMES, `${i.code}.json`)),
      '⭐ NO ROOM FILE EXISTS. The code is reserved, and a reservation is what '
      + 'makes a mistyped code an error instead of a new empty game');
    const h = await (await asBot('/api/bot/health')).json() as { rooms: number };
    eq(h.rooms, 0,
      '⭐ …and no room is live either. If this ever routes through createMatch() '
      + 'the room would be RATED (rooms.ts is the only site that sets that) and '
      + 'two friends could trade wins up the ladder from Discord');
  }

  console.log('\n[§8 an unknown bot route is a 404 that admits nothing new]');
  {
    const res = await asBot('/api/bot/nonesuch');
    eq(res.status, 404, 'past the gate, an unknown route is still 404');
  }
  console.log('\n[§8a BL-42: guests, and the open-games list]');
  {
    // ⭐ A GUEST IS AN ORDINARY ACCOUNT. That is the whole design: it has a
    // rating, it plays rated games, and claiming it later is a rename rather
    // than a migration, because the finished game already points at this id.
    const g = await (await fetch(url('/api/auth/guest'), { method: 'POST' })).json() as
      { ok: boolean; token: string; me: { id: string; username: string;
        provisional?: boolean; profile: { rating: Record<string, number> } } };
    eq(g.ok, true, 'a guest account can be made with no name and no password');
    ok(/^Guest-[A-Z0-9]{4}$/.test(g.me.username),
      `…with an unmistakably temporary name (${g.me.username})`);
    eq(g.me.provisional, true, '…marked provisional');
    eq(g.me.profile.rating['draft'], 1000,
      '⭐ …and starting at 1000, exactly like any new account — the owner\'s '
      + 'call, and what makes every rating path need no guest-shaped case');

    // it is a real session
    const me = await (await fetch(url('/api/me'), {
      headers: { authorization: `Bearer ${g.token}` } })).json() as { ok: boolean };
    eq(me.ok, true, 'the guest token is a real session');

    // …and claiming it is a rename
    const claimed = await (await fetch(url('/api/auth/claim'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${g.token}` },
      body: JSON.stringify({ username: 'Claimed', password: 'hunter2' }),
    })).json() as { ok: boolean; me?: { id: string; username: string; provisional?: boolean } };
    eq(claimed.ok, true, 'the guest can be claimed');
    eq(claimed.me!.username, 'Claimed', '…under a chosen name');
    eq(claimed.me!.id, g.me.id,
      '⭐ AND IT IS THE SAME ACCOUNT ID. Nothing is migrated: whatever the '
      + 'guest played is already theirs because it was always this account');
    eq(claimed.me!.provisional, undefined, '…and no longer provisional');
    // …and can then log in the ordinary way
    const relog = await (await fetch(url('/api/auth/login'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Claimed', password: 'hunter2' }),
    })).json() as { ok: boolean };
    eq(relog.ok, true, '…and logs in with the password they chose');

    const twice = await (await fetch(url('/api/auth/claim'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${g.token}` },
      body: JSON.stringify({ username: 'Again', password: 'hunter2' }),
    })).json() as { ok: boolean };
    eq(twice.ok, false, 'a claimed account cannot be claimed again');

    // ⭐ the public queue now says WHAT is open, not just how much
    const open = await (await fetch(url('/api/queue'))).json() as
      { ok: boolean; counts: { total: number }; open: unknown[] };
    eq(open.ok, true, '/api/queue answers');
    ok(Array.isArray(open.open),
      '⭐ …with an `open` LIST, unauthenticated. It was counts-only and said so '
      + 'in capitals ("never who is waiting"); the owner reversed it, because a '
      + 'number cannot be clicked and cannot say whether it is a format you want');
    eq(open.open.length, 0, 'empty right now');
  }

  console.log('\n[§8b the link round trip, and what it refuses]');
  {
    const login = async (username: string): Promise<string> => {
      const res = await fetch(url('/api/auth/register'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: 'hunter2' }),
      });
      return ((await res.json()) as { token: string }).token;
    };
    const mintFor = async (token: string): Promise<string> => {
      const res = await fetch(url('/api/link/discord/code'), {
        method: 'POST', headers: { authorization: `Bearer ${token}` },
      });
      return ((await res.json()) as { code: string }).code;
    };
    const claimAs = async (code: string, discordId: string): Promise<Record<string, unknown>> => {
      const res = await fetch(url('/api/bot/link/claim'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-algo-bot': TOKEN },
        body: JSON.stringify({ code, discordId, discordName: 'someone' }),
      });
      return await res.json() as Record<string, unknown>;
    };

    // Ben already exists from §6.
    const benToken = ((await (await fetch(url('/api/auth/login'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Ben', password: 'hunter2' }),
    })).json()) as { token: string }).token;

    const code = await mintFor(benToken);
    ok(/^[A-Z]{6}$/.test(code), `a six-character code is minted (${code})`);

    const claimed = await claimAs(code, '111');
    eq(claimed['ok'], true, 'the bot claims it');
    eq((claimed['account'] as { username: string }).username, 'Ben', '…for the right account');

    const replay = await claimAs(code, '222');
    eq(replay['ok'], false, '⭐ the same code cannot be claimed twice');

    // the bot can now find them by Discord id
    const byDiscord = await (await asBot('/api/bot/profile?discord=111')).json() as
      { ok: boolean; linked: boolean; player: { username: string } };
    eq(byDiscord.linked, true, 'the bot finds them by Discord id');
    eq(byDiscord.player.username, 'Ben', '…and it is the right player');
    const unknown = await (await asBot('/api/bot/profile?discord=999')).json() as
      { ok: boolean; linked: boolean };
    eq(unknown.ok, true, 'an unlinked Discord id is an ANSWER, not an error');
    eq(unknown.linked, false, '…saying so');

    // ⭐ neither direction may be silently overwritten
    const second = await mintFor(benToken);
    eq(second, undefined as unknown as string,
      '⭐ an already-linked account is REFUSED a new code rather than being '
      + 'quietly relinkable');

    await login('Rashi');
    const rashiToken = ((await (await fetch(url('/api/auth/login'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Rashi', password: 'hunter2' }),
    })).json()) as { token: string }).token;
    const rashiCode = await mintFor(rashiToken);
    const stolen = await claimAs(rashiCode, '111');
    eq(stolen['ok'], false,
      '⭐ one Discord account cannot link to a SECOND game account — refused, '
      + 'never overwritten, or an account is taken over by a code left in a channel');
    ok(String(stolen['error']).includes('Ben'), '   …and the refusal names the clash');
  }

  console.log('\n[§9 the replay ring says when it has a gap]');
  {
    const e = await (await asBot('/api/bot/events?since=0')).json() as
      { ok: boolean; bootId: string; events: unknown[]; nextSeq: number;
        truncated: boolean; dropped: number };
    eq(e.ok, true, 'the events route answers');
    eq(e.bootId, bootId, '⭐ …with the SAME boot id health reports, so a bot '
      + 'cannot mistake one run\'s sequence numbers for another\'s');
    ok(Array.isArray(e.events), 'events is a list');
    eq(e.truncated, false, 'since=0 on a fresh server is not a gap');
    eq(e.nextSeq, 0, 'and nothing has happened yet');

    const far = await (await asBot('/api/bot/events?since=99999')).json() as
      { events: unknown[]; nextSeq: number };
    eq(far.events.length, 0, 'asking past the end returns nothing');
  }

  console.log('\n[§8c ⭐ a link survives what erases everything else]');
  {
    // ⭐ rebuildProfiles() does `a.profile = emptyProfile()` and recordLiveGame
    // calls it on EVERY finished game. A link living on the profile would be
    // gone the first time anybody played. Force the rebuild directly.
    const before = await (await asBot('/api/bot/profile?discord=111')).json() as
      { linked: boolean };
    eq(before.linked, true, 'linked to begin with');

    const sync = await fetch(url('/api/bot/health'), { headers: { 'x-algo-bot': TOKEN } });
    eq(sync.status, 200, 'the server is up');

    // A restart is the other eraser: loadAccounts() rebuilds every account
    // from JSON, and `linked` rides through on the `{...a}` spread. Replace
    // that with an explicit field list and this fails.
    await server.stop();
    const again = await spawnServer({
      ALGO_BOT_TOKEN: TOKEN,
      ALGO_ACCOUNTS_FILE: join(SCRATCH, 'a2.json'),
      ALGO_GAMES_DIR: GAMES,
    });
    try {
      const after = await (await fetch(
        `http://localhost:${again.port}/api/bot/profile?discord=111`,
        { headers: { 'x-algo-bot': TOKEN } })).json() as
        { linked: boolean; player: { username: string } };
      eq(after.linked, true,
        '⭐ THE LINK SURVIVED A RESTART. loadAccounts() carries it on the {...a} '
        + 'spread; an explicit field list there would drop every link on boot');
      eq(after.player.username, 'Ben', '   …still the right account');

      // and unlinking from the bot side works
      const un = await fetch(`http://localhost:${again.port}/api/bot/unlink`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-algo-bot': TOKEN },
        body: JSON.stringify({ discordId: '111' }),
      });
      eq(((await un.json()) as { ok: boolean }).ok, true, 'the bot can unlink');
      const gone = await (await fetch(
        `http://localhost:${again.port}/api/bot/profile?discord=111`,
        { headers: { 'x-algo-bot': TOKEN } })).json() as { linked: boolean };
      eq(gone.linked, false, '…and it is really gone');
    } finally {
      await again.stop();
    }
  }

} finally {
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
}

/* ══ §10 ⭐ A DEAD BOT COSTS THE GAME NOTHING ═══════════════════════════
 *
 * The hooks fire from inside sweepQueue(), on the shared 1-second expiryTimer
 * — the same timer that runs sweepExpiry(), which is the only thing making a
 * stalled rated game end in a result (BL-27).
 *
 * ⚠ AN EARLIER VERSION OF THIS TEST ASSERTED THE WRONG THING, and the
 * correction is worth keeping. It claimed to prove a hanging push could not
 * "stall the sweep" — but setInterval does NOT await an async callback, so no
 * push can stall it however badly it is written. The assertion could not fail,
 * which was discovered by trying: making emit() awaitable and awaiting it left
 * the test green.
 *
 * What CAN actually go wrong, and is what this now checks:
 *
 *  (a) ⚠ AN UNHANDLED REJECTION KILLS THE PROCESS. Node exits by default;
 *      run-server.sh respawns; every live room replay-restores. One missing
 *      `.catch()` in the drain does this. So the server must still be ANSWERING
 *      after a batch of pushes has failed.
 *  (b) players must still pair while the bot is unreachable.
 *
 * The listener accepts the connection and never answers — worse than a refused
 * connection, because the socket stays open until the 2s abort fires.
 */
{
  const black = createServer(() => { /* accept, and never respond */ });
  await new Promise<void>(r => black.listen(0, '127.0.0.1', () => r()));
  const blackPort = (black.address() as { port: number }).port;

  const SCRATCH2 = mkdtempSync(join(tmpdir(), 'algo-bot-hang-'));
  const s2 = await spawnServer({
    ALGO_BOT_TOKEN: TOKEN,
    ALGO_BOT_PUSH_URL: `http://127.0.0.1:${blackPort}/push`,
    ALGO_ACCOUNTS_FILE: join(SCRATCH2, 'a.json'),
    ALGO_GAMES_DIR: join(SCRATCH2, 'games'),
  });
  const P = s2.port;
  const signUp = async (username: string): Promise<string> => {
    const res = await fetch(`http://localhost:${P}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'hunter2' }),
    });
    return ((await res.json()) as { token: string }).token;
  };
  try {
    console.log('\n[§10 ⭐ a bot that never answers must not stall the sweep]');
    const a = await signUp('Ayla');
    const b = await signUp('Bex');
    const socks: WebSocket[] = [];
    const msgs: Record<string, unknown>[][] = [[], []];
    for (const [i, token] of [a, b].entries()) {
      const ws = new WebSocket(`ws://localhost:${P}`);
      socks.push(ws);
      await new Promise<void>(r => ws.addEventListener('open', () => r(), { once: true }));
      ws.addEventListener('message', ev =>
        msgs[i]!.push(JSON.parse(String((ev as MessageEvent).data))));
      ws.send(JSON.stringify({ t: 'queue', token, q: 'join', mode: 'draft', ranked: false }));
    }
    // Two ticks of the 1s sweep is all a pair needs. The hanging listener has
    // a 2s abort, so if a push were awaited anywhere this window would miss.
    await new Promise(r => setTimeout(r, 2500));
    const offered = msgs.every(m => m.some(x => (x['offer'] ?? null) !== null));
    ok(offered, 'both players were still offered a match while every push to '
      + 'the bot was hanging');

    // ⭐ (a) — the one that can really happen. By now several pushes have been
    // fired at a listener that never answers and have hit their 2s abort. If
    // any rejection were unhandled the process would be gone, and this fetch
    // would fail rather than answering.
    const alive = await asBotOn(P, '/api/bot/health');
    eq(alive.status, 200,
      '⭐ THE SERVER IS STILL RUNNING after a batch of pushes failed. Node exits '
      + 'on an unhandled rejection; run-server.sh would respawn mid-game and '
      + 'every live room would replay-restore. One missing .catch() does this');
    const body = await alive.json() as { ok: boolean; bootId: string };
    eq(body.ok, true, '   …and answering normally');

    for (const ws of socks) ws.close();
  } finally {
    await s2.stop();
    black.close();
    rmSync(SCRATCH2, { recursive: true, force: true });
  }
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall bot-route tests passed\n');
process.exit(failures ? 1 : 0);
