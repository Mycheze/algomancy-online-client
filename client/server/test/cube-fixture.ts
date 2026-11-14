/* docs/25 — the shared fixture of the cube event server tests (1320–1334). Not a test.
 *
 * Builds on ccFixture (throwaway games/ and matches/, deterministic room codes for a match's next
 * game), points the cube store and the account store at the same throwaway directory BEFORE the
 * cube modules load, installs the ONE composed `ended` hook exactly as main.ts does (the league's,
 * then the cube's), and drives everything on a FAKE CLOCK `T` — every op and sweep is handed it.
 *
 *   people(n)          n registered accounts, as cube Actors (with their session tokens)
 *   draftOut(code)     run the draft to its end: each human picks its suggestion at once unless it
 *                      is in `slow` (those time out), and the sweep is called at every wake-up
 *   buildAll(code)     every player submits the suggested deck
 *   toRound(code)      the break runs out and the next round posts
 *   playOut(code, p)   Play, then the loser (`loserOf`, default seat 1's player) concedes
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { Seat } from '../../engine/src/types.ts';
import { ccFixture } from './cc-match-fixture.ts';
import type { CubeEvent, CubeMatchView, Pairing } from '../cube-types.ts';
import type { Op } from '../cube.ts';

export async function cubeFixture(tag: string) {
  const F = await ccFixture(tag);
  process.env['ALGO_CUBE_DIR'] = join(F.DIR, 'cube');
  process.env['ALGO_CUBE_BREAK_MS'] = '5000';
  const A = await import('../accounts.ts');
  const ST = await import('../cube-store.ts');
  const C = await import('../cube.ts');
  const D = await import('../cube-draft.ts');
  const LM = await import('../league-match.ts');
  const restoreAccounts = A.useAccountsFile(join(F.DIR, 'accounts.json'));
  ST.loadCubes(join(F.DIR, 'cube'));

  const clock = { T: Date.parse('2026-12-01T12:00:00Z') };
  // main.ts's composition: the league's ended, then the cube's — never a second setMatchHooks
  LM.installLeagueMatchHooks([m => C.cubeMatchEnded(m, clock.T)]);

  let k = 0;
  const pushes: { code: string; only?: string }[] = [];
  const matched: { code: string; user: string; match: CubeMatchView }[] = [];
  C.setCubeHooks({
    eventCode: () => `${tag.toUpperCase().slice(-3)}E${++k}`,
    roomCode: () => { const c = `${tag.toUpperCase().slice(-3)}R${++k}`; F.R.reserveRoomCode(c); return c; },
    changed: (e, only) => { pushes.push({ code: e.code, ...(only ? { only } : {}) }); },
    matched: (e, user, match) => { matched.push({ code: e.code, user, match }); },
    winRates: () => new Map(),
  });

  const people = (n: number, prefix = 'Cu') => Array.from({ length: n }, (_, i) => {
    const r = A.register(`${prefix}${tag}${i}`, 'correct horse battery');
    if (!r.ok) throw new Error(r.error);
    return { id: r.account!.id, username: r.account!.username, token: r.token! };
  });
  const ev = (code: string): CubeEvent => ST.getCube(code)!;
  /** the op succeeded (else the test fails with its sentence) — narrowed to the success shape */
  const ok = <T extends object>(r: Op<T>): { ok: true } & T => {
    if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
    return r;
  };

  function draftOut(code: string, slow: Set<string> = new Set()): void {
    for (let guard = 0; ev(code).phase === 'drafting'; guard++) {
      if (guard > 5000) throw new Error('the draft never ended');
      const e = ev(code);
      for (const p of e.players) {
        if (slow.has(p.user)) continue;
        const v = C.viewFor(e, p.user, clock.T).draft;
        if (v?.pack) ok(C.pickCard(e, p.user, v.suggest ?? v.pack[0]!, clock.T));
        if (ev(code).phase !== 'drafting') return;
      }
      const w = D.nextWake(ev(code).draft!);
      if (w !== null) clock.T = Math.max(clock.T, w);
      C.sweepCubes(clock.T);
    }
  }
  function buildAll(code: string): void {
    for (const p of [...ev(code).players]) {
      if (p.dropped) continue;
      const s = ok(C.suggestDeck(ev(code), p.user));
      ok(C.submitDeck(ev(code), p.user, s.main, s.side, clock.T));
    }
  }
  function toRound(code: string): void {
    const until = ev(code).breakUntil;
    if (!until) throw new Error('no break running');
    clock.T = until;
    C.sweepCubes(clock.T);
  }
  /** Play `p` and let `loser` concede game after game until the match is over */
  function playOut(code: string, p: Pairing, loser = p.b!): string {
    const r = ok(C.playMatch(ev(code), p.a, p.id, clock.T));
    for (let g = 0; g < 3; g++) {
      const pp = ev(code).pairings.find(x => x.id === p.id)!;
      if (pp.result) break;
      const m = F.S.getMatch(pp.match!.id)!;
      if (!F.S.matchOpen(m)) break;
      const room = F.R.getRoom(m.room)!;
      if (m.phase === 'between') {
        // a Bo3's next game: both ready with the loser's initiative choice
        F.seatUp(room, 0, 1);
        const chooser = m.between!.chooser;
        F.M.matchOp(room, chooser, 'ready', { ready: true, initiative: chooser }, clock.T);
        F.M.matchOp(room, chooser === 0 ? 1 : 0, 'ready', { ready: true }, clock.T);
      }
      const live = F.R.getRoom(F.S.getMatch(pp.match!.id)!.room)!;
      const seat = (live.users[0] === loser ? 0 : 1) as Seat;
      F.concede(live, seat);
    }
    return r.room;
  }
  const cleanup = (): void => { restoreAccounts(); rmSync(F.DIR, { recursive: true, force: true }); };
  return { F, A, ST, C, D, LM, clock, people, ev, ok, draftOut, buildAll, toRound, playOut, pushes, matched, cleanup };
}
