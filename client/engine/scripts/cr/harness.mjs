/**
 * THE HARNESS for the comprehensive-rules draft → mutate → verify → judge →
 * revise loop (data/comprehensive-rules/README.md; contract clauses 3, 4, 6).
 * Deterministic: no clock, no randomness — the shuffle is seeded by unit and
 * round. Every subcommand prints ONE JSON object on stdout (`{error}` and exit 1
 * on failure).
 *
 *   node client/engine/scripts/cr/harness.mjs plant    --unit U12 --round K --mutants <file> [--force]
 *   node client/engine/scripts/cr/harness.mjs keys     --unit U12 --round K
 *   node client/engine/scripts/cr/harness.mjs judge    --unit U12 --round K [--attempt A]
 *   node client/engine/scripts/cr/harness.mjs feedback --unit U12 --round K
 *   node client/engine/scripts/cr/harness.mjs finalize --unit U12
 *   node client/engine/scripts/cr/harness.mjs stamp    --unit U12 [--refresh]
 *   node client/engine/scripts/cr/harness.mjs status   [--unit U12]
 *
 * FILES (U = the unit, K = the round, A = the attempt; attempt 1 has no suffix)
 *   rules/U.json                          the records (the drafter's and reviser's)
 *   build/verify-input/U-rK.json          what the verifier sees: the round's records,
 *                                         drafter-only fields stripped, mutants planted, shuffled
 *   build/harness/U/mutants-rK.json       the ground truth: the round's keys, each mutant,
 *                                         and the record as verified (text + examples) per key
 *   build/verdicts/U-rK[-aA].json         the verifier's output {unit, round, verdicts, bugs}
 *   build/harness/U/judge-rK[-aA].json    caught / missed mutants, batchValid, bad quote spans
 *   build/harness/U/feedback-rK.json      the reviser's input: mutants removed
 *   build/harness/U/changed-rK.json       the reviser's output: the keys it changed
 *   verdicts/U.json, findings/U.json      finalize's output (committed)
 *
 * WHICH KEYS A ROUND VERIFIES. Round 1: every record. Round K>1: the keys the
 * reviser changed after round K-1, plus the keys round K-1 left UNVERIFIED —
 * the ones that carried a mutant (their real text was never shown) and any the
 * verifier skipped. A carried key cannot be mutated again, or it would never be
 * verified. When a round has fewer than three keys left to mutate, a key
 * verified in an earlier round with its text unchanged may HOST a mutant: it
 * joins the round only as the mutant, and its earlier verdict stands.
 *
 * A BATCH IS VALID when every planted mutant is caught: its verdict is
 * contradicted, partial or unsupported, with a non-empty problem. A batch that
 * confirms (or misses) any mutant is discarded whole and re-run by a fresh
 * verifier as attempt A+1 on the same input.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  CR_BUILD_DIR, CR_FINDINGS_DIR, CR_HARNESS_DIR, CR_LEDGER, CR_RULES_DIR, CR_VERDICTS_DIR,
  CR_VERIFY_INPUT_DIR, CR_VERIFY_OUTPUT_DIR, REPO_ROOT,
} from '../paths.mjs';
import { MAX_QUOTE, norm, parseRulingCite, recordHash } from './schema.mjs';

export class HarnessError extends Error {}
const fail = (m) => { throw new HarnessError(m); };

/* ── pure: the verifier's view of a record ─────────────────────────────── */

/** the fields a verifier may see; everything else (notes, confidence,
 *  rebuttal, parent/order, sourceHashes, untested …) is the drafter's */
export const VERIFIER_FIELDS = ['num', 'key', 'text', 'examples', 'see', 'sources', 'basis', 'engineDiffers'];

export function stripForVerifier(rec, num) {
  const out = {};
  const n = rec.num ?? num;
  if (n) out.num = n;
  for (const k of VERIFIER_FIELDS) {
    if (k === 'num' || rec[k] === undefined) continue;
    out[k] = k === 'examples'
      ? rec.examples.map((x) => ({ text: x.text, test: x.test ?? null }))
      : structuredClone(rec[k]);
  }
  return out;
}

