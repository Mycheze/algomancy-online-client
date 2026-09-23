/* BL-38 — `GET /api/replay/<CODE>`: the saved game, and an honest verdict on it.
 *
 * The viewer in the browser replays the log itself (ui/replayserver.ts), the
 * same way ui/solo.ts runs a whole tutorial game in the page. What it cannot do
 * is tell whether the game it is about to draw is the game that was played —
 * that needs the file's recorded fingerprints compared against a replay, and
 * `digest` is node:crypto. So the verification happens here, once, and the
 * answer travels with the file.
 *
 * ── THE VERDICT IS THE POINT, NOT A DECORATION ───────────────────────
 *
 * BL-38's own words: *"a viewer that quietly showed a RECONSTRUCTED game
 * instead of saying so would be lying to the person watching."* A saved game
 * is a CLAIM — seed plus actions reproduces this game — and the claim was true
 * when it was written, checked later by an engine that has moved. 20 of the 22
 * games in the R200 corpus diverge, every divergence traced to a deliberate
 * rules change and none to a regression. The logs are sound; the reader moved.
 *
 * Four things can be true of a file, and they are NOT ranked on one axis, so
 * they are not reported on one:
 *
 *   verdict      what this engine's replay is worth
 *   forked       whether the file is one game or two (rooms.ts recorded it)
 *   partedAt     where the replay stopped being the recorded game — MEASURED
 *   refusedAt    where this engine first refused — an UPPER BOUND on the above
 *
 * `partedAt` and `refusedAt` are different numbers and the gap between them is
 * the whole of R200: the rules move at [k], the action stays legal and quietly
 * means something else, the boards drift apart in silence, and several actions
 * later something finally becomes illegal. On ANBB the gap is 93 actions. A
 * viewer that tinted the board from `refusedAt` would show a third of a game
 * that never happened as though it had.
 *
 * ⚠ `--as-recorded` IS NOT ON THIS PATH. `replay-room.ts`'s delta checks the
 * recorded commit out into a detached git worktree and replays there. It is the
 * truest answer available and it costs seconds to minutes, needs `.git`, and
 * writes to disk. Opening a replay must not do that. It stays the CLI, and the
 * admin route beside it is a deliberate click.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { json, tokenOf } from './api-util.ts';
import { accountForToken } from './accounts.ts';
import { adminFor } from './admin.ts';
import { gamesDir } from './statepaths.ts';
import { analyze, unreplayableReason, type RoomFile } from './replay-room.ts';
import { engineVersion } from './engine-version.ts';
import type { Seat } from '../engine/src/types.ts';

/** the 404 every refusal answers with — byte-identical to main.ts's own */
function notFound(res: ServerResponse): true {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
  return true;
}

export type ReplayVerdict =
  /** the file records fingerprints and every one of them matches this replay */
  | 'as-recorded'
  /** the file records fingerprints and this replay disagrees with one */
  | 'reconstruction'
  /** the file records no fingerprints, so this replay cannot be checked at all */
  | 'unverified'
  /** the file can never be replayed by anything — it did not record its deal */
  | 'unreplayable';

export interface ReplayResponse {
  ok: true;
  code: string;
  file: RoomFile;
  verdict: ReplayVerdict;
  /** why, when the verdict is `unreplayable` */
  reason?: string;
  /** rooms.ts rebuilt this room mid-game and play continued: it is two games */
  forked: boolean;
  /** the first action whose recorded fingerprint this replay does not match */
  partedAt: number | null;
  /** the first action this engine refuses — an upper bound on `partedAt` */
  refusedAt: number | null;
  /** which seat the caller played, so the viewer can open on their own view.
   * Null for an admin watching somebody else's game. */
  mySeat: Seat | null;
  /** true when the caller is here as an operator rather than as a player */
  asAdmin: boolean;
}

/* ── the cache ────────────────────────────────────────────────────────── */

/**
 * A verdict costs a full replay of the log, and a scrubber asks for the file
 * once per open. Keyed by code AND by the engine that answered: the whole
 * subject of the answer is what THIS engine makes of the file, so a deploy
 * must not be able to serve the last one's opinion. (A game still being played
 * is not cached at all — see below.)
 */
const cache = new Map<string, { key: string; verdict: Omit<ReplayResponse, 'ok' | 'file' | 'mySeat' | 'asAdmin'> }>();

/**
 * What a cached verdict is a verdict ABOUT.
 *
 * The engine, because the whole subject is what THIS engine makes of the file,
 * so a deploy must not serve the last one's opinion. The action count, because
 * a game that grew is a different file. And ⚠ THE FILE'S OWN mtime AND SIZE,
 * which the first version left out and a browser check caught within the hour:
 * a fingerprint was edited on disk, the route went on reporting the game it had
 * already blessed, and the answer was the reassuring one. That is precisely the
 * failure `replay-room.ts`'s crossCheck exists for — "a stale copy does not
 * error, it reassures" — reappearing one layer up, in a cache.
 */
