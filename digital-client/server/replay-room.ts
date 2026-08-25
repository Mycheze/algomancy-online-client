/* Replay a saved game file through the CURRENT engine and report how
 * faithfully it reproduces — the review/verification tool for game logs.
 *
 *   node replay-room.ts games/GAXG.json          # summary + verdict
 *   node replay-room.ts games/GAXG.json --log    # + the full annotated event log
 *
 * A room file is a CLAIM: seed + actions reproduces this game. Replay is
 * deterministic (the engine is pure — no Math.random, no Date.now), so the
 * claim is checkable, and this is the thing that checks it.
 *
 * There are two completely different reasons a replay can come up short, and
 * telling them apart is the whole point of this tool:
 *
 *   ENGINE DRIFT   the rules changed since the game was played, so the current
 *                  engine refuses moves that were legal at the time. Expected
 *                  after a rules commit. The FILE is fine; it is a true record
 *                  of a game this engine would no longer allow.
 *
 *   FORK           the server restarted mid-game onto a changed engine, could
 *                  not replay part of the log, rebuilt the game without those
 *                  actions, and play then CONTINUED from the rebuilt board.
 *                  The log is two different games end to end. rooms.ts records
 *                  this in the file as it happens (`forks`), so it is a fact
 *                  stated by the file rather than something you have to infer
 *                  from a pile of rejections.
 *
 * Before `forks` existed the two presented identically — a heap of skips —
 * which is exactly how playtest game UZRG came to reject 79 of its 276 actions
 * with nobody noticing for weeks.
 *
 * ── R169 / CT-45: A SKIP COUNT IS NOT A REPORT ────────────────────────
 *
 * This tool used to lead with "141 actions logged, 126 replayed, 15 skipped",
 * which reads as a 89%-faithful replay with a handful of independent hiccups.
 * On ANBB it was nothing of the kind. Action [125] is a `decide` the engine can
 * no longer accept; the decision it was meant to answer therefore stays open
 * forever, and `apply()` refuses EVERY later action by EITHER seat with "a
 * decision is pending for Ben". Fourteen of those fifteen "skips" are one
 * failure wearing fourteen hats. The orchestrator read them as fourteen
 * findings and briefed an agent on thirteen of them; all thirteen were phantom.
 *
 * So the shape of the report is now:
 *
 *   1. the FIRST action this engine refused — index, type, seat, reason. That
 *      is the DIVERGENCE POINT, and it is the only refusal in the file that is
 *      evidence about anything on its own.
 *   2. everything after it, stated as cascade. From the divergence point on,
 *      the replay is running a board the logged game never had, so a later
 *      refusal is not a second finding and a later SUCCESS is not a second
 *      confirmation.
 *   3. the WEDGE, when there is one, proved rather than guessed: a run of
 *      consecutive refusals all standing under the same still-open decision.
 *      That is a total replay loss, not a partial one.
 *
 * The count is still printed. It is never printed alone.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Action, CardName, Element, EngineEvent, GameMode, Seat } from '../engine/src/types.ts';
import { apply, checkDeck, createGame, sanitizeTrio, IllegalAction } from '../engine/src/apply.ts';

/**
 * `Fork` / `LostAction` are the shapes `server/rooms.ts` WRITES into a saved
 * game. Until R181 they were restated here, structurally, because `rooms.ts`
 * pulls in `ws` and the whole socket layer and importing even a TYPE from it
 * dragged that into any project checking this analysis — engine/test/143
 * imports this file, and its `tsc` went from clean to 7 errors.
 *
 * The restatement was rot-prone in the one way that matters: a RENAME in
 * `rooms.ts` would leave this file compiling happily against a field the disk
 * no longer carries, the fork block below would stop printing, and
 * `unexplained` would go quietly empty — the opposite of loud. So the shapes
 * moved to `./types.ts`, which imports only engine types, declares no values,
 * and therefore can never pull `ws` in. Both sides now name the same interface
 * and a rename is a compile error on both.
 *
 * This file still reads every field defensively: its input is a FILE, and an
 * old one may predate any of them.
 */
import type { Fork, LostAction } from './types.ts';