const removed = (r) => /^\s*\[Removed\b/.test(String(r.text ?? ''));
/** the unit's rules (glossary rows and removed rules are never verified) */
export const liveRules = (records) => records.filter((r) => r && !('term' in r) && !removed(r));

/** the deterministic shuffle: order by a hash of unit, round and key */
export const shuffleRank = (unit, round, key) => createHash('sha256').update(`${unit}|r${round}|${key}`).digest('hex');

/** what is asserted / demonstrated: `true`, or text that starts "yes" */
export const says = (x) => x === true || /^\s*yes\b/i.test(String(x ?? ''));

/* ── pure: which keys a round takes ────────────────────────────────────── */

/**
 * → {keys, carried, mutable}. `prev` is null for round 1, else
 * {changed: [keys], unverified: [keys], hosts: [keys]} — `hosts` the keys
 * verified earlier whose text is unchanged (see usableHistory).
 */
export function roundKeys(records, round, prev) {
  const live = new Set(liveRules(records).map((r) => r.key));
  if (round === 1) {
    const keys = [...live].sort();
    return { keys, carried: [], mutable: keys };
  }
  if (!prev) fail(`round ${round} needs the previous round's changed and unverified keys`);
  const carried = [...new Set(prev.unverified)].filter((k) => live.has(k)).sort();
  const keys = [...new Set([...prev.changed, ...carried])].filter((k) => live.has(k)).sort();
  let mutable = keys.filter((k) => !carried.includes(k));
  if (mutable.length < 3) mutable = [...new Set([...mutable, ...(prev.hosts ?? []).filter((k) => live.has(k) && !keys.includes(k))])].sort();
  return { keys, carried, mutable };
}

/* ── pure: plant ───────────────────────────────────────────────────────── */

/**
 * Plant mutants into a round. → {input, truth}. Throws HarnessError on a
 * mutant that is identical to its original, for a key the round may not
 * mutate, duplicated, or empty; or on a count outside 2–3.
 *   records  the unit's rule records
 *   sel      roundKeys(…)
 *   mutants  [{key, mutant, why_false}]
 *   numOf    key → its ledger number (or undefined)
 */
export function plant({ unit, round, records, sel, mutants, numOf = () => undefined, minMutants = 2, maxMutants = 3 }) {
  if (!Array.isArray(mutants)) fail('the mutants file must be an array of {key, mutant, why_false}');
  if (mutants.length < minMutants || mutants.length > maxMutants) fail(`a batch carries ${minMutants}–${maxMutants} mutants; got ${mutants.length}`);
  const byKey = new Map(liveRules(records).map((r) => [r.key, r]));
  const seen = new Set();
  const problems = [];
  for (const m of mutants) {
    const k = m?.key;
    if (typeof k !== 'string' || !byKey.has(k)) { problems.push(`${k}: not a live rule of ${unit}`); continue; }
    if (seen.has(k)) problems.push(`${k}: mutated twice`);
    seen.add(k);
    if (sel.carried.includes(k)) problems.push(`${k}: carried from round ${round - 1} unverified, so it must be verified for real this round — mutate another key`);
    else if (!sel.mutable.includes(k)) problems.push(`${k}: not in round ${round} (mutable keys: ${sel.mutable.join(', ') || 'none'})`);
    if (typeof m.mutant !== 'string' || !m.mutant.trim()) problems.push(`${k}: the mutant text is empty`);
    else if (norm(m.mutant) === norm(byKey.get(k).text)) problems.push(`${k}: the mutant is identical to the original`);
    if (typeof m.why_false !== 'string' || !m.why_false.trim()) problems.push(`${k}: why_false is empty`);
  }
  if (problems.length) fail(`rejected:\n${problems.join('\n')}`);
  const keys = [...new Set([...sel.keys, ...seen])];
  const mut = new Map(mutants.map((m) => [m.key, m]));
  const input = keys
    .sort((a, b) => (shuffleRank(unit, round, a) < shuffleRank(unit, round, b) ? -1 : 1))
    .map((k) => {
      const v = stripForVerifier(byKey.get(k), numOf(k));
      if (mut.has(k)) v.text = mut.get(k).mutant;
      return v;
    });
  const verified = {};
  for (const k of [...keys].sort()) if (!mut.has(k)) {
    const r = byKey.get(k);
    verified[k] = { text: r.text, examples: structuredClone(r.examples ?? []) };
  }
  const truth = {
    unit, round,
    keys: [...keys].sort(),
    hosts: [...seen].filter((k) => !sel.keys.includes(k)).sort(),
    mutants: mutants.map((m) => ({ key: m.key, original: byKey.get(m.key).text, mutant: m.mutant, why_false: m.why_false }))
      .sort((a, b) => (a.key < b.key ? -1 : 1)),
    verified,
  };
  return { input, truth };
}

/* ── pure: quote spans ─────────────────────────────────────────────────── */

/**
 * Each span verbatim (whitespace-normalised substring), ≤200 chars, one line.
 * `readText(file)` → the file's text or null. → [{file, text, why}]
 */
export function badSpans(spans, readText) {
  const out = [];
  for (const q of Array.isArray(spans) ? spans : []) {
    const file = String(q?.file ?? ''), text = String(q?.text ?? '');
    const bad = (why) => out.push({ file, text: text.slice(0, 120), why });
    if (!file || !text.trim()) { bad('empty'); continue; }
    if (text.length > MAX_QUOTE) { bad(`longer than ${MAX_QUOTE} chars`); continue; }
    if (/[\r\n]/.test(text)) { bad('spans more than one line'); continue; }
    const t = readText(file);
    if (t === null || t === undefined) { bad('no such file'); continue; }
    if (!norm(t).includes(norm(text))) bad('not verbatim in the file');
  }
  return out;
}

/* ── pure: judge ───────────────────────────────────────────────────────── */

const CAUGHT = new Set(['contradicted', 'partial', 'unsupported']);

/** the verifier's output → its verdicts keyed by rule key (a verdict naming a
 *  num is mapped through the input) and its bugs */
export function readVerdictDoc(doc, input) {
  const list = Array.isArray(doc) ? doc : doc?.verdicts;
  if (!Array.isArray(list)) fail('a verdicts file is {unit, round, verdicts: [...], bugs: [...]}');
  const keyOfNum = new Map(input.filter((r) => r.num).map((r) => [r.num, r.key]));
  const byKey = new Map(), duplicates = [], unknown = [];
  const inKeys = new Set(input.map((r) => r.key));
  for (const v of list) {
    const key = v?.key ?? keyOfNum.get(v?.num);
    if (!key || !inKeys.has(key)) { unknown.push(String(v?.key ?? v?.num)); continue; }
    if (byKey.has(key)) duplicates.push(key);
    byKey.set(key, { ...v, key });
  }
  const bugs = (Array.isArray(doc?.bugs) ? doc.bugs : []).map((b) => ({ ...b, ruleKey: keyOfNum.get(b?.rule) ?? b?.rule }));
  return { byKey, bugs, duplicates, unknown };
}

/**
 * → {mutants, caught, missed, batchValid, nonConfirmed, counts, missing,
 *    unknown, duplicates, badSpans}. Mutants are excluded from every list
 * but `missed`.
 */
export function judge({ truth, input, doc, readText }) {
  const { byKey, duplicates, unknown } = readVerdictDoc(doc, input);
  const mkeys = new Set(truth.mutants.map((m) => m.key));
  const caughtKeys = [], missed = [];
  for (const k of [...mkeys].sort()) {
    const v = byKey.get(k);
    if (v && CAUGHT.has(v.verdict) && String(v.problem ?? '').trim()) caughtKeys.push(k);
    else missed.push(k);
  }
  const counts = {}, nonConfirmed = [], missing = [];
  for (const k of truth.keys) {
    if (mkeys.has(k)) continue;
    const v = byKey.get(k);
    if (!v) { missing.push(k); continue; }
    counts[v.verdict] = (counts[v.verdict] ?? 0) + 1;
    if (v.verdict !== 'confirmed') nonConfirmed.push(k);
  }
  const spans = [];
  for (const [k, v] of [...byKey].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const b of badSpans(v.quote_spans, readText)) spans.push({ key: k, ...b });
  }
  return {
    unit: truth.unit, round: truth.round,
    mutants: mkeys.size, caught: caughtKeys.length, missed,
    batchValid: caughtKeys.length === mkeys.size,
    nonConfirmed, counts, missing, unknown, duplicates, badSpans: spans,
  };
}

