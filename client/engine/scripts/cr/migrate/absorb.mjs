/* ABSORB — step 1a of the CR-only migration: the owner's provenance moves INTO
 * the CR records, so the R-ruling register can be deleted.
 *
 *   node client/engine/scripts/cr/migrate/absorb.mjs [--dry-run]
 *
 * Run on a REGISTER-ERA checkout (before recite and the delete step). It reads
 * adopted.json and scope.json (both committed here) and rewrites, in place:
 *
 *   rules/*.json      every record:
 *                     · each `sources.rulings` QUOTE → `sources.owner[{quote, adopted, from}]`
 *                       (`adopted` = the ruling's adoption date; `from` = the question
 *                       sheet it answered, else ''). A bare ruling ref (no quote) has
 *                       nothing to carry and is dropped — listed in the report.
 *                     · `sources.rulings` and `sources.history` dropped (history is in
 *                       changelog.md); the ruling keys of `sourceHashes` dropped
 *                     · `scope: 'game'|'digital'` after `basis` (scope.json; every
 *                       annexd.* record is digital; a 'mixed' row is stored as
 *                       scope 'game' + `digitalClause`, the clause verbatim from the text)
 *                     · R-citations in `notes` / `rebuttal`: owner-source wording
 *   discrepancies/    `sides[].source: "R133"` → "owner ruling, adopted 2026-08-24";
 *                     summary / resolution / question fields: owner-source wording.
 *                     A side's QUOTE of a ruling stays verbatim (it is the owner's words);
 *                     a side quoting a `file:` is re-quoted by recite, which changes the file.
 *   findings/         title / summary / closed: owner-source wording (evidence quotes are
 *                     re-quoted by recite)
 *   source-classification.json   notes: owner-source wording
 *
 * verdicts/*.json is FROZEN (owner decision 2026-10-11): never touched here.
 * Idempotent: a second run finds no `sources.rulings` and changes nothing. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CR_RULES_DIR, CR_DISCREPANCIES_DIR, CR_FINDINGS_DIR, CR_SOURCE_CLASSIFICATION, REPO_ROOT } from '../../paths.mjs';
import { readAdopted } from './adopted.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const SCOPE_JSON = join(HERE, 'scope.json');
const RULING_ID = /^R(\d+)(b?)(?![\w])/;

/* ── JSON files: parse, mutate, write back in the file's own indent ── */
export function indentOf(text) {
  const m = /^\[?\{?\n(\s+)/.exec(text);
  return m ? (m[1].includes('\t') ? '\t' : m[1].length) : 2;
}
export function editJson(abs, fn, { dryRun = false } = {}) {
  const text = readFileSync(abs, 'utf8');
  const j = JSON.parse(text);
  const changed = fn(j);
  if (!changed) return false;
  const out = JSON.stringify(j, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : '');
  if (out === text) return false;
  if (!dryRun) writeFileSync(abs, out);
  return true;
}

/* ── owner-source wording for an R-citation in the CR's own prose ──
 * A ruling id becomes the date the owner adopted it: no R-number survives.
 *   R51 gave …            → The owner ruling of 2026-08-19 gave …
 *   (R74)                 → (owner ruling, adopted 2026-08-20)
 *   R59/R60/R122          → the owner rulings of 2026-08-19 and 2026-08-23
 *   R265's other halves   → the 2026-08-28 owner ruling's other halves
 *   R157 §12 / R157 (§3)  → the owner ruling of 2026-08-25 (the § is the register's, so it goes)
 * An id the table does not know (184's unregistered numbers) is left and reported. */
const GROUP = /(\(\s*)?(?:\b(the|The|a|A|an|An)\s+)?\bR(\d{1,3})(b?)\b((?:\s?\/\s?R\d{1,3}b?\b)*)((?:\s?\((?:its\s)?§\s?\d+[^)]*\))|(?:,?\s?(?:its\s)?§\s?\d+(?:[-–]\d+)?))?('s)?(\s*\))?/g;
const datesList = (ds) => (ds.length === 1 ? ds[0] : `${ds.slice(0, -1).join(', ')} and ${ds.at(-1)}`);

export function ownerWording(s, A, unknown = new Set()) {
  if (typeof s !== 'string' || !/\bR\d{1,3}b?\b/.test(s)) return s;
  return s.replace(GROUP, (all, open, art, n, b, rest, sec, poss, close, off) => {
    const ids = [`R${Number(n)}${b}`, ...[...(rest ?? '').matchAll(/R(\d{1,3})(b?)/g)].map((m) => `R${Number(m[1])}${m[2]}`)];
    const known = ids.filter((id) => A[id] || A[id.replace(/b$/, '')]);
    if (known.length !== ids.length) { for (const id of ids) if (!A[id]) unknown.add(id); return all; }
    const ds = [...new Set(ids.map((id) => (A[id] ?? A[id.replace(/b$/, '')]).adopted))].sort();
    const many = ids.length > 1;
    const before = s.slice(0, off);
    const startOfSentence = /(^|[.!?:]\s+|\n\s*(?:[-*]\s+)?|^\s*[-*]\s+)$/.test(before) && !open;
    const cap = (w) => (startOfSentence || /^[TA]/.test(art ?? '') ? w[0].toUpperCase() + w.slice(1) : w);
    // the whole parenthesis is the citation: "(R74)" / "(R25/R239)"
    if (open && close && !poss) return `(owner ${many ? 'rulings' : 'ruling'}, adopted ${datesList(ds)})`;
    let phrase = poss
      ? (many ? `the ${datesList(ds)} owner rulings'` : `the ${ds[0]} owner ruling's`)
      : (many ? `the owner rulings of ${datesList(ds)}` : `the owner ruling of ${ds[0]}`);
    phrase = cap(phrase);
    return `${open ?? ''}${phrase}${close ?? ''}`;
  });
}

/** a discrepancy side's source: an R ref becomes the owner-source ref schema.mjs parses */
export function ownerRef(src, A) {
  const m = RULING_ID.exec(String(src).trim());
  if (!m) return null;
  const id = `R${Number(m[1])}${m[2]}`;
  const a = A[id] ?? A[`R${Number(m[1])}`];
  return a ? `owner ruling, adopted ${a.adopted}` : null;
}

/** rebuild an object with `key` replaced in place by [newKey, value] pairs (order kept) */
function replaceKey(obj, key, pairs) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === key) { for (const [nk, nv] of pairs) out[nk] = nv; } else out[k] = v;
  }
  for (const k of Object.keys(obj)) delete obj[k];
  Object.assign(obj, out);
}

