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

/* The room-code alphabet, READ OFF main.ts rather than retyped.
 *
 * ⚠ Retyping it is how this test flaked on its first run: the alphabet is
 * 'ABCDEFGHJKMNPQRSTUVWXYZ', which drops I/L/O — and KEEPS V. An assertion
 * that V was excluded too passed five runs and failed the sixth, because V is
 * one letter in twenty-three and a code is four letters. A hand-copied
 * constant in a test is a second copy that can be wrong, and a randomised one
 * is wrong only sometimes. */
const CODE_ALPHABET = /const CODE_ALPHABET = '([A-Z]+)'/
  .exec(readFileSync(new URL('main.ts', import.meta.url), 'utf8'))?.[1] ?? '';

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
      `   the alphabet was found in main.ts and drops the confusables (${CODE_ALPHABET})`);
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
} finally {
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall bot-route tests passed\n');
process.exit(failures ? 1 : 0);