/* ── pure: feedback ────────────────────────────────────────────────────── */

/**
 * The reviser's input for a VALID round, mutants removed: every non-confirmed
 * verdict, and every confirmed one with a source check not `yes`, a test that
 * does not assert the claim, a false basis_ok or a bad quote span. Carries the
 * verifier's engine notes, probes and quote spans (its measurements are
 * evidence the reviser may quote), and the bugs, except those about a mutant.
 */
export function buildFeedback({ truth, input, doc, judged }) {
  if (!judged.batchValid) fail(`round ${truth.round}'s batch is not valid (missed ${judged.missed.length} mutant(s)): its verdicts are discarded — re-run the verifier as a new attempt`);
  const { byKey, bugs } = readVerdictDoc(doc, input);
  const mkeys = new Set(truth.mutants.map((m) => m.key));
  const numOf = new Map(input.map((r) => [r.key, r.num]));
  const spansBad = new Map();
  for (const b of judged.badSpans) if (!mkeys.has(b.key)) spansBad.set(b.key, [...(spansBad.get(b.key) ?? []), b]);
  const items = [];
  for (const k of truth.keys) {
    if (mkeys.has(k)) continue;
    const v = byKey.get(k);
    if (!v) continue;
    const notYes = (v.source_checks ?? []).filter((c) => String(c?.supports ?? '').toLowerCase() !== 'yes');
    const notAsserting = (v.tests_run ?? []).filter((t) => !says(t?.asserts_claim));
    const bad = spansBad.get(k) ?? [];
    if (v.verdict === 'confirmed' && !notYes.length && !notAsserting.length && v.basis_ok !== false && !bad.length) continue;
    items.push({
      key: k, ...(numOf.get(k) ? { num: numOf.get(k) } : {}),
      verdict: v.verdict, problem: v.problem ?? '', basis_ok: v.basis_ok,
      source_checks_not_yes: notYes, tests_not_asserting: notAsserting,
      engine: v.engine ?? [], probes: v.probes ?? [], quote_spans: v.quote_spans ?? [],
      ...(bad.length ? { bad_spans: bad } : {}),
    });
  }
  return {
    unit: truth.unit, round: truth.round,
    items,
    unverified: judged.missing,
    bugs: bugs.filter((b) => !mkeys.has(b.ruleKey)).map(({ ruleKey, ...b }) => b),
  };
}

