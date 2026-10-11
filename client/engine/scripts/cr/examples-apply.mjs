/**
 * Stage E of the 2026-10-11 polish round: apply the example audit to the rule
 * records (data/comprehensive-rules/README.md, the anti-hallucination contract).
 *
 * The audit is one JSON line per example:
 *   {unit, key, i, verdict: KEEP|DEMOTE|REWRITE|WRONG, why, old,
 *    polish?, proposed?, groundedIn?, testAsserts?, test?}
 * `old` is the example's text as the auditor read it; `i` its index in the
 * record's `examples`.
 *
 * What each verdict does to the example:
 *   DEMOTE          {text: null, test}: the words go, the binding stays as a
 *                   demonstration. With no binding either, the example goes.
 *   KEEP + polish   text := polish                     (a reworded claim)
 *   REWRITE         text := proposed                   (a new claim)
 *   WRONG           text := proposed when it is grounded (a `groundedIn` test,
 *                   or the example's own binding); else demoted as above
 * and every example's text loses a leftover label ("Example:", "Example
 * (illustrative):", "(illustrative)"), which the renderer prints itself. A
 * test binding changes only when the line names a different one (`test`), or
 * the example had none and the line is `groundedIn` one.
 *
 * SAFETY. A line applies only when `old` equals the example's current text
 * (whitespace-normalised). A record whose lines do not all match — someone
 * else edited it since the audit — is skipped whole and reported, never
 * forced. A record already in its applied state is recognised (rebuilt from
 * the lines, re-applied, compared) and left alone: a second run changes nothing.
 *
 * VERDICTS. A verdict pins recordHash (schema.mjs). Only a record whose sole
 * changes REMOVE claims or relabel (demote, drop, label strip, an unfixable
 * WRONG demoted) is re-pinned here — and only when its verdict fitted the
 * record before the change: verdict.textHash := recordHash(new), plus
 * `carried`. Every other changed record is left stale for its own check:
 *   needsEquivalence  polish only (plus removals): an equivalence checker, then
 *                     `--repin-equivalent <keys.json>` re-pins the keys it passed
 *   needsVerify       a rewrite, a WRONG fix or a rebinding: a new claim, so a
 *                     harness verify round (polish round 4, --keys)
 *
 *   node client/engine/scripts/cr/examples-apply.mjs <audit.jsonl>… [--rules <dir>] [--verdicts <dir>]
 *        [--manifest <file>] [--dry] [--date YYYY-MM-DD]
 *   node client/engine/scripts/cr/examples-apply.mjs --repin-equivalent <keys.json> --manifest <file>
 *        [--rules <dir>] [--verdicts <dir>] [--date YYYY-MM-DD]
 *
 * --rules / --verdicts default to the committed CR_RULES_DIR / CR_VERDICTS_DIR,
 * so a dry run points them at a copy. The manifest defaults to
 * apply-manifest.json beside the first audit file. Prints one JSON object.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CR_LEDGER, CR_RULES_DIR, CR_VERDICTS_DIR } from '../paths.mjs';
import { norm, recordHash } from './schema.mjs';

/* ── pure: labels ──────────────────────────────────────────────────────── */

const TAG_RE = /^(?:illustrative|non-normative)$/i;

/**
 * An example's text without the labels the renderer adds itself. A leading
 * "Example:" / "Example (illustrative):" goes; a note inside that label which
 * is not a tag ("from the Manual p.23") is kept, at the end. An inline
 * "(illustrative)" goes; "(illustrative; the engine …)" keeps "(the engine …)".
 * null stays null. Idempotent.
 */
export function stripLabel(t) {
  if (t === null || t === undefined) return t ?? null;
  let s = String(t);
  let note = '';
  const m = /^\s*Example\s*(?:\(([^)]*)\))?\s*[:.]\s*/i.exec(s);
  if (m) {
    s = s.slice(m[0].length);
    note = (m[1] ?? '').split(/\s*[;,]\s*/).filter((p) => p && !TAG_RE.test(p)).join(', ');
  }
  s = s.replace(/\s*\((?:illustrative|non-normative)\)/gi, '');
  s = s.replace(/\((?:illustrative|non-normative)\s*[;,]\s*/gi, '(');
  s = s.trim();
  if (note) s = `${s} (${note})`;
  return s;
}

/* ── pure: one example, one line ───────────────────────────────────────── */

