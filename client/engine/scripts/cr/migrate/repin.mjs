/* RE-PIN — after recite renames test titles, a verdict still describes its rule.
 *
 *   node client/engine/scripts/cr/migrate/repin.mjs [--dry-run]
 *
 * A verdict pins its record by `textHash` = recordHash(text + examples + each
 * example's test binding). Recite renames ~1,700 test titles (`R84: …` →
 * `CR 802.15c: …`) and moves every binding with its title, so ~670 confirmed
 * rules would read "not verified (the text changed)" though the verifier's
 * subject — the rule's words, the examples' words, the tests themselves — did
 * not change. This step re-pins exactly those: a verdict whose hash matched
 * the record as committed at HEAD (pre-migration) and whose record now differs
 * ONLY in example bindings, the rule text and every example text identical,
 * gets the new hash. Nothing else in a verdict is touched — its R-numbers stay
 * (frozen history, verdicts/README.md). A record whose text changed stays stale.
 * Also: a mixed rule's `digitalClause` follows a citation recite changed inside
 * it, and RAQ claim hashes are re-stamped where recite changed only our words. */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, CR_RULES_DIR, CR_VERDICTS_DIR } from '../../paths.mjs';
import { recordHash, norm } from '../schema.mjs';
import { indentOf } from './absorb.mjs';

/** citations out, as check.mjs compares spans (kept here so this step runs before check.mjs changes) */
const CITE_RE = /\s*\(?\b(?:CR (?:\d{3}|D\d+)(?:\.\d+[a-z]*)?(?:,\s(?:\d{3}|D\d+)(?:\.\d+[a-z]*)?)*|R\d{1,3}b?(?:\s?[/+]\s?R\d{1,3}b?)*(?:\s?\(?(?:its\s)?§\s?\d+[a-z]?\)?)?)\)?/g;
const uncite = (s) => norm(String(s ?? '').replace(CITE_RE, ' ')).replace(/\s+([,.;:)])/g, '$1');

const rows = (abs, text) => JSON.parse(text ?? readFileSync(abs, 'utf8'));
const atHead = (abs) => { try { return execFileSync('git', ['show', `HEAD:${relative(REPO_ROOT, abs)}`], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }); } catch { return null; } };

export function repin({ dryRun = false } = {}) {
  const old = new Map(), cur = new Map();
  for (const f of readdirSync(CR_RULES_DIR).filter((x) => x.endsWith('.json'))) {
    const abs = join(CR_RULES_DIR, f);
    const h = atHead(abs);
    if (h) for (const r of rows(abs, h)) old.set(r.key, r);
    for (const r of rows(abs)) cur.set(r.key, r);
  }
  const onlyBindings = (a, b) => norm(a.text) === norm(b.text)
    && (a.examples ?? []).length === (b.examples ?? []).length
    && (a.examples ?? []).every((x, i) => norm(x?.text ?? '') === norm(b.examples[i]?.text ?? ''));
  const out = { repinned: 0, textChanged: [], untouched: 0, files: [] };
  for (const f of readdirSync(CR_VERDICTS_DIR).filter((x) => x.endsWith('.json'))) {
    const abs = join(CR_VERDICTS_DIR, f);
    const text = readFileSync(abs, 'utf8');
    const vs = rows(abs, text);
    let changed = false;
    for (const v of vs) {
      const a = old.get(v.key), b = cur.get(v.key);
      if (!a || !b || v.textHash !== recordHash(a)) { out.untouched++; continue; }
      const nh = recordHash(b);
      if (nh === v.textHash) { out.untouched++; continue; }
      if (!onlyBindings(a, b)) { out.textChanged.push(v.key); continue; }
      v.textHash = nh; changed = true; out.repinned++;
    }
    if (changed) {
      out.files.push(f);
      if (!dryRun) writeFileSync(abs, JSON.stringify(vs, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : ''));
    }
  }
  out.textChanged = [...new Set(out.textChanged)];

  /* a mixed rule's digitalClause follows its text when recite changed a citation inside it */
  out.clauses = { followed: 0, lost: [] };
  for (const f of readdirSync(CR_RULES_DIR).filter((x) => x.endsWith('.json'))) {
    const abs = join(CR_RULES_DIR, f);
    const text = readFileSync(abs, 'utf8');
    const rs = rows(abs, text);
    let changed = false;
    for (const r of rs) {
      if (!r.digitalClause || String(r.text).includes(r.digitalClause)) continue;
      const want = uncite(r.digitalClause), t = String(r.text);
      let hit = null;
      for (let i = 0; i < t.length && !hit; i++) {
        if (i && !/[\s(]/.test(t[i - 1])) continue;
        for (let j = t.length; j > i; j--) if (uncite(t.slice(i, j)) === want) { hit = t.slice(i, j); break; }
      }
      if (hit) { r.digitalClause = hit; changed = true; out.clauses.followed++; } else out.clauses.lost.push(r.key);
    }
    if (changed && !dryRun) writeFileSync(abs, JSON.stringify(rs, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : ''));
  }

  /* RAQ claim hashes: recite rewrote citations inside ledgers/raq.ts claims (our words around the
   * designer's), so a record's sourceHashes["RAQ …"] goes stale with no change to the designer's
   * text. The gate pins the stale count at 0 before the migration, so every RAQ hash that is
   * stale now was made stale by it: re-stamp those from a fresh extract (a child process — this
   * one has the pre-recite raq.ts cached). */
  out.raq = { restamped: 0 };
  const fresh = JSON.parse(execFileSync(process.execPath, ['-e', `import(${JSON.stringify(join(REPO_ROOT, 'client/engine/scripts/cr/extract.mjs'))}).then(({ extract }) => { const x = extract(); const h = {}; for (const t of x.raq) for (const c of t.claims) h['RAQ ' + c.id] = c.textHash; process.stdout.write(JSON.stringify(h)); })`],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }));
  for (const f of readdirSync(CR_RULES_DIR).filter((x) => x.endsWith('.json'))) {
    const abs = join(CR_RULES_DIR, f);
    const text = readFileSync(abs, 'utf8');
    const rs = rows(abs, text);
    let changed = false;
    for (const r of rs) for (const [k, h] of Object.entries(r.sourceHashes ?? {})) {
      if (fresh[k] && fresh[k] !== h) { r.sourceHashes[k] = fresh[k]; changed = true; out.raq.restamped++; }
    }
    if (changed && !dryRun) writeFileSync(abs, JSON.stringify(rs, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : ''));
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(repin({ dryRun: process.argv.includes('--dry-run') }), null, 1));
}