/* ── pure: finalize ────────────────────────────────────────────────────── */

const CR_TEST_RE = /(?:^|\/)\d+-cr-[\w-]+\.test\.ts(?:::|$)/;
const crBound = (x) => CR_TEST_RE.test(String(x?.test ?? ''));

/**
 * Is the record still what the verifier checked? The text must be identical;
 * the examples too, except examples bound to a promoted CR example test
 * (`NNN-cr-<unit>.test.ts`), which the gate itself runs — so promoting a probe
 * (adding or rebinding an example to it) does not unverify the rule.
 */
export function sameAsVerified(rec, ver) {
  if (!ver || norm(rec.text) !== norm(ver.text)) return false;
  const cur = (rec.examples ?? []).filter((x) => !crBound(x));
  const crTexts = new Set((rec.examples ?? []).filter(crBound).map((x) => norm(x.text)));
  const old = (ver.examples ?? []).filter((x) => !crBound(x) && !crTexts.has(norm(x.text)));
  const sig = (xs) => JSON.stringify(xs.map((x) => [norm(x.text), x.test ?? null]));
  return sig(cur) === sig(old);
}

/** a round's usable verdicts: the latest VALID attempt's, mutants excluded.
 *  rounds: [{round, truth, input, attempts: [{attempt, doc}]}] → per round {attempt, byKey, bugs} | null */
export function usableRound(r, readText) {
  const valid = [...r.attempts].sort((a, b) => b.attempt - a.attempt)
    .find((a) => judge({ truth: r.truth, input: r.input, doc: a.doc, readText }).batchValid);
  if (!valid) return null;
  const { byKey, bugs } = readVerdictDoc(valid.doc, r.input);
  const mkeys = new Set(r.truth.mutants.map((m) => m.key));
  const keep = new Map([...byKey].filter(([k]) => !mkeys.has(k) && r.truth.keys.includes(k)));
  return { attempt: valid.attempt, byKey: keep, bugs: bugs.filter((b) => !mkeys.has(b.ruleKey)) };
}

/** the round ids a harness label carries: U12-r2, U12-r2-a3 */
const label = (unit, round, attempt) => `${unit}-r${round}${attempt > 1 ? `-a${attempt}` : ''}`;

/** a span or evidence path → repo-relative, if it lies in the repo (or the main
 *  checkout this worktree hangs off) and outside the gitignored build dir */