/** the shape a game file has to have for this tool to say anything about it */
export interface RoomFile {
  seed: number; mode?: GameMode; els?: Element[]; names?: [string, string]; actions: Action[];
  winner?: number | null; forks?: Fork[];
  decks?: [CardName[] | null, CardName[] | null];
}

/**
 * One logged action the current engine refused, plus the two facts that make
 * a cascade provable rather than assumed:
 *   `pending`  the decision standing when it was refused (JSON, or null).
 *              Two refusals under the SAME standing decision are one wedge.
 *   `unanswerable`  the engine said this answer can never be accepted at all
 *              (`IllegalAction.unanswerable`), not merely that it is wrong
 *              right now. That is a divergence with no way back.
 */
export interface Refusal extends LostAction {
  pending: string | null;
  unanswerable: boolean;
}

export interface Analysis {
  events: EngineEvent[];
  state: ReturnType<typeof createGame>['state'];
  refusals: Refusal[];
  /** refusals the file's own `forks` block already accounts for */
  declaredLost: LostAction[];
  /** declared forks this engine can no longer reproduce */
  unexplained: number[];
  /** refusals beyond what the file admits to */
  extra: Refusal[];
  /** the FIRST refusal this file does not already declare — the divergence
   * point. Null means the replay never diverged. */
  divergedAt: Refusal | null;
  /** the consecutive refusals immediately after `divergedAt` that stand under
   * the very same unanswered decision. Cascade, provably. */
  cascade: Refusal[];
  /** true when `cascade` runs to the end of the log (or to the point the game
   * ended): from `divergedAt` on, nothing either seat logged was ever legal
   * again. A total replay loss. */
  wedged: boolean;
  /** the first index after the cascade that DID replay, if any */
  resumedAt: number | null;
}

const CLI = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

/** constructed games are dealt from the two saved decks — replaying one
 * without them is not a replay of the same game at all */
/**
 * The two constructed decks, or `undefined` for a non-constructed game.
 *
 * ⚠ THIS USED TO SUBSTITUTE ONE SEAT'S DECK FOR THE OTHER'S, SILENTLY. The old
 * body was `const a = ok[0].ok ? ok[0].cards : ok[1].ok ? ok[1].cards : null`
 * — so a deck that failed `checkDeck` was replaced by the OPPONENT'S, with no
 * warning, and the tool went on to replay a game nobody had ever played. It
 * threw only when BOTH decks were bad.
 *
 * That is the worst possible failure for a forensics tool: this repo settles
 * playtest reports by replaying saved games, so a quietly-wrong deck produces a
 * confident wrong answer about a real bug. And it was one rename away from
 * firing — `checkDeck` rejects unknown card names, and commit 3063f2b renamed
 * "Counter Theif" to "Counter Thief". Any stored deck holding the old spelling
 * would have made all eight constructed logs replay with BOTH SEATS ON ONE
 * DECK, reported not as "this file's deck no longer validates" but as a mystery
 * divergence somewhere in the midgame. (All eight validate at HEAD today, so
 * this was a live hazard rather than a live bug.)
 *
 * Now it names the seat and the reason and refuses. A replay that cannot be
 * trusted must not run.
 */
function decksOf(raw: RoomFile, mode: GameMode): [CardName[], CardName[]] | undefined {
  if (mode !== 'constructed') return undefined;
  const checked = [0, 1].map(s => checkDeck(raw.decks?.[s as 0 | 1]));
  const bad = checked
    .map((c, s) => (c.ok ? null : `seat ${s}: ${c.error}`))
    .filter((m): m is string => m !== null);
  if (bad.length) {
    throw new Error(
      `constructed game file has an unusable deck, so it cannot be replayed:\n  ${bad.join('\n  ')}\n`
      + '  (Refusing rather than substituting the other seat\'s deck — a replay of the wrong\n'
      + '   game is worse than no replay, because it answers confidently.)');
  }
  return [(checked[0] as { cards: CardName[] }).cards, (checked[1] as { cards: CardName[] }).cards];
}

/**
 * The recorded element trio, refusing the silent default.
 *
 * `sanitizeTrio(undefined)` returns `DRAFT_TRIO`, which is right for STARTING a
 * game and wrong for replaying one: a draft file with no recorded trio gets a
 * completely different deal, and the tool reports the result as engine drift.
 * Two files in the corpus are like this (GAXG and HDGG, both saved before
 * a890788 "Live draft: choose the three elements together"), and GAXG dies at
 * action [10] with "not an element of this game" — a message that blames the
 * engine for a missing field.
 */