export function absorb({ dryRun = false } = {}) {
  const A = readAdopted();
  const scope = JSON.parse(readFileSync(SCOPE_JSON, 'utf8'));
  const unknown = new Set();
  const report = {
    records: 0, recordsWithRulings: 0, ownerEntries: 0, bareDropped: [], historyDropped: 0, hashKeysDropped: 0,
    scope: { game: 0, digital: 0, mixed: 0 }, scopeMissing: [], clauseNotInText: [], noOwnerLeft: [],
    wording: { notes: 0, discrepancies: 0, findings: 0, other: 0 }, sidesRef: 0, changedFiles: [],
  };
  const files = (dir) => readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => join(dir, f));
  const touch = (abs, changed) => { if (changed) report.changedFiles.push(relative(REPO_ROOT, abs)); };
  const word = (s, bucket) => { const t = ownerWording(s, A, unknown); if (t !== s) report.wording[bucket]++; return t; };

  /* records */
  for (const abs of files(CR_RULES_DIR)) {
    touch(abs, editJson(abs, (rows) => {
      let changed = false;
      for (const r of rows) {
        report.records++;
        const s = r.sources;
        if (!s || !('rulings' in s || 'history' in s)) {
          // already absorbed (idempotent re-run): still fill a missing scope
        } else {
          const owner = [];
          const seen = new Set();
          for (const x of s.rulings ?? []) {
            const ref = typeof x === 'string' ? x : x?.ref ?? '';
            const m = RULING_ID.exec(ref.trim());
            const id = m ? `R${Number(m[1])}${m[2]}` : null;
            if (typeof x !== 'object' || !x.quote) { report.bareDropped.push(`${r.key}: ${ref}`); continue; }
            const a = A[id] ?? (id ? A[id.replace(/b$/, '')] : null);
            if (!a) throw new Error(`${r.key}: ${ref} has no row in adopted.json`);
            const k = `${x.quote}|${a.adopted}`;
            if (seen.has(k)) continue;
            seen.add(k);
            owner.push({ quote: x.quote, adopted: a.adopted, from: a.from ?? '' });
          }
          if ((s.rulings ?? []).length) report.recordsWithRulings++;
          report.ownerEntries += owner.length;
          report.historyDropped += (s.history ?? []).length;
          replaceKey(s, 'rulings', [['owner', owner]]);
          delete s.history;
          if (!owner.length && r.basis === 'owner') report.noOwnerLeft.push(r.key);
          changed = true;
        }
        if (r.sourceHashes) {
          for (const k of Object.keys(r.sourceHashes)) if (RULING_ID.test(k)) { delete r.sourceHashes[k]; report.hashKeysDropped++; changed = true; }
        }
        for (const f of ['notes', 'rebuttal']) if (typeof r[f] === 'string') { const t = word(r[f], 'notes'); if (t !== r[f]) { r[f] = t; changed = true; } }
        if (!('term' in r)) {
          let sc = null, clause;
          if (/^annexd(\.|$)/.test(r.key)) sc = 'digital';
          else if (scope[r.key]) {
            sc = scope[r.key].scope;
            if (sc === 'mixed') { clause = scope[r.key].digitalClause; sc = 'game'; report.scope.mixed++; if (!String(r.text).includes(clause)) report.clauseNotInText.push(r.key); }
          }
          if (!sc) report.scopeMissing.push(r.key);
          else {
            report.scope[sc]++;
            if (r.scope !== sc || (clause && r.digitalClause !== clause)) {
              const pairs = [['basis', r.basis], ['scope', sc], ...(clause ? [['digitalClause', clause]] : [])];
              delete r.scope; delete r.digitalClause;
              if ('basis' in r) replaceKey(r, 'basis', pairs); else Object.assign(r, Object.fromEntries(pairs));
              changed = true;
            }
          }
        }
      }
      return changed;
    }, { dryRun }));
  }

  /* discrepancies */
  for (const abs of files(CR_DISCREPANCIES_DIR)) {
    touch(abs, editJson(abs, (rows) => {
      let changed = false;
      const set = (o, k, bucket) => { if (typeof o?.[k] === 'string') { const t = word(o[k], bucket); if (t !== o[k]) { o[k] = t; changed = true; } } };
      for (const d of rows) {
        set(d, 'summary', 'discrepancies'); set(d, 'resolution', 'discrepancies');
        for (const sd of d.sides ?? []) {
          const ref = ownerRef(sd.source, A);
          if (ref) { sd.source = ref; report.sidesRef++; changed = true; }
        }
        const q = d.question;
        if (q && typeof q === 'object') {
          for (const k of ['topic', 'ask', 'follows', 'recommend']) set(q, k, 'discrepancies');
          for (const rd of q.readings ?? []) { set(rd, 'text', 'discrepancies'); set(rd, 'table', 'discrepancies'); }
        }
      }
      return changed;
    }, { dryRun }));
  }

  /* findings */
  for (const abs of files(CR_FINDINGS_DIR)) {
    touch(abs, editJson(abs, (rows) => {
      let changed = false;
      for (const f of rows) for (const k of ['title', 'summary', 'closed']) {
        if (typeof f[k] === 'string') { const t = word(f[k], 'findings'); if (t !== f[k]) { f[k] = t; changed = true; } }
      }
      return changed;
    }, { dryRun }));
  }

  /* source classification notes */
  touch(CR_SOURCE_CLASSIFICATION, editJson(CR_SOURCE_CLASSIFICATION, (j) => {
    let changed = false;
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string' && /^(note|notes|reason)$/.test(k)) { const t = word(v, 'other'); if (t !== v) { o[k] = t; changed = true; } }
        else walk(v);
      }
    };
    walk(j);
    return changed;
  }, { dryRun }));

  report.unknownIds = [...unknown].sort();
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = absorb({ dryRun: process.argv.includes('--dry-run') });
  console.log(JSON.stringify({ ...r, bareDropped: r.bareDropped.length, bareDroppedList: r.bareDropped }, null, 1));
}