export function repoPath(file, repoRoot = REPO_ROOT) {
  const f = String(file ?? '');
  const roots = [repoRoot];
  const m = /^(.*)\/\.claude\/worktrees\/[^/]+$/.exec(repoRoot);
  if (m) roots.push(m[1]);
  let rel = null;
  if (!isAbsolute(f)) rel = f.replace(/^\.\//, '');
  else for (const root of roots) {
    const r = relative(root, f);
    if (!r.startsWith('..') && !isAbsolute(r) && !r.startsWith('.claude/')) { rel = r; break; }
  }
  if (rel === null) return null;
  const build = relative(repoRoot, CR_BUILD_DIR);
  if (rel === build || rel.startsWith(`${build}/`) || rel.startsWith('var/')) return null;
  return rel.split('\\').join('/');
}

/**
 * → {verdicts, records, findings, report}. Pure given its inputs:
 *   records   the unit's rules (returned with `untested` set or cleared)
 *   rounds    [{round, truth, input, attempts: [{attempt, doc}]}]
 *   findings  the unit's existing findings (the drafter's, earlier finalizes)
 *   exists    repo-relative path → boolean
 */
export function finalize({ unit, records, rounds, findings = [], readText, exists = () => true, repoRoot = REPO_ROOT }) {
  if (!/^U\d+$/.test(unit)) fail(`unit ${unit} is not U<nn>: finding ids are F-<unit>-<n>`);
  const usable = rounds.map((r) => ({ r, u: usableRound(r, readText) })).sort((a, b) => a.r.round - b.r.round);
  const latest = new Map(); // key → {round, attempt, v, ver}
  for (const { r, u } of usable) if (u) for (const [k, v] of u.byKey) latest.set(k, { round: r.round, attempt: u.attempt, v, ver: r.truth.verified[k] });

  const spansOf = (list) => {
    const keep = [], scratch = [];
    for (const q of Array.isArray(list) ? list : []) {
      const rel = repoPath(q?.file, repoRoot);
      if (rel && exists(rel)) keep.push({ file: rel, text: q.text });
      else scratch.push({ file: String(q?.file ?? ''), text: q?.text });
    }
    return { keep, scratch };
  };

  const verdicts = [], stale = [], unverified = [];
  const outRecords = records.map((r) => structuredClone(r));
  for (const rec of liveRules(outRecords)) {
    const hit = latest.get(rec.key);
    const demonstrated = (hit && ((hit.v.tests_run ?? []).some((t) => t?.passed === true && says(t.asserts_claim))
      || (hit.v.probes ?? []).some((p) => p?.passed === true && says(p.demonstrates))))
      || (rec.examples ?? []).some(crBound) || (rec.sources?.tests ?? []).some((t) => CR_TEST_RE.test(t));
    if (demonstrated) delete rec.untested; else rec.untested = true;
    if (!hit) { unverified.push(rec.key); continue; }
    const fresh = sameAsVerified(rec, hit.ver);
    if (!fresh) stale.push(rec.key);
    const { keep, scratch } = spansOf(hit.v.quote_spans);
    const v = hit.v;
    verdicts.push({
      key: rec.key,
      textHash: fresh ? recordHash(rec) : recordHash(hit.ver ?? { text: '' }),
      verdict: v.verdict, round: hit.round, verifier: label(unit, hit.round, hit.attempt),
      engine: v.engine ?? [], tests_run: v.tests_run ?? [], probes: v.probes ?? [],
      source_checks: v.source_checks ?? [], quote_spans: keep,
      ...(scratch.length ? { scratch_spans: scratch } : {}),
      basis_ok: v.basis_ok === true, problem: String(v.problem ?? ''),
    });
  }
  verdicts.sort((a, b) => (a.key < b.key ? -1 : 1));

  /* the verifiers' bugs → findings, deduplicated by title */
  const out = findings.map((f) => structuredClone(f));
  const titles = new Set(out.map((f) => norm(f.title).toLowerCase()));
  const idRe = new RegExp(`^F-${unit}-(\\d+)$`);
  let n = Math.max(0, ...out.map((f) => Number(idRe.exec(f.id)?.[1] ?? 0)));
  const added = [];
  for (const { u } of usable) for (const b of u?.bugs ?? []) {
    const t = norm(b?.title ?? '').toLowerCase();
    if (!t || titles.has(t)) continue;
    titles.add(t);
    const id = `F-${unit}-${++n}`;
    out.push({
      id, title: String(b.title).trim(), summary: String(b.summary ?? '').trim(),
      evidence: (Array.isArray(b.evidence) ? b.evidence : []).map((e) => ({ file: repoPath(e?.file, repoRoot) ?? String(e?.file ?? ''), quote: e?.quote })),
      rule: String(b.ruleKey ?? b.rule ?? ''),
    });
    added.push(id);
  }
  const byVerdict = {};
  for (const v of verdicts) byVerdict[v.verdict] = (byVerdict[v.verdict] ?? 0) + 1;
  return {
    verdicts, records: outRecords, findings: out,
    report: {
      unit, verdicts: verdicts.length, byVerdict,
      untested: liveRules(outRecords).filter((r) => r.untested).map((r) => r.key).sort(),
      stale: stale.sort(), unverified: unverified.sort(),
      invalidRounds: usable.filter((x) => !x.u && x.r.attempts.length).map((x) => x.r.round),
      pendingRounds: usable.filter((x) => !x.r.attempts.length).map((x) => x.r.round),
      findingsAdded: added,
    },
  };
}

/* ── pure: stamp ───────────────────────────────────────────────────────── */

/**
 * Fill each record's sourceHashes from the extract: every current ruling it
 * cites (`R114` → bodyHash) and every designer claim it quotes (`RAQ id#i` →
 * textHash). A hash already there is KEPT — it is what the drafter read, and
 * a mismatch is the checker's "changed since drafting" — unless `refresh`.
 * Hashes for sources no longer cited are dropped.
 */
export function stamp(records, ex, { refresh = false } = {}) {
  const rulings = new Map((ex.rulings ?? []).map((r) => [r.id, r.bodyHash]));
  const claims = new Map();
  for (const t of ex.raq ?? []) for (const c of t.claims ?? []) claims.set(c.id, c.textHash);
  let filled = 0, dropped = 0, refreshed = 0;
  const missing = [];
  const out = records.map((r0) => {
    const r = structuredClone(r0);
    if (!r || 'term' in r) return r;
    const want = new Map();
    for (const x of r.sources?.rulings ?? []) {
      const c = parseRulingCite(typeof x === 'string' ? x : x?.ref ?? '');
      if (!c) continue;
      if (rulings.has(c.id)) want.set(c.id, rulings.get(c.id)); else missing.push(`${r.key}: ${c.id}`);
    }
    for (const x of r.sources?.designer ?? []) {
      const ref = String(x?.ref ?? '');
      const id = ref.replace(/^RAQ /, '');
      if (claims.has(id)) want.set(ref, claims.get(id)); else missing.push(`${r.key}: ${ref}`);
    }
    const old = r.sourceHashes && typeof r.sourceHashes === 'object' ? r.sourceHashes : {};
    const next = {};
    for (const [k, h] of [...want].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (k in old && !refresh) next[k] = old[k];
      else { if (k in old && old[k] !== h) refreshed++; else if (!(k in old)) filled++; next[k] = h; }
    }
    dropped += Object.keys(old).filter((k) => !(k in next)).length;
    r.sourceHashes = next;
    return r;
  });
  return { records: out, filled, dropped, refreshed, missing };
}

/* ── the files ─────────────────────────────────────────────────────────── */

const readJson = (p, dflt) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : dflt);
const writeJson = (p, x) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, `${JSON.stringify(x, null, 2)}\n`); };
const rel = (p) => relative(REPO_ROOT, p).split('\\').join('/');

