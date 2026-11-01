/* WEEKLY CHALLENGES — re-score the stored runs after the SCORING rule changed.
 *
 *   node server/challenge-rescore.ts [--dir <var/challenges>] [--write] [--refreeze]
 *
 * Owner, 2026-11-01: debt still owed when the goal is met costs the turns it
 * would take to pay off (engine challenge.ts `debtPayoffTurns`). A run stamped
 * before that has the old `turns`. This replays every stored run on THIS
 * tree's engine and, where the run still goes exactly as stamped — accepted,
 * the goal met at its last action, the same cards, copies, elements and met
 * turn — appends its new score to rescores.jsonl, which the store lays over
 * the stamp (challenge-store.ts header). A run whose new score is the same is
 * left alone. A run that no longer reproduces is named and kept as stamped:
 * its debt at the goal cannot be read off a game that goes differently.
 *
 * Dry run unless `--write`. `--refreeze` also drops every frozen week whose
 * frozen rows hold a re-scored run, so the server's sweep refreezes it from
 * the new scores (the freeze only counts runs from before the close, so it
 * gives the week's answer whenever it runs). Run it with the server stopped,
 * or before the restart that deploys the new scoring: the store reads both
 * files at boot. Idempotent: a run already re-scored under this rule, or
 * stamped with `debtTurns` (on the new rule from the start), is skipped.
 */
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyRun, type RunScore } from '../engine/src/challenge.ts';
import { challengeById } from './challenges.ts';
import { challengesDir } from './statepaths.ts';
import type { RescoreRow, RunRow } from './challenge-store.ts';

export const RULE = 'debt-2026-11-01';

export interface RescoreReport {
  rescored: { runId: string; name: string; challengeId: string; from: RunScore; to: RunScore }[];
  unchanged: number;
  skipped: number;
  kept: { runId: string; name: string; challengeId: string; why: string }[];
  refrozen: string[];
}

/** the same run as stamped, apart from the debt turns the new rule adds */
function sameRun(stamped: RunScore, live: RunScore): boolean {
  return stamped.unique === live.unique && stamped.extra === live.extra && stamped.cards === live.cards
    && stamped.elements === live.elements && stamped.turns === live.turns - (live.debtTurns ?? 0);
}

export function rescore(dir: string, opts: { write?: boolean; refreeze?: boolean } = {}): RescoreReport {
  const rep: RescoreReport = { rescored: [], unchanged: 0, skipped: 0, kept: [], refrozen: [] };
  const done = new Set<string>();
  try {
    for (const line of readFileSync(join(dir, 'rescores.jsonl'), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line) as RescoreRow; if (r.rule === RULE) done.add(r.runId); } catch { /* skip */ }
    }
  } catch { /* none yet */ }
  const rows: RunRow[] = readFileSync(join(dir, 'runs.jsonl'), 'utf8').split('\n').filter(l => l.trim())
    .flatMap(l => { try { return [JSON.parse(l) as RunRow]; } catch { return []; } });
  for (const r of rows) {
    if (done.has(r.runId) || r.score.debtTurns !== undefined) { rep.skipped++; continue; }
    const def = challengeById(r.challengeId);
    if (!def) { rep.kept.push({ runId: r.runId, name: r.name, challengeId: r.challengeId, why: 'no such challenge' }); continue; }
    const v = verifyRun(def, r.deck, r.actions);
    const why = !v.ok ? v.error
      : v.actions.length !== r.actions.length ? `meets the goal at action ${v.actions.length}, not ${r.actions.length}`
      : !sameRun(r.score, v.score) ? `scores ${v.score.turns}/${v.score.cards}/${v.score.elements}, stamped ${r.score.turns}/${r.score.cards}/${r.score.elements}`
      : null;
    if (why || !v.ok) { rep.kept.push({ runId: r.runId, name: r.name, challengeId: r.challengeId, why: why ?? '' }); continue; }
    if (!v.score.debtTurns) { rep.unchanged++; continue; }
    rep.rescored.push({ runId: r.runId, name: r.name, challengeId: r.challengeId, from: r.score, to: v.score });
    if (opts.write) {
      const row: RescoreRow = { runId: r.runId, rule: RULE, score: v.score };
      appendFileSync(join(dir, 'rescores.jsonl'), `${JSON.stringify(row)}\n`);
    }
  }
  if (opts.refreeze && rep.rescored.length) {
    const file = join(dir, 'weeks.json');
    let weeks: { version: number; weeks: Record<string, { boards: Record<string, { runId: string }[]> }> } | null = null;
    try { weeks = JSON.parse(readFileSync(file, 'utf8')); } catch { /* nothing frozen */ }
    const changed = new Set(rep.rescored.map(x => x.runId));
    for (const [id, w] of Object.entries(weeks?.weeks ?? {})) {
      if (Object.values(w.boards).some(rows => rows.some(row => changed.has(row.runId)))) rep.refrozen.push(id);
    }
    if (opts.write && weeks && rep.refrozen.length) {
      for (const id of rep.refrozen) delete weeks.weeks[id];
      writeFileSync(`${file}.tmp`, JSON.stringify(weeks, null, 1));
      renameSync(`${file}.tmp`, file);
    }
  }
  return rep;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--dir');
  const dir = at >= 0 ? args[at + 1]! : challengesDir();
  const write = args.includes('--write');
  const r = rescore(dir, { write, refreeze: args.includes('--refreeze') });
  const s = (x: RunScore): string => `${x.turns}/${x.cards}/${x.elements}`;
  for (const x of r.rescored) {
    console.log(`${write ? 're-scored' : 'would re-score'} ${x.challengeId} ${x.name} ${x.runId}: ${s(x.from)} → ${s(x.to)} (${x.to.debt} debt, +${x.to.debtTurns})`);
  }
  for (const x of r.kept) console.log(`kept as stamped ${x.challengeId} ${x.name} ${x.runId}: ${x.why}`);
  if (r.refrozen.length) console.log(`${write ? 'dropped' : 'would drop'} the frozen weeks ${r.refrozen.join(', ')} (the sweep refreezes them)`);
  console.log(`${r.rescored.length} re-scored, ${r.unchanged} unchanged, ${r.kept.length} kept as stamped, ${r.skipped} already done${write ? '' : ' — dry run, pass --write'}`);
}
