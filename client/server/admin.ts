/* BL-16 — THE OPERATOR'S VIEW: accounts, reports, games, live rooms.
 *
 * WHAT THIS FILE IS. The data half of the admin dashboard: who may see it, and
 * what each of its four views is made of. The HTTP surface is api-admin.ts and
 * the page is ui/admin.ts; neither of those decides anything.
 *
 * ── WHO IS AN ADMIN ──────────────────────────────────────────────────
 *
 * `Account.admin`, and NOT the judge badge. The owner settled that when the
 * entry was written (2026-08-25): *"Ben is an admin and L1 judge. He will set
 * the other accounts when anyone else maybe ends up joining."* — he holds
 * admin while putting himself at judge L1, so the two axes are independent by
 * his own example.
 *
 * ⚠ EVERY ROUTE FAILS CLOSED AS A 404, never a 403, exactly as the scenario
 * tester and the bot routes do (see main.ts's TESTER_TOKEN note). A deploy
 * where nobody is an admin does not admit the dashboard exists, and a logged-in
 * stranger poking at /api/admin/* learns the same nothing as a logged-out one.
 * BL-16's own doneWhen says it in the negative — *"Everything on the page is
 * refused to non-admins, server-side, not just hidden in the UI"* — and the
 * reason that line is there at all is that hiding a button is not a permission.
 *
 * ── WHY THE REPORT VIEW IMPORTS A LEDGER OUT OF THE SOURCE TREE ──────
 *
 * A report's IMPLEMENTATION STATUS is not server state. It lives in
 * `client/ledgers/playtest-ledger.ts`, which is committed source: a report is
 * `fixed` when somebody wrote an entry naming the test that keeps it fixed.
 * The dashboard reads that file at runtime and joins it to the journal by id.
 *
 * Two consequences worth stating, because both are features:
 *
 *  · The status shown is the status OF THE RUNNING BUILD. The box serves the
 *    commit it has pulled, so "fixed" on this page means "fixed in what these
 *    players are playing", which is the only version of the question an
 *    operator actually has.
 *  · It is READ-ONLY here, and it has to be. A status edited in the browser
 *    would write to a source file on the deploy box and be destroyed by the
 *    next `git pull`. The writable signal is the TRIAGE MARK below, which is
 *    runtime state and lives in var/ where runtime state belongs.
 *
 * The import is cheap: playtest-ledger.ts pulls in its closed half and a
 * TYPE-ONLY re-export of report-fields.ts, and nothing else. No engine, no
 * card registry.
 */
import { readFileSync, appendFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tokenOf } from './api-util.ts';
import {
  accountForToken, admins, allAccounts, gameHistory, type Account,
} from './accounts.ts';
import { allRooms } from './rooms.ts';
import { issuesFile, reportMarksFile } from './statepaths.ts';
import { LEDGER, type ReportStatus } from '../ledgers/playtest-ledger.ts';
import type { IssueRow } from './report-fields.ts';

/* ── who is allowed in ────────────────────────────────────────────────── */

/** The caller's account if they hold the admin flag, else undefined. The ONE
 *  place that question is asked; every route goes through it. */
export function adminFor(req: IncomingMessage): Account | undefined {
  const account = accountForToken(tokenOf(req));
  return account?.admin ? account : undefined;
}

/* ── the triage mark ──────────────────────────────────────────────────── */

/** The owner's snap judgement on a report: is it real? Separate from the
 *  ledger's considered `status`, and deliberately coarser — the point is to
 *  say "I have looked at this" before anybody spends an hour replaying it. */
export type ReportMark = 'real' | 'not';

export interface MarkRow {
  /** the report's id — its line index in issues.jsonl */
  id: number;
  /** null clears the mark */
  mark: ReportMark | null;
  /** the admin who set it, by username — a snapshot, like IssueRow.by */
  by: string;
  at: string;
}

const isMark = (v: unknown): v is ReportMark => v === 'real' || v === 'not';

/**
 * Every mark currently in force, by report id.
 *
 * Last write wins, which is what makes the journal append-only: changing your
 * mind about a report is a new line, and the file stays a replayable record of
 * what you thought and when. A row whose `mark` is null is a CLEAR and removes
 * the entry rather than storing a null — so a cleared report is indistinguishable
 * from one that was never marked, which is what "clear" should mean.
 *
 * Never throws. A missing file is an empty map (nothing has been triaged yet),
 * and a corrupt line is skipped rather than taking the dashboard down with it —
 * this is a journal an operator may well have hand-edited on the box.
 */