function trioOf(raw: RoomFile, mode: GameMode): Element[] {
  if (mode === 'draft' && !Array.isArray(raw.els)) {
    throw new Error(
      'this draft game recorded no element trio (`els` is absent), so its deal cannot be\n'
      + '  reproduced — sanitizeTrio would substitute the default and replay a different game.\n'
      + '  Files saved before the live-draft change (a890788) are in this state and are\n'
      + '  permanently unreplayable; they are not evidence about anything.');
  }
  return sanitizeTrio(raw.els);
}

function runOnce(raw: RoomFile): Pick<Analysis, 'events' | 'state' | 'refusals'> {
  const names = raw.names ?? ['Player 1', 'Player 2'];
  const mode = raw.mode ?? 'shared';
  let { state, events } = createGame(raw.seed, names, mode, trioOf(raw, mode), decksOf(raw, mode));
  const all = [...events];
  const refusals: Refusal[] = [];
  raw.actions.forEach((a, i) => {
    try {
      const r = apply(state, a);
      state = r.state;
      all.push(...r.events);
    } catch (err) {
      if (!(err instanceof IllegalAction)) throw err;
      // `apply` is pure over a clone, so `state` is untouched by a refusal —
      // the decision recorded here is the one that was standing at the time,
      // which is exactly what makes the cascade test below sound.
      refusals.push({
        i, type: a.type, seat: a.seat as Seat, why: err.message,
        pending: state.decision ? JSON.stringify(state.decision) : null,
        unanswerable: err.unanswerable === true,
      });
    }
  });
  return { events: all, state, refusals };
}

/**
 * Replay the file and work out WHERE it stopped being a replay.
 *
 * The cascade test is deliberately structural rather than message-matching: a
 * refusal counts as cascade when the decision standing over it is byte-for-byte
 * the decision that was standing when the divergence happened. Nothing has
 * answered it in between, so the engine is not being asked a new question — it
 * is being asked the same one again, and its refusal carries no new
 * information. That catches a wedge from ANY cause, including ones that do not
 * exist yet, where matching on "a decision is pending for X" would not.
 */
export function analyze(raw: RoomFile): Analysis {
  const a = runOnce(raw);
  const declared: Fork[] = Array.isArray(raw.forks) ? raw.forks : [];
  const declaredLost = declared.flatMap(f => f.lost ?? []);
  const declaredIdx = new Set(declaredLost.map(l => l.i));
  const todayIdx = new Set(a.refusals.map(l => l.i));
  const unexplained = [...declaredIdx].filter(i => !todayIdx.has(i));
  const extra = a.refusals.filter(l => !declaredIdx.has(l.i));

  const divergedAt = extra[0] ?? null;
  const byIndex = new Map(a.refusals.map(r => [r.i, r]));
  const cascade: Refusal[] = [];
  if (divergedAt && divergedAt.pending !== null) {
    for (let i = divergedAt.i + 1; i < raw.actions.length; i++) {
      const r = byIndex.get(i);
      if (!r || r.pending !== divergedAt.pending) break;
      cascade.push(r);
    }
  }
  const after = divergedAt ? divergedAt.i + 1 + cascade.length : raw.actions.length;
  const resumedAt = divergedAt && after < raw.actions.length ? after : null;
  // a wedge that runs to the last logged action, or to the one action that can
  // always end a game under an open question (R65: concede is exempt from the
  // decision gate on purpose), is a total loss of the rest of the log
  const wedged = cascade.length > 0
    && (resumedAt === null || raw.actions[resumedAt]!.type === 'concede');

  return { ...a, declaredLost, unexplained, extra, divergedAt, cascade, wedged, resumedAt };
}

/** the report, as lines. Exported so a test can read what the tool SAYS,
 * not merely what it computes — the misreading CT-45 is about happened in
 * the prose, not in the numbers. */