/** a WRONG line's `proposed` is applied only when something grounds it */
export const groundedFix = (line, cur) => !!(line.proposed && String(line.proposed).trim()
  && (line.groundedIn || line.test || cur?.test));

/**
 * One audit line against the example it names → {ex, classes, action}.
 * `ex` is the example to keep (null = drop it). Classes: demote, drop,
 * prefix, polish, rewrite, wrong-fix, wrong-demote, rebind.
 */
export function applyLine(line, cur) {
  const classes = new Set();
  const curTest = cur?.test ?? null;
  let test = curTest;
  if (typeof line.test === 'string' && line.test !== curTest) { test = line.test; classes.add('rebind'); }
  else if (!curTest && typeof line.groundedIn === 'string' && line.groundedIn.includes('::') && ['REWRITE', 'WRONG'].includes(line.verdict)) { test = line.groundedIn; classes.add('rebind'); }
  const demote = (cls) => {
    classes.add(cls);
    if (!curTest) { classes.add('drop'); return { ex: null, classes, action: 'drop' }; }
    return { ex: { text: null, test: curTest }, classes, action: 'demote' };
  };
  const withText = (raw, cls) => {
    const before = stripLabel(cur?.text);
    const text = stripLabel(raw);
    if (cls && norm(text) !== norm(before ?? '')) classes.add(cls);
    else if (norm(text) !== norm(cur?.text ?? '')) classes.add('prefix');
    return { ex: { ...cur, text, test }, classes, action: classes.has(cls) ? cls : (classes.has('prefix') ? 'prefix' : 'keep') };
  };
  switch (line.verdict) {
    case 'DEMOTE': return demote('demote');
    case 'KEEP': return withText(line.polish ?? cur?.text, line.polish ? 'polish' : null);
    case 'REWRITE':
      if (!line.proposed) return { ex: { ...cur }, classes, action: 'error', error: 'REWRITE without proposed' };
      return withText(line.proposed, 'rewrite');
    case 'WRONG':
      if (groundedFix(line, cur)) return withText(line.proposed, 'wrong-fix');
      classes.delete('rebind');
      return demote('wrong-demote');
    default: return { ex: { ...cur }, classes, action: 'error', error: `unknown verdict ${line.verdict}` };
  }
}

/** the classes that only remove claims or relabel: a verdict survives them */
export const MECHANICAL = new Set(['demote', 'drop', 'prefix', 'wrong-demote']);
const NEW_CLAIM = new Set(['rewrite', 'wrong-fix', 'rebind']);

export function bucketOf(classes) {
  if (!classes.size) return null;
  if ([...classes].some((c) => NEW_CLAIM.has(c))) return 'needsVerify';
  if (classes.has('polish')) return 'needsEquivalence';
  if ([...classes].every((c) => MECHANICAL.has(c))) return 'repinned';
  throw new Error(`unknown example classes: ${[...classes].join(', ')}`);
}

const sameExamples = (a, b) => a.length === b.length
  && a.every((x, i) => norm(x?.text ?? '\u0000') === norm(b[i]?.text ?? '\u0000') && (x?.test ?? null) === (b[i]?.test ?? null));

/** a record's examples, the lines applied to them, in index order →
 *  {examples, classes, perLine, pairs} — `pairs` the lines whose words changed
 *  beyond a label: {i, verdict, old, new} */
function applyAll(orig, lines) {
  const classes = new Set();
  const perLine = [], pairs = [];
  const out = orig.map((x) => ({ ...x }));
  const keep = orig.map(() => true);
  const byI = new Map(lines.map((l) => [l.i, l]));
  for (let i = 0; i < orig.length; i++) {
    const l = byI.get(i);
    if (!l) {
      // an example nobody audited still loses its label
      const t = stripLabel(orig[i].text);
      if (norm(t ?? '') !== norm(orig[i].text ?? '')) { out[i] = { ...orig[i], text: t }; classes.add('prefix'); }
      continue;
    }
    const r = applyLine(l, orig[i]);
    for (const c of r.classes) classes.add(c);
    if (r.ex === null) keep[i] = false; else out[i] = r.ex;
    perLine.push({ i, verdict: l.verdict, action: r.action, ...(r.error ? { error: r.error } : {}) });
    if (r.ex?.text != null && ['polish', 'rewrite', 'wrong-fix'].includes(r.action)) pairs.push({ i, verdict: l.verdict, action: r.action, old: orig[i].text, new: r.ex.text });
  }
  return { examples: out.filter((_, i) => keep[i]), classes, perLine, pairs };
}