export function marks(): Map<number, MarkRow> {
  const out = new Map<number, MarkRow>();
  let text: string;
  try { text = readFileSync(reportMarksFile(), 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Partial<MarkRow>;
      if (typeof r.id !== 'number' || !Number.isInteger(r.id) || r.id < 0) continue;
      if (r.mark === null || r.mark === undefined) out.delete(r.id);
      else if (isMark(r.mark)) {
        out.set(r.id, { id: r.id, mark: r.mark, by: String(r.by ?? ''), at: String(r.at ?? '') });
      }
    } catch { /* a line we cannot read is a line we do not have */ }
  }
  return out;
}

/** Append one mark. Returns the row written. */
export function setMark(id: number, mark: ReportMark | null, by: string): MarkRow {
  const row: MarkRow = { id, mark, by, at: new Date().toISOString() };
  appendFileSync(reportMarksFile(), JSON.stringify(row) + '\n');
  return row;
}

/* ── the four views ───────────────────────────────────────────────────── */

export interface AdminAccountRow {
  id: string;
  username: string;
  createdAt: string;
  admin: boolean;
  badge: Account['badge'];
  games: number;
  wins: number;
  /** the last game this account is recorded in, or null for somebody who has
   *  registered and never finished one */
  lastPlayed: string | null;
  friends: number;
  decks: number;
  discord: string | null;
}

/** Every account, newest first. No password material of any kind leaves here:
 *  `salt`, `hash` and the session list are not fields on this shape, which is
 *  why it is a shape and not a filtered spread of the record. */
export function accountRows(): AdminAccountRow[] {
  const history = gameHistory();
  const lastBy = new Map<string, string>();
  const played = new Map<string, number>();
  for (const g of history) {
    for (const uid of g.users) {
      if (!uid) continue;
      played.set(uid, (played.get(uid) ?? 0) + 1);
      const prev = lastBy.get(uid);
      if (!prev || g.playedAt > prev) lastBy.set(uid, g.playedAt);
    }
  }
  return allAccounts()
    .map((a): AdminAccountRow => ({
      id: a.id,
      username: a.username,
      createdAt: a.createdAt,
      admin: a.admin === true,
      badge: a.badge,
      games: played.get(a.id) ?? 0,
      wins: a.profile?.wins ?? 0,
      lastPlayed: lastBy.get(a.id) ?? null,
      friends: a.friends.length,
      decks: a.decks?.length ?? 0,
      discord: a.linked?.discord?.username ?? null,
    }))
    .sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
}

export interface AdminReportRow extends IssueRow {
  /** line index in issues.jsonl — the id the ledger and fetch-reports use */
  id: number;
  /** what the LEDGER says, out of the running build. null = no entry yet,
   *  which for a new report is the normal state and not an error. */
  status: ReportStatus | null;
  /** the tests the ledger names as keeping it fixed */
  guards: string[];
  /** the ledger's note, where it has one */
  ledgerNote: string | null;
  /** the admin's triage mark, if any */
  mark: ReportMark | null;
  markedBy: string | null;
}

/**
 * Every report, newest first, joined to the ledger and to the triage marks.
 *
 * The id is the LINE INDEX, computed the same way every other reader computes
 * it — see the file note on `reportMarksFile`. Blank lines are counted, because
 * `fetch-reports.mjs` counts them: an id has to mean the same number in both
 * places or the marks point at the wrong reports.
 */
export function reportRows(): AdminReportRow[] {
  let text: string;
  try { text = readFileSync(issuesFile(), 'utf8'); } catch { return []; }
  const byId = new Map(LEDGER.map(e => [e.id, e]));
  const m = marks();
  const rows: AdminReportRow[] = [];
  text.split('\n').forEach((line, id) => {
    if (!line.trim()) return;
    let raw: IssueRow;
    try { raw = JSON.parse(line) as IssueRow; } catch { return; }
    const led = byId.get(id);
    const mark = m.get(id);
    rows.push({
      ...raw,
      id,
      status: led?.status ?? null,
      guards: led?.guards ?? [],
      ledgerNote: led?.note ?? null,
      mark: mark?.mark ?? null,
      markedBy: mark?.by ?? null,
    });
  });
  return rows.reverse();
}

export interface AdminGameRow {
  code: string;
  playedAt: string;
  mode: string;
  els: string[];
  finished: boolean;
  diverged: boolean;
  winner: number | null;
  turns: number;
  minutes: number | null;
  /** who sat there, best available: the account's CURRENT username where the
   *  seat was logged in and that account still exists, else the name recorded
   *  at the time. Never null — see `gameRows`. */
  players: [string, string];
  /** was that name read off a live account, per seat. False means it is the
   *  name recorded at the time: a signed-out seat, or an account since gone.
   *  The page marks those rather than pretending they are accounts. */
  known: [boolean, boolean];
  rated: boolean;
  custom: boolean;
}

