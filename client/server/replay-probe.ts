/* R200 — THE REFERENCE ENGINE'S HALF OF A DIFF.
 *
 *   node replay-probe.ts <file.json>        # one line of JSON on stdout
 *
 * `replay-room.ts` replays a saved game on the CURRENT engine and reports what
 * it refuses. That report can say THAT a file diverges. It structurally cannot
 * say WHAT changed, because it has nothing to compare against — and worse, the
 * only divergence point it can name is the first REFUSAL, which is an UPPER
 * BOUND and nothing more. Every case anyone has measured by hand came out
 * EARLIER than the refusal, by as much as six actions:
 *
 *   the rules change at action [k]  →  the action still applies, legally, but
 *   now means something else (another unit, another card off the deck, another
 *   roll) →  the two boards drift apart in silence  →  several actions later
 *   something finally becomes ILLEGAL and gets reported as "the divergence".
 *
 * Fixing [121] in SMVJ would have told you nothing: SMVJ's [121] is a `decide`
 * answering a decision the current engine never raised, so the thing that
 * actually moved is upstream of it and invisible from one replay alone.
 *
 * So this file is the other end of a DIFF. It runs a log and emits a per-action
 * SIGNATURE of the board. `replay-room.ts --as-recorded` checks out the commit
 * the file says it was recorded at, drops this probe into that worktree, runs
 * it there against the OLD engine, and compares signature-for-signature with
 * the same probe run at HEAD. The first index where the two disagree is the
 * REAL divergence, and the two signatures side by side say what changed.
 *
 * ── WHY THIS IS ITS OWN FILE, AND WHY IT IS SMALL ─────────────────────
 *
 * It is executed inside a checkout of an ARBITRARY PAST COMMIT of this repo.
 * So it may import exactly one thing — `../engine/src/apply.ts` — because that
 * path has existed for the whole life of the project, and it must survive
 * everything else about that commit being different: fields that did not exist
 * yet, `createGame` taking fewer arguments, `sanitizeTrio` not being exported.
 * Every read below is therefore defensive and every state is typed `unknown`
 * and narrowed here rather than imported from `../engine/src/types.ts`, whose
 * shape is precisely the thing that differs between the two ends of the diff.
 *
 * ── WHAT GOES IN A SIGNATURE ──────────────────────────────────────────
 *
 * Not `JSON.stringify(state)`. That compares the two engines' STRUCT LAYOUT,
 * so adding one optional field to GameState would report every saved game as
 * diverging at action 0 — a diff that is always red says nothing.
 *
 * The signature is a SEMANTIC projection instead: the things a player could
 * point at across the table, written in card names and counts rather than in
 * entity ids, and sorted so that a renumbering cannot move it. Ids are the
 * classic false positive — two engines allocating the same board differently
 * is not a rules change — and `rooms.ts`'s undo gate already learned this the
 * hard way (see `symbolizer`/`referenceKey` there, same idea, different job).
 *
 * It is deliberately SENSITIVE about zone CONTENTS: hand and bin go in by name,
 * not by count. The failure this whole ticket is about is an action that stays
 * legal while meaning something else, and a count would sail straight past a
 * different card being drawn.
 */
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, unknown>;

const rec = (v: unknown): Rec => (v && typeof v === 'object' ? v as Rec : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): string => (typeof v === 'number' ? String(v) : '-');
const str = (v: unknown): string => (typeof v === 'string' ? v : v === null ? 'null' : '-');

/** Cards in a zone, in order — order matters in a deck-shaped zone and a hand
 * is small enough that its order is real information about the draw. */
const cards = (v: unknown): string => arr(v).map(c => (typeof c === 'string' ? c : JSON.stringify(c))).join(',');