export function reportLines(file: string, raw: RoomFile, an: Analysis, opts: {
  showLog?: boolean; deterministic?: boolean;
} = {}): { lines: string[]; exit: number } {
  const out: string[] = [];
  const say = (s: string): void => { out.push(s); };
  const names = raw.names ?? ['Player 1', 'Player 2'];
  const mode = raw.mode ?? 'shared';
  const els = sanitizeTrio(raw.els);
  const n = raw.actions.length;
  const d = an.divergedAt;

  say(`\n═ ${file}`);
  say(`  mode ${mode}${mode === 'draft' ? ` · trio ${els.join('+')}` : ''} · seed ${raw.seed} · ${names.join(' vs ')}`);
  // CT-45: the count NEVER stands on its own line. Whatever else this says, it
  // says on the same breath whether the replay is still a replay.
  say(`  ${n} actions logged · ${n - an.refusals.length} replayed · ${an.refusals.length} refused`
    + (d
      ? `\n  ⛔ DIVERGES at action [${d.i}]`
        + (an.cascade.length
          ? ` — everything after it is CASCADE, and ${an.cascade.length} of those`
            + `\n     refusal${an.cascade.length === 1 ? ' is' : 's are'} that one failure wearing `
            + `${an.cascade.length === 1 ? 'a second hat' : 'many hats'}. Read the verdict, not the count.`
          : ' — everything after it is CASCADE, not separate\n     findings. Read the verdict, not the count.')
      : an.refusals.length
        ? '\n  (every refusal is a fork this file declares — see below)'
        : '\n  ✓ no divergence'));
  if (opts.deterministic !== undefined) {
    say(`  determinism: ${opts.deterministic ? 'OK (two runs identical)' : '⚠ DIVERGED — engine bug, report this'}`);
  }

  if (opts.showLog) {
    say('\n── game log ──');
    for (const ev of an.events) say('  ' + ev.msg);
  }

  const s = an.state;
  say('\n── final position ──');
  if (d) {
    say(`  ⚠ NOT the position the logged game reached — the replay left that`);
    say(`    board at action [${d.i}]. This is where THIS run ended up.`);
  }
  say(`  turn ${s.turn} · phase ${s.phase}${s.winner !== null ? ` · WINNER: ${names[s.winner]}` : ''}`);
  s.players.forEach(p => say(
    `  ${p.name}: ${p.life} life · ${p.hand.length} in hand · ${p.bin.length} in bin · ${p.resources.length} resources`));
  const units = Object.values(s.entities).filter(e => e.kind === 'unit');
  say(`  units in play: ${units.map(u => `${u.card} (${names[u.controller]})`).join(', ') || 'none'}`);

  // ── what the file says about itself ──────────────────────────────────
  const declared: Fork[] = Array.isArray(raw.forks) ? raw.forks : [];
  if (declared.length) {
    say('\n── this file declares that it FORKED ──');
    say('  The server restarted mid-game onto an engine that could not replay');
    say('  part of the log, rebuilt the game without those actions, and play');
    say('  continued from there. The log below is not one game end to end.');
    for (const f of declared) {
      say(`  · ${f.at}: ${f.lost.length} of ${f.logged} actions could not be replayed;`);
      say(`      the game resumed at turn ${f.turn} ${f.phase}`);
      const byType = new Map<string, number>();
      for (const l of f.lost) byType.set(l.type, (byType.get(l.type) ?? 0) + 1);
      say(`      lost: ${[...byType].map(([t, k]) => `${k}× ${t}`).join(', ')}`);
      say(`      first at action ${f.lost[0]?.i} — "${f.lost[0]?.why}"`);
    }
  }

  // ── the verdict ──────────────────────────────────────────────────────
  say('\n── verdict ──');

  function listRefusals(list: Refusal[], limit = 20): void {
    for (const sk of list.slice(0, limit)) {
      const tag = d && sk.i > d.i ? '  (cascade)' : '';
      say(`  [${sk.i}] ${sk.type} (seat ${sk.seat})${tag}\n      → ${sk.why}`);
    }
    if (list.length > limit) say(`  … and ${list.length - limit} more`);
  }

  /** the block CT-45 exists to make impossible to skim past */
  function divergence(dv: Refusal): void {
    say(`  ⛔ DIVERGENCE at action [${dv.i}] — ${dv.type} (seat ${dv.seat}, ${names[dv.seat]})`);
    say(`       → ${dv.why}`);
    say('    THIS IS THE ONLY REFUSAL IN THIS FILE THAT IS EVIDENCE ON ITS OWN.');
    say('    From here on the replay is running a board the logged game never');
    say('    had, so every later refusal is CASCADE and every later success is');
    say('    coincidence. Do not count them, and do not file them.');
    if (dv.unanswerable) {
      say('    The engine reports this answer as UNANSWERABLE: not "wrong now"');
      say('    but "no reply of this shape can ever be accepted for the question');
      say('    now pending". The log and the engine disagree about what was');
      say('    being asked, so this is the whole finding.');
    }
    if (an.cascade.length) {
      const last = an.cascade[an.cascade.length - 1]!;
      say(`    ⛔ WEDGED: the decision open at [${dv.i}] (${names[JSON.parse(dv.pending!).seat]}: `
        + `"${JSON.parse(dv.pending!).prompt}")`);
      say(`       is still unanswered at [${last.i}]. All ${an.cascade.length} action(s) from`);
      say(`       [${an.cascade[0]!.i}] to [${last.i}] were refused under that same standing`);
      say('       question — ONE failure, not ' + an.cascade.length + '.');
      if (an.wedged) {
        say('       It never clears: this is a TOTAL loss of the log from');
        say(`       [${dv.i}] onward, reported above as ${an.refusals.length} refusals.`);
      } else if (an.resumedAt !== null) {
        say(`       Action [${an.resumedAt}] replayed again, but on a board that`);
        say('       had already parted company with the log.');
      }
    }
    say(`    Fix [${dv.i}] and re-run before drawing any conclusion from the rest.`);
  }

  let exit = 0;

  if (an.unexplained.length) {
    // The file claims actions could not be replayed that THIS engine accepts.
    // Nothing the server does can produce that: it means the engine moved back
    // under the file (a rules commit reverted), or the file has been edited.
    say('  ⚠ INCONSISTENT — the file declares forks this engine cannot reproduce.');
    say(`    ${an.unexplained.length} action(s) recorded as unreplayable now replay fine:`);
    say(`    indices ${an.unexplained.slice(0, 20).join(', ')}${an.unexplained.length > 20 ? ' …' : ''}`);
    say('    Either a rules change was reverted (re-check the fork against the');
    say('    engine it was recorded on) or this file has been hand-edited.');
    exit = 3;
  } else if (declared.length && !an.extra.length) {
    say('  ⚠ FORKED, and the file\'s own account of itself checks out.');
    say(`    Every one of the ${an.refusals.length} refusals above is a fork this file already`);
    say('    declares. Not a server bug: the game was interrupted by a rules');
    say('    change and rebuilt. Read the two halves as separate games.');
    exit = 2;
  } else if (declared.length && d) {
    say('  ⚠ FORKED, and the engine has drifted FURTHER since.');
    say(`    ${an.declaredLost.length} refusal(s) are declared forks. Beyond those:`);
    divergence(d);
    say(`    the ${an.extra.length} undeclared refusal(s):`);
    listRefusals(an.extra);
    exit = 2;
  } else if (d) {
    say('  ⚠ ENGINE DRIFT — the current engine refuses a move that was legal');
    say('    when this game was played. The FILE is fine: it is a true record');
    say('    of the game, and the rules have changed under it since. Expected');
    say('    after a rules commit; a surprise otherwise, and then this log has');
    say('    found you a regression.');
    divergence(d);
    say(`    all ${an.refusals.length} refusal(s), in order:`);
    listRefusals(an.refusals);
    exit = 2;
  } else {
    say('  ✓ FAITHFUL — every logged action replays cleanly under the current');
    say('    engine, and the file declares no forks. seed + actions reproduces');
    say('    this game exactly.');
  }

  if (opts.deterministic === false) exit = 3;
  return { lines: out, exit };
}

if (CLI) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node replay-room.ts games/<CODE>.json [--log]');
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(file, 'utf8')) as RoomFile;
  const an = analyze(raw);
  const b = analyze(raw);   // determinism double-check
  const deterministic = JSON.stringify(an.state) === JSON.stringify(b.state);
  const r = reportLines(file, raw, an, { showLog: process.argv.includes('--log'), deterministic });
  for (const line of r.lines) console.log(line);
  process.exit(r.exit);
}
