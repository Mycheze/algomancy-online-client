/* Competitive Constructed (doc 22 §3, §7 Risk 1) — THE DRIFT GUARD.
 *
 * CC changes who may act in the resource, haste and deploy steps. It does so
 * only on a state that carries `sequential`, which only `createGame(..., rules)`
 * stamps. Every game that exists today was dealt without `rules`, so for every
 * one of them the engine must be BYTE-IDENTICAL to the engine before CC:
 * the same state after every action, the same events, and the same legal list
 * for both seats (the fuzz and the UI index into it — memory
 * "new-legal-action-drifts-fuzz", "replay-drift-is-silent").
 *
 * The golden (`fixtures/800-drift-golden.json`) was written by THIS file on the
 * engine of master ba32fcf4, before a line of CC existed (CC_DRIFT_WRITE=1).
 * It is a rolling hash per run, checkpointed every 10 steps, over:
 *   · every committed reference run (server/challenge-runs/, parked included),
 *   · the committed 697 Nyar run,
 *   · a fuzz sample: shared, live draft and constructed walks over legalActions.
 *
 * Proven to fail (2026-11-02): applying the CC clause to every game — the
 * `!s.sequential ||` guard dropped from E.planning, E.hasting or E.deploying,
 * one at a time — turns both tests red (the reference runs and the walks,
 * the resource-step flip within their first ten steps).
 *
 * NEVER re-bless this golden to make it pass. A red here means an existing
 * game now plays differently; that is a rules change for every saved game and
 * needs its own round.
 *
 * Re-blessed ELEVEN fuzz entries on 2026-11-10 (the designer's new printings).
 * Measured before the re-bless, by comparing every step with the previous
 * engine: `shared:1`–`shared:6` and `constructed:201`, `204`, `205`, `206` are
 * byte-identical once the six renamed cards are spelled the old way (Consuming
 * Mass, Bloatfiend, Oodvick, Lost Shade, The Birthmother, Stakoloth).
 * `constructed:203` moves at step 425 only because Haunting Memories now erases
 * itself, and matches step for step with that one line patched back. Every
 * reference run and the other seven fuzz entries are untouched.
 *
 * Re-blessed ONE entry on 2026-11-09 (report #344, CT-538, CR 714.2): a unit
 * sacrificed as its own ability's cost now leaves its last-known snapshot on
 * that ability. `ref:2026-11-29-owngoal` sacrifices Sprouter at its step 86.
 * Measured before the re-bless, recording every step on both engines: steps
 * 87–89 differ ONLY by `stack[0].lastKnown` (Sprouter, no attributes); with it
 * stripped, every state, event and legal list is identical. A full rewrite of
 * the golden moved that entry and no other.
 *
 * Re-blessed SIX fuzz entries on 2026-11-08 (report #342, CR 720.6): a unit's
 * mods now move with it between regions (the attack, a counterattacker's
 * arrival), where they used to keep the region they were applied in.
 * `shared:2`, `shared:5`, `shared:6`, `draft:102`, `draft:103` and
 * `constructed:206` moved. Measured before the re-bless, by recording every step
 * on both engines: the same actions, the same events and the same legal lists at
 * every step, and the states identical once each mod's region is set to its
 * host's. Every reference run and the other fuzz entries are untouched.
 *
 * Re-blessed WHOLE a second time on 2026-11-08: a trigger set off by a play or
 * activation now gives that player priority first (D2.9), on a judge's answer the
 * owner adopted. Only that order moved.
 *
 * Re-blessed WHOLE on 2026-11-08 for a deliberate rules change the owner ordered
 * knowing old games would play differently: an unheld play or activation now
 * counts as its actor's pass (CR 703.2b, D2.9), and the reference runs lost the
 * extra pass each recorded.
 *
 * Re-blessed ONCE, ONE entry, for a deliberate rules change (2026-11-04, CT-435,
 * CR 713.6e, staged for the owner): `shared:6` pays Deformant's "sacrifice me
 * and another ally" at its step 301, and the Deformant now stays in play
 * while the ally is picked (the two die together). Measured before the
 * re-bless: the walk picks the same 500 actions and ends in the same state
 * (log aside) on both engines; marks 0–29 are unchanged and every other run
 * here, reference and fuzz, still matches the pre-CC golden.
 *
 * Re-blessed a SECOND time, THREE entries, for a card errata rather than an
 * engine change (2026-11-06, the designer's new scan: Seer of Empty Spaces
 * costs [2], was [1]): `ref:2026-11-08-giant`, `ref:2026-12-13-health` and
 * `ref:2027-01-10-doubleko`. Measured before the re-bless, replaying each with
 * Seer patched back to [1] in memory: every run here matched the golden; at
 * [2] those three differ at ONE step (13) and only in a seat's LEGAL LIST — a
 * Seer in hand stops being affordable there — while the state and events of
 * every step are byte-identical, so the runs play out the same game and still
 * score their par (506). Every other entry is untouched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import '../src/cards/registry.ts';
import { createGame } from '../src/apply.ts';
import { DUMMY_DECK, challengeDeal } from '../src/challenge.ts';
import { CHALLENGES, REFERENCE_RUNS_DIR, challengeById } from '../../server/challenges.ts';
import type { Action, CardName } from '../src/types.ts';
import { Trace, randomDeck, traceReplay, walk } from './cc-walk.ts';

const GOLDEN = new URL('./fixtures/800-drift-golden.json', import.meta.url);
const NYAR = new URL('./fixtures/697-nyar-token-gesture-run.json', import.meta.url);

type Run = { steps: number; marks: string[]; final: string };

function referenceRuns(): Record<string, Run> {
  const out: Record<string, Run> = {};
  const files: string[] = [];
  for (const dir of [REFERENCE_RUNS_DIR, join(REFERENCE_RUNS_DIR, 'parked')]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) if (f.endsWith('.json')) files.push(join(dir, f));
  }
  for (const f of files) {
    const row = JSON.parse(readFileSync(f, 'utf8')) as { challengeId: string; deck: CardName[]; actions: Action[] };
    const def = challengeById(row.challengeId, CHALLENGES);
    if (!def) continue;
    const t = new Trace();
    traceReplay(createGame(def.seed, ['Challenger', 'Dummy'], 'constructed', undefined,
      [[...row.deck], [...DUMMY_DECK]], undefined, challengeDeal(def)), row.actions, t);
    out[`ref:${row.challengeId}`] = t.done();
  }
  const nyar = JSON.parse(readFileSync(NYAR, 'utf8')) as
    { run: { def: { seed: number } & Record<string, unknown>; deck: CardName[]; actions: Action[] } };
  const t = new Trace();
  traceReplay(createGame(nyar.run.def.seed, ['Challenger', 'Dummy'], 'constructed', undefined,
    [[...nyar.run.deck], [...DUMMY_DECK]], undefined, challengeDeal({ ...nyar.run.def, blurb: '' } as never)), nyar.run.actions, t);
  out['fixture:697-nyar'] = t.done();
  return out;
}

const FUZZ: { key: string; seed: number; mode: 'shared' | 'draft' | 'constructed' }[] = [
  ...[1, 2, 3, 4, 5, 6].map(seed => ({ key: `shared:${seed}`, seed, mode: 'shared' as const })),
  ...[101, 102, 103, 104].map(seed => ({ key: `draft:${seed}`, seed, mode: 'draft' as const })),
  ...[201, 202, 203, 204, 205, 206, 207, 208].map(seed => ({ key: `constructed:${seed}`, seed, mode: 'constructed' as const })),
];

function fuzzRuns(): Record<string, Run> {
  const out: Record<string, Run> = {};
  for (const f of FUZZ) {
    const t = new Trace();
    walk(f.seed, {
      mode: f.mode, maxActions: 500, trace: t,
      ...(f.mode === 'constructed' ? { decks: [randomDeck(f.seed), randomDeck(f.seed + 7919)] as [CardName[], CardName[]] } : {}),
    });
    out[f.key] = t.done();
  }
  return out;
}

function compare(name: string, got: Run, want: Run | undefined): void {
  assert.ok(want, `${name}: not in the golden`);
  const at = got.marks.findIndex((m, i) => m !== want.marks[i]);
  assert.ok(at < 0 && got.steps === want.steps && got.final === want.final,
    `${name}: drifted — ${at >= 0 ? `first difference within steps ${at * 10 + 1}–${(at + 1) * 10}` : `steps ${got.steps} vs ${want.steps}`}`);
}

if (process.env['CC_DRIFT_WRITE'] === '1') {
  writeFileSync(GOLDEN, JSON.stringify({ engine: 'master ba32fcf4 (pre-CC)', runs: { ...referenceRuns(), ...fuzzRuns() } }, null, 1) + '\n');
}

const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as { runs: Record<string, Run> };

test('CC drift guard: every committed reference run replays byte-identical without rules', () => {
  const runs = referenceRuns();
  assert.ok(Object.keys(runs).length >= 10, 'the committed runs were found');
  for (const [k, r] of Object.entries(runs)) compare(k, r, golden.runs[k]);
  for (const k of Object.keys(golden.runs)) if (!k.startsWith('shared:') && !k.startsWith('draft:') && !k.startsWith('constructed:')) {
    assert.ok(runs[k], `${k}: in the golden but no longer replayed`);
  }
});

test('CC drift guard: a fuzz sample of shared, draft and constructed walks is byte-identical without rules', () => {
  const runs = fuzzRuns();
  for (const f of FUZZ) compare(f.key, runs[f.key]!, golden.runs[f.key]);
  // the sample reaches every step CC touches: a constructed walk goes past turn 1
  assert.ok(FUZZ.filter(f => f.mode === 'constructed').every(f => golden.runs[f.key]!.steps > 40));
});