/** One seat, as everything about it anybody can name. */
function playerSig(p: unknown): string {
  const q = rec(p);
  return [
    `life=${num(q['life'])}`,
    `hand=[${cards(q['hand'])}]`,
    `bin=[${cards(q['bin'])}]`,
    `res=[${arr(q['resources']).map(r => `${str(rec(r)['kind'])}:${str(rec(r)['state'])}`).join(',')}]`,
    `cache=[${arr(q['cache']).map(c => str(rec(c)['card'])).join(',')}]`,
    `erased=[${cards(q['erased'])}]`,
    `rot=${num(q['rot'] ?? 0)}`,
    `debt=${num(q['debt'] ?? 0)}`,
    `acts=${num(q['activationsLeft'])}`,
  ].join(' ');
}

/**
 * Everything in play, sorted and id-free.
 *
 * ⚠ The id is NOT in here, on purpose. Two engines can produce the identical
 * board and number it differently (an effect that allocates an id it later
 * frees, a decision id off `nextId` — R85 does exactly that), and a diff that
 * calls THAT a rules change would fire on every file and mean nothing.
 */
function entitiesSig(v: unknown): string {
  return Object.values(rec(v)).map(e => {
    const q = rec(e);
    return `${str(q['kind'])}:${str(q['card'])}@${num(q['controller'])}`
      + `/r${num(q['region'])} dmg${num(q['damage'])} ctr${num(q['counters'])}`
      + ` tmp${num(q['tempPower'])}/${num(q['tempToughness'])}`
      + ` attrs[${arr(q['tempAttrs']).map(a => str(a)).sort().join(',')}]`;
  }).sort().join(' | ');
}

/** The stack, in stack order — order IS the semantics here. */
function stackSig(v: unknown): string {
  return arr(v).map(i => {
    const q = rec(i);
    return `${str(q['kind'])}:${str(q['card'] ?? q['label'])}@${num(q['controller'])}${q['negated'] ? '!neg' : ''}`;
  }).join(' > ');
}

/** The open question, by what it ASKS rather than by its id. */
function decisionSig(v: unknown): string {
  if (!v) return 'none';
  const q = rec(v);
  return `${str(q['kind'])}/seat${num(q['seat'])}/"${str(q['prompt'])}"`
    + `/[${arr(q['options']).map(o => str(rec(o)['label'])).join('|')}]`;
}

/**
 * A version-stable, semantic fingerprint of one board.
 *
 * Two engines that agree on this agree about the game. Two that do not have
 * had a rules change between them, and the two strings say what it was.
 */
export function signature(state: unknown): string {
  const s = rec(state);
  const ps = arr(s['players']);
  return [
    `turn=${num(s['turn'])} phase=${str(s['phase'])} init=${num(s['initiative'])}`
      + ` winner=${s['winner'] === null ? 'none' : num(s['winner'])}`
      + ` round=${num(s['battleRound'])} prio=${s['priority'] === null ? 'none' : num(s['priority'])}`
      + ` passes=${num(s['passes'])}`,
    `P0 ${playerSig(ps[0])}`,
    `P1 ${playerSig(ps[1])}`,
    `play ${entitiesSig(s['entities'])}`,
    `stack ${stackSig(s['stack'])}`,
    `ask ${decisionSig(s['decision'])}`,
    `packs [${arr(s['packs']).map(p => `(${cards(p)})`).join(' ')}]`,
    // R296 — CARDS LEFT, NOT DECK LENGTH, and the two stopped being the same
    // number when the MARK arrived. A recycled card used to go onto the bottom
    // of `sharedDeck`; it goes into `sharedRecycled` now. Counting only the
    // deck would report every pre-R296 game as parting for good at its FIRST
    // RECYCLE — a permanent difference in a number nobody can point at, on a
    // board where nothing a player could see had changed. (Measured: it took
    // the fuzz fixture's parting from action 95 to action 0 and emptied the
    // healed list, which is how this was found.)
    //
    // The sum is the honest projection: R296 moved the mark, not the cards.
    // An old engine has no `sharedRecycled`, so `arr()` reads 0 and its deck
    // already holds what the new engine keeps behind the mark — the totals
    // agree, exactly as the boards do. Where the two really diverge is which
    // cards come OUT, and that lands in hands and bins, which go in by name.
    //
    // This works because `replay-room.ts` copies THIS file into the reference
    // worktree (`copyFileSync(probeSrc, dest)`), so one signature runs on both
    // ends of the diff. A projection change is therefore applied to the past
    // as well as the present, which is the whole reason it may be changed at
    // all.
    `deck ${arr(s['sharedDeck']).length + arr(s['sharedRecycled']).length}${
      arr(s['decks']).length
        ? `/${arr(s['decks']).map((d, i) => arr(d).length + arr(arr(s['recycled'])[i]).length).join(',')}`
        : ''}`,
  ].join('\n  ');
}