/**
 * The record as the audit saw it, rebuilt from its lines and its applied
 * state: each line's `old`, with the binding the applied example still holds
 * (a dropped one had none). → examples[] or null when the shapes cannot agree.
 */
function rebuildOriginal(cur, lines) {
  const sorted = [...lines].sort((a, b) => a.i - b.i);
  if (sorted.some((l, n) => l.i !== n)) return null;
  const out = [];
  let p = 0;
  for (const l of sorted) {
    const here = cur[p];
    const removesWords = l.verdict === 'DEMOTE' || (l.verdict === 'WRONG' && !groundedFix(l, here));
    if (removesWords) {
      if (here && (here.text === null || here.text === undefined)) { out.push({ text: l.old, test: here.test ?? null }); p++; }
      else out.push({ text: l.old, test: null });
    } else {
      if (!here) return null;
      out.push({ text: l.old, test: typeof l.test === 'string' ? l.test : here.test ?? null });
      p++;
    }
  }
  return p === cur.length ? out : null;
}

/**
 * Apply the audit to the records. Reads no file; re-pins verdict rows IN
 * PLACE (the caller writes what changed).
 *   units     [{unit, records}]  every rules/<unit>.json (glossary included)
 *   lines     the audit lines
 *   verdicts  [{unit, verdicts}]
 *   canon     key → canonical key (ledger aliases)
 *   carriedDemote / carriedLabel  the `carried` stamp for a re-pinned verdict
 *   previous  the last run's manifest `records`, if any: a re-run cannot always
 *             tell which of two demoted examples was the dropped one, so an
 *             already-applied record keeps the entry (oldHash, lines) it had
 * → {units, verdicts, manifest} with the changed arrays (same order).
 */