function cacheKey(code: string, raw: RoomFile): string {
  let stamp = '';
  try {
    const st = statSync(join(gamesDir(), `${code}.json`));
    stamp = `${st.mtimeMs}:${st.size}`;
  } catch { stamp = 'nostat'; }
  return `${engineVersion()}|${raw.actions.length}|${stamp}`;
}

function readGame(code: string): RoomFile | null {
  try {
    return JSON.parse(readFileSync(join(gamesDir(), `${code}.json`), 'utf8')) as RoomFile;
  } catch {
    return null;   // missing, unreadable, half-written — all "there is no such game"
  }
}

/**
 * Where this replay stops being the recorded game.
 *
 * Compared only where the file HAS a recorded fingerprint: an entry is `''`
 * for an action that was refused when the game was played, and there is
 * nothing to disagree with. A recorded entry against this engine's `''` (it
 * refuses an action that was accepted then) IS a disagreement, and falls out
 * of the same comparison without a special case.
 */
function partedFrom(recorded: string[], replayed: string[]): number | null {
  for (let i = 0; i < recorded.length; i++) {
    const r = recorded[i];
    if (r && r !== replayed[i]) return i;
  }
  return null;
}

function verdictFor(code: string, raw: RoomFile, live: boolean): Omit<ReplayResponse, 'ok' | 'file' | 'mySeat' | 'asAdmin'> {
  const key = cacheKey(code, raw);
  const hit = cache.get(code);
  if (!live && hit && hit.key === key) return hit.verdict;

  const forked = Array.isArray(raw.forks) && raw.forks.length > 0;
  const why = unreplayableReason(raw);
  let out: Omit<ReplayResponse, 'ok' | 'file' | 'mySeat' | 'asAdmin'>;
  if (why) {
    // BL-38: "A game that cannot be replayed at all is listed and says why,
    // rather than being absent." It reaches the viewer as a verdict.
    out = { code, verdict: 'unreplayable', reason: why, forked, partedAt: null, refusedAt: null };
  } else {
    const an = analyze(raw);
    const refusedAt = an.divergedAt ? an.divergedAt.i : null;
    const recorded = Array.isArray(raw.sigs) && raw.sigs.length === raw.actions.length ? raw.sigs : null;
    const partedAt = recorded ? partedFrom(recorded, an.sigs) : null;
    // ⚠ EVERY action, or the claim is not available. `''` means the file has no
    // fingerprint for that action — a game played before the field existed, or
    // the part of one that was, or an action refused when it was recorded.
    // A PREFIX OF A RECORD IS NOT A RECORD: saying `as-recorded` on the
    // strength of the half that happens to be covered is the same lie as
    // saying it on the strength of nothing. A disagreement still counts, from
    // whatever part IS covered — that is evidence, and it only ever points one
    // way.
    const complete = !!recorded && recorded.every(sig => !!sig);
    out = {
      code,
      verdict: partedAt !== null ? 'reconstruction' : complete ? 'as-recorded' : 'unverified',
      forked,
      partedAt,
      refusedAt,
    };
  }
  // A game still being played grows between requests, so its verdict is about
  // a prefix and is not cached. Nothing is lost: nobody replays a live game.
  if (!live) cache.set(code, { key, verdict: out });
  return out;
}

/** Testing seam: forget every cached verdict. Never called by the server. */
export function resetReplayCache(): void { cache.clear(); }

/* ── the route ────────────────────────────────────────────────────────── */

const CODE = /^[A-Z0-9]{2,8}$/;

/**
 * ⚠ 404, NEVER 403 — api-admin.ts's rule, for the same reason and a second
 * one. A saved game names two accounts and holds both their decks; "you may
 * not watch this" and "there is no such game" have to be the same answer, or a
 * room code becomes a way to ask which games somebody has played.
 */
export async function replayRoutes(
  req: IncomingMessage, res: ServerResponse, path: string,
  opts: { liveRoom: (code: string) => boolean },
): Promise<boolean> {
  if (!path.startsWith('/api/replay/')) return false;
  if (req.method !== 'GET') return notFound(res);

  const code = path.slice('/api/replay/'.length).toUpperCase();
  if (!CODE.test(code)) return notFound(res);

  const me = accountForToken(tokenOf(req));
  if (!me) return notFound(res);        // signed out: nothing here for you

  const raw = readGame(code);
  if (!raw) return notFound(res);

  const admin = !!adminFor(req);
  const seats = Array.isArray(raw.users) ? raw.users : [null, null];
  const seat: Seat | null = seats[0] === me.id ? 0 : seats[1] === me.id ? 1 : null;
  // Bena, 2026-09-23: your own history, and the admin room can reach any game.
  // Nothing else — a room code is not a capability.
  if (seat === null && !admin) return notFound(res);

  json(res, {
    ok: true,
    file: raw,
    ...verdictFor(code, raw, opts.liveRoom(code)),
    mySeat: seat,
    asAdmin: admin && seat === null,
  } satisfies ReplayResponse);
  return true;
}