/**
 * A signature, shortened for the wire.
 *
 * The signatures themselves are ~2KB each and a real game has 300+ of them, so
 * shipping them all out of the reference process is most of a megabyte through
 * a pipe to answer one question: *where do these two runs first disagree?* A
 * hash answers that exactly, and the caller then asks for the ONE full
 * signature it turned out to need (`--at`). Two cheap runs instead of one fat
 * one, and the comparison is bit-exact either way.
 */
export const digest = (sig: string): string => createHash('sha1').update(sig).digest('hex').slice(0, 16);

/** One logged action this engine would not accept. */
export interface ProbeRefusal { i: number; type: string; seat: number; why: string }

export interface ProbeResult {
  /** false when the game could not even be BUILT here (an old engine that
   * cannot make this kind of room at all) — then `error` says why and nothing
   * else in here means anything */
  ok: boolean;
  error?: string;
  /** the commit this probe believes it ran at (informational; `--as-recorded`
   * knows which worktree it launched and does not trust this over that) */
  sha?: string;
  /**
   * `sigs[0]` is the board after the DEAL, and `sigs[i+1]` the board after
   * logged action `i`. Length is always `actions.length + 1`, so a refused
   * action simply repeats the previous signature — which is the truth: the
   * board did not move.
   */
  sigs: string[];
  refusals: ProbeRefusal[];
}

/** the room-file fields a probe needs; every one optional, because the file
 * may be older than any of them */
export interface ProbeInput {
  seed: number;
  mode?: string;
  els?: string[];
  names?: [string, string];
  actions: unknown[];
  decks?: unknown;
  /**
   * R216 — the scenario this room was dealt with, if any.
   *
   * ⚠ THIS FILE CANNOT HONOUR IT, AND SAYS SO RATHER THAN GUESSING. Everything
   * else here is written to run against an engine checked out at a PAST
   * commit: it reaches for `createGame` by name, tolerates `sanitizeTrio` and
   * `checkDeck` being absent, and never assumes an argument exists. A
   * scenario's board mutation is not in that engine — it lives in
   * `server/scenarios.ts` beside TODAY's rules, uses today's `E` and today's
   * card definitions, and there is no honest way to replay it inside a
   * historical worktree.
   *
   * Probing a scenario room anyway would deal the plain opening board, replay
   * a log written for a completely different one, and report the resulting
   * mess as a rules change — which is precisely the wrong answer R200 exists
   * to stop being given. So `probe()` refuses by name. A refusal is a true
   * statement about the file; a divergence report would be a false one.
   */
  scenario?: string;
}

/**
 * Replay a log on WHATEVER engine this file was loaded next to, recording the
 * board after every action.
 *
 * Refusals are collected, not thrown: the point of the diff is to see how far
 * the two engines agree, and stopping at the first refusal on the reference
 * side would throw away the part of the comparison that matters.
 */