export function applyAudit({ units, lines, verdicts, canon = (k) => k, carriedDemote, carriedLabel, previous = {} }) {
  const linesByKey = new Map();
  for (const l of lines) linesByKey.set(l.key, [...(linesByKey.get(l.key) ?? []), l]);
  const vByKey = new Map();
  for (const u of verdicts) for (const v of u.verdicts) vByKey.set(canon(v.key), v);
  const recKeys = new Set(units.flatMap((u) => u.records.map((r) => r?.key)));

  const manifest = {
    counts: {}, buckets: { repinned: [], notRepinned: [], needsEquivalence: [], needsVerify: [] },
    alreadyApplied: [], skipped: [], wrong: [], errors: [], records: {},
  };
  for (const [k, ls] of linesByKey) if (!recKeys.has(k)) manifest.skipped.push({ key: k, reason: 'no record has this key', lines: ls.map((l) => l.i) });

  const outUnits = units.map(({ unit, records }) => ({
    unit,
    records: records.map((rec) => {
      if (!rec || !Array.isArray(rec.examples)) return rec;
      const ls = linesByKey.get(rec.key) ?? [];
      const cur = rec.examples;
      let orig = cur, already = false;
      const fresh = ls.every((l) => cur[l.i] && norm(cur[l.i].text ?? '') === norm(l.old ?? ''))
        && (ls.length === 0 || ls.length === cur.length);
      if (!fresh) {
        const back = rebuildOriginal(cur, ls);
        if (back && sameExamples(applyAll(back, ls).examples, cur)) { orig = back; already = true; }
        else {
          const bad = ls.filter((l) => !cur[l.i] || norm(cur[l.i].text ?? '') !== norm(l.old ?? '')).map((l) => l.i);
          manifest.skipped.push({
            key: rec.key, unit,
            reason: bad.length ? `examples ${bad.join(', ')} no longer read as audited` : `the record has ${cur.length} examples, the audit ${ls.length}`,
            lines: ls.map((l) => l.i),
          });
          return rec;
        }
      }
      let res = applyAll(orig, ls);
      const prev = already ? previous[rec.key] : null;
      const carryPrev = !!prev && prev.newHash === recordHash(rec) && Array.isArray(prev.classes);
      if (carryPrev) res = { ...res, classes: new Set(prev.classes), perLine: prev.lines, pairs: prev.pairs };
      for (const e of res.perLine) if (e.error) manifest.errors.push({ key: rec.key, i: e.i, error: e.error });
      if (manifest.errors.some((e) => e.key === rec.key)) return rec;
      for (const l of ls) if (l.verdict === 'WRONG') {
        const a = res.perLine.find((e) => e.i === l.i)?.action;
        manifest.wrong.push({
          key: rec.key, i: l.i, action: a,
          grounded: a === 'wrong-fix' ? (l.groundedIn ? `groundedIn ${l.groundedIn}` : `its own binding ${l.test ?? orig[l.i]?.test}`) : null,
          why: l.why,
        });
      }
      const bucket = bucketOf(res.classes);
      if (!bucket) return rec;
      const next = { ...rec, examples: res.examples };
      const oldHash = carryPrev ? prev.oldHash : recordHash({ ...rec, examples: orig });
      const newHash = recordHash(next);
      const v = vByKey.get(canon(rec.key));
      // 'fits': the verdict pins the audited record, or (a re-run) this apply already re-pinned it
      const verdictBefore = !v ? 'none' : v.textHash === oldHash || v.textHash === newHash ? 'fits' : 'stale';
      const entry = {
        unit, classes: [...res.classes].sort(), bucket, oldHash, newHash, verdictBefore,
        lines: res.perLine,
        pairs: res.pairs,
      };
      if (already) manifest.alreadyApplied.push(rec.key);
      manifest.records[rec.key] = entry;
      if (bucket === 'repinned') {
        const stamp = [...res.classes].some((c) => c !== 'prefix') ? carriedDemote : carriedLabel;
        if (!v) { entry.bucket = 'notRepinned'; manifest.buckets.notRepinned.push({ key: rec.key, reason: 'no verdict' }); }
        else if (v.textHash === newHash) manifest.buckets.repinned.push(rec.key);
        else if (v.textHash !== oldHash) { entry.bucket = 'notRepinned'; manifest.buckets.notRepinned.push({ key: rec.key, reason: 'the verdict was already stale before the apply' }); }
        else { v.textHash = newHash; v.carried = stamp; manifest.buckets.repinned.push(rec.key); }
      } else manifest.buckets[bucket].push(rec.key);
      return already ? rec : next;
    }),
  }));
  for (const b of Object.values(manifest.buckets)) b.sort((a, c) => String(a.key ?? a).localeCompare(String(c.key ?? c)));
  const cls = {};
  for (const e of Object.values(manifest.records)) for (const c of e.classes) cls[c] = (cls[c] ?? 0) + 1;
  manifest.counts = {
    lines: lines.length, recordsChanged: Object.keys(manifest.records).length, alreadyApplied: manifest.alreadyApplied.length,
    skipped: manifest.skipped.length, errors: manifest.errors.length,
    ...Object.fromEntries(Object.entries(manifest.buckets).map(([k, v]) => [k, v.length])),
    recordsByClass: cls,
  };
  return { units: outUnits, verdicts, manifest };
}

/**
 * Re-pin the verdicts of records an equivalence checker passed. Only a key
 * the manifest put in needsEquivalence, whose verdict still pins the audited
 * record (oldHash) and whose record is still the applied one (newHash).
 * Mutates `verdicts`. → {repinned, already, refused[{key, reason}]}
 */
export function repinEquivalent({ keys, manifest, units, verdicts, canon = (k) => k, carried }) {
  const recByKey = new Map(units.flatMap((u) => u.records.map((r) => [r?.key, r])));
  const vByKey = new Map();
  for (const u of verdicts) for (const v of u.verdicts) vByKey.set(canon(v.key), v);
  const out = { repinned: [], already: [], refused: [] };
  for (const k of [...new Set(keys)].sort()) {
    const e = manifest.records?.[k];
    const v = vByKey.get(canon(k));
    const rec = recByKey.get(k);
    const no = (reason) => out.refused.push({ key: k, reason });
    if (!e || e.bucket !== 'needsEquivalence') no('not in the manifest\'s needsEquivalence bucket');
    else if (!v) no('no verdict');
    else if (!rec || recordHash(rec) !== e.newHash) no('the record is no longer the one the checker compared');
    else if (v.textHash === e.newHash) out.already.push(k);
    else if (v.textHash !== e.oldHash) no('the verdict was stale before the apply');
    else { v.textHash = e.newHash; v.carried = carried; out.repinned.push(k); }
  }
  return out;
}

