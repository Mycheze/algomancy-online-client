/* The draft lobby: two people agreeing on three elements.
 *
 * The room exists, both players are in it, and NO CARDS HAVE BEEN DEALT — that
 * is the point. Choosing the trio on the home screen made it one person's
 * decision and handed that person a free look at pack 1 pick 1 while they
 * waited for their opponent. Nothing is dealt until this screen resolves.
 *
 * Three methods, all of them blind: you never see what the other person
 * submitted until the trio comes back. A pick you can see is a pick you can
 * counter, and the point is that you each get to bring something you want to
 * play. All the deciding happens server-side (server/trio.ts) off a seeded
 * draw — this module only collects a submission and shows what came back.
 *
 * What it DRAWS — the lobby and the trio reveal — is pages/lobby.ts since the
 * design-system round (2026-11-03); this module keeps the un-submitted choice
 * and the `lobby-` clicks.
 */
import { ALL_ELEMENTS } from '../engine/src/apply.ts';

export interface TrioMethodInfo { id: string; label: string; blurb: string }

export interface TrioLobby {
  method: string;
  /** BL-43: how many elements are being chosen (absent from an older server: 3) */
  count?: number;
  methods: TrioMethodInfo[];
  locked: [boolean, boolean];
  /** your own submission, echoed by the server so a refresh keeps it */
  mine: { element?: string; ranking?: string[] };
}

export interface TrioReveal {
  els: string[];
  how: string;
  detail: string[];
}

/** BL-43: what the server tells both seats about a room's custom rules */
export interface CustomRulesInfo { summary: string[]; excluded: number }

/** the engine's own element list, so a new element never leaves this screen
 * with a stale copy (the string type fits the server's untyped submissions) */
const ELEMENTS: readonly string[] = ALL_ELEMENTS;

// ── local, un-submitted state ─────────────────────────────────────────
//
// Kept here rather than on the connection: it is what you are still fiddling
// with, and nothing outside this screen has any business reading it.

let pick: string | null = null;
/** the ranking being built, best first */
let ranking: string[] = [];
/** the method these locals belong to — switching method throws them away */
let localFor = '';

/** Adopt whatever the server echoed back (a reconnect, or the other player
 * changing the method out from under us). */
function syncLocals(lobby: TrioLobby): void {
  if (localFor === lobby.method) return;
  localFor = lobby.method;
  pick = typeof lobby.mine.element === 'string' ? lobby.mine.element : null;
  ranking = Array.isArray(lobby.mine.ranking) ? lobby.mine.ranking.filter(e => ELEMENTS.includes(e)) : [];
}

/** what we would send right now */
function submission(method: string): unknown {
  if (method === 'pick-one') return pick ? { element: pick } : {};
  if (method === 'rank') return { ranking };
  return {};
}

/** is it complete enough to lock in? */
function ready(method: string): boolean {
  if (method === 'pick-one') return !!pick;
  if (method === 'rank') return ranking.length === ELEMENTS.length;
  return true;
}

// ── what the page draws (pages/lobby.ts) ─────────────────────────────

/** The un-submitted choice this screen shows, adopted from the server's echo
 * first (syncLocals): what pages/lobby.ts's view reads. */
export function lobbyLocals(lobby: TrioLobby): { pick: string | null; ranking: readonly string[]; ready: boolean } {
  syncLocals(lobby);
  return { pick, ranking: [...ranking], ready: ready(lobby.method) };
}

// ── clicks ────────────────────────────────────────────────────────────

export interface LobbyActions {
  lobby: TrioLobby;
  /** send a `{t:'lobby', …}` message */
  send: (msg: Record<string, unknown>) => void;
  rerender: () => void;
}

/** main.ts offers every button here first. Returns true when it was ours. */
export function handleLobbyButton(btn: HTMLElement, a: LobbyActions): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('lobby-')) return false;
  const el = btn.dataset['el'];
  syncLocals(a.lobby);

  switch (b) {
    case 'lobby-method':
      // the server clears both submissions on a method change — say so by
      // dropping ours here too, rather than letting a stale ranking linger
      // on screen until the next message arrives
      localFor = '';
      a.send({ method: btn.dataset['method'] });
      return true;

    case 'lobby-pick':
      pick = pick === el ? null : (el ?? null);
      a.rerender();
      return true;

    case 'lobby-rank':
      if (el && !ranking.includes(el)) ranking = [...ranking, el];
      a.rerender();
      return true;

    case 'lobby-unrank':
      ranking = ranking.filter(e => e !== el);
      a.rerender();
      return true;

    case 'lobby-rank-clear':
      ranking = [];
      a.rerender();
      return true;

    case 'lobby-rank-fill':
      // "I care about my top few and not the rest" is a real preference, and
      // making people rank all seven to express it is busywork
      ranking = [...ranking, ...ELEMENTS.filter(e => !ranking.includes(e))];
      a.rerender();
      return true;

    case 'lobby-lock':
      if (!ready(a.lobby.method)) return true;
      a.send({ submission: submission(a.lobby.method), lock: true });
      return true;

    case 'lobby-unlock':
      a.send({ lock: false });
      return true;
  }
  return false;
}

/** forget the in-progress submission (leaving the room) */
export function resetLobby(): void {
  pick = null;
  ranking = [];
  localFor = '';
}
