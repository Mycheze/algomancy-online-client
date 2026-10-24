/* WEEKLY CHALLENGES — PLAYING A RUN (docs/21-weekly-challenges.md § Browser).
 *
 * A run is Learn to Play's room (ui/solo.ts) with a different deal and a
 * different opponent: the challenge's own `challengeDeal`, and a dummy whose
 * every move is `dummyMove` — the one definition the server replays the
 * upload against. Nothing about the board is new: main.ts hands the room's
 * socket to a NetBackend, exactly as `?learn=play` does.
 *
 * What this file adds is the RUN: the engine's own fold (`foldRun`) over every
 * action the room applies, a meter that reads it, and what happens when the
 * goal is met — the score, the upload, or (a guest) the run kept in this
 * browser until they sign in.
 *
 * The meter and the end panel are a LAYER beside #app (ui/report.ts's
 * pattern): the board repaints #app on every frame and would wipe them.
 * Their buttons are `data-chal`, never `data-btn`, so main.ts's handler and
 * this one never see each other's clicks.
 *
 * Saved after every change, as its deal plus its action log, in this browser.
 * Only the harness's own action log is ever uploaded — both seats, cut at the
 * action that met the goal.
 */
import type { Action, CardName, EngineEvent, GameState } from '../engine/src/types.ts';
import { legalActions } from '../engine/src/apply.ts';
import {
  BOARD_KINDS, DUMMY_DECK, challengeDeal, dummyMove, foldRun, newRun, progress, progressLabel, runFailed, scoreRun,
  type BoardKind, type ChallengeDef, type RunAcc, type RunScore,
} from '../engine/src/challenge.ts';
import type { BotPolicy } from './bot.ts';
import { SoloServer, type ActedBy, type SoloDeal } from './solo.ts';
import * as acct from './account.ts';
import { esc } from './util.ts';
import type { ChallengeReportRun } from '../server/report-run.ts';

/** the run in progress (one at a time), so a reload continues it */
const RUN_KEY = 'algoChallengeRun';
/** runs that met their goal and are not on the board yet (a guest's, or a failed upload) */
const DONE_KEY = 'algoChallengeDone';

export interface RunRecord { v: 1; def: ChallengeDef; deck: CardName[]; actions: Action[]; by: ActedBy[] }
export interface DoneRun { challengeId: string; title: string; deck: CardName[]; actions: Action[]; score: RunScore; at: number }
/** `newBest`: the boards this run is the player's new best on; `ranks`: their place on each board */
export interface SubmitReply {
  ok: boolean; error?: string; runId?: string; score?: RunScore;
  improved?: boolean; newBest?: BoardKind[]; ranks?: Partial<Record<BoardKind, number>>;
}

// ── storage ──────────────────────────────────────────────────────────

export function loadRun(): RunRecord | null {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    const r = raw ? JSON.parse(raw) as RunRecord : null;
    return r && r.v === 1 && r.def && Array.isArray(r.deck) && Array.isArray(r.actions) ? r : null;
  } catch { return null; }
}
export function saveRun(r: RunRecord | null): void {
  try { if (r) localStorage.setItem(RUN_KEY, JSON.stringify(r)); else localStorage.removeItem(RUN_KEY); } catch { /* this visit only */ }
}
/** a fresh run of this deck, saved, for `?challenge=play` to pick up */
export function freshRun(def: ChallengeDef, deck: readonly string[]): RunRecord {
  const r: RunRecord = { v: 1, def, deck: [...deck] as CardName[], actions: [], by: [] };
  saveRun(r);
  return r;
}

export function doneRuns(): DoneRun[] {
  try {
    const raw = localStorage.getItem(DONE_KEY);
    const v = raw ? JSON.parse(raw) as unknown : null;
    return Array.isArray(v) ? v as DoneRun[] : [];
  } catch { return []; }
}
function saveDone(list: DoneRun[]): void {
  try { if (list.length) localStorage.setItem(DONE_KEY, JSON.stringify(list)); else localStorage.removeItem(DONE_KEY); } catch { /* this visit only */ }
}
export function keepDone(d: DoneRun): void {
  saveDone([...doneRuns().filter(x => x.at !== d.at), d].slice(-10));
}
export function forgetDone(at: number): void { saveDone(doneRuns().filter(x => x.at !== at)); }