/**
 * The whole match history, newest first — "so I can see what people have been
 * playing".
 *
 * Names, not ids — and never a raw uuid, which tells an operator nothing and is
 * the one piece of an account id worth not scattering.
 *
 * ⚠ THERE ARE TWO SOURCES FOR A SEAT'S NAME AND THE FALLBACK ORDER MATTERS.
 * `users` holds account ids; `names` holds what the seat was CALLED when the
 * game was played. An id resolves to the account's CURRENT username, which is
 * what an operator wants — somebody who renamed should not read as a stranger.
 * But an id resolves to nothing when the seat was signed out, when the account
 * has since been deleted, or — the case that caught this — when the game was
 * imported from another deployment, where the ids mean nothing here.
 *
 * This used to fall back to null and print "(guest)". Driving the page against
 * two REAL imported games is what exposed it: both rows read "(guest) vs
 * (guest)" and "(guest) won", for games whose players' names were sitting
 * unread in the same record. The recorded name is the fallback now, and
 * `known` says which source a name came from so the page can mark the
 * difference instead of flattening it.
 *
 * ⚠ `matchMs` IS ABSENT, NOT ZERO, on every game played before 2026-09-01.
 * RecordedGame's own doc says so and says why: a 0 folded into an average
 * drags it toward nothing while looking like data. `minutes` is null for those
 * and the page says how many it could not time.
 */
export function gameRows(): AdminGameRow[] {
  const nameById = new Map(allAccounts().map(a => [a.id, a.username]));
  return gameHistory()
    .map((g): AdminGameRow => ({
      code: g.code,
      playedAt: g.playedAt,
      mode: g.mode,
      els: g.els,
      finished: g.finished,
      diverged: g.diverged,
      winner: g.winner,
      turns: g.turns,
      minutes: typeof g.matchMs === 'number' ? Math.round(g.matchMs / 60000) : null,
      players: [
        (g.users[0] ? nameById.get(g.users[0]) : undefined) ?? g.names[0],
        (g.users[1] ? nameById.get(g.users[1]) : undefined) ?? g.names[1],
      ],
      known: [
        !!(g.users[0] && nameById.has(g.users[0])),
        !!(g.users[1] && nameById.has(g.users[1])),
      ],
      rated: g.rated === true,
      custom: !!g.custom,
    }))
    .sort((x, y) => (x.playedAt < y.playedAt ? 1 : -1));
}

export interface AdminRoomRow {
  code: string;
  mode: string;
  /** whose seat is which, by display name */
  names: [string, string];
  /** is a socket actually attached to that seat right now */
  connected: [boolean, boolean];
  /** logged-in account per seat, by username (null = playing signed out) */
  users: [string | null, string | null];
  turn: number;
  phase: string;
  winner: number | null;
  actions: number;
  /** live table minutes so far */
  minutes: number;
  watchers: number;
  rated: boolean;
}

/**
 * Every room the server currently holds — BL-16's *"a list of live rooms and
 * who is in them"*, and the one view that shows something is STUCK.
 *
 * ⚠ "LIVE" IS THE SERVER'S ROOM MAP, NOT "IN PROGRESS". A finished game stays
 * in the map until it is dropped, and a room whose players both closed their
 * tabs is still here with two null sockets. That is exactly what an operator
 * wants to see — the page prints the phase and whether anybody is attached, so
 * "gameover, nobody connected" and "turn 4, both connected" are told apart by
 * looking rather than by the row's presence.
 *
 * Reads the room, never touches it. Nothing on this page may nudge a live
 * game: there is no seat to act from and no honest way to do it, so the
 * dashboard is a window and the room is not aware of it.
 */
export function roomRows(): AdminRoomRow[] {
  const nameById = new Map(allAccounts().map(a => [a.id, a.username]));
  const rows: AdminRoomRow[] = [];
  for (const r of allRooms()) {
    rows.push({
      code: r.code,
      mode: r.mode,
      names: [r.names[0], r.names[1]],
      connected: [!!r.sockets[0], !!r.sockets[1]],
      users: [
        r.users[0] ? nameById.get(r.users[0]) ?? null : null,
        r.users[1] ? nameById.get(r.users[1]) ?? null : null,
      ],
      turn: r.state.turn,
      phase: r.state.phase,
      winner: r.state.winner,
      actions: r.actions.length,
      minutes: Math.round(r.matchMs / 60000),
      watchers: r.watchers.size,
      rated: r.rated === true,
    });
  }
  return rows.sort((x, y) => y.actions - x.actions);
}

/** How many admins this deploy has — the dashboard shows it beside the
 *  revoke buttons, because the last-admin guard is easier to understand when
 *  you can see the number it is about. */
export const adminCount = (): number => admins().length;