/* ── the files ─────────────────────────────────────────────────────────── */

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const show = (x) => `${JSON.stringify(x, null, 2)}\n`;
const unitFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : []);

function loadDir(dir, field) {
  return unitFiles(dir).map((f) => ({ unit: basename(f, '.json'), file: join(dir, f), [field]: readJson(join(dir, f)), raw: readFileSync(join(dir, f), 'utf8') }));
}
function canonFn() {
  try {
    const l = readJson(CR_LEDGER);
    const m = new Map((l.aliases ?? []).map((a) => [a.from, a.to]));
    return (k) => m.get(k) ?? k;
  } catch { return (k) => k; }
}
/** write each file whose JSON changed → the units written */
function writeChanged(rows, field, dry) {
  const written = [];
  for (const r of rows) {
    const s = show(r[field]);
    if (s === r.raw) continue;
    written.push(r.unit);
    if (!dry) writeFileSync(r.file, s);
  }
  return written;
}
function readAudit(files) {
  const lines = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((s, n) => {
      if (!s.trim()) return;
      try { lines.push(JSON.parse(s)); } catch { throw new Error(`${f}:${n + 1} is not JSON`); }
    });
  }
  const seen = new Set();
  for (const l of lines) {
    const id = `${l.key}#${l.i}`;
    if (seen.has(id)) throw new Error(`the audit names ${id} twice`);
    seen.add(id);
  }
  return lines;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        rules: { type: 'string' }, verdicts: { type: 'string' }, manifest: { type: 'string' },
        dry: { type: 'boolean' }, date: { type: 'string' }, 'repin-equivalent': { type: 'string' },
      },
    });
    const rulesDir = resolve(values.rules ?? CR_RULES_DIR), verdictsDir = resolve(values.verdicts ?? CR_VERDICTS_DIR);
    const date = values.date ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date is YYYY-MM-DD');
    const rules = loadDir(rulesDir, 'records');
    const vers = loadDir(verdictsDir, 'verdicts');
    if (!rules.length) throw new Error(`no rules in ${rulesDir}`);
    const canon = canonFn();

    if (values['repin-equivalent']) {
      if (!values.manifest) throw new Error('--repin-equivalent needs the --manifest the apply wrote');
      const k = readJson(resolve(values['repin-equivalent']));
      const keys = Array.isArray(k) ? k : k?.keys;
      if (!Array.isArray(keys)) throw new Error('the keys file is a list of keys (or {keys: [...]})');
      const res = repinEquivalent({ keys, manifest: readJson(resolve(values.manifest)), units: rules, verdicts: vers, canon, carried: `reworded, equivalence-checked ${date}` });
      const written = writeChanged(vers, 'verdicts', !!values.dry);
      console.log(JSON.stringify({ ...res, repinned: res.repinned.length, already: res.already.length, verdictFilesWritten: written, dry: !!values.dry }));
    } else {
      if (!positionals.length) throw new Error('usage: examples-apply.mjs <audit.jsonl>… [--rules <dir>] [--verdicts <dir>] [--manifest <file>] [--dry]');
      const lines = readAudit(positionals.map((p) => resolve(p)));
      const manifestFile = resolve(values.manifest ?? join(dirname(resolve(positionals[0])), 'apply-manifest.json'));
      const res = applyAudit({
        previous: existsSync(manifestFile) ? readJson(manifestFile).records ?? {} : {},
        units: rules, lines, verdicts: vers, canon,
        carriedDemote: `demoted-example ${date}`, carriedLabel: `example-label ${date}`,
      });
      for (let n = 0; n < rules.length; n++) rules[n].records = res.units[n].records;
      const rulesWritten = writeChanged(rules, 'records', !!values.dry);
      const verdictsWritten = writeChanged(vers, 'verdicts', !!values.dry);
      const manifest = { rulesDir, verdictsDir, audit: positionals.map((p) => basename(p)), ...res.manifest };
      writeFileSync(manifestFile, show(manifest));
      console.log(JSON.stringify({ manifest: manifestFile, dry: !!values.dry, rulesWritten, verdictsWritten, counts: res.manifest.counts }));
    }
  } catch (e) {
    console.log(JSON.stringify({ error: String(e?.message ?? e) }));
    process.exit(1);
  }
}