export async function probe(raw: ProbeInput): Promise<ProbeResult> {
  // R216 — see ProbeInput.scenario. Refused before the engine is even loaded,
  // because there is nothing an engine of any vintage could do about it.
  if (raw.scenario) {
    return {
      ok: false,
      error: `this room was dealt with scenario '${raw.scenario}' (R216), and a scenario board `
        + 'is built by server/scenarios.ts against the CURRENT engine. A historical engine '
        + 'cannot reproduce it, so probing here would replay the log onto the wrong board and '
        + 'report a rules change that did not happen. Use --as-recorded on this build instead.',
      sigs: [], refusals: [],
    };
  }
  // BL-43 — a custom deal likewise. An engine from before BL-43 takes no deal
  // argument, ignores a sixth one without complaint, and would deal a STANDARD
  // game under this log. Refused for the same reason as a scenario.
  if ((raw as { custom?: unknown }).custom) {
    return {
      ok: false,
      error: 'this room was dealt with custom rules (BL-43), and an engine from before BL-43 '
        + 'cannot deal them — it would replay the log onto a standard deal and report a rules '
        + 'change that did not happen. Use --as-recorded on this build instead.',
      sigs: [], refusals: [],
    };
  }
  let engine: Rec;
  try {
    engine = rec(await import('../engine/src/apply.ts'));
  } catch (err) {
    return { ok: false, error: `no engine here: ${err instanceof Error ? err.message : String(err)}`, sigs: [], refusals: [] };
  }
  const createGame = engine['createGame'] as ((...a: unknown[]) => Rec) | undefined;
  const apply = engine['apply'] as ((...a: unknown[]) => Rec) | undefined;
  if (!createGame || !apply) {
    return { ok: false, error: 'this engine exports no createGame/apply', sigs: [], refusals: [] };
  }
  // `sanitizeTrio` and `checkDeck` are both younger than the oldest logs, so
  // neither may be assumed to exist. Absent, the file's own fields are passed
  // through untouched, which is what an engine of that vintage expected.
  const sanitizeTrio = engine['sanitizeTrio'] as ((e: unknown) => unknown) | undefined;
  const checkDeck = engine['checkDeck'] as ((d: unknown) => Rec) | undefined;

  const names = raw.names ?? ['Player 1', 'Player 2'];
  const mode = raw.mode ?? 'shared';
  const els = sanitizeTrio ? sanitizeTrio(raw.els) : raw.els;
  let decks: unknown;
  if (mode === 'constructed' && checkDeck) {
    const d = [0, 1].map(i => checkDeck(arr(raw.decks)[i]));
    if (d.every(c => c['ok'])) decks = d.map(c => c['cards']);
  }

  let state: unknown;
  try {
    state = rec(createGame(raw.seed, names, mode, els, decks))['state'];
  } catch (err) {
    return { ok: false, error: `createGame refused this file: ${err instanceof Error ? err.message : String(err)}`, sigs: [], refusals: [] };
  }

  const sigs = [signature(state)];
  const refusals: ProbeRefusal[] = [];
  raw.actions.forEach((a, i) => {
    try {
      state = rec(apply(state, a))['state'];
    } catch (err) {
      const q = rec(a);
      refusals.push({
        i, type: str(q['type']), seat: typeof q['seat'] === 'number' ? q['seat'] : -1,
        why: err instanceof Error ? err.message : String(err),
      });
    }
    sigs.push(signature(state));
  });
  return { ok: true, sigs, refusals };
}

const CLI = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (CLI) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node replay-probe.ts <file.json> [--at <index>]'); process.exit(1); }
  const atFlag = process.argv.indexOf('--at');
  const at = atFlag >= 0 ? Number(process.argv[atFlag + 1]) : -1;
  const raw = JSON.parse(readFileSync(file, 'utf8')) as ProbeInput;
  // One line of JSON on stdout and nothing else, ever: the caller is another
  // process reading this back, and a stray console.log would corrupt the diff.
  const r = await probe(raw);
  const payload = at >= 0
    ? { ok: r.ok, error: r.error, at, sig: r.sigs[at] ?? null }
    : { ok: r.ok, error: r.error, hashes: r.sigs.map(digest), refusals: r.refusals };
  // ⚠ `process.exit()` here TRUNCATES the write — stdout to a pipe is async,
  // and the first version of this file lost the tail of every large payload,
  // which the caller then reported as malformed JSON. Set the code and let the
  // process end on its own once the buffer has drained.
  process.stdout.write(JSON.stringify(payload) + '\n');
  process.exitCode = r.ok ? 0 : 1;
}