/** a named account: the server refuses a guest's runs (anybody can mint one) */
export const canSubmit = (): boolean => !!acct.token() && !acct.isGuest();

/** Upload a finished run. The server replays it and scores it itself. */
export async function submitRun(d: Pick<DoneRun, 'challengeId' | 'deck' | 'actions'>): Promise<SubmitReply> {
  try {
    const r = await fetch('/api/challenge/run', {
      method: 'POST', headers: acct.authHeaders(),
      body: JSON.stringify({ challengeId: d.challengeId, deck: d.deck, actions: d.actions }),
    });
    const out = await r.json() as SubmitReply;
    return out && typeof out.ok === 'boolean' ? out : { ok: false, error: 'could not submit' };
  } catch { return { ok: false, error: 'could not reach the server' }; }
}

/** `{challengeId, deck, actions}` as a file the player keeps */
export function exportRun(d: Pick<DoneRun, 'challengeId' | 'deck' | 'actions'>): void {
  const text = JSON.stringify({ challengeId: d.challengeId, deck: d.deck, actions: d.actions });
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = `challenge-${d.challengeId}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
  } catch { /* no download in this browser */ }
}

// ── the run ──────────────────────────────────────────────────────────

/** The dummy. It asks the engine for its own legal list rather than taking
 * the room's (server/view.ts may offer a queued action inside a hidden step):
 * `dummyMove` is a function of the state, and the server asks it the same. */
export const dummyPolicy: BotPolicy = {
  id: 'challenge-dummy',
  name: 'Dummy',
  choose(state, seat) {
    const legal = legalActions(state, seat);
    return legal.length ? dummyMove(state, legal) : null;
  },
};

function playerName(): string {
  try { return acct.currentUser()?.username || (localStorage.getItem('algoName') ?? '').trim() || 'You'; } catch { return 'You'; }
}

export function soloDeal(def: ChallengeDef, deck: readonly string[]): SoloDeal {
  return { seed: def.seed, names: [playerName(), 'Dummy'], decks: [[...deck] as CardName[], [...DUMMY_DECK]], lesson: challengeDeal(def) };
}

export type SubmitState =
  | { s: 'none' } | { s: 'guest' } | { s: 'sending' } | { s: 'error'; error: string } | { s: 'done'; reply: SubmitReply };

export class ChallengeRun {
  readonly def: ChallengeDef;
  readonly deck: CardName[];
  readonly server: SoloServer;
  private acc!: RunAcc;
  /** actions applied since the deal */
  private n = 0;
  /** how many actions the log had when the goal was first met, and the score then */
  metAt: number | null = null;
  metScore: RunScore | null = null;
  /** the finished run, once the goal is met and it has been kept */
  done: DoneRun | null = null;
  submit: SubmitState = { s: 'none' };
  /** told after every change (the layer repaints) */
  onChange: (() => void) | null = null;

  constructor(rec: RunRecord, opts: { onBotStuck?: (why: string) => void } = {}) {
    this.def = rec.def;
    this.deck = rec.deck;
    this.server = new SoloServer(soloDeal(rec.def, rec.deck), dummyPolicy, { actions: rec.actions, by: rec.by }, {
      strictBot: true,
      onReset: () => { this.acc = newRun(this.def.goal, this.deck); this.n = 0; this.metAt = null; this.metScore = null; },
      onApplied: (before: GameState, a: Action, after: GameState, evs: readonly EngineEvent[]) => {
        this.acc = foldRun(this.acc, before, a, after, [...evs]);
        this.n++;
        if (this.metAt === null && progress(this.acc).met) { this.metAt = this.n; this.metScore = scoreRun(this.acc, this.def.par); }
      },
      onChange: () => this.changed(),
      ...(opts.onBotStuck ? { onBotStuck: opts.onBotStuck } : {}),
    });
    this.changed(false);
  }

  get state(): GameState { return this.server.state; }
  progress(): { value: number; target: number; met: boolean } { return progress(this.acc); }
  score(): RunScore { return this.metScore ?? scoreRun(this.acc, this.def.par); }
  /** the dummy died before the goal: the game is over and the run failed.
   * Met on the action that ended the game is NOT failed — engine verifyRun
   * judges the goal first too (CT-353). */
  get failed(): boolean { return this.metAt === null && (this.state.phase === 'gameover' || runFailed(this.acc) !== null); }
  /** why it failed, in a sentence: the goal's own rule (a one-shot that did not
   * kill), else how the game ended */
  failedWhy(): string {
    const why = runFailed(this.acc);
    if (why) return why;
    return this.state.winner === 1 ? 'You lost before the goal was met.' : 'The dummy died before the goal was met.';
  }
  /** the log to upload: both seats, cut at the action that met the goal */
  actions(): Action[] { const all = this.server.save.actions; return this.metAt === null ? all : all.slice(0, this.metAt); }

  meterText(): string {
    const p = this.progress();
    return `${progressLabel(this.def.goal)} ${Math.min(p.value, p.target)} / ${p.target} · turn ${this.state.turn} · cards ${this.score().cards}`;
  }

  private changed(tell = true): void {
    if (this.metAt !== null && !this.done) this.finish();
    else if (this.metAt === null) {
      this.done = null;
      this.submit = { s: 'none' };
      const s = this.server.save;
      saveRun({ v: 1, def: this.def, deck: this.deck, actions: s.actions, by: s.by });
    }
    if (tell) this.onChange?.();
  }

  /** The goal is met: keep the run, and put it on the board if signed in. */
  private finish(): void {
    this.done = { challengeId: this.def.id, title: this.def.title, deck: this.deck, actions: this.actions(), score: this.score(), at: Date.now() };
    keepDone(this.done);
    saveRun(null);
    if (!canSubmit()) { this.submit = { s: 'guest' }; return; }
    this.send();
  }

  send(): void {
    const d = this.done;
    if (!d || this.submit.s === 'sending') return;
    this.submit = { s: 'sending' };
    void submitRun(d).then(r => {
      if (r.ok) { forgetDone(d.at); this.submit = { s: 'done', reply: r }; }
      else this.submit = { s: 'error', error: r.error ?? 'could not submit' };
      this.onChange?.();
    });
  }
}

/**
 * Report round 2026-10-23 — what a report filed from this run carries, so the
 * moment can be replayed (server/report-run.ts keeps it, beside the journal,
 * and `replay-report-run.ts` rebuilds it): the challenge as this browser dealt
 * it, the ordered deck, the room's WHOLE log — both seats, not cut at the goal
 * — and the index the reporter is at. Typed against the server's own shape, so
 * the two cannot drift; the server checks it again regardless.
 */
export function reportAttachment(run: ChallengeRun): ChallengeReportRun {
  const actions = run.server.save.actions;
  const d = run.def;
  return {
    kind: 'challenge',
    def: { id: d.id, week: d.week, title: d.title, goal: d.goal, seed: d.seed, par: d.par, ...(d.setup ? { setup: d.setup } : {}) },
    deck: [...run.deck], actions, at: actions.length,
  };
}

let current: ChallengeRun | null = null;
export const currentRun = (): ChallengeRun | null => current;

/** The room for `?challenge=play&id=<id>`: the saved run for that challenge,
 * or null when there is none (the page starts one). */
export function startRun(id: string | null, opts: { onBotStuck?: (why: string) => void } = {}): ChallengeRun | null {
  const rec = loadRun();
  if (!rec || (id && rec.def.id !== id)) return null;
  current = new ChallengeRun(rec, opts);
  current.onChange = paintLayer;
  paintLayer();
  return current;
}

// ── the layer: the meter, and the end panel ───────────────────────────

let layer: HTMLElement | null = null;
let hooks: { home: () => void; page: () => void; signIn: () => void; retry: (run: ChallengeRun) => void; rewind: (run: ChallengeRun) => void } | null = null;

/** one number in a stat grid — account.ts's `.statcell`, value over label */
export const statCell = (label: string, value: string | number): string =>
  `<div class="statcell"><div class="statval">${esc(String(value))}</div><div class="statlab">${esc(label)}</div></div>`;

/** what the run took — turns first, the hardest to cut; extra copies only when there are any */
export function scoreHtml(s: RunScore): string {
  return `<div class="statgrid chscore">${statCell('Turns', s.turns)}${statCell('Cards', s.cards)}${
    s.extra ? statCell('Extra copies', s.extra) : ''}${statCell('Elements', s.elements)}</div>`;
}

const BOARD_NAME: Record<BoardKind, string> = { fastest: 'fastest', leanest: 'leanest', purest: 'purest', overall: 'overall' };

/** "New best: fastest, leanest. #1 fastest · #3 leanest · #2 purest · #2 overall." */
function placedText(r: SubmitReply): string {
  const nb = (r.newBest ?? []).map(k => BOARD_NAME[k]);
  const head = nb.length ? `New best: ${nb.join(', ')}.` : 'On the leaderboard. No new best.';
  const ranks = BOARD_KINDS.flatMap(k => (r.ranks?.[k] ? [`#${r.ranks[k]} ${BOARD_NAME[k]}`] : []));
  return `${head}${ranks.length ? ` ${ranks.join(' · ')}.` : ''}`;
}