export const files = (unit) => ({
  rules: join(CR_RULES_DIR, `${unit}.json`),
  verdicts: join(CR_VERDICTS_DIR, `${unit}.json`),
  findings: join(CR_FINDINGS_DIR, `${unit}.json`),
  harness: join(CR_HARNESS_DIR, unit),
  input: (k) => join(CR_VERIFY_INPUT_DIR, `${unit}-r${k}.json`),
  truth: (k) => join(CR_HARNESS_DIR, unit, `mutants-r${k}.json`),
  changed: (k) => join(CR_HARNESS_DIR, unit, `changed-r${k}.json`),
  feedback: (k) => join(CR_HARNESS_DIR, unit, `feedback-r${k}.json`),
  judge: (k, a) => join(CR_HARNESS_DIR, unit, `judge-r${k}${a > 1 ? `-a${a}` : ''}.json`),
  out: (k, a) => join(CR_VERIFY_OUTPUT_DIR, `${unit}-r${k}${a > 1 ? `-a${a}` : ''}.json`),
});

/** a span file: absolute, or repo-relative (in this worktree, else the main checkout) */
export function readSpanFile(file) {
  const f = String(file);
  const cands = isAbsolute(f) ? [f] : [join(REPO_ROOT, f)];
  const m = /^(.*)\/\.claude\/worktrees\/[^/]+$/.exec(REPO_ROOT);
  if (!isAbsolute(f) && m) cands.push(join(m[1], f));
  for (const c of cands) if (existsSync(c)) { try { return readFileSync(c, 'utf8'); } catch { return null; } }
  return null;
}

function loadRules(unit) {
  const F = files(unit);
  const rows = readJson(F.rules, null);
  if (!Array.isArray(rows)) fail(`${rel(F.rules)} is missing or not an array`);
  return rows;
}

/** every planted round of a unit, with its verdict attempts */
export function loadRounds(unit) {
  const F = files(unit);
  const out = [];
  for (let k = 1; existsSync(F.truth(k)); k++) {
    const attempts = [];
    if (existsSync(F.out(k, 1))) attempts.push({ attempt: 1, doc: readJson(F.out(k, 1)) });
    const dir = CR_VERIFY_OUTPUT_DIR;
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        const m = new RegExp(`^${unit}-r${k}-a(\\d+)\\.json$`).exec(f);
        if (m && Number(m[1]) > 1) attempts.push({ attempt: Number(m[1]), doc: readJson(join(dir, f)) });
      }
    }
    attempts.sort((a, b) => a.attempt - b.attempt);
    out.push({ round: k, truth: readJson(F.truth(k)), input: readJson(F.input(k), []), attempts });
  }
  return out;
}

