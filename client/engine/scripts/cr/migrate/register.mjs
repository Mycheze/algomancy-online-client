/* THE RETIRED RULING REGISTER, for the migration's own tools.
 *
 * The register (client/docs/digital-rules.md, R1–R350) was deleted by the
 * CR-only migration; its final state is the archive ref
 * refs/archive/r-register-final. The scripts in this directory that read it
 * (rmap, census, audit, adopted, score — the register-era analysis) read it
 * here: from the working tree while it still exists, else from the archive ref.
 * Its two reviewed companions (classification.json, supersession.json) are read
 * the same way. Nothing outside migrate/ may import this: the register is not
 * an input of the comprehensive rules any more. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../paths.mjs';
import { RAQ } from '../../../../ledgers/raq.ts';

export const REGISTER_REL = 'client/docs/digital-rules.md';
export const ARCHIVE_REF = 'refs/archive/r-register-final';
const REVIEWED = { classification: 'data/comprehensive-rules/classification.json', supersession: 'data/comprehensive-rules/supersession.json' };

/** a file of the register era: the working tree's copy, else the archive ref's (null when neither) */
export function registerEraFile(rel) {
  const abs = join(REPO_ROOT, rel);
  if (existsSync(abs)) return readFileSync(abs, 'utf8');
  try { return execFileSync('git', ['show', `${ARCHIVE_REF}:${rel}`], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 30 }); } catch { return null; }
}
export function readRegister() {
  const t = registerEraFile(REGISTER_REL);
  if (t === null) throw new Error(`the ruling register is neither in the tree nor at ${ARCHIVE_REF} (fetch it: git fetch origin ${ARCHIVE_REF}:${ARCHIVE_REF})`);
  return t;
}
/** classification.json / supersession.json as they stood (null when unavailable) */
export function readReviewed(name) { const t = registerEraFile(REVIEWED[name]); return t === null ? null : JSON.parse(t); }

/** a ruling citation: `R114`, `R197b`, optionally followed by a scope ("R7 its Piercing half") */
const RULING_CITE_RE = /^R(\d+)(b?)(?![\w])\s*(.*)$/;
export function parseRulingCite(s) {
  const m = RULING_CITE_RE.exec(String(s).trim());
  if (!m) return null;
  return { id: `R${m[1]}${m[2]}`, n: Number(m[1]), suffix: m[2], scope: m[3].trim() };
}

const sha256 = s => createHash('sha256').update(s).digest('hex');
const byNum = (a, b) => a.n - b.n || a.suffix.localeCompare(b.suffix);
const uniqSorted = xs => [...new Set(xs)].sort();

/* ── RULINGS ─────────────────────────────────────────────────────────────── */

const GLYPHS = ['⚠', '❌', '✅'];

/**
 * `## R<digits>` with an optional `b`, then a non-word character or the end
 * of the line. Read character by character — test 411 counts the headings
 * with grep, a different mechanism, and the two must agree.
 */
function rulingHeading(line) {
  if (!line.startsWith('## R')) return null;
  let k = 4;
  while (k < line.length && line[k] >= '0' && line[k] <= '9') k++;
  if (k === 4) return null;
  const n = Number(line.slice(4, k));
  let suffix = '';
  if (line[k] === 'b') { suffix = 'b'; k++; }
  const next = line[k];
  if (next !== undefined && /\w/.test(next)) return null;
  return { n, suffix, rest: line.slice(k) };
}

/** a markdown link `[text](target)` → `text`, so an anchor like
 *  `#r301--…-r42-said-otherwise` is never read as a citation */
const unlink = s => s.replace(/\]\([^)\s]*\)/g, ']');

/** every `R<n>` / `R<n>b` cited in a text, as ids */
function refsIn(text) {
  return [...unlink(text).matchAll(/\bR(\d{1,3})(b?)(?![\w])/g)].map(m => `R${Number(m[1])}${m[2]}`);
}

const MANUAL_REF = /\b(?:Manual|Rulebook)\b(?:'s [^()\n]{0,30}\(| Q&A)? ?pp?\.\s?\d+(?:\s?[-–]\s?\d+)?/g;

/**
 * `[Solved] <title>` mentions in a body, resolved against the RAQ register's
 * own titles (imported). The doc wraps and truncates titles, so a mention
 * matches a thread when the text after the tag starts with the first 16
 * characters of the thread's title (tag removed, whitespace and quotes
 * normalised). A tagged mention that matches no thread is kept with
 * `threadId: null`.
 */
function raqTitleRefsIn(body, threads) {
  const norm = s => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ');
  const text = norm(unlink(body));
  const out = [];
  for (const m of text.matchAll(/\[(solved|asked|considered|todo)[^\]]{0,20}\]\s*([^\n]{0,60})/g)) {
    const after = m[2];
    const hits = threads.filter(t => t.key && after.startsWith(t.key));
    const mention = m[0].slice(0, 80).trim();
    if (hits.length) for (const h of hits) out.push({ text: mention, threadId: h.id });
    else out.push({ text: mention, threadId: null });
  }
  const seen = new Set();
  return out.filter(r => { const k = `${r.text}|${r.threadId}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.text.localeCompare(b.text) || String(a.threadId).localeCompare(String(b.threadId)));
}

export function parseRulings(md = readRegister()) {
  const lines = md.split('\n');
  const heads = [];
  lines.forEach((line, idx) => {
    const h = rulingHeading(line);
    if (h) heads.push({ ...h, idx });
    else if (line.startsWith('## ')) heads.push({ other: true, idx });
  });
  const threads = RAQ.map(e => ({
    id: e.id,
    key: e.title.replace(/^(\s*\[[^\]]*\])+\s*/, '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ').slice(0, 16),
  })).filter(t => /^\[/.test(RAQ.find(e => e.id === t.id).title) && t.key.length >= 8);
  const rulings = [];
  heads.forEach((h, k) => {
    if (h.other) return;
    const end = k + 1 < heads.length ? heads[k + 1].idx : lines.length;
    const bodyLines = lines.slice(h.idx + 1, end);
    while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();
    const body = bodyLines.join('\n');
    const id = `R${h.n}${h.suffix}`;
    let title = h.rest.replace(/^[\s⚠❌✅—–:-]+/u, '').trim();
    if (!title) {
      const sub = bodyLines.find(l => l.startsWith('### '));
      title = sub ? sub.slice(4).trim() : '';
    }
    const heading = lines[h.idx];
    const all = heading + '\n' + body;
    rulings.push({
      n: h.n, suffix: h.suffix, id, title,
      glyphs: GLYPHS.filter(g => h.rest.includes(g)).join(''),
      heading, line: h.idx + 1, body, bodyHash: sha256(body),
      dates: uniqSorted(all.match(/\b20\d\d-\d\d-\d\d\b/g) ?? []),
      testsCited: uniqSorted(all.match(/\b\d{1,3}-[A-Za-z0-9-]+\.test\.ts\b/g) ?? [])
        .sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b)),
      rulingsCited: [...new Set(refsIn(all))].filter(r => r !== id)
        .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)) || a.localeCompare(b)),
      manualRefs: uniqSorted((unlink(all).match(MANUAL_REF) ?? []).map(s => s.replace(/\s+/g, ' '))),
      raqTitleRefs: raqTitleRefsIn(body, threads),
    });
  });
  return rulings.sort(byNum);
}