function submitHtml(run: ChallengeRun): string {
  const st = run.submit;
  switch (st.s) {
    case 'guest': return `<p>Sign in to put this run on the leaderboard. It is kept here until you do.</p>
      <button class="primary" data-chal="signin">Sign in</button>`;
    case 'sending': return '<p class="dim">Submitting…</p>';
    case 'error': return `<p class="chproblem">${esc(st.error)}</p><button data-chal="resend">Try again</button>`;
    case 'done': return `<p>${esc(placedText(st.reply))}</p>`;
    default: return '';
  }
}

/** The meter: a row of the board's own sticky strip (main.ts renders it
 * there), under the turn bar — part of the table's layout, so it covers
 * nothing the board shows, at any width. Only the end panel is a layer. */
export function meterHtml(run: ChallengeRun): string {
  return `<div class="chmeter" role="status">
    <span class="chmetertext">${esc(run.meterText())}</span>
    <button data-chal="rewind" title="back to the start of this turn">↺ Turn</button>
    <button data-chal="retry">Retry</button>
    <button data-chal="giveup">Give up</button>
  </div>`;
}

export function layerHtml(run: ChallengeRun | null): string {
  if (!run) return '';
  if (run.done) {
    return `<div class="chscrim"><div class="chbox" role="dialog" aria-label="Goal met">
      <h3>Goal met</h3>
      ${scoreHtml(run.done.score)}
      ${submitHtml(run)}
      <div class="chboxbtns">
        <button data-chal="export">Export run</button>
        <button data-chal="retry">Retry</button>
        <button class="primary" data-chal="page">Challenge page</button>
      </div>
    </div></div>`;
  }
  if (run.failed) {
    return `<div class="chscrim"><div class="chbox" role="dialog" aria-label="Run failed">
      <h3>Run failed</h3>
      <p>${esc(run.failedWhy())}</p>
      <div class="chboxbtns">
        <button data-chal="rewind">↺ Rewind this turn</button>
        <button class="primary" data-chal="retry">Retry</button>
        <button data-chal="page">Challenge page</button>
      </div>
    </div></div>`;
  }
  return '';
}

export function paintLayer(): void {
  if (layer) layer.innerHTML = layerHtml(current);
}

function onButton(b: string): void {
  const run = current;
  if (!run || !hooks) return;
  switch (b) {
    case 'rewind': hooks.rewind(run); return;
    case 'retry': hooks.retry(run); return;
    case 'giveup': saveRun(null); hooks.page(); return;
    case 'page': hooks.page(); return;
    case 'signin': hooks.signIn(); return;   // the sign-in form; the page behind it submits the kept run
    case 'resend': run.send(); paintLayer(); return;
    case 'export': if (run.done) exportRun(run.done); return;
  }
}

/** Hang the layer beside #app. A no-op off a challenge run. */
export function installChallengeLayer(h: NonNullable<typeof hooks>): void {
  hooks = h;
  if (layer || !document.body || typeof document.body.appendChild !== 'function') return;
  layer = document.createElement('div');
  layer.id = 'challengelayer';
  document.body.appendChild(layer);
  document.addEventListener('click', e => {
    const t = (e.target as HTMLElement | null)?.closest?.('[data-chal]') as HTMLElement | null;
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    onButton(t.dataset['chal']!);
  }, { capture: true });
  paintLayer();
}