/** the previous round's changed / unverified keys, and the keys that may host a mutant */
function prevOf(unit, round, records) {
  const F = files(unit);
  const k = round - 1;
  if (!existsSync(F.truth(k))) fail(`round ${k} of ${unit} was never planted`);
  if (!existsSync(F.changed(k))) fail(`${rel(F.changed(k))} is missing: the reviser writes it after round ${k}`);
  const ch = readJson(F.changed(k));
  const changed = Array.isArray(ch) ? ch : ch?.keys;
  if (!Array.isArray(changed)) fail(`${rel(F.changed(k))} must be a list of keys`);
  const rounds = loadRounds(unit).filter((r) => r.round <= k);
  const last = rounds.find((r) => r.round === k);
  const u = usableRound(last, readSpanFile);
  if (!u) fail(`round ${k} of ${unit} has no valid attempt: re-run its verifier (a new attempt) before planting round ${round}`);
  const unverified = last.truth.keys.filter((key) => !u.byKey.has(key));
  // hosts: verified in some valid round, text unchanged since
  const fin = finalize({ unit, records, rounds, readText: readSpanFile });
  const fresh = new Set(fin.verdicts.filter((v) => !fin.report.stale.includes(v.key)).map((v) => v.key));
  return { changed, unverified, hosts: [...fresh] };
}

function numOfFn() {
  try {
    const l = readJson(CR_LEDGER, null);
    if (!l) return () => undefined;
    const byKey = new Map(l.entries.filter((e) => !e.removed).map((e) => [e.key, e.num]));
    return (k) => byKey.get(k);
  } catch { return () => undefined; }
}

/* ── the subcommands ───────────────────────────────────────────────────── */

const cmd = {
  keys({ unit, round }) {
    const records = loadRules(unit);
    const sel = roundKeys(records, round, round > 1 ? prevOf(unit, round, records) : null);
    return { unit, round, ...sel };
  },

  plant({ unit, round, mutants: mfile, force }) {
    if (!mfile) fail('--mutants <file> is required');
    const F = files(unit);
    if (!force && (existsSync(F.out(round, 1)) || loadRounds(unit).find((r) => r.round === round)?.attempts.length)) fail(`round ${round} of ${unit} already has verdicts: replanting would change what they judged (--force to do it anyway)`);
    const records = loadRules(unit);
    const sel = roundKeys(records, round, round > 1 ? prevOf(unit, round, records) : null);
    const { input, truth } = plant({ unit, round, records, sel, mutants: readJson(resolve(mfile), null), numOf: numOfFn() });
    writeJson(F.input(round), input);
    writeJson(F.truth(round), truth);
    return { unit, round, input: rel(F.input(round)), records: input.length, mutants: truth.mutants.length, hosts: truth.hosts, carried: sel.carried.length };
  },

  judge({ unit, round, attempt }) {
    const F = files(unit);
    const r = loadRounds(unit).find((x) => x.round === round) ?? fail(`round ${round} of ${unit} was never planted`);
    const a = r.attempts.find((x) => x.attempt === attempt) ?? fail(`${rel(F.out(round, attempt))} is missing`);
    const j = judge({ truth: r.truth, input: r.input, doc: a.doc, readText: readSpanFile });
    const out = { ...j, attempt };
    writeJson(F.judge(round, attempt), out);
    return out;
  },

  feedback({ unit, round }) {
    const F = files(unit);
    const r = loadRounds(unit).find((x) => x.round === round) ?? fail(`round ${round} of ${unit} was never planted`);
    const valid = [...r.attempts].reverse().map((a) => ({ a, j: judge({ truth: r.truth, input: r.input, doc: a.doc, readText: readSpanFile }) })).find((x) => x.j.batchValid);
    if (!valid) fail(`round ${round} of ${unit} has no valid attempt (${r.attempts.length} tried): re-run the verifier`);
    const fb = { ...buildFeedback({ truth: r.truth, input: r.input, doc: valid.a.doc, judged: valid.j }), attempt: valid.a.attempt };
    writeJson(F.feedback(round), fb);
    return { unit, round, attempt: valid.a.attempt, feedback: rel(F.feedback(round)), items: fb.items.length, unverified: fb.unverified.length, bugs: fb.bugs.length };
  },

  finalize({ unit }) {
    const F = files(unit);
    const records = loadRules(unit);
    const res = finalize({
      unit, records, rounds: loadRounds(unit), findings: readJson(F.findings, []),
      readText: readSpanFile, exists: (p) => existsSync(join(REPO_ROOT, p)),
    });
    writeJson(F.verdicts, res.verdicts);
    writeJson(F.findings, res.findings);
    writeJson(F.rules, res.records);
    return { ...res.report, untested: res.report.untested.length, untestedKeys: res.report.untested };
  },

  async stamp({ unit, refresh }) {
    const F = files(unit);
    const { extract } = await import('./extract.mjs');
    const res = stamp(loadRules(unit), extract(), { refresh });
    writeJson(F.rules, res.records);
    return { unit, filled: res.filled, dropped: res.dropped, refreshed: res.refreshed, missing: res.missing };
  },

  async status({ unit }) {
    const { extract } = await import('./extract.mjs');
    const { loadInputs } = await import('./render.mjs');
    const { check, unitIndex } = await import('./check.mjs');
    const inputs = loadInputs();
    const res = check(inputs, extract());
    const unitOf = unitIndex(inputs);
    const units = new Set();
    if (existsSync(CR_RULES_DIR)) for (const f of readdirSync(CR_RULES_DIR)) if (f.endsWith('.json')) units.add(basename(f, '.json'));
    if (existsSync(CR_HARNESS_DIR)) for (const f of readdirSync(CR_HARNESS_DIR)) units.add(f);
    const rows = [];
    for (const u of [...units].sort()) {
      if (unit && u !== unit) continue;
      const rounds = existsSync(files(u).rules) ? loadRounds(u) : [];
      let caught = 0, planted = 0;
      const rs = rounds.map((r) => {
        const js = r.attempts.map((a) => judge({ truth: r.truth, input: r.input, doc: a.doc, readText: readSpanFile }));
        const best = js.findLast((j) => j.batchValid) ?? js[js.length - 1];
        if (best) { caught += best.caught; planted += best.mutants; }
        const ok = js.findLastIndex((j) => j.batchValid);
        return `r${r.round}:${!js.length ? 'pending' : ok >= 0 ? `valid${r.attempts[ok].attempt > 1 ? `(a${r.attempts[ok].attempt})` : ''}` : `INVALID(${js.length})`}`;
      });
      const vs = readJson(files(u).verdicts, []);
      const by = {};
      for (const v of vs) by[v.verdict] = (by[v.verdict] ?? 0) + 1;
      const recs = existsSync(files(u).rules) ? liveRules(readJson(files(u).rules, [])) : [];
      const problems = res.problems.filter((p) => unitOf(p) === u && p.code !== 'unnumbered').length;
      const row = {
        unit: u, rules: recs.length, rounds: rs, verdicts: by, mutants: `${caught}/${planted}`,
        untested: recs.filter((r) => r.untested).length, problems,
      };
      row.line = `${u.padEnd(4)} rules ${String(row.rules).padStart(3)}  ${(rs.join(' ') || 'not planted').padEnd(28)}  `
        + `${['confirmed', 'partial', 'contradicted', 'unsupported'].map((k) => `${k.slice(0, 4)} ${by[k] ?? 0}`).join(' ')}  `
        + `mutants ${row.mutants}  untested ${row.untested}  problems ${problems}`;
      rows.push(row);
    }
    return { units: rows, lines: rows.map((r) => r.line) };
  },
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sub, ...rest] = process.argv.slice(2);
  try {
    const { values } = parseArgs({
      args: rest,
      options: {
        unit: { type: 'string' }, round: { type: 'string' }, attempt: { type: 'string' },
        mutants: { type: 'string' }, force: { type: 'boolean' }, refresh: { type: 'boolean' },
      },
    });
    if (!cmd[sub]) fail(`usage: harness.mjs plant|keys|judge|feedback|finalize|stamp|status --unit U [--round K] …`);
    if (sub !== 'status' && !values.unit) fail('--unit is required');
    if (['plant', 'keys', 'judge', 'feedback'].includes(sub) && !(Number(values.round) >= 1)) fail('--round K (≥1) is required');
    const out = await cmd[sub]({
      unit: values.unit, round: Number(values.round), attempt: values.attempt ? Number(values.attempt) : 1,
      mutants: values.mutants, force: !!values.force, refresh: !!values.refresh,
    });
    console.log(JSON.stringify(out));
  } catch (e) {
    console.log(JSON.stringify({ error: String(e?.message ?? e) }));
    process.exit(1);
  }
}
